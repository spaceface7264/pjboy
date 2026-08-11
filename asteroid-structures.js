/* =========================================================
   asteroid-structures.js  ->  window.AsteroidStructures

   Explorable world structures for Asteroid mode, as a content
   registry (sibling to asteroid-creatures.js / asteroid-ships.js).
   Each def describes a deterministic voxel STAMP that the world
   generator paints into terrain at a chosen site.

       DEFS[id] = {
         name, nameDa,         // EN-forward + Danish (scanner / toasts)
         biome: ['volcanic'],  // biome keys it may appear in
         region: ['highland'], // (optional) Ember zones it prefers
         rarity,               // 'landmark' | 'boss'
         footprint,            // ~blocks wide; reserves a site
         stamp(ctx)            // paint voxels via ctx.set(dx,dy,dz,id)
       }

   The stamp ctx (built by voxelworld):
       ctx.ground            world-Y of the surface at the anchor
       ctx.region            Ember zone key at the anchor (or null)
       ctx.set(dx,dy,dz,id)  write a block; dx/dz offset from anchor,
                             dy is ABSOLUTE world-Y. id 0 carves air.
       ctx.heightAt(dx,dz)   terrain height at an offset (skirting)
       ctx.rng()             deterministic [0,1) PRNG for this site
       ctx.SEA_LEVEL, ctx.H  world constants

   Block ids (voxelworld BlockRegistry): 17 basalt, 21 obsidian,
   38 lava, 42 lava-flow (unminable, glowing, animated), 43 ash,
   44 magma rock (glowing). THREE not required here — pure data +
   geometry math. No imports.
   ========================================================= */
