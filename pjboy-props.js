/* =====================================================================
   pjboy-props.js  :  Totems & loop props for Three.js (r128)
   Batch 1 (loop & hearth):  Hush-shard · Beacon · Echo mote · Hearth Lantern
   Totems (one per world):   Greenheart · Tideshell · Gilllight · Threetail · Wayfinder · Emberkin

   Contract matches pjboy-cast.js / pjboy-bosses.js:
     const kit  = createPropKit(THREE, scene);
     kit.setCamera(camera);                 // optional; no prop tracks the camera
     const prop = kit.spawn('tideshell');   // builds + adds prop.group to scene
     prop.anim(t, state, dt);
     kit.step(dt);                          // advances spark fx

   spawn(id) -> { group, anim(t,state,dt), meta:{name,role,lore}, accent, airborne?, states }

   STATES  (state 'idle' rests; any other string drives the lit/woken pose)
     hushshard   idle · waking · cleared
     beacon      idle/unlit · lit
     echomote    idle · scanned         (airborne)
     hearth      idle/guttering · kindled
     the 6 Totems  idle/carried · planted   (planted = roots spread + light up + flourish)

   NOTES
     - Echo mote is airborne:true (floats); ground the others yourself by bbox.
     - All six Totems share one base footprint (totemBase) so they read as a set.
     - FX self-contained: call kit.step(dt) each frame.
   ===================================================================== */
function createPropKit(THREE, scene){
  let camera=null;

const hx=n=>'#'+(n>>>0).toString(16).padStart(6,'0');
function std(color,o={}){ return new THREE.MeshStandardMaterial({
  color, roughness:o.rough??.82, metalness:o.metal??.1,
  emissive:o.emissive??0x000000, emissiveIntensity:o.ei??1,
  transparent:o.transparent||false, opacity:o.opacity??1 }); }
function pbox(w,h,d,mat){ return new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat); }
const OUTLINE=new THREE.MeshBasicMaterial({color:0x05060c,side:THREE.BackSide});
function addOutlines(root){ const t=[];
  root.traverse(o=>{ if(o.isMesh&&o.geometry.type==='BoxGeometry'&&!o.userData.isOutline
    &&!o.userData.noOutline&&!(o.material&&o.material.isMeshBasicMaterial)) t.push(o); });
  t.forEach(m=>{ const o=new THREE.Mesh(m.geometry,OUTLINE); o.scale.setScalar(1.06); o.userData.isOutline=true; m.add(o); }); }
const ease=(o,k,target,rate,dt)=> o[k]=(o[k]||0)+(target-(o[k]||0))*(1-Math.exp(-rate*dt));
const _v=new THREE.Vector3();
const worldOf=(obj,x,y,z)=> obj.localToWorld(_v.set(x,y,z)).clone();

// ---- shared spark fx ----
const fx=[];
function spark(pos,color,vel,life,size,grav){ const m=new THREE.Mesh(new THREE.BoxGeometry(size,size,size),
  new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95})); m.position.copy(pos); scene.add(m);
  fx.push({m,vel:vel.clone(),t:0,life,g:grav??7}); }
function stepFx(dt){ for(let i=fx.length-1;i>=0;i--){ const p=fx[i]; p.t+=dt;
  if(p.t>=p.life){ scene.remove(p.m); fx.splice(i,1); continue; }
  p.vel.y-=p.g*dt; p.m.position.addScaledVector(p.vel,dt);
  const k=1-p.t/p.life; p.m.material.opacity=k*.95; p.m.scale.setScalar(k); } }


/* ========================= BUILDERS ========================= */

