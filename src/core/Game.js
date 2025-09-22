// Core Game Class - Refactored for Mobile
import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { MazeGenerator } from '../maze/MazeGenerator.js';
import { Player } from '../systems/Player.js';
import { UIManager } from '../ui/UIManager.js';
import { InputManager } from './InputManager.js';
import { SceneManager } from './SceneManager.js';

export class Game {
    constructor({ container, canvas }) {
        // Core references
        this.container = container;
        this.canvas = canvas;
        
        // Initialize core systems
        this.sceneManager = new SceneManager();
        this.inputManager = new InputManager(this);
        this.mazeGenerator = new MazeGenerator();
        
        // Game state
        this.gameState = 'menu'; // 'menu', 'playing', 'levelComplete', 'gameOver'
        this.gameMode = 'play';  // 'play', 'create'
        this.currentLevel = 1;
        this.totalScore = 0;
        
        // Player system
        this.player = new Player(this);
        
        // Mobile optimizations
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        // Timer system for maze solving
        this.mazeTimer = {
            isActive: false,
            startTime: 0,
            currentTime: 0,
            bestTime: null,
            hasStarted: false,
            hasFinished: false
        };
        
        // Simplified inventory - only flag and jetpack
        this.inventory = {
            flags: 20,
            jetpackFuel: 100
        };
        
        // Level stats
        this.levelStats = {
            flagsUsed: 0
        };
        
        // Theme system
        this.themeName = 'desert';
        this.themes = {
            desert: {
                ground: 0xc2b280,
                grid: 0xffe8a0,
                wall: 0xa68a5b,
                wallEmissive: 0x3b2c14,
                sky: 0xdfe6ff,
                ambient: 0x705f3a,
                directional: 0xffeedd,
                fog: 0xdfe6ff,
                fogNear: 30,
                fogFar: 100
            }
        };
        
        // Placed flags tracking
        this.placedFlags = [];
        this.flagRemoveRadiusSq = 25;
        
        // Clock for animations
        this.clock = new THREE.Clock();
    }
    
    async start() {
        try {
            // Initialize Three.js scene
            await this.sceneManager.initialize(this.canvas);
            
            // Setup input handling
            this.inputManager.initialize();
            
            // Initialize UI Manager after other systems are ready
            this.uiManager = new UIManager(this);
            this.uiManager.initialize();
            
            // Create initial environment
            this.createEnvironment();
            
            // Start render loop
            this.startRenderLoop();
            
            // Show opening screen
            this.showOpeningScreen();
            
            console.log('🎮 Game started successfully!');
        } catch (error) {
            console.error('Failed to start game:', error);
        }
    }
    
    createEnvironment() {
        this.sceneManager.createEnvironment(this.themes[this.themeName]);
        this.player.initialize(this.sceneManager.scene);
    }
    
    startLevel(level = 1) {
        this.currentLevel = level;
        this.gameState = 'playing';
        
        // Reset level stats
        this.levelStats.flagsUsed = 0;
        
        // Generate ASCII maze
        const maze = this.mazeGenerator.generateByDifficulty(level);
        console.log('🎯 Generated maze:', maze.length + 'x' + maze[0].length);
        
        this.sceneManager.createMaze(maze, this.themes[this.themeName]);
        console.log('🏗️ Maze created, walls count:', this.sceneManager.walls.length);
        
        // Position player outside maze entrance
        this.player.spawnAtMazeEntrance(this.sceneManager.mazeInfo);
        
        // Reset timer
        this.resetMazeTimer();
        
        // Update UI
        this.uiManager.showGameplayUI();
        this.uiManager.updateAll();
    }
    
    startMazeTimer() {
        if (!this.mazeTimer.hasStarted) {
            this.mazeTimer.isActive = true;
            this.mazeTimer.startTime = Date.now();
            this.mazeTimer.hasStarted = true;
            console.log('⏱️ Maze timer started!');
        }
    }
    
