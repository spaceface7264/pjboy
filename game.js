// 3D Second-Person Game - 128-bit Style
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
        this.viewMode = 'iso'; // 'iso' | 'fpv' | 'birds-eye' | 'ghost'
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
        this.showControlsUI = true; // Toggle for control panel visibility
        
        // Game state management
        this.gameState = 'menu'; // 'menu', 'playing', 'levelComplete', 'gameOver'
        this.currentLevel = 1;
        this.maxLevel = 10;
        this.levelStartTime = 0;
        this.levelCompleteTime = 0;
        this.playerLives = 3;
        this.totalScore = 0;
        this.levelEndWorld = null; // Position of the red exit marker
        
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
                iInventory: 'I - Inventar',
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
                diamondSword: 'Diamant Sværd',
                diamondSwordDesc: 'Et kraftfuldt diamant sværd med høj skade',
                gun: 'Pistol',
                gunDesc: 'En præcis pistol med høj skade',
                machineGun: 'Maskinpistol',
                machineGunDesc: 'Hurtig maskinpistol med kontinuerlig ild',
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
                instructions: 'Instruktioner',
                iToClose: 'I for at lukke',
                tabArrowsNavigate: 'TAB/Pile for at navigere',
                enterClickUse: 'Enter/Klik for at bruge',
                iClose: 'I for at lukke',
                tabNavigate: 'TAB for at navigere',
                enterUse: 'Enter for at bruge',
                escapeClose: 'Escape for at lukke'
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
                iInventory: 'I - Inventory',
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
                diamondSword: 'Diamond Sword',
                diamondSwordDesc: 'A powerful diamond sword with high damage',
                gun: 'Pistol',
                gunDesc: 'A precise pistol with high damage',
                machineGun: 'Machine Gun',
                machineGunDesc: 'Fast machine gun with continuous fire',
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
                instructions: 'Instructions',
                iToClose: 'I to close',
                tabArrowsNavigate: 'TAB/Arrows to navigate',
                enterClickUse: 'Enter/Click to use',
                iClose: 'I to close',
                tabNavigate: 'TAB to navigate',
                enterUse: 'Enter to use',
                escapeClose: 'Escape to close'
            }
        };
        
        // Theme system
        this.themeName = 'neon';
        this.themes = {
            neon: {
                ground: 0x001100,
                grid: 0x00ff00,
                wall: 0x003300,
                wallEmissive: 0x000800,
                sky: 0x000011,
                ambient: 0x001122,
                sun: 0x00ff88
            },
            forest: {
                ground: 0x203b20,
                grid: 0x5cff5c,
                wall: 0x2a5a2e,
                wallEmissive: 0x0b180c,
                sky: 0x87b5ff,
                ambient: 0x1b3020,
                sun: 0xfff2a8
            },
            desert: {
                ground: 0xc2b280,
                grid: 0xffe8a0,
                wall: 0xa68a5b,
                wallEmissive: 0x3b2c14,
                sky: 0xdfe6ff,
                ambient: 0x705f3a,
                sun: 0xffd27a
            },
            dungeon: {
                ground: 0x202020,
                grid: 0x66ffcc,
                wall: 0x333333,
                wallEmissive: 0x070707,
                sky: 0x080808,
                ambient: 0x101010,
                sun: 0x88aaff
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
            cameraOffset: new THREE.Vector3(-15, 20, -15), // isometric offset
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

        this.init();
        this.setupEventListeners();
        this.initializeWeapons();
        this.animate();
    }
    
    initializeWeapons() {
        // Define available weapons
        this.weaponDefinitions = {
            diamondSword: {
                name: this.t('diamondSword'),
                damage: 15,
                range: 2.5,
                cooldown: 0.8,
                type: 'melee',
                icon: '⚔️',
                color: 0x00aaff,
                description: this.t('diamondSwordDesc'),
                ammoCost: 0
            },
            gun: {
                name: this.t('gun'),
                damage: 25,
                range: 15,
                cooldown: 1.2,
                type: 'ranged',
                icon: '🔫',
                color: 0x8B4513,
                description: this.t('gunDesc'),
                ammoCost: 1
            },
            machineGun: {
                name: this.t('machineGun'),
                damage: 8,
                range: 12,
                cooldown: 0.1,
                type: 'ranged',
                icon: '🔫',
                color: 0x696969,
                description: this.t('machineGunDesc'),
                ammoCost: 1,
                isContinuous: true
            }
        };
        
        // Initialize player weapons
        this.player.weapons = ['diamondSword', 'gun', 'machineGun'];
        this.player.currentWeaponIndex = 0;
        
        // Initialize power-ups
        this.powerUps = {
            jetpackFuel: 0,
            speedBoost: 0,
            healthRegen: 0,
            weaponBuff: 0
        };
        
        // Weapon cooldown tracking
        this.weaponCooldowns = {};
        
        // Firing state
        this.isFiring = false;
        
        // Cooldown update throttling (≤10 Hz)
        this.lastCooldownUpdate = 0;
        this.cooldownUpdateInterval = 100; // 100ms = 10 Hz
        this.isReloading = false;
        this.reloadTime = 0;
        
        // Drawer state
        this.isDrawerOpen = false;
        this.selectedDrawerSlot = 0;
        this.draggedItem = null;
        this.dragStartSlot = null;
        
        // Toast notifications
        this.toasts = [];
        this.toastId = 0;
        
        // Create weapon model
        this.createWeaponModel();
        
        // Load saved quickbar layout
        this.loadQuickbarLayout();
        
        // Mount the new HUD system
        this.mountHUD();
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
    
    createWeaponModel() {
        // Create diamond sword model
        const swordGroup = new THREE.Group();
        
        // Sword blade (diamond blue)
        const bladeGeometry = new THREE.BoxGeometry(0.1, 1.2, 0.05);
        const bladeMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x00aaff,
            emissive: 0x002244
        });
        const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
        blade.position.set(0, 0.6, 0);
        blade.castShadow = true;
        swordGroup.add(blade);
        
        // Sword guard (gold)
        const guardGeometry = new THREE.BoxGeometry(0.3, 0.1, 0.1);
        const guardMaterial = new THREE.MeshLambertMaterial({ color: 0xffaa00 });
        const guard = new THREE.Mesh(guardGeometry, guardMaterial);
        guard.position.set(0, 0.1, 0);
        guard.castShadow = true;
        swordGroup.add(guard);
        
        // Sword handle (brown)
        const handleGeometry = new THREE.BoxGeometry(0.15, 0.8, 0.15);
        const handleMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const handle = new THREE.Mesh(handleGeometry, handleMaterial);
        handle.position.set(0, -0.3, 0);
        handle.castShadow = true;
        swordGroup.add(handle);
        
        // Sword pommel (gold)
        const pommelGeometry = new THREE.SphereGeometry(0.1, 8, 8);
        const pommelMaterial = new THREE.MeshLambertMaterial({ color: 0xffaa00 });
        const pommel = new THREE.Mesh(pommelGeometry, pommelMaterial);
        pommel.position.set(0, -0.7, 0);
        pommel.castShadow = true;
        swordGroup.add(pommel);
        
        // Position sword in player's hand
        swordGroup.position.set(0.3, 0.5, 0.2);
        swordGroup.rotation.z = -Math.PI / 6;
        
        this.player.weaponModel = swordGroup;
        // Add weapon to player model when it's available
        if (this.player.model) {
            this.player.model.add(swordGroup);
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
        
        // Emit UI update event
        this.emit('ui:update', this.buildHUDModel());
    }
    
    reloadWeapon() {
        const weapon = this.getCurrentWeapon();
        if (!weapon || weapon.type !== 'ranged' || this.isReloading) return;
        
        // Start reload process
        this.isReloading = true;
        this.reloadTime = 2.0; // 2 second reload time
        this.showMessage(`${this.t('reloading')}...`);
        
        // Emit UI update event
        this.emit('ui:update', this.buildHUDModel());
    }
    
    updateReload(deltaTime) {
        if (!this.isReloading) return;
        
        this.reloadTime -= deltaTime;
        if (this.reloadTime <= 0) {
            // Reload complete
            this.isReloading = false;
            this.inventory.ammo = Math.min(this.inventory.ammo + 50, 200); // Reload with 50 ammo, max 200
            this.showMessage(`${this.t('reloaded')} - ${this.t('ammo')}: ${this.inventory.ammo}`);
            
            // Emit UI update event
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
        const damageMultiplier = 1 + (this.powerUps.weaponBuff * 0.2); // 20% per stack
        const finalDamage = Math.floor(weapon.damage * damageMultiplier);
        
        if (weapon.type === 'melee') {
            this.performMeleeAttack(finalDamage);
        } else if (weapon.type === 'ranged') {
            this.performRangedAttack(finalDamage, weapon.range);
        }
    }
    
    performRangedAttack(damage, range) {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        
        const origin = this.camera.position.clone();
        const dir = raycaster.ray.direction.clone();
        
        // Find closest enemy within range
        const hits = raycaster.intersectObjects(this.playMode.enemies, false);
        if (hits.length > 0 && hits[0].distance <= range) {
            const e = hits[0].object;
            e.userData.hp -= damage;
            this.spawnImpact(hits[0].point.clone(), 0xff0000);
            
            if (e.userData.hp <= 0) {
                const idx = this.playMode.enemies.indexOf(e);
                if (idx !== -1) this.playMode.enemies.splice(idx, 1);
                this.playMode.enemiesGroup.remove(e);
            } else {
                // Brief flash
                const mat = e.material;
                const orig = mat.color.getHex();
                mat.color.setHex(0xffffff);
                setTimeout(() => mat.color.setHex(orig), 80);
                this.showEnemyHPBar(e, 3.0);
            }
            return;
        }
        
        // No hit - show bullet trail
        const endPoint = origin.clone().add(dir.multiplyScalar(range));
        this.spawnImpact(endPoint, 0xffff00);
    }
    
    performMeleeAttack(damage = 2) {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const origin = this.camera.position.clone();
        const dir = raycaster.ray.direction.clone();
        const maxDist = 2.5;
        
        // Find closest enemy intersecting the ray within maxDist
        const hits = raycaster.intersectObjects(this.playMode.enemies, false);
        if (hits.length > 0 && hits[0].distance <= maxDist) {
            const e = hits[0].object;
            e.userData.hp -= damage;
            this.spawnImpact(hits[0].point.clone(), 0xffaa55);
            
            if (e.userData.hp <= 0) {
                const idx = this.playMode.enemies.indexOf(e);
                if (idx !== -1) this.playMode.enemies.splice(idx, 1);
                this.playMode.enemiesGroup.remove(e);
            } else {
                // Brief flash
                const mat = e.material;
                const orig = mat.color.getHex();
                mat.color.setHex(0xffffff);
                setTimeout(() => mat.color.setHex(orig), 80);
                this.showEnemyHPBar(e, 3.0);
            }
            return;
        }
        
        // No direct hit: optional small shove effect at range end
        const endPoint = origin.clone().add(dir.multiplyScalar(maxDist));
        this.spawnImpact(endPoint, 0xcccccc);
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
            console.log(`Language changed to: ${lang}`);
        }
    }
    
    // Update all UI elements with current language
    updateAllUI() {
        this.updateModalContent();
        this.updateInventoryUI();
    }

    setViewMode(mode) {
        console.log(`setViewMode called with: ${mode}, current viewMode: ${this.viewMode}`);
        if (mode !== 'iso' && mode !== 'fpv' && mode !== 'birds-eye' && mode !== 'ghost') {
            console.log(`Invalid view mode: ${mode}`);
            return;
        }
        this.viewMode = mode;
        console.log(`View mode changed to: ${this.viewMode}`);
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
        if (this.player && this.player.model) {
            this.player.model.visible = (mode !== 'fpv');
        }
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
        this.scene.fog = new THREE.Fog(0x000000, 50, 200);
        
        // Create camera (second-person perspective)
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 5, 10); // Behind and above player
        
        // Create renderer with 128-bit aesthetic
        const canvas = document.getElementById('gameCanvas');
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: canvas, 
            antialias: false,
            alpha: false
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for retro look
        this.renderer.setClearColor(0x000000);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
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
        
        // Show opening screen instead of starting immediately
        this.showOpeningScreen();
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
        
        // Create our custom lion archer model
        this.createLionArcherModel();
        // Create facing indicator after model exists
        this.createFacingIndicator();
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
        
        // Add weapon if it exists
        if (this.player.weaponModel) {
            this.player.model.add(this.player.weaponModel);
        }
    }
    
    createFallbackCharacter() {
        // Create a simple low-poly character using basic geometries
        const characterGroup = new THREE.Group();
        
        // Head (cube) - different colors for front/back
        const headGeometry = new THREE.BoxGeometry(1, 1, 1);
        const headMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x00ff00,
            emissive: 0x002200
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 1.5;
        head.castShadow = true;
        characterGroup.add(head);
        
        
        // Body (rectangular)
        const bodyGeometry = new THREE.BoxGeometry(1.2, 2, 0.8);
        const bodyMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x008800,
            emissive: 0x001100
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.5;
        body.castShadow = true;
        characterGroup.add(body);
        
        // Arms
        const armGeometry = new THREE.BoxGeometry(0.3, 1.5, 0.3);
        const armMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x00ff00,
            emissive: 0x002200
        });
        
        const leftArm = new THREE.Mesh(armGeometry, armMaterial);
        leftArm.position.set(-0.8, 0.5, 0);
        leftArm.castShadow = true;
        characterGroup.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeometry, armMaterial);
        rightArm.position.set(0.8, 0.5, 0);
        rightArm.castShadow = true;
        characterGroup.add(rightArm);
        
        // Legs
        const legGeometry = new THREE.BoxGeometry(0.4, 1.5, 0.4);
        const legMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x006600,
            emissive: 0x001100
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
            
            // Apply neon materials
            character.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshLambertMaterial({
                        color: 0x00ff00,
                        emissive: 0x002200
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
            
            console.log('Character model loaded successfully!');
        }, undefined, (error) => {
            console.error('Error loading character model:', error);
        });
    }
    
    createEnvironment() {
        // Create ground
        const groundGeometry = new THREE.PlaneGeometry(200, 200);
        const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x001100 });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        this.groundY = -1; // track ground height for indicators/effects
        ground.position.y = this.groundY;
        ground.receiveShadow = true;
        this.scene.add(ground);
        this.ground = ground;
        
        // Create retro grid pattern
        this.createGrid();
        
        // Initialize saved mazes
        this.initializeSavedMazes();
        
        // Initialize create mode
        this.initializeCreateMode();
        
        // Create labyrinth
        this.createLabyrinth();
        
        
        // Create skybox
        this.createSkybox();
    }
    
    createGrid() {
        const gridSize = 200;
        const gridDivisions = 50;
        const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x00ff00, 0x00ff00);
        gridHelper.position.y = -0.9;
        gridHelper.material.opacity = 0.3;
        gridHelper.material.transparent = true;
        this.scene.add(gridHelper);
        this.gridHelper = gridHelper;
    }

    updateGroundAndFog(width, height) {
        const size = Math.max(width, height) + 20; // margin
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
            const grid = new THREE.GridHelper(size, divisions, 0x00ff00, 0x00ff00);
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
        
        // Create highlight material
        const highlightMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.2,
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
                    color: 0x00ff00,
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
                    color: 0x00ff00,
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
        const wallMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x001100,
            emissive: 0x000800,
            transparent: true,
            opacity: 0.9
        });
        
        const wall = new THREE.Mesh(
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
            this.currentMazeIndex = index;
            this.rebuildMaze();
            console.log(`Switched to maze: ${this.savedMazes[index].name}`);
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
            // In play mode, re-acquire pointer lock for continuous mouse aim
            if (this.gameMode === 'play' && !this.isPointerLocked) {
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
        
        const themeTitle = document.getElementById('theme-title');
        if (themeTitle) themeTitle.textContent = this.t('theme');
        
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
        
        // Theme buttons
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const theme = btn.dataset.theme;
                this.applyTheme(theme);
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
        
        // Game mode buttons
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                this.setGameMode(mode);
                this.toggleSettingsModal(); // Close modal immediately
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
        // Wall material respects theme; fall back to defaults if theme not ready
        const theme = (this.themes && this.themes[this.themeName]) || null;
        const wallMaterial = this.materials && this.materials.wall
            ? this.materials.wall
            : new THREE.MeshLambertMaterial({
                color: theme ? theme.wall : 0x001100,
                emissive: theme ? theme.wallEmissive : 0x000800,
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
                    const wallGeometry = new THREE.BoxGeometry(cellSize, h, cellSize);
                    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
                    
                    wall.position.set(
                        startX + col * cellSize,
                        h / 2,
                        startZ + row * cellSize
                    );
                    
                    wall.castShadow = true;
                    wall.receiveShadow = true;
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
        const entranceMaterial = new THREE.MeshLambertMaterial({ color: 0x00ff00, emissive: 0x004400 });
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
        // Start (green)
        const sGeom = new THREE.ConeGeometry(0.7, 2.5, 10);
        const sMat = new THREE.MeshLambertMaterial({ color: 0x00ff88, emissive: 0x003300 });
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
        console.log('Labyrinth layout applied (static).');
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
        const geo = new THREE.SphereGeometry(1, 12, 12);
        const mat = new THREE.MeshLambertMaterial({ color: 0xff3333, emissive: 0x220000 });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, 1, z);
        m.castShadow = true;
        m.userData = {
            type: 'enemy',
            hp: 5,
            hpMax: 5,
            speed: 3 + Math.random() * 2,
            dir: new THREE.Vector2(Math.cos(Math.random()*Math.PI*2), Math.sin(Math.random()*Math.PI*2)),
            changeT: 1 + Math.random() * 2
        };
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
        bar.position.set(0, 2.2, 0);
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
            // Trigger game over
            this.gameOver();
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
    }

    respawnEnemies() {
        this.clearEnemies();
        this.spawnTestEnemies(this.enemyCount);
    }
    
    updateEnemySpawning(deltaTime) {
        // Only spawn continuously in play mode
        if (this.gameMode !== 'play') return;
        
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
        // Raycast to enemies first; if hit, shoot. Else shoot to ground point.
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const canvas = document.getElementById('gameCanvas');
        const rect = canvas.getBoundingClientRect();
        if (this.viewMode === 'fpv') {
            // Always use center of screen in FPV
            mouse.x = 0; mouse.y = 0;
        } else if (this.isPointerLocked) {
            mouse.x = this.playMode.mouseNDC.x;
            mouse.y = this.playMode.mouseNDC.y;
        } else {
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        }
        raycaster.setFromCamera(mouse, this.camera);

        // Intersect enemies
        const enemyIntersects = raycaster.intersectObjects(this.playMode.enemies, false);
        if (enemyIntersects.length > 0) {
            const hit = enemyIntersects[0];
            const origin = this.camera.position.clone();
            let dir;
            if (this.viewMode === 'fpv') {
                dir = hit.point.clone().sub(origin).normalize();
            } else {
                // Isometric/second-person: always fire forward from the character
                dir = new THREE.Vector3(Math.sin(this.characterRotation), 0, Math.cos(this.characterRotation)).normalize();
            }
            this.shootRay(origin, dir);
            return;
        }

        // Intersect ground plane and shoot toward that point (ray in 3D)
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const point = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(groundPlane, point)) {
            const origin = this.camera.position.clone();
            let dir;
            if (this.viewMode === 'fpv') {
                dir = point.clone().sub(origin).normalize();
            } else {
                // Isometric/second-person: always forward
                dir = new THREE.Vector3(Math.sin(this.characterRotation), 0, Math.cos(this.characterRotation)).normalize();
            }
            this.shootRay(origin, dir);
        } else {
            // Above the horizon: fallback
            const origin = this.camera.position.clone();
            let dir;
            if (this.viewMode === 'fpv') {
                // In FPV, shoot along the exact view ray
                dir = raycaster.ray.direction.clone().normalize();
            } else {
                // Isometric/second-person: always forward
                dir = new THREE.Vector3(Math.sin(this.characterRotation), 0, Math.cos(this.characterRotation)).normalize();
            }
            this.shootRay(origin, dir);
        }
    }

    handleMelee(event) {
        // Short-range ray test from center/cursor; damages first enemy hit within range
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(0, 0);
        if (this.viewMode !== 'fpv') {
            // Use current mouse NDC when not FPV
            mouse.x = this.playMode.mouseNDC.x;
            mouse.y = this.playMode.mouseNDC.y;
        }
        raycaster.setFromCamera(mouse, this.camera);
        const origin = this.camera.position.clone();
        const dir = raycaster.ray.direction.clone();
        const maxDist = 2.5;
        // Find closest enemy intersecting the ray within maxDist
        const hits = raycaster.intersectObjects(this.playMode.enemies, false);
        if (hits.length > 0 && hits[0].distance <= maxDist) {
            const e = hits[0].object;
            const weapon = this.getCurrentWeapon();
            const damage = weapon ? weapon.damage : 2; // Use weapon damage or default
            e.userData.hp -= damage;
            this.spawnImpact(hits[0].point.clone(), 0xffaa55);
            if (e.userData.hp <= 0) {
                const idx = this.playMode.enemies.indexOf(e);
                if (idx !== -1) this.playMode.enemies.splice(idx, 1);
                this.playMode.enemiesGroup.remove(e);
            } else {
                // brief flash
                const mat = e.material; const orig = mat.color.getHex();
                mat.color.setHex(0xffffff); setTimeout(()=>mat.color.setHex(orig), 80);
                // Show HP bar for 3 seconds
                this.showEnemyHPBar(e, 3.0);
            }
            return;
        }
        // No direct hit: optional small shove effect at range end
        const endPoint = origin.clone().add(dir.multiplyScalar(maxDist));
        this.spawnImpact(endPoint, 0xcccccc);
    }

    shootAt(targetPos) {
        // Backward compatibility: derive ray from player/camera toward targetPos
        const origin = (this.viewMode === 'fpv') ? this.camera.position.clone() : this.player.position.clone().add(new THREE.Vector3(0,1.2,0));
        const dir = targetPos.clone().sub(origin).normalize();
        this.shootRay(origin, dir);
    }

    shootRay(origin, dir) {
        // Create a projectile traveling along a ray, supports vertical aim
        const projGeo = new THREE.SphereGeometry(0.2, 8, 8);
        const projMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
        const proj = new THREE.Mesh(projGeo, projMat);
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
        proj.position.copy(spawn);
        proj.userData = { dir: dir.clone().normalize(), ttl: 3, radius: 0.2, bounces: 0 };
        this.scene.add(proj);
        this.playMode.projectiles.push(proj);
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
            p.userData.ttl -= deltaTime;
            // Check collision with enemies (simple radius)
            for (let j = this.playMode.enemies.length - 1; j >= 0; j--) {
                const e = this.playMode.enemies[j];
                const d2 = p.position.distanceToSquared(e.position);
                if (d2 < 1.2 * 1.2) {
                    // Hit enemy: apply damage and impact
                    e.userData.hp -= 1;
                    this.spawnImpact(p.position.clone(), 0xff5533);
                    this.scene.remove(p);
                    this.playMode.projectiles.splice(i, 1);
                    if (e.userData.hp <= 0) {
                        const deathPos = e.position.clone();
                        this.playMode.enemiesGroup.remove(e);
                        this.playMode.enemies.splice(j, 1);
                        if (Math.random() < this.dropChance) {
                            this.spawnPickup(deathPos.x, deathPos.z);
                        }
                    } else {
                        // Brief flash on enemy
                        const mat = e.material;
                        const orig = mat.color.getHex();
                        mat.color.setHex(0xffffff);
                        setTimeout(() => mat.color.setHex(orig), 80);
                        // Show HP bar for 3 seconds
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

    // ================= Pickups =================
    spawnPickup(x, z) {
        // Randomize item type
        const types = [
            { type: 'health', label: 'Health +25', color: 0x66ff66 },
            { type: 'speed',  label: 'Speed Boost', color: 0x66ccff },
            { type: 'ammo',   label: 'Ammo +25',   color: 0xffff66 },
            { type: 'jetpack',label: 'Jetpack',    color: 0xffaa66 },
            { type: 'flag',   label: 'Flag Token', color: 0xff66aa }
        ];
        const pick = types[Math.floor(Math.random() * types.length)];
        const geo = new THREE.IcosahedronGeometry(0.35, 0);
        const mat = new THREE.MeshLambertMaterial({ color: pick.color, emissive: 0x112222 });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, 0.6, z);
        m.castShadow = true;
        m.userData = { type: 'pickup', t: 0, item: { type: pick.type, label: pick.label } };
        this.pickupsGroup.add(m);
        this.pickups.push(m);
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
                this.pickupsGroup.remove(p);
                this.pickups.splice(i, 1);
                if (p.userData.item) {
                    this.inventory.items.push(p.userData.item);
                    this.spawnImpact(p.position.clone(), 0x66ffcc);
                    this.showMessage(`Picked up: ${p.userData.item.label}`);
                    this.updateInventoryUI();
                    
                    // Show toast notification for pickup
                    const item = p.userData.item;
                    let toastMessage = '';
                    let emoji = '';
                    
                    switch (item.type) {
                        case 'health':
                            emoji = '❤️';
                            toastMessage = `${emoji} ${this.t('health')} +25`;
                            break;
                        case 'speed':
                            emoji = '⚡';
                            toastMessage = `${emoji} ${this.t('speedBoost')} +1`;
                            break;
                        case 'ammo':
                            emoji = '🔸';
                            toastMessage = `${emoji} ${this.t('ammo')} +25`;
                            break;
                        case 'jetpack':
                            emoji = '🚀';
                            toastMessage = `${emoji} ${this.t('jetpackFuel')} +50`;
                            break;
                        case 'healthRegen':
                            emoji = '💚';
                            toastMessage = `${emoji} ${this.t('healthRegen')} +1`;
                            break;
                        case 'weaponBuff':
                            emoji = '⚔️';
                            toastMessage = `${emoji} ${this.t('weaponBuff')} +1`;
                            break;
                        case 'flag':
                            emoji = '🏁';
                            toastMessage = `${emoji} ${this.t('flag')} +1`;
                            break;
                        default:
                            emoji = '📦';
                            toastMessage = `${emoji} ${item.label}`;
                    }
                    
                    this.showToast(toastMessage, 'success');
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
    
    // ===== Inventory UI and Activation =====
    ensureInventoryUI() {
        let ui = document.getElementById('inventory-ui');
        if (!ui) {
            ui = document.createElement('div');
            ui.id = 'inventory-ui';
            ui.style.position = 'absolute';
            ui.style.left = '50%';
            ui.style.top = '50%';
            ui.style.transform = 'translate(-50%, -50%)';
            ui.style.background = 'rgba(0,0,0,0.9)';
            ui.style.border = '3px solid #00ff00';
            ui.style.borderRadius = '8px';
            ui.style.padding = '16px';
            ui.style.color = '#00ff00';
            ui.style.fontFamily = 'Courier New, monospace';
            ui.style.fontSize = '14px';
            ui.style.zIndex = '3000';
            ui.style.minWidth = '320px';
            ui.style.display = 'none';
            ui.style.boxShadow = '0 0 20px rgba(0,255,0,0.3)';
            document.body.appendChild(ui);
        }
        return ui;
    }

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

    updateInventoryUI() {
        const ui = this.ensureInventoryUI();
        const items = this.inventory.items;
        const sel = this.inventory.selectedIndex;
        
        let html = `
            <div style="margin-bottom:12px; font-weight:bold; text-align:center; font-size:16px;">
                ${this.t('inventory').toUpperCase()}
            </div>
            <div style="margin-bottom:8px; font-size:12px; opacity:0.8; text-align:center;">
                ${this.t('iToClose')} | ${this.t('tabArrowsNavigate')} | ${this.t('enterClickUse')}
            </div>
        `;
        
        // Power-ups section
        const powerUpItems = [
            { type: 'speed', label: this.t('speedBoost'), count: this.powerUps.speedBoost },
            { type: 'healthRegen', label: this.t('healthRegen'), count: this.powerUps.healthRegen },
            { type: 'weaponBuff', label: this.t('weaponBuff'), count: this.powerUps.weaponBuff },
            { type: 'jetpack', label: this.t('jetpackFuel'), count: Math.floor(this.powerUps.jetpackFuel) }
        ].filter(item => item.count > 0);
        
        if (powerUpItems.length > 0) {
            html += `
                <div style="margin-bottom: 12px;">
                    <div style="font-weight: bold; color: #00ff00; margin-bottom: 8px; text-align: center;">
                        ${this.t('powerUps').toUpperCase()}
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px;">
            `;
            powerUpItems.forEach(item => {
                const icon = this.createItemIcon(item.type, 24);
                html += `
                    <div style="
                        background: rgba(0,255,0,0.1); 
                        border: 1px solid #00ff00; 
                        border-radius: 4px; 
                        padding: 6px; 
                        text-align: center;
                    ">
                        <img src="${icon}" 
                             style="
                                 width: 24px; 
                                 height: 24px; 
                                 image-rendering: pixelated;
                                 margin-bottom: 2px;
                             " />
                        <div style="font-size: 10px; font-weight: bold;">${item.label}</div>
                        <div style="font-size: 9px; opacity: 0.8;">${item.count} ${this.t('stacks')}</div>
                    </div>
                `;
            });
            html += '</div></div>';
        }
        
        // Regular items section
        if (!items.length) {
            html += `<div style="text-align:center; padding:20px; opacity:0.6;">(${this.t('empty')})</div>`;
        } else {
            html += `
                <div style="margin-bottom: 12px;">
                    <div style="font-weight: bold; color: #00aaff; margin-bottom: 8px; text-align: center;">
                        ${this.t('items').toUpperCase()}
                    </div>
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:8px; max-height:300px; overflow-y:auto;">
            `;
            items.forEach((it, idx) => {
                const isSelected = idx === sel;
                const icon = this.createItemIcon(it.type, 32);
                const borderColor = isSelected ? '#00ff00' : '#004400';
                const bgColor = isSelected ? 'rgba(0,255,0,0.2)' : 'rgba(0,255,0,0.05)';
                
                html += `
                    <div class="inventory-item" 
                         data-index="${idx}"
                         style="
                             border: 2px solid ${borderColor};
                             background: ${bgColor};
                             padding: 8px;
                             border-radius: 4px;
                             cursor: pointer;
                             transition: all 0.2s;
                             text-align: center;
                         "
                         onmouseover="this.style.background='rgba(0,255,0,0.15)'"
                         onmouseout="this.style.background='${bgColor}'"
                         onclick="game.selectInventoryItem(${idx}); game.activateSelectedItem();">
                        <img src="${icon}" 
                             style="
                                 width: 32px; 
                                 height: 32px; 
                                 image-rendering: pixelated;
                                 margin-bottom: 4px;
                             " />
                        <div style="font-size: 12px; font-weight: bold;">${it.label}</div>
                    </div>
                `;
            });
            html += '</div></div>';
        }
        
        // Stats line
        const jetpackStatus = this.isJetpackActive ? 
            ` | ${this.t('jetpack')}: ${Math.round(this.inventory.jetpackFuel)}/${this.inventory.maxJetpackFuel}` : '';
        const playerHpColor = this.player.hp < this.player.maxHp * 0.3 ? '#ff6666' : 
                             this.player.hp < this.player.maxHp * 0.6 ? '#ffff66' : '#66ff66';
        html += `
            <div style="
                margin-top: 12px; 
                padding: 8px; 
                background: rgba(0,255,0,0.1); 
                border-radius: 4px; 
                font-size: 12px; 
                text-align: center;
            ">
                <span style="color: ${playerHpColor};">${this.t('playerHp')}: ${this.player.hp}/${this.player.maxHp}</span> | 
                ${this.t('health')}: ${this.inventory.health}/${this.inventory.maxHealth} | 
                ${this.t('ammo')}: ${this.inventory.ammo} | 
                ${this.t('flags')}: ${this.inventory.flags}${jetpackStatus}
            </div>
        `;
        
        ui.innerHTML = html;
        
        // Add click handlers for items
        ui.querySelectorAll('.inventory-item').forEach((item, idx) => {
            item.addEventListener('click', () => {
                this.selectInventoryItem(idx);
                this.activateSelectedItem();
            });
        });
    }

    toggleInventory() {
        const ui = this.ensureInventoryUI();
        if (ui.style.display === 'none') {
            this.updateInventoryUI();
            ui.style.display = 'block';
            this.modalOpen = true; // pause pointer lock interactions
        } else {
            ui.style.display = 'none';
            this.modalOpen = false;
        }
    }

    selectInventory(delta) {
        if (!this.inventory.items.length) return;
        const n = this.inventory.items.length;
        this.inventory.selectedIndex = (this.inventory.selectedIndex + delta + n) % n;
        this.updateInventoryUI();
    }

    selectInventoryItem(index) {
        if (!this.inventory.items.length || index < 0 || index >= this.inventory.items.length) return;
        this.inventory.selectedIndex = index;
        this.updateInventoryUI();
    }

    activateSelectedItem() {
        const items = this.inventory.items;
        const idx = this.inventory.selectedIndex;
        if (!items.length || idx < 0 || idx >= items.length) return;
        const it = items[idx];
        switch (it.type) {
            case 'health':
                this.inventory.health = Math.min(this.inventory.maxHealth, this.inventory.health + 25);
                this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
                this.showMessage(`${this.t('healedTo')} ${this.inventory.health} | ${this.t('playerHp')}: ${this.player.hp}`);
                this.showToast(`❤️ ${this.t('health')} +25`, 'success');
                break;
            case 'speed':
                this.powerUps.speedBoost += 1; // Stack speed boost
                this.showMessage(`${this.t('speedBoost')} +1 (${this.powerUps.speedBoost} ${this.t('stacks')})`);
                this.showToast(`⚡ ${this.t('speedBoost')} +1`, 'success');
                break;
            case 'ammo':
                this.inventory.ammo += 25;
                this.showMessage(`${this.t('ammoCount')}: ${this.inventory.ammo}`);
                // Immediately update HUD to show new ammo count
                this.updateWeaponPowerUpUI();
                this.showToast(`🔸 ${this.t('ammo')} +25`, 'success');
                break;
            case 'jetpack':
                this.powerUps.jetpackFuel += 50; // Stack jetpack fuel
                this.showMessage(`${this.t('jetpackFuel')} +50 (${this.powerUps.jetpackFuel} total)`);
                this.showToast(`🚀 ${this.t('jetpackFuel')} +50`, 'success');
                break;
            case 'healthRegen':
                this.powerUps.healthRegen += 1; // Stack health regeneration
                this.showMessage(`${this.t('healthRegen')} +1 (${this.powerUps.healthRegen} ${this.t('stacks')})`);
                this.showToast(`💚 ${this.t('healthRegen')} +1`, 'success');
                break;
            case 'weaponBuff':
                this.powerUps.weaponBuff += 1; // Stack weapon buff
                this.showMessage(`${this.t('weaponBuff')} +1 (${this.powerUps.weaponBuff} ${this.t('stacks')})`);
                this.showToast(`⚔️ ${this.t('weaponBuff')} +1`, 'success');
                break;
            case 'flag':
                this.inventory.flags += 1;
                this.showMessage(`${this.t('flagsCount')}: ${this.inventory.flags} - Press F to place`);
                this.showToast(`🏁 ${this.t('flag')} +1`, 'success');
                this.updateControlsUI();
                break;
        }
        // Remove used item
        items.splice(idx, 1);
        if (this.inventory.selectedIndex >= items.length) this.inventory.selectedIndex = Math.max(0, items.length - 1);
        this.updateInventoryUI();
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
        this.updateInventoryUI();
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
        this.updateInventoryUI();
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
        // Safeguard: if themes not defined, skip
        if (!this.themes || !this.themes[name]) return;
        this.themeName = name;
        const t = this.themes[name];
        // Ground
        if (this.ground && this.ground.material) {
            this.ground.material.color.setHex(t.ground);
        }
        // Grid
        if (this.gridHelper && this.gridHelper.material) {
            if (this.gridHelper.material.color) this.gridHelper.material.color.setHex(t.grid);
        }
        // Sky
        if (this.sky && this.sky.material) {
            this.sky.material.color.setHex(t.sky);
        }
        // Lights (only if assigned in setupLighting)
        if (this.ambientLight) this.ambientLight.color.setHex(t.ambient);
        if (this.directionalLight) this.directionalLight.color.setHex(t.sun);
        // Themed wall material (shared)
        this.materials = this.materials || {};
        this.materials.wall = new THREE.MeshLambertMaterial({
            color: t.wall,
            emissive: t.wallEmissive,
            transparent: true,
            opacity: 0.95
        });
        // Rebuild walls if already present to apply new material
        if (this.walls && this.walls.length) {
            this.rebuildMaze();
        }
        // Reflect active button state in modal if open
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === name);
        });
    }
    
    setupLighting() {
        // Ambient light
        // Increased overall brightness by ~50%
        const ambientLight = new THREE.AmbientLight(0x001122, 0.45);
        this.scene.add(ambientLight);
        this.ambientLight = ambientLight;
        
        // Directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0x00ff88, 1.2);
        directionalLight.position.set(50, 50, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        directionalLight.shadow.camera.left = -100;
        directionalLight.shadow.camera.right = 100;
        directionalLight.shadow.camera.top = 100;
        directionalLight.shadow.camera.bottom = -100;
        this.scene.add(directionalLight);
        this.directionalLight = directionalLight;
        
        // Point lights for 128-bit effect
        for (let i = 0; i < 5; i++) {
            const pointLight = new THREE.PointLight(
                new THREE.Color().setHSL(Math.random(), 1, 0.8),
                1.5,
                30
            );
            pointLight.position.set(
                (Math.random() - 0.5) * 100,
                Math.random() * 20 + 5,
                (Math.random() - 0.5) * 100
            );
            this.scene.add(pointLight);
        }
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
                console.log('V key detected in keydown handler');
            }
            
            // Comprehensive input blocking system
            if (this.shouldBlockInput(event)) {
                console.log(`Input blocked for key: ${event.code}`);
                return;
            }
            
            // Track SHIFT key for create mode
            if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
                if (this.gameMode === 'create') {
                    this.createMode.isShiftHeld = true;
                }
            }
            
            // Control scheme switching
            if (event.code === 'Digit1') {
                this.setControlScheme(1);
            }
            if (event.code === 'Digit3') {
                this.setControlScheme(3);
            }
            
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
            
            // Toggle control panel with H key
            if (event.code === 'KeyH') {
                this.showControlsUI = !this.showControlsUI;
                this.updateControlsUI();
                this.showMessage(this.showControlsUI ? 'Control panel shown' : 'Control panel hidden');
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

            // Cycle through all view modes: iso -> fpv -> birds-eye -> ghost -> iso
            if (event.code === 'KeyV' && !event.repeat) {
                console.log(`V key pressed, current viewMode: ${this.viewMode}, gameMode: ${this.gameMode}`);
                if (this.viewMode === 'iso') {
                    console.log('Switching to FPV');
                    this.setViewMode('fpv');
                } else if (this.viewMode === 'fpv') {
                    console.log('Switching to birds-eye');
                    this.setViewMode('birds-eye');
                } else if (this.viewMode === 'birds-eye') {
                    console.log('Switching to ghost');
                    this.setViewMode('ghost');
                } else if (this.viewMode === 'ghost') {
                    console.log('Switching to iso');
                    this.setViewMode('iso');
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
                console.log('Model yaw offset (deg):', Math.round(this.modelYawOffset * 180 / Math.PI));
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
                    console.log('Crosshair forced visible for testing');
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
                console.log('Resetting camera and player position');
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
                console.log('Model yaw offset (deg):', Math.round(this.modelYawOffset * 180 / Math.PI));
            }
            if (event.code === 'KeyU') {
                // Rotate model yaw offset -90°
                this.modelYawOffset = (this.modelYawOffset - Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
                console.log('Model yaw offset (deg):', Math.round(this.modelYawOffset * 180 / Math.PI));
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
            if (this.gameMode === 'create' && !this.modalOpen) {
                this.handleCreateModeClick(event);
            } else if (this.gameMode === 'play' && !this.modalOpen) {
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
            if (this.gameMode === 'play' && !this.modalOpen && event.button === 2) {
                if (!this.isPointerLocked) {
                    document.body.requestPointerLock();
                    return;
                }
                this.handleMelee(event);
            }
        });
        
        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement === document.body;
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
        
        // Jumping (only if jetpack not active)
        if (this.keys['Space'] && this.player.onGround && !this.isJetpackActive) {
            this.player.velocity.y = jumpForce;
            this.player.onGround = false;
        }
        
        // Jetpack activation (when Space is pressed and player has fuel)
        if (this.keys['Space'] && this.powerUps.jetpackFuel > 0 && !this.isJetpackActive) {
            this.isJetpackActive = true;
            this.showMessage(this.t('jetpackOnline'));
        }
        
        // Jetpack deactivation (when Space is released)
        if (!this.keys['Space'] && this.isJetpackActive) {
            this.isJetpackActive = false;
        }
        
        // Apply gravity first
        this.player.velocity.y += gravity * deltaTime;
        
        // Jetpack controls (override gravity when active)
        if (this.isJetpackActive && this.powerUps.jetpackFuel > 0) {
            const jetpackForce = 40; // Increased force to overcome gravity
            const fuelConsumption = 15; // per second
            
            if (this.keys['Space']) {
                // Apply upward thrust (stronger than gravity)
                this.player.velocity.y += jetpackForce * deltaTime;
                this.powerUps.jetpackFuel -= fuelConsumption * deltaTime;
                this.jetpackThrust = Math.min(this.jetpackThrust + deltaTime * 3, 1);
                
                // Create jetpack particles
                this.createJetpackParticles();
                
                // Debug logging
                if (Math.random() < 0.01) { // Log occasionally to avoid spam
                    console.log('Jetpack thrust! Fuel:', Math.round(this.powerUps.jetpackFuel), 'Velocity Y:', this.player.velocity.y);
                }
            } else {
                this.jetpackThrust = Math.max(this.jetpackThrust - deltaTime * 2, 0);
            }
            
            // Check if fuel is depleted
            if (this.powerUps.jetpackFuel <= 0) {
                this.powerUps.jetpackFuel = 0;
                this.isJetpackActive = false;
                this.showMessage(this.t('jetpackDepleted'));
            }
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
        
        // Check for level completion
        this.checkLevelCompletion();
        
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
        console.log(`Control Scheme: ${scheme}`);
    }
    
    
    cycleCameraAngle() {
        // Cycle through fixed camera angles: 0°, 90°, 180°, 270°
        this.currentCameraAngle = (this.currentCameraAngle + 90) % 360;
        console.log(`Camera angle: ${this.currentCameraAngle}°`);
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
    
    checkCollision(position) {
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
            const cameraDistance = 15;
            const cameraHeight = 8;
            
            const cameraX = this.player.position.x + Math.sin(angleRad) * cameraDistance;
            const cameraZ = this.player.position.z + Math.cos(angleRad) * cameraDistance;
            const cameraY = this.player.position.y + cameraHeight;
            
            this.camera.position.set(cameraX, cameraY, cameraZ);
            this.camera.lookAt(this.player.position);
        }
    }
    
    updateCharacterAnimation(deltaTime) {
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
        
        // Clamp deltaTime to prevent spiral of death
        const clampedDeltaTime = Math.min(deltaTime, Game3D.MAX_FRAME_TIME);
        
        // Accumulate time for fixed timestep
        this.accumulator = (this.accumulator || 0) + clampedDeltaTime;
        
        // Run fixed timestep simulation
        while (this.accumulator >= Game3D.FIXED_TIMESTEP) {
            this.fixedUpdate(Game3D.FIXED_TIMESTEP);
            this.accumulator -= Game3D.FIXED_TIMESTEP;
        }
        
        // Render at display refresh rate
        this.render();
    }
    
    fixedUpdate(deltaTime) {
        // All game logic goes here - runs at fixed 60 FPS
        this.updatePlayer(deltaTime);
        
        // Update projectiles and other play-mode systems
        if (this.gameMode === 'play') {
            this.updateProjectiles(deltaTime);
            this.updateEnemies(deltaTime);
            this.updatePickups(deltaTime);
            this.updateJetpackParticles(deltaTime);
            this.updateEnemySpawning(deltaTime);
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
        // this.updateInventoryGridUI(); // Hidden for now
        this.updateToasts();
        
        // Emit UI update for new HUD system
        this.emit('ui:update', this.buildHUDModel());
        
        // Render the scene
        this.renderer.render(this.scene, this.camera);
    }

    updateObjectives() {
        const cur = this.savedMazes[this.currentMazeIndex];
        if (!cur || cur.type !== 'labyrinth') return;
        if (!this.levelStartWorld || !this.levelEndWorld) return;
        const p = this.player.position;
        const atStart = p.distanceToSquared(this.levelStartWorld) < 2.0;
        const atEnd = p.distanceToSquared(this.levelEndWorld) < 2.0;
        if (atEnd) this.showMessage('Exit reached!');
        if (atStart && (this.hasLeftStartOnce || false)) this.showMessage('Back at start');
        if (!atStart) this.hasLeftStartOnce = true;
    }
    
    
    
    clearAllUI() {
        // Remove ALL possible UI elements (except modals, inventory, and crosshair)
        const allUIElements = [
            // Old HUD elements
            'player-hp-hud', 'weapon-hud', 'top-center-ui', 
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
            const style = window.getComputedStyle(div);
            if ((style.position === 'absolute' || style.position === 'fixed') && 
                (style.top === '20px' || style.top === '10px' || style.top === '0px' || style.top === '50%') &&
                (style.right === '20px' || style.right === '10px' || style.right === '0px' || style.left === '50%')) {
                // Check if it's not one of our protected UI elements
                if (!div.id || (!div.id.includes('health-ui') && 
                    !div.id.includes('compass-ui') && 
                    !div.id.includes('weapon-powerup-ui') &&
                    !div.id.includes('settings-modal') &&
                    !div.id.includes('toolbox-modal') &&
                    !div.id.includes('inventory-ui') &&
                    !div.id.includes('crosshair'))) {
                    div.remove();
                }
            }
        });
    }

    updateHealthUI() {
        // Only show in play mode
        if (this.gameMode !== 'play') {
            return;
        }
        
        // Create or update health UI (top right)
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
        const hpColor = hpPercent > 60 ? '#00ff00' : hpPercent > 30 ? '#ffff00' : '#ff6666';
        
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
    
    updateWeaponPowerUpUI() {
        // Only show in play mode
        if (this.gameMode !== 'play') {
            return;
        }
        
        const currentWeapon = this.getCurrentWeapon();
        if (!currentWeapon) return;
        
        // Create or update weapon and power-up UI (bottom left)
        let hud = document.getElementById('weapon-powerup-ui');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'weapon-powerup-ui';
            hud.style.position = 'absolute';
            hud.style.bottom = '20px';
            hud.style.left = '20px';
            hud.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.9), rgba(0,20,40,0.9))';
            hud.style.border = '2px solid #00aaff';
            hud.style.borderRadius = '12px';
            hud.style.padding = '16px 20px';
            hud.style.color = '#00aaff';
            hud.style.fontFamily = 'Courier New, monospace';
            hud.style.fontSize = '14px';
            hud.style.fontWeight = 'bold';
            hud.style.zIndex = '1000';
            hud.style.minWidth = '280px';
            hud.style.boxShadow = '0 4px 20px rgba(0,170,255,0.3)';
            document.body.appendChild(hud);
        }
        
        // Weapon stats
        const weaponStats = [];
        weaponStats.push(`DMG: ${currentWeapon.damage}`);
        weaponStats.push(`RNG: ${currentWeapon.range}`);
        weaponStats.push(`CD: ${currentWeapon.cooldown}s`);
        if (currentWeapon.ammoCost > 0) {
            weaponStats.push(`AMMO: ${currentWeapon.ammoCost}`);
        }
        
        // Ammo count
        const ammoCount = this.inventory.ammo || 0;
        let ammoStatus, ammoColor;
        if (this.isReloading) {
            ammoStatus = 'RELOADING...';
            ammoColor = '#ffaa00';
        } else if (ammoCount > 0) {
            ammoStatus = `${ammoCount}`;
            ammoColor = '#00ff00';
        } else {
            ammoStatus = 'NO AMMO';
            ammoColor = '#ff4444';
        }
        
        // Active power-ups
        const activePowerUps = [];
        if (this.powerUps.speedBoost > 0) {
            activePowerUps.push(`⚡ ${this.t('speedBoost')} (${this.powerUps.speedBoost})`);
        }
        if (this.powerUps.healthRegen > 0) {
            activePowerUps.push(`❤️ ${this.t('healthRegen')} (${this.powerUps.healthRegen})`);
        }
        if (this.powerUps.weaponBuff > 0) {
            activePowerUps.push(`⚔️ ${this.t('weaponBuff')} (${this.powerUps.weaponBuff})`);
        }
        if (this.powerUps.jetpackFuel > 0) {
            activePowerUps.push(`🚀 ${this.t('jetpackFuel')} (${Math.floor(this.powerUps.jetpackFuel)})`);
        }
        
        // Weapon cooldown indicator
        const cooldown = this.weaponCooldowns[currentWeapon.name] || 0;
        const cooldownPercent = Math.max(0, (cooldown / currentWeapon.cooldown) * 100);
        const cooldownColor = cooldown > 0 ? '#ff4444' : '#00ff00';
        
        hud.innerHTML = `
            <div style="margin-bottom: 16px;">
                <div style="text-align: center; margin-bottom: 8px; font-size: 12px; opacity: 0.8; letter-spacing: 1px;">${this.t('currentWeapon').toUpperCase()}</div>
                <div style="text-align: center; font-size: 20px; color: #00aaff; margin-bottom: 4px;">${currentWeapon.icon} ${currentWeapon.name}</div>
                <div style="text-align: center; font-size: 11px; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">${currentWeapon.type}</div>
                
                <!-- Weapon Stats -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 8px; font-size: 11px;">
                    ${weaponStats.map(stat => `<div style="text-align: center; padding: 2px 4px; background: rgba(0,170,255,0.1); border-radius: 4px;">${stat}</div>`).join('')}
                </div>
                
                <!-- Ammo Status -->
                <div style="text-align: center; margin-bottom: 8px;">
                    <div style="font-size: 12px; opacity: 0.8; margin-bottom: 2px;">AMMO</div>
                    <div style="font-size: 16px; color: ${ammoColor}; font-weight: bold;">${ammoStatus}</div>
                </div>
                
                <!-- Cooldown/Reload Bar -->
                <div style="margin-bottom: 8px;">
                    <div style="font-size: 10px; opacity: 0.7; margin-bottom: 2px; text-align: center;">
                        ${this.isReloading ? 'RELOADING' : 'READY'}
                    </div>
                    <div style="width: 100%; height: 4px; background: rgba(0,0,0,0.5); border-radius: 2px; overflow: hidden;">
                        ${this.isReloading ? `
                            <div style="width: ${((2.0 - this.reloadTime) / 2.0) * 100}%; height: 100%; background: #ffaa00; transition: width 0.1s;"></div>
                        ` : `
                            <div style="width: ${100 - cooldownPercent}%; height: 100%; background: ${cooldownColor}; transition: width 0.1s;"></div>
                        `}
                    </div>
                </div>
            </div>
            
            ${activePowerUps.length > 0 ? `
                <div style="border-top: 1px solid rgba(0,170,255,0.3); padding-top: 12px;">
                    <div style="text-align: center; margin-bottom: 8px; font-size: 12px; opacity: 0.8; letter-spacing: 1px;">${this.t('active')} ${this.t('powerUps')}</div>
                    <div style="font-size: 12px; line-height: 1.6;">
                        ${activePowerUps.map(powerup => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 2px 0; border-bottom: 1px solid rgba(0,170,255,0.1);">
                                <span>${powerup.split(' (')[0]}</span>
                                <span style="opacity: 0.7;">${powerup.split(' (')[1]?.replace(')', '') || ''}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        `;
        hud.style.display = 'block';
    }
    
    // ===== New HUD System with Cached DOM References =====
    
    mountHUD() {
        // Create and cache DOM references for weapon HUD
        this.hudElements = {};
        
        // Create weapon HUD container
        const hud = document.createElement('div');
        hud.id = 'weapon-hud';
        hud.style.position = 'absolute';
        hud.style.bottom = '20px';
        hud.style.left = '20px';
        hud.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.9), rgba(0,20,40,0.9))';
        hud.style.border = '2px solid #00aaff';
        hud.style.borderRadius = '12px';
        hud.style.padding = '16px 20px';
        hud.style.color = '#00aaff';
        hud.style.fontFamily = 'Courier New, monospace';
        hud.style.fontSize = '14px';
        hud.style.fontWeight = 'bold';
        hud.style.zIndex = '1000';
        hud.style.minWidth = '280px';
        hud.style.boxShadow = '0 4px 20px rgba(0,170,255,0.3)';
        hud.style.display = 'none';
        document.body.appendChild(hud);
        
        this.hudElements.container = hud;
        this.hudElements.weaponName = document.createElement('div');
        this.hudElements.weaponType = document.createElement('div');
        this.hudElements.weaponStats = document.createElement('div');
        this.hudElements.ammoStatus = document.createElement('div');
        this.hudElements.cooldownBar = document.createElement('div');
        this.hudElements.powerUps = document.createElement('div');
        
        // Set up initial structure
        hud.innerHTML = `
            <div class="weapon-header">
                <div class="weapon-title"></div>
                <div class="weapon-name"></div>
                <div class="weapon-type"></div>
            </div>
            <div class="weapon-stats"></div>
            <div class="ammo-section">
                <div class="ammo-label">AMMO</div>
                <div class="ammo-status"></div>
            </div>
            <div class="cooldown-section">
                <div class="cooldown-label"></div>
                <div class="cooldown-bar"></div>
            </div>
            <div class="powerups-section"></div>
        `;
        
        // Cache references to the actual elements
        this.hudElements.weaponTitle = hud.querySelector('.weapon-title');
        this.hudElements.weaponName = hud.querySelector('.weapon-name');
        this.hudElements.weaponType = hud.querySelector('.weapon-type');
        this.hudElements.weaponStats = hud.querySelector('.weapon-stats');
        this.hudElements.ammoStatus = hud.querySelector('.ammo-status');
        this.hudElements.cooldownLabel = hud.querySelector('.cooldown-label');
        this.hudElements.cooldownBar = hud.querySelector('.cooldown-bar');
        this.hudElements.powerUps = hud.querySelector('.powerups-section');
        
        // Add CSS styles
        const style = document.createElement('style');
        style.textContent = `
            .weapon-header { margin-bottom: 16px; }
            .weapon-title { text-align: center; margin-bottom: 8px; font-size: 12px; opacity: 0.8; letter-spacing: 1px; }
            .weapon-name { text-align: center; font-size: 20px; color: #00aaff; margin-bottom: 4px; }
            .weapon-type { text-align: center; font-size: 11px; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
            .weapon-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 8px; font-size: 11px; }
            .stat-item { text-align: center; padding: 2px 4px; background: rgba(0,170,255,0.1); border-radius: 4px; }
            .ammo-section { text-align: center; margin-bottom: 8px; }
            .ammo-label { font-size: 12px; opacity: 0.8; margin-bottom: 2px; }
            .ammo-status { font-size: 16px; font-weight: bold; }
            .cooldown-section { margin-bottom: 8px; }
            .cooldown-label { font-size: 10px; opacity: 0.7; margin-bottom: 2px; text-align: center; }
            .cooldown-bar { width: 100%; height: 4px; background: rgba(0,0,0,0.5); border-radius: 2px; overflow: hidden; }
            .cooldown-fill { height: 100%; transition: width 0.1s; }
            .powerups-section { border-top: 1px solid rgba(0,170,255,0.3); padding-top: 12px; }
            .powerup-item { display: flex; justify-content: space-between; align-items: center; padding: 2px 0; border-bottom: 1px solid rgba(0,170,255,0.1); font-size: 12px; line-height: 1.6; }
        `;
        document.head.appendChild(style);
        
        // Set up event listener for UI updates
        this.on('ui:update', (model) => {
            this.renderHUD(model);
        });
    }
    
    renderHUD(model) {
        if (!model || !this.hudElements.container) return;
        
        // Only show in play mode
        if (model.gameMode !== 'play') {
            this.hudElements.container.style.display = 'none';
            return;
        }
        
        this.hudElements.container.style.display = 'block';
        
        // Update weapon info
        this.hudElements.weaponTitle.textContent = this.t('currentWeapon').toUpperCase();
        this.hudElements.weaponName.textContent = `${model.weapon.icon} ${model.weapon.name}`;
        this.hudElements.weaponType.textContent = model.weapon.type;
        
        // Update weapon stats
        const weaponStats = [];
        weaponStats.push(`DMG: ${model.weapon.damage}`);
        weaponStats.push(`RNG: ${model.weapon.range}`);
        weaponStats.push(`CD: ${model.weapon.cooldown}s`);
        if (model.weapon.ammoCost > 0) {
            weaponStats.push(`AMMO: ${model.weapon.ammoCost}`);
        }
        
        this.hudElements.weaponStats.innerHTML = weaponStats.map(stat => 
            `<div class="stat-item">${stat}</div>`
        ).join('');
        
        // Update ammo status
        let ammoStatus, ammoColor;
        if (model.isReloading) {
            ammoStatus = 'RELOADING...';
            ammoColor = '#ffaa00';
        } else if (model.ammoCount > 0) {
            ammoStatus = `${model.ammoCount}`;
            ammoColor = '#00ff00';
        } else {
            ammoStatus = 'NO AMMO';
            ammoColor = '#ff4444';
        }
        
        this.hudElements.ammoStatus.textContent = ammoStatus;
        this.hudElements.ammoStatus.style.color = ammoColor;
        
        // Update cooldown bar
        this.hudElements.cooldownLabel.textContent = model.isReloading ? 'RELOADING' : 'READY';
        
        const cooldownFill = this.hudElements.cooldownBar.querySelector('.cooldown-fill') || 
            (() => {
                const fill = document.createElement('div');
                fill.className = 'cooldown-fill';
                this.hudElements.cooldownBar.appendChild(fill);
                return fill;
            })();
        
        if (model.isReloading) {
            cooldownFill.style.width = `${model.reloadProgress * 100}%`;
            cooldownFill.style.background = '#ffaa00';
        } else {
            cooldownFill.style.width = `${100 - model.cooldownPercent}%`;
            cooldownFill.style.background = model.cooldown > 0 ? '#ff4444' : '#00ff00';
        }
        
        // Update power-ups
        const activePowerUps = [];
        if (model.powerUps.speedBoost > 0) {
            activePowerUps.push(`⚡ ${this.t('speedBoost')} (${model.powerUps.speedBoost})`);
        }
        if (model.powerUps.healthRegen > 0) {
            activePowerUps.push(`❤️ ${this.t('healthRegen')} (${model.powerUps.healthRegen})`);
        }
        if (model.powerUps.weaponBuff > 0) {
            activePowerUps.push(`⚔️ ${this.t('weaponBuff')} (${model.powerUps.weaponBuff})`);
        }
        if (model.powerUps.jetpackFuel > 0) {
            activePowerUps.push(`🚀 ${this.t('jetpackFuel')} (${model.powerUps.jetpackFuel})`);
        }
        
        if (activePowerUps.length > 0) {
            this.hudElements.powerUps.innerHTML = `
                <div style="text-align: center; margin-bottom: 8px; font-size: 12px; opacity: 0.8; letter-spacing: 1px;">${this.t('active')} ${this.t('powerUps')}</div>
                ${activePowerUps.map(powerup => `
                    <div class="powerup-item">
                        <span>${powerup.split(' (')[0]}</span>
                        <span style="opacity: 0.7;">${powerup.split(' (')[1]?.replace(')', '') || ''}</span>
                    </div>
                `).join('')}
            `;
        } else {
            this.hudElements.powerUps.innerHTML = '';
        }
    }
    
    updateControlsUI() {
        // Only show in play mode
        if (this.gameMode !== 'play') {
            return;
        }
        
        // Check if control panel should be visible
        if (!this.showControlsUI) {
            const hud = document.getElementById('controls-ui');
            if (hud) {
                hud.style.display = 'none';
            }
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
            hud.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.9), rgba(0,20,40,0.9))';
            hud.style.border = '2px solid #00aaff';
            hud.style.borderRadius = '12px';
            hud.style.padding = '16px 20px';
            hud.style.color = '#00aaff';
            hud.style.fontFamily = 'Courier New, monospace';
            hud.style.fontSize = '12px';
            hud.style.fontWeight = 'bold';
            hud.style.zIndex = '1000';
            hud.style.minWidth = '280px';
            hud.style.boxShadow = '0 4px 20px rgba(0,170,255,0.3)';
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
            'Space - Jump/Fly'
        ];
        
        // Weapon controls
        const weaponControls = [
            'Left Click - Fire',
            'Mouse Wheel - Switch Weapon',
            'R - Reload',
            '1-3 - Select Weapon'
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
            'H - Toggle Controls',
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
            specialStates.push('🚀 Jetpack Active');
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
                <div style="border-top: 1px solid rgba(0,170,255,0.3); padding-top: 8px;">
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
            return;
        }
        
        // Create or update inventory grid UI (bottom center)
        let hud = document.getElementById('inventory-grid-ui');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'inventory-grid-ui';
            hud.style.position = 'absolute';
            hud.style.bottom = '20px';
            hud.style.left = '50%';
            hud.style.transform = 'translateX(-50%)';
            hud.style.display = 'flex';
            hud.style.gap = '4px';
            hud.style.zIndex = '1000';
            document.body.appendChild(hud);
        }
        
        // Use saved quickbar layout
        const quickbarLayout = this.quickbarLayout || ['diamondSword', 'gun', 'machineGun', 'health', 'ammo', 'jetpack', 'speed', 'healthRegen', 'weaponBuff'];
        
        // Item definitions
        const itemDefinitions = {
            'diamondSword': { type: 'weapon', icon: '⚔️', name: 'Diamond Sword' },
            'gun': { type: 'weapon', icon: '🔫', name: 'Gun' },
            'machineGun': { type: 'weapon', icon: '🔫', name: 'Machine Gun' },
            'health': { type: 'item', icon: '❤️', name: 'Health' },
            'ammo': { type: 'item', icon: '🔸', name: 'Ammo' },
            'jetpack': { type: 'item', icon: '🚀', name: 'Jetpack' },
            'speed': { type: 'item', icon: '⚡', name: 'Speed Boost' },
            'healthRegen': { type: 'item', icon: '💚', name: 'Health Regen' },
            'weaponBuff': { type: 'item', icon: '⚔️', name: 'Weapon Buff' }
        };
        
        // Create grid items from quickbar layout
        const gridItems = quickbarLayout.map((itemId, index) => {
            const def = itemDefinitions[itemId] || { type: 'item', icon: '?', name: 'Unknown' };
            return {
                id: itemId,
                type: def.type,
                shortcut: (index + 1).toString(),
                icon: def.icon,
                name: def.name
            };
        });
        
        // Clear existing grid
        hud.innerHTML = '';
        
        // Create grid items
        gridItems.forEach((item, index) => {
            const gridItem = document.createElement('div');
            gridItem.className = 'inventory-grid-item';
            gridItem.style.width = '50px';
            gridItem.style.height = '50px';
            gridItem.style.border = '2px solid #00aaff';
            gridItem.style.borderRadius = '8px';
            gridItem.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.8), rgba(0,20,40,0.8))';
            gridItem.style.display = 'flex';
            gridItem.style.alignItems = 'center';
            gridItem.style.justifyContent = 'center';
            gridItem.style.position = 'relative';
            gridItem.style.cursor = 'pointer';
            gridItem.style.transition = 'all 0.2s ease';
            gridItem.draggable = true;
            
            // Check if item is available in inventory
            let isAvailable = false;
            let isSelected = false;
            
            if (item.type === 'weapon') {
                isAvailable = this.player.weapons.includes(item.id);
                isSelected = this.player.weapons[this.player.currentWeaponIndex] === item.id;
            } else {
                // Check if item is in inventory or power-up is active
                if (item.id === 'health') {
                    isAvailable = this.inventory.health > 0;
                } else if (item.id === 'ammo') {
                    isAvailable = this.inventory.ammo > 0;
                } else if (item.id === 'jetpack') {
                    isAvailable = this.powerUps.jetpackFuel > 0;
                } else if (item.id === 'speed') {
                    isAvailable = this.powerUps.speedBoost > 0;
                } else if (item.id === 'healthRegen') {
                    isAvailable = this.powerUps.healthRegen > 0;
                } else if (item.id === 'weaponBuff') {
                    isAvailable = this.powerUps.weaponBuff > 0;
                }
            }
            
            // Apply visual states
            if (!isAvailable) {
                gridItem.style.opacity = '0.3';
                gridItem.style.filter = 'grayscale(100%)';
            } else {
                gridItem.style.opacity = '1';
                gridItem.style.filter = 'none';
            }
            
            if (isSelected) {
                gridItem.style.border = '3px solid #ff6600';
                gridItem.style.boxShadow = '0 0 10px rgba(255,102,0,0.5)';
            } else {
                gridItem.style.border = '2px solid #00aaff';
                gridItem.style.boxShadow = 'none';
            }
            
            // Add hover effect
            gridItem.addEventListener('mouseenter', () => {
                if (isAvailable) {
                    gridItem.style.transform = 'scale(1.1)';
                    gridItem.style.background = 'linear-gradient(135deg, rgba(0,170,255,0.3), rgba(0,40,80,0.3))';
                }
            });
            
            gridItem.addEventListener('mouseleave', () => {
                gridItem.style.transform = 'scale(1)';
                gridItem.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.8), rgba(0,20,40,0.8))';
            });
            
            // Add click handler
            gridItem.addEventListener('click', () => {
                if (isAvailable) {
                    this.selectGridItem(item);
                }
            });
            
            // Add drag & drop handlers
            gridItem.addEventListener('dragstart', (e) => {
                this.dragStartSlot = index;
                this.draggedItem = item.id;
                e.dataTransfer.effectAllowed = 'move';
                gridItem.style.opacity = '0.5';
            });
            
            gridItem.addEventListener('dragend', () => {
                gridItem.style.opacity = isAvailable ? '1' : '0.3';
                this.draggedItem = null;
                this.dragStartSlot = null;
            });
            
            gridItem.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                gridItem.style.background = 'linear-gradient(135deg, rgba(255,102,0,0.3), rgba(255,102,0,0.1))';
            });
            
            gridItem.addEventListener('dragleave', () => {
                gridItem.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.8), rgba(0,20,40,0.8))';
            });
            
            gridItem.addEventListener('drop', (e) => {
                e.preventDefault();
                gridItem.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.8), rgba(0,20,40,0.8))';
                
                if (this.draggedItem && this.dragStartSlot !== null) {
                    this.swapQuickbarItems(this.dragStartSlot, index);
                }
            });
            
            // Create content
            gridItem.innerHTML = `
                <div style="position: absolute; top: 2px; left: 2px; background: rgba(0,0,0,0.8); color: #00aaff; font-size: 10px; font-weight: bold; width: 16px; height: 16px; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-family: monospace;">
                    ${item.shortcut}
                </div>
                <div style="font-size: 24px; opacity: ${isAvailable ? '1' : '0.3'};">
                    ${item.icon}
                </div>
            `;
            
            hud.appendChild(gridItem);
        });
        
        // Add "More" button
        const moreButton = document.createElement('div');
        moreButton.id = 'more-button';
        moreButton.style.width = '50px';
        moreButton.style.height = '50px';
        moreButton.style.border = '2px solid #00aaff';
        moreButton.style.borderRadius = '8px';
        moreButton.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.8), rgba(0,20,40,0.8))';
        moreButton.style.display = 'flex';
        moreButton.style.alignItems = 'center';
        moreButton.style.justifyContent = 'center';
        moreButton.style.cursor = 'pointer';
        moreButton.style.transition = 'all 0.2s ease';
        moreButton.style.fontSize = '12px';
        moreButton.style.color = '#00aaff';
        moreButton.style.fontWeight = 'bold';
        moreButton.innerHTML = 'More';
        
        // Add hover effect for more button
        moreButton.addEventListener('mouseenter', () => {
            moreButton.style.transform = 'scale(1.1)';
            moreButton.style.background = 'linear-gradient(135deg, rgba(0,170,255,0.3), rgba(0,40,80,0.3))';
        });
        
        moreButton.addEventListener('mouseleave', () => {
            moreButton.style.transform = 'scale(1)';
            moreButton.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.8), rgba(0,20,40,0.8))';
        });
        
        // Add click handler for more button (placeholder for now)
        moreButton.addEventListener('click', () => {
            this.toggleMoreDrawer();
        });
        
        hud.appendChild(moreButton);
        hud.style.display = 'flex';
    }
    
    selectGridItem(item) {
        if (item.type === 'weapon') {
            // Switch to weapon
            const weaponIndex = this.player.weapons.indexOf(item.id);
            if (weaponIndex !== -1) {
                this.player.currentWeaponIndex = weaponIndex;
                this.showMessage(`${this.t('switchWeapon')}: ${item.name}`);
                
                // Emit UI update event
                this.emit('ui:update', this.buildHUDModel());
            }
        } else {
            // Use item
            this.activateSelectedItem(item.id);
        }
    }
    
    selectGridItemByShortcut(shortcut) {
        const gridItems = [
            { id: 'diamondSword', type: 'weapon', shortcut: '1', name: 'Diamond Sword' },
            { id: 'gun', type: 'weapon', shortcut: '2', name: 'Gun' },
            { id: 'machineGun', type: 'weapon', shortcut: '3', name: 'Machine Gun' },
            { id: 'health', type: 'item', shortcut: '4', name: 'Health' },
            { id: 'ammo', type: 'item', shortcut: '5', name: 'Ammo' },
            { id: 'jetpack', type: 'item', shortcut: '6', name: 'Jetpack' },
            { id: 'speed', type: 'item', shortcut: '7', name: 'Speed Boost' },
            { id: 'healthRegen', type: 'item', shortcut: '8', name: 'Health Regen' },
            { id: 'weaponBuff', type: 'item', shortcut: '9', name: 'Weapon Buff' }
        ];
        
        const item = gridItems.find(i => i.shortcut === shortcut);
        if (item) {
            this.selectGridItem(item);
        }
    }
    
    toggleMoreDrawer() {
        console.log('toggleMoreDrawer called, current state:', this.isDrawerOpen);
        this.isDrawerOpen = !this.isDrawerOpen;
        console.log('New drawer state:', this.isDrawerOpen);
        this.updateDrawerUI();
        
        if (this.isDrawerOpen) {
            // Exit pointer lock when drawer opens
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
            // Show cursor and style it
            this.showDrawerCursor();
            this.showMessage('Drawer opened - Click items to assign to quickbar');
        } else {
            this.hideDrawerCursor();
            this.showMessage('Drawer closed');
        }
    }
    
    updateDrawerUI() {
        console.log('updateDrawerUI called, isDrawerOpen:', this.isDrawerOpen);
        // Create or update drawer UI
        let drawer = document.getElementById('inventory-drawer');
        if (!drawer) {
            console.log('Creating new drawer element');
            drawer = document.createElement('div');
            drawer.id = 'inventory-drawer';
            drawer.style.position = 'fixed';
            drawer.style.bottom = this.isDrawerOpen ? '0px' : '-400px';
            drawer.style.left = '0';
            drawer.style.right = '0';
            drawer.style.height = '400px';
            drawer.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.95), rgba(0,20,40,0.95))';
            drawer.style.borderTop = '3px solid #00aaff';
            drawer.style.zIndex = '2000';
            drawer.style.transition = 'bottom 0.3s ease';
            drawer.style.overflowY = 'auto';
            drawer.style.padding = '20px';
            document.body.appendChild(drawer);
            console.log('Drawer element created and added to body');
        }
        
        // Update position
        const newBottom = this.isDrawerOpen ? '0px' : '-400px';
        console.log('Setting drawer bottom to:', newBottom);
        drawer.style.bottom = newBottom;
        
        if (!this.isDrawerOpen) {
            return;
        }
        
        // All available items
        const allItems = [
            { id: 'diamondSword', type: 'weapon', icon: '⚔️', name: 'Diamond Sword', category: 'weapon' },
            { id: 'gun', type: 'weapon', icon: '🔫', name: 'Gun', category: 'weapon' },
            { id: 'machineGun', type: 'weapon', icon: '🔫', name: 'Machine Gun', category: 'weapon' },
            { id: 'health', type: 'item', icon: '❤️', name: 'Health', category: 'consumable' },
            { id: 'ammo', type: 'item', icon: '🔸', name: 'Ammo', category: 'consumable' },
            { id: 'jetpack', type: 'item', icon: '🚀', name: 'Jetpack', category: 'consumable' },
            { id: 'speed', type: 'item', icon: '⚡', name: 'Speed Boost', category: 'consumable' },
            { id: 'healthRegen', type: 'item', icon: '💚', name: 'Health Regen', category: 'consumable' },
            { id: 'weaponBuff', type: 'item', icon: '⚔️', name: 'Weapon Buff', category: 'consumable' }
        ];
        
        // Group items by category
        const weaponItems = allItems.filter(item => item.category === 'weapon');
        const consumableItems = allItems.filter(item => item.category === 'consumable');
        
        drawer.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="color: #00aaff; margin: 0; font-family: 'Courier New', monospace;">Inventory Drawer</h3>
                <button id="close-drawer" style="background: #ff4444; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-family: 'Courier New', monospace;">Close</button>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h4 style="color: #00aaff; margin: 0 0 10px 0; font-family: 'Courier New', monospace;">Weapons</h4>
                <div id="weapon-grid" style="display: grid; grid-template-columns: repeat(auto-fill, 50px); gap: 8px; margin-bottom: 20px;"></div>
            </div>
            
            <div>
                <h4 style="color: #00aaff; margin: 0 0 10px 0; font-family: 'Courier New', monospace;">Consumables</h4>
                <div id="consumable-grid" style="display: grid; grid-template-columns: repeat(auto-fill, 50px); gap: 8px;"></div>
            </div>
            
            <div style="margin-top: 20px; padding: 10px; background: rgba(0,170,255,0.1); border-radius: 8px; font-size: 12px; color: #00aaff;">
                <strong>Instructions:</strong><br>
                • Click items to assign to selected quickbar slot<br>
                • Drag items to quickbar to assign<br>
                • Drag items in quickbar to rearrange<br>
                • Use Tab/Arrow keys to navigate, Enter to assign
            </div>
        `;
        
        // Add close button handler
        const closeBtn = drawer.querySelector('#close-drawer');
        closeBtn.addEventListener('click', () => {
            this.isDrawerOpen = false;
            this.hideDrawerCursor();
            this.updateDrawerUI();
        });
        
        // Create weapon items
        const weaponGrid = drawer.querySelector('#weapon-grid');
        weaponItems.forEach(item => {
            const itemEl = this.createDrawerItem(item);
            weaponGrid.appendChild(itemEl);
        });
        
        // Create consumable items
        const consumableGrid = drawer.querySelector('#consumable-grid');
        consumableItems.forEach(item => {
            const itemEl = this.createDrawerItem(item);
            consumableGrid.appendChild(itemEl);
        });
        
        // Add keyboard navigation
        this.setupDrawerKeyboardNavigation();
    }
    
    createDrawerItem(item) {
        const itemEl = document.createElement('div');
        itemEl.className = 'drawer-item';
        itemEl.dataset.itemId = item.id;
        itemEl.style.width = '50px';
        itemEl.style.height = '50px';
        itemEl.style.border = '2px solid #00aaff';
        itemEl.style.borderRadius = '8px';
        itemEl.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.8), rgba(0,20,40,0.8))';
        itemEl.style.display = 'flex';
        itemEl.style.alignItems = 'center';
        itemEl.style.justifyContent = 'center';
        itemEl.style.cursor = 'pointer';
        itemEl.style.transition = 'all 0.2s ease';
        itemEl.style.position = 'relative';
        itemEl.draggable = true;
        
        // Check if item is owned
        let isOwned = false;
        if (item.type === 'weapon') {
            isOwned = this.player.weapons.includes(item.id);
        } else {
            if (item.id === 'health') {
                isOwned = this.inventory.health > 0;
            } else if (item.id === 'ammo') {
                isOwned = this.inventory.ammo > 0;
            } else if (item.id === 'jetpack') {
                isOwned = this.powerUps.jetpackFuel > 0;
            } else if (item.id === 'speed') {
                isOwned = this.powerUps.speedBoost > 0;
            } else if (item.id === 'healthRegen') {
                isOwned = this.powerUps.healthRegen > 0;
            } else if (item.id === 'weaponBuff') {
                isOwned = this.powerUps.weaponBuff > 0;
            }
        }
        
        // Apply visual states
        if (!isOwned) {
            itemEl.style.opacity = '0.3';
            itemEl.style.filter = 'grayscale(100%)';
            itemEl.style.cursor = 'not-allowed';
            itemEl.draggable = false;
        }
        
        itemEl.innerHTML = `
            <div style="font-size: 24px; opacity: ${isOwned ? '1' : '0.3'};">
                ${item.icon}
            </div>
        `;
        
        // Add click handler
        itemEl.addEventListener('click', () => {
            if (isOwned) {
                this.assignItemToQuickbar(item.id);
            }
        });
        
        // Add drag handlers
        itemEl.addEventListener('dragstart', (e) => {
            if (isOwned) {
                this.draggedItem = item.id;
                e.dataTransfer.effectAllowed = 'move';
                itemEl.style.opacity = '0.5';
            }
        });
        
        itemEl.addEventListener('dragend', () => {
            itemEl.style.opacity = isOwned ? '1' : '0.3';
            this.draggedItem = null;
        });
        
        // Add hover effects
        itemEl.addEventListener('mouseenter', () => {
            if (isOwned) {
                itemEl.style.transform = 'scale(1.1)';
                itemEl.style.background = 'linear-gradient(135deg, rgba(0,170,255,0.3), rgba(0,40,80,0.3))';
            }
        });
        
        itemEl.addEventListener('mouseleave', () => {
            itemEl.style.transform = 'scale(1)';
            itemEl.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.8), rgba(0,20,40,0.8))';
        });
        
        return itemEl;
    }
    
    assignItemToQuickbar(itemId) {
        // Find the first empty slot or replace the selected slot
        let targetSlot = this.selectedDrawerSlot;
        if (targetSlot >= 9) targetSlot = 0; // Default to first slot
        
        // Update quickbar layout
        this.quickbarLayout[targetSlot] = itemId;
        this.saveQuickbarLayout();
        
        // Update UI
        this.updateInventoryGridUI();
        this.showMessage(`Assigned ${itemId} to slot ${targetSlot + 1}`);
    }
    
    setupDrawerKeyboardNavigation() {
        // Remove existing listeners
        document.removeEventListener('keydown', this.drawerKeyHandler);
        
        // Create new handler
        this.drawerKeyHandler = (e) => {
            if (!this.isDrawerOpen) return;
            
            switch(e.key) {
                case 'Tab':
                    e.preventDefault();
                    this.selectedDrawerSlot = (this.selectedDrawerSlot + 1) % 9;
                    this.updateDrawerSelection();
                    break;
                case 'Enter':
                    e.preventDefault();
                    // Find the currently selected item in drawer
                    const selectedItem = document.querySelector('.drawer-item.selected');
                    if (selectedItem) {
                        const itemId = selectedItem.dataset.itemId;
                        this.assignItemToQuickbar(itemId);
                    }
                    break;
                case 'Escape':
                    this.isDrawerOpen = false;
                    this.updateDrawerUI();
                    break;
            }
        };
        
        document.addEventListener('keydown', this.drawerKeyHandler);
    }
    
    updateDrawerSelection() {
        // Remove previous selection
        document.querySelectorAll('.drawer-item').forEach(item => {
            item.classList.remove('selected');
            item.style.border = '2px solid #00aaff';
        });
        
        // Add selection to current slot
        const items = document.querySelectorAll('.drawer-item');
        if (items[this.selectedDrawerSlot]) {
            items[this.selectedDrawerSlot].classList.add('selected');
            items[this.selectedDrawerSlot].style.border = '3px solid #ff6600';
        }
    }
    
    loadQuickbarLayout() {
        // Initialize default quickbar layout
        this.quickbarLayout = ['diamondSword', 'gun', 'machineGun', 'health', 'ammo', 'jetpack', 'speed', 'healthRegen', 'weaponBuff'];
        
        // Load from localStorage
        const saved = localStorage.getItem('pjboy_quickbar_layout');
        if (saved) {
            try {
                this.quickbarLayout = JSON.parse(saved);
            } catch (e) {
                console.warn('Failed to load quickbar layout:', e);
            }
        }
    }
    
    saveQuickbarLayout() {
        localStorage.setItem('pjboy_quickbar_layout', JSON.stringify(this.quickbarLayout));
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
        toastEl.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.9), rgba(0,20,40,0.9))';
        toastEl.style.border = '2px solid #00aaff';
        toastEl.style.borderRadius = '8px';
        toastEl.style.padding = '12px 20px';
        toastEl.style.color = '#00aaff';
        toastEl.style.fontFamily = 'Courier New, monospace';
        toastEl.style.fontSize = '14px';
        toastEl.style.fontWeight = 'bold';
        toastEl.style.zIndex = '10000';
        toastEl.style.boxShadow = '0 4px 20px rgba(0,170,255,0.3)';
        toastEl.style.opacity = '0';
        toastEl.style.transition = 'all 0.3s ease';
        toastEl.style.maxWidth = '400px';
        toastEl.style.textAlign = 'center';
        toastEl.style.wordWrap = 'break-word';
        
        // Set type-specific styling
        switch (toast.type) {
            case 'success':
                toastEl.style.border = '2px solid #00ff00';
                toastEl.style.color = '#00ff00';
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
    
    showDrawerCursor() {
        // Hide default cursor
        document.body.style.cursor = 'none';
        
        // Create custom cursor element
        const cursor = document.createElement('div');
        cursor.id = 'drawer-cursor';
        cursor.style.position = 'fixed';
        cursor.style.width = '20px';
        cursor.style.height = '20px';
        cursor.style.background = 'radial-gradient(circle, #000000 0%, #000000 30%, transparent 30%)';
        cursor.style.border = '2px solid #00ff00';
        cursor.style.borderRadius = '50%';
        cursor.style.pointerEvents = 'none';
        cursor.style.zIndex = '999999';
        cursor.style.transform = 'translate(-50%, -50%)';
        cursor.style.boxShadow = `
            0 0 10px #00ff00,
            0 0 20px #00ff00,
            0 0 30px #00ff00,
            inset 0 0 10px rgba(0, 255, 0, 0.3)
        `;
        cursor.style.animation = 'drawerCursorPulse 2s ease-in-out infinite alternate';
        
        // Add CSS animation
        const style = document.createElement('style');
        style.id = 'drawer-cursor-style';
        style.textContent = `
            @keyframes drawerCursorPulse {
                0% {
                    box-shadow: 
                        0 0 10px #00ff00,
                        0 0 20px #00ff00,
                        0 0 30px #00ff00,
                        inset 0 0 10px rgba(0, 255, 0, 0.3);
                }
                100% {
                    box-shadow: 
                        0 0 15px #00ff00,
                        0 0 25px #00ff00,
                        0 0 35px #00ff00,
                        inset 0 0 15px rgba(0, 255, 0, 0.5);
                }
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(cursor);
        
        // Add mouse tracking
        document.addEventListener('mousemove', this.updateDrawerCursorPosition);
    }
    
    hideDrawerCursor() {
        // Remove custom cursor element
        const cursor = document.getElementById('drawer-cursor');
        if (cursor) {
            cursor.remove();
        }
        
        // Remove custom cursor styles
        const style = document.getElementById('drawer-cursor-style');
        if (style) {
            style.remove();
        }
        
        // Remove mouse tracking
        document.removeEventListener('mousemove', this.updateDrawerCursorPosition);
        
        // Reset cursor to default
        document.body.style.cursor = 'default';
    }
    
    updateDrawerCursorPosition = (event) => {
        if (!this.isDrawerOpen) return;
        
        // Update cursor position
        const cursor = document.getElementById('drawer-cursor');
        if (cursor) {
            cursor.style.left = event.clientX + 'px';
            cursor.style.top = event.clientY + 'px';
        }
    }
    
    swapQuickbarItems(fromSlot, toSlot) {
        if (fromSlot === toSlot) return;
        
        // Swap items in quickbar layout
        const temp = this.quickbarLayout[fromSlot];
        this.quickbarLayout[fromSlot] = this.quickbarLayout[toSlot];
        this.quickbarLayout[toSlot] = temp;
        
        // Save layout
        this.saveQuickbarLayout();
        
        // Update UI
        this.updateInventoryGridUI();
        
        this.showMessage(`Swapped items between slots ${fromSlot + 1} and ${toSlot + 1}`);
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
            hud.style.border = '2px solid #00ff00';
            hud.style.borderRadius = '8px';
            hud.style.padding = '12px 16px';
            hud.style.color = '#00ff00';
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
        
        console.log(`Crosshair: gameMode=${this.gameMode}, viewMode=${this.viewMode}, shouldShow=${shouldShow}`);
        
        if (htmlCrosshair) {
            // Check if the dot element exists, recreate if missing
            let dot = htmlCrosshair.querySelector('div');
            if (!dot) {
                console.log('Dot element missing, recreating...');
                htmlCrosshair.innerHTML = `
                    <div style="position: absolute; top: 50%; left: 50%; width: 8px; height: 8px; background: #00ff00; box-shadow: 0 0 10px #00ff00, 0 0 20px #00ff00; border-radius: 50%; transform: translate(-50%, -50%);"></div>
                `;
                dot = htmlCrosshair.querySelector('div');
                console.log('Dot element recreated');
            }
            
            htmlCrosshair.style.display = shouldShow ? 'block' : 'none';
            console.log(`Crosshair display set to: ${htmlCrosshair.style.display}`);
            
            if (dot) {
                console.log('Dot element found, size:', dot.style.width, 'x', dot.style.height);
                console.log('Dot background:', dot.style.background);
            }
        } else {
            console.log('Crosshair element not found!');
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
            color: 0x00ff00,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
        
        // Create inner ring
        const innerGeometry = new THREE.RingGeometry(0.8, 1.0, 32);
        const innerMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide
        });
        const innerRing = new THREE.Mesh(innerGeometry, innerMaterial);
        
        // Create center dot
        const dotGeometry = new THREE.CircleGeometry(0.3, 16);
        const dotMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
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
        console.log('Ground target indicator created');
    }
    
    updateGroundTargetIndicator() {
        // Only show in isometric, birds-eye, and ghost play modes
        const shouldShow = (this.gameMode === 'play' && (this.viewMode === 'iso' || this.viewMode === 'birds-eye' || this.viewMode === 'ghost'));
        
        console.log(`Ground Target: gameMode=${this.gameMode}, viewMode=${this.viewMode}, shouldShow=${shouldShow}`);
        
        if (!this.groundTargetIndicator) {
            this.createGroundTargetIndicator();
        }
        
        if (shouldShow) {
            // Use raycaster to find ground intersection
            const mouse = new THREE.Vector2();
            // Use the correct mouse tracking from playMode
            mouse.x = this.playMode.mouseNDC.x;
            mouse.y = this.playMode.mouseNDC.y;
            
            console.log(`Mouse position: NDC x=${mouse.x}, y=${mouse.y}`);
            
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, this.camera);
            
            // Create ground plane for intersection
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const intersectionPoint = new THREE.Vector3();
            const intersects = raycaster.ray.intersectPlane(groundPlane, intersectionPoint);
            
            console.log(`Ray intersection: ${intersects}, point: x=${intersectionPoint.x}, y=${intersectionPoint.y}, z=${intersectionPoint.z}`);
            
            if (intersects) {
                this.groundTargetIndicator.position.x = intersectionPoint.x;
                this.groundTargetIndicator.position.z = intersectionPoint.z;
                this.groundTargetIndicator.visible = true;
                console.log(`Ground target positioned at: x=${intersectionPoint.x}, z=${intersectionPoint.z}`);
            } else {
                this.groundTargetIndicator.visible = false;
                console.log('No ground intersection found');
            }
        } else {
            this.groundTargetIndicator.visible = false;
            console.log('Ground target hidden - not in isometric mode');
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
            el.style.border = '2px solid #00ff00';
            el.style.color = '#00ff00';
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
    
    // Game state management methods
    showOpeningScreen() {
        this.gameState = 'menu';
        this.hideAllScreens();
        const openingScreen = document.getElementById('opening-screen');
        if (openingScreen) {
            openingScreen.style.display = 'flex';
        }
    }
    
    startGame() {
        this.gameState = 'playing';
        this.currentLevel = 1;
        this.playerLives = 3;
        this.totalScore = 0;
        this.hideAllScreens();
        this.startLevel(this.currentLevel);
    }
    
    startLevel(level) {
        this.currentLevel = level;
        this.levelStartTime = Date.now();
        this.gameState = 'playing';
        
        // Set maze difficulty based on level (1-10)
        this.mazeDifficulty = Math.min(level, 10);
        
        // Generate ASCII maze for this level
        this.generateAsciiPerfectMazeByDifficulty(level);
        
        // Set up play mode
        this.setGameMode('play');
        this.setViewMode('iso');
        
        // Reset player
        this.resetPlayer();
        
        // Show level UI
        this.updateLevelUI();
        
        console.log(`Starting Level ${level} with difficulty ${this.mazeDifficulty}`);
    }
    
    completeLevel() {
        this.gameState = 'levelComplete';
        this.levelCompleteTime = Date.now();
        
        // Calculate score for this level
        const levelTime = (this.levelCompleteTime - this.levelStartTime) / 1000;
        const levelScore = Math.max(0, 1000 - Math.floor(levelTime * 10));
        this.totalScore += levelScore;
        
        // Show level complete screen
        this.showLevelCompleteScreen();
        
        console.log(`Level ${this.currentLevel} completed in ${levelTime.toFixed(1)}s, Score: ${levelScore}`);
    }
    
    nextLevel() {
        if (this.currentLevel < this.maxLevel) {
            this.currentLevel++;
            this.startLevel(this.currentLevel);
        } else {
            // Game completed!
            this.showGameCompleteScreen();
        }
    }
    
    gameOver() {
        this.gameState = 'gameOver';
        this.playerLives--;
        
        if (this.playerLives > 0) {
            // Restart current level
            this.showGameOverScreen();
        } else {
            // Game over completely
            this.showGameOverScreen(true);
        }
    }
    
    resetPlayer() {
        if (this.player) {
            this.player.hp = this.player.maxHp;
            this.player.position.set(0, 0, 0);
            this.player.velocity.set(0, 0, 0);
            this.player.invulnerable = false;
        }
    }
    
    // Screen management
    hideAllScreens() {
        const screens = ['opening-screen', 'level-complete-screen', 'game-over-screen'];
        screens.forEach(id => {
            const screen = document.getElementById(id);
            if (screen) screen.style.display = 'none';
        });
    }
    
    showLevelCompleteScreen() {
        this.hideAllScreens();
        const screen = document.getElementById('level-complete-screen');
        const text = document.getElementById('level-complete-text');
        
        if (screen && text) {
            if (this.currentLevel >= this.maxLevel) {
                text.textContent = `CONGRATULATIONS! All ${this.maxLevel} levels completed! Final Score: ${this.totalScore}`;
                const nextBtn = document.getElementById('next-level-btn');
                if (nextBtn) nextBtn.textContent = 'PLAY AGAIN';
            } else {
                text.textContent = `Level ${this.currentLevel} Complete! Score: ${this.totalScore}`;
            }
            screen.style.display = 'flex';
        }
    }
    
    showGameOverScreen(isFinal = false) {
        this.hideAllScreens();
        const screen = document.getElementById('game-over-screen');
        const text = document.getElementById('game-over-text');
        
        if (screen && text) {
            if (isFinal) {
                text.textContent = `Final Score: ${this.totalScore} | Reached Level ${this.currentLevel}`;
            } else {
                text.textContent = `Lives: ${this.playerLives} | Level ${this.currentLevel}`;
            }
            screen.style.display = 'flex';
        }
    }
    
    showGameCompleteScreen() {
        this.showLevelCompleteScreen();
    }
    
    updateLevelUI() {
        // Create or update level display
        let levelUI = document.getElementById('level-ui');
        if (!levelUI) {
            levelUI = document.createElement('div');
            levelUI.id = 'level-ui';
            levelUI.style.position = 'absolute';
            levelUI.style.top = '20px';
            levelUI.style.right = '20px';
            levelUI.style.background = 'rgba(0,0,0,0.8)';
            levelUI.style.border = '2px solid #00ff00';
            levelUI.style.borderRadius = '8px';
            levelUI.style.padding = '10px 15px';
            levelUI.style.color = '#00ff00';
            levelUI.style.fontFamily = 'Courier New, monospace';
            levelUI.style.fontSize = '14px';
            levelUI.style.fontWeight = 'bold';
            levelUI.style.zIndex = '1000';
            document.body.appendChild(levelUI);
        }
        
        levelUI.innerHTML = `
            <div>Level: ${this.currentLevel}/${this.maxLevel}</div>
            <div>Lives: ${this.playerLives}</div>
            <div>Score: ${this.totalScore}</div>
        `;
    }
    
    checkLevelCompletion() {
        // Only check in play mode
        if (this.gameState !== 'playing' || this.gameMode !== 'play') {
            return;
        }
        
        // Check if player has reached the exit
        if (this.levelEndWorld && this.player) {
            const distance = this.player.position.distanceTo(this.levelEndWorld);
            if (distance < 2.0) { // Within 2 units of exit
                this.completeLevel();
            }
        }
    }
}

// Start the game
window.addEventListener('load', () => {
    const game = new Game3D();
    
    // Expose game instance globally for easy character loading
    window.game = game;
    
    
    // Setup modal event listeners
    game.setupModalListeners();
    
    // Setup screen button event listeners
    setupScreenButtons(game);
    // Using custom in-code lion archer model (no external GLTF)

    // Ensure crosshair element exists
    const crosshairCheck = document.getElementById('crosshair');
    if (!crosshairCheck) {
        console.log('Creating missing crosshair element...');
        const crosshair = document.createElement('div');
        crosshair.id = 'crosshair';
        crosshair.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 18px; height: 18px; pointer-events: none; z-index: 999999; display: none;';
        crosshair.innerHTML = `
            <div style="position: absolute; top: 50%; left: 50%; width: 8px; height: 8px; background: #00ff00; box-shadow: 0 0 10px #00ff00, 0 0 20px #00ff00; border-radius: 50%; transform: translate(-50%, -50%);"></div>
        `;
        document.body.appendChild(crosshair);
        console.log('Crosshair element created');
    } else {
        console.log('Crosshair element found');
    }

    // Global inventory hotkeys
    document.addEventListener('keydown', (event) => {
        if (event.code === 'KeyI') {
            game.toggleInventory();
        }
        const inv = document.getElementById('inventory-ui');
        if (game.modalOpen && inv && inv.style.display === 'block') {
            if (event.code === 'ArrowRight') {
                game.selectInventory(1);
                event.preventDefault();
            }
            if (event.code === 'ArrowLeft') {
                game.selectInventory(-1);
                event.preventDefault();
            }
            if (event.code === 'Tab') {
                game.selectInventory(event.shiftKey ? -1 : 1);
                event.preventDefault();
            }
            if (event.code === 'Enter') {
                game.activateSelectedItem();
                event.preventDefault();
            }
            if (event.code === 'Escape') {
                game.toggleInventory();
                event.preventDefault();
            }
        }
    });
});

// Setup screen button event listeners
function setupScreenButtons(game) {
    // Start game button
    const startBtn = document.getElementById('start-game-btn');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            game.startGame();
        });
    }
    
    // Next level button
    const nextLevelBtn = document.getElementById('next-level-btn');
    if (nextLevelBtn) {
        nextLevelBtn.addEventListener('click', () => {
            if (game.currentLevel < game.maxLevel) {
                game.nextLevel();
            } else {
                // Play again
                game.startGame();
            }
        });
    }
    
    // Main menu buttons
    const mainMenuBtns = document.querySelectorAll('#main-menu-btn, #game-over-menu-btn');
    mainMenuBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            game.gameState = 'menu';
            game.hideAllScreens();
            document.getElementById('opening-screen').style.display = 'flex';
        });
    });
    
    // Restart game button
    const restartBtn = document.getElementById('restart-game-btn');
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            game.startLevel(game.currentLevel);
        });
    }
}
