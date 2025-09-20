/**
 * Simple Event Bus for decoupled communication
 * Supports event emission, listening, and cleanup
 */
class EventBus {
    constructor() {
        this.events = new Map();
        this.onceEvents = new Map();
    }

    /**
     * Subscribe to an event
     * @param {string} eventName - Name of the event
     * @param {Function} callback - Function to call when event is emitted
     * @param {Object} context - Optional context to bind the callback to
     * @returns {Function} Unsubscribe function
     */
    on(eventName, callback, context = null) {
        if (!this.events.has(eventName)) {
            this.events.set(eventName, []);
        }
        
        const listener = { callback, context };
        this.events.get(eventName).push(listener);
        
        // Return unsubscribe function
        return () => this.off(eventName, callback);
    }

    /**
     * Subscribe to an event that will only fire once
     * @param {string} eventName - Name of the event
     * @param {Function} callback - Function to call when event is emitted
     * @param {Object} context - Optional context to bind the callback to
     * @returns {Function} Unsubscribe function
     */
    once(eventName, callback, context = null) {
        if (!this.onceEvents.has(eventName)) {
            this.onceEvents.set(eventName, []);
        }
        
        const listener = { callback, context };
        this.onceEvents.get(eventName).push(listener);
        
        // Return unsubscribe function
        return () => {
            const listeners = this.onceEvents.get(eventName);
            if (listeners) {
                const index = listeners.indexOf(listener);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        };
    }

    /**
     * Unsubscribe from an event
     * @param {string} eventName - Name of the event
     * @param {Function} callback - The callback function to remove
     */
    off(eventName, callback) {
        const listeners = this.events.get(eventName);
        if (listeners) {
            const index = listeners.findIndex(listener => listener.callback === callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        }
    }

    /**
     * Emit an event to all subscribers
     * @param {string} eventName - Name of the event
     * @param {*} data - Data to pass to event listeners
     */
    emit(eventName, data = null) {
        // Emit to regular listeners
        const listeners = this.events.get(eventName);
        if (listeners) {
            // Create a copy to avoid issues if listeners modify the array
            [...listeners].forEach(listener => {
                try {
                    if (listener.context) {
                        listener.callback.call(listener.context, data);
                    } else {
                        listener.callback(data);
                    }
                } catch (error) {
                    console.error(`Error in event listener for ${eventName}:`, error);
                }
            });
        }

        // Emit to once listeners and remove them
        const onceListeners = this.onceEvents.get(eventName);
        if (onceListeners && onceListeners.length > 0) {
            // Create a copy and clear the original array
            const listeners = [...onceListeners];
            this.onceEvents.set(eventName, []);
            
            listeners.forEach(listener => {
                try {
                    if (listener.context) {
                        listener.callback.call(listener.context, data);
                    } else {
                        listener.callback(data);
                    }
                } catch (error) {
                    console.error(`Error in once event listener for ${eventName}:`, error);
                }
            });
        }
    }

    /**
     * Remove all listeners for a specific event
     * @param {string} eventName - Name of the event
     */
    removeAllListeners(eventName) {
        this.events.delete(eventName);
        this.onceEvents.delete(eventName);
    }

    /**
     * Remove all listeners for all events
     */
    clear() {
        this.events.clear();
        this.onceEvents.clear();
    }

    /**
     * Get the number of listeners for an event
     * @param {string} eventName - Name of the event
     * @returns {number} Number of listeners
     */
    listenerCount(eventName) {
        const regular = this.events.get(eventName)?.length || 0;
        const once = this.onceEvents.get(eventName)?.length || 0;
        return regular + once;
    }

    /**
     * Get all event names that have listeners
     * @returns {string[]} Array of event names
     */
    eventNames() {
        const regularEvents = Array.from(this.events.keys());
        const onceEvents = Array.from(this.onceEvents.keys());
        return [...new Set([...regularEvents, ...onceEvents])];
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EventBus;
} else {
    window.EventBus = EventBus;
}
