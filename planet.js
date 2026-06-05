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

    const R = 90;              // planet radius
    const DETAIL = 5;          // icosphere subdivision (~10k tris)
    const NOISE_SCALE = 1.9;   // terrain frequency on the unit sphere
    const AMP = 15;            // max land elevation above sea level
    const SEA_BIAS = 0.46;     // higher → more ocean
    const SEED = 9123;
    const GRAVITY = 26;
    const MOVE_SPEED = 9;
    const JUMP = 12;
    const EYE = 2.6; // raised: surface blocks (ELEV_STEP tall) sit higher than flat-world ones

    const ani = (n) => ROOT + 'Animals/' + n + '.gltf';
    const PROP_TREES = ['Tree_1', 'Tree_2', 'Tree_3'].map(env);
    const PROP_DEAD = ['DeadTree_1', 'DeadTree_2'].map(env);
    const PROP_SMALL = ['Bush', 'Flowers_1', 'Flowers_2', 'Mushroom', 'Grass_Big', 'Grass_Small', 'Plant_2', 'Plant_3'].map(env);
    const PROP_ROCKS = ['Rock1', 'Rock2'].map(env);
    const PROP_ANIMALS = ['Sheep', 'Chicken', 'Pig', 'Cat'].map(ani);
    const PROP_PATHS = [].concat(PROP_TREES, PROP_DEAD, PROP_SMALL, PROP_ROCKS, PROP_ANIMALS);
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
    const MAXP = 4000;         // max player-placed blocks
    function colorHex(e) {
        return e < -1.5 ? 0x8a7b50 : e < 1 ? 0xe6d6a8 : e < AMP * 0.45 ? 0x6fae3a
            : e < AMP * 0.8 ? 0x8a8d92 : 0xeaf2f7;
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
    function cellFrame(face, iu, iv) {
        const a = (iu + 0.5) / FACE_N * 2 - 1, b = (iv + 0.5) / FACE_N * 2 - 1;
        const c = faceDir(face, a, b);
        const step = 2 / FACE_N;
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
            this._right = new THREE.Vector3();
            this._dir = new THREE.Vector3();
            this._tang = new THREE.Vector3();
            this._wish = new THREE.Vector3();
            this._lastYaw = 0;
            this._onGround = false;
        }

        // Signed land height above sea level for a unit surface direction.
        elevationAt(dir) { return elevation(dir); }
        surfaceRadius(dir) { return R + elevation(dir); }

        // Walkable top radius in a direction = quantized surface + placed stack.
        groundRadius(dir) {
            const c = cellOf(dir);
            const stack = this._placedStacks.get(c.face + ',' + c.iu + ',' + c.iv) || 0;
            return R + quantElev(dir) + stack * ELEV_STEP;
        }

        // ---- lifecycle ----

        enter() {
            const g = this.game;
            if (!this.loader) this.loader = new THREE.GLTFLoader();
            this._buildPlanet();
            this._setupScene();
            this._preloadProps();
            if (g.clearEnemies) g.clearEnemies();

            // Spawn the player on land near a fixed direction.
            const spawn = this._findLandDir();
            const p = g.player.position;
            p.copy(spawn).multiplyScalar(this.groundRadius(spawn) + 0.5);
            g.player.velocity.set(0, 0, 0);
            // Seed a tangent forward and sync the yaw tracker.
            const up = this._up.copy(spawn).normalize();
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
            if (this._sun) { g.scene.remove(this._sun); g.scene.remove(this._sun.target); }
            if (this._ambient) g.scene.remove(this._ambient);
            this._clearProps();
            this._restoreScene();
        }

        // fixedUpdate hook — drive the placement preview (the controller runs via
        // the updatePlayer guard).
        update() {
            const g = this.game;
            const pv = this._preview;
            if (!pv) return;
            if (g.activeModeId !== 'planet' || !g.activeBlockId || this._placedCount >= MAXP) { pv.visible = false; return; }
            const hit = this._rayHit();
            if (!hit) { pv.visible = false; return; }
            const c = cellOf(hit.point.clone().normalize());
            const fr = cellFrame(c.face, c.iu, c.iv);
            const stack = this._placedStacks.get(fr.key) || 0;
            const centerR = fr.baseRR + stack * ELEV_STEP + ELEV_STEP / 2;
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
                new THREE.MeshLambertMaterial({ color: 0x2a6fb0, transparent: true, opacity: 0.72 })
            );
            this._water.frustumCulled = false; // camera sits on this giant sphere — cull math misfires
            this.game.scene.add(this._water);
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
            const centerR = fr.baseRR + stack * ELEV_STEP + ELEV_STEP / 2; // on top of the stack
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
        }

        mineBlock() {
            const hit = this._rayHit();
            if (!hit || hit.object !== this._placedMesh || hit.instanceId == null) return;
            const i = hit.instanceId;
            const key = this._placedKeys[i];
            if (key != null) {
                const stack = this._placedStacks.get(key) || 0;
                if (stack > 0) this._placedStacks.set(key, stack - 1);
            }
            this._placedMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); // hide
            this._placedMesh.instanceMatrix.needsUpdate = true;
            this.game.audio && this.game.audio.play && this.game.audio.play('swordHit');
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
            };
            if (g.sky) g.sky.material = new THREE.MeshBasicMaterial({ color: 0x05060d, side: THREE.BackSide });
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

        // ---- spherical player controller (called from game.js updatePlayer) ----

        updatePlayer(dt) {
            const g = this.game;
            const p = g.player.position;
            const vel = g.player.velocity;
            const center = this._center;

            const up = this._up.copy(p).sub(center);
            const dist = up.length() || 1;
            up.divideScalar(dist);

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
                const flySpeed = 18;
                let vy = 0;
                if (g.keys['Space']) vy += 1;
                if (g.keys['ShiftLeft'] || g.keys['ShiftRight'] || g.keys['ControlLeft']) vy -= 1;
                vel.addScaledVector(up, vy * flySpeed - radial); // set radial component
                this._onGround = false;
            } else {
                vel.addScaledVector(up, -GRAVITY * dt);
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

            // Integrate + ground clamp.
            p.addScaledVector(vel, dt);
            const dir = this._dir.copy(p).sub(center).normalize();
            const groundR = this.groundRadius(dir);
            if (!g.flyMode && p.length() <= groundR) {
                p.copy(dir).multiplyScalar(groundR);
                const inward = dir.dot(vel);
                if (inward < 0) vel.addScaledVector(dir, -inward); // kill sink, keep slide
                this._onGround = true;
            } else if (!g.flyMode) {
                this._onGround = false;
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
            const up = this._up.copy(p).sub(center).normalize();
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