// 1. HUSH-SHARD — cleanse target. idle dim pulse · waking brighten/shiver · cleared burst + fade
function buildHushShard(){
  const rock=std(0x14121c,{rough:.96}), rockD=std(0x0e0c16,{rough:.97}),
        shardM=std(0x2a1a44,{emissive:0x6a2aff,ei:1.0}), edgeM=std(0xb14aff,{emissive:0x8a2aff,ei:1.6}),
        veinM=std(0x5a2acc,{emissive:0x7a2aff,ei:1.2}), moteM=std(0x1a1030,{emissive:0x6a2aff,ei:.8});
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  // cracked base + rubble ring
  const base=pbox(1.3,.28,1.3,rock); base.position.y=.14; root.add(base);
  for(let i=0;i<8;i++){ const a=i/8*Math.PI*2, r=.85+Math.random()*.35; const rb=pbox(.2+Math.random()*.2,.16,.2+Math.random()*.2,i%2?rock:rockD);
    rb.position.set(Math.cos(a)*r,.1,Math.sin(a)*r); rb.rotation.y=a; root.add(rb); }
  // creeping veins on the ground
  const veins=[]; for(let i=0;i<6;i++){ const a=i/6*Math.PI*2; const v=pbox(.07,.05,.6+Math.random()*.3,veinM);
    v.position.set(Math.cos(a)*.4,.27,Math.sin(a)*.4); v.rotation.y=a; v.userData.noOutline=true; root.add(v); veins.push(v); }
  // crystal cluster (bigger, more shards)
  const cluster=[
    {x:0,z:0,h:1.05,t:[.1,0,.05]},{x:-.34,z:.16,h:.82,t:[.2,.5,.1]},{x:.4,z:-.08,h:.74,t:[-.18,-.3,.12]},
    {x:.14,z:.44,h:.62,t:[.12,.2,-.2]},{x:-.32,z:-.34,h:.7,t:[-.22,.7,.15]},{x:.08,z:-.46,h:.54,t:[.16,-.6,-.1]},
    {x:.5,z:.28,h:.46,t:[-.1,.3,-.18]},{x:-.5,z:.1,h:.5,t:[.18,-.4,.2]},
  ];
  const shards=[];
  cluster.forEach((c,i)=>{ const j=new THREE.Group(); j.position.set(c.x,.25,c.z); j.rotation.set(c.t[0],c.t[1],c.t[2]); root.add(j);
    const w=.26-i*.012; const sh=pbox(w,c.h,w,shardM); sh.position.y=c.h*.5; j.add(sh);
    const tip=pbox(w*.62,c.h*.34,w*.62,edgeM); tip.position.y=c.h*.86; tip.userData.noOutline=true; j.add(tip);
    shards.push({j,sh,tip,base:c.t,baseY:.25}); });
  // dark motes that orbit/rise slowly
  const motes=[]; for(let i=0;i<5;i++){ const m=pbox(.12,.12,.12,moteM); m.userData.noOutline=true; root.add(m);
    motes.push({m,a:i/5*Math.PI*2,r:.7+Math.random()*.3,y:.6+Math.random()*.7,sp:.3+Math.random()*.4}); }
  const light=new THREE.PointLight(0x7a2aff,.8,5); light.position.y=.8; root.add(light);
  addOutlines(g);
  const st={act:0,clear:0,fired:false};
  return {group:g, scale:1, accent:0xb14aff,
    meta:{name:'Hush-shard', role:'Cleanse target', lore:"Where it roots, the song goes out. Mine it, and the quiet lets go."},
    anim(t,state,dt){
      const cleared=state==='cleared', waking=state==='waking';
      ease(st,'act', waking?1:0, 6, dt);
      ease(st,'clear', cleared?1:0, 5, dt);
      if(cleared){ if(!st.fired){ st.fired=true; for(let i=0;i<26;i++) spark(worldOf(root,(Math.random()-.5)*.9,.5+Math.random()*.7,(Math.random()-.5)*.9),
        Math.random()<.5?0xb14aff:0xffffff, new THREE.Vector3((Math.random()-.5)*3.4,Math.random()*3.4+1,(Math.random()-.5)*3.4),1.3,.12,6); } }
      else st.fired=false;
      const pulse=.5+Math.sin(t*1.6)*.5;
      const shiver=st.act*Math.sin(t*22)*.05;
      const sc=Math.max(0,1-st.clear);
      shards.forEach((s,i)=>{ s.tip.material.emissiveIntensity=1.2+pulse*.4+st.act*2.4;
        s.sh.scale.setScalar(sc); s.tip.scale.setScalar(sc);
        s.j.position.y=s.baseY - st.clear*.45;
        s.j.rotation.set(s.base[0], s.base[1], s.base[2]+(i%2?1:-1)*shiver); });
      veins.forEach((v,i)=>{ v.material.emissiveIntensity=(.8+pulse*.5+st.act*1.6)*sc; v.scale.z=sc*(1+st.act*.1); });
      motes.forEach((o,i)=>{ const a=o.a + t*o.sp*(1+st.act); const r=o.r*(1+st.act*.4)*sc;
        o.m.position.set(Math.cos(a)*r, (o.y + Math.sin(t*.8+i)*.2)*sc, Math.sin(a)*r);
        o.m.scale.setScalar(sc); o.m.material.emissiveIntensity=.6+pulse*.4+st.act*1.4; });
      light.intensity=(.6+pulse*.3+st.act*2.2)*sc; light.position.y=.8*sc;
    }};
}

// 2. BEACON — light-phase structure. idle/unlit dark stub · lit flame column
function buildBeacon(){
  const stone=std(0x6a6a72,{rough:.9}), stoneD=std(0x4a4a52,{rough:.9}), stoneL=std(0x82828c,{rough:.85}),
        trim=std(0xe8b33b,{emissive:0x6a4a10,ei:.3}), rune=std(0x6fe3ff,{emissive:0x2a8aa0,ei:.6}),
        glass=std(0xbfe8ff,{transparent:true,opacity:.3}), flameM=std(0xffb24a,{emissive:0xff7a10,ei:2}),
        emberM=std(0xff6a2a,{emissive:0xff4a00,ei:1.4}), ringM=std(0xffb24a,{emissive:0xff8a20,ei:1.4,transparent:true,opacity:.0,side:THREE.DoubleSide});
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  // stepped plinth + corner studs
  const p0=pbox(1.3,.28,1.3,stoneD); p0.position.y=.14; root.add(p0);
  const p1=pbox(1.0,.26,1.0,stone); p1.position.y=.4; root.add(p1);
  [[-.5,-.5],[.5,-.5],[-.5,.5],[.5,.5]].forEach(([x,z])=>{ const s=pbox(.16,.16,.16,stoneL); s.position.set(x,.2,z); root.add(s); });
  // column with rune insets
  const col=pbox(.6,1.05,.6,stone); col.position.y=1.05; root.add(col);
  const runes=[]; [0,1,2,3].forEach(i=>{ const a=i/4*Math.PI*2; const rn=pbox(.12,.4,.04,rune);
    rn.position.set(Math.cos(a)*.31,1.05,Math.sin(a)*.31); rn.rotation.y=-a; rn.userData.noOutline=true; root.add(rn); runes.push(rn); });
  const band=pbox(.7,.12,.7,trim); band.position.y=1.62; root.add(band);
  // glass cage + cross brace
  const topY=2.05;
  for(let i=0;i<4;i++){ const a=i/4*Math.PI*2; const bar=pbox(.07,.66,.07,stoneD); bar.position.set(Math.cos(a)*.3,topY,Math.sin(a)*.3); root.add(bar); }
  const braceA=pbox(.62,.05,.05,stoneD); braceA.position.set(0,topY+.34,0); root.add(braceA);
  const braceB=pbox(.05,.05,.62,stoneD); braceB.position.set(0,topY+.34,0); root.add(braceB);
  const cap=pbox(.6,.14,.6,stone); cap.position.y=topY+.44; root.add(cap);
  const finial=pbox(.16,.22,.16,trim); finial.position.y=topY+.62; root.add(finial);
  const glassBox=pbox(.48,.6,.48,glass); glassBox.position.y=topY; glassBox.userData.noOutline=true; root.add(glassBox);
  const embers=pbox(.34,.12,.34,emberM); embers.position.y=topY-.32; embers.userData.noOutline=true; root.add(embers);
  const flame=pbox(.26,.5,.26,flameM); flame.position.y=topY-.05; flame.userData.noOutline=true; root.add(flame);
  const glowRing=pbox(1.5,.02,1.5,ringM); glowRing.position.y=.02; glowRing.userData.noOutline=true; root.add(glowRing);
  const light=new THREE.PointLight(0xffb24a,0,9); light.position.y=topY; root.add(light);
  addOutlines(g);
  const st={act:0};
  return {group:g, scale:1, accent:0xffb24a,
    meta:{name:'Beacon', role:'Light structure', lore:"Build it, light it, and the world remembers it is not alone."},
    anim(t,state,dt){
      const on = state!=='idle' && state!=='unlit';
      ease(st,'act', on?1:0, 5, dt);
      const flick=.85+Math.sin(t*12)*.1+Math.sin(t*27)*.05;
      flame.scale.set((.6+.4*flick)*st.act, st.act*(1+.15*Math.sin(t*9)), (.6+.4*flick)*st.act);
      flame.material.emissiveIntensity=2.4*st.act*flick;
      flame.position.y=topY-.05+st.act*.06;
      embers.material.emissiveIntensity=.6+st.act*1.6*flick; embers.scale.setScalar(.7+st.act*.4);
      runes.forEach(r=>r.material.emissiveIntensity=.3+st.act*1.6);
      glowRing.material.opacity=st.act*.28*flick; glowRing.scale.setScalar(1+st.act*.15);
      light.intensity=st.act*3.4*flick;
      col.material.emissive.setRGB(st.act*.16, st.act*.08, 0);
      if(on && st.act>.6 && Math.random()<.18) spark(worldOf(root,(Math.random()-.5)*.3,topY+.2,(Math.random()-.5)*.3),0xffb24a,
        new THREE.Vector3((Math.random()-.5)*.4,.7+Math.random()*.6,(Math.random()-.5)*.4),1.1,.06,1.2);
    }};
}

