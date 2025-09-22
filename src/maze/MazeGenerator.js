// ASCII Maze Generator - Simplified and Optimized
export class MazeGenerator {
    constructor() {
        this.cellSize = 3; // World units per cell
    }
    
    generateByDifficulty(level) {
        console.log('🎲 Generating maze for level:', level);
        
        // Scale difficulty: level 1 = 11x11, level 10 = 31x31
        const minSize = 11;
        const maxSize = 31;
        const size = Math.min(maxSize, minSize + (level - 1) * 2);
        
        // Ensure odd dimensions for perfect maze generation
        const odd = size % 2 === 0 ? size + 1 : size;
        console.log('📐 Maze size:', odd + 'x' + odd);
        
        let maze = this.generatePerfectMaze(odd, odd);
        console.log('🏗️ Generated maze grid:', maze);
        
        // For small mazes (level 1-2), verify connectivity
        if (level <= 2) {
            let attempts = 0;
            while (!this.testConnectivity(maze, level) && attempts < 10) {
                maze = this.generatePerfectMaze(odd, odd);
                attempts++;
            }
            
            if (attempts >= 10) {
                console.warn(`Generated maze after ${attempts} attempts for level ${level}`);
            }
        }
        
        return maze;
    }
    
    generatePerfectMaze(width, height) {
        // Initialize grid with walls
        const grid = Array(height).fill().map(() => Array(width).fill('#'));
        
        // Helper functions
        const inBounds = (x, y) => x >= 1 && x <= width - 2 && y >= 1 && y <= height - 2;
        const carve = (x, y) => { grid[y][x] = '.'; };
        
        // Start at random odd position
        let sx = 1 + 2 * Math.floor(Math.random() * ((width - 1) / 2));
        let sy = 1 + 2 * Math.floor(Math.random() * ((height - 1) / 2));
        carve(sx, sy);
        
        // Recursive backtracking
        const stack = [{ x: sx, y: sy }];
        const directions = [[0, -2], [2, 0], [0, 2], [-2, 0]]; // up, right, down, left
        
        while (stack.length > 0) {
            const current = stack[stack.length - 1];
            
            // Shuffle directions for randomness
            const shuffledDirs = [...directions].sort(() => Math.random() - 0.5);
            
            // Find unvisited neighbors
            const neighbors = shuffledDirs
                .map(([dx, dy]) => ({ x: current.x + dx, y: current.y + dy, dx, dy }))
                .filter(({ x, y }) => inBounds(x, y) && grid[y][x] === '#');
                
            if (neighbors.length === 0) {
                stack.pop();
                continue;
            }
            
            // Choose random neighbor
            const next = neighbors[Math.floor(Math.random() * neighbors.length)];
            
            // Carve path to neighbor
            carve(current.x + next.dx / 2, current.y + next.dy / 2); // Remove wall between
            carve(next.x, next.y); // Carve destination
            
            stack.push({ x: next.x, y: next.y });
        }
        
        // Create entrance and exit
        this.createEntranceExit(grid, width, height);
        
        return grid;
    }
    
    createEntranceExit(grid, width, height) {
        // Find suitable entrance position (left side)
        let entranceY = -1;
        for (let y = 1; y < height - 1; y++) {
            if (grid[y][1] === '.') {
                entranceY = y;
                break;
            }
        }
        
        // Create entrance
        if (entranceY !== -1) {
            grid[entranceY][0] = '.'; // Open entrance
        } else {
            // Force create entrance if none found
            const midY = Math.floor(height / 2);
            grid[midY][0] = '.';
            grid[midY][1] = '.';
        }
        
        // Find suitable exit position (right side)
        let exitY = -1;
        for (let y = height - 2; y >= 1; y--) {
            if (grid[y][width - 2] === '.') {
                exitY = y;
                break;
            }
        }
        
        // Create exit
        if (exitY !== -1) {
            grid[exitY][width - 1] = '.'; // Open exit
        } else {
            // Force create exit if none found
            const midY = Math.floor(height / 2);
            grid[midY][width - 1] = '.';
            grid[midY][width - 2] = '.';
        }
    }
    
    testConnectivity(maze, level) {
        const height = maze.length;
        const width = maze[0].length;
        
        // Find entrance and exit
        let entrance = null, exit = null;
        
        // Find entrance (left side opening)
        for (let y = 0; y < height; y++) {
            if (maze[y][0] === '.') {
                entrance = { x: 0, y };
                break;
            }
        }
        
        // Find exit (right side opening)
        for (let y = 0; y < height; y++) {
            if (maze[y][width - 1] === '.') {
                exit = { x: width - 1, y };
                break;
            }
        }
        
        if (!entrance || !exit) {
            console.warn(`Missing entrance or exit in level ${level} maze`);
            return false;
        }
        
        // BFS to test connectivity
        const visited = Array(height).fill().map(() => Array(width).fill(false));
        const queue = [entrance];
        visited[entrance.y][entrance.x] = true;
        
        const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        
        while (queue.length > 0) {
            const { x, y } = queue.shift();
            
            // Check if we reached the exit
            if (x === exit.x && y === exit.y) {
                return true;
            }
            
            // Explore neighbors
            for (const [dx, dy] of directions) {
                const nx = x + dx;
                const ny = y + dy;
                
                if (nx >= 0 && nx < width && ny >= 0 && ny < height && 
                    !visited[ny][nx] && maze[ny][nx] === '.') {
                    visited[ny][nx] = true;
                    queue.push({ x: nx, y: ny });
                }
            }
        }
        
        console.warn(`No path found from entrance to exit in level ${level} maze`);
        return false;
    }
    
    // Get world coordinates for maze layout
    getMazeInfo(maze) {
        const rows = maze.length;
        const cols = maze[0].length;
        
        const startX = -((cols - 1) * this.cellSize) / 2;
        const startZ = -((rows - 1) * this.cellSize) / 2;
        
        // Find entrance and exit world positions
        let entranceWorld = null, exitWorld = null;
        
        for (let row = 0; row < rows; row++) {
            // Entrance (left side)
            if (maze[row][0] === '.' && !entranceWorld) {
                entranceWorld = {
                    x: startX,
                    z: startZ + row * this.cellSize
                };
            }
            
            // Exit (right side)
            if (maze[row][cols - 1] === '.' && !exitWorld) {
                exitWorld = {
                    x: startX + (cols - 1) * this.cellSize,
                    z: startZ + row * this.cellSize
                };
            }
        }
        
        return {
            maze,
            cellSize: this.cellSize,
            startX,
            startZ,
            width: cols * this.cellSize,
            height: rows * this.cellSize,
            entranceWorld,
            exitWorld
        };
    }
}
