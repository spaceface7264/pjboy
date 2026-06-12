/**
 * Asteroid player profile — unified local save for name, character, claim, journal.
 * Shape is cloud-ready: one JSON document per player.
 */
(function () {
    'use strict';

    const PROFILE_KEY = 'pjboy.profile.v1';
    const PROFILE_VERSION = 1;

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
        }
    ];

    function defaultCharacter() {
        const VC = typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
        if (VC) return Object.assign({}, VC.DEFAULT_PARAMS, { deco: 1, hair: 2 });
        return { classIdx: 0, body: 0, deco: 1, hair: 2, gear: 0, skin: 0, weapon: 0 };
    }

    function defaultProfile() {
        const seed = (Math.random() * 1e9) | 0;
        return {
            version: PROFILE_VERSION,
            displayName: '',
            characterSetupDone: false,
            character: defaultCharacter(),
            asteroid: {
                seed,
                edits: [],
                named: false,
                claimName: ''
            },
            journal: {
                scanned: {},
                places: 0
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
        p.asteroid = Object.assign({}, base.asteroid, p.asteroid || {});
        p.asteroid.seed = (p.asteroid.seed | 0) || base.asteroid.seed;
        p.asteroid.edits = Array.isArray(p.asteroid.edits) ? p.asteroid.edits : [];
        p.asteroid.claimName = String(p.asteroid.claimName || '').slice(0, 24);
        p.journal = Object.assign({ scanned: {}, places: 0 }, p.journal || {});
        p.journal.scanned = p.journal.scanned && typeof p.journal.scanned === 'object' ? p.journal.scanned : {};
        p.journal.places = p.journal.places | 0;
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

    function setAsteroidSeed(profile, seed) {
        profile.asteroid.seed = seed | 0;
        profile.asteroid.edits = [];
        save(profile);
        return profile;
    }

    function upsertBlockEdit(profile, x, y, z, id) {
        const edits = profile.asteroid.edits;
        const key = `${x | 0},${y | 0},${z | 0}`;
        const idx = edits.findIndex((e) => `${e.x},${e.y},${e.z}` === key);
        const row = { x: x | 0, y: y | 0, z: z | 0, id: id | 0 };
        if (idx >= 0) edits[idx] = row;
        else edits.push(row);
        return profile;
    }

    function claimSummary(profile) {
        const seedHex = (profile.asteroid.seed >>> 0).toString(16);
        const edits = profile.asteroid.edits.length;
        const cataloged = journalUniqueCount(profile);
        const name = profile.asteroid.claimName || ('Claim ' + seedHex.slice(0, 6));
        return { seedHex, edits, cataloged, name };
    }

    window.AsteroidProfile = {
        PROFILE_KEY,
        MISSIONS,
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
        setAsteroidSeed,
        upsertBlockEdit,
        claimSummary,
        syncLegacyKeys
    };
})();