// 3. ECHO MOTE — story pickup (airborne). idle float/shimmer · scanned flash, rise, fade
function buildEchoMote(){
  const coreM=std(0x6fe3ff,{emissive:0x2adfff,ei:2.2}),
        midM=std(0x6fe3ff,{transparent:true,opacity:.3,emissive:0x2adfff,ei:1}),
        shellM=std(0x6fe3ff,{transparent:true,opacity:.14,emissive:0x2adfff,ei:.5}),
        glyphM=std(0x9af0ff,{emissive:0x4adfff,ei:1.6});
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const core=pbox(.24,.24,.24,coreM); core.userData.noOutline=true; root.add(core);
  const mid=pbox(.38,.38,.38,midM); mid.userData.noOutline=true; root.add(mid);
  const shell=pbox(.52,.52,.52,shellM); shell.userData.noOutline=true; root.add(shell);
  // rotating glyph ring
  const ring=new THREE.Group(); root.add(ring);
  const glyphs=[]; for(let i=0;i<8;i++){ const a=i/8*Math.PI*2; const gl=pbox(.08,.08,.04,glyphM);
    gl.position.set(Math.cos(a)*.5,0,Math.sin(a)*.5); gl.rotation.y=-a; gl.userData.noOutline=true; ring.add(gl); glyphs.push(gl); }
  const flecks=[]; for(let i=0;i<6;i++){ const f=pbox(.06,.06,.06,coreM); f.userData.noOutline=true; root.add(f); flecks.push({f,a:i/6*Math.PI*2,r:.4}); }
  const light=new THREE.PointLight(0x6fe3ff,1.0,5); root.add(light);
  addOutlines(g);
  const baseY=1.4;
  const st={act:0,fired:false,idleSpark:0};
  return {group:g, scale:1, accent:0x6fe3ff, airborne:true,
    meta:{name:'Echo mote', role:'Story pickup', lore:"A memory the Ancients could not carry with them. Scan it, and it tells you a little."},
    anim(t,state,dt){
      const scanned=state!=='idle';
      ease(st,'act', scanned?1:0, 7, dt);
      const fade=Math.max(0,1-st.act);
      root.position.y = baseY + Math.sin(t*1.5)*.12 + st.act*st.act*3.0;
      core.rotation.y+=dt*1.2; core.rotation.x+=dt*.8; mid.rotation.y-=dt*.9; shell.rotation.y+=dt*.4;
      ring.rotation.y+=dt*(.8+st.act*4); ring.rotation.x=Math.sin(t*.6)*.3;
      core.material.emissiveIntensity=2.0+Math.sin(t*5)*.5+st.act*5;
      core.scale.setScalar(fade*(1+st.act*.6)); mid.scale.setScalar(fade); shell.scale.setScalar(fade);
      mid.material.opacity=.3*fade; shell.material.opacity=.14*fade;
      glyphs.forEach((gl,i)=>{ gl.material.emissiveIntensity=1.2+Math.sin(t*4+i*.8)*.6+st.act*3;
        gl.scale.setScalar(fade); const rr=.5*(1+st.act*1.2); gl.position.x=Math.cos(i/8*Math.PI*2)*rr; gl.position.z=Math.sin(i/8*Math.PI*2)*rr; });
      flecks.forEach((o,i)=>{ const a=o.a+t*1.0, r=o.r*(1+st.act); o.f.position.set(Math.cos(a)*r,Math.sin(t*2+i)*.1,Math.sin(a)*r); o.f.scale.setScalar(fade); });
      light.intensity=(1.0+Math.sin(t*5)*.3)*fade + st.act*2;
      st.idleSpark-=dt; if(!scanned && st.idleSpark<=0){ st.idleSpark=.5+Math.random(); spark(worldOf(root,0,0,0),0x6fe3ff,new THREE.Vector3((Math.random()-.5)*.4,.3+Math.random()*.3,(Math.random()-.5)*.4),1.0,.05,-.2); }
      if(scanned && !st.fired){ st.fired=true; for(let i=0;i<16;i++) spark(worldOf(root,0,0,0),0x6fe3ff,new THREE.Vector3((Math.random()-.5)*2.2,Math.random()*1.6+.5,(Math.random()-.5)*2.2),1.0,.08,-.5); }
      if(!scanned) st.fired=false;
    }};
}

