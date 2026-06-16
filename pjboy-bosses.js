/* =====================================================================
   pjboy-bosses.js: 5 rigged apex bosses for Three.js (r128)
   Grovekeeper · Rimewyrm · Tidemother · Pyroclast · Sporewarden

   USAGE
   -----
     const kit  = createBossKit(THREE, scene);   // scene = your THREE.Scene
     kit.setCamera(camera);                       // needed for head-tracking
     const boss = kit.spawn('grovekeeper');       // builds + adds boss.group to scene

     // every frame:
     boss.anim(t, bossState, dt);                 // t = elapsed secs, dt = delta secs
     const { shake, flash } = kit.step(dt);       // advances fx, returns 0..1 camera shake + flash

     // fire a telegraphed one-shot attack (layered on top of bossState):
     kit.triggerAttack('smash');

   bossState (drives idle / locomotion / rage / ultimate):
     'dormant' | 'walk' | 'run' | 'enraged' | 'ultimate'

   EACH BOSS EXPOSES
     .group      THREE.Group (add to scene; spawn() already does)
     .anim(t,state,dt)
     .attacks    [{ id, name, kind:'melee'|'ranged', wind, active, rec }]
     .biomeCol   accent hex   .airborne  bool   .meta  { name,biome,faction,lore,desc,... }

   NOTES
     - One active boss at a time (the attack envelope tracks kit's current boss).
       If you run several at once, call kit.setActive(boss) before its anim().
     - FX (sparks, shockwaves, screen shake/flash) are self-contained. Just call
       kit.step(dt) each frame and apply the returned shake/flash however you like.
     - Ground non-airborne bosses yourself (lift group.position.y by the bbox).
   ===================================================================== */
function createBossKit(THREE, scene){
  let camera=null, current=null;

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
  t.forEach(m=>{ const o=new THREE.Mesh(m.geometry,OUTLINE); o.scale.setScalar(1.05);
    o.userData.isOutline=true; m.add(o); }); }
const ease=(o,k,target,rate,dt)=> o[k]=(o[k]||0)+(target-(o[k]||0))*(1-Math.exp(-rate*dt));
function eyePair(parent,col,x,y,z,sx=.1,sy=.12){ const m=new THREE.MeshBasicMaterial({color:col});
  [-1,1].forEach(s=>{ const e=pbox(sx,sy,.04,m); e.userData.noOutline=true; e.position.set(s*x,y,z); parent.add(e); }); }
const _v=new THREE.Vector3();
const worldOf=(obj,x,y,z)=> obj.localToWorld(_v.set(x,y,z)).clone();

// reusable animatable eyes: blink, mood squint, brightness
function eyeRig(parent,o){
  const mat=new THREE.MeshBasicMaterial({color:o.col}), lidM=std(o.lidCol);
  const eyes=[], lids=[], base=o.baseRGB, lidY=o.lidY;
  [-1,1].forEach(s=>{ const e=pbox(o.w,o.h,.05,mat); e.userData.noOutline=true; e.position.set(s*o.x,o.y,o.z); parent.add(e); eyes.push(e);
    const lid=pbox(o.w*1.25,o.h*1.3,.07,lidM); lid.userData.noOutline=true; lid.position.set(s*o.x,lidY,o.z); parent.add(lid); lids.push(lid); });
  const s={t:0,next:2.5,p:0};
  return { update(dt,lidLower,bright){
    s.t+=dt; if(s.t>s.next){ s.t=0; s.next=2.5+Math.random()*3.5; s.p=1; }
    if(s.p>0) s.p=Math.max(0,s.p-dt/.13);
    const closed=s.p>0?Math.sin(s.p*Math.PI):0;
    const open=Math.max(.06,1-closed*.92-lidLower*.7);
    eyes.forEach(e=>e.scale.y=open);
    lids.forEach(l=>l.position.y=lidY-(closed*.2+lidLower*.16));
    mat.color.setRGB(Math.min(1,base[0]*bright),Math.min(1,base[1]*bright),Math.min(1,base[2]*bright));
  }};
}
// mood -> eye expression {lidLower, bright}
function moodExpression(mood,rage,wind){
  let lid=.15, bright=.72;
  if(mood==='watch'){ lid=0; bright=1.0; }
  else if(mood==='scanL'||mood==='scanR'){ lid=.08; bright=.85; }
  else if(mood==='down'){ lid=.4; bright=.62; }
  else if(mood==='glare'){ lid=.28; bright=1.15; }
  else if(mood==='smolder'){ lid=.34; bright=.8; }
  lid=Math.max(0, lid + rage*.15 - wind*.12);
  bright=bright + rage*.5 + wind*.7;
  return {lidLower:lid, bright};
}

// ---- ultimate phase machine: windup -> release(fire once) -> recover ----
function ultPhase(st,state,dt){
  if(state!=='ultimate'){ st.ult=0; st.fired=false; return {wind:0,rel:0,rec:0,fire:false}; }
  st.ult=(st.ult||0)+dt; const P=2.8, T=st.ult%P;
  if(T<.06) st.fired=false;
  let wind=0,rel=0,rec=0,fire=false;
  if(T<1.1) wind=T/1.1;
  else if(T<1.5){ rel=(T-1.1)/.4; if(!st.fired){st.fired=true;fire=true;} }
  else rec=1-(T-1.5)/1.3;
  return {wind,rel,rec,fire};
}

// ---- attack controller: telegraphed one-shot moves, coexists with phase states ----
let atk={id:null,t:0,fired:false}, atkAuto=false, atkAutoT=2;
function triggerAttack(id){ atk.id=id; atk.t=0; atk.fired=false; }
// envelope for the active boss's current attack: {id, wind, active, rec, fire}
function attackEnv(dt){
  if(!atk.id||!current||!current.attacks) return {id:null,wind:0,active:0,rec:0,fire:false};
  const def=current.attacks.find(a=>a.id===atk.id);
  if(!def){ atk.id=null; return {id:null,wind:0,active:0,rec:0,fire:false}; }
  atk.t+=dt; const total=def.wind+def.active+def.rec;
  let wind=0,active=0,rec=0,fire=false;
  if(atk.t<def.wind) wind=atk.t/def.wind;
  else if(atk.t<def.wind+def.active){ active=(atk.t-def.wind)/def.active; if(!atk.fired){atk.fired=true;fire=true;} }
  else if(atk.t<total) rec=1-(atk.t-def.wind-def.active)/def.rec;
  else { const id=atk.id; atk.id=null; return {id,wind:0,active:0,rec:0,fire:false}; }
  return {id:atk.id,wind,active,rec,fire};
}

// ---- shared fx ----
const fx=[];
function spark(pos,color,vel,life,size,grav){ const m=new THREE.Mesh(new THREE.BoxGeometry(size,size,size),
  new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95})); m.position.copy(pos); scene.add(m);
  fx.push({m,vel:vel.clone(),t:0,life,g:grav??7}); }
function stepFx(dt){ for(let i=fx.length-1;i>=0;i--){ const p=fx[i]; p.t+=dt;
  if(p.t>=p.life){ scene.remove(p.m); fx.splice(i,1); continue; }
  p.vel.y-=p.g*dt; p.m.position.addScaledVector(p.vel,dt);
  const k=1-p.t/p.life; p.m.material.opacity=k*.95; p.m.scale.setScalar(k); } }
const rings=[];
function shockwave(color,y){ const m=new THREE.Mesh(new THREE.RingGeometry(.6,1.1,48),
  new THREE.MeshBasicMaterial({color,transparent:true,opacity:.85,side:THREE.DoubleSide}));
  m.rotation.x=-Math.PI/2; m.position.y=(y||0)+.06; scene.add(m); rings.push({m,t:0}); }
function stepRings(dt){ for(let i=rings.length-1;i>=0;i--){ const r=rings[i]; r.t+=dt;
  const s=1+r.t*26; r.m.scale.set(s,s,s); r.m.material.opacity=Math.max(0,.85-r.t*1.0);
  if(r.t>.9){ scene.remove(r.m); rings.splice(i,1); } } }
let shake=0, flash=0;
const kaboom=a=>{ shake=Math.max(shake,a); flash=Math.max(flash,a); };


/* =========================================================
   BOSS BUILDERS
   ========================================================= */

