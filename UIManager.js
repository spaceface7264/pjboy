/**
 * UIManager - Centralized UI element caching and management
 * Replaces frequent DOM creation/destruction with cached element updates
 */
class UIManager {
    constructor(eventBus) {
        this.eventBus = eventBus;
        
        // Cached DOM elements
        this.elements = {};
        this.containers = {};
        
        // Update throttling
        this.updateThrottles = new Map();
        this.defaultThrottleTime = 16; // ~60fps
        
        // UI state tracking
        this.uiState = {
            isVisible: {},
            lastUpdate: {},
            pendingUpdates: new Set()
        };
        
        this.initializeElements();
        this.setupEventListeners();
    }

    /**
     * Initialize and cache all UI elements
     */
    initializeElements() {
        // Main game canvas
        this.cacheElement('gameCanvas', 'gameCanvas');
        
        // Game screens
        this.cacheElement('openingScreen', 'opening-screen');
        this.cacheElement('levelCompleteScreen', 'level-complete-screen');
        this.cacheElement('gameOverScreen', 'game-over-screen');
        
        // UI overlays
        this.cacheElement('uiOverlay', 'ui-overlay');
        this.cacheElement('crosshair', 'crosshair');
        this.cacheElement('messageBox', 'message-box');
        
        // Settings and modals
        this.cacheElement('settingsModal', 'settings-modal');
        this.cacheElement('drawer', 'drawer');
        
        // Game info displays
        this.cacheElement('levelInfo', 'level-info');
        this.cacheElement('playerStats', 'player-stats');
        this.cacheElement('weaponInfo', 'weapon-info');
        this.cacheElement('inventoryUI', 'inventory-ui');
        
        // Control panels
        this.cacheElement('controlsPanel', 'controls-panel');
        this.cacheElement('debugInfo', 'debug-info');
        
        // Buttons
        this.cacheElement('startButton', 'start-button');
        this.cacheElement('nextLevelButton', 'next-level-button');
        this.cacheElement('mainMenuButton', 'main-menu-button');
        this.cacheElement('restartButton', 'restart-button');
        
        // Create containers for dynamic content
        this.createContainer('hudContainer', 'position: fixed; top: 20px; left: 20px; z-index: 1000; pointer-events: none; color: white; font-family: monospace;');
        this.createContainer('messageContainer', 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 2000; pointer-events: none;');
        this.createContainer('debugContainer', 'position: fixed; bottom: 20px; left: 20px; z-index: 1000; pointer-events: none; color: #00ff00; font-family: monospace; font-size: 12px;');
        
        console.log('UIManager: Cached', Object.keys(this.elements).length, 'UI elements');
    }

    /**
     * Cache a DOM element by ID
     */
    cacheElement(key, elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            this.elements[key] = element;
            this.uiState.isVisible[key] = !element.style.display || element.style.display !== 'none';
        } else {
            console.warn(`UIManager: Element with ID '${elementId}' not found for key '${key}'`);
        }
    }

    /**
     * Create a container element for dynamic content
     */
    createContainer(key, styles = '') {
        const container = document.createElement('div');
        container.id = `ui-container-${key}`;
        container.style.cssText = styles;
        document.body.appendChild(container);
        this.containers[key] = container;
        this.elements[key] = container;
        this.uiState.isVisible[key] = true;
    }

    /**
     * Get a cached element
     */
    getElement(key) {
        return this.elements[key] || null;
    }

    /**
     * Show an element
     */
    show(key) {
        const element = this.getElement(key);
        if (element) {
            element.style.display = 'block';
            this.uiState.isVisible[key] = true;
            this.eventBus.emit('ui:elementShown', { key, element });
        }
    }

    /**
     * Hide an element
     */
    hide(key) {
        const element = this.getElement(key);
        if (element) {
            element.style.display = 'none';
            this.uiState.isVisible[key] = false;
            this.eventBus.emit('ui:elementHidden', { key, element });
        }
    }

