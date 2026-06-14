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
  function curvedWing(m,dir,root,span,o){
    const chord=o.chord==null?4:o.chord, taper=o.taper==null?0.5:o.taper, sweep=o.sweep==null?1:o.sweep,
          rise=o.rise==null?0.4:o.rise, c=o.c||'hull', edge=o.edge||'accent';
    for(let s=0;s<=span;s++){
      const x=root.x+dir*s;
      const back=Math.round(root.z - sweep*s*s/span);
      const cch=Math.max(1,Math.round(chord*(1-taper*s/span)));
      const yy=Math.round(root.y + rise*(s*s)/span);
      for(let z=back-cch+1;z<=back;z++) S(m,x,yy,z,c);
      S(m,x,yy,back,edge);
    }
  }

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
  // Starter Hero ship — the pilotable craft for flight (nose at +z).
  function Interceptor(){
    const m=new Map();
    box(m,-1,1,0,1,2,9,'hull'); box(m,-1,1,-1,-1,2,9,'hull2');
    ellipsoid(m,0,0,8,2.4,2.0,2.4,'panel',0.7);   // canopy frame
    dome(m,0,0,8,2.0,'glass');                      // round bubble cockpit
    box(m,-1,1,0,1,10,11,'hull'); S(m,0,1,12,'accent');
    for(const d of [1,-1]) curvedWing(m,d,{x:2*d,y:1,z:7},6,{chord:4,taper:0.5,sweep:1.0,rise:0.6});
    box(m,-1,1,0,1,0,2,'panel'); box(m,-1,1,0,1,0,0,'engine');
    return {m,ec:0x37e6ff,tilt:0.2,hum:80,streak:true,
      engines:[{x:-0.6,y:1,z:0,flame:1},{x:0.6,y:1,z:0,flame:1}],
      lights:[{x:8.5,y:1,z:7,c:0xff3344},{x:-8.5,y:1,z:7,c:0x33ff66},{x:0,y:2,z:12,c:0xffffff,st:1}]};
  }

  // Ancient Star Gate — a hovering ring with an event-horizon membrane (the
  // inter-world travel structure). Ring stands in the XY plane (faces +z).
  function StarGate(){
    const m=new Map();
    torusXY(m,0,0,0,16,2.6,'hull'); torusXY(m,0,0,0,16,1.3,'hull2');
    ellipsoid(m,0,0,0,14,14,0.6,'engine');            // event-horizon membrane
    const L=[];
    for(let i=0;i<9;i++){ const a=i/9*Math.PI*2;
      S(m,Math.cos(a)*16,Math.sin(a)*16,2.8,'accent');
      L.push({x:Math.cos(a)*16,y:Math.sin(a)*16,z:3.4,c:0xc0b3ff,st:1,rate:3+i*0.2}); }
    box(m,-3,3,-20,-16,-2,2,'panel'); box(m,-4,4,-22,-20,-3,3,'hull2');   // base pylon
    return {m,ec:0x7a5cff,tilt:0,hum:50,slow:true,streak:false,engines:[],lights:L};
  }

  // ---- HERO fleet (pilotable) ----
  function Racer(){
    const m=new Map();
    ellipsoid(m,0,0,1,1.1,1.1,9,'hull');
    ellipsoid(m,0,0,10,0.7,0.7,2.5,'accent');
    torusXY(m,0,0,-7,1.9,0.5,'hull2'); torusXY(m,0,0,-8,1.7,0.45,'engine');
    for(const d of [1,-1]){box(m,d*1,d*4,0,0,3,5,'hull2');S(m,d*4,0,5,'accent');}
    box(m,0,0,1,2,-2,3,'panel');
    return {m,ec:0x37e6ff,tilt:0.18,hum:110,streak:true,
      engines:[{x:0,y:0,z:-8,flame:1}],
      lights:[{x:4,y:0,z:4,c:0xff3344},{x:-4,y:0,z:4,c:0x33ff66}]};
  }
  function Explorer(){
    const m=new Map();
    ellipsoid(m,0,2,9,7,1,7,'hull');
    ellipsoid(m,0,2,9,7.3,0.6,7.3,'hull2',0.85);
    dome(m,0,2.6,9,1.9,'hull'); S(m,0,4,9,'accent');
    box(m,-2,2,2,2,2,2,'engine');
    box(m,-1,1,-1,2,4,6,'hull');
    ellipsoid(m,0,-1,-1,2.4,2.4,6,'hull');
    ellipsoid(m,0,-1,5.4,1.5,1.5,1.4,'engine');
    for(const d of [1,-1]){
      for(let s=0;s<=4;s++) S(m,d*(1+s),Math.round(-0.5+s*0.8),-2,'hull2');
      ellipsoid(m,d*5,2.5,-1,1.2,1.2,6,'hull');
      ellipsoid(m,d*5,2.5,5,1.0,1.0,1.0,'accent');
      for(let z=-6;z<=3;z++) S(m,d*5,1.4,z,'engine');
    }
    return {m,ec:0x59b0ff,tilt:0.22,hum:50,engines:[],
      lights:[{x:0,y:4,z:9,c:0xff3344,st:1,rate:4}]};
  }
  function Hauler(){
    const m=new Map();
    ellipsoid(m,0,0,0,3,3,9,'hull');
    ellipsoid(m,0,0,0,3.3,3.3,9.4,'hull2',0.85);
    ellipsoid(m,0,2,6,2.2,1.4,2.2,'panel',0.7);
    dome(m,0,2.4,6,1.8,'glass');
    box(m,3,5,-2,1,-4,4,'panel'); box(m,-5,-3,-2,1,-4,4,'panel');
    box(m,3,5,1,1,-4,4,'accent'); box(m,-5,-3,1,1,-4,4,'accent');
    ellipsoid(m,0,0,9,2,2,2,'hull2');
    ellipsoid(m,0,0,-9,2.4,2.4,1.5,'panel'); ellipsoid(m,0,0,-10,1.7,1.7,0.7,'engine');
    return {m,ec:0xffb53d,tilt:0.2,hum:54,streak:true,
      engines:[{x:0,y:0,z:-10,flame:1,big:1}],
      lights:[{x:5,y:1.5,z:0,c:0xff3344},{x:-5,y:1.5,z:0,c:0x33ff66},{x:0,y:3,z:9,c:0xffffff,st:1}]};
  }
  function Carrier(){
    const m=new Map();
    box(m,-4,4,-1,1,-14,12,'hull'); box(m,-4,4,1,1,-12,10,'panel');
    box(m,0,0,2,2,-12,10,'accent');
    box(m,3,4,2,5,2,7,'panel'); box(m,3,4,3,4,3,6,'glass');
    box(m,-4,4,-1,1,-14,-13,'engine');
    box(m,-2,2,-1,0,12,12,'panel');
    box(m,-5,-4,-1,1,-10,8,'hull2'); box(m,4,5,-1,1,-10,8,'hull2');
    const L=[{x:3.5,y:6,z:7,c:0xffffff,st:1,rate:6}];
    for(let z=-10;z<=8;z+=4){L.push({x:4.5,y:2,z,c:0xffb53d,rate:1.6});L.push({x:-4.5,y:2,z,c:0xffb53d,rate:1.6});}
    return {m,ec:0xffb53d,tilt:0.32,hum:48,streak:true,
      engines:[{x:-2,y:0,z:-14,flame:1},{x:2,y:0,z:-14,flame:1}], lights:L};
  }
  function Mothership(){
    const m=new Map();
    ellipsoid(m,0,0,0,5,3,14,'hull'); ellipsoid(m,0,0,0,5.3,3.3,14.3,'hull2',0.86);
    box(m,-3,3,-3,-1,10,14,'engine');
    box(m,-2,2,3,6,2,8,'panel'); box(m,-2,2,4,5,3,7,'glass'); box(m,-1,1,6,8,4,6,'panel');
    for(let z=-10;z<=8;z+=2){box(m,5,5,0,1,z,z,'glass'); box(m,-5,-5,0,1,z,z,'glass');}
    for(const d of [1,-1]){box(m,d*5,d*8,0,0,-4,4,'hull2'); box(m,d*8,d*8,-1,1,-4,4,'panel');}
    ellipsoid(m,0,0,-14,3,3,1.5,'panel'); ellipsoid(m,0,0,-15,2,2,0.8,'engine');
    box(m,-3,3,2,2,-12,12,'accent');
    return {m,ec:0x37e6ff,tilt:0.2,hum:40,streak:true,
      engines:[{x:0,y:0,z:-15,flame:1,big:1}],
      lights:[{x:0,y:9,z:6,c:0xffffff,st:1,rate:6},{x:8,y:0,z:0,c:0xff3344,rate:1.2},{x:-8,y:0,z:0,c:0x33ff66,rate:1.2}]};
  }

  // ---- ANCIENT constructs ----
  function Saucer(){
    const m=new Map();
    ellipsoid(m,0,0,0,6,1.2,6,'hull');
    ellipsoid(m,0,0,0,6.4,0.7,6.4,'hull2',0.8);
    ellipsoid(m,0,0.4,0,2.9,1.3,2.9,'panel',0.7);
    dome(m,0,0.6,0,2.4,'glass');
    ellipsoid(m,0,-1.2,0,2.2,0.7,2.2,'engine');
    const L=[]; for(let i=0;i<10;i++){const a=i/10*Math.PI*2;L.push({x:Math.cos(a)*6.2,y:0,z:Math.sin(a)*6.2,c:0x37e6ff,rate:1.2+i*0.13});}
    return {m,ec:0x37e6ff,tilt:0.5,hum:120,engines:[{x:0,y:-1.2,z:0,flame:0}], lights:L};
  }
  function Station(){
    const m=new Map();
    torus(m,0,0,0,12,2.2,'hull'); torus(m,0,0,0,12,1.0,'glass');
    sphere(m,0,0,0,3,'hull2'); cyl(m,0,0,0,1.4,9,'panel');
    for(let i=0;i<4;i++){const a=i/4*Math.PI*2,dx=Math.cos(a),dz=Math.sin(a);
      for(let r=3;r<=12;r++) S(m,dx*r,0,dz*r,'hull2');}
    const L=[];
    for(let i=0;i<4;i++){const a=(i/4+0.125)*Math.PI*2,dx=Math.cos(a),dz=Math.sin(a);
      for(let r=12;r<=15;r++) S(m,dx*r,0,dz*r,'panel');
      L.push({x:dx*15.5,y:0,z:dz*15.5,c:0xff3344,st:1,rate:5});}
    L.push({x:0,y:5,z:0,c:0xffffff,st:1,rate:6});
    return {m,ec:0x37e6ff,tilt:0.55,hum:44,engines:[],lights:L};
  }
  function Crystal(){
    const m=new Map();
    octa(m,0,0,0,6,'glass'); octa(m,0,0,0,3,'engine');
    for(const d of [1,-1]){box(m,d*2,d*8,0,0,-1,1,'hull2');S(m,d*8,0,0,'accent');}
    octa(m,0,8,0,1.6,'glass'); octa(m,0,-8,0,1.6,'glass');
    octa(m,5,3,0,1.4,'glass'); octa(m,-5,3,0,1.4,'glass');
    return {m,ec:0x55e06a,tilt:0.25,hum:90,engines:[],
      lights:[{x:8,y:0,z:0,c:0x55e06a,rate:1.5},{x:-8,y:0,z:0,c:0x55e06a,rate:1.5}]};
  }
  function BattleSphere(){
    const m=new Map();
    for(let x=-10;x<=10;x++)for(let y=-10;y<=10;y++)for(let z=-10;z<=10;z++){
      const d=Math.hypot(x,y,z); if(d<8.5||d>10)continue;
      const uz=z/d; let c;
      if(uz>0.84) c='engine';
      else if(Math.abs(y)<=0.9) c=(Math.sin(x*1.5+z)>0.3?'accent':'panel');
      else c=(Math.sin(x*1.3)*Math.sin(z*1.1)>0.35?'panel':'hull2');
      S(m,x,y,z,c);
    }
    const L=[{x:0,y:0,z:11,c:0x37e6ff,st:1,rate:4}];
    for(let i=0;i<6;i++){const a=i/6*Math.PI*2;L.push({x:Math.cos(a)*10,y:0,z:Math.sin(a)*10,c:0xff3344,rate:1.4});}
    return {m,ec:0x37e6ff,tilt:0.18,hum:34,engines:[],lights:L};
  }
  function Pyramid(){
    const m=new Map(); const H=12;
    for(let l=0;l<H;l++){const w=H-l, c=l%2?'hull2':'hull';
      box(m,-w,w,l,l,-w,-w,c); box(m,-w,w,l,l,w,w,c); box(m,-w,-w,l,l,-w,w,c); box(m,w,w,l,l,-w,w,c);
      S(m,w,l,w,'accent'); S(m,-w,l,w,'accent'); S(m,w,l,-w,'accent'); S(m,-w,l,-w,'accent');}
    box(m,-2,2,H-1,H+1,-2,2,'engine');
    return {m,ec:0x7a5cff,tilt:0.12,hum:40,engines:[],
      lights:[{x:0,y:H+2,z:0,c:0xc0b3ff,st:1,rate:3}]};
  }
  function SunSail(){
    const m=new Map();
    ellipsoid(m,0,0,0,1.5,1.5,4,'hull'); dome(m,0,1,2,1.2,'glass');
    box(m,-1,1,-1,1,-4,-3,'panel'); box(m,-1,1,-1,1,-4,-4,'engine');
    for(const d of [1,-1]){
      for(let u=2;u<=13;u++)for(let v=-9;v<=9;v++){
        const curve=Math.round((u-2)*(u-2)*0.05);
        S(m,d*u,curve,v,(Math.abs(v)>8||u>12||u<3)?'accent':'glass');
      }
      box(m,d*2,d*13,0,0,0,0,'panel');
    }
    return {m,ec:0xffb53d,tilt:0.28,hum:52,streak:true,
      engines:[{x:0,y:0,z:-4,flame:1}], lights:[]};
  }

  // ---- THE LIVING (space megafauna) ----
  function Manta(){
    const m=new Map();
    ellipsoid(m,0,0,3,2,1.4,6,'hull');
    ellipsoid(m,0,0.4,7,2,1.2,2,'panel',0.7);
    dome(m,0,0.6,7,1.6,'glass');
    for(const d of [1,-1]) curvedWing(m,d,{x:2*d,y:0,z:8},9,{chord:7,taper:0.7,sweep:1.5,rise:-0.6});
    S(m,0,0,11,'accent');
    box(m,-1,1,0,1,-3,-2,'panel'); box(m,-1,1,0,1,-3,-3,'engine');
    return {m,ec:0xff5ab0,tilt:0.28,hum:68,streak:true,
      engines:[{x:-0.6,y:0.5,z:-3,flame:1},{x:0.6,y:0.5,z:-3,flame:1}],
      lights:[{x:9,y:-1,z:2,c:0xff3344},{x:-9,y:-1,z:2,c:0x33ff66}]};
  }
  function Jelly(){
    const m=new Map();
    ellipsoid(m,0,0,0,5,3,5,'hull2',0.62);
    dome(m,0,0,0,5,'glass');
    sphere(m,0,1,0,2,'engine');
    for(let i=0;i<8;i++){const a=i/8*Math.PI*2;let x=Math.cos(a)*4,z=Math.sin(a)*4,y=-1;
      for(let s=0;s<15;s++){x+=Math.cos(a)*0.15+Math.sin(s*0.6)*0.5*-Math.sin(a);z+=Math.sin(a)*0.15+Math.sin(s*0.6)*0.5*Math.cos(a);y-=1;S(m,x,y,z,s%3?'panel':'accent');}}
    return {m,ec:0x37e6ff,tilt:0.18,hum:62,engines:[],lights:[]};
  }
  function Serpent(){
    const m=new Map();
    for(let i=0;i<=26;i++){const z=13-i,x=Math.sin(i*0.45)*4,y=Math.cos(i*0.4)*1.6,r=Math.max(1,2.2-i*0.04);
      sphere(m,x,y,z,r, i%4<2?'hull2':'hull');}
    sphere(m,0,1.6,13,2.4,'hull2'); S(m,1,2,15,'engine'); S(m,-1,2,15,'engine');
    for(let i=2;i<24;i+=3){const x=Math.sin(i*0.45)*4,y=Math.cos(i*0.4)*1.6,z=13-i;S(m,x,y+2,z,'accent');}
    return {m,ec:0x55e06a,tilt:0.18,hum:58,engines:[],lights:[]};
  }
  function Coral(){
    const m=new Map();
    cyl(m,0,-6,0,3,4,'hull2'); cyl(m,0,-6,0,1.4,5,'panel');
    function branch(x,y,z,dx,dy,dz,len,depth){
      for(let s=0;s<len;s++){x+=dx;y+=dy;z+=dz;S(m,x,y,z,depth?'hull2':'hull');}
      if(depth>=4){ octa(m,x,y,z,1.2,'glass'); S(m,x,y,z,'engine'); return; }
      for(let k=-1;k<=1;k+=2){const ang=k*0.6;
        const ndx=dx*Math.cos(ang)-dz*Math.sin(ang), ndz=dx*Math.sin(ang)+dz*Math.cos(ang);
        branch(x,y,z,ndx,dy*0.85+0.3,ndz,Math.max(2,len-1),depth+1);
      }
    }
    branch(0,-2,0,0,1.1,0,5,0);
    return {m,ec:0x37e6ff,tilt:0.1,hum:44,engines:[],lights:[]};
  }
  function AsteroidBase(){
    const m=new Map();
    for(let x=-9;x<=9;x++)for(let y=-9;y<=9;y++)for(let z=-9;z<=9;z++){
      const d=Math.hypot(x,y,z), n=0.82+0.22*Math.sin(x*0.8)*Math.sin(y*0.7+1)*Math.sin(z*0.6+2);
      if(d<=8*n) S(m,x,y,z, d>7?'panel':(Math.sin(x*1.7+z*1.1)>0.55?'hull':'hull2'));
    }
    box(m,-3,3,7,9,-3,3,'panel'); box(m,-2,2,9,9,-2,2,'glass');
    dome(m,4,5,0,2,'glass'); dome(m,-4,5,2,1.6,'glass');
    cyl(m,0,0,0,0.6,22,'panel');
    const L=[{x:0,y:11,z:0,c:0xff3344,st:1,rate:5},{x:5,y:6,z:0,c:0x37e6ff,rate:1.5},{x:-4,y:6,z:2,c:0x37e6ff,rate:1.3}];
    return {m,ec:0x37e6ff,tilt:0.2,hum:40,engines:[],lights:L};
  }
  function Whale(){
    const m=new Map();
    ellipsoid(m,0,0,0,4,4,12,'hull2'); ellipsoid(m,0,1,5,3.5,3,7,'hull2');
    box(m,-3,3,-2,-1,9,12,'panel');
    for(let z=-8;z<=6;z+=3) for(const d of [1,-1]) sphere(m,d*2.5,-3,z,1,'engine');
    sphere(m,3,1,9,0.8,'glass'); sphere(m,-3,1,9,0.8,'glass'); S(m,3,1,10,'engine'); S(m,-3,1,10,'engine');
    for(const d of [1,-1]) curvedWing(m,d,{x:4*d,y:-1,z:2},6,{chord:5,taper:0.6,sweep:1.0,rise:-0.6,c:'hull2',edge:'accent'});
    box(m,-7,7,0,0,-13,-11,'hull2'); box(m,-7,7,1,1,-12,-11,'accent');
    box(m,-1,1,-2,2,-13,-9,'hull2'); box(m,0,0,4,7,-2,2,'hull2');
    return {m,ec:0x55e06a,tilt:0.18,hum:34,engines:[],
      lights:[{x:3,y:1,z:10,c:0x9be86a,rate:0.8},{x:-3,y:1,z:10,c:0x9be86a,rate:0.8}]};
  }

  // ---- RAIDERS ----
  function Dreadnought(){
    const m=new Map();
    box(m,-3,3,-2,2,-20,18,'hull');
    for(let s=1;s<=6;s++){const w=3-Math.floor(s/2),h=2-Math.floor(s/3);box(m,-w,w,-h,h,18+s,18+s,'hull');}
    S(m,0,0,25,'accent');
    box(m,-3,3,-2,-2,-20,18,'hull2'); box(m,-3,3,2,2,-18,16,'panel');
    box(m,3,4,-1,1,-16,14,'hull2'); box(m,-4,-3,-1,1,-16,14,'hull2');
    box(m,-1,1,3,6,2,8,'panel'); box(m,-1,1,4,5,3,7,'glass'); box(m,-1,1,6,9,4,6,'panel');
    for(let z=-18;z<=14;z+=3){box(m,-3,-3,-1,1,z,z+1,'panel');box(m,3,3,-1,1,z,z+1,'panel');}
    box(m,-3,3,2,2,-18,16,'accent');
    box(m,-3,3,-1,1,-20,-20,'engine');
    const L=[{x:0,y:9,z:6,c:0xffffff,st:1,rate:6}];
    for(let z=-16;z<=12;z+=8){L.push({x:4,y:1,z,c:0xff3344,rate:1.2});L.push({x:-4,y:1,z,c:0x33ff66,rate:1.2});}
    return {m,ec:0x37e6ff,tilt:0.16,hum:36,streak:true,
      engines:[{x:0,y:0,z:-20,flame:1,big:1},{x:-2.5,y:0,z:-20,flame:1},{x:2.5,y:0,z:-20,flame:1}], lights:L};
  }
  function Hammerhead(){
    const m=new Map();
    box(m,-1,1,-1,1,-12,6,'hull'); box(m,-1,1,-1,-1,-12,6,'hull2');
    box(m,-7,7,-1,1,7,10,'hull'); box(m,-7,7,2,2,7,10,'panel'); box(m,-7,7,0,0,8,9,'accent');
    dome(m,6,1,8.5,1.5,'glass'); dome(m,-6,1,8.5,1.5,'glass');
    box(m,-1,1,2,4,0,3,'panel'); box(m,-1,1,3,3,1,2,'glass');
    box(m,-1,1,-1,1,-12,-11,'engine');
    return {m,ec:0x37e6ff,tilt:0.22,hum:46,streak:true,
      engines:[{x:0,y:0,z:-12,flame:1,big:1}],
      lights:[{x:7,y:1,z:9,c:0xff3344,st:1},{x:-7,y:1,z:9,c:0x33ff66,st:1}]};
  }
  function Trident(){
    const m=new Map();
    sphere(m,0,0,0,2.4,'glass'); sphere(m,0,0,0,1.3,'engine');
    for(let i=0;i<3;i++){const a=-Math.PI/2+i*Math.PI*2/3, ex=Math.cos(a), ey=Math.sin(a);
      for(let t=2;t<=13;t++){const r=t*0.55; S(m,ex*r,ey*r,t, t>11?'accent':'hull2'); if(t<6)S(m,ex*r*0.5,ey*r*0.5,t,'hull');}}
    box(m,-1,1,-1,1,-3,-1,'panel'); box(m,-1,1,-1,1,-3,-3,'engine');
    return {m,ec:0xff3db0,tilt:0.2,hum:88,streak:true,
      engines:[{x:0,y:0,z:-3,flame:1}], lights:[]};
  }

  const BUILDERS = {
    // Heroes (pilotable)
    'Drone':         { build:Drone,        faction:'hero' },
    'Interceptor':   { build:Interceptor,  faction:'hero' },
    'Racer':         { build:Racer,        faction:'hero' },
    'Explorer':      { build:Explorer,     faction:'hero' },
    'Hauler':        { build:Hauler,       faction:'hero' },
    'Carrier':       { build:Carrier,      faction:'hero' },
    'Mothership':    { build:Mothership,   faction:'hero' },
    // Ancients
    'Saucer':        { build:Saucer,       faction:'ancient' },
    'Ring Station':  { build:Station,      faction:'ancient' },
    'Crystal':       { build:Crystal,      faction:'ancient' },
    'Battle Sphere': { build:BattleSphere, faction:'ancient' },
    'StarGate':      { build:StarGate,     faction:'ancient' },
    'Pyramid':       { build:Pyramid,      faction:'ancient' },
    'Sun Sail':      { build:SunSail,      faction:'ancient' },
    // The Living
    'Manta':         { build:Manta,        faction:'living' },
    'Jellyfish':     { build:Jelly,        faction:'living' },
    'Serpent':       { build:Serpent,      faction:'living' },
    'Coral':         { build:Coral,        faction:'living' },
    'Asteroid Base': { build:AsteroidBase, faction:'living' },
    'Space Whale':   { build:Whale,        faction:'living' },
    // Raiders
    'Dreadnought':   { build:Dreadnought,  faction:'raider' },
    'Hammerhead':    { build:Hammerhead,   faction:'raider' },
    'Trident':       { build:Trident,      faction:'raider' }
  };
  // Player-pilotable ships (the Hero fleet), with per-ship flight feel.
  const PILOTABLE = [
    { name:'Interceptor', scale:0.80, speed:1.00, turn:1.00 },
    { name:'Racer',       scale:0.78, speed:1.35, turn:1.30 },
    { name:'Explorer',    scale:0.70, speed:0.95, turn:0.85 },
    { name:'Hauler',      scale:0.66, speed:0.82, turn:0.72 },
    { name:'Carrier',     scale:0.58, speed:0.78, turn:0.62 },
    { name:'Mothership',  scale:0.46, speed:0.66, turn:0.5  }
  ];

  // ---------- renderer (one InstancedMesh per material) ----------
  const VS=0.30, SUB=2, FS=VS/SUB, CUBE=FS*0.9;
  const _geo=new THREE.BoxGeometry(CUBE,CUBE,CUBE);
  const _off=[]; for(let i=0;i<SUB;i++) _off.push(-0.5+(i+0.5)/SUB);
  const _dummy=new THREE.Object3D();
  const KIND={hull:'l',hull2:'l',panel:'l',accent:'l',glass:'g',engine:'e'};
  let _flameTex=null;
  function flameTexture(){
    if(_flameTex) return _flameTex;
    const cv=document.createElement('canvas'); cv.width=cv.height=64;
    const c=cv.getContext('2d'), g=c.createRadialGradient(32,32,0,32,32,32);
    g.addColorStop(0,'rgba(255,244,214,0.96)'); g.addColorStop(0.42,'rgba(120,210,255,0.55)');
    g.addColorStop(1,'rgba(40,120,255,0)');
    c.fillStyle=g; c.fillRect(0,0,64,64);
    _flameTex=new THREE.CanvasTexture(cv); return _flameTex;
  }

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

    // engine glow shells + thrust flames (skipped for the drone; engines:[] empty)
    function vpos(x,y,z){ return new THREE.Vector3((x-cx)*VS,(y-cy)*VS,(z-cz)*VS); }
    const flames=[];
    for(const e of (spec.engines||[])){
      const p=vpos(e.x,e.y,e.z), sc=e.big?1.6:0.9;
      [[sc,0.26],[sc*1.7,0.12]].forEach(([s,op])=>{
        const me=new THREE.Mesh(new THREE.BoxGeometry(s,s,s),
          new THREE.MeshBasicMaterial({color:PAL.engine,transparent:true,opacity:op,blending:THREE.AdditiveBlending,depthWrite:false}));
        me.position.copy(p); inner.add(me); glowShells.push({mat:me.material,base:op});
      });
      if(e.flame){
        const fs=new THREE.Sprite(new THREE.SpriteMaterial({map:flameTexture(),color:PAL.engine,
          blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:0}));
        fs.position.set(p.x, p.y, p.z - (e.big?0.7:0.5));   // trail out the back (-z)
        inner.add(fs);
        flames.push({s:fs, w:(e.big?1.1:0.7), h:(e.big?2.6:1.7)});
      }
    }

    // nav lights (small emissive cubes that blink/strobe)
    for(const l of (spec.lights||[])){
      const me=new THREE.Mesh(new THREE.BoxGeometry(VS*0.6,VS*0.6,VS*0.6),
        new THREE.MeshStandardMaterial({color:l.c,emissive:l.c,emissiveIntensity:1.4}));
      me.position.copy(vpos(l.x,l.y,l.z)); inner.add(me);
      navLights.push({m:me, st:l.st, rate:l.rate||1.4, phase:(l.x*0.7+l.z*1.3)%6});
    }

    inner.rotation.x = (opts.tilt!=null ? opts.tilt : (spec.tilt||0));  // vehicles pass tilt:0 (they own pitch)
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
        // thrust flames grow + brighten with throttle (st.alert)
        for(const f of flames){ const fl=0.7+Math.sin(t*32+f.h)*0.3;
          f.s.scale.set(f.w*(0.55+st.alert*0.6), f.h*(0.35+st.alert*1.1)*fl, 1);
          f.s.material.opacity=Math.min(1, st.alert*1.15*fl);
        }
        // gentle idle shimmer — fades out under thrust so it doesn't fight banking
        const idle=(1-st.alert);
        inner.rotation.z = Math.sin(t*1.3)*0.05*idle;
        inner.position.y = Math.sin(t*2.2)*0.04*idle;
      },
      dispose(){
        inner.traverse(o=>{ if(o.isInstancedMesh){ o.material.dispose(); }
          else if(o.isMesh){ o.geometry.dispose(); o.material.dispose(); } });
      }
    };
  }

  function has(name){ return !!BUILDERS[name]; }

  window.AsteroidShips = { build, has, FACTIONS, BUILDERS, PILOTABLE, _helpers:{ box, ellipsoid, sphere, dome, torus, cyl, torusXY, octa, S } };
})();