// 4. GREENHEART (Totem · Verdant). idle slow pulse (carried) · planted roots/bloom/brighten
function buildGreenheart(){
  const wood=std(0x5a4632), woodD=std(0x46362a), soil=std(0x4a3a2a,{rough:.97}), bark=std(0x6a5238),
        heartM=std(0x6ad055,{emissive:0x2a8a30,ei:1.4}), leafM=std(0x5aa83a), leafD=std(0x3a7a28),
        bloomM=std(0xbaff7a,{emissive:0x4aaa30,ei:1.2}), shroomM=std(0xd86a5a), shroomCap=std(0xe88a6a),
        grassM=std(0x6ad055,{emissive:0x2a6a20,ei:.3});
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const base=pbox(.95,.3,.95,soil); base.position.y=.15; root.add(base);
  for(let i=0;i<4;i++){ const a=i/4*Math.PI*2; const stone=pbox(.18,.14,.18,woodD); stone.position.set(Math.cos(a)*.4,.1,Math.sin(a)*.4); root.add(stone); }
  // gnarled wood knot wrapped in vines
  const knot=new THREE.Group(); knot.position.y=.5; root.add(knot);
  [[0,0,0,.5],[.22,.18,.05,.34],[-.2,.22,-.05,.3],[.05,.34,.12,.3],[-.05,.42,-.1,.26],[.16,.4,-.12,.2]].forEach(([x,y,z,s],i)=>{
    const b=pbox(s,s,s,i%2?wood:bark); b.position.set(x,y,z); b.rotation.set(i*.3,i*.5,i*.2); knot.add(b); });
  // vines wrapping
  for(let i=0;i<3;i++){ const vy=.1+i*.18; const vine=pbox(.5,.08,.08,leafD); vine.position.set(0,vy,.28); vine.rotation.z=(i%2?.2:-.2); knot.add(vine); }
  const heart=pbox(.3,.34,.3,heartM); heart.position.y=.24; heart.userData.noOutline=true; knot.add(heart);
  const heartLight=new THREE.PointLight(0x6ad055,.8,5); heartLight.position.y=.74; root.add(heartLight);
  // leaf clusters on top
  const leaves=[]; for(let i=0;i<5;i++){ const a=i/5*Math.PI*2; const lf=pbox(.26,.1,.34,i%2?leafM:leafD);
    lf.position.set(Math.cos(a)*.28,.92+Math.sin(i)*.06,Math.sin(a)*.28); lf.rotation.y=a; knot.add(lf); leaves.push({lf,i}); }
  // mushrooms at base
  for(let i=0;i<2;i++){ const mx=i?-.36:.34; const stem=pbox(.08,.16,.08,shroomM); stem.position.set(mx,.24,.3); root.add(stem);
    const cap=pbox(.2,.1,.2,shroomCap); cap.position.set(mx,.34,.3); root.add(cap); }
  // roots (spread when planted)
  const roots=[]; for(let i=0;i<6;i++){ const a=i/6*Math.PI*2; const rj=new THREE.Group(); rj.position.y=.08; rj.rotation.y=a; root.add(rj);
    const r=pbox(.16,.14,.7,woodD); r.position.z=.45; rj.add(r); const node=pbox(.18,.12,.18,bark); node.position.z=.78; rj.add(node); roots.push({rj,r,node}); }
  // grass tufts (sprout when planted)
  const grass=[]; for(let i=0;i<8;i++){ const a=i/8*Math.PI*2+.3; const gt=pbox(.05,.3,.05,grassM);
    gt.position.set(Math.cos(a)*.55,.3,Math.sin(a)*.55); root.add(gt); grass.push(gt); }
  // blooms (pop when planted)
  const blooms=[]; for(let i=0;i<6;i++){ const a=i/6*Math.PI*2; const bl=pbox(.18,.18,.18,bloomM);
    bl.position.set(Math.cos(a)*.36,.5+(i%3)*.16,Math.sin(a)*.36); bl.userData.noOutline=true; root.add(bl); blooms.push(bl); }
  addOutlines(g);
  const st={act:0};
  return {group:g, scale:1, accent:0x6ad055,
    meta:{name:'Greenheart', role:'Totem · Verdant', lore:"It was a seed when the Hum was loud. Plant it, and it answers."},
    anim(t,state,dt){
      const planted=state!=='idle';
      ease(st,'act', planted?1:0, 4, dt);
      const pulse=.5+Math.sin(t*1.8)*.5;
      heart.material.emissiveIntensity=1.0+pulse*.6+st.act*2.0;
      heart.scale.setScalar(1+pulse*.06+st.act*.2);
      heartLight.intensity=.5+pulse*.3+st.act*2.4;
      knot.position.y=.5+Math.sin(t*1.4)*.02*(1-st.act);
      knot.rotation.y=Math.sin(t*.5)*.05;
      leaves.forEach(o=>{ o.lf.rotation.z=Math.sin(t*2+o.i)*.12*(.4+st.act); });
      roots.forEach(o=>{ o.r.scale.z=Math.max(.02,st.act); o.r.position.z=.45*st.act; o.node.scale.setScalar(Math.max(.02,st.act)); o.node.position.z=.78*st.act; });
      grass.forEach((gt,i)=>{ gt.scale.y=Math.max(.02,st.act); gt.position.y=.3 - (1-st.act)*.15 + Math.sin(t*3+i)*.02*st.act; });
      blooms.forEach((b,i)=>{ b.scale.setScalar(Math.max(0,st.act)*(1+Math.sin(t*4+i)*.08)); });
      if(planted && st.act>.6 && Math.random()<.12) spark(worldOf(knot,(Math.random()-.5)*.6,.6,(Math.random()-.5)*.6),0xbaff7a,
        new THREE.Vector3((Math.random()-.5)*.4,.4+Math.random()*.4,(Math.random()-.5)*.4),1.6,.05,.6);
    }};
}

