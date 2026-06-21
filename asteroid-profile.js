/**
 * Asteroid player profile — unified local save for name, character, claim, journal.
 * Shape is cloud-ready: one JSON document per player.
 */
(function () {
    'use strict';

    const PROFILE_KEY = 'pjboy.profile.v2';
    const PROFILE_VERSION = 2;

    // Missions are bilingual (English-forward, Danish underneath) for the
    // Danish->English learning goal — see CLAUDE.md audience notes.
    const MISSIONS = [
        {
            id: 'first_scan',
            title: 'First reading', titleDa: 'Første aflæsning',
            desc: 'Hold Shift and aim at a block to open the field scanner.',
            descDa: 'Hold Shift og sigt på en blok for at åbne feltscanneren.',
            goal: { type: 'scan', count: 1 }
        },
        {
            id: 'catalog_three',
            title: 'Mineralogist', titleDa: 'Mineralog',
            desc: 'Catalog three different block types in your field journal.',
            descDa: 'Katalogisér tre forskellige bloktyper i din feltjournal.',
            goal: { type: 'scan_unique', count: 3 }
        },
        {
            id: 'place_block',
            title: 'Foundations', titleDa: 'Fundament',
            desc: 'Place a block from your quickbar (right-click).',
            descDa: 'Placér en blok fra din værktøjslinje (højreklik).',
            goal: { type: 'place', count: 1 }
        },
        {
            id: 'craft_lamp',
            title: 'Camp light', titleDa: 'Lejrlys',
            desc: 'Craft a Lamp at the refinery (Tab → Refinery) — your first base upgrade.',
            descDa: 'Byg en lampe i raffinaderiet (Tab → Refinery) — din første base-opgradering.',
            goal: { type: 'craft', itemId: 34, count: 1 }
        }
    ];

    const CRAFT_RECIPES = [
        {
            id: 'smelt_metal',
            name: 'Smelt Metal',
            desc: '2× Iron Ore → 1× Metal',
            output: 7,
            outputCount: 1,
            inputs: [{ id: 23, count: 2 }]
        },
        {
            id: 'smelt_glass',
            name: 'Smelt Glass',
            desc: '2× Sand → 1× Glass',
            output: 32,
            outputCount: 1,
            inputs: [{ id: 4, count: 2 }]
        },
        {
            id: 'wire_lamp',
            name: 'Wire Lamp',
            desc: '1× Metal + 1× Glass → 1× Lamp',
            output: 34,
            outputCount: 1,
            inputs: [{ id: 7, count: 1 }, { id: 32, count: 1 }]
        },
        {
            // Crystals power the Star Gates — craft a key to reactivate a dormant gate.
            id: 'craft_gatekey',
            name: 'Star Gate Key',
            desc: '3× Crystal + 1× Metal → 1× Gate Key',
            output: 41,
            outputCount: 1,
            inputs: [{ id: 10, count: 3 }, { id: 7, count: 1 }]
        }
    ];

    // ---- Multiplanetary system: a curated catalog of granted worlds ----
    // Each planet is a deterministic seed + a biome theme. Names are bilingual
    // (English-forward, Danish underneath) per the Danish->English learning goal.
    // `grant.missionsDone` = how many surveys must be completed before the planet's
    // coordinates are granted; the home world is always unlocked (0).
    const PLANETS = [
        {
            id: 'verdant_home', name: 'Verdant', nameDa: 'Den Grønne',
            seed: 0x5eed01, biome: 'verdant', grant: { missionsDone: 0 },
            blurb: 'Your home claim — green growth, gentle caves, mild gravity.'
        },
        {
            id: 'frost_tinde', name: 'Frostpeak', nameDa: 'Frosttinde',
            seed: 0x1ce902, biome: 'frost', grant: { missionsDone: 1 },
            blurb: 'A frozen world: ice and snow blanket the surface — water turned solid by the cold.'
        },
        {
            id: 'spore_myco', name: 'Mycelia', nameDa: 'Svampeland',
            seed: 0x5f0f03, biome: 'fungal', grant: { missionsDone: 2 },
            blurb: 'A living fungal world. Spores and fungal mats grow where green plants cannot.'
        },
        {
            id: 'dust_regis', name: 'Dustfall', nameDa: 'Støvfald',
            seed: 0xd05704, biome: 'desert', grant: { missionsDone: 3 },
            blurb: 'A dry regolith world — bare rock and dust, much like the surface of the Moon.'
        },
        {
            id: 'ember_glod', name: 'Ember', nameDa: 'Glødehed',
            seed: 0xe11e05, biome: 'volcanic', grant: { missionsDone: 4 },
            blurb: 'A volcanic world. Red rock and basalt lie over hot ground above the molten core.'
        },
        {
            // First spec-driven world: generated entirely from a planet template.
            id: 'aquaria', name: 'Aquaria', nameDa: 'Vandverden',
            seed: 0xa10a06, biome: 'verdant', grant: { missionsDone: 1 },
            blurb: 'A gentle ocean world of scattered green isles under a wide blue sky.',
            spec: {
                basics: {
                    type: 'Ocean', sizeKm: 6200, starSystem: 'Lyra',
                    atmosphere: { oxygen: 22, toxicity: 0 },
                    tempRange: [4, 26],
                    gravity: 0.75,
                    dayLengthMin: 12
                },
                terrain: {
                    landBias: -18,           // mostly sea, scattered green isles
                    mountains: 0.6,          // low isle relief
                    tempBias: 0.08, moistBias: 0.4,
                    oreRichness: 1.25
                },
                visual: {
                    palette: { sky: 0x2f9fe6, horizon: 0xcdeefb, sun: 0xfff4e0, ground: 0x4a6a5a },
                    dayNight: true
                },
                population: { note: 'Coastal shell-traders in stilt villages.' },
                wildlife: { note: 'Calm grazers on the isles; no hunters.' },
                exploration: { note: 'Tide caves and sunken ruins to find.' }
            }
        }
    ];
    const HOME_PLANET_ID = PLANETS[0].id;

    function planetDef(id) {
        return PLANETS.find((pl) => pl.id === id) || PLANETS[0];
    }

    // A planet's optional `spec` template, with every field defaulted so a planet
    // without a spec generates exactly as before. GEN fields default to "no change".
    function normalizeSpec(raw) {
        const s = (raw && typeof raw === 'object') ? raw : {};
        const b = s.basics || {}, t = s.terrain || {}, v = s.visual || {};
        const num = (x, d) => (typeof x === 'number' && isFinite(x)) ? x : d;
        const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
        const atm = b.atmosphere || {};
        return {
            basics: {
                type: String(b.type || 'World'),
                sizeKm: num(b.sizeKm, 0),
                starSystem: String(b.starSystem || ''),
                atmosphere: { oxygen: num(atm.oxygen, 21), toxicity: num(atm.toxicity, 0) },
                tempRange: (Array.isArray(b.tempRange) && b.tempRange.length === 2)
                    ? [num(b.tempRange[0], 0), num(b.tempRange[1], 0)] : null,
                gravity: clamp(num(b.gravity, 1), 0.5, 1.3),
                dayLengthMin: clamp(num(b.dayLengthMin, 10), 2, 60)
            },
            terrain: {
                landBias: clamp(num(t.landBias, 0), -20, 20),
                mountains: clamp(num(t.mountains, 1), 0, 3),
                tempBias: clamp(num(t.tempBias, 0), -0.5, 0.5),
                moistBias: clamp(num(t.moistBias, 0), -0.5, 0.5),
                oreRichness: clamp(num(t.oreRichness, 1), 0.3, 3)
            },
            visual: {
                palette: (v.palette && typeof v.palette === 'object')
                    ? { sky: v.palette.sky | 0, horizon: v.palette.horizon | 0, sun: v.palette.sun | 0, ground: v.palette.ground | 0 }
                    : null,
                dayNight: !!v.dayNight
            },
            lore: {
                population: (s.population && s.population.note) || '',
                wildlife: (s.wildlife && s.wildlife.note) || '',
                exploration: (s.exploration && s.exploration.note) || ''
            }
        };
    }
    function planetSpec(def) {
        return normalizeSpec(def && def.spec);
    }

    function defaultPlanetState() {
        return { edits: [], claimName: '', visited: false };
    }

    function defaultCharacter() {
        const VC = typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
        if (VC) return Object.assign({}, VC.DEFAULT_PARAMS, { deco: 1, hair: 2 });
        return { classIdx: 0, body: 0, deco: 1, hair: 2, gear: 0, skin: 0, weapon: 0 };
    }

    // Every new profile starts with at least a mining tool + a plasma pistol.
    // Resolved by name (robust to weapon-index changes); falls back to known indices.
    function starterWeapons() {
        const out = [];
        const add = (name, fb) => {
            let i = -1;
            try { if (typeof VoxelCharacter !== 'undefined' && VoxelCharacter.weaponIdx) i = VoxelCharacter.weaponIdx(name); } catch (_) {}
            if (i < 0) i = fb;
            if (i >= 0 && out.indexOf(i) < 0) out.push(i);
        };
        add('minecutter', 5);   // Laser Handgun — sole mining tool
        add('plasma', 6);       // plasma pistol
        return out;
    }

    function defaultProfile() {
        return {
            version: PROFILE_VERSION,
            displayName: '',
            characterSetupDone: false,
            character: defaultCharacter(),
            system: {
                current: HOME_PLANET_ID,
                unlocked: [HOME_PLANET_ID],
                planets: { [HOME_PLANET_ID]: Object.assign(defaultPlanetState(), { visited: true }) }
            },
            journal: {
                scanned: {},
                places: 0,
                crafted: {},
                creatures: {}
            },
            inventory: {
                backpack: {},
                hotbar: Array(9).fill(null),
                ownedWeapons: starterWeapons(),
                weaponTier: {},     // { weaponId: 1..3 } — crafted upgrades (Mk I/II/III)
                droneTier: 1,       // companion Drone upgrade level (1..3)
                scannerTier: 1      // scanner range level (1..5 → 10..50 m)
            },
            missions: {
                active: MISSIONS[0].id,
                completed: []
            },
            lastPlayed: 0
        };
    }

    function normalizeCharacter(raw) {
        const VC = typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
        if (VC) return VC.normalizeParams(raw || defaultCharacter());
        return Object.assign(defaultCharacter(), raw || {});
    }

    function normalizeProfile(raw) {
        const base = defaultProfile();
        if (!raw || typeof raw !== 'object') return base;
        const p = Object.assign({}, base, raw);
        p.version = PROFILE_VERSION;
        p.displayName = String(p.displayName || '').slice(0, 16);
        p.character = normalizeCharacter(p.character);
        p.characterSetupDone = !!p.characterSetupDone;
        p.system = normalizeSystem(p.system);
        p.journal = Object.assign({ scanned: {}, places: 0, crafted: {}, creatures: {} }, p.journal || {});
        p.journal.scanned = p.journal.scanned && typeof p.journal.scanned === 'object' ? p.journal.scanned : {};
        p.journal.places = p.journal.places | 0;
        p.journal.crafted = p.journal.crafted && typeof p.journal.crafted === 'object' ? p.journal.crafted : {};
        p.journal.creatures = p.journal.creatures && typeof p.journal.creatures === 'object' ? p.journal.creatures : {};
        p.inventory = Object.assign({}, base.inventory, p.inventory || {});
        p.inventory.backpack = p.inventory.backpack && typeof p.inventory.backpack === 'object' ? p.inventory.backpack : {};
        p.inventory.hotbar = Array.isArray(p.inventory.hotbar) ? p.inventory.hotbar.slice(0, 9) : Array(9).fill(null);
        while (p.inventory.hotbar.length < 9) p.inventory.hotbar.push(null);
        p.inventory.ownedWeapons = Array.isArray(p.inventory.ownedWeapons) ? p.inventory.ownedWeapons.map((i) => i | 0) : [];
        // Pickaxe is retired in Asteroid mode (Laser Handgun is the sole mining tool):
        // drop its registry index from legacy saves so it never re-appears as owned.
        try {
            const px = (typeof VoxelCharacter !== 'undefined' && VoxelCharacter.weaponIdx) ? VoxelCharacter.weaponIdx('pickaxe') : 0;
            if (px >= 0) p.inventory.ownedWeapons = p.inventory.ownedWeapons.filter((i) => i !== px);
        } catch (_) {}
        p.inventory.weaponTier = (p.inventory.weaponTier && typeof p.inventory.weaponTier === 'object') ? p.inventory.weaponTier : {};
        p.inventory.droneTier = Math.max(1, Math.min(3, (p.inventory.droneTier | 0) || 1));
        p.inventory.scannerTier = Math.max(1, Math.min(5, (p.inventory.scannerTier | 0) || 1));
        p.missions = Object.assign({}, base.missions, p.missions || {});
        if (!MISSIONS.some((m) => m.id === p.missions.active)) p.missions.active = MISSIONS[0].id;
        p.missions.completed = Array.isArray(p.missions.completed) ? p.missions.completed : [];
        p.lastPlayed = p.lastPlayed | 0;
        return p;
    }

    function normalizeSystem(raw) {
        const sys = (raw && typeof raw === 'object') ? raw : {};
        const out = { current: HOME_PLANET_ID, unlocked: [], planets: {} };
        const want = Array.isArray(sys.unlocked) ? sys.unlocked : [];
        const valid = want.filter((id) => PLANETS.some((pl) => pl.id === id));
        out.unlocked = Array.from(new Set([HOME_PLANET_ID].concat(valid)));
        const planets = (sys.planets && typeof sys.planets === 'object') ? sys.planets : {};
        out.unlocked.forEach((id) => {
            const ps = (planets[id] && typeof planets[id] === 'object') ? planets[id] : {};
            const edits = Array.isArray(ps.edits) ? ps.edits.filter(
                (e) => e && typeof e === 'object'
            ).map((e) => ({ x: e.x | 0, y: e.y | 0, z: e.z | 0, id: e.id | 0 })) : [];
            out.planets[id] = {
                edits,
                claimName: String(ps.claimName || '').slice(0, 24),
                visited: !!ps.visited
            };
        });
        out.current = out.unlocked.indexOf(sys.current) >= 0 ? sys.current : HOME_PLANET_ID;
        out.planets[out.current].visited = true;
        return out;
    }

    function migrateLegacy(profile) {
        try {
            const mp = localStorage.getItem('pjboy.mp.name');
            if (mp && !profile.displayName) profile.displayName = mp.slice(0, 16);
        } catch (_) {}
        try {
            let raw = localStorage.getItem('pjboy.voxelCharacter.v1');
            if (!raw && typeof VoxelCharacter !== 'undefined') {
                raw = localStorage.getItem(VoxelCharacter.SAVE_KEY);
            }
            if (raw) {
                profile.character = normalizeCharacter(JSON.parse(raw));
                profile.characterSetupDone = true;
            }
        } catch (_) {}
        try {
            const raw = localStorage.getItem('pjboy.voxelWeapons.owned.v1');
            if (raw && !profile.inventory.ownedWeapons.length) {
                profile.inventory.ownedWeapons = JSON.parse(raw).map((i) => i | 0);
            }
        } catch (_) {}
        try {
            const raw = localStorage.getItem('pjboy.voxelHotbar.v1');
            if (raw && profile.inventory.hotbar.every((s) => !s)) {
                profile.inventory.hotbar = JSON.parse(raw);
            }
        } catch (_) {}
        return profile;
    }

    // ---- Multi-profile slots: named save files, each at slotKey(id). ----
    // An index document tracks the slot list + which is active. The legacy
    // single PROFILE_KEY save is migrated into the first slot on first run.
    const PROFILES_KEY = 'pjboy.profiles.v1';
    let _activeId = null;
    function slotKey(id) { return 'pjboy.profile.v2.' + id; }
    function readJSON(k) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (_) { return null; } }
    function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

    function ensureIndex() {
        let idx = readJSON(PROFILES_KEY);
        if (idx && Array.isArray(idx.list) && idx.list.length && idx.active) { _activeId = idx.active; return idx; }
        // bootstrap — migrate the legacy single profile into slot 'p1' if present
        const legacy = readJSON(PROFILE_KEY);
        if (legacy) {
            const name = ((legacy.displayName || 'Explorer') + '').slice(0, 16);
            writeJSON(slotKey('p1'), legacy);
            idx = { active: 'p1', list: [{ id: 'p1', name }] };
            try { localStorage.removeItem(PROFILE_KEY); } catch (_) {}
        } else {
            idx = { active: 'p1', list: [{ id: 'p1', name: 'Explorer' }] };
        }
        writeJSON(PROFILES_KEY, idx);
        _activeId = idx.active;
        return idx;
    }
    function activeProfileId() { return _activeId || ensureIndex().active; }

    function load() {
        const id = activeProfileId();
        const raw = readJSON(slotKey(id));
        if (raw) return normalizeProfile(raw);
        return migrateLegacy(normalizeProfile(null));
    }

    function save(profile) {
        const p = normalizeProfile(profile);
        evaluateGrants(p);
        p.lastPlayed = Date.now();
        const idx = ensureIndex();
        writeJSON(slotKey(idx.active), p);
        const e = idx.list.find((s) => s.id === idx.active);
        if (e) { e.name = ((p.displayName || e.name || 'Explorer') + '').slice(0, 16); e.lastPlayed = p.lastPlayed; writeJSON(PROFILES_KEY, idx); }
        syncLegacyKeys(p);
        if (window.CloudSync) window.CloudSync.onProfileSaved(p);   // debounced cloud push (no-op if cloud off / unlinked)
        return p;
    }

    // Slot management — used by the Profiles screen.
    function listProfiles() {
        const idx = ensureIndex();
        return idx.list.map((s) => {
            const data = readJSON(slotKey(s.id));
            return {
                id: s.id,
                name: s.name || 'Explorer',
                active: s.id === idx.active,
                lastPlayed: s.lastPlayed || 0,
                cataloged: data ? journalUniqueCount(normalizeProfile(data)) : 0
            };
        });
    }
    function newSlotId(idx) { let n = 1; while (idx.list.some((s) => s.id === 'p' + n)) n++; return 'p' + n; }
    function createProfile(name) {
        const idx = ensureIndex();
        const id = newSlotId(idx);
        const nm = ((name || 'Explorer') + '').slice(0, 16) || 'Explorer';
        idx.list.push({ id, name: nm });
        idx.active = id; _activeId = id;
        writeJSON(PROFILES_KEY, idx);
        const p = normalizeProfile(null); p.displayName = nm;
        writeJSON(slotKey(id), p);
        return id;
    }
    function switchProfile(id) {
        const idx = ensureIndex();
        if (!idx.list.some((s) => s.id === id)) return false;
        idx.active = id; _activeId = id; writeJSON(PROFILES_KEY, idx);
        return true;
    }
    function deleteProfile(id) {
        const idx = ensureIndex();
        if (idx.list.length <= 1) return false;     // always keep at least one
        idx.list = idx.list.filter((s) => s.id !== id);
        try { localStorage.removeItem(slotKey(id)); } catch (_) {}
        if (idx.active === id) { idx.active = idx.list[0].id; _activeId = idx.active; }
        writeJSON(PROFILES_KEY, idx);
        return true;
    }
    function renameProfile(id, name) {
        const idx = ensureIndex();
        const e = idx.list.find((s) => s.id === id); if (!e) return false;
        e.name = ((name || 'Explorer') + '').slice(0, 16) || 'Explorer';
        writeJSON(PROFILES_KEY, idx);
        const data = readJSON(slotKey(id));
        if (data) { data.displayName = e.name; writeJSON(slotKey(id), data); }
        return true;
    }

    function syncLegacyKeys(profile) {
        try {
            if (profile.displayName) localStorage.setItem('pjboy.mp.name', profile.displayName);
            localStorage.setItem('pjboy.voxelCharacter.v1', JSON.stringify(profile.character));
            if (typeof VoxelCharacter !== 'undefined') {
                VoxelCharacter.saveParams(profile.character);
            }
            localStorage.setItem('pjboy.voxelWeapons.owned.v1', JSON.stringify(profile.inventory.ownedWeapons));
            localStorage.setItem('pjboy.voxelHotbar.v1', JSON.stringify(profile.inventory.hotbar));
        } catch (_) {}
    }

    function missionById(id) {
        return MISSIONS.find((m) => m.id === id) || null;
    }

    function activeMission(profile) {
        return missionById(profile.missions.active) || MISSIONS[0];
    }

    function journalUniqueCount(profile) {
        return Object.keys(profile.journal.scanned).length;
    }

    function missionProgress(profile) {
        const m = activeMission(profile);
        if (!m || profile.missions.completed.includes(m.id)) {
            return { done: true, current: 0, target: 0, label: 'All surveys complete', labelDa: 'Alle opgaver fuldført' };
        }
        const g = m.goal;
        let current = 0;
        let label = m.desc, labelDa = m.descDa || m.desc;
        if (g.type === 'scan') {
            current = Object.values(profile.journal.scanned).reduce((n, e) => n + (e.count || 0), 0);
            label = `Scans: ${current} / ${g.count}`; labelDa = `Skanninger: ${current} / ${g.count}`;
        } else if (g.type === 'scan_unique') {
            current = journalUniqueCount(profile);
            label = `Cataloged: ${current} / ${g.count} types`; labelDa = `Katalogiseret: ${current} / ${g.count} typer`;
        } else if (g.type === 'place') {
            current = profile.journal.places | 0;
            label = `Blocks placed: ${current} / ${g.count}`; labelDa = `Blokke placeret: ${current} / ${g.count}`;
        } else if (g.type === 'craft') {
            current = (profile.journal.crafted && profile.journal.crafted[String(g.itemId | 0)]) | 0;
            label = `Crafted: ${current} / ${g.count}`; labelDa = `Bygget: ${current} / ${g.count}`;
        }
        return { done: current >= g.count, current, target: g.count, label, labelDa, mission: m };
    }

    function advanceMissionIfDone(profile) {
        const prog = missionProgress(profile);
        if (!prog.mission || !prog.done) return null;
        if (profile.missions.completed.includes(prog.mission.id)) return null;
        profile.missions.completed.push(prog.mission.id);
        const next = MISSIONS.find((m) => !profile.missions.completed.includes(m.id));
        profile.missions.active = next ? next.id : '';
        return prog.mission;
    }

    function recordScan(profile, blockId) {
        const id = String(blockId | 0);
        const entry = profile.journal.scanned[id] || { firstAt: Date.now(), count: 0 };
        const isNew = entry.count === 0;
        entry.count += 1;
        if (isNew) entry.firstAt = Date.now();
        profile.journal.scanned[id] = entry;
        const completed = advanceMissionIfDone(profile);
        save(profile);
        return { isNew, completed };
    }

    function recordPlace(profile) {
        profile.journal.places = (profile.journal.places | 0) + 1;
        const completed = advanceMissionIfDone(profile);
        save(profile);
        return { completed };
    }

    function recordCreature(profile, creatureId) {
        if (!profile.journal.creatures || typeof profile.journal.creatures !== 'object') profile.journal.creatures = {};
        const id = String(creatureId);
        const isNew = !profile.journal.creatures[id];
        profile.journal.creatures[id] = (profile.journal.creatures[id] | 0) + 1;
        save(profile);
        return { isNew };
    }

    function recordCraft(profile, itemId, count) {
        const id = String(itemId | 0);
        const n = Math.max(1, count | 0);
        if (!profile.journal.crafted || typeof profile.journal.crafted !== 'object') profile.journal.crafted = {};
        profile.journal.crafted[id] = ((profile.journal.crafted[id] | 0) + n);
        const completed = advanceMissionIfDone(profile);
        save(profile);
        return { completed };
    }

    // ---- Planet system accessors ----
    function currentPlanetId(profile) {
        return profile.system.current;
    }

    function currentPlanetDef(profile) {
        return planetDef(profile.system.current);
    }

    // Mutable saved state for one planet (edits/claimName/visited); created on demand.
    function planetState(profile, id) {
        id = id || profile.system.current;
        if (!profile.system.planets[id]) profile.system.planets[id] = defaultPlanetState();
        return profile.system.planets[id];
    }

    function unlockedPlanets(profile) {
        return PLANETS.filter((pl) => profile.system.unlocked.indexOf(pl.id) >= 0);
    }

    function isUnlocked(profile, id) {
        return profile.system.unlocked.indexOf(id) >= 0;
    }

    function grantPlanet(profile, id) {
        if (!PLANETS.some((pl) => pl.id === id)) return false;
        if (profile.system.unlocked.indexOf(id) >= 0) return false;
        profile.system.unlocked.push(id);
        if (!profile.system.planets[id]) profile.system.planets[id] = defaultPlanetState();
        return true;
    }

    // Unlock any catalog planets whose grant condition the player now meets.
    // Returns the list of newly-granted planet defs.
    function evaluateGrants(profile) {
        if (!profile || !profile.system) return [];
        const done = (profile.missions && Array.isArray(profile.missions.completed))
            ? profile.missions.completed.length : 0;
        const newly = [];
        for (const pl of PLANETS) {
            const need = (pl.grant && pl.grant.missionsDone) | 0;
            if (done >= need && grantPlanet(profile, pl.id)) newly.push(pl);
        }
        return newly;
    }

    function setCurrentPlanet(profile, id) {
        if (profile.system.unlocked.indexOf(id) < 0) return false;
        profile.system.current = id;
        planetState(profile, id).visited = true;
        save(profile);
        return true;
    }

    // Next unlocked planet in catalog order (wraps) — drives "travel" cycling.
    function nextUnlockedPlanet(profile) {
        const order = unlockedPlanets(profile);
        if (!order.length) return PLANETS[0];
        const i = order.findIndex((pl) => pl.id === profile.system.current);
        return order[(i + 1) % order.length];
    }

    function upsertBlockEdit(profile, x, y, z, id) {
        const edits = planetState(profile).edits;
        const key = `${x | 0},${y | 0},${z | 0}`;
        const idx = edits.findIndex((e) => `${e.x},${e.y},${e.z}` === key);
        const row = { x: x | 0, y: y | 0, z: z | 0, id: id | 0 };
        if (idx >= 0) edits[idx] = row;
        else edits.push(row);
        return profile;
    }

    function claimSummary(profile) {
        const def = currentPlanetDef(profile);
        const st = planetState(profile);
        const seedHex = (def.seed >>> 0).toString(16);
        const name = st.claimName || def.name;
        return {
            seedHex,
            edits: st.edits.length,
            cataloged: journalUniqueCount(profile),
            name,
            planetId: def.id,
            planetName: def.name,
            planetNameDa: def.nameDa,
            biome: def.biome,
            unlockedCount: profile.system.unlocked.length,
            totalPlanets: PLANETS.length
        };
    }

    function recipeById(id) {
        return CRAFT_RECIPES.find((r) => r.id === id) || null;
    }

    // ---- Upgrade tiers — crafted progression for gear (Mk I..V) + Drone (Mk I..III) ----
    function weaponTier(profile, id) {
        const t = profile && profile.inventory && profile.inventory.weaponTier ? (profile.inventory.weaponTier[id] | 0) : 0;
        return Math.max(1, Math.min(5, t || 1));
    }
    function setWeaponTier(profile, id, tier) {
        if (!profile.inventory.weaponTier) profile.inventory.weaponTier = {};
        profile.inventory.weaponTier[id] = Math.max(1, Math.min(5, tier | 0));
        save(profile);
        return profile.inventory.weaponTier[id];
    }
    function droneTier(profile) {
        return Math.max(1, Math.min(3, (profile && profile.inventory ? (profile.inventory.droneTier | 0) : 1) || 1));
    }
    function setDroneTier(profile, tier) {
        profile.inventory.droneTier = Math.max(1, Math.min(3, tier | 0));
        save(profile);
        return profile.inventory.droneTier;
    }
    function scannerTier(profile) {
        return Math.max(1, Math.min(5, (profile && profile.inventory ? (profile.inventory.scannerTier | 0) : 1) || 1));
    }
    function setScannerTier(profile, tier) {
        profile.inventory.scannerTier = Math.max(1, Math.min(5, tier | 0));
        save(profile);
        return profile.inventory.scannerTier;
    }

    function countOf(counts, id) {
        if (!counts) return 0;
        const k = id | 0;
        return ((counts[k] != null ? counts[k] : counts[String(k)]) | 0);
    }

    // Pure check: can `recipe` be crafted given a {itemId: count} materials map?
    function craftAvailability(recipe, counts) {
        if (!recipe || !Array.isArray(recipe.inputs)) return { ok: false, missing: [] };
        const missing = [];
        for (const inp of recipe.inputs) {
            const have = countOf(counts, inp.id);
            if (have < inp.count) missing.push({ id: inp.id, need: inp.count, have });
        }
        return { ok: missing.length === 0, missing };
    }

    window.AsteroidProfile = {
        PROFILE_KEY,
        MISSIONS,
        CRAFT_RECIPES,
        PLANETS,
        HOME_PLANET_ID,
        recipeById,
        craftAvailability,
        listProfiles,
        activeProfileId,
        createProfile,
        switchProfile,
        deleteProfile,
        renameProfile,
        weaponTier,
        setWeaponTier,
        droneTier,
        setDroneTier,
        scannerTier,
        setScannerTier,
        defaultProfile,
        load,
        save,
        migrateLegacy,
        normalizeProfile,
        normalizeCharacter,
        activeMission,
        missionProgress,
        missionById,
        journalUniqueCount,
        recordScan,
        recordPlace,
        recordCraft,
        recordCreature,
        upsertBlockEdit,
        claimSummary,
        syncLegacyKeys,
        planetDef,
        normalizeSpec,
        planetSpec,
        currentPlanetId,
        currentPlanetDef,
        planetState,
        unlockedPlanets,
        isUnlocked,
        grantPlanet,
        evaluateGrants,
        setCurrentPlanet,
        nextUnlockedPlanet
    };
})();
