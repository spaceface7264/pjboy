/* =====================================================================
   pjboy-cast.js: 12 rigged NPCs for Three.js (r128)
   Allies (The Kindled):  Lumen · Pip · Bramblewick · Floe · Quill · Tinder
   Enemies (The Hushed):  Hushling · Husk · Mute · Gnash · Riftling · Sentinel

   USAGE
     const kit = createCastKit(THREE, scene);
     kit.setCamera(camera);                  // some enemies track the camera
     const npc = kit.spawn('tinder');        // builds + adds npc.group to scene

     // every frame:
     npc.anim(t, npcState, dt);              // t = elapsed secs, dt = delta secs
     kit.step(dt);                           // advances fx particles

   npcState:
     'idle'  , resting/ambient personality
     'greet' , allies: wave / bow / tail-fan / happy
     'alert' , enemies: snap toward you / snarl / lock on

   EACH NPC EXPOSES
     .group   THREE.Group (spawn() already adds it)
     .anim(t,state,dt)   .accent hex   .airborne bool   .meta { name, role, faction, biome, lore, ... }

   NOTES
     - Enemies that read the camera (Hushling, Husk, Mute, Gnash, Sentinel) need setCamera().
     - Allies use 'greet', enemies use 'alert'. Any non-'idle' string triggers the expressive pose.
     - FX (sparks, breath, bubbles) are self-contained; just call kit.step(dt) each frame.
     - Ground non-airborne NPCs yourself (lift group.position.y by the bbox); airborne ones float.
   ===================================================================== */
function createCastKit(THREE, scene){
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
  t.forEach(m=>{ const o=new THREE.Mesh(m.geometry,OUTLINE); o.scale.setScalar(1.06);
    o.userData.isOutline=true; m.add(o); }); }
const ease=(o,k,target,rate,dt)=> o[k]=(o[k]||0)+(target-(o[k]||0))*(1-Math.exp(-rate*dt));
const _v=new THREE.Vector3(), _v2=new THREE.Vector3();
const worldOf=(obj,x,y,z)=> obj.localToWorld(_v.set(x,y,z)).clone();

// reusable animatable eyes: blink, squint, brightness
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

// ---- shared fx ----
const fx=[];
function spark(pos,color,vel,life,size,grav){ const m=new THREE.Mesh(new THREE.BoxGeometry(size,size,size),
  new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95})); m.position.copy(pos); scene.add(m);
  fx.push({m,vel:vel.clone(),t:0,life,g:grav??7}); }
function stepFx(dt){ for(let i=fx.length-1;i>=0;i--){ const p=fx[i]; p.t+=dt;
  if(p.t>=p.life){ scene.remove(p.m); fx.splice(i,1); continue; }
  p.vel.y-=p.g*dt; p.m.position.addScaledVector(p.vel,dt);
  const k=1-p.t/p.life; p.m.material.opacity=k*.95; p.m.scale.setScalar(k); } }

/* =========================================================
   THE KINDLED, allies
   ========================================================= */


function buildLumen(){
  const M=std(0x3a4a52), Md=std(0x2a363c), gold=std(0xe8b33b,{emissive:0x6a4a10,ei:.6}),
        glow=std(0x7fe8d0,{emissive:0x4ad0b0,ei:2}), barM=std(0x5a6a70);
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const robe=new THREE.Group(); root.add(robe);
  [2.0,1.7,1.4,1.1,.85].forEach((w,i)=>{ const seg=pbox(w,.7,w*.8,i%2?Md:M); seg.position.y=i*.66; robe.add(seg); });
  for(let i=0;i<3;i++){ const trim=pbox(1.7-i*.4,.12,1.4-i*.34,gold); trim.position.y=.34+i*1.0; robe.add(trim); }
  const arms=[]; [-1,1].forEach(s=>{ const sh=new THREE.Group(); sh.position.set(s*.95,2.7,0); robe.add(sh);
    const a=pbox(.34,1.5,.34,Md); a.position.y=-.7; sh.add(a);
    const hand=pbox(.3,.3,.3,M); hand.position.y=-1.5; sh.add(hand); arms.push({sh,s}); });
  const headJ=new THREE.Group(); headJ.position.y=4.2; root.add(headJ);
  const cageT=pbox(.9,.16,.9,barM); cageT.position.y=.62; headJ.add(cageT);
  const cageB=pbox(.9,.16,.9,barM); cageB.position.y=-.62; headJ.add(cageB);
  for(let i=0;i<4;i++){ const a=i/4*Math.PI*2; const bar=pbox(.1,1.2,.1,barM); bar.position.set(Math.cos(a)*.4,0,Math.sin(a)*.4); headJ.add(bar); }
  const flame=pbox(.5,.62,.5,glow); flame.userData.noOutline=true; headJ.add(flame);
  const light=new THREE.PointLight(0x7fe8d0,1.6,12); headJ.add(light);
  const finial=pbox(.18,.2,.18,gold); finial.position.y=1.0; headJ.add(finial);
  addOutlines(g);
  const st={act:0};
  return {group:g, scale:1, accent:0x7fe8d0,
    anim(t,state,dt){
      ease(st,'act',state!=='idle'?1:0,3,dt);
      const float=Math.sin(t*1.1)*.12;
      headJ.position.y=4.2+float+st.act*.3;
      headJ.rotation.y=Math.sin(t*.5)*.22;
      flame.material.emissiveIntensity=1.6+Math.sin(t*3)*.4+st.act*2.6;
      flame.scale.setScalar(1+Math.sin(t*4)*.08+st.act*.35);
      light.intensity=1.4+Math.sin(t*3)*.3+st.act*2.4;
      robe.rotation.y=Math.sin(t*.4)*.05;
      arms.forEach(a=>{ a.sh.rotation.x=Math.sin(t*.8+a.s)*.06 - st.act*.6; a.sh.rotation.z=a.s*(.1+st.act*.35); });
      root.position.y=float*.3;
      if(st.act>.5 && Math.random()<.16) spark(worldOf(headJ,0,0,0),0x7fe8d0,new THREE.Vector3((Math.random()-.5),.6,(Math.random()-.5)),1.4,.1,-.3);
    }};
}

