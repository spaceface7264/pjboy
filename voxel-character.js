/**
 * Procedural voxel character builder + rig animation.
 */
(function () {
  'use strict';
  if (typeof THREE === 'undefined') { console.error('[voxel-character] THREE not loaded'); return; }


/* =========================================================
   VOXEL CHARACTER CREATOR + RIG TEST
   - character built from boxes in a joint hierarchy (groups)
   - procedural animation states, smoothly blended
   ========================================================= */

// ---------- data ----------
const CLASSES = [
  { id:'miner',    icon:'⛏', name:'Miner',
    desc:'The miner has bonuses for mining speed and the chance to obtain more raw materials from all resources, both on planet and in space.',
    accent:0xe8b33b, weapon:'minecutter' },
  { id:'soldier',  icon:'⚔', name:'Soldier',
    desc:'The soldier deals increased damage and takes less damage in combat. Starts with a standard-issue blaster rifle.',
    accent:0xd4453a, weapon:'blaster' },
  { id:'engineer', icon:'🔧', name:'Engineer',
    desc:'The engineer builds and repairs structures faster and crafts advanced components at reduced cost.',
    accent:0x6fe3ff, weapon:'wrench' },
];
const WEAPONS = [
  { id:'pickaxe', name:'Pickaxe',       twoHanded:true,  ranged:false,
    desc:'Dual-headed mining pick with a hardened alloy edge. Bonus yield from ore.',
    stats:{Damage:4, Speed:5, Range:1} },
  { id:'wrench',  name:'Wrench',        twoHanded:false, ranged:false,
    desc:'Heavy torque wrench. Repairs structures and loosens stubborn bolts alike.',
    stats:{Damage:3, Speed:6, Range:1} },
  { id:'sword',   name:'Energy Sword',  twoHanded:false, ranged:false,
    desc:'Magnetically contained plasma edge. Ignores conventional armor.',
    stats:{Damage:8, Speed:7, Range:2} },
  { id:'blaster', name:'Blaster Rifle', twoHanded:true,  ranged:true,
    desc:'Reliable kinetic carbine. Standard issue across the colonies.',
    stats:{Damage:5, Speed:6, Range:6} },
  { id:'laser',   name:'Laser Rifle',   twoHanded:true,  ranged:true,
    desc:'Focused beam emitter with active cooling fins. Pinpoint accuracy.',
    stats:{Damage:6, Speed:8, Range:9} },
  { id:'minecutter', name:'Laser Handgun', twoHanded:false, ranged:true,
    desc:'Pocket-sized mining cutter. Hold fire to carve blocks at close range.',
    stats:{Damage:2, Speed:8, Range:4} },
  { id:'plasma',  name:'Plasma Pistol', twoHanded:false, ranged:true,
    desc:'Compact sidearm that lobs superheated bolts from a containment coil.',
    stats:{Damage:4, Speed:7, Range:4} },
  { id:'railgun', name:'Railgun',       twoHanded:true,  ranged:true,
    desc:'Magnetic accelerator with a visible capacitor bank. Punches through anything.',
    stats:{Damage:10, Speed:2, Range:10} },
  { id:'detonator', name:'Remote Detonator', twoHanded:false, ranged:false,
    desc:'A handheld trigger. Fire to set off every TNT charge you have placed.',
    stats:{Damage:0, Speed:6, Range:0} },
];
const weaponIdx = id => WEAPONS.findIndex(w=>w.id===id);
const BODY_TYPES = ['Male','Female'];
const HEAD_DECOS = ['Bald','Short','Mohawk','Long','Helmet','Curly'];
const HAIR_COLORS = [0xf2f2f2,0x1c1c1f,0x6b4a2f,0xd9b65c,0xd42a1e,0xf06ad8];
const GEAR_COLORS = [0xf2f4f7,0x23262e,0x2c8c94,0xe05ad2,0x4f8fe8,0xe8b33b];
const SKIN_TONES  = [0xe8b08e,0xd49066,0xa86b46,0x6e4630];

const DEFAULT_PARAMS = { classIdx:0, body:0, deco:1, hair:0, gear:0, skin:0, weapon:0 };
const SAVE_KEY = 'pjboy.voxelChar.v1';

// ---------- canvas textures ----------
function hx(h){ return '#'+h.toString(16).padStart(6,'0'); }
// eye sockets (the white area) — iris/pupil/highlight ride inside these, offset by gaze
const EYE_L = { x:24, y:52, w:26, h:22 };
const EYE_R = { x:78, y:52, w:26, h:22 };
// redraw both eyes with the pupils offset toward (gx,gy) ∈ [-1,1]; clipped to the sockets
function drawEyes(x, gx, gy){
  const dx = Math.round(THREE.MathUtils.clamp(gx, -1, 1) * 5);
  const dy = Math.round(THREE.MathUtils.clamp(gy, -1, 1) * 4);
  [EYE_L, EYE_R].forEach(e => {
    x.save();
    x.beginPath(); x.rect(e.x, e.y, e.w, e.h); x.clip();
    x.fillStyle='#ffffff'; x.fillRect(e.x, e.y, e.w, e.h);                    // white
    const ix = e.x + 8 + dx, iy = e.y + 3 + dy;
    x.fillStyle='#2a2d36'; x.fillRect(ix, iy, 14, 18);                        // iris
    x.fillStyle='#101218'; x.fillRect(ix + 3, iy + 4, 8, 10);                // pupil
    x.fillStyle='#ffffff'; x.fillRect(ix + 1, iy + 1, 4, 4);                 // highlight
    x.restore();
  });
}
function faceTexture(skinHex, hairHex){
  const c=document.createElement('canvas'); c.width=c.height=128;
  const x=c.getContext('2d');
  x.fillStyle=hx(skinHex); x.fillRect(0,0,128,128);
  // brows (hair colored, dark fallback for light hair)
  const lum=((hairHex>>16)&255)*.3+((hairHex>>8)&255)*.6+(hairHex&255)*.1;
  x.fillStyle = lum>190? '#3a3a40' : hx(hairHex);
  x.fillRect(22,38,28,7); x.fillRect(78,38,28,7);
  // big chibi eyes (pupils start centered)
  drawEyes(x, 0, 0);
  // nose + mouth
  x.fillStyle='rgba(0,0,0,.14)'; x.fillRect(61,80,6,5);
  x.fillStyle='rgba(0,0,0,.35)'; x.fillRect(56,98,16,5);
  // cheek shading
  x.fillStyle='rgba(220,90,80,.13)'; x.fillRect(16,80,16,9); x.fillRect(96,80,16,9);
  const t=new THREE.CanvasTexture(c); t.magFilter=THREE.NearestFilter; t.minFilter=THREE.NearestFilter;
  t.userData = { ctx: x, gx: 0, gy: 0 };
  return t;
}
// move the painted pupils toward (gx,gy); skips the redraw when gaze is unchanged
function setGaze(char, gx, gy){
  const tex = char && char.faceTex;
  if (!tex || !tex.userData || !tex.userData.ctx) return;
  const ud = tex.userData;
  const ngx = Math.round(THREE.MathUtils.clamp(gx, -1, 1) * 100) / 100;
  const ngy = Math.round(THREE.MathUtils.clamp(gy, -1, 1) * 100) / 100;
  if (ngx === ud.gx && ngy === ud.gy) return;
  ud.gx = ngx; ud.gy = ngy;
  drawEyes(ud.ctx, ngx, ngy);
  tex.needsUpdate = true;
}
// additive head turn + eye gaze, applied after update() so it overlays the idle pose
function lookAt(char, headYaw, headPitch, eyeGx, eyeGy){
  if (char && char.j && char.j.neck) {
    char.j.neck.rotation.y += headYaw || 0;
    char.j.neck.rotation.x += headPitch || 0;
  }
  setGaze(char, eyeGx || 0, eyeGy || 0);
}
function chestTexture(gearHex, accentHex){
  const c=document.createElement('canvas'); c.width=c.height=128;
  const x=c.getContext('2d');
  x.fillStyle=hx(gearHex); x.fillRect(0,0,128,128);
  // big grey undersuit chest panel (two-tone)
  x.fillStyle='#c2c8d2'; x.fillRect(34,10,60,66);
  x.fillStyle='rgba(0,0,0,.25)'; x.fillRect(34,10,60,5);
  x.strokeStyle='rgba(0,0,0,.3)'; x.lineWidth=3; x.strokeRect(34,10,60,66);
  x.fillStyle='rgba(70,120,150,.6)'; x.fillRect(46,24,30,24);        // screen
  x.fillStyle=hx(accentHex); x.fillRect(82,24,8,8); x.fillRect(82,36,8,8);
  // hazard stripes (right shoulder area)
  x.fillStyle='#e8b33b'; x.fillRect(100,12,22,8); x.fillRect(100,24,22,8);
  x.fillStyle='#1c1c1f'; x.fillRect(100,20,22,4);
  // panel seams
  x.strokeStyle='rgba(0,0,0,.18)'; x.lineWidth=3;
  x.strokeRect(8,8,112,80); x.beginPath(); x.moveTo(8,88); x.lineTo(120,88); x.stroke();
  // belt
  x.fillStyle='rgba(0,0,0,.35)'; x.fillRect(0,104,128,16);
  x.fillStyle='#9aa3ad'; x.fillRect(56,106,16,12);                  // buckle
  const t=new THREE.CanvasTexture(c); t.magFilter=THREE.NearestFilter; t.minFilter=THREE.NearestFilter;
  return t;
}
// shade a hex color (f<1 darken, f>1 lighten)
function shade(hex,f){
  const r=Math.min(255,Math.round(((hex>>16)&255)*f)),
        g=Math.min(255,Math.round(((hex>>8)&255)*f)),
        b=Math.min(255,Math.round((hex&255)*f));
  return (r<<16)|(g<<8)|b;
}
// seeded rng so hair clumps don't reshuffle on every rebuild
function rng(seed){ return function(){ seed|=0; seed=seed+0x6D2B79F5|0;
  let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t;
  return ((t^t>>>14)>>>0)/4294967296; }; }

// ---------- character build ----------
function box(w,h,d,mat){ return new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat); }
function std(color){ return new THREE.MeshStandardMaterial({color, roughness:.8, metalness:.15}); }

// soft-cornered box: subdivided BoxGeometry, vertices snapped to rounded shell.
// preserves box UVs + the 6 material groups (so textures map normally)
function roundedBoxGeo(w,h,d,r,seg=5){
  const geo=new THREE.BoxGeometry(w,h,d,seg,seg,seg);
  const pos=geo.attributes.position;
  const v=new THREE.Vector3(), c=new THREE.Vector3();
  const hw=w/2-r, hh=h/2-r, hd=d/2-r;
  for(let i=0;i<pos.count;i++){
    v.set(pos.getX(i),pos.getY(i),pos.getZ(i));
    c.set(THREE.MathUtils.clamp(v.x,-hw,hw),
          THREE.MathUtils.clamp(v.y,-hh,hh),
          THREE.MathUtils.clamp(v.z,-hd,hd));
    v.sub(c).normalize().multiplyScalar(r);
    pos.setXYZ(i, c.x+v.x, c.y+v.y, c.z+v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
function roundedBox(w,h,d,r,mat){ return new THREE.Mesh(roundedBoxGeo(w,h,d,r),mat); }

// inverted-hull outlines: dark shell behind every box = crisp voxel edges
const OUTLINE_MAT = new THREE.MeshBasicMaterial({color:0x0a0b14, side:THREE.BackSide});
function addOutlines(root){
  const targets=[];
  root.traverse(o=>{
    if(o.isMesh && o.geometry && (o.geometry.type==='BoxGeometry'||o.geometry.type==='ExtrudeGeometry')
       && !o.userData.isOutline
       && !(o.material && o.material.isMeshBasicMaterial)) targets.push(o);
  });
  targets.forEach(m=>{
    const o = new THREE.Mesh(m.geometry, OUTLINE_MAT);
    o.scale.setScalar(1.055); o.userData.isOutline = true;
    m.add(o);
  });
}

function glow(color){ return new THREE.MeshBasicMaterial({color, transparent:true, opacity:1}); }
function buildWeapon(def, accent){
  const g = new THREE.Group();
  const type = def.id;
  const dark = std(0x2c3038), metal = std(0x9aa3ad), acc = std(accent);
  const grip = std(0x1c1f26), wood = std(0x7a5a36);
  const socket = new THREE.Object3D();          // left-hand IK target
  let muzzleZ = null, beamColor = null, flashColor = 0xffd45c;
  let lt = null, prevF = 0;                      // per-instance clock + fire edge detect
  const dtOf = t => { const d = lt===null? 0 : Math.min(t-lt,.05); lt = t; return d; };
  // tiny particle pool: spawn() launches one, step(d) advances + fades by scale
  function pool(n,color,size){
    const arr=[];
    for(let i=0;i<n;i++){ const m=box(size,size,size,glow(color)); m.visible=false; g.add(m); arr.push({m,t:-1,v:new THREE.Vector3()}); }
    return {
      spawn(px,py,pz,vx,vy,vz){ const p=arr.find(p=>p.t<0)||arr[0]; p.t=0; p.m.visible=true; p.m.position.set(px,py,pz); p.v.set(vx,vy,vz); p.m.scale.setScalar(1); },
      step(d,life,grav=0){ arr.forEach(p=>{ if(p.t<0) return; p.t+=d;
        if(p.t>life){ p.t=-1; p.m.visible=false; p.m.scale.setScalar(1); return; }
        p.v.y -= grav*d; p.m.position.addScaledVector(p.v,d);
        const s=(1-(p.t/life))*.65; p.m.scale.set(s,s,s); }); }
    };
  }

  if(type==='pickaxe'){
    const handle = box(.06,.7,.06,wood); handle.position.y=.25; g.add(handle);
    for(let i=0;i<3;i++){ const wrap=box(.075,.045,.075,grip); wrap.position.y=.04+i*.07; g.add(wrap); }
    const buttCap = box(.08,.04,.08,metal); buttCap.position.y=-.1; g.add(buttCap);
    const collar = box(.09,.06,.09,metal); collar.position.y=.55; g.add(collar);
    const headL = box(.3,.08,.08,metal); headL.position.set(-.15,.6,0); headL.rotation.z=.35; g.add(headL);
    const headR = box(.3,.08,.08,metal); headR.position.set(.15,.6,0); headR.rotation.z=-.35; g.add(headR);
    const tipL = box(.07,.06,.06,acc); tipL.position.set(-.29,.65,0); tipL.rotation.z=.35; g.add(tipL);
    const tipR = box(.07,.06,.06,acc); tipR.position.set(.29,.65,0); tipR.rotation.z=-.35; g.add(tipR);
    const mid = box(.11,.11,.1,acc); mid.position.y=.6; g.add(mid);
    const crysM = glow(0x6fe3ff);
    const crys = box(.06,.06,.045,crysM); crys.position.set(0,.6,.075); g.add(crys);
    // magnetized ore shards orbit the crystal; scatter on impact
    const shards=[]; for(let i=0;i<3;i++){ const s=box(.03,.03,.03,glow(0xbfe8ff)); g.add(s); shards.push(s); }
    const sparks = pool(4,0xfff0b0,.03);
    g.userData.animate = (t,f)=>{ const d=dtOf(t);
      const s = 1 + .12*Math.sin(t*2.5) + f*.8; crys.scale.set(s,s,s);
      crysM.color.setHex(f>0? 0xeaffff : 0x6fe3ff);
      const orbitR = .12 + f*.12;
      shards.forEach((sh,i)=>{ const a=t*1.4+i*2.1;
        sh.position.set(Math.cos(a)*orbitR, .6+Math.sin(t*2+i)*.05, .05+Math.sin(a)*orbitR*.6); });
      if(f>0 && prevF===0){ for(let i=0;i<4;i++) sparks.spawn(.27*(i%2?1:-1),.65,0,(Math.random()-.5)*1.6,1+Math.random(), (Math.random()-.5)*1.2); }
      sparks.step(d,.45,3);
      prevF=f;
    };
    socket.position.set(0, .32, 0.04);

  } else if(type==='wrench'){
    const handle = box(.07,.5,.07,metal); handle.position.y=.2; g.add(handle);
    for(let i=0;i<3;i++){ const k=box(.085,.04,.085,grip); k.position.y=.02+i*.06; g.add(k); }
    const lanyard = box(.05,.05,.02,acc); lanyard.position.set(0,-.05,0); g.add(lanyard);
    const neck = box(.09,.07,.09,std(0x7d8893)); neck.position.y=.3; g.add(neck);
    const collar = box(.11,.035,.11,acc); collar.position.y=.32; g.add(collar);   // rotating adjuster collar
    const jawA = box(.22,.08,.09,acc); jawA.position.set(.05,.49,0); g.add(jawA);
    const jawB = box(.22,.08,.09,acc); jawB.position.set(.05,.36,0); g.add(jawB);
    const jawBack = box(.09,.21,.09,metal); jawBack.position.set(-.05,.425,0); g.add(jawBack);
    const boltHead = box(.06,.07,.1,dark); boltHead.position.set(.1,.425,0); g.add(boltHead);
    const dial = box(.04,.1,.03,dark); dial.position.set(0,.42,.06); g.add(dial);
    const arcs=[]; for(let i=0;i<3;i++){ const a=box(.025,.025,.025,glow(0x9deeff)); a.visible=false; g.add(a); arcs.push(a); }
    const steam = pool(3,0xb8c2cc,.04);
    g.userData.animate = (t,f)=>{ const d=dtOf(t);
      collar.rotation.y += d*.9;
      jawB.position.y = .36 + .008*Math.sin(t*2) + f*.02;     // jaws clamp on torque
      jawA.position.y = .49 - f*.02;
      if(f>0){ boltHead.rotation.x += d*14;
        arcs.forEach(a=>{ a.visible=true; a.position.set(.04+Math.random()*.12, .38+Math.random()*.09, (Math.random()-.5)*.07); });
        if(Math.random()<.25) steam.spawn(.05,.5,0,(Math.random()-.5)*.2,.5,.0);
      } else arcs.forEach(a=>a.visible=false);
      if(f===0 && prevF>0){ steam.spawn(.05,.5,0,.1,.6,0); steam.spawn(.02,.48,.02,-.1,.5,0); }
      steam.step(d,.9);
      prevF=f;
    };

  } else if(type==='sword'){
    const handle = box(.05,.24,.05,grip); handle.position.y=.07; g.add(handle);
    for(let i=0;i<3;i++){ const ring=box(.065,.03,.065,dark); ring.position.y=.0+i*.07; g.add(ring); }
    const pommel = box(.08,.05,.08,metal); pommel.position.y=-.07; g.add(pommel);
    const pomGem = box(.04,.04,.04,glow(0xff5ad2)); pomGem.position.y=-.1; g.add(pomGem);
    const guard = box(.18,.05,.09,metal); guard.position.y=.21; g.add(guard);
    const ventMs=[]; [-1,1].forEach(s=>{ const vm=glow(0x7a3068); ventMs.push(vm);
      const vent=box(.03,.06,.05,vm); vent.position.set(s*.08,.26,0); g.add(vent); });
    const emitter = box(.08,.06,.1,dark); emitter.position.y=.26; g.add(emitter);
    const bladeM = glow(0xff5ad2);
    const blade = box(.05,.56,.1,bladeM); blade.position.y=.56; g.add(blade);
    const core  = box(.02,.56,.05,glow(0xffffff)); core.position.set(0,.56,.035); g.add(core);
    const tip   = box(.04,.09,.07,glow(0xff8ae4)); tip.position.y=.87; g.add(tip);
    const motes=[]; for(let i=0;i<3;i++){ const m=box(.018,.018,.018,glow(0xffb8ec)); g.add(m); motes.push(m); }
    const trail=[]; for(let i=0;i<2;i++){
      const tb=box(.015,.48,.06,glow(0xff8ae4)); tb.position.y=.56; tb.visible=false; g.add(tb); trail.push(tb); }
    const crackle = pool(3,0xfff0fc,.011);
    g.userData.animate = (t,f)=>{ const d=dtOf(t);
      const swing = THREE.MathUtils.clamp(f, 0, 1);
      pomGem.rotation.y = t * 2 + swing * 0.35;
      pomGem.rotation.x = t * 1.3;
      blade.scale.x = 1 + .05 * Math.sin(t * 17) + swing * .12;
      blade.scale.z = 1 + .04 * Math.sin(t * 23) + swing * .1;
      blade.scale.y = 1;
      bladeM.color.setHex(swing > 0.12 ? 0xffd0f2 : 0xff5ad2);
      ventMs.forEach(vm => vm.color.setHex(swing > 0.08 ? 0xff5ad2 : 0x7a3068));
      motes.forEach((m,i)=>{ const k=(t*.45+i*.27)%1;
        m.position.set(.04*Math.sin(t*3+i*2), .34+k*.42, .05*Math.cos(t*2.6+i));
        m.scale.setScalar((1-k*.75)*.85); });
      trail.forEach((tb,i)=>{
        tb.visible = swing > 0.14;
        if (tb.visible) {
          const s = (1 - (i + 1) * .28) * (0.22 + swing * .18);
          tb.rotation.x = -(i + 1) * .18 - swing * .32;
          tb.rotation.z = (i % 2 ? 1 : -1) * swing * .12;
          tb.scale.set(s, s * .92, s);
          tb.material.opacity = 0.12 + swing * 0.38;
        }
      });
      if (Math.random() < .015 + swing * .1) {
        crackle.spawn((Math.random()-.5)*.04, .38+Math.random()*.34, .04, (Math.random()-.5)*.25, .15, .2);
      }
      crackle.step(d,.16);
      prevF=f;
    };
    socket.position.set(0, 0.2, 0.05);

  } else if(type==='blaster'){
    const body = box(.09,.12,.62,dark); body.position.set(0,.1,.18); g.add(body);
    const rail = box(.05,.03,.4,metal); rail.position.set(0,.175,.2); g.add(rail);
    const rearSight = box(.05,.05,.03,dark); rearSight.position.set(0,.21,.0); g.add(rearSight);
    const holo = box(.02,.02,.02,glow(0xff7a5c)); holo.position.set(0,.24,.0); g.add(holo);  // holo dot
    const frontSight = box(.02,.06,.02,dark); frontSight.position.set(0,.19,.55); g.add(frontSight);
    const barrel = box(.05,.05,.3,metal); barrel.position.set(0,.13,.6); g.add(barrel);
    [-.04,.08,.2].forEach(z=>{ const ring=box(.07,.07,.03,dark); ring.position.set(0,.13,.6+z); g.add(ring); });
    const mag = box(.07,.16,.1,acc); mag.position.set(0,-.02,.22); g.add(mag);
    const trig = box(.02,.07,.08,metal); trig.position.set(0,.0,.06); g.add(trig);
    const stock = box(.08,.1,.16,dark); stock.position.set(0,.07,-.12); g.add(stock);
    const stockPad = box(.09,.11,.03,acc); stockPad.position.set(0,.07,-.21); g.add(stockPad);
    const slide = box(.05,.05,.16,metal); slide.position.set(0,.18,.02); g.add(slide);
    const drum = box(.1,.1,.05,std(0x4a5058)); drum.position.set(.07,.1,.3); drum.rotation.y=Math.PI/2; g.add(drum);
    const drumDot = box(.025,.025,.055,acc); drumDot.position.set(.07,.14,.3); g.add(drumDot);
    const shells = pool(3,0xd9b65c,.035);
    const smoke = pool(3,0x6a7480,.05);
    const streak = pool(2,0xffc878,.04);
    g.userData.animate = (t,f)=>{ const d=dtOf(t);
      holo.visible = (t*3)%1 < .8;                          // sight dot blinks
      slide.position.z = .02 - f*.07;
      if(f>0){ drum.rotation.x += d*22;
        drumDot.position.y = .1+.04*Math.cos(drum.rotation.x);
        drumDot.position.z = .3+.04*Math.sin(drum.rotation.x); }
      if(f>0 && prevF===0){
        shells.spawn(.07,.14,.18, 1.2+Math.random()*.5, 1.6, -.3); // casing out the ejection port
        smoke.spawn(0,.13,.8, .1,.4,.4);
        streak.spawn(0,.13,.78, 0,0,18);
      }
      shells.step(d,.7,5);
      smoke.step(d,.8);
      streak.step(d,.22);
      prevF=f;
    };
    socket.position.set(0,.05,.28);
    muzzleZ = {y:.13,z:.78}; beamColor = 0xffb868; flashColor = 0xffe8b0;

  } else if(type==='laser'){
    const body = box(.08,.1,.66,dark); body.position.set(0,.1,.2); g.add(body);
    const coreM = glow(0x66e0ff);
    const core = box(.045,.045,.5,coreM); core.position.set(0,.17,.2); g.add(core);
    const conduit = box(.025,.025,.44,glow(0x66e0ff)); conduit.position.set(.055,.08,.2); g.add(conduit);
    const barrel = box(.04,.04,.32,metal); barrel.position.set(0,.1,.66); g.add(barrel);
    const finM = std(0x9aa3ad); const fins=[];
    for(let i=0;i<4;i++){ const fin=box(.12,.02,.03,finM); fin.position.set(0,.1,.52+i*.08); g.add(fin); fins.push(fin); }
    // radiator doors: hinge open as heat rises
    const doors=[]; [-1,1].forEach(s=>{ const dr=box(.02,.07,.18,metal); dr.position.set(s*.05,.13,.2); g.add(dr); doors.push({m:dr,s}); });
    const emitter = box(.1,.1,.05,glow(0x9deeff)); emitter.position.set(0,.1,.85); g.add(emitter);
    const emRing = box(.13,.13,.03,dark); emRing.position.set(0,.1,.81); g.add(emRing);
    const focus = box(.14,.14,.025,acc); focus.position.set(0,.1,.6); g.add(focus);
    const focus2 = box(.16,.16,.02,dark); focus2.position.set(0,.1,.7); g.add(focus2); // counter-rotating
    const topFin = box(.025,.1,.22,acc); topFin.position.set(0,.21,.4); g.add(topFin);
    const cell = box(.06,.12,.09,glow(0x66e0ff)); cell.position.set(0,-.02,.16); g.add(cell);
    const cellFrame = box(.075,.04,.105,dark); cellFrame.position.set(0,-.09,.16); g.add(cellFrame);
    const leds=[]; for(let i=0;i<3;i++){ const led=box(.018,.018,.018,glow(0x9deeff)); led.position.set(-.05,.13,.0+i*.05); g.add(led); leds.push(led); }
    const stock = box(.07,.09,.14,dark); stock.position.set(0,.07,-.12); g.add(stock);
    const haze = pool(3,0xffc090,.012);
    let heat=0;
    g.userData.animate = (t,f)=>{ const d=dtOf(t);
      focus.rotation.z += d*(1.2 + f*8);
      focus2.rotation.z -= d*(.7 + f*5);
      heat = Math.min(1, heat + f*d*3.2); heat *= Math.exp(-d*.9);
      finM.emissive.setRGB(heat*.75, heat*.22, heat*.04);
      doors.forEach(o=>{ o.m.rotation.z = o.s*heat*.65; o.m.position.x = o.s*(.05+heat*.018); });
      const cs = 1 + f*.22 + .04*Math.sin(t*6); core.scale.set(cs,cs,1);
      coreM.color.setHex(f>0? 0xd6f6ff : 0x66e0ff);
      const es = 1 + f*(.16+.12*Math.sin(t*40)); emitter.scale.set(es,es,1);
      leds.forEach((l,i)=>{ l.visible = ((t*2)%3) > i*.9; });
      if(heat>.35 && Math.random()<heat*.22) haze.spawn((Math.random()-.5)*.07,.13,.5+Math.random()*.2, 0,.35,0);
      if(f>0 && prevF===0){
        haze.spawn(0,.1,.85, 0,0,14);
        haze.spawn(0,.1,.88, 0,0,11);
      }
      haze.step(d,.45);
      prevF=f;
    };
    socket.position.set(0,.04,.3);
    muzzleZ = {y:.1,z:.9}; beamColor = 0xff5a6a; flashColor = 0x9deeff;

  } else if(type==='plasma'){
    const body = box(.08,.09,.32,dark); body.position.set(0,.08,.1); g.add(body);
    const frame = box(.1,.04,.12,metal); frame.position.set(0,.14,.06); g.add(frame);
    const orbM = glow(0x7dff6a);
    const orb = box(.09,.09,.09,orbM); orb.position.set(0,.19,.06); g.add(orb);
    const sats=[]; for(let i=0;i<2;i++){ const s=box(.02,.02,.02,glow(0xc8ffba)); g.add(s); sats.push(s); } // orbiting satellites
    const barrel = box(.05,.05,.14,metal); barrel.position.set(0,.08,.32); g.add(barrel);
    const coilMats=[];
    for(let i=0;i<3;i++){ const cm=glow(0x2f6a35); coilMats.push(cm);
      const coil=box(.08,.08,.025,cm); coil.position.set(0,.08,.24+i*.05); g.add(coil); }
    const hoseA = box(.025,.08,.025,grip); hoseA.position.set(-.05,.02,-.02); hoseA.rotation.x=.5; g.add(hoseA);
    const hoseB = box(.025,.07,.025,grip); hoseB.position.set(-.05,.08,.0); g.add(hoseB);
    const trig = box(.02,.06,.06,metal); trig.position.set(0,-.01,.05); g.add(trig);
    const bolts = pool(2,0x7dff6a,.07);     // visible projectiles!
    g.userData.animate = (t,f)=>{ const d=dtOf(t);
      orb.rotation.y = t*1.6; orb.rotation.x = t*1.1;
      const s = 1 + .1*Math.sin(t*3) + f*.5; orb.scale.set(s,s,s);
      orbM.color.setHex(f>0? 0xe4ffd6 : 0x7dff6a);
      sats.forEach((sa,i)=>{ const a=t*4+i*Math.PI;
        sa.position.set(Math.cos(a)*.09, .19+Math.sin(a*1.7)*.06, .06+Math.sin(a)*.09); });
      hoseB.rotation.x = .15*Math.sin(t*2.4);
      coilMats.forEach((cm,i)=>{ const on = ((t*2.4 + (2-i)*.33)%1) < .33 || f>0;
        cm.color.setHex(on? 0x7dff6a : 0x2f6a35); });
      if(f>0 && prevF===0) bolts.spawn(0,.08,.45, 0,0,6);   // lob a bolt
      bolts.step(d,.55);
      prevF=f;
    };
    muzzleZ = {y:.08,z:.41}; flashColor = 0x7dff6a;

  } else if(type==='railgun'){
    const body = box(.12,.14,.7,dark); body.position.set(0,.1,.15); g.add(body);
    const railM = std(0x9aa3ad); railM.emissive = new THREE.Color(0x000000);
    [-1,1].forEach(s=>{ const rail = box(.03,.03,.55,railM); rail.position.set(s*.045,.13,.72); g.add(rail); });
    [.5,.72,.94].forEach(z=>{ const brace=box(.13,.02,.03,dark); brace.position.set(0,.13,z); g.add(brace); });
    const brake = box(.14,.08,.06,metal); brake.position.set(0,.13,1.0); g.add(brake);
    const chargeM = glow(0x8ad8ff);
    const charge = box(.1,.1,.14,chargeM); charge.position.set(0,.1,.42); g.add(charge);
    const capMats=[];
    for(let i=0;i<4;i++){ const cm=glow(0x274a66); capMats.push(cm);
      const cap=box(.03,.06,.03,cm); cap.position.set(.085,.12,.06+i*.08); g.add(cap); }
    const capFrame = box(.025,.09,.34,dark); capFrame.position.set(.1,.1,.16); g.add(capFrame);
    const cable = box(.025,.025,.3,grip); cable.position.set(-.08,.16,.2); g.add(cable);
    const turbine = box(.09,.09,.03,metal); turbine.position.set(0,.1,-.28); g.add(turbine);  // cooling turbine
    const turbBlade = box(.11,.02,.025,dark); turbBlade.position.set(0,.1,-.3); g.add(turbBlade);
    const scope = box(.05,.06,.22,metal); scope.position.set(0,.23,.08); g.add(scope);
    const lens = box(.035,.04,.02,glow(0x8ad8ff)); lens.position.set(0,.23,-.04); g.add(lens);
    const mag = box(.08,.18,.12,acc); mag.position.set(0,-.04,.2); g.add(mag);
    const stock = box(.1,.12,.2,dark); stock.position.set(0,.06,-.18); g.add(stock);
    const stockPad = box(.11,.13,.03,acc); stockPad.position.set(0,.06,-.29); g.add(stockPad);
    const sideGrip = box(.04,.1,.04,grip); sideGrip.position.set(0,-.02,.5); g.add(sideGrip);
    const sparks=[]; for(let i=0;i<3;i++){ const sp=box(.02,.02,.04,glow(0xdff2ff)); sp.visible=false; g.add(sp); sparks.push(sp); }
    const tracer = pool(1,0xe8f8ff,.05);
    const smoke = pool(4,0x7a8896,.05);
    let railHeat=0;
    g.userData.animate = (t,f)=>{ const d=dtOf(t);
      turbBlade.rotation.z += d*(3 + railHeat*20);            // turbine spins up with heat
      capMats.forEach((cm,i)=>{ const on = ((t*1.6 + i*.25)%1) < .55 || f>0;
        cm.color.setHex(on? 0x8ad8ff : 0x274a66); });
      const cs = 1 + .06*Math.sin(t*2.2) + f*.6; charge.scale.set(cs,cs,1);
      chargeM.color.setHex(f>0? 0xe8f8ff : 0x8ad8ff);
      railHeat = Math.min(1, railHeat + f*d*6); railHeat *= Math.exp(-d*1.1);
      railM.emissive.setRGB(railHeat*.35, railHeat*.6, railHeat*.95); // rails glow + fade
      if(f>0){ sparks.forEach(sp=>{ sp.visible=true; sp.position.set((Math.random()-.5)*.07, .13, .5+Math.random()*.45); }); }
      else sparks.forEach(sp=>sp.visible=false);
      if(f>0 && prevF===0){
        tracer.spawn(0,.13,1.05, 0,0,14);
        for(let i=0;i<3;i++) smoke.spawn((Math.random()-.5)*.05,.15,1.0, (Math.random()-.5)*.3,.5,.6);
      }
      tracer.step(d,.4);
      smoke.step(d,1.1);
      prevF=f;
    };
    socket.position.set(0,-.02,.5);
    muzzleZ = {y:.13,z:1.04}; beamColor = 0xbfe8ff; flashColor = 0x8ad8ff;

  } else if(type==='minecutter'){
    const body = box(.07,.08,.26,dark); body.position.set(0,.07,.06); g.add(body);
    const gripPad = box(.08,.04,.1,grip); gripPad.position.set(0,.02,.0); g.add(gripPad);
    for(let i=0;i<2;i++){ const rib=box(.075,.025,.035,metal); rib.position.set(0,.04+i*.045,-.02); g.add(rib); }
    const trigger = box(.02,.05,.05,metal); trigger.position.set(0,-.01,.03); g.add(trigger);
    const cellM = glow(0x6fe3ff);
    const cell = box(.06,.08,.04,cellM); cell.position.set(0,.12,.0); g.add(cell);
    const cellCap = box(.07,.03,.05,acc); cellCap.position.set(0,.16,.0); g.add(cellCap);
    const barrel = box(.04,.04,.1,metal); barrel.position.set(0,.08,.28); g.add(barrel);
    const shroud = box(.06,.06,.06,dark); shroud.position.set(0,.08,.34); g.add(shroud);
    const focusM = glow(0x9deeff);
    const focus = box(.045,.045,.03,focusM); focus.position.set(0,.08,.38); g.add(focus);
    const sight = box(.02,.02,.02,glow(0xff7a5c)); sight.position.set(0,.13,.02); g.add(sight);
    const ventMats=[];
    [-1,1].forEach(s=>{ const vm=glow(0x3a8a9a); ventMats.push(vm);
      const vent=box(.015,.035,.05,vm); vent.position.set(s*.042,.1,.12); g.add(vent); });
    const chips = pool(5,0xc8f0ff,.022);
    const haze = pool(3,0x88d8ff,.028);
    g.userData.animate = (t,f)=>{ const d=dtOf(t);
      sight.visible = (t*3)%1 < .75;
      cellM.color.setHex(f>0? 0xe8ffff : 0x6fe3ff);
      const cs = 1 + .08*Math.sin(t*4) + f*.45; cell.scale.set(cs,cs,1);
      focus.scale.set(1+f*.55, 1+f*.55, 1+f*.35);
      focusM.color.setHex(f>0? 0xffffff : 0x9deeff);
      ventMats.forEach(vm=>{ vm.color.setHex(f>0? 0x9deeff : 0x3a8a9a); });
      if(f>0 && prevF===0){
        for(let i=0;i<3;i++) chips.spawn((Math.random()-.5)*.05,.08,.36,(Math.random()-.5)*1.2,.5,(Math.random()-.5)*1.2);
        haze.spawn(0,.08,.4,0,0,10);
      }
      chips.step(d,.32,2.5);
      haze.step(d,.45);
      prevF=f;
    };
    muzzleZ = {y:.08,z:.42}; beamColor = 0x66e8ff; flashColor = 0x9deeff;

  } else if(type==='detonator'){
    const body = box(.09,.11,.05,dark); body.position.set(0,.06,0); g.add(body);
    const face = box(.075,.095,.012,std(0x3a3f48)); face.position.set(0,.06,.03); g.add(face);
    const gripPad = box(.08,.05,.055,grip); gripPad.position.set(0,0,0); g.add(gripPad);
    const btnM = glow(0xff4a3a);
    const btn = box(.035,.035,.03,btnM); btn.position.set(0,.09,.045); g.add(btn);
    const btnRing = box(.055,.055,.012,acc); btnRing.position.set(0,.09,.036); g.add(btnRing);
    const ledM = glow(0x6fe3ff);
    const led = box(.014,.014,.014,ledM); led.position.set(-.022,.03,.045); g.add(led);
    const antenna = box(.012,.16,.012,metal); antenna.position.set(.035,.19,0); g.add(antenna);
    const tip = box(.02,.02,.02,btnM); tip.position.set(.035,.28,0); g.add(tip);
    g.userData.animate = (t,f)=>{
      ledM.color.setHex((t*2)%1 < .5 ? 0x6fe3ff : 0x14303a);   // status LED blink
      const bs = f>0? .55 : 1;                                  // plunger presses down on fire
      btn.scale.set(1,1,bs); btn.position.z = .045 - (1-bs)*.015;
      btnM.color.setHex(f>0? 0xffd0a0 : 0xff4a3a);
    };
    socket.position.set(0,.02,0);
  }

  // muzzle point + flash + (optional) beam for ranged weapons
  if(muzzleZ){
    const muzzle = new THREE.Object3D(); muzzle.position.set(0,muzzleZ.y,muzzleZ.z); g.add(muzzle);
    const flash = box(.12,.12,.14, new THREE.MeshBasicMaterial({color:flashColor,transparent:true,opacity:.95}));
    flash.visible=false; muzzle.add(flash);
    g.userData.muzzle=muzzle; g.userData.flash=flash;
    if(beamColor){
      const beam = box(.035,.035,6, new THREE.MeshBasicMaterial({color:beamColor,transparent:true,opacity:.9}));
      beam.position.z=3.05; beam.visible=false; muzzle.add(beam);
      g.userData.beam=beam;
    }
  }

  g.add(socket); g.userData.socket = socket;
  g.userData.twoHanded = def.twoHanded;
  g.userData.ranged = !!def.ranged;
  // grip orientation: melee modeled along +Y gets tipped into the hand; ranged along +Z
  if(type==='pickaxe'){ g.rotation.x=1.45; g.rotation.z=.08; g.position.set(0,-.03,.06); }
  else if(type==='wrench'){ g.rotation.x=1.3; g.position.set(0,-.03,.05); }
  else if(type==='sword'){ g.rotation.x=Math.PI/2; g.rotation.z=-0.24; g.position.set(0,-.02,.1); }
  else { g.rotation.x=-.05; g.position.set(0,-.03,.05); }
  return g;
}

// Melee: model +Y → pitch ~π/2. Ranged: model +Z → near-flat. Y flip for -X primary grip.
function tpWeaponGripRest(def) {
  const id = def && def.id;
  const fy = Math.PI;
  if (id === 'pickaxe') return { x: 1.45, y: fy, z: 0.08, px: 0, py: -0.03, pz: 0.06 };
  if (id === 'wrench') return { x: 1.3, y: fy, z: 0, px: 0, py: -0.03, pz: 0.05 };
  if (id === 'sword') return { x: Math.PI / 2, y: fy, z: -0.24, px: 0.02, py: -0.02, pz: 0.12 };
  if (id === 'plasma') return { x: -0.05, y: fy, z: 0.04, px: 0, py: -0.03, pz: 0.04 };
  if (id === 'minecutter') return { x: -0.05, y: fy, z: 0.05, px: 0, py: -0.03, pz: 0.04 };
  if (id === 'railgun') return { x: -0.02, y: fy, z: -0.02, px: 0, py: -0.04, pz: 0.04 };
  if (id === 'laser') return { x: -0.05, y: fy, z: 0.02, px: 0, py: -0.03, pz: 0.05 };
  if (id === 'blaster') return { x: -0.05, y: fy, z: 0, px: 0, py: -0.03, pz: 0.05 };
  if (def && def.ranged) return { x: -0.05, y: fy, z: 0, px: 0, py: -0.03, pz: 0.05 };
  return { x: 1.35, y: fy, z: 0, px: 0, py: -0.03, pz: 0.05 };
}

const TP_WEAPON_REST_V = 5;

// Rig primary grip is -X local (world-right in play). Y-flip only — no scale mirror (breaks aim axes).
function mirrorWeaponForTpGrip(mesh, def) {
  if (!mesh) return;
  if (mesh.userData.tpRestV === TP_WEAPON_REST_V) return;
  mesh.userData.rigMirrored = true;
  mesh.userData.tpRestV = TP_WEAPON_REST_V;
  mesh.scale.set(1, 1, 1);
  const rest = tpWeaponGripRest(def);
  mesh.rotation.set(rest.x, rest.y, rest.z);
  mesh.position.set(rest.px, rest.py, rest.pz);
  mesh.userData.restRotation = { x: rest.x, y: rest.y, z: rest.z };
  mesh.userData.restPosition = { x: rest.px, y: rest.py, z: rest.pz };
  mesh.userData.restScaleX = 1;
  delete mesh.userData.restMuzzleDirGrip;
  delete mesh.userData.restQuat;
}

function storeWeaponRestPose(mesh) {
  if (!mesh) return;
  mesh.userData.restRotation = { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z };
  mesh.userData.restPosition = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
  mesh.userData.restScaleX = mesh.scale.x;
}

function resetWeaponToGripRest(char) {
  if (!char || !char.weapon) return;
  const w = char.weapon;
  const rest = w.userData.restRotation;
  if (rest) w.rotation.set(rest.x, rest.y, rest.z);
  const pos = w.userData.restPosition;
  if (pos) w.position.set(pos.x, pos.y, pos.z);
  w.scale.set(1, 1, 1);
}

const _gripInv = new THREE.Matrix4();
const _gp = new THREE.Vector3();
const _mp = new THREE.Vector3();
const _md = new THREE.Vector3();
const _aimLocal = new THREE.Vector3();
const _gripQ = new THREE.Quaternion();
const _qDelta = new THREE.Quaternion();
const _qAim = new THREE.Quaternion();
const _shW = new THREE.Vector3();
const _tgtW = new THREE.Vector3();

function cacheWeaponGripAim(w, grip) {
  if (!w || !grip || !w.userData.muzzle) return;
  const rest = w.userData.restRotation;
  const pos = w.userData.restPosition;
  if (rest) w.rotation.set(rest.x, rest.y, rest.z);
  if (pos) w.position.set(pos.x, pos.y, pos.z);
  w.scale.set(1, 1, 1);
  grip.updateMatrixWorld(true);
  w.updateMatrixWorld(true);
  grip.getWorldPosition(_gp);
  w.userData.muzzle.getWorldPosition(_mp);
  _md.copy(_mp).sub(_gp).normalize();
  _gripInv.copy(grip.matrixWorld).invert();
  w.userData.restMuzzleDirGrip = _md.transformDirection(_gripInv);
  w.userData.restQuat = w.quaternion.clone();
}

function alignWeaponToAim(char, worldDir, strength) {
  const w = char.weapon;
  const grip = char.weaponGrip;
  if (!w || !grip || !worldDir || !strength) return;
  if (!w.userData.restMuzzleDirGrip) cacheWeaponGripAim(w, grip);
  const restDir = w.userData.restMuzzleDirGrip;
  const restQuat = w.userData.restQuat;
  if (!restDir || !restQuat) {
    resetWeaponToGripRest(char);
    return;
  }
  resetWeaponToGripRest(char);
  const s = THREE.MathUtils.clamp(strength, 0, 1);
  grip.updateMatrixWorld(true);
  grip.getWorldQuaternion(_gripQ).invert();
  _aimLocal.copy(worldDir).normalize().applyQuaternion(_gripQ);
  _qDelta.setFromUnitVectors(restDir, _aimLocal);
  _qAim.copy(_qDelta).multiply(restQuat);
  w.quaternion.slerp(_qAim, s);
}

function meleeSwingPhase(t, profile) {
  const A = profile.anticEnd ?? 0.22;
  const S = profile.strikeEnd ?? 0.48;
  const peak = profile.strikePeak ?? 1.15;
  let antic = 0, strike = 0, recover = 0;
  if (t < A) {
    antic = Math.sin((t / A) * Math.PI / 2);
  } else if (t < S) {
    const u = (t - A) / (S - A);
    strike = u * u * peak;
    antic = 1 - u;
  } else {
    const u = (t - S) / (1 - S);
    recover = 1 - (1 - u) * (1 - u);
    strike = (1 - recover) * peak;
  }
  return { antic, strike, recover };
}

const SWORD_SWING_DURATION = 0.52;

const SWORD_SWING_VARIANTS = [
  {
    id: 'slash_r',
    phase: { anticEnd: 0.26, strikeEnd: 0.5, strikePeak: 1.28 },
    apply(tgt, ph) {
      const { antic, strike } = ph;
      tgt.torsoRY = (tgt.torsoRY || 0) + (-antic * 0.62 + strike * 0.95);
      tgt.torsoRX = (tgt.torsoRX || 0) + (-antic * 0.18 + strike * 0.14);
      tgt.headRY = (tgt.headRY || 0) + (-antic * 0.24 + strike * 0.34);
      tgt.headRX = (tgt.headRX || 0) + (-antic * 0.1 + strike * 0.16);
      tgt.shRz = (tgt.shRz || 0) + (-antic * 0.82 + strike * 1.22);
      tgt.shRx = -0.28 - antic * 1.25 + strike * 1.65;
      tgt.elR = 0.28 + antic * 0.52 + strike * 0.78;
      tgt.shLx = -0.4 - antic * 0.28 + strike * 0.12;
      tgt.shLz = -0.18 - antic * 0.22;
      tgt.elL = 0.68 + strike * 0.18;
      tgt.hipRx = (tgt.hipRx || 0) + strike * 0.12;
      tgt.hipRz = (tgt.hipRz || 0) + (-antic * 0.08 + strike * 0.14);
      tgt.rootY = (tgt.rootY || 0) + (-strike * 0.04 + antic * 0.02);
    }
  },
  {
    id: 'slash_l',
    phase: { anticEnd: 0.24, strikeEnd: 0.48, strikePeak: 1.22 },
    apply(tgt, ph) {
      const { antic, strike } = ph;
      tgt.torsoRY = (tgt.torsoRY || 0) + (antic * 0.55 - strike * 0.88);
      tgt.torsoRX = (tgt.torsoRX || 0) + (-antic * 0.12 + strike * 0.18);
      tgt.headRY = (tgt.headRY || 0) + (antic * 0.2 - strike * 0.28);
      tgt.shRz = (tgt.shRz || 0) + (antic * 0.75 - strike * 1.05);
      tgt.shRx = -0.22 - antic * 0.95 + strike * 1.45;
      tgt.elR = 0.35 + antic * 0.38 + strike * 0.65;
      tgt.shLx = -0.55 - antic * 0.35 + strike * 0.28;
      tgt.shLz = -0.28 + antic * 0.18;
      tgt.elL = 0.75 + strike * 0.22;
      tgt.hipLx = (tgt.hipLx || 0) + strike * 0.08;
      tgt.rootY = (tgt.rootY || 0) + (-strike * 0.035 + antic * 0.015);
    }
  },
  {
    id: 'overhead',
    phase: { anticEnd: 0.28, strikeEnd: 0.52, strikePeak: 1.35 },
    apply(tgt, ph) {
      const { antic, strike } = ph;
      tgt.torsoRY = (tgt.torsoRY || 0) + (-antic * 0.35 + strike * 0.42);
      tgt.torsoRX = (tgt.torsoRX || 0) + (-antic * 0.45 + strike * 0.55);
      tgt.headRX = (tgt.headRX || 0) + (-antic * 0.22 + strike * 0.28);
      tgt.headRY = (tgt.headRY || 0) + (-antic * 0.14 + strike * 0.16);
      tgt.shRx = -0.15 - antic * 1.65 + strike * 2.1;
      tgt.shRz = (tgt.shRz || 0) + (-antic * 0.35 + strike * 0.45);
      tgt.elR = 0.15 + antic * 0.65 + strike * 0.85;
      tgt.shLx = -0.48 - antic * 0.42;
      tgt.elL = 0.82 + strike * 0.15;
      tgt.hipRx = (tgt.hipRx || 0) + strike * 0.18;
      tgt.rootY = (tgt.rootY || 0) + (-strike * 0.06 + antic * 0.04);
    }
  },
  {
    id: 'thrust',
    phase: { anticEnd: 0.22, strikeEnd: 0.44, strikePeak: 1.18 },
    apply(tgt, ph) {
      const { antic, strike } = ph;
      tgt.torsoRY = (tgt.torsoRY || 0) + (-antic * 0.25 + strike * 0.35);
      tgt.torsoRX = (tgt.torsoRX || 0) + (-antic * 0.08 + strike * 0.22);
      tgt.headRY = (tgt.headRY || 0) + (-antic * 0.12 + strike * 0.18);
      tgt.shRx = -0.55 - antic * 0.85 + strike * 1.85;
      tgt.shRz = (tgt.shRz || 0) + (-antic * 0.25 + strike * 0.18);
      tgt.elR = 0.42 + antic * 0.28 + strike * 0.48;
      tgt.shLx = -0.38 - antic * 0.15 + strike * 0.35;
      tgt.shLz = -0.12 - strike * 0.08;
      tgt.elL = 0.58 + strike * 0.28;
      tgt.hipRx = (tgt.hipRx || 0) + strike * 0.08;
      tgt.hipRz = (tgt.hipRz || 0) + strike * 0.06;
      tgt.rootY = (tgt.rootY || 0) + (-strike * 0.02);
    }
  }
];

function swordSwingFactor(attackT, variantIdx) {
  if (attackT < 0) return 0;
  const v = SWORD_SWING_VARIANTS[variantIdx % SWORD_SWING_VARIANTS.length] || SWORD_SWING_VARIANTS[0];
  const ph = meleeSwingPhase(Math.min(attackT / SWORD_SWING_DURATION, 1), v.phase);
  return ph.strike + ph.antic * 0.22;
}

function meleeSwingFactor(char, attackT) {
  if (attackT < 0 || charIsRanged(char)) return 0;
  if (char.weaponDef && char.weaponDef.id === 'sword') {
    const vi = char.anim ? char.anim.swordSwingVariant : 0;
    return swordSwingFactor(attackT, vi);
  }
  return 1;
}

function applySwordAttackPose(tgt, k, variantIdx) {
  const v = SWORD_SWING_VARIANTS[variantIdx % SWORD_SWING_VARIANTS.length] || SWORD_SWING_VARIANTS[0];
  v.apply(tgt, meleeSwingPhase(k, v.phase));
}

const LASER_RIFLE_DURATION = 0.38;

const LASER_RIFLE_VARIANTS = [
  {
    id: 'burst',
    phase: { anticEnd: 0.1, strikeEnd: 0.34, strikePeak: 1.12 },
    apply(tgt, ph, canAim, ch) {
      const { strike } = ph;
      const kick = (strike > 0.52 && strike < 0.68) ? 0.26 : (strike > 0.72 && strike < 0.86) ? 0.2 : strike * 0.1;
      if (canAim) {
        tgt.shRx = (tgt.shRx || 0) + kick * 0.34;
        tgt.elR = (tgt.elR || 0) + kick * 0.1;
        tgt.torsoRX = (tgt.torsoRX || 0) + kick * 0.18;
      } else if (charIs2H(ch)) {
        const w = Math.min(strike / 0.22, 1) * (1 - Math.max(0, (strike - 0.72) / 0.28));
        tgt.shRx = -1.42 * w + kick * 0.46; tgt.shRz = -0.2 * w; tgt.elR = 0.46 * w + 0.12;
        tgt.shLx = -1.18 * w; tgt.shLz = -0.26 * w; tgt.elL = 0.92 * w;
      }
    }
  },
  {
    id: 'heavy',
    phase: { anticEnd: 0.14, strikeEnd: 0.4, strikePeak: 1.28 },
    apply(tgt, ph, canAim, ch) {
      const { antic, strike } = ph;
      const kick = strike * 0.34 + antic * 0.08;
      tgt.torsoRX = (tgt.torsoRX || 0) - kick * 0.28;
      tgt.headRX = (tgt.headRX || 0) - kick * 0.12;
      if (canAim) {
        tgt.shRx = (tgt.shRx || 0) + kick * 0.42;
        tgt.elR = (tgt.elR || 0) + kick * 0.14;
      } else if (charIs2H(ch)) {
        const w = Math.min(strike / 0.26, 1);
        tgt.shRx = -1.55 * w - kick * 0.35; tgt.shRz = -0.24 * w; tgt.elR = 0.52 * w + kick * 0.18;
        tgt.shLx = -1.28 * w; tgt.shLz = -0.32 * w; tgt.elL = 0.98 * w;
      }
    }
  },
  {
    id: 'snap',
    phase: { anticEnd: 0.08, strikeEnd: 0.24, strikePeak: 0.95 },
    apply(tgt, ph, canAim, ch) {
      const { strike } = ph;
      const kick = strike * 0.22;
      if (canAim) {
        tgt.shRx = (tgt.shRx || 0) + kick * 0.22;
        tgt.elR = (tgt.elR || 0) + kick * 0.06;
        tgt.torsoRX = (tgt.torsoRX || 0) + kick * 0.1;
      } else if (charIs2H(ch)) {
        const w = Math.min(strike / 0.18, 1) * (1 - Math.max(0, (strike - 0.55) / 0.45));
        tgt.shRx = -1.05 * w + kick * 0.28; tgt.shRz = -0.14 * w; tgt.elR = 0.34 * w + 0.08;
        tgt.shLx = -0.95 * w; tgt.shLz = -0.2 * w; tgt.elL = 0.72 * w;
      }
    }
  },
  {
    id: 'sweep',
    phase: { anticEnd: 0.11, strikeEnd: 0.36, strikePeak: 1.05 },
    apply(tgt, ph, canAim, ch) {
      const { antic, strike } = ph;
      const kick = strike * 0.24;
      const side = ((ch.anim && ch.anim.laserFireVariant) || 0) % 2 ? 1 : -1;
      tgt.torsoRY = (tgt.torsoRY || 0) + side * strike * 0.14;
      if (canAim) {
        tgt.shRx = (tgt.shRx || 0) + kick * 0.28;
        tgt.shRz = (tgt.shRz || 0) + side * strike * 0.12;
        tgt.elR = (tgt.elR || 0) + kick * 0.08;
      } else if (charIs2H(ch)) {
        const w = Math.min(strike / 0.2, 1);
        tgt.shRx = -1.28 * w + kick * 0.32;
        tgt.shRz = (-0.18 + side * strike * 0.16) * w;
        tgt.elR = 0.4 * w + 0.1;
        tgt.shLx = -1.12 * w; tgt.shLz = (-0.24 + side * 0.08) * w; tgt.elL = 0.86 * w;
      }
    }
  }
];

function applyLaserRifleRecoilPose(tgt, k, variantIdx, canAim, ch) {
  const v = LASER_RIFLE_VARIANTS[variantIdx % LASER_RIFLE_VARIANTS.length] || LASER_RIFLE_VARIANTS[0];
  v.apply(tgt, meleeSwingPhase(k, v.phase), canAim, ch);
}

function laserRifleFireFactor(attackT, variantIdx) {
  if (attackT < 0) return 0;
  const v = LASER_RIFLE_VARIANTS[variantIdx % LASER_RIFLE_VARIANTS.length] || LASER_RIFLE_VARIANTS[0];
  const ph = meleeSwingPhase(Math.min(attackT / LASER_RIFLE_DURATION, 1), v.phase);
  return ph.strike + ph.antic * 0.15;
}

function buildCharacter(params, opts){
  opts = opts || {};
  const weaponEquipped = opts.weaponEquipped !== false;
  const withOutlines = opts.outlines !== false;
  const cls = CLASSES[params.classIdx];
  const female = params.body===1;
  const skin = SKIN_TONES[params.skin];
  const gear = GEAR_COLORS[params.gear];
  const hair = HAIR_COLORS[params.hair];

  const skinM = std(skin), gearM = std(gear), hairM = std(hair);
  const gearDark = std(shade(gear,.55)), gearLite = std(shade(gear,1.25));
  const underM = std(0xc9cfd8);                       // grey undersuit (two-tone, like the reference)
  const accM = std(cls.accent); accM.emissive = new THREE.Color(shade(cls.accent,.25));
  const darkM = std(0x2c3038), bootM = std(0x4a5058), metalM = std(0x9aa3ad);

  // proportions (chibi: big head, sturdy limbs)
  const shoulderW = female? .46 : .56;
  const torsoW = female? .42 : .52, torsoH=.58, torsoD=.28;
  const hipY = .92;

  const group = new THREE.Group();
  const j = {};

  // hips root (vertical bob applied here)
  j.hips = new THREE.Group(); j.hips.position.y = hipY; group.add(j.hips);

  // Mesh face is +Z; in play the avatar yaws ~PI to face -Z. Flip X sides so shR / weapon
  // grip on -X local maps to world +X (the player's right hand).
  const RIG_X = -1;
  const rigX = (side) => side * RIG_X;

  // ----- legs -----
  function leg(side){ // side: -1 left, 1 right (semantic, before rigX)
    const hipJ = new THREE.Group();
    hipJ.position.set(rigX(side)*(torsoW*.27), 0, 0);
    const upper = box(.19,.36,.21,gearM); upper.position.y=-.18; hipJ.add(upper);
    const thighPanel = box(.21,.2,.05,gearDark); thighPanel.position.set(0,-.16,.11); hipJ.add(thighPanel);
    const thighStrap = box(.21,.05,.23,darkM); thighStrap.position.y=-.3; hipJ.add(thighStrap);
    const kneeJ = new THREE.Group(); kneeJ.position.y=-.37; hipJ.add(kneeJ);
    const lower = box(.17,.33,.19,underM); lower.position.y=-.165; kneeJ.add(lower);
    const kneePad = box(.19,.12,.07,accM); kneePad.position.set(0,-.04,.08); kneeJ.add(kneePad);
    const shin = box(.19,.18,.05,gearLite); shin.position.set(0,-.21,.09); kneeJ.add(shin);
    // layered boot: cuff + body + toe cap + sole
    const cuff = box(.21,.07,.22,darkM); cuff.position.set(0,-.32,0); kneeJ.add(cuff);
    const boot = box(.2,.12,.28,bootM); boot.position.set(0,-.39,.03); kneeJ.add(boot);
    const toe  = box(.2,.08,.1,gearLite); toe.position.set(0,-.41,.16); kneeJ.add(toe);
    const sole = box(.22,.04,.32,darkM); sole.position.set(0,-.46,.04); kneeJ.add(sole);
    // jet flame (fly state)
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(.07,.3,6),
      new THREE.MeshBasicMaterial({color:0x6fe3ff,transparent:true,opacity:.85})
    );
    flame.rotation.x=Math.PI; flame.position.set(0,-.6,.04); flame.visible=false;
    kneeJ.add(flame);
    j.hips.add(hipJ);
    return {hipJ, kneeJ, flame};
  }
  const L = leg(-1), R = leg(1); // hipL / hipR semantics unchanged
  j.hipL=L.hipJ; j.kneeL=L.kneeJ; j.hipR=R.hipJ; j.kneeR=R.kneeJ;
  const flames=[L.flame,R.flame];

  // ----- torso -----
  j.torso = new THREE.Group(); j.hips.add(j.torso);
  const chestTex = chestTexture(gear, cls.accent);
  const torsoMats = [gearM,gearM,gearM,gearM,
    new THREE.MeshStandardMaterial({map:chestTex,roughness:.8,metalness:.15}), gearM];
  const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoW,torsoH,torsoD), torsoMats);
  torso.position.y = torsoH/2; j.torso.add(torso);
  // harness straps over the shoulders + chest unit
  [-1,1].forEach(s=>{
    const strap = box(.06,.34,.03,darkM);
    strap.position.set(s*torsoW*.27, torsoH*.7, torsoD/2+.01); j.torso.add(strap);
  });
  const chestUnit = box(.16,.12,.06,darkM); chestUnit.position.set(0,torsoH*.66,torsoD/2+.03); j.torso.add(chestUnit);
  const chestLight = box(.05,.05,.02,new THREE.MeshBasicMaterial({color:cls.accent}));
  chestLight.position.set(0,torsoH*.66,torsoD/2+.07); j.torso.add(chestLight);
  // belt + pouches
  const belt = box(torsoW+.04,.07,torsoD+.04,darkM); belt.position.y=.035; j.torso.add(belt);
  const buckle = box(.1,.06,.03,metalM); buckle.position.set(0,.035,torsoD/2+.03); j.torso.add(buckle);
  const pouchL = box(.1,.1,.06,gearDark); pouchL.position.set(-torsoW*.36,.0,torsoD/2+.02); j.torso.add(pouchL);
  const pouchR = box(.1,.1,.06,gearDark); pouchR.position.set(torsoW*.36,.0,torsoD/2+.02); j.torso.add(pouchR);
  // backpack: main pack + twin tanks + antenna + light
  const pack = box(torsoW*.7,.36,.13,gearDark); pack.position.set(0,torsoH*.55,-torsoD/2-.07); j.torso.add(pack);
  [-1,1].forEach(s=>{
    const tank = box(.1,.26,.1,metalM);
    tank.position.set(s*torsoW*.2, torsoH*.52, -torsoD/2-.17); j.torso.add(tank);
    const cap = box(.07,.04,.07,accM);
    cap.position.set(s*torsoW*.2, torsoH*.52+.15, -torsoD/2-.17); j.torso.add(cap);
  });
  const antenna = box(.025,.3,.025,darkM); antenna.position.set(torsoW*.32, torsoH*.85, -torsoD/2-.06); j.torso.add(antenna);
  const antTip = box(.045,.045,.045,new THREE.MeshBasicMaterial({color:0xff5544}));
  antTip.position.set(torsoW*.32, torsoH*.85+.17, -torsoD/2-.06); j.torso.add(antTip);
  const packLight = box(.07,.07,.03,new THREE.MeshBasicMaterial({color:cls.accent}));
  packLight.position.set(0,torsoH*.62,-torsoD/2-.15); j.torso.add(packLight);

  // ----- arms -----
  function arm(side){
    const shJ = new THREE.Group();
    shJ.position.set(rigX(side)*(shoulderW/2+.08), torsoH-.06, 0);
    // layered shoulder pad + accent stripe
    const pad = box(.2,.15,.22,gearM); pad.position.y=-.03; shJ.add(pad);
    const padTop = box(.16,.06,.18,gearLite); padTop.position.y=.05; shJ.add(padTop);
    const padStripe = box(.21,.04,.23,accM); padStripe.position.y=-.1; shJ.add(padStripe);
    const upper = box(.15,.3,.16,gearM); upper.position.y=-.2; shJ.add(upper);
    const armBand = box(.17,.05,.18,darkM); armBand.position.y=-.3; shJ.add(armBand);
    const elJ = new THREE.Group(); elJ.position.y=-.36; shJ.add(elJ);
    const elbowPad = box(.15,.08,.1,gearDark); elbowPad.position.set(0,-.02,-.05); elJ.add(elbowPad);
    const lower = box(.13,.28,.14,underM); lower.position.y=-.14; elJ.add(lower);
    const cuffA = box(.15,.06,.16,gearM); cuffA.position.y=-.24; elJ.add(cuffA);
    // glove: dark hand + knuckle plate
    const hand = box(.14,.1,.15,darkM); hand.position.y=-.32; elJ.add(hand);
    const knuckle = box(.1,.04,.06,metalM); knuckle.position.set(0,-.3,.08); elJ.add(knuckle);
    const grip = new THREE.Group(); grip.position.set(0,-.32,.02); elJ.add(grip);
    j.torso.add(shJ);
    return {shJ, elJ, grip};
  }
  const AL = arm(-1), AR = arm(1);
  j.shL = AL.shJ; j.elL = AL.elJ; j.shR = AR.shJ; j.elR = AR.elJ;
  const PRIMARY_HAND = 'right';
  const weaponGrip = PRIMARY_HAND === 'right' ? AR.grip : AL.grip;

  // ----- head (chibi: oversized) -----
  j.neck = new THREE.Group(); j.neck.position.y = torsoH+.04; j.torso.add(j.neck);
  const HW=.58, HH=.54;     // head width/height
  const faceTex = faceTexture(skin, hair);
  const headMats = [skinM,skinM,skinM,skinM,
    new THREE.MeshStandardMaterial({map:faceTex,roughness:.8,metalness:.05}), skinM];
  const head = new THREE.Mesh(roundedBoxGeo(HW,HH,HW*.92,.08), headMats);
  head.position.y=HH/2+.04; j.neck.add(head);
  const topY = HH+.04;      // top of head

  // voxel-clump hair helper: scattered cubes for that handmade voxel look
  const RND = rng(1337 + params.deco*97 + params.hair*7);
  function clump(cx,cy,cz,n,spread,sMin,sMax,mat){
    for(let i=0;i<n;i++){
      const s = sMin + RND()*(sMax-sMin);
      const b = box(s,s,s,mat);
      b.position.set(cx+(RND()-.5)*spread.x, cy+(RND()-.5)*spread.y, cz+(RND()-.5)*spread.z);
      b.rotation.y = (RND()-.5)*.3;
      j.neck.add(b);
    }
  }

  const hairDark = std(shade(hair,.7));
  const deco = params.deco;
  if(deco===1){ // short: cap of clumps + side-swept fringe
    const cap = box(HW+.05,.1,HW*.92+.05,hairM); cap.position.y=topY+.03; j.neck.add(cap);
    clump(0, topY+.08, 0, 16, {x:HW*.85,y:.07,z:HW*.75}, .07,.13, hairM);
    clump(0, topY-.02, -HW*.42, 8, {x:HW*.8,y:.1,z:.06}, .07,.12, hairDark);
    const fringe = box(HW*.55,.08,.07,hairM); fringe.position.set(-HW*.18,topY-.01,HW*.43); j.neck.add(fringe);
  } else if(deco===2){ // mohawk: jittered spine of cubes
    for(let i=0;i<6;i++){
      const s=.1+RND()*.06;
      const b=box(s, .14+RND()*.1, s, i%2? hairM:hairDark);
      b.position.set((RND()-.5)*.03, topY+.08+RND()*.04, HW*.35 - i*HW*.15);
      j.neck.add(b);
    }
    // shaved sides hint
    const base = box(.12,.05,HW*.85,hairDark); base.position.y=topY+.01; j.neck.add(base);
  } else if(deco===3){ // long: cap + clumped back fall + side strands
    const cap = box(HW+.05,.1,HW*.92+.05,hairM); cap.position.y=topY+.03; j.neck.add(cap);
    clump(0, topY+.07, 0, 14, {x:HW*.85,y:.06,z:HW*.7}, .07,.13, hairM);
    clump(0, .26, -HW*.5, 12, {x:HW*.8,y:.4,z:.08}, .08,.14, hairM);
    clump(0, .1, -HW*.5, 5, {x:HW*.6,y:.12,z:.07}, .07,.11, hairDark);
    [-1,1].forEach(s=>{
      const strand = box(.09,.36,.12,hairM); strand.position.set(s*(HW/2+.03),.3,HW*.12); j.neck.add(strand);
      const tip = box(.07,.1,.1,hairDark); tip.position.set(s*(HW/2+.03),.1,HW*.12); j.neck.add(tip);
    });
  } else if(deco===4){ // helmet: shell + visor + side vents + fin + antenna
    const hm = box(HW+.1,HH+.06,HW*.92+.08,gearM); hm.position.set(0,HH/2+.07,-.01); j.neck.add(hm);
    const visor = box(HW*.8,.2,.05,new THREE.MeshStandardMaterial({color:0x16323e,roughness:.2,metalness:.7,emissive:0x0a3a4a}));
    visor.position.set(0,HH*.62,HW*.46+.05); j.neck.add(visor);
    [-1,1].forEach(s=>{
      const vent = box(.05,.14,.14,gearDark); vent.position.set(s*(HW/2+.07),HH*.5,0); j.neck.add(vent);
      const ventAcc = box(.06,.04,.15,accM); ventAcc.position.set(s*(HW/2+.07),HH*.62,0); j.neck.add(ventAcc);
    });
    const fin = box(.07,.1,.36,accM); fin.position.set(0,HH+.12,-.06); j.neck.add(fin);
    const hAnt = box(.02,.18,.02,darkM); hAnt.position.set(-HW*.38,HH+.14,-.1); j.neck.add(hAnt);
  } else if(deco===5){ // curly: big voxel puff (the fun one)
    clump(0, topY+.12, 0, 34, {x:HW+.15,y:.26,z:HW+.05}, .09,.17, hairM);
    clump(0, topY+.02, 0, 14, {x:HW+.2,y:.1,z:HW+.1}, .07,.12, hairDark);
    clump(0, HH*.6, -HW*.48, 8, {x:HW*.9,y:.18,z:.08}, .08,.13, hairM);
  }

  // weapon (selected independently of class; -1 = empty hands)
  let weapon = null, wDef = null, socket = null, twoHanded = false;
  let muzzleFlash = null, beam = null;
  if (params.weapon >= 0) {
    wDef = WEAPONS[params.weapon];
    weapon = buildWeapon(wDef, cls.accent);
    mirrorWeaponForTpGrip(weapon, wDef);
    weapon.visible = weaponEquipped;
    weaponGrip.add(weapon);
    cacheWeaponGripAim(weapon, weaponGrip);
    socket = weapon.userData.socket || null;
    twoHanded = !!weapon.userData.twoHanded;
    muzzleFlash = weapon.userData.flash || null;
    beam = weapon.userData.beam || null;
  }

  // hover bike (ride state prop)
  const bike = new THREE.Group();
  const bbody = box(.42,.26,1.5,std(0x32404e)); bike.add(bbody);
  const bseat = box(.34,.08,.5,darkM); bseat.position.set(0,.17,-.1); bike.add(bseat);
  const bfin = box(.08,.3,.4,std(cls.accent)); bfin.position.set(0,.1,-.8); bike.add(bfin);
  const bbar = box(.5,.06,.06,std(0x9aa3ad)); bbar.position.set(0,.3,.62); bike.add(bbar);
  const bglow = new THREE.Mesh(new THREE.BoxGeometry(.3,.05,1.1), new THREE.MeshBasicMaterial({color:0x57d6f0,transparent:true,opacity:.6}));
  bglow.position.y=-.18; bike.add(bglow);
  bike.position.y=.55; bike.visible=false;
  group.add(bike);

  if (withOutlines) addOutlines(group);
  return { params: Object.assign({}, params), group, j, weapon, weaponDef: wDef, faceTex,
           primaryHand: PRIMARY_HAND, weaponGrip, supportGrip: PRIMARY_HAND === 'right' ? AL.grip : AR.grip,
           socket, twoHanded,
           muzzleFlash, beam,
           flames, bike, hipY,
           anim: { state: 'idle', elapsed: 0, attackT: -1, swordSwingVariant: 0, laserFireVariant: 0, ikW: 0,
                   cur: {}, curCharY: 0, weaponEquipped: weaponEquipped && params.weapon >= 0 } };
}

// ---------- relaxed pose (semantic knobs → mirrored shoulder euler) ----------
const RELAX_TUNE_KEY = 'pjboy.voxelRelaxTune.v1';
const RELAX_POSE_DEFAULTS = {
  armSpread: 0,      // shoulder roll — arms away from torso
  armHang: 0,        // shoulder pitch — + hangs at sides; − folds behind back on mirrored rig
  elbowBend: 0.08,   // forearm bend (always applied as -abs on X)
  elbowFlare: 0,     // forearm Z flare — pushes hands away from body
  sway: 0.02,
  swayHz: 1.6,
  headSway: 0.08,
  rootBob: 0.012
};
const RELAX_POSE_SPECS = [
  { key: 'armSpread', label: 'Arm spread', min: 0, max: 0.55, step: 0.01,
    hint: 'Shoulders roll out — arms farther from torso.' },
  { key: 'armHang', label: 'Arm hang', min: -0.35, max: 0.35, step: 0.01,
    hint: 'Shoulder pitch. Keep near 0 for arms beside body; negative folds behind back.' },
  { key: 'elbowBend', label: 'Elbow bend', min: 0, max: 0.45, step: 0.01,
    hint: 'Forearm bend amount.' },
  { key: 'elbowFlare', label: 'Elbow flare', min: -0.5, max: 0.5, step: 0.01,
    hint: 'Forearm twist — pushes hands away from (+) or into (−) the body.' },
  { key: 'sway', label: 'Arm sway', min: 0, max: 0.08, step: 0.005,
    hint: 'Idle shoulder sway amplitude.' },
  { key: 'headSway', label: 'Head sway', min: 0, max: 0.25, step: 0.01, hint: 'Head turn sway.' },
  { key: 'rootBob', label: 'Body bob', min: 0, max: 0.04, step: 0.002, hint: 'Vertical idle bob.' }
];

let _relaxTune = null;

function defaultRelaxPoseTune() {
  return Object.assign({}, RELAX_POSE_DEFAULTS);
}

function clampRelaxTune(t) {
  const out = defaultRelaxPoseTune();
  RELAX_POSE_SPECS.forEach((spec) => {
    const v = Number(t[spec.key]);
    if (!Number.isFinite(v)) return;
    out[spec.key] = THREE.MathUtils.clamp(v, spec.min, spec.max);
  });
  if (Number.isFinite(t.swayHz)) out.swayHz = THREE.MathUtils.clamp(t.swayHz, 0.5, 4);
  return out;
}

function loadRelaxPoseTune() {
  try {
    const raw = localStorage.getItem(RELAX_TUNE_KEY);
    if (!raw) return defaultRelaxPoseTune();
    return clampRelaxTune(Object.assign(defaultRelaxPoseTune(), JSON.parse(raw)));
  } catch (_) {
    return defaultRelaxPoseTune();
  }
}

function saveRelaxPoseTune(tune) {
  _relaxTune = clampRelaxTune(tune || _relaxTune || defaultRelaxPoseTune());
  try {
    localStorage.setItem(RELAX_TUNE_KEY, JSON.stringify(_relaxTune));
  } catch (_) { /* ignore */ }
  return _relaxTune;
}

function getRelaxPoseTune() {
  if (!_relaxTune) _relaxTune = loadRelaxPoseTune();
  return _relaxTune;
}

function setRelaxPoseTune(patch, persist) {
  _relaxTune = clampRelaxTune(Object.assign({}, getRelaxPoseTune(), patch || {}));
  if (persist) saveRelaxPoseTune(_relaxTune);
  return _relaxTune;
}

// Maps semantic arm knobs to mirrored shoulder euler channels (shLx/shLz, shRx/shRz).
function applyRelaxedArms(o, t, tune) {
  tune = tune || getRelaxPoseTune();
  const s = Math.sin(t * (tune.swayHz || 1.6)) * (tune.sway || 0);
  o.shLz = -(tune.armSpread || 0);
  o.shRz = tune.armSpread || 0;
  o.shLx = (tune.armHang || 0) + s;
  o.shRx = -(tune.armHang || 0) - s;
  o.elL = tune.elbowBend || 0;
  o.elR = tune.elbowBend || 0;
}

const POSES = {
  idle(t,o){
    o.rootY = Math.sin(t*2)*.02;
    o.headRY = Math.sin(t*.6)*.18;
    o.shLz = -.25; o.shRz = .25;
    o.shLx = Math.sin(t*2)*.03; o.shRx = -Math.sin(t*2)*.03;
    o.elL = .08; o.elR = .08;
    if(_poseWeaponEquipped && charIsRifle(_poseCh)) o.headRY = Math.sin(t*.6)*.08;
  },
  relaxed(t,o){
    const tune = getRelaxPoseTune();
    o.rootY = Math.sin(t * (tune.swayHz || 1.6)) * (tune.rootBob || 0);
    o.headRY = Math.sin(t * 0.45) * (tune.headSway || 0);
    applyRelaxedArms(o, t, tune);
  },
  walk(t,o){
    const f=t*6, s=Math.sin(f);
    o.rootY = Math.abs(Math.cos(f))*.035;
    o.hipLx = s*.55; o.hipRx = -s*.55;
    o.kneeL = Math.max(0,-s)*.9; o.kneeR = Math.max(0,s)*.9;
    o.shLx = -s*.45; o.shRx = s*.45;
    o.elL = .25; o.elR = .25;
    o.torsoRX = .06;
  },
  run(t,o){
    const f=t*10, s=Math.sin(f);
    o.rootY = Math.abs(Math.cos(f))*.07;
    o.torsoRX = .3;
    o.hipLx = s*.95; o.hipRx = -s*.95;
    o.kneeL = Math.max(0,-s)*1.5+.2; o.kneeR = Math.max(0,s)*1.5+.2;
    o.shLx = -s*.9; o.shRx = s*.9;
    o.elL = 1.3; o.elR = 1.3;
    o.headRX = -.15;
  },
  jump(t,o){
    const ph = (t*1.1)%1;
    if(ph<.18){           // crouch
      const k=ph/.18;
      o.rootY = -.22*k;
      o.kneeL=o.kneeR = 1.4*k; o.hipLx=o.hipRx = -.7*k;
      o.shLx=o.shRx = .6*k; o.torsoRX=.35*k;
    } else if(ph<.7){     // airborne
      const k=(ph-.18)/.52;
      o.rootY = Math.sin(k*Math.PI)*1.15 - .05;
      o.kneeL=o.kneeR = .9-.6*k; o.hipLx=o.hipRx = -.5+.2*k;
      o.shLx=o.shRx = -2.6*Math.sin(k*Math.PI*.8);
      o.shLz=-.25; o.shRz=.25;
      o.torsoRX = -.08;
    } else {              // land + recover
      const k=(ph-.7)/.3;
      o.rootY = -.16*(1-k);
      o.kneeL=o.kneeR = 1.0*(1-k); o.hipLx=o.hipRx=-.5*(1-k);
      o.shLx=o.shRx=.4*(1-k);
    }
  },
  fly(t,o){
    o.charY = .85 + Math.sin(t*1.6)*.06;
    o.torsoRX = .35;
    o.hipLx = .5; o.hipRx = .5;
    o.kneeL = .55+Math.sin(t*2)*.05; o.kneeR = .55-Math.sin(t*2)*.05;
    o.shLx = -.5; o.shLz = -.7; o.elL=.2;
    if(!_poseWeaponEquipped){ o.headRX = -.5; o.shRx = -2.8; o.shRz = .5; o.elR = .1; }
  },
  swim(t,o){
    o.charY = 1.05; o.charRX = -1.25;
    o.headRX = -.9;
    const f=t*4.2;
    o.shLx = -(f % (Math.PI*2));            // continuous crawl circles
    o.shRx = -((f+Math.PI) % (Math.PI*2));
    o.shLz=-.18; o.shRz=.18; o.elL=.15; o.elR=.15;
    o.hipLx = Math.sin(f*2)*.45; o.hipRx = -Math.sin(f*2)*.45;  // flutter kick
    o.kneeL = .25; o.kneeR = .25;
    o.rootY = Math.sin(t*2)*.04;
  },
  ride(t,o){
    o.charY = -.12;
    o.hipLx = -1.5; o.hipRx = -1.5;
    o.hipLz = .35; o.hipRz = -.35;
    o.kneeL = 1.5; o.kneeR = 1.5;
    o.torsoRX = .3; o.headRX = -.25;
    o.shLx = -.95; o.shRx = -.95; o.shLz=.15; o.shRz=-.15;
    o.elL = .25; o.elR = .25;
    o.rootY = Math.sin(t*3)*.015;
  },
};

// ---------- aim (aim-offset layer, engine style) ----------
function armAimFromLocal(lyaw, lpitch) {
  const yaw = THREE.MathUtils.clamp(lyaw, -1.15, 1.15);
  const pitch = THREE.MathUtils.clamp(lpitch, -1.1, 1.1);
  return { yaw, pitch };
}

function aimOverlay(o, aimX, aimY, ch, aimOpts) {
  aimOpts = aimOpts || {};
  const lyaw = typeof aimOpts.localAimYaw === 'number' ? aimOpts.localAimYaw
    : THREE.MathUtils.clamp(aimX, -1, 1) * (Math.PI * 0.42);
  const lpitch = typeof aimOpts.localAimPitch === 'number' ? aimOpts.localAimPitch
    : THREE.MathUtils.clamp(aimY, -1, 1) * (Math.PI * 0.42);
  const a = armAimFromLocal(lyaw, lpitch);
  o.torsoRY = a.yaw * 0.55;
  o.headRY = a.yaw * 0.42;
  o.headRX = a.pitch * 0.55;
  o.torsoRX = (o.torsoRX || 0) + a.pitch * 0.12;
  if (aimOpts.skipArms) return;
  if (charIsRanged(ch) && charIs2H(ch)) {
    o.shRz = a.yaw * 0.95 - 0.08;
    o.shRx = -0.35 - a.pitch * 0.88;
    o.elR = 0.62 + Math.abs(a.pitch) * 0.2;
    o.shLx = -0.52 - a.pitch * 0.28;
    o.shLz = -0.24 - a.yaw * 0.2;
    o.elL = 0.78 + Math.abs(a.yaw) * 0.1;
  } else if (charIsRanged(ch)) {
    o.shRz = a.yaw * 0.9 + 0.06;
    o.shRx = -0.42 - a.pitch * 0.95;
    o.elR = 0.28 + Math.abs(a.pitch) * 0.12;
  } else {
    const wid = ch.weaponDef.id;
    if (wid === 'sword') {
      o.torsoRY = (o.torsoRY || 0) + 0.08;
      o.shRz = a.yaw * 0.45 + 0.04;
      o.shRx = -0.38 - a.pitch * 0.48;
      o.elR = 0.52 + Math.abs(a.pitch) * 0.1;
      o.shLx = -0.42 - a.pitch * 0.14;
      o.shLz = -0.22 - a.yaw * 0.12;
      o.elL = 0.72;
    } else if (wid === 'pickaxe') {
      o.shRz = a.yaw * 0.55 - 0.18;
      o.shRx = -0.48 - a.pitch * 0.6;
      o.elR = 0.78 + Math.abs(a.pitch) * 0.18;
      o.shLx = -0.52 - a.pitch * 0.16;
      o.shLz = -0.24 - a.yaw * 0.14;
      o.elL = 0.9;
    } else {
      o.shRz = a.yaw * 0.65 + 0.15;
      o.shRx = -0.58 - a.pitch * 0.7;
      o.elR = 0.68 + Math.abs(a.pitch) * 0.16;
      o.shLx = -0.4 - a.pitch * 0.1;
      o.shLz = -0.26 - a.yaw * 0.12;
      o.elL = 0.4;
    }
  }
}

const KEYS = ['rootY','charRX','torsoRX','torsoRY','headRX','headRY',
  'shLx','shLz','elL','shRx','shRz','elR','hipLx','hipLz','kneeL','hipRx','hipRz','kneeR'];

let _poseCh = null;
let _poseWeaponEquipped = false;

function charIsRanged(ch) { return !!(ch && ch.weaponDef && ch.weaponDef.ranged); }
function charIs2H(ch) { return !!(ch && ch.twoHanded); }
function charIsRifle(ch) { return charIsRanged(ch) && charIs2H(ch); }

function holdPose(o, blend, ch) {
  if (!ch || !ch.weaponDef) return;
  const b = THREE.MathUtils.clamp(blend || 0, 0, 1);
  const lerp = (from, to) => from + (to - from) * b;
  if (charIsRanged(ch) && charIs2H(ch)) {
    o.shRx = lerp(o.shRx != null ? o.shRx : -0.25, -1.05);
    o.shRz = lerp(o.shRz != null ? o.shRz : 0.25, -0.22);
    o.elR = lerp(o.elR != null ? o.elR : 0.08, 0.5);
    o.shLx = lerp(o.shLx != null ? o.shLx : 0, -0.68);
    o.shLz = lerp(o.shLz != null ? o.shLz : -0.25, -0.3);
    o.elL = lerp(o.elL != null ? o.elL : 0.08, 0.92);
  } else if (charIsRanged(ch)) {
    o.shRx = lerp(o.shRx != null ? o.shRx : -0.25, -1.3);
    o.shRz = lerp(o.shRz != null ? o.shRz : 0.25, 0.12);
    o.elR = lerp(o.elR != null ? o.elR : 0.08, 0.12);
  } else if (ch.weaponDef.id === 'pickaxe') {
    o.shRx = lerp(o.shRx != null ? o.shRx : -0.25, -0.9);
    o.shRz = lerp(o.shRz != null ? o.shRz : 0.25, -0.25);
    o.elR = lerp(o.elR != null ? o.elR : 0.08, 0.9);
    o.shLx = lerp(o.shLx != null ? o.shLx : 0, -0.62);
    o.shLz = lerp(o.shLz != null ? o.shLz : -0.25, -0.28);
    o.elL = lerp(o.elL != null ? o.elL : 0.08, 0.96);
  } else if (ch.weaponDef.id === 'sword') {
    o.shRx = lerp(o.shRx != null ? o.shRx : -0.25, -0.68);
    o.shRz = lerp(o.shRz != null ? o.shRz : 0.25, 0.06);
    o.elR = lerp(o.elR != null ? o.elR : 0.08, 0.58);
  } else {
    o.shRx = lerp(o.shRx != null ? o.shRx : -0.25, -1.2);
    o.elR = lerp(o.elR != null ? o.elR : 0.08, 0.5);
  }
}

// ---------- support-hand two-bone IK (off-hand glues to weapon foregrip socket) ----------
const _T=new THREE.Vector3(), _dir=new THREE.Vector3();
const _qAlign=new THREE.Quaternion(), _qSwing=new THREE.Quaternion(), _qPose=new THREE.Quaternion(), _qT=new THREE.Quaternion();
const _eul=new THREE.Euler();
const DOWN=new THREE.Vector3(0,-1,0), XAXIS=new THREE.Vector3(1,0,0);
const ARM_A=.36, ARM_B=.32;        // upper arm, elbow→palm
let ikW = 0;                       // blended IK weight

function twoBoneArmIK(sh, el, targetTorso, weight, shX, shZ, elPose) {
  _dir.copy(targetTorso).sub(sh.position);
  let d = _dir.length();
  d = THREE.MathUtils.clamp(d, .08, ARM_A + ARM_B - .01);
  _dir.normalize();
  const cosC = THREE.MathUtils.clamp((ARM_A * ARM_A + ARM_B * ARM_B - d * d) / (2 * ARM_A * ARM_B), -1, 1);
  const C = Math.acos(cosC);
  const al = Math.acos(THREE.MathUtils.clamp((ARM_A * ARM_A + d * d - ARM_B * ARM_B) / (2 * ARM_A * d), -1, 1));
  _qAlign.setFromUnitVectors(DOWN, _dir).multiply(_qSwing.setFromAxisAngle(XAXIS, al));
  _qPose.setFromEuler(_eul.set(shX, 0, shZ));
  sh.quaternion.copy(_qPose).slerp(_qAlign, weight);
  const ikEl = -(Math.PI - C);
  el.rotation.x = THREE.MathUtils.lerp(-Math.abs(elPose), ikEl, weight);
}

function primaryArmAimIK(j, weight, cur, charRef, worldAimDir) {
  if (!worldAimDir) return;
  const primaryRight = (charRef.primaryHand || 'right') === 'right';
  const sh = primaryRight ? j.shR : j.shL;
  const el = primaryRight ? j.elR : j.elL;
  const shX = primaryRight ? cur.shRx : cur.shLx;
  const shZ = primaryRight ? cur.shRz : cur.shLz;
  const elPose = primaryRight ? cur.elR : cur.elL;
  charRef.group.updateMatrixWorld(true);
  sh.getWorldPosition(_shW);
  _tgtW.copy(_shW).addScaledVector(worldAimDir, 1.12);
  _T.copy(_tgtW);
  j.torso.worldToLocal(_T);
  twoBoneArmIK(sh, el, _T, weight, shX, shZ, elPose);
}

function supportHandIK(j, weight, cur, charRef) {
  if (!charRef.socket) return;
  const primaryRight = (charRef.primaryHand || 'right') === 'right';
  const sh = primaryRight ? j.shL : j.shR;
  const el = primaryRight ? j.elL : j.elR;
  const shX = primaryRight ? cur.shLx : cur.shRx;
  const shZ = primaryRight ? cur.shLz : cur.shRz;
  const elPose = primaryRight ? cur.elL : cur.elR;
  charRef.group.updateMatrixWorld(true);
  charRef.socket.getWorldPosition(_T);
  j.torso.worldToLocal(_T);
  twoBoneArmIK(sh, el, _T, weight, shX, shZ, elPose);
}

function ensureWeaponOnPrimaryGrip(char) {
  if (!char || !char.weapon || !char.weaponGrip) return;
  if (char.weapon.parent !== char.weaponGrip) char.weaponGrip.add(char.weapon);
  if (char.weaponDef) mirrorWeaponForTpGrip(char.weapon, char.weaponDef);
  if (!char.weapon.userData.restMuzzleDirGrip) cacheWeaponGripAim(char.weapon, char.weaponGrip);
}

function normalizeParams(p) {
  const d = Object.assign({}, DEFAULT_PARAMS);
  if (!p || typeof p !== 'object') return d;
  ['classIdx','body','deco','hair','gear','skin','weapon'].forEach(k => {
    if (typeof p[k] === 'number' && isFinite(p[k])) d[k] = p[k]|0;
  });
  d.classIdx = ((d.classIdx % CLASSES.length) + CLASSES.length) % CLASSES.length;
  d.body = ((d.body % BODY_TYPES.length) + BODY_TYPES.length) % BODY_TYPES.length;
  d.deco = ((d.deco % HEAD_DECOS.length) + HEAD_DECOS.length) % HEAD_DECOS.length;
  d.hair = ((d.hair % HAIR_COLORS.length) + HAIR_COLORS.length) % HAIR_COLORS.length;
  d.gear = ((d.gear % GEAR_COLORS.length) + GEAR_COLORS.length) % GEAR_COLORS.length;
  d.skin = ((d.skin % SKIN_TONES.length) + SKIN_TONES.length) % SKIN_TONES.length;
  if (d.weapon !== -1) {
    d.weapon = ((d.weapon % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
  }
  return d;
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return normalizeParams(JSON.parse(raw));
  } catch (e) { return null; }
}

function saveParams(params) {
  const p = normalizeParams(params);
  localStorage.setItem(SAVE_KEY, JSON.stringify(p));
  return p;
}

function dispose(char) {
  if (!char || !char.group) return;
  char.group.traverse(o => {
    if (o.isMesh) {
      if (o.geometry && !o.userData.isOutline) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
        else { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      }
    }
  });
  if (char.group.parent) char.group.parent.remove(char.group);
}

function scaleToHeight(group, targetHeight) {
  const box = new THREE.Box3().setFromObject(group);
  const h = box.max.y - box.min.y;
  if (h > 0) group.scale.setScalar(targetHeight / h);
  group.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(group);
  group.position.y -= box2.min.y;
}

function initAnimState(char, weaponEquipped) {
  const anim = char.anim;
  anim.cur = {};
  KEYS.forEach(k => { anim.cur[k] = 0; });
  anim.curCharY = 0;
  anim.ikW = 0;
  anim.attackT = -1;
  anim.swordSwingVariant = 0;
  anim.laserFireVariant = 0;
  anim.elapsed = 0;
  anim.weaponEquipped = weaponEquipped !== false;
  anim.state = 'idle';
}

function update(char, state, dt, opts) {
  if (!char || !char.j) return;
  ensureWeaponOnPrimaryGrip(char);
  opts = opts || {};
  const anim = char.anim;
  const weaponEquipped = opts.weaponEquipped != null ? opts.weaponEquipped : anim.weaponEquipped;
  anim.weaponEquipped = weaponEquipped;
  anim.state = state || anim.state || 'idle';
  anim.elapsed += dt;
  if (typeof opts.attackT === 'number') anim.attackT = opts.attackT;
  const aiming = !!opts.aiming;
  const aimX = opts.aimX || 0;
  const aimY = opts.aimY || 0;
  let attackT = anim.attackT;

  const tgt = {}; KEYS.forEach(k => { tgt[k] = 0; });
  let charY = 0;
  _poseCh = char;
  _poseWeaponEquipped = weaponEquipped;
  const poseFn = POSES[anim.state] || POSES.idle;
  poseFn(anim.elapsed, tgt, char, weaponEquipped);
  if (typeof tgt.charY === 'number') charY = tgt.charY;

  const aimStrength = opts.aimBlend != null ? opts.aimBlend
    : (aiming ? 1 : (opts.alwaysAim ? 0.62 : 0));
  const canAim = aimStrength > 0.05 && weaponEquipped && anim.state !== 'swim'
    && anim.state !== 'ride';
  const aimLyaw = (opts.localAimYaw || 0) * aimStrength;
  const aimLpitch = (opts.localAimPitch || 0) * aimStrength;
  const aimWorldDir = opts.aimWorldDir || null;
  const useWorldAim = !!(canAim && aimWorldDir);
  if (canAim) aimOverlay(tgt, aimX * aimStrength, aimY * aimStrength, char, {
    localAimYaw: aimLyaw,
    localAimPitch: aimLpitch,
    skipArms: useWorldAim
  });

  let rifleKick = 0;
  if (attackT >= 0) {
    attackT += dt;
    if (charIsRanged(char)) {
      if (char.weaponDef && char.weaponDef.id === 'laser') {
        const d = LASER_RIFLE_DURATION, k = Math.min(attackT / d, 1);
        applyLaserRifleRecoilPose(tgt, k, char.anim.laserFireVariant || 0, canAim, char);
        if (attackT >= d) { attackT = -1; anim.attackT = -1; }
      } else {
      const d = .6, k = Math.min(attackT / d, 1);
      const kick = (k > .3 && k < .4) || (k > .5 && k < .6) ? .3 : 0;
      rifleKick = kick;
      if (canAim) {
        tgt.shRx = (tgt.shRx || 0) + kick * 0.32;
        tgt.elR = (tgt.elR || 0) + kick * 0.1;
        tgt.torsoRX = (tgt.torsoRX || 0) + kick * 0.22;
      } else {
        const aimW = Math.min(k / .25, 1) * (1 - Math.max(0, (k - .8) / .2));
        if (charIs2H(char)) {
          tgt.shRx = -1.5 * aimW + kick * .5; tgt.shRz = -.22 * aimW; tgt.elR = .5 * aimW + .15;
          tgt.shLx = -1.25 * aimW; tgt.shLz = -.3 * aimW; tgt.elL = 1.0 * aimW;
        } else {
          tgt.shRx = -1.55 * aimW + kick * .6; tgt.shRz = .12 * aimW; tgt.elR = .12 + .1 * aimW;
        }
        tgt.headRX = -.1 * aimW;
        tgt.torsoRX = (tgt.torsoRX || 0) + kick * .4;
      }
      if (attackT >= d) { attackT = -1; anim.attackT = -1; }
      }
    } else if (char.weaponDef && char.weaponDef.id === 'sword') {
      const d = SWORD_SWING_DURATION, k = Math.min(attackT / d, 1);
      applySwordAttackPose(tgt, k, char.anim.swordSwingVariant || 0);
      if (attackT >= d) { attackT = -1; anim.attackT = -1; }
    } else {
      const d = .55, k = Math.min(attackT / d, 1);
      if (k < .35) { const w = k / .35; tgt.shRx = -2.4 * w; tgt.elR = .3; tgt.torsoRX = (tgt.torsoRX || 0) - .15 * w; }
      else { const w = (k - .35) / .65; tgt.shRx = -2.4 + 3.1 * w; tgt.elR = .3 + .3 * w; tgt.torsoRX = (tgt.torsoRX || 0) + .25 * w; }
      if (attackT >= d) { attackT = -1; anim.attackT = -1; }
    }
    anim.attackT = attackT;
  }

  const a = 1 - Math.exp(-12 * dt);
  KEYS.forEach(k => { anim.cur[k] += (tgt[k] - anim.cur[k]) * a; });
  anim.curCharY += (charY - anim.curCharY) * a;

  const j = char.j;
  const cur = anim.cur;
  char.group.position.y = anim.curCharY;
  char.group.rotation.x = cur.charRX;
  j.hips.position.y = char.hipY + cur.rootY;
  j.torso.rotation.x = cur.torsoRX; j.torso.rotation.y = cur.torsoRY;
  j.neck.rotation.x = cur.headRX; j.neck.rotation.y = cur.headRY;
  j.shL.rotation.x = cur.shLx; j.shL.rotation.z = cur.shLz; j.elL.rotation.x = -Math.abs(cur.elL);
  j.shR.rotation.x = cur.shRx; j.shR.rotation.z = cur.shRz; j.elR.rotation.x = -Math.abs(cur.elR);
  if (anim.state === 'relaxed') {
    const flare = getRelaxPoseTune().elbowFlare || 0;
    j.elL.rotation.z = flare;
    j.elR.rotation.z = -flare;
  } else {
    j.elL.rotation.z = 0;
    j.elR.rotation.z = 0;
  }
  j.hipL.rotation.x = cur.hipLx; j.hipL.rotation.z = cur.hipLz; j.kneeL.rotation.x = Math.abs(cur.kneeL);
  j.hipR.rotation.x = cur.hipRx; j.hipR.rotation.z = cur.hipRz; j.kneeR.rotation.x = Math.abs(cur.kneeR);

  if (useWorldAim) {
    const swordAttacking = attackT >= 0 && char.weaponDef && char.weaponDef.id === 'sword';
    const aimIkW = swordAttacking
      ? Math.max(0, 0.08 * (1 - swordSwingFactor(attackT, char.anim.swordSwingVariant || 0)))
      : Math.min(1, aimStrength * 0.94);
    if (aimIkW > 0.01) primaryArmAimIK(j, aimIkW, cur, char, aimWorldDir);
  }

  if (weaponEquipped && char.weapon) {
    if (anim.state === 'swim' || anim.state === 'ride') {
      char.weapon.quaternion.slerp(_qT.setFromEuler(_eul.set(-.05, 0, 0)), 1 - Math.exp(-10 * dt));
    } else if (useWorldAim && !(attackT >= 0 && char.weaponDef && char.weaponDef.id === 'sword')) {
      alignWeaponToAim(char, aimWorldDir, aimStrength);
    } else {
      resetWeaponToGripRest(char);
    }
  }

  const useSupportIK = char.twoHanded || (char.weaponDef && char.weaponDef.id === 'sword');
  const wantIK = !opts.previewRelaxed && weaponEquipped && useSupportIK && anim.state !== 'swim' && anim.state !== 'ride'
    && (attackT < 0 || charIsRanged(char));
  anim.ikW += ((wantIK ? 1 : 0) - anim.ikW) * (1 - Math.exp(-8 * dt));
  if (anim.ikW > .01) {
    if (weaponEquipped && char.weapon) char.weapon.updateMatrixWorld(true);
    supportHandIK(j, anim.ikW, cur, char);
  }

  const flying = anim.state === 'fly';
  char.flames.forEach(f => { f.visible = flying; if (flying) { const s = .8 + Math.random() * .5; f.scale.set(s, s, s); } });
  if (char.bike) char.bike.visible = anim.state === 'ride';
  if (char.bike && char.bike.visible) char.bike.position.y = .5 + Math.sin(anim.elapsed * 3) * .015;
  if (char.weapon) char.weapon.visible = weaponEquipped;
  if (char.weapon && char.weapon.userData.animate && weaponEquipped) {
    let fx = rifleKick > 0 ? 1 : meleeSwingFactor(char, attackT);
    if (char.weaponDef && char.weaponDef.id === 'laser' && attackT >= 0) {
      fx = Math.max(fx, laserRifleFireFactor(attackT, char.anim.laserFireVariant || 0));
    }
    char.weapon.userData.animate(anim.elapsed, fx);
  }
  if (char.muzzleFlash) {
    char.muzzleFlash.visible = weaponEquipped && rifleKick > 0;
    if (char.muzzleFlash.visible) { const s = .7 + Math.random() * .8; char.muzzleFlash.scale.set(s, s, s); }
  }
  if (char.beam) {
    const showBeam = opts.showWeaponBeam !== false && weaponEquipped && rifleKick > 0;
    char.beam.visible = showBeam;
    if (char.beam.visible) char.beam.material.opacity = .6 + Math.random() * .4;
  }
}

function build(params, opts) {
  const p = normalizeParams(params);
  const ch = buildCharacter(p, opts);
  initAnimState(ch, opts && opts.weaponEquipped);
  return ch;
}

window.VoxelCharacter = {
  CLASSES, WEAPONS, BODY_TYPES, HEAD_DECOS, HAIR_COLORS, GEAR_COLORS, SKIN_TONES,
  DEFAULT_PARAMS, SAVE_KEY, weaponIdx,
  normalizeParams, loadSaved, saveParams, build, update, dispose, scaleToHeight,
  setGaze, lookAt,
  buildWeapon, mirrorWeaponForTpGrip, tpWeaponGripRest, addOutlines,
  SWORD_SWING_DURATION, SWORD_SWING_COUNT: SWORD_SWING_VARIANTS.length, applySwordAttackPose,
  LASER_RIFLE_DURATION, LASER_RIFLE_COUNT: LASER_RIFLE_VARIANTS.length, applyLaserRifleRecoilPose,
  RELAX_TUNE_KEY, RELAX_POSE_DEFAULTS, RELAX_POSE_SPECS,
  loadRelaxPoseTune, saveRelaxPoseTune, getRelaxPoseTune, setRelaxPoseTune, applyRelaxedArms
};


})();
