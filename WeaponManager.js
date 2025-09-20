/**
 * WeaponManager - Handles all weapon-related functionality
 * Manages weapon definitions, cooldowns, switching, and firing logic
 */
class WeaponManager {
    constructor(eventBus, translationFunction) {
        this.eventBus = eventBus;
        this.t = translationFunction;
        
        // Weapon definitions moved from Game3D
        this.weaponDefinitions = {};
        this.cooldowns = {}; // Track cooldowns for each weapon
        this.isReloading = false;
        
        // Player weapon state
        this.playerWeapons = [];
        this.currentWeaponIndex = 0;
        
        this.initializeWeaponDefinitions();
    }

    initializeWeaponDefinitions() {
        this.weaponDefinitions = {
            diamondSword: {
                id: 'diamondSword',
                name: this.t('diamondSword'),
                type: 'melee',
                damage: 15,
                range: 2.5,
                cooldown: 0.8,
                ammoCost: 0,
                icon: '⚔️',
                color: 0x00aaff,
                description: this.t('diamondSwordDesc')
            },
            gun: {
                id: 'gun',
                name: this.t('gun'),
                type: 'ranged',
                damage: 25,
                range: 15,
                cooldown: 1.2,
                ammoCost: 1,
                icon: '🔫',
                color: 0x8B4513,
                description: this.t('gunDesc')
            },
            machineGun: {
                id: 'machineGun',
                name: this.t('machineGun'),
                type: 'ranged',
                damage: 8,
                range: 12,
                cooldown: 0.1,
                ammoCost: 1,
                icon: '🔫',
                color: 0x696969,
                description: this.t('machineGunDesc'),
                isContinuous: true
            }
        };
    }

    /**
     * Initialize player weapons
     * @param {string[]} weaponIds - Array of weapon IDs for the player
     */
    initializePlayerWeapons(weaponIds = ['diamondSword']) {
        this.playerWeapons = [...weaponIds];
        this.currentWeaponIndex = 0;
        
        // Initialize cooldowns for all weapons
        for (const weaponId of weaponIds) {
            this.cooldowns[weaponId] = 0;
        }
        
        this.eventBus.emit('weaponsInitialized', {
            weapons: this.playerWeapons,
            currentIndex: this.currentWeaponIndex
        });
    }

    /**
     * Update cooldowns (called each frame)
     * @param {number} deltaTime - Time since last frame
     */
    updateCooldowns(deltaTime) {
        let anyReloading = false;
        
        for (const weaponId in this.cooldowns) {
            if (this.cooldowns[weaponId] > 0) {
                this.cooldowns[weaponId] = Math.max(0, this.cooldowns[weaponId] - deltaTime);
                if (this.cooldowns[weaponId] > 0) {
                    anyReloading = true;
                }
            }
        }
        
        this.isReloading = anyReloading;
    }

    /**
     * Check if the current weapon can fire
     * @param {number} ammoCount - Current ammo count
     * @returns {boolean} Whether the weapon can fire
     */
    canFire(ammoCount = 0) {
        const weapon = this.getCurrentWeapon();
        if (!weapon) return false;
        
        const weaponId = this.playerWeapons[this.currentWeaponIndex];
        const cooldownRemaining = this.cooldowns[weaponId] || 0;
        
        // Check cooldown
        if (cooldownRemaining > 0) return false;
        
        // Check ammo for ranged weapons
        if (weapon.type === 'ranged' && weapon.ammoCost > 0 && ammoCount < weapon.ammoCost) {
            return false;
        }
        
        return true;
    }

    /**
     * Get the current weapon definition
     * @returns {Object|null} Current weapon or null
     */
    getCurrentWeapon() {
        if (this.playerWeapons.length === 0) return null;
        const weaponId = this.playerWeapons[this.currentWeaponIndex];
        return this.weaponDefinitions[weaponId];
    }

    /**
     * Get weapon definition by ID
     * @param {string} weaponId - Weapon ID
     * @returns {Object|null} Weapon definition or null
     */
    getWeapon(weaponId) {
        return this.weaponDefinitions[weaponId] || null;
    }

    /**
     * Switch to next/previous weapon
     * @param {number} direction - 1 for next, -1 for previous
     * @returns {Object|null} New current weapon or null
     */
    switchWeapon(direction = 1) {
        if (this.playerWeapons.length <= 1) return null;
        
        const oldIndex = this.currentWeaponIndex;
        const oldWeapon = this.getCurrentWeapon();
        
        this.currentWeaponIndex = (this.currentWeaponIndex + direction) % this.playerWeapons.length;
        if (this.currentWeaponIndex < 0) {
            this.currentWeaponIndex = this.playerWeapons.length - 1;
        }
        
        const currentWeapon = this.getCurrentWeapon();
        
        if (currentWeapon) {
            this.eventBus.emit('weaponSwitched', {
                oldWeaponId: oldWeapon?.id || null,
                oldWeaponName: oldWeapon?.name || null,
                newWeaponId: currentWeapon.id,
                newWeaponName: currentWeapon.name,
                newWeaponIndex: this.currentWeaponIndex,
                oldWeaponIndex: oldIndex
            });
        }
        
        return currentWeapon;
    }