// PIP, your companion, a fellow Kindler child with a spark-jar
function buildPip(){
  const skin=std(0xd8a878), cloth=std(0x4a7ac0), cloth2=std(0x3a5a90), hairM=std(0x3a2a20),
        jarG=std(0xffd24a,{emissive:0xaa7000,ei:2}), glassM=std(0xbfe8ff,{transparent:true,opacity:.4});
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const body=pbox(.7,.8,.5,cloth); body.position.y=.9; root.add(body);
  const belt=pbox(.74,.14,.54,cloth2); belt.position.y=.62; root.add(belt);
  const headJ=new THREE.Group(); headJ.position.y=1.7; root.add(headJ);
  const head=pbox(.9,.85,.85,skin); headJ.add(head);
  const hair=pbox(.96,.32,.92,hairM); hair.position.y=.42; headJ.add(hair);
  const E=eyeRig(headJ,{col:0x2a2a2a,x:.2,y:.02,z:.45,w:.14,h:.18,lidCol:0xd8a878,lidY:.2,baseRGB:[.55,.55,.6]});
  const legs=[]; [-1,1].forEach(s=>{ const lg=new THREE.Group(); lg.position.set(s*.2,.5,0); root.add(lg);
    const l=pbox(.26,.5,.26,cloth2); l.position.y=-.25; lg.add(l);
    const foot=pbox(.3,.16,.42,hairM); foot.position.set(0,-.52,.08); lg.add(foot); legs.push({lg,s}); });
  const arms=[]; [-1,1].forEach(s=>{ const sh=new THREE.Group(); sh.position.set(s*.45,1.25,0); root.add(sh);
    const a=pbox(.22,.6,.22,cloth); a.position.y=-.3; sh.add(a);
    const hand=pbox(.22,.22,.22,skin); hand.position.y=-.6; sh.add(hand); arms.push({sh,s}); });
  const jar=new THREE.Group(); jar.position.y=-.78; arms[1].sh.add(jar);
  jar.add(pbox(.3,.36,.3,glassM));
  const mote=pbox(.14,.14,.14,jarG); mote.userData.noOutline=true; jar.add(mote);
  const jarLight=new THREE.PointLight(0xffd24a,1,5); jar.add(jarLight);
  addOutlines(g);
  const st={act:0};
  return {group:g, scale:1, accent:0xffd24a,
    anim(t,state,dt){
      ease(st,'act',state!=='idle'?1:0,5,dt);
      root.position.y=Math.abs(Math.sin(t*2.2))*.12*(1+st.act*1.6);
      headJ.rotation.y=Math.sin(t*.9)*.25 + st.act*Math.sin(t*6)*.15;
      headJ.rotation.z=Math.sin(t*1.3)*.05;
      E.update(dt,st.act>.5?-.05:.04, .8+st.act*.6);
      mote.material.emissiveIntensity=1.6+Math.sin(t*5)*.5; mote.position.y=Math.sin(t*3)*.06;
      jarLight.intensity=.8+Math.sin(t*5)*.3;
      arms[0].sh.rotation.x=Math.sin(t*1.5)*.1 - st.act*(2.2+Math.sin(t*9)*.6);  // waves
      arms[0].sh.rotation.z=-st.act*.3;
      arms[1].sh.rotation.x=Math.sin(t*1.5+1)*.08 - st.act*.3;
      legs.forEach((l,i)=>l.lg.rotation.x=Math.sin(t*2.2+i*Math.PI)*.1*(1-st.act));
      if(st.act>.6 && Math.random()<.12) spark(worldOf(jar,0,0,0),0xffd24a,new THREE.Vector3((Math.random()-.5)*.8,1,(Math.random()-.5)*.8),1.2,.08,1);
    }};
}

// BRAMBLEWICK, a skittish Verdant forest sprite of The Living
function buildBramblewick(){
  const moss=std(0x5aa83a), mossD=std(0x3a7a28), wood=std(0x5a4632);
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const body=pbox(.85,.8,.7,moss); body.position.y=.7; root.add(body);
  for(let i=0;i<6;i++){ const tuft=pbox(.3,.22,.3,Math.random()<.5?moss:mossD); tuft.position.set((Math.random()-.5)*.8,.45+Math.random()*.45,(Math.random()-.5)*.6); root.add(tuft); }
  for(let i=0;i<5;i++){ const a=i/5*Math.PI-Math.PI/2; const leaf=pbox(.4,.5,.08,mossD); leaf.position.set(Math.sin(a)*.5,.7,-Math.cos(a)*.45-.1); leaf.rotation.y=a; root.add(leaf); }
  const legs=[]; [-1,1].forEach(s=>{ const lg=new THREE.Group(); lg.position.set(s*.25,.35,0); root.add(lg);
    const l=pbox(.12,.4,.12,wood); l.position.y=-.2; lg.add(l); const foot=pbox(.22,.1,.3,wood); foot.position.set(0,-.4,.05); lg.add(foot); legs.push({lg,s}); });
  const headJ=new THREE.Group(); headJ.position.y=1.25; root.add(headJ);
  headJ.add(pbox(.7,.6,.6,mossD));
  const E=eyeRig(headJ,{col:0xbaff7a,x:.18,y:.05,z:.32,w:.13,h:.16,lidCol:0x3a7a28,lidY:.22,baseRGB:[.73,1,.48]});
  const ears=[]; [-1,1].forEach(s=>{ const a0=new THREE.Group(); a0.position.set(s*.3,.35,0); a0.rotation.z=-s*.5; headJ.add(a0);
    const b=pbox(.08,.4,.08,wood); b.position.y=.2; a0.add(b); const lf=pbox(.2,.16,.06,moss); lf.position.y=.42; a0.add(lf); ears.push({a0,base:a0.rotation.z,s}); });
  const arms=[]; [-1,1].forEach(s=>{ const sh=new THREE.Group(); sh.position.set(s*.5,.95,0); root.add(sh);
    const a=pbox(.14,.4,.14,wood); a.position.y=-.2; sh.add(a); arms.push({sh,s}); });
  addOutlines(g);
  const st={act:0,look:0,lookT:0,lookE:0};
  return {group:g, scale:.9, accent:0x6ad055,
    anim(t,state,dt){
      ease(st,'act',state!=='idle'?1:0,4,dt);
      st.lookT-=dt; if(st.lookT<=0){ st.look=(Math.random()-.5)*1.3; st.lookT=.5+Math.random()*1.4; }
      ease(st,'lookE',st.look,9,dt);
      headJ.rotation.y=st.lookE;
      headJ.rotation.x=Math.sin(t*1.5)*.04 - st.act*.22;     // bows on greet
      const breath=Math.sin(t*2)*.04;
      root.position.y=breath + Math.abs(Math.sin(t*3))*.03;
      body.scale.set(1+breath*.2,1,1+breath*.2);
      E.update(dt,.0,.85+st.act*.5);
      ears.forEach(e=>e.a0.rotation.z=e.base+Math.sin(t*3+e.s)*.12);
      arms.forEach((a,i)=>{ a.sh.rotation.x=Math.sin(t*2+i)*.15 - st.act*(1.6+Math.sin(t*8)*.4); a.sh.rotation.z=a.s*st.act*.4; });
      legs.forEach((l,i)=>l.lg.rotation.x=Math.sin(t*3+i*Math.PI)*.08*st.act);
      if(st.act>.6 && Math.random()<.1) spark(worldOf(headJ,(Math.random()-.5),.3,.3),0xcaff8a,new THREE.Vector3((Math.random()-.5)*.6,.6,(Math.random()-.5)*.6),1.2,.08,1.5);
    }};
}

