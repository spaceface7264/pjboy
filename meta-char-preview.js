/**
 * Live Three.js preview for the meta-flow explorer character editor.
 */
(function () {
    'use strict';

    if (typeof THREE === 'undefined') {
        console.error('[meta-char-preview] THREE not loaded');
        return;
    }

    function disposeObject(root) {
        if (!root) return;
        root.traverse((o) => {
            if (!o.isMesh) return;
            if (o.geometry && !o.userData.isOutline) o.geometry.dispose();
            if (o.material) {
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                mats.forEach((m) => {
                    if (m.map) m.map.dispose();
                    m.dispose();
                });
            }
        });
        if (root.parent) root.parent.remove(root);
    }

    class MetaCharPreview {
        constructor(container) {
            this.container = container;
            this._raf = 0;
            this._lastT = 0;
            this._spin = 0;
            this._char = null;

            const w = Math.max(220, container.clientWidth || 280);
            const h = Math.max(260, container.clientHeight || 320);

            this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            this.renderer.setSize(w, h, false);
            this.renderer.setClearColor(0x000000, 0);
            container.appendChild(this.renderer.domElement);

            this.scene = new THREE.Scene();
            this.scene.fog = new THREE.Fog(0x121830, 6, 14);

            this.camera = new THREE.PerspectiveCamera(38, w / h, 0.05, 40);
            this.camera.position.set(0, 1.55, 3.35);
            this.camera.lookAt(0, 1.05, 0);

            const hemi = new THREE.HemisphereLight(0xc8dcff, 0x3a2868, 0.9);
            const key = new THREE.DirectionalLight(0xfff0dd, 0.85);
            key.position.set(2.5, 4, 3);
            const rim = new THREE.DirectionalLight(0xe878f8, 0.45);
            rim.position.set(-3, 2, -2);
            this.scene.add(hemi, key, rim);

            const floor = new THREE.Mesh(
                new THREE.CircleGeometry(1.6, 32),
                new THREE.MeshBasicMaterial({ color: 0x1a2448, transparent: true, opacity: 0.55 })
            );
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = 0.01;
            this.scene.add(floor);

            const ring = new THREE.Mesh(
                new THREE.RingGeometry(1.05, 1.18, 48),
                new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.02;
            this.scene.add(ring);

            this._onResize = () => this.resize();
            window.addEventListener('resize', this._onResize);
            this.resize();
        }

        resize() {
            if (!this.container || !this.renderer) return;
            const w = Math.max(220, this.container.clientWidth || 280);
            const h = Math.max(260, this.container.clientHeight || 320);
            this.renderer.setSize(w, h, false);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        }

        update(params) {
            const VC = typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
            if (!VC || !params || !this.scene) return;

            if (this._char) {
                if (this._char.group && this._char.group.parent) {
                    this._char.group.parent.remove(this._char.group);
                }
                VC.dispose(this._char);
                this._char = null;
            }

            const normalized = VC.normalizeParams(params);
            this._char = VC.build(normalized, { weaponEquipped: normalized.weapon >= 0 });
            if (!this._char || !this._char.group) return;

            VC.scaleToHeight(this._char.group, 1.75);
            this._char.group.rotation.y = Math.PI * 0.12;
            this.scene.add(this._char.group);
            this._spin = 0;
            this.resize();
            if (this.renderer && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
        }

        start() {
            if (this._raf) return;
            this._lastT = performance.now();
            const tick = (now) => {
                this._raf = requestAnimationFrame(tick);
                const dt = Math.min(0.05, (now - this._lastT) / 1000);
                this._lastT = now;
                this._spin += dt * 0.28;
                if (this._char && this._char.group) {
                    this._char.group.rotation.y = Math.PI * 0.12 + Math.sin(this._spin) * 0.35;
                    const VC = typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
                    if (VC) {
                        VC.update(this._char, 'idle', dt, { weaponEquipped: this._char.params.weapon >= 0 });
                    }
                }
                this.renderer.render(this.scene, this.camera);
            };
            this._raf = requestAnimationFrame(tick);
        }

        stop() {
            if (this._raf) cancelAnimationFrame(this._raf);
            this._raf = 0;
        }

        dispose() {
            this.stop();
            window.removeEventListener('resize', this._onResize);
            const VC = typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
            if (this._char) {
                if (this._char.group && this._char.group.parent) {
                    this._char.group.parent.remove(this._char.group);
                }
                if (VC) VC.dispose(this._char);
                this._char = null;
            }
            if (this.renderer) {
                this.renderer.dispose();
                if (this.renderer.domElement.parentNode) {
                    this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
                }
            }
            this.renderer = null;
            this.scene = null;
            this.camera = null;
        }
    }

    window.MetaCharPreview = MetaCharPreview;
})();
