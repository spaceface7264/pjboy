/*
 * worldstream.js — infinite, chunk-streamed open world for PJBoy, with biomes
 * populated by real GLTF props (Minecraft-ish: trees, rocks, grass, flowers,
 * mushrooms, animals).
 *
 * Streaming: only a window of chunks around the player is ever live. Walk far
 * enough and chunks ahead are built while chunks behind are freed, so total
 * world size is unbounded at constant cost.
 *
 * Biomes (beach → grassland → meadow → forest) are assigned by a low-frequency
 * value-noise field over chunk coords, so they form large contiguous regions
 * you roam between. Each chunk colors its own ground tile and scatters props
 * from its biome's palette; sky/fog/ground tint lerp to the biome you stand in.
 *
 * Reuses the host Game3D wholesale:
 *   - this.walls + this.wallHash → collision is already broad-phased, works at
 *     any coordinate. Collidable props (trees/rocks) are pushed as wall AABBs.
 *   - y=0 is a global floor clamp (game.js), so streamed ground is cosmetic.
 *   - this.sky / scene.fog → the sky sphere sits beyond the fog, so fog color
 *     is effectively the sky color. We drive both for a blue sky.
 *
 * GLTF props are loaded once and cloned per placement (mirroring openworld.js).
 * Loading is async; chunks rebuild once the assets arrive.
 *
 * Loaded as a <script> before game.js; exposed as window.WorldStream and
 * driven by the open_world mode (modes.js) via update(dt) each fixed step.
 */
