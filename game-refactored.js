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
        
        // Look callback
        this.mobileControls.onLook = (deltaX, deltaY) => {
            if (this.gameState.isPlaying() && this.viewMode === 'fpv') {
                // Update player rotation (yaw)
                this.player.rotation.y -= deltaX;
                
                // Update pitch
                this.fpvPitch -= deltaY;
                this.fpvPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.fpvPitch));
                
                // Update player model rotation
                if (this.player.model) {
                    this.player.model.rotation.y = this.player.rotation.y;
                }
            }
        };
        
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
    }
    
    /**
     * Check wall collision
     */
    checkWallCollision(position) {
        const walls = this.maze.getWalls();
        const playerRadius = 0.4; // Slightly smaller radius for better navigation
        
        for (const wall of walls) {
            const wallPos = wall.position;
            const wallSize = wall.size;
            
            const dx = Math.abs(position.x - wallPos.x);
            const dz = Math.abs(position.z - wallPos.z);
            
            // More precise collision detection with wall boundaries
            const wallHalfX = wallSize.x / 2;
            const wallHalfZ = wallSize.z / 2;
            
            if (dx < (wallHalfX + playerRadius) && dz < (wallHalfZ + playerRadius)) {
                return true; // Collision detected
            }
        }
        
        return false; // No collision
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
