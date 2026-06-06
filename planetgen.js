/*
 * planetgen.js — deterministic procedural planet-catalog generator for PJBoy.
 *
 * Self-contained: depends on NO other game file and references window/THREE only
 * lazily (none needed at all here — pure data). Exposes window.PlanetGen.
 *
 *   window.PlanetGen.generate(universeSeed, count) -> ordered array of planet defs
 *
 * The FIRST entry is always the curated 'home' world (Terra). The remaining
 * count-1 worlds are generated deterministically from universeSeed: same seed →
 * identical catalog.
 *
 * Palettes: each world picks a base hue and builds 5 elevation bands (deep →
 * peak) that get lighter & less saturated upward with a slight hue drift; sea is
 * a hue-shifted variant, sky ≈ the mid band, atm = 3 paler tints of the hue.
 * Orbits: non-home dir vectors are spread over a sphere via a jittered Fibonacci
 * lattice so worlds don't clump; dist varies in ~500..820.
 */
(function () {
    'use strict';

    // --- Deterministic RNG (mulberry32) -----------------------------------
    function mulberry32(a) {
        a = a >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function clamp01(v) { return clamp(v, 0, 1); }

    // --- HSL (h in [0,1], s/l in [0,1]) -> int hex ------------------------
    function hslToHex(h, s, l) {
        h = ((h % 1) + 1) % 1;
        s = clamp01(s);
        l = clamp01(l);
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = function (p, q, t) {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        const R = Math.round(clamp01(r) * 255);
        const G = Math.round(clamp01(g) * 255);
        const B = Math.round(clamp01(b) * 255);
        return (R << 16) | (G << 8) | B;
    }

    // --- Palette factory --------------------------------------------------
    // Builds the 5 band colors and returns a SELF-CONTAINED pal(e) closure that
    // captures this world's own amp + bands (no external/global reads).
    function makePalette(amp, deep, low, mid, high, peak) {
        return function (e) {
            if (e < -1.5) return deep;
            if (e < 1) return low;
            if (e < amp * 0.45) return mid;
            if (e < amp * 0.8) return high;
            return peak;
        };
    }

    // Build 5 bands from a hue with a slight per-band hue drift (deep darkest/
    // most saturated → peak lightest/desaturated).
    function buildBands(hue, sat, drift) {
        // [hueOffset, sat-mult, lightness]
        const specs = [
            [0.00, 1.00, 0.20],  // deep   (ocean floor)
            [0.30, 0.85, 0.46],  // low    (shore / lowland)
            [0.55, 0.75, 0.42],  // mid
            [0.80, 0.45, 0.55],  // high
            [1.00, 0.18, 0.86]   // peak
        ];
        const out = [];
        for (let i = 0; i < specs.length; i++) {
            const s = specs[i];
            out.push(hslToHex(hue + drift * s[0], sat * s[1], s[2]));
        }
        return out; // [deep, low, mid, high, peak]
    }

    // --- Name generator ---------------------------------------------------
    const ONSET = ['Ka', 'Ve', 'Zo', 'Ny', 'Tor', 'Lu', 'Mir', 'Xe', 'Bel', 'Cra',
        'Dra', 'Fen', 'Gly', 'Hel', 'Ith', 'Jor', 'Kel', 'Lyr', 'Mok', 'Nax',
        'Orb', 'Phae', 'Qua', 'Ryl', 'Sar', 'The', 'Umb', 'Vol', 'Wyn', 'Zar'];
    const CODA = ['ron', 'lyn', 'dor', 'ix', 'ara', 'eth', 'ova', 'us', 'ai', 'on',
        'eus', 'ia', 'ar', 'os', 'yx', 'une', 'tep', 'mos', 'ren', 'tha'];

    function makeName(rng, used) {
        for (let tries = 0; tries < 64; tries++) {
            let n = ONSET[(rng() * ONSET.length) | 0] + CODA[(rng() * CODA.length) | 0];
            if (rng() < 0.25) n += '-' + (((rng() * 9) | 0) + 1); // occasional designation
            if (!used[n]) { used[n] = true; return n; }
        }
        // Fallback guaranteed-unique
        let i = 1, base = 'World';
        while (used[base + i]) i++;
        used[base + i] = true;
        return base + i;
    }

    // --- Biome archetypes (bias hue/ranges for flavor) --------------------
    // Each returns tweaks; chosen by RNG, but pure-hue fallback is also valid.
    const BIOMES = [
        { name: 'lush',     hue: 0.30, hueJ: 0.06, sat: 0.55, lush: true,  seaShift: 0.55, ampB: [12, 30], seaB: [0.40, 0.55] },
        { name: 'desert',   hue: 0.10, hueJ: 0.04, sat: 0.55, lush: false, seaShift: 0.50, ampB: [6, 22],  seaB: [0.25, 0.40] },
        { name: 'ice',      hue: 0.55, hueJ: 0.05, sat: 0.30, lush: false, seaShift: 0.45, ampB: [10, 28], seaB: [0.45, 0.60] },
        { name: 'volcanic', hue: 0.02, hueJ: 0.04, sat: 0.70, lush: false, seaShift: 0.50, ampB: [18, 45], seaB: [0.25, 0.45] },
        { name: 'alien',    hue: 0.78, hueJ: 0.10, sat: 0.62, lush: false, seaShift: 0.40, ampB: [12, 38], seaB: [0.30, 0.55] },
        { name: 'ocean',    hue: 0.58, hueJ: 0.06, sat: 0.55, lush: false, seaShift: 0.50, ampB: [6, 18],  seaB: [0.55, 0.60] }
    ];

    // --- Curated home world (Terra) ---------------------------------------
    function makeHome() {
        return {
            key: 'home',
            name: 'Terra',
            R: 90,
            gravity: 26,
            noiseScale: 1.9,
            amp: 15,
            seaBias: 0.46,
            seed: 9123,
            daySec: 360, axisTilt: 0.35,
            sea: 0x2a6fb0,
            sky: 0x6fae3a,
            pal: makePalette(15, 0x8a7b50, 0xe6d6a8, 0x6fae3a, 0x8a8d92, 0xeaf2f7),
            props: true,
            clouds: true,
            atm: [0x6db4ff, 0x8ec6ff, 0xbfe0ff],
            orbit: { dir: [0.42, 0.82, 0.40], dist: 7000 }
        };
    }

    // --- Curated sister worlds (always present) ---------------------------
    function makeEmber() {
        return {
            key: 'ember', name: 'Ember', R: 70, gravity: 30, noiseScale: 2.7, amp: 20, seaBias: 0.30, seed: 4477, daySec: 140, axisTilt: 0.1,
            sea: 0xc23a10, sky: 0xc1432f, pal: makePalette(20, 0x5a1505, 0x7a2a14, 0xc1432f, 0xe07b2c, 0xf0e2c2),
            props: false, clouds: false, atm: [0xff7a3a, 0xff9a5a, 0xffc79a], orbit: { dir: [-0.65, 0.35, -0.67], dist: 9000 }
        };
    }
    function makeGoliath() {
        return {
            key: 'goliath', name: 'Goliath', R: 175, gravity: 16, noiseScale: 1.3, amp: 40, seaBias: 0.42, seed: 7788, daySec: 520, axisTilt: 0.5,
            sea: 0x12b39a, sky: 0x9b27b0, pal: makePalette(40, 0x241046, 0x5e1b86, 0xb52db0, 0x2fe39a, 0xc7f7ff),
            props: false, clouds: true, atm: [0x8a2be2, 0x3fd0c0, 0xc7f7ff], orbit: { dir: [0.30, -0.60, 0.74], dist: 13000 }
        };
    }
    // A truly colossal ocean-blue giant. Kept under the nearest orbit (~6500) so other
    // worlds aren't embedded in it. Very low gravity (big floaty jumps), gentle huge
    // features. Blocks are chunky at this scale (capped FACE_N); big build on landing.
    function makeAtlas() {
        return {
            key: 'atlas', name: 'Atlas', R: 5000, gravity: 9, noiseScale: 0.6, amp: 80, seaBias: 0.5, seed: 5150, daySec: 900, axisTilt: 0.2,
            sea: 0x0a3a6b, sky: 0x2a86b8, pal: makePalette(80, 0x06203f, 0x1a5a8a, 0x2a9fb0, 0xd8c89a, 0xf2f6ff),
            props: false, clouds: true, atm: [0x5aa0ff, 0x8ec6ff, 0xc7e8ff], orbit: { dir: [-0.2, 0.55, -0.81], dist: 16000 }
        };
    }

    // --- One procedural world ---------------------------------------------
    function makeWorld(idx, rng, used, dir) {
        const biome = BIOMES[(rng() * BIOMES.length) | 0];

        // Base hue: jitter around the biome's hue.
        const hue = ((biome.hue + (rng() - 0.5) * biome.hueJ * 2) % 1 + 1) % 1;
        const sat = clamp(biome.sat + (rng() - 0.5) * 0.18, 0.12, 0.9);
        const drift = (rng() - 0.5) * 0.14; // slight hue drift across bands

        // Size: bias toward smaller, occasional giant.
        let R;
        if (rng() < 0.15) {
            R = lerp(150, 200, rng()); // rare giant
        } else {
            const t = rng();
            R = lerp(60, 140, t * t);  // squared → small bias
        }
        R = Math.round(R);

        // Bigger → lower gravity (loose correlation), then jitter.
        const sizeT = clamp01((R - 60) / (200 - 60));
        let gravity = lerp(34, 14, sizeT) + (rng() - 0.5) * 6;
        gravity = Math.round(clamp(gravity, 14, 34) * 10) / 10;

        const noiseScale = Math.round(lerp(1.2, 3.0, rng()) * 100) / 100;
        const amp = Math.round(clamp(lerp(biome.ampB[0], biome.ampB[1], rng()), 8, 45));
        const seaBias = Math.round(clamp(lerp(biome.seaB[0], biome.seaB[1], rng()), 0.25, 0.60) * 100) / 100;

        const bands = buildBands(hue, sat, drift); // [deep, low, mid, high, peak]
        const sky = bands[2];

        // Sea: hue-shifted (complementary/analogous) cooler color.
        const seaHue = (hue + biome.seaShift + (rng() - 0.5) * 0.08) % 1;
        const sea = hslToHex(seaHue, clamp(sat * 0.9, 0.3, 0.85), 0.40);

        // Atmosphere: 3 tints of the hue, paler & lighter upward.
        const atm = [
            hslToHex(hue, clamp(sat * 0.7, 0.2, 0.7), 0.55),
            hslToHex(hue, clamp(sat * 0.45, 0.15, 0.55), 0.72),
            hslToHex(hue, clamp(sat * 0.25, 0.10, 0.40), 0.88)
        ];

        return {
            key: 'p' + idx,
            name: makeName(rng, used),
            R: R,
            gravity: gravity,
            noiseScale: noiseScale,
            amp: amp,
            seaBias: seaBias,
            seed: ((rng() * 0x7fffffff) | 0) >>> 0 || (idx * 2654435761 >>> 0),
            daySec: Math.round(lerp(120, 600, rng())), // own day length
            axisTilt: Math.round(rng() * 0.7 * 100) / 100,
            sea: sea,
            sky: sky,
            pal: makePalette(amp, bands[0], bands[1], bands[2], bands[3], bands[4]),
            props: !!biome.lush,
            clouds: rng() < 0.5,
            atm: atm,
            orbit: { dir: dir, dist: Math.round(lerp(6500, 20000, rng())) }
        };
    }

    // --- Fibonacci-sphere direction (jittered) for even spread ------------
    function fibDir(i, n, rng) {
        // i in [0, n-1]; golden-angle spiral over the unit sphere.
        const ga = Math.PI * (3 - Math.sqrt(5));
        const y = 1 - (i + 0.5) / n * 2;       // y in (1, -1)
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = ga * i + (rng() - 0.5) * 0.6; // small angular jitter
        const yj = clamp(y + (rng() - 0.5) * 0.08, -0.98, 0.98);
        const rr = Math.sqrt(Math.max(0, 1 - yj * yj));
        return [Math.cos(theta) * rr, yj, Math.sin(theta) * rr];
    }

    // --- Public API -------------------------------------------------------
    function generate(universeSeed, count) {
        if (typeof universeSeed !== 'number' || !isFinite(universeSeed)) universeSeed = 13337;
        if (typeof count !== 'number' || !isFinite(count) || count < 1) count = 12;
        count = count | 0;

        const out = [makeHome(), makeEmber(), makeGoliath(), makeAtlas()];
        const rng = mulberry32(universeSeed >>> 0);
        const used = { Terra: true, Ember: true, Goliath: true, Atlas: true };

        const n = Math.max(0, count - out.length); // rest are procedural
        for (let i = 0; i < n; i++) {
            const dir = fibDir(i, n, rng);
            out.push(makeWorld(i + 1, rng, used, dir));
        }
        return out;
    }

    window.PlanetGen = { generate: generate };
})();
