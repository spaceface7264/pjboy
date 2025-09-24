// 3D Second-Person Game - Refactored Modular Version
import { Player } from './src/systems/Player.js';
import { Maze } from './src/systems/Maze.js';
import { GameState } from './src/systems/GameState.js';
import { UI } from './src/ui/UI.js';
import { MobileControls } from './src/ui/MobileControls.js';
import { EventEmitter } from './src/utils/EventEmitter.js';
import { themes, defaultTheme } from './src/config/themes.js';
import { translations, defaultLanguage } from './src/config/translations.js';

class Game3D extends EventEmitter {
    constructor() {
        super();
        
        // Core Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        
        // Input handling
        this.keys = {};
        this.mouse = { x: 0, y: 0 };
        this.isPointerLocked = false;
        
        // Camera system
        this.viewMode = 'fpv'; // 'iso' | 'fpv' | 'birds-eye' | 'ghost'
        this.fpvPitch = 0;
        this.fpvYawSensitivity = 0.0008;
        this.fpvBobAmplitude = 0.05;
        this.fpvBobFrequency = 8;
        
        // Environment
        this.ground = null;
        this.groundY = -1;
        this.gridHelper = null;
        
        // Game systems
        this.player = null;
        this.maze = null;
        this.gameState = null;
        this.ui = null;
        this.mobileControls = null;
        
        // Shooting system
        this.projectiles = [];
        this.enemies = [];
        
        // Theme and localization
        this.themeName = defaultTheme;
        this.themes = themes;
        this.language = defaultLanguage;
        this.translations = translations;
        
        // Game configuration
        this.showControlsUI = false;
        this.modalOpen = false;
        
        // Flag system
        this.placedFlags = [];
        this.flagRemoveRadiusSq = 25; // ~5 units squared removal radius
        
        // Materials cache
        this.materials = {};
        
        // Game loop
        this.animationId = null;
        
        this.init();
    }
    
    /**
     * Initialize the game
     */
    async init() {
        try {
            // Initialize Three.js
            this.initThreeJS();
            
            // Initialize game systems
            this.initSystems();
            
            // Setup environment
            this.createEnvironment();
            this.setupLighting();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Start game loop
            this.startGameLoop();
            
            // Show opening screen
            this.ui.showOpeningScreen();
            
            console.log('🎮 Game initialized successfully!');
        } catch (error) {
            console.error('❌ Failed to initialize game:', error);
        }
    }
    
