// Scene Management - Three.js Scene, Rendering, and 3D Environment
import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';

export class SceneManager {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        // Environment objects
        this.ground = null;
        this.walls = [];
        this.gridHelper = null;
        
        // Maze information
        this.mazeInfo = {
            startMarker: null,
            endMarker: null,
            entranceWorld: null,
            exitWorld: null
        };
        
        // Lighting
        this.ambientLight = null;
        this.directionalLight = null;
        
        // Ground height
        this.groundY = -1;
    }
    
    async initialize(canvas) {
        // Create scene
        this.scene = new THREE.Scene();
        
        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            75, // fov
            window.innerWidth / window.innerHeight, // aspect
            0.1, // near
            1000 // far
        );
        
        // Create renderer
        console.log('🖼️ Canvas element:', canvas);
        
        try {
            this.renderer = new THREE.WebGLRenderer({ 
                canvas: canvas,
                antialias: true,
                alpha: false,
                preserveDrawingBuffer: true
            });
            
            // Check if WebGL context was created
            const gl = this.renderer.getContext();
            console.log('🔧 WebGL context:', gl);
            console.log('🔧 WebGL version:', gl.getParameter(gl.VERSION));
            
            this.renderer.setSize(window.innerWidth, window.innerHeight, false);
            this.renderer.setPixelRatio(window.devicePixelRatio);
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            this.renderer.setClearColor(0x87CEEB, 1.0); // Sky blue with full alpha
            
            // Force initial clear
            this.renderer.clear();
            
            console.log('🎨 Renderer created, size:', window.innerWidth, 'x', window.innerHeight);
            console.log('🎨 Forced red clear - should override CSS background');
            
        } catch (error) {
            console.error('❌ Failed to create WebGL renderer:', error);
        }
        
        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());
        
        console.log('🎬 Scene initialized');
    }
    
    createEnvironment(theme) {
        this.createGround(theme);
        this.createLighting(theme);
        this.createSkybox(theme);
        this.createGrid();
    }
    
    createGround(theme) {
        // Remove existing ground
        if (this.ground) {
            this.scene.remove(this.ground);
            this.ground.geometry.dispose();
            this.ground.material.dispose();
        }
        
        // Create new ground
        const groundGeometry = new THREE.PlaneGeometry(200, 200);
        const groundMaterial = new THREE.MeshLambertMaterial({ 
            color: theme.ground || 0xc2b280 
        });
        
        this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.y = this.groundY;
        this.ground.receiveShadow = true;
        
        this.scene.add(this.ground);
    }
    
    createLighting(theme) {
        // Ambient light
        if (this.ambientLight) {
            this.scene.remove(this.ambientLight);
        }
        this.ambientLight = new THREE.AmbientLight(
            theme.ambient || 0x705f3a, 
            0.4
        );
        this.scene.add(this.ambientLight);
        
        // Directional light (sun)
        if (this.directionalLight) {
            this.scene.remove(this.directionalLight);
        }
        this.directionalLight = new THREE.DirectionalLight(
            theme.directional || 0xffeedd, 
            0.8
        );
        this.directionalLight.position.set(50, 100, 50);
        this.directionalLight.castShadow = true;
        this.directionalLight.shadow.mapSize.width = 2048;
        this.directionalLight.shadow.mapSize.height = 2048;
        this.directionalLight.shadow.camera.near = 0.5;
        this.directionalLight.shadow.camera.far = 200;
        this.directionalLight.shadow.camera.left = -100;
        this.directionalLight.shadow.camera.right = 100;
        this.directionalLight.shadow.camera.top = 100;
        this.directionalLight.shadow.camera.bottom = -100;
        
        this.scene.add(this.directionalLight);
    }
    
    createSkybox(theme) {
        // Simple colored fog for skybox effect
        this.scene.fog = new THREE.Fog(
            theme.fog || 0xdfe6ff,
            theme.fogNear || 30,
            theme.fogFar || 100
        );
    }
    
    createGrid() {
        // Remove existing grid
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
        }
        
        // Create grid helper
        this.gridHelper = new THREE.GridHelper(100, 50, 0x00ff00, 0x00ff00);
        this.gridHelper.position.y = this.groundY + 0.1;
        this.gridHelper.material.opacity = 0.25;
        this.gridHelper.material.transparent = true;
        
        this.scene.add(this.gridHelper);
    }
    
    createMaze(maze, theme) {
        // Clear existing walls
        this.clearWalls();
        
        const mazeInfo = this.getMazeInfo(maze);
        const { cellSize, startX, startZ } = mazeInfo;
        
        // Create walls
        const wallHeight = 8;
        const wallMaterial = new THREE.MeshBasicMaterial({
            color: 0xffff00, // Bright yellow for visibility
        });
        
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
                    this.walls.push(wall);
                }
            }
        }
        
        // Create entrance and exit markers
        this.createMazeMarkers(mazeInfo, theme);
        
        // Update ground size
        this.updateGroundSize(mazeInfo.width, mazeInfo.height);
        
        // Store maze info
        this.mazeInfo = mazeInfo;
        
        // Add a test cube at origin for debugging
        const testGeometry = new THREE.BoxGeometry(2, 2, 2);
        const testMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const testCube = new THREE.Mesh(testGeometry, testMaterial);
        testCube.position.set(0, 1, 0);
        this.scene.add(testCube);
        console.log('🔴 Test cube added to scene at:', testCube.position);
        console.log('📦 Scene children count:', this.scene.children.length);
        
        console.log(`🏗️ Created maze: ${maze[0].length}x${maze.length}`);
    }
    
    createMazeMarkers(mazeInfo, theme) {
        const { entranceWorld, exitWorld } = mazeInfo;
        
        if (entranceWorld) {
            // Green start marker with glowing effect
            const startGeometry = new THREE.CylinderGeometry(1, 1, 0.5, 16);
            const startMaterial = new THREE.MeshLambertMaterial({
                color: 0x00ff00,
                emissive: 0x004400
            });
            
            const startMarker = new THREE.Mesh(startGeometry, startMaterial);
            startMarker.position.set(entranceWorld.x, 0.25, entranceWorld.z);
            
            // Add glowing sphere inside
            const sphereGeometry = new THREE.SphereGeometry(0.3, 16, 16);
            const sphereMaterial = new THREE.MeshBasicMaterial({ 
                color: 0x00ff00,
                transparent: true,
                opacity: 0.8
            });
            const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
            sphere.position.y = 0.5;
            startMarker.add(sphere);
            
            startMarker.userData = { type: 'start' };
            this.scene.add(startMarker);
            this.mazeInfo.startMarker = startMarker;
        }
        
        if (exitWorld) {
            // Red end marker
            const endGeometry = new THREE.CylinderGeometry(1, 1, 0.5, 16);
            const endMaterial = new THREE.MeshLambertMaterial({
                color: 0xff0000,
                emissive: 0x440000
            });
            
            const endMarker = new THREE.Mesh(endGeometry, endMaterial);
            endMarker.position.set(exitWorld.x, 0.25, exitWorld.z);
            
            endMarker.userData = { type: 'end' };
            this.scene.add(endMarker);
            this.mazeInfo.endMarker = endMarker;
        }
    }
    
    createFlag(position) {
        // Create flag pole
        const poleGeometry = new THREE.CylinderGeometry(0.05, 0.05, 2, 8);
        const poleMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const pole = new THREE.Mesh(poleGeometry, poleMaterial);
        pole.position.copy(position);
        pole.position.y += 1;
        
        // Create flag
        const flagGeometry = new THREE.PlaneGeometry(0.8, 0.5);
        const flagMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xff0000,
            side: THREE.DoubleSide 
        });
        const flag = new THREE.Mesh(flagGeometry, flagMaterial);
        flag.position.set(0.4, 1.5, 0);
        pole.add(flag);
        
        pole.castShadow = true;
        this.scene.add(pole);
        
        return pole;
    }
    
    clearWalls() {
        // Remove all walls from scene
        this.walls.forEach(wall => {
            this.scene.remove(wall);
            wall.geometry.dispose();
            wall.material.dispose();
        });
        this.walls = [];
        
        // Remove maze markers
        if (this.mazeInfo.startMarker) {
            this.scene.remove(this.mazeInfo.startMarker);
            this.mazeInfo.startMarker = null;
        }
        if (this.mazeInfo.endMarker) {
            this.scene.remove(this.mazeInfo.endMarker);
            this.mazeInfo.endMarker = null;
        }
    }
    
    updateGroundSize(width, height) {
        if (!this.ground) return;
        
        const size = Math.max(width, height) + 20; // Add margin
        
        // Update ground geometry
        this.ground.geometry.dispose();
        this.ground.geometry = new THREE.PlaneGeometry(size, size);
        
        // Update grid
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
            const divisions = Math.max(10, Math.floor(size / 4));
            this.gridHelper = new THREE.GridHelper(size, divisions, 0x00ff00, 0x00ff00);
            this.gridHelper.position.y = this.groundY + 0.1;
            this.gridHelper.material.opacity = 0.25;
            this.gridHelper.material.transparent = true;
            this.scene.add(this.gridHelper);
        }
    }
    
    getMazeInfo(maze) {
        const rows = maze.length;
        const cols = maze[0].length;
        const cellSize = 3;
        
        const startX = -((cols - 1) * cellSize) / 2;
        const startZ = -((rows - 1) * cellSize) / 2;
        
        // Find entrance and exit world positions
        let entranceWorld = null, exitWorld = null;
        
        for (let row = 0; row < rows; row++) {
            // Entrance (left side)
            if (maze[row][0] === '.' && !entranceWorld) {
                entranceWorld = {
                    x: startX,
                    z: startZ + row * cellSize
                };
            }
            
            // Exit (right side)
            if (maze[row][cols - 1] === '.' && !exitWorld) {
                exitWorld = {
                    x: startX + (cols - 1) * cellSize,
                    z: startZ + row * cellSize
                };
            }
        }
        
        return {
            maze,
            cellSize,
            startX,
            startZ,
            width: cols * cellSize,
            height: rows * cellSize,
            entranceWorld,
            exitWorld
        };
    }
    
    handleResize() {
        if (!this.camera || !this.renderer) return;
        
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    render() {
        if (this.renderer && this.scene && this.camera) {
            // Force clear color and viewport
            this.renderer.setClearColor(0x87CEEB, 1.0); // Sky blue with full alpha
            this.renderer.setViewport(0, 0, this.renderer.domElement.width, this.renderer.domElement.height);
            this.renderer.clear();
            this.renderer.render(this.scene, this.camera);
        } else {
            console.warn('❌ Render failed - missing:', {
                renderer: !!this.renderer,
                scene: !!this.scene,
                camera: !!this.camera
            });
        }
    }
}
