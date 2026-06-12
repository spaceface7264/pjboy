/**
 * Asteroid player profile — unified local save for name, character, claim, journal.
 * Shape is cloud-ready: one JSON document per player.
 */
(function () {
    'use strict';

    const PROFILE_KEY = 'pjboy.profile.v2';
    const PROFILE_VERSION = 2;

    const MISSIONS = [
        {
            id: 'first_scan',
            title: 'First reading',
            desc: 'Hold Shift and aim at a block to open the field scanner.',
            goal: { type: 'scan', count: 1 }
        },
        {
            id: 'catalog_three',
            title: 'Mineralogist',
            desc: 'Catalog three different block types in your field journal.',
            goal: { type: 'scan_unique', count: 3 }
        },
        {
            id: 'place_block',
            title: 'Foundations',
            desc: 'Place a block from your quickbar (right-click).',
            goal: { type: 'place', count: 1 }
        },
        {
            id: 'craft_lamp',
            title: 'Camp light',
            desc: 'Craft a Lamp at the refinery (Tab → Refinery) — your first base upgrade.',
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
        }
    ];
    const HOME_PLANET_ID = PLANETS[0].id;

    function planetDef(id) {
        return PLANETS.find((pl) => pl.id === id) || PLANETS[0];
    }

    function defaultPlanetState() {
        return { edits: [], claimName: '', visited: false };
    }

    function defaultCharacter() {
        const VC = typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
        if (VC) return Object.assign({}, VC.DEFAULT_PARAMS, { deco: 1, hair: 2 });
        return { classIdx: 0, body: 0, deco: 1, hair: 2, gear: 0, skin: 0, weapon: 0 };
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
                crafted: {}
            },
            inventory: {
                backpack: {},
                hotbar: Array(9).fill(null),
                ownedWeapons: []
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
        p.journal = Object.assign({ scanned: {}, places: 0, crafted: {} }, p.journal || {});
        p.journal.scanned = p.journal.scanned && typeof p.journal.scanned === 'object' ? p.journal.scanned : {};
        p.journal.places = p.journal.places | 0;
        p.journal.crafted = p.journal.crafted && typeof p.journal.crafted === 'object' ? p.journal.crafted : {};
        p.inventory = Object.assign({}, base.inventory, p.inventory || {});
        p.inventory.backpack = p.inventory.backpack && typeof p.inventory.backpack === 'object' ? p.inventory.backpack : {};
        p.inventory.hotbar = Array.isArray(p.inventory.hotbar) ? p.inventory.hotbar.slice(0, 9) : Array(9).fill(null);
        while (p.inventory.hotbar.length < 9) p.inventory.hotbar.push(null);
        p.inventory.ownedWeapons = Array.isArray(p.inventory.ownedWeapons) ? p.inventory.ownedWeapons.map((i) => i | 0) : [];
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

    function load() {
        try {
            const raw = localStorage.getItem(PROFILE_KEY);
            if (raw) return normalizeProfile(JSON.parse(raw));
        } catch (_) {}
        return migrateLegacy(normalizeProfile(null));
    }

    function save(profile) {
        const p = normalizeProfile(profile);
        evaluateGrants(p);
        p.lastPlayed = Date.now();
        try {
            localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
        } catch (_) {}
        syncLegacyKeys(p);
        return p;
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
        if (!m || profile.missions.completed.includes(m.id)) return { done: true, current: 0, target: 0, label: 'All surveys complete' };
        const g = m.goal;
        let current = 0;
        let label = m.desc;
        if (g.type === 'scan') {
            current = Object.values(profile.journal.scanned).reduce((n, e) => n + (e.count || 0), 0);
            label = `Scans: ${current} / ${g.count}`;
        } else if (g.type === 'scan_unique') {
            current = journalUniqueCount(profile);
            label = `Cataloged: ${current} / ${g.count} types`;
        } else if (g.type === 'place') {
            current = profile.journal.places | 0;
            label = `Blocks placed: ${current} / ${g.count}`;
        } else if (g.type === 'craft') {
            current = (profile.journal.crafted && profile.journal.crafted[String(g.itemId | 0)]) | 0;
            label = `Crafted: ${current} / ${g.count}`;
        }
        return { done: current >= g.count, current, target: g.count, label, mission: m };
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
        upsertBlockEdit,
        claimSummary,
        syncLegacyKeys,
        planetDef,
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