    /**
     * Toggle element visibility
     */
    toggle(key) {
        if (this.isVisible(key)) {
            this.hide(key);
        } else {
            this.show(key);
        }
    }

    /**
     * Check if element is visible
     */
    isVisible(key) {
        return this.uiState.isVisible[key] || false;
    }

    /**
     * Hide all specified elements
     */
    hideAll(keys) {
        keys.forEach(key => this.hide(key));
    }

    /**
     * Update element content with throttling
     */
    updateElement(key, content, throttleTime = this.defaultThrottleTime) {
        const now = Date.now();
        const lastUpdate = this.uiState.lastUpdate[key] || 0;
        
        if (now - lastUpdate < throttleTime) {
            // Throttle update - schedule for later
            this.scheduleUpdate(key, content, throttleTime);
            return;
        }
        
        const element = this.getElement(key);
        if (element) {
            if (typeof content === 'string') {
                element.innerHTML = content;
            } else if (content && content.text !== undefined) {
                element.textContent = content.text;
            }
            
            this.uiState.lastUpdate[key] = now;
            this.eventBus.emit('ui:elementUpdated', { key, content, element });
        }
    }

    /**
     * Schedule a throttled update
     */
    scheduleUpdate(key, content, throttleTime) {
        if (this.updateThrottles.has(key)) {
            clearTimeout(this.updateThrottles.get(key));
        }
        
        const timeoutId = setTimeout(() => {
            this.updateElement(key, content, 0); // No throttling on scheduled update
            this.updateThrottles.delete(key);
        }, throttleTime);
        
        this.updateThrottles.set(key, timeoutId);
    }

    /**
     * Update HUD with game stats
     */
    updateHUD(gameState) {
        const hudContent = `
            <div>Level: ${gameState.currentLevel || 1}</div>
            <div>Lives: ${gameState.playerLives || 3}</div>
            <div>Score: ${gameState.totalScore || 0}</div>
            <div>HP: ${gameState.playerHP || 100}</div>
            <div>Ammo: ${gameState.playerAmmo || 0}</div>
            ${gameState.currentWeapon ? `<div>Weapon: ${gameState.currentWeapon}</div>` : ''}
        `;
        this.updateElement('hudContainer', hudContent, 100); // Update HUD at most 10 times per second
    }

    /**
     * Show a temporary message
     */
    showMessage(text, duration = 3000, type = 'info') {
        const messageElement = this.getElement('messageContainer');
        if (messageElement) {
            const messageClass = type === 'error' ? 'error-message' : 'info-message';
            messageElement.innerHTML = `<div class="${messageClass}" style="
                background: ${type === 'error' ? 'rgba(255,0,0,0.8)' : 'rgba(0,0,0,0.8)'};
                color: white;
                padding: 20px;
                border-radius: 10px;
                text-align: center;
                font-family: monospace;
                animation: fadeInOut ${duration}ms ease-in-out;
            ">${text}</div>`;
            
            // Auto-hide after duration
            setTimeout(() => {
                if (messageElement.innerHTML.includes(text)) {
                    messageElement.innerHTML = '';
                }
            }, duration);
            
            this.eventBus.emit('ui:messageShown', { text, duration, type });
        }
    }

    /**
     * Update weapon display
     */
    updateWeaponDisplay(weaponData) {
        const weaponElement = this.getElement('weaponInfo');
        if (weaponElement && weaponData) {
            const cooldownBar = weaponData.cooldown > 0 ? 
                `<div style="width: 100px; height: 5px; background: #333; border: 1px solid #fff;">
                    <div style="width: ${(1 - weaponData.cooldown / weaponData.maxCooldown) * 100}%; height: 100%; background: #0f0;"></div>
                </div>` : '';
            
            const content = `
                <div>${weaponData.icon} ${weaponData.name}</div>
                <div>Damage: ${weaponData.damage}</div>
                <div>Range: ${weaponData.range}</div>
                ${cooldownBar}
            `;
            this.updateElement('weaponInfo', content, 50);
        }
    }

