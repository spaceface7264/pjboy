/**
 * ItemManager - Centralized item system management
 * Handles item definitions, effects, usage, and interactions
 */
class ItemManager {
    constructor(eventBus, translationFunction) {
        this.eventBus = eventBus;
        this.t = translationFunction;
        
        // Item definitions
        this.itemDefinitions = {};
        
        // Effect tracking
        this.activeEffects = {
            temporaryBuffs: [],     // { type, duration, strength, startTime }
            permanentBuffs: {},     // { type: stacks }
            cooldowns: {}           // { itemType: remainingTime }
        };
        
        // Item usage statistics
        this.statistics = {
            itemsUsed: {},          // { itemType: count }
            totalItemsCollected: 0,
            totalItemsUsed: 0
        };
        
        this.initializeItemDefinitions();
    }

    initializeItemDefinitions() {
        this.itemDefinitions = {
            health: {
                id: 'health',
                name: this.t('health'),
                type: 'consumable',
                category: 'healing',
                effect: {
                    type: 'heal',
                    amount: 25,
                    target: 'health'
                },
                icon: '❤️',
                color: 0xff6666,
                description: this.t('healthDesc') || 'Restores 25 health points',
                rarity: 'common',
                stackable: true,
                useCooldown: 0, // No cooldown
                canUseInCombat: true
            },
            
            
            jetpack: {
                id: 'jetpack',
                name: this.t('jetpackFuel'),
                type: 'consumable',
                category: 'utility',
                effect: {
                    type: 'fuel',
                    amount: 50,
                    target: 'jetpackFuel'
                },
                icon: '🚀',
                color: 0x0099ff,
                description: this.t('jetpackFuelDesc') || 'Adds 50 jetpack fuel for flying',
                rarity: 'uncommon',
                stackable: true,
                useCooldown: 0,
                canUseInCombat: true
            },
            
            
            flag: {
                id: 'flag',
                name: this.t('flag'),
                type: 'tool',
                category: 'utility',
                effect: {
                    type: 'inventory',
                    amount: 1,
                    target: 'flags'
                },
                icon: '🏁',
                color: 0xff0000,
                description: this.t('flagDesc') || 'Marker flag that can be placed with F key',
                rarity: 'common',
                stackable: true,
                useCooldown: 0,
                canUseInCombat: true
            },

            // New items to expand the system
            energy: {
                id: 'energy',
                name: 'Energy Crystal',
                type: 'consumable',
                category: 'utility',
                effect: {
                    type: 'restore',
                    amount: 100,
                    target: 'energy'
                },
                icon: '⚡',
                color: 0x00ffff,
                description: 'Restores 100 energy points for special abilities',
                rarity: 'uncommon',
                stackable: true,
                useCooldown: 2,
                canUseInCombat: true
            },

            shield: {
                id: 'shield',
                name: 'Shield Boost',
                type: 'consumable',
                category: 'defense',
                effect: {
                    type: 'temporary_buff',
                    stat: 'shield',
                    amount: 50,
                    duration: 20
                },
                icon: '🛡️',
                color: 0x4169e1,
                description: 'Provides 50 shield points for 20 seconds',
                rarity: 'uncommon',
                stackable: false,
                useCooldown: 5,
                canUseInCombat: true
            }
        };
    }

    /**
     * Use an item from inventory
     * @param {Object} item - Item object with type and other properties
     * @param {Object} player - Player object to apply effects to
     * @param {Object} inventory - Inventory object to modify
     * @returns {Object} Result of item usage
     */
    useItem(item, player, inventory) {
        const itemDef = this.itemDefinitions[item.type];
        if (!itemDef) {
            return { success: false, error: 'Unknown item type' };
        }

        // Check cooldown
        if (this.isOnCooldown(item.type)) {
            const remaining = this.getCooldown(item.type);
            return { 
                success: false, 
                error: `Item on cooldown (${remaining.toFixed(1)}s remaining)` 
            };
        }

        // Apply effect
        const result = this.applyItemEffect(itemDef, player, inventory);
        
        if (result.success) {
            // Set cooldown
            if (itemDef.useCooldown > 0) {
                this.activeEffects.cooldowns[item.type] = itemDef.useCooldown;
            }

            // Update statistics
            this.statistics.itemsUsed[item.type] = (this.statistics.itemsUsed[item.type] || 0) + 1;
            this.statistics.totalItemsUsed++;

            // Emit event
            this.eventBus.emit('itemUsed', {
                itemId: item.type,
                itemName: itemDef.name,
                effect: itemDef.effect,
                player: player,
                result: result
            });
        }

        return result;
    }