// ---- GROVEKEEPER, Verdant, forest titan guardian ----
function buildGrovekeeper(){
  const stoneM=std(0x4a4438), stoneD=std(0x35312a), woodM=std(0x5a4632), woodD=std(0x46362a),
        mossM=std(0x5aa83a), mossD=std(0x3a7a28),
        coreM=std(0x9af04a,{emissive:0x6ad022,ei:1.6}),
        throatM=std(0x9af04a,{emissive:0x6ad022,ei:0}),
        flowerA=std(0xe87ab0,{emissive:0x4a1830,ei:.3}), flowerB=std(0xf2c14e,{emissive:0x5a3a00,ei:.3}),
        moteMat=new THREE.MeshBasicMaterial({color:0xcaff8a}),
        mouthMat=new THREE.MeshBasicMaterial({color:0x241608});
  const g=new THREE.Group(); const rootJ=new THREE.Group(); g.add(rootJ);
  const vines=[];
  function makeVine(parent,x,y,z,n,amp){ const root=new THREE.Group(); root.position.set(x,y,z); parent.add(root);
    const segs=[]; let p=root;
    for(let i=0;i<n;i++){ const j=new THREE.Group(); j.position.y=i===0?0:-.3; p.add(j);
      const b=pbox(.09,.32,.09,i%2?woodD:mossD); b.position.y=-.16; j.add(b);
      if(Math.random()<.45){ const lf=pbox(.2,.13,.06,mossM); lf.position.set((Math.random()<.5?-1:1)*.12,-.12,0); j.add(lf); }
      segs.push(j); p=j; }
    vines.push({segs,ph:Math.random()*6.28,amp}); }
  const flowers=[];
  function makeFlower(parent,x,y,z,scl){ const f=new THREE.Group(); f.position.set(x,y,z); f.scale.setScalar(scl); parent.add(f);
    const ctr=pbox(.12,.12,.12,coreM); ctr.userData.noOutline=true; f.add(ctr);
    const pm=Math.random()<.5?flowerA:flowerB, petals=[];
    for(let i=0;i<5;i++){ const pj=new THREE.Group(); pj.rotation.y=i/5*Math.PI*2; f.add(pj);
      const pet=pbox(.1,.05,.22,pm); pet.position.z=.15; pj.add(pet); petals.push(pj); }
    flowers.push({petals,ph:Math.random()*6.28}); }
  // ---- legs with gripping root-toes ----
  const legs=[];
  [-1,1].forEach(s=>{ const hip=new THREE.Group(); hip.position.set(s*.75,1.8,0); rootJ.add(hip);
    const up=pbox(.75,1.7,.75,stoneM); up.position.y=-.85; hip.add(up);
    for(let i=0;i<3;i++){ const r=pbox(.16,1.3,.16,woodM); r.position.set((Math.random()-.5)*.6,-.6,(Math.random()-.5)*.6);
      r.rotation.z=(Math.random()-.5)*.5; up.add(r); }
    const knee=new THREE.Group(); knee.position.y=-1.6; hip.add(knee);
    const lo=pbox(.62,1.3,.62,stoneD); lo.position.y=-.65; knee.add(lo);
    const foot=pbox(.95,.42,1.2,stoneM); foot.position.set(0,-1.3,.25); knee.add(foot);
    const toes=[]; for(let i=0;i<3;i++){ const toe=new THREE.Group(); toe.position.set((i-1)*.3,-1.42,.7); knee.add(toe);
      const tb=pbox(.2,.2,.55,woodM); tb.position.z=.2; tb.rotation.x=.25; toe.add(tb); toes.push(toe); }
    legs.push({hip,knee,s,toes}); });
  const torsoJ=new THREE.Group(); torsoJ.position.y=1.8; rootJ.add(torsoJ);
  const torso=pbox(1.9,2.1,1.35,stoneM); torso.position.y=1.05; torsoJ.add(torso);
  const core=pbox(.62,.72,.42,coreM); core.position.set(0,1.0,.62); core.userData.noOutline=true; torsoJ.add(core);
  const coreLight=new THREE.PointLight(0x9af04a,1.3,10); coreLight.position.set(0,1.0,.9); torsoJ.add(coreLight);
  // rising sap mote (the heartwood breath travelling up the trunk)
  const sapMote=pbox(.18,.18,.18,moteMat); sapMote.userData.noOutline=true; torsoJ.add(sapMote);
  for(let i=0;i<18;i++){ const m=pbox(.32,.2,.32,Math.random()<.5?mossM:mossD);
    m.position.set((Math.random()-.5)*1.8,Math.random()*2.1,(Math.random()-.5)*1.25+.1); torsoJ.add(m); }
  makeFlower(torsoJ,-.7,1.5,.66,1.0); makeFlower(torsoJ,.55,.7,.68,.85); makeFlower(torsoJ,-.2,.2,.7,.7);
  const arms=[];
  [-1,1].forEach(s=>{ const sh=new THREE.Group(); sh.position.set(s*1.15,2.0,0); torsoJ.add(sh);
    const shoulder=pbox(.85,.85,.85,stoneM); sh.add(shoulder);
    makeFlower(sh,s*.1,.4,.35,.8);
    const up=pbox(.62,1.5,.62,stoneD); up.position.y=-.95; sh.add(up);
    const el=new THREE.Group(); el.position.y=-1.6; sh.add(el);
    const lo=pbox(.58,1.4,.58,stoneM); lo.position.y=-.72; el.add(lo);
    const fist=pbox(1.1,1.1,1.1,stoneM); fist.position.y=-1.6; el.add(fist);
    for(let i=0;i<4;i++){ const m=pbox(.24,.16,.24,mossM); m.position.set((Math.random()-.5)*.9,-1.6+(Math.random()-.5)*.7,(Math.random()-.5)*.9); el.add(m); }
    makeVine(el,s*.3,-.4,.2,3,1); makeVine(el,-s*.25,-.6,-.1,2,1);
    arms.push({sh,el,s}); });
  // ---- Heartwood Maul, gripped in the right hand ----
  const maul=new THREE.Group(); maul.position.y=-1.6; maul.rotation.x=-.5; arms[1].el.add(maul);
  const handle=pbox(.24,2.0,.24,woodM); handle.position.y=-.9; maul.add(handle);
  for(let i=0;i<3;i++){ const vine=pbox(.1,.5,.1,mossD); vine.position.set((Math.random()-.5)*.22,-.5-i*.5,.14); vine.rotation.x=.3; maul.add(vine); }
  const maulHead=pbox(1.0,1.0,1.0,stoneM); maulHead.position.y=-1.95; maul.add(maulHead);
  for(let i=0;i<4;i++){ const m=pbox(.3,.18,.3,Math.random()<.5?mossM:mossD); m.position.set((Math.random()-.5)*.9,-1.95+(Math.random()-.5)*.9,(Math.random()-.5)*.4+.45); maul.add(m); }
  const maulCore=pbox(.42,.42,.42,coreM); maulCore.position.set(0,-1.95,.5); maulCore.userData.noOutline=true; maul.add(maulCore);
  // ---- expressive ancient face: brows, hinged stone jaw, glowing throat, mossy beard, antler crown ----
  const neck=new THREE.Group(); neck.position.y=3.7; torsoJ.add(neck);
  const head=pbox(1.05,.95,1.05,stoneD); head.position.y=.4; neck.add(head);
  const ridge=pbox(1.12,.16,.3,stoneM); ridge.position.set(0,.74,.46); neck.add(ridge);
  const browL=pbox(.46,.13,.16,stoneM), browR=pbox(.46,.13,.16,stoneM);
  browL.position.set(-.28,.6,.52); browR.position.set(.28,.6,.52); neck.add(browL); neck.add(browR);
  const E=eyeRig(neck,{col:0xbaff7a,x:.28,y:.45,z:.52,w:.15,h:.16,lidCol:0x35312a,lidY:.66,baseRGB:[.73,1,.48]});
  const jaw=new THREE.Group(); jaw.position.set(0,.14,.12); neck.add(jaw);
  const jawB=pbox(.92,.3,.66,stoneD); jawB.position.set(0,-.12,.26); jaw.add(jawB);
  const mouth=pbox(.66,.26,.18,mouthMat); mouth.position.set(0,.04,.46); mouth.userData.noOutline=true; jaw.add(mouth);
  const throat=pbox(.5,.2,.14,throatM); throat.position.set(0,.06,.46); throat.userData.noOutline=true; jaw.add(throat);
  for(let i=0;i<5;i++) makeVine(jaw,-.32+i*.16,-.16,.5,2,.6);          // mossy beard
  const antlers=[];
  [-1,1].forEach(s=>{ const a0=new THREE.Group(); a0.position.set(s*.42,.82,0); a0.rotation.z=-s*.5; neck.add(a0);
    const b0=pbox(.13,.8,.13,woodM); b0.position.y=.4; a0.add(b0);
    const a1=new THREE.Group(); a1.position.y=.8; a0.add(a1); a1.rotation.z=-s*.5; a1.rotation.x=-.3;
    const b1=pbox(.1,.55,.1,woodD); b1.position.y=.28; a1.add(b1);
    const tuft=pbox(.34,.26,.34,mossM); tuft.position.y=.55; a1.add(tuft);
    const a2=new THREE.Group(); a2.position.set(0,.45,0); a0.add(a2); a2.rotation.z=s*.7;
    const b2=pbox(.09,.4,.09,woodD); b2.position.y=.2; a2.add(b2); const tuft2=pbox(.26,.2,.26,mossD); tuft2.position.y=.4; a2.add(tuft2);
    antlers.push({a0,base:a0.rotation.z,s}); });
  // ---- canopy crown: layered foliage rings, branches, fireflies, hanging willow vines ----
  const canopy=new THREE.Group(); canopy.position.y=4.6; torsoJ.add(canopy);
  const leaves=[];
  for(let ring=0;ring<3;ring++){ const ry=ring*.5, count=9+ring*2, rad=1.4-ring*.32;
    for(let i=0;i<count;i++){ const a=i/count*Math.PI*2+ring*.5, r=rad+Math.random()*.4;
      const leaf=pbox(.7,.5,.7,Math.random()<.5?mossM:mossD);
      leaf.position.set(Math.cos(a)*r,ry+Math.random()*.3,Math.sin(a)*r); canopy.add(leaf);
      leaves.push({m:leaf,ph:Math.random()*6.28,base:leaf.position.y,bs:1,hn:ry/1.5,ang:a}); } }
  for(let i=0;i<5;i++){ const br=pbox(.18,1.1,.18,woodM); br.position.set((Math.random()-.5)*1.1,.1,(Math.random()-.5)*1.1);
    br.rotation.z=(Math.random()-.5)*.6; canopy.add(br); }
  makeFlower(canopy,.7,.5,.4,1.1); makeFlower(canopy,-.6,.3,-.3,.9);
  for(let i=0;i<4;i++){ const a=i/4*Math.PI*2; makeVine(canopy,Math.cos(a)*1.3,-.1,Math.sin(a)*1.3,3,.7); }
  const motes=[];
  for(let i=0;i<5;i++){ const m=pbox(.08,.08,.08,moteMat); m.userData.noOutline=true; canopy.add(m);
    motes.push({m,a:i/5*6.28,r:1.0+Math.random()*.7,sp:.4+Math.random()*.5,yo:Math.random()*6.28}); }
  addOutlines(g);
  const cl=(v,a,b)=>Math.max(a,Math.min(b,v));
  const _hp=new THREE.Vector3();
  const st={rage:0,ult:0,fired:false,loco:0, neckY:0,neckX:.15, mood:'rest',moodT:1.5, leanT:0, atkHit:false,
            sap:0,sapPrev:0, groanT:4, groanV:0, bloom:1};
  return {group:g, scale:1, biomeCol:0x6ad055,
    attacks:[{id:'smash',name:'Maul Smash',kind:'melee',wind:.9,active:.45,rec:1.0},
             {id:'cleave',name:'Wide Cleave',kind:'melee',wind:.6,active:.4,rec:.9},
             {id:'surge',name:'Root Surge',kind:'ranged',wind:.8,active:.5,rec:1.0}],
    anim(t,state,dt){
      const moving=state==='walk'||state==='run', run=state==='run', slamming=state==='ultimate';
      ease(st,'rage',(state==='enraged'||slamming)?1:0,3,dt);
      ease(st,'loco',moving?(run?1:.5):0,6,dt);
      const U=ultPhase(st,state,dt);
      const A=attackEnv(dt);

      // ---- the slow groan / settle: ancient breath, an answer to a roar ----
      st.groanT-=dt; let groan=0;
      if(st.groanV>0){ st.groanV-=dt; groan=Math.sin(cl(1-st.groanV/2.6,0,1)*Math.PI); }
      if(st.groanT<=0 && !moving && !slamming && st.rage<.3 && A.id===null){ st.groanT=8+Math.random()*7; st.groanV=2.6; }

      // ---- mood machine (suspended while moving or slamming) ----
      st.moodT-=dt;
      if(st.moodT<=0 && !slamming && !moving){
        const r=Math.random();
        st.mood = r<.32?'watch':r<.5?'scanL':r<.68?'scanR':r<.84?'down':'rest';
        st.moodT=2.2+Math.random()*3;
      }
      let tyaw=0,tpitch=.15, mood=st.mood;
      if(slamming){ tyaw=0; tpitch=-.1; mood='glare'; }
      else if(moving){ tyaw=0; tpitch=run?.05:.1; mood=run?'glare':'watch'; }
      else if(st.mood==='watch'){ neck.getWorldPosition(_hp);
        const dx=camera.position.x-_hp.x,dy=camera.position.y-_hp.y,dz=camera.position.z-_hp.z;
        tyaw=cl(Math.atan2(dx,dz),-.8,.8); tpitch=cl(Math.atan2(-dy,Math.hypot(dx,dz)),-.15,.55); }
      else if(st.mood==='scanL') tyaw=.55;
      else if(st.mood==='scanR') tyaw=-.55;
      else if(st.mood==='down') tpitch=.5;
      ease(st,'neckY',tyaw,4,dt); ease(st,'neckX',tpitch,4,dt);

      // ---- gait: pumping legs, body bob, counter-swinging arms ----
      const gaitF=t*(run?6.5:3.4);
      legs.forEach((l,idx)=>{ const sw=Math.sin(gaitF+idx*Math.PI);
        l.hip.rotation.x=sw*.6*st.loco;
        l.knee.rotation.x=Math.max(0,-sw)*1.0*st.loco;
        const lean=Math.sin(st.leanT)*.05*(1-st.rage)*(1-st.loco);
        l.knee.position.y=-1.6+Math.max(0,lean*l.s)*.3;
        l.toes.forEach((toe,i)=>toe.rotation.x=.25+Math.sin(st.leanT*2+i)*.05*(1-st.loco)-st.rage*.15); });
      st.leanT+=dt*.5;
      rootJ.rotation.z=Math.sin(st.leanT)*.05*(1-st.rage)*(1-st.loco);
      const stepBob=Math.abs(Math.sin(gaitF))*.14*st.loco;
      const breath=Math.sin(t*1.3)*.04+Math.sin(t*.41)*.03;
      rootJ.position.y=breath - U.rel*.3 + stepBob;
      torso.scale.set(1+breath*.15,1,1+breath*.15);
      torsoJ.rotation.x=-U.wind*.3+U.rel*.5+st.rage*.04+st.loco*(run?.22:.1);

      neck.rotation.y=st.neckY;
      neck.rotation.x=st.neckX+Math.sin(t*.9)*.03-st.rage*.12-U.wind*.2+U.rel*.35-groan*.28;

      // ---- expressive face ----
      const ex=moodExpression(mood,st.rage,U.wind);
      E.update(dt,ex.lidLower,ex.bright);
      jaw.rotation.x=.04+groan*.5+U.wind*.12+st.rage*.16*Math.abs(Math.sin(t*1.6))+U.rel*.3;   // settle / gnash
      throatM.emissiveIntensity=groan*2.4+st.rage*1.6+U.wind*1.4+U.rel*2;
      browL.rotation.z=.16-st.rage*.7-groan*.12; browR.rotation.z=-.16+st.rage*.7+groan*.12;    // serene lift -> furrow
      antlers.forEach(an=>an.a0.rotation.z=an.base+Math.sin(t*1.1+an.s)*.03*(1+st.loco));

      // ---- heartwood breath: slow living glow + sap pulse rising up the trunk ----
      const heart=.5+.5*Math.sin(t*1.1);
      core.material.emissiveIntensity=1.3+heart*.8+st.rage*1.6+U.wind*2+st.loco*.5+groan*.7;
      coreLight.intensity=1.1+heart*.5+st.rage+U.wind*2+groan*.6;
      st.sapPrev=st.sap; st.sap=(st.sap+dt*(.28+st.loco*.4+st.rage*.3))%1;
      const sc=Math.sin(st.sap*Math.PI); sapMote.position.set(Math.sin(t*1.7)*.12,1+st.sap*3.6,.5+Math.sin(t*2.1)*.1);
      sapMote.scale.setScalar(sc*1.1+.02);
      if(st.sap<st.sapPrev){ for(let i=0;i<5;i++){ const a=Math.random()*Math.PI*2;   // pulse reaches the crown
        spark(worldOf(canopy,Math.cos(a)*1.1,.2,Math.sin(a)*1.1),0xcaff8a,new THREE.Vector3(Math.cos(a)*.6,.5,Math.sin(a)*.6),1.2,.1,1.2); } }

      // ---- flowers bloom when calm, clench shut when roused ----
      ease(st,'bloom',cl(1-st.rage*1.4,0,1),2.5,dt);
      flowers.forEach(fl=>{ const op=-1.5+st.bloom*1.35+Math.sin(t*1.4+fl.ph)*.05;
        fl.petals.forEach(pj=>pj.rotation.x=op); });

      // ---- canopy: rustle, sap ripple, bristle when enraged ----
      leaves.forEach(L=>{ const rip=Math.max(0,Math.sin(st.sap*6.28-L.hn*4.2));
        L.m.rotation.z=Math.sin(t*1.6+L.ph)*.12*(1+st.loco)-st.rage*.2;
        L.m.rotation.x=Math.sin(t*1.3+L.ph)*.08-st.rage*.5;                  // leaves stand up / bristle
        L.m.position.y=L.base+Math.sin(t*1.3+L.ph)*.05+groan*.08;
        L.m.scale.setScalar(1+rip*.12*(1-st.rage)+st.rage*.05); });
      canopy.rotation.z=Math.sin(t*.7)*.025*(1-st.loco)+Math.sin(st.leanT)*.03;
      const scatter=U.rel;
      motes.forEach(mo=>{ mo.a+=dt*mo.sp; const r=mo.r*(1+scatter*1.5);
        mo.m.position.set(Math.cos(mo.a)*r,.4+Math.sin(t*2+mo.yo)*.35+scatter*3,Math.sin(mo.a)*r); });

      // ---- hanging vines + beard: lagged secondary sway ----
      const breeze=Math.sin(t*.8), swayDrive=Math.sin(st.leanT)*.3+st.loco*Math.sin(gaitF)*.4+groan*.15;
      vines.forEach(V=>{ V.segs.forEach((j,i)=>{ const lag=(i+1);
        j.rotation.x=(swayDrive*.06+Math.sin(t*1.6+i*.5+V.ph)*.05*V.amp)*lag;
        j.rotation.z=(breeze*.04+Math.sin(t*1.2+i*.6+V.ph)*.04*V.amp)*lag*(1+st.rage); }); });

      // pollen drift + falling leaves; a breath of spores on the groan
      if(Math.random()<.04 && !slamming){ const p=worldOf(canopy,(Math.random()-.5)*2.4,0,(Math.random()-.5)*2.4);
        spark(p,Math.random()<.5?0x6ad055:0x8a7038,new THREE.Vector3((Math.random()-.5)*.5,-.25,(Math.random()-.5)*.5),2.8,.14,.5); }
      if(Math.random()<.05){ spark(worldOf(core,(Math.random()-.5)*1.4,.4,.6),0xcaff8a,
        new THREE.Vector3((Math.random()-.5)*.3,.5+Math.random()*.4,(Math.random()-.5)*.3),2.4,.07,-.4); }   // pollen rises
      if(groan>.55 && Math.random()<.5){ const mp=worldOf(jaw,0,.05,.6);
        spark(mp,0xbaff7a,new THREE.Vector3((Math.random()-.5)*.5,.2,.6+Math.random()*.5),1.8,.08,.3); }

      arms.forEach((a,idx)=>{ const idle=Math.sin(t*1.0+a.s)*.09+Math.sin(t*.37)*.05;
        const swing=Math.sin(gaitF+idx*Math.PI+Math.PI)*.55*st.loco;
        a.sh.rotation.x=idle*(1-st.loco)+swing-st.rage*.2-U.wind*2.4+U.rel*2.0;
        a.sh.rotation.z=a.s*(.04+Math.sin(t*.8+a.s)*.03);
        a.el.rotation.x=-.3-st.rage*.15-U.wind*.4-Math.abs(Math.sin(t*.9+a.s))*.06-st.loco*.2; });
      // footfall dust while running
      if(run && st.loco>.6 && Math.abs(Math.sin(gaitF))>.97 && Math.random()<.5){
        spark(worldOf(rootJ,(Math.random()-.5)*1.6,.05,(Math.random()-.5)*.8),0x6a5038,
          new THREE.Vector3((Math.random()-.5)*1.5,.6,(Math.random()-.5)*1.5),.7,.12,5); }

      // ---- attacks (channelled through the Heartwood Maul) ----
      arms[1].sh.rotation.y=0;                                  // loop sets x,z; reset y for the cleave
      if(A.id==='smash'){
        arms[1].sh.rotation.x += -A.wind*2.8 + A.active*3.8;    // raise overhead, then crash down
        arms[0].sh.rotation.x += -A.wind*.5;                    // off-hand braces
        if(A.active<=0) st.atkHit=false;
        if(A.active>.72 && !st.atkHit){ st.atkHit=true; kaboom(.5); shockwave(0x6ad055,0);
          const o=worldOf(maulHead,0,0,0);
          for(let i=0;i<20;i++){ const a=Math.random()*Math.PI*2;
            spark(o,Math.random()<.5?0x5a4632:0x6ad055,new THREE.Vector3(Math.cos(a)*3,2+Math.random()*3,Math.sin(a)*3),1.1,.18,7); } } }
      else if(A.id==='cleave'){
        arms[1].sh.rotation.x += -1.3 - A.wind*.2;              // hold the maul out front
        arms[1].sh.rotation.y += -A.wind*1.1 + A.active*2.6;    // cock to the side, sweep across the front
        if(A.active>.15 && A.active<.92 && Math.random()<.7) spark(worldOf(maulHead,0,0,0),Math.random()<.5?0x6ad055:0xcaff8a,
          new THREE.Vector3((Math.random()-.5)*3,.6,(Math.random()-.5)*3),.7,.12,2); }
      else if(A.id==='surge'){
        arms[1].sh.rotation.x += -A.wind*.7 + A.active*1.0;     // raise the maul, drive it down
        if(A.active<=0) st.atkHit=false;
        if(A.active>.7 && !st.atkHit){ st.atkHit=true; kaboom(.4); shockwave(0x6ad055,0);
          for(let i=0;i<16;i++){ const d=1.5+i*.7;             // roots erupt travelling outward (ranged)
            spark(worldOf(rootJ,(Math.random()-.5)*1.4,.05,d),Math.random()<.5?0x5a4632:0x6ad055,
              new THREE.Vector3((Math.random()-.5),3.2+Math.random()*2,.6),.95,.16,7); } } }
      core.material.emissiveIntensity += A.wind*1.2;

      if(U.fire){ kaboom(.5); shockwave(0x9af04a,0);
        for(let i=0;i<26;i++){ const a=Math.random()*Math.PI*2;
          spark(worldOf(rootJ,Math.cos(a)*1.2,.1,Math.sin(a)*1.2),Math.random()<.5?0x6ad022:0x6a5038,
            new THREE.Vector3(Math.cos(a)*5,3+Math.random()*3,Math.sin(a)*5),1.1,.18,9); }
        for(let i=0;i<14;i++){ const a=Math.random()*Math.PI*2;
          spark(worldOf(canopy,Math.cos(a),.3,Math.sin(a)),Math.random()<.5?0x6ad055:0xcaff8a,
            new THREE.Vector3(Math.cos(a)*3,4+Math.random()*3,Math.sin(a)*3),1.6,.15,2); } }
    }};
}

