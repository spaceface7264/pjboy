/* =========================================================
   asteroid-creatures.js  ->  window.AsteroidCreatures

   The PJBoy bestiary as a data-driven content registry for
   Asteroid mode. Each creature is a box-rig that follows the
   universal ACTOR contract:

       build() -> { group: THREE.Group, st:{}, anim(t, state, dt) }

   The AI layer only ever sets `state` ('idle' | 'move' | 'alert')
   and the renderer only ever calls `anim`. Ported from the
   Creature Lab; builders are unchanged in spirit so the roster
   stays canon.

   DEFS carries the spawn/biome/temperament data the voxel world
   reads, plus the educational scanner fields (sci facts in
   English as reading practice, Danish names handled by the
   scanner's BLOCK_DA map). `spawn:true` creatures appear in the
   world now (the peaceful Living wildlife — wonder first);
   hostiles, bosses and NPCs are registered but gated off until
   the combat / AI / dialogue milestones land.

   THREE is the global r128 build (window.THREE), same as the
   rest of the game. No imports.
   ========================================================= */
(function(){
  'use strict';
  if(typeof THREE === 'undefined'){ console.warn('[AsteroidCreatures] THREE not loaded'); return; }

  // ---------- shared material / mesh helpers ----------
  function shade(hex,f){
    const r=Math.min(255,(hex>>16&255)*f), g=Math.min(255,(hex>>8&255)*f), b=Math.min(255,(hex&255)*f);
    return (r<<16)|(g<<8)|b;
  }
  function std(color,o){
    o=o||{};
    return new THREE.MeshStandardMaterial({
      color, roughness:o.rough==null?.82:o.rough, metalness:o.metal==null?.12:o.metal,
      emissive:o.emissive==null?0x000000:o.emissive, emissiveIntensity:o.ei==null?1:o.ei,
      transparent:o.transparent||false, opacity:o.opacity==null?1:o.opacity });
  }
  function pbox(w,h,d,mat){ return new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat); }
  const OUTLINE = new THREE.MeshBasicMaterial({color:0x090a12, side:THREE.BackSide});
  function addOutlines(root){
    const t=[];
    root.traverse(o=>{ if(o.isMesh && o.geometry.type==='BoxGeometry'
      && !o.userData.isOutline && !o.userData.noOutline
      && !(o.material&&o.material.isMeshBasicMaterial)) t.push(o); });
    t.forEach(m=>{ const o=new THREE.Mesh(m.geometry,OUTLINE);
      o.scale.setScalar(1.06); o.userData.isOutline=true; m.add(o); });
  }
  const ease = (o,k,target,rate,dt)=> o[k]+=(target-(o[k]||0))*(1-Math.exp(-rate*dt));
  function eyePair(parent,col,x,y,z,sx,sy){
    sx=sx==null?.1:sx; sy=sy==null?.12:sy;
    const m=new THREE.MeshBasicMaterial({color:col});
    [-1,1].forEach(s=>{ const e=pbox(sx,sy,.04,m); e.userData.noOutline=true;
      e.position.set(s*x,y,z); parent.add(e); });
  }

  // ---------- self-contained fx (breath, spores, embers) ----------
  // The voxel runtime injects its scene via setScene() on enter and
  // pumps stepFx(dt) each frame; spark() is a no-op until then.
  let _scene=null; const fx=[];
  function setScene(s){ _scene=s; }
  function spark(pos,color,vel,life,size){
    if(!_scene) return;
    const m=new THREE.Mesh(new THREE.BoxGeometry(size,size,size),
      new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9}));
    m.position.copy(pos); _scene.add(m);
    fx.push({m,vel:vel.clone(),t:0,life,g:size>.12?6:0});
  }
  function stepFx(dt){
    for(let i=fx.length-1;i>=0;i--){
      const p=fx[i]; p.t+=dt;
      if(p.t>=p.life){ if(_scene) _scene.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); fx.splice(i,1); continue; }
      p.vel.y-=p.g*dt; p.m.position.addScaledVector(p.vel,dt);
      const k=1-p.t/p.life; p.m.material.opacity=k*.9; p.m.scale.setScalar(k);
    }
  }
  function clearFx(){
    for(const p of fx){ if(_scene) _scene.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); }
    fx.length=0;
  }
  const _v=new THREE.Vector3();
  function worldOf(obj,x,y,z){ return obj.localToWorld(_v.set(x,y,z)).clone(); }

  /* =========================================================
     CREATURE BUILDERS — each returns { group, st, anim(t,state,dt) }
     ========================================================= */

  // ---- 1. MOSSHORN — Verdant — Passive — hexapod grazer ----
  function buildMosshorn(){
    const bodyM=std(0x6f7d46), backM=std(0x5e6b3a), bellyM=std(0x9a7a4a),
          headM=std(0x66743e), hornM=std(0xd8cba6), mossM=std(0x6ad055), hoofM=std(0x3a3026);
    const g=new THREE.Group(); const core=new THREE.Group(); core.position.y=.95; g.add(core);
    const body=pbox(1.0,.62,.92,bodyM); core.add(body);
    const back=pbox(1.06,.34,.96,backM); back.position.y=.2; core.add(back);
    const belly=pbox(.9,.3,.82,bellyM); belly.position.y=-.22; core.add(belly);
    for(let i=0;i<7;i++){ const t=pbox(.1+(i*97%10)/55,.1,.1,mossM);
      t.position.set(((i*53%10)/10-.5)*.9,.4,((i*31%10)/10-.5)*.8); core.add(t); }
    const neck=new THREE.Group(); neck.position.set(0,.12,.5); core.add(neck);
    const head=pbox(.56,.46,.5,headM); head.position.set(0,-.04,.26); neck.add(head);
    const snout=pbox(.4,.26,.18,bellyM); snout.position.set(0,-.12,.5); neck.add(snout);
    [-1,1].forEach(s=>{ const h=pbox(.1,.34,.1,hornM); h.position.set(s*.2,.28,.18);
      h.rotation.z=s*.5; neck.add(h);
      const ear=pbox(.16,.08,.1,headM); ear.position.set(s*.3,.12,.1); neck.add(ear); });
    eyePair(neck,0x101218,.18,.02,.46,.08,.1);
    const tail=new THREE.Group(); tail.position.set(0,.12,-.5); core.add(tail);
    const tseg=pbox(.12,.12,.4,backM); tseg.position.z=-.2; tail.add(tseg);
    const tuft=pbox(.18,.18,.14,mossM); tuft.position.z=-.42; tail.add(tuft);
    const legs=[];
    [[.32],[0],[-.34]].forEach((zr,col)=>{ [-1,1].forEach(s=>{
      const hip=new THREE.Group(); hip.position.set(s*.42,-.26,zr[0]); core.add(hip);
      const up=pbox(.16,.34,.16,bodyM); up.position.y=-.16; hip.add(up);
      const knee=new THREE.Group(); knee.position.y=-.32; hip.add(knee);
      const lo=pbox(.13,.3,.13,backM); lo.position.y=-.15; knee.add(lo);
      const hoof=pbox(.16,.1,.18,hoofM); hoof.position.y=-.32; knee.add(hoof);
      legs.push({hip,knee,phase:(col+ (s>0?1.5:0))});
    });});
    addOutlines(g);
    const st={walk:0,graze:1,alert:0,gz:0};
    return {group:g, st,
      anim(t,state,dt){
        ease(st,'walk', state==='move'?1:0, 8, dt);
        ease(st,'graze', state==='idle'?1:0, 5, dt);
        ease(st,'alert', state==='alert'?1:0, 9, dt);
        const breath=Math.sin(t*2)*.02;
        core.position.y=.95+breath+ st.alert*.06;
        st.gz += dt*(state==='idle'?1:0);
        const dip = st.graze*(.55+Math.sin(st.gz*3)*.04*(Math.sin(st.gz*.5)>0?1:0));
        neck.rotation.x = dip - st.alert*.5 + st.walk*-.1;
        neck.rotation.y = (1-st.graze)*Math.sin(t*.6)*.25*(1-st.alert);
        tail.rotation.y=Math.sin(t*1.6+1)*.25*(.4+st.walk);
        tail.rotation.x=-.2 - st.alert*.4;
        const f=t*7;
        legs.forEach(L=>{ const s=Math.sin(f+L.phase*Math.PI)*st.walk;
          L.hip.rotation.x=s*.6; L.knee.rotation.x=Math.max(0,-s)*.9; });
        if(state==='alert'){ core.position.z=-.06; } else core.position.z=0;
      }};
  }

  // ---- 2. FROSTMANE — Frostpeak — Neutral — woolly quadruped ----
  function buildFrostmane(){
    const furM=std(0xdfeaf4,{rough:.95}), furD=std(0xb8c9dc,{rough:.95}),
          hornM=std(0x9aa6b4), hoofM=std(0x3a4250), faceM=std(0xcdd9e6);
    const g=new THREE.Group(); const core=new THREE.Group(); core.position.y=1.05; g.add(core);
    const body=pbox(1.1,.7,1.0,furM); core.add(body);
    for(let i=0;i<14;i++){ const t=pbox(.18,.16,.18,i%2?furM:furD);
      t.position.set(((i*47%10)/10-.5)*1.05,((i*29%10)/10-.3)*.5,((i*71%10)/10-.5)*.95); core.add(t); }
    const neck=new THREE.Group(); neck.position.set(0,.18,.52); core.add(neck);
    const mane=pbox(.66,.6,.4,furD); mane.position.set(0,.06,.1); neck.add(mane);
    const head=pbox(.5,.46,.56,faceM); head.position.set(0,-.06,.4); neck.add(head);
    const muzzle=pbox(.3,.24,.2,furM); muzzle.position.set(0,-.16,.62); neck.add(muzzle);
    [-1,1].forEach(s=>{ const h=pbox(.12,.16,.12,hornM); h.position.set(s*.26,.18,.36);
      h.rotation.z=s*.7; neck.add(h);
      const h2=pbox(.1,.2,.1,hornM); h2.position.set(s*.36,.32,.36); h2.rotation.z=s*1.1; neck.add(h2); });
    eyePair(neck,0x1a2230,.16,-.02,.62,.08,.09);
    const tail=new THREE.Group(); tail.position.set(0,.1,-.54); core.add(tail);
    const tt=pbox(.16,.16,.34,furD); tt.position.z=-.18; tail.add(tt);
    const legs=[];
    [.34,-.36].forEach((z,zi)=>{ [-1,1].forEach(s=>{
      const hip=new THREE.Group(); hip.position.set(s*.44,-.32,z); core.add(hip);
      const up=pbox(.22,.4,.24,furM); up.position.y=-.2; hip.add(up);
      const knee=new THREE.Group(); knee.position.y=-.38; hip.add(knee);
      const lo=pbox(.18,.32,.2,furD); lo.position.y=-.16; knee.add(lo);
      const hoof=pbox(.2,.12,.22,hoofM); hoof.position.y=-.34; knee.add(hoof);
      legs.push({hip,knee,phase:(zi*2+(s>0?1:0))%4});
    });});
    addOutlines(g);
    const st={walk:0,alert:0,puff:0};
    return {group:g, st,
      anim(t,state,dt){
        ease(st,'walk', state==='move'?1:0, 6, dt);
        ease(st,'alert', state==='alert'?1:0, 9, dt);
        const shiver=(state==='idle')?Math.sin(t*40)*.006:0;
        core.position.y=1.05+Math.sin(t*1.8)*.02;
        core.rotation.z=shiver;
        neck.rotation.x=-.1 + st.alert*.55 + Math.sin(t*.7)*.05*(1-st.alert);
        neck.rotation.y=Math.sin(t*.5)*.12*(1-st.walk)*(1-st.alert);
        tail.rotation.y=Math.sin(t*1.4)*.2*(.3+st.walk);
        const f=t*5;
        legs.forEach(L=>{ const s=Math.sin(f+L.phase*Math.PI/2)*st.walk;
          L.hip.rotation.x=s*.5; L.knee.rotation.x=Math.max(0,-s)*.8; });
        if(st.alert>.5){ legs[0].hip.rotation.x=Math.sin(t*6)*.4-.2; }
        st.puff+=dt;
        if((state==='idle'||state==='alert') && st.puff>1.1){ st.puff=0;
          const p=worldOf(neck,0,-.16,.8);
          spark(p,0xdfeaf4,new THREE.Vector3((Math.sin(t*9))*.3,.3,.7),.8,.1);
        }
      }};
  }

  // ---- 3. DRIFTJELLY — Aquaria — Passive — floating bioluminescent ----
  function buildDriftjelly(){
    const bellM=std(0x4ad6e0,{transparent:true,opacity:.6,emissive:0x1a8aa0,ei:.6,rough:.3});
    const coreM=std(0x9af0ff,{emissive:0x6fe3ff,ei:1.4});
    const tentM=std(0x7ae0f0,{transparent:true,opacity:.75,emissive:0x2aa0c0,ei:.5});
    const g=new THREE.Group(); const core=new THREE.Group(); core.position.y=1.4; g.add(core);
    const bell=new THREE.Group(); core.add(bell);
    const tiers=[[.95,.18,0],[.8,.18,.2],[.58,.16,.36],[.32,.14,.48]];
    tiers.forEach(a=>{ const b=pbox(a[0],a[1],a[0],bellM); b.position.y=a[2]; b.userData.noOutline=true; bell.add(b); });
    const glow=pbox(.4,.3,.4,coreM); glow.position.y=.08; glow.userData.noOutline=true; bell.add(glow);
    const light=new THREE.PointLight(0x6fe3ff,1.2,6); light.position.y=.1; bell.add(light);
    const tents=[];
    for(let i=0;i<6;i++){ const a=i/6*Math.PI*2, r=.34;
      const root=new THREE.Group(); root.position.set(Math.cos(a)*r,-.05,Math.sin(a)*r); core.add(root);
      const segs=[]; let parent=root;
      for(let s=0;s<4;s++){ const seg=new THREE.Group(); seg.position.y=s===0?-.05:-.26; parent.add(seg);
        const m=pbox(.08,.26,.08,tentM); m.position.y=-.13; m.userData.noOutline=true; seg.add(m);
        segs.push(seg); parent=seg; }
      tents.push({root,segs,phase:a});
    }
    const st={pulse:0,move:0,alert:0};
    return {group:g, st,
      anim(t,state,dt){
        ease(st,'move', state==='move'?1:0, 4, dt);
        ease(st,'alert', state==='alert'?1:0, 10, dt);
        const rate=2.2 + st.move*2.5;
        const pulse=Math.sin(t*rate);
        const contract=(pulse*.5+.5);
        bell.scale.set(1+contract*.1, 1-contract*.18, 1+contract*.1);
        core.position.y=1.4 + Math.sin(t*rate - .6)*(.12+st.move*.18);
        const gI=1.4 + Math.sin(t*rate)*.6 + st.alert*3;
        glow.material.emissiveIntensity=gI; light.intensity=1.2+st.alert*3+Math.sin(t*rate)*.4;
        glow.material.color.setHex(st.alert>.5?0xfff0b0:0x9af0ff);
        light.color.setHex(st.alert>.5?0xffd45c:0x6fe3ff);
        tents.forEach((T)=>{
          T.segs.forEach((seg,si)=>{
            const lag=si*.5;
            const sway=Math.sin(t*rate - lag + T.phase)*(.12+ .06*si);
            seg.rotation.x=sway*(1-st.alert) - st.alert*(.5+si*.3);
            seg.rotation.z=Math.cos(t*1.3 - lag + T.phase)*.08*(1-st.alert);
          });
        });
        core.rotation.y += dt*(.2+st.move*.8);
      }};
  }

  // ---- 4. SPORELING — Mycelia — Neutral — hopping fungal biped ----
  function buildSporeling(){
    const bodyM=std(0xb9a6c4), capM=std(0xc0493c), gillM=std(0xffd8b0,{emissive:0xffae6a,ei:.8}),
          stemM=std(0xe6dcc8), limbM=std(0x8a7a98), spotM=std(0xf0e0d0);
    const g=new THREE.Group(); const core=new THREE.Group(); core.position.y=.5; g.add(core);
    const body=pbox(.46,.44,.42,bodyM); core.add(body);
    const neck=new THREE.Group(); neck.position.y=.32; core.add(neck);
    const stem=pbox(.16,.18,.16,stemM); stem.position.y=.06; neck.add(stem);
    const cap=pbox(.66,.22,.66,capM); cap.position.y=.24; neck.add(cap);
    const cap2=pbox(.4,.16,.4,capM); cap2.position.y=.38; neck.add(cap2);
    for(let i=0;i<5;i++){ const sp=pbox(.1,.04,.1,spotM);
      sp.position.set(((i*37%10)/10-.5)*.5,.36,((i*61%10)/10-.5)*.5); neck.add(sp); }
    const gill=pbox(.6,.06,.6,gillM); gill.position.y=.12; gill.userData.noOutline=true; neck.add(gill);
    eyePair(core,0x2a1a2a,.12,.04,.22,.07,.09);
    const arms=[];
    [-1,1].forEach(s=>{ const sh=new THREE.Group(); sh.position.set(s*.27,.1,0); core.add(sh);
      const a=pbox(.1,.26,.1,limbM); a.position.y=-.12; sh.add(a); arms.push(sh); });
    const legs=[];
    [-1,1].forEach(s=>{ const hip=new THREE.Group(); hip.position.set(s*.14,-.22,0); core.add(hip);
      const up=pbox(.13,.24,.13,limbM); up.position.y=-.12; hip.add(up);
      const foot=pbox(.18,.08,.22,bodyM); foot.position.y=-.26; hip.add(foot); legs.push(hip); });
    addOutlines(g);
    const st={hop:0,alert:0,hp:0,puff:0,squash:0};
    return {group:g, st,
      anim(t,state,dt){
        ease(st,'hop', state==='move'?1:0, 6, dt);
        ease(st,'alert', state==='alert'?1:0, 12, dt);
        const idleB=Math.abs(Math.sin(t*2.5))*.04*(1-st.hop)*(1-st.alert);
        st.hp += dt*st.hop*4;
        const hopPh=(Math.sin(st.hp)*.5+.5);
        const air=Math.pow(hopPh,1.5)*.35*st.hop;
        const squashTgt = st.alert>.5? -.3 : 0;
        ease(st,'squash',squashTgt,10,dt);
        core.position.y=.5 + idleB + air + st.squash;
        core.scale.y=1 - air*.3 + st.squash*.4 - st.alert*.1;
        core.scale.x=1 + st.alert*.1 - air*.1;
        neck.rotation.x=Math.sin(t*2.5)*.05*(1-st.alert) - st.alert*.2;
        arms.forEach((a,i)=>{ a.rotation.z=(i?-1:1)*(.5+Math.sin(t*2.5+i)*.2) - (i?-1:1)*st.alert*.6;
          a.rotation.x=-air*1.5; });
        legs.forEach((l)=>{ l.rotation.x=-air*1.2; });
        st.puff+=dt;
        const interval= st.alert>.5? .15 : 1.3;
        if(st.puff>interval){ st.puff=0;
          const n= st.alert>.5? 5:1;
          for(let k=0;k<n;k++){ const p=worldOf(neck,0,.12,0);
            spark(p,0xffc89a,new THREE.Vector3((Math.sin(t*7+k)-.0)*(st.alert>.5?2:.5),
              .3+(k*0.13%0.4),(Math.cos(t*6+k))*(st.alert>.5?2:.5)), 1.0, .07); }
        }
      }};
  }

  // ---- 5. CINDERHOUND — Ember — Hostile — lava predator ----
  function buildCinderhound(){
    const hideM=std(0x1c1820,{rough:.7}), crackM=std(0xff5a1e,{emissive:0xff4a10,ei:1.6}),
          jawM=std(0x2a2228), toothM=std(0xf0e8d8), clawM=std(0x14110f);
    const g=new THREE.Group(); const core=new THREE.Group(); core.position.y=.7; g.add(core);
    const body=pbox(1.1,.5,.62,hideM); core.add(body);
    const hump=pbox(.7,.3,.5,hideM); hump.position.set(-.1,.22,0); core.add(hump);
    for(let i=0;i<5;i++){ const c=pbox(.5,.05,.05,crackM); c.userData.noOutline=true;
      c.position.set(-.4+i*.22,.12+Math.sin(i)*.06,.32); core.add(c);
      const c2=c.clone(); c2.position.z=-.32; core.add(c2); }
    for(let i=0;i<5;i++){ const sp=pbox(.08,.18+ (i===2?.1:0),.1,clawM);
      sp.position.set(-.3+i*.16,.34,0); sp.rotation.x=-.2; core.add(sp);
      const gl=pbox(.04,.1,.04,crackM); gl.userData.noOutline=true; gl.position.set(-.3+i*.16,.28,0); core.add(gl); }
    const neck=new THREE.Group(); neck.position.set(.5,.06,0); core.add(neck);
    const skull=pbox(.42,.4,.46,hideM); skull.position.x=.26; neck.add(skull);
    const upperJaw=pbox(.5,.16,.4,jawM); upperJaw.position.set(.4,-.04,0); neck.add(upperJaw);
    const jaw=new THREE.Group(); jaw.position.set(.18,-.12,0); neck.add(jaw);
    const lj=pbox(.46,.12,.36,jawM); lj.position.x=.22; jaw.add(lj);
    for(let i=0;i<4;i++){ const tu=pbox(.05,.1,.05,toothM); tu.position.set(.16+i*.1,.04,.14); jaw.add(tu);
      const td=pbox(.05,.1,.05,toothM); td.position.set(.16+i*.1,.04,-.14); jaw.add(td);
      const uu=pbox(.05,.1,.05,toothM); uu.position.set(.28+i*.1,-.1,.14); neck.add(uu); }
    const maw=pbox(.4,.12,.32,crackM); maw.userData.noOutline=true; maw.position.set(.36,-.08,0); neck.add(maw);
    eyePair(neck,0xffd23a,.12,.12,.18,.08,.06);
    const tail=new THREE.Group(); tail.position.set(-.55,.1,0); core.add(tail);
    const t1=pbox(.16,.16,.16,hideM); t1.position.x=-.18; tail.add(t1);
    const t2=pbox(.1,.1,.1,clawM); t2.position.x=-.36; tail.add(t2);
    const legs=[];
    [.42,-.42].forEach((x,xi)=>{ [-1,1].forEach(s=>{
      const hip=new THREE.Group(); hip.position.set(x,-.16,s*.3); core.add(hip);
      const up=pbox(.15,.32,.15,hideM); up.position.y=-.15; hip.add(up);
      const knee=new THREE.Group(); knee.position.y=-.3; hip.add(knee);
      const lo=pbox(.12,.3,.12,jawM); lo.position.y=-.14; knee.add(lo);
      const paw=pbox(.18,.1,.22,clawM); paw.position.set(0,-.3,.04); knee.add(paw);
      legs.push({hip,knee,phase:(xi*2+(s>0?1:0))%4});
    });});
    addOutlines(g);
    const st={lope:0,alert:0,snap2:0};
    return {group:g, st,
      anim(t,state,dt){
        ease(st,'lope', state==='move'?1:0, 7, dt);
        ease(st,'alert', state==='alert'?1:0, 10, dt);
        core.position.y=.7 - .08*(1-st.lope) + Math.sin(t*2)*.012;
        const flick=1.4+Math.sin(t*11)*.3+Math.sin(t*7+1)*.2;
        crackM.emissiveIntensity=flick + st.alert*1.5;
        neck.rotation.y=(1-st.alert)*Math.sin(t*.8)*.18;
        neck.rotation.x=-st.alert*.1;
        const snap = state==='alert'? (Math.sin(t*7)>.6?1:0) : 0;
        ease(st,'snap2', snap, 18, dt);
        jaw.rotation.z = (st.snap2||0)*.5 + (1-st.alert)*Math.abs(Math.sin(t*1.5))*.04;
        const cycle=(Math.sin(t*2.5)*.5+.5);
        const lunge = st.alert*cycle;
        core.position.x = lunge*.25;
        core.rotation.z = -lunge*.05;
        tail.rotation.y=Math.sin(t*2+1)*.3*(.4+st.lope);
        tail.rotation.z=.2;
        const f=t*9;
        legs.forEach(L=>{ const s=Math.sin(f+L.phase*Math.PI/2)*st.lope;
          L.hip.rotation.z=s*.7; L.knee.rotation.z=-Math.max(0,-s)*.9 - .2; });
        if(Math.sin(t*53)>.4){ const p=worldOf(core,(Math.sin(t*31))*1,.3,(Math.cos(t*29))*.6);
          spark(p,0xff7a2c,new THREE.Vector3(0,.6+(t*7%1),0),.9,.06); }
      }};
  }

  // ---- 6. SENTINEL — Dustfall ruins — Hostile — Ancient drone ----
  function buildSentinel(){
    const shellM=std(0xd89a3a,{metal:.4,rough:.5}), shellD=std(0x9a6a20,{metal:.4,rough:.5}),
          eyeM=std(0x6fe3ff,{emissive:0x6fe3ff,ei:1.8}), ringM=std(0xe8b33b,{metal:.6,rough:.35,emissive:0x3a2a08,ei:.5}),
          emitM=std(0xffd45c,{emissive:0xffae3a,ei:1.2});
    const g=new THREE.Group(); const core=new THREE.Group(); core.position.y=1.4; g.add(core);
    const top=pbox(.5,.3,.5,shellM); top.position.y=.16; top.rotation.y=Math.PI/4; core.add(top);
    const mid=pbox(.66,.34,.66,shellM); mid.rotation.y=Math.PI/4; core.add(mid);
    const bot=pbox(.44,.3,.44,shellD); bot.position.y=-.24; bot.rotation.y=Math.PI/4; core.add(bot);
    const eyeJ=new THREE.Group(); eyeJ.position.set(0,0,.34); core.add(eyeJ);
    const socket=pbox(.34,.34,.18,shellD); eyeJ.add(socket);
    const eye=pbox(.2,.2,.12,eyeM); eye.position.z=.08; eye.userData.noOutline=true; eyeJ.add(eye);
    const eyeLight=new THREE.PointLight(0x6fe3ff,1,5); eyeLight.position.z=.3; eyeJ.add(eyeLight);
    const ring=new THREE.Group(); core.add(ring);
    for(let i=0;i<8;i++){ const a=i/8*Math.PI*2;
      const sh=pbox(.14,.1,.1,ringM); sh.position.set(Math.cos(a)*.62,0,Math.sin(a)*.62);
      sh.rotation.y=-a; ring.add(sh); }
    const emit=pbox(.18,.16,.18,emitM); emit.position.y=-.42; emit.userData.noOutline=true; core.add(emit);
    [-1,1].forEach(s=>{ const fin=pbox(.1,.06,.34,shellD); fin.position.set(s*.42,-.05,0); core.add(fin); });
    addOutlines(g);
    const st={move:0,alert:0};
    return {group:g, st,
      anim(t,state,dt){
        ease(st,'move', state==='move'?1:0, 4, dt);
        ease(st,'alert', state==='alert'?1:0, 12, dt);
        core.position.y=1.4+Math.sin(t*2.2)*.06;
        core.rotation.x=st.move*.2;
        ring.rotation.y += dt*(1.2 + st.move*2 + st.alert*8);
        ring.rotation.x = Math.sin(t*1.5)*.1 + st.alert*.3;
        eyeJ.rotation.y=(1-st.alert)*Math.sin(t*.8)*.7;
        eyeJ.rotation.x=(1-st.alert)*Math.sin(t*.5)*.2;
        const hostile=st.alert>.5;
        eye.material.color.setHex(hostile?0xff5a3a:0x6fe3ff);
        eye.material.emissive.setHex(hostile?0xff4a2a:0x6fe3ff);
        eye.material.emissiveIntensity=1.6+Math.sin(t*(hostile?12:3))*.6;
        eyeLight.color.setHex(hostile?0xff5a3a:0x6fe3ff);
        eyeLight.intensity=1+st.alert*2;
        emit.material.emissiveIntensity=1.2+st.alert*(2+Math.sin(t*14)*1.5);
        emit.scale.setScalar(1+st.alert*Math.abs(Math.sin(t*7))*.4);
      }};
  }

  // ---- 7. SKATE — The Living — Aquaria/sky — gliding filter-feeder ----
  function buildSkate(){
    const skinM=std(0x2c4e86,{rough:.5}), under=std(0x6fc8e8,{emissive:0x2a7aa0,ei:.4}),
          edgeM=std(0x1a2c52), finM=std(0x3a5e9a);
    const g=new THREE.Group(); const core=new THREE.Group(); core.position.y=1.7; g.add(core);
    const body=pbox(.5,.2,.95,skinM); core.add(body);
    const head=pbox(.36,.16,.3,skinM); head.position.z=.58; core.add(head);
    [-1,1].forEach(s=>{ const ceph=pbox(.1,.1,.26,finM); ceph.position.set(s*.18,0,.74);
      ceph.rotation.y=s*.3; core.add(ceph); });
    eyePair(core,0x0a1422,.14,.04,.62,.07,.08);
    const glow=pbox(.42,.04,.78,under); glow.position.y=-.12; glow.userData.noOutline=true; core.add(glow);
    const wings=[];
    [-1,1].forEach(s=>{
      const root=new THREE.Group(); root.position.set(s*.22,0,0); core.add(root);
      const inner=pbox(.8,.07,.82,skinM); inner.position.x=s*.4; root.add(inner);
      const ie=pbox(.84,.03,.86,edgeM); ie.position.x=s*.4; ie.userData.noOutline=true; root.add(ie);
      const tipJ=new THREE.Group(); tipJ.position.x=s*.78; root.add(tipJ);
      const tip=pbox(.66,.05,.6,skinM); tip.position.x=s*.32; tipJ.add(tip);
      wings.push({root,tipJ,s});
    });
    const tail=[]; let parent=core; const len=[.26,.22,.18,.14];
    len.forEach((l,i)=>{ const seg=new THREE.Group(); seg.position.z=i===0?-.5:-l-.04; parent.add(seg);
      const m=pbox(.08-i*.012,.06,l,finM); m.position.z=-l/2; seg.add(m); tail.push(seg); parent=seg; });
    addOutlines(g);
    const st={move:0,alert:0};
    return {group:g, st,
      anim(t,state,dt){
        ease(st,'move',state==='move'?1:0,4,dt);
        ease(st,'alert',state==='alert'?1:0,9,dt);
        const rate=1.6+st.move*1.8;
        const flap=Math.sin(t*rate);
        core.position.y=1.7+Math.sin(t*rate)*.18;
        core.rotation.z=Math.sin(t*rate*.5)*.12*(1-st.alert);
        core.rotation.x=-st.move*.15 - st.alert*.2;
        wings.forEach(w=>{
          w.root.rotation.z=-w.s*(flap*.5 + .1) - w.s*st.alert*.5;
          w.tipJ.rotation.z=-w.s*(Math.sin(t*rate-.6)*.5);
        });
        tail.forEach((seg,i)=>{ seg.rotation.y=Math.sin(t*rate-i*.5)*.18;
          seg.rotation.x=Math.sin(t*rate-i*.4)*.1; });
      }};
  }

  // ---- 8. GLOWMOTH — The Living — night/Mycelia — gentle lantern flyer ----
  function buildGlowmoth(){
    const furM=std(0x5a4a66,{rough:.95}), wingM=std(0xc89af0,{emissive:0xb06ae0,ei:1.0,transparent:true,opacity:.85}),
          wing2=std(0xf0c86a,{emissive:0xe0a83a,ei:.9,transparent:true,opacity:.8}), antM=std(0x3a2e48);
    const g=new THREE.Group(); const core=new THREE.Group(); core.position.y=1.5; g.add(core);
    const thorax=pbox(.26,.3,.4,furM); core.add(thorax);
    const abdomen=pbox(.2,.2,.4,furM); abdomen.position.z=-.36; core.add(abdomen);
    const head=pbox(.22,.2,.18,furM); head.position.z=.28; core.add(head);
    eyePair(core,0x1a1422,.08,.02,.36,.07,.09);
    const light=new THREE.PointLight(0xd89af0,1.1,5); core.add(light);
    const wings=[];
    [-1,1].forEach(s=>{
      const fore=new THREE.Group(); fore.position.set(s*.12,.06,.08); core.add(fore);
      const fw=pbox(.5,.03,.4,wingM); fw.position.set(s*.28,0,0); fore.add(fw);
      const fp=pbox(.18,.04,.16,wing2); fp.position.set(s*.34,.01,.04); fp.userData.noOutline=true; fore.add(fp);
      const hind=new THREE.Group(); hind.position.set(s*.1,-.02,-.16); core.add(hind);
      const hw=pbox(.36,.03,.32,wingM); hw.position.set(s*.2,0,0); hind.add(hw);
      wings.push({fore,hind,s});
    });
    [-1,1].forEach(s=>{ const ant=pbox(.03,.03,.22,antM); ant.position.set(s*.06,.12,.34);
      ant.rotation.x=-.6; ant.rotation.z=s*.3; core.add(ant); });
    addOutlines(g);
    const st={move:0,alert:0};
    return {group:g, st,
      anim(t,state,dt){
        ease(st,'move',state==='move'?1:0,4,dt);
        ease(st,'alert',state==='alert'?1:0,10,dt);
        const rate=16+st.alert*10;
        const flap=Math.sin(t*rate);
        core.position.y=1.5+Math.sin(t*3)*.12+Math.sin(t*rate)*.01;
        core.position.x=Math.sin(t*1.3)*.2*(1-st.alert);
        core.rotation.z=Math.sin(t*1.7)*.1;
        wings.forEach(w=>{ w.fore.rotation.z=-w.s*(flap*.7+.2);
          w.hind.rotation.z=-w.s*(Math.sin(t*rate-.4)*.6+.15); });
        const pulse=1.0+Math.sin(t*4)*.4+st.alert*1.5;
        light.intensity=pulse; light.color.setHex(st.alert>.5?0xffd45c:0xd89af0);
        wings.forEach(w=>{ w.fore.children[0].material.emissiveIntensity=pulse; });
      }};
  }

  // ---- 9. WARDEN — The Ancients — boss construct ----
  function buildWarden(){
    const shellM=std(0xd89a3a,{metal:.45,rough:.45}), shellD=std(0x8a5e1c,{metal:.45,rough:.45}),
          coreM=std(0xffd45c,{emissive:0xffae3a,ei:1.4}), eyeM=std(0x6fe3ff,{emissive:0x6fe3ff,ei:1.8}),
          ringM=std(0xe8b33b,{metal:.6,rough:.3,emissive:0x4a3208,ei:.5}), shardM=std(0xb8842a,{metal:.5});
    const g=new THREE.Group(); const core=new THREE.Group(); core.position.y=2.0; g.add(core);
    const o1=new THREE.Mesh(new THREE.OctahedronGeometry(.7), shellM); core.add(o1);
    const belt=pbox(1.0,.3,1.0,shellD); belt.rotation.y=Math.PI/4; core.add(belt);
    const crown=new THREE.Mesh(new THREE.OctahedronGeometry(.4), shellM); crown.position.y=.7; core.add(crown);
    const pc=new THREE.Mesh(new THREE.OctahedronGeometry(.3), coreM); pc.userData.noOutline=true; core.add(pc);
    const eyeJ=new THREE.Group(); eyeJ.position.z=.5; core.add(eyeJ);
    const socket=pbox(.5,.3,.2,shellD); eyeJ.add(socket);
    const eye=pbox(.28,.2,.14,eyeM); eye.position.z=.1; eye.userData.noOutline=true; eyeJ.add(eye);
    const eyeLight=new THREE.PointLight(0x6fe3ff,1.4,8); eyeLight.position.z=.4; eyeJ.add(eyeLight);
    const ringA=new THREE.Group(); core.add(ringA);
    const ringB=new THREE.Group(); ringB.rotation.x=Math.PI/2.4; core.add(ringB);
    [ringA,ringB].forEach((R,ri)=>{ for(let i=0;i<10;i++){ const a=i/10*Math.PI*2;
      const sh=pbox(.2,.12,.12,ringM); const r=1.05+ri*.15;
      sh.position.set(Math.cos(a)*r,0,Math.sin(a)*r); sh.rotation.y=-a; R.add(sh); } });
    const limbs=[];
    for(let i=0;i<4;i++){ const a=i/4*Math.PI*2;
      const L=new THREE.Group(); core.add(L);
      const arm=new THREE.Mesh(new THREE.OctahedronGeometry(.22), shardM);
      arm.position.set(Math.cos(a)*1.35,0,Math.sin(a)*1.35); L.add(arm);
      const tip=pbox(.08,.08,.24,coreM); tip.userData.noOutline=true;
      tip.position.set(Math.cos(a)*1.6,0,Math.sin(a)*1.6); L.add(tip);
      limbs.push({L,a}); }
    const cannon=pbox(.34,.34,.34,shellD); cannon.position.y=-.7; cannon.rotation.y=Math.PI/4; core.add(cannon);
    const muzzle=new THREE.Mesh(new THREE.OctahedronGeometry(.18), coreM); muzzle.position.y=-.92;
    muzzle.userData.noOutline=true; core.add(muzzle);
    addOutlines(g);
    const st={move:0,alert:0};
    return {group:g, st,
      anim(t,state,dt){
        ease(st,'move',state==='move'?1:0,3,dt);
        ease(st,'alert',state==='alert'?1:0,11,dt);
        core.position.y=2.0+Math.sin(t*1.6)*.08;
        core.rotation.y+=dt*(.15+st.move*.4);
        ringA.rotation.y-=dt*(.6+st.alert*6);
        ringB.rotation.z+=dt*(.8+st.alert*7);
        pc.rotation.y+=dt*1.5; pc.rotation.x+=dt*.7;
        pc.material.emissiveIntensity=1.4+Math.sin(t*3)*.5+st.alert*2;
        limbs.forEach((L,i)=>{ L.L.rotation.y+=dt*(.5+st.alert*4);
          L.L.scale.setScalar(1-st.alert*.25+Math.sin(t*4+i)*.03); });
        const hostile=st.alert>.5;
        eyeJ.rotation.y=(1-st.alert)*Math.sin(t*.7)*.6;
        eye.material.color.setHex(hostile?0xff4a2a:0x6fe3ff);
        eye.material.emissive.setHex(hostile?0xff4a2a:0x6fe3ff);
        eye.material.emissiveIntensity=1.8+Math.sin(t*(hostile?13:3))*.7;
        eyeLight.color.setHex(hostile?0xff4a2a:0x6fe3ff); eyeLight.intensity=1.4+st.alert*3;
        muzzle.material.emissiveIntensity=1.4+st.alert*(2.5+Math.sin(t*16)*2);
        muzzle.scale.setScalar(1+st.alert*Math.abs(Math.sin(t*8))*.5);
      }};
  }

  // ---- 10. CURATOR — The Ancients — holographic NPC ----
  function buildCurator(){
    const holo=c=>new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:.55});
    const bodyM=holo(0x6fe3ff), robeM=holo(0x3aa8c4), goldM=holo(0xe8b33b), eyeM=holo(0xffffff);
    const g=new THREE.Group(); const core=new THREE.Group(); core.position.y=1.0; g.add(core);
    let y=0;
    [[.5,.4],[.44,.32],[.34,.3],[.22,.26],[.12,.22],[.05,.18]].forEach(a=>{
      const b=pbox(a[0],a[1],a[0]*.8,robeM); b.position.y=y-a[1]/2; b.userData.noOutline=true; core.add(b);
      y-=a[1]*.86; });
    const torso=pbox(.46,.4,.34,bodyM); torso.position.y=.3; torso.userData.noOutline=true; core.add(torso);
    const collar=pbox(.5,.08,.38,goldM); collar.position.y=.5; collar.userData.noOutline=true; core.add(collar);
    const neck=new THREE.Group(); neck.position.y=.56; core.add(neck);
    const head=pbox(.3,.46,.3,bodyM); head.position.y=.26; head.userData.noOutline=true; neck.add(head);
    const crown=pbox(.36,.1,.36,goldM); crown.position.y=.52; crown.userData.noOutline=true; neck.add(crown);
    const halo=new THREE.Group(); halo.position.y=.6; neck.add(halo);
    for(let i=0;i<12;i++){ const a=i/12*Math.PI*2; const p=pbox(.05,.05,.05,goldM);
      p.position.set(Math.cos(a)*.32,0,Math.sin(a)*.32); p.userData.noOutline=true; halo.add(p); }
    [-1,1].forEach(s=>{ const e=pbox(.05,.1,.04,eyeM); e.position.set(s*.08,.28,.16);
      e.userData.noOutline=true; neck.add(e); });
    const arms=[];
    [-1,1].forEach(s=>{ const sh=new THREE.Group(); sh.position.set(s*.26,.42,0); core.add(sh);
      const up=pbox(.1,.28,.1,robeM); up.position.y=-.14; up.userData.noOutline=true; sh.add(up);
      const el=new THREE.Group(); el.position.y=-.28; sh.add(el);
      const lo=pbox(.08,.24,.08,bodyM); lo.position.y=-.12; lo.userData.noOutline=true; el.add(lo);
      const hand=pbox(.1,.1,.06,goldM); hand.position.y=-.26; hand.userData.noOutline=true; el.add(hand);
      arms.push({sh,el,s}); });
    const st={move:0,alert:0,glitch:0};
    const allMats=[]; g.traverse(o=>{ if(o.material&&o.material.transparent) allMats.push(o.material); });
    return {group:g, st,
      anim(t,state,dt){
        ease(st,'move',state==='move'?1:0,4,dt);
        ease(st,'alert',state==='alert'?1:0,9,dt);
        core.position.y=1.0+Math.sin(t*1.4)*.06;
        core.rotation.y=Math.sin(t*.4)*.2*(1-st.move);
        neck.rotation.x=Math.sin(t*.9)*.06 - st.alert*.15;
        neck.rotation.z=Math.sin(t*.6)*.05;
        halo.rotation.y+=dt*(.4+st.alert*2);
        arms.forEach(a=>{ a.sh.rotation.z=a.s*(.5+Math.sin(t*1.2+a.s)*.25)+a.s*st.alert*.5;
          a.sh.rotation.x=-.2-st.alert*.6+Math.sin(t*1.1)*.1;
          a.el.rotation.x=-.6-Math.sin(t*1.2)*.2; });
        const base=.5+Math.sin(t*8)*.05;
        let op=base;
        if((t*60|0)%67===0) st.glitch=.08;
        if(st.glitch>0){ st.glitch-=dt; op=.2+(t*53%1)*.4; core.position.x=((t*97%1)-.5)*.06; }
        else core.position.x=0;
        allMats.forEach(m=>m.opacity=op*(m.color.getHex()===0xffffff?1.3:1));
      }};
  }

  // ---- 11. DUSTWURM — Enemies — boss burrower ----
  function buildDustwurm(){
    const segM=std(0x7a5a3a,{rough:.9}), plateM=std(0x9a7a4a),
          throat=std(0xff7a3a,{emissive:0xe0500a,ei:1.2}), toothM=std(0xe8dcc0);
    const g=new THREE.Group();
    const chainRoot=new THREE.Group(); chainRoot.position.y=1.0; g.add(chainRoot);
    const segs=[]; let parent=chainRoot;
    const N=11;
    for(let i=0;i<N;i++){ const seg=new THREE.Group(); seg.position.z=i===0?0:.46; parent.add(seg);
      const w=.7-i*.045;
      const ring=pbox(w,w,.4,segM); seg.add(ring);
      const plate=pbox(w*.6,w*1.05,.2,plateM); plate.position.y=.02; seg.add(plate);
      if(i>0 && i<N-1){ const sp=pbox(.06,w*.7,.1,plateM); sp.position.y=w*.6; sp.rotation.x=-.3; seg.add(sp); }
      segs.push({seg,w}); parent=seg; }
    const head=new THREE.Group(); head.position.z=.3; chainRoot.add(head);
    const skull=pbox(.78,.78,.4,segM); head.add(skull);
    const mouth=pbox(.4,.4,.2,throat); mouth.position.z=.28; mouth.userData.noOutline=true; head.add(mouth);
    const mand=[];
    for(let i=0;i<6;i++){ const a=i/6*Math.PI*2; const m=new THREE.Group(); m.rotation.z=a; head.add(m);
      const j=pbox(.1,.34,.16,plateM); j.position.set(0,.42,.26); j.rotation.x=.4; m.add(j);
      const tip=pbox(.08,.16,.1,toothM); tip.position.set(0,.6,.34); tip.rotation.x=.6; m.add(tip);
      mand.push(m); }
    eyePair(head,0xffd23a,.26,.1,.18,.07,.07);
    addOutlines(g);
    const st={move:0,alert:0,rear:0};
    return {group:g, st,
      anim(t,state,dt){
        ease(st,'move',state==='move'?1:0,4,dt);
        ease(st,'alert',state==='alert'?1:0,7,dt);
        ease(st,'rear',state==='alert'?1:0,5,dt);
        const rate=2.2+st.move*2;
        segs.forEach((S,i)=>{
          S.seg.rotation.y=Math.sin(t*rate - i*.55)*(.18+st.move*.12);
          S.seg.rotation.x=Math.sin(t*rate*.8 - i*.5)*.08 + (i<4? -st.rear*.32 : st.rear*.05);
        });
        chainRoot.rotation.x=-st.rear*.5;
        chainRoot.position.y=1.0+st.rear*.3+Math.sin(t*rate)*.05;
        const gn=state==='alert'? (Math.sin(t*8)*.5+.5):.0;
        mand.forEach((m,i)=>{ m.children[0].rotation.x=.4+Math.sin(t*3+i)*.1+gn*.5;
          m.children[1].rotation.x=.6+gn*.7; });
        head.children[1].material.emissiveIntensity=1.2+gn*1.5+Math.sin(t*4)*.3;
        if(Math.sin(t*61)>.5){ const p=worldOf(chainRoot,(Math.sin(t*23))*1.5,-.5,(Math.cos(t*19))*2);
          spark(p,0xbfa173,new THREE.Vector3((Math.sin(t*7)-.0)*.5,.4,(Math.cos(t*5))*.5),1.1,.1); }
      }};
  }

  // ---- 12. RAZORPEDE — Enemies — fast cave predator ----
  function buildRazorpede(){
    const plateM=std(0x2a3848,{metal:.3,rough:.5}), plate2=std(0x46586a,{metal:.3}),
          legM=std(0x18222e), pincerM=std(0x6a7888,{metal:.4});
    const g=new THREE.Group();
    const root=new THREE.Group(); root.position.y=.5; g.add(root);
    const head=new THREE.Group(); root.add(head);
    const skull=pbox(.42,.3,.42,plateM); head.add(skull);
    const pincers=[];
    [-1,1].forEach(s=>{ const pj=new THREE.Group(); pj.position.set(s*.18,0,.22); head.add(pj);
      const p=pbox(.08,.1,.34,pincerM); p.position.z=.16; p.rotation.y=-s*.25; pj.add(p);
      const tip=pbox(.06,.08,.14,pincerM); tip.position.set(-s*.04,0,.36); tip.rotation.y=s*.5; pj.add(tip);
      pincers.push({pj,s}); });
    const eM=new THREE.MeshBasicMaterial({color:0xff4a3a});
    [-1,1].forEach(s=>{ const e=pbox(.08,.08,.04,eM); e.userData.noOutline=true;
      e.position.set(s*.12,.1,.2); head.add(e); });
    const segs=[]; let parent=head; const N=12;
    for(let i=0;i<N;i++){ const seg=new THREE.Group(); seg.position.z=-.28; parent.add(seg);
      const w=.4-i*.012;
      const ring=pbox(w,.22,.28,plateM); seg.add(ring);
      const back=pbox(w*.7,.1,.24,plate2); back.position.y=.13; seg.add(back);
      const legs=[];
      [-1,1].forEach(s=>{ const leg=new THREE.Group(); leg.position.set(s*w*.5,-.05,0); seg.add(leg);
        const l1=pbox(.04,.04,.22,legM); l1.rotation.z=s*.7; l1.position.x=s*.1; leg.add(l1);
        const l2=pbox(.035,.035,.18,legM); l2.position.set(s*.22,-.08,0); l2.rotation.z=s*.3; leg.add(l2);
        legs.push({leg,s}); });
      segs.push({seg,legs,i}); parent=seg; }
    const tail=pbox(.1,.1,.3,pincerM); tail.position.z=-.2; parent.add(tail);
    addOutlines(g);
    const st={move:0,alert:0};
    return {group:g, st,
      anim(t,state,dt){
        ease(st,'move',state==='move'?1:0,6,dt);
        ease(st,'alert',state==='alert'?1:0,12,dt);
        const rate=4+st.move*6+st.alert*4;
        segs.forEach((S,i)=>{ S.seg.rotation.y=Math.sin(t*rate - i*.6)*(.12+st.move*.1+st.alert*.15);
          S.legs.forEach(L=>{ const ph=Math.sin(t*rate*1.4 - i*.9); L.leg.rotation.x=ph*.6; });
        });
        head.rotation.y=Math.sin(t*rate*.5)*.1;
        const snap=state==='alert'?(Math.sin(t*10)*.5+.5):Math.abs(Math.sin(t*1.5))*.15;
        pincers.forEach(p=>p.pj.rotation.y=-p.s*snap*.6);
        root.position.y=.5+Math.sin(t*rate*.5)*.02;
      }};
  }

  /* =========================================================
     DEFS — the content registry the voxel world reads.

     on[]   : surface voxel block ids this creature spawns on
              (1 grass, 4 sand, 12/13 alien grass, 15 grass var,
               20 snow, 8 ice, 36 fungal — see BlockRegistry)
     spawn  : auto-spawns as ambient wildlife now (peaceful only)
     temp   : Passive | Neutral | Hostile | Friendly
     threat : None | Low | High | BOSS
     sci    : educational scanner card (English reading practice;
              Danish name is in voxelworld's BLOCK_DA map)
     ========================================================= */
  const DEFS = [
    // ===== THE LIVING — peaceful biome wildlife (spawning now) =====
    { id:'mosshorn', name:'Mosshorn', faction:'living', biome:'Verdant', temp:'Passive', threat:'None',
      build:buildMosshorn, on:[1,12,13,15], scale:0.62, fly:false, glow:false, shy:false, spawn:true, scanOn:1,
      cat:'Creature', desc:'A docile six-legged grazer whose broad back grows a carpet of living moss. Whole herds crop the meadow.',
      sci:{ formula:'herbivore', kingdom:'Animal', fact:'Plants like moss make their own food from sunlight. Animals that eat only plants are called herbivores.' } },
    { id:'frostmane', name:'Frostmane', faction:'living', biome:'Frostpeak', temp:'Neutral', threat:'Low',
      build:buildFrostmane, on:[20,8], scale:0.68, fly:false, glow:false, shy:false, spawn:true, scanOn:20,
      cat:'Creature', desc:'A shaggy, calm grazer wrapped in thick fur. Its warm breath fogs the cold air.',
      sci:{ formula:'insulation', kingdom:'Animal', fact:'Fur traps a layer of air next to the skin. Still air is a great blanket, so the animal stays warm in the snow.' } },
    { id:'driftjelly', name:'Driftjelly', faction:'living', biome:'Aquaria', temp:'Passive', threat:'None',
      build:buildDriftjelly, on:[1,4,12,13,20], scale:0.6, fly:true, glow:true, shy:false, spawn:true, scanOn:40, flyLow:true,
      cat:'Creature', desc:'A see-through bell that drifts on the breeze, glowing softly from inside. The best natural lantern around.',
      sci:{ formula:'bioluminescence', kingdom:'Animal', fact:'Some animals make their own cold light by mixing chemicals inside their body. This is called bioluminescence.' } },
    { id:'sporeling', name:'Sporeling', faction:'living', biome:'Mycelia', temp:'Neutral', threat:'Low',
      build:buildSporeling, on:[36,12,13], scale:0.7, fly:false, glow:false, shy:false, spawn:true, scanOn:36,
      cat:'Creature', desc:'A capped fungal sprite, more mushroom than animal. It hops between glowing patches and puffs spores.',
      sci:{ formula:'spores', kingdom:'Fungi', fact:'Mushrooms are fungi, not plants. They spread by releasing tiny spores that float on the air to grow somewhere new.' } },
    { id:'skate', name:'Skate', faction:'living', biome:'Aquaria', temp:'Passive', threat:'None',
      build:buildSkate, on:[1,4,12,13,20,36], scale:0.7, fly:true, glow:false, shy:false, spawn:true, scanOn:1,
      cat:'Creature', desc:'A broad-winged glider that soars the open sky, banking slowly as it sieves the air for food.',
      sci:{ formula:'lift', kingdom:'Animal', fact:'A wing is curved on top. Air moves faster over the curve, which lowers the pressure there and pushes the wing up. That push is lift.' } },
    { id:'glowmoth', name:'Glowmoth', faction:'living', biome:'Mycelia', temp:'Passive', threat:'None',
      build:buildGlowmoth, on:[1,12,13,36], scale:0.7, fly:true, glow:true, shy:false, spawn:true, scanOn:36, flyLow:true,
      cat:'Creature', desc:'A soft lantern flyer drawn to glowing flora. Its four wings shimmer as it flutters from light to light.',
      sci:{ formula:'pollination', kingdom:'Animal', fact:'Night flyers like moths carry pollen between flowers as they feed. Moving pollen helps new plants grow — that is pollination.' } },

    // ===== THE ANCIENTS — precursor constructs & NPC (gated) =====
    { id:'sentinel', name:'Sentinel', faction:'ancient', biome:'Dustfall', temp:'Hostile', threat:'High',
      build:buildSentinel, on:[6,7], scale:0.8, fly:true, glow:true, shy:false, spawn:false, scanOn:6, flyLow:true,
      cat:'Construct', desc:'A hovering amber automaton that still guards the ruins, eye sweeping for intruders long after its makers went quiet.',
      sci:{ formula:'machine', kingdom:'Construct', fact:'A machine does a job on its own using stored energy. This one was built so long ago that nobody is left to switch it off.' } },
    { id:'curator', name:'Curator', faction:'ancient', biome:'Ruins', temp:'Friendly', threat:'None',
      build:buildCurator, on:[], scale:0.85, fly:false, glow:true, shy:false, spawn:false, scanOn:6,
      cat:'NPC', desc:'A flickering projection of one of the Ancients. Not quite alive, not quite a recording. It seems glad to be asked.',
      sci:{ formula:'hologram', kingdom:'Projection', fact:'A hologram is a picture made of light that looks solid from every side. You can walk around it, but your hand passes right through.' } },
    { id:'warden', name:'Warden', faction:'ancient', biome:'Ruins', temp:'Hostile', threat:'BOSS',
      build:buildWarden, on:[6,7], scale:1.1, fly:true, glow:true, shy:false, spawn:false, scanOn:6, flyLow:true,
      cat:'Boss', desc:'A vault-keeper construct the size of a building, twin rings of shards orbiting a living power core.',
      sci:{ formula:'guardian', kingdom:'Construct', fact:'The biggest machines need the most energy. This one keeps a glowing power core spinning at its heart to run its giant rings.' } },

    // ===== ENEMIES — dangerous wildlife & apex bosses (gated) =====
    { id:'cinderhound', name:'Cinderhound', faction:'living', biome:'Ember', temp:'Hostile', threat:'High',
      build:buildCinderhound, on:[42,9], scale:0.72, fly:false, glow:true, shy:false, spawn:false, scanOn:9,
      cat:'Creature', desc:'A lean predator with obsidian hide veined by cooling lava. It runs down anything warm.',
      sci:{ formula:'predator', kingdom:'Animal', fact:'A predator is an animal that hunts other animals for food. The glowing cracks are this one’s own body heat leaking out.' } },
    { id:'razorpede', name:'Razorpede', faction:'living', biome:'Caves', temp:'Hostile', threat:'High',
      build:buildRazorpede, on:[3,2], scale:0.7, fly:false, glow:false, shy:false, spawn:false, scanOn:3,
      cat:'Creature', desc:'An armored cave centipede the length of a corridor. Dozens of legs drive it faster than you can run.',
      sci:{ formula:'exoskeleton', kingdom:'Animal', fact:'Bugs wear their skeleton on the outside, like a suit of armor. It is called an exoskeleton and it protects the soft body inside.' } },
    { id:'dustwurm', name:'Dustwurm', faction:'living', biome:'Dustfall', temp:'Hostile', threat:'BOSS',
      build:buildDustwurm, on:[6,5], scale:1.0, fly:false, glow:false, shy:false, spawn:false, scanOn:6,
      cat:'Boss', desc:'A segmented colossus that swims through loose rock and breaches to swallow anything on the surface whole.',
      sci:{ formula:'burrower', kingdom:'Animal', fact:'A burrower digs and moves through the ground. Its long body is split into segments so it can bend and push through the rock.' } }
  ];

  const _byId={}; DEFS.forEach(d=>_byId[d.id]=d);
  function get(id){ return _byId[id]; }
  function build(id){ const d=_byId[id]; return d ? d.build() : null; }

  window.AsteroidCreatures = {
    DEFS, get, build,
    setScene, spark, stepFx, clearFx,
    // expose builder helpers in case other systems want the kit
    _helpers:{ std, pbox, eyePair, addOutlines, ease, shade, worldOf }
  };
})();
