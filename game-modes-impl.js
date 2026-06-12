/**
 * Meta-flow, campaign, arena results, and Creator mode — patches Game3D prototype.
 */
(function () {
    'use strict';

    if (typeof Game3D === 'undefined') {
        console.error('[game-modes-impl] Game3D not loaded');
        return;
    }

    const CREATOR_STACK_MAX = 16;
    const CREATOR_PLATE_HALF = 16;
    const CAMPAIGN_MARK_TOUCH_SQ = 5.5; // ~2.3 units from marker center
    const CAMPAIGN_SAVE_KEY = 'pjboy.campaignSave.v1';
    const CAMPAIGN_SCORES_KEY = 'pjboy.campaignScores.v1';
    const CAMPAIGN_SCORES_MAX = 20;

    function getAsteroidProfileApi() {
        return typeof AsteroidProfile !== 'undefined' ? AsteroidProfile : null;
    }

    const META_HAIR_LABELS = ['White', 'Black', 'Brown', 'Blonde', 'Red', 'Pink'];
    const META_GEAR_LABELS = ['White', 'Charcoal', 'Teal', 'Magenta', 'Blue', 'Gold'];
    const META_SKIN_LABELS = ['Light', 'Medium', 'Tan', 'Deep'];

    function metaCharOptionRows(VC) {
        if (!VC) return [];
        return [
            { key: 'body', label: 'Body', options: VC.BODY_TYPES, labels: VC.BODY_TYPES },
            { key: 'deco', label: 'Head', options: VC.HEAD_DECOS, labels: VC.HEAD_DECOS },
            { key: 'hair', label: 'Hair', options: VC.HAIR_COLORS, labels: META_HAIR_LABELS },
            { key: 'gear', label: 'Gear', options: VC.GEAR_COLORS, labels: META_GEAR_LABELS },
            { key: 'skin', label: 'Skin', options: VC.SKIN_TONES, labels: META_SKIN_LABELS }
        ];
    }

    function metaCharDisplayFor(row, idx) {
        const i = ((idx | 0) % row.options.length + row.options.length) % row.options.length;
        const opt = row.options[i];
        const label = (row.labels && row.labels[i] != null) ? row.labels[i] : String(opt);
        const hex = (typeof opt === 'number') ? opt : null;
        return { label, hex };
    }

    function fillMetaCharValueEl(el, row, idx) {
        if (!el) return;
        const { label, hex } = metaCharDisplayFor(row, idx);
        el.textContent = '';
        el.classList.toggle('meta-char-val-color', hex != null);
        if (hex != null) {
            const sw = document.createElement('span');
            sw.className = 'meta-char-swatch';
            sw.style.background = '#' + (hex >>> 0).toString(16).padStart(6, '0');
            el.appendChild(sw);
        }
        el.appendChild(document.createTextNode(label));
    }

    function syncMetaCharPalettes(draft) {
        if (!draft) return;
        document.querySelectorAll('[data-char-palette]').forEach((pal) => {
            const key = pal.dataset.charPalette;
            if (!key) return;
            const idx = draft[key] | 0;
            pal.querySelectorAll('.meta-char-chip').forEach((chip, i) => {
                chip.classList.toggle('active', i === idx);
                chip.setAttribute('aria-pressed', i === idx ? 'true' : 'false');
            });
        });
    }

    const META_CHAR_PREVIEW_ANIM = { weaponEquipped: false, previewRelaxed: true };

    function refreshMetaCharPreviewPose(game) {
        if (!game || !game._metaCharPreviewHost || !game._metaCharPreviewHost.char) return;
        const VC = window.VoxelCharacter;
        if (!VC) return;
        const ch = game._metaCharPreviewHost.char;
        if (ch.anim) ch.anim.attackT = -1;
        primeMetaCharPreviewPose(game._metaCharPreviewHost, ch);
    }

    function applyMetaCharRelaxTune(patch, persist) {
        const VC = window.VoxelCharacter;
        if (!VC) return null;
        const tune = VC.setRelaxPoseTune(patch, !!persist);
        if (window.__pjMetaGame) refreshMetaCharPreviewPose(window.__pjMetaGame);
        return tune;
    }

    function buildMetaCharPoseTuneUI(game) {
        const panel = document.getElementById('meta-char-pose-tune');
        const toggle = document.getElementById('meta-char-pose-tune-toggle');
        const VC = window.VoxelCharacter;
        if (!panel || !VC || panel.dataset.built === '1') return;

        panel.dataset.built = '1';
        const hint = document.createElement('p');
        hint.className = 'meta-char-pose-tune-hint';
        hint.textContent = 'Semantic arm knobs — saved on this device. Negative arm hang folds arms behind the back on this rig.';
        panel.appendChild(hint);

        VC.RELAX_POSE_SPECS.forEach((spec) => {
            const row = document.createElement('div');
            row.className = 'meta-char-pose-tune-row';
            const label = document.createElement('label');
            label.htmlFor = 'meta-relax-' + spec.key;
            label.textContent = spec.label;
            const input = document.createElement('input');
            input.type = 'range';
            input.id = 'meta-relax-' + spec.key;
            input.min = String(spec.min);
            input.max = String(spec.max);
            input.step = String(spec.step);
            input.dataset.relaxKey = spec.key;
            const val = document.createElement('span');
            val.className = 'meta-char-pose-tune-val';
            val.dataset.relaxVal = spec.key;
            input.title = spec.hint || '';
            input.addEventListener('input', () => {
                val.textContent = Number(input.value).toFixed(3);
                applyMetaCharRelaxTune({ [spec.key]: parseFloat(input.value) }, false);
            });
            input.addEventListener('change', () => {
                game.audio && game.audio.play('uiClick');
                applyMetaCharRelaxTune({ [spec.key]: parseFloat(input.value) }, true);
            });
            row.append(label, input, val);
            panel.appendChild(row);
        });

        const actions = document.createElement('div');
        actions.className = 'meta-char-pose-tune-actions';
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'meta-btn meta-btn-ghost meta-btn-small';
        resetBtn.textContent = 'Reset defaults';
        resetBtn.addEventListener('click', () => {
            game.audio && game.audio.play('uiClick');
            const tune = VC.setRelaxPoseTune(Object.assign({}, VC.RELAX_POSE_DEFAULTS), true);
            syncMetaCharPoseTuneInputs(tune);
            refreshMetaCharPreviewPose(game);
        });
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'meta-btn meta-btn-ghost meta-btn-small';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', () => {
            game.audio && game.audio.play('uiClick');
            VC.saveRelaxPoseTune();
        });
        actions.append(resetBtn, saveBtn);
        panel.appendChild(actions);

        if (toggle && !toggle.dataset.bound) {
            toggle.dataset.bound = '1';
            toggle.addEventListener('click', () => {
                game.audio && game.audio.play('uiClick');
                const open = panel.hidden;
                panel.hidden = !open;
                toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
                toggle.textContent = open ? 'Pose tune ▾' : 'Pose tune ▸';
            });
        }

        syncMetaCharPoseTuneInputs(VC.getRelaxPoseTune());
    }

    function syncMetaCharPoseTuneInputs(tune) {
        if (!tune) return;
        document.querySelectorAll('[data-relax-key]').forEach((input) => {
            const key = input.dataset.relaxKey;
            if (!key || tune[key] == null) return;
            input.value = String(tune[key]);
            const val = document.querySelector(`[data-relax-val="${key}"]`);
            if (val) val.textContent = Number(tune[key]).toFixed(3);
        });
    }

    function primeMetaCharPreviewPose(host, char) {
        const VC = window.VoxelCharacter;
        if (!VC || !char) return;
        if (char.anim) char.anim.attackT = -1;
        for (let i = 0; i < 12; i++) {
            VC.update(char, 'relaxed', 0.05, META_CHAR_PREVIEW_ANIM);
        }
    }

    function createMetaCharPreviewHost() {
        return {
            scene: null,
            camera: null,
            renderer: null,
            container: null,
            char: null,
            autoSpin: true,
            yaw: Math.PI * 0.12,
            _lastW: 0,
            _lastH: 0,
            _ptr: { nx: 0, ny: 0, inside: false },
            _dragging: false,
            _lastX: 0,
            _handlers: null,

            mount(container) {
                if (!window.THREE || !container) return false;
                this.container = container;
                container.innerHTML = '';
                this._bindInput(container);
                const w = Math.max(240, container.clientWidth || 300);
                const h = Math.max(300, container.clientHeight || 340);
                this.scene = new THREE.Scene();
                this.scene.fog = new THREE.Fog(0x121830, 6, 14);
                this.camera = new THREE.PerspectiveCamera(38, w / Math.max(h, 1), 0.05, 40);
                this.camera.position.set(0, 1.55, 3.35);
                this.camera.lookAt(0, 1.05, 0);
                this.scene.add(new THREE.HemisphereLight(0xc8dcff, 0x3a2868, 0.9));
                const key = new THREE.DirectionalLight(0xfff0dd, 0.85);
                key.position.set(2.5, 4, 3);
                this.scene.add(key);
                const rim = new THREE.DirectionalLight(0xe878f8, 0.45);
                rim.position.set(-3, 2, -2);
                this.scene.add(rim);
                try {
                    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
                } catch (err) {
                    console.error('[meta-char] WebGL preview failed', err);
                    container.textContent = '3D preview unavailable (WebGL)';
                    return false;
                }
                this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                this.renderer.setSize(w, h, false);
                this.renderer.setClearColor(0x000000, 0);
                container.appendChild(this.renderer.domElement);
                return true;
            },

            resize() {
                if (!this.container || !this.renderer || !this.camera) return;
                const w = Math.max(240, this.container.clientWidth || 300);
                const h = Math.max(300, this.container.clientHeight || 340);
                this._lastW = w;
                this._lastH = h;
                this.renderer.setSize(w, h, false);
                this.camera.aspect = w / Math.max(h, 1);
                this.camera.updateProjectionMatrix();
            },

            toggleSpin() {
                this.autoSpin = !this.autoSpin;
                return this.autoSpin;
            },

            // Drag to rotate the character a full 360°; track the cursor for head/eye follow.
            _bindInput(el) {
                el.style.touchAction = 'none';
                el.style.cursor = 'grab';
                const ptr = this._ptr;
                const onMove = (e) => {
                    const r = el.getBoundingClientRect();
                    ptr.nx = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
                    ptr.ny = ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1;
                    ptr.inside = true;
                    if (this._dragging) {
                        this.yaw += (e.clientX - this._lastX) * 0.011;
                        this._lastX = e.clientX;
                    }
                };
                const onDown = (e) => {
                    this._dragging = true;
                    this._lastX = e.clientX;
                    el.style.cursor = 'grabbing';
                    if (el.setPointerCapture && e.pointerId != null) {
                        try { el.setPointerCapture(e.pointerId); } catch (_) {}
                    }
                };
                const onUp = () => { this._dragging = false; el.style.cursor = 'grab'; };
                const onEnter = () => { ptr.inside = true; };
                const onLeave = () => { ptr.inside = false; this._dragging = false; el.style.cursor = 'grab'; };
                this._handlers = { el, onMove, onDown, onUp, onEnter, onLeave };
                el.addEventListener('pointermove', onMove);
                el.addEventListener('pointerdown', onDown);
                el.addEventListener('pointerup', onUp);
                el.addEventListener('pointerenter', onEnter);
                el.addEventListener('pointerleave', onLeave);
            },

            _unbindInput() {
                const h = this._handlers;
                if (!h) return;
                h.el.removeEventListener('pointermove', h.onMove);
                h.el.removeEventListener('pointerdown', h.onDown);
                h.el.removeEventListener('pointerup', h.onUp);
                h.el.removeEventListener('pointerenter', h.onEnter);
                h.el.removeEventListener('pointerleave', h.onLeave);
                this._handlers = null;
            },

            update(params) {
                const VC = window.VoxelCharacter;
                if (!VC || !params || !this.scene) return;
                if (this.char) {
                    if (this.char.group && this.char.group.parent) this.char.group.parent.remove(this.char.group);
                    VC.dispose(this.char);
                    this.char = null;
                }
                const normalized = VC.normalizeParams(Object.assign({}, params));
                this.char = VC.build(normalized, { weaponEquipped: normalized.weapon >= 0 });
                if (!this.char || !this.char.group) return;
                VC.scaleToHeight(this.char.group, 1.75);
                this.char.group.rotation.y = this.yaw;
                this.scene.add(this.char.group);
                primeMetaCharPreviewPose(this, this.char);
                this.resize();
                this.render(0);
            },

            render(dt) {
                if (!this.renderer || !this.scene || !this.camera) return;
                // Track the (CSS-driven) stage size so the large preview follows window/layout changes.
                if (this.container) {
                    const w = Math.max(240, this.container.clientWidth || 300);
                    const h = Math.max(300, this.container.clientHeight || 340);
                    if (w !== this._lastW || h !== this._lastH) this.resize();
                }
                const VC = window.VoxelCharacter;
                if (dt > 0 && this.char && this.char.group && VC) {
                    const ptr = this._ptr;
                    // Auto-turntable rests while you're interacting, so head/eye follow reads clearly.
                    if (this.autoSpin && !this._dragging && !ptr.inside) this.yaw += dt * 0.45;
                    this.char.group.rotation.y = this.yaw;
                    VC.update(this.char, 'relaxed', dt, META_CHAR_PREVIEW_ANIM);
                    this._applyLook(VC, ptr);
                }
                this.renderer.render(this.scene, this.camera);
            },

            // Head turns toward the cursor (limited), eyes take the residual — when the body is
            // dragged away the gaze pins to the corner, then "gives up". Neutral when not hovering.
            _applyLook(VC, ptr) {
                if (!VC.lookAt) return;
                if (!ptr.inside) { VC.lookAt(this.char, 0, 0, 0, 0); return; }
                const nx = Math.max(-1, Math.min(1, ptr.nx));
                const ny = Math.max(-1, Math.min(1, ptr.ny));
                // Desired head yaw in the character's local frame (world target − body yaw), wrapped.
                let d = nx * 0.85 - this.yaw;
                d = Math.atan2(Math.sin(d), Math.cos(d));
                const headYaw = Math.max(-0.9, Math.min(0.9, d)) * 0.8;
                const headPitch = Math.max(-0.4, Math.min(0.4, ny * 0.5));
                const eyeGx = Math.max(-1, Math.min(1, d / 0.6));
                const eyeGy = Math.max(-1, Math.min(1, ny * 0.85));
                VC.lookAt(this.char, headYaw, headPitch, eyeGx, eyeGy);
            },

            dispose() {
                this._unbindInput();
                const VC = window.VoxelCharacter;
                if (this.char && VC) {
                    if (this.char.group && this.char.group.parent) this.char.group.parent.remove(this.char.group);
                    VC.dispose(this.char);
                }
                this.char = null;
                if (this.renderer) {
                    this.renderer.dispose();
                    if (this.renderer.domElement.parentNode) {
                        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
                    }
                }
                this.renderer = null;
                this.scene = null;
                this.camera = null;
                if (this.container) this.container.innerHTML = '';
            }
        };
    }

    Object.assign(Game3D.prototype, {
        _initMetaState() {
            window.__pjMetaGame = this;
            this.appPhase = 'boot';
            this._playerProfile = null;
            this._charDraft = null;
            this._metaCharUiReady = false;
            this._metaCharPreviewHost = null;
            this._metaCharPreview = null;
            this.activeModeId = null;
            this.run = null;
            this.simPaused = true;
            this._campaignExitReached = false;
            this._levelCompletePlayed = false;
            this._lastResultsModeId = null;
            this._metaEls = {};
            this.creatorMode = {
                active: false,
                pickaxeActive: false,
                ghostMesh: null,
                ghostValid: false,
                buildPlateMeshes: []
            };
            if (typeof ModeRegistry !== 'undefined') {
                this.modeRegistry = new ModeRegistry(this);
            }
            if (this.clearEnemies) this.clearEnemies();
            if (this.player && this.player.model) this.player.model.visible = false;
        },

        setupMetaUI() {
            const overlay = document.getElementById('meta-overlay');
            if (!overlay) return;
            this._metaEls = {
                overlay,
                title: document.getElementById('meta-title'),
                profile: document.getElementById('meta-profile'),
                character: document.getElementById('meta-character'),
                asteroidHome: document.getElementById('meta-asteroid-home'),
                modeSelect: document.getElementById('meta-mode-select'),
                pause: document.getElementById('meta-pause'),
                results: document.getElementById('meta-results'),
                resultsTitle: document.getElementById('meta-results-title'),
                resultsBody: document.getElementById('meta-results-body'),
                levelBanner: document.getElementById('meta-level-banner')
            };

            this._loadPlayerProfile();

            document.getElementById('meta-start-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this._metaContinueFromTitle();
            });
            document.getElementById('meta-profile-save-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this._saveMetaProfileName();
            });
            document.getElementById('meta-profile-input')?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this._saveMetaProfileName();
                }
            });
            document.getElementById('meta-profile-change-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this.setAppPhase('profile');
            });
            document.getElementById('meta-character-edit-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this._openMetaCharacterEditor();
            });
            document.getElementById('meta-character-save-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this._saveMetaCharacter();
            });
            document.getElementById('meta-character-new-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this._newMetaCharacter();
            });
            document.getElementById('meta-char-spin-btn')?.addEventListener('click', (e) => {
                this.audio && this.audio.play('uiClick');
                const host = this._metaCharPreviewHost;
                const on = host ? host.toggleSpin() : false;
                e.currentTarget.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            document.getElementById('meta-character-back-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                const back = this.appPhase === 'character' && this._playerProfile && this._playerProfile.characterSetupDone
                    ? 'modeSelect' : 'profile';
                this.setAppPhase(back);
            });
            document.getElementById('meta-asteroid-play-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this.startMode('asteroid');
            });
            document.getElementById('meta-asteroid-back-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this.setAppPhase('modeSelect');
            });
            document.getElementById('meta-back-title')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this.setAppPhase('title');
            });
            document.getElementById('meta-settings-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this.openSettingsFromMeta();
            });
            document.querySelectorAll('.mode-card').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.modeId;
                    if (!id) return;
                    this.audio && this.audio.play('uiClick');
                    if (id === 'campaign' && (this._loadCampaignSave() || this._loadCampaignScores().length)) {
                        this._showCampaignResumePrompt();
                    } else if (id === 'asteroid') {
                        this._showAsteroidHome();
                    } else {
                        this.startMode(id);
                    }
                });
            });
            this._metaEls.campaignResume = document.getElementById('meta-campaign-resume');
            this._metaEls.resumeSummary = document.getElementById('meta-resume-summary');
            document.getElementById('meta-resume-game-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this._hideCampaignResumePrompt();
                this.startMode('campaign', { resume: true });
            });
            document.getElementById('meta-new-game-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this._clearCampaignSave();
                this._hideCampaignResumePrompt();
                this.startMode('campaign');
            });
            document.getElementById('meta-resume-back-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this._hideCampaignResumePrompt();
            });
            document.getElementById('meta-resume-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this.setAppPhase('playing');
            });
            document.getElementById('meta-quit-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this.quitToModeSelect();
            });
            document.getElementById('meta-retry-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                const id = this._lastResultsModeId;
                if (id) this.startMode(id);
                else this.setAppPhase('modeSelect');
            });
            document.getElementById('meta-results-modes-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this.quitToModeSelect();
            });

            document.getElementById('campaign-continue-btn')?.addEventListener('click', () => {
                this.audio && this.audio.play('uiClick');
                this._onCampaignContinueClick();
            });
            this._campaignEls = {
                intro: document.getElementById('campaign-level-intro'),
                introLevel: document.getElementById('campaign-intro-level'),
                complete: document.getElementById('campaign-level-complete'),
                completeTitle: document.getElementById('campaign-complete-title'),
                completeStats: document.getElementById('campaign-complete-stats')
            };
        },

        isGameplayActive() {
            return this.appPhase === 'playing' && !this.modalOpen && !this.isDrawerOpen;
        },

        _isPreGameMeta() {
            return this.appPhase === 'title' || this.appPhase === 'profile'
                || this.appPhase === 'character' || this.appPhase === 'modeSelect'
                || this.appPhase === 'asteroidHome';
        },

        _loadPlayerProfile() {
            const AP = getAsteroidProfileApi();
            this._playerProfile = AP ? AP.load() : null;
            this._refreshMetaProfileDisplay();
            return this._playerProfile;
        },

        _savePlayerProfile() {
            const AP = getAsteroidProfileApi();
            if (!AP || !this._playerProfile) return this._playerProfile;
            this._playerProfile = AP.save(this._playerProfile);
            this._refreshMetaProfileDisplay();
            return this._playerProfile;
        },

        _refreshMetaProfileDisplay() {
            const el = document.getElementById('meta-profile-display');
            const input = document.getElementById('meta-profile-input');
            const name = (this._playerProfile && this._playerProfile.displayName) || 'Player';
            if (el) el.textContent = name;
            if (input && document.activeElement !== input) input.value = name;
        },

        _metaContinueFromTitle() {
            const p = this._playerProfile || this._loadPlayerProfile();
            if (!p || !p.displayName) {
                this.setAppPhase('profile');
                return;
            }
            if (!p.characterSetupDone) {
                this._openMetaCharacterEditor();
                return;
            }
            this.setAppPhase('modeSelect');
        },

        _saveMetaProfileName() {
            const input = document.getElementById('meta-profile-input');
            const name = (input && input.value || '').trim().slice(0, 16) || 'Player';
            if (!this._playerProfile) this._loadPlayerProfile();
            this._playerProfile.displayName = name;
            this._savePlayerProfile();
            if (!this._playerProfile.characterSetupDone) {
                this._openMetaCharacterEditor();
            } else {
                this.setAppPhase('modeSelect');
            }
        },


        _stopMetaCharPreview() {
            if (this._metaCharPreviewHost) {
                this._metaCharPreviewHost.dispose();
                this._metaCharPreviewHost = null;
            }
            if (this._metaCharPreview) {
                this._metaCharPreview.dispose();
                this._metaCharPreview = null;
            }
        },

        _startMetaCharPreview() {
            this._refreshMetaCharPreview();
        },

        _refreshMetaCharPreview() {
            if (this.appPhase !== 'character') return;
            const el = document.getElementById('meta-char-preview');
            if (!el) return;
            const run = () => {
                if (this.appPhase !== 'character') return;
                if (!this._metaCharPreviewHost) {
                    this._metaCharPreviewHost = createMetaCharPreviewHost();
                    if (!this._metaCharPreviewHost.mount(el)) {
                        this._metaCharPreviewHost = null;
                        return;
                    }
                }
                this._metaCharPreviewHost.resize();
                if (this._charDraft) this._metaCharPreviewHost.update(this._charDraft);
            };
            requestAnimationFrame(() => requestAnimationFrame(run));
        },

        _ensureMetaCharacterUI() {
            const VC = typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
            if (!VC) {
                console.warn('[meta-char] VoxelCharacter module not loaded');
                return false;
            }
            this._buildMetaCharacterUI();
            buildMetaCharPoseTuneUI(this);
            VC.loadRelaxPoseTune();
            syncMetaCharPoseTuneInputs(VC.getRelaxPoseTune());
            this._metaCharUiReady = true;
            return true;
        },

        _openMetaCharacterEditor() {
            const AP = getAsteroidProfileApi();
            const VC = typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
            if (!this._playerProfile) this._loadPlayerProfile();
            if (!this._ensureMetaCharacterUI()) return;
            const base = this._playerProfile ? this._playerProfile.character : null;
            let cfg = base;
            try {
                cfg = AP ? AP.normalizeCharacter(base) : (VC ? VC.normalizeParams(base) : base);
            } catch (_) {
                cfg = VC ? VC.normalizeParams(base) : base;
            }
            this._charDraft = Object.assign({}, cfg);
            const spinBtn = document.getElementById('meta-char-spin-btn');
            if (spinBtn) spinBtn.setAttribute('aria-pressed', 'true');
            this.setAppPhase('character');
            this._syncMetaCharacterUI();
        },

        // Roll a fresh explorer from scratch — a new randomized character to build on.
        _newMetaCharacter() {
            const VC = typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
            if (!VC) return;
            if (!this._metaCharUiReady) this._ensureMetaCharacterUI();
            const pick = (arr) => Math.floor(Math.random() * arr.length);
            const classIdx = pick(VC.CLASSES);
            const cls = VC.CLASSES[classIdx];
            const draft = VC.normalizeParams({
                classIdx,
                body: pick(VC.BODY_TYPES),
                deco: pick(VC.HEAD_DECOS),
                hair: pick(VC.HAIR_COLORS),
                gear: pick(VC.GEAR_COLORS),
                skin: pick(VC.SKIN_TONES),
                weapon: 0
            });
            const wIdx = cls ? VC.weaponIdx(cls.weapon) : -1;
            if (wIdx >= 0) draft.weapon = wIdx;
            this._charDraft = draft;
            if (this.appPhase !== 'character') this.setAppPhase('character');
            this._syncMetaCharacterUI();
        },

        _buildMetaCharacterUI() {
            const grid = document.getElementById('meta-char-class-grid');
            const custom = document.getElementById('meta-char-customize');
            const VC = typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
            if (!grid || !VC) return;

            grid.innerHTML = '';
            VC.CLASSES.forEach((cls, i) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'meta-char-class-btn';
                btn.dataset.classIdx = String(i);
                btn.innerHTML = `<span class="meta-char-icon">${cls.icon}</span>${cls.name}`;
                btn.addEventListener('click', () => {
                    this.audio && this.audio.play('uiClick');
                    if (!this._charDraft) this._charDraft = VC.normalizeParams(null);
                    this._charDraft.classIdx = i;
                    const wIdx = VC.weaponIdx(cls.weapon);
                    if (wIdx >= 0) this._charDraft.weapon = wIdx;
                    this._syncMetaCharacterUI();
                });
                grid.appendChild(btn);
            });

            if (!custom) return;
            const rows = metaCharOptionRows(VC);
            custom.innerHTML = '';
            rows.forEach((row) => {
                const wrap = document.createElement('div');
                wrap.className = 'meta-char-row';
                wrap.dataset.charKey = row.key;
                const label = document.createElement('label');
                label.textContent = row.label;
                wrap.appendChild(label);

                const isPalette = row.key === 'hair' || row.key === 'gear' || row.key === 'skin';
                if (isPalette) {
                    const palette = document.createElement('div');
                    palette.className = 'meta-char-palette';
                    palette.dataset.charPalette = row.key;
                    row.options.forEach((hex, i) => {
                        const chip = document.createElement('button');
                        chip.type = 'button';
                        chip.className = 'meta-char-chip';
                        chip.title = (row.labels && row.labels[i]) ? row.labels[i] : ('Option ' + (i + 1));
                        chip.setAttribute('aria-label', row.label + ': ' + chip.title);
                        chip.style.background = '#' + (hex >>> 0).toString(16).padStart(6, '0');
                        chip.addEventListener('click', () => {
                            this.audio && this.audio.play('uiClick');
                            if (!this._charDraft) this._charDraft = VC.normalizeParams(null);
                            this._charDraft[row.key] = i;
                            this._syncMetaCharacterUI();
                        });
                        palette.appendChild(chip);
                    });
                    wrap.appendChild(palette);
                } else {
                    const cycle = document.createElement('div');
                    cycle.className = 'meta-char-cycle';
                    const prev = document.createElement('button');
                    prev.type = 'button';
                    prev.textContent = '‹';
                    const val = document.createElement('span');
                    val.dataset.charVal = row.key;
                    const next = document.createElement('button');
                    next.type = 'button';
                    next.textContent = '›';
                    const step = (dir) => {
                        this.audio && this.audio.play('uiClick');
                        if (!this._charDraft) this._charDraft = VC.normalizeParams(null);
                        const len = row.options.length;
                        this._charDraft[row.key] = ((this._charDraft[row.key] | 0) + dir + len) % len;
                        this._syncMetaCharacterUI();
                    };
                    prev.addEventListener('click', () => step(-1));
                    next.addEventListener('click', () => step(1));
                    cycle.append(prev, val, next);
                    wrap.appendChild(cycle);
                }
                custom.appendChild(wrap);
            });
        },

        _syncMetaCharacterUI() {
            const VC = typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
            const draft = this._charDraft;
            if (!VC || !draft) return;
            const cls = VC.CLASSES[draft.classIdx | 0] || VC.CLASSES[0];
            document.querySelectorAll('.meta-char-class-btn').forEach((btn) => {
                btn.classList.toggle('active', (btn.dataset.classIdx | 0) === (draft.classIdx | 0));
            });
            const desc = document.getElementById('meta-char-class-desc');
            if (desc) {
                const wIdx = VC.weaponIdx(cls.weapon);
                const wName = wIdx >= 0 ? VC.WEAPONS[wIdx].name : cls.weapon;
                desc.textContent = cls.desc + ' Starts with: ' + wName + '.';
            }
            metaCharOptionRows(VC).forEach((row) => {
                const el = document.querySelector(`[data-char-val="${row.key}"]`);
                if (el) fillMetaCharValueEl(el, row, draft[row.key] | 0);
            });
            syncMetaCharPalettes(draft);
            if (this._metaCharPreviewHost && draft) {
                this._metaCharPreviewHost.update(draft);
            } else if (draft) {
                this._refreshMetaCharPreview();
            }
        },

        _saveMetaCharacter() {
            const AP = getAsteroidProfileApi();
            const VC = typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
            if (!this._playerProfile) this._loadPlayerProfile();
            if (!this._charDraft) return;
            const cfg = AP ? AP.normalizeCharacter(this._charDraft) : (VC ? VC.normalizeParams(this._charDraft) : this._charDraft);
            this._playerProfile.character = cfg;
            this._playerProfile.characterSetupDone = true;
            if (VC && cfg.weapon >= 0) {
                const owned = new Set(this._playerProfile.inventory.ownedWeapons || []);
                owned.add(cfg.weapon | 0);
                const cls = VC.CLASSES[cfg.classIdx | 0];
                if (cls && cls.id === 'miner') {
                    const cutter = VC.weaponIdx('minecutter');
                    if (cutter >= 0) owned.add(cutter);
                }
                this._playerProfile.inventory.ownedWeapons = [...owned];
            }
            this._savePlayerProfile();
            this.setAppPhase('modeSelect');
        },

        _showAsteroidHome() {
            this._loadPlayerProfile();
            this._renderAsteroidHome();
            this.setAppPhase('asteroidHome');
        },

        _renderAsteroidHome() {
            const AP = getAsteroidProfileApi();
            const p = this._playerProfile;
            const statsEl = document.getElementById('meta-claim-stats');
            const missionEl = document.getElementById('meta-mission-card');
            const tag = document.getElementById('meta-claim-tagline');
            if (!AP || !p || !statsEl || !missionEl) return;
            const summary = AP.claimSummary(p);
            if (tag) {
                tag.textContent = (p.displayName || 'Explorer') + ' — progress saves on this device until cloud accounts ship.';
            }
            statsEl.innerHTML = `
                <div class="meta-claim-stat"><b>${summary.name}</b>Claim</div>
                <div class="meta-claim-stat"><b>0x${summary.seedHex}</b>Seed</div>
                <div class="meta-claim-stat"><b>${summary.cataloged}</b>Types cataloged</div>
                <div class="meta-claim-stat"><b>${summary.edits}</b>Block changes saved</div>
            `;
            const prog = AP.missionProgress(p);
            if (prog.done && !prog.mission) {
                missionEl.innerHTML = '<h3>Field journal</h3><p>All starter surveys complete. Keep cataloging — more missions coming.</p>';
            } else if (prog.mission) {
                missionEl.innerHTML = `
                    <h3>${prog.mission.title}</h3>
                    <p>${prog.mission.desc}</p>
                    <div class="meta-mission-progress">${prog.label}</div>
                `;
            }
        },

        setAppPhase(phase) {
            this.appPhase = phase;
            this.simPaused = (phase === 'title' || phase === 'profile' || phase === 'character'
                || phase === 'modeSelect' || phase === 'asteroidHome' || phase === 'paused' || phase === 'results');
            const e = this._metaEls;
            if (!e.overlay) return;
            e.overlay.hidden = false;
            e.title && (e.title.hidden = phase !== 'title');
            e.profile && (e.profile.hidden = phase !== 'profile');
            e.character && (e.character.hidden = phase !== 'character');
            if (phase === 'character') {
                this._startMetaCharPreview();
            } else {
                this._stopMetaCharPreview();
            }
            e.asteroidHome && (e.asteroidHome.hidden = phase !== 'asteroidHome');
            e.modeSelect && (e.modeSelect.hidden = phase !== 'modeSelect');
            e.campaignResume && (e.campaignResume.hidden = true);
            e.pause && (e.pause.hidden = phase !== 'paused');
            e.results && (e.results.hidden = phase !== 'results');
            if (phase === 'profile') {
                this._refreshMetaProfileDisplay();
                const input = document.getElementById('meta-profile-input');
                if (input) setTimeout(() => input.focus(), 50);
            }
            if (phase === 'title' || phase === 'modeSelect' || phase === 'profile' || phase === 'character' || phase === 'asteroidHome') {
                if (this.clearEnemies) this.clearEnemies();
            }
            if (phase === 'modeSelect') this._refreshMetaProfileDisplay();
            if (phase !== 'playing') {
                this.isFiring = false;
                if (document.pointerLockElement) document.exitPointerLock();
                document.body.style.cursor = '';
            }
            if (phase === 'playing' || phase === 'boot') {
                e.overlay.hidden = true;
            }
            if (phase === 'playing' && document.pointerLockElement && this.isDrawerOpen) {
                document.exitPointerLock();
            }
            const preGame = phase === 'title' || phase === 'profile' || phase === 'character'
                || phase === 'modeSelect' || phase === 'asteroidHome';
            document.body.classList.toggle('meta-pre-game', preGame);
            document.body.classList.toggle('meta-active', !e.overlay.hidden);
            this._setPreGameWorldVisible(!preGame);
            const metaCursor = !e.overlay.hidden && !this._settingsOpenedFromMeta;
            this._syncMetaCursor(metaCursor);
        },

        _setPreGameWorldVisible(visible) {
            if (this.activeModeId === 'asteroid') {
                this._hideLegacyPlayUI();
                return;
            }
            const ui = document.getElementById('ui');
            if (ui) {
                ui.style.visibility = visible ? '' : 'hidden';
                ui.style.display = '';
            }
            if (!this.player || !this.player.model) return;
            if (visible) {
                // Respect FPV — do not force the body mesh visible in first person.
                if (this.applyViewModeToPlayerModel) {
                    this.applyViewModeToPlayerModel();
                } else {
                    this.player.model.visible = true;
                }
            } else {
                this.player.model.visible = false;
            }
        },

        // Asteroid is a self-contained sandbox — nothing from maze/campaign HUD or hero rig.
        _hideLegacyPlayUI() {
            document.body.classList.add('mode-asteroid');
            const ui = document.getElementById('ui');
            if (ui) {
                ui.style.visibility = 'hidden';
                ui.style.display = 'none';
            }
            ['inventory-grid-ui', 'compass-ui', 'weapon-hud', 'controls-ui'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            if (this.player && this.player.model) this.player.model.visible = false;
            if (this.facingIndicator) {
                if (this.facingIndicator.groundDot) this.facingIndicator.groundDot.visible = false;
                if (this.facingIndicator.light) this.facingIndicator.light.visible = false;
            }
            for (const id in (this.fpvMelees || {})) {
                const m = this.fpvMelees[id];
                if (m && m.pivot) m.pivot.visible = false;
            }
            if (this.fpvGun) this.fpvGun.visible = false;
            this.isFiring = false;
            this.jetpackArmed = false;
            document.body.style.cursor = 'default';
        },

        _restoreLegacyPlayUI() {
            document.body.classList.remove('mode-asteroid');
            const ui = document.getElementById('ui');
            if (ui) {
                ui.style.visibility = '';
                ui.style.display = '';
            }
            ['inventory-grid-ui', 'compass-ui', 'weapon-hud', 'controls-ui'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.style.display = '';
            });
            if (this.facingIndicator) {
                if (this.facingIndicator.groundDot) this.facingIndicator.groundDot.visible = true;
                if (this.facingIndicator.light) this.facingIndicator.light.visible = true;
            }
            if (this.applyViewModeToPlayerModel) this.applyViewModeToPlayerModel();
            if (this.viewMode === 'fpv' && this.fpvGun) this.fpvGun.visible = true;
            for (const id in (this.fpvMelees || {})) {
                const m = this.fpvMelees[id];
                if (m && m.pivot && this.player && this.player.weapons) {
                    const active = this.player.weapons[this.player.currentWeaponIndex];
                    m.pivot.visible = this.viewMode === 'fpv' && active === id;
                }
            }
            this.isFiring = false;
            this.jetpackArmed = false;
        },

        _moveMetaCustomCursor(e) {
            const el = document.getElementById('meta-custom-cursor');
            if (!el) return;
            const x = e.clientX != null ? e.clientX : 0;
            const y = e.clientY != null ? e.clientY : 0;
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
        },

        _syncMetaCursor(active) {
            document.body.classList.toggle('meta-ui-cursor', !!active);
            if (active) {
                document.body.style.cursor = '';
                if (!this._metaCursorMove) {
                    this._metaCursorMove = (e) => this._moveMetaCustomCursor(e);
                }
                document.addEventListener('mousemove', this._metaCursorMove);
                this._moveMetaCustomCursor({
                    clientX: window.innerWidth * 0.5,
                    clientY: window.innerHeight * 0.5
                });
            } else if (this._metaCursorMove) {
                document.removeEventListener('mousemove', this._metaCursorMove);
            }
        },

        openSettingsFromMeta() {
            this._settingsOpenedFromMeta = true;
            this._syncMetaCursor(false);
            if (document.pointerLockElement) document.exitPointerLock();
            const toolbox = document.getElementById('toolbox-modal');
            if (toolbox) toolbox.style.display = 'none';
            const modal = document.getElementById('settings-modal');
            if (modal) {
                modal.style.display = 'block';
                modal.classList.add('settings-over-meta');
            }
            this.modalOpen = true;
            document.body.classList.add('modal-open', 'meta-settings-open');
            document.body.style.cursor = '';
            if (this.updateModalContent) this.updateModalContent();
        },

        closeSettingsFromMeta() {
            this._settingsOpenedFromMeta = false;
            const modal = document.getElementById('settings-modal');
            if (modal) {
                modal.style.display = 'none';
                modal.classList.remove('settings-over-meta');
            }
            this.modalOpen = false;
            document.body.classList.remove('modal-open', 'meta-settings-open');
            document.body.style.cursor = '';
            if (this.appPhase !== 'playing') {
                this._syncMetaCursor(true);
            }
        },

        startMode(modeId, opts) {
            if (!this.modeRegistry) return;
            if (modeId === 'asteroid') this._loadPlayerProfile();
            const resume = !!(opts && opts.resume);
            if (this._settingsOpenedFromMeta) this.closeSettingsFromMeta();
            if (document.pointerLockElement) document.exitPointerLock();
            this._syncMetaCursor(false);
            this.modalOpen = false;
            this.isDrawerOpen = false;
            const settings = document.getElementById('settings-modal');
            if (settings) settings.style.display = 'none';

            if (modeId === 'campaign') {
                const asciiIdx = this.savedMazes.findIndex((m) => m.type === 'ascii');
                if (asciiIdx >= 0) this.currentMazeIndex = asciiIdx;
            }

            this.activeBlockId = null;

            if (modeId === 'campaign' && resume) {
                const save = this._loadCampaignSave();
                if (save) {
                    this._enterCampaignWithRun(Object.assign(this._newCampaignRun(), save));
                } else {
                    this.modeRegistry.activate(modeId);
                }
            } else {
                if (modeId === 'campaign') this._clearCampaignSave();
                this.modeRegistry.activate(modeId);
            }

            this._campaignExitReached = false;
            this._levelCompletePlayed = false;
            this.setAppPhase('playing');
            if (this.applyViewModeToPlayerModel) this.applyViewModeToPlayerModel();

            if (modeId === 'creator') {
                this._setupCreatorQuickbar();
            }
        },

        _enterCampaignWithRun(run) {
            this._teardownSpecialModes();
            this.gameMode = 'play';
            this.activeModeId = 'campaign';
            this.run = run;
            this.mazeDifficulty = run.stage;
            const diff = document.getElementById('maze-difficulty');
            const diffVal = document.getElementById('maze-difficulty-value');
            if (diff) diff.value = String(run.stage);
            if (diffVal) diffVal.textContent = String(run.stage);
            this.clearMaze && this.clearMaze();
            this.createLabyrinth && this.createLabyrinth();
            this.setupPlayMode && this.setupPlayMode();
            this._beginCampaignLevel && this._beginCampaignLevel();
            this.setViewMode && this.setViewMode('fpv');
        },

        _loadCampaignSave() {
            try {
                const raw = localStorage.getItem(CAMPAIGN_SAVE_KEY);
                if (!raw) return null;
                const data = JSON.parse(raw);
                if (!data || typeof data.stage !== 'number' || data.stage < 1) return null;
                return data;
            } catch (_) { return null; }
        },

        _saveCampaignProgress() {
            const run = this.run;
            if (!run || this.activeModeId !== 'campaign') return;
            try {
                localStorage.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify({
                    stage: run.stage,
                    lives: run.lives,
                    score: run.score || 0,
                    kills: run.kills || 0,
                    totalTimeMs: run.totalTimeMs || 0,
                    savedAt: Date.now()
                }));
            } catch (_) {}
        },

        _clearCampaignSave() {
            try { localStorage.removeItem(CAMPAIGN_SAVE_KEY); } catch (_) {}
        },

        _loadCampaignScores() {
            try {
                const raw = localStorage.getItem(CAMPAIGN_SCORES_KEY);
                if (!raw) return [];
                const arr = JSON.parse(raw);
                return Array.isArray(arr) ? arr : [];
            } catch (_) { return []; }
        },

        _recordCampaignScore({ stage, score, totalTimeMs, completed }) {
            const entry = {
                stage: stage || 1,
                score: score || 0,
                totalTimeMs: totalTimeMs || 0,
                completed: !!completed,
                endedAt: Date.now()
            };
            const all = this._loadCampaignScores();
            all.push(entry);
            all.sort((a, b) => (b.score - a.score) || (b.stage - a.stage) || (a.totalTimeMs - b.totalTimeMs));
            const trimmed = all.slice(0, CAMPAIGN_SCORES_MAX);
            try { localStorage.setItem(CAMPAIGN_SCORES_KEY, JSON.stringify(trimmed)); } catch (_) {}
            return trimmed;
        },

        _formatCampaignScoresHtml(limit = 5) {
            const scores = this._loadCampaignScores().slice(0, limit);
            if (!scores.length) return '';
            const rows = scores.map((s, i) => {
                const tag = s.completed ? '✓' : '·';
                const time = this._formatCampaignTime(s.totalTimeMs);
                return `<li><span class="hs-rank">${i + 1}.</span> <span class="hs-score">${s.score}</span> <span class="hs-meta">${tag} L${s.stage} · ${time}</span></li>`;
            }).join('');
            return `<div class="campaign-highscores"><h3 class="hs-title">Top Scores</h3><ol class="hs-list">${rows}</ol></div>`;
        },

        _showCampaignResumePrompt() {
            const e = this._metaEls;
            if (!e.campaignResume) return;
            const save = this._loadCampaignSave();
            if (e.resumeSummary) {
                e.resumeSummary.textContent = save
                    ? `Level ${save.stage} · Lives ${save.lives} · Score ${save.score || 0}`
                    : 'No saved run — start a new game';
            }
            const resumeBtn = document.getElementById('meta-resume-game-btn');
            if (resumeBtn) resumeBtn.style.display = save ? '' : 'none';
            const slot = document.getElementById('meta-resume-highscores');
            if (slot) slot.innerHTML = this._formatCampaignScoresHtml(5);
            if (e.modeSelect) e.modeSelect.hidden = true;
            e.campaignResume.hidden = false;
        },

        _hideCampaignResumePrompt() {
            const e = this._metaEls;
            if (e.campaignResume) e.campaignResume.hidden = true;
            if (e.modeSelect && this.appPhase === 'modeSelect') e.modeSelect.hidden = false;
        },

        quitToModeSelect() {
            if (this._settingsOpenedFromMeta) this.closeSettingsFromMeta();
            if (this.modeRegistry) this.modeRegistry.exitActive();
            this.exitCreatorMode && this.exitCreatorMode();
            this.activeModeId = null;
            this.gameMode = 'play';
            this.clearMaze && this.clearMaze();
            this.setAppPhase('modeSelect');
        },

        togglePause() {
            if (this.appPhase === 'playing') {
                this.setAppPhase('paused');
            } else if (this.appPhase === 'paused') {
                this.setAppPhase('playing');
            }
        },

        showResults(title, lines, modeId) {
            this._lastResultsModeId = modeId || this.activeModeId;
            const e = this._metaEls;
            if (e.resultsTitle) e.resultsTitle.textContent = title;
            if (e.resultsBody) {
                let html = lines.map((l) => `<p>${l}</p>`).join('');
                if (this._lastResultsModeId === 'campaign') {
                    html += this._formatCampaignScoresHtml(5);
                }
                e.resultsBody.innerHTML = html;
            }
            this.setAppPhase('results');
        },

        _newCampaignRun() {
            return {
                stage: 1,
                lives: 3,
                score: 0,
                kills: 0,
                totalTimeMs: 0,
                timerState: 'waiting_start', // waiting_start | running | stopped
                levelStartTime: null,
                levelElapsedMs: 0
            };
        },

        _stopCampaignRun() {
            this._campaignExitReached = false;
            this._hideCampaignIntro();
            this._hideCampaignLevelComplete();
        },

        _formatCampaignTime(ms) {
            const sec = Math.max(0, ms) / 1000;
            const m = Math.floor(sec / 60);
            const s = (sec % 60).toFixed(1);
            return m > 0 ? `${m}:${s.padStart(4, '0')}` : `${s}s`;
        },

        _getCampaignLevelElapsedMs() {
            const run = this.run;
            if (!run) return 0;
            if (run.timerState === 'running' && run.levelStartTime != null) {
                return performance.now() - run.levelStartTime;
            }
            return run.levelElapsedMs || 0;
        },

        _showCampaignIntro() {
            const run = this.run;
            const els = this._campaignEls;
            if (!els || !els.intro || !run) return;
            if (els.introLevel) {
                els.introLevel.textContent = `LEVEL ${run.stage}`;
            }
            els.intro.hidden = false;
            this._hideCampaignLevelComplete();
        },

        _hideCampaignIntro() {
            if (this._campaignEls && this._campaignEls.intro) {
                this._campaignEls.intro.hidden = true;
            }
        },

        _showCampaignLevelComplete(statsLines, title) {
            const els = this._campaignEls;
            if (!els || !els.complete) return;
            if (els.completeTitle) els.completeTitle.textContent = title || 'Level Complete';
            if (els.completeStats) {
                els.completeStats.innerHTML = statsLines.map((l) => `<p>${l}</p>`).join('');
            }
            els.complete.hidden = false;
            this._hideCampaignIntro();
            if (document.pointerLockElement) document.exitPointerLock();
        },

        _hideCampaignLevelComplete() {
            if (this._campaignEls && this._campaignEls.complete) {
                this._campaignEls.complete.hidden = true;
            }
        },

        campaignQuickbarLayout() {
            return ['diamondSword', 'speed', null, null, null, null, null, null, null];
        },

        _resetCampaignLoadout() {
            this.player.weapons = ['diamondSword'];
            this.player.currentWeaponIndex = 0;
            this.inventory.flags = 10;
            this.inventory.ammo = 0;
            this.inventory.items = [];
            this.inventory.keys = 0;
            this.powerUps = {
                jetpackFuel: 0,
                speedBoostTimer: 0,
                healthRegen: 0,
                weaponBuff: 0
            };
            this.jetpackArmed = false;
            this.isJetpackActive = false;
            this.jetpackThrust = 0;
            this.isReloading = false;
            this.reloadTime = 0;
            this.isFiring = false;
            this.weaponCooldowns = {};
            this.activeBlockId = null;
            this.quickbarLayout = this.campaignQuickbarLayout();
            if (this.attachActiveWeaponToHand) this.attachActiveWeaponToHand();
            this._qbSig = null;
            if (this.updateInventoryGridUI) this.updateInventoryGridUI();
            if (this.updateControlsUI) this.updateControlsUI();
        },

        grantWeapon(weaponId) {
            if (!this.WEAPON_STATS || !this.WEAPON_STATS[weaponId]) return false;
            if (this.player.weapons.includes(weaponId)) return false;
            this.player.weapons.push(weaponId);
            let placed = false;
            for (let i = 0; i < this.quickbarLayout.length; i++) {
                if (!this.quickbarLayout[i]) {
                    this.quickbarLayout[i] = weaponId;
                    placed = true;
                    break;
                }
            }
            if (!placed) this.quickbarLayout[1] = weaponId;
            this.showToast(`Found ${this.t(weaponId)}!`, 'success');
            this.showMessage(`${this.t('switchWeapon')}: ${this.t(weaponId)}`);
            this._qbSig = null;
            if (this.updateInventoryGridUI) this.updateInventoryGridUI();
            if (this.isDrawerOpen && this.updateDrawerUI) this.updateDrawerUI();
            return true;
        },

        _rollCampaignDrop() {
            const table = [
                { type: 'ammo', weight: 24 },
                { type: 'health', weight: 18 },
                { type: 'flag', weight: 16 },
                { type: 'speed', weight: 14 },
                { type: 'jetpack', weight: 12 },
                { type: 'gun', weight: 9, weapon: true },
                { type: 'machineGun', weight: 5, weapon: true }
            ];
            const total = table.reduce((s, e) => s + e.weight, 0);
            let roll = Math.random() * total;
            for (const entry of table) {
                roll -= entry.weight;
                if (roll <= 0) return entry;
            }
            return table[0];
        },

        _spawnCampaignPickup(x, z) {
            let pick = this._rollCampaignDrop();
            for (let i = 0; i < 8; i++) {
                if (!pick.weapon || !this.player.weapons.includes(pick.type)) break;
                pick = this._rollCampaignDrop();
            }
            if (pick.weapon && this.player.weapons.includes(pick.type)) {
                pick = { type: 'ammo', weight: 1 };
            }

            if (pick.weapon) {
                const weaponId = pick.type;
                const w = this.WEAPON_STATS[weaponId];
                const group = new THREE.Group();
                const geo = new THREE.BoxGeometry(0.55, 0.35, 0.85);
                const mat = new THREE.MeshLambertMaterial({
                    color: (w && w.color) || 0xffd28a,
                    emissive: 0x2a1808
                });
                const mesh = new THREE.Mesh(geo, mat);
                group.add(mesh);
                const ringGeo = new THREE.RingGeometry(0.45, 0.8, 24);
                const ringMat = new THREE.MeshBasicMaterial({
                    color: (w && w.color) || 0xffd28a,
                    transparent: true, opacity: 0.45,
                    blending: THREE.AdditiveBlending,
                    side: THREE.DoubleSide, depthWrite: false
                });
                const ring = new THREE.Mesh(ringGeo, ringMat);
                ring.rotation.x = -Math.PI / 2;
                ring.position.y = -0.55;
                group.add(ring);
                const light = new THREE.PointLight((w && w.color) || 0xffd28a, 0.7, 4, 2);
                light.position.set(0, 0.2, 0);
                group.add(light);
                group.position.set(x, 0.6, z);
                group.userData = {
                    type: 'pickup', weaponId, t: 0,
                    glowRing: ring, glowLight: light, visual: mesh
                };
                group.material = mat;
                group.geometry = geo;
                this.pickupsGroup.add(group);
                this.pickups.push(group);
                return;
            }

            const def = this.ITEM_DEFS[pick.type];
            if (!def) return;
            const group = new THREE.Group();
            const mesh = this._buildPickupMesh(pick.type, def);
            group.add(mesh);
            const ringGeo = new THREE.RingGeometry(0.45, 0.8, 24);
            const ringMat = new THREE.MeshBasicMaterial({
                color: def.color, transparent: true, opacity: 0.45,
                blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
            });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = -0.55;
            group.add(ring);
            const light = new THREE.PointLight(def.color, 0.7, 4, 2);
            light.position.set(0, 0.2, 0);
            group.add(light);
            group.position.set(x, 0.6, z);
            group.userData = {
                type: 'pickup', t: 0,
                item: { type: pick.type },
                glowRing: ring, glowLight: light, visual: mesh
            };
            group.material = mesh.material;
            group.geometry = mesh.geometry;
            this.pickupsGroup.add(group);
            this.pickups.push(group);
        },

        _beginCampaignLevel() {
            const run = this.run;
            if (!run) return;
            this._saveCampaignProgress();
            this._resetCampaignLoadout();
            this.activeBlockId = null;
            run.timerState = 'waiting_start';
            run.levelStartTime = null;
            run.levelElapsedMs = 0;
            this._campaignExitReached = false;
            this._levelCompletePlayed = false;
            this.hasLeftStartOnce = false;
            this._campaignSpawnAtStart();
            // Place locked crates at dead-ends + matching keys in corridors,
            // and spawn guardian enemies adjacent to each crate.
            this.placeCampaignMazeContent && this.placeCampaignMazeContent();
            this._showCampaignIntro();
            this.showMessage(`Level ${run.stage} — walk into the START marker`);
            if (this.updateCamera) this.updateCamera();
        },

        _onCampaignStartTouched() {
            const run = this.run;
            if (!run || run.timerState !== 'waiting_start') return;
            run.timerState = 'running';
            run.levelStartTime = performance.now();
            this._hideCampaignIntro();
            this.audio && this.audio.play('uiClick');
            this._flashScreen && this._flashScreen('#3aff7a');
            this.showMessage('Timer started — reach the EXIT!');
        },

        // Brief full-screen color flash — used as a tactile confirmation when
        // the campaign timer starts. Element is created lazily so we don't
        // touch index.html, and reused across triggers.
        _flashScreen(color = '#3aff7a', duration = 380) {
            let el = document.getElementById('screen-flash');
            if (!el) {
                el = document.createElement('div');
                el.id = 'screen-flash';
                el.style.cssText = [
                    'position:fixed', 'inset:0', 'pointer-events:none',
                    'z-index:9500', 'opacity:0', 'mix-blend-mode:screen',
                    'transition:opacity 0.32s ease-out'
                ].join(';');
                document.body.appendChild(el);
            }
            el.style.background = `radial-gradient(ellipse at center, ${color} 0%, rgba(0,0,0,0) 70%)`;
            el.style.transition = 'opacity 0.04s ease-out';
            el.style.opacity = '0.85';
            // Next frame, fade out over `duration` ms.
            requestAnimationFrame(() => {
                el.style.transition = `opacity ${duration}ms ease-out`;
                el.style.opacity = '0';
            });
        },

        _onCampaignContinueClick() {
            const run = this.run;
            if (!run) return;
            this._hideCampaignLevelComplete();
            if (run.stage >= 10) {
                this._clearCampaignSave();
                this._recordCampaignScore({
                    stage: run.stage,
                    score: this.score || 0,
                    totalTimeMs: run.totalTimeMs,
                    completed: true
                });
                this.showResults('Campaign Complete!', [
                    `Total time: ${this._formatCampaignTime(run.totalTimeMs)}`,
                    `Score: ${this.score || 0}`,
                    `Lives left: ${run.lives}`
                ], 'campaign');
                return;
            }
            run.stage = (run.stage || 1) + 1;
            this.mazeDifficulty = run.stage;
            const diff = document.getElementById('maze-difficulty');
            const diffVal = document.getElementById('maze-difficulty-value');
            if (diff) diff.value = String(run.stage);
            if (diffVal) diffVal.textContent = String(run.stage);
            this.clearMaze && this.clearMaze();
            this.createLabyrinth && this.createLabyrinth();
            this.setupPlayMode && this.setupPlayMode();
            this._beginCampaignLevel();
        },

        _teardownSpecialModes() {
            if (this.openWorld && this.openWorld.active) this.exitOpenWorld();
            if (this.arena && this.arena.active) {
                this.arena.active = false;
                this.arena.phase = 'idle';
                this._clearArenaObjects && this._clearArenaObjects();
            }
            if (this.creatorMode && this.creatorMode.active) this.exitCreatorMode();
            if (this.activeModeId === 'asteroid' && this.voxelWorld) {
                this.voxelWorld.exit();
            }
            this.clearEnemies && this.clearEnemies();
        },

        // Unit XZ vector pointing from outside the maze into the entrance cell.
        _computeMazeEntryDirection(maze, row, col) {
            const rows = maze.length;
            const cols = maze[0].length;
            const candidates = [
                { dc: -1, dr: 0, x: 1, z: 0 },
                { dc: 1, dr: 0, x: -1, z: 0 },
                { dc: 0, dr: -1, x: 0, z: 1 },
                { dc: 0, dr: 1, x: 0, z: -1 }
            ];
            const outside = [];
            for (const d of candidates) {
                const nr = row + d.dr;
                const nc = col + d.dc;
                if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || maze[nr][nc] === '#') {
                    outside.push(d);
                }
            }
            if (!outside.length) return { x: 1, z: 0 };
            const offMap = outside.find((d) => {
                const nr = row + d.dr;
                const nc = col + d.dc;
                return nr < 0 || nr >= rows || nc < 0 || nc >= cols;
            });
            const pick = offMap || outside[0];
            return { x: pick.x, z: pick.z };
        },

        _mazeGrid(maze) {
            if (!maze || !maze.length) return [];
            return typeof maze[0] === 'string' ? maze : maze;
        },

        // Border opening used by ASCII campaign mazes (col 0 / col max).
        _findCampaignEntranceCell(maze) {
            const grid = this._mazeGrid(maze);
            if (!grid.length) return null;
            const rows = grid.length;
            const cols = grid[0].length;
            for (let r = 1; r < rows - 1; r++) {
                if (grid[r][0] === '.') return { row: r, col: 0 };
            }
            for (let c = 1; c < cols - 1; c++) {
                if (grid[0][c] === '.') return { row: 0, col: c };
            }
            for (let r = 1; r < rows - 1; r++) {
                if (grid[r][cols - 1] === '.') return { row: r, col: cols - 1 };
            }
            for (let c = 1; c < cols - 1; c++) {
                if (grid[rows - 1][c] === '.') return { row: rows - 1, col: c };
            }
            return null;
        },

        // World position one cell outside the entrance mouth (not inside corridor).
        _computeCampaignSpawnOutside() {
            const info = this.lastMazeInfo;
            if (!info || !info.maze) return null;
            const grid = this._mazeGrid(info.maze);
            const ent = this._findCampaignEntranceCell(grid);
            if (!ent) return null;

            const { startX, startZ, cellSize } = info;
            const entry = this._computeMazeEntryDirection(grid, ent.row, ent.col);
            let intoX = entry.x;
            let intoZ = entry.z;
            const iLen = Math.hypot(intoX, intoZ) || 1;
            intoX /= iLen;
            intoZ /= iLen;

            const markerX = startX + ent.col * cellSize;
            const markerZ = startZ + ent.row * cellSize;
            const playerR = 0.75;
            // One full cell past the entrance tile along -into (exterior void).
            let px = markerX - intoX * (cellSize + 0.65);
            let pz = markerZ - intoZ * (cellSize + 0.65);

            if (this.isPositionFree) {
                for (let extra = 0; extra <= cellSize * 1.5; extra += 0.35) {
                    const tx = markerX - intoX * (cellSize + 0.65 + extra);
                    const tz = markerZ - intoZ * (cellSize + 0.65 + extra);
                    if (this.isPositionFree(tx, tz, playerR)) {
                        px = tx;
                        pz = tz;
                        break;
                    }
                }
            }

            return { px, pz, markerX, markerZ, intoX, intoZ };
        },

        _campaignSpawnAtStart() {
            const outside = this._computeCampaignSpawnOutside();
            if (!outside) {
                if (!this.levelStartWorld) {
                    this.player.hp = this.player.maxHp;
                    return;
                }
            } else {
                if (!this.levelStartWorld) {
                    this.levelStartWorld = new THREE.Vector3();
                }
                this.levelStartWorld.set(outside.markerX, 0, outside.markerZ);
                this.levelEntryDir = { x: outside.intoX, z: outside.intoZ };
                if (this.labyrinthMarkers && this.labyrinthMarkers[0]) {
                    this.labyrinthMarkers[0].position.set(outside.markerX, 1.25, outside.markerZ);
                }
            }

            const start = this.levelStartWorld;
            if (!start) {
                this.player.hp = this.player.maxHp;
                return;
            }

            const px = outside ? outside.px : start.x;
            const pz = outside ? outside.pz : start.z;
            const intoX = outside ? outside.intoX : (this.levelEntryDir && this.levelEntryDir.x) || 1;
            const intoZ = outside ? outside.intoZ : (this.levelEntryDir && this.levelEntryDir.z) || 0;

            this.player.position.set(px, 1, pz);
            this.player.velocity && this.player.velocity.set(0, 0, 0);
            this.player.hp = this.player.maxHp;

            // Face the gold START cone (look down the entrance corridor).
            const dx = start.x - px;
            const dz = start.z - pz;
            const faceLen = Math.hypot(dx, dz);
            if (faceLen > 0.01) {
                this.characterRotation = Math.atan2(dx, dz);
            } else {
                this.characterRotation = Math.atan2(intoX, intoZ);
            }

            this.fpvPitch = 0;
            if (this.playMode && this.playMode.mouseNDC) {
                this.playMode.mouseNDC.set(0, 0);
            }
            // Iso orbit: sit behind the player's view toward the marker.
            this.currentCameraAngle =
                ((this.characterRotation * 180) / Math.PI + 180) % 360;
            if (this.applyViewModeToPlayerModel) this.applyViewModeToPlayerModel();
            if (this.updateSwordViewmodel) this.updateSwordViewmodel(0);
            if (this.updateCamera) this.updateCamera();
        },

        _onCampaignExitReached() {
            if (this._campaignExitReached) return;
            const run = this.run;
            if (!run || run.timerState !== 'running') return;
            this._campaignExitReached = true;
            run.timerState = 'stopped';
            if (run.levelStartTime != null) {
                run.levelElapsedMs = performance.now() - run.levelStartTime;
            }
            run.totalTimeMs = (run.totalTimeMs || 0) + run.levelElapsedMs;
            if (!this._levelCompletePlayed) {
                this._levelCompletePlayed = true;
                this.audio && this.audio.play('levelComplete');
            }
            const levelTime = this._formatCampaignTime(run.levelElapsedMs);
            const lines = [
                `Level ${run.stage} time: ${levelTime}`,
                `Score: ${this.score || 0}`,
                `Lives: ${run.lives}`,
                `Total run: ${this._formatCampaignTime(run.totalTimeMs)}`
            ];
            if (run.stage >= 10) {
                this._showCampaignLevelComplete(lines, 'Campaign Complete!');
            } else {
                this._showCampaignLevelComplete(lines, `Level ${run.stage} Complete`);
            }
        },

        _showLevelBanner(text) {
            const el = this._metaEls.levelBanner;
            if (!el) return;
            el.textContent = text;
            el.hidden = false;
            clearTimeout(this._levelBannerTimer);
            this._levelBannerTimer = setTimeout(() => { el.hidden = true; }, 2000);
        },

        _onCampaignDeath() {
            const run = this.run;
            if (!run) return;
            if (run.timerState === 'running' && run.levelStartTime != null) {
                run.levelElapsedMs = performance.now() - run.levelStartTime;
                run.totalTimeMs = (run.totalTimeMs || 0) + run.levelElapsedMs;
            }
            run.timerState = 'waiting_start';
            run.levelStartTime = null;
            run.lives = (run.lives || 1) - 1;
            if (run.lives > 0) {
                this.showMessage(`Lives left: ${run.lives} — touch START again`);
                this._hideCampaignLevelComplete();
                this._beginCampaignLevel();
                return;
            }
            this._clearCampaignSave();
            this._recordCampaignScore({
                stage: run.stage || 1,
                score: this.score || 0,
                totalTimeMs: run.totalTimeMs,
                completed: false
            });
            this.showResults('Campaign Over', [
                `Reached level ${run.stage || 1}`,
                `Score: ${this.score || 0}`,
                `Total time: ${this._formatCampaignTime(run.totalTimeMs)}`
            ], 'campaign');
        },

        _spawnWideHallsPlayer() {
            const start = this.levelStartWorld;
            if (start) {
                this.player.position.set(start.x, 1, start.z);
                if (this.levelEndWorld) {
                    const dx = this.levelEndWorld.x - start.x;
                    const dz = this.levelEndWorld.z - start.z;
                    this.characterRotation = Math.atan2(dx, dz);
                }
            } else {
                this.player.position.set(0, 1, 0);
            }
            this.player.hp = this.player.maxHp;
            this.player.invulnerable = true;
            this.player.invulnerabilityTimer = 1.0;
            if (this.applyViewModeToPlayerModel) this.applyViewModeToPlayerModel();
            if (this.updateSwordViewmodel) this.updateSwordViewmodel(0);
            if (this.updateCamera) this.updateCamera();
        },

        _onWideHallsDeath() {
            const run = this.run;
            if (!run) return;
            run.lives = (run.lives || 1) - 1;
            if (run.lives > 0) {
                this.showMessage(`Lives left: ${run.lives}`);
                this._spawnWideHallsPlayer();
                return;
            }
            const elapsed = ((performance.now() - (run.startTime || performance.now())) / 1000).toFixed(1);
            this.showResults('Wide Halls — Down', [
                `Kills: ${this.kills || 0}`,
                `Score: ${this.score || 0}`,
                `Time: ${elapsed}s`
            ], 'wide_halls');
        },

        _onWideHallsExitReached() {
            if (this._wideHallsExitReached) return;
            this._wideHallsExitReached = true;
            const run = this.run || {};
            const elapsed = ((performance.now() - (run.startTime || performance.now())) / 1000).toFixed(1);
            this.audio && this.audio.play('levelComplete');
            this.showResults('Halls Cleared', [
                `Kills: ${this.kills || 0}`,
                `Score: ${this.score || 0}`,
                `Time: ${elapsed}s`,
                `Lives left: ${run.lives || 0}`
            ], 'wide_halls');
        },

        _onArenaDeath() {
            const wave = (this.arena && this.arena.wave) || 0;
            const kills = this.kills || 0;
            const score = this.score || 0;
            const elapsed = ((performance.now() - ((this.run && this.run.startTime) || 0)) / 1000).toFixed(1);
            let best = 0;
            try {
                best = parseInt(localStorage.getItem('pjboy.arenaBestWave') || '0', 10) || 0;
            } catch (_) {}
            if (wave > best) {
                try { localStorage.setItem('pjboy.arenaBestWave', String(wave)); } catch (_) {}
                best = wave;
            }
            this.showResults('Arena Over', [
                `Wave reached: ${wave}`,
                `Kills: ${kills}`,
                `Score: ${score}`,
                `Time: ${elapsed}s`,
                `Best wave: ${best}`
            ], 'arena');
            if (this.arena) {
                this.arena.active = false;
                this.arena.phase = 'idle';
            }
        },

        // ---------- Creator mode ----------

        enterCreatorMode() {
            this.gameMode = 'creator';
            this.creatorMode.active = true;
            this.creatorMode.pickaxeActive = false;
            this.activeBlockId = 'stone';
            this.clearMaze && this.clearMaze();
            this.clearEnemies && this.clearEnemies();
            this._buildCreatorPlate();
            this.player.position.set(0, 1, 0);
            this.player.hp = this.player.maxHp;
            this._ensureCreatorCreativeStock();
            this._setupCreatorQuickbar();
            this.setViewMode('fpv');
            this.showMessage('Creator — I: inventory · pickaxe or blocks · click to build');
        },

        exitCreatorMode() {
            if (!this.creatorMode) return;
            this.creatorMode.active = false;
            this.creatorMode.pickaxeActive = false;
            this._removeCreatorGhost();
            this._clearCreatorPlate();
            this.activeBlockId = null;
            if (this._creatorHandTool) {
                this.scene.remove(this._creatorHandTool);
                this._creatorHandTool = null;
            }
        },

        _ensureCreatorCreativeStock() {
            if (!this.inventory.blocks) this.inventory.blocks = {};
            for (const id of Object.keys(this.BLOCK_DEFS || {})) {
                this.inventory.blocks[id] = 999;
            }
            this.inventory.blocks.pickaxe = 1;
        },

        _setupCreatorQuickbar() {
            const blocks = Object.keys(this.BLOCK_DEFS || {});
            this.quickbarLayout = ['pickaxe', ...blocks.slice(0, 8)];
            while (this.quickbarLayout.length < 9) this.quickbarLayout.push(null);
            this._qbSig = null;
            this.updateInventoryGridUI && this.updateInventoryGridUI();
        },

        creatorDefaultQuickbarLayout() {
            const blocks = Object.keys(this.BLOCK_DEFS || {});
            return ['pickaxe', ...blocks.slice(0, 8), null].slice(0, 9);
        },

        _buildCreatorPlate() {
            this._clearCreatorPlate();
            const ids = ['grass', 'dirt', 'stone'];
            const half = CREATOR_PLATE_HALF;
            for (let x = -half; x < half; x++) {
                for (let z = -half; z < half; z++) {
                    const id = ids[((x + half) + (z + half)) % ids.length];
                    const mesh = this._createBlockMesh(id);
                    mesh.position.set(x + 0.5, 0.5, z + 0.5);
                    this.scene.add(mesh);
                    const entry = {
                        mesh,
                        position: mesh.position.clone(),
                        size: { x: 1, y: 1, z: 1 },
                        destructible: true,
                        hp: 1,
                        maxHp: 1,
                        placed: true,
                        blockId: id,
                        creatorFloor: true
                    };
                    this.walls.push(entry);
                    this._addWallToHash(entry);
                    mesh.userData.wallRef = entry;
                    mesh.traverse((c) => { c.userData.wallRef = entry; });
                    this.creatorMode.buildPlateMeshes.push(entry);
                }
            }
        },

        _clearCreatorPlate() {
            const cm = this.creatorMode;
            if (!cm.buildPlateMeshes) cm.buildPlateMeshes = [];
            for (const w of cm.buildPlateMeshes) {
                const i = this.walls.indexOf(w);
                if (i !== -1) this.walls.splice(i, 1);
                this._removeWallFromHash(w);
                if (w.mesh) this.scene.remove(w.mesh);
            }
            cm.buildPlateMeshes = [];
            this.walls = this.walls.filter((w) => !w.creatorFloor);
        },

        _creatorRaycast() {
            const rc = this._cxRaycaster || (this._cxRaycaster = new THREE.Raycaster());
            if (this.viewMode === 'fpv') {
                rc.setFromCamera({ x: 0, y: 0 }, this.camera);
            } else {
                const mouse = this.playMode.mouseNDC;
                rc.setFromCamera(mouse, this.camera);
            }
            const meshes = [];
            for (const w of this.walls) {
                if (w.mesh) meshes.push(w.mesh);
            }
            const hits = rc.intersectObjects(meshes, true);
            if (hits.length) {
                let obj = hits[0].object;
                while (obj.parent && !obj.userData.wallRef) obj = obj.parent;
                const wall = obj.userData.wallRef || this.walls.find((w) => w.mesh === obj || (w.mesh && w.mesh.children && w.mesh.children.includes(obj)));
                const hit = hits[0];
                const wallEntry = wall || this.walls.find((w) => {
                    if (!w.mesh) return false;
                    let found = false;
                    w.mesh.traverse((c) => { if (c === hit.object) found = true; });
                    return found;
                });
                return { hit, wall: wallEntry, point: hit.point, face: hit.face };
            }
            const plane = _scratchPlaneGround;
            const pt = _scratchV3a;
            if (rc.ray.intersectPlane(plane, pt)) {
                return { hit: null, wall: null, point: pt.clone(), face: null };
            }
            return null;
        },

        _snapCellFromPoint(p) {
            return {
                gx: Math.floor(p.x) + 0.5,
                gy: Math.floor(p.y) + 0.5,
                gz: Math.floor(p.z) + 0.5
            };
        },

        _computeCreatorPlaceTarget(rayInfo) {
            if (!rayInfo) return null;
            const { hit, wall, point, face } = rayInfo;
            let gx, gy, gz;
            if (wall && face) {
                const n = face.normal.clone();
                if (wall.mesh) wall.mesh.updateMatrixWorld(true);
                n.transformDirection(wall.mesh.matrixWorld).normalize();
                const c = wall.position;
                if (n.y > 0.5) {
                    gx = c.x; gy = c.y + 1; gz = c.z;
                } else {
                    gx = c.x + Math.round(n.x);
                    gy = c.y + Math.round(n.y);
                    gz = c.z + Math.round(n.z);
                }
            } else if (point) {
                const s = this._snapCellFromPoint(point);
                gx = s.gx; gy = 0.5; gz = s.gz;
            } else return null;
            gx = Math.round(gx * 2) / 2;
            gy = Math.max(0.5, Math.round(gy * 2) / 2);
            gz = Math.round(gz * 2) / 2;
            if (gy > CREATOR_STACK_MAX - 0.5) return null;
            return { gx, gy, gz };
        },

        isCreatorCellFree(gx, gy, gz, radius = 0.45) {
            for (const w of this.walls) {
                const wp = w.position;
                const ws = w.size || { x: 1, y: 1, z: 1 };
                if (Math.abs(gx - wp.x) < ws.x / 2 + radius - 0.01 &&
                    Math.abs(gy - wp.y) < ws.y / 2 + radius - 0.01 &&
                    Math.abs(gz - wp.z) < ws.z / 2 + radius - 0.01) {
                    return false;
                }
            }
            const p = this.player.position;
            if (Math.hypot(p.x - gx, p.z - gz) < 0.85 && Math.abs(p.y - gy) < 1.2) return false;
            return true;
        },

        _updateCreatorGhost() {
            if (!this.creatorMode.active || this.creatorMode.pickaxeActive) {
                this._removeCreatorGhost();
                return;
            }
            const id = this.activeBlockId;
            if (!id || !this.BLOCK_DEFS[id]) {
                this._removeCreatorGhost();
                return;
            }
            const rayInfo = this._creatorRaycast();
            const target = this._computeCreatorPlaceTarget(rayInfo);
            if (!target) {
                this._removeCreatorGhost();
                return;
            }
            const valid = this.isCreatorCellFree(target.gx, target.gy, target.gz);
            this.creatorMode.ghostValid = valid;
            if (!this.creatorMode.ghostMesh) {
                this.creatorMode.ghostMesh = this._createBlockMesh(id);
                this.creatorMode.ghostMesh.traverse((c) => {
                    if (c.isMesh && c.material) {
                        c.material = c.material.clone();
                        c.material.transparent = true;
                        c.material.opacity = 0.45;
                        c.material.depthWrite = false;
                    }
                });
                this.scene.add(this.creatorMode.ghostMesh);
            }
            this.creatorMode.ghostMesh.position.set(target.gx, target.gy, target.gz);
            this.creatorMode.ghostMesh.visible = true;
            const col = valid ? 0x88ff88 : 0xff4444;
            this.creatorMode.ghostMesh.traverse((c) => {
                if (c.isMesh && c.material && c.material.emissive) {
                    c.material.emissive.setHex(col);
                    c.material.emissiveIntensity = 0.35;
                }
            });
            this.creatorMode._placeTarget = target;
        },

        _removeCreatorGhost() {
            if (this.creatorMode.ghostMesh) {
                this.scene.remove(this.creatorMode.ghostMesh);
                this.creatorMode.ghostMesh = null;
            }
            this.creatorMode._placeTarget = null;
        },

        placeCreatorBlock() {
            const id = this.activeBlockId;
            const t = this.creatorMode._placeTarget;
            if (!id || !t || !this.creatorMode.ghostValid) return false;
            const mesh = this._createBlockMesh(id);
            mesh.position.set(t.gx, t.gy, t.gz);
            mesh.traverse((c) => { if (c.isMesh) c.userData.wallRef = null; });
            this.scene.add(mesh);
            const entry = {
                mesh,
                position: mesh.position,
                size: { x: 1, y: 1, z: 1 },
                destructible: true,
                hp: 1,
                maxHp: 1,
                placed: true,
                blockId: id
            };
            mesh.userData.wallRef = entry;
            this.walls.push(entry);
            this._addWallToHash(entry);
            this.audio && this.audio.play('uiClick');
            this._qbSig = null;
            this.updateInventoryGridUI && this.updateInventoryGridUI();
            return true;
        },

        breakCreatorBlock() {
            const rayInfo = this._creatorRaycast();
            if (!rayInfo || !rayInfo.wall) return false;
            const wall = rayInfo.wall;
            if (wall.creatorFloor) return false;
            const bid = wall.blockId || 'stone';
            this._damageWall(wall, 999);
            if (this.inventory.blocks) {
                this.inventory.blocks[bid] = (this.inventory.blocks[bid] || 0) + 1;
            }
            this._qbSig = null;
            this.updateInventoryGridUI && this.updateInventoryGridUI();
            if (this.isDrawerOpen) this.updateDrawerUI();
            return true;
        },

        handleCreatorClick() {
            if (this.creatorMode.pickaxeActive) {
                this.breakCreatorBlock();
            } else {
                this.placeCreatorBlock();
            }
        },

        updateCreatorMode(dt) {
            if (!this.creatorMode.active) return;
            this._updateCreatorGhost();
        }
    });

    // Wrap core loops
    const _updateEnemySpawning = Game3D.prototype.updateEnemySpawning;
    Game3D.prototype.updateEnemySpawning = function (deltaTime) {
        if (this.activeModeId && this.activeModeId !== 'campaign' && this.activeModeId !== 'wide_halls' && !(this.arena && this.arena.active)) return;
        _updateEnemySpawning.call(this, deltaTime);
    };

    const _animate = Game3D.prototype.animate;
    Game3D.prototype.animate = function () {
        requestAnimationFrame(() => this.animate());

        const deltaTime = this.clock.getDelta();
        const clampedDeltaTime = Math.min(deltaTime, Game3D.MAX_FRAME_TIME);

        this.accumulator = (this.accumulator || 0) + clampedDeltaTime;
        while (this.accumulator >= Game3D.FIXED_TIMESTEP) {
            this.fixedUpdate(Game3D.FIXED_TIMESTEP);
            this.accumulator -= Game3D.FIXED_TIMESTEP;
        }

        if (!this._isPreGameMeta || !this._isPreGameMeta()) {
            if (this.activeModeId !== 'asteroid') {
                this.updateSwordViewmodel(clampedDeltaTime);
                this.updatePlacementGhost();
            }
        }
        if (this.activeModeId !== 'asteroid') {
            this.tickMultiplayer(clampedDeltaTime);
        }
        if (this.appPhase === 'character' && this._metaCharPreviewHost) {
            this._metaCharPreviewHost.render(clampedDeltaTime);
        }
        this.render();
    };

    const _render = Game3D.prototype.render;
    Game3D.prototype.render = function () {
        if (this._isPreGameMeta && this._isPreGameMeta()) return;
        _render.call(this);
    };

    const _fixedUpdate = Game3D.prototype.fixedUpdate;
    Game3D.prototype.fixedUpdate = function (deltaTime) {
        if (this.simPaused) return;
        // Asteroid: only the voxel sandbox tick — no maze combat, footsteps, or hero locomotion.
        if (this.activeModeId === 'asteroid') {
            this._hideLegacyPlayUI();
            if (this.voxelWorld) this.voxelWorld.update(deltaTime);
            return;
        }
        _fixedUpdate.call(this, deltaTime);
        if (this.activeModeId === 'open_world' && this.worldStream) {
            this.worldStream.update(deltaTime);
        }
        if (this.activeModeId === 'planet' && this.planetWorld) {
            this.planetWorld.update(deltaTime);
        }
        if (this.gameMode === 'creator') {
            this.updateCreatorMode(deltaTime);
        }
        if (this.activeModeId === 'campaign' && this.modeRegistry) {
            const lose = this.modeRegistry.checkLose();
            if (lose) { /* handled in damagePlayer */ }
        }
    };

    Game3D.prototype.damagePlayer = function (amount) {
        if (this.activeModeId === 'creator' || this.activeModeId === 'asteroid') return;
        if (this.player.invulnerable) return;

        this.player.hp = Math.max(0, this.player.hp - amount);
        this.player.invulnerable = true;
        this.player.invulnerabilityTimer = 1.0;
        this.audio && this.audio.play('playerHurt');
        this._damageVignetteT = 0.45;
        this.showMessage(`${this.t('playerHit')} - ${this.t('health')}: ${this.player.hp}/${this.player.maxHp}`);

        if (this.player.model) {
            const originalMaterials = [];
            this.player.model.traverse((child) => {
                if (child.material) {
                    originalMaterials.push({ child, original: child.material.color.getHex() });
                    child.material.color.setHex(0xff0000);
                }
            });
            setTimeout(() => {
                originalMaterials.forEach(({ child, original }) => {
                    child.material.color.setHex(original);
                });
            }, 200);
        }

        if (this.player.hp <= 0) {
            this.showMessage(this.t('playerDeath'));
            this.audio && this.audio.play('gameOver');
            if (this.activeModeId === 'arena') {
                this._onArenaDeath();
            } else if (this.activeModeId === 'campaign') {
                this._onCampaignDeath();
            } else if (this.activeModeId === 'wide_halls') {
                this._onWideHallsDeath();
            } else if (this.arena && this.arena.active) {
                this.startArenaMode();
            } else {
                this.player.position.set(0, 1, 0);
                this.player.hp = this.player.maxHp;
            }
        }
    };

    Game3D.prototype.updateObjectives = function () {
        if (this.arena && this.arena.active) return;
        if (!this.levelStartWorld || !this.levelEndWorld) return;

        if (this.activeModeId === 'wide_halls') {
            if (this._wideHallsExitReached) return;
            const p = this.player.position;
            if (p.distanceToSquared(this.levelEndWorld) < CAMPAIGN_MARK_TOUCH_SQ) {
                this._onWideHallsExitReached();
            }
            return;
        }

        if (this.activeModeId !== 'campaign') return;
        const run = this.run;
        if (!run || this._campaignEls?.complete && !this._campaignEls.complete.hidden) return;

        const p = this.player.position;
        const atStart = p.distanceToSquared(this.levelStartWorld) < CAMPAIGN_MARK_TOUCH_SQ;
        const atEnd = p.distanceToSquared(this.levelEndWorld) < CAMPAIGN_MARK_TOUCH_SQ;

        if (run.timerState === 'waiting_start' && atStart && this.hasLeftStartOnce) {
            this._onCampaignStartTouched();
        }
        if (run.timerState === 'running' && atEnd) {
            this._onCampaignExitReached();
        }
        if (!atStart) this.hasLeftStartOnce = true;
    };

    const _handlePlayClick = Game3D.prototype.handlePlayClick;
    Game3D.prototype.handlePlayClick = function (event) {
        if (this.gameMode === 'creator') {
            if (!this.isGameplayActive()) return;
            this.handleCreatorClick();
            return;
        }
        if (!this.isGameplayActive()) return;
        // Forward to the base handler — which routes to placeActiveBlock when
        // a block is armed, or to the weapon attack path otherwise.
        _handlePlayClick.call(this, event);
    };

    const _handleMelee = Game3D.prototype.handleMelee;
    Game3D.prototype.handleMelee = function (event) {
        if (!this.isGameplayActive()) return;
        _handleMelee.call(this, event);
    };

    const _handleContinuousFiring = Game3D.prototype.handleContinuousFiring;
    Game3D.prototype.handleContinuousFiring = function (deltaTime) {
        if (!this.isGameplayActive()) {
            this.isFiring = false;
            return;
        }
        _handleContinuousFiring.call(this, deltaTime);
    };

    const _selectGridItem = Game3D.prototype.selectGridItem;
    Game3D.prototype.selectGridItem = function (item) {
        if (this.gameMode === 'creator' && item.id === 'pickaxe') {
            this.creatorMode.pickaxeActive = true;
            this.activeBlockId = null;
            this.showMessage('Pickaxe — click to mine');
            this._qbSig = null;
            this.updateInventoryGridUI && this.updateInventoryGridUI();
            return;
        }
        if (this.gameMode === 'creator') {
            this.creatorMode.pickaxeActive = false;
        }
        _selectGridItem.call(this, item);
    };

    const _updateInventoryGridUI = Game3D.prototype.updateInventoryGridUI;
    Game3D.prototype.updateInventoryGridUI = function () {
        // Blocks are usable in any play mode now — no more stripping from the quickbar.
        if (this.gameMode === 'creator') {
            /* allow quickbar in creator */
        } else if (this.gameMode !== 'play') {
            const existing = document.getElementById('inventory-grid-ui');
            if (existing) existing.style.display = 'none';
            this._qbSig = null;
            return;
        }
        _updateInventoryGridUI.call(this);
    };

    const _updateCrosshairUI = Game3D.prototype.updateCrosshairUI;
    Game3D.prototype.updateCrosshairUI = function () {
        if (this.gameMode === 'creator' && this.viewMode === 'fpv') {
            const htmlCrosshair = document.getElementById('crosshair');
            if (htmlCrosshair) htmlCrosshair.style.display = 'block';
            return;
        }
        _updateCrosshairUI.call(this);
    };

    const _updateObjectiveBannerUI = Game3D.prototype.updateObjectiveBannerUI;
    Game3D.prototype.updateObjectiveBannerUI = function () {
        const el = document.getElementById('objective-banner');
        if (el && this.activeModeId !== 'campaign') {
            el.classList.remove('campaign-active');
            el.style.display = 'none';
            return;
        }
        _updateObjectiveBannerUI.call(this);
        if (this.activeModeId !== 'campaign' || !el) return;
        el.classList.add('campaign-active');
        const run = this.run;
        const timerEl = el.querySelector('.ob-timer');
        if (!timerEl || !run) return;
        if (run.timerState === 'waiting_start') {
            timerEl.textContent = 'TOUCH START';
            timerEl.classList.remove('running');
        } else if (run.timerState === 'running') {
            timerEl.textContent = this._formatCampaignTime(this._getCampaignLevelElapsedMs());
            timerEl.classList.add('running');
        } else if (run.timerState === 'stopped') {
            timerEl.textContent = this._formatCampaignTime(run.levelElapsedMs);
            timerEl.classList.remove('running');
        }
        const lvlEl = el.querySelector('.ob-level');
        if (lvlEl) lvlEl.textContent = `LVL ${run.stage}`;
    };

    const _getItemRegistry = Game3D.prototype.getItemRegistry;
    Game3D.prototype.getItemRegistry = function () {
        const reg = _getItemRegistry.call(this);
        if (this.gameMode === 'creator') {
            const tools = [{ id: 'pickaxe', category: 'tool', icon: '⛏️', name: 'Pickaxe' }];
            return {
                weapons: [],
                consumables: [],
                blocks: reg.blocks,
                tools,
                all: [...tools, ...reg.blocks]
            };
        }
        // The open world and tiny planet surface the pickaxe tool; other play modes don't.
        const tools = this._pickaxeMode && this._pickaxeMode() ? (reg.tools || []) : [];
        // Tiny Planet is a build/explore sandbox — no combat, so hide weapons.
        const weapons = (this.activeModeId === 'planet' || this.activeModeId === 'asteroid') ? [] : reg.weapons;
        return {
            weapons,
            consumables: reg.consumables,
            blocks: reg.blocks,
            tools,
            all: [...weapons, ...reg.consumables, ...reg.blocks, ...tools]
        };
    };

    const _isItemOwned = Game3D.prototype.isItemOwned;
    Game3D.prototype.isItemOwned = function (id) {
        if (this.gameMode === 'creator') {
            if (id === 'pickaxe') return true;
            if (this.BLOCK_DEFS && this.BLOCK_DEFS[id]) return true;
            return false;
        }
        return _isItemOwned.call(this, id);
    };

    const _getItemCount = Game3D.prototype.getItemCount;
    Game3D.prototype.getItemCount = function (id) {
        if (this.gameMode === 'creator' && this.BLOCK_DEFS && this.BLOCK_DEFS[id]) return 999;
        if (this.gameMode === 'creator' && id === 'pickaxe') return 1;
        return _getItemCount.call(this, id);
    };

    Game3D.prototype.initializeBlocks = function () {
        this.BLOCK_DEFS = {
            grass: { path: 'assets/Blocks/Block_Grass.gltf', name: 'Grass', color: 0x4dbb59 },
            dirt: { path: 'assets/Blocks/Block_Dirt.gltf', name: 'Dirt', color: 0x8b6914 },
            stone: { path: 'assets/Blocks/Block_Stone.gltf', name: 'Stone', color: 0x8a8d92 },
            wood: { path: 'assets/Blocks/Block_WoodPlanks.gltf', name: 'Wood', color: 0xc4a574 },
            brick: { path: 'assets/Blocks/pixel blocks/Bricks_Red.gltf', name: 'Brick', color: 0xb85c38 },
            ice: { path: 'assets/Blocks/Block_Ice.gltf', name: 'Ice', color: 0xa8e8ff },
            snow: { path: 'assets/Blocks/Block_Snow.gltf', name: 'Snow', color: 0xf0f8ff },
            coal: { path: 'assets/Blocks/Block_Coal.gltf', name: 'Coal', color: 0x333333 },
            crystal: { path: 'assets/Blocks/Block_Crystal.gltf', name: 'Crystal', color: 0x88ccff }
        };
        this.inventory.blocks = this.inventory.blocks || {};
        for (const id of Object.keys(this.BLOCK_DEFS)) {
            if (this.inventory.blocks[id] == null) this.inventory.blocks[id] = 99;
        }
        this.blockTemplates = {};
        this.blockThumbs = {};
        this.activeBlockId = null;
        const loader = new THREE.GLTFLoader();
        for (const [id, cfg] of Object.entries(this.BLOCK_DEFS)) {
            this.blockThumbs[id] = '🧱';
            loader.load(cfg.path, (gltf) => {
                this.blockTemplates[id] = gltf.scene;
                this.blockThumbs[id] = this._renderBlockThumbnail(gltf.scene, cfg.color) || '🧱';
                if (this.isDrawerOpen) this.updateDrawerUI();
                this._qbSig = null;
                this.updateInventoryGridUI && this.updateInventoryGridUI();
            }, undefined, (err) => {
                console.error(`Error loading block "${id}" from ${cfg.path}:`, err);
            });
        }
    };

    // setGameMode legacy → registry where possible
    const _setGameMode = Game3D.prototype.setGameMode;
    Game3D.prototype.setGameMode = function (mode) {
        if (mode === 'openworld') {
            if (this.modeRegistry && this.appPhase === 'playing') {
                this.modeRegistry.activate('explorer');
                return;
            }
        }
        if (mode === 'arena' && this.modeRegistry && this.activeModeId === 'arena') {
            _setGameMode.call(this, 'arena');
            return;
        }
        _setGameMode.call(this, mode);
    };

    const _toggleSettingsModal = Game3D.prototype.toggleSettingsModal;
    Game3D.prototype.toggleSettingsModal = function () {
        if (this.appPhase === 'modeSelect' || this._settingsOpenedFromMeta) {
            const modal = document.getElementById('settings-modal');
            const isOpen = modal && modal.style.display === 'block';
            if (isOpen) this.closeSettingsFromMeta();
            else this.openSettingsFromMeta();
            return;
        }
        _toggleSettingsModal.call(this);
    };

    const _closeAllModals = Game3D.prototype.closeAllModals;
    Game3D.prototype.closeAllModals = function () {
        if (this._settingsOpenedFromMeta) {
            this.closeSettingsFromMeta();
            return;
        }
        _closeAllModals.call(this);
    };

    const _defaultQuickbarLayout = Game3D.prototype.defaultQuickbarLayout;
    Game3D.prototype.defaultQuickbarLayout = function () {
        if (this.activeModeId === 'campaign') return this.campaignQuickbarLayout();
        if (this.gameMode === 'creator') return this.creatorDefaultQuickbarLayout();
        if (this.activeModeId === 'planet') {
            // Build/explore sandbox — no weapons. Pickaxe + blocks.
            const layout = ['pickaxe', ...Object.keys(this.BLOCK_DEFS || {})].slice(0, 9);
            while (layout.length < 9) layout.push(null);
            return layout;
        }
        if (this.activeModeId === 'asteroid') return Array(9).fill(null);
        return _defaultQuickbarLayout.call(this).map((id) =>
            (id && this.BLOCK_DEFS && this.BLOCK_DEFS[id] ? null : id)
        );
    };

    const _loadQuickbarLayout = Game3D.prototype.loadQuickbarLayout;
    Game3D.prototype.loadQuickbarLayout = function () {
        if (this.activeModeId === 'campaign') {
            this.quickbarLayout = this.campaignQuickbarLayout();
            return;
        }
        if (this.activeModeId === 'planet') {
            // Always the weapon-free build bar; don't restore a saved layout with weapons.
            this.quickbarLayout = this.defaultQuickbarLayout();
            return;
        }
        if (this.activeModeId === 'asteroid') {
            this.quickbarLayout = Array(9).fill(null);
            return;
        }
        _loadQuickbarLayout.call(this);
    };

    const _saveQuickbarLayout = Game3D.prototype.saveQuickbarLayout;
    Game3D.prototype.saveQuickbarLayout = function () {
        if (this.activeModeId === 'campaign') return;
        _saveQuickbarLayout.call(this);
    };

    const _spawnPickup = Game3D.prototype.spawnPickup;
    Game3D.prototype.spawnPickup = function (x, z) {
        if (this.activeModeId === 'campaign') {
            this._spawnCampaignPickup(x, z);
            return;
        }
        _spawnPickup.call(this, x, z);
    };

    const _setupEventListeners = Game3D.prototype.setupEventListeners;
    Game3D.prototype.setupEventListeners = function () {
        _setupEventListeners.call(this);
        document.addEventListener('keydown', (event) => {
            if (event.code !== 'Escape') return;
            if (this.modalOpen || this.isDrawerOpen) return;
            if (this.appPhase === 'playing') {
                event.preventDefault();
                this.togglePause();
            } else if (this.appPhase === 'paused') {
                event.preventDefault();
                this.setAppPhase('playing');
            }
        });
    };

    // Tag wall meshes for creator raycast
    const _updatePlayer = Game3D.prototype.updatePlayer;
    Game3D.prototype.updatePlayer = function (deltaTime) {
        if (this.activeModeId === 'asteroid') return;
        if (this.activeModeId === 'campaign' && this._campaignEls?.complete && !this._campaignEls.complete.hidden) {
            return;
        }
        _updatePlayer.call(this, deltaTime);
    };

    const _updateGroundTargetIndicator = Game3D.prototype.updateGroundTargetIndicator;
    Game3D.prototype.updateGroundTargetIndicator = function () {
        if (this.gameMode === 'creator' && (this.viewMode === 'iso' || this.viewMode === 'birds-eye')) {
            _updateGroundTargetIndicator.call(this);
            return;
        }
        if (this.gameMode === 'creator') return;
        _updateGroundTargetIndicator.call(this);
    };

    const _updateDrawerUI = Game3D.prototype.updateDrawerUI;
    Game3D.prototype.updateDrawerUI = function () {
        if (this.gameMode === 'creator') {
            this.drawerFilter = 'all';
        }
        _updateDrawerUI.call(this);
        if (this.gameMode !== 'creator') return;
        const drawer = document.getElementById('inventory-drawer');
        if (!drawer || !this.isDrawerOpen) return;
        const wSec = drawer.querySelector('.drawer-section h4');
        drawer.querySelectorAll('.drawer-section').forEach((sec) => {
            const h4 = sec.querySelector('h4');
            if (!h4) return;
            const t = h4.textContent || '';
            if (t.startsWith('Blocks')) return;
            sec.style.display = 'none';
        });
        const tools = [{ id: 'pickaxe', type: 'tool', icon: '⛏️', name: 'Pickaxe' }];
        let toolSec = drawer.querySelector('#creator-tool-grid');
        if (!toolSec) {
            const body = drawer.querySelector('.drawer-body');
            if (body) {
                const sec = document.createElement('div');
                sec.className = 'drawer-section';
                sec.innerHTML = '<h4>Tools</h4><div id="creator-tool-grid" class="drawer-grid"></div>';
                body.insertBefore(sec, body.firstChild);
                toolSec = sec.querySelector('#creator-tool-grid');
            }
        }
        if (toolSec) {
            toolSec.innerHTML = '';
            tools.forEach((item) => toolSec.appendChild(this.createDrawerItem(item)));
        }
    };

    const _addLabyrinthMarkers = Game3D.prototype.addLabyrinthMarkers;
    Game3D.prototype.addLabyrinthMarkers = function (maze, info) {
        _addLabyrinthMarkers.call(this, maze, info);
        const grid = this._mazeGrid ? this._mazeGrid(maze) : maze;
        const ent = this._findCampaignEntranceCell && this._findCampaignEntranceCell(grid);
        if (ent && info) {
            const { startX, startZ, cellSize } = info;
            this.levelEntryDir = this._computeMazeEntryDirection(grid, ent.row, ent.col);
            if (this.levelStartWorld) {
                this.levelStartWorld.set(
                    startX + ent.col * cellSize,
                    0,
                    startZ + ent.row * cellSize
                );
            }
        } else if (this.levelStartWorld && info) {
            const { startX, startZ, cellSize } = info;
            const entCol = Math.round((this.levelStartWorld.x - startX) / cellSize);
            const entRow = Math.round((this.levelStartWorld.z - startZ) / cellSize);
            this.levelEntryDir = this._computeMazeEntryDirection(maze, entRow, entCol);
        }
    };

    const _addObjectiveMarkers = Game3D.prototype.addObjectiveMarkers;
    Game3D.prototype.addObjectiveMarkers = function (startWorld, endWorld) {
        _addObjectiveMarkers.call(this, startWorld, endWorld);
        const info = this.lastMazeInfo;
        if (info && this.levelStartCell) {
            this.levelEntryDir = this._computeMazeEntryDirection(
                info.maze,
                this.levelStartCell.y,
                this.levelStartCell.x
            );
        }
    };

    const _addWallToHash = Game3D.prototype._addWallToHash;
    Game3D.prototype._addWallToHash = function (wall) {
        _addWallToHash.call(this, wall);
        if (wall && wall.mesh) {
            wall.mesh.userData.wallRef = wall;
            wall.mesh.traverse((c) => { c.userData.wallRef = wall; });
        }
    };
})();