// FLOE, a three-tailed frost-fox spirit that guides through whiteouts
function buildFloe(){
  const fur=std(0xdfeeff), furD=std(0xbcd4ec), ice=std(0x9fd8ff,{emissive:0x4a8ac0,ei:.4}), noseM=std(0x2a3a4a);
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const fbody=pbox(.6,.55,1.4,fur); fbody.position.y=.7; root.add(fbody);
  const chest=pbox(.66,.6,.5,furD); chest.position.set(0,.7,.5); root.add(chest);
  const legs=[]; [[-1,.55],[1,.55],[-1,-.45],[1,-.45]].forEach(([s,z],i)=>{ const lg=new THREE.Group(); lg.position.set(s*.28,.45,z); root.add(lg);
    const l=pbox(.18,.5,.18,furD); l.position.y=-.25; lg.add(l); const paw=pbox(.2,.14,.26,fur); paw.position.set(0,-.5,.04); lg.add(paw); legs.push({lg,i}); });
  const headJ=new THREE.Group(); headJ.position.set(0,1.0,.75); root.add(headJ);
  headJ.add(pbox(.5,.5,.5,fur));
  const snout=pbox(.3,.26,.4,furD); snout.position.set(0,-.08,.4); headJ.add(snout);
  const nose=pbox(.12,.1,.1,noseM); nose.position.set(0,-.04,.62); headJ.add(nose);
  const ears=[]; [-1,1].forEach(s=>{ const ear=pbox(.18,.34,.1,fur); ear.position.set(s*.22,.4,0); ear.rotation.z=-s*.2; headJ.add(ear);
    const inner=pbox(.1,.2,.04,ice); inner.position.set(s*.22,.38,.05); headJ.add(inner); ears.push({ear,s}); });
  const E=eyeRig(headJ,{col:0x7fdfff,x:.18,y:.08,z:.26,w:.1,h:.12,lidCol:0xbcd4ec,lidY:.22,baseRGB:[.5,.87,1]});
  const tails=[]; [-1,0,1].forEach((o,ti)=>{ const tj=new THREE.Group(); tj.position.set(o*.18,.85,-.7); root.add(tj);
    const segs=[]; let p=tj; for(let i=0;i<3;i++){ const j=new THREE.Group(); j.position.z=i===0?0:-.3; p.add(j);
      const seg=pbox(.26-i*.05,.3-i*.04,.34,i<2?fur:ice); seg.position.z=-.17; j.add(seg); segs.push(j); p=j; } tails.push({segs,ti}); });
  addOutlines(g);
  const st={act:0};
  return {group:g, scale:.9, accent:0xbfe8ff,
    anim(t,state,dt){
      ease(st,'act',state!=='idle'?1:0,4,dt);
      const breath=Math.sin(t*2.2)*.03;
      root.position.y=breath + st.act*Math.abs(Math.sin(t*5))*.13;     // happy hop
      headJ.rotation.y=Math.sin(t*.8)*.18; headJ.rotation.x=Math.sin(t*1.4)*.05 - st.act*.12;
      E.update(dt,.0,.85+st.act*.5);
      ears.forEach(e=>e.ear.rotation.x=Math.sin(t*4+e.s)*.1 - st.act*.2);
      tails.forEach((T,ti)=>{ T.segs.forEach((j,i)=>{ j.rotation.y=Math.sin(t*3+i*.6+ti*1.2)*(.2+i*.1)*(1+st.act); j.rotation.x=-.1-st.act*.3*(i+1); }); });
      legs.forEach(l=>l.lg.rotation.x=Math.sin(t*3+l.i)*.06*st.act);
      if(Math.random()<.04) spark(worldOf(headJ,0,-.05,.6),0xeaf6ff,new THREE.Vector3((Math.random()-.5)*.3,.1,.4),1.4,.06,.3);   // breath mist
      if(st.act>.6 && Math.random()<.1) spark(worldOf(root,(Math.random()-.5),.2,-.7),0xbfe8ff,new THREE.Vector3((Math.random()-.5),.8,-.4),1.2,.08,1.5);
    }};
}