(function () {
    'use strict';

    const CELL = 1;                        // true 1×1×1 voxels
    const CHUNK_CELLS = 32;                // keep chunk world size at 32u (32×1)
    const CHUNK_SIZE = CHUNK_CELLS * CELL;
    // Two streaming radii: voxel terrain renders far (one InstancedMesh per
    // chunk = 1 draw call); props/animals populate only the nearer window.
    // Pulled in for 1×1 voxels (4× the cubes) to keep the load reasonable.
    const TERRAIN_RADIUS = 6;
    const PROP_RADIUS = 5;
    const EDGE_MARGIN = 3;                 // open cells kept around chunk edges
    const CHUNK_MID = (CHUNK_CELLS - 1) * CELL / 2;
    const GROUND_SIZE = (TERRAIN_RADIUS * 2 + 3) * CHUNK_SIZE;
    const FOG_NEAR = 60;
    const FOG_FAR = 185;
    const BIOME_SCALE = 5;                 // ~5 chunks per biome patch
    const BIOME_SEED = 1337;
    // Blocky terrain: multi-octave signed noise (continents → mountains and
    // ocean basins) quantized to cubic steps.
    const TERRAIN_SEED = 4242;
    const CONT_SCALE = 170;                // very large land masses / oceans
    const HILL_SCALE = 55;                 // rolling hills
    const DETAIL_SCALE = 20;               // fine bumpiness
    const TERRAIN_AMP = 52;                // vertical span (peaks vs ocean floor)
    const SEA_BIAS = 0.40;                 // higher → more ocean
    // A guaranteed deep-water basin at the world center (boss arena / sea monster).
    const SEA_RADIUS = 240;                // basin radius (world units)
    const SEA_DEPTH = 40;                  // depth at the very center
    const VOXEL_STEP = 1;                  // height step (1u terraces; footprint stays CELL=2)
    const VOXEL_MAX_H = 16;                // tallest exposed cliff face we fill (world units)
    const SNOW_LEVEL = 22;                 // surface y at/above this gets snow-capped
    const WATER_Y = 0;                     // sea level — terrain below this is underwater
    const WATER_SHALLOW = 0x5fc4ec;        // color at the shoreline
    const WATER_DEEP = 0x05182e;           // color over the deepest water
    const WATER_MAX_DEPTH = 12;            // depth (units) at which water reads fully dark
    const DIG_FLOOR = -28;                 // deepest you can mine the ground (world units)
    const EDITS = new Map();               // "cellX,cellZ" → dug surface height override
    const ANIMAL_SPEED = 1.6;              // wander speed (u/s)

    const ROOT = 'assets/Blocks/';
    const env = (n) => ROOT + 'environment/' + n + '.gltf';
    const ani = (n) => ROOT + 'Animals/' + n + '.gltf';
    // Animated fish (Quaternius bundle). Small/medium school + occasional large
    // creatures. Whale/Shark are reserved for the deep-sea monster role.
    const FISH_SMALL = ['sea/fish_a.glb', 'sea/fish_b.glb', 'sea/fish_c.glb'].map((p) => ROOT + p);
    const FISH_LARGE = ['sea/dolphin.glb', 'sea/manta.glb'].map((p) => ROOT + p);
    const FISH_PATHS = FISH_SMALL.concat(FISH_LARGE); // for preloading
    const FISH_SPEED = 2.2;
    const FISH_YAW_OFFSET = 0;             // Quaternius models face +Z; tune if sideways

    // Nether Portal — a fixed landmark dropped near spawn. The GLB is the
    // obsidian frame; this swirl shader fills the opening (shared look with the
    // hub-and-spoke portals in openworld.js).
    const NETHER_PORTAL_PATH = ROOT + 'environment/Nether_Portal.glb';
    const PORTAL_VS = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`;
    const PORTAL_FS = `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
            vec2 c = vUv - 0.5;
            float r = length(c) * 2.0;
            float a = atan(c.y, c.x);
            float swirl  = sin(a * 6.0 + uTime * 3.0 - r * 8.0);
            float swirl2 = sin(a * 4.0 - uTime * 2.0 + r * 6.0);
            float ring = smoothstep(1.0, 0.15, r);
            vec3 black  = vec3(0.03, 0.0, 0.07);
            vec3 col = mix(black, uColor, swirl * 0.5 + 0.5);
            col = mix(col, vec3(1.0, 0.9, 1.0), max(0.0, swirl2) * 0.18);
            gl_FragColor = vec4(col * ring, ring);
        }`;

    // Lava surface — unlit value-noise flow that glows hot. Shares PORTAL_VS
    // (it supplies vUv). Drawn flat; bright cracks crawl over a dark crust.
    const LAVA_FS = `
        uniform float uTime;
        uniform float uScale;
        varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = h(i), b = h(i + vec2(1.0, 0.0));
            float c = h(i + vec2(0.0, 1.0)), d = h(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        void main(){
            vec2 uv = vUv * uScale;
            float t = uTime * 0.18;
            float v = n(uv + vec2(t, t * 0.6)) * 0.6 + n(uv * 2.1 - vec2(t * 0.7, t)) * 0.4;
            vec3 dark = vec3(0.32, 0.04, 0.02);
            vec3 mid  = vec3(0.95, 0.32, 0.06);
            vec3 hot  = vec3(1.0, 0.86, 0.38);
            vec3 col = mix(dark, mid, smoothstep(0.32, 0.6, v));
            col = mix(col, hot, smoothstep(0.66, 0.96, v));
            gl_FragColor = vec4(col, 1.0);
        }`;

    // CC0 lava trees (Quaternius via Poly Pizza) — keep their native lava colors.
    const NETHER_LAVA_TREES = [
        ROOT + 'environment/Lava_Tree_1.glb',
        ROOT + 'environment/Lava_Tree_2.glb',
        ROOT + 'environment/Lava_Tree_3.glb',
    ];
    // CC0 ambientCG textures (public domain): nether rock for terrain, lava sheet.
    const TEX = ROOT + 'mc_textures/';
    const NETHER_ROCK_TEX = TEX + 'nether_rock.jpg';
    const LAVA_COLOR_TEX = TEX + 'lava_color.jpg';
    const LAVA_EMISSIVE_TEX = TEX + 'lava_emission.jpg';

    // Nether-world assets (loaded on first portal entry; recolored in code).
    const NETHER_PATHS = [
        env('Rock1'), env('Rock2'),
        ROOT + 'Block_Coal.gltf', ROOT + 'Block_Stone.gltf',
        ROOT + 'Block_Brick.gltf', ROOT + 'Block_GreyBricks.gltf',
        env('DeadTree_1'), env('DeadTree_2'), env('DeadTree_3'),
        env('Crystal_Small'), env('Chest_Closed'), env('Fence_Center'),
        ROOT + 'enemies/Demon.gltf', ROOT + 'enemies/Zombie.gltf', ROOT + 'enemies/Goblin.gltf',
        ROOT + 'enemies/Skeleton_Armor.gltf', ROOT + 'enemies/Wizard.gltf', ROOT + 'enemies/Giant.gltf',
        NETHER_PORTAL_PATH,
        NETHER_LAVA_TREES[0], NETHER_LAVA_TREES[1], NETHER_LAVA_TREES[2],
    ];
    const NETHER_FLOOR_Y = 0;        // reference plane (kept for spawn math)
    const NETHER_RADIUS = 72;        // arena half-extent (expanded)
    const NETHER_SEED = 9911;
    const NETHER_LAVA_LEVEL = 0;     // basins below this fill with lava
    const NETHER_CELL = 2;           // terrain cube footprint (matches CELL/VOXEL_STEP)

    // Gradient sky dome: deep blue at the zenith easing to the (biome) horizon
    // color at the bottom. Uses object-space direction so the dome can follow
    // the player without skewing the gradient. Fog is disabled on it so the
    // sky shows above the haze instead of being washed flat.
    const SKY_VS = `
        varying vec3 vDir;
        void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`;
    const SKY_FS = `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float expo;
        varying vec3 vDir;
        void main() {
            float h = clamp(vDir.y, 0.0, 1.0);
            gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, expo)), 1.0);
        }`;
    const SKY_ZENITH = 0x2a72cc;

    // Sun: direction light comes from + where the visible disc sits. Roughly
    // unit length (≈1.003).
    const SUN_DIR = { x: 0.40, y: 0.84, z: 0.37 };
    const SUN_DIST = 460;     // inside the 500-radius sky dome
    // 3D cloud puffs scattered in a field that wraps around the player.
    const CLOUD_PATHS = [1, 2, 3, 4].map((n) => ROOT + 'sky/Cloud_' + n + '.glb');
    const CLOUD_COUNT = 22;
    const CLOUD_FIELD = 720;  // square field side (world units), centered on player
    const CLOUD_Y_MIN = 70;
    const CLOUD_Y_MAX = 120;
    const CLOUD_WIND = 1.4;   // drift speed (units/sec, +x)
    // Floating space station landmark above the world center.
    const STATION_PATH = ROOT + 'Spaceship.glb';
    const STATION_Y = 150;    // altitude
    const STATION_SIZE = 64;  // longest dimension (world units)

    // Each biome: ground/sky color, content density, and three prop pools —
    // `feature` (collidable: trees, rocks), `decor` (walk-through: grass,
    // flowers, mushrooms), `animals`.
    const BIOMES = {
        beach: {
            name: 'beach', ground: 0xe6d6a8, sky: 0x46b6ef, density: 0.35,
            feature: [env('Rock1'), env('Rock2')],
            decor: [env('Grass_Small'), env('Bamboo_Small'), env('Plant_2')],
            animals: [ani('Chick')],
        },
        grassland: {
            name: 'grassland', ground: 0x7cb342, sky: 0x3aa0ec, density: 0.75,
            feature: [env('Tree_1'), env('Tree_2'), env('Tree_3'), env('Rock1')],
            decor: [env('Grass_Big'), env('Grass_Small'), env('Flowers_1'), env('Flowers_2'), env('Bush')],
            animals: [ani('Sheep'), ani('Horse'), ani('Chicken')],
        },
        meadow: {
            name: 'meadow', ground: 0x9ccc65, sky: 0x3ea4ee, density: 0.85,
            feature: [env('Tree_2'), env('Rock1')],
            decor: [env('Flowers_1'), env('Flowers_2'), env('Grass_Big'), env('Mushroom'), env('Plant_2'), env('Plant_3'), env('Bush')],
            animals: [ani('Pig'), ani('Chicken'), ani('Cat')],
        },
        forest: {
            name: 'forest', ground: 0x2f6b1e, sky: 0x4a96da, density: 1.6,
            feature: [env('Tree_1'), env('Tree_2'), env('Tree_3'), env('DeadTree_1'), env('DeadTree_2')],
            decor: [env('Mushroom'), env('Plant_2'), env('Plant_3'), env('Grass_Small'), env('Bush')],
            animals: [ani('Wolf'), ani('Raccoon')],
        },
    };

    // Per-prop scale range and collision half-extent, derived from the model name.
    function propScale(path) {
        if (path.indexOf('DeadTree') !== -1) return [1.3, 1.8];
        if (path.indexOf('Tree') !== -1) return [1.3, 2.0];
        if (path.indexOf('Rock') !== -1) return [1.0, 1.8];
        if (path.indexOf('Bamboo') !== -1) return [1.2, 1.9];
        if (path.indexOf('/Animals/') !== -1) return [1.0, 1.4];
        return [0.8, 1.4]; // grass, flowers, mushrooms, bushes, plants
    }
    function propHalf(path) {
        if (path.indexOf('Tree') !== -1) return 0.7;   // covers DeadTree too
        if (path.indexOf('Rock') !== -1) return 0.85;
        return 0.6;
    }

    // --- deterministic hashing / noise -------------------------------------

    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function chunkSeed(cx, cz) {
        return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0;
    }

    function hash2(ix, iz, seed) {
        let h = Math.imul(ix | 0, 73856093) ^ Math.imul(iz | 0, 19349663) ^ Math.imul(seed | 0, 83492791);
        h = (h ^ (h >>> 13)) >>> 0;
        return (h & 0xffff) / 0x10000;
    }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function valueNoise(x, z, seed) {
        const ix = Math.floor(x), iz = Math.floor(z);
        const fx = x - ix, fz = z - iz;
        const v00 = hash2(ix, iz, seed), v10 = hash2(ix + 1, iz, seed);
        const v01 = hash2(ix, iz + 1, seed), v11 = hash2(ix + 1, iz + 1, seed);
        const sx = smooth(fx), sz = smooth(fz);
        const a = v00 + (v10 - v00) * sx;
        const b = v01 + (v11 - v01) * sx;
        return a + (b - a) * sz;
    }
    function biomeAt(cx, cz) {
        const t = valueNoise(cx / BIOME_SCALE, cz / BIOME_SCALE, BIOME_SEED);
        if (t < 0.30) return BIOMES.beach;
        if (t < 0.55) return BIOMES.grassland;
        if (t < 0.80) return BIOMES.meadow;
        return BIOMES.forest;
    }

    function lerpHex(a, b, t) {
        const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
        const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
        return (((ar + (br - ar) * t) | 0) << 16) | (((ag + (bg - ag) * t) | 0) << 8) | ((ab + (bb - ab) * t) | 0);
    }

    // ---- Nether terrain (height + variation, separate from the overworld) ----
    // Blocky hills, plateaus and basins. Basins below NETHER_LAVA_LEVEL become
    // lava lakes; a guaranteed central basin + a raised rim wall the arena.
    function netherHeight(x, z) {
        const big = valueNoise(x / 42, z / 42, NETHER_SEED);
        const mid = valueNoise(x / 16, z / 16, NETHER_SEED + 5);
        const det = valueNoise(x / 7, z / 7, NETHER_SEED + 9);
        const e = big * 0.6 + mid * 0.3 + det * 0.1; // 0..1
        let h = (e - 0.44) * 34;                      // ~ -15 .. +19
        const d = Math.sqrt(x * x + z * z);
        if (d < 18) {                                 // central lava basin
            const t = d / 18, w = 1 - t * t;
            h = h * (1 - w) + (-9) * w;
        }
        if (d > NETHER_RADIUS - 10) {                 // raised crater rim
            h += (d - (NETHER_RADIUS - 10)) * 1.7;
        }
        return h;
    }
    function netherSurfaceY(x, z) {
        return Math.round(netherHeight(x, z) / VOXEL_STEP) * VOXEL_STEP;
    }
    // Palette by height + low-frequency "biome" patches (crimson / soul / basalt).
    function netherColorAt(x, z, s) {
        if (s <= NETHER_LAVA_LEVEL + VOXEL_STEP) return 0x6e1e0c; // glowing crust by lava
        if (s >= 16) return 0x272430;                             // basalt peaks
        if (s >= 10) return 0x39323f;                             // blackstone
        const patch = valueNoise(x / 28, z / 28, NETHER_SEED + 21);
        if (patch < 0.34) return 0x7c1f12;                        // netherrack red
        if (patch < 0.64) return 0x4a2c16;                        // soul soil brown
        return 0x5e1018;                                          // crimson nylium
    }

    // Terrain surface height at a world position. Two octaves of value noise →
    // smooth rolling hills in [0, TERRAIN_AMP]. Used for the displaced ground,
    // prop placement, and the player's floor clamp (game.js).
    function terrainHeight(x, z) {
        const cont = valueNoise(x / CONT_SCALE, z / CONT_SCALE, TERRAIN_SEED);
        const hills = valueNoise(x / HILL_SCALE, z / HILL_SCALE, TERRAIN_SEED + 7);
        const det = valueNoise(x / DETAIL_SCALE, z / DETAIL_SCALE, TERRAIN_SEED + 13);
        let e = cont * 0.62 + hills * 0.30 + det * 0.08; // 0..1
        e -= SEA_BIAS;                                    // shift sea level toward 0
        // Emphasize relief: land rises steeply (mountains), oceans dip deep.
        const shaped = e >= 0 ? Math.pow(e, 1.5) : -Math.pow(-e, 1.0);
        let h = shaped * TERRAIN_AMP;
        // Carve a deep circular basin at the world center, smoothly blended out.
        const d = Math.sqrt(x * x + z * z);
        if (d < SEA_RADIUS) {
            const t = d / SEA_RADIUS;          // 0 center → 1 edge
            const k = 1 - t * t;
            const w = k * k * (3 - 2 * k);     // smooth 1 → 0
            h = h * (1 - w) + (-SEA_DEPTH) * w;
        }
        return h;
    }

    // Quantized block-top height — the walkable/visible surface. Everything
    // (floor clamp, props, animals, voxels) snaps to this. Dug cells are stored
    // in EDITS and override the generated height so holes persist.
    function surfaceY(x, z) {
        const k = Math.round(x / CELL) + ',' + Math.round(z / CELL);
        if (EDITS.has(k)) return EDITS.get(k);
        return Math.round(terrainHeight(x, z) / VOXEL_STEP) * VOXEL_STEP;
    }

    class WorldStream {
        constructor(game) {
            this.game = game;
            this.chunks = new Map(); // "cx,cz" → { entries:[wall], meshes:[obj] }
            this._lastCX = null;
            this._lastCZ = null;
            this._initialized = false;
            this._tileGeo = null;
            this._tileMats = {};
            this._targetSky = null;
            this._targetGround = null;
            this._saved = null;
            this._skyMat = null;   // gradient sky material
            this._sun = null;      // directional sun light (+ target)
            this._sunSprite = null;// visible sun disc
            this._cloudModels = []; // loaded cloud glb templates
            this._cloudPool = [];   // live cloud instances drifting around the player
            // Held pickaxe viewmodel (parented to the camera).
            this._pickaxeVM = null;
            this._pickaxeRest = null;
            this._pickaxeLoading = false;
            // GLTF props
            this.loader = null;
            this.assetCache = new Map();
            this.assetsReady = false;
            this.modelMinY = new Map(); // path → model's lowest point (for grounding)
            // Animated, wandering animals (updated every frame).
            this.animals = [];
            this.fish = []; // swimmers in water bodies
            // Floating space station landmark.
            this._station = null;
            this._stationLoading = false;
            this._stationPhase = 0;
            this._stationWall = null;
            // Giant spawn tree with swaying vines.
            this._spawnTree = null;
            this._treeWalls = [];   // per-cube collision/mining entries
            this._vines = [];
            this._treePhase = 0;
            // Fixed Nether Portal landmark (placed near spawn). Read by the maps.
            this.netherPortal = null;
            this._portalT = 0;
            // The Nether — a self-contained overlay world reached through the portal.
            this.nether = null;            // built arena: { group, walls, spawn, fog, bg, enemies, lava, fires, embers, returnPortal }
            this._netherActive = false;
            this._netherTransitioning = false;
            this._netherReturn = null;     // saved streaming state to restore on exit
            this._netherHidden = null;     // scene children hidden while in the Nether
            this._flameTex = null;
        }

        // Terrain floor height under (x,z) — the quantized block top. Consumed
        // by game.js's floor clamp, teleport, and the world map.
        heightAt(x, z) {
            if (this._netherActive) return Math.max(netherSurfaceY(x, z), NETHER_LAVA_LEVEL);
            return surfaceY(x, z);
        }

        // Biome ground color at a world position — used to paint the world map.
        biomeColorAt(x, z) {
            return biomeAt(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)).ground;
        }

        // Sea level — consumed by game.js swim physics.
        seaLevel() { return WATER_Y; }

        // Map color at a world position — water (depth-shaded) or land surface.
        // Reflects live terrain edits via surfaceY. Used by both maps.
        mapColorAt(x, z) {
            const s = surfaceY(x, z);
            if (s < WATER_Y) {
                const f = Math.min(1, (WATER_Y - s) / WATER_MAX_DEPTH);
                return lerpHex(WATER_SHALLOW, WATER_DEEP, f);
            }
            if (s >= SNOW_LEVEL) return 0xeaf2f7;
            if (s >= SNOW_LEVEL - 6) return 0x8a8d92;
            if (s <= WATER_Y + VOXEL_STEP) return 0xd9c48f;
            return biomeAt(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)).ground;
        }

        enter() {
            const g = this.game;
            this.chunks = new Map();
            this._initialized = false;
            this._lastCX = this._lastCZ = null;

            for (const key in BIOMES) {
                if (!this._tileMats[key]) {
                    this._tileMats[key] = new THREE.MeshLambertMaterial({ color: BIOMES[key].ground });
                }
            }
            if (!this.loader) this.loader = new THREE.GLTFLoader();
            this.animals = [];
            this.fish = [];
            this._preload();
            g.owPickaxeEquipped = false;
            g.owPickaxeSwing = 0;
            this._loadPickaxe();
            this._loadClouds();
            this._loadStation();

            EDITS.clear(); // fresh terrain each session
            const spawn = this._findLandSpawn();
            g.player.position.set(spawn.x, surfaceY(spawn.x, spawn.z) + 1, spawn.z);
            if (g.player.velocity) g.player.velocity.y = 0;
            this._buildSpawnTree(spawn.x + 7, spawn.z + 5); // landmark beside spawn

            this._setupScene();
            if (g.clearEnemies) g.clearEnemies(); // before streaming so animals survive
            const portalSpot = this._netherPortalSpot(spawn);
            this._loadNetherPortal(portalSpot.x, portalSpot.z);
            this.update(0);
            if (g.applyViewModeToPlayerModel) g.applyViewModeToPlayerModel();
            if (g.updateCamera) g.updateCamera();
        }

        exit() {
            const g = this.game;
            // If we leave the mode while in the Nether, drop the overlay first.
            if (this._netherActive) {
                this._netherUnregisterEnemies();
                if (this._netherHidden) { for (const o of this._netherHidden) o.visible = true; this._netherHidden = null; }
                this._netherActive = false;
                this._netherReturn = null;
            }
            this._netherTransitioning = false;
            if (this.nether) { g.scene.remove(this.nether.group); this.nether = null; }
            for (const key of Array.from(this.chunks.keys())) this._unloadChunk(key);
            this.chunks.clear();
            this.animals = [];
            this.fish = [];
            if (this._pickaxeVM && this._pickaxeVM.parent) this._pickaxeVM.parent.remove(this._pickaxeVM);
            g.owPickaxeEquipped = false;
            g.owPickaxeSwing = 0;
            if (this.netherPortal) { g.scene.remove(this.netherPortal.group); this.netherPortal = null; }
            if (this._station && this._station.parent) g.scene.remove(this._station);
            if (this._stationWall) {
                g._removeWallFromHash(this._stationWall);
                const i = g.walls.indexOf(this._stationWall);
                if (i !== -1) g.walls.splice(i, 1);
                this._stationWall = null;
            }
            if (this._spawnTree && this._spawnTree.parent) g.scene.remove(this._spawnTree);
            this._spawnTree = null;
            this._vines = [];
            if (this._treeWalls && this._treeWalls.length) {
                const gone = new Set(this._treeWalls);
                for (const w of this._treeWalls) g._removeWallFromHash(w);
                g.walls = g.walls.filter((w) => !gone.has(w));
                this._treeWalls = [];
            }
            this._restoreScene();
        }

        update(dt) {
            const g = this.game;
            // In the Nether, the streaming overworld is paused; run its own loop.
            if (this._netherActive) { this._netherUpdate(dt || 0); return; }
            this._tickVisuals(dt || 0);
            this._updateAnimals(dt || 0);
            this._updateFish(dt || 0);
            this._updatePickaxeVM(dt || 0);
            this._updateClouds(dt || 0);
            this._updateNetherPortal(dt || 0);

            const p = g.player.position;
            const ccx = Math.floor(p.x / CHUNK_SIZE);
            const ccz = Math.floor(p.z / CHUNK_SIZE);
            if (this._initialized && ccx === this._lastCX && ccz === this._lastCZ) return;
            this._lastCX = ccx;
            this._lastCZ = ccz;
            this._initialized = true;

            // Terrain tiles render far; props/animals only within PROP_RADIUS.
            const wantTerrain = new Set();
            const wantProps = new Set();
            for (let dz = -TERRAIN_RADIUS; dz <= TERRAIN_RADIUS; dz++) {
                for (let dx = -TERRAIN_RADIUS; dx <= TERRAIN_RADIUS; dx++) {
                    const kx = ccx + dx, kz = ccz + dz;
                    const key = kx + ',' + kz;
                    wantTerrain.add(key);
                    this._ensureTerrainChunk(kx, kz);
                    if (Math.abs(dx) <= PROP_RADIUS && Math.abs(dz) <= PROP_RADIUS) {
                        wantProps.add(key);
                        this._ensureProps(kx, kz);
                    }
                }
            }
            for (const key of Array.from(this.chunks.keys())) {
                if (!wantTerrain.has(key)) {
                    this._unloadChunk(key);              // fully out of range
                } else if (!wantProps.has(key)) {
                    this._unloadProps(this.chunks.get(key)); // keep terrain, drop props
                }
            }
            this._onChunkChanged(ccx, ccz);
        }

        // ---- asset loading ----

        _allPaths() {
            const set = new Set();
            for (const k in BIOMES) {
                const b = BIOMES[k];
                b.feature.forEach((p) => set.add(p));
                b.decor.forEach((p) => set.add(p));
                b.animals.forEach((p) => set.add(p));
            }
            FISH_PATHS.forEach((p) => set.add(p));
            return Array.from(set);
        }

        _preload() {
            if (this.assetsReady) { this._rebuildLoaded(); return; }
            const paths = this._allPaths();
            Promise.all(paths.map((p) => this._loadOne(p))).then(() => {
                this.assetsReady = true;
                this._rebuildLoaded(); // re-stream now that props exist
            });
        }

        _loadOne(path) {
            return new Promise((resolve) => {
                this.loader.load(
                    path,
                    (gltf) => {
                        this.assetCache.set(path, gltf);
                        // Measure the model's lowest point so we can sit it on
                        // the ground (origins vary — rigged models often center).
                        const src = gltf.scene || (gltf.scenes && gltf.scenes[0]);
                        if (src) {
                            const box = new THREE.Box3().setFromObject(src);
                            if (isFinite(box.min.y)) this.modelMinY.set(path, box.min.y);
                        }
                        resolve();
                    },
                    undefined,
                    (err) => { console.warn('[worldstream] failed to load', path, err && err.message); resolve(); }
                );
            });
        }

        // World Y to place a prop's origin so its feet rest on the terrain.
        _groundedY(path, x, z, scale) {
            const minY = this.modelMinY.get(path) || 0;
            return surfaceY(x, z) - minY * scale;
        }

        // Rebuild every currently-loaded chunk (e.g. once assets finish loading).
        _rebuildLoaded() {
            for (const key of Array.from(this.chunks.keys())) this._unloadChunk(key);
            this._initialized = false;
            this._lastCX = this._lastCZ = null;
            this.update(0);
        }

        _cloneAsset(path) {
            const cached = this.assetCache.get(path);
            if (!cached) return null;
            const src = cached.scene || (cached.scenes && cached.scenes[0]);
            if (!src) return null;
            let skinned = false;
            src.traverse((c) => { if (c.isSkinnedMesh) skinned = true; });
            const obj = (skinned && THREE.SkeletonUtils) ? THREE.SkeletonUtils.clone(src) : src.clone(true);
            obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
            return obj;
        }

        // ---- chunk lifecycle ----

        // Ensure a chunk exists with its (cheap) terrain tile. No props yet.
        _ensureTerrainChunk(cx, cz) {
            const key = cx + ',' + cz;
            if (this.chunks.has(key)) return;
            const biome = biomeAt(cx, cz);
            const chunk = { cx, cz, biome, entries: [], meshes: [], animals: [], fish: [], tiles: [], hasProps: false };
            chunk.tiles = this._makeVoxelChunk(cx, cz, biome);
            for (const t of chunk.tiles) this.game.scene.add(t);
            this.chunks.set(key, chunk);
        }

        // Populate a nearby chunk with props/animals (once assets are ready).
        _ensureProps(cx, cz) {
            if (!this.assetsReady) return;
            const chunk = this.chunks.get(cx + ',' + cz);
            if (!chunk || chunk.hasProps) return;
            chunk.hasProps = true;
            this._populateChunk(cx, cz, chunk.biome, chunk);
        }

        // Drop a chunk's props/animals but keep its terrain tile (player walked
        // far enough that only the silhouette matters).
        _unloadProps(chunk) {
            if (!chunk || !chunk.hasProps) return;
            const g = this.game;
            const drop = new Set(chunk.entries);
            for (const e of chunk.entries) {
                g.scene.remove(e.mesh || e);
                g._removeWallFromHash(e);
            }
            for (const m of chunk.meshes) g.scene.remove(m);
            const pm = g.playMode;
            for (const a of chunk.animals) {
                if (a.obj.userData && a.obj.userData.dying) continue;
                if (pm && pm.enemies) {
                    const ei = pm.enemies.indexOf(a.obj);
                    if (ei !== -1) pm.enemies.splice(ei, 1);
                    if (pm.enemiesGroup) pm.enemiesGroup.remove(a.obj); else g.scene.remove(a.obj);
                } else { g.scene.remove(a.obj); }
                if (a.mixer) a.mixer.stopAllAction();
            }
            g.walls = g.walls.filter((w) => !drop.has(w));
            if (chunk.animals.length) {
                const gone = new Set(chunk.animals);
                this.animals = this.animals.filter((a) => !gone.has(a));
            }
            if (chunk.fish && chunk.fish.length) {
                for (const f of chunk.fish) { g.scene.remove(f.obj); if (f.mixer) f.mixer.stopAllAction(); }
                const goneF = new Set(chunk.fish);
                this.fish = this.fish.filter((f) => !goneF.has(f));
            }
            chunk.entries = [];
            chunk.meshes = [];
            chunk.animals = [];
            chunk.fish = [];
            chunk.hasProps = false;
        }

        _unloadChunk(key) {
            const chunk = this.chunks.get(key);
            if (!chunk) return;
            const g = this.game;
            this._unloadProps(chunk); // props/animals/decor
            for (const t of (chunk.tiles || [])) {
                g.scene.remove(t);
                if (t.dispose) t.dispose(); // frees instance buffers; geometry/material are shared
            }
            this.chunks.delete(key);
        }

        // Scatter biome props across the chunk interior, seeded by chunk coords.
        _populateChunk(cx, cz, biome, chunk) {
            const rng = mulberry32(chunkSeed(cx, cz));
            const baseX = cx * CHUNK_SIZE, baseZ = cz * CHUNK_SIZE;
            const m = EDGE_MARGIN * CELL;
            const inner = CHUNK_SIZE - 2 * m;
            const atOrigin = (cx === 0 && cz === 0);
            // Only place on land — at least one block above sea level so nothing
            // ends up in water or on wet shoreline. Returns null if no dry spot.
            const randLandPos = () => {
                for (let t = 0; t < 6; t++) {
                    const x = baseX + m + rng() * inner;
                    const z = baseZ + m + rng() * inner;
                    if (surfaceY(x, z) >= WATER_Y + VOXEL_STEP) return [x, z];
                }
                return null;
            };

            // Collidable features (trees, rocks).
            const nFeat = Math.round((2 + rng() * 4) * biome.density);
            for (let i = 0; i < nFeat && biome.feature.length; i++) {
                const path = biome.feature[(rng() * biome.feature.length) | 0];
                const p = randLandPos();
                if (!p) continue;
                if (atOrigin && Math.hypot(p[0], p[1]) < 5) continue; // keep spawn clear
                this._placeProp(chunk, path, p[0], p[1], rng, true);
            }

            // Walk-through decor (grass, flowers, mushrooms, bushes).
            const nDecor = Math.round((5 + rng() * 7) * Math.max(0.6, biome.density));
            for (let i = 0; i < nDecor && biome.decor.length; i++) {
                const path = biome.decor[(rng() * biome.decor.length) | 0];
                const p = randLandPos();
                if (!p) continue;
                this._placeProp(chunk, path, p[0], p[1], rng, false);
            }

            // A few animals for life. Kept sparse — each lives in the enemies
            // list (for collision/hits), so we don't want hundreds at once.
            if (biome.animals.length) {
                let n = (rng() < 0.25 * biome.density ? 1 : 0) + (rng() < 0.08 * biome.density ? 1 : 0);
                for (let i = 0; i < n; i++) {
                    const path = biome.animals[(rng() * biome.animals.length) | 0];
                    const p = randLandPos();
                    if (!p) continue;
                    if (atOrigin && Math.hypot(p[0], p[1]) < 6) continue;
                    this._spawnAnimal(chunk, path, p[0], p[1], rng);
                }
            }

            // Fish — sparse; spawn in water cells (a bit below the surface).
            const nFish = rng() < 0.45 ? 1 : 0;
            for (let i = 0; i < nFish; i++) {
                const x = baseX + m + rng() * inner;
                const z = baseZ + m + rng() * inner;
                if (surfaceY(x, z) < WATER_Y - 3) this._spawnFish(chunk, x, z, rng);
            }
        }

        // Clone a prop, place/scale/rotate it, and register collision if solid.
        _placeProp(chunk, path, x, z, rng, collide) {
            const obj = this._cloneAsset(path);
            if (!obj) return;
            const [lo, hi] = propScale(path);
            const s = lo + rng() * (hi - lo);
            obj.scale.setScalar(s);
            obj.position.set(x, this._groundedY(path, x, z, s), z);
            obj.rotation.y = rng() * Math.PI * 2;
            this.game.scene.add(obj);

            if (collide) {
                const half = propHalf(path) * (0.7 + s * 0.3);
                const entry = {
                    mesh: obj,
                    position: obj.position,
                    size: { x: half * 2, y: 6, z: half * 2 },
                    destructible: false,
                };
                this.game.walls.push(entry);
                this.game._addWallToHash(entry);
                chunk.entries.push(entry); // unload removes mesh + hash via entries
            } else {
                chunk.meshes.push(obj);
            }
        }

        // Spawn a wandering, animated animal. Plays a walk/idle clip from the
        // GLTF and registers it for per-frame wander updates.
        _spawnAnimal(chunk, path, x, z, rng) {
            const cached = this.assetCache.get(path);
            const obj = this._cloneAsset(path);
            if (!obj) return;
            const s = 1.0 + rng() * 0.4;
            obj.scale.setScalar(s);
            const offset = -(this.modelMinY.get(path) || 0) * s; // feet on ground
            obj.position.set(x, surfaceY(x, z) + offset, z);
            obj.rotation.y = rng() * Math.PI * 2;

            // Register as a passive mob so the existing enemy systems give us
            // player collision + weapon hits + kill for free. AI is skipped via
            // the isAnimal guards in game.js; WorldStream drives movement.
            obj.userData.type = 'enemy';   // findEnemyRoot() keys on this
            obj.userData.isAnimal = true;
            obj.userData.hp = 3;
            obj.userData.hpMax = 3;
            obj.userData.hitRadius = 0.5;
            obj.userData.enemyKind = 'chick'; // no loot drops
            const pm = this.game.playMode;
            if (pm && pm.enemies) {
                if (pm.enemiesGroup) pm.enemiesGroup.add(obj); else this.game.scene.add(obj);
                pm.enemies.push(obj);
            } else {
                this.game.scene.add(obj);
            }

            // Set up idle/walk animation states. Random phase + speed desync the
            // herd. If a model has both, we crossfade between them by movement;
            // if it has only one clip, we pause it when standing still so it
            // doesn't run in place.
            let mixer = null, walkAction = null, idleAction = null, soloAction = null;
            const clips = cached && cached.animations;
            const tScale = 0.85 + rng() * 0.35;
            if (clips && clips.length && THREE.AnimationMixer) {
                mixer = new THREE.AnimationMixer(obj);
                const moveClip = clips.find((c) => /walk|run|move|gallop|trot/i.test(c.name));
                const idleClip = clips.find((c) => /idle/i.test(c.name)) || clips.find((c) => /eat|graze|rest/i.test(c.name));
                if (moveClip && idleClip && moveClip !== idleClip) {
                    walkAction = mixer.clipAction(moveClip);
                    idleAction = mixer.clipAction(idleClip);
                    idleAction.time = rng() * (idleClip.duration || 1);
                    walkAction.time = rng() * (moveClip.duration || 1);
                    walkAction.timeScale = idleAction.timeScale = tScale;
                    idleAction.play();
                    walkAction.play();
                    walkAction.setEffectiveWeight(0); // start idle
                } else {
                    const clip = moveClip || idleClip || clips[0];
                    soloAction = mixer.clipAction(clip);
                    soloAction.time = rng() * (clip.duration || 1);
                    soloAction.timeScale = tScale;
                    soloAction.play();
                    soloAction.paused = true;          // frozen until it moves
                }
            }

            const agent = {
                obj, mixer, offset, walkAction, idleAction, soloAction, moving: false,
                x, z,                               // we own world position, not the clip
                home: new THREE.Vector2(x, z),
                target: new THREE.Vector2(x, z),
                t: rng() * 3,                       // time until next target
                speed: ANIMAL_SPEED * (0.7 + rng() * 0.6),
            };
            chunk.animals.push(agent);
            this.animals.push(agent);
        }

        // Step every animal: advance its animation, wander toward a target near
        // home, and pin it to the terrain each frame. We own x/z so the clip's
        // root motion can't drift or bounce the body — it only moves the legs.
        _updateAnimals(dt) {
            if (!this.animals.length) return;
            let pruned = false;
            for (const a of this.animals) {
                // Killed by the player: hand the corpse to the dying-enemy system
                // and stop driving it.
                if (a.obj.userData && a.obj.userData.dying) {
                    if (a.mixer) a.mixer.stopAllAction();
                    a._dead = true;
                    pruned = true;
                    continue;
                }
                if (a.mixer) a.mixer.update(dt);
                a.t -= dt;
                if (a.t <= 0) {
                    // Wander toward a dry spot near home; fall back to home itself.
                    let tx = a.home.x, tz = a.home.y;
                    for (let k = 0; k < 4; k++) {
                        const ang = Math.random() * Math.PI * 2;
                        const r = 2 + Math.random() * 6;
                        const nx = a.home.x + Math.cos(ang) * r, nz = a.home.y + Math.sin(ang) * r;
                        if (surfaceY(nx, nz) >= WATER_Y + VOXEL_STEP) { tx = nx; tz = nz; break; }
                    }
                    a.target.set(tx, tz);
                    a.t = 2 + Math.random() * 3;
                }
                const dx = a.target.x - a.x;
                const dz = a.target.y - a.z;
                const d = Math.hypot(dx, dz);
                const moving = d > 0.15;
                if (moving) {
                    const step = Math.min(d, a.speed * dt);
                    a.x += (dx / d) * step;
                    a.z += (dz / d) * step;
                    a.obj.rotation.y = Math.atan2(dx, dz);
                }
                // Switch idle ↔ walk on movement change so they don't run in place.
                if (moving !== a.moving) {
                    if (a.walkAction && a.idleAction) {
                        if (moving) a.walkAction.crossFadeFrom(a.idleAction, 0.25, false);
                        else a.idleAction.crossFadeFrom(a.walkAction, 0.25, false);
                    } else if (a.soloAction) {
                        a.soloAction.paused = !moving;
                    }
                    a.moving = moving;
                }
                // Always re-pin to the surface (kills float + clip-driven bounce).
                a.obj.position.set(a.x, surfaceY(a.x, a.z) + a.offset, a.z);
            }
            if (pruned) this.animals = this.animals.filter((a) => !a._dead);
        }

        // Spawn an animated fish swimming at a random depth in a water cell.
        _spawnFish(chunk, x, z, rng) {
            // Size class chooses both the model and the scale.
            const roll = rng();
            let path, len;
            if (roll < 0.6) { path = FISH_SMALL[(rng() * FISH_SMALL.length) | 0]; len = 0.9 + rng() * 1.6; }      // small
            else if (roll < 0.88) { path = FISH_SMALL[(rng() * FISH_SMALL.length) | 0]; len = 2.6 + rng() * 2.4; } // medium
            else { path = FISH_LARGE[(rng() * FISH_LARGE.length) | 0]; len = 5 + rng() * 6; }                     // large

            const cached = this.assetCache.get(path);
            const obj = this._cloneAsset(path);
            if (!obj) return;
            const box = new THREE.Box3().setFromObject(obj);
            const size = new THREE.Vector3();
            box.getSize(size);
            const maxd = Math.max(size.x, size.y, size.z) || 1;
            obj.scale.setScalar(len / maxd);

            const floor = surfaceY(x, z);
            const y = Math.min(WATER_Y - 1, floor + 1.5 + rng() * (WATER_Y - floor - 2));
            obj.position.set(x, y, z);
            this.game.scene.add(obj);

            // Real swim animation from the GLB.
            let mixer = null;
            const clips = cached && cached.animations;
            if (clips && clips.length && THREE.AnimationMixer) {
                mixer = new THREE.AnimationMixer(obj);
                const act = mixer.clipAction(clips[0]);
                act.time = rng() * (clips[0].duration || 1);  // desync
                act.timeScale = 0.8 + rng() * 0.5;
                act.play();
            }

            const agent = {
                obj, mixer, x, z, y,
                home: new THREE.Vector2(x, z),
                target: new THREE.Vector2(x, z),
                t: rng() * 3,
                phase: rng() * Math.PI * 2,
                heading: rng() * Math.PI * 2,
                speed: FISH_SPEED * (0.6 + rng() * 0.8),
            };
            chunk.fish.push(agent);
            this.fish.push(agent);
        }

        // Swim fish toward wander targets within their water body, gently bobbing.
        _updateFish(dt) {
            if (!this.fish.length) return;
            for (const f of this.fish) {
                if (f.mixer) f.mixer.update(dt);
                f.t -= dt;
                if (f.t <= 0) {
                    // Pick a nearby target that's still in water.
                    let tx = f.home.x, tz = f.home.y;
                    for (let k = 0; k < 5; k++) {
                        const ang = Math.random() * Math.PI * 2;
                        const r = 3 + Math.random() * 10;
                        const nx = f.home.x + Math.cos(ang) * r, nz = f.home.y + Math.sin(ang) * r;
                        if (surfaceY(nx, nz) < WATER_Y - 2) { tx = nx; tz = nz; break; }
                    }
                    f.target.set(tx, tz);
                    f.t = 2 + Math.random() * 3;
                }
                const dx = f.target.x - f.x, dz = f.target.y - f.z;
                const d = Math.hypot(dx, dz);
                if (d > 0.2) {
                    const step = Math.min(d, f.speed * dt);
                    f.x += (dx / d) * step;
                    f.z += (dz / d) * step;
                    f.heading = Math.atan2(dx, dz);
                }
                // Face travel direction (the GLB clip animates the body/tail).
                f.obj.rotation.y = f.heading + FISH_YAW_OFFSET;
                f.phase += dt;
                // Keep within the water column for this spot, with a gentle bob.
                const floor = surfaceY(f.x, f.z);
                let y = f.y + Math.sin(f.phase * 0.5) * 0.4;
                const minY = floor + 1.2, maxY = WATER_Y - 0.8;
                if (y < minY) y = minY;
                if (y > maxY) y = maxY;
                f.obj.position.set(f.x, y, f.z);
            }
        }

        // Shared cube geometry (vertex-shaded: bright top, darker sides) plus two
        // materials: grass-textured (for normal land) and plain color (for sand /
        // rock / snow / ocean floor). Built once; reused by every chunk.
        _ensureVoxelAssets() {
            if (this._voxelGeo) return;
            const geo = new THREE.BoxGeometry(CELL, 1, CELL); // Y scaled per instance
            const norm = geo.attributes.normal;
            const colors = new Float32Array(norm.count * 3);
            for (let i = 0; i < norm.count; i++) {
                const ny = norm.getY(i);
                const s = ny > 0.5 ? 1.0 : (ny < -0.5 ? 0.45 : 0.62); // top / bottom / sides
                colors[i * 3] = s; colors[i * 3 + 1] = s; colors[i * 3 + 2] = s;
            }
            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            this._voxelGeo = geo;

            // Procedural 16×16 pixel-art block textures (grass top, dirt, grass
            // side with a green overhang) — crisp Minecraft look, no downloads.
            const dirtTex = this._pixelTex((px, py) => {
                if (Math.random() < 0.06) return 'rgb(92,70,42)';   // pebble fleck
                const v = 1 + (Math.random() * 0.26 - 0.12);
                return `rgb(${(140 * v) | 0},${(108 * v) | 0},${(68 * v) | 0})`;
            });
            const grassTopTex = this._pixelTex((px, py) => {
                const v = 1 + (Math.random() * 0.3 - 0.14);
                return `rgb(${(92 * v) | 0},${(154 * v) | 0},${(58 * v) | 0})`;
            });
            const grassSideTex = this._pixelTex((px, py) => {
                // py=0 is the image top → cube top (CanvasTexture flipY default).
                const band = 3 + ((px * 7 + 3) % 3); // wavy grass overhang edge
                if (py < band) {
                    const v = 1 + (Math.random() * 0.3 - 0.14);
                    return `rgb(${(90 * v) | 0},${(150 * v) | 0},${(56 * v) | 0})`;
                }
                if (Math.random() < 0.06) return 'rgb(92,70,42)';
                const v = 1 + (Math.random() * 0.26 - 0.12);
                return `rgb(${(140 * v) | 0},${(108 * v) | 0},${(68 * v) | 0})`;
            });
            const M = (t) => new THREE.MeshLambertMaterial({ map: t });
            const dirtMat = M(dirtTex), topMat = M(grassTopTex), sideMat = M(grassSideTex);
            // BoxGeometry group order: +x,-x,+y(top),-y(bottom),+z,-z.
            this._voxelMatGrass = [sideMat, sideMat, topMat, dirtMat, sideMat, sideMat];

            // Sand — soft tan with fine speckle; vertexColors on for top/side shading.
            const sandTex = this._pixelTex((px, py) => {
                if (Math.random() < 0.04) return 'rgb(200,182,132)';   // lighter grain
                const v = 1 + (Math.random() * 0.12 - 0.06);
                return `rgb(${(222 * v) | 0},${(202 * v) | 0},${(150 * v) | 0})`;
            });
            this._voxelMatSand = new THREE.MeshLambertMaterial({ map: sandTex, vertexColors: true });

            this._voxelMatPlain = new THREE.MeshLambertMaterial({ vertexColors: true });
            this._voxM = new THREE.Matrix4();
            this._voxC = new THREE.Color();
        }

        // 16×16 nearest-filtered texture from a per-pixel color function.
        _pixelTex(fn) {
            const c = document.createElement('canvas');
            c.width = c.height = 16;
            const x = c.getContext('2d');
            for (let py = 0; py < 16; py++) {
                for (let px = 0; px < 16; px++) {
                    const col = fn(px, py);
                    if (!col) continue;            // null → leave transparent (cutout)
                    x.fillStyle = col;
                    x.fillRect(px, py, 1, 1);
                }
            }
            const t = new THREE.CanvasTexture(c);
            t.magFilter = THREE.NearestFilter;
            t.minFilter = THREE.NearestFilter;
            if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
            return t;
        }

        // Build an InstancedMesh from a list of {x,cy,z,h,hex}. count is exact so
        // no stray instances render at the origin.
        _buildInstMesh(list, mat) {
            if (!list.length) return null;
            const mesh = new THREE.InstancedMesh(this._voxelGeo, mat, list.length);
            mesh.receiveShadow = true;
            const m = this._voxM, c = this._voxC;
            for (let i = 0; i < list.length; i++) {
                const it = list[i];
                m.makeScale(1, it.h, 1);
                m.setPosition(it.x, it.cy, it.z);
                mesh.setMatrixAt(i, m);
                c.setHex(it.hex);
                mesh.setColorAt(i, c);
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            return mesh;
        }

        // Up to two InstancedMeshes per chunk (grass-textured land + plain special
        // surfaces). Each column's cube top sits at the quantized surface and
        // extends down to its lowest neighbour so cliffs have no gaps.
        _makeVoxelChunk(cx, cz, biome) {
            this._ensureVoxelAssets();
            const grass = [], sand = [], plain = [];
            for (let r = 0; r < CHUNK_CELLS; r++) {
                for (let c = 0; c < CHUNK_CELLS; c++) {
                    const wx = (cx * CHUNK_CELLS + c) * CELL;
                    const wz = (cz * CHUNK_CELLS + r) * CELL;
                    const top = surfaceY(wx, wz);
                    const minN = Math.min(
                        surfaceY(wx + CELL, wz), surfaceY(wx - CELL, wz),
                        surfaceY(wx, wz + CELL), surfaceY(wx, wz - CELL)
                    );
                    let blockH = top - minN + VOXEL_STEP;
                    if (blockH < VOXEL_STEP) blockH = VOXEL_STEP;
                    if (blockH > VOXEL_MAX_H) blockH = VOXEL_MAX_H;
                    const inst = { x: wx, cy: top - blockH / 2, z: wz, h: blockH, hex: 0xffffff };
                    if (top >= SNOW_LEVEL) { inst.hex = 0xeaf2f7; plain.push(inst); }            // snow
                    else if (top >= SNOW_LEVEL - 6) { inst.hex = 0x8a8d92; plain.push(inst); }   // rock
                    else if (top <= WATER_Y - 8) { inst.hex = 0x5a4a30; plain.push(inst); }      // ocean floor
                    else if (top <= WATER_Y + VOXEL_STEP) { sand.push(inst); }                  // beach/shallows — sand-textured
                    else { grass.push(inst); }                                                  // grass-textured land
                }
            }
            const meshes = [];
            const gm = this._buildInstMesh(grass, this._voxelMatGrass);
            const sm = this._buildInstMesh(sand, this._voxelMatSand);
            const pm = this._buildInstMesh(plain, this._voxelMatPlain);
            if (gm) meshes.push(gm);
            if (sm) meshes.push(sm);
            if (pm) meshes.push(pm);
            return meshes;
        }

        // Rebuild one loaded chunk's voxel mesh (after an edit).
        _rebuildChunkTerrain(cx, cz) {
            const chunk = this.chunks.get(cx + ',' + cz);
            if (!chunk) return;
            for (const t of (chunk.tiles || [])) {
                this.game.scene.remove(t);
                if (t.dispose) t.dispose();
            }
            chunk.tiles = this._makeVoxelChunk(cx, cz, chunk.biome);
            for (const t of chunk.tiles) this.game.scene.add(t);
        }

        // March the camera ray onto the voxel surface; returns the hit cell or null.
        raycastGround(origin, dir, maxReach) {
            const step = 0.25;
            for (let t = step; t <= maxReach; t += step) {
                const x = origin.x + dir.x * t;
                const y = origin.y + dir.y * t;
                const z = origin.z + dir.z * t;
                if (y <= surfaceY(x, z)) {
                    return { x, z, dist: t, cellX: Math.round(x / CELL), cellZ: Math.round(z / CELL) };
                }
            }
            return null;
        }

        // Dig one block off the targeted ground cell and rebuild affected chunks.
        digCell(cellX, cellZ) {
            const k = cellX + ',' + cellZ;
            const wx = cellX * CELL, wz = cellZ * CELL;
            const cur = EDITS.has(k) ? EDITS.get(k) : Math.round(terrainHeight(wx, wz) / VOXEL_STEP) * VOXEL_STEP;
            if (cur <= DIG_FLOOR) return false;
            EDITS.set(k, cur - VOXEL_STEP);
            // Rebuild the owning chunk plus neighbours (cliff fill reads neighbours).
            const ccx = Math.floor(cellX / CHUNK_CELLS), ccz = Math.floor(cellZ / CHUNK_CELLS);
            this._rebuildChunkTerrain(ccx, ccz);
            this._rebuildChunkTerrain(ccx + 1, ccz);
            this._rebuildChunkTerrain(ccx - 1, ccz);
            this._rebuildChunkTerrain(ccx, ccz + 1);
            this._rebuildChunkTerrain(ccx, ccz - 1);
            return true;
        }

        // First spot at/near the origin whose surface is above sea level.
        _findLandSpawn() {
            if (surfaceY(0, 0) > WATER_Y) return { x: 0, z: 0 };
            for (let r = CELL; r <= 600; r += CELL * 3) {
                for (let a = 0; a < 12; a++) {
                    const ang = (a / 12) * Math.PI * 2;
                    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
                    if (surfaceY(x, z) > WATER_Y) return { x, z };
                }
            }
            return { x: 0, z: 0 };
        }

        // ---- scene look (sky / fog / base plane) ----

        // Soft radial glow for the sun disc.
        _makeSunTexture() {
            const c = document.createElement('canvas');
            c.width = c.height = 128;
            const x = c.getContext('2d');
            const grad = x.createRadialGradient(64, 64, 0, 64, 64, 64);
            grad.addColorStop(0.0, 'rgba(255,251,235,1)');
            grad.addColorStop(0.22, 'rgba(255,245,205,0.95)');
            grad.addColorStop(0.55, 'rgba(255,231,150,0.35)');
            grad.addColorStop(1.0, 'rgba(255,221,120,0)');
            x.fillStyle = grad;
            x.fillRect(0, 0, 128, 128);
            return new THREE.CanvasTexture(c);
        }

        // Load the cloud models once, then scatter the drifting pool.
        _loadClouds() {
            if (this._cloudModels.length) { this._buildCloudPool(); return; }
            if (this._cloudsLoading || !this.loader) return;
            this._cloudsLoading = true;
            Promise.all(CLOUD_PATHS.map((p) => new Promise((res) => {
                this.loader.load(p, (gltf) => {
                    const src = gltf.scene || (gltf.scenes && gltf.scenes[0]);
                    if (src) this._cloudModels.push(src);
                    res();
                }, undefined, (err) => { console.warn('[worldstream] cloud load failed', p, err && err.message); res(); });
            }))).then(() => { this._cloudsLoading = false; this._buildCloudPool(); });
        }

        _buildCloudPool() {
            if (!this._cloudModels.length || this._cloudPool.length) return;
            const g = this.game;
            const px = g.player ? g.player.position.x : 0;
            const pz = g.player ? g.player.position.z : 0;
            for (let i = 0; i < CLOUD_COUNT; i++) {
                const src = this._cloudModels[i % this._cloudModels.length];
                const obj = src.clone(true);
                obj.traverse((o) => {
                    if (o.isMesh) {
                        o.castShadow = o.receiveShadow = false;
                        if (o.material) {
                            o.material = o.material.clone();
                            o.material.fog = false;
                            o.material.transparent = true;
                            o.material.opacity = 0.92;
                            if (o.material.color) o.material.color.setHex(0xffffff);
                            if (o.material.emissive) o.material.emissive.setHex(0x20303f);
                        }
                    }
                });
                const box = new THREE.Box3().setFromObject(src);
                const size = new THREE.Vector3();
                box.getSize(size);
                const maxd = Math.max(size.x, size.y, size.z) || 1;
                obj.scale.setScalar((34 + Math.random() * 46) / maxd); // ~34–80u wide
                obj.rotation.y = Math.random() * Math.PI * 2;
                obj.position.set(
                    px + (Math.random() - 0.5) * CLOUD_FIELD,
                    CLOUD_Y_MIN + Math.random() * (CLOUD_Y_MAX - CLOUD_Y_MIN),
                    pz + (Math.random() - 0.5) * CLOUD_FIELD
                );
                g.scene.add(obj);
                this._cloudPool.push(obj);
            }
        }

        // Drift on the wind; wrap toroidally around the player so the field
        // always surrounds them in the infinite world.
        _updateClouds(dt) {
            if (!this._cloudPool.length) return;
            const p = this.game.player && this.game.player.position;
            if (!p) return;
            const half = CLOUD_FIELD / 2;
            for (const c of this._cloudPool) {
                c.position.x += CLOUD_WIND * dt;
                const dx = c.position.x - p.x;
                if (dx > half) c.position.x -= CLOUD_FIELD; else if (dx < -half) c.position.x += CLOUD_FIELD;
                const dz = c.position.z - p.z;
                if (dz > half) c.position.z -= CLOUD_FIELD; else if (dz < -half) c.position.z += CLOUD_FIELD;
            }
        }

        _clearClouds() {
            for (const c of this._cloudPool) this.game.scene.remove(c);
            this._cloudPool = [];
        }

        // A giant Minecraft-style tree at spawn: blocky tiered wood trunk, a wide
        // flat leaf canopy, and leaf-cube curtains draping down (jungle vibes).
        // Built entirely from 1×1 cubes via two InstancedMeshes (wood + leaves).
        _buildSpawnTree(x, z) {
            if (this._spawnTree) return;
            this._ensureVoxelAssets(); // need the shared 1×1 cube geometry
            const g = this.game;
            x = Math.round(x); z = Math.round(z);
            const baseY = surfaceY(x, z);

            if (!this._treeWoodMats) {
                // One varied bark texture: per-column tone, random grooves, knots,
                // and a randomized base hue so the 4 variants differ.
                const makeBark = () => {
                    const colShade = [];
                    for (let cx = 0; cx < 16; cx++) colShade[cx] = 0.84 + Math.random() * 0.26;
                    const grooves = 3 + (Math.random() * 3 | 0);
                    for (let gi = 0; gi < grooves; gi++) {
                        const c = Math.random() * 16 | 0, w = 1 + (Math.random() * 2 | 0);
                        for (let k = 0; k < w; k++) colShade[(c + k) % 16] *= 0.6 + Math.random() * 0.2;
                    }
                    const knots = [];
                    for (let ki = 0; ki < 3; ki++) {
                        if (Math.random() < 0.7) knots.push({ x: 2 + (Math.random() * 12 | 0), y: 2 + (Math.random() * 12 | 0), r: 1 + Math.random() * 1.6 });
                    }
                    const hr = 110 + (Math.random() * 34 | 0), hg = 78 + (Math.random() * 26 | 0), hb = 46 + (Math.random() * 22 | 0);
                    return this._pixelTex((px, py) => {
                        let s = colShade[px] * (1 + (Math.random() * 0.18 - 0.09));
                        if (py % 8 === (Math.random() < 0.5 ? 0 : 4)) s *= 0.9; // faint horizontal cracks
                        for (const k of knots) {
                            const d = Math.hypot(px - k.x, py - k.y);
                            if (d < k.r) s *= 0.5; else if (d < k.r + 1) s *= 0.76;
                        }
                        return `rgb(${Math.min(255, hr * s | 0)},${Math.min(255, hg * s | 0)},${Math.min(255, hb * s | 0)})`;
                    });
                };
                // Log end-grain: concentric rings on the cut faces (top/bottom).
                const makeRings = () => {
                    const hr = 150 + (Math.random() * 20 | 0), hg = 108 + (Math.random() * 16 | 0), hb = 64 + (Math.random() * 14 | 0);
                    return this._pixelTex((px, py) => {
                        const d = Math.hypot(px - 7.5, py - 7.5);
                        const ring = Math.sin(d * 1.7) * 0.5 + 0.5;
                        const s = (0.72 + 0.28 * ring) * (1 + (Math.random() * 0.1 - 0.05));
                        return `rgb(${(hr * s) | 0},${(hg * s) | 0},${(hb * s) | 0})`;
                    });
                };
                // Each variant is a per-face log material: bark sides + ring ends.
                // Group order: +x,-x,+y(top),-y(bottom),+z,-z.
                this._treeWoodMats = [0, 1, 2, 3].map(() => {
                    const bark = new THREE.MeshLambertMaterial({ map: makeBark() });
                    const ring = new THREE.MeshLambertMaterial({ map: makeRings() });
                    return [bark, bark, ring, ring, bark, bark];
                });
                // Cutout leaves — ~22% transparent pixels so the canopy is lacey
                // and you see sky/leaves through it (the Minecraft leaf look).
                const leafTex = this._pixelTex(() => {
                    if (Math.random() < 0.4) return null;             // transparent hole (lacier)
                    if (Math.random() < 0.14) return 'rgb(26,70,26)'; // dark leaf
                    const v = 1 + (Math.random() * 0.34 - 0.16);
                    return `rgb(${(46 * v) | 0},${(126 * v) | 0},${(44 * v) | 0})`;
                });
                this._treeLeafMat = new THREE.MeshLambertMaterial({
                    map: leafTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide,
                });
                this._treeFlowerMat = new THREE.MeshLambertMaterial({ color: 0xd86fce });
            }

            const rng = mulberry32(20260605);   // stable but irregular
            const wood = [], leaves = [];
            const occ = new Set();              // dedupe overlapping cubes
            const put = (arr, cx, cy, cz) => {
                const k = cx + ',' + cy + ',' + cz;
                if (occ.has(k)) return;
                occ.add(k);
                arr.push([x + cx, baseY + 0.5 + cy, z + cz]);
            };
            // Gentle trunk lean so it isn't a straight pillar.
            const cxAt = (yy) => Math.sin(yy * 0.22) * 1.7;
            const czAt = (yy) => Math.cos(yy * 0.17 + 1.3) * 1.2;

            // Round, jittered, leaning trunk with a ragged edge.
            const TH = 18;
            for (let yy = 0; yy < TH; yy++) {
                const t = yy / TH;
                const r = 4.2 * (1 - t) + 1.6 * t + (rng() - 0.5) * 0.5;
                const ox = cxAt(yy), oz = czAt(yy);
                const R = Math.ceil(r) + 1;
                for (let dx = -R; dx <= R; dx++) {
                    for (let dz = -R; dz <= R; dz++) {
                        const ddx = dx - ox, ddz = dz - oz, d2 = ddx * ddx + ddz * ddz;
                        const rr = r + Math.sin(Math.atan2(ddz, ddx) * 3 + yy * 0.5) * 0.4;
                        if (d2 > rr * rr) continue;
                        if (d2 > (rr - 1) * (rr - 1) && rng() < 0.35) continue; // ragged bark edge
                        put(wood, dx, yy, dz);
                    }
                }
            }
            // Buttress roots flaring out at the base.
            for (let i = 0; i < 5; i++) {
                const a = rng() * Math.PI * 2, len = 2 + (rng() * 3 | 0);
                for (let k = 0; k < len; k++) {
                    const rr = 3 + k;
                    const rx = Math.round(Math.cos(a) * rr), rz = Math.round(Math.sin(a) * rr);
                    for (let yy = 0; yy <= Math.max(0, 2 - k); yy++) put(wood, rx, yy, rz);
                }
            }

            // Bulbous leaf clumps held up by branches (jungle-tree silhouette).
            const topX = cxAt(TH - 1), topZ = czAt(TH - 1);
            const cy0 = TH;
            const clumps = [{ cx: topX, cy: cy0 + 4, cz: topZ, r: 5 }];
            const NC = 6 + (rng() * 3 | 0);
            for (let i = 0; i < NC; i++) {
                const a = (i / NC) * Math.PI * 2 + (rng() - 0.5) * 0.7;
                const rad = 4 + rng() * 6;
                clumps.push({ cx: topX + Math.cos(a) * rad, cy: cy0 + 1 + (rng() * 5 | 0), cz: topZ + Math.sin(a) * rad, r: 3 + rng() * 2 });
            }
            // Wood branches from the trunk top out to each clump.
            for (const cl of clumps) {
                const sx = topX, sy = TH - 2, sz = topZ;
                const ex = cl.cx, ey = cl.cy - 1, ez = cl.cz;
                const steps = Math.max(2, Math.round(Math.hypot(ex - sx, ey - sy, ez - sz)));
                for (let t = 0; t <= steps; t++) {
                    const f = t / steps;
                    put(wood, Math.round(sx + (ex - sx) * f), Math.round(sy + (ey - sy) * f), Math.round(sz + (ez - sz) * f));
                }
            }
            // Leaf clumps (ragged spheres); record bottom cells as vine anchors.
            const flowers = [];
            const edge = [];
            for (const cl of clumps) {
                const R = Math.ceil(cl.r) + 1;
                for (let dx = -R; dx <= R; dx++) {
                    for (let dy = -R; dy <= R; dy++) {
                        for (let dz = -R; dz <= R; dz++) {
                            const d2 = dx * dx + dy * dy + dz * dz;
                            if (d2 > cl.r * cl.r) continue;
                            if (d2 > (cl.r - 1) * (cl.r - 1) && rng() < 0.45) continue; // ragged
                            const gx = Math.round(cl.cx) + dx, gy = Math.round(cl.cy) + dy, gz = Math.round(cl.cz) + dz;
                            put(leaves, gx, gy, gz);
                            if (dy <= -Math.floor(cl.r - 1)) edge.push([gx, gz, gy]); // bottom rim
                        }
                    }
                }
                // A pink flower or two perched on top of the clump.
                if (rng() < 0.7) flowers.push([x + Math.round(cl.cx), baseY + 0.5 + Math.round(cl.cy + cl.r - 0.5), z + Math.round(cl.cz)]);
            }
            // Solid leaf-curtain vines hanging from clump bottoms.
            for (const [gx, gz, gy] of edge) {
                if (rng() < 0.5) {
                    const len = 4 + (rng() * 12 | 0);
                    for (let k = 1; k <= len; k++) put(leaves, gx, gy - k, gz);
                }
            }

            this._treeWalls = [];
            // Register a per-cube collision/mining entry that points back at its
            // InstancedMesh slot, so a single hit hides just that block.
            const regWall = (im, ii, wx, wy, wz) => {
                const we = {
                    position: new THREE.Vector3(wx, wy, wz),
                    size: { x: 1, y: 1, z: 1 },
                    im, ii, voxelTree: true, destructible: true,
                };
                g.walls.push(we);
                g._addWallToHash(we);
                this._treeWalls.push(we);
            };

            // Position-only instanced mesh with per-cube tone jitter (leaves).
            const mkInst = (positions, mat, jit) => {
                const im = new THREE.InstancedMesh(this._voxelGeo, mat, positions.length);
                im.receiveShadow = true;
                const m = new THREE.Matrix4(), c = new THREE.Color();
                for (let i = 0; i < positions.length; i++) {
                    m.makeTranslation(positions[i][0], positions[i][1], positions[i][2]);
                    im.setMatrixAt(i, m);
                    if (jit) { const b = 1 - jit + rng() * jit * 2; c.setRGB(b, b, b); im.setColorAt(i, c); }
                    regWall(im, i, positions[i][0], positions[i][1], positions[i][2]);
                }
                im.instanceMatrix.needsUpdate = true;
                if (im.instanceColor) im.instanceColor.needsUpdate = true;
                return im;
            };
            // Rotated instanced mesh (wood): random 90° orientation per cube.
            const mkRot = (items, mat) => {
                const im = new THREE.InstancedMesh(this._voxelGeo, mat, items.length);
                im.receiveShadow = true;
                const m = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion();
                const p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
                for (let i = 0; i < items.length; i++) {
                    const it = items[i];
                    e.set(it.rx, it.ry, it.rz);
                    q.setFromEuler(e);
                    p.set(it.x, it.y, it.z);
                    m.compose(p, q, s);
                    im.setMatrixAt(i, m);
                    const b = 0.88 + rng() * 0.2;
                    c.setRGB(b, b, b);
                    im.setColorAt(i, c);
                    regWall(im, i, it.x, it.y, it.z);
                }
                im.instanceMatrix.needsUpdate = true;
                if (im.instanceColor) im.instanceColor.needsUpdate = true;
                return im;
            };

            const group = new THREE.Group();
            // Wood: split across the 4 bark variants, each cube randomly oriented.
            const HALF = Math.PI / 2;
            const buckets = this._treeWoodMats.map(() => []);
            for (const wp of wood) {
                buckets[rng() * this._treeWoodMats.length | 0].push({
                    x: wp[0], y: wp[1], z: wp[2],
                    // Yaw only — keeps bark grain upright and the rings on top.
                    rx: 0, ry: (rng() * 4 | 0) * HALF, rz: 0,
                });
            }
            for (let v = 0; v < buckets.length; v++) {
                if (buckets[v].length) group.add(mkRot(buckets[v], this._treeWoodMats[v]));
            }
            group.add(mkInst(leaves, this._treeLeafMat, 0.12));
            if (flowers.length) group.add(mkInst(flowers, this._treeFlowerMat, 0.1));
            g.scene.add(group);
            this._spawnTree = group;
            this._vines = []; // canopy/vines are static blocks now
        }

        // Hide one tree cube (used when a block is mined) and drop its entry.
        mineTreeCube(we) {
            if (!we || !we.im) return;
            const m = new THREE.Matrix4().makeScale(0, 0, 0); // collapse the instance
            we.im.setMatrixAt(we.ii, m);
            we.im.instanceMatrix.needsUpdate = true;
            this.game._removeWallFromHash(we);
            const i = this.game.walls.indexOf(we);
            if (i !== -1) this.game.walls.splice(i, 1);
            const ti = this._treeWalls.indexOf(we);
            if (ti !== -1) this._treeWalls.splice(ti, 1);
        }

        // Floating space station above the world center (load once, reuse).
        _loadStation() {
            if (this._station) { this.game.scene.add(this._station); return; }
            if (this._stationLoading || !this.loader) return;
            this._stationLoading = true;
            this.loader.load(STATION_PATH, (gltf) => {
                this._stationLoading = false;
                const obj = gltf.scene || (gltf.scenes && gltf.scenes[0]);
                if (!obj) return;
                const box = new THREE.Box3().setFromObject(obj);
                const size = new THREE.Vector3();
                box.getSize(size);
                const maxd = Math.max(size.x, size.y, size.z) || 1;
                obj.scale.setScalar(STATION_SIZE / maxd);
                obj.position.set(0, STATION_Y, 0);
                // Apply the palette texture (256×1 strip the model's UVs index into).
                const tex = new THREE.TextureLoader().load(STATION_PATH.replace('.glb', '.png'));
                tex.flipY = false;
                tex.magFilter = THREE.NearestFilter;
                tex.minFilter = THREE.NearestFilter;
                if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
                obj.traverse((o) => {
                    if (o.isMesh && o.material) {
                        o.castShadow = o.receiveShadow = false;
                        o.material.map = tex;
                        if (o.material.color) o.material.color.setHex(0xffffff);
                        o.material.needsUpdate = true;
                    }
                });
                this._station = obj;
                this.game.scene.add(obj);

                // Collision: a square-footprint AABB (so the spin doesn't change
                // coverage) you can land on and not fly through.
                const wb = new THREE.Box3().setFromObject(obj);
                const c = new THREE.Vector3();
                wb.getCenter(c);
                const half = Math.max((wb.max.x - wb.min.x) / 2, (wb.max.z - wb.min.z) / 2);
                const entry = {
                    position: c.clone(),
                    size: { x: half * 2, y: wb.max.y - wb.min.y, z: half * 2 },
                    destructible: false, station: true,
                };
                this.game.walls.push(entry);
                this.game._addWallToHash(entry);
                this._stationWall = entry;
            }, undefined, (err) => { this._stationLoading = false; console.warn('[worldstream] station load failed', err && err.message); });
        }

        // Load the held pickaxe model once and parent its pivot to the camera.
        _loadPickaxe() {
            if (this._pickaxeVM) {                 // already built — just re-attach
                if (this.game.camera && this._pickaxeVM.parent !== this.game.camera) {
                    this.game.camera.add(this._pickaxeVM);
                }
                return;
            }
            if (this._pickaxeLoading || !this.loader) return;
            this._pickaxeLoading = true;
            this.loader.load('assets/Blocks/tools/Stylized_Pickaxe.glb', (gltf) => {
                this._pickaxeLoading = false;
                const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
                if (!model) return;
                model.traverse((o) => {
                    if (o.isMesh) {
                        o.castShadow = o.receiveShadow = false;
                        o.renderOrder = 20;          // draw on top of the world
                        if (o.material) { o.material.fog = false; o.material.depthTest = false; }
                    }
                });
                // Normalize to a sensible viewmodel size regardless of native scale.
                const box = new THREE.Box3().setFromObject(model);
                const size = new THREE.Vector3();
                box.getSize(size);
                const maxd = Math.max(size.x, size.y, size.z) || 1;
                model.scale.setScalar(0.6 / maxd);

                const pivot = new THREE.Group();
                pivot.add(model);
                pivot.position.set(0.38, -0.42, -0.8); // bottom-right of view
                pivot.rotation.set(0.2, -0.5, 0.3);
                pivot.visible = false;
                this._pickaxeVM = pivot;
                this._pickaxeRest = { pos: pivot.position.clone(), rotX: pivot.rotation.x };
                if (this.game.camera) this.game.camera.add(pivot);
            }, undefined, (err) => {
                this._pickaxeLoading = false;
                console.warn('[worldstream] pickaxe load failed', err && err.message);
            });
        }

        // Show/hide the pickaxe and play its chop swing when mining.
        _updatePickaxeVM(dt) {
            const g = this.game;
            const vm = this._pickaxeVM;
            if (!vm || !this._pickaxeRest) return;
            const show = g.owPickaxeEquipped && g.viewMode === 'fpv';
            vm.visible = show;
            if (!show) return;
            if (g.owPickaxeSwing > 0) {
                g.owPickaxeSwing = Math.max(0, g.owPickaxeSwing - dt * 4); // ~0.25s chop
                const swing = Math.sin((1 - g.owPickaxeSwing) * Math.PI); // 0→1→0
                vm.rotation.x = this._pickaxeRest.rotX - swing * 1.1;
                vm.position.y = this._pickaxeRest.pos.y - swing * 0.05;
            } else {
                vm.rotation.x = this._pickaxeRest.rotX;
                vm.position.y = this._pickaxeRest.pos.y;
            }
        }

        // ---- Nether Portal landmark ----

        // Pick a dry spot a few steps from spawn for the portal.
        _netherPortalSpot(spawn) {
            const cand = [[8, 0], [0, 8], [-8, 0], [0, -8], [10, 10], [-10, -10], [12, 0], [0, 12]];
            for (const [ox, oz] of cand) {
                const x = spawn.x + ox, z = spawn.z + oz;
                if (surfaceY(x, z) >= WATER_Y + VOXEL_STEP) return { x, z };
            }
            return { x: spawn.x + 8, z: spawn.z };
        }

        // Load the portal GLB once (cached), then place it.
        _loadNetherPortal(x, z) {
            if (this.assetCache.has(NETHER_PORTAL_PATH)) { this._placeNetherPortal(x, z); return; }
            if (!this.loader) return;
            this.loader.load(NETHER_PORTAL_PATH, (gltf) => {
                this.assetCache.set(NETHER_PORTAL_PATH, gltf);
                const src = gltf.scene || (gltf.scenes && gltf.scenes[0]);
                if (src) {
                    const b = new THREE.Box3().setFromObject(src);
                    if (isFinite(b.min.y)) this.modelMinY.set(NETHER_PORTAL_PATH, b.min.y);
                }
                this._placeNetherPortal(x, z);
            }, undefined, (err) => console.warn('[worldstream] nether portal load failed', err && err.message));
        }

        // Build the obsidian frame + swirl pane + light at (x,z), grounded on the
        // terrain and facing the player's spawn. Only one portal exists at a time.
        _placeNetherPortal(x, z) {
            if (this.netherPortal) return;
            const model = this._cloneAsset(NETHER_PORTAL_PATH);
            if (!model) return;

            // Scale to a ~7u doorway and drop its base onto the terrain.
            let box = new THREE.Box3().setFromObject(model);
            let size = box.getSize(new THREE.Vector3());
            const s = 7 / (size.y || 1);
            model.scale.setScalar(s);
            box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            model.position.x -= center.x;
            model.position.z -= center.z;
            model.position.y -= box.min.y;

            // Recolor obsidian; hide the model's flat pane (our swirl replaces it).
            let pane = null;
            model.traverse((o) => {
                if (!o.isMesh) return;
                if (/Plane002/i.test(o.name || '')) { pane = o; o.visible = false; return; }
                o.material = new THREE.MeshStandardMaterial({
                    color: 0x14101c, roughness: 0.75, metalness: 0.15, emissive: 0x10001a
                });
                o.castShadow = true; o.receiveShadow = true;
            });

            const group = new THREE.Group();
            group.add(model);
            group.updateMatrixWorld(true);

            let openCenter, openW, openH;
            if (pane) {
                const pbox = new THREE.Box3().setFromObject(pane);
                openCenter = pbox.getCenter(new THREE.Vector3());
                const psize = pbox.getSize(new THREE.Vector3());
                openW = Math.max(psize.z, psize.x) * 0.92;
                openH = psize.y * 0.92;
            } else {
                openCenter = new THREE.Vector3(0, 3.2, 0);
                openW = 3; openH = 3.6;
            }

            const colorObj = new THREE.Color(0x9b30ff);
            const mat = new THREE.ShaderMaterial({
                uniforms: { uTime: { value: 0 }, uColor: { value: colorObj } },
                vertexShader: PORTAL_VS, fragmentShader: PORTAL_FS,
                transparent: true, side: THREE.DoubleSide, depthWrite: false
            });
            const swirl = new THREE.Mesh(new THREE.PlaneGeometry(openW, openH), mat);
            swirl.position.copy(openCenter);
            swirl.rotation.y = Math.PI / 2; // opening normal is local +X
            group.add(swirl);

            const light = new THREE.PointLight(colorObj, 1.8, 14);
            light.position.copy(openCenter);
            group.add(light);

            // Face the opening toward spawn (origin-ish), purely cosmetic.
            const yaw = Math.atan2(-z, -x);
            group.position.set(x, surfaceY(x, z), z);
            group.rotation.y = yaw;
            this.game.scene.add(group);

            group.updateMatrixWorld(true);
            const triggerPos = swirl.getWorldPosition(new THREE.Vector3());

            this.netherPortal = { group, swirl, material: mat, light, x, z, triggerPos, inside: false };
        }

        // Animate the swirl/light and message the player when they step inside.
        _updateNetherPortal(dt) {
            const np = this.netherPortal;
            if (!np) return;
            this._portalT += dt;
            np.material.uniforms.uTime.value = this._portalT;
            np.light.intensity = 1.6 * (1 + Math.sin(this._portalT * 4) * 0.15);

            const p = this.game.player.position, tp = np.triggerPos;
            const dx = p.x - tp.x, dz = p.z - tp.z;
            const inside = (dx * dx + dz * dz) < 4 && Math.abs(p.y - tp.y) < 4;
            if (inside && !np.inside && !this._netherTransitioning) {
                this._netherEnter();
            }
            np.inside = inside;
        }

        // ---- The Nether (overlay world reached through the portal) ----

        _netherLoad() {
            return Promise.all(NETHER_PATHS.map((p) =>
                this.assetCache.has(p) ? Promise.resolve() : this._loadOne(p)));
        }

        _netherEnter() {
            const g = this.game;
            if (this._netherActive || this._netherTransitioning) return;
            this._netherTransitioning = true;
            const fade = document.getElementById('portal-fade');
            if (fade) fade.classList.add('show');
            this._netherLoad().then(() => {
                setTimeout(() => {
                    if (!this.nether) this._netherBuild();
                    const n = this.nether;
                    // Save overworld state.
                    this._netherReturn = {
                        pos: g.player.position.clone(),
                        walls: g.walls, fog: g.scene.fog, bg: g.scene.background,
                    };
                    // Hide every overworld scene object (chunks, water, sky, sun, clouds, portal).
                    this._netherHidden = [];
                    for (const o of g.scene.children) {
                        if (o === n.group || o === g.camera || !o.visible) continue;
                        o.visible = false;
                        this._netherHidden.push(o);
                    }
                    n.group.visible = true;
                    this._netherActive = true;
                    g.walls = n.walls;
                    g.scene.fog = n.fog;
                    g.scene.background = n.bg;
                    g.player.position.copy(n.spawn);
                    if (g.player.velocity) g.player.velocity.set(0, 0, 0);
                    g.player.onGround = true;
                    g.owPickaxeEquipped = false;
                    this._netherRegisterEnemies();
                    if (n.returnPortal) n.returnPortal.inside = true; // don't bounce straight back
                    if (g.showMessage) g.showMessage('You step into the Nether…', 2200);
                    if (g.updateCamera) g.updateCamera();
                    setTimeout(() => { if (fade) fade.classList.remove('show'); this._netherTransitioning = false; }, 160);
                }, 200);
            });
        }

        _netherExit() {
            const g = this.game;
            if (!this._netherActive || this._netherTransitioning) return;
            this._netherTransitioning = true;
            const fade = document.getElementById('portal-fade');
            if (fade) fade.classList.add('show');
            setTimeout(() => {
                this._netherUnregisterEnemies();
                if (this.nether) this.nether.group.visible = false;
                if (this._netherHidden) {
                    for (const o of this._netherHidden) o.visible = true;
                    this._netherHidden = null;
                }
                const s = this._netherReturn;
                if (s) {
                    g.walls = s.walls; g.scene.fog = s.fog; g.scene.background = s.bg;
                    g.player.position.copy(s.pos);
                    if (g.player.velocity) g.player.velocity.set(0, 0, 0);
                    g.player.onGround = true;
                }
                this._netherActive = false;
                this._netherReturn = null;
                if (this.netherPortal) this.netherPortal.inside = true; // we land on the overworld portal
                this._initialized = false; this._lastCX = this._lastCZ = null; // re-stream around spawn
                if (g.showMessage) g.showMessage('Back to the overworld', 1600);
                if (g.updateCamera) g.updateCamera();
                setTimeout(() => { if (fade) fade.classList.remove('show'); this._netherTransitioning = false; }, 160);
            }, 360);
        }

        // Build the arena once; reused across visits.
        _netherBuild() {
            const group = new THREE.Group();
            group.name = 'nether-world';
            group.visible = false;
            this.game.scene.add(group);
            const sp = this._netherFindSolid(0, -22) || { x: 0, z: -22, y: 2 };
            const n = {
                group, walls: [], enemies: [], fires: [], embers: [], lavaPlanes: [],
                spawn: new THREE.Vector3(sp.x, sp.y + 1, sp.z),
                fog: new THREE.Fog(0x2a0805, 24, 160),
                bg: new THREE.Color(0x1c0604),
                returnPortal: null,
            };
            this.nether = n;

            group.add(new THREE.AmbientLight(0xff6a3a, 0.5));
            const dir = new THREE.DirectionalLight(0xff8040, 0.4); dir.position.set(20, 90, 10); group.add(dir);

            // Blocky height terrain (hills, plateaus, basins) + lava lakes.
            this._netherEnsureTextures();
            this._netherBuildTerrain();
            this._netherAddLavaPlane();

            // Basalt pillars topped with glowstone, on solid ground at varied height.
            for (let i = 0; i < 9; i++) {
                const a = (i / 9) * Math.PI * 2 + 0.3;
                const r = 18 + (i % 4) * 9;
                const x = Math.cos(a) * r, z = Math.sin(a) * r;
                if (!this._netherSolid(x, z)) continue;
                const base = netherSurfaceY(x, z);
                const h = 3 + (i % 3);
                for (let y = 0; y < h; y++) {
                    const blk = this._netherStack(ROOT + 'Block_Stone.gltf', x, z, base + 0.5 + y, { color: 0x2a2230, emissive: 0x0a0610 });
                    if (blk && y === 0) this._netherWall(blk, 0.6, h + 1, base);
                }
                const glow = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
                glow.position.set(x, base + 0.5 + h, z);
                group.add(glow);
                const gl = new THREE.PointLight(0xffc066, 1.2, 22); gl.position.copy(glow.position); group.add(gl);
            }

            // Dark volcanic rocks.
            this._netherScatter(24, 8, NETHER_RADIUS - 12, (x, z) => {
                const key = Math.random() < 0.5 ? env('Rock1') : env('Rock2');
                const rock = this._netherProp(key, x, z, 1.1 + Math.random() * 1.2, Math.random() * Math.PI * 2, { color: 0x241a1a, emissive: 0x140808 });
                if (rock) this._netherWall(rock, 0.85, 2.5, netherSurfaceY(x, z));
            });

            // CC0 lava trees (Quaternius) — native glowing colors, no recolor.
            this._netherScatter(14, 8, NETHER_RADIUS - 14, (x, z) => {
                const key = NETHER_LAVA_TREES[(Math.random() * NETHER_LAVA_TREES.length) | 0];
                const t = this._netherProp(key, x, z, 1.6 + Math.random() * 1.2, Math.random() * Math.PI * 2, null);
                if (t) this._netherWall(t, 0.6, 3, netherSurfaceY(x, z));
            });

            // Charred dead trees.
            this._netherScatter(11, 12, NETHER_RADIUS - 16, (x, z) => {
                const key = [env('DeadTree_1'), env('DeadTree_2'), env('DeadTree_3')][(Math.random() * 3) | 0];
                const t = this._netherProp(key, x, z, 1.3 + Math.random() * 0.6, Math.random() * Math.PI * 2, { color: 0x140d0d });
                if (t) this._netherWall(t, 0.5, 3, netherSurfaceY(x, z));
            });

            // Glowing quartz crystals (some cast light).
            this._netherScatter(16, 6, NETHER_RADIUS - 12, (x, z) => {
                this._netherProp(env('Crystal_Small'), x, z, 1 + Math.random() * 1.3, Math.random() * Math.PI * 2, { color: 0xffb27a, emissive: 0xff7a30 });
                if (Math.random() < 0.4) {
                    const cl = new THREE.PointLight(0xff9a40, 0.6, 10);
                    cl.position.set(x, netherSurfaceY(x, z) + 1.5, z);
                    this.nether.group.add(cl);
                }
            });

            // Nether-brick nook with a loot chest, on a solid spot.
            const nook = this._netherFindSolid(0, -40) || { x: 0, z: -40 };
            const nbase = netherSurfaceY(nook.x, nook.z);
            for (let bx = -3; bx <= 3; bx++) {
                for (let by = 0; by < 3; by++) {
                    if (bx === 0 && by < 2) continue; // doorway
                    const blk = this._netherStack(ROOT + 'Block_Brick.gltf', nook.x + bx, nook.z, nbase + 0.5 + by, { color: 0x5a1414, emissive: 0x180404 });
                    if (blk && by === 0) this._netherWall(blk, 0.6, 4, nbase);
                }
            }
            const chest = this._netherProp(env('Chest_Closed'), nook.x, nook.z + 2, 1.1, 0, null);
            if (chest) this._netherWall(chest, 0.6, 1, nbase);

            // Atmosphere: fire pits + drifting embers.
            this._netherScatter(13, 6, NETHER_RADIUS - 12, (x, z) => this._netherAddFire(x, z));
            this._netherAddEmbers(55);

            // Enemies (wandering, shootable), grounded on the terrain.
            const mobs = [
                ['enemies/Demon.gltf', 1.2, 6], ['enemies/Demon.gltf', 1.2, 6], ['enemies/Demon.gltf', 1.2, 6],
                ['enemies/Zombie.gltf', 1.1, 4], ['enemies/Zombie.gltf', 1.1, 4],
                ['enemies/Goblin.gltf', 1.0, 3], ['enemies/Goblin.gltf', 1.0, 3], ['enemies/Goblin.gltf', 1.0, 3],
                ['enemies/Skeleton_Armor.gltf', 1.1, 4], ['enemies/Skeleton_Armor.gltf', 1.1, 4],
                ['enemies/Wizard.gltf', 1.1, 5],
            ];
            for (const m of mobs) {
                const p = this._netherRandSolid(10, NETHER_RADIUS - 16);
                if (p) this._netherAddEnemy(ROOT + m[0], p.x, p.z, m[1], m[2]);
            }
            const boss = this._netherFindSolid(0, -54) || { x: 0, z: -54 };
            this._netherAddEnemy(ROOT + 'enemies/Giant.gltf', boss.x, boss.z, 2.0, 30);

            // Return portal on solid ground.
            const rp = this._netherFindSolid(0, 52) || { x: 0, z: 52 };
            this._netherBuildReturnPortal(rp.x, rp.z);
        }

        // Load CC0 ambientCG textures once (rock for terrain, lava for the sheet).
        _netherEnsureTextures() {
            if (this._netherTexLoaded) return;
            this._netherTexLoaded = true;
            const loader = this._texLoader || (this._texLoader = new THREE.TextureLoader());
            const rock = loader.load(NETHER_ROCK_TEX);
            rock.wrapS = rock.wrapT = THREE.RepeatWrapping;
            // Each cube face shows the rock once; instanceColor tints it per zone.
            this._netherTerrainMat = new THREE.MeshLambertMaterial({ map: rock, vertexColors: true });

            const lavaCol = loader.load(LAVA_COLOR_TEX);
            const lavaEm = loader.load(LAVA_EMISSIVE_TEX);
            for (const t of [lavaCol, lavaEm]) {
                t.wrapS = t.wrapT = THREE.RepeatWrapping;
                t.repeat.set(10, 10);
            }
            this._netherLavaMat = new THREE.MeshStandardMaterial({
                map: lavaCol, emissive: 0xffffff, emissiveMap: lavaEm, emissiveIntensity: 1.7,
                roughness: 0.85, metalness: 0.0,
            });
            this._netherLavaTex = [lavaCol, lavaEm];
        }

        // Blocky nether terrain as a single InstancedMesh (reuses the voxel infra,
        // textured with the CC0 rock map + per-zone instance color tint).
        _netherBuildTerrain() {
            this._ensureVoxelAssets();
            const list = [];
            const R = NETHER_RADIUS + 6;
            for (let z = -R; z <= R; z += CELL) {
                for (let x = -R; x <= R; x += CELL) {
                    if (Math.hypot(x, z) > R) continue;
                    const top = netherSurfaceY(x, z);
                    const minN = Math.min(
                        netherSurfaceY(x + CELL, z), netherSurfaceY(x - CELL, z),
                        netherSurfaceY(x, z + CELL), netherSurfaceY(x, z - CELL)
                    );
                    let h = top - minN + VOXEL_STEP;
                    if (h < VOXEL_STEP) h = VOXEL_STEP;
                    if (h > VOXEL_MAX_H * 2) h = VOXEL_MAX_H * 2;
                    list.push({ x, cy: top - h / 2, z, h, hex: netherColorAt(x, z, top) });
                }
            }
            const mat = this._netherTerrainMat || this._voxelMatPlain;
            const mesh = this._buildInstMesh(list, mat);
            if (mesh) { this.nether.group.add(mesh); this.nether.terrain = mesh; }
        }

        // One big lava sheet (CC0 lava texture + glowing emissive map, UV scrolled
        // for flow). Basins below it read as lakes.
        _netherAddLavaPlane() {
            const size = (NETHER_RADIUS + 8) * 2;
            const mat = this._netherLavaMat || new THREE.MeshStandardMaterial({ color: 0xff5a1e, emissive: 0xff5a1e });
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), mat);
            plane.rotation.x = -Math.PI / 2;
            plane.position.y = NETHER_LAVA_LEVEL + 0.2;
            this.nether.group.add(plane);
            const ll = new THREE.PointLight(0xff5520, 2.2, 70); ll.position.set(0, 6, 0); this.nether.group.add(ll);
        }

        _netherSolid(x, z) {
            return Math.hypot(x, z) < NETHER_RADIUS && netherSurfaceY(x, z) >= NETHER_LAVA_LEVEL + VOXEL_STEP;
        }

        _netherFindSolid(x, z) {
            if (this._netherSolid(x, z)) return { x, z, y: netherSurfaceY(x, z) };
            for (let r = 3; r <= NETHER_RADIUS; r += 3) {
                for (let a = 0; a < 16; a++) {
                    const ang = (a / 16) * Math.PI * 2;
                    const nx = x + Math.cos(ang) * r, nz = z + Math.sin(ang) * r;
                    if (this._netherSolid(nx, nz)) return { x: nx, z: nz, y: netherSurfaceY(nx, nz) };
                }
            }
            return null;
        }

        _netherRandSolid(minR, maxR) {
            for (let t = 0; t < 14; t++) {
                const a = Math.random() * Math.PI * 2;
                const r = minR + Math.random() * (maxR - minR);
                const x = Math.cos(a) * r, z = Math.sin(a) * r;
                if (this._netherSolid(x, z)) return { x, z };
            }
            return null;
        }

        _netherScatter(count, minR, maxR, fn) {
            for (let i = 0; i < count; i++) {
                const p = this._netherRandSolid(minR, maxR);
                if (p) fn(p.x, p.z);
            }
        }

        _recolorMesh(obj, opts) {
            obj.traverse((o) => {
                if (!o.isMesh) return;
                o.material = new THREE.MeshStandardMaterial({
                    color: opts.color != null ? opts.color : 0x888888,
                    emissive: opts.emissive != null ? opts.emissive : 0x000000,
                    roughness: opts.roughness != null ? opts.roughness : 0.85,
                    metalness: 0.05,
                });
                o.castShadow = true; o.receiveShadow = true;
            });
        }

        // Ground a prop's origin on the nether terrain at (x,z).
        _netherProp(path, x, z, scale, rotY, recolor) {
            const obj = this._cloneAsset(path);
            if (!obj) return null;
            obj.scale.setScalar(scale);
            obj.position.set(x, netherSurfaceY(x, z) - (this.modelMinY.get(path) || 0) * scale, z);
            obj.rotation.y = rotY || 0;
            if (recolor) this._recolorMesh(obj, recolor);
            this.nether.group.add(obj);
            return obj;
        }

        // Place a unit block with its center at yTop (for stacked pillars/walls).
        _netherStack(path, x, z, yTop, recolor) {
            const obj = this._cloneAsset(path);
            if (!obj) return null;
            obj.position.set(x, yTop, z);
            if (recolor) this._recolorMesh(obj, recolor);
            this.nether.group.add(obj);
            return obj;
        }

        _netherWall(obj, half, h, baseY) {
            const b = baseY != null ? baseY : netherSurfaceY(obj.position.x, obj.position.z);
            this.nether.walls.push({
                mesh: obj,
                position: new THREE.Vector3(obj.position.x, b + h / 2, obj.position.z),
                size: { x: half * 2, y: h, z: half * 2 },
            });
        }

        _makeFlameTexture() {
            if (this._flameTex) return this._flameTex;
            const c = document.createElement('canvas');
            c.width = c.height = 64;
            const x = c.getContext('2d');
            const grad = x.createRadialGradient(32, 40, 1, 32, 38, 30);
            grad.addColorStop(0.0, 'rgba(255,250,210,1)');
            grad.addColorStop(0.35, 'rgba(255,170,40,0.9)');
            grad.addColorStop(0.7, 'rgba(220,60,10,0.4)');
            grad.addColorStop(1.0, 'rgba(120,10,0,0)');
            x.fillStyle = grad;
            x.beginPath(); x.ellipse(32, 38, 22, 30, 0, 0, Math.PI * 2); x.fill();
            this._flameTex = new THREE.CanvasTexture(c);
            return this._flameTex;
        }

        _netherAddFire(x, z) {
            const mat = new THREE.SpriteMaterial({
                map: this._makeFlameTexture(), transparent: true, depthWrite: false,
                blending: THREE.AdditiveBlending, fog: false,
            });
            const size = 1.6 + Math.random() * 1.4;
            const gy = netherSurfaceY(x, z);
            const sprite = new THREE.Sprite(mat);
            sprite.scale.set(size, size * 1.4, 1);
            sprite.position.set(x, gy + size * 0.7, z);
            this.nether.group.add(sprite);
            const light = new THREE.PointLight(0xff7020, 0.9, 10);
            light.position.set(x, gy + 1, z);
            this.nether.group.add(light);
            this.nether.fires.push({ sprite, light, size, base: 0.9, phase: Math.random() * Math.PI * 2 });
        }

        _netherAddEmbers(count) {
            const tex = this._makeFlameTexture();
            for (let i = 0; i < count; i++) {
                const mat = new THREE.SpriteMaterial({
                    map: tex, transparent: true, depthWrite: false,
                    blending: THREE.AdditiveBlending, fog: false, color: 0xff9040,
                });
                const s = new THREE.Sprite(mat);
                const a = Math.random() * Math.PI * 2, r = Math.random() * NETHER_RADIUS;
                const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
                const sc = 0.15 + Math.random() * 0.25;
                s.scale.set(sc, sc, 1);
                s.position.set(ox, Math.random() * 14, oz);
                this.nether.group.add(s);
                this.nether.embers.push({
                    sprite: s, ox, oz,
                    vy: 1.2 + Math.random() * 1.6, vx: (Math.random() - 0.5) * 0.4,
                    maxY: 12 + Math.random() * 8,
                });
            }
        }

        _netherAddEnemy(path, x, z, scale, hp) {
            const obj = this._cloneAsset(path);
            if (!obj) return;
            obj.scale.setScalar(scale);
            const groundOff = (this.modelMinY.get(path) || 0) * scale;
            obj.position.set(x, netherSurfaceY(x, z) - groundOff, z);
            obj.rotation.y = Math.random() * Math.PI * 2;
            obj.userData.type = 'enemy';
            obj.userData.isAnimal = true; // passive: WorldStream drives it; weapons still hit
            obj.userData.hp = hp; obj.userData.hpMax = hp;
            obj.userData.hitRadius = 0.6 * scale;
            obj.userData.enemyKind = 'chick'; // no loot drop
            this.nether.group.add(obj);
            let mixer = null;
            const cached = this.assetCache.get(path);
            if (cached && cached.animations && cached.animations.length && THREE.AnimationMixer) {
                mixer = new THREE.AnimationMixer(obj);
                const clip = cached.animations.find((c) => /idle|walk|run|move/i.test(c.name)) || cached.animations[0];
                mixer.clipAction(clip).play();
            }
            this.nether.enemies.push({
                mesh: obj, mixer, groundOff, speed: 1.2 + Math.random() * 1.1,
                home: new THREE.Vector2(x, z), target: new THREE.Vector2(x, z), t: Math.random() * 3,
            });
        }

        _netherBuildReturnPortal(x, z) {
            const model = this._cloneAsset(NETHER_PORTAL_PATH);
            const group = new THREE.Group();
            let openCenter = new THREE.Vector3(0, 3.2, 0), openW = 3, openH = 3.6, pane = null;
            if (model) {
                let box = new THREE.Box3().setFromObject(model);
                const s = 7 / (box.getSize(new THREE.Vector3()).y || 1);
                model.scale.setScalar(s);
                box = new THREE.Box3().setFromObject(model);
                const center = box.getCenter(new THREE.Vector3());
                model.position.x -= center.x; model.position.z -= center.z; model.position.y -= box.min.y;
                model.traverse((o) => {
                    if (!o.isMesh) return;
                    if (/Plane002/i.test(o.name || '')) { pane = o; o.visible = false; return; }
                    o.material = new THREE.MeshStandardMaterial({ color: 0x14101c, roughness: 0.75, metalness: 0.15, emissive: 0x10001a });
                });
                group.add(model);
                group.updateMatrixWorld(true);
                if (pane) {
                    const pbox = new THREE.Box3().setFromObject(pane);
                    openCenter = pbox.getCenter(new THREE.Vector3());
                    const psize = pbox.getSize(new THREE.Vector3());
                    openW = Math.max(psize.z, psize.x) * 0.92; openH = psize.y * 0.92;
                }
            }
            const colorObj = new THREE.Color(0x36c6ff); // cool "exit" portal vs. the purple entry
            const mat = new THREE.ShaderMaterial({
                uniforms: { uTime: { value: 0 }, uColor: { value: colorObj } },
                vertexShader: PORTAL_VS, fragmentShader: PORTAL_FS,
                transparent: true, side: THREE.DoubleSide, depthWrite: false,
            });
            const swirl = new THREE.Mesh(new THREE.PlaneGeometry(openW, openH), mat);
            swirl.position.copy(openCenter);
            swirl.rotation.y = Math.PI / 2;
            group.add(swirl);
            const light = new THREE.PointLight(colorObj, 1.8, 14);
            light.position.copy(openCenter);
            group.add(light);
            group.position.set(x, netherSurfaceY(x, z), z);
            group.rotation.y = Math.atan2(-z, -x); // face arena center
            this.nether.group.add(group);
            group.updateMatrixWorld(true);
            const pos = swirl.getWorldPosition(new THREE.Vector3());
            this.nether.returnPortal = { material: mat, light, pos, inside: false };
        }

        _netherRegisterEnemies() {
            const pm = this.game.playMode;
            if (!pm || !pm.enemies || !this.nether) return;
            for (const e of this.nether.enemies) {
                if (!e.mesh || e.mesh.userData.dying) continue;
                if (e.mesh.userData.hp <= 0) e.mesh.userData.hp = e.mesh.userData.hpMax;
                if (pm.enemies.indexOf(e.mesh) === -1) pm.enemies.push(e.mesh);
            }
        }

        _netherUnregisterEnemies() {
            const pm = this.game.playMode;
            if (!pm || !pm.enemies || !this.nether) return;
            for (const e of this.nether.enemies) {
                const i = pm.enemies.indexOf(e.mesh);
                if (i !== -1) pm.enemies.splice(i, 1);
            }
        }

        _netherUpdate(dt) {
            const g = this.game, n = this.nether;
            if (!n) return;
            this._portalT += dt;

            // Scroll the lava texture (color + emission together) for slow flow.
            if (this._netherLavaTex) {
                const off = this._portalT * 0.012;
                for (const t of this._netherLavaTex) t.offset.set(off, off * 0.6);
            }

            for (const f of n.fires) {
                const fl = 0.75 + Math.sin(this._portalT * 12 + f.phase) * 0.2 + Math.sin(this._portalT * 23 + f.phase * 1.7) * 0.08;
                f.sprite.scale.set(f.size * (0.85 + 0.3 * fl), f.size * (1.1 + 0.5 * fl), 1);
                if (f.light) f.light.intensity = f.base * (0.7 + fl * 0.5);
            }

            for (const e of n.embers) {
                e.sprite.position.y += e.vy * dt;
                e.sprite.position.x += e.vx * dt;
                if (e.sprite.position.y > e.maxY) e.sprite.position.set(e.ox, 0.2, e.oz);
            }

            for (const e of n.enemies) {
                const m = e.mesh;
                if (!m || m.userData.dying || m.userData.hp <= 0) continue;
                if (e.mixer) e.mixer.update(dt);
                e.t -= dt;
                const dx = e.target.x - m.position.x, dz = e.target.y - m.position.z;
                const d = Math.hypot(dx, dz);
                if (d < 0.4 || e.t <= 0) {
                    const a = Math.random() * Math.PI * 2, r = Math.random() * 9;
                    e.target.set(e.home.x + Math.cos(a) * r, e.home.y + Math.sin(a) * r);
                    e.t = 2 + Math.random() * 3;
                } else {
                    m.position.x += (dx / d) * e.speed * dt;
                    m.position.z += (dz / d) * e.speed * dt;
                    m.rotation.y = Math.atan2(dx, dz);
                }
                // Follow the terrain (clamped to lava level so they don't sink).
                m.position.y = Math.max(netherSurfaceY(m.position.x, m.position.z), NETHER_LAVA_LEVEL) - e.groundOff;
            }

            // Lava burns: standing over a basin (terrain below lava) hurts.
            const p = g.player.position;
            if (netherSurfaceY(p.x, p.z) < NETHER_LAVA_LEVEL && Math.abs(p.y - NETHER_LAVA_LEVEL) < 2.5) {
                this._lavaDmgT = (this._lavaDmgT || 0) - dt;
                if (this._lavaDmgT <= 0) {
                    if (g.damagePlayer) g.damagePlayer(7);
                    if (g.showMessage) g.showMessage('🔥 Burning in lava!', 800);
                    this._lavaDmgT = 0.7;
                }
            } else {
                this._lavaDmgT = 0;
            }

            if (n.returnPortal) {
                const rp = n.returnPortal;
                rp.material.uniforms.uTime.value = this._portalT;
                rp.light.intensity = 1.6 * (1 + Math.sin(this._portalT * 4) * 0.15);
                const dx = p.x - rp.pos.x, dz = p.z - rp.pos.z;
                const inside = (dx * dx + dz * dz) < 4 && Math.abs(p.y - rp.pos.y) < 4;
                if (inside && !rp.inside && !this._netherTransitioning) this._netherExit();
                rp.inside = inside;
            }
        }

        // A subdivided water plane whose vertex colors darken with depth. Built
        // once; recolored when the player crosses a chunk (not per frame).
        _ensureWater() {
            if (this._water) return;
            const size = (FOG_FAR + 80) * 2;
            const seg = Math.max(8, Math.round(size / 16));
            this._waterGeo = new THREE.PlaneGeometry(size, size, seg, seg);
            const cols = new Float32Array(this._waterGeo.attributes.position.count * 3);
            this._waterGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
            const mat = new THREE.MeshLambertMaterial({
                vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false,
                side: THREE.DoubleSide, // visible from underwater too
            });
            this._water = new THREE.Mesh(this._waterGeo, mat);
            this._water.rotation.x = -Math.PI / 2;
            this._water.position.y = WATER_Y - 0.1; // just under block tops to avoid z-fight
            this._waterShallow = new THREE.Color(WATER_SHALLOW);
            this._waterDeep = new THREE.Color(WATER_DEEP);
            this._waterTmp = new THREE.Color();
        }

        // Recolor the water vertices from terrain depth at the given center.
        _updateWaterDepth(centerX, centerZ) {
            if (!this._waterGeo) return;
            const pos = this._waterGeo.attributes.position;
            const colAttr = this._waterGeo.attributes.color;
            for (let i = 0; i < pos.count; i++) {
                const wx = centerX + pos.getX(i);
                const wz = centerZ - pos.getY(i); // plane is rotated -90° about X
                const depth = WATER_Y - surfaceY(wx, wz);
                const f = depth <= 0 ? 0 : Math.min(1, depth / WATER_MAX_DEPTH);
                this._waterTmp.copy(this._waterShallow).lerp(this._waterDeep, f);
                colAttr.setXYZ(i, this._waterTmp.r, this._waterTmp.g, this._waterTmp.b);
            }
            colAttr.needsUpdate = true;
        }

        // Lazily build the sun light, sun disc, and cloud layer (reused across
        // mode entries).
        _buildCelestials() {
            if (!this._sun) {
                const sun = new THREE.DirectionalLight(0xfff0d4, 0.45);
                sun.position.set(SUN_DIR.x * 100, SUN_DIR.y * 100, SUN_DIR.z * 100);
                this._sun = sun;
            }
            if (!this._sunSprite) {
                const mat = new THREE.SpriteMaterial({
                    map: this._makeSunTexture(), transparent: true,
                    depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
                });
                this._sunSprite = new THREE.Sprite(mat);
                this._sunSprite.scale.setScalar(90);
            }
        }

        _setupScene() {
            const g = this.game;
            if (g.cheeseFloor) g.cheeseFloor.visible = false;
            if (g.crystalRoof) g.crystalRoof.visible = false;
            if (g.gridHelper) g.gridHelper.visible = false;
            g.roofY = null;

            this._saved = {
                skyMat: g.sky ? g.sky.material : null,
                skyFog: g.sky && g.sky.material ? g.sky.material.fog : null,
                fogColor: g.scene.fog ? g.scene.fog.color.getHex() : null,
                fogNear: g.scene.fog ? g.scene.fog.near : null,
                fogFar: g.scene.fog ? g.scene.fog.far : null,
                groundColor: g.ground && g.ground.material ? g.ground.material.color.getHex() : null,
            };

            // Voxels + water cover the world now; the flat base plane would poke
            // through deep ocean floors, so hide it.
            if (g.ground) g.ground.visible = false;
            if (g.scene.fog) {
                g.scene.fog.near = FOG_NEAR;
                g.scene.fog.far = FOG_FAR;
            }

            const start = biomeAt(0, 0);
            this._targetSky = new THREE.Color(start.sky);
            this._targetGround = new THREE.Color(start.ground);

            // Swap the flat sky dome for the gradient material (zenith → horizon).
            if (g.sky) {
                if (!this._skyMat) {
                    this._skyMat = new THREE.ShaderMaterial({
                        uniforms: {
                            topColor: { value: new THREE.Color(SKY_ZENITH) },
                            bottomColor: { value: new THREE.Color(start.sky) },
                            expo: { value: 0.55 },
                        },
                        vertexShader: SKY_VS,
                        fragmentShader: SKY_FS,
                        side: THREE.BackSide,
                        depthWrite: false,
                    });
                }
                this._skyMat.uniforms.bottomColor.value.copy(this._targetSky);
                g.sky.material = this._skyMat;
            }
            if (g.scene.fog) g.scene.fog.color.copy(this._targetSky);
            if (g.ground && g.ground.material) g.ground.material.color.copy(this._targetGround);

            // Sun light + disc + clouds.
            this._buildCelestials();
            g.scene.add(this._sun);
            g.scene.add(this._sun.target);
            g.scene.add(this._sunSprite);
            // Clouds are 3D objects added via _loadClouds() (async).

            // Depth-shaded water surface (colored per vertex in _onChunkChanged).
            this._ensureWater();
            g.scene.add(this._water);
        }

        _restoreScene() {
            const g = this.game;
            const s = this._saved;
            if (this._sun) { g.scene.remove(this._sun); g.scene.remove(this._sun.target); }
            if (this._sunSprite) g.scene.remove(this._sunSprite);
            if (this._water) g.scene.remove(this._water);
            if (this._uwOverlay) this._uwOverlay.style.opacity = '0';
            this._clearClouds();
            if (g.ground) g.ground.visible = true; // restore for other modes
            if (g.cheeseFloor) g.cheeseFloor.visible = true;
            if (g.crystalRoof) g.crystalRoof.visible = true;
            if (g.gridHelper) g.gridHelper.visible = true;
            if (!s) return;
            if (s.skyMat && g.sky) g.sky.material = s.skyMat; // restore flat sky dome
            if (g.scene.fog) {
                if (s.fogColor != null) g.scene.fog.color.setHex(s.fogColor);
                if (s.fogNear != null) g.scene.fog.near = s.fogNear;
                if (s.fogFar != null) g.scene.fog.far = s.fogFar;
            }
            if (s.groundColor != null && g.ground && g.ground.material) g.ground.material.color.setHex(s.groundColor);
        }

        _tickVisuals(dt) {
            const g = this.game;
            if (!this._targetSky) return;
            const a = Math.min(1, (dt || 0) * 3);
            // Horizon (fog + sky bottom) and ground tint ease to the current biome.
            if (this._skyMat) this._skyMat.uniforms.bottomColor.value.lerp(this._targetSky, a);
            if (g.scene.fog) g.scene.fog.color.lerp(this._targetSky, a);
            if (g.ground && g.ground.material) g.ground.material.color.lerp(this._targetGround, a);
            // Keep the sky dome, sun disc, and clouds centered on the player so
            // they always surround them in the infinite world.
            const p = g.player && g.player.position;
            if (g.sky && p) g.sky.position.copy(p);
            if (this._sunSprite && p) {
                this._sunSprite.position.set(p.x + SUN_DIR.x * SUN_DIST, p.y + SUN_DIR.y * SUN_DIST, p.z + SUN_DIR.z * SUN_DIST);
            }
            // Water follows/recolors on chunk change (see _onChunkChanged).

            // Space station: slow spin (no bob — keeps it aligned with its collider).
            if (this._station) this._station.rotation.y += dt * 0.05;

            // Spawn-tree vines sway in the breeze.
            if (this._vines.length) {
                this._treePhase += dt;
                for (const v of this._vines) {
                    v.mesh.rotation.x = Math.sin(this._treePhase + v.phase) * v.amp;
                    v.mesh.rotation.z = Math.cos(this._treePhase * 0.8 + v.phase) * v.amp;
                }
            }

            // Underwater tint: blue overlay + murky fog when the camera is below
            // the water surface.
            const cam = g.camera;
            let submerged = false;
            if (cam) {
                if (!this._uwTmp) this._uwTmp = new THREE.Vector3();
                submerged = cam.getWorldPosition(this._uwTmp).y < WATER_Y;
            }
            const ov = this._ensureUnderwaterOverlay();
            if (ov) ov.style.opacity = submerged ? '0.82' : '0';
            if (g.scene.fog) {
                if (!this._uwColor) this._uwColor = new THREE.Color(0x0f4a7a);
                if (submerged) {
                    g.scene.fog.color.lerp(this._uwColor, a);     // override the sky-tint above
                    g.scene.fog.far += (70 - g.scene.fog.far) * a;
                    g.scene.fog.near += (1 - g.scene.fog.near) * a;
                } else {
                    g.scene.fog.far += (FOG_FAR - g.scene.fog.far) * a;
                    g.scene.fog.near += (FOG_NEAR - g.scene.fog.near) * a;
                }
            }
        }

        _ensureUnderwaterOverlay() {
            if (this._uwOverlay) return this._uwOverlay;
            const el = document.createElement('div');
            el.id = 'underwater-overlay';
            el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:900;opacity:0;'
                + 'transition:opacity 0.25s ease;'
                + 'background:#1466b0;'; // flat uniform underwater blue
            document.body.appendChild(el);
            this._uwOverlay = el;
            return el;
        }

        _onChunkChanged(ccx, ccz) {
            const g = this.game;
            const biome = biomeAt(ccx, ccz);
            this._targetSky = new THREE.Color(biome.sky);
            this._targetGround = new THREE.Color(biome.ground);
            if (g.ground) {
                g.ground.position.x = ccx * CHUNK_SIZE + CHUNK_MID;
                g.ground.position.z = ccz * CHUNK_SIZE + CHUNK_MID;
            }
            // Recenter + depth-recolor the water around the player's chunk.
            if (this._water) {
                const wcx = ccx * CHUNK_SIZE + CHUNK_MID, wcz = ccz * CHUNK_SIZE + CHUNK_MID;
                this._water.position.x = wcx;
                this._water.position.z = wcz;
                this._updateWaterDepth(wcx, wcz);
            }
        }
    }

    window.WorldStream = WorldStream;
})();
