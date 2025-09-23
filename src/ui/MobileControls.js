/**
 * Mobile Controls - Touch-based controls for mobile devices
 */
export class MobileControls {
    constructor() {
        this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        this.virtualJoystick = null;
        this.lookArea = null;
        this.actionButtons = null;
        
        // Touch state
        this.movement = { x: 0, y: 0 };
        this.looking = false;
        this.lastLookTouch = null;
        
        // Callbacks
        this.onMovement = null;
        this.onLook = null;
        this.onAction = null;
        
        if (this.isTouch) {
            this.createMobileUI();
        }
    }
    
    /**
     * Create mobile UI elements
     */
    createMobileUI() {
        this.createVirtualJoystick();
        this.createLookArea();
        this.createActionButtons();
    }
    
    /**
     * Create virtual joystick for movement
     */
    createVirtualJoystick() {
        // Joystick container
        const joystickContainer = document.createElement('div');
        joystickContainer.id = 'virtual-joystick';
        joystickContainer.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            width: 120px;
            height: 120px;
            border: 3px solid rgba(0, 255, 0, 0.5);
            border-radius: 50%;
            background: rgba(0, 0, 0, 0.3);
            z-index: 1000;
            display: none;
        `;
        
        // Joystick knob
        const joystickKnob = document.createElement('div');
        joystickKnob.id = 'joystick-knob';
        joystickKnob.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            width: 40px;
            height: 40px;
            background: rgba(0, 255, 0, 0.8);
            border-radius: 50%;
            transform: translate(-50%, -50%);
            transition: all 0.1s ease;
            box-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
        `;
        
        joystickContainer.appendChild(joystickKnob);
        document.body.appendChild(joystickContainer);
        
        this.virtualJoystick = {
            container: joystickContainer,
            knob: joystickKnob,
            center: { x: 60, y: 60 },
            radius: 40,
            active: false
        };
        
        this.setupJoystickEvents();
    }
    
    /**
     * Setup joystick touch events
     */
    setupJoystickEvents() {
        const joystick = this.virtualJoystick;
        
        const handleStart = (e) => {
            e.preventDefault();
            joystick.active = true;
            joystick.container.style.opacity = '1';
            
            // Store the touch ID for this joystick
            const touch = e.touches[0];
            joystick.touchId = touch.identifier;
        };
        
        const handleMove = (e) => {
            if (!joystick.active) return;
            e.preventDefault();
            e.stopPropagation();
            
            // Find the touch with matching ID
            let joystickTouch = null;
            for (let i = 0; i < e.touches.length; i++) {
                const touch = e.touches[i];
                if (touch.identifier === joystick.touchId) {
                    joystickTouch = touch;
                    break;
                }
            }
            
            if (!joystickTouch) return;
            
            const touch = joystickTouch;
            const rect = joystick.container.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            const deltaX = touch.clientX - centerX;
            const deltaY = touch.clientY - centerY;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            
            let x = deltaX;
            let y = deltaY;
            
            if (distance > joystick.radius) {
                x = (deltaX / distance) * joystick.radius;
                y = (deltaY / distance) * joystick.radius;
            }
            
            // Position knob relative to center (not translate from center)
            joystick.knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
            
            // Normalize movement values with better precision
            this.movement.x = Math.max(-1, Math.min(1, x / joystick.radius));
            this.movement.y = Math.max(-1, Math.min(1, y / joystick.radius));
            
            if (this.onMovement) {
                this.onMovement(this.movement);
            }
        };
        
        const handleEnd = (e) => {
            e.preventDefault();
            e.stopPropagation();
            joystick.active = false;
            
            // Reset knob to center with smooth transition
            joystick.knob.style.transition = 'transform 0.2s ease-out';
            joystick.knob.style.transform = 'translate(-50%, -50%)';
            joystick.container.style.opacity = '0.7';
            
            // Remove transition after animation completes
            setTimeout(() => {
                joystick.knob.style.transition = 'none';
            }, 200);
            
            this.movement = { x: 0, y: 0 };
            if (this.onMovement) {
                this.onMovement(this.movement);
            }
        };
        
        joystick.container.addEventListener('touchstart', handleStart);
        joystick.container.addEventListener('touchmove', handleMove);
        joystick.container.addEventListener('touchend', handleEnd);
    }
    
    /**
     * Create look area for camera control
     */
    createLookArea() {
        const lookArea = document.createElement('div');
        lookArea.id = 'look-area';
        lookArea.style.cssText = `
            position: fixed;
            top: 0;
            right: 0;
            width: 70%;
            height: 70%;
            z-index: 999;
            display: none;
            background: transparent;
            border: none;
            pointer-events: auto;
        `;
        
        // Look area is now invisible - no instructions needed
        
        document.body.appendChild(lookArea);
        this.lookArea = lookArea;
        
        this.setupLookEvents();
    }
    
