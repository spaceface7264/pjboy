/**
 * Theme Configuration - Color schemes and visual settings
 */
export const themes = {
    desert: {
        ground: 0xc2b280,
        grid: 0xffe8a0,
        wall: 0xa68a5b,
        wallEmissive: 0x3b2c14,
        sky: 0xdfe6ff,
        ambient: 0x705f3a,
        fog: 0xd4c4a8,
        fogNear: 50,
        fogFar: 200
    },
    
    cyber: {
        ground: 0x001122,
        grid: 0x00ffff,
        wall: 0x004466,
        wallEmissive: 0x002244,
        sky: 0x000011,
        ambient: 0x003366,
        fog: 0x002244,
        fogNear: 30,
        fogFar: 150
    },
    
    forest: {
        ground: 0x2d5016,
        grid: 0x4d8026,
        wall: 0x1a3009,
        wallEmissive: 0x0d1805,
        sky: 0x87ceeb,
        ambient: 0x2d5016,
        fog: 0x6b8e23,
        fogNear: 40,
        fogFar: 180
    },
    
    volcanic: {
        ground: 0x330000,
        grid: 0xff4400,
        wall: 0x660000,
        wallEmissive: 0xff2200,
        sky: 0x440000,
        ambient: 0x662200,
        fog: 0x884400,
        fogNear: 25,
        fogFar: 120
    },
    
    ice: {
        ground: 0xaaffff,
        grid: 0xffffff,
        wall: 0x88ddff,
        wallEmissive: 0x4499cc,
        sky: 0xccffff,
        ambient: 0x88ccff,
        fog: 0xbbeeff,
        fogNear: 60,
        fogFar: 220
    }
};

export const defaultTheme = 'desert';
