/**
 * Maze System - Handles maze generation, rendering, and collision detection
 */
export class Maze {
    constructor(scene) {
        this.scene = scene;
        this.walls = [];
        this.labyrinthMarkers = [];
        this.lastMazeInfo = null;
        this.mazeDifficulty = 5;
    }
    
    /**
     * Create and render a labyrinth based on current difficulty
     */
    createLabyrinth(themes, materials, updateGroundAndFog) {
        // Wall material respects theme; fall back to defaults if theme not ready
        const theme = (themes && themes[themes.themeName]) || null;
        const wallMaterial = materials && materials.wall
            ? materials.wall
            : new THREE.MeshLambertMaterial({
                color: theme ? theme.wall : 0x001100,
                emissive: theme ? theme.wallEmissive : 0x000800,
                transparent: true,
                opacity: 0.95
            });
        
        // Generate perfect ASCII maze based on difficulty
        const maze = this.generateAsciiPerfectMazeByDifficulty(this.mazeDifficulty || 5);
        const cellSize = 5; // Increased from 3 to 5 for wider corridors
        const wallHeight = 8;
        const cols = maze[0].length;
        const rows = maze.length;
        const startX = -((cols - 1) * cellSize) / 2;
        const startZ = -((rows - 1) * cellSize) / 2;
        
        // Update ground and fog if callback provided
        if (updateGroundAndFog) {
            updateGroundAndFog((cols - 1) * cellSize, (rows - 1) * cellSize);
        }
        
        // Store maze info for enemy spawning
        this.lastMazeInfo = { maze, startX, startZ, cellSize };
        
        // Create walls based on layout
        for (let row = 0; row < maze.length; row++) {
            for (let col = 0; col < maze[row].length; col++) {
                const tile = maze[row][col];
                if (tile === '#') {
                    // Vary wall height for visual interest
                    const h = wallHeight * THREE.MathUtils.lerp(0.7, 1.6, Math.random());
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
        
        // Add entrance and exit markers for ASCII mazes
        return this.addLabyrinthMarkers(maze, { startX, startZ, cellSize });
    }
    
    /**
     * Add entrance and exit markers to the maze
     */
    addLabyrinthMarkers(maze, info) {
        // Clean up previous markers
        if (this.labyrinthMarkers && this.labyrinthMarkers.length) {
            this.labyrinthMarkers.forEach(m => this.scene.remove(m));
            this.labyrinthMarkers = [];
        }
        const { startX, startZ, cellSize } = info;
        const rows = maze.length;
        const cols = maze[0].length;
        
        // Find the actual entry and exit points created by generateAsciiPerfectMaze
        // Entry is at column 0, exit is at column width-1
        let entRow = 3; // Default to row 3 (middle of the 5-row entrance)
        let exitRow = rows - 4; // Default to row height-4 (middle of the 5-row exit)
        
        // Find the center of the entrance opening (column 0)
        let entranceCount = 0;
        let entranceSum = 0;
        for (let r = 0; r < rows; r++) {
            if (maze[r][0] === '.') {
                entranceCount++;
                entranceSum += r;
            }
        }
        if (entranceCount > 0) {
            entRow = Math.floor(entranceSum / entranceCount); // Center of entrance
        }
        
        // Find the center of the exit opening (column width-1)
        let exitCount = 0;
        let exitSum = 0;
        for (let r = 0; r < rows; r++) {
            if (maze[r][cols - 1] === '.') {
                exitCount++;
                exitSum += r;
            }
        }
        if (exitCount > 0) {
            exitRow = Math.floor(exitSum / exitCount); // Center of exit
        }
        
        const entCol = 0; // Entry is always at column 0
        const exitCol = cols - 1; // Exit is always at column width-1
        
        // Create entrance marker (green)
        const entranceGeometry = new THREE.CylinderGeometry(1.5, 1.5, 0.3, 32);
        const entranceMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x00ff00, 
            emissive: 0x004400 
        });
        const entrance = new THREE.Mesh(entranceGeometry, entranceMaterial);
        entrance.position.set(
            startX + entCol * cellSize,
            0.15,
            startZ + entRow * cellSize
        );
        
        // Add glowing content inside the start marker
        const startContentGroup = new THREE.Group();
        
        // Central glowing sphere
        const startSphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 16, 16),
            new THREE.MeshBasicMaterial({ 
                color: 0x00ff00, 
                emissive: 0x00ff00,
                transparent: true,
                opacity: 0.8
            })
        );
        startSphere.position.y = 0.5;
        startContentGroup.add(startSphere);
        