// ---- RIMEWYRM, Frostpeak, ice serpent-dragon (airborne) ----
function buildRimewyrm(){
  const iceM=std(0x9ad8ee,{transparent:true,opacity:.88,emissive:0x3a8ac0,ei:.4,rough:.2,metal:.1}),
        iceD=std(0x5aa0c8,{transparent:true,opacity:.88,rough:.2}),
        bellyM=std(0xdaf2fb,{transparent:true,opacity:.9,emissive:0x6ab0d0,ei:.3}),
        plateM=std(0xd8f0fa,{emissive:0x8ac8e0,ei:.5}), hornM=std(0xc8e8f4),
        spineM=std(0x8ff0ff,{emissive:0x4ad8f0,ei:1.0,transparent:true,opacity:.92}),
        coreM=std(0x9af0ff,{emissive:0x6fe3ff,ei:1.2}),
        mawM=std(0x2a6a8a,{emissive:0x4aaad0,ei:.7}), tongueM=std(0xc86a8a),
        toothM=std(0xf0f8ff);
  const g=new THREE.Group(); const fly=new THREE.Group(); fly.position.y=3.0; g.add(fly);

  // chest hub (connects neck + body), with inner cold glow and wings
  const chest=pbox(.8,.74,.95,iceM); chest.position.z=-.05; fly.add(chest);
  const belly0=pbox(.5,.2,.8,bellyM); belly0.position.set(0,-.34,-.05); fly.add(belly0);
  const core=pbox(.4,.45,.5,coreM); core.position.set(0,0,-.05); core.userData.noOutline=true; fly.add(core);
  const coreLight=new THREE.PointLight(0x6fe3ff,.6,6); fly.add(coreLight);

  // ---- serpentine neck: neckRoot -> ns1 -> ns2 -> headJ ----
  const neckRoot=new THREE.Group(); neckRoot.position.z=.3; fly.add(neckRoot);
  const ns1=new THREE.Group(); neckRoot.add(ns1);
  const nb1=pbox(.62,.58,.6,iceM); nb1.position.z=.28; ns1.add(nb1);
  const nbel1=pbox(.34,.16,.5,bellyM); nbel1.position.set(0,-.28,.28); ns1.add(nbel1);
  const ns2=new THREE.Group(); ns2.position.z=.56; ns1.add(ns2);
  const nb2=pbox(.66,.6,.6,iceM); nb2.position.z=.28; ns2.add(nb2);
  const headJ=new THREE.Group(); headJ.position.z=.58; ns2.add(headJ);

  // ---- head ----
  const skull=pbox(.74,.6,1.0,iceM); skull.position.z=.34; headJ.add(skull);
  const brow=pbox(.8,.16,.4,iceD); brow.position.set(0,.3,.5); headJ.add(brow);
  const snout=pbox(.52,.42,.66,iceM); snout.position.set(0,-.04,.92); headJ.add(snout);
  // nostril frost vents
  const nostrils=[];
  [-1,1].forEach(s=>{ const n=pbox(.1,.08,.1,iceD); n.position.set(s*.16,.04,1.22); headJ.add(n); nostrils.push(n); });
  // jaw with teeth + forked tongue
  const jaw=new THREE.Group(); jaw.position.set(0,-.2,.5); headJ.add(jaw);
  const lj=pbox(.5,.18,.66,iceD); lj.position.z=.34; jaw.add(lj);
  const ljb=pbox(.34,.1,.56,bellyM); ljb.position.set(0,-.06,.34); jaw.add(ljb);
  for(let i=0;i<4;i++){ const tu=pbox(.05,.13,.05,toothM); tu.position.set((i<2?-1:1)*.16,.12,.2+(i%2)*.24); jaw.add(tu);
    const td=pbox(.05,.12,.05,toothM); td.userData.noOutline=true; td.position.set((i<2?-1:1)*.16,-.02,.2+(i%2)*.24); headJ.add(td); }
  const tongue=new THREE.Group(); tongue.position.set(0,.02,.5); jaw.add(tongue);
  const tBase=pbox(.06,.04,.3,tongueM); tBase.position.z=.15; tBase.userData.noOutline=true; tongue.add(tBase);
  [-1,1].forEach(s=>{ const fork=pbox(.04,.03,.16,tongueM); fork.userData.noOutline=true;
    fork.position.set(s*.05,0,.36); fork.rotation.y=-s*.3; tongue.add(fork); });
  const mouth=pbox(.42,.2,.5,mawM); mouth.position.set(0,-.08,.6); mouth.userData.noOutline=true; headJ.add(mouth);
  // horns + crest frills
  [-1,1].forEach(s=>{ const horn=pbox(.12,.14,.85,hornM); horn.position.set(s*.3,.42,.2); horn.rotation.x=-.7; horn.rotation.z=s*.2; headJ.add(horn);
    const h2=pbox(.1,.1,.55,hornM); h2.position.set(s*.42,.22,.34); h2.rotation.z=s*.8; headJ.add(h2);
    const cheek=pbox(.06,.3,.34,plateM); cheek.position.set(s*.4,-.02,.3); cheek.rotation.z=s*.4; headJ.add(cheek); });
  const E=eyeRig(headJ,{col:0xeaffff,x:.28,y:.16,z:.66,w:.13,h:.13,lidCol:0x4a7a9a,lidY:.34,baseRGB:[.85,.97,1]});
  const headFrills=[];
  for(let i=0;i<5;i++){ const f=pbox(.05,.46-i*.05,.22,plateM); f.position.set(0,.36,.2-i*.2); f.rotation.x=-.35; headJ.add(f); headFrills.push(f); }

  // ---- body chain + dorsal spines + belly ----
  const segs=[]; let parent=fly; const N=9;
  for(let i=0;i<N;i++){ const seg=new THREE.Group(); seg.position.z=-.62; parent.add(seg);
    const w=.74-i*.058; const b=pbox(w,w*.9,.72,iceM); seg.add(b);
    const bel=pbox(w*.6,.16,.6,bellyM); bel.position.y=-w*.42; seg.add(bel);
    const spine=pbox(.07,.28+ (i<3?.12:0),.34,spineM); spine.position.y=w*.5; spine.rotation.x=-.1; seg.add(spine);
    segs.push({seg,w,i,box:b,spine}); parent=seg; }
  // tapering tail + barb
  let tp=parent;
  for(let i=0;i<3;i++){ const ts=new THREE.Group(); ts.position.z=-.42; tp.add(ts);
    const tb=pbox(.26-i*.07,.24-i*.06,.42,iceD); ts.add(tb); segs.push({seg:ts,w:.2,i:N+i,box:tb,spine:null}); tp=ts; }
  const barb=pbox(.18,.5,.3,plateM); barb.position.z=-.2; barb.rotation.x=-.3; tp.add(barb);

  // ---- wings: clean swept dragon sail (ribs + scalloped trailing edge) ----
  const memM=std(0x52809f,{transparent:true,opacity:.74,emissive:0x2a6a9a,ei:.28,rough:.45,side:THREE.DoubleSide}),
        boneM=std(0xbfe0ee,{rough:.5});
  const wings=[];
  [-1,1].forEach(s=>{
    const root=new THREE.Group(); root.position.set(s*.42,.34,-.05); fly.add(root);
    // leading-edge arm out to the wrist
    const arm=pbox(1.5,.16,.2,boneM); arm.position.set(s*.72,.08,-.08); arm.rotation.z=s*-.05; root.add(arm);
    const wrist=new THREE.Group(); wrist.position.set(s*1.42,.04,-.12); root.add(wrist);
    // five ribs fanning back, outer longest; membrane bay toward the next rib
    const NB=5, digits=[];
    for(let k=0;k<NB;k++){
      const f=k/(NB-1), fn=(k+1)/(NB-1);
      const len=3.0-f*1.7, lenN=3.0-fn*1.7;
      const fj=new THREE.Group(); fj.rotation.y=s*(-.12-f*1.05); wrist.add(fj);
      const rib=pbox(.1,.1,len,boneM); rib.position.z=-len/2; fj.add(rib);
      if(k<NB-1){ const w=len*.3, memLen=Math.min(len,lenN)*.84;
        const mem=pbox(w,.03,memLen,memM); mem.position.set(s*w*.5,-.04,-memLen*.5); mem.userData.noOutline=true; fj.add(mem); }
      digits.push({fj,len});
    }
    // inner membrane from the innermost rib back to the body
    const innerMem=pbox(1.05,.03,1.35,memM); innerMem.position.set(s*.55,-.02,-.5); innerMem.userData.noOutline=true; root.add(innerMem);
    wings.push({root,wrist,digits,s});
  });

  addOutlines(g);
  const cl=(v,a,b)=>Math.max(a,Math.min(b,v));
  const _hp=new THREE.Vector3();
  const st={rage:0,ult:0,fired:false,loco:0, neckY:0,neckX:.05, mood:'survey',moodT:2,
            ph:0,wph:0, tongueT:1,tongueP:0, puffT:0, diveHit:false};
  return {group:g, scale:1, biomeCol:0xbcd4ec, airborne:true,
    attacks:[{id:'breath',name:'Frost Breath',kind:'ranged',wind:1.0,active:.55,rec:1.1},
             {id:'dive',name:'Dive Bomb',kind:'melee',wind:.85,active:.45,rec:1.0},
             {id:'lash',name:'Tail Lash',kind:'melee',wind:.55,active:.45,rec:.85}],
    anim(t,state,dt){
      const moving=state==='walk'||state==='run', run=state==='run', slamming=state==='ultimate';
      ease(st,'rage',(state==='enraged'||slamming)?1:0,3,dt);
      ease(st,'loco',moving?(run?1:.5):0,5,dt);
      const U=ultPhase(st,state,dt);
      const A=attackEnv(dt);
      const diveY=A.id==='dive'?(A.wind*1.9-A.active*3.8):0, divePitch=A.id==='dive'?(-A.wind*.4+A.active*1.1):0;
      const breathP=A.id==='breath'?(-A.wind*.6+A.active*.7):0;
      const rate=1.4+st.rage*1.4+st.loco*(run?3:1.2);
      st.ph+=rate*dt;                                    // accumulate phase so rate changes never jump the wave
      fly.position.y=3.0+Math.sin(st.ph)*.25 + diveY;
      fly.rotation.x=-st.loco*(run?.32:.16) + divePitch;

      // ---- mood machine (a cold, watchful predator) ----
      st.moodT-=dt;
      if(st.moodT<=0 && !slamming && !moving){
        const r=Math.random();
        st.mood = r<.36?'survey':r<.6?'hunt':r<.8?'bask':'rouse';
        st.moodT=2+Math.random()*3;
      }
      // camera direction in world
      headJ.getWorldPosition(_hp);
      const dx=camera.position.x-_hp.x,dy=camera.position.y-_hp.y,dz=camera.position.z-_hp.z;
      const camYaw=cl(Math.atan2(dx,dz),-1.0,1.0), camPitch=cl(Math.atan2(-dy,Math.hypot(dx,dz)),-.5,.6);
      let mood=st.mood, tyaw=0, tpitch=.05;
      if(slamming){ mood='glare'; tyaw=0; tpitch=-.35-U.wind*.4+U.rel*.9; }     // rear, then strike down
      else if(moving){ mood='glare'; tyaw=0; tpitch=run?-.05:.04; }
      else if(mood==='survey'||mood==='rouse'){ tyaw=camYaw; tpitch=camPitch; }
      else if(mood==='hunt'){ tyaw=camYaw; tpitch=camPitch+.2; }               // lowers head, stalking
      else if(mood==='bask'){ tyaw=Math.sin(t*.5)*.4; tpitch=.14; }            // lazy weave, half-lidded
      ease(st,'neckY',tyaw,3.5,dt); ease(st,'neckX',tpitch,3.5,dt);
      // distribute the look down the neck + a live undulation weave
      const weave=Math.sin(st.ph*.8)* (.12+st.loco*.1);
      ns1.rotation.y=st.neckY*.3 + weave;
      ns2.rotation.y=st.neckY*.35 + weave*.6;
      headJ.rotation.y=st.neckY*.4;
      ns1.rotation.x=st.neckX*.3 + Math.sin(st.ph*.8+1)*.05;
      ns2.rotation.x=st.neckX*.35 + breathP*.5;
      headJ.rotation.x=st.neckX*.45 + breathP;

      // ---- mood-reactive cold eyes (brighten as an attack winds up) ----
      const ex=moodExpression(mood,st.rage,U.wind); E.update(dt,ex.lidLower,ex.bright + A.wind*.5);

      // ---- jaw + forked tongue flick ----
      jaw.rotation.x=U.wind*.2+U.rel*.7+st.rage*.12+(1-st.rage)*Math.abs(Math.sin(t*1.5))*.04 + (A.id==='breath'?A.active*.9:0) + (A.id==='dive'?A.active*.4:0);
      st.tongueT-=dt;
      const flickEvery = mood==='hunt'?.9 : mood==='bask'?3.5 : 2.2;
      if(st.tongueT<=0 && !slamming){ st.tongueT=flickEvery+Math.random(); st.tongueP=1; }
      if(st.tongueP>0) st.tongueP=Math.max(0,st.tongueP-dt/.28);
      const ext=st.tongueP>0?Math.sin(st.tongueP*Math.PI):0;
      tongue.position.z=.5+ext*.34; tongue.children.forEach((c,i)=>{ if(i>0) c.rotation.y=(i===1?-1:1)*(.3+ext*.4); });
      mouth.material.emissiveIntensity=.7+U.wind*2+U.rel*2+st.rage*.6 + (A.id==='breath'?(A.wind*1.5+A.active*3):0);

      // ---- body: undulation + breathing swell + dorsal spine shimmer ----
      segs.forEach((S,i)=>{ const lash=A.id==='lash'?(A.wind*.5 - Math.sin(A.active*Math.PI - i*.4)*(.7+i*.2)):0;
        S.seg.rotation.y=Math.sin(st.ph - i*.5)*(.2+st.rage*.12+st.loco*.1) + lash;
        S.seg.rotation.x=Math.sin(st.ph*.8 - i*.45)*.08;
        const sw=1+Math.sin(t*1.8 - i*.4)*.035; S.box.scale.set(sw,sw,1);     // breathing
        if(S.spine) S.spine.material; });
      spineM.emissiveIntensity=1.0+Math.sin(t*3)*.35+st.rage*1.2+U.wind*1.8 + A.wind*1.5;
      core.material.emissiveIntensity=1.2+Math.sin(t*2.2)*.3+st.rage; coreLight.intensity=.6+st.rage*.8;

      // ---- wings: slow beats of the whole swept sail ----
      const beatSpd=1.3+st.rage*1.1+st.loco*2.2; st.wph+=beatSpd*dt; const beat=Math.sin(st.wph);
      const mantle=st.rage*.5+U.wind*.6+U.rel*.4;
      wings.forEach(w=>{
        w.root.rotation.z=-w.s*(beat*(.22+st.loco*.32)+.14+mantle*.4);
        w.root.rotation.y=w.s*(mantle*.4-st.loco*.15);
        w.root.rotation.x=Math.sin(t*.9+w.s)*.04-mantle*.18;
        w.wrist.rotation.z=w.s*(beat*.12-.05);             // subtle fold near the tip
      });
      memM.emissiveIntensity=.28+st.rage*.7+U.wind*1;
      if(st.rage>.4 && Math.random()<.2){ const w=wings[(Math.random()*2)|0];
        spark(worldOf(w.digits[0].fj,0,0,-2.6),0xcdeefb,new THREE.Vector3((Math.random()-.5)*.3,-.5,(Math.random()-.5)*.3),1.6,.07,1.2); }

      // ---- frost breath from nostrils (cold creature, always exhaling) ----
      st.puffT-=dt;
      const puffEvery = mood==='bask'?.7:1.3;
      if(st.puffT<=0 && !slamming){ st.puffT=puffEvery;
        nostrils.forEach(n=>{ const p=worldOf(n,0,0,.1);
          spark(p,0xeafaff,new THREE.Vector3((Math.random()-.5)*.3,-.2,.6+Math.random()*.4),1.1,.09,.6); }); }
      // ---- occasional ice crystal shedding ----
      if(Math.random()<.04){ const S=segs[(Math.random()*segs.length)|0];
        spark(worldOf(S.seg,0,S.w*.4,0),0xcdeefb,new THREE.Vector3((Math.random()-.5)*.4,-.4,(Math.random()-.5)*.4),2.4,.08,.8); }

      // ---- attack FX ----
      if(A.id==='breath' && A.active>0){ const mp=worldOf(headJ,0,-.1,1.2), fwd=worldOf(headJ,0,-.1,3).sub(mp).normalize();
        for(let k=0;k<3;k++){ const spread=new THREE.Vector3((Math.random()-.5)*1.6,(Math.random()-.5)*1.2,(Math.random()-.5)*1.6);
          spark(mp,Math.random()<.5?0xd8f0fa:0x9ad8ee, fwd.clone().multiplyScalar(8).add(spread),.7,.12,1); } }
      if(A.id==='dive'){
        if(A.active>0) spark(worldOf(fly,(Math.random()-.5)*1.5,0,(Math.random()-.5)*1.5),0xcdeefb,new THREE.Vector3(0,-3,0),.4,.1,2);
        if(A.active>.82 && !st.diveHit){ st.diveHit=true; kaboom(.42); shockwave(0xbfe6f2,0);
          const o=worldOf(fly,0,-2,0); for(let k=0;k<16;k++){ const a=Math.random()*Math.PI*2;
            spark(o,0xd8f0fa,new THREE.Vector3(Math.cos(a)*5,1+Math.random()*2,Math.sin(a)*5),.9,.12,3); } } }
      if(A.id!=='dive') st.diveHit=false;
      if(A.id==='lash' && A.active>.15 && A.active<.92){ const T=segs[segs.length-1];
        spark(worldOf(T.seg,0,0,-.3),0xcdeefb,new THREE.Vector3((Math.random()-.5)*3.5,(Math.random()-.5),(Math.random()-.5)*3.5),.6,.09,1.5); }

      if(run && st.loco>.6 && Math.random()<.4){ const p=worldOf(fly,(Math.random()-.5)*2,(Math.random()-.5)*1.5,-2);
        spark(p,0xd8f0fa,new THREE.Vector3(0,0,-6),.4,.08,0); }
      if(slamming && U.rel>0){
        const mp=worldOf(headJ,0,-.1,1.2), fwd=worldOf(headJ,0,-.1,3).sub(mp).normalize();
        for(let k=0;k<5;k++){ const spread=new THREE.Vector3((Math.random()-.5)*2,(Math.random()-.5)*1.4,(Math.random()-.5)*2);
          spark(mp,Math.random()<.5?0xd8f0fa:0x9ad8ee, fwd.clone().multiplyScalar(8).add(spread),.7,.12,1); } }
      if(U.fire){ kaboom(.34); }
    }};
}

