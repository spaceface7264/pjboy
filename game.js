// 3D Second-Person Game - 128-bit Style

// =============================================================
// AudioBus: lightweight procedural Web Audio synth.
// All sounds are generated on the fly — no asset files needed.
// Construction is cheap; the AudioContext stays suspended until
// the first user gesture (browsers require this).
// =============================================================
class AudioBus {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.enabled = true;
        this.volume = 0.6;
        this._unlocked = false;
        this._footstepCooldown = 0;
        this._lastNow = 0;
        // Load persisted prefs
        try {
            const raw = localStorage.getItem('pjboy.audio');
            if (raw) {
                const prefs = JSON.parse(raw);
                if (typeof prefs.enabled === 'boolean') this.enabled = prefs.enabled;
                if (typeof prefs.volume === 'number') this.volume = prefs.volume;
            }
        } catch (_) {}
    }

    _ensureContext() {
        if (this.ctx) return this.ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        return this.ctx;
    }

    unlock() {
        const ctx = this._ensureContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();
        this._unlocked = true;
    }

    setVolume(v) {
        this.volume = Math.max(0, Math.min(1, v));
        if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
        this._persist();
    }

    setEnabled(b) {
        this.enabled = !!b;
        if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
        this._persist();
    }

    _persist() {
        try {
            localStorage.setItem('pjboy.audio', JSON.stringify({
                enabled: this.enabled, volume: this.volume
            }));
        } catch (_) {}
    }

    _now() {
        return this.ctx ? this.ctx.currentTime : 0;
    }

    // Core building block: an oscillator with an envelope.
    _tone({ type = 'sine', freq = 440, freqEnd = null, dur = 0.15, gain = 0.3, attack = 0.005, release = null, detune = 0, delay = 0 }) {
        const ctx = this.ctx;
        if (!ctx) return;
        const t0 = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(0.001, freqEnd), t0 + dur);
        if (detune) osc.detune.setValueAtTime(detune, t0);
        const rel = release == null ? dur : release;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(gain, t0 + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + rel);
        osc.connect(g).connect(this.master);
        osc.start(t0);
        osc.stop(t0 + rel + 0.05);
    }

    // Filtered noise burst.
    _noise({ dur = 0.1, gain = 0.3, lowpass = 2000, highpass = 0, delay = 0 }) {
        const ctx = this.ctx;
        if (!ctx) return;
        const t0 = ctx.currentTime + delay;
        const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        let node = src;
        if (lowpass) {
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = lowpass;
            node.connect(lp);
            node = lp;
        }
        if (highpass) {
            const hp = ctx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = highpass;
            node.connect(hp);
            node = hp;
        }
        node.connect(g).connect(this.master);
        src.start(t0);
        src.stop(t0 + dur + 0.05);
    }

    play(name) {
        if (!this.enabled) return;
        const ctx = this._ensureContext();
        if (!ctx || ctx.state !== 'running') return; // gated until first gesture
        switch (name) {
            case 'shoot':
                this._tone({ type: 'sawtooth', freq: 720, freqEnd: 180, dur: 0.09, gain: 0.32 });
                this._noise({ dur: 0.05, gain: 0.18, lowpass: 1800, highpass: 400 });
                break;
            case 'swordSwing':
                this._noise({ dur: 0.18, gain: 0.18, lowpass: 1200, highpass: 200 });
                this._tone({ type: 'sine', freq: 320, freqEnd: 120, dur: 0.18, gain: 0.10 });
                break;
            case 'swordHit':
                this._noise({ dur: 0.12, gain: 0.28, lowpass: 900 });
                this._tone({ type: 'square', freq: 180, freqEnd: 80, dur: 0.1, gain: 0.18 });
                break;
            case 'bulletHit':
                this._noise({ dur: 0.07, gain: 0.22, lowpass: 2400, highpass: 700 });
                this._tone({ type: 'triangle', freq: 260, freqEnd: 110, dur: 0.07, gain: 0.14 });
                break;
            case 'playerHurt':
                this._tone({ type: 'square', freq: 220, freqEnd: 110, dur: 0.22, gain: 0.28 });
                this._noise({ dur: 0.08, gain: 0.12, lowpass: 1200 });
                break;
            case 'enemyDeath':
                this._tone({ type: 'sawtooth', freq: 380, freqEnd: 70, dur: 0.35, gain: 0.28 });
                this._noise({ dur: 0.18, gain: 0.16, lowpass: 1600 });
                break;
            case 'pickupHealth':
                this._tone({ type: 'sine', freq: 660, dur: 0.09, gain: 0.22 });
                this._tone({ type: 'sine', freq: 880, dur: 0.12, gain: 0.22, delay: 0.06 });
                break;
            case 'pickupAmmo':
                this._tone({ type: 'square', freq: 520, dur: 0.07, gain: 0.18 });
                this._tone({ type: 'square', freq: 780, dur: 0.07, gain: 0.18, delay: 0.05 });
                break;
            case 'pickupFlag':
                this._tone({ type: 'triangle', freq: 440, dur: 0.09, gain: 0.22 });
                this._tone({ type: 'triangle', freq: 660, dur: 0.09, gain: 0.22, delay: 0.07 });
                this._tone({ type: 'triangle', freq: 880, dur: 0.12, gain: 0.22, delay: 0.14 });
                break;
            case 'pickupPowerup':
                this._tone({ type: 'sine', freq: 523, dur: 0.10, gain: 0.22 });
                this._tone({ type: 'sine', freq: 659, dur: 0.10, gain: 0.22, delay: 0.07 });
                this._tone({ type: 'sine', freq: 784, dur: 0.10, gain: 0.22, delay: 0.14 });
                this._tone({ type: 'sine', freq: 1047, dur: 0.18, gain: 0.22, delay: 0.21 });
                break;
            case 'footstep':
                this._noise({ dur: 0.05, gain: 0.07 + Math.random() * 0.03, lowpass: 600 + Math.random() * 200 });
                break;
            case 'levelComplete':
                this._tone({ type: 'triangle', freq: 523, dur: 0.18, gain: 0.28 });
                this._tone({ type: 'triangle', freq: 659, dur: 0.18, gain: 0.28, delay: 0.12 });
                this._tone({ type: 'triangle', freq: 784, dur: 0.18, gain: 0.28, delay: 0.24 });
                this._tone({ type: 'triangle', freq: 1047, dur: 0.45, gain: 0.32, delay: 0.36 });
                break;
            case 'gameOver':
                this._tone({ type: 'sawtooth', freq: 220, freqEnd: 80, dur: 0.9, gain: 0.28 });
                this._tone({ type: 'sine', freq: 110, freqEnd: 55, dur: 1.1, gain: 0.18, delay: 0.1 });
                break;
            case 'uiClick':
                this._tone({ type: 'square', freq: 880, dur: 0.04, gain: 0.14 });
                break;
            case 'uiHover':
                this._tone({ type: 'sine', freq: 1320, dur: 0.03, gain: 0.08 });
                break;
            case 'reload':
                this._noise({ dur: 0.06, gain: 0.14, lowpass: 1500, highpass: 600 });
                this._tone({ type: 'square', freq: 320, dur: 0.05, gain: 0.10, delay: 0.08 });
                break;
        }
    }

    // Throttled footstep — call every frame; it self-rate-limits.
    footstep(intervalSec = 0.36) {
        if (!this.enabled) return;
        const ctx = this._ensureContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        if (now - this._lastFootstep > intervalSec) {
            this._lastFootstep = now;
            this.play('footstep');
        }
    }
}
AudioBus.prototype._lastFootstep = 0;

class Game3D {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.player = null;
        this.clock = new THREE.Clock();
        this.keys = {};
        this.mouse = { x: 0, y: 0 };
        this.isPointerLocked = false;
        this.isTouchDevice = false; // set true by setupTouchControls if a touch device is detected
        this.controlScheme = 1; // 1: Mouse controls character, 2: Space orbit, 3: Tank controls, 4: Mouse follow
        this.cameraMode = 'fixed'; // Fixed camera angles like old RE
        this.currentCameraAngle = 0; // 0, 90, 180, 270 degrees
        this.characterRotation = 0; // Character's facing direction
        this.orbitMouseX = 0;
        this.orbitMouseY = 0;
        this.orbitDistance = 10;
        this.orbitHeight = 5;
        this.walls = []; // Store wall objects for collision detection
        this.currentMazeIndex = 0; // Current maze index
        this.savedMazes = []; // Store saved mazes
        this.modalOpen = false; // Track if settings modal is open
        this.labyrinthMarkers = []; // Track entrance/exit markers for cleanup
        this.placedFlags = []; // Persisted player placed flags
        this.flagRemoveRadiusSq = 25; // ~5 units squared removal radius
        
        // Facing indicator (small front light + ground dot)
        this.facingIndicator = {
            enabled: true,
            light: null,
            lightTarget: null,
            groundDot: null
        };
        this.modelYawOffset = 0; // Yaw offset to align model forward with aim (radians)
        this.viewMode = 'iso'; // 'iso' | 'fpv' | 'birds-eye' | 'ghost' — overridden to 'fpv' at end of init()
        this.fpvPitch = 0;
        this.fpvYawSensitivity = 0.0025;
        this.fpvBobAmplitude = 0.05; // camera bobbing in meters
        this.fpvBobFrequency = 8;    // cycles per second when moving
        this.labyrinthCorridorWidth = 8; // world units (within your 5–10 range)
        
        // Ghost camera properties
        this.ghostCamera = {
            position: new THREE.Vector3(0, 50, 0),
            rotation: { x: 0, y: 0 },
            speed: 10,
            mouseSensitivity: 0.002,
            quaternion: new THREE.Quaternion(),
            heightSpeed: 20 // Speed for height changes
        };
        this.crosshair3D = null;
        this.groundTargetIndicator = null; // 3D crosshair object
        this.mazeDifficulty = 5; // 1..10 for ASCII maze generator

        // Language system
        this.language = 'danish'; // Default to Danish
        this.translations = {
            danish: {
                // Game modes
                playMode: 'Spil Tilstand',
                createMode: 'Opret Tilstand',
                
                // Controls
                controls: 'Kontroller',
                wasdMove: 'WASD - Bevæg',
                mouseLook: 'Mus - Kig Rundt',
                mouseTurn: 'Mus - Drej Karakter',
                spaceJump: 'Mellemrum - Hop',
                spaceFly: 'Mellemrum - Flyv',
                spaceCamera: 'Mellemrum - Skift Kamera',
                jJump: 'J - Hop',
                pSettings: 'P - Indstillinger',
                tToolbox: 'T - Værktøjskasse',
                qWall: 'Q - Væg',
                eErase: 'E - Slet',
                shiftLine: 'SHIFT - Lige Linje',
                
                // Settings
                settings: 'Indstillinger',
                controlScheme: 'Kontrol Skema',
                mazeSelection: 'Labyrint Valg',
                gameMode: 'Spil Tilstand',
                gameInfo: 'Spil Info',
                language: 'Sprog',
                theme: 'Tema',
                difficulty: 'Sværhedsgrad',
                close: 'Luk',
                view: 'Visning',
                
                // Control schemes
                mouseCharacter: 'Mus Karakter',
                spaceOrbit: 'Mellemrum Orbit',
                tankControls: 'Tank Kontroller',
                mouseFollow: 'Mus Følg',
                
                // Game info
                playerPosition: 'Spiller Position',
                playerFacing: 'Spiller Retning',
                cameraAngle: 'Kamera Vinkel',
                
                // Inventory
                inventory: 'Inventar',
                items: 'Genstande',
                empty: 'tom',
                health: 'Sundhed',
                playerHp: 'Spiller HP',
                ammo: 'Ammunition',
                flags: 'Flag',
                jetpack: 'Jetpack',
                fuel: 'Brændstof',
                holdSpaceToFly: 'Hold Mellemrum for at flyve',
                
                // Enemies
                enemies: 'Fjender',
                enemiesApproaching: 'Fjender nærmer sig!',
                
                // Messages
                jetpackOnline: 'Jetpack online - Mellemrum for at flyve!',
                jetpackDepleted: 'Jetpack brændstof opbrugt!',
                pickedUp: 'Samlet op',
                healedTo: 'Helbredt til',
                speedBoost: 'Hastigheds boost aktiveret',
                ammoCount: 'Ammunition',
                flagsCount: 'Flag',
                exitReached: 'Udgang nået!',
                backAtStart: 'Tilbage ved start',
                playerHit: 'Spiller ramt!',
                playerDeath: 'Spiller død! Respawning...',
                
                // Weapons
                weapons: 'Våben',
                consumables: 'Forbrugsvarer',
                inventoryDrawer: 'Inventar Skuffe',
                close: 'Luk',
                diamondSword: 'Diamant Sværd',
                diamondSwordDesc: 'Et kraftfuldt diamant sværd med høj skade',
                gun: 'Pistol',
                gunDesc: 'En præcis pistol med høj skade',
                currentWeapon: 'Aktuelt Våben',
                switchWeapon: 'Skift Våben',
                damage: 'Skade',
                range: 'Rækkevidde',
                scrollWeapon: 'Scroll - Skift Våben',
                clickAttack: 'Klik - Angrib',
                ammo: 'Ammunition',
                melee: 'Nærkamp',
                ranged: 'Fjernkamp',
                
                // Power-ups
                powerUps: 'Power-ups',
                jetpackFuel: 'Jetpack Brændstof',
                speedBoost: 'Hastigheds Boost',
                healthRegen: 'Helse Regeneration',
                weaponBuff: 'Våben Forstærkning',
                active: 'Aktiv',
                stacks: 'Stakke',
                noAmmo: 'Ingen ammunition',
                jetpackEmpty: 'Jetpack tom',
                reloading: 'Genindlæser',
                reloaded: 'Genindlæst',
                controls: 'Kontroller',
                movement: 'Bevægelse',
                weapons: 'Våben',
                view: 'Visning',
                game: 'Spil',
                status: 'Status',
                
                // Compass directions
                north: 'Nord',
                northeast: 'Nordøst',
                east: 'Øst',
                southeast: 'Sydøst',
                south: 'Syd',
                southwest: 'Sydvest',
                west: 'Vest',
                northwest: 'Nordvest',
                
                // Maze types
                wideHalls: 'Brede Gange',
                classicSmall: 'Klassisk Lille',
                openArena: 'Åben Arena',
                spiral: 'Spiral',
                labyrinth: 'Labyrint',
                asciiMaze: 'ASCII Labyrint',
                
                // Descriptions
                wideHallsDesc: 'Stor labyrint med brede 5-celle gange',
                classicSmallDesc: 'Lille klassisk labyrint',
                openArenaDesc: 'Åben arena med grænse vægge',
                spiralDesc: 'Spiral labyrint mønster',
                labyrinthDesc: 'Statisk 61x61 hegn labyrint med brede korridorer og blindgyder',
                asciiMazeDesc: 'Genereret ASCII perfekt labyrint (sværhedsgrad-drevet)',
                
                // Instructions
                instructions: 'Instruktioner'
            },
            english: {
                // Game modes
                playMode: 'Play Mode',
                createMode: 'Create Mode',
                
                // Controls
                controls: 'Controls',
                wasdMove: 'WASD - Move',
                mouseLook: 'Mouse - Look Around',
                mouseTurn: 'Mouse - Turn Character',
                spaceJump: 'Space - Jump',
                spaceFly: 'Space - Fly',
                spaceCamera: 'Space - Change Camera',
                jJump: 'J - Jump',
                pSettings: 'P - Settings',
                tToolbox: 'T - Toolbox',
                qWall: 'Q - Wall',
                eErase: 'E - Erase',
                shiftLine: 'SHIFT - Straight Line',
                
                // Settings
                settings: 'Settings',
                controlScheme: 'Control Scheme',
                mazeSelection: 'Maze Selection',
                gameMode: 'Game Mode',
                gameInfo: 'Game Info',
                language: 'Language',
                theme: 'Theme',
                difficulty: 'Difficulty',
                close: 'Close',
                view: 'View',
                
                // Control schemes
                mouseCharacter: 'Mouse Character',
                spaceOrbit: 'Space Orbit',
                tankControls: 'Tank Controls',
                mouseFollow: 'Mouse Follow',
                
                // Game info
                playerPosition: 'Player Position',
                playerFacing: 'Player Facing',
                cameraAngle: 'Camera Angle',
                
                // Inventory
                inventory: 'Inventory',
                items: 'Items',
                empty: 'empty',
                health: 'Health',
                playerHp: 'Player HP',
                ammo: 'Ammo',
                flags: 'Flags',
                jetpack: 'Jetpack',
                fuel: 'Fuel',
                holdSpaceToFly: 'Hold SPACE to fly',
                
                // Enemies
                enemies: 'Enemies',
                enemiesApproaching: 'Enemies approaching!',
                
                // Messages
                jetpackOnline: 'Jetpack online - Space to fly!',
                jetpackDepleted: 'Jetpack fuel depleted!',
                pickedUp: 'Picked up',
                healedTo: 'Healed to',
                speedBoost: 'Speed boost activated',
                ammoCount: 'Ammo',
                flagsCount: 'Flags',
                exitReached: 'Exit reached!',
                backAtStart: 'Back at start',
                playerHit: 'Player hit!',
                playerDeath: 'Player died! Respawning...',
                
                // Weapons
                weapons: 'Weapons',
                consumables: 'Consumables',
                inventoryDrawer: 'Inventory Drawer',
                close: 'Close',
                diamondSword: 'Diamond Sword',
                diamondSwordDesc: 'A powerful diamond sword with high damage',
                gun: 'Pistol',
                gunDesc: 'A precise pistol with high damage',
                currentWeapon: 'Current Weapon',
                switchWeapon: 'Switch Weapon',
                damage: 'Damage',
                range: 'Range',
                scrollWeapon: 'Scroll - Switch Weapon',
                clickAttack: 'Click - Attack',
                ammo: 'Ammo',
                melee: 'Melee',
                ranged: 'Ranged',
                
                // Power-ups
                powerUps: 'Power-ups',
                jetpackFuel: 'Jetpack Fuel',
                speedBoost: 'Speed Boost',
                healthRegen: 'Health Regeneration',
                weaponBuff: 'Weapon Buff',
                active: 'Active',
                stacks: 'Stacks',
                noAmmo: 'No ammo',
                jetpackEmpty: 'Jetpack empty',
                reloading: 'Reloading',
                reloaded: 'Reloaded',
                controls: 'Controls',
                movement: 'Movement',
                weapons: 'Weapons',
                view: 'View',
                game: 'Game',
                status: 'Status',
                
                // Compass directions
                north: 'North',
                northeast: 'Northeast',
                east: 'East',
                southeast: 'Southeast',
                south: 'South',
                southwest: 'Southwest',
                west: 'West',
                northwest: 'Northwest',
                
                // Maze types
                wideHalls: 'Wide Halls',
                classicSmall: 'Classic Small',
                openArena: 'Open Arena',
                spiral: 'Spiral',
                labyrinth: 'Labyrinth',
                asciiMaze: 'ASCII Maze',
                
                // Descriptions
                wideHallsDesc: 'Large maze with wide 5-cell halls',
                classicSmallDesc: 'Small classic maze',
                openArenaDesc: 'Open arena with border walls',
                spiralDesc: 'Spiral maze pattern',
                labyrinthDesc: 'Static 61x61 hedge maze with wide corridors and dead ends',
                asciiMazeDesc: 'Generated ASCII perfect maze (difficulty-driven)',
                
                // Instructions
                instructions: 'Instructions'
            }
        };
        
        // Theme — desert only
        this.themeName = 'desert';
        this.themes = {
            desert: {
                ground: 0xc2b280,
                grid: 0xffe8a0,
                wall: 0xa68a5b,
                wallEmissive: 0x3b2c14,
                sky: 0xdfe6ff,
                ambient: 0x705f3a,
                sun: 0xffd27a
            }
        };
        this.materials = { wall: null };
        
        // Game modes
        this.gameMode = 'play'; // 'play' or 'create'
        this.createMode = {
            tool: 'wall', // Current tool: 'wall', 'erase', 'start', 'end'
            gridSize: 20, // Grid size for create mode
            customMaze: [], // Custom maze layout
            highlightObjects: [], // Objects for grid highlighting
            isPlacing: false, // Whether currently placing objects
            previewObject: null, // Preview object for current tool
            isMouseDown: false, // Whether mouse is currently pressed
            lastGridPos: null, // Last grid position for continuous placement
            startLinePos: null, // Starting position for straight line
            isShiftHeld: false // Whether SHIFT key is held down
        };
        
        // Play mode (Diablo-style) state
        this.playMode = {
            // WASD move + mouse aim
            moveSpeed: 8,
            accel: 40,      // units/s^2 acceleration
            decel: 30,      // units/s^2 deceleration
            rotateLerp: 12, // radians/s for turn smoothing toward aim
            projectiles: [],
            projectileSpeed: 30,
            enemies: [],
            enemiesGroup: new THREE.Group(),
            cameraOffset: new THREE.Vector3(-8, 10, -8), // isometric offset (closer 2nd-person)
            mouseNDC: new THREE.Vector2(0, 0),
            orbitEnabled: false,
            lastMouseX: null
        };
        // Pickups + Inventory
        this.pickups = [];
        this.dropChance = 0.7; // 70% chance to drop on enemy death
        this.inventory = {
            items: [],            // { type, label }
            selectedIndex: 0,
            ammo: 0,
            flags: 9999,
            health: 100,
            maxHealth: 100,
            speedBoostTimer: 0,
            jetpackTimer: 0,
            jetpackFuel: 0,
            maxJetpackFuel: 100
        };
        
        // Jetpack state
        this.isJetpackActive = false;
        this.jetpackThrust = 0;
        this.jetpackParticles = [];
        
        // Gameplay tuning
        this.wallDensity = 0.3; // 0..1 fraction of interior walls to keep
        this.enemyCount = 10;   // number of targets to spawn in play mode
        this.maxEnemies = 25;   // maximum enemies allowed at once
        this.enemySpawnTimer = 0; // timer for continuous spawning
        this.enemySpawnInterval = 30; // seconds between enemy spawns

        // Arena / Wave mode (sub-mode of 'play')
        this.arena = {
            active: false,
            phase: 'idle', // 'idle' | 'intro' | 'wave-active' | 'eruption' | 'boss-fight' | 'wave-complete'
            wave: 0,
            enemiesToSpawn: 0,
            enemiesSpawnedThisWave: 0,
            spawnTimer: 0,
            spawnInterval: 1.4,
            arenaHalf: 30,
            perimeterWalls: [],
            pillars: [],
            decor: [],
            arenaObjects: [],
            volcano: null,
            // Lava tuning: slow rise during eruption, keeps creeping up during boss-fight,
            // capping high enough to threaten the tallest platform.
            lava: { mesh: null, y: -50, restY: -50, peakY: 0.4, bossCap: 5.2, rising: false, riseSpeed: 0, tickTimer: 0, targetY: -50 },
            shake: { intensity: 0, duration: 0, elapsed: 0 },
            volcanoParticles: [],
            boss: null,
            eruptionTimer: 0,
            eruptionDuration: 4.5,
            waveCompleteTimer: 0,
            introTimer: 0,
            introDuration: 4.7,
            introLastLabel: null,
        };

        this.audio = new AudioBus();
        this._setupAudioUnlock();

        this.init();
        this.setupEventListeners();
        // Pickups must initialize before weapons: loadQuickbarLayout (called from
        // initializeWeapons) builds the default layout from both registries.
        this.initializePickups();
        this.initializeWeapons();
        this.initMultiplayer();
        this.animate();
    }

    _setupAudioUnlock() {
        const unlock = () => {
            this.audio.unlock();
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('touchstart', unlock);
        };
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('keydown', unlock);
        window.addEventListener('touchstart', unlock);

        // Delegated UI click sound for any modal button.
        document.addEventListener('click', (ev) => {
            const t = ev.target;
            if (!t || !t.closest) return;
            if (t.closest('.modal') && t.matches && (t.matches('button') || t.matches('.maze-btn,.view-btn,.language-btn,.mode-btn,.tool-btn,.character-btn'))) {
                this.audio && this.audio.play('uiClick');
            }
        });
    }

    initializePickups() {
        // One source of truth for pickups: spawn visuals, activation effect, toast text.
        // `weight` is the relative drop frequency (sum doesn't have to equal 100).
        // `autoApply: true` means picking it up immediately stacks the stat —
        // it never sits in the bag waiting to be activated.
        const g = this;
        this.ITEM_DEFS = {
            health:      { emoji: '❤️', color: 0x66ff66, weight: 22, labelKey: 'health',      labelSuffix: ' +25',
                apply() { g.inventory.health = Math.min(g.inventory.maxHealth, g.inventory.health + 25);
                          g.player.hp = Math.min(g.player.maxHp, g.player.hp + 25); } },
            ammo:        { emoji: '🔸', color: 0xffff66, weight: 22, labelKey: 'ammo',        labelSuffix: ' +10', autoApply: true,
                apply() { g.inventory.ammo = Math.min(g.inventory.ammo + 10, g.AMMO_MAX); g.updateWeaponPowerUpUI(); } },
            jetpack:     { emoji: '🚀', color: 0xffaa66, weight: 16, labelKey: 'jetpackFuel', labelSuffix: ' +50', autoApply: true,
                apply() { g.powerUps.jetpackFuel += 50; } },
            speed:       { emoji: '⚡', color: 0x66ccff, weight: 12, labelKey: 'speedBoost',  labelSuffix: ' +1',
                apply() { g.powerUps.speedBoost += 1; } },
            weaponBuff:  { emoji: '⚔️', color: 0xff8866, weight: 10, labelKey: 'weaponBuff',  labelSuffix: ' +1',
                apply() { g.powerUps.weaponBuff += 1; } },
            healthRegen: { emoji: '💚', color: 0xaaff88, weight: 10, labelKey: 'healthRegen', labelSuffix: ' +1',
                apply() { g.powerUps.healthRegen += 1; } },
            flag:        { emoji: '🏁', color: 0xff66aa, weight: 6,  labelKey: 'flag',        labelSuffix: ' +1', autoApply: true,
                apply() { g.inventory.flags += 1; if (g.updateControlsUI) g.updateControlsUI(); } }
        };
    }

    // Display label that respects current language
    itemLabel(type) {
        const def = this.ITEM_DEFS[type];
        if (!def) return type;
        return `${this.t(def.labelKey)}${def.labelSuffix || ''}`;
    }

    // Pickup toast string (emoji + translated label)
    pickupToast(type) {
        const def = this.ITEM_DEFS[type];
        if (!def) return `📦 ${type}`;
        return `${def.emoji} ${this.itemLabel(type)}`;
    }

    // === Single source of truth for the inventory/drawer/quickbar UI ===
    // Returns the canonical list of every item the game knows about, derived from
    // WEAPON_STATS and ITEM_DEFS so adding/removing one entry there propagates
    // through the entire UI.
    getItemRegistry() {
        const weapons = Object.entries(this.WEAPON_STATS).map(([id, w]) => ({
            id, category: 'weapon', icon: w.icon, name: this.t(id)
        }));
        const consumables = Object.entries(this.ITEM_DEFS).map(([id, d]) => ({
            id, category: 'consumable', icon: d.emoji, name: this.t(d.labelKey)
        }));
        return { weapons, consumables, all: [...weapons, ...consumables] };
    }

    // How many of `id` does the player currently own/have stocked?
    getItemCount(id) {
        if (this.WEAPON_STATS[id]) return this.player.weapons.includes(id) ? 1 : 0;
        switch (id) {
            case 'health':      return this.inventory.items.filter(i => i.type === 'health').length;
            case 'ammo':        return this.inventory.ammo;
            case 'jetpack':     return Math.floor(this.powerUps.jetpackFuel);
            case 'speed':       return this.powerUps.speedBoost;
            case 'healthRegen': return this.powerUps.healthRegen;
            case 'weaponBuff':  return this.powerUps.weaponBuff;
            case 'flag':        return this.inventory.flags;
            default:            return this.inventory.items.filter(i => i.type === id).length;
        }
    }

    isItemOwned(id) {
        return this.getItemCount(id) > 0;
    }

    initializeWeapons() {
        // Static weapon stats — single source of truth for tuning.
        // Names/descriptions are filled in by `weaponDefinitions` getter so language switches update them.
        this.WEAPON_STATS = {
            diamondSword: { damage: 15, range: 2.5, cooldown: 0.8, type: 'melee',  icon: '⚔️', color: 0x00aaff, ammoCost: 0 },
            // ammoCost = 0 means free-fire (canFire/fireGun skip ammo checks).
            gun:          { damage: 25, range: 15,  cooldown: 0.1, type: 'ranged', icon: '🔫', color: 0x8B4513, ammoCost: 0 }
        };

        // Tuning constants
        this.AMMO_MAX = 50;            // hard cap on carried ammo
        this.RELOAD_TIME = 1.5;
        this.RELOAD_AMOUNT = 12;       // R fills a "clip" worth, not magic-refill
        this.WEAPON_BUFF_PER_STACK = 0.2;

        // Player loadout
        this.player.weapons = ['diamondSword', 'gun'];
        this.player.currentWeaponIndex = 0;
        this.inventory.ammo = 12;      // starting clip

        // Power-up stacks
        this.powerUps = {
            jetpackFuel: 0,
            speedBoost: 0,
            healthRegen: 0,
            weaponBuff: 0
        };

        // Weapon runtime state
        this.weaponCooldowns = {};
        this.isFiring = false;
        this.isReloading = false;
        this.reloadTime = 0;

        // Cooldown UI throttling (10 Hz)
        this.lastCooldownUpdate = 0;
        this.cooldownUpdateInterval = 100;

        // Drawer state
        this.isDrawerOpen = false;
        this.selectedDrawerSlot = 0;
        this.draggedItem = null;
        this.dragStartSlot = null;

        // Toast notifications
        this.toasts = [];
        this.toastId = 0;

        // Jetpack control mode. Space jumps unless the player has explicitly
        // armed the jetpack from the quickbar (and there's fuel).
        this.jetpackArmed = false;

        this.createWeaponModel();
        this.loadQuickbarLayout();
        this.mountHUD();
    }

    // Always reflects the current language for names/descriptions.
    get weaponDefinitions() {
        const out = {};
        for (const id of Object.keys(this.WEAPON_STATS)) {
            out[id] = {
                ...this.WEAPON_STATS[id],
                name: this.t(id),
                description: this.t(id + 'Desc')
            };
        }
        return out;
    }
    
    // ===== Weapon HUD Model System =====
    
    buildHUDModel() {
        // Single source of truth for weapon state - called by HUD and gameplay
        const currentWeapon = this.getCurrentWeapon();
        if (!currentWeapon) return null;
        
        const weaponId = this.player.weapons[this.player.currentWeaponIndex];
        const cooldown = this.weaponCooldowns[weaponId] || 0;
        const ammoCount = this.inventory.ammo || 0;
        
        return {
            // Weapon info
            weapon: currentWeapon,
            weaponId: weaponId,
            weaponIndex: this.player.currentWeaponIndex,
            
            // Ammo state
            ammoCount: ammoCount,
            isReloading: this.isReloading,
            reloadTime: this.reloadTime,
            reloadProgress: this.isReloading ? Math.max(0, (2.0 - this.reloadTime) / 2.0) : 0,
            
            // Cooldown state
            cooldown: cooldown,
            cooldownPercent: Math.max(0, (cooldown / currentWeapon.cooldown) * 100),
            canFire: this.canFire(),
            
            // Power-ups
            powerUps: {
                speedBoost: this.powerUps.speedBoost,
                healthRegen: this.powerUps.healthRegen,
                weaponBuff: this.powerUps.weaponBuff,
                jetpackFuel: Math.floor(this.powerUps.jetpackFuel)
            },
            
            // Player state
            gameMode: this.gameMode,
            isDrawerOpen: this.isDrawerOpen
        };
    }
    
    canFire() {
        // Shared validation function for gameplay and HUD
        if (this.gameMode !== 'play') return false;
        if (this.isDrawerOpen) return false;
        if (this.isReloading) return false;
        
        const currentWeapon = this.getCurrentWeapon();
        if (!currentWeapon) return false;
        
        // Check cooldown
        const weaponId = this.player.weapons[this.player.currentWeaponIndex];
        if (this.weaponCooldowns[weaponId] && this.weaponCooldowns[weaponId] > 0) {
            return false;
        }
        
        // Check ammo for ranged weapons
        if (currentWeapon.type === 'ranged' && currentWeapon.ammoCost > 0) {
            if (this.inventory.ammo < currentWeapon.ammoCost) {
                return false;
            }
        }
        
        return true;
    }
    
    // ===== Event Bus System =====
    
    emit(event, data) {
        // Simple event bus for UI updates
        if (!this.eventListeners) {
            this.eventListeners = {};
        }
        
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event listener for ${event}:`, error);
                }
            });
        }
    }
    
    on(event, callback) {
        if (!this.eventListeners) {
            this.eventListeners = {};
        }
        
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        
        this.eventListeners[event].push(callback);
    }
    
    off(event, callback) {
        if (!this.eventListeners || !this.eventListeners[event]) return;
        
        const index = this.eventListeners[event].indexOf(callback);
        if (index > -1) {
            this.eventListeners[event].splice(index, 1);
        }
    }
    
    buildSwordMesh() {
        // Wrapper Group that holds either the loaded sword GLTF or a procedural placeholder.
        // Wrappers are tracked so they can be re-populated once the GLTF arrives.
        const wrapper = new THREE.Group();
        wrapper.userData.isSwordWrapper = true;
        this._swordWrappers = this._swordWrappers || [];
        this._swordWrappers.push(wrapper);
        this.populateSwordWrapper(wrapper);
        if (!this.swordTemplate && !this._swordTemplateLoading) this.loadSwordTemplate();
        return wrapper;
    }

    populateSwordWrapper(wrapper) {
        while (wrapper.children.length) wrapper.remove(wrapper.children[0]);
        if (this.swordTemplate) {
            const t = this.swordTemplate;
            const clone = t.clone(true);
            const o = t.userData.orient;
            clone.rotation.set(o.rot.x, o.rot.y, o.rot.z);
            clone.position.set(0, o.posY, 0);
            clone.scale.setScalar(o.scale);
            wrapper.add(clone);
            return;
        }
        // Procedural fallback while the GLTF loads
        const blade = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 1.2, 0.05),
            new THREE.MeshLambertMaterial({ color: 0x9fdcff, emissive: 0x002244 })
        );
        blade.position.set(0, 0.6, 0);
        blade.castShadow = true;
        wrapper.add(blade);
        const guard = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 0.1, 0.1),
            new THREE.MeshLambertMaterial({ color: 0xffaa00 })
        );
        guard.position.set(0, 0.1, 0);
        guard.castShadow = true;
        wrapper.add(guard);
        const handle = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.8, 0.15),
            new THREE.MeshLambertMaterial({ color: 0x8B4513 })
        );
        handle.position.set(0, -0.3, 0);
        handle.castShadow = true;
        wrapper.add(handle);
        const pommel = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 8, 8),
            new THREE.MeshLambertMaterial({ color: 0xffaa00 })
        );
        pommel.position.set(0, -0.7, 0);
        pommel.castShadow = true;
        wrapper.add(pommel);
    }

    loadSwordTemplate() {
        this._swordTemplateLoading = true;
        const loader = new THREE.GLTFLoader();
        loader.load('assets/Blocks/tools/Sword_Diamond.gltf', (gltf) => {
            const template = gltf.scene;
            template.traverse((child) => {
                if (child.isMesh) {
                    const src = child.material;
                    child.material = new THREE.MeshLambertMaterial({
                        map: src.map || null,
                        color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
                        side: src.side
                    });
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            // Orient the asset so its blade points along +Y like the old procedural sword,
            // and scale so total length ≈ 1.8 units (matches the box-sword the gameplay was tuned for).
            // Discover the longest axis on the *un-rotated* mesh to pick the right correction.
            const box0 = new THREE.Box3().setFromObject(template);
            const sz = box0.getSize(new THREE.Vector3());
            let rx = 0, rz = 0;
            if (sz.x >= sz.y && sz.x >= sz.z) rz = Math.PI / 2;       // longest along X → tilt to Y
            else if (sz.z >= sz.y && sz.z >= sz.x) rx = Math.PI / 2;  // longest along Z → tilt to Y
            template.rotation.set(rx, 0, rz);
            template.updateMatrixWorld(true);
            const box1 = new THREE.Box3().setFromObject(template);
            const sz1 = box1.getSize(new THREE.Vector3());
            const scale = sz1.y > 0 ? 1.8 / sz1.y : 1;
            // Reset rotation; we'll re-apply on each clone via userData.orient so cloning starts clean.
            template.rotation.set(0, 0, 0);
            // After scaling, the box.min.y in cloned-space will be box1.min.y * scale.
            const posY = -box1.min.y * scale;
            template.userData.orient = { rot: { x: rx, y: 0, z: rz }, scale, posY };
            this.swordTemplate = template;
            this._swordTemplateLoading = false;
            if (this._swordWrappers) this._swordWrappers.forEach((w) => this.populateSwordWrapper(w));
        }, undefined, (error) => {
            console.error('Error loading Sword_Diamond.gltf:', error);
            this._swordTemplateLoading = false;
        });
    }

    createWeaponModel() {
        // ===== Third-person hand-held weapons =====
        // Build a sword and a gun, each wrapped in a pivot Group whose local
        // position/rotation can be tuned to fit the character's right-hand bone.
        // The pivot's transform is the "grip" — when attached to a hand bone the
        // weapon emerges from the fist with a natural orientation.

        this.player.swordPivot = new THREE.Group();
        const heldSword = this.buildSwordMesh();
        heldSword.scale.setScalar(0.6);
        // The sword's local +Y is the blade. Rotate so the blade points along +Z
        // (forward of the fist) and lower the handle to sit inside the palm.
        heldSword.rotation.set(-Math.PI / 2, 0, 0);
        heldSword.position.set(0, 0, 0.1);
        this.player.swordPivot.add(heldSword);

        this.player.gunPivot = new THREE.Group();
        const heldGun = this._buildGunMesh();
        heldGun.scale.setScalar(1.0);
        // The gun's -Z is forward. Rotate so the barrel points along the fist's forward.
        heldGun.rotation.set(0, Math.PI, 0);
        heldGun.position.set(0, 0, 0);
        this.player.gunPivot.add(heldGun);
        this.player.gunPivot.userData.muzzle = heldGun.userData.muzzle;

        // Active 3rd-person weapon model — populated by attachActiveWeaponToHand
        this.player.weaponModel = null;

        // ===== FPV viewmodels =====
        const fpvSword = this.buildSwordMesh();
        const fpvPivot = new THREE.Group();
        fpvPivot.position.set(0.45, -0.45, -0.9);
        fpvSword.rotation.set(-0.5, -0.2, -0.6);
        fpvSword.scale.setScalar(0.7);
        fpvPivot.add(fpvSword);
        this.camera.add(fpvPivot);
        this.fpvSword = fpvPivot;
        this.fpvSword.visible = false;

        // Swing animation state
        this.swingTimer = 0;
        this.swingDuration = 0.25;

        this.fpvGun = this._buildFpvGun();
        this.camera.add(this.fpvGun);
        this.fpvGun.visible = false;

        this._gunRecoilT = 0;
        this._gunRecoilDur = 0.12;

        // Attempt initial hand attachment (no-op if player.handSocket isn't ready yet)
        this.attachActiveWeaponToHand();
    }

    // Finds the right-hand bone of the loaded character model, in priority order.
    findRightHandBone(model) {
        if (!model) return null;
        const priority = [
            /^fist[._-]?r$/i, /^right.?fist$/i,
            /^hand[._-]?r$/i, /^right.?hand$/i,
            /^lower.?arm[._-]?r$/i, /^right.?lower.?arm$/i,
            /^arm[._-]?r$/i, /^right.?arm$/i
        ];
        for (const re of priority) {
            let hit = null;
            model.traverse((c) => { if (!hit && c.name && re.test(c.name)) hit = c; });
            if (hit) return hit;
        }
        return null;
    }

    // Called from loadPlayerModel once the character is in the scene.
    setupHandSocket() {
        // Clean up any previous socket reference
        this.player.handSocket = null;
        if (!this.player.model) return;
        const bone = this.findRightHandBone(this.player.model);
        if (!bone) return;
        const socket = new THREE.Object3D();
        socket.name = 'WeaponSocket';
        // Per-character grip tuning. Bones in these GLTFs were built with hands at
        // the model's sides in T-pose, so an empty fist origin works as a reasonable
        // default. Tweak here if a specific character grips weapons oddly.
        socket.position.set(0, 0, 0);
        socket.rotation.set(0, 0, 0);
        bone.add(socket);
        this.player.handSocket = socket;
        this.attachActiveWeaponToHand();
    }

    // Picks the right 3p weapon model based on the currently equipped weapon and
    // re-parents it to the hand socket. Falls back to the player.model root if
    // no socket is available yet.
    attachActiveWeaponToHand() {
        if (!this.player || !this.player.swordPivot || !this.player.gunPivot) return;
        const cur = this.getCurrentWeapon && this.getCurrentWeapon();
        const isRanged = cur && cur.type === 'ranged';
        const active = isRanged ? this.player.gunPivot : this.player.swordPivot;
        const inactive = isRanged ? this.player.swordPivot : this.player.gunPivot;
        // Remove inactive from scene graph
        if (inactive.parent) inactive.parent.remove(inactive);
        // Attach active to socket (or player model root as fallback)
        const target = this.player.handSocket || this.player.model;
        if (!target) return;
        if (active.parent !== target) {
            if (active.parent) active.parent.remove(active);
            target.add(active);
        }
        this.player.weaponModel = active;
    }

    _buildGunMesh() {
        // Returns the pistol assembly only — used both inside _buildFpvGun (FPV viewmodel)
        // and as the 3rd-person weapon clipped onto the character's hand.
        const gun = new THREE.Group();
        const matBody = new THREE.MeshLambertMaterial({ color: 0x2b2b32, emissive: 0x05050a });
        const matAccent = new THREE.MeshLambertMaterial({ color: 0x5a5a64, emissive: 0x0a0a10 });
        const matGrip = new THREE.MeshLambertMaterial({ color: 0x3a2614, emissive: 0x0a0604 });

        // Slide / body
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.46), matBody);
        body.position.set(0, 0, -0.08);
        gun.add(body);

        // Top sight rail
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.04, 0.4), matAccent);
        rail.position.set(0, 0.10, -0.08);
        gun.add(rail);

        // Barrel
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.22, 12), matAccent);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.02, -0.36);
        gun.add(barrel);

        // Front sight
        const fsight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.04), matAccent);
        fsight.position.set(0, 0.13, -0.28);
        gun.add(fsight);

        // Trigger guard
        const guard = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 14, Math.PI), matAccent);
        guard.rotation.z = Math.PI;
        guard.position.set(0, -0.08, 0.04);
        gun.add(guard);

        // Grip (angled)
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.22, 0.13), matGrip);
        grip.position.set(0, -0.18, 0.06);
        grip.rotation.x = 0.18;
        gun.add(grip);

        // Magazine base
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.04, 0.13), matAccent);
        mag.position.set(0, -0.30, 0.06);
        mag.rotation.x = 0.18;
        gun.add(mag);

        // Muzzle anchor — at the barrel tip in local space.
        const muzzle = new THREE.Object3D();
        muzzle.position.set(0, 0.02, -0.48);
        gun.add(muzzle);
        gun.userData.muzzle = muzzle;
        return gun;
    }

    _buildFpvGun() {
        // Outer pivot positions the whole weapon on screen.
        const pivot = new THREE.Group();
        pivot.position.set(0.36, -0.32, -0.6);
        pivot.rotation.set(0, -0.12, 0);

        const gun = this._buildGunMesh();
        pivot.userData.muzzle = gun.userData.muzzle;

        // Muzzle flash sprite — hidden by default; toggled on fire.
        const flashGeo = new THREE.PlaneGeometry(0.32, 0.32);
        const flashMat = new THREE.MeshBasicMaterial({
            color: 0xffe1a0, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        });
        const flash = new THREE.Mesh(flashGeo, flashMat);
        flash.position.copy(gun.userData.muzzle.position);
        flash.position.z -= 0.04;
        flash.userData.t = 0;
        gun.add(flash);
        pivot.userData.flash = flash;

        // Tilt the gun slightly inward toward screen center for that classic FPS "carried" pose.
        gun.rotation.set(0.02, 0.18, -0.04);

        pivot.add(gun);
        pivot.userData.gun = gun;
        return pivot;
    }

    triggerSwordSwing() {
        this.swingTimer = this.swingDuration;
    }

    updateSwordViewmodel(deltaTime) {
        const cur = this.getCurrentWeapon();
        const inFPV = this.viewMode === 'fpv';
        const inPlay = this.gameMode === 'play';

        // ---- Sword viewmodel ----
        if (this.fpvSword) {
            const wieldingSword = cur && cur.type === 'melee';
            this.fpvSword.visible = wieldingSword && inFPV && inPlay;
            if (this.swingTimer > 0) {
                this.swingTimer = Math.max(0, this.swingTimer - deltaTime);
                const t = 1 - (this.swingTimer / this.swingDuration);
                const arc = Math.sin(t * Math.PI);
                this.fpvSword.rotation.z = -arc * 1.4;
                this.fpvSword.rotation.x = arc * 0.6;
                this.fpvSword.position.z = -0.9 - arc * 0.25;
            } else {
                this.fpvSword.rotation.z = 0;
                this.fpvSword.rotation.x = 0;
                this.fpvSword.position.z = -0.9;
            }
        }

        // ---- Gun viewmodel ----
        if (this.fpvGun) {
            const wieldingGun = cur && cur.type === 'ranged';
            this.fpvGun.visible = wieldingGun && inFPV && inPlay;

            // Recoil tween: kick back along +Z (toward camera), ease back to rest.
            const baseZ = -0.6;
            const baseRotX = 0;
            if (this._gunRecoilT > 0) {
                this._gunRecoilT = Math.max(0, this._gunRecoilT - deltaTime);
                const k = this._gunRecoilT / this._gunRecoilDur; // 1 → 0 over duration
                const ease = k * k; // ease-out
                this.fpvGun.position.z = baseZ + ease * 0.18;
                this.fpvGun.rotation.x = baseRotX - ease * 0.45;
            } else {
                this.fpvGun.position.z = baseZ;
                this.fpvGun.rotation.x = baseRotX;
            }

            // Slight idle bob on the gun when moving (only when visible)
            if (this.fpvGun.visible && this.player && this.player.velocity) {
                const v = this.player.velocity;
                const speed = Math.hypot(v.x, v.z);
                this._gunBobT = (this._gunBobT || 0) + deltaTime * (speed * 1.5 + 1.5);
                const bobAmt = Math.min(1, speed / 6);
                this.fpvGun.position.y = -0.32 + Math.sin(this._gunBobT * 2) * 0.012 * bobAmt;
                this.fpvGun.position.x = 0.36 + Math.cos(this._gunBobT) * 0.008 * bobAmt;
            }

            // Muzzle flash sprite fade
            const flash = this.fpvGun.userData.flash;
            if (flash) {
                flash.userData.t = Math.max(0, (flash.userData.t || 0) - deltaTime);
                const k2 = flash.userData.t / 0.06;
                flash.material.opacity = Math.max(0, k2);
                if (k2 > 0) {
                    const s = 0.6 + (1 - k2) * 0.8;
                    flash.scale.set(s, s, s);
                    flash.rotation.z = (this._flashSpin = (this._flashSpin || 0) + 0.6);
                }
            }
        }
    }

    triggerGunRecoil() {
        this._gunRecoilT = this._gunRecoilDur;
        if (this.fpvGun && this.fpvGun.userData.flash) {
            this.fpvGun.userData.flash.userData.t = 0.06;
        }
    }
    
    getCurrentWeapon() {
        if (this.player.weapons.length === 0) return null;
        const weaponId = this.player.weapons[this.player.currentWeaponIndex];
        return this.weaponDefinitions[weaponId];
    }
    
    switchWeapon(direction = 1) {
        if (this.player.weapons.length <= 1) return;

        this.player.currentWeaponIndex = (this.player.currentWeaponIndex + direction) % this.player.weapons.length;
        if (this.player.currentWeaponIndex < 0) {
            this.player.currentWeaponIndex = this.player.weapons.length - 1;
        }

        const currentWeapon = this.getCurrentWeapon();
        if (currentWeapon) {
            this.showMessage(`${this.t('switchWeapon')}: ${currentWeapon.name}`);
        }

        this.audio && this.audio.play('uiClick');

        // Swap the 3rd-person hand-held weapon to match
        this.attachActiveWeaponToHand();

        // Emit UI update event
        this.emit('ui:update', this.buildHUDModel());
        // Refresh quickbar so the selection highlight follows the active weapon
        this.updateInventoryGridUI && this.updateInventoryGridUI();
    }
    
    reloadWeapon() {
        const weapon = this.getCurrentWeapon();
        if (!weapon || weapon.type !== 'ranged' || this.isReloading) return;

        this.isReloading = true;
        this.reloadTime = this.RELOAD_TIME;
        this.showMessage(`${this.t('reloading')}...`);
        this.emit('ui:update', this.buildHUDModel());
    }

    updateReload(deltaTime) {
        if (!this.isReloading) return;

        this.reloadTime -= deltaTime;
        if (this.reloadTime <= 0) {
            this.isReloading = false;
            this.inventory.ammo = Math.min(this.inventory.ammo + this.RELOAD_AMOUNT, this.AMMO_MAX);
            this.showMessage(`${this.t('reloaded')} - ${this.t('ammo')}: ${this.inventory.ammo}`);
            this.emit('ui:update', this.buildHUDModel());
        }
    }
    
    attackWithWeapon() {
        // Use shared canFire() validation
        if (!this.canFire()) {
            const weapon = this.getCurrentWeapon();
            if (this.isReloading) {
                this.showMessage(`${this.t('reloading')}...`);
            } else if (weapon && weapon.type === 'ranged' && weapon.ammoCost > 0 && this.inventory.ammo < weapon.ammoCost) {
                this.showMessage(`${this.t('noAmmo')} - ${this.t('ammo')}: ${this.inventory.ammo}`);
            }
            return;
        }
        
        const weapon = this.getCurrentWeapon();
        const weaponId = this.player.weapons[this.player.currentWeaponIndex];
        
        // Consume ammo for ranged weapons
        if (weapon.type === 'ranged' && weapon.ammoCost > 0) {
            this.inventory.ammo -= weapon.ammoCost;
        }
        
        // Set cooldown
        this.weaponCooldowns[weaponId] = weapon.cooldown;
        
        // Emit UI update event
        this.emit('ui:update', this.buildHUDModel());
        
        // Apply weapon buff damage multiplier
        const damageMultiplier = 1 + (this.powerUps.weaponBuff * this.WEAPON_BUFF_PER_STACK);
        const finalDamage = Math.floor(weapon.damage * damageMultiplier);

        // Both melee and ranged share the same raycast-along-camera attack;
        // only impact colors and the miss-trail effect differ.
        const isRanged = weapon.type === 'ranged';
        if (!isRanged) this.triggerSwordSwing();
        this.audio && this.audio.play(isRanged ? 'shoot' : 'swordSwing');
        if (isRanged) this.triggerMuzzleFlash && this.triggerMuzzleFlash();
        this.triggerAttackPose && this.triggerAttackPose();
        // Play the character's Attack clip once so the body actually swings/fires
        this.playOneShotAnimation('Attack', isRanged ? 0.2 : 0.4);
        this.performAttack({
            damage: finalDamage,
            range: weapon.range,
            hitColor: isRanged ? 0xff0000 : 0xffaa55,
            missColor: isRanged ? 0xffff00 : 0xcccccc,
            isRanged
        });
    }

    performAttack({ damage, range, hitColor, missColor, isRanged = false }) {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);

        const hits = raycaster.intersectObjects(this.playMode.enemies, true);
        for (const hit of hits) {
            if (hit.distance > range) break;
            const e = this.findEnemyRoot(hit.object);
            if (!e) continue;
            e.userData.hp -= damage;
            this.spawnImpact(hit.point.clone(), hitColor);
            this.audio && this.audio.play(isRanged ? 'bulletHit' : 'swordHit');

            if (e.userData.hp <= 0) {
                this.killEnemy(e);
            } else {
                this.applyEnemyKnockback(e, this.camera.position, isRanged ? 8 : 6);
                this.flashEnemy(e);
                this.showEnemyHPBar(e, 3.0);
            }
            return;
        }

        // Miss — show trail/impact at range end
        const origin = this.camera.position.clone();
        const dir = raycaster.ray.direction.clone();
        const endPoint = origin.add(dir.multiplyScalar(range));
        this.spawnImpact(endPoint, missColor);
    }

    applyEnemyKnockback(e, sourcePos, strength = 7) {
        const dx = e.position.x - sourcePos.x;
        const dz = e.position.z - sourcePos.z;
        const len = Math.hypot(dx, dz) || 1;
        e.userData.knockback = new THREE.Vector2((dx / len) * strength, (dz / len) * strength);
        e.userData.stunT = 0.35;
        // Flinch: brief recoil away from the shot, decays in updateEnemies
        e.userData.flinchT = 0.25;
        e.userData.flinchMax = 0.25;
    }

    findEnemyRoot(obj) {
        while (obj) {
            if (obj.userData && obj.userData.type === 'enemy') return obj;
            obj = obj.parent;
        }
        return null;
    }

    flashEnemy(e) {
        const flashed = [];
        e.traverse((child) => {
            if (child.isMesh && child.material && child.material.color) {
                flashed.push({ mat: child.material, orig: child.material.color.getHex() });
                child.material.color.setHex(0xffffff);
            }
        });
        setTimeout(() => flashed.forEach(({ mat, orig }) => mat.color.setHex(orig)), 80);
    }
    
    // Translation helper
    t(key) {
        return this.translations[this.language][key] || key;
    }
    
    // Set language and update UI
    setLanguage(lang) {
        if (this.translations[lang]) {
            this.language = lang;
            this.updateAllUI();
        }
    }
    
    // Update all UI elements with current language
    updateAllUI() {
        this.updateModalContent();
        this._qbSig = null;
        this.updateInventoryGridUI && this.updateInventoryGridUI();
        if (this.isDrawerOpen) this.updateDrawerUI();
    }

    // Single source of truth for "is the player model visible?". Call this whenever
    // viewMode changes OR the player model is replaced (character swap, async load, etc.)
    applyViewModeToPlayerModel() {
        if (this.player && this.player.model) {
            this.player.model.visible = (this.viewMode !== 'fpv');
        }
    }

    setViewMode(mode) {
        // Only first-person and second-person (iso) are supported.
        if (mode !== 'iso' && mode !== 'fpv') {
            return;
        }
        this.viewMode = mode;
        // Reset pitch when leaving/entering fpv for comfort
        if (mode !== 'fpv') this.fpvPitch = 0;
        // Force orbit off in FPV, birds-eye, and ghost
        if (mode === 'fpv') {
            this.playMode.orbitEnabled = false;
            this.playMode.lastMouseX = null;
        }
        
        // Initialize ghost camera position when entering ghost mode
        if (mode === 'ghost') {
            this.ghostCamera.position.copy(this.player.position);
            this.ghostCamera.position.y += 10; // Start 10 units above player
            this.ghostCamera.rotation.x = -Math.PI/4; // Look down at 45 degrees
            this.ghostCamera.rotation.y = 0; // Face forward
            
            // Initialize quaternion from Euler angles
            const quatY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.ghostCamera.rotation.y);
            const quatX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.ghostCamera.rotation.x);
            this.ghostCamera.quaternion.multiplyQuaternions(quatY, quatX);
        }
        // Hide player model in FPV to avoid clipping into the camera
        this.applyViewModeToPlayerModel();
        // Auto-hide facing indicator in FPV
        if (this.facingIndicator && this.facingIndicator.groundDot && this.facingIndicator.light) {
            const show = (mode !== 'fpv') && this.facingIndicator.enabled;
            this.facingIndicator.groundDot.visible = show;
            this.facingIndicator.light.visible = show;
        }
        // Crosshair visibility will be handled by updateCrosshairUI()
    }
    
    init() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0xb8c4d0, 120, 400);
        
        // Create camera (second-person perspective)
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 5, 10); // Behind and above player
        // Camera must be in the scene graph so children (FPV viewmodel) render.
        this.scene.add(this.camera);
        
        // Create renderer with 128-bit aesthetic
        const canvas = document.getElementById('gameCanvas');
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: canvas, 
            antialias: false,
            alpha: false
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(1);
        this.renderer.setClearColor(0x000000);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        
        // Create player (invisible in second-person view)
        this.createPlayer();
        
        // Create environment
        this.createEnvironment();
        
        // Add lighting
        this.setupLighting();

        // Add enemies group to scene
        this.scene.add(this.playMode.enemiesGroup);
        // Add pickups group to scene
        this.pickupsGroup = new THREE.Group();
        this.scene.add(this.pickupsGroup);

        // If starting in play mode, ensure enemies are spawned
        if (this.gameMode === 'play') {
            this.setupPlayMode();
        }

        // Apply initial theme
        this.applyTheme(this.themeName);

        // Default to first-person view (runs setViewMode side effects: hide model, etc.)
        this.setViewMode('fpv');

        // Open-world system (hub + 4 portal-linked sub-worlds). Reuses player,
        // collision, gravity. Activated via setGameMode('openworld').
        if (typeof OpenWorldSystem !== 'undefined') {
            this.openWorld = new OpenWorldSystem(this);
        }
    }

    createPlayer() {
        // Player is invisible in second-person view, but we track its position
        this.player = {
            position: new THREE.Vector3(0, 0, 0),
            rotation: new THREE.Euler(0, 0, 0),
            velocity: new THREE.Vector3(0, 0, 0),
            onGround: false,
            model: null,
            mixer: null,
            hp: 100,
            maxHp: 100,
            invulnerable: false,
            invulnerabilityTimer: 0,
            weapons: [],
            currentWeaponIndex: 0,
            weaponModel: null
        };
        
        // Registry of swappable player characters (key matches data-character on the UI buttons)
        this.characters = {
            skeleton: { label: 'Skeleton', path: 'assets/Blocks/enemies/Skeleton_Armor.gltf' },
            female1:  { label: 'Female 1', path: 'assets/Blocks/Characters/Character_Female_1.gltf' },
            female2:  { label: 'Female 2', path: 'assets/Blocks/Characters/Character_Female_2.gltf' },
            male1:    { label: 'Male 1',   path: 'assets/Blocks/Characters/Character_Male_1.gltf' },
            male2:    { label: 'Male 2',   path: 'assets/Blocks/Characters/Character_Male_2.gltf' }
        };
        this.currentCharacterKey = this.currentCharacterKey || 'skeleton';

        // Build the temporary lion archer model so the player has *something* visible while async-loading the character.
        this.createLionArcherModel();
        // Create facing indicator after model exists
        this.createFacingIndicator();
        // Swap in the textured character model once it loads
        this.loadPlayerModel(this.characters[this.currentCharacterKey].path);
    }

    generateCharacterPreviews() {
        if (!this.characters || this._previewsStarted) return;
        this._previewsStarted = true;
        const size = 192; // render at 2x display size for crispness
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        renderer.setSize(size, size);
        renderer.setClearColor(0x000000, 0);
        renderer.outputEncoding = THREE.sRGBEncoding || renderer.outputEncoding;

        const loader = new THREE.GLTFLoader();
        const renderOne = (key, cfg) => {
            loader.load(cfg.path, (gltf) => {
                const scene = new THREE.Scene();
                scene.add(new THREE.AmbientLight(0xffffff, 0.85));
                const key1 = new THREE.DirectionalLight(0xffffff, 0.9);
                key1.position.set(2, 3, 4);
                scene.add(key1);
                const key2 = new THREE.DirectionalLight(0xfff0c8, 0.4);
                key2.position.set(-3, 2, -2);
                scene.add(key2);

                const character = gltf.scene;
                character.traverse((child) => {
                    if (child.isMesh) {
                        const src = child.material;
                        child.material = new THREE.MeshLambertMaterial({
                            map: src.map || null,
                            color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
                            side: src.side,
                            skinning: child.isSkinnedMesh === true
                        });
                    }
                });
                scene.add(character);

                // Frame the character: normalize to ~unit height, center, look from front-ish
                const box = new THREE.Box3().setFromObject(character);
                const sizeV = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());
                const targetHeight = 2.0;
                const s = sizeV.y > 0 ? targetHeight / sizeV.y : 1;
                character.scale.setScalar(s);
                character.position.sub(center.multiplyScalar(s));

                const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
                cam.position.set(0, 0.2, 4.5);
                cam.lookAt(0, 0, 0);

                renderer.render(scene, cam);
                const url = renderer.domElement.toDataURL('image/png');
                document.querySelectorAll(`.character-btn[data-character="${key}"] .character-preview`).forEach(el => {
                    el.innerHTML = '';
                    const img = document.createElement('img');
                    img.src = url;
                    img.alt = cfg.label;
                    el.appendChild(img);
                });

                // Free GPU resources for this preview
                character.traverse((child) => {
                    if (child.isMesh) {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material && child.material.map) child.material.map.dispose();
                        if (child.material) child.material.dispose();
                    }
                });
            }, undefined, (error) => {
                console.error('Preview load failed for', key, error);
            });
        };

        Object.entries(this.characters).forEach(([key, cfg]) => renderOne(key, cfg));
    }

    setPlayerCharacter(key) {
        if (!this.characters || !this.characters[key]) return;
        if (this.currentCharacterKey === key && this.player && this.player.model && this.player.mixer) return;
        this.currentCharacterKey = key;
        this.loadPlayerModel(this.characters[key].path);
        // Reflect active button state if modal is open
        document.querySelectorAll('.character-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.character === key);
        });
    }

    loadPlayerModel(filePath) {
        const loader = new THREE.GLTFLoader();
        loader.load(filePath, (gltf) => {
            const character = gltf.scene;
            // Convert PBR materials → Lambert (preserve textures) so it shades like the rest of the scene.
            // SkinnedMesh requires `skinning: true` on the material in r128 — without it the mesh renders in bind pose.
            character.traverse((child) => {
                if (child.isMesh) {
                    const src = child.material;
                    child.material = new THREE.MeshLambertMaterial({
                        map: src.map || null,
                        color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
                        side: src.side,
                        skinning: child.isSkinnedMesh === true
                    });
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            // Scale so the character is ~2.5 units tall (matches old lion archer footprint)
            const box = new THREE.Box3().setFromObject(character);
            const height = box.max.y - box.min.y;
            if (height > 0) {
                const targetHeight = 2.5;
                const s = targetHeight / height;
                character.scale.setScalar(s);
            }
            // Re-measure after scaling, drop so feet are at y=0
            const scaledBox = new THREE.Box3().setFromObject(character);
            character.position.y -= scaledBox.min.y;
            character.position.x = 0;
            character.position.z = 0;

            // Detach both 3rd-person weapon pivots so they can be re-attached to the new character's hand socket
            if (this.player.swordPivot && this.player.swordPivot.parent) this.player.swordPivot.parent.remove(this.player.swordPivot);
            if (this.player.gunPivot && this.player.gunPivot.parent) this.player.gunPivot.parent.remove(this.player.gunPivot);
            this.player.handSocket = null;
            if (this.player.model) this.scene.remove(this.player.model);

            // Wrap in a group at world origin so player.position/rotation drive the avatar like before
            const wrap = new THREE.Group();
            wrap.add(character);
            wrap.position.copy(this.player.position);

            // Soft round shadow disc — same as lion archer
            const shadowMat = new THREE.MeshBasicMaterial({
                color: 0x000000, transparent: true, opacity: 0.45,
                depthWrite: false, side: THREE.DoubleSide
            });
            const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), shadowMat);
            shadow.rotation.x = -Math.PI / 2;
            shadow.position.y = 0.02;
            shadow.renderOrder = -1;
            wrap.add(shadow);

            this.scene.add(wrap);
            this.player.model = wrap;
            this.player.bodyShadow = shadow;
            // Respect current view mode (hide in FPV) — critical for future character swaps
            this.applyViewModeToPlayerModel();
            // Clear limb refs — skeleton has its own bones; locomotion code no-ops when these are null
            this.player.head = null;
            this.player.body = null;
            this.player.leftArm = null;
            this.player.rightArm = null;
            this.player.leftLeg = null;
            this.player.rightLeg = null;

            // Find the right-hand bone on the new character and re-parent the active weapon there
            this.setupHandSocket();

            if (gltf.animations && gltf.animations.length > 0) {
                const mixer = new THREE.AnimationMixer(character);
                this.player.mixer = mixer;
                this.player.clips = {};
                gltf.animations.forEach((clip) => {
                    const action = mixer.clipAction(clip);
                    action.enabled = true;
                    action.setEffectiveWeight(0);
                    action.play();
                    this.player.clips[clip.name] = action;
                });
                // Start in Idle
                const idle = this.player.clips['Idle'];
                if (idle) idle.setEffectiveWeight(1);
                this.player.currentClipName = 'Idle';
            }
        }, undefined, (error) => {
            console.error('Error loading player character GLTF:', error);
        });
    }

    // Play a clip once, then let the locomotion state-machine in updateCharacterAnimation
    // resume control. While `_oneShotUntil` is in the future, setPlayerAnimation no-ops
    // so the one-shot isn't immediately replaced by Idle/Walk/Run.
    playOneShotAnimation(name, durationSeconds = 0.35, fadeDuration = 0.06) {
        if (!this.player || !this.player.clips) return;
        const next = this.player.clips[name];
        if (!next) return;
        const prev = this.player.clips[this.player.currentClipName];
        if (prev && prev !== next) prev.fadeOut(fadeDuration);
        next.reset();
        next.setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = false;
        next.fadeIn(fadeDuration).setEffectiveWeight(1).play();
        this.player.currentClipName = name;
        this._oneShotUntil = (performance.now() / 1000) + durationSeconds;
    }

    setPlayerAnimation(name, fadeDuration = 0.18) {
        // Don't interrupt a running one-shot
        if (this._oneShotUntil && performance.now() / 1000 < this._oneShotUntil) return;
        if (!this.player || !this.player.clips) return;
        if (this.player.currentClipName === name) return;
        const next = this.player.clips[name];
        if (!next) return;
        const prev = this.player.clips[this.player.currentClipName];
        if (prev && prev !== next) {
            prev.fadeOut(fadeDuration);
        }
        next.reset().fadeIn(fadeDuration).setEffectiveWeight(1).play();
        this.player.currentClipName = name;
    }

    createFacingIndicator() {
        // Small spotlight showing character forward direction
        const light = new THREE.SpotLight(0xffe066, 1.2, 10, 0.55, 0.5, 2);
        light.castShadow = false;
        const target = new THREE.Object3D();
        this.scene.add(target);
        light.target = target;
        this.scene.add(light);
        
        // Subtle ground dot (ring)
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
        const dot = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.38, 24), dotMat);
        dot.rotation.x = -Math.PI / 2;
        dot.visible = this.facingIndicator.enabled;
        this.scene.add(dot);
        
        this.facingIndicator.light = light;
        this.facingIndicator.lightTarget = target;
        this.facingIndicator.groundDot = dot;
    }

    createLionArcherModel() {
        // Colors inspired by the pixel reference
        const gold = 0xC68A2E;
        const darkGold = 0x8C5A1C;
        const cream = 0xF5E3B3;
        const blue = 0x2E6BC6;
        const black = 0x111111;

        const g = new THREE.Group();
        g.position.y = 0; // feet at y=0

        // Torso
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(1.3, 2.0, 0.9),
            new THREE.MeshLambertMaterial({ color: blue, emissive: 0x001020 })
        );
        body.position.y = 0.9;
        body.castShadow = true; body.receiveShadow = true;
        g.add(body);

        // Head
        const head = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 1.0, 1.0),
            new THREE.MeshLambertMaterial({ color: gold, emissive: 0x201000 })
        );
        head.position.set(0, 2.2, 0);
        head.castShadow = true;
        g.add(head);

        // Mane (ring of boxes)
        const maneMat = new THREE.MeshLambertMaterial({ color: darkGold, emissive: 0x120800 });
        const maneR = 0.9;
        for (let i = 0; i < 8; i++) {
            const seg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.3), maneMat);
            const a = (i / 8) * Math.PI * 2;
            seg.position.set(Math.cos(a) * maneR, 2.2, Math.sin(a) * maneR);
            seg.castShadow = true;
            g.add(seg);
        }

        // Muzzle
        const muzzle = new THREE.Mesh(
            new THREE.BoxGeometry(0.6, 0.4, 0.6),
            new THREE.MeshLambertMaterial({ color: cream, emissive: 0x221e10 })
        );
        muzzle.position.set(0, 2.0, 0.45);
        muzzle.castShadow = true;
        g.add(muzzle);

        // Arms (groups for animation)
        const armGeo = new THREE.BoxGeometry(0.35, 1.4, 0.35);
        const armMat = new THREE.MeshLambertMaterial({ color: gold, emissive: 0x201000 });

        const leftArm = new THREE.Group();
        const leftArmMesh = new THREE.Mesh(armGeo, armMat);
        leftArmMesh.castShadow = true;
        leftArm.add(leftArmMesh);
        leftArm.position.set(-0.95, 1.2, 0);
        g.add(leftArm);

        const rightArm = new THREE.Group();
        const rightArmMesh = new THREE.Mesh(armGeo, armMat);
        rightArmMesh.castShadow = true;
        rightArm.add(rightArmMesh);
        rightArm.position.set(0.95, 1.2, 0);
        g.add(rightArm);

        // Legs (groups for animation)
        const legGeo = new THREE.BoxGeometry(0.45, 1.6, 0.5);
        const legMat = new THREE.MeshLambertMaterial({ color: darkGold, emissive: 0x120800 });
        const leftLeg = new THREE.Group();
        const leftLegMesh = new THREE.Mesh(legGeo, legMat);
        leftLegMesh.castShadow = true;
        leftLeg.add(leftLegMesh);
        leftLeg.position.set(-0.4, 0.0, 0);
        g.add(leftLeg);

        const rightLeg = new THREE.Group();
        const rightLegMesh = new THREE.Mesh(legGeo, legMat);
        rightLegMesh.castShadow = true;
        rightLeg.add(rightLegMesh);
        rightLeg.position.set(0.4, 0.0, 0);
        g.add(rightLeg);

        // Bow (simple stylized)
        const bow = new THREE.Group();
        const bowArc = new THREE.Mesh(
            new THREE.TorusGeometry(0.9, 0.05, 8, 16, Math.PI * 0.9),
            new THREE.MeshLambertMaterial({ color: 0x8b5a2b, emissive: 0x120800 })
        );
        bowArc.rotation.z = Math.PI / 2;
        bowArc.scale.set(1, 1.2, 1);
        bow.add(bowArc);
        // String
        const strGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, -0.85, 0),
            new THREE.Vector3(0, 0.85, 0)
        ]);
        const strMat = new THREE.LineBasicMaterial({ color: 0x000000 });
        const bowString = new THREE.Line(strGeom, strMat);
        bow.add(bowString);
        bow.position.set(0, -0.2, 0.6);
        rightArm.add(bow);

        // Tail
        const tail = new THREE.Mesh(
            new THREE.CylinderGeometry(0.07, 0.1, 1.2, 6),
            new THREE.MeshLambertMaterial({ color: darkGold, emissive: 0x120800 })
        );
        tail.position.set(0, 0.5, -0.5);
        tail.rotation.x = -Math.PI / 6;
        tail.castShadow = true;
        g.add(tail);

        this.scene.add(g);
        this.player.model = g;
        this.player.body = body;
        this.player.head = head;
        this.player.leftArm = leftArm;
        this.player.rightArm = rightArm;
        this.player.leftLeg = leftLeg;
        this.player.rightLeg = rightLeg;

        // Soft round shadow under the avatar — keeps the player grounded
        // visually in every camera mode regardless of light setup.
        const shadowMat = new THREE.MeshBasicMaterial({
            color: 0x000000, transparent: true, opacity: 0.45,
            depthWrite: false, side: THREE.DoubleSide
        });
        const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.02;
        shadow.renderOrder = -1;
        g.add(shadow);
        this.player.bodyShadow = shadow;

        // Cache initial pivot rotations so locomotion animation has a baseline.
        this.player._armRestZ = { L: leftArm.rotation.z, R: rightArm.rotation.z };
        this.player._legRestX = { L: leftLeg.rotation.x, R: rightLeg.rotation.x };

        // Add weapon if it exists
        if (this.player.weaponModel) {
            this.player.model.add(this.player.weaponModel);
        }
    }
    
    createFallbackCharacter() {
        // Create a simple low-poly character using basic geometries
        const characterGroup = new THREE.Group();
        
        // Head — warm desert tan
        const headGeometry = new THREE.BoxGeometry(1, 1, 1);
        const headMaterial = new THREE.MeshLambertMaterial({
            color: 0xd9a76a,
            emissive: 0x2a1808
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 1.5;
        head.castShadow = true;
        characterGroup.add(head);
        
        
        // Body — khaki tunic
        const bodyGeometry = new THREE.BoxGeometry(1.2, 2, 0.8);
        const bodyMaterial = new THREE.MeshLambertMaterial({
            color: 0x8a6a3a,
            emissive: 0x1a0e04
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.5;
        body.castShadow = true;
        characterGroup.add(body);
        
        // Arms — sand tone
        const armGeometry = new THREE.BoxGeometry(0.3, 1.5, 0.3);
        const armMaterial = new THREE.MeshLambertMaterial({
            color: 0xd9a76a,
            emissive: 0x2a1808
        });
        
        const leftArm = new THREE.Mesh(armGeometry, armMaterial);
        leftArm.position.set(-0.8, 0.5, 0);
        leftArm.castShadow = true;
        characterGroup.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeometry, armMaterial);
        rightArm.position.set(0.8, 0.5, 0);
        rightArm.castShadow = true;
        characterGroup.add(rightArm);
        
        // Legs — darker khaki
        const legGeometry = new THREE.BoxGeometry(0.4, 1.5, 0.4);
        const legMaterial = new THREE.MeshLambertMaterial({
            color: 0x6a4e22,
            emissive: 0x1a0e04
        });
        
        const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
        leftLeg.position.set(-0.3, -1, 0);
        leftLeg.castShadow = true;
        characterGroup.add(leftLeg);
        
        const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
        rightLeg.position.set(0.3, -1, 0);
        rightLeg.castShadow = true;
        characterGroup.add(rightLeg);
        
        // Add to scene
        this.scene.add(characterGroup);
        this.player.model = characterGroup;
        
        // Store references for animation
        this.player.head = head;
        this.player.body = body;
        this.player.leftArm = leftArm;
        this.player.rightArm = rightArm;
        this.player.leftLeg = leftLeg;
        this.player.rightLeg = rightLeg;
        
        // Add weapon if it exists
        if (this.player.weaponModel) {
            this.player.model.add(this.player.weaponModel);
        }
    }
    
    
    loadCharacterModel(filePath) {
        const loader = new THREE.GLTFLoader();
        loader.load(filePath, (gltf) => {
            // Remove fallback character
            if (this.player.model) {
                this.scene.remove(this.player.model);
            }
            
            // Add new character model
            const character = gltf.scene;
            character.scale.set(1, 1, 1);
            character.position.copy(this.player.position);
            character.castShadow = true;
            character.receiveShadow = true;
            
            // Apply desert hero materials
            character.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshLambertMaterial({
                        color: 0xd9a76a,
                        emissive: 0x2a1808
                    });
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            
            
            this.scene.add(character);
            this.player.model = character;
            // Align model forward; adjust at runtime with Y/U/F keys if needed
            this.modelYawOffset = 0;
            
            // Add weapon if it exists
            if (this.player.weaponModel) {
                this.player.model.add(this.player.weaponModel);
            }
            
            // Set up animation mixer if animations exist
            if (gltf.animations && gltf.animations.length > 0) {
                this.player.mixer = new THREE.AnimationMixer(character);
                gltf.animations.forEach((clip) => {
                    this.player.mixer.clipAction(clip).play();
                });
            }
            
        }, undefined, (error) => {
            console.error('Error loading character model:', error);
        });
    }

    preloadZombieTemplate() {
        const loader = new THREE.GLTFLoader();
        loader.load('Zombie.gltf', (gltf) => {
            this.zombieTemplate = { scene: gltf.scene, animations: gltf.animations };
            console.log('Zombie template loaded:', gltf.animations.map(a => a.name).join(', '));
            // If enemies already spawned as sphere fallbacks, swap them for zombies
            if (this.playMode && this.playMode.enemies.length > 0) {
                this.respawnEnemies();
            }
        }, undefined, (error) => {
            console.error('Error loading Zombie.gltf:', error);
        });
    }

    createEnvironment() {
        // Create ground
        const groundGeometry = new THREE.PlaneGeometry(200, 200);
        const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x6b7280 });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        this.groundY = -1; // track ground height for indicators/effects
        ground.position.y = this.groundY;
        ground.receiveShadow = true;
        this.scene.add(ground);
        this.ground = ground;

        // Cheese tile dimensions — block_cheese.gltf is ~1.87 units, scale to 2 to align with maze grid (cellSize=2)
        this.cheeseTileSize = 2;
        this.cheeseFloorSize = 200;
        this.loadCheeseFloor();
        this.loadBrickWallTemplate();
        // Arena assets (platforms + decor)
        this.loadPixelBlockTemplates();
        this.loadArenaDecorTemplates();
        // Crystal "sky" — a tiled ceiling above the tallest walls
        this.roofTileSize = 2;
        this.roofSize = 200;
        this.roofY = 20; // bottom face of ceiling blocks
        this.loadCrystalRoof();

        // Create retro grid pattern
        this.createGrid();
        
        // Initialize saved mazes
        this.initializeSavedMazes();
        
        // Initialize create mode
        this.initializeCreateMode();
        
        // Preload zombie model used for all enemies
        this.preloadZombieTemplate();

        // Create labyrinth
        this.createLabyrinth();

        // Create skybox
        this.createSkybox();
    }
    
    createGrid() {
        const gridSize = 200;
        const gridDivisions = 50;
        const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0xffe8a0, 0xffe8a0);
        gridHelper.position.y = -0.9;
        gridHelper.material.opacity = 0.3;
        gridHelper.material.transparent = true;
        this.scene.add(gridHelper);
        this.gridHelper = gridHelper;
    }

    loadBrickWallTemplate() {
        const loader = new THREE.GLTFLoader();
        loader.load('assets/Blocks/pixel blocks/Bricks_Grey.gltf', (gltf) => {
            let sourceMesh = null;
            gltf.scene.traverse((child) => {
                if (!sourceMesh && child.isMesh) sourceMesh = child;
            });
            if (!sourceMesh) {
                console.warn('Bricks mesh not found in GLTF');
                return;
            }
            const geom = sourceMesh.geometry.clone();
            geom.computeBoundingBox();
            const srcMat = sourceMesh.material;
            const mat = new THREE.MeshLambertMaterial({
                map: srcMat.map || null,
                color: srcMat.color ? srcMat.color.clone() : new THREE.Color(0xffffff),
                side: srcMat.side
            });
            this.bricksTemplate = { geometry: geom, material: mat };
            // Refresh existing maze walls so they pick up the brick visual
            if (this.walls && this.walls.length) this.rebuildMaze();
        }, undefined, (error) => {
            console.error('Error loading Bricks_Grey.gltf:', error);
        });
    }

    // Load a curated set of pixel-block GLTFs once and cache them for arena platforms.
    loadPixelBlockTemplates() {
        if (this._pixelBlocks) return;
        this._pixelBlocks = {};
        const loader = new THREE.GLTFLoader();
        const list = [
            ['stone',    'assets/Blocks/pixel blocks/Stone.gltf'],
            ['wood',     'assets/Blocks/pixel blocks/WoodPlanks.gltf'],
            ['darkBrick','assets/Blocks/pixel blocks/Bricks_Dark.gltf'],
            ['dirt',     'assets/Blocks/pixel blocks/Dirt.gltf'],
        ];
        for (const [name, path] of list) {
            loader.load(path, (gltf) => {
                let src = null;
                gltf.scene.traverse(c => { if (!src && c.isMesh) src = c; });
                if (!src) return;
                const geom = src.geometry.clone();
                geom.computeBoundingBox();
                const srcMat = src.material;
                const mat = new THREE.MeshLambertMaterial({
                    map: srcMat.map || null,
                    color: srcMat.color ? srcMat.color.clone() : new THREE.Color(0xffffff),
                    side: srcMat.side
                });
                this._pixelBlocks[name] = { geometry: geom, material: mat };
            }, undefined, (err) => console.warn('Pixel block load failed:', path, err));
        }
    }

    // Load environment + animal templates used to dress the arena. Each is cached
    // as a THREE.Object3D template; arena code clones it on placement.
    loadArenaDecorTemplates() {
        if (this._decorTemplates) return;
        this._decorTemplates = {};
        const loader = new THREE.GLTFLoader();
        const list = [
            ['tree1',      'assets/Blocks/environment/Tree_1.gltf'],
            ['tree2',      'assets/Blocks/environment/Tree_2.gltf'],
            ['tree3',      'assets/Blocks/environment/Tree_3.gltf'],
            ['deadTree1',  'assets/Blocks/environment/DeadTree_1.gltf'],
            ['deadTree2',  'assets/Blocks/environment/DeadTree_2.gltf'],
            ['bush',       'assets/Blocks/environment/Bush.gltf'],
            ['rock1',      'assets/Blocks/environment/Rock1.gltf'],
            ['rock2',      'assets/Blocks/environment/Rock2.gltf'],
            ['flowers1',   'assets/Blocks/environment/Flowers_1.gltf'],
            ['flowers2',   'assets/Blocks/environment/Flowers_2.gltf'],
            ['grassBig',   'assets/Blocks/environment/Grass_Big.gltf'],
            ['mushroom',   'assets/Blocks/environment/Mushroom.gltf'],
            ['chest',      'assets/Blocks/environment/Chest_Closed.gltf'],
            ['crate',      'assets/Blocks/Block_Crate.gltf'],
            ['sheep',      'assets/Blocks/Animals/Sheep.gltf'],
            ['pig',        'assets/Blocks/Animals/Pig.gltf'],
            ['chicken',    'assets/Blocks/Animals/Chicken.gltf'],
            ['cat',        'assets/Blocks/Animals/Cat.gltf'],
        ];
        for (const [name, path] of list) {
            loader.load(path, (gltf) => {
                // Keep the whole scene so model preserves its node hierarchy and materials
                this._decorTemplates[name] = gltf.scene;
            }, undefined, (err) => console.warn('Decor load failed:', path, err));
        }
    }

    // Build a single arena platform as a stack of pixel-block tiles.
    // Returns { group, footprint, height } or null if templates not loaded.
    _buildBlockPlatform(footprintTiles, heightTiles, blockKey) {
        const tpl = this._pixelBlocks && this._pixelBlocks[blockKey];
        if (!tpl) return null;
        const bb = tpl.geometry.boundingBox;
        const native = bb.max.y - bb.min.y; // ~2 units
        const tile = 1.5;                    // world units per block
        const scale = tile / native;
        const group = new THREE.Group();
        const offset = (footprintTiles - 1) / 2;
        for (let yi = 0; yi < heightTiles; yi++) {
            for (let xi = 0; xi < footprintTiles; xi++) {
                for (let zi = 0; zi < footprintTiles; zi++) {
                    const m = new THREE.Mesh(tpl.geometry, tpl.material);
                    m.scale.setScalar(scale);
                    m.position.set(
                        (xi - offset) * tile,
                        yi * tile + tile / 2,
                        (zi - offset) * tile
                    );
                    m.castShadow = true;
                    m.receiveShadow = true;
                    group.add(m);
                }
            }
        }
        return { group, footprint: footprintTiles * tile, height: heightTiles * tile };
    }

    // Build a wall visual as a vertical stack of brick cubes, sized to fit the requested box dimensions.
    // Returns null if the brick template hasn't loaded yet; callers fall back to colored BoxGeometry.
    createBrickWallMesh(width, height, depth) {
        if (!this.bricksTemplate) return null;
        const group = new THREE.Group();
        const bb = this.bricksTemplate.geometry.boundingBox;
        const nativeSize = bb.max.y - bb.min.y; // brick cube is 2 units across
        const xScale = width / nativeSize;
        const zScale = depth / nativeSize;
        const tilesH = Math.max(1, Math.round(height / nativeSize));
        const yScale = (height / tilesH) / nativeSize;
        const tileWorldH = nativeSize * yScale; // = height / tilesH
        for (let i = 0; i < tilesH; i++) {
            const m = new THREE.Mesh(this.bricksTemplate.geometry, this.bricksTemplate.material);
            m.scale.set(xScale, yScale, zScale);
            m.position.y = -height / 2 + tileWorldH * (i + 0.5);
            m.castShadow = true;
            m.receiveShadow = true;
            group.add(m);
        }
        return group;
    }

    loadCrystalRoof() {
        const loader = new THREE.GLTFLoader();
        loader.load('assets/Blocks/Block_Crystal.gltf', (gltf) => {
            let sourceMesh = null;
            gltf.scene.traverse((child) => {
                if (!sourceMesh && child.isMesh) sourceMesh = child;
            });
            if (!sourceMesh) {
                console.warn('Crystal roof mesh not found in GLTF');
                return;
            }
            // Bake node transform into geometry so bounds match what we see
            sourceMesh.updateMatrixWorld(true);
            const geom = sourceMesh.geometry.clone();
            geom.applyMatrix4(sourceMesh.matrixWorld);
            geom.computeBoundingBox();
            const srcMat = sourceMesh.material;
            const mat = new THREE.MeshLambertMaterial({
                map: srcMat.map || null,
                color: srcMat.color ? srcMat.color.clone() : new THREE.Color(0xffffff),
                side: srcMat.side
            });
            this.roofSourceGeometry = geom;
            this.roofSourceMaterial = mat;
            const bb = geom.boundingBox;
            const blockWidth = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
            this.roofScale = this.roofTileSize / blockWidth;
            this.rebuildCrystalRoof(this.roofSize);
        }, undefined, (error) => {
            console.error('Error loading Block_Crystal.gltf:', error);
        });
    }

    rebuildCrystalRoof(size) {
        if (!this.roofSourceGeometry || !this.roofSourceMaterial) return;
        if (this.crystalRoof) this.scene.remove(this.crystalRoof);
        const tile = this.roofTileSize;
        const half = Math.ceil(size / 2 / tile) * tile;
        const count = Math.pow((half * 2) / tile + 1, 2);
        const mesh = new THREE.InstancedMesh(this.roofSourceGeometry, this.roofSourceMaterial, count);
        mesh.receiveShadow = true;
        const dummy = new THREE.Object3D();
        const scale = this.roofScale;
        const bb = this.roofSourceGeometry.boundingBox;
        // Bottom face of block in world = center.y + bb.min.y * scale → place center so bottom sits at roofY
        const blockCenterY = this.roofY - bb.min.y * scale;
        let i = 0;
        for (let x = -half; x <= half; x += tile) {
            for (let z = -half; z <= half; z += tile) {
                dummy.position.set(x, blockCenterY, z);
                dummy.scale.set(scale, scale, scale);
                dummy.rotation.y = 0;
                dummy.updateMatrix();
                mesh.setMatrixAt(i++, dummy.matrix);
            }
        }
        mesh.count = i;
        mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(mesh);
        this.crystalRoof = mesh;
    }

    loadCheeseFloor() {
        const loader = new THREE.GLTFLoader();
        loader.load('assets/Blocks/pixel blocks/Diamond.gltf', (gltf) => {
            let sourceMesh = null;
            gltf.scene.traverse((child) => {
                if (!sourceMesh && child.isMesh) sourceMesh = child;
            });
            if (!sourceMesh) {
                console.warn('Floor block mesh not found in GLTF');
                return;
            }
            this.cheeseSourceGeometry = sourceMesh.geometry.clone();
            // Convert PBR material to Lambert so cheese shades consistently with rest of scene
            const srcMat = sourceMesh.material;
            this.cheeseSourceMaterial = new THREE.MeshLambertMaterial({
                map: srcMat.map || null,
                color: srcMat.color ? srcMat.color.clone() : new THREE.Color(0xffffff),
                side: srcMat.side
            });
            // Compute scale so the block matches cheeseTileSize on its widest axis
            this.cheeseSourceGeometry.computeBoundingBox();
            const bb = this.cheeseSourceGeometry.boundingBox;
            const blockWidth = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
            this.cheeseScale = this.cheeseTileSize / blockWidth;
            this.rebuildCheeseFloor(this.cheeseFloorSize);
        }, undefined, (error) => {
            console.error('Error loading floor block GLTF:', error);
        });
    }

    rebuildCheeseFloor(size) {
        if (!this.cheeseSourceGeometry || !this.cheeseSourceMaterial) return;
        if (this.cheeseFloor) {
            this.scene.remove(this.cheeseFloor);
        }
        const tile = this.cheeseTileSize;
        const half = Math.ceil(size / 2 / tile) * tile;
        const count = Math.pow((half * 2) / tile + 1, 2);
        const geom = this.cheeseSourceGeometry;
        const mat = this.cheeseSourceMaterial;
        const mesh = new THREE.InstancedMesh(geom, mat, count);
        mesh.receiveShadow = true;
        const dummy = new THREE.Object3D();
        const scale = this.cheeseScale;
        // Player feet sit at y=0 (see movement clamp), so cheese top must be at 0 — not at groundY (-1)
        // World top of block = center.y + bb.max.y * scale → set center.y so top sits at 0
        const bb = geom.boundingBox;
        const floorTopY = 0;
        const blockCenterY = floorTopY - bb.max.y * scale;
        let i = 0;
        for (let x = -half; x <= half; x += tile) {
            for (let z = -half; z <= half; z += tile) {
                dummy.position.set(x, blockCenterY, z);
                dummy.scale.set(scale, scale, scale);
                dummy.rotation.y = 0;
                dummy.updateMatrix();
                mesh.setMatrixAt(i++, dummy.matrix);
            }
        }
        mesh.count = i;
        mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(mesh);
        this.cheeseFloor = mesh;
        // Hide the fallback plane now that cheese tiles cover it (keep underneath as safety)
        if (this.ground) this.ground.visible = false;
    }

    updateGroundAndFog(width, height) {
        const size = Math.max(width, height) + 20; // margin
        this.cheeseFloorSize = size;
        this.roofSize = size;
        this.rebuildCheeseFloor(size);
        this.rebuildCrystalRoof(size);
        // Update ground plane to cover maze
        if (this.ground) {
            if (this.ground.geometry) this.ground.geometry.dispose();
            this.ground.geometry = new THREE.PlaneGeometry(size, size);
            this.ground.needsUpdate = true;
        }
        // Update grid helper
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
            const divisions = Math.max(10, Math.floor(size / 4));
            const grid = new THREE.GridHelper(size, divisions, 0xffe8a0, 0xffe8a0);
            grid.position.y = -0.9;
            grid.material.opacity = 0.25;
            grid.material.transparent = true;
            this.scene.add(grid);
            this.gridHelper = grid;
        }
        // Soften fog so far geometry is visible
        if (this.scene && this.scene.fog) {
            this.scene.fog.near = 50;
            this.scene.fog.far = Math.max(300, size * 1.2);
        }
    }
    
    initializeSavedMazes() {
        // Pre-defined maze layouts
        this.savedMazes = [
            {
                name: this.t('wideHalls'),
                size: 100,
                type: "generated",
                description: this.t('wideHallsDesc')
            },
            {
                name: this.t('classicSmall'),
                size: 15,
                type: "static",
                layout: [
                    "###############",
                    "#.............#",
                    "#.##.......##.#",
                    "#.#.........#.#",
                    "#.#.#######.#.#",
                    "#.#.........#.#",
                    "#.##.......##.#",
                    "#.#.........#.#",
                    "#.#.#######.#.#",
                    "#.#.........#.#",
                    "#.##.......##.#",
                    "#.#.........#.#",
                    "#.#.#######.#.#",
                    "#.............#",
                    "###############"
                ],
                description: this.t('classicSmallDesc')
            },
            {
                name: this.t('openArena'),
                size: 20,
                type: "static",
                layout: [
                    "####################",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "#..................#",
                    "####################"
                ],
                description: this.t('openArenaDesc')
            },
            {
                name: this.t('spiral'),
                size: 25,
                type: "static",
                layout: this.generateSpiralMaze(25),
                description: this.t('spiralDesc')
            },
            {
                name: this.t('labyrinth'),
                size: 61,
                type: "static",
                layout: [
                    "#############################################################",
                    "#############################################################",
                    "#############################################################",
                    "##......................................##.......##........##",
                    "##..######.########.##################..###..######.......###",
                    "##..##################################..###.#######.##.##..##",
                    "##..###..######....###.#..#####.....#....##.###.#...#####.###",
                    "##..##.......##..........................##.##......#####.###",
                    "##..#..####..##..##########################.###.....###....##",
                    "##..#..#####.##..##########################..###.##.##.....##",
                    "##..##....##.##..................................#####..#####",
                    "##..##....##.##..................................#####.######",
                    "##..####..##.#########################..###########....##.###",
                    "##..####..##..########################..###########....##..##",
                    "#...##....##....##........##.....................##.#####..##",
                    "#...##...###....##........#.........##...........##..####..##",
                    "#...##...###....##........#.........##...........##..####..##",
                    "##..####..##..########################..###########....##..##",
                    "##..####..##.#########################..###########....##.###",
                    "##..##....##.##..................................#####.######",
                    "##..##....##.##..................................#####..#####",
                    "##..#..#####.##..##########################..###.##.##.....##",
                    "##..#..####..##..##########################.###.....###....##",
                    "##..##.......##..........................##.##......#####.###",
                    "##..###..######....###.#..#####.....#....##.###.#...#####.###",
                    "##..##################################..###.#######.##.##..##",
                    "##..######.########.##################..###..######.......###",
                    "##......................................##.......##........##",
                    "#############################################################",
                    "#############################################################",
                    "#############################################################"
                ],
                description: this.t('labyrinthDesc')
            },
            {
                name: this.t('asciiMaze'),
                size: 41,
                type: "ascii",
                description: this.t('asciiMazeDesc')
            }
        ];
    }
    
    generateSpiralMaze(size) {
        const maze = [];
        for (let y = 0; y < size; y++) {
            maze[y] = [];
            for (let x = 0; x < size; x++) {
                maze[y][x] = '#';
            }
        }
        
        // Create spiral pattern
        let x = 1, y = 1;
        let dx = 1, dy = 0;
        let steps = 1;
        
        while (x < size-1 && y < size-1) {
            for (let i = 0; i < steps; i++) {
                if (x >= 0 && x < size && y >= 0 && y < size) {
                    maze[y][x] = '.';
                }
                x += dx;
                y += dy;
            }
            
            // Turn right
            [dx, dy] = [-dy, dx];
            if (dx === 0) steps++;
        }
        
        return maze;
    }
    
    initializeCreateMode() {
        // Initialize empty custom maze
        this.createMode.customMaze = [];
        for (let y = 0; y < this.createMode.gridSize; y++) {
            this.createMode.customMaze[y] = [];
            for (let x = 0; x < this.createMode.gridSize; x++) {
                this.createMode.customMaze[y][x] = '.'; // Empty space
            }
        }
        
        // Create grid highlighting system
        this.createGridHighlights();
    }
    
    createGridHighlights() {
        // Clear existing highlights
        this.createMode.highlightObjects.forEach(obj => {
            this.scene.remove(obj);
        });
        this.createMode.highlightObjects = [];
        
        if (this.gameMode !== 'create') return;
        
        // Create-mode placement highlight (sand-yellow)
        const highlightMaterial = new THREE.MeshBasicMaterial({
            color: 0xffe8a0,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide
        });
        
        // Create grid highlights
        const gridSize = this.createMode.gridSize;
        const cellSize = 2;
        const startX = -gridSize;
        const startZ = -gridSize;
        
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                const highlight = new THREE.Mesh(
                    new THREE.PlaneGeometry(cellSize * 0.95, cellSize * 0.95),
                    highlightMaterial
                );
                highlight.position.set(
                    startX + x * cellSize,
                    0.01,
                    startZ + y * cellSize
                );
                highlight.rotation.x = -Math.PI / 2;
                highlight.visible = true; // Make highlights visible
                highlight.userData = { gridX: x, gridZ: y }; // Store grid coordinates
                this.scene.add(highlight);
                this.createMode.highlightObjects.push(highlight);
            }
        }
    }
    
    setGameMode(mode) {
        // Open World: hub-and-spoke themed worlds linked by portals.
        if (mode === 'openworld') {
            this.enterOpenWorld();
            return;
        }
        // Leaving open world: tear it down before switching to anything else.
        if (this.openWorld && this.openWorld.active) {
            this.exitOpenWorld();
        }
        // Arena is a special play sub-mode: it tears down the maze and runs the wave loop
        if (mode === 'arena') {
            this.startArenaMode();
            return;
        }
        // Leaving arena (if active) — teardown lava/volcano/pillars before switching
        if (this.arena && this.arena.active) {
            this.arena.active = false;
            this.arena.phase = 'idle';
            this._clearArenaObjects();
            if (this.clearEnemies) this.clearEnemies();
        }
        this.gameMode = mode;

        if (mode === 'create') {
            // Clear maze walls and markers
            this.clearMaze();
            // Fresh empty grid and highlights
            this.initializeCreateMode();
            // Initialize preview system
            this.updateToolPreview();
            // Ensure cursor is visible in create mode
            document.body.style.cursor = 'crosshair';
            // Exit pointer lock if active
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
            // Spawn on perimeter facing inward
            const spawn = this.getCreateModePerimeterSpawn();
            this.player.position.set(spawn.x, 1, spawn.z);
            this.characterRotation = spawn.facingY;
        } else {
            // Clear highlights and preview
            this.createMode.highlightObjects.forEach(obj => {
                this.scene.remove(obj);
            });
            this.createMode.highlightObjects = [];
            if (this.createMode.previewObject) {
                this.scene.remove(this.createMode.previewObject);
                this.createMode.previewObject = null;
            }
            // Restore normal cursor behavior
            document.body.style.cursor = 'default';
            // Rebuild current maze
            this.createLabyrinth();
            // Setup play mode camera/controls and enemies
            this.setupPlayMode();
        }

    }

    enterOpenWorld() {
        if (!this.openWorld) {
            console.warn('OpenWorldSystem unavailable');
            return;
        }
        if (this.openWorld.active) return;
        // Tear down maze + enemies + arena so the open world has a clean stage.
        if (this.arena && this.arena.active) {
            this.arena.active = false;
            this.arena.phase = 'idle';
            if (this._clearArenaObjects) this._clearArenaObjects();
        }
        if (this.clearEnemies) this.clearEnemies();
        if (this.clearMaze) this.clearMaze();
        // Stay in 'play' mode so existing WASD + gravity + collision branches run.
        this.gameMode = 'play';
        document.body.style.cursor = 'default';
        if (document.pointerLockElement) document.exitPointerLock();
        // Isometric reads much better for open-world exploration than fpv (cursor
        // stays visible, no pointer-lock dance required).
        if (this.setViewMode) this.setViewMode('iso');
        this.openWorld.enter().catch((err) => console.error('[openworld] enter failed', err));
    }

    exitOpenWorld() {
        if (!this.openWorld || !this.openWorld.active) return;
        this.openWorld.exit();
        // Re-create the maze world the player came from so play mode is intact.
        if (this.createLabyrinth) this.createLabyrinth();
        if (this.setupPlayMode) this.setupPlayMode();
    }

    clearMaze() {
        // Remove all walls from scene
        this.walls.forEach(wall => {
            const mesh = wall.mesh ? wall.mesh : wall;
            this.scene.remove(mesh);
        });
        this.walls = [];

        // Remove labyrinth markers if any
        if (this.labyrinthMarkers && this.labyrinthMarkers.length) {
            this.labyrinthMarkers.forEach(m => this.scene.remove(m));
            this.labyrinthMarkers = [];
        }

        // No props cleanup needed

        // Clear pickups
        if (this.pickups && this.pickups.length) {
            this.pickups.forEach(p => this.pickupsGroup.remove(p));
            this.pickups = [];
        }
    }
    
    
    setupToolboxListeners() {
        // Toolbox modal close
        const closeToolbox = document.querySelector('.close-toolbox');
        if (closeToolbox) {
            closeToolbox.addEventListener('click', () => {
                this.toggleToolboxModal();
            });
        }
        
        // Close modal when clicking outside
        const toolboxModal = document.getElementById('toolbox-modal');
        if (toolboxModal) {
            toolboxModal.addEventListener('click', (e) => {
                if (e.target === toolboxModal) {
                    this.toggleToolboxModal();
                }
            });
        }
        
        // Tool selection
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                this.setCreateTool(tool);
                // Close modal immediately after tool selection
                this.toggleToolboxModal();
            });
        });
    }
    
    toggleToolboxModal() {
        const modal = document.getElementById('toolbox-modal');
        if (modal.style.display === 'block') {
            modal.style.display = 'none';
            this.modalOpen = false;
            document.body.classList.remove('modal-open');
            // Restore create mode cursor
            if (this.gameMode === 'create') {
                document.body.style.cursor = 'crosshair';
            }
        } else {
            // Close any other open modals first
            this.closeAllModals();
            
            modal.style.display = 'block';
            this.modalOpen = true;
            document.body.classList.add('modal-open');
            // Ensure cursor is immediately active
            document.body.style.cursor = 'default';
            this.updateToolboxContent();
        }
    }
    
    setCreateTool(tool) {
        this.createMode.tool = tool;
        
        // Update tool buttons
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.tool === tool) {
                btn.classList.add('active');
            }
        });
        
        // Update instructions
        const instructions = document.getElementById('tool-instructions');
        if (instructions) {
            switch(tool) {
                case 'wall':
                    instructions.textContent = 'Click on highlighted grid squares to place walls (Q key shortcut)';
                    break;
                case 'erase':
                    instructions.textContent = 'Click on walls to erase them (E key shortcut)';
                    break;
                case 'start':
                    instructions.textContent = 'Click on a grid square to set start point';
                    break;
                case 'end':
                    instructions.textContent = 'Click on a grid square to set end point';
                    break;
            }
        }
        
        // Update preview object
        this.updateToolPreview();
    }
    
    updateToolPreview() {
        // Remove existing preview
        if (this.createMode.previewObject) {
            this.scene.remove(this.createMode.previewObject);
            this.createMode.previewObject = null;
        }
        
        if (this.gameMode !== 'create') return;
        
        // Create preview object based on tool
        let previewGeometry, previewMaterial;
        
        switch(this.createMode.tool) {
            case 'wall':
                previewGeometry = new THREE.BoxGeometry(2, 4, 2);
                previewMaterial = new THREE.MeshBasicMaterial({
                    color: 0xffb347,
                    transparent: true,
                    opacity: 0.5,
                    wireframe: true
                });
                break;
            case 'erase':
                previewGeometry = new THREE.BoxGeometry(2, 4, 2);
                previewMaterial = new THREE.MeshBasicMaterial({
                    color: 0xff0000,
                    transparent: true,
                    opacity: 0.5,
                    wireframe: true
                });
                break;
            case 'start':
                previewGeometry = new THREE.ConeGeometry(0.5, 2, 8);
                previewMaterial = new THREE.MeshBasicMaterial({
                    color: 0xffb347,
                    transparent: true,
                    opacity: 0.5
                });
                break;
            case 'end':
                previewGeometry = new THREE.ConeGeometry(0.5, 2, 8);
                previewMaterial = new THREE.MeshBasicMaterial({
                    color: 0xff0000,
                    transparent: true,
                    opacity: 0.5
                });
                break;
            default:
                return;
        }
        
        this.createMode.previewObject = new THREE.Mesh(previewGeometry, previewMaterial);
        this.createMode.previewObject.visible = false; // Hidden by default
        this.scene.add(this.createMode.previewObject);
    }
    
    updateToolboxContent() {
        // Update tool buttons
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.tool === this.createMode.tool) {
                btn.classList.add('active');
            }
        });
    }
    
    getGridPositionFromWorld(worldX, worldZ) {
        const gridSize = this.createMode.gridSize;
        const cellSize = 2;
        const startX = -gridSize;
        const startZ = -gridSize;
        
        const gridX = Math.floor((worldX - startX) / cellSize);
        const gridZ = Math.floor((worldZ - startZ) / cellSize);
        
        return { x: gridX, z: gridZ };
    }
    
    getWorldPositionFromGrid(gridX, gridZ) {
        const gridSize = this.createMode.gridSize;
        const cellSize = 2;
        const startX = -gridSize;
        const startZ = -gridSize;
        
        const worldX = startX + gridX * cellSize;
        const worldZ = startZ + gridZ * cellSize;
        
        return { x: worldX, z: worldZ };
    }
    
    handleCreateModeHover() {
        if (this.gameMode !== 'create' || !this.createMode.previewObject) return;
        
        // Create raycaster from camera
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        
        // Get mouse position in normalized device coordinates
        const canvas = document.getElementById('gameCanvas');
        const rect = canvas.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        mouse.x = x;
        mouse.y = y;
        
        raycaster.setFromCamera(mouse, this.camera);
        
        // Intersect with highlight objects to get exact grid position
        const intersects = raycaster.intersectObjects(this.createMode.highlightObjects);
        
        if (intersects.length > 0) {
            const highlight = intersects[0].object;
            const { gridX, gridZ } = highlight.userData;
            
            // Check bounds
            if (gridX >= 0 && gridX < this.createMode.gridSize && gridZ >= 0 && gridZ < this.createMode.gridSize) {
                // Show preview at this position (with tool-specific visibility rules)
                const worldPos = this.getWorldPositionFromGrid(gridX, gridZ);
                this.createMode.previewObject.position.set(worldPos.x, 2, worldPos.z);
                if (this.createMode.tool === 'erase') {
                    // Only show red erase preview if there's an existing wall
                    const hasWall = this.createMode.customMaze[gridZ][gridX] === '#';
                    this.createMode.previewObject.visible = hasWall;
                } else {
                    this.createMode.previewObject.visible = true;
                }
                
                // Handle continuous placement if mouse is down
                if (this.createMode.isMouseDown) {
                    const currentGridPos = { x: gridX, z: gridZ };
                    const lastPos = this.createMode.lastGridPos;
                    
                    if (this.createMode.isShiftHeld) {
                        // Straight line mode
                        if (!this.createMode.startLinePos) {
                            // First click - set start position
                            this.createMode.startLinePos = currentGridPos;
                            this.handleContinuousPlacement(gridX, gridZ);
                        } else {
                            // Draw straight line from start to current position
                            this.drawStraightLine(this.createMode.startLinePos, currentGridPos);
                        }
                    } else {
                        // Normal continuous placement
                        if (!lastPos || lastPos.x !== currentGridPos.x || lastPos.z !== currentGridPos.z) {
                            this.createMode.lastGridPos = currentGridPos;
                            this.handleContinuousPlacement(gridX, gridZ);
                        }
                    }
                }
            } else {
                this.createMode.previewObject.visible = false;
            }
        } else {
            this.createMode.previewObject.visible = false;
        }
    }
    
    handleContinuousPlacement(gridX, gridZ) {
        // Only allow continuous placement for wall and erase tools
        if (this.createMode.tool === 'wall' || this.createMode.tool === 'erase') {
            switch(this.createMode.tool) {
                case 'wall':
                    this.placeWall(gridX, gridZ);
                    break;
                case 'erase':
                    this.eraseWall(gridX, gridZ);
                    break;
            }
        }
    }
    
    drawStraightLine(startPos, endPos) {
        // Calculate line points using Bresenham's line algorithm
        const points = this.getLinePoints(startPos.x, startPos.z, endPos.x, endPos.z);
        
        // Place/erase at each point
        points.forEach(point => {
            if (point.x >= 0 && point.x < this.createMode.gridSize && 
                point.z >= 0 && point.z < this.createMode.gridSize) {
                switch(this.createMode.tool) {
                    case 'wall':
                        this.placeWall(point.x, point.z);
                        break;
                    case 'erase':
                        this.eraseWall(point.x, point.z);
                        break;
                }
            }
        });
    }
    
    getLinePoints(x0, z0, x1, z1) {
        const points = [];
        const dx = Math.abs(x1 - x0);
        const dz = Math.abs(z1 - z0);
        const sx = x0 < x1 ? 1 : -1;
        const sz = z0 < z1 ? 1 : -1;
        let err = dx - dz;
        
        let x = x0;
        let z = z0;
        
        while (true) {
            points.push({ x: x, z: z });
            
            if (x === x1 && z === z1) break;
            
            const e2 = 2 * err;
            if (e2 > -dz) {
                err -= dz;
                x += sx;
            }
            if (e2 < dx) {
                err += dx;
                z += sz;
            }
        }
        
        return points;
    }
    
    handleCreateModeClick() {
        if (this.gameMode !== 'create') return;
        
        // Create raycaster from camera
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        
        // Get mouse position in normalized device coordinates
        const canvas = document.getElementById('gameCanvas');
        const rect = canvas.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        mouse.x = x;
        mouse.y = y;
        
        raycaster.setFromCamera(mouse, this.camera);
        
        // Intersect with highlight objects to get exact grid position
        const intersects = raycaster.intersectObjects(this.createMode.highlightObjects);
        
        if (intersects.length > 0) {
            const highlight = intersects[0].object;
            const { gridX, gridZ } = highlight.userData;
            
            // Check bounds
            if (gridX >= 0 && gridX < this.createMode.gridSize && gridZ >= 0 && gridZ < this.createMode.gridSize) {
                if (this.createMode.isShiftHeld) {
                    // Straight line mode
                    if (!this.createMode.startLinePos) {
                        // First click - set start position
                        this.createMode.startLinePos = { x: gridX, z: gridZ };
                        this.handleContinuousPlacement(gridX, gridZ);
                    }
                    // Line drawing is handled in hover function
                } else {
                    // Normal mode
                    this.createMode.lastGridPos = { x: gridX, z: gridZ };
                    
                    switch(this.createMode.tool) {
                        case 'wall':
                            this.placeWall(gridX, gridZ);
                            break;
                        case 'erase':
                            this.eraseWall(gridX, gridZ);
                            break;
                        case 'start':
                            this.placeStartPoint(gridX, gridZ);
                            break;
                        case 'end':
                            this.placeEndPoint(gridX, gridZ);
                            break;
                    }
                }
            }
        }
    }
    
    placeWall(gridX, gridZ) {
        if (this.createMode.customMaze[gridZ][gridX] === '#') return; // Already a wall
        
        this.createMode.customMaze[gridZ][gridX] = '#';
        this.createWallAtGrid(gridX, gridZ);
    }
    
    eraseWall(gridX, gridZ) {
        if (this.createMode.customMaze[gridZ][gridX] === '.') return; // Already empty
        
        this.createMode.customMaze[gridZ][gridX] = '.';
        this.removeWallAtGrid(gridX, gridZ);
    }
    
    placeStartPoint(gridX, gridZ) {
        // Remove existing start point
        for (let y = 0; y < this.createMode.gridSize; y++) {
            for (let x = 0; x < this.createMode.gridSize; x++) {
                if (this.createMode.customMaze[y][x] === 'S') {
                    this.createMode.customMaze[y][x] = '.';
                }
            }
        }
        
        this.createMode.customMaze[gridZ][gridX] = 'S';
        this.player.position.set(
            this.getWorldPositionFromGrid(gridX, gridZ).x,
            1,
            this.getWorldPositionFromGrid(gridX, gridZ).z
        );
    }
    
    placeEndPoint(gridX, gridZ) {
        // Remove existing end point
        for (let y = 0; y < this.createMode.gridSize; y++) {
            for (let x = 0; x < this.createMode.gridSize; x++) {
                if (this.createMode.customMaze[y][x] === 'E') {
                    this.createMode.customMaze[y][x] = '.';
                }
            }
        }
        
        this.createMode.customMaze[gridZ][gridX] = 'E';
    }
    
    createWallAtGrid(gridX, gridZ) {
        const worldPos = this.getWorldPositionFromGrid(gridX, gridZ);
        const t = this.themes.desert;
        const wallMaterial = (this.materials && this.materials.wall) || new THREE.MeshLambertMaterial({
            color: t.wall,
            emissive: t.wallEmissive,
            transparent: true,
            opacity: 0.95
        });
        
        const wall = this.createBrickWallMesh(2, 4, 2) || new THREE.Mesh(
            new THREE.BoxGeometry(2, 4, 2),
            wallMaterial
        );
        wall.position.set(worldPos.x, 2, worldPos.z);
        this.scene.add(wall);
        this.walls.push({
            mesh: wall,
            position: wall.position,
            size: { x: 2, y: 4, z: 2 }
        });
    }
    
    removeWallAtGrid(gridX, gridZ) {
        const worldPos = this.getWorldPositionFromGrid(gridX, gridZ);
        
        // Find and remove wall at this position
        for (let i = this.walls.length - 1; i >= 0; i--) {
            const w = this.walls[i];
            const mesh = w.mesh ? w.mesh : w;
            const pos = w.position ? w.position : mesh.position;
            if (Math.abs(pos.x - worldPos.x) < 1 && 
                Math.abs(pos.z - worldPos.z) < 1) {
                this.scene.remove(mesh);
                this.walls.splice(i, 1);
                break;
            }
        }
    }
    
    switchMaze(index) {
        if (index >= 0 && index < this.savedMazes.length) {
            // Leaving arena cleanly if it was running
            if (this.arena && this.arena.active) {
                this.arena.active = false;
                this.arena.phase = 'idle';
                this._clearArenaObjects();
                if (this.clearEnemies) this.clearEnemies();
            }
            this.currentMazeIndex = index;
            this.rebuildMaze();
            if (this.gameMode === 'play') {
                this.respawnEnemies();
            }
        }
    }
    
    rebuildMaze() {
        this.clearPlacedFlags();
        // Remove existing walls
        this.walls.forEach(wall => {
            this.scene.remove(wall.mesh);
        });
        this.walls = [];
        
        // Create new maze
        this.createLabyrinth();
        // If this is the labyrinth map and start is known, spawn player there
        const cur = this.savedMazes[this.currentMazeIndex];
        if (cur && (cur.type === 'labyrinth' || cur.name === 'Labyrinth' || cur.type === 'ascii') && this.levelStartWorld) {
            this.player.position.set(this.levelStartWorld.x, 0, this.levelStartWorld.z);
            // Face toward the maze interior (toward end)
            if (this.levelEndWorld) {
                const dx = this.levelEndWorld.x - this.levelStartWorld.x;
                const dz = this.levelEndWorld.z - this.levelStartWorld.z;
                this.characterRotation = Math.atan2(dx, dz);
            }
        }
    }
    
    
    closeAllModals() {
        // Close settings modal
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
            settingsModal.style.display = 'none';
        }
        
        // Close toolbox modal
        const toolboxModal = document.getElementById('toolbox-modal');
        if (toolboxModal) {
            toolboxModal.style.display = 'none';
        }
        
        this.modalOpen = false;
        document.body.classList.remove('modal-open');
        
        // Restore appropriate cursor based on game mode
        if (this.gameMode === 'create') {
            document.body.style.cursor = 'crosshair';
        } else {
            document.body.style.cursor = 'default';
        }
    }
    
    toggleSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (modal.style.display === 'block') {
            modal.style.display = 'none';
            this.modalOpen = false;
            // Remove cursor class and re-enable pointer lock
            document.body.classList.remove('modal-open');
            // In play mode, re-acquire pointer lock for continuous mouse aim (desktop only).
            if (this.gameMode === 'play' && !this.isPointerLocked && !this.isTouchDevice) {
                setTimeout(() => document.body.requestPointerLock(), 50);
            }
        } else {
            // Close any other open modals first
            this.closeAllModals();
            
            modal.style.display = 'block';
            this.modalOpen = true;
            // Add cursor class and exit pointer lock
            document.body.classList.add('modal-open');
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
            this.updateModalContent();
        }
    }
    
    updateModalContent() {
        // Update view buttons
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.view === this.viewMode) {
                btn.classList.add('active');
            }
        });
        
        // Update maze buttons
        document.querySelectorAll('.maze-btn').forEach(btn => {
            btn.classList.remove('active');
            if (parseInt(btn.dataset.maze) === this.currentMazeIndex) {
                btn.classList.add('active');
            }
        });
        
        // Update maze description
        const mazeDesc = document.getElementById('maze-desc');
        if (mazeDesc) {
            mazeDesc.textContent = this.savedMazes[this.currentMazeIndex].description;
        }
        // Reflect difficulty slider
        const diff = document.getElementById('maze-difficulty');
        const diffVal = document.getElementById('maze-difficulty-value');
        if (diff) diff.value = this.mazeDifficulty;
        if (diffVal) diffVal.textContent = String(this.mazeDifficulty);
        
        // Update language buttons
        document.querySelectorAll('.language-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.language === this.language) {
                btn.classList.add('active');
            }
        });

        // Update character buttons
        document.querySelectorAll('.character-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.character === this.currentCharacterKey);
        });
        
        // Update modal text elements
        this.updateModalText();
        
        // Update game info - removed old UI elements
    }
    
    updateModalText() {
        // Update modal headers and labels
        const settingsTitle = document.getElementById('settings-title');
        if (settingsTitle) settingsTitle.textContent = this.t('settings');
        
        
        const mazeSelectionTitle = document.getElementById('maze-selection-title');
        if (mazeSelectionTitle) mazeSelectionTitle.textContent = this.t('mazeSelection');
        
        const difficultyTitle = document.getElementById('difficulty-title');
        if (difficultyTitle) difficultyTitle.textContent = this.t('difficulty');
        
        const viewTitle = document.getElementById('view-title');
        if (viewTitle) viewTitle.textContent = this.t('view') || 'View';
        
        const languageTitle = document.getElementById('language-title');
        if (languageTitle) languageTitle.textContent = this.t('language');
        
        const gameModeTitle = document.getElementById('game-mode-title');
        if (gameModeTitle) gameModeTitle.textContent = this.t('gameMode');
        
        const gameInfoTitle = document.getElementById('game-info-title');
        if (gameInfoTitle) gameInfoTitle.textContent = this.t('gameInfo');
        
        
        // Update view button labels
        document.querySelectorAll('.view-btn').forEach(btn => {
            const view = btn.dataset.view;
            if (view === 'iso') btn.textContent = 'Isometrisk';
            if (view === 'fpv') btn.textContent = 'Første Person';
        });
        
        // Update mode button labels
        document.querySelectorAll('.mode-btn').forEach(btn => {
            const mode = btn.dataset.mode;
            if (mode === 'play') btn.textContent = this.t('playMode');
            if (mode === 'create') btn.textContent = this.t('createMode');
            if (mode === 'arena') btn.textContent = 'Arena Mode';
        });
    }
    
    
    setupModalListeners() {
        // Close modal when clicking X
        const closeBtn = document.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.toggleSettingsModal();
            });
        }
        
        // Close modal when clicking outside
        const modal = document.getElementById('settings-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.toggleSettingsModal();
                }
            });
        }
        
        // Close modal with Escape key
        document.addEventListener('keydown', (event) => {
            if (event.code === 'Escape' && this.modalOpen) {
                this.toggleSettingsModal();
            }
        });
        

        // View mode buttons
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                this.setViewMode(view);
                this.toggleSettingsModal();
            });
        });
        
        // Language buttons
        document.querySelectorAll('.language-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const language = btn.dataset.language;
                this.setLanguage(language);
                this.toggleSettingsModal();
            });
        });
        
        // Maze selection buttons
        document.querySelectorAll('.maze-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mazeIndex = parseInt(btn.dataset.maze);
                this.switchMaze(mazeIndex);
                this.toggleSettingsModal(); // Close modal immediately
            });
        });

        // Difficulty slider wiring
        const diff = document.getElementById('maze-difficulty');
        const diffVal = document.getElementById('maze-difficulty-value');
        if (diff) {
            diff.value = this.mazeDifficulty;
            if (diffVal) diffVal.textContent = String(this.mazeDifficulty);
            diff.addEventListener('input', () => {
                this.mazeDifficulty = parseInt(diff.value) || 5;
                if (diffVal) diffVal.textContent = diff.value;
            });
            diff.addEventListener('change', () => {
                const current = this.savedMazes[this.currentMazeIndex];
                if (current && current.type === 'ascii') {
                    this.rebuildMaze();
                    this.toggleSettingsModal();
                }
            });
        }

        // Audio settings wiring
        const aEnabled = document.getElementById('audio-enabled');
        const aVol = document.getElementById('audio-volume');
        const aVolVal = document.getElementById('audio-volume-value');
        if (aEnabled && this.audio) {
            aEnabled.checked = this.audio.enabled;
            aEnabled.addEventListener('change', () => {
                this.audio.setEnabled(aEnabled.checked);
            });
        }
        if (aVol && this.audio) {
            const initPct = Math.round(this.audio.volume * 100);
            aVol.value = String(initPct);
            if (aVolVal) aVolVal.textContent = String(initPct);
            aVol.addEventListener('input', () => {
                const pct = parseInt(aVol.value) || 0;
                if (aVolVal) aVolVal.textContent = String(pct);
                this.audio.setVolume(pct / 100);
            });
        }


        // Game mode buttons
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                this.setGameMode(mode);
                this.toggleSettingsModal(); // Close modal immediately
            });
        });

        // Character selection buttons
        document.querySelectorAll('.character-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.character;
                this.setPlayerCharacter(key);
            });
        });
        
        // Setup toolbox modal listeners
        this.setupToolboxListeners();
    }
    
    generateMaze(width, height) {
        // Create a maze using recursive backtracking algorithm with wide halls
        const maze = [];
        
        // Initialize maze with all walls
        for (let y = 0; y < height; y++) {
            maze[y] = [];
            for (let x = 0; x < width; x++) {
                maze[y][x] = '#';
            }
        }
        
        // Carve out paths starting from (3,3) - accounting for wider halls
        this.carvePath(maze, 3, 3, width, height);
        
        // Ensure entrance and exit are open with wide openings
        for (let i = 0; i < 5; i++) {
            if (maze[3 + i]) {
                maze[3 + i][0] = '.'; // Wide entrance
            }
            if (maze[height-4 + i]) {
                maze[height-4 + i][width-1] = '.'; // Wide exit
            }
        }
        
        return maze;
    }
    
    carvePath(maze, x, y, width, height) {
        // Carve a 5x5 area around the current position
        this.carveArea(maze, x, y, 5, 5);
        
        // Define directions (up, down, left, right) with 6-unit spacing for wide halls
        const directions = [
            [0, -6], // up
            [0, 6],  // down
            [-6, 0], // left
            [6, 0]   // right
        ];
        
        // Shuffle directions for randomness
        for (let i = directions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [directions[i], directions[j]] = [directions[j], directions[i]];
        }
        
        // Try each direction
        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            
            // Check if the new position is valid and unvisited
            if (nx > 2 && nx < width - 3 && ny > 2 && ny < height - 3 && maze[ny][nx] === '#') {
                // Carve the wall between current and new position (3-unit wide corridor)
                this.carveArea(maze, x + dx/2, y + dy/2, 3, 3);
                // Recursively carve from the new position
                this.carvePath(maze, nx, ny, width, height);
            }
        }
    }
    
    carveArea(maze, startX, startY, width, height) {
        // Carve out a rectangular area
        for (let y = startY - Math.floor(height/2); y < startY + Math.ceil(height/2); y++) {
            for (let x = startX - Math.floor(width/2); x < startX + Math.ceil(width/2); x++) {
                if (x >= 0 && x < maze[0].length && y >= 0 && y < maze.length && maze[y]) {
                    maze[y][x] = '.';
                }
            }
        }
    }
    
    clearPlacedFlags() {
        if (!this.placedFlags || this.placedFlags.length === 0) {
            return;
        }
        this.placedFlags.forEach(flag => {
            this.setFlagHighlight(flag, false);
            if (flag && flag.parent) {
                flag.parent.remove(flag);
            }
        });
        this.placedFlags = [];
    }

    createLabyrinth() {
        const theme = this.themes.desert;
        const wallMaterial = this.materials && this.materials.wall
            ? this.materials.wall
            : new THREE.MeshLambertMaterial({
                color: theme.wall,
                emissive: theme.wallEmissive,
                transparent: true,
                opacity: 0.95
            });
        
        // Get current maze
        const currentMaze = this.savedMazes[this.currentMazeIndex];
        let maze;
        let cellSize, wallHeight, startX, startZ;
        
        if (currentMaze.type === "labyrinth") {
            // Perfect maze with clear start/end; wide halls and tall walls
            const size = currentMaze.size;
            const result = this.generatePerfectLabyrinth(size);
            maze = result.grid;
            this.levelStartCell = result.start; // {x,y}
            this.levelEndCell = result.end;
            cellSize = this.labyrinthCorridorWidth; // wide halls (5–10 range recommended)
            wallHeight = 8; // high walls
            const cols = maze[0].length;
            const rows = maze.length;
            startX = -((cols - 1) * cellSize) / 2;
            startZ = -((rows - 1) * cellSize) / 2;
            this.updateGroundAndFog((cols - 1) * cellSize, (rows - 1) * cellSize);
        } else if (currentMaze.type === "ascii") {
            // Generate perfect ASCII maze based on difficulty
            maze = this.generateAsciiPerfectMazeByDifficulty(this.mazeDifficulty || 5);
            cellSize = 3;
            wallHeight = 8;
            const cols = maze[0].length;
            const rows = maze.length;
            startX = -((cols - 1) * cellSize) / 2;
            startZ = -((rows - 1) * cellSize) / 2;
            this.updateGroundAndFog((cols - 1) * cellSize, (rows - 1) * cellSize);
            
            // Store maze info for enemy spawning
            this.lastMazeInfo = { maze, startX, startZ, cellSize };
        } else if (currentMaze.type === "generated") {
            // Generate maze dynamically
            maze = this.generateMaze(currentMaze.size, currentMaze.size);
            cellSize = 2;
            wallHeight = 4;
            // Center the maze exactly on the ground using cell centers
            const cols = maze[0].length;
            const rows = maze.length;
            startX = -((cols - 1) * cellSize) / 2;
            startZ = -((rows - 1) * cellSize) / 2;
            this.updateGroundAndFog((cols - 1) * cellSize, (rows - 1) * cellSize);
        } else {
            // Use static layout
            maze = currentMaze.layout;
            cellSize = 3;
            wallHeight = (currentMaze.name === 'Labyrinth') ? 8 : 4;
            const cols = maze[0].length;
            const rows = maze.length;
            startX = -((cols - 1) * cellSize) / 2;
            startZ = -((rows - 1) * cellSize) / 2;
            this.updateGroundAndFog((cols - 1) * cellSize, (rows - 1) * cellSize);
        }
        
        // Create walls based on layout
        for (let row = 0; row < maze.length; row++) {
            for (let col = 0; col < maze[row].length; col++) {
                const tile = maze[row][col];
                if (tile === '#') {
                    const isBorder = row === 0 || col === 0 || row === maze.length - 1 || col === maze[row].length - 1;
                    // Only thin interior walls for procedurally generated mazes.
                    if (currentMaze.type === 'generated' && !isBorder) {
                        if (Math.random() > this.wallDensity) continue; // skip most interior walls
                    }
                     // Vary wall height for visual interest
                    const h = (currentMaze.type === 'labyrinth') ? wallHeight : (wallHeight * THREE.MathUtils.lerp(0.7, 1.6, Math.random()));
                    const wall = this.createBrickWallMesh(cellSize, h, cellSize) || (() => {
                        const m = new THREE.Mesh(new THREE.BoxGeometry(cellSize, h, cellSize), wallMaterial);
                        m.castShadow = true;
                        m.receiveShadow = true;
                        return m;
                    })();
                    wall.position.set(
                        startX + col * cellSize,
                        h / 2,
                        startZ + row * cellSize
                    );
                    this.scene.add(wall);
                    
                    // Store wall for collision detection
                    this.walls.push({
                        mesh: wall,
                        position: wall.position,
                        size: { x: cellSize, y: h, z: cellSize }
                    });
                }
            }
        }
        
        // Stash info for spawners and markers
        this.lastMazeInfo = { maze, startX, startZ, cellSize };

        // Compute and store start/end world positions for labyrinth
        if (currentMaze.type === 'labyrinth' && this.levelStartCell && this.levelEndCell) {
            const sx = startX + this.levelStartCell.x * cellSize;
            const sz = startZ + this.levelStartCell.y * cellSize;
            const ex = startX + this.levelEndCell.x * cellSize;
            const ez = startZ + this.levelEndCell.y * cellSize;
            this.levelStartWorld = new THREE.Vector3(sx, 0, sz);
            this.levelEndWorld = new THREE.Vector3(ex, 0, ez);
            // Place markers
            this.addObjectiveMarkers(this.levelStartWorld, this.levelEndWorld);
        } else {
            // Add entrance and exit markers based on maze bounds
            this.addLabyrinthMarkers(maze, { startX, startZ, cellSize });
        }
    }
    
    addLabyrinthMarkers(maze, info) {
        // Clean up previous markers
        if (this.labyrinthMarkers && this.labyrinthMarkers.length) {
            this.labyrinthMarkers.forEach(m => this.scene.remove(m));
            this.labyrinthMarkers = [];
        }
        const { startX, startZ, cellSize } = info;
        const rows = maze.length;
        const cols = maze[0].length;
        // Find entrance near left side and exit near right side (handling solid borders)
        let entRow = Math.floor(rows / 2), entCol = 1;
        let exitRow = Math.floor(rows / 2), exitCol = cols - 2;
        // Scan a band from the edge inward to locate the closest open cell
        for (let r = 1; r < rows - 1; r++) {
            for (let c = 0; c < Math.min(10, cols); c++) {
                if (maze[r][c] === '.') { entRow = r; entCol = Math.max(1, c); break; }
            }
            if (entCol !== 1 || maze[entRow][1] === '.') break;
        }
        for (let r = rows - 2; r >= 1; r--) {
            for (let c = cols - 1; c >= Math.max(cols - 10, 0); c--) {
                if (maze[r][c] === '.') { exitRow = r; exitCol = Math.min(cols - 2, c); break; }
            }
            if (exitCol !== cols - 2 || maze[exitRow][cols - 2] === '.') break;
        }
        // Create markers slightly above ground at cell centers
        const entranceGeometry = new THREE.ConeGeometry(0.5, 2, 8);
        const entranceMaterial = new THREE.MeshLambertMaterial({ color: 0xffb347, emissive: 0x4a3018 });
        const entrance = new THREE.Mesh(entranceGeometry, entranceMaterial);
        entrance.position.set(startX + entCol * cellSize, 1, startZ + entRow * cellSize);
        this.scene.add(entrance);
        
        const exitGeometry = new THREE.ConeGeometry(0.5, 2, 8);
        const exitMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000, emissive: 0x440000 });
        const exit = new THREE.Mesh(exitGeometry, exitMaterial);
        exit.position.set(startX + exitCol * cellSize, 1, startZ + exitRow * cellSize);
        this.scene.add(exit);
        this.labyrinthMarkers = [entrance, exit];
        // Save for spawn logic
        this.levelStartWorld = new THREE.Vector3(startX + entCol * cellSize, 0, startZ + entRow * cellSize);
        this.levelEndWorld = new THREE.Vector3(startX + exitCol * cellSize, 0, startZ + exitRow * cellSize);
    }

    addObjectiveMarkers(startWorld, endWorld) {
        // Clear previous markers
        if (this.labyrinthMarkers && this.labyrinthMarkers.length) {
            this.labyrinthMarkers.forEach(m => this.scene.remove(m));
        }
        this.labyrinthMarkers = [];
        // Start marker (warm gold)
        const sGeom = new THREE.ConeGeometry(0.7, 2.5, 10);
        const sMat = new THREE.MeshLambertMaterial({ color: 0xffd27a, emissive: 0x4a3018 });
        const s = new THREE.Mesh(sGeom, sMat);
        s.position.set(startWorld.x, 1.25, startWorld.z);
        this.scene.add(s);
        // End (red)
        const eGeom = new THREE.ConeGeometry(0.7, 2.5, 10);
        const eMat = new THREE.MeshLambertMaterial({ color: 0xff5566, emissive: 0x330000 });
        const e = new THREE.Mesh(eGeom, eMat);
        e.position.set(endWorld.x, 1.25, endWorld.z);
        this.scene.add(e);
        this.labyrinthMarkers.push(s, e);
    }

    generatePerfectLabyrinth(size) {
        // Ensure odd size for maze
        const n = (size % 2 === 0) ? size + 1 : size;
        const grid = Array.from({ length: n }, () => Array.from({ length: n }, () => '#'));
        // Carve passages at odd coordinates
        const stack = [];
        const start = { x: 1, y: 1 };
        grid[start.y][start.x] = '.';
        stack.push(start);
        const dirs = [ {x:0,y:-2}, {x:2,y:0}, {x:0,y:2}, {x:-2,y:0} ];
        while (stack.length) {
            const cur = stack[stack.length - 1];
            // collect unvisited neighbors
            const neigh = [];
            for (const d of dirs.sort(()=>Math.random()-0.5)) {
                const nx = cur.x + d.x, ny = cur.y + d.y;
                if (nx > 0 && nx < n-1 && ny > 0 && ny < n-1 && grid[ny][nx] === '#') {
                    neigh.push({ nx, ny, wx: cur.x + d.x/2, wy: cur.y + d.y/2 });
                }
            }
            if (neigh.length === 0) {
                stack.pop();
            } else {
                const pick = neigh[Math.floor(Math.random()*neigh.length)];
                grid[pick.wy][pick.wx] = '.';
                grid[pick.ny][pick.nx] = '.';
                stack.push({ x: pick.nx, y: pick.ny });
            }
        }
        // Define end at opposite corner
        const end = { x: n-2, y: n-2 };
        grid[end.y][end.x] = '.';
        // Openings on border near start and end
        grid[1][0] = '.'; // entrance
        grid[n-2][n-1] = '.'; // exit
        return { grid, start, end };
    }

    // Build a static ASCII labyrinth with wide corridors and small loops.
    // baseSize: odd number (e.g., 61); passageScale: width of corridors in cells (e.g., 5)
    // braidFactor: 0..1 chance to open a wall between parallel passages to create loops
    generateWideImperfectLabyrinth(baseSize = 61, passageScale = 1, braidFactor = 0.12) {
        const { grid } = this.generatePerfectLabyrinth(baseSize); // '.' and '#'
        const H = grid.length, W = grid[0].length;
        // Upscale: '.' -> passageScale x passageScale block; '#' stays 1x1 to keep walls 1 cell thick
        const out = [];
        for (let y = 0; y < H; y++) {
            const row = grid[y];
            const expandedRow = [];
            for (let x = 0; x < W; x++) {
                if (row[x] === '.') {
                    for (let k = 0; k < passageScale; k++) expandedRow.push('.');
                } else {
                    expandedRow.push('#');
                }
            }
            const vrep = row.some(c => c === '.') ? passageScale : 1;
            for (let r = 0; r < vrep; r++) out.push(expandedRow.slice());
        }
        const H2 = out.length, W2 = out[0].length;
        // Outer border walls
        for (let x = 0; x < W2; x++) { out[0][x] = '#'; out[H2-1][x] = '#'; }
        for (let y = 0; y < H2; y++) { out[y][0] = '#'; out[y][W2-1] = '#'; }
        // Punch some internal walls to add loops
        for (let y = 1; y < H2 - 1; y++) {
            for (let x = 1; x < W2 - 1; x++) {
                if (out[y][x] !== '#') continue;
                const left = out[y][x-1] === '.'; const right = out[y][x+1] === '.';
                const up = out[y-1][x] === '.'; const down = out[y+1][x] === '.';
                const separatesHoriz = left && right && !(up || down);
                const separatesVert = up && down && !(left || right);
                if ((separatesHoriz || separatesVert) && Math.random() < braidFactor) out[y][x] = '.';
            }
        }
        // Entrance on left, exit on right
        let entY = Math.floor(H2/2), extY = Math.floor(H2/2);
        for (let y = 1; y < H2 - 1; y++) if (out[y][1] === '.') { entY = y; break; }
        for (let y = H2 - 2; y >= 1; y--) if (out[y][W2-2] === '.') { extY = y; break; }
        out[entY][0] = '.'; out[extY][W2-1] = '.';
        return out.map(r => r.join(''));
    }

    // ===== ASCII perfect maze (strings) with difficulty =====
    generateAsciiPerfectMaze(width, height) {
        let w = (width % 2 === 0) ? width - 1 : width;
        let h = (height % 2 === 0) ? height - 1 : height;

        const grid = Array.from({ length: h }, () => Array.from({ length: w }, () => '#'));
        const inBounds = (x, y) => x > 0 && x < w - 1 && y > 0 && y < h - 1;
        const carve = (x, y) => { grid[y][x] = '.'; };

        // Start at random odd cell
        let sx = 1 + 2 * Math.floor(Math.random() * ((w - 1) / 2));
        let sy = 1 + 2 * Math.floor(Math.random() * ((h - 1) / 2));
        carve(sx, sy);

        const stack = [{ x: sx, y: sy }];
        const dirs = [[0, -2], [2, 0], [0, 2], [-2, 0]];

        while (stack.length) {
            const cur = stack[stack.length - 1];
            const neighbors = dirs
                .map(([dx, dy]) => ({ nx: cur.x + dx, ny: cur.y + dy, bx: cur.x + dx / 2, by: cur.y + dy / 2 }))
                .filter(n => inBounds(n.nx, n.ny) && grid[n.ny][n.nx] === '#');

            if (neighbors.length === 0) { stack.pop(); continue; }

            const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
            grid[pick.by][pick.bx] = '.';
            grid[pick.ny][pick.nx] = '.';
            stack.push({ x: pick.nx, y: pick.ny });
        }

        // Entrance and exit
        let entY = 1; for (let y = 1; y < h - 1; y++) if (grid[y][1] === '.') { entY = y; break; }
        let extY = h - 2; for (let y = h - 2; y >= 1; y--) if (grid[y][w - 2] === '.') { extY = y; break; }
        grid[entY][0] = '.'; grid[extY][w - 1] = '.';

        return grid.map(row => row.join(''));
    }

    generateAsciiPerfectMazeByDifficulty(level) {
        const d = Math.max(1, Math.min(10, parseInt(level) || 5));
        const size = 25 + (d - 1) * 8; // 25..97
        const odd = (size % 2 === 1) ? size : size - 1;
        return this.generateAsciiPerfectMaze(odd, odd);
    }

    // ===== Static Labyrinth Editing Helpers =====
    findMazeIndexByName(name) {
        return this.savedMazes.findIndex(m => m.name === name);
    }

    exportCurrentMazeASCII() {
        if (!this.lastMazeInfo || !this.lastMazeInfo.maze) {
            console.warn('No maze built yet');
            return '';
        }
        const lines = this.lastMazeInfo.maze.map(row => Array.isArray(row) ? row.join('') : row);
        const text = lines.join('\n');
        try { console.log(text); } catch(_) {}
        return text;
    }

    setLabyrinthLayout(layoutLines) {
        // Accept array of strings or single text
        const lines = Array.isArray(layoutLines) ? layoutLines : String(layoutLines).trim().split(/\r?\n/);
        const idx = this.findMazeIndexByName('Labyrinth');
        if (idx === -1) { console.error('Labyrinth entry not found'); return; }
        // Validate rectangular
        const w = lines[0].length;
        if (!lines.every(l => l.length === w)) {
            console.error('Layout rows must be equal length'); return;
        }
        this.savedMazes[idx] = {
            name: 'Labyrinth',
            size: lines.length,
            type: 'static',
            layout: lines,
            description: `Static labyrinth ${lines.length}x${w}`
        };
        // Switch to it and rebuild
        this.currentMazeIndex = idx;
        this.rebuildMaze();
    }


    // --- Play Mode (Diablo-style) helpers ---
    setupPlayMode() {
        // Use pointer lock aiming; cursor hidden in play mode
        if (!document.pointerLockElement) {
            // Will be acquired on first click (user gesture)
            document.body.style.cursor = 'none';
        }
        // Clear existing click target
        this.playMode.clickTarget = null;
        // (Re)spawn targets
        this.respawnEnemies();
        
        // Reset enemy spawn timer for continuous spawning
        this.enemySpawnTimer = 0;
    }

    spawnTestEnemies(count = this.enemyCount) {
        // Don't spawn if we're at max capacity
        if (this.playMode.enemies.length >= this.maxEnemies) {
            return;
        }
        
        // Prefer spawning on open maze cells for reliability
        let placed = 0;
        if (this.lastMazeInfo && this.lastMazeInfo.maze) {
            const { maze, startX, startZ, cellSize } = this.lastMazeInfo;
            const rows = maze.length, cols = maze[0].length;
            const openCells = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    if (maze[r][c] === '.') openCells.push({ r, c });
                }
            }
            // Shuffle cells for randomness
            for (let i = openCells.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [openCells[i], openCells[j]] = [openCells[j], openCells[i]];
            }
            let idx = 0;
            const maxToPlace = Math.min(count, this.maxEnemies - this.playMode.enemies.length);
            while (placed < maxToPlace && idx < openCells.length) {
                const { r, c } = openCells[idx++];
                const baseX = startX + c * cellSize;
                const baseZ = startZ + r * cellSize;
                const jitterX = (Math.random() - 0.5) * (cellSize * 0.6);
                const jitterZ = (Math.random() - 0.5) * (cellSize * 0.6);
                const x = baseX + jitterX;
                const z = baseZ + jitterZ;
                if (this.isPositionFree(x, z, 0.9) && this.player.position.distanceTo(new THREE.Vector3(x,0,z)) > 5) {
                    const m = this.createEnemyAt(x, z);
                    this.playMode.enemiesGroup.add(m);
                    this.playMode.enemies.push(m);
                    placed++;
                }
            }
        }
        // If not enough placed (e.g., no maze info), fallback to random world sampling
        if (placed < count) {
            const bounds = this.getMazeBounds();
            let attempts = 0;
            const maxToPlace = Math.min(count, this.maxEnemies - this.playMode.enemies.length);
            while (this.playMode.enemies.length < maxToPlace && attempts < maxToPlace * 200) {
                attempts++;
                const x = THREE.MathUtils.lerp(bounds.minX + 2, bounds.maxX - 2, Math.random());
                const z = THREE.MathUtils.lerp(bounds.minZ + 2, bounds.maxZ - 2, Math.random());
                if (this.isPositionFree(x, z, 0.9) && this.player.position.distanceTo(new THREE.Vector3(x,0,z)) > 5) {
                    const m = this.createEnemyAt(x, z);
                    this.playMode.enemiesGroup.add(m);
                    this.playMode.enemies.push(m);
                }
            }
        }
    }

    createEnemyAt(x, z) {
        const bodyColor = 0x6aa84f; // zombie green — used by death-fragment particles
        const m = new THREE.Group();
        m.position.set(x, 0, z);

        if (this.zombieTemplate && THREE.SkeletonUtils) {
            const clone = THREE.SkeletonUtils.clone(this.zombieTemplate.scene);
            clone.scale.set(0.9, 0.9, 0.9);
            clone.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            m.add(clone);
            clone.updateMatrixWorld(true);

            // Derive hit box from the actual scaled model so it adapts to whatever size we pick
            const bbox = new THREE.Box3().setFromObject(clone);
            const size = bbox.getSize(new THREE.Vector3());
            m.userData.hitHeight = size.y;
            m.userData.hitRadius = Math.max(size.x, size.z) * 0.5 + 0.1;
            m.userData.hpBarY = size.y + 0.4;

            const mixer = new THREE.AnimationMixer(clone);
            const anims = this.zombieTemplate.animations;
            const walk = anims.find(c => /walk/i.test(c.name)) || anims[0];
            if (walk) mixer.clipAction(walk).play();
            m.userData.zombieClone = clone;
            m.userData.mixer = mixer;
        } else {
            // Fallback sphere if zombie template hasn't finished loading yet
            const fallback = new THREE.Mesh(
                new THREE.SphereGeometry(0.5, 12, 12),
                new THREE.MeshLambertMaterial({ color: bodyColor, emissive: 0x081808 })
            );
            fallback.position.y = 0.5;
            fallback.castShadow = true;
            m.add(fallback);
            m.userData.hitHeight = 1.0;
            m.userData.hitRadius = 0.6;
            m.userData.hpBarY = 1.4;
        }

        const maxHp = Math.round(50 + Math.random() * 100); // 50–150
        m.userData = Object.assign(m.userData || {}, {
            type: 'enemy',
            hp: maxHp,
            hpMax: maxHp,
            bodyColor,
            speed: 1.2 + Math.random() * 0.8,
            dir: new THREE.Vector2(Math.cos(Math.random()*Math.PI*2), Math.sin(Math.random()*Math.PI*2)),
            changeT: 1 + Math.random() * 2,
            stunT: 0,
            knockback: null
        });
        // Add simple health bar (initially hidden)
        const barW = 1.4, barH = 0.15;
        const back = new THREE.Mesh(
            new THREE.PlaneGeometry(barW, barH),
            new THREE.MeshBasicMaterial({ color: 0x660000 })
        );
        const front = new THREE.Mesh(
            new THREE.PlaneGeometry(barW, barH),
            new THREE.MeshBasicMaterial({ color: 0x22ff22 })
        );
        front.position.z = 0.001;
        const bar = new THREE.Group();
        bar.add(back); bar.add(front);
        bar.position.set(0, m.userData.hpBarY || 2.2, 0);
        bar.userData = { back, front, width: barW, showTimer: 0 };
        bar.visible = false; // Initially hidden
        m.add(bar);
        m.userData.hpBar = bar;
        return m;
    }

    updateEnemies(deltaTime) {
        if (this.playMode.enemies.length === 0) return;
        for (let i = this.playMode.enemies.length - 1; i >= 0; i--) {
            const e = this.playMode.enemies[i];
            const ud = e.userData;
            // Stun: pause wandering/movement while knocked back
            if (ud.stunT > 0) {
                ud.stunT -= deltaTime;
            } else {
                // Wander; occasionally turn or bounce off walls
                ud.changeT -= deltaTime;
                if (ud.changeT <= 0) {
                    // Random new direction, slight bias toward player
                    const toPlayer = new THREE.Vector2(
                        this.player.position.x - e.position.x,
                        this.player.position.z - e.position.z
                    ).normalize();
                    const rand = new THREE.Vector2(Math.cos(Math.random()*Math.PI*2), Math.sin(Math.random()*Math.PI*2)).multiplyScalar(0.5);
                    ud.dir = toPlayer.multiplyScalar(0.5).add(rand).normalize();
                    ud.changeT = 1 + Math.random() * 2;
                }
                // Try to move
                const nextX = e.position.x + ud.dir.x * ud.speed * deltaTime;
                const nextZ = e.position.z + ud.dir.y * ud.speed * deltaTime;
                const test = new THREE.Vector3(nextX, e.position.y, nextZ);
                if (this.pointHitsWall(test)) {
                    // Bounce: flip direction and try again next frame
                    ud.dir.x *= -1; ud.dir.y *= -1;
                    ud.changeT = 0.2;
                } else {
                    e.position.x = nextX;
                    e.position.z = nextZ;
                }
            }
            // Apply decaying knockback impulse (works during and after stun)
            if (ud.knockback) {
                const kbX = ud.knockback.x * deltaTime;
                const kbZ = ud.knockback.y * deltaTime;
                const kbTest = new THREE.Vector3(e.position.x + kbX, e.position.y, e.position.z + kbZ);
                if (!this.pointHitsWall(kbTest)) {
                    e.position.x = kbTest.x;
                    e.position.z = kbTest.z;
                }
                ud.knockback.multiplyScalar(Math.pow(0.001, deltaTime));
                if (ud.knockback.lengthSq() < 0.05) ud.knockback = null;
            }
            // Face direction of travel
            if (ud.dir && (ud.dir.x !== 0 || ud.dir.y !== 0)) {
                e.rotation.y = Math.atan2(ud.dir.x, ud.dir.y);
            }
            // Hit flinch: lean back + squish, decays to neutral
            if (ud.flinchT > 0) {
                ud.flinchT -= deltaTime;
                const p = Math.max(0, ud.flinchT) / ud.flinchMax;
                e.rotation.x = -0.45 * p;
                e.scale.y = 1 - 0.12 * p;
                e.scale.x = 1 + 0.08 * p;
                if (ud.flinchT <= 0) {
                    e.rotation.x = 0;
                    e.scale.set(1, 1, 1);
                }
            }
            // Tick zombie animation
            if (ud.mixer) ud.mixer.update(deltaTime);
            // Update health bar visibility and display
            if (ud.hpBar) {
                // Update show timer
                if (ud.hpBar.userData.showTimer > 0) {
                    ud.hpBar.userData.showTimer -= deltaTime;
                    if (ud.hpBar.userData.showTimer <= 0) {
                        ud.hpBar.visible = false;
                    }
                }
                
                // Only update bar if it's visible
                if (ud.hpBar.visible) {
                    const cam = this.camera.position;
                    ud.hpBar.lookAt(cam.x, ud.hpBar.position.y + e.position.y, cam.z);
                    const ratio = Math.max(0, Math.min(1, ud.hp / ud.hpMax));
                    ud.hpBar.userData.front.scale.x = ratio;
                    ud.hpBar.userData.front.position.x = -(ud.hpBar.userData.width * (1 - ratio)) / 2;
                }
            }
        }
    }

    showEnemyHPBar(enemy, duration = 3.0) {
        if (enemy.userData.hpBar) {
            enemy.userData.hpBar.visible = true;
            enemy.userData.hpBar.userData.showTimer = duration;
        }
    }
    
    damagePlayer(amount) {
        if (this.player.invulnerable) return;
        
        this.player.hp = Math.max(0, this.player.hp - amount);
        this.player.invulnerable = true;
        this.player.invulnerabilityTimer = 1.0; // 1 second invulnerability
        this.audio && this.audio.play('playerHurt');
        this._damageVignetteT = 0.45;

        // Visual feedback
        this.showMessage(`${this.t('playerHit')} - ${this.t('health')}: ${this.player.hp}/${this.player.maxHp}`);
        
        // Flash effect
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
        
        // Check for death
        if (this.player.hp <= 0) {
            this.showMessage(this.t('playerDeath'));
            this.audio && this.audio.play('gameOver');
            if (this.arena && this.arena.active) {
                // Arena run failed — restart from wave 1
                this.startArenaMode();
            } else {
                // Reset player position or respawn
                this.player.position.set(0, 1, 0);
                this.player.hp = this.player.maxHp;
            }
        }
    }

    // ===== Audio-driven feel helpers =====
    updatePlayerLocomotion(deltaTime) {
        if (!this.player || !this.player.model) return;
        // Sync model position/rotation with the logical player
        const m = this.player.model;
        m.position.copy(this.player.position);
        // Procedural model: animate limbs based on horizontal velocity
        if (this.player._armRestZ && this.player.leftArm) {
            const v = this.player.velocity;
            const speed = v ? Math.hypot(v.x, v.z) : 0;
            this._locoT = (this._locoT || 0) + deltaTime * (3 + speed * 0.8);
            const walkAmt = Math.min(1, speed / 6);
            const swing = Math.sin(this._locoT * 2) * 0.6 * walkAmt;
            const idleBob = (1 - walkAmt) * Math.sin((this._locoT) * 1.5) * 0.05;
            // Legs swing forward/back
            const restLx = this.player._legRestX.L;
            const restRx = this.player._legRestX.R;
            if (this.player.leftLeg) this.player.leftLeg.rotation.x = restLx + swing;
            if (this.player.rightLeg) this.player.rightLeg.rotation.x = restRx - swing;
            // Arms counter-swing on Z; skip while attacking so the swing anim takes over
            if (!this._attackPoseT) {
                const restLz = this.player._armRestZ.L;
                const restRz = this.player._armRestZ.R;
                if (this.player.leftArm) this.player.leftArm.rotation.x = -swing * 0.5;
                if (this.player.rightArm) this.player.rightArm.rotation.x = swing * 0.5;
                if (this.player.leftArm) this.player.leftArm.rotation.z = restLz;
                if (this.player.rightArm) this.player.rightArm.rotation.z = restRz;
            }
            // Small vertical body bob
            if (this.player.body) this.player.body.position.y = (this.player.body.userData._restY ?? this.player.body.position.y);
            if (this.player.body && this.player.body.userData._restY === undefined) {
                this.player.body.userData._restY = this.player.body.position.y;
            }
            if (this.player.body) {
                const bob = Math.abs(Math.sin(this._locoT * 2)) * 0.06 * walkAmt + idleBob;
                this.player.body.position.y = this.player.body.userData._restY + bob;
            }
        }
        // Attack pose tween (raises the weapon arm briefly)
        if (this._attackPoseT > 0) {
            this._attackPoseT = Math.max(0, this._attackPoseT - deltaTime);
            const k = this._attackPoseT / 0.18; // 1 → 0
            const lift = Math.sin((1 - k) * Math.PI) * 1.1;
            if (this.player.rightArm) {
                this.player.rightArm.rotation.x = -lift;
                this.player.rightArm.rotation.z = (this.player._armRestZ?.R || 0) - lift * 0.3;
            }
        }
    }

    triggerAttackPose() { this._attackPoseT = 0.18; }

    updateFootsteps(deltaTime) {
        if (!this.audio || !this.player || this.gameMode !== 'play') return;
        const v = this.player.velocity;
        if (!v) return;
        const horiz = Math.hypot(v.x, v.z);
        const grounded = this.player.onGround !== false; // default true if undefined
        if (horiz > 1.5 && grounded) {
            // speed scales cadence: faster movement → shorter interval
            const interval = Math.max(0.22, 0.45 - horiz * 0.02);
            this.audio.footstep(interval);
            this._footDustTimer = (this._footDustTimer || 0) - deltaTime;
            if (this._footDustTimer <= 0) {
                this._footDustTimer = interval;
                this.spawnFootstepDust && this.spawnFootstepDust();
            }
        }
    }

    updateDamageVignette(deltaTime) {
        if (this._damageVignetteT > 0) {
            this._damageVignetteT = Math.max(0, this._damageVignetteT - deltaTime);
        }
    }

    triggerMuzzleFlash() {
        // Flash data is consumed by render() (CSS overlay) and the FPV viewmodel.
        this._muzzleFlashT = 0.08;
    }

    updateMuzzleFlash(deltaTime) {
        if (this._muzzleFlashT > 0) {
            this._muzzleFlashT = Math.max(0, this._muzzleFlashT - deltaTime);
        }
    }

    spawnPickupCollectFx(p) {
        if (!p) return;
        // Clone the geometry/material into a transient scene mesh that scales up + fades.
        const mat = p.material && p.material.clone ? p.material.clone() : new THREE.MeshBasicMaterial({ color: 0x66ffcc });
        mat.transparent = true;
        const geo = p.geometry || new THREE.IcosahedronGeometry(0.35, 0);
        const fx = new THREE.Mesh(geo, mat);
        fx.position.copy(p.position);
        fx.userData = { type: 'collectFx', t: 0, ttl: 0.28 };
        this.scene.add(fx);
        this._collectFx = this._collectFx || [];
        this._collectFx.push(fx);
    }

    updatePickupCollectFx(deltaTime) {
        if (!this._collectFx || !this._collectFx.length) return;
        for (let i = this._collectFx.length - 1; i >= 0; i--) {
            const fx = this._collectFx[i];
            fx.userData.t += deltaTime;
            const k = fx.userData.t / fx.userData.ttl;
            if (k >= 1) {
                this.scene.remove(fx);
                this._collectFx.splice(i, 1);
                continue;
            }
            const s = 1 + k * 2.5;
            fx.scale.set(s, s, s);
            fx.position.y += deltaTime * 1.5;
            if (fx.material) fx.material.opacity = 1 - k;
        }
    }

    spawnEnemyDeathFragments(pos, baseColor) {
        const colorHex = (typeof baseColor === 'number') ? baseColor : 0xff3333;
        this._enemyFrags = this._enemyFrags || [];
        for (let i = 0; i < 6; i++) {
            const geo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
            const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true });
            const f = new THREE.Mesh(geo, mat);
            f.position.copy(pos);
            f.position.y += 0.6;
            const ang = Math.random() * Math.PI * 2;
            const up = 2 + Math.random() * 2;
            const rad = 2 + Math.random() * 2;
            f.userData = {
                v: new THREE.Vector3(Math.cos(ang) * rad, up, Math.sin(ang) * rad),
                t: 0, ttl: 0.7,
                spin: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8)
            };
            this.scene.add(f);
            this._enemyFrags.push(f);
        }
    }

    updateEnemyDeathFragments(deltaTime) {
        if (!this._enemyFrags || !this._enemyFrags.length) return;
        const gravity = -9.8;
        for (let i = this._enemyFrags.length - 1; i >= 0; i--) {
            const f = this._enemyFrags[i];
            const ud = f.userData;
            ud.t += deltaTime;
            if (ud.t >= ud.ttl) {
                this.scene.remove(f);
                this._enemyFrags.splice(i, 1);
                continue;
            }
            ud.v.y += gravity * deltaTime;
            f.position.x += ud.v.x * deltaTime;
            f.position.y += ud.v.y * deltaTime;
            f.position.z += ud.v.z * deltaTime;
            f.rotation.x += ud.spin.x * deltaTime;
            f.rotation.y += ud.spin.y * deltaTime;
            f.rotation.z += ud.spin.z * deltaTime;
            if (f.material) f.material.opacity = Math.max(0, 1 - ud.t / ud.ttl);
            if (f.position.y < 0.05) {
                f.position.y = 0.05;
                ud.v.y *= -0.3;
                ud.v.x *= 0.6; ud.v.z *= 0.6;
            }
        }
    }

    spawnFootstepDust() {
        if (!this.player) return;
        const geo = new THREE.CircleGeometry(0.18, 10);
        const mat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(this.player.position.x, 0.03, this.player.position.z);
        m.userData = { t: 0, ttl: 0.35 };
        this.scene.add(m);
        this._footDust = this._footDust || [];
        this._footDust.push(m);
        // Cleanup older
        if (this._footDust.length > 24) {
            const old = this._footDust.shift();
            this.scene.remove(old);
        }
    }

    updateFootDust(deltaTime) {
        if (!this._footDust || !this._footDust.length) return;
        for (let i = this._footDust.length - 1; i >= 0; i--) {
            const m = this._footDust[i];
            m.userData.t += deltaTime;
            const k = m.userData.t / m.userData.ttl;
            if (k >= 1) {
                this.scene.remove(m);
                this._footDust.splice(i, 1);
                continue;
            }
            const s = 1 + k * 1.5;
            m.scale.set(s, s, s);
            if (m.material) m.material.opacity = 0.45 * (1 - k);
        }
    }

    pointHitsWall(pos, radius = 0.6) {
        for (const w of this.walls) {
            const p = w.position; const s = w.size;
            if (pos.x + radius > p.x - s.x/2 && pos.x - radius < p.x + s.x/2 &&
                pos.z + radius > p.z - s.z/2 && pos.z - radius < p.z + s.z/2) {
                return true;
            }
        }
        return false;
    }

    getMazeBounds() {
        // Approximate bounds from current maze or ground size
        const currentMaze = this.savedMazes[this.currentMazeIndex];
        if (currentMaze) {
            if (currentMaze.type === 'generated') {
                const size = currentMaze.size;
                const cellSize = 2;
                return { minX: -size, maxX: size, minZ: -size, maxZ: size };
            } else if (currentMaze.layout && currentMaze.layout[0]) {
                const rows = currentMaze.layout.length;
                const cols = currentMaze.layout[0].length;
                const cellSize = 3;
                return { minX: -Math.floor(cols / 2) * cellSize, maxX: Math.floor(cols / 2) * cellSize, minZ: -Math.floor(rows / 2) * cellSize, maxZ: Math.floor(rows / 2) * cellSize };
            }
        }
        // Fallback to ground area
        return { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
    }

    isPositionFree(x, z, radius = 0.8) {
        // Simple overlap test against walls
        const testPos = new THREE.Vector3(x, 1, z);
        // Reuse checkCollision logic with temporary radius by inflating test
        for (let wall of this.walls) {
            const wallPos = wall.position;
            const wallSize = wall.size;
            if (x + radius > wallPos.x - wallSize.x/2 &&
                x - radius < wallPos.x + wallSize.x/2 &&
                z + radius > wallPos.z - wallSize.z/2 &&
                z - radius < wallPos.z + wallSize.z/2) {
                return false;
            }
        }
        return true;
    }

    clearEnemies() {
        this.playMode.enemies.forEach(e => this.playMode.enemiesGroup.remove(e));
        this.playMode.enemies = [];
        // Also drop any in-progress death animations so they don't linger
        // through a level reset / respawn.
        if (this.playMode.dyingEnemies && this.playMode.dyingEnemies.length) {
            this.playMode.dyingEnemies.forEach(e => this.playMode.enemiesGroup.remove(e));
            this.playMode.dyingEnemies = [];
        }
    }

    respawnEnemies() {
        this.clearEnemies();
        this.spawnTestEnemies(this.enemyCount);
    }
    
    updateEnemySpawning(deltaTime) {
        // Only spawn continuously in play mode
        if (this.gameMode !== 'play') return;
        // Arena mode owns its own spawn cadence
        if (this.arena && this.arena.active) return;
        
        // Update spawn timer
        this.enemySpawnTimer += deltaTime;
        
        // Spawn new enemies periodically
        if (this.enemySpawnTimer >= this.enemySpawnInterval) {
            this.enemySpawnTimer = 0;
            
            // Spawn 1-3 enemies at a time
            const spawnCount = 1 + Math.floor(Math.random() * 3);
            this.spawnTestEnemies(spawnCount);
            
            // Show spawn message occasionally
            if (Math.random() < 0.3) {
                this.showMessage(`${this.t('enemiesApproaching')} (${this.playMode.enemies.length}/${this.maxEnemies})`);
            }
        }
    }

    handlePlayClick(event) {
        // Route by selected weapon: sword swings, gun fires a projectile.
        const weapon = this.getCurrentWeapon();
        if (weapon && weapon.type === 'melee') {
            this.handleMelee(event);
            return;
        }
        if (weapon && weapon.type === 'ranged') {
            this.fireGun(event);
            return;
        }
    }

    fireGun(event) {
        // Centralized ranged-fire path: validates ammo + cooldown, spawns the
        // projectile from the gun barrel (not the camera centerpoint), applies
        // recoil + muzzle flash + audio.
        if (!this.canFire()) {
            if (this.isReloading) {
                this.showMessage(`${this.t('reloading')}...`);
            } else {
                const w = this.getCurrentWeapon();
                if (w && w.ammoCost > 0 && this.inventory.ammo < w.ammoCost) {
                    this.showMessage(`${this.t('noAmmo')} - ${this.t('ammo')}: ${this.inventory.ammo}`);
                    this.audio && this.audio.play('uiClick');
                }
            }
            return;
        }

        const weapon = this.getCurrentWeapon();
        const weaponId = this.player.weapons[this.player.currentWeaponIndex];

        // Spend ammo + set cooldown BEFORE spawning so the next click is gated.
        if (weapon.ammoCost > 0) this.inventory.ammo -= weapon.ammoCost;
        this.weaponCooldowns[weaponId] = weapon.cooldown;

        // Compute aim direction (where the bullet should fly).
        const dir = this._computeAimDirection(event);

        // Compute spawn position — from gun muzzle in FPV, from in front of the
        // player in iso/third-person.
        let spawn;
        if (this.viewMode === 'fpv' && this.fpvGun && this.fpvGun.userData.muzzle) {
            spawn = new THREE.Vector3();
            this.fpvGun.userData.muzzle.getWorldPosition(spawn);
        } else {
            const forward = new THREE.Vector3(
                Math.sin(this.characterRotation), 0,
                Math.cos(this.characterRotation)
            ).normalize();
            spawn = this.player.position.clone()
                .add(forward.multiplyScalar(0.9))
                .add(new THREE.Vector3(0, 1.1, 0));
        }

        this.shootRay(spawn, dir);

        // Feel: recoil, muzzle flash, audio, attack pose.
        this.triggerGunRecoil && this.triggerGunRecoil();
        this.triggerMuzzleFlash && this.triggerMuzzleFlash();
        this.triggerAttackPose && this.triggerAttackPose();
        this.audio && this.audio.play('shoot');
        this.spawnMuzzleFlashAt && this.spawnMuzzleFlashAt(spawn, dir);
        this.playOneShotAnimation('Attack', 0.2);

        // Push HUD update so ammo count refreshes immediately.
        this.emit('ui:update', this.buildHUDModel());
    }

    _computeAimDirection(event) {
        if (this.viewMode === 'fpv') {
            // Aim along the camera forward (where the crosshair points).
            const v = new THREE.Vector3();
            this.camera.getWorldDirection(v);
            return v.normalize();
        }
        // Iso / third-person: forward from character rotation (matches earlier
        // intent — bullets always fly along the player's facing).
        return new THREE.Vector3(
            Math.sin(this.characterRotation), 0,
            Math.cos(this.characterRotation)
        ).normalize();
    }

    spawnMuzzleFlashAt(pos, dir) {
        // Small additive sprite at the muzzle in world space for iso/third-person
        // views (the FPV viewmodel has its own attached flash).
        if (this.viewMode === 'fpv') return;
        const geo = new THREE.PlaneGeometry(0.5, 0.5);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xffe1a0, transparent: true, opacity: 0.95,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(pos);
        m.lookAt(this.camera.position);
        m.userData = { t: 0, ttl: 0.07 };
        this.scene.add(m);
        this._muzzleSprites = this._muzzleSprites || [];
        this._muzzleSprites.push(m);
    }

    updateWorldMuzzleSprites(deltaTime) {
        if (!this._muzzleSprites || !this._muzzleSprites.length) return;
        for (let i = this._muzzleSprites.length - 1; i >= 0; i--) {
            const m = this._muzzleSprites[i];
            m.userData.t += deltaTime;
            const k = m.userData.t / m.userData.ttl;
            if (k >= 1) {
                this.scene.remove(m);
                this._muzzleSprites.splice(i, 1);
                continue;
            }
            m.material.opacity = (1 - k) * 0.95;
            const s = 1 + k * 0.6;
            m.scale.set(s, s, s);
        }
    }

    handleMelee(event) {
        // Short-range melee from cursor (or center in FPV).
        this.triggerSwordSwing();
        this.playOneShotAnimation('Attack', 0.4);
        const raycaster = new THREE.Raycaster();
        const mouse = (this.viewMode === 'fpv')
            ? new THREE.Vector2(0, 0)
            : new THREE.Vector2(this.playMode.mouseNDC.x, this.playMode.mouseNDC.y);
        raycaster.setFromCamera(mouse, this.camera);

        const weapon = this.getCurrentWeapon();
        const damage = weapon ? weapon.damage : 2;
        const range = (weapon && weapon.type === 'melee') ? weapon.range : 2.5;

        const hits = raycaster.intersectObjects(this.playMode.enemies, true);
        for (const hit of hits) {
            if (hit.distance > range) break;
            const e = this.findEnemyRoot(hit.object);
            if (!e) continue;
            e.userData.hp -= damage;
            this.spawnImpact(hit.point.clone(), 0xffaa55);
            if (e.userData.hp <= 0) {
                this.killEnemy(e);
            } else {
                this.applyEnemyKnockback(e, this.camera.position, 6);
                this.flashEnemy(e);
                this.showEnemyHPBar(e, 3.0);
            }
            return;
        }
        // Whiff effect at range end
        const endPoint = this.camera.position.clone().add(raycaster.ray.direction.clone().multiplyScalar(range));
        this.spawnImpact(endPoint, 0xcccccc);
    }

    shootAt(targetPos) {
        // Backward compatibility: derive ray from player/camera toward targetPos
        const origin = (this.viewMode === 'fpv') ? this.camera.position.clone() : this.player.position.clone().add(new THREE.Vector3(0,1.2,0));
        const dir = targetPos.clone().sub(origin).normalize();
        this.shootRay(origin, dir);
    }

    shootRay(origin, dir) {
        // Create a projectile traveling along a ray, supports vertical aim.
        // Visual: a small round pellet with a soft additive halo — no arrow tail.
        const group = new THREE.Group();
        const projGeo = new THREE.SphereGeometry(0.08, 10, 10);
        const projMat = new THREE.MeshBasicMaterial({ color: 0xffe080 });
        const core = new THREE.Mesh(projGeo, projMat);
        group.add(core);

        // Subtle additive halo so the pellet stays readable at distance.
        const haloGeo = new THREE.SphereGeometry(0.14, 10, 10);
        const haloMat = new THREE.MeshBasicMaterial({
            color: 0xffd060, transparent: true, opacity: 0.45,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        group.add(halo);

        // Small point light so it lights nearby walls briefly.
        const light = new THREE.PointLight(0xffd060, 0.5, 2.5, 2);
        group.add(light);
        const tracer = null;

        // Spawn offset: FPV from eye; iso from player front
        let spawn;
        if (this.viewMode === 'fpv') {
            spawn = origin.clone().add(dir.clone().multiplyScalar(0.5));
        } else {
            const forward = new THREE.Vector3(Math.sin(this.characterRotation), 0, Math.cos(this.characterRotation));
            spawn = this.player.position.clone().add(forward.multiplyScalar(1.0)).add(new THREE.Vector3(0, 0.6, 0));
            // Ensure direction matches facing in iso (pure forward)
            dir = forward.clone().normalize();
        }
        group.position.copy(spawn);

        // Orient the group so its local +Z faces the travel direction.
        const lookTarget = spawn.clone().add(dir);
        group.lookAt(lookTarget);

        // Tag the projectile with the current weapon's damage so updateProjectiles
        // applies the right impact value when it hits an enemy.
        const w = this.getCurrentWeapon();
        const buff = 1 + (this.powerUps && this.powerUps.weaponBuff ? this.powerUps.weaponBuff * (this.WEAPON_BUFF_PER_STACK || 0.2) : 0);
        const projDamage = w ? Math.max(1, Math.floor((w.damage || 1) * buff)) : 1;

        // Expose the visual core as the "main" mesh for spawnPickupCollectFx etc.
        group.userData = { dir: dir.clone().normalize(), ttl: 3, radius: 0.2, bounces: 0, damage: projDamage, _core: core, _tracer: tracer };
        // For collision math the rest of the code reads `userData.radius`, so a Group is fine.
        this.scene.add(group);
        this.playMode.projectiles.push(group);
    }

    updateProjectiles(deltaTime) {
        if (this.playMode.projectiles.length === 0) return;
        const speed = this.playMode.projectileSpeed;
        for (let i = this.playMode.projectiles.length - 1; i >= 0; i--) {
            const p = this.playMode.projectiles[i];
            // Move and test wall collisions (AABB vs sphere)
            const prevPos = p.position.clone();
            const step = p.userData.dir.clone().multiplyScalar(speed * deltaTime);
            const nextPos = prevPos.clone().add(step);
            let collidedWall = null;
            for (const w of this.walls) {
                const wp = w.position; const s = w.size; const r = p.userData.radius;
                if (nextPos.x + r > wp.x - s.x/2 && nextPos.x - r < wp.x + s.x/2 &&
                    nextPos.y + r > wp.y - s.y/2 && nextPos.y - r < wp.y + s.y/2 &&
                    nextPos.z + r > wp.z - s.z/2 && nextPos.z - r < wp.z + s.z/2) {
                    collidedWall = w;
                    break;
                }
            }
            if (collidedWall) {
                this.spawnImpact(nextPos);

                const data = p.userData;
                if ((data.bounces || 0) >= 2) {
                    this.scene.remove(p);
                    this.playMode.projectiles.splice(i, 1);
                    continue;
                }

                const r = data.radius;
                const wall = collidedWall;
                const overlaps = [];
                const center = wall.position;
                const half = { x: wall.size.x / 2 + r, y: wall.size.y / 2 + r, z: wall.size.z / 2 + r };

                const diffX = nextPos.x - center.x;
                const overlapX = half.x - Math.abs(diffX);
                if (overlapX >= 0) overlaps.push({ axis: 'x', value: overlapX });

                const diffY = nextPos.y - center.y;
                const overlapY = half.y - Math.abs(diffY);
                if (overlapY >= 0) overlaps.push({ axis: 'y', value: overlapY });

                const diffZ = nextPos.z - center.z;
                const overlapZ = half.z - Math.abs(diffZ);
                if (overlapZ >= 0) overlaps.push({ axis: 'z', value: overlapZ });

                overlaps.sort((a, b) => a.value - b.value);
                const primary = overlaps.length ? overlaps[0].axis : null;

                if (primary === 'x') {
                    data.dir.x *= -1;
                } else if (primary === 'y') {
                    data.dir.y *= -1;
                } else if (primary === 'z') {
                    data.dir.z *= -1;
                } else {
                    data.dir.multiplyScalar(-1);
                }

                data.dir.normalize();
                data.bounces = (data.bounces || 0) + 1;

                const eps = 0.001;
                p.position.copy(prevPos);
                if (primary === 'x') {
                    const sign = diffX >= 0 ? 1 : -1;
                    p.position.x = center.x + sign * (wall.size.x / 2 + r + eps);
                } else if (primary === 'y') {
                    const sign = diffY >= 0 ? 1 : -1;
                    p.position.y = center.y + sign * (wall.size.y / 2 + r + eps);
                } else if (primary === 'z') {
                    const sign = diffZ >= 0 ? 1 : -1;
                    p.position.z = center.z + sign * (wall.size.z / 2 + r + eps);
                } else {
                    p.position.add(data.dir.clone().multiplyScalar(r + eps));
                }

                p.position.add(data.dir.clone().multiplyScalar(Math.min(step.length(), 0.01)));
                continue;
            }
            p.position.copy(nextPos);
            // Keep tracer aligned with current direction
            if (p.lookAt) {
                p.lookAt(p.position.clone().add(p.userData.dir));
            }
            p.userData.ttl -= deltaTime;
            // Check collision with enemies (vertical cylinder around the model)
            for (let j = this.playMode.enemies.length - 1; j >= 0; j--) {
                const e = this.playMode.enemies[j];
                const r = e.userData.hitRadius || 0.6;
                const h = e.userData.hitHeight || 1.5;
                const dx = p.position.x - e.position.x;
                const dz = p.position.z - e.position.z;
                const dy = p.position.y - e.position.y;
                if (dx*dx + dz*dz < r*r && dy >= -0.1 && dy <= h + 0.1) {
                    // Hit enemy: apply weapon damage and impact.
                    const dmg = (p.userData.damage != null) ? p.userData.damage : 1;
                    e.userData.hp -= dmg;
                    this.spawnImpact(p.position.clone(), 0xff5533);
                    this.audio && this.audio.play('bulletHit');
                    this.scene.remove(p);
                    this.playMode.projectiles.splice(i, 1);
                    if (e.userData.hp <= 0) {
                        this.killEnemy(e);
                    } else {
                        this.applyEnemyKnockback(e, p.position, 8);
                        this.flashEnemy(e);
                        this.showEnemyHPBar(e, 3.0);
                    }
                    break;
                }
            }
            // TTL expiry
            if (p.userData.ttl <= 0) {
                this.scene.remove(p);
                this.playMode.projectiles.splice(i, 1);
                continue;
            }
        }
    }

    spawnImpact(pos, color = 0x00ffff) {
        // Simple expanding ring that fades quickly
        const geo = new THREE.RingGeometry(0.1, 0.3, 16);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(geo, mat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(pos.x, 0.2, pos.z);
        this.scene.add(ring);
        const start = performance.now();
        const animateOnce = () => {
            const t = (performance.now() - start) / 200; // 200ms
            if (t >= 1) {
                this.scene.remove(ring);
                return;
            }
            ring.scale.set(1 + t * 2, 1 + t * 2, 1);
            mat.opacity = 0.8 * (1 - t);
            requestAnimationFrame(animateOnce);
        };
        requestAnimationFrame(animateOnce);
    }

    // ================= Enemy death =================
    killEnemy(e) {
        const idx = this.playMode.enemies.indexOf(e);
        if (idx === -1) return;
        const deathPos = e.position.clone();
        // Remove from the live AI list immediately so wandering/targeting stops,
        // but keep the mesh in the scene to play the topple+fade animation.
        this.playMode.enemies.splice(idx, 1);
        this.audio && this.audio.play('enemyDeath');
        this.spawnEnemyDeathFragments && this.spawnEnemyDeathFragments(deathPos, e.userData && e.userData.bodyColor);
        const isBoss = !!(e.userData && e.userData.isBoss);
        this.score = (this.score || 0) + (isBoss ? 200 : 10);
        this.kills = (this.kills || 0) + 1;
        // Arena: boss death triggers wave completion (lava recede + next wave)
        if (isBoss && this.arena && this.arena.active) {
            this.onArenaBossKilled();
        }
        // Skip the standard random drop for the boss — wave-complete drops are handled separately
        if (!isBoss && Math.random() < this.dropChance) {
            this.spawnPickup(deathPos.x, deathPos.z);
        }
        // Clone every material first — the GLTF is cloned via SkeletonUtils, which
        // shares materials across all instances. Fading the shared mats would fade
        // every living enemy of the same kind. Per-mesh cloning isolates the fade.
        const fadeMats = [];
        e.traverse((child) => {
            if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(mat => {
                        const c = mat.clone();
                        c.transparent = true;
                        if (c.opacity == null) c.opacity = 1;
                        fadeMats.push(c);
                        return c;
                    });
                } else {
                    const c = child.material.clone();
                    c.transparent = true;
                    if (c.opacity == null) c.opacity = 1;
                    child.material = c;
                    fadeMats.push(c);
                }
            }
        });
        if (e.userData.hpBar) e.userData.hpBar.visible = false;
        e.userData.dying = true;
        e.userData.deathT = 0;
        e.userData.fadeMats = fadeMats;
        e.userData.toppleDur = 0.55;
        e.userData.holdDur = 1.2;
        e.userData.fadeDur = 1.4;
        // Stop ticking the death-target's stun/knockback/animation
        e.userData.knockback = null;
        e.userData.stunT = 0;
        if (!this.playMode.dyingEnemies) this.playMode.dyingEnemies = [];
        this.playMode.dyingEnemies.push(e);
    }

    updateDyingEnemies(deltaTime) {
        const list = this.playMode.dyingEnemies;
        if (!list || !list.length) return;
        for (let i = list.length - 1; i >= 0; i--) {
            const e = list[i];
            const ud = e.userData;
            ud.deathT += deltaTime;
            // Topple forward to lie face-down over toppleDur (ease-out cubic)
            const tT = Math.min(1, ud.deathT / ud.toppleDur);
            const ease = 1 - Math.pow(1 - tT, 3);
            e.rotation.x = (Math.PI / 2) * ease;
            // Drop the body a touch as it lands, so the model rests on the ground
            const drop = 0.4 * ease;
            if (ud.baseY == null) ud.baseY = e.position.y;
            e.position.y = Math.max(0, ud.baseY - drop);
            // Hold, then fade
            const fadeStart = ud.toppleDur + ud.holdDur;
            if (ud.deathT > fadeStart) {
                const fT = Math.min(1, (ud.deathT - fadeStart) / ud.fadeDur);
                const opacity = 1 - fT;
                ud.fadeMats.forEach(m => { m.opacity = opacity; });
                if (fT >= 1) {
                    this.playMode.enemiesGroup.remove(e);
                    ud.fadeMats.forEach(m => m.dispose && m.dispose());
                    list.splice(i, 1);
                }
            }
        }
    }

    // ================= Pickups =================
    spawnPickup(x, z) {
        // Weighted random pick from ITEM_DEFS
        const entries = Object.entries(this.ITEM_DEFS);
        const total = entries.reduce((s, [, d]) => s + (d.weight || 1), 0);
        let roll = Math.random() * total;
        let type = entries[0][0];
        for (const [k, def] of entries) {
            roll -= (def.weight || 1);
            if (roll <= 0) { type = k; break; }
        }
        const def = this.ITEM_DEFS[type];

        // Build a group so we can attach a glow ring + point light alongside the visual.
        const group = new THREE.Group();
        const mesh = this._buildPickupMesh(type, def);
        group.add(mesh);

        // Ground glow ring (additive flat disc)
        const ringGeo = new THREE.RingGeometry(0.45, 0.8, 24);
        const ringMat = new THREE.MeshBasicMaterial({
            color: def.color, transparent: true, opacity: 0.45,
            blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -0.55;
        group.add(ring);

        // Subtle point light to make the pickup pop in dark areas
        const light = new THREE.PointLight(def.color, 0.7, 4, 2);
        light.position.set(0, 0.2, 0);
        group.add(light);

        group.position.set(x, 0.6, z);
        group.userData = { type: 'pickup', t: 0, item: { type }, glowRing: ring, glowLight: light, visual: mesh };
        // Reuse `material`/`geometry` for collectFx via aliasing
        group.material = mesh.material;
        group.geometry = mesh.geometry;
        this.pickupsGroup.add(group);
        this.pickups.push(group);
    }

    _buildPickupMesh(type, def) {
        // Item-specific shapes. Falls back to icosahedron.
        const matEmissive = 0x2a1808;
        switch (type) {
            case 'health': {
                // Red cross — two boxes
                const grp = new THREE.Group();
                const matH = new THREE.MeshLambertMaterial({ color: 0xff3344, emissive: 0x441010 });
                const horiz = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.18), matH);
                const vert = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.18), matH);
                grp.add(horiz); grp.add(vert);
                grp.material = matH;
                grp.geometry = horiz.geometry;
                grp.castShadow = true;
                return grp;
            }
            case 'ammo': {
                // Brass bullet
                const grp = new THREE.Group();
                const brass = new THREE.MeshLambertMaterial({ color: 0xddbb55, emissive: 0x3a2a08 });
                const lead = new THREE.MeshLambertMaterial({ color: 0xaaaaaa, emissive: 0x222222 });
                const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.4, 12), brass);
                const tip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.22, 12), lead);
                tip.position.y = 0.31;
                grp.add(body); grp.add(tip);
                grp.rotation.z = Math.PI / 2;
                grp.material = brass;
                grp.geometry = body.geometry;
                return grp;
            }
            case 'flag': {
                const grp = new THREE.Group();
                const pole = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6),
                    new THREE.MeshLambertMaterial({ color: 0x886633, emissive: 0x221608 })
                );
                const flag = new THREE.Mesh(
                    new THREE.PlaneGeometry(0.4, 0.28),
                    new THREE.MeshLambertMaterial({ color: def.color || 0xff5577, emissive: 0x331010, side: THREE.DoubleSide })
                );
                flag.position.set(0.22, 0.28, 0);
                grp.add(pole); grp.add(flag);
                grp.material = flag.material;
                grp.geometry = flag.geometry;
                return grp;
            }
            default: {
                const geo = new THREE.IcosahedronGeometry(0.35, 0);
                const mat = new THREE.MeshLambertMaterial({
                    color: def && def.color || 0xffd28a,
                    emissive: 0x3a2008,
                    emissiveIntensity: 1.0
                });
                const m = new THREE.Mesh(geo, mat);
                m.castShadow = true;
                return m;
            }
        }
    }

    updatePickups(deltaTime) {
        if (!this.pickups || !this.pickups.length) return;
        const collectR2 = 1.2 * 1.2;
        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const p = this.pickups[i];
            p.userData.t += deltaTime;
            // Bob and rotate
            p.rotation.y += deltaTime * 2;
            p.position.y = 0.6 + Math.sin(p.userData.t * 4) * 0.1;
            // Check collect (add to inventory, do not auto-activate)
            const d2 = p.position.distanceToSquared(this.player.position);
            if (d2 < collectR2) {
                this.spawnPickupCollectFx && this.spawnPickupCollectFx(p);
                this.pickupsGroup.remove(p);
                this.pickups.splice(i, 1);
                if (p.userData.item) {
                    const item = p.userData.item;
                    const def = this.ITEM_DEFS[item.type];
                    item.label = this.itemLabel(item.type); // for HUD list
                    if (def && def.autoApply) {
                        // Stat-based pickups (jetpack fuel, ammo, flags) stack
                        // straight into the pool — no bag entry to click.
                        def.apply();
                        this.updateInventoryGridUI && this.updateInventoryGridUI();
                    } else {
                        this.inventory.items.push(item);
                        this._qbSig = null;
                        this.updateInventoryGridUI && this.updateInventoryGridUI();
                        if (this.isDrawerOpen) this.updateDrawerUI();
                    }
                    this.spawnImpact(p.position.clone(), 0x66ffcc);
                    this.showMessage(`Picked up: ${item.label}`);
                    this.showToast(this.pickupToast(item.type), 'success');
                    if (this.audio) {
                        const t = item.type;
                        if (t === 'health') this.audio.play('pickupHealth');
                        else if (t === 'ammo') this.audio.play('pickupAmmo');
                        else if (t === 'flag') this.audio.play('pickupFlag');
                        else this.audio.play('pickupPowerup');
                    }
                }
            }
        }
    }

    // ===== Jetpack System =====
    createJetpackParticles() {
        if (!this.isJetpackActive || this.jetpackThrust < 0.1) return;
        
        // Create particles below the player
        const particleCount = Math.floor(this.jetpackThrust * 8);
        for (let i = 0; i < particleCount; i++) {
            const particle = new THREE.Mesh(
                new THREE.SphereGeometry(0.1, 4, 4),
                new THREE.MeshBasicMaterial({ 
                    color: new THREE.Color().setHSL(0.1 + Math.random() * 0.1, 1, 0.6),
                    transparent: true,
                    opacity: 0.8
                })
            );
            
            // Position below player with some randomness
            particle.position.set(
                this.player.position.x + (Math.random() - 0.5) * 2,
                this.player.position.y - 1,
                this.player.position.z + (Math.random() - 0.5) * 2
            );
            
            // Add velocity
            particle.userData = {
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 4,
                    -Math.random() * 8 - 2,
                    (Math.random() - 0.5) * 4
                ),
                life: 1.0,
                maxLife: 1.0
            };
            
            this.scene.add(particle);
            this.jetpackParticles.push(particle);
        }
    }
    
    updateJetpackParticles(deltaTime) {
        for (let i = this.jetpackParticles.length - 1; i >= 0; i--) {
            const particle = this.jetpackParticles[i];
            const userData = particle.userData;
            
            // Update position
            particle.position.add(userData.velocity.clone().multiplyScalar(deltaTime));
            
            // Update life
            userData.life -= deltaTime * 2;
            particle.material.opacity = userData.life;
            
            // Remove dead particles
            if (userData.life <= 0) {
                this.scene.remove(particle);
                this.jetpackParticles.splice(i, 1);
            }
        }
    }
    
    // ===== Item Activation =====
    // Create 32-bit style icons for inventory items
    createItemIcon(type, size = 24) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // 32-bit style: pixelated, limited colors
        ctx.imageSmoothingEnabled = false;
        
        switch (type) {
            case 'health':
                // Heart icon
                ctx.fillStyle = '#ff6666';
                ctx.fillRect(8, 4, 8, 8);
                ctx.fillRect(6, 6, 12, 8);
                ctx.fillRect(4, 8, 16, 6);
                ctx.fillRect(6, 10, 12, 4);
                ctx.fillRect(8, 12, 8, 2);
                break;
                
            case 'ammo':
                // Military crosshair/target icon
                ctx.fillStyle = '#ffff66';
                ctx.fillRect(10, 2, 4, 20);
                ctx.fillRect(2, 10, 20, 4);
                ctx.fillRect(8, 8, 8, 8);
                ctx.fillStyle = '#000000';
                ctx.fillRect(10, 10, 4, 4);
                break;
                
            case 'speed':
                // Arrow up icon
                ctx.fillStyle = '#66ccff';
                ctx.fillRect(10, 16, 4, 6);
                ctx.fillRect(6, 12, 12, 4);
                ctx.fillRect(8, 8, 8, 4);
                ctx.fillRect(10, 4, 4, 4);
                break;
                
            case 'jetpack':
                // Jetpack icon (rocket/arrow up with flames)
                ctx.fillStyle = '#ffaa66';
                ctx.fillRect(10, 4, 4, 12);
                ctx.fillRect(8, 16, 8, 4);
                ctx.fillStyle = '#ff6666';
                ctx.fillRect(6, 18, 12, 2);
                ctx.fillRect(8, 20, 8, 2);
                break;
                
            case 'flag':
                // Flag icon
                ctx.fillStyle = '#ff66aa';
                ctx.fillRect(4, 4, 2, 16);
                ctx.fillRect(6, 4, 12, 8);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(8, 6, 8, 2);
                ctx.fillRect(8, 8, 8, 2);
                break;
        }
        
        return canvas.toDataURL();
    }

    // Consume one stack of `itemId` from the player's inventory and apply it.
    // autoApply pickups (ammo/jetpack/flag) don't sit in items, so we just
    // surface a hint when the player clicks them in the quickbar.
    activateSelectedItem(itemId) {
        if (!itemId) return;
        const def = this.ITEM_DEFS[itemId];
        if (!def) return;

        if (def.autoApply) {
            this.showMessage(`${this.itemLabel(itemId)} (auto)`);
            return;
        }

        const items = this.inventory.items;
        const idx = items.findIndex(i => i.type === itemId);
        if (idx === -1) {
            this.showMessage(`No ${this.t(def.labelKey)} stacks available`);
            return;
        }

        def.apply();
        this.showMessage(this.itemLabel(itemId));
        this.showToast(this.pickupToast(itemId), 'success');

        items.splice(idx, 1);
        this._qbSig = null;
        this.updateInventoryGridUI && this.updateInventoryGridUI();
        if (this.isDrawerOpen) this.updateDrawerUI();
    }

    placeFlagAtPlayer() {
        if (this.inventory.flags <= 0) {
            this.showMessage('No flags available');
            return false;
        }

        const flagGroup = new THREE.Group();

        // Flag pole
        const poleGeometry = new THREE.CylinderGeometry(0.08, 0.08, 3, 12);
        const poleMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222 });
        const pole = new THREE.Mesh(poleGeometry, poleMaterial);
        pole.castShadow = true;
        pole.receiveShadow = true;
        pole.position.y = 1.5;
        flagGroup.add(pole);

        // Flag banner
        const bannerGeometry = new THREE.PlaneGeometry(1.2, 0.8);
        const bannerMaterial = new THREE.MeshLambertMaterial({ color: 0xff3366, emissive: 0x330011, side: THREE.DoubleSide });
        const banner = new THREE.Mesh(bannerGeometry, bannerMaterial);
        banner.castShadow = true;
        banner.position.set(0.6, 1.8, 0);
        banner.rotation.y = Math.PI / 2;
        flagGroup.add(banner);

        // Flag base
        const baseGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12);
        const baseMaterial = new THREE.MeshLambertMaterial({ color: 0x333333, emissive: 0x111111 });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.receiveShadow = true;
        base.position.y = 0.1;
        flagGroup.add(base);

        // Position flag at player's location with slight forward offset
        const placement = this.player.position.clone();
        const forward = new THREE.Vector3(Math.sin(this.characterRotation || 0), 0, Math.cos(this.characterRotation || 0));
        placement.add(forward.multiplyScalar(0.6));
        flagGroup.position.copy(placement);
        flagGroup.rotation.y = this.characterRotation || 0;

        flagGroup.userData = {
            highlighted: false,
            meshes: { pole, banner, base },
            original: {
                poleColor: poleMaterial.color.clone(),
                poleEmissive: poleMaterial.emissive.clone(),
                bannerColor: bannerMaterial.color.clone(),
                bannerEmissive: bannerMaterial.emissive.clone(),
                baseColor: baseMaterial.color.clone(),
                baseEmissive: baseMaterial.emissive.clone(),
                scale: flagGroup.scale.clone()
            }
        };

        this.scene.add(flagGroup);
        this.placedFlags.push(flagGroup);

        this.inventory.flags = Math.max(0, this.inventory.flags - 1);
        this._qbSig = null;
        this.updateInventoryGridUI && this.updateInventoryGridUI();
        if (this.isDrawerOpen) this.updateDrawerUI();
        this.updateControlsUI();
        this.showToast('🏁 Flag placed', 'success');
        if (this.inventory.flags > 0) {
            this.showMessage(`${this.t('flagsCount')}: ${this.inventory.flags} - Press F to place`);
        } else {
            this.showMessage(`${this.t('flagsCount')}: ${this.inventory.flags}`);
        }
        this.updateFlagHighlights();
        return true;
    }

    removeNearestFlag() {
        if (!this.placedFlags || this.placedFlags.length === 0) {
            this.showMessage('No flags placed');
            return false;
        }

        let nearest = null;
        let nearestDistSq = Infinity;
        const playerPos = this.player.position.clone();

        this.placedFlags.forEach(flag => {
            if (!flag || !flag.position) return;
            const distSq = flag.position.distanceToSquared(playerPos);
            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = flag;
            }
        });

        if (!nearest || nearestDistSq > this.flagRemoveRadiusSq) {
            this.showMessage('Move closer to a flag to remove it');
            return false;
        }

        this.setFlagHighlight(nearest, false);
        if (nearest.parent) {
            nearest.parent.remove(nearest);
        }

        const idx = this.placedFlags.indexOf(nearest);
        if (idx !== -1) {
            this.placedFlags.splice(idx, 1);
        }

        this.inventory.flags += 1;
        this._qbSig = null;
        this.updateInventoryGridUI && this.updateInventoryGridUI();
        if (this.isDrawerOpen) this.updateDrawerUI();
        this.updateControlsUI();
        this.showToast('🏳️ Flag removed', 'info');
        this.showMessage(`${this.t('flagsCount')}: ${this.inventory.flags} - Press F to place`);
        this.updateFlagHighlights();
        return true;
    }

    setFlagHighlight(flag, enabled) {
        if (!flag || !flag.userData || !flag.userData.meshes) return;
        const state = flag.userData;
        if (state.highlighted === enabled) return;

        const { meshes } = state;
        state.original = state.original || {};
        const { original } = state;

        if (!state.original.scale) {
            state.original.scale = flag.scale.clone();
        }
        if (meshes.banner && meshes.banner.material) {
            if (!original.bannerColor) original.bannerColor = meshes.banner.material.color.clone();
            if (!original.bannerEmissive) original.bannerEmissive = meshes.banner.material.emissive.clone();
        }
        if (meshes.pole && meshes.pole.material) {
            if (!original.poleEmissive) original.poleEmissive = meshes.pole.material.emissive.clone();
        }
        if (meshes.base && meshes.base.material) {
            if (!original.baseEmissive) original.baseEmissive = meshes.base.material.emissive.clone();
        }
        if (enabled) {
            if (meshes.banner && meshes.banner.material) {
                meshes.banner.material.color.setHex(0xffff66);
                meshes.banner.material.emissive.setHex(0xffaa00);
            }
            if (meshes.pole && meshes.pole.material) {
                meshes.pole.material.emissive.setHex(0xffffff);
            }
            if (meshes.base && meshes.base.material) {
                meshes.base.material.emissive.setHex(0xffaa00);
            }
            flag.scale.set(1.1, 1.1, 1.1);
        } else {
            if (meshes.banner && meshes.banner.material) {
                if (original.bannerColor) meshes.banner.material.color.copy(original.bannerColor);
                if (original.bannerEmissive) meshes.banner.material.emissive.copy(original.bannerEmissive);
            }
            if (meshes.pole && meshes.pole.material && original.poleEmissive) {
                meshes.pole.material.emissive.copy(original.poleEmissive);
            }
            if (meshes.base && meshes.base.material && original.baseEmissive) {
                meshes.base.material.emissive.copy(original.baseEmissive);
            }
            if (original.scale) {
                flag.scale.copy(original.scale);
            } else {
                flag.scale.set(1, 1, 1);
            }
        }

        state.highlighted = enabled;
    }

    updateFlagHighlights() {
        if (!this.placedFlags || this.placedFlags.length === 0) {
            return;
        }

        const playerPos = this.player.position.clone();
        let nearest = null;
        let nearestDistSq = Infinity;

        this.placedFlags.forEach(flag => {
            if (!flag || !flag.position) {
                return;
            }
            const distSq = flag.position.distanceToSquared(playerPos);
            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = flag;
            }
        });

        const withinRange = nearest && this.gameMode === 'play' && nearestDistSq <= this.flagRemoveRadiusSq && !this.modalOpen && !this.isDrawerOpen;

        this.placedFlags.forEach(flag => {
            const shouldHighlight = withinRange && flag === nearest;
            this.setFlagHighlight(flag, shouldHighlight);
        });
    }

    getCreateModePerimeterSpawn() {
        // Left-edge midpoint of the create grid, facing +X into the grid
        const gridSize = this.createMode.gridSize;
        const midZ = Math.floor(gridSize / 2);
        const world = this.getWorldPositionFromGrid(0, midZ);
        return { x: world.x, z: world.z, facingY: Math.PI / 2 };
    }
    
    
    
    createSkybox() {
        const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
        const skyMaterial = new THREE.MeshBasicMaterial({ color: 0x000011, side: THREE.BackSide });
        const sky = new THREE.Mesh(skyGeometry, skyMaterial);
        this.scene.add(sky);
        this.sky = sky;
    }

    applyTheme(name) {
        // Desert is the only theme. `name` arg kept for call-site compatibility.
        const t = this.themes.desert;
        this.themeName = 'desert';
        if (this.ground && this.ground.material) this.ground.material.color.setHex(t.ground);
        if (this.gridHelper && this.gridHelper.material && this.gridHelper.material.color) {
            this.gridHelper.material.color.setHex(t.grid);
        }
        if (this.sky && this.sky.material) this.sky.material.color.setHex(t.sky);
        if (this.ambientLight) this.ambientLight.color.setHex(t.ambient);
        if (this.directionalLight) this.directionalLight.color.setHex(t.sun);
        this.materials = this.materials || {};
        this.materials.wall = new THREE.MeshLambertMaterial({
            color: t.wall,
            emissive: t.wallEmissive,
            transparent: true,
            opacity: 0.95
        });
        if (this.walls && this.walls.length) this.rebuildMaze();
    }
    
    setupLighting() {
        const t = this.themes.desert;
        const ambientLight = new THREE.AmbientLight(t.ambient, 1.8);
        this.scene.add(ambientLight);
        this.ambientLight = ambientLight;

        // Directional light (desert sun) — warm and bright
        const directionalLight = new THREE.DirectionalLight(t.sun, 2.4);
        directionalLight.position.set(50, 50, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 1024;
        directionalLight.shadow.mapSize.height = 1024;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 200;
        directionalLight.shadow.camera.left = -50;
        directionalLight.shadow.camera.right = 50;
        directionalLight.shadow.camera.top = 50;
        directionalLight.shadow.camera.bottom = -50;
        this.scene.add(directionalLight);
        this.directionalLight = directionalLight;
    }
    
    shouldBlockInput(event) {
        // Block input when modals/inputs are focused
        if (this.isDrawerOpen) {
            // Allow drawer-specific keys
            const allowedKeys = ['KeyM', 'Escape', 'Tab', 'Enter', 'ArrowUp', 'ArrowDown', 'KeyV', 'KeyG'];
            return !allowedKeys.includes(event.code);
        }
        
        // Block input when settings modal is open
        if (this.modalOpen) {
            // Allow modal-specific keys
            const allowedKeys = ['Escape', 'KeyP', 'KeyV', 'KeyG'];
            return !allowedKeys.includes(event.code);
        }
        
        // Block input when toolbox modal is open (create mode)
        if (this.gameMode === 'create' && this.toolboxModalOpen) {
            // Allow modal-specific keys
            const allowedKeys = ['Escape', 'KeyT', 'KeyV', 'KeyG'];
            return !allowedKeys.includes(event.code);
        }
        
        // Block weapon switching keys (1-9) when not in play mode
        if (event.code >= 'Digit1' && event.code <= 'Digit9') {
            if (this.gameMode !== 'play') {
                return true;
            }
        }
        
        // Block input when game is not in play mode (except for specific keys)
        if (this.gameMode !== 'play') {
            const allowedKeys = [
                'KeyP', 'Escape', 'ArrowLeft', 'ArrowRight', 'Digit1', 'Digit3', // Settings and maze switching
                'KeyT', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'KeyV', 'KeyG' // Create mode tools & view toggles
            ];
            return !allowedKeys.includes(event.code);
        }
        
        return false;
    }
    
    setupEventListeners() {
        // Keyboard events
        document.addEventListener('keydown', (event) => {
            this.keys[event.code] = true;
            
            // Debug: Log all key presses
            if (event.code === 'KeyV') {
            }
            
            // Comprehensive input blocking system
            if (this.shouldBlockInput(event)) {
                return;
            }
            
            // Track SHIFT key for create mode
            if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
                if (this.gameMode === 'create') {
                    this.createMode.isShiftHeld = true;
                }
            }
            
            // Control scheme switching — disabled: Digit1/Digit3 are quickbar slots in play mode.
            // Use the settings modal (P) to change control scheme.


            // Maze switching controls
            if (event.code === 'ArrowLeft') {
                this.switchMaze((this.currentMazeIndex - 1 + this.savedMazes.length) % this.savedMazes.length);
            }
            if (event.code === 'ArrowRight') {
                this.switchMaze((this.currentMazeIndex + 1) % this.savedMazes.length);
            }
            
            // Open settings modal with P key
            if (event.code === 'KeyP') {
                this.toggleSettingsModal();
            }
            
            // Close drawer with ESC
            if (event.code === 'Escape' && this.isDrawerOpen) {
                this.isDrawerOpen = false;
                this.hideDrawerCursor();
                this.updateDrawerUI();
            }
            
            // Open drawer with M key
            if (event.code === 'KeyM') {
                this.toggleMoreDrawer();
            }
            
            // Open toolbox modal with T key (create mode only)
            if (event.code === 'KeyT' && this.gameMode === 'create') {
                this.toggleToolboxModal();
            }
            
            // Weapon switching is now handled by selectGridItemByShortcut()
            
            // Q and E for tank controls (scheme 3) or create mode tools
            if (this.gameMode === 'create' && !this.modalOpen) {
                // Create mode: Q for wall, E for erase
                if (event.code === 'KeyQ') {
                    this.setCreateTool('wall');
                }
                if (event.code === 'KeyE') {
                    this.setCreateTool('erase');
                }
            } else if (this.controlScheme === 3) {
                // Tank controls: Q and E for turning
                if (event.code === 'KeyE') {
                    this.characterRotation -= Math.PI / 2; // 90 degrees left
                }
                if (event.code === 'KeyQ') {
                    this.characterRotation += Math.PI / 2; // 90 degrees right
                }
            }
            
            // Command: cycle camera angle (isometric only)
            if (event.code === 'MetaLeft' || event.code === 'MetaRight') {
                event.preventDefault();
                if (this.viewMode !== 'fpv') {
                    this.cycleCameraAngle();
                }
            }

            // Toggle isometric orbit with O in play mode
            if (event.code === 'KeyO' && this.gameMode === 'play') {
                // Disable orbit in FPV; only allowed in isometric view
                if (this.viewMode !== 'fpv') {
                    this.playMode.orbitEnabled = !this.playMode.orbitEnabled;
                    this.playMode.lastMouseX = null;
                }
            }

            // Toggle between first-person and second-person (iso) only
            if (event.code === 'KeyV' && !event.repeat) {
                this.setViewMode(this.viewMode === 'fpv' ? 'iso' : 'fpv');
            }

            // Place flag in play mode or fall back to indicator toggle
            if (event.code === 'KeyF' && !event.repeat) {
                const canPlaceFlag = this.gameMode === 'play' && !this.modalOpen && !this.isDrawerOpen;
                if (canPlaceFlag) {
                    const placed = this.placeFlagAtPlayer();
                    if (placed) {
                        return;
                    }
                }

                this.facingIndicator.enabled = !this.facingIndicator.enabled;
                if (this.facingIndicator.groundDot) this.facingIndicator.groundDot.visible = this.facingIndicator.enabled;
                if (this.facingIndicator.light) this.facingIndicator.light.visible = this.facingIndicator.enabled;
                this.modelYawOffset = (this.modelYawOffset + Math.PI) % (Math.PI * 2);
                return;
            }

            if (event.code === 'KeyG' && !event.repeat) {
                const canRemoveFlag = this.gameMode === 'play' && !this.modalOpen && !this.isDrawerOpen;
                if (canRemoveFlag) {
                    const removed = this.removeNearestFlag();
                    if (removed) {
                        return;
                    }
                }
                this.showMessage('No flags to remove');
                return;
            }

            // Test crosshair visibility (temporary)
            if (event.code === 'KeyC') {
                const testCrosshair = document.getElementById('crosshair');
                if (testCrosshair) {
                    testCrosshair.style.display = 'block';
                }
            }
            
            // Reload weapon
            if (event.code === 'KeyR') {
                this.reloadWeapon();
            }
            
            // Grid item shortcuts (1-9)
            if (event.code >= 'Digit1' && event.code <= 'Digit9') {
                const shortcut = event.code.replace('Digit', '');
                this.selectGridItemByShortcut(shortcut);
            }

            // Reset view/spawn if things go off-screen
            if (event.code === 'KeyT') {
                // Exit pointer lock for clarity
                if (document.pointerLockElement) document.exitPointerLock();
                this.setViewMode('iso');
                this.currentCameraAngle = 0;
                this.playMode.mouseNDC.set(0, 0);
                // Prefer labyrinth start if available
                const cur = this.savedMazes[this.currentMazeIndex];
                if (cur && cur.type === 'labyrinth' && this.levelStartWorld) {
                    this.player.position.copy(this.levelStartWorld);
                } else {
                    this.player.position.set(0, 0, 0);
                }
                this.characterRotation = 0;
                // Nudge camera immediately
                this.updateCamera();
            }

            // Runtime model yaw alignment helpers
            if (event.code === 'KeyY') {
                // Rotate model yaw offset +90°
                this.modelYawOffset = (this.modelYawOffset + Math.PI / 2) % (Math.PI * 2);
            }
            if (event.code === 'KeyU') {
                // Rotate model yaw offset -90°
                this.modelYawOffset = (this.modelYawOffset - Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
            }
        });
        
        document.addEventListener('keyup', (event) => {
            this.keys[event.code] = false;
            
            // Track SHIFT key release for create mode
            if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
                if (this.gameMode === 'create') {
                    this.createMode.isShiftHeld = false;
                    this.createMode.startLinePos = null; // Reset line start
                }
            }
            
            // No special handling needed on space release now
        });
        
        // Mouse events - behavior depends on control scheme
        document.addEventListener('mousemove', (event) => {
            // Block mouse input when drawer is open
            if (this.isDrawerOpen) {
                return;
            }
            
            // Handle create mode preview
            if (this.gameMode === 'create' && !this.modalOpen) {
                this.handleCreateModeHover();
                // Don't process other mouse events in create mode
                return;
            } else if (this.gameMode === 'play' && !this.modalOpen) {
                // Track mouse for aim/orbit. Use pointer lock deltas if locked; otherwise client coords.
                const canvas = document.getElementById('gameCanvas');
                const rect = canvas.getBoundingClientRect();
                if (this.isPointerLocked) {
                    const scaleX = 2 / rect.width;   // pixels -> NDC
                    const scaleY = 2 / rect.height;
                    this.playMode.mouseNDC.x = THREE.MathUtils.clamp(
                        this.playMode.mouseNDC.x + event.movementX * scaleX,
                        -1, 1
                    );
                    this.playMode.mouseNDC.y = THREE.MathUtils.clamp(
                        this.playMode.mouseNDC.y - event.movementY * scaleY,
                        -1, 1
                    );
                    // In FPV, mouse controls pitch directly
                    if (this.viewMode === 'fpv' && !this.playMode.orbitEnabled) {
                        this.fpvPitch = (this.fpvPitch || 0) - event.movementY * 0.0025;
                        // Yaw from mouse X
                        this.characterRotation -= event.movementX * this.fpvYawSensitivity;
                        const limit = Math.PI / 3; // ~60 degrees up/down
                        this.fpvPitch = Math.max(-limit, Math.min(limit, this.fpvPitch));
                    }
                    if (this.playMode.orbitEnabled && this.viewMode !== 'fpv') {
                        this.currentCameraAngle = (this.currentCameraAngle + event.movementX * 0.2) % 360;
                    }
                    // Ghost camera mouse look
                    if (this.viewMode === 'ghost') {
                        // Update yaw (Y rotation) and pitch (X rotation) separately
                        this.ghostCamera.rotation.y -= event.movementX * this.ghostCamera.mouseSensitivity;
                        this.ghostCamera.rotation.x -= event.movementY * this.ghostCamera.mouseSensitivity;
                        
                        // Clamp pitch to prevent over-rotation
                        this.ghostCamera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.ghostCamera.rotation.x));
                        
                        // Update quaternion from Euler angles (Y first, then X to avoid roll)
                        const quatY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.ghostCamera.rotation.y);
                        const quatX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.ghostCamera.rotation.x);
                        this.ghostCamera.quaternion.multiplyQuaternions(quatY, quatX);
                    }
                } else {
                    this.playMode.mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
                    this.playMode.mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
                    if (this.playMode.orbitEnabled && this.viewMode !== 'fpv') {
                        const lastX = this.playMode.lastMouseX;
                        if (lastX != null) {
                            const dx = event.clientX - lastX;
                            this.currentCameraAngle = (this.currentCameraAngle + dx * 0.2) % 360;
                        }
                        this.playMode.lastMouseX = event.clientX;
                    }
                }
                return;
            } else if (this.isPointerLocked && !this.modalOpen) {
                if (this.controlScheme === 1) {
                    // Scheme 1: Mouse controls character rotation
                    this.characterRotation -= event.movementX * 0.002;
                } else if (this.controlScheme === 2 && this.cameraMode === 'orbit') {
                    // Scheme 2: Mouse controls camera orbit only when Space is held
                    this.orbitMouseX += event.movementX * 0.002;
                    this.orbitMouseY += event.movementY * 0.002;
                    this.orbitMouseY = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.orbitMouseY));
                } else if (this.controlScheme === 4) {
                    // Scheme 4: Mouse controls character facing direction
                    this.mouse.x += event.movementX * 0.002;
                    this.mouse.y += event.movementY * 0.002;
                    this.mouse.y = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.mouse.y));
                    
                    // Character faces mouse direction
                    this.characterRotation = this.mouse.x;
                }
                // Scheme 3: No mouse control (tank controls)
            }
        });
        
        // Mouse down events
        document.addEventListener('mousedown', (event) => {
            // Block mouse input when drawer is open
            if (this.isDrawerOpen) {
                return;
            }
            
            if (this.gameMode === 'create' && !this.modalOpen) {
                this.createMode.isMouseDown = true;
                this.handleCreateModeClick(event);
            } else if (this.gameMode === 'play' && !this.modalOpen) {
                // Handle press-and-drag continuous move if holding button (optional)
                this.handlePlayClick(event);
                // Start continuous firing for machine gun
                if (event.button === 0) { // Left click
                    const weapon = this.getCurrentWeapon();
                    if (weapon && weapon.isContinuous) {
                        this.isFiring = true;
                    }
                }
            }
        });
        
        // Mouse up events
        document.addEventListener('mouseup', (event) => {
            // Block mouse input when drawer is open
            if (this.isDrawerOpen) {
                return;
            }
            
            if (this.gameMode === 'create' && !this.modalOpen) {
                this.createMode.isMouseDown = false;
                this.createMode.lastGridPos = null;
                this.createMode.startLinePos = null; // Reset line start
            } else if (this.gameMode === 'play' && !this.modalOpen) {
                // Stop continuous firing
                if (event.button === 0) { // Left click
                    this.isFiring = false;
                }
            }
        });
        
        // Click handler
        document.addEventListener('click', (event) => {
            // Drawer is a modal-ish overlay — don't grab pointer-lock or fire.
            if (this.isDrawerOpen) return;
            if (this.gameMode === 'create' && !this.modalOpen) {
                this.handleCreateModeClick(event);
            } else if (this.gameMode === 'play' && !this.modalOpen) {
                // On touch devices, the on-screen Fire button drives shooting — skip pointer lock entirely.
                if (this.isTouchDevice) return;
                // Ensure pointer lock; first click acquires lock instead of shooting
                if (!this.isPointerLocked) {
                    document.body.requestPointerLock();
                    return;
                }
                // Left click to shoot toward cursor / enemy
                this.handlePlayClick(event);
            }
        });

        // Right-click melee
        document.addEventListener('contextmenu', (e) => e.preventDefault());
        document.addEventListener('mousedown', (event) => {
            if (this.isDrawerOpen) return;
            if (this.gameMode === 'play' && !this.modalOpen && event.button === 2) {
                if (this.isTouchDevice) return;
                if (!this.isPointerLocked) {
                    document.body.requestPointerLock();
                    return;
                }
                this.handleMelee(event);
            }
        });
        
        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement === document.body;
            // If lock is re-acquired while the drawer is open (e.g. stray click
            // racing the drawer open), release it immediately so the cursor stays usable.
            if (this.isPointerLocked && this.isDrawerOpen) {
                document.exitPointerLock();
                document.body.style.cursor = 'default';
                return;
            }
            // Cursor visibility based on mode/lock
            if (this.isPointerLocked && this.gameMode === 'play') {
                document.body.style.cursor = 'none';
            } else if (this.gameMode === 'create') {
                document.body.style.cursor = 'crosshair';
            } else {
                document.body.style.cursor = 'default';
            }
            // Crosshair visibility: only in FPV during play
            const ch = document.getElementById('crosshair');
            if (ch) {
                ch.style.display = (this.gameMode === 'play' && this.viewMode === 'fpv') ? 'block' : 'none';
            }
        });
        
        // Window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
        
        // Mouse wheel for weapon switching
        document.addEventListener('wheel', (event) => {
            // Block wheel input when drawer is open
            if (this.isDrawerOpen) {
                return;
            }
            
            if (this.gameMode === 'play' && !this.modalOpen) {
                // Weapon switching with mouse wheel
                const direction = event.deltaY > 0 ? 1 : -1;
                this.switchWeapon(direction);
            }
        });

        this.setupTouchControls();
    }

    setupTouchControls() {
        const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
        if (!isTouch) return;
        this.isTouchDevice = true;
        document.body.classList.add('touch-device');

        // ---- Joystick (left thumb -> WASD) ----------------------------------
        const stick = document.getElementById('touch-joystick');
        const knob  = document.getElementById('touch-joystick-knob');
        const STICK_RADIUS = 60;
        const DEAD = 0.18;
        let stickTouchId = null;
        let stickCenter = { x: 0, y: 0 };

        const clearMoveKeys = () => {
            this.keys['KeyW'] = false;
            this.keys['KeyA'] = false;
            this.keys['KeyS'] = false;
            this.keys['KeyD'] = false;
        };
        const setMoveKeys = (nx, ny) => {
            this.keys['KeyW'] = ny < -DEAD;
            this.keys['KeyS'] = ny >  DEAD;
            this.keys['KeyA'] = nx < -DEAD;
            this.keys['KeyD'] = nx >  DEAD;
        };
        const moveKnob = (clientX, clientY) => {
            let dx = clientX - stickCenter.x;
            let dy = clientY - stickCenter.y;
            const len = Math.hypot(dx, dy);
            if (len > STICK_RADIUS) {
                const s = STICK_RADIUS / len;
                dx *= s; dy *= s;
            }
            knob.style.transform = `translate(${dx}px, ${dy}px)`;
            setMoveKeys(dx / STICK_RADIUS, dy / STICK_RADIUS);
        };

        stick.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const t = e.changedTouches[0];
            stickTouchId = t.identifier;
            const rect = stick.getBoundingClientRect();
            stickCenter.x = rect.left + rect.width / 2;
            stickCenter.y = rect.top + rect.height / 2;
            stick.classList.add('active');
            moveKnob(t.clientX, t.clientY);
        }, { passive: false });

        // ---- Look pad (right thumb -> aim / camera) -------------------------
        const look = document.getElementById('touch-look');
        let lookTouchId = null;
        let lookLast = { x: 0, y: 0 };
        const LOOK_FPV_YAW   = 0.005;
        const LOOK_FPV_PITCH = 0.005;
        const applyLookDelta = (dx, dy) => {
            if (this.modalOpen) return;
            if (this.gameMode !== 'play') return;
            if (this.viewMode === 'fpv') {
                this.fpvPitch = (this.fpvPitch || 0) - dy * LOOK_FPV_PITCH;
                this.characterRotation -= dx * LOOK_FPV_YAW;
                const limit = Math.PI / 3;
                this.fpvPitch = Math.max(-limit, Math.min(limit, this.fpvPitch));
            } else {
                const canvas = document.getElementById('gameCanvas');
                const rect = canvas.getBoundingClientRect();
                const sx = 2 / rect.width;
                const sy = 2 / rect.height;
                this.playMode.mouseNDC.x = THREE.MathUtils.clamp(
                    this.playMode.mouseNDC.x + dx * sx, -1, 1);
                this.playMode.mouseNDC.y = THREE.MathUtils.clamp(
                    this.playMode.mouseNDC.y - dy * sy, -1, 1);
                if (this.playMode.orbitEnabled) {
                    this.currentCameraAngle = (this.currentCameraAngle + dx * 0.2) % 360;
                }
            }
        };

        look.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const t = e.changedTouches[0];
            lookTouchId = t.identifier;
            lookLast.x = t.clientX;
            lookLast.y = t.clientY;
        }, { passive: false });

        // ---- Document-level touchmove / end dispatch ------------------------
        document.addEventListener('touchmove', (e) => {
            let consumed = false;
            for (const t of e.changedTouches) {
                if (t.identifier === stickTouchId) {
                    moveKnob(t.clientX, t.clientY);
                    consumed = true;
                } else if (t.identifier === lookTouchId) {
                    const dx = t.clientX - lookLast.x;
                    const dy = t.clientY - lookLast.y;
                    lookLast.x = t.clientX;
                    lookLast.y = t.clientY;
                    applyLookDelta(dx, dy);
                    consumed = true;
                }
            }
            if (consumed) e.preventDefault();
        }, { passive: false });

        const endTouch = (e) => {
            for (const t of e.changedTouches) {
                if (t.identifier === stickTouchId) {
                    stickTouchId = null;
                    knob.style.transform = '';
                    stick.classList.remove('active');
                    clearMoveKeys();
                }
                if (t.identifier === lookTouchId) {
                    lookTouchId = null;
                }
            }
        };
        document.addEventListener('touchend', endTouch);
        document.addEventListener('touchcancel', endTouch);

        // ---- Action buttons -------------------------------------------------
        const bindButton = (id, opts) => {
            const el = document.getElementById(id);
            if (!el) return;
            const down = (e) => {
                e.preventDefault();
                e.stopPropagation();
                el.classList.add('active');
                opts.onDown && opts.onDown();
            };
            const up = (e) => {
                e.preventDefault();
                e.stopPropagation();
                el.classList.remove('active');
                opts.onUp && opts.onUp();
            };
            el.addEventListener('touchstart',  down, { passive: false });
            el.addEventListener('touchend',    up,   { passive: false });
            el.addEventListener('touchcancel', up,   { passive: false });
            // Don't let synthesized clicks bubble to the document click handler.
            el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
        };

        // Synthetic event used by handlePlayClick / handleMelee — they read button & coords.
        const center = () => ({
            button: 0,
            clientX: window.innerWidth / 2,
            clientY: window.innerHeight / 2,
            preventDefault: () => {}, stopPropagation: () => {}
        });

        bindButton('touch-btn-fire', {
            onDown: () => {
                if (this.modalOpen || this.gameMode !== 'play') return;
                this.handlePlayClick(center());
                const w = this.getCurrentWeapon && this.getCurrentWeapon();
                if (w && w.isContinuous) this.isFiring = true;
            },
            onUp: () => { this.isFiring = false; }
        });
        bindButton('touch-btn-jump', {
            onDown: () => { this.keys['Space'] = true; },
            onUp:   () => { this.keys['Space'] = false; }
        });
        bindButton('touch-btn-melee', {
            onDown: () => {
                if (this.modalOpen || this.gameMode !== 'play') return;
                this.handleMelee({ button: 2 });
            }
        });
        bindButton('touch-btn-reload', {
            onDown: () => { if (!this.modalOpen) this.reloadWeapon(); }
        });
        bindButton('touch-btn-wprev', {
            onDown: () => { if (!this.modalOpen) this.switchWeapon(-1); }
        });
        bindButton('touch-btn-wnext', {
            onDown: () => { if (!this.modalOpen) this.switchWeapon(1); }
        });
        bindButton('touch-btn-view', {
            onDown: () => {
                if (this.modalOpen) return;
                this.setViewMode(this.viewMode === 'fpv' ? 'iso' : 'fpv');
            }
        });
        bindButton('touch-btn-menu', {
            onDown: () => { this.toggleSettingsModal(); }
        });

        // Suppress iOS double-tap zoom / long-press selection on the game area.
        document.addEventListener('gesturestart', (e) => e.preventDefault());
        document.addEventListener('dblclick',     (e) => e.preventDefault());
    }

    updatePlayer(deltaTime) {
        // Ghost camera movement
        if (this.viewMode === 'ghost') {
            this.updateGhostCamera(deltaTime);
            this.updateCamera();
            return;
        }
        
        // Block player movement when drawer is open
        if (this.isDrawerOpen) {
            return;
        }
        
        // Apply speed boost
        const speedMultiplier = 1 + (this.powerUps.speedBoost * 0.3); // 30% per stack
        const speed = 10 * speedMultiplier;
        const jumpForce = 15;
        const gravity = -30;
        
        // Build desired movement vector
        const direction = new THREE.Vector3();

        if (this.gameMode === 'play') {
            // WASD movement camera-relative; mouse aims character
            // Compute camera-aligned basis on XZ plane
            const camForward = new THREE.Vector3();
            this.camera.getWorldDirection(camForward);
            camForward.y = 0; camForward.normalize();
            // Right vector = forward x up (camera-relative)
            const up = new THREE.Vector3(0,1,0);
            const camRight = camForward.clone().cross(up).normalize();
            // Inputs
            let forwardIn = 0, strafeIn = 0;
            if (this.keys['KeyW']) forwardIn += 1;
            if (this.keys['KeyS']) forwardIn -= 1;
            if (this.keys['KeyD']) strafeIn += 1;
            if (this.keys['KeyA']) strafeIn -= 1;
            if (forwardIn !== 0 || strafeIn !== 0) {
                // Move in the camera's facing direction for W (away from camera)
                direction.add(camForward.clone().multiplyScalar(forwardIn));
                direction.add(camRight.clone().multiplyScalar(strafeIn));
            }
            // Mouse aim to ground point (isometric only)
            if (this.viewMode !== 'fpv') {
                const ray = new THREE.Raycaster();
                ray.setFromCamera(this.playMode.mouseNDC, this.camera);
                const ground = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
                const hit = new THREE.Vector3();
                if (ray.ray.intersectPlane(ground, hit)) {
                    const aim = new THREE.Vector3(hit.x - this.player.position.x, 0, hit.z - this.player.position.z);
                    if (aim.lengthSq() > 0.0001) {
                        const targetRot = Math.atan2(aim.x, aim.z);
                        // Smoothly rotate toward aim
                        const diff = ((targetRot - this.characterRotation + Math.PI) % (Math.PI*2)) - Math.PI;
                        const maxStep = this.playMode.rotateLerp * deltaTime;
                        const step = THREE.MathUtils.clamp(diff, -maxStep, maxStep);
                        this.characterRotation += step;
                    }
                }
            }
            // Normalize desired move direction
            if (direction.lengthSq() > 0) direction.normalize();
            // Compute desired horizontal velocity (with sprint)
            const moveSpeed = this.playMode.moveSpeed * ((this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? 1.8 : 1);
            const desiredVX = direction.x * moveSpeed;
            const desiredVZ = direction.z * moveSpeed;
            const curVX = this.player.velocity.x;
            const curVZ = this.player.velocity.z;
            const accel = (direction.lengthSq() > 0) ? this.playMode.accel : this.playMode.decel;
            const approach = (current, target, maxDelta) => {
                if (current < target) return Math.min(current + maxDelta, target);
                if (current > target) return Math.max(current - maxDelta, target);
                return current;
            };
            let newVX = approach(curVX, desiredVX, accel * deltaTime);
            let newVZ = approach(curVZ, desiredVZ, accel * deltaTime);
            
            // Axis-separated collision and movement for smoother sliding and wall-walking
            const pos = this.player.position.clone();
            
            // X axis movement
            let testPos = pos.clone();
            testPos.x += newVX * deltaTime;
            if (this.checkCollisionAxis(testPos, 'x')) {
                // X collision - try to slide along wall by checking if we can move in Z
                const slideTest = this.player.position.clone();
                slideTest.x = testPos.x;
                if (!this.checkCollision(slideTest)) {
                    // Can slide - allow X movement
                    this.player.position.x = testPos.x;
                } else {
                    // Cannot slide - stop X movement
                    newVX = 0;
                }
            } else {
                // No X collision - allow movement
                this.player.position.x = testPos.x;
            }
            
            // Z axis movement
            testPos = this.player.position.clone();
            testPos.z += newVZ * deltaTime;
            if (this.checkCollisionAxis(testPos, 'z')) {
                // Z collision - try to slide along wall by checking if we can move in X
                const slideTest = this.player.position.clone();
                slideTest.z = testPos.z;
                if (!this.checkCollision(slideTest)) {
                    // Can slide - allow Z movement
                    this.player.position.z = testPos.z;
                } else {
                    // Cannot slide - stop Z movement
                    newVZ = 0;
                }
            } else {
                // No Z collision - allow movement
                this.player.position.z = testPos.z;
            }
            // Commit horizontal velocities
            this.player.velocity.x = newVX;
            this.player.velocity.z = newVZ;
        } else {
            // Keyboard schemes only in non-play or as fallback
            // Scheme 3 (Tank): A/D turn, W/S move forward/back relative to facing. No strafe.
            // Scheme 1 (Mouse Turn): A/D strafe, mouse controls facing.
            const isTank = this.controlScheme === 3;
            const turnSpeed = 2.5; // radians per second for smooth tank turning
            
            if (isTank) {
                // Turn with A/D (continuous), optional snap with Q/E handled in keydown
                const turnLeft = this.keys['KeyA'] ? 1 : 0;
                const turnRight = this.keys['KeyD'] ? 1 : 0;
                this.characterRotation += (turnRight - turnLeft) * turnSpeed * deltaTime;
                
                // Forward/Backward
                if (this.keys['KeyW']) direction.z -= 1;
                if (this.keys['KeyS']) direction.z += 1;
            } else {
                // Mouse-turn scheme: WASD with strafe
                if (this.keys['KeyW']) direction.z -= 1;
                if (this.keys['KeyS']) direction.z += 1;
                if (this.keys['KeyA']) direction.x -= 1;
                if (this.keys['KeyD']) direction.x += 1;
            }
        }

        // Apply facing to movement when using keyboard schemes
        if (this.gameMode !== 'play') {
            direction.applyEuler(new THREE.Euler(0, this.characterRotation, 0));
        }
        if (this.gameMode !== 'play' && direction.lengthSq() > 0) direction.normalize();
        
        if (this.gameMode !== 'play') {
            // Apply movement with collision detection (legacy)
            const newVelocityX = direction.x * speed;
            const newVelocityZ = direction.z * speed;
            
            // Axis-separated collision for wall-walking in non-play mode
            const pos = this.player.position.clone();
            
            // X axis movement
            let testPos = pos.clone();
            testPos.x += newVelocityX * deltaTime;
            if (this.checkCollisionAxis(testPos, 'x')) {
                // X collision - try to slide along wall
                const slideTest = this.player.position.clone();
                slideTest.x = testPos.x;
                if (!this.checkCollision(slideTest)) {
                    // Can slide - allow X movement
                    this.player.position.x = testPos.x;
                    this.player.velocity.x = newVelocityX;
                } else {
                    // Cannot slide - stop X movement
                    this.player.velocity.x = 0;
                }
            } else {
                // No X collision - allow movement
                this.player.position.x = testPos.x;
                this.player.velocity.x = newVelocityX;
            }
            
            // Z axis movement
            testPos = this.player.position.clone();
            testPos.z += newVelocityZ * deltaTime;
            if (this.checkCollisionAxis(testPos, 'z')) {
                // Z collision - try to slide along wall
                const slideTest = this.player.position.clone();
                slideTest.z = testPos.z;
                if (!this.checkCollision(slideTest)) {
                    // Can slide - allow Z movement
                    this.player.position.z = testPos.z;
                    this.player.velocity.z = newVelocityZ;
                } else {
                    // Cannot slide - stop Z movement
                    this.player.velocity.z = 0;
                }
            } else {
                // No Z collision - allow movement
                this.player.position.z = testPos.z;
                this.player.velocity.z = newVelocityZ;
            }
        }
        
        // Space behaves like a jump unless the jetpack is explicitly armed AND
        // has fuel. This keeps weapons firable mid-flight (mouse only) and lets
        // the player jump normally when they're not in jetpack mode.
        const jetpackReady = this.jetpackArmed && this.powerUps.jetpackFuel > 0;

        if (this.keys['Space'] && this.player.onGround && !jetpackReady) {
            this.player.velocity.y = jumpForce;
            this.player.onGround = false;
        }

        if (this.keys['Space'] && jetpackReady && !this.isJetpackActive) {
            this.isJetpackActive = true;
            this.showMessage(this.t('jetpackOnline'));
        }
        if ((!this.keys['Space'] || !this.jetpackArmed) && this.isJetpackActive) {
            this.isJetpackActive = false;
        }

        // Apply gravity first
        this.player.velocity.y += gravity * deltaTime;

        // Jetpack thrust — only when armed, fueled, and Space is held.
        if (this.isJetpackActive && jetpackReady) {
            const jetpackForce = 40;       // overcomes gravity
            const fuelConsumption = 15;    // per second

            if (this.keys['Space']) {
                this.player.velocity.y += jetpackForce * deltaTime;
                this.powerUps.jetpackFuel -= fuelConsumption * deltaTime;
                this.jetpackThrust = Math.min(this.jetpackThrust + deltaTime * 3, 1);
                this.createJetpackParticles();
            } else {
                this.jetpackThrust = Math.max(this.jetpackThrust - deltaTime * 2, 0);
            }

            // Auto-disarm when fuel runs out so Space stops feeling broken.
            if (this.powerUps.jetpackFuel <= 0) {
                this.powerUps.jetpackFuel = 0;
                this.isJetpackActive = false;
                this.jetpackArmed = false;
                this.showMessage(this.t('jetpackDepleted'));
                this._qbSig = null;
                if (this.isDrawerOpen) this.updateDrawerUI();
            }
        } else if (this.jetpackThrust > 0) {
            // Decay residual thrust value even when not actively engaging
            // (e.g., just disarmed) so particle generation stops cleanly.
            this.jetpackThrust = Math.max(this.jetpackThrust - deltaTime * 2, 0);
        }
        
        // Update vertical position only here; horizontal was applied above for play mode
        this.player.position.y += this.player.velocity.y * deltaTime;
        
        // Update player invulnerability timer
        if (this.player.invulnerable) {
            this.player.invulnerabilityTimer -= deltaTime;
            if (this.player.invulnerabilityTimer <= 0) {
                this.player.invulnerable = false;
            }
        }
        
        // Check collision with enemies
        if (this.gameMode === 'play' && this.playMode.enemies) {
            for (const enemy of this.playMode.enemies) {
                const distance = this.player.position.distanceTo(enemy.position);
                if (distance < 1.5) { // Collision radius
                    this.damagePlayer(10); // 10 damage per hit
                    break; // Only damage once per frame
                }
            }
        }
        
        // Wall collision for Y-axis (landing on walls)
        this.checkWallCollisionY();
        
        // Ground collision
        if (this.player.position.y <= 0) {
            this.player.position.y = 0;
            this.player.velocity.y = 0;
            this.player.onGround = true;
        }
        
        // Update character model position and rotation
        if (this.player.model) {
            this.player.model.position.copy(this.player.position);
            // Character faces aim/move direction + model yaw offset
            this.player.model.rotation.y = this.characterRotation + (this.modelYawOffset || 0);
        }
        
        // Update character animation
        this.updateCharacterAnimation(deltaTime);
        
        // Update direction indicators
        this.updateDirectionIndicators();
        
        // Update camera position based on mode
        this.updateCamera();
    }
    
    
    setControlScheme(scheme) {
        // Only allow the two classic schemes: 1 (Mouse Turn) and 3 (Tank)
        if (scheme !== 1 && scheme !== 3) {
            scheme = 1;
        }
        this.controlScheme = scheme;
        this.cameraMode = 'fixed';
    }
    
    
    cycleCameraAngle() {
        // Cycle through fixed camera angles: 0°, 90°, 180°, 270°
        this.currentCameraAngle = (this.currentCameraAngle + 90) % 360;
    }
    
    updateDirectionIndicators() {
        // Update UI indicators
        const facingElement = document.getElementById('facing-direction');
        const cameraElement = document.getElementById('camera-angle');
        
        if (facingElement && cameraElement) {
            // Convert character rotation to degrees and direction
            const facingDegrees = (this.characterRotation * 180 / Math.PI) % 360;
            const facingDirection = this.getDirectionName(facingDegrees);
            
            facingElement.textContent = `Facing: ${facingDirection} (${Math.round(facingDegrees)}°)`;
            cameraElement.textContent = `Camera: ${this.currentCameraAngle}°`;
        }
    }
    
    getDirectionName(degrees) {
        // Normalize degrees to 0-360
        degrees = ((degrees % 360) + 360) % 360;
        
        if (degrees >= 337.5 || degrees < 22.5) return 'North';
        if (degrees >= 22.5 && degrees < 67.5) return 'Northeast';
        if (degrees >= 67.5 && degrees < 112.5) return 'East';
        if (degrees >= 112.5 && degrees < 157.5) return 'Southeast';
        if (degrees >= 157.5 && degrees < 202.5) return 'South';
        if (degrees >= 202.5 && degrees < 247.5) return 'Southwest';
        if (degrees >= 247.5 && degrees < 292.5) return 'West';
        if (degrees >= 292.5 && degrees < 337.5) return 'Northwest';
        
        return 'Unknown';
    }
    
    checkEnemyCollision(position) {
        if (!this.playMode || !this.playMode.enemies) return false;
        const playerRadius = 0.8;
        const cur = this.player.position;
        for (const e of this.playMode.enemies) {
            const r = (e.userData.hitRadius || 0.6) + playerRadius;
            const dx = position.x - e.position.x;
            const dz = position.z - e.position.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < r * r) {
                // Allow movement that increases distance — prevents permastuck if a zombie
                // wandered into the player.
                const curDx = cur.x - e.position.x;
                const curDz = cur.z - e.position.z;
                if (d2 < curDx * curDx + curDz * curDz) return true;
            }
        }
        return false;
    }

    checkCollision(position) {
        if (this.checkEnemyCollision(position)) return true;
        // Player collision box size
        const playerRadius = 0.8;
        const playerHeight = 2;

        // Check collision with each wall (horizontal only - Y handled separately)
        for (let wall of this.walls) {
            const wallPos = wall.position;
            const wallSize = wall.size;
            
            // Check if player is within wall bounds horizontally
            if (position.x + playerRadius > wallPos.x - wallSize.x/2 &&
                position.x - playerRadius < wallPos.x + wallSize.x/2 &&
                position.z + playerRadius > wallPos.z - wallSize.z/2 &&
                position.z - playerRadius < wallPos.z + wallSize.z/2) {
                
                // Check if player is at the right height to collide with wall
                const wallTop = wallPos.y + wallSize.y/2;
                const wallBottom = wallPos.y - wallSize.y/2;
                const playerBottom = position.y;
                const playerTop = position.y + playerHeight;
                
                // Only collide if player is at the right height
                if (playerTop > wallBottom && playerBottom < wallTop) {
                    return true; // Collision detected
                }
            }
        }
        
        return false; // No collision
    }
    
    checkCollisionAxis(position, axis) {
        if (this.checkEnemyCollision(position)) return true;
        // Player collision box size
        const playerRadius = 0.8;
        const playerHeight = 2;
        
        // Check collision with each wall for specific axis (horizontal only)
        for (let wall of this.walls) {
            const wallPos = wall.position;
            const wallSize = wall.size;
            
            if (axis === 'x') {
                // Check X-axis collision only
                if (position.x + playerRadius > wallPos.x - wallSize.x/2 &&
                    position.x - playerRadius < wallPos.x + wallSize.x/2 &&
                    this.player.position.z + playerRadius > wallPos.z - wallSize.z/2 &&
                    this.player.position.z - playerRadius < wallPos.z + wallSize.z/2) {
                    
                    // Check if player is at the right height to collide with wall
                    const wallTop = wallPos.y + wallSize.y/2;
                    const wallBottom = wallPos.y - wallSize.y/2;
                    const playerBottom = position.y;
                    const playerTop = position.y + playerHeight;
                    
                    if (playerTop > wallBottom && playerBottom < wallTop) {
                        return true;
                    }
                }
            } else if (axis === 'z') {
                // Check Z-axis collision only
                if (this.player.position.x + playerRadius > wallPos.x - wallSize.x/2 &&
                    this.player.position.x - playerRadius < wallPos.x + wallSize.x/2 &&
                    position.z + playerRadius > wallPos.z - wallSize.z/2 &&
                    position.z - playerRadius < wallPos.z + wallSize.z/2) {
                    
                    // Check if player is at the right height to collide with wall
                    const wallTop = wallPos.y + wallSize.y/2;
                    const wallBottom = wallPos.y - wallSize.y/2;
                    const playerBottom = position.y;
                    const playerTop = position.y + playerHeight;
                    
                    if (playerTop > wallBottom && playerBottom < wallTop) {
                        return true;
                    }
                }
            }
        }
        
        return false;
    }
    
    checkWallCollisionY() {
        // Player collision box size
        const playerRadius = 0.8;
        const playerHeight = 2;
        
        // Check collision with each wall for Y-axis
        for (let wall of this.walls) {
            const wallPos = wall.position;
            const wallSize = wall.size;
            
            // Check if player is horizontally within wall bounds
            if (this.player.position.x + playerRadius > wallPos.x - wallSize.x/2 &&
                this.player.position.x - playerRadius < wallPos.x + wallSize.x/2 &&
                this.player.position.z + playerRadius > wallPos.z - wallSize.z/2 &&
                this.player.position.z - playerRadius < wallPos.z + wallSize.z/2) {
                
                // Player is horizontally within wall - check Y collision
                const wallTop = wallPos.y + wallSize.y/2;
                const wallBottom = wallPos.y - wallSize.y/2;
                const playerBottom = this.player.position.y;
                const playerTop = this.player.position.y + playerHeight;
                
                // Check if player is falling and would land on top of wall
                if (this.player.velocity.y <= 0 && 
                    playerBottom <= wallTop && 
                    playerTop > wallTop) {
                    // Land on top of wall
                    this.player.position.y = wallTop;
                    this.player.velocity.y = 0;
                    this.player.onGround = true;
                    return;
                }
                
                // Check if player is moving up and would hit wall ceiling
                if (this.player.velocity.y > 0 && 
                    playerTop >= wallBottom && 
                    playerBottom < wallBottom) {
                    // Hit wall ceiling
                    this.player.position.y = wallBottom - playerHeight;
                    this.player.velocity.y = 0;
                    return;
                }
                
                // Check if player is inside wall horizontally - push out
                if (playerTop > wallBottom && playerBottom < wallTop) {
                    // Player is inside wall - determine which side to push out to
                    const distToLeft = Math.abs(this.player.position.x - (wallPos.x - wallSize.x/2));
                    const distToRight = Math.abs(this.player.position.x - (wallPos.x + wallSize.x/2));
                    const distToFront = Math.abs(this.player.position.z - (wallPos.z - wallSize.z/2));
                    const distToBack = Math.abs(this.player.position.z - (wallPos.z + wallSize.z/2));
                    
                    const minDist = Math.min(distToLeft, distToRight, distToFront, distToBack);
                    
                    if (minDist === distToLeft) {
                        this.player.position.x = wallPos.x - wallSize.x/2 - playerRadius;
                    } else if (minDist === distToRight) {
                        this.player.position.x = wallPos.x + wallSize.x/2 + playerRadius;
                    } else if (minDist === distToFront) {
                        this.player.position.z = wallPos.z - wallSize.z/2 - playerRadius;
                    } else {
                        this.player.position.z = wallPos.z + wallSize.z/2 + playerRadius;
                    }
                }
            }
        }
    }
    
    updateCamera() {
        // Play-mode camera: Isometric or First-Person
        if (this.gameMode === 'play') {
            if (this.viewMode === 'fpv') {
                const eyeHeight = 1.6;
                const pitch = this.fpvPitch || 0;
                const dir = new THREE.Vector3(
                    Math.sin(this.characterRotation) * Math.cos(pitch),
                    Math.sin(pitch),
                    Math.cos(this.characterRotation) * Math.cos(pitch)
                );
                const eye = this.player.position.clone();
                // Head bob on movement
                const moving = Math.abs(this.player.velocity.x) + Math.abs(this.player.velocity.z) > 0.1;
                const bob = moving ? Math.sin(performance.now() / 1000 * this.fpvBobFrequency) * this.fpvBobAmplitude : 0;
                eye.y += eyeHeight + bob;
                const target = eye.clone().add(dir);
                this.camera.position.copy(eye);
                this.camera.lookAt(target);
                return;
            }
            
            if (this.viewMode === 'birds-eye') {
                // Birds-eye view: camera high above player looking down
                const height = 150; // Height above player
                const cameraPos = this.player.position.clone();
                cameraPos.y += height;
                
                this.camera.position.set(cameraPos.x, cameraPos.y, cameraPos.z);
                this.camera.lookAt(this.player.position);
                return;
            }
            
            if (this.viewMode === 'ghost') {
                // Ghost camera: free-flying camera
                this.camera.position.copy(this.ghostCamera.position);
                this.camera.quaternion.copy(this.ghostCamera.quaternion);
                return;
            }
            const angleRad = (this.currentCameraAngle * Math.PI) / 180;
            const offset = this.playMode.cameraOffset.clone();
            // Rotate offset around Y by current camera angle
            const rotY = new THREE.Matrix4().makeRotationY(angleRad);
            offset.applyMatrix4(rotY);
            const camPos = this.player.position.clone().add(offset);
            this.camera.position.set(camPos.x, camPos.y, camPos.z);
            this.camera.lookAt(this.player.position);
            return;
        }
        if (this.controlScheme === 2 && this.cameraMode === 'orbit') {
            // Scheme 2: Orbit camera
            const orbitX = Math.cos(this.orbitMouseX) * this.orbitDistance;
            const orbitZ = Math.sin(this.orbitMouseX) * this.orbitDistance;
            const orbitY = this.orbitHeight + Math.sin(this.orbitMouseY) * 5;
            
            this.camera.position.set(
                this.player.position.x + orbitX,
                this.player.position.y + orbitY,
                this.player.position.z + orbitZ
            );
            this.camera.lookAt(this.player.position);
        } else {
            // Fixed camera angles (schemes 1 and 3)
            const angleRad = (this.currentCameraAngle * Math.PI) / 180;
            
            // Position camera at fixed angles around the player
            const cameraDistance = 8;
            const cameraHeight = 5;
            
            const cameraX = this.player.position.x + Math.sin(angleRad) * cameraDistance;
            const cameraZ = this.player.position.z + Math.cos(angleRad) * cameraDistance;
            const cameraY = this.player.position.y + cameraHeight;
            
            this.camera.position.set(cameraX, cameraY, cameraZ);
            this.camera.lookAt(this.player.position);
        }
    }
    
    updateCharacterAnimation(deltaTime) {
        // Drive skeleton clip selection from movement/jump state before stepping the mixer
        if (this.player.clips) {
            const vx = this.player.velocity ? this.player.velocity.x : 0;
            const vz = this.player.velocity ? this.player.velocity.z : 0;
            const horizSpeed = Math.hypot(vx, vz);
            const sprinting = !!(this.keys && (this.keys['ShiftLeft'] || this.keys['ShiftRight']));
            let target;
            if (this.player.onGround === false && this.player.clips['Jump']) {
                target = 'Jump';
            } else if (horizSpeed > 0.5) {
                target = (sprinting && this.player.clips['Run']) ? 'Run' : 'Walk';
            } else {
                target = 'Idle';
            }
            this.setPlayerAnimation(target);
        }
        // Update animation mixer if it exists
        if (this.player.mixer) {
            this.player.mixer.update(deltaTime);
        }
        
        // Simple keyframed animation for lion archer
        if (this.player.leftArm && this.player.rightArm) {
            const t = Date.now() * 0.008;
            const moving = (this.gameMode === 'play' && (this.keys['KeyW'] || this.keys['KeyS'] || this.keys['KeyA'] || this.keys['KeyD'])) ||
                           this.keys['KeyW'] || this.keys['KeyS'] || this.keys['KeyA'] || this.keys['KeyD'];
            const sprinting = (this.gameMode === 'play') && (this.keys['ShiftLeft'] || this.keys['ShiftRight']) && moving;

            if (moving) {
                const amp = sprinting ? 0.8 : 0.45;
                const legAmp = sprinting ? 1.0 : 0.6;
                this.player.leftArm.rotation.x = Math.sin(t) * amp;
                this.player.rightArm.rotation.x = Math.sin(t + Math.PI) * amp;
                this.player.leftLeg.rotation.x = Math.sin(t) * legAmp;
                this.player.rightLeg.rotation.x = Math.sin(t + Math.PI) * legAmp;
                this.player.body.rotation.z = Math.sin(t * 0.5) * 0.06;
            } else {
                // Idle: subtle breathing
                this.player.leftArm.rotation.x = Math.sin(t) * 0.05;
                this.player.rightArm.rotation.x = Math.sin(t + Math.PI) * 0.05;
                this.player.leftLeg.rotation.x = 0;
                this.player.rightLeg.rotation.x = 0;
                this.player.body.rotation.z = 0;
            }
        }
    }
    
    
    // Fixed timestep simulation constants
    static FIXED_TIMESTEP = 1/60; // 60 FPS logic
    static MAX_FRAME_TIME = 0.25; // Prevent spiral of death
    
    animate() {
        requestAnimationFrame(() => this.animate());

        const deltaTime = this.clock.getDelta();
        const clampedDeltaTime = Math.min(deltaTime, Game3D.MAX_FRAME_TIME);

        this.accumulator = (this.accumulator || 0) + clampedDeltaTime;
        while (this.accumulator >= Game3D.FIXED_TIMESTEP) {
            this.fixedUpdate(Game3D.FIXED_TIMESTEP);
            this.accumulator -= Game3D.FIXED_TIMESTEP;
        }

        // Per-frame visual updates that should run at display rate (smooth animation).
        this.updateSwordViewmodel(clampedDeltaTime);

        // Multiplayer: send our state at ~15 Hz, interpolate remote players each frame
        this.tickMultiplayer(clampedDeltaTime);

        this.render();
    }
    
    fixedUpdate(deltaTime) {
        // All game logic goes here - runs at fixed 60 FPS
        this.updatePlayer(deltaTime);
        this.updateFootsteps(deltaTime);
        this.updateDamageVignette(deltaTime);
        this.updatePlayerLocomotion(deltaTime);

        // Open-world tick (animals, portal anim, transition trigger). Runs before
        // the play-mode combat block so peaceful worlds can suppress it below.
        if (this.openWorld && this.openWorld.active) {
            this.openWorld.update(deltaTime);
        }

        // Update projectiles and other play-mode systems
        if (this.gameMode === 'play') {
            const owActive = this.openWorld && this.openWorld.active;

            // Always run: weapons, projectiles, dying animations, FX. Open-world
            // animals are registered into playMode.enemies so these are the same
            // pipes that make them shootable.
            this.updateProjectiles(deltaTime);
            this.updateDyingEnemies(deltaTime);
            this.updateMuzzleFlash(deltaTime);
            this.updatePickupCollectFx(deltaTime);
            this.updateEnemyDeathFragments(deltaTime);
            this.updateFootDust(deltaTime);
            this.updateWorldMuzzleSprites(deltaTime);
            this.updateJetpackParticles(deltaTime);

            // Maze-only systems — skipped entirely in open world (animals run
            // their own behavior in OpenWorldSystem.update; no pickups; no waves).
            if (!owActive) {
                this.updateEnemies(deltaTime);
                this.updateEnemySpawning(deltaTime);
                this.updatePickups(deltaTime);
                if (this.arena && this.arena.active) this.updateArena(deltaTime);
            }
        }
        
        // Update facing indicator position/target
        this.updateFacingIndicator();
        // Update objectives (start/end checks)
        this.updateObjectives();
        
        // Update power-ups
        this.updatePowerUps(deltaTime);
        
        // Update weapon cooldowns
        this.updateWeaponCooldowns(deltaTime);
        
        // Update reload process
        this.updateReload(deltaTime);
        
        // Handle continuous firing
        this.handleContinuousFiring(deltaTime);

        // Update flag highlight state
        this.updateFlagHighlights();
    }
    
    render() {
        // All rendering and UI updates go here - runs at display refresh rate
        this.clearAllUI();
        this.updateControlsUI();
        this.updateHealthUI();
        this.updateCompassUI();
        // this.updateWeaponPowerUpUI(); // Replaced by new HUD system
        this.updateCrosshairUI();
        this.updateGroundTargetIndicator();
        this.updateInventoryGridUI();
        this.updateToasts();

        // New HUD elements (health bar / vignette / minimap / objective banner)
        this.updateHealthBarUI();
        this.updateDamageVignetteUI();
        this.updateMuzzleFlashUI();
        this.updateObjectiveBannerUI();
        this.updateMinimapUI();
        this._updateArenaCountdownUI();

        // Emit UI update for new HUD system
        this.emit('ui:update', this.buildHUDModel());

        // Render the scene
        this.renderer.render(this.scene, this.camera);
    }

    // ===== HUD: segmented health bar =====
    updateHealthBarUI() {
        const el = document.getElementById('health-bar');
        if (!el) return;
        if (this.gameMode !== 'play') { el.style.display = 'none'; return; }
        el.style.display = 'block';

        const pipsEl = el.querySelector('.hb-pips');
        const textEl = el.querySelector('.hb-text');
        const hp = Math.max(0, Math.floor(this.player.hp));
        const maxHp = this.player.maxHp || 100;
        const pipsTotal = 10;
        const perPip = maxHp / pipsTotal;
        const filledCount = Math.ceil(hp / perPip);
        const pct = hp / maxHp;

        const lastHp = this._lastHpForBar;
        if (typeof lastHp === 'number' && hp < lastHp) {
            el.classList.remove('pulse');
            // force reflow to restart animation
            void el.offsetWidth;
            el.classList.add('pulse');
        }
        this._lastHpForBar = hp;

        if (!pipsEl.children.length || pipsEl.children.length !== pipsTotal) {
            pipsEl.innerHTML = '';
            for (let i = 0; i < pipsTotal; i++) {
                const p = document.createElement('div');
                p.className = 'hb-pip';
                pipsEl.appendChild(p);
            }
        }
        const statusClass = pct < 0.3 ? 'crit' : pct < 0.6 ? 'low' : '';
        for (let i = 0; i < pipsTotal; i++) {
            const pip = pipsEl.children[i];
            pip.classList.remove('low', 'crit', 'lost');
            if (i >= filledCount) pip.classList.add('lost');
            else if (statusClass) pip.classList.add(statusClass);
        }
        textEl.innerHTML = `<b>${hp}</b> / ${maxHp}`;
    }

    updateDamageVignetteUI() {
        const el = document.getElementById('damage-vignette');
        if (!el) return;
        const t = this._damageVignetteT || 0;
        el.style.opacity = Math.min(1, t / 0.45).toFixed(3);
    }

    updateMuzzleFlashUI() {
        const el = document.getElementById('muzzle-flash');
        if (!el) return;
        const t = this._muzzleFlashT || 0;
        el.style.opacity = (t > 0 ? Math.min(1, t / 0.08) * 0.75 : 0).toFixed(3);
    }

    updateObjectiveBannerUI() {
        const el = document.getElementById('objective-banner');
        const arenaEl = document.getElementById('arena-hud');
        const lavaVignette = document.getElementById('lava-vignette');
        if (!el) return;
        // Arena mode owns its own HUD
        if (this.arena && this.arena.active) {
            el.style.display = 'none';
            if (arenaEl) {
                arenaEl.style.display = 'block';
                const phaseLabel = {
                    'wave-active': 'Clear the wave',
                    'eruption':    'GROUND SHAKES!',
                    'boss-fight':  'BOSS FIGHT',
                    'wave-complete': 'WAVE CLEARED'
                }[this.arena.phase] || '';
                const waveEl = arenaEl.querySelector('.ah-wave');
                const enemiesEl = arenaEl.querySelector('.ah-enemies');
                const phaseEl = arenaEl.querySelector('.ah-phase');
                const scoreEl = arenaEl.querySelector('.ah-score');
                const bossWrap = arenaEl.querySelector('.ah-boss-wrap');
                const bossFill = arenaEl.querySelector('.ah-boss-fill');
                if (waveEl) waveEl.textContent = `WAVE ${this.arena.wave}`;
                const remaining = (this.arena.enemiesToSpawn - this.arena.enemiesSpawnedThisWave) + (this.playMode.enemies ? this.playMode.enemies.length : 0);
                if (enemiesEl) enemiesEl.textContent = String(Math.max(0, remaining));
                if (phaseEl) phaseEl.textContent = phaseLabel;
                if (scoreEl) scoreEl.textContent = `Score: ${this.score || 0}`;
                const boss = this.arena.boss;
                if (bossWrap && bossFill) {
                    if (boss && !boss.userData.dying && boss.userData.hpMax > 0) {
                        bossWrap.style.display = 'flex';
                        const ratio = Math.max(0, Math.min(1, boss.userData.hp / boss.userData.hpMax));
                        bossFill.style.width = (ratio * 100).toFixed(1) + '%';
                    } else {
                        bossWrap.style.display = 'none';
                    }
                }
            }
            if (lavaVignette) {
                const lava = this.arena.lava;
                const proximity = lava && lava.y > lava.restY + 0.1
                    ? Math.max(0, Math.min(1, 1 - (this.player.position.y - lava.y) * 1.5))
                    : 0;
                lavaVignette.style.opacity = proximity.toFixed(3);
            }
            return;
        }
        // Default (maze) banner
        if (arenaEl) arenaEl.style.display = 'none';
        if (lavaVignette) lavaVignette.style.opacity = '0';
        if (this.gameMode !== 'play') { el.style.display = 'none'; return; }
        el.style.display = 'flex';
        const level = this.mazeDifficulty || 1;
        const enemiesLeft = (this.playMode && this.playMode.enemies) ? this.playMode.enemies.length : 0;
        const flags = (this.inventory && typeof this.inventory.flags === 'number') ? this.inventory.flags : 0;
        const flagsMax = this.flagsObjective || (this.placedFlags ? this.placedFlags.length : 0);
        const score = this.score || 0;
        const lvlEl = el.querySelector('.ob-level');
        const enemiesEl = el.querySelector('.ob-enemies');
        const flagsEl = el.querySelector('.ob-flags');
        const scoreEl = el.querySelector('.ob-score');
        if (lvlEl) lvlEl.textContent = `LVL ${level}`;
        if (enemiesEl) enemiesEl.textContent = `Enemies: ${enemiesLeft}`;
        if (flagsEl) flagsEl.textContent = `Flags: ${flags}/${flagsMax}`;
        if (scoreEl) scoreEl.textContent = `Score: ${score}`;
    }

    updateMinimapUI() {
        const wrap = document.getElementById('minimap-wrap');
        const canvas = document.getElementById('minimap');
        if (!wrap || !canvas) return;
        if (this.gameMode !== 'play') { wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';

        // Throttle to ~10 fps to save cycles
        this._mmFrame = ((this._mmFrame || 0) + 1) % 6;
        if (this._mmFrame !== 0 && this._mmDrawn) return;
        this._mmDrawn = true;

        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, w, h);

        const bounds = this.getMazeBounds ? this.getMazeBounds() : { minX:-50, maxX:50, minZ:-50, maxZ:50 };
        const bw = bounds.maxX - bounds.minX;
        const bh = bounds.maxZ - bounds.minZ;
        const pad = 4;
        const sx = (w - pad*2) / Math.max(1, bw);
        const sz = (h - pad*2) / Math.max(1, bh);
        const toX = (x) => pad + (x - bounds.minX) * sx;
        const toY = (z) => pad + (z - bounds.minZ) * sz;

        // Walls
        ctx.fillStyle = 'rgba(255,179,71,0.45)';
        if (this.walls && this.walls.length) {
            for (const w0 of this.walls) {
                const wx = toX(w0.position.x - w0.size.x/2);
                const wy = toY(w0.position.z - w0.size.z/2);
                const ww = Math.max(1, w0.size.x * sx);
                const wh = Math.max(1, w0.size.z * sz);
                ctx.fillRect(wx, wy, ww, wh);
            }
        }

        // Start / End markers
        if (this.levelStartWorld) {
            ctx.fillStyle = '#7fff7f';
            ctx.fillRect(toX(this.levelStartWorld.x) - 3, toY(this.levelStartWorld.z) - 3, 6, 6);
        }
        if (this.levelEndWorld) {
            ctx.fillStyle = '#ff5050';
            ctx.fillRect(toX(this.levelEndWorld.x) - 3, toY(this.levelEndWorld.z) - 3, 6, 6);
        }

        // Pickups
        if (this.pickups && this.pickups.length) {
            ctx.fillStyle = '#66ffcc';
            for (const p of this.pickups) {
                ctx.fillRect(toX(p.position.x) - 1.5, toY(p.position.z) - 1.5, 3, 3);
            }
        }

        // Enemies
        if (this.playMode && this.playMode.enemies) {
            ctx.fillStyle = '#ff4444';
            for (const e of this.playMode.enemies) {
                ctx.beginPath();
                ctx.arc(toX(e.position.x), toY(e.position.z), 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Player (with facing wedge)
        if (this.player) {
            const px = toX(this.player.position.x);
            const py = toY(this.player.position.z);
            const yaw = this.characterRotation || 0;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(-yaw);
            ctx.fillStyle = '#ffd28a';
            ctx.beginPath();
            ctx.moveTo(0, -6);
            ctx.lineTo(4, 4);
            ctx.lineTo(-4, 4);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
        }
    }

    updateObjectives() {
        // Arena owns objective state when active
        if (this.arena && this.arena.active) return;
        const cur = this.savedMazes[this.currentMazeIndex];
        if (!cur || cur.type !== 'labyrinth') return;
        if (!this.levelStartWorld || !this.levelEndWorld) return;
        const p = this.player.position;
        const atStart = p.distanceToSquared(this.levelStartWorld) < 2.0;
        const atEnd = p.distanceToSquared(this.levelEndWorld) < 2.0;
        if (atEnd) {
            this.showMessage('Exit reached!');
            if (!this._levelCompletePlayed) {
                this._levelCompletePlayed = true;
                this.audio && this.audio.play('levelComplete');
            }
        } else {
            this._levelCompletePlayed = false;
        }
        if (atStart && (this.hasLeftStartOnce || false)) this.showMessage('Back at start');
        if (!atStart) this.hasLeftStartOnce = true;
    }
    
    
    
    clearAllUI() {
        // Remove ALL possible UI elements (except modals, inventory, and crosshair)
        // NOTE: do not list 'weapon-hud' here — it's the live ammo readout.
        const allUIElements = [
            // Old HUD elements
            'player-hp-hud', 'top-center-ui',
            'jetpack-hud', 'enemy-count-hud', 'compass-hud',
            'player-pos', 'player-facing', 'camera-info',
            // Any other possible UI elements
            'objective-msg', 'facing-indicator',
            'control-ui', 'maze-ui'
        ];
        
        allUIElements.forEach(id => {
            const el = document.getElementById(id);
            if (el && id !== 'crosshair' && id !== 'controls-ui' && id !== 'inventory-grid-ui' && id !== 'inventory-drawer') { // Explicitly protect crosshair, controls, inventory grid, and drawer
                el.remove();
            }
        });
        
        // Also remove any elements with common UI classes
        const uiClasses = ['hud-element', 'game-ui', 'ui-panel', 'control-panel'];
        uiClasses.forEach(className => {
            const elements = document.querySelectorAll(`.${className}`);
            elements.forEach(el => el.remove());
        });
        
        // Remove any elements positioned in top-right area that might be interfering
        const allDivs = document.querySelectorAll('div');
        allDivs.forEach(div => {
            // Never touch the drawer or anything inside it — the inv-panel uses
            // left:50% and would otherwise be nuked every frame.
            if (div.closest && div.closest('#inventory-drawer')) return;
            // Also leave anything inside protected wrappers alone.
            if (div.closest && div.closest('#settings-modal, #toolbox-modal, #inventory-grid-ui')) return;

            const style = window.getComputedStyle(div);
            if ((style.position === 'absolute' || style.position === 'fixed') &&
                (style.top === '20px' || style.top === '10px' || style.top === '0px' || style.top === '50%') &&
                (style.right === '20px' || style.right === '10px' || style.right === '0px' || style.left === '50%')) {
                if (!div.id || (!div.id.includes('health-ui') &&
                    !div.id.includes('health-bar') &&
                    !div.id.includes('compass-ui') &&
                    !div.id.includes('weapon-powerup-ui') &&
                    !div.id.includes('settings-modal') &&
                    !div.id.includes('toolbox-modal') &&
                    !div.id.includes('inventory-drawer') &&
                    !div.id.includes('inventory-grid-ui') &&
                    !div.id.includes('minimap') &&
                    !div.id.includes('objective-banner') &&
                    !div.id.includes('damage-vignette') &&
                    !div.id.includes('muzzle-flash') &&
                    !div.id.includes('arena-hud') &&
                    !div.id.includes('arena-countdown') &&
                    !div.id.includes('lava-vignette') &&
                    !div.id.includes('crosshair') &&
                    !div.id.includes('drawer-cursor'))) {
                    div.remove();
                }
            }
        });
    }

    updateHealthUI() {
        // Replaced by updateHealthBarUI() — keep stub so other call sites don't break.
        const old = document.getElementById('health-ui');
        if (old) old.remove();
        return;
        // eslint-disable-next-line no-unreachable
        if (this.gameMode !== 'play') {
            return;
        }
        let hud = document.getElementById('health-ui');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'health-ui';
            hud.style.position = 'absolute';
            hud.style.top = '20px';
            hud.style.right = '20px';
            hud.style.background = 'rgba(0,0,0,0.8)';
            hud.style.border = '2px solid #ff6666';
            hud.style.borderRadius = '8px';
            hud.style.padding = '12px 16px';
            hud.style.color = '#ff6666';
            hud.style.fontFamily = 'Courier New, monospace';
            hud.style.fontSize = '16px';
            hud.style.fontWeight = 'bold';
            hud.style.zIndex = '1000';
            document.body.appendChild(hud);
        }
        
        const hpPercent = (this.player.hp / this.player.maxHp) * 100;
        const hpColor = hpPercent > 60 ? '#ffb347' : hpPercent > 30 ? '#ffff00' : '#ff6666';
        
        hud.innerHTML = `
            <div style="text-align: center; margin-bottom: 8px; font-size: 14px; opacity: 0.8;">${this.t('health').toUpperCase()}</div>
            <div style="text-align: center; font-size: 20px; color: ${hpColor}; margin-bottom: 8px;">
                ${Math.floor(this.player.hp)}/${this.player.maxHp}
            </div>
            <div style="width: 140px; height: 10px; background: rgba(255,255,255,0.2); border-radius: 5px; overflow: hidden;">
                <div style="
                    width: ${hpPercent}%; 
                    height: 100%; 
                    background: ${hpColor}; 
                    transition: width 0.1s;
                "></div>
            </div>
        `;
        hud.style.display = 'block';
    }
    
    // Stub kept because the ammo-pickup apply() calls it; the real HUD is the
    // event-driven one rendered by renderHUD().
    updateWeaponPowerUpUI() { /* deprecated — see renderHUD */ }

    // ===== New HUD System with Cached DOM References =====

    mountHUD() {
        // Minimal weapon HUD: a big ammo count (or ∞ for free-fire) with a
        // tiny weapon name underneath. Everything else moved out — weapon
        // stats, cooldown bar, power-up list, etc. — they were noise.
        this.hudElements = {};

        const hud = document.createElement('div');
        hud.id = 'weapon-hud';
        hud.style.display = 'none';
        document.body.appendChild(hud);

        hud.innerHTML = `
            <div class="wh-ammo"></div>
            <div class="wh-name"></div>
        `;

        this.hudElements.container = hud;
        this.hudElements.ammo = hud.querySelector('.wh-ammo');
        this.hudElements.name = hud.querySelector('.wh-name');

        // CSS lives in style.css; ID #weapon-hud is the selector hook.

        this.on('ui:update', (model) => {
            this.renderHUD(model);
        });
    }

    renderHUD(model) {
        if (!model || !this.hudElements.container) return;

        if (model.gameMode !== 'play') {
            this.hudElements.container.style.display = 'none';
            return;
        }

        const w = model.weapon;
        const isRanged = w.type === 'ranged' && w.ammoCost > 0;
        const isFreeRanged = w.type === 'ranged' && w.ammoCost === 0;

        let ammoText, stateClass;
        if (model.isReloading) {
            ammoText = '…';
            stateClass = 'wh-reload';
        } else if (isFreeRanged || !isRanged) {
            // Sword (melee) and free-fire ranged both show ∞ — neither tracks ammo.
            ammoText = '∞';
            stateClass = 'wh-infinite';
        } else if (model.ammoCount > 0) {
            ammoText = String(model.ammoCount);
            const pct = model.ammoCount / this.AMMO_MAX;
            stateClass = pct > 0.5 ? 'wh-full' : pct > 0.2 ? 'wh-low' : 'wh-crit';
        } else {
            ammoText = '0';
            stateClass = 'wh-empty';
        }

        const hud = this.hudElements.container;
        hud.style.display = 'block';
        hud.className = stateClass;
        this.hudElements.ammo.textContent = ammoText;
        this.hudElements.name.textContent = w.name;
    }
    
    updateControlsUI() {
        // Controls panel is hidden — kept off by default
        const existing = document.getElementById('controls-ui');
        if (existing) existing.style.display = 'none';
        return;
        // Only show in play mode
        if (this.gameMode !== 'play') {
            return;
        }
        
        // Create or update controls UI (top left)
        let hud = document.getElementById('controls-ui');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'controls-ui';
            hud.style.position = 'absolute';
            hud.style.top = '20px';
            hud.style.left = '20px';
            hud.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.9), rgba(42,24,8,0.9))';
            hud.style.border = '2px solid #ffb347';
            hud.style.borderRadius = '12px';
            hud.style.padding = '16px 20px';
            hud.style.color = '#ffb347';
            hud.style.fontFamily = 'Courier New, monospace';
            hud.style.fontSize = '12px';
            hud.style.fontWeight = 'bold';
            hud.style.zIndex = '1000';
            hud.style.minWidth = '280px';
            hud.style.boxShadow = '0 4px 20px rgba(255,179,71,0.3)';
            document.body.appendChild(hud);
        }
        
        // Get current view mode and control scheme
        const viewMode = this.viewMode;
        const isJetpackActive = this.isJetpackActive;
        const isReloading = this.isReloading;
        
        // Basic movement controls
        const movementControls = [
            'WASD - Move',
            'Mouse - Look Around',
            this.jetpackArmed ? 'Space - Jetpack (hold)' : 'Space - Jump'
        ];
        
        // Weapon controls
        const weaponControls = [
            'Left Click - Fire',
            'Mouse Wheel - Switch Weapon',
            'R - Reload',
            '1-2 - Select Weapon'
        ];
        
        // View controls
        const viewControls = [];
        if (viewMode === 'fpv') {
            viewControls.push('V - Birds-eye View');
        } else if (viewMode === 'birds-eye') {
            viewControls.push('V - Ghost Camera');
        } else if (viewMode === 'ghost') {
            viewControls.push('V - Switch to Isometric');
            viewControls.push('WASD - Move, Q/E/Space - Up/Down');
        } else {
            viewControls.push('V - Switch to FPV');
        }
        viewControls.push('Cmd - Cycle Camera Angle');
        
        // Game controls
        const gameControls = [
            'P - Settings',
            'T - Toolbox',
            'M - Open Drawer',
            'ESC - Exit Pointer Lock',
            '4-9 - Use Items'
        ];

        if (this.placedFlags && this.placedFlags.length > 0) {
            gameControls.unshift('G - Remove Nearby Flag');
        }
        if (this.inventory.flags > 0) {
            gameControls.unshift(`F - Place Flag (${this.inventory.flags})`);
        }
        
        // Special states
        const specialStates = [];
        if (isJetpackActive) {
            specialStates.push('🚀 Jetpack thrusting');
        } else if (this.jetpackArmed) {
            specialStates.push('🚀 Jetpack armed (Space to fly)');
        }
        if (isReloading) {
            specialStates.push('🔄 Reloading...');
        }
        
        hud.innerHTML = `
            <div style="text-align: center; margin-bottom: 12px; font-size: 14px; opacity: 0.9; letter-spacing: 1px;">
                ${this.t('controls').toUpperCase()}
            </div>
            
            <div style="margin-bottom: 12px;">
                <div style="font-size: 11px; opacity: 0.8; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${this.t('movement')}</div>
                <div style="font-size: 10px; line-height: 1.4; opacity: 0.9;">
                    ${movementControls.map(control => `<div style="margin-bottom: 2px;">${control}</div>`).join('')}
                </div>
            </div>
            
            <div style="margin-bottom: 12px;">
                <div style="font-size: 11px; opacity: 0.8; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${this.t('weapons')}</div>
                <div style="font-size: 10px; line-height: 1.4; opacity: 0.9;">
                    ${weaponControls.map(control => `<div style="margin-bottom: 2px;">${control}</div>`).join('')}
                </div>
            </div>
            
            <div style="margin-bottom: 12px;">
                <div style="font-size: 11px; opacity: 0.8; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${this.t('view')}</div>
                <div style="font-size: 10px; line-height: 1.4; opacity: 0.9;">
                    ${viewControls.map(control => `<div style="margin-bottom: 2px;">${control}</div>`).join('')}
                </div>
            </div>
            
            <div style="margin-bottom: 12px;">
                <div style="font-size: 11px; opacity: 0.8; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${this.t('game')}</div>
                <div style="font-size: 10px; line-height: 1.4; opacity: 0.9;">
                    ${gameControls.map(control => `<div style="margin-bottom: 2px;">${control}</div>`).join('')}
                </div>
            </div>
            
            ${specialStates.length > 0 ? `
                <div style="border-top: 1px solid rgba(255,179,71,0.3); padding-top: 8px;">
                    <div style="font-size: 11px; opacity: 0.8; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${this.t('status')}</div>
                    <div style="font-size: 10px; line-height: 1.4; color: #ffaa00;">
                        ${specialStates.map(state => `<div style="margin-bottom: 2px;">${state}</div>`).join('')}
                    </div>
                </div>
            ` : ''}
        `;
        hud.style.display = 'block';
    }
    
    updateInventoryGridUI() {
        // Only show in play mode
        if (this.gameMode !== 'play') {
            const existing = document.getElementById('inventory-grid-ui');
            if (existing) existing.style.display = 'none';
            this._qbSig = null;
            return;
        }

        // Cheap signature check — rebuilding the bar every frame is wasteful,
        // and rebuilding clobbers in-flight drag operations.
        const layout = this.quickbarLayout || this.defaultQuickbarLayout();
        const activeWeaponId = this.player.weapons[this.player.currentWeaponIndex];
        const sigParts = [activeWeaponId || '', this.jetpackArmed ? 'J' : '-'];
        for (const id of layout) {
            if (!id) { sigParts.push('_'); continue; }
            sigParts.push(`${id}:${this.getItemCount(id)}:${this.isItemOwned(id) ? 1 : 0}`);
        }
        const sig = sigParts.join('|');
        if (sig === this._qbSig) return;
        this._qbSig = sig;

        // Create or update inventory grid UI (bottom center)
        let hud = document.getElementById('inventory-grid-ui');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'inventory-grid-ui';
            hud.style.position = 'absolute';
            hud.style.bottom = '24px';
            hud.style.left = '50%';
            hud.style.transform = 'translateX(-50%)';
            hud.style.display = 'flex';
            hud.style.zIndex = '1000';
            document.body.appendChild(hud);
        }

        // Build quickbar slots from the unified registry so weapons/consumables
        // share one list of icons/names.
        const reg = this.getItemRegistry();
        const byId = Object.fromEntries(reg.all.map(d => [d.id, d]));
        const quickbarLayout = this.quickbarLayout || this.defaultQuickbarLayout();
        const gridItems = quickbarLayout.map((itemId, index) => {
            const def = byId[itemId];
            return {
                id: itemId,
                type: def ? (def.category === 'weapon' ? 'weapon' : 'item') : 'empty',
                shortcut: (index + 1).toString(),
                icon: def ? def.icon : '',
                name: def ? def.name : ''
            };
        });

        hud.innerHTML = '';
        hud.style.display = 'flex';

        gridItems.forEach((item, index) => {
            const slot = document.createElement('div');
            slot.className = 'qb-slot';
            slot.dataset.slot = String(index);
            slot.title = item.name || '';
            slot.draggable = item.type !== 'empty';

            const isOwned = item.type !== 'empty' && this.isItemOwned(item.id);
            const isSelected = item.type === 'weapon' && item.id === activeWeaponId;
            const isArmed = item.id === 'jetpack' && this.jetpackArmed;
            if (isArmed) slot.classList.add('qb-armed');

            if (item.type === 'empty') {
                slot.classList.add('qb-empty');
            } else if (!isOwned) {
                slot.classList.add('qb-unavail');
            }
            if (isSelected) slot.classList.add('qb-selected');

            const count = item.type === 'empty' ? 0 : this.getItemCount(item.id);
            const showCount = item.type !== 'weapon' && item.type !== 'empty' && count > 0;

            slot.innerHTML = `
                <span class="qb-key">${item.shortcut}</span>
                <span class="qb-icon">${item.icon || '·'}</span>
                ${showCount ? `<span class="qb-count">${count}</span>` : ''}
            `;

            slot.addEventListener('click', () => {
                if (isOwned) {
                    this.audio && this.audio.play('uiClick');
                    this.selectGridItem(item);
                }
            });

            // Right-click clears the slot.
            slot.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (item.type === 'empty') return;
                this.clearQuickbarSlot(index);
            });

            this.wireQuickbarDnD(slot, index, item.type !== 'empty');

            hud.appendChild(slot);
        });

        // "More" button
        const moreButton = document.createElement('div');
        moreButton.id = 'more-button';
        moreButton.className = 'qb-more';
        moreButton.textContent = 'More';
        moreButton.addEventListener('click', () => {
            this.audio && this.audio.play('uiClick');
            this.toggleMoreDrawer();
        });
        hud.appendChild(moreButton);
    }
    
    selectGridItem(item) {
        // Jetpack is a utility "mode" — clicking it toggles arm without
        // changing the active weapon. Space then engages thrust (when fuel > 0).
        if (item.id === 'jetpack') {
            this.toggleJetpackArmed();
            return;
        }

        if (item.type === 'weapon') {
            const weaponIndex = this.player.weapons.indexOf(item.id);
            if (weaponIndex !== -1) {
                this.player.currentWeaponIndex = weaponIndex;
                this.showMessage(`${this.t('switchWeapon')}: ${item.name}`);
                this.attachActiveWeaponToHand();
                this.emit('ui:update', this.buildHUDModel());
                this.updateInventoryGridUI && this.updateInventoryGridUI();
            }
        } else {
            this.activateSelectedItem(item.id);
            this.updateInventoryGridUI && this.updateInventoryGridUI();
        }
    }

    toggleJetpackArmed() {
        this.jetpackArmed = !this.jetpackArmed;
        if (!this.jetpackArmed) {
            // Disarming mid-flight cuts thrust so the player falls naturally.
            this.isJetpackActive = false;
            this.jetpackThrust = 0;
            this.showMessage('Jetpack disarmed — Space jumps');
        } else if (this.powerUps.jetpackFuel <= 0) {
            this.showMessage('Jetpack armed — no fuel');
        } else {
            this.showMessage('Jetpack armed — hold Space to fly');
        }
        this.audio && this.audio.play('uiClick');
        this._qbSig = null;
        this.updateInventoryGridUI && this.updateInventoryGridUI();
        if (this.isDrawerOpen) this.updateDrawerUI();
    }
    
    selectGridItemByShortcut(shortcut) {
        // Number-key shortcuts target the slot at that position in the
        // current quickbar layout, so they stay in sync with HUD and drawer.
        const slotIndex = parseInt(shortcut, 10) - 1;
        if (Number.isNaN(slotIndex) || slotIndex < 0 || slotIndex >= this.quickbarLayout.length) return;
        const itemId = this.quickbarLayout[slotIndex];
        if (!itemId) return;
        const reg = this.getItemRegistry();
        const def = reg.all.find(d => d.id === itemId);
        if (!def) return;
        this.selectGridItem({
            id: def.id,
            type: def.category === 'weapon' ? 'weapon' : 'item',
            name: def.name,
            icon: def.icon
        });
    }
    
    toggleMoreDrawer() {
        this.isDrawerOpen = !this.isDrawerOpen;
        this.updateDrawerUI();

        if (this.isDrawerOpen) {
            // Release pointer lock so the cursor is visible and usable.
            if (document.pointerLockElement) document.exitPointerLock();
            document.body.style.cursor = 'default';
            this.showMessage('Drawer opened — drag items to a quickbar slot');
        } else {
            document.body.style.cursor = '';
            this.showMessage('Drawer closed');
        }
    }
    
    updateDrawerUI() {
        let drawer = document.getElementById('inventory-drawer');
        if (!drawer) {
            drawer = document.createElement('div');
            drawer.id = 'inventory-drawer';
            drawer.classList.add('inv-drawer');
            document.body.appendChild(drawer);

            // Click outside the inner panel closes the drawer.
            drawer.addEventListener('click', (e) => {
                if (e.target === drawer) {
                    this.isDrawerOpen = false;
                    this.hideDrawerCursor();
                    this.updateDrawerUI();
                }
            });
        }

        drawer.classList.toggle('inv-drawer-open', this.isDrawerOpen);
        if (!this.isDrawerOpen) return;

        if (!this.drawerFilter) this.drawerFilter = 'owned';

        const reg = this.getItemRegistry();
        const weaponItems = reg.weapons.map(d => ({ ...d, type: 'weapon' }));
        const consumableItems = reg.consumables.map(d => ({ ...d, type: 'item' }));

        const ownedOnly = this.drawerFilter === 'owned';
        const filt = (it) => !ownedOnly || this.isItemOwned(it.id);
        const visibleWeapons = weaponItems.filter(filt);
        const visibleConsumables = consumableItems.filter(filt);

        // Stats header
        const hp = this.player.hp ?? 0;
        const maxHp = this.player.maxHp ?? 100;
        const ammo = this.inventory.ammo;
        const ammoMax = this.AMMO_MAX;
        const fuel = Math.floor(this.powerUps.jetpackFuel);
        const flags = this.inventory.flags;

        drawer.innerHTML = `
            <div class="inv-panel">
                <div class="drawer-header">
                    <div class="drawer-title">
                        <span class="dt-icon">🎒</span>
                        <h3>${this.t('inventoryDrawer')}</h3>
                    </div>
                    <div class="drawer-stats">
                        <span class="ds-chip ds-hp" title="Health"><b>HP</b> ${hp}/${maxHp}</span>
                        <span class="ds-chip ds-ammo" title="Ammo"><b>🔸</b> ${ammo}/${ammoMax}</span>
                        <span class="ds-chip ds-fuel" title="Jetpack fuel"><b>🚀</b> ${fuel}</span>
                        <span class="ds-chip ds-flags" title="Flags"><b>🏁</b> ${flags}</span>
                    </div>
                    <div class="drawer-actions">
                        <button class="df-pill ${ownedOnly ? '' : 'df-pill-on'}" data-filter="all">All</button>
                        <button class="df-pill ${ownedOnly ? 'df-pill-on' : ''}" data-filter="owned">Owned</button>
                        <button class="df-btn" id="reset-quickbar" title="Restore default loadout">↺ Reset</button>
                        <button class="df-btn df-btn-close" id="close-drawer">${this.t('close')} (Esc)</button>
                    </div>
                </div>

                <div class="drawer-strip-wrap">
                    <div class="drawer-strip-label">
                        <span>Quickbar — target slot <b>${this.selectedDrawerSlot + 1}</b></span>
                        <span class="dsl-hint">drag onto a slot · right-click to clear · drag out to store</span>
                    </div>
                    <div id="drawer-slot-strip" class="drawer-slot-strip"></div>
                </div>

                <div class="drawer-body">
                    <div class="drawer-section">
                        <h4>${this.t('weapons')} <span class="ds-count">${visibleWeapons.length}/${weaponItems.length}</span></h4>
                        <div id="weapon-grid" class="drawer-grid">
                            ${visibleWeapons.length ? '' : `<div class="drawer-empty">No weapons${ownedOnly ? ' picked up yet' : ''}.</div>`}
                        </div>
                    </div>

                    <div class="drawer-section">
                        <h4>${this.t('consumables')} <span class="ds-count">${visibleConsumables.length}/${consumableItems.length}</span></h4>
                        <div id="consumable-grid" class="drawer-grid">
                            ${visibleConsumables.length ? '' : `<div class="drawer-empty">No consumables${ownedOnly ? ' picked up yet' : ''}.</div>`}
                        </div>
                    </div>
                </div>

                <div class="drawer-help">
                    <span><kbd>1</kbd>–<kbd>9</kbd> pick target slot · <kbd>Tab</kbd>/<kbd>⇧Tab</kbd> cycle · <kbd>Del</kbd> clear · <kbd>Esc</kbd>/<kbd>M</kbd> close</span>
                </div>
            </div>
        `;

        // Wire up
        drawer.querySelector('#close-drawer').addEventListener('click', () => {
            this.isDrawerOpen = false;
            this.hideDrawerCursor();
            this.updateDrawerUI();
        });

        drawer.querySelector('#reset-quickbar').addEventListener('click', () => {
            this.audio && this.audio.play('uiClick');
            this.quickbarLayout = this.defaultQuickbarLayout();
            this.saveQuickbarLayout();
            this._qbSig = null;
            this.updateInventoryGridUI();
            this.updateDrawerUI();
            this.showMessage('Quickbar reset to default');
        });

        drawer.querySelectorAll('.df-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                this.drawerFilter = btn.dataset.filter;
                this.audio && this.audio.play('uiClick');
                this.updateDrawerUI();
            });
        });

        this.renderDrawerSlotStrip(drawer.querySelector('#drawer-slot-strip'));

        const weaponGrid = drawer.querySelector('#weapon-grid');
        visibleWeapons.forEach(item => weaponGrid.appendChild(this.createDrawerItem(item)));

        const consumableGrid = drawer.querySelector('#consumable-grid');
        visibleConsumables.forEach(item => consumableGrid.appendChild(this.createDrawerItem(item)));

        this.setupDrawerKeyboardNavigation();
    }

    // Short effect blurb for an item card (e.g. "+25 HP", "15 dmg · range 2.5").
    itemEffectText(item) {
        if (item.type === 'weapon') {
            const w = this.WEAPON_STATS[item.id];
            if (!w) return '';
            return `${w.damage} dmg · ${w.type === 'melee' ? `reach ${w.range}` : `range ${w.range}`}`;
        }
        const def = this.ITEM_DEFS[item.id];
        if (!def) return '';
        const suffix = (def.labelSuffix || '').trim();
        return suffix || (def.autoApply ? 'auto' : '');
    }

    renderDrawerSlotStrip(container) {
        if (!container) return;
        container.innerHTML = '';
        const reg = this.getItemRegistry();
        const byId = Object.fromEntries(reg.all.map(d => [d.id, d]));
        const activeWeaponId = this.player.weapons[this.player.currentWeaponIndex];

        for (let i = 0; i < 9; i++) {
            const itemId = this.quickbarLayout[i];
            const def = itemId ? byId[itemId] : null;
            const slot = document.createElement('div');
            slot.className = 'qb-slot qb-strip';
            slot.dataset.slot = String(i);

            if (!def) slot.classList.add('qb-empty');
            else if (!this.isItemOwned(itemId)) slot.classList.add('qb-unavail');

            if (def && def.category === 'weapon' && itemId === activeWeaponId) {
                slot.classList.add('qb-selected');
            }
            if (itemId === 'jetpack' && this.jetpackArmed) {
                slot.classList.add('qb-armed');
            }
            if (i === this.selectedDrawerSlot) {
                slot.classList.add('qb-target');
            }

            const count = def ? this.getItemCount(itemId) : 0;
            const showCount = def && def.category !== 'weapon' && count > 0;

            slot.innerHTML = `
                <span class="qb-key">${i + 1}</span>
                <span class="qb-icon">${def ? def.icon : ''}</span>
                ${showCount ? `<span class="qb-count">${count}</span>` : ''}
            `;
            slot.title = def ? def.name : `Empty slot ${i + 1}`;

            // Click selects this slot as the assignment target.
            slot.addEventListener('click', () => {
                this.selectedDrawerSlot = i;
                this.audio && this.audio.play('uiClick');
                this.renderDrawerSlotStrip(container);
                this.updateDrawerSelection();
            });
            slot.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!def) return;
                this.clearQuickbarSlot(i);
            });

            this.wireQuickbarDnD(slot, i, !!def);
            container.appendChild(slot);
        }
    }
    
    createDrawerItem(item) {
        const itemEl = document.createElement('div');
        itemEl.className = 'drawer-item';
        itemEl.dataset.itemId = item.id;
        itemEl.draggable = true;

        const isOwned = this.isItemOwned(item.id);
        const count = this.getItemCount(item.id);
        const inBar = this.quickbarLayout.includes(item.id);
        const slotIdx = inBar ? this.quickbarLayout.indexOf(item.id) : -1;
        const effect = this.itemEffectText(item);

        if (!isOwned) {
            itemEl.classList.add('drawer-item-locked');
            itemEl.draggable = false;
        }
        if (inBar) itemEl.classList.add('drawer-item-assigned');
        if (item.type === 'weapon') itemEl.classList.add('drawer-item-weapon');

        const showCount = item.type !== 'weapon' && count > 0;
        const slotLabel = slotIdx >= 0 ? `slot ${slotIdx + 1}` : '';
        itemEl.title = `${item.name}${effect ? ` — ${effect}` : ''}${showCount ? ` (${count})` : ''}${inBar ? ` · in ${slotLabel}` : ''}${!isOwned ? ' · not picked up' : ''}`;

        itemEl.innerHTML = `
            <div class="di-row">
                <div class="di-icon">${item.icon}</div>
                ${showCount ? `<div class="di-count">×${count}</div>` : ''}
                ${inBar ? `<div class="di-pin" title="In quickbar ${slotLabel}">${slotIdx + 1}</div>` : ''}
            </div>
            <div class="di-name">${item.name}</div>
            ${effect ? `<div class="di-effect">${effect}</div>` : ''}
            ${!isOwned ? `<div class="di-locked">locked</div>` : ''}
        `;

        itemEl.addEventListener('click', () => {
            if (!isOwned) {
                this.showMessage(`${item.name} — find one in the world first`);
                return;
            }
            this.audio && this.audio.play('uiClick');
            this.assignItemToQuickbar(item.id);
        });
        itemEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!inBar) return;
            this.clearQuickbarSlot(slotIdx);
        });
        
        // Add drag handlers
        itemEl.addEventListener('dragstart', (e) => {
            if (isOwned) {
                this.draggedItem = item.id;
                this.dragSource = 'drawer';
                this.dragStartSlot = null;
                try { e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
                try { e.dataTransfer.setData('text/plain', item.id); } catch (_) {}
                itemEl.style.opacity = '0.5';
            }
        });

        itemEl.addEventListener('dragend', () => {
            itemEl.style.opacity = '';
            this.draggedItem = null;
            this.dragSource = null;
            document.querySelectorAll('.qb-drop-target').forEach(el => el.classList.remove('qb-drop-target'));
        });

        return itemEl;
    }
    
    assignItemToQuickbar(itemId, slotIndex = null) {
        let targetSlot = (slotIndex !== null) ? slotIndex : this.selectedDrawerSlot;
        if (targetSlot < 0 || targetSlot >= 9) targetSlot = 0;

        // If the item already lives in another slot, move it (don't duplicate).
        const existing = this.quickbarLayout.indexOf(itemId);
        if (existing !== -1 && existing !== targetSlot) {
            const displaced = this.quickbarLayout[targetSlot];
            this.quickbarLayout[targetSlot] = itemId;
            this.quickbarLayout[existing] = displaced;
        } else {
            this.quickbarLayout[targetSlot] = itemId;
        }

        this.selectedDrawerSlot = targetSlot;
        this.saveQuickbarLayout();
        this._qbSig = null;
        this.updateInventoryGridUI();
        if (this.isDrawerOpen) this.updateDrawerUI();

        const def = this.getItemRegistry().all.find(d => d.id === itemId);
        this.showMessage(`${def ? def.name : itemId} → ${this.t('slot') || 'Slot'} ${targetSlot + 1}`);
    }

    clearQuickbarSlot(slotIndex) {
        if (slotIndex < 0 || slotIndex >= this.quickbarLayout.length) return;
        if (!this.quickbarLayout[slotIndex]) return;
        this.quickbarLayout[slotIndex] = null;
        this.saveQuickbarLayout();
        this._qbSig = null;
        this.updateInventoryGridUI();
        if (this.isDrawerOpen) this.updateDrawerUI();
        this.audio && this.audio.play('uiClick');
        this.showMessage(`Cleared slot ${slotIndex + 1}`);
    }

    // Wires HTML5 drag handlers on a slot element (used by both the HUD quickbar
    // and the slot strip inside the drawer). `draggable` controls whether the
    // slot itself can be the source of a drag.
    wireQuickbarDnD(slot, index, draggable) {
        slot.draggable = !!draggable;

        slot.addEventListener('dragstart', (e) => {
            if (!slot.draggable) return;
            this.dragStartSlot = index;
            this.draggedItem = this.quickbarLayout[index];
            this.dragSource = 'quickbar';
            this.dropHandled = false;
            try { e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
            try { e.dataTransfer.setData('text/plain', this.draggedItem || ''); } catch (_) {}
            slot.style.opacity = '0.5';
            document.body.classList.add('qb-dragging');
        });
        slot.addEventListener('dragend', () => {
            slot.style.opacity = '';
            document.body.classList.remove('qb-dragging');
            document.querySelectorAll('.qb-drop-target').forEach(el => el.classList.remove('qb-drop-target'));

            // Dropped outside any valid target → store (clear) the source slot.
            if (!this.dropHandled && this.dragSource === 'quickbar' && this.dragStartSlot !== null) {
                this.clearQuickbarSlot(this.dragStartSlot);
            }

            this.draggedItem = null;
            this.dragStartSlot = null;
            this.dragSource = null;
            this.dropHandled = false;
        });
        slot.addEventListener('dragover', (e) => {
            if (!this.draggedItem) return;
            e.preventDefault();
            try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
            slot.classList.add('qb-drop-target');
        });
        slot.addEventListener('dragleave', () => {
            slot.classList.remove('qb-drop-target');
        });
        slot.addEventListener('drop', (e) => {
            e.preventDefault();
            slot.classList.remove('qb-drop-target');
            if (!this.draggedItem) return;
            this.dropHandled = true;
            if (this.dragSource === 'quickbar' && this.dragStartSlot !== null) {
                this.swapQuickbarItems(this.dragStartSlot, index);
            } else {
                this.assignItemToQuickbar(this.draggedItem, index);
            }
        });
    }
    
    setupDrawerKeyboardNavigation() {
        // Remove existing listeners
        document.removeEventListener('keydown', this.drawerKeyHandler);
        
        // Create new handler
        this.drawerKeyHandler = (e) => {
            if (!this.isDrawerOpen) return;

            // Number keys 1-9 select target slot directly.
            if (e.key >= '1' && e.key <= '9') {
                e.preventDefault();
                this.selectedDrawerSlot = parseInt(e.key, 10) - 1;
                this.updateDrawerSelection();
                return;
            }

            switch(e.key) {
                case 'Tab':
                    e.preventDefault();
                    this.selectedDrawerSlot = e.shiftKey
                        ? (this.selectedDrawerSlot + 8) % 9
                        : (this.selectedDrawerSlot + 1) % 9;
                    this.updateDrawerSelection();
                    break;
                case 'Delete':
                case 'Backspace':
                    e.preventDefault();
                    this.clearQuickbarSlot(this.selectedDrawerSlot);
                    break;
                case 'Escape':
                    this.isDrawerOpen = false;
                    this.hideDrawerCursor();
                    this.updateDrawerUI();
                    break;
            }
        };
        
        document.addEventListener('keydown', this.drawerKeyHandler);
    }
    
    updateDrawerSelection() {
        // Highlight the currently targeted slot in the drawer strip.
        const strip = document.getElementById('drawer-slot-strip');
        if (!strip) return;
        strip.querySelectorAll('.qb-strip').forEach((el, i) => {
            el.classList.toggle('qb-target', i === this.selectedDrawerSlot);
        });
    }
    
    loadQuickbarLayout() {
        this.quickbarLayout = this.defaultQuickbarLayout();

        // Versioned storage key so old saved layouts (with machineGun, etc.)
        // are discarded instead of silently shown.
        const saved = localStorage.getItem('pjboy_quickbar_layout_v2');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                const valid = new Set([...Object.keys(this.WEAPON_STATS), ...Object.keys(this.ITEM_DEFS)]);
                this.quickbarLayout = parsed.map(id => (valid.has(id) ? id : null));
                while (this.quickbarLayout.length < 9) this.quickbarLayout.push(null);
                this.quickbarLayout = this.quickbarLayout.slice(0, 9);
            } catch (e) {
                console.warn('Failed to load quickbar layout:', e);
            }
        }
    }

    // Curated default. Slot 3 is reserved for jetpack so the fuel stack is
    // always visible at a fixed key when the player is carrying any.
    defaultQuickbarLayout() {
        const layout = ['diamondSword', 'gun', 'jetpack', 'health', 'ammo', 'speed', 'weaponBuff', 'healthRegen', 'flag'];
        const valid = new Set([...Object.keys(this.WEAPON_STATS), ...Object.keys(this.ITEM_DEFS)]);
        return layout.map(id => (valid.has(id) ? id : null));
    }

    saveQuickbarLayout() {
        localStorage.setItem('pjboy_quickbar_layout_v2', JSON.stringify(this.quickbarLayout));
    }
    
    showToast(message, type = 'info', duration = 3000) {
        const toast = {
            id: this.toastId++,
            message: message,
            type: type, // 'info', 'success', 'warning', 'error'
            duration: duration,
            startTime: Date.now(),
            element: null
        };
        
        this.toasts.push(toast);
        this.createToastElement(toast);
        
        // Auto-remove after duration
        setTimeout(() => {
            this.removeToast(toast.id);
        }, duration);
    }
    
    createToastElement(toast) {
        const toastEl = document.createElement('div');
        toastEl.id = `toast-${toast.id}`;
        toastEl.style.position = 'fixed';
        toastEl.style.top = '20px';
        toastEl.style.left = '50%';
        toastEl.style.transform = 'translateX(-50%)';
        toastEl.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.9), rgba(42,24,8,0.9))';
        toastEl.style.border = '2px solid #ffb347';
        toastEl.style.borderRadius = '8px';
        toastEl.style.padding = '12px 20px';
        toastEl.style.color = '#ffb347';
        toastEl.style.fontFamily = 'Courier New, monospace';
        toastEl.style.fontSize = '14px';
        toastEl.style.fontWeight = 'bold';
        toastEl.style.zIndex = '10000';
        toastEl.style.boxShadow = '0 4px 20px rgba(255,179,71,0.3)';
        toastEl.style.opacity = '0';
        toastEl.style.transition = 'all 0.3s ease';
        toastEl.style.maxWidth = '400px';
        toastEl.style.textAlign = 'center';
        toastEl.style.wordWrap = 'break-word';
        
        // Set type-specific styling
        switch (toast.type) {
            case 'success':
                toastEl.style.border = '2px solid #ffb347';
                toastEl.style.color = '#ffb347';
                toastEl.style.boxShadow = '0 4px 20px rgba(0,255,0,0.3)';
                break;
            case 'warning':
                toastEl.style.border = '2px solid #ffaa00';
                toastEl.style.color = '#ffaa00';
                toastEl.style.boxShadow = '0 4px 20px rgba(255,170,0,0.3)';
                break;
            case 'error':
                toastEl.style.border = '2px solid #ff4444';
                toastEl.style.color = '#ff4444';
                toastEl.style.boxShadow = '0 4px 20px rgba(255,68,68,0.3)';
                break;
        }
        
        toastEl.innerHTML = toast.message;
        document.body.appendChild(toastEl);
        toast.element = toastEl;
        
        // Animate in
        setTimeout(() => {
            toastEl.style.opacity = '1';
            toastEl.style.transform = 'translateX(-50%) translateY(0)';
        }, 10);
    }
    
    removeToast(toastId) {
        const toastIndex = this.toasts.findIndex(t => t.id === toastId);
        if (toastIndex === -1) return;
        
        const toast = this.toasts[toastIndex];
        if (toast.element) {
            // Animate out
            toast.element.style.opacity = '0';
            toast.element.style.transform = 'translateX(-50%) translateY(-20px)';
            
            setTimeout(() => {
                if (toast.element && toast.element.parentNode) {
                    toast.element.parentNode.removeChild(toast.element);
                }
            }, 300);
        }
        
        this.toasts.splice(toastIndex, 1);
    }
    
    updateToasts() {
        // Update toast positions to stack them
        this.toasts.forEach((toast, index) => {
            if (toast.element) {
                const offset = index * 60; // 60px spacing between toasts
                toast.element.style.top = `${20 + offset}px`;
            }
        });
    }
    
    // The drawer used to hide the system cursor and overlay a glowing ring.
    // That made the cursor invisible (and confusing) while interacting with
    // drawer items, so we now keep the OS cursor visible at all times.
    showDrawerCursor() { document.body.style.cursor = 'default'; }
    hideDrawerCursor() { document.body.style.cursor = ''; }
    updateDrawerCursorPosition = () => {};

    swapQuickbarItems(fromSlot, toSlot) {
        if (fromSlot === toSlot) return;

        const temp = this.quickbarLayout[fromSlot];
        this.quickbarLayout[fromSlot] = this.quickbarLayout[toSlot];
        this.quickbarLayout[toSlot] = temp;

        this.saveQuickbarLayout();
        this._qbSig = null;
        this.updateInventoryGridUI();
        if (this.isDrawerOpen) this.updateDrawerUI();

        this.showMessage(`Swapped slots ${fromSlot + 1} ↔ ${toSlot + 1}`);
    }
    
    updateCompassUI() {
        // Only show in play mode
        if (this.gameMode !== 'play') {
            return;
        }
        
        // Create or update compass UI (bottom right)
        let hud = document.getElementById('compass-ui');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'compass-ui';
            hud.style.position = 'absolute';
            hud.style.bottom = '20px';
            hud.style.right = '20px';
            hud.style.background = 'rgba(0,0,0,0.8)';
            hud.style.border = '2px solid #ffb347';
            hud.style.borderRadius = '8px';
            hud.style.padding = '12px 16px';
            hud.style.color = '#ffb347';
            hud.style.fontFamily = 'Courier New, monospace';
            hud.style.fontSize = '16px';
            hud.style.fontWeight = 'bold';
            hud.style.zIndex = '1000';
            hud.style.width = '120px';
            hud.style.height = '120px';
            hud.style.display = 'flex';
            hud.style.alignItems = 'center';
            hud.style.justifyContent = 'center';
            document.body.appendChild(hud);
        }
        
        // Calculate player facing direction
        const facingAngle = this.characterRotation * (180 / Math.PI);
        const normalizedAngle = ((facingAngle % 360) + 360) % 360;
        
        // Determine cardinal direction
        let direction = '';
        let directionSymbol = '';
        if (normalizedAngle >= 337.5 || normalizedAngle < 22.5) {
            direction = this.t('north');
            directionSymbol = '↑';
        } else if (normalizedAngle >= 22.5 && normalizedAngle < 67.5) {
            direction = this.t('northeast');
            directionSymbol = '↗';
        } else if (normalizedAngle >= 67.5 && normalizedAngle < 112.5) {
            direction = this.t('east');
            directionSymbol = '→';
        } else if (normalizedAngle >= 112.5 && normalizedAngle < 157.5) {
            direction = this.t('southeast');
            directionSymbol = '↘';
        } else if (normalizedAngle >= 157.5 && normalizedAngle < 202.5) {
            direction = this.t('south');
            directionSymbol = '↓';
        } else if (normalizedAngle >= 202.5 && normalizedAngle < 247.5) {
            direction = this.t('southwest');
            directionSymbol = '↙';
        } else if (normalizedAngle >= 247.5 && normalizedAngle < 292.5) {
            direction = this.t('west');
            directionSymbol = '←';
        } else if (normalizedAngle >= 292.5 && normalizedAngle < 337.5) {
            direction = this.t('northwest');
            directionSymbol = '↖';
        }
        
        hud.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 24px; margin-bottom: 4px;">${directionSymbol}</div>
                <div style="font-size: 12px; opacity: 0.8; margin-bottom: 2px;">${direction.toUpperCase()}</div>
                <div style="font-size: 10px; opacity: 0.6;">${Math.round(normalizedAngle)}°</div>
            </div>
        `;
        hud.style.display = 'flex';
    }
    
    updateCrosshairUI() {
        // Only show crosshair in FPV play mode
        const shouldShow = (this.gameMode === 'play' && this.viewMode === 'fpv');
        const htmlCrosshair = document.getElementById('crosshair');

        if (!htmlCrosshair) return;

        let dot = htmlCrosshair.querySelector('div');
        if (!dot) {
            htmlCrosshair.innerHTML = `
                <div style="position: absolute; top: 50%; left: 50%; width: 8px; height: 8px; background: #ffb347; box-shadow: 0 0 10px #ffb347, 0 0 20px #ffb347; border-radius: 50%; transform: translate(-50%, -50%);"></div>
            `;
            dot = htmlCrosshair.querySelector('div');
        }

        htmlCrosshair.style.display = shouldShow ? 'block' : 'none';

        if (shouldShow && dot && this.camera) {
            // Cheap aim-on-enemy test: cast a ray from camera center.
            const rc = this._cxRaycaster || (this._cxRaycaster = new THREE.Raycaster());
            rc.setFromCamera({ x: 0, y: 0 }, this.camera);
            const onEnemy = this.playMode && this.playMode.enemies
                ? rc.intersectObjects(this.playMode.enemies, true).length > 0
                : false;
            const color = onEnemy ? '#ff4444' : '#ffb347';
            dot.style.background = color;
            dot.style.boxShadow = `0 0 10px ${color}, 0 0 20px ${color}`;
        }
    }
    
    createGroundTargetIndicator() {
        // Create a ground target indicator for isometric view
        if (this.groundTargetIndicator) {
            this.scene.remove(this.groundTargetIndicator);
        }
        
        // Create outer ring
        const outerGeometry = new THREE.RingGeometry(1.2, 1.5, 32);
        const outerMaterial = new THREE.MeshBasicMaterial({
            color: 0xffb347,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
        
        // Create inner ring
        const innerGeometry = new THREE.RingGeometry(0.8, 1.0, 32);
        const innerMaterial = new THREE.MeshBasicMaterial({
            color: 0xffb347,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide
        });
        const innerRing = new THREE.Mesh(innerGeometry, innerMaterial);
        
        // Create center dot
        const dotGeometry = new THREE.CircleGeometry(0.3, 16);
        const dotMaterial = new THREE.MeshBasicMaterial({
            color: 0xffb347,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        const centerDot = new THREE.Mesh(dotGeometry, dotMaterial);
        
        // Group all parts
        this.groundTargetIndicator = new THREE.Group();
        this.groundTargetIndicator.add(outerRing);
        this.groundTargetIndicator.add(innerRing);
        this.groundTargetIndicator.add(centerDot);
        
        // Position exactly on ground level
        this.groundTargetIndicator.position.y = 0;
        
        // Rotate to be horizontal (flat on ground)
        this.groundTargetIndicator.rotation.x = -Math.PI / 2; // Rotate 90 degrees to lay flat
        
        // Initially hidden
        this.groundTargetIndicator.visible = false;
        
        this.scene.add(this.groundTargetIndicator);
    }
    
    updateGroundTargetIndicator() {
        // Only show in isometric, birds-eye, and ghost play modes
        const shouldShow = (this.gameMode === 'play' && (this.viewMode === 'iso' || this.viewMode === 'birds-eye' || this.viewMode === 'ghost'));
        
        
        if (!this.groundTargetIndicator) {
            this.createGroundTargetIndicator();
        }
        
        if (shouldShow) {
            // Use raycaster to find ground intersection
            const mouse = new THREE.Vector2();
            // Use the correct mouse tracking from playMode
            mouse.x = this.playMode.mouseNDC.x;
            mouse.y = this.playMode.mouseNDC.y;
            
            
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, this.camera);
            
            // Create ground plane for intersection
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const intersectionPoint = new THREE.Vector3();
            const intersects = raycaster.ray.intersectPlane(groundPlane, intersectionPoint);
            
            
            if (intersects) {
                this.groundTargetIndicator.position.x = intersectionPoint.x;
                this.groundTargetIndicator.position.z = intersectionPoint.z;
                this.groundTargetIndicator.visible = true;
            } else {
                this.groundTargetIndicator.visible = false;
            }
        } else {
            this.groundTargetIndicator.visible = false;
        }
    }
    
    updateGhostCamera(deltaTime) {
        // Ghost camera movement controls
        const speed = this.ghostCamera.speed;
        const moveSpeed = speed * deltaTime;
        
        // Calculate movement direction based on camera quaternion
        const forward = new THREE.Vector3(0, 0, -1);
        const right = new THREE.Vector3(1, 0, 0);
        const up = new THREE.Vector3(0, 1, 0);
        
        // Apply camera quaternion to movement vectors
        forward.applyQuaternion(this.ghostCamera.quaternion);
        right.applyQuaternion(this.ghostCamera.quaternion);
        up.applyQuaternion(this.ghostCamera.quaternion);
        
        // Movement input
        const movement = new THREE.Vector3();
        
        if (this.keys['KeyW']) movement.add(forward);
        if (this.keys['KeyS']) movement.sub(forward);
        if (this.keys['KeyA']) movement.sub(right);
        if (this.keys['KeyD']) movement.add(right);
        if (this.keys['KeyQ']) movement.sub(up); // Q = down
        if (this.keys['KeyE']) movement.add(up); // E = up
        if (this.keys['Space']) movement.add(up); // Space = up (height increase)
        
        // Apply movement
        movement.multiplyScalar(moveSpeed);
        this.ghostCamera.position.add(movement);
        
        // Mouse look (only when pointer is locked)
        if (this.isPointerLocked) {
            // Mouse look is handled in mousemove event
        }
    }
    
    
    updatePowerUps(deltaTime) {
        // Health regeneration
        if (this.powerUps.healthRegen > 0) {
            const regenAmount = this.powerUps.healthRegen * 2 * deltaTime; // 2 HP per second per stack
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + regenAmount);
        }
        
        // Speed boost (temporary effect)
        if (this.powerUps.speedBoost > 0) {
            // Speed boost is handled in movement code
        }
        
        // Jetpack fuel consumption
        if (this.isJetpackActive && this.powerUps.jetpackFuel > 0) {
            this.powerUps.jetpackFuel -= 20 * deltaTime; // 20 fuel per second
            if (this.powerUps.jetpackFuel <= 0) {
                this.powerUps.jetpackFuel = 0;
                this.isJetpackActive = false;
                this.showMessage(this.t('jetpackEmpty'));
            }
        }
    }
    
    updateWeaponCooldowns(deltaTime) {
        let hudNeedsUpdate = false;
        for (const weaponId in this.weaponCooldowns) {
            if (this.weaponCooldowns[weaponId] > 0) {
                this.weaponCooldowns[weaponId] -= deltaTime;
                if (this.weaponCooldowns[weaponId] <= 0) {
                    this.weaponCooldowns[weaponId] = 0;
                    hudNeedsUpdate = true; // HUD needs update when cooldown finishes
                }
            }
        }
        
        // Throttled UI updates for cooldowns (≤10 Hz)
        const now = Date.now();
        if (hudNeedsUpdate || (now - this.lastCooldownUpdate) >= this.cooldownUpdateInterval) {
            this.emit('ui:update', this.buildHUDModel());
            this.lastCooldownUpdate = now;
        }
    }
    
    
    handleContinuousFiring(deltaTime) {
        if (!this.isFiring || this.gameMode !== 'play') return;
        
        const weapon = this.getCurrentWeapon();
        if (!weapon || !weapon.isContinuous) return;
        
        // Check if we can fire (cooldown and ammo)
        const weaponId = this.player.weapons[this.player.currentWeaponIndex];
        if (this.weaponCooldowns[weaponId] && this.weaponCooldowns[weaponId] > 0) return;
        
        if (weapon.ammoCost > 0 && this.inventory.ammo < weapon.ammoCost) {
            this.isFiring = false; // Stop firing if no ammo
            return;
        }
        
        // Fire the weapon
        this.attackWithWeapon();
    }

    ensureMessageElement() {
        let el = document.getElementById('objective-msg');
        if (!el) {
            el = document.createElement('div');
            el.id = 'objective-msg';
            el.style.position = 'absolute';
            el.style.top = '50px';
            el.style.left = '50%';
            el.style.transform = 'translateX(-50%)';
            el.style.padding = '6px 12px';
            el.style.background = 'rgba(0,0,0,0.7)';
            el.style.border = '2px solid #ffb347';
            el.style.color = '#ffb347';
            el.style.fontFamily = 'Courier New, monospace';
            el.style.fontSize = '14px';
            el.style.zIndex = '2000';
            el.style.display = 'none';
            document.body.appendChild(el);
        }
        return el;
    }

    showMessage(text, duration = 1500) {
        const el = this.ensureMessageElement();
        el.textContent = text;
        el.style.display = 'block';
        clearTimeout(this._msgTimer);
        this._msgTimer = setTimeout(() => { el.style.display = 'none'; }, duration);
    }

    // ================= ARENA / WAVE MODE =================
    startArenaMode() {
        // Tear down current maze + reset world
        if (this.clearMaze) this.clearMaze();
        if (this.clearEnemies) this.clearEnemies();
        this._clearArenaObjects();

        const a = this.arena;
        a.active = true;
        a.phase = 'intro';
        a.introTimer = 0;
        a.introLastLabel = null;
        a.wave = 1;
        a.enemiesSpawnedThisWave = 0;
        a.enemiesToSpawn = 4 + a.wave * 2;
        a.spawnTimer = 0;
        a.spawnInterval = 1.4;
        a.eruptionTimer = 0;
        a.waveCompleteTimer = 0;
        a.boss = null;
        a.lava.y = a.lava.restY;
        a.lava.rising = false;
        a.lava.riseSpeed = 0;
        a.lava.tickTimer = 0;
        a.shake.intensity = 0;
        a.shake.duration = 0;
        a.shake.elapsed = 0;

        // Build geometry
        this.buildArena();

        // Reset player loadout
        this.player.position.set(0, 0, 0);
        this.player.velocity.set(0, 0, 0);
        this.player.hp = this.player.maxHp || 100;
        this.player.invulnerable = false;
        this.player.invulnerabilityTimer = 0;
        this.characterRotation = 0;
        if (this.player.weapons) {
            this.player.weapons = ['diamondSword', 'gun'];
            this.player.currentWeaponIndex = 0;
        }
        if (this.inventory) this.inventory.ammo = 100;
        this.score = 0;
        this.kills = 0;

        // Make sure we're in play mode controls
        this.gameMode = 'play';

        // The big centered overlay now does the talking — no toast needed here.
        this.audio && this.audio.play('uiClick');
    }

    exitArenaMode() {
        if (!this.arena || !this.arena.active) return;
        this.arena.active = false;
        this.arena.phase = 'idle';
        this._clearArenaObjects();
        if (this.clearEnemies) this.clearEnemies();
        if (this.rebuildMaze) this.rebuildMaze();
    }

    _clearArenaObjects() {
        const a = this.arena;
        if (!a) return;
        if (a.arenaObjects && a.arenaObjects.length) {
            for (const o of a.arenaObjects) {
                if (o && o.parent) o.parent.remove(o);
            }
        }
        a.arenaObjects = [];
        // Strip perimeter walls + pillars from this.walls
        if ((a.perimeterWalls && a.perimeterWalls.length) || (a.pillars && a.pillars.length)) {
            const drop = new Set([...(a.perimeterWalls || []), ...(a.pillars || [])]);
            this.walls = this.walls.filter(w => !drop.has(w));
        }
        a.perimeterWalls = [];
        a.pillars = [];
        a.decor = [];
        // Despawn live volcano particles
        if (a.volcanoParticles && a.volcanoParticles.length) {
            for (const p of a.volcanoParticles) {
                if (p && p.parent) p.parent.remove(p);
            }
            a.volcanoParticles = [];
        }
        a.boss = null;
        a.volcano = null;
        a.lava.mesh = null;
    }

    buildArena() {
        const a = this.arena;
        const half = a.arenaHalf;

        // 1. Perimeter walls (collision boundary, cosmetic)
        const wallThickness = 1.2;
        const wallHeight = 6;
        const perimLen = half * 2 + wallThickness * 2;
        const wallSpecs = [
            { x: 0, z: -half - wallThickness / 2, sx: perimLen, sz: wallThickness },
            { x: 0, z:  half + wallThickness / 2, sx: perimLen, sz: wallThickness },
            { x: -half - wallThickness / 2, z: 0, sx: wallThickness, sz: perimLen },
            { x:  half + wallThickness / 2, z: 0, sx: wallThickness, sz: perimLen },
        ];
        for (const spec of wallSpecs) {
            let mesh = this.createBrickWallMesh ? this.createBrickWallMesh(spec.sx, wallHeight, spec.sz) : null;
            if (!mesh) {
                mesh = new THREE.Mesh(
                    new THREE.BoxGeometry(spec.sx, wallHeight, spec.sz),
                    new THREE.MeshLambertMaterial({ color: 0x553322, emissive: 0x110803 })
                );
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            }
            mesh.position.set(spec.x, wallHeight / 2, spec.z);
            this.scene.add(mesh);
            const entry = {
                mesh,
                position: mesh.position,
                size: { x: spec.sx, y: wallHeight, z: spec.sz }
            };
            this.walls.push(entry);
            a.perimeterWalls.push(entry);
            a.arenaObjects.push(mesh);
        }

        // 2. Procedural pixel-block platforms (always within jump distance of each other)
        const platforms = this._generatePlatformLayout({
            count: 11,
            arenaRadius: half - 5,
            minSeparation: 3.6,
            maxJumpGap: 5.5,
        });
        const blockKeys = ['stone', 'darkBrick', 'wood', 'dirt'];
        for (let i = 0; i < platforms.length; i++) {
            const p = platforms[i];
            const blockKey = blockKeys[i % blockKeys.length];
            const heightTiles = p.heightTiles;
            const footTiles = 2; // 2x2 blocks (3 units wide)
            let group, footprint, height;
            const built = this._buildBlockPlatform(footTiles, heightTiles, blockKey);
            if (built) {
                group = built.group;
                footprint = built.footprint;
                height = built.height;
            } else {
                // Fallback: stone-grey cylinder if templates haven't loaded yet
                footprint = 3.0;
                height = heightTiles * 1.5;
                group = new THREE.Group();
                const geo = new THREE.CylinderGeometry(footprint / 2, footprint / 2, height, 16);
                const mat = new THREE.MeshLambertMaterial({ color: 0x5a4232, emissive: 0x140805 });
                const m = new THREE.Mesh(geo, mat);
                m.position.y = height / 2;
                m.castShadow = true;
                m.receiveShadow = true;
                group.add(m);
            }
            group.position.set(p.x, 0, p.z);
            this.scene.add(group);
            // Collision math uses size.y as the FULL height and treats position.y
            // as the CENTER. Blocks span world [0, height], so center is height/2.
            const collisionPos = new THREE.Vector3(p.x, height / 2, p.z);
            const entry = {
                mesh: group,
                position: collisionPos,
                size: { x: footprint, y: height, z: footprint }
            };
            this.walls.push(entry);
            a.pillars.push(entry);
            a.arenaObjects.push(group);
        }

        // 3. Volcano at the back of the arena
        const volcGroup = new THREE.Group();
        volcGroup.position.set(0, 0, -half - 8);
        const baseCone = new THREE.Mesh(
            new THREE.ConeGeometry(7.5, 13, 18),
            new THREE.MeshLambertMaterial({ color: 0x3a2418, emissive: 0x110703, flatShading: true })
        );
        baseCone.position.y = 6.5;
        baseCone.castShadow = true;
        baseCone.receiveShadow = true;
        volcGroup.add(baseCone);
        const crater = new THREE.Mesh(
            new THREE.ConeGeometry(2.5, 1.4, 14),
            new THREE.MeshBasicMaterial({ color: 0xff5a14 })
        );
        crater.position.y = 13.2;
        crater.rotation.x = Math.PI;
        volcGroup.add(crater);
        const volcLight = new THREE.PointLight(0xff6622, 0, 28, 2);
        volcLight.position.set(0, 13.5, 0);
        volcGroup.add(volcLight);
        a.volcano = {
            group: volcGroup,
            light: volcLight,
            craterTop: new THREE.Vector3(0, 13.5, -half - 8)
        };
        this.scene.add(volcGroup);
        a.arenaObjects.push(volcGroup);

        // 4. Lava plane — hidden far below ground initially
        const lavaGeo = new THREE.PlaneGeometry(half * 2 + 4, half * 2 + 4);
        const lavaMat = new THREE.MeshBasicMaterial({
            color: 0xff4411, transparent: true, opacity: 0.92, side: THREE.DoubleSide
        });
        const lava = new THREE.Mesh(lavaGeo, lavaMat);
        lava.rotation.x = -Math.PI / 2;
        lava.position.set(0, a.lava.restY, 0);
        this.scene.add(lava);
        a.lava.mesh = lava;
        a.lava.y = a.lava.restY;
        a.arenaObjects.push(lava);

        // 5. Dress the area with trees, animals, rocks, chests
        this._placeArenaDecor();
    }

    // Generates a list of platform spots — first one near center, every subsequent
    // platform is required to be within maxJumpGap of an existing platform so the
    // player can always hop from one to the next.
    _generatePlatformLayout({ count, arenaRadius, minSeparation, maxJumpGap }) {
        const platforms = [];
        const minSep2 = minSeparation * minSeparation;
        // Seed platform near center — keep it tall so it's a safe haven
        platforms.push({ x: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6, heightTiles: 2 });
        while (platforms.length < count) {
            let placed = false;
            for (let tries = 0; tries < 200 && !placed; tries++) {
                const parent = platforms[Math.floor(Math.random() * platforms.length)];
                const ang = Math.random() * Math.PI * 2;
                const dist = (minSeparation + 0.6) + Math.random() * (maxJumpGap - minSeparation - 0.6);
                const x = parent.x + Math.cos(ang) * dist;
                const z = parent.z + Math.sin(ang) * dist;
                if (Math.hypot(x, z) > arenaRadius) continue;
                let bad = false;
                for (const p of platforms) {
                    const dx = p.x - x, dz = p.z - z;
                    if (dx*dx + dz*dz < minSep2) { bad = true; break; }
                }
                if (bad) continue;
                // Height tier: mix of 1, 2, 3 blocks (1.5 / 3 / 4.5 units tall)
                const tierRoll = Math.random();
                const heightTiles = tierRoll < 0.40 ? 1 : (tierRoll < 0.80 ? 2 : 3);
                platforms.push({ x, z, heightTiles });
                placed = true;
            }
            if (!placed) break; // arena too crowded — stop early
        }
        return platforms;
    }

    // Scatter trees / animals / rocks / chests / flowers around the arena floor
    // and outside the perimeter walls. Animals get a soft idle wobble.
    _placeArenaDecor() {
        const a = this.arena;
        const tpls = this._decorTemplates;
        if (!tpls) return;
        const half = a.arenaHalf;

        const placeOnce = (key, x, z, opts = {}) => {
            const src = tpls[key];
            if (!src) return null;
            // Skip if it would land on a platform or volcano
            for (const w of a.pillars) {
                if (Math.abs(w.position.x - x) < (w.size.x / 2 + 1) &&
                    Math.abs(w.position.z - z) < (w.size.z / 2 + 1)) return null;
            }
            const clone = THREE.SkeletonUtils
                ? THREE.SkeletonUtils.clone(src)
                : src.clone(true);
            // Normalize scale based on assumed ~2 unit native blocks
            const scale = opts.scale != null ? opts.scale : 1.0;
            clone.scale.setScalar(scale);
            clone.position.set(x, opts.y != null ? opts.y : 0, z);
            clone.rotation.y = Math.random() * Math.PI * 2;
            clone.traverse((c) => {
                if (c.isMesh) {
                    c.castShadow = true;
                    c.receiveShadow = true;
                }
            });
            this.scene.add(clone);
            a.decor.push(clone);
            a.arenaObjects.push(clone);
            return clone;
        };

        // --- Outside the perimeter: trees + animals (forest ring) ---
        const ringMinR = half + 4;
        const ringMaxR = half + 16;
        const sampleRing = () => {
            const ang = Math.random() * Math.PI * 2;
            const r = ringMinR + Math.random() * (ringMaxR - ringMinR);
            return { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
        };

        const treeKeys = ['tree1', 'tree2', 'tree3'];
        for (let i = 0; i < 28; i++) {
            const p = sampleRing();
            const key = treeKeys[Math.floor(Math.random() * treeKeys.length)];
            placeOnce(key, p.x, p.z, { scale: 1.1 + Math.random() * 0.5 });
        }
        // A few animals just outside the wall — wandering peacefully
        const animalKeys = ['sheep', 'pig', 'chicken', 'cat'];
        for (let i = 0; i < 8; i++) {
            const p = sampleRing();
            const key = animalKeys[Math.floor(Math.random() * animalKeys.length)];
            const animal = placeOnce(key, p.x, p.z, { scale: 0.9 + Math.random() * 0.3 });
            if (animal) {
                animal.userData = animal.userData || {};
                animal.userData._anim = {
                    home: new THREE.Vector3(p.x, 0, p.z),
                    t: Math.random() * Math.PI * 2,
                    wobble: 0.4 + Math.random() * 0.3,
                };
            }
        }

        // --- Inside the arena: sparse decor near the edges so combat space stays clear ---
        const sampleInner = () => {
            // Donut between r=half-9 and r=half-2
            const ang = Math.random() * Math.PI * 2;
            const r = (half - 9) + Math.random() * 7;
            return { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
        };

        // Dead trees inside (matches volcanic theme)
        for (let i = 0; i < 5; i++) {
            const p = sampleInner();
            const key = Math.random() < 0.5 ? 'deadTree1' : 'deadTree2';
            placeOnce(key, p.x, p.z, { scale: 0.9 + Math.random() * 0.4 });
        }
        // Rocks
        for (let i = 0; i < 6; i++) {
            const p = sampleInner();
            const key = Math.random() < 0.5 ? 'rock1' : 'rock2';
            placeOnce(key, p.x, p.z, { scale: 0.8 + Math.random() * 0.6 });
        }
        // Bushes + flowers + grass tufts
        const flora = ['bush', 'flowers1', 'flowers2', 'grassBig', 'mushroom'];
        for (let i = 0; i < 14; i++) {
            const p = sampleInner();
            const key = flora[Math.floor(Math.random() * flora.length)];
            placeOnce(key, p.x, p.z, { scale: 0.8 + Math.random() * 0.5 });
        }
        // Chests / crates — possible loot vibes; cosmetic only
        for (let i = 0; i < 4; i++) {
            const p = sampleInner();
            const key = Math.random() < 0.6 ? 'chest' : 'crate';
            placeOnce(key, p.x, p.z, { scale: 0.9 + Math.random() * 0.3 });
        }
    }

    spawnArenaEnemy() {
        if (!this.arena.active) return;
        if (this.playMode.enemies.length >= this.maxEnemies) return;
        const half = this.arena.arenaHalf;
        const ang = Math.random() * Math.PI * 2;
        const r = half - 2.5;
        const x = Math.cos(ang) * r;
        const z = Math.sin(ang) * r;
        const m = this.createEnemyAt(x, z);
        m.userData.speed = 1.6 + Math.random() * 1.0;
        // Bias direction toward center on spawn
        const toC = new THREE.Vector2(-x, -z); if (toC.lengthSq() > 0) toC.normalize();
        m.userData.dir = toC;
        this.playMode.enemiesGroup.add(m);
        this.playMode.enemies.push(m);
        this.arena.enemiesSpawnedThisWave++;
    }

    spawnBoss() {
        // Boss rises from lava roughly in front of the volcano
        const bossZ = -Math.min(12, this.arena.arenaHalf - 8);
        const m = this.createEnemyAt(0, bossZ);
        m.scale.setScalar(2.4);
        m.traverse((child) => {
            if (child.isMesh && child.material && child.material.color) {
                child.material = child.material.clone();
                child.material.color.lerp(new THREE.Color(0xaa1818), 0.65);
                if (child.material.emissive) {
                    child.material.emissive = new THREE.Color(0x441010);
                }
            }
        });
        m.userData.hp = 400;
        m.userData.hpMax = 400;
        m.userData.speed = 2.4;
        m.userData.isBoss = true;
        m.userData.bodyColor = 0xaa1818;
        m.userData.hitRadius = (m.userData.hitRadius || 0.8) * 2.2;
        m.userData.hitHeight = (m.userData.hitHeight || 1.8) * 2.2;
        if (m.userData.hpBar) {
            m.userData.hpBar.position.y = (m.userData.hitHeight || 4) + 0.4;
        }
        // Boss emerges from lava center
        m.position.y = -3;
        m.userData.bossRise = 1.2;
        this.playMode.enemiesGroup.add(m);
        this.playMode.enemies.push(m);
        this.arena.boss = m;
        this.audio && this.audio.play('enemyDeath');
        this.showMessage('⚠ BOSS APPROACHES', 1800);
    }

    triggerEruption() {
        const a = this.arena;
        a.phase = 'eruption';
        a.eruptionTimer = 0;
        a.shake.intensity = 0.6;
        a.shake.duration = a.eruptionDuration;
        a.shake.elapsed = 0;
        a.lava.rising = true;
        a.lava.targetY = a.lava.peakY;
        if (a.volcano && a.volcano.light) {
            a.volcano.light.intensity = 4.5;
        }
        // Emit an initial burst of particles
        for (let i = 0; i < 24; i++) this._emitVolcanoParticle();
        this.audio && this.audio.play('gameOver');
        this.showMessage('🌋 THE GROUND SHAKES — VOLCANO ERUPTS!', 2200);
    }

    endEruption() {
        const a = this.arena;
        a.phase = 'boss-fight';
        // Lava keeps creeping up during the boss fight — by ~0.18 u/s it will
        // submerge the shortest platforms within ~10s and tallest within ~30s.
        a.lava.riseSpeed = 0.18;
        if (a.volcano && a.volcano.light) {
            a.volcano.light.intensity = 2.5;
        }
        this.spawnBoss();
    }

    onArenaBossKilled() {
        const a = this.arena;
        if (!a || !a.active) return;
        a.phase = 'wave-complete';
        a.waveCompleteTimer = 0;
        a.lava.rising = false;
        a.lava.riseSpeed = -40.0; // fast recede back below ground
        if (a.volcano && a.volcano.light) {
            a.volcano.light.intensity = 0;
        }
        // Drop a couple of pickups for the next wave
        if (this.spawnPickup) {
            this.spawnPickup(this.player.position.x + 1.2, this.player.position.z + 0.4);
            this.spawnPickup(this.player.position.x - 1.2, this.player.position.z - 0.4);
        }
        this.showMessage(`Wave ${a.wave} cleared!`, 1800);
        this.audio && this.audio.play('levelComplete');
    }

    startNextWave() {
        const a = this.arena;
        a.wave++;
        a.phase = 'wave-active';
        a.enemiesSpawnedThisWave = 0;
        a.enemiesToSpawn = 4 + a.wave * 2;
        a.spawnTimer = 0;
        a.boss = null;
        a.spawnInterval = Math.max(0.55, 1.4 - a.wave * 0.06);
        this.showMessage(`Wave ${a.wave}`, 1500);
    }

    updateArena(deltaTime) {
        if (!this.arena || !this.arena.active) return;
        this._updateVolcanoParticles(deltaTime);
        this._updateCameraShake(deltaTime);
        this._updateLava(deltaTime);
        this._updateLavaDamage(deltaTime);
        this._updateBossRise(deltaTime);
        this._updateArenaDecor(deltaTime);

        const a = this.arena;
        switch (a.phase) {
            case 'intro': {
                a.introTimer += deltaTime;
                // Player can't be hurt during the countdown
                this.player.invulnerable = true;
                this.player.invulnerabilityTimer = Math.max(this.player.invulnerabilityTimer, 0.1);
                // Beep on each tick boundary
                const ticks = [1.0, 2.0, 3.0, 4.0];
                const prevTick = ticks.findIndex(t => a.introTimer - deltaTime < t && a.introTimer >= t);
                if (prevTick >= 0) {
                    this.audio && this.audio.play(prevTick === 3 ? 'pickupFlag' : 'uiHover');
                }
                if (a.introTimer >= a.introDuration) {
                    a.phase = 'wave-active';
                    a.spawnTimer = a.spawnInterval; // spawn first enemy promptly
                    this.player.invulnerable = false;
                    this.player.invulnerabilityTimer = 0;
                }
                return; // skip the wave loop while the countdown plays
            }
            case 'wave-active': {
                if (a.enemiesSpawnedThisWave < a.enemiesToSpawn) {
                    a.spawnTimer += deltaTime;
                    if (a.spawnTimer >= a.spawnInterval) {
                        a.spawnTimer = 0;
                        this.spawnArenaEnemy();
                    }
                } else if (this.playMode.enemies.length === 0) {
                    this.triggerEruption();
                }
                break;
            }
            case 'eruption': {
                a.eruptionTimer += deltaTime;
                // Continuous particle stream during eruption
                if (Math.random() < 0.7) this._emitVolcanoParticle();
                if (a.eruptionTimer >= a.eruptionDuration) {
                    this.endEruption();
                }
                break;
            }
            case 'boss-fight': {
                if (Math.random() < 0.08) this._emitVolcanoParticle();
                // Boss death detection is done in killEnemy → onArenaBossKilled
                break;
            }
            case 'wave-complete': {
                a.waveCompleteTimer += deltaTime;
                if (a.lava.y <= a.lava.restY + 0.05 && a.waveCompleteTimer > 2.0) {
                    this.startNextWave();
                }
                break;
            }
        }
    }

    _emitVolcanoParticle() {
        const v = this.arena.volcano;
        if (!v) return;
        const top = v.craterTop;
        const geo = new THREE.SphereGeometry(0.28 + Math.random() * 0.28, 6, 6);
        const palette = [0xff8822, 0xff5510, 0xffaa33, 0xff3300, 0xffd24a];
        const c = palette[Math.floor(Math.random() * palette.length)];
        const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true });
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(top);
        const ang = Math.random() * Math.PI * 2;
        const speed = 3.5 + Math.random() * 6;
        const upSpeed = 8 + Math.random() * 7;
        m.userData = {
            v: new THREE.Vector3(Math.cos(ang) * speed, upSpeed, Math.sin(ang) * speed),
            t: 0, ttl: 1.3 + Math.random() * 0.9
        };
        this.scene.add(m);
        this.arena.volcanoParticles.push(m);
    }

    _updateVolcanoParticles(deltaTime) {
        const list = this.arena.volcanoParticles;
        if (!list || !list.length) return;
        const g = -9.8;
        for (let i = list.length - 1; i >= 0; i--) {
            const p = list[i];
            const ud = p.userData;
            ud.t += deltaTime;
            if (ud.t >= ud.ttl) {
                this.scene.remove(p);
                list.splice(i, 1);
                continue;
            }
            ud.v.y += g * deltaTime;
            p.position.x += ud.v.x * deltaTime;
            p.position.y += ud.v.y * deltaTime;
            p.position.z += ud.v.z * deltaTime;
            if (p.material) p.material.opacity = Math.max(0, 1 - ud.t / ud.ttl);
        }
    }

    _updateCameraShake(deltaTime) {
        const s = this.arena.shake;
        if (!s || s.duration <= 0 || s.elapsed >= s.duration) return;
        s.elapsed += deltaTime;
        const k = Math.max(0, 1 - (s.elapsed / s.duration));
        const mag = s.intensity * k;
        if (this.camera) {
            this.camera.position.x += (Math.random() - 0.5) * mag * 2;
            this.camera.position.y += (Math.random() - 0.5) * mag * 1.0;
            this.camera.position.z += (Math.random() - 0.5) * mag * 2;
        }
    }

    _updateLava(deltaTime) {
        const lava = this.arena.lava;
        if (!lava || !lava.mesh) return;
        const a = this.arena;
        if (a.phase === 'eruption') {
            const k = Math.min(1, a.eruptionTimer / a.eruptionDuration);
            const eased = 1 - Math.pow(1 - k, 2);
            lava.y = lava.restY + (lava.peakY - lava.restY) * eased;
        } else if (a.phase === 'boss-fight') {
            lava.y += lava.riseSpeed * deltaTime;
            lava.y = Math.min(lava.y, lava.bossCap);
        } else if (a.phase === 'wave-complete') {
            lava.y += lava.riseSpeed * deltaTime;
            if (lava.y <= lava.restY) {
                lava.y = lava.restY;
                lava.riseSpeed = 0;
            }
        }
        lava.mesh.position.y = lava.y;
        if (lava.mesh.material) {
            this._lavaPulseT = (this._lavaPulseT || 0) + deltaTime;
            lava.mesh.material.opacity = 0.85 + Math.sin(this._lavaPulseT * 4) * 0.08;
        }
    }

    _updateLavaDamage(deltaTime) {
        const lava = this.arena.lava;
        if (!lava || !lava.mesh) return;
        if (lava.y < lava.restY + 0.25) return;
        // Player's feet below lava surface => damage
        if (this.player.position.y < lava.y + 0.05) {
            lava.tickTimer = (lava.tickTimer || 0) + deltaTime;
            if (lava.tickTimer >= 0.18) {
                lava.tickTimer = 0;
                // Bypass invulnerability for lava (continuous hazard)
                this.player.invulnerable = false;
                this.player.invulnerabilityTimer = 0;
                this.damagePlayer(8);
                this.player.invulnerable = false;
                this.player.invulnerabilityTimer = 0;
            }
        }
    }

    _updateBossRise(deltaTime) {
        const b = this.arena.boss;
        if (!b || !b.userData) return;
        if (b.userData.bossRise && b.userData.bossRise > 0) {
            b.userData.bossRise -= deltaTime;
            const k = Math.max(0, b.userData.bossRise / 1.2);
            b.position.y = -3 * k;
            if (b.userData.bossRise <= 0) {
                b.position.y = 0;
                b.userData.bossRise = 0;
            }
        }
    }

    _updateArenaDecor(deltaTime) {
        // Subtle idle wobble + bobbing on animals so the scene feels alive.
        const list = this.arena.decor;
        if (!list || !list.length) return;
        for (const o of list) {
            const ud = o.userData && o.userData._anim;
            if (!ud) continue;
            ud.t += deltaTime * (1.5 + ud.wobble);
            o.rotation.y += Math.sin(ud.t * 0.5) * deltaTime * 0.3;
            o.position.y = ud.home.y + Math.abs(Math.sin(ud.t)) * 0.08;
        }
    }

    _updateArenaCountdownUI() {
        const el = document.getElementById('arena-countdown');
        if (!el) return;
        const a = this.arena;
        if (!a || !a.active || a.phase !== 'intro') {
            if (el.style.display !== 'none') el.style.display = 'none';
            a && (a.introLastLabel = null);
            return;
        }
        el.style.display = 'flex';
        const t = a.introTimer;
        let label, isGo = false, sub = '';
        if (t < 1.0)        { label = ''; sub = `Wave ${a.wave} — get ready`; }
        else if (t < 2.0)   { label = '3'; }
        else if (t < 3.0)   { label = '2'; }
        else if (t < 4.0)   { label = '1'; }
        else if (t < a.introDuration) { label = 'GO!'; isGo = true; }
        else { label = ''; }

        const bigEl = el.querySelector('.ac-big');
        const subEl = el.querySelector('.ac-sub');
        if (bigEl && a.introLastLabel !== label) {
            bigEl.textContent = label;
            bigEl.classList.toggle('go', isGo);
            // Force animation restart
            bigEl.style.animation = 'none';
            void bigEl.offsetWidth;
            bigEl.style.animation = '';
            a.introLastLabel = label;
        }
        if (subEl) subEl.textContent = sub;
    }

    updateFacingIndicator() {
        const fi = this.facingIndicator;
        if (!fi.light || !fi.lightTarget || !this.player) return;
        const forward = new THREE.Vector3(Math.sin(this.characterRotation), 0, Math.cos(this.characterRotation));
        // Light at head, slightly forward
        const headY = this.player.position.y + 1.6;
        const lightPos = this.player.position.clone().add(new THREE.Vector3(0, headY - this.player.position.y, 0)).add(forward.clone().multiplyScalar(0.25));
        fi.light.position.copy(lightPos);
        // Target a few meters forward
        const tgt = this.player.position.clone().add(forward.clone().multiplyScalar(3));
        tgt.y = this.groundY + 0.5;
        fi.lightTarget.position.copy(tgt);
        fi.light.visible = fi.enabled;
        
        // Ground dot at forward ground intersection from player
        if (fi.groundDot) {
            const ray = new THREE.Ray(this.player.position.clone().add(new THREE.Vector3(0, 1.0, 0)), forward);
            const plane = new THREE.Plane(new THREE.Vector3(0,1,0), -this.groundY);
            const p = new THREE.Vector3();
            if (ray.intersectPlane(plane, p)) {
                fi.groundDot.position.set(p.x, this.groundY + 0.02, p.z);
                fi.groundDot.visible = fi.enabled;
            } else {
                fi.groundDot.visible = false;
            }
        }
    }

    // ========================================================================
    // ===== Online multiplayer (PeerJS / WebRTC P2P) ==========================
    // ========================================================================

    initMultiplayer() {
        this.remotePlayers = new Map(); // peerId -> { model, mixer, clips, currentClipName, targetPos, targetRot, lastUpdate, character, namePlate }
        this._mpSendAccum = 0;
        this._mpSendInterval = 1 / 15; // 15 Hz
        this._mpSavedName = (localStorage.getItem('pjboy.mp.name') || '').slice(0, 24);

        // Always bind the UI so the buttons give visible feedback even when
        // PeerJS / multiplayer.js failed to load. Otherwise the button click
        // only triggers the delegated "blip" sound and the user has no idea why.
        this._mpBindUI();

        if (typeof MultiplayerNet === 'undefined') {
            console.warn('[mp] multiplayer.js did not load — multiplayer disabled');
            this._mpUpdateStatusUI('Multiplayer module failed to load (multiplayer.js)', 'error');
            return;
        }
        if (typeof Peer === 'undefined') {
            console.warn('[mp] PeerJS did not load — multiplayer disabled');
            this._mpUpdateStatusUI('PeerJS failed to load — check network / blockers', 'error');
            return;
        }
        if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
            // WebRTC requires HTTPS (or localhost). file:// and plain http on a LAN IP won't work.
            this._mpUpdateStatusUI('Multiplayer needs HTTPS or localhost (current origin is insecure)', 'error');
            // Don't return — let the user try anyway, but they've been warned.
        }
        this.net = new MultiplayerNet({
            onStatus: (text, kind) => this._mpUpdateStatusUI(text, kind),
            onRoster: (list) => this._mpUpdateRosterUI(list),
            onPeerState: (id, state) => this._mpOnPeerState(id, state),
            onPeerLeave: (id) => this._mpRemoveRemotePlayer(id),
        });
    }

    _mpBindUI() {
        const nameInput = document.getElementById('mp-name');
        const hostBtn = document.getElementById('mp-host-btn');
        const joinBtn = document.getElementById('mp-join-btn');
        const codeInput = document.getElementById('mp-code');
        const disconnectBtn = document.getElementById('mp-disconnect-btn');
        const copyBtn = document.getElementById('mp-copy-btn');

        if (!nameInput || !hostBtn || !joinBtn) return; // UI not present

        if (this._mpSavedName) nameInput.value = this._mpSavedName;
        nameInput.addEventListener('change', () => {
            const v = nameInput.value.trim().slice(0, 24);
            if (v) {
                this._mpSavedName = v;
                localStorage.setItem('pjboy.mp.name', v);
            }
        });

        const getName = () => (nameInput.value || '').trim().slice(0, 24) || 'Player';

        const ensureNet = () => {
            if (!this.net) {
                const reason = (typeof MultiplayerNet === 'undefined')
                    ? 'Multiplayer module did not load (multiplayer.js).'
                    : (typeof Peer === 'undefined')
                        ? 'PeerJS did not load. Reload the page; if it still fails, your network may be blocking unpkg.com.'
                        : 'Multiplayer is unavailable.';
                this._mpUpdateStatusUI(reason, 'error');
                return false;
            }
            return true;
        };

        hostBtn.addEventListener('click', async () => {
            if (!ensureNet()) return;
            hostBtn.disabled = true;
            joinBtn.disabled = true;
            try {
                const code = await this.net.host(getName());
                this._mpShowRoomCode(code);
            } catch (err) {
                console.error('[mp] host failed', err);
                this._mpUpdateStatusUI('Host failed: ' + (err.message || err.type || err), 'error');
            } finally {
                hostBtn.disabled = false;
                joinBtn.disabled = false;
            }
        });

        joinBtn.addEventListener('click', async () => {
            if (!ensureNet()) return;
            const code = (codeInput.value || '').trim();
            if (!code) {
                this._mpUpdateStatusUI('Enter a room code first', 'error');
                return;
            }
            hostBtn.disabled = true;
            joinBtn.disabled = true;
            try {
                await this.net.join(code, getName());
                this._mpShowRoomCode(this.net.roomCode);
            } catch (err) {
                console.error('[mp] join failed', err);
                this._mpUpdateStatusUI('Join failed: ' + (err.message || err.type || err), 'error');
            } finally {
                hostBtn.disabled = false;
                joinBtn.disabled = false;
            }
        });

        // Enter key on the code field triggers join
        codeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); joinBtn.click(); }
        });

        disconnectBtn.addEventListener('click', () => {
            if (this.net) this.net.disconnect();
            this._mpHideRoomCode();
            // Wipe any lingering remote models
            Array.from(this.remotePlayers.keys()).forEach((id) => this._mpRemoveRemotePlayer(id));
        });

        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const code = document.getElementById('mp-room-code')?.textContent;
                if (!code) return;
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(code).catch(() => {});
                }
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
            });
        }
    }

    _mpShowRoomCode(code) {
        const wrap = document.getElementById('mp-room-display');
        const codeEl = document.getElementById('mp-room-code');
        const discBtn = document.getElementById('mp-disconnect-btn');
        if (wrap && codeEl) {
            codeEl.textContent = code;
            wrap.style.display = 'flex';
        }
        if (discBtn) discBtn.style.display = '';
    }

    _mpHideRoomCode() {
        const wrap = document.getElementById('mp-room-display');
        const discBtn = document.getElementById('mp-disconnect-btn');
        if (wrap) wrap.style.display = 'none';
        if (discBtn) discBtn.style.display = 'none';
    }

    _mpUpdateStatusUI(text, kind) {
        const el = document.getElementById('mp-status');
        if (!el) return;
        el.textContent = text;
        el.classList.remove('is-connected', 'is-connecting', 'is-error');
        if (kind === 'connected') el.classList.add('is-connected');
        else if (kind === 'connecting') el.classList.add('is-connecting');
        else if (kind === 'error') el.classList.add('is-error');

        if (kind === 'idle' || kind === 'error') this._mpHideRoomCode();
    }

    _mpUpdateRosterUI(list) {
        const ul = document.getElementById('mp-roster-list');
        if (!ul) return;
        ul.innerHTML = '';
        list.forEach((p) => {
            const li = document.createElement('li');
            const nameSpan = document.createElement('span');
            nameSpan.textContent = p.name + (p.self ? ' (you)' : '');
            if (p.self) nameSpan.classList.add('mp-self');
            li.appendChild(nameSpan);
            if (p.host) {
                const tag = document.createElement('span');
                tag.className = 'mp-tag is-host';
                tag.textContent = 'HOST';
                li.appendChild(tag);
            }
            ul.appendChild(li);
        });
        if (list.length <= 1) {
            const li = document.createElement('li');
            li.style.opacity = '0.5';
            li.textContent = 'Waiting for others to join…';
            ul.appendChild(li);
        }
    }

    tickMultiplayer(deltaTime) {
        if (!this.net) return;

        // Send local snapshot at fixed rate
        if (this.net.isConnected && this.player && this.player.position) {
            this._mpSendAccum += deltaTime;
            if (this._mpSendAccum >= this._mpSendInterval) {
                this._mpSendAccum = 0;
                const p = this.player.position;
                this.net.broadcast({
                    pos: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)],
                    rotY: +(this.characterRotation || 0).toFixed(3),
                    anim: this.player.currentClipName || 'Idle',
                    char: this.currentCharacterKey,
                    hp: Math.max(0, Math.floor(this.player.hp || 0)),
                    name: this._mpSavedName || 'Player',
                });
            }
        }

        // Smoothly interpolate every remote player toward its latest snapshot
        if (this.remotePlayers.size > 0) {
            const lerpAlpha = 1 - Math.exp(-deltaTime * 12); // ~12/s pull
            this.remotePlayers.forEach((rp) => {
                if (!rp.model) return;
                if (rp.targetPos) {
                    rp.model.position.lerp(rp.targetPos, lerpAlpha);
                }
                if (typeof rp.targetRot === 'number') {
                    // shortest-arc angle lerp
                    let diff = rp.targetRot - rp.model.rotation.y;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    rp.model.rotation.y += diff * lerpAlpha;
                }
                if (rp.mixer) rp.mixer.update(deltaTime);
            });
        }
    }

    _mpOnPeerState(id, state) {
        if (!state) return;
        if (state.type === 'event') return; // reserved for future
        const pos = state.pos;
        const rotY = state.rotY;
        const charKey = state.char || 'skeleton';

        let rp = this.remotePlayers.get(id);
        if (!rp) {
            rp = {
                model: null,
                mixer: null,
                clips: null,
                currentClipName: 'Idle',
                targetPos: new THREE.Vector3(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0),
                targetRot: typeof rotY === 'number' ? rotY : 0,
                character: charKey,
                pending: true,
                name: state.name || 'Player',
            };
            this.remotePlayers.set(id, rp);
            this._mpLoadRemoteCharacter(id, charKey);
        }

        // If character changed mid-session, reload the model
        if (rp.character !== charKey && !rp.pending) {
            rp.character = charKey;
            this._mpDisposeModel(rp);
            rp.pending = true;
            this._mpLoadRemoteCharacter(id, charKey);
        }

        if (pos) {
            if (!rp.targetPos) rp.targetPos = new THREE.Vector3();
            rp.targetPos.set(pos[0], pos[1], pos[2]);
        }
        if (typeof rotY === 'number') rp.targetRot = rotY;
        if (state.name) rp.name = state.name;

        // Drive remote animation
        if (rp.clips && state.anim && state.anim !== rp.currentClipName) {
            const next = rp.clips[state.anim];
            if (next) {
                const prev = rp.clips[rp.currentClipName];
                if (prev) prev.fadeOut(0.18);
                next.reset().fadeIn(0.18).play();
                rp.currentClipName = state.anim;
            }
        }
    }

    _mpLoadRemoteCharacter(id, charKey) {
        if (!this.characters || !this.characters[charKey]) charKey = 'skeleton';
        const filePath = this.characters[charKey].path;
        const loader = new THREE.GLTFLoader();
        loader.load(filePath, (gltf) => {
            const rp = this.remotePlayers.get(id);
            if (!rp) return; // peer left before model loaded

            const character = gltf.scene;
            character.traverse((child) => {
                if (child.isMesh) {
                    const src = child.material;
                    child.material = new THREE.MeshLambertMaterial({
                        map: src.map || null,
                        color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
                        side: src.side,
                        skinning: child.isSkinnedMesh === true
                    });
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            const box = new THREE.Box3().setFromObject(character);
            const height = box.max.y - box.min.y;
            if (height > 0) character.scale.setScalar(2.5 / height);
            const scaledBox = new THREE.Box3().setFromObject(character);
            character.position.y -= scaledBox.min.y;

            const wrap = new THREE.Group();
            wrap.add(character);
            if (rp.targetPos) wrap.position.copy(rp.targetPos);
            if (typeof rp.targetRot === 'number') wrap.rotation.y = rp.targetRot;

            // Shadow disc to anchor them to the ground
            const shadowMat = new THREE.MeshBasicMaterial({
                color: 0x000000, transparent: true, opacity: 0.45,
                depthWrite: false, side: THREE.DoubleSide
            });
            const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), shadowMat);
            shadow.rotation.x = -Math.PI / 2;
            shadow.position.y = 0.02;
            shadow.renderOrder = -1;
            wrap.add(shadow);

            // Floating name tag above the head
            const namePlate = this._mpMakeNamePlate(rp.name || 'Player');
            namePlate.position.set(0, 3.0, 0);
            wrap.add(namePlate);

            this.scene.add(wrap);
            rp.model = wrap;
            rp.namePlate = namePlate;
            rp.pending = false;

            if (gltf.animations && gltf.animations.length > 0) {
                const mixer = new THREE.AnimationMixer(character);
                rp.mixer = mixer;
                rp.clips = {};
                gltf.animations.forEach((clip) => {
                    const action = mixer.clipAction(clip);
                    action.enabled = true;
                    action.setEffectiveWeight(0);
                    action.play();
                    rp.clips[clip.name] = action;
                });
                const startClip = rp.clips[rp.currentClipName] || rp.clips['Idle'];
                if (startClip) {
                    startClip.setEffectiveWeight(1);
                    rp.currentClipName = startClip === rp.clips['Idle'] ? 'Idle' : rp.currentClipName;
                }
            }
        }, undefined, (error) => {
            console.error('[mp] remote character load failed', error);
        });
    }

    _mpMakeNamePlate(name) {
        const canvas = document.createElement('canvas');
        const w = 256, h = 64;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        // rounded backdrop
        const r = 10;
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(w - r, 0);
        ctx.quadraticCurveTo(w, 0, w, r);
        ctx.lineTo(w, h - r);
        ctx.quadraticCurveTo(w, h, w - r, h);
        ctx.lineTo(r, h);
        ctx.quadraticCurveTo(0, h, 0, h - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#9ad7ff';
        ctx.font = 'bold 32px Courier New, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(name).slice(0, 16), w / 2, h / 2 + 2);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(2.0, 0.5, 1);
        sprite.renderOrder = 1000;
        return sprite;
    }

    _mpDisposeModel(rp) {
        if (!rp) return;
        if (rp.model) {
            this.scene.remove(rp.model);
            rp.model.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (child.material.map) child.material.map.dispose();
                        child.material.dispose();
                    }
                }
                if (child.isSprite && child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
        }
        rp.model = null;
        rp.mixer = null;
        rp.clips = null;
        rp.namePlate = null;
    }

    _mpRemoveRemotePlayer(id) {
        const rp = this.remotePlayers.get(id);
        if (!rp) return;
        this._mpDisposeModel(rp);
        this.remotePlayers.delete(id);
    }
}

// Start the game
window.addEventListener('load', () => {
    const game = new Game3D();
    
    // Expose game instance globally for easy character loading
    window.game = game;
    
    
    // Setup modal event listeners
    game.setupModalListeners();
    // Render character thumbnails for the settings picker
    game.generateCharacterPreviews();
    // Using custom in-code lion archer model (no external GLTF)

    // Ensure crosshair element exists
    const crosshairCheck = document.getElementById('crosshair');
    if (!crosshairCheck) {
        const crosshair = document.createElement('div');
        crosshair.id = 'crosshair';
        crosshair.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 18px; height: 18px; pointer-events: none; z-index: 999999; display: none;';
        crosshair.innerHTML = `
            <div style="position: absolute; top: 50%; left: 50%; width: 8px; height: 8px; background: #ffb347; box-shadow: 0 0 10px #ffb347, 0 0 20px #ffb347; border-radius: 50%; transform: translate(-50%, -50%);"></div>
        `;
        document.body.appendChild(crosshair);
    } else {
    }

});