    /**
     * Initialize Three.js components
     */
    initThreeJS() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x001100, 50, 200);
        
        // Create camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 5, 10);
        
        // Create renderer with mobile optimizations
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: false,
            stencil: false,
            powerPreference: "high-performance",
            preserveDrawingBuffer: false
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for performance
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setClearColor(0x001100);
        
        // Add to DOM
        const gameCanvas = document.getElementById('game-canvas');
        if (gameCanvas) {
            gameCanvas.appendChild(this.renderer.domElement);
        } else {
            document.body.appendChild(this.renderer.domElement);
        }
        
        // Handle window resize and orientation change
        window.addEventListener('resize', () => this.onWindowResize());
        window.addEventListener('orientationchange', () => {
            // Delay to ensure the viewport has updated
            setTimeout(() => this.onWindowResize(), 100);
        });
    }
    
    /**
     * Initialize game systems
     */
    initSystems() {
        // Initialize systems
        this.gameState = new GameState();
        this.ui = new UI();
        this.player = new Player(this.scene);
        this.maze = new Maze(this.scene);
        this.mobileControls = new MobileControls();
        
        // Setup event communication between systems
        this.setupSystemEvents();
        this.setupMobileControls();
    }
    
    /**
     * Setup event communication between systems
     */
    setupSystemEvents() {
        // Listen for game state changes
        this.gameState.on = this.on.bind(this);
        this.gameState.emit = this.emit.bind(this);
        
        // UI events
        this.on('ui:update', (data) => {
            this.ui.updateInventoryUI(data.weapons, data.currentWeaponIndex);
        });
        
        // Level events
        this.on('level:complete', () => {
            const result = this.gameState.completeLevel();
            this.ui.showLevelCompleteScreen(result.level, result.time, result.totalScore);
        });
        
        // Enemy events
        this.on('enemy:killed', () => {
            this.gameState.addEnemyKill();
        });
        
        // Flag events
        this.on('flag:placed', () => {
            this.gameState.addFlagUsage();
        });
    }
    
    /**
     * Setup mobile controls
     */
    setupMobileControls() {
        if (!this.mobileControls.isMobile()) return;
        
        // Movement callback
        this.mobileControls.onMovement = (movement) => {
            this.mobileMovement = movement;
        };
        
        // Look callback (now disabled - using continuous velocity instead)
        this.mobileControls.onLook = null;
        
        // Action callback
        this.mobileControls.onAction = (key) => {
            // Simulate key press
            const event = { key: key.toLowerCase() };
            this.onKeyDown(event);
        };
        
        // Initialize mobile movement
        this.mobileMovement = { x: 0, y: 0 };
    }
    
    /**
     * Create environment (ground, skybox, etc.)
     */
    createEnvironment() {
        // Create ground
        const theme = this.themes[this.themeName];
        const groundGeometry = new THREE.PlaneGeometry(200, 200);
        const groundMaterial = new THREE.MeshLambertMaterial({ 
            color: theme ? theme.ground : 0x001100 
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = this.groundY;
        ground.receiveShadow = true;
        this.scene.add(ground);
        this.ground = ground;
        
        // Create grid helper
        this.createGrid();
        
        // Apply theme
        this.applyTheme();
    }
    
    /**
     * Create grid helper
     */
    createGrid() {
        const gridHelper = new THREE.GridHelper(100, 40, 0x00ff00, 0x00ff00);
        gridHelper.position.y = -0.9;
        gridHelper.material.opacity = 0.25;
        gridHelper.material.transparent = true;
        this.scene.add(gridHelper);
        this.gridHelper = gridHelper;
    }
    
    /**
     * Setup lighting
     */
    setupLighting() {
        const theme = this.themes[this.themeName];
        
        // Ambient light
        const ambientLight = new THREE.AmbientLight(theme ? theme.ambient : 0x404040, 0.6);
        this.scene.add(ambientLight);
        
        // Directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 100, 50);
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
    }
    
    /**
     * Apply current theme
     */
    applyTheme() {
        const theme = this.themes[this.themeName];
        if (!theme) return;
        
        // Update fog
        this.scene.fog.color.setHex(theme.fog || theme.ground);
        this.scene.fog.near = theme.fogNear || 50;
        this.scene.fog.far = theme.fogFar || 200;
        
        // Update renderer clear color
        this.renderer.setClearColor(theme.sky || theme.ground);
        
        // Update ground material
        if (this.ground && this.ground.material) {
            this.ground.material.color.setHex(theme.ground);
        }
        
        // Cache materials for walls
        this.materials.wall = new THREE.MeshLambertMaterial({
            color: theme.wall,
            emissive: theme.wallEmissive,
            transparent: true,
            opacity: 0.95
        });
    }
    
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Keyboard events
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));
        
        // Mouse events
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('click', (e) => this.onMouseClick(e));
        
        // Pointer lock events
        document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
        
        // UI button events
        this.setupUIEvents();
    }
    
    /**
     * Setup UI button event listeners
     */
    setupUIEvents() {
        // Start game button
        document.addEventListener('click', (e) => {
            if (e.target.id === 'start-game-btn') {
                this.startNewGame();
            } else if (e.target.id === 'next-level-btn') {
                this.nextLevel();
            } else if (e.target.id === 'retry-level-btn') {
                this.retryLevel();
            } else if (e.target.id === 'back-to-menu-btn') {
                this.returnToMenu();
            }
        });
    }
    
    /**
     * Start a new game
     */
    startNewGame() {
        this.gameState.setGameMode('play');
        this.gameState.startLevel(1);
        this.gameState.resetLives();
        this.gameState.totalScore = 0;
        
        // Reset player health to full
        this.gameState.resetHealth();
        
        // Clean up projectiles, enemies, and effects
        this.clearProjectiles();
        this.clearEnemies();
        this.clearEffects();
        
        // Generate new maze
        this.generateNewMaze();
        
        // Position player outside maze entrance
        this.positionPlayerAtEntrance();
        
        // Set first person view
        this.setViewMode('fpv');
        
        // Start game
        this.ui.clearAllUI();
        
        // Show mobile controls or request pointer lock
        if (this.mobileControls && this.mobileControls.isMobile()) {
            this.mobileControls.show();
        } else {
            this.requestPointerLock();
        }
    }
    
    /**
     * Generate a new maze
     */
    generateNewMaze() {
        // Clear existing maze and flags
        this.maze.clearMaze();
        this.clearAllFlags();
        this.clearEnemies();
        
        // Set difficulty based on level
        this.maze.setDifficulty(this.gameState.currentLevel);
        
        // Create new maze
        const result = this.maze.createLabyrinth(
            this.themes, 
            this.materials, 
            (width, height) => this.updateGroundAndFog(width, height)
        );
        
        // Store level markers for positioning
        if (result) {
            this.gameState.levelStartWorld = result.levelStartWorld;
            this.gameState.levelEndWorld = result.levelEndWorld;
        }
        
        // Spawn enemies for this level
        this.spawnLevelEnemies();
    }
    
    /**
     * Position player outside maze entrance
     */
    positionPlayerAtEntrance() {
        if (!this.gameState.levelStartWorld || !this.gameState.levelEndWorld) {
            console.log('Debug: Missing start or end positions');
            return;
        }
        
        const startPos = this.gameState.levelStartWorld;
        const endPos = this.gameState.levelEndWorld;
        
        console.log('Debug: Start pos:', startPos);
        console.log('Debug: End pos:', endPos);
        
        // Since entrance is at column 0 and maze grows towards positive X,
        // place player to the left (negative X direction) of the entrance
        const spawnDistance = 8; // Reduced from 10 for better positioning
        const spawnPos = startPos.clone();
        spawnPos.x -= spawnDistance; // Move player to the left of entrance
        spawnPos.y = 1; // Keep above ground
        
        console.log('Debug: Spawn pos:', spawnPos);
        
        this.player.position.copy(spawnPos);
        
        // Face the player towards the start marker (look right towards entrance)
        this.player.rotation.y = -Math.PI / 2; // Face positive X direction (towards maze)
        
        console.log('Debug: Player rotation:', this.player.rotation.y);
        
        // Update model position if exists
        if (this.player.model) {
            this.player.model.position.copy(this.player.position);
            this.player.model.rotation.y = this.player.rotation.y;
        }
    }
    
    /**
     * Update ground and fog based on maze size
     */
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
    }
    
    /**
     * Handle level progression
     */
    nextLevel() {
        if (this.gameState.nextLevel()) {
            this.generateNewMaze();
            this.positionPlayerAtEntrance();
            this.ui.clearAllUI();
            this.requestPointerLock();
        } else {
            // Game completed
            this.ui.showGameOverScreen();
        }
    }
    
    /**
     * Retry current level
     */
    retryLevel() {
        this.gameState.retryLevel();
        this.generateNewMaze();
        this.positionPlayerAtEntrance();
        this.ui.clearAllUI();
        this.requestPointerLock();
    }
    
    /**
     * Return to main menu
     */
    returnToMenu() {
        this.gameState.returnToMenu();
        this.ui.showOpeningScreen();
        
        // Hide mobile controls and exit pointer lock
        if (this.mobileControls) {
            this.mobileControls.hide();
        }
        this.exitPointerLock();
    }
    
    /**
     * Request pointer lock
     */
    requestPointerLock() {
        this.renderer.domElement.requestPointerLock();
    }
    
    /**
     * Exit pointer lock
     */
    exitPointerLock() {
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
    }
    
    /**
     * Set view mode
     */
    setViewMode(mode) {
        this.viewMode = mode;
        
        // Update player model visibility
        if (this.player && this.player.model) {
            this.player.model.visible = (mode !== 'fpv');
        }
        
        // Update facing indicator visibility
        if (this.player && this.player.facingIndicator && this.player.facingIndicator.groundDot) {
            const show = (mode !== 'fpv') && this.player.facingIndicator.enabled;
            this.player.facingIndicator.groundDot.visible = show;
            this.player.facingIndicator.light.visible = show;
        }
        
        // Update crosshair
        this.ui.updateCrosshairUI(this.gameState.gameMode, this.viewMode, this.gameState.gameState);
    }
    
    /**
     * Game loop
     */
    startGameLoop() {
        const animate = () => {
            this.animationId = requestAnimationFrame(animate);
            this.update();
            this.render();
        };
        animate();
    }
    
    /**
     * Update game logic
     */
    update() {
        const deltaTime = this.clock.getDelta();
        
        // Update systems
        if (this.player) {
            this.player.update(deltaTime);
        }
        
        // Update UI
        if (this.gameState.isPlayMode()) {
            this.ui.updateTimerUI(
                this.gameState.gameMode, 
                this.gameState.mazeTimer, 
                this.gameState.currentLevel
            );
            this.ui.updateFlagUI(this.placedFlags.length);
        }
        
        // Handle input
        this.handleInput(deltaTime);
        
        // Update projectiles
        this.updateProjectiles(deltaTime);
        
        // Update enemies
        this.updateEnemies(deltaTime);
        
        // Update effects
        this.updateEffects(deltaTime);
        
        // Update player health system
        this.gameState.updateHealthRegen(deltaTime);
        
        // Update HP UI
        this.ui.updateHPUI(this.gameState.gameMode, this.gameState.playerHP);
        
        // Check objectives
        this.checkObjectives();
    }
    
    /**
     * Handle input
     */
    handleInput(deltaTime) {
        if (!this.gameState.isPlaying()) return;
        
        // Skip pointer lock check for mobile
        const isMobile = this.mobileControls && this.mobileControls.isMobile();
        if (!isMobile && !this.isPointerLocked) return;
        
        const moveSpeed = 8 * deltaTime; // Adjusted for wider corridors
        const movement = new THREE.Vector3();
        
        // WASD movement relative to player rotation (direction only, no speed yet)
        if (this.keys['w'] || this.keys['W']) movement.z -= 1;
        if (this.keys['s'] || this.keys['S']) movement.z += 1;
        if (this.keys['a'] || this.keys['A']) movement.x -= 1;
        if (this.keys['d'] || this.keys['D']) movement.x += 1;
        
        // Mobile touch movement (already normalized from joystick)
        if (isMobile && this.mobileMovement) {
            movement.x += this.mobileMovement.x;
            movement.z += this.mobileMovement.y;
        }
        
        // Normalize movement to prevent faster diagonal movement, then apply speed
        if (movement.length() > 0) {
            movement.normalize().multiplyScalar(moveSpeed);
        }
        
        // Apply movement
        if (movement.length() > 0) {
            // Rotate movement by player's Y rotation for FPV
            if (this.viewMode === 'fpv') {
                movement.applyEuler(new THREE.Euler(0, this.player.rotation.y, 0));
            }
            
            const playerPos = this.player.position;
            
            // Check X and Z movement separately for better wall sliding
            const newPosX = playerPos.clone();
            newPosX.x += movement.x;
            
            const newPosZ = playerPos.clone();
            newPosZ.z += movement.z;
            
            const newPosBoth = playerPos.clone().add(movement);
            
            // Try moving in both directions first
            if (!this.checkWallCollision(newPosBoth)) {
                this.player.position.copy(newPosBoth);
            } 
            // If that fails, try X movement only
            else if (!this.checkWallCollision(newPosX)) {
                this.player.position.copy(newPosX);
            }
            // If that fails, try Z movement only
            else if (!this.checkWallCollision(newPosZ)) {
                this.player.position.copy(newPosZ);
            }
            
            // Update model position
            if (this.player.model) {
                this.player.model.position.copy(this.player.position);
            }
        }
        
        // Handle continuous look velocity from mobile joystick
        if (isMobile && this.gameState.isPlaying() && this.viewMode === 'fpv') {
            const lookVelocity = this.mobileControls.getLookVelocity();
            if (lookVelocity.x !== 0 || lookVelocity.y !== 0) {
                // Apply look sensitivity and frame rate independence
                const lookSensitivity = 2.0; // Adjust this for comfortable speed
                const deltaLookX = lookVelocity.x * lookSensitivity * deltaTime;
                const deltaLookY = lookVelocity.y * lookSensitivity * deltaTime;
                
                // Update player rotation (yaw)
                this.player.rotation.y -= deltaLookX;
                
                // Update pitch
                this.fpvPitch -= deltaLookY;
                this.fpvPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.fpvPitch));
                
                // Update player model rotation
                if (this.player.model) {
                    this.player.model.rotation.y = this.player.rotation.y;
                }
            }
        }
        
        // Handle shooting
        if (this.keys[' '] || this.keys['Space'] || this.keys['SPACE'] || this.keys['space']) {
            this.shoot();
            this.keys[' '] = false; // Prevent rapid fire
            this.keys['Space'] = false;
            this.keys['SPACE'] = false;
            this.keys['space'] = false;
        }
    }
    
    /**
     * Shoot a projectile forward
     */
    shoot() {
        if (!this.gameState.isPlaying()) return;
        
        // Create projectile (magenta orb like original)
        const projGeo = new THREE.SphereGeometry(0.2, 8, 8);
        const projMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
        const proj = new THREE.Mesh(projGeo, projMat);
        
        // Calculate spawn position and direction
        let spawn, dir;
        if (this.viewMode === 'fpv') {
            // FPV: spawn from camera position
            spawn = this.camera.position.clone();
            
            // Calculate direction from camera rotation
            const direction = new THREE.Vector3();
            this.camera.getWorldDirection(direction);
            dir = direction.normalize();
            
            // Offset spawn position slightly forward
            spawn.add(dir.clone().multiplyScalar(0.5));
        } else {
            // Other view modes: spawn from player position facing forward
            const forward = new THREE.Vector3(
                Math.sin(this.player.rotation.y), 
                0, 
                Math.cos(this.player.rotation.y)
            );
            spawn = this.player.position.clone()
                .add(forward.multiplyScalar(1.0))
                .add(new THREE.Vector3(0, 0.6, 0));
            dir = forward.clone().normalize();
        }
        
        proj.position.copy(spawn);
        proj.userData = { 
            dir: dir.clone(), 
            ttl: 3, 
            radius: 0.2, 
            speed: 12 // Reduced from 15 for better collision detection
        };
        
        this.scene.add(proj);
        this.projectiles.push(proj);
    }
    
    /**
     * Update projectiles
     */
    updateProjectiles(deltaTime) {
        if (this.projectiles.length === 0) return;
        
        // Debug: Log projectile count occasionally
        if (Math.random() < 0.01) { // 1% chance per frame
            console.log(`🚀 Updating ${this.projectiles.length} projectiles`);
        }
        
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const proj = this.projectiles[i];
            const userData = proj.userData;
            
            // Check if this is an enemy projectile
            if (userData.isEnemyProjectile) {
                // Handle enemy projectile (targets player)
                this.updateEnemyProjectile(proj, deltaTime, i);
                continue;
            }
            
            // Calculate next position for player projectiles
            const movement = userData.dir.clone().multiplyScalar(userData.speed * deltaTime);
            const nextPosition = proj.position.clone().add(movement);
            
            // For very fast movement, check intermediate positions
            const movementLength = movement.length();
            const checkPoints = Math.max(1, Math.ceil(movementLength / 0.5)); // Check every 0.5 units
            
            // Check for collisions along the path
            let hitTarget = false;
            let hitType = null;
            
            // Get walls once for efficiency
            const walls = this.maze.getWalls();
            
            // Debug: Check if walls exist
            if (walls.length === 0) {
                console.log('⚠️ No walls found for collision detection!');
            } else if (Math.random() < 0.1) { // 10% chance to log wall info
                console.log(`🧱 Found ${walls.length} walls. First wall:`, {
                    position: walls[0]?.position,
                    size: walls[0]?.size
                });
            }
            
            // Check multiple points along the movement path for fast projectiles
            for (let step = 0; step <= checkPoints && !hitTarget; step++) {
                const t = step / checkPoints;
                const checkPosition = proj.position.clone().add(movement.clone().multiplyScalar(t));
                
                // Check wall collision with proper AABB (Axis-Aligned Bounding Box) detection
                for (const wall of walls) {
                if (wall && wall.position) {
                    // Wall dimensions (cellSize = 5, so walls are 5x5x5)
                    const wallHalfSize = wall.size ? wall.size.x / 2 : 2.5; // Use actual wall size or default to 2.5
                    
                    // Check if projectile sphere intersects with wall cube
                    const wallMin = {
                        x: wall.position.x - wallHalfSize,
                        y: wall.position.y - wallHalfSize,
                        z: wall.position.z - wallHalfSize
                    };
                    const wallMax = {
                        x: wall.position.x + wallHalfSize,
                        y: wall.position.y + wallHalfSize,
                        z: wall.position.z + wallHalfSize
                    };
                    
                    // Find closest point on wall to projectile
                    const closestPoint = {
                        x: Math.max(wallMin.x, Math.min(checkPosition.x, wallMax.x)),
                        y: Math.max(wallMin.y, Math.min(checkPosition.y, wallMax.y)),
                        z: Math.max(wallMin.z, Math.min(checkPosition.z, wallMax.z))
                    };
                    
                    // Check if distance to closest point is less than projectile radius
                    const dx = checkPosition.x - closestPoint.x;
                    const dy = checkPosition.y - closestPoint.y;
                    const dz = checkPosition.z - closestPoint.z;
                    const distanceSquared = dx * dx + dy * dy + dz * dz;
                    
                    if (distanceSquared < (userData.radius * userData.radius)) {
                        hitTarget = true;
                        hitType = 'wall';
                        console.log('💥 Wall collision detected!', {
                            projPos: checkPosition,
                            wallPos: wall.position,
                            distance: Math.sqrt(distanceSquared),
                            radius: userData.radius
                        });
                        // Create collision effect at impact point
                        this.createCollisionEffect(proj.position, 'wall');
                        break;
                    }
                }
                
                if (hitTarget) break; // Break out of wall check loop if hit
            }
            
            } // End of multi-point check loop
            
            // Only move if no collision detected
            if (!hitTarget) {
                proj.position.copy(nextPosition);
            }
            
            // Decrease TTL
            userData.ttl -= deltaTime;
            
            // Check enemy collision (use current projectile position)
            if (!hitTarget) {
                for (let j = this.enemies.length - 1; j >= 0; j--) {
                    const enemy = this.enemies[j];
                    if (enemy && enemy.position) {
                        const distance = proj.position.distanceTo(enemy.position);
                        if (distance < (userData.radius + 1.5)) { // Enemy collision (bigger collision radius)
                            hitTarget = true;
                            hitType = 'enemy';
                            
                            // Damage enemy
                            enemy.userData.health -= 1;
                            const enemyType = enemy.userData.enemyType || 'unknown';
                            const remainingHP = enemy.userData.health;
                            
                            // Show damage number
                            this.showDamageNumber(enemy.position, 1, remainingHP <= 0);
                            
                            // Create hit effect
                            this.createCollisionEffect(enemy.position, 'enemy');
                            
                            // Make enemy flash when hit
                            this.flashEnemy(enemy);
                            
                            if (remainingHP <= 0) {
                                // Enemy destroyed
                                console.log(`💥 ${enemyType} enemy destroyed!`);
                                
                                // Create destruction effect
                                this.createDestructionEffect(enemy.position, enemy.material.color);
                                
                                // Remove enemy
                                this.scene.remove(enemy);
                                if (enemy.geometry) enemy.geometry.dispose();
                                if (enemy.material) enemy.material.dispose();
                                this.enemies.splice(j, 1);
                                
                                // Add score based on enemy type
                                const points = this.getEnemyPoints(enemyType);
                                this.gameState.totalScore += points;
                                this.gameState.addEnemyKill();
                                
                                console.log(`🎯 +${points} points! Total: ${this.gameState.totalScore}`);
                            } else {
                                console.log(`🎯 ${enemyType} hit! ${remainingHP}/${enemy.userData.maxHealth} HP remaining`);
                            }
                            
                            break;
                        }
                    }
                }
            }
            
            // Remove projectile if hit target or TTL expired
            if (hitTarget || userData.ttl <= 0) {
                this.scene.remove(proj);
                proj.geometry.dispose();
                proj.material.dispose();
                this.projectiles.splice(i, 1);
                
                // Projectile removed due to collision or timeout
            }
        }
    }
    
    /**
     * Create collision effect at position
     */
    createCollisionEffect(position, type) {
        const effectColor = type === 'wall' ? 0xffff00 : 0xff8800; // Yellow for walls, orange for enemies
        const effectSize = type === 'wall' ? 0.3 : 0.5;
        
        // Create explosion effect
        const particles = [];
        const particleCount = 8;
        
        for (let i = 0; i < particleCount; i++) {
            const particle = new THREE.Mesh(
                new THREE.SphereGeometry(0.05, 4, 4),
                new THREE.MeshBasicMaterial({ color: effectColor })
            );
            
            particle.position.copy(position);
            
            // Random direction for each particle
            const direction = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                Math.random() * 0.5,
                (Math.random() - 0.5) * 2
            ).normalize();
            
            particle.userData = {
                velocity: direction.multiplyScalar(3 + Math.random() * 2),
                life: 0.5 + Math.random() * 0.3,
                maxLife: 0.5 + Math.random() * 0.3
            };
            
            this.scene.add(particle);
            particles.push(particle);
        }
        
        // Store particles for cleanup
        if (!this.effectParticles) this.effectParticles = [];
        this.effectParticles.push(...particles);
    }
    
    /**
     * Update particle effects
     */
    updateEffects(deltaTime) {
        if (!this.effectParticles || this.effectParticles.length === 0) return;
        
        for (let i = this.effectParticles.length - 1; i >= 0; i--) {
            const particle = this.effectParticles[i];
            const userData = particle.userData;
            
            // Move particle
            particle.position.add(userData.velocity.clone().multiplyScalar(deltaTime));
            
            // Apply gravity
            userData.velocity.y -= 9.8 * deltaTime;
            
            // Fade out
            userData.life -= deltaTime;
            const alpha = userData.life / userData.maxLife;
            particle.material.opacity = alpha;
            particle.material.transparent = true;
            
            // Remove expired particles
            if (userData.life <= 0) {
                this.scene.remove(particle);
                particle.geometry.dispose();
                particle.material.dispose();
                this.effectParticles.splice(i, 1);
            }
        }
    }
    
    /**
     * Update enemies (AI, movement, etc.)
     */
    updateEnemies(deltaTime) {
        const currentTime = Date.now();
        
        for (const enemy of this.enemies) {
            if (!enemy.userData) continue;
            
            const userData = enemy.userData;
            
            // === FLOATING ANIMATION ===
            userData.floatOffset += deltaTime * 2; // Float speed
            const floatHeight = Math.sin(userData.floatOffset) * 0.5; // Float up/down 0.5 units
            enemy.position.y = userData.baseY + floatHeight;
            
            // === ROTATION ANIMATION ===
            enemy.rotation.y += userData.rotateSpeed * deltaTime;
            enemy.rotation.x += userData.rotateSpeed * 0.5 * deltaTime;
            
            // === PATROL AI ===
            const distToPlayer = enemy.position.distanceTo(this.player.position);
            let movement = new THREE.Vector3();
            
            if (distToPlayer < 15) {
                // CHASE MODE: Close to player - move towards them
                const dirToPlayer = new THREE.Vector3()
                    .subVectors(this.player.position, enemy.position)
                    .normalize();
                movement = dirToPlayer.multiplyScalar(userData.speed * deltaTime);
                
                // Reset patrol when chasing
                userData.patrolDistance = 0;
            } else {
                // PATROL MODE: Far from player - patrol hallways
                movement = userData.patrolDirection.clone().multiplyScalar(userData.speed * 0.6 * deltaTime);
                userData.patrolDistance += userData.speed * 0.6 * deltaTime;
                
                // Change direction when hitting max patrol distance or walls
                if (userData.patrolDistance >= userData.maxPatrolDistance) {
                    userData.patrolDirection.multiplyScalar(-1); // Reverse direction
                    userData.patrolDistance = 0;
                    userData.maxPatrolDistance = 10 + Math.random() * 10; // New patrol distance
                }
            }
            
            // === MOVEMENT WITH COLLISION ===
            const newPos = enemy.position.clone().add(movement);
            newPos.y = enemy.position.y; // Keep floating Y position
            
            // Determine enemy collision radius based on type
            let enemyRadius = 0.8; // Default radius
            switch (userData.type || userData.enemyType) {
                case 'enhanced_hunter':
                    enemyRadius = 1.5; // Larger radius for Hunter
                    break;
                case 'sphere':
                    enemyRadius = 1.2;
                    break;
                case 'crystal':
                    enemyRadius = 1.5;
                    break;
                case 'organic':
                    enemyRadius = 1.3;
                    break;
                case 'spiked':
                    enemyRadius = 1.1;
                    break;
            }
            
            // Use aggressive collision detection - check both current and new positions
            const currentCollision = this.checkWallCollision(enemy.position, enemyRadius);
            const futureCollision = this.checkWallCollision(newPos, enemyRadius);
            
            // Also check with a slightly larger radius for safety buffer
            const safetyBuffer = 0.5;
            const futureCollisionSafe = this.checkWallCollision(newPos, enemyRadius + safetyBuffer);
            
            // Debug: Log collision attempts occasionally
            if (Math.random() < 0.01) {
                console.log(`🤖 ${userData.enemyType} collision check:`, {
                    currentPos: enemy.position,
                    newPos: newPos,
                    radius: enemyRadius,
                    currentCollision: currentCollision,
                    futureCollision: futureCollision,
                    futureCollisionSafe: futureCollisionSafe,
                    wallCount: this.maze.getWalls().length
                });
            }
            
            // If currently inside a wall, force them out
            if (currentCollision) {
                console.log(`🚑 ${userData.enemyType} is INSIDE a wall! Force escaping...`);
                this.forceEnemyOutOfWall(enemy, userData, enemyRadius);
            }
            // If future position would cause collision, avoid it
            else if (!futureCollision && !futureCollisionSafe) {
                enemy.position.x = newPos.x;
                enemy.position.z = newPos.z;
            } else {
                console.log(`🚧 ${userData.enemyType} avoiding wall collision...`);
                // Hit wall - implement smarter wall avoidance
                this.handleEnemyWallAvoidance(enemy, userData, enemyRadius, distToPlayer, deltaTime);
            }
            
            // === ENHANCED HUNTER SPECIAL ABILITIES ===
            if (userData.type === 'enhanced_hunter') {
                // Animate weapon spikes
                if (userData.spikeGroup) {
                    userData.spikeGroup.rotation.y += deltaTime * 3;
                }
                
                // Pulse core based on aggression
                if (userData.core) {
                    const aggroIntensity = distToPlayer < userData.aggroRange ? 1.5 : 0.8;
                    const pulseIntensity = aggroIntensity + Math.sin(userData.floatOffset * 6) * 0.3;
                    userData.core.material.emissiveIntensity = pulseIntensity;
                }
                
                // Enhanced Hunter shooting ability
                if (userData.canShoot && distToPlayer < userData.attackRange && distToPlayer > 3) {
                    if (currentTime - userData.lastAttack > userData.attackCooldown) {
                        this.hunterShootProjectile(enemy, this.player.position);
                        userData.lastAttack = currentTime;
                        console.log('🏹 Enhanced Hunter fired projectile!');
                    }
                }
                
                // Enhanced aggression - faster movement when chasing
                if (distToPlayer < userData.aggroRange) {
                    const aggroMultiplier = 1.5;
                    movement.multiplyScalar(aggroMultiplier);
                }
            }
            
            // === STUCK DETECTION ===
            const moveDistance = enemy.position.distanceTo(userData.lastPosition);
            if (moveDistance < 0.1) {
                userData.stuckCounter++;
            } else {
                userData.stuckCounter = 0;
                userData.lastPosition.copy(enemy.position);
            }
            
            // If stuck for too long, force a new direction
            if (userData.stuckCounter > 30) { // ~30 frames = ~0.5 seconds
                userData.patrolDirection = new THREE.Vector3(
                    Math.random() - 0.5,
                    0,
                    Math.random() - 0.5
                ).normalize();
                userData.stuckCounter = 0;
                userData.patrolDistance = 0;
                console.log(`🔄 ${userData.enemyType} enemy unstuck with new random direction`);
            }
            
            // === PLAYER DAMAGE ===
            if (distToPlayer < 2.0) {
                // Apply damage based on enemy type
                let damage = 10; // Default damage
                switch (userData.type || userData.enemyType) {
                    case 'enhanced_hunter':
                        damage = 15;
                        break;
                    case 'crystal':
                        damage = 12;
                        break;
                    case 'spiked':
                        damage = 20;
                        break;
                    case 'organic':
                        damage = 8;
                        break;
                    case 'sphere':
                        damage = 6;
                        break;
                }
                
                const playerDied = this.gameState.takeDamage(damage);
                
                // Create damage effect
                this.createPlayerDamageEffect();
                
                console.log(`💀 Player hit by ${userData.enemyType} enemy! Damage: ${damage}, HP: ${this.gameState.playerHP}`);
                
                if (playerDied) {
                    this.handlePlayerDeath();
                }
            }
        }
    }
    
    /**
     * Clear all projectiles
     */
    clearProjectiles() {
        for (const proj of this.projectiles) {
            this.scene.remove(proj);
            proj.geometry.dispose();
            proj.material.dispose();
        }
        this.projectiles = [];
    }
    
    /**
     * Clear all enemies
     */
    clearEnemies() {
        for (const enemy of this.enemies) {
            this.scene.remove(enemy);
            if (enemy.geometry) enemy.geometry.dispose();
            if (enemy.material) enemy.material.dispose();
        }
        this.enemies = [];
    }
    
    /**
     * Clear all effect particles
     */
    clearEffects() {
        if (this.effectParticles) {
            for (const particle of this.effectParticles) {
                this.scene.remove(particle);
                if (particle.geometry) particle.geometry.dispose();
                if (particle.material) particle.material.dispose();
            }
            this.effectParticles = [];
        }
    }
    
    /**
     * Show floating damage number when enemy is hit
     */
    showDamageNumber(position, damage, isKill = false) {
        // Create floating text for damage
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 128;
        canvas.height = 64;
        
        context.fillStyle = isKill ? '#ff0000' : '#ffff00';
        context.font = isKill ? 'bold 32px Arial' : 'bold 24px Arial';
        context.textAlign = 'center';
        context.fillText(isKill ? 'DESTROYED!' : `-${damage}`, 64, 40);
        
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(material);
        
        sprite.position.copy(position);
        sprite.position.y += 2;
        sprite.scale.set(3, 1.5, 1);
        
        this.scene.add(sprite);
        
        // Animate the damage number
        const startY = sprite.position.y;
        const animationDuration = 2000; // 2 seconds
        const startTime = Date.now();
        
        const animateDamage = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / animationDuration;
            
            if (progress < 1) {
                sprite.position.y = startY + progress * 3; // Float up
                sprite.material.opacity = 1 - progress; // Fade out
                requestAnimationFrame(animateDamage);
            } else {
                this.scene.remove(sprite);
                texture.dispose();
                material.dispose();
            }
        };
        
        animateDamage();
    }
    
    /**
     * Flash enemy when hit
     */
    flashEnemy(enemy) {
        const originalColor = enemy.material.color.getHex();
        const originalEmissive = enemy.material.emissive.getHex();
        
        // Flash white
        enemy.material.color.setHex(0xffffff);
        enemy.material.emissive.setHex(0xffffff);
        
        setTimeout(() => {
            enemy.material.color.setHex(originalColor);
            enemy.material.emissive.setHex(originalEmissive);
        }, 100);
    }
    
    /**
     * Create destruction effect when enemy dies
     */
    createDestructionEffect(position, color) {
        // Create more particles for destruction
        for (let i = 0; i < 15; i++) {
            const particleGeo = new THREE.SphereGeometry(0.1 + Math.random() * 0.2);
            const particleMat = new THREE.MeshBasicMaterial({ 
                color: color,
                transparent: true,
                opacity: 0.8
            });
            const particle = new THREE.Mesh(particleGeo, particleMat);
            
            particle.position.copy(position);
            particle.position.y += Math.random() * 2;
            
            // Random velocity
            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 8,
                Math.random() * 6 + 2,
                (Math.random() - 0.5) * 8
            );
            
            particle.userData = {
                velocity: velocity,
                life: 1.0,
                maxLife: 1.0 + Math.random() * 0.5,
                gravity: -12
            };
            
            this.scene.add(particle);
            this.effectParticles.push(particle);
        }
    }
    
    /**
     * Get points for destroying enemy type
     */
    getEnemyPoints(enemyType) {
        const pointValues = {
            'sphere': 50,
            'crystal': 100,
            'organic': 75,
            'spiked': 150,
            'enhanced_hunter': 200
        };
        return pointValues[enemyType] || 50;
    }
    
    /**
     * Create visual effect when player takes damage
     */
    createPlayerDamageEffect() {
        // Screen flash effect
        let damageOverlay = document.getElementById('damage-overlay');
        if (!damageOverlay) {
            damageOverlay = document.createElement('div');
            damageOverlay.id = 'damage-overlay';
            damageOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(255, 0, 0, 0.4);
                pointer-events: none;
                z-index: 9999;
                opacity: 0;
                transition: opacity 0.1s ease;
            `;
            document.body.appendChild(damageOverlay);
        }
        
        // Flash effect
        damageOverlay.style.opacity = '1';
        setTimeout(() => {
            damageOverlay.style.opacity = '0';
        }, 150);
        
        // Screen shake effect (if camera exists)
        if (this.camera) {
            const originalPosition = this.camera.position.clone();
            const shakeIntensity = 0.15;
            const shakeDuration = 400;
            const startTime = Date.now();
            
            const shakeCamera = () => {
                const elapsed = Date.now() - startTime;
                if (elapsed < shakeDuration) {
                    const progress = elapsed / shakeDuration;
                    const intensity = shakeIntensity * (1 - progress);
                    
                    this.camera.position.x = originalPosition.x + (Math.random() - 0.5) * intensity;
                    this.camera.position.y = originalPosition.y + (Math.random() - 0.5) * intensity;
                    this.camera.position.z = originalPosition.z + (Math.random() - 0.5) * intensity;
                    
                    requestAnimationFrame(shakeCamera);
                } else {
                    this.camera.position.copy(originalPosition);
                }
            };
            
            shakeCamera();
        }
        
        // Audio effect (if available)
        console.log('🔊 *DAMAGE SOUND*');
    }
    
    /**
     * Handle player death
     */
    handlePlayerDeath() {
        console.log('💀 Player death handling...');
        
        // Stop game temporarily
        this.gameState.gameState = 'gameOver';
        
        // Create death effect
        this.createDeathEffect();
        
        // Show game over or respawn screen after delay
        setTimeout(() => {
            if (this.gameState.playerLives > 0) {
                // Respawn
                this.respawnPlayer();
            } else {
                // Game over
                this.showGameOverScreen();
            }
        }, 2000);
    }
    
    /**
     * Create death effect
     */
    createDeathEffect() {
        // Screen fade to red
        let deathOverlay = document.getElementById('death-overlay');
        if (!deathOverlay) {
            deathOverlay = document.createElement('div');
            deathOverlay.id = 'death-overlay';
            deathOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: radial-gradient(circle, rgba(255,0,0,0.8) 0%, rgba(0,0,0,0.9) 100%);
                pointer-events: none;
                z-index: 9998;
                opacity: 0;
                transition: opacity 2s ease;
            `;
            document.body.appendChild(deathOverlay);
        }
        
        deathOverlay.style.opacity = '1';
        
        // Remove after respawn/game over
        setTimeout(() => {
            deathOverlay.style.opacity = '0';
        }, 3000);
    }
    
    /**
     * Respawn player
     */
    respawnPlayer() {
        console.log('💊 Player respawning...');
        
        // Reset player position
        this.positionPlayerAtEntrance();
        
        // Reset health
        this.gameState.resetHealth();
        
        // Resume game
        this.gameState.gameState = 'playing';
        
        // Show respawn notification
        this.ui.showNotification(`RESPAWNED! Lives: ${this.gameState.playerLives}`, '#00ff88', 3000);
    }
    
    /**
     * Show game over screen
     */
    showGameOverScreen() {
        console.log('☠️ Game Over!');
        
        // Create game over overlay
        let gameOverOverlay = document.getElementById('game-over-overlay');
        if (!gameOverOverlay) {
            gameOverOverlay = document.createElement('div');
            gameOverOverlay.id = 'game-over-overlay';
            gameOverOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 10000;
                color: white;
                font-family: Arial, sans-serif;
            `;
            
            gameOverOverlay.innerHTML = `
                <h1 style="font-size: 4em; margin: 0; color: #ff4444;">GAME OVER</h1>
                <p style="font-size: 1.5em; margin: 20px 0;">Final Score: ${this.gameState.totalScore}</p>
                <button id="restart-btn" style="
                    padding: 15px 30px;
                    font-size: 1.2em;
                    background: #4CAF50;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                ">Play Again</button>
            `;
            
            document.body.appendChild(gameOverOverlay);
            
            // Add restart functionality
            document.getElementById('restart-btn').addEventListener('click', () => {
                gameOverOverlay.remove();
                this.startNewGame();
            });
        }
    }
    
    /**
     * Enhanced Hunter shoots projectile at target
     */
    hunterShootProjectile(hunter, targetPosition) {
        const userData = hunter.userData;
        
        // Create projectile
        const projGeo = new THREE.SphereGeometry(0.15, 8, 6);
        const projMat = new THREE.MeshBasicMaterial({
            color: userData.projectileColor || 0xff0000,
            emissive: userData.projectileColor || 0xff0000,
            emissiveIntensity: 0.8
        });
        const projectile = new THREE.Mesh(projGeo, projMat);
        
        // Position at hunter's location
        projectile.position.copy(hunter.position);
        projectile.position.y += 0.5; // Shoot from center
        
        // Calculate direction to target
        const direction = new THREE.Vector3()
            .subVectors(targetPosition, projectile.position)
            .normalize();
        
        // Add some leading for moving targets
        const leadFactor = 0.1;
        direction.x += (Math.random() - 0.5) * leadFactor;
        direction.z += (Math.random() - 0.5) * leadFactor;
        direction.normalize();
        
        projectile.userData = {
            dir: direction.clone(),
            speed: userData.projectileSpeed || 8,
            ttl: 5, // 5 seconds time to live
            radius: 0.15,
            isEnemyProjectile: true,
            damage: userData.damage || 2
        };
        
        this.scene.add(projectile);
        this.projectiles.push(projectile);
        
        // Create muzzle flash effect
        this.createCollisionEffect(projectile.position, 'enemy');
        
        console.log('🔥 Hunter projectile fired!');
    }
    
    /**
     * Update enemy projectile (targets player)
     */
    updateEnemyProjectile(proj, deltaTime, index) {
        const userData = proj.userData;
        
        // Move projectile
        const movement = userData.dir.clone().multiplyScalar(userData.speed * deltaTime);
        const nextPosition = proj.position.clone().add(movement);
        
        // Check collision with player
        const distToPlayer = nextPosition.distanceTo(this.player.position);
        if (distToPlayer < (userData.radius + 1.0)) {
            // Hit player!
            const damage = userData.damage || 10;
            const playerDied = this.gameState.takeDamage(damage);
            
            console.log(`💀 Player hit by enemy projectile! Damage: ${damage}, HP: ${this.gameState.playerHP}`);
            
            // Create hit effect and player damage effect
            this.createCollisionEffect(proj.position, 'enemy');
            this.createPlayerDamageEffect();
            
            if (playerDied) {
                this.handlePlayerDeath();
            }
            
            // Remove projectile
            this.scene.remove(proj);
            proj.geometry.dispose();
            proj.material.dispose();
            this.projectiles.splice(index, 1);
            return;
        }
        
        // Check collision with walls
        const walls = this.maze.getWalls();
        for (const wall of walls) {
            if (wall && wall.position) {
                const wallHalfSize = wall.size ? wall.size.x / 2 : 2.5;
                const distToWall = nextPosition.distanceTo(wall.position);
                
                if (distToWall < (userData.radius + wallHalfSize)) {
                    // Hit wall
                    this.createCollisionEffect(proj.position, 'wall');
                    
                    // Remove projectile
                    this.scene.remove(proj);
                    proj.geometry.dispose();
                    proj.material.dispose();
                    this.projectiles.splice(index, 1);
                    return;
                }
            }
        }
        
        // Update TTL
        userData.ttl -= deltaTime;
        if (userData.ttl <= 0) {
            // Remove expired projectile
            this.scene.remove(proj);
            proj.geometry.dispose();
            proj.material.dispose();
            this.projectiles.splice(index, 1);
            return;
        }
        
        // Move projectile if no collision
        proj.position.copy(nextPosition);
    }
    
    /**
     * Add an enemy to the game
     */
    addEnemy(enemy) {
        this.enemies.push(enemy);
        this.scene.add(enemy);
    }
    
    /**
     * Spawn enemy at position
     */
    spawnEnemy(position, color = 0xff0000, enemyType = 'random') {
        // Create varied enemy shapes
        const enemyTypes = ['sphere', 'crystal', 'organic', 'spiked'];
        const selectedType = enemyType === 'random' ? enemyTypes[Math.floor(Math.random() * enemyTypes.length)] : enemyType;
        
        let enemyGeo, enemyMat;
        let health = 1;
        let speed = 2;
        
        switch(selectedType) {
            case 'sphere':
                enemyGeo = new THREE.SphereGeometry(1.2, 16, 12);
                enemyMat = new THREE.MeshPhongMaterial({ 
                    color: color,
                    emissive: color,
                    emissiveIntensity: 0.3,
                    shininess: 100
                });
                health = 2;
                speed = 3;
                break;
                
            case 'crystal':
                enemyGeo = new THREE.OctahedronGeometry(1.5);
                enemyMat = new THREE.MeshPhongMaterial({ 
                    color: color,
                    emissive: color,
                    emissiveIntensity: 0.4,
                    transparent: true,
                    opacity: 0.8
                });
                health = 3;
                speed = 1.5;
                break;
                
            case 'organic':
                enemyGeo = new THREE.DodecahedronGeometry(1.3);
                enemyMat = new THREE.MeshLambertMaterial({ 
                    color: color,
                    emissive: color,
                    emissiveIntensity: 0.2
                });
                health = 2;
                speed = 2.5;
                break;
                
            case 'spiked':
                enemyGeo = new THREE.IcosahedronGeometry(1.1);
                enemyMat = new THREE.MeshPhongMaterial({ 
                    color: color,
                    emissive: color,
                    emissiveIntensity: 0.5,
                    shininess: 50,
                    wireframe: false
                });
                health = 1;
                speed = 4;
                break;
        }
        
        const enemy = new THREE.Mesh(enemyGeo, enemyMat);
        
        enemy.position.copy(position);
        enemy.position.y = 2; // Float above ground
        
            // Add enemy properties
            enemy.userData = {
                type: 'enemy',
                enemyType: selectedType,
                health: health,
                maxHealth: health,
                speed: speed,
                lastUpdate: Date.now(),
                floatOffset: Math.random() * Math.PI * 2, // Random float animation offset
                rotateSpeed: (Math.random() - 0.5) * 2, // Random rotation speed
                baseY: enemy.position.y, // Store original Y position
                patrolDirection: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
                patrolDistance: 0,
                maxPatrolDistance: 10 + Math.random() * 10,
                // Wall avoidance tracking
                stuckCounter: 0,
                lastPosition: enemy.position.clone(),
                wallHugDirection: null
            };
        
        console.log(`🤖 Creating ${selectedType} enemy with ${health}HP at:`, enemy.position);
        this.addEnemy(enemy);
        return enemy;
    }
    
    /**
     * Spawn test enemies for debugging
     */
    spawnTestEnemies() {
        // Clear existing enemies first
        this.clearEnemies();
        
        // Get player position for reference
        const playerPos = this.player.position.clone();
        console.log(`🧑 Player position:`, playerPos);
        
        // Spawn enemies closer to player and in visible range
        const testPositions = [
            new THREE.Vector3(playerPos.x + 15, 1, playerPos.z + 5),   // Right of player
            new THREE.Vector3(playerPos.x + 10, 1, playerPos.z + 15),  // Ahead-right
            new THREE.Vector3(playerPos.x + 5, 1, playerPos.z + 10),   // Close ahead
            new THREE.Vector3(playerPos.x + 20, 1, playerPos.z)        // Far right
        ];
        
        testPositions.forEach((pos, index) => {
            const color = [0xff0000, 0xff8800, 0x8800ff, 0x0088ff][index]; // Different colors
            console.log(`🤖 Spawning enemy ${index + 1} at:`, pos);
            const enemy = this.spawnEnemy(pos, color);
            console.log(`🤖 Enemy created:`, enemy.position, `Color: 0x${color.toString(16)}`);
        });
        
        console.log(`🤖 Spawned ${testPositions.length} test enemies. Total enemies: ${this.enemies.length}`);
        console.log(`🤖 All enemies:`, this.enemies.map(e => ({pos: e.position, visible: e.visible})));
        
        // Also spawn one enhanced Hunter enemy
        const hunterPos = new THREE.Vector3(playerPos.x + 25, 2, playerPos.z + 10);
        this.spawnEnhancedHunter(hunterPos);
        console.log(`🏹 Enhanced Hunter spawned at:`, hunterPos);
    }
    
    /**
     * Spawn enemies for the current level
     */
    spawnLevelEnemies() {
        const level = this.gameState.currentLevel;
        const baseEnemyCount = Math.min(2 + Math.floor(level / 2), 8); // 2-8 enemies based on level
        const enemyCount = baseEnemyCount + Math.floor(Math.random() * 3); // Add 0-2 random enemies
        
        console.log(`🎮 Spawning ${enemyCount} enemies for level ${level}`);
        
        // Get maze dimensions for spawn area calculation
        const mazeSize = this.maze.size || 20;
        const spawnRadius = mazeSize * 2; // Spawn within maze bounds
        
        // Enemy type probabilities by level
        const getRandomEnemyType = () => {
            const rand = Math.random();
            if (level <= 2) {
                // Early levels: mostly spheres and organic
                return rand < 0.6 ? 'sphere' : 'organic';
            } else if (level <= 5) {
                // Mid levels: add crystals
                if (rand < 0.4) return 'sphere';
                if (rand < 0.7) return 'organic';
                return 'crystal';
            } else {
                // High levels: all types including dangerous spiked
                if (rand < 0.25) return 'sphere';
                if (rand < 0.5) return 'organic';
                if (rand < 0.75) return 'crystal';
                return 'spiked';
            }
        };
        
        // Generate spawn positions throughout the maze
        for (let i = 0; i < enemyCount; i++) {
            let attempts = 0;
            let validPosition = null;
            
            // Try to find a valid spawn position (not in walls, not too close to start)
            while (attempts < 50 && !validPosition) {
                const x = (Math.random() - 0.5) * spawnRadius;
                const z = (Math.random() - 0.5) * spawnRadius;
                const testPos = new THREE.Vector3(x, 2, z);
                
                // Check if position is valid (not in wall, not too close to entrance)
                const entranceDistance = this.gameState.levelStartWorld ? 
                    testPos.distanceTo(this.gameState.levelStartWorld) : 20;
                
                // Use larger collision radius for enemy spawning (1.5 units)
                if (!this.checkWallCollision(testPos, 1.5) && entranceDistance > 15) {
                    validPosition = testPos;
                }
                attempts++;
            }
            
            // If we found a valid position, spawn enemy there
            if (validPosition) {
                const enemyType = getRandomEnemyType();
                const colors = [0xff3333, 0x33ff33, 0x3333ff, 0xffff33, 0xff33ff, 0x33ffff];
                const color = colors[i % colors.length];
                
                this.spawnEnemy(validPosition, color, enemyType);
            } else {
                // Fallback: spawn near player but farther away
                const playerPos = this.player.position.clone();
                const angle = (i / enemyCount) * Math.PI * 2;
                const distance = 20 + Math.random() * 15;
                const fallbackPos = new THREE.Vector3(
                    playerPos.x + Math.cos(angle) * distance,
                    2,
                    playerPos.z + Math.sin(angle) * distance
                );
                
                const enemyType = getRandomEnemyType();
                const colors = [0xff6666, 0x66ff66, 0x6666ff, 0xffff66, 0xff66ff, 0x66ffff];
                const color = colors[i % colors.length];
                
                this.spawnEnemy(fallbackPos, color, enemyType);
            }
        }
        
        console.log(`🎮 Level ${level}: Spawned ${this.enemies.length} enemies`);
    }
    
    /**
     * ENHANCED HUNTER - Aggressive enemy with projectile shooting and weapon spikes
     */
    spawnEnhancedHunter(position) {
        const geometry = new THREE.OctahedronGeometry(1.2);
        const material = new THREE.MeshPhongMaterial({
            color: 0xff4400,
            emissive: 0x220000,
            emissiveIntensity: 0.5,
            shininess: 100
        });
        
        const enemy = new THREE.Mesh(geometry, material);
        enemy.position.copy(position);
        enemy.position.y = 2;
        enemy.castShadow = true;
        
        // Add weapon spikes
        const spikeGroup = new THREE.Group();
        for (let i = 0; i < 4; i++) {
            const spike = new THREE.Mesh(
                new THREE.ConeGeometry(0.1, 1, 4),
                new THREE.MeshPhongMaterial({ 
                    color: 0xff0000, 
                    emissive: 0x440000,
                    emissiveIntensity: 0.3
                })
            );
            spike.position.set(
                Math.cos(i * Math.PI / 2) * 1.5,
                0,
                Math.sin(i * Math.PI / 2) * 1.5
            );
            spike.rotation.z = -i * Math.PI / 2;
            spikeGroup.add(spike);
        }
        enemy.add(spikeGroup);
        
        // Add glowing core
        const core = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 12, 8),
            new THREE.MeshBasicMaterial({
                color: 0xff0000,
                emissive: 0xff0000,
                emissiveIntensity: 1
            })
        );
        enemy.add(core);
        
        enemy.userData = {
            type: 'enhanced_hunter',
            enemyType: 'enhanced_hunter',
            health: 4,
            maxHealth: 4,
            speed: 2.5,
            detectionRange: 20,
            attackRange: 15,
            damage: 2,
            points: 200,
            lastAttack: 0,
            attackCooldown: 1200, // Faster shooting
            
            // Projectile shooting ability
            canShoot: true,
            projectileSpeed: 10,
            projectileColor: 0xff0000,
            
            // Enhanced movement
            patrolDirection: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
            patrolDistance: 0,
            maxPatrolDistance: 12,
            
            // Enhanced animation
            floatOffset: Math.random() * Math.PI * 2,
            rotateSpeed: 1.5,
            baseY: enemy.position.y,
            spikeGroup: spikeGroup,
            core: core,
            
            // AI State
            state: 'patrol', // patrol, chase, attack
            stateTimer: 0,
            target: null,
            aggroRange: 25,
            
            // Wall avoidance tracking
            stuckCounter: 0,
            lastPosition: enemy.position.clone(),
            wallHugDirection: null
        };
        
        console.log(`🏹 Enhanced Hunter created with 4 HP and projectile shooting`);
        this.addEnemy(enemy);
        return enemy;
    }
    
    /**
     * Check wall collision
     */
    checkWallCollision(position, radius = 0.4) {
        const walls = this.maze.getWalls();
        
        // Debug: Check if walls exist
        if (walls.length === 0) {
            console.log('⚠️ No walls found for collision detection!');
            return false;
        }
        
        for (const wall of walls) {
            if (!wall || !wall.position || !wall.size) {
                console.log('⚠️ Invalid wall object:', wall);
                continue;
            }
            
            const wallPos = wall.position;
            const wallSize = wall.size;
            
            // Ensure we have valid position coordinates
            const wallX = wallPos.x !== undefined ? wallPos.x : 0;
            const wallZ = wallPos.z !== undefined ? wallPos.z : 0;
            
            const dx = Math.abs(position.x - wallX);
            const dz = Math.abs(position.z - wallZ);
            
            // More precise collision detection with wall boundaries
            const wallHalfX = wallSize.x / 2;
            const wallHalfZ = wallSize.z / 2;
            
            if (dx < (wallHalfX + radius) && dz < (wallHalfZ + radius)) {
                // Debug: Log collision details occasionally
                if (Math.random() < 0.01 && radius > 1.0) {
                    console.log('🚧 Wall collision detected:', {
                        position: position,
                        wallPos: wallPos,
                        wallSize: wallSize,
                        radius: radius,
                        dx: dx,
                        dz: dz,
                        wallHalfX: wallHalfX,
                        wallHalfZ: wallHalfZ
                    });
                }
                return true; // Collision detected
            }
        }
        
        return false; // No collision
    }
    
    /**
     * Handle enemy wall avoidance with smarter navigation
     */
    handleEnemyWallAvoidance(enemy, userData, enemyRadius, distToPlayer, deltaTime) {
        const currentPos = enemy.position;
        
        // Try multiple directions to find a path around the wall
        const avoidanceDirections = [
            // Try turning left/right from current direction
            userData.patrolDirection.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
            userData.patrolDirection.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
            // Try diagonal movements
            userData.patrolDirection.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4),
            userData.patrolDirection.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 4),
            // Try moving toward player if in chase mode
            distToPlayer < 15 ? new THREE.Vector3().subVectors(this.player.position, currentPos).normalize() : null,
            // Try backing up
            userData.patrolDirection.clone().multiplyScalar(-1)
        ].filter(dir => dir !== null);
        
        // Test each avoidance direction
        for (const testDir of avoidanceDirections) {
            const testMovement = testDir.clone().multiplyScalar(userData.speed * 0.1); // Small test movement
            const testPos = currentPos.clone().add(testMovement);
            testPos.y = currentPos.y; // Keep Y position
            
            if (!this.checkWallCollision(testPos, enemyRadius)) {
                // Found a valid direction!
                userData.patrolDirection = testDir.normalize();
                userData.patrolDistance = 0;
                
                // Apply the movement
                const actualMovement = testDir.clone().multiplyScalar(userData.speed * deltaTime * 0.5); // Slower when avoiding
                const newPos = currentPos.clone().add(actualMovement);
                
                if (!this.checkWallCollision(newPos, enemyRadius)) {
                    enemy.position.x = newPos.x;
                    enemy.position.z = newPos.z;
                }
                return;
            }
        }
        
        // If all else fails, pick a completely random direction
        userData.patrolDirection = new THREE.Vector3(
            Math.random() - 0.5,
            0,
            Math.random() - 0.5
        ).normalize();
        userData.patrolDistance = 0;
        userData.maxPatrolDistance = 5 + Math.random() * 5; // Shorter patrol when stuck
        
        console.log(`🤖 ${userData.type || userData.enemyType} enemy found new random direction after wall collision`);
    }
    
    /**
     * Force enemy out of wall if they somehow got inside
     */
    forceEnemyOutOfWall(enemy, userData, enemyRadius) {
        const currentPos = enemy.position;
        const escapeDirections = [
            new THREE.Vector3(1, 0, 0),   // +X
            new THREE.Vector3(-1, 0, 0),  // -X
            new THREE.Vector3(0, 0, 1),   // +Z
            new THREE.Vector3(0, 0, -1),  // -Z
            new THREE.Vector3(1, 0, 1).normalize(),   // +X+Z
            new THREE.Vector3(-1, 0, 1).normalize(),  // -X+Z
            new THREE.Vector3(1, 0, -1).normalize(),  // +X-Z
            new THREE.Vector3(-1, 0, -1).normalize()  // -X-Z
        ];
        
        // Try each direction with increasing distance
        for (let distance = 1; distance <= 5; distance++) {
            for (const direction of escapeDirections) {
                const escapePos = currentPos.clone().add(direction.clone().multiplyScalar(distance));
                escapePos.y = currentPos.y; // Keep Y position
                
                if (!this.checkWallCollision(escapePos, enemyRadius)) {
                    enemy.position.copy(escapePos);
                    userData.patrolDirection = direction.clone();
                    userData.patrolDistance = 0;
                    console.log(`🚑 Forced ${userData.type || userData.enemyType} out of wall to:`, escapePos);
                    return;
                }
            }
        }
        
        // If all else fails, teleport to a safe position near the player
        const playerPos = this.player.position.clone();
        const safePos = new THREE.Vector3(
            playerPos.x + (Math.random() - 0.5) * 20,
            currentPos.y,
            playerPos.z + (Math.random() - 0.5) * 20
        );
        
        if (!this.checkWallCollision(safePos, enemyRadius)) {
            enemy.position.copy(safePos);
            console.log(`🎆 Emergency teleported ${userData.type || userData.enemyType} to safe position:`, safePos);
        }
    }
    
    /**
     * Place a flag at player's current position
     */
    placeFlagAtPlayer() {
        if (!this.gameState.isPlaying()) return;
        
        // Calculate position in front of player
        const flagPos = this.player.position.clone();
        const forwardDirection = new THREE.Vector3(0, 0, -1); // Forward in local space
        forwardDirection.applyEuler(new THREE.Euler(0, this.player.rotation.y, 0)); // Rotate by player's Y rotation
        forwardDirection.multiplyScalar(3); // Place 3 units in front
        
        flagPos.add(forwardDirection);
        flagPos.y = 0.5; // Slightly above ground
        
        // Check if there's already a flag nearby
        for (let i = 0; i < this.placedFlags.length; i++) {
            const flag = this.placedFlags[i];
            const distanceSq = flagPos.distanceToSquared(flag.position);
            
            if (distanceSq < this.flagRemoveRadiusSq) {
                // Remove nearby flag
                this.scene.remove(flag.mesh);
                if (flag.mesh.geometry) flag.mesh.geometry.dispose();
                if (flag.mesh.material) flag.mesh.material.dispose();
                this.placedFlags.splice(i, 1);
                
                // Show removal notification
                this.ui.showNotification('FLAG REMOVED', '#ff4444', 1500);
                return;
            }
        }
        
        // Create new flag
        const flagGroup = new THREE.Group();
        
        // Flag pole
        const poleGeometry = new THREE.CylinderGeometry(0.05, 0.05, 2.5, 8);
        const poleMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const pole = new THREE.Mesh(poleGeometry, poleMaterial);
        pole.position.y = 1.25;
        pole.castShadow = true;
        flagGroup.add(pole);
        
        // Flag fabric
        const flagGeometry = new THREE.PlaneGeometry(1.2, 0.8);
        const flagMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xff4444, 
            side: THREE.DoubleSide,
            emissive: 0x220000
        });
        const flag = new THREE.Mesh(flagGeometry, flagMaterial);
        flag.position.set(0.6, 1.8, 0);
        flag.castShadow = true;
        flagGroup.add(flag);
        
        // Position flag group
        flagGroup.position.copy(flagPos);
        
        // Make flag face the player for better visibility
        const directionToPlayer = new THREE.Vector3()
            .subVectors(this.player.position, flagPos)
            .normalize();
        const angleToPlayer = Math.atan2(directionToPlayer.x, directionToPlayer.z);
        flagGroup.rotation.y = angleToPlayer;
        
        this.scene.add(flagGroup);
        
        // Store flag data
        this.placedFlags.push({
            mesh: flagGroup,
            position: flagPos.clone()
        });
        
        // Update stats
        this.gameState.addFlagUsage();
        
        // Show placement notification
        this.ui.showNotification('FLAG PLACED', '#00ff00', 1500);
    }
    
    /**
     * Clear all placed flags
     */
    clearAllFlags() {
        this.placedFlags.forEach(flag => {
            this.scene.remove(flag.mesh);
            if (flag.mesh.geometry) flag.mesh.geometry.dispose();
            if (flag.mesh.material) flag.mesh.material.dispose();
        });
        this.placedFlags = [];
    }
    
    /**
     * Check objectives (start/end markers)
     */
    checkObjectives() {
        if (!this.gameState.isPlaying()) return;
        
        const playerPos = this.player.position;
        const markers = this.maze.getMarkers();
        
        for (const marker of markers) {
            const distance = playerPos.distanceToSquared(marker.position);
            const triggerDistance = 9; // 3 units squared
            
            if (distance < triggerDistance) {
                if (marker.userData.type === 'start' && !this.gameState.mazeTimer.hasStarted) {
                    // Start timer
                    this.gameState.startMazeTimer();
                    this.ui.addScreenFlash('#00ff00', 200);
                    
                    // Animate start marker
                    this.animateStartMarker(marker);
                    
                } else if (marker.userData.type === 'end' && this.gameState.mazeTimer.hasStarted) {
                    // Complete level
                    this.gameState.finishMazeTimer();
                    this.ui.addScreenFlash('#ff0000', 400);
                    
                    // Animate end marker
                    this.animateEndMarker(marker);
                    
                    // Trigger level complete
                    this.emit('level:complete');
                }
            }
        }
    }
    
    /**
     * Animate start marker
     */
    animateStartMarker(marker) {
        if (marker.userData.content) {
            const content = marker.userData.content;
            const sphere = marker.userData.sphere;
            const ring = marker.userData.ring;
            
            if (sphere && ring) {
                // Pulsing animation
                const animate = () => {
                    const time = Date.now() * 0.005;
                    sphere.scale.setScalar(1 + Math.sin(time) * 0.3);
                    ring.material.opacity = 0.4 + Math.sin(time) * 0.2;
                };
                
                // Run animation for a few seconds
                const interval = setInterval(animate, 16);
                setTimeout(() => clearInterval(interval), 2000);
            }
        }
    }
    
    /**
     * Animate end marker
     */
    animateEndMarker(marker) {
        // Simple scaling animation
        const originalScale = marker.scale.clone();
        const targetScale = originalScale.clone().multiplyScalar(1.5);
        
        const duration = 400;
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // Ease out
            
            marker.scale.lerpVectors(originalScale, targetScale, eased);
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        
        animate();
    }
    
    /**
     * Render the scene
     */
    render() {
        // Update camera based on view mode
        this.updateCamera();
        
        // Update crosshair
        this.ui.updateCrosshairUI(this.gameState.gameMode, this.viewMode, this.gameState.gameState);
        
        if (this.gameState.gameState !== 'playing') {
            return; // Don't render game when not playing
        }
        
        this.renderer.render(this.scene, this.camera);
    }
    
    /**
     * Update camera position and rotation
     */
    updateCamera() {
        if (!this.player) return;
        
        switch (this.viewMode) {
            case 'fpv':
                // First person view
                const fpvPos = this.player.position.clone();
                fpvPos.y += 1.7; // Eye height
                this.camera.position.copy(fpvPos);
                
                // Apply pitch and yaw
                this.camera.rotation.order = 'YXZ';
                this.camera.rotation.y = this.player.rotation.y;
                this.camera.rotation.x = this.fpvPitch;
                break;
                
            case 'iso':
                // Isometric view
                const isoOffset = new THREE.Vector3(8, 12, 8);
                this.camera.position.copy(this.player.position).add(isoOffset);
                this.camera.lookAt(this.player.position);
                break;
                
            case 'birds-eye':
                // Top-down view
                const birdPos = this.player.position.clone();
                birdPos.y = 50;
                this.camera.position.copy(birdPos);
                this.camera.rotation.x = -Math.PI / 2;
                this.camera.rotation.y = 0;
                this.camera.rotation.z = 0;
                break;
        }
    }
    
    /**
     * Event handlers
     */
    onKeyDown(event) {
        this.keys[event.key] = true;
        
        // Special key handlers
        if (event.key === 'Escape') {
            if (this.gameState.isPlaying()) {
                this.returnToMenu();
            }
        } else if (event.key === 't' || event.key === 'T') {
            if (this.gameState.isPlaying()) {
                // Reset player position
                this.positionPlayerAtEntrance();
                this.gameState.resetMazeTimer();
            }
        } else if (event.key === 'e' || event.key === 'E') {
            if (this.gameState.isPlaying()) {
                // Spawn test enemies
                this.spawnTestEnemies();
            }
        } else if (event.key === 'v' || event.key === 'V') {
            // Cycle view modes
            const modes = ['fpv', 'iso', 'birds-eye'];
            const currentIndex = modes.indexOf(this.viewMode);
            const nextIndex = (currentIndex + 1) % modes.length;
            this.setViewMode(modes[nextIndex]);
        } else if (event.key === 'f' || event.key === 'F') {
            // Place/remove flag
            this.placeFlagAtPlayer();
        }
    }
    
    onKeyUp(event) {
        this.keys[event.key] = false;
    }
    
    onMouseMove(event) {
        if (!this.isPointerLocked || this.viewMode !== 'fpv') return;
        
        const movementX = event.movementX || 0;
        const movementY = event.movementY || 0;
        
        // Update player rotation (yaw)
        this.player.rotation.y -= movementX * this.fpvYawSensitivity;
        
        // Update pitch
        this.fpvPitch -= movementY * this.fpvYawSensitivity;
        this.fpvPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.fpvPitch));
        
        // Update player model rotation
        if (this.player.model) {
            this.player.model.rotation.y = this.player.rotation.y;
        }
    }
    
    onMouseClick(event) {
        if (!this.isPointerLocked) {
            this.requestPointerLock();
        }
    }
    
    onPointerLockChange() {
        this.isPointerLocked = !!document.pointerLockElement;
        
        if (this.gameState.isMenu()) {
            document.body.style.cursor = 'default';
        }
    }
    
    onWindowResize() {
        // Get actual viewport dimensions
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        // Update camera aspect ratio
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        
        // Update renderer size
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // Update mobile controls layout if they exist
        if (this.mobileControls && this.mobileControls.isMobile()) {
            // Force mobile controls to recalculate positions
            this.mobileControls.hide();
            setTimeout(() => {
                this.mobileControls.show();
            }, 50);
        }
        
        // Update UI elements for new screen size
        if (this.ui) {
            // Force UI refresh for responsive elements
            this.ui.updateTimerUI();
            this.ui.updateFlagUI();
        }
        
        console.log(`Screen resized to: ${width}x${height}, aspect: ${(width/height).toFixed(2)}`);
    }
    
    /**
     * Translation helper
     */
    t(key) {
        return this.translations[this.language][key] || key;
    }
    
    /**
     * Cleanup
     */
    dispose() {
        // Stop game loop
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        // Dispose systems
        if (this.player) this.player.dispose();
        if (this.maze) this.maze.dispose();
        if (this.ui) this.ui.dispose();
        if (this.mobileControls) this.mobileControls.dispose();
        this.clearAllFlags();
        
        // Dispose Three.js resources
        if (this.renderer) {
            this.renderer.dispose();
        }
        
        // Remove event listeners
        this.removeAllListeners();
    }
}

// Initialize game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.game = new Game3D();
});
