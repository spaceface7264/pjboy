/**
 * GameState System - Manages game progression, scoring, levels, and timers
 */
export class GameState {
    constructor() {
        // Game state management
        this.gameState = 'menu'; // 'menu', 'playing', 'levelComplete', 'gameOver'
        this.currentLevel = 1;
        this.maxLevel = 10;
        this.levelStartTime = 0;
        this.levelCompleteTime = 0;
        this.playerLives = 3;
        this.totalScore = 0;
        this.levelEndWorld = null; // Position of the red exit marker
        
        // Timer system for maze solving
        this.mazeTimer = {
            isActive: false,
            startTime: 0,
            currentTime: 0,
            bestTime: null,
            hasStarted: false,
            hasFinished: false
        };
        
        // Scoring tracking
        this.levelStats = {
            enemiesNeutralized: 0,
            flagsUsed: 0
        };
        
        // Game mode
        this.gameMode = 'play'; // 'play' or 'create'
    }
    
    /**
     * Start a new level
     */
    startLevel(level = null) {
        if (level !== null) {
            this.currentLevel = level;
        }
        
        this.gameState = 'playing';
        this.levelStartTime = Date.now();
        
        // Reset level stats
        this.levelStats = {
            enemiesNeutralized: 0,
            flagsUsed: 0
        };
        
        // Reset maze timer (preserve best time)
        const prevBestTime = this.mazeTimer.bestTime;
        this.resetMazeTimer();
        this.mazeTimer.bestTime = prevBestTime;
    }
    
    /**
     * Complete the current level
     */
    completeLevel() {
        if (this.gameState !== 'playing') return;
        
        this.gameState = 'levelComplete';
        this.levelCompleteTime = Date.now();
        
        // Calculate maze completion time
        let mazeTime;
        if (this.mazeTimer.hasFinished && this.mazeTimer.currentTime > 0) {
            mazeTime = this.mazeTimer.currentTime;
        } else if (this.mazeTimer.startTime > 0) {
            mazeTime = (Date.now() - this.mazeTimer.startTime) / 1000;
        } else {
            mazeTime = (this.levelCompleteTime - this.levelStartTime) / 1000;
        }
        
        // Calculate level score using new scoring system
        const baseScore = 1000;
        const timeBonus = Math.max(0, 500 - (mazeTime * 10)); // Lose 10 points per second
        const enemyBonus = this.levelStats.enemiesNeutralized * 100; // 100 points per enemy
        const flagPenalty = this.levelStats.flagsUsed * 50; // -50 points per flag
        
        const levelScore = Math.round(Math.max(0, baseScore + timeBonus + enemyBonus - flagPenalty));
        this.totalScore = Math.round(this.totalScore + levelScore);
        
        // Update best time if this is better
        if (!this.mazeTimer.bestTime || mazeTime < this.mazeTimer.bestTime) {
            this.mazeTimer.bestTime = mazeTime;
        }
        
        return {
            level: this.currentLevel,
            time: mazeTime,
            score: levelScore,
            totalScore: this.totalScore,
            enemiesKilled: this.levelStats.enemiesNeutralized,
            flagsUsed: this.levelStats.flagsUsed
        };
    }
    
    /**
     * Advance to next level
     */
    nextLevel() {
        if (this.currentLevel < this.maxLevel) {
            this.currentLevel++;
            this.startLevel();
            return true;
        } else {
            // Game completed
            this.gameState = 'gameOver';
            return false;
        }
    }
    
    /**
     * Retry current level
     */
    retryLevel() {
        this.startLevel(this.currentLevel);
    }
    
    /**
     * Return to main menu
     */
    returnToMenu() {
        this.gameState = 'menu';
        this.resetMazeTimer();
    }
    
    /**
     * Game over
     */
    gameOver() {
        this.gameState = 'gameOver';
        this.resetMazeTimer();
    }
    
    /**
     * Start maze timer
     */
    startMazeTimer() {
        if (!this.mazeTimer.hasStarted) {
            this.mazeTimer.isActive = true;
            this.mazeTimer.startTime = Date.now();
            this.mazeTimer.hasStarted = true;
            this.mazeTimer.hasFinished = false;
            return true; // Timer was started
        }
        return false; // Timer was already started
    }
    
    /**
     * Finish maze timer
     */
    finishMazeTimer() {
        if (this.mazeTimer.isActive && !this.mazeTimer.hasFinished) {
            this.mazeTimer.isActive = false;
            this.mazeTimer.currentTime = (Date.now() - this.mazeTimer.startTime) / 1000;
            this.mazeTimer.hasFinished = true;
            
            // Update best time if this is better
            if (!this.mazeTimer.bestTime || this.mazeTimer.currentTime < this.mazeTimer.bestTime) {
                this.mazeTimer.bestTime = this.mazeTimer.currentTime;
            }
            
            return this.mazeTimer.currentTime;
        }
        return null;
    }
    
    /**
     * Reset maze timer
     */
    resetMazeTimer() {
        this.mazeTimer.isActive = false;
        this.mazeTimer.startTime = 0;
        this.mazeTimer.currentTime = 0;
        this.mazeTimer.hasStarted = false;
        this.mazeTimer.hasFinished = false;
        // Don't reset bestTime - it persists across levels
    }
    
    /**
     * Add enemy kill to stats
     */
    addEnemyKill() {
        this.levelStats.enemiesNeutralized++;
    }
    
    /**
     * Add flag usage to stats
     */
    addFlagUsage() {
        this.levelStats.flagsUsed++;
    }
    
    /**
     * Lose a life
     */
    loseLife() {
        this.playerLives--;
        if (this.playerLives <= 0) {
            this.gameOver();
            return true; // Game over
        }
        return false; // Still has lives
    }
    
    /**
     * Reset lives
     */
    resetLives() {
        this.playerLives = 3;
    }
    
    /**
     * Set game mode
     */
    setGameMode(mode) {
        this.gameMode = mode;
    }
    
    /**
     * Get current game info
     */
    getGameInfo() {
        return {
            gameState: this.gameState,
            gameMode: this.gameMode,
            currentLevel: this.currentLevel,
            maxLevel: this.maxLevel,
            playerLives: this.playerLives,
            totalScore: this.totalScore,
            mazeTimer: { ...this.mazeTimer },
            levelStats: { ...this.levelStats }
        };
    }
    
    /**
     * Check if game is in progress
     */
    isPlaying() {
        return this.gameState === 'playing';
    }
    
    /**
     * Check if level is complete
     */
    isLevelComplete() {
        return this.gameState === 'levelComplete';
    }
    
    /**
     * Check if game is over
     */
    isGameOver() {
        return this.gameState === 'gameOver';
    }
    
    /**
     * Check if on menu
     */
    isMenu() {
        return this.gameState === 'menu';
    }
    
    /**
     * Check if in play mode
     */
    isPlayMode() {
        return this.gameMode === 'play';
    }
    
    /**
     * Check if in create mode
     */
    isCreateMode() {
        return this.gameMode === 'create';
    }
}
