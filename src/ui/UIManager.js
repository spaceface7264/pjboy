// UI Management - All UI Creation and Updates
export class UIManager {
    constructor(game) {
        this.game = game;
        
        // UI state
        this.currentScreen = 'menu';
        this.uiElements = new Map();
        
        // Timer UI
        this.timerUI = null;
        
        // Mobile UI
        this.mobileUI = {
            inventory: null,
            minimap: null
        };
    }
    
    initialize() {
        this.createBaseUI();
        this.setupEventListeners();
        console.log('🎨 UI Manager initialized');
    }
    
    createBaseUI() {
        // Create crosshair for FPV mode
        this.createCrosshair();
        
        // Create mobile-optimized inventory UI
        this.createInventoryUI();
        
        // Create timer UI
        this.createTimerUI();
    }
    
    createCrosshair() {
        const crosshair = document.createElement('div');
        crosshair.id = 'crosshair';
        crosshair.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 4px;
            height: 4px;
            background: #00ff00;
            border-radius: 50%;
            box-shadow: 0 0 10px #00ff00;
            display: none;
            z-index: 100;
            pointer-events: none;
        `;
        document.body.appendChild(crosshair);
        this.uiElements.set('crosshair', crosshair);
    }
    
    createInventoryUI() {
        const inventoryUI = document.createElement('div');
        inventoryUI.id = 'inventory-ui';
        inventoryUI.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            border: 2px solid #00ff00;
            border-radius: 8px;
            padding: 15px;
            font-family: 'Courier New', monospace;
            color: #00ff00;
            font-size: 14px;
            display: none;
            z-index: 1000;
            min-width: 120px;
        `;
        
        document.body.appendChild(inventoryUI);
        this.uiElements.set('inventory', inventoryUI);
    }
    
