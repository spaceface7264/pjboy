// 3D Second-Person Game - 128-bit Style

// Stale HUD element IDs swept every frame by clearAllUI. Listed once,
// hoisted so we don't re-allocate the array every render tick.
const STALE_UI_IDS = [
    'player-hp-hud', 'top-center-ui',
    'jetpack-hud', 'enemy-count-hud', 'compass-hud',
    'player-pos', 'player-facing', 'camera-info',
    'objective-msg', 'facing-indicator',
    'control-ui', 'maze-ui'
];

// Scratch math objects reused across the frame loop. Allocating these
// inside per-enemy / per-frame paths was a significant GC source.
const _scratchV3a = (typeof THREE !== 'undefined') ? new THREE.Vector3() : null;
const _scratchV3b = (typeof THREE !== 'undefined') ? new THREE.Vector3() : null;
const _scratchV3c = (typeof THREE !== 'undefined') ? new THREE.Vector3() : null;
const _scratchV2a = (typeof THREE !== 'undefined') ? new THREE.Vector2() : null;
const _scratchV2b = (typeof THREE !== 'undefined') ? new THREE.Vector2() : null;
const _scratchRay = (typeof THREE !== 'undefined') ? new THREE.Ray() : null;
const _scratchPlaneGround = (typeof THREE !== 'undefined') ? new THREE.Plane(new THREE.Vector3(0,1,0), 0) : null;
const _sharedRaycaster = (typeof THREE !== 'undefined') ? new THREE.Raycaster() : null;

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
            case 'wallChip':
                this._noise({ dur: 0.05, gain: 0.16, lowpass: 1400, highpass: 500 });
                this._tone({ type: 'square', freq: 210, freqEnd: 120, dur: 0.06, gain: 0.10 });
                break;
            case 'wallBreak':
                this._noise({ dur: 0.32, gain: 0.32, lowpass: 1200 });
                this._tone({ type: 'sawtooth', freq: 160, freqEnd: 60, dur: 0.28, gain: 0.22 });
                this._tone({ type: 'square', freq: 80,  freqEnd: 40, dur: 0.32, gain: 0.18, delay: 0.04 });
                break;
            case 'crystalBreak':
                this._tone({ type: 'triangle', freq: 1200, freqEnd: 400, dur: 0.22, gain: 0.22 });
                this._tone({ type: 'sine', freq: 1800, freqEnd: 700, dur: 0.22, gain: 0.18, delay: 0.02 });
                this._noise({ dur: 0.12, gain: 0.18, lowpass: 4000, highpass: 1200 });
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
        // Spatial hash bucketing walls by `_wallHashCell`-unit XZ cells. Hot
        // collision paths query nearby cells instead of scanning all walls —
        // critical now that walls are decomposed into thousands of 1×1 cubes.
        this._wallHashCell = 4;
        this.wallHash = new Map();
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
                swordGold: 'Guldsværd',
                swordGoldDesc: 'Hurtigt og elegant — let, men skarpere end diamant',
                swordStone: 'Stensværd',
                swordStoneDesc: 'Grundlæggende sværd til begyndere',
                skeletonAxe: 'Skelet Økse',
                skeletonAxeDesc: 'Tung økse — langsom, men hårdtslående',
                axeDiamond: 'Diamantøkse',
                axeDiamondDesc: 'Den hårdeste slag, men langsom at svinge',
                axeGold: 'Guldøkse',
                axeGoldDesc: 'Hurtigere økse med solid skade',
                skeletonBlade: 'Skelet Klinge',
                skeletonBladeDesc: 'Lille klinge — hurtige stik, lav skade',
                skeletonStaff: 'Skelet Stav',
                skeletonStaffDesc: 'Lang rækkevidde, moderat skade',
                gun: 'Pistol',
                gunDesc: 'En præcis pistol med høj skade',
                machineGun: 'Maskingevær',
                machineGunDesc: 'Hurtig automatisk affyring, lavere skade per skud',
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
                asciiMaze: 'ASCII Labyrint',

                // Descriptions
                wideHallsDesc: 'Stor labyrint med brede 5-celle gange',
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
                swordGold: 'Gold Sword',
                swordGoldDesc: 'Fast and elegant — light, but sharper than diamond',
                swordStone: 'Stone Sword',
                swordStoneDesc: 'A basic starter sword',
                skeletonAxe: 'Skeleton Axe',
                skeletonAxeDesc: 'Heavy axe — slower, but hits hard',
                axeDiamond: 'Diamond Axe',
                axeDiamondDesc: 'Heaviest hit, but slow to swing',
                axeGold: 'Gold Axe',
                axeGoldDesc: 'Faster axe with solid damage',
                skeletonBlade: 'Skeleton Blade',
                skeletonBladeDesc: 'A small blade — fast jabs, low damage',
                skeletonStaff: 'Skeleton Staff',
                skeletonStaffDesc: 'Long reach, moderate damage',
                gun: 'Pistol',
                gunDesc: 'A precise pistol with high damage',
                machineGun: 'Machine Gun',
                machineGunDesc: 'Rapid automatic fire, lower damage per shot',
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
                asciiMaze: 'ASCII Maze',

                // Descriptions
                wideHallsDesc: 'Large maze with wide 5-cell halls',
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
            enemyProjectiles: [],
            enemies: [],
            enemiesGroup: new THREE.Group(),
            // Crates + keys live in their own groups so clearMaze can drop them
            // together without touching unrelated scene content.
            crates: [],
            cratesGroup: new THREE.Group(),
            keys: [],
            keysGroup: new THREE.Group(),
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
            keys: 0,              // crate keys collected from the maze
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
        this.initializeBlocks();
        this.initializeWeapons();
        this.initMultiplayer();
        if (this._initMetaState) this._initMetaState();
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
                apply() { g.inventory.ammo = Math.min(g.inventory.ammo + 10, g.AMMO_MAX); } },
            jetpack:     { emoji: '🚀', color: 0xffaa66, weight: 16, labelKey: 'jetpackFuel', labelSuffix: ' +50', autoApply: true,
                apply() { g.powerUps.jetpackFuel += 50; } },
            speed:       { emoji: '⚡', color: 0x66ccff, weight: 12, labelKey: 'speedBoost',  labelSuffix: ' +10s sprint',
                apply() { g.applySpeedBoost(10); } },
            weaponBuff:  { emoji: '⚔️', color: 0xff8866, weight: 10, labelKey: 'weaponBuff',  labelSuffix: ' +1',
                apply() { g.powerUps.weaponBuff += 1; } },
            healthRegen: { emoji: '💚', color: 0xaaff88, weight: 10, labelKey: 'healthRegen', labelSuffix: ' +1',
                apply() { g.powerUps.healthRegen += 1; } },
            flag:        { emoji: '🏁', color: 0xff66aa, weight: 6,  labelKey: 'flag',        labelSuffix: ' +1', autoApply: true,
                apply() { g.inventory.flags += 1; if (g.updateControlsUI) g.updateControlsUI(); } }
        };
    }

    // Placeable blocks — Minecraft-style. v1 ships a single block (stone)
    // so the registry, thumbnail render, quickbar wiring and placement path
    // are all proven before adding more block types.
    initializeBlocks() {
        this.BLOCK_DEFS = {
            stone: { path: 'assets/Blocks/Block_Stone.gltf', name: 'Stone Block', color: 0x8a8d92 }
        };
        // Inventory counts per block id. Starts with a generous stack so the
        // player can experiment without grinding for materials in v1.
        this.inventory.blocks = this.inventory.blocks || {};
        for (const id of Object.keys(this.BLOCK_DEFS)) {
            if (this.inventory.blocks[id] == null) this.inventory.blocks[id] = 99;
        }
        this.blockTemplates = {};
        this.blockThumbs = {};      // dataURL thumbnails keyed by block id
        this.activeBlockId = null;  // when set, left-click places this block

        const loader = new THREE.GLTFLoader();
        for (const [id, cfg] of Object.entries(this.BLOCK_DEFS)) {
            // Emoji fallback so the drawer has *something* before the GLTF
            // finishes loading (drawer re-renders on open, so this only shows
            // for the brief first-paint window).
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
    }

    // Shared offscreen renderer for all thumbnail bakes. Browsers cap WebGL
    // contexts at ~16; creating one renderer per thumbnail (we have many
    // melee weapons + blocks) blows past that and evicts the main game
    // context, producing a white screen. One context, reused.
    _getThumbnailRenderer(size) {
        if (!this._thumbRenderer) {
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
            renderer.setPixelRatio(1);
            renderer.setClearColor(0x000000, 0);
            this._thumbRenderer = renderer;
        }
        const r = this._thumbRenderer;
        // setSize with updateStyle=false avoids any DOM layout side effects on
        // the detached canvas; we resize per-call because block (64) and
        // character preview (192) share this renderer.
        if (r.domElement.width !== size || r.domElement.height !== size) {
            r.setSize(size, size, false);
        }
        return r;
    }

    // One-off offscreen render of a block GLTF into a small dataURL using the
    // shared thumbnail renderer.
    _renderBlockThumbnail(sceneRoot, fallbackColor) {
        try {
            const size = 64;
            const renderer = this._getThumbnailRenderer(size);

            const scene = new THREE.Scene();
            const clone = sceneRoot.clone(true);
            // Normalize size to 1 unit so every block thumbnail has the same
            // framing regardless of native GLTF scale.
            const bbox = new THREE.Box3().setFromObject(clone);
            const sz = bbox.getSize(new THREE.Vector3());
            const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
            clone.scale.setScalar(1 / maxDim);
            bbox.setFromObject(clone);
            const center = bbox.getCenter(new THREE.Vector3());
            clone.position.sub(center);
            scene.add(clone);

            scene.add(new THREE.AmbientLight(0xffffff, 0.85));
            const dir = new THREE.DirectionalLight(0xffffff, 0.9);
            dir.position.set(2, 3, 2);
            scene.add(dir);

            const cam = new THREE.OrthographicCamera(-0.8, 0.8, 0.8, -0.8, 0.1, 10);
            cam.position.set(1.5, 1.5, 1.5);
            cam.lookAt(0, 0, 0);

            renderer.render(scene, cam);
            const dataURL = renderer.domElement.toDataURL('image/png');
            return `<img src="${dataURL}" class="block-thumb" alt="" draggable="false">`;
        } catch (e) {
            console.warn('block thumbnail render failed', e);
            return null;
        }
    }

    // One-off offscreen render of a weapon GLTF (sword etc.) into a small
    // dataURL. The sword is much longer than wide, so we tilt it diagonally
    // for nicer framing instead of leaving a thin vertical line.
    _renderWeaponThumbnail(template) {
        try {
            const size = 64;
            const renderer = this._getThumbnailRenderer(size);

            const scene = new THREE.Scene();
            const clone = template.clone(true);
            const o = template.userData && template.userData.orient;
            if (o) clone.rotation.set(o.rot.x, o.rot.y, o.rot.z);

            // Wrap and tilt so the blade sits diagonally in the frame.
            const root = new THREE.Group();
            root.add(clone);
            root.rotation.z = -Math.PI / 5;
            root.updateMatrixWorld(true);

            const bbox = new THREE.Box3().setFromObject(root);
            const sz = bbox.getSize(new THREE.Vector3());
            const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
            root.scale.setScalar(1 / maxDim);
            const bbox2 = new THREE.Box3().setFromObject(root);
            const center = bbox2.getCenter(new THREE.Vector3());
            root.position.sub(center);
            scene.add(root);

            scene.add(new THREE.AmbientLight(0xffffff, 0.95));
            const dir = new THREE.DirectionalLight(0xffffff, 0.9);
            dir.position.set(2, 3, 2);
            scene.add(dir);

            // Camera tilted slightly so the sword has a bit of perspective volume.
            const cam = new THREE.OrthographicCamera(-0.6, 0.6, 0.6, -0.6, 0.1, 10);
            cam.position.set(0.6, 0.4, 2.5);
            cam.lookAt(0, 0, 0);

            renderer.render(scene, cam);
            const dataURL = renderer.domElement.toDataURL('image/png');
            return `<img src="${dataURL}" class="weapon-thumb" alt="" draggable="false">`;
        } catch (e) {
            console.warn('weapon thumbnail render failed', e);
            return null;
        }
    }

    // Clone a unit-sized block mesh from the loaded GLTF template.
    _createBlockMesh(blockId) {
        const tpl = this.blockTemplates && this.blockTemplates[blockId];
        if (tpl && THREE.SkeletonUtils) {
            const clone = THREE.SkeletonUtils.clone(tpl);
            const bbox = new THREE.Box3().setFromObject(clone);
            const sz = bbox.getSize(new THREE.Vector3());
            const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
            clone.scale.setScalar(1 / maxDim);
            // Re-center so the mesh origin sits at the block center.
            const bbox2 = new THREE.Box3().setFromObject(clone);
            const center = bbox2.getCenter(new THREE.Vector3());
            clone.position.sub(center);
            clone.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            const wrap = new THREE.Group();
            wrap.add(clone);
            return wrap;
        }
        const cfg = (this.BLOCK_DEFS && this.BLOCK_DEFS[blockId]) || {};
        const mat = new THREE.MeshLambertMaterial({ color: cfg.color || 0x8a8d92 });
        return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    }

    // Minecraft-style placement targeting:
    //   1. Raycast from the camera against every wall AABB (placed blocks &
    //      maze walls), find the closest hit within MAX_REACH.
    //   2. If we hit something, snap to the cell adjacent to the hit face —
    //      i.e. place ON the face the player is looking at. Stacking becomes
    //      "aim at the top of a block, click."
    //   3. If we miss everything, raycast to the ground plane and place there.
    //
    // Returns { pos, valid }. `valid` is false when the resulting cell is
    // already occupied or would land on the player.
    _resolveBlockPlacementTarget() {
        const dir = new THREE.Vector3();
        if (this.camera) {
            this.camera.getWorldDirection(dir);
        } else {
            dir.set(Math.sin(this.characterRotation), 0, Math.cos(this.characterRotation));
        }
        // Origin is the camera world position so the ray matches the crosshair.
        const origin = this.camera
            ? this.camera.getWorldPosition(new THREE.Vector3())
            : this.player.position.clone().setY(this.player.position.y + 1.4);

        const MAX_REACH = 6.0;

        // 1. Scan walls within reach for the closest ray-AABB intersection.
        let bestT = Infinity;
        let bestWall = null;
        let bestNormal = new THREE.Vector3();
        // Local scratch for the slab test to avoid per-iteration allocation.
        const halfX = 0, halfY = 0, halfZ = 0; // reassigned below
        for (let i = 0; i < this.walls.length; i++) {
            const w = this.walls[i];
            if (!w || !w.position || !w.size) continue;
            // Cheap horizontal cull — walls past reach can't be hit.
            const dx0 = w.position.x - origin.x;
            const dz0 = w.position.z - origin.z;
            if (dx0 * dx0 + dz0 * dz0 > (MAX_REACH + 4) * (MAX_REACH + 4)) continue;

            const hx = w.size.x / 2, hy = w.size.y / 2, hz = w.size.z / 2;
            // Slab method: per-axis interval of t-values where the ray is
            // inside the box. Hit exists if the intervals overlap and tMin >= 0.
            const invDx = dir.x !== 0 ? 1 / dir.x : 1e30;
            const invDy = dir.y !== 0 ? 1 / dir.y : 1e30;
            const invDz = dir.z !== 0 ? 1 / dir.z : 1e30;
            let t1x = (w.position.x - hx - origin.x) * invDx;
            let t2x = (w.position.x + hx - origin.x) * invDx;
            if (t1x > t2x) { const t = t1x; t1x = t2x; t2x = t; }
            let t1y = (w.position.y - hy - origin.y) * invDy;
            let t2y = (w.position.y + hy - origin.y) * invDy;
            if (t1y > t2y) { const t = t1y; t1y = t2y; t2y = t; }
            let t1z = (w.position.z - hz - origin.z) * invDz;
            let t2z = (w.position.z + hz - origin.z) * invDz;
            if (t1z > t2z) { const t = t1z; t1z = t2z; t2z = t; }
            const tEnter = Math.max(t1x, t1y, t1z);
            const tExit  = Math.min(t2x, t2y, t2z);
            if (tEnter > tExit || tExit < 0 || tEnter > MAX_REACH) continue;
            // Skip cases where the camera starts inside this wall.
            const tHit = tEnter >= 0 ? tEnter : -1;
            if (tHit < 0 || tHit >= bestT) continue;

            // Which slab limited the entry? That axis is the face normal.
            let nx = 0, ny = 0, nz = 0;
            if (tEnter === t1x)      nx = dir.x > 0 ? -1 : 1;
            else if (tEnter === t1y) ny = dir.y > 0 ? -1 : 1;
            else                     nz = dir.z > 0 ? -1 : 1;

            bestT = tHit;
            bestWall = w;
            bestNormal.set(nx, ny, nz);
        }

        let pos;
        if (bestWall) {
            // Step a tiny epsilon past the hit point so floor() lands on the
            // wall's cell, then back off by one cell along the face normal —
            // that's the empty neighbour we want to fill.
            const hit = origin.clone().addScaledVector(dir, bestT);
            // Stacking aid: when the player aims at the UPPER half of a side
            // face (within the unit cell), bias toward stacking on top of the
            // hit cell. Looking at the side of a column from the ground —
            // crosshair on the upper portion → block lands on top. Lower
            // portion keeps the literal side-adjacent placement.
            if (bestNormal.y === 0) {
                const cellLocalY = hit.y - Math.floor(hit.y);
                if (cellLocalY > 0.5) {
                    bestNormal.set(0, 1, 0);
                }
            }
            // Nudge slightly into the wall to be confident about which cell
            // the hit point belongs to, then step one cell out along normal.
            hit.x -= bestNormal.x * 0.001;
            hit.y -= bestNormal.y * 0.001;
            hit.z -= bestNormal.z * 0.001;
            const cellX = Math.floor(hit.x) + bestNormal.x;
            const cellY = Math.floor(hit.y) + bestNormal.y;
            const cellZ = Math.floor(hit.z) + bestNormal.z;
            pos = new THREE.Vector3(cellX + 0.5, cellY + 0.5, cellZ + 0.5);
        } else {
            // No solid hit — fall back to the ground plane (y=0). If the ray
            // points up or flat, snap a short distance forward at ground level
            // so the ghost still appears somewhere reasonable.
            let gx, gz;
            if (dir.y < -0.05) {
                const t = Math.min(MAX_REACH, origin.y / -dir.y);
                gx = origin.x + dir.x * t;
                gz = origin.z + dir.z * t;
            } else {
                const flat = new THREE.Vector3(dir.x, 0, dir.z);
                if (flat.lengthSq() < 1e-6) flat.set(Math.sin(this.characterRotation), 0, Math.cos(this.characterRotation));
                flat.normalize().multiplyScalar(2.5);
                gx = this.player.position.x + flat.x;
                gz = this.player.position.z + flat.z;
            }
            pos = new THREE.Vector3(Math.floor(gx) + 0.5, 0.5, Math.floor(gz) + 0.5);
        }

        // Validate: cell must be empty (not already occupied) and not where
        // the player is standing.
        let valid = pos.y >= 0.5;
        if (valid) {
            for (let i = 0; i < this.walls.length; i++) {
                const w = this.walls[i];
                if (!w || !w.position || !w.size) continue;
                if (Math.abs(w.position.x - pos.x) > w.size.x / 2 + 0.01) continue;
                if (Math.abs(w.position.z - pos.z) > w.size.z / 2 + 0.01) continue;
                if (Math.abs(w.position.y - pos.y) > w.size.y / 2 + 0.01) continue;
                valid = false;
                break;
            }
        }
        if (valid) {
            const px = this.player.position.x, py = this.player.position.y, pz = this.player.position.z;
            const distXZ = Math.hypot(px - pos.x, pz - pos.z);
            if (distXZ < 0.55 && Math.abs(py + 1.0 - pos.y) < 1.0) valid = false;
        }

        return { pos, valid };
    }

    // Wireframe preview cube. Attached as a CHILD OF THE CAMERA so it always
    // renders regardless of scene state. Camera-attached pivot is moved each
    // frame so it lines up with the world-space placement target via inverse
    // camera transform.
    //
    // Two passes draw the cage:
    //   FRONT — normal depth test, full opacity, crisp colored edges
    //   BACK  — inverted depth test (only fragments occluded by world geom),
    //           low opacity, dim — so you can see the cube even when a wall
    //           is between you and it.
    _ensurePlacementGhost() {
        if (this.placementGhost && this.placementGhost.parent) {
            return this.placementGhost;
        }
        const group = new THREE.Group();
        group.name = 'placementGhost';
        group.frustumCulled = false;

        const frontMat = new THREE.MeshBasicMaterial({
            color: 0x66ff88,
            transparent: true,
            opacity: 0.85,
            depthTest: true,
            depthWrite: false,
            depthFunc: THREE.LessEqualDepth,
            toneMapped: false,
            fog: false
        });
        const backMat = new THREE.MeshBasicMaterial({
            color: 0x66ff88,
            transparent: true,
            opacity: 0.18,
            depthTest: true,
            depthWrite: false,
            depthFunc: THREE.GreaterDepth,
            toneMapped: false,
            fog: false
        });

        const S = 1.0;             // exactly block-sized so edges sit on cell faces
        const T = 0.022;           // slim rod radius — subtle
        const half = S / 2;
        const rodGeom = new THREE.CylinderGeometry(T, T, S, 6, 1);
        const addRodPair = (px, py, pz, axis) => {
            // One mesh per material; identical geometry & transform.
            for (const mat of [frontMat, backMat]) {
                const rod = new THREE.Mesh(rodGeom, mat);
                rod.position.set(px, py, pz);
                if (axis === 'x') rod.rotation.z = Math.PI / 2;
                else if (axis === 'z') rod.rotation.x = Math.PI / 2;
                rod.renderOrder = mat === frontMat ? 9999 : 9998;
                rod.frustumCulled = false;
                group.add(rod);
            }
        };
        addRodPair(-half, 0, -half, 'y'); addRodPair( half, 0, -half, 'y');
        addRodPair(-half, 0,  half, 'y'); addRodPair( half, 0,  half, 'y');
        addRodPair(0, -half, -half, 'x'); addRodPair(0,  half, -half, 'x');
        addRodPair(0, -half,  half, 'x'); addRodPair(0,  half,  half, 'x');
        addRodPair(-half, -half, 0, 'z'); addRodPair( half, -half, 0, 'z');
        addRodPair(-half,  half, 0, 'z'); addRodPair( half,  half, 0, 'z');

        group.userData.frontMat = frontMat;
        group.userData.backMat = backMat;
        group.visible = false;
        // Attach to the camera — anything parented to the camera always renders
        // in view. We'll still position the ghost at a world-space target each
        // frame by setting its local position via inverse camera transform.
        if (this.camera) {
            this.camera.add(group);
        } else {
            this.scene.add(group);
        }
        this.placementGhost = group;
        return group;
    }

    _setGhostColor(col) {
        const g = this.placementGhost;
        if (!g) return;
        if (g.userData.frontMat) g.userData.frontMat.color.setHex(col);
        if (g.userData.backMat) g.userData.backMat.color.setHex(col);
    }

    updatePlacementGhost() {
        const id = this.activeBlockId;
        const showGhost = !!id && this.gameMode === 'play' && !this.isDrawerOpen
            && this.player && this.player.position && this.camera;
        if (!showGhost) {
            if (this.placementGhost) this.placementGhost.visible = false;
            return;
        }
        const ghost = this._ensurePlacementGhost();
        const { pos, valid } = this._resolveBlockPlacementTarget();
        if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
            ghost.visible = false;
            return;
        }
        // Ghost is parented to the camera, so set its position in camera-local
        // space. worldToLocal mutates the vector — clone first.
        this.camera.updateMatrixWorld(true);
        ghost.position.copy(this.camera.worldToLocal(pos.clone()));
        // Counter-rotate so the cube edges stay axis-aligned in world space
        // (otherwise it'd tilt with the camera).
        ghost.quaternion.copy(this.camera.quaternion).invert();
        ghost.visible = true;
        this._setGhostColor(valid ? 0x66ff88 : 0xff5566);
    }

    // Place a block on the cell directly in front of the player, snapped to
    // a 1-unit integer grid. Supply is infinite — placement only fails if the
    // cell is occupied or would land on top of the player.
    placeActiveBlock() {
        const id = this.activeBlockId;
        if (!id) return false;
        // Debounce: browsers fire both `mousedown` and `click` for a single
        // tap, and both handlers route here. Without this guard, every click
        // would place two blocks back-to-back.
        const now = performance.now();
        if (this._lastBlockPlaceTime && (now - this._lastBlockPlaceTime) < 150) return false;
        this._lastBlockPlaceTime = now;
        const { pos, valid } = this._resolveBlockPlacementTarget();
        if (!valid) {
            this.showMessage && this.showMessage('Blocked');
            return false;
        }

        this._spawnPlacedBlock(id, pos);

        // Infinite supply: stock is left untouched.
        this.audio && this.audio.play && this.audio.play('uiClick');
        this._qbSig = null;
        this.updateInventoryGridUI && this.updateInventoryGridUI();
        if (this.isDrawerOpen) this.updateDrawerUI();
        this._scheduleSaveBuilds();
        return true;
    }

    // Adds a unit block to the world at `pos`. Factored out so placement
    // (player click) and restore-from-save share the same setup.
    _spawnPlacedBlock(id, pos) {
        const mesh = this._createBlockMesh(id);
        mesh.position.copy(pos);
        this.scene.add(mesh);
        const entry = {
            mesh,
            position: mesh.position,
            size: { x: 1, y: 1, z: 1 },
            destructible: true,
            hp: 3, maxHp: 3,
            placed: true, blockId: id,
        };
        this.walls.push(entry);
        this._addWallToHash(entry);
        return entry;
    }

    // Per-mode localStorage key. Wide Halls runs share builds across attempts
    // of the same maze (currentMazeIndex), while modes without a maze index
    // bucket together. v1 namespace lets us evolve the schema later.
    _buildsSaveKey() {
        const mode = this.activeModeId || 'free';
        const mazeIdx = (this.currentMazeIndex != null ? this.currentMazeIndex : 0);
        return `pjboy_builds_v1:${mode}:${mazeIdx}`;
    }

    // Debounced save so rapid stacking doesn't hammer localStorage.
    _scheduleSaveBuilds() {
        if (this._buildSaveTimer) clearTimeout(this._buildSaveTimer);
        this._buildSaveTimer = setTimeout(() => {
            this._buildSaveTimer = null;
            this._saveBuilds();
        }, 400);
    }

    _saveBuilds() {
        try {
            const list = [];
            for (const w of this.walls) {
                if (!w || !w.placed || !w.position) continue;
                list.push({
                    id: w.blockId,
                    x: w.position.x, y: w.position.y, z: w.position.z,
                });
            }
            localStorage.setItem(this._buildsSaveKey(), JSON.stringify(list));
        } catch (e) {
            console.warn('[builds] save failed', e);
        }
    }

    _placedBlockCount() {
        let n = 0;
        for (const w of this.walls) { if (w && w.placed) n++; }
        return n;
    }

    // Drop every player-placed block from the live scene AND wipe the save
    // for the current mode. Maze walls and other world geometry stay.
    _clearAllPlacedBlocks() {
        const survivors = [];
        for (const w of this.walls) {
            if (w && w.placed) {
                if (w.mesh) this.scene.remove(w.mesh);
                this._removeWallFromHash(w);
            } else {
                survivors.push(w);
            }
        }
        this.walls = survivors;
        try {
            localStorage.removeItem(this._buildsSaveKey());
        } catch (e) {
            console.warn('[builds] clear failed', e);
        }
        // Hide the ghost so it doesn't sit on a now-empty cell with stale state.
        if (this.placementGhost) this.placementGhost.visible = false;
    }

    // Restore blocks placed earlier in this maze. Skips cells that the maze
    // generator already occupies (so destroying a maze wall then reloading
    // doesn't try to fight over the cell) and unknown block IDs.
    _loadBuilds() {
        try {
            const raw = localStorage.getItem(this._buildsSaveKey());
            if (!raw) return 0;
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return 0;
            let count = 0;
            for (const b of arr) {
                if (!b || !b.id) continue;
                if (this.BLOCK_DEFS && !this.BLOCK_DEFS[b.id]) continue;
                const pos = new THREE.Vector3(b.x, b.y, b.z);
                // Drop entries whose cell is already filled (e.g., by maze
                // geometry generated this run).
                let blocked = false;
                for (const w of this.walls) {
                    if (!w || !w.position || !w.size) continue;
                    if (Math.abs(w.position.x - pos.x) > w.size.x / 2 + 0.01) continue;
                    if (Math.abs(w.position.z - pos.z) > w.size.z / 2 + 0.01) continue;
                    if (Math.abs(w.position.y - pos.y) > w.size.y / 2 + 0.01) continue;
                    blocked = true; break;
                }
                if (blocked) continue;
                this._spawnPlacedBlock(b.id, pos);
                count++;
            }
            if (count) console.log(`[builds] restored ${count} block(s)`);
            return count;
        } catch (e) {
            console.warn('[builds] load failed', e);
            return 0;
        }
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
            id, category: 'weapon', icon: (this.weaponThumbs && this.weaponThumbs[id]) || w.icon, name: this.t(id)
        }));
        const consumables = Object.entries(this.ITEM_DEFS).map(([id, d]) => ({
            id, category: 'consumable', icon: d.emoji, name: this.t(d.labelKey)
        }));
        const blocks = Object.entries(this.BLOCK_DEFS || {}).map(([id, b]) => ({
            id, category: 'block', icon: (this.blockThumbs && this.blockThumbs[id]) || '🧱', name: b.name
        }));
        return { weapons, consumables, blocks, all: [...weapons, ...consumables, ...blocks] };
    }

    getSpeedBoostStock() {
        return this.inventory.items.filter((i) => i.type === 'speed').length;
    }

    // How many of `id` does the player currently own/have stocked?
    getItemCount(id) {
        if (this.WEAPON_STATS[id]) return this.player.weapons.includes(id) ? 1 : 0;
        if (this.BLOCK_DEFS && this.BLOCK_DEFS[id]) {
            return (this.inventory.blocks && this.inventory.blocks[id]) || 0;
        }
        switch (id) {
            case 'health':      return this.inventory.items.filter(i => i.type === 'health').length;
            case 'ammo':        return this.inventory.ammo;
            case 'jetpack':     return Math.floor(this.powerUps.jetpackFuel);
            case 'speed':       return this.getSpeedBoostStock();
            case 'healthRegen': return this.powerUps.healthRegen;
            case 'weaponBuff':  return this.powerUps.weaponBuff;
            case 'flag':        return this.inventory.flags;
            default:            return this.inventory.items.filter(i => i.type === id).length;
        }
    }

    isItemOwned(id) {
        if (id === 'speed') {
            return this.getSpeedBoostStock() > 0 || (this.powerUps.speedBoostTimer || 0) > 0;
        }
        // Placeable blocks have an infinite supply — always available in the drawer.
        if (this.BLOCK_DEFS && this.BLOCK_DEFS[id]) return true;
        return this.getItemCount(id) > 0;
    }

    initializeWeapons() {
        // Static weapon stats — single source of truth for tuning.
        // Names/descriptions are filled in by `weaponDefinitions` getter so language switches update them.
        this.WEAPON_STATS = {
            diamondSword:  { damage: 15, range: 3.5, cooldown: 0.25, type: 'melee', icon: '⚔️', color: 0x00aaff, ammoCost: 0 },
            swordGold:     { damage: 18, range: 3.5, cooldown: 0.22, type: 'melee', icon: '⚔️', color: 0xffcc44, ammoCost: 0 },
            swordStone:    { damage: 10, range: 3.2, cooldown: 0.28, type: 'melee', icon: '⚔️', color: 0x999999, ammoCost: 0 },
            skeletonAxe:   { damage: 28, range: 3.8, cooldown: 0.55, type: 'melee', icon: '🪓', color: 0xb38a55, ammoCost: 0 },
            axeDiamond:    { damage: 32, range: 3.9, cooldown: 0.60, type: 'melee', icon: '🪓', color: 0x66ddff, ammoCost: 0 },
            axeGold:       { damage: 24, range: 3.7, cooldown: 0.45, type: 'melee', icon: '🪓', color: 0xffcc44, ammoCost: 0 },
            skeletonBlade: { damage: 12, range: 3.0, cooldown: 0.18, type: 'melee', icon: '🗡️', color: 0xcccccc, ammoCost: 0 },
            skeletonStaff: { damage: 14, range: 4.2, cooldown: 0.40, type: 'melee', icon: '🪄', color: 0x8a6a3a, ammoCost: 0 },
            // ammoCost = 0 means free-fire (canFire/fireGun skip ammo checks).
            gun:          { damage: 25, range: 15,  cooldown: 0.30, type: 'ranged', icon: '🔫', color: 0x8B4513, ammoCost: 0 },
            // Machine gun: rapid fire, lower per-shot damage, slightly longer range. Auto-fire on mouse hold.
            machineGun:   { damage: 12, range: 22,  cooldown: 0.08, type: 'ranged', icon: '🔫', color: 0x222a33, ammoCost: 0, isContinuous: true }
        };

        // Tuning constants
        this.AMMO_MAX = 50;            // hard cap on carried ammo
        this.RELOAD_TIME = 1.5;
        this.RELOAD_AMOUNT = 12;       // R fills a "clip" worth, not magic-refill
        this.WEAPON_BUFF_PER_STACK = 0.2;

        // Player loadout
        this.player.weapons = ['diamondSword', 'swordGold', 'swordStone', 'skeletonAxe', 'axeDiamond', 'axeGold', 'skeletonBlade', 'skeletonStaff', 'gun', 'machineGun'];
        this.player.currentWeaponIndex = 0;
        this.inventory.ammo = 12;      // starting clip

        // dataURL <img> thumbnails rendered from weapon GLTFs (keyed by weapon id).
        // Populated asynchronously as templates finish loading; the drawer and
        // quickbar UIs fall back to WEAPON_STATS[id].icon (emoji) until then.
        this.weaponThumbs = {};

        // Power-up stacks / timers
        this.powerUps = {
            jetpackFuel: 0,
            speedBoostTimer: 0,
            healthRegen: 0,
            weaponBuff: 0
        };
        this.SPEED_BOOST_PER_PICKUP = 10;
        this.SPEED_BOOST_MAX_TIMER = 25;
        this.SPEED_BOOST_MOVE_MULT = 1.45;

        // Global multiplier applied to every enemy's authored scale at spawn.
        // 0.9 = 10% smaller across the board. Hitboxes are derived from the
        // scaled mesh bbox so they shrink along with the visual.
        this.ENEMY_SIZE_MULT = 0.8;

        // When true, every campaign level start also drops a free key + locked
        // crate within arm's reach of the player spawn so the crate system can
        // be smoke-tested without hunting through the maze. Set false to ship.
        this.DEBUG_SPAWN_LOOT_NEAR_PLAYER = false;

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
                speedBoost: Math.ceil(this.powerUps.speedBoostTimer || 0),
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
    
    // Data-driven melee weapon meshes. Adding a new melee weapon = WEAPON_STATS entry
    // + an asset path here + optional grip tuning in createWeaponModel.
    static MELEE_ASSETS = {
        diamondSword:  'assets/Blocks/tools/Sword_Diamond.gltf',
        swordGold:     'assets/Blocks/tools/Sword_Gold.gltf',
        swordStone:    'assets/Blocks/tools/Sword_Stone.gltf',
        skeletonAxe:   'assets/Blocks/pixel blocks/Skeleton_Axe.gltf',
        axeDiamond:    'assets/Blocks/tools/Axe_Diamond.gltf',
        axeGold:       'assets/Blocks/tools/Axe_Gold.gltf',
        skeletonBlade: 'assets/Blocks/pixel blocks/Skeleton_Blade.gltf',
        skeletonStaff: 'assets/Blocks/pixel blocks/Skeleton_Staff.gltf'
    };

    buildMeleeMesh(weaponId) {
        // Wrapper Group that holds either the loaded GLTF or a procedural placeholder.
        // Wrappers are tracked per-weapon so they can be re-populated once the GLTF arrives.
        const wrapper = new THREE.Group();
        wrapper.userData.meleeId = weaponId;
        this._meleeWrappers = this._meleeWrappers || {};
        (this._meleeWrappers[weaponId] = this._meleeWrappers[weaponId] || []).push(wrapper);
        this.populateMeleeWrapper(wrapper, weaponId);
        if (!this.meleeTemplates?.[weaponId] && !this._meleeLoading?.[weaponId]) {
            this.loadMeleeTemplate(weaponId);
        }
        return wrapper;
    }

    populateMeleeWrapper(wrapper, weaponId) {
        while (wrapper.children.length) wrapper.remove(wrapper.children[0]);
        const t = this.meleeTemplates?.[weaponId];
        if (t) {
            const clone = t.clone(true);
            const o = t.userData.orient;
            clone.rotation.set(o.rot.x, o.rot.y, o.rot.z);
            clone.position.set(0, o.posY, 0);
            clone.scale.setScalar(o.scale);
            wrapper.add(clone);
            return;
        }
        // Generic placeholder while the GLTF loads — short stick so the silhouette
        // doesn't pop in violently when the real mesh appears.
        const stub = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 1.4, 0.12),
            new THREE.MeshLambertMaterial({ color: 0x888888 })
        );
        stub.position.set(0, 0.5, 0);
        stub.castShadow = true;
        wrapper.add(stub);
    }

    loadMeleeTemplate(weaponId) {
        const path = Game3D.MELEE_ASSETS[weaponId];
        if (!path) return;
        this.meleeTemplates = this.meleeTemplates || {};
        this._meleeLoading = this._meleeLoading || {};
        this._meleeLoading[weaponId] = true;
        const loader = new THREE.GLTFLoader();
        loader.load(path, (gltf) => {
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
            // Normalize: longest axis points along +Y, total length ≈ 1.8u — matches
            // the original sword convention so per-weapon grip transforms compose predictably.
            const box0 = new THREE.Box3().setFromObject(template);
            const sz = box0.getSize(new THREE.Vector3());
            let rx = 0, rz = 0;
            if (sz.x >= sz.y && sz.x >= sz.z) rz = Math.PI / 2;
            else if (sz.z >= sz.y && sz.z >= sz.x) rx = Math.PI / 2;
            template.rotation.set(rx, 0, rz);
            template.updateMatrixWorld(true);
            const box1 = new THREE.Box3().setFromObject(template);
            const sz1 = box1.getSize(new THREE.Vector3());
            const scale = sz1.y > 0 ? 1.8 / sz1.y : 1;
            template.rotation.set(0, 0, 0);
            const posY = -box1.min.y * scale;
            template.userData.orient = { rot: { x: rx, y: 0, z: rz }, scale, posY };
            this.meleeTemplates[weaponId] = template;
            this._meleeLoading[weaponId] = false;
            const wrappers = this._meleeWrappers?.[weaponId];
            if (wrappers) wrappers.forEach((w) => this.populateMeleeWrapper(w, weaponId));

            this.weaponThumbs = this.weaponThumbs || {};
            const thumb = this._renderWeaponThumbnail(template);
            if (thumb) {
                this.weaponThumbs[weaponId] = thumb;
                this._qbSig = null;
                if (this.isDrawerOpen) this.updateDrawerUI();
                this.updateInventoryGridUI && this.updateInventoryGridUI();
            }
        }, undefined, (error) => {
            console.error(`Error loading melee template ${weaponId} (${path}):`, error);
            this._meleeLoading[weaponId] = false;
        });
    }

    // Legacy shims — callers outside this file may still reference these.
    buildSwordMesh() { return this.buildMeleeMesh('diamondSword'); }
    buildAxeMesh()   { return this.buildMeleeMesh('skeletonAxe'); }

    createWeaponModel() {
        // ===== Third-person hand-held weapons =====
        // Build a sword and a gun, each wrapped in a pivot Group whose local
        // position/rotation can be tuned to fit the character's right-hand bone.
        // The pivot's transform is the "grip" — when attached to a hand bone the
        // weapon emerges from the fist with a natural orientation.

        // Per-weapon grip + FPV tuning. Defaults match the original sword's pose;
        // weapons with wider/longer silhouettes override the FPV slot so they
        // don't dominate the viewport.
        const MELEE_DEFAULT_HELD = { scale: 0.35, rot: [-Math.PI / 2, 0, 0], pos: [0, 0, -0.25] };
        const MELEE_DEFAULT_FPV  = { pos: [0.5, -0.55, -0.7], rot: [-0.35, 0.3, 0.55], scale: 0.45 };
        const MELEE_TUNING = {
            skeletonAxe:   { held: { scale: 0.4 }, fpv: { pos: [0.55, -0.7, -0.75], rot: [-0.5, 0.35, 0.7],  scale: 0.25 } },
            axeDiamond:    { held: { scale: 0.4 }, fpv: { pos: [0.55, -0.7, -0.75], rot: [-0.5, 0.35, 0.7],  scale: 0.30 } },
            axeGold:       { held: { scale: 0.4 }, fpv: { pos: [0.55, -0.7, -0.75], rot: [-0.5, 0.35, 0.7],  scale: 0.30 } },
            skeletonStaff: { fpv: { scale: 0.35 } },
            skeletonBlade: { fpv: { scale: 0.40 } }
        };

        this.player.meleePivots = {};
        this.fpvMelees = {};
        for (const id of Object.keys(Game3D.MELEE_ASSETS)) {
            const tuning = MELEE_TUNING[id] || {};
            const heldT = { ...MELEE_DEFAULT_HELD, ...(tuning.held || {}) };
            const fpvT  = { ...MELEE_DEFAULT_FPV,  ...(tuning.fpv  || {}) };

            // 3rd-person pivot — attached to hand socket by attachActiveWeaponToHand.
            const pivot = new THREE.Group();
            const held = this.buildMeleeMesh(id);
            held.scale.setScalar(heldT.scale);
            held.rotation.set(heldT.rot[0], heldT.rot[1], heldT.rot[2]);
            held.position.set(heldT.pos[0], heldT.pos[1], heldT.pos[2]);
            pivot.add(held);
            this.player.meleePivots[id] = pivot;

            // FPV pivot — sits on the camera, visible only when this weapon is active.
            const fpvMesh = this.buildMeleeMesh(id);
            const fpvPivot = new THREE.Group();
            fpvPivot.position.set(fpvT.pos[0], fpvT.pos[1], fpvT.pos[2]);
            fpvMesh.rotation.set(fpvT.rot[0], fpvT.rot[1], fpvT.rot[2]);
            fpvMesh.scale.setScalar(fpvT.scale);
            fpvPivot.add(fpvMesh);
            this.camera.add(fpvPivot);
            fpvPivot.visible = false;
            this.fpvMelees[id] = {
                pivot: fpvPivot,
                rest: { pos: fpvPivot.position.clone(), rot: { x: 0, y: 0, z: 0 } }
            };
        }

        // Back-compat aliases — older code references these names directly.
        this.player.swordPivot = this.player.meleePivots.diamondSword;
        this.player.axePivot   = this.player.meleePivots.skeletonAxe;
        this.fpvSword          = this.fpvMelees.diamondSword?.pivot;
        this._fpvSwordRest     = this.fpvMelees.diamondSword?.rest;
        this.fpvAxe            = this.fpvMelees.skeletonAxe?.pivot;
        this._fpvAxeRest       = this.fpvMelees.skeletonAxe?.rest;

        this.player.gunPivot = new THREE.Group();
        const heldGun = this._buildGunMesh();
        heldGun.scale.setScalar(1.0);
        // The gun's -Z is forward. Rotate so the barrel points along the fist's forward.
        heldGun.rotation.set(0, Math.PI, 0);
        heldGun.position.set(0, 0, 0);
        this.player.gunPivot.add(heldGun);
        this.player.gunPivot.userData.muzzle = heldGun.userData.muzzle;

        // Machine gun — built once, swapped in on selection.
        this.player.machineGunPivot = new THREE.Group();
        const heldMG = this._buildMachineGunMesh();
        heldMG.scale.setScalar(0.95);
        heldMG.rotation.set(0, Math.PI, 0);
        heldMG.position.set(0, 0, 0.05);
        this.player.machineGunPivot.add(heldMG);
        this.player.machineGunPivot.userData.muzzle = heldMG.userData.muzzle;

        // Active 3rd-person weapon model — populated by attachActiveWeaponToHand
        this.player.weaponModel = null;

        // Swing animation state. Total swing duration covers three phases:
        // anticipation (wind-back) → strike (fast committed swing past rest)
        // → recovery (ease back). `swingDir` alternates ±1 between swings so
        // back-to-back attacks read as a combo instead of a single repeated
        // gesture.
        this.swingTimer = 0;
        this.swingDuration = 0.28;
        this.swingDir = 1;

        this.fpvGun = this._buildFpvGun();
        this.camera.add(this.fpvGun);
        this.fpvGun.visible = false;

        this.fpvMachineGun = this._buildFpvMachineGun();
        this.camera.add(this.fpvMachineGun);
        this.fpvMachineGun.visible = false;

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
        // Per-character grip tuning. By default the socket sits at the bone's local origin —
        // that's the bone HEAD, which for these models is roughly the wrist joint and works as
        // a reasonable default. Characters whose Hand_R bone head sits noticeably off the
        // visual fist can override this in `this.characters[key].grip`.
        const grip = this.characters
            && this.characters[this.currentCharacterKey]
            && this.characters[this.currentCharacterKey].grip;
        if (grip) {
            const p = grip.position || [0, 0, 0];
            const r = grip.rotation || [0, 0, 0];
            socket.position.set(p[0] || 0, p[1] || 0, p[2] || 0);
            socket.rotation.set(r[0] || 0, r[1] || 0, r[2] || 0);
        } else {
            socket.position.set(0, 0, 0);
            socket.rotation.set(0, 0, 0);
        }
        bone.add(socket);
        this.player.handSocket = socket;
        this.attachActiveWeaponToHand();
    }

    // Picks the right 3p weapon model based on the currently equipped weapon and
    // re-parents it to the hand socket. Falls back to the player.model root if
    // no socket is available yet.
    attachActiveWeaponToHand() {
        if (!this.player || !this.player.gunPivot) return;
        const allPivots = [
            ...Object.values(this.player.meleePivots || {}),
            this.player.gunPivot,
            this.player.machineGunPivot
        ];
        // While a block is armed, no weapon should be visible on the hand.
        if (this.activeBlockId) {
            for (const p of allPivots) {
                if (p && p.parent) p.parent.remove(p);
            }
            this.player.weaponModel = null;
            return;
        }

        const weaponId = this.player.weapons[this.player.currentWeaponIndex];
        let active = null;
        if (weaponId === 'machineGun' && this.player.machineGunPivot) {
            active = this.player.machineGunPivot;
        } else if (weaponId === 'gun') {
            active = this.player.gunPivot;
        } else if (this.player.meleePivots && this.player.meleePivots[weaponId]) {
            active = this.player.meleePivots[weaponId];
        } else {
            // Fallback to the sword if the id isn't recognized.
            active = this.player.swordPivot;
        }
        if (!active) return;
        for (const p of allPivots) {
            if (p && p !== active && p.parent) p.parent.remove(p);
        }
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

    _buildMachineGunMesh() {
        // Distinctive bulkier ranged weapon: longer barrel + foregrip + drum magazine.
        const gun = new THREE.Group();
        const matBody = new THREE.MeshLambertMaterial({ color: 0x1a1f26, emissive: 0x03050a });
        const matAccent = new THREE.MeshLambertMaterial({ color: 0x444a55, emissive: 0x080a10 });
        const matGrip = new THREE.MeshLambertMaterial({ color: 0x2a1a10, emissive: 0x080403 });
        const matBarrel = new THREE.MeshLambertMaterial({ color: 0x202428, emissive: 0x05060a });

        // Receiver / body
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.62), matBody);
        body.position.set(0, 0, -0.10);
        gun.add(body);

        // Top rail / sight
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.05, 0.50), matAccent);
        rail.position.set(0, 0.12, -0.10);
        gun.add(rail);
        const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.05), matAccent);
        rearSight.position.set(0, 0.17, 0.06);
        gun.add(rearSight);
        const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.04), matAccent);
        frontSight.position.set(0, 0.17, -0.38);
        gun.add(frontSight);

        // Long barrel — segmented for a heavy-weapon silhouette.
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 14), matBarrel);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.02, -0.55);
        gun.add(barrel);

        // Barrel shroud (vented look via thin rings)
        for (let i = 0; i < 4; i++) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 14), matAccent);
            ring.rotation.y = Math.PI / 2;
            ring.position.set(0, 0.02, -0.34 - i * 0.10);
            gun.add(ring);
        }

        // Muzzle brake
        const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.10, 8), matAccent);
        brake.rotation.x = Math.PI / 2;
        brake.position.set(0, 0.02, -0.85);
        gun.add(brake);

        // Foregrip (vertical, under the barrel)
        const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.07), matGrip);
        foregrip.position.set(0, -0.13, -0.30);
        gun.add(foregrip);

        // Trigger guard
        const guard = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.013, 6, 14, Math.PI), matAccent);
        guard.rotation.z = Math.PI;
        guard.position.set(0, -0.09, 0.06);
        gun.add(guard);

        // Main grip (angled, behind trigger)
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.24, 0.13), matGrip);
        grip.position.set(0, -0.20, 0.10);
        grip.rotation.x = 0.22;
        gun.add(grip);

        // Drum magazine — instantly reads as "machine gun".
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.10, 18), matBody);
        drum.rotation.x = Math.PI / 2;
        drum.position.set(0, -0.22, -0.06);
        gun.add(drum);
        const drumCap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.015, 18), matAccent);
        drumCap.rotation.x = Math.PI / 2;
        drumCap.position.set(0, -0.22, -0.115);
        gun.add(drumCap);

        // Stock (extends backward from receiver)
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.26), matGrip);
        stock.position.set(0, 0.02, 0.30);
        gun.add(stock);
        const stockPad = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.04), matAccent);
        stockPad.position.set(0, 0.02, 0.44);
        gun.add(stockPad);

        // Muzzle anchor — at the brake tip in local space.
        const muzzle = new THREE.Object3D();
        muzzle.position.set(0, 0.02, -0.92);
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

    _buildFpvMachineGun() {
        // Heavier weapon sits a touch lower-left and angled inward more aggressively.
        const pivot = new THREE.Group();
        pivot.position.set(0.32, -0.36, -0.7);
        pivot.rotation.set(0, -0.10, 0);

        const gun = this._buildMachineGunMesh();
        pivot.userData.muzzle = gun.userData.muzzle;

        const flashGeo = new THREE.PlaneGeometry(0.42, 0.42);
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

        gun.rotation.set(0.02, 0.16, -0.03);

        pivot.add(gun);
        pivot.userData.gun = gun;
        return pivot;
    }

    triggerSwordSwing() {
        this.swingTimer = this.swingDuration;
        // Alternate diagonal direction every swing for a left/right combo feel.
        this.swingDir = -(this.swingDir || 1);
    }

    updateSwordViewmodel(deltaTime) {
        const cur = this.getCurrentWeapon();
        const inFPV = this.viewMode === 'fpv';
        const inPlay = this.gameMode === 'play';
        // Block placement mode hides all weapon viewmodels — the ghost cube is the
        // active "weapon" while armed.
        const blockArmed = !!this.activeBlockId;

        // ---- Melee viewmodels (all melee weapons share the swing animation; only the active one is visible) ----
        const meleeWeaponId = this.player.weapons[this.player.currentWeaponIndex];
        if (this.swingTimer > 0) this.swingTimer = Math.max(0, this.swingTimer - deltaTime);

        for (const id in (this.fpvMelees || {})) {
            const m = this.fpvMelees[id];
            if (!m || !m.pivot) continue;
            const isActive = cur && cur.type === 'melee' && meleeWeaponId === id;
            m.pivot.visible = isActive && inFPV && inPlay && !blockArmed;
            if (!isActive) continue;
            const rest = m.rest;
            if (this.swingTimer > 0) {
                const t = 1 - (this.swingTimer / this.swingDuration); // 0 → 1
                const dir = this.swingDir || 1;
                const A = 0.20, S = 0.55;
                let antic = 0, strike = 0, recover = 0;
                if (t < A) {
                    const u = t / A;
                    antic = Math.sin(u * Math.PI / 2);
                } else if (t < S) {
                    const u = (t - A) / (S - A);
                    strike = (u * u) * 1.15;
                    antic = 1 - u;
                } else {
                    const u = (t - S) / (1 - S);
                    recover = 1 - (1 - u) * (1 - u);
                    strike = (1 - recover) * 1.15;
                }
                const swingZ = strike * 1.35;
                const swingX = strike * 0.55;
                const anticZ = antic * 0.30;
                const anticX = -antic * 0.25;
                m.pivot.rotation.z = (-swingZ - anticZ) * dir;
                m.pivot.rotation.x = swingX + anticX;
                m.pivot.rotation.y = strike * 0.25 * dir;
                m.pivot.position.z = rest.pos.z - strike * 0.28 + antic * 0.08;
                m.pivot.position.y = rest.pos.y + antic * 0.12 - strike * 0.08;
                m.pivot.position.x = rest.pos.x + (strike * 0.18 - antic * 0.06) * dir;
            } else {
                m.pivot.rotation.set(0, 0, 0);
                m.pivot.position.copy(rest.pos);
            }
        }

        // ---- Ranged viewmodels (pistol + machine gun share the same animation logic) ----
        const weaponId = this.player.weapons[this.player.currentWeaponIndex];
        const rangedModels = [
            { pivot: this.fpvGun,        id: 'gun',        baseY: -0.32, baseX: 0.36, baseZ: -0.6, kickZ: 0.18, kickRotX: 0.45 },
            { pivot: this.fpvMachineGun, id: 'machineGun', baseY: -0.36, baseX: 0.32, baseZ: -0.7, kickZ: 0.10, kickRotX: 0.22 }
        ];
        for (const r of rangedModels) {
            if (!r.pivot) continue;
            const isActive = cur && cur.type === 'ranged' && weaponId === r.id;
            r.pivot.visible = isActive && inFPV && inPlay && !blockArmed;

            if (this._gunRecoilT > 0 && isActive) {
                const k = this._gunRecoilT / this._gunRecoilDur;
                const ease = k * k;
                r.pivot.position.z = r.baseZ + ease * r.kickZ;
                r.pivot.rotation.x = -ease * r.kickRotX;
            } else {
                r.pivot.position.z = r.baseZ;
                r.pivot.rotation.x = 0;
            }

            if (r.pivot.visible && this.player && this.player.velocity) {
                const v = this.player.velocity;
                const speed = Math.hypot(v.x, v.z);
                this._gunBobT = (this._gunBobT || 0) + deltaTime * (speed * 1.5 + 1.5);
                const bobAmt = Math.min(1, speed / 6);
                r.pivot.position.y = r.baseY + Math.sin(this._gunBobT * 2) * 0.012 * bobAmt;
                r.pivot.position.x = r.baseX + Math.cos(this._gunBobT) * 0.008 * bobAmt;
            } else {
                r.pivot.position.y = r.baseY;
                r.pivot.position.x = r.baseX;
            }

            const flash = r.pivot.userData.flash;
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

    _getActiveFpvRanged() {
        const weaponId = this.player.weapons[this.player.currentWeaponIndex];
        if (weaponId === 'machineGun') return this.fpvMachineGun;
        if (weaponId === 'gun') return this.fpvGun;
        return null;
    }

    triggerGunRecoil() {
        this._gunRecoilT = this._gunRecoilDur;
        const active = this._getActiveFpvRanged();
        if (active && active.userData.flash) {
            active.userData.flash.userData.t = 0.06;
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
        // Third-person melee: do a player-centered arc check. Camera ray is
        // useless here because the camera sits 8+ units above the player —
        // every hit ends up beyond the 2.5u melee `range`.
        if (!isRanged && this.viewMode !== 'fpv') {
            return this._performMeleeArc({ damage, range, hitColor, missColor });
        }

        _scratchV2a.set(0, 0);
        _sharedRaycaster.setFromCamera(_scratchV2a, this.camera);

        const hits = _sharedRaycaster.intersectObjects(this.playMode.enemies, true);
        for (const hit of hits) {
            if (hit.distance > range) break;
            const e = this.findEnemyRoot(hit.object);
            if (!e) continue;
            e.userData.hp -= damage;
            this.spawnImpact(hit.point.clone(), hitColor);
            this.spawnDamageNumber(hit.point, damage);
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
        const dir = _sharedRaycaster.ray.direction.clone();
        const endPoint = origin.add(dir.multiplyScalar(range));
        this.spawnImpact(endPoint, missColor);
    }

    // Third-person melee: pick the closest enemy within `range` of the player
    // that's inside a 120° cone pointed at the *mouse aim* on the ground (so
    // the swing follows the cursor, not the body's current facing). Falls back
    // to character facing if the cursor can't be projected. Returns true on hit.
    _performMeleeArc({ damage, range, hitColor, missColor }) {
        const enemies = (this.playMode && this.playMode.enemies) || [];
        const px = this.player.position.x;
        const pz = this.player.position.z;

        // Aim direction = player → mouse-ground-projection on XZ plane.
        let fx = Math.sin(this.characterRotation);
        let fz = Math.cos(this.characterRotation);
        let aimGround = null;
        if (this.playMode && this.playMode.mouseNDC) {
            const ray = new THREE.Raycaster();
            ray.setFromCamera(this.playMode.mouseNDC, this.camera);
            const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const hit = new THREE.Vector3();
            if (ray.ray.intersectPlane(ground, hit)) {
                const ax = hit.x - px;
                const az = hit.z - pz;
                const len = Math.hypot(ax, az);
                if (len > 0.001) {
                    fx = ax / len;
                    fz = az / len;
                    aimGround = hit;
                }
            }
        }

        // Snap the body to the aim direction immediately so the swing visual
        // and the strike line up — without this the body can be 90° off when a
        // strafing player suddenly clicks.
        this.characterRotation = Math.atan2(fx, fz);

        const arcCos = Math.cos(Math.PI / 3); // ±60° → 120° total swing arc

        let best = null;
        let bestDist = Infinity;
        for (const e of enemies) {
            const dx = e.position.x - px;
            const dz = e.position.z - pz;
            const distXZ = Math.hypot(dx, dz);
            if (distXZ > range || distXZ < 0.001) continue;
            const dot = (fx * dx + fz * dz) / distXZ;
            if (dot < arcCos) continue;
            if (distXZ < bestDist) { bestDist = distXZ; best = e; }
        }

        // Always render a slash sweep in front of the player so the swing reads
        // as a real arc, not a ground sparkle.
        this._spawnMeleeSlash(fx, fz, range);

        if (best) {
            best.userData.hp -= damage;
            const hitPos = best.position.clone();
            hitPos.y += 1.0;
            this.spawnImpact(hitPos, hitColor);
            this.spawnDamageNumber(hitPos, damage);
            this.audio && this.audio.play('swordHit');
            // Small forward lunge — "step into" the strike, capped so it can't
            // shove the player through a wall.
            this.player.velocity.x += fx * 3.5;
            this.player.velocity.z += fz * 3.5;
            this._triggerHitShake(0.12, 0.1);
            if (best.userData.hp <= 0) {
                this.killEnemy(best);
            } else {
                this.applyEnemyKnockback(best, this.player.position, 9);
                this.flashEnemy(best);
                this.showEnemyHPBar(best, 3.0);
            }
            return true;
        }

        // No enemy in range — but maybe there's a destructible brick wall in the
        // swing arc. If so, chip it for 1 hp and bail (no enemy-miss ping).
        const wallHit = this._findMeleeWall(px, pz, fx, fz, range);
        if (wallHit) {
            this._damageWall(wallHit, 1);
            return false;
        }

        // True miss — faint ground ping at the aim cursor if it's in reach so
        // the player gets a clear "where did the swing land" cue.
        if (aimGround && Math.hypot(aimGround.x - px, aimGround.z - pz) <= range) {
            this.spawnImpact(aimGround, missColor);
        }
        return false;
    }

    // Closest destructible wall whose AABB intersects the player's melee arc.
    _findMeleeWall(px, pz, fx, fz, range) {
        const arcCos = Math.cos(Math.PI / 3);
        let best = null;
        let bestDist = Infinity;
        this._iterWallsNear(px, pz, range + 1, (w) => {
            if (!w.destructible) return;
            const halfX = w.size.x / 2;
            const halfZ = w.size.z / 2;
            const cx = Math.max(w.position.x - halfX, Math.min(px, w.position.x + halfX));
            const cz = Math.max(w.position.z - halfZ, Math.min(pz, w.position.z + halfZ));
            const dx = cx - px;
            const dz = cz - pz;
            const dist = Math.hypot(dx, dz);
            if (dist > range || dist < 0.001) return;
            const dot = (fx * dx + fz * dz) / dist;
            if (dot < arcCos) return;
            if (dist < bestDist) { bestDist = dist; best = w; }
        });
        return best;
    }

    // Apply damage to a destructible wall; remove from scene + walls list on
    // death, with a chunky burst + audio + small camera punch. Survivors flash
    // and darken so the player can see the damage progression.
    _damageWall(wall, damage = 1) {
        if (!wall || !wall.destructible) return;
        wall.hp = (wall.hp != null ? wall.hp : (wall.maxHp || 4)) - damage;
        const center = wall.position.clone();
        center.y = Math.max(0.2, center.y - wall.size.y * 0.25);
        if (wall.hp <= 0) {
            this.audio && this.audio.play && this.audio.play('wallBreak');
            this.spawnImpact(center, 0xb88a5a);
            this._spawnWallFragments(wall);
            this._triggerHitShake && this._triggerHitShake(0.18, 0.18);
            // 15% chance the rubble leaves a pickup behind.
            if (Math.random() < 0.15 && this.spawnPickup) {
                this.spawnPickup(wall.position.x, wall.position.z);
            }
            const i = this.walls.indexOf(wall);
            if (i !== -1) this.walls.splice(i, 1);
            this._removeWallFromHash(wall);
            if (wall.mesh) this.scene.remove(wall.mesh);
            if (wall.placed) this._scheduleSaveBuilds();
            return;
        }
        this.audio && this.audio.play && this.audio.play('wallChip');
        this.spawnImpact(center, 0xffeacc);
        this._flashWall(wall);
        this._tintDamagedWall(wall);
    }

    _flashWall(wall) {
        if (!wall.mesh) return;
        const flashed = [];
        wall.mesh.traverse((c) => {
            if (c.isMesh && c.material && c.material.color) {
                flashed.push({ mat: c.material, orig: c.material.color.getHex() });
                c.material.color.setHex(0xffffff);
            }
        });
        setTimeout(() => flashed.forEach(({ mat, orig }) => mat.color.setHex(orig)), 70);
    }

    // Visually telegraph wall HP by darkening the mesh as it takes hits.
    // `_origColor` is captured once so repeated darkening compounds correctly.
    _tintDamagedWall(wall) {
        if (!wall.mesh) return;
        const ratio = Math.max(0.35, wall.hp / (wall.maxHp || 4));
        wall.mesh.traverse((c) => {
            if (!c.isMesh || !c.material || !c.material.color) return;
            if (c.userData._origColor == null) c.userData._origColor = c.material.color.getHex();
            const base = c.userData._origColor;
            const r = ((base >> 16) & 0xff) * ratio;
            const g = ((base >> 8) & 0xff) * ratio;
            const b = (base & 0xff) * ratio;
            const tinted = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
            // Reapply on a tick after _flashWall's white pulse so it sticks.
            setTimeout(() => c.material.color.setHex(tinted), 80);
        });
    }

    _spawnWallFragments(wall) {
        // 6 small cubes that fly outward from the wall and fade in ~0.5s.
        const color = 0x8a6238;
        const center = wall.position.clone();
        for (let i = 0; i < 6; i++) {
            const m = new THREE.Mesh(
                new THREE.BoxGeometry(0.28, 0.28, 0.28),
                new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 })
            );
            m.position.copy(center);
            m.position.y = Math.max(0.4, center.y - wall.size.y * 0.25 + Math.random() * wall.size.y * 0.5);
            const ang = Math.random() * Math.PI * 2;
            const vx = Math.cos(ang) * (2 + Math.random() * 2);
            const vz = Math.sin(ang) * (2 + Math.random() * 2);
            const vy = 3 + Math.random() * 2;
            this.scene.add(m);
            const start = performance.now();
            const dur = 500;
            const tick = () => {
                const t = (performance.now() - start) / dur;
                if (t >= 1) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); return; }
                const dt = 1 / 60;
                m.position.x += vx * dt;
                m.position.z += vz * dt;
                m.position.y += (vy - 14 * t) * dt;
                m.rotation.x += 0.2;
                m.rotation.y += 0.15;
                m.material.opacity = 1 - t;
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }
    }

    // Translucent wedge that pops in front of the player and fades over ~140ms.
    // Sized to the weapon range and oriented along the aim direction.
    _spawnMeleeSlash(fx, fz, range) {
        const arcRadians = (2 * Math.PI) / 3; // 120°
        const segments = 18;
        const inner = range * 0.35;
        const outer = range * 1.0;
        const geo = new THREE.RingGeometry(inner, outer, segments, 1, -arcRadians / 2, arcRadians);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xeaf6ff,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const slash = new THREE.Mesh(geo, mat);
        slash.position.set(this.player.position.x, this.player.position.y + 0.9, this.player.position.z);
        // The ring is built in the XY plane with its arc opening along +X.
        // Lay it flat (XZ) and rotate so its center aligns with (fx, fz).
        slash.rotation.x = -Math.PI / 2;
        slash.rotation.z = -Math.atan2(fx, fz) + Math.PI / 2;
        this.scene.add(slash);

        const start = performance.now();
        const dur = 140;
        const animate = () => {
            const t = (performance.now() - start) / dur;
            if (t >= 1) { this.scene.remove(slash); geo.dispose(); mat.dispose(); return; }
            mat.opacity = 0.55 * (1 - t);
            const s = 1 + t * 0.12;
            slash.scale.set(s, s, s);
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    _triggerHitShake(intensity, duration) {
        // Piggyback on the arena shake channel — same camera, same updater.
        const s = (this.arena && this.arena.shake) || null;
        if (!s) return;
        // Don't stomp a stronger ongoing shake (e.g., boss eruption).
        if (s.intensity > intensity && s.elapsed < s.duration) return;
        s.intensity = intensity;
        s.duration = duration;
        s.elapsed = 0;
    }

    applyEnemyKnockback(e, sourcePos, strength = 7) {
        const dx = e.position.x - sourcePos.x;
        const dz = e.position.z - sourcePos.z;
        const len = Math.hypot(dx, dz) || 1;
        if (!e.userData.knockback) e.userData.knockback = new THREE.Vector2();
        e.userData.knockback.set((dx / len) * strength, (dz / len) * strength);
        e.userData.stunT = 0.4;
        // Brief hit-stop so the impact reads visually (~70ms freeze)
        e.userData.hitStopT = 0.07;
        // Flinch: stronger recoil away from the shot, decays in updateEnemies
        e.userData.flinchT = 0.32;
        e.userData.flinchMax = 0.32;
        // Hitting an enemy mid-wind-up cancels the attack — gives the player
        // a real reward for the dodge-and-strike rhythm.
        if (e.userData.attackWindupT > 0) {
            e.userData.attackWindupT = 0;
            e.userData.attackPending = false;
        }
        if (e.userData.rangedWindupT > 0) {
            e.userData.rangedWindupT = 0;
            e.userData.rangedPending = false;
        }
        // Getting hit alerts the enemy to the player's position even through
        // walls — otherwise you could shoot a demon from cover and they'd
        // just stand there.
        const ud = e.userData;
        if (ud.aiCfg) {
            ud.awareT = Math.max(ud.awareT || 0, (ud.aiCfg.alertMemory || 4.0));
            if (!ud.lastSeenPos) ud.lastSeenPos = new THREE.Vector2();
            ud.lastSeenPos.set(this.player.position.x, this.player.position.z);
            ud.aimPos = ud.lastSeenPos;
        }
    }

    findEnemyRoot(obj) {
        while (obj) {
            if (obj.userData && obj.userData.type === 'enemy') return obj;
            obj = obj.parent;
        }
        return null;
    }

    flashEnemy(e) {
        // Stash the true base color on each material the first time we ever
        // flash it. Without this, overlapping flashes capture the *current*
        // (already-white) color as "original" and revert to white forever.
        const mats = [];
        e.traverse((child) => {
            if (child.isMesh && child.material && child.material.color) {
                const mat = child.material;
                if (mat.userData._baseColor == null) mat.userData._baseColor = mat.color.getHex();
                if (mat.emissive && mat.userData._baseEmissive == null) {
                    mat.userData._baseEmissive = mat.emissive.getHex();
                }
                mat.color.setHex(0xffffff);
                if (mat.emissive) mat.emissive.setHex(0xffffff);
                mats.push(mat);
            }
        });
        // Bump a per-enemy flash counter; only the *last* revert restores,
        // so a rapid double-hit just extends the flash, never strands it.
        if (e.userData._flashId == null) e.userData._flashId = 0;
        const myId = ++e.userData._flashId;
        setTimeout(() => {
            if (e.userData._flashId !== myId) return; // a newer flash is active
            for (const mat of mats) {
                if (mat.userData._baseColor != null) mat.color.setHex(mat.userData._baseColor);
                if (mat.emissive && mat.userData._baseEmissive != null) mat.emissive.setHex(mat.userData._baseEmissive);
            }
        }, 130);
    }

    // Floating damage number sprite. Drifts up, fades out, then disposed.
    // Pooled by reusing canvas-textured sprites where possible.
    spawnDamageNumber(worldPos, amount, opts = {}) {
        const color = opts.color || (amount >= 20 ? '#ffd34a' : '#ffffff');
        const text = String(Math.round(amount));
        // Build a small canvas; reuse a shared pool to avoid per-hit garbage.
        if (!this._dmgNumPool) this._dmgNumPool = [];
        let entry = this._dmgNumPool.find(p => !p.active);
        if (!entry) {
            const canvas = document.createElement('canvas');
            canvas.width = 128; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
            const sprite = new THREE.Sprite(mat);
            sprite.scale.set(1.6, 0.8, 1);
            entry = { canvas, ctx, tex, sprite, mat, active: false };
            this._dmgNumPool.push(entry);
        }
        entry.active = true;
        // Render text
        const ctx = entry.ctx;
        ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
        ctx.font = 'bold 44px Courier New, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(text, 64, 32);
        ctx.fillStyle = color;
        ctx.fillText(text, 64, 32);
        entry.tex.needsUpdate = true;
        // Position above hit, with a tiny random horizontal jitter
        entry.sprite.position.set(
            worldPos.x + (Math.random() - 0.5) * 0.4,
            worldPos.y + 1.2,
            worldPos.z + (Math.random() - 0.5) * 0.4
        );
        entry.mat.opacity = 1;
        entry.sprite.scale.set(1.6, 0.8, 1);
        this.scene.add(entry.sprite);
        // Animate: drift up + fade, release back to pool when done.
        const start = performance.now();
        const dur = 800;
        const startY = entry.sprite.position.y;
        const tick = () => {
            const t = (performance.now() - start) / dur;
            if (t >= 1) {
                this.scene.remove(entry.sprite);
                entry.active = false;
                return;
            }
            entry.sprite.position.y = startY + t * 1.4;
            entry.mat.opacity = 1 - t;
            // Slight pop early on
            const s = 1 + (1 - Math.min(1, t * 4)) * 0.4;
            entry.sprite.scale.set(1.6 * s, 0.8 * s, 1);
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
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
        this.renderMazeButtons();
        this.updateModalContent();
        this._qbSig = null;
        this.updateInventoryGridUI && this.updateInventoryGridUI();
        if (this.isDrawerOpen) this.updateDrawerUI();
    }

    // Render the .maze-btn list from savedMazes. Called on init (after the
    // settings click delegation is wired) and on language switch. Buttons
    // are matched by data-maze index → savedMazes index, same contract the
    // delegated click handler expects.
    renderMazeButtons() {
        const container = document.getElementById('maze-buttons');
        if (!container || !this.savedMazes) return;
        const html = this.savedMazes.map((maze, i) => {
            const name = (maze.name || `Maze ${i + 1}`).replace(/[<>&"]/g, (c) => (
                { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]
            ));
            return `<button class="maze-btn" data-maze="${i}">${name}</button>`;
        }).join('');
        container.innerHTML = html;
        // Re-apply the active highlight after rebuild.
        container.querySelectorAll('.maze-btn').forEach((btn) => {
            if (parseInt(btn.dataset.maze) === this.currentMazeIndex) {
                btn.classList.add('active');
            }
        });
    }

    // Single source of truth for "is the player model visible?". Call this whenever
    // viewMode changes OR the player model is replaced (character swap, async load, etc.)
    applyViewModeToPlayerModel() {
        if (this.player && this.player.model) {
            this.player.model.visible = (this.viewMode !== 'fpv');
        }
    }

    // ---- Iso wall transparency: fade walls between camera and player ----
    // Each wall mesh keeps a reference to its opaque material; when it sits
    // on the line camera→player we swap to a shared faded clone, and swap
    // back when it no longer occludes. Cheap reference assignment per
    // transition, not per frame.
    _getFadedMaterial(origMat) {
        if (!origMat) return null;
        // One faded clone per unique opaque material — cached on the mat itself.
        // Opacity is intentionally very low: standard alpha-blending stacks
        // multiplicatively, so N walls in a row leave only (1-α)^N of the
        // background visible. At α=0.10, four stacked walls still transmit
        // (0.9)^4 ≈ 66% — enough to see the player through chunky cover.
        if (!origMat.userData._fadedClone) {
            const f = origMat.clone();
            f.transparent = true;
            f.opacity = 0.10;
            f.depthWrite = false;
            // Drop emissive on the fade so stacked walls don't accumulate
            // a glow that defeats the transparency. Lambert/Standard mats.
            if (f.emissive && f.emissive.setHex) f.emissive.setHex(0x000000);
            // Very faint white nudge so the fade reads as "intentional" without
            // washing out the color when only one layer is visible.
            if (f.color && f.color.lerp) f.color.lerp(new THREE.Color(0xffffff), 0.08);
            origMat.userData._fadedClone = f;
        }
        return origMat.userData._fadedClone;
    }

    _setWallFaded(wall, faded) {
        const mesh = wall.mesh || wall;
        if (!mesh || !mesh.material) return;
        if (faded) {
            if (wall._fadedActive) return;
            wall._origMat = mesh.material;
            const f = this._getFadedMaterial(mesh.material);
            if (f) mesh.material = f;
            wall._fadedActive = true;
        } else {
            if (!wall._fadedActive) return;
            if (wall._origMat) mesh.material = wall._origMat;
            wall._fadedActive = false;
        }
    }

    _updateWallFade() {
        if (!this._fadedWalls) this._fadedWalls = new Set();
        const wasFaded = this._fadedWalls;
        // FPV → restore everything and bail.
        if (this.viewMode === 'fpv' || !this.player || !this.player.position) {
            if (wasFaded.size === 0) return;
            for (const w of wasFaded) this._setWallFaded(w, false);
            wasFaded.clear();
            return;
        }
        const camX = this.camera.position.x, camZ = this.camera.position.z;
        const pX = this.player.position.x, pZ = this.player.position.z;
        const midX = (camX + pX) * 0.5, midZ = (camZ + pZ) * 0.5;
        const halfLen = Math.hypot(camX - pX, camZ - pZ) * 0.5;
        const nowFaded = new Set();
        // Only walls whose top is above the player's mid-height can actually
        // occlude — skip rubble/low debris so they stay solid.
        const playerEyeY = (this.player.position.y || 0) + 1.0;
        this._iterWallsNear(midX, midZ, halfLen + 1, (w) => {
            const top = w.position.y + (w.size ? w.size.y / 2 : 0.5);
            if (top < playerEyeY) return;
            if (this._segmentVsAABB(camX, camZ, pX, pZ,
                                    w.position.x, w.position.z,
                                    (w.size ? w.size.x : 1) / 2, (w.size ? w.size.z : 1) / 2)) {
                this._setWallFaded(w, true);
                nowFaded.add(w);
            }
        });
        // Restore walls that were faded last frame but no longer occlude.
        for (const w of wasFaded) {
            if (!nowFaded.has(w)) this._setWallFaded(w, false);
        }
        this._fadedWalls = nowFaded;
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
        // Dynamic shadow mapping disabled — the cheap drop-shadow disc under
        // the avatar carries the grounding cue and saves the PCF pass cost.
        this.renderer.shadowMap.enabled = false;
        
        // Create player (invisible in second-person view)
        this.createPlayer();
        
        // Create environment
        this.createEnvironment();
        
        // Add lighting
        this.setupLighting();

        // Add enemies group to scene
        this.scene.add(this.playMode.enemiesGroup);
        this.scene.add(this.playMode.cratesGroup);
        this.scene.add(this.playMode.keysGroup);
        // Add pickups group to scene
        this.pickupsGroup = new THREE.Group();
        this.scene.add(this.pickupsGroup);

        // Play mode (enemies, etc.) is initialized when a mode is chosen via ModeRegistry.

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
            weaponModel: null,
            ducked: false,
            duckBlend: 0
        };
        
        // Registry of swappable player characters (key matches data-character on the UI buttons).
        // `grip` (optional) tunes how weapons attach to the right-hand bone — `position` is in
        // bone-local space (same units as the bone), `rotation` is Euler XYZ in radians. Use this
        // when a model's Hand_R bone head sits away from the visual fist (PJBoy's bone head is at
        // the wrist; weapons need to slide along the bone toward the fingertips to look held).
        this.characters = {
            pjboy:    { label: 'PJBoy',    path: 'assets/Blocks/Characters/Character_PJBoy.glb',
                        grip: { position: [0, 0.06, 0], rotation: [0, 0, 0] } },
            skeleton: { label: 'Skeleton', path: 'assets/Blocks/enemies/Skeleton_Armor.gltf' },
            female1:  { label: 'Female 1', path: 'assets/Blocks/Characters/Character_Female_1.gltf' },
            female2:  { label: 'Female 2', path: 'assets/Blocks/Characters/Character_Female_2.gltf' },
            male1:    { label: 'Male 1',   path: 'assets/Blocks/Characters/Character_Male_1.gltf' },
            male2:    { label: 'Male 2',   path: 'assets/Blocks/Characters/Character_Male_2.gltf' }
        };
        this.currentCharacterKey = this.currentCharacterKey || 'pjboy';

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
        // Reuse the shared thumbnail renderer — a fresh WebGLRenderer per call
        // pushes the browser past its WebGL context cap (≈16), evicting the
        // main game renderer and producing a white screen.
        const renderer = this._getThumbnailRenderer(size);
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
            const toLambert = (src, isSkinned) => new THREE.MeshLambertMaterial({
                map: (src && src.map) || null,
                color: (src && src.color) ? src.color.clone() : new THREE.Color(0xffffff),
                side: src ? src.side : THREE.FrontSide,
                skinning: isSkinned === true
            });
            character.traverse((child) => {
                if (child.isMesh) {
                    const isSkinned = child.isSkinnedMesh === true;
                    // glTF meshes with multiple primitives can occasionally arrive as a single
                    // mesh with an array of materials; handle both array and scalar shapes.
                    if (Array.isArray(child.material)) {
                        child.material = child.material.map((m) => toLambert(m, isSkinned));
                    } else {
                        child.material = toLambert(child.material, isSkinned);
                    }
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
            for (const p of Object.values(this.player.meleePivots || {})) {
                if (p && p.parent) p.parent.remove(p);
            }
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
    
    preloadZombieTemplate() {
        // Roster of all enemy types. The original `zombieTemplate` field is kept
        // for back-compat with anything that still reads it; new code reads
        // `this.enemyTemplates[typeKey]` instead.
        // sightRange = how far they can see in a straight line (walls block).
        // alertMemory = seconds they keep chasing the *last seen* position
        // after losing line-of-sight; when it expires they go back to idle
        // wander. Tuned so hiding feels viable but not trivial.
        // sightRange = how far they can see in a straight line (walls block).
        // alertMemory = seconds they keep chasing the *last seen* position
        // after losing LOS; when it expires they go back to idle wander.
        // viewCone = full FOV in degrees. Outside the cone the enemy is blind
        // — you can sneak past from behind. Wide for jumpy prey (chicks),
        // narrow for slow brutes (zombies).
        this.enemyTypes = {
            zombie:  { path: 'Zombie.gltf',                          scale: 0.9, hp: [50, 150],  speed: [1.2, 2.0], damage: 10, color: 0x6aa84f,
                       ai: 'chase',     sightRange: 14, alertMemory: 4.0, viewCone: 140,
                       lunge: { cooldown: [4, 7], dur: 0.4, mult: 2.4 } },
            demon:   { path: 'assets/Blocks/enemies/Demon.gltf',     scale: 1.1, hp: [90, 140],  speed: [1.0, 1.4], damage: 12, color: 0xc73a2a,
                       ai: 'kite',      sightRange: 22, alertMemory: 3.5, viewCone: 200,
                       kite: { ideal: 9, retreat: 6, approach: 12, strafePeriod: [1.0, 2.2] },
                       ranged: { cooldown: 2.0, range: 14, projectileSpeed: 18, damage: 10, color: 0xff5522 } },
            goblin:  { path: 'assets/Blocks/enemies/Goblin.gltf',    scale: 0.85, hp: [45, 90],  speed: [1.6, 2.4], damage: 8,  color: 0x4d8a3a,
                       ai: 'hitAndRun', sightRange: 18, alertMemory: 3.0, viewCone: 220,
                       backoffDur: 0.9, backoffMult: 1.6, zigzagAmp: 0.55, zigzagPeriod: 0.55 },
            chick:   { path: 'assets/Blocks/Animals/Chick.gltf',     scale: 0.7, hp: [10, 18],   speed: [1.8, 2.6], damage: 3,  color: 0xffd84d,
                       ai: 'skittish',  sightRange: 10, alertMemory: 2.0, viewCone: 320,
                       fleeDist: 4.5 },
            chicken: { path: 'assets/Blocks/Animals/Chicken.gltf',   scale: 0.8, hp: [18, 28],   speed: [1.4, 2.0], damage: 4,  color: 0xeeeeee,
                       ai: 'skittish',  sightRange: 10, alertMemory: 2.0, viewCone: 320,
                       fleeDist: 5.0 },
        };
        this.enemyTemplates = {};

        const loader = new THREE.GLTFLoader();
        const onAnyLoad = () => {
            // Swap fallback spheres → real models once their template arrives.
            if (this.playMode && this.playMode.enemies.length > 0) this.respawnEnemies();
        };
        for (const [key, cfg] of Object.entries(this.enemyTypes)) {
            loader.load(cfg.path, (gltf) => {
                this.enemyTemplates[key] = { scene: gltf.scene, animations: gltf.animations || [] };
                if (key === 'zombie') this.zombieTemplate = this.enemyTemplates[key];
                onAnyLoad();
            }, undefined, (err) => {
                console.error(`Error loading enemy template "${key}" from ${cfg.path}:`, err);
            });
        }
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
        // Crystal "sky" — a tiled ceiling above the tallest walls. Tile size is
        // tuned so each block reads as a discrete glowing cube from the ground
        // (smaller tiles dissolved into speckle at the 20u viewing distance).
        this.roofTileSize = 4;
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

        // Maze / play space is built when a mode starts (see ModeRegistry), not at boot.

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
            ['chestOpen',  'assets/Blocks/environment/Chest_Open.gltf'],
            ['key',        'assets/Blocks/environment/Key.gltf'],
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
            // Pink/magenta self-illumination so the roof reads as a glowing
            // crystal cube from below (matches the create-mode block preview),
            // not just dimly-lit speckle.
            const mat = new THREE.MeshLambertMaterial({
                map: srcMat.map || null,
                color: srcMat.color ? srcMat.color.clone() : new THREE.Color(0xffffff),
                emissive: new THREE.Color(0xff66ff),
                emissiveIntensity: 0.55,
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

        // Per-tile destructible state. Key = "x,z" (tile center coords);
        // tracks the InstancedMesh slot, hp, and an `alive` flag used by the
        // ceiling collision checks so projectiles can fly through broken gaps.
        this.roofTiles = new Map();
        this._roofTileHalf = tile / 2;
        this._roofTileMaxHp = 4;

        let i = 0;
        for (let x = -half; x <= half; x += tile) {
            for (let z = -half; z <= half; z += tile) {
                dummy.position.set(x, blockCenterY, z);
                dummy.scale.set(scale, scale, scale);
                dummy.rotation.y = 0;
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
                this.roofTiles.set(`${x},${z}`, {
                    idx: i, x, z, alive: true,
                    hp: this._roofTileMaxHp, maxHp: this._roofTileMaxHp,
                });
                i++;
            }
        }
        mesh.count = i;
        mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(mesh);
        this.crystalRoof = mesh;
    }

    // Locate the roof tile under world coords (x, z). Returns the tile record
    // or null (off-grid / already destroyed).
    _roofTileAt(x, z) {
        if (!this.roofTiles || !this.roofTileSize) return null;
        const t = this.roofTileSize;
        const tx = Math.round(x / t) * t;
        const tz = Math.round(z / t) * t;
        const rec = this.roofTiles.get(`${tx},${tz}`);
        return (rec && rec.alive) ? rec : null;
    }

    _damageRoofTile(tile, damage = 1) {
        if (!tile || !tile.alive) return;
        tile.hp -= damage;
        const impactPos = new THREE.Vector3(tile.x, this.roofY - 0.1, tile.z);
        if (tile.hp <= 0) {
            tile.alive = false;
            if (this.crystalRoof) {
                const m = new THREE.Matrix4().makeScale(0, 0, 0);
                this.crystalRoof.setMatrixAt(tile.idx, m);
                this.crystalRoof.instanceMatrix.needsUpdate = true;
            }
            this.audio && this.audio.play && this.audio.play('crystalBreak');
            this.spawnImpact(impactPos, 0xff66ff);
            this._spawnCrystalShards(tile);
            this._spawnRoofLightShaft(tile);
            this._triggerHitShake && this._triggerHitShake(0.10, 0.12);
            return;
        }
        this.audio && this.audio.play && this.audio.play('wallChip');
        this.spawnImpact(impactPos, 0xffaaff);
    }

    // Pink crystal shards rain down from a broken roof tile and fade.
    _spawnCrystalShards(tile) {
        const color = 0xff66ff;
        const sz = this.roofTileSize * 0.18;
        for (let i = 0; i < 7; i++) {
            const m = new THREE.Mesh(
                new THREE.BoxGeometry(sz, sz, sz),
                new THREE.MeshLambertMaterial({
                    color, emissive: color, emissiveIntensity: 0.55,
                    transparent: true, opacity: 1
                })
            );
            m.position.set(
                tile.x + (Math.random() - 0.5) * this.roofTileSize * 0.6,
                this.roofY - 0.2,
                tile.z + (Math.random() - 0.5) * this.roofTileSize * 0.6
            );
            const vx = (Math.random() - 0.5) * 2.2;
            const vz = (Math.random() - 0.5) * 2.2;
            let vy = -1.0 - Math.random() * 1.5;
            this.scene.add(m);
            const start = performance.now();
            const dur = 1200;
            const tick = () => {
                const t = (performance.now() - start) / dur;
                if (t >= 1) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); return; }
                const dt = 1 / 60;
                m.position.x += vx * dt;
                m.position.z += vz * dt;
                vy -= 18 * dt;
                m.position.y += vy * dt;
                m.rotation.x += 0.25;
                m.rotation.y += 0.18;
                m.material.opacity = 1 - t;
                if (m.position.y < 0.2) {
                    m.position.y = 0.2;
                    vy = 0;
                }
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }
    }

    // Thin downward beam of light through a freshly-opened roof hole.
    // Fades in ~1.5s and then sticks at low intensity until next reset.
    _spawnRoofLightShaft(tile) {
        const r = this.roofTileSize * 0.45;
        const h = this.roofY;
        const geo = new THREE.CylinderGeometry(r, r * 1.4, h, 12, 1, true);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xffe7ff, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        });
        const beam = new THREE.Mesh(geo, mat);
        beam.position.set(tile.x, h / 2, tile.z);
        this.scene.add(beam);
        const start = performance.now();
        const dur = 1400;
        const tick = () => {
            const t = (performance.now() - start) / dur;
            if (t >= 1) { mat.opacity = 0.18; return; }
            mat.opacity = 0.45 * (1 - Math.abs(0.5 - t) * 2) + 0.18 * t;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
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
        // Pre-defined maze layouts. We trimmed the old "Classic Small / Open
        // Arena / Spiral / Labyrinth" entries — Wide Halls is the open
        // playground; ASCII is the curated maze.
        this.savedMazes = [
            {
                name: this.t('wideHalls'),
                size: 100,
                type: "generated",
                description: this.t('wideHallsDesc')
            },
            {
                name: this.t('asciiMaze'),
                size: 41,
                type: "ascii",
                description: this.t('asciiMazeDesc')
            }
        ];
    }


    initializeCreateMode() {
        this.createMode.customMaze = [];
        for (let y = 0; y < this.createMode.gridSize; y++) {
            this.createMode.customMaze[y] = [];
            for (let x = 0; x < this.createMode.gridSize; x++) {
                this.createMode.customMaze[y][x] = '.';
            }
        }
        this.createGridHighlights();
    }

    createGridHighlights() {
        this.createMode.highlightObjects.forEach(obj => {
            this.scene.remove(obj);
        });
        this.createMode.highlightObjects = [];

        if (this.gameMode !== 'create') return;

        // Sand-yellow placement highlight
        const highlightMaterial = new THREE.MeshBasicMaterial({
            color: 0xffe8a0,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide
        });

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
                highlight.visible = true;
                highlight.userData = { gridX: x, gridZ: y };
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
            this.clearMaze();
            this.initializeCreateMode();
            this.updateToolPreview();
            document.body.style.cursor = 'crosshair';
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
            // Spawn on perimeter facing inward
            const spawn = this.getCreateModePerimeterSpawn();
            this.player.position.set(spawn.x, 1, spawn.z);
            this.characterRotation = spawn.facingY;
        } else {
            this.createMode.highlightObjects.forEach(obj => {
                this.scene.remove(obj);
            });
            this.createMode.highlightObjects = [];
            if (this.createMode.previewObject) {
                this.scene.remove(this.createMode.previewObject);
                this.createMode.previewObject = null;
            }
            document.body.style.cursor = 'default';
            this.createLabyrinth();
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
        this.walls.forEach(wall => {
            const mesh = wall.mesh ? wall.mesh : wall;
            this.scene.remove(mesh);
        });
        this.walls = [];
        this.wallHash = new Map();

        if (this.labyrinthMarkers && this.labyrinthMarkers.length) {
            this.labyrinthMarkers.forEach(m => this.scene.remove(m));
            this.labyrinthMarkers = [];
        }

        if (this.pickups && this.pickups.length) {
            this.pickups.forEach(p => this.pickupsGroup.remove(p));
            this.pickups = [];
        }

        // Crates + keys live alongside the maze — wipe them together.
        if (this.clearCratesAndKeys) this.clearCratesAndKeys();
    }


    setupToolboxListeners() {
        const closeToolbox = document.querySelector('.close-toolbox');
        if (closeToolbox) {
            closeToolbox.addEventListener('click', () => {
                this.toggleToolboxModal();
            });
        }

        const toolboxModal = document.getElementById('toolbox-modal');
        if (toolboxModal) {
            toolboxModal.addEventListener('click', (e) => {
                if (e.target === toolboxModal) {
                    this.toggleToolboxModal();
                }
            });
        }

        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                this.setCreateTool(tool);
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
            if (this.gameMode === 'create') {
                document.body.style.cursor = 'crosshair';
            }
        } else {
            this.closeAllModals();

            modal.style.display = 'block';
            this.modalOpen = true;
            document.body.classList.add('modal-open');
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
        if (this.createMode.previewObject) {
            this.scene.remove(this.createMode.previewObject);
            this.createMode.previewObject = null;
        }

        if (this.gameMode !== 'create') return;

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
        this.createMode.previewObject.visible = false;
        this.scene.add(this.createMode.previewObject);
    }

    updateToolboxContent() {
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.tool === this.createMode.tool) {
                btn.classList.add('active');
            }
        });
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

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        const canvas = document.getElementById('gameCanvas');
        const rect = canvas.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        mouse.x = x;
        mouse.y = y;

        raycaster.setFromCamera(mouse, this.camera);

        const intersects = raycaster.intersectObjects(this.createMode.highlightObjects);

        if (intersects.length > 0) {
            const highlight = intersects[0].object;
            const { gridX, gridZ } = highlight.userData;

            if (gridX >= 0 && gridX < this.createMode.gridSize && gridZ >= 0 && gridZ < this.createMode.gridSize) {
                const worldPos = this.getWorldPositionFromGrid(gridX, gridZ);
                this.createMode.previewObject.position.set(worldPos.x, 2, worldPos.z);
                if (this.createMode.tool === 'erase') {
                    // Suppress the red erase preview on empty cells
                    const hasWall = this.createMode.customMaze[gridZ][gridX] === '#';
                    this.createMode.previewObject.visible = hasWall;
                } else {
                    this.createMode.previewObject.visible = true;
                }

                if (this.createMode.isMouseDown) {
                    const currentGridPos = { x: gridX, z: gridZ };
                    const lastPos = this.createMode.lastGridPos;

                    if (this.createMode.isShiftHeld) {
                        if (!this.createMode.startLinePos) {
                            this.createMode.startLinePos = currentGridPos;
                            this.handleContinuousPlacement(gridX, gridZ);
                        } else {
                            this.drawStraightLine(this.createMode.startLinePos, currentGridPos);
                        }
                    } else {
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
        const points = this.getLinePoints(startPos.x, startPos.z, endPos.x, endPos.z);

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

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        const canvas = document.getElementById('gameCanvas');
        const rect = canvas.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        mouse.x = x;
        mouse.y = y;

        raycaster.setFromCamera(mouse, this.camera);

        const intersects = raycaster.intersectObjects(this.createMode.highlightObjects);

        if (intersects.length > 0) {
            const highlight = intersects[0].object;
            const { gridX, gridZ } = highlight.userData;

            if (gridX >= 0 && gridX < this.createMode.gridSize && gridZ >= 0 && gridZ < this.createMode.gridSize) {
                if (this.createMode.isShiftHeld) {
                    // Shift = straight-line drag; first click anchors, hover draws.
                    if (!this.createMode.startLinePos) {
                        this.createMode.startLinePos = { x: gridX, z: gridZ };
                        this.handleContinuousPlacement(gridX, gridZ);
                    }
                } else {
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
        if (this.createMode.customMaze[gridZ][gridX] === '#') return;

        this.createMode.customMaze[gridZ][gridX] = '#';
        this.createWallAtGrid(gridX, gridZ);
    }

    eraseWall(gridX, gridZ) {
        if (this.createMode.customMaze[gridZ][gridX] === '.') return;

        this.createMode.customMaze[gridZ][gridX] = '.';
        this.removeWallAtGrid(gridX, gridZ);
    }

    placeStartPoint(gridX, gridZ) {
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
        // Build the 2×4×2 wall as a stack of 1×1×1 destructible sub-blocks.
        // Each sub-block has its own AABB + HP, so melee/projectile hits chip
        // away one Minecraft-style cube at a time instead of removing the wall.
        this._addDestructibleBlockColumn(worldPos.x, 0, worldPos.z, 2, 4, 2);
    }

    // ===== Spatial hash for walls =====
    _wallCellsForBox(px, pz, sx, sz) {
        const c = this._wallHashCell;
        const minX = Math.floor((px - sx / 2) / c);
        const maxX = Math.floor((px + sx / 2) / c);
        const minZ = Math.floor((pz - sz / 2) / c);
        const maxZ = Math.floor((pz + sz / 2) / c);
        const out = [];
        for (let cx = minX; cx <= maxX; cx++)
            for (let cz = minZ; cz <= maxZ; cz++)
                out.push(`${cx},${cz}`);
        return out;
    }

    _addWallToHash(wall) {
        if (!wall || !wall.size || !wall.position) return;
        const keys = this._wallCellsForBox(wall.position.x, wall.position.z, wall.size.x, wall.size.z);
        wall._hashKeys = keys;
        for (const k of keys) {
            let arr = this.wallHash.get(k);
            if (!arr) { arr = []; this.wallHash.set(k, arr); }
            arr.push(wall);
        }
    }

    _removeWallFromHash(wall) {
        if (!wall || !wall._hashKeys) return;
        for (const k of wall._hashKeys) {
            const arr = this.wallHash.get(k);
            if (!arr) continue;
            const i = arr.indexOf(wall);
            if (i !== -1) arr.splice(i, 1);
            if (arr.length === 0) this.wallHash.delete(k);
        }
        wall._hashKeys = null;
    }

    _rehashAllWalls() {
        this.wallHash = new Map();
        for (const w of this.walls) {
            if (w._hashKeys) w._hashKeys = null;
            this._addWallToHash(w);
        }
    }

    // Iterate every wall whose bucket overlaps the XZ disc (cx, cz, radius).
    // Callback may return false to short-circuit (e.g. first-hit found).
    _iterWallsNear(cx, cz, radius, cb) {
        const c = this._wallHashCell;
        const minX = Math.floor((cx - radius) / c);
        const maxX = Math.floor((cx + radius) / c);
        const minZ = Math.floor((cz - radius) / c);
        const maxZ = Math.floor((cz + radius) / c);
        const seen = new Set();
        for (let ix = minX; ix <= maxX; ix++) {
            for (let iz = minZ; iz <= maxZ; iz++) {
                const arr = this.wallHash.get(`${ix},${iz}`);
                if (!arr) continue;
                for (const w of arr) {
                    if (seen.has(w)) continue;
                    seen.add(w);
                    if (cb(w) === false) return;
                }
            }
        }
    }

    // Decompose a (sizeX × sizeY × sizeZ) brick column centered at (cx, cz)
    // and sitting on top of baseY into 1×1×1 cubes. Each cube is its own
    // wall entry. When opts.destructible is true (default) each brick has
    // hp=1 so a single hit chips it off; when false they route through the
    // merged-geometry path: one mesh per column, same brick look, ~64× fewer
    // draw calls (critical for the ASCII maze).
    _addDestructibleBlockColumn(cx, baseY, cz, sizeX, sizeY, sizeZ, opts) {
        const destructible = !opts || opts.destructible !== false;
        if (!destructible) {
            return this._addMergedBrickColumn(cx, baseY, cz, sizeX, sizeY, sizeZ);
        }
        const nx = Math.max(1, Math.round(sizeX));
        const ny = Math.max(1, Math.round(sizeY));
        const nz = Math.max(1, Math.round(sizeZ));
        const x0 = cx - nx / 2 + 0.5;
        const z0 = cz - nz / 2 + 0.5;
        const y0 = baseY + 0.5;
        for (let iy = 0; iy < ny; iy++) {
            for (let ix = 0; ix < nx; ix++) {
                for (let iz = 0; iz < nz; iz++) {
                    const mesh = this._createUnitBrickMesh();
                    mesh.position.set(x0 + ix, y0 + iy, z0 + iz);
                    this.scene.add(mesh);
                    const entry = {
                        mesh,
                        position: mesh.position,
                        size: { x: 1, y: 1, z: 1 },
                        destructible: true,
                        hp: 1, maxHp: 1,
                    };
                    this.walls.push(entry);
                    this._addWallToHash(entry);
                }
            }
        }
    }

    // Non-destructible wall column. Bakes N copies of the brick template
    // geometry into one merged BufferGeometry at compile-time positions, so
    // a 4×4×4 wall ships as a single Mesh instead of 64. Looks identical
    // to the destructible version (same template, same material). Geometry
    // is cached per column size — most ASCII walls share one buffer.
    _addMergedBrickColumn(cx, baseY, cz, sizeX, sizeY, sizeZ) {
        const tpl = this.bricksTemplate;
        // Bricks GLTF not loaded yet — fall back to plain boxes; rebuildMaze
        // fires once the template arrives and we'll re-stamp with the merge.
        if (!tpl || !tpl.geometry) {
            const mat = (this.materials && this.materials.wall) || new THREE.MeshLambertMaterial({ color: 0x8a6238 });
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(sizeX, sizeY, sizeZ), mat);
            mesh.position.set(cx, baseY + sizeY / 2, cz);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            const entry = { mesh, position: mesh.position, size: { x: sizeX, y: sizeY, z: sizeZ }, destructible: false };
            this.walls.push(entry);
            this._addWallToHash(entry);
            return;
        }
        const geo = this._getMergedBrickColumnGeometry(sizeX, sizeY, sizeZ);
        const mesh = new THREE.Mesh(geo, tpl.material);
        // Mesh sits with its origin at the column's CENTER on every axis so
        // mesh.position can double as the collision AABB center. The merged
        // geometry is built centered at origin to match.
        mesh.position.set(cx, baseY + sizeY / 2, cz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        const entry = {
            mesh,
            position: mesh.position,
            size: { x: sizeX, y: sizeY, z: sizeZ },
            destructible: false,
        };
        this.walls.push(entry);
        this._addWallToHash(entry);
    }

    // Build (and cache) the merged BufferGeometry for a wall column of a
    // given size, by repeating the brick template at nx×ny×nz positions
    // and baking per-instance offsets directly into the position attribute.
    _getMergedBrickColumnGeometry(sx, sy, sz) {
        if (!this._mergedBrickCache) this._mergedBrickCache = {};
        const key = `${sx}x${sy}x${sz}`;
        if (this._mergedBrickCache[key]) return this._mergedBrickCache[key];

        const tpl = this.bricksTemplate;
        const src = tpl.geometry;
        const bb = src.boundingBox;
        const native = (bb && (bb.max.y - bb.min.y)) || 2;
        const scale = 1 / native;

        const nx = Math.max(1, Math.round(sx));
        const ny = Math.max(1, Math.round(sy));
        const nz = Math.max(1, Math.round(sz));
        // Bake bricks centered around the geometry origin on all three axes
        // so the mesh.position (placed at baseY + sizeY/2) lines up with the
        // collision AABB center. Without the y centering the top half of
        // the wall had no collision.
        const x0 = -nx / 2 + 0.5;
        const z0 = -nz / 2 + 0.5;
        const y0 = -ny / 2 + 0.5;

        const srcPos = src.attributes.position ? src.attributes.position.array : null;
        const srcNorm = src.attributes.normal ? src.attributes.normal.array : null;
        const srcUV = src.attributes.uv ? src.attributes.uv.array : null;
        const srcIdx = src.index ? src.index.array : null;
        if (!srcPos) return new THREE.BoxGeometry(sx, sy, sz);
        const vertCount = srcPos.length / 3;
        const totalInst = nx * ny * nz;

        const mPos = new Float32Array(srcPos.length * totalInst);
        const mNorm = srcNorm ? new Float32Array(srcNorm.length * totalInst) : null;
        const mUV = srcUV ? new Float32Array(srcUV.length * totalInst) : null;
        const mIdx = srcIdx ? new Uint32Array(srcIdx.length * totalInst) : null;

        let inst = 0;
        for (let iy = 0; iy < ny; iy++) {
            for (let ix = 0; ix < nx; ix++) {
                for (let iz = 0; iz < nz; iz++) {
                    const dx = x0 + ix, dy = y0 + iy, dz = z0 + iz;
                    const posBase = inst * srcPos.length;
                    for (let v = 0; v < vertCount; v++) {
                        mPos[posBase + v * 3 + 0] = srcPos[v * 3 + 0] * scale + dx;
                        mPos[posBase + v * 3 + 1] = srcPos[v * 3 + 1] * scale + dy;
                        mPos[posBase + v * 3 + 2] = srcPos[v * 3 + 2] * scale + dz;
                        if (srcNorm) {
                            mNorm[posBase + v * 3 + 0] = srcNorm[v * 3 + 0];
                            mNorm[posBase + v * 3 + 1] = srcNorm[v * 3 + 1];
                            mNorm[posBase + v * 3 + 2] = srcNorm[v * 3 + 2];
                        }
                    }
                    if (srcUV) {
                        const uvBase = inst * srcUV.length;
                        for (let v = 0; v < vertCount; v++) {
                            mUV[uvBase + v * 2 + 0] = srcUV[v * 2 + 0];
                            mUV[uvBase + v * 2 + 1] = srcUV[v * 2 + 1];
                        }
                    }
                    if (srcIdx) {
                        const idxBase = inst * srcIdx.length;
                        const vertOff = inst * vertCount;
                        for (let i = 0; i < srcIdx.length; i++) {
                            mIdx[idxBase + i] = srcIdx[i] + vertOff;
                        }
                    }
                    inst++;
                }
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
        if (mNorm) geo.setAttribute('normal', new THREE.BufferAttribute(mNorm, 3));
        if (mUV) geo.setAttribute('uv', new THREE.BufferAttribute(mUV, 2));
        if (mIdx) geo.setIndex(new THREE.BufferAttribute(mIdx, 1));
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        this._mergedBrickCache[key] = geo;
        return geo;
    }

    // Single 1×1×1 brick mesh, using the loaded bricks GLTF when available so
    // the visual matches the rest of the maze. Falls back to a flat-colored
    // cube while the template is still loading.
    _createUnitBrickMesh() {
        if (this.bricksTemplate && this.bricksTemplate.geometry) {
            const bb = this.bricksTemplate.geometry.boundingBox;
            const native = (bb && (bb.max.y - bb.min.y)) || 2;
            const m = new THREE.Mesh(this.bricksTemplate.geometry, this.bricksTemplate.material);
            m.scale.setScalar(1 / native);
            m.castShadow = true;
            m.receiveShadow = true;
            return m;
        }
        const t = (this.themes && this.themes.desert) || {};
        const mat = (this.materials && this.materials.wall) || new THREE.MeshLambertMaterial({
            color: t.wall || 0x8a6238,
            emissive: t.wallEmissive || 0x140a04,
        });
        const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
        m.castShadow = true;
        m.receiveShadow = true;
        return m;
    }

    removeWallAtGrid(gridX, gridZ) {
        const worldPos = this.getWorldPositionFromGrid(gridX, gridZ);
        // Walls are now stacks of 1×1×1 sub-blocks; remove every sub-block
        // whose center sits within the cell (±cellHalf on X/Z, any Y).
        const cellHalf = 1; // 2-unit cells → ±1u from center
        for (let i = this.walls.length - 1; i >= 0; i--) {
            const w = this.walls[i];
            const mesh = w.mesh ? w.mesh : w;
            const pos = w.position ? w.position : mesh.position;
            if (Math.abs(pos.x - worldPos.x) <= cellHalf &&
                Math.abs(pos.z - worldPos.z) <= cellHalf) {
                this.scene.remove(mesh);
                this._removeWallFromHash(w);
                this.walls.splice(i, 1);
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
        this.wallHash = new Map();
        
        // Create new maze
        this.createLabyrinth();
        // If this is the labyrinth map and start is known, spawn player there
        const cur = this.savedMazes[this.currentMazeIndex];
        if (cur && (cur.type === 'labyrinth' || cur.type === 'ascii') && this.levelStartWorld) {
            if (this.activeModeId === 'campaign' && this._campaignSpawnAtStart) {
                this._campaignSpawnAtStart();
            } else {
                this.player.position.set(this.levelStartWorld.x, 0, this.levelStartWorld.z);
                if (this.levelEndWorld) {
                    const dx = this.levelEndWorld.x - this.levelStartWorld.x;
                    const dz = this.levelEndWorld.z - this.levelStartWorld.z;
                    this.characterRotation = Math.atan2(dx, dz);
                }
            }
        }
    }
    
    
    closeAllModals() {
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
            settingsModal.style.display = 'none';
        }

        const toolboxModal = document.getElementById('toolbox-modal');
        if (toolboxModal) {
            toolboxModal.style.display = 'none';
        }

        this.modalOpen = false;
        document.body.classList.remove('modal-open');

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
            document.body.classList.remove('modal-open');
            // Re-acquire pointer lock for continuous mouse aim (desktop only).
            if (this.gameMode === 'play' && !this.isPointerLocked && !this.isTouchDevice) {
                setTimeout(() => document.body.requestPointerLock(), 50);
            }
        } else {
            this.closeAllModals();

            modal.style.display = 'block';
            this.modalOpen = true;
            document.body.classList.add('modal-open');
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
            this.updateModalContent();
        }
    }

    updateModalContent() {
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.view === this.viewMode) {
                btn.classList.add('active');
            }
        });

        document.querySelectorAll('.maze-btn').forEach(btn => {
            btn.classList.remove('active');
            if (parseInt(btn.dataset.maze) === this.currentMazeIndex) {
                btn.classList.add('active');
            }
        });

        const mazeDesc = document.getElementById('maze-desc');
        if (mazeDesc) {
            mazeDesc.textContent = this.savedMazes[this.currentMazeIndex].description;
        }
        const diff = document.getElementById('maze-difficulty');
        const diffVal = document.getElementById('maze-difficulty-value');
        if (diff) diff.value = this.mazeDifficulty;
        if (diffVal) diffVal.textContent = String(this.mazeDifficulty);

        document.querySelectorAll('.language-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.language === this.language) {
                btn.classList.add('active');
            }
        });

        document.querySelectorAll('.character-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.character === this.currentCharacterKey);
        });

        this.updateModalText();
    }

    updateModalText() {
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
        
        
        document.querySelectorAll('.view-btn').forEach(btn => {
            const view = btn.dataset.view;
            if (view === 'iso') btn.textContent = 'Isometrisk';
            if (view === 'fpv') btn.textContent = 'Første Person';
        });

        document.querySelectorAll('.mode-btn').forEach(btn => {
            const mode = btn.dataset.mode;
            if (mode === 'play') btn.textContent = this.t('playMode');
            if (mode === 'create') btn.textContent = this.t('createMode');
            if (mode === 'arena') btn.textContent = 'Arena Mode';
        });
    }
    
    
    setupModalListeners() {
        const closeBtn = document.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.toggleSettingsModal();
            });
        }

        const modal = document.getElementById('settings-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.toggleSettingsModal();
                }
            });
        }

        document.addEventListener('keydown', (event) => {
            if (event.code === 'Escape' && this.modalOpen) {
                this.toggleSettingsModal();
            }
        });


        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                this.setViewMode(view);
                this.toggleSettingsModal();
            });
        });

        document.querySelectorAll('.language-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const language = btn.dataset.language;
                this.setLanguage(language);
                this.toggleSettingsModal();
            });
        });

        // Maze buttons are rendered dynamically from savedMazes — wire a
        // single delegated click handler on the container so new buttons
        // pick up the behavior without needing to re-bind on each render.
        const mazeContainer = document.getElementById('maze-buttons');
        if (mazeContainer && !mazeContainer._delegated) {
            mazeContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('.maze-btn');
                if (!btn || !mazeContainer.contains(btn)) return;
                const mazeIndex = parseInt(btn.dataset.maze);
                if (Number.isFinite(mazeIndex)) {
                    this.switchMaze(mazeIndex);
                    this.toggleSettingsModal();
                }
            });
            mazeContainer._delegated = true;
        }
        this.renderMazeButtons();

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


        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                this.setGameMode(mode);
                this.toggleSettingsModal();
            });
        });

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

        for (let y = 0; y < height; y++) {
            maze[y] = [];
            for (let x = 0; x < width; x++) {
                maze[y][x] = '#';
            }
        }

        // Carve from (3,3) — first interior cell that respects 5-wide halls.
        this.carvePath(maze, 3, 3, width, height);

        // Wide entrance/exit gaps
        for (let i = 0; i < 5; i++) {
            if (maze[3 + i]) {
                maze[3 + i][0] = '.';
            }
            if (maze[height-4 + i]) {
                maze[height-4 + i][width-1] = '.';
            }
        }

        return maze;
    }

    carvePath(maze, x, y, width, height) {
        this.carveArea(maze, x, y, 5, 5);

        // 6-unit jumps so wide-hall carving leaves a 3-cell-wide corridor between rooms
        const directions = [
            [0, -6],
            [0, 6],
            [-6, 0],
            [6, 0]
        ];

        for (let i = directions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [directions[i], directions[j]] = [directions[j], directions[i]];
        }

        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;

            if (nx > 2 && nx < width - 3 && ny > 2 && ny < height - 3 && maze[ny][nx] === '#') {
                this.carveArea(maze, x + dx/2, y + dy/2, 3, 3);
                this.carvePath(maze, nx, ny, width, height);
            }
        }
    }

    carveArea(maze, startX, startY, width, height) {
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
            // Generate perfect ASCII maze based on difficulty.
            // cellSize=4 doubles corridor width (and wall thickness) vs the
            // previous tight 2-unit grid. wallHeight stays at 4 so brick
            // count per cell goes 16 → 64. Still cheaper than Wide Halls
            // overall because there are fewer wall cells in the smaller
            // ASCII grid (33×33 at diff 5 vs 100×100).
            maze = this.generateAsciiPerfectMazeByDifficulty(this.mazeDifficulty || 5);
            cellSize = 4;
            wallHeight = 4;
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
            wallHeight = 4;
            const cols = maze[0].length;
            const rows = maze.length;
            startX = -((cols - 1) * cellSize) / 2;
            startZ = -((rows - 1) * cellSize) / 2;
            this.updateGroundAndFog((cols - 1) * cellSize, (rows - 1) * cellSize);
        }
        
        // Create walls based on layout. Both maze types use the same brick
        // decomposition for a consistent visual; ASCII bricks are flagged
        // non-destructible so wall hits no-op there.
        const isAscii = currentMaze.type === 'ascii';
        for (let row = 0; row < maze.length; row++) {
            for (let col = 0; col < maze[row].length; col++) {
                const tile = maze[row][col];
                if (tile === '#') {
                    const isBorder = row === 0 || col === 0 || row === maze.length - 1 || col === maze[row].length - 1;
                    // Only thin interior walls for procedurally generated mazes.
                    if (currentMaze.type === 'generated' && !isBorder) {
                        if (Math.random() > this.wallDensity) continue; // skip most interior walls
                    }
                    // Clean fixed height for ASCII/labyrinth, varied for brick
                    // mazes. Rounded so brick decomposition lines up.
                    let h;
                    if (isAscii || currentMaze.type === 'labyrinth') {
                        h = wallHeight;
                    } else {
                        h = Math.max(1, Math.round(wallHeight * THREE.MathUtils.lerp(0.7, 1.6, Math.random())));
                    }
                    const cx = startX + col * cellSize;
                    const cz = startZ + row * cellSize;
                    this._addDestructibleBlockColumn(cx, 0, cz, cellSize, h, cellSize, { destructible: !isAscii });
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
        // Match generateAsciiPerfectMaze: entrance on west edge col 0, exit on east col cols-1
        let entRow = Math.floor(rows / 2);
        let entCol = 0;
        let exitRow = Math.floor(rows / 2);
        let exitCol = cols - 1;
        for (let r = 1; r < rows - 1; r++) {
            if (maze[r][0] === '.') { entRow = r; entCol = 0; break; }
        }
        for (let r = 1; r < rows - 1; r++) {
            if (maze[r][cols - 1] === '.') { exitRow = r; exitCol = cols - 1; break; }
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
    // --- Play Mode (Diablo-style) helpers ---
    setupPlayMode() {
        if (!document.pointerLockElement) {
            // Lock acquired on first click; hide cursor in the meantime.
            document.body.style.cursor = 'none';
        }
        this.playMode.clickTarget = null;
        this.respawnEnemies();
        this.enemySpawnTimer = 0;
        // Restore the player's placed blocks for this mode/maze. Runs after
        // clearMaze + createLabyrinth so the maze is already in place.
        this._loadBuilds && this._loadBuilds();
    }

    // Attempt to place an enemy at (x, z), then verify with the enemy's
    // ACTUAL post-scale hitRadius (not the fixed broad-phase 0.9 used by
    // isPositionFree). If the spawn position clips a wall, snap back to the
    // owning cell's center and re-check. Returns the enemy or null on fail.
    _tryPlaceEnemy(x, z, cellCenter = null) {
        const m = this.createEnemyAt(x, z);
        const ud = m.userData;
        const r = ud.hitRadius || 0.6;
        const h = ud.collisionHeight || ud.hitHeight || 1.8;
        _scratchV3a.set(x, 0, z);
        if (this.pointHitsWall(_scratchV3a, r, h)) {
            // Step 1: try snapping to the owning cell's center.
            if (cellCenter) {
                _scratchV3a.set(cellCenter.x, 0, cellCenter.z);
                if (!this.pointHitsWall(_scratchV3a, r, h)) {
                    m.position.x = cellCenter.x;
                    m.position.z = cellCenter.z;
                    return m;
                }
            }
            // Step 2: cell center is also blocked (large enemy in narrow
            // corridor). Reject — caller will try another cell.
            return null;
        }
        return m;
    }

    spawnTestEnemies(count = this.enemyCount) {
        if (this.playMode.enemies.length >= this.maxEnemies) {
            return;
        }

        // Prefer placing on open maze cells; falls through to random sampling.
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
            for (let i = openCells.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [openCells[i], openCells[j]] = [openCells[j], openCells[i]];
            }
            let idx = 0;
            const maxToPlace = Math.min(count, this.maxEnemies - this.playMode.enemies.length);
            // Tighter jitter (±25% of cell instead of ±30%) keeps enemies
            // well clear of adjacent wall blocks even for the largest hit
            // radii (~0.9 for demons after global ENEMY_SIZE_MULT).
            const jitterRange = cellSize * 0.5;
            while (placed < maxToPlace && idx < openCells.length) {
                const { r, c } = openCells[idx++];
                const baseX = startX + c * cellSize;
                const baseZ = startZ + r * cellSize;
                const jitterX = (Math.random() - 0.5) * jitterRange;
                const jitterZ = (Math.random() - 0.5) * jitterRange;
                const x = baseX + jitterX;
                const z = baseZ + jitterZ;
                if (!this.isPositionFree(x, z, 0.9)) continue;
                if (this.player.position.distanceTo(new THREE.Vector3(x, 0, z)) <= 5) continue;
                const m = this._tryPlaceEnemy(x, z, { x: baseX, z: baseZ });
                if (!m) continue;
                this.playMode.enemiesGroup.add(m);
                this.playMode.enemies.push(m);
                placed++;
            }
        }
        if (placed < count) {
            const bounds = this.getMazeBounds();
            let attempts = 0;
            const maxToPlace = Math.min(count, this.maxEnemies - this.playMode.enemies.length);
            while (this.playMode.enemies.length < maxToPlace && attempts < maxToPlace * 200) {
                attempts++;
                const x = THREE.MathUtils.lerp(bounds.minX + 2, bounds.maxX - 2, Math.random());
                const z = THREE.MathUtils.lerp(bounds.minZ + 2, bounds.maxZ - 2, Math.random());
                if (!this.isPositionFree(x, z, 0.9)) continue;
                if (this.player.position.distanceTo(new THREE.Vector3(x, 0, z)) <= 5) continue;
                const m = this._tryPlaceEnemy(x, z, null);
                if (!m) continue;
                this.playMode.enemiesGroup.add(m);
                this.playMode.enemies.push(m);
            }
        }
    }

    createEnemyAt(x, z, typeKey = null) {
        // Pick an enemy type. If no template for that type has loaded yet, we
        // still set the metadata + spawn a fallback sphere; respawnEnemies()
        // re-creates the enemy with the real mesh once the GLTF arrives.
        if (!typeKey) {
            const keys = Object.keys(this.enemyTypes || { zombie: null });
            typeKey = keys[Math.floor(Math.random() * keys.length)];
        }
        const cfg = (this.enemyTypes && this.enemyTypes[typeKey]) || { scale: 0.9, hp: [50, 150], speed: [1.2, 2.0], damage: 10, color: 0x6aa84f };
        const bodyColor = cfg.color;
        const m = new THREE.Group();
        m.position.set(x, 0, z);

        const template = this.enemyTemplates && this.enemyTemplates[typeKey];
        if (template && THREE.SkeletonUtils) {
            const clone = THREE.SkeletonUtils.clone(template.scene);
            // Global 10% downscale on top of each type's authored scale —
            // keeps relative proportions (chick still tiny vs giant demon)
            // but pulls everyone in tighter for maze corridor readability.
            const enemyScale = cfg.scale * (this.ENEMY_SIZE_MULT || 0.9);
            clone.scale.set(enemyScale, enemyScale, enemyScale);
            clone.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    // SkeletonUtils.clone shares Material instances across
                    // every enemy of this type — so flashEnemy/_tintEnemy
                    // mutating .color would whiten every other giant on the
                    // map. Clone the material(s) per-instance so each enemy
                    // owns its own. Handles both single-material meshes and
                    // multi-material arrays.
                    if (Array.isArray(child.material)) {
                        child.material = child.material.map(m => m.clone());
                    } else if (child.material) {
                        child.material = child.material.clone();
                    }
                }
            });
            m.add(clone);
            clone.updateMatrixWorld(true);

            const bbox = new THREE.Box3().setFromObject(clone);
            const size = bbox.getSize(new THREE.Vector3());
            m.userData.hitHeight = size.y;
            m.userData.hitRadius = Math.max(size.x, size.z) * 0.5 + 0.1;
            m.userData.collisionHeight = size.y;
            m.userData.hpBarY = size.y + 0.4;

            if (template.animations && template.animations.length) {
                const mixer = new THREE.AnimationMixer(clone);
                const anims = template.animations;
                const pick = (re) => anims.find(c => re.test(c.name));
                const walkClip = pick(/walk|run/i) || pick(/move/i) || anims[0];
                const idleClip = pick(/^idle$/i) || pick(/idle/i);
                let walkAction = null;
                let idleAction = null;
                if (walkClip) {
                    walkAction = mixer.clipAction(walkClip);
                    walkAction.setLoop(THREE.LoopRepeat, Infinity);
                    if (cfg.animScale) walkAction.timeScale = cfg.animScale;
                    walkAction.play();
                }
                if (idleClip && idleClip !== walkClip) {
                    idleAction = mixer.clipAction(idleClip);
                    idleAction.setLoop(THREE.LoopRepeat, Infinity);
                    idleAction.setEffectiveWeight(0);
                    idleAction.play();
                }
                m.userData.mixer = mixer;
                m.userData.walkAction = walkAction;
                m.userData.idleAction = idleAction;
                m.userData.animBlend = 0;
                m.userData.animScaleBase = cfg.animScale || 1;
            }
            m.userData.boneLock = this._cacheEnemyRootBones(clone);
            m.userData.zombieClone = clone; // legacy name kept for back-compat with old callers
        } else {
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

        const [hpMin, hpMax] = cfg.hp;
        const [spdMin, spdMax] = cfg.speed;
        const maxHp = Math.round(THREE.MathUtils.lerp(hpMin, hpMax, Math.random()));
        const aiKind = cfg.ai || 'chase';
        m.userData = Object.assign(m.userData || {}, {
            type: 'enemy',
            enemyKind: typeKey,
            hp: maxHp,
            hpMax: maxHp,
            bodyColor,
            contactDamage: cfg.damage,
            speed: THREE.MathUtils.lerp(spdMin, spdMax, Math.random()),
            dir: new THREE.Vector2(Math.cos(Math.random()*Math.PI*2), Math.sin(Math.random()*Math.PI*2)),
            changeT: 1 + Math.random() * 2,
            stunT: 0,
            knockback: null,
            // Ranged config (demon). null on melee-only / meleeOnly types.
            ranged: cfg.ranged ? Object.assign({}, cfg.ranged) : null,
            rangedTimer: cfg.ranged ? Math.random() * (cfg.ranged.cooldown || 2) : 0,
            // Per-AI behavior config + transient state. Keeps the dispatch in
            // updateEnemies branchless beyond a single switch.
            aiKind,
            aiCfg: cfg,
            aiState: this._initEnemyAIState(aiKind, cfg),
            // Cosmetic hit-stop: when >0, movement is paused this frame (used
            // by the hit-feedback pulse to make impacts read).
            hitStopT: 0,
            // Attack telegraph (melee/contact): when >0, the enemy is leaning
            // in for a hit. Damage is committed when it ticks to 0 IF the
            // player is still in range — gives a real dodge window.
            attackWindupT: 0,
            attackWindupMax: 0,
            attackPending: false,
            // Ranged charge-up (demon): mirror of attackWindup for fireballs.
            rangedWindupT: 0,
            rangedWindupMax: 0,
            rangedPending: false,
            // Used by skittish/hitAndRun behaviors to time their state changes.
            contactCdT: 0,
            // Awareness state — refreshed each frame by _updateAwareness.
            // awareT > 0 means "I know where the player is/was". aimPos is
            // the position to head toward (current player when LOS, else
            // last-seen). When awareT depletes, aimPos clears and the AI
            // falls back to idle wander.
            awareT: 0,
            lastSeenPos: new THREE.Vector2(),
            aimPos: null,
            // Throttle the LOS raycast — it's the most expensive check, so
            // we only run it every few frames per enemy with a small offset
            // so they don't all spike on the same tick.
            losCheckT: Math.random() * 0.15,
        });
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
        bar.visible = false;
        m.add(bar);
        m.userData.hpBar = bar;
        return m;
    }

    // 2D segment vs axis-aligned box (slab method). Returns true if the
    // segment (x1,z1)→(x2,z2) intersects the AABB centered at (cx,cz)
    // with half-extents (hx,hz). Cheap, allocation-free.
    _segmentVsAABB(x1, z1, x2, z2, cx, cz, hx, hz) {
        const dx = x2 - x1, dz = z2 - z1;
        const minX = cx - hx, maxX = cx + hx;
        const minZ = cz - hz, maxZ = cz + hz;
        let tmin = 0, tmax = 1;
        if (Math.abs(dx) < 1e-9) {
            if (x1 < minX || x1 > maxX) return false;
        } else {
            const inv = 1 / dx;
            let t1 = (minX - x1) * inv, t2 = (maxX - x1) * inv;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            if (t1 > tmin) tmin = t1;
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) return false;
        }
        if (Math.abs(dz) < 1e-9) {
            if (z1 < minZ || z1 > maxZ) return false;
        } else {
            const inv = 1 / dz;
            let t1 = (minZ - z1) * inv, t2 = (maxZ - z1) * inv;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            if (t1 > tmin) tmin = t1;
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) return false;
        }
        return true;
    }

    // True if any (solid) wall blocks the line from (x1,z1) to (x2,z2).
    // Uses the existing wall spatial hash via _iterWallsNear for a cheap
    // broad-phase, then segment-vs-AABB for the narrow-phase.
    _segmentHitsWall(x1, z1, x2, z2) {
        const mx = (x1 + x2) * 0.5, mz = (z1 + z2) * 0.5;
        const half = Math.hypot(x2 - x1, z2 - z1) * 0.5;
        let blocked = false;
        this._iterWallsNear(mx, mz, half + 1, (w) => {
            if (this._segmentVsAABB(x1, z1, x2, z2, w.position.x, w.position.z, w.size.x / 2, w.size.z / 2)) {
                blocked = true; return false;
            }
        });
        return blocked;
    }

    // Can `e` actually see the player right now? Cheap range gate first,
    // then FOV cone, then a single segment-vs-walls test. Vertical (Y) is
    // ignored — gameplay is XZ-planar so a 2D LOS check is the right model.
    _canEnemySeePlayer(e, ud) {
        const cfg = ud.aiCfg;
        const sight = (cfg && cfg.sightRange) || 14;
        const dx = this.player.position.x - e.position.x;
        const dz = this.player.position.z - e.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > sight * sight) return false;

        // FOV cone — player must be within viewCone degrees of the enemy's
        // facing direction (ud.dir). Default 360 means no cone gate. We use
        // a small "intimate radius" override so brushing right up against an
        // enemy still alerts them even from behind — otherwise a player can
        // dance on their back forever.
        // In maze gameplay (campaign/arena and any non-openworld play), give
        // enemies full 360° vision — the corridors are tight enough that a
        // blind-spot cone made stealth trivial and unfun.
        const inMaze = !(this.openWorld && this.openWorld.active);
        const coneDeg = inMaze ? 360 : ((cfg && cfg.viewCone) || 360);
        const intimate = 1.5; // within this distance, the cone doesn't matter
        if (coneDeg < 360 && d2 > intimate * intimate) {
            const fx = ud.dir ? ud.dir.x : Math.sin(e.rotation.y);
            const fz = ud.dir ? ud.dir.y : Math.cos(e.rotation.y);
            const fLen = Math.hypot(fx, fz);
            if (fLen > 0.01) {
                const d = Math.sqrt(d2);
                const dot = (dx * fx + dz * fz) / (d * fLen);
                // cos(halfCone): if dot is smaller, the player is outside the arc
                const cosHalf = Math.cos((coneDeg * Math.PI / 180) * 0.5);
                if (dot < cosHalf) return false;
            }
        }

        return !this._segmentHitsWall(e.position.x, e.position.z, this.player.position.x, this.player.position.z);
    }

    // Refresh awareness state for one enemy. LOS is the only "alert" trigger
    // for now — getting hit also alerts via the killEnemy/applyEnemyKnockback
    // paths (we set awareT there too).
    _updateAwareness(e, ud, deltaTime) {
        // Throttle LOS raycast to ~7Hz per enemy; cheap range test is fine
        // every frame. losCheckT was seeded random so checks are staggered.
        ud.losCheckT -= deltaTime;
        let canSee;
        if (ud.losCheckT <= 0) {
            canSee = this._canEnemySeePlayer(e, ud);
            ud.losCheckT = 0.14;
            ud._lastSeenLOS = canSee;
        } else {
            // Between checks, fall back to last LOS result. Range gate is
            // still applied so a player who left the radius is ignored.
            const sight = (ud.aiCfg && ud.aiCfg.sightRange) || 14;
            const dx = this.player.position.x - e.position.x;
            const dz = this.player.position.z - e.position.z;
            canSee = !!ud._lastSeenLOS && (dx * dx + dz * dz <= sight * sight);
        }
        if (canSee) {
            ud.awareT = (ud.aiCfg && ud.aiCfg.alertMemory) || 4.0;
            ud.lastSeenPos.set(this.player.position.x, this.player.position.z);
            ud.aimPos = ud.lastSeenPos;
        } else if (ud.awareT > 0) {
            ud.awareT -= deltaTime;
            if (ud.awareT <= 0) {
                ud.aimPos = null;
            }
            // While searching, also drop aim if we've arrived at lastSeen —
            // prevents enemies from oscillating around the player's old spot.
            else if (ud.aimPos) {
                const adx = ud.lastSeenPos.x - e.position.x;
                const adz = ud.lastSeenPos.y - e.position.z;
                if (adx * adx + adz * adz < 1.0) {
                    // Reached last-seen point with no LOS — give up faster.
                    ud.awareT = Math.min(ud.awareT, 0.6);
                }
            }
        }
    }

    _initEnemyAIState(aiKind, cfg) {
        switch (aiKind) {
            case 'chase':
                return {
                    lungeCdT: THREE.MathUtils.lerp(cfg.lunge.cooldown[0], cfg.lunge.cooldown[1], Math.random()),
                    lungeT: 0,
                };
            case 'slam':
                // phase: 'approach' | 'windup' | 'strike' | 'recover'
                return { phase: 'approach', phaseT: 0, struck: false };
            case 'kite':
                return {
                    strafeDir: Math.random() < 0.5 ? 1 : -1,
                    strafeT: THREE.MathUtils.lerp(cfg.kite.strafePeriod[0], cfg.kite.strafePeriod[1], Math.random()),
                };
            case 'hitAndRun':
                return { backoffT: 0, zigzagPhase: Math.random() * Math.PI * 2 };
            case 'skittish':
                return { wanderT: 0.5 + Math.random() * 1.5 };
            default:
                return {};
        }
    }

    // Some Kenney enemy walk clips include horizontal root motion on the
    // hip/body bone — the bone translates forward over the cycle, then
    // snaps back at loop wrap. Combined with our parent-group movement this
    // reads as "two positions at once" or a per-frame teleport. We cache the
    // authored rest XZ of those bones at spawn time and re-clamp after every
    // mixer.update so the mesh stays anchored to the hitbox while preserving
    // bob (Y) and sway/twist (rotation).
    _cacheEnemyRootBones(clone) {
        const lock = [];
        clone.traverse((o) => {
            const n = o.name || '';
            // Match common root/hip bone names across Kenney + Mixamo rigs.
            if (/^(Root|Body|Hips|Pelvis|Spine|Armature|EnemyArmature)$/i.test(n)
                || /mixamorig:?Hips/i.test(n)) {
                lock.push({ node: o, x: o.position.x, z: o.position.z });
            }
        });
        return lock.length ? lock : null;
    }

    _lockEnemyRootMotion(ud) {
        if (!ud.boneLock) return;
        for (let i = 0; i < ud.boneLock.length; i++) {
            const b = ud.boneLock[i];
            b.node.position.x = b.x;
            b.node.position.z = b.z;
            // Y is intentionally left free → preserves walk-cycle bob.
        }
    }

    _updateEnemyAnimation(e, ud, deltaTime, moved) {
        if (!ud.mixer) return;
        ud.mixer.update(deltaTime);
        this._lockEnemyRootMotion(ud);

        // Smooth a 0..1 "is walking" signal so brief wall-blocks don't cause
        // per-frame snap between idle and walk poses.
        const target = moved ? 1 : 0;
        ud.animBlend = THREE.MathUtils.lerp(ud.animBlend || 0, target, Math.min(1, deltaTime * 6));

        if (ud.walkAction && ud.idleAction) {
            ud.walkAction.setEffectiveWeight(ud.animBlend);
            ud.idleAction.setEffectiveWeight(1 - ud.animBlend);
            // Both actions tick at their natural speed — weight does the work.
            ud.walkAction.timeScale = (ud.animScaleBase || 1)
                * THREE.MathUtils.clamp((ud.speed || 1.5) / 1.5, 0.55, 1.75);
        } else if (ud.walkAction) {
            // No idle clip available — keep the walk cycle running at all
            // times. Walking in place looks fine for these chunky enemies
            // and is much less jarring than snapping timeScale to ~0 between
            // frames whenever movement briefly stalls (wall scrape, overlap
            // resolve, etc.).
            ud.walkAction.timeScale = (ud.animScaleBase || 1)
                * THREE.MathUtils.lerp(0.35, THREE.MathUtils.clamp((ud.speed || 1.5) / 1.5, 0.55, 1.75), ud.animBlend);
        }
    }

    _bounceEnemyDir(ud) {
        if (ud.wallBounceT > 0) return;
        ud.dir.x *= -1;
        ud.dir.y *= -1;
        ud.wallBounceT = 0.2;
        ud.changeT = Math.min(ud.changeT || 0.3, 0.25);
    }

    // Render interpolation was previously here. It was meant to smooth 60 Hz
    // physics to high-refresh displays, but any other code path that wrote
    // enemy positions between snap-to and restore (knockback decay applied in
    // multiple ticks, spawn-during-step, etc.) caused two-frame teleports —
    // which presented as a per-frame flicker in maze gameplay. Restoring the
    // simpler "render whatever the 60 Hz step produced" path. If high-refresh
    // smoothing matters later, re-add as a single render hook that ALWAYS
    // restores even on error, and gate it behind a flag.
    _enemyInterpSnapFrom() { /* no-op */ }
    _enemyInterpSnapTo() { /* no-op */ }
    _applyEnemyRenderInterp() { /* no-op */ }
    _restoreEnemyRenderInterp() { /* no-op */ }

    // Try to move `e` by (vx, vz) over dt, respecting walls. Returns true if
    // any part of the move succeeded; on wall block, callers may bounce/reroute.
    _moveEnemyBy(e, vx, vz, dt) {
        const ud = e.userData;
        const r = ud.hitRadius || 0.6;
        const h = ud.collisionHeight || 1.8;
        const stepDist = Math.hypot(vx, vz) * dt;
        const steps = Math.min(4, Math.max(1, Math.ceil(stepDist / Math.max(0.12, r * 0.4))));
        const subDt = dt / steps;
        let moved = false;
        for (let s = 0; s < steps; s++) {
            const nextX = e.position.x + vx * subDt;
            const nextZ = e.position.z + vz * subDt;
            _scratchV3a.set(nextX, e.position.y, nextZ);
            if (!this.pointHitsWall(_scratchV3a, r, h)) {
                e.position.x = nextX;
                e.position.z = nextZ;
                moved = true;
                continue;
            }
            // Slide along one axis so enemies don't tunnel on corners.
            _scratchV3a.set(nextX, e.position.y, e.position.z);
            if (!this.pointHitsWall(_scratchV3a, r, h)) {
                e.position.x = nextX;
                moved = true;
                continue;
            }
            _scratchV3a.set(e.position.x, e.position.y, nextZ);
            if (!this.pointHitsWall(_scratchV3a, r, h)) {
                e.position.z = nextZ;
                moved = true;
            }
        }
        return moved;
    }

    _tryNudgeEnemy(e, dx, dz) {
        const ud = e.userData;
        const r = ud.hitRadius || 0.6;
        const h = ud.collisionHeight || 1.8;
        const nx = e.position.x + dx;
        const nz = e.position.z + dz;
        _scratchV3a.set(nx, e.position.y, nz);
        if (!this.pointHitsWall(_scratchV3a, r, h)) {
            e.position.x = nx;
            e.position.z = nz;
            return true;
        }
        return false;
    }

    // Unit vector from enemy to player, with distance. Reads/writes to ud.
    _playerVec(e) {
        const dx = this.player.position.x - e.position.x;
        const dz = this.player.position.z - e.position.z;
        const d = Math.hypot(dx, dz) || 1;
        return { dx, dz, d, ux: dx / d, uz: dz / d };
    }

    // Unit vector from enemy toward its current aim (player when seen, else
    // last-seen position). Returns null when the enemy has no aim — the AI
    // should fall back to idle wander in that case.
    _aimVec(e, ud) {
        const aim = ud.aimPos;
        if (!aim) return null;
        const dx = aim.x - e.position.x;
        const dz = aim.y - e.position.z;
        const d = Math.hypot(dx, dz) || 1;
        return { dx, dz, d, ux: dx / d, uz: dz / d };
    }

    // Idle wander: pick a fresh random heading every so often, drift slowly.
    // Used by every AI kind when ud.aimPos is null (no awareness).
    _idleWander(e, ud, deltaTime) {
        ud.changeT -= deltaTime;
        if (ud.changeT <= 0) {
            const ang = Math.random() * Math.PI * 2;
            ud.dir.set(Math.cos(ang), Math.sin(ang));
            ud.changeT = 1.5 + Math.random() * 2.5;
        }
        const ok = this._moveEnemyBy(e, ud.dir.x * ud.speed * 0.45, ud.dir.y * ud.speed * 0.45, deltaTime);
        if (!ok) this._bounceEnemyDir(ud);
    }

    _aiChase(e, ud, deltaTime) {
        const v = this._aimVec(e, ud);
        if (!v) { this._idleWander(e, ud, deltaTime); return; }
        const s = ud.aiState;
        const cfg = ud.aiCfg;
        // Trigger a lunge: short burst toward aim at multiplied speed.
        if (s.lungeT > 0) {
            s.lungeT -= deltaTime;
            if (s.lungeT <= 0) {
                // Squash ease-out — without this the scale stays at (1.15,0.92,1)
                // forever after the first lunge.
                e.scale.set(1, 1, 1);
            }
        } else {
            s.lungeCdT -= deltaTime;
            if (s.lungeCdT <= 0) {
                if (v.d < 12) {
                    s.lungeT = cfg.lunge.dur;
                    ud.dir.set(v.ux, v.uz);
                    // Squash forward to telegraph
                    e.scale.set(1.15, 0.92, 1);
                }
                s.lungeCdT = THREE.MathUtils.lerp(cfg.lunge.cooldown[0], cfg.lunge.cooldown[1], Math.random());
            }
        }
        // Re-pick wander every 1-3s when not lunging
        ud.changeT -= deltaTime;
        if (s.lungeT <= 0 && ud.changeT <= 0) {
            const ang = Math.random() * Math.PI * 2;
            const sx = v.ux * 0.6 + Math.cos(ang) * 0.4;
            const sz = v.uz * 0.6 + Math.sin(ang) * 0.4;
            const slen = Math.hypot(sx, sz) || 1;
            ud.dir.set(sx / slen, sz / slen);
            ud.changeT = 1 + Math.random() * 1.5;
        }
        const speedMult = s.lungeT > 0 ? cfg.lunge.mult : 1;
        const ok = this._moveEnemyBy(e, ud.dir.x * ud.speed * speedMult, ud.dir.y * ud.speed * speedMult, deltaTime);
        if (!ok) this._bounceEnemyDir(ud);
    }

    _aiSlam(e, ud, deltaTime) {
        const s = ud.aiState;
        const cfg = ud.aiCfg;
        s.phaseT += deltaTime;
        if (s.phase === 'approach') {
            // No awareness → wander; abort approach.
            const av = this._aimVec(e, ud);
            if (!av) { this._idleWander(e, ud, deltaTime); return; }
            ud.dir.set(av.ux, av.uz);
            this._moveEnemyBy(e, ud.dir.x * ud.speed, ud.dir.y * ud.speed, deltaTime);
            // Only commit to windup if we have *real* LOS — don't slam empty air.
            const seesNow = this._canEnemySeePlayer(e, ud);
            const playerD = this._playerVec(e).d;
            if (seesNow && playerD <= cfg.slamRange) {
                s.phase = 'windup'; s.phaseT = 0; s.struck = false;
                // Visual telegraph: tint red on the giant via flash
                this._tintEnemy(e, 0xff5544, cfg.windup * 1000);
                this.audio && this.audio.play && this.audio.play('enemyGrowl');
            }
            return;
        }
        // Windup/strike/recover use the live player position (committed).
        const v = this._playerVec(e);
        if (s.phase === 'windup') {
            // Stop, rear back: rotate body backward + scale up slightly
            const p = Math.min(1, s.phaseT / cfg.windup);
            e.rotation.x = -0.35 * p;
            e.scale.set(1 + 0.1 * p, 1 + 0.15 * p, 1 + 0.1 * p);
            if (s.phaseT >= cfg.windup) { s.phase = 'strike'; s.phaseT = 0; }
        } else if (s.phase === 'strike') {
            // Fast lunge forward. Damage if we hit during strike.
            this._moveEnemyBy(e, v.ux * ud.speed * 5, v.uz * ud.speed * 5, deltaTime);
            if (!s.struck && v.d < (ud.hitRadius || 0.8) + 1.5) {
                this.damagePlayer(cfg.slamDamage);
                s.struck = true;
                // Camera shake if available
                this._cameraShake && this._cameraShake(0.5, 0.25);
            }
            if (s.phaseT >= cfg.strikeDur) { s.phase = 'recover'; s.phaseT = 0; }
        } else if (s.phase === 'recover') {
            e.rotation.x = THREE.MathUtils.lerp(e.rotation.x, 0, 0.2);
            e.scale.lerp(_scratchV3c.set(1, 1, 1), 0.2);
            if (s.phaseT >= cfg.recover) { s.phase = 'approach'; s.phaseT = 0; e.rotation.x = 0; e.scale.set(1,1,1); }
        }
    }

    _aiKite(e, ud, deltaTime) {
        // No awareness → wander; demons don't kite an empty room.
        const v = this._aimVec(e, ud);
        if (!v) { this._idleWander(e, ud, deltaTime); return; }
        const s = ud.aiState;
        const cfg = ud.aiCfg.kite;
        s.strafeT -= deltaTime;
        if (s.strafeT <= 0) {
            s.strafeDir = -s.strafeDir;
            s.strafeT = THREE.MathUtils.lerp(cfg.strafePeriod[0], cfg.strafePeriod[1], Math.random());
        }
        // Radial component: retreat if too close, approach if too far, hold if in sweet spot
        let radial = 0;
        if (v.d < cfg.retreat) radial = -1;
        else if (v.d > cfg.approach) radial = 1;
        else radial = (cfg.ideal - v.d) * 0.2; // gentle drift to ideal
        // Perpendicular (strafe) component
        const px = -v.uz * s.strafeDir;
        const pz = v.ux * s.strafeDir;
        const vx = v.ux * radial + px;
        const vz = v.uz * radial + pz;
        const len = Math.hypot(vx, vz) || 1;
        ud.dir.set(vx / len, vz / len);
        const ok = this._moveEnemyBy(e, (vx / len) * ud.speed, (vz / len) * ud.speed, deltaTime);
        if (!ok) { s.strafeDir = -s.strafeDir; s.strafeT = 0.2; }
    }

    _aiHitAndRun(e, ud, deltaTime) {
        const s = ud.aiState;
        const cfg = ud.aiCfg;
        // Backoff phase: always uses live player position even if LOS is
        // broken (we just hit them; we know where they were).
        if (s.backoffT > 0) {
            const pv = this._playerVec(e);
            s.backoffT -= deltaTime;
            ud.dir.set(-pv.ux, -pv.uz);
            this._moveEnemyBy(e, -pv.ux * ud.speed * cfg.backoffMult, -pv.uz * ud.speed * cfg.backoffMult, deltaTime);
            return;
        }
        const v = this._aimVec(e, ud);
        if (!v) { this._idleWander(e, ud, deltaTime); return; }
        // Zigzag chase: oscillate perpendicular component
        s.zigzagPhase += deltaTime / cfg.zigzagPeriod * Math.PI;
        const zig = Math.sin(s.zigzagPhase) * cfg.zigzagAmp;
        const vx = v.ux + (-v.uz) * zig;
        const vz = v.uz + (v.ux) * zig;
        const len = Math.hypot(vx, vz) || 1;
        ud.dir.set(vx / len, vz / len);
        const ok = this._moveEnemyBy(e, (vx / len) * ud.speed, (vz / len) * ud.speed, deltaTime);
        if (!ok) { s.zigzagPhase += Math.PI; }
    }

    _aiSkittish(e, ud, deltaTime) {
        const cfg = ud.aiCfg;
        // Only flee if we actually see (or recently saw) the player AND
        // they're within fleeDist — being aware *of an empty corridor*
        // doesn't trigger panic.
        const v = ud.awareT > 0 ? this._playerVec(e) : null;
        if (v && v.d < cfg.fleeDist) {
            // Run away from player (with a touch of randomness)
            const jitter = (Math.random() - 0.5) * 0.4;
            const fx = -v.ux + (-v.uz) * jitter;
            const fz = -v.uz + (v.ux) * jitter;
            const len = Math.hypot(fx, fz) || 1;
            ud.dir.set(fx / len, fz / len);
            const ok = this._moveEnemyBy(e, (fx / len) * ud.speed * 1.2, (fz / len) * ud.speed * 1.2, deltaTime);
            if (!ok) this._bounceEnemyDir(ud);
            return;
        }
        // Calm idle wander
        const s = ud.aiState;
        s.wanderT -= deltaTime;
        if (s.wanderT <= 0) {
            const ang = Math.random() * Math.PI * 2;
            ud.dir.set(Math.cos(ang), Math.sin(ang));
            s.wanderT = 1.0 + Math.random() * 2.0;
        }
        const ok = this._moveEnemyBy(e, ud.dir.x * ud.speed * 0.5, ud.dir.y * ud.speed * 0.5, deltaTime);
        if (!ok) { this._bounceEnemyDir(ud); s.wanderT = 0.4; }
    }

    // Brief solid-color tint that auto-reverts. Used for slam wind-up etc.
    // Same overlap protection as flashEnemy — stash the true base color on
    // the material, gate revert behind a counter so the latest tint wins.
    _tintEnemy(e, color, durMs) {
        const mats = [];
        e.traverse((c) => {
            if (c.isMesh && c.material && c.material.color) {
                const mat = c.material;
                if (mat.userData._baseColor == null) mat.userData._baseColor = mat.color.getHex();
                mat.color.setHex(color);
                mats.push(mat);
            }
        });
        if (e.userData._tintId == null) e.userData._tintId = 0;
        const myId = ++e.userData._tintId;
        setTimeout(() => {
            if (e.userData._tintId !== myId) return;
            for (const mat of mats) {
                if (mat.userData._baseColor != null) mat.color.setHex(mat.userData._baseColor);
            }
        }, durMs);
    }

    updateEnemies(deltaTime) {
        if (this.playMode.enemies.length === 0) return;
        for (let i = this.playMode.enemies.length - 1; i >= 0; i--) {
            const e = this.playMode.enemies[i];
            const ud = e.userData;
            const posX0 = e.position.x;
            const posZ0 = e.position.z;
            // Tick contact damage cooldown so goblins can read "i hit them" once per encounter.
            if (ud.contactCdT > 0) ud.contactCdT -= deltaTime;
            if (ud.wallBounceT > 0) ud.wallBounceT -= deltaTime;
            // Attack telegraph. Has three phases driven by a single timer:
            //   phase 0..0.75 of windup → REAR BACK (rotate up + grow). Enemy
            //                              is locked in place so it reads as
            //                              "stopped to wind up".
            //   phase 0.75..1.0        → STRIKE (rotate forward + pop forward)
            //   timer hits 0           → COMMIT damage if still in hit range.
            // Damage NOT dealt if the player stepped out during the wind-up.
            if (ud.attackWindupT > 0) {
                ud.attackWindupT -= deltaTime;
                const p = 1 - Math.max(0, ud.attackWindupT) / (ud.attackWindupMax || 0.001);
                if (p < 0.75) {
                    // REAR BACK
                    const t = p / 0.75; // 0..1
                    const ease = t * t * (3 - 2 * t); // smoothstep
                    e.rotation.x = -0.55 * ease;
                    const grow = 1 + 0.25 * ease;
                    e.scale.set(grow, grow, grow);
                } else {
                    // STRIKE — fast snap forward
                    const t = (p - 0.75) / 0.25;
                    e.rotation.x = THREE.MathUtils.lerp(-0.55, 0.45, t);
                    const grow = THREE.MathUtils.lerp(1.25, 1.05, t);
                    e.scale.set(grow, grow * 0.9, grow);
                    // Lunge forward a little so the strike has visible impact.
                    if (ud.attackPending && ud.dir) {
                        const lunge = ud.speed * 0.5 * deltaTime;
                        this._tryNudgeEnemy(e, ud.dir.x * lunge, ud.dir.y * lunge);
                    }
                }
                if (ud.attackWindupT <= 0 && ud.attackPending) {
                    ud.attackPending = false;
                    e.rotation.x = 0;
                    e.scale.set(1, 1, 1);
                    const dx = this.player.position.x - e.position.x;
                    const dz = this.player.position.z - e.position.z;
                    const dist = Math.hypot(dx, dz);
                    const hitR = (ud.hitRadius || 0.6) + 0.9;
                    if (dist < hitR) {
                        this.damagePlayer(ud.contactDamage || 10);
                        if (ud.aiKind === 'hitAndRun' && ud.aiState) {
                            ud.aiState.backoffT = ud.aiCfg.backoffDur;
                        }
                    }
                    ud.contactCdT = 0.6;
                }
            }
            // Refresh awareness (LOS → awareT, lastSeenPos, aimPos) BEFORE
            // dispatch so each AI sees a consistent view of the world.
            this._updateAwareness(e, ud, deltaTime);
            // Hit-stop pauses movement briefly for impact readability.
            // Attack wind-up also locks the enemy in place so the rear-back
            // pose is visible — without this, they walk straight through the
            // pose and the player can't react.
            if (ud.hitStopT > 0) {
                ud.hitStopT -= deltaTime;
            } else if (ud.stunT > 0) {
                ud.stunT -= deltaTime;
            } else if (ud.attackWindupT > 0) {
                // intentionally no AI tick — enemy is committed to the strike
            } else {
                switch (ud.aiKind) {
                    case 'slam':      this._aiSlam(e, ud, deltaTime); break;
                    case 'kite':      this._aiKite(e, ud, deltaTime); break;
                    case 'hitAndRun': this._aiHitAndRun(e, ud, deltaTime); break;
                    case 'skittish':  this._aiSkittish(e, ud, deltaTime); break;
                    case 'chase':
                    default:          this._aiChase(e, ud, deltaTime); break;
                }
            }
            // Knockback decays even while stun is active (so the body slides to rest)
            if (ud.knockback) {
                this._moveEnemyBy(e, ud.knockback.x, ud.knockback.y, deltaTime);
                ud.knockback.multiplyScalar(Math.pow(0.001, deltaTime));
                if (ud.knockback.lengthSq() < 0.05) ud.knockback = null;
            }
            if (ud.dir && (ud.dir.x !== 0 || ud.dir.y !== 0)) {
                e.rotation.y = Math.atan2(ud.dir.x, ud.dir.y);
            }
            // Hit flinch: lean back + squish, decays to neutral. Stronger
            // numbers than before so hits read clearly — combined with the
            // 130ms white/emissive flash and the new floating dmg number.
            if (ud.flinchT > 0) {
                ud.flinchT -= deltaTime;
                const p = Math.max(0, ud.flinchT) / ud.flinchMax;
                e.rotation.x = -0.7 * p;
                e.scale.y = 1 - 0.22 * p;
                e.scale.x = 1 + 0.16 * p;
                e.scale.z = 1 + 0.05 * p;
                if (ud.flinchT <= 0) {
                    e.rotation.x = 0;
                    e.scale.set(1, 1, 1);
                }
            }
            // Ranged enemies (demon): cast on a per-enemy cooldown, but with
            // a visible charge-up so the fireball doesn't materialize out of
            // nowhere. The tint pulses brighter as the cast progresses, then
            // the projectile fires when rangedWindupT hits 0.
            if (ud.ranged && ud.stunT <= 0 && ud.awareT > 0) {
                if (ud.rangedWindupT > 0) {
                    ud.rangedWindupT -= deltaTime;
                    // Pulse intensity ramps up over the cast.
                    const p = 1 - Math.max(0, ud.rangedWindupT) / (ud.rangedWindupMax || 0.001);
                    if (Math.random() < deltaTime * 12) {
                        // Re-tint occasionally so the glow flickers like a charging spell.
                        this._tintEnemy(e, 0xff7733, 120);
                    }
                    if (ud.rangedWindupT <= 0 && ud.rangedPending) {
                        ud.rangedPending = false;
                        // Confirm aim is still valid before committing.
                        const dx = this.player.position.x - e.position.x;
                        const dz = this.player.position.z - e.position.z;
                        const distXZ = Math.hypot(dx, dz);
                        if (distXZ <= ud.ranged.range && distXZ > 0.1 &&
                            !this._segmentHitsWall(e.position.x, e.position.z, this.player.position.x, this.player.position.z)) {
                            this.spawnEnemyProjectile(e, this.player.position);
                        }
                        ud.rangedTimer = ud.ranged.cooldown;
                    }
                } else {
                    ud.rangedTimer -= deltaTime;
                    if (ud.rangedTimer <= 0) {
                        const dx = this.player.position.x - e.position.x;
                        const dz = this.player.position.z - e.position.z;
                        const distXZ = Math.hypot(dx, dz);
                        // Need clear LOS to actually shoot — don't lob fireballs
                        // through stone walls based on a half-second-old memory.
                        if (distXZ <= ud.ranged.range && distXZ > 0.1 &&
                            !this._segmentHitsWall(e.position.x, e.position.z, this.player.position.x, this.player.position.z)) {
                            // Start charge-up instead of firing immediately.
                            const castTime = 0.55;
                            ud.rangedWindupT = castTime;
                            ud.rangedWindupMax = castTime;
                            ud.rangedPending = true;
                            this._tintEnemy(e, 0xff6622, castTime * 1000);
                            this.audio && this.audio.play && this.audio.play('enemyGrowl');
                        } else {
                            // Try again soon instead of waiting the full cooldown.
                            ud.rangedTimer = 0.4;
                        }
                    }
                }
            }
            const moved = Math.hypot(e.position.x - posX0, e.position.z - posZ0) > 0.0005;
            this._updateEnemyAnimation(e, ud, deltaTime, moved);
            // Update health bar visibility and display
            if (ud.hpBar) {
                if (ud.hpBar.userData.showTimer > 0) {
                    ud.hpBar.userData.showTimer -= deltaTime;
                    if (ud.hpBar.userData.showTimer <= 0) {
                        ud.hpBar.visible = false;
                    }
                }

                if (ud.hpBar.visible) {
                    const cam = this.camera.position;
                    ud.hpBar.lookAt(cam.x, ud.hpBar.position.y + e.position.y, cam.z);
                    const ratio = Math.max(0, Math.min(1, ud.hp / ud.hpMax));
                    ud.hpBar.userData.front.scale.x = ratio;
                    ud.hpBar.userData.front.position.x = -(ud.hpBar.userData.width * (1 - ratio)) / 2;
                }
            }
        }
        // Enemy ↔ enemy soft separation only — player collision is handled in
        // checkEnemyCollision so enemies are not shoved by the player.
        this._resolveEnemyOverlaps();
    }

    _resolveEnemyOverlaps() {
        const list = this.playMode.enemies;
        const n = list.length;
        if (n < 2) return;
        // Enemy ↔ enemy: split overlap, weighted by mass; never nudge into walls.
        for (let i = 0; i < n; i++) {
            const a = list[i];
            const ar = (a.userData.hitRadius || 0.6);
            const am = Math.max(0.5, (a.userData.hpMax || 50) / 80);
            for (let j = i + 1; j < n; j++) {
                const b = list[j];
                const br = (b.userData.hitRadius || 0.6);
                const r = ar + br;
                const dx = b.position.x - a.position.x;
                const dz = b.position.z - a.position.z;
                const d2 = dx * dx + dz * dz;
                if (d2 < r * r && d2 > 0.0001) {
                    const d = Math.sqrt(d2);
                    const overlap = r - d;
                    const bm = Math.max(0.5, (b.userData.hpMax || 50) / 80);
                    const total = am + bm;
                    const ux = dx / d, uz = dz / d;
                    const sep = 0.55;
                    const aPush = overlap * (bm / total) * sep;
                    const bPush = overlap * (am / total) * sep;
                    this._tryNudgeEnemy(a, -ux * aPush, -uz * aPush);
                    this._tryNudgeEnemy(b, ux * bPush, uz * bPush);
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
        this.player.invulnerabilityTimer = 1.0;
        this.audio && this.audio.play('playerHurt');
        this._damageVignetteT = 0.45;

        this.showMessage(`${this.t('playerHit')} - ${this.t('health')}: ${this.player.hp}/${this.player.maxHp}`);

        // Brief red flash on every material in the player model
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
            if (this.arena && this.arena.active) {
                // Arena run failed — restart from wave 1
                this.startArenaMode();
            } else {
                this.player.position.set(0, 1, 0);
                this.player.hp = this.player.maxHp;
            }
        }
    }

    // ===== Audio-driven feel helpers =====
    updatePlayerLocomotion(deltaTime) {
        if (!this.player || !this.player.model) return;
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
            const restLx = this.player._legRestX.L;
            const restRx = this.player._legRestX.R;
            if (this.player.leftLeg) this.player.leftLeg.rotation.x = restLx + swing;
            if (this.player.rightLeg) this.player.rightLeg.rotation.x = restRx - swing;
            // Skip arm counter-swing while attacking so the swing anim wins
            if (!this._attackPoseT) {
                const restLz = this.player._armRestZ.L;
                const restRz = this.player._armRestZ.R;
                if (this.player.leftArm) this.player.leftArm.rotation.x = -swing * 0.5;
                if (this.player.rightArm) this.player.rightArm.rotation.x = swing * 0.5;
                if (this.player.leftArm) this.player.leftArm.rotation.z = restLz;
                if (this.player.rightArm) this.player.rightArm.rotation.z = restRz;
            }
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

    pointHitsWall(pos, radius = 0.6, height = 2) {
        let hit = false;
        const entityBottom = pos.y;
        const entityTop = pos.y + height;
        this._iterWallsNear(pos.x, pos.z, radius + 1, (w) => {
            const p = w.position; const s = w.size;
            if (pos.x + radius > p.x - s.x/2 && pos.x - radius < p.x + s.x/2 &&
                pos.z + radius > p.z - s.z/2 && pos.z - radius < p.z + s.z/2) {
                const wallTop = p.y + s.y/2;
                const wallBottom = p.y - s.y/2;
                if (entityTop > wallBottom && entityBottom < wallTop) {
                    hit = true; return false;
                }
            }
        });
        return hit;
    }

    getMazeBounds() {
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
        // Fallback to ground plane size
        return { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
    }

    isPositionFree(x, z, radius = 0.8) {
        let free = true;
        this._iterWallsNear(x, z, radius + 1, (wall) => {
            const wp = wall.position; const ws = wall.size;
            if (x + radius > wp.x - ws.x/2 && x - radius < wp.x + ws.x/2 &&
                z + radius > wp.z - ws.z/2 && z - radius < wp.z + ws.z/2) {
                free = false; return false;
            }
        });
        return free;
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
        // Drop any in-flight enemy fireballs/etc — otherwise demon shots
        // outlive the demons that fired them across resets.
        if (this.playMode.enemyProjectiles && this.playMode.enemyProjectiles.length) {
            this.playMode.enemyProjectiles.forEach(p => this.scene.remove(p));
            this.playMode.enemyProjectiles = [];
        }
    }

    respawnEnemies() {
        this.clearEnemies();
        this.spawnTestEnemies(this.enemyCount);
    }
    
    updateEnemySpawning(deltaTime) {
        if (this.gameMode !== 'play') return;
        // Arena mode owns its own spawn cadence
        if (this.arena && this.arena.active) return;

        this.enemySpawnTimer += deltaTime;

        if (this.enemySpawnTimer >= this.enemySpawnInterval) {
            this.enemySpawnTimer = 0;

            const spawnCount = 1 + Math.floor(Math.random() * 3);
            this.spawnTestEnemies(spawnCount);

            if (Math.random() < 0.3) {
                this.showMessage(`${this.t('enemiesApproaching')} (${this.playMode.enemies.length}/${this.maxEnemies})`);
            }
        }
    }

    handlePlayClick(event) {
        // Block placement takes precedence over weapon use when armed.
        if (this.activeBlockId) {
            this.placeActiveBlock();
            return;
        }
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
        const activeFpv = this._getActiveFpvRanged && this._getActiveFpvRanged();
        if (this.viewMode === 'fpv' && activeFpv && activeFpv.userData.muzzle) {
            spawn = new THREE.Vector3();
            activeFpv.userData.muzzle.getWorldPosition(spawn);
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
        // Cooldown gate — handlePlayClick bypasses attackWithWeapon for melee,
        // so we have to enforce the cooldown here ourselves (otherwise mashing
        // left-click fires every frame).
        if (!this.canFire()) return;
        const weapon = this.getCurrentWeapon();
        const weaponId = this.player.weapons[this.player.currentWeaponIndex];
        if (weapon) this.weaponCooldowns[weaponId] = weapon.cooldown;

        this.triggerSwordSwing();
        this.playOneShotAnimation('Attack', 0.4);
        this.triggerAttackPose && this.triggerAttackPose();
        this.audio && this.audio.play('swordSwing');

        const damage = weapon ? weapon.damage : 2;
        const range = (weapon && weapon.type === 'melee') ? weapon.range : 2.5;

        // Third-person: arc check around the player (camera ray is wrong here, see performAttack).
        if (this.viewMode !== 'fpv') {
            this._performMeleeArc({ damage, range, hitColor: 0xffaa55, missColor: 0xcccccc });
            return;
        }

        // FPV: ray from screen center.
        _scratchV2a.set(0, 0);
        _sharedRaycaster.setFromCamera(_scratchV2a, this.camera);
        const hits = _sharedRaycaster.intersectObjects(this.playMode.enemies, true);
        for (const hit of hits) {
            if (hit.distance > range) break;
            const e = this.findEnemyRoot(hit.object);
            if (!e) continue;
            e.userData.hp -= damage;
            this.spawnImpact(hit.point.clone(), 0xffaa55);
            this.spawnDamageNumber(hit.point, damage);
            this.audio && this.audio.play('swordHit');
            if (e.userData.hp <= 0) {
                this.killEnemy(e);
            } else {
                this.applyEnemyKnockback(e, this.camera.position, 6);
                this.flashEnemy(e);
                this.showEnemyHPBar(e, 3.0);
            }
            return;
        }
        const endPoint = this.camera.position.clone().add(_sharedRaycaster.ray.direction.clone().multiplyScalar(range));
        this.spawnImpact(endPoint, 0xcccccc);
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
            // Solid ceiling — chip the roof tile at this XZ; despawn the shot
            // if the tile is still alive (otherwise the shot passes through
            // the hole the previous hits opened).
            if (this.roofY != null && nextPos.y + p.userData.radius >= this.roofY) {
                const tile = this._roofTileAt(nextPos.x, nextPos.z);
                if (tile) {
                    this._damageRoofTile(tile, 1);
                    this.scene.remove(p);
                    this.playMode.projectiles.splice(i, 1);
                    continue;
                }
                // No tile here (off-grid or already destroyed): let it fly.
            }
            let collidedWall = null;
            const _pr = p.userData.radius;
            this._iterWallsNear(nextPos.x, nextPos.z, _pr + 1.5, (w) => {
                const wp = w.position; const s = w.size;
                if (nextPos.x + _pr > wp.x - s.x/2 && nextPos.x - _pr < wp.x + s.x/2 &&
                    nextPos.y + _pr > wp.y - s.y/2 && nextPos.y - _pr < wp.y + s.y/2 &&
                    nextPos.z + _pr > wp.z - s.z/2 && nextPos.z - _pr < wp.z + s.z/2) {
                    collidedWall = w;
                    return false; // short-circuit
                }
            });
            if (collidedWall) {
                this.spawnImpact(nextPos);
                // Destructible maze bricks take damage; bullets are consumed on hit.
                if (collidedWall.destructible) {
                    this._damageWall(collidedWall, 1);
                    this.scene.remove(p);
                    this.playMode.projectiles.splice(i, 1);
                    continue;
                }

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
                    this.spawnDamageNumber(p.position, dmg);
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

    // ----- Enemy-fired projectiles (e.g. demon fireballs) -----
    spawnEnemyProjectile(enemy, targetPos) {
        const cfg = enemy.userData.ranged;
        if (!cfg) return;
        const origin = enemy.position.clone();
        origin.y += (enemy.userData.hitHeight || 1.5) * 0.6;
        const dir = new THREE.Vector3(
            targetPos.x - origin.x,
            (targetPos.y + 1.0) - origin.y,
            targetPos.z - origin.z
        );
        if (dir.lengthSq() < 0.001) return;
        dir.normalize();

        const color = cfg.color || 0xff5522;
        const group = new THREE.Group();
        const core = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 12, 12),
            new THREE.MeshBasicMaterial({ color })
        );
        const halo = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 12, 12),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        group.add(core); group.add(halo);
        group.add(new THREE.PointLight(color, 0.6, 4, 2));
        group.position.copy(origin);
        group.userData = {
            dir, speed: cfg.projectileSpeed || 18, ttl: 4,
            radius: 0.22, damage: cfg.damage || 8, color
        };
        this.scene.add(group);
        this.playMode.enemyProjectiles.push(group);
        this.audio && this.audio.play && this.audio.play('shoot');
    }

    updateEnemyProjectiles(deltaTime) {
        const list = this.playMode.enemyProjectiles;
        if (!list || list.length === 0) return;
        const playerHitR = 0.7;
        for (let i = list.length - 1; i >= 0; i--) {
            const p = list[i];
            const d = p.userData;
            const step = d.dir.clone().multiplyScalar(d.speed * deltaTime);
            const next = p.position.clone().add(step);

            // Solid ceiling — chip the roof tile, or pass through if it's
            // already been broken open.
            if (this.roofY != null && next.y + d.radius >= this.roofY) {
                const tile = this._roofTileAt(next.x, next.z);
                if (tile) {
                    this._damageRoofTile(tile, 1);
                    this.scene.remove(p);
                    list.splice(i, 1);
                    continue;
                }
            }
            // Wall collision — despawn with a small impact ping.
            let hitWall = false;
            const _dr = d.radius;
            this._iterWallsNear(next.x, next.z, _dr + 1.5, (w) => {
                const wp = w.position; const s = w.size;
                if (next.x + _dr > wp.x - s.x/2 && next.x - _dr < wp.x + s.x/2 &&
                    next.y + _dr > wp.y - s.y/2 && next.y - _dr < wp.y + s.y/2 &&
                    next.z + _dr > wp.z - s.z/2 && next.z - _dr < wp.z + s.z/2) {
                    hitWall = true; return false;
                }
            });
            if (hitWall) {
                this.spawnImpact(next, d.color);
                this.scene.remove(p);
                list.splice(i, 1);
                continue;
            }

            p.position.copy(next);
            d.ttl -= deltaTime;

            // Player collision (cylinder around player).
            const dx = p.position.x - this.player.position.x;
            const dz = p.position.z - this.player.position.z;
            const dy = p.position.y - this.player.position.y;
            if (dx*dx + dz*dz < (playerHitR + d.radius) * (playerHitR + d.radius) && dy >= -0.1 && dy <= 2.2) {
                this.spawnImpact(p.position.clone(), d.color);
                this.damagePlayer(d.damage);
                this.scene.remove(p);
                list.splice(i, 1);
                continue;
            }

            if (d.ttl <= 0) {
                this.scene.remove(p);
                list.splice(i, 1);
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
        // Skip the standard random drop for the boss — wave-complete drops are
        // handled separately. Bigger enemies drop more loot; chicks/chickens
        // drop almost nothing.
        if (!isBoss) {
            const kind = (e.userData && e.userData.enemyKind) || 'zombie';
            const dropCounts = { demon: 2, goblin: 1, zombie: 1, chick: 0, chicken: 0 };
            const dropProb   = { demon: 0.9, goblin: this.dropChance, zombie: this.dropChance, chick: 0.25, chicken: 0.3 };
            const count = dropCounts[kind] != null ? dropCounts[kind] : 1;
            const prob  = dropProb[kind]   != null ? dropProb[kind]   : this.dropChance;
            for (let i = 0; i < count; i++) {
                if (Math.random() < prob) {
                    // Spread multi-drops in a small ring so they don't stack on one spot.
                    const ang = (count > 1) ? (Math.PI * 2 * i / count) + Math.random() * 0.4 : 0;
                    const r = (count > 1) ? 0.6 + Math.random() * 0.5 : 0;
                    this.spawnPickup(deathPos.x + Math.cos(ang) * r, deathPos.z + Math.sin(ang) * r);
                }
            }
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
            case 'speed': {
                const grp = new THREE.Group();
                const boltMat = new THREE.MeshLambertMaterial({
                    color: 0x66ddff, emissive: 0x224466, emissiveIntensity: 1.2
                });
                const bolt = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), boltMat);
                bolt.rotation.z = Math.PI / 4;
                const ring = new THREE.Mesh(
                    new THREE.TorusGeometry(0.42, 0.06, 8, 16),
                    new THREE.MeshBasicMaterial({
                        color: 0xaae8ff, transparent: true, opacity: 0.7,
                        blending: THREE.AdditiveBlending, depthWrite: false
                    })
                );
                ring.rotation.x = Math.PI / 2;
                grp.add(ring);
                grp.add(bolt);
                grp.material = boltMat;
                grp.geometry = bolt.geometry;
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
                if (p.userData.weaponId) {
                    if (this.grantWeapon && this.grantWeapon(p.userData.weaponId)) {
                        this.spawnImpact(p.position.clone(), 0x66ffcc);
                        this.audio && this.audio.play('pickupPowerup');
                    }
                    continue;
                }
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

    // ===== Crates & Keys (campaign maze loot) =====
    //
    // Crates sit at maze dead-ends, locked. Each maze has N matching keys
    // scattered in regular corridors. Picking up a key bumps inventory.keys;
    // walking up to a crate consumes one and pops the lid (swap closed→open),
    // then drops the crate's loot table as normal pickups around the crate.
    // Crates also have a small ring of guardian enemies that the spawner
    // places adjacent to them.

    _findMazeDeadEnds(maze) {
        const rows = maze.length;
        const cols = maze[0].length;
        const ends = [];
        for (let r = 1; r < rows - 1; r++) {
            for (let c = 1; c < cols - 1; c++) {
                if (maze[r][c] !== '.') continue;
                let open = 0;
                if (maze[r - 1][c] === '.') open++;
                if (maze[r + 1][c] === '.') open++;
                if (maze[r][c - 1] === '.') open++;
                if (maze[r][c + 1] === '.') open++;
                if (open === 1) ends.push({ r, c });
            }
        }
        return ends;
    }

    // Pick a loot bundle for one crate. Always includes a weapon (gun / mg /
    // jetpack) so cracking a crate feels like an upgrade moment, plus a mix
    // of consumables. Returns array of item type strings.
    _rollCrateLoot() {
        const weapons = ['gun', 'machineGun', 'jetpack'];
        const weapon = weapons[Math.floor(Math.random() * weapons.length)];
        const bundle = [weapon];
        // Always include at least one health + ammo so it's never a flop.
        bundle.push('health', 'ammo', 'ammo');
        // Mix-ins
        const mixinPool = ['speed', 'flag', 'flag', 'health', 'ammo'];
        const mixinCount = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < mixinCount; i++) {
            bundle.push(mixinPool[Math.floor(Math.random() * mixinPool.length)]);
        }
        return bundle;
    }

    _createCrateMesh(x, z) {
        const template = (this._decorTemplates && this._decorTemplates.chest) || null;
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        if (template && THREE.SkeletonUtils) {
            const clone = THREE.SkeletonUtils.clone(template);
            // 75% of the original 1.4 baseline.
            clone.scale.setScalar(1.05);
            clone.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
            group.add(clone);
            group.userData._chestClone = clone;
        } else {
            // Fallback box so the system still works pre-template-load.
            const fb = new THREE.Mesh(
                new THREE.BoxGeometry(0.9, 0.75, 0.6),
                new THREE.MeshLambertMaterial({ color: 0x7a4a1c })
            );
            fb.position.y = 0.38;
            fb.castShadow = true;
            group.add(fb);
        }
        // Padlock glow — pulsing ring sits just above the chest so it stays
        // the visible "this is interactive AND locked" cue.
        const lock = new THREE.Mesh(
            new THREE.TorusGeometry(0.22, 0.05, 8, 18),
            new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.9 })
        );
        lock.rotation.x = Math.PI / 2;
        lock.position.y = 0.95;
        group.add(lock);
        const lockLight = new THREE.PointLight(0xffd060, 0.7, 4, 2);
        lockLight.position.y = 0.95;
        group.add(lockLight);
        group.userData.lockBadge = lock;
        group.userData.lockLight = lockLight;
        return group;
    }

    _swapCrateToOpenMesh(crate) {
        const tplOpen = (this._decorTemplates && this._decorTemplates.chestOpen) || null;
        const closed = crate.userData._chestClone;
        if (closed) {
            crate.remove(closed);
            crate.userData._chestClone = null;
        }
        if (tplOpen && THREE.SkeletonUtils) {
            const clone = THREE.SkeletonUtils.clone(tplOpen);
            clone.scale.setScalar(1.05);
            clone.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
            crate.add(clone);
            crate.userData._chestClone = clone;
        }
        // Drop the padlock visual since it's no longer locked.
        if (crate.userData.lockBadge) {
            crate.remove(crate.userData.lockBadge);
            crate.userData.lockBadge = null;
        }
        if (crate.userData.lockLight) {
            crate.remove(crate.userData.lockLight);
            crate.userData.lockLight = null;
        }
    }

    _createKeyMesh(x, z) {
        const template = (this._decorTemplates && this._decorTemplates.key) || null;
        const group = new THREE.Group();
        group.position.set(x, 1.0, z);
        if (template && THREE.SkeletonUtils) {
            const clone = THREE.SkeletonUtils.clone(template);
            // 90% smaller than the original 2.0 baseline; the halo + light
            // do the heavy lifting for spotability.
            clone.scale.setScalar(0.2);
            clone.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
            group.add(clone);
        } else {
            const fb = new THREE.Mesh(
                new THREE.SphereGeometry(0.06, 10, 10),
                new THREE.MeshBasicMaterial({ color: 0xffd060 })
            );
            group.add(fb);
        }
        // Glow halo + point light so the tiny key still pops at distance.
        const halo = new THREE.Mesh(
            new THREE.SphereGeometry(0.35, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        group.add(halo);
        group.add(new THREE.PointLight(0xffd060, 0.7, 5, 2));
        group.userData.t = Math.random() * Math.PI * 2;
        return group;
    }

    placeCampaignMazeContent() {
        if (this.activeModeId !== 'campaign') return;
        const info = this.lastMazeInfo;
        if (!info || !info.maze) return;

        this.clearCratesAndKeys();

        const startCell = this.levelStartCell ? { r: this.levelStartCell.y, c: this.levelStartCell.x } : null;
        const endCell = this.levelEndCell ? { r: this.levelEndCell.y, c: this.levelEndCell.x } : null;
        const isReserved = (r, c) =>
            (startCell && startCell.r === r && startCell.c === c) ||
            (endCell && endCell.r === r && endCell.c === c);

        const deadEnds = this._findMazeDeadEnds(info.maze).filter(p => !isReserved(p.r, p.c));
        if (deadEnds.length === 0) return;

        for (let i = deadEnds.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deadEnds[i], deadEnds[j]] = [deadEnds[j], deadEnds[i]];
        }

        // 2-4 crates per level, scaled by maze size.
        const target = Math.min(deadEnds.length, 2 + Math.floor(Math.random() * 3));
        const crateCells = deadEnds.slice(0, target);

        for (const cell of crateCells) {
            const x = info.startX + cell.c * info.cellSize;
            const z = info.startZ + cell.r * info.cellSize;
            const group = this._createCrateMesh(x, z);
            group.userData = Object.assign(group.userData || {}, {
                type: 'crate',
                locked: true,
                opened: false,
                loot: this._rollCrateLoot(),
                cell,
                t: Math.random() * Math.PI * 2,
                spawnPos: { x, z }
            });
            this.playMode.cratesGroup.add(group);
            this.playMode.crates.push(group);
            // Spawn 1-2 guardian enemies in the corridor leading to the crate.
            this._spawnCrateGuardians(cell, info);
        }

        // Place keys equal to crate count, away from the dead-ends so the
        // player has to actually hunt for them.
        this._placeCampaignKeys(crateCells.length, info, crateCells);

        // DEBUG: drop a free key + crate next to the player spawn so the loop
        // can be exercised in seconds. Toggled by DEBUG_SPAWN_LOOT_NEAR_PLAYER.
        if (this.DEBUG_SPAWN_LOOT_NEAR_PLAYER) {
            this._spawnDebugLootNearPlayer();
        }
    }

    _spawnDebugLootNearPlayer() {
        if (!this.player) return;
        const px = this.player.position.x;
        const pz = this.player.position.z;
        // Forward = direction the player faces (toward the maze entry).
        const dir = this.levelEntryDir || { x: 1, z: 0 };
        const flen = Math.hypot(dir.x, dir.z) || 1;
        const fx = dir.x / flen;
        const fz = dir.z / flen;
        // Right-hand perpendicular (so key goes left, crate goes right).
        const rx = -fz;
        const rz = fx;

        // Key on the player's left, ~2.5u away.
        const kx = px - rx * 2.5 + fx * 1.0;
        const kz = pz - rz * 2.5 + fz * 1.0;
        const key = this._createKeyMesh(kx, kz);
        key.userData = Object.assign(key.userData || {}, {
            type: 'key',
            spawnPos: { x: kx, z: kz },
            _debugSpawn: true
        });
        this.playMode.keysGroup.add(key);
        this.playMode.keys.push(key);

        // Crate on the player's right, ~2.5u away.
        const cx = px + rx * 2.5 + fx * 1.0;
        const cz = pz + rz * 2.5 + fz * 1.0;
        const crate = this._createCrateMesh(cx, cz);
        crate.userData = Object.assign(crate.userData || {}, {
            type: 'crate',
            locked: true,
            opened: false,
            loot: this._rollCrateLoot(),
            cell: null,
            t: Math.random() * Math.PI * 2,
            spawnPos: { x: cx, z: cz },
            _debugSpawn: true
        });
        this.playMode.cratesGroup.add(crate);
        this.playMode.crates.push(crate);

        this.showMessage && this.showMessage('Debug: free key (left) + crate (right) placed at spawn');
    }

    _spawnCrateGuardians(cell, info) {
        const maze = info.maze;
        const candidates = [];
        const tryCell = (r, c) => {
            if (r < 0 || r >= maze.length || c < 0 || c >= maze[0].length) return;
            if (maze[r][c] === '.') candidates.push({ r, c });
        };
        // Walk outward up to 3 steps from the dead-end to find spawnable cells.
        for (let dr = -3; dr <= 3; dr++) {
            for (let dc = -3; dc <= 3; dc++) {
                if (dr === 0 && dc === 0) continue;
                if (Math.abs(dr) + Math.abs(dc) > 3) continue;
                tryCell(cell.r + dr, cell.c + dc);
            }
        }
        const count = 1 + Math.floor(Math.random() * 2);
        for (let i = 0; i < count && candidates.length; i++) {
            const idx = Math.floor(Math.random() * candidates.length);
            const { r, c } = candidates.splice(idx, 1)[0];
            const x = info.startX + c * info.cellSize;
            const z = info.startZ + r * info.cellSize;
            if (this.player.position.distanceTo(new THREE.Vector3(x, 0, z)) < 6) continue;
            const m = this._tryPlaceEnemy(x, z, { x, z });
            if (!m) continue;
            m.userData._isGuardian = true;
            this.playMode.enemiesGroup.add(m);
            this.playMode.enemies.push(m);
        }
    }

    _placeCampaignKeys(count, info, crateCells) {
        const maze = info.maze;
        const startCell = this.levelStartCell ? { r: this.levelStartCell.y, c: this.levelStartCell.x } : null;
        const endCell = this.levelEndCell ? { r: this.levelEndCell.y, c: this.levelEndCell.x } : null;
        const open = [];
        for (let r = 0; r < maze.length; r++) {
            for (let c = 0; c < maze[0].length; c++) {
                if (maze[r][c] !== '.') continue;
                // Avoid crate cells themselves.
                let onCrate = false;
                for (const cc of crateCells) {
                    if (cc.r === r && cc.c === c) { onCrate = true; break; }
                }
                if (onCrate) continue;
                if (startCell && startCell.r === r && startCell.c === c) continue;
                if (endCell && endCell.r === r && endCell.c === c) continue;
                open.push({ r, c });
            }
        }
        for (let i = open.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [open[i], open[j]] = [open[j], open[i]];
        }
        let placed = 0;
        for (const cell of open) {
            if (placed >= count) break;
            const x = info.startX + cell.c * info.cellSize;
            const z = info.startZ + cell.r * info.cellSize;
            // Don't drop keys right under the player's spawn either.
            if (this.player.position.distanceTo(new THREE.Vector3(x, 0, z)) < 6) continue;
            const key = this._createKeyMesh(x, z);
            key.userData = Object.assign(key.userData || {}, {
                type: 'key',
                spawnPos: { x, z }
            });
            this.playMode.keysGroup.add(key);
            this.playMode.keys.push(key);
            placed++;
        }
    }

    clearCratesAndKeys() {
        if (this.playMode.crates) {
            for (const c of this.playMode.crates) this.playMode.cratesGroup.remove(c);
            this.playMode.crates = [];
        }
        if (this.playMode.keys) {
            for (const k of this.playMode.keys) this.playMode.keysGroup.remove(k);
            this.playMode.keys = [];
        }
        this.inventory.keys = 0;
        this._focusedCrate = null;
        const badge = document.getElementById('key-badge');
        if (badge) badge.style.display = 'none';
        const prompt = document.getElementById('crate-prompt');
        if (prompt) prompt.style.display = 'none';
    }

    _updateKeyBadgeUI() {
        let badge = document.getElementById('key-badge');
        const count = this.inventory.keys || 0;
        const crateCount = (this.playMode.crates || []).filter(c => !c.userData.opened).length;
        const shouldShow = this.gameMode === 'play' && (count > 0 || crateCount > 0);
        if (!shouldShow) {
            if (badge) badge.style.display = 'none';
            return;
        }
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'key-badge';
            badge.style.position = 'absolute';
            badge.style.top = '76px';
            badge.style.right = '16px';
            badge.style.display = 'flex';
            badge.style.alignItems = 'center';
            badge.style.gap = '6px';
            badge.style.padding = '6px 12px';
            badge.style.background = 'linear-gradient(135deg, rgba(60,40,10,0.85), rgba(20,12,2,0.85))';
            badge.style.border = '2px solid #ffd060';
            badge.style.borderRadius = '999px';
            badge.style.color = '#ffe8a0';
            badge.style.fontFamily = 'Courier New, monospace';
            badge.style.fontSize = '14px';
            badge.style.fontWeight = '700';
            badge.style.letterSpacing = '0.5px';
            badge.style.boxShadow = '0 4px 14px rgba(255,208,96,0.35)';
            badge.style.zIndex = '950';
            badge.style.userSelect = 'none';
            badge.style.pointerEvents = 'none';
            document.body.appendChild(badge);
        }
        badge.style.display = 'flex';
        badge.innerHTML = `<span style="font-size:18px;">🗝️</span><span>${count} / ${crateCount} crate${crateCount === 1 ? '' : 's'}</span>`;
    }

    updateCratesAndKeys(deltaTime) {
        if (this.gameMode !== 'play') return;

        // Keys: bob/rotate + auto-pickup on proximity. Radius is generous so
        // you don't have to walk directly over the (tiny) key mesh.
        if (this.playMode.keys && this.playMode.keys.length) {
            const pickupR2 = 2.5 * 2.5;
            for (let i = this.playMode.keys.length - 1; i >= 0; i--) {
                const k = this.playMode.keys[i];
                k.userData.t += deltaTime;
                k.rotation.y += deltaTime * 1.5;
                k.position.y = 1.0 + Math.sin(k.userData.t * 3) * 0.12;
                const d2 = k.position.distanceToSquared(this.player.position);
                if (d2 < pickupR2) {
                    this.inventory.keys = (this.inventory.keys || 0) + 1;
                    this.playMode.keysGroup.remove(k);
                    this.playMode.keys.splice(i, 1);
                    this.audio && this.audio.play && this.audio.play('pickupPowerup');
                    this.spawnImpact && this.spawnImpact(k.position.clone(), 0xffe080);
                    this.showToast && this.showToast(`Picked up a key (${this.inventory.keys})`, 'success');
                    this.showMessage && this.showMessage('Key collected — find a crate!');
                    this._qbSig = null;
                    this.updateInventoryGridUI && this.updateInventoryGridUI();
                }
            }
        }

        this._updateKeyBadgeUI();

        // Crates: lock badge pulse + focus the nearest crate within reach so
        // the player can press Enter to use a key. Auto-open is intentionally
        // gone — the prompt replaces it.
        let focused = null;
        let focusedD2 = Infinity;
        if (this.playMode.crates && this.playMode.crates.length) {
            const focusR2 = 3.6 * 3.6; // generous "you're standing in front of it" radius
            for (const crate of this.playMode.crates) {
                crate.userData.t += deltaTime;
                if (crate.userData.lockBadge) {
                    const s = 1 + Math.sin(crate.userData.t * 3) * 0.12;
                    crate.userData.lockBadge.scale.set(s, s, s);
                    crate.rotation.y = Math.sin(crate.userData.t * 0.8) * 0.12;
                }
                if (crate.userData.opened) continue;
                const d2 = crate.position.distanceToSquared(this.player.position);
                if (d2 > focusR2) continue;
                if (d2 < focusedD2) {
                    focused = crate;
                    focusedD2 = d2;
                }
            }
        }
        this._focusedCrate = focused;
        this._updateCratePromptUI(focused);
    }

    // Center-screen prompt for crate interaction. Builds the element lazily
    // so we don't have to touch index.html, and reflects three states:
    //   1. focused + key in hand → "Press [Enter] to open (N keys)"
    //   2. focused + no key      → "Locked — find a key"
    //   3. nothing focused       → hidden
    _updateCratePromptUI(crate) {
        let prompt = document.getElementById('crate-prompt');
        if (!crate) {
            if (prompt) prompt.style.display = 'none';
            return;
        }
        if (!prompt) {
            prompt = document.createElement('div');
            prompt.id = 'crate-prompt';
            prompt.style.position = 'absolute';
            prompt.style.top = '50%';
            prompt.style.left = '50%';
            prompt.style.transform = 'translate(-50%, calc(-50% + 90px))';
            prompt.style.padding = '12px 22px';
            prompt.style.background = 'linear-gradient(135deg, rgba(20,12,2,0.92), rgba(60,40,10,0.92))';
            prompt.style.border = '2px solid #ffd060';
            prompt.style.borderRadius = '14px';
            prompt.style.color = '#ffe8a0';
            prompt.style.fontFamily = 'Courier New, monospace';
            prompt.style.fontSize = '16px';
            prompt.style.fontWeight = '700';
            prompt.style.letterSpacing = '0.5px';
            prompt.style.textAlign = 'center';
            prompt.style.lineHeight = '1.35';
            prompt.style.boxShadow = '0 6px 22px rgba(255,208,96,0.4)';
            prompt.style.zIndex = '960';
            prompt.style.userSelect = 'none';
            prompt.style.pointerEvents = 'none';
            document.body.appendChild(prompt);
        }
        const keys = this.inventory.keys || 0;
        const canOpen = keys > 0;
        prompt.style.display = 'block';
        // Pulse via opacity tied to the crate's own bob — keeps every prompt
        // feeling alive without needing a separate animation loop.
        const pulse = 0.92 + Math.sin((crate.userData.t || 0) * 4) * 0.08;
        prompt.style.opacity = String(pulse);
        if (canOpen) {
            prompt.style.borderColor = '#ffd060';
            prompt.innerHTML = `
                <div style="font-size:22px;">🗝️ <span style="color:#fff;">Press <span style="color:#ffd060;">[Enter]</span> to unlock crate</span></div>
                <div style="font-size:12px;opacity:0.85;margin-top:4px;">${keys} key${keys === 1 ? '' : 's'} in inventory</div>
            `;
        } else {
            prompt.style.borderColor = '#ff6677';
            prompt.innerHTML = `
                <div style="font-size:22px;color:#ffb0b8;">🔒 Locked</div>
                <div style="font-size:12px;opacity:0.85;margin-top:4px;color:#ffd0d4;">Find a key to open this crate</div>
            `;
        }
    }

    // Triggered by the Enter key. Opens the focused crate if the player has
    // a key; otherwise plays a soft "denied" feedback so the press feels
    // acknowledged.
    tryUseFocusedCrate() {
        const crate = this._focusedCrate;
        if (!crate || crate.userData.opened) return false;
        if ((this.inventory.keys || 0) <= 0) {
            this.audio && this.audio.play && this.audio.play('uiClick');
            this.showMessage && this.showMessage('No keys — find one in the maze');
            return false;
        }
        this._openCrate(crate);
        this._focusedCrate = null;
        this._updateCratePromptUI(null);
        return true;
    }

    _openCrate(crate) {
        if (crate.userData.opened) return;
        crate.userData.locked = false;
        crate.userData.opened = true;
        this.inventory.keys = Math.max(0, (this.inventory.keys || 0) - 1);
        this._swapCrateToOpenMesh(crate);
        this.audio && this.audio.play && this.audio.play('pickupPowerup');
        this.showToast && this.showToast('Crate unlocked!', 'success');
        this.spawnImpact && this.spawnImpact(crate.position.clone(), 0xffe080);

        // Drop loot in a small ring around the crate so the player can see
        // each item discretely instead of one stacked mess.
        const loot = crate.userData.loot || [];
        const count = loot.length;
        for (let i = 0; i < count; i++) {
            const ang = (i / count) * Math.PI * 2 + Math.random() * 0.3;
            const r = 1.2 + Math.random() * 0.4;
            const x = crate.position.x + Math.cos(ang) * r;
            const z = crate.position.z + Math.sin(ang) * r;
            // Hand-place a single pickup of the loot type without rolling
            // through the random spawnPickup table.
            this._spawnPickupOfType(loot[i], x, z);
        }
        this._qbSig = null;
        this.updateInventoryGridUI && this.updateInventoryGridUI();
    }

    // Force-spawn a pickup of a specific type at (x, z). Used by crates so we
    // can deliver an explicit loot table instead of weighted-random.
    _spawnPickupOfType(type, x, z) {
        const isWeapon = type === 'gun' || type === 'machineGun' || type === 'jetpack';
        const group = new THREE.Group();
        group.position.set(x, 0.6, z);
        let mesh;
        if (isWeapon) {
            // Simple shimmer cube for weapon pickups; grantWeapon handles real logic.
            const color = type === 'gun' ? 0x88ccff
                        : type === 'machineGun' ? 0xff8866
                        : 0xa8e8ff;
            mesh = new THREE.Mesh(
                new THREE.BoxGeometry(0.7, 0.4, 0.4),
                new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 })
            );
            group.userData.weaponId = type;
        } else {
            const def = (this.ITEM_DEFS || {})[type];
            const color = (def && def.color) || 0xffffff;
            mesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.32, 12, 12),
                new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.3 })
            );
            group.userData.item = { type };
        }
        mesh.castShadow = true;
        group.add(mesh);
        const halo = new THREE.Mesh(
            new THREE.SphereGeometry(0.6, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        group.add(halo);
        group.userData.t = 0;
        this.pickupsGroup.add(group);
        this.pickups.push(group);
    }

    // ===== Jetpack System =====
    createJetpackParticles() {
        if (!this.isJetpackActive || this.jetpackThrust < 0.1) return;

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

            particle.position.set(
                this.player.position.x + (Math.random() - 0.5) * 2,
                this.player.position.y - 1,
                this.player.position.z + (Math.random() - 0.5) * 2
            );

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

            particle.position.add(userData.velocity.clone().multiplyScalar(deltaTime));

            userData.life -= deltaTime * 2;
            particle.material.opacity = userData.life;


            if (userData.life <= 0) {
                this.scene.remove(particle);
                this.jetpackParticles.splice(i, 1);
            }
        }
    }
    
    // ===== Item Activation =====
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
        if (itemId !== 'speed') {
            this.showMessage(this.itemLabel(itemId));
            this.showToast(this.pickupToast(itemId), 'success');
        }

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
            this._updateFlagPromptUI(false);
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

        this._updateFlagPromptUI(withinRange);
    }

    // Center-screen "Press [G] to remove flag" prompt. Mirrors the crate
    // prompt's lifecycle: lazy-built, shown only when the player is within
    // `flagRemoveRadiusSq` of a placed flag, hidden otherwise.
    _updateFlagPromptUI(visible) {
        let prompt = document.getElementById('flag-prompt');
        if (!visible) {
            if (prompt) prompt.style.display = 'none';
            return;
        }
        if (!prompt) {
            prompt = document.createElement('div');
            prompt.id = 'flag-prompt';
            prompt.style.cssText =
                'position:absolute;top:50%;left:50%;transform:translate(-50%, calc(-50% + 130px));' +
                'padding:10px 18px;background:linear-gradient(135deg, rgba(40,8,20,0.92), rgba(90,30,60,0.92));' +
                'border:2px solid #ff66aa;border-radius:14px;color:#ffd6e8;' +
                'font:700 15px "Courier New", monospace;letter-spacing:0.5px;text-align:center;' +
                'line-height:1.35;box-shadow:0 6px 18px rgba(255,102,170,0.35);z-index:960;' +
                'user-select:none;pointer-events:none;';
            document.body.appendChild(prompt);
            prompt.innerHTML = '🏳️ <span style="color:#fff;">Press <span style="color:#ff66aa;">[G]</span> to remove flag</span>';
        }
        prompt.style.display = 'block';
        // Soft pulse so it reads as live UI, not stuck text.
        prompt.style.opacity = String(0.88 + Math.sin(performance.now() / 220) * 0.1);
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
        directionalLight.castShadow = false;
        this.scene.add(directionalLight);
        this.directionalLight = directionalLight;
    }
    
    shouldBlockInput(event) {
        if (this.isDrawerOpen) {
            const allowedKeys = ['KeyM', 'Escape', 'Tab', 'Enter', 'ArrowUp', 'ArrowDown', 'KeyV', 'KeyG'];
            return !allowedKeys.includes(event.code);
        }

        if (this.modalOpen) {
            const allowedKeys = ['Escape', 'KeyP', 'KeyV', 'KeyG'];
            return !allowedKeys.includes(event.code);
        }

        if (this.gameMode === 'create' && this.toolboxModalOpen) {
            const allowedKeys = ['Escape', 'KeyT', 'KeyV', 'KeyG'];
            return !allowedKeys.includes(event.code);
        }

        // Quickbar number keys only fire in play mode
        if (event.code >= 'Digit1' && event.code <= 'Digit9') {
            if (this.gameMode !== 'play') {
                return true;
            }
        }

        if (this.gameMode !== 'play') {
            const allowedKeys = [
                'KeyP', 'Escape', 'ArrowLeft', 'ArrowRight', 'Digit1', 'Digit3', // Settings and maze switching
                'KeyT', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'KeyV', 'KeyG' // Create-mode tools & view toggles
            ];
            return !allowedKeys.includes(event.code);
        }

        return false;
    }
    
    setupEventListeners() {
        document.addEventListener('keydown', (event) => {
            this.keys[event.code] = true;

            if (this.shouldBlockInput(event)) {
                return;
            }

            if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
                if (this.gameMode === 'create') {
                    this.createMode.isShiftHeld = true;
                } else {
                    this.player.ducked = true;
                }
            }

            // Arrow keys switch maze
            if (event.code === 'ArrowLeft') {
                this.switchMaze((this.currentMazeIndex - 1 + this.savedMazes.length) % this.savedMazes.length);
            }
            if (event.code === 'ArrowRight') {
                this.switchMaze((this.currentMazeIndex + 1) % this.savedMazes.length);
            }

            if (event.code === 'KeyP') {
                this.toggleSettingsModal();
            }

            if (event.code === 'Escape' && this.isDrawerOpen) {
                this.isDrawerOpen = false;
                this.hideDrawerCursor();
                this.updateDrawerUI();
            }

            if (event.code === 'KeyM') {
                this.toggleMoreDrawer();
            }

            if (event.code === 'KeyT' && this.gameMode === 'create') {
                this.toggleToolboxModal();
            }

            // Q/E: create-mode tools, OR tank turn (scheme 3)
            if (this.gameMode === 'create' && !this.modalOpen) {
                if (event.code === 'KeyQ') {
                    this.setCreateTool('wall');
                }
                if (event.code === 'KeyE') {
                    this.setCreateTool('erase');
                }
            } else if (this.controlScheme === 3) {
                if (event.code === 'KeyE') {
                    this.characterRotation -= Math.PI / 2;
                }
                if (event.code === 'KeyQ') {
                    this.characterRotation += Math.PI / 2;
                }
            }

            // Cmd: cycle camera angle (isometric only)
            if (event.code === 'MetaLeft' || event.code === 'MetaRight') {
                event.preventDefault();
                if (this.viewMode !== 'fpv') {
                    this.cycleCameraAngle();
                }
            }

            // O: toggle isometric orbit (not valid in FPV)
            if (event.code === 'KeyO' && this.gameMode === 'play') {
                if (this.viewMode !== 'fpv') {
                    this.playMode.orbitEnabled = !this.playMode.orbitEnabled;
                    this.playMode.lastMouseX = null;
                }
            }

            // V: swap FPV / iso
            if (event.code === 'KeyV' && !event.repeat) {
                this.setViewMode(this.viewMode === 'fpv' ? 'iso' : 'fpv');
            }

            // Enter: use a key on the crate currently in focus (center-screen
            // prompt indicates when this is valid).
            if (event.code === 'Enter' && !event.repeat && this.gameMode === 'play') {
                if (this._focusedCrate) {
                    event.preventDefault();
                    this.tryUseFocusedCrate();
                }
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

            if (event.code === 'KeyR') {
                this.reloadWeapon();
            }

            // Quickbar slot shortcuts
            if (event.code >= 'Digit1' && event.code <= 'Digit9') {
                const shortcut = event.code.replace('Digit', '');
                this.selectGridItemByShortcut(shortcut);
            }

            // T: reset view / spawn (escape hatch when something goes off-screen)
            if (event.code === 'KeyT') {
                if (document.pointerLockElement) document.exitPointerLock();
                this.setViewMode('iso');
                this.currentCameraAngle = 0;
                this.playMode.mouseNDC.set(0, 0);
                const cur = this.savedMazes[this.currentMazeIndex];
                if (cur && cur.type === 'labyrinth' && this.levelStartWorld) {
                    this.player.position.copy(this.levelStartWorld);
                } else {
                    this.player.position.set(0, 0, 0);
                }
                this.characterRotation = 0;
                this.updateCamera();
            }

            // Y/U: nudge model yaw offset (debug alignment for new character GLTFs)
            if (event.code === 'KeyY') {
                this.modelYawOffset = (this.modelYawOffset + Math.PI / 2) % (Math.PI * 2);
            }
            if (event.code === 'KeyU') {
                this.modelYawOffset = (this.modelYawOffset - Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
            }
        });

        document.addEventListener('keyup', (event) => {
            this.keys[event.code] = false;

            if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
                if (this.gameMode === 'create') {
                    this.createMode.isShiftHeld = false;
                    this.createMode.startLinePos = null;
                } else {
                    this.player.ducked = false;
                }
            }
        });

        // Mouse behavior depends on control scheme + view mode
        document.addEventListener('mousemove', (event) => {
            if (this.isDrawerOpen) {
                return;
            }

            if (this.gameMode === 'create' && !this.modalOpen) {
                this.handleCreateModeHover();
                return;
            } else if (this.gameMode === 'play' && !this.modalOpen) {
                if (this.isGameplayActive && !this.isGameplayActive()) return;
                // Pointer-lock deltas when locked, client coords otherwise.
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
                    if (this.viewMode === 'fpv' && !this.playMode.orbitEnabled) {
                        this.fpvPitch = (this.fpvPitch || 0) - event.movementY * 0.0025;
                        this.characterRotation -= event.movementX * this.fpvYawSensitivity;
                        const limit = Math.PI / 2 - 0.01; // full up/down, tiny epsilon to avoid lookAt flip
                        this.fpvPitch = Math.max(-limit, Math.min(limit, this.fpvPitch));
                    }
                    if (this.playMode.orbitEnabled && this.viewMode !== 'fpv') {
                        this.currentCameraAngle = (this.currentCameraAngle + event.movementX * 0.2) % 360;
                    }
                    if (this.viewMode === 'ghost') {
                        this.ghostCamera.rotation.y -= event.movementX * this.ghostCamera.mouseSensitivity;
                        this.ghostCamera.rotation.x -= event.movementY * this.ghostCamera.mouseSensitivity;

                        this.ghostCamera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.ghostCamera.rotation.x));

                        // Y first then X to avoid roll
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
                    this.characterRotation -= event.movementX * 0.002;
                } else if (this.controlScheme === 2 && this.cameraMode === 'orbit') {
                    // Mouse orbits camera only while Space is held
                    this.orbitMouseX += event.movementX * 0.002;
                    this.orbitMouseY += event.movementY * 0.002;
                    this.orbitMouseY = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.orbitMouseY));
                } else if (this.controlScheme === 4) {
                    this.mouse.x += event.movementX * 0.002;
                    this.mouse.y += event.movementY * 0.002;
                    this.mouse.y = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.mouse.y));

                    this.characterRotation = this.mouse.x;
                }
                // Scheme 3 is tank controls — no mouse contribution.
            }
        });

        document.addEventListener('mousedown', (event) => {
            if (this.isDrawerOpen) {
                return;
            }

            if (this.gameMode === 'create' && !this.modalOpen) {
                this.createMode.isMouseDown = true;
                this.handleCreateModeClick(event);
            } else if (this.gameMode === 'play' && !this.modalOpen) {
                if (this.isGameplayActive && !this.isGameplayActive()) return;
                this.handlePlayClick(event);
                if (event.button === 0 && !this.activeBlockId) {
                    const weapon = this.getCurrentWeapon();
                    if (weapon && weapon.isContinuous) {
                        this.isFiring = true;
                    }
                }
            }
        });

        document.addEventListener('mouseup', (event) => {
            if (this.isDrawerOpen) {
                return;
            }

            if (this.gameMode === 'create' && !this.modalOpen) {
                this.createMode.isMouseDown = false;
                this.createMode.lastGridPos = null;
                this.createMode.startLinePos = null;
            } else if (this.gameMode === 'play' && !this.modalOpen) {
                if (event.button === 0) {
                    this.isFiring = false;
                }
            }
        });

        document.addEventListener('click', (event) => {
            // Drawer is a modal-ish overlay — don't grab pointer-lock or fire.
            if (this.isDrawerOpen) return;
            if (this.gameMode === 'create' && !this.modalOpen) {
                this.handleCreateModeClick(event);
            } else if (this.gameMode === 'play' && !this.modalOpen) {
                if (this.isGameplayActive && !this.isGameplayActive()) return;
                // On touch devices, the on-screen Fire button drives shooting — skip pointer lock entirely.
                if (this.isTouchDevice) return;
                // First click in play mode acquires pointer lock instead of firing.
                if (!this.isPointerLocked) {
                    document.body.requestPointerLock();
                    return;
                }
                this.handlePlayClick(event);
            }
        });

        // Right-click melee
        document.addEventListener('contextmenu', (e) => e.preventDefault());
        document.addEventListener('mousedown', (event) => {
            if (this.isDrawerOpen) return;
            if (this.gameMode === 'play' && !this.modalOpen && event.button === 2) {
                if (this.isGameplayActive && !this.isGameplayActive()) return;
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

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Mouse wheel switches weapon
        document.addEventListener('wheel', (event) => {
            if (this.isDrawerOpen) {
                return;
            }

            if (this.gameMode === 'play' && !this.modalOpen) {
                if (this.isGameplayActive && !this.isGameplayActive()) return;
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
            if (this.isGameplayActive && !this.isGameplayActive()) return;
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
                if (this.isGameplayActive && !this.isGameplayActive()) return;
                this.handlePlayClick(center());
                if (this.activeBlockId) return;
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
                if (this.isGameplayActive && !this.isGameplayActive()) return;
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

    applySpeedBoost(seconds) {
        const add = seconds || this.SPEED_BOOST_PER_PICKUP || 10;
        const cap = this.SPEED_BOOST_MAX_TIMER || 25;
        this.powerUps.speedBoostTimer = Math.min(cap, (this.powerUps.speedBoostTimer || 0) + add);
        this.powerUps._speedBoostBarPeak = this.powerUps.speedBoostTimer;
        const left = Math.ceil(this.powerUps.speedBoostTimer);
        this.showToast(`⚡ ${this.t('speedBoost')} — ${left}s`, 'success');
        this.showMessage(`${this.t('speedBoost')} (${left}s)`);
        this._qbSig = null;
        if (this.updateInventoryGridUI) this.updateInventoryGridUI();
        if (this.updateControlsUI) this.updateControlsUI();
        if (this.isDrawerOpen && this.updateDrawerUI) this.updateDrawerUI();
    }

    getSpeedBoostMultiplier() {
        return (this.powerUps.speedBoostTimer > 0) ? (this.SPEED_BOOST_MOVE_MULT || 1.45) : 1;
    }

    tickSpeedBoost(deltaTime) {
        if (!this.powerUps.speedBoostTimer || this.powerUps.speedBoostTimer <= 0) return;
        const prev = Math.ceil(this.powerUps.speedBoostTimer);
        this.powerUps.speedBoostTimer = Math.max(0, this.powerUps.speedBoostTimer - deltaTime);
        const now = Math.ceil(this.powerUps.speedBoostTimer);
        if (now !== prev) {
            this._qbSig = null;
            if (this.updateInventoryGridUI) this.updateInventoryGridUI();
            if (this.updateControlsUI) this.updateControlsUI();
        }
        if (this.powerUps.speedBoostTimer <= 0) {
            this.powerUps._speedBoostBarPeak = 0;
            this.showMessage('Speed boost ended');
        }
    }

    updatePlayer(deltaTime) {
        if (this.viewMode === 'ghost') {
            this.updateGhostCamera(deltaTime);
            this.updateCamera();
            return;
        }

        if (this.isDrawerOpen) {
            return;
        }

        const speedMultiplier = this.getSpeedBoostMultiplier();
        const speed = 10 * speedMultiplier;
        const jumpForce = 15;
        const gravity = -30;

        const direction = new THREE.Vector3();

        if (this.gameMode === 'play') {
            // WASD is camera-relative; mouse aims character.
            const camForward = new THREE.Vector3();
            this.camera.getWorldDirection(camForward);
            camForward.y = 0; camForward.normalize();
            const up = new THREE.Vector3(0,1,0);
            const camRight = camForward.clone().cross(up).normalize();
            let forwardIn = 0, strafeIn = 0;
            if (this.keys['KeyW']) forwardIn += 1;
            if (this.keys['KeyS']) forwardIn -= 1;
            if (this.keys['KeyD']) strafeIn += 1;
            if (this.keys['KeyA']) strafeIn -= 1;
            if (forwardIn !== 0 || strafeIn !== 0) {
                direction.add(camForward.clone().multiplyScalar(forwardIn));
                direction.add(camRight.clone().multiplyScalar(strafeIn));
            }
            // Iso third-person: body ALWAYS faces the mouse cursor's ground
            // projection. WASD is camera-relative (still computed above) and
            // moves independently of facing — so you can strafe around a
            // target while aiming. Uses scratch raycaster/plane to avoid
            // per-frame allocations.
            if (this.viewMode !== 'fpv') {
                _sharedRaycaster.setFromCamera(this.playMode.mouseNDC, this.camera);
                _scratchPlaneGround.constant = 0; // plane y=0
                let targetRot = null;
                if (_sharedRaycaster.ray.intersectPlane(_scratchPlaneGround, _scratchV3a)) {
                    const aimX = _scratchV3a.x - this.player.position.x;
                    const aimZ = _scratchV3a.z - this.player.position.z;
                    if (aimX * aimX + aimZ * aimZ > 0.0001) {
                        targetRot = Math.atan2(aimX, aimZ);
                    }
                }
                if (targetRot !== null) {
                    const diff = ((targetRot - this.characterRotation + Math.PI) % (Math.PI*2)) - Math.PI;
                    const maxStep = this.playMode.rotateLerp * 1.8 * deltaTime;
                    const step = THREE.MathUtils.clamp(diff, -maxStep, maxStep);
                    this.characterRotation += step;
                }
            }
            if (direction.lengthSq() > 0) direction.normalize();
            const moveSpeed = this.playMode.moveSpeed * speedMultiplier * (this.player.ducked ? 0.45 : 1);
            const desiredVX = direction.x * moveSpeed;
            const desiredVZ = direction.z * moveSpeed;
            const curVX = this.player.velocity.x;
            const curVZ = this.player.velocity.z;
            const accelMult = speedMultiplier > 1 ? 1.25 : 1;
            const accel = (direction.lengthSq() > 0) ? this.playMode.accel * accelMult : this.playMode.decel;
            const approach = (current, target, maxDelta) => {
                if (current < target) return Math.min(current + maxDelta, target);
                if (current > target) return Math.max(current - maxDelta, target);
                return current;
            };
            let newVX = approach(curVX, desiredVX, accel * deltaTime);
            let newVZ = approach(curVZ, desiredVZ, accel * deltaTime);

            // Axis-separated collision so the player slides along walls instead of sticking.
            const pos = this.player.position.clone();

            let testPos = pos.clone();
            testPos.x += newVX * deltaTime;
            if (this.checkCollisionAxis(testPos, 'x')) {
                const slideTest = this.player.position.clone();
                slideTest.x = testPos.x;
                if (!this.checkCollision(slideTest)) {
                    this.player.position.x = testPos.x;
                } else {
                    newVX = 0;
                }
            } else {
                this.player.position.x = testPos.x;
            }

            testPos = this.player.position.clone();
            testPos.z += newVZ * deltaTime;
            if (this.checkCollisionAxis(testPos, 'z')) {
                const slideTest = this.player.position.clone();
                slideTest.z = testPos.z;
                if (!this.checkCollision(slideTest)) {
                    this.player.position.z = testPos.z;
                } else {
                    newVZ = 0;
                }
            } else {
                this.player.position.z = testPos.z;
            }
            this.player.velocity.x = newVX;
            this.player.velocity.z = newVZ;
        } else {
            // Keyboard schemes for non-play or fallback.
            // Scheme 3 (Tank): A/D turn, W/S forward/back, no strafe.
            // Scheme 1 (Mouse Turn): A/D strafe, mouse controls facing.
            const isTank = this.controlScheme === 3;
            const turnSpeed = 2.5;

            if (isTank) {
                const turnLeft = this.keys['KeyA'] ? 1 : 0;
                const turnRight = this.keys['KeyD'] ? 1 : 0;
                this.characterRotation += (turnRight - turnLeft) * turnSpeed * deltaTime;

                if (this.keys['KeyW']) direction.z -= 1;
                if (this.keys['KeyS']) direction.z += 1;
            } else {
                if (this.keys['KeyW']) direction.z -= 1;
                if (this.keys['KeyS']) direction.z += 1;
                if (this.keys['KeyA']) direction.x -= 1;
                if (this.keys['KeyD']) direction.x += 1;
            }
        }

        if (this.gameMode !== 'play') {
            direction.applyEuler(new THREE.Euler(0, this.characterRotation, 0));
        }
        if (this.gameMode !== 'play' && direction.lengthSq() > 0) direction.normalize();

        if (this.gameMode !== 'play') {
            const newVelocityX = direction.x * speed;
            const newVelocityZ = direction.z * speed;

            // Axis-separated collision so the player slides along walls.
            const pos = this.player.position.clone();

            let testPos = pos.clone();
            testPos.x += newVelocityX * deltaTime;
            if (this.checkCollisionAxis(testPos, 'x')) {
                const slideTest = this.player.position.clone();
                slideTest.x = testPos.x;
                if (!this.checkCollision(slideTest)) {
                    this.player.position.x = testPos.x;
                    this.player.velocity.x = newVelocityX;
                } else {
                    this.player.velocity.x = 0;
                }
            } else {
                this.player.position.x = testPos.x;
                this.player.velocity.x = newVelocityX;
            }

            testPos = this.player.position.clone();
            testPos.z += newVelocityZ * deltaTime;
            if (this.checkCollisionAxis(testPos, 'z')) {
                const slideTest = this.player.position.clone();
                slideTest.z = testPos.z;
                if (!this.checkCollision(slideTest)) {
                    this.player.position.z = testPos.z;
                    this.player.velocity.z = newVelocityZ;
                } else {
                    this.player.velocity.z = 0;
                }
            } else {
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
        
        // Vertical only — horizontal was already applied above for play mode.
        this.player.position.y += this.player.velocity.y * deltaTime;

        if (this.player.invulnerable) {
            this.player.invulnerabilityTimer -= deltaTime;
            if (this.player.invulnerabilityTimer <= 0) {
                this.player.invulnerable = false;
            }
        }

        // Enemy attack TELEGRAPH. When an enemy gets within "windup range"
        // (further out than damage range so you see it coming), they stop
        // moving, rear back, glow red, growl — then commit a strike step
        // forward and only damage if you're still inside the smaller hit
        // range. Giants/slam handle their own windup in _aiSlam.
        if (this.gameMode === 'play' && this.playMode.enemies) {
            for (const enemy of this.playMode.enemies) {
                const ud = enemy.userData;
                if (ud.contactCdT > 0) continue;
                if (ud.aiKind === 'slam') continue;
                if (ud.attackWindupT > 0) continue; // already winding up
                if (ud.stunT > 0 || ud.flinchT > 0) continue; // mid-hit reaction

                const distance = this.player.position.distanceTo(enemy.position);
                // Telegraph triggers at a generous range so the rear-back
                // animation is visible BEFORE the enemy is on top of you.
                const windupRange = (ud.hitRadius || 0.6) + 1.7;
                if (distance < windupRange) {
                    const baseWindup = (ud.aiKind === 'hitAndRun') ? 0.45
                                     : (ud.aiKind === 'skittish') ? 0.55
                                     : 0.60;
                    ud.attackWindupT = baseWindup;
                    ud.attackWindupMax = baseWindup;
                    ud.attackPending = true;
                    ud._struck = false;
                    // Snap heading toward the player so the strike step lunges
                    // at them, not into the wall behind.
                    const dx = this.player.position.x - enemy.position.x;
                    const dz = this.player.position.z - enemy.position.z;
                    const dlen = Math.hypot(dx, dz) || 1;
                    if (ud.dir) {
                        ud.dir.set(dx / dlen, dz / dlen);
                        enemy.rotation.y = Math.atan2(ud.dir.x, ud.dir.y);
                    }
                    this._tintEnemy(enemy, 0xff3322, baseWindup * 1000);
                    this.audio && this.audio.play && this.audio.play('enemyGrowl');
                    break;
                }
            }
        }

        this.checkWallCollisionY();

        if (this.player.position.y <= 0) {
            this.player.position.y = 0;
            this.player.velocity.y = 0;
            this.player.onGround = true;
        }

        if (this.player.model) {
            this.player.model.position.copy(this.player.position);
            this.player.model.rotation.y = this.characterRotation + (this.modelYawOffset || 0);
            // Keep the drop-shadow disc glued to ground level instead of riding
            // along with the character (otherwise it floats up during jumps).
            if (this.player.bodyShadow) {
                const altitude = Math.max(0, this.player.position.y);
                this.player.bodyShadow.position.y = 0.02 - this.player.position.y;
                const shrink = Math.max(0.35, 1 - altitude * 0.12);
                this.player.bodyShadow.scale.setScalar(shrink);
                this.player.bodyShadow.material.opacity = 0.45 * shrink;
            }
        }

        // Iso wall fade: walls between camera and player become translucent
        // so the body stays visible behind cover. Hidden in FPV.
        this._updateWallFade();

        this.updateCharacterAnimation(deltaTime);

        this.updateDirectionIndicators();

        this.updateCamera();
    }


    cycleCameraAngle() {
        // 4 fixed quadrants: 0°, 90°, 180°, 270°.
        this.currentCameraAngle = (this.currentCameraAngle + 90) % 360;
    }

    updateDirectionIndicators() {
        const facingElement = document.getElementById('facing-direction');
        const cameraElement = document.getElementById('camera-angle');

        if (facingElement && cameraElement) {
            const facingDegrees = (this.characterRotation * 180 / Math.PI) % 360;
            const facingDirection = this.getDirectionName(facingDegrees);

            facingElement.textContent = `Facing: ${facingDirection} (${Math.round(facingDegrees)}°)`;
            cameraElement.textContent = `Camera: ${this.currentCameraAngle}°`;
        }
    }

    getDirectionName(degrees) {
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
                const curDx = cur.x - e.position.x;
                const curDz = cur.z - e.position.z;
                if (d2 < curDx * curDx + curDz * curDz) return true;
            }
        }
        return false;
    }

    // Locked crates block movement just like walls; opened ones don't. Uses
    // a slightly tighter radius so the player can comfortably stand right
    // next to a crate without overlap weirdness.
    checkCrateCollision(position) {
        const crates = this.playMode && this.playMode.crates;
        if (!crates || !crates.length) return false;
        const playerRadius = 0.8;
        const crateRadius = 0.65; // tuned for the 1.05-scale chest footprint
        const sumR = playerRadius + crateRadius;
        for (const c of crates) {
            if (c.userData.opened) continue;
            const dx = position.x - c.position.x;
            const dz = position.z - c.position.z;
            if (dx * dx + dz * dz < sumR * sumR) return true;
        }
        return false;
    }

    checkCollision(position) {
        if (this.checkEnemyCollision(position)) return true;
        if (this.checkCrateCollision(position)) return true;
        const playerRadius = 0.8;
        const playerHeight = 2;

        // Horizontal only — Y handled by checkWallCollisionY.
        let collided = false;
        this._iterWallsNear(position.x, position.z, playerRadius + 1, (wall) => {
            const wallPos = wall.position;
            const wallSize = wall.size;
            if (position.x + playerRadius > wallPos.x - wallSize.x/2 &&
                position.x - playerRadius < wallPos.x + wallSize.x/2 &&
                position.z + playerRadius > wallPos.z - wallSize.z/2 &&
                position.z - playerRadius < wallPos.z + wallSize.z/2) {
                const wallTop = wallPos.y + wallSize.y/2;
                const wallBottom = wallPos.y - wallSize.y/2;
                const playerBottom = position.y;
                const playerTop = position.y + playerHeight;
                if (playerTop > wallBottom && playerBottom < wallTop) {
                    collided = true;
                    return false;
                }
            }
        });
        return collided;
    }
    
    checkCollisionAxis(position, axis) {
        if (this.checkEnemyCollision(position)) return true;
        if (this.checkCrateCollision(position)) return true;
        const playerRadius = 0.8;
        const playerHeight = 2;


        const qx = axis === 'x' ? position.x : this.player.position.x;
        const qz = axis === 'z' ? position.z : this.player.position.z;
        let collided = false;
        this._iterWallsNear(qx, qz, playerRadius + 1, (wall) => {
            const wallPos = wall.position;
            const wallSize = wall.size;
            const px = axis === 'x' ? position.x : this.player.position.x;
            const pz = axis === 'z' ? position.z : this.player.position.z;
            if (px + playerRadius > wallPos.x - wallSize.x/2 &&
                px - playerRadius < wallPos.x + wallSize.x/2 &&
                pz + playerRadius > wallPos.z - wallSize.z/2 &&
                pz - playerRadius < wallPos.z + wallSize.z/2) {
                const wallTop = wallPos.y + wallSize.y/2;
                const wallBottom = wallPos.y - wallSize.y/2;
                const playerBottom = position.y;
                const playerTop = position.y + playerHeight;
                if (playerTop > wallBottom && playerBottom < wallTop) {
                    collided = true; return false;
                }
            }
        });
        return collided;
    }
    
    checkWallCollisionY() {
        const playerRadius = 0.8;
        const playerHeight = 2;

        // Solid crystal ceiling — cap the player below the roof so jumps /
        // jetpack thrust don't pop through into the sky. Destroyed roof tiles
        // open holes, so check the tile directly over the player first.
        if (this.roofY != null) {
            const ceiling = this.roofY;
            const tileAbove = this._roofTileAt(this.player.position.x, this.player.position.z);
            if (tileAbove && this.player.position.y + playerHeight >= ceiling) {
                this.player.position.y = ceiling - playerHeight;
                if (this.player.velocity.y > 0) this.player.velocity.y = 0;
            }
        }

        // Check collision with each wall for Y-axis (spatial-hash limited).
        let earlyReturn = false;
        this._iterWallsNear(this.player.position.x, this.player.position.z, playerRadius + 1, (wall) => {
            if (earlyReturn) return false;
            const wallPos = wall.position;
            const wallSize = wall.size;
            if (this.player.position.x + playerRadius > wallPos.x - wallSize.x/2 &&
                this.player.position.x - playerRadius < wallPos.x + wallSize.x/2 &&
                this.player.position.z + playerRadius > wallPos.z - wallSize.z/2 &&
                this.player.position.z - playerRadius < wallPos.z + wallSize.z/2) {
                const wallTop = wallPos.y + wallSize.y/2;
                const wallBottom = wallPos.y - wallSize.y/2;
                const playerBottom = this.player.position.y;
                const playerTop = this.player.position.y + playerHeight;
                if (this.player.velocity.y <= 0 && playerBottom <= wallTop && playerTop > wallTop) {
                    this.player.position.y = wallTop;
                    this.player.velocity.y = 0;
                    this.player.onGround = true;
                    earlyReturn = true; return false;
                }
                if (this.player.velocity.y > 0 && playerTop >= wallBottom && playerBottom < wallBottom) {
                    this.player.position.y = wallBottom - playerHeight;
                    this.player.velocity.y = 0;
                    earlyReturn = true; return false;
                }
                if (playerTop > wallBottom && playerBottom < wallTop) {
                    const distToLeft  = Math.abs(this.player.position.x - (wallPos.x - wallSize.x/2));
                    const distToRight = Math.abs(this.player.position.x - (wallPos.x + wallSize.x/2));
                    const distToFront = Math.abs(this.player.position.z - (wallPos.z - wallSize.z/2));
                    const distToBack  = Math.abs(this.player.position.z - (wallPos.z + wallSize.z/2));
                    const minDist = Math.min(distToLeft, distToRight, distToFront, distToBack);
                    if (minDist === distToLeft)       this.player.position.x = wallPos.x - wallSize.x/2 - playerRadius;
                    else if (minDist === distToRight) this.player.position.x = wallPos.x + wallSize.x/2 + playerRadius;
                    else if (minDist === distToFront) this.player.position.z = wallPos.z - wallSize.z/2 - playerRadius;
                    else                              this.player.position.z = wallPos.z + wallSize.z/2 + playerRadius;
                }
            }
        });
    }
    
    updateCamera() {
        // Play-mode camera: Isometric or First-Person
        if (this.gameMode === 'play') {
            if (this.viewMode === 'fpv') {
                const eyeHeight = 1.6 - this.player.duckBlend * 0.7;
                const pitch = this.fpvPitch || 0;
                const dir = new THREE.Vector3(
                    Math.sin(this.characterRotation) * Math.cos(pitch),
                    Math.sin(pitch),
                    Math.cos(this.characterRotation) * Math.cos(pitch)
                );
                const eye = this.player.position.clone();
                // Head bob on movement
                const moving = Math.abs(this.player.velocity.x) + Math.abs(this.player.velocity.z) > 0.1;
                const bobScale = 1 - this.player.duckBlend * 0.7;
                const bob = moving ? Math.sin(performance.now() / 1000 * this.fpvBobFrequency) * this.fpvBobAmplitude * bobScale : 0;
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
        // Smooth duck blend (0 = standing, 1 = fully ducked). 8/sec ≈ ~125ms transition.
        const duckTarget = this.player.ducked ? 1 : 0;
        const blendRate = 8 * deltaTime;
        this.player.duckBlend += THREE.MathUtils.clamp(duckTarget - this.player.duckBlend, -blendRate, blendRate);
        if (this.player.model) {
            this.player.model.scale.y = 1 - this.player.duckBlend * 0.45;
        }
        // Drive skeleton clip selection from movement/jump state before stepping the mixer
        if (this.player.clips) {
            const vx = this.player.velocity ? this.player.velocity.x : 0;
            const vz = this.player.velocity ? this.player.velocity.z : 0;
            const horizSpeed = Math.hypot(vx, vz);
            let target;
            if (this.player.onGround === false && this.player.clips['Jump']) {
                target = 'Jump';
            } else if (horizSpeed > 0.5) {
                target = 'Walk';
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

            if (moving) {
                const amp = 0.45;
                const legAmp = 0.6;
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
        this.updatePlacementGhost();

        // Multiplayer: send our state at ~15 Hz, interpolate remote players each frame
        this.tickMultiplayer(clampedDeltaTime);

        this.render();
    }
    
    fixedUpdate(deltaTime) {
        // All game logic goes here - runs at fixed 60 FPS
        this.tickSpeedBoost(deltaTime);
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
            this.updateEnemyProjectiles(deltaTime);
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
                this.updateCratesAndKeys(deltaTime);
                if (this.arena && this.arena.active) this.updateArena(deltaTime);
            }
            // Camera shake is used outside arena too (melee hits, etc.) — run it every frame.
            if (this.arena && !this.arena.active) this._updateCameraShake(deltaTime);
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
        // All rendering and UI updates happen here at display refresh rate.
        this.clearAllUI();
        this.updateControlsUI();
        this.updateHealthUI();
        this.updateCompassUI();
        this.updateCrosshairUI();
        this.updateGroundTargetIndicator();
        this.updateInventoryGridUI();
        this.updateToasts();

        this.updateHealthBarUI();
        this.updateDamageVignetteUI();
        this.updateMuzzleFlashUI();
        this.updateObjectiveBannerUI();
        this.updateSprintBarUI();
        this.updateMinimapUI();
        this._updateArenaCountdownUI();

        this.emit('ui:update', this.buildHUDModel());

        this.renderer.render(this.scene, this.camera);
    }

    // ===== HUD: simple top-right health bar (HP number + thin fill bar) =====
    _ensureHealthBarEl() {
        let el = document.getElementById('health-bar');
        // index.html ships a static #health-bar with the older pip schema
        // (.hb-pips / .hb-label). updateHealthBarUI writes to the new
        // .hb-fill / .hb-track schema, so re-stamp the innerHTML if the
        // JS-owned children aren't there — and apply the inline styles
        // since the static CSS only knows about the pip schema. Without
        // this, the first render throws on `fillEl.style.width = ...`
        // and the 3D scene goes black.
        if (el) {
            if (el.querySelector('.hb-fill')) return el;
            // Stale schema from static HTML — re-stamp and fall through to
            // apply the inline styles below.
            el.innerHTML = `
                <div class="hb-text">100</div>
                <div class="hb-track"><div class="hb-fill"></div></div>
            `;
        } else {
            el = document.createElement('div');
            el.id = 'health-bar';
            el.innerHTML = `
                <div class="hb-text">100</div>
                <div class="hb-track"><div class="hb-fill"></div></div>
            `;
        }
        Object.assign(el.style, {
            position: 'fixed',
            top: '14px',
            right: '14px',
            // Explicitly clear properties that older cached CSS may set,
            // otherwise top+bottom and left+right both apply and the panel
            // stretches across the whole viewport.
            bottom: 'auto',
            left: 'auto',
            transform: 'none',
            width: '160px',
            height: 'auto',
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(255,118,118,0.6)',
            borderRadius: '8px',
            padding: '6px 10px 8px',
            color: '#fff',
            fontFamily: 'Courier New, monospace',
            zIndex: '2000',
            pointerEvents: 'none',
            display: 'none',
            boxShadow: 'none',
        });
        const text = el.querySelector('.hb-text');
        Object.assign(text.style, {
            fontSize: '14px', fontWeight: '700', textAlign: 'right', lineHeight: '1',
            color: '#fff', textShadow: '0 0 4px rgba(255,90,90,0.7)', marginBottom: '4px'
        });
        const track = el.querySelector('.hb-track');
        Object.assign(track.style, {
            height: '6px', width: '100%', background: 'rgba(255,255,255,0.12)', borderRadius: '3px', overflow: 'hidden'
        });
        const fill = el.querySelector('.hb-fill');
        Object.assign(fill.style, {
            height: '100%', width: '100%', background: '#6dff7a',
            boxShadow: '0 0 6px rgba(109,255,122,0.6)',
            transition: 'width 0.15s ease-out, background 0.2s'
        });
        if (!el.parentNode) document.body.appendChild(el);
        return el;
    }

    updateHealthBarUI() {
        const el = this._ensureHealthBarEl();
        if (this.gameMode !== 'play') { el.style.display = 'none'; return; }
        el.style.display = 'block';

        const hp = Math.max(0, Math.floor(this.player.hp));
        const maxHp = this.player.maxHp || 100;
        const pct = Math.max(0, Math.min(1, hp / maxHp));
        const color = pct < 0.3 ? '#ff5a5a' : pct < 0.6 ? '#ffd34a' : '#6dff7a';

        const textEl = el.querySelector('.hb-text');
        const fillEl = el.querySelector('.hb-fill');
        textEl.textContent = `${hp} / ${maxHp}`;
        fillEl.style.width = `${(pct * 100).toFixed(1)}%`;
        fillEl.style.background = color;
        fillEl.style.boxShadow = `0 0 6px ${color}`;
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

    updateSprintBarUI() {
        const bar = document.getElementById('sprint-bar');
        if (!bar) return;

        const timer = this.powerUps && this.powerUps.speedBoostTimer ? this.powerUps.speedBoostTimer : 0;
        const inPlay = this.gameMode === 'play' && !(this._isPreGameMeta && this._isPreGameMeta());

        if (!inPlay || timer <= 0) {
            bar.style.display = 'none';
            bar.setAttribute('aria-hidden', 'true');
            return;
        }

        const peak = Math.max(0.001, this.powerUps._speedBoostBarPeak || this.SPEED_BOOST_MAX_TIMER || 25);
        const ratio = Math.max(0, Math.min(1, timer / peak));

        bar.style.display = 'flex';
        bar.setAttribute('aria-hidden', 'false');
        bar.classList.toggle('sb-low', ratio < 0.25);

        const fill = bar.querySelector('.sb-fill');
        if (fill) fill.style.width = (ratio * 100).toFixed(2) + '%';
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
        // Minimap is intentionally hidden in maze/play mode — the on-screen
        // direction indicator + objective banner carry navigation by themselves.
        wrap.style.display = 'none';
        return;

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
        // Cheap sweep: only IDs that legacy code might leave behind. The
        // previous version did a full-document querySelectorAll('div') +
        // getComputedStyle per frame, which dominated CPU on lower-end
        // machines. The targeted-ID removal below is O(1) per id and the
        // div scan is no longer needed — every live HUD element is owned
        // by the new cached-ref system in mountHUD/updateXxxUI.
        const stale = STALE_UI_IDS;
        for (let i = 0; i < stale.length; i++) {
            const el = document.getElementById(stale[i]);
            if (el) el.remove();
        }
    }

    updateHealthUI() {
        // Replaced by updateHealthBarUI() — keep stub so other call sites don't break.
        const old = document.getElementById('health-ui');
        if (old) old.remove();
    }

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
        // Controls panel is hidden — kept off by default. The block below is
        // retained as a reference implementation if it's brought back later.
        const existing = document.getElementById('controls-ui');
        if (existing) existing.style.display = 'none';
        return;
        if (this.gameMode !== 'play') {
            return;
        }

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

        const viewMode = this.viewMode;
        const isJetpackActive = this.isJetpackActive;
        const isReloading = this.isReloading;

        const movementControls = [
            'WASD - Move',
            'Mouse - Look Around',
            this.jetpackArmed ? 'Space - Jetpack (hold)' : 'Space - Jump'
        ];

        const weaponControls = [
            'Left Click - Fire',
            'Mouse Wheel - Switch Weapon',
            'R - Reload',
            '1-2 - Select Weapon'
        ];

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

        const specialStates = [];
        if (isJetpackActive) {
            specialStates.push('🚀 Jetpack thrusting');
        } else if (this.jetpackArmed) {
            specialStates.push('🚀 Jetpack armed (Space to fly)');
        }
        if (isReloading) {
            specialStates.push('🔄 Reloading...');
        }
        if (this.powerUps.speedBoostTimer > 0) {
            specialStates.push(`⚡ Speed Boost ${Math.ceil(this.powerUps.speedBoostTimer)}s`);
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
        const sigParts = [
            activeWeaponId || '',
            this.jetpackArmed ? 'J' : '-',
            `spd:${this.getSpeedBoostStock()}:${Math.ceil(this.powerUps.speedBoostTimer || 0)}`
        ];
        for (const id of layout) {
            if (!id) { sigParts.push('_'); continue; }
            sigParts.push(`${id}:${this.getItemCount(id)}:${this.isItemOwned(id) ? 1 : 0}`);
        }
        const sig = sigParts.join('|');
        if (sig === this._qbSig) return;
        this._qbSig = sig;

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
            let type = 'empty';
            if (def) {
                if (def.category === 'weapon') type = 'weapon';
                else if (def.category === 'block') type = 'block';
                else type = 'item';
            }
            return {
                id: itemId,
                type,
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
            const isActiveBlock = !!(this.activeBlockId && this.BLOCK_DEFS && this.BLOCK_DEFS[item.id] && item.id === this.activeBlockId);
            const isSelected = (item.type === 'weapon' && item.id === activeWeaponId) || isActiveBlock;
            const isArmed = item.id === 'jetpack' && this.jetpackArmed;
            if (isArmed) slot.classList.add('qb-armed');
            if (item.id === 'speed' && this.powerUps.speedBoostTimer > 0) {
                slot.classList.add('qb-speed-active');
            }

            if (item.type === 'empty') {
                slot.classList.add('qb-empty');
            } else if (!isOwned) {
                slot.classList.add('qb-unavail');
            }
            if (isSelected) slot.classList.add('qb-selected');

            const count = item.type === 'empty' ? 0 : this.getItemCount(item.id);
            let countLabel = '';
            if (item.id === 'speed') {
                const stock = this.getSpeedBoostStock();
                const active = Math.ceil(this.powerUps.speedBoostTimer || 0);
                if (stock > 0 && active > 0) countLabel = `${stock}·${active}s`;
                else if (stock > 0) countLabel = String(stock);
                else if (active > 0) countLabel = `${active}s`;
            } else if (item.type === 'block') {
                countLabel = '∞';
            } else if (item.type !== 'weapon' && item.type !== 'empty' && count > 0) {
                countLabel = String(count);
            }

            slot.innerHTML = `
                <span class="qb-key">${item.shortcut}</span>
                <span class="qb-icon">${item.icon || '·'}</span>
                ${countLabel ? `<span class="qb-count">${countLabel}</span>` : ''}
            `;

            slot.addEventListener('click', () => {
                if (item.id === 'speed' && this.getSpeedBoostStock() <= 0) {
                    if (this.powerUps.speedBoostTimer > 0) {
                        this.showMessage(`Speed boost active — ${Math.ceil(this.powerUps.speedBoostTimer)}s left`);
                    }
                    return;
                }
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

        // Block tool: arm placement mode. Left-click then drops a block.
        if (this.BLOCK_DEFS && this.BLOCK_DEFS[item.id]) {
            this.activeBlockId = item.id;
            this.showMessage(`${item.name} — left-click to place`);
            this._qbSig = null;
            // Detach the weapon from the hand and hide the FPV viewmodel so it's
            // clear the player is in placement mode, not weapon mode.
            this.attachActiveWeaponToHand();
            this.updateInventoryGridUI && this.updateInventoryGridUI();
            return;
        }
        // Any non-block selection clears placement mode.
        const wasArmed = !!this.activeBlockId;
        this.activeBlockId = null;

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
            // Disarming a block (selecting a consumable) — re-attach the current weapon.
            if (wasArmed) this.attachActiveWeaponToHand();
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
        const type = def.category === 'weapon' ? 'weapon'
            : (def.category === 'block' ? 'block' : 'item');
        this.selectGridItem({
            id: def.id,
            type,
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
        const blockItems = (reg.blocks || []).map(d => ({ ...d, type: 'block' }));

        const ownedOnly = this.drawerFilter === 'owned';
        const filt = (it) => !ownedOnly || this.isItemOwned(it.id);
        const visibleWeapons = weaponItems.filter(filt);
        const visibleConsumables = consumableItems.filter(filt);
        const visibleBlocks = blockItems.filter(filt);

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
                        <span class="ds-chip ds-keys" title="Crate keys"><b>🗝️</b> ${this.inventory.keys || 0}</span>
                    </div>
                    <div class="drawer-actions">
                        <button class="df-pill ${ownedOnly ? '' : 'df-pill-on'}" data-filter="all">All</button>
                        <button class="df-pill ${ownedOnly ? 'df-pill-on' : ''}" data-filter="owned">Owned</button>
                        <button class="df-btn" id="reset-quickbar" title="Restore default loadout">↺ Reset</button>
                        <button class="df-btn" id="clear-builds" title="Delete every block you've placed in this mode">🧹 Clear builds${this._placedBlockCount() ? ` (${this._placedBlockCount()})` : ''}</button>
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

                    <div class="drawer-section">
                        <h4>Blocks <span class="ds-count">${visibleBlocks.length}/${blockItems.length}</span></h4>
                        <div id="block-grid" class="drawer-grid">
                            ${visibleBlocks.length ? '' : `<div class="drawer-empty">No blocks${ownedOnly ? ' yet' : ''}.</div>`}
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

        const clearBtn = drawer.querySelector('#clear-builds');
        if (clearBtn) clearBtn.addEventListener('click', () => {
            const n = this._placedBlockCount();
            if (n === 0) { this.showMessage('No placed blocks to clear.'); return; }
            if (!confirm(`Delete all ${n} placed block${n === 1 ? '' : 's'} in this mode? This can't be undone.`)) return;
            this.audio && this.audio.play('uiClick');
            this._clearAllPlacedBlocks();
            this.updateDrawerUI();
            this.showMessage(`Cleared ${n} placed block${n === 1 ? '' : 's'}.`);
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

        const blockGrid = drawer.querySelector('#block-grid');
        if (blockGrid) visibleBlocks.forEach(item => blockGrid.appendChild(this.createDrawerItem(item)));

        this.setupDrawerKeyboardNavigation();
    }

    // Short effect blurb for an item card (e.g. "+25 HP", "15 dmg · range 2.5")
    itemEffectText(item) {
        if (item.type === 'weapon') {
            const w = this.WEAPON_STATS[item.id];
            if (!w) return '';
            return `${w.damage} dmg · ${w.type === 'melee' ? `reach ${w.range}` : `range ${w.range}`}`;
        }
        const def = this.ITEM_DEFS[item.id];
        if (!def) return '';
        if (item.id === 'speed') {
            const stock = this.getSpeedBoostStock();
            const left = Math.ceil(this.powerUps.speedBoostTimer || 0);
            if (left > 0 && stock > 0) return `${stock} in bag · ${left}s active (+45% move)`;
            if (stock > 0) return `×${stock} in bag — click to use (+10s sprint)`;
            if (left > 0) return `${left}s active (+45% move)`;
            return '+10s sprint per pickup';
        }
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

        const isBlock = item.type === 'block' || item.category === 'block';
        const showCount = item.type !== 'weapon' && count > 0;
        const countLabel = isBlock ? '∞' : `×${count}`;
        const slotLabel = slotIdx >= 0 ? `slot ${slotIdx + 1}` : '';
        itemEl.title = `${item.name}${effect ? ` — ${effect}` : ''}${showCount ? ` (${isBlock ? '∞' : count})` : ''}${inBar ? ` · in ${slotLabel}` : ''}${!isOwned ? ' · not picked up' : ''}`;

        itemEl.innerHTML = `
            <div class="di-row">
                <div class="di-icon">${item.icon}</div>
                ${showCount ? `<div class="di-count">${countLabel}</div>` : ''}
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
        document.removeEventListener('keydown', this.drawerKeyHandler);

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
        const saved = localStorage.getItem('pjboy_quickbar_layout_v3');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                const valid = new Set([
                    ...Object.keys(this.WEAPON_STATS),
                    ...Object.keys(this.ITEM_DEFS),
                    ...Object.keys(this.BLOCK_DEFS || {}),
                ]);
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
        const layout = ['diamondSword', 'gun', 'machineGun', 'stone', 'jetpack', 'health', 'ammo', 'speed', 'weaponBuff'];
        const valid = new Set([
            ...Object.keys(this.WEAPON_STATS),
            ...Object.keys(this.ITEM_DEFS),
            ...Object.keys(this.BLOCK_DEFS || {}),
        ]);
        return layout.map(id => (valid.has(id) ? id : null));
    }

    saveQuickbarLayout() {
        localStorage.setItem('pjboy_quickbar_layout_v3', JSON.stringify(this.quickbarLayout));
    }
    
    showToast(message, type = 'info', duration = 3000) {
        const toast = {
            id: this.toastId++,
            message: message,
            type: type, // 'info' | 'success' | 'warning' | 'error'
            duration: duration,
            startTime: Date.now(),
            element: null
        };

        this.toasts.push(toast);
        this.createToastElement(toast);

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
        // Stack toasts vertically at 60px spacing
        this.toasts.forEach((toast, index) => {
            if (toast.element) {
                const offset = index * 60;
                toast.element.style.top = `${20 + offset}px`;
            }
        });
    }
    
    // The drawer used to hide the system cursor and overlay a glowing ring.
    // That made the cursor invisible (and confusing) while interacting with
    // drawer items, so we now keep the OS cursor visible at all times.
    hideDrawerCursor() { document.body.style.cursor = ''; }

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
        if (this.gameMode !== 'play') {
            return;
        }

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

        const facingAngle = this.characterRotation * (180 / Math.PI);
        const normalizedAngle = ((facingAngle % 360) + 360) % 360;

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
        if (this.groundTargetIndicator) {
            this.scene.remove(this.groundTargetIndicator);
        }

        const outerGeometry = new THREE.RingGeometry(1.2, 1.5, 32);
        const outerMaterial = new THREE.MeshBasicMaterial({
            color: 0xffb347,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);

        const innerGeometry = new THREE.RingGeometry(0.8, 1.0, 32);
        const innerMaterial = new THREE.MeshBasicMaterial({
            color: 0xffb347,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide
        });
        const innerRing = new THREE.Mesh(innerGeometry, innerMaterial);

        const dotGeometry = new THREE.CircleGeometry(0.3, 16);
        const dotMaterial = new THREE.MeshBasicMaterial({
            color: 0xffb347,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        const centerDot = new THREE.Mesh(dotGeometry, dotMaterial);

        this.groundTargetIndicator = new THREE.Group();
        this.groundTargetIndicator.add(outerRing);
        this.groundTargetIndicator.add(innerRing);
        this.groundTargetIndicator.add(centerDot);

        this.groundTargetIndicator.position.y = 0;
        this.groundTargetIndicator.rotation.x = -Math.PI / 2; // lay flat
        this.groundTargetIndicator.visible = false;

        this.scene.add(this.groundTargetIndicator);
    }

    updateGroundTargetIndicator() {
        // Only show in iso/birds-eye/ghost play modes (FPV has a screen-space crosshair instead)
        const shouldShow = (this.gameMode === 'play' && (this.viewMode === 'iso' || this.viewMode === 'birds-eye' || this.viewMode === 'ghost'));


        if (!this.groundTargetIndicator) {
            this.createGroundTargetIndicator();
        }

        if (shouldShow) {
            const mouse = new THREE.Vector2();
            mouse.x = this.playMode.mouseNDC.x;
            mouse.y = this.playMode.mouseNDC.y;


            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, this.camera);

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
        const speed = this.ghostCamera.speed;
        const moveSpeed = speed * deltaTime;

        const forward = new THREE.Vector3(0, 0, -1);
        const right = new THREE.Vector3(1, 0, 0);
        const up = new THREE.Vector3(0, 1, 0);

        forward.applyQuaternion(this.ghostCamera.quaternion);
        right.applyQuaternion(this.ghostCamera.quaternion);
        up.applyQuaternion(this.ghostCamera.quaternion);

        const movement = new THREE.Vector3();

        if (this.keys['KeyW']) movement.add(forward);
        if (this.keys['KeyS']) movement.sub(forward);
        if (this.keys['KeyA']) movement.sub(right);
        if (this.keys['KeyD']) movement.add(right);
        if (this.keys['KeyQ']) movement.sub(up);
        if (this.keys['KeyE']) movement.add(up);
        if (this.keys['Space']) movement.add(up);

        movement.multiplyScalar(moveSpeed);
        this.ghostCamera.position.add(movement);

        // Mouse look is handled in the mousemove listener.
    }


    updatePowerUps(deltaTime) {
        if (this.powerUps.healthRegen > 0) {
            const regenAmount = this.powerUps.healthRegen * 2 * deltaTime; // 2 HP/s per stack
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + regenAmount);
        }

        // Speed boost is applied directly in the movement code.

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
        // Block placement mode disables weapon use entirely.
        if (this.activeBlockId) return;

        const weapon = this.getCurrentWeapon();
        if (!weapon || !weapon.isContinuous) return;

        const weaponId = this.player.weapons[this.player.currentWeaponIndex];
        if (this.weaponCooldowns[weaponId] && this.weaponCooldowns[weaponId] > 0) return;

        if (weapon.ammoCost > 0 && this.inventory.ammo < weapon.ammoCost) {
            this.isFiring = false;
            return;
        }

        // Route ranged through fireGun so we spawn a projectile from the muzzle
        // (matches single-click feel); melee falls back to the legacy attack path.
        if (weapon.type === 'ranged') {
            this.fireGun();
        } else {
            this.attackWithWeapon();
        }
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

        this.buildArena();

        // Reset player loadout
        this.player.position.set(0, 0, 0);
        this.player.velocity.set(0, 0, 0);
        this.player.hp = this.player.maxHp || 100;
        this.player.invulnerable = false;
        this.player.invulnerabilityTimer = 0;
        this.characterRotation = 0;
        if (this.player.weapons) {
            this.player.weapons = ['diamondSword', 'swordGold', 'swordStone', 'skeletonAxe', 'axeDiamond', 'axeGold', 'skeletonBlade', 'skeletonStaff', 'gun', 'machineGun'];
            this.player.currentWeaponIndex = 0;
        }
        if (this.inventory) this.inventory.ammo = 100;
        this.score = 0;
        this.kills = 0;

        this.gameMode = 'play';

        this.audio && this.audio.play('uiClick');
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
            this._addWallToHash(entry);
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
            this._addWallToHash(entry);
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
        // Bail early when disabled — no point computing positions for hidden
        // objects (saves the ray/plane intersect in particular).
        if (!fi.enabled) {
            fi.light.visible = false;
            if (fi.groundDot) fi.groundDot.visible = false;
            return;
        }
        const px = this.player.position.x;
        const py = this.player.position.y;
        const pz = this.player.position.z;
        const fx = Math.sin(this.characterRotation);
        const fz = Math.cos(this.characterRotation);
        // Light at head, slightly forward
        fi.light.position.set(px + fx * 0.25, py + 1.6, pz + fz * 0.25);
        // Target a few meters forward
        fi.lightTarget.position.set(px + fx * 3, this.groundY + 0.5, pz + fz * 3);
        fi.light.visible = true;

        // Ground dot at forward ground intersection from player
        if (fi.groundDot) {
            _scratchV3a.set(px, py + 1.0, pz);
            _scratchV3b.set(fx, 0, fz);
            _scratchRay.origin.copy(_scratchV3a);
            _scratchRay.direction.copy(_scratchV3b);
            _scratchPlaneGround.constant = -this.groundY;
            if (_scratchRay.intersectPlane(_scratchPlaneGround, _scratchV3c)) {
                fi.groundDot.position.set(_scratchV3c.x, this.groundY + 0.02, _scratchV3c.z);
                fi.groundDot.visible = true;
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

window.addEventListener('load', () => {
    const game = new Game3D();

    // Exposed globally for the character picker buttons.
    window.game = game;

    game.setupModalListeners();
    game.generateCharacterPreviews();
    if (game.setupMetaUI) game.setupMetaUI();
    if (game.setAppPhase) game.setAppPhase('title');

    // Inject crosshair element if index.html didn't ship one
    const crosshairCheck = document.getElementById('crosshair');
    if (!crosshairCheck) {
        const crosshair = document.createElement('div');
        crosshair.id = 'crosshair';
        crosshair.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 18px; height: 18px; pointer-events: none; z-index: 999999; display: none;';
        crosshair.innerHTML = `
            <div style="position: absolute; top: 50%; left: 50%; width: 8px; height: 8px; background: #ffb347; box-shadow: 0 0 10px #ffb347, 0 0 20px #ffb347; border-radius: 50%; transform: translate(-50%, -50%);"></div>
        `;
        document.body.appendChild(crosshair);
    }
});
