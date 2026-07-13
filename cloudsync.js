// PJBoy cloud save sync — window.CloudSync
//
// Capability model: a save is identified by a friendly CODE (e.g.
// EMBER-FOX-COMET-4821). Knowing the code lets a player carry one world across
// localhost, the live site, and other devices. All traffic goes through two
// Postgres RPCs (cloud_pull / cloud_push) that gate on the code; the table is
// RLS-locked so there is no direct access. See supabase/migrations/*_pjboy_cloud_saves.sql.
//
// Degrades gracefully: if cloud-config.js is unfilled or supabase-js failed to
// load, enabled() is false and every entry point is a no-op — the game keeps
// working exactly as it did before (local-only saves).
window.CloudSync = (function () {
  'use strict';

  var CFG = window.PJBOY_CLOUD || {};
  var CODE_KEY = 'pjboy.cloud.code.v1';   // which save-code this browser is bound to
  var _sb = null;

  function enabled() {
    return !!(CFG.url && CFG.anonKey && typeof window.supabase !== 'undefined');
  }
  function client() {
    if (!_sb && enabled()) {
      // No sign-in: calls run as the `anon` role via the apikey. persistSession
      // is off because we never authenticate a user.
      _sb = window.supabase.createClient(CFG.url, CFG.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
    }
    return _sb;
  }

  // ---- status broadcasting (for the in-game HUD indicator) ----
  // phase ∈ off | local | linked | pending | syncing | saved | error
  var _state = { enabled: false, phase: 'off', code: '', lastSaved: 0, error: null };
  var _listeners = [];
  function _emit() { for (var i = 0; i < _listeners.length; i++) { try { _listeners[i](_state); } catch (_) { } } }
  function _set(patch) { for (var k in patch) if (patch.hasOwnProperty(k)) _state[k] = patch[k]; _emit(); }
  // Subscribe to status changes; fires once immediately with current state.
  // Returns an unsubscribe function.
  function subscribe(fn) {
    if (typeof fn !== 'function') return function () { };
    _listeners.push(fn);
    try { fn(_state); } catch (_) { }
    return function () { var i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); };
  }
  function getState() { return _state; }

  // ---- code storage (which save this browser is linked to) ----
  function getCode() { try { return localStorage.getItem(CODE_KEY) || ''; } catch (_) { return ''; } }
  function setCode(c) { try { localStorage.setItem(CODE_KEY, c); } catch (_) { } }
  function clearCode() { try { localStorage.removeItem(CODE_KEY); } catch (_) { } }

  // ---- friendly code generator: WORD-WORD-WORD-#### (space/animal themed) ----
  var WORDS = [
    'EMBER', 'COMET', 'NOVA', 'ORBIT', 'LUNAR', 'SOLAR', 'NEBULA', 'METEOR', 'COSMIC',
    'GALAXY', 'ROCKET', 'PLASMA', 'CRATER', 'QUASAR', 'PULSAR', 'AURORA', 'STELLAR',
    'ECLIPSE', 'GRAVITY', 'PHOTON', 'ASTRO', 'VOID', 'DRIFT', 'WARP', 'PRISM',
    'FOX', 'OTTER', 'LYNX', 'WOLF', 'BEAR', 'HAWK', 'OWL', 'RAVEN', 'TIGER',
    'PANDA', 'MOOSE', 'BISON', 'CRANE', 'GECKO', 'NEWT', 'MANTA', 'ORCA', 'SEAL',
    'PUMA', 'KOALA', 'IBEX', 'TAPIR', 'HERON', 'SWIFT', 'WREN', 'FINCH', 'CROW',
    'BASALT', 'MAGMA', 'GEODE', 'QUARTZ', 'AMBER', 'COBALT', 'IRON', 'COPPER',
    'GLACIER', 'CANYON', 'TUNDRA', 'MESA', 'RIDGE', 'DELTA', 'REEF', 'DUNE',
    'SPORE', 'FERN', 'MOSS', 'PINE', 'CEDAR', 'LOTUS', 'CORAL', 'KELP', 'IVY',
    'BOLT', 'SPARK', 'FLARE', 'GLOW', 'FROST', 'ASH', 'STORM', 'TIDE', 'GUST',
    'PIXEL', 'VOXEL', 'CUBE', 'BLOCK', 'TOWER', 'CLAIM', 'SCOUT', 'PILOT', 'NOMAD'
  ];
  function rnd(n) { return Math.floor(Math.random() * n); }
  function genCode() {
    var w = WORDS;
    return [w[rnd(w.length)], w[rnd(w.length)], w[rnd(w.length)],
      String(1000 + rnd(9000))].join('-');
  }
  function normalize(code) {
    // Whitespace -> dash, then drop anything that isn't a code char. The strip
    // also hardens the UI: the code is rendered into innerHTML on the claim
    // screen and the table is writable via the public anon key, so a linked
    // code must never be able to carry markup.
    return String(code || '').trim().toUpperCase()
      .replace(/\s+/g, '-')
      .replace(/[^A-Z0-9-]/g, '')
      .replace(/-+/g, '-');
  }

  // ---- RPCs ----
  function pull(code) {
    var c = client(); if (!c) return Promise.reject(new Error('cloud off'));
    return c.rpc('cloud_pull', { p_code: normalize(code) }).then(function (r) {
      if (r.error) throw r.error;
      return r.data; // stored profile JSON, or null
    });
  }
  function push(code, profile) {
    var c = client(); if (!c) return Promise.reject(new Error('cloud off'));
    return c.rpc('cloud_push', { p_code: normalize(code), p_data: profile }).then(function (r) {
      if (r.error) throw r.error;
      return r.data; // updated_at
    });
  }

  // ---- debounced autosave: called by AsteroidProfile.save() ----
  var _timer = null, _pending = null;
  function onProfileSaved(profile) {
    if (!enabled()) { _set({ enabled: false, phase: 'off' }); return; }
    var code = getCode();
    if (!code) { _set({ enabled: true, code: '', phase: 'local' }); return; }  // not linked — local only
    _pending = profile;
    _set({ enabled: true, code: code, phase: 'pending', error: null });        // edit made; push queued
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(function () {
      var p = _pending; _pending = null;
      _set({ phase: 'syncing' });
      push(code, p).then(function () {
        _set({ phase: 'saved', lastSaved: Date.now(), error: null });
      }).catch(function (e) {
        console.warn('[cloud] push failed:', e.message || e);
        _set({ phase: 'error', error: (e && e.message) || String(e) });
      });
    }, 1500);
  }

  // Bind this browser to a fresh code, seeding the row from the current profile.
  // Returns a Promise<code>.
  function createForCurrent() {
    if (!enabled()) return Promise.reject(new Error('cloud off'));
    var code = genCode();
    var profile = window.AsteroidProfile ? window.AsteroidProfile.load() : {};
    _set({ enabled: true, phase: 'syncing', error: null });
    return push(code, profile).then(function () {
      setCode(code);
      _set({ code: code, phase: 'saved', lastSaved: Date.now(), error: null });
      return code;
    }).catch(function (e) { _set({ phase: 'error', error: (e && e.message) || String(e) }); throw e; });
  }

  // Pull an existing save by code and overwrite the local active profile.
  // Returns a Promise<true>; rejects with a friendly message if not found.
  function linkCode(code) {
    if (!enabled()) return Promise.reject(new Error('cloud off'));
    code = normalize(code);
    _set({ enabled: true, phase: 'syncing', error: null });
    return pull(code).then(function (remote) {
      if (!remote) { _set({ phase: 'error', error: 'No save found for that code.' }); throw new Error('No save found for that code.'); }
      if (window.AsteroidProfile) window.AsteroidProfile.save(remote);
      setCode(code);
      _set({ code: code, phase: 'saved', lastSaved: Date.now(), error: null });
      return true;
    }).catch(function (e) {
      if (_state.phase !== 'error') _set({ phase: 'error', error: (e && e.message) || String(e) });
      throw e;
    });
  }

  // Pull the cloud copy, MERGE it with local (losing no world edits), save the
  // merged result locally, and push it back so both sides converge. The safe
  // alternative to linkCode's overwrite — used on entering an Asteroid world.
  // Resolves { ok, changed, seeded?, reason? }; never rejects.
  function reconcile() {
    if (!enabled()) return Promise.resolve({ ok: false, reason: 'off' });
    var code = getCode();
    if (!code) return Promise.resolve({ ok: false, reason: 'unlinked' });
    var AP = window.AsteroidProfile;
    if (!AP || !AP.mergeProfiles) return Promise.resolve({ ok: false, reason: 'no-merge' });
    _set({ enabled: true, code: code, phase: 'syncing', error: null });
    return pull(code).then(function (remote) {
      if (!remote) {                                     // cloud empty — seed from local
        return push(code, AP.load()).then(function () {
          _set({ phase: 'saved', lastSaved: Date.now(), error: null });
          return { ok: true, seeded: true, changed: false };
        });
      }
      var merged = AP.mergeProfiles(AP.load(), remote);
      AP.save(merged);                                   // persist locally (bumps lastPlayed)
      return push(code, AP.load()).then(function () {    // converge cloud now, don't wait for debounce
        _set({ phase: 'saved', lastSaved: Date.now(), error: null });
        return { ok: true, changed: true };
      });
    }).catch(function (e) {
      console.warn('[cloud] reconcile failed:', e.message || e);
      _set({ phase: 'error', error: (e && e.message) || String(e) });
      return { ok: false, reason: 'error', error: e };
    });
  }

  function status() {
    return { enabled: enabled(), code: getCode() };
  }

  // Seed the initial status from persisted state (before any edit/sync).
  _state.enabled = enabled();
  _state.code = getCode();
  _state.phase = _state.enabled ? (_state.code ? 'linked' : 'local') : 'off';

  return {
    enabled: enabled, status: status,
    getCode: getCode, setCode: setCode, clearCode: clearCode,
    genCode: genCode, normalize: normalize,
    pull: pull, push: push,
    onProfileSaved: onProfileSaved,
    createForCurrent: createForCurrent, linkCode: linkCode,
    reconcile: reconcile,
    subscribe: subscribe, getState: getState
  };
})();