// 5. HEARTH LANTERN — hub centerpiece / save point. idle guttering ember · kindled tall flame
function buildHearthLantern(){
  const stone=std(0x3a4a52), stoneD=std(0x2a363c), stoneL=std(0x4a5a64), gold=std(0xe8b33b,{emissive:0x6a4a10,ei:.5}),
        rune=std(0x6fe3ff,{emissive:0x2a8aa0,ei:.7}), bar=std(0x5a6a70,{metal:.3}), chainM=std(0x4a5560,{metal:.4}),
        flameM=std(0xffd24a,{emissive:0xffaa10,ei:2.2}), coalM=std(0xff6a2a,{emissive:0xff4a00,ei:1.6}),
        ringM=std(0xffd24a,{emissive:0xffaa20,ei:1.4,transparent:true,opacity:0,side:THREE.DoubleSide});
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  // pedestal with rune insets
  const ped=pbox(1.5,.5,1.5,stoneD); ped.position.y=.25; root.add(ped);
  const ped2=pbox(1.1,.4,1.1,stone); ped2.position.y=.6; root.add(ped2);
  const runes=[]; [0,1,2,3].forEach(i=>{ const a=i/4*Math.PI*2; const rn=pbox(.34,.16,.04,rune);
    rn.position.set(Math.cos(a)*.76,.4,Math.sin(a)*.76); rn.rotation.y=-a+Math.PI/2; rn.userData.noOutline=true; root.add(rn); runes.push(rn); });
  const trimRing=pbox(1.16,.12,1.16,gold); trimRing.position.y=.82; root.add(trimRing);
  // lantern body: double-ring cage + corner posts
  const baseY=1.7;
  const cageB=pbox(1.1,.18,1.1,bar); cageB.position.y=baseY-.75; root.add(cageB);
  const cageM=pbox(1.0,.1,1.0,gold); cageM.position.y=baseY; root.add(cageM);
  const cageT=pbox(1.1,.18,1.1,bar); cageT.position.y=baseY+.75; root.add(cageT);
  for(let i=0;i<4;i++){ const a=i/4*Math.PI*2+Math.PI/4; const b=pbox(.13,1.5,.13,bar); b.position.set(Math.cos(a)*.5,baseY,Math.sin(a)*.5); root.add(b); }
  // hanging chains from the cage top
  for(let i=0;i<2;i++){ const cx=i?-.5:.5; const ch=pbox(.06,.5,.06,chainM); ch.position.set(cx,baseY+1.0,0); root.add(ch); }
  // coal bed + flame
  const coals=pbox(.6,.16,.6,coalM); coals.position.y=baseY-.62; coals.userData.noOutline=true; root.add(coals);
  const flame=pbox(.5,.8,.5,flameM); flame.position.y=baseY-.1; flame.userData.noOutline=true; root.add(flame);
  const finial=pbox(.24,.34,.24,gold); finial.position.y=baseY+1.0; root.add(finial);
  const fcross=pbox(.5,.08,.08,gold); fcross.position.y=baseY+1.18; root.add(fcross);
  const glowRing=pbox(2.0,.02,2.0,ringM); glowRing.position.y=.02; glowRing.userData.noOutline=true; root.add(glowRing);
  const light=new THREE.PointLight(0xffd24a,1,14); light.position.y=baseY; root.add(light);
  addOutlines(g);
  const st={act:0};
  return {group:g, scale:1, accent:0xffd24a,
    meta:{name:'Hearth Lantern', role:'Hub centerpiece', lore:"The first light, and the last to go out. Kindle it, and you are home."},
    anim(t,state,dt){
      const kindled = state!=='idle' && state!=='guttering';
      ease(st,'act', kindled?1:0, 3, dt);
      const flick=.8+Math.sin(t*7)*.12+Math.sin(t*19)*.06;
      flame.scale.set(.7+.3*flick, (.5+st.act*1.0)*(.9+.15*Math.sin(t*6)), .7+.3*flick);
      flame.material.emissiveIntensity=(1.2+st.act*1.6)*flick;
      flame.material.color.setRGB(1, .55+st.act*.3, .12+st.act*.1);
      flame.position.y=baseY-.1+st.act*.2;
      coals.material.emissiveIntensity=(1.0+st.act*1.2)*flick;
      runes.forEach(r=>r.material.emissiveIntensity=.4+st.act*1.8);
      glowRing.material.opacity=(.06+st.act*.26)*flick; glowRing.scale.setScalar(1+st.act*.15);
      light.intensity=(.5+st.act*3.0)*flick; light.distance=10+st.act*8;
      if(kindled && st.act>.5 && Math.random()<.2) spark(worldOf(root,(Math.random()-.5)*.5,baseY+.3,(Math.random()-.5)*.5),0xffd24a,
        new THREE.Vector3((Math.random()-.5)*.4,.8+Math.random()*.7,(Math.random()-.5)*.4),1.3,.06,1.2);
    }};
}

// ---- shared totem base (matches Greenheart footprint so the set reads consistent) ----
function totemBase(accent, soilCol){
  const soil=std(soilCol||0x4a3a2a,{rough:.97}), woodD=std(0x46362a), bark=std(0x6a5238);
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const base=pbox(.95,.3,.95,soil); base.position.y=.15; root.add(base);
  for(let i=0;i<4;i++){ const a=i/4*Math.PI*2; const s=pbox(.18,.14,.18,woodD); s.position.set(Math.cos(a)*.4,.1,Math.sin(a)*.4); root.add(s); }
  const roots=[]; for(let i=0;i<6;i++){ const a=i/6*Math.PI*2; const rj=new THREE.Group(); rj.position.y=.08; rj.rotation.y=a; root.add(rj);
    const r=pbox(.16,.14,.7,woodD); r.position.z=.45; rj.add(r); const node=pbox(.18,.12,.18,bark); node.position.z=.78; rj.add(node); roots.push({rj,r,node}); }
  const light=new THREE.PointLight(accent,.8,5); light.position.y=.74; root.add(light);
  return {g, root, base, roots, light};
}
function makeGlowRing(hex){ const mat=new THREE.MeshStandardMaterial({color:hex,emissive:hex,emissiveIntensity:1.2,transparent:true,opacity:0,side:THREE.DoubleSide,roughness:.6});
  const m=pbox(1.6,.02,1.6,mat); m.position.y=.03; m.userData.noOutline=true; return m; }
function spreadRoots(roots,act){ roots.forEach(o=>{ o.r.scale.z=Math.max(.02,act); o.r.position.z=.45*act; o.node.scale.setScalar(Math.max(.02,act)); o.node.position.z=.78*act; }); }