    /**
     * Apply the effect of an item
     * @param {Object} itemDef - Item definition
     * @param {Object} player - Player object
     * @param {Object} inventory - Inventory object
     * @returns {Object} Application result
     */
    applyItemEffect(itemDef, player, inventory) {
        const effect = itemDef.effect;
        let message = '';
        let success = true;

        switch (effect.type) {
            case 'heal':
                const oldHealth = player.hp || 0;
                const maxHealth = player.maxHp || 100;
                player.hp = Math.min(maxHealth, oldHealth + effect.amount);
                inventory.health = Math.min(inventory.maxHealth, inventory.health + effect.amount);
                message = `Healed for ${effect.amount} HP. Health: ${player.hp}/${maxHealth}`;
                break;

            case 'fuel':
                if (effect.target === 'jetpackFuel') {
                    const oldFuel = inventory.jetpackFuel || 0;
                    inventory.jetpackFuel = oldFuel + effect.amount;
                    message = `Added ${effect.amount} jetpack fuel. Total: ${inventory.jetpackFuel}`;
                }
                break;

            case 'buff':
                this.applyTemporaryBuff(effect, player);
                message = `Applied ${effect.stat} boost (+${effect.amount}) for ${effect.duration}s`;
                break;

            case 'permanent_buff':
                this.applyPermanentBuff(effect, player);
                message = `Permanently increased ${effect.stat} by ${effect.amount}`;
                break;

            case 'inventory':
                if (effect.target === 'flags') {
                    inventory.flags = (inventory.flags || 0) + effect.amount;
                    message = `Added ${effect.amount} flag(s). Total: ${inventory.flags}`;
                }
                break;

            case 'restore':
                if (effect.target === 'energy') {
                    inventory.energy = (inventory.energy || 0) + effect.amount;
                    message = `Restored ${effect.amount} energy. Total: ${inventory.energy}`;
                }
                break;

            case 'temporary_buff':
                this.applyTemporaryBuff(effect, player);
                message = `Applied ${effect.stat} shield (+${effect.amount}) for ${effect.duration}s`;
                break;

            default:
                success = false;
                message = `Unknown effect type: ${effect.type}`;
        }

        return { success, message, effect };
    }

    /**
     * Apply a temporary buff
     * @param {Object} effect - Effect definition
     * @param {Object} player - Player object
     */
    applyTemporaryBuff(effect, player) {
        const buff = {
            type: effect.stat,
            amount: effect.amount,
            duration: effect.duration,
            startTime: Date.now()
        };

        if (effect.stackable) {
            this.activeEffects.temporaryBuffs.push(buff);
        } else {
            // Remove existing buffs of same type if not stackable
            this.activeEffects.temporaryBuffs = this.activeEffects.temporaryBuffs.filter(
                b => b.type !== effect.stat
            );
            this.activeEffects.temporaryBuffs.push(buff);
        }

        this.eventBus.emit('buffApplied', {
            type: effect.stat,
            amount: effect.amount,
            duration: effect.duration,
            stacks: this.getActiveBuffStacks(effect.stat)
        });
    }

    /**
     * Apply a permanent buff
     * @param {Object} effect - Effect definition
     * @param {Object} player - Player object
     */
    applyPermanentBuff(effect, player) {
        const current = this.activeEffects.permanentBuffs[effect.stat] || 0;
        this.activeEffects.permanentBuffs[effect.stat] = current + effect.amount;

        this.eventBus.emit('permanentBuffApplied', {
            type: effect.stat,
            amount: effect.amount,
            totalStacks: this.activeEffects.permanentBuffs[effect.stat]
        });
    }

