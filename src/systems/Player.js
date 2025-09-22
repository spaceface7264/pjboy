// Simplified Player System - No Weapons, Only Movement and Jetpack
import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';

export class Player {
    constructor(game) {
        this.game = game;
        
        // Player object and model
        this.object = null;
        this.model = null;
        
        // Movement properties
        this.position = new THREE.Vector3(0, 0, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.speed = 5;
        this.jumpPower = 8;
        this.isGrounded = false;
        this.groundY = 0;
        
        // View properties
        this.viewMode = 'fpv'; // First person by default
        this.fpvPitch = 0;
        this.fpvYaw = 0;
        this.height = 1.7; // Player eye height
        
        // Jetpack system
        this.jetpack = {
            active: false,
            thrust: 12,
            maxSpeed: 8
        };
        
        // Camera bobbing for FPV
        this.bobbing = {
            amplitude: 0.05,
            frequency: 8,
            time: 0
        };
        
        // Movement state
        this.moveState = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false,
            jetpack: false
        };
    }
    
    initialize(scene) {
        this.scene = scene;
        this.createPlayer();
        this.setupCamera();
    }
    
    createPlayer() {
        // Create simple player representation
        const geometry = new THREE.CapsuleGeometry(0.3, this.height);
        const material = new THREE.MeshLambertMaterial({ 
            color: 0x00ff00,
            emissive: 0x002200 
        });
        
        this.model = new THREE.Mesh(geometry, material);
        this.model.castShadow = true;
        this.model.receiveShadow = true;
        
        // Create player object (invisible collision capsule)
        this.object = new THREE.Object3D();
        this.object.add(this.model);
        this.object.position.copy(this.position);
        
        this.scene.add(this.object);
        
        // Hide model in FPV mode
        this.updateModelVisibility();
    }
    
    setupCamera() {
        if (!this.game.sceneManager.camera) return;
        
        this.updateCameraPosition();
    }
    
    updateCameraPosition() {
        if (!this.game.sceneManager.camera) return;
        
        const camera = this.game.sceneManager.camera;
        
        if (this.viewMode === 'fpv') {
            // First person view
            const eyePosition = this.position.clone();
            eyePosition.y += this.height * 0.8; // Eye level
            
            // Add camera bobbing if moving
            if (this.isMoving()) {
                this.bobbing.time += this.game.clock.getDelta() * this.bobbing.frequency;
                const bob = Math.sin(this.bobbing.time) * this.bobbing.amplitude;
                eyePosition.y += bob;
            }
            
            camera.position.copy(eyePosition);
            
            // Apply pitch and yaw
            camera.rotation.order = 'YXZ';
            camera.rotation.y = this.fpvYaw;
            camera.rotation.x = this.fpvPitch;
            
        } else if (this.viewMode === 'iso') {
            // Isometric third person
            const offset = new THREE.Vector3(5, 8, 5);
            camera.position.copy(this.position.clone().add(offset));
            camera.lookAt(this.position);
        }
    }
    
    update(deltaTime) {
        this.updateMovement(deltaTime);
        this.updatePosition(deltaTime);
        this.updateCameraPosition();
        
        // Check maze objectives
        this.game.checkObjectives();
    }
    