// ---- TIDEMOTHER, Aquaria, leviathan kraken ----
function buildTidemother(){
  const bellM=std(0x3a2a6a,{transparent:true,opacity:.7,emissive:0x6a2a9a,ei:.65,rough:.3}),
        coreM=std(0xff6ae0,{emissive:0xff4ad0,ei:1.7}),
        tentM=std(0x4a2a7a,{transparent:true,opacity:.84,emissive:0x6a2a9a,ei:.4}),
        fringeM=std(0x8a5ad0,{transparent:true,opacity:.7,emissive:0x6a2a9a,ei:.9}),
        glowBase=std(0x9fe8ff,{emissive:0x4ad8ff,ei:1.4}), beakM=std(0x1a1230);
  const g=new THREE.Group(); const core=new THREE.Group(); core.position.y=3.6; g.add(core);
  const glows=[];
  const glowSpot=(parent,x,y,z,r,phase,mat)=>{ const m=(mat||glowBase).clone(); const s=pbox(r,r,r,m);
    s.userData.noOutline=true; s.position.set(x,y,z); parent.add(s); glows.push({m,phase}); return s; };

  // translucent bell dome
  const bellBoxes=[];
  [[2.3,.5,0],[2.0,.5,.46],[1.55,.46,.86],[1.05,.42,1.2],[.55,.36,1.44]].forEach(([w,h,y])=>{
    const b=pbox(w,h,w,bellM); b.position.y=y; b.userData.noOutline=true; core.add(b); bellBoxes.push(b); });
  // glowing heart + light
  const gl=pbox(1.1,.95,1.1,coreM); gl.position.y=.42; gl.userData.noOutline=true; core.add(gl);
  const light=new THREE.PointLight(0xff6ae0,1.8,16); light.position.y=.5; core.add(light);
  // inner bioluminescent filaments that glow through the bell
  for(let i=0;i<6;i++){ const a=i/6*Math.PI*2; const f=pbox(.05,1.1,.05,glowBase.clone());
    f.userData.noOutline=true; f.position.set(Math.cos(a)*.5,.6,Math.sin(a)*.5); core.add(f); glows.push({m:f.material,phase:i}); }
  // (eyes and beak removed)
  // bell-rim fringe cilia
  const fringe=[];
  for(let i=0;i<14;i++){ const a=i/14*Math.PI*2; const fj=new THREE.Group();
    fj.position.set(Math.cos(a)*1.12,0,Math.sin(a)*1.12); core.add(fj);
    const f=pbox(.06,.9,.06,fringeM); f.position.y=-.45; f.userData.noOutline=true; fj.add(f); fringe.push({fj,a}); }
  // rim photophores
  for(let i=0;i<10;i++){ const a=i/10*Math.PI*2; glowSpot(core,Math.cos(a)*1.0,.55,Math.sin(a)*1.0,.11,i); }
  // hypnotic lure on a dangling stalk
  const lureStalk=new THREE.Group(); lureStalk.position.set(0,0,1.0); core.add(lureStalk);
  const ls=pbox(.07,.9,.07,tentM); ls.position.y=-.45; ls.userData.noOutline=true; lureStalk.add(ls);
  const lureJ=new THREE.Group(); lureJ.position.y=-.9; lureStalk.add(lureJ);
  const lureOrb=pbox(.32,.32,.32,coreM.clone()); lureOrb.userData.noOutline=true; lureJ.add(lureOrb);
  const lureLight=new THREE.PointLight(0xff8af0,.7,7); lureJ.add(lureLight);

  // 8 arms (glowing photophores + tips)
  const tents=[];
  for(let i=0;i<8;i++){ const a=i/8*Math.PI*2, r=.95;
    const rootJ=new THREE.Group(); rootJ.position.set(Math.cos(a)*r,-.4,Math.sin(a)*r); rootJ.rotation.y=-a; core.add(rootJ);
    const segs=[]; let parent=rootJ; const SN=6;
    for(let s=0;s<SN;s++){ const seg=new THREE.Group(); seg.position.y=s===0?-.3:-.56; parent.add(seg);
      const w=.44-s*.052; const m=pbox(w,.6,w,tentM); m.position.y=-.3; m.userData.noOutline=true; seg.add(m);
      if(s%2===1) glowSpot(seg,0,-.3,w*.5,.07,i+s); segs.push(seg); parent=seg; }
    const tip=pbox(.12,.3,.12,glowBase.clone()); tip.userData.noOutline=true; tip.position.y=-.3; parent.add(tip);
    glows.push({m:tip.material,phase:i}); tents.push({rootJ,segs,a,i}); }

  // 2 long feeding tentacles that reach forward
  const feeders=[];
  [-1,1].forEach(s=>{ const rootJ=new THREE.Group(); rootJ.position.set(s*.45,-.4,.9); core.add(rootJ);
    const segs=[]; let parent=rootJ; const FN=8;
    for(let k=0;k<FN;k++){ const seg=new THREE.Group(); seg.position.y=k===0?-.3:-.5; parent.add(seg);
      const w=.26-k*.024; const m=pbox(w,.5,w,tentM); m.position.y=-.25; m.userData.noOutline=true; seg.add(m);
      if(k%2===0) glowSpot(seg,0,-.25,w*.6,.06,k); segs.push(seg); parent=seg; }
    const pad=pbox(.26,.34,.26,coreM.clone()); pad.userData.noOutline=true; pad.position.y=-.3; parent.add(pad);
    glows.push({m:pad.material,phase:s+2}); feeders.push({rootJ,segs,pad,s}); });

  const _hp=new THREE.Vector3();
  const st={rage:0,ult:0,fired:false,loco:0, mood:'drift',moodT:2, faceY:0, ph:0, lph:0, planktonT:0, bubbleT:0, atkHit:false};
  return {group:g, scale:1, biomeCol:0x6fe3ff, airborne:true,
    attacks:[{id:'sweep',name:'Tentacle Sweep',kind:'melee',wind:.7,active:.5,rec:1.0},
             {id:'ink',name:'Ink Recoil',kind:'ranged',wind:.35,active:.35,rec:1.0}],
    anim(t,state,dt){
      const moving=state==='walk'||state==='run', run=state==='run', slamming=state==='ultimate';
      ease(st,'rage',(state==='enraged'||slamming)?1:0,3,dt);
      ease(st,'loco',moving?(run?1:.5):0,5,dt);
      const U=ultPhase(st,state,dt);
      const A=attackEnv(dt);
      const rate=1.0+st.rage*1.2+st.loco*(run?2.2:.8);
      st.ph+=rate*dt;                                    // accumulate phase so a rate change never jumps the wave
      const pulse=Math.sin(st.ph);

      // mood machine
      st.moodT-=dt;
      if(st.moodT<=0 && !slamming && !moving){ const r=Math.random();
        st.mood=r<.34?'drift':r<.62?'hunt':r<.82?'lure':'recoil'; st.moodT=2.5+Math.random()*3; }
      let mood=st.mood;
      if(slamming||moving) mood='glare';

      // facing: drift slowly spins; hunt/glare turns to face the camera (shortest way, wrapped)
      core.getWorldPosition(_hp);
      const camYaw=Math.atan2(camera.position.x-_hp.x, camera.position.z-_hp.z);
      if(mood==='hunt'||mood==='glare'){ let d=camYaw-st.faceY; d=Math.atan2(Math.sin(d),Math.cos(d)); st.faceY+=d*Math.min(1,3*dt); }
      else st.faceY += dt*(.15+st.rage*.2);
      st.faceY=Math.atan2(Math.sin(st.faceY),Math.cos(st.faceY));
      core.rotation.y=st.faceY;

      // jet propulsion bob/lunge + tilt toward camera on hunt
      core.position.y=3.6+pulse*.12 - U.rel*.4;
      core.position.z=st.loco*.4 + pulse*st.loco*.5;
      core.rotation.x=st.loco*(run?.25:.12) + (mood==='hunt'?.12:0);

      // radiance: heart + hypnotic lure + travelling bioluminescent pulse
      st.lph+=(mood==='lure'?2.4:1.3)*dt; const lurePulse=.5+.5*Math.sin(st.lph);
      gl.material.emissiveIntensity=1.7+pulse*.5+st.rage*1.5+U.wind*3+U.rel*4+st.loco*.8 + lurePulse*(mood==='lure'?2:.6);
      light.intensity=1.7+st.rage*2+U.wind*3+U.rel*5+st.loco+lurePulse;
      gl.material.color.setHex(U.rel>0?0xfff0ff:0xff6ae0);
      lureOrb.material.emissiveIntensity=1.5+lurePulse*2.5+st.rage; lureOrb.scale.setScalar(1+lurePulse*.2);
      lureLight.intensity=.7+lurePulse*1.6;
      lureStalk.rotation.x=Math.sin(t*1.1)*.15+st.loco*.3; lureStalk.rotation.z=Math.cos(t*.9)*.12; lureJ.rotation.x=Math.sin(t*1.6)*.2;
      const photo=.6+st.rage*1.0+U.wind*1.5+(mood==='lure'||mood==='hunt'?.7:0);
      glows.forEach(o=>{ o.m.emissiveIntensity=1.0+photo*(.5+.5*Math.sin(t*2.2-o.phase)); });

      // bell breathe + fringe ripple
      bellBoxes.forEach((b,i)=>{ const sc=1+Math.sin(st.ph - i*.3)*.04; b.scale.set(sc,1,sc); });
      fringe.forEach(F=>{ F.fj.rotation.x=Math.sin(t*2 - F.a*1.5)*.3+st.loco*.4; F.fj.rotation.z=Math.cos(t*1.7 - F.a)*.2; });

      // 8 arms writhe + row
      tents.forEach(T=>{ T.segs.forEach((seg,si)=>{ const lag=si*.5;
        const writhe=Math.sin(st.ph - lag + T.a)*(.16+.07*si+st.rage*.08);
        const row=Math.sin(st.ph - si*.4)*st.loco*(.3+si*.12);
        seg.rotation.x=writhe + row + U.wind*(-.4-si*.2) + U.rel*(.5+si*.15);
        seg.rotation.z=Math.cos(t*1.2 - lag + T.a)*.08; }); });

      // feeding tentacles reach forward (more when hunting)
      const reach=(mood==='hunt'?.5:0)+st.rage*.2;
      feeders.forEach(f=>{ f.rootJ.rotation.x=.3+reach;
        f.segs.forEach((seg,si)=>{ seg.rotation.x=.1 - reach*.06 + Math.sin(t*1.8 - si*.5 + f.s)*(.12+st.rage*.06) + U.rel*.3;
          seg.rotation.z=f.s*Math.sin(t*1.3 - si*.4)*.1; }); });

      // (eyes removed)

      // ambient plankton motes + rising bubbles
      st.planktonT-=dt;
      if(st.planktonT<=0){ st.planktonT=.12;
        spark(worldOf(core,(Math.random()-.5)*5,(Math.random()-.5)*3,(Math.random()-.5)*5),
          Math.random()<.5?0x6fe3ff:0xff8af0, new THREE.Vector3((Math.random()-.5)*.2,.1,(Math.random()-.5)*.2),3.0,.05,-.05); }
      st.bubbleT-=dt;
      if(st.bubbleT<=0){ st.bubbleT=.2;
        spark(worldOf(core,(Math.random()-.5)*.8,-1.4,(Math.random()-.5)*.8),0xbfefff,
          new THREE.Vector3((Math.random()-.5)*.2,1.4+Math.random(),(Math.random()-.5)*.2),1.6,.07,.4); }
      // ink billows when recoiling / enraged
      if((mood==='recoil'&&Math.random()<.05)||(st.rage>.5&&Math.random()<.03)){
        spark(worldOf(core,0,-1,0),0x140e26,new THREE.Vector3((Math.random()-.5),-.3,(Math.random()-.5)),2.4,.5,-.1); }

      // ---- attacks ----
      if(A.id==='sweep'){
        tents.forEach(T=>T.segs.forEach((seg,si)=>{ seg.rotation.x += -A.wind*.5 + Math.sin(A.active*Math.PI - si*.3)*(.5+si*.12); }));
        if(A.active<=0) st.atkHit=false;
        if(A.active>.5 && !st.atkHit){ st.atkHit=true; kaboom(.3); shockwave(0x6fe3ff,0);
          for(let i=0;i<18;i++){ const a=i/18*Math.PI*2;
            spark(worldOf(core,Math.cos(a)*2,-1,Math.sin(a)*2),0xbfefff,new THREE.Vector3(Math.cos(a)*5,1,Math.sin(a)*5),.9,.1,1.5); } } }
      else if(A.id==='ink'){
        core.position.y += A.wind*.2 + A.active*1.9;
        tents.forEach(T=>T.segs.forEach(seg=>{ seg.rotation.x += A.wind*.3; }));
        gl.material.emissiveIntensity *= (1 - A.active*.6);
        if(A.active<=0) st.atkHit=false;
        if(A.active>.3 && !st.atkHit){ st.atkHit=true;
          for(let i=0;i<26;i++) spark(worldOf(core,(Math.random()-.5)*2,-1,(Math.random()-.5)*2),0x140e26,
            new THREE.Vector3((Math.random()-.5)*2,-.2-Math.random(),(Math.random()-.5)*2),2.6,.5,-.1); } }

      // Abyssal Slam ultimate
      if(U.fire){ kaboom(.45); shockwave(0x6fe3ff,0); shockwave(0xff6ae0,0);
        for(let i=0;i<30;i++){ const a=Math.random()*Math.PI*2;
          spark(worldOf(core,Math.cos(a)*1.5,-1.5,Math.sin(a)*1.5), Math.random()<.5?0xff8af0:0x9fe8ff,
            new THREE.Vector3(Math.cos(a)*4,2+Math.random()*2,Math.sin(a)*4),1.0,.14,5); }
        for(let i=0;i<16;i++) spark(worldOf(core,(Math.random()-.5)*2,1,(Math.random()-.5)*2),0xbfefff,
            new THREE.Vector3((Math.random()-.5),3+Math.random()*2,(Math.random()-.5)),1.6,.08,.4); }
    }};
}