(function(){
  'use strict';

  // BlockRegistry ids reused from voxelworld.js
  const BASALT = 17, OBSIDIAN = 21, LAVA = 38, FLOW = 42, ASH = 43, MAGMA = 44, AIR = 0;
  const GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, WOOD = 5, LEAVES = 6, ICE = 8;
  const CRYSTAL = 10, SNOW = 20, FUNGAL = 36, WATER = 40, METAL = 7, GLASS = 32;
  const REGOLITH = 16, REDROCK = 18, HIVE = 37, EMERALD = 29;

  const DEFS = {
    // ---- Volcano: a tall erupting stratovolcano with lava pouring down its sides.
    //      Lives in Ember 'highland' zones. The crater holds a lava-flow lake; several
    //      channels of unminable lava-flow run from the rim down to the scorched base.
    volcano: {
      name: 'Volcano', nameDa: 'Vulkan',
      biome: ['volcanic'], region: ['peak'], rarity: 'landmark', footprint: 44,
      sci: { formula: 'magma', mineral: 'Landmark', fact: 'Magma is molten rock under the ground. When it erupts and cools on the surface, it becomes lava rock like basalt.' },
      desc: 'A towering cone of basalt and glowing magma veins. Lava flows cut bright rivers down its flanks.',
      stamp(ctx){
        const g = ctx.ground;
        const R = 17 + (ctx.rng()*5|0);        // base radius — grand, deliberate
        const Hc = 22 + (ctx.rng()*7|0);       // cone height (fits under the world ceiling)
        const craterR = 4;
        // 1) banded cone — basalt body, magma veins glowing through, obsidian rim
        for(let dy=0; dy<=Hc; dy++){
          const r = Math.max(craterR+1, R*(1 - dy/Hc));
          const rr = r*r;
          for(let dx=-R; dx<=R; dx++) for(let dz=-R; dz<=R; dz++){
            const d2 = dx*dx + dz*dz;
            if(d2 > rr) continue;
            if(dy > Hc-5 && d2 < craterR*craterR) continue;     // hollow crater
            let id = BASALT;
            if(dy > Hc-6) id = OBSIDIAN;                        // glassy rim
            else if(((dy + ((dx*7 + dz*13) & 3)) % 5) === 0) id = MAGMA;  // glowing veins
            ctx.set(dx, g+dy, dz, id);
          }
        }
        // 2) crater lava-flow lake
        const lakeY = g + Hc - 5;
        for(let dx=-craterR; dx<=craterR; dx++) for(let dz=-craterR; dz<=craterR; dz++)
          if(dx*dx + dz*dz <= craterR*craterR) ctx.set(dx, lakeY, dz, FLOW);
        // 3) lava-flow channels pouring down the slopes
        const flows = 5 + (ctx.rng()*3|0);
        for(let f=0; f<flows; f++){
          const ang = ctx.rng()*Math.PI*2;
          const wob = ctx.rng()*0.5 - 0.25;
          for(let dy=Hc-5; dy>=0; dy--){
            const r = Math.max(craterR, R*(1 - dy/Hc));
            const a = ang + Math.sin(dy*0.28)*wob;
            const px = Math.round(Math.cos(a)*(r-0.5));
            const pz = Math.round(Math.sin(a)*(r-0.5));
            ctx.set(px, g+dy, pz, FLOW);
            ctx.set(px, g+dy+1, pz, FLOW);                     // a little depth → reads as a stream
            ctx.set(px + (Math.cos(a)>0?1:-1), g+dy, pz, FLOW);// widen
          }
        }
        // 4) scorched apron — magma crust + lava pools around the foot
        for(let dx=-R-4; dx<=R+4; dx++) for(let dz=-R-4; dz<=R+4; dz++){
          const d2 = dx*dx + dz*dz;
          if(d2 > R*R && d2 <= (R+4)*(R+4)){
            const roll = ctx.rng();
            if(roll < 0.10) ctx.set(dx, g, dz, FLOW);
            else if(roll < 0.30) ctx.set(dx, g, dz, MAGMA);
          }
        }
      }
    },

    // ---- Ancient Ruins: remnants of the volcano societies — a raised obsidian plaza,
    //      a ring of broken pillars, half-fallen walls, and a cracked altar with a
    //      magma core. Lives in Ember 'ruin' plateaus.
    ruin: {
      name: 'Ancient Ruins', nameDa: 'Oldtidsruiner',
      biome: ['volcanic'], region: ['ruin'], rarity: 'landmark', footprint: 22,
      sci: { formula: 'archaeology', mineral: 'Landmark', fact: 'Ruins are leftover buildings. Studying them helps scientists learn how people — or aliens — lived long ago.' },
      desc: 'A raised obsidian plaza ringed by broken pillars. An altar still glows with a magma heart.',
      stamp(ctx){
        const g = ctx.ground, P = 8;
        // raised plaza floor (obsidian inlay in basalt)
        for(let dx=-P; dx<=P; dx++) for(let dz=-P; dz<=P; dz++){
          if(Math.max(Math.abs(dx), Math.abs(dz)) <= P)
            ctx.set(dx, g, dz, ((Math.abs(dx)+Math.abs(dz)) % 3) ? BASALT : OBSIDIAN);
        }
        // ring of broken pillars (some standing, some toppled)
        const cols = [[-6,-6],[0,-7],[6,-6],[-7,0],[7,0],[-6,6],[0,7],[6,6]];
        for(const c of cols){
          const ht = 2 + (ctx.rng()*4|0);
          for(let dy=1; dy<=ht; dy++) ctx.set(c[0], g+dy, c[1], OBSIDIAN);
          if(ctx.rng() < 0.5) ctx.set(c[0]+1, g+1, c[1], BASALT);   // fallen capstone
        }
        // cracked altar with a magma core
        for(let dx=-1; dx<=1; dx++) for(let dz=-1; dz<=1; dz++) ctx.set(dx, g+1, dz, BASALT);
        ctx.set(0, g+2, 0, MAGMA);
        // partial broken perimeter walls
        for(let dx=-P; dx<=P; dx++){ if(ctx.rng()<0.6) ctx.set(dx, g+1, -P, BASALT); if(ctx.rng()<0.35) ctx.set(dx, g+2, -P, BASALT); }
        for(let dz=-P; dz<=P; dz++){ if(ctx.rng()<0.5) ctx.set(P, g+1, dz, BASALT); }
      }
    },

    // ---- Ember fire-cave: the volcanic world boss lair (one per world). A hollow
    //      basalt dome you can walk into, with unminable lava-flow falling from the
    //      roof and running down the walls. A central pedestal is where the dormant
    //      boss will wait (boss creature + wake FSM are a later milestone).
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
          for(let dx=-RO; dx<=RO; dx++) for(let dz=-RO; dz<=RO; dz++)
            if(dx*dx + dz*dz <= rr) ctx.set(dx, floorY+dy, dz, BASALT);
        }
        // 2) hollow out the chamber
        const RI = 8, HI = HC - 2;
        for(let dy=1; dy<=HI; dy++){
          const t = dy/HI;
          const r = RI*(1 - 0.8*t*t);
          const rr = r*r;
          for(let dx=-RI; dx<=RI; dx++) for(let dz=-RI; dz<=RI; dz++)
            if(dx*dx + dz*dz <= rr) ctx.set(dx, floorY+dy, dz, AIR);
        }
        // 3) lava-flow falls from the ceiling down the walls
        const falls = [[6,2],[-5,4],[2,-6],[-4,-5],[7,-2]];
        for(const f of falls){ for(let dy=HI; dy>=2; dy--) ctx.set(f[0], floorY+dy, f[1], FLOW); }
        // 4) lava-flow pools spattered across the floor, away from the centre
        for(let dx=-RI; dx<=RI; dx++) for(let dz=-RI; dz<=RI; dz++){
          const d2 = dx*dx + dz*dz;
          if(d2 > 16 && d2 <= RI*RI && ctx.rng() < 0.18) ctx.set(dx, floorY, dz, FLOW);
        }
        // 5) the dormant boss pedestal (centre) — kept clear of lava
        ctx.set(0, floorY, 0, OBSIDIAN);
        ctx.set(0, floorY+1, 0, MAGMA);
        // 6) an entrance tunnel on +x so you can walk in
        for(let dx=RO-1; dx<=RO+2; dx++) for(let dy=1; dy<=3; dy++) for(let dz=-1; dz<=1; dz++)
          ctx.set(dx, floorY+dy, dz, AIR);
      }
    },

    // ---- Verdant Moss Shrine: a quiet ring of wood pillars around a crystal heart.
    mossShrine: {
      name: 'Moss Shrine', nameDa: 'Moshelligdom',
      biome: ['verdant'], rarity: 'landmark', footprint: 16,
      sci: { formula: 'habitat', mineral: 'Landmark', fact: 'A habitat is a place where living things can find food, water, and shelter. Shrines like this mark a quiet pocket of the claim.' },
      desc: 'A ring of weathered pillars around a glowing crystal heart. Someone — or something — kept this place tidy.',
      stamp(ctx){
        const g = ctx.ground, R = 6;
        for(let dx=-R; dx<=R; dx++) for(let dz=-R; dz<=R; dz++){
          const d2 = dx*dx + dz*dz;
          if(d2 <= R*R) ctx.set(dx, g, dz, (d2 <= 4) ? STONE : GRASS);
        }
        const cols = [[-4,-4],[0,-5],[4,-4],[-5,0],[5,0],[-4,4],[0,5],[4,4]];
        for(const c of cols){
          const ht = 3 + (ctx.rng()*2|0);
          for(let dy=1; dy<=ht; dy++) ctx.set(c[0], g+dy, c[1], WOOD);
          ctx.set(c[0], g+ht+1, c[1], LEAVES);
        }
        ctx.set(0, g+1, 0, STONE);
        ctx.set(0, g+2, 0, CRYSTAL);
        ctx.set(0, g+3, 0, CRYSTAL);
      }
    },

    // ---- Frost Geyser: ice cone venting a crystal plume (teaches water phases).
    frostGeyser: {
      name: 'Frost Geyser', nameDa: 'Frostgejser',
      biome: ['frost'], rarity: 'landmark', footprint: 18,
      sci: { formula: 'H₂O phases', mineral: 'Landmark', fact: 'Water can be ice, liquid, or steam. A geyser pushes hot water up through cracks until it bursts into the cold air.' },
      desc: 'A cracked ice cone with a crystal plume. Warm water once punched through the frozen crust here.',
      stamp(ctx){
        const g = ctx.ground, R = 7, Hc = 8;
        for(let dy=0; dy<=Hc; dy++){
          const r = Math.max(2, R * (1 - dy/(Hc+1)));
          const rr = r*r;
          for(let dx=-R; dx<=R; dx++) for(let dz=-R; dz<=R; dz++){
            const d2 = dx*dx + dz*dz;
            if(d2 > rr) continue;
            if(dy > Hc-3 && d2 < 2.5*2.5) continue;
            ctx.set(dx, g+dy, dz, (dy > Hc-2) ? ICE : SNOW);
          }
        }
        // vent pool + crystal plume
        ctx.set(0, g+Hc-2, 0, WATER);
        ctx.set(0, g+Hc-1, 0, WATER);
        for(let dy=0; dy<5; dy++) ctx.set(0, g+Hc+dy, 0, CRYSTAL);
        ctx.set(1, g+Hc+2, 0, CRYSTAL);
        ctx.set(-1, g+Hc+3, 0, ICE);
        // icy apron
        for(let dx=-R-2; dx<=R+2; dx++) for(let dz=-R-2; dz<=R+2; dz++){
          const d2 = dx*dx + dz*dz;
          if(d2 > R*R && d2 <= (R+2)*(R+2) && ctx.rng() < 0.55) ctx.set(dx, g, dz, ICE);
        }
      }
    },

    // ---- Spore Spire: stacked fungal caps — Mycelia landmark.
    sporeSpire: {
      name: 'Spore Spire', nameDa: 'Sporespiral',
      biome: ['fungal'], rarity: 'landmark', footprint: 14,
      sci: { formula: 'mycelium', mineral: 'Landmark', fact: 'Fungi grow a hidden web of threads underground called mycelium. The caps you see are just the fruiting bodies that release spores.' },
      desc: 'A tower of stacked fungal caps pulsing with soft light. Spores drift from the crown.',
      stamp(ctx){
        const g = ctx.ground;
        for(let dy=1; dy<=10; dy++) ctx.set(0, g+dy, 0, FUNGAL);
        const caps = [[3,3],[5,5],[7,4],[9,3]];
        for(const [y,r] of caps){
          for(let dx=-r; dx<=r; dx++) for(let dz=-r; dz<=r; dz++){
            if(dx*dx + dz*dz <= r*r) ctx.set(dx, g+y, dz, (Math.abs(dx)+Math.abs(dz))%3 ? FUNGAL : HIVE);
          }
        }
        ctx.set(0, g+11, 0, EMERALD);
        ctx.set(0, g+12, 0, HIVE);
        // soft ring of fungal mats
        for(let a=0; a<8; a++){
          const ang = a/8*Math.PI*2, rr = 5;
          ctx.set(Math.round(Math.cos(ang)*rr), g+1, Math.round(Math.sin(ang)*rr), FUNGAL);
        }
      }
    },

    // ---- Dust Beacon: rusted antenna on a regolith pad — Dustfall landmark.
    dustBeacon: {
      name: 'Dust Beacon', nameDa: 'Støvfyrtårn',
      biome: ['desert'], rarity: 'landmark', footprint: 12,
      sci: { formula: 'signal', mineral: 'Landmark', fact: 'A beacon is a signal that says “I am here.” Radio antennas send invisible waves through space so explorers can find each other.' },
      desc: 'A lonely metal mast on a stone pad. Its tip still glows — an old signal that never switched off.',
      stamp(ctx){
        const g = ctx.ground, P = 4;
        for(let dx=-P; dx<=P; dx++) for(let dz=-P; dz<=P; dz++)
          ctx.set(dx, g, dz, ((Math.abs(dx)+Math.abs(dz))%2) ? STONE : REGOLITH);
        for(let dy=1; dy<=9; dy++) ctx.set(0, g+dy, 0, METAL);
        ctx.set(0, g+10, 0, CRYSTAL);
        ctx.set(0, g+11, 0, CRYSTAL);
        // cross-arms
        ctx.set(-2, g+7, 0, METAL); ctx.set(-1, g+7, 0, METAL);
        ctx.set(1, g+7, 0, METAL); ctx.set(2, g+7, 0, METAL);
        ctx.set(0, g+7, -2, METAL); ctx.set(0, g+7, 2, METAL);
        // fallen crates
        ctx.set(3, g+1, 2, METAL); ctx.set(3, g+1, 3, METAL);
        ctx.set(-3, g+1, -2, REDROCK);
      }
    },

    // ---- Tide Arch: stone/sand arch with a water mirror — Aquaria-friendly verdant coasts.
    tideArch: {
      name: 'Tide Arch', nameDa: 'Tidebue',
      biome: ['verdant'], rarity: 'landmark', footprint: 16,
      sci: { formula: 'erosion', mineral: 'Landmark', fact: 'Waves and wind slowly wear rock away. Over a long time that carving can open an arch you can walk under.' },
      desc: 'A stone arch worn by old tides, with a shallow pool mirroring the sky.',
      stamp(ctx){
        const g = ctx.ground;
        // pool
        for(let dx=-3; dx<=3; dx++) for(let dz=-2; dz<=2; dz++){
          ctx.set(dx, g-1, dz, STONE);
          ctx.set(dx, g, dz, WATER);
        }
        // two pillars + arch cap
        for(let dy=1; dy<=5; dy++){ ctx.set(-4, g+dy, 0, STONE); ctx.set(4, g+dy, 0, STONE); }
        for(let dx=-4; dx<=4; dx++){
          ctx.set(dx, g+6, 0, STONE);
          if(Math.abs(dx) < 3) ctx.set(dx, g+7, 0, SAND);
        }
        ctx.set(0, g+8, 0, GLASS);
        // sand banks
        for(let dx=-6; dx<=6; dx++) for(let dz=-4; dz<=4; dz++){
          if(Math.abs(dx) > 3 || Math.abs(dz) > 2){
            if(ctx.rng() < 0.4) ctx.set(dx, g, dz, SAND);
          }
        }
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
  // List landmark defs (id + metadata) for a biome — used by HUD / missions.
  function landmarksFor(biome){
    return scatterFor(biome).map((id) => Object.assign({ id }, DEFS[id]));
  }

  window.AsteroidStructures = {
    DEFS, get, scatterFor, lairFor, landmarksFor,
    _ids:{ BASALT, OBSIDIAN, LAVA, FLOW, ASH, MAGMA, GRASS, STONE, WOOD, ICE, CRYSTAL, FUNGAL, SAND }
  };
})();