    createTimerUI() {
        const timerUI = document.createElement('div');
        timerUI.id = 'timer-ui';
        timerUI.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: linear-gradient(135deg, rgba(0,0,0,0.9), rgba(0,20,40,0.9));
            border: 2px solid #00ff00;
            border-radius: 12px;
            padding: 15px 20px;
            font-family: 'Courier New', monospace;
            font-size: 16px;
            color: #00ff00;
            text-shadow: 0 0 10px #00ff00;
            display: none;
            z-index: 1000;
            min-width: 200px;
            text-align: center;
        `;
        
        document.body.appendChild(timerUI);
        this.timerUI = timerUI;
        this.uiElements.set('timer', timerUI);
    }
    
    setupEventListeners() {
        // Start game button
        document.addEventListener('click', (event) => {
            if (event.target.id === 'start-game-btn') {
                this.game.startLevel(1);
            } else if (event.target.id === 'next-level-btn') {
                this.game.startLevel(this.game.currentLevel + 1);
            } else if (event.target.id === 'retry-level-btn') {
                this.game.startLevel(this.game.currentLevel);
            } else if (event.target.id === 'main-menu-btn') {
                this.game.showOpeningScreen();
            }
        });
    }
    
    showOpeningScreen() {
        this.currentScreen = 'menu';
        this.hideAllGameUI();
        
        // Show opening screen elements
        const openingScreen = document.getElementById('opening-screen');
        if (openingScreen) {
            openingScreen.style.display = 'flex';
        }
        
        // Hide mobile controls
        this.game.inputManager.hideMobileControls();
        
        // Ensure cursor is visible
        document.body.style.cursor = 'default';
        document.body.style.pointerEvents = 'auto';
        
        // Exit pointer lock
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
    }
    
    showGameplayUI() {
        this.currentScreen = 'playing';
        
        // Hide menu screens
        const openingScreen = document.getElementById('opening-screen');
        if (openingScreen) {
            openingScreen.style.display = 'none';
        }
        
        const levelCompleteScreen = document.getElementById('level-complete-screen');
        if (levelCompleteScreen) {
            levelCompleteScreen.style.display = 'none';
        }
        
        // Show game UI
        this.updateCrosshair();
        this.updateInventoryUI();
        
        // Always show mobile controls for testing
        this.game.inputManager.showMobileControls();
        console.log('📱 Mobile controls should be visible now');
    }
    
    showLevelCompleteScreen(data) {
        this.currentScreen = 'complete';
        this.hideAllGameUI();
        
        const screen = document.getElementById('level-complete-screen');
        if (screen) {
            screen.style.display = 'flex';
            
            // Update content
            const levelText = screen.querySelector('#level-complete-level');
            const timeText = screen.querySelector('#level-complete-time');
            const scoreText = screen.querySelector('#level-complete-score');
            
            if (levelText) levelText.textContent = `Level ${data.level}`;
            if (timeText) timeText.textContent = `Time: ${data.time.toFixed(0)}s`;
            if (scoreText) scoreText.textContent = `Total Score: ${data.totalScore}`;
        }
        
        // Hide mobile controls
        this.game.inputManager.hideMobileControls();
        
        // Ensure cursor is visible
        document.body.style.cursor = 'default';
        document.body.style.pointerEvents = 'auto';
        
        // Exit pointer lock
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
    }
    
    hideAllGameUI() {
        // Hide crosshair
        const crosshair = this.uiElements.get('crosshair');
        if (crosshair) crosshair.style.display = 'none';
        
        // Hide inventory
        const inventory = this.uiElements.get('inventory');
        if (inventory) inventory.style.display = 'none';
        
        // Hide timer
        if (this.timerUI) this.timerUI.style.display = 'none';
    }
    
    updateCrosshair() {
        const crosshair = this.uiElements.get('crosshair');
        if (!crosshair) return;
        
        const shouldShow = (
            this.game.gameState === 'playing' && 
            this.game.player.viewMode === 'fpv' &&
            !this.game.inputManager.isMobile
        );
        
        crosshair.style.display = shouldShow ? 'block' : 'none';
    }
    
    updateInventoryUI() {
        const inventoryUI = this.uiElements.get('inventory');
        if (!inventoryUI) return;
        
        if (this.game.gameState === 'playing') {
            inventoryUI.style.display = 'block';
            inventoryUI.innerHTML = `
                <div style="margin-bottom: 8px; font-weight: bold; text-align: center;">INVENTORY</div>
                <div>🚩 Flags: ${this.game.inventory.flags}</div>
                <div>⛽ Jetpack: ${Math.round(this.game.inventory.jetpackFuel)}%</div>
            `;
        } else {
            inventoryUI.style.display = 'none';
        }
    }
    
    updateTimerUI() {
        if (!this.timerUI) return;
        
        if (this.game.gameState !== 'playing') {
            this.timerUI.style.display = 'none';
            return;
        }
        
        const timer = this.game.mazeTimer;
        
        if (timer.isActive) {
            this.timerUI.style.display = 'block';
            this.timerUI.innerHTML = `
                <div style="font-size: 12px; margin-bottom: 3px; opacity: 0.6;">LEVEL ${this.game.currentLevel}</div>
                <div style="font-size: 14px; margin-bottom: 5px; opacity: 0.8;">MAZE TIMER</div>
                <div style="font-size: 24px; font-weight: bold; color: #00ff00;">
                    ${timer.currentTime.toFixed(0)}s
                </div>
                <div style="font-size: 12px; margin-top: 5px; opacity: 0.7;">
                    Best: ${timer.bestTime ? timer.bestTime.toFixed(0) + 's' : '--'}
                </div>
            `;
        } else if (timer.hasFinished) {
            this.timerUI.innerHTML = `
                <div style="font-size: 12px; margin-bottom: 3px; opacity: 0.6;">LEVEL ${this.game.currentLevel}</div>
                <div style="font-size: 14px; margin-bottom: 5px; opacity: 0.8;">COMPLETED</div>
                <div style="font-size: 20px; font-weight: bold; color: #00ff00;">
                    ${timer.currentTime.toFixed(0)}s
                </div>
                <div style="font-size: 12px; margin-top: 5px; opacity: 0.7;">
                    Best: ${timer.bestTime ? timer.bestTime.toFixed(0) + 's' : '--'}
                </div>
            `;
        } else {
            this.timerUI.style.display = 'none';
        }
    }
    
    updateAll() {
        this.updateCrosshair();
        this.updateInventoryUI();
        this.updateTimerUI();
    }
    
    update(deltaTime) {
        // Update any animated UI elements
        if (this.game.mazeTimer.isActive) {
            this.updateTimerUI();
        }
    }
    
    // Mobile-specific UI helpers
    showMobileInventory() {
        if (!this.game.inputManager.isMobile) return;
        
        // Create mobile-optimized inventory overlay
        let mobileInventory = document.getElementById('mobile-inventory');
        if (!mobileInventory) {
            mobileInventory = document.createElement('div');
            mobileInventory.id = 'mobile-inventory';
            mobileInventory.style.cssText = `
                position: fixed;
                top: 10px;
                left: 10px;
                right: 10px;
                background: rgba(0, 0, 0, 0.8);
                border: 1px solid #00ff00;
                border-radius: 8px;
                padding: 10px;
                font-family: 'Courier New', monospace;
                color: #00ff00;
                font-size: 12px;
                z-index: 999;
                display: flex;
                justify-content: space-between;
            `;
            document.body.appendChild(mobileInventory);
        }
        
        mobileInventory.innerHTML = `
            <div>🚩 ${this.game.inventory.flags}</div>
            <div>Level ${this.game.currentLevel}</div>
            <div>⛽ ${Math.round(this.game.inventory.jetpackFuel)}%</div>
        `;
        
        mobileInventory.style.display = this.game.gameState === 'playing' ? 'flex' : 'none';
    }
}