    finishMazeTimer() {
        if (this.mazeTimer.isActive) {
            this.mazeTimer.currentTime = (Date.now() - this.mazeTimer.startTime) / 1000;
            this.mazeTimer.isActive = false;
            this.mazeTimer.hasFinished = true;
            
            // Update best time
            if (!this.mazeTimer.bestTime || this.mazeTimer.currentTime < this.mazeTimer.bestTime) {
                this.mazeTimer.bestTime = this.mazeTimer.currentTime;
            }
            
            console.log(`⏱️ Maze completed in ${this.mazeTimer.currentTime.toFixed(1)}s!`);
        }
    }
    
    resetMazeTimer() {
        const previousBest = this.mazeTimer.bestTime;
        this.mazeTimer = {
            isActive: false,
            startTime: 0,
            currentTime: 0,
            bestTime: previousBest,
            hasStarted: false,
            hasFinished: false
        };
    }
    
    completeLevel() {
        this.finishMazeTimer();
        
        // Calculate score (simplified - no enemies, just time and flags)
        const baseScore = 1000;
        const mazeTime = this.mazeTimer.currentTime || 0;
        const timeBonus = Math.max(0, 300 - (mazeTime * 10)); // Bonus for speed
        const flagPenalty = this.levelStats.flagsUsed * 50; // Penalty for using flags
        
        const levelScore = Math.round(Math.max(0, baseScore + timeBonus - flagPenalty));
        this.totalScore = Math.round(this.totalScore + levelScore);
        
        // Show completion screen
        this.gameState = 'levelComplete';
        this.uiManager.showLevelCompleteScreen({
            level: this.currentLevel,
            time: mazeTime,
            score: levelScore,
            totalScore: this.totalScore
        });
    }
    
    placeFlag() {
        if (this.inventory.flags > 0) {
            const flagPos = this.player.getPosition().clone();
            flagPos.y += 1; // Raise flag above ground
            
            this.sceneManager.createFlag(flagPos);
            this.placedFlags.push(flagPos);
            
            this.inventory.flags--;
            this.levelStats.flagsUsed++;
            
            console.log(`🚩 Flag placed! (${this.inventory.flags} remaining)`);
            this.uiManager.updateInventoryUI();
        }
    }
    
    useJetpack(deltaTime) {
        if (this.inventory.jetpackFuel > 0) {
            this.inventory.jetpackFuel = Math.max(0, this.inventory.jetpackFuel - deltaTime * 20);
            this.player.enableJetpack();
            this.uiManager.updateInventoryUI();
            return true;
        }
        return false;
    }
    
    showOpeningScreen() {
        this.gameState = 'menu';
        this.uiManager.showOpeningScreen();
    }
    
    startRenderLoop() {
        const animate = () => {
            requestAnimationFrame(animate);
            
            const deltaTime = this.clock.getDelta();
            
            // Update systems
            this.player.update(deltaTime);
            this.inputManager.update(deltaTime);
            this.uiManager.update(deltaTime);
            
            // Update timer UI if active
            if (this.mazeTimer.isActive) {
                this.mazeTimer.currentTime = (Date.now() - this.mazeTimer.startTime) / 1000;
                this.uiManager.updateTimerUI();
            }
            
            // Render scene
            this.sceneManager.render();
        };
        
        animate();
    }
    
    // Simplified objective checking - only start/end markers
    checkObjectives() {
        if (this.gameState !== 'playing') return;
        
        const playerPos = this.player.getPosition();
        const mazeInfo = this.sceneManager.mazeInfo;
        
        if (mazeInfo.startMarker && mazeInfo.endMarker) {
            // Check start marker collision
            if (!this.mazeTimer.hasStarted && 
                playerPos.distanceToSquared(mazeInfo.startMarker.position) < 4) {
                this.startMazeTimer();
            }
            
            // Check end marker collision
            if (this.mazeTimer.hasStarted && 
                playerPos.distanceToSquared(mazeInfo.endMarker.position) < 4) {
                this.completeLevel();
            }
        }
    }
}
