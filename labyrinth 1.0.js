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
        
        this.init();
        this.setupEventListeners();
        this.animate();
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
    }
    
    createPlayer() {
        // Player is invisible in second-person view, but we track its position
        this.player = {
            position: new THREE.Vector3(0, 0, 0),
            rotation: new THREE.Euler(0, 0, 0),
            velocity: new THREE.Vector3(0, 0, 0),
            onGround: false,
            model: null,
            mixer: null
        };
        
        // Create a simple low-poly character as fallback
        this.createFallbackCharacter();
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
        
        // Add directional indicators
        this.addDirectionalIndicators(characterGroup);
        
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
    }
    
    addDirectionalIndicators(characterGroup) {
        // Front indicator (bright green arrow)
        const frontGeometry = new THREE.ConeGeometry(0.3, 0.8, 4);
        const frontMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x00ff00,
            emissive: 0x004400
        });
        const frontArrow = new THREE.Mesh(frontGeometry, frontMaterial);
        frontArrow.position.set(0, 2.2, 0.6);
        frontArrow.rotation.x = Math.PI / 2;
        characterGroup.add(frontArrow);
        
        // Back indicator (red arrow)
        const backGeometry = new THREE.ConeGeometry(0.3, 0.8, 4);
        const backMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xff0000,
            emissive: 0x440000
        });
        const backArrow = new THREE.Mesh(backGeometry, backMaterial);
        backArrow.position.set(0, 2.2, -0.6);
        backArrow.rotation.x = -Math.PI / 2;
        characterGroup.add(backArrow);
        
        // Left indicator (blue arrow)
        const leftGeometry = new THREE.ConeGeometry(0.3, 0.8, 4);
        const leftMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x0000ff,
            emissive: 0x000044
        });
        const leftArrow = new THREE.Mesh(leftGeometry, leftMaterial);
        leftArrow.position.set(-0.6, 2.2, 0);
        leftArrow.rotation.z = Math.PI / 2;
        characterGroup.add(leftArrow);
        
        // Right indicator (yellow arrow)
        const rightGeometry = new THREE.ConeGeometry(0.3, 0.8, 4);
        const rightMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xffff00,
            emissive: 0x444400
        });
        const rightArrow = new THREE.Mesh(rightGeometry, rightMaterial);
        rightArrow.position.set(0.6, 2.2, 0);
        rightArrow.rotation.z = -Math.PI / 2;
        characterGroup.add(rightArrow);
        
        // Store references for easy access
        this.player.frontArrow = frontArrow;
        this.player.backArrow = backArrow;
        this.player.leftArrow = leftArrow;
        this.player.rightArrow = rightArrow;
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
            
            // Add directional indicators to loaded model
            this.addDirectionalIndicators(character);
            
            this.scene.add(character);
            this.player.model = character;
            
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
        const groundMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x001100,
            transparent: true,
            opacity: 0.8
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -1;
        ground.receiveShadow = true;
        this.scene.add(ground);
        
        // Create retro grid pattern
        this.createGrid();
        
        // Initialize saved mazes
        this.initializeSavedMazes();
        
        // Create labyrinth
        this.createLabyrinth();
        
        // Create some 128-bit style objects
        this.createRetroObjects();
        
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
    }
    
    initializeSavedMazes() {
        // Pre-defined maze layouts
        this.savedMazes = [
            {
                name: "Wide Halls",
                size: 50,
                type: "generated",
                description: "Large maze with wide 5-cell halls"
            },
            {
                name: "Classic Small",
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
                description: "Small classic maze"
            },
            {
                name: "Open Arena",
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
                description: "Open arena with border walls"
            },
            {
                name: "Spiral",
                size: 25,
                type: "static",
                layout: this.generateSpiralMaze(25),
                description: "Spiral maze pattern"
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
    
    switchMaze(index) {
        if (index >= 0 && index < this.savedMazes.length) {
            this.currentMazeIndex = index;
            this.rebuildMaze();
            this.updateMazeUI();
            console.log(`Switched to maze: ${this.savedMazes[index].name}`);
        }
    }
    
    rebuildMaze() {
        // Remove existing walls
        this.walls.forEach(wall => {
            this.scene.remove(wall.mesh);
        });
        this.walls = [];
        
        // Create new maze
        this.createLabyrinth();
    }
    
    updateMazeUI() {
        const mazeElement = document.getElementById('current-maze');
        if (mazeElement) {
            const currentMaze = this.savedMazes[this.currentMazeIndex];
            mazeElement.textContent = `Maze: ${currentMaze.name}`;
        }
    }
    
    toggleSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (modal.style.display === 'block') {
            modal.style.display = 'none';
            this.modalOpen = false;
            // Remove cursor class and re-enable pointer lock
            document.body.classList.remove('modal-open');
            // Request pointer lock when returning to gameplay
            setTimeout(() => {
                if (!this.isPointerLocked) {
                    document.body.requestPointerLock();
                }
            }, 100);
        } else {
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
        // Update control scheme buttons
        document.querySelectorAll('.control-btn').forEach(btn => {
            btn.classList.remove('active');
            if (parseInt(btn.dataset.scheme) === this.controlScheme) {
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
        
        // Update game info
        this.updateGameInfo();
    }
    
    updateGameInfo() {
        const playerPos = document.getElementById('player-pos');
        const playerFacing = document.getElementById('player-facing');
        const cameraInfo = document.getElementById('camera-info');
        
        if (playerPos) {
            playerPos.textContent = `(${Math.round(this.player.position.x)}, ${Math.round(this.player.position.y)}, ${Math.round(this.player.position.z)})`;
        }
        
        if (playerFacing) {
            const facingDegrees = (this.characterRotation * 180 / Math.PI) % 360;
            const facingDirection = this.getDirectionName(facingDegrees);
            playerFacing.textContent = `${facingDirection} (${Math.round(facingDegrees)}°)`;
        }
        
        if (cameraInfo) {
            cameraInfo.textContent = `${this.currentCameraAngle}°`;
        }
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
        
        // Control scheme buttons
        document.querySelectorAll('.control-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const scheme = parseInt(btn.dataset.scheme);
                this.setControlScheme(scheme);
                this.toggleSettingsModal(); // Close modal immediately
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
    
    createLabyrinth() {
        // Labyrinth wall material (matches ground design)
        const wallMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x001100,
            emissive: 0x000800,
            transparent: true,
            opacity: 0.9
        });
        
        // Get current maze
        const currentMaze = this.savedMazes[this.currentMazeIndex];
        let maze;
        let cellSize, wallHeight, startX, startZ;
        
        if (currentMaze.type === "generated") {
            // Generate maze dynamically
            maze = this.generateMaze(currentMaze.size, currentMaze.size);
            cellSize = 2;
            wallHeight = 4;
            startX = -currentMaze.size;
            startZ = -currentMaze.size;
        } else {
            // Use static layout
            maze = currentMaze.layout;
            cellSize = 3;
            wallHeight = 4;
            startX = -Math.floor(maze[0].length / 2) * cellSize;
            startZ = -Math.floor(maze.length / 2) * cellSize;
        }
        
        // Create walls based on maze layout
        for (let row = 0; row < maze.length; row++) {
            for (let col = 0; col < maze[row].length; col++) {
                if (maze[row][col] === '#') {
                    const wallGeometry = new THREE.BoxGeometry(cellSize, wallHeight, cellSize);
                    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
                    
                    wall.position.set(
                        startX + col * cellSize,
                        wallHeight / 2,
                        startZ + row * cellSize
                    );
                    
                    wall.castShadow = true;
                    wall.receiveShadow = true;
                    this.scene.add(wall);
                    
                    // Store wall for collision detection
                    this.walls.push({
                        mesh: wall,
                        position: wall.position,
                        size: { x: cellSize, y: wallHeight, z: cellSize }
                    });
                }
            }
        }
        
        // Add entrance and exit markers
        this.addLabyrinthMarkers();
    }
    
    addLabyrinthMarkers() {
        // Entrance marker (green) - positioned at maze entrance
        const entranceGeometry = new THREE.ConeGeometry(0.5, 2, 8);
        const entranceMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x00ff00,
            emissive: 0x004400
        });
        const entrance = new THREE.Mesh(entranceGeometry, entranceMaterial);
        entrance.position.set(-51, 1, -49); // At the entrance of 50x50 maze
        this.scene.add(entrance);
        
        // Exit marker (red) - positioned at maze exit
        const exitGeometry = new THREE.ConeGeometry(0.5, 2, 8);
        const exitMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xff0000,
            emissive: 0x440000
        });
        const exit = new THREE.Mesh(exitGeometry, exitMaterial);
        exit.position.set(49, 1, 49); // At the exit of 50x50 maze
        this.scene.add(exit);
    }
    
    
    createRetroObjects() {
        // Create some geometric shapes with 128-bit aesthetic
        const objects = [];
        
        // Floating cubes
        for (let i = 0; i < 20; i++) {
            const geometry = new THREE.BoxGeometry(2, 2, 2);
            const material = new THREE.MeshLambertMaterial({ 
                color: new THREE.Color().setHSL(Math.random(), 0.8, 0.5),
                emissive: new THREE.Color().setHSL(Math.random(), 0.8, 0.2)
            });
            const cube = new THREE.Mesh(geometry, material);
            cube.position.set(
                (Math.random() - 0.5) * 100,
                Math.random() * 20 + 5,
                (Math.random() - 0.5) * 100
            );
            cube.castShadow = true;
            cube.receiveShadow = true;
            this.scene.add(cube);
            objects.push(cube);
        }
        
        // Floating pyramids
        for (let i = 0; i < 15; i++) {
            const geometry = new THREE.ConeGeometry(1.5, 3, 4);
            const material = new THREE.MeshLambertMaterial({ 
                color: new THREE.Color().setHSL(Math.random(), 0.9, 0.6),
                emissive: new THREE.Color().setHSL(Math.random(), 0.9, 0.3)
            });
            const pyramid = new THREE.Mesh(geometry, material);
            pyramid.position.set(
                (Math.random() - 0.5) * 800,
                Math.random() * 15 + 3,
                (Math.random() - 0.5) * 80
            );
            pyramid.castShadow = true;
            pyramid.receiveShadow = true;
            this.scene.add(pyramid);
            objects.push(pyramid);
        }
        
        // Store objects for animation
        this.objects = objects;
    }
    
    createSkybox() {
        const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
        const skyMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x000011,
            side: THREE.BackSide
        });
        const sky = new THREE.Mesh(skyGeometry, skyMaterial);
        this.scene.add(sky);
    }
    
    setupLighting() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x001122, 0.3);
        this.scene.add(ambientLight);
        
        // Directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0x00ff88, 0.8);
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
        
        // Point lights for 128-bit effect
        for (let i = 0; i < 5; i++) {
            const pointLight = new THREE.PointLight(
                new THREE.Color().setHSL(Math.random(), 1, 0.8),
                1,
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
    
    setupEventListeners() {
        // Keyboard events
        document.addEventListener('keydown', (event) => {
            this.keys[event.code] = true;
            
            // Control scheme switching
            if (event.code === 'Digit1') {
                this.setControlScheme(1);
            }
            if (event.code === 'Digit2') {
                this.setControlScheme(2);
            }
            if (event.code === 'Digit3') {
                this.setControlScheme(3);
            }
            if (event.code === 'Digit4') {
                this.setControlScheme(4);
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
            
            // Q and E for tank controls (scheme 3)
            if (this.controlScheme === 3) {
                if (event.code === 'KeyE') {
                    this.characterRotation -= Math.PI / 2; // 90 degrees left
                }
                if (event.code === 'KeyQ') {
                    this.characterRotation += Math.PI / 2; // 90 degrees right
                }
            }
            
            // Space behavior depends on control scheme
            if (event.code === 'Space' && !event.repeat) {
                event.preventDefault();
                if (this.controlScheme === 1) {
                    this.cycleCameraAngle();
                } else if (this.controlScheme === 2) {
                    this.cameraMode = 'orbit';
                }
            }
        });
        
        document.addEventListener('keyup', (event) => {
            this.keys[event.code] = false;
            
            // Space release for orbit mode (scheme 2)
            if (event.code === 'Space' && this.controlScheme === 2) {
                this.cameraMode = 'fixed';
            }
        });
        
        // Mouse events - behavior depends on control scheme
        document.addEventListener('mousemove', (event) => {
            if (this.isPointerLocked && !this.modalOpen) {
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
        
        // Pointer lock
        document.addEventListener('click', () => {
            if (!this.isPointerLocked) {
                document.body.requestPointerLock();
            }
        });
        
        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement === document.body;
        });
        
        // Window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }
    
    updatePlayer(deltaTime) {
        const speed = 10;
        const jumpForce = 15;
        const gravity = -30;
        
        // Tank controls movement (like old Resident Evil)
        const direction = new THREE.Vector3();
        
        // W/S = forward/backward relative to character facing
        if (this.keys['KeyW']) direction.z -= 1; // Forward
        if (this.keys['KeyS']) direction.z += 1; // Backward
        
        // A/D = strafe left/right relative to character facing
        if (this.keys['KeyA']) direction.x -= 1; // Strafe left
        if (this.keys['KeyD']) direction.x += 1; // Strafe right
        
        // Apply character's current rotation to movement
        direction.applyEuler(new THREE.Euler(0, this.characterRotation, 0));
        direction.normalize();
        
        // Apply movement with collision detection
        const newVelocityX = direction.x * speed;
        const newVelocityZ = direction.z * speed;
        
        // Check collision before applying movement
        const newPosition = this.player.position.clone();
        newPosition.x += newVelocityX * deltaTime;
        newPosition.z += newVelocityZ * deltaTime;
        
        if (this.checkCollision(newPosition)) {
            // Collision detected - don't move in that direction
            this.player.velocity.x = 0;
            this.player.velocity.z = 0;
        } else {
            // No collision - apply movement
            this.player.velocity.x = newVelocityX;
            this.player.velocity.z = newVelocityZ;
        }
        
        // Jumping
        if (this.keys['KeyJ'] && this.player.onGround) {
            this.player.velocity.y = jumpForce;
            this.player.onGround = false;
        }
        
        // Apply gravity
        this.player.velocity.y += gravity * deltaTime;
        
        // Update position
        this.player.position.add(this.player.velocity.clone().multiplyScalar(deltaTime));
        
        // Ground collision
        if (this.player.position.y <= 0) {
            this.player.position.y = 0;
            this.player.velocity.y = 0;
            this.player.onGround = true;
        }
        
        // Update character model position and rotation
        if (this.player.model) {
            this.player.model.position.copy(this.player.position);
            
            // Character always faces their rotation direction (tank controls)
            this.player.model.rotation.y = this.characterRotation;
        }
        
        // Update character animation
        this.updateCharacterAnimation(deltaTime);
        
        // Update direction indicators
        this.updateDirectionIndicators();
        
        // Update camera position based on mode
        this.updateCamera();
    }
    
    
    setControlScheme(scheme) {
        this.controlScheme = scheme;
        this.cameraMode = 'fixed';
        console.log(`Control Scheme: ${scheme}`);
        this.updateControlUI();
    }
    
    updateControlUI() {
        const controlElement = document.getElementById('control-scheme');
        const instructionsElement = document.getElementById('instructions');
        
        if (controlElement) {
            const schemes = ['', 'Mouse Character', 'Space Orbit', 'Tank Controls', 'Mouse Follow'];
            controlElement.textContent = `${this.controlScheme}: ${schemes[this.controlScheme]}`;
        }
        
        if (instructionsElement) {
            const instructions = [
                '',
                'WASD - Move | Mouse - Turn Character | Space - Change Camera | J - Jump',
                'WASD - Move | Mouse - Orbit Camera | Space - Hold to Orbit | J - Jump',
                'WASD - Move | Q/E - Turn | Space - Change Camera | J - Jump',
                'WASD - Move | Mouse - Face Direction | Space - Change Camera | J - Jump'
            ];
            instructionsElement.innerHTML = `<p>${instructions[this.controlScheme]}</p>`;
        }
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
        
        // Check collision with each wall
        for (let wall of this.walls) {
            const wallPos = wall.position;
            const wallSize = wall.size;
            
            // Check if player is within wall bounds
            if (position.x + playerRadius > wallPos.x - wallSize.x/2 &&
                position.x - playerRadius < wallPos.x + wallSize.x/2 &&
                position.z + playerRadius > wallPos.z - wallSize.z/2 &&
                position.z - playerRadius < wallPos.z + wallSize.z/2 &&
                position.y < wallPos.y + wallSize.y/2 &&
                position.y + playerHeight > wallPos.y - wallSize.y/2) {
                return true; // Collision detected
            }
        }
        
        return false; // No collision
    }
    
    updateCamera() {
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
        
        // Resident Evil style walking animation
        if (this.player.leftArm && this.player.rightArm) {
            const time = Date.now() * 0.003; // Slower animation for RE style
            const isMoving = this.keys['KeyW'] || this.keys['KeyS'] || this.keys['KeyA'] || this.keys['KeyD'];
            
            if (isMoving) {
                // Subtle arm movement (RE style is more restrained)
                this.player.leftArm.rotation.x = Math.sin(time) * 0.2;
                this.player.rightArm.rotation.x = Math.sin(time + Math.PI) * 0.2;
                
                // Leg movement with more pronounced steps
                this.player.leftLeg.rotation.x = Math.sin(time) * 0.4;
                this.player.rightLeg.rotation.x = Math.sin(time + Math.PI) * 0.4;
                
                // Slight body sway
                this.player.body.rotation.z = Math.sin(time * 0.5) * 0.05;
            } else {
                // Reset to idle position
                this.player.leftArm.rotation.x = 0;
                this.player.rightArm.rotation.x = 0;
                this.player.leftLeg.rotation.x = 0;
                this.player.rightLeg.rotation.x = 0;
                this.player.body.rotation.z = 0;
            }
        }
    }
    
    animateObjects(deltaTime) {
        if (this.objects) {
            this.objects.forEach((obj, index) => {
                // Rotate objects
                obj.rotation.x += deltaTime * 0.5;
                obj.rotation.y += deltaTime * 0.3;
                
                // Float up and down
                obj.position.y += Math.sin(Date.now() * 0.001 + index) * 0.01;
            });
        }
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        const deltaTime = this.clock.getDelta();
        
        // Update player
        this.updatePlayer(deltaTime);
        
        // Animate objects
        this.animateObjects(deltaTime);
        
        // Render
        this.renderer.render(this.scene, this.camera);
    }
}

// Start the game
window.addEventListener('load', () => {
    const game = new Game3D();
    
    // Expose game instance globally for easy character loading
    window.game = game;
    
    // Initialize control scheme UI
    game.updateControlUI();
    
    // Initialize maze UI
    game.updateMazeUI();
    
    // Setup modal event listeners
    game.setupModalListeners();
    
    // Load the character model
    game.loadCharacterModel('walker.gltf');
});