// QUILL, a grumpy-friendly Aquaria tide-pool tinker (hermit crab)
function buildQuill(){
  const shellM=std(0xc97a3a), shellD=std(0x9a5a28), crab=std(0xe05a4a), crabD=std(0xb83a2e), toolM=std(0xc0c8d0,{metal:.5}),
        whiteM=new THREE.MeshBasicMaterial({color:0xffffff}), pupM=new THREE.MeshBasicMaterial({color:0x2a2a2a});
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const shell=new THREE.Group(); shell.position.set(0,1.0,-.2); root.add(shell);
  [[.9,0,0],[.7,.42,.2],[.5,.74,.36],[.34,.96,.46]].forEach(([s,y,z],i)=>{ const b=pbox(s,s,s,i%2?shellD:shellM); b.position.set(0,y,z); b.rotation.y=i*.4; shell.add(b); });
  const body=pbox(.7,.5,.6,crab); body.position.set(0,.5,.3); root.add(body);
  const stalks=[]; [-1,1].forEach(s=>{ const sj=new THREE.Group(); sj.position.set(s*.18,.78,.5); root.add(sj);
    const stalk=pbox(.08,.3,.08,crabD); stalk.position.y=.15; sj.add(stalk);
    const eye=pbox(.16,.16,.16,whiteM); eye.position.y=.34; eye.userData.noOutline=true; sj.add(eye);
    const pup=pbox(.08,.08,.08,pupM); pup.position.set(0,.34,.08); pup.userData.noOutline=true; sj.add(pup); stalks.push({sj,s}); });
  const legs=[]; [-1,1].forEach(s=>{ for(let i=0;i<3;i++){ const lg=new THREE.Group(); lg.position.set(s*.3,.3,.4-i*.25); root.add(lg);
    const l=pbox(.08,.3,.08,crabD); l.position.y=-.15; l.rotation.z=s*.6; lg.add(l); legs.push({lg,s,i}); } });
  const claws=[]; [-1,1].forEach(s=>{ const sh=new THREE.Group(); sh.position.set(s*.45,.5,.45); root.add(sh);
    const arm=pbox(.16,.16,.5,crabD); arm.position.z=.25; sh.add(arm);
    const cl=new THREE.Group(); cl.position.z=.5; sh.add(cl);
    const big=s>0?1.5:1; const top=pbox(.3*big,.16,.4*big,crab); top.position.y=.1; cl.add(top); const bot=pbox(.3*big,.16,.4*big,crab); bot.position.y=-.1; cl.add(bot);
    claws.push({sh,cl,top,bot,s}); });
  const tool=pbox(.1,.5,.1,toolM); tool.position.set(0,0,.3); claws[1].cl.add(tool);
  addOutlines(g);
  const st={act:0};
  return {group:g, scale:.9, accent:0x6fe3ff,
    anim(t,state,dt){
      ease(st,'act',state!=='idle'?1:0,4,dt);
      root.position.y=Math.sin(t*2)*.04;
      shell.rotation.z=Math.sin(t*1.2)*.03;
      stalks.forEach(s=>{ s.sj.rotation.z=Math.sin(t*2.5+s.s)*.12; s.sj.rotation.x=Math.sin(t*1.7)*.1 - st.act*.25; });
      claws[0].top.rotation.z=-.2-Math.abs(Math.sin(t*5))*.3; claws[0].bot.rotation.z=.2+Math.abs(Math.sin(t*5))*.3;  // tinker taps
      claws[1].sh.rotation.x=-st.act*(1.0+Math.sin(t*4)*.2);                                                          // raises claw to greet
      claws[1].top.rotation.z=-.15-st.act*.25-Math.abs(Math.sin(t*6))*.15*st.act;
      claws[1].bot.rotation.z=.15+st.act*.25+Math.abs(Math.sin(t*6))*.15*st.act;
      legs.forEach(l=>l.lg.rotation.x=Math.sin(t*4+l.i+l.s)*.12);
      if(Math.random()<.05) spark(worldOf(shell,(Math.random()-.5)*.6,.5,0),0xbfe8ff,new THREE.Vector3((Math.random()-.5)*.2,.7,(Math.random()-.5)*.2),1.8,.05,-.2);  // bubbles
    }};
}

// TINDER, a cinder-hound pup that imprinted on you before it could be hollowed
function buildTinder(){
  const furM=std(0x4a2a1a), furD=std(0x35201a), ember=std(0xff7a2c,{emissive:0xc03a00,ei:1.4}), tongueM=std(0xff6a8a);
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const body=pbox(.7,.6,1.1,furM); body.position.y=.7; root.add(body);
  for(let i=0;i<5;i++){ const cr=pbox(.16,.1,.16,ember); cr.position.set((Math.random()-.5)*.5,.92+Math.random()*.2,(Math.random()-.5)*.8); cr.userData.noOutline=true; root.add(cr); }
  const glow=new THREE.PointLight(0xff7a2c,.8,6); glow.position.set(0,1.0,0); root.add(glow);
  const legs=[]; [[-1,.4],[1,.4],[-1,-.35],[1,-.35]].forEach(([s,z],i)=>{ const lg=new THREE.Group(); lg.position.set(s*.26,.45,z); root.add(lg);
    const l=pbox(.2,.5,.2,furD); l.position.y=-.25; lg.add(l); const paw=pbox(.22,.14,.26,furM); paw.position.set(0,-.5,.04); lg.add(paw); legs.push({lg,i}); });
  const headJ=new THREE.Group(); headJ.position.set(0,1.05,.62); root.add(headJ);
  headJ.add(pbox(.6,.56,.56,furM));
  const snout=pbox(.36,.3,.34,furD); snout.position.set(0,-.1,.36); headJ.add(snout);
  const tongue=pbox(.16,.06,.2,tongueM); tongue.position.set(0,-.24,.46); headJ.add(tongue);
  const ears=[]; [-1,1].forEach(s=>{ const ear=pbox(.16,.3,.08,furD); ear.position.set(s*.26,.3,0); ear.rotation.z=s*.3; headJ.add(ear); ears.push({ear,s}); });
  const E=eyeRig(headJ,{col:0xffd24a,x:.18,y:.06,z:.3,w:.12,h:.14,lidCol:0x35201a,lidY:.22,baseRGB:[1,.82,.29]});
  const tailJ=new THREE.Group(); tailJ.position.set(0,.9,-.6); root.add(tailJ);
  const tail=pbox(.18,.18,.6,furM); tail.position.z=-.3; tailJ.add(tail);
  addOutlines(g);
  const st={act:0};
  return {group:g, scale:.85, accent:0xff7a2c,
    anim(t,state,dt){
      ease(st,'act',state!=='idle'?1:0,5,dt);
      const pant=Math.sin(t*8)*.5+.5;
      root.position.y=Math.sin(t*2)*.03 + st.act*Math.abs(Math.sin(t*6))*.18;
      root.rotation.x=st.act*.25*Math.abs(Math.sin(t*3));   // play-bow
      headJ.rotation.y=Math.sin(t*1.2)*.2; headJ.rotation.x=Math.sin(t*1.6)*.06+st.act*.1;
      E.update(dt,.0,.85+st.act*.5);
      tongue.position.y=-.24-pant*.05; tongue.scale.y=1+pant*.4;
      tailJ.rotation.y=Math.sin(t*(8+st.act*8))*.5*(1+st.act);   // wags faster when greeting
      ears.forEach(e=>e.ear.rotation.x=Math.sin(t*5+e.s)*.12-st.act*.2);
      legs.forEach(l=>l.lg.rotation.x=Math.sin(t*3+l.i)*.05*st.act);
      if(Math.random()<.05) spark(worldOf(root,(Math.random()-.5)*.6,.9,(Math.random()-.5)*.8),0xff9a4a,new THREE.Vector3((Math.random()-.5)*.3,.6,(Math.random()-.5)*.3),1.2,.06,1);
      if(st.act>.6 && Math.random()<.12) spark(worldOf(legs[0].lg,0,-.55,.1),0xff7a2c,new THREE.Vector3(0,.3,0),1.0,.12,2);   // flame pawprint
    }};
}

/* =========================================================
   THE HUSHED, enemies hollowed by the Hush (+ a rogue Ancient)
   ========================================================= */