        // Pulsing ring around it
        const startRing = new THREE.Mesh(
            new THREE.RingGeometry(0.5, 0.7, 32),
            new THREE.MeshBasicMaterial({ 
                color: 0x00ff00,
                transparent: true,
                opacity: 0.4,
                side: THREE.DoubleSide
            })
        );
        startRing.rotation.x = -Math.PI / 2;
        startRing.position.y = 0.1;
        startContentGroup.add(startRing);
        
        entrance.add(startContentGroup);
        entrance.userData = { type: 'start', content: startContentGroup, sphere: startSphere, ring: startRing };
        this.scene.add(entrance);
        this.labyrinthMarkers.push(entrance);
        
        // Create exit marker (red)
        const exitGeometry = new THREE.CylinderGeometry(1.5, 1.5, 0.3, 32);
        const exitMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xff0000, 
            emissive: 0x440000 
        });
        const exit = new THREE.Mesh(exitGeometry, exitMaterial);
        exit.position.set(
            startX + exitCol * cellSize,
            0.15,
            startZ + exitRow * cellSize
        );
        exit.userData = { type: 'end' };
        this.scene.add(exit);
        this.labyrinthMarkers.push(exit);
        
        // Store world positions for spawning logic
        return {
            levelStartWorld: entrance.position.clone(),
            levelEndWorld: exit.position.clone()
        };
    }
    
    /**
     * Generate a perfect ASCII maze using recursive backtracking
     */
    generateAsciiPerfectMaze(width, height) {
        let w = (width % 2 === 0) ? width - 1 : width;
        let h = (height % 2 === 0) ? height - 1 : height;
    
        const grid = Array.from({ length: h }, () => Array.from({ length: w }, () => '#'));
        
        // Fixed bounds check - allow cells up to but not including the border
        const inBounds = (x, y) => x >= 1 && x <= w - 2 && y >= 1 && y <= h - 2;
        
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
                .map(([dx, dy]) => ({ 
                    nx: cur.x + dx, 
                    ny: cur.y + dy, 
                    bx: cur.x + dx / 2, 
                    by: cur.y + dy / 2 
                }))
                .filter(n => 
                    inBounds(n.nx, n.ny) && 
                    grid[n.ny][n.nx] === '#'
                );
    
            if (neighbors.length === 0) { 
                stack.pop(); 
                continue; 
            }
    
            const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
            grid[pick.by][pick.bx] = '.'; // Carve the wall between
            grid[pick.ny][pick.nx] = '.'; // Carve the destination cell
            stack.push({ x: pick.nx, y: pick.ny });
        }
    
        // Create entrance and exit
        let entY = 1; 
        let foundEntrance = false;
        for (let y = 1; y < h - 1; y++) { 
            if (grid[y][1] === '.') { 
                entY = y; 
                foundEntrance = true;
                break; 
            }
        }
        
        let extY = h - 2; 
        let foundExit = false;
        for (let y = h - 2; y >= 1; y--) { 
            if (grid[y][w - 2] === '.') { 
                extY = y; 
                foundExit = true;
                break; 
            }
        }
        
        grid[entY][0] = '.'; 
        grid[extY][w - 1] = '.';
        
        // Ensure entrance/exit connect to paths
        if (grid[entY][1] !== '.') {
            grid[entY][1] = '.';
        }
        if (grid[extY][w - 2] !== '.') {
            grid[extY][w-2] = '.';
        }
    
        return grid.map(row => row.join(''));
    }
    
    /**
     * Generate maze by difficulty level with connectivity verification
     */
    generateAsciiPerfectMazeByDifficulty(level) {
        const d = Math.max(1, Math.min(10, parseInt(level) || 5));
        const size = 25 + (d - 1) * 8; // 25..97
        const odd = (size % 2 === 1) ? size : size - 1;
        const maze = this.generateAsciiPerfectMaze(odd, odd);
        
        // For small mazes (difficulty 1-2), verify connectivity and regenerate if needed
        if (d <= 2) {
            const isConnected = this.testMazeConnectivity(maze, d);
            if (!isConnected) {
                return this.generateAsciiPerfectMazeByDifficulty(level); // Recursive call to regenerate
            }
        }
        
        return maze;
    }
    
    /**
     * Test if maze has a path from entrance to exit using BFS
     */
    testMazeConnectivity(maze, level) {
        const h = maze.length;
        const w = maze[0].length;
        
        // Find entrance and exit positions
        let entrancePos = null;
        let exitPos = null;
        
        for (let y = 0; y < h; y++) {
            if (maze[y][0] === '.') {
                entrancePos = { x: 0, y: y };
                break;
            }
        }
        
        for (let y = 0; y < h; y++) {
            if (maze[y][w-1] === '.') {
                exitPos = { x: w-1, y: y };
                break;
            }
        }
        
        if (!entrancePos || !exitPos) {
            return false;
        }
        
        // Simple BFS to test connectivity
        const visited = new Set();
        const queue = [entrancePos];
        visited.add(`${entrancePos.x},${entrancePos.y}`);
        
        const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        
        while (queue.length > 0) {
            const current = queue.shift();
            
            // Check if we reached the exit
            if (current.x === exitPos.x && current.y === exitPos.y) {
                return true;
            }
            
            // Explore neighbors
            for (const [dx, dy] of directions) {
                const nx = current.x + dx;
                const ny = current.y + dy;
                const key = `${nx},${ny}`;
                
                if (nx >= 0 && nx < w && ny >= 0 && ny < h && 
                    maze[ny][nx] === '.' && !visited.has(key)) {
                    visited.add(key);
                    queue.push({ x: nx, y: ny });
                }
            }
        }
        
        return false; // No path found
    }
    
    /**
     * Clear all maze walls and markers
     */
    clearMaze() {
        // Remove all walls
        this.walls.forEach(wall => {
            this.scene.remove(wall.mesh);
            if (wall.mesh.geometry) wall.mesh.geometry.dispose();
            if (wall.mesh.material) wall.mesh.material.dispose();
        });
        this.walls = [];
        
        // Remove all markers
        if (this.labyrinthMarkers && this.labyrinthMarkers.length) {
            this.labyrinthMarkers.forEach(marker => {
                this.scene.remove(marker);
                if (marker.geometry) marker.geometry.dispose();
                if (marker.material) marker.material.dispose();
            });
            this.labyrinthMarkers = [];
        }
    }
    
    /**
     * Get maze info for other systems
     */
    getMazeInfo() {
        return this.lastMazeInfo;
    }
    
    /**
     * Get all walls for collision detection
     */
    getWalls() {
        return this.walls;
    }
    
    /**
     * Get all markers for interaction
     */
    getMarkers() {
        return this.labyrinthMarkers;
    }
    
    /**
     * Set maze difficulty
     */
    setDifficulty(difficulty) {
        this.mazeDifficulty = Math.max(1, Math.min(10, parseInt(difficulty) || 5));
    }
    
    /**
     * Clean up all resources
     */
    dispose() {
        this.clearMaze();
    }
}
