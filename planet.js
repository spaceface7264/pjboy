/*
 * planet.js — "Tiny Planet" mode for PJBoy.
 *
 * A finite spherical planet you walk all the way around (radial gravity) and can
 * fly off to see whole against space. Self-contained: it takes over the player
 * movement + camera ONLY while the `planet` mode is active (via guards in
 * game.js updatePlayer/updateCamera), leaving the flat modes and the infinite
 * open world untouched.
 *
 * Reuses the worldstream patterns (GLTF loader + clone, save/restore of sky/fog/
 * ground) but with its own 3D value noise sampled by the surface direction so the
 * terrain wraps seamlessly around the sphere (no poles/seams).
 *
 * Loaded as a <script> before game.js; exposed as window.PlanetWorld and driven
 * by the open_world-style `planet` mode (modes.js).
 */
(function () {
    'use strict';

    const ROOT = 'assets/Blocks/';
    const env = (n) => ROOT + 'environment/' + n + '.gltf';

    const DETAIL = 5;          // icosphere subdivision (~10k tris)
    // Per-planet params — ALL mutable so we can SWAP which world is generated at the
    // origin (the one you're standing on). Set by setActivePlanet(); see PLANETS.
    let R = 90;                // radius of the active world
    let GRAVITY = 26;          // surface gravity of the active world
    let NOISE_SCALE = 1.9;     // terrain frequency on the unit sphere
    let AMP = 15;              // max land elevation above sea level
    let SEA_BIAS = 0.46;       // higher → more ocean
    let SEED = 9123;
    let SEA_COLOR = 0x2a6fb0;  // water shell colour of the active world
    const MOVE_SPEED = 9;
    const JUMP = 12;
    const EYE = 2.6; // raised: surface blocks (ELEV_STEP tall) sit higher than flat-world ones

    // Gravity sphere of influence (recomputed per world from its R). Full pull near
    // the surface, fading to zero by SOI_OUTER (the weightless "space" gap).
    let SOI_INNER = R * 1.6;
    let SOI_OUTER = R * 2.6;
    // Smooth gravity multiplier (1 near the surface → 0 in space) for a radius r.
    function gravityScale(r) {
        if (r <= SOI_INNER) return 1;
        if (r >= SOI_OUTER) return 0;
        const t = (r - SOI_INNER) / (SOI_OUTER - SOI_INNER);
        return 1 - t * t * (3 - 2 * t); // smoothstep down to zero
    }

    const ani = (n) => ROOT + 'Animals/' + n + '.gltf';
    const PROP_TREES = ['Tree_1', 'Tree_2', 'Tree_3'].map(env);
    const PROP_DEAD = ['DeadTree_1', 'DeadTree_2'].map(env);
    const PROP_SMALL = ['Bush', 'Flowers_1', 'Flowers_2', 'Mushroom', 'Grass_Big', 'Grass_Small', 'Plant_2', 'Plant_3'].map(env);
    const PROP_ROCKS = ['Rock1', 'Rock2'].map(env);
    const PROP_ANIMALS = ['Sheep', 'Chicken', 'Pig', 'Cat'].map(ani);
    const PROP_PATHS = [].concat(PROP_TREES, PROP_DEAD, PROP_SMALL, PROP_ROCKS, PROP_ANIMALS);
    const CLOUD_PATHS = [1, 2, 3, 4].map((n) => ROOT + 'sky/Cloud_' + n + '.glb');
    const pick = (arr, rng) => arr[(rng() * arr.length) | 0];

    // --- deterministic noise / rng -----------------------------------------

    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function hash3(ix, iy, iz, seed) {
        let h = Math.imul(ix | 0, 73856093) ^ Math.imul(iy | 0, 19349663)
            ^ Math.imul(iz | 0, 83492791) ^ Math.imul(seed | 0, 2654435761);
        h = (h ^ (h >>> 13)) >>> 0;
        return (h & 0xffff) / 0x10000;
    }
    function valueNoise3(x, y, z, seed) {
        const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
        const sx = smooth(x - ix), sy = smooth(y - iy), sz = smooth(z - iz);
        const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, seed);
        const L = (a, b, t) => a + (b - a) * t;
        const x00 = L(c(0, 0, 0), c(1, 0, 0), sx), x10 = L(c(0, 1, 0), c(1, 1, 0), sx);
        const x01 = L(c(0, 0, 1), c(1, 0, 1), sx), x11 = L(c(0, 1, 1), c(1, 1, 1), sx);
        return L(L(x00, x10, sy), L(x01, x11, sy), sz);
    }
    function fbm3(x, y, z, seed) {
        let amp = 0.5, freq = 1, sum = 0, norm = 0;
        for (let o = 0; o < 4; o++) {
            sum += amp * valueNoise3(x * freq, y * freq, z * freq, seed + o * 31);
            norm += amp; amp *= 0.5; freq *= 2;
        }
        return sum / norm; // 0..1
    }

    const FACE_N = 56;         // quad-sphere grid cells per face edge (6·N² tiles)
    const ELEV_STEP = 2;       // elevation quantization (block step height)
    const TILE_H = ELEV_STEP * 3; // tile thickness (overlaps inward to hide cliff gaps)
    const MAX_DIG = 3;         // max terrain steps you can dig per cell (= one tile depth, walls stay sealed)
    const MAXP = 4000;         // max player-placed blocks
    const ROCKET_SCALE = 1.8;  // world scale of the rocket landmark
    const ROCKET_LOWEST = -0.6; // model's lowest point (fin/engine tip) before scaling
    const CHARGE_TIME = 1.4;   // seconds of held Space to fully charge a launch
    // The system's star. Its LIGHT comes from very far away (parallel rays, like a
    // real sun); its disk is drawn as a camera-following billboard in that same
    // direction (inside the sky/far plane) so it reads as infinitely distant.
    const SUN_DIST = 100000;        // true distance of the star (light source)
    const SUN_RENDER_DIST = 380;    // where the disk is drawn from the camera (inside the 500 sky)
    const SUN_RADIUS = 16;          // apparent disk radius at the render distance (~2.4°)
    // The walkable worlds — built from the procedural catalog (planetgen.js). The
    // ACTIVE one builds at the origin; the rest render as distant prop globes at
    // their `orbit`. Each has its own radius + gravity. The first entry's key is
    // 'home' (the curated Terra start world).
    const UNIVERSE_SEED = 13337;
    const PLANET_COUNT = 12;
    const PLANETS = {};
    (function () {
        var list = (typeof window !== 'undefined' && window.PlanetGen)
            ? window.PlanetGen.generate(UNIVERSE_SEED, PLANET_COUNT) : [];
        if (!list.length) { // safety fallback so the mode still works if planetgen is missing
            list = [{
                key: 'home', name: 'Terra', R: 90, gravity: 26, noiseScale: 1.9, amp: 15, seaBias: 0.46, seed: 9123,
                sea: 0x2a6fb0, sky: 0x6fae3a, props: true, clouds: true, atm: [0x6db4ff, 0x8ec6ff, 0xbfe0ff],
                orbit: { dir: [0.42, 0.82, 0.40], dist: 620 },
                pal: function (e) {
                    return e < -1.5 ? 0x8a7b50 : e < 1 ? 0xe6d6a8 : e < AMP * 0.45 ? 0x6fae3a
                        : e < AMP * 0.8 ? 0x8a8d92 : 0xeaf2f7;
                }
            }];
        }
        list.forEach(function (d) { PLANETS[d.key] = d; });
    })();
    let PAL = PLANETS.home.pal;
    function colorHex(e) { return PAL(e); }
    const PROP_SCALE = 0.5;      // a prop globe's apparent radius = R * PROP_SCALE
    function setActivePlanet(def) {
        R = def.R; GRAVITY = def.gravity;
        SOI_INNER = R * 1.6; SOI_OUTER = R * 2.6;
        NOISE_SCALE = def.noiseScale; AMP = def.amp; SEA_BIAS = def.seaBias;
        SEED = def.seed; SEA_COLOR = def.sea; PAL = def.pal;
    }

    // Signed land elevation for a unit surface direction.
    function elevation(dir) {
        const e = fbm3(dir.x * NOISE_SCALE, dir.y * NOISE_SCALE, dir.z * NOISE_SCALE, SEED);
        return (e - SEA_BIAS) * AMP * 2;
    }
    function quantElev(dir) { return Math.round(elevation(dir) / ELEV_STEP) * ELEV_STEP; }

    // Cube → sphere mapping. (a,b) ∈ [-1,1] on a cube face → unit direction.
    function faceDir(face, a, b) {
        let x, y, z;
        switch (face) {
            case 0: x = 1; y = b; z = -a; break;   // +X
            case 1: x = -1; y = b; z = a; break;   // -X
            case 2: x = a; y = 1; z = -b; break;   // +Y
            case 3: x = a; y = -1; z = b; break;   // -Y
            case 4: x = a; y = b; z = 1; break;    // +Z
            default: x = -a; y = b; z = -1; break; // -Z
        }
        const l = Math.hypot(x, y, z);
        return new THREE.Vector3(x / l, y / l, z / l);
    }
    // Inverse: which (face, iu, iv) cell does a unit direction fall in?
    function cellOf(dir) {
        const ax = Math.abs(dir.x), ay = Math.abs(dir.y), az = Math.abs(dir.z);
        let face, a, b;
        if (ax >= ay && ax >= az) {
            if (dir.x > 0) { face = 0; a = -dir.z / ax; b = dir.y / ax; }
            else { face = 1; a = dir.z / ax; b = dir.y / ax; }
        } else if (ay >= az) {
            if (dir.y > 0) { face = 2; a = dir.x / ay; b = -dir.z / ay; }
            else { face = 3; a = dir.x / ay; b = dir.z / ay; }
        } else {
            if (dir.z > 0) { face = 4; a = dir.x / az; b = dir.y / az; }
            else { face = 5; a = -dir.x / az; b = dir.y / az; }
        }
        const iu = Math.max(0, Math.min(FACE_N - 1, Math.floor((a + 1) / 2 * FACE_N)));
        const iv = Math.max(0, Math.min(FACE_N - 1, Math.floor((b + 1) / 2 * FACE_N)));
        return { face, iu, iv };
    }
    // Surface frame + quantized radius + tangential size for a grid cell.
    // N defaults to the walkable resolution; pass a smaller N for a cheaper globe
    // (used by the distant planet prop).
    function cellFrame(face, iu, iv, N) {
        N = N || FACE_N;
        const a = (iu + 0.5) / N * 2 - 1, b = (iv + 0.5) / N * 2 - 1;
        const c = faceDir(face, a, b);
        const step = 2 / N;
        const cu = faceDir(face, a + step, b);
        const n = c.clone();
        const tU = cu.clone().sub(c);
        tU.addScaledVector(n, -n.dot(tU));
        if (tU.lengthSq() < 1e-8) tU.set(1, 0, 0).addScaledVector(n, -n.dot(new THREE.Vector3(1, 0, 0)));
        tU.normalize();
        const tV = tU.clone().cross(n).normalize(); // right-handed (tU × n) so tiles aren't reflected
        const baseRR = R + quantElev(c);
        const cellW = c.distanceTo(cu) * baseRR * 1.18; // overlap a touch to seal seams
        return { c, n, tU, tV, baseRR, cellW, key: face + ',' + iu + ',' + iv };
    }

    class PlanetWorld {
        constructor(game) {
            this.game = game;
            this._planet = null;      // voxel shell InstancedMesh
            this._water = null;
            this._sun = null;
            this._ambient = null;
            this._props = [];
            this._cubeGeo = null;
            this._cubeMat = null;
            this._placedMesh = null;  // player-placed cubes
            this._placedCount = 0;
            this._placedStacks = new Map(); // surface-cell key → stack height
            this._placedKeys = [];          // instanceId → cell key (for mining)
            this._dugDepth = new Map();     // surface-cell key → terrain steps dug down
            this._holes = new Set();        // cells dug clean through → open shaft to the core
            this._editsDirty = false;       // pending player edits to persist
            this._lastSave = 0;
            this._inSpace = false;          // past the gravity sphere of influence (weightless)
            this._raycaster = null;
            this._saved = null;
            this.loader = null;
            this.assetCache = new Map();
            this.modelMinY = new Map();
            this._assetsReady = false;
            // controller scratch / state
            this._center = new THREE.Vector3(0, 0, 0);
            this._fwd = new THREE.Vector3(1, 0, 0);
            this._up = new THREE.Vector3(0, 1, 0);
            this._lastUp = new THREE.Vector3(0, 1, 0); // last good radial up (held through the core singularity)
            this._inside = false;       // true while in the hollow interior (only flips by passing a hole)
            this._coreUp = new THREE.Vector3(0, 1, 0);  // frozen camera up while falling through the core (no 180° flip)
            this._coreFwd = new THREE.Vector3(0, 0, -1); // frozen reference forward (mouse look rotates around it)
            this._coreYaw0 = 0;                          // yaw at core entry (relative mouse-look baseline)
            this._right = new THREE.Vector3();
            this._dir = new THREE.Vector3();
            this._tang = new THREE.Vector3();
            this._wish = new THREE.Vector3();
            this._lastYaw = 0;
            this._onGround = false;
            // rocket landmark / launch state
            this._rocket = null;
            this._rocketDir = null;       // unit dir of the rocket's pad
            this._rocketBase = null;      // world pos of the pad (fin contact point)
            this._nearRocket = false;     // player is within boarding range
            this._riding = false;         // player is piloting the rocket
            this._launching = false;      // on the pad, charging a launch
            this._charge = 0;             // 0..1 launch charge while holding Space
            this._spacePrev = false;      // edge-detect Space release on the pad
            this._autopilot = false;      // course locked on the sister planet
            this._arrived = false;        // currently resting on the sister planet
            // True 6-DOF flight: the ship's orientation is a quaternion rotated in
            // its own local frame each step (no gimbal lock, free roll). Nose = +Y.
            this._shipQuat = new THREE.Quaternion();
            this._shipUp = new THREE.Vector3(0, 0, 1);  // ship's "up" (local +Z) in world
            this._qd = new THREE.Quaternion();          // scratch delta rotation
            this._qTarget = new THREE.Quaternion();     // scratch autopilot target
            this._mouseDX = 0; this._mouseDY = 0;       // raw pointer-lock deltas (unclamped)
            this._AXX = new THREE.Vector3(1, 0, 0);     // local right  (pitch axis)
            this._AXY = new THREE.Vector3(0, 1, 0);     // local nose   (roll axis)
            this._AXZ = new THREE.Vector3(0, 0, 1);     // local up     (yaw axis)
            // launch reference frame (orients the ship at liftoff)
            this._refUp = new THREE.Vector3(0, 1, 0);   // launch "zenith"
            this._refFwd = new THREE.Vector3(0, 0, 1);  // launch horizontal forward
            this._heading = new THREE.Vector3(0, 1, 0); // current nose direction
            this._dir2 = new THREE.Vector3();           // scratch for dest-planet math
            // multi-planet system: the active world is at the origin; every other
            // world renders as a distant prop. One of them is the current flight TARGET.
            this._destCenter = new THREE.Vector3();   // selected target's position
            this._destRadius = 45;                    // selected target's prop radius
            this._propMeshes = {};                    // key -> { group, def, cheap, terrain } (all non-active)
            this._activeDef = PLANETS.home;
            // First non-home world is the default flight destination.
            this._targetDef = PLANETS[Object.keys(PLANETS).find((k) => k !== 'home')] || PLANETS.home;
            this._activeKey = 'home';
            // launch camera hand-off (eased pad -> chase)
            this._camPos = new THREE.Vector3();
            this._camTarget = new THREE.Vector3();
            this._camUpV = new THREE.Vector3(0, 1, 0);
            this._camBlendT = 0;
            this._camLastT = 0;
            this._liftoffT = 0;           // auto-thrust ramp window after liftoff
            this._liftoffMax = 0;
            this._landed = false;         // rocket settled on a surface
            this._contactSpeed = 0;       // inward speed captured at surface contact
            this._dust = null;            // touchdown dust shockwave
            this._autoLanding = false;    // autopilot is in its descent phase
            this._autoLandPhase = 0;      // slow cinematic camera arc during descent
            // the sun (solar-system center + primary light)
            this._sunCenter = new THREE.Vector3();
            this._sunMesh = null;
            this._sunLight = null;
            this._stars = null;           // deep-space backdrop
        }

        // Signed land height above sea level for a unit surface direction.
        elevationAt(dir) { return elevation(dir); }
        surfaceRadius(dir) { return R + elevation(dir); }

        // Walkable top radius in a direction = quantized surface + placed stack.
        groundRadius(dir) {
            const c = cellOf(dir);
            const key = c.face + ',' + c.iu + ',' + c.iv;
            if (this._holes.has(key)) return -1; // open shaft to the core — no floor here
            const stack = this._placedStacks.get(key) || 0;
            const dug = this._dugDepth.get(key) || 0;
            return R + quantElev(dir) + (stack - dug) * ELEV_STEP;
        }

        // ---- lifecycle ----

        enter() {
            const g = this.game;
            if (!this.loader) this.loader = new THREE.GLTFLoader();
            // Persist edits if the tab is closed/reloaded mid-session.
            if (!this._beforeUnload) {
                this._beforeUnload = () => { if (this._editsDirty) this._saveEdits(); };
                window.addEventListener('beforeunload', this._beforeUnload);
            }
            // E: board / disembark.  G: lock course on the sister planet.
            if (!this._onKeyDown) {
                this._onKeyDown = (e) => {
                    if (e.repeat || g.activeModeId !== 'planet') return;
                    if (e.code === 'KeyE') this._onInteract();
                    else if (e.code === 'KeyG' && this._riding && !this._launching) this._toggleCourse();
                };
                window.addEventListener('keydown', this._onKeyDown);
            }
            // Raw pointer-lock mouse deltas drive 6-DOF pitch/yaw (unclamped, unlike
            // the walking controller's fpvPitch). Only accumulate while flying.
            if (!this._onMouseMove) {
                this._onMouseMove = (e) => {
                    if (!this._riding || this._launching) return;
                    this._mouseDX += e.movementX || 0;
                    this._mouseDY += e.movementY || 0;
                };
                window.addEventListener('mousemove', this._onMouseMove);
            }
            this._riding = false;
            this._launching = false;
            this._autopilot = false;
            this._arrived = false;
            this._charge = 0;
            this._nearRocket = false;
            // Always start on the home world; the others are distant props.
            this._activeDef = PLANETS.home;
            this._activeKey = this._activeDef.key;
            this._targetDef = PLANETS[Object.keys(PLANETS).find((k) => k !== this._activeKey)] || PLANETS.home;
            setActivePlanet(this._activeDef);
            this._buildPlanet();
            this._setupScene();
            this._buildAtmosphere();
            if (this._activeDef.clouds) this._buildClouds();
            this._buildPlanetProps();
            this._buildSun();
            this._buildStars();
            this._preloadProps();
            if (g.clearEnemies) g.clearEnemies();

            // Spawn the player on land near a fixed direction.
            const spawn = this._findLandDir();
            // Plant the rocket landmark a short walk from spawn.
            this._placeRocket(this._findLandNear(spawn));
            const p = g.player.position;
            p.copy(spawn).multiplyScalar(this.groundRadius(spawn) + 0.5);
            g.player.velocity.set(0, 0, 0);
            // Seed a tangent forward and sync the yaw tracker.
            const up = this._up.copy(spawn).normalize();
            this._lastUp.copy(up);
            this._inside = false;
            this._inSpace = false;
            this._ensureAltUI().style.display = 'block';
            this._fwd.set(0, 1, 0);
            if (Math.abs(this._fwd.dot(up)) > 0.9) this._fwd.set(1, 0, 0);
            this._fwd.projectOnPlane(up).normalize();
            this._lastYaw = g.characterRotation || 0;
            this._onGround = true;
            if (g.applyViewModeToPlayerModel) g.applyViewModeToPlayerModel();
            this.updateCamera();
            g.scene.updateMatrixWorld(true); // flush transforms of everything just added
        }

        exit() {
            const g = this.game;
            if (this._planet) g.scene.remove(this._planet);
            if (this._placedMesh) g.scene.remove(this._placedMesh);
            if (this._preview) { g.scene.remove(this._preview); this._preview = null; }
            if (this._water) g.scene.remove(this._water);
            if (this._rocket) { g.scene.remove(this._rocket); this._rocket = null; }
            this._clearPlanetProps();
            if (this._dust) { g.scene.remove(this._dust.ring); this._dust = null; }
            this._landed = false;
            this._clearSun();
            this._clearStars();
            if (this._sun) { g.scene.remove(this._sun); g.scene.remove(this._sun.target); }
            if (this._ambient) g.scene.remove(this._ambient);
            this._clearProps();
            this._clearAtmosphere();
            this._restoreScene();
            // tear down rocket / launch state
            if (this._riding && g.player.model) g.player.model.visible = true;
            this._riding = false;
            this._launching = false;
            this._autopilot = false;
            this._nearRocket = false;
            this._rocketBase = null;
            if (this._altEl) this._altEl.style.display = 'none';
            if (this._promptEl) this._promptEl.style.display = 'none';
            if (this._chargeEl) this._chargeEl.style.display = 'none';
            if (this._editsDirty) this._saveEdits(); // flush pending edits on the way out
            if (this._beforeUnload) { window.removeEventListener('beforeunload', this._beforeUnload); this._beforeUnload = null; }
            if (this._onKeyDown) { window.removeEventListener('keydown', this._onKeyDown); this._onKeyDown = null; }
            if (this._onMouseMove) { window.removeEventListener('mousemove', this._onMouseMove); this._onMouseMove = null; }
        }

        // fixedUpdate hook — drive the placement preview (the controller runs via
        // the updatePlayer guard).
        update(dt) {
            const g = this.game;
            // Slowly drift the cloud layer for a living sky.
            if (this._clouds) this._clouds.rotation.y += (dt || 0.016) * 0.006;
            // Keep the sun's disk pinned to its sky direction (camera-following → looks infinitely far).
            if (this._sunMesh && this._sunDir) this._sunMesh.position.copy(g.camera.position).addScaledVector(this._sunDir, SUN_RENDER_DIST);
            // Starfield follows the camera so stars hold fixed sky directions.
            if (this._stars) this._stars.position.copy(g.camera.position);
            // Distance-based LOD: build/drop real terrain on the distant planet props.
            this._updatePropLOD();
            if (this._dust) {
                this._dust.t += (dt || 0.016);
                const k = this._dust.t / this._dust.life;
                if (k >= 1) { g.scene.remove(this._dust.ring); this._dust = null; }
                else {
                    const sc = (1 + k * 7) * this._dust.strength;
                    this._dust.ring.scale.set(sc, sc, sc);
                    this._dust.ring.material.opacity = 0.7 * (1 - k);
                }
            }
            // Debounced persistence of player edits (also flushed on exit).
            if (this._editsDirty) {
                const now = (typeof performance !== 'undefined') ? performance.now() : 0;
                if (now - (this._lastSave || 0) > 600) this._saveEdits();
            }
            const pv = this._preview;
            if (!pv) return;
            if (this._riding || g.activeModeId !== 'planet' || !g.activeBlockId || this._placedCount >= MAXP) { pv.visible = false; return; }
            const hit = this._rayHit();
            if (!hit) { pv.visible = false; return; }
            const c = cellOf(hit.point.clone().normalize());
            const fr = cellFrame(c.face, c.iu, c.iv);
            const stack = this._placedStacks.get(fr.key) || 0;
            const dug = this._dugDepth.get(fr.key) || 0;
            const centerR = fr.baseRR + (stack - dug) * ELEV_STEP + ELEV_STEP / 2;
            pv.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.tU, fr.n, fr.tV));
            pv.position.copy(fr.c).multiplyScalar(centerR);
            pv.scale.set(fr.cellW, ELEV_STEP, fr.cellW);
            pv.visible = true;
        }

        // ---- planet geometry ----

        // Shared 1×1 cube geometry, vertex-shaded (bright top / darker sides) so a
        // single biome instanceColor reads as a lit block.
        _ensureCubeGeo() {
            if (this._cubeGeo) return;
            const geo = new THREE.BoxGeometry(1, 1, 1); // unit; scaled per instance
            const norm = geo.attributes.normal;
            const cols = new Float32Array(norm.count * 3);
            for (let i = 0; i < norm.count; i++) {
                const ny = norm.getY(i);
                const s = ny > 0.5 ? 1.0 : (ny < -0.5 ? 0.5 : 0.66);
                cols[i * 3] = s; cols[i * 3 + 1] = s; cols[i * 3 + 2] = s;
            }
            geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
            this._cubeGeo = geo;
            // Soft grayscale grain so biome-tinted tiles read as textured ground
            // (grass/sand/rock/snow) instead of flat colour. Kept subtle so the
            // biome hue stays dominant.
            const grain = this._pixelTex(() => {
                const v = 0.88 + Math.random() * 0.12;          // gentle speckle, no hard cracks
                const g = (255 * v) | 0;
                return `rgb(${g},${g},${g})`;
            });
            this._cubeMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: grain });
        }

        // 16×16 nearest-filtered pixel texture from a per-pixel color function.
        _pixelTex(fn) {
            const c = document.createElement('canvas');
            c.width = c.height = 16;
            const x = c.getContext('2d');
            for (let py = 0; py < 16; py++) {
                for (let px = 0; px < 16; px++) {
                    const col = fn(px, py);
                    if (!col) continue;
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

        // Material for player-placed blocks: pixel-art stone detail (cracks +
        // speckle) as a luminance map, tinted per-instance by the block colour.
        _ensurePlacedMat() {
            if (this._placedMat) return this._placedMat;
            const tex = this._pixelTex((px, py) => {
                const base = 0.9 + 0.05 * Math.sin((px + py) * 0.9); // gentle low-freq shade
                let v = base + (Math.random() * 0.08 - 0.04);        // fine speckle
                const r = Math.random();
                if (r < 0.09) v -= 0.30;                             // dark crack / pit
                else if (r < 0.13) v += 0.07;                        // bright fleck
                v = Math.max(0.5, Math.min(1, v));
                const g = (255 * v) | 0;
                return `rgb(${g},${g},${g})`;
            });
            this._placedMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
            return this._placedMat;
        }

        _buildPlanet() {
            this._ensureCubeGeo();
            // One oriented tile per quad-sphere grid cell — each block lies LEVEL on
            // the surface (its up = the radial normal), so the planet stays round.
            const count = 6 * FACE_N * FACE_N;
            const mesh = new THREE.InstancedMesh(this._cubeGeo, this._cubeMat, count);
            mesh.receiveShadow = true;
            this._cellKeyByInstance = new Array(count);
            const m = new THREE.Matrix4(), q = new THREE.Quaternion(), basis = new THREE.Matrix4();
            const pos = new THREE.Vector3(), scl = new THREE.Vector3(), col = new THREE.Color();
            let i = 0;
            for (let face = 0; face < 6; face++) {
                for (let iu = 0; iu < FACE_N; iu++) {
                    for (let iv = 0; iv < FACE_N; iv++) {
                        const fr = cellFrame(face, iu, iv);
                        basis.makeBasis(fr.tU, fr.n, fr.tV);   // local x→tU, y→up(normal), z→tV
                        q.setFromRotationMatrix(basis);
                        pos.copy(fr.c).multiplyScalar(fr.baseRR - TILE_H / 2); // top face at baseRR
                        scl.set(fr.cellW, TILE_H, fr.cellW);
                        m.compose(pos, q, scl);
                        mesh.setMatrixAt(i, m);
                        col.setHex(colorHex(fr.baseRR - R));
                        mesh.setColorAt(i, col);
                        this._cellKeyByInstance[i] = fr.key;
                        i++;
                    }
                }
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            this._planet = mesh;
            this._planet.frustumCulled = false;
            this.game.scene.add(mesh);

            // Player-placed blocks layer (starts empty, grows as you build).
            // frustumCulled off: its bounding sphere starts at the origin (count 0)
            // and would cull the blocks placed out at the surface radius.
            // Own material + instanceColor seeded up front so the instancing-color
            // shader variant is stable from frame 1 (no flip on first placement).
            this._placedMesh = new THREE.InstancedMesh(this._cubeGeo, this._ensurePlacedMat(), MAXP);
            this._placedMesh.count = 0;
            this._placedMesh.frustumCulled = false;
            const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
            for (let k = 0; k < MAXP; k++) this._placedMesh.setMatrixAt(k, _zero);
            this._placedMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3).fill(1), 3);
            this._placedMesh.instanceMatrix.needsUpdate = true;
            this._placedMesh.instanceColor.needsUpdate = true;
            this._placedCount = 0;
            this._placedStacks = new Map();
            this._placedKeys = [];
            this._dugDepth = new Map();
            this._holes = new Set();
            this.game.scene.add(this._placedMesh);

            // Placement preview wireframe (oriented to the targeted cell).
            this._preview = new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, 1),
                new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.85, depthTest: false })
            );
            this._preview.frustumCulled = false;
            this._preview.renderOrder = 999;
            this._preview.visible = false;
            this.game.scene.add(this._preview);

            // Sea-level water shell.
            this._water = new THREE.Mesh(
                new THREE.SphereGeometry(R, 64, 48),
                new THREE.MeshLambertMaterial({ color: SEA_COLOR, transparent: true, opacity: 0.72 })
            );
            this._water.frustumCulled = false; // camera sits on this giant sphere — cull math misfires
            this.game.scene.add(this._water);

            // Replay any saved player edits onto the freshly-built (deterministic) planet.
            this._restoreEdits();
            this._editsDirty = false;
        }

        // ---- build / mine on the surface (radial stacking) ----

        _rayHit() {
            const g = this.game;
            if (!this._raycaster) this._raycaster = new THREE.Raycaster();
            this._raycaster.setFromCamera({ x: 0, y: 0 }, g.camera); // screen center
            const objs = [this._planet, this._placedMesh].filter(Boolean);
            const hits = this._raycaster.intersectObjects(objs, false);
            for (const h of hits) { if (h.distance <= 14) return h; }
            return null;
        }

        placeBlock() {
            const g = this.game;
            if (this._placedCount >= MAXP) return;
            const hit = this._rayHit();
            if (!hit) return;
            const c = cellOf(hit.point.clone().normalize());
            const fr = cellFrame(c.face, c.iu, c.iv);
            const stack = this._placedStacks.get(fr.key) || 0;
            const dug = this._dugDepth.get(fr.key) || 0;
            const centerR = fr.baseRR + (stack - dug) * ELEV_STEP + ELEV_STEP / 2; // on top of the (possibly dug) surface
            const basis = new THREE.Matrix4().makeBasis(fr.tU, fr.n, fr.tV);
            const q = new THREE.Quaternion().setFromRotationMatrix(basis);
            const pos = fr.c.clone().multiplyScalar(centerR);
            const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(fr.cellW, ELEV_STEP, fr.cellW));
            const i = this._placedCount;
            this._placedMesh.setMatrixAt(i, m);
            const def = g.BLOCK_DEFS && g.activeBlockId ? g.BLOCK_DEFS[g.activeBlockId] : null;
            this._placedMesh.setColorAt(i, new THREE.Color((def && def.color) || 0x9a8b6a));
            this._placedMesh.instanceMatrix.needsUpdate = true;
            if (this._placedMesh.instanceColor) this._placedMesh.instanceColor.needsUpdate = true;
            this._placedCount = i + 1;
            this._placedMesh.count = this._placedCount;
            this._placedKeys[i] = fr.key;
            this._placedStacks.set(fr.key, stack + 1);
            g.audio && g.audio.play && g.audio.play('uiClick');
            this._markDirty();
        }

        mineBlock() {
            const hit = this._rayHit();
            if (!hit || hit.instanceId == null) return;
            // A player-placed block takes priority (it's what the ray hits first).
            if (hit.object === this._placedMesh) {
                const i = hit.instanceId;
                const key = this._placedKeys[i];
                if (key != null) {
                    const stack = this._placedStacks.get(key) || 0;
                    if (stack > 0) this._placedStacks.set(key, stack - 1);
                }
                this._placedMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); // hide
                this._placedMesh.instanceMatrix.needsUpdate = true;
                this.game.audio && this.game.audio.play && this.game.audio.play('swordHit');
                this._markDirty();
                return;
            }
            // Otherwise dig the planet surface itself, one step down at this cell.
            if (hit.object === this._planet) this._digTerrain(hit.instanceId);
        }

        // Lower one terrain cell by a block-step (exposes dirt then stone).
        _digTerrain(inst) {
            const key = this._cellKeyByInstance[inst];
            if (key == null || this._holes.has(key)) return;
            const parts = key.split(',');
            const fr = cellFrame(+parts[0], +parts[1], +parts[2]);
            const dug = this._dugDepth.get(key) || 0;
            if (dug >= MAX_DIG) {
                // Break clean through the shell — open a shaft to the hollow core.
                this._holes.add(key);
                this._planet.setMatrixAt(inst, new THREE.Matrix4().makeScale(0, 0, 0));
                this._planet.instanceMatrix.needsUpdate = true;
                this.game.audio && this.game.audio.play && this.game.audio.play('explosion');
                this._markDirty();
                return;
            }
            const nd = dug + 1;
            this._dugDepth.set(key, nd);
            const q = new THREE.Quaternion().setFromRotationMatrix(
                new THREE.Matrix4().makeBasis(fr.tU, fr.n, fr.tV));
            const pos = fr.c.clone().multiplyScalar(fr.baseRR - TILE_H / 2 - nd * ELEV_STEP);
            const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(fr.cellW, TILE_H, fr.cellW));
            this._planet.setMatrixAt(inst, m);
            this._planet.instanceMatrix.needsUpdate = true;
            this._planet.setColorAt(inst, new THREE.Color(nd <= 1 ? 0x6b4f2a : 0x70726f)); // dirt → stone
            if (this._planet.instanceColor) this._planet.instanceColor.needsUpdate = true;
            this.game.audio && this.game.audio.play && this.game.audio.play('swordHit');
            this._markDirty();
        }

        // ---- persistence (player edits survive mode re-entry and reload) ----

        _instOfKey(key) {
            const p = key.split(',');
            const face = +p[0], iu = +p[1], iv = +p[2];
            if (!(face >= 0 && face < 6 && iu >= 0 && iu < FACE_N && iv >= 0 && iv < FACE_N)) return -1;
            return face * FACE_N * FACE_N + iu * FACE_N + iv;
        }

        _markDirty() { this._editsDirty = true; }

        _saveEdits() {
            try {
                const placed = [];
                const m = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), scl = new THREE.Vector3();
                const col = new THREE.Color();
                for (let i = 0; i < this._placedCount; i++) {
                    this._placedMesh.getMatrixAt(i, m);
                    m.decompose(pos, q, scl);
                    if (scl.x < 0.001) continue; // mined → skip
                    if (this._placedMesh.instanceColor) col.fromArray(this._placedMesh.instanceColor.array, i * 3);
                    placed.push({ k: this._placedKeys[i] || '', c: col.getHex(), m: Array.from(m.elements).map((v) => +v.toFixed(3)) });
                }
                const data = {
                    v: 1,
                    placed,
                    dug: Array.from(this._dugDepth.entries()),
                    holes: Array.from(this._holes),
                };
                localStorage.setItem('pjboy.planetEdits.' + (this._activeKey || 'home'), JSON.stringify(data));
            } catch (e) { /* quota / serialise errors are non-fatal */ }
            this._editsDirty = false;
            this._lastSave = (typeof performance !== 'undefined') ? performance.now() : 0;
        }

        _restoreEdits() {
            let data = null;
            try { data = JSON.parse(localStorage.getItem('pjboy.planetEdits.' + (this._activeKey || 'home')) || 'null'); } catch (e) { data = null; }
            if (!data || data.v !== 1) return;
            const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3();
            const zero = new THREE.Matrix4().makeScale(0, 0, 0);

            // Dug terrain — lower the tile and recolour to match _digTerrain.
            for (const [key, depth] of (data.dug || [])) {
                this._dugDepth.set(key, depth);
                const inst = this._instOfKey(key);
                if (inst < 0) continue;
                const p = key.split(',');
                const fr = cellFrame(+p[0], +p[1], +p[2]);
                q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.tU, fr.n, fr.tV));
                pos.copy(fr.c).multiplyScalar(fr.baseRR - TILE_H / 2 - depth * ELEV_STEP);
                m.compose(pos, q, new THREE.Vector3(fr.cellW, TILE_H, fr.cellW));
                this._planet.setMatrixAt(inst, m);
                this._planet.setColorAt(inst, new THREE.Color(depth <= 1 ? 0x6b4f2a : 0x70726f));
            }
            // Holes — remove the tile entirely.
            for (const key of (data.holes || [])) {
                this._holes.add(key);
                const inst = this._instOfKey(key);
                if (inst >= 0) this._planet.setMatrixAt(inst, zero);
            }
            this._planet.instanceMatrix.needsUpdate = true;
            if (this._planet.instanceColor) this._planet.instanceColor.needsUpdate = true;

            // Player-placed blocks — restore exact transforms/colours and rebuild stacks.
            const placed = data.placed || [];
            for (let i = 0; i < placed.length && i < MAXP; i++) {
                m.fromArray(placed[i].m);
                this._placedMesh.setMatrixAt(i, m);
                this._placedMesh.setColorAt(i, new THREE.Color(placed[i].c));
                this._placedKeys[i] = placed[i].k;
                this._placedStacks.set(placed[i].k, (this._placedStacks.get(placed[i].k) || 0) + 1);
            }
            this._placedCount = Math.min(placed.length, MAXP);
            this._placedMesh.count = this._placedCount;
            this._placedMesh.instanceMatrix.needsUpdate = true;
            if (this._placedMesh.instanceColor) this._placedMesh.instanceColor.needsUpdate = true;
        }

        _findLandDir() {
            const d = new THREE.Vector3();
            for (let i = 0; i < 200; i++) {
                d.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
                if (d.lengthSq() < 0.01) continue;
                d.normalize();
                if (this.elevationAt(d) > 2) return d.clone();
            }
            return new THREE.Vector3(0, 1, 0);
        }

        // ---- scene look (sky → space, fog off, lights) ----

        _setupScene() {
            const g = this.game;
            this._saved = {
                skyMat: g.sky ? g.sky.material : null,
                fog: g.scene.fog || null,
                groundVisible: g.ground ? g.ground.visible : null,
                gridVisible: g.gridHelper ? g.gridHelper.visible : null,
                cheeseVisible: g.cheeseFloor ? g.cheeseFloor.visible : null,
                roofVisible: g.crystalRoof ? g.crystalRoof.visible : null,
                roofY: g.roofY,
                skyRenderOrder: g.sky ? g.sky.renderOrder : 0,
            };
            if (g.sky) {
                // depthWrite off → the sky is a pure background fill that never occludes
                // anything by depth (so the far sun, stars, and other worlds stay visible at any
                // altitude). renderOrder -2000 draws it first, under everything else.
                g.sky.material = new THREE.MeshBasicMaterial({ color: 0x05060d, side: THREE.BackSide, depthWrite: false });
                g.sky.renderOrder = -2000;
            }
            g.scene.fog = null;                 // see the planet from space
            if (g.ground) g.ground.visible = false;
            if (g.gridHelper) g.gridHelper.visible = false;
            if (g.cheeseFloor) g.cheeseFloor.visible = false;
            if (g.crystalRoof) g.crystalRoof.visible = false;
            g.roofY = null;

            this._sun = new THREE.DirectionalLight(0xfff3e0, 0.85);
            this._sun.position.set(R * 3, R * 2, R * 1.5);
            g.scene.add(this._sun);
            g.scene.add(this._sun.target);
            this._ambient = new THREE.AmbientLight(0x4a5a78, 0.5);
            g.scene.add(this._ambient);
        }

        _restoreScene() {
            const g = this.game;
            const s = this._saved;
            if (!s) return;
            if (s.skyMat && g.sky) g.sky.material = s.skyMat;
            if (g.sky) g.sky.renderOrder = s.skyRenderOrder || 0;
            g.scene.fog = s.fog;
            if (g.ground && s.groundVisible != null) g.ground.visible = s.groundVisible;
            if (g.gridHelper && s.gridVisible != null) g.gridHelper.visible = s.gridVisible;
            if (g.cheeseFloor && s.cheeseVisible != null) g.cheeseFloor.visible = s.cheeseVisible;
            if (g.crystalRoof && s.roofVisible != null) g.crystalRoof.visible = s.roofVisible;
            if (s.roofY != null) g.roofY = s.roofY;
            if (g.camera) g.camera.up.set(0, 1, 0); // undo radial up-vector
        }

        // ---- props ----

        _preloadProps() {
            if (this._assetsReady) { this._scatterProps(); return; }
            Promise.all(PROP_PATHS.map((p) => new Promise((res) => {
                this.loader.load(p, (gltf) => {
                    this.assetCache.set(p, gltf);
                    const src = gltf.scene || (gltf.scenes && gltf.scenes[0]);
                    if (src) {
                        const b = new THREE.Box3().setFromObject(src);
                        if (isFinite(b.min.y)) this.modelMinY.set(p, b.min.y);
                    }
                    res();
                }, undefined, () => res());
            }))).then(() => { this._assetsReady = true; this._scatterProps(); });
        }

        _cloneAsset(path) {
            const cached = this.assetCache.get(path);
            if (!cached) return null;
            const src = cached.scene || (cached.scenes && cached.scenes[0]);
            if (!src) return null;
            const obj = src.clone(true);
            obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
            return obj;
        }

        // Place one prop oriented to the surface normal at a direction.
        _place(path, dir, scale, rng) {
            const obj = this._cloneAsset(path);
            if (!obj) return;
            obj.scale.setScalar(scale);
            const minY = this.modelMinY.get(path) || 0;
            const rr = R + quantElev(dir) - minY * scale; // base sits on the tile top
            obj.position.copy(dir).multiplyScalar(rr);
            obj.quaternion.setFromUnitVectors(this._UPY || (this._UPY = new THREE.Vector3(0, 1, 0)), dir);
            obj.rotateY(rng() * Math.PI * 2); // spin about the surface normal
            this.game.scene.add(obj);
            obj.updateMatrixWorld(true);
            this._props.push(obj);
        }

        // Populate the planet by elevation band: lush grass zone, rocky highlands,
        // bare snow caps, sparse beaches. Even coverage via a Fibonacci sphere.
        _scatterProps() {
            if (this._props.length) return;
            const rng = mulberry32(SEED + 1);
            const N = 700;
            const ga = Math.PI * (3 - Math.sqrt(5));
            const dir = new THREE.Vector3();
            for (let i = 0; i < N; i++) {
                const y = 1 - (i / (N - 1)) * 2;
                const rad = Math.sqrt(Math.max(0, 1 - y * y));
                const th = ga * i;
                dir.set(Math.cos(th) * rad + (rng() - 0.5) * 0.05, y + (rng() - 0.5) * 0.05, Math.sin(th) * rad + (rng() - 0.5) * 0.05).normalize();
                const e = this.elevationAt(dir);
                if (e < 1) {                                   // beach / shallows — sparse rocks
                    if (rng() < 0.06) this._place(pick(PROP_ROCKS, rng), dir.clone(), 0.9 + rng() * 0.7, rng);
                } else if (e < AMP * 0.5) {                    // grass / forest — lush
                    const r = rng();
                    if (r < 0.18) this._place(pick(PROP_TREES, rng), dir.clone(), 1.3 + rng() * 0.9, rng);
                    else if (r < 0.21) this._place(pick(PROP_DEAD, rng), dir.clone(), 1.3 + rng() * 0.6, rng);
                    else if (r < 0.5) this._place(pick(PROP_SMALL, rng), dir.clone(), 0.8 + rng() * 0.7, rng);
                    else if (r < 0.56) this._place(pick(PROP_ROCKS, rng), dir.clone(), 1.0 + rng() * 0.8, rng);
                    else if (r < 0.6) this._place(pick(PROP_ANIMALS, rng), dir.clone(), 1.0 + rng() * 0.4, rng);
                } else if (e < AMP * 0.8) {                    // highlands — rocks, dead trees
                    const r = rng();
                    if (r < 0.14) this._place(pick(PROP_ROCKS, rng), dir.clone(), 1.0 + rng() * 1.0, rng);
                    else if (r < 0.18) this._place(pick(PROP_DEAD, rng), dir.clone(), 1.2 + rng() * 0.5, rng);
                }
                // snow caps (e ≥ AMP*0.8) stay bare
            }
        }

        _clearProps() {
            for (const o of this._props) this.game.scene.remove(o);
            this._props = [];
        }

        // ---- atmosphere: cloud layer + translucent sky shells ----

        // Translucent blue shells: a denser inner sky fading to a thin upper layer,
        // sized to the gravity zone. From the surface they tint the sky blue; from
        // space they read as an atmospheric halo around the globe.
        _buildAtmosphere() {
            const g = this.game;
            const mk = (r, color, op) => {
                const s = new THREE.Mesh(
                    new THREE.SphereGeometry(r, 48, 32),
                    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false })
                );
                s.frustumCulled = false;
                g.scene.add(s);
                return s;
            };
            const a = (this._activeDef && this._activeDef.atm) || [0x6db4ff, 0x8ec6ff, 0xbfe0ff];
            this._atm = [
                mk(R * 1.22, a[0], 0.10),  // lower sky
                mk(R * 1.45, a[1], 0.06),  // mid
                mk(R * 1.62, a[2], 0.035), // upper haze (~SOI_INNER)
            ];
        }

        // Cloud layer from the Cloud_*.glb models, scattered on a shell above the
        // surface and oriented flat to it. The group drifts slowly (see update()).
        _buildClouds() {
            const g = this.game;
            // Group added immediately; clouds populate once the GLBs load.
            this._clouds = new THREE.Group();
            this._clouds.frustumCulled = false;
            g.scene.add(this._clouds);
            if (!this.loader) this.loader = new THREE.GLTFLoader();
            Promise.all(CLOUD_PATHS.map((p) => new Promise((res) => {
                if (this.assetCache.has(p)) return res();
                this.loader.load(p, (gltf) => { this.assetCache.set(p, gltf); res(); },
                    undefined, (err) => { console.warn('[planet] cloud load failed', p, err && err.message); res(); });
            }))).then(() => this._scatterClouds());
        }

        _scatterClouds() {
            if (!this._clouds) return;
            const rng = mulberry32(SEED + 7);
            const CLOUD_R = R * 1.4;  // well above the highest peaks (~105)
            const NC = 60;
            const ga = Math.PI * (3 - Math.sqrt(5));
            const UPY = new THREE.Vector3(0, 1, 0);
            const size = new THREE.Vector3();
            for (let i = 0; i < NC; i++) {
                const y = 1 - (i / (NC - 1)) * 2;
                const rad = Math.sqrt(Math.max(0, 1 - y * y));
                const th = ga * i;
                const n = new THREE.Vector3(Math.cos(th) * rad, y, Math.sin(th) * rad).normalize();
                const src = this.assetCache.get(pick(CLOUD_PATHS, rng));
                const tmpl = src && (src.scene || (src.scenes && src.scenes[0]));
                if (!tmpl) continue;
                const obj = tmpl.clone(true);
                obj.traverse((o) => {
                    if (o.isMesh && o.material) {
                        o.castShadow = o.receiveShadow = false;
                        o.material = o.material.clone();
                        o.material.fog = false;
                        o.material.transparent = true;
                        o.material.opacity = 0.92;
                        if (o.material.color) o.material.color.setHex(0xffffff);
                    }
                });
                new THREE.Box3().setFromObject(obj).getSize(size);
                const maxd = Math.max(size.x, size.y, size.z) || 1;
                obj.scale.setScalar((9 + rng() * 12) / maxd); // ~9–21u wide
                obj.position.copy(n).multiplyScalar(CLOUD_R + (rng() - 0.5) * 8);
                obj.quaternion.setFromUnitVectors(UPY, n); // lie flat on the shell
                obj.rotateY(rng() * Math.PI * 2);
                this._clouds.add(obj);
            }
        }

        _clearAtmosphere() {
            const g = this.game;
            if (this._atm) { for (const s of this._atm) g.scene.remove(s); this._atm = null; }
            if (this._clouds) { g.scene.remove(this._clouds); this._clouds = null; }
        }

        // ---- the sun: solar-system center + primary light source ----

        // The star sits ~100,000 units away (its light), off the flight line. Its
        // disk is a camera-following billboard in the same direction so it stays
        // visible (inside the sky + far plane) yet reads as infinitely distant.
        _buildSun() {
            const g = this.game;
            const flight = this._destCenter.clone().normalize();
            const perp = flight.clone().cross(new THREE.Vector3(0, 1, 0));
            if (perp.lengthSq() < 1e-4) perp.set(1, 0, 0);
            perp.normalize();
            // Direction to the star (off the flight line), then its true far position.
            this._sunDir = flight.clone().multiplyScalar(0.5).addScaledVector(perp, 0.7).normalize();
            this._sunCenter.copy(this._sunDir).multiplyScalar(SUN_DIST);

            const grp = new THREE.Group();
            grp.add(new THREE.Mesh(
                new THREE.IcosahedronGeometry(SUN_RADIUS, 3),
                new THREE.MeshBasicMaterial({ color: 0xfff2b0 })
            ));
            const halo = (r, color, op) => new THREE.Mesh(
                new THREE.SphereGeometry(r, 32, 24),
                new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })
            );
            grp.add(halo(SUN_RADIUS * 1.5, 0xffd56a, 0.5));
            grp.add(halo(SUN_RADIUS * 2.4, 0xffb347, 0.25));
            grp.traverse((o) => { o.frustumCulled = false; });
            grp.position.copy(this._sunDir).multiplyScalar(SUN_RENDER_DIST); // updated to follow the camera
            g.scene.add(grp);
            this._sunMesh = grp;

            // Light from the real far position → near-parallel rays across the system
            // (distance 0 = no falloff). Lights the sun-facing hemisphere of both worlds.
            this._sunLight = new THREE.PointLight(0xfff4d6, 1.5, 0);
            this._sunLight.position.copy(this._sunCenter);
            g.scene.add(this._sunLight);
            if (this._sun) this._sun.intensity = 0.18; // old directional → faint fill only
        }

        _clearSun() {
            const g = this.game;
            if (this._sunMesh) { g.scene.remove(this._sunMesh); this._sunMesh = null; }
            if (this._sunLight) { g.scene.remove(this._sunLight); this._sunLight = null; }
        }

        // ---- starfield: deep-space backdrop for orientation ----

        // A camera-following sphere of points (renders as the farthest background).
        // Because it follows the camera, stars hold fixed sky directions — they stay
        // put as you translate and sweep as you turn, giving a sense of heading in
        // the black void between planets.
        _buildStars() {
            const N = 1800;
            const STAR_R = 600;          // inside the far plane; shell follows the camera
            const pos = new Float32Array(N * 3);
            const col = new Float32Array(N * 3);
            const rng = mulberry32(SEED + 99);
            for (let i = 0; i < N; i++) {
                const u = rng() * 2 - 1, th = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
                pos[i * 3] = s * Math.cos(th) * STAR_R;
                pos[i * 3 + 1] = u * STAR_R;
                pos[i * 3 + 2] = s * Math.sin(th) * STAR_R;
                const b = 0.55 + rng() * 0.45, t = rng();
                let r = b, gc = b, bl = b;
                if (t < 0.15) { gc = b * 0.85; bl = b * 0.7; }        // warm
                else if (t < 0.32) { r = b * 0.8; gc = b * 0.9; }     // cool blue
                col[i * 3] = r; col[i * 3 + 1] = gc; col[i * 3 + 2] = bl;
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
            const mat = new THREE.PointsMaterial({
                size: 2, sizeAttenuation: false, vertexColors: true,
                // Opaque + low renderOrder → drawn right after the sky (which is at
                // renderOrder -2000) and before scene geometry. depthTest off so the
                // 500-radius sky shell never occludes them; depthWrite off so terrain,
                // planets, and the rocket still draw over them.
                depthTest: false, depthWrite: false
            });
            const pts = new THREE.Points(geo, mat);
            pts.frustumCulled = false;
            pts.renderOrder = -1000; // farthest background (drawn before all scene geometry)
            this.game.scene.add(pts);
            this._stars = pts;
        }

        _clearStars() {
            if (this._stars) { this.game.scene.remove(this._stars); this._stars = null; }
        }

        // ---- landmark: low-poly rocket ----

        // Build a flat-shaded toy rocket pointing up +Y, base (fin/engine tips) at
        // y ≈ -0.6. White hull, red ogive nose + delta fins, gold engine bell and a
        // little cockpit window facing +Z.
        _buildRocket() {
            const RAD = 8; // low radial segment count → chunky low-poly facets
            const grp = new THREE.Group();
            const white = new THREE.MeshStandardMaterial({ color: 0xeef1f3, roughness: 0.65, metalness: 0.05, flatShading: true });
            const red = new THREE.MeshStandardMaterial({ color: 0xb23b30, roughness: 0.6, metalness: 0.05, flatShading: true });
            const gold = new THREE.MeshStandardMaterial({ color: 0xc89a24, roughness: 0.4, metalness: 0.6, flatShading: true });
            const glass = new THREE.MeshStandardMaterial({ color: 0xbcd9e0, roughness: 0.25, metalness: 0.1, emissive: 0x21404a, emissiveIntensity: 0.6, flatShading: true });
            const dark = new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.85, flatShading: true });

            // Hull (white cylinder), bottom at y=0.4, top at y=5.0.
            const body = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.05, 4.6, RAD), white);
            body.position.y = 2.7;
            grp.add(body);

            // Red collar blending the nose into the hull.
            const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.4, RAD), red);
            collar.position.y = 4.95;
            grp.add(collar);

            // Red ogive nose (cone).
            const nose = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.6, RAD), red);
            nose.position.y = 6.3;
            grp.add(nose);

            // Cockpit window on the +Z face, with a red rim.
            const win = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.14, 8), glass);
            win.rotation.x = Math.PI / 2; // disc faces ±Z
            win.position.set(0, 4.15, 1.0);
            grp.add(win);
            const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.08, 6, 8), red);
            rim.position.set(0, 4.15, 0.98);
            grp.add(rim);

            // Engine: white skirt tapering to a gold bell with a dark throat.
            const skirt = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.6, 0.5, RAD), white);
            skirt.position.y = 0.25;
            grp.add(skirt);
            const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.82, 0.55, RAD), gold);
            bell.position.y = -0.27;
            grp.add(bell);
            const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, RAD), dark);
            throat.position.y = -0.42;
            grp.add(throat);

            // Three swept delta fins (white with a red inset), spaced 120° and angled
            // so none blocks the +Z window.
            const finOutline = (a, b, c) => {
                const s = new THREE.Shape();
                s.moveTo(a[0], a[1]); s.lineTo(b[0], b[1]); s.lineTo(c[0], c[1]); s.lineTo(a[0], a[1]);
                return s;
            };
            const whiteFin = finOutline([0.0, 2.9], [0.0, 0.0], [2.2, -0.6]);
            const redFin = finOutline([0.18, 2.3], [0.18, 0.25], [1.65, -0.3]);
            const buildFin = () => {
                const fin = new THREE.Group();
                const wg = new THREE.ExtrudeGeometry(whiteFin, { depth: 0.22, bevelEnabled: false });
                wg.translate(0, 0, -0.11);
                fin.add(new THREE.Mesh(wg, white));
                const rg = new THREE.ExtrudeGeometry(redFin, { depth: 0.30, bevelEnabled: false });
                rg.translate(0, 0, -0.15); // protrudes past the white faces so it reads on both sides
                fin.add(new THREE.Mesh(rg, red));
                return fin;
            };
            for (let i = 0; i < 3; i++) {
                const fin = buildFin();
                fin.rotation.y = (30 + i * 120) * Math.PI / 180;
                grp.add(fin);
            }

            // Engine exhaust (hidden until the engine lights), parented at the nozzle.
            const exhaust = this._buildExhaust();
            exhaust.position.y = -0.5;
            grp.add(exhaust);
            grp.userData.exhaust = exhaust;

            grp.traverse((o) => { if (o.isMesh) o.castShadow = false; });
            return grp;
        }

        // Additive flame cones + a drifting spark cloud, all in the rocket's local
        // space (so they ride along once parented to the nozzle).
        _buildExhaust() {
            const ex = new THREE.Group();
            const flame = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
            const outer = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.4, 8), flame(0xff5a18, 0.8));
            outer.rotation.x = Math.PI; outer.position.y = -1.2; // apex points down (-y)
            const inner = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.5, 8), flame(0xffd23a, 0.95));
            inner.rotation.x = Math.PI; inner.position.y = -0.75;
            ex.add(outer, inner);

            const N = 36;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
            const spark = [];
            for (let i = 0; i < N; i++) spark.push({ y: -Math.random() * 2, r: Math.random(), a: Math.random() });
            const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffc24a, size: 0.22, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
            ex.add(pts);

            ex.visible = false;
            ex.userData = { outer, inner, geo, spark };
            return ex;
        }

        // Animate the flame each step. `on` lights it, `throttle` (0..1) sets length.
        _updateExhaust(dt, on, throttle) {
            const ex = this._rocket && this._rocket.userData.exhaust;
            if (!ex) return;
            if (!on) { ex.visible = false; return; }
            ex.visible = true;
            const u = ex.userData;
            const len = 0.5 + throttle;
            const flick = 0.82 + Math.random() * 0.36;
            u.outer.scale.set(flick, len * flick, flick);
            u.inner.scale.set(1, len * (0.7 + Math.random() * 0.5), 1);
            u.outer.material.opacity = 0.55 + 0.35 * throttle;
            // sparks stream downward and recycle at the nozzle
            const pos = u.geo.attributes.position.array;
            const reach = 2.6 * len;
            for (let i = 0; i < u.spark.length; i++) {
                const s = u.spark[i];
                s.y -= (4 + 7 * throttle) * dt;
                if (s.y < -reach) { s.y = 0; s.r = Math.random(); s.a = Math.random(); }
                const spread = 0.4 * (-s.y / reach) * s.r;
                const ang = s.a * 6.283;
                pos[i * 3] = Math.cos(ang) * spread;
                pos[i * 3 + 1] = s.y;
                pos[i * 3 + 2] = Math.sin(ang) * spread;
            }
            u.geo.attributes.position.needsUpdate = true;
        }

        // Build the rocket once and stand it on the surface at `dir`.
        _placeRocket(dir) {
            this._rocket = this._buildRocket();
            this.game.scene.add(this._rocket);
            this._plantRocketAt(dir);
        }

        // Position + orient the (existing) rocket upright on the ground at `dir`,
        // fins resting on the tile top. Records the pad for boarding/proximity.
        _plantRocketAt(dir) {
            const rocket = this._rocket;
            if (!rocket) return;
            rocket.scale.setScalar(ROCKET_SCALE);
            const top = R + quantElev(dir);
            rocket.position.copy(dir).multiplyScalar(top - ROCKET_LOWEST * ROCKET_SCALE);
            rocket.quaternion.setFromUnitVectors(this._UPY || (this._UPY = new THREE.Vector3(0, 1, 0)), dir);
            rocket.updateMatrixWorld(true);
            this._rocketDir = dir.clone();
            this._rocketBase = dir.clone().multiplyScalar(top); // fin contact point
            if (rocket.userData.exhaust) rocket.userData.exhaust.visible = false;
        }

        // Find a land direction a short hop from `base` (so the landmark is visible
        // from spawn but not sitting on top of the player).
        _findLandNear(base) {
            const tan = new THREE.Vector3(0, 1, 0);
            if (Math.abs(base.dot(tan)) > 0.9) tan.set(1, 0, 0);
            tan.projectOnPlane(base).normalize();
            const out = new THREE.Vector3();
            for (let i = 0; i < 64; i++) {
                const ang = (14 + (i % 8) * 2.5) * Math.PI / 180;       // 14°..32° away
                const axis = tan.clone().applyAxisAngle(base, i * 1.37); // vary azimuth
                out.copy(base).applyAxisAngle(axis, ang).normalize();
                if (this.elevationAt(out) > 3) return out.clone();
            }
            return base.clone();
        }

        // ---- rocket: interaction & launch ----

        _ensurePromptUI() {
            if (this._promptEl) return this._promptEl;
            const el = document.createElement('div');
            el.id = 'planet-prompt';
            el.style.cssText = 'position:fixed;bottom:96px;left:50%;transform:translateX(-50%);'
                + 'z-index:50;padding:8px 16px;border-radius:10px;font:700 15px/1.2 system-ui,sans-serif;'
                + 'color:#fff;background:rgba(20,16,10,0.7);border:1px solid rgba(255,180,90,0.6);'
                + 'pointer-events:none;text-shadow:0 1px 2px #000;display:none;white-space:nowrap;';
            document.body.appendChild(el);
            this._promptEl = el;
            return el;
        }

        _showPrompt(txt) {
            const el = this._ensurePromptUI();
            if (!txt) { el.style.display = 'none'; return; }
            el.textContent = txt;
            el.style.display = 'block';
        }

        // E pressed: board if standing by the rocket, disembark if piloting.
        _onInteract() {
            const g = this.game;
            if (g.activeModeId !== 'planet' || !this._rocket) return;
            if (this._riding) this._tryDisembark();
            else if (this._nearRocket) this._boardRocket();
        }

        // Board → sit on the pad in the charge state (hold Space to charge).
        _boardRocket() {
            const g = this.game;
            this._riding = true;
            this._launching = true;
            this._charge = 0;
            this._spacePrev = false;
            this._autopilot = false;
            this._arrived = false;
            this._landed = false;
            this._nearRocket = false;
            this._showPrompt('');
            // Seed a launch-frame forward tangent (used for the hero cam + heading).
            this._fwd.copy(this._rocketDir).cross(new THREE.Vector3(0, 1, 0));
            if (this._fwd.lengthSq() < 1e-4) this._fwd.set(1, 0, 0);
            this._fwd.projectOnPlane(this._rocketDir).normalize();
            this._lastUp.copy(this._rocketDir);
            g.player.position.copy(this._rocketBase);
            g.player.velocity.set(0, 0, 0);
            if (g.player.model) g.player.model.visible = false; // pilot is inside
            g.flyMode = false;
            this._showCharge(true);
            this._updateChargeUI(0);
            g.showMessage && g.showMessage('🚀 Hold SPACE to charge launch — release to blast off', 3200);
        }

        _tryDisembark() {
            const g = this.game;
            const p = g.player.position;
            const dir = p.clone().sub(this._center);
            const pr = dir.length() || 1;
            dir.divideScalar(pr);
            const groundR = this.groundRadius(dir);
            if (groundR > 0 && pr <= groundR + 6) {
                this._riding = false;
                this._launching = false;
                this._autopilot = false;
                this._arrived = false;
                this._charge = 0;
                this._showCharge(false);
                this._plantRocketAt(dir);                 // settle the rocket on the pad
                const side = this._fwd.clone().cross(dir).normalize();
                g.player.position.copy(dir).multiplyScalar(groundR + 0.5).addScaledVector(side, 3);
                g.player.velocity.set(0, 0, 0);
                this._lastUp.copy(dir);
                this._fwd.set(0, 1, 0);
                if (Math.abs(this._fwd.dot(dir)) > 0.9) this._fwd.set(1, 0, 0);
                this._fwd.projectOnPlane(dir).normalize();
                this._lastYaw = g.characterRotation || 0;
                g.fpvPitch = 0; // level the on-foot view after the flight
                if (g.applyViewModeToPlayerModel) g.applyViewModeToPlayerModel();
                this._showPrompt('');
                g.showMessage && g.showMessage('Touchdown on ' + this._activeDef.name + ' 🛬', 1800);
            } else if (this._arrived) {
                // Touchdown on the sister world → make it the world at the origin and
                // step out onto it (all walking/gravity/mining now run on that planet).
                const name = this._targetDef.name;
                this._swapWorlds();
                this._riding = false; this._launching = false; this._autopilot = false;
                this._arrived = false; this._charge = 0;
                this._showCharge(false);
                const spawn = this._findLandDir();
                this._plantRocketAt(spawn);
                const side = this._fwd.clone().cross(spawn).normalize();
                g.player.position.copy(spawn).multiplyScalar(this.groundRadius(spawn) + 0.5).addScaledVector(side, 3);
                g.player.velocity.set(0, 0, 0);
                this._lastUp.copy(spawn);
                this._fwd.set(0, 1, 0);
                if (Math.abs(this._fwd.dot(spawn)) > 0.9) this._fwd.set(1, 0, 0);
                this._fwd.projectOnPlane(spawn).normalize();
                this._lastYaw = g.characterRotation || 0;
                this._inside = false; this._inSpace = false;
                g.fpvPitch = 0;
                if (g.applyViewModeToPlayerModel) g.applyViewModeToPlayerModel();
                this._showPrompt('');
                g.showMessage && g.showMessage('🛬 Landed on ' + name + '! Walk around — board the rocket to fly back.', 3600);
            } else {
                g.showMessage && g.showMessage('Too high to disembark — fly down to a planet surface', 2000);
            }
        }

        // G while flying: cycle the destination through the other worlds, then off.
        // (cycle order: world A → world B → … → manual)
        _toggleCourse() {
            const g = this.game;
            const others = Object.keys(PLANETS).filter((k) => k !== this._activeKey);
            if (!this._autopilot) {
                // turn on, heading to the current target
                this._autopilot = true;
                this._setTarget(this._targetDef && this._targetDef.key !== this._activeKey ? this._targetDef.key : others[0]);
            } else {
                // advance to the next world, or switch autopilot off after the last
                const idx = others.indexOf(this._targetDef.key);
                const next = others[idx + 1];
                if (next) { this._setTarget(next); }
                else { this._autopilot = false; }
            }
            g.showMessage && g.showMessage(this._autopilot
                ? ('🛰 Course → ' + this._targetDef.name + '  (G: next world)')
                : 'Autopilot off — manual control', 1800);
        }

        // updatePlayer hook while piloting: charge on the pad, else free flight.
        _updateRocket(dt) {
            const g = this.game;
            const p = g.player.position;
            const up = this._up.copy(p).sub(this._center);
            const dist = up.length();
            if (dist > 0.5) up.divideScalar(dist); else up.copy(this._lastUp);
            this._lastUp.copy(up);
            if (this._launching) { this._updateCharging(dt, up, dist); return; }
            this._flyRocket(dt, p, up, dist);
        }

        // Pad charge phase: build charge while Space is held; launch on release.
        _updateCharging(dt, up, dist) {
            const g = this.game;
            const holding = !!g.keys['Space'];
            if (holding) this._charge = Math.min(1, this._charge + dt / CHARGE_TIME);
            this._plantRocketAt(this._rocketDir);                 // stay seated on the pad
            this._updateExhaust(dt, this._charge > 0.02, this._charge * 0.85); // sputter, grows
            this._updateAltUI(dist, up);
            this._updateChargeUI(this._charge);
            const released = this._spacePrev && !holding;
            this._spacePrev = holding;
            if ((released && this._charge > 0.12) || this._charge >= 1) this._launchNow();
        }

        _launchNow() {
            const g = this.game;
            this._launching = false;
            this._showCharge(false);
            // Launch frame at the pad: nose at the zenith, ship-up along the horizon.
            this._refUp.copy(this._rocketDir);
            this._refFwd.copy(this._fwd).projectOnPlane(this._refUp);
            if (this._refFwd.lengthSq() < 1e-6) this._refFwd.set(1, 0, 0).projectOnPlane(this._refUp);
            this._refFwd.normalize();
            this._quatLookNoseUp(this._shipQuat, this._refUp, this._refFwd);
            this._heading.copy(this._refUp);
            this._mouseDX = 0; this._mouseDY = 0;
            // Start from the planted origin so the mesh doesn't pop on launch.
            const DELTA = -ROCKET_LOWEST * ROCKET_SCALE;
            g.player.position.copy(this._rocketDir).multiplyScalar(R + quantElev(this._rocketDir) + DELTA);
            // Gentle initial nudge; the auto-thrust ramp builds speed gradually.
            g.player.velocity.copy(this._refUp).multiplyScalar(3 + this._charge * 4);
            this._liftoffMax = 1.5 + this._charge * 0.8;
            this._liftoffT = this._liftoffMax;
            this._landed = false;
            // Seed the chase cam from the pad hero shot so it eases in (no snap).
            this._camPos.copy(g.camera.position);
            this._camTarget.copy(this._rocketBase).addScaledVector(this._rocketDir, 8);
            this._camUpV.copy(this._rocketDir);
            this._camBlendT = 1.0;
            this._camLastT = (typeof performance !== 'undefined') ? performance.now() : 0;
            g.showMessage && g.showMessage('🚀 LIFTOFF!  Mouse: pitch/yaw · A/D roll · Space thrust · Shift brake · G → ' + ((this._targetDef && this._targetDef.name) || 'a world'), 4600);
            this._charge = 0;
        }

        // Quaternion whose local +Y (nose) points along `fwd` and local +Z (ship-up)
        // is `up` re-orthogonalised against the nose.
        _quatLookNoseUp(out, fwd, up) {
            const z = this._tang.copy(up).addScaledVector(fwd, -fwd.dot(up));
            if (z.lengthSq() < 1e-6) { z.set(0, 0, 1).addScaledVector(fwd, -fwd.dot(this._AXZ)); }
            z.normalize();
            const x = this._right.copy(fwd).cross(z); // local right = nose × up
            const m = this._basisM || (this._basisM = new THREE.Matrix4());
            m.makeBasis(x, fwd, z);
            return out.setFromRotationMatrix(m);
        }

        // True 6-DOF flight: orientation rotated in the ship's own frame (mouse =
        // pitch/yaw, A/D = roll), thrust along the nose, home gravity + sister-planet
        // pull, clamp to both surfaces.
        _flyRocket(dt, p, up, dist) {
            const g = this.game;
            const vel = g.player.velocity;
            const DELTA = -ROCKET_LOWEST * ROCKET_SCALE;

            // Raw mouse deltas (unclamped) -> local pitch/yaw; A/D -> roll.
            const SENS = 0.0022, ROLL = 1.8;
            const dPitch = -this._mouseDY * SENS;  // mouse up -> nose up
            const dYaw = this._mouseDX * SENS;     // mouse right -> nose right
            const dRoll = ((g.keys['KeyD'] ? 1 : 0) - (g.keys['KeyA'] ? 1 : 0)) * ROLL * dt;
            this._mouseDX = 0; this._mouseDY = 0;

            const toDest = this._dir2.copy(this._destCenter).sub(p);
            const destDist = toDest.length();
            if (destDist > 0) toDest.divideScalar(destDist);
            const destAltNow = destDist - this._destRadius - DELTA;
            const autoLanding = this._autopilot && destAltNow < 90;
            if (autoLanding && !this._autoLanding) { this._seedCamEase(); this._autoLandPhase = 0; }
            this._autoLanding = autoLanding;

            const q = this._shipQuat;
            if (this._landed) {
                // Parked on the fins: hold upright and ignore all steering input.
                const nc = (p.distanceToSquared(this._center) <= p.distanceToSquared(this._destCenter)) ? this._center : this._destCenter;
                const n = this._wish.copy(p).sub(nc).normalize();
                this._quatLookNoseUp(this._qTarget, n, this._shipUp);
                q.slerp(this._qTarget, Math.min(1, 8 * dt));
            } else if (this._autopilot) {
                // Cruise: aim at the target. Landing: aim straight up off the surface
                // (nose out / fins down) so it sets down cleanly on its legs.
                const aim = autoLanding ? this._wish.copy(toDest).negate() : toDest;
                this._quatLookNoseUp(this._qTarget, aim, this._shipUp);
                q.slerp(this._qTarget, Math.min(1, (autoLanding ? 4 : 2.5) * dt));
            } else {
                // Right-multiply by body-frame deltas (no gimbal lock, free roll).
                if (dPitch) q.multiply(this._qd.setFromAxisAngle(this._AXX, dPitch));
                if (dYaw) q.multiply(this._qd.setFromAxisAngle(this._AXZ, -dYaw));
                if (dRoll) q.multiply(this._qd.setFromAxisAngle(this._AXY, dRoll));
                q.normalize();
            }
            const H = this._heading.copy(this._AXY).applyQuaternion(q).normalize(); // nose dir
            this._shipUp.copy(this._AXZ).applyQuaternion(q).normalize();            // ship up

            // Throttle (W/Space forward, S/Shift/Ctrl reverse).
            let throttle = 0;
            if (this._autopilot) throttle = 1;
            else if (g.keys['Space'] || g.keys['KeyW']) throttle = 1;
            else if (g.keys['ShiftLeft'] || g.keys['ShiftRight'] || g.keys['ControlLeft'] || g.keys['KeyS']) throttle = -0.6;
            if (this._liftoffT > 0) {
                // Auto-thrust just after liftoff, eased in so speed builds gradually.
                this._liftoffT -= dt;
                const ramp = Math.min(1, (this._liftoffMax - this._liftoffT) / 0.5);
                if (throttle < ramp) throttle = ramp;
            }

            if (autoLanding) {
                // Ease velocity into a slow radial descent that gentles near the
                // surface — a clean, soft set-down straight onto the spot below.
                const nn = this._tang.copy(p).sub(this._destCenter).normalize();
                const drop = Math.max(2, Math.min(26, destAltNow * 0.5 + 1.5));
                const want = this._wish.copy(nn).multiplyScalar(-drop);
                vel.lerp(want, Math.min(1, 3.5 * dt));
            } else {
                // Forces: nose thrust, home gravity, a gentle pull near the sister planet.
                const THRUST = 60, MAXSP = 90;
                if (throttle) vel.addScaledVector(H, throttle * THRUST * dt);
                vel.addScaledVector(up, -GRAVITY * gravityScale(dist) * dt);
                if (destDist < this._destRadius * 3.2) {
                    const dg = 20 * (1 - destDist / (this._destRadius * 3.2));
                    vel.addScaledVector(toDest, dg * dt);
                }
                vel.multiplyScalar(1 - Math.min(0.5, 0.5 * dt));   // light drag for control
                const sp = vel.length(); if (sp > MAXSP) vel.multiplyScalar(MAXSP / sp);
            }

            p.addScaledVector(vel, dt);

            // Home surface clamp (origin rides DELTA above the fin contact point).
            const dir = this._dir.copy(p).sub(this._center);
            const pr = dir.length() || 1; dir.divideScalar(pr);
            const groundR = this.groundRadius(dir);
            if (groundR > 0 && pr < groundR + DELTA) {
                p.copy(dir).multiplyScalar(groundR + DELTA);
                const iw = dir.dot(vel); if (iw < 0) { this._contactSpeed = -iw; vel.addScaledVector(dir, -iw); }
            }

            // Sister-planet surface clamp + arrival.
            const dC = this._dir2.copy(p).sub(this._destCenter);
            const dpr = dC.length() || 1; dC.divideScalar(dpr);
            if (dpr < this._destRadius + DELTA) {
                p.copy(this._destCenter).addScaledVector(dC, this._destRadius + DELTA);
                const iw = dC.dot(vel); if (iw < 0) { this._contactSpeed = -iw; vel.addScaledVector(dC, -iw); }
                if (!this._arrived) {
                    this._arrived = true; this._autopilot = false;
                    g.showMessage && g.showMessage('🪐 Arrived at ' + this._targetDef.name + '!  Press E to land and explore.', 3400);
                }
            } else if (dpr > this._destRadius + DELTA + 6) this._arrived = false;

            // --- landing assist: pick the nearer surface (home or sister world) ---
            const homeSurf = (groundR > 0 ? groundR : R);
            const homeAlt = pr - homeSurf - DELTA;
            const destAlt = dpr - this._destRadius - DELTA;
            const lnHome = homeAlt <= destAlt;
            const lnDir = lnHome ? dir : dC;
            const lnAlt = lnHome ? homeAlt : destAlt;
            const lnCenter = lnHome ? this._center : this._destCenter;
            const lnSurf = lnHome ? homeSurf : this._destRadius;
            const descent = -lnDir.dot(vel);             // + = falling toward the surface
            const approaching = lnAlt < 50;

            if (approaching && !this._autopilot && !this._landed && descent > -2) {
                // Ease the nose upright off this surface so you settle on the fins.
                const k = Math.min(0.9, 1 - lnAlt / 50) * Math.min(1, 6 * dt);
                this._quatLookNoseUp(this._qTarget, lnDir, this._shipUp);
                q.slerp(this._qTarget, k);
                this._heading.copy(this._AXY).applyQuaternion(q).normalize();
                this._shipUp.copy(this._AXZ).applyQuaternion(q).normalize();
            }

            // Touchdown / lift-off edge detection (+ dust shockwave).
            if (lnAlt <= 0.4) {
                if (!this._landed) {
                    this._landed = true;
                    const hard = this._contactSpeed > 24;
                    this._spawnDust(lnCenter.clone().addScaledVector(lnDir, lnSurf), lnDir, hard ? 1.7 : 1.0);
                    if (!this._arrived) g.showMessage && g.showMessage(hard ? '🛬 Hard landing!' : '🛬 Touchdown — press E to step out', hard ? 2200 : 2600);
                    this._seedCamEase();   // ease into the ground-level touchdown shot
                }
            } else if (lnAlt > 2.5) {
                if (this._landed) { this._landed = false; this._seedCamEase(); } // ease back to chase
            }
            this._contactSpeed = 0;

            const inSpace = dist >= SOI_OUTER;
            if (inSpace !== this._inSpace) {
                this._inSpace = inSpace;
                g.showMessage && g.showMessage(inSpace ? '🚀 Reached space — zero gravity' : 'Re-entering atmosphere', 1800);
            }
            this._updateAltUI(dist, up);
            if (this._landed) this._showPrompt('🛬 Landed — E to step out · Space to lift off');
            else if (autoLanding) this._showPrompt('🛬 Auto-landing on ' + this._targetDef.name + ' · ' + Math.max(0, destAltNow).toFixed(0) + 'm');
            else if (approaching) this._showPrompt('⬇ LANDING · ' + Math.max(0, lnAlt).toFixed(0) + 'm · ↓' + Math.max(0, descent).toFixed(0) + (descent > 26 ? ' ⚠ slow down' : ''));
            else this._updateCourseUI(destDist);

            this._seatRocket(p, H);
            this._updateExhaust(dt, throttle > 0.05, Math.max(0, throttle));
        }

        // Orient the rocket so its nose (+Y) points along the heading H.
        _seatRocket(p, H) {
            const rocket = this._rocket;
            if (!rocket) return;
            rocket.position.copy(p);
            rocket.quaternion.copy(this._shipQuat); // full orientation incl. roll
            rocket.updateMatrixWorld(true);
        }

        // Expanding dust ring on the surface at touchdown (animated in update()).
        _spawnDust(pos, dirN, strength) {
            if (this._dust) { this.game.scene.remove(this._dust.ring); this._dust = null; }
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.5, 1.5, 28),
                new THREE.MeshBasicMaterial({ color: 0xcdbb93, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
            ring.quaternion.setFromUnitVectors(this._AXZ, dirN.clone().normalize());
            ring.position.copy(pos);
            this.game.scene.add(ring);
            this._dust = { ring, t: 0, life: 0.7, strength };
        }

        // Capture the current camera pose so the next framing eases in from it.
        _seedCamEase() {
            const cam = this.game.camera;
            this._camPos.copy(cam.position);
            this._camTarget.copy(this.game.player.position);
            this._camUpV.copy(cam.up);
            this._camBlendT = 1.0;
            this._camLastT = (typeof performance !== 'undefined') ? performance.now() : 0;
        }

        // Cinematic descent shot: a low front-3/4 view that slowly arcs around the
        // ship as it auto-lands, flowing seamlessly into the touchdown shot.
        _autoLandCamera() {
            const g = this.game;
            const cam = g.camera;
            const p = g.player.position;
            const surfUp = p.clone().sub(this._destCenter).normalize();
            const base = this._shipUp.clone().addScaledVector(surfUp, -this._shipUp.dot(surfUp));
            if (base.lengthSq() < 1e-4) base.copy(this._refFwd).addScaledVector(surfUp, -this._refFwd.dot(surfUp));
            base.normalize();
            const now = (typeof performance !== 'undefined') ? performance.now() : 0;
            const dt = Math.min(0.05, (now - (this._camLastT || now)) / 1000);
            this._camLastT = now;
            this._autoLandPhase += dt * 0.22;                 // slow cinematic arc
            const front = base.applyAxisAngle(surfUp, this._autoLandPhase);
            const desiredPos = p.clone().addScaledVector(front, 22).addScaledVector(surfUp, 6);
            const desiredTgt = p.clone().addScaledVector(surfUp, 4);
            const a = 1 - Math.exp(-dt / 0.3);
            this._camPos.lerp(desiredPos, a);
            this._camTarget.lerp(desiredTgt, a);
            this._camUpV.lerp(surfUp, a).normalize();
            cam.up.copy(this._camUpV);
            cam.position.copy(this._camPos);
            cam.lookAt(this._camTarget);
        }

        // Settled ground-level shot of the parked rocket (eases in after touchdown).
        _landedCamera() {
            const g = this.game;
            const cam = g.camera;
            const p = g.player.position;
            const center = p.distanceToSquared(this._center) <= p.distanceToSquared(this._destCenter)
                ? this._center : this._destCenter;
            const surfUp = p.clone().sub(center).normalize();
            // Azimuth from the ship's window side, flattened onto the surface.
            const front = this._shipUp.clone().addScaledVector(surfUp, -this._shipUp.dot(surfUp));
            if (front.lengthSq() < 1e-4) front.copy(this._refFwd).addScaledVector(surfUp, -this._refFwd.dot(surfUp));
            front.normalize();
            const desiredPos = p.clone().addScaledVector(front, 18).addScaledVector(surfUp, 7);
            const desiredTgt = p.clone().addScaledVector(surfUp, 5);
            const now = (typeof performance !== 'undefined') ? performance.now() : 0;
            const dt = Math.min(0.05, (now - (this._camLastT || now)) / 1000);
            this._camLastT = now;
            const a = 1 - Math.exp(-dt / 0.28);
            this._camPos.lerp(desiredPos, a);
            this._camTarget.lerp(desiredTgt, a);
            this._camUpV.lerp(surfUp, a).normalize();
            cam.up.copy(this._camUpV);
            cam.position.copy(this._camPos);
            cam.lookAt(this._camTarget);
        }

        // Chase cam: low hero angle while charging, behind-the-nose while flying.
        _rocketCamera() {
            const g = this.game;
            const cam = g.camera;
            if (this._launching) {
                cam.up.copy(this._rocketDir);
                cam.position.copy(this._rocketBase).addScaledVector(this._rocketDir, 4).addScaledVector(this._fwd, -18);
                cam.lookAt(this._rocketBase.clone().addScaledVector(this._rocketDir, 8));
                return;
            }
            if (this._landed) { this._landedCamera(); return; }
            if (this._autoLanding) { this._autoLandCamera(); return; }
            const p = g.player.position;
            const H = this._heading;
            const shipUp = this._shipUp; // rolls with the ship
            const speed = g.player.velocity.length();
            const back = 15 + Math.min(24, speed * 0.28);

            // Tail-chase framing (ideal in open space).
            const desiredPos = p.clone().addScaledVector(H, -back).addScaledVector(shipUp, 5.5);
            const desiredTgt = p.clone().addScaledVector(H, 14);
            const desiredUp = shipUp.clone();

            // Near the home planet, blend toward a planet-relative shot that trails the
            // ship HORIZONTALLY and stays above the surface — so a vertical ascent is
            // never filmed from under the ground. Fades out by ~140m altitude.
            const homeUp = p.clone().sub(this._center);
            const hd = homeUp.length();
            if (hd > 0.5) homeUp.divideScalar(hd); else homeUp.copy(this._refUp);
            const groundR = this.groundRadius(homeUp);
            const alt = Math.max(0, hd - (groundR > 0 ? groundR : R));
            // Blend to the side-shot by how VERTICAL the flight is (a straight climb
            // keeps the stable side framing through low altitude — no mid-ascent
            // swing) and only while near home; far away it's always the tail-chase.
            const vert = Math.min(1, Math.abs(H.dot(homeUp)));   // 1 = straight up/down
            const tt = Math.max(0, Math.min(1, (alt - 240) / 320));
            const near = 1 - tt * tt * (3 - 2 * tt);             // 1 near home -> 0 by ~560m
            const planetF = vert * near;
            if (planetF > 0.001) {
                // Trail behind the ship's horizontal travel (fall back to launch fwd
                // while going straight up, when H has no horizontal component).
                const horiz = H.clone().addScaledVector(homeUp, -H.dot(homeUp));
                if (horiz.lengthSq() < 1e-4) horiz.copy(this._refFwd).addScaledVector(homeUp, -this._refFwd.dot(homeUp));
                if (horiz.lengthSq() < 1e-6) horiz.copy(this._refFwd);
                horiz.normalize();
                desiredPos.lerp(p.clone().addScaledVector(horiz, -back * 0.85).addScaledVector(homeUp, 11), planetF);
                desiredTgt.lerp(p.clone().addScaledVector(homeUp, 4), planetF);
                desiredUp.lerp(homeUp, planetF).normalize();
            }
            // Safety: never let the camera dip below the local surface.
            const camRel = desiredPos.clone().sub(this._center);
            const cr = camRel.length() || 1;
            const cd = camRel.divideScalar(cr);
            const cg = this.groundRadius(cd);
            const minR = (cg > 0 ? cg : R) + 4;
            if (cr < minR) desiredPos.copy(this._center).addScaledVector(cd, minR);

            // Ease the actual camera toward the desired framing right after liftoff.
            if (this._camBlendT > 0) {
                const now = (typeof performance !== 'undefined') ? performance.now() : 0;
                const dt = Math.min(0.05, (now - (this._camLastT || now)) / 1000);
                this._camLastT = now;
                this._camBlendT -= dt;
                const a = 1 - Math.exp(-dt / 0.16);
                this._camPos.lerp(desiredPos, a);
                this._camTarget.lerp(desiredTgt, a);
                this._camUpV.lerp(desiredUp, a).normalize();
                cam.up.copy(this._camUpV);
                cam.position.copy(this._camPos);
                cam.lookAt(this._camTarget);
            } else {
                cam.up.copy(desiredUp);
                cam.position.copy(desiredPos);
                cam.lookAt(desiredTgt);
            }
        }

        // ---- planets (props) + flight target + launch HUD ----

        _orbitOf(def) { return new THREE.Vector3().fromArray(def.orbit.dir).normalize().multiplyScalar(def.orbit.dist); }
        _propRadiusOf(def) { return def.R * PROP_SCALE; }

        // Select which world the flight is heading to (drives autopilot + arrival).
        _setTarget(key) {
            this._targetDef = PLANETS[key];
            this._destCenter.copy(this._orbitOf(this._targetDef));
            this._destRadius = this._propRadiusOf(this._targetDef);
        }

        _clearPlanetProps() {
            const g = this.game;
            for (const k in this._propMeshes) {
                const rec = this._propMeshes[k];
                if (rec && rec.group) g.scene.remove(rec.group);
            }
            this._propMeshes = {};
        }

        // Build a distant prop for EVERY non-active world. By default each is a CHEAP
        // body (low-poly icosphere + atmosphere halo); the real coarse terrain globe
        // is built lazily on approach (see _updatePropLOD). Stored per-key as
        // { group, def, cheap, terrain }.
        _buildPlanetProps() {
            this._clearPlanetProps();
            for (const key in PLANETS) {
                if (key === this._activeKey) continue;
                this._propMeshes[key] = this._buildOneProp(PLANETS[key]);
            }
            // Keep a valid flight target.
            if (!this._targetDef || this._targetDef.key === this._activeKey) {
                const first = Object.keys(PLANETS).find((k) => k !== this._activeKey);
                this._setTarget(first);
            } else {
                this._setTarget(this._targetDef.key);
            }
        }

        // Cheap far-LOD body: a low-poly icosphere coloured by the world's sky tint,
        // plus an additive atmosphere halo. Built at R-scale inside a group that's
        // scaled to prop size and parked at the orbit. This is the default for every
        // non-active world.
        _buildOneProp(def) {
            const g = this.game;
            const grp = new THREE.Group();
            const cheap = new THREE.Group();
            // Sized by THIS world's own radius (not the active world's R).
            cheap.add(new THREE.Mesh(new THREE.IcosahedronGeometry(def.R, 2),
                new THREE.MeshStandardMaterial({ color: def.sky, roughness: 0.85, metalness: 0.0, flatShading: true })));
            // Atmosphere halo (built at def.R-scale; group scale shrinks to prop size).
            cheap.add(new THREE.Mesh(new THREE.SphereGeometry(def.R * 1.14, 24, 16),
                new THREE.MeshBasicMaterial({ color: def.atm[1], transparent: true, opacity: 0.16, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })));
            cheap.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
            grp.add(cheap);
            grp.scale.setScalar(PROP_SCALE);            // R-scale body → prop size
            grp.position.copy(this._orbitOf(def));
            g.scene.add(grp);
            return { group: grp, def, cheap, terrain: null };
        }

        // Near-LOD: the real coarse terrain globe (tiles + water + halo), built at
        // R-scale and added into the prop's group. Generated with this world's params
        // via a temporary setActivePlanet()/restore so elevation/colour match landing.
        _buildPropTerrain(def) {
            this._ensureCubeGeo();
            const sub = new THREE.Group();
            const restore = this._activeDef;
            setActivePlanet(def);                       // generate with this world's params
            const NP = 40;
            const count = 6 * NP * NP;
            const tiles = new THREE.InstancedMesh(this._cubeGeo, this._cubeMat, count);
            tiles.frustumCulled = false;
            const m = new THREE.Matrix4(), q = new THREE.Quaternion(), basis = new THREE.Matrix4();
            const pos = new THREE.Vector3(), scl = new THREE.Vector3(), col = new THREE.Color();
            let i = 0;
            for (let face = 0; face < 6; face++)
                for (let iu = 0; iu < NP; iu++)
                    for (let iv = 0; iv < NP; iv++) {
                        const fr = cellFrame(face, iu, iv, NP);
                        basis.makeBasis(fr.tU, fr.n, fr.tV);
                        q.setFromRotationMatrix(basis);
                        pos.copy(fr.c).multiplyScalar(fr.baseRR - TILE_H / 2);
                        scl.set(fr.cellW, TILE_H, fr.cellW);
                        m.compose(pos, q, scl);
                        tiles.setMatrixAt(i, m);
                        col.setHex(colorHex(fr.baseRR - R));
                        tiles.setColorAt(i, col);
                        i++;
                    }
            tiles.instanceMatrix.needsUpdate = true;
            if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
            sub.add(tiles);
            sub.add(new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28),
                new THREE.MeshLambertMaterial({ color: SEA_COLOR, transparent: true, opacity: 0.72 })));
            // Atmosphere halo (built at R-scale; parent group scale shrinks to prop size).
            sub.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.14, 24, 16),
                new THREE.MeshBasicMaterial({ color: def.atm[1], transparent: true, opacity: 0.16, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })));
            setActivePlanet(restore);
            sub.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
            return sub;
        }

        // Distance-based LOD for the distant planet props. Within an approach band,
        // lazily build the real coarse terrain globe and hide the cheap icosphere;
        // outside it (with hysteresis) drop the terrain and show the cheap body again.
        // Cheap bodies elsewhere keep the sky full of worlds at near-zero cost.
        _updatePropLOD() {
            const g = this.game;
            const cam = g.camera;
            if (!cam) return;
            for (const k in this._propMeshes) {
                const rec = this._propMeshes[k];
                if (!rec || !rec.group) continue;
                const propRadius = rec.def.R * PROP_SCALE;            // apparent radius
                const d = cam.position.distanceTo(rec.group.position); // group sits at the orbit
                const near = d < propRadius * 3 + 90;
                const far = d > propRadius * 3 + 160;                  // hysteresis gap
                if (near && !rec.terrain) {
                    // Upgrade to real terrain (built at R-scale; the group's PROP_SCALE shrinks it).
                    rec.terrain = this._buildPropTerrain(rec.def);
                    rec.group.add(rec.terrain);
                    if (rec.cheap) rec.cheap.visible = false;
                } else if (far && rec.terrain) {
                    // Downgrade back to the cheap body.
                    rec.group.remove(rec.terrain);
                    rec.terrain = null;
                    if (rec.cheap) rec.cheap.visible = true;
                }
            }
        }

        // Swap the world at the origin with the distant prop world (rebuilds terrain,
        // water, props, edit state, and the prop). Player/rocket placement is done by
        // the caller (disembark).
        // Land on the current TARGET world: it becomes the world at the origin; the
        // one you left (and all others) become distant props.
        _swapWorlds() {
            const g = this.game;
            if (this._editsDirty) this._saveEdits();        // persist the world we're leaving
            const newActive = this._targetDef;
            this._activeDef = newActive;
            this._activeKey = newActive.key;
            setActivePlanet(newActive);
            if (this._planet) g.scene.remove(this._planet);
            if (this._placedMesh) g.scene.remove(this._placedMesh);
            if (this._preview) { g.scene.remove(this._preview); this._preview = null; }
            if (this._water) g.scene.remove(this._water);
            this._clearProps();
            this._buildPlanet();                            // rebuilds + restores this world's edits
            if (newActive.props) this._preloadProps();      // vegetation only on worlds that have it
            this._clearAtmosphere();                        // rebuild sky + clouds for the new world
            this._buildAtmosphere();
            if (newActive.clouds) this._buildClouds();
            this._targetDef = null;                         // pick a fresh default target
            this._buildPlanetProps();                       // every other world becomes a prop
        }

        _ensureChargeUI() {
            if (this._chargeEl) return this._chargeEl;
            const wrap = document.createElement('div');
            wrap.id = 'planet-charge';
            wrap.style.cssText = 'position:fixed;bottom:132px;left:50%;transform:translateX(-50%);z-index:50;'
                + 'width:220px;height:16px;border-radius:9px;background:rgba(20,16,10,0.6);'
                + 'border:1px solid rgba(255,180,90,0.6);overflow:hidden;display:none;box-shadow:0 1px 3px #000;';
            const fill = document.createElement('div');
            fill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#ffd23a,#ff5a18);';
            wrap.appendChild(fill);
            document.body.appendChild(wrap);
            this._chargeEl = wrap; this._chargeFill = fill;
            return wrap;
        }

        _showCharge(on) { this._ensureChargeUI().style.display = on ? 'block' : 'none'; }
        _updateChargeUI(c) { this._ensureChargeUI(); this._chargeFill.style.width = (c * 100).toFixed(0) + '%'; }

        _updateCourseUI(destDist) {
            const m = destDist.toFixed(0);
            this._showPrompt(this._autopilot
                ? ('🛰 Autopilot → ' + this._targetDef.name + '  ·  ' + m + 'm  ·  [G] cancel')
                : ('[G] set course → ' + this._targetDef.name + '  ·  ' + m + 'm   ·   [E] land'));
        }

        // ---- altitude HUD ----

        _ensureAltUI() {
            if (this._altEl) return this._altEl;
            const el = document.createElement('div');
            el.id = 'planet-altitude';
            el.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);'
                + 'z-index:50;padding:4px 14px;border-radius:9px;font:600 14px/1.2 monospace;'
                + 'color:#ffd9a0;background:rgba(20,16,10,0.55);border:1px solid rgba(255,180,90,0.4);'
                + 'pointer-events:none;letter-spacing:0.5px;text-shadow:0 1px 2px #000;white-space:nowrap;';
            document.body.appendChild(el);
            this._altEl = el;
            return el;
        }

        // dir = unit radial direction, dist = radius from the planet center.
        _updateAltUI(dist, dir) {
            const el = this._altEl;
            if (!el) return;
            let txt;
            if (this._inside) {
                txt = '⛏ Underground · ' + Math.max(0, R - dist).toFixed(0) + 'm deep';
            } else {
                const alt = Math.max(0, dist - this.groundRadius(dir));
                if (this._inSpace) txt = '🚀 SPACE · ' + alt.toFixed(0) + 'm up';
                else txt = '⛰ Altitude ' + alt.toFixed(0) + 'm' + (dist >= SOI_INNER ? ' · low gravity' : '');
            }
            el.textContent = txt;
        }

        // ---- spherical player controller (called from game.js updatePlayer) ----

        updatePlayer(dt) {
            const g = this.game;
            const p = g.player.position;
            const vel = g.player.velocity;
            const center = this._center;

            // Piloting the rocket fully replaces the on-foot controller.
            if (this._riding) { this._updateRocket(dt); return; }

            // Boarding prompt when standing by the rocket.
            if (this._rocketBase) {
                const near = p.distanceTo(this._rocketBase) < 7;
                if (near !== this._nearRocket) {
                    this._nearRocket = near;
                    this._showPrompt(near ? 'Press E to board the rocket 🚀' : '');
                }
            }

            const up = this._up.copy(p).sub(center);
            const dist = up.length();
            if (dist > 0.5) { up.divideScalar(dist); this._lastUp.copy(up); }
            else { up.copy(this._lastUp); } // near the core radial-up is undefined — hold the last good one

            // Space-edge crossing (one-time cue; gravity is zero out here).
            const inSpace = dist >= SOI_OUTER;
            if (inSpace !== this._inSpace) {
                this._inSpace = inSpace;
                g.showMessage && g.showMessage(inSpace ? '🚀 Entering space — zero gravity' : "Back in the planet's pull", 2600);
            }
            this._updateAltUI(dist, up);

            // Parallel-transport the forward tangent + apply mouse yaw delta.
            const yaw = g.characterRotation || 0;
            const dYaw = yaw - this._lastYaw;
            this._lastYaw = yaw;
            const fwd = this._fwd;
            fwd.applyAxisAngle(up, dYaw);
            fwd.projectOnPlane(up);
            if (fwd.lengthSq() < 1e-6) { fwd.set(1, 0, 0); if (Math.abs(fwd.dot(up)) > 0.9) fwd.set(0, 0, 1); fwd.projectOnPlane(up); }
            fwd.normalize();
            const right = this._right.copy(fwd).cross(up).normalize();

            // Vertical: gravity or fly thrust (radial).
            const radial = up.dot(vel);
            if (g.flyMode) {
                // Faster vertical flight (scales with the explore speed boost) so you
                // can actually reach the space edge (~2.6R) in a few seconds.
                const flySpeed = 30 * (g.getSpeedBoostMultiplier ? g.getSpeedBoostMultiplier() : 1);
                let vy = 0;
                if (g.keys['Space']) vy += 1;
                if (g.keys['ShiftLeft'] || g.keys['ShiftRight'] || g.keys['ControlLeft']) vy -= 1;
                vel.addScaledVector(up, vy * flySpeed - radial); // set radial component
                this._onGround = false;
            } else {
                vel.addScaledVector(up, -GRAVITY * gravityScale(dist) * dt);
            }

            // Horizontal: WASD along the tangent plane.
            const f = (g.keys['KeyW'] ? 1 : 0) - (g.keys['KeyS'] ? 1 : 0);
            const s = (g.keys['KeyD'] ? 1 : 0) - (g.keys['KeyA'] ? 1 : 0);
            const moveSpeed = MOVE_SPEED * (g.getSpeedBoostMultiplier ? g.getSpeedBoostMultiplier() : 1);
            const wish = this._wish.set(0, 0, 0).addScaledVector(fwd, f).addScaledVector(right, s);
            const r2 = up.dot(vel);                 // radial after gravity/fly
            const tang = this._tang.copy(vel).addScaledVector(up, -r2); // tangential part
            if (wish.lengthSq() > 0) { wish.normalize().multiplyScalar(moveSpeed); } else { wish.set(0, 0, 0); }
            tang.lerp(wish, Math.min(1, 12 * dt));  // accelerate toward wish
            vel.copy(tang).addScaledVector(up, r2);

            // Jump.
            if (!g.flyMode && g.keys['Space'] && this._onGround) {
                vel.addScaledVector(up, JUMP);
                this._onGround = false;
            }

            // Integrate, then resolve against the shell. The shell is solid from
            // BOTH sides; a dug HOLE cell is the only passage. `_inside` tracks
            // whether we're in the hollow interior and only flips while over a hole,
            // so solid cells block in EVERY mode (walk, fall, fly): from outside you
            // stand on the outer face, from inside you stop at the inner face. This
            // stops flying out through rock and the "toggle fly → snap outside" jump.
            p.addScaledVector(vel, dt);
            const dir = this._dir.copy(p).sub(center);
            const pr = dir.length() || 1;
            dir.divideScalar(pr);
            const outerR = this.groundRadius(dir); // -1 over an open shaft
            this._onGround = false;

            if (outerR > 0) {                       // solid cell
                if (this._inside) {                 // hollow side → blocked at the inner face
                    const innerR = outerR - TILE_H;
                    if (pr > innerR) {
                        p.copy(dir).multiplyScalar(innerR);
                        const pen = dir.dot(vel);
                        if (pen > 0) vel.addScaledVector(dir, -pen); // kill push into the shell
                    }
                } else {                            // outside → stand / land / climb on the outer face
                    // Step-up look-ahead: sample the ground a little ahead along
                    // horizontal motion so we rise onto a small step BEFORE the body
                    // clips into its side. Capped to ~2 blocks so tall walls still block.
                    let groundR = outerR;
                    const h = this._stepH || (this._stepH = new THREE.Vector3());
                    h.copy(vel).addScaledVector(dir, -dir.dot(vel)); // tangential velocity
                    const hl = h.length();
                    if (hl > 0.001) {
                        const ahead = this._stepA || (this._stepA = new THREE.Vector3());
                        ahead.copy(p).addScaledVector(h, 1.3 / hl).normalize(); // ~1.3u ahead
                        const ag = this.groundRadius(ahead);
                        if (ag > groundR && ag - groundR <= ELEV_STEP * 2 + 0.1) groundR = ag;
                    }
                    if (pr < groundR) {
                        p.copy(dir).multiplyScalar(groundR);
                        const inward = dir.dot(vel);
                        if (inward < 0) vel.addScaledVector(dir, -inward);
                        if (!g.flyMode) this._onGround = true;
                    }
                }
            } else {                                // open shaft — the only crossing of the shell
                const surfR = R + quantElev(dir);
                if (!this._inside && pr < surfR - TILE_H) {
                    this._inside = true;            // entered the interior — freeze the camera up
                    this._coreUp.copy(up);
                    this._coreFwd.copy(this._fwd);
                    this._coreYaw0 = g.characterRotation || 0;
                } else if (this._inside && pr > surfR + 1) {
                    this._inside = false;           // climbed/flew back out into the sky
                }
            }

            // Orient the player model to stand on the surface.
            const model = g.player.model;
            if (model) {
                model.position.copy(p);
                model.up.copy(dir);
                model.lookAt(p.clone().add(fwd));
            }
        }

        // ---- camera (called from game.js updateCamera) ----

        updateCamera() {
            const g = this.game;
            const p = g.player.position;
            const center = this._center;
            const cam0 = g.camera;

            // Cinematic chase while piloting the rocket.
            if (this._riding) { this._rocketCamera(); return; }

            // Inside the planet: hold the up vector steady (the radial up would
            // otherwise flip 180° crossing the center) but still let the mouse
            // rotate the look around it.
            if (this._inside) {
                const fu = this._coreUp;
                const yaw = (g.characterRotation || 0) - this._coreYaw0;
                const pitch = g.fpvPitch || 0;
                const hfwd = this._coreFwd.clone().applyAxisAngle(fu, yaw);
                const look = hfwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(fu, Math.sin(pitch));
                cam0.up.copy(fu);
                if (g.viewMode === 'fpv') {
                    const eye = p.clone().addScaledVector(fu, EYE);
                    cam0.position.copy(eye);
                    cam0.lookAt(eye.clone().add(look));
                } else {
                    cam0.position.copy(p).addScaledVector(fu, 4).addScaledVector(hfwd, -12);
                    cam0.lookAt(p);
                }
                return;
            }

            const up = this._up.copy(p).sub(center);
            const ud = up.length();
            if (ud > 0.5) up.divideScalar(ud); else up.copy(this._lastUp); // steady view through the core
            const fwd = this._right.copy(this._fwd).projectOnPlane(up).normalize(); // reuse scratch
            const pitch = g.fpvPitch || 0;
            const cam = g.camera;
            cam.up.copy(up);

            if (g.viewMode === 'fpv') {
                const eye = p.clone().addScaledVector(up, EYE);
                const look = fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
                cam.position.copy(eye);
                cam.lookAt(eye.clone().add(look));
            } else {
                // Third-person chase that pulls back with altitude (frames the globe).
                const dir = this._dir.copy(p).sub(center).normalize();
                const alt = Math.max(0, p.length() - this.groundRadius(dir));
                const dist = 9 + Math.min(160, alt * 1.6);
                const height = 4 + Math.min(80, alt * 0.7);
                cam.position.copy(p).addScaledVector(up, height).addScaledVector(fwd, -dist);
                cam.lookAt(p);
            }
        }
    }

    window.PlanetWorld = PlanetWorld;
})();
