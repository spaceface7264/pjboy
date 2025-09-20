/**
 * InputManager - Centralized input handling system
 * Consolidates all keyboard/mouse event listeners and emits events
 */
class InputManager {
    constructor(eventBus) {
        this.eventBus = eventBus;
        
        // Input state tracking
        this.keys = {};
        this.mouse = { x: 0, y: 0 };
        this.isPointerLocked = false;
        
        // Mouse state
        this.mouseNDC = { x: 0, y: 0 }; // Normalized device coordinates
        this.lastMouseX = null;
        this.lastMouseY = null;
        
        // Continuous input tracking
        this.inputState = {
            movement: { forward: false, backward: false, left: false, right: false },
            actions: { firing: false, sprinting: false, jumping: false },
            mouse: { deltaX: 0, deltaY: 0 }
        };
        
        // Input configuration
        this.mouseSensitivity = 0.002;
        this.invertMouseY = false;
        
        this.setupEventListeners();
    }

    /**
     * Set up all input event listeners
     */
    setupEventListeners() {
        // Keyboard events
        document.addEventListener('keydown', (event) => this.handleKeyDown(event));
        document.addEventListener('keyup', (event) => this.handleKeyUp(event));
        
        // Mouse events
        document.addEventListener('mousemove', (event) => this.handleMouseMove(event));
        document.addEventListener('mousedown', (event) => this.handleMouseDown(event));
        document.addEventListener('mouseup', (event) => this.handleMouseUp(event));
        document.addEventListener('click', (event) => this.handleClick(event));
        document.addEventListener('wheel', (event) => this.handleWheel(event));
        
        // Pointer lock events
        document.addEventListener('pointerlockchange', () => this.handlePointerLockChange());
        document.addEventListener('pointerlockerror', () => this.handlePointerLockError());
        
        // Window events
        window.addEventListener('resize', () => this.handleResize());
        window.addEventListener('blur', () => this.handleWindowBlur());
        window.addEventListener('focus', () => this.handleWindowFocus());
    }

    /**
     * Handle key down events
     */
    handleKeyDown(event) {
        // Update key state
        this.keys[event.code] = true;
        
        // Emit raw key event
        this.eventBus.emit('input:keydown', {
            code: event.code,
            key: event.key,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
            repeat: event.repeat
        });
        
        // Update movement state
        this.updateMovementState();
        
        // Handle special keys
        this.handleSpecialKeys(event);
    }

    /**
     * Handle key up events
     */
    handleKeyUp(event) {
        // Update key state
        this.keys[event.code] = false;
        
        // Emit raw key event
        this.eventBus.emit('input:keyup', {
            code: event.code,
            key: event.key,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey
        });
        
        // Update movement state
        this.updateMovementState();
    }

    /**
     * Handle special key combinations and actions
     */
    handleSpecialKeys(event) {
        // Prevent defaults for game keys
        const gameKeys = [
            'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight',
            'KeyV', 'KeyP', 'KeyH', 'KeyT', 'KeyF', 'KeyM', 'KeyI',
            'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Escape', 'Tab',
            'MetaLeft', 'MetaRight', 'KeyO', 'KeyQ', 'KeyE', 'KeyY', 'KeyU'
        ];
        
        if (gameKeys.includes(event.code)) {
            event.preventDefault();
        }
        
        // Emit specific action events
        if (event.code === 'Space' && !event.repeat) {
            this.eventBus.emit('input:action', { action: 'jump', pressed: true });
        }
        
        if ((event.code === 'ShiftLeft' || event.code === 'ShiftRight') && !event.repeat) {
            this.eventBus.emit('input:action', { action: 'sprint', pressed: true });
        }
        
        if (event.code === 'KeyV' && !event.repeat) {
            this.eventBus.emit('input:action', { action: 'cycleView', pressed: true });
        }
        
        if (event.code === 'KeyP' && !event.repeat) {
            this.eventBus.emit('input:action', { action: 'toggleSettings', pressed: true });
        }
        
        if (event.code === 'KeyH' && !event.repeat) {
            this.eventBus.emit('input:action', { action: 'toggleControls', pressed: true });
        }
        
        if (event.code === 'KeyF' && !event.repeat) {
            this.eventBus.emit('input:action', { action: 'interact', pressed: true });
        }
        
        if (event.code === 'KeyM' && !event.repeat) {
            this.eventBus.emit('input:action', { action: 'toggleDrawer', pressed: true });
        }
        
        if (event.code === 'KeyI' && !event.repeat) {
            this.eventBus.emit('input:action', { action: 'toggleInventory', pressed: true });
        }
        
        if (event.code === 'KeyT' && !event.repeat) {
            this.eventBus.emit('input:action', { action: 'resetPosition', pressed: true });
        }
        
        if (event.code === 'Escape' && !event.repeat) {
            this.eventBus.emit('input:action', { action: 'escape', pressed: true });
        }
    }

    /**
     * Update movement state based on current keys
     */
    updateMovementState() {
        const newMovement = {
            forward: this.keys['KeyW'] || false,
            backward: this.keys['KeyS'] || false,
            left: this.keys['KeyA'] || false,
            right: this.keys['KeyD'] || false
        };
        
        const newActions = {
            sprinting: this.keys['ShiftLeft'] || this.keys['ShiftRight'] || false,
            jumping: this.keys['Space'] || false
        };
        
        // Check if movement state changed
        const movementChanged = 
            newMovement.forward !== this.inputState.movement.forward ||
            newMovement.backward !== this.inputState.movement.backward ||
            newMovement.left !== this.inputState.movement.left ||
            newMovement.right !== this.inputState.movement.right;
            
        const actionsChanged =
            newActions.sprinting !== this.inputState.actions.sprinting ||
            newActions.jumping !== this.inputState.actions.jumping;
        
        if (movementChanged) {
            this.inputState.movement = newMovement;
            this.eventBus.emit('input:movement', { movement: { ...newMovement } });
        }
        
        if (actionsChanged) {
            this.inputState.actions = { ...this.inputState.actions, ...newActions };
            this.eventBus.emit('input:actions', { actions: { ...this.inputState.actions } });
        }
    }