// TIDESHELL — Aquaria. spiral shell cradling a tide-light · planted: shell glows, water ripples out
function buildTideshell(){
  const B=totemBase(0x6fe3ff,0x2a3a44);
  const shellM=std(0xd8cdb8), shellD=std(0xb8a890), lipM=std(0xe8e0d0), tideM=std(0x6fe3ff,{emissive:0x2adfff,ei:1.6});
  const post=pbox(.4,.5,.4,shellD); post.position.y=.5; B.root.add(post);
  const shell=new THREE.Group(); shell.position.set(0,.9,0); B.root.add(shell);
  [[.6,.6,0,0],[.5,.5,.18,.6],[.4,.42,.32,1.2],[.3,.34,.4,1.8],[.22,.26,.44,2.4]].forEach(([w,h,zy,ang],i)=>{
    const b=pbox(w,h,w*.7,i%2?shellM:shellD); b.position.set(Math.sin(ang)*.16,zy,Math.cos(ang)*.16); b.rotation.y=ang; shell.add(b); });
  const lip=pbox(.66,.1,.5,lipM); lip.position.set(0,-.05,.2); shell.add(lip);
  const core=pbox(.26,.3,.26,tideM); core.position.set(0,0,.3); core.userData.noOutline=true; shell.add(core);
  const ripple=makeGlowRing(0x6fe3ff); B.root.add(ripple);
  addOutlines(B.g);
  const st={act:0};
  return {group:B.g, scale:1, accent:0x6fe3ff,
    meta:{name:'Tideshell', role:'Totem · Aquaria', lore:"Hold it to your ear. That is the sound of the sea, humming in its sleep."},
    anim(t,state,dt){ const planted=state!=='idle'; ease(st,'act',planted?1:0,4,dt);
      const pulse=.5+Math.sin(t*1.8)*.5;
      core.material.emissiveIntensity=1.0+pulse*.7+st.act*2.2; core.scale.setScalar(1+pulse*.07+st.act*.25);
      B.light.intensity=.5+pulse*.3+st.act*2.4;
      shell.rotation.y=Math.sin(t*.5)*.06; shell.position.y=.9+Math.sin(t*1.4)*.02*(1-st.act);
      spreadRoots(B.roots,st.act);
      ripple.material.opacity=st.act*(.18+.12*Math.sin(t*3)); ripple.scale.setScalar(1+st.act*.3+Math.sin(t*2)*.12*st.act);
      ripple.material.emissiveIntensity=1.0+st.act*1.5;
      if(planted && st.act>.6 && Math.random()<.12) spark(worldOf(shell,(Math.random()-.5)*.5,0,.3),0x9af0ff,new THREE.Vector3((Math.random()-.5)*.4,.5+Math.random()*.5,(Math.random()-.5)*.4),1.4,.05,-.4);
    }};
}

// GILLLIGHT — Mycelia. glowing gill-cap on a pale stem · planted: cap blooms, low glow spreads
function buildGilllight(){
  const B=totemBase(0x7af0c8,0x2a3a30);
  const stemM=std(0xd8e0d0), stemD=std(0xb8c4b4), capM=std(0x4a8a6a), gillM=std(0x7af0c8,{emissive:0x3ad0a0,ei:1.6}), coreM=std(0x7af0c8,{emissive:0x3ad0a0,ei:1.4});
  const stem=pbox(.34,.7,.34,stemM); stem.position.y=.6; B.root.add(stem);
  const ring=pbox(.4,.1,.4,stemD); ring.position.y=.78; B.root.add(ring);
  const cap=new THREE.Group(); cap.position.y=1.0; B.root.add(cap);
  [[.95,.22,0],[.7,.2,.16],[.45,.18,.28]].forEach(([w,h,y])=>{ const c=pbox(w,h,w,capM); c.position.y=y; cap.add(c); });
  const gills=[]; for(let i=0;i<8;i++){ const a=i/8*Math.PI*2; const gl=pbox(.08,.06,.4,gillM); gl.position.set(Math.cos(a)*.28,-.02,Math.sin(a)*.28); gl.rotation.y=-a; gl.userData.noOutline=true; cap.add(gl); gills.push(gl); }
  const core=pbox(.2,.2,.2,coreM); core.position.y=-.06; core.userData.noOutline=true; cap.add(core);
  const disc=makeGlowRing(0x7af0c8); B.root.add(disc);
  const spores=[]; for(let i=0;i<5;i++){ const s=pbox(.07,.07,.07,gillM); s.userData.noOutline=true; B.root.add(s); spores.push({s,a:i/5*Math.PI*2,r:.4+Math.random()*.3,y:.6+Math.random()*.6,sp:.2+Math.random()*.3}); }
  addOutlines(B.g);
  const st={act:0};
  return {group:B.g, scale:1, accent:0x7af0c8,
    meta:{name:'Gilllight', role:'Totem · Mycelia', lore:"One light, shared a thousand ways. That is how the Hollow remembers itself."},
    anim(t,state,dt){ const planted=state!=='idle'; ease(st,'act',planted?1:0,4,dt);
      const pulse=.5+Math.sin(t*1.8)*.5;
      core.material.emissiveIntensity=1.0+pulse*.6+st.act*2.0;
      gills.forEach(gl=>gl.material.emissiveIntensity=1.0+pulse*.5+st.act*2.2);
      B.light.intensity=.5+pulse*.3+st.act*2.4;
      cap.scale.setScalar(1+st.act*.18+Math.sin(t*1.6)*.02); cap.position.y=1.0+Math.sin(t*1.4)*.02*(1-st.act);
      spreadRoots(B.roots,st.act);
      disc.material.opacity=st.act*(.16+.1*Math.sin(t*2.5)); disc.scale.setScalar(1.1+st.act*.3);
      spores.forEach((o,i)=>{ const a=o.a+t*o.sp, r=o.r*(1+st.act*.5); o.s.position.set(Math.cos(a)*r,o.y+Math.sin(t*.8+i)*.2,Math.sin(a)*r); o.s.scale.setScalar(st.act); o.s.material.emissiveIntensity=1.0+st.act; });
    }};
}