// HUSHLING, the grunt: a small hollow biped, void where its Hum-core was
function buildHushling(){
  const ash=std(0x4a4858), ashD=std(0x35333f), voidM=std(0x0a0812), rimM=std(0x6a4a8a,{emissive:0x3a2a5a,ei:1.2});
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const torso=pbox(.8,1.0,.5,ash); torso.position.y=1.4; root.add(torso);
  const vd=pbox(.42,.5,.3,voidM); vd.position.set(0,1.5,.18); vd.userData.noOutline=true; root.add(vd);
  const rim=pbox(.5,.58,.14,rimM); rim.position.set(0,1.5,.1); rim.userData.noOutline=true; root.add(rim);
  const headJ=new THREE.Group(); headJ.position.y=2.1; root.add(headJ);
  headJ.add(pbox(.6,.6,.55,ashD));
  const E=eyeRig(headJ,{col:0x8a6aca,x:.15,y:.0,z:.3,w:.08,h:.1,lidCol:0x35333f,lidY:.18,baseRGB:[.54,.42,.79]});
  const arms=[]; [-1,1].forEach(s=>{ const sh=new THREE.Group(); sh.position.set(s*.5,1.8,0); root.add(sh);
    const a=pbox(.18,.9,.18,ashD); a.position.y=-.45; sh.add(a); const hand=pbox(.2,.2,.2,ash); hand.position.y=-.9; sh.add(hand); arms.push({sh,s}); });
  const legs=[]; [-1,1].forEach(s=>{ const lg=new THREE.Group(); lg.position.set(s*.22,.9,0); root.add(lg);
    const l=pbox(.22,.9,.22,ashD); l.position.y=-.45; lg.add(l); legs.push({lg,s}); });
  addOutlines(g);
  const st={act:0,jit:0,jitT:0,jitE:0};
  return {group:g, scale:.85, accent:0x6a4a8a,
    anim(t,state,dt){
      ease(st,'act',state!=='idle'?1:0,6,dt);
      st.jitT-=dt; if(st.jitT<=0){ st.jit=(Math.random()-.5); st.jitT=.16+Math.random()*.3; }   // stutter
      ease(st,'jitE',st.jit,22,dt);
      root.position.y=Math.abs(st.jitE)*.05;
      headJ.rotation.y=st.jitE*1.2; headJ.rotation.z=st.jitE*.3;
      torso.rotation.x=0;
      if(st.act>.4){ headJ.getWorldPosition(_v2); const dx=camera.position.x-_v2.x,dz=camera.position.z-_v2.z;
        headJ.rotation.y=Math.atan2(dx,dz); torso.rotation.x=st.act*.2; }                          // snaps toward you
      E.update(dt,.0,.6+st.act*1.3);
      vd.scale.setScalar(1+Math.sin(t*4)*.05+st.act*.2);
      rim.material.emissiveIntensity=1.0+Math.sin(t*5)*.3+st.act*2.2;
      arms.forEach(a=>{ a.sh.rotation.x=st.jitE*.5 - st.act*.6; a.sh.rotation.z=a.s*.1+st.jitE*.2; });
      legs.forEach(l=>l.lg.rotation.x=st.jitE*.2);
      if(st.act>.5 && Math.random()<.1) spark(worldOf(rim,0,0,.1),0x6a4a8a,new THREE.Vector3((Math.random()-.5)*.5,.3,(Math.random()-.5)*.5),1.2,.08,2);
    }};
}

// HUSK, a hollowed former-villager, slow and reaching and mournful
function buildHusk(){
  const ash=std(0x7a7a86), ashD=std(0x5a5a66), cloak=std(0x44424e), voidM=std(0x0a0812);
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const torso=pbox(.9,1.2,.55,ash); torso.position.y=1.5; root.add(torso);
  const vd=pbox(.4,.5,.3,voidM); vd.position.set(0,1.6,.2); vd.userData.noOutline=true; root.add(vd);
  for(let i=0;i<5;i++){ const t2=pbox(.3,.7+Math.random()*.4,.1,cloak); t2.position.set(-.5+i*.25,1.1,-.3); root.add(t2); }
  const headJ=new THREE.Group(); headJ.position.y=2.25; root.add(headJ);
  headJ.add(pbox(.55,.62,.55,ashD));
  const E=eyeRig(headJ,{col:0x9a9aca,x:.14,y:-.02,z:.28,w:.07,h:.13,lidCol:0x5a5a66,lidY:.18,baseRGB:[.6,.6,.79]});
  const arms=[]; [-1,1].forEach(s=>{ const sh=new THREE.Group(); sh.position.set(s*.55,2.05,0); root.add(sh);
    const a=pbox(.2,1.1,.2,ashD); a.position.y=-.55; sh.add(a); const hand=pbox(.22,.24,.22,ash); hand.position.y=-1.1; sh.add(hand); arms.push({sh,s}); });
  const legs=[]; [-1,1].forEach(s=>{ const lg=new THREE.Group(); lg.position.set(s*.25,1.0,0); root.add(lg);
    const l=pbox(.26,1.0,.26,ashD); l.position.y=-.5; lg.add(l); legs.push({lg,s}); });
  addOutlines(g);
  const st={act:0,fy:0};
  return {group:g, scale:.9, accent:0x8a8a96,
    anim(t,state,dt){
      ease(st,'act',state!=='idle'?1:0,2.5,dt);
      root.rotation.z=Math.sin(t*.9)*.05*(1-st.act*.5);
      root.position.y=Math.sin(t*.7)*.03;
      torso.rotation.x=.12 - st.act*.12;
      headJ.rotation.x=.25 - st.act*.42 + Math.sin(t*.8)*.05;     // droops, lifts when alert
      headJ.rotation.y=Math.sin(t*.5)*.2*(1-st.act);
      if(st.act>.4){ headJ.getWorldPosition(_v2); const dx=camera.position.x-_v2.x,dz=camera.position.z-_v2.z; ease(st,'fy',Math.atan2(dx,dz),4,dt); headJ.rotation.y=st.fy; }
      E.update(dt,.2-st.act*.2,.4+st.act*.8);
      vd.scale.setScalar(1+Math.sin(t*2)*.06);
      arms.forEach(a=>{ a.sh.rotation.x=-.3-Math.sin(t*.8+a.s)*.15 - st.act*1.0; a.sh.rotation.z=a.s*(.15-st.act*.1); });  // reaches
      legs.forEach(l=>l.lg.rotation.x=Math.sin(t*.6+l.s)*.03);
      if(Math.random()<.03) spark(worldOf(torso,(Math.random()-.5)*.8,(Math.random()-.5),0),0x6a6a76,new THREE.Vector3((Math.random()-.5)*.2,-.2,(Math.random()-.5)*.2),2.5,.06,.4);  // ash
      if(st.act>.6 && Math.random()<.08) spark(worldOf(vd,0,0,.1),0x2a1a3a,new THREE.Vector3((Math.random()-.5)*.4,.2,(Math.random()-.5)*.4),1.5,.1,1);
    }};
}

