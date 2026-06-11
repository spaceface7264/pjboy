/*
 * voxelworld.js — "Asteroid" voxel sandbox mode for PJBoy.
 * Ported from pjboyv2/game-slice.html: procedural asteroid, mine/build, jetpack.
 */
(function () {
    'use strict';

    class VoxelWorld {
        constructor(game) {
            this.game = game;
            this._rt = null;
        }

        enter() {
            if (!this._rt) this._rt = createRuntime(this.game);
            this._rt.enter();
        }

        exit() {
            if (this._rt) this._rt.exit();
        }

        update(dt) {
            if (this._rt) this._rt.tick(dt);
        }

        updatePlayer(dt) {
            if (this._rt) this._rt.tick(dt);
        }

        updateCamera() {
            if (this._rt) this._rt.updateCamera();
        }

        mineBlock() {
            if (this._rt) this._rt.mineBlock();
        }

        placeBlock() {
            if (this._rt) this._rt.placeBlock();
        }
    }

    function createRuntime(game) {
        const g = game;
        let scene, camera;
        let _saved = null;
        let _listeners = [];
        let _active = false;
        let _voxelBg = null;

        function on(el, ev, fn, opts) {
            el.addEventListener(ev, fn, opts);
            _listeners.push([el, ev, fn, opts]);
        }

        /* =========================================================
           ASTEROID SLICE: the character creator's rig meets the
           voxel world. Walk, jump, jetpack, mine, build.
           ========================================================= */
        
        // ---------- seeded rng + noise ----------
        let SEED = (Math.random()*1e9)|0;
        function ihash(x,y,z){
          let h = Math.imul(x|0,374761393) ^ Math.imul(y|0,668265263) ^ Math.imul(z|0,1440662683) ^ SEED;
          h = Math.imul(h ^ (h>>>13), 1274126177);
          return ((h ^ (h>>>16))>>>0)/4294967296;
        }
        function lerp(a,b,t){ return a+(b-a)*t; }
        function smooth(t){ return t*t*(3-2*t); }
        function vnoise3(x,y,z){
          const xi=Math.floor(x), yi=Math.floor(y), zi=Math.floor(z);
          const tx=smooth(x-xi), ty=smooth(y-yi), tz=smooth(z-zi);
          const c=(dx,dy,dz)=>ihash(xi+dx,yi+dy,zi+dz);
          return lerp(
            lerp(lerp(c(0,0,0),c(1,0,0),tx), lerp(c(0,1,0),c(1,1,0),tx), ty),
            lerp(lerp(c(0,0,1),c(1,0,1),tx), lerp(c(0,1,1),c(1,1,1),tx), ty), tz);
        }
        function fbm3(x,y,z){ return vnoise3(x,y,z)*.55 + vnoise3(x*2.1,y*2.1,z*2.1)*.3 + vnoise3(x*4.3,y*4.3,z*4.3)*.15; }
        function vnoise2(x,z){ return vnoise3(x,7.77,z); }
        function fbm2(x,z){ return vnoise2(x,z)*.55 + vnoise2(x*2.1,z*2.1)*.3 + vnoise2(x*4.3,z*4.3)*.15; }
        function rng(seed){ return function(){ seed|=0; seed=seed+0x6D2B79F5|0;
          let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t;
          return ((t^t>>>14)>>>0)/4294967296; }; }
        function shade(hex,f){
          const r=Math.min(255,Math.round(((hex>>16)&255)*f)), g=Math.min(255,Math.round(((hex>>8)&255)*f)),
                b=Math.min(255,Math.round((hex&255)*f));
          return (r<<16)|(g<<8)|b;
        }
        const hx = h => '#'+h.toString(16).padStart(6,'0');
        
        // ---------- tile painters: 32px pixel-art canvases ----------
        const TILE=32;
        // base + per-pixel grain; the workhorse for natural blocks
        function grain(x, base, vary, R, chunky=1){
          for(let py=0;py<32;py+=chunky) for(let px=0;px<32;px+=chunky){
            const f = 1 + (R()-.5)*vary;
            x.fillStyle = hx(shade(base, f));
            x.fillRect(px,py,chunky,chunky);
          }
        }
        function edgeBorder(x){ // baked dark border: the hand-drawn voxel outline
          x.fillStyle='rgba(0,0,0,.4)';
          x.fillRect(0,0,32,1); x.fillRect(0,31,32,1); x.fillRect(0,0,1,32); x.fillRect(31,0,1,32);
          x.fillStyle='rgba(255,255,255,.12)';
          x.fillRect(1,1,30,1);
        }
        const PAINTERS = {
          grass_top(x,R){ grain(x,0x4f9e42,.3,R,2);
            // two-tone mottling patches
            for(let i=0;i<4;i++){ x.fillStyle='rgba(40,90,30,.35)';
              x.fillRect((R()*22)|0,(R()*22)|0,6+((R()*6)|0),5+((R()*5)|0)); }
            for(let i=0;i<10;i++){ x.fillStyle=hx(shade(0x6ec455,1+(R()-.5)*.3)); x.fillRect((R()*30)|0,(R()*30)|0,2,2); }
            if(R()<.4){ x.fillStyle='#e8e25c'; x.fillRect((R()*28)|0,(R()*28)|0,2,2); } }, // tiny bloom
          grass_side(x,R){ grain(x,0x7d5a3a,.3,R,2);
            x.fillStyle='#4f9e42'; x.fillRect(0,0,32,6);
            for(let i=0;i<9;i++){ x.fillStyle='#449038'; x.fillRect((R()*30)|0,5+((R()*5)|0),2,3+((R()*3)|0)); }
            for(let i=0;i<4;i++){ x.fillStyle='rgba(0,0,0,.2)'; x.fillRect((R()*28)|0,12+((R()*16)|0),3,2); } },
          dirt(x,R){ grain(x,0x7d5a3a,.34,R,2);
            for(let i=0;i<6;i++){ x.fillStyle=hx(shade(0x7d5a3a,.7)); x.fillRect((R()*28)|0,(R()*28)|0,3,2); }
            for(let i=0;i<3;i++){ x.fillStyle='#9aa0a8'; x.fillRect((R()*28)|0,(R()*28)|0,2,2);  // small stones
              x.fillStyle='rgba(255,255,255,.3)'; x.fillRect((R()*28)|0,(R()*28)|0,1,1); } },
          stone(x,R){ grain(x,0x808a96,.22,R,2);
            for(let i=0;i<5;i++){ x.fillStyle='rgba(0,0,0,.2)';                  // cracks
              let sx=(R()*24)|0, sy=(R()*26)|0;
              for(let s=0;s<4;s++){ x.fillRect(sx,sy,3,1); sx+=2+((R()*3)|0); sy+=((R()*3)|0)-1; } }
            for(let i=0;i<5;i++){ x.fillStyle='rgba(255,255,255,.18)'; x.fillRect((R()*30)|0,(R()*30)|0,2,1); }
            if(R()<.35) for(let i=0;i<4;i++){ x.fillStyle='rgba(80,150,70,.5)';  // moss patch
              x.fillRect((R()*10)|0,(R()*10)|0,3,2); } },
          sand(x,R){ grain(x,0xd9c27e,.18,R,2);
            for(let i=0;i<4;i++){ x.fillStyle='rgba(0,0,0,.1)';                  // wind ripples
              x.fillRect(0,4+i*8+((R()*3)|0),32,1); }
            for(let i=0;i<7;i++){ x.fillStyle=hx(shade(0xd9c27e,.85)); x.fillRect((R()*30)|0,(R()*30)|0,2,1); } },
          wood_top(x,R){ grain(x,0x9a7044,.18,R,2);
            x.strokeStyle='rgba(0,0,0,.3)'; x.lineWidth=2;
            for(let r=4;r<16;r+=4){ x.strokeRect(16-r,16-r,r*2,r*2); }
            x.fillStyle='rgba(0,0,0,.35)'; x.fillRect(14,14,4,4); },
          wood_side(x,R){ grain(x,0x7a5530,.2,R,2);
            for(let i=0;i<5;i++){ x.fillStyle='rgba(0,0,0,.22)'; x.fillRect(2+i*7,0,2,32); }
            const kx=6+((R()*18)|0), ky=8+((R()*14)|0);                          // knot
            x.fillStyle='#4a3018'; x.fillRect(kx,ky,5,7);
            x.fillStyle='#2e1d0c'; x.fillRect(kx+1,ky+2,3,3); },
          leaves(x,R){ grain(x,0x3f8a3c,.4,R,2);
            for(let i=0;i<8;i++){ x.fillStyle='rgba(0,0,0,.3)'; x.fillRect((R()*30)|0,(R()*30)|0,2,2); } // gaps
            for(let i=0;i<6;i++){ x.fillStyle='#67c25e'; x.fillRect((R()*30)|0,(R()*30)|0,2,2); }
            if(R()<.5) for(let i=0;i<2;i++){ x.fillStyle='#d8493c'; x.fillRect((R()*28)|0,(R()*28)|0,2,2); } }, // berries
          metal(x,R){ grain(x,0x9aa6b2,.08,R,4);
            x.fillStyle='rgba(0,0,0,.25)'; x.fillRect(0,14,32,2); x.fillRect(15,0,2,32);
            for(let i=0;i<3;i++){ x.fillStyle='rgba(255,255,255,.25)';           // scratches
              x.fillRect((R()*20)|0,(R()*28)|0,6+((R()*6)|0),1); }
            x.fillStyle='#c8d2dc';
            [[3,3],[26,3],[3,26],[26,26]].forEach(([bx,by])=>{ x.fillRect(bx,by,3,3);
              x.fillStyle='rgba(0,0,0,.4)'; x.fillRect(bx+1,by+1,1,1); x.fillStyle='#c8d2dc'; }); },
          ice(x,R){ grain(x,0xa8d8ee,.12,R,2);
            const grd=x.createRadialGradient(16,16,2,16,16,18);                  // inner glow
            grd.addColorStop(0,'rgba(255,255,255,.3)'); grd.addColorStop(1,'rgba(255,255,255,0)');
            x.fillStyle=grd; x.fillRect(0,0,32,32);
            x.strokeStyle='rgba(255,255,255,.5)'; x.lineWidth=1; x.beginPath();
            x.moveTo(4,28); x.lineTo(14,14); x.lineTo(10,8); x.moveTo(14,14); x.lineTo(26,6); x.stroke();
            for(let i=0;i<4;i++){ x.fillStyle='#ffffff'; x.fillRect((R()*30)|0,(R()*30)|0,1,1); } }, // sparkle
          ore(x,R){ grain(x,0x808a96,.22,R,2);
            for(let i=0;i<5;i++){ const ox=(R()*24+2)|0, oy=(R()*24+2)|0;
              x.fillStyle = R()<.7? '#5ad6f0':'#7ae8c0';
              x.fillRect(ox,oy,4,4);
              x.fillStyle='#bdf2ff'; x.fillRect(ox+1,oy+1,2,2);
              x.fillStyle='#ffffff'; x.fillRect(ox,oy,1,1); } },
          crystal(x,R){ grain(x,0x7a3da8,.25,R,2);
            for(let i=0;i<4;i++){ const cx=(R()*22+2)|0, cy=(R()*16+2)|0;
              x.fillStyle='#c46ae8'; x.fillRect(cx,cy,5,11);
              x.fillStyle='#f0c2ff'; x.fillRect(cx+1,cy+1,2,9);
              x.fillStyle='rgba(255,255,255,.7)'; x.fillRect(cx+1,cy+1,1,3);     // facet glint
              x.fillStyle='rgba(0,0,0,.3)'; x.fillRect(cx+4,cy+2,1,8); } },
          energy(x,R,frame){
            grain(x,0xd84a18,.25,R,2);
            for(let i=0;i<5;i++){ x.fillStyle='rgba(30,10,5,.6)';                // dark crust
              x.fillRect((R()*26)|0,(R()*26)|0,5,4); }
            for(let i=0;i<7;i++){
              const a = i*1.1 + frame*1.57;
              const ex = 16+Math.cos(a)*(6+i), ey = 16+Math.sin(a*1.3)*(6+i*.7);
              x.fillStyle = i%2? '#ffb43c':'#ffe28a';
              x.fillRect((ex|0)-2,(ey|0)-2,5,4);
            }
            x.fillStyle='rgba(255,240,200,.7)'; x.fillRect(13+((frame%2)*3),13,5,5);
          },
          // decoration tiles: transparent background, no border
          tall_grass(x,R){
            for(let i=0;i<8;i++){
              const bx=3+R()*26, h=12+R()*16;
              x.strokeStyle=hx(shade(0x57b34a,1+(R()-.5)*.45)); x.lineWidth=2;
              x.beginPath(); x.moveTo(bx,32);
              x.quadraticCurveTo(bx+(R()-.5)*6, 32-h*.6, bx+(R()-.5)*10, 32-h);
              x.stroke();
            }
          },
          flower_red(x,R){
            PAINTERS.tall_grass(x,R);
            const fx=10+R()*12, fy=6+R()*6;
            x.fillStyle='#d8493c'; x.fillRect(fx-3,fy,3,3); x.fillRect(fx+2,fy,3,3);
            x.fillRect(fx-3,fy+4,3,3); x.fillRect(fx+2,fy+4,3,3);
            x.fillStyle='#ffd45c'; x.fillRect(fx,fy+2,2,3);
            x.strokeStyle='#3f8a3c'; x.lineWidth=2; x.beginPath(); x.moveTo(fx+1,fy+6); x.lineTo(fx,32); x.stroke();
          },
          flower_yellow(x,R){
            PAINTERS.tall_grass(x,R);
            const fx=12+R()*10, fy=7+R()*6;
            x.fillStyle='#f0d048'; x.fillRect(fx-2,fy-2,7,7);
            x.fillStyle='#b8860f'; x.fillRect(fx,fy,3,3);
            x.strokeStyle='#3f8a3c'; x.lineWidth=2; x.beginPath(); x.moveTo(fx+1,fy+5); x.lineTo(fx,32); x.stroke();
          },
        
          // ---- alien soils ----
          frond_top(x,R){ grain(x,0x2a6a5a,.3,R,2);
            for(let i=0;i<9;i++){ x.fillStyle=hx(shade(0x4ae0c4,1+(R()-.5)*.4)); x.fillRect((R()*30)|0,(R()*30)|0,2,2); } },
          spore_top(x,R){ grain(x,0x8a3a2c,.3,R,2);
            for(let i=0;i<5;i++){ x.fillStyle='rgba(0,0,0,.3)'; x.fillRect((R()*28)|0,(R()*28)|0,3,3); } // pocks
            for(let i=0;i<6;i++){ x.fillStyle='#ff8a4a'; x.fillRect((R()*30)|0,(R()*30)|0,2,2); } },
          quill_top(x,R){ grain(x,0x3a2a52,.28,R,2);
            for(let i=0;i<7;i++){ x.fillStyle=hx(shade(0x9a4ae0,1+(R()-.5)*.4)); x.fillRect((R()*30)|0,(R()*30)|0,2,2); }
            for(let i=0;i<3;i++){ x.fillStyle='#e8b8ff'; x.fillRect((R()*30)|0,(R()*30)|0,1,1); } },
          plume_top(x,R){ grain(x,0x9a7a34,.24,R,2);
            for(let i=0;i<8;i++){ x.fillStyle=hx(shade(0xe0b03c,1+(R()-.5)*.3)); x.fillRect((R()*30)|0,(R()*30)|0,2,1); } },
          frond_side(x,R){ grain(x,0x4a4438,.3,R,2);
            x.fillStyle='#2a6a5a'; x.fillRect(0,0,32,6);
            for(let i=0;i<7;i++){ x.fillStyle='#1f5448'; x.fillRect((R()*30)|0,5+((R()*4)|0),2,3); } },
          spore_side(x,R){ grain(x,0x4a4438,.3,R,2);
            x.fillStyle='#8a3a2c'; x.fillRect(0,0,32,6);
            for(let i=0;i<7;i++){ x.fillStyle='#6e2c20'; x.fillRect((R()*30)|0,5+((R()*4)|0),2,3); } },
          quill_side(x,R){ grain(x,0x4a4438,.3,R,2);
            x.fillStyle='#3a2a52'; x.fillRect(0,0,32,6);
            for(let i=0;i<7;i++){ x.fillStyle='#2c1f40'; x.fillRect((R()*30)|0,5+((R()*4)|0),2,3); } },
          plume_side(x,R){ grain(x,0x4a4438,.3,R,2);
            x.fillStyle='#9a7a34'; x.fillRect(0,0,32,6);
            for(let i=0;i<7;i++){ x.fillStyle='#7a6028'; x.fillRect((R()*30)|0,5+((R()*4)|0),2,3); } },
        
          // ---- alien grass blades (transparent deco tiles) ----
          deco_frond(x,R){ // tall + thin: long wispy curved blades
            for(let i=0;i<6;i++){
              const bx=4+R()*24;
              x.strokeStyle=hx(shade(0x3ee8cc,1+(R()-.5)*.5)); x.lineWidth=1.5;
              x.beginPath(); x.moveTo(bx,32);
              x.bezierCurveTo(bx+(R()-.5)*4, 22, bx+(R()-.5)*10, 10, bx+(R()-.5)*16, 1+R()*4);
              x.stroke();
            }
            for(let i=0;i<3;i++){ x.fillStyle='#bafff0'; x.fillRect((R()*28)|0,(R()*10)|0,1,2); } // wisp tips
          },
          deco_spore(x,R){ // small + thick: stubby blades with spore bulbs
            for(let i=0;i<6;i++){
              const bx=3+R()*26, h=8+R()*8;
              x.strokeStyle=hx(shade(0xc44536,1+(R()-.5)*.35)); x.lineWidth=4;
              x.beginPath(); x.moveTo(bx,32); x.lineTo(bx+(R()-.5)*5, 32-h); x.stroke();
              if(R()<.6){ x.fillStyle='#ff8a4a'; x.fillRect(bx-2,30-h,5,4);
                x.fillStyle='#ffd0a0'; x.fillRect(bx-1,31-h,2,2); }   // glowing spore cap
            }
          },
          deco_quill(x,R){ // needle-straight spikes with bright tips
            for(let i=0;i<7;i++){
              const bx=3+R()*26, h=18+R()*12;
              x.strokeStyle=hx(shade(0x9a4ae0,1+(R()-.5)*.4)); x.lineWidth=1.5;
              x.beginPath(); x.moveTo(bx,32); x.lineTo(bx+(R()-.5)*2, 32-h); x.stroke();
              x.fillStyle='#e8b8ff'; x.fillRect(bx-1,31-h,2,2);
            }
          },
          deco_quill_glow(x,R){ // rarer variant: big luminous tip pods
            PAINTERS.deco_quill(x,R);
            for(let i=0;i<2;i++){
              const bx=6+R()*20, by=2+R()*6;
              x.fillStyle='#c478ff'; x.fillRect(bx-2,by,5,6);
              x.fillStyle='#f4e0ff'; x.fillRect(bx-1,by+1,3,3);
            }
          },
          deco_plume(x,R){ // wide soft feathers: stem + diagonal barbs
            for(let i=0;i<3;i++){
              const bx=6+R()*20, h=20+R()*9, lean=(R()-.5)*6;
              x.strokeStyle=hx(shade(0xb8902c,1+(R()-.5)*.25)); x.lineWidth=2;
              x.beginPath(); x.moveTo(bx,32); x.lineTo(bx+lean,32-h); x.stroke();
              x.strokeStyle=hx(shade(0xe8c050,1+(R()-.5)*.3)); x.lineWidth=1.5;
              for(let s=4;s<h-2;s+=3){
                const sx=bx+lean*(s/h), sy=32-s, w=3+(1-s/h)*5;
                x.beginPath(); x.moveTo(sx,sy); x.lineTo(sx-w,sy-2); x.moveTo(sx,sy); x.lineTo(sx+w,sy-2); x.stroke();
              }
            }
          },
        
          // ---- planetary terrain ----
          regolith(x,R){ grain(x,0x8a8a92,.16,R,2);
            for(let i=0;i<4;i++){ const cx=4+R()*24, cy=4+R()*24, r=2+R()*4;   // craters
              x.strokeStyle='rgba(0,0,0,.3)'; x.lineWidth=2;
              x.beginPath(); x.arc(cx,cy,r,0,7); x.stroke();
              x.fillStyle='rgba(255,255,255,.15)'; x.fillRect(cx-r,cy-r-1,r,1); } },
          basalt(x,R){ grain(x,0x3a3d44,.18,R,2);
            for(let i=0;i<5;i++){ x.fillStyle='rgba(0,0,0,.3)'; x.fillRect(2+i*6+((R()*3)|0),0,2,32); } // columns
            for(let i=0;i<4;i++){ x.fillStyle='rgba(255,255,255,.08)'; x.fillRect((R()*28)|0,(R()*28)|0,4,1); } },
          red_rock(x,R){ grain(x,0xa85438,.2,R,2);
            for(let i=0;i<4;i++){ x.fillStyle='rgba(60,20,10,.35)';            // strata bands
              x.fillRect(0,4+i*8+((R()*3)|0),32,2+((R()*2)|0)); }
            for(let i=0;i<4;i++){ x.fillStyle='#c87a52'; x.fillRect((R()*30)|0,(R()*30)|0,2,1); } },
          gravel(x,R){ grain(x,0x6a6660,.2,R,2);
            for(let i=0;i<12;i++){ const cols=[0x8a8278,0x5a564e,0x9a948a,0x4a463e];
              x.fillStyle=hx(cols[(R()*4)|0]);
              x.fillRect((R()*28)|0,(R()*28)|0,3+((R()*3)|0),2+((R()*3)|0)); } },
          snow(x,R){ grain(x,0xeef2f8,.05,R,2);
            for(let i=0;i<5;i++){ x.fillStyle='rgba(150,180,220,.3)'; x.fillRect((R()*28)|0,(R()*28)|0,3,2); } // drifts
            for(let i=0;i<6;i++){ x.fillStyle='#ffffff'; x.fillRect((R()*30)|0,(R()*30)|0,1,1); } },
          obsidian(x,R){ grain(x,0x16141e,.25,R,2);
            for(let i=0;i<4;i++){ x.strokeStyle='rgba(140,80,200,.35)'; x.lineWidth=1;   // purple sheen
              const sx=R()*28; x.beginPath(); x.moveTo(sx,32); x.lineTo(sx+8,0); x.stroke(); }
            for(let i=0;i<3;i++){ x.fillStyle='rgba(255,255,255,.4)'; x.fillRect((R()*30)|0,(R()*30)|0,1,1); } },
        
          // ---- ores: stone host + signature flecks ----
          copper_ore(x,R){ PAINTERS.stone(x,R);
            for(let i=0;i<5;i++){ const ox=(R()*24+2)|0, oy=(R()*24+2)|0;
              x.fillStyle='#d0703a'; x.fillRect(ox,oy,4,3);
              x.fillStyle='#4aa07a'; x.fillRect(ox+3,oy-1,2,2);                // patina edge
              x.fillStyle='#f0a070'; x.fillRect(ox,oy,1,1); } },
          iron_ore(x,R){ PAINTERS.stone(x,R);
            for(let i=0;i<5;i++){ const ox=(R()*24+2)|0, oy=(R()*24+2)|0;
              x.fillStyle='#a05438'; x.fillRect(ox,oy,4,4);
              x.fillStyle='#6a3220'; x.fillRect(ox+1,oy+1,2,2); } },
          gold_ore(x,R){ PAINTERS.stone(x,R);
            for(let i=0;i<5;i++){ const ox=(R()*24+2)|0, oy=(R()*24+2)|0;
              x.fillStyle='#e8c040'; x.fillRect(ox,oy,4,3);
              x.fillStyle='#fff0b0'; x.fillRect(ox,oy,2,1); } },
          titanium_ore(x,R){ grain(x,0x5a6068,.18,R,2);
            for(let i=0;i<5;i++){ const ox=(R()*24+2)|0, oy=(R()*24+2)|0;     // angular shards
              x.fillStyle='#d8e0e8'; x.beginPath();
              x.moveTo(ox,oy+4); x.lineTo(ox+2,oy); x.lineTo(ox+5,oy+3); x.lineTo(ox+3,oy+5); x.fill();
              x.fillStyle='#ffffff'; x.fillRect(ox+2,oy+1,1,1); } },
          cobalt(x,R){ grain(x,0x1a2438,.25,R,2);
            for(let i=0;i<5;i++){ const ox=(R()*22+2)|0, oy=(R()*20+2)|0;
              x.fillStyle='#3a6ae8'; x.fillRect(ox,oy,4,7);
              x.fillStyle='#8ab0ff'; x.fillRect(ox+1,oy+1,2,5);
              x.fillStyle='#d8e8ff'; x.fillRect(ox+1,oy+1,1,2); } },
          carbon(x,R){ grain(x,0x2a2a2e,.2,R,2);
            for(let i=0;i<4;i++){ x.fillStyle='#0c0c10';                       // glossy seams
              x.fillRect((R()*20)|0,(R()*26)|0,8+((R()*8)|0),3);
              x.fillStyle='rgba(255,255,255,.3)'; x.fillRect((R()*28)|0,(R()*28)|0,2,1); } },
        
          // ---- crystals ----
          emerald(x,R){ grain(x,0x1d5a36,.25,R,2);
            for(let i=0;i<4;i++){ const cx=(R()*22+2)|0, cy=(R()*16+2)|0;
              x.fillStyle='#4ae87a'; x.fillRect(cx,cy,5,11);
              x.fillStyle='#c2ffd8'; x.fillRect(cx+1,cy+1,2,9);
              x.fillStyle='rgba(0,0,0,.3)'; x.fillRect(cx+4,cy+2,1,8); } },
          void_crystal(x,R){ grain(x,0x0e0c16,.3,R,2);
            for(let i=0;i<3;i++){ x.strokeStyle='rgba(70,70,130,.5)'; x.lineWidth=1;
              const sx=R()*26; x.beginPath(); x.moveTo(sx,30); x.lineTo(sx+5,2); x.stroke(); }
            for(let i=0;i<8;i++){ x.fillStyle=R()<.6?'#ffffff':'#6fe3ff';      // trapped stars
              x.fillRect((R()*30)|0,(R()*30)|0,1,1); } },
        
          // ---- crafted / station ----
          alloy(x,R){ grain(x,0x7a838c,.06,R,4);
            for(let i=0;i<6;i++){ x.fillStyle='rgba(255,255,255,.12)'; x.fillRect(0,3+i*5,32,1); } // brushed
            x.fillStyle='#e8b33b'; x.fillRect(24,24,8,3); x.fillRect(24,29,8,3);  // hazard corner
            x.fillStyle='#1c1c1f'; x.fillRect(24,27,8,2);
            x.fillStyle='#c8d2dc'; x.fillRect(3,3,2,2); x.fillRect(3,27,2,2); },
          glass(x,R){ x.clearRect(0,0,32,32);
            x.fillStyle='rgba(180,220,240,.28)'; x.fillRect(0,0,32,32);
            x.strokeStyle='rgba(255,255,255,.4)'; x.lineWidth=1;
            x.beginPath(); x.moveTo(4,28); x.lineTo(20,6); x.moveTo(10,30); x.lineTo(26,10); x.stroke(); },
          lamp(x,R){ grain(x,0x4a4438,.15,R,2);
            x.fillStyle='#ffe8b0'; x.fillRect(6,6,20,20);
            x.fillStyle='#fff8e0'; x.fillRect(10,10,12,12);
            x.fillStyle='#c8d2dc'; [[2,2],[27,2],[2,27],[27,27]].forEach(([bx,by])=>x.fillRect(bx,by,3,3)); },
          hull(x,R){ grain(x,0x3a4048,.1,R,4);
            x.fillStyle='rgba(0,0,0,.3)'; x.fillRect(0,15,32,2);
            x.fillStyle='#e8b33b'; x.fillRect(0,28,10,4);
            x.fillStyle='#9aa6b2';
            for(let i=0;i<4;i++){ x.fillRect(3+i*8,4,3,3); x.fillRect(3+i*8,21,3,3); } },
        
          // ---- organic ----
          fungal_top(x,R){ grain(x,0x5a4458,.28,R,2);
            for(let i=0;i<6;i++){ x.fillStyle='#c88ae0'; x.fillRect((R()*30)|0,(R()*30)|0,2,2); }   // spores
            for(let i=0;i<3;i++){ x.strokeStyle='rgba(200,140,220,.4)'; x.lineWidth=1;              // mycelium veins
              const sx=R()*28, sy=R()*28; x.beginPath(); x.moveTo(sx,sy); x.lineTo(sx+6,sy+4); x.lineTo(sx+10,sy+2); x.stroke(); } },
          fungal_side(x,R){ grain(x,0x4a4438,.3,R,2);
            x.fillStyle='#5a4458'; x.fillRect(0,0,32,6);
            for(let i=0;i<6;i++){ x.fillStyle='#48364a'; x.fillRect((R()*30)|0,5+((R()*4)|0),2,3); } },
          deco_shroom(x,R){ // alien mushrooms: stems + dotted caps
            for(let i=0;i<3;i++){
              const bx=5+R()*22, h=8+R()*10, w=5+R()*4;
              x.fillStyle='#e0d8c8'; x.fillRect(bx-1,32-h,3,h);                 // stem
              const capCol = R()<.5? '#d8493c':'#9a4ae0';
              x.fillStyle=capCol; x.fillRect(bx-w/2,30-h-4,w+2,5);              // cap
              x.fillStyle='rgba(255,255,255,.8)';
              x.fillRect(bx-w/2+1,29-h-2,2,2); x.fillRect(bx+w/2-2,30-h-3,2,2); // cap dots
            }
          },
        
          // ---- animated (x,R,frame) ----
          lava(x,R,frame){
            grain(x,0x401410,.3,R,2);
            for(let i=0;i<6;i++){                                              // flowing cracks
              const sy=(i*6+frame*2)%32;
              x.strokeStyle = i%2? '#ff7a2c':'#ffc24a'; x.lineWidth=2;
              x.beginPath(); x.moveTo(0,sy); x.quadraticCurveTo(16,sy+4-frame, 32,sy); x.stroke();
            }
            x.fillStyle='rgba(255,220,140,.6)'; x.fillRect(((frame*9)%26)|0,((frame*5)%26)|0,4,3);
          },
          acid(x,R,frame){
            grain(x,0x2a5a1a,.25,R,2);
            for(let i=0;i<6;i++){                                              // rising bubbles
              const bx=(ihash(i,7,1)*28)|0, by=(28-((frame*4+i*8)%28))|0;
              x.strokeStyle='#7dff6a'; x.lineWidth=1;
              x.beginPath(); x.arc(bx+2,by,2+(i%2),0,7); x.stroke();
            }
            x.fillStyle='rgba(180,255,140,.35)'; x.fillRect(0,frame*2,32,2);
          },
          circuit(x,R,frame){
            grain(x,0x14301c,.15,R,2);
            x.strokeStyle='#2a8a4a'; x.lineWidth=1;                            // traces
            x.beginPath(); x.moveTo(4,28); x.lineTo(4,10); x.lineTo(16,10); x.lineTo(16,22); x.lineTo(28,22);
            x.moveTo(8,28); x.lineTo(8,16); x.lineTo(24,16); x.lineTo(24,4); x.stroke();
            x.fillStyle='#1a4a2a'; x.fillRect(12,12,8,8);                      // chip
            const leds=[[4,10],[16,22],[24,4],[8,28],[28,22]];                 // blink by frame
            leds.forEach(([lx,ly],i)=>{
              x.fillStyle = ((i+frame)%3===0)? '#6fe3ff' : ((i+frame)%3===1? '#ffd45c':'#16301c');
              x.fillRect(lx-1,ly-1,3,3);
            });
          },
          uranium(x,R,frame){
            PAINTERS.stone(x,R);
            const p = [1,.75,.5,.75][frame];                                   // pulsing flecks
            for(let i=0;i<5;i++){ const ox=(ihash(i,3,9)*24+2)|0, oy=(ihash(i,5,2)*24+2)|0;
              x.fillStyle=hx(shade(0x52e83a,p)); x.fillRect(ox,oy,4,4);
              x.fillStyle=hx(shade(0xc8ffb0,p)); x.fillRect(ox+1,oy+1,2,2); }
          },
          hive(x,R,frame){
            grain(x,0x9a6a20,.25,R,2);
            for(let i=0;i<6;i++){                                              // breathing cells
              const cx=(ihash(i,1,4)*24+4)|0, cy=(ihash(i,2,8)*24+4)|0;
              const p=[.7,1,.85,1][(i+frame)%4];
              x.fillStyle=hx(shade(0xe09a30,p)); x.fillRect(cx-3,cy-2,7,6);
              x.fillStyle=hx(shade(0xffd47a,p)); x.fillRect(cx-1,cy,3,3);
              x.strokeStyle='rgba(60,30,5,.6)'; x.lineWidth=1; x.strokeRect(cx-3,cy-2,7,6);
            }
          },
        };
        const NO_BORDER = new Set(['tall_grass','flower_red','flower_yellow',
          'deco_frond','deco_spore','deco_quill','deco_quill_glow','deco_plume','deco_shroom']);
        function paintTile(name, frame){
          const c=document.createElement('canvas'); c.width=c.height=TILE;
          const x=c.getContext('2d');
          PAINTERS[name](x, rng(SEED ^ name.length*7919 ^ (frame||0)*131), frame);
          if(!NO_BORDER.has(name)) edgeBorder(x);
          return c;
        }
        
        // ---------- block registry: one entry per block, painters do the rest ----------
        const CATEGORIES = ['Terrain','Life','Resources','Crystals','Crafted','Hazards'];
        const BlockRegistry = [
          // ---- Terrain ----
          { id:2,  cat:'Terrain', name:'Dirt',     tiles:{all:'dirt'},     hardness:2, tags:['natural'],
            desc:'Loose topsoil. Easy digging, poor building. Most life roots in it.',
            sci:{formula:'SiO₂ + organic matter', mineral:'Soil', fact:'Soil is crushed rock mixed with decomposed plants. It takes centuries to form one centimeter.'} },
          { id:3,  cat:'Terrain', name:'Stone',    tiles:{all:'stone'},    hardness:5, tags:['natural'],
            desc:'The crust of most worlds. Hosts every ore vein worth chasing.',
            sci:{formula:'SiO₂ silicates', mineral:'Rock', fact:'Most planetary crust is silicate minerals: silicon and oxygen bonded into crystals.'} },
          { id:4,  cat:'Terrain', name:'Sand',     tiles:{all:'sand'},     hardness:1, tags:['natural'],
            desc:'Wind-rippled silica. Smelts into glass at the refinery.',
            sci:{formula:'SiO₂', mineral:'Quartz sand', fact:'Pure quartz. Heat it past 1700°C and it melts into glass.'} },
          { id:19, cat:'Terrain', name:'Gravel',   tiles:{all:'gravel'},   hardness:2, tags:['natural'],
            desc:'Crushed rock and rubble. Occasionally hides loose minerals.',
            sci:{formula:'mixed silicates', mineral:'Rock fragments', fact:'Gravel is rock broken down by water, ice and time before it becomes sand.'} },
          { id:16, cat:'Terrain', name:'Regolith', tiles:{all:'regolith'}, hardness:2, tags:['natural','barren'],
            desc:'Cratered dust of airless moons. Fine, abrasive, gets everywhere.',
            sci:{formula:'crushed silicates', mineral:'Regolith', fact:'A real word: the loose dust covering the Moon and Mars. No wind or water ever sorted it.'} },
          { id:18, cat:'Terrain', name:'Red Rock', tiles:{all:'red_rock'}, hardness:4, tags:['natural','barren'],
            desc:'Iron-oxide strata from dead desert worlds. Layers mark ancient floods.',
            sci:{formula:'Fe₂O₃ coating', mineral:'Iron oxide', fact:'The same rust that makes Mars red. Iron + oxygen, slowly, over millions of years.'} },
          { id:17, cat:'Terrain', name:'Basalt',   tiles:{all:'basalt'},   hardness:6, tags:['natural','volcanic'],
            desc:'Columned volcanic bedrock. Heavy metals hide deep inside it.',
            sci:{formula:'NaAlSi₃O₈ + pyroxene', mineral:'Basalt', fact:'Cooled lava. The ocean floors of Earth and most of the dark patches on the Moon are basalt.'} },
          { id:21, cat:'Terrain', name:'Obsidian', tiles:{all:'obsidian'}, hardness:9, tags:['natural','volcanic'],
            desc:'Glass born where lava meets rock. Brutally hard to mine.',
            sci:{formula:'SiO₂ ~70%', mineral:'Volcanic glass', fact:'Lava that cooled too fast for crystals to form. So sharp it was used for surgical blades.'} },
          { id:8,  cat:'Terrain', name:'Ice',      tiles:{all:'ice'},      hardness:2, tags:['natural','slippery'],
            desc:'Frozen solid and treacherous underfoot. Melts into clean water.',
            sci:{formula:'H₂O', mineral:'Water ice', fact:'Frozen water expands, which is why ice floats. Almost no other solid does that.'} },
          { id:20, cat:'Terrain', name:'Snow',     tiles:{all:'snow'},     hardness:1, tags:['natural','cold'],
            desc:'Powder cover on cold-band worlds. Muffles footsteps.',
            sci:{formula:'H₂O', mineral:'Snow crystal', fact:'Every snowflake is a hexagonal ice crystal. The six-fold shape comes from the water molecule itself.'} },
        
          // ---- Life ----
          { id:1,  cat:'Life', name:'Grass', tiles:{top:'grass_top', side:'grass_side', bottom:'dirt'}, hardness:2, tags:['natural'],
            deco:{tile:'tall_grass', flowers:['flower_red','flower_yellow'], fc:.07, r:1, h:1},
            desc:'Temperate meadow turf. The most Earth-like thing out here.',
            sci:{formula:'(C₆H₁₀O₅)ₙ', mineral:'Cellulose', fact:'Grass is mostly cellulose, sugar chains plants build from CO₂ and sunlight.'} },
          { id:12, cat:'Life', name:'Frond', tiles:{top:'frond_top', side:'frond_side', bottom:'dirt'}, hardness:2, tags:['natural','alien'],
            deco:{tile:'deco_frond', r:.7, h:1.7},
            desc:'Tall cyan wisps that drink starlight. Sways even without wind.',
            sci:{formula:'(C₆H₁₀O₅)ₙ + unknown pigment', mineral:'Uncharted flora', fact:'Plants are green because chlorophyll reflects green light. Under a different star, other pigments could win.'} },
          { id:13, cat:'Life', name:'Spore', tiles:{top:'spore_top', side:'spore_side', bottom:'dirt'}, hardness:2, tags:['natural','alien'],
            deco:{tile:'deco_spore', r:1.25, h:.5},
            desc:'Stubby crimson turf capped with glowing spore pods. Do not inhale.',
            sci:{formula:'(C₆H₁₀O₅)ₙ + unknown pigment', mineral:'Uncharted flora', fact:'Red leaves absorb green and blue light. Useful around a dim red dwarf star.'} },
          { id:14, cat:'Life', name:'Quill', tiles:{top:'quill_top', side:'quill_side', bottom:'dirt'}, hardness:2, tags:['natural','alien','glows'],
            deco:{tile:'deco_quill', flowers:['deco_quill_glow'], fc:.2, r:.55, h:2.0}, glowColor:0x3a2a5a,
            desc:'Needle-straight violet spines, tips lit from within. Beautiful at night.',
            sci:{formula:'unknown', mineral:'Uncharted flora', fact:'Bioluminescence is real chemistry: luciferin + oxygen = light. Fireflies and deep sea fish do it.'} },
          { id:15, cat:'Life', name:'Plume', tiles:{top:'plume_top', side:'plume_side', bottom:'dirt'}, hardness:2, tags:['natural','alien'],
            deco:{tile:'deco_plume', r:1.35, h:1.25},
            desc:'Wide golden feather-grass. Whole valleys of it ripple like water.',
            sci:{formula:'(C₆H₁₀O₅)ₙ + carotenoids', mineral:'Uncharted flora', fact:'Gold and orange in plants comes from carotenoids, the same pigment as in carrots.'} },
          { id:36, cat:'Life', name:'Fungal', tiles:{top:'fungal_top', side:'fungal_side', bottom:'dirt'}, hardness:2, tags:['natural','alien'],
            deco:{tile:'deco_shroom', r:1.1, h:.7, sway:.25},
            desc:'Mycelium-laced soil sprouting alien mushrooms. The veins connect for miles.',
            sci:{formula:'(C₈H₁₃O₅N)ₙ', mineral:'Chitin', fact:'Fungi cell walls are chitin, the same material as insect shells. Fungi are closer to animals than plants.'} },
          { id:5,  cat:'Life', name:'Wood',   tiles:{top:'wood_top', side:'wood_side', bottom:'wood_top'}, hardness:3, tags:['natural','flammable'],
            desc:'Trunk timber. Burns, builds, and floats. The first material of every base.',
            sci:{formula:'(C₆H₁₀O₅)ₙ + lignin', mineral:'Wood', fact:'Cellulose for flexibility, lignin for stiffness. Trees are natural composite material.'} },
          { id:6,  cat:'Life', name:'Leaves', tiles:{all:'leaves'}, hardness:1, tags:['natural','flammable'],
            desc:'Canopy foliage with the odd berry. Breaks with a single swipe.',
            sci:{formula:'C₅₅H₇₂MgN₄O₅', mineral:'Chlorophyll', fact:'The light-catching molecule. One magnesium atom sits at the center of every chlorophyll.'} },
          { id:37, cat:'Life', name:'Hive',   tiles:{all:'hive'},   hardness:3, tags:['natural','organic','glows'], animated:true, glowColor:0x6a4a10,
            desc:'Living amber comb. The cells breathe. Something built this.',
            sci:{formula:'unknown organic esters', mineral:'Uncharted', fact:'Real honeycomb is beeswax built into hexagons, the shape that holds the most with the least material.'} },
        
          // ---- Resources ----
          { id:27, cat:'Resources', name:'Carbon',       tiles:{all:'carbon'},       hardness:3, tags:['resource','fuel'],
            desc:'Glossy black seams near the surface. Fuel, filters, and alloys all start here.',
            sci:{formula:'C', mineral:'Carbon (coal/graphite)', fact:'Pure carbon. Squeeze it hard enough underground and the same element becomes diamond.'} },
          { id:22, cat:'Resources', name:'Copper Ore',   tiles:{all:'copper_ore'},   hardness:4, tags:['resource','conductor'],
            desc:'Green-patina conductor metal. Every circuit needs it.',
            sci:{formula:'CuFeS₂', mineral:'Chalcopyrite', fact:'The main copper ore. The green patina on old copper roofs is the same chemistry.'} },
          { id:23, cat:'Resources', name:'Iron Ore',     tiles:{all:'iron_ore'},     hardness:5, tags:['resource','structural'],
            desc:'Rust-red workhorse metal. Smelts into the bones of any structure.',
            sci:{formula:'Fe₂O₃', mineral:'Hematite', fact:'Iron ore. Smelting strips the oxygen away with carbon, a 3000-year-old trick.'} },
          { id:24, cat:'Resources', name:'Gold Ore',     tiles:{all:'gold_ore'},     hardness:5, tags:['resource','precious'],
            desc:'Soft, rare, and corrosion-proof. Trade currency across the colonies.',
            sci:{formula:'Au', mineral:'Native gold', fact:'Gold is forged in neutron star collisions. Every gram on any planet fell from space.'} },
          { id:25, cat:'Resources', name:'Titanium Ore', tiles:{all:'titanium_ore'}, hardness:7, tags:['resource','structural'],
            desc:'Angular silver shards locked in basalt. Hull-grade strength at half the weight.',
            sci:{formula:'FeTiO₃', mineral:'Ilmenite', fact:'Titanium ore. As strong as steel at almost half the weight, which is why spacecraft love it.'} },
          { id:26, cat:'Resources', name:'Cobalt',       tiles:{all:'cobalt'},       hardness:5, tags:['resource','cave'], glowColor:0x1a2a6a,
            desc:'Deep-blue blooms found only on cave walls. Battery chemistry runs on it.',
            sci:{formula:'CoAsS', mineral:'Cobaltite', fact:'Cobalt blue colored glass and pottery for centuries. Today it runs your batteries.'} },
          { id:9,  cat:'Resources', name:'Aether Ore',   tiles:{all:'ore'},          hardness:6, tags:['resource','glows'], glowColor:0x1a5a6a,
            desc:'Faintly luminous cyan mineral. Powers warp cells. Origin unknown.',
            sci:{formula:'??', mineral:'Uncharted mineral', fact:'Not on the periodic table. Yet.'} },
          { id:28, cat:'Resources', name:'Uranium Ore',  tiles:{all:'uranium'},      hardness:7, tags:['resource','radioactive','glows'],
            animated:true, glowColor:0x2a7a1a,
            desc:'Pulses green in the deep dark. Reactor fuel. Keep your distance counter on.',
            sci:{formula:'UO₂', mineral:'Uraninite', fact:'Uranium decays and releases heat for billions of years. That heat keeps the core of the Earth molten too.'} },
        
          // ---- Crystals ----
          { id:10, cat:'Crystals', name:'Crystal',         tiles:{all:'crystal'},      hardness:4, tags:['natural','glows'], glowColor:0x5a2a78,
            desc:'Violet formations hanging from the underside of worlds. Lens-grade clarity.',
            sci:{formula:'SiO₂ + Fe traces', mineral:'Amethyst', fact:'Quartz again, but trace iron atoms inside the crystal tint it violet.'} },
          { id:29, cat:'Crystals', name:'Emerald Crystal', tiles:{all:'emerald'},      hardness:4, tags:['resource','glows'], glowColor:0x1a6a32,
            desc:'Green-bright and resonant. Tunes laser arrays a full band higher.',
            sci:{formula:'Be₃Al₂Si₆O₁₈', mineral:'Beryl (emerald)', fact:'Beryl is colorless. A pinch of chromium atoms turns it emerald green.'} },
          { id:30, cat:'Crystals', name:'Void Crystal',    tiles:{all:'void_crystal'}, hardness:8, tags:['resource','exotic','glows'], glowColor:0x2a2a5a,
            desc:'Near-black lattice with starlight trapped inside. The rarest find there is.',
            sci:{formula:'??', mineral:'Uncharted crystal', fact:'No known lattice scatters light like this.'} },
        
          // ---- Crafted ----
          { id:7,  cat:'Crafted', name:'Metal',   tiles:{all:'metal'},   hardness:8,  tags:['crafted'],
            desc:'Riveted panel plating. The default wall of every outpost.',
            sci:{formula:'Fe + C', mineral:'Steel', fact:'Iron with a little carbon mixed in. The carbon atoms lock the iron crystals so they cannot slip.'} },
          { id:31, cat:'Crafted', name:'Alloy',   tiles:{all:'alloy'},   hardness:9,  tags:['crafted','structural'],
            desc:'Brushed titanium-iron composite. Hazard-striped and near indestructible.',
            sci:{formula:'Ti-Fe composite', mineral:'Alloy', fact:'Mixing metals changes everything: bronze, brass and steel are all alloys.'} },
          { id:32, cat:'Crafted', name:'Glass',   tiles:{all:'glass'},   hardness:2,  tags:['crafted'], transparent:true,
            desc:'Smelted silica pane. Fragile, but every base deserves a view.',
            sci:{formula:'SiO₂ (amorphous)', mineral:'Glass', fact:'Melted sand, frozen mid-chaos. Glass has no crystal structure at all.'} },
          { id:33, cat:'Crafted', name:'Circuit', tiles:{all:'circuit'}, hardness:4,  tags:['crafted','tech'], animated:true, glowColor:0x1a4a3a,
            desc:'Printed logic board, LEDs blinking. The brain of doors, drones, and turrets.',
            sci:{formula:'Cu on Si', mineral:'Silicon + copper', fact:'Computer chips are carved from silicon, the second most common element in planetary crust.'} },
          { id:34, cat:'Crafted', name:'Lamp',    tiles:{all:'lamp'},    hardness:3,  tags:['crafted','glows'], glowColor:0x7a6a28,
            desc:'Warm panel light. Marks the line between base and wilderness.',
            sci:{formula:'GaN', mineral:'Gallium nitride LED', fact:'The blue LED was so hard to invent it won the 2014 Nobel Prize. White light needs blue first.'} },
          { id:35, cat:'Crafted', name:'Hull',    tiles:{all:'hull'},    hardness:10, tags:['crafted','structural'],
            desc:'Ship-grade armor plating. If it can hold vacuum, it can hold anything.',
            sci:{formula:'Ti alloy', mineral:'Titanium plate', fact:'Spacecraft hulls must hold one atmosphere of pressure against pure vacuum.'} },
        
          // ---- Hazards ----
          { id:11, cat:'Hazards', name:'Energy', tiles:{all:'energy'}, hardness:9, tags:['hazard','glows'], animated:true, glowColor:0x6a2a08,
            desc:'Raw plasma trapped in rock. Touch nothing. Harvest with shielded tools only.',
            sci:{formula:'ionized matter', mineral:'Plasma', fact:'The fourth state of matter. Stars, lightning and neon signs are all plasma.'} },
          { id:38, cat:'Hazards', name:'Lava',   tiles:{all:'lava'},   hardness:9, tags:['hazard','glows'], animated:true, glowColor:0x6a2008,
            desc:'Molten core flow. Forms obsidian where it cools against stone.',
            sci:{formula:'molten silicates', mineral:'Lava', fact:'Liquid rock at 700 to 1200°C. It glows because hot things emit light: black-body radiation.'} },
          { id:39, cat:'Hazards', name:'Acid',   tiles:{all:'acid'},   hardness:9, tags:['hazard','glows'], animated:true, glowColor:0x2a6a10,
            desc:'Bubbling solvent pools on cave floors. Eats boots, tools, and patience.',
            sci:{formula:'H₂SO₄', mineral:'Sulfuric acid', fact:'The clouds of Venus are droplets of sulfuric acid. Real planets can be this hostile.'} },
        ];
        const blockById = id => BlockRegistry.find(b=>b.id===id);
        
        // ---------- texture atlas (static) + animated strip ----------
        // every non-animated tile gets a slot in one atlas; energy lives on its own
        // 4-frame strip whose material offset is stepped (cheapest possible animation)
        const tileIndex = {};   // tileName -> {u0,v0,u1,v1}
        const animIndex = {};   // animated tileName -> {v0,v1,row,rows}
        let atlasTex=null, energyTex=null;
        function buildTextures(){
          const names = [...new Set([
            ...BlockRegistry.filter(b=>!b.animated).flatMap(b=>Object.values(b.tiles)),
            ...BlockRegistry.filter(b=>b.deco).flatMap(b=>[b.deco.tile, ...(b.deco.flowers||[])]),
          ])];
          const cols = 4, rows = Math.ceil(names.length/cols);
          const c=document.createElement('canvas'); c.width=cols*TILE; c.height=rows*TILE;
          const x=c.getContext('2d');
          names.forEach((n,i)=>{
            const col=i%cols, row=(i/cols)|0;
            x.drawImage(paintTile(n), col*TILE, row*TILE);
            // half-texel inset prevents atlas bleeding at quad edges
            const e = .5/(cols*TILE);
            tileIndex[n] = { u0:col/cols+e, v0:1-(row+1)/rows+e, u1:(col+1)/cols-e, v1:1-row/rows-e };
          });
          atlasTex = new THREE.CanvasTexture(c);
          atlasTex.magFilter=THREE.NearestFilter; atlasTex.minFilter=THREE.NearestFilter;
        
          // animated strip: one row per animated block, 4 frames wide. a single
          // shared material offset.x steps every row's frames simultaneously
          const animNames = BlockRegistry.filter(b=>b.animated).map(b=>b.tiles.all);
          const ec=document.createElement('canvas'); ec.width=TILE*4; ec.height=TILE*animNames.length;
          const ex=ec.getContext('2d');
          animNames.forEach((n,row)=>{
            for(let f=0;f<4;f++) ex.drawImage(paintTile(n,f), f*TILE, row*TILE);
            const rows=animNames.length, e=.5/(rows*TILE);
            animIndex[n] = { v0:1-(row+1)/rows+e, v1:1-row/rows-e, row, rows };
          });
          energyTex = new THREE.CanvasTexture(ec);
          energyTex.magFilter=THREE.NearestFilter; energyTex.minFilter=THREE.NearestFilter;
          energyTex.wrapS = THREE.RepeatWrapping;
        }
        
        // ---------- world data ----------
        const W=48, H=32, D=48, CH=16;
        const WORLD_OFFSET = new THREE.Vector3(-W/2, -6, -D/2);   // center asteroid near origin
        let blocks = new Uint8Array(W*H*D);
        const bidx = (x,y,z) => (y*D+z)*W+x;
        function getBlock(x,y,z){
          if(x<0||y<0||z<0||x>=W||y>=H||z>=D) return 0;
          return blocks[bidx(x,y,z)];
        }
        // THE multiplayer primitive: every world change funnels through here.
        // later: broadcast {x,y,z,id} to peers and call this on receive.
        function setBlockEvent(x,y,z,id){
          if(x<0||y<0||z<0||x>=W||y>=H||z>=D) return;
          blocks[bidx(x,y,z)] = id;
          rebuildChunkAt(x,y,z);
          // borders share faces with the neighbor chunk
          if(x%CH===0) rebuildChunkAt(x-1,y,z); if(x%CH===CH-1) rebuildChunkAt(x+1,y,z);
          if(y%CH===0) rebuildChunkAt(x,y-1,z); if(y%CH===CH-1) rebuildChunkAt(x,y+1,z);
          if(z%CH===0) rebuildChunkAt(x,y,z-1); if(z%CH===CH-1) rebuildChunkAt(x,y,z+1);
        }
        
        // ---------- deterministic worldgen: same seed = same asteroid ----------
        function generateWorld(){
          blocks.fill(0);
          // asteroid shell: radial falloff top + bottom with noise
          for(let x=0;x<W;x++) for(let z=0;z<D;z++){
            const dx=(x-W/2)/22, dz=(z-D/2)/22, rad=Math.sqrt(dx*dx+dz*dz);
            if(rad>1) continue;
            const topY = 17 + fbm2(x*.09,z*.09)*6*(1-rad*.5) - rad*4;
            const botY = 15 - (1-rad)*(8+fbm2(x*.11+50,z*.11+50)*5);
            for(let y=Math.max(0,botY|0); y<=Math.min(H-1,topY|0); y++){
              if(fbm3(x*.1,y*.1,z*.1)>.68) continue;            // caves
              blocks[bidx(x,y,z)] = 3;                          // stone base
            }
          }
          // surface pass: grass / sand / ice caps, dirt beneath
          for(let x=0;x<W;x++) for(let z=0;z<D;z++){
            for(let y=H-1;y>0;y--){
              if(!getBlock(x,y,z)) continue;
              if(!getBlock(x,y+1,z)){
                const dx=(x-W/2)/22, dz=(z-D/2)/22, rad=Math.sqrt(dx*dx+dz*dz);
                // biome patches: one noise channel picks which grass family grows here
                const bn = fbm2(x*.045+777, z*.045+777);
                let top = bn<.34? 1 : bn<.42? 12 : bn<.48? 13 : bn<.53? 14 : bn<.58? 15
                        : bn<.64? 36 : bn<.7? 16 : 18;          // fungal / regolith / red rock
                if(top===16 && ihash(x,0,z)<.18) top = 19;      // gravel scatter on regolith
                if(rad>.74) top = 4;                            // sandy rim
                const icy = fbm2(x*.13+99,z*.13+99);
                if(icy>.7) top = 8; else if(icy>.64) top = 20;  // ice cores, snow fringes
                blocks[bidx(x,y,z)] = top;
                for(let d=1;d<=2;d++) if(getBlock(x,y-d,z)===3) blocks[bidx(x,y-d,z)]=2;
              }
              break;                                            // only topmost run
            }
          }
          // deep geology: basalt foundation under the stone
          for(let x=0;x<W;x++) for(let z=0;z<D;z++){
            const bd = 7 + fbm2(x*.1+321,z*.1+321)*3;
            for(let y=0;y<bd;y++) if(getBlock(x,y,z)===3) blocks[bidx(x,y,z)]=17;
          }
          // ore veins by depth: shallow conductors, deep heavy metals
          const R = rng(SEED^0xbeef);
          function veins(n, id, yMin, yMax, len, host){
            for(let v=0;v<n;v++){
              let x=(R()*W)|0, y=yMin+((R()*(yMax-yMin))|0), z=(R()*D)|0;
              for(let s=0;s<len+((R()*len)|0);s++){
                const cur=getBlock(x,y,z);
                if(cur===3 || (host && cur===17)) blocks[bidx(x,y,z)]=id;
                x+=(R()*3|0)-1; y+=(R()*3|0)-1; z+=(R()*3|0)-1;
                if(x<0||y<0||z<0||x>=W||y>=H||z>=D) break;
              }
            }
          }
          veins(20, 27, 14, 26, 7);        // carbon seams: shallow and long
          veins(18, 22, 12, 24, 5);        // copper
          veins(16, 23,  8, 20, 5);        // iron
          veins(10, 24,  4, 14, 4);        // gold
          veins(8,  25,  3, 12, 4, true);  // titanium: down in the basalt
          veins(5,  28,  2,  9, 3, true);  // uranium: deep and rare
          veins(14, 9,   6, 18, 4);        // aether ore
          // cobalt blooms on cave walls
          for(let x=1;x<W-1;x++) for(let y=2;y<14;y++) for(let z=1;z<D-1;z++){
            if(getBlock(x,y,z)!==3 && getBlock(x,y,z)!==17) continue;
            const nearAir = !getBlock(x+1,y,z)||!getBlock(x-1,y,z)||!getBlock(x,y,z+1)||!getBlock(x,y,z-1);
            if(nearAir && getBlock(x,y+1,z) && ihash(x*3,y*5,z*7)<.05) blocks[bidx(x,y,z)]=26;
          }
          // molten core: lava pockets sheathed in obsidian, energy above them
          for(let x=0;x<W;x++) for(let y=0;y<13;y++) for(let z=0;z<D;z++){
            const cur=getBlock(x,y,z);
            if(cur!==3 && cur!==17) continue;
            const f = fbm3(x*.14+30,y*.14+30,z*.14+30);
            if(y<6 && f>.64) blocks[bidx(x,y,z)]=38;
            else if(f>.66) blocks[bidx(x,y,z)]=11;
          }
          for(let x=1;x<W-1;x++) for(let y=1;y<13;y++) for(let z=1;z<D-1;z++){
            const cur=getBlock(x,y,z);
            if(cur!==3 && cur!==17) continue;
            for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
              if(getBlock(x+dx,y+dy,z+dz)===38){ blocks[bidx(x,y,z)]=21; break; }   // obsidian shell
            }
          }
          // acid pools in mid-depth cave floors
          for(let x=0;x<W;x++) for(let y=8;y<13;y++) for(let z=0;z<D;z++){
            if(getBlock(x,y,z)===3 && !getBlock(x,y+1,z) && getBlock(x,y-1,z)
               && fbm3(x*.2+60,y*.2,z*.2+60)>.6) blocks[bidx(x,y,z)]=39;
          }
          // hive colonies: small organic blobs underground
          for(let h=0;h<3;h++){
            const hx=6+((R()*(W-12))|0), hy=8+((R()*8)|0), hz=6+((R()*(D-12))|0);
            for(let dx=-2;dx<=2;dx++) for(let dy=-1;dy<=2;dy++) for(let dz=-2;dz<=2;dz++){
              if(Math.abs(dx)+Math.abs(dy)+Math.abs(dz)>3) continue;
              const p=getBlock(hx+dx,hy+dy,hz+dz);
              if(p===3||p===17||p===2) blocks[bidx(hx+dx,hy+dy,hz+dz)]=37;
            }
          }
          // hanging crystals on the underside: violet, emerald, rare void
          for(let x=0;x<W;x++) for(let z=0;z<D;z++) for(let y=1;y<16;y++){
            if(getBlock(x,y,z) && !getBlock(x,y-1,z)){
              const r=ihash(x,y,z);
              if(r<.06) blocks[bidx(x,y-1,z)] = r<.03? 10 : (r<.052? 29 : 30);
            }
          }
          // a few trees on grass
          for(let t=0;t<7;t++){
            const x=8+((R()*(W-16))|0), z=8+((R()*(D-16))|0);
            for(let y=H-2;y>4;y--){
              if(getBlock(x,y,z)===1){
                const h=3+((R()*2)|0);
                for(let i=1;i<=h;i++) blocks[bidx(x,y+i,z)]=5;
                for(let lx=-2;lx<=2;lx++) for(let lz=-2;lz<=2;lz++) for(let ly=0;ly<=1;ly++){
                  if(Math.abs(lx)+Math.abs(lz)+ly>3) continue;
                  const p=bidx(x+lx,y+h+ly,z+lz);
                  if(!blocks[p]) blocks[p]=6;
                }
                blocks[bidx(x,y+h+2,z)]=6;
                break;
              }
              if(getBlock(x,y,z)) break;
            }
          }
        }
        
        // ---------- chunk meshing: merged geometry, face culling, vertex AO ----------
        // face table (CCW from outside) from the canonical voxel approach
        const FACES = [
          {dir:[-1,0,0], corners:[{pos:[0,1,0],uv:[0,1]},{pos:[0,0,0],uv:[0,0]},{pos:[0,1,1],uv:[1,1]},{pos:[0,0,1],uv:[1,0]}], bright:.8},
          {dir:[ 1,0,0], corners:[{pos:[1,1,1],uv:[0,1]},{pos:[1,0,1],uv:[0,0]},{pos:[1,1,0],uv:[1,1]},{pos:[1,0,0],uv:[1,0]}], bright:.8},
          {dir:[0,-1,0], corners:[{pos:[1,0,1],uv:[1,0]},{pos:[0,0,1],uv:[0,0]},{pos:[1,0,0],uv:[1,1]},{pos:[0,0,0],uv:[0,1]}], bright:.5},
          {dir:[0, 1,0], corners:[{pos:[0,1,1],uv:[1,1]},{pos:[1,1,1],uv:[0,1]},{pos:[0,1,0],uv:[1,0]},{pos:[1,1,0],uv:[0,0]}], bright:1},
          {dir:[0,0,-1], corners:[{pos:[1,0,0],uv:[0,0]},{pos:[0,0,0],uv:[1,0]},{pos:[1,1,0],uv:[0,1]},{pos:[0,1,0],uv:[1,1]}], bright:.7},
          {dir:[0,0, 1], corners:[{pos:[0,0,1],uv:[0,0]},{pos:[1,0,1],uv:[1,0]},{pos:[0,1,1],uv:[0,1]},{pos:[1,1,1],uv:[1,1]}], bright:.7},
        ];
        function tileFor(block, dir){
          const t = block.tiles;
          if(t.all) return t.all;
          if(dir[1]===1) return t.top;
          if(dir[1]===-1) return t.bottom;
          return t.side;
        }
        // classic 3-neighbor corner occlusion
        function vertexAO(x,y,z,dir,corner){
          const a = dir[0]? 0 : (dir[1]? 1:2);          // face axis
          const [b,c] = a===0? [1,2] : a===1? [0,2] : [0,1];
          const n=[dir[0],dir[1],dir[2]];
          const t1=[0,0,0], t2=[0,0,0];
          t1[b]=corner.pos[b]? 1:-1;
          t2[c]=corner.pos[c]? 1:-1;
          const occ = p => getBlock(x+p[0],y+p[1],z+p[2])? 1:0;
          const s1=occ([n[0]+t1[0],n[1]+t1[1],n[2]+t1[2]]);
          const s2=occ([n[0]+t2[0],n[1]+t2[1],n[2]+t2[2]]);
          const co=occ([n[0]+t1[0]+t2[0],n[1]+t1[1]+t2[1],n[2]+t1[2]+t2[2]]);
          const ao = (s1&&s2)? 3 : s1+s2+co;
          return 1 - ao*.18;
        }
        
        const scene3 = {chunks:new Map()};   // "cx,cy,cz" -> {static:Mesh, anim:Mesh, deco:Mesh}
        let matStatic=null, matAnim=null;
        // star-pattern decoration: three quads at 0/60/120 degrees so the tuft
        // reads as a volume from every angle instead of a flat X
        function addDeco(B,x,y,z,tileName,salt=0,ox=0,oz=0,rScale=1,hScale=1,swayScale=1){
          const t = tileIndex[tileName];
          const j1=(ihash(x*5+salt,y,z*5)-.5)*.16, j2=(ihash(x*7+1,y,z*7+salt)-.5)*.16;
          const cx=x+.5+ox+j1, cz=z+.5+oz+j2;
          const h=(.55+ihash(x+salt,y+3,z)*.45)*hScale;
          const r=.34*rScale;
          const spin=ihash(x,y+salt,z)*Math.PI;
          const br=.85+ihash(x,y+9,z+salt)*.2;
          for(let q=0;q<3;q++){
            const a=spin+q*Math.PI/3, dx=Math.cos(a)*r, dz=Math.sin(a)*r;
            const base=B.pos.length/3;
            B.pos.push(cx-dx,y,cz-dz,  cx+dx,y,cz+dz,  cx-dx,y+h,cz-dz,  cx+dx,y+h,cz+dz);
            B.uv.push(t.u0,t.v0, t.u1,t.v0, t.u0,t.v1, t.u1,t.v1);
            B.sway.push(0,0,swayScale,swayScale);       // tops sway, roots stay planted
            for(let i=0;i<4;i++) B.col.push(br,br,br);
            B.idx.push(base,base+1,base+2, base+2,base+1,base+3);
          }
        }
        // emit a 2x2 carpet for any block carrying a deco config; everything is
        // derived from seed + position so nothing is stored or synced
        function emitCarpet(B,block,x,y,z){
          const dc = block.deco;
          for(let gx=0;gx<2;gx++) for(let gz=0;gz<2;gz++){
            const salt = 1+gx*2+gz;
            const rv = ihash(x*3+salt*7, y, z*3+salt*13);
            let tile = dc.tile;
            if(dc.flowers && rv > 1-(dc.fc||0))
              tile = dc.flowers[(rv*997|0)%dc.flowers.length];
            const v = .8+rv*.4;
            addDeco(B, x, y+1, z, tile, salt, gx*.5-.25, gz*.5-.25, v*dc.r, v*dc.h, dc.sway===undefined?1:dc.sway);
          }
        }
        function decoFor(id,x,y,z){
          const b = blockById(id);
          return (b && b.deco && !getBlock(x,y+1,z))? b : null;
        }
        function buildChunkMesh(cx,cy,cz){
          const key=`${cx},${cy},${cz}`;
          const old = scene3.chunks.get(key);
          if(old){ ['static','anim','glass','deco'].forEach(k=>{ if(old[k]){ scene.remove(old[k]); old[k].geometry.dispose(); } }); }
        
          const buf = { pos:[], uv:[], col:[], idx:[] };
          const abuf = { pos:[], uv:[], col:[], idx:[] };
          const gbuf = { pos:[], uv:[], col:[], idx:[] };
          const dbuf = { pos:[], uv:[], col:[], idx:[], sway:[] };
        
          for(let lx=0;lx<CH;lx++) for(let ly=0;ly<CH;ly++) for(let lz=0;lz<CH;lz++){
            const x=cx*CH+lx, y=cy*CH+ly, z=cz*CH+lz;
            if(x>=W||y>=H||z>=D) continue;
            const id = getBlock(x,y,z);
            if(!id) continue;
            const block = blockById(id);
            const B = block.animated? abuf : (block.transparent? gbuf : buf);
        
            if(decoFor(id,x,y,z)) emitCarpet(dbuf,block,x,y,z);
        
            for(const face of FACES){
              const [dx,dy,dz] = face.dir;
              const nid = getBlock(x+dx,y+dy,z+dz);
              if(nid){
                const nb = blockById(nid);
                if(!nb.transparent) continue;                   // opaque neighbor hides this face
                if(nid===id) continue;                          // no inner faces between same glass
              }
              const base = B.pos.length/3;
              const tile = block.animated? null : tileIndex[tileFor(block,face.dir)];
              for(const corner of face.corners){
                B.pos.push(x+corner.pos[0], y+corner.pos[1], z+corner.pos[2]);
                let u,v;
                if(block.animated){
                  const a = animIndex[block.tiles.all];
                  u = corner.uv[0]*.25; v = lerp(a.v0,a.v1,corner.uv[1]);    // frame 0 of this block's row
                }
                else { u = lerp(tile.u0,tile.u1,corner.uv[0]); v = lerp(tile.v0,tile.v1,corner.uv[1]); }
                B.uv.push(u,v);
                const br = face.bright * vertexAO(x,y,z,face.dir,corner);
                B.col.push(br,br,br);
              }
              B.idx.push(base, base+1, base+2, base+2, base+1, base+3);
            }
          }
        
          const out = {};
          const mk = (b, mat) => {
            if(!b.idx.length) return null;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos,3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv,2));
            g.setAttribute('color', new THREE.Float32BufferAttribute(b.col,3));
            if(b.sway) g.setAttribute('sway', new THREE.Float32BufferAttribute(b.sway,1));
            g.setIndex(b.idx);
            g.computeVertexNormals();
            const m = new THREE.Mesh(g, mat);
            m.position.copy(WORLD_OFFSET);
            scene.add(m);
            return m;
          };
          out.static = mk(buf, matStatic);
          out.anim = mk(abuf, matAnim);
          out.glass = mk(gbuf, matGlass);
          out.deco = mk(dbuf, decoMat);
          scene3.chunks.set(key, out);
        }
        function rebuildChunkAt(x,y,z){
          if(x<0||y<0||z<0||x>=W||y>=H||z>=D) return;
          buildChunkMesh((x/CH)|0,(y/CH)|0,(z/CH)|0);
        }
        function rebuildWorld(){
          for(let cx=0;cx<W/CH;cx++) for(let cy=0;cy<H/CH;cy++) for(let cz=0;cz<D/CH;cz++)
            buildChunkMesh(cx,cy,cz);
          updateHUD();
        }
        // ---------- materials + boot ----------
        let decoMat=null, matGlass=null;
        function rebuildMaterials(){
          matStatic = new THREE.MeshLambertMaterial({map:atlasTex, vertexColors:true});
          matAnim = new THREE.MeshLambertMaterial({map:energyTex, vertexColors:true});
          matGlass = new THREE.MeshLambertMaterial({map:atlasTex, vertexColors:true,
            transparent:true, opacity:.85, side:THREE.DoubleSide, depthWrite:false});
          // decorations sway in the wind: inject a vertex offset weighted by the
          // per-vertex 'sway' attribute (0 = rooted bottom, 1 = free top)
          decoMat = new THREE.MeshLambertMaterial({map:atlasTex, vertexColors:true,
            side:THREE.DoubleSide, alphaTest:.5, transparent:false});
          decoMat.onBeforeCompile = sh=>{
            sh.uniforms.uTime = {value:0};
            sh.vertexShader = 'uniform float uTime;\nattribute float sway;\n' +
              sh.vertexShader.replace('#include <begin_vertex>',
                `#include <begin_vertex>
                 transformed.x += sin(uTime*2.2 + transformed.x*1.3 + transformed.z*1.7) * sway * .12;
                 transformed.z += cos(uTime*1.6 + transformed.x*1.1 + transformed.z*.9) * sway * .08;`);
            decoMat.userData.shader = sh;
          };
        }
        
        
        
        // stub: engine's rebuildWorld() calls this; we update the tri readout
        function updateHUD(){
          let tris=0;
          scene3.chunks.forEach(c=>['static','anim','glass','deco'].forEach(k=>{
            if(c[k]) tris += c[k].geometry.index.count/3; }));
          document.getElementById('voxel-tri-count').textContent = tris|0;
          document.getElementById('voxel-seed-label').textContent = 'seed '+(SEED>>>0).toString(16);
        }
        
        // ---------- compact voxel character (the creator's rig, trimmed) ----------
        function std(color){ return new THREE.MeshStandardMaterial({color, roughness:.8, metalness:.15}); }
        function pbox(w,h,d,mat){ return new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat); }
        const OUTLINE_MAT = new THREE.MeshBasicMaterial({color:0x0a0b14, side:THREE.BackSide});
        function addOutlines(root){
          const t=[];
          root.traverse(o=>{ if(o.isMesh && o.geometry.type==='BoxGeometry' && !o.userData.isOutline
            && !(o.material&&o.material.isMeshBasicMaterial)) t.push(o); });
          t.forEach(m=>{ const o=new THREE.Mesh(m.geometry,OUTLINE_MAT);
            o.scale.setScalar(1.055); o.userData.isOutline=true; m.add(o); });
        }
        function faceTexture(skin,hair){
          const c=document.createElement('canvas'); c.width=c.height=128;
          const x=c.getContext('2d');
          x.fillStyle=hx(skin); x.fillRect(0,0,128,128);
          x.fillStyle='#3a3a40'; x.fillRect(22,38,28,7); x.fillRect(78,38,28,7);
          x.fillStyle='#ffffff'; x.fillRect(24,52,26,22); x.fillRect(78,52,26,22);
          x.fillStyle='#2a2d36'; x.fillRect(32,55,14,18); x.fillRect(86,55,14,18);
          x.fillStyle='#101218'; x.fillRect(35,59,8,10);  x.fillRect(89,59,8,10);
          x.fillStyle='#ffffff'; x.fillRect(33,56,4,4);   x.fillRect(87,56,4,4);
          x.fillStyle='rgba(0,0,0,.35)'; x.fillRect(56,98,16,5);
          x.fillStyle='rgba(220,90,80,.13)'; x.fillRect(16,80,16,9); x.fillRect(96,80,16,9);
          const t=new THREE.CanvasTexture(c); t.magFilter=THREE.NearestFilter; t.minFilter=THREE.NearestFilter;
          return t;
        }
        const CHAR_CLASSES = [
            { accent: 0xe8b33b },
            { accent: 0xd4453a },
            { accent: 0x6fe3ff }
        ];
        const HAIR_COLORS = [0xf2f2f2, 0x1c1c1f, 0x6b4a2f, 0xd9b65c, 0xd42a1e, 0xf06ad8];
        const GEAR_COLORS = [0xf2f4f7, 0x23262e, 0x2c8c94, 0xe05ad2, 0x4f8fe8, 0xe8b33b];
        const SKIN_TONES = [0xe8b08e, 0xd49066, 0xa86b46, 0x6e4630];

        function getVC() {
            return typeof VoxelCharacter !== 'undefined' ? VoxelCharacter : null;
        }

        function normalizeCharCfg(raw) {
            const base = raw || { classIdx: 0, body: 0, deco: 1, hair: 2, gear: 0, skin: 0, weapon: 0 };
            const VC = getVC();
            if (VC) return VC.normalizeParams(base);
            const n = Object.assign({ classIdx: 0, body: 0, deco: 1, hair: 2, gear: 0, skin: 0, weapon: 0 }, base);
            n.weapon = ((n.weapon % 7) + 7) % 7;
            return n;
        }

        function loadCharCfg() {
            try {
                let raw = localStorage.getItem('pjboy.voxelCharacter.v1');
                const VC = getVC();
                if (!raw && VC) raw = localStorage.getItem(VC.SAVE_KEY);
                return raw ? normalizeCharCfg(JSON.parse(raw)) : normalizeCharCfg(null);
            } catch (_) { return normalizeCharCfg(null); }
        }

        function saveCharCfg(patch) {
            const cfg = normalizeCharCfg(Object.assign({}, loadCharCfg(), patch || {}));
            localStorage.setItem('pjboy.voxelCharacter.v1', JSON.stringify(cfg));
            const VC = getVC();
            if (VC) VC.saveParams(cfg);
            return cfg;
        }

        function charAccent(cfg) {
            cfg = cfg || loadCharCfg();
            const VC = getVC();
            const cls = VC ? VC.CLASSES[cfg.classIdx | 0] : CHAR_CLASSES[cfg.classIdx | 0];
            return cls ? cls.accent : 0xe8b33b;
        }

        let weaponIndex = 0;
        let weaponDef = null;
        let tpWeapon = null;
        let fpWeapon = null;
        let tpGrip = null;

        function weaponList() {
            const VC = getVC();
            return VC ? VC.WEAPONS : [{ id: 'pickaxe', name: 'Pickaxe', twoHanded: true, ranged: false }];
        }

        function buildWeaponMesh(accent, idx) {
            const VC = getVC();
            const defs = weaponList();
            const i = ((idx % defs.length) + defs.length) % defs.length;
            const def = defs[i];
            if (VC && VC.buildWeapon) {
                return { mesh: VC.buildWeapon(def, accent), def, index: i };
            }
            const pick = new THREE.Group();
            const handle = pbox(0.06, 0.7, 0.06, std(0x7a5a36));
            handle.position.y = 0.25;
            pick.add(handle);
            pick.rotation.x = 1.45;
            pick.rotation.z = 0.08;
            pick.position.set(0, -0.03, 0.06);
            return { mesh: pick, def, index: i };
        }

        function resolveWeaponGrip(grip) {
            if (grip) return grip;
            if (av && av.weaponGrip) return av.weaponGrip;
            if (av && av.weapon && av.weapon.parent) return av.weapon.parent;
            return tpGrip;
        }

        function attachTpWeapon(grip) {
            const target = resolveWeaponGrip(grip);
            if (!target) return;
            tpGrip = target;
            if (tpWeapon && tpWeapon.parent) tpWeapon.parent.remove(tpWeapon);
            const built = buildWeaponMesh(charAccent(), weaponIndex);
            weaponDef = built.def;
            weaponIndex = built.index;
            tpWeapon = built.mesh;
            const VC = getVC();
            if (VC && VC.mirrorWeaponForTpGrip) VC.mirrorWeaponForTpGrip(tpWeapon, built.def);
            tpWeapon.visible = true;
            target.add(tpWeapon);
            if (av) {
                av.weapon = tpWeapon;
                av.weaponDef = weaponDef;
                av.twoHanded = built.def.twoHanded;
                av.socket = tpWeapon.userData.socket || null;
                av.weaponGrip = target;
                if (!av.primaryHand) av.primaryHand = 'right';
            }
            updateWeaponLabel();
        }

        function rebuildFpWeapon() {
            if (!fpMount) return;
            if (fpWeapon) fpMount.remove(fpWeapon);
            const built = buildWeaponMesh(charAccent(), weaponIndex);
            weaponDef = built.def;
            weaponIndex = built.index;
            fpWeapon = built.mesh;
            fpWeapon.userData.fpBaseRot = {
                x: fpWeapon.rotation.x, y: fpWeapon.rotation.y, z: fpWeapon.rotation.z
            };
            fpMount.add(fpWeapon);
            applyFpWeaponGripRest();
            const VC = getVC();
            if (VC && VC.addOutlines) VC.addOutlines(fpWeapon);
            updateWeaponLabel();
        }

        function setWeaponIndex(idx, quiet) {
            const cfg = saveCharCfg({ weapon: idx });
            weaponIndex = cfg.weapon;
            ownedWeapons.add(weaponIndex);
            attachTpWeapon(av && av.weaponGrip);
            rebuildFpWeapon();
            syncFpTunerInputs();
            if (drawerOpen) renderDrawer();
            if (!quiet && g.showMessage && weaponDef) g.showMessage('Equipped ' + weaponDef.name, 1400);
        }

        function cycleWeapon(dir) {
            setWeaponIndex(weaponIndex + dir);
        }

        function isLaserRifle() {
            return !!(weaponDef && weaponDef.id === 'laser');
        }

        function weaponFireFactor() {
            if (fireHeld && isLaserRifle() && !drawerOpen) {
                return 0.82 + 0.18 * Math.sin(elapsed * 28);
            }
            if (fpSwingTimer > 0) return Math.max(0, 1 - fpSwingTimer / fpSwingDuration);
            if (tpRecoilT >= 0) return Math.max(0, 1 - tpRecoilT / TP_RECOIL_DUR);
            const atkT = (av && av.anim && av.anim.attackT >= 0) ? av.anim.attackT : attackT;
            if (atkT >= 0) {
                const dur = weaponDef && weaponDef.ranged ? 0.6 : 0.42;
                return Math.max(0, 1 - atkT / dur);
            }
            return 0;
        }

        function fpRecoilStrength() {
            return weaponDef && weaponDef.ranged ? FP_RANGED_RECOIL_STRENGTH : 1;
        }

        function updateWeaponFx() {
            const f = weaponFireFactor();
            if (tpWeapon && tpWeapon.userData.animate) tpWeapon.userData.animate(elapsed, f);
            if (fpWeapon && fpWeapon.userData.animate) fpWeapon.userData.animate(elapsed, f);
            const flashOn = f > 0.04 && weaponDef && weaponDef.ranged;
            for (const w of [tpWeapon, fpWeapon]) {
                if (!w || !w.userData) continue;
                if (w.userData.flash) {
                    w.userData.flash.visible = flashOn;
                    w.userData.flash.material.opacity = 0.35 + f * 0.65;
                }
                if (w.userData.beam) {
                    // Weapon mesh beam is FP-only; TP uses short-lived shot VFX traces.
                    w.userData.beam.visible = firstPerson && flashOn && f > 0.06;
                    w.userData.beam.material.opacity = 0.25 + f * 0.75;
                }
            }
        }

        function updateWeaponLabel() {
            const el = document.getElementById('voxel-weapon-label');
            if (el && weaponDef) el.textContent = weaponDef.name;
        }

        function mapVcState(state) {
            if (state === 'fly') return 'fly';
            if (state === 'air') return 'jump';
            if (state === 'run') return 'run';
            if (state === 'walk') return 'walk';
            return 'idle';
        }

        const _aimLocal = new THREE.Vector3();
        function computeAimOffsets() {
            const dir = syncAimRay();
            const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
            _aimLocal.set(
                dir.x * cosY - dir.z * sinY,
                dir.y,
                dir.x * sinY + dir.z * cosY);
            const horiz = Math.max(0.12, Math.hypot(_aimLocal.x, _aimLocal.z));
            const localYaw = Math.atan2(_aimLocal.x, _aimLocal.z);
            const localPitch = Math.atan2(-_aimLocal.y, horiz);
            const maxA = Math.PI * 0.42;
            return {
                aimX: THREE.MathUtils.clamp(localYaw / maxA, -1, 1),
                aimY: THREE.MathUtils.clamp(localPitch / maxA, -1, 1),
                localYaw,
                localPitch
            };
        }

        function updateTpCharacter(dt, sp) {
            if (!av || firstPerson) return;
            av.group.position.copy(player.pos);
            av.group.rotation.y = player.yaw;
            const VC = getVC();
            if (VC && av.anim && av.j) {
                const aimSolve = resolveAim();
                const aim = computeAimOffsets();
                const aimDir = aimSolve.dir;
                const ads = focusAimBlend > 0.04;
                const atk = attackT >= 0 ? attackT : (av.anim.attackT >= 0 ? av.anim.attackT : -1);
                VC.update(av, mapVcState(player.state), dt, {
                    aiming: ads,
                    alwaysAim: true,
                    aimBlend: 1,
                    aimX: aim.aimX,
                    aimY: aim.aimY,
                    localAimYaw: aim.localYaw,
                    localAimPitch: aim.localPitch,
                    aimWorldDir: aimDir,
                    attackT: atk,
                    weaponEquipped: true,
                    showWeaponBeam: false
                });
                av.group.position.copy(player.pos);
                attackT = av.anim.attackT;
                return;
            }
            applyPose(av.j, elapsed, player.state, dt);
        }

        function buildPlayer(){
          const VC = getVC();
          if (VC) {
            const cfg = loadCharCfg();
            weaponIndex = cfg.weapon;
            const ch = VC.build(cfg, { weaponEquipped: true });
            weaponDef = ch.weaponDef;
            tpWeapon = ch.weapon;
            tpGrip = ch.weaponGrip || (ch.weapon && ch.weapon.parent ? ch.weapon.parent : null);
            ch.group.visible = !firstPerson;
            if (!ch.group.parent) scene.add(ch.group);
            return ch;
          }
          const cfg = loadCharCfg();
          const cls = CHAR_CLASSES[cfg.classIdx | 0] || CHAR_CLASSES[0];
          const gear = GEAR_COLORS[cfg.gear | 0] || GEAR_COLORS[0];
          const skin = SKIN_TONES[cfg.skin | 0] || SKIN_TONES[0];
          const hair = HAIR_COLORS[cfg.hair | 0] || HAIR_COLORS[2];
          const accent = cls.accent;
          const gearM=std(gear), gearDark=std(shade(gear,.55)), underM=std(0xc9cfd8);
          const skinM=std(skin), hairM=std(hair), accM=std(accent);
          const darkM=std(0x2c3038), bootM=std(0x4a5058), metalM=std(0x9aa3ad);
          const torsoW=.52, torsoH=.58, hipY=.92;
          const RIG_X = -1;
          const rigX = (side) => side * RIG_X;
        
          const group=new THREE.Group(); const j={};
          j.hips=new THREE.Group(); j.hips.position.y=hipY; group.add(j.hips);
          function leg(side){
            const hipJ=new THREE.Group(); hipJ.position.set(rigX(side)*torsoW*.27,0,0);
            const up=pbox(.19,.36,.21,gearM); up.position.y=-.18; hipJ.add(up);
            const kneeJ=new THREE.Group(); kneeJ.position.y=-.37; hipJ.add(kneeJ);
            const lo=pbox(.17,.33,.19,underM); lo.position.y=-.165; kneeJ.add(lo);
            const pad=pbox(.19,.12,.07,accM); pad.position.set(0,-.04,.08); kneeJ.add(pad);
            const boot=pbox(.2,.12,.28,bootM); boot.position.set(0,-.39,.03); kneeJ.add(boot);
            const sole=pbox(.22,.04,.32,darkM); sole.position.set(0,-.46,.04); kneeJ.add(sole);
            const flame=new THREE.Mesh(new THREE.ConeGeometry(.07,.3,6),
              new THREE.MeshBasicMaterial({color:0x6fe3ff,transparent:true,opacity:.85}));
            flame.rotation.x=Math.PI; flame.position.set(0,-.6,.04); flame.visible=false; kneeJ.add(flame);
            j.hips.add(hipJ); return {hipJ,kneeJ,flame};
          }
          const L=leg(-1),Rg=leg(1);
          j.hipL=L.hipJ; j.kneeL=L.kneeJ; j.hipR=Rg.hipJ; j.kneeR=Rg.kneeJ;
          const flames=[L.flame,Rg.flame];
        
          j.torso=new THREE.Group(); j.hips.add(j.torso);
          const torso=pbox(torsoW,torsoH,.28,gearM); torso.position.y=torsoH/2; j.torso.add(torso);
          const chest=pbox(.3,.3,.04,std(0xc2c8d2)); chest.position.set(0,torsoH*.55,.16); j.torso.add(chest);
          const belt=pbox(torsoW+.04,.07,.32,darkM); belt.position.y=.035; j.torso.add(belt);
          const pack=pbox(torsoW*.7,.36,.13,gearDark); pack.position.set(0,torsoH*.55,-.21); j.torso.add(pack);
          [-1,1].forEach(s=>{ const tank=pbox(.1,.26,.1,metalM);
            tank.position.set(s*torsoW*.2,torsoH*.52,-.31); j.torso.add(tank); });
          const lite=pbox(.07,.07,.03,new THREE.MeshBasicMaterial({color:accent}));
          lite.position.set(0,torsoH*.62,-.29); j.torso.add(lite);
        
          function arm(side){
            const shJ=new THREE.Group(); shJ.position.set(rigX(side)*(torsoW/2+.12),torsoH-.06,0);
            const pad=pbox(.2,.15,.22,gearM); pad.position.y=-.03; shJ.add(pad);
            const stripe=pbox(.21,.04,.23,accM); stripe.position.y=-.1; shJ.add(stripe);
            const up=pbox(.15,.3,.16,gearM); up.position.y=-.2; shJ.add(up);
            const elJ=new THREE.Group(); elJ.position.y=-.36; shJ.add(elJ);
            const lo=pbox(.13,.28,.14,underM); lo.position.y=-.14; elJ.add(lo);
            const hand=pbox(.14,.1,.15,darkM); hand.position.y=-.32; elJ.add(hand);
            const grip=new THREE.Group(); grip.position.set(0,-.32,.02); elJ.add(grip);
            j.torso.add(shJ); return {shJ,elJ,grip};
          }
          const AL=arm(-1),AR=arm(1);
          j.shL=AL.shJ; j.elL=AL.elJ; j.shR=AR.shJ; j.elR=AR.elJ;
        
          j.neck=new THREE.Group(); j.neck.position.y=torsoH+.04; j.torso.add(j.neck);
          const HW=.58,HH=.54;
          const headMats=[skinM,skinM,skinM,skinM,
            new THREE.MeshStandardMaterial({map:faceTexture(skin,hair),roughness:.8}),skinM];
          const head=new THREE.Mesh(new THREE.BoxGeometry(HW,HH,HW*.92),headMats);
          head.position.y=HH/2+.04; j.neck.add(head);
          const cap=pbox(HW+.05,.1,HW*.92+.05,hairM); cap.position.y=HH+.07; j.neck.add(cap);
          const fringe=pbox(HW*.55,.08,.07,hairM); fringe.position.set(-HW*.18,HH+.03,HW*.43); j.neck.add(fringe);
        
          addOutlines(group);
          scene.add(group);
          attachTpWeapon(AR.grip);
          return { group, j, flames, grip: AR.grip, weaponGrip: AR.grip, primaryHand: 'right' };
        }
        
        // ---------- pose system (extracted essentials from the creator) ----------
        const KEYS=['rootY','torsoRX','headRX','headRY','shLx','shLz','elL','shRx','shRz','elR',
          'hipLx','kneeL','hipRx','kneeR'];
        const cur={}; KEYS.forEach(k=>cur[k]=0);
        let attackT=-1;
        let tpRecoilT=-1;
        const TP_RECOIL_DUR=0.16;
        const POSES={
          idle(t,o){ o.rootY=Math.sin(t*2)*.02; o.headRY=Math.sin(t*.6)*.18;
            o.shLz=-.25; o.shRz=.25; o.elL=.08; o.elR=.3; o.shRx=-.25; },
          walk(t,o){ const f=t*7,s=Math.sin(f);
            o.rootY=Math.abs(Math.cos(f))*.035;
            o.hipLx=s*.55; o.hipRx=-s*.55;
            o.kneeL=Math.max(0,-s)*.9; o.kneeR=Math.max(0,s)*.9;
            o.shLx=-s*.45; o.shRx=-.3; o.elL=.25; o.elR=.4; o.torsoRX=.06; },
          run(t,o){ const f=t*11,s=Math.sin(f);
            o.rootY=Math.abs(Math.cos(f))*.07; o.torsoRX=.3;
            o.hipLx=s*.95; o.hipRx=-s*.95;
            o.kneeL=Math.max(0,-s)*1.5+.2; o.kneeR=Math.max(0,s)*1.5+.2;
            o.shLx=-s*.9; o.shRx=-.5; o.elL=1.3; o.elR=.8; o.headRX=-.15; },
          air(t,o){ o.kneeL=o.kneeR=.7; o.hipLx=o.hipRx=-.35;
            o.shLx=-.6; o.shLz=-.4; o.shRx=-.5; o.shRz=.4; o.elL=.5; o.elR=.5; o.torsoRX=.1; },
          fly(t,o){ o.torsoRX=.35; o.headRX=-.4;
            o.hipLx=o.hipRx=.4; o.kneeL=.5+Math.sin(t*2)*.05; o.kneeR=.5-Math.sin(t*2)*.05;
            o.shLx=-.4; o.shLz=-.6; o.elL=.2; o.shRx=-.2; o.shRz=.3; o.elR=.45; },
        };
        function applyPose(j,t,state,dt){
          const tgt={}; KEYS.forEach(k=>tgt[k]=0);
          POSES[state](t,tgt);
          // Third-person melee swing — FP uses the dedicated viewmodel swing.
          if(!firstPerson && attackT>=0){
            attackT+=dt; const d=.42,k=Math.min(attackT/d,1);
            if(k<.35){ const w=k/.35; tgt.shRx=-2.4*w; tgt.elR=.3; tgt.torsoRX=(tgt.torsoRX||0)-.15*w; }
            else { const w=(k-.35)/.65; tgt.shRx=-2.4+3.1*w; tgt.elR=.3+.3*w; tgt.torsoRX=(tgt.torsoRX||0)+.3*w; }
            if(attackT>=d) attackT=-1;
          }
          // Third-person ranged recoil — short shoulder kick, not a melee wind-up.
          if(!firstPerson && tpRecoilT>=0){
            tpRecoilT+=dt;
            const k=Math.min(tpRecoilT/TP_RECOIL_DUR,1);
            const kick=Math.sin(k*Math.PI);
            const r=FP_RANGED_RECOIL_STRENGTH;
            tgt.shRx-=.55*kick*r;
            tgt.elR+=.18*kick*r;
            tgt.torsoRX=(tgt.torsoRX||0)-.12*kick*r;
            if(tpRecoilT>=TP_RECOIL_DUR) tpRecoilT=-1;
          }
          const a=1-Math.exp(-12*dt);
          KEYS.forEach(k=>cur[k]+=(tgt[k]-cur[k])*a);
          j.hips.position.y=.92+cur.rootY;
          j.torso.rotation.x=cur.torsoRX;
          j.neck.rotation.x=cur.headRX; j.neck.rotation.y=cur.headRY;
          j.shL.rotation.x=cur.shLx; j.shL.rotation.z=cur.shLz; j.elL.rotation.x=-Math.abs(cur.elL);
          j.shR.rotation.x=cur.shRx; j.shR.rotation.z=cur.shRz; j.elR.rotation.x=-Math.abs(cur.elR);
          j.hipL.rotation.x=cur.hipLx; j.kneeL.rotation.x=Math.abs(cur.kneeL);
          j.hipR.rotation.x=cur.hipRx; j.kneeR.rotation.x=Math.abs(cur.kneeR);
        }
        
        // ---------- player physics: AABB vs voxel grid ----------
        const player = {
          pos:new THREE.Vector3(), vel:new THREE.Vector3(),
          half:{x:.32,z:.32}, height:1.85,
          grounded:false, yaw:0, state:'idle',
        };
        function solidAt(wx,wy,wz){       // world-space (render) coords -> voxel solid?
          return getBlock(Math.floor(wx-WORLD_OFFSET.x), Math.floor(wy-WORLD_OFFSET.y),
                          Math.floor(wz-WORLD_OFFSET.z)) !== 0;
        }
        function boxCollides(px,py,pz){
          const {x:hx2,z:hz2}=player.half, h=player.height;
          for(let y=Math.floor(py); y<=Math.floor(py+h-.001); y++)
            for(let x=Math.floor(px-hx2); x<=Math.floor(px+hx2-.001); x++)
              for(let z=Math.floor(pz-hz2); z<=Math.floor(pz+hz2-.001); z++)
                if(solidAt(x+.5,y+.5,z+.5)) return true;
          return false;
        }
        function moveAxis(axis, amt){
          if(!amt) return;
          const p=player.pos;
          const next={x:p.x,y:p.y,z:p.z}; next[axis]+=amt;
          if(!boxCollides(next.x,next.y,next.z)){ p[axis]=next[axis]; return; }
          // step in small increments to land flush against the face
          const step=Math.sign(amt)*.02; let moved=0;
          while(Math.abs(moved+step)<=Math.abs(amt)){
            const t={x:p.x,y:p.y,z:p.z}; t[axis]+=moved+step;
            if(boxCollides(t.x,t.y,t.z)) break;
            moved+=step;
          }
          p[axis]+=moved;
          player.vel[axis]=0;
          if(axis==='y' && amt<0) player.grounded=true;
        }
        
        // ---------- input (listeners attached in enter()) ----------
        const keys = {};
        let firstPerson = true;
        const orbit = { theta: 0.6, phi: 0.92, dist: 2.35 };
        const TP_FP_FOV = 55;
        const TP_FP_ADS_FOV = 49;
        const MOVE_RUN_SPEED = 6.4;
        const MOVE_ADS_SPEED = 1.7;
        let focusAimBlend = 0;
        let tpCamPos = null;
        let tpCamReady = false;
        let dragging = false, moved = 0, px = 0, py = 0, downBtn = 0;
        let wasLockedOnDown = false;
        let fireHeld = false;
        let laserCooldown = 0;
        const LASER_FIRE_INTERVAL = 0.065;
        let canvasEl = null;
        const FP_AIM_SENS = 0.0022;
        const FP_PITCH_MIN = 0.12;
        const FP_PITCH_MAX = 2.85;

        function applyFpMouseLook(dx, dy) {
            if (!firstPerson || drawerOpen) return;
            orbit.theta -= dx * FP_AIM_SENS;
            orbit.phi = Math.max(FP_PITCH_MIN, Math.min(FP_PITCH_MAX, orbit.phi - dy * FP_AIM_SENS));
            player.yaw = orbit.theta + Math.PI;
        }

        function applyTpMouseOrbit(dx, dy) {
            if (firstPerson || drawerOpen || (!dx && !dy)) return;
            const tc = getTpCam();
            orbit.theta -= dx * tc.orbitSens;
            orbit.phi = Math.max(tc.pitchMin, Math.min(tc.pitchMax, orbit.phi - dy * tc.orbitSens));
        }

        function isViewPointerLocked() {
            return !!(canvasEl && document.pointerLockElement === canvasEl);
        }

        function requestViewPointerLock() {
            if (drawerOpen || !canvasEl) return;
            if (!isViewPointerLocked()) canvasEl.requestPointerLock();
        }

        function requestFpPointerLock() {
            if (!firstPerson || drawerOpen) return;
            requestViewPointerLock();
        }

        function releasePointerLock() {
            if (document.pointerLockElement) document.exitPointerLock();
        }

        function releaseFpPointerLock() {
            releasePointerLock();
        }

        function syncViewCursor() {
            document.body.style.cursor = isViewPointerLocked() ? 'none' : 'default';
        }
        let texturesReady = false;
        let av = null;
        let fpPivot = null;
        let fpMount = null;
        let fpRest = null;
        let fpTune = null;
        let fpTunerEl = null;
        const FP_TUNE_KEY = 'pjboy.voxelFpTune.v1';

        function defaultWeaponTunes() {
            return {
                pickaxe: { wx: -0.23, wy: -0.19, wz: -0.16, wrx: 1.39, wry: -3.14, wrz: 0.13, meleeRot: true },
                sword:   { wx: -0.11, wy: 0.01,  wz: -0.37, wrx: 1.37, wry: -3.14, wrz: 0.09, meleeRot: true },
                wrench:  { wx: -0.15, wy: -0.11, wz: -0.12, wrx: 1.33, wry: 0,     wrz: 0,    meleeRot: true },
                blaster: { wx: -0.09, wy: -0.05, wz: -0.2,  wrx: 0.22, wry: -0.05, wrz: -0.04, meleeRot: true },
                laser:   { wx: -0.08, wy: -0.12, wz: -0.18, wrx: 0.2,  wry: 0.02,  wrz: 0.03,  meleeRot: true },
                plasma:  { wx: -0.11, wy: 0.01,  wz: -0.21, wrx: 0.16, wry: 0.14,  wrz: -0.02, meleeRot: true },
                railgun: { wx: -0.13, wy: -0.07, wz: -0.18, wrx: 0.3,  wry: -0.03, wrz: -0.03, meleeRot: true }
            };
        }

        function defaultFpTune() {
            return {
                dismissed: true,
                global: {
                    scale: 0.6,
                    px: 0.08, py: -0.22, pz: -0.64,
                    rx: 0.1, ry: 0, rz: 0.01,
                    mountRx: 0.37, mountYaw: 0.08, mountRz: 0.04
                },
                weapons: defaultWeaponTunes()
            };
        }

        function loadFpTune() {
            try {
                const raw = localStorage.getItem(FP_TUNE_KEY);
                if (!raw) return defaultFpTune();
                const saved = JSON.parse(raw);
                const base = defaultFpTune();
                return {
                    dismissed: !!saved.dismissed,
                    global: Object.assign({}, base.global, saved.global || {}),
                    weapons: Object.assign({}, base.weapons, saved.weapons || {})
                };
            } catch (e) {
                return defaultFpTune();
            }
        }

        function saveFpTune(dismiss) {
            if (dismiss) fpTune.dismissed = true;
            try {
                localStorage.setItem(FP_TUNE_KEY, JSON.stringify(fpTune));
            } catch (e) { /* quota */ }
        }

        function weaponTuneFor(id) {
            const defs = defaultWeaponTunes();
            if (!fpTune.weapons[id]) fpTune.weapons[id] = Object.assign({}, defs[id] || defs.blaster);
            return fpTune.weapons[id];
        }

        function syncFpRestFromTune() {
            const t = fpTune.global;
            if (!fpRest) {
                fpRest = {
                    pos: new THREE.Vector3(t.px, t.py, t.pz),
                    rotX: t.rx, rotY: t.ry, rotZ: t.rz
                };
                return;
            }
            fpRest.pos.set(t.px, t.py, t.pz);
            fpRest.rotX = t.rx;
            fpRest.rotY = t.ry;
            fpRest.rotZ = t.rz;
        }

        function applyFpMountPose() {
            if (!fpMount || !fpTune) return;
            const t = fpTune.global;
            fpMount.rotation.set(t.mountRx, Math.PI + t.mountYaw, t.mountRz);
        }

        function applyFpTuneToViewmodel() {
            if (!fpTune) fpTune = loadFpTune();
            syncFpRestFromTune();
            applyFpMountPose();
            if (fpPivot) {
                fpPivot.scale.setScalar(fpTune.global.scale);
                fpPivot.position.copy(fpRest.pos);
                fpPivot.rotation.set(fpRest.rotX, fpRest.rotY, fpRest.rotZ);
            }
        }

        function fpWeaponOffset(def) {
            const w = weaponTuneFor(def.id);
            const pos = [w.wx, w.wy, w.wz];
            const ranged = !!def.ranged;
            const useRot = ranged || w.meleeRot;
            if (!useRot) return { pos };
            return { pos, rot: [w.wrx, w.wry, w.wrz] };
        }

        function applyFpWeaponGripRest() {
            if (!fpWeapon || !weaponDef) return;
            const off = fpWeaponOffset(weaponDef);
            fpWeapon.position.set(off.pos[0], off.pos[1], off.pos[2]);
            const r = off.rot || fpWeapon.userData.fpBaseRot;
            if (r) fpWeapon.rotation.set(r[0] || r.x, r[1] || r.y, r[2] || r.z);
            fpWeapon.scale.set(1, 1, 1);
        }
        let fpSwingTimer = 0;
        const fpSwingDuration = 0.32;
        const FP_RANGED_RECOIL_STRENGTH = 0.05;
        let fpSwingDir = 1;
        let elapsed = 0;
        
        // ---------- mining / placing ----------
        const ray=new THREE.Raycaster();
        const AIM_REACH = 6.5;

        function collectAimMeshes() {
          const meshes=[];
          scene3.chunks.forEach(c=>['static','anim','glass'].forEach(k=>{ if(c[k]) meshes.push(c[k]); }));
          return meshes;
        }

        const _shotDir = new THREE.Vector3();
        const _shotScratch = new THREE.Vector3();

        function syncAimRay() {
            ray.setFromCamera({ x: 0, y: 0 }, camera);
            _shotDir.copy(ray.ray.direction).normalize();
            return _shotDir;
        }

        const _aimState = {
            dir: new THREE.Vector3(),
            origin: new THREE.Vector3(),
            end: new THREE.Vector3(),
            hit: new THREE.Vector3(),
            normal: new THREE.Vector3(),
            len: 0,
            hasSurfaceHit: false
        };

        // Single aim solve: screen-center ray, muzzle origin, end on the same line as shots.
        function resolveAim() {
            syncAimRay();
            _aimState.dir.copy(_shotDir);
            if (av && av.group && !firstPerson) av.group.updateMatrixWorld(true);
            if (!firstPerson && tpWeapon) tpWeapon.updateMatrixWorld(true);
            if (fpPivot && firstPerson) fpPivot.updateMatrixWorld(true);
            _aimState.origin.copy(getMuzzleWorldPos());

            ray.setFromCamera({ x: 0, y: 0 }, camera);
            const hit = ray.intersectObjects(collectAimMeshes(), true)[0];
            const inRange = hit && hit.point.distanceTo(player.pos) <= AIM_REACH;
            if (inRange) {
                _aimState.hasSurfaceHit = true;
                _aimState.normal.copy(hit.face.normal);
                const along = _shotScratch.copy(hit.point).sub(_aimState.origin).dot(_aimState.dir);
                _aimState.len = Math.max(0.2, along);
            } else {
                _aimState.hasSurfaceHit = false;
                _aimState.normal.set(0, 1, 0);
                _aimState.len = AIM_REACH;
            }
            _aimState.end.copy(_aimState.origin).addScaledVector(_aimState.dir, _aimState.len);
            _aimState.hit.copy(_aimState.end);
            return _aimState;
        }

        function getAimWorldHit() {
            return resolveAim().end.clone();
        }

        function computeAimShot(origin, hit) {
            const dir = syncAimRay();
            const along = _shotScratch.copy(hit).sub(origin).dot(dir);
            const len = Math.max(0.2, along);
            return { dir, len, end: origin.clone().addScaledVector(dir, len) };
        }

        function pickTarget(){
          ray.setFromCamera({x:0,y:0}, camera);
          const hit=ray.intersectObjects(collectAimMeshes())[0];
          if(!hit) return null;
          if(hit.point.distanceTo(player.pos)>AIM_REACH) return null;
          const p=hit.point.clone().sub(WORLD_OFFSET), n=hit.face.normal;
          const vox=p.clone().addScaledVector(n,-.5).floor();
          const place=p.clone().addScaledVector(n,.5).floor();
          return {x:vox.x,y:vox.y,z:vox.z,place};
        }

        const AIM_EDGE_EPS = 0.012;
        const AIM_EDGE_THICK = 0.038;
        const AIM_EDGE_GLOW_THICK = 0.095;
        const AIM_CORNER_R = 0.09;
        const AIM_ARC_SEGS = 6;
        const AIM_FACE_LOOP = [0, 1, 3, 2];
        let aimEdgeMesh = null;
        let aimEdgeGlow = null;
        let aimEdgeKey = '';
        let aimEdgeMat = null;
        let aimEdgeGlowMat = null;
        const _edgeDir = new THREE.Vector3();
        const _edgeUp = new THREE.Vector3();
        const _edgeSide = new THREE.Vector3();
        const _arcA = new THREE.Vector3();
        const _arcB = new THREE.Vector3();
        const _arcP = new THREE.Vector3();

        function ensureAimEdgeMats() {
            if (aimEdgeMat) return;
            aimEdgeGlowMat = new THREE.MeshBasicMaterial({
                color: 0x5ce8ff,
                transparent: true,
                opacity: 0.34,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });
            aimEdgeMat = new THREE.MeshBasicMaterial({
                color: 0x46d0ff,
                transparent: true,
                opacity: 1,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });
        }

        function pushThickEdge(pos, idx, ca, cb, halfThick) {
            const ax = ca[0], ay = ca[1], az = ca[2];
            const bx = cb[0], by = cb[1], bz = cb[2];
            _edgeDir.set(bx - ax, by - ay, bz - az);
            if (_edgeDir.lengthSq() < 1e-8) return;
            _edgeDir.normalize();
            _edgeUp.set(0, 1, 0);
            if (Math.abs(_edgeDir.y) > 0.92) _edgeUp.set(1, 0, 0);
            _edgeSide.crossVectors(_edgeDir, _edgeUp).normalize().multiplyScalar(halfThick);
            const a1x = ax + _edgeSide.x, a1y = ay + _edgeSide.y, a1z = az + _edgeSide.z;
            const a2x = ax - _edgeSide.x, a2y = ay - _edgeSide.y, a2z = az - _edgeSide.z;
            const b1x = bx + _edgeSide.x, b1y = by + _edgeSide.y, b1z = bz + _edgeSide.z;
            const b2x = bx - _edgeSide.x, b2y = by - _edgeSide.y, b2z = bz - _edgeSide.z;
            const base = pos.length / 3;
            pos.push(
                a1x, a1y, a1z, b1x, b1y, b1z, a2x, a2y, a2z,
                b1x, b1y, b1z, b2x, b2y, b2z, a2x, a2y, a2z
            );
            idx.push(base, base + 1, base + 2, base + 3, base + 4, base + 5);
        }

        function norm3(ax, ay, az, out) {
            const len = Math.hypot(ax, ay, az) || 1;
            out[0] = ax / len;
            out[1] = ay / len;
            out[2] = az / len;
            return len;
        }

        function pushPathPoint(path, x, y, z) {
            const n = path.length;
            if (n >= 3) {
                const lx = path[n - 3], ly = path[n - 2], lz = path[n - 1];
                if (Math.abs(lx - x) < 1e-5 && Math.abs(ly - y) < 1e-5 && Math.abs(lz - z) < 1e-5) return;
            }
            path.push(x, y, z);
        }

        function pushCornerArc(path, cx, cy, cz, inX, inY, inZ, outX, outY, outZ, radius) {
            _arcA.set(-inX, -inY, -inZ);
            _arcB.set(outX, outY, outZ);
            for (let s = 0; s <= AIM_ARC_SEGS; s++) {
                const t = s / AIM_ARC_SEGS;
                const s1 = Math.sin((1 - t) * Math.PI * 0.5);
                const s2 = Math.sin(t * Math.PI * 0.5);
                _arcP.set(
                    cx + radius * (_arcA.x * s1 + _arcB.x * s2),
                    cy + radius * (_arcA.y * s1 + _arcB.y * s2),
                    cz + radius * (_arcA.z * s1 + _arcB.z * s2)
                );
                pushPathPoint(path, _arcP.x, _arcP.y, _arcP.z);
            }
        }

        function buildRoundedFacePath(corners) {
            const path = [];
            const n = AIM_FACE_LOOP.length;
            const dirs = [];
            for (let i = 0; i < n; i++) {
                const prev = corners[AIM_FACE_LOOP[(i + n - 1) % n]];
                const curr = corners[AIM_FACE_LOOP[i]];
                const next = corners[AIM_FACE_LOOP[(i + 1) % n]];
                const inD = [curr[0] - prev[0], curr[1] - prev[1], curr[2] - prev[2]];
                const outD = [next[0] - curr[0], next[1] - curr[1], next[2] - curr[2]];
                norm3(inD[0], inD[1], inD[2], inD);
                norm3(outD[0], outD[1], outD[2], outD);
                dirs.push({ curr, inD, outD });
            }
            for (let i = 0; i < n; i++) {
                const prev = dirs[(i + n - 1) % n];
                const cur = dirs[i];
                const edgeLen = Math.hypot(
                    cur.curr[0] - prev.curr[0],
                    cur.curr[1] - prev.curr[1],
                    cur.curr[2] - prev.curr[2]
                );
                const r = Math.min(AIM_CORNER_R, edgeLen * 0.46);
                const sx = prev.curr[0] + prev.outD[0] * r;
                const sy = prev.curr[1] + prev.outD[1] * r;
                const sz = prev.curr[2] + prev.outD[2] * r;
                const ex = cur.curr[0] - cur.inD[0] * r;
                const ey = cur.curr[1] - cur.inD[1] * r;
                const ez = cur.curr[2] - cur.inD[2] * r;
                pushPathPoint(path, sx, sy, sz);
                pushPathPoint(path, ex, ey, ez);
                pushCornerArc(path, cur.curr[0], cur.curr[1], cur.curr[2],
                    cur.inD[0], cur.inD[1], cur.inD[2],
                    cur.outD[0], cur.outD[1], cur.outD[2], r);
            }
            return path;
        }

        function pushRibbonPath(pos, idx, path, halfThick) {
            for (let i = 0; i < path.length - 3; i += 3) {
                const ca = [path[i], path[i + 1], path[i + 2]];
                const cb = [path[i + 3], path[i + 4], path[i + 5]];
                pushThickEdge(pos, idx, ca, cb, halfThick);
            }
            if (path.length >= 6) {
                const last = [path[path.length - 3], path[path.length - 2], path[path.length - 1]];
                const first = [path[0], path[1], path[2]];
                pushThickEdge(pos, idx, last, first, halfThick);
            }
        }

        function buildAimEdgeMeshData(x, y, z, halfThick) {
            const id = getBlock(x, y, z);
            if (!id) return null;
            const pos = [];
            const idx = [];
            for (const face of FACES) {
                const [dx, dy, dz] = face.dir;
                const nid = getBlock(x + dx, y + dy, z + dz);
                if (nid) {
                    const nb = blockById(nid);
                    if (!nb.transparent) continue;
                    if (nid === id) continue;
                }
                const corners = face.corners.map(c => [
                    c.pos[0] + dx * AIM_EDGE_EPS,
                    c.pos[1] + dy * AIM_EDGE_EPS,
                    c.pos[2] + dz * AIM_EDGE_EPS
                ]);
                const path = buildRoundedFacePath(corners);
                pushRibbonPath(pos, idx, path, halfThick);
            }
            return pos.length ? { pos, idx } : null;
        }

        function makeAimEdgeMesh(data, mat, order) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
            geo.setIndex(data.idx);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.frustumCulled = false;
            mesh.renderOrder = order;
            scene.add(mesh);
            return mesh;
        }

        function disposeAimEdgeHighlight() {
            for (const mesh of [aimEdgeMesh, aimEdgeGlow]) {
                if (!mesh) continue;
                scene.remove(mesh);
                mesh.geometry.dispose();
            }
            aimEdgeMesh = aimEdgeGlow = null;
            aimEdgeKey = '';
        }

        function setAimEdgePosition(t) {
            const px = WORLD_OFFSET.x + t.x;
            const py = WORLD_OFFSET.y + t.y;
            const pz = WORLD_OFFSET.z + t.z;
            for (const mesh of [aimEdgeMesh, aimEdgeGlow]) {
                if (mesh) mesh.position.set(px, py, pz);
            }
        }

        function rebuildAimEdgeHighlight(x, y, z) {
            const core = buildAimEdgeMeshData(x, y, z, AIM_EDGE_THICK * 0.5);
            const glow = buildAimEdgeMeshData(x, y, z, AIM_EDGE_GLOW_THICK * 0.5);
            disposeAimEdgeHighlight();
            if (!core) return;
            ensureAimEdgeMats();
            aimEdgeGlow = glow ? makeAimEdgeMesh(glow, aimEdgeGlowMat, 59) : null;
            aimEdgeMesh = makeAimEdgeMesh(core, aimEdgeMat, 60);
            aimEdgeKey = `${x},${y},${z}`;
        }

        function updateAimEdgeHighlight(t) {
            if (!t || drawerOpen || !getBlock(t.x, t.y, t.z)) {
                if (aimEdgeMesh) aimEdgeMesh.visible = false;
                if (aimEdgeGlow) aimEdgeGlow.visible = false;
                return;
            }
            const key = `${t.x},${t.y},${t.z}`;
            if (key !== aimEdgeKey) rebuildAimEdgeHighlight(t.x, t.y, t.z);
            setAimEdgePosition(t);
            const pulse = 0.82 + 0.18 * Math.sin(elapsed * 8);
            if (aimEdgeGlowMat) aimEdgeGlowMat.opacity = 0.26 + pulse * 0.14;
            if (aimEdgeMesh) aimEdgeMesh.visible = true;
            if (aimEdgeGlow) aimEdgeGlow.visible = true;
        }

        function updateTpAimVisuals() {
            // Iso aim = screen crosshair only; traces spawn on fire via shotVfx.
        }
        // break particles colored from the block's own texture
        const blockColorCache={};
        function blockColor(id){
          if(blockColorCache[id]!==undefined) return blockColorCache[id];
          const b=blockById(id);
          const c=paintTile(b.tiles.all||b.tiles.top, b.animated?0:undefined);
          const d=c.getContext('2d').getImageData(12,12,8,8).data;
          let r=0,g=0,bl=0; for(let i=0;i<d.length;i+=4){ r+=d[i];g+=d[i+1];bl+=d[i+2]; }
          const n=d.length/4;
          return blockColorCache[id]=(Math.round(r/n)<<16)|(Math.round(g/n)<<8)|Math.round(bl/n);
        }
        const parts=[];
        const shotVfx = [];
        const SHOT_PROFILES = {
            blaster: { kind: 'beam', color: 0xffa04a, core: 0xfff2d0, width: 0.075, life: 0.11 },
            laser:   { kind: 'beam', color: 0xff4a62, core: 0xffffff, width: 0.05,  life: 0.16, jagged: true },
            plasma:  { kind: 'bolt',  color: 0x62ff6a, core: 0xe8ffe8, width: 0.13, life: 0.32 },
            railgun: { kind: 'beam', color: 0x7ec8ff, core: 0xffffff, width: 0.095, life: 0.24 }
        };

        function getMuzzleWorldPos() {
            const w = firstPerson ? fpWeapon : tpWeapon;
            if (w && w.userData.muzzle) {
                if (av && av.group && !firstPerson) av.group.updateMatrixWorld(true);
                else if (fpPivot && firstPerson) fpPivot.updateMatrixWorld(true);
                w.updateMatrixWorld(true);
                const pos = new THREE.Vector3();
                w.userData.muzzle.getWorldPosition(pos);
                return pos;
            }
            const eye = player.pos.clone().add(new THREE.Vector3(0, 1.62, 0));
            return eye.clone().add(syncAimRay().clone().multiplyScalar(0.55));
        }

        function addBeamSegment(parent, len, width, color, opacity, zOfs) {
            const seg = new THREE.Mesh(
                new THREE.BoxGeometry(width, width, len),
                new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
            );
            seg.position.z = zOfs;
            seg.userData.baseOp = opacity;
            parent.add(seg);
            return seg;
        }

        function spawnImpactVfx(pos, profile) {
            const n = profile.kind === 'bolt' ? 12 : 7;
            for (let i = 0; i < n; i++) {
                const m = new THREE.Mesh(
                    new THREE.BoxGeometry(0.07, 0.07, 0.07),
                    new THREE.MeshBasicMaterial({
                        color: i % 2 ? profile.core : profile.color,
                        transparent: true,
                        opacity: 1
                    })
                );
                m.position.copy(pos);
                scene.add(m);
                shotVfx.push({
                    kind: 'spark',
                    m,
                    vel: new THREE.Vector3(
                        (Math.random() - 0.5) * 6,
                        1.5 + Math.random() * 4,
                        (Math.random() - 0.5) * 6
                    ),
                    life: 0.18 + Math.random() * 0.14,
                    maxLife: 0.32,
                    grav: 16
                });
            }
            const flash = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 0.22, 0.22),
                new THREE.MeshBasicMaterial({ color: profile.core, transparent: true, opacity: 0.95 })
            );
            flash.position.copy(pos);
            scene.add(flash);
            shotVfx.push({ kind: 'flash', m: flash, life: 0.09, maxLife: 0.09 });
        }

        function spawnRangedShotVfxAt(airShot) {
            if (!weaponDef || !weaponDef.ranged) return;
            const profile = SHOT_PROFILES[weaponDef.id] || SHOT_PROFILES.blaster;
            const a = resolveAim();
            if (a.len < 0.05) return;
            const origin = a.origin;
            const dir = a.dir;
            const aimEnd = a.end;

            if (profile.kind === 'bolt') {
                const orb = new THREE.Mesh(
                    new THREE.BoxGeometry(profile.width, profile.width, profile.width),
                    new THREE.MeshBasicMaterial({ color: profile.core, transparent: true, opacity: 0.95 })
                );
                const halo = new THREE.Mesh(
                    new THREE.BoxGeometry(profile.width * 1.35, profile.width * 1.35, profile.width * 1.35),
                    new THREE.MeshBasicMaterial({ color: profile.color, transparent: true, opacity: 0.45 })
                );
                const grp = new THREE.Group();
                grp.add(halo, orb);
                orb.position.z = 0;
                grp.position.copy(origin);
                scene.add(grp);
                shotVfx.push({
                    kind: 'bolt',
                    grp, orb, halo,
                    origin: origin.clone(),
                    hit: aimEnd.clone(),
                    progress: 0,
                    profile,
                    airShot: !!airShot,
                    impacted: false,
                    life: profile.life,
                    maxLife: profile.life
                });
                return;
            }

            const mid = origin.clone().addScaledVector(dir, a.len * 0.5);
            const grp = new THREE.Group();
            grp.position.copy(mid);
            const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
            grp.quaternion.copy(quat);

            const outer = addBeamSegment(grp, a.len, profile.width, profile.color, 0.82, 0);
            const inner = addBeamSegment(grp, a.len * 1.02, profile.width * 0.32, profile.core, 0.98, 0);
            const segs = [outer, inner];

            if (profile.jagged) {
                for (let i = 0; i < 4; i++) {
                    const jag = addBeamSegment(
                        grp, a.len * (0.18 + Math.random() * 0.12), profile.width * 0.18,
                        0xffffff, 0.55, (i - 1.5) * a.len * 0.22
                    );
                    jag.position.x = (Math.random() - 0.5) * profile.width * 2.2;
                    jag.position.y = (Math.random() - 0.5) * profile.width * 2.2;
                    segs.push(jag);
                }
            }

            scene.add(grp);
            shotVfx.push({
                kind: 'beam',
                grp,
                segs,
                profile,
                hit: aimEnd.clone(),
                life: profile.life,
                maxLife: profile.life
            });
            if (!airShot) spawnImpactVfx(aimEnd, profile);
        }

        function stepShotVfx(dt) {
            for (let i = shotVfx.length - 1; i >= 0; i--) {
                const s = shotVfx[i];
                s.life -= dt;
                if (s.kind === 'bolt') {
                    s.progress = Math.min(1, s.progress + dt / (s.maxLife * 0.72));
                    s.grp.position.lerpVectors(s.origin, s.hit, s.progress);
                    const pulse = 1 + Math.sin(elapsed * 42) * 0.12;
                    s.orb.scale.setScalar(pulse);
                    s.halo.scale.setScalar(pulse * 1.15);
                    if (s.progress >= 1 && !s.impacted) {
                        s.impacted = true;
                        if (!s.airShot) spawnImpactVfx(s.hit, s.profile);
                    }
                } else if (s.kind === 'beam') {
                    const k = Math.max(0, s.life / s.maxLife);
                    s.segs.forEach((seg) => {
                        seg.material.opacity = (seg.userData.baseOp || 0.8) * k;
                    });
                } else if (s.kind === 'spark') {
                    s.vel.y -= s.grav * dt;
                    s.m.position.addScaledVector(s.vel, dt);
                    s.m.material.opacity = Math.max(0, s.life / s.maxLife);
                    s.m.scale.setScalar(0.4 + (s.life / s.maxLife) * 0.8);
                } else if (s.kind === 'flash') {
                    const k = Math.max(0, s.life / s.maxLife);
                    s.m.material.opacity = k;
                    s.m.scale.setScalar(1.2 + (1 - k) * 1.6);
                }
                if (s.life <= 0) {
                    if (s.grp) scene.remove(s.grp);
                    if (s.m) scene.remove(s.m);
                    shotVfx.splice(i, 1);
                }
            }
        }

        function burst(wx,wy,wz,color){
          for(let i=0;i<8;i++){
            const m=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,.12),
              new THREE.MeshBasicMaterial({color}));
            m.position.set(wx+Math.random()-.5, wy+Math.random()-.5, wz+Math.random()-.5);
            scene.add(m);
            parts.push({m, v:new THREE.Vector3((Math.random()-.5)*4, 2+Math.random()*3, (Math.random()-.5)*4), t:0});
          }
        }
        function stepParts(dt){
          for(let i=parts.length-1;i>=0;i--){
            const p=parts[i]; p.t+=dt;
            if(p.t>.7){ scene.remove(p.m); parts.splice(i,1); continue; }
            p.v.y-=12*dt; p.m.position.addScaledVector(p.v,dt);
            const s=1-p.t/.7; p.m.scale.setScalar(s);
          }
        }
        function triggerFpSwing() {
            fpSwingTimer = fpSwingDuration;
            fpSwingDir = -(fpSwingDir || 1);
        }

        function triggerLaserPulse() {
            fpSwingTimer = Math.max(fpSwingTimer, 0.06);
        }

        function fireWeapon(opts) {
            opts = opts || {};
            const t = pickTarget();
            const aim = resolveAim();
            const hasBlock = !!(t && getBlock(t.x, t.y, t.z));

            if (opts.laserPulse) {
                if (firstPerson) triggerLaserPulse();
            } else if (firstPerson) {
                triggerFpSwing();
            }
            if (!firstPerson) {
                if (av && av.anim) {
                    if (weaponDef && weaponDef.ranged) av.anim.attackT = 0;
                    else if (!opts.laserPulse) { attackT = 0; av.anim.attackT = 0; }
                } else if (weaponDef && weaponDef.ranged) {
                    tpRecoilT = 0;
                } else if (!opts.laserPulse) {
                    attackT = 0;
                }
            }

            if (weaponDef && weaponDef.ranged) {
                spawnRangedShotVfxAt(!hasBlock);
            }

            if (!hasBlock) return false;
            const id = getBlock(t.x, t.y, t.z);
            burst(t.x + 0.5 + WORLD_OFFSET.x, t.y + 0.5 + WORLD_OFFSET.y, t.z + 0.5 + WORLD_OFFSET.z, blockColor(id));
            setBlockEvent(t.x, t.y, t.z, 0);
            addToInventory(id);
            updateHUD();
            return true;
        }

        function tryLaserMine() {
            return fireWeapon({ laserPulse: true });
        }

        function updateLaserHoldFire(dt) {
            if (!fireHeld || !isLaserRifle() || drawerOpen) return;
            laserCooldown -= dt;
            if (laserCooldown <= 0) {
                tryLaserMine();
                laserCooldown = LASER_FIRE_INTERVAL;
            }
        }

        function buildFpViewmodel() {
            if (!fpTune) fpTune = loadFpTune();
            fpPivot = new THREE.Group();
            fpMount = new THREE.Group();
            fpPivot.add(fpMount);
            syncFpRestFromTune();
            applyFpMountPose();
            applyFpTuneToViewmodel();
            rebuildFpWeapon();
            fpPivot.visible = false;
            fpPivot.frustumCulled = false;
            if (camera) camera.add(fpPivot);
        }

        function ensureFpViewmodel() {
            if (!fpTune) fpTune = loadFpTune();
            if (!fpPivot) buildFpViewmodel();
            else {
                if (camera && fpPivot.parent !== camera) camera.add(fpPivot);
                if (!fpMount) {
                    fpMount = new THREE.Group();
                    fpPivot.add(fpMount);
                }
                applyFpMountPose();
                applyFpTuneToViewmodel();
                rebuildFpWeapon();
            }
        }

        const FP_TUNER_GLOBAL = [
            ['scale', 'Scale', 0.3, 1.5, 0.01],
            ['px', 'Pivot X', -0.8, 0.8, 0.01],
            ['py', 'Pivot Y', -0.8, 0.4, 0.01],
            ['pz', 'Pivot Z', -1.2, -0.2, 0.01],
            ['rx', 'Pivot pitch', -1.2, 1.2, 0.01],
            ['ry', 'Pivot yaw', -1.2, 1.2, 0.01],
            ['rz', 'Pivot roll', -1.2, 1.2, 0.01],
            ['mountRx', 'Mount pitch', -1.2, 1.2, 0.01],
            ['mountYaw', 'Mount side°', -0.8, 0.8, 0.01],
            ['mountRz', 'Mount roll', -1.2, 1.2, 0.01]
        ];
        const FP_TUNER_WEAPON = [
            ['wx', 'Weapon X', -0.5, 0.5, 0.01],
            ['wy', 'Weapon Y', -0.5, 0.5, 0.01],
            ['wz', 'Weapon Z', -0.5, 0.5, 0.01],
            ['wrx', 'Wpn pitch', -3.14, 3.14, 0.01],
            ['wry', 'Wpn yaw', -3.14, 3.14, 0.01],
            ['wrz', 'Wpn roll', -3.14, 3.14, 0.01]
        ];

        function syncFpTunerInputs() {
            if (!fpTunerEl || !fpTune) return;
            const wid = weaponDef ? weaponDef.id : 'blaster';
            const w = weaponTuneFor(wid);
            const title = fpTunerEl.querySelector('[data-fp-tune-weapon]');
            if (title) title.textContent = weaponDef ? weaponDef.name : wid;
            FP_TUNER_GLOBAL.forEach(([key]) => {
                const input = fpTunerEl.querySelector(`[data-fp-g="${key}"]`);
                if (input) input.value = fpTune.global[key];
            });
            FP_TUNER_WEAPON.forEach(([key]) => {
                const input = fpTunerEl.querySelector(`[data-fp-w="${key}"]`);
                if (input) input.value = w[key];
            });
            const meleeRot = fpTunerEl.querySelector('[data-fp-melee-rot]');
            if (meleeRot) {
                meleeRot.checked = !!w.meleeRot;
                meleeRot.disabled = !!(weaponDef && weaponDef.ranged);
            }
        }

        function onFpTunerInput(e) {
            const gKey = e.target.dataset.fpG;
            const wKey = e.target.dataset.fpW;
            if (gKey) {
                fpTune.global[gKey] = parseFloat(e.target.value);
                applyFpTuneToViewmodel();
                return;
            }
            if (wKey) {
                const w = weaponTuneFor(weaponDef ? weaponDef.id : 'blaster');
                w[wKey] = parseFloat(e.target.value);
                rebuildFpWeapon();
            }
            if (e.target.dataset.fpMeleeRot !== undefined) {
                const w = weaponTuneFor(weaponDef ? weaponDef.id : 'blaster');
                w.meleeRot = e.target.checked;
                rebuildFpWeapon();
            }
        }

        function buildFpTunerUI() {
            if (fpTunerEl) return fpTunerEl;
            const overlay = document.getElementById('voxel-overlay');
            if (!overlay) return null;
            const el = document.createElement('div');
            el.id = 'voxel-fp-tuner';
            el.className = 'vx-fp-tuner';
            el.hidden = true;

            function sliderRow(scope, key, label, min, max, step) {
                const id = `fp-tune-${scope}-${key}`;
                return `<label class="vx-fp-row" for="${id}">
                    <span class="vx-fp-lbl">${label}</span>
                    <input type="range" id="${id}" data-fp-${scope === 'g' ? 'g' : 'w'}="${key}"
                        min="${min}" max="${max}" step="${step}">
                </label>`;
            }

            let html = `<div class="vx-fp-head">
                <h4>FP weapon tuner</h4>
                <span class="vx-fp-weapon" data-fp-tune-weapon>—</span>
            </div>
            <p class="vx-fp-hint">Global + per-weapon (Q/E). <b>F8</b> reopens after save.</p>
            <div class="vx-fp-section"><b>Pivot &amp; mount</b>`;
            FP_TUNER_GLOBAL.forEach(([key, label, min, max, step]) => {
                html += sliderRow('g', key, label, min, max, step);
            });
            html += `</div><div class="vx-fp-section"><b>Current weapon</b>`;
            FP_TUNER_WEAPON.forEach(([key, label, min, max, step]) => {
                html += sliderRow('w', key, label, min, max, step);
            });
            html += `</div>
            <label class="vx-fp-check"><input type="checkbox" data-fp-melee-rot> Override melee grip rotation</label>
            <div class="vx-fp-actions">
                <button type="button" class="vx-btn" data-fp-save>Save &amp; close</button>
                <button type="button" class="vx-btn" data-fp-reset-wpn>Reset weapon</button>
                <button type="button" class="vx-btn" data-fp-reset-all>Reset all</button>
            </div>`;
            el.innerHTML = html;
            overlay.appendChild(el);

            el.addEventListener('input', onFpTunerInput);
            el.addEventListener('change', onFpTunerInput);
            el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
            el.querySelector('[data-fp-save]').addEventListener('click', () => {
                saveFpTune(true);
                el.hidden = true;
                if (g.showMessage) g.showMessage('FP weapon pose saved (F8 to tweak again)', 2800);
            });
            el.querySelector('[data-fp-reset-wpn]').addEventListener('click', () => {
                const id = weaponDef ? weaponDef.id : 'blaster';
                const defs = defaultWeaponTunes();
                fpTune.weapons[id] = Object.assign({}, defs[id] || defs.blaster);
                syncFpTunerInputs();
                rebuildFpWeapon();
            });
            el.querySelector('[data-fp-reset-all]').addEventListener('click', () => {
                fpTune = defaultFpTune();
                fpTune.dismissed = false;
                syncFpTunerInputs();
                applyFpTuneToViewmodel();
                rebuildFpWeapon();
            });

            fpTunerEl = el;
            return el;
        }

        function showFpTuner() {
            if (!firstPerson) return;
            hideTpTuner();
            const el = buildFpTunerUI();
            if (!el) return;
            el.hidden = false;
            syncFpTunerInputs();
        }

        function hideFpTuner() {
            if (fpTunerEl) fpTunerEl.hidden = true;
        }

        let tpTune = null;
        let tpTunerEl = null;
        const TP_TUNE_KEY = 'pjboy.voxelTpTune.v1';

        function defaultTpTune() {
            return {
                dismissed: true,
                cam: {
                    theta: 0.6,
                    phi: 0.92,
                    dist: 2.35,
                    shoulder: 0.95,
                    focusH: 1.52,
                    camLift: 0.1,
                    fov: 58,
                    pitchMin: 0.22,
                    pitchMax: 2.42,
                    distMin: 1.75,
                    distMax: 5.2,
                    orbitSens: 0.0024,
                    adsDist: 1.42,
                    adsShoulder: 0.38,
                    adsFov: 49,
                    adsYaw: 0
                }
            };
        }

        function loadTpTune() {
            try {
                const raw = localStorage.getItem(TP_TUNE_KEY);
                if (!raw) return defaultTpTune();
                const saved = JSON.parse(raw);
                const base = defaultTpTune();
                const cam = Object.assign({}, base.cam, saved.cam || {});
                if (typeof cam.theta === 'number') cam.theta = wrapAngleRad(cam.theta);
                if (typeof cam.pitchMax === 'number' && cam.pitchMax < 2.0) cam.pitchMax = 2.42;
                if (typeof cam.pitchMin === 'number' && cam.pitchMin > 0.45) cam.pitchMin = 0.22;
                return {
                    dismissed: !!saved.dismissed,
                    cam
                };
            } catch (e) {
                return defaultTpTune();
            }
        }

        function wrapAngleRad(a) {
            while (a > Math.PI) a -= Math.PI * 2;
            while (a < -Math.PI) a += Math.PI * 2;
            return a;
        }

        function getTpCam() {
            if (!tpTune) tpTune = loadTpTune();
            return tpTune.cam;
        }

        function applyTpTuneToOrbit() {
            const c = getTpCam();
            orbit.theta = wrapAngleRad(c.theta);
            orbit.phi = c.phi;
            orbit.dist = c.dist;
            c.theta = orbit.theta;
        }

        function saveTpTune(dismiss) {
            const c = getTpCam();
            c.theta = wrapAngleRad(orbit.theta);
            c.phi = orbit.phi;
            c.dist = orbit.dist;
            orbit.theta = c.theta;
            if (dismiss) tpTune.dismissed = true;
            try {
                localStorage.setItem(TP_TUNE_KEY, JSON.stringify(tpTune));
            } catch (e) { /* quota */ }
        }

        const TP_TUNER_ORBIT = [
            ['theta', 'Yaw', -3.14159, 3.14159, 0.01],
            ['phi', 'Pitch', 0.15, 2.75, 0.01],
            ['dist', 'Distance', 1.2, 6, 0.05]
        ];
        const TP_TUNER_CAM = [
            ['shoulder', 'Shoulder X', -1.2, 1.2, 0.02],
            ['focusH', 'Focus height', 1.0, 2.1, 0.02],
            ['camLift', 'Cam lift', -0.35, 0.55, 0.01],
            ['fov', 'FOV', 40, 85, 1],
            ['orbitSens', 'Look sens.', 0.0008, 0.006, 0.0001]
        ];
        const TP_TUNER_LIMITS = [
            ['pitchMin', 'Pitch min', 0.1, 1.2, 0.01],
            ['pitchMax', 'Pitch max', 1.0, 2.75, 0.01],
            ['distMin', 'Dist min', 0.8, 4, 0.05],
            ['distMax', 'Dist max', 2, 8, 0.05]
        ];
        const TP_TUNER_ADS = [
            ['adsDist', 'ADS distance', 0.8, 3, 0.02],
            ['adsShoulder', 'ADS shoulder', -0.5, 1, 0.02],
            ['adsYaw', 'ADS yaw', -1.2, 1.2, 0.01],
            ['adsFov', 'ADS FOV', 35, 75, 1]
        ];

        function syncTpTunerInputs() {
            if (!tpTunerEl || !tpTune) return;
            const c = getTpCam();
            [['theta', orbit.theta], ['phi', orbit.phi], ['dist', orbit.dist]].forEach(([key, val]) => {
                const input = tpTunerEl.querySelector(`[data-tp-c="${key}"]`);
                const out = tpTunerEl.querySelector(`[data-tp-v="${key}"]`);
                if (input) input.value = val;
                if (out) out.textContent = fmtTpVal(key, val);
            });
            TP_TUNER_CAM.concat(TP_TUNER_LIMITS, TP_TUNER_ADS).forEach(([key]) => {
                const input = tpTunerEl.querySelector(`[data-tp-c="${key}"]`);
                const out = tpTunerEl.querySelector(`[data-tp-v="${key}"]`);
                if (input) input.value = c[key];
                if (out) out.textContent = fmtTpVal(key, c[key]);
            });
        }

        function fmtTpVal(key, val) {
            if (key === 'theta' || key === 'phi' || key === 'pitchMin' || key === 'pitchMax' || key === 'adsYaw') {
                return (val * 180 / Math.PI).toFixed(0) + '°';
            }
            if (key === 'orbitSens') return (+val).toFixed(4);
            if (key === 'fov' || key === 'adsFov') return (+val).toFixed(0);
            return (+val).toFixed(2);
        }

        function onTpTunerInput(e) {
            const key = e.target.dataset.tpC;
            if (!key) return;
            const c = getTpCam();
            const val = parseFloat(e.target.value);
            c[key] = val;
            if (key === 'theta' || key === 'phi' || key === 'dist') {
                orbit[key] = key === 'theta' ? wrapAngleRad(val) : val;
                if (key === 'theta') c.theta = orbit.theta;
            }
            const out = tpTunerEl.querySelector(`[data-tp-v="${key}"]`);
            if (out) out.textContent = fmtTpVal(key, key === 'theta' || key === 'phi' || key === 'dist' ? orbit[key] : val);
            updateCamera();
        }

        function buildTpTunerUI() {
            if (tpTunerEl) return tpTunerEl;
            const overlay = document.getElementById('voxel-overlay');
            if (!overlay) return null;
            const el = document.createElement('div');
            el.id = 'voxel-tp-tuner';
            el.className = 'vx-fp-tuner vx-tp-tuner';
            el.hidden = true;

            function sliderRow(key, label, min, max, step) {
                const id = `tp-tune-${key}`;
                return `<label class="vx-fp-row" for="${id}">
                    <span class="vx-fp-lbl">${label}</span>
                    <span class="vx-tp-val" data-tp-v="${key}">—</span>
                    <input type="range" id="${id}" data-tp-c="${key}"
                        min="${min}" max="${max}" step="${step}">
                </label>`;
            }

            function section(title, rows) {
                let h = `<div class="vx-fp-section"><b>${title}</b>`;
                rows.forEach(([key, label, min, max, step]) => {
                    h += sliderRow(key, label, min, max, step);
                });
                return h + '</div>';
            }

            let html = `<div class="vx-fp-head">
                <h4>TP camera tuner</h4>
                <span class="vx-fp-weapon">live</span>
            </div>
            <p class="vx-fp-hint">Orbit angle + shoulder framing. <b>F8</b> in 3rd person. Mouse/scroll still work.</p>`;
            html += section('Orbit angle', TP_TUNER_ORBIT);
            html += section('Shoulder &amp; lens', TP_TUNER_CAM);
            html += section('Limits', TP_TUNER_LIMITS);
            html += section('ADS (Shift aim)', TP_TUNER_ADS);
            html += `<div class="vx-fp-actions">
                <button type="button" class="vx-btn" data-tp-save>Save &amp; close</button>
                <button type="button" class="vx-btn" data-tp-reset>Reset defaults</button>
            </div>`;
            el.innerHTML = html;
            overlay.appendChild(el);

            el.addEventListener('input', onTpTunerInput);
            el.addEventListener('change', onTpTunerInput);
            el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
            el.querySelector('[data-tp-save]').addEventListener('click', () => {
                saveTpTune(true);
                el.hidden = true;
                if (g.showMessage) g.showMessage('TP camera saved (F8 to tweak again)', 2800);
            });
            el.querySelector('[data-tp-reset]').addEventListener('click', () => {
                tpTune = defaultTpTune();
                tpTune.dismissed = false;
                applyTpTuneToOrbit();
                syncTpTunerInputs();
                updateCamera();
            });

            tpTunerEl = el;
            return el;
        }

        function showTpTuner() {
            if (firstPerson) return;
            hideFpTuner();
            const el = buildTpTunerUI();
            if (!el) return;
            el.hidden = false;
            syncTpTunerInputs();
        }

        function hideTpTuner() {
            if (tpTunerEl) tpTunerEl.hidden = true;
        }

        function setFirstPerson(on) {
            firstPerson = !!on;
            if (av && av.group) av.group.visible = !firstPerson;
            ensureFpViewmodel();
            if (fpPivot) fpPivot.visible = firstPerson;
            const overlay = document.getElementById('voxel-overlay');
            if (overlay) overlay.classList.toggle('vx-tp-view', !firstPerson);
            if (camera) {
                camera.fov = firstPerson ? TP_FP_FOV : getTpCam().fov;
                camera.updateProjectionMatrix();
            }
            if (firstPerson) {
                hideTpTuner();
                tpCamPos = null;
                tpCamReady = false;
                requestFpPointerLock();
            } else {
                hideFpTuner();
                tpCamReady = false;
                tpCamPos = null;
                releasePointerLock();
                syncViewCursor();
            }
            updateViewHints();
            if (g.showMessage) g.showMessage(firstPerson ? 'First person' : 'Third person', 1200);
        }

        function updateViewHints() {
            const el = document.getElementById('voxel-view-hint');
            if (!el) return;
            el.innerHTML = firstPerson
                ? '<b>mouse</b> aim · <b>Shift</b> focus · <b>click</b> mine · <b>hold click</b> laser · <b>right-click</b> place · <b>1-9</b> quickbar'
                : '<b>click</b> capture mouse · <b>move</b> look · <b>Shift</b> focus · <b>scroll</b> zoom · <b>F8</b> camera · <b>right-click</b> place';
        }

        function updateFpViewmodel(dt, sp) {
            if (!firstPerson || !fpPivot || !fpRest) return;
            if (fpSwingTimer > 0) fpSwingTimer = Math.max(0, fpSwingTimer - dt);

            const moving = player.grounded && sp > 0.3;
            const run = player.state === 'run';
            const aimT = focusAimBlend;
            const bobAmp = moving ? Math.min(sp / MOVE_RUN_SPEED, 1) * (run ? 0.048 : 0.034) * (1 - aimT * 0.88) : 0;
            const bobFreq = run ? 10.5 : 7.2;
            const bobY = Math.sin(elapsed * bobFreq) * bobAmp;
            const bobX = Math.cos(elapsed * bobFreq * 0.5) * bobAmp * 0.45;
            const bobRoll = Math.sin(elapsed * bobFreq * 0.5) * bobAmp * 0.35;

            let px = fpRest.pos.x + bobX;
            let py = fpRest.pos.y + bobY;
            let pz = fpRest.pos.z;
            let rx = fpRest.rotX;
            let ry = fpRest.rotY;
            let rz = fpRest.rotZ + bobRoll;
            if (aimT > 0.001) {
                px = THREE.MathUtils.lerp(px, fpRest.pos.x + 0.05, aimT);
                py = THREE.MathUtils.lerp(py, fpRest.pos.y - 0.07, aimT);
                pz = THREE.MathUtils.lerp(pz, fpRest.pos.z + 0.2, aimT);
                rx = THREE.MathUtils.lerp(rx, fpRest.rotX - 0.04, aimT);
                ry = THREE.MathUtils.lerp(ry, fpRest.rotY, aimT);
                rz = THREE.MathUtils.lerp(rz, fpRest.rotZ * 0.35, aimT);
            }

            if (fpSwingTimer > 0) {
                const t = 1 - (fpSwingTimer / fpSwingDuration);
                const dir = fpSwingDir || 1;
                const A = 0.18, S = 0.52;
                let antic = 0, strike = 0, recover = 0;
                if (t < A) {
                    antic = Math.sin((t / A) * Math.PI / 2);
                } else if (t < S) {
                    const u = (t - A) / (S - A);
                    strike = u * u * 1.2;
                    antic = 1 - u;
                } else {
                    const u = (t - S) / (1 - S);
                    recover = 1 - (1 - u) * (1 - u);
                    strike = (1 - recover) * 1.2;
                }
                const k = fpRecoilStrength();
                rx += (-antic * 0.4 + strike * 1.15) * k;
                ry += strike * 0.16 * dir * k;
                rz += (-strike * 1.35 - antic * 0.22) * dir * k;
                pz += (-strike * 0.22 + antic * 0.08) * k;
                py += (antic * 0.11 - strike * 0.15) * k;
                px += (strike * 0.1 - antic * 0.04) * dir * k;
            }

            fpPivot.position.set(px, py, pz);
            fpPivot.rotation.set(rx, ry, rz);
            applyFpMountPose();
            applyFpWeaponGripRest();
        }

        function mineBlock() {
            fireWeapon();
        }
        function placeBlock(){
          const t=pickTarget(); if(!t) return;
          const slot=hotbar[selected];
          if(!slot || slot.count<=0) return;
          const {x,y,z}=t.place;
          // never place inside the player
          const wx=x+WORLD_OFFSET.x, wy=y+WORLD_OFFSET.y, wz=z+WORLD_OFFSET.z;
          const p=player.pos;
          if(wx+1>p.x-player.half.x && wx<p.x+player.half.x &&
             wz+1>p.z-player.half.z && wz<p.z+player.half.z &&
             wy+1>p.y && wy<p.y+player.height) return;
          if(getBlock(x,y,z)) return;
          if (!spendFromInventory(slot.id, 1)) return;
          setBlockEvent(x,y,z,slot.id);
          renderHotbar();
          if (drawerOpen) renderDrawer();
          updateHUD();
        }
        
        // ---------- inventory: backpack + 9-slot quickbar + categorized drawer ----------
        const HOTBAR_SLOTS = 9;
        const INV_CATEGORIES = ['Terrain', 'Life', 'Resources', 'Crystals', 'Crafted', 'Hazards'];
        const CAT_ICONS = {
            Terrain: '🪨', Life: '🌿', Resources: '⛏️',
            Crystals: '💎', Crafted: '🔧', Hazards: '☢️'
        };
        const WEAPON_ICONS = {
            pickaxe: '⛏️', wrench: '🔧', sword: '⚔️',
            blaster: '🔫', laser: '✨', plasma: '💫', railgun: '⚡'
        };
        const WEAPONS_SAVE_KEY = 'pjboy.voxelWeapons.owned.v1';
        const ownedWeapons = new Set();
        const hotbar = Array(HOTBAR_SLOTS).fill(null);
        const backpack = {};   // block id -> total count
        let selected = 0;
        let drawerOpen = false;
        let drawerFilter = 'owned';   // 'owned' | 'all'
        const hotbarEl = document.getElementById('voxel-hotbar');
        const drawerEl = document.getElementById('voxel-drawer');
        const drawerPanelEl = document.getElementById('voxel-drawer-panel');

        function backpackTotal() {
            return Object.values(backpack).reduce((n, c) => n + c, 0);
        }
        function backpackTypes() {
            return Object.keys(backpack).filter((k) => backpack[k] > 0).length;
        }
        function loadOwnedWeapons() {
            ownedWeapons.clear();
            try {
                const raw = localStorage.getItem(WEAPONS_SAVE_KEY);
                if (raw) {
                    JSON.parse(raw).forEach((i) => ownedWeapons.add(i | 0));
                }
            } catch (_) {}
            const defs = weaponList();
            const cfg = loadCharCfg();
            const VC = getVC();
            let start = 0;
            if (VC) {
                const cls = VC.CLASSES[cfg.classIdx | 0];
                const idx = defs.findIndex((w) => w.id === cls.weapon);
                if (idx >= 0) start = idx;
            }
            ownedWeapons.add(start);
            ownedWeapons.add(cfg.weapon | 0);
            saveOwnedWeapons();
        }
        function saveOwnedWeapons() {
            try {
                localStorage.setItem(WEAPONS_SAVE_KEY, JSON.stringify([...ownedWeapons]));
            } catch (_) {}
        }
        function weaponStatLine(def) {
            if (!def || !def.stats) return '';
            const s = def.stats;
            return `DMG ${s.Damage} · SPD ${s.Speed} · RNG ${s.Range}`;
        }
        function appendWeaponSection(body, ownedOnly) {
            const defs = weaponList();
            const visible = ownedOnly
                ? defs.map((d, i) => ({ def: d, i })).filter((x) => ownedWeapons.has(x.i))
                : defs.map((d, i) => ({ def: d, i }));
            const sec = document.createElement('div');
            sec.className = 'vx-section';
            sec.innerHTML = `<h4>⚔️ Weapons <span class="vx-count">${ownedWeapons.size}/${defs.length}</span></h4>`;
            const grid = document.createElement('div');
            grid.className = 'vx-grid';
            if (!visible.length) {
                const empty = document.createElement('div');
                empty.style.cssText = 'grid-column:1/-1;font-size:10px;color:#7e98a6;padding:6px 2px;';
                empty.textContent = 'No weapons unlocked yet.';
                grid.appendChild(empty);
            } else {
                for (const { def, i } of visible) {
                    const owned = ownedWeapons.has(i);
                    const equipped = weaponIndex === i;
                    const item = document.createElement('div');
                    item.className = 'vx-item vx-weapon'
                        + (equipped ? ' vx-equipped' : '')
                        + (!owned && ownedOnly ? ' vx-empty' : '');
                    item.innerHTML = `
                        <div class="vx-thumb vx-weapon-icon">${WEAPON_ICONS[def.id] || '🔹'}</div>
                        <div class="vx-name" title="${def.name}">${def.name}</div>
                        <div class="vx-cnt">${equipped ? 'Equipped' : (def.ranged ? 'Ranged' : 'Melee')}</div>
                        <div class="vx-wpn-stat">${weaponStatLine(def)}</div>`;
                    if (owned || !ownedOnly) {
                        item.addEventListener('click', () => {
                            ownedWeapons.add(i);
                            saveOwnedWeapons();
                            setWeaponIndex(i);
                        });
                    }
                    grid.appendChild(item);
                }
            }
            sec.appendChild(grid);
            body.appendChild(sec);
        }
        function getBackpackCount(id) {
            return backpack[id] || 0;
        }
        function thumb(b) {
            const c = document.createElement('canvas'); c.width = c.height = TILE;
            const x = c.getContext('2d');
            x.drawImage(paintTile(b.tiles.all || b.tiles.top, b.animated ? 0 : undefined), 0, 0);
            if (b.deco) x.drawImage(paintTile(b.deco.tile), 0, 0);
            return c.toDataURL();
        }
        function thumbUrl(id) {
            const b = blockById(id);
            return b ? thumb(b) : '';
        }
        function syncHotbarFromBackpack() {
            for (let i = 0; i < HOTBAR_SLOTS; i++) {
                const s = hotbar[i];
                if (!s) continue;
                const have = getBackpackCount(s.id);
                if (have <= 0) hotbar[i] = null;
                else if (s.count > have) s.count = have;
            }
        }
        function autoFillHotbar(id, n) {
            let slot = hotbar.findIndex((s) => s && s.id === id);
            if (slot >= 0) {
                hotbar[slot].count = Math.min(hotbar[slot].count + n, getBackpackCount(id));
                return;
            }
            const empty = hotbar.findIndex((s) => !s);
            if (empty >= 0) {
                hotbar[empty] = { id, count: Math.min(n, getBackpackCount(id)) };
            }
        }
        function addToInventory(id, n = 1) {
            backpack[id] = (backpack[id] || 0) + n;
            autoFillHotbar(id, n);
            renderHotbar();
            if (drawerOpen) renderDrawer();
        }
        function spendFromInventory(id, n = 1) {
            if (getBackpackCount(id) < n) return false;
            backpack[id] -= n;
            if (backpack[id] <= 0) delete backpack[id];
            for (let i = 0; i < HOTBAR_SLOTS; i++) {
                const s = hotbar[i];
                if (!s || s.id !== id) continue;
                s.count -= n;
                if (s.count <= 0) hotbar[i] = null;
            }
            return true;
        }
        function selectSlot(i) {
            if (i < 0 || i >= HOTBAR_SLOTS) return;
            selected = i;
            renderHotbar();
            if (drawerOpen) renderDrawer();
        }
        function clearHotbarSlot(i) {
            hotbar[i] = null;
            renderHotbar();
            if (drawerOpen) renderDrawer();
        }
        function assignHotbarSlot(i, id, amount) {
            const have = getBackpackCount(id);
            if (have <= 0) return;
            const cnt = amount == null ? have : Math.min(amount, have);
            hotbar[i] = { id, count: cnt };
            selectSlot(i);
        }
        function makeSlotEl(i, opts) {
            const { strip = false, onClick, onContext } = opts || {};
            const d = document.createElement('div');
            const cls = ['slot'];
            if (i === selected) cls.push('active');
            if (strip && drawerOpen && i === selected) cls.push('target');
            d.className = cls.join(' ');
            d.dataset.slot = String(i);
            const k = document.createElement('div');
            k.className = 'key';
            k.textContent = i + 1;
            d.appendChild(k);
            const s = hotbar[i];
            if (s) {
                const b = blockById(s.id);
                if (b) {
                    d.style.backgroundImage = `url(${thumb(b)})`;
                    d.title = b.name;
                }
                const cn = document.createElement('div');
                cn.className = 'cnt';
                cn.textContent = s.count;
                d.appendChild(cn);
            }
            d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('drop-hover'); });
            d.addEventListener('dragleave', () => d.classList.remove('drop-hover'));
            d.addEventListener('drop', (e) => {
                e.preventDefault();
                d.classList.remove('drop-hover');
                const bid = +e.dataTransfer.getData('text/voxel-block');
                if (bid) assignHotbarSlot(i, bid);
            });
            if (onClick) d.addEventListener('click', onClick);
            if (onContext) d.addEventListener('contextmenu', onContext);
            return d;
        }
        function renderHotbar() {
            if (!hotbarEl) return;
            hotbarEl.innerHTML = '';
            for (let i = 0; i < HOTBAR_SLOTS; i++) {
                hotbarEl.appendChild(makeSlotEl(i, {
                    onClick: () => selectSlot(i),
                    onContext: (e) => { e.preventDefault(); clearHotbarSlot(i); }
                }));
            }
        }
        function toggleDrawer(force) {
            drawerOpen = force !== undefined ? !!force : !drawerOpen;
            if (drawerEl) {
                drawerEl.hidden = !drawerOpen;
                drawerEl.classList.toggle('vx-drawer-open', drawerOpen);
            }
            if (drawerOpen) {
                releasePointerLock();
                syncViewCursor();
                renderDrawer();
                if (g.showMessage) g.showMessage('Inventory — equip weapons, drag blocks to quickbar', 2200);
            } else {
                renderHotbar();
                if (firstPerson) requestFpPointerLock();
            }
        }
        function renderDrawer() {
            if (!drawerPanelEl) return;
            syncHotbarFromBackpack();
            const ownedOnly = drawerFilter === 'owned';
            drawerPanelEl.innerHTML = `
                <div class="vx-header">
                    <h3 class="vx-title"><span>🎒</span> Asteroid Inventory</h3>
                    <div class="vx-stats">
                        <span class="vx-chip"><b>Items</b> ${backpackTotal()}</span>
                        <span class="vx-chip"><b>Types</b> ${backpackTypes()}</span>
                        <span class="vx-chip"><b>Slot</b> ${selected + 1}</span>
                        <span class="vx-chip"><b>Weapon</b> ${weaponDef ? weaponDef.name : '—'}</span>
                    </div>
                    <div class="vx-actions">
                        <button type="button" class="vx-btn ${ownedOnly ? 'vx-btn-on' : ''}" data-vx-filter="owned">Owned</button>
                        <button type="button" class="vx-btn ${ownedOnly ? '' : 'vx-btn-on'}" data-vx-filter="all">All</button>
                        <button type="button" class="vx-btn" data-vx-clear-bar>Clear bar</button>
                        <button type="button" class="vx-btn" data-vx-close>Close (Esc)</button>
                    </div>
                </div>
                <div class="vx-strip-wrap">
                    <div class="vx-strip-label">
                        <span>Quickbar — assign to slot <b>${selected + 1}</b></span>
                        <span>click item · drag to slot · right-click slot to clear</span>
                    </div>
                    <div class="vx-strip" id="voxel-drawer-strip"></div>
                </div>
                <div class="vx-body" id="voxel-drawer-body"></div>
                <div class="vx-help">
                    <kbd>1</kbd>–<kbd>9</kbd> pick slot · <kbd>Q</kbd>/<kbd>E</kbd> cycle weapon · <kbd>Tab</kbd>/<kbd>M</kbd> toggle · <kbd>Esc</kbd> close
                </div>`;

            const strip = drawerPanelEl.querySelector('#voxel-drawer-strip');
            for (let i = 0; i < HOTBAR_SLOTS; i++) {
                strip.appendChild(makeSlotEl(i, {
                    strip: true,
                    onClick: () => selectSlot(i),
                    onContext: (e) => { e.preventDefault(); clearHotbarSlot(i); }
                }));
            }

            const body = drawerPanelEl.querySelector('#voxel-drawer-body');
            appendWeaponSection(body, ownedOnly);
            for (const cat of INV_CATEGORIES) {
                const blocks = BlockRegistry.filter((b) => b.cat === cat);
                const visible = ownedOnly ? blocks.filter((b) => getBackpackCount(b.id) > 0) : blocks;
                const sec = document.createElement('div');
                sec.className = 'vx-section';
                const ownedInCat = blocks.filter((b) => getBackpackCount(b.id) > 0).length;
                sec.innerHTML = `<h4>${CAT_ICONS[cat] || '▪'} ${cat} <span class="vx-count">${ownedInCat}/${blocks.length}</span></h4>`;
                const grid = document.createElement('div');
                grid.className = 'vx-grid';
                if (!visible.length) {
                    const empty = document.createElement('div');
                    empty.className = 'vx-empty';
                    empty.style.cssText = 'grid-column:1/-1;font-size:10px;color:#7e98a6;padding:6px 2px;';
                    empty.textContent = ownedOnly ? 'Nothing mined in this category yet.' : 'No blocks in this category.';
                    grid.appendChild(empty);
                } else {
                    for (const b of visible) {
                        const cnt = getBackpackCount(b.id);
                        const item = document.createElement('div');
                        item.className = 'vx-item' + (cnt <= 0 ? ' vx-empty' : '');
                        item.draggable = cnt > 0;
                        item.dataset.blockId = String(b.id);
                        item.innerHTML = `
                            <div class="vx-thumb" style="background-image:url(${thumb(b)})"></div>
                            <div class="vx-name" title="${b.name}">${b.name}</div>
                            <div class="vx-cnt">${cnt > 0 ? cnt : '—'}</div>`;
                        if (cnt > 0) {
                            item.addEventListener('dragstart', (e) => {
                                e.dataTransfer.setData('text/voxel-block', String(b.id));
                                e.dataTransfer.effectAllowed = 'copy';
                            });
                            item.addEventListener('click', () => assignHotbarSlot(selected, b.id));
                            item.addEventListener('contextmenu', (e) => {
                                e.preventDefault();
                                assignHotbarSlot(selected, b.id, 1);
                            });
                        }
                        grid.appendChild(item);
                    }
                }
                sec.appendChild(grid);
                body.appendChild(sec);
            }

            drawerPanelEl.querySelector('[data-vx-close]').addEventListener('click', () => toggleDrawer(false));
            drawerPanelEl.querySelector('[data-vx-clear-bar]').addEventListener('click', () => {
                for (let i = 0; i < HOTBAR_SLOTS; i++) hotbar[i] = null;
                renderHotbar();
                renderDrawer();
            });
            drawerPanelEl.querySelectorAll('[data-vx-filter]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    drawerFilter = btn.dataset.vxFilter;
                    renderDrawer();
                });
            });
        }


        function _saveScene() {
            const cam = g.camera;
            _saved = {
                bg: g.scene.background,
                fog: g.scene.fog,
                camFov: cam ? cam.fov : 75,
                camNear: cam ? cam.near : 0.1,
                camFar: cam ? cam.far : 1000,
                camPos: cam ? cam.position.clone() : null,
                camQuat: cam ? cam.quaternion.clone() : null,
                camUp: cam ? cam.up.clone() : null,
                groundVisible: g.ground ? g.ground.visible : null,
                gridVisible: g.gridHelper ? g.gridHelper.visible : null,
                cheeseVisible: g.cheeseFloor ? g.cheeseFloor.visible : null,
                roofVisible: g.crystalRoof ? g.crystalRoof.visible : null,
                skyVisible: g.sky ? g.sky.visible : null,
                roofY: g.roofY,
            };
            // PJBoy's maze lighting (ambient 1.8 + sun 2.4) stacks on voxel lights and blows out blocks.
            if (g.ambientLight) {
                _saved.ambient = { i: g.ambientLight.intensity, v: g.ambientLight.visible };
                g.ambientLight.intensity = 0;
                g.ambientLight.visible = false;
            }
            if (g.directionalLight) {
                _saved.dir = { i: g.directionalLight.intensity, v: g.directionalLight.visible };
                g.directionalLight.intensity = 0;
                g.directionalLight.visible = false;
            }
            _hideLegacyEnvironment();
        }

        function _hideLegacyEnvironment() {
            // Maze floor/roof planes sit at y≈0 and y≈20 — visible through the voxel asteroid.
            // Re-applied each tick because async GLTF loads can rebuild them after enter.
            if (g.ground) g.ground.visible = false;
            if (g.gridHelper) g.gridHelper.visible = false;
            if (g.cheeseFloor) g.cheeseFloor.visible = false;
            if (g.crystalRoof) g.crystalRoof.visible = false;
            if (g.sky) g.sky.visible = false;
            g.roofY = null;
        }

        function _setupScene() {
            scene = g.scene;
            camera = g.camera;
            camera.fov = firstPerson ? TP_FP_FOV : getTpCam().fov;
            camera.near = 0.1;
            camera.far = 500;
            camera.updateProjectionMatrix();
            (function nebulaBackground(){
              const c=document.createElement('canvas'); c.width=c.height=1024;
              const x=c.getContext('2d');
              const base=x.createLinearGradient(0,0,1024,1024);
              base.addColorStop(0,'#101238'); base.addColorStop(.5,'#1d1452'); base.addColorStop(1,'#0c0e2c');
              x.fillStyle=base; x.fillRect(0,0,1024,1024);
              const blobs=[[300,340,430,'#5a3df0'],[720,290,370,'#b04ae0'],[520,700,420,'#e052c8'],
                             [860,760,310,'#2c6cf0'],[180,820,290,'#7a2cd8'],[640,520,260,'#ff7ad6']];
              for(const[bx,by,r,col] of blobs){
                const g2=x.createRadialGradient(bx,by,10,bx,by,r);
                g2.addColorStop(0,col+'a8'); g2.addColorStop(.6,col+'38'); g2.addColorStop(1,col+'00');
                x.fillStyle=g2; x.fillRect(0,0,1024,1024);
              }
              for(let i=0;i<420;i++){
                const s=Math.random();
                x.fillStyle='rgba(255,255,255,'+(0.25+s*0.7)+')';
                x.fillRect(Math.random()*1024, Math.random()*1024, s>0.94?3:1.6, s>0.94?3:1.6);
              }
              _voxelBg = new THREE.CanvasTexture(c);
              g.scene.background = _voxelBg;
            })();
            // Soft distance fade — keeps the white blowout on bright tops in check.
            g.scene.fog = new THREE.Fog(0x1a1440, 28, 130);
            if (!g._voxelLights) {
                g._voxelLights = [];
                const hemi = new THREE.HemisphereLight(0xc4d8ff, 0x3a2468, 0.85);
                const keyL = new THREE.DirectionalLight(0xfff2dd, 0.75);
                keyL.position.set(30, 60, 40);
                const rim = new THREE.DirectionalLight(0xe06ae8, 0.35);
                rim.position.set(-40, 30, -30);
                g.scene.add(hemi, keyL, rim);
                g._voxelLights.push(hemi, keyL, rim);
            }
            _hideLegacyEnvironment();
            if (g._hideLegacyPlayUI) g._hideLegacyPlayUI();
            const hud = document.getElementById('voxel-overlay');
            if (hud) hud.hidden = false;
            if (g.showMessage) g.showMessage('Asteroid — mine, build, jetpack (hold Space)', 3200);
        }

        function _restoreScene() {
            if (!_saved) return;
            if (_voxelBg && _voxelBg !== _saved.bg) {
                _voxelBg.dispose();
            }
            _voxelBg = null;
            g.scene.background = _saved.bg;
            g.scene.fog = _saved.fog;
            if (_saved.ambient && g.ambientLight) {
                g.ambientLight.intensity = _saved.ambient.i;
                g.ambientLight.visible = _saved.ambient.v;
            }
            if (_saved.dir && g.directionalLight) {
                g.directionalLight.intensity = _saved.dir.i;
                g.directionalLight.visible = _saved.dir.v;
            }
            if (g.ground && _saved.groundVisible != null) g.ground.visible = _saved.groundVisible;
            if (g.gridHelper && _saved.gridVisible != null) g.gridHelper.visible = _saved.gridVisible;
            if (g.cheeseFloor && _saved.cheeseVisible != null) g.cheeseFloor.visible = _saved.cheeseVisible;
            if (g.crystalRoof && _saved.roofVisible != null) g.crystalRoof.visible = _saved.roofVisible;
            if (g.sky && _saved.skyVisible != null) g.sky.visible = _saved.skyVisible;
            if (_saved.roofY != null) g.roofY = _saved.roofY;
            const cam = g.camera;
            if (cam) {
                cam.fov = _saved.camFov;
                cam.near = _saved.camNear;
                cam.far = _saved.camFar;
                if (_saved.camPos) cam.position.copy(_saved.camPos);
                if (_saved.camQuat) cam.quaternion.copy(_saved.camQuat);
                if (_saved.camUp) cam.up.copy(_saved.camUp);
                cam.updateProjectionMatrix();
                cam.updateMatrixWorld(true);
            }
            _saved = null;
            const hud = document.getElementById('voxel-overlay');
            if (hud) hud.hidden = true;
            toggleDrawer(false);
            if (g._restoreLegacyPlayUI) g._restoreLegacyPlayUI();
        }

        function _resetInput() {
            const codes = [
                'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
                'ShiftLeft', 'ShiftRight',
                'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
            ];
            codes.forEach((code) => { keys[code] = false; });
            if (g.keys) codes.forEach((code) => { g.keys[code] = false; });
            dragging = false;
            moved = 0;
            downBtn = 0;
            fireHeld = false;
            laserCooldown = 0;
            releasePointerLock();
            syncViewCursor();
        }

        function _clearWorld() {
            scene3.chunks.forEach(c => {
                ['static','anim','glass','deco'].forEach(k => {
                    if (c[k]) { scene.remove(c[k]); if (c[k].dispose) c[k].dispose(); }
                });
            });
            scene3.chunks.clear();
            const VC = getVC();
            if (av && VC && VC.dispose) VC.dispose(av);
            else if (av && av.group) scene.remove(av.group);
            av = null;
            parts.forEach(p => scene.remove(p.m));
            parts.length = 0;
            shotVfx.forEach(s => {
                if (s.grp) scene.remove(s.grp);
                if (s.m) scene.remove(s.m);
            });
            shotVfx.length = 0;
            disposeAimEdgeHighlight();
            if (fpPivot && fpPivot.parent) fpPivot.parent.remove(fpPivot);
            if (g._voxelLights) {
                g._voxelLights.forEach((l) => g.scene.remove(l));
                g._voxelLights = null;
            }
        }

        function _removeListeners() {
            _listeners.forEach(([el, ev, fn, opts]) => el.removeEventListener(ev, fn, opts));
            _listeners = [];
        }

        function spawnPlayerAtCenter() {
            for (let y = H - 2; y > 0; y--) {
                if (getBlock(W >> 1, y, D >> 1)) {
                    player.pos.set(W / 2 + 0.5 + WORLD_OFFSET.x, y + 1 + WORLD_OFFSET.y + 0.01, D / 2 + 0.5 + WORLD_OFFSET.z);
                    player.vel.set(0, 0, 0);
                    return;
                }
            }
            player.pos.set(0, 24, 0);
            player.vel.set(0, 0, 0);
        }

        function tick(dt) {
            if (g.keys) Object.assign(keys, g.keys);
            _hideLegacyEnvironment();
            if (g._hideLegacyPlayUI) g._hideLegacyPlayUI();
            elapsed += dt;
            // --- movement intent in camera space ---
            let ix=0,iz=0;
            if(keys.KeyW||keys.ArrowUp) iz-=1;
            if(keys.KeyS||keys.ArrowDown) iz+=1;
            if(keys.KeyA||keys.ArrowLeft) ix-=1;
            if(keys.KeyD||keys.ArrowRight) ix+=1;
            const shiftHeld = !!(keys.ShiftLeft || keys.ShiftRight);
            focusAimBlend += ((shiftHeld ? 1 : 0) - focusAimBlend) * (1 - Math.exp(-12 * dt));
            const speed = THREE.MathUtils.lerp(MOVE_RUN_SPEED, MOVE_ADS_SPEED, focusAimBlend);
            const len=Math.hypot(ix,iz);
            let mvx=0,mvz=0;
            if(len){
                const s=Math.sin(orbit.theta), c=Math.cos(orbit.theta);
                const fx=-s, fz=-c, rx=c, rz=-s;
                mvx=(fx*-iz+rx*ix)/len*speed;
                mvz=(fz*-iz+rz*ix)/len*speed;
            }
            const camYaw = orbit.theta + Math.PI;
            const yawTarget = firstPerson ? camYaw
                : (focusAimBlend > 0.12 || !len ? camYaw : Math.atan2(mvx, mvz));
            if(yawTarget!==null){
                let d=yawTarget-player.yaw;
                while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2;
                player.yaw+=d*(1-Math.exp(-(firstPerson?20:12)*dt));
            }
            player.vel.y-=22*dt;
            const wasGrounded=player.grounded;
            player.grounded=false;
            let thrusting=false;
            if(keys.Space){
                if(wasGrounded) player.vel.y=8.5;
                else { player.vel.y=Math.min(player.vel.y+40*dt, 5.5); thrusting=true; }
            }
            player.vel.y=Math.max(player.vel.y,-28);
            const hv=new THREE.Vector3(mvx,0,mvz);
            moveAxis('x', hv.x*dt);
            moveAxis('z', hv.z*dt);
            moveAxis('y', player.vel.y*dt);
            const sp=Math.hypot(mvx,mvz);
            player.state = !player.grounded ? (thrusting ? 'fly' : 'air')
                : sp < 0.3 ? 'idle' : 'run';
            if (av && av.group) {
                if (!firstPerson) {
                    updateTpCharacter(dt, sp);
                    av.flames.forEach(f => { f.visible = thrusting;
                        if (thrusting) { const s2 = 0.8 + Math.random() * 0.5; f.scale.set(s2, s2, s2); } });
                } else {
                    av.group.visible = false;
                    av.flames.forEach(f => { f.visible = false; });
                }
            }
            updateFpViewmodel(dt, sp);
            updateLaserHoldFire(dt);
            updateWeaponFx();
            if(matAnim){
                matAnim.map.offset.x=(((elapsed*5)|0)%4)*0.25;
                const p=0.9+0.1*Math.sin(elapsed*4); matAnim.color.setRGB(p,p,p);
            }
            if(decoMat&&decoMat.userData.shader) decoMat.userData.shader.uniforms.uTime.value=elapsed;
            const t=pickTarget();
            updateAimEdgeHighlight(t);
            const targetNameEl=document.getElementById('voxel-target-name');
            if (targetNameEl) targetNameEl.textContent = t&&getBlock(t.x,t.y,t.z)?
                blockById(getBlock(t.x,t.y,t.z)).name : '';
            stepParts(dt);
            stepShotVfx(dt);
            updateHUD();
            updateCamera(dt);
            updateTpAimVisuals();
        }

        const _tpFwd = new THREE.Vector3();
        const _tpRight = new THREE.Vector3();
        const _tpCamFwd = new THREE.Vector3();
        const _tpCamRight = new THREE.Vector3();
        const _tpFocus = new THREE.Vector3();
        const _tpDesired = new THREE.Vector3();
        const _tpLook = new THREE.Vector3();
        const _tpRayDir = new THREE.Vector3();

        function getTpAimVectors(outFwd, outRight, yawOffset) {
            const sinP = Math.sin(orbit.phi), cosP = Math.cos(orbit.phi);
            const theta = orbit.theta + (yawOffset || 0);
            const sinT = Math.sin(theta), cosT = Math.cos(theta);
            outFwd.set(-sinP * sinT, -cosP, -sinP * cosT);
            outRight.set(cosT, 0, -sinT);
            return outFwd;
        }

        function resolveTpCameraCollision(from, to) {
            _tpRayDir.copy(to).sub(from);
            const len = _tpRayDir.length();
            if (len < 0.05) return to.clone();
            _tpRayDir.multiplyScalar(1 / len);
            ray.set(from, _tpRayDir);
            const hit = ray.intersectObjects(collectAimMeshes(), true)[0];
            if (hit && hit.distance < len) {
                return from.clone().addScaledVector(_tpRayDir, Math.max(0.45, hit.distance - 0.32));
            }
            return to.clone();
        }

        function updateCamera(dt) {
            dt = dt || 1 / 60;
            if (!camera) return;
            if (firstPerson) {
                orbit.phi = Math.max(0.15, Math.min(2.95, orbit.phi));
                const fpFov = THREE.MathUtils.lerp(TP_FP_FOV, TP_FP_ADS_FOV, focusAimBlend);
                if (Math.abs(camera.fov - fpFov) > 0.05) {
                    camera.fov = fpFov;
                    camera.updateProjectionMatrix();
                }
                const eye = player.pos.clone().add(new THREE.Vector3(0, 1.62, 0));
                camera.position.copy(eye);
                camera.lookAt(
                    eye.x - Math.sin(orbit.phi) * Math.sin(orbit.theta),
                    eye.y - Math.cos(orbit.phi),
                    eye.z - Math.sin(orbit.phi) * Math.cos(orbit.theta));
            } else {
                const tc = getTpCam();
                orbit.phi = Math.max(tc.pitchMin, Math.min(tc.pitchMax, orbit.phi));
                orbit.dist = Math.max(tc.distMin, Math.min(tc.distMax, orbit.dist));
                const ads = focusAimBlend;
                const camDist = THREE.MathUtils.lerp(orbit.dist, tc.adsDist, ads);
                const camShoulder = THREE.MathUtils.lerp(tc.shoulder, tc.adsShoulder, ads);
                const camFov = THREE.MathUtils.lerp(tc.fov, tc.adsFov, ads);
                if (Math.abs(camera.fov - camFov) > 0.05) {
                    camera.fov = camFov;
                    camera.updateProjectionMatrix();
                }
                getTpAimVectors(_tpFwd, _tpRight);
                const adsYaw = tc.adsYaw * ads;
                if (adsYaw) getTpAimVectors(_tpCamFwd, _tpCamRight, adsYaw);
                else { _tpCamFwd.copy(_tpFwd); _tpCamRight.copy(_tpRight); }
                _tpFocus.copy(player.pos).add(new THREE.Vector3(0, tc.focusH, 0));
                // Over-the-right-shoulder: camera sits behind + right so the hero
                // frames on the right third and the crosshair opens to the left.
                _tpDesired.copy(_tpFocus)
                    .addScaledVector(_tpCamFwd, -camDist)
                    .addScaledVector(_tpCamRight, camShoulder)
                    .add(new THREE.Vector3(0, tc.camLift, 0));
                const resolved = resolveTpCameraCollision(_tpFocus, _tpDesired);
                if (!tpCamPos) tpCamPos = resolved.clone();
                if (!tpCamReady) {
                    tpCamPos.copy(resolved);
                    tpCamReady = true;
                }
                tpCamPos.lerp(resolved, 1 - Math.exp(-18 * dt));
                camera.position.copy(tpCamPos);
                _tpLook.copy(tpCamPos).addScaledVector(_tpFwd, 14);
                camera.lookAt(_tpLook);
                if (tpTunerEl && !tpTunerEl.hidden) syncTpTunerInputs();
            }
        }

        function enter() {
            if (_active) return;
            _saveScene();
            _setupScene();
            _active = true;
            if (g.keys) Object.assign(keys, g.keys);
            loadOwnedWeapons();
            weaponIndex = loadCharCfg().weapon;
            ownedWeapons.add(weaponIndex);
            updateWeaponLabel();
            on(window, 'keydown', e => {
                keys[e.code] = true;
                if (e.code === 'KeyQ') { cycleWeapon(-1); return; }
                if (e.code === 'KeyE' && !e.shiftKey) { cycleWeapon(1); return; }
                if (e.code === 'Escape') {
                    if (drawerOpen) {
                        toggleDrawer(false);
                        return;
                    }
                    if (isViewPointerLocked()) {
                        releasePointerLock();
                        syncViewCursor();
                        return;
                    }
                }
                if (e.code === 'Tab' || e.code === 'KeyM') {
                    e.preventDefault();
                    toggleDrawer();
                    return;
                }
                if (e.code.startsWith('Digit')) {
                    const n = +e.code.slice(5);
                    if (n >= 1 && n <= HOTBAR_SLOTS) selectSlot(n - 1);
                }
                if (e.code === 'KeyV') {
                    setFirstPerson(!firstPerson);
                }
                if (e.code === 'F8') {
                    e.preventDefault();
                    if (firstPerson) showFpTuner();
                    else showTpTuner();
                }
                if (e.code === 'KeyR' && (e.shiftKey || e.metaKey)) {
                    SEED = (Math.random() * 1e9) | 0;
                    generateWorld();
                    rebuildWorld();
                    spawnPlayerAtCenter();
                    if (g.showMessage) g.showMessage('New asteroid seed: ' + (SEED >>> 0).toString(16), 2200);
                }
            });
            on(window, 'keyup', e => { keys[e.code] = false; });
            if (drawerEl) {
                on(drawerEl, 'click', (e) => {
                    if (e.target === drawerEl) toggleDrawer(false);
                });
                on(drawerEl, 'wheel', (e) => e.preventDefault(), { passive: false });
            }
            const voxelHud = document.getElementById('voxel-overlay');
            if (voxelHud) {
                on(voxelHud, 'wheel', (e) => e.preventDefault(), { passive: false });
            }
            canvasEl = g.renderer && g.renderer.domElement;

            function onCanvasPointerDown(e) {
                if (drawerOpen) return;
                dragging = true;
                moved = 0;
                px = e.clientX;
                py = e.clientY;
                downBtn = e.button;
                wasLockedOnDown = isViewPointerLocked();
                if (e.button === 2) e.preventDefault();
                requestViewPointerLock();
                if (e.button === 0) {
                    fireHeld = true;
                    laserCooldown = 0;
                    if (isLaserRifle()) tryLaserMine();
                }
            }

            function onCanvasPointerUp(e) {
                if (!dragging) return;
                const btn = downBtn;
                dragging = false;
                if (btn === 0) fireHeld = false;
                if (drawerOpen) return;
                if (moved >= 8) return;
                if (!firstPerson && !wasLockedOnDown && isViewPointerLocked()) return;
                if (btn === 2) placeBlock();
                else if (btn === 0 && !isLaserRifle()) mineBlock();
            }

            function onCanvasPointerMove(e) {
                if (isViewPointerLocked()) {
                    const mx = e.movementX || 0;
                    const my = e.movementY || 0;
                    if (firstPerson) applyFpMouseLook(mx, my);
                    else applyTpMouseOrbit(mx, my);
                } else if (!firstPerson && !drawerOpen && (e.buttons & 2)) {
                    const dx = e.clientX - px, dy = e.clientY - py;
                    applyTpMouseOrbit(dx, dy);
                }
                if (dragging) moved += Math.abs(e.clientX - px) + Math.abs(e.clientY - py);
                px = e.clientX;
                py = e.clientY;
            }

            if (canvasEl) {
                on(canvasEl, 'contextmenu', e => e.preventDefault());
                on(canvasEl, 'pointerdown', onCanvasPointerDown);
                on(canvasEl, 'pointerup', onCanvasPointerUp);
                on(canvasEl, 'pointercancel', onCanvasPointerUp);
                on(canvasEl, 'pointerenter', e => {
                    px = e.clientX;
                    py = e.clientY;
                });
                on(canvasEl, 'wheel', e => {
                    const min = firstPerson ? 3 : getTpCam().distMin;
                    const max = firstPerson ? 16 : getTpCam().distMax;
                    orbit.dist = Math.max(min, Math.min(max, orbit.dist + e.deltaY * 0.008));
                    e.preventDefault();
                }, { passive: false });
                on(canvasEl, 'pointermove', onCanvasPointerMove);
            }
            on(document, 'pointerlockchange', () => {
                if (drawerOpen && document.pointerLockElement) releasePointerLock();
                syncViewCursor();
            });
            on(window, 'pointerup', onCanvasPointerUp);
            on(window, 'pointermove', onCanvasPointerMove);
            if (!texturesReady) {
                buildTextures();
                texturesReady = true;
            }
            rebuildMaterials();
            generateWorld();
            rebuildWorld();
            renderHotbar();
            if (!av) {
                av = buildPlayer();
                if (av && av.group && !av.group.parent) scene.add(av.group);
                scene.add(camera);
            } else if (av.group) {
                scene.add(av.group);
                if (av.weapon) {
                    tpWeapon = av.weapon;
                    tpGrip = av.weaponGrip || av.weapon.parent;
                    weaponDef = av.weaponDef;
                } else if (av.grip) {
                    attachTpWeapon(av.grip);
                }
            }
            fpTune = loadFpTune();
            tpTune = loadTpTune();
            applyTpTuneToOrbit();
            ensureFpViewmodel();
            setFirstPerson(firstPerson);
            buildFpTunerUI();
            buildTpTunerUI();
            if (firstPerson && !fpTune.dismissed) showFpTuner();
            else hideFpTuner();
            if (!firstPerson && !tpTune.dismissed) showTpTuner();
            else hideTpTuner();
            spawnPlayerAtCenter();
            elapsed = 0;
            updateViewHints();
            updateCamera();
            if (firstPerson) requestFpPointerLock();
        }

        function exit() {
            if (!_active) return;
            _active = false;
            hideFpTuner();
            hideTpTuner();
            _resetInput();
            _clearWorld();
            _restoreScene();
            _removeListeners();
        }

        return { enter, exit, tick, updateCamera, mineBlock, placeBlock };
    }

    window.VoxelWorld = VoxelWorld;
})();