    /**
     * Handle mouse movement
     */
    handleMouseMove(event) {
        // Update mouse position
        this.mouse.x = event.clientX;
        this.mouse.y = event.clientY;
        
        // Calculate mouse deltas
        const deltaX = event.movementX || 0;
        const deltaY = event.movementY || 0;
        
        // Update mouse state
        this.inputState.mouse.deltaX = deltaX;
        this.inputState.mouse.deltaY = deltaY;
        
        // Emit mouse move event
        this.eventBus.emit('input:mousemove', {
            x: this.mouse.x,
            y: this.mouse.y,
            deltaX: deltaX,
            deltaY: deltaY,
            isPointerLocked: this.isPointerLocked
        });
        
        // Update NDC coordinates if we have canvas
        const canvas = document.getElementById('gameCanvas');
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            this.mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            
            this.eventBus.emit('input:mousemove:ndc', {
                x: this.mouseNDC.x,
                y: this.mouseNDC.y
            });
        }
    }

    /**
     * Handle mouse down events
     */
    handleMouseDown(event) {
        this.eventBus.emit('input:mousedown', {
            button: event.button,
            x: this.mouse.x,
            y: this.mouse.y,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey
        });
        
        // Handle primary mouse button (left click)
        if (event.button === 0) {
            this.inputState.actions.firing = true;
            this.eventBus.emit('input:action', { action: 'fire', pressed: true });
        }
    }

    /**
     * Handle mouse up events
     */
    handleMouseUp(event) {
        this.eventBus.emit('input:mouseup', {
            button: event.button,
            x: this.mouse.x,
            y: this.mouse.y,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey
        });
        
        // Handle primary mouse button (left click)
        if (event.button === 0) {
            this.inputState.actions.firing = false;
            this.eventBus.emit('input:action', { action: 'fire', pressed: false });
        }
    }

    /**
     * Handle click events
     */
    handleClick(event) {
        this.eventBus.emit('input:click', {
            button: event.button,
            x: this.mouse.x,
            y: this.mouse.y,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey
        });
    }

    /**
     * Handle wheel events
     */
    handleWheel(event) {
        event.preventDefault(); // Prevent page scrolling
        
        this.eventBus.emit('input:wheel', {
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaZ: event.deltaZ,
            direction: event.deltaY > 0 ? 1 : -1
        });
    }

    /**
     * Handle pointer lock change
     */
    handlePointerLockChange() {
        this.isPointerLocked = document.pointerLockElement === document.body;
        
        this.eventBus.emit('input:pointerlockchange', {
            isLocked: this.isPointerLocked
        });
    }

    /**
     * Handle pointer lock error
     */
    handlePointerLockError() {
        console.warn('Pointer lock failed');
        this.eventBus.emit('input:pointerlockerror', {});
    }

    /**
     * Handle window resize
     */
    handleResize() {
        this.eventBus.emit('input:resize', {
            width: window.innerWidth,
            height: window.innerHeight
        });
    }

    /**
     * Handle window blur (lost focus)
     */
    handleWindowBlur() {
        // Clear all key states when window loses focus
        this.keys = {};
        this.inputState.movement = { forward: false, backward: false, left: false, right: false };
        this.inputState.actions = { firing: false, sprinting: false, jumping: false };
        
        this.eventBus.emit('input:windowblur', {});
        this.eventBus.emit('input:movement', { movement: { ...this.inputState.movement } });
        this.eventBus.emit('input:actions', { actions: { ...this.inputState.actions } });
    }

    /**
     * Handle window focus
     */
    handleWindowFocus() {
        this.eventBus.emit('input:windowfocus', {});
    }

    /**
     * Request pointer lock
     */
    requestPointerLock() {
        if (document.body.requestPointerLock) {
            document.body.requestPointerLock();
        }
    }

    /**
     * Exit pointer lock
     */
    exitPointerLock() {
        if (document.exitPointerLock) {
            document.exitPointerLock();
        }
    }

    /**
     * Get current input state
     */
    getInputState() {
        return {
            keys: { ...this.keys },
            movement: { ...this.inputState.movement },
            actions: { ...this.inputState.actions },
            mouse: { ...this.inputState.mouse },
            mousePosition: { ...this.mouse },
            mouseNDC: { ...this.mouseNDC },
            isPointerLocked: this.isPointerLocked
        };
    }

    /**
     * Check if a key is currently pressed
     */
    isKeyPressed(keyCode) {
        return this.keys[keyCode] || false;
    }

    /**
     * Check if any movement key is pressed
     */
    isMoving() {
        return this.inputState.movement.forward || 
               this.inputState.movement.backward || 
               this.inputState.movement.left || 
               this.inputState.movement.right;
    }

    /**
     * Destroy the input manager and remove all event listeners
     */
    destroy() {
        // Note: In a real implementation, we'd store references to the bound functions
        // to properly remove event listeners. For now, this is a placeholder.
        console.log('InputManager destroyed');
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = InputManager;
} else {
    window.InputManager = InputManager;
}