// MUTE, a flying Hush-spreader, a silence-moth that smothers the Hum
function buildMute(){
  const shroud=std(0x3a3450,{transparent:true,opacity:.92}), wingM=std(0x2a2640,{transparent:true,opacity:.85}),
        voidM=std(0x080610), rimM=std(0x6a4a9a,{emissive:0x3a2a6a,ei:1.4}), headM=std(0x2a2640);
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const core=pbox(.4,.6,.3,voidM); core.position.y=2.0; core.userData.noOutline=true; root.add(core);
  const rim=pbox(.5,.7,.16,rimM); rim.position.set(0,2.0,.12); rim.userData.noOutline=true; root.add(rim);
  for(let i=0;i<4;i++){ const sh=pbox(.5-i*.08,.5,.4-i*.06,shroud); sh.position.y=1.7-i*.4; root.add(sh); }
  for(let i=0;i<3;i++){ const tt=pbox(.18,.6,.1,shroud); tt.position.set((i-1)*.18,.7,0); root.add(tt); }
  const wings=[]; [-1,1].forEach(s=>{ const wj=new THREE.Group(); wj.position.set(s*.3,2.0,0); root.add(wj);
    const upper=pbox(1.4,1.0,.06,wingM); upper.position.set(s*.7,.2,0); wj.add(upper);
    const lower=pbox(1.0,.8,.06,wingM); lower.position.set(s*.55,-.6,0); wj.add(lower);
    const spot=pbox(.3,.3,.08,rimM); spot.position.set(s*.7,.2,.05); spot.userData.noOutline=true; wj.add(spot);
    wings.push({wj,s}); });
  const headJ=new THREE.Group(); headJ.position.y=2.5; root.add(headJ);
  headJ.add(pbox(.36,.34,.34,headM));
  const E=eyeRig(headJ,{col:0x8a6aca,x:.1,y:.0,z:.2,w:.06,h:.06,lidCol:0x2a2640,lidY:.13,baseRGB:[.54,.42,.79]});
  addOutlines(g);
  const st={act:0};
  return {group:g, scale:.9, accent:0x4a3a6a, airborne:true,
    anim(t,state,dt){
      ease(st,'act',state!=='idle'?1:0,4,dt);
      const flap=Math.sin(t*(4+st.act*4));
      root.position.y=Math.sin(t*1.5)*.18; root.rotation.z=Math.sin(t*1.1)*.05; root.rotation.x=st.act*.3;
      wings.forEach(w=>{ w.wj.rotation.y=w.s*(.3+flap*.6+st.act*.4); });
      headJ.rotation.y=Math.sin(t*.7)*.2;
      if(st.act>.4){ headJ.getWorldPosition(_v2); const dx=camera.position.x-_v2.x,dz=camera.position.z-_v2.z; headJ.rotation.y=Math.atan2(dx,dz); }
      E.update(dt,.0,.6+st.act);
      rim.material.emissiveIntensity=1.2+Math.sin(t*4)*.3+st.act*1.6;
      if(Math.random()<(.04+st.act*.12)) spark(worldOf(core,(Math.random()-.5)*.6,(Math.random()-.5)*.6,0),0x3a2a5a,new THREE.Vector3((Math.random()-.5)*.8,(Math.random()-.5)*.4,(Math.random()-.5)*.8),2.0,.1,.2);
    }};
}

// GNASH, a hollowed predator, ribcage cracked open onto the dark
function buildGnash(){
  const furM=std(0x3a2a32), furD=std(0x2a1e26), voidM=std(0x0a0610), boneM=std(0xd8ccc0), corrupt=std(0x7a2a4a,{emissive:0x4a1020,ei:1});
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const body=pbox(.7,.6,1.5,furM); body.position.y=.9; root.add(body);
  const vd=pbox(.5,.5,.7,voidM); vd.position.set(0,.95,.2); vd.userData.noOutline=true; root.add(vd);
  for(let i=0;i<4;i++){ const rib=pbox(.66,.1,.1,boneM); rib.position.set(0,.7+i*.16,.5-i*.18); root.add(rib); }
  for(let i=0;i<5;i++){ const sp=pbox(.08,.3,.12,furD); sp.position.set(0,1.3,.6-i*.3); root.add(sp); }
  const legs=[]; [[-1,.55],[1,.55],[-1,-.5],[1,-.5]].forEach(([s,z],i)=>{ const lg=new THREE.Group(); lg.position.set(s*.3,.6,z); root.add(lg);
    const l=pbox(.18,.7,.18,furD); l.position.y=-.35; lg.add(l); const paw=pbox(.22,.14,.3,furM); paw.position.set(0,-.7,.06); lg.add(paw); legs.push({lg,i}); });
  const headJ=new THREE.Group(); headJ.position.set(0,1.15,.85); root.add(headJ);
  headJ.add(pbox(.5,.46,.6,furM));
  const jaw=new THREE.Group(); jaw.position.set(0,-.2,.2); headJ.add(jaw);
  const jawB=pbox(.42,.18,.5,furD); jawB.position.z=.18; jaw.add(jawB);
  for(let i=0;i<4;i++){ const f=pbox(.06,.16,.06,boneM); f.position.set(-.15+i*.1,-.05,.5); headJ.add(f); const f2=pbox(.06,.14,.06,boneM); f2.position.set(-.15+i*.1,.0,.4); jaw.add(f2); }
  const E=eyeRig(headJ,{col:0xff3a4a,x:.18,y:.12,z:.24,w:.1,h:.08,lidCol:0x2a1e26,lidY:.26,baseRGB:[1,.23,.29]});
  const tailJ=new THREE.Group(); tailJ.position.set(0,1.0,-.75); root.add(tailJ);
  const segs=[]; let p=tailJ; for(let i=0;i<3;i++){ const j=new THREE.Group(); j.position.z=i===0?0:-.35; p.add(j); const seg=pbox(.16-i*.03,.16-i*.03,.4,furD); seg.position.z=-.2; j.add(seg); segs.push(j); p=j; }
  addOutlines(g);
  const st={act:0};
  return {group:g, scale:.9, accent:0x7a2a4a,
    anim(t,state,dt){
      ease(st,'act',state!=='idle'?1:0,5,dt);
      root.position.y=Math.sin(t*4)*.03;
      root.rotation.x=st.act*.12;
      body.position.y=.9 - st.act*.15;                  // lowers into a lunge crouch
      headJ.rotation.y=Math.sin(t*2)*.2*(1-st.act);
      headJ.rotation.x=.1 - st.act*.25;
      if(st.act>.4){ headJ.getWorldPosition(_v2); const dx=camera.position.x-_v2.x,dz=camera.position.z-_v2.z; headJ.rotation.y=Math.atan2(dx,dz)*.8; }
      jaw.rotation.x=st.act*(.5+Math.abs(Math.sin(t*5))*.2);   // snarl
      E.update(dt,.0,.8+st.act*1.2);
      vd.scale.setScalar(1+Math.sin(t*5)*.06+st.act*.15);
      segs.forEach((j,i)=>{ j.rotation.y=Math.sin(t*3+i*.6)*(.2+i*.1); j.rotation.x=-.1+st.act*.2; });
      legs.forEach(l=>l.lg.rotation.x=Math.sin(t*4+l.i)*.05);
      if(st.act>.5 && Math.random()<.14) spark(worldOf(jaw,0,-.05,.5),0x7a2a4a,new THREE.Vector3((Math.random()-.5)*.4,-.2,.4),1.0,.08,2);   // dark drool
    }};
}