    /**
     * Update cooldowns and temporary effects
     * @param {number} deltaTime - Time since last update
     */
    update(deltaTime) {
        // Update cooldowns
        for (const itemType in this.activeEffects.cooldowns) {
            this.activeEffects.cooldowns[itemType] -= deltaTime;
            if (this.activeEffects.cooldowns[itemType] <= 0) {
                delete this.activeEffects.cooldowns[itemType];
            }
        }

        // Update temporary buffs
        const now = Date.now();
        const initialLength = this.activeEffects.temporaryBuffs.length;
        
        this.activeEffects.temporaryBuffs = this.activeEffects.temporaryBuffs.filter(buff => {
            const elapsed = (now - buff.startTime) / 1000;
            return elapsed < buff.duration;
        });

        // Emit event if any buffs expired
        if (this.activeEffects.temporaryBuffs.length < initialLength) {
            this.eventBus.emit('buffsUpdated', {
                activeBuffs: this.getActiveBuffs()
            });
        }
    }

    /**
     * Check if an item type is on cooldown
     * @param {string} itemType - Item type
     * @returns {boolean} Whether item is on cooldown
     */
    isOnCooldown(itemType) {
        return this.activeEffects.cooldowns[itemType] > 0;
    }

    /**
     * Get remaining cooldown for item type
     * @param {string} itemType - Item type
     * @returns {number} Remaining cooldown in seconds
     */
    getCooldown(itemType) {
        return this.activeEffects.cooldowns[itemType] || 0;
    }

    /**
     * Get active buff stacks for a stat type
     * @param {string} statType - Stat type
     * @returns {number} Number of active stacks
     */
    getActiveBuffStacks(statType) {
        return this.activeEffects.temporaryBuffs.filter(buff => buff.type === statType).length;
    }

    /**
     * Get all active buffs
     * @returns {Object} Active buffs summary
     */
    getActiveBuffs() {
        const summary = {};
        
        // Temporary buffs
        for (const buff of this.activeEffects.temporaryBuffs) {
            if (!summary[buff.type]) {
                summary[buff.type] = { temporary: 0, permanent: 0 };
            }
            summary[buff.type].temporary += buff.amount;
        }
        
        // Permanent buffs
        for (const [stat, stacks] of Object.entries(this.activeEffects.permanentBuffs)) {
            if (!summary[stat]) {
                summary[stat] = { temporary: 0, permanent: 0 };
            }
            summary[stat].permanent = stacks;
        }
        
        return summary;
    }

    /**
     * Collect an item (when picked up from world)
     * @param {string} itemType - Item type
     * @returns {Object} Item object for inventory
     */
    collectItem(itemType) {
        const itemDef = this.itemDefinitions[itemType];
        if (!itemDef) {
            return null;
        }

        this.statistics.totalItemsCollected++;

        const item = {
            type: itemType,
            label: itemDef.name,
            icon: itemDef.icon,
            rarity: itemDef.rarity
        };

        this.eventBus.emit('itemCollected', {
            itemId: itemType,
            itemName: itemDef.name,
            item: item
        });

        return item;
    }

    /**
     * Get all item definitions
     * @returns {Object} All item definitions
     */
    getAllItems() {
        return { ...this.itemDefinitions };
    }

    /**
     * Get item definition by ID
     * @param {string} itemId - Item ID
     * @returns {Object|null} Item definition or null
     */
    getItem(itemId) {
        return this.itemDefinitions[itemId] || null;
    }

    /**
     * Get usage statistics
     * @returns {Object} Usage statistics
     */
    getStatistics() {
        return { ...this.statistics };
    }

    /**
     * Clear all active effects (useful for level restart)
     */
    clearAllEffects() {
        this.activeEffects.temporaryBuffs = [];
        this.activeEffects.permanentBuffs = {};
        this.activeEffects.cooldowns = {};
        
        this.eventBus.emit('allEffectsCleared', {});
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ItemManager;
} else {
    window.ItemManager = ItemManager;
}
