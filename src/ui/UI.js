/**
 * UI System - Handles all game UI elements, menus, HUD, and screen overlays
 */
export class UI {
    constructor() {
        this.allUIElements = [
            'level-complete-screen',
            'game-over-screen', 
            'opening-screen',
            'settings-modal',
            'hud-container',
            'timer-ui',
            'flag-ui'
        ];
    }
    
    /**
     * Update timer UI in bottom-left corner
     */
    updateTimerUI(gameMode, mazeTimer, currentLevel) {
        // Only show timer in play mode
        if (gameMode !== 'play') {
            return;
        }
        
        // Create or update timer UI (bottom left, mobile responsive)
        let timerUI = document.getElementById('timer-ui');
        if (!timerUI) {
            timerUI = document.createElement('div');
            timerUI.id = 'timer-ui';
            timerUI.style.position = 'absolute';
            timerUI.style.bottom = window.innerWidth <= 768 ? '160px' : '20px'; // Above mobile controls
            timerUI.style.left = '20px';
            timerUI.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.9), rgba(0,20,40,0.9))';
            timerUI.style.border = '2px solid #00ff00';
            timerUI.style.borderRadius = '12px';
            timerUI.style.padding = window.innerWidth <= 768 ? '10px 15px' : '15px 20px';
            timerUI.style.fontFamily = "'Courier New', monospace";
            timerUI.style.fontSize = window.innerWidth <= 768 ? '14px' : '16px';
            timerUI.style.color = '#00ff00';
            timerUI.style.textShadow = '0 0 10px #00ff00';
            timerUI.style.zIndex = '1000';
            timerUI.style.minWidth = window.innerWidth <= 768 ? '150px' : '200px';
            timerUI.style.textAlign = 'center';
            document.body.appendChild(timerUI);
        }
        
        if (mazeTimer.isActive) {
            // Update current time
            const currentTime = (Date.now() - mazeTimer.startTime) / 1000;
            
            timerUI.innerHTML = `
                <div style="font-size: 12px; margin-bottom: 3px; opacity: 0.6;">LEVEL ${currentLevel}</div>
                <div style="font-size: 14px; margin-bottom: 5px; opacity: 0.8;">MAZE TIMER</div>
                <div style="font-size: 24px; font-weight: bold; color: #00ff00;">
                    ${currentTime.toFixed(0)}s
                </div>
                <div style="font-size: 12px; margin-top: 5px; opacity: 0.7;">
                    Best: ${mazeTimer.bestTime ? mazeTimer.bestTime.toFixed(0) + 's' : '--'}
                </div>
            `;
            timerUI.style.display = 'block';
        } else if (mazeTimer.hasFinished) {
            // Show final time
            timerUI.innerHTML = `
                <div style="font-size: 12px; margin-bottom: 3px; opacity: 0.6;">LEVEL ${currentLevel}</div>
                <div style="font-size: 14px; margin-bottom: 5px; opacity: 0.8;">COMPLETED</div>
                <div style="font-size: 20px; font-weight: bold; color: #00ff00;">
                    ${mazeTimer.currentTime.toFixed(0)}s
                </div>
                <div style="font-size: 12px; margin-top: 5px; opacity: 0.7;">
                    Best: ${mazeTimer.bestTime ? mazeTimer.bestTime.toFixed(0) + 's' : '--'}
                </div>
            `;
            timerUI.style.display = 'block';
        } else {
            // Hide timer when not active
            timerUI.style.display = 'none';
        }
    }
    
    /**
     * Create and update crosshair UI
     */
    updateCrosshairUI(gameMode, viewMode, gameState) {
        this.createNewCrosshair(gameMode, viewMode, gameState);
    }
    
    /**
     * Create a new crosshair system
     */
    createNewCrosshair(gameMode, viewMode, gameState) {
        // Remove any existing crosshair elements
        const existingCrosshairs = document.querySelectorAll('#crosshair, #new-crosshair');
        existingCrosshairs.forEach(el => el.remove());
        
        // Only show crosshair in FPV play mode AND when actually playing
        const shouldShow = (gameMode === 'play' && viewMode === 'fpv' && gameState === 'playing');
        
        if (shouldShow) {
            // Create completely new crosshair element
            const newCrosshair = document.createElement('div');
            newCrosshair.id = 'new-crosshair';
            newCrosshair.style.cssText = `
                position: fixed !important;
                top: 50% !important;
                left: 50% !important;
                width: 16px !important;
                height: 16px !important;
                transform: translate(-50%, -50%) !important;
                pointer-events: none !important;
                z-index: 100 !important;
                display: block !important;
                background: transparent !important;
                border: none !important;
            `;
            
            // Add inner dot - clean green crosshair
            const innerDot = document.createElement('div');
            innerDot.style.cssText = `
                position: absolute !important;
                top: 50% !important;
                left: 50% !important;
                width: 4px !important;
                height: 4px !important;
                background: #00ff00 !important;
                border-radius: 50% !important;
                transform: translate(-50%, -50%) !important;
                box-shadow: 0 0 8px #00ff00, 0 0 16px #00ff00 !important;
            `;
            
            newCrosshair.appendChild(innerDot);
            document.body.appendChild(newCrosshair);
        }
    }
    
    /**
     * Show opening screen
     */
    showOpeningScreen() {
        this.clearAllUI();
        
        const openingScreen = document.getElementById('opening-screen');
        if (openingScreen) {
            openingScreen.style.display = 'flex';
        }
        
        // Ensure cursor is visible
        document.body.style.cursor = 'default';
        document.body.style.pointerEvents = 'auto';
        
        // Exit pointer lock if active
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
        
        // Extra timeout to ensure cursor visibility
        setTimeout(() => {
            document.body.style.cursor = 'default';
        }, 100);
    }
    
    /**
     * Show level complete screen
     */
    showLevelCompleteScreen(level, time, totalScore) {
        this.clearAllUI();
        
        let levelCompleteScreen = document.getElementById('level-complete-screen');
        if (!levelCompleteScreen) {
            // Create the screen if it doesn't exist
            levelCompleteScreen = document.createElement('div');
            levelCompleteScreen.id = 'level-complete-screen';
            levelCompleteScreen.className = 'modal';
            document.body.appendChild(levelCompleteScreen);
        }
        
        levelCompleteScreen.innerHTML = `
            <div class="modal-content">
                <h2>🎉 Level ${level} Complete! 🎉</h2>
                <div class="completion-details">
                    <p><strong>Time:</strong> ${time.toFixed(0)}s</p>
                    <p><strong>Total Score:</strong> ${Math.round(totalScore)}</p>
                </div>
                <div class="button-group">
                    <button id="next-level-btn">NEXT LEVEL</button>
                    <button id="retry-level-btn">RETRY LEVEL</button>
                    <button id="back-to-menu-btn">MAIN MENU</button>
                </div>
            </div>
        `;
        
        levelCompleteScreen.style.display = 'flex';
        
        // Ensure cursor is visible
        document.body.style.cursor = 'default';
        document.body.style.pointerEvents = 'auto';
        
        // Exit pointer lock if active
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
    }
    
    /**
     * Show game over screen
     */
    showGameOverScreen() {
        this.clearAllUI();
        
        const gameOverScreen = document.getElementById('game-over-screen');
        if (gameOverScreen) {
            gameOverScreen.style.display = 'flex';
        }
        
        // Ensure cursor is visible
        document.body.style.cursor = 'default';
        document.body.style.pointerEvents = 'auto';
        
        // Exit pointer lock if active
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
    }
    
    /**
     * Hide all UI elements
     */
    clearAllUI() {
        this.allUIElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.style.display = 'none';
            }
        });
    }
    
    /**
     * Create screen flash effect
     */
    addScreenFlash(color = '#00ff00', duration = 200) {
        const flash = document.createElement('div');
        flash.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: ${color};
            opacity: 0.3;
            z-index: 9999;
            pointer-events: none;
            animation: flashFade ${duration}ms ease-out forwards;
        `;
        
        // Add CSS animation if not already present
        if (!document.getElementById('flash-styles')) {
            const style = document.createElement('style');
            style.id = 'flash-styles';
            style.textContent = `
                @keyframes flashFade {
                    0% { opacity: 0.3; }
                    50% { opacity: 0.6; }
                    100% { opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(flash);
        
        setTimeout(() => {
            if (flash.parentNode) {
                flash.parentNode.removeChild(flash);
            }
        }, duration);
    }
    
    /**
     * Update inventory/weapon UI
     */
    updateInventoryUI(weapons, currentWeaponIndex) {
        let inventoryUI = document.getElementById('inventory-ui');
        if (!inventoryUI) {
            inventoryUI = document.createElement('div');
            inventoryUI.id = 'inventory-ui';
            inventoryUI.style.cssText = `
                position: absolute;
                bottom: 20px;
                right: 20px;
                background: rgba(0, 0, 0, 0.8);
                border: 2px solid #00ff00;
                border-radius: 8px;
                padding: 10px;
                font-family: 'Courier New', monospace;
                color: #00ff00;
                z-index: 1000;
            `;
            document.body.appendChild(inventoryUI);
        }
        
        const currentWeapon = weapons[currentWeaponIndex] || 'None';
        inventoryUI.innerHTML = `
            <div style="font-size: 12px; margin-bottom: 5px;">WEAPON</div>
            <div style="font-size: 16px; font-weight: bold;">${currentWeapon.toUpperCase()}</div>
            <div style="font-size: 10px; margin-top: 5px;">${currentWeaponIndex + 1}/${weapons.length}</div>
        `;
    }
    
    /**
     * Update flag counter UI
     */
    updateFlagUI(flagCount) {
        let flagUI = document.getElementById('flag-ui');
        if (!flagUI) {
            flagUI = document.createElement('div');
            flagUI.id = 'flag-ui';
            flagUI.style.cssText = `
                position: absolute;
                top: 20px;
                right: ${window.innerWidth <= 768 ? '90px' : '20px'};
                background: rgba(0, 0, 0, 0.8);
                border: 2px solid #ff4444;
                border-radius: 8px;
                padding: ${window.innerWidth <= 768 ? '8px 12px' : '10px 15px'};
                font-family: 'Courier New', monospace;
                font-size: ${window.innerWidth <= 768 ? '12px' : '14px'};
                color: #ff4444;
                z-index: 1000;
                text-align: center;
                min-width: ${window.innerWidth <= 768 ? '60px' : '80px'};
            `;
            document.body.appendChild(flagUI);
        }
        
        flagUI.innerHTML = `
            <div style="font-size: 12px; margin-bottom: 3px;">FLAGS</div>
            <div style="font-size: 20px; font-weight: bold;">🚩 ${flagCount}</div>
            <div style="font-size: 10px; margin-top: 3px; opacity: 0.7;">Press F</div>
        `;
    }
    
    /**
     * Show notification message in top-right
     */
    showNotification(message, color = '#00ff00', duration = 2000) {
        // Remove existing notification
        const existing = document.getElementById('notification');
        if (existing) {
            existing.remove();
        }
        
        // Create new notification
        const notification = document.createElement('div');
        notification.id = 'notification';
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: rgba(0, 0, 0, 0.9);
            border: 2px solid ${color};
            border-radius: 8px;
            padding: 10px 15px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            font-weight: bold;
            color: ${color};
            z-index: 10000;
            text-align: center;
            box-shadow: 0 0 10px ${color};
            animation: slideInOut ${duration}ms ease-in-out forwards;
        `;
        
        notification.textContent = message;
        
        // Add CSS animation if not already present
        if (!document.getElementById('notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                @keyframes slideInOut {
                    0% { 
                        opacity: 0; 
                        transform: translateX(100%); 
                    }
                    15% { 
                        opacity: 1; 
                        transform: translateX(0); 
                    }
                    85% { 
                        opacity: 1; 
                        transform: translateX(0); 
                    }
                    100% { 
                        opacity: 0; 
                        transform: translateX(100%); 
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(notification);
        
        // Auto-remove after duration
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, duration);
    }
    
    /**
     * Show modal content
     */
    updateModalContent(translations, language) {
        // Implementation for settings modal and other modals
        // This would include the translation system and modal management
    }
    
    /**
     * Clean up all UI elements
     */
    dispose() {
        this.clearAllUI();
        
        // Remove dynamically created elements
        const dynamicElements = document.querySelectorAll('#timer-ui, #inventory-ui, #new-crosshair, #flash-styles, #notification, #notification-styles, #flag-ui');
        dynamicElements.forEach(el => el.remove());
    }
}