    /**
     * Switch to specific weapon by ID
     * @param {string} weaponId - Weapon ID to switch to
     * @returns {boolean} Whether switch was successful
     */
    switchToWeapon(weaponId) {
        const weaponIndex = this.playerWeapons.indexOf(weaponId);
        if (weaponIndex === -1) return false;
        
        const oldIndex = this.currentWeaponIndex;
        const oldWeapon = this.getCurrentWeapon();
        
        this.currentWeaponIndex = weaponIndex;
        const currentWeapon = this.getCurrentWeapon();
        
        if (currentWeapon) {
            this.eventBus.emit('weaponSwitched', {
                oldWeaponId: oldWeapon?.id || null,
                oldWeaponName: oldWeapon?.name || null,
                newWeaponId: currentWeapon.id,
                newWeaponName: currentWeapon.name,
                newWeaponIndex: this.currentWeaponIndex,
                oldWeaponIndex: oldIndex
            });
        }
        
        return true;
    }

    /**
     * Fire the current weapon (sets cooldown and emits event)
     * @param {number} ammoCount - Current ammo count
     * @param {Object} playerPosition - Player position for event
     * @returns {Object|null} Weapon fire result or null if can't fire
     */
    fireWeapon(ammoCount, playerPosition) {
        if (!this.canFire(ammoCount)) {
            return null;
        }
        
        const weapon = this.getCurrentWeapon();
        const weaponId = this.playerWeapons[this.currentWeaponIndex];
        
        // Set cooldown
        this.cooldowns[weaponId] = weapon.cooldown;
        
        // Calculate ammo consumption
        const ammoConsumed = weapon.type === 'ranged' ? weapon.ammoCost : 0;
        
        // Emit weapon fired event
        this.eventBus.emit('weaponFired', {
            weaponId: weaponId,
            weaponName: weapon.name,
            weaponType: weapon.type,
            damage: weapon.damage,
            ammoConsumed: ammoConsumed,
            ammoRemaining: ammoCount - ammoConsumed,
            playerPosition: playerPosition.clone()
        });
        
        return {
            weapon: weapon,
            weaponId: weaponId,
            ammoConsumed: ammoConsumed,
            damage: weapon.damage,
            range: weapon.range,
            type: weapon.type
        };
    }

    /**
     * Add a weapon to player's inventory
     * @param {string} weaponId - Weapon ID to add
     * @returns {boolean} Whether weapon was added
     */
    addWeapon(weaponId) {
        if (!this.weaponDefinitions[weaponId]) return false;
        if (this.playerWeapons.includes(weaponId)) return false;
        
        this.playerWeapons.push(weaponId);
        this.cooldowns[weaponId] = 0;
        
        this.eventBus.emit('weaponAdded', {
            weaponId: weaponId,
            weaponName: this.weaponDefinitions[weaponId].name,
            totalWeapons: this.playerWeapons.length
        });
        
        return true;
    }

    /**
     * Remove a weapon from player's inventory
     * @param {string} weaponId - Weapon ID to remove
     * @returns {boolean} Whether weapon was removed
     */
    removeWeapon(weaponId) {
        const index = this.playerWeapons.indexOf(weaponId);
        if (index === -1) return false;
        
        this.playerWeapons.splice(index, 1);
        delete this.cooldowns[weaponId];
        
        // Adjust current index if necessary
        if (this.currentWeaponIndex >= this.playerWeapons.length) {
            this.currentWeaponIndex = Math.max(0, this.playerWeapons.length - 1);
        }
        
        this.eventBus.emit('weaponRemoved', {
            weaponId: weaponId,
            totalWeapons: this.playerWeapons.length,
            newCurrentWeapon: this.getCurrentWeapon()?.name || null
        });
        
        return true;
    }

    /**
     * Get all weapon definitions
     * @returns {Object} All weapon definitions
     */
    getAllWeapons() {
        return { ...this.weaponDefinitions };
    }

    /**
     * Get player's weapons
     * @returns {string[]} Array of weapon IDs
     */
    getPlayerWeapons() {
        return [...this.playerWeapons];
    }

    /**
     * Get current weapon index
     * @returns {number} Current weapon index
     */
    getCurrentWeaponIndex() {
        return this.currentWeaponIndex;
    }

    /**
     * Get remaining cooldown for a weapon
     * @param {string} weaponId - Weapon ID
     * @returns {number} Remaining cooldown in seconds
     */
    getCooldown(weaponId) {
        return this.cooldowns[weaponId] || 0;
    }

    /**
     * Get remaining cooldown for current weapon
     * @returns {number} Remaining cooldown in seconds
     */
    getCurrentCooldown() {
        if (this.playerWeapons.length === 0) return 0;
        const weaponId = this.playerWeapons[this.currentWeaponIndex];
        return this.cooldowns[weaponId] || 0;
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WeaponManager;
} else {
    window.WeaponManager = WeaponManager;
}
