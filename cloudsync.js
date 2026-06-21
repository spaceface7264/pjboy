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
    return String(code || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
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
    if (!enabled()) return;
    var code = getCode();
    if (!code) return;            // not linked yet — nothing to sync to
    _pending = profile;
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(function () {
      var p = _pending; _pending = null;
      push(code, p).catch(function (e) { console.warn('[cloud] push failed:', e.message || e); });
    }, 1500);
  }

  // Bind this browser to a fresh code, seeding the row from the current profile.
  // Returns a Promise<code>.
  function createForCurrent() {
    if (!enabled()) return Promise.reject(new Error('cloud off'));
    var code = genCode();
    var profile = window.AsteroidProfile ? window.AsteroidProfile.load() : {};
    return push(code, profile).then(function () { setCode(code); return code; });
  }

  // Pull an existing save by code and overwrite the local active profile.
  // Returns a Promise<true>; rejects with a friendly message if not found.
  function linkCode(code) {
    if (!enabled()) return Promise.reject(new Error('cloud off'));
    code = normalize(code);
    return pull(code).then(function (remote) {
      if (!remote) throw new Error('No save found for that code.');
      if (window.AsteroidProfile) window.AsteroidProfile.save(remote);
      setCode(code);
      return true;
    });
  }

  function status() {
    return { enabled: enabled(), code: getCode() };
  }

  return {
    enabled: enabled, status: status,
    getCode: getCode, setCode: setCode, clearCode: clearCode,
    genCode: genCode, normalize: normalize,
    pull: pull, push: push,
    onProfileSaved: onProfileSaved,
    createForCurrent: createForCurrent, linkCode: linkCode
  };
})();
