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
        },
        {
            id: 'craft_tnt',
            title: 'Pack a charge', titleDa: 'Lav en sprængladning',
            desc: 'Craft TNT at the refinery, then blow it with the Remote Detonator.',
            descDa: 'Lav TNT i raffinaderiet, og spræng den så med fjerndetonatoren.',
            goal: { type: 'craft', itemId: 45, count: 1 }
        },
        {
            id: 'craft_door',
            title: 'Fit a door', titleDa: 'Sæt en dør i',
            desc: 'Craft a Door at the refinery (2× Alloy + 1× Circuit), then press F to open it.',
            descDa: 'Byg en dør i raffinaderiet (2× legering + 1× kredsløb), og tryk F for at åbne den.',
            goal: { type: 'craft', itemId: 46, count: 1 },
            tip: 'Tab → Refinery', tipDa: 'Tab → Raffinaderi'
        },
        {
            id: 'survive_night',
            title: 'First night', titleDa: 'Første nat',
            desc: 'Stay alive until dawn when night falls. Build walls, close your door, keep a lamp lit.',
            descDa: 'Overlev til daggry når natten falder på. Byg vægge, luk døren, hold en lampe tændt.',
            goal: { type: 'survive_night', count: 1 },
            tip: 'Shelter + Lamp', tipDa: 'Ly + Lampe'
        },
        {
            id: 'scan_creature',
            title: 'Wildlife log', titleDa: 'Dyrejournal',
            desc: 'Hold Shift and scan any creature to add it to your field journal.',
            descDa: 'Hold Shift og scan et dyr for at tilføje det til feltjournalen.',
            goal: { type: 'creature', count: 1 },
            tip: 'Aim + Hold Shift', tipDa: 'Sigt + Hold Shift'
        },
        {
            id: 'dig_deep',
            title: 'Deep reading', titleDa: 'Dyb aflæsning',
            desc: 'Mine a block deep underground (below height 40) — caves hide rare ores.',
            descDa: 'Minér en blok dybt under jorden (under højde 40) — huler gemmer sjældne malme.',
            goal: { type: 'depth', maxY: 40, count: 1 },
            tip: 'Dig down / find a cave', tipDa: 'Grav ned / find en hule'
        },
        {
            id: 'find_landmark',
            title: 'Landmark hunt', titleDa: 'Find et vartegn',
            desc: 'Walk the wilds until you find a landmark, then hold Shift to scan it into your journal.',
            descDa: 'Gå i vildnisset til du finder et vartegn, og hold Shift for at scanne det ind i journalen.',
            goal: { type: 'discover', count: 1 },
            tip: 'Follow the pin · Hold Shift', tipDa: 'Følg markøren · Hold Shift',
            pin: 'landmark'
        },
        {
            id: 'chart_frost',
            title: 'Chart Frostpeak', titleDa: 'Kortlæg Frosttinde',
            desc: 'Travel to Frostpeak through the Star Gate (E). Craft a Gate Key if the gate is dormant.',
            descDa: 'Rejs til Frosttinde gennem Stjerneporten (E). Byg en portnøgle hvis porten sover.',
            goal: { type: 'travel', planetId: 'frost_tinde', count: 1 },
            tip: 'Follow the ◎ gate pin', tipDa: 'Følg ◎ port-markøren',
            pin: 'gate'
        }
    ];
    // Tips for the first five (kept out of the objects above so legacy ids stay tidy)
    MISSIONS[0].tip = 'Hold Shift'; MISSIONS[0].tipDa = 'Hold Shift';
    MISSIONS[1].tip = 'Hold Shift on new blocks'; MISSIONS[1].tipDa = 'Hold Shift på nye blokke';
    MISSIONS[2].tip = 'Right-click to place'; MISSIONS[2].tipDa = 'Højreklik for at placere';
    MISSIONS[3].tip = 'Tab → Refinery'; MISSIONS[3].tipDa = 'Tab → Raffinaderi';
    MISSIONS[4].tip = 'Tab → Refinery'; MISSIONS[4].tipDa = 'Tab → Raffinaderi';

    // Curator bilingual story beats — one-shot lines that frame the claim as chapter one.
    const STORY_BEATS = {
        firstScan: {
            en: 'Curator: Good. Look closely — every reading teaches.',
            da: 'Kurator: Godt. Se godt efter — hver aflæsning lærer dig noget.'
        },
        firstCraft: {
            en: 'Curator: You shaped raw ore into tools. That is how a claim begins.',
            da: 'Kurator: Du formede rå malm til værktøj. Sådan begynder et claim.'
        },
        firstNight: {
            en: 'Curator: Dawn returns. Walls, light, and patience keep explorers safe.',
            da: 'Kurator: Daggry vender tilbage. Mure, lys og tålmodighed holder opdagere sikre.'
        },
        firstGate: {
            en: 'Curator: The gate remembers other skies. Chart them when you are ready.',
            da: 'Kurator: Porten husker andre himle. Kortlæg dem, når du er klar.'
        }
    };

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
            // Copper traces on a silica board — "Cu on Si". Needed for weapon/drone
            // upgrades past Mk II; without this recipe Circuit is unobtainable.
            id: 'print_circuit',
            name: 'Print Circuit',
            desc: '2× Copper Ore + 1× Glass → 1× Circuit',
            output: 33,
            outputCount: 1,
            inputs: [{ id: 22, count: 2 }, { id: 32, count: 1 }]
        },
        {
            // Titanium fused with steel — "mixing metals changes everything". A premium
            // structural block; costs the deep-mined titanium. Previously unobtainable.
            id: 'forge_alloy',
            name: 'Forge Alloy',
            desc: '2× Titanium Ore + 1× Metal → 1× Alloy',
            output: 31,
            outputCount: 1,
            inputs: [{ id: 25, count: 2 }, { id: 7, count: 1 }]
        },
        {
            // Ship-grade armor plating layered up from Alloy — the toughest buildable
            // block. Previously unobtainable (no recipe, never spawned).
            id: 'press_hull',
            name: 'Press Hull',
            desc: '2× Alloy + 1× Metal → 1× Hull',
            output: 35,
            outputCount: 1,
            inputs: [{ id: 31, count: 2 }, { id: 7, count: 1 }]
        },
        {
            // Crystals power the Star Gates — craft a key to reactivate a dormant gate.
            id: 'craft_gatekey',
            name: 'Star Gate Key',
            desc: '3× Crystal + 1× Metal → 1× Gate Key',
            output: 41,
            outputCount: 1,
            inputs: [{ id: 10, count: 3 }, { id: 7, count: 1 }]
        },
        {
            // Carbon fuel packed with silica — a stand-in for real TNT chemistry. Place
            // the charge, then set it off with the Remote Detonator (or shoot it).
            id: 'pack_tnt',
            name: 'Pack TNT',
            desc: '3× Carbon + 2× Sand → 2× TNT',
            output: 45,
            outputCount: 2,
            inputs: [{ id: 27, count: 3 }, { id: 4, count: 2 }]
        },
        {
            // Gives Circuit a real sink that matches its "doors" flavour text.
            id: 'craft_door',
            name: 'Fit Door',
            desc: '2× Alloy + 1× Circuit → 1× Door',
            output: 46,
            outputCount: 1,
            inputs: [{ id: 31, count: 2 }, { id: 33, count: 1 }]
        },
        // Gear unlocks — Equip no longer grants ownership; kids craft (or start with) tools.
        {
            id: 'assemble_wrench',
            name: 'Forge Wrench',
            desc: '2× Metal → Wrench',
            outputWeapon: 'wrench',
            inputs: [{ id: 7, count: 2 }]
        },
        {
            id: 'assemble_sword',
            name: 'Forge Energy Sword',
            desc: '2× Alloy + 1× Crystal → Energy Sword',
            outputWeapon: 'sword',
            inputs: [{ id: 31, count: 2 }, { id: 10, count: 1 }]
        },
        {
            id: 'assemble_blaster',
            name: 'Assemble Blaster',
            desc: '1× Alloy + 1× Circuit + 1× Metal → Blaster Rifle',
            outputWeapon: 'blaster',
            inputs: [{ id: 31, count: 1 }, { id: 33, count: 1 }, { id: 7, count: 1 }]
        },
        {
            id: 'assemble_laser',
            name: 'Assemble Laser Rifle',
            desc: '1× Alloy + 2× Circuit + 1× Glass → Laser Rifle',
            outputWeapon: 'laser',
            inputs: [{ id: 31, count: 1 }, { id: 33, count: 2 }, { id: 32, count: 1 }]
        },
        {
            id: 'assemble_railgun',
            name: 'Assemble Railgun',
            desc: '2× Alloy + 2× Circuit + 1× Uranium → Railgun',
            outputWeapon: 'railgun',
            inputs: [{ id: 31, count: 2 }, { id: 33, count: 2 }, { id: 28, count: 1 }]
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
                creatures: {},
                landmarks: {},
                nightsSurvived: 0,
                deepestY: 999,
                story: {}
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
        p.journal = Object.assign({ scanned: {}, places: 0, crafted: {}, creatures: {}, landmarks: {}, nightsSurvived: 0, deepestY: 999, story: {} }, p.journal || {});
        p.journal.scanned = p.journal.scanned && typeof p.journal.scanned === 'object' ? p.journal.scanned : {};
        p.journal.places = p.journal.places | 0;
        p.journal.crafted = p.journal.crafted && typeof p.journal.crafted === 'object' ? p.journal.crafted : {};
        p.journal.creatures = p.journal.creatures && typeof p.journal.creatures === 'object' ? p.journal.creatures : {};
        p.journal.landmarks = p.journal.landmarks && typeof p.journal.landmarks === 'object' ? p.journal.landmarks : {};
        p.journal.nightsSurvived = p.journal.nightsSurvived | 0;
        p.journal.deepestY = (p.journal.deepestY == null) ? 999 : (p.journal.deepestY | 0);
        p.journal.story = (p.journal.story && typeof p.journal.story === 'object') ? p.journal.story : {};
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
        p.missions.completed = Array.isArray(p.missions.completed) ? p.missions.completed : [];
        // Re-point active at the first incomplete mission so newly added surveys
        // appear for players who already finished the old starter chain.
        {
            const next = MISSIONS.find((m) => !p.missions.completed.includes(m.id));
            p.missions.active = next ? next.id : '';
        }
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
            // Edits may be objects {x,y,z,id,t} (local / legacy cloud) or packed
            // arrays [x,y,z,id,t?] used by CloudSync to stay under the wire size cap.
            const edits = Array.isArray(ps.edits) ? ps.edits.map((e) => {
                if (Array.isArray(e)) {
                    const row = { x: e[0] | 0, y: e[1] | 0, z: e[2] | 0, id: e[3] | 0 };
                    if (e[4]) row.t = +e[4] || 0;
                    return row;
                }
                if (!e || typeof e !== 'object') return null;
                const row = { x: e.x | 0, y: e.y | 0, z: e.z | 0, id: e.id | 0 };
                // Preserve the edit timestamp (when present) so cross-device
                // merge can pick the newest change per cell. Old edits lack it.
                if (e.t) row.t = +e.t || 0;
                return row;
            }).filter(Boolean) : [];
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
    // A failed write loses whatever the player just built, so it is never swallowed:
    // it goes to the console and to an event the game turns into an on-screen warning.
    function writeJSON(k, v) {
        try { localStorage.setItem(k, JSON.stringify(v)); return true; }
        catch (err) {
            console.error('[AsteroidProfile] could not save "' + k + '" to localStorage:', err);
            try { window.dispatchEvent(new CustomEvent('pjboy:saveFailed', { detail: { key: k, error: err } })); } catch (_) {}
            return false;
        }
    }

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
        const newly = evaluateGrants(p);
        p.lastPlayed = Date.now();
        const idx = ensureIndex();
        writeJSON(slotKey(idx.active), p);
        const e = idx.list.find((s) => s.id === idx.active);
        if (e) { e.name = ((p.displayName || e.name || 'Explorer') + '').slice(0, 16); e.lastPlayed = p.lastPlayed; writeJSON(PROFILES_KEY, idx); }
        syncLegacyKeys(p);
        if (window.CloudSync) window.CloudSync.onProfileSaved(p);   // debounced cloud push (no-op if cloud off / unlinked)
        // Fanfare for newly charted worlds (HUD listens — never blocks the save).
        if (newly && newly.length) {
            try {
                window.dispatchEvent(new CustomEvent('pjboy:planetsGranted', { detail: { planets: newly } }));
            } catch (_) {}
        }
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
        // Prefer the stored active id when still incomplete; otherwise first incomplete
        // in chain order so newly added missions appear for players who finished the old set.
        const cur = missionById(profile.missions.active);
        if (cur && !profile.missions.completed.includes(cur.id)) return cur;
        return MISSIONS.find((m) => !profile.missions.completed.includes(m.id)) || null;
    }

    function journalUniqueCount(profile) {
        return Object.keys(profile.journal.scanned).length;
    }

    function missionProgress(profile) {
        const m = activeMission(profile);
        if (!m) {
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
        } else if (g.type === 'survive_night') {
            current = (profile.journal && profile.journal.nightsSurvived) | 0;
            label = `Nights survived: ${current} / ${g.count}`; labelDa = `Nætter overlevet: ${current} / ${g.count}`;
        } else if (g.type === 'creature') {
            current = Object.keys((profile.journal && profile.journal.creatures) || {}).length;
            label = `Creatures logged: ${current} / ${g.count}`; labelDa = `Dyr noteret: ${current} / ${g.count}`;
        } else if (g.type === 'depth') {
            const deep = (profile.journal && profile.journal.deepestY != null) ? (profile.journal.deepestY | 0) : 999;
            const maxY = (g.maxY != null) ? (g.maxY | 0) : 40;
            current = deep <= maxY ? 1 : 0;
            label = current ? `Deepest mine: Y ${deep}` : `Mine below Y ${maxY}`;
            labelDa = current ? `Dybeste mine: Y ${deep}` : `Minér under Y ${maxY}`;
        } else if (g.type === 'discover') {
            current = Object.keys((profile.journal && profile.journal.landmarks) || {}).length;
            label = `Landmarks logged: ${current} / ${g.count}`; labelDa = `Vartegn noteret: ${current} / ${g.count}`;
        } else if (g.type === 'travel') {
            if (g.planetId) {
                const ps = profile.system && profile.system.planets && profile.system.planets[g.planetId];
                current = (ps && ps.visited) ? 1 : 0;
                const def = planetDef(g.planetId);
                const nm = def ? def.name : g.planetId;
                label = current ? `Visited ${nm}` : `Travel to ${nm}`;
                labelDa = current ? `Besøgt ${def && def.nameDa ? def.nameDa : nm}` : `Rejs til ${def && def.nameDa ? def.nameDa : nm}`;
            } else {
                const visited = unlockedPlanets(profile).filter((pl) => {
                    if (pl.id === HOME_PLANET_ID) return false;
                    const ps = profile.system.planets[pl.id];
                    return !!(ps && ps.visited);
                }).length;
                current = visited;
                label = `Worlds visited: ${current} / ${g.count}`; labelDa = `Verdener besøgt: ${current} / ${g.count}`;
            }
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

    function takeStoryBeat(profile, key) {
        if (!profile.journal.story || typeof profile.journal.story !== 'object') profile.journal.story = {};
        if (profile.journal.story[key]) return null;
        const beat = STORY_BEATS[key];
        if (!beat) return null;
        profile.journal.story[key] = Date.now();
        return beat;
    }

    function recordScan(profile, blockId) {
        const id = String(blockId | 0);
        const entry = profile.journal.scanned[id] || { firstAt: Date.now(), count: 0 };
        const isNew = entry.count === 0;
        entry.count += 1;
        if (isNew) entry.firstAt = Date.now();
        profile.journal.scanned[id] = entry;
        const beat = takeStoryBeat(profile, 'firstScan');
        const completed = advanceMissionIfDone(profile);
        save(profile);
        return { isNew, completed, beat };
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
        const completed = advanceMissionIfDone(profile);
        save(profile);
        return { isNew, completed };
    }

    function recordLandmark(profile, landmarkId) {
        if (!profile.journal.landmarks || typeof profile.journal.landmarks !== 'object') profile.journal.landmarks = {};
        const id = String(landmarkId);
        const isNew = !profile.journal.landmarks[id];
        profile.journal.landmarks[id] = (profile.journal.landmarks[id] | 0) + 1;
        const completed = advanceMissionIfDone(profile);
        save(profile);
        return { isNew, completed };
    }

    function recordCraft(profile, itemId, count) {
        const id = String(itemId | 0);
        const n = Math.max(1, count | 0);
        if (!profile.journal.crafted || typeof profile.journal.crafted !== 'object') profile.journal.crafted = {};
        profile.journal.crafted[id] = ((profile.journal.crafted[id] | 0) + n);
        const beat = takeStoryBeat(profile, 'firstCraft');
        const completed = advanceMissionIfDone(profile);
        save(profile);
        return { completed, beat };
    }

    function recordSurviveNight(profile) {
        profile.journal.nightsSurvived = (profile.journal.nightsSurvived | 0) + 1;
        const beat = takeStoryBeat(profile, 'firstNight');
        const completed = advanceMissionIfDone(profile);
        save(profile);
        return { completed, nights: profile.journal.nightsSurvived, beat };
    }

    function recordDepth(profile, y) {
        const yy = y | 0;
        const prev = (profile.journal.deepestY == null) ? 999 : (profile.journal.deepestY | 0);
        if (yy < prev) profile.journal.deepestY = yy;
        const completed = advanceMissionIfDone(profile);
        save(profile);
        return { completed, deepestY: profile.journal.deepestY };
    }

    function recordTravel(profile, planetId) {
        const ps = planetState(profile, planetId);
        ps.visited = true;
        const completed = advanceMissionIfDone(profile);
        save(profile);
        return { completed };
    }

    function recordGateStory(profile) {
        const beat = takeStoryBeat(profile, 'firstGate');
        if (beat) save(profile);
        return { beat };
    }

    function touchStoryBeat(profile, key) {
        const beat = takeStoryBeat(profile, key);
        if (beat) save(profile);
        return beat;
    }

    function weaponIndexById(weaponId) {
        try {
            if (typeof VoxelCharacter !== 'undefined' && VoxelCharacter.weaponIdx) {
                return VoxelCharacter.weaponIdx(weaponId);
            }
        } catch (_) {}
        return -1;
    }

    function ownsWeapon(profile, weaponId) {
        const i = weaponIndexById(weaponId);
        if (i < 0) return false;
        const list = (profile.inventory && profile.inventory.ownedWeapons) || [];
        return list.indexOf(i) >= 0;
    }

    function grantWeapon(profile, weaponId) {
        const i = weaponIndexById(weaponId);
        if (i < 0) return false;
        if (!Array.isArray(profile.inventory.ownedWeapons)) profile.inventory.ownedWeapons = [];
        if (profile.inventory.ownedWeapons.indexOf(i) < 0) profile.inventory.ownedWeapons.push(i);
        save(profile);
        return true;
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
        // `t` timestamps the edit so cross-device merge can pick the newest
        // change per cell (see mergeEdits). Old edits without `t` count as 0.
        const row = { x: x | 0, y: y | 0, z: z | 0, id: id | 0, t: Date.now() };
        if (idx >= 0) edits[idx] = row;
        else edits.push(row);
        return profile;
    }

    // Batch version of upsertBlockEdit. Indexing the existing edits once makes this
    // O(n + m) instead of the per-cell findIndex's O(n * m) — a TNT blast can write
    // hundreds of cells at once against a world with thousands of prior edits, so the
    // single-cell path would spike the frame (and get worse with every blast).
    function upsertBlockEdits(profile, list) {
        if (!Array.isArray(list) || !list.length) return profile;
        const edits = planetState(profile).edits;
        const index = new Map();
        for (let i = 0; i < edits.length; i++) {
            const e = edits[i];
            index.set((e.x | 0) + ',' + (e.y | 0) + ',' + (e.z | 0), i);
        }
        const now = Date.now();
        for (const c of list) {
            const x = c.x | 0, y = c.y | 0, z = c.z | 0;
            const key = x + ',' + y + ',' + z;
            const row = { x, y, z, id: c.id | 0, t: now };
            const idx = index.get(key);
            if (idx !== undefined) edits[idx] = row;
            else { index.set(key, edits.length); edits.push(row); }
        }
        return profile;
    }

    // ---- cross-device merge (used by CloudSync.reconcile) ----
    // Union two per-cell edit lists. The same cell may exist in both; the newest
    // change wins by per-edit timestamp `t`, and on a tie / missing timestamp the
    // newer *document* wins (via `aNewer`). A cell present on only one side is
    // always kept — so two devices converge instead of clobbering.
    function mergeEdits(a, b, aNewer) {
        const pick = new Map();   // "x,y,z" -> { e, t }
        const consume = (list, fromA) => {
            if (!Array.isArray(list)) return;
            for (const e of list) {
                if (!e) continue;
                const key = (e.x | 0) + ',' + (e.y | 0) + ',' + (e.z | 0);
                const t = +e.t || 0;
                const prev = pick.get(key);
                if (!prev || t > prev.t || (t === prev.t && fromA === !!aNewer)) {
                    pick.set(key, { e, t });
                }
            }
        };
        consume(a, true);
        consume(b, false);
        const out = [];
        pick.forEach((v) => out.push(v.e));
        return out;
    }

    // Union a journal-style discovery map (keys = things found). Numeric values
    // take the max, boolean-ish values stay truthy. Monotonic — never un-finds.
    function mergeDiscoveryMap(a, b) {
        const out = {};
        a = a && typeof a === 'object' ? a : {};
        b = b && typeof b === 'object' ? b : {};
        new Set(Object.keys(a).concat(Object.keys(b))).forEach((k) => {
            const av = a[k], bv = b[k];
            if (typeof av === 'number' || typeof bv === 'number') out[k] = Math.max((+av || 0), (+bv || 0));
            else out[k] = av || bv || true;
        });
        return out;
    }

    // Reconcile a local and remote profile into one that loses NO world edits.
    // The more-recently-played document is "primary" and supplies ambiguous
    // mutable state (inventory, character, missions, current planet); monotonic
    // data is always unioned so two devices converge — per-planet block edits
    // (newest-wins per cell), charted planets, and journal discoveries.
    function mergeProfiles(local, remote) {
        local = normalizeProfile(local);
        if (!remote) return local;
        remote = normalizeProfile(remote);
        const aNewer = (+local.lastPlayed || 0) >= (+remote.lastPlayed || 0);
        const primary = aNewer ? local : remote;
        const merged = JSON.parse(JSON.stringify(primary));

        merged.system = merged.system || {};
        merged.system.planets = merged.system.planets || {};
        const lpl = (local.system && local.system.planets) || {};
        const rpl = (remote.system && remote.system.planets) || {};
        new Set(Object.keys(lpl).concat(Object.keys(rpl))).forEach((id) => {
            const lp = lpl[id] || {}, rp = rpl[id] || {};
            const base = merged.system.planets[id] || defaultPlanetState();
            base.edits = mergeEdits(lp.edits, rp.edits, aNewer);
            base.visited = !!(lp.visited || rp.visited || base.visited);
            base.claimName = base.claimName || lp.claimName || rp.claimName || '';
            merged.system.planets[id] = base;
        });
        // charted planets: union (never lose an unlock)
        merged.system.unlocked = Array.from(new Set(
            (((local.system && local.system.unlocked) || [])
                .concat((remote.system && remote.system.unlocked) || []))));

        // journal discoveries: union
        const lj = local.journal || {}, rj = remote.journal || {};
        merged.journal = merged.journal || {};
        merged.journal.scanned = mergeDiscoveryMap(lj.scanned, rj.scanned);
        merged.journal.creatures = mergeDiscoveryMap(lj.creatures, rj.creatures);
        merged.journal.crafted = mergeDiscoveryMap(lj.crafted, rj.crafted);
        merged.journal.landmarks = mergeDiscoveryMap(lj.landmarks, rj.landmarks);
        merged.journal.places = Math.max((+lj.places || 0), (+rj.places || 0));
        merged.journal.nightsSurvived = Math.max((+lj.nightsSurvived || 0), (+rj.nightsSurvived || 0));
        merged.journal.deepestY = Math.min(
            (lj.deepestY == null ? 999 : (+lj.deepestY || 999)),
            (rj.deepestY == null ? 999 : (+rj.deepestY || 999))
        );
        merged.journal.story = Object.assign({}, rj.story || {}, lj.story || {});

        // Owned weapons: union so craft unlocks from either device stick.
        const low = (local.inventory && local.inventory.ownedWeapons) || [];
        const row = (remote.inventory && remote.inventory.ownedWeapons) || [];
        merged.inventory = merged.inventory || {};
        merged.inventory.ownedWeapons = Array.from(new Set([].concat(low, row).map((i) => i | 0)));

        return normalizeProfile(merged);
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
    // Weapon recipes also refuse when the tool is already owned.
    function craftAvailability(recipe, counts, profile) {
        if (!recipe || !Array.isArray(recipe.inputs)) return { ok: false, missing: [] };
        if (recipe.outputWeapon && profile && ownsWeapon(profile, recipe.outputWeapon)) {
            return { ok: false, missing: [], owned: true };
        }
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
        recordSurviveNight,
        recordCreature,
        recordLandmark,
        recordDepth,
        recordTravel,
        recordGateStory,
        touchStoryBeat,
        grantWeapon,
        ownsWeapon,
        STORY_BEATS,
        upsertBlockEdit,
        upsertBlockEdits,
        mergeEdits,
        mergeProfiles,
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