// ---- PYROCLAST, Ember, magma colossus ----
function buildPyroclast(){
  const rockM=std(0x1c1820,{rough:.85}), rockD=std(0x2a2228),
        crackM=std(0xff5a1e,{emissive:0xff4a10,ei:1.8}), coreM=std(0xffd86a,{emissive:0xffae3a,ei:2.0});
  const g=new THREE.Group(); const rootJ=new THREE.Group(); g.add(rootJ);
  // pelvis + two thick magma legs
  const pelvis=pbox(1.9,.7,1.5,rockM); pelvis.position.y=1.5; rootJ.add(pelvis);
  const legs=[];
  [-1,1].forEach(s=>{ const hip=new THREE.Group(); hip.position.set(s*.7,1.5,0); rootJ.add(hip);
    const up=pbox(.8,.95,.85,rockM); up.position.y=-.5; hip.add(up);
    for(let i=0;i<2;i++){ const c=pbox(.55,.08,.08,crackM); c.userData.noOutline=true;
      c.position.set(0,-.3-i*.3,.44); c.rotation.z=(Math.random()-.5)*.6; hip.add(c); }
    const knee=new THREE.Group(); knee.position.y=-.95; hip.add(knee);
    const lo=pbox(.66,.85,.72,rockD); lo.position.y=-.45; knee.add(lo);
    const foot=pbox(.95,.4,1.15,rockM); foot.position.set(0,-.85,.2); knee.add(foot);
    const ftc=pbox(.7,.06,.7,crackM); ftc.userData.noOutline=true; ftc.position.set(0,-.7,.2); knee.add(ftc);
    legs.push({hip,knee,s}); });
  const torsoJ=new THREE.Group(); torsoJ.position.y=2.2; rootJ.add(torsoJ);
  const torso=pbox(1.9,1.7,1.6,rockM); torso.position.y=.85; torsoJ.add(torso);
  // beating molten heart, framed by obsidian ribs
  const core=pbox(.95,1.0,.5,coreM); core.position.set(0,.9,.74); core.userData.noOutline=true; torsoJ.add(core);
  [-1,1].forEach(s=>{ const rib=pbox(.2,1.15,.32,rockD); rib.position.set(s*.55,.9,.74); torsoJ.add(rib); });
  const coreLight=new THREE.PointLight(0xff7a2a,1.8,14); coreLight.position.set(0,.9,1.1); torsoJ.add(coreLight);
  for(let i=0;i<12;i++){ const c=pbox(.1,.5,.1,crackM); c.userData.noOutline=true;
    c.position.set((Math.random()-.5)*1.5,.9+(Math.random()-.5)*1.4,.82); c.rotation.z=Math.random()*3; torsoJ.add(c); }
  // jagged shoulder pauldrons with spikes + molten seam
  const pauldrons=[];
  [-1,1].forEach(s=>{ const pj=new THREE.Group(); pj.position.set(s*1.18,1.78,0); torsoJ.add(pj);
    const pad=pbox(1.05,.72,1.05,rockM); pj.add(pad);
    for(let i=0;i<3;i++){ const spk=pbox(.17,.55-i*.12,.17,rockD); spk.position.set(s*(.12+i*.22),.4,.32-i*.32); spk.rotation.z=s*-.32; pj.add(spk); }
    const seam=pbox(1.06,.09,.74,crackM); seam.userData.noOutline=true; seam.position.y=.06; pj.add(seam);
    pauldrons.push(pj); });
  // spine ridge of obsidian spikes
  for(let i=0;i<5;i++){ const sp=pbox(.18,.44-i*.05,.2,rockD); sp.position.set(0,.45+i*.32,-.82); sp.rotation.x=-.32; torsoJ.add(sp);
    const sg=pbox(.06,.22,.06,crackM); sg.userData.noOutline=true; sg.position.set(0,.45+i*.32,-.72); torsoJ.add(sg); }
  // back fumarole vents (erupt smoke + embers)
  const vents=[];
  for(let i=0;i<3;i++){ const v=pbox(.48,.58,.48,rockD); v.position.set((i-1)*.66,1.88,-.82); torsoJ.add(v);
    const glow=pbox(.34,.24,.34,coreM); glow.position.set((i-1)*.66,2.16,-.82); glow.userData.noOutline=true; torsoJ.add(glow);
    vents.push({x:(i-1)*.66}); }
  // arms with outer plates, forearm spikes, charging fists with molten knuckles
  const arms=[];
  [-1,1].forEach(s=>{ const sh=new THREE.Group(); sh.position.set(s*1.25,1.7,0); torsoJ.add(sh);
    const up=pbox(.78,1.5,.78,rockM); up.position.y=-.85; sh.add(up);
    const upPlate=pbox(.3,.8,.86,rockD); upPlate.position.set(s*.34,-.7,0); sh.add(upPlate);
    const el=new THREE.Group(); el.position.y=-1.6; sh.add(el);
    const lo=pbox(.66,1.4,.66,rockD); lo.position.y=-.75; el.add(lo);
    for(let i=0;i<2;i++){ const fspk=pbox(.13,.34,.13,rockM); fspk.position.set(s*.4,-.45-i*.5,0); fspk.rotation.z=s*-.45; el.add(fspk); }
    for(let i=0;i<3;i++){ const c=pbox(.78,.1,.1,crackM); c.userData.noOutline=true;
      c.position.set(0,-1.6+(Math.random()-.5)*.9,.62); c.rotation.z=Math.random()*3; el.add(c); }
    const fistJ=new THREE.Group(); fistJ.position.y=-1.55; el.add(fistJ);
    const fist=pbox(1.2,1.2,1.2,rockM); fistJ.add(fist);
    const knuck=pbox(1.22,.22,1.22,crackM); knuck.userData.noOutline=true; knuck.position.y=.56; fistJ.add(knuck);
    arms.push({sh,el,fistJ,s}); });
  // ---- head: a furious, fanged, molten skull ----
  const fangM=std(0xc2b4a6,{rough:.6}), socketM=std(0x120e10);
  const neck=new THREE.Group(); neck.position.y=2.85; torsoJ.add(neck);
  const head=pbox(1.0,.9,1.0,rockD); head.position.y=.34; neck.add(head);
  // heavy angled brow = permanent scowl
  const browL=pbox(.58,.2,.52,rockM); browL.position.set(-.26,.52,.42); browL.rotation.z=-.3; neck.add(browL);
  const browR=pbox(.58,.2,.52,rockM); browR.position.set(.26,.52,.42); browR.rotation.z=.3; neck.add(browR);
  // brow crown spikes
  [-1,1].forEach(s=>{ const spike=pbox(.11,.34,.11,rockD); spike.position.set(s*.24,.7,.18); spike.rotation.z=s*.25; neck.add(spike); });
  // deep dark sockets, burning eyes set under the brow
  [-1,1].forEach(s=>{ const sock=pbox(.32,.24,.16,socketM); sock.userData.noOutline=true; sock.position.set(s*.26,.36,.52); neck.add(sock); });
  const E=eyeRig(neck,{col:0xff8a2a,x:.26,y:.36,z:.58,w:.17,h:.12,lidCol:0x1a1210,lidY:.5,baseRGB:[1,.5,.14]});
  // molten fissures across the face
  const faceCracks=[];
  for(let i=0;i<6;i++){ const c=pbox(.06,.34,.06,crackM); c.userData.noOutline=true;
    c.position.set((Math.random()-.5)*.82,.05+(Math.random()-.3)*.55,.52); c.rotation.z=(Math.random()-.5)*1.6; neck.add(c); faceCracks.push(c); }
  // backswept horns
  [-1,1].forEach(s=>{ const horn=pbox(.17,.17,.72,rockM); horn.position.set(s*.42,.58,-.05); horn.rotation.x=.75; horn.rotation.z=s*.32; neck.add(horn);
    const tip=pbox(.1,.1,.42,rockD); tip.position.set(s*.54,.84,-.4); tip.rotation.x=.95; tip.rotation.z=s*.42; neck.add(tip); });
  // nostrils (ember vents)
  const nostrils=[];
  [-1,1].forEach(s=>{ const n=pbox(.11,.09,.1,socketM); n.userData.noOutline=true; n.position.set(s*.14,.12,.66); neck.add(n); nostrils.push(n); });
  // upper lip + bared fangs
  const upperLip=pbox(.8,.16,.42,rockD); upperLip.position.set(0,.02,.5); neck.add(upperLip);
  for(let i=0;i<3;i++){ const f=pbox(.08,.18,.08,fangM); f.position.set((i-1)*.22,-.08,.66); f.rotation.x=.12; neck.add(f); }
  // molten throat behind the teeth (seen when the jaw opens)
  const throatGlow=pbox(.52,.34,.22,coreM); throatGlow.position.set(0,-.04,.4); throatGlow.userData.noOutline=true; neck.add(throatGlow);
  // hinged lower jaw with jut + fangs + molten floor
  const jaw=new THREE.Group(); jaw.position.set(0,-.14,.28); neck.add(jaw);
  const lj=pbox(.72,.2,.48,rockD); lj.position.set(0,-.04,.28); jaw.add(lj);
  const jut=pbox(.52,.13,.22,rockM); jut.position.set(0,.04,.52); jaw.add(jut);
  for(let i=0;i<3;i++){ const f=pbox(.08,.18,.08,fangM); f.position.set((i-1)*.2,.12,.5); f.rotation.x=-.12; jaw.add(f); }
  const mawGlow=pbox(.58,.14,.36,crackM); mawGlow.position.set(0,0,.32); mawGlow.userData.noOutline=true; jaw.add(mawGlow);
  addOutlines(g);
  const cl=(v,a,b)=>Math.max(a,Math.min(b,v));
  const _hp=new THREE.Vector3();
  const st={rage:0,ult:0,fired:false,loco:0, neckY:0,neckX:.1, mood:'rest',moodT:1.5, snortT:0, roarT:1.5, jawP:0, ventT:0, dripT:0, atkHit:false};
  return {group:g, scale:1, biomeCol:0xff5a1e,
    attacks:[{id:'pound',name:'Ground Pound',kind:'melee',wind:.8,active:.5,rec:1.0},
             {id:'spew',name:'Ember Spew',kind:'ranged',wind:.9,active:.6,rec:1.0}],
    anim(t,state,dt){
      const moving=state==='walk'||state==='run', run=state==='run', slamming=state==='ultimate';
      ease(st,'rage',(state==='enraged'||slamming)?1:0,3,dt);
      ease(st,'loco',moving?(run?1:.5):0,6,dt);
      const U=ultPhase(st,state,dt);
      const A=attackEnv(dt);

      // ---- mood: a smouldering predator. glares around, snorts embers ----
      st.moodT-=dt;
      if(st.moodT<=0 && !slamming && !moving){
        const r=Math.random();
        st.mood = r<.34?'glare':r<.52?'scanL':r<.7?'scanR':r<.86?'smolder':'rest';
        st.moodT=2+Math.random()*2.6;
      }
      let tyaw=0,tpitch=.1, mood=st.mood;
      if(slamming){ tyaw=0; tpitch=-.05; mood='glare'; }
      else if(moving){ tyaw=0; tpitch=run?0:.05; mood='glare'; }
      else if(st.mood==='glare'){ neck.getWorldPosition(_hp);
        const dx=camera.position.x-_hp.x,dy=camera.position.y-_hp.y,dz=camera.position.z-_hp.z;
        tyaw=cl(Math.atan2(dx,dz),-.7,.7); tpitch=cl(Math.atan2(-dy,Math.hypot(dx,dz)),-.1,.4); }
      else if(st.mood==='scanL') tyaw=.5;
      else if(st.mood==='scanR') tyaw=-.5;
      else if(st.mood==='smolder') tpitch=-.12;        // lifts head, vents roar
      ease(st,'neckY',tyaw,4,dt); ease(st,'neckX',tpitch,4,dt);

      // ---- gait ----
      const gaitF=t*(run?5.8:3.0);
      legs.forEach((l,idx)=>{ const sw=Math.sin(gaitF+idx*Math.PI);
        l.hip.rotation.x=sw*.5*st.loco; l.knee.rotation.x=Math.max(0,-sw)*.9*st.loco; });
      const stepBob=Math.abs(Math.sin(gaitF))*.12*st.loco;
      rootJ.position.y=Math.sin(t*1.1)*.03-U.rel*.25+stepBob;
      rootJ.rotation.z=Math.sin(t*.8)*.015*(1-st.rage)*(1-st.loco);
      torsoJ.rotation.x=.07+(mood==='glare'?.05:0)-U.wind*.35+U.rel*.5+st.rage*.08+st.loco*(run?.2:.08);
      neck.rotation.y=st.neckY; neck.rotation.x=st.neckX-st.rage*.1+U.rel*.2;

      // ---- mood-reactive burning eyes ----
      const ex=moodExpression(mood,st.rage,U.wind);
      // ---- furious face: furrowing scowl, snarl + periodic roar ----
      const furrow=st.rage*.3 + (mood==='glare'?.18:0) + U.wind*.25;
      browL.rotation.z=-.3-furrow; browR.rotation.z=.3+furrow;
      browL.position.y=.52-furrow*.18; browR.position.y=.52-furrow*.18;
      let jawOpen=(1-st.rage)*Math.abs(Math.sin(t*2))*.05;
      if(mood==='glare'||mood==='smolder') jawOpen+=.1+Math.sin(t*3)*.04;     // snarl, fangs bared
      jawOpen+=st.rage*.12+U.wind*.2+U.rel*.45;
      st.roarT-=dt;
      if((st.rage>.3||mood==='glare') && st.roarT<=0){ st.roarT=2.4+Math.random()*2.4; st.jawP=1; }
      if(st.jawP>0) st.jawP=Math.max(0,st.jawP-dt/.55);
      const roar=st.jawP>0?Math.sin(st.jawP*Math.PI):0;
      jawOpen+=roar*.55;
      jaw.rotation.x=jawOpen;
      throatGlow.material.emissiveIntensity=1.6+jawOpen*5+Math.sin(t*7)*.4;
      throatGlow.material.color.setHex(roar>.5||U.wind>.6?0xffffff:0xffd86a);
      if(roar>.1) neck.rotation.x -= roar*.18;                                 // head shoves forward in the roar
      E.update(dt,ex.lidLower,ex.bright+roar*.8);                              // eyes flare on the roar
      if(roar>.7 && Math.random()<.6){ const mp=worldOf(jaw,0,.05,.55);
        spark(mp,Math.random()<.5?0xffae3a:0xff6a1e,new THREE.Vector3((Math.random()-.5)*1.2,.6+Math.random(),1.4+Math.random()),.8,.11,3); }

      const heat=1.8+Math.sin(t*8)*.4+Math.sin(t*5+1)*.3+st.rage*1.2+U.wind*3+st.loco*.6;
      crackM.emissiveIntensity=heat;
      // beating molten heart (faster + brighter when enraged)
      const hb=Math.pow(Math.max(0,Math.sin(t*(2.2+st.rage*2.4))),6);
      core.scale.setScalar(1+hb*.13+st.rage*.05);
      coreM.emissiveIntensity=2.0+hb*1.6+st.rage*1.5+U.wind*4;
      coreM.color.setHex(U.wind>.6?0xffffff:0xffd86a);
      coreLight.intensity=1.8+hb*1.3+st.rage*2+U.wind*4;
      // heavy molten breathing, shoulders rise and hunch
      const breath=Math.sin(t*1.4);
      pauldrons.forEach((p,i)=>{ p.position.y=1.78+breath*.05-st.rage*.06; p.rotation.z=(i?1:-1)*(.05+st.rage*.08); });
      // back vents erupt smoke + embers, harder the angrier he is
      st.ventT-=dt;
      if(st.ventT<=0){ st.ventT=.2-st.rage*.1;
        vents.forEach(v=>{ const p=worldOf(torsoJ,v.x,2.3,-.82);
          spark(p,0x2c242e,new THREE.Vector3((Math.random()-.5)*.3,1.1+Math.random(),-.2),1.7,.15,.4);     // smoke column
          if(Math.random()<.45+st.rage){ spark(p,Math.random()<.5?0xff7a2c:0xffae3a,
            new THREE.Vector3((Math.random()-.5)*.5,1.6+Math.random()*1.6,-.2),1.0,.1,3); } }); }     // ejected embers
      // lava weeping from the body cracks
      st.dripT-=dt;
      if(st.dripT<=0){ st.dripT=.5-st.rage*.28;
        spark(worldOf(torsoJ,(Math.random()-.5)*1.5,.4+Math.random()*1.1,.85),0xff6a1e,
          new THREE.Vector3(0,-.25,.15),1.5,.1,4); }

      arms.forEach((a,idx)=>{ const idle=Math.sin(t*1.0+a.s)*.07;
        const swing=Math.sin(gaitF+idx*Math.PI+Math.PI)*.5*st.loco;
        a.sh.rotation.x=idle*(1-st.loco)+swing-st.rage*.25-U.wind*2.3+U.rel*1.9;
        a.el.rotation.x=-.35-U.wind*.4-st.loco*.2;
        a.fistJ.scale.setScalar(1+(U.wind+st.rage*.4)*.14);          // knuckles clench + swell as he charges
        a.fistJ.rotation.x=U.wind*.5; });

      // ambient embers + ember-snort on smolder mood
      if(Math.random()<.4+st.rage*.4+st.loco*.3){ spark(worldOf(torsoJ,(Math.random()-.5)*2,1.3,.6),0xff7a2c,
        new THREE.Vector3((Math.random()-.5)*.6,1+Math.random()*1.5,(Math.random()-.5)*.6),1.0,.08,4); }
      st.snortT+=dt;
      const snortEvery = (mood==='smolder'||mood==='glare')?.3 : st.rage>.3?.5 : 1.2;
      if(st.snortT>snortEvery){ st.snortT=0;
        nostrils.forEach(n=>{ const mp=worldOf(n,0,0,.1);
          spark(mp,0x3a3036,new THREE.Vector3((Math.random()-.5)*.3,.5+Math.random()*.4,.5),1.4,.12,.8);   // smoke
          if(st.rage>.2||mood==='glare') spark(mp,0xff7a2c,new THREE.Vector3((Math.random()-.5)*.4,.3,.7+Math.random()),.7,.08,3); }); }
      // footfall embers while running
      if(run && st.loco>.6 && Math.abs(Math.sin(gaitF))>.97 && Math.random()<.6){
        spark(worldOf(rootJ,(Math.random()-.5)*1.6,.05,(Math.random()-.5)*.8),0xff5a1e,
          new THREE.Vector3((Math.random()-.5)*1.6,.8,(Math.random()-.5)*1.6),.7,.12,6); }

      // ---- attacks ----
      if(A.id==='pound'){
        arms.forEach(a=>{ a.sh.rotation.x += -A.wind*2.4 + A.active*3.0; });
        torsoJ.rotation.x += A.active*.3;
        if(A.active<=0) st.atkHit=false;
        if(A.active>.75 && !st.atkHit){ st.atkHit=true; kaboom(.5); shockwave(0xff7a2c,0);
          for(let i=0;i<24;i++){ const a=i/24*Math.PI*2, r=1.4+Math.random()*1.6;
            spark(worldOf(rootJ,Math.cos(a)*r,.1,Math.sin(a)*r),Math.random()<.5?0xff7a2c:0xffae3a,
              new THREE.Vector3(Math.cos(a)*4,2+Math.random()*3,Math.sin(a)*4),1.0,.16,7); } } }
      else if(A.id==='spew'){
        neck.rotation.x += -A.wind*.4 + A.active*.5;
        jaw.rotation.x += A.active*1.0;
        throatGlow.material.emissiveIntensity += A.wind*4 + A.active*6;
        if(A.active>0){ const mp=worldOf(jaw,0,.05,.6), fwd=worldOf(jaw,0,.05,3).sub(mp).normalize();
          for(let k=0;k<3;k++){ const spread=new THREE.Vector3((Math.random()-.5)*1.4,(Math.random()-.5)*1,(Math.random()-.5)*1.4);
            spark(mp,Math.random()<.5?0xffae3a:0xff6a1e, fwd.clone().multiplyScalar(9).add(spread),.7,.12,3); } } }

      if(U.fire){ kaboom(.6); shockwave(0xff6a1e,0);
        for(let i=0;i<34;i++){ const a=Math.random()*Math.PI*2, sp=Math.random();
          spark(worldOf(rootJ,Math.cos(a)*1.2*sp,1.5,Math.sin(a)*1.2*sp),Math.random()<.5?0xff5a1e:0xffd86a,
            new THREE.Vector3(Math.cos(a)*5*sp,5+Math.random()*4,Math.sin(a)*5*sp),1.3,.2,8); } }
    }};
}