// THREETAIL — Frostpeak. carved frost-fox breathing mist · planted: warm aura + breath sparks
function buildThreetail(){
  const B=totemBase(0xbfe8ff,0x2a3640);
  const furM=std(0xeaf4ff), furD=std(0xbcd4ec), faceM=std(0xdfeeff), noseM=std(0x3a4a5a), coreM=std(0xbfe8ff,{emissive:0x6ac0ff,ei:1.4});
  const plinth=pbox(.6,.24,.6,furD); plinth.position.y=.42; B.root.add(plinth);
  const body=new THREE.Group(); body.position.y=.66; B.root.add(body);
  const torso=pbox(.5,.6,.42,furM); torso.position.y=.1; body.add(torso);
  const chest=pbox(.4,.3,.2,faceM); chest.position.set(0,0,.22); body.add(chest);
  const core=pbox(.16,.18,.1,coreM); core.position.set(0,.06,.26); core.userData.noOutline=true; body.add(core);
  const head=pbox(.4,.36,.36,furM); head.position.set(0,.5,.12); body.add(head);
  const snout=pbox(.2,.16,.22,faceM); snout.position.set(0,.44,.34); body.add(snout);
  const nose=pbox(.08,.08,.08,noseM); nose.position.set(0,.46,.46); nose.userData.noOutline=true; body.add(nose);
  [-1,1].forEach(s=>{ const ear=pbox(.14,.22,.08,furM); ear.position.set(s*.16,.74,.1); ear.rotation.z=-s*.18; body.add(ear);
    const inner=pbox(.07,.12,.04,coreM); inner.position.set(s*.16,.72,.14); inner.userData.noOutline=true; body.add(inner); });
  const tails=[]; [-1,0,1].forEach((o)=>{ const tj=new THREE.Group(); tj.position.set(o*.16,.16,-.24); body.add(tj);
    const seg=pbox(.18,.18,.5,o===0?furM:furD); seg.position.z=-.28; tj.add(seg);
    const tip=pbox(.14,.14,.2,faceM); tip.position.z=-.56; tj.add(tip); tails.push({tj,o}); });
  const aura=makeGlowRing(0xffd8a0); B.root.add(aura);
  addOutlines(B.g);
  const st={act:0,mistT:0};
  return {group:B.g, scale:1, accent:0xbfe8ff,
    meta:{name:'Threetail', role:'Totem · Frostpeak', lore:"Where the three tails point, the snow is thin. Where they still, turn back and warm up."},
    anim(t,state,dt){ const planted=state!=='idle'; ease(st,'act',planted?1:0,4,dt);
      const pulse=.5+Math.sin(t*1.8)*.5;
      core.material.emissiveIntensity=1.0+pulse*.6+st.act*2.2; core.scale.setScalar(1+pulse*.06+st.act*.2);
      B.light.intensity=.5+pulse*.3+st.act*2.4;
      body.position.y=.66+Math.sin(t*1.4)*.02*(1-st.act);
      head.rotation.y=Math.sin(t*.7)*.15;
      tails.forEach((T,i)=>{ T.tj.rotation.y=Math.sin(t*2.5+i*.8)*(.18+st.act*.12)*(T.o===0?.6:1); T.tj.rotation.x=-.1-st.act*.1; });
      spreadRoots(B.roots,st.act);
      aura.material.opacity=st.act*(.14+.1*Math.sin(t*2)); aura.scale.setScalar(1+st.act*.3);
      st.mistT-=dt; if(st.mistT<=0 && Math.random()<.6){ st.mistT=.4+Math.random()*.5; spark(worldOf(body,0,.46,.5),0xeaf6ff,new THREE.Vector3((Math.random()-.5)*.2,.05,.3+Math.random()*.2),1.2,.05,.15*(1-st.act)); }
      if(planted && st.act>.6 && Math.random()<.1) spark(worldOf(body,0,.46,.5),0xfff0d8,new THREE.Vector3((Math.random()-.5)*.3,.2,.4),1.4,.06,.1);
    }};
}

// WAYFINDER — Dustfall. bone compass that tilts/leans · planted: needle settles, buried glint revealed
function buildWayfinder(){
  const B=totemBase(0xd9a441,0x3a3024);
  const boneM=std(0xe8dcc0), boneD=std(0xc8bca0), goldM=std(0xd9a441,{emissive:0x8a5a10,ei:1.0}), needleM=std(0xffcf6a,{emissive:0xc08a20,ei:1.4}), glintM=std(0xffe6a0,{emissive:0xffc040,ei:1.8});
  const post=pbox(.3,.5,.3,boneD); post.position.y=.5; B.root.add(post);
  const comp=new THREE.Group(); comp.position.y=1.05; B.root.add(comp);
  for(let i=0;i<8;i++){ const a=i/8*Math.PI*2; const seg=pbox(.16,.16,.1,i%2?boneM:boneD); seg.position.set(Math.cos(a)*.42,0,Math.sin(a)*.42); seg.rotation.y=-a; comp.add(seg); }
  const hub=pbox(.22,.1,.22,goldM); comp.add(hub);
  const core=pbox(.14,.12,.14,glintM); core.position.y=.02; core.userData.noOutline=true; comp.add(core);
  const needleJ=new THREE.Group(); comp.add(needleJ);
  const nN=pbox(.06,.05,.5,needleM); nN.position.z=.16; nN.userData.noOutline=true; needleJ.add(nN);
  const nS=pbox(.06,.05,.3,boneD); nS.position.z=-.12; needleJ.add(nS);
  const glint=pbox(.14,.06,.14,glintM); glint.position.set(.3,.05,-.3); glint.userData.noOutline=true; B.root.add(glint);
  addOutlines(B.g);
  const st={act:0,wob:0,wobT:0,ny:0};
  return {group:B.g, scale:1, accent:0xd9a441,
    meta:{name:'Wayfinder', role:'Totem · Dustfall', lore:"The Dust hides the old roads. The Wayfinder remembers them."},
    anim(t,state,dt){ const planted=state!=='idle'; ease(st,'act',planted?1:0,4,dt);
      const pulse=.5+Math.sin(t*1.8)*.5;
      core.material.emissiveIntensity=1.0+pulse*.6+st.act*2.2; core.scale.setScalar(1+pulse*.06+st.act*.2);
      B.light.intensity=.5+pulse*.3+st.act*2.4;
      comp.position.y=1.05+Math.sin(t*1.4)*.02*(1-st.act); comp.rotation.z=Math.sin(t*.8)*.05;
      st.wobT-=dt; if(st.wobT<=0){ st.wob=(Math.random()-.5)*2.0; st.wobT=.4+Math.random()*.8; }
      ease(st,'ny',(1-st.act)*(Math.sin(t*1.3)*.6+st.wob),6,dt);
      needleJ.rotation.y=st.ny; needleJ.rotation.x=-.05-st.act*.05;
      spreadRoots(B.roots,st.act);
      glint.scale.setScalar(Math.max(0,st.act)); glint.position.y=.05+Math.sin(t*3)*.03*st.act;
      glint.material.emissiveIntensity=1.0+Math.sin(t*4)*.6+st.act*2;
      if(planted && st.act>.6 && Math.random()<.06) spark(worldOf(glint,0,0,0),0xffe6a0,new THREE.Vector3((Math.random()-.5)*.3,.4,(Math.random()-.5)*.3),1.0,.05,1);
    }};
}

