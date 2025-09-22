// Input Management - Keyboard, Mouse, Touch Controls
export class InputManager {
    constructor(game) {
        this.game = game;
        
        // Input state
        this.keys = {};
        this.mouse = { x: 0, y: 0 };
        this.isPointerLocked = false;
        
        // Touch support for mobile
        this.touches = new Map();
        this.touchControls = {
            movementArea: null,
            actionArea: null,
            joystick: null
        };
        
        // Mobile detection
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }
    
    initialize() {
        this.setupKeyboardEvents();
        this.setupMouseEvents();
        
        if (this.isMobile) {
            this.setupTouchControls();
        }
        
        console.log('🎮 Input manager initialized');
    }
    
    setupKeyboardEvents() {
        document.addEventListener('keydown', (event) => {
            this.keys[event.code] = true;
            this.handleKeyDown(event.code);
            
            // Prevent default for game keys
            if (this.isGameKey(event.code)) {
                event.preventDefault();
            }
        });
        
        document.addEventListener('keyup', (event) => {
            this.keys[event.code] = false;
            this.handleKeyUp(event.code);
        });
    }
    
    setupMouseEvents() {
        // Mouse movement
        document.addEventListener('mousemove', (event) => {
            if (this.isPointerLocked) {
                const deltaX = event.movementX || 0;
                const deltaY = event.movementY || 0;
                this.game.player.handleMouseMove(deltaX, deltaY);
            }
        });
        
        // Mouse clicks
        document.addEventListener('mousedown', (event) => {
            if (this.game.gameState === 'playing') {
                this.handleMouseClick(event.button);
            }
        });
        
        // Pointer lock events
        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement === this.game.canvas;
            
            if (!this.isPointerLocked && this.game.gameState === 'playing') {
                // Lost pointer lock during gameplay
                this.requestPointerLock();
            }
        });
        
        // Request pointer lock on canvas click
        this.game.canvas.addEventListener('click', () => {
            if (this.game.gameState === 'playing') {
                this.requestPointerLock();
            }
        });
    }
    
    setupTouchControls() {
        // Create virtual joystick and action buttons for mobile
        this.createTouchUI();
        
        // Touch event listeners
        document.addEventListener('touchstart', (event) => {
            event.preventDefault();
            this.handleTouchStart(event);
        }, { passive: false });
        
        document.addEventListener('touchmove', (event) => {
            event.preventDefault();
            this.handleTouchMove(event);
        }, { passive: false });
        
        document.addEventListener('touchend', (event) => {
            event.preventDefault();
            this.handleTouchEnd(event);
        }, { passive: false });
    }
    
    createTouchUI() {
        // Virtual joystick for movement
        const joystickContainer = document.createElement('div');
        joystickContainer.id = 'virtual-joystick';
        joystickContainer.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            width: 100px;
            height: 100px;
            background: rgba(255,255,255,0.3);
            border: 2px solid rgba(255,255,255,0.5);
            border-radius: 50%;
            display: none;
            z-index: 1000;
        `;
        
        const joystickStick = document.createElement('div');
        joystickStick.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            width: 40px;
            height: 40px;
            background: rgba(255,255,255,0.8);
            border-radius: 50%;
            transform: translate(-50%, -50%);
            transition: none;
        `;
        
        joystickContainer.appendChild(joystickStick);
        document.body.appendChild(joystickContainer);
        
        this.touchControls.joystick = {
            container: joystickContainer,
            stick: joystickStick
        };
        
        // Action buttons
        this.createActionButtons();
    }
    
    createActionButtons() {
        // Jump/Jetpack button
        const jumpBtn = document.createElement('div');
        jumpBtn.id = 'jump-btn';
        jumpBtn.innerHTML = '🚀';
        jumpBtn.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 60px;
            height: 60px;
            background: rgba(0,255,0,0.7);
            border: 2px solid #00ff00;
            border-radius: 50%;
            display: none;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            user-select: none;
            z-index: 1000;
        `;
        document.body.appendChild(jumpBtn);
        
        // Flag button
        const flagBtn = document.createElement('div');
        flagBtn.id = 'flag-btn';
        flagBtn.innerHTML = '🚩';
        flagBtn.style.cssText = `
            position: fixed;
            bottom: 100px;
            right: 30px;
            width: 50px;
            height: 50px;
            background: rgba(255,0,0,0.7);
            border: 2px solid #ff0000;
            border-radius: 50%;
            display: none;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            user-select: none;
            z-index: 1000;
        `;
        document.body.appendChild(flagBtn);
        
        this.touchControls.jumpBtn = jumpBtn;
        this.touchControls.flagBtn = flagBtn;
    }
    
    handleKeyDown(code) {
        // Pass to player
        this.game.player.handleKeyDown(code);
        
        // Game-specific controls
        switch(code) {
            case 'KeyF':
                if (this.game.gameState === 'playing') {
                    this.game.placeFlag();
                }
                break;
            case 'KeyP':
                if (this.game.gameState === 'playing') {
                    this.game.showOpeningScreen();
                }
                break;
            case 'KeyT':
                // Toggle view mode
                const newMode = this.game.player.viewMode === 'fpv' ? 'iso' : 'fpv';
                this.game.player.setViewMode(newMode);
                break;
            case 'Escape':
                if (this.game.gameState === 'playing') {
                    this.game.showOpeningScreen();
                }
                break;
        }
    }
    
    handleKeyUp(code) {
        this.game.player.handleKeyUp(code);
    }
    
    handleMouseClick(button) {
        if (button === 0) { // Left click
            // Could add interaction here
        }
    }
    
    handleTouchStart(event) {
        for (let touch of event.changedTouches) {
            const element = document.elementFromPoint(touch.clientX, touch.clientY);
            
            if (element === this.touchControls.jumpBtn) {
                this.game.player.handleKeyDown('Space');
            } else if (element === this.touchControls.flagBtn) {
                this.game.placeFlag();
            } else if (this.isInJoystickArea(touch.clientX, touch.clientY)) {
                this.handleJoystickStart(touch);
            }
            
            this.touches.set(touch.identifier, {
                x: touch.clientX,
                y: touch.clientY,
                element: element
            });
        }
    }
    
    handleTouchMove(event) {
        for (let touch of event.changedTouches) {
            const touchData = this.touches.get(touch.identifier);
            if (!touchData) continue;
            
            if (this.isInJoystickArea(touchData.x, touchData.y)) {
                this.updateJoystick(touch);
            }
        }
    }
    
    handleTouchEnd(event) {
        for (let touch of event.changedTouches) {
            const touchData = this.touches.get(touch.identifier);
            if (!touchData) continue;
            
            if (touchData.element === this.touchControls.jumpBtn) {
                this.game.player.handleKeyUp('Space');
            }
            
            this.touches.delete(touch.identifier);
        }
        
        // Reset joystick
        this.resetJoystick();
    }
    
    isInJoystickArea(x, y) {
        if (!this.touchControls.joystick) return false;
        
        const rect = this.touchControls.joystick.container.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const radius = rect.width / 2;
        
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        return distance <= radius;
    }
    
    updateJoystick(touch) {
        const container = this.touchControls.joystick.container;
        const stick = this.touchControls.joystick.stick;
        const rect = container.getBoundingClientRect();
        
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const maxRadius = rect.width / 2 - 20;
        
        const deltaX = touch.clientX - rect.left - centerX;
        const deltaY = touch.clientY - rect.top - centerY;
        const distance = Math.sqrt(deltaX ** 2 + deltaY ** 2);
        
        let stickX = deltaX;
        let stickY = deltaY;
        
        if (distance > maxRadius) {
            stickX = (deltaX / distance) * maxRadius;
            stickY = (deltaY / distance) * maxRadius;
        }
        
        stick.style.transform = `translate(${centerX + stickX - 20}px, ${centerY + stickY - 20}px)`;
        
        // Convert to movement
        const normalizedX = stickX / maxRadius;
        const normalizedY = stickY / maxRadius;
        
        // Update player movement state
        this.game.player.moveState.forward = normalizedY < -0.3;
        this.game.player.moveState.backward = normalizedY > 0.3;
        this.game.player.moveState.left = normalizedX < -0.3;
        this.game.player.moveState.right = normalizedX > 0.3;
    }
    
    resetJoystick() {
        if (this.touchControls.joystick) {
            this.touchControls.joystick.stick.style.transform = 'translate(-50%, -50%)';
        }
        
        // Reset movement
        this.game.player.moveState.forward = false;
        this.game.player.moveState.backward = false;
        this.game.player.moveState.left = false;
        this.game.player.moveState.right = false;
    }
    
    showMobileControls() {
        // Always show controls for testing (remove this.isMobile check)
        console.log('📱 Showing mobile controls, isMobile:', this.isMobile);
        
        if (this.touchControls.joystick) {
            this.touchControls.joystick.container.style.display = 'block';
        }
        if (this.touchControls.jumpBtn) {
            this.touchControls.jumpBtn.style.display = 'flex';
        }
        if (this.touchControls.flagBtn) {
            this.touchControls.flagBtn.style.display = 'flex';
        }
    }
    
    hideMobileControls() {
        if (this.touchControls.joystick) {
            this.touchControls.joystick.container.style.display = 'none';
        }
        if (this.touchControls.jumpBtn) {
            this.touchControls.jumpBtn.style.display = 'none';
        }
        if (this.touchControls.flagBtn) {
            this.touchControls.flagBtn.style.display = 'none';
        }
    }
    
    requestPointerLock() {
        if (!this.isMobile && this.game.canvas.requestPointerLock) {
            this.game.canvas.requestPointerLock();
        }
    }
    
    isGameKey(code) {
        return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyF', 'KeyT', 'KeyP'].includes(code);
    }
    
    update(deltaTime) {
        // Update input state if needed
    }
}