// ---------- registry ----------
// ---- SPOREWARDEN, Mycelia, fungal hivemind titan ----
function buildSporewarden(){
  const fleshM=std(0xc9c2ad,{rough:.92}), fleshD=std(0x8f8770,{rough:.92}),
        capM=std(0x5a3a7a,{rough:.6,emissive:0x3a1f5a,ei:.35}), capD=std(0x432a5e,{rough:.6}),
        gillM=std(0x7af0d0,{emissive:0x4ad8b0,ei:1.1,transparent:true,opacity:.94}),
        glowBase=std(0x9affe0,{emissive:0x6ff0c8,ei:1.4}), rootM=std(0x6f6754,{rough:.95}),
        toothM=std(0xe8e2d2);
  const g=new THREE.Group(); const rootJ=new THREE.Group(); g.add(rootJ);
  const glows=[];                       // bioluminescent spots w/ per-spot phase for a travelling pulse
  const glowSpot=(parent,x,y,z,r,phase)=>{ const m=glowBase.clone(); const s=pbox(r,r,r,m);
    s.userData.noOutline=true; s.position.set(x,y,z); parent.add(s); glows.push({m,phase}); return s; };

  // base: lumpy pelvis, drooping root strands, two thick root-legs
  const pelvis=pbox(2.0,.8,1.5,fleshD); pelvis.position.y=1.6; rootJ.add(pelvis);
  const strands=[];
  for(let i=0;i<7;i++){ const a=(i/7)*Math.PI*2; const sj=new THREE.Group();
    sj.position.set(Math.cos(a)*.8,1.3,Math.sin(a)*.6); rootJ.add(sj);
    const r=pbox(.13,.9,.13,rootM); r.position.y=-.45; sj.add(r); strands.push({j:sj,a}); }
  const legs=[];
  [-1,1].forEach(s=>{ const hip=new THREE.Group(); hip.position.set(s*.72,1.6,0); rootJ.add(hip);
    const up=pbox(.72,1.0,.82,fleshM); up.position.y=-.55; hip.add(up); glowSpot(hip,s*.2,-.5,.44,.12,s*1.3);
    const knee=new THREE.Group(); knee.position.y=-1.0; hip.add(knee);
    const lo=pbox(.62,.9,.68,fleshD); lo.position.y=-.5; knee.add(lo);
    for(let i=0;i<4;i++){ const a=(i/4)*Math.PI*2; const claw=pbox(.16,.16,.62,rootM);
      claw.position.set(Math.cos(a)*.32,-.95,Math.sin(a)*.32+.1); claw.rotation.x=.5; knee.add(claw); }
    legs.push({hip,knee,s}); });

  // hunched torso
  const torsoJ=new THREE.Group(); torsoJ.position.y=2.4; rootJ.add(torsoJ);
  const torso=pbox(1.9,1.7,1.5,fleshM); torso.position.y=.7; torsoJ.add(torso);
  const lump=pbox(1.5,1.2,.6,fleshD); lump.position.set(0,.5,.7); torsoJ.add(lump);
  for(let i=0;i<4;i++){ const gl=pbox(1.1-i*.12,.08,.3,gillM); gl.userData.noOutline=true; gl.position.set(0,.3+i*.22,.84); torsoJ.add(gl); }
  glowSpot(torsoJ,0,.7,.72,.34,0); glowSpot(torsoJ,-.5,1.1,.7,.14,.6); glowSpot(torsoJ,.55,.95,.7,.13,1.1);
  const coreLight=new THREE.PointLight(0x6ff0c8,1.0,12); coreLight.position.set(0,.8,1.0); torsoJ.add(coreLight);
  // shoulder/back accessory caps
  const smallCaps=[];
  [[-1.0,1.5,-.3,.72],[1.0,1.5,-.3,.72],[-.5,1.95,-.6,.5],[.5,1.95,-.6,.5]].forEach(([x,y,z,r])=>{
    const cj=new THREE.Group(); cj.position.set(x,y,z); torsoJ.add(cj);
    const stem=pbox(.16,.4,.16,fleshM); cj.add(stem);
    const cap=pbox(r,.22,r,capM); cap.position.y=.28; cj.add(cap);
    const cap2=pbox(r*.6,.16,r*.6,capD); cap2.position.y=.42; cj.add(cap2);
    glowSpot(cj,0,.14,r*.3,.08,x); smallCaps.push({cj}); });

  // tendril arms
  const arms=[];
  [-1,1].forEach(s=>{ const sh=new THREE.Group(); sh.position.set(s*1.15,1.4,.1); torsoJ.add(sh);
    const segs=[]; let parent=sh; const SN=4;
    for(let i=0;i<SN;i++){ const seg=new THREE.Group(); seg.position.y=i===0?-.2:-.8; parent.add(seg);
      const w=.42-i*.07; const b=pbox(w,.85,w,i%2?fleshD:fleshM); b.position.y=-.4; seg.add(b);
      if(i===1) glowSpot(seg,0,-.4,.22,.1,s+i); segs.push(seg); parent=seg; }
    const hand=new THREE.Group(); hand.position.y=-.8; parent.add(hand);
    const palm=pbox(.28,.2,.28,fleshD); hand.add(palm);
    for(let i=0;i<4;i++){ const a=(i/4)*Math.PI*2;
      const fj=new THREE.Group(); fj.position.set(Math.cos(a)*.15,-.12,Math.sin(a)*.15);
      fj.rotation.x=Math.sin(a)*.5; fj.rotation.z=-Math.cos(a)*.5; hand.add(fj);
      const f1=pbox(.08,.34,.08,rootM); f1.position.y=-.17; fj.add(f1);
      const tip=pbox(.07,.22,.07,rootM); tip.position.set(0,-.36,.05); tip.rotation.x=.7; fj.add(tip); }
    arms.push({sh,segs,s}); });

  // head: stalk-neck + towering overhanging cap
  const neck=new THREE.Group(); neck.position.set(0,1.6,.05); torsoJ.add(neck);
  const stalk=pbox(.72,1.0,.72,fleshM); stalk.position.y=.4; neck.add(stalk);
  const headJ=new THREE.Group(); headJ.position.y=.95; neck.add(headJ);
  const face=pbox(.92,.7,.7,fleshD); face.position.set(0,.08,.2); headJ.add(face);
  const jaw=new THREE.Group(); jaw.position.set(0,-.12,.34); headJ.add(jaw);
  const mawGill=pbox(.6,.3,.2,gillM); mawGill.userData.noOutline=true; mawGill.position.z=.12; jaw.add(mawGill);
  for(let i=0;i<4;i++){ const tooth=pbox(.5,.04,.04,toothM); tooth.position.set(0,-.1+i*.08,.22); jaw.add(tooth); }
  const E=eyeRig(headJ,{col:0x9ff0d8,x:.24,y:.28,z:.42,w:.14,h:.14,lidCol:0x3a4a44,lidY:.42,baseRGB:[.6,1,.85]});
  const capJ=new THREE.Group(); capJ.position.y=.9; headJ.add(capJ);
  [[2.6,.3,0],[2.2,.34,.34],[1.5,.32,.66]].forEach(([w,h,y])=>{ const c=pbox(w,h,w,capM); c.position.y=y; capJ.add(c); });
  const crown=pbox(.8,.4,.8,capD); crown.position.y=.98; capJ.add(crown);
  for(let i=0;i<10;i++){ const a=(i/10)*Math.PI*2; const gl=pbox(.12,.06,1.0,gillM); gl.userData.noOutline=true;
    gl.position.set(Math.cos(a)*.7,-.05,Math.sin(a)*.7); gl.rotation.y=-a; capJ.add(gl); }
  for(let i=0;i<6;i++){ const a=(i/6)*Math.PI*2; glowSpot(capJ,Math.cos(a)*.9,.42,Math.sin(a)*.9,.1,i); }

  addOutlines(g);
  const cl=(v,a,b)=>Math.max(a,Math.min(b,v)); const _hp=new THREE.Vector3();
  const st={rage:0,ult:0,fired:false,loco:0, neckY:0,neckX:0, mood:'commune',moodT:2, sporeT:0, atkHit:false};
  return {group:g, scale:1, biomeCol:0x7af0c8,
    attacks:[{id:'slam',name:'Cap Slam',kind:'melee',wind:.8,active:.5,rec:1.0},
             {id:'whip',name:'Tendril Whip',kind:'melee',wind:.6,active:.45,rec:.9}],
    anim(t,state,dt){
      const moving=state==='walk'||state==='run', run=state==='run', slamming=state==='ultimate';
      ease(st,'rage',(state==='enraged'||slamming)?1:0,3,dt);
      ease(st,'loco',moving?(run?1:.5):0,5,dt);
      const U=ultPhase(st,state,dt);
      const A=attackEnv(dt);
      const sway=Math.sin(t*1.1)*.04;

      // mood machine
      st.moodT-=dt;
      if(st.moodT<=0 && !slamming && !moving){ const r=Math.random();
        st.mood=r<.34?'commune':r<.6?'sense':r<.8?'bloom':'lurk'; st.moodT=2.5+Math.random()*3; }
      let mood=st.mood, tyaw=0, tpitch=.04;
      headJ.getWorldPosition(_hp);
      const dx=camera.position.x-_hp.x, dz=camera.position.z-_hp.z, dy=camera.position.y-_hp.y;
      const camYaw=cl(Math.atan2(dx,dz),-.8,.8), camPitch=cl(Math.atan2(-dy,Math.hypot(dx,dz)),-.3,.5);
      if(slamming){ mood='glare'; tyaw=0; tpitch=-.2-U.wind*.3+U.rel*.5; }
      else if(moving){ mood='glare'; tyaw=0; tpitch=.05; }
      else if(mood==='sense'){ tyaw=camYaw; tpitch=camPitch; }
      else if(mood==='bloom'){ tyaw=camYaw*.4; tpitch=-.1; }
      else if(mood==='lurk'){ tyaw=Math.sin(t*.4)*.3; tpitch=.18; }
      else { tyaw=Math.sin(t*.5)*.25; }                 // commune sway
      ease(st,'neckY',tyaw,3,dt); ease(st,'neckX',tpitch,3,dt);
      neck.rotation.y=st.neckY*.5; neck.rotation.z=sway;
      headJ.rotation.y=st.neckY*.5; headJ.rotation.x=st.neckX;
      capJ.rotation.x=st.neckX*.3+Math.sin(t*.8)*.03;

      // gait
      const gaitF=t*(run?7:3.6);
      legs.forEach((L,i)=>{ const ph=i*Math.PI; const sw=Math.sin(gaitF+ph)*st.loco;
        L.hip.rotation.x=sw*.5; L.knee.rotation.x=Math.max(0,Math.sin(gaitF+ph+1))*st.loco*.7; });
      rootJ.position.y=Math.abs(Math.sin(gaitF))*st.loco*.14;
      rootJ.rotation.z=Math.sin(gaitF)*st.loco*.05+sway*.5;
      torsoJ.rotation.x=.06-U.wind*.25+U.rel*.4+st.loco*.08;
      strands.forEach(S=>{ S.j.rotation.x=Math.sin(t*1.3+S.a)*.12; S.j.rotation.z=Math.cos(t*1.1+S.a)*.12; });

      // bioluminescent travelling pulse + flare
      const pulse=.6+st.rage*1.2+U.wind*2+(mood==='bloom'?1:0);
      glows.forEach(o=>{ o.m.emissiveIntensity=1.0+pulse*(.5+.5*Math.sin(t*2.2-o.phase)); });
      gillM.emissiveIntensity=1.1+st.rage*1.3+U.wind*2+(mood==='sense'||mood==='bloom'?.8:0)+Math.sin(t*1.8)*.3;
      coreLight.intensity=1.0+st.rage*1.2+U.wind*3+Math.sin(t*2.2)*.4;

      // breathing + bloom swell
      capJ.scale.setScalar(1+Math.sin(t*1.3)*.03+st.rage*.04+U.wind*.18);
      smallCaps.forEach((c,i)=>c.cj.scale.setScalar(1+Math.sin(t*1.5+i)*.05+st.rage*.06+U.wind*.2));

      // tendril arms: splay outward, reach forward, gentle sway; rear + thrust on the bloom
      arms.forEach(a=>{ a.sh.rotation.z=a.s*(.32+st.rage*.4+U.wind*.6);
        a.sh.rotation.x=.12-U.wind*.5+U.rel*.7;
        a.segs.forEach((seg,i)=>{ seg.rotation.x=.16+Math.sin(t*1.4-i*.5+a.s)*.09-U.wind*.12;
          seg.rotation.z=a.s*Math.sin(t*1.0-i*.4)*.07; }); });

      jaw.rotation.x=.05+U.wind*.2+U.rel*.7+(mood==='bloom'?.15:0)+(1-st.rage)*Math.abs(Math.sin(t*1.2))*.04;
      const ex=moodExpression(mood,st.rage,U.wind); E.update(dt,ex.lidLower,ex.bright);

      // spores: constant drift + maw release; bursts when roused
      st.sporeT-=dt;
      const every=(mood==='bloom'?.12:.3)/(1+st.rage);
      if(st.sporeT<=0){ st.sporeT=every;
        spark(worldOf(capJ,(Math.random()-.5)*3.2,-.1,(Math.random()-.5)*3.2), Math.random()<.5?0x9ff0d8:0xb98aff,
          new THREE.Vector3((Math.random()-.5)*.3,-.15,(Math.random()-.5)*.3),2.8,.07,.35);   // slow settling spores
        if(mood==='bloom'||st.rage>.3){ const mp=worldOf(jaw,0,0,.3);
          spark(mp,0x9ff0d8,new THREE.Vector3((Math.random()-.5)*.6,.4,.8+Math.random()),1.5,.08,.5); } }

      // ---- attacks ----
      if(A.id==='slam'){
        headJ.rotation.x += -A.wind*.5 + A.active*.9;     // headJ + torso are reset each frame, so no accumulation
        torsoJ.rotation.x += A.active*.3;                  // body lunges with the cap
        if(A.active<=0) st.atkHit=false;
        if(A.active>.7 && !st.atkHit){ st.atkHit=true; kaboom(.4); shockwave(0x9ff0d8,0);
          const o=worldOf(capJ,0,-.3,1.2);
          for(let i=0;i<30;i++){ const a=Math.random()*Math.PI*2, e=Math.random();
            spark(o,Math.random()<.5?0x9ff0d8:0xb98aff,new THREE.Vector3(Math.cos(a)*(3+e*3),1+Math.random()*2,Math.sin(a)*(3+e*3)),1.6,.1,.4); } } }
      else if(A.id==='whip'){ const a0=arms[0];
        a0.sh.rotation.x += -A.wind*1.6 + A.active*2.6;     // raise back, then whip forward
        a0.segs.forEach((seg,i)=>{ seg.rotation.x += Math.sin(A.active*Math.PI - i*.5)*(.4+i*.14); });  // tendril trails the whip
        if(A.active>.2 && A.active<.9 && Math.random()<.6){ const hand=a0.segs[a0.segs.length-1];
          spark(worldOf(hand,0,-.8,0),Math.random()<.5?0x9ff0d8:0xb98aff,new THREE.Vector3((Math.random()-.5)*3,.4,(Math.random()-.5)*3),.7,.09,1); } }
      gillM.emissiveIntensity += A.wind*1.5;

      // Spore Bloom ultimate
      if(U.fire){ kaboom(.4); shockwave(0x9ff0d8,0);
        const o=worldOf(capJ,0,0,0);
        for(let i=0;i<44;i++){ const a=Math.random()*Math.PI*2, e=Math.random();
          spark(o,Math.random()<.5?0x9ff0d8:0xb98aff,
            new THREE.Vector3(Math.cos(a)*(3+e*4),1+Math.random()*3,Math.sin(a)*(3+e*4)),1.9,.1,.4); } }
    }};
}