// EMBERKIN — Ember. small hound-shaped brazier · planted: flame swells warm, ember sparks
function buildEmberkin(){
  const B=totemBase(0xff7a2c,0x3a241c);
  const ironM=std(0x3a2a22,{metal:.3}), ironD=std(0x2a1e18,{metal:.3}), crackM=std(0xff7a2c,{emissive:0xc03a00,ei:1.4}),
        flameM=std(0xffb24a,{emissive:0xff7a10,ei:2}), coreM=std(0xff7a2c,{emissive:0xff5a00,ei:1.4});
  const dog=new THREE.Group(); dog.position.y=.5; B.root.add(dog);
  const body=pbox(.6,.4,.85,ironM); body.position.y=.2; dog.add(body);
  const chest=pbox(.5,.4,.3,ironD); chest.position.set(0,.18,.42); dog.add(chest);
  const head=pbox(.4,.38,.4,ironM); head.position.set(0,.5,.5); dog.add(head);
  const snout=pbox(.22,.18,.24,ironD); snout.position.set(0,.42,.74); dog.add(snout);
  [-1,1].forEach(s=>{ const ear=pbox(.12,.2,.08,ironD); ear.position.set(s*.16,.72,.46); ear.rotation.z=s*.2; dog.add(ear); });
  [-1,1].forEach(s=>{ const fl=pbox(.16,.4,.16,ironD); fl.position.set(s*.2,0,.42); dog.add(fl);
    const ha=pbox(.22,.24,.3,ironD); ha.position.set(s*.22,.06,-.2); dog.add(ha); });
  const cracks=[]; for(let i=0;i<4;i++){ const cr=pbox(.1,.06,.3,crackM); cr.position.set((i%2?1:-1)*.18,.3,-.1+i*.1); cr.userData.noOutline=true; dog.add(cr); cracks.push(cr); }
  const bowl=pbox(.4,.16,.4,ironD); bowl.position.set(0,.46,-.05); dog.add(bowl);
  const coals=pbox(.3,.1,.3,coreM); coals.position.set(0,.54,-.05); coals.userData.noOutline=true; dog.add(coals);
  const flame=pbox(.3,.5,.3,flameM); flame.position.set(0,.7,-.05); flame.userData.noOutline=true; dog.add(flame);
  addOutlines(B.g);
  const st={act:0};
  return {group:B.g, scale:1, accent:0xff7a2c,
    meta:{name:'Emberkin', role:'Totem · Ember', lore:"A fire that does not burn what it loves. The warmest thing in all of Ember."},
    anim(t,state,dt){ const planted=state!=='idle'; ease(st,'act',planted?1:0,4,dt);
      const pulse=.5+Math.sin(t*1.8)*.5, flick=.8+Math.sin(t*8)*.12+Math.sin(t*19)*.06;
      coals.material.emissiveIntensity=(1.0+pulse*.4+st.act*1.4)*flick;
      cracks.forEach(c=>c.material.emissiveIntensity=1.0+pulse*.5+st.act*1.6);
      B.light.intensity=.5+pulse*.3+st.act*2.6;
      flame.scale.set(.7+.3*flick,(.5+st.act*.9)*(.9+.15*Math.sin(t*6)),.7+.3*flick);
      flame.material.emissiveIntensity=(1.4+st.act*1.2)*flick;
      flame.material.color.setRGB(1,.62+st.act*.18,.18+st.act*.08);
      flame.position.y=.7+st.act*.12;
      dog.position.y=.5+Math.sin(t*1.4)*.02*(1-st.act); head.rotation.y=Math.sin(t*.7)*.12;
      spreadRoots(B.roots,st.act);
      if(planted && st.act>.5 && Math.random()<.16) spark(worldOf(dog,0,.7,-.05),0xff9a4a,new THREE.Vector3((Math.random()-.5)*.3,.6+Math.random()*.5,(Math.random()-.5)*.3),1.2,.05,1.2);
    }};
}

/* ========================= REGISTRY ========================= */
const PROPS=[
  { id:'hushshard',  build:buildHushShard,    states:[{s:'idle',l:'Idle'},{s:'waking',l:'Waking'},{s:'cleared',l:'Cleared'}] },
  { id:'beacon',     build:buildBeacon,       states:[{s:'idle',l:'Unlit'},{s:'lit',l:'Lit'}] },
  { id:'echomote',   build:buildEchoMote,     states:[{s:'idle',l:'Idle'},{s:'scanned',l:'Scanned'}] },
  { id:'greenheart', build:buildGreenheart,   states:[{s:'idle',l:'Carried'},{s:'planted',l:'Planted'}] },
  { id:'hearth',     build:buildHearthLantern,states:[{s:'idle',l:'Guttering'},{s:'kindled',l:'Kindled'}] },
  { id:'tideshell',  build:buildTideshell,    states:[{s:'idle',l:'Carried'},{s:'planted',l:'Planted'}] },
  { id:'gilllight',  build:buildGilllight,    states:[{s:'idle',l:'Carried'},{s:'planted',l:'Planted'}] },
  { id:'threetail',  build:buildThreetail,    states:[{s:'idle',l:'Carried'},{s:'planted',l:'Planted'}] },
  { id:'wayfinder',  build:buildWayfinder,    states:[{s:'idle',l:'Carried'},{s:'planted',l:'Planted'}] },
  { id:'emberkin',   build:buildEmberkin,     states:[{s:'idle',l:'Carried'},{s:'planted',l:'Planted'}] },
];

  function build(id){ const e=PROPS.find(p=>p.id===id); if(!e) throw new Error('unknown prop: '+id);
    const o=e.build(); o.id=id; o.states=e.states; return o; }
  function spawn(id){ const o=build(id); scene.add(o.group); return o; }
  function step(dt){ stepFx(dt); }
  return { PROPS, build, spawn, step, setCamera:c=>{ camera=c; } };
}
if(typeof module!=='undefined' && module.exports) module.exports={ createPropKit };