// RIFTLING, a torn, glitching thing born at a Hush-tear
function buildRiftling(){
  const voidM=std(0x080410), riftM=std(0xb14aff,{emissive:0x8a2aff,ei:2});
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const core=pbox(.4,.4,.4,voidM); core.position.y=1.4; core.userData.noOutline=true; root.add(core);
  const seam=pbox(.5,.5,.16,riftM); seam.position.y=1.4; seam.userData.noOutline=true; root.add(seam);
  const light=new THREE.PointLight(0xb14aff,1.2,7); light.position.y=1.4; root.add(light);
  const frags=[]; for(let i=0;i<10;i++){ const sz=.2+Math.random()*.3; const fm=std(0x6a3a7a,{emissive:0x4a1a6a,ei:.8,transparent:true,opacity:.9}); const fr=pbox(sz,sz,sz,fm);
    fr.userData={a:Math.random()*Math.PI*2,rad:.6+Math.random()*.7,yy:.7+Math.random()*1.4,sp:.3+Math.random()*.6,jit:Math.random()*6.28,mat:fm}; root.add(fr); frags.push(fr); }
  addOutlines(g);
  const st={act:0};
  return {group:g, scale:.9, accent:0xb14aff, airborne:true,
    anim(t,state,dt){
      ease(st,'act',state!=='idle'?1:0,6,dt);
      root.position.y=Math.sin(t*1.7)*.12;
      core.rotation.y+=dt*2; core.rotation.x+=dt*1.3;
      seam.material.emissiveIntensity=1.5+Math.sin(t*8)*.8; seam.rotation.y=t*3; seam.scale.setScalar(1+Math.sin(t*10)*.1+st.act*.4);
      const spread=1+st.act*1.6+Math.sin(t*12)*st.act*.5;
      frags.forEach(fr=>{ const u=fr.userData; u.a+=dt*u.sp*(1+st.act);
        const r=u.rad*spread, jx=Math.sin(t*9+u.jit)*.1*(1+st.act*3);
        fr.position.set(Math.cos(u.a)*r+jx,u.yy+Math.sin(t*3+u.jit)*.15,Math.sin(u.a)*r+jx);
        fr.rotation.x+=dt*2; fr.rotation.y+=dt*1.5;
        u.mat.opacity=.5+Math.abs(Math.sin(t*14+u.jit))*.5; });
      light.intensity=1.0+Math.sin(t*16)*.6+st.act*1.6;
      if(Math.random()<(.05+st.act*.15)) spark(worldOf(core,0,0,0),0xb14aff,new THREE.Vector3((Math.random()-.5)*1.2,(Math.random()-.5)*1.2,(Math.random()-.5)*1.2),.8,.1,0);
    }};
}

// SENTINEL, a malfunctioning Ancient drone. Not Hushed. Still hostile.
function buildSentinel(){
  const hullM=std(0x4a5a64,{metal:.4}), hullD=std(0x35424a,{metal:.4}), trimM=std(0x6fe3ff,{emissive:0x2a8aa0,ei:1});
  const g=new THREE.Group(); const root=new THREE.Group(); g.add(root);
  const hub=new THREE.Group(); hub.position.y=2.2; root.add(hub);
  const top=pbox(.9,.7,.9,hullM); top.position.y=.5; top.rotation.y=.785; hub.add(top);
  const mid=pbox(1.3,.5,1.3,hullD); mid.rotation.y=.785; hub.add(mid);
  const bot=pbox(.9,.7,.9,hullM); bot.position.y=-.5; bot.rotation.y=.785; hub.add(bot);
  const ring=new THREE.Group(); hub.add(ring);
  for(let i=0;i<6;i++){ const a=i/6*Math.PI*2; const seg=pbox(.3,.1,.14,trimM); seg.position.set(Math.cos(a)*1.0,0,Math.sin(a)*1.0); seg.rotation.y=-a; ring.add(seg); }
  const eyeJ=new THREE.Group(); eyeJ.position.set(0,0,.7); hub.add(eyeJ);
  eyeJ.add(pbox(.5,.5,.2,hullD));
  const lensMat=new THREE.MeshBasicMaterial({color:0x6fe3ff}); const lens=pbox(.3,.3,.12,lensMat); lens.position.z=.12; lens.userData.noOutline=true; eyeJ.add(lens);
  const eyeLight=new THREE.PointLight(0x6fe3ff,1.2,8); eyeLight.position.z=.3; eyeJ.add(eyeLight);
  addOutlines(g);
  const st={act:0,glitchT:0,gx:0,gxE:0};
  return {group:g, scale:.9, accent:0x6fe3ff, airborne:true,
    anim(t,state,dt){
      ease(st,'act',state!=='idle'?1:0,4,dt);
      hub.position.y=2.2+Math.sin(t*1.3)*.12;
      ring.rotation.y=t*(1+st.act*2); ring.rotation.x=Math.sin(t*.7)*.2;
      st.glitchT-=dt; if(st.glitchT<=0){ st.gx=(Math.random()-.5)*(.1+st.act*.4); st.glitchT=.3+Math.random()*.6; }
      ease(st,'gxE',st.gx,25,dt); hub.rotation.z=st.gxE; hub.rotation.x=st.gxE*.5;
      hub.getWorldPosition(_v2); const dx=camera.position.x-_v2.x, dy=camera.position.y-_v2.y, dz=camera.position.z-_v2.z;
      eyeJ.rotation.y=Math.atan2(dx,dz); eyeJ.rotation.x=-Math.atan2(dy,Math.hypot(dx,dz));   // eye tracks you
      const red=st.act;
      lensMat.color.setRGB(.43+red*.55,.89-red*.7,1.0-red*.78);
      eyeLight.color.copy(lensMat.color); eyeLight.intensity=1.0+Math.sin(t*4)*.3+st.act*2.6;
      lens.scale.setScalar(1+Math.sin(t*6)*.08 - st.act*.25);     // iris narrows on lock
      hub.scale.setScalar(1 - st.act*.05);
      if(st.act>.5 && Math.random()<.12) spark(worldOf(eyeJ,0,0,.3),0xff3a3a,new THREE.Vector3((Math.random()-.5)*.3,(Math.random()-.5)*.3,1),.7,.08,0);
    }};
}

