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
        
        // Look velocity for continuous rotation
        this.lookVelocity = { x: 0, y: 0 };
        
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
        this.createLookJoystick();
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
     * Create look joystick for camera control
     */
    createLookJoystick() {
        const lookJoystickContainer = document.createElement('div');
        lookJoystickContainer.id = 'look-joystick';
        lookJoystickContainer.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 120px;
            height: 120px;
            border: 3px solid rgba(255, 165, 0, 0.5);
            border-radius: 50%;
            background: rgba(0, 0, 0, 0.3);
            z-index: 1000;
            display: none;
        `;
        
        // Look joystick knob
        const lookJoystickKnob = document.createElement('div');
        lookJoystickKnob.id = 'look-joystick-knob';
        lookJoystickKnob.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            width: 40px;
            height: 40px;
            background: rgba(255, 165, 0, 0.8);
            border-radius: 50%;
            transform: translate(-50%, -50%);
            transition: none;
            pointer-events: none;
        `;
        
        lookJoystickContainer.appendChild(lookJoystickKnob);
        document.body.appendChild(lookJoystickContainer);
        
        this.lookJoystick = {
            container: lookJoystickContainer,
            knob: lookJoystickKnob,
            radius: 40,
            active: false,
            touchId: null
        };
        
        this.setupLookJoystickEvents();
    }
    
    /**
     * Setup look joystick touch events
     */
    setupLookJoystickEvents() {
        const lookJoystick = this.lookJoystick;
        
        const handleStart = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const touch = e.touches[0];
            lookJoystick.active = true;
            lookJoystick.touchId = touch.identifier;
            lookJoystick.container.style.opacity = '1';
        };
        
        const handleMove = (e) => {
            if (!lookJoystick.active) return;
            e.preventDefault();
            e.stopPropagation();
            
            // Find the touch with matching ID
            let lookTouch = null;
            for (let i = 0; i < e.touches.length; i++) {
                const touch = e.touches[i];
                if (touch.identifier === lookJoystick.touchId) {
                    lookTouch = touch;
                    break;
                }
            }
            
            if (!lookTouch) return;
            
            const touch = lookTouch;
            const rect = lookJoystick.container.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            const deltaX = touch.clientX - centerX;
            const deltaY = touch.clientY - centerY;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            
            let x = deltaX;
            let y = deltaY;
            
            if (distance > lookJoystick.radius) {
                x = (deltaX / distance) * lookJoystick.radius;
                y = (deltaY / distance) * lookJoystick.radius;
            }
            
            // Position knob relative to center
            lookJoystick.knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
            
            // Set look velocity for continuous rotation
            const lookX = Math.max(-1, Math.min(1, x / lookJoystick.radius));
            const lookY = Math.max(-1, Math.min(1, y / lookJoystick.radius));
            
            // Store velocity for continuous application
            this.lookVelocity.x = lookX;
            this.lookVelocity.y = lookY; // Y-axis flipped - push up = look up
        };
        
        const handleEnd = (e) => {
            e.preventDefault();
            e.stopPropagation();
            lookJoystick.active = false;
            
            // Reset look velocity
            this.lookVelocity.x = 0;
            this.lookVelocity.y = 0;
            
            // Reset knob to center with smooth transition
            lookJoystick.knob.style.transition = 'transform 0.2s ease-out';
            lookJoystick.knob.style.transform = 'translate(-50%, -50%)';
            lookJoystick.container.style.opacity = '0.7';
            
            // Remove transition after animation completes
            setTimeout(() => {
                lookJoystick.knob.style.transition = 'none';
            }, 200);
        };
        
        lookJoystick.container.addEventListener('touchstart', handleStart);
        lookJoystick.container.addEventListener('touchmove', handleMove);
        lookJoystick.container.addEventListener('touchend', handleEnd);
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
        if (this.lookJoystick) {
            this.lookJoystick.container.style.display = 'block';
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
        if (this.lookJoystick) {
            this.lookJoystick.container.style.display = 'none';
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
     * Get responsive sizing based on screen dimensions
     */
    getResponsiveSizing() {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        const isLandscape = screenWidth > screenHeight;
        
        // Base sizes for different screen categories
        let joystickSize, actionButtonSize, fontSize;
        
        if (screenWidth <= 375) {
            // Small phones (iPhone SE, small Android)
            joystickSize = isLandscape ? 100 : 110;
            actionButtonSize = isLandscape ? 45 : 50;
            fontSize = '12px';
        } else if (screenWidth <= 414) {
            // Medium phones (iPhone 6/7/8, standard Android)
            joystickSize = isLandscape ? 110 : 120;
            actionButtonSize = isLandscape ? 50 : 55;
            fontSize = '14px';
        } else if (screenWidth <= 768) {
            // Large phones/small tablets
            joystickSize = isLandscape ? 120 : 130;
            actionButtonSize = isLandscape ? 55 : 60;
            fontSize = '16px';
        } else {
            // Tablets and larger
            joystickSize = isLandscape ? 140 : 150;
            actionButtonSize = isLandscape ? 60 : 65;
            fontSize = '18px';
        }
        
        return {
            joystickSize,
            actionButtonSize,
            fontSize,
            isLandscape,
            screenWidth,
            screenHeight
        };
    }
    
    /**
     * Get current movement values
     */
    getMovement() {
        return this.movement;
    }
    
    /**
     * Get current look velocity values
     */
    getLookVelocity() {
        return this.lookVelocity;
    }
    
    /**
     * Cleanup
     */
    dispose() {
        if (this.virtualJoystick) {
            this.virtualJoystick.container.remove();
        }
        if (this.lookJoystick) {
            this.lookJoystick.container.remove();
        }
        if (this.actionButtons) {
            this.actionButtons.remove();
        }
    }
}