    /**
     * Update debug information display
     */
    updateDebugInfo(debugData) {
        const debugLines = [];
        
        if (debugData.position) {
            debugLines.push(`Pos: ${debugData.position.x.toFixed(1)}, ${debugData.position.y.toFixed(1)}, ${debugData.position.z.toFixed(1)}`);
        }
        
        if (debugData.viewMode) {
            debugLines.push(`View: ${debugData.viewMode}`);
        }
        
        if (debugData.fps !== undefined) {
            debugLines.push(`FPS: ${debugData.fps}`);
        }
        
        if (debugData.enemies !== undefined) {
            debugLines.push(`Enemies: ${debugData.enemies}`);
        }
        
        const content = debugLines.join('<br>');
        this.updateElement('debugContainer', content, 250); // Update debug info 4 times per second
    }

    /**
     * Set up event listeners for UI events
     */
    setupEventListeners() {
        // Listen for game state changes
        this.eventBus.on('gameStateChanged', (data) => {
            this.handleGameStateChange(data);
        });
        
        // Listen for UI-specific events
        this.eventBus.on('ui:showMessage', (data) => {
            this.showMessage(data.text, data.duration, data.type);
        });
        
        this.eventBus.on('ui:updateHUD', (data) => {
            this.updateHUD(data);
        });
        
        this.eventBus.on('ui:updateWeapon', (data) => {
            this.updateWeaponDisplay(data);
        });
        
        this.eventBus.on('ui:updateDebug', (data) => {
            this.updateDebugInfo(data);
        });
    }

    /**
     * Handle game state changes
     */
    handleGameStateChange(data) {
        const { newState, oldState } = data;
        
        switch (newState) {
            case 'menu':
                this.show('openingScreen');
                this.hideAll(['levelCompleteScreen', 'gameOverScreen', 'hudContainer']);
                break;
                
            case 'playing':
                this.hideAll(['openingScreen', 'levelCompleteScreen', 'gameOverScreen']);
                this.show('hudContainer');
                break;
                
            case 'levelComplete':
                this.show('levelCompleteScreen');
                break;
                
            case 'gameOver':
                this.show('gameOverScreen');
                break;
        }
        
        this.eventBus.emit('ui:gameStateHandled', { newState, oldState });
    }

    /**
     * Update crosshair visibility based on view mode
     */
    updateCrosshairVisibility(viewMode) {
        const crosshair = this.getElement('crosshair');
        if (crosshair) {
            if (viewMode === 'fpv') {
                this.show('crosshair');
            } else {
                this.hide('crosshair');
            }
        }
    }

    /**
     * Batch update multiple elements
     */
    batchUpdate(updates) {
        updates.forEach(({ key, content, throttleTime }) => {
            this.updateElement(key, content, throttleTime);
        });
    }

    /**
     * Clear all throttled updates
     */
    clearThrottles() {
        this.updateThrottles.forEach(timeoutId => clearTimeout(timeoutId));
        this.updateThrottles.clear();
    }

    /**
     * Get UI state for debugging
     */
    getUIState() {
        return {
            elements: Object.keys(this.elements),
            containers: Object.keys(this.containers),
            visible: this.uiState.isVisible,
            pendingThrottles: this.updateThrottles.size
        };
    }

    /**
     * Destroy the UI manager and clean up
     */
    destroy() {
        this.clearThrottles();
        
        // Remove created containers
        Object.values(this.containers).forEach(container => {
            if (container.parentNode) {
                container.parentNode.removeChild(container);
            }
        });
        
        this.elements = {};
        this.containers = {};
        this.uiState = { isVisible: {}, lastUpdate: {}, pendingUpdates: new Set() };
        
        console.log('UIManager destroyed');
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIManager;
} else {
    window.UIManager = UIManager;
}