    updateMovement(deltaTime) {
        if (this.game.gameState !== 'playing') return;
        
        const moveVector = new THREE.Vector3();
        
        // Calculate movement direction based on camera/player orientation
        if (this.viewMode === 'fpv') {
            // FPV: movement relative to camera direction
            const forward = new THREE.Vector3(0, 0, -1);
            const right = new THREE.Vector3(1, 0, 0);
            
            forward.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.fpvYaw, 0)));
            right.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.fpvYaw, 0)));
            
            if (this.moveState.forward) moveVector.add(forward);
            if (this.moveState.backward) moveVector.sub(forward);
            if (this.moveState.left) moveVector.sub(right);
            if (this.moveState.right) moveVector.add(right);
        } else {
            // Isometric: movement relative to world axes
            if (this.moveState.forward) moveVector.z -= 1;
            if (this.moveState.backward) moveVector.z += 1;
            if (this.moveState.left) moveVector.x -= 1;
            if (this.moveState.right) moveVector.x += 1;
        }
        
        // Normalize and apply speed
        if (moveVector.length() > 0) {
            moveVector.normalize().multiplyScalar(this.speed);
            this.velocity.x = moveVector.x;
            this.velocity.z = moveVector.z;
        } else {
            // Apply friction
            this.velocity.x *= 0.8;
            this.velocity.z *= 0.8;
        }
    }
    
    updatePosition(deltaTime) {
        // Handle gravity and jetpack
        if (this.moveState.jetpack && this.game.useJetpack(deltaTime)) {
            // Jetpack active
            this.velocity.y += this.jetpack.thrust * deltaTime;
            this.velocity.y = Math.min(this.velocity.y, this.jetpack.maxSpeed);
            this.isGrounded = false;
        } else {
            // Apply gravity
            if (!this.isGrounded) {
                this.velocity.y -= 20 * deltaTime; // Gravity
            }
            
            // Handle jumping
            if (this.moveState.jump && this.isGrounded) {
                this.velocity.y = this.jumpPower;
                this.isGrounded = false;
            }
        }
        
        // Apply velocity
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime));
        
        // Simple ground collision
        if (this.position.y <= this.groundY) {
            this.position.y = this.groundY;
            this.velocity.y = 0;
            this.isGrounded = true;
        }
        
        // Simple wall collision (basic AABB check)
        this.checkWallCollisions();
        
        // Update object position
        if (this.object) {
            this.object.position.copy(this.position);
        }
    }
    
    checkWallCollisions() {
        // Simple collision with maze walls
        if (!this.game.sceneManager.walls) return;
        
        const playerRadius = 0.4;
        
        for (const wall of this.game.sceneManager.walls) {
            const wallBox = new THREE.Box3().setFromObject(wall);
            const playerBox = new THREE.Box3().setFromCenterAndSize(
                this.position,
                new THREE.Vector3(playerRadius * 2, this.height, playerRadius * 2)
            );
            
            if (wallBox.intersectsBox(playerBox)) {
                // Simple push-back collision resolution
                const wallCenter = wallBox.getCenter(new THREE.Vector3());
                const direction = this.position.clone().sub(wallCenter);
                direction.y = 0; // Only horizontal collision
                direction.normalize();
                
                this.position.add(direction.multiplyScalar(0.1));
                
                // Stop movement in collision direction
                if (Math.abs(direction.x) > Math.abs(direction.z)) {
                    this.velocity.x = 0;
                } else {
                    this.velocity.z = 0;
                }
            }
        }
    }
    
    spawnAtMazeEntrance(mazeInfo) {
        console.log('🎯 Player spawn - mazeInfo:', mazeInfo);
        
        if (!mazeInfo || !mazeInfo.entranceWorld) {
            console.warn('❌ No maze info or entrance found');
            return;
        }
        
        // Position player outside maze entrance, facing inward
        const entrance = mazeInfo.entranceWorld;
        const spawnPos = new THREE.Vector3(
            entrance.x - mazeInfo.cellSize, // One cell outside
            this.groundY,
            entrance.z
        );
        
        this.position.copy(spawnPos);
        console.log('🚀 Player spawned at:', spawnPos);
        
        // Face toward entrance
        this.fpvYaw = 0; // Facing east (toward entrance)
        this.fpvPitch = 0;
        
        // Reset movement state
        this.velocity.set(0, 0, 0);
        this.isGrounded = true;
        
        if (this.object) {
            this.object.position.copy(this.position);
        }
        
        console.log('🎯 Player spawned at maze entrance');
    }
    
    setViewMode(mode) {
        this.viewMode = mode;
        this.updateModelVisibility();
        this.updateCameraPosition();
    }
    
    updateModelVisibility() {
        if (this.model) {
            this.model.visible = this.viewMode !== 'fpv';
        }
    }
    
    isMoving() {
        return this.moveState.forward || this.moveState.backward || 
               this.moveState.left || this.moveState.right;
    }
    
    getPosition() {
        return this.position.clone();
    }
    
    enableJetpack() {
        this.jetpack.active = true;
    }
    
    // Input handlers
    handleKeyDown(key) {
        switch(key) {
            case 'KeyW': this.moveState.forward = true; break;
            case 'KeyS': this.moveState.backward = true; break;
            case 'KeyA': this.moveState.left = true; break;
            case 'KeyD': this.moveState.right = true; break;
            case 'Space': 
                this.moveState.jump = true;
                this.moveState.jetpack = true;
                break;
        }
    }
    
    handleKeyUp(key) {
        switch(key) {
            case 'KeyW': this.moveState.forward = false; break;
            case 'KeyS': this.moveState.backward = false; break;
            case 'KeyA': this.moveState.left = false; break;
            case 'KeyD': this.moveState.right = false; break;
            case 'Space': 
                this.moveState.jump = false;
                this.moveState.jetpack = false;
                break;
        }
    }
    
    handleMouseMove(deltaX, deltaY) {
        if (this.viewMode === 'fpv' && this.game.gameState === 'playing') {
            this.fpvYaw -= deltaX * 0.002;
            this.fpvPitch = THREE.MathUtils.clamp(this.fpvPitch - deltaY * 0.002, -Math.PI/2, Math.PI/2);
        }
    }
}