/* ========================= REGISTRY ========================= */
const CAST=[
  // ---- THE KINDLED ----
  { id:'lumen', name:'Lumen', role:'Friend', faction:'The Ancients', biome:'Waystation', accent:0x7fe8d0,
    trait:'Keeper · Mentor', build:buildLumen,
    desc:"The last Ancient construct still awake, tending the Waystation flame between worlds. It speaks slow, in long pauses, and it has been waiting a very long time for someone who can hear the Hum.",
    lore:"It does not remember building the worlds. It remembers being asked to keep a light on." },
  { id:'pip', name:'Pip', role:'Friend', faction:'The Living', biome:'Verdant', accent:0xffd24a,
    trait:'Companion · Kindler', build:buildPip,
    desc:"Another child who hears the Hum, a half-step braver than is wise. Carries a jar with a caught spark of Aether and a hundred questions. Your first friend, and the one who will not leave.",
    lore:"Pip caught the spark on a dare. Now it is the only light for miles, and Pip will not put it down." },
  { id:'bram', name:'Bramblewick', role:'Friend', faction:'The Living', biome:'Verdant', accent:0x6ad055,
    trait:'Grove sprite', build:buildBramblewick,
    desc:"A shy knot of moss and twig that tends the deep groves under the Grovekeeper's watch. Bolts at loud sounds, returns for kindness, and knows every hidden path through the Verdant.",
    lore:"Leave a berry on a stump. In the morning the path you needed will be cleared." },
  { id:'floe', name:'Floe', role:'Friend', faction:'The Living', biome:'Frostpeak', accent:0xbfe8ff,
    trait:'Frost-fox guide', build:buildFloe,
    desc:"A three-tailed fox-spirit of breath and ice, the only thing that moves surely through a Frostpeak whiteout. It cannot abide the Hush, and flinches from silence the way other things flinch from fire.",
    lore:"Follow the three tails. Where they fan, the snow is thin and the way is true." },
  { id:'quill', name:'Quill', role:'Friend', faction:'The Living', biome:'Aquaria', accent:0x6fe3ff,
    trait:'Tide-pool tinker', build:buildQuill,
    desc:"A hermit crab in a borrowed shell and a worse mood, but the finest tinker in the tide-pools. Trades shells, mends gear, and grumbles the whole time. Mention the Tidemother and the grumbling stops.",
    lore:"Bring it something broken and something shiny. It only admits to caring about one of them." },
  { id:'tinder', name:'Tinder', role:'Friend', faction:'The Living', biome:'Ember', accent:0xff7a2c,
    trait:'Cinder-pup', build:buildTinder,
    desc:"A cinder-hound pup that imprinted on you before the Hush could hollow it, as the rest of its litter was hollowed. Warm to the touch, fierce in your defence, and leaves little fading flame-prints where it runs.",
    lore:"Its kin den near the Pyroclast for warmth. This one chose you instead." },
  // ---- THE HUSHED ----
  { id:'hushling', name:'Hushling', role:'Enemy', faction:'The Hushed', biome:'Any', accent:0x6a4a8a,
    trait:'Grunt · swarms', build:buildHushling,
    desc:"The commonest of the Hushed: a small thing emptied of its Hum, leaving a cold void where a heart-spark should be. It moves in stutters and total silence, and it is never, ever alone.",
    lore:"You hear the others first. The Hushling itself makes no sound at all. That is the tell." },
  { id:'husk', name:'Husk', role:'Enemy', faction:'The Hushed', biome:'Any', accent:0x8a8a96,
    trait:'Hollowed villager', build:buildHusk,
    desc:"What is left when the Hush takes someone slowly: a stooped, reaching shape still wearing the rags of who it was. It is not angry. It is looking for the sound it lost, and it thinks you might be it.",
    lore:"The cruelty of the Hush is that the Husk still remembers it had a name. It just cannot find it." },
  { id:'mute', name:'Mute', role:'Enemy', faction:'The Hushed', biome:'Frostpeak', accent:0x4a3a6a,
    trait:'Hush-spreader · flying', build:buildMute,
    desc:"A drifting moth of ash and shadow whose wingbeats smother the Hum from the air itself. Where a Mute passes, song dies, lanterns gutter, and the Hush spreads a little further into a living world.",
    lore:"Cover your ears and it does nothing. Cover the spark in your jar. That is what it is hunting." },
  { id:'gnash', name:'Gnash', role:'Enemy', faction:'The Hushed', biome:'Dustfall', accent:0x7a2a4a,
    trait:'Hollowed predator', build:buildGnash,
    desc:"A hunting beast hollowed mid-stride, its ribcage cracked open onto a hungry dark. Faster than the other Hushed and far more deliberate. It does not stutter. It stalks, and then it does not miss.",
    lore:"The Hushling forgets you exist. Gnash never does." },
  { id:'riftling', name:'Riftling', role:'Enemy', faction:'The Hushed', biome:'Any', accent:0xb14aff,
    trait:'Unstable · rift-born', build:buildRiftling,
    desc:"Not hollowed but torn: a flicker of broken pieces that spills out wherever the Hush rips a seam in a world. It is barely holding together, and it would very much like to take you apart to match.",
    lore:"Where a Riftling drifts, the world behind it is already coming undone. Do not follow it home." },
  { id:'sentinel', name:'Sentinel', role:'Enemy', faction:'The Ancients', biome:'Any', accent:0x6fe3ff,
    trait:'Rogue Ancient drone', build:buildSentinel,
    desc:"An Ancient watcher-drone left running long after its makers spent themselves into the Hum. Its orders are corrupted, its single eye still scans, and it now reads every living thing, you included, as an intruder to log and remove.",
    lore:"It is not Hushed. It is doing exactly what it was built to do. No one is left to tell it to stop." },
];

  function build(id){ const e=CAST.find(c=>c.id===id); if(!e) throw new Error('unknown character: '+id);
    const o=e.build(); o.meta=e; o.id=id; return o; }
  function spawn(id){ const o=build(id); scene.add(o.group); return o; }
  function step(dt){ stepFx(dt); }
  return { CAST, build, spawn, step, setCamera:c=>{ camera=c; } };
}
if(typeof module!=='undefined' && module.exports) module.exports={ createCastKit };