    /**
     * Setup look area touch events
     */
    setupLookEvents() {
        const handleStart = (e) => {
            e.preventDefault();
            this.looking = true;
            
            // Find the touch that's in the look area
            let lookTouch = null;
            for (let i = 0; i < e.touches.length; i++) {
                const touch = e.touches[i];
                const rect = this.lookArea.getBoundingClientRect();
                if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
                    touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
                    lookTouch = touch;
                    break;
                }
            }
            
            if (lookTouch) {
                this.lastLookTouch = {
                    x: lookTouch.clientX,
                    y: lookTouch.clientY,
                    id: lookTouch.identifier
                };
            }
        };
        
        const handleMove = (e) => {
            if (!this.looking || !this.lastLookTouch) return;
            e.preventDefault();
            
            // Find the touch with matching ID
            let lookTouch = null;
            for (let i = 0; i < e.touches.length; i++) {
                const touch = e.touches[i];
                if (touch.identifier === this.lastLookTouch.id) {
                    lookTouch = touch;
                    break;
                }
            }
            
            if (lookTouch) {
                const deltaX = lookTouch.clientX - this.lastLookTouch.x;
                const deltaY = lookTouch.clientY - this.lastLookTouch.y;
                
                if (this.onLook) {
                    // Classic FPS mobile: swipe right=look right, swipe up=look up  
                    this.onLook(deltaX * 0.001, -deltaY * 0.001);
                }
                
                this.lastLookTouch = {
                    x: lookTouch.clientX,
                    y: lookTouch.clientY,
                    id: lookTouch.identifier
                };
            }
        };
        
        const handleEnd = (e) => {
            e.preventDefault();
            this.looking = false;
            this.lastLookTouch = null;
        };
        
        this.lookArea.addEventListener('touchstart', handleStart);
        this.lookArea.addEventListener('touchmove', handleMove);
        this.lookArea.addEventListener('touchend', handleEnd);
    }
    
    /**
     * Create action buttons
     */
    createActionButtons() {
        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'action-buttons';
        buttonContainer.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            display: none;
            flex-direction: column;
            gap: 10px;
            z-index: 1000;
        `;
        
        // Flag button
        const flagButton = this.createActionButton('F', '🚩', 'Place Flag');
        buttonContainer.appendChild(flagButton);
        
        document.body.appendChild(buttonContainer);
        this.actionButtons = buttonContainer;
    }
    
    /**
     * Create individual action button
     */
    createActionButton(key, icon, label) {
        const button = document.createElement('button');
        button.style.cssText = `
            width: 60px;
            height: 60px;
            border: 2px solid rgba(0, 255, 0, 0.8);
            border-radius: 50%;
            background: rgba(0, 0, 0, 0.7);
            color: #00ff00;
            font-size: 24px;
            font-family: 'Courier New', monospace;
            cursor: pointer;
            box-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
            transition: all 0.1s ease;
        `;
        
        button.innerHTML = icon;
        button.title = label;
        
        button.addEventListener('touchstart', (e) => {
            e.preventDefault();
            button.style.transform = 'scale(0.9)';
            button.style.boxShadow = '0 0 20px rgba(0, 255, 0, 0.6)';
            
            if (this.onAction) {
                this.onAction(key);
            }
        });
        
        button.addEventListener('touchend', (e) => {
            e.preventDefault();
            button.style.transform = 'scale(1)';
            button.style.boxShadow = '0 0 10px rgba(0, 255, 0, 0.3)';
        });
        
        return button;
    }
    
    /**
     * Show mobile controls
     */
    show() {
        if (!this.isTouch) return;
        
        if (this.virtualJoystick) {
            this.virtualJoystick.container.style.display = 'block';
        }
        if (this.lookArea) {
            this.lookArea.style.display = 'block';
        }
        if (this.actionButtons) {
            this.actionButtons.style.display = 'flex';
        }
    }
    
    /**
     * Hide mobile controls
     */
    hide() {
        if (this.virtualJoystick) {
            this.virtualJoystick.container.style.display = 'none';
        }
        if (this.lookArea) {
            this.lookArea.style.display = 'none';
        }
        if (this.actionButtons) {
            this.actionButtons.style.display = 'none';
        }
    }
    
    /**
     * Check if device is mobile
     */
    isMobile() {
        return this.isTouch;
    }
    
    /**
     * Get current movement values
     */
    getMovement() {
        return this.movement;
    }
    
    /**
     * Cleanup
     */
    dispose() {
        if (this.virtualJoystick) {
            this.virtualJoystick.container.remove();
        }
        if (this.lookArea) {
            this.lookArea.remove();
        }
        if (this.actionButtons) {
            this.actionButtons.remove();
        }
    }
}
