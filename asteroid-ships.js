/* =========================================================
   asteroid-ships.js  ->  window.AsteroidShips

   The PJBoy voxel fleet as a content registry for Asteroid mode.
   Ports the fleet viewer's voxel renderer (one InstancedMesh per
   material, subdivided by SUB for resolution — cheap, scales to
   thousands of cubes) and exposes each ship through the universal
   ACTOR contract used by creatures:

       build(name, opts) -> { group, st, anim(t, state, dt), dispose }

   anim() only touches materials / glow / nav-light strobe — the
   owner positions and faces the group. opts.scale resizes the rig.

   Faction palette is locked to the brief's colour grammar
   (pink/cyan Heroes, gold/violet Ancients, green Living, red
   Raiders). Only the Hero Drone builder is wired in for now (the
   milestone-1 companion); the remaining FLEET builders paste into
   the BUILDERS block below and inherit the renderer for free.

   THREE is the global r128 build (window.THREE). No imports.
   ========================================================= */
(function(){
  'use strict';
  if(typeof THREE === 'undefined'){ console.warn('[AsteroidShips] THREE not loaded'); return; }

  // ---------- voxel primitive helpers (paint into Map m) ----------
  const K=(x,y,z)=>Math.round(x)+','+Math.round(y)+','+Math.round(z);
  const S=(m,x,y,z,c)=>m.set(K(x,y,z),c);
  function box(m,x0,x1,y0,y1,z0,z1,c){for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)S(m,x,y,z,c);}
  function ellipsoid(m,cx,cy,cz,rx,ry,rz,c,hollow){
    for(let x=Math.floor(cx-rx);x<=Math.ceil(cx+rx);x++)for(let y=Math.floor(cy-ry);y<=Math.ceil(cy+ry);y++)for(let z=Math.floor(cz-rz);z<=Math.ceil(cz+rz);z++){
      const d=((x-cx)/rx)**2+((y-cy)/ry)**2+((z-cz)/rz)**2;
      if(d<=1&&(!hollow||d>=hollow))S(m,x,y,z,c);
    }
  }
  const sphere=(m,cx,cy,cz,r,c,h)=>ellipsoid(m,cx,cy,cz,r,r,r,c,h);
  function dome(m,cx,cy,cz,r,c){for(let x=Math.floor(cx-r);x<=Math.ceil(cx+r);x++)for(let y=Math.floor(cy);y<=Math.ceil(cy+r);y++)for(let z=Math.floor(cz-r);z<=Math.ceil(cz+r);z++){if(((x-cx)/r)**2+((y-cy)/r)**2+((z-cz)/r)**2<=1&&y>=cy)S(m,x,y,z,c);}}
  function torus(m,cx,cy,cz,R,r,c){for(let x=Math.floor(cx-R-r);x<=Math.ceil(cx+R+r);x++)for(let y=Math.floor(cy-r);y<=Math.ceil(cy+r);y++)for(let z=Math.floor(cz-R-r);z<=Math.ceil(cz+R+r);z++){const q=Math.hypot(x-cx,z-cz)-R;if(q*q+(y-cy)**2<=r*r)S(m,x,y,z,c);}}
  function cyl(m,cx,cy,cz,r,h,c){for(let x=Math.floor(cx-r);x<=Math.ceil(cx+r);x++)for(let z=Math.floor(cz-r);z<=Math.ceil(cz+r);z++){if((x-cx)**2+(z-cz)**2<=r*r)for(let y=Math.floor(cy-h/2);y<=Math.ceil(cy+h/2);y++)S(m,x,y,z,c);}}
  function torusXY(m,cx,cy,cz,R,r,c){for(let x=Math.floor(cx-R-r);x<=Math.ceil(cx+R+r);x++)for(let y=Math.floor(cy-R-r);y<=Math.ceil(cy+R+r);y++)for(let z=Math.floor(cz-r);z<=Math.ceil(cz+r);z++){const q=Math.hypot(x-cx,y-cy)-R;if(q*q+(z-cz)**2<=r*r)S(m,x,y,z,c);}}
  function octa(m,cx,cy,cz,r,c){for(let x=Math.floor(cx-r);x<=Math.ceil(cx+r);x++)for(let y=Math.floor(cy-r);y<=Math.ceil(cy+r);y++)for(let z=Math.floor(cz-r);z<=Math.ceil(cz+r);z++){if(Math.abs(x-cx)+Math.abs(y-cy)+Math.abs(z-cz)<=r)S(m,x,y,z,c);}}

  // ---------- faction palettes (the brief's colour grammar) ----------
  const FACTIONS={
    hero:   {name:'Heroes',     col:0xff3db0, pal:{hull:0xe6e8ee,hull2:0xc9b6c4,panel:0x2b2533,accent:0xff3db0,glass:0x37e6ff,engine:0x37e6ff}},
    ancient:{name:'Ancients',   col:0xffb53d, pal:{hull:0xc9c2b4,hull2:0x9a8f7e,panel:0x2a2535,accent:0xffb53d,glass:0xbfa6ff,engine:0x9a7bff}},
    living: {name:'The Living', col:0x6ee06a, pal:{hull:0x8fae90,hull2:0x6f8a6f,panel:0x24302a,accent:0xbef07a,glass:0x9be8c0,engine:0x55e06a}},
    raider: {name:'Raiders',    col:0xff5a3c, pal:{hull:0x9aa0ac,hull2:0x6a7180,panel:0x14171c,accent:0xff5a3c,glass:0xff8a5a,engine:0xff3344}},
  };

  // ---------- ship builders (return {m, ...spec}) ----------
  // Add more FLEET builders here; they inherit the renderer below.
  function Drone(){
    const m=new Map();
    sphere(m,0,0,0,2,'hull'); sphere(m,0,0,0,2.2,'hull2',0.8);
    dome(m,0,0.3,1.4,1.2,'glass'); sphere(m,0,0.3,1.7,0.6,'engine');   // big eye
    for(const d of [1,-1]) box(m,d*2,d*3,0,0,-1,0,'accent');           // fins
    box(m,0,0,2,3,0,0,'panel'); S(m,0,3,0,'engine');                   // antenna
    ellipsoid(m,0,-2,0,1,0.5,1,'engine');                             // hover thruster
    return {m,ec:0x37e6ff,tilt:0.15,hum:130,spinFast:true,streak:false,engines:[],
      lights:[{x:2.8,y:0,z:0,c:0x37e6ff,rate:2},{x:-2.8,y:0,z:0,c:0xff3db0,rate:2.3}]};
  }

  const BUILDERS = {
    'Drone': { build:Drone, faction:'hero' }
  };

  // ---------- renderer (one InstancedMesh per material) ----------
  const VS=0.30, SUB=2, FS=VS/SUB, CUBE=FS*0.9;
  const _geo=new THREE.BoxGeometry(CUBE,CUBE,CUBE);
  const _off=[]; for(let i=0;i<SUB;i++) _off.push(-0.5+(i+0.5)/SUB);
  const _dummy=new THREE.Object3D();
  const KIND={hull:'l',hull2:'l',panel:'l',accent:'l',glass:'g',engine:'e'};

  // Build a ship as an Actor. opts.scale resizes the whole rig.
  function build(name, opts){
    opts=opts||{};
    const entry = BUILDERS[name];
    if(!entry){ console.warn('[AsteroidShips] unknown ship', name); return null; }
    const spec = entry.build();
    const PAL = FACTIONS[entry.faction].pal;
    const m = spec.m;

    // bucket voxels by material, find centre
    const cats={};
    for(const [k,c] of m){ const p=k.split(',').map(Number); (cats[c]||(cats[c]=[])).push(p); }
    let mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9,mnz=1e9,mxz=-1e9;
    for(const arr of Object.values(cats))for(const p of arr){
      if(p[0]<mnx)mnx=p[0]; if(p[0]>mxx)mxx=p[0];
      if(p[1]<mny)mny=p[1]; if(p[1]>mxy)mxy=p[1];
      if(p[2]<mnz)mnz=p[2]; if(p[2]>mxz)mxz=p[2];
    }
    const cx=(mnx+mxx)/2, cy=(mny+mxy)/2, cz=(mnz+mxz)/2;

    const group=new THREE.Group();
    const inner=new THREE.Group(); group.add(inner);  // inner holds the rig; outer is owner-controlled
    const emissives=[], glowShells=[], navLights=[];

    for(const [cat,arr] of Object.entries(cats)){
      const col=PAL[cat]!=null?PAL[cat]:0xffffff, k=KIND[cat]||'l';
      const mat = k==='l'? new THREE.MeshLambertMaterial({color:col})
        : k==='g'? new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:0.4,transparent:true,opacity:0.6,roughness:.1,metalness:.3})
        : new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:1,roughness:.4,metalness:.1});
      const im=new THREE.InstancedMesh(_geo, mat, arr.length*SUB*SUB*SUB);
      let i=0;
      for(const p of arr) for(const ax of _off) for(const ay of _off) for(const az of _off){
        _dummy.position.set((p[0]+ax-cx)*VS,(p[1]+ay-cy)*VS,(p[2]+az-cz)*VS);
        _dummy.updateMatrix(); im.setMatrixAt(i++, _dummy.matrix);
      }
      im.instanceMatrix.needsUpdate=true;
      inner.add(im);
      if(k!=='l') emissives.push({mat, base:k==='g'?0.4:1});
    }

    // engine glow shells + flames (skipped for the drone; engines:[] empty)
    function vpos(x,y,z){ return new THREE.Vector3((x-cx)*VS,(y-cy)*VS,(z-cz)*VS); }
    for(const e of (spec.engines||[])){
      const p=vpos(e.x,e.y,e.z), sc=e.big?1.6:0.9;
      [[sc,0.26],[sc*1.7,0.12]].forEach(([s,op])=>{
        const me=new THREE.Mesh(new THREE.BoxGeometry(s,s,s),
          new THREE.MeshBasicMaterial({color:PAL.engine,transparent:true,opacity:op,blending:THREE.AdditiveBlending,depthWrite:false}));
        me.position.copy(p); inner.add(me); glowShells.push({mat:me.material,base:op});
      });
    }

    // nav lights (small emissive cubes that blink/strobe)
    for(const l of (spec.lights||[])){
      const me=new THREE.Mesh(new THREE.BoxGeometry(VS*0.6,VS*0.6,VS*0.6),
        new THREE.MeshStandardMaterial({color:l.c,emissive:l.c,emissiveIntensity:1.4}));
      me.position.copy(vpos(l.x,l.y,l.z)); inner.add(me);
      navLights.push({m:me, st:l.st, rate:l.rate||1.4, phase:(l.x*0.7+l.z*1.3)%6});
    }

    inner.rotation.x = spec.tilt||0;
    const s = opts.scale!=null?opts.scale:1;
    group.scale.setScalar(s);

    const st={ glow:1, alert:0, _spin:0 };
    const PINK=0xff3db0, GLOW=spec.ec||0x37e6ff;
    return {
      group, st, spec,
      anim(t, state, dt){
        st.alert += (((state==='alert')?1:0) - st.alert) * (1 - Math.exp(-9*(dt||0.016)));
        const glow = st.glow * (1 + st.alert*0.8);
        const pulse = 1 + Math.sin(t*4)*0.1;
        for(const e of emissives) e.mat.emissiveIntensity = e.base*(0.4+glow)*pulse;
        for(const gsh of glowShells) gsh.mat.opacity = gsh.base*glow;
        for(const nl of navLights){
          const sn=Math.sin(t*nl.rate+nl.phase);
          const f=nl.st?Math.pow(Math.max(0,sn),10):0.45+0.55*(0.5+0.5*sn);
          nl.m.material.emissiveIntensity=0.2+f*(1.8+st.alert*2);
          if(st.alert>0.5){ nl.m.material.color.setHex(PINK); nl.m.material.emissive.setHex(PINK); }
        }
        // gentle eye-forward wobble (no full spin so the eye keeps facing ahead)
        inner.rotation.z = Math.sin(t*1.3)*0.05;
        inner.position.y = Math.sin(t*2.2)*0.04;
      },
      dispose(){
        inner.traverse(o=>{ if(o.isInstancedMesh){ o.material.dispose(); }
          else if(o.isMesh){ o.geometry.dispose(); o.material.dispose(); } });
      }
    };
  }

  function has(name){ return !!BUILDERS[name]; }

  window.AsteroidShips = { build, has, FACTIONS, BUILDERS, _helpers:{ box, ellipsoid, sphere, dome, torus, cyl, torusXY, octa, S } };
})();