const BOSSES=[
  { id:'grovekeeper', name:'Grovekeeper', biome:'Verdant', faction:'The Living', col:0x6ad055,
    threat:'APEX', height:'~6m', ability:'Heartwood Slam',
    behav:'Slumbers as terrain until disturbed. Wakes slow, then brings both fists down in a quaking shockwave.',
    build:buildGrovekeeper,
    desc:"A titan of stone and old growth, mossed over so completely that herds graze on its shoulders. It guards the deep Verdant and does not chase. It does not need to.",
    lore:"The first explorers mapped it as a hill. The hill stood up." },
  { id:'rimewyrm', name:'Rimewyrm', biome:'Frostpeak', faction:'Enemies', col:0x9ad8ee,
    threat:'APEX', height:'~12m long', ability:'Frost Breath',
    behav:'Circles the peaks on ice-membrane wings. Rears back and exhales a cone of killing cold.',
    build:buildRimewyrm,
    desc:"A serpent-dragon of living glacier, plated in crystalline ice that regrows faster than it can be chipped. It nests above the storm line where the air itself freezes.",
    lore:"Frostpeak has two weathers: the storm, and the wyrm. Only one of them is angry at you." },
  { id:'tidemother', name:'Tidemother', biome:'Aquaria', faction:'Enemies', col:0x6fe3ff,
    threat:'APEX', height:'~10m', ability:'Abyssal Slam',
    behav:'Rises from the deep, eight arms writhing, core blazing. Rears the tentacles high and crashes them down.',
    build:buildTidemother,
    desc:"A leviathan jelly the size of a ship, her translucent dome lit by a heart of trapped Aether. Eight arms map the dark. Every Driftjelly in Aquaria is, in some sense, her child.",
    lore:"Sailors called the glow a harbor light and steered toward it. Once." },
  { id:'pyroclast', name:'Pyroclast', biome:'Ember', faction:'Enemies', col:0xff5a1e,
    threat:'APEX', height:'~6m', ability:'Eruption',
    behav:'A walking volcano. Cracks brighten to white as it charges, then it erupts in a ring of molten rock.',
    build:buildPyroclast,
    desc:"A colossus of cooled magma with a still-molten heart, the source the Cinderhounds den near for warmth. When it wakes, the whole Ember caldera reads it as a fresh eruption.",
    lore:"It is not that it breathes fire. It is that it is the fire, briefly shaped like something that can find you." },
  { id:'sporewarden', name:'Sporewarden', biome:'Mycelia', faction:'The Living', col:0x7af0c8,
    threat:'APEX', height:'~7m', ability:'Spore Bloom',
    behav:'Stands as a grove until it senses you. Then the great cap tilts down, the gills flare, and it blooms into a choking cloud of spores.',
    build:buildSporewarden,
    desc:"A hivemind worn as a body: one colossal fruiting form wired to every fungus in Mycelia. It does not think the way prey thinks. It spreads, and what it spreads across, it knows.",
    lore:"You do not find the Sporewarden. You breathe a little of it, and the rest of it comes looking." },
];

  function build(id){ const e=BOSSES.find(b=>b.id===id); if(!e) throw new Error('unknown boss: '+id);
    const obj=e.build(); obj.meta=e; obj.id=id; return obj; }
  function spawn(id){ const obj=build(id); scene.add(obj.group); current=obj; return obj; }
  function step(dt){ stepFx(dt); stepRings(dt);
    const s=shake, f=flash; shake=Math.max(0,shake-dt*4); flash=Math.max(0,flash-dt*4);
    return { shake:s, flash:f }; }
  return { BOSSES, build, spawn, triggerAttack,
           setCamera:c=>{ camera=c; }, setActive:o=>{ current=o; }, step };
}
if(typeof module!=='undefined' && module.exports) module.exports={ createBossKit };
