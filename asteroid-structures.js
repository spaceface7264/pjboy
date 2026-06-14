/* =========================================================
   asteroid-structures.js  ->  window.AsteroidStructures

   Explorable world structures for Asteroid mode, as a content
   registry (sibling to asteroid-creatures.js / asteroid-ships.js).
   Each def describes a deterministic voxel STAMP that the world
   generator paints into terrain at a chosen site.

       DEFS[id] = {
         name, nameDa,         // EN-forward + Danish (scanner / toasts)
         biome: ['volcanic'],  // biome keys it may appear in
         rarity,               // 'common' | 'landmark' | 'boss'
         footprint,            // ~blocks wide; reserves a site
         stamp(ctx)            // paint voxels via ctx.set(dx,dy,dz,id)
       }

   The stamp ctx (built by voxelworld):
       ctx.ground            world-Y of the surface at the anchor
       ctx.set(dx,dy,dz,id)  write a block; dx/dz offset from anchor,
                             dy is ABSOLUTE world-Y. id 0 carves air.
       ctx.heightAt(dx,dz)   terrain height at an offset (skirting)
       ctx.rng()             deterministic [0,1) PRNG for this site
       ctx.SEA_LEVEL, ctx.H  world constants

   Block ids are voxelworld's BlockRegistry: basalt 17, lava 38
   (animated/glowing), regolith 16. THREE not required here — this
   file is pure data + geometry math. No imports.

   Step-1 scope: static stamps only (volcano landmark + the Ember
   fire-cave boss lair). Animated bits (smoke, dripping embers) and
   the boss creature + dormant FSM land in later milestones — see
   docs/asteroid-world-content-plan.md.
   ========================================================= */
(function(){
  'use strict';

  // BlockRegistry ids reused from voxelworld.js
  const BASALT = 17, LAVA = 38, REGOLITH = 16, AIR = 0;

  const DEFS = {
    // ---- Volcano: scattered volcanic landmark (basalt cone + lava well) ----
    volcano: {
      name: 'Volcano', nameDa: 'Vulkan',
      biome: ['volcanic'], rarity: 'landmark', footprint: 24,
      stamp(ctx){
        const g = ctx.ground, R = 11, Hc = 14;
        for(let dy=0; dy<=Hc; dy++){
          const r = Math.max(1, R * (1 - dy/Hc));   // taper to the summit
          const rr = r*r;
          for(let dx=-R; dx<=R; dx++) for(let dz=-R; dz<=R; dz++){
            const d2 = dx*dx + dz*dz;
            if(d2 > rr) continue;
            const onRim = d2 > (r-1.6)*(r-1.6);
            if(dy > Hc-4 && !onRim) continue;        // hollow crater near the top
            ctx.set(dx, g+dy, dz, BASALT);
          }
        }
        for(let dy=0; dy<5; dy++)                    // lava in the throat (glows)
          ctx.set(0, g+Hc-4-dy, 0, LAVA);
      }
    },

    // ---- Ember fire-cave: the volcanic world boss lair (one per world) ----
    // A hollow basalt dome you can walk into, with lava falling from the roof
    // and running down the walls. A central pedestal is where the dormant boss
    // will wait (boss creature + wake FSM are a later milestone).
    emberLair: {
      name: 'Fire Cave', nameDa: 'Ildhule',
      biome: ['volcanic'], rarity: 'boss', footprint: 26,
      stamp(ctx){
        const g = ctx.ground, floorY = g - 1;
        const RO = 10, HC = 12;                      // outer radius, dome height

        // 1) solid basalt mound so it reads as rock from outside
        for(let dy=-2; dy<=HC; dy++){
          const t = Math.max(0, dy)/HC;
          const r = (dy < 0) ? RO : RO*(1 - 0.85*t*t);
          const rr = r*r;
          for(let dx=-RO; dx<=RO; dx++) for(let dz=-RO; dz<=RO; dz++){
            if(dx*dx + dz*dz <= rr) ctx.set(dx, floorY+dy, dz, BASALT);
          }
        }
        // 2) hollow out the chamber
        const RI = 8, HI = HC - 2;
        for(let dy=1; dy<=HI; dy++){
          const t = dy/HI;
          const r = RI*(1 - 0.8*t*t);
          const rr = r*r;
          for(let dx=-RI; dx<=RI; dx++) for(let dz=-RI; dz<=RI; dz++){
            if(dx*dx + dz*dz <= rr) ctx.set(dx, floorY+dy, dz, AIR);
          }
        }
        // 3) lava falls from the ceiling down the walls
        const falls = [[6,2],[-5,4],[2,-6],[-4,-5],[7,-2]];
        for(const f of falls){
          for(let dy=HI; dy>=2; dy--) ctx.set(f[0], floorY+dy, f[1], LAVA);
        }
        // 4) lava pools spattered across the floor, away from the centre
        for(let dx=-RI; dx<=RI; dx++) for(let dz=-RI; dz<=RI; dz++){
          const d2 = dx*dx + dz*dz;
          if(d2 > 16 && d2 <= RI*RI && ctx.rng() < 0.18) ctx.set(dx, floorY, dz, LAVA);
        }
        // 5) the dormant boss pedestal (centre) — kept clear of lava
        ctx.set(0, floorY, 0, BASALT);
        // 6) an entrance tunnel on +x so you can walk in
        for(let dx=RO-1; dx<=RO+2; dx++) for(let dy=1; dy<=3; dy++) for(let dz=-1; dz<=1; dz++)
          ctx.set(dx, floorY+dy, dz, AIR);
      }
    }
  };

  function get(id){ return DEFS[id] || null; }
  function scatterFor(biome){
    return Object.keys(DEFS).filter(k => DEFS[k].rarity !== 'boss' && DEFS[k].biome.indexOf(biome) >= 0);
  }
  function lairFor(biome){
    const k = Object.keys(DEFS).find(k => DEFS[k].rarity === 'boss' && DEFS[k].biome.indexOf(biome) >= 0);
    return k ? DEFS[k] : null;
  }

  window.AsteroidStructures = { DEFS, get, scatterFor, lairFor, _ids:{ BASALT, LAVA, REGOLITH } };
})();
