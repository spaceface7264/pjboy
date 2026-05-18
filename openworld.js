/*
 * OpenWorldSystem — adds a hub-and-spoke open world with spinning purple/black
 * portals to four themed sub-worlds (Bamboo Grove, Dog Farm, Crystal Ice
 * Caverns, Demon Crypt). Reuses the host Game3D's player, camera, gravity,
 * AABB collision (this.walls), and fixed-timestep loop. Loaded as a <script>
 * before game.js and exposed as window.OpenWorldSystem.
 */
(function () {
    'use strict';

    const ROOT = 'assets/Blocks/';

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

    class OpenWorldSystem {
        constructor(game) {
            this.game = game;
            this.scene = game.scene;
            this.loader = new THREE.GLTFLoader();
            this.assetCache = new Map();
            this.worlds = {};
            this.currentWorldId = null;
            this.active = false;
            this.transitioning = false;
            this.t = 0;
            this._builtWorlds = false;
            this._savedState = null;
            this._hiddenObjects = null;

            this.rootGroup = new THREE.Group();
            this.rootGroup.name = 'openworld-root';
            this.rootGroup.visible = false;
            this.scene.add(this.rootGroup);

            this.labelEl = null;
            this.zoneObjectives = {
                bambooGrove: false,
                dogFarm: false,
                iceCaverns: false,
                demonCrypt: false
            };
        }

        // ---------- entry / exit ----------

        async enter() {
            if (this.active) return;
            if (!this._builtWorlds) {
                await this.preloadAssets();
                this.buildAllWorlds();
                this._builtWorlds = true;
            }
            this._saveGameState();
            this.rootGroup.visible = true;
            this.active = true;
            this.transitionTo('hub', true);
            this._ensureLabel();
        }

        exit() {
            if (!this.active) return;
            this._unregisterAnimalsFromCombat(this.currentWorldId);
            this.active = false;
            this.rootGroup.visible = false;
            this._restoreGameState();
            if (this.labelEl) this.labelEl.style.display = 'none';
        }

        _saveGameState() {
            const g = this.game;
            this._savedState = {
                walls: g.walls,
                fog: this.scene.fog,
                bg: this.scene.background,
                gameMode: g.gameMode,
                groundVisible: g.ground ? g.ground.visible : null
            };
            // Hide non-openworld scene children so the maze/arena disappears visually.
            this._hiddenObjects = [];
            for (const obj of this.scene.children) {
                if (obj === this.rootGroup) continue;
                if (obj === g.camera) continue;
                if (!obj.visible) continue;
                obj.visible = false;
                this._hiddenObjects.push(obj);
            }
        }

        _restoreGameState() {
            const s = this._savedState;
            if (!s) return;
            this.game.walls = s.walls;
            this.scene.fog = s.fog;
            this.scene.background = s.bg;
            if (this.game.ground && s.groundVisible !== null) this.game.ground.visible = s.groundVisible;
            if (this._hiddenObjects) {
                for (const o of this._hiddenObjects) o.visible = true;
                this._hiddenObjects = null;
            }
            this._savedState = null;
        }

        // ---------- asset loading ----------

        preloadAssets() {
            const paths = [
                // Animals
                'Animals/Cat.gltf', 'Animals/Chick.gltf', 'Animals/Chicken.gltf',
                'Animals/Dog.gltf', 'Animals/Horse.gltf', 'Animals/Pig.gltf',
                'Animals/Raccoon.gltf', 'Animals/Sheep.gltf', 'Animals/Wolf.gltf',
                // Enemies
                'enemies/Demon.gltf', 'enemies/Goblin.gltf', 'enemies/Hedgehog.gltf',
                'enemies/Skeleton.gltf', 'enemies/Skeleton_Armor.gltf',
                'enemies/Wizard.gltf', 'enemies/Yeti.gltf',
                // Environment
                'environment/Bamboo.gltf', 'environment/Bamboo_Mid.gltf', 'environment/Bamboo_Small.gltf',
                'environment/Bush.gltf', 'environment/Cart.gltf',
                'environment/Chest_Closed.gltf', 'environment/Crystal_Big.gltf',
                'environment/Crystal_Small.gltf', 'environment/DeadTree_1.gltf',
                'environment/DeadTree_2.gltf', 'environment/DeadTree_3.gltf',
                'environment/Fence_Center.gltf', 'environment/Flowers_1.gltf',
                'environment/Flowers_2.gltf', 'environment/Grass_Big.gltf',
                'environment/Grass_Small.gltf', 'environment/Mushroom.gltf',
                'environment/Plant_2.gltf', 'environment/Plant_3.gltf',
                'environment/Rock1.gltf', 'environment/Rock2.gltf',
                'environment/Tree_1.gltf', 'environment/Tree_2.gltf', 'environment/Tree_3.gltf',
                // Blocks
                'Block_Brick.gltf', 'Block_Coal.gltf', 'Block_Crate.gltf',
                'Block_GreyBricks.gltf', 'Block_Grass.gltf', 'Block_Ice.gltf',
                'Block_Snow.gltf', 'Block_Stone.gltf', 'Block_WoodPlanks.gltf'
            ];
            return Promise.all(paths.map((p) => this._loadOne(ROOT + p)));
        }

        _loadOne(path) {
            return new Promise((resolve) => {
                this.loader.load(
                    path,
                    (gltf) => { this.assetCache.set(path, gltf); resolve(); },
                    undefined,
                    (err) => {
                        console.warn('[openworld] failed to load', path, err && err.message);
                        resolve();
                    }
                );
            });
        }

        cloneAsset(path) {
            const cached = this.assetCache.get(path);
            if (!cached) return null;
            const src = cached.scene || (cached.scenes && cached.scenes[0]);
            if (!src) return null;
            const hasSkin = this._hasSkinnedMesh(src);
            const cloned = (hasSkin && THREE.SkeletonUtils)
                ? THREE.SkeletonUtils.clone(src)
                : src.clone(true);
            cloned.traverse((o) => {
                if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
            });
            cloned.userData.animations = cached.animations || [];
            return cloned;
        }

        _hasSkinnedMesh(obj) {
            let has = false;
            obj.traverse((c) => { if (c.isSkinnedMesh) has = true; });
            return has;
        }

        _fallbackCube(color) {
            return new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, 1),
                new THREE.MeshLambertMaterial({ color: color || 0xaaaaaa })
            );
        }

        // ---------- world helpers ----------

        _makeWorld(id, opts) {
            const w = {
                id,
                group: new THREE.Group(),
                walls: [],
                animals: [],
                portals: [],
                spawn: opts.spawn || new THREE.Vector3(0, 0, 0),
                fog: opts.fog || new THREE.Fog(0xb8c4d0, 80, 260),
                bg: new THREE.Color(opts.bg != null ? opts.bg : 0x8ec8ea),
                combat: !!opts.combat,
                displayName: opts.displayName || id
            };
            w.group.name = `ow-${id}`;
            w.group.visible = false;
            this.rootGroup.add(w.group);

            const ambient = new THREE.AmbientLight(
                opts.ambientColor != null ? opts.ambientColor : 0xffffff,
                opts.ambientIntensity != null ? opts.ambientIntensity : 0.55
            );
            w.group.add(ambient);
            const dir = new THREE.DirectionalLight(
                opts.dirColor != null ? opts.dirColor : 0xffffff,
                opts.dirIntensity != null ? opts.dirIntensity : 0.6
            );
            dir.position.set(60, 100, 40);
            w.group.add(dir);

            this.worlds[id] = w;
            return w;
        }

        _addGround(world, color, radius) {
            const r = radius || 60;
            const mesh = new THREE.Mesh(
                new THREE.CircleGeometry(r, 48),
                new THREE.MeshLambertMaterial({ color })
            );
            mesh.rotation.x = -Math.PI / 2;
            mesh.receiveShadow = true;
            world.group.add(mesh);
        }

        addStaticProp(world, mesh, opts) {
            opts = opts || {};
            world.group.add(mesh);
            let size, center;
            if (opts.size && opts.center) {
                size = new THREE.Vector3(opts.size.x, opts.size.y, opts.size.z);
                center = new THREE.Vector3(opts.center.x, opts.center.y, opts.center.z);
            } else {
                const bbox = new THREE.Box3().setFromObject(mesh);
                const s = bbox.getSize(new THREE.Vector3());
                const c = bbox.getCenter(new THREE.Vector3());
                size = opts.size ? new THREE.Vector3(opts.size.x, opts.size.y, opts.size.z) : s;
                center = opts.center ? new THREE.Vector3(opts.center.x, opts.center.y, opts.center.z) : c;
            }
            world.walls.push({
                mesh,
                position: center,
                size: { x: size.x, y: size.y, z: size.z }
            });
        }

        addAnimal(world, mesh, opts) {
            world.group.add(mesh);
            const home = mesh.position.clone();
            const entry = {
                mesh,
                behavior: opts.behavior || 'wander',
                home,
                radius: opts.radius || 8,
                speed: opts.speed || 1.5,
                phase: Math.random() * Math.PI * 2,
                target: home.clone(),
                retargetIn: 0,
                peckPhase: 0,
                mixer: null
            };
            // We deliberately don't auto-play clips[0] — many Kenney models ship
            // pose/death clips that pick up first alphabetically and make the
            // animal lie on its side. Manual bob + rotation reads as "alive".

            // Make the animal a shootable enemy. The existing projectile + melee
            // code looks for userData.type === 'enemy' on playMode.enemies entries.
            mesh.userData.type = 'enemy';
            mesh.userData.openworldAnimal = true;
            mesh.userData.openworldEntry = entry;
            mesh.userData.hp = opts.hp != null ? opts.hp : 3;
            mesh.userData.hpMax = mesh.userData.hp;
            mesh.userData.hitRadius = opts.hitRadius != null ? opts.hitRadius : 0.7;
            mesh.userData.hitHeight = opts.hitHeight != null ? opts.hitHeight : 1.5;
            mesh.userData.bodyColor = opts.bodyColor || 0xffffff;

            world.animals.push(entry);
            return entry;
        }

        addPortal(world, position, targetWorldId, color) {
            color = color != null ? color : 0x7a1cf2;
            const colorObj = new THREE.Color(color);
            const mat = new THREE.ShaderMaterial({
                uniforms: { uTime: { value: 0 }, uColor: { value: colorObj } },
                vertexShader: PORTAL_VS,
                fragmentShader: PORTAL_FS,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const disc = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.4), mat);
            disc.position.copy(position);
            disc.position.y += 1.7;

            const torus = new THREE.Mesh(
                new THREE.TorusGeometry(1.7, 0.12, 8, 32),
                new THREE.MeshBasicMaterial({ color: colorObj })
            );
            torus.position.copy(disc.position);

            const light = new THREE.PointLight(colorObj, 1.6, 10);
            light.position.copy(disc.position);

            world.group.add(disc);
            world.group.add(torus);
            world.group.add(light);

            const portal = {
                disc, torus, light, material: mat,
                position: disc.position.clone(),
                targetWorldId,
                color: colorObj
            };
            world.portals.push(portal);
            return portal;
        }

        // ---------- world layouts ----------

        buildAllWorlds() {
            this._buildHub();
            this._buildBambooGrove();
            this._buildDogFarm();
            this._buildIceCaverns();
            this._buildDemonCrypt();
        }

        _buildHub() {
            const w = this._makeWorld('hub', {
                displayName: 'The Hub',
                spawn: new THREE.Vector3(0, 0, 0),
                bg: 0x9bd0ee,
                fog: new THREE.Fog(0x9bd0ee, 80, 260),
                ambientColor: 0xfff0e0, ambientIntensity: 0.7,
                dirIntensity: 0.7
            });
            this._addGround(w, 0x4dbb59, 50);

            // Scatter peaceful decor (no collision)
            const decor = ['Grass_Big', 'Grass_Small', 'Flowers_1', 'Flowers_2', 'Bush', 'Mushroom'];
            for (let i = 0; i < 90; i++) {
                const a = Math.random() * Math.PI * 2;
                const r = 4 + Math.random() * 42;
                const m = this.cloneAsset(ROOT + 'environment/' + decor[Math.floor(Math.random() * decor.length)] + '.gltf');
                if (!m) continue;
                m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
                m.rotation.y = Math.random() * Math.PI * 2;
                m.scale.setScalar(0.8 + Math.random() * 0.6);
                w.group.add(m);
            }

            // Vantage staircase of grass blocks
            const steps = [
                [-8, 0.5, -8], [-8, 1.5, -7], [-8, 2.5, -6], [-8, 3.5, -5], [-8, 4.5, -4]
            ];
            for (const [x, y, z] of steps) {
                const b = this.cloneAsset(ROOT + 'Block_Grass.gltf') || this._fallbackCube(0x4dbb59);
                b.position.set(x, y, z);
                this.addStaticProp(w, b, { center: { x, y, z }, size: { x: 1, y: 1, z: 1 } });
            }

            // A few welcome animals
            for (let i = 0; i < 3; i++) {
                const cat = this.cloneAsset(ROOT + 'Animals/Cat.gltf');
                if (cat) {
                    cat.position.set((Math.random() - 0.5) * 22, 0, (Math.random() - 0.5) * 22);
                    this.addAnimal(w, cat, { behavior: 'wander', radius: 10, speed: 1.2 });
                }
                const chick = this.cloneAsset(ROOT + 'Animals/Chick.gltf');
                if (chick) {
                    chick.position.set((Math.random() - 0.5) * 22, 0, (Math.random() - 0.5) * 22);
                    this.addAnimal(w, chick, { behavior: 'peck', radius: 5, speed: 0.6 });
                }
            }

            // Four cardinal portals
            this.addPortal(w, new THREE.Vector3(0, 0, -18),  'bambooGrove', 0x4cf25a);
            this.addPortal(w, new THREE.Vector3(18, 0, 0),   'dogFarm',     0xf2c84c);
            this.addPortal(w, new THREE.Vector3(0, 0, 18),   'iceCaverns',  0x4cd9f2);
            this.addPortal(w, new THREE.Vector3(-18, 0, 0),  'demonCrypt',  0xf24c7a);
        }

        _buildBambooGrove() {
            const w = this._makeWorld('bambooGrove', {
                displayName: 'Bamboo Grove',
                spawn: new THREE.Vector3(0, 0, 16),
                bg: 0xa6e8c4,
                fog: new THREE.Fog(0xa6e8c4, 60, 220),
                ambientColor: 0xc8ffd8, ambientIntensity: 0.75,
                dirColor: 0xfff8d0, dirIntensity: 0.65
            });
            this._addGround(w, 0x3da34d, 60);

            // Climbable bamboo staircases (3-stalk steps)
            const stalkDefs = [
                { key: 'Bamboo_Small', h: 1.4 },
                { key: 'Bamboo_Mid',   h: 2.4 },
                { key: 'Bamboo',       h: 3.6 }
            ];
            for (let i = 0; i < 8; i++) {
                const cx = -28 + Math.random() * 56;
                const cz = -28 + Math.random() * 56;
                if (Math.hypot(cx, cz) < 6) continue;
                for (let s = 0; s < stalkDefs.length; s++) {
                    const def = stalkDefs[s];
                    const m = this.cloneAsset(ROOT + 'environment/' + def.key + '.gltf');
                    if (!m) continue;
                    const x = cx + s * 1.05;
                    const z = cz + s * 0.5;
                    m.position.set(x, 0, z);
                    m.scale.setScalar(1.4);
                    this.addStaticProp(w, m, {
                        center: { x, y: def.h * 0.5, z },
                        size: { x: 1.0, y: def.h, z: 1.0 }
                    });
                }
            }

            // Solid trees (trunk-only AABB)
            for (let i = 0; i < 18; i++) {
                const a = Math.random() * Math.PI * 2;
                const r = 14 + Math.random() * 40;
                const x = Math.cos(a) * r, z = Math.sin(a) * r;
                const key = ['Tree_1', 'Tree_2', 'Tree_3'][Math.floor(Math.random() * 3)];
                const tree = this.cloneAsset(ROOT + 'environment/' + key + '.gltf');
                if (!tree) continue;
                tree.position.set(x, 0, z);
                tree.scale.setScalar(1.4 + Math.random() * 0.6);
                tree.rotation.y = Math.random() * Math.PI * 2;
                this.addStaticProp(w, tree, {
                    center: { x, y: 1.5, z },
                    size: { x: 0.7, y: 3.0, z: 0.7 }
                });
            }

            // Decorative groundcover (no collision)
            const ground = ['Mushroom', 'Plant_2', 'Plant_3', 'Grass_Big', 'Bush'];
            for (let i = 0; i < 40; i++) {
                const x = -50 + Math.random() * 100, z = -50 + Math.random() * 100;
                const m = this.cloneAsset(ROOT + 'environment/' + ground[Math.floor(Math.random() * ground.length)] + '.gltf');
                if (!m) continue;
                m.position.set(x, 0, z);
                m.rotation.y = Math.random() * Math.PI * 2;
                w.group.add(m);
            }

            // Flying pigs — orbital paths over the grove
            for (let i = 0; i < 6; i++) {
                const pig = this.cloneAsset(ROOT + 'Animals/Pig.gltf');
                if (!pig) continue;
                const a = (i / 6) * Math.PI * 2;
                const r = 12 + Math.random() * 8;
                pig.position.set(Math.cos(a) * r, 9 + Math.random() * 3, Math.sin(a) * r);
                pig.scale.setScalar(1.2);
                const entry = this.addAnimal(w, pig, { behavior: 'fly', radius: r, speed: 0.35 + Math.random() * 0.25 });
                entry.home.y = pig.position.y;
            }

            // Sheep + chicks
            for (let i = 0; i < 5; i++) {
                const sheep = this.cloneAsset(ROOT + 'Animals/Sheep.gltf');
                if (sheep) {
                    sheep.position.set((Math.random() - 0.5) * 40, 0, (Math.random() - 0.5) * 40);
                    this.addAnimal(w, sheep, { behavior: 'wander', radius: 8, speed: 1.0 });
                }
            }
            for (let i = 0; i < 6; i++) {
                const chick = this.cloneAsset(ROOT + 'Animals/Chick.gltf');
                if (chick) {
                    chick.position.set((Math.random() - 0.5) * 40, 0, (Math.random() - 0.5) * 40);
                    this.addAnimal(w, chick, { behavior: 'peck', radius: 4, speed: 0.6 });
                }
            }

            // Return portal
            this.addPortal(w, new THREE.Vector3(0, 0, 22), 'hub', 0xb6a4ff);
        }

        _buildDogFarm() {
            const w = this._makeWorld('dogFarm', {
                displayName: 'Dog Farm',
                spawn: new THREE.Vector3(-15, 0, 0),
                bg: 0xffd998,
                fog: new THREE.Fog(0xffd998, 70, 240),
                ambientColor: 0xfff0c8, ambientIntensity: 0.8,
                dirColor: 0xfff0c8, dirIntensity: 0.75
            });
            this._addGround(w, 0x82c660, 60);

            // Paddock fence ring around the central pasture
            const fenceR = 18, fenceCount = 32;
            for (let i = 0; i < fenceCount; i++) {
                const a = (i / fenceCount) * Math.PI * 2;
                // leave a gap on the west for the player to enter through
                if (Math.abs(a - Math.PI) < 0.3) continue;
                const x = Math.cos(a) * fenceR, z = Math.sin(a) * fenceR;
                const fence = this.cloneAsset(ROOT + 'environment/Fence_Center.gltf');
                if (!fence) continue;
                fence.position.set(x, 0, z);
                fence.rotation.y = a + Math.PI / 2;
                this.addStaticProp(w, fence, {
                    center: { x, y: 0.6, z },
                    size: { x: 1.4, y: 1.2, z: 1.4 }
                });
            }

            // Barn (3-tile-wide wood-plank wall) with door gap
            for (let bx = -3; bx <= 3; bx++) {
                for (let by = 0; by < 4; by++) {
                    if (bx === 0 && by < 2) continue; // doorway
                    const blk = this.cloneAsset(ROOT + 'Block_WoodPlanks.gltf') || this._fallbackCube(0x9a6b3a);
                    const x = bx, y = 0.5 + by, z = -22;
                    blk.position.set(x, y, z);
                    this.addStaticProp(w, blk, { center: { x, y, z }, size: { x: 1, y: 1, z: 1 } });
                }
            }

            // Hay-bale crate staircase up to barn roof
            for (let i = 0; i < 4; i++) {
                const blk = this.cloneAsset(ROOT + 'Block_Crate.gltf') || this._fallbackCube(0xc28e44);
                const x = 4 + i, y = 0.5 + i, z = -22;
                blk.position.set(x, y, z);
                this.addStaticProp(w, blk, { center: { x, y, z }, size: { x: 1, y: 1, z: 1 } });
            }

            // Cart + chest
            const cart = this.cloneAsset(ROOT + 'environment/Cart.gltf');
            if (cart) {
                cart.position.set(8, 0, 8);
                cart.rotation.y = Math.PI / 4;
                this.addStaticProp(w, cart, { center: { x: 8, y: 0.6, z: 8 }, size: { x: 1.6, y: 1.2, z: 2.2 } });
            }
            const chest = this.cloneAsset(ROOT + 'environment/Chest_Closed.gltf');
            if (chest) {
                chest.position.set(-8, 0, 8);
                this.addStaticProp(w, chest, { center: { x: -8, y: 0.5, z: 8 }, size: { x: 1.2, y: 1, z: 0.8 } });
            }

            // Animals — every one of them moves
            for (let i = 0; i < 4; i++) {
                const dog = this.cloneAsset(ROOT + 'Animals/Dog.gltf');
                if (dog) {
                    dog.position.set((Math.random() - 0.5) * 24, 0, (Math.random() - 0.5) * 24);
                    this.addAnimal(w, dog, { behavior: 'wander', radius: 12, speed: 2.8 });
                }
            }
            for (let i = 0; i < 3; i++) {
                const horse = this.cloneAsset(ROOT + 'Animals/Horse.gltf');
                if (horse) {
                    horse.position.set((Math.random() - 0.5) * 24, 0, (Math.random() - 0.5) * 24);
                    this.addAnimal(w, horse, { behavior: 'wander', radius: 14, speed: 2.0 });
                }
            }
            for (let i = 0; i < 4; i++) {
                const cat = this.cloneAsset(ROOT + 'Animals/Cat.gltf');
                if (cat) {
                    cat.position.set((Math.random() - 0.5) * 24, 0, (Math.random() - 0.5) * 24);
                    this.addAnimal(w, cat, { behavior: 'idle-bob', radius: 1, speed: 0.3 });
                }
            }
            for (let i = 0; i < 5; i++) {
                const chicken = this.cloneAsset(ROOT + 'Animals/Chicken.gltf');
                if (chicken) {
                    chicken.position.set((Math.random() - 0.5) * 24, 0, (Math.random() - 0.5) * 24);
                    this.addAnimal(w, chicken, { behavior: 'peck', radius: 5, speed: 0.7 });
                }
            }
            const raccoon = this.cloneAsset(ROOT + 'Animals/Raccoon.gltf');
            if (raccoon) {
                raccoon.position.set(12, 0, -8);
                this.addAnimal(w, raccoon, { behavior: 'wander', radius: 8, speed: 1.5 });
            }

            // Return portal
            this.addPortal(w, new THREE.Vector3(-22, 0, 0), 'hub', 0xb6a4ff);
        }

        _buildIceCaverns() {
            const w = this._makeWorld('iceCaverns', {
                displayName: 'Crystal Ice Caverns',
                spawn: new THREE.Vector3(0, 0, 18),
                bg: 0x6e9ecc,
                fog: new THREE.Fog(0x6e9ecc, 30, 160),
                ambientColor: 0x9fd4ff, ambientIntensity: 0.55,
                dirColor: 0xc8e6ff, dirIntensity: 0.55,
                combat: true
            });
            this._addGround(w, 0xc8e0f0, 60);

            // Layered ice block tiers (climb to the center crystal)
            for (let layer = 0; layer < 4; layer++) {
                const tiles = 7 - layer;
                for (let i = 0; i < tiles; i++) {
                    const a = (i / tiles) * Math.PI * 2 + layer * 0.4;
                    const r = 14 - layer * 2.5;
                    const x = Math.cos(a) * r, z = Math.sin(a) * r;
                    const y = 0.5 + layer * 1;
                    const blk = this.cloneAsset(ROOT + 'Block_Ice.gltf') || this._fallbackCube(0xc8e0f0);
                    blk.position.set(x, y, z);
                    this.addStaticProp(w, blk, { center: { x, y, z }, size: { x: 1, y: 1, z: 1 } });
                }
            }

            // Central giant crystal
            const bigCrystal = this.cloneAsset(ROOT + 'environment/Crystal_Big.gltf');
            if (bigCrystal) {
                bigCrystal.position.set(0, 0, 0);
                bigCrystal.scale.setScalar(2.5);
                this.addStaticProp(w, bigCrystal, {
                    center: { x: 0, y: 2, z: 0 }, size: { x: 2.4, y: 4, z: 2.4 }
                });
            }

            for (let i = 0; i < 14; i++) {
                const a = Math.random() * Math.PI * 2;
                const r = 6 + Math.random() * 22;
                const sm = this.cloneAsset(ROOT + 'environment/Crystal_Small.gltf');
                if (!sm) continue;
                sm.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
                sm.scale.setScalar(1 + Math.random() * 1.5);
                this.addStaticProp(w, sm, {
                    center: { x: sm.position.x, y: 1, z: sm.position.z },
                    size: { x: 1.1, y: 2, z: 1.1 }
                });
            }

            // Rocks scattered at the edges
            for (let i = 0; i < 8; i++) {
                const a = Math.random() * Math.PI * 2;
                const r = 20 + Math.random() * 18;
                const key = Math.random() < 0.5 ? 'Rock1' : 'Rock2';
                const rock = this.cloneAsset(ROOT + 'environment/' + key + '.gltf');
                if (!rock) continue;
                rock.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
                rock.scale.setScalar(1.2 + Math.random());
                this.addStaticProp(w, rock);
            }

            // Snow tufts (decorative)
            for (let i = 0; i < 24; i++) {
                const x = -50 + Math.random() * 100, z = -50 + Math.random() * 100;
                const blk = this.cloneAsset(ROOT + 'Block_Snow.gltf');
                if (!blk) continue;
                blk.position.set(x, 0.25, z);
                blk.scale.setScalar(0.5);
                w.group.add(blk);
            }

            // Yetis (mock combat) + hedgehogs (peaceful skitter)
            for (let i = 0; i < 3; i++) {
                const yeti = this.cloneAsset(ROOT + 'enemies/Yeti.gltf');
                if (!yeti) continue;
                yeti.position.set((Math.random() - 0.5) * 36, 0, (Math.random() - 0.5) * 36);
                yeti.scale.setScalar(1.25);
                this.addAnimal(w, yeti, { behavior: 'wander', radius: 12, speed: 1.4 });
            }
            for (let i = 0; i < 5; i++) {
                const hh = this.cloneAsset(ROOT + 'enemies/Hedgehog.gltf');
                if (!hh) continue;
                hh.position.set((Math.random() - 0.5) * 36, 0, (Math.random() - 0.5) * 36);
                this.addAnimal(w, hh, { behavior: 'wander', radius: 6, speed: 2.5 });
            }

            // Return portal
            this.addPortal(w, new THREE.Vector3(0, 0, 22), 'hub', 0xb6a4ff);
        }

        _buildDemonCrypt() {
            const w = this._makeWorld('demonCrypt', {
                displayName: 'Demon Crypt',
                spawn: new THREE.Vector3(15, 0, 0),
                bg: 0x2a1014,
                fog: new THREE.Fog(0x2a1014, 25, 140),
                ambientColor: 0x6a2030, ambientIntensity: 0.4,
                dirColor: 0xff8060, dirIntensity: 0.35,
                combat: true
            });
            this._addGround(w, 0x3a2020, 60);

            // Broken brick courtyard walls (each segment is a row of grey-brick cubes)
            const segments = [
                [-15, -15, -5, -15], [-5, -15, 5, -15],
                [-15, 15, -5, 15],  [5, 15, 15, 15],
                [-15, -15, -15, -5],[-15, 5, -15, 15],
                [15, -15, 15, 0]
            ];
            for (const seg of segments) {
                const x1 = seg[0], z1 = seg[1], x2 = seg[2], z2 = seg[3];
                const dx = x2 - x1, dz = z2 - z1;
                const len = Math.sqrt(dx * dx + dz * dz);
                const nx = dx / len, nz = dz / len;
                for (let t = 0; t < len; t += 1) {
                    const x = x1 + nx * t, z = z1 + nz * t;
                    const blk = this.cloneAsset(ROOT + 'Block_GreyBricks.gltf') || this._fallbackCube(0x666);
                    blk.position.set(x, 0.5, z);
                    this.addStaticProp(w, blk, { center: { x, y: 0.5, z }, size: { x: 1, y: 1, z: 1 } });
                    if (Math.random() < 0.5) {
                        const b2 = this.cloneAsset(ROOT + 'Block_GreyBricks.gltf') || this._fallbackCube(0x666);
                        b2.position.set(x, 1.5, z);
                        this.addStaticProp(w, b2, { center: { x, y: 1.5, z }, size: { x: 1, y: 1, z: 1 } });
                    }
                }
            }

            // Dead trees outside the courtyard
            for (let i = 0; i < 12; i++) {
                const a = Math.random() * Math.PI * 2;
                const r = 18 + Math.random() * 22;
                const x = Math.cos(a) * r, z = Math.sin(a) * r;
                const key = ['DeadTree_1', 'DeadTree_2', 'DeadTree_3'][Math.floor(Math.random() * 3)];
                const tree = this.cloneAsset(ROOT + 'environment/' + key + '.gltf');
                if (!tree) continue;
                tree.position.set(x, 0, z);
                tree.scale.setScalar(1.3 + Math.random() * 0.5);
                this.addStaticProp(w, tree, {
                    center: { x, y: 1.5, z }, size: { x: 0.6, y: 3, z: 0.6 }
                });
            }

            // Four coal-block pillars
            for (let i = 0; i < 4; i++) {
                const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
                const r = 9;
                const x = Math.cos(a) * r, z = Math.sin(a) * r;
                for (let y = 0; y < 4; y++) {
                    const blk = this.cloneAsset(ROOT + 'Block_Coal.gltf') || this._fallbackCube(0x222);
                    blk.position.set(x, 0.5 + y, z);
                    this.addStaticProp(w, blk, { center: { x, y: 0.5 + y, z }, size: { x: 1, y: 1, z: 1 } });
                }
            }

            // Loot chest
            const chest = this.cloneAsset(ROOT + 'environment/Chest_Closed.gltf');
            if (chest) {
                chest.position.set(0, 0, -8);
                this.addStaticProp(w, chest, { center: { x: 0, y: 0.5, z: -8 }, size: { x: 1.2, y: 1, z: 0.8 } });
            }

            // Wandering enemies (visual; combat hooks gated to this world)
            const keys = ['Skeleton', 'Skeleton_Armor', 'Goblin', 'Demon', 'Wizard'];
            for (let i = 0; i < 7; i++) {
                const k = keys[i % keys.length];
                const e = this.cloneAsset(ROOT + 'enemies/' + k + '.gltf');
                if (!e) continue;
                e.position.set((Math.random() - 0.5) * 22, 0, (Math.random() - 0.5) * 22);
                this.addAnimal(w, e, { behavior: 'wander', radius: 9, speed: 1.6 });
            }

            // Return portal
            this.addPortal(w, new THREE.Vector3(20, 0, 0), 'hub', 0xb6a4ff);
        }

        // ---------- per-frame update ----------

        update(dt) {
            if (!this.active) return;
            this.t += dt;
            const w = this.worlds[this.currentWorldId];
            if (!w) return;

            // Portal shader + spin
            for (const p of w.portals) {
                p.material.uniforms.uTime.value = this.t;
                p.disc.rotation.z += dt * 0.45;
                const pulse = 1 + Math.sin(this.t * 4) * 0.15;
                p.light.intensity = 1.4 * pulse;
            }

            // Prune animals that the existing kill flow has marked dying — they
            // belong to the topple/fade loop now, not to our behavior loop.
            for (let i = w.animals.length - 1; i >= 0; i--) {
                const a = w.animals[i];
                if (!a.mesh || a.mesh.userData.dying || a.mesh.userData.hp <= 0) {
                    w.animals.splice(i, 1);
                }
            }

            // Animal behaviors
            for (const a of w.animals) {
                this._updateAnimal(a, dt);
                if (a.mixer) a.mixer.update(dt);
            }

            // Portal trigger
            if (!this.transitioning) {
                const pp = this.game.player.position;
                for (const p of w.portals) {
                    const dx = pp.x - p.position.x, dz = pp.z - p.position.z, dy = pp.y - p.position.y;
                    if (dx * dx + dz * dz < 2.25 && Math.abs(dy) < 3.5) {
                        this.transitionTo(p.targetWorldId);
                        break;
                    }
                }
            }
        }

        _updateAnimal(a, dt) {
            const m = a.mesh;
            if (!m || m.userData.dying || m.userData.hp <= 0) return;
            switch (a.behavior) {
                case 'wander': {
                    a.retargetIn -= dt;
                    const dx = a.target.x - m.position.x, dz = a.target.z - m.position.z;
                    const d = Math.sqrt(dx * dx + dz * dz);
                    if (d < 0.4 || a.retargetIn <= 0) {
                        const ang = Math.random() * Math.PI * 2;
                        const r = Math.random() * a.radius;
                        a.target.set(a.home.x + Math.cos(ang) * r, 0, a.home.z + Math.sin(ang) * r);
                        a.retargetIn = 2 + Math.random() * 3;
                    } else {
                        const vx = (dx / d) * a.speed, vz = (dz / d) * a.speed;
                        m.position.x += vx * dt;
                        m.position.z += vz * dt;
                        m.rotation.y = Math.atan2(vx, vz);
                        if (!a.mixer) m.position.y = Math.sin(this.t * 6 + a.phase) * 0.05;
                    }
                    break;
                }
                case 'fly': {
                    const r = a.radius;
                    const ang = a.phase + this.t * a.speed;
                    m.position.x = a.home.x + Math.cos(ang) * r;
                    m.position.z = a.home.z + Math.sin(ang) * r;
                    m.position.y = a.home.y + Math.sin(this.t * 2 + a.phase) * 0.7;
                    m.rotation.y = -ang + Math.PI / 2;
                    m.rotation.z = Math.sin(this.t * 4 + a.phase) * 0.12;
                    break;
                }
                case 'idle-bob': {
                    m.position.y = a.home.y + Math.sin(this.t * 2 + a.phase) * 0.05;
                    m.rotation.y = a.phase + Math.sin(this.t * 0.5) * 0.3;
                    break;
                }
                case 'peck': {
                    a.retargetIn -= dt;
                    if (a.retargetIn <= 0) {
                        a.peckPhase = 1;
                        a.retargetIn = 1.5 + Math.random();
                        const ang = Math.random() * Math.PI * 2;
                        m.position.x += Math.cos(ang) * 0.3;
                        m.position.z += Math.sin(ang) * 0.3;
                        m.rotation.y = ang;
                    }
                    if (a.peckPhase > 0) {
                        a.peckPhase = Math.max(0, a.peckPhase - dt * 4);
                        m.rotation.x = a.peckPhase * 0.6;
                    }
                    break;
                }
            }
        }

        // ---------- transitions ----------

        transitionTo(targetId, instant) {
            const w = this.worlds[targetId];
            if (!w) return;

            const doSwap = () => {
                // Tear down outgoing world's animal enemy registrations
                this._unregisterAnimalsFromCombat(this.currentWorldId);
                for (const k in this.worlds) this.worlds[k].group.visible = false;
                w.group.visible = true;
                this.currentWorldId = targetId;
                this.game.walls = w.walls;
                this.scene.fog = w.fog;
                this.scene.background = w.bg;
                this.game.player.position.copy(w.spawn);
                this.game.player.velocity.set(0, 0, 0);
                this.game.player.onGround = true;
                // Register incoming animals so projectiles + melee can hit them
                this._registerAnimalsAsCombat(w);
                this._refreshCombatHUD(w);
                this._updateLabel(w);
                if (this.game.activeModeId === 'explorer') {
                    this._onExplorerWorldVisit(targetId, w);
                }
            };

            if (instant) { doSwap(); return; }

            this.transitioning = true;
            const fade = document.getElementById('portal-fade');
            if (fade) fade.classList.add('show');
            setTimeout(() => {
                doSwap();
                setTimeout(() => {
                    if (fade) fade.classList.remove('show');
                    setTimeout(() => { this.transitioning = false; }, 360);
                }, 60);
            }, 360);
        }

        _registerAnimalsAsCombat(world) {
            const pm = this.game.playMode;
            if (!pm || !pm.enemies) return;
            for (const a of world.animals) {
                if (!a.mesh || a.mesh.userData.dying) continue;
                // Restore HP if a previous visit damaged but didn't kill it
                if (a.mesh.userData.hp <= 0) {
                    a.mesh.userData.hp = a.mesh.userData.hpMax;
                }
                if (pm.enemies.indexOf(a.mesh) === -1) {
                    pm.enemies.push(a.mesh);
                }
            }
        }

        _unregisterAnimalsFromCombat(worldId) {
            const w = worldId && this.worlds[worldId];
            if (!w) return;
            const pm = this.game.playMode;
            if (!pm || !pm.enemies) return;
            for (const a of w.animals) {
                const idx = pm.enemies.indexOf(a.mesh);
                if (idx !== -1) pm.enemies.splice(idx, 1);
            }
        }

        _refreshCombatHUD(world) {
            // Hide maze-only HUD chrome in peaceful worlds for a cleaner look
            const ob = document.getElementById('objective-banner');
            const mm = document.getElementById('minimap-wrap');
            const hb = document.getElementById('health-bar');
            const show = !!world.combat;
            if (ob) ob.style.display = show ? '' : 'none';
            if (mm) mm.style.display = show ? '' : 'none';
            if (hb) hb.style.display = show ? '' : 'none';
        }

        _ensureLabel() {
            if (this.labelEl) { this.labelEl.style.display = ''; return; }
            const el = document.createElement('div');
            el.id = 'openworld-label';
            el.style.cssText =
                'position:fixed;top:14px;left:50%;transform:translateX(-50%);' +
                'padding:8px 16px;font-family:monospace;font-size:14px;letter-spacing:2px;' +
                'color:#fff;background:rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.2);' +
                'border-radius:4px;z-index:99998;pointer-events:none;text-transform:uppercase;';
            document.body.appendChild(el);
            this.labelEl = el;
        }

        _updateLabel(world) {
            if (!this.labelEl) return;
            const done = this._explorerZonesDone();
            const obj = done >= 4 ? '   ★ all zones visited' : `   ◆ zones ${done}/4`;
            this.labelEl.textContent = world.displayName + (world.combat ? '   ⚔  combat' : '   ✦  peaceful') + obj;
        }

        _explorerZonesDone() {
            const z = this.zoneObjectives;
            return (z.bambooGrove ? 1 : 0) + (z.dogFarm ? 1 : 0) + (z.iceCaverns ? 1 : 0) + (z.demonCrypt ? 1 : 0);
        }

        _onExplorerWorldVisit(targetId, world) {
            const subZones = ['bambooGrove', 'dogFarm', 'iceCaverns', 'demonCrypt'];
            if (subZones.includes(targetId) && !this.zoneObjectives[targetId]) {
                this.zoneObjectives[targetId] = true;
                const g = this.game;
                if (g.run) g.run.objectivesDone = this._explorerZonesDone();
                if (g.showMessage) g.showMessage(`Discovered: ${world.displayName}`);
                if (this._explorerZonesDone() >= 4 && g.showMessage) {
                    g.showMessage('Explorer — all zones discovered! Return to the hub.');
                }
            }
            this._updateLabel(world);
        }
    }

    window.OpenWorldSystem = OpenWorldSystem;
})();
