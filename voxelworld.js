/*
 * voxelworld.js — "Asteroid" voxel sandbox mode for PJBoy.
 * Ported from pjboyv2/game-slice.html: procedural asteroid, mine/build, jetpack.
 */
(function () {
    'use strict';
    console.log('[pjboy] voxelworld v215 — flight-sim mouse: held nose attitude, thrust along the nose');

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

        function playSfx(name) {
            if (!g.audio || !g.audio.play) return;
            g.audio.play(name);
        }

        function mineBreakSfx(blockId) {
            const block = blockById(blockId);
            if (block && block.cat === 'Crystals') playSfx('crystalBreak');
            else playSfx('wallBreak');
        }

        function getProfileApi() {
            return typeof AsteroidProfile !== 'undefined' ? AsteroidProfile : null;
        }

        let _profileFlushTimer = null;
        let _suppressProfileBlockSave = false;

        let scene, camera;
        let _saved = null;
        let _listeners = [];
        let _active = false;
        let _cloudUnsub = null, _cloudTimer = null;   // CloudSync HUD subscription + relative-time refresh
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
          water(x,R){ x.clearRect(0,0,32,32);
            x.fillStyle='rgba(38,118,196,.52)'; x.fillRect(0,0,32,32);
            x.fillStyle='rgba(92,172,228,.32)';
            for(let i=0;i<3;i++){ const wy=(R()*30)|0; x.fillRect(0,wy,32,2); }        // ripples
            x.fillStyle='rgba(225,245,255,.22)';
            for(let i=0;i<5;i++) x.fillRect((R()*30)|0,(R()*30)|0,2,1); },             // sparkle
          lamp(x,R){ grain(x,0x5a5040,.12,R,2);
            // Bright self-lit panel — reads as glowing even under MeshLambert / night sky.
            x.fillStyle='#ffd878'; x.fillRect(5,5,22,22);
            x.fillStyle='#fff6c8'; x.fillRect(8,8,16,16);
            x.fillStyle='#ffffff'; x.fillRect(12,12,8,8);
            x.fillStyle='rgba(255,255,220,.55)'; x.fillRect(4,4,24,24);
            x.fillStyle='#d0dae4'; [[2,2],[27,2],[2,27],[27,27]].forEach(([bx,by])=>x.fillRect(bx,by,3,3)); },
          door(x,R){ grain(x,0x6a4a2a,.12,R,2);                                 // closed hatch
            x.fillStyle='#3a2a18'; x.fillRect(2,1,28,30);
            x.fillStyle='#8a6238'; x.fillRect(4,3,24,26);
            x.fillStyle='#c4a06a'; x.fillRect(6,5,8,22); x.fillRect(16,5,10,22);
            x.fillStyle='#2a2a2e'; x.fillRect(15,3,2,26);                          // seam
            x.fillStyle='#d8e0e8'; x.fillRect(22,14,3,5); },                       // handle
          door_open(x,R){ grain(x,0x6a4a2a,.1,R,2);                               // open — mostly see-through
            x.clearRect(0,0,32,32);
            x.fillStyle='rgba(58,42,24,.55)'; x.fillRect(0,0,6,32); x.fillRect(26,0,6,32);
            x.fillStyle='#8a6238'; x.fillRect(1,1,4,30); x.fillRect(27,1,4,30);
            x.fillStyle='#d8e0e8'; x.fillRect(2,14,2,4); },
          hull(x,R){ grain(x,0x3a4048,.1,R,4);
            x.fillStyle='rgba(0,0,0,.3)'; x.fillRect(0,15,32,2);
            x.fillStyle='#e8b33b'; x.fillRect(0,28,10,4);
            x.fillStyle='#9aa6b2';
            for(let i=0;i<4;i++){ x.fillRect(3+i*8,4,3,3); x.fillRect(3+i*8,21,3,3); } },
          tnt(x,R){ grain(x,0xb83226,.14,R,2);                                   // red charge, white label band
            x.fillStyle='#f2f2f2'; x.fillRect(0,11,32,10);
            x.fillStyle='rgba(0,0,0,.2)'; x.fillRect(0,11,32,1); x.fillRect(0,20,32,1);
            x.fillStyle='#1c1c1f';                                               // blocky "TNT" glyphs
            x.fillRect(3,13,7,2);  x.fillRect(5,13,3,6);                          // T
            x.fillRect(12,13,2,6); x.fillRect(18,13,2,6);                         // N posts
            x.fillRect(14,15,1,1); x.fillRect(15,16,1,1); x.fillRect(16,17,1,1); x.fillRect(17,18,1,1); // N diagonal
            x.fillRect(22,13,7,2); x.fillRect(24,13,3,6);                         // T
            x.fillStyle='rgba(255,255,255,.12)'; x.fillRect(0,1,32,1);           // top sheen
            for(let i=0;i<3;i++){ x.fillStyle='rgba(0,0,0,.2)'; x.fillRect((R()*28)|0, R()<.5?4:24, 3,2); } },
          tnt_cap(x,R){ grain(x,0x3a3a40,.16,R,2);                               // dark end plate + fuse
            x.fillStyle='#b83226'; x.fillRect(2,2,28,28);
            x.fillStyle='#2a2a30'; x.fillRect(6,6,20,20);
            x.fillStyle='#4a4a52'; x.fillRect(6,6,20,1); x.fillRect(6,6,1,20);
            x.strokeStyle='#c9a24a'; x.lineWidth=2;
            x.beginPath(); x.moveTo(16,16); x.quadraticCurveTo(22,8,26,10); x.stroke();
            x.fillStyle='#ffd24a'; x.fillRect(25,7,3,3); },                       // fuse spark
        
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
          ash(x,R){
            grain(x,0x4a4640,.18,R,2);
            for(let i=0;i<10;i++){ x.fillStyle='rgba(18,16,14,.4)'; x.fillRect((R()*30)|0,(R()*30)|0,2,2); }
            for(let i=0;i<5;i++){ x.fillStyle='rgba(255,120,40,.18)'; x.fillRect((R()*30)|0,(R()*30)|0,1,1); }   // faint embers
          },
          lavaflow(x,R,frame){
            grain(x,0x6a1e08,.25,R,2);
            x.fillStyle='rgba(255,110,28,.55)'; x.fillRect(0,0,32,32);             // molten body
            const off=(frame*8)%32;
            for(let i=0;i<5;i++){                                                  // streaks running downward
              const sx=(i*7+((ihash(i,3,5)*4)|0))%32;
              x.strokeStyle=i%2?'#ffd24a':'#ff7a1e'; x.lineWidth=3;
              x.beginPath(); x.moveTo(sx,(off+i*3)%32); x.lineTo(sx+2,(off+i*3+11)%32); x.stroke();
            }
            for(let i=0;i<4;i++){ const bx=(ihash(i,9,2)*26)|0, by=((ihash(i,4,7)*32+frame*8)%32)|0;
              x.fillStyle='rgba(255,244,180,.85)'; x.fillRect(bx,by,4,5); }         // hot blobs scrolling down
          },
          magma(x,R,frame){
            grain(x,0x241008,.3,R,2);
            x.fillStyle='rgba(16,9,7,.55)'; x.fillRect(0,0,32,32);                 // dark crust
            const p=[.7,1,.85,1][frame];
            for(let i=0;i<5;i++){                                                  // pulsing glowing cracks
              x.strokeStyle=hx(shade(0xff5a1e,p)); x.lineWidth=2;
              const sx=R()*30, sy=R()*30;
              x.beginPath(); x.moveTo(sx,sy); x.lineTo(sx+5+R()*6,sy+4+R()*6); x.stroke();
            }
            x.fillStyle=hx(shade(0xffd24a,p)); for(let i=0;i<3;i++) x.fillRect((R()*28)|0,(R()*28)|0,2,2);
          },
        };
        const NO_BORDER = new Set(['tall_grass','flower_red','flower_yellow','water','door_open',
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
          { id:46, cat:'Crafted', name:'Door', tiles:{all:'door'}, hardness:6, tags:['crafted','door'],
            desc:'A hinged hatch for your base. Aim and press F to open or close it.',
            sci:{formula:'simple machine', mineral:'Hinge + lever', fact:'A door is a lever that turns on a hinge. The handle is farther from the pivot so a small push swings a heavy panel.'} },
          // Open state is world-only — mining always returns a Door. Hidden from backpack/catalog grids.
          { id:47, cat:'Crafted', name:'Door Open', tiles:{all:'door_open'}, hardness:6, tags:['crafted','door'], transparent:true, hidden:true,
            desc:'An open hatch. Walk through, then press F to close it again.',
            sci:{formula:'simple machine', mineral:'Hinge + lever', fact:'When the door swings open the opening is clear space — just like water, it does not block you.'} },
          { id:41, cat:'Crafted', name:'Gate Key', tiles:{all:'crystal'}, hardness:6, tags:['crafted','glows','key'], glowColor:0x4a2a78,
            desc:'A crystal key humming with Ancient power. Bring it to a dormant Star Gate to wake it.',
            sci:{formula:'resonant crystal', mineral:'Tuned crystal', fact:'Crystals can store and release energy at exact frequencies — that is how quartz watches keep time.'} },
        
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
          { id:40, cat:'Terrain', name:'Water',  tiles:{all:'water'},  hardness:1, tags:['natural','liquid'], transparent:true, water:true,
            desc:'Swimmable water. Fills the seas, lakes and rivers — dive in and explore.',
            sci:{formula:'H₂O', mineral:'Water', fact:'The only thing on a planet that is solid, liquid and gas at everyday temperatures — and life needs it.'} },
          { id:42, cat:'Hazards', name:'Lava Flow', tiles:{all:'lavaflow'}, hardness:9, tags:['hazard','glows','liquid','unminable'], animated:true, glowColor:0xff5a14,
            desc:'A living river of molten rock — you cannot mine it, only cross it if you dare.',
            sci:{formula:'molten silicates 900–1200°C', mineral:'Lava', fact:'On a steep slope flowing lava can move faster than you can run. It freezes into black basalt.'} },
          { id:43, cat:'Terrain', name:'Ash', tiles:{all:'ash'}, hardness:1, tags:['natural','volcanic','barren'],
            desc:'Drifts of cooled volcanic ash, soft and grey across the burned plains.',
            sci:{formula:'pulverised rock + glass', mineral:'Volcanic ash', fact:'Ash is tiny shards of rock and glass blasted from a volcano — wind can carry it right around a planet.'} },
          { id:44, cat:'Terrain', name:'Magma Rock', tiles:{all:'magma'}, hardness:7, tags:['natural','volcanic','glows'], animated:true, glowColor:0xff6a1e,
            desc:'Half-cooled crust with fire still glowing in its cracks. Hot underfoot.',
            sci:{formula:'cooling basalt', mineral:'Magma crust', fact:'As lava hardens it grows a dark skin while molten orange rock still glows up through the cracks.'} },

          // ---- Explosive ----
          { id:45, cat:'Crafted', name:'TNT', tiles:{top:'tnt_cap', side:'tnt', bottom:'tnt_cap'}, hardness:3, tags:['crafted','explosive'],
            desc:'Packed explosive charge. Place it, then blow it with the Remote Detonator — or shoot it. Watch out near lava!',
            sci:{formula:'C₇H₅N₃O₆', mineral:'Trinitrotoluene (TNT)', fact:'TNT stores energy in its nitrogen–oxygen bonds. When lit it turns to gas in an instant, and that sudden expansion is the blast. Alfred Nobel made a safer cousin, dynamite, in 1867.'} },
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
        // A large flat-but-vast world: gravity is down (-Y). The world reads as a
        // "planet" through scale + atmosphere (big sky, sun, horizon haze) rather
        // than visible curvature. Heavy fog hides the world edge.
        const H=96, CH=16;
        const SEA_LEVEL = 30;                   // water fills empty cells at/below this
        const WATER = 40;                       // water block id (see BlockRegistry)
        const LAMP_ID = 34;
        const DOOR_CLOSED = 46;                 // placeable / inventory door
        const DOOR_OPEN = 47;                   // non-solid open state (world only)
        function isPassableId(b){ return !b || b === WATER || b === DOOR_OPEN; }
        function isSolidId(b){ return !!b && b !== WATER && b !== DOOR_OPEN; }
        // Streaming, wrapping world: voxel coords are GLOBAL and unbounded in x/z; the
        // terrain is periodic with period WORLD_PERIOD, so walking that far returns you
        // to identical land ("arrive where you started") with no seam. Only the columns
        // within VIEW_R chunks of the player stay loaded/meshed.
        const WORLD_PERIOD = 3072;              // blocks before terrain repeats (must be a multiple of CH)
        let VIEW_R = 14;                        // column-chunks meshed around the player (~fog distance). adjustable via Settings → View distance.
        let KEEP_R = VIEW_R + 2;                // column-chunks kept buffered (margin for border meshing)
        let UNLOAD_R = VIEW_R + 4;              // beyond this, columns are disposed

        // ---- Asteroid player settings (device-global, Settings tab in the drawer) ----
        const VX_SETTINGS_KEY = 'pjboy.voxelSettings.v1';
        const VIEW_DIST_R = { low: 10, med: 14, high: 18, ultra: 28, max: 40 };
        const vxSettings = { sens: 1.0, view: 'first', sound: 0.6, muted: false, peaceful: false, alwaysDay: false, dist: 'med' };
        function loadSettings() {
            try { const r = localStorage.getItem(VX_SETTINGS_KEY); if (r) Object.assign(vxSettings, JSON.parse(r)); } catch (_) {}
            if (!VIEW_DIST_R[vxSettings.dist]) vxSettings.dist = 'med';
            if (vxSettings.view !== 'third') vxSettings.view = 'first';
        }
        function saveSettings() { try { localStorage.setItem(VX_SETTINGS_KEY, JSON.stringify(vxSettings)); } catch (_) {} }
        function applyViewDistance(restream) {
            VIEW_R = VIEW_DIST_R[vxSettings.dist] || 14; KEEP_R = VIEW_R + 2; UNLOAD_R = VIEW_R + 4;
            // haze only the very edge so you see crisp terrain almost all the way out,
            // with just enough fade at the boundary to mask chunk pop-in.
            FOG_FAR = VIEW_R * CH; FOG_NEAR = FOG_FAR * 0.55;
            if (g.scene && g.scene.fog) { g.scene.fog.near = FOG_NEAR; g.scene.fog.far = FOG_FAR; }
            if (restream && _active && typeof resetStreaming === 'function') { resetStreaming(); streamInit(); }
        }
        function applySound() {
            if (!g.audio) return;
            if (g.audio.setVolume) g.audio.setVolume(vxSettings.sound);
            if (g.audio.setEnabled) g.audio.setEnabled(!vxSettings.muted);
        }
        function applySettings() { applySound(); applyViewDistance(false); }
        // Sea level sits at world y=0; a voxel (x,y,z) renders at (x, y-SEA_LEVEL, z).
        const WORLD_OFFSET = new THREE.Vector3(0, -SEA_LEVEL, 0);
        // Back-compat: some code references W/D as "the world span"; with an unbounded
        // world they mean the wrap period.
        const W = WORLD_PERIOD, D = WORLD_PERIOD;

        const _mod = (a,b) => ((a%b)+b)%b;
        const _fdiv = (a,b) => Math.floor(a/b);
        const pmod = (a) => _mod(a, WORLD_PERIOD);          // canonical x/z in [0, WORLD_PERIOD)

        // ---- streaming column-chunk store: "cx,cz" -> Uint8Array(CH*H*CH) ----
        const worldCols = new Map();
        const colMaxY = new Map();              // "cx,cz" -> highest filled voxel (skip empty sky chunks)
        const colKey = (cx,cz) => cx + ',' + cz;
        const cIdx = (lx,y,lz) => (y*CH + lz)*CH + lx;
        function ensureCol(cx,cz){
          const k = colKey(cx,cz);
          let c = worldCols.get(k);
          if(!c){ const r = genColumn(cx,cz); c = r.buf; worldCols.set(k, c); colMaxY.set(k, r.maxY); }
          return c;
        }
        function getBlock(x,y,z){
          if(y<0||y>=H) return 0;
          const cx=_fdiv(x,CH), cz=_fdiv(z,CH);
          const c = worldCols.get(colKey(cx,cz));
          if(c) return c[cIdx(x-cx*CH, y, z-cz*CH)];
          return genBlockSingle(x,y,z);          // fallback for not-yet-loaded columns
        }

        // ---- player edits: stored by CANONICAL position so they repeat each period ----
        const editStore = new Map();             // "ex,y,ez" -> id   (ex,ez in [0,PERIOD))
        const editsByChunk = new Map();          // canonical "ccx,ccz" -> [{x,y,z,id}]
        function recordEdit(x,y,z,id){
          const ex=pmod(x), ez=pmod(z);
          editStore.set(ex+','+y+','+ez, id);
          const ck = _fdiv(ex,CH)+','+_fdiv(ez,CH);
          let arr = editsByChunk.get(ck);
          if(!arr){ arr=[]; editsByChunk.set(ck, arr); }
          const i = arr.findIndex(e => e.x===ex && e.y===y && e.z===ez);
          const row = {x:ex,y,z:ez,id};
          if(i>=0) arr[i]=row; else arr.push(row);
        }

        // THE multiplayer primitive: every world change funnels through here.
        function persistBlockEdit(x, y, z, id) {
            if (_suppressProfileBlockSave) return;
            const AP = getProfileApi();
            if (!AP) return;
            const p = AP.load();
            AP.upsertBlockEdit(p, pmod(x), y, pmod(z), id);   // canonical coords
            AP.save(p);
        }

        function setBlockEvent(x,y,z,id){
          if(y<0||y>=H) return;
          const cx=_fdiv(x,CH), cz=_fdiv(z,CH);
          const c = ensureCol(cx,cz);
          c[cIdx(x-cx*CH, y, z-cz*CH)] = id;
          recordEdit(x,y,z,id);
          registerTntBlock(x,y,z,id);          // keep the live-TNT set in sync for the detonator/lava
          registerLampCell(x,y,z,id);          // keep the lamp light index in sync
          if(id){ const k=colKey(cx,cz); if(y > (colMaxY.get(k)||0)) colMaxY.set(k, y); }
          rebuildChunkAt(x,y,z);               // instant: the column you actually touched
          // x/z borders share faces with the neighbor column — remesh those async (next
          // frame or two) so a single edit never triggers synchronous multi-column rebuilds.
          // (columns are meshed full-height now, so vertical borders need nothing)
          const lx=_mod(x,CH), lz=_mod(z,CH);
          if(lx===0) queueRebuildAt(x-1,y,z); if(lx===CH-1) queueRebuildAt(x+1,y,z);
          if(lz===0) queueRebuildAt(x,y,z-1); if(lz===CH-1) queueRebuildAt(x,y,z+1);
          persistBlockEdit(x, y, z, id);
        }

        // Water seeks its level: after a block is mined below the waterline, flood the
        // connected air pocket (6-connected, never above SEA_LEVEL) with water — but only
        // if that pocket can actually reach the sea. Batched: one profile save + one
        // rebuild pass over the touched chunks so a dig fills smoothly without per-cell lag.
        const _FLOOD_CAP = 4096;
        function floodWaterAfterMine(sx, sy, sz){
          if(sy > SEA_LEVEL) return;                       // mined above the sea: nothing flows
          if(getBlock(sx,sy,sz) !== 0) return;             // not an empty space
          const region = [], seen = new Set();
          const kkey = (x,y,z)=> x+','+y+','+z;
          const stack = [[sx,sy,sz]]; seen.add(kkey(sx,sy,sz));
          let touchesWater = false;
          const NB = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]];
          while(stack.length){
            const cell = stack.pop(); region.push(cell);
            if(region.length > _FLOOD_CAP) return;         // huge cavern/cave system — bail, don't lag
            const x=cell[0], y=cell[1], z=cell[2];
            for(const d of NB){
              const nx=x+d[0], ny=y+d[1], nz=z+d[2];
              if(ny<0 || ny>SEA_LEVEL) continue;           // water can't rise above sea level
              const b = getBlock(nx,ny,nz);
              if(b===WATER){ touchesWater = true; continue; }
              if(b!==0) continue;                          // solid wall bounds the pocket
              const kk = kkey(nx,ny,nz);
              if(seen.has(kk)) continue;
              seen.add(kk); stack.push([nx,ny,nz]);
            }
          }
          if(!touchesWater) return;                        // sealed dry pocket — leave it dry
          const AP = getProfileApi();
          const p = (AP && !_suppressProfileBlockSave) ? AP.load() : null;
          const cols = new Set();
          const addCol = (x,z)=> cols.add(_fdiv(x,CH)+','+_fdiv(z,CH));
          for(const cell of region){
            const x=cell[0], y=cell[1], z=cell[2];
            const cx=_fdiv(x,CH), cz=_fdiv(z,CH);
            const c = ensureCol(cx,cz);
            c[cIdx(x-cx*CH, y, z-cz*CH)] = WATER;
            recordEdit(x,y,z,WATER);
            if(p) AP.upsertBlockEdit(p, pmod(x), y, pmod(z), WATER);
            const k=colKey(cx,cz); if(y>(colMaxY.get(k)||0)) colMaxY.set(k,y);
            addCol(x,z);
            const lx=_mod(x,CH), lz=_mod(z,CH);
            if(lx===0) addCol(x-1,z); if(lx===CH-1) addCol(x+1,z);
            if(lz===0) addCol(x,z-1); if(lz===CH-1) addCol(x,z+1);
          }
          if(p) AP.save(p);
          // Spread the flood remesh across frames so filling a big cavern flows smoothly
          // instead of rebuilding dozens of columns in one synchronous spike.
          for(const ck of cols){ const a=ck.split(','); queueRebuildCol(+a[0],+a[1]); }
        }

        // Resolve the player's current planet → drives SEED, biome theme, atmosphere.
        function loadActivePlanet() {
            const AP = getProfileApi();
            const def = (AP && AP.currentPlanetDef) ? AP.currentPlanetDef(AP.load()) : null;
            if (def) {
                activePlanetId = def.id;
                SEED = def.seed | 0;
                activeBiomeKey = def.biome || 'verdant';
                activeBiome = BIOME_THEMES[def.biome] || BIOME_THEMES.verdant;
                activeSpec = (AP && AP.planetSpec) ? AP.planetSpec(def) : null;
            } else {
                // No profile API (e.g. standalone) — keep a stable random asteroid.
                activePlanetId = null;
                SEED = (Math.random() * 1e9) | 0;
                activeBiomeKey = 'verdant';
                activeBiome = BIOME_THEMES.verdant;
                activeSpec = null;
            }
            applyActiveSpec();
            applyPlanetAtmosphere();
            if (typeof loadWaypoint === 'function') loadWaypoint();   // per-planet waypoint
        }

        // Cache the active spec's generation/physics inputs and merge any custom sky
        // palette over the biome theme. Missing spec → all defaults (no change).
        function applyActiveSpec() {
            const t = activeSpec ? activeSpec.terrain : null;
            const b = activeSpec ? activeSpec.basics : null;
            _mtnMul   = t ? t.mountains   : 1;
            _landBias = t ? t.landBias    : 0;
            _tempBias = t ? t.tempBias    : 0;
            _moistBias= t ? t.moistBias   : 0;
            _oreRich  = t ? t.oreRichness : 1;
            _gravMul  = b ? b.gravity     : 1;
            dayTime = 0.20;   // a fresh planet starts mid-morning
            if (activeSpec && activeSpec.visual && activeSpec.visual.palette) {
                const p = activeSpec.visual.palette;
                activeBiome = Object.assign({}, activeBiome, { sky: p.sky, horizon: p.horizon, sun: p.sun, ground: p.ground });
            }
        }

        // Load saved edits into the canonical edit store; loaded columns pick them up
        // when they generate. Called before the world streams in.
        function loadProfileEdits() {
            editStore.clear();
            editsByChunk.clear();
            const AP = getProfileApi();
            if (!AP) return;
            const p = AP.load();
            const st = AP.planetState ? AP.planetState(p) : null;
            const edits = (st && st.edits) || [];
            for (let i = 0; i < edits.length; i++) {
                const e = edits[i];
                if (e.y < 0 || e.y >= H) continue;
                recordEdit(e.x | 0, e.y | 0, e.z | 0, e.id | 0);
            }
            if (typeof rebuildLampIndexFromEdits === 'function') rebuildLampIndexFromEdits();
        }
        // Overlay any saved edits for the canonical chunk this column maps to.
        function applyEditsToCol(buf, cx, cz){
            const ex0 = pmod(cx*CH), ez0 = pmod(cz*CH);          // CH-aligned (PERIOD % CH === 0)
            const arr = editsByChunk.get(_fdiv(ex0,CH)+','+_fdiv(ez0,CH));
            if(!arr) return;
            for(const e of arr){
                const lx = e.x - ex0, lz = e.z - ez0;
                if(lx>=0 && lx<CH && lz>=0 && lz<CH && e.y>=0 && e.y<H){
                    const ci = cIdx(lx, e.y, lz);
                    // Heal old water-mining holes: water isn't editable anymore, so ignore
                    // any "removed" (air) edit that sits on a generated water cell. Without
                    // this, leftover edits from when water was minable punch holes in the sea.
                    if(e.id === 0 && buf[ci] === WATER) continue;
                    buf[ci] = e.id;
                }
            }
        }

        // On entering a world, pull + merge the cloud save so two devices
        // converge instead of clobbering (see AsteroidProfile.mergeProfiles).
        // Non-blocking: the world first streams from LOCAL edits, then — if the
        // merge added edits to the CURRENT planet — we reload + restream so they
        // appear. The merge never drops local edits, so this can't wipe work.
        function reconcileCloudOnEnter() {
            const CS = window.CloudSync;
            if (!CS || !CS.reconcile) return;
            const AP = getProfileApi();
            if (!AP || !AP.planetState) return;
            const curEditCount = () => {
                try { const st = AP.planetState(AP.load()); return (st && st.edits) ? st.edits.length : 0; }
                catch (_) { return -1; }
            };
            const before = curEditCount();
            CS.reconcile().then((res) => {
                if (!_active || !res || !res.ok || !res.changed) return;
                // The merge may have adopted the OTHER device's inventory / hotbar /
                // owned weapons (mergeProfiles keeps the newer document's). Reload
                // them into the runtime so the exit flush writes the merged values
                // back — otherwise flushProfileState() would overwrite them with this
                // device's stale in-memory copy and silently lose the other's gains.
                loadOwnedWeapons();
                loadHotbarLayout();
                loadInventoryFromProfile();
                renderHotbar();
                // Rebuild the world only if the CURRENT planet actually gained edits.
                if (curEditCount() !== before) {
                    loadProfileEdits();
                    resetStreaming(); streamInit();
                    if (typeof updateJournalHud === 'function') updateJournalHud();
                    if (g.showMessage) g.showMessage('Synced latest from the cloud', 1800);
                }
            }).catch(() => {});
        }

        // ---------- multiplanetary: active planet + biome themes ----------
        // The active planet comes from AsteroidProfile (its catalog supplies the
        // seed + a biome key). A theme only re-skins the *surface* block and the
        // atmosphere tint — the deep geology/ores stay shared so every world reads
        // as the same kind of asteroid. `remap(top, ctx)` returns the surface id;
        // ctx = { bn, icy, rad, h } (h = stable per-column hash). `verdant` has no
        // remap, so the home world generates byte-identically to before.
        const _AST = window.AsteroidStructures;   // world-structures registry (optional)
        let activeBiomeKey = 'verdant';            // current planet's biome key (for structures)
        let activePlanetId = null;
        let activeBiome = null;
        // Active planet spec (template) cached into hot-path numbers; defaults = "no change".
        let activeSpec = null;
        let _mtnMul = 1, _landBias = 0, _tempBias = 0, _moistBias = 0, _oreRich = 1, _gravMul = 1;
        // Each theme carries a daytime sky palette (sky=zenith, horizon=haze/fog,
        // sun=key light) plus the surface remap. `verdant` is the lush home default.
        const BIOME_THEMES = {
          verdant:  { sky:0x4a90e0, horizon:0xbfe0f5, sun:0xfff4e0, ground:0x6a7a4a },
          frost:    { sky:0x7fb4ee, horizon:0xe2eefb, sun:0xeef4ff, ground:0x9fb4c8,
            remap(top, ctx){
              if(ctx.icy > 0.62) return 8;          // ice cores
              return 20;                            // snow blankets everything else
            }
          },
          fungal:   { sky:0x7a5cc0, horizon:0xd6c4ee, sun:0xf3e2ff, ground:0x5a4a68,
            remap(top, ctx){
              if(top===1 || (top>=12 && top<=15)) return ctx.h < 0.5 ? 36 : 13;  // fungal / spore
              if(top===8 || top===20) return 36;    // no ice on a warm living world
              return top;
            }
          },
          desert:   { sky:0x8fb8ee, horizon:0xf0e2c4, sun:0xfff0d2, ground:0x8a7656,
            remap(top, ctx){
              if(top===8 || top===20) return 16;    // dry world: no ice/snow
              if(top===1 || (top>=12 && top<=15) || top===36) return ctx.h < 0.18 ? 19 : 16; // gravel/regolith
              return top;
            }
          },
          volcanic: { sky:0x4a0f08, horizon:0xff5a1e, sun:0xffc23a, ground:0x2a0c08,
            // Ember surface is region-driven in volcanicSurface(); this remap is only a
            // fallback for any path that still routes through the generic top logic.
            remap(top, ctx){
              if(top===8 || top===20) return 18;    // no ice
              if(top===1 || (top>=12 && top<=15) || top===36) return ctx.h < 0.3 ? 44 : 17; // magma / basalt
              return top;
            }
          }
        };
        let FOG_NEAR = 48, FOG_FAR = 200;       // scaled to VIEW_R so View distance is visible (haze hides the streamed edge)

        function _hex(n){ return '#' + (n & 0xffffff).toString(16).padStart(6, '0'); }
        function _mixHex(a, b, t){
          const ar=(a>>16)&255, ag=(a>>8)&255, ab=a&255, br=(b>>16)&255, bg=(b>>8)&255, bb=b&255;
          const r=Math.round(ar+(br-ar)*t), g2=Math.round(ag+(bg-ag)*t), b2=Math.round(ab+(bb-ab)*t);
          return (r<<16)|(g2<<8)|b2;
        }
        const _cl01 = (v)=> v<0?0 : v>1?1 : v;

        // ---------- day / night cycle ----------
        // ~6 min cycle; night window (0.60–0.85) ≈ 90s of real threat time for a 7yo session.
        const DAYNIGHT_ENABLED = true;
        const DAY_LENGTH = 360;                 // seconds for a full day-night cycle
        const NIGHT_SKY=0x0a1430, NIGHT_HORIZON=0x16203c, MOON=0x8a96b8, SUNSET=0xff7a3c;
        let dayTime = 0.20;                     // 0=sunrise .25=noon .5=sunset .75=midnight
        let _skyMark = -1, _dayF = 1;
        let _dayPhase = 'day';                  // day | dusk | night | dawn
        let _nightSpawnLeft = 0, _nightSpawnTimer = 0;

        // Paint the sky gradient for the current sun height; stars + sun/moon glow.
        function buildSkyBackground(sky, horizon, sun, starsA, elev){
          if(!g.scene) return;
          const c=document.createElement('canvas'); c.width=64; c.height=512;
          const x=c.getContext('2d');
          const grd=x.createLinearGradient(0,0,0,512);
          grd.addColorStop(0, _hex(sky));
          grd.addColorStop(0.62, _hex(_mixHex(sky, horizon, 0.55)));
          grd.addColorStop(1, _hex(horizon));
          x.fillStyle=grd; x.fillRect(0,0,64,512);
          if(starsA>0.02){                                       // deterministic starfield at night
            for(let i=0;i<70;i++){
              const sx=(i*53)%64, sy=(i*89)%300, big=(i%9===0);
              x.fillStyle='rgba(255,255,255,'+(starsA*(0.35+(i%5)*0.13)).toFixed(2)+')';
              x.fillRect(sx, sy, big?2:1, big?2:1);
            }
          }
          if(elev>-0.1){                                         // sun/moon glow, rides up/down with elevation
            const gy=Math.max(24, 250 - elev*210);
            const sg=x.createRadialGradient(44,gy,4,44,gy,118);
            const a0=(0.45+_cl01(elev)*0.45).toFixed(2);
            sg.addColorStop(0, 'rgba('+((sun>>16)&255)+','+((sun>>8)&255)+','+(sun&255)+','+a0+')');
            sg.addColorStop(0.35, 'rgba(255,246,224,0.35)');
            sg.addColorStop(1, 'rgba(255,246,224,0)');
            x.fillStyle=sg; x.fillRect(0,0,64,512);
          }
          if(_voxelBg) _voxelBg.dispose();
          _voxelBg = new THREE.CanvasTexture(c);
          g.scene.background = _voxelBg;
        }

        // ---------- skydome: a real celestial sphere around the camera. Replaces the flat
        // screen backdrop so stars live in 3D (rotate as you look around), the sun/moon sit
        // at their true light direction, and a uSpaceF altitude blend dives the atmosphere
        // into starry space when the player flies up. Day/night/sunset/space are all just
        // uniform changes — no canvas repaints. ----------
        let _skyDome=null, _skyMat=null, _baseFogHex=0xbfe0f5;
        const SPACE_DARK=0x05060c;
        const _SPACE_COL=new THREE.Color(SPACE_DARK);
        function buildSkyDome(){
          if(_skyDome || !g.scene) return;
          const geo = new THREE.SphereGeometry(560, 48, 32);
          _skyMat = new THREE.ShaderMaterial({
            side:THREE.BackSide, depthWrite:false, depthTest:false, fog:false,
            uniforms:{
              uTime:{value:0},
              uSunDir:{value:new THREE.Vector3(0.4,0.7,0.3)},
              uSunColor:{value:new THREE.Color(0xfff4e0)},
              uZenith:{value:new THREE.Color(0x3a78b4)},
              uHorizon:{value:new THREE.Color(0xbfe0f5)},
              uNight:{value:new THREE.Color(NIGHT_SKY)},
              uNightHorizon:{value:new THREE.Color(NIGHT_HORIZON)},
              uDayF:{value:1.0}, uSpaceF:{value:0.0},
              uBandN:{value:new THREE.Vector3(0.22,0.93,0.30).normalize()},   // Milky Way tilt
              uP1Dir:{value:new THREE.Vector3(-0.62,0.26,0.74).normalize()}, uP1Col:{value:new THREE.Color(0xffb27a)},
              uP2Dir:{value:new THREE.Vector3(0.55,0.16,-0.82).normalize()}, uP2Col:{value:new THREE.Color(0x8fd0ff)},
            },
            vertexShader:`
              varying vec3 vDir;
              void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
            fragmentShader:`
              precision highp float;
              uniform float uTime, uDayF, uSpaceF;
              uniform vec3 uSunDir, uSunColor, uZenith, uHorizon, uNight, uNightHorizon, uBandN;
              uniform vec3 uP1Dir, uP1Col, uP2Dir, uP2Col;
              varying vec3 vDir;
              float hash13(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
              float vnoise(vec3 p){
                vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
                float n000=hash13(i),n100=hash13(i+vec3(1,0,0)),n010=hash13(i+vec3(0,1,0)),n110=hash13(i+vec3(1,1,0));
                float n001=hash13(i+vec3(0,0,1)),n101=hash13(i+vec3(1,0,1)),n011=hash13(i+vec3(0,1,1)),n111=hash13(i+vec3(1,1,1));
                return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y),f.z);
              }
              float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
              float starLayer(vec3 dir,float scale,float thr){
                vec3 p=dir*scale; vec3 id=floor(p); vec3 f=fract(p)-0.5;
                float h=hash13(id); if(h<thr) return 0.0;
                return smoothstep(0.5,0.0,length(f)*6.0)*((h-thr)/(1.0-thr));
              }
              void main(){
                vec3 dir=normalize(vDir);
                float t=smoothstep(-0.08,0.55,dir.y);
                vec3 day=mix(uHorizon,uZenith,t);
                vec3 night=mix(uNightHorizon,uNight,t);
                vec3 col=mix(night,day,uDayF);
                // dive into space: atmosphere -> near-black vacuum, keep a thin lit planet limb at the horizon
                vec3 space=vec3(0.004,0.006,0.013);
                float limb=exp(-pow(max(dir.y,0.0)/0.05,2.0));
                col=mix(col, space + uHorizon*limb*0.45*uDayF, uSpaceF);
                // stars: visible at night OR in space
                float starVis=clamp(max(1.0-uDayF,uSpaceF),0.0,1.0);
                if(starVis>0.01){
                  float s = starLayer(dir,150.0,0.880) + starLayer(dir,300.0,0.915)*0.8
                          + starLayer(dir,540.0,0.945)*0.6 + starLayer(dir,820.0,0.965)*0.45;
                  float tw = 0.7+0.3*sin(uTime*2.5 + hash13(floor(dir*150.0))*6.2831);
                  float band=1.0-abs(dot(dir,normalize(uBandN)));
                  float mw=smoothstep(0.80,1.0,band)*fbm(dir*4.0+vec3(3.1))*0.6;
                  col += (s*tw*vec3(0.95,0.97,1.0) + mw*vec3(0.55,0.60,0.85))*starVis;
                }
                // sibling worlds: small colored discs (faint by day, bright at night/space)
                float pv=clamp(max(1.0-uDayF*0.7,uSpaceF),0.0,1.0);
                col += smoothstep(0.99965,0.99986,dot(dir,normalize(uP1Dir)))*uP1Col*pv;
                col += smoothstep(0.99975,0.99991,dot(dir,normalize(uP2Dir)))*uP2Col*pv;
                // moon: opposite the sun, pale, mostly at night/space
                vec3 md=normalize(-uSunDir); float mdd=dot(dir,md);
                float moonVis=clamp(max(1.0-uDayF,uSpaceF*0.85),0.0,1.0);
                col += (smoothstep(0.9994,0.99965,mdd)*vec3(0.92,0.93,1.0) + pow(max(mdd,0.0),900.0)*0.5*vec3(0.5,0.55,0.7))*moonVis;
                // sun: sharp disc + atmospheric glow/halo (glow fades to nothing in vacuum)
                vec3 sd=normalize(uSunDir); float sdd=dot(dir,sd);
                float glow=pow(max(sdd,0.0),180.0)*(1.0-uSpaceF*0.85);
                float halo=pow(max(sdd,0.0),12.0)*0.12*(1.0-uSpaceF)*uDayF;
                col += uSunColor*(smoothstep(0.9995,0.99975,sdd)*1.4 + glow*0.7 + halo);
                gl_FragColor=vec4(col,1.0);
              }`,
          });
          _skyDome = new THREE.Mesh(geo, _skyMat);
          _skyDome.renderOrder = -1000;
          _skyDome.frustumCulled = false;
          g.scene.add(_skyDome);
          g.scene.background = null;       // dome replaces the flat backdrop
        }
        // Push day-sky colours + sun to the dome (called from applyDaySky). Theme day colours
        // go to uZenith/uHorizon; the shader does the night + space blends itself via uDayF/uSpaceF.
        function updateSkyColors(skyHex, dayHorizonHex, sunHex, dayF){
          if(!_skyMat) return;
          const u=_skyMat.uniforms;
          u.uZenith.value.setHex(skyHex); u.uHorizon.value.setHex(dayHorizonHex);
          u.uSunColor.value.setHex(sunHex); u.uDayF.value=dayF;
          const Ls=g._voxelLights; if(Ls&&Ls[1]) u.uSunDir.value.copy(Ls[1].position).normalize();
        }
        // Per-frame: follow the camera, advance twinkle, and blend atmosphere->space by altitude.
        const SPACE_Y0=72, SPACE_Y1=148;          // world-Y where space transition starts / completes
        let _mapFade=0;                            // 0..1 star-map presence (crossfades the pinned globe out)
        function updateSky(dt){
          if(!_skyMat) return;
          const u=_skyMat.uniforms; u.uTime.value=elapsed;
          if(_skyDome) _skyDome.position.copy(camera.position);
          const Ls=g._voxelLights; if(Ls&&Ls[1]){ u.uSunDir.value.copy(Ls[1].position).normalize(); u.uSunColor.value.copy(Ls[1].color); }
          const sf=_cl01((player.pos.y - SPACE_Y0)/(SPACE_Y1 - SPACE_Y0));
          u.uSpaceF.value=sf;
          // thin the atmosphere as we climb: push fog out + darken toward space so the world
          // recedes into a shrinking lit disc below instead of a hard fog wall.
          if(g.scene.fog){
            // The fog may open up along the SLANT to the built edge: seen from height h,
            // the boundary of the built disc (radius = the frontier-following FOG_FAR,
            // NOT the VIEW_R build target) sits at sqrt(h² + R²). Capping there means
            // climbing reveals more and more of the world below, but the disc's rim —
            // and any not-yet-built gap — always melts into haze, at every altitude.
            // From space the rim reads as a soft atmosphere limb instead of a hard cut.
            const camH = camera ? Math.max(0, camera.position.y) : 0;
            const slantEdge = Math.sqrt(camH*camH + FOG_FAR*FOG_FAR);
            g.scene.fog.far  = Math.min(FOG_FAR + sf*(1400 - FOG_FAR), slantEdge*0.98);
            g.scene.fog.near = Math.min(FOG_NEAR + sf*60, g.scene.fog.far*0.8);
            g.scene.fog.color.setHex(_baseFogHex).lerp(_SPACE_COL, sf);
          }
          // curved planet globe below: fade in with altitude, sit under the player, face the sun.
          // The star map crossfades it out (the discrete planet body takes over) via _mapFade.
          if(_planetMat){
            const pu=_planetMat.uniforms;
            pu.uOpacity.value = _cl01((sf-0.04)/0.46) * (1-_mapFade); // fades as the star map rises
            if(_planetBody) _planetBody.position.set(camera.position.x, PLANET_SURFACE_Y - PLANET_R, camera.position.z);
            if(Ls&&Ls[1]) pu.uSunDir.value.copy(Ls[1].position).normalize();
            const th=activeBiome||BIOME_THEMES.verdant;
            if(th.ground!=null) pu.uGround.value.setHex(th.ground);
            if(th.sky!=null) pu.uAtmo.value.setHex(th.sky);
          }
          // far plane must cover the draw distance (grows with View distance) and the space globe.
          const baseFar = Math.max(700, VIEW_R*CH + 140);
          const wantFar = baseFar + sf*(3000-baseFar);
          if(Math.abs(camera.far - wantFar) > 2){ camera.far = wantFar; camera.updateProjectionMatrix(); }
        }
        function disposeSkyDome(){
          if(!_skyDome) return;
          g.scene.remove(_skyDome); _skyDome.geometry.dispose(); _skyMat.dispose();
          _skyDome=null; _skyMat=null;
        }

        // ---------- planet body: a big lit sphere below the player so that leaving the
        // surface reads as leaving a real globe (the streamed voxel terrain is only a small
        // flat disc). Procedural land/ocean/ice + atmosphere rim, lit by the scene sun.
        // Fades in with altitude (uSpaceF) so it never clips the ground-level world. ----------
        let _planetBody=null, _planetMat=null;
        const PLANET_R=2200, PLANET_SURFACE_Y=8;        // radius + world-Y of its "sea level"
        function buildPlanetBody(){
          if(_planetBody || !g.scene) return;
          const geo=new THREE.SphereGeometry(PLANET_R, 96, 64);
          const th=activeBiome||BIOME_THEMES.verdant;
          _planetMat=new THREE.ShaderMaterial({
            transparent:true, depthWrite:false, fog:false,
            uniforms:{
              uSunDir:{value:new THREE.Vector3(0.4,0.7,0.3)},
              uGround:{value:new THREE.Color(th.ground!=null?th.ground:0x6a8a4a)},
              uOcean:{value:new THREE.Color(0x163b63)},
              uIce:{value:new THREE.Color(0xeaf3ff)},
              uAtmo:{value:new THREE.Color(th.sky!=null?th.sky:0x4a90e0)},
              uOpacity:{value:0.0},
            },
            vertexShader:`
              varying vec3 vN; varying vec3 vW;
              void main(){ vN=normalize(position); vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
            fragmentShader:`
              precision highp float;
              uniform vec3 uSunDir,uGround,uOcean,uIce,uAtmo; uniform float uOpacity;
              varying vec3 vN; varying vec3 vW;
              float h13(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
              float vn(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
                float a=h13(i),b=h13(i+vec3(1,0,0)),c=h13(i+vec3(0,1,0)),d=h13(i+vec3(1,1,0));
                float e=h13(i+vec3(0,0,1)),g2=h13(i+vec3(1,0,1)),h2=h13(i+vec3(0,1,1)),i2=h13(i+vec3(1,1,1));
                return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g2,f.x),mix(h2,i2,f.x),f.y),f.z); }
              float fbm(vec3 p){ float s=0.0,a=0.5; for(int k=0;k<5;k++){ s+=a*vn(p); p*=2.04; a*=0.5; } return s; }
              void main(){
                vec3 n=normalize(vN);
                float cont=fbm(n*2.3);
                float land=smoothstep(0.48,0.56,cont);
                vec3 surf=mix(uOcean,uGround,land);
                surf=mix(surf, surf*1.16, land*smoothstep(0.60,0.82,fbm(n*6.0)));   // land relief
                float ice=smoothstep(0.80,0.92,abs(n.y));                           // polar caps
                surf=mix(surf,uIce,ice);
                vec3 L=normalize(uSunDir);
                float diff=max(dot(n,L),0.0);
                float lit=0.10+0.98*diff;
                vec3 V=normalize(cameraPosition - vW);
                float rim=pow(1.0-max(dot(n,V),0.0),3.0);                           // atmosphere limb
                vec3 col=surf*lit + uAtmo*rim*(0.45+0.6*diff);
                col += pow(max(dot(reflect(-L,n),V),0.0),30.0)*(1.0-land)*0.4*uAtmo; // ocean sun glint
                gl_FragColor=vec4(col, uOpacity);
              }`,
          });
          _planetBody=new THREE.Mesh(geo,_planetMat);
          _planetBody.renderOrder=-2;          // behind water (1), in front of the star dome
          _planetBody.frustumCulled=false;
          g.scene.add(_planetBody);
        }
        function disposePlanetBody(){
          if(!_planetBody) return;
          g.scene.remove(_planetBody); _planetBody.geometry.dispose(); _planetMat.dispose();
          _planetBody=null; _planetMat=null;
        }

        // Set sky / fog / lights from the current planet palette + time of day.
        function applyDaySky(){
          if(!g.scene) return;
          const th = activeBiome || BIOME_THEMES.verdant;
          const a = dayTime*Math.PI*2, elev = Math.sin(a);
          const dayF = _cl01(elev*2.2 + 0.4);                   // 1 by day, 0 deep night
          const sunsetF = _cl01(1 - Math.abs(elev)/0.32) * _cl01(0.4+elev*4);  // warm only near sunrise/set
          _dayF = dayF;
          let sky = _mixHex(NIGHT_SKY, th.sky!=null?th.sky:0x4a90e0, dayF);
          let horizon = _mixHex(NIGHT_HORIZON, th.horizon!=null?th.horizon:0xbfe0f5, dayF);
          horizon = _mixHex(horizon, SUNSET, sunsetF*0.6);
          let sunCol = _mixHex(MOON, th.sun!=null?th.sun:0xfff4e0, dayF);
          sunCol = _mixHex(sunCol, 0xffb060, sunsetF*0.5);
          _baseFogHex = horizon;        // ground fog target; updateSky() blends this toward space by altitude
          if(g.scene.fog && g.scene.fog.color){ g.scene.fog.color.setHex(horizon); g.scene.fog.near=FOG_NEAR; g.scene.fog.far=FOG_FAR; }
          if(g._voxelLights){
            const [hemi, key, rim] = g._voxelLights;
            if(hemi){ hemi.color.setHex(sky); if(hemi.groundColor) hemi.groundColor.setHex(th.ground||0x6a7a4a); hemi.intensity=0.32+dayF*0.62; }
            if(key){
              key.color.setHex(sunCol); key.intensity=0.16+dayF*0.95;
              const sx=Math.cos(a);
              if(elev>=0) key.position.set(sx*150, elev*150+20, 60);
              else key.position.set(-sx*150, -elev*120+50, -60);   // soft moonlight from above
            }
            if(rim){ rim.color.setHex(horizon); rim.intensity=0.16+dayF*0.12; }
          }
          // Feed the dome: theme DAY colours (it does its own night blend via uDayF) and a
          // sunset-tinted day horizon. No canvas repaint — the dome shader handles everything.
          const dayHorizon = _mixHex(th.horizon!=null?th.horizon:0xbfe0f5, SUNSET, sunsetF*0.6);
          updateSkyColors(th.sky!=null?th.sky:0x4a90e0, dayHorizon, sunCol, dayF);
        }
        // Advance time + refresh sky each frame.
        function _dayNightOn(){
          if (vxSettings.alwaysDay) return false;
          return DAYNIGHT_ENABLED || (activeSpec && activeSpec.visual && activeSpec.visual.dayNight);
        }
        function _dayLenSec(){ return (activeSpec && activeSpec.basics && activeSpec.basics.dayLengthMin) ? activeSpec.basics.dayLengthMin*60 : DAY_LENGTH; }
        function dayPhaseOf(t){
          if(t >= 0.50 && t < 0.60) return 'dusk';
          if(t >= 0.60 && t < 0.85) return 'night';
          if(t >= 0.85 || t < 0.05) return 'dawn';
          return 'day';
        }
        function vxLangMsg(en, da, ms){
          if(!g.showMessage) return;
          g.showMessage((g.language === 'danish') ? da : en, ms || 2800);
        }
        function onDayPhaseChange(from, to){
          if(to === 'dusk'){
            vxLangMsg('Night is coming — find shelter.', 'Natten nærmer sig — find ly.');
          } else if(to === 'night'){
            vxLangMsg('Night falls. Survive until dawn.', 'Natten falder på. Overlev til daggry.');
            _nightSpawnLeft = 2 + ((Math.random() * 2) | 0);   // 2–3 staggered prowlers
            _nightSpawnTimer = 0.5;
          } else if(to === 'dawn'){
            _nightSpawnLeft = 0;
            if(typeof despawnHostiles === 'function') despawnHostiles();
            if(from === 'night' || from === 'dusk'){
              vxLangMsg('You made it through the night!', 'Du klarede natten!');
              // Progress the survive_night survey when the player sees dawn after night.
              try {
                const AP = getProfileApi();
                if (AP && AP.recordSurviveNight) {
                  const { completed, beat } = AP.recordSurviveNight(AP.load());
                  if (typeof updateJournalHud === 'function') updateJournalHud();
                  if (beat) vxLangMsg(beat.en, beat.da, 3600);
                  if (completed && g.showMessage) {
                    g.showMessage('Survey complete: ' + completed.title, 2800);
                  }
                }
              } catch (_) {}
            }
          }
          updateDayChip();
        }
        function updateDayChip(){
          let el = document.getElementById('voxel-day-chip');
          if(!el) return;
          if(!_dayNightOn() || (_dayPhase !== 'dusk' && _dayPhase !== 'night' && _dayPhase !== 'dawn')){
            el.hidden = true; return;
          }
          el.hidden = false;
          const da = g.language === 'danish';
          if(_dayPhase === 'dusk'){ el.textContent = da ? '🌆 Skumring' : '🌆 Dusk'; el.className = 'vx-day-chip vx-day-dusk'; }
          else if(_dayPhase === 'night'){
            // fraction of night remaining (0.60 → 0.85)
            const left = Math.max(0, (0.85 - dayTime) * _dayLenSec());
            const sec = Math.ceil(left);
            el.textContent = (da ? '🌙 Nat · ' : '🌙 Night · ') + sec + 's';
            el.className = 'vx-day-chip vx-day-night';
          } else {
            el.textContent = da ? '🌅 Daggry' : '🌅 Dawn';
            el.className = 'vx-day-chip vx-day-dawn';
          }
        }
        function updateDayNight(dt){
          if(!_dayNightOn()){
            if(_dayPhase !== 'day' || Math.abs(dayTime - 0.25) > 0.001){
              dayTime = 0.25; _dayPhase = 'day'; applyDaySky();
            }
            updateDayChip();
            return;
          }
          dayTime = (dayTime + dt / _dayLenSec()) % 1;
          applyDaySky();
          const phase = dayPhaseOf(dayTime);
          if(phase !== _dayPhase){ const prev = _dayPhase; _dayPhase = phase; onDayPhaseChange(prev, phase); }
          else if(_dayPhase === 'night') updateDayChip();
          if(typeof updateNightSpawner === 'function') updateNightSpawner(dt);
        }
        // Forced full refresh (planet change / enter).
        function applyPlanetAtmosphere(){ _skyMark = -1; applyDaySky(); }

        // ---------- placed Lamp lights + self-lit face overlays (capped, nearest-first) ----------
        // PointLights sit at the block center, so they light the room but not the lamp's own
        // Lambert faces. A MeshBasic overlay (ignores scene lighting) makes the block itself glow.
        const LAMP_LIGHT_CAP = 8;
        const LAMP_REACH = 56;                  // world units — long enough to keep a base lit while exploring nearby
        const LAMP_DECAY = 1.4;                 // gentler than physical (2) so the pool stays warm farther out
        const lampPool = [];                    // { light, face }
        const lampCells = new Map();            // canonical "ex,y,ez" -> {x,y,z} (voxel)
        const _lampNear = [];
        let _lampScanT = 0;
        let _lampFaceGeo = null, _lampFaceMat = null;
        function lampCellKey(x, y, z){ return pmod(x) + ',' + y + ',' + pmod(z); }
        function registerLampCell(x, y, z, id){
          const k = lampCellKey(x, y, z);
          if(id === LAMP_ID) lampCells.set(k, { x: pmod(x), y: y | 0, z: pmod(z) });
          else lampCells.delete(k);
        }
        function rebuildLampIndexFromEdits(){
          lampCells.clear();
          for(const [k, id] of editStore){
            if(id !== LAMP_ID) continue;
            const p = k.split(',');
            lampCells.set(k, { x: +p[0], y: +p[1], z: +p[2] });
          }
        }
        function ensureLampLights(){
          if(!scene) return;
          if(!_lampFaceGeo) _lampFaceGeo = new THREE.BoxGeometry(1.02, 1.02, 1.02);
          if(!_lampFaceMat){
            const tex = new THREE.CanvasTexture(paintTile('lamp'));
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.NearestFilter;
            _lampFaceMat = new THREE.MeshBasicMaterial({ map: tex });
          }
          while(lampPool.length < LAMP_LIGHT_CAP){
            const light = new THREE.PointLight(0xffe2a0, 0, LAMP_REACH, LAMP_DECAY);
            light.visible = false;
            const face = new THREE.Mesh(_lampFaceGeo, _lampFaceMat);
            face.visible = false;
            face.renderOrder = 1;
            scene.add(light, face);
            lampPool.push({ light, face });
          }
        }
        function disposeLampLights(){
          for(const e of lampPool){
            if(e.light.parent) e.light.parent.remove(e.light);
            if(e.face.parent) e.face.parent.remove(e.face);
          }
          lampPool.length = 0;
          _lampNear.length = 0;
          lampCells.clear();
          if(_lampFaceGeo){ _lampFaceGeo.dispose(); _lampFaceGeo = null; }
          if(_lampFaceMat){
            if(_lampFaceMat.map) _lampFaceMat.map.dispose();
            _lampFaceMat.dispose(); _lampFaceMat = null;
          }
        }
        // Map a canonical edit coord onto the period copy nearest the player so lights
        // track correctly when the world wraps.
        function lampWorldNearPlayer(cell, px, pz){
          let x = cell.x, z = cell.z;
          const dx0 = x - px, dz0 = z - pz;
          if(dx0 > WORLD_PERIOD * 0.5) x -= WORLD_PERIOD;
          else if(dx0 < -WORLD_PERIOD * 0.5) x += WORLD_PERIOD;
          if(dz0 > WORLD_PERIOD * 0.5) z -= WORLD_PERIOD;
          else if(dz0 < -WORLD_PERIOD * 0.5) z += WORLD_PERIOD;
          return { x, y: cell.y, z };
        }
        function updateLampLights(dt){
          if(!scene || !player) return;
          ensureLampLights();
          _lampScanT -= dt;
          if(_lampScanT <= 0){
            _lampScanT = 0.25;
            _lampNear.length = 0;
            const ox = WORLD_OFFSET.x, oy = WORLD_OFFSET.y, oz = WORLD_OFFSET.z;
            const px = player.pos.x - ox, py = player.pos.y - oy, pz = player.pos.z - oz;
            const reach2 = LAMP_REACH * LAMP_REACH;
            for(const cell of lampCells.values()){
              const w = lampWorldNearPlayer(cell, px, pz);
              const dx = (w.x + 0.5) - px, dy = (w.y + 0.5) - py, dz = (w.z + 0.5) - pz;
              const d2 = dx*dx + dy*dy + dz*dz;
              if(d2 > reach2) continue;
              _lampNear.push({ x: w.x, y: w.y, z: w.z, d2 });
            }
            _lampNear.sort((a, b) => a.d2 - b.d2);
          }
          const nightBoost = 1.25 + (1 - _dayF) * 1.1;
          for(let i = 0; i < LAMP_LIGHT_CAP; i++){
            const e = lampPool[i];
            const src = _lampNear[i];
            if(!src){
              e.light.visible = false; e.light.intensity = 0;
              e.face.visible = false;
              continue;
            }
            const wx = src.x + 0.5 + WORLD_OFFSET.x;
            const wy = src.y + 0.5 + WORLD_OFFSET.y;
            const wz = src.z + 0.5 + WORLD_OFFSET.z;
            e.light.visible = true;
            e.light.intensity = nightBoost;
            e.light.distance = LAMP_REACH;
            e.light.decay = LAMP_DECAY;
            e.light.position.set(wx, wy, wz);
            // Self-lit shell so the block stays bright even when the PointLight is inside it.
            e.face.visible = true;
            e.face.position.set(wx, wy, wz);
          }
        }

        // ---------- drifting cloud layer ----------
        const CLOUDS_ENABLED = false;           // master switch — flip to true to show clouds
        let cloudMesh=null, _cloudTex=null;
        function buildCloudTexture(){
          const c=document.createElement('canvas'); c.width=c.height=256; const x=c.getContext('2d');
          for(let i=0;i<26;i++){
            const cx=Math.random()*256, cy=Math.random()*256, r=14+Math.random()*30;
            const gr=x.createRadialGradient(cx,cy,2,cx,cy,r);
            gr.addColorStop(0,'rgba(255,255,255,0.92)'); gr.addColorStop(1,'rgba(255,255,255,0)');
            x.fillStyle=gr; x.fillRect(cx-r,cy-r,r*2,r*2);
          }
          const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(4,4); return t;
        }
        function buildClouds(){
          if(!CLOUDS_ENABLED || cloudMesh || !g.scene) return;
          _cloudTex=buildCloudTexture();
          const mat=new THREE.MeshBasicMaterial({ map:_cloudTex, transparent:true, opacity:0.72, depthWrite:false, fog:false, side:THREE.DoubleSide });
          cloudMesh=new THREE.Mesh(new THREE.PlaneGeometry(900,900), mat);
          cloudMesh.rotation.x=-Math.PI/2; cloudMesh.position.y=62;
          g.scene.add(cloudMesh);
        }
        function updateClouds(dt){
          if(!cloudMesh) return;
          cloudMesh.position.x=player.pos.x; cloudMesh.position.z=player.pos.z;
          if(_cloudTex){ _cloudTex.offset.x += dt*0.004; _cloudTex.offset.y += dt*0.0022; }
          const tint=_mixHex(0x39435e, 0xffffff, _dayF);     // clouds darken at night
          cloudMesh.material.color.setHex(tint);
        }
        function disposeClouds(){
          if(!cloudMesh) return;
          g.scene.remove(cloudMesh); cloudMesh.geometry.dispose(); cloudMesh.material.dispose();
          if(_cloudTex) _cloudTex.dispose();
          cloudMesh=null; _cloudTex=null;
        }

        // ---------- realistic sea: the water surface is meshed per-chunk (top faces of
        // surface water cells) so it's contained exactly to the shoreline; the Gerstner
        // ShaderMaterial (matWater) animates it. This updater drives its uniforms each
        // frame — locking the sun glint / sky reflection to the scene's live lighting so
        // day/night and sunset carry over. ----------
        const _seaSky=new THREE.Color(0x8fc4ec);
        function updateWater(dt){
          if(!matWater || !matWater.uniforms) return;
          const u = matWater.uniforms;
          u.uTime.value = elapsed;
          const Ls = g._voxelLights;
          if(Ls && Ls[1]){ u.uSunDir.value.copy(Ls[1].position).normalize(); u.uSunColor.value.copy(Ls[1].color); }
          const th = activeBiome || BIOME_THEMES.verdant;
          if(th && th.sky!=null) u.uSkyColor.value.copy(_seaSky.setHex(th.sky));
          if(g.scene.fog && g.scene.fog.color){ u.uHorizonColor.value.copy(g.scene.fog.color); u.fogColor.value.copy(g.scene.fog.color); u.fogNear.value=g.scene.fog.near; u.fogFar.value=g.scene.fog.far; }
        }

        // ---------- deterministic worldgen: same seed = same world ----------
        // A large flat heightmap world: continents + hills + ridged mountains, with
        // biomes by temperature/moisture, oceans/lakes filled to SEA_LEVEL, ore veins
        // underground and trees on grass. Per-planet biome themes still re-skin it.
        // ---------- procedural, periodic worldgen (streamed per column-chunk) ----------
        // Periodic value noise: lattice indices wrap every `per` cells so the field
        // tiles seamlessly over WORLD_PERIOD blocks. `chan` picks an independent field.
        function _wrapL(i, per){ return ((i % per) + per) % per; }
        function pvnoise2(fx, fz, per, chan){
          const xi=Math.floor(fx), zi=Math.floor(fz);
          const tx=smooth(fx-xi), tz=smooth(fz-zi);
          const c=(dx,dz)=> ihash(_wrapL(xi+dx,per), chan, _wrapL(zi+dz,per));
          return lerp(lerp(c(0,0),c(1,0),tx), lerp(c(0,1),c(1,1),tx), tz);
        }
        // Periodic fbm; cells0 = lattice cells across the whole period at octave 0
        // (feature size ≈ WORLD_PERIOD / cells0 blocks). Stays periodic across octaves.
        function pfbm2(x, z, chan, cells0, octaves){
          octaves = octaves || 3;
          let sum=0, amp=1, norm=0, f=cells0/WORLD_PERIOD, per=cells0;
          for(let o=0;o<octaves;o++){
            sum += pvnoise2(x*f, z*f, per, chan + o*131) * amp;
            norm += amp; amp*=0.5; f*=2; per*=2;
          }
          return sum/norm;
        }
        function pvnoise3(fx, fy, fz, per, chan){
          const xi=Math.floor(fx), yi=Math.floor(fy), zi=Math.floor(fz);
          const tx=smooth(fx-xi), ty=smooth(fy-yi), tz=smooth(fz-zi);
          const c=(dx,dy,dz)=> ihash(_wrapL(xi+dx,per), chan+(yi+dy)*1313, _wrapL(zi+dz,per));
          return lerp(
            lerp(lerp(c(0,0,0),c(1,0,0),tx), lerp(c(0,1,0),c(1,1,0),tx), ty),
            lerp(lerp(c(0,0,1),c(1,0,1),tx), lerp(c(0,1,1),c(1,1,1),tx), ty), tz);
        }

        // Ember macro fields — two slow, continuous noise fields that drive BOTH the
        // terrain height and the region kind, so terrain and materials always agree.
        //   rA: a single elevation gradient   basin(low) → flats → highland → peak(high)
        //   rB: a plateau field that raises gentle ruin mesas in the mid elevations
        // Because everything is a continuous function of rA/rB, zone borders are smooth
        // ramps, not cliff walls — the world flows instead of jumping.
        function volcField(x, z){
          return { rA: pfbm2(x,z, 13000, 10, 2), rB: pfbm2(x,z, 17000, 11, 2) };  // ~300-block zones — close, frequent variety
        }
        // Region kind for surface/structure decisions — thresholds on the SAME rA/rB
        // used by the height field, so a 'peak' really is the high ground, etc.
        function volcRegion(x, z){
          const f = volcField(x,z);
          if(f.rA > 0.74) return { k:'peak',     e:(f.rA-0.74)/0.26 };  // volcano cores
          if(f.rA > 0.58) return { k:'highland', e:(f.rA-0.58)/0.16 };  // rugged basalt approaches
          if(f.rA < 0.32) return { k:'lake',     e:(0.32-f.rA)/0.32 };  // lava-pool basins
          if(f.rB > 0.60) return { k:'ruin',     e:(f.rB-0.60)/0.40 };  // ruin mesas
          return { k:'ash', e:0 };                                       // calm connective flats
        }

        // Periodic terrain height for a column (continents + hills + ridged mountains).
        function columnHeight(x, z){
          const cont = pfbm2(x,z, 1000, 16, 3);                  // broad continents (~192-block)
          const hill = pfbm2(x,z, 3000, 64, 2);                  // rolling hills (~48-block)
          const ridge= 1-Math.abs(2*pfbm2(x,z, 5000, 32, 2)-1);  // mountain ridges (~96-block)
          // Centre terrain around sea level so basins dip BELOW it and fill with water
          // (coasts, lakes, oceans). landBias shifts a world wetter (−) or drier (+).
          let hh = SEA_LEVEL + 4 + _landBias + (cont-0.5)*44 + (hill-0.5)*9 + ridge*ridge*ridge*26*_mtnMul;
          if(activeBiomeKey === 'volcanic'){
            const { rA, rB } = volcField(x,z);
            // continuous macro elevation: one smooth ramp basin → flats → highland
            const base = (rA < 0.40)
              ? lerp(SEA_LEVEL-14, SEA_LEVEL+4,  smooth(rA/0.40))
              : lerp(SEA_LEVEL+4,  SEA_LEVEL+28, smooth((rA-0.40)/0.60));   // leave headroom for volcanoes
            // relief at several scales so nothing is flat — rolling everywhere, rugged up high
            const reliefAmp = lerp(6, 16, smooth(rA));
            const rug = ridge*ridge * 20 * smooth(_cl01((rA-0.42)/0.34)) * _mtnMul;        // ridged highlands
            const hum = (pfbm2(x,z, 9100, 30, 2)-0.5) * lerp(3, 9, smooth(rA));            // hummocks (~100-block)
            // ruin mesas: smooth raised, flattened top, sloped sides (mid elevations)
            const plateau = smooth(_cl01((rB-0.55)/0.12)) * smooth(_cl01((0.62-Math.abs(rA-0.46))/0.18));
            hh = base + (hill-0.5)*reliefAmp*(1-0.7*plateau) + rug + hum*(1-0.6*plateau) + plateau*12;
          }
          return Math.max(1, Math.min(H-4, Math.round(hh)));
        }
        // How many solid blocks to keep above a cave: thick on flat ground (no surprise
        // holes), thin on steep cliff faces so caves open as visible "mouths" you can
        // spot and walk into.
        function caveRoof(x, z, height){
          const e=3;
          const drop = Math.max(
            height-columnHeight(x+e,z), height-columnHeight(x-e,z),
            height-columnHeight(x,z+e), height-columnHeight(x,z-e));
          return drop>=6 ? 2 : 5;     // ≥6-block cliff → cave mouths; otherwise solid roof
        }

        // Local steepness of the surface (max neighbour height delta) — used to keep
        // glow on the genuine cracks/cliffs, so magma reads as coherent seams in the
        // rock rather than random speckle.
        function surfaceSlope(x, z, height){
          const e = 2;
          return Math.max(
            Math.abs(height-columnHeight(x+e,z)), Math.abs(height-columnHeight(x-e,z)),
            Math.abs(height-columnHeight(x,z+e)), Math.abs(height-columnHeight(x,z-e)));
        }
        // Ember surface block — coherent material fields, not per-block speckle. Calm
        // basalt dominates; magma glows only along steep "heat seams"; obsidian caps the
        // high peaks; ash carpets the low flats. Lava seas are filled in genColumn.
        function volcanicSurface(x, z, height){
          const { rA, rB } = volcField(x,z);
          const slope = surfaceSlope(x,z,height);
          // a ridged field → continuous glowing cracks that follow the terrain
          const seam = 1 - Math.abs(2*pfbm2(x,z, 21000, 22, 2) - 1);
          if(rA < 0.30) return height >= SEA_LEVEL-2 ? 43 : 17;        // basin: ash shore over basalt (lava fills the core)
          if(rA > 0.62){                                               // highlands & peaks
            if(rA > 0.78 && height >= SEA_LEVEL+30 && slope >= 3) return 21;  // obsidian summit caps
            if(seam > 0.84 && slope >= 2) return 44;                          // glowing magma seams in steep rock
            return 17;                                                        // calm basalt (dominant)
          }
          if(rB > 0.60) return slope >= 3 ? 17 : 21;                  // ruin mesa: basalt sides, obsidian crown
          return seam > 0.93 ? 44 : 43;                               // ash flats with rare magma fissures
        }

        // Deterministic, periodic surface profile (height + surface block) for a column.
        function columnProfile(x, z){
          const SEA=SEA_LEVEL;
          const height = columnHeight(x,z);
          if(activeBiomeKey === 'volcanic') return { height, top: volcanicSurface(x,z,height) };
          const temp  = pfbm2(x,z, 7000, 12, 2) + _tempBias;    // warmth (~256-block regions)
          const moist = pfbm2(x,z, 9000, 12, 2) + _moistBias;   // wetness
          let top = 1;                                           // grass
          if(temp<0.40) top = 20;                                // tundra / snow
          else if(moist<0.34 && temp>0.60) top = 4;              // desert sand
          else if(moist>0.70) top = (temp>0.55)?12:13;           // lush alien frond / spore
          else if(moist>0.55 && temp>0.62) top = 15;             // golden plume meadows
          else if(moist>0.50 && temp<0.46) top = 14;             // glowing quill (cool & damp)
          if(height>=SEA+22 && temp<0.5) top = 20;               // snowy peaks
          else if(height>=SEA+28) top = 16;                      // bare rock high up
          if(height<=SEA+1) top = 4;                             // sandy shore
          if(top===1 && ihash(pmod(x),7,pmod(z))<0.04) top = 2;  // dirt patches
          const icy=(temp<0.40?0.85:0) + (pfbm2(x,z,11000,48,2)-0.5)*0.4;
          if(activeBiome && activeBiome.remap) top = activeBiome.remap(top, {bn:moist, icy, rad:0, h:ihash(pmod(x),0,pmod(z))});
          if(height<SEA && (top===1||top===20||(top>=12&&top<=15)||top===36)) top = 4;   // underwater bed → sand
          return { height, top };
        }

        // Ore / deep-rock variant for a sub-surface voxel; 0 → plain stone.
        function oreAt(x, y, z){
          if(y<4) return 17;                                     // basalt floor
          if(y<=7 && pvnoise3(x*0.14,y*0.14,z*0.14,96,511)>0.82) return 11;  // energy: raw plasma trapped deep near the molten core
          const n = pvnoise3(x*0.16, y*0.16, z*0.16, 96, 210);
          const thr = 1 - 0.14*_oreRich;                         // richer planet → lower threshold → more ore
          if(n>thr){
            if(y<=8) return 28; if(y<=14) return 25; if(y<=18) return 24;
            if(y<=SEA_LEVEL-4) return 23; if(y<=SEA_LEVEL) return 22; return 27;
          }
          if(n>(1-0.20*_oreRich) && y>=6 && y<=SEA_LEVEL-2) return 9;   // aether band
          if(y<5 && pvnoise3(x*0.15,y*0.15,z*0.15,96,300)>0.72) return 38;  // lava pocket
          return 0;
        }

        // Carve underground caves — winding tunnels + occasional caverns, periodic so
        // they tile seamlessly. Leaves the surface + dirt layer intact (dig to reach).
        function caveAt(x, y, z){
          if(y<2) return false;                                  // keep a floor above bedrock
          const n = pvnoise3(x*0.08, y*0.12, z*0.08, 48, 410);
          if(Math.abs(n-0.5) < 0.05) return true;                // thin sheet → winding tunnels
          if(pvnoise3(x*0.05, y*0.07, z*0.05, 32, 420) > 0.86) return true;  // round caverns
          return false;
        }

        // Crystal formations line the CEILINGS of deep caves: a solid cell whose neighbour
        // directly below is carved open "hangs" into the void (matches the codex — amethyst
        // is "violet formations hanging from the underside of worlds"). Clustered by a slow
        // noise so they grow as patches, not scattered confetti, and periodic (pvnoise3/pmod)
        // so it tiles seamlessly with the wrapping world. Deeper caves grow rarer, more
        // exotic species: amethyst (10) up high, emerald (29) mid, void crystal (30) near
        // bedrock. Returns a crystal block id, or 0 for "not a crystal here".
        function crystalAt(x, y, z, height, roof){
          if(y < 4 || y > height-10) return 0;                     // genuinely underground, above the basalt floor
          const yb = y-1;                                          // the cell directly beneath us
          if(!(yb <= height-roof && caveAt(x, yb, z))) return 0;   // needs an open cave below → this is a ceiling
          if(pvnoise3(x*0.12, y*0.12, z*0.12, 64, 515) < 0.74) return 0;   // only the densest patches crystallize
          const pick = ihash(pmod(x), y*17+3, pmod(z));            // species roll, deterministic per cell
          if(y <= 8)  return pick > 0.72 ? 30 : (pick > 0.42 ? 29 : 10);   // deep: void / emerald / amethyst
          if(y <= 16) return pick > 0.70 ? 29 : 10;                        // mid: emerald / amethyst
          return 10;                                                        // upper caves: amethyst
        }

        // Cobalt blooms cling to the FLOORS and lower walls of caves (codex: "deep-blue
        // blooms found only on cave walls") — the counterpart to ceiling crystals: a solid
        // cell with an open cave directly ABOVE it. Same cheap same-column gate as crystals,
        // clustered + periodic. Returns block id 26 (Cobalt) or 0.
        function cobaltAt(x, y, z, height, roof){
          if(y < 4 || y > height-8) return 0;                      // underground, below the dirt cap
          const ya = y+1;                                          // the cell directly above us
          if(!(ya <= height-roof && caveAt(x, ya, z))) return 0;   // needs an open cave above → this is a floor/wall
          if(pvnoise3(x*0.11, y*0.11, z*0.11, 64, 611) < 0.80) return 0;   // sparse blue blooms, in patches
          return 26;
        }

        // Hive nests — rare pockets of living amber comb embedded in the rock (codex:
        // "organic nests hidden underground … something built this"). Tight, uncommon
        // clusters you mine into and discover; no cave needed. Returns block id 37 or 0.
        function hiveAt(x, y, z, height){
          if(y < 5 || y > height-8) return 0;                      // hidden underground, off the surface
          if(pvnoise3(x*0.09, y*0.09, z*0.09, 64, 711) < 0.90) return 0;   // rare, tightly clustered nests
          return 37;
        }

        // Acid pools settle on cave FLOORS underground (codex: "in pools on cave floors").
        // Called for a carved cave cell (would be air): true → fill it with Acid (39)
        // instead of leaving it open. Only the bottom cell of a cave (solid rock beneath)
        // pools, so it reads as a shallow puddle, not a filled shaft. Clustered + periodic.
        function acidPool(x, y, z, height, roof){
          if(y > height-8) return false;                           // deep caves only, not shallow mouths
          const yb = y-1, ya = y+1;
          if(yb <= height-roof && caveAt(x, yb, z)) return false;  // open cave below → not a floor
          if(!(ya <= height-roof && caveAt(x, ya, z))) return false; // need open headroom above → a real pool, never a plugged 1-cell tunnel
          return pvnoise3(x*0.10, y*0.10, z*0.10, 64, 811) > 0.84; // pool patches on the floor
        }

        // A grass column above water, sparsely chosen by a periodic hash.
        function isTreeRoot(x, z){
          if(ihash(pmod(x), 999, pmod(z)) > 0.012) return false;
          const p = columnProfile(x,z);
          return p.height > SEA_LEVEL && (p.top===1 || p.top===12 || p.top===13);
        }

        // Giant toadstools dotting the fungal world (Mycelia). Deterministic + periodic:
        // one candidate per coarse grid cell, kept on dry land. Returns null unless (x,z)
        // is the exact root column of a mushroom, else its build params.
        const SHROOM_GRID = 48;                     // divides WORLD_PERIOD → seamless wrap
        function giantShroom(x, z){
          if(activeBiomeKey !== 'fungal') return null;
          const px = pmod(x), pz = pmod(z);
          const gx = Math.floor(px/SHROOM_GRID), gz = Math.floor(pz/SHROOM_GRID);
          if(ihash(gx, 701, gz) > 0.45) return null;                 // ~45% of cells host one
          const ox = 7 + ((ihash(gx, 13, gz)*(SHROOM_GRID-14))|0);   // keep root off the cell edge
          const oz = 7 + ((ihash(gx, 27, gz)*(SHROOM_GRID-14))|0);
          if(px !== gx*SHROOM_GRID+ox || pz !== gz*SHROOM_GRID+oz) return null;
          const p = columnProfile(px, pz);
          if(p.height <= SEA_LEVEL+1) return null;                   // dry land only
          const stemH = 9 + ((ihash(gx, 99, gz)*6)|0);              // 9..14 tall
          const capR  = 4 + ((ihash(gx, 55, gz)*3)|0);              // 4..6 cap radius
          return { ground: p.height, stemH, capR };
        }

        // Single-voxel generation (fallback for getBlock outside loaded columns).
        function genBlockSingle(x,y,z){
          const e = editStore.get(pmod(x)+','+y+','+pmod(z));
          if(e!==undefined) return e;
          const p = columnProfile(x,z);
          if(y > p.height) return (p.height < SEA_LEVEL && y <= SEA_LEVEL) ? WATER : 0;
          if(y === p.height) return p.top;
          const roof = caveRoof(x,z,p.height);
          if(y < p.height && y <= p.height-roof && caveAt(x,y,z)) return acidPool(x,y,z,p.height,roof) ? 39 : 0;  // acid puddle or open cave
          if(y >= p.height-4) return 2;
          return crystalAt(x,y,z,p.height,roof) || cobaltAt(x,y,z,p.height,roof) || hiveAt(x,y,z,p.height) || oreAt(x,y,z) || 3;
        }

        // Generate one column-chunk buffer: terrain + ores + water + trees + edits.
        function genColumn(cx, cz){
          const buf = new Uint8Array(CH*H*CH);
          const x0=cx*CH, z0=cz*CH;
          let maxY = 0;
          for(let lx=0;lx<CH;lx++) for(let lz=0;lz<CH;lz++){
            const x=x0+lx, z=z0+lz;
            const p = columnProfile(x,z);
            const roof = caveRoof(x,z,p.height);
            for(let y=0;y<=p.height;y++){
              let id;
              if(y===p.height) id=p.top;
              else if(y<=p.height-roof && caveAt(x,y,z)){
                if(!acidPool(x,y,z,p.height,roof)) continue;        // open cave
                id = 39;                                            // acid puddle on the cave floor
              }
              else if(y>=p.height-4) id=2;
              else id = crystalAt(x,y,z,p.height,roof) || cobaltAt(x,y,z,p.height,roof) || hiveAt(x,y,z,p.height) || oreAt(x,y,z) || 3;
              buf[cIdx(lx,y,lz)] = id;
            }
            const _isVolc = activeBiomeKey === 'volcanic';
            // Volcanic: only genuine basins (a few blocks below the lava line) pool with
            // lava, so seas read as deliberate lakes — not a glow smeared over every dip.
            const _fillTop = _isVolc ? (SEA_LEVEL-3) : SEA_LEVEL;
            if(p.height < _fillTop){
              const fluid = _isVolc ? 42 : WATER;                  // 42 = unminable Lava Flow
              for(let y=p.height+1; y<=_fillTop; y++) buf[cIdx(lx,y,lz)] = fluid;
            }
            const colTop = Math.max(p.height, p.height<_fillTop?_fillTop:0);
            if(colTop>maxY) maxY=colTop;
          }
          // trees: consider roots in a 2-block margin so canopies overhang borders
          for(let rx=x0-2; rx<x0+CH+2; rx++) for(let rz=z0-2; rz<z0+CH+2; rz++){
            if(!isTreeRoot(rx,rz)) continue;
            const ph = columnProfile(rx,rz).height;
            const th = 3 + ((ihash(pmod(rx),1234,pmod(rz))*4)|0)%3;
            if(ph+th+2>maxY) maxY = Math.min(H-1, ph+th+2);
            const setAt = (bx,by,bz,id,overwrite)=>{
              if(by<0||by>=H) return;
              const llx=bx-x0, llz=bz-z0;
              if(llx<0||llx>=CH||llz<0||llz>=CH) return;
              if(overwrite || !buf[cIdx(llx,by,llz)]) buf[cIdx(llx,by,llz)] = id;
            };
            for(let i=1;i<=th;i++) setAt(rx, ph+i, rz, 5, true);          // trunk
            const cyTop = ph+th;
            for(let lx2=-2;lx2<=2;lx2++) for(let ly2=0;ly2<=2;ly2++) for(let lz2=-2;lz2<=2;lz2++){
              if(lx2*lx2+lz2*lz2+ly2*ly2>5) continue;
              setAt(rx+lx2, cyTop+ly2, rz+lz2, 6, false);                // canopy
            }
          }
          // Giant mushrooms (Mycelia): white stem, domed red spore-cap with white spots and
          // fungal gills. Wide margin so big caps overhang into neighbouring chunks seamlessly.
          if(activeBiomeKey === 'fungal'){
            const setM = (bx,by,bz,id) => {
              if(by<0||by>=H) return;
              const llx=bx-x0, llz=bz-z0;
              if(llx<0||llx>=CH||llz<0||llz>=CH) return;
              buf[cIdx(llx,by,llz)] = id;
              if(by>maxY) maxY = Math.min(H-1, by);
            };
            for(let rx=x0-8; rx<x0+CH+8; rx++) for(let rz=z0-8; rz<z0+CH+8; rz++){
              const ms = giantShroom(rx, rz);
              if(!ms) continue;
              const gY = ms.ground, capBaseY = gY + ms.stemH, capH = ms.capR;
              for(let sy=1; sy<=ms.stemH; sy++)                            // rounded white stem
                for(let sx=-1;sx<=1;sx++) for(let sz=-1;sz<=1;sz++){
                  if(sx*sx+sz*sz>2) continue;
                  setM(rx+sx, gY+sy, rz+sz, 20);
                }
              const cr2 = ms.capR*ms.capR;
              for(let dx=-ms.capR; dx<=ms.capR; dx++) for(let dz=-ms.capR; dz<=ms.capR; dz++){   // fungal gills under the brim
                const d2 = dx*dx+dz*dz;
                if(d2<=cr2+0.4 && d2>(ms.capR-1.6)*(ms.capR-1.6)) setM(rx+dx, capBaseY-1, rz+dz, 36);
              }
              for(let cy=0; cy<=capH; cy++){                              // domed red spore-cap
                const rr = ms.capR * (1 - cy/(capH+1)), rr2 = rr*rr + 0.4;
                for(let dx=-ms.capR; dx<=ms.capR; dx++) for(let dz=-ms.capR; dz<=ms.capR; dz++){
                  if(dx*dx+dz*dz > rr2) continue;
                  let id = 13;                                            // red cap
                  if(cy>=capH-1 && ihash(pmod(rx+dx), 321, pmod(rz+dz)) > 0.82) id = 20;   // white spots
                  setM(rx+dx, capBaseY+cy, rz+dz, id);
                }
              }
            }
          }
          if(_AST) maxY = stampStructures(buf, cx, cz, x0, z0, maxY);
          applyEditsToCol(buf, cx, cz);
          return { buf, maxY: Math.min(H-1, maxY) };
        }

        // ---------- world structures (ruins / volcanoes / boss lairs) ----------
        // Deterministic per-SEED placement painted into the column buffer, before
        // player edits so mined/built changes always win. Each chunk paints only
        // its own slice of a structure (clipped in the setter); neighbours recompute
        // the same deterministic stamp, so multi-chunk structures assemble seamlessly.
        const _STRUCT_SITE = 96;                    // coarse placement grid (6 chunks)
        let _lairSeedCache = null, _lairPosCache = null;
        // One guaranteed boss lair per world, anchored deterministically near spawn.
        function bossLairPos(){
          if(_lairSeedCache === SEED) return _lairPosCache;
          const ang = ihash(31,41,59) * Math.PI * 2;
          const dist = 90 + ihash(26,53,58) * 90;   // 90..180 blocks from origin
          _lairPosCache = { x: Math.round(Math.cos(ang)*dist), z: Math.round(Math.sin(ang)*dist) };
          _lairSeedCache = SEED;
          return _lairPosCache;
        }
        function stampStructures(buf, cx, cz, x0, z0, curMaxY){
          let mY = curMaxY;
          const setter = (wx, wy, wz, id) => {
            if(wy < 0 || wy >= H) return;
            const llx = wx - x0, llz = wz - z0;
            if(llx < 0 || llx >= CH || llz < 0 || llz >= CH) return;
            buf[cIdx(llx, wy, llz)] = id;
            if(id && wy > mY) mY = wy;
          };
          const ctxFor = (ax, az, ground, seedInt, region) => {
            let s = seedInt >>> 0;
            const rng = () => { s = (Math.imul(s,1664525) + 1013904223) >>> 0; return s/4294967296; };
            return { ground, SEA_LEVEL, H, region: region||null, rng,
              set(dx,dy,dz,id){ setter(ax+dx, dy, az+dz, id); },
              heightAt(dx,dz){ return columnProfile(ax+dx, az+dz).height; } };
          };
          const biome = activeBiomeKey;
          const isVolc = biome === 'volcanic';

          // (1) scattered landmarks on a coarse site grid. On Ember, a structure's
          //     def.region gates it to the matching zone (volcanoes in highlands,
          //     ruins on plateaus), so each region reads as its own place.
          const scatter = _AST.scatterFor(biome);
          if(scatter.length){
            // Ember uses a coarser grid so volcanoes stay well-separated — one grand
            // peak per highland core rather than a cluster of small cones.
            const SITE = isVolc ? 104 : _STRUCT_SITE;                    // closer-together Ember landmarks
            const MARG = isVolc ? 30 : 24;                               // ≥ largest structure reach
            const rollThresh = isVolc ? 0.6 : 0.16;                      // per qualifying (region-gated) cell
            const sx0 = Math.floor((x0 - MARG)/SITE) - 1, sx1 = Math.floor((x0+CH-1+MARG)/SITE);
            const sz0 = Math.floor((z0 - MARG)/SITE) - 1, sz1 = Math.floor((z0+CH-1+MARG)/SITE);
            for(let sx=sx0; sx<=sx1; sx++) for(let sz=sz0; sz<=sz1; sz++){
              if(ihash(sx*2+1, 7001, sz*2+1) >= rollThresh) continue;
              const ax = sx*SITE + Math.floor(ihash(sx, 131, sz)*SITE);
              const az = sz*SITE + Math.floor(ihash(sx, 262, sz)*SITE);
              const ground = columnProfile(ax, az).height;
              if(ground < SEA_LEVEL-2) continue;                          // not in a fluid sea
              const regionK = isVolc ? volcRegion(ax, az).k : null;
              // only structures whose zone matches here (region-less defs go anywhere)
              const eligible = scatter.filter(id => { const d = _AST.get(id); return !d.region || (regionK && d.region.indexOf(regionK) >= 0); });
              if(!eligible.length) continue;
              const def = _AST.get(eligible[Math.floor(ihash(sx, 393, sz)*eligible.length)]);
              if(!def) continue;
              def.stamp(ctxFor(ax, az, ground, Math.floor(ihash(ax, 555, az)*4294967296), regionK));
            }
          }

          // (2) the world boss lair — one per world, guaranteed.
          const lair = _AST.lairFor(biome);
          if(lair){
            const lp = bossLairPos(), reach = lair.footprint || 24;
            if(lp.x+reach >= x0 && lp.x-reach <= x0+CH-1 && lp.z+reach >= z0 && lp.z-reach <= z0+CH-1){
              const ground = columnProfile(lp.x, lp.z).height;
              lair.stamp(ctxFor(lp.x, lp.z, ground, Math.floor(ihash(lp.x, 999, lp.z)*4294967296)));
            }
          }
          return mY;
        }

        // ---------- Ember ambience: falling ash + rising embers (volcanic only) ----------
        let _emberFx = null;
        function initEmberFx(){
          if(_emberFx || !g.scene || typeof THREE === 'undefined') return;
          const N = 170;
          const pos = new Float32Array(N*3), vel = new Float32Array(N*3), kind = new Float32Array(N), col = new Float32Array(N*3);
          for(let i=0;i<N;i++){
            const ember = ihash(i,17,3) < 0.28; kind[i] = ember ? 1 : 0;   // ash-dominant, embers as accent
            pos[i*3]   = (ihash(i,2,9)*2-1)*55;
            pos[i*3+1] = ember ? 2 + ihash(i,5,1)*8 : 40 + ihash(i,8,4)*14;
            pos[i*3+2] = (ihash(i,4,6)*2-1)*55;
            vel[i*3]   = (ihash(i,11,2)*2-1)*0.4;
            vel[i*3+1] = ember ? (0.5 + ihash(i,9,7)*0.9) : -(0.9 + ihash(i,3,8)*1.3);
            vel[i*3+2] = (ihash(i,13,5)*2-1)*0.4;
            if(ember){ col[i*3]=1; col[i*3+1]=0.55; col[i*3+2]=0.16; } else { col[i*3]=0.34; col[i*3+1]=0.30; col[i*3+2]=0.27; }
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
          geo.setAttribute('color', new THREE.BufferAttribute(col,3));
          const mat = new THREE.PointsMaterial({ size:0.42, vertexColors:true, transparent:true, opacity:0.7, depthWrite:false, blending:THREE.AdditiveBlending });
          const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5;
          g.scene.add(pts);
          _emberFx = { pts, geo, mat, pos, vel, kind, N };
        }
        function stepEmberFx(dt){
          if(activeBiomeKey !== 'volcanic'){ if(_emberFx) _emberFx.pts.visible = false; return; }
          if(!_emberFx) initEmberFx();
          if(!_emberFx) return;
          _emberFx.pts.visible = true;
          const { pos, vel, kind, N, geo } = _emberFx;
          const cx = player.pos.x, cz = player.pos.z;
          const step = Math.min(dt, 0.05) * 9;
          for(let i=0;i<N;i++){
            pos[i*3]   += vel[i*3]*step;
            pos[i*3+1] += vel[i*3+1]*step;
            pos[i*3+2] += vel[i*3+2]*step;
            const rx = pos[i*3]-cx, rz = pos[i*3+2]-cz;
            if(pos[i*3+1] < 1 || pos[i*3+1] > 62 || rx*rx+rz*rz > 64*64){
              const salt = ((elapsed*7)|0);
              pos[i*3]   = cx + (ihash((i*7+salt)&1023, 21, 4)*2-1)*52;
              pos[i*3+2] = cz + (ihash((i*5+salt)&1023, 31, 6)*2-1)*52;
              pos[i*3+1] = kind[i] ? 2 + ihash(i,5,1)*6 : 46 + ihash(i,8,4)*12;
            }
          }
          geo.attributes.position.needsUpdate = true;
        }
        function disposeEmberFx(){ if(!_emberFx) return; if(g.scene) g.scene.remove(_emberFx.pts); _emberFx.geo.dispose(); _emberFx.mat.dispose(); _emberFx = null; }

        // Ember is hostile: lava-flow / lava contact burns (forgiving, with its own
        // cooldown so it doesn't fight combat i-frames), and standing right beside it
        // radiates heat. Volcanic worlds only.
        let _lavaBurnT = 0, _heatStingT = 0;
        function updateVolcanicHazard(dt){
          if(activeBiomeKey !== 'volcanic' || flying || player.health <= 0) return;
          const vx = Math.floor(player.pos.x - WORLD_OFFSET.x);
          const vy = Math.floor(player.pos.y - WORLD_OFFSET.y);
          const vz = Math.floor(player.pos.z - WORLD_OFFSET.z);
          const hot = (id)=> id === 38 || id === 42;   // Lava or Lava Flow
          const inLava = hot(getBlock(vx,vy,vz)) || hot(getBlock(vx,vy+1,vz)) || hot(getBlock(vx,vy-1,vz));
          if(inLava){
            _lavaBurnT += dt; player.hurtFlash = Math.max(player.hurtFlash, 0.7); player._noHitT = 0;
            if(_lavaBurnT >= 0.4){
              _lavaBurnT = 0;
              player.health = Math.max(0, player.health - 6);
              updateHealthHud();
              if(player.health <= 0) respawnPlayer();
            }
            return;
          }
          _lavaBurnT = 0;
          // heat radiating from nearby lava → slow chip damage
          let near = false;
          for(let dx=-1; dx<=1 && !near; dx++) for(let dy=-1; dy<=1 && !near; dy++) for(let dz=-1; dz<=1 && !near; dz++)
            if(hot(getBlock(vx+dx, vy+dy, vz+dz))) near = true;
          if(near){ _heatStingT += dt; if(_heatStingT >= 1.2){ _heatStingT = 0; player.health = Math.max(0, player.health-2); player.hurtFlash = Math.max(player.hurtFlash, 0.35); updateHealthHud(); } }
          else _heatStingT = 0;
        }

        // Cave hazards on ANY world: standing in Energy (raw plasma) or Acid (a floor pool)
        // stings — forgiving, on its own cooldown like the lava burn, and you can always
        // just mine the block away. Mirrors updateVolcanicHazard but biome-agnostic.
        // Soft uranium tick teaches "keep distance" without being scary.
        let _caveBurnT = 0, _uraniumT = 0, _uraniumTip = false;
        function updateContactHazard(dt){
          if(flying || player.health <= 0) return;
          const vx = Math.floor(player.pos.x - WORLD_OFFSET.x);
          const vy = Math.floor(player.pos.y - WORLD_OFFSET.y);
          const vz = Math.floor(player.pos.z - WORLD_OFFSET.z);
          const bad = (id)=> id === 11 || id === 39;   // Energy or Acid
          const touching = bad(getBlock(vx,vy,vz)) || bad(getBlock(vx,vy+1,vz)) || bad(getBlock(vx,vy-1,vz));
          if(touching){
            _caveBurnT += dt; player.hurtFlash = Math.max(player.hurtFlash, 0.6); player._noHitT = 0;
            if(_caveBurnT >= 0.5){
              _caveBurnT = 0;
              player.health = Math.max(0, player.health - 5);
              updateHealthHud();
              if(player.health <= 0) respawnPlayer();
            }
          } else _caveBurnT = 0;

          let nearU = false;
          for(let dx=-1; dx<=1 && !nearU; dx++) for(let dy=-1; dy<=1 && !nearU; dy++) for(let dz=-1; dz<=1 && !nearU; dz++)
            if(getBlock(vx+dx, vy+dy, vz+dz) === 28) nearU = true;
          if(nearU){
            _uraniumT += dt;
            if(!_uraniumTip){
              _uraniumTip = true;
              vxLangMsg('Uranium nearby — keep your distance!', 'Uranium i nærheden — hold afstand!', 2800);
            }
            if(_uraniumT >= 1.6){
              _uraniumT = 0;
              player.health = Math.max(0, player.health - 1);
              player.hurtFlash = Math.max(player.hurtFlash, 0.25);
              player._noHitT = 0;
              updateHealthHud();
              if(player.health <= 0) respawnPlayer();
            }
          } else { _uraniumT = 0; _uraniumTip = false; }
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
        // classic 3-neighbor corner occlusion. `read` is an optional fast block
        // reader (defaults to getBlock); buildColumnMesh passes a local 3×3 reader.
        function vertexAO(x,y,z,dir,corner,read){
          read = read || getBlock;
          const a = dir[0]? 0 : (dir[1]? 1:2);          // face axis
          const [b,c] = a===0? [1,2] : a===1? [0,2] : [0,1];
          const n=[dir[0],dir[1],dir[2]];
          const t1=[0,0,0], t2=[0,0,0];
          t1[b]=corner.pos[b]? 1:-1;
          t2[c]=corner.pos[c]? 1:-1;
          const occ = p => read(x+p[0],y+p[1],z+p[2])? 1:0;
          const s1=occ([n[0]+t1[0],n[1]+t1[1],n[2]+t1[2]]);
          const s2=occ([n[0]+t2[0],n[1]+t2[1],n[2]+t2[2]]);
          const co=occ([n[0]+t1[0]+t2[0],n[1]+t1[1]+t2[1],n[2]+t1[2]+t2[2]]);
          const ao = (s1&&s2)? 3 : s1+s2+co;
          return 1 - ao*.18;
        }

        // ---------- greedy meshing (static opaque blocks only) ----------
        // Merges coplanar same-tile, same-lighting block faces into big quads instead of
        // one quad per face — far fewer triangles in flat/open areas (plains, cliffs, cave
        // walls), which is where the GPU was choking. Two constraints make it non-trivial:
        //   1) Atlas tiling: a merged WxH quad must REPEAT its tile, but every block tile
        //      is a sub-rect of one shared atlas. Solved in the shader (matStatic, see
        //      rebuildMaterials): fract() the repeating uv, then map into the tile's arect.
        //   2) Ambient occlusion: faces only merge when their lighting matches, so we only
        //      merge faces whose 4 AO corners are all equal (flat-lit). Edge-lit faces stay
        //      1x1 and keep their exact per-corner shading — look is preserved.
        // Flip GREEDY=false to fall straight back to the proven per-face path above.
        const GREEDY = true;
        // Per face: normal axis n, sign s, and in-plane axes u,v chosen so the quad
        // (u0v0,u1v0,u1v1,u0v1) with tris (0,1,2)+(0,2,3) winds front-facing (eu×ev = s·en).
        const GREEDY_AXES = [
          {n:0,s: 1,u:1,v:2}, {n:0,s:-1,u:2,v:1},
          {n:1,s: 1,u:2,v:0}, {n:1,s:-1,u:0,v:2},
          {n:2,s: 1,u:0,v:1}, {n:2,s:-1,u:1,v:0},
        ];
        function faceBrightDir(dx,dy,dz){ return dx? .8 : (dy>0?1:(dy<0?.5:.7)); }
        // AO at the four physical corners, in (u0v0,u1v0,u1v1,u0v1) order.
        function quadAO(wx,wy,wz, dir, n,u,v, read){
          const baseN = dir[n]>0?1:0;
          const corner=(uu,vv)=>{ const p=[0,0,0]; p[n]=baseN; p[u]=uu; p[v]=vv; return vertexAO(wx,wy,wz,dir,{pos:p},read); };
          return [ corner(0,0), corner(1,0), corner(1,1), corner(0,1) ];
        }
        function greedyStatic(cx,cy,cz, B, read){
          const bx=cx*CH, by=cy*CH, bz=cz*CH;
          const N=CH, dir=[0,0,0], lp=[0,0,0];
          for(const ax of GREEDY_AXES){
            const {n,s,u,v}=ax;
            dir[0]=dir[1]=dir[2]=0; dir[n]=s;
            const fb=faceBrightDir(dir[0],dir[1],dir[2]);
            const planeN = s>0?1:0;
            for(let k=0;k<N;k++){
              const keys=new Array(N*N).fill(null);
              const data=new Array(N*N).fill(null);
              for(let j=0;j<N;j++) for(let i=0;i<N;i++){
                lp[n]=k; lp[u]=i; lp[v]=j;
                const wx=bx+lp[0], wy=by+lp[1], wz=bz+lp[2];
                const id=read(wx,wy,wz);
                if(!id) continue;
                const blk=blockById(id);
                if(blk.animated || blk.transparent) continue;          // static-opaque only
                const nid=read(wx+dir[0],wy+dir[1],wz+dir[2]);
                if(nid && !blockById(nid).transparent) continue;        // hidden by opaque neighbour
                const tile=tileIndex[tileFor(blk,dir)];
                const ao=quadAO(wx,wy,wz,dir,n,u,v,read);
                const uniform = (ao[0]===ao[1] && ao[1]===ao[2] && ao[2]===ao[3]);
                const idx=i+j*N;
                data[idx]={tile,ao,uniform};
                // only flat-lit faces get a merge key; edge-lit faces (key=null) stay 1x1
                if(uniform) keys[idx]=tile.u0+'_'+tile.v0+'_'+ao[0];
              }
              const used=new Array(N*N).fill(false);
              for(let j=0;j<N;j++) for(let i=0;i<N;i++){
                const idx=i+j*N, d=data[idx];
                if(!d || used[idx]) continue;
                let w=1,h=1;
                if(keys[idx]!==null){
                  const key=keys[idx];
                  while(i+w<N && !used[(i+w)+j*N] && keys[(i+w)+j*N]===key) w++;
                  grow: while(j+h<N){
                    for(let dd=0;dd<w;dd++){ const id2=(i+dd)+(j+h)*N; if(used[id2]||keys[id2]!==key) break grow; }
                    h++;
                  }
                  for(let jj=0;jj<h;jj++) for(let ii=0;ii<w;ii++) used[(i+ii)+(j+jj)*N]=true;
                } else used[idx]=true;
                // emit one quad spanning w×h blocks
                const o=[0,0,0]; o[n]=k; o[u]=i; o[v]=j;
                const ox=bx+o[0], oy=by+o[1], oz=bz+o[2];
                const corner=(uu,vv)=>{ const p=[ox,oy,oz]; p[n]+=planeN; p[u]+=uu; p[v]+=vv; return p; };
                const c00=corner(0,0), c10=corner(w,0), c11=corner(w,h), c01=corner(0,h);
                const base=B.pos.length/3;
                const t=d.tile, du=t.u1-t.u0, dv=t.v1-t.v0;
                const push=(p,ru,rv,col)=>{ B.pos.push(p[0],p[1],p[2]); B.uv.push(ru,rv); B.col.push(col,col,col);
                  B.nor.push(dir[0],dir[1],dir[2]); B.arect.push(t.u0,t.v0,du,dv); };
                push(c00,0,0, fb*d.ao[0]);
                push(c10,w,0, fb*d.ao[1]);
                push(c11,w,h, fb*d.ao[2]);
                push(c01,0,h, fb*d.ao[3]);
                B.idx.push(base,base+1,base+2, base,base+2,base+3);
              }
            }
          }
        }

        const scene3 = {chunks:new Map()};   // "cx,cz" column -> {static:Mesh, anim:Mesh, glass:Mesh, water:Mesh, deco:Mesh}
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
            B.nor.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);     // top-lit tufts (no computeVertexNormals)
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
        // One merged mesh per material per COLUMN (16×H×16), not per 16³ sub-chunk.
        // A column used to be 3-6 sub-chunk meshes × up to 5 materials; at a far view
        // radius that put tens of thousands of Object3Ds in the scene, and the per-object
        // matrix/culling/draw overhead — not triangle count — was what dropped frames.
        function buildColumnMesh(cx,cz){
          const key=colKey(cx,cz);
          const old = scene3.chunks.get(key);
          if(old){ ['static','anim','glass','water','deco'].forEach(k=>{ if(old[k]){ scene.remove(old[k]); old[k].geometry.dispose(); } }); }

          // Cache the 3×3 neighbour column buffers once so per-voxel reads skip the
          // string-key build + Map.get in getBlock (meshColumn guarantees neighbours
          // are resident; rebuildChunkAt edits fall back to getBlock on a cache miss).
          const nbuf = [
            [worldCols.get(colKey(cx-1,cz-1)), worldCols.get(colKey(cx-1,cz)), worldCols.get(colKey(cx-1,cz+1))],
            [worldCols.get(colKey(cx,  cz-1)), worldCols.get(colKey(cx,  cz)), worldCols.get(colKey(cx,  cz+1))],
            [worldCols.get(colKey(cx+1,cz-1)), worldCols.get(colKey(cx+1,cz)), worldCols.get(colKey(cx+1,cz+1))],
          ];
          const localBlock = (x,y,z) => {
            if(y<0||y>=H) return 0;
            const ncx = Math.floor(x/CH)-cx, ncz = Math.floor(z/CH)-cz;
            if(ncx<-1||ncx>1||ncz<-1||ncz>1) return getBlock(x,y,z);   // outside the cached ring
            const b = nbuf[ncx+1][ncz+1];
            return b ? b[cIdx(_mod(x,CH), y, _mod(z,CH))] : getBlock(x,y,z);
          };

          const buf = GREEDY ? { pos:[], uv:[], col:[], idx:[], nor:[], arect:[] }
                             : { pos:[], uv:[], col:[], idx:[], nor:[] };
          const abuf = { pos:[], uv:[], col:[], idx:[], nor:[] };
          const gbuf = { pos:[], uv:[], col:[], idx:[], nor:[] };
          const wbuf = { pos:[], uv:[], col:[], idx:[], nor:[], shore:[] };
          const dbuf = { pos:[], uv:[], col:[], idx:[], sway:[], nor:[] };
          // surface water present at this column (topmost water cell sits at SEA_LEVEL)
          const isSurfWater = (cellX,cellZ) => localBlock(cellX, SEA_LEVEL, cellZ) === WATER;

          // only walk up to the filled height — skip the empty sky above
          const topY = Math.min(H-1, colMaxY.get(key) || (H-1));
          for(let lx=0;lx<CH;lx++) for(let y=0;y<=topY;y++) for(let lz=0;lz<CH;lz++){
            const x=cx*CH+lx, z=cz*CH+lz;
            const id = localBlock(x,y,z);
            if(!id) continue;
            const block = blockById(id);
            if(block.water){
              // Render water as a SURFACE only: the top face of the topmost water cell
              // (air directly above). This keeps the sea contained exactly to the
              // shoreline the water blocks define. The Gerstner shader on matWater
              // displaces these quads into moving waves; underwater volume stays
              // invisible (physics-only). No faces emitted for submerged water cells.
              if(localBlock(x,y+1,z)===0){
                const tf = FACES[3], base = wbuf.pos.length/3;
                for(const corner of tf.corners){
                  // Per-corner shore weight: 1 only when all four cells meeting this
                  // grid point carry surface water; 0 the moment a corner touches land.
                  // The shader multiplies wave height by it, so the waterline stays flat
                  // and flush with the beach instead of sliding crests over the sand.
                  const gx = x + corner.pos[0], gz = z + corner.pos[2];
                  const w = (isSurfWater(gx-1,gz-1) && isSurfWater(gx-1,gz) &&
                             isSurfWater(gx,gz-1)   && isSurfWater(gx,gz)) ? 1 : 0;
                  wbuf.pos.push(x+corner.pos[0], y+corner.pos[1], z+corner.pos[2]);
                  wbuf.uv.push(0,0); wbuf.col.push(1,1,1); wbuf.nor.push(0,1,0);
                  wbuf.shore.push(w);
                }
                wbuf.idx.push(base, base+1, base+2, base+2, base+1, base+3);
              }
              continue;
            }
            const B = block.animated? abuf : (block.transparent? gbuf : buf);

            if(decoFor(id,x,y,z)) emitCarpet(dbuf,block,x,y,z);

            // static opaque faces are emitted by the greedy pass below
            if(GREEDY && B===buf) continue;

            for(const face of FACES){
              const [dx,dy,dz] = face.dir;
              const nid = localBlock(x+dx,y+dy,z+dz);
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
                B.nor.push(dx,dy,dz);                            // flat face normal (no computeVertexNormals)
                const br = face.bright * vertexAO(x,y,z,face.dir,corner,localBlock);
                B.col.push(br,br,br);
              }
              B.idx.push(base, base+1, base+2, base+2, base+1, base+3);
            }
          }

          if(GREEDY){                     // greedy pass works per 16³ cell — run it up the stack
            const topCy = Math.floor(topY/CH);
            for(let cy=0; cy<=topCy; cy++) greedyStatic(cx,cy,cz, buf, localBlock);
          }

          const out = {};
          const mk = (b, mat) => {
            if(!b.idx.length) return null;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos,3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv,2));
            g.setAttribute('color', new THREE.Float32BufferAttribute(b.col,3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor,3));
            if(b.arect) g.setAttribute('arect', new THREE.Float32BufferAttribute(b.arect,4));
            if(b.sway) g.setAttribute('sway', new THREE.Float32BufferAttribute(b.sway,1));
            if(b.shore) g.setAttribute('shore', new THREE.Float32BufferAttribute(b.shore,1));
            g.setIndex(b.idx);
            const m = new THREE.Mesh(g, mat);
            m.position.copy(WORLD_OFFSET);
            m.matrixAutoUpdate = false;   // chunks never move — skip per-frame matrix recompose
            m.updateMatrix();
            scene.add(m);
            return m;
          };
          out.static = mk(buf, matStatic);
          out.anim = mk(abuf, matAnim);
          out.glass = mk(gbuf, matGlass);
          out.water = mk(wbuf, matWater);
          out.deco = mk(dbuf, decoMat);
          scene3.chunks.set(key, out);
        }
        function rebuildChunkAt(x,y,z){
          if(y<0||y>=H) return;
          buildColumnMesh(Math.floor(x/CH), Math.floor(z/CH));
        }
        // Re-mesh every currently-resident column (e.g. after the biome theme changes).
        function rebuildWorld(){
          for(const k of [...meshedCols]){
            const c = k.split(','); meshColumn(+c[0], +c[1]);
          }
          updateHUD();
        }

        // ---------- chunk streaming: keep a disc of columns around the player ----------
        const meshedCols = new Set();           // "cx,cz" columns claimed (generated/meshing)
        let buildQueue = [];                    // pending columns to GENERATE, nearest first
        let meshQueue = [];                     // pending column MESH jobs {cx,cz}
        let editQueue = [];                     // high-priority rebuilds from player edits (mine/place/flood)
        const _editQueued = new Set();          // dedup keys "cx,cz" for editQueue
        let _streamCx = null, _streamCz = null;

        function meshColumn(cx,cz){
          // ensure this column + its 8 neighbours are buffered so border faces/AO read
          // real data (not the tree-less single-voxel fallback)
          for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=1;dz++) ensureCol(cx+dx, cz+dz);
          buildColumnMesh(cx,cz);
          meshedCols.add(colKey(cx,cz));
        }
        function unloadColumn(cx,cz){
          const o = scene3.chunks.get(colKey(cx,cz));
          if(o){ ['static','anim','glass','water','deco'].forEach(k=>{ if(o[k]){ scene.remove(o[k]); o[k].geometry.dispose(); } }); scene3.chunks.delete(colKey(cx,cz)); }
          meshedCols.delete(colKey(cx,cz));
        }
        // Recompute the desired disc of loaded chunks around the player's column.
        function streamAround(wx, wz){
          const ccx = Math.floor(wx/CH), ccz = Math.floor(wz/CH);
          if(ccx===_streamCx && ccz===_streamCz) return;
          _streamCx = ccx; _streamCz = ccz;
          // (buffers are generated lazily by meshColumn, which ensures its neighbours)
          // Rebuild the queue of un-meshed columns within VIEW_R, ordered by TRAVEL
          // priority, not plain distance: while moving, columns in front of the player
          // build first (the edge you can catch is always ahead), columns behind wait.
          buildQueue = [];
          const view2 = VIEW_R*VIEW_R;
          const moving = _playerSpeed > 4;
          for(let dx=-VIEW_R;dx<=VIEW_R;dx++) for(let dz=-VIEW_R;dz<=VIEW_R;dz++){
            const d2 = dx*dx+dz*dz; if(d2>view2) continue;
            const cx=ccx+dx, cz=ccz+dz;
            if(meshedCols.has(colKey(cx,cz))) continue;
            let p = d2;
            if(moving && d2 > 0){
              const d = Math.sqrt(d2);
              const fwd = (dx*_spdX + dz*_spdZ) / d;      // +1 dead ahead … -1 behind
              p = d2 * (1.2 - 0.7*fwd);                   // ahead ≈ half price, behind ≈ double
            }
            buildQueue.push({cx,cz,d2,p});
          }
          buildQueue.sort((a,b)=>a.p-b.p);
          // unload meshes + buffers that drifted out of range
          const un2 = UNLOAD_R*UNLOAD_R, drop2 = (UNLOAD_R+2)*(UNLOAD_R+2);
          for(const k of [...meshedCols]){
            const c=k.split(','), cx=+c[0], cz=+c[1];
            const ddx=cx-ccx, ddz=cz-ccz;
            if(ddx*ddx+ddz*ddz>un2) unloadColumn(cx,cz);
          }
          for(const k of [...worldCols.keys()]){
            const c=k.split(','), cx=+c[0], cz=+c[1];
            const ddx=cx-ccx, ddz=cz-ccz;
            if(ddx*ddx+ddz*ddz>drop2){ worldCols.delete(k); colMaxY.delete(k); }
          }
        }
        // Generation step for the streamed path: buffer the column + its 8 neighbours,
        // claim it (so streamAround won't re-enqueue), then queue it for meshing.
        function genColumnJob(cx,cz){
          for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=1;dz++) ensureCol(cx+dx, cz+dz);
          meshedCols.add(colKey(cx,cz));
          meshQueue.push({cx,cz});
        }
        // Drain the streaming queues under a per-frame TIME budget (ms) so work spreads
        // across frames instead of hitching. The budget is checked between each unit
        // (one column mesh, or one column generation).
        // Mesh jobs run first so claimed columns finish before new ones generate.
        function processBuildQueue(maxMs){
          if(!editQueue.length && !meshQueue.length && !buildQueue.length) return 0;
          const now = (typeof performance!=='undefined' && performance.now) ? ()=>performance.now() : ()=>Date.now();
          // player edits are urgent — give them a little more headroom so a dig/build
          // flushes within a frame or two without ever spiking a whole 7-chunk rebuild.
          const cap = editQueue.length ? Math.max(maxMs, 6) : maxMs;
          const t0 = now();
          do {
            if(editQueue.length){
              const j = editQueue.shift(); _editQueued.delete(j.k);
              if(meshedCols.has(colKey(j.cx,j.cz))) buildColumnMesh(j.cx,j.cz);
            } else if(meshQueue.length){
              const j = meshQueue.shift();
              // skip stale jobs whose column drifted out of range before meshing
              if(meshedCols.has(colKey(j.cx,j.cz))) buildColumnMesh(j.cx,j.cz);
            } else {
              const job = buildQueue.shift();
              if(job && !meshedCols.has(colKey(job.cx,job.cz))) genColumnJob(job.cx,job.cz);
            }
          } while((editQueue.length || meshQueue.length || buildQueue.length) && now()-t0 < cap);
          return now() - t0;   // actual ms spent, so adaptQuality can discount deliberate build sprints
        }
        // Queue a column remesh from a player edit (deduped, async). Border edits touch
        // neighbour columns; spreading those over a couple frames kills the synchronous
        // multi-column rebuild hitch while the directly-edited column stays instant.
        function queueRebuildCol(cx,cz){
          if(!meshedCols.has(colKey(cx,cz))) return;   // not resident; it'll mesh when streamed
          const k = colKey(cx,cz);
          if(_editQueued.has(k)) return;
          _editQueued.add(k); editQueue.push({cx,cz,k});
        }
        function queueRebuildAt(x,y,z){
          if(y<0 || y>=H) return;
          queueRebuildCol(Math.floor(x/CH), Math.floor(z/CH));
        }

        // ---------- location-aware streaming ----------
        // The world must be built based on where the player IS and is HEADING, not on a
        // flat time trickle — otherwise sustained travel (especially ship flight) outruns
        // the builder and the player reaches the raw edge of the meshed world.
        // Two mechanisms:
        //   1) The stream center leads the player along their velocity, so the queue is
        //      always sorted "in front of you first" instead of a symmetric disc.
        //   2) The per-frame meshing budget scales with time-to-edge: seconds until the
        //      player would reach the nearest unbuilt column at current speed. Minutes
        //      away -> background trickle; seconds away -> spend real frame time.
        let _spdX = 0, _spdZ = 0, _playerSpeed = 0, _lastPX = null, _lastPZ = null;
        function trackPlayerVelocity(frameDt){
          if(_lastPX !== null && frameDt > 0.001){
            const vx = (player.pos.x - _lastPX)/frameDt, vz = (player.pos.z - _lastPZ)/frameDt;
            const sp = Math.hypot(vx, vz);
            if(sp < 150){                                   // ignore teleports (gate travel, respawn)
              _playerSpeed += (sp - _playerSpeed) * 0.25;   // smooth so the lead doesn't jitter
              if(sp > 0.5){ _spdX = vx/sp; _spdZ = vz/sp; }
            } else { _playerSpeed = 0; }
          }
          _lastPX = player.pos.x; _lastPZ = player.pos.z;
        }
        // Distance from the player to the nearest column still waiting to be built.
        // Queues are kept nearest-first, so the head is a good enough proxy.
        function nearestPendingDist(){
          const q = meshQueue.length ? meshQueue[0] : (buildQueue.length ? buildQueue[0] : null);
          if(!q) return Infinity;
          return Math.hypot(q.cx*CH + CH/2 - player.pos.x, q.cz*CH + CH/2 - player.pos.z);
        }
        function streamBudgetMs(){
          if(!meshQueue.length && !buildQueue.length) return 4;
          const tte = nearestPendingDist() / Math.max(2, _playerSpeed);  // seconds to the edge
          // Continuous ramp, not tiers: tiers found an equilibrium hovering barely a
          // second ahead of a fast ship — technically ahead, visibly at the edge. Aim
          // to keep the unbuilt front ≥12s of travel away; spend up to most of a frame
          // when it gets close (a brief fps dip beats flying into the void).
          const urgency = Math.max(0, Math.min(1, 1 - tte/12));
          return 4 + Math.round(urgency * 24);            // 4 … 28 ms
        }
        function streamCenterAhead(){
          // lead the stream center along the velocity, capped so the disc always still
          // covers the player with a wide margin (unload radius is measured from this
          // same center, so terrain just behind stays resident too).
          const lead = Math.min(_playerSpeed * 3, (VIEW_R - 5) * CH);
          return { x: player.pos.x + _spdX * lead, z: player.pos.z + _spdZ * lead };
        }

        // ---------- seamless horizon: fog hugs the BUILT frontier ----------
        // Minecraft-style rule: a column may only become visible if it was meshed while
        // still hidden behind the fog wall. So the fog doesn't track VIEW_R (the build
        // TARGET) — it tracks how far the world is actually built right now, minus a
        // margin. Fully caught up -> fog rests at the full view distance; builder busy
        // (fast travel, radius growth) -> fog eases inward ahead of the raw edge and
        // breathes back out as columns finish. Pop-in becomes literally invisible.
        function minPendingDistAll(){
          let best = Infinity;
          const px = player.pos.x, pz = player.pos.z;
          for(const q of meshQueue){ const dx=q.cx*CH+CH/2-px, dz=q.cz*CH+CH/2-pz; const d2=dx*dx+dz*dz; if(d2<best) best=d2; }
          for(const q of buildQueue){ const dx=q.cx*CH+CH/2-px, dz=q.cz*CH+CH/2-pz; const d2=dx*dx+dz*dz; if(d2<best) best=d2; }
          return best === Infinity ? Infinity : Math.sqrt(best);
        }
        function updateFogFrontier(frameDt){
          if(_preloading) return;                        // loading screen covers the initial build
          const pend = minPendingDistAll();
          // stay 20 blocks behind the nearest unbuilt column, never closer than 10 chunks
          const target = Math.max(10*CH, Math.min(VIEW_R*CH, pend - 20));
          const k = target < FOG_FAR ? 2.2 : 0.55;       // close in quickly, breathe out slowly
          FOG_FAR += (target - FOG_FAR) * (1 - Math.exp(-k * frameDt));
          FOG_NEAR = FOG_FAR * 0.55;
          // scene.fog itself is written every frame by updateSky (altitude-aware)
        }

        // ---------- adaptive draw distance ----------
        // Hold a smooth frame rate while pushing the horizon as far out as the hardware
        // allows: raise VIEW_R when frames are cheap + streaming has caught up, shed it
        // fast when they aren't. updateSky() (per frame) propagates VIEW_R -> fog + camera
        // far-plane, so changing these globals + forcing one stream pass is all we need.
        const VR_MIN = 20, VR_MAX = 48;         // column-chunk radius bounds (×16 blocks)
        const VR_SEED = 36;                     // distance to jump to on entry, before fine-tuning
        // (the ring beyond the loading-screen preload builds invisibly behind the
        // frontier fog, so a big seed costs nothing in pop-in — only build time)
        let _frameMsEMA = 16, _qCooldown = 0, _qSeeded = false;
        let _adaptive = true;                   // auto-tune view distance to frame rate
        let _preloading = false;                // true while prewarmHorizon builds — freeze auto-tune

        // Real rendered-frame clock. tick() runs on the FIXED timestep (dt is always
        // 1/60), and the catch-up accumulator calls it several times per rendered frame
        // once the game slows down — so tick's dt can never measure lag, and per-frame
        // work done in tick multiplies exactly when frames are already expensive. This
        // tiny rAF loop counts true rendered frames (gate: run heavy work once per
        // frame) and their true duration (feed: adaptQuality sees real milliseconds).
        let _rafFrame = 0, _rafFrameMs = 16.7, _rafPrevT = 0, _rafId = null, _lastTickFrame = -1;
        function _frameClock(t){
          if(_rafPrevT) _rafFrameMs = Math.min(100, t - _rafPrevT);
          _rafPrevT = t; _rafFrame++;
          _rafId = requestAnimationFrame(_frameClock);
        }
        function startFrameClock(){ if(_rafId === null){ _rafPrevT = 0; _rafId = requestAnimationFrame(_frameClock); } }
        function stopFrameClock(){ if(_rafId !== null){ cancelAnimationFrame(_rafId); _rafId = null; } }

        function setLiveViewR(r){
          r = Math.max(VR_MIN, Math.min(VR_MAX, r|0));
          if(r === VIEW_R) return;
          VIEW_R = r; KEEP_R = VIEW_R + 2; UNLOAD_R = VIEW_R + 4;
          // fog is NOT snapped here — updateFogFrontier eases it toward the built
          // frontier, so radius changes drift in/out invisibly instead of jumping
          _streamCx = _streamCz = null;         // force streamAround to re-evaluate load/unload now
        }
        function adaptQuality(frameDt, buildMsSpent){
          if(!_adaptive || _preloading) return;   // don't shrink the horizon while pre-building it
          if(!_qSeeded){ _qSeeded = true; setLiveViewR(Math.max(VIEW_R, VR_SEED)); }  // start far, then tune
          // _rafFrameMs is the true frame-to-frame time from the rAF clock — NOT tick's
          // fixed-step dt, which is constant 16.7ms and once made this tuner blind
          // (EMA pinned under the grow threshold, so it maxed VIEW_R on every machine).
          // Deliberate build-sprint ms are discounted: they're temporary travel catch-up,
          // and shedding VIEW_R for them would UNLOAD terrain right in front of a moving
          // player — a feedback loop that drags the world edge in toward them.
          const ms = Math.min(100, _rafFrameMs) - Math.min(buildMsSpent||0, _rafFrameMs);
          _frameMsEMA += (ms - _frameMsEMA) * 0.1;
          _qCooldown -= frameDt;
          if(_qCooldown > 0) return;
          if(_frameMsEMA > 33){                 // < ~30 fps: only pull back when genuinely choppy
            setLiveViewR(VIEW_R - 2); _qCooldown = 0.7; return;
          }
          // running smoothly AND streaming has caught up: push the horizon out gently
          if(_frameMsEMA < 22 && meshQueue.length < 4 && buildQueue.length < 80){
            setLiveViewR(VIEW_R + 2); _qCooldown = 1.2;
          } else { _qCooldown = 0.5; }
        }
        // Dispose all chunks + buffers (used when entering / changing planet).
        function resetStreaming(){
          for(const k of [...meshedCols]){ const c=k.split(','); unloadColumn(+c[0], +c[1]); }
          meshedCols.clear();
          worldCols.clear();
          colMaxY.clear();
          buildQueue = [];
          meshQueue = [];
          editQueue = [];
          _editQueued.clear();
          _qSeeded = false;                     // re-seed the far view distance on next entry
          _streamCx = _streamCz = null;
          _lastPX = _lastPZ = null; _playerSpeed = 0; _spdX = _spdZ = 0;   // world jump = no stale velocity lead
        }
        // Build the spawn area up front; the rest streams in over the next frames.
        function streamInit(){
          streamAround(player.pos.x, player.pos.z);
          const N = Math.min(buildQueue.length, 200);   // nearest disc synchronously
          for(let i=0;i<N;i++){ const j=buildQueue.shift(); if(j && !meshedCols.has(colKey(j.cx,j.cz))) meshColumn(j.cx,j.cz); }
          updateHUD();
        }

        // Build the WHOLE view disc out to the horizon under the loading screen — time-sliced
        // across frames so it never hitches — then call onDone. The player spawns to a full
        // horizon instead of watching chunks pop in. A safety cap lets the rest stream in if
        // generation runs long on a slow device.
        const PRELOAD_R = 28;                           // min horizon radius to pre-build (×16 blocks)
        function prewarmHorizon(onDone){
          const target = Math.max(VIEW_R, PRELOAD_R);
          _preloading = true;                           // freeze auto-tune so it can't shrink mid-build
          _qSeeded = true;                              // don't let adaptQuality re-jump the radius
          VIEW_R = target; KEEP_R = VIEW_R + 2; UNLOAD_R = VIEW_R + 4;
          FOG_FAR = VIEW_R * CH; FOG_NEAR = FOG_FAR * 0.55;
          if(g.scene && g.scene.fog){ g.scene.fog.near = FOG_NEAR; g.scene.fog.far = FOG_FAR; }
          _streamCx = _streamCz = null;
          streamAround(player.pos.x, player.pos.z);
          const total = Math.max(1, buildQueue.length);
          // spawn core synchronously so the player can't fall through before the rest builds
          for(let i=0, n=Math.min(buildQueue.length, 120); i<n; i++){
            const j = buildQueue.shift();
            if(j && !meshedCols.has(colKey(j.cx,j.cz))) meshColumn(j.cx,j.cz);
          }
          const hintEl = _loadEl && _loadEl.querySelector('.vx-load-hint');
          const _now = (typeof performance!=='undefined' && performance.now) ? ()=>performance.now() : ()=>Date.now();
          const tStart = _now();
          const MAX_MS = 9000;                          // safety: never block the load forever
          const step = () => {
            if(!_active){ _preloading = false; if(onDone) onDone(); return; }
            processBuildQueue(15);                       // generous per-frame budget; still yields each frame
            const remaining = buildQueue.length + meshQueue.length;
            if(hintEl){
              const pct = Math.min(99, Math.round((total - buildQueue.length) / total * 100));
              hintEl.textContent = 'Charting the horizon… ' + pct + '%';
            }
            if(remaining === 0 || _now() - tStart > MAX_MS){
              if(hintEl) hintEl.textContent = 'Generating your world…';
              _frameMsEMA = 16;                          // forget the heavy build frames so auto-tune won't shrink
              _preloading = false;
              updateHUD();
              if(onDone) onDone();
              return;
            }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }

        // ---------- loading screen (covers the synchronous spawn-area build) ----------
        let _loadEl = null;
        function showVoxelLoading(title, sub){
          if(!_loadEl){
            _loadEl = document.createElement('div');
            _loadEl.id = 'voxel-loading';
            _loadEl.innerHTML = '<div class="vx-load-box"><div class="vx-load-ring"></div>'
              + '<div class="vx-load-title"></div><div class="vx-load-sub"></div>'
              + '<div class="vx-load-hint">Generating your world…</div></div>';
            (document.getElementById('gameContainer') || document.body).appendChild(_loadEl);
          }
          _loadEl.querySelector('.vx-load-title').textContent = title || 'Loading…';
          _loadEl.querySelector('.vx-load-sub').textContent = sub || '';
          _loadEl.classList.add('vx-load-on');
        }
        function hideVoxelLoading(){ if(_loadEl) _loadEl.classList.remove('vx-load-on'); }
        // run fn after the browser has painted (so the overlay is on screen first)
        function afterPaint(fn){ requestAnimationFrame(() => requestAnimationFrame(fn)); }
        // ---------- materials + boot ----------
        let decoMat=null, matGlass=null, matWater=null;
        function rebuildMaterials(){
          matStatic = new THREE.MeshLambertMaterial({map:atlasTex, vertexColors:true});
          if(GREEDY){
            // Atlas tiling for greedy-merged quads: the per-vertex 'arect' carries the
            // tile's atlas rect (u0,v0,du,dv); the repeating 'uv' (0..W,0..H) is wrapped
            // with fract() and remapped into that rect. 1x1 faces (uv in [0,1]) sample the
            // tile normally; merged WxH quads repeat it per block.
            matStatic.onBeforeCompile = sh=>{
              sh.vertexShader = 'attribute vec4 arect;\nvarying vec4 vArect;\n' +
                sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vArect = arect;');
              sh.fragmentShader = 'varying vec4 vArect;\n' +
                sh.fragmentShader.replace('#include <map_fragment>',
                  `#ifdef USE_MAP
                     vec4 texelColor = texture2D( map, vArect.xy + fract(vUv) * vArect.zw );
                     texelColor = mapTexelToLinear( texelColor );
                     diffuseColor *= texelColor;
                   #endif`);
            };
          }
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
          // water surface: a Gerstner-wave ShaderMaterial applied to the per-chunk
          // surface quads (top faces of the topmost water cells). Real dispersion
          // (omega=sqrt(g*k)), analytic Gerstner normals, Schlick Fresnel into the sky
          // reflection, and a Blinn sun glint locked to the scene's live sun.
          matWater = makeWaterMaterial();
        }
        // Four Gerstner waves: direction (xz, unit), wavelength L, steepness Q, amplitude A.
        // Mixed directions + wavelengths break up the grid; total amplitude ~0.5m stays
        // calm and kid-friendly. Built into GLSL consts so the loop is fully unrolled.
        function makeWaterMaterial(){
          const WAVES = [
            //  dirX, dirZ,      L,    Q,     A     (calm: low amplitude + low steepness = gentle rolling, not choppy)
            [ 0.92,  0.39,   19.0, 0.30, 0.090],
            [-0.50,  0.87,   12.5, 0.26, 0.055],
            [ 0.20, -0.98,    7.5, 0.20, 0.030],
            [ 0.77,  0.64,    4.3, 0.16, 0.015],
          ];
          let waveConsts = '';
          WAVES.forEach((w,i)=>{
            const [dx,dz,L,Q,A] = w;
            const k = 2.0*Math.PI/L;            // spatial frequency
            const c = Math.sqrt(9.8/k);         // deep-water phase speed (dispersion)
            const dlen = Math.hypot(dx,dz)||1;
            waveConsts += `  W[${i}]=vec4(${(dx/dlen).toFixed(4)},${(dz/dlen).toFixed(4)},${k.toFixed(5)},${(c*k).toFixed(5)}); QA[${i}]=vec2(${Q.toFixed(4)},${A.toFixed(4)});\n`;
          });
          return new THREE.ShaderMaterial({
            transparent:true, side:THREE.DoubleSide, depthWrite:false, fog:true,
            uniforms:{
              uTime:{value:0},
              uSunDir:{value:new THREE.Vector3(0.4,0.8,0.3)},
              uSunColor:{value:new THREE.Color(0xfff4e0)},
              uSkyColor:{value:new THREE.Color(0x8fc4ec)},
              uHorizonColor:{value:new THREE.Color(0xbfe0f5)},
              uDeep:{value:new THREE.Color(0x14506f)},
              uShallow:{value:new THREE.Color(0x2f8fb8)},
              uOpacity:{value:0.86},
              fogColor:{value:new THREE.Color(0xbfe0f5)},
              fogNear:{value:FOG_NEAR}, fogFar:{value:FOG_FAR},
            },
            vertexShader:`
              uniform float uTime;
              attribute float shore;                    // 1 = open water, 0 = touches land
              varying vec3 vWorld; varying vec3 vNormal; varying float vFog;
              void main(){
                vec4 W[4]; vec2 QA[4];
${waveConsts}
                vec3 wp = (modelMatrix * vec4(position,1.0)).xyz;   // grid pos in world XZ
                float h = 0.0; vec2 slope = vec2(0.0);
                for(int i=0;i<4;i++){
                  vec2 dir=W[i].xy; float k=W[i].z, w=W[i].w, A=QA[i].y;
                  float ph = k*dot(dir, wp.xz) + w*uTime;
                  h += A*sin(ph);                       // vertical-only (no lateral slide over the shore)
                  slope += dir * (k*A) * cos(ph);       // d(height)/d(xz) for the analytic normal
                }
                // taper waves to zero at the waterline so the edge stays flat & flush,
                // and tuck the whole sheet a hair under the beach to dodge coplanar z-fight.
                h = h*shore - 0.07;
                vec3 nrm = normalize(vec3(-slope.x*shore, 1.0, -slope.y*shore));
                vec3 world = vec3(wp.x, wp.y + h, wp.z);
                vWorld = world; vNormal = nrm;
                vec4 mv = viewMatrix * vec4(world,1.0);
                vFog = -mv.z;
                gl_Position = projectionMatrix * mv;
              }`,
            fragmentShader:`
              precision highp float;
              uniform vec3 uSunDir, uSunColor, uSkyColor, uHorizonColor, uDeep, uShallow;
              uniform float uOpacity;
              uniform vec3 fogColor; uniform float fogNear, fogFar;
              varying vec3 vWorld; varying vec3 vNormal; varying float vFog;
              void main(){
                vec3 N = normalize(vNormal);
                if(!gl_FrontFacing) N = -N;                 // seen from below (underwater)
                vec3 V = normalize(cameraPosition - vWorld);
                vec3 L = normalize(uSunDir);
                float ndv = max(dot(N,V), 0.0);
                float fres = 0.02 + 0.98*pow(1.0 - ndv, 5.0);          // Schlick Fresnel (F0~0.02)
                vec3 body = mix(uDeep, uShallow, pow(ndv, 0.5));
                vec3 skyRef = mix(uSkyColor, uHorizonColor, fres);
                vec3 col = mix(body, skyRef, fres);
                float diff = max(dot(N,L), 0.0);
                col += uSunColor * diff * 0.12;
                vec3 Hh = normalize(L + V);
                float spec = pow(max(dot(N,Hh),0.0), 220.0);           // tight Blinn sun glint
                col += uSunColor * spec * 1.6 * (0.25 + 0.75*max(L.y,0.0));
                float f = clamp((vFog - fogNear)/(fogFar - fogNear), 0.0, 1.0);
                col = mix(col, fogColor, f);
                gl_FragColor = vec4(col, uOpacity);
              }`,
          });
        }
        
        
        
        // stub: engine's rebuildWorld() calls this; we update the tri readout
        let _hudTriFrame = 0, _hudTriCached = 0;
        let _hudShownTri = null, _hudShownSeed = null;
        function updateHUD(){
          // The tri-count is a debug readout — walking every chunk's geometry each frame is
          // wasteful. Recompute it only every 30 calls; cache the value in between.
          if((_hudTriFrame++ % 30) === 0){
            let tris=0;
            scene3.chunks.forEach(c=>['static','anim','glass','water','deco'].forEach(k=>{
              if(c[k]) tris += c[k].geometry.index.count/3; }));
            _hudTriCached = tris|0;
          }
          // only touch the DOM when the value actually changed
          if(_hudShownTri !== _hudTriCached){
            _hudShownTri = _hudTriCached;
            document.getElementById('voxel-tri-count').textContent = _hudTriCached;
          }
          if(_hudShownSeed !== SEED){
            _hudShownSeed = SEED;
            document.getElementById('voxel-seed-label').textContent = 'seed '+(SEED>>>0).toString(16);
          }
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
            if (n.weapon !== -1) {
                const wlen = weaponList().length || 1;
                n.weapon = ((n.weapon % wlen) + wlen) % wlen;
            }
            return n;
        }

        function loadCharCfg() {
            const AP = getProfileApi();
            if (AP) {
                try {
                    return normalizeCharCfg(AP.load().character);
                } catch (_) {}
            }
            try {
                let raw = localStorage.getItem('pjboy.voxelCharacter.v1');
                const VC = getVC();
                if (!raw && VC) raw = localStorage.getItem(VC.SAVE_KEY);
                return raw ? normalizeCharCfg(JSON.parse(raw)) : normalizeCharCfg(null);
            } catch (_) { return normalizeCharCfg(null); }
        }

        function saveCharCfg(patch) {
            const cfg = normalizeCharCfg(Object.assign({}, loadCharCfg(), patch || {}));
            const AP = getProfileApi();
            if (AP) {
                const p = AP.load();
                p.character = cfg;
                AP.save(p);
            } else {
                localStorage.setItem('pjboy.voxelCharacter.v1', JSON.stringify(cfg));
                const VC = getVC();
                if (VC) VC.saveParams(cfg);
            }
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

        function clearHeldWeapon(grip) {
            const target = resolveWeaponGrip(grip);
            if (target && tpWeapon && tpWeapon.parent) tpWeapon.parent.remove(tpWeapon);
            tpWeapon = null;
            weaponDef = null;
            if (av) {
                if (av.weapon && av.weapon.parent) av.weapon.parent.remove(av.weapon);
                av.weapon = null;
                av.weaponDef = null;
                av.twoHanded = false;
                av.socket = null;
                if (av.anim) av.anim.weaponEquipped = false;
            }
            resetMining();
            updateWeaponLabel();
        }

        function attachTpWeapon(grip) {
            const target = resolveWeaponGrip(grip);
            if (!target) return;
            tpGrip = target;
            if (weaponIndex < 0) {
                clearHeldWeapon(grip);
                return;
            }
            if (tpWeapon && tpWeapon.parent) tpWeapon.parent.remove(tpWeapon);
            const built = buildWeaponMesh(charAccent(), weaponIndex);
            weaponDef = built.def;
            weaponIndex = built.index;
            tpWeapon = built.mesh;
            const VC = getVC();
            if (VC && VC.mirrorWeaponForTpGrip) VC.mirrorWeaponForTpGrip(tpWeapon, built.def);
            applyTpWeaponGripRest(tpWeapon, built.def);
            tpWeapon.visible = true;
            target.add(tpWeapon);
            if (av) {
                av.weapon = tpWeapon;
                av.weaponDef = weaponDef;
                av.twoHanded = built.def.twoHanded;
                av.socket = tpWeapon.userData.socket || null;
                av.weaponGrip = target;
                if (!av.primaryHand) av.primaryHand = 'right';
                if (av.anim) av.anim.weaponEquipped = true;
            }
            updateWeaponLabel();
        }

        function rebuildFpWeapon() {
            if (!fpMount) return;
            if (fpWeapon) fpMount.remove(fpWeapon);
            fpWeapon = null;
            if (weaponIndex < 0) {
                weaponDef = null;
                updateWeaponLabel();
                return;
            }
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

        function weaponCycleList() {
            const defs = weaponList();
            const owned = defs.map((_, i) => i).filter((i) => ownedWeapons.has(i) && defs[i] && defs[i].id !== 'pickaxe');
            return [-1, ...owned];
        }

        function setWeaponIndex(idx, quiet) {
            // Pickaxe is retired — redirect any attempt to equip it to the Laser Handgun.
            const _defs = weaponList();
            if (idx >= 0 && _defs[idx] && _defs[idx].id === 'pickaxe') {
                const mc = _defs.findIndex((w) => w.id === 'minecutter');
                idx = mc >= 0 ? mc : -1;
            }
            // Craft-gated: never unlock a weapon just by equipping it.
            if (idx >= 0 && !ownedWeapons.has(idx)) {
                if (!quiet && g.showMessage) g.showMessage('Locked — craft it at Tab → Refinery', 2200);
                return;
            }
            const cfg = saveCharCfg({ weapon: idx | 0 });
            weaponIndex = cfg.weapon;
            attachTpWeapon(av && av.weaponGrip);
            rebuildFpWeapon();
            syncFpTunerInputs();
            if (tpTunerEl && !tpTunerEl.hidden) syncTpTunerInputs();
            if (drawerOpen) renderDrawer();
            if (!quiet && g.showMessage) {
                if (weaponDef) g.showMessage('Equipped ' + weaponDef.name, 1400);
                else g.showMessage('Empty hands', 1200);
            }
        }

        function cycleWeapon(dir) {
            const list = weaponCycleList();
            if (!list.length) return;
            let pos = list.indexOf(weaponIndex);
            if (pos < 0) pos = 0;
            pos = (pos + dir + list.length) % list.length;
            setWeaponIndex(list[pos]);
        }

        function isMineLaser() {
            // Laser Handgun (minecutter) is the SOLE mining tool. The Laser Rifle is combat-only now.
            return !!(weaponDef && weaponDef.id === 'minecutter');
        }

        function isSwordEquipped() {
            return !!(weaponDef && weaponDef.id === 'sword');
        }

        function isLaserRifle() {
            return !!(weaponDef && weaponDef.id === 'laser');
        }

        const SWORD_SWING_LOCK = 0.62;
        const SWORD_FP_SWING_VARIANTS = [
            { dir: 1, phase: { anticEnd: 0.24, strikeEnd: 0.46, strikePeak: 1.35 },
              pivot: { ry: [0.18, 1.35], rz: [0.52, 1.48], rx: [0.28, 0.55], pz: [0.18, 0.28], py: [0.07, 0.05], px: [0.08, 0.22] },
              weapon: { x: [0.24, 0.18], y: [0, 0.55], z: [0, 0.38] } },
            { dir: -1, phase: { anticEnd: 0.22, strikeEnd: 0.44, strikePeak: 1.28 },
              pivot: { ry: [0.16, 1.28], rz: [0.48, 1.42], rx: [0.24, 0.52], pz: [0.16, 0.26], py: [0.06, 0.04], px: [0.07, 0.2] },
              weapon: { x: [0.22, 0.16], y: [0, 0.52], z: [0, 0.36] } },
            { dir: 1, phase: { anticEnd: 0.26, strikeEnd: 0.5, strikePeak: 1.4 },
              pivot: { ry: [0.1, 0.72], rz: [0.28, 0.95], rx: [0.55, 1.22], pz: [0.24, 0.35], py: [0.1, 0.08], px: [0.04, 0.12] },
              weapon: { x: [0.35, 0.28], y: [0, 0.32], z: [0, 0.22] } },
            { dir: 1, phase: { anticEnd: 0.2, strikeEnd: 0.42, strikePeak: 1.2 },
              pivot: { ry: [0.08, 0.42], rz: [0.18, 0.38], rx: [0.18, 0.68], pz: [0.22, 0.52], py: [0.04, 0.02], px: [0, 0.06] },
              weapon: { x: [0.12, 0.42], y: [0, 0.25], z: [0, 0.15] } }
        ];
        let swordSwingLock = 0;
        let swordSwingVariant = 0;
        let swordSwingNext = 0;

        function swordSwingVariantCount() {
            const VC = getVC();
            return (VC && VC.SWORD_SWING_COUNT) || SWORD_FP_SWING_VARIANTS.length;
        }

        function currentFpSwordSwing() {
            const n = SWORD_FP_SWING_VARIANTS.length;
            const i = ((swordSwingVariant % n) + n) % n;
            return SWORD_FP_SWING_VARIANTS[i];
        }

        function canStartSwordSwing() {
            return swordSwingLock <= 0;
        }

        function beginSwordSwing() {
            swordSwingVariant = swordSwingNext;
            swordSwingNext = (swordSwingNext + 1) % swordSwingVariantCount();
            swordSwingLock = SWORD_SWING_LOCK;
            const fpVar = currentFpSwordSwing();
            fpSwingDir = fpVar.dir || 1;
            if (av && av.anim) av.anim.swordSwingVariant = swordSwingVariant;
        }

        function tickSwordSwingLock(dt) {
            if (swordSwingLock > 0) swordSwingLock -= dt;
            if (laserFireLock > 0) laserFireLock -= dt;
        }

        const LASER_RIFLE_FIRE_LOCK = 0.34;
        const LASER_FP_RECOIL_VARIANTS = [
            { phase: { anticEnd: 0.1, strikeEnd: 0.32, strikePeak: 1.1 },
              pivot: { rx: [0.08, 0.18], ry: [0.04, 0.12], rz: [0.06, 0.1], pz: [0.05, 0.14], py: [0.02, 0.06], px: [0, 0.04] } },
            { phase: { anticEnd: 0.12, strikeEnd: 0.38, strikePeak: 1.25 },
              pivot: { rx: [0.12, 0.28], ry: [0.03, 0.08], rz: [0.08, 0.14], pz: [0.08, 0.2], py: [0.03, 0.08], px: [0, 0.03] } },
            { phase: { anticEnd: 0.06, strikeEnd: 0.22, strikePeak: 0.9 },
              pivot: { rx: [0.04, 0.12], ry: [0.02, 0.06], rz: [0.03, 0.06], pz: [0.03, 0.1], py: [0.01, 0.04], px: [0, 0.02] } },
            { phase: { anticEnd: 0.1, strikeEnd: 0.34, strikePeak: 1.05 },
              pivot: { rx: [0.06, 0.15], ry: [0.08, 0.14], rz: [0.1, 0.16], pz: [0.05, 0.12], py: [0.02, 0.05], px: [0.03, 0.05] } }
        ];
        let jetpackSfxCd = 0;
        let jetBoost = false;            // B toggles a high-thrust jetpack (rocket up to space fast)
        let laserFireLock = 0;
        let laserFireVariant = 0;
        let laserFireNext = 0;

        function laserFireVariantCount() {
            const VC = getVC();
            return (VC && VC.LASER_RIFLE_COUNT) || LASER_FP_RECOIL_VARIANTS.length;
        }

        function currentFpLaserRecoil() {
            const n = LASER_FP_RECOIL_VARIANTS.length;
            const i = ((laserFireVariant % n) + n) % n;
            return LASER_FP_RECOIL_VARIANTS[i];
        }

        function canStartLaserFire() {
            return laserFireLock <= 0;
        }

        function beginLaserFire() {
            laserFireVariant = laserFireNext;
            laserFireNext = (laserFireNext + 1) % laserFireVariantCount();
            laserFireLock = LASER_RIFLE_FIRE_LOCK;
            if (av && av.anim) av.anim.laserFireVariant = laserFireVariant;
        }

        function triggerFpLaserRecoil() {
            fpSwingDurationActive = 0.24;
            fpSwingTimer = fpSwingDurationActive;
        }

        function applyFpLaserRecoilPivot(t, k, out) {
            const v = currentFpLaserRecoil();
            const { antic, strike } = meleeSwingPhase(t, v.phase);
            const dir = (laserFireVariant % 2 === 1 && v.pivot.ry[1] > 0.12) ? -1 : 1;
            const p = v.pivot;
            const r = fpRecoilStrength();
            out.rx += (-antic * p.rx[0] + strike * p.rx[1]) * r;
            out.ry += (-antic * p.ry[0] + strike * p.ry[1]) * dir * r;
            out.rz += (-antic * p.rz[0] - strike * p.rz[1]) * dir * r;
            out.pz += (-strike * p.pz[1] + antic * p.pz[0]) * r;
            out.py += (antic * p.py[0] - strike * p.py[1]) * r;
            out.px += (strike * p.px[1] - antic * p.px[0]) * dir * r;
        }

        function applyFpSwordSwingPivot(t, k, out) {
            const v = currentFpSwordSwing();
            const { antic, strike } = meleeSwingPhase(t, v.phase);
            const dir = v.dir || 1;
            const p = v.pivot;
            out.ry += (-antic * p.ry[0] + strike * p.ry[1]) * dir * k;
            out.rz += (-antic * p.rz[0] - strike * p.rz[1]) * dir * k;
            out.rx += (-antic * p.rx[0] + strike * p.rx[1]) * k;
            out.pz += (-strike * p.pz[1] + antic * p.pz[0]) * k;
            out.py += (antic * p.py[0] - strike * p.py[1]) * k;
            out.px += (strike * p.px[1] - antic * p.px[0]) * dir * k;
        }

        function applyFpSwordSwingWeapon(t) {
            const v = currentFpSwordSwing();
            const { antic, strike } = meleeSwingPhase(t, v.phase);
            const dir = fpSwingDir || v.dir || 1;
            const w = v.weapon;
            const base = fpWeapon.userData.fpBaseRot;
            if (!base) return;
            fpWeapon.rotation.x = (base.x || base[0] || 0) - antic * w.x[0] + strike * w.x[1];
            fpWeapon.rotation.y = (base.y || base[1] || 0) + strike * w.y[1] * dir;
            fpWeapon.rotation.z = (base.z || base[2] || 0) - strike * w.z[1] * dir;
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

        function applyLegacySwordSwingPose(tgt, k) {
            const ph = meleeSwingPhase(k, { anticEnd: 0.26, strikeEnd: 0.5, strikePeak: 1.28 });
            const { antic, strike } = ph;
            tgt.torsoRY = (tgt.torsoRY || 0) + (-antic * 0.62 + strike * 0.95);
            tgt.shRz = (tgt.shRz || 0) + (-antic * 0.82 + strike * 1.22);
            tgt.shRx = -0.28 - antic * 1.25 + strike * 1.65;
            tgt.elR = 0.28 + antic * 0.52 + strike * 0.78;
            tgt.torsoRX = (tgt.torsoRX || 0) + (-antic * 0.18 + strike * 0.14);
            tgt.headRY = (tgt.headRY || 0) + (-antic * 0.24 + strike * 0.34);
            tgt.hipRz = (tgt.hipRz || 0) + (-antic * 0.08 + strike * 0.14);
        }

        function isMiningTool() {
            return isMineLaser();
        }

        function canScanBlocks() {
            return isMiningTool() || weaponIndex < 0;
        }

        function mineLaserInterval() {
            return MINECUTTER_FIRE_INTERVAL;   // only the minecutter mines
        }

        let mineProgress = 0;
        let mineTarget = null;
        let placeGhost = null;
        let lastToolMsg = 0;

        function showToolMsg(text) {
            const now = performance.now();
            if (g.showMessage && now - lastToolMsg > 900) {
                lastToolMsg = now;
                g.showMessage(text, 1400);
            }
        }

        function resetMining() {
            mineProgress = 0;
            mineTarget = null;
        }

        function weaponFireFactor() {
            if (fireHeld && isMineLaser() && !voxelPanelOpen()) {
                return 0.82 + 0.18 * Math.sin(elapsed * 28);
            }
            if (fpSwingTimer > 0) return Math.max(0, 1 - fpSwingTimer / fpSwingDurationActive);
            if (tpRecoilT >= 0) return Math.max(0, 1 - tpRecoilT / TP_RECOIL_DUR);
            const atkT = (av && av.anim && av.anim.attackT >= 0) ? av.anim.attackT : attackT;
            if (atkT >= 0) {
                let dur = 0.42;
                if (weaponDef && weaponDef.id === 'laser') {
                    const VC = getVC();
                    dur = (VC && VC.LASER_RIFLE_DURATION) || 0.38;
                } else if (weaponDef && weaponDef.ranged) dur = 0.6;
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
                    // Fixed-length mesh beam can't track crosshair hits; shotVfx draws the trace.
                    w.userData.beam.visible = false;
                }
            }
        }

        function updateWeaponLabel() {
            const el = document.getElementById('voxel-weapon-label');
            if (el) {
                if (!weaponDef) { el.textContent = 'Empty hands'; }
                else {
                    const t = weaponTierOf(weaponDef.id);
                    el.textContent = weaponDef.name + (t > 1 ? ' · ' + TIER_NAME[t] : '');
                }
            }
            updateWeaponPanel();
        }

        // Bottom-right HUD: equipped weapon name, tier (Mk I–V), level pips, and live stats.
        // Mining tools dim the Damage row; combat weapons dim the Mining row.
        function updateWeaponPanel() {
            const panel = document.getElementById('voxel-weapon-panel');
            if (!panel) return;
            const nameEl = document.getElementById('voxel-wp-name');
            const tierEl = document.getElementById('voxel-wp-tier');
            const pipsEl = document.getElementById('voxel-wp-pips');
            const statsEl = document.getElementById('voxel-wp-stats');
            if (!weaponDef) {
                panel.classList.add('vx-wp-empty');
                if (nameEl) nameEl.textContent = 'Empty hands';
                if (tierEl) tierEl.textContent = '';
                if (pipsEl) pipsEl.innerHTML = '';
                if (statsEl) statsEl.innerHTML = '';
                return;
            }
            panel.classList.remove('vx-wp-empty');
            const lvl = weaponTierOf(weaponDef.id);
            const gp = weaponGameplayFor(weaponDef.id);
            const isMine = gp.role === 'mining';
            if (nameEl) nameEl.textContent = weaponDef.name;
            if (tierEl) tierEl.textContent = TIER_NAME[lvl];
            if (pipsEl) {
                let pips = '';
                for (let i = 1; i <= 5; i++) pips += '<span class="vx-wp-pip' + (i <= lvl ? ' on' : '') + '"></span>';
                pipsEl.innerHTML = pips;
            }
            if (statsEl) {
                const dmg = weaponDamage();
                const mine = Math.round((gp.mining || 0) * 10) / 10;
                const reach = Math.round(currentAimReach());
                const bar = (cls, label, v, max, unit, muted) =>
                    '<div class="vx-wp-stat ' + cls + (muted ? ' muted' : '') + '">'
                    + '<span class="vx-wp-lbl">' + label + '</span>'
                    + '<span class="vx-wp-track"><span class="vx-wp-fill" style="width:'
                    + Math.max(0, Math.min(100, v / max * 100)) + '%"></span></span>'
                    + '<span class="vx-wp-num">' + v + (unit || '') + '</span></div>';
                statsEl.innerHTML =
                    bar('dmg', 'DMG', dmg, 35, '', isMine)
                    + bar('mine', 'MINE', mine, 17, '/s', !isMine)
                    + bar('rng', 'RNG', reach, 35, 'm', false);
            }
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
            av.group.scale.y = 1 - crouchBlend * 0.28;   // squash toward feet while crouched
            const VC = getVC();
            if (VC && av.anim && av.j) {
                const aim = computeAimOffsets();
                const aimDir = syncAimRay();
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
                    weaponEquipped: weaponIndex >= 0,
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
            const ch = VC.build(cfg, { weaponEquipped: cfg.weapon >= 0 });
            weaponDef = ch.weaponDef || null;
            tpWeapon = ch.weapon || null;
            tpGrip = ch.weaponGrip || (ch.weapon && ch.weapon.parent ? ch.weapon.parent : null);
            if (tpWeapon && weaponDef) applyTpWeaponGripRest(tpWeapon, weaponDef);
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
        const KEYS=['rootY','torsoRX','torsoRY','headRX','headRY','shLx','shLz','elL','shRx','shRz','elR',
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
            attackT+=dt;
            const d = isSwordEquipped() ? 0.52 : 0.42;
            const k = Math.min(attackT / d, 1);
            if (isSwordEquipped()) {
              const VC = getVC();
              const k = Math.min(attackT / d, 1);
              if (VC && VC.applySwordAttackPose) {
                VC.applySwordAttackPose(tgt, k, swordSwingVariant);
              } else {
                applyLegacySwordSwingPose(tgt, k);
              }
            } else if (k < .35) {
              const w = k / .35;
              tgt.shRx = -2.4 * w; tgt.elR = .3; tgt.torsoRX = (tgt.torsoRX || 0) - .15 * w;
            } else {
              const w = (k - .35) / .65;
              tgt.shRx = -2.4 + 3.1 * w; tgt.elR = .3 + .3 * w; tgt.torsoRX = (tgt.torsoRX || 0) + .3 * w;
            }
            if(attackT>=d) attackT=-1;
          }
          // Third-person ranged recoil — short shoulder kick, not a melee wind-up.
          if(!firstPerson && tpRecoilT>=0 && !isLaserRifle()){
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
          j.torso.rotation.y=cur.torsoRY||0;
          j.neck.rotation.x=cur.headRX; j.neck.rotation.y=cur.headRY;
          j.shL.rotation.x=cur.shLx; j.shL.rotation.z=cur.shLz; j.elL.rotation.x=-Math.abs(cur.elL);
          j.shR.rotation.x=cur.shRx; j.shR.rotation.z=cur.shRz; j.elR.rotation.x=-Math.abs(cur.elR);
          j.hipL.rotation.x=cur.hipLx; j.kneeL.rotation.x=Math.abs(cur.kneeL);
          j.hipR.rotation.x=cur.hipRx; j.kneeR.rotation.x=Math.abs(cur.kneeR);
        }
        
        // ---------- player physics: AABB vs voxel grid ----------
        const PLAYER_STAND_H = 1.85, PLAYER_CROUCH_H = 1.15;
        const player = {
          pos:new THREE.Vector3(), vel:new THREE.Vector3(),
          half:{x:.32,z:.32}, height:PLAYER_STAND_H,
          grounded:false, yaw:0, state:'idle', crouch:false,
          // combat (forgiving by design — see the kid-first audience note)
          health:100, maxHealth:100, invuln:0, hurtFlash:0, _noHitT:0,
          knock:new THREE.Vector3(),   // decaying horizontal knockback impulse
        };
        const _spawnPos = new THREE.Vector3();   // remembered respawn point
        function solidAt(wx,wy,wz){       // world-space (render) coords -> voxel solid?
          const b = getBlock(Math.floor(wx-WORLD_OFFSET.x), Math.floor(wy-WORLD_OFFSET.y),
                             Math.floor(wz-WORLD_OFFSET.z));
          return isSolidId(b);            // water + open doors are walk-through
        }
        // True when the player's torso is inside water (drives swim physics).
        function playerInWater(){
          return getBlock(Math.floor(player.pos.x - WORLD_OFFSET.x),
                          Math.floor(player.pos.y + 0.9 - WORLD_OFFSET.y),
                          Math.floor(player.pos.z - WORLD_OFFSET.z)) === WATER;
        }
        // True when the camera eye is submerged → underwater screen tint.
        function eyeInWater(){
          if(!camera) return false;
          return getBlock(Math.floor(camera.position.x - WORLD_OFFSET.x),
                          Math.floor(camera.position.y - WORLD_OFFSET.y),
                          Math.floor(camera.position.z - WORLD_OFFSET.z)) === WATER;
        }
        let _uwEl = null;
        function setUnderwaterTint(on){
          if(!_uwEl){
            if(!on) return;
            _uwEl = document.createElement('div');
            _uwEl.id = 'voxel-underwater';
            (document.getElementById('gameContainer') || document.body).appendChild(_uwEl);
          }
          _uwEl.classList.toggle('vx-uw-on', !!on);
        }
        function boxCollides(px,py,pz){
          const {x:hx2,z:hz2}=player.half, h=player.height;
          for(let y=Math.floor(py); y<=Math.floor(py+h-.001); y++)
            for(let x=Math.floor(px-hx2); x<=Math.floor(px+hx2-.001); x++)
              for(let z=Math.floor(pz-hz2); z<=Math.floor(pz+hz2-.001); z++)
                if(solidAt(x+.5,y+.5,z+.5)) return true;
          return false;
        }
        // Any solid ground under the player footprint at (px,pz)? Used by crouch-sneak
        // to stop the player walking off a ledge (kid-friendly, Minecraft-style).
        function hasGroundBelow(px, py, pz){
          const {x:hx2, z:hz2} = player.half, y = py - 0.1;
          return solidAt(px-hx2, y, pz-hz2) || solidAt(px+hx2, y, pz-hz2)
              || solidAt(px-hx2, y, pz+hz2) || solidAt(px+hx2, y, pz+hz2)
              || solidAt(px, y, pz);
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
        const MOVE_RUN_SPEED = 6.4;
        const MOVE_ADS_SPEED = 1.7;
        const MOVE_CROUCH_MULT = 0.45;   // crouch walk speed factor
        let focusAimBlend = 0;
        let crouchBlend = 0;             // eased 0→1 while crouched (camera/avatar dip)
        let tpCamPos = null;
        let tpCamReady = false;
        let dragging = false, moved = 0, px = 0, py = 0, downBtn = 0;
        let wasLockedOnDown = false;
        let fireHeld = false;
        let laserCooldown = 0;
        const LASER_FIRE_INTERVAL = 0.065;
        const MINECUTTER_FIRE_INTERVAL = 0.072;
        let canvasEl = null;
        const _fpEyeOff = new THREE.Vector3();
        const _fpEyePos = new THREE.Vector3();

        function getFpCam() {
            if (!fpTune) fpTune = loadFpTune();
            if (!fpTune.cam) fpTune.cam = defaultFpCam();
            return fpTune.cam;
        }

        function getFpEyeWorld(out) {
            const c = getFpCam();
            return out.copy(player.pos).add(_fpEyeOff.set(c.eyeX || 0, c.eyeH - crouchBlend * 0.55, c.eyeZ || 0));
        }

        function applyFpCamToOrbit() {
            const c = getFpCam();
            orbit.theta = wrapAngleRad(c.theta);
            orbit.phi = c.phi;
            c.theta = orbit.theta;
        }

        function syncFpCamFromOrbit() {
            const c = getFpCam();
            c.theta = wrapAngleRad(orbit.theta);
            c.phi = orbit.phi;
        }

        function applyFpMouseLook(dx, dy) {
            if (!firstPerson || voxelPanelOpen()) return;
            const fc = getFpCam(), s = vxSettings.sens;
            orbit.theta -= dx * fc.aimSens * s;
            orbit.phi = Math.max(fc.pitchMin, Math.min(fc.pitchMax, orbit.phi - dy * fc.aimSens * s));
            player.yaw = orbit.theta + Math.PI;
        }

        function applyTpMouseOrbit(dx, dy) {
            if (firstPerson || voxelPanelOpen() || (!dx && !dy)) return;
            const tc = getTpCam(), s = vxSettings.sens;
            orbit.theta -= dx * tc.orbitSens * s;
            orbit.phi = Math.max(tc.pitchMin, Math.min(tc.pitchMax, orbit.phi - dy * tc.orbitSens * s));
        }

        // Mouse-fly: horizontal steers the ship, vertical points the nose (flight-stick:
        // pull back = nose up). The attitude HOLDS until the mouse moves it again.
        // Unclamped: keep pulling and the ship loops — full 360° in every direction.
        function applyFlightMouse(mx, my) {
            if (!ship) return;
            const s = vxSettings.sens;
            ship.yaw -= mx * 0.0024 * s * (ship.turnMul || 1);
            ship.pitchCmd = (ship.pitchCmd || 0) + my * 0.0030 * s;
        }

        function isViewPointerLocked() {
            return !!(canvasEl && document.pointerLockElement === canvasEl);
        }

        function requestViewPointerLock() {
            if (voxelPanelOpen() || !canvasEl) return;
            if (!isViewPointerLocked()) canvasEl.requestPointerLock();
        }

        function requestFpPointerLock() {
            if (!firstPerson || voxelPanelOpen()) return;
            requestViewPointerLock();
        }

        function restoreViewPointerLock() {
            if (voxelPanelOpen() || !canvasEl) return;
            // Browsers often drop pointer lock when the right mouse button is released;
            // defer re-lock until after that release finishes.
            setTimeout(() => {
                if (!voxelPanelOpen() && !isViewPointerLocked()) requestViewPointerLock();
            }, 0);
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
                sword:   { wx: -0.08, wy: -0.04, wz: -0.18, wrx: 0.92, wry: -2.75, wrz: -0.24, meleeRot: true },
                wrench:  { wx: -0.15, wy: -0.11, wz: -0.12, wrx: 1.33, wry: 0,     wrz: 0,    meleeRot: true },
                blaster: { wx: -0.09, wy: -0.05, wz: -0.2,  wrx: 0.22, wry: -0.05, wrz: -0.04, meleeRot: true },
                laser:   { wx: -0.08, wy: -0.12, wz: -0.18, wrx: 0.2,  wry: 0.02,  wrz: 0.03,  meleeRot: true },
                minecutter: { wx: -0.1, wy: 0.02, wz: -0.19, wrx: 0.14, wry: 0.12, wrz: -0.02, meleeRot: true },
                plasma:  { wx: -0.11, wy: 0.01,  wz: -0.21, wrx: 0.16, wry: 0.14,  wrz: -0.02, meleeRot: true },
                railgun: { wx: -0.13, wy: -0.07, wz: -0.18, wrx: 0.3,  wry: -0.03, wrz: -0.03, meleeRot: true }
            };
        }

        function defaultWeaponGameplayStats() {
            const out = {};
            weaponList().forEach((w) => {
                const s = w.stats || {};
                let power = (s.Damage || 5) / 10;
                let range = (s.Range || 5) / 10;
                if (w.id === 'minecutter') { power = 0.18; range = 0.4; }
                else if (w.id === 'laser') { power = 0.55; range = 0.88; }
                else if (w.id === 'pickaxe') { power = 0.42; range = 0.2; }
                out[w.id] = { power, range };
            });
            return out;
        }

        function mergeWeaponStats(saved) {
            const base = defaultWeaponGameplayStats();
            const out = {};
            Object.keys(base).forEach((id) => {
                out[id] = Object.assign({}, base[id], (saved && saved[id]) || {});
            });
            return out;
        }

        // ---- Weapon & tool tiers (5 levels each): the real progression, crafted at the Refinery ----
        // Per-weapon, per-level stats (keyed by in-game weapon id). The Laser Handgun
        // (minecutter) is the SOLE mining tool and deals NO combat damage; every other
        // weapon is combat-only (mining 0). Pickaxe is retired.
        //   power  — swing/fire interval factor (lower = snappier)
        //   speed  — fire/swing rate (display)
        //   dmg    — combat damage per hit
        //   mining — blocks/s at hardness 1 (minecutter only)
        const WEAPON_TIERS = {
            minecutter: { role: 'mining', tiers: [   // Laser Handgun — mining tool, 0 dmg
                { power: 0.18, speed: 8,  dmg: 0, mining: 6.3  },
                { power: 0.16, speed: 8,  dmg: 0, mining: 8.2  },
                { power: 0.14, speed: 9,  dmg: 0, mining: 10.5 },
                { power: 0.12, speed: 9,  dmg: 0, mining: 13.4 },
                { power: 0.10, speed: 10, dmg: 0, mining: 16.5 },
            ] },
            laser: { role: 'combat', tiers: [        // Laser Rifle
                { power: 0.55, speed: 8,  dmg: 8,  mining: 0 },
                { power: 0.50, speed: 8,  dmg: 10, mining: 0 },
                { power: 0.46, speed: 9,  dmg: 13, mining: 0 },
                { power: 0.42, speed: 9,  dmg: 16, mining: 0 },
                { power: 0.38, speed: 10, dmg: 20, mining: 0 },
            ] },
            wrench: { role: 'combat', tiers: [
                { power: 0.30, speed: 6, dmg: 4,  mining: 0 },
                { power: 0.28, speed: 6, dmg: 5,  mining: 0 },
                { power: 0.26, speed: 7, dmg: 7,  mining: 0 },
                { power: 0.24, speed: 7, dmg: 8,  mining: 0 },
                { power: 0.22, speed: 8, dmg: 10, mining: 0 },
            ] },
            sword: { role: 'combat', tiers: [        // Energy Sword
                { power: 0.80, speed: 7, dmg: 11, mining: 0 },
                { power: 0.74, speed: 7, dmg: 14, mining: 0 },
                { power: 0.68, speed: 8, dmg: 17, mining: 0 },
                { power: 0.62, speed: 8, dmg: 21, mining: 0 },
                { power: 0.56, speed: 9, dmg: 25, mining: 0 },
            ] },
            blaster: { role: 'combat', tiers: [      // Blaster Rifle
                { power: 0.50, speed: 6, dmg: 7,  mining: 0 },
                { power: 0.46, speed: 6, dmg: 9,  mining: 0 },
                { power: 0.42, speed: 7, dmg: 11, mining: 0 },
                { power: 0.38, speed: 7, dmg: 13, mining: 0 },
                { power: 0.34, speed: 8, dmg: 16, mining: 0 },
            ] },
            plasma: { role: 'combat', tiers: [       // Plasma Pistol
                { power: 0.40, speed: 7, dmg: 6,  mining: 0 },
                { power: 0.37, speed: 7, dmg: 8,  mining: 0 },
                { power: 0.34, speed: 8, dmg: 10, mining: 0 },
                { power: 0.31, speed: 8, dmg: 12, mining: 0 },
                { power: 0.28, speed: 9, dmg: 15, mining: 0 },
            ] },
            railgun: { role: 'combat', tiers: [      // slow, heavy hitter
                { power: 1.00, speed: 2, dmg: 14, mining: 0 },
                { power: 0.92, speed: 2, dmg: 18, mining: 0 },
                { power: 0.84, speed: 3, dmg: 22, mining: 0 },
                { power: 0.76, speed: 3, dmg: 27, mining: 0 },
                { power: 0.68, speed: 4, dmg: 33, mining: 0 },
            ] },
        };
        const TIER_NAME = { 1:'Mk I', 2:'Mk II', 3:'Mk III', 4:'Mk IV', 5:'Mk V' };
        // Materials to reach each tier (from the previous one). ids: 7 Metal, 10 Crystal, 30 Void Crystal, 33 Circuit.
        const UPGRADE_COST = {
            2:[{id:7,count:4},{id:10,count:2}],
            3:[{id:7,count:6},{id:10,count:4},{id:33,count:1}],
            4:[{id:7,count:9},{id:10,count:6},{id:33,count:2}],
            5:[{id:7,count:12},{id:10,count:9},{id:30,count:1},{id:33,count:3}],
        };
        const DRONE_COST   = { 2:[{id:7,count:3},{id:10,count:2}], 3:[{id:7,count:5},{id:10,count:3},{id:33,count:1}] };
        // Scanner range: tier 1..5 → 10..50 m, +10 m per upgrade.
        const SCANNER_COST = { 2:[{id:10,count:2},{id:7,count:1}], 3:[{id:10,count:3},{id:7,count:2}],
                               4:[{id:10,count:4},{id:7,count:2},{id:33,count:1}], 5:[{id:10,count:6},{id:7,count:3},{id:30,count:1}] };
        let _weaponTierCache = {};            // {id: 1..5}, mirrors profile (avoids per-frame localStorage)
        let _droneTierCache = 1, _scannerTierCache = 1;
        function refreshTierCache() {
            const AP = getProfileApi();
            if (!AP) return;
            const inv = (AP.load().inventory) || {};
            _weaponTierCache = inv.weaponTier || {};
            _droneTierCache = Math.max(1, Math.min(3, (inv.droneTier | 0) || 1));
            _scannerTierCache = Math.max(1, Math.min(5, (inv.scannerTier | 0) || 1));
        }
        function weaponTierOf(id) { return Math.max(1, Math.min(5, (_weaponTierCache[id] | 0) || 1)); }
        function scannerRange() { return _scannerTierCache * 10; }   // metres

        // Resolve a weapon's stats for its current crafted tier. Weapons absent from the
        // table (none ship today) get a neutral combat fallback.
        function weaponStatsFor(id) {
            const w = WEAPON_TIERS[id];
            const lvl = weaponTierOf(id);
            if (!w || !w.tiers || !w.tiers.length) {
                return { lvl, power: 0.5, speed: 5, dmg: 5, mining: 0, role: 'combat' };
            }
            const row = w.tiers[Math.max(0, Math.min(w.tiers.length - 1, lvl - 1))];
            return { lvl, power: row.power, speed: row.speed, dmg: row.dmg, mining: row.mining, role: w.role };
        }

        function weaponGameplayFor(id) {
            if (!fpTune) fpTune = loadFpTune();
            const defs = defaultWeaponGameplayStats();
            if (!fpTune.weaponStats) fpTune.weaponStats = mergeWeaponStats(null);
            if (!fpTune.weaponStats[id]) {
                fpTune.weaponStats[id] = Object.assign({}, defs[id] || { power: 0.5, range: 0.5 });
            }
            const st = weaponStatsFor(id);
            // Reach stays a per-weapon base (tier-independent; not part of the tier table).
            const range = Math.min(1, fpTune.weaponStats[id].range);
            return { power: st.power, speed: st.speed, dmg: st.dmg, mining: st.mining, range, role: st.role, lvl: st.lvl };
        }

        function currentAimReach() {
            if (!weaponDef) return AIM_REACH;
            const g = weaponGameplayFor(weaponDef.id);
            return AIM_REACH * THREE.MathUtils.clamp(g.range, 0.12, 1);
        }

        function defaultFpCam() {
            return {
                theta: 0.6,
                phi: 0.92,
                eyeH: 1.62,
                eyeX: 0,
                eyeZ: 0,
                fov: 55,
                adsFov: 49,
                aimSens: 0.0022,
                pitchMin: 0.12,
                pitchMax: 2.85
            };
        }

        function defaultFpTune() {
            return {
                dismissed: true,
                cam: defaultFpCam(),
                global: {
                    scale: 0.6,
                    px: 0.08, py: -0.22, pz: -0.64,
                    rx: 0.1, ry: 0, rz: 0.01,
                    mountRx: 0.37, mountYaw: 0.08, mountRz: 0.04
                },
                weapons: defaultWeaponTunes(),
                weaponStats: mergeWeaponStats(null)
            };
        }

        function loadFpTune() {
            try {
                const raw = localStorage.getItem(FP_TUNE_KEY);
                if (!raw) return defaultFpTune();
                const saved = JSON.parse(raw);
                const base = defaultFpTune();
                const cam = Object.assign({}, base.cam, saved.cam || {});
                if (typeof cam.theta === 'number') cam.theta = wrapAngleRad(cam.theta);
                const weapons = Object.assign({}, base.weapons, saved.weapons || {});
                const swordSaved = weapons.sword;
                if (swordSaved && typeof swordSaved.wrx === 'number' && swordSaved.wrx > 1.15) {
                    Object.assign(swordSaved, {
                        wx: base.weapons.sword.wx, wy: base.weapons.sword.wy, wz: base.weapons.sword.wz,
                        wrx: base.weapons.sword.wrx, wry: base.weapons.sword.wry, wrz: base.weapons.sword.wrz
                    });
                }
                return {
                    dismissed: !!saved.dismissed,
                    cam,
                    global: Object.assign({}, base.global, saved.global || {}),
                    weapons,
                    weaponStats: mergeWeaponStats(saved.weaponStats)
                };
            } catch (e) {
                return defaultFpTune();
            }
        }

        function saveFpTune(dismiss) {
            syncFpCamFromOrbit();
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
        let fpSwingDurationActive = fpSwingDuration;
        const FP_RANGED_RECOIL_STRENGTH = 0.05;
        let fpSwingDir = 1;
        let elapsed = 0;
        
        // ---------- mining / placing ----------
        const ray=new THREE.Raycaster();
        const AIM_REACH = 32.5;   // 5× base reach — scales shooting/mining/placement range for every weapon & tool

        function collectAimMeshes() {
          const meshes=[];
          scene3.chunks.forEach(c=>['static','anim','glass'].forEach(k=>{ if(c[k]) meshes.push(c[k]); }));
          return meshes;
        }

        // Voxel DDA (Amanatides–Woo): march the ray cell-by-cell through the block grid
        // instead of triangle-testing every loaded chunk mesh. Cost is O(reach), independent
        // of how dense the area is — the win is biggest underground / in forests, where the
        // old ray.intersectObjects() hit many high-triangle meshes at close range.
        // `dir` must be unit length. Fills + returns _vrHit on a hit, null on a miss.
        // Grid space = world − WORLD_OFFSET (a voxel x,y,z renders at x, y−SEA_LEVEL, z),
        // so the world hit point is simply origin + dir*t (the translation cancels).
        const _vrHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), x:0, y:0, z:0, id:0 };
        function voxelRaycast(origin, dir, maxDist) {
          const px = origin.x - WORLD_OFFSET.x, py = origin.y - WORLD_OFFSET.y, pz = origin.z - WORLD_OFFSET.z;
          const dx = dir.x, dy = dir.y, dz = dir.z;
          let ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
          const stepX = dx>0?1:(dx<0?-1:0), stepY = dy>0?1:(dy<0?-1:0), stepZ = dz>0?1:(dz<0?-1:0);
          const tDeltaX = dx!==0 ? Math.abs(1/dx) : Infinity;
          const tDeltaY = dy!==0 ? Math.abs(1/dy) : Infinity;
          const tDeltaZ = dz!==0 ? Math.abs(1/dz) : Infinity;
          let tMaxX = dx!==0 ? ((stepX>0 ? (ix+1-px) : (px-ix)) * tDeltaX) : Infinity;
          let tMaxY = dy!==0 ? ((stepY>0 ? (iy+1-py) : (py-iy)) * tDeltaY) : Infinity;
          let tMaxZ = dz!==0 ? ((stepZ>0 ? (iz+1-pz) : (pz-iz)) * tDeltaZ) : Infinity;
          let t = 0, nx = 0, ny = 0, nz = 0;
          const MAX_STEPS = Math.ceil(maxDist) + 3;
          for (let s = 0; s < MAX_STEPS; s++) {
            // step into the next cell across the nearest axis boundary; the face we cross
            // (opposite the step direction) is the struck face normal.
            if (tMaxX < tMaxY && tMaxX < tMaxZ) { ix += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
            else if (tMaxY < tMaxZ)             { iy += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
            else                                { iz += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
            if (t > maxDist) return null;
            const id = getBlock(ix, iy, iz);
            if (id && id !== WATER) {              // aim passes through water (not minable/scannable)
              _vrHit.x = ix; _vrHit.y = iy; _vrHit.z = iz; _vrHit.id = id;
              _vrHit.normal.set(nx, ny, nz);
              _vrHit.point.copy(origin).addScaledVector(dir, t);
              return _vrHit;
            }
          }
          return null;
        }

        const _shotDir = new THREE.Vector3();
        const _shotScratch = new THREE.Vector3();
        const _camPos = new THREE.Vector3();
        const _aimFar = new THREE.Vector3();

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

        // Single aim solve: crosshair raycast picks the target; trace runs muzzle → that point.
        function resolveAim() {
            syncAimRay();
            if (av && av.group && !firstPerson) av.group.updateMatrixWorld(true);
            if (!firstPerson && tpWeapon) tpWeapon.updateMatrixWorld(true);
            if (fpPivot && firstPerson) fpPivot.updateMatrixWorld(true);
            _aimState.origin.copy(getMuzzleWorldPos());

            ray.setFromCamera({ x: 0, y: 0 }, camera);
            const reach = currentAimReach();
            camera.getWorldPosition(_camPos);
            // +16: in third person the camera sits behind the player, so a target within
            // `reach` of the player can be farther from the camera; we filter by player dist below.
            const hit = voxelRaycast(ray.ray.origin, ray.ray.direction, reach + 16);
            const inRange = hit && hit.point.distanceTo(player.pos) <= reach;
            if (inRange) {
                _aimState.hasSurfaceHit = true;
                _aimState.normal.copy(hit.normal);
                _aimState.hit.copy(hit.point);
                _aimState.end.copy(hit.point);
            } else {
                _aimState.hasSurfaceHit = false;
                _aimState.normal.set(0, 1, 0);
                _aimFar.copy(_camPos).addScaledVector(_shotDir, reach);
                _aimState.hit.copy(_aimFar);
                _aimState.end.copy(_aimFar);
            }
            _aimState.len = Math.max(0.2, _aimState.origin.distanceTo(_aimState.end));
            _aimState.dir.copy(_aimState.end).sub(_aimState.origin).normalize();
            return _aimState;
        }

        function getAimWorldHit() {
            return resolveAim().end.clone();
        }

        function computeAimShot(origin, hit) {
            const len = Math.max(0.2, origin.distanceTo(hit));
            const dir = _shotScratch.copy(hit).sub(origin).normalize();
            return { dir, len, end: hit.clone() };
        }

        function pickTarget(){
          ray.setFromCamera({x:0,y:0}, camera);
          const reach = currentAimReach();
          // +16 so a target within reach of the player is still found from the (TP) camera; filtered below.
          const hit = voxelRaycast(ray.ray.origin, ray.ray.direction, reach + 16);
          if(!hit) return null;
          if(hit.point.distanceTo(player.pos) > reach) return null;
          // DDA already gives the struck cell and an integer face normal — no flooring/nudge needed.
          const place = { x: hit.x + hit.normal.x, y: hit.y + hit.normal.y, z: hit.z + hit.normal.z };
          return { x: hit.x, y: hit.y, z: hit.z, place };
        }

        let aimOutline = null;
        let aimOutlineKey = '';
        let aimOutlineMat = null;
        let _aimShownTarget = null;
        let _aimCandidateTarget = null;
        let _aimCandidateFrames = 0;

        // Unit-cube edges only — each entry is [cornerA, cornerB, faceDirA, faceDirB].
        const AIM_CUBE_EDGES = [
            [[0,0,0],[1,0,0], [0,-1,0], [0,0,-1]],
            [[0,1,0],[1,1,0], [0, 1,0], [0,0,-1]],
            [[0,0,1],[1,0,1], [0,-1,0], [0,0, 1]],
            [[0,1,1],[1,1,1], [0, 1,0], [0,0, 1]],
            [[0,0,0],[0,1,0], [-1,0,0], [0,0,-1]],
            [[1,0,0],[1,1,0], [ 1,0,0], [0,0,-1]],
            [[0,0,1],[0,1,1], [-1,0,0], [0,0, 1]],
            [[1,0,1],[1,1,1], [ 1,0,0], [0,0, 1]],
            [[0,0,0],[0,0,1], [-1,0,0], [0,-1,0]],
            [[1,0,0],[1,0,1], [ 1,0,0], [0,-1,0]],
            [[0,1,0],[0,1,1], [-1,0,0], [0, 1,0]],
            [[1,1,0],[1,1,1], [ 1,0,0], [0, 1,0]]
        ];

        function isFaceExposed(x, y, z, face, blockId) {
            const [dx, dy, dz] = face.dir;
            const nid = getBlock(x + dx, y + dy, z + dz);
            if (!nid) return true;
            const nb = blockById(nid);
            if (!nb || !nb.transparent) return false;
            return nid !== blockId;
        }

        function isDirExposed(x, y, z, dx, dy, dz, blockId) {
            for (const face of FACES) {
                if (face.dir[0] === dx && face.dir[1] === dy && face.dir[2] === dz) {
                    return isFaceExposed(x, y, z, face, blockId);
                }
            }
            return false;
        }

        function getAimTune() {
            if (!aimTune) aimTune = loadAimTune();
            return aimTune;
        }

        function positionAimCorner(vx, vy, vz, expand) {
            if (!expand) return [vx, vy, vz];
            return [
                vx + (vx - 0.5) * expand * 2,
                vy + (vy - 0.5) * expand * 2,
                vz + (vz - 0.5) * expand * 2
            ];
        }

        function stabilizeAimTarget(raw) {
            if (!raw || !getBlock(raw.x, raw.y, raw.z)) {
                _aimShownTarget = null;
                _aimCandidateTarget = null;
                _aimCandidateFrames = 0;
                return null;
            }
            const key = `${raw.x},${raw.y},${raw.z}`;
            const candKey = _aimCandidateTarget
                ? `${_aimCandidateTarget.x},${_aimCandidateTarget.y},${_aimCandidateTarget.z}` : '';
            if (key === candKey) _aimCandidateFrames++;
            else {
                _aimCandidateTarget = raw;
                _aimCandidateFrames = 1;
            }
            if (_aimCandidateFrames >= 2) _aimShownTarget = _aimCandidateTarget;
            return _aimShownTarget;
        }

        const _aimEdgeDir = new THREE.Vector3();
        const _aimEdgeUp = new THREE.Vector3();
        const _aimFaceN = new THREE.Vector3();

        function aimOutwardPerp(edgeDir, faceDir, mx, my, mz) {
            _aimFaceN.set(faceDir[0], faceDir[1], faceDir[2]);
            _aimEdgeUp.crossVectors(edgeDir, _aimFaceN);
            if (_aimEdgeUp.lengthSq() < 1e-10) return false;
            _aimEdgeUp.normalize();
            if (_aimEdgeUp.x * mx + _aimEdgeUp.y * my + _aimEdgeUp.z * mz < 0) _aimEdgeUp.negate();
            return true;
        }

        // Stroke sits in the face crease (bisector of adjacent face normals), not flat on a face.
        function pushAimStrokeQuad(pos, idx, ax, ay, az, bx, by, bz, halfW, d1, d2, d1On, d2On) {
            _aimEdgeDir.set(bx - ax, by - ay, bz - az);
            if (_aimEdgeDir.lengthSq() < 1e-10) return;
            _aimEdgeDir.normalize();
            const mx = (ax + bx) * 0.5 - 0.5;
            const my = (ay + by) * 0.5 - 0.5;
            const mz = (az + bz) * 0.5 - 0.5;
            let sx = 0, sy = 0, sz = 0, n = 0;
            if (d1On && aimOutwardPerp(_aimEdgeDir, d1, mx, my, mz)) {
                sx += _aimEdgeUp.x; sy += _aimEdgeUp.y; sz += _aimEdgeUp.z; n++;
            }
            if (d2On && aimOutwardPerp(_aimEdgeDir, d2, mx, my, mz)) {
                sx += _aimEdgeUp.x; sy += _aimEdgeUp.y; sz += _aimEdgeUp.z; n++;
            }
            if (!n) return;
            const len = Math.hypot(sx, sy, sz);
            if (len < 1e-8) return;
            sx = sx / len * halfW;
            sy = sy / len * halfW;
            sz = sz / len * halfW;
            const a1x = ax + sx, a1y = ay + sy, a1z = az + sz;
            const a2x = ax - sx, a2y = ay - sy, a2z = az - sz;
            const b1x = bx + sx, b1y = by + sy, b1z = bz + sz;
            const b2x = bx - sx, b2y = by - sy, b2z = bz - sz;
            const base = pos.length / 3;
            pos.push(
                a1x, a1y, a1z, b1x, b1y, b1z, a2x, a2y, a2z,
                b1x, b1y, b1z, b2x, b2y, b2z, a2x, a2y, a2z
            );
            idx.push(base, base + 1, base + 2, base + 3, base + 4, base + 5);
        }

        function buildAimOutlineMeshData(x, y, z) {
            const blockId = getBlock(x, y, z);
            if (!blockId) return null;
            const tune = getAimTune();
            const expand = tune.expand || 0;
            const halfW = Math.max(0.0008, (tune.strokeWidth ?? 0.022) * 0.5);
            const pos = [];
            const idx = [];
            for (const [a, b, d1, d2] of AIM_CUBE_EDGES) {
                const d1On = isDirExposed(x, y, z, d1[0], d1[1], d1[2], blockId);
                const d2On = isDirExposed(x, y, z, d2[0], d2[1], d2[2], blockId);
                if (!d1On && !d2On) continue;
                const pa = positionAimCorner(a[0], a[1], a[2], expand);
                const pb = positionAimCorner(b[0], b[1], b[2], expand);
                pushAimStrokeQuad(pos, idx, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], halfW, d1, d2, d1On, d2On);
            }
            return pos.length ? { pos, idx } : null;
        }

        function applyAimOutlineStyle(cracking) {
            if (!aimOutlineMat) return;
            const t = getAimTune();
            const pulseWave = 0.78 + 0.22 * Math.sin(elapsed * (t.pulseHz || 7));
            aimOutlineMat.opacity = Math.min(1,
                (t.opacity ?? 0.55) + pulseWave * (t.pulse ?? 0.25) + cracking * (t.mineGlow ?? 0.2));
            _aimBaseCol.set(t.color || '#5ce8ff');
            _aimMineCol.set(t.mineColor || '#7af0ff');
            aimOutlineMat.color.copy(_aimBaseCol);
            if (cracking > 0.01) aimOutlineMat.color.lerp(_aimMineCol, Math.min(1, cracking));
        }

        function refreshAimOutlineGeometry() {
            if (!aimOutlineKey) return;
            const parts = aimOutlineKey.split(',');
            if (parts.length !== 3) return;
            rebuildAimEdgeHighlight(+parts[0], +parts[1], +parts[2]);
        }

        function ensureAimOutlineMat() {
            if (aimOutlineMat) return;
            aimOutlineMat = new THREE.MeshBasicMaterial({
                color: 0x5ce8ff,
                transparent: true,
                opacity: 0.9,
                side: THREE.DoubleSide,
                depthTest: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1
            });
        }

        function disposeAimEdgeHighlight() {
            if (!aimOutline) {
                aimOutlineKey = '';
                return;
            }
            scene.remove(aimOutline);
            aimOutline.geometry.dispose();
            aimOutline = null;
            aimOutlineKey = '';
        }

        function rebuildAimEdgeHighlight(x, y, z) {
            const data = buildAimOutlineMeshData(x, y, z);
            if (aimOutline) {
                scene.remove(aimOutline);
                aimOutline.geometry.dispose();
                aimOutline = null;
            }
            if (!data) {
                aimOutlineKey = '';
                return;
            }
            ensureAimOutlineMat();
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
            geo.setIndex(data.idx);
            aimOutline = new THREE.Mesh(geo, aimOutlineMat);
            aimOutline.frustumCulled = false;
            aimOutline.renderOrder = 200;
            aimOutline.position.set(WORLD_OFFSET.x + x, WORLD_OFFSET.y + y, WORLD_OFFSET.z + z);
            scene.add(aimOutline);
            aimOutlineKey = `${x},${y},${z}`;
        }

        function updateAimEdgeHighlight(t) {
            if (voxelPanelOpen() || !isMiningTool()) {
                if (aimOutline) aimOutline.visible = false;
                return;
            }
            if (isMineLaser() && mineTarget && mineProgress > 0.001) {
                t = mineTarget;
            } else {
                t = stabilizeAimTarget(t);
            }
            if (!t) {
                if (aimOutline) aimOutline.visible = false;
                return;
            }
            const key = `${t.x},${t.y},${t.z}`;
            if (key !== aimOutlineKey) rebuildAimEdgeHighlight(t.x, t.y, t.z);
            if (!aimOutline) return;
            const cracking = mineTarget && mineTarget.x === t.x && mineTarget.y === t.y && mineTarget.z === t.z
                ? mineProgress : 0;
            applyAimOutlineStyle(cracking);
            aimOutline.visible = true;
        }

        let mineBlockFx = null;
        let mineBlockFxKey = '';
        const _mineFxBaseCol = new THREE.Color();
        const _mineFxAccentCol = new THREE.Color();
        const MINE_FX_CRACK_COUNT = 6;

        function mineFxAccentHex() {
            if (weaponDef && weaponDef.id === 'minecutter') return 0x66e8ff;
            if (weaponDef && weaponDef.id === 'laser') return 0xff6080;
            return 0x66e8ff;
        }

        function buildMineBlockFx() {
            const g = new THREE.Group();
            g.frustumCulled = false;
            g.renderOrder = 155;

            const shellMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.42,
                depthWrite: false
            });
            const shell = new THREE.Mesh(new THREE.BoxGeometry(1.008, 1.008, 1.008), shellMat);
            g.add(shell);

            const edgeMat = new THREE.LineBasicMaterial({
                color: 0x66e8ff,
                transparent: true,
                opacity: 0.85
            });
            const edges = new THREE.LineSegments(
                new THREE.EdgesGeometry(new THREE.BoxGeometry(1.018, 1.018, 1.018)),
                edgeMat
            );
            g.add(edges);

            const cracks = [];
            for (let i = 0; i < MINE_FX_CRACK_COUNT; i++) {
                const crackMat = new THREE.MeshBasicMaterial({
                    color: 0x0a1020,
                    transparent: true,
                    opacity: 0.88
                });
                const crack = new THREE.Mesh(
                    new THREE.BoxGeometry(0.018, 0.42 + (i % 3) * 0.12, 0.018),
                    crackMat
                );
                crack.rotation.set(
                    (i * 1.17) % Math.PI,
                    (i * 2.03) % Math.PI,
                    (i * 0.81) % Math.PI
                );
                crack.position.set(
                    ((i * 0.37) % 1) - 0.5,
                    ((i * 0.53) % 1) - 0.5,
                    ((i * 0.29) % 1) - 0.5
                );
                crack.visible = false;
                g.add(crack);
                cracks.push(crack);
            }

            const burnMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.9,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const burn = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), burnMat);
            g.add(burn);

            g.userData = { shell, shellMat, edges, edgeMat, cracks, burn, burnMat, baseCol: new THREE.Color() };
            scene.add(g);
            return g;
        }

        function disposeMineBlockFx() {
            if (!mineBlockFx) return;
            scene.remove(mineBlockFx);
            mineBlockFx.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
                    else o.material.dispose();
                }
            });
            mineBlockFx = null;
            mineBlockFxKey = '';
        }

        function updateMineBlockAnim() {
            const active = mineTarget && mineProgress > 0.001 && isMineLaser() && !voxelPanelOpen();
            if (!active) {
                if (mineBlockFx) mineBlockFx.visible = false;
                return;
            }
            const { x, y, z } = mineTarget;
            const id = getBlock(x, y, z);
            if (!id) {
                if (mineBlockFx) mineBlockFx.visible = false;
                return;
            }

            if (!mineBlockFx) mineBlockFx = buildMineBlockFx();
            const ud = mineBlockFx.userData;
            const key = `${x},${y},${z}`;
            if (key !== mineBlockFxKey) {
                mineBlockFxKey = key;
                ud.baseCol.setHex(blockColor(id));
                ud.shellMat.color.copy(ud.baseCol);
            }

            const p = mineProgress;
            const accent = mineFxAccentHex();
            const pulse = 0.5 + 0.5 * Math.sin(elapsed * 26);
            const shake = p * 0.024;
            const t = elapsed;
            mineBlockFx.position.set(
                WORLD_OFFSET.x + x + 0.5 + Math.sin(t * 53) * shake,
                WORLD_OFFSET.y + y + 0.5 + Math.sin(t * 47 + 1.2) * shake,
                WORLD_OFFSET.z + z + 0.5 + Math.cos(t * 41) * shake
            );

            const shrink = 1 - p * 0.13;
            const wobble = p * 0.07;
            ud.shell.rotation.set(Math.sin(t * 9) * wobble, Math.cos(t * 8) * wobble, Math.sin(t * 11) * wobble * 0.5);
            ud.shell.scale.setScalar(shrink * (1 - pulse * 0.018 * p));

            _mineFxAccentCol.setHex(accent);
            ud.shellMat.color.copy(ud.baseCol).lerp(_mineFxAccentCol, p * 0.45 * (0.55 + pulse * 0.45));
            ud.shellMat.opacity = 0.14 + p * 0.38 + pulse * 0.14 * p;

            ud.edgeMat.color.setHex(accent);
            ud.edgeMat.opacity = 0.3 + p * 0.7;
            ud.edges.rotation.copy(ud.shell.rotation);
            ud.edges.scale.setScalar(shrink * 1.012);

            ud.cracks.forEach((crack, i) => {
                const threshold = (i + 1) / (MINE_FX_CRACK_COUNT + 1.5);
                const show = p > threshold * 0.85;
                crack.visible = show;
                if (show) {
                    crack.material.opacity = Math.min(1, (p - threshold * 0.7) * 2.2);
                    crack.scale.set(1, shrink * (0.55 + p * 0.65), 1);
                    crack.rotation.z += 0.002 * (i + 1);
                }
            });

            const aim = resolveAim();
            const aimT = pickTarget();
            const hitSame = aim.hasSurfaceHit && aimT
                && aimT.x === x && aimT.y === y && aimT.z === z;
            if (hitSame) {
                ud.burn.position.set(
                    aim.normal.x * 0.44,
                    aim.normal.y * 0.44,
                    aim.normal.z * 0.44
                );
            } else {
                ud.burn.position.set(0, 0, 0);
            }
            ud.burn.visible = p > 0.02;
            ud.burnMat.color.setHex(accent);
            ud.burnMat.opacity = 0.35 + pulse * 0.6 * p;
            const burnS = (0.07 + p * 0.22) * (1 + pulse * 0.4);
            ud.burn.scale.setScalar(burnS);
            ud.burn.rotation.copy(ud.shell.rotation);

            mineBlockFx.visible = true;
        }

        function canPlaceBlockAt(x, y, z) {
            if (getBlock(x, y, z)) return false;
            const wx = x + WORLD_OFFSET.x, wy = y + WORLD_OFFSET.y, wz = z + WORLD_OFFSET.z;
            const p = player.pos;
            if (wx + 1 > p.x - player.half.x && wx < p.x + player.half.x &&
                wz + 1 > p.z - player.half.z && wz < p.z + player.half.z &&
                wy + 1 > p.y && wy < p.y + player.height) return false;
            return true;
        }

        function ensurePlaceGhost() {
            if (placeGhost) return;
            placeGhost = new THREE.Mesh(
                new THREE.BoxGeometry(1.002, 1.002, 1.002),
                new THREE.MeshBasicMaterial({
                    color: 0x66ff88,
                    transparent: true,
                    opacity: 0.36,
                    depthWrite: false
                })
            );
            placeGhost.frustumCulled = false;
            scene.add(placeGhost);
        }

        function disposePlaceGhost() {
            if (!placeGhost) return;
            scene.remove(placeGhost);
            placeGhost.geometry.dispose();
            placeGhost.material.dispose();
            placeGhost = null;
        }

        let _scanBlockId = -1;
        let scanExpanded = false;
        let _scanSticky = null;
        const _scanWorld = new THREE.Vector3();
        const _scanWorld2 = new THREE.Vector3(), _scanRight = new THREE.Vector3();

        function isScanCompactActive(t) {
            return !voxelPanelOpen() && canScanBlocks() && focusAimBlend > 0.08
                && t && getBlock(t.x, t.y, t.z);
        }

        function fillScanTags(tagsEl, tags, full) {
            if (!tagsEl) return;
            tagsEl.innerHTML = '';
            const list = tags || [];
            const show = full ? list : list.slice(0, 4);
            show.forEach((tag) => {
                const chip = document.createElement('span');
                chip.className = 'vx-scan-tag';
                chip.textContent = tag;
                tagsEl.appendChild(chip);
            });
            if (!full && list.length > show.length) {
                const more = document.createElement('span');
                more.className = 'vx-scan-tag';
                more.textContent = `+${list.length - show.length}`;
                tagsEl.appendChild(more);
            }
        }

        // Danish names shown under the English name in the scanner — a play-to-learn-English
        // anchor. English is the hero; Danish is the support word the player already knows.
        const BLOCK_DA = {
            'Dirt': 'Jord', 'Grass': 'Græs', 'Stone': 'Sten', 'Sand': 'Sand', 'Gravel': 'Grus',
            'Regolith': 'Regolit', 'Red Rock': 'Rød sten', 'Basalt': 'Basalt', 'Obsidian': 'Obsidian',
            'Ice': 'Is', 'Snow': 'Sne', 'Wood': 'Træ', 'Leaves': 'Blade',
            'Frond': 'Bregneblad', 'Spore': 'Spore', 'Quill': 'Pig', 'Plume': 'Fjerbusk',
            'Fungal': 'Svamp', 'Hive': 'Bistade',
            'Carbon': 'Kulstof', 'Copper Ore': 'Kobbermalm', 'Iron Ore': 'Jernmalm',
            'Gold Ore': 'Guldmalm', 'Titanium Ore': 'Titanmalm', 'Cobalt': 'Kobolt',
            'Uranium Ore': 'Uranmalm', 'Aether Ore': 'Ætermalm',
            'Crystal': 'Krystal', 'Emerald Crystal': 'Smaragdkrystal', 'Void Crystal': 'Tomrumskrystal',
            'Metal': 'Metal', 'Alloy': 'Legering', 'Glass': 'Glas', 'Circuit': 'Kredsløb',
            'Lamp': 'Lampe', 'Hull': 'Skrog', 'Door': 'Dør', 'Door Open': 'Åben dør',
            'Energy': 'Energi', 'Gate Key': 'Portnøgle', 'TNT': 'Dynamit',
            'Lava': 'Lava', 'Acid': 'Syre', 'Water': 'Vand',
            'Lava Flow': 'Lavastrøm', 'Ash': 'Aske', 'Magma Rock': 'Magmasten', 'Ancient Ruins': 'Oldtidsruiner',
            'Volcano': 'Vulkan', 'Fire Cave': 'Ildhule',
            'Mosshorn': 'Moshorn', 'Frostmane': 'Frostmanke', 'Driftjelly': 'Drivgople',
            'Sporeling': 'Sporeyngel', 'Skate': 'Svæverokke', 'Glowmoth': 'Lysmøl',
            'Sentinel': 'Vagtdrone', 'Curator': 'Kurator', 'Warden': 'Vogter',
            'Cinderhound': 'Glødehund', 'Razorpede': 'Klingekryb', 'Dustwurm': 'Støvorm'
        };

        function fillScanPanelContent(b, id, cracking, expanded) {
            const catEl = document.getElementById('voxel-scan-cat');
            const nameEl = document.getElementById('voxel-scan-name');
            const descEl = document.getElementById('voxel-scan-desc');
            const formulaEl = document.getElementById('voxel-scan-formula');
            const mineralEl = document.getElementById('voxel-scan-mineral');
            const factEl = document.getElementById('voxel-scan-fact');
            const tagsEl = document.getElementById('voxel-scan-tags');
            const thumbEl = document.getElementById('voxel-scan-thumb');
            const metaEl = document.getElementById('voxel-scan-meta');
            const badgeText = document.querySelector('.vx-scan-badge-text');
            const dots = document.querySelector('.vx-scan-dots');
            const compactHint = document.getElementById('voxel-scan-compact-hint');
            const closeHint = document.getElementById('voxel-scan-close-hint');

            if (catEl) catEl.textContent = `${CAT_ICONS[b.cat] || '▪'} ${b.cat || ''}`;
            if (nameEl) {
                const da = BLOCK_DA[b.name];
                nameEl.innerHTML = b.name + (da
                    ? `<span class="vx-scan-da" style="display:block;font-size:0.66em;font-weight:600;letter-spacing:0;opacity:0.7;color:#7fd4ff;margin-top:2px;">🇩🇰 ${da}</span>`
                    : '');
            }
            if (descEl) descEl.textContent = b.desc || '';
            const formulaText = (b.sci && b.sci.formula) || '—';
            if (formulaEl) formulaEl.textContent = formulaText;
            setFormulaVisual(formulaText);
            if (mineralEl) mineralEl.textContent = (b.sci && b.sci.mineral) || '—';
            if (factEl) factEl.textContent = (b.sci && b.sci.fact) || '';
            if (thumbEl) thumbEl.style.backgroundImage = `url(${thumbUrl(id)})`;
            fillScanTags(tagsEl, b.tags, expanded);
            if (metaEl) {
                let meta = `Hardness ${b.hardness ?? '?'}`;
                if (cracking > 0.01) meta += ` · Mining ${Math.round(cracking * 100)}%`;
                metaEl.textContent = meta;
            }
            if (badgeText) badgeText.textContent = expanded ? 'Block Analysis' : 'Scanning';
            if (dots) dots.style.display = expanded ? 'none' : '';
            if (compactHint) compactHint.hidden = expanded;
            if (closeHint) closeHint.hidden = !expanded;
        }

        function resizeFormulaCanvas(expanded) {
            const size = expanded ? { w: 200, h: 152 } : { w: 168, h: 128 };
            const canvas = document.getElementById('voxel-scan-formula-canvas');
            if (!canvas) return;
            if (canvas.width === size.w && canvas.height === size.h) return;
            canvas.width = size.w;
            canvas.height = size.h;
            if (formulaViewer.renderer) {
                formulaViewer.renderer.setSize(size.w, size.h, false);
                formulaViewer.camera.aspect = size.w / size.h;
                formulaViewer.camera.updateProjectionMatrix();
            }
        }

        function layoutScanExpanded() {
            const panel = document.getElementById('voxel-scan');
            if (!panel) return;
            const h = window.innerHeight;
            panel.style.left = '50%';
            panel.style.top = '50%';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.transform = 'translate(-50%, -50%)';
            panel.style.height = 'auto';
            panel.style.maxHeight = `${Math.min(h * 0.82, h - 40)}px`;
            const fit = panel.querySelector('.vx-scan-fit');
            if (fit) fit.style.transform = 'none';
        }

        function setScanExpanded(on) {
            const next = !!on;
            if (scanExpanded === next) return;
            scanExpanded = next;
            const backdrop = document.getElementById('voxel-scan-backdrop');
            const panel = document.getElementById('voxel-scan');
            if (backdrop) backdrop.hidden = !scanExpanded;
            if (panel) panel.classList.toggle('vx-scan-expanded', scanExpanded);
            resizeFormulaCanvas(scanExpanded);
            if (scanExpanded) {
                if (isViewPointerLocked()) {
                    releasePointerLock();
                    syncViewCursor();
                }
                if (_scanBlockId >= 0) {
                    const b = blockById(_scanBlockId);
                    if (b) fillScanPanelContent(b, _scanBlockId, 0, true);
                }
                layoutScanExpanded();
            } else {
                _scanSticky = null;
                if (panel) {
                    panel.style.left = '0';
                    panel.style.top = '0';
                    panel.style.transform = 'none';
                    panel.style.height = '';
                    panel.style.maxHeight = '';
                }
                if (_scanBlockId >= 0) {
                    const b = blockById(_scanBlockId);
                    if (b) fillScanPanelContent(b, _scanBlockId, 0, false);
                }
            }
        }

        const FORMULA_SUB = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
        const FORMULA_ELM = {
            H: { color: 0xf2f6ff, r: 0.18, name: 'Hydrogen' },
            C: { color: 0x505050, r: 0.28, name: 'Carbon' },
            N: { color: 0x4a6dff, r: 0.27, name: 'Nitrogen' },
            O: { color: 0xff4a4a, r: 0.26, name: 'Oxygen' },
            S: { color: 0xffd84a, r: 0.3, name: 'Sulfur' },
            P: { color: 0xff8a2a, r: 0.3, name: 'Phosphorus' },
            F: { color: 0x7aff9a, r: 0.24, name: 'Fluorine' },
            Cl: { color: 0x62d962, r: 0.32, name: 'Chlorine' },
            Si: { color: 0xd4b896, r: 0.32, name: 'Silicon' },
            Al: { color: 0xb8b8c8, r: 0.32, name: 'Aluminum' },
            Fe: { color: 0xff8844, r: 0.32, name: 'Iron' },
            Cu: { color: 0xd4885a, r: 0.32, name: 'Copper' },
            Au: { color: 0xffd700, r: 0.34, name: 'Gold' },
            Ti: { color: 0xb8c0c8, r: 0.32, name: 'Titanium' },
            Co: { color: 0x6a8fd8, r: 0.32, name: 'Cobalt' },
            Mg: { color: 0x8fd88f, r: 0.3, name: 'Magnesium' },
            Na: { color: 0x8a9aff, r: 0.34, name: 'Sodium' },
            K: { color: 0x9a7aff, r: 0.38, name: 'Potassium' },
            Ca: { color: 0xb8c8d8, r: 0.34, name: 'Calcium' },
            Be: { color: 0xa8d8a8, r: 0.28, name: 'Beryllium' },
            U: { color: 0x62ff62, r: 0.34, name: 'Uranium' },
            Ga: { color: 0xc8b8d8, r: 0.32, name: 'Gallium' },
            As: { color: 0xbd80e3, r: 0.32, name: 'Arsenic' }
        };
        function countsKey(counts) {
            return Object.entries(counts)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([el, n]) => el + n)
                .join('');
        }

        const FORMULA_PRESETS = {
            H2O1: {
                atoms: [
                    { el: 'O', pos: [0, 0, 0] },
                    { el: 'H', pos: [0.78, 0.58, 0] },
                    { el: 'H', pos: [-0.78, 0.58, 0] }
                ],
                bonds: [[0, 1], [0, 2]]
            },
            C1O2: {
                atoms: [
                    { el: 'C', pos: [0, 0, 0] },
                    { el: 'O', pos: [-1.05, 0, 0] },
                    { el: 'O', pos: [1.05, 0, 0] }
                ],
                bonds: [[0, 1], [0, 2]]
            },
            O2Si1: {
                atoms: [
                    { el: 'Si', pos: [0, 0, 0] },
                    { el: 'O', pos: [0.9, 0.55, 0] },
                    { el: 'O', pos: [-0.9, 0.55, 0] }
                ],
                bonds: [[0, 1], [0, 2]]
            },
            Fe2O3: {
                atoms: [
                    { el: 'Fe', pos: [0, 0.45, 0] },
                    { el: 'Fe', pos: [-0.78, -0.45, 0] },
                    { el: 'Fe', pos: [0.78, -0.45, 0] },
                    { el: 'O', pos: [0, -0.15, 0.85] },
                    { el: 'O', pos: [-0.68, 0.15, -0.55] },
                    { el: 'O', pos: [0.68, 0.15, -0.55] }
                ],
                bonds: [[0, 3], [0, 4], [1, 4], [1, 5], [2, 3], [2, 5]]
            },
            H2O4S1: {
                atoms: [
                    { el: 'S', pos: [0, 0, 0] },
                    { el: 'O', pos: [0.95, 0.35, 0] },
                    { el: 'O', pos: [-0.95, 0.35, 0] },
                    { el: 'O', pos: [0, -0.55, 0.85] },
                    { el: 'O', pos: [0, -0.55, -0.85] },
                    { el: 'H', pos: [0.35, -1.05, 1.05] },
                    { el: 'H', pos: [0.35, -1.05, -1.05] }
                ],
                bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [3, 5], [4, 6]]
            },
            Ga1N1: {
                atoms: [
                    { el: 'Ga', pos: [-0.55, 0, 0] },
                    { el: 'N', pos: [0.55, 0, 0] }
                ],
                bonds: [[0, 1]]
            }
        };

        function formulaElm(sym) {
            return FORMULA_ELM[sym] || { color: 0x9eb8c4, r: 0.3, name: sym };
        }

        function parseFormulaCounts(raw) {
            if (!raw || raw === '—' || raw === '??' || /unknown/i.test(raw)) return null;
            let s = String(raw).split('+')[0].trim();
            s = s.replace(/\([^)]*(amorphous|organic|coating|traces)[^)]*\)/gi, '');
            s = s.replace(/[~%].*$/, '').trim();
            for (const ch in FORMULA_SUB) s = s.split(ch).join(FORMULA_SUB[ch]);
            s = s.replace(/\(n\)|ₙ/gi, '').replace(/[()]/g, '');
            if (/ on /i.test(raw)) {
                const bits = raw.split(/\s+on\s+/i);
                const counts = {};
                bits.forEach((bit) => {
                    const part = parseFormulaCounts(bit.trim());
                    if (part) Object.entries(part).forEach(([el, n]) => { counts[el] = (counts[el] || 0) + n; });
                });
                return Object.keys(counts).length ? counts : null;
            }
            const counts = {};
            const re = /([A-Z][a-z]?)(\d*)/g;
            let m;
            while ((m = re.exec(s))) {
                const el = m[1];
                const n = m[2] ? parseInt(m[2], 10) : 1;
                if (!n || Number.isNaN(n)) continue;
                counts[el] = (counts[el] || 0) + n;
            }
            return Object.keys(counts).length ? counts : null;
        }

        function formulaBreakdownText(counts) {
            return Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .map(([el, n]) => `${n} × ${formulaElm(el).name}`)
                .join(' · ');
        }

        function expandFormulaAtoms(counts, maxAtoms) {
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            const scale = total > maxAtoms ? maxAtoms / total : 1;
            const atoms = [];
            Object.entries(counts).forEach(([el, n]) => {
                const c = Math.max(1, Math.round(n * scale));
                for (let i = 0; i < c; i++) atoms.push(el);
            });
            while (atoms.length > maxAtoms) atoms.pop();
            return atoms;
        }

        function goldenSpherePositions(n, radius) {
            const pts = [];
            const phi = Math.PI * (3 - Math.sqrt(5));
            for (let i = 0; i < n; i++) {
                const y = 1 - (i / Math.max(1, n - 1)) * 2;
                const r = Math.sqrt(Math.max(0, 1 - y * y));
                const theta = phi * i;
                pts.push(new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius));
            }
            return pts;
        }

        function addBond(group, a, b, bondMats) {
            const dir = new THREE.Vector3().subVectors(b, a);
            const len = dir.length();
            if (len < 0.05) return;
            const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
            const cyl = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.05, len, 8),
                bondMats[(a.x + b.x + a.y + b.y) & 1]
            );
            cyl.position.copy(mid);
            cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
            group.add(cyl);
        }

        function buildFormulaMolecule(counts) {
            const key = countsKey(counts);
            const preset = FORMULA_PRESETS[key];
            const group = new THREE.Group();
            const atomMeshes = [];
            const bondMats = [
                new THREE.MeshPhongMaterial({ color: 0x8ab4c4, transparent: true, opacity: 0.55, shininess: 20 }),
                new THREE.MeshPhongMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.45, shininess: 20 })
            ];

            if (preset) {
                const positions = preset.atoms.map((a) => new THREE.Vector3(...a.pos));
                preset.atoms.forEach((a, i) => {
                    const info = formulaElm(a.el);
                    const mesh = new THREE.Mesh(
                        new THREE.SphereGeometry(info.r, 16, 12),
                        new THREE.MeshPhongMaterial({ color: info.color, shininess: 40, specular: 0x334455 })
                    );
                    mesh.position.copy(positions[i]);
                    group.add(mesh);
                    atomMeshes.push(mesh);
                });
                (preset.bonds || []).forEach(([i, j]) => addBond(group, positions[i], positions[j], bondMats));
            } else {
                const els = expandFormulaAtoms(counts, 24);
                const positions = goldenSpherePositions(els.length, 1.05);
                const pts = [];
                els.forEach((el, i) => {
                    const info = formulaElm(el);
                    const mesh = new THREE.Mesh(
                        new THREE.SphereGeometry(info.r, 14, 10),
                        new THREE.MeshPhongMaterial({ color: info.color, shininess: 35, specular: 0x334455 })
                    );
                    mesh.position.copy(positions[i]);
                    group.add(mesh);
                    atomMeshes.push(mesh);
                    pts.push(mesh.position.clone());
                });
                if (els.length <= 14) {
                    for (let i = 0; i < pts.length; i++) {
                        const nearest = [];
                        for (let j = 0; j < pts.length; j++) {
                            if (i === j) continue;
                            nearest.push({ j, d: pts[i].distanceTo(pts[j]) });
                        }
                        nearest.sort((a, b) => a.d - b.d);
                        const links = els.length <= 4 ? 2 : 1;
                        for (let k = 0; k < links && k < nearest.length; k++) {
                            if (nearest[k].d < 1.35) addBond(group, pts[i], pts[nearest[k].j], bondMats);
                        }
                    }
                }
            }

            const box = new THREE.Box3().setFromObject(group);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z, 0.01);
            group.scale.setScalar(1.65 / maxDim);
            group.userData.bondMats = bondMats;
            group.userData.atomMeshes = atomMeshes;
            return group;
        }

        function disposeFormulaGroup(group) {
            if (!group) return;
            group.traverse((obj) => {
                if (obj.isMesh) {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) obj.material.dispose();
                }
            });
            if (group.userData.bondMats) group.userData.bondMats.forEach((m) => m.dispose());
        }

        const formulaViewer = {
            active: false,
            renderer: null,
            scene: null,
            camera: null,
            group: null,
            spin: 0,
            formulaKey: ''
        };

        function ensureFormulaViewer() {
            if (formulaViewer.renderer) return;
            const canvas = document.getElementById('voxel-scan-formula-canvas');
            if (!canvas) return;
            formulaViewer.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
            formulaViewer.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            formulaViewer.renderer.setSize(canvas.width, canvas.height, false);
            formulaViewer.scene = new THREE.Scene();
            formulaViewer.camera = new THREE.PerspectiveCamera(34, canvas.width / canvas.height, 0.1, 40);
            formulaViewer.camera.position.set(0, 0.2, 3.4);
            formulaViewer.scene.add(new THREE.AmbientLight(0xc8e8ff, 0.75));
            const key = new THREE.DirectionalLight(0xffffff, 0.95);
            key.position.set(2.2, 2.8, 3.5);
            formulaViewer.scene.add(key);
            const rim = new THREE.DirectionalLight(0x6fe3ff, 0.45);
            rim.position.set(-2.5, -1.2, -2);
            formulaViewer.scene.add(rim);
        }

        function setFormulaVisual(raw) {
            const canvas = document.getElementById('voxel-scan-formula-canvas');
            const fallback = document.getElementById('voxel-scan-formula-fallback');
            const breakdownEl = document.getElementById('voxel-scan-formula-breakdown');
            const legendEl = document.getElementById('voxel-scan-formula-legend');
            const counts = parseFormulaCounts(raw);
            const key = counts ? countsKey(counts) : String(raw || '');

            if (breakdownEl) breakdownEl.textContent = counts ? formulaBreakdownText(counts) : '';
            if (legendEl) {
                legendEl.innerHTML = '';
                if (counts) {
                    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([el, n]) => {
                        const chip = document.createElement('span');
                        chip.className = 'vx-scan-elm-chip';
                        const dot = document.createElement('span');
                        dot.className = 'vx-scan-elm-dot';
                        dot.style.background = '#' + formulaElm(el).color.toString(16).padStart(6, '0');
                        chip.appendChild(dot);
                        chip.appendChild(document.createTextNode(`${el}${n > 1 ? '×' + n : ''}`));
                        legendEl.appendChild(chip);
                    });
                }
            }

            if (!counts) {
                formulaViewer.active = false;
                formulaViewer.formulaKey = key;
                if (canvas) canvas.style.opacity = '0';
                if (fallback) {
                    fallback.hidden = false;
                    fallback.textContent = raw && raw !== '—' ? raw : '?';
                }
                if (formulaViewer.group) {
                    formulaViewer.scene.remove(formulaViewer.group);
                    disposeFormulaGroup(formulaViewer.group);
                    formulaViewer.group = null;
                }
                return;
            }

            ensureFormulaViewer();
            if (!formulaViewer.renderer) return;
            if (canvas) canvas.style.opacity = '1';
            if (fallback) fallback.hidden = true;

            if (formulaViewer.formulaKey !== key) {
                formulaViewer.formulaKey = key;
                if (formulaViewer.group) {
                    formulaViewer.scene.remove(formulaViewer.group);
                    disposeFormulaGroup(formulaViewer.group);
                }
                formulaViewer.group = buildFormulaMolecule(counts);
                formulaViewer.scene.add(formulaViewer.group);
                formulaViewer.spin = Math.random() * Math.PI * 2;
            }
            formulaViewer.active = true;
        }

        function updateFormulaViewer(dt) {
            if (!formulaViewer.active || !formulaViewer.renderer || !formulaViewer.group) return;
            formulaViewer.spin += dt * 0.95;
            formulaViewer.group.rotation.y = formulaViewer.spin;
            formulaViewer.group.rotation.x = Math.sin(formulaViewer.spin * 0.55) * 0.18;
            formulaViewer.renderer.render(formulaViewer.scene, formulaViewer.camera);
        }

        function disposeFormulaViewer() {
            formulaViewer.active = false;
            if (formulaViewer.group) {
                formulaViewer.scene.remove(formulaViewer.group);
                disposeFormulaGroup(formulaViewer.group);
                formulaViewer.group = null;
            }
            if (formulaViewer.renderer) {
                formulaViewer.renderer.dispose();
                formulaViewer.renderer = null;
            }
            formulaViewer.scene = null;
            formulaViewer.camera = null;
            formulaViewer.formulaKey = '';
        }

        function hideScanChrome() {
            scanExpanded = false;
            _scanSticky = null;
            const backdrop = document.getElementById('voxel-scan-backdrop');
            const panel = document.getElementById('voxel-scan');
            const link = document.getElementById('voxel-scan-link');
            const marker = document.getElementById('voxel-scan-target');
            if (backdrop) backdrop.hidden = true;
            if (panel) {
                panel.hidden = true;
                panel.classList.remove('vx-scan-expanded');
                panel.style.height = '';
                panel.style.maxHeight = '';
                panel.style.transform = 'none';
                const fit = panel.querySelector('.vx-scan-fit');
                if (fit) fit.style.transform = 'none';
                const compactHint = document.getElementById('voxel-scan-compact-hint');
                const closeHint = document.getElementById('voxel-scan-close-hint');
                if (compactHint) compactHint.hidden = true;
                if (closeHint) closeHint.hidden = true;
            }
            if (link) link.hidden = true;
            if (marker) marker.hidden = true;
            hideScanFrame();
            formulaViewer.active = false;
            _scanBlockId = -1;
            resizeFormulaCanvas(false);
        }

        function buildScanElbowPath(x1, y1, x2, y2) {
            const dx = x2 - x1;
            const elbowX = x1 + dx * 0.58;
            return `M ${x1} ${y1} L ${elbowX} ${y1} L ${elbowX} ${y2} L ${x2} ${y2}`;
        }

        // Screen-space radius (px) of a creature's on-screen extent.
        function creatureScreenR(cr) {
            const sc = (cr.actor && cr.actor.group && cr.actor.group.scale.x) || 1;
            const cy = cr.pos.y + 0.6 * sc;
            const w = window.innerWidth, h = window.innerHeight;
            _scanWorld.set(cr.pos.x, cy, cr.pos.z).project(camera);
            const cx = (_scanWorld.x * 0.5 + 0.5) * w, cyp = (-_scanWorld.y * 0.5 + 0.5) * h;
            _scanRight.setFromMatrixColumn(camera.matrixWorld, 0);   // world-space camera right
            const R = 0.7 * sc + 0.55;
            _scanWorld2.set(cr.pos.x + _scanRight.x * R, cy + _scanRight.y * R, cr.pos.z + _scanRight.z * R).project(camera);
            const ex = (_scanWorld2.x * 0.5 + 0.5) * w, ey = (-_scanWorld2.y * 0.5 + 0.5) * h;
            return Math.max(24, Math.min(160, Math.hypot(ex - cx, ey - cyp)));
        }
        // Corner-bracket reticle around a scanned creature (screen-space).
        function updateScanFrame(cr, alpha, r) {
            const frame = document.getElementById('voxel-scan-frame');
            if (!frame || !camera) return;
            const sc = (cr.actor && cr.actor.group && cr.actor.group.scale.x) || 1;
            const cy = cr.pos.y + 0.6 * sc;
            const w = window.innerWidth, h = window.innerHeight;
            _scanWorld.set(cr.pos.x, cy, cr.pos.z).project(camera);
            if (_scanWorld.z > 1) { frame.hidden = true; return; }
            const cx = (_scanWorld.x * 0.5 + 0.5) * w, cyp = (-_scanWorld.y * 0.5 + 0.5) * h;
            if (r == null) r = creatureScreenR(cr);
            frame.style.left = cx + 'px'; frame.style.top = cyp + 'px';
            frame.style.width = (r * 2) + 'px'; frame.style.height = (r * 2) + 'px';
            frame.style.opacity = String(alpha);
            frame.hidden = false;
        }
        function hideScanFrame() { const f = document.getElementById('voxel-scan-frame'); if (f) f.hidden = true; }

        function updateScanConnector(t, alpha, screen, hideMarker) {
            const link = document.getElementById('voxel-scan-link');
            const pathGlow = document.getElementById('voxel-scan-path-glow');
            const pathCore = document.getElementById('voxel-scan-path');
            const pathPulse = document.getElementById('voxel-scan-path-pulse');
            const anchorBlock = document.getElementById('voxel-scan-anchor-block');
            const anchorPanel = document.getElementById('voxel-scan-anchor-panel');
            const marker = document.getElementById('voxel-scan-target');
            const panel = document.getElementById('voxel-scan');
            const port = document.getElementById('voxel-scan-port');
            const grad = document.getElementById('voxel-scan-grad');
            if (!link || !pathGlow || !pathCore || !pathPulse || !anchorBlock || !anchorPanel
                || !marker || !panel || !camera) return;

            const scr = screen || getScanBlockScreen(t);
            const { bx, by, inFrustum, w, h } = scr;
            link.setAttribute('viewBox', `0 0 ${w} ${h}`);

            if (!inFrustum) {
                link.hidden = true;
                marker.hidden = true;
                return;
            }

            let px = panel.getBoundingClientRect().left + 2;
            let py = panel.getBoundingClientRect().top + panel.getBoundingClientRect().height * 0.38;
            if (port) {
                const pr = port.getBoundingClientRect();
                px = pr.left + pr.width * 0.5;
                py = pr.top + pr.height * 0.5;
            }

            const dx = px - bx;
            const dy = py - by;
            const dist = Math.hypot(dx, dy) || 1;
            const startX = bx + (dx / dist) * 22;
            const startY = by + (dy / dist) * 22;
            const pathD = buildScanElbowPath(startX, startY, px, py);

            if (grad) {
                grad.setAttribute('x1', String(startX));
                grad.setAttribute('y1', String(startY));
                grad.setAttribute('x2', String(px));
                grad.setAttribute('y2', String(py));
            }

            pathGlow.setAttribute('d', pathD);
            pathCore.setAttribute('d', pathD);
            pathPulse.setAttribute('d', pathD);
            [pathGlow, pathCore, pathPulse].forEach((p) => { p.style.opacity = String(alpha); });

            anchorBlock.setAttribute('cx', String(startX));
            anchorBlock.setAttribute('cy', String(startY));
            anchorBlock.style.opacity = String(alpha);
            anchorPanel.setAttribute('cx', String(px));
            anchorPanel.setAttribute('cy', String(py));
            anchorPanel.style.opacity = String(alpha);
            link.hidden = false;

            if (hideMarker) {
                marker.hidden = true;
            } else {
                marker.style.left = `${bx}px`;
                marker.style.top = `${by}px`;
                marker.style.opacity = String(alpha);
                marker.hidden = false;
            }
        }

        const SCAN_PAD = 12;
        const SCAN_BLOCK_GAP = 26;
        const SCAN_BOTTOM_RESERVE = 108;

        function projectScan(wx, wy, wz) {
            const w = window.innerWidth, h = window.innerHeight;
            _scanWorld.set(wx, wy, wz).project(camera);
            let bx = (_scanWorld.x * 0.5 + 0.5) * w;
            let by = (-_scanWorld.y * 0.5 + 0.5) * h;
            const inFrustum = _scanWorld.z <= 1;
            bx = Math.max(SCAN_PAD, Math.min(w - SCAN_PAD, bx));
            by = Math.max(SCAN_PAD, Math.min(h - SCAN_PAD, by));
            return { bx, by, inFrustum, w, h };
        }
        function getScanBlockScreen(t) {
            return projectScan(WORLD_OFFSET.x + t.x + 0.5, WORLD_OFFSET.y + t.y + 0.5, WORLD_OFFSET.z + t.z + 0.5);
        }

        function scanPanelMaxHeight(h) {
            return Math.max(140, h - SCAN_BOTTOM_RESERVE - SCAN_PAD);
        }

        function fitScanPanelContent(maxH) {
            const shell = document.getElementById('voxel-scan');
            const fit = shell && shell.querySelector('.vx-scan-fit');
            const panel = shell && shell.querySelector('.vx-scan-panel');
            if (!shell || !fit || !panel) return 0;

            fit.style.transform = 'none';
            shell.style.height = 'auto';
            shell.style.maxHeight = `${maxH}px`;

            const naturalH = panel.offsetHeight;
            if (naturalH <= maxH) {
                shell.style.height = `${naturalH}px`;
                return naturalH;
            }

            const scale = Math.max(0.68, maxH / naturalH);
            fit.style.transform = `scale(${scale})`;
            const scaledH = Math.ceil(naturalH * scale);
            shell.style.height = `${scaledH}px`;
            return scaledH;
        }

        function clampScanPanelRect(left, top, pw, ph, w, h) {
            const maxBottom = h - SCAN_BOTTOM_RESERVE;
            let x = Math.max(SCAN_PAD, Math.min(w - SCAN_PAD - pw, left));
            let y = Math.max(SCAN_PAD, Math.min(maxBottom - ph, top));
            if (y + ph > maxBottom) y = Math.max(SCAN_PAD, maxBottom - ph);
            return { left: x, top: y };
        }

        function layoutScanPanel(t, screen, gap) {
            const panel = document.getElementById('voxel-scan');
            if (!panel || !camera) return null;
            const { bx, by, w, h } = screen || getScanBlockScreen(t);

            panel.style.transform = 'none';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';

            const maxH = scanPanelMaxHeight(h);
            const ph = fitScanPanelContent(maxH);
            const pw = panel.offsetWidth || Math.min(380, w - 24);
            const g = gap || SCAN_BLOCK_GAP;
            const spaceRight = w - bx - SCAN_PAD;
            const spaceLeft = bx - SCAN_PAD;

            let left = spaceRight >= pw + g || spaceRight >= spaceLeft
                ? bx + g
                : bx - g - pw;
            let top = by - ph * 0.36;

            const clamped = clampScanPanelRect(left, top, pw, ph, w, h);
            panel.style.left = `${clamped.left}px`;
            panel.style.top = `${clamped.top}px`;
            return { bx, by, w, h };
        }

        function updateJournalHud() {
            const el = document.getElementById('voxel-journal-hud');
            const AP = getProfileApi();
            if (!el || !AP) return;
            const p = AP.load();
            const prog = AP.missionProgress(p);
            el.hidden = false;
            const da = (t) => '<div class="vx-quest-da">🇩🇰 ' + t + '</div>';
            let badge = '';
            if (AP.currentPlanetDef) {
                const def = AP.currentPlanetDef(p);
                const charted = (p.system && p.system.unlocked) ? p.system.unlocked.length : 1;
                const total = AP.PLANETS ? AP.PLANETS.length : 1;
                badge = '<div class="vx-quest-top"><span class="vx-quest-badge">🪐 ' + def.name
                    + (def.nameDa ? ' <span class="vx-quest-badge-da">· ' + def.nameDa + '</span>' : '') + '</span>'
                    + '<span class="vx-quest-count">' + charted + ' / ' + total + ' charted</span></div>';
            }
            if (!prog.mission) {
                el.innerHTML = badge
                    + '<div class="vx-quest-title vx-quest-done">✓ Surveys complete</div>' + da('Opgaver fuldført')
                    + '<div class="vx-quest-goal">Every survey done — chart new worlds, build, and explore.</div>'
                    + da('Alle opgaver er klaret — kortlæg nye verdener, byg og udforsk.')
                    + '<div class="vx-quest-bar vx-quest-bar-done"><span style="width:100%"></span></div>';
                return;
            }
            const cur = Math.max(0, prog.current | 0), tgt = Math.max(1, prog.target | 0);
            const pct = Math.max(0, Math.min(100, Math.round(cur / tgt * 100)));
            const m = prog.mission;
            const tip = m.tip
                ? '<div class="vx-quest-tip">👉 ' + m.tip
                    + (m.tipDa ? ' <span class="vx-quest-badge-da">· ' + m.tipDa + '</span>' : '')
                    + '</div>'
                : '';
            el.innerHTML = badge
                + '<div class="vx-quest-title">🔬 ' + m.title + '</div>' + (m.titleDa ? da(m.titleDa) : '')
                + '<div class="vx-quest-goal">' + m.desc + '</div>' + (m.descDa ? da(m.descDa) : '')
                + tip
                + '<div class="vx-quest-bar"><span style="width:' + pct + '%"></span><em>' + cur + ' / ' + tgt + '</em></div>';
            if (typeof syncMissionWaypoint === 'function') syncMissionWaypoint();
        }

        // Short relative time for the "last saved" label (kept kid-legible).
        function _cloudRelTime(ms) {
            const s = Math.max(0, (Date.now() - ms) / 1000);
            if (s < 5) return 'just now';
            if (s < 60) return Math.floor(s) + 's ago';
            if (s < 3600) return Math.floor(s / 60) + 'm ago';
            if (s < 86400) return Math.floor(s / 3600) + 'h ago';
            return Math.floor(s / 86400) + 'd ago';
        }

        // Paint the cloud-save pill from a CloudSync status object.
        function renderCloudStatus(st) {
            const el = document.getElementById('voxel-cloud');
            if (!el) return;
            if (!st || !st.enabled || st.phase === 'off') { el.hidden = true; return; }
            el.hidden = false;
            el.className = 'vx-cloud vx-cloud-' + st.phase;
            let ico = '☁', text;
            switch (st.phase) {
                case 'pending':
                case 'syncing': text = 'Saving…'; break;
                case 'saved':   text = 'Saved' + (st.lastSaved ? ' · ' + _cloudRelTime(st.lastSaved) : ''); break;
                case 'error': {
                    ico = '⚠';
                    // Keep the pill short; put the full reason on hover.
                    text = /too big/i.test(st.error || '') ? 'Cloud too big' : 'Save failed';
                    break;
                }
                case 'linked':  text = 'Cloud on'; break;
                case 'local':
                default:        ico = '⌂'; text = 'Local only'; break;
            }
            el.innerHTML = '<span class="vx-cloud-ico">' + ico + '</span>' + text;
            if (st.phase === 'error' && st.error) {
                el.title = st.error + (st.code ? (' · code ' + st.code) : '');
            } else {
                el.title = st.code ? ('Cloud code: ' + st.code) : 'Not linked to a cloud code — edits stay on this device.';
            }
        }

        function recordJournalScan(blockId) {
            const AP = getProfileApi();
            if (!AP) return;
            const { isNew, completed, beat } = AP.recordScan(AP.load(), blockId);
            updateJournalHud();
            const b = blockById(blockId);
            const hud = document.getElementById('voxel-journal-hud');
            if (isNew && hud) hud.classList.add('vx-journal-new');
            if (beat) vxLangMsg(beat.en, beat.da, 3600);
            else if (isNew && g.showMessage && b) {
                g.showMessage('Cataloged: ' + b.name, 1800);
            }
            if (completed && g.showMessage) {
                g.showMessage('Survey complete: ' + completed.title, 2800);
            }
        }

        function updateBlockScan(t) {
            const panel = document.getElementById('voxel-scan');
            if (!panel) return;
            if (voxelPanelOpen()) {
                if (scanExpanded) setScanExpanded(false);
                hideScanChrome();
                return;
            }

            // Creatures take priority when you're aiming at one while scanning.
            const cre = (focusAimBlend > 0.08 || scanExpanded) ? pickCreature() : null;
            if (cre) {
                panel.hidden = false;
                const cAlpha = scanExpanded ? 1 : (0.4 + focusAimBlend * 0.6);
                panel.style.opacity = String(cAlpha);
                if (_scanCreatureId !== cre.sp.id) {
                    _scanCreatureId = cre.sp.id;
                    _scanBlockId = -1;
                    fillCreatureScanContent(cre.sp, scanExpanded);
                    recordCreatureScan(cre.sp);
                }
                if (scanExpanded) {
                    layoutScanExpanded();
                    const link = document.getElementById('voxel-scan-link');
                    const marker = document.getElementById('voxel-scan-target');
                    if (link) link.hidden = true;
                    if (marker) marker.hidden = true;
                    hideScanFrame();
                } else {
                    const sc = (cre.actor && cre.actor.group && cre.actor.group.scale.x) || 1;
                    const screen = projectScan(cre.pos.x, cre.pos.y + 0.6 * sc, cre.pos.z);
                    const r = creatureScreenR(cre);
                    layoutScanPanel(null, screen, r + 40);    // offset the card clear of the frame
                    updateScanConnector(null, cAlpha, screen, true);   // connector, hide the block marker
                    updateScanFrame(cre, cAlpha, r);          // bracket reticle on the creature
                }
                return;
            }
            _scanCreatureId = null;
            hideScanFrame();

            const compactActive = isScanCompactActive(t);
            if (compactActive) {
                _scanSticky = {
                    x: t.x, y: t.y, z: t.z,
                    id: getBlock(t.x, t.y, t.z)
                };
            }
            if (!compactActive && !scanExpanded) {
                hideScanChrome();
                return;
            }

            const ref = compactActive ? t : _scanSticky;
            if (!ref) {
                hideScanChrome();
                return;
            }
            const aimT = compactActive ? t : { x: ref.x, y: ref.y, z: ref.z };
            const id = compactActive ? getBlock(t.x, t.y, t.z) : ref.id;
            const b = blockById(id);
            if (!b) {
                hideScanChrome();
                return;
            }

            const alpha = scanExpanded ? 1 : (0.4 + focusAimBlend * 0.6);
            panel.hidden = false;
            panel.style.opacity = String(alpha);

            const cracking = compactActive && mineTarget
                && mineTarget.x === t.x && mineTarget.y === t.y && mineTarget.z === t.z
                ? mineProgress : 0;
            if (_scanBlockId !== id) {
                _scanBlockId = id;
                fillScanPanelContent(b, id, cracking, scanExpanded);
                if (compactActive) recordJournalScan(id);
            } else {
                const metaEl = document.getElementById('voxel-scan-meta');
                if (metaEl) {
                    let meta = `Hardness ${b.hardness ?? '?'}`;
                    if (cracking > 0.01) meta += ` · Mining ${Math.round(cracking * 100)}%`;
                    metaEl.textContent = meta;
                }
            }

            if (scanExpanded) {
                layoutScanExpanded();
                const link = document.getElementById('voxel-scan-link');
                const marker = document.getElementById('voxel-scan-target');
                if (link) link.hidden = true;
                if (marker) marker.hidden = true;
            } else {
                layoutScanPanel(aimT);
                updateScanConnector(aimT, alpha);
            }
        }

        function updatePlaceGhost(t) {
            const slot = hotbar[selected];
            if (!isMiningTool() || !slot || slot.count <= 0 || voxelPanelOpen() || !t) {
                if (placeGhost) placeGhost.visible = false;
                return;
            }
            const { x, y, z } = t.place;
            const valid = canPlaceBlockAt(x, y, z);
            ensurePlaceGhost();
            placeGhost.position.set(
                WORLD_OFFSET.x + x + 0.5,
                WORLD_OFFSET.y + y + 0.5,
                WORLD_OFFSET.z + z + 0.5
            );
            placeGhost.material.color.setHex(valid ? 0x66ff88 : 0xff5555);
            placeGhost.material.opacity = valid ? 0.38 : 0.26;
            placeGhost.visible = true;
        }

        let tpFireTrace = null;
        const _tpTraceQuat = new THREE.Quaternion();
        const _tpTraceZ = new THREE.Vector3(0, 0, 1);

        function disposeTpFireTrace() {
            if (!tpFireTrace) return;
            if (tpFireTrace.grp) scene.remove(tpFireTrace.grp);
            tpFireTrace.segs.forEach((seg) => {
                if (seg.geometry) seg.geometry.dispose();
                if (seg.material) seg.material.dispose();
            });
            tpFireTrace = null;
        }

        function ensureTpFireTrace(profile) {
            const key = profile.kind + ':' + profile.color;
            if (tpFireTrace && tpFireTrace.key === key) return tpFireTrace;
            disposeTpFireTrace();
            const grp = new THREE.Group();
            const outer = addBeamSegment(grp, 1, profile.width, profile.color, 0.82, 0);
            const inner = addBeamSegment(grp, 1, profile.width * 0.32, profile.core, 0.98, 0);
            tpFireTrace = { key, grp, segs: [outer, inner], profile };
            scene.add(grp);
            return tpFireTrace;
        }

        function layoutWorldBeam(origin, dir, len, grp, segs, opacityMul) {
            grp.position.copy(origin).addScaledVector(dir, len * 0.5);
            _tpTraceQuat.setFromUnitVectors(_tpTraceZ, dir);
            grp.quaternion.copy(_tpTraceQuat);
            const k = opacityMul != null ? opacityMul : 1;
            segs[0].scale.set(1, 1, len);
            segs[1].scale.set(1, 1, len * 1.02);
            segs[0].material.opacity = (segs[0].userData.baseOp || 0.82) * k;
            segs[1].material.opacity = (segs[1].userData.baseOp || 0.98) * k;
        }

        function updateTpAimVisuals() {
            if (firstPerson || voxelPanelOpen() || drawerOpen || !weaponDef || !weaponDef.ranged) {
                if (tpFireTrace && tpFireTrace.grp) tpFireTrace.grp.visible = false;
                return;
            }
            const profile = SHOT_PROFILES[weaponDef.id] || SHOT_PROFILES.blaster;
            if (profile.kind !== 'beam') {
                if (tpFireTrace && tpFireTrace.grp) tpFireTrace.grp.visible = false;
                return;
            }
            const mining = fireHeld && isMineLaser();
            if (!mining) {
                if (tpFireTrace && tpFireTrace.grp) tpFireTrace.grp.visible = false;
                return;
            }
            const a = resolveAim();
            if (a.len < 0.05) {
                if (tpFireTrace && tpFireTrace.grp) tpFireTrace.grp.visible = false;
                return;
            }
            const trace = ensureTpFireTrace(profile);
            layoutWorldBeam(a.origin, a.dir, a.len, trace.grp, trace.segs, 1);
            trace.grp.visible = true;
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
            laser:   { kind: 'beam', color: 0xff4a62, core: 0xfff0f4, width: 0.032, life: 0.14, jagged: true, jagCount: 2, jagScale: 0.72, sparkSize: 0.042, flashSize: 0.12 },
            minecutter: { kind: 'beam', color: 0x44d8ff, core: 0xe8ffff, width: 0.038, life: 0.1, jagged: true },
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
            const eye = getFpEyeWorld(new THREE.Vector3());
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
            const sparkSz = profile.sparkSize || 0.07;
            const flashSz = profile.flashSize || 0.22;
            const n = profile.kind === 'bolt' ? 12 : (profile.sparkSize ? 5 : 7);
            for (let i = 0; i < n; i++) {
                const m = new THREE.Mesh(
                    new THREE.BoxGeometry(sparkSz, sparkSz, sparkSz),
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
                new THREE.BoxGeometry(flashSz, flashSz, flashSz),
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

            const grp = new THREE.Group();
            const outer = addBeamSegment(grp, 1, profile.width, profile.color, 0.82, 0);
            const inner = addBeamSegment(grp, 1, profile.width * 0.32, profile.core, 0.98, 0);
            const segs = [outer, inner];
            layoutWorldBeam(origin, dir, a.len, grp, segs, 1);

            if (profile.jagged) {
                const jagN = profile.jagCount || 4;
                const jagMul = profile.jagScale || 1;
                for (let i = 0; i < jagN; i++) {
                    const jag = addBeamSegment(
                        grp, a.len * (0.16 + Math.random() * 0.1), profile.width * 0.16 * jagMul,
                        0xfff4f6, 0.42, (i - (jagN - 1) * 0.5) * a.len * 0.18
                    );
                    jag.position.x = (Math.random() - 0.5) * profile.width * 1.6;
                    jag.position.y = (Math.random() - 0.5) * profile.width * 1.6;
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
            fpSwingDurationActive = isSwordEquipped() ? 0.42 : fpSwingDuration;
            fpSwingTimer = fpSwingDurationActive;
            if (!isSwordEquipped()) fpSwingDir = -(fpSwingDir || 1);
        }

        function triggerLaserPulse() {
            fpSwingTimer = Math.max(fpSwingTimer, 0.06);
        }

        function triggerMineAnim(opts) {
            opts = opts || {};
            if (opts.laserPulse) {
                if (firstPerson) triggerLaserPulse();
            } else if (firstPerson) {
                triggerFpSwing();
            }
            if (!firstPerson) {
                if (av && av.anim) {
                    if (!opts.laserPulse) { attackT = 0; av.anim.attackT = 0; }
                } else if (!opts.laserPulse) {
                    attackT = 0;
                }
            }
        }

        function triggerCombatAnim() {
            if (isLaserRifle() && !canStartLaserFire()) return;
            if (isSwordEquipped() && !canStartSwordSwing()) return;
            if (isSwordEquipped()) beginSwordSwing();
            else if (isLaserRifle()) beginLaserFire();
            if (firstPerson) {
                if (isSwordEquipped()) triggerFpSwing();
                else if (isLaserRifle()) triggerFpLaserRecoil();
                else triggerFpSwing();
            }
            if (!firstPerson) {
                if (av && av.anim) {
                    if (weaponDef && weaponDef.ranged) av.anim.attackT = 0;
                    else { attackT = 0; av.anim.attackT = 0; }
                } else if (weaponDef && weaponDef.ranged && !isLaserRifle()) {
                    tpRecoilT = 0;
                } else if (!weaponDef || !weaponDef.ranged) {
                    attackT = 0;
                }
            }
        }

        function _isUnminable(id){ const b = blockById(id); return !!(b && b.tags && b.tags.indexOf('unminable') >= 0); }
        function completeMine(t, id) {
            if(_isUnminable(id)){ resetMining(); disposeAimEdgeHighlight(); return; }   // lava flow can't be broken
            mineBreakSfx(id);
            burst(
                t.x + 0.5 + WORLD_OFFSET.x,
                t.y + 0.5 + WORLD_OFFSET.y,
                t.z + 0.5 + WORLD_OFFSET.z,
                blockColor(id)
            );
            setBlockEvent(t.x, t.y, t.z, 0);
            floodWaterAfterMine(t.x, t.y, t.z);   // sea flows into the new gap if it reaches water
            // Open doors collapse back to one Door item so the backpack never holds a second id.
            addToInventory(id === DOOR_OPEN ? DOOR_CLOSED : id);
            try {
                const AP = getProfileApi();
                if (AP && AP.recordDepth) {
                    const { completed } = AP.recordDepth(AP.load(), t.y);
                    if (typeof updateJournalHud === 'function') updateJournalHud();
                    if (completed && g.showMessage) g.showMessage('Survey complete: ' + completed.title, 2800);
                }
            } catch (_) {}
            updateHUD();
            resetMining();
            disposeAimEdgeHighlight();
        }

        function laserMineGain(block) {
            if(block && block.tags && block.tags.indexOf('unminable') >= 0) return 0;
            const g = weaponGameplayFor(weaponDef.id);
            const hardness = (block && block.hardness) || 1;
            // g.mining = blocks/s at hardness 1; one mine tick fires every MINECUTTER_FIRE_INTERVAL,
            // so progress/tick = mining * interval / hardness keeps the effective rate at mining/hardness.
            return (g.mining || 0) * MINECUTTER_FIRE_INTERVAL / hardness;
        }


        function fireCombat() {
            if (flying) return;
            if (!weaponDef) return;
            if (weaponDef.id === 'detonator') { detonateAllArmed(); triggerCombatAnim(); return; }
            if (isSwordEquipped() && !canStartSwordSwing()) return;
            if (isLaserRifle() && !canStartLaserFire()) return;
            const t = pickTarget();
            const hasBlock = !!(t && getBlock(t.x, t.y, t.z));
            // shoot a placed TNT block to light its fuse (~1.5s) instead of dealing damage
            if (hasBlock && getBlock(t.x, t.y, t.z) === TNT_ID) {
                igniteTnt(t.x, t.y, t.z, 1.5);
                triggerCombatAnim();
                if (weaponDef.ranged) { playSfx('shoot'); if (firstPerson) spawnRangedShotVfxAt(false); }
                return;
            }
            triggerCombatAnim();
            // damage a creature under the crosshair within weapon reach (floored so melee connects)
            const cre = pickCombatCreature(Math.max(currentAimReach(), 3.2));
            if (cre) {
                const ddx = cre.pos.x - player.pos.x, ddz = cre.pos.z - player.pos.z;
                const inv = 1 / (Math.hypot(ddx, ddz) || 1);
                damageCreature(cre, weaponDamage(), ddx * inv, ddz * inv);
            }
            if (isSwordEquipped()) playSfx('swordSwing');
            else if (isLaserRifle()) playSfx('laserFire');
            else if (weaponDef && weaponDef.ranged) playSfx('shoot');
            if (weaponDef && weaponDef.ranged) {
                spawnRangedShotVfxAt(!hasBlock);
            }
        }

        function tryLaserMine() {
            if (!isMineLaser()) return false;
            const t = pickTarget();
            playSfx('laserCut');
            triggerMineAnim({ laserPulse: true });
            if (!t || !getBlock(t.x, t.y, t.z)) {
                resetMining();
                return false;
            }
            if (weaponDef && weaponDef.ranged && firstPerson) spawnRangedShotVfxAt(false);
            const id = getBlock(t.x, t.y, t.z);
            const block = blockById(id);
            if (!block) return false;
            if (mineTarget && (mineTarget.x !== t.x || mineTarget.y !== t.y || mineTarget.z !== t.z)) {
                mineProgress = 0;
            }
            mineTarget = { x: t.x, y: t.y, z: t.z };
            mineProgress += laserMineGain(block);
            if (mineProgress >= 1) {
                completeMine(t, id);
                return true;
            }
            return false;
        }

        function updateLaserHoldFire(dt) {
            if (!fireHeld || !isMineLaser() || voxelPanelOpen()) return;
            laserCooldown -= dt;
            if (laserCooldown <= 0) {
                tryLaserMine();
                laserCooldown = mineLaserInterval();
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

        const FP_TUNER_CAM = [
            ['theta', 'Yaw', -3.14159, 3.14159, 0.01],
            ['phi', 'Pitch', 0.1, 3.0, 0.01],
            ['eyeH', 'Eye height', 1.2, 2.0, 0.01],
            ['eyeX', 'Eye shift X', -0.35, 0.35, 0.01],
            ['eyeZ', 'Eye shift Z', -0.35, 0.35, 0.01],
            ['fov', 'FOV', 40, 90, 1],
            ['adsFov', 'Focus FOV', 35, 75, 1],
            ['aimSens', 'Look sens.', 0.0008, 0.006, 0.0001],
            ['pitchMin', 'Pitch min', 0.05, 1.2, 0.01],
            ['pitchMax', 'Pitch max', 1.5, 3.14, 0.01]
        ];
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
        const WEAPON_STAT_SLIDERS = [
            ['power', 'Power', 0.05, 1.5, 0.01],
            ['range', 'Range', 0.12, 1.0, 0.01]
        ];

        function fmtWeaponStatVal(key, val) {
            if (key === 'range') return (val * AIM_REACH).toFixed(1) + 'm';
            return (+val).toFixed(2);
        }

        function weaponStatsSectionHtml() {
            let h = `<div class="vx-fp-section"><b>Weapon stats</b>`;
            WEAPON_STAT_SLIDERS.forEach(([key, label, min, max, step]) => {
                const id = `weapon-stat-${key}`;
                h += `<label class="vx-fp-row" for="${id}">
                    <span class="vx-fp-lbl">${label}</span>
                    <span class="vx-tp-val" data-ws-v="${key}">—</span>
                    <input type="range" id="${id}" data-ws="${key}"
                        min="${min}" max="${max}" step="${step}">
                </label>`;
            });
            return h + '</div>';
        }

        function syncWeaponStatInputs(root) {
            if (!root || !weaponDef) return;
            const g = weaponGameplayFor(weaponDef.id);
            WEAPON_STAT_SLIDERS.forEach(([key]) => {
                const input = root.querySelector(`[data-ws="${key}"]`);
                const out = root.querySelector(`[data-ws-v="${key}"]`);
                if (input) input.value = g[key];
                if (out) out.textContent = fmtWeaponStatVal(key, g[key]);
            });
        }

        function applyWeaponStatInput(key, val) {
            if (!weaponDef) return;
            const g = weaponGameplayFor(weaponDef.id);
            g[key] = val;
        }

        function resetWeaponStatsForCurrent() {
            const id = weaponDef ? weaponDef.id : 'blaster';
            const defs = defaultWeaponGameplayStats();
            if (!fpTune.weaponStats) fpTune.weaponStats = mergeWeaponStats(null);
            fpTune.weaponStats[id] = Object.assign({}, defs[id] || { power: 0.5, range: 0.5 });
        }

        function fmtFpCamVal(key, val) {
            if (key === 'theta' || key === 'phi' || key === 'pitchMin' || key === 'pitchMax') {
                return (val * 180 / Math.PI).toFixed(0) + '°';
            }
            if (key === 'aimSens') return (+val).toFixed(4);
            if (key === 'fov' || key === 'adsFov') return (+val).toFixed(0);
            return (+val).toFixed(2);
        }

        function syncFpTunerInputs() {
            if (!fpTunerEl || !fpTune) return;
            const fc = getFpCam();
            const wid = weaponDef ? weaponDef.id : 'blaster';
            const w = weaponTuneFor(wid);
            const title = fpTunerEl.querySelector('[data-fp-tune-weapon]');
            if (title) title.textContent = weaponDef ? weaponDef.name : wid;
            [['theta', orbit.theta], ['phi', orbit.phi]].forEach(([key, val]) => {
                const input = fpTunerEl.querySelector(`[data-fp-c="${key}"]`);
                const out = fpTunerEl.querySelector(`[data-fp-v="${key}"]`);
                if (input) input.value = val;
                if (out) out.textContent = fmtFpCamVal(key, val);
            });
            FP_TUNER_CAM.forEach(([key]) => {
                if (key === 'theta' || key === 'phi') return;
                const input = fpTunerEl.querySelector(`[data-fp-c="${key}"]`);
                const out = fpTunerEl.querySelector(`[data-fp-v="${key}"]`);
                if (input) input.value = fc[key];
                if (out) out.textContent = fmtFpCamVal(key, fc[key]);
            });
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
            syncWeaponStatInputs(fpTunerEl);
        }

        function onWeaponStatInput(e) {
            const key = e.target.dataset.ws;
            if (!key) return false;
            const val = parseFloat(e.target.value);
            applyWeaponStatInput(key, val);
            const root = e.target.closest('.vx-fp-tuner');
            const out = root && root.querySelector(`[data-ws-v="${key}"]`);
            if (out) out.textContent = fmtWeaponStatVal(key, val);
            return true;
        }

        function onFpTunerInput(e) {
            if (onWeaponStatInput(e)) return;
            const cKey = e.target.dataset.fpC;
            const gKey = e.target.dataset.fpG;
            const wKey = e.target.dataset.fpW;
            if (cKey) {
                const fc = getFpCam();
                const val = parseFloat(e.target.value);
                fc[cKey] = val;
                if (cKey === 'theta' || cKey === 'phi') {
                    orbit[cKey] = cKey === 'theta' ? wrapAngleRad(val) : val;
                    if (cKey === 'theta') fc.theta = orbit.theta;
                    player.yaw = orbit.theta + Math.PI;
                }
                const out = fpTunerEl.querySelector(`[data-fp-v="${cKey}"]`);
                if (out) {
                    out.textContent = fmtFpCamVal(
                        cKey,
                        cKey === 'theta' || cKey === 'phi' ? orbit[cKey] : val
                    );
                }
                updateCamera();
                return;
            }
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

            function camSliderRow(key, label, min, max, step) {
                const id = `fp-tune-cam-${key}`;
                return `<label class="vx-fp-row vx-fp-cam-row" for="${id}">
                    <span class="vx-fp-lbl">${label}</span>
                    <span class="vx-tp-val" data-fp-v="${key}">—</span>
                    <input type="range" id="${id}" data-fp-c="${key}"
                        min="${min}" max="${max}" step="${step}">
                </label>`;
            }

            function camSection(title, rows) {
                let h = `<div class="vx-fp-section"><b>${title}</b>`;
                rows.forEach(([key, label, min, max, step]) => {
                    h += camSliderRow(key, label, min, max, step);
                });
                return h + '</div>';
            }

            let html = `<div class="vx-fp-head">
                <h4>FP tuner</h4>
                <span class="vx-fp-weapon" data-fp-tune-weapon>—</span>
            </div>
            <p class="vx-fp-hint">Camera, pose (Q/E), power &amp; range. <b>Shift+F8</b> reopens after save.</p>`;
            html += camSection('Camera', FP_TUNER_CAM);
            html += `<div class="vx-fp-section"><b>Pivot &amp; mount</b>`;
            FP_TUNER_GLOBAL.forEach(([key, label, min, max, step]) => {
                html += sliderRow('g', key, label, min, max, step);
            });
            html += `</div>`;
            html += weaponStatsSectionHtml();
            html += `<div class="vx-fp-section"><b>Current weapon pose</b>`;
            FP_TUNER_WEAPON.forEach(([key, label, min, max, step]) => {
                html += sliderRow('w', key, label, min, max, step);
            });
            html += `</div>
            <label class="vx-fp-check"><input type="checkbox" data-fp-melee-rot> Override melee grip rotation</label>
            <div class="vx-fp-actions">
                <button type="button" class="vx-btn" data-fp-save>Save &amp; close</button>
                <button type="button" class="vx-btn" data-fp-reset-cam>Reset camera</button>
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
                if (g.showMessage) g.showMessage('FP camera & weapon saved (Shift+F8 to tweak again)', 2800);
            });
            el.querySelector('[data-fp-reset-cam]').addEventListener('click', () => {
                fpTune.cam = defaultFpCam();
                applyFpCamToOrbit();
                syncFpTunerInputs();
                updateCamera();
            });
            el.querySelector('[data-fp-reset-wpn]').addEventListener('click', () => {
                const id = weaponDef ? weaponDef.id : 'blaster';
                const defs = defaultWeaponTunes();
                fpTune.weapons[id] = Object.assign({}, defs[id] || defs.blaster);
                resetWeaponStatsForCurrent();
                syncFpTunerInputs();
                rebuildFpWeapon();
            });
            el.querySelector('[data-fp-reset-all]').addEventListener('click', () => {
                fpTune = defaultFpTune();
                fpTune.dismissed = false;
                applyFpCamToOrbit();
                syncFpTunerInputs();
                applyFpTuneToViewmodel();
                rebuildFpWeapon();
                updateCamera();
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

        const TP_TUNER_WEAPON = [
            ['wx', 'Grip X', -0.35, 0.35, 0.01],
            ['wy', 'Grip Y', -0.35, 0.35, 0.01],
            ['wz', 'Grip Z', -0.2, 0.35, 0.01],
            ['wrx', 'Wpn pitch', -3.14, 3.14, 0.01],
            ['wry', 'Wpn yaw', -3.14, 3.14, 0.01],
            ['wrz', 'Wpn roll', -3.14, 3.14, 0.01]
        ];

        function defaultTpWeaponTunes() {
            const VC = getVC();
            const out = {};
            if (!VC || !VC.tpWeaponGripRest) return out;
            weaponList().forEach((w) => {
                const r = VC.tpWeaponGripRest(w);
                out[w.id] = { wx: r.px, wy: r.py, wz: r.pz, wrx: r.x, wry: r.y, wrz: r.z };
            });
            return out;
        }

        function tpWeaponTuneFor(id) {
            if (!tpTune) tpTune = loadTpTune();
            const defs = defaultTpWeaponTunes();
            if (!tpTune.weapons) tpTune.weapons = Object.assign({}, defs);
            if (!tpTune.weapons[id]) tpTune.weapons[id] = Object.assign({}, defs[id] || defs.sword || defs.blaster);
            return tpTune.weapons[id];
        }

        function tpWeaponRestFromTune(def) {
            const t = tpWeaponTuneFor(def.id);
            return {
                x: t.wrx, y: t.wry, z: t.wrz,
                px: t.wx, py: t.wy, pz: t.wz
            };
        }

        function applyTpWeaponGripRest(mesh, def) {
            if (!mesh || !def) return;
            const rest = tpWeaponRestFromTune(def);
            mesh.rotation.set(rest.x, rest.y, rest.z);
            mesh.position.set(rest.px, rest.py, rest.pz);
            mesh.scale.set(1, 1, 1);
            mesh.userData.restRotation = { x: rest.x, y: rest.y, z: rest.z };
            mesh.userData.restPosition = { x: rest.px, y: rest.py, z: rest.pz };
            delete mesh.userData.restMuzzleDirGrip;
            delete mesh.userData.restQuat;
        }

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
                },
                weapons: defaultTpWeaponTunes()
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
                    cam,
                    weapons: Object.assign({}, defaultTpWeaponTunes(), saved.weapons || {})
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
            const title = tpTunerEl.querySelector('[data-tp-tune-weapon]');
            if (title) title.textContent = weaponDef ? weaponDef.name : '—';
            syncWeaponStatInputs(tpTunerEl);
            const wid = weaponDef ? weaponDef.id : 'sword';
            const w = tpWeaponTuneFor(wid);
            TP_TUNER_WEAPON.forEach(([key]) => {
                const input = tpTunerEl.querySelector(`[data-tp-w="${key}"]`);
                const out = tpTunerEl.querySelector(`[data-tp-wv="${key}"]`);
                if (input) input.value = w[key];
                if (out) out.textContent = fmtTpVal(key, w[key]);
            });
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
            if (key === 'theta' || key === 'phi' || key === 'pitchMin' || key === 'pitchMax' || key === 'adsYaw'
                || key === 'wrx' || key === 'wry' || key === 'wrz') {
                return (val * 180 / Math.PI).toFixed(0) + '°';
            }
            if (key === 'orbitSens') return (+val).toFixed(4);
            if (key === 'fov' || key === 'adsFov') return (+val).toFixed(0);
            return (+val).toFixed(2);
        }

        function onTpTunerInput(e) {
            if (onWeaponStatInput(e)) return;
            const wKey = e.target.dataset.tpW;
            if (wKey) {
                const w = tpWeaponTuneFor(weaponDef ? weaponDef.id : 'sword');
                const val = parseFloat(e.target.value);
                w[wKey] = val;
                if (tpWeapon && weaponDef) applyTpWeaponGripRest(tpWeapon, weaponDef);
                const out = tpTunerEl.querySelector(`[data-tp-wv="${wKey}"]`);
                if (out) out.textContent = fmtTpVal(wKey, val);
                return;
            }
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

            function weaponSliderRow(key, label, min, max, step) {
                const id = `tp-tune-w-${key}`;
                return `<label class="vx-fp-row" for="${id}">
                    <span class="vx-fp-lbl">${label}</span>
                    <span class="vx-tp-val" data-tp-wv="${key}">—</span>
                    <input type="range" id="${id}" data-tp-w="${key}"
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
                <span class="vx-fp-weapon" data-tp-tune-weapon>—</span>
            </div>
            <p class="vx-fp-hint">Camera, TP weapon grip (Q/E), power &amp; range. <b>Shift+F8</b> in 3rd person.</p>`;
            html += weaponStatsSectionHtml();
            html += `<div class="vx-fp-section"><b>TP weapon grip rest</b>`;
            TP_TUNER_WEAPON.forEach(([key, label, min, max, step]) => {
                html += weaponSliderRow(key, label, min, max, step);
            });
            html += `</div>`;
            html += section('Orbit angle', TP_TUNER_ORBIT);
            html += section('Shoulder &amp; lens', TP_TUNER_CAM);
            html += section('Limits', TP_TUNER_LIMITS);
            html += section('ADS (Shift aim)', TP_TUNER_ADS);
            html += `<div class="vx-fp-actions">
                <button type="button" class="vx-btn" data-tp-save>Save &amp; close</button>
                <button type="button" class="vx-btn" data-tp-reset-wpn>Reset weapon grip</button>
                <button type="button" class="vx-btn" data-tp-reset>Reset camera</button>
            </div>`;
            el.innerHTML = html;
            overlay.appendChild(el);

            el.addEventListener('input', onTpTunerInput);
            el.addEventListener('change', onTpTunerInput);
            el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
            el.querySelector('[data-tp-save]').addEventListener('click', () => {
                saveFpTune();
                saveTpTune(true);
                el.hidden = true;
                if (g.showMessage) g.showMessage('Camera & weapon stats saved (Shift+F8 to tweak again)', 2800);
            });
            el.querySelector('[data-tp-reset-wpn]').addEventListener('click', () => {
                const id = weaponDef ? weaponDef.id : 'sword';
                const defs = defaultTpWeaponTunes();
                tpTune.weapons[id] = Object.assign({}, defs[id] || defs.sword);
                syncTpTunerInputs();
                if (tpWeapon && weaponDef) applyTpWeaponGripRest(tpWeapon, weaponDef);
            });
            el.querySelector('[data-tp-reset]').addEventListener('click', () => {
                const weapons = tpTune.weapons;
                tpTune = defaultTpTune();
                tpTune.weapons = weapons;
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

        let aimTune = null;
        let aimTunerEl = null;
        const AIM_TUNE_KEY = 'pjboy.voxelAimTune.v1';
        const AIM_TUNER_SLIDERS = [
            ['strokeWidth', 'Stroke width', 0.006, 0.14, 0.002],
            ['opacity', 'Opacity', 0.1, 1, 0.01],
            ['pulse', 'Pulse amount', 0, 0.5, 0.01],
            ['pulseHz', 'Pulse speed', 0, 24, 0.5],
            ['mineGlow', 'Mining glow', 0, 0.6, 0.01],
            ['expand', 'Edge puff', 0, 0.12, 0.002]
        ];
        const _aimBaseCol = new THREE.Color();
        const _aimMineCol = new THREE.Color();

        function defaultAimTune() {
            return {
                dismissed: true,
                opacity: 0.55,
                pulse: 0.25,
                pulseHz: 7,
                mineGlow: 0.2,
                expand: 0,
                strokeWidth: 0.022,
                color: '#5ce8ff',
                mineColor: '#7af0ff'
            };
        }

        function loadAimTune() {
            try {
                const raw = localStorage.getItem(AIM_TUNE_KEY);
                if (raw) return Object.assign(defaultAimTune(), JSON.parse(raw));
            } catch (_) {}
            return defaultAimTune();
        }

        function saveAimTune(dismiss) {
            if (dismiss) getAimTune().dismissed = true;
            try {
                localStorage.setItem(AIM_TUNE_KEY, JSON.stringify(getAimTune()));
            } catch (_) {}
        }

        function syncAimTunerInputs() {
            if (!aimTunerEl) return;
            const t = getAimTune();
            AIM_TUNER_SLIDERS.forEach(([key]) => {
                const input = aimTunerEl.querySelector(`[data-aim-k="${key}"]`);
                const out = aimTunerEl.querySelector(`[data-aim-v="${key}"]`);
                const val = t[key];
                if (input) input.value = val;
                if (out) {
                    out.textContent = (+val).toFixed(
                        key === 'pulseHz' ? 1 : (key === 'strokeWidth' || key === 'expand' ? 3 : 2));
                }
            });
            const colorIn = aimTunerEl.querySelector('[data-aim-c="color"]');
            const mineIn = aimTunerEl.querySelector('[data-aim-c="mineColor"]');
            if (colorIn) colorIn.value = t.color || '#5ce8ff';
            if (mineIn) mineIn.value = t.mineColor || '#7af0ff';
        }

        function onAimTunerInput(e) {
            const t = getAimTune();
            const key = e.target.dataset.aimK;
            if (key) {
                t[key] = +e.target.value;
                const out = aimTunerEl.querySelector(`[data-aim-v="${key}"]`);
                if (out) {
                    out.textContent = (+t[key]).toFixed(
                        key === 'pulseHz' ? 1 : (key === 'strokeWidth' || key === 'expand' ? 3 : 2));
                }
                if (key === 'expand' || key === 'strokeWidth') refreshAimOutlineGeometry();
                return;
            }
            const ckey = e.target.dataset.aimC;
            if (ckey) {
                t[ckey] = e.target.value;
            }
        }

        function buildAimTunerUI() {
            if (aimTunerEl) return aimTunerEl;
            const overlay = document.getElementById('voxel-overlay');
            if (!overlay) return null;
            const el = document.createElement('div');
            el.id = 'voxel-aim-tuner';
            el.className = 'vx-fp-tuner vx-aim-tuner';
            el.hidden = true;

            function sliderRow(key, label, min, max, step) {
                const id = `aim-tune-${key}`;
                return `<label class="vx-fp-row vx-fp-cam-row" for="${id}">
                    <span class="vx-fp-lbl">${label}</span>
                    <span class="vx-tp-val" data-aim-v="${key}">—</span>
                    <input type="range" id="${id}" data-aim-k="${key}"
                        min="${min}" max="${max}" step="${step}">
                </label>`;
            }

            let html = `<div class="vx-fp-head">
                <h4>Aim highlight</h4>
                <span class="vx-fp-weapon">block outline</span>
            </div>
            <p class="vx-fp-hint">Mining target edges. <b>Shift+F9</b> toggles · aim at a block to preview.</p>
            <div class="vx-fp-section"><b>Look</b>`;
            html += `<label class="vx-fp-row vx-aim-color-row">
                <span class="vx-fp-lbl">Base color</span>
                <input type="color" data-aim-c="color" value="#5ce8ff">
            </label>`;
            html += `<label class="vx-fp-row vx-aim-color-row">
                <span class="vx-fp-lbl">Mining color</span>
                <input type="color" data-aim-c="mineColor" value="#7af0ff">
            </label>`;
            AIM_TUNER_SLIDERS.forEach(([key, label, min, max, step]) => {
                html += sliderRow(key, label, min, max, step);
            });
            html += `</div><div class="vx-fp-actions">
                <button type="button" class="vx-btn" data-aim-save>Save &amp; close</button>
                <button type="button" class="vx-btn" data-aim-reset>Reset defaults</button>
            </div>`;
            el.innerHTML = html;
            overlay.appendChild(el);

            el.addEventListener('input', onAimTunerInput);
            el.addEventListener('change', onAimTunerInput);
            el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
            el.querySelector('[data-aim-save]').addEventListener('click', () => {
                saveAimTune(true);
                el.hidden = true;
                if (g.showMessage) g.showMessage('Aim highlight saved (Shift+F9 to tweak)', 2400);
            });
            el.querySelector('[data-aim-reset]').addEventListener('click', () => {
                aimTune = defaultAimTune();
                aimTune.dismissed = false;
                syncAimTunerInputs();
                refreshAimOutlineGeometry();
            });

            aimTunerEl = el;
            return el;
        }

        function showAimTuner() {
            hideFpTuner();
            hideTpTuner();
            const el = buildAimTunerUI();
            if (!el) return;
            el.hidden = false;
            syncAimTunerInputs();
        }

        function hideAimTuner() {
            if (aimTunerEl) aimTunerEl.hidden = true;
        }

        function setFirstPerson(on) {
            firstPerson = !!on;
            if (av && av.group) av.group.visible = !firstPerson;
            ensureFpViewmodel();
            if (fpPivot) fpPivot.visible = firstPerson;
            const overlay = document.getElementById('voxel-overlay');
            if (overlay) overlay.classList.toggle('vx-tp-view', !firstPerson);
            if (camera) {
                camera.fov = firstPerson ? getFpCam().fov : getTpCam().fov;
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

        function ctrlHintRow(key, desc) {
            return `<div class="vx-ctrl-row"><kbd>${key}</kbd><span>${desc}</span></div>`;
        }

        function updateViewHints() {
            const el = document.getElementById('voxel-view-hint');
            if (!el) return;
            el.innerHTML = firstPerson
                ? [
                    ctrlHintRow('Mouse', 'aim'),
                    ctrlHintRow('Shift', 'focus scan')
                ].join('')
                : [
                    ctrlHintRow('Click', 'capture mouse'),
                    ctrlHintRow('Move', 'look around'),
                    ctrlHintRow('Scroll', 'zoom'),
                    ctrlHintRow('Shift', 'focus scan')
                ].join('');
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
                const t = 1 - (fpSwingTimer / fpSwingDurationActive);
                const dir = fpSwingDir || 1;
                const k = fpRecoilStrength();
                if (isSwordEquipped()) {
                    const swing = { ry: 0, rz: 0, rx: 0, pz: 0, py: 0, px: 0 };
                    applyFpSwordSwingPivot(t, k, swing);
                    ry += swing.ry;
                    rz += swing.rz;
                    rx += swing.rx;
                    pz += swing.pz;
                    py += swing.py;
                    px += swing.px;
                } else if (isLaserRifle()) {
                    const recoil = { ry: 0, rz: 0, rx: 0, pz: 0, py: 0, px: 0 };
                    applyFpLaserRecoilPivot(t, k, recoil);
                    ry += recoil.ry;
                    rz += recoil.rz;
                    rx += recoil.rx;
                    pz += recoil.pz;
                    py += recoil.py;
                    px += recoil.px;
                } else {
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
                    rx += (-antic * 0.4 + strike * 1.15) * k;
                    ry += strike * 0.16 * dir * k;
                    rz += (-strike * 1.35 - antic * 0.22) * dir * k;
                    pz += (-strike * 0.22 + antic * 0.08) * k;
                    py += (antic * 0.11 - strike * 0.15) * k;
                    px += (strike * 0.1 - antic * 0.04) * dir * k;
                }
            }

            fpPivot.position.set(px, py, pz);
            fpPivot.rotation.set(rx, ry, rz);
            applyFpMountPose();
            applyFpWeaponGripRest();
            if (fpWeapon && isSwordEquipped() && fpSwingTimer > 0) {
                const t = 1 - (fpSwingTimer / fpSwingDurationActive);
                applyFpSwordSwingWeapon(t);
            }
        }

        function mineBlock() {
            return tryLaserMine();
        }
        // Aim at a door and press F to open/close. Debounced so spam can't thrash saves.
        let _doorToggleCd = 0;
        function tryToggleDoor() {
            if (flying || voxelPanelOpen()) return;
            if (_doorToggleCd > 0) return;
            const t = pickTarget();
            if (!t) return;
            const id = getBlock(t.x, t.y, t.z);
            if (id !== DOOR_CLOSED && id !== DOOR_OPEN) return;
            setBlockEvent(t.x, t.y, t.z, id === DOOR_CLOSED ? DOOR_OPEN : DOOR_CLOSED);
            _doorToggleCd = 0.18;
            playSfx('voxelPlace');
            vxLangMsg(
                id === DOOR_CLOSED ? 'Door opened' : 'Door closed',
                id === DOOR_CLOSED ? 'Dør åbnet' : 'Dør lukket',
                900
            );
        }

        function placeBlock() {
            if (!isMiningTool()) {
                showToolMsg('Equip a mining tool to place blocks (Q/E)');
                return;
            }
            const t = pickTarget();
            if (!t) return;
            const slot = hotbar[selected];
            if (!slot || slot.count <= 0) {
                showToolMsg('Select a block in your quickbar (1–9)');
                return;
            }
            const { x, y, z } = t.place;
            if (!canPlaceBlockAt(x, y, z)) {
                if (!getBlock(x, y, z)) showToolMsg('Cannot place block here');
                return;
            }
            if (!spendFromInventory(slot.id, 1)) return;
            setBlockEvent(x, y, z, slot.id);
            playSfx('voxelPlace');
            const AP = getProfileApi();
            if (AP) {
                const { completed } = AP.recordPlace(AP.load());
                updateJournalHud();
                if (completed && g.showMessage) {
                    g.showMessage('Survey complete: ' + completed.title, 2800);
                }
            }
            renderHotbar();
            if (drawerOpen) renderDrawer();
            updateHUD();
        }
        
        // ---------- inventory: backpack + 9-slot quickbar + categorized drawer ----------
        const HOTBAR_SLOTS = 9;
        const INV_CATEGORIES = ['Terrain', 'Life', 'Resources', 'Crystals', 'Crafted', 'Hazards'];
        const CAT_ICONS = {
            Terrain: '🪨', Life: '🌿', Resources: '⛏️',
            Crystals: '💎', Crafted: '🔧', Hazards: '☢️', Creature: '🐾'
        };
        // Field Journal station — one tab per page. The six block categories live as
        // sections inside Backpack/Catalog rather than as their own tabs.
        const DRAWER_TABS = [
            { id: 'Backpack', icon: '🎒', label: 'Backpack' },
            { id: 'Catalog',  icon: '📖', label: 'Catalog' },
            { id: 'Gear',     icon: '⚔️', label: 'Gear' },
            { id: 'Refinery', icon: '⚙️', label: 'Refinery' },
            { id: 'Missions', icon: '🎯', label: 'Missions' },
            { id: 'Worlds',   icon: '🪐', label: 'Worlds' },
            { id: 'Settings', icon: '🎚️', label: 'Settings' }
        ];
        const INV_TINT = {
            weapon_melee:  { bg: 'rgba(42, 74, 140, 0.72)',  border: 'rgba(100, 160, 255, 0.55)', fill: '#1a3560' },
            weapon_ranged: { bg: 'rgba(140, 42, 58, 0.72)',  border: 'rgba(255, 100, 120, 0.55)', fill: '#601a28' },
            weapon_tool:   { bg: 'rgba(120, 82, 36, 0.72)',  border: 'rgba(210, 160, 80, 0.55)',  fill: '#4a3418' },
            Terrain:   { bg: 'rgba(107, 74, 47, 0.72)',  border: 'rgba(180, 130, 80, 0.5)',  fill: '#3d2a18' },
            Life:      { bg: 'rgba(42, 110, 58, 0.72)',  border: 'rgba(100, 210, 120, 0.5)', fill: '#1a4024' },
            Resources: { bg: 'rgba(130, 82, 32, 0.72)',  border: 'rgba(220, 160, 70, 0.5)',  fill: '#4a3010' },
            Crystals:  { bg: 'rgba(88, 52, 140, 0.72)',  border: 'rgba(180, 120, 255, 0.5)', fill: '#2e1a50' },
            Crafted:   { bg: 'rgba(36, 100, 118, 0.72)', border: 'rgba(90, 200, 230, 0.5)',  fill: '#143840' },
            Hazards:   { bg: 'rgba(110, 120, 32, 0.72)', border: 'rgba(210, 230, 80, 0.5)',  fill: '#3a4010' },
            empty:     { bg: 'rgba(18, 24, 40, 0.88)',  border: 'rgba(58, 168, 196, 0.28)', fill: '#121820' }
        };
        const WEAPONS_SAVE_KEY = 'pjboy.voxelWeapons.owned.v1';
        const HOTBAR_SAVE_KEY = 'pjboy.voxelHotbar.v1';
        const DRAWER_TAB_SAVE_KEY = 'pjboy.voxelInvTab.v1';
        const ownedWeapons = new Set();
        const hotbar = Array(HOTBAR_SLOTS).fill(null);
        const backpack = {};   // block id -> total count
        let selected = 0;
        let drawerOpen = false;
        let controlsDrawerOpen = false;
        let drawerFilter = 'owned';   // 'owned' | 'all'
        let drawerTab = 'Backpack';
        const hotbarEl = document.getElementById('voxel-hotbar');
        const drawerEl = document.getElementById('voxel-drawer');
        const drawerPanelEl = document.getElementById('voxel-drawer-panel');
        const controlsDrawerEl = document.getElementById('voxel-controls-drawer');

        function voxelPanelOpen() {
            return drawerOpen || controlsDrawerOpen || mapOpen;
        }

        function backpackTotal() {
            return Object.values(backpack).reduce((n, c) => n + c, 0);
        }
        function backpackTypes() {
            return Object.keys(backpack).filter((k) => backpack[k] > 0).length;
        }
        function scheduleProfileFlush() {
            if (_profileFlushTimer) return;
            _profileFlushTimer = setTimeout(() => {
                _profileFlushTimer = null;
                flushProfileState();
            }, 350);
        }

        function flushProfileState() {
            const AP = getProfileApi();
            if (!AP) return;
            const p = AP.load();
            p.inventory.backpack = Object.assign({}, backpack);
            p.inventory.hotbar = hotbar.map((s) => (s ? { id: s.id, count: s.count } : null));
            p.inventory.ownedWeapons = [...ownedWeapons];
            p.character = normalizeCharCfg(loadCharCfg());
            AP.save(p);
        }

        function loadInventoryFromProfile() {
            const AP = getProfileApi();
            if (!AP) return;
            const inv = AP.load().inventory;
            if (inv && inv.backpack) {
                Object.keys(backpack).forEach((k) => { delete backpack[k]; });
                Object.assign(backpack, inv.backpack);
            }
            refreshTierCache();
        }

        function loadOwnedWeapons() {
            ownedWeapons.clear();
            const AP = getProfileApi();
            if (AP) {
                const ow = AP.load().inventory.ownedWeapons;
                if (ow && ow.length) {
                    ow.forEach((i) => ownedWeapons.add(i | 0));
                }
            }
            if (!ownedWeapons.size) {
                try {
                    const raw = localStorage.getItem(WEAPONS_SAVE_KEY);
                    if (raw) {
                        JSON.parse(raw).forEach((i) => ownedWeapons.add(i | 0));
                    }
                } catch (_) {}
            }
            const defs = weaponList();
            const cfg = loadCharCfg();
            const VC = getVC();
            let start = 0;
            if (VC) {
                const cls = VC.CLASSES[cfg.classIdx | 0];
                const idx = defs.findIndex((w) => w.id === cls.weapon);
                if (idx >= 0) start = idx;
                if (cls.id === 'miner') {
                    const cutter = defs.findIndex((w) => w.id === 'minecutter');
                    if (cutter >= 0) ownedWeapons.add(cutter);
                }
            }
            ownedWeapons.add(start);
            ownedWeapons.add(cfg.weapon | 0);
            // Remote Detonator is always available (free-equip, like the other tools) so
            // the player can set off placed TNT from the weapon drawer.
            const det = defs.findIndex((w) => w.id === 'detonator');
            if (det >= 0) ownedWeapons.add(det);
            // Pickaxe is retired in Asteroid mode — never keep it owned.
            const px = defs.findIndex((w) => w.id === 'pickaxe');
            if (px >= 0) ownedWeapons.delete(px);
            saveOwnedWeapons();
        }
        function saveOwnedWeapons() {
            scheduleProfileFlush();
            try {
                localStorage.setItem(WEAPONS_SAVE_KEY, JSON.stringify([...ownedWeapons]));
            } catch (_) {}
        }
        function weaponStatLine(def) {
            if (!def || !def.stats) return '';
            const s = def.stats;
            return `DMG ${s.Damage} · SPD ${s.Speed} · RNG ${s.Range}`;
        }

        function invTintStyle(tint) {
            return `--vx-tint-bg:${tint.bg};--vx-tint-border:${tint.border};`;
        }

        function weaponTint(def) {
            if (def.id === 'pickaxe' || def.id === 'wrench' || def.id === 'minecutter') return INV_TINT.weapon_tool;
            return def.ranged ? INV_TINT.weapon_ranged : INV_TINT.weapon_melee;
        }

        function blockTint(cat) {
            return INV_TINT[cat] || INV_TINT.empty;
        }

        function createThumbWrap(tint, imageUrl, alt) {
            const wrap = document.createElement('div');
            wrap.className = 'vx-thumb-wrap';
            wrap.style.cssText = invTintStyle(tint);
            const thumb = document.createElement('div');
            thumb.className = 'vx-thumb';
            if (imageUrl) thumb.style.backgroundImage = `url(${imageUrl})`;
            if (alt) thumb.title = alt;
            wrap.appendChild(thumb);
            return wrap;
        }

        const WEAPON_THUMB_CACHE = {};
        function paintWeaponThumb(def) {
            const c = document.createElement('canvas');
            c.width = c.height = TILE;
            const x = c.getContext('2d');
            const tint = weaponTint(def);
            x.fillStyle = tint.fill;
            x.fillRect(0, 0, TILE, TILE);
            x.fillStyle = 'rgba(0,0,0,.22)';
            x.fillRect(0, 0, TILE, 1);
            x.fillRect(0, 0, 1, TILE);
            const px = (col, row, w, h, color) => {
                x.fillStyle = color;
                x.fillRect(col, row, w, h);
            };
            if (def.id === 'pickaxe') {
                px(14, 6, 4, 18, '#6b4a2a');
                px(8, 4, 16, 4, '#9aa8b8');
                px(6, 8, 6, 3, '#b8c4d0');
                px(20, 8, 6, 3, '#b8c4d0');
            } else if (def.id === 'wrench') {
                px(10, 8, 6, 14, '#c8d0dc');
                px(16, 8, 10, 4, '#c8d0dc');
                px(22, 12, 4, 8, '#c8d0dc');
            } else if (def.id === 'sword') {
                px(14, 4, 4, 18, '#8ec8ff');
                px(12, 20, 8, 3, '#d4a85a');
                px(15, 23, 2, 4, '#6b4a2a');
            } else if (def.id === 'blaster') {
                px(8, 12, 16, 6, '#c05050');
                px(22, 11, 8, 8, '#e07070');
                px(6, 14, 4, 2, '#404858');
            } else if (def.id === 'laser') {
                px(6, 12, 20, 5, '#d04058');
                px(24, 10, 10, 9, '#ff6080');
                px(4, 13, 6, 3, '#60c0ff');
            } else if (def.id === 'minecutter') {
                px(12, 12, 8, 10, '#404858');
                px(14, 10, 4, 4, '#6fe3ff');
                px(18, 14, 6, 4, '#9deeff');
                px(10, 16, 4, 3, '#6b4a2a');
            } else if (def.id === 'plasma') {
                px(12, 10, 12, 10, '#d04848');
                px(20, 12, 6, 6, '#ff9060');
                px(10, 14, 4, 4, '#404858');
            } else if (def.id === 'railgun') {
                px(4, 13, 22, 5, '#b83848');
                px(24, 11, 8, 9, '#e85868');
                px(6, 11, 4, 9, '#506878');
            } else {
                px(10, 10, 12, 12, '#9eb8c4');
            }
            return c.toDataURL();
        }

        function weaponThumb(def) {
            if (!WEAPON_THUMB_CACHE[def.id]) WEAPON_THUMB_CACHE[def.id] = paintWeaponThumb(def);
            return WEAPON_THUMB_CACHE[def.id];
        }

        function paintEmptyHandsThumb() {
            const c = document.createElement('canvas');
            c.width = c.height = TILE;
            const x = c.getContext('2d');
            const tint = INV_TINT.empty;
            x.fillStyle = tint.fill;
            x.fillRect(0, 0, TILE, TILE);
            x.strokeStyle = 'rgba(158, 184, 196, 0.55)';
            x.lineWidth = 2;
            x.strokeRect(10, 10, TILE - 20, TILE - 20);
            x.fillStyle = 'rgba(158, 184, 196, 0.35)';
            x.fillRect(14, 18, 8, 18);
            x.fillRect(TILE - 22, 18, 8, 18);
            return c.toDataURL();
        }

        function createEmptyHandsInvItem() {
            const equipped = weaponIndex < 0;
            const tint = INV_TINT.empty;
            const item = document.createElement('div');
            item.className = 'vx-item vx-weapon' + (equipped ? ' vx-equipped' : '');
            item.style.cssText = invTintStyle(tint);
            item.appendChild(createThumbWrap(tint, paintEmptyHandsThumb(), 'Empty hands'));
            const name = document.createElement('div');
            name.className = 'vx-name';
            name.title = 'Empty hands';
            name.textContent = 'Empty hands';
            item.appendChild(name);
            item.addEventListener('click', () => setWeaponIndex(-1));
            return item;
        }

        function createWeaponInvItem(def, index, ownedOnly) {
            const owned = ownedWeapons.has(index);
            const equipped = weaponIndex === index;
            const tint = weaponTint(def);
            const item = document.createElement('div');
            item.className = 'vx-item vx-weapon'
                + (equipped ? ' vx-equipped' : '')
                + (!owned && ownedOnly ? ' vx-empty' : '');
            item.style.cssText = invTintStyle(tint);
            item.appendChild(createThumbWrap(tint, gear3DThumb(index), def.name));
            const name = document.createElement('div');
            name.className = 'vx-name';
            name.title = def.name;
            name.textContent = def.name;
            item.appendChild(name);
            const tier = weaponTierOf(def.id);
            if (owned && tier > 1) {
                const badge = document.createElement('div');
                badge.className = 'vx-tier-badge';
                badge.textContent = TIER_NAME[tier];
                item.appendChild(badge);
            }
            if (owned) {
                item.addEventListener('click', () => setWeaponIndex(index));
            } else if (!ownedOnly) {
                item.classList.add('vx-locked');
                item.addEventListener('click', () => {
                    if (g.showMessage) g.showMessage('Locked — craft at Tab → Refinery', 2200);
                });
            }
            return item;
        }

        function createBlockInvItem(b, cnt) {
            const tint = blockTint(b.cat);
            const item = document.createElement('div');
            item.className = 'vx-item' + (cnt <= 0 ? ' vx-empty' : '');
            item.style.cssText = invTintStyle(tint);
            item.draggable = cnt > 0;
            item.dataset.blockId = String(b.id);
            item.appendChild(createThumbWrap(tint, block3DThumb(b), b.name));
            const name = document.createElement('div');
            name.className = 'vx-name';
            name.title = b.name;
            name.textContent = b.name;
            item.appendChild(name);
            const amt = document.createElement('div');
            amt.className = 'vx-amt';
            amt.textContent = cnt > 0 ? String(cnt) : '0';
            item.appendChild(amt);
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
            return item;
        }

        function saveHotbarLayout() {
            scheduleProfileFlush();
            try { localStorage.setItem(HOTBAR_SAVE_KEY, JSON.stringify(hotbar)); } catch (_) {}
        }

        function loadHotbarLayout() {
            const AP = getProfileApi();
            if (AP) {
                const saved = AP.load().inventory.hotbar;
                if (saved && saved.length) {
                    for (let i = 0; i < HOTBAR_SLOTS; i++) {
                        const s = saved[i];
                        hotbar[i] = s && s.id ? { id: s.id | 0, count: s.count | 0 } : null;
                    }
                    return;
                }
            }
            try {
                const raw = localStorage.getItem(HOTBAR_SAVE_KEY);
                if (!raw) return;
                const data = JSON.parse(raw);
                if (!Array.isArray(data) || data.length !== HOTBAR_SLOTS) return;
                for (let i = 0; i < HOTBAR_SLOTS; i++) {
                    const s = data[i];
                    hotbar[i] = s && s.id != null ? { id: s.id | 0, count: s.count | 0 } : null;
                }
                syncHotbarFromBackpack();
            } catch (_) {}
        }

        function loadDrawerTab() {
            try {
                const tab = localStorage.getItem(DRAWER_TAB_SAVE_KEY);
                if (tab && DRAWER_TABS.some((t) => t.id === tab)) drawerTab = tab;
            } catch (_) {}
        }

        function saveDrawerTab() {
            try { localStorage.setItem(DRAWER_TAB_SAVE_KEY, drawerTab); } catch (_) {}
        }

        function swapHotbarSlots(a, b) {
            if (a === b || a < 0 || b < 0 || a >= HOTBAR_SLOTS || b >= HOTBAR_SLOTS) return;
            const tmp = hotbar[a];
            hotbar[a] = hotbar[b];
            hotbar[b] = tmp;
            saveHotbarLayout();
            renderHotbar();
            if (drawerOpen) renderDrawer();
        }

        function renderDrawerTabBody(body, ownedOnly) {
            body.innerHTML = '';
            if (drawerTab === 'Refinery') { renderRefineryBody(body); return; }
            if (drawerTab === 'Catalog') { renderCatalogBody(body); return; }
            if (drawerTab === 'Missions') { renderMissionsBody(body); return; }
            if (drawerTab === 'Worlds') { renderWorldsBody(body); return; }
            if (drawerTab === 'Settings') { renderSettingsBody(body); return; }
            if (drawerTab === 'Gear') { renderGearBody(body, ownedOnly); return; }
            renderBackpackBody(body, ownedOnly);
        }

        // Backpack: all block categories as sections in one page.
        function renderBackpackBody(body, ownedOnly) {
            let any = false;
            INV_CATEGORIES.forEach((cat) => {
                const blocks = BlockRegistry.filter((b) => b.cat === cat && !b.water && !b.hidden);
                const visible = ownedOnly ? blocks.filter((b) => getBackpackCount(b.id) > 0) : blocks;
                if (!visible.length) return;
                any = true;
                const sec = document.createElement('div');
                sec.className = 'vx-section';
                const h = document.createElement('h4');
                h.innerHTML = (CAT_ICONS[cat] || '▪') + ' ' + cat + ' <span class="vx-count">' + visible.length + '</span>';
                sec.appendChild(h);
                const grid = document.createElement('div');
                grid.className = 'vx-grid';
                visible.forEach((b) => grid.appendChild(createBlockInvItem(b, getBackpackCount(b.id))));
                sec.appendChild(grid);
                body.appendChild(sec);
            });
            if (!any) {
                const e = document.createElement('div');
                e.className = 'vx-inv-empty';
                e.textContent = ownedOnly ? 'Your backpack is empty — go mine some blocks!' : 'No blocks.';
                body.appendChild(e);
            }
        }

        // Gear: empty hands + weapons.
        function renderGearBody(body, ownedOnly) {
            const grid = document.createElement('div');
            grid.className = 'vx-grid';
            grid.appendChild(createEmptyHandsInvItem());
            const defs = weaponList();
            const visible = (ownedOnly
                ? defs.map((d, i) => ({ def: d, i })).filter((x) => ownedWeapons.has(x.i))
                : defs.map((d, i) => ({ def: d, i })))
                .filter((x) => x.def.id !== 'pickaxe');   // pickaxe retired in Asteroid mode
            if (!visible.length) {
                const empty = document.createElement('div');
                empty.className = 'vx-inv-empty';
                empty.textContent = 'No weapons unlocked yet.';
                grid.appendChild(empty);
            } else {
                visible.forEach(({ def, i }) => grid.appendChild(createWeaponInvItem(def, i, ownedOnly)));
            }
            body.appendChild(grid);
        }

        // Catalog: Pokédex of every block — discovered ones show science, the rest
        // are locked silhouettes, with a "X / N discovered" progress bar.
        // Short, kid-friendly "where to find it" hints by block id.
        const BLOCK_WHERE = {
            1: 'On the surface of mild, green meadows.',
            2: 'Just under the grass, all across the surface.',
            3: 'Underground below the soil — the bulk of every world.',
            4: 'On beaches by the water and across dry deserts.',
            19: 'Scattered over bare, rocky ground.',
            16: 'On dry, dusty and barren worlds.',
            18: 'High mountains and hot volcanic worlds.',
            17: 'Deep down, near the bottom of the world.',
            21: 'Where lava cools against stone, deep underground.',
            8: 'Frozen poles and icy worlds.',
            20: 'Cold mountaintops and snowy tundra.',
            40: 'Fills the oceans, lakes and rivers.',
            5: 'The trunks of trees on grassy ground.',
            6: 'The leafy crowns of trees.',
            12: 'On lush, wet alien ground.',
            13: 'On lush, wet alien ground.',
            14: 'In cool, damp meadows — it glows.',
            15: 'In warm golden grasslands.',
            36: 'On fungal worlds where green plants cannot grow.',
            27: 'Shallow underground, in long dark seams.',
            22: 'Underground, above the deeper metals.',
            23: 'Underground, a little deeper than copper.',
            24: 'Deep underground in small pockets.',
            25: 'Very deep, down in the basalt.',
            28: 'The deepest, rarest ore near the bedrock.',
            26: 'On the walls of underground caves.',
            9: 'In strange, glowing veins underground.',
            11: 'Trapped in rock deep near the molten core.',
            38: 'In the hot molten core of the world.',
            39: 'In pools on cave floors underground.',
            37: 'Organic nests hidden underground.'
        };
        function blockWhere(b) {
            if (BLOCK_WHERE[b.id]) return BLOCK_WHERE[b.id];
            if (b.cat === 'Crafted') return 'Made by you at the Refinery.';
            if (b.cat === 'Crystals') return 'Growing in deep underground caves.';
            return 'Out in the world — keep exploring to find it.';
        }
        const CATEGORY_BADGES = {
            Terrain: { icon: '🪨', title: 'Geologist' }, Life: { icon: '🌿', title: 'Botanist' },
            Resources: { icon: '⛏️', title: 'Miner' }, Crystals: { icon: '💎', title: 'Gemologist' },
            Crafted: { icon: '🔧', title: 'Engineer' }, Hazards: { icon: '☢️', title: 'Survivor' }
        };
        let codexView = null;     // null = overview, else {kind:'block',id} | {kind:'gear',idx}
        let _drawerRenderKey = null;   // last rendered view — used to preserve scroll across same-view re-renders
        let codexSection = 'Blocks';   // 'Blocks' | 'Gear'

        // Codex overview: a Blocks/Gear toggle, then the chosen section.
        function renderCatalogBody(body) {
            if (codexView) { renderCodexDetail(body); return; }
            const seg = document.createElement('div');
            seg.className = 'vx-codex-seg';
            const SEG_LABEL = { Blocks: '📖 Blocks', Life: '🐾 Life', Gear: '⚔️ Gear' };
            ['Blocks', 'Life', 'Gear'].forEach((s) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'vx-seg-btn' + (codexSection === s ? ' vx-seg-on' : '');
                btn.textContent = SEG_LABEL[s];
                btn.addEventListener('click', () => { codexSection = s; renderDrawer(); });
                seg.appendChild(btn);
            });
            body.appendChild(seg);
            if (codexSection === 'Gear') { renderCodexGearList(body); return; }
            if (codexSection === 'Life') { renderCodexCreatureList(body); return; }
            const AP = getProfileApi();
            const scanned = (AP && AP.load().journal && AP.load().journal.scanned) || {};
            const all = BlockRegistry.filter((b) => !b.water && !b.hidden);   // water / open-door state hidden
            const discovered = all.filter((b) => scanned[String(b.id)]).length;
            const total = all.length;
            const pct = Math.round(discovered / Math.max(1, total) * 100);
            const head = document.createElement('div');
            head.className = 'vx-cat-head';
            let badges = '<div class="vx-badges">';
            INV_CATEGORIES.forEach((cat) => {
                const blocks = all.filter((b) => b.cat === cat);
                if (!blocks.length) return;
                const earned = blocks.every((b) => scanned[String(b.id)]);
                const bd = CATEGORY_BADGES[cat] || { icon: '▪', title: cat };
                badges += '<span class="vx-badge' + (earned ? ' vx-badge-earned' : '') + '" title="' + bd.title + (earned ? ' — earned!' : '') + '">' + bd.icon + '</span>';
            });
            badges += '</div>';
            head.innerHTML = '<div class="vx-cat-label">Codex — <b>' + discovered + ' / ' + total + '</b> discovered</div>'
                + '<div class="vx-quest-bar"><span style="width:' + pct + '%"></span><em>' + pct + '%</em></div>' + badges;
            body.appendChild(head);
            INV_CATEGORIES.forEach((cat) => {
                const blocks = all.filter((b) => b.cat === cat);
                if (!blocks.length) return;
                const dCount = blocks.filter((b) => scanned[String(b.id)]).length;
                const earned = dCount === blocks.length;
                const bd = CATEGORY_BADGES[cat] || { icon: '▪', title: cat };
                const sec = document.createElement('div');
                sec.className = 'vx-section';
                const h = document.createElement('h4');
                h.innerHTML = (CAT_ICONS[cat] || '▪') + ' ' + cat + ' <span class="vx-count">' + dCount + ' / ' + blocks.length
                    + (earned ? ' · <b class="vx-badge-tag">' + bd.icon + ' ' + bd.title + '</b>' : '') + '</span>';
                sec.appendChild(h);
                const grid = document.createElement('div');
                grid.className = 'vx-cat-grid';
                blocks.forEach((b) => {
                    const found = !!scanned[String(b.id)];
                    const tile = document.createElement('div');
                    tile.className = 'vx-cat-tile' + (found ? '' : ' vx-cat-locked');
                    if (found) {
                        tile.style.cssText = invTintStyle(blockTint(b.cat));
                        tile.appendChild(createThumbWrap(blockTint(b.cat), block3DThumb(b), b.name));
                        const nm = document.createElement('div');
                        nm.className = 'vx-cat-name';
                        nm.textContent = b.name;
                        tile.appendChild(nm);
                        tile.addEventListener('click', () => { codexView = { kind: 'block', id: b.id }; renderDrawer(); });
                    } else {
                        const q = document.createElement('div');
                        q.className = 'vx-cat-q';
                        q.textContent = '?';
                        tile.appendChild(q);
                        const nm = document.createElement('div');
                        nm.className = 'vx-cat-name';
                        nm.textContent = '???';
                        tile.appendChild(nm);
                    }
                    grid.appendChild(tile);
                });
                sec.appendChild(grid);
                body.appendChild(sec);
            });
        }

        // Codex › Gear: every tool + weapon, tap for full stats + backstory.
        function renderCodexGearList(body) {
            const defs = weaponList();
            const intro = document.createElement('div');
            intro.className = 'vx-page-intro';
            intro.textContent = 'Tap a tool or weapon to read its stats and story.';
            body.appendChild(intro);
            const grid = document.createElement('div');
            grid.className = 'vx-cat-grid';
            defs.forEach((def, i) => {
                const tint = weaponTint(def);
                const tile = document.createElement('div');
                tile.className = 'vx-cat-tile';
                tile.style.cssText = invTintStyle(tint);
                tile.appendChild(createThumbWrap(tint, gear3DThumb(i), def.name));
                const nm = document.createElement('div');
                nm.className = 'vx-cat-name';
                nm.textContent = def.name;
                tile.appendChild(nm);
                tile.addEventListener('click', () => { codexView = { kind: 'gear', idx: i }; renderDrawer(); });
                grid.appendChild(tile);
            });
            body.appendChild(grid);
        }

        function renderCodexDetail(body) {
            const back = document.createElement('button');
            back.type = 'button';
            back.className = 'vx-btn vx-codex-back';
            back.innerHTML = '← Back to Codex';
            back.addEventListener('click', () => { codexView = null; renderDrawer(); });
            body.appendChild(back);
            if (codexView.kind === 'gear') renderGearDetail(body, weaponList()[codexView.idx], codexView.idx);
            else if (codexView.kind === 'creature') renderCreatureDetail(body, _AC && _AC.get(codexView.id));
            else renderBlockDetail(body, blockById(codexView.id));
        }

        // Codex › Life: the bestiary — scan a creature to discover it.
        const KINGDOM_ICON = { Animal: '🐾', Fungi: '🍄', Construct: '🤖', Projection: '✨' };
        function renderCodexCreatureList(body) {
            const AP = getProfileApi();
            const defs = (_AC && _AC.DEFS) || [];
            const caught = (AP && AP.load().journal && AP.load().journal.creatures) || {};
            const disc = defs.filter((d) => caught[d.id]).length;
            const pct = Math.round(disc / Math.max(1, defs.length) * 100);
            const head = document.createElement('div');
            head.className = 'vx-cat-head';
            head.innerHTML = '<div class="vx-cat-label">Bestiary — <b>' + disc + ' / ' + defs.length + '</b> discovered</div>'
                + '<div class="vx-quest-bar"><span style="width:' + pct + '%"></span><em>' + pct + '%</em></div>'
                + '<div class="vx-page-intro" style="margin-top:6px;">Hold Shift and aim at an animal to scan it.</div>';
            body.appendChild(head);
            const grid = document.createElement('div');
            grid.className = 'vx-cat-grid';
            defs.forEach((d) => {
                const found = !!caught[d.id];
                const tile = document.createElement('div');
                tile.className = 'vx-cat-tile' + (found ? '' : ' vx-cat-locked');
                const icon = document.createElement('div');
                icon.className = 'vx-cat-q';
                icon.textContent = found ? (KINGDOM_ICON[d.sci && d.sci.kingdom] || '🐾') : '?';
                tile.appendChild(icon);
                const nm = document.createElement('div');
                nm.className = 'vx-cat-name';
                nm.textContent = found ? d.name : '???';
                tile.appendChild(nm);
                if (found) tile.addEventListener('click', () => { codexView = { kind: 'creature', id: d.id }; renderDrawer(); });
                grid.appendChild(tile);
            });
            body.appendChild(grid);
        }

        function renderCreatureDetail(body, d) {
            if (!d) return;
            const da = (typeof BLOCK_DA !== 'undefined' && BLOCK_DA[d.name]) ? ' · ' + BLOCK_DA[d.name] : '';
            const icon = KINGDOM_ICON[d.sci && d.sci.kingdom] || '🐾';
            const page = document.createElement('div');
            page.className = 'vx-codex';
            let html = '<div class="vx-codex-head"><div class="vx-codex-headtext">'
                + '<div class="vx-codex-name">' + d.name + '<span class="vx-codex-da">' + da + '</span></div>'
                + '<div class="vx-codex-cat">' + icon + ' ' + (d.cat || 'Creature') + '</div></div></div>';
            html += '<div class="vx-codex-row"><b>Home</b> ' + (d.biome || '—') + '</div>';
            html += '<div class="vx-codex-row"><b>Temperament</b> ' + (d.temp || '—')
                + (d.threat && d.threat !== 'None' ? ' · Threat ' + d.threat : '') + '</div>';
            if (d.desc) html += '<div class="vx-codex-desc">' + d.desc + '</div>';
            if (d.sci) {
                html += '<div class="vx-codex-row"><b>Kingdom</b> ' + (d.sci.kingdom || '—') + '</div>';
                if (d.sci.fact) html += '<div class="vx-codex-fact"><span class="vx-codex-fact-icon">🔬</span><span>' + d.sci.fact + '</span></div>';
            }
            page.innerHTML = html;
            body.appendChild(page);
        }

        function renderBlockDetail(body, b) {
            if (!b) return;
            const da = (typeof BLOCK_DA !== 'undefined' && BLOCK_DA[b.name]) ? ' · ' + BLOCK_DA[b.name] : '';
            const page = document.createElement('div');
            page.className = 'vx-codex';
            let html = '<div class="vx-codex-head">'
                + '<div class="vx-codex-thumb" style="background-image:url(' + block3DThumb(b) + ')"></div>'
                + '<div class="vx-codex-headtext"><div class="vx-codex-name">' + b.name + '<span class="vx-codex-da">' + da + '</span></div>'
                + '<div class="vx-codex-cat">' + (CAT_ICONS[b.cat] || '▪') + ' ' + b.cat + '</div></div></div>';
            const hard = Math.max(0, Math.min(10, b.hardness | 0));
            let pips = '';
            for (let i = 0; i < 10; i++) pips += '<span class="vx-pip' + (i < hard ? ' vx-pip-on' : '') + '"></span>';
            html += '<div class="vx-codex-statline"><span class="vx-codex-statlabel">Hardness</span><span class="vx-pips">' + pips + '</span></div>';
            const counts = parseFormulaCounts(b.sci && b.sci.formula);
            if (counts) {
                let chips = '';
                Object.entries(counts).sort((a, c) => c[1] - a[1]).forEach(([el, n]) => {
                    const e = formulaElm(el);
                    const col = '#' + (e.color & 0xffffff).toString(16).padStart(6, '0');
                    chips += '<span class="vx-elm"><span class="vx-elm-dot" style="background:' + col + '"></span>' + n + '× ' + e.name + '</span>';
                });
                html += '<div class="vx-codex-block"><div class="vx-codex-h">Made of</div>'
                    + '<div class="vx-codex-formula">' + b.sci.formula + '</div><div class="vx-elms">' + chips + '</div></div>';
            }
            if (b.sci && b.sci.mineral) html += '<div class="vx-codex-row"><b>Mineral</b> ' + b.sci.mineral + '</div>';
            html += '<div class="vx-codex-row"><b>Where</b> ' + blockWhere(b) + '</div>';
            if (b.tags && b.tags.length) html += '<div class="vx-codex-tags">' + b.tags.map((t) => '<span class="vx-codex-tag">' + t + '</span>').join('') + '</div>';
            if (b.desc) html += '<div class="vx-codex-desc">' + b.desc + '</div>';
            if (b.sci && b.sci.fact) html += '<div class="vx-codex-fact"><span class="vx-codex-fact-icon">🔬</span><span>' + b.sci.fact + '</span></div>';
            page.innerHTML = html;
            body.appendChild(page);
        }

        function renderGearDetail(body, def, idx) {
            if (!def) return;
            idx = idx | 0;
            const page = document.createElement('div');
            page.className = 'vx-codex';
            const type = (def.ranged ? 'Ranged' : 'Melee') + ' · ' + (def.twoHanded ? 'Two-handed' : 'One-handed');
            const equipped = (weaponIndex === idx);
            const owned = ownedWeapons.has(idx);
            const tier = weaponTierOf(def.id);
            // effective (tiered) gameplay numbers
            const g = weaponGameplayFor(def.id);
            const effDmg = Math.round(g.dmg || 0);
            const effReach = Math.round(AIM_REACH * THREE.MathUtils.clamp(g.range, 0.12, 1));
            let stats = '<div class="vx-codex-block"><div class="vx-codex-h">Stats · ' + TIER_NAME[tier] + '</div>';
            const effBar = (label, v, max) => { const w = Math.max(0, Math.min(100, (v / max) * 100));
                return '<div class="vx-statbar"><span class="vx-statbar-label">' + label + '</span>'
                    + '<span class="vx-statbar-track"><span class="vx-statbar-fill" style="width:' + w + '%"></span></span>'
                    + '<span class="vx-statbar-num">' + v + '</span></div>'; };
            stats += effBar('Damage', effDmg, 35);
            stats += effBar('Reach', effReach, 13);
            const mineV = Math.round((g.mining || 0) * 10) / 10;   // blocks/s (minecutter only)
            stats += effBar('Mining', mineV, 17);
            stats += '</div>';
            // upgrade row (owned + below Mk V) — upgrade right here, mirrors the Refinery
            let upRow = '';
            if (owned) {
                if (tier >= 5) upRow = '<div class="vx-codex-fact"><span class="vx-codex-fact-icon">⬆</span><span>Fully upgraded (Mk V).</span></div>';
                else {
                    const cost = UPGRADE_COST[tier + 1] || [];
                    const can = canAfford(cost);
                    const costStr = cost.map((c) => { const have = getBackpackCount(c.id), col = have >= c.count ? '#9be89b' : '#ff9b9b';
                        return '<span style="color:' + col + '">' + refineryMatName(c.id) + ' ' + have + '/' + c.count + '</span>'; }).join(' · ');
                    upRow = '<div class="vx-codex-block"><div class="vx-codex-h">Upgrade → ' + TIER_NAME[tier + 1] + '</div>'
                        + '<div style="font-size:12px;margin-bottom:8px;">' + costStr + '</div>'
                        + '<button type="button" class="vx-equip-btn' + (can ? ' vx-equip-on' : '') + '" data-upgrade' + (can ? '' : ' disabled') + '>'
                        + '⬆ Upgrade</button></div>';
                }
            }
            const desc = def.desc ? '<div class="vx-codex-fact"><span class="vx-codex-fact-icon">📖</span><span>' + def.desc + '</span></div>' : '';
            const lockHint = !owned
                ? '<div class="vx-codex-fact"><span class="vx-codex-fact-icon">🔒</span><span>Craft this at Tab → Refinery to unlock.</span></div>'
                : '';
            page.innerHTML = '<div class="vx-gear-detail">'
                + '<div class="vx-gear-stage"><canvas class="vx-gear-canvas" aria-label="' + def.name + '"></canvas></div>'
                + '<div class="vx-gear-headrow"><div>'
                + '<div class="vx-codex-name">' + def.name + (tier > 1 ? ' <span class="vx-tier-chip">' + TIER_NAME[tier] + '</span>' : '') + '</div>'
                + '<div class="vx-codex-cat">⚔️ ' + type + '</div></div>'
                + '<button type="button" class="vx-equip-btn' + (equipped ? ' vx-equip-on' : '') + '"'
                + (equipped || !owned ? ' disabled' : '') + ' data-equip>'
                + (equipped ? '✓ Equipped' : (owned ? 'Equip' : '🔒 Locked')) + '</button>'
                + '</div>'
                + stats + upRow + lockHint + desc
                + '</div>';
            body.appendChild(page);
            const eb = page.querySelector('[data-equip]');
            if (eb && !equipped && owned) eb.addEventListener('click', () => {
                setWeaponIndex(idx); renderDrawer();
            });
            const ub = page.querySelector('[data-upgrade]');
            if (ub && !ub.disabled) ub.addEventListener('click', () => { upgradeWeapon(def.id); renderDrawer(); });
            startGearViewer(page.querySelector('.vx-gear-canvas'), idx);
        }

        // Bounding box of an object's VISIBLE geometry only — beam weapons carry a long
        // hidden beam mesh that would otherwise blow up the box (and shrink the model).
        function _visibleBox(root) {
            const box = new THREE.Box3();
            root.updateWorldMatrix(true, true);
            root.traverse((o) => {
                if (!o.geometry) return;
                let n = o, hidden = false;
                while (n) { if (n.visible === false) { hidden = true; break; } if (n === root) break; n = n.parent; }
                if (hidden) return;
                if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
                const bb = o.geometry.boundingBox;
                if (bb && isFinite(bb.min.x)) box.union(bb.clone().applyMatrix4(o.matrixWorld));
            });
            return box;
        }

        // ---- mini orbiting 3D preview of the codex weapon/tool ----
        const gearViewer = { renderer: null, scene: null, camera: null, pivot: null, raf: 0 };
        function disposeGearViewer() {
            if (gearViewer.raf) { cancelAnimationFrame(gearViewer.raf); gearViewer.raf = 0; }
            if (gearViewer.pivot) {
                gearViewer.pivot.traverse((o) => {
                    if (o.geometry) o.geometry.dispose();
                    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
                });
                gearViewer.pivot = null;
            }
            if (gearViewer.renderer) { gearViewer.renderer.dispose(); gearViewer.renderer = null; }
            gearViewer.scene = null; gearViewer.camera = null;
        }
        function startGearViewer(canvas, idx) {
            disposeGearViewer();
            if (!canvas || typeof THREE === 'undefined') return;
            const w = Math.max(8, canvas.clientWidth), h = Math.max(8, canvas.clientHeight);
            const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
            r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            r.setSize(w, h, false);
            const scene = new THREE.Scene();
            const cam = new THREE.PerspectiveCamera(30, w / h, 0.1, 40);
            cam.position.set(0, 0.1, 3.0); cam.lookAt(0, 0, 0);
            scene.add(new THREE.AmbientLight(0xfff0d8, 0.85));
            const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(2.2, 3, 3.5); scene.add(key);
            const rim = new THREE.DirectionalLight(0xffce8a, 0.5); rim.position.set(-2.5, -1, -2); scene.add(rim);
            const pivot = new THREE.Group();
            let mesh = null;
            try { mesh = buildWeaponMesh(charAccent(), idx | 0).mesh; } catch (_) { mesh = null; }
            if (mesh) {
                const box = _visibleBox(mesh);
                const size = new THREE.Vector3(); box.getSize(size);
                const center = new THREE.Vector3(); box.getCenter(center);
                mesh.position.sub(center);
                const holder = new THREE.Group();
                holder.add(mesh);
                // Natural orientation in a wide landscape stage; fit so the turntable
                // sweep (around Y) fits the width and the height fits the frame height.
                const halfH = 3.0 * Math.tan((30 * Math.PI / 180) / 2);
                const halfW = halfH * (w / h);
                const horizEnv = Math.hypot(size.x, size.z) || 0.001;   // worst-case width while spinning around Y
                const vertEnv = (size.y || 0.001) * 1.06;               // a touch of headroom for the tilt
                holder.scale.setScalar(Math.min((halfW * 2 * 0.84) / horizEnv, (halfH * 2 * 0.84) / vertEnv));
                pivot.add(holder);
            }
            pivot.rotation.x = 0.34;
            scene.add(pivot);
            gearViewer.renderer = r; gearViewer.scene = scene; gearViewer.camera = cam; gearViewer.pivot = pivot;
            const loop = () => {
                if (!gearViewer.renderer) return;
                pivot.rotation.y += 0.012;
                r.render(scene, cam);
                gearViewer.raf = requestAnimationFrame(loop);
            };
            loop();
        }

        // ---- shared offscreen renderer for mini 3D tile thumbnails (rendered once,
        // cached as images so the journal grids stay cheap) ----
        let _thumbRenderer = null, _thumbScene = null, _thumbCam = null;
        const _block3DCache = {}, _gear3DCache = {};
        function ensureThumbRenderer() {
            if (_thumbRenderer || typeof THREE === 'undefined') return;
            try {
                const c = document.createElement('canvas'); c.width = c.height = 128;
                _thumbRenderer = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true });
                _thumbRenderer.setPixelRatio(1);
                _thumbRenderer.setSize(128, 128, false);
                _thumbScene = new THREE.Scene();
                _thumbScene.add(new THREE.AmbientLight(0xfff2e0, 0.95));
                const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(3, 5, 4); _thumbScene.add(key);
                const rim = new THREE.DirectionalLight(0xffce8a, 0.4); rim.position.set(-3, 1, -2); _thumbScene.add(rim);
                _thumbCam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
            } catch (_) { _thumbRenderer = null; }
        }
        function disposeThumbRenderer() {
            if (_thumbRenderer) { _thumbRenderer.dispose(); _thumbRenderer = null; }
            _thumbScene = null; _thumbCam = null;
        }
        function _tileTex(name, frame) {
            const t = new THREE.CanvasTexture(paintTile(name, frame));
            t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
            return t;
        }
        // A lit, angled 3D cube of the block (top + two sides), cached by id.
        function block3DThumb(b) {
            if (_block3DCache[b.id]) return _block3DCache[b.id];
            ensureThumbRenderer();
            if (!_thumbRenderer) return thumb(b);
            const tl = b.tiles, fr = b.animated ? 0 : undefined;
            const topN = tl.all || tl.top || tl.side, sideN = tl.all || tl.side || tl.top, botN = tl.all || tl.bottom || tl.side || tl.top;
            const opt = b.transparent ? { transparent: true, opacity: 0.9 } : {};
            const sideM = new THREE.MeshLambertMaterial(Object.assign({ map: _tileTex(sideN, fr) }, opt));
            const topM = new THREE.MeshLambertMaterial(Object.assign({ map: _tileTex(topN, fr) }, opt));
            const botM = new THREE.MeshLambertMaterial(Object.assign({ map: _tileTex(botN, fr) }, opt));
            const mats = [sideM, sideM, topM, botM, sideM, sideM];
            const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats);
            const grp = new THREE.Group(); grp.add(cube); grp.rotation.set(0.5, -0.62, 0);
            _thumbScene.add(grp);
            _thumbCam.fov = 30; _thumbCam.position.set(0, 0, 3.4); _thumbCam.lookAt(0, 0, 0); _thumbCam.updateProjectionMatrix();
            _thumbRenderer.render(_thumbScene, _thumbCam);
            const url = _thumbRenderer.domElement.toDataURL();
            _thumbScene.remove(grp);
            cube.geometry.dispose();
            [sideM, topM, botM].forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
            _block3DCache[b.id] = url;
            return url;
        }
        // The procedural weapon mesh rendered at an angle, cached by index.
        function gear3DThumb(idx) {
            idx = idx | 0;
            if (_gear3DCache[idx]) return _gear3DCache[idx];
            ensureThumbRenderer();
            let mesh = null;
            try { mesh = buildWeaponMesh(charAccent(), idx).mesh; } catch (_) { mesh = null; }
            if (!_thumbRenderer || !mesh) return weaponThumb(weaponList()[idx]);
            const box = _visibleBox(mesh);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            mesh.position.sub(center);
            const holder = new THREE.Group(); holder.add(mesh);
            holder.scale.setScalar(1.35 / (Math.max(size.x, size.y, size.z) || 1));
            const grp = new THREE.Group(); grp.add(holder); grp.rotation.set(0.3, -0.7, 0);
            _thumbScene.add(grp);
            _thumbCam.fov = 30; _thumbCam.position.set(0, 0, 3.0); _thumbCam.lookAt(0, 0, 0); _thumbCam.updateProjectionMatrix();
            _thumbRenderer.render(_thumbScene, _thumbCam);
            const url = _thumbRenderer.domElement.toDataURL();
            _thumbScene.remove(grp);
            grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
            _gear3DCache[idx] = url;
            return url;
        }

        // Missions: the survey quest log with progress.
        function renderMissionsBody(body) {
            const AP = getProfileApi();
            if (!AP) { body.innerHTML = '<div class="vx-inv-empty">No profile loaded.</div>'; return; }
            const p = AP.load();
            const missions = AP.MISSIONS || [];
            const completed = (p.missions && p.missions.completed) || [];
            const activeId = p.missions && p.missions.active;
            const prog = AP.missionProgress(p);
            const intro = document.createElement('div');
            intro.className = 'vx-page-intro';
            intro.textContent = 'Survey missions — finish them to chart new worlds.';
            body.appendChild(intro);
            missions.forEach((m) => {
                const done = completed.indexOf(m.id) >= 0;
                const isActive = m.id === activeId;
                const row = document.createElement('div');
                row.className = 'vx-mission' + (done ? ' vx-mission-done' : '') + (isActive ? ' vx-mission-active' : '');
                let foot = '';
                if (done) foot = '<div class="vx-mission-status vx-status-done">✓ Complete</div>';
                else if (isActive) {
                    const cur = Math.max(0, prog.current | 0), tgt = Math.max(1, prog.target | 0);
                    const pct = Math.min(100, Math.round(cur / tgt * 100));
                    foot = '<div class="vx-quest-bar"><span style="width:' + pct + '%"></span><em>' + cur + ' / ' + tgt + '</em></div>';
                } else foot = '<div class="vx-mission-status vx-status-locked">🔒 Upcoming</div>';
                row.innerHTML = '<div class="vx-mission-icon">' + (done ? '✓' : isActive ? '🔬' : '🔒') + '</div>'
                    + '<div class="vx-mission-main"><div class="vx-mission-title">' + m.title + '</div>'
                    + '<div class="vx-mission-desc">' + m.desc + '</div>' + foot + '</div>';
                body.appendChild(row);
            });
        }

        // Worlds: the planet map — current, charted, and locked worlds with travel.
        function renderWorldsBody(body) {
            const AP = getProfileApi();
            if (!AP) { body.innerHTML = '<div class="vx-inv-empty">No profile loaded.</div>'; return; }
            const p = AP.load();
            const planets = AP.PLANETS || [];
            const unlocked = (p.system && p.system.unlocked) || [];
            const current = p.system && p.system.current;
            const swatch = { verdant: '#6cae54', frost: '#bfe0f5', fungal: '#a86ad0', desert: '#d8b878', volcanic: '#c0563a' };
            const intro = document.createElement('div');
            intro.className = 'vx-page-intro';
            intro.textContent = 'Travel between the worlds you have charted.';
            body.appendChild(intro);
            planets.forEach((pl) => {
                const isUnlocked = unlocked.indexOf(pl.id) >= 0;
                const isCurrent = pl.id === current;
                const need = (pl.grant && pl.grant.missionsDone) | 0;
                const c = swatch[pl.biome] || '#8a8a8a';
                let action;
                if (isCurrent) action = '<div class="vx-world-here">● You are here</div>';
                else if (isUnlocked) action = '<button type="button" class="vx-btn vx-btn-on" data-travel="' + pl.id + '">Travel</button>';
                else action = '<div class="vx-world-need">🔒 Finish ' + need + ' survey' + (need === 1 ? '' : 's') + '</div>';
                let stats = '';
                if (isUnlocked && pl.spec && AP.planetSpec) {
                    const sp = AP.planetSpec(pl);
                    const bits = [];
                    if (sp.basics.type) bits.push(sp.basics.type);
                    if (sp.basics.sizeKm) bits.push(sp.basics.sizeKm.toLocaleString() + ' km');
                    bits.push(sp.basics.gravity.toFixed(2) + ' g');
                    if (sp.basics.tempRange) bits.push(sp.basics.tempRange[0] + '° to ' + sp.basics.tempRange[1] + '°C');
                    bits.push('O₂ ' + sp.basics.atmosphere.oxygen + '%');
                    if (sp.visual.dayNight) bits.push(sp.basics.dayLengthMin + 'h day');
                    if (sp.basics.starSystem) bits.push('☀ ' + sp.basics.starSystem + ' system');
                    stats = '<div class="vx-world-stats">' + bits.join(' · ') + '</div>';
                }
                const card = document.createElement('div');
                card.className = 'vx-world' + (isCurrent ? ' vx-world-current' : '') + (isUnlocked ? '' : ' vx-world-locked');
                card.innerHTML = '<div class="vx-world-orb" style="background:radial-gradient(circle at 34% 30%, rgba(255,255,255,0.7), ' + c + ' 62%, rgba(0,0,0,0.55))"></div>'
                    + '<div class="vx-world-main"><div class="vx-world-name">' + pl.name + ' <span class="vx-world-da">· ' + pl.nameDa + '</span></div>'
                    + '<div class="vx-world-blurb">' + (isUnlocked ? pl.blurb : 'A world waiting to be charted.') + '</div>' + stats + '</div>'
                    + '<div class="vx-world-action">' + action + '</div>';
                body.appendChild(card);
            });
            body.querySelectorAll('[data-travel]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-travel');
                    toggleDrawer(false);
                    if (typeof travelToPlanet === 'function') travelToPlanet(id);
                });
            });
        }
        function refineryMatName(id) {
            const b = blockById(id);
            return b ? b.name : ('#' + (id | 0));
        }
        function craftRecipe(recipe) {
            const AP = getProfileApi();
            if (!AP || !recipe) return;
            const avail = AP.craftAvailability(recipe, backpack, AP.load());
            if (avail.owned) {
                if (g.showMessage) g.showMessage('You already own that gear', 2000);
                return;
            }
            if (!avail.ok) {
                if (g.showMessage) g.showMessage('Not enough materials for ' + recipe.name, 2000);
                return;
            }
            for (const inp of recipe.inputs) spendFromInventory(inp.id, inp.count);
            if (recipe.outputWeapon) {
                const p = AP.load();
                AP.grantWeapon(p, recipe.outputWeapon);
                loadOwnedWeapons();
                saveOwnedWeapons();
                flushProfileState();
                const wName = weaponNameById(recipe.outputWeapon);
                const beat = AP.touchStoryBeat ? AP.touchStoryBeat(AP.load(), 'firstCraft') : null;
                updateJournalHud();
                if (drawerOpen) renderDrawer();
                if (g.showMessage) g.showMessage('Unlocked ' + wName + '!', 2400);
                if (beat) vxLangMsg(beat.en, beat.da, 3600);
                return;
            }
            const outCount = recipe.outputCount || 1;
            addToInventory(recipe.output, outCount);   // also re-renders the open drawer
            const { completed, beat } = AP.recordCraft(AP.load(), recipe.output, outCount);
            updateJournalHud();
            const outName = refineryMatName(recipe.output);
            if (g.showMessage) g.showMessage('Crafted ' + outCount + '× ' + outName, 2200);
            if (beat) vxLangMsg(beat.en, beat.da, 3600);
            if (completed && g.showMessage) g.showMessage('Survey complete: ' + completed.title, 2800);
        }
        function weaponNameById(id) {
            const w = weaponList().find((w) => w.id === id);
            return w ? w.name : id;
        }
        function canAfford(cost) { return (cost || []).every((c) => getBackpackCount(c.id) >= c.count); }
        // Spend materials, persist, then bump a tier (order avoids clobbering the backpack).
        function spendCost(cost) { for (const c of cost) spendFromInventory(c.id, c.count); flushProfileState(); }
        function upgradeWeapon(id) {
            const AP = getProfileApi(); if (!AP) return;
            const cur = weaponTierOf(id); if (cur >= 5) return;
            const next = cur + 1, cost = UPGRADE_COST[next] || [];
            if (!canAfford(cost)) { if (g.showMessage) g.showMessage('Not enough materials to upgrade', 2000); return; }
            spendCost(cost);
            AP.setWeaponTier(AP.load(), id, next);
            refreshTierCache();
            updateWeaponLabel();
            if (g.showMessage) g.showMessage(weaponNameById(id) + ' → ' + TIER_NAME[next] + '!', 2400);
            if (drawerOpen) renderDrawer();
        }
        function upgradeDrone() {
            const AP = getProfileApi(); if (!AP) return;
            const cur = _droneTierCache; if (cur >= 3) return;
            const next = cur + 1, cost = DRONE_COST[next] || [];
            if (!canAfford(cost)) { if (g.showMessage) g.showMessage('Not enough materials to upgrade the Drone', 2000); return; }
            spendCost(cost);
            AP.setDroneTier(AP.load(), next);
            refreshTierCache();
            if (g.showMessage) g.showMessage('Drone → ' + TIER_NAME[next] + '!', 2400);
            if (drawerOpen) renderDrawer();
        }
        function upgradeScanner() {
            const AP = getProfileApi(); if (!AP) return;
            const cur = _scannerTierCache; if (cur >= 5) return;
            const next = cur + 1, cost = SCANNER_COST[next] || [];
            if (!canAfford(cost)) { if (g.showMessage) g.showMessage('Not enough materials to upgrade the scanner', 2000); return; }
            spendCost(cost);
            AP.setScannerTier(AP.load(), next);
            refreshTierCache();
            if (g.showMessage) g.showMessage('Scanner range → ' + (next * 10) + ' m!', 2400);
            if (drawerOpen) renderDrawer();
        }
        // One upgrade card. opts.max = top tier (default 3); opts.tierLabel formats the tier.
        // One upgrade card, styled like the crafting cards (thumbnail · name+tier · cost ·
        // button). opts.thumbIdx → 3D weapon thumbnail; opts.icon → emoji badge (Drone/Scanner).
        function appendUpgradeCard(container, label, curTier, cost, onUp, opts) {
            opts = opts || {};
            const maxT = opts.max || 3;
            const tierLabel = opts.tierLabel || ((t) => TIER_NAME[t]);
            const maxed = curTier >= maxT;
            const ok = !maxed && canAfford(cost);
            const card = document.createElement('div');
            card.className = 'vx-craft-card' + (ok ? ' craftable' : '');
            if (typeof opts.thumbIdx === 'number') {
                const wdef = weaponList()[opts.thumbIdx];
                card.appendChild(createThumbWrap(weaponTint(wdef), gear3DThumb(opts.thumbIdx), label));
            } else {
                const ic = document.createElement('div');
                ic.className = 'vx-upgrade-ic';
                ic.textContent = opts.icon || '⬆';
                card.appendChild(ic);
            }
            const title = document.createElement('div');
            title.className = 'vx-craft-name';
            title.textContent = label + ' · ' + tierLabel(curTier);
            card.appendChild(title);
            const sub = document.createElement('div');
            sub.className = 'vx-craft-cost';
            sub.innerHTML = maxed ? '<span style="color:#c0b3ff">Fully upgraded</span>'
                : cost.map((c) => { const have = getBackpackCount(c.id), col = have >= c.count ? '#9be89b' : '#ff9b9b';
                    return '<span style="color:' + col + '">' + refineryMatName(c.id) + ' ' + have + '/' + c.count + '</span>'; })
                    .join('<br>');
            card.appendChild(sub);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'vx-btn' + (ok ? ' vx-btn-on' : '');
            btn.textContent = maxed ? 'Max' : ('→ ' + tierLabel(curTier + 1));
            btn.disabled = !ok;
            if (!ok) btn.style.cssText = 'opacity:0.45;cursor:not-allowed;';
            if (ok) btn.addEventListener('click', onUp);
            card.appendChild(btn);
            container.appendChild(card);
        }
        function renderUpgradesSection(body) {
            const head = document.createElement('div');
            head.style.cssText = 'font-weight:700;color:#c0b3ff;letter-spacing:.06em;margin:14px 0 8px;';
            head.textContent = '⬆ UPGRADES';
            body.appendChild(head);
            const grid = document.createElement('div');
            grid.className = 'vx-craft-grid';
            // owned weapons/tools
            [...ownedWeapons].sort((a, b) => a - b).forEach((idx) => {
                const w = weaponList()[idx]; if (!w || w.id === 'pickaxe') return;
                const cur = weaponTierOf(w.id);
                appendUpgradeCard(grid, w.name, cur, UPGRADE_COST[cur + 1] || [], () => upgradeWeapon(w.id), { max: 5, thumbIdx: idx });
            });
            // the Drone companion
            appendUpgradeCard(grid, 'Drone companion', _droneTierCache, DRONE_COST[_droneTierCache + 1] || [], upgradeDrone, { icon: '🛰' });
            // scanner range (10 → 50 m, +10 m per tier)
            appendUpgradeCard(grid, 'Scanner range', _scannerTierCache, SCANNER_COST[_scannerTierCache + 1] || [], upgradeScanner,
                { max: 5, tierLabel: (t) => (t * 10) + ' m', icon: '📡' });
            body.appendChild(grid);
        }
        // ---- Settings tab (Tab/M → Settings) ----
        function _settingsRow(body, label, sub, controlEl) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 12px;margin-bottom:8px;border-radius:10px;background:rgba(36,100,118,0.22);border:1px solid rgba(90,200,230,0.3);';
            const info = document.createElement('div'); info.style.cssText = 'flex:1 1 auto;min-width:0;';
            const t = document.createElement('div'); t.style.cssText = 'font-weight:700;color:#dff6ff;'; t.textContent = label; info.appendChild(t);
            if (sub) { const s = document.createElement('div'); s.style.cssText = 'font-size:11px;opacity:0.7;margin-top:2px;'; s.textContent = sub; info.appendChild(s); }
            row.appendChild(info);
            controlEl.style.flex = '0 0 auto';
            row.appendChild(controlEl);
            body.appendChild(row);
        }
        function _segControl(options, current, onPick) {
            const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:4px;';
            options.forEach((o) => {
                const b = document.createElement('button'); b.type = 'button';
                b.className = 'vx-btn' + (o.val === current ? ' vx-btn-on' : '');
                b.textContent = o.label; b.style.cssText = 'padding:5px 9px;font-size:12px;' + (o.val === current ? '' : 'opacity:0.6;');
                b.addEventListener('click', () => onPick(o.val));
                wrap.appendChild(b);
            });
            return wrap;
        }
        function _toggleControl(on, onToggle) {
            return _segControl([{ label: 'Off', val: false }, { label: 'On', val: true }], !!on, onToggle);
        }
        function _sliderControl(min, max, step, val, onInput) {
            const inp = document.createElement('input'); inp.type = 'range';
            inp.min = min; inp.max = max; inp.step = step; inp.value = val;
            inp.style.cssText = 'width:130px;accent-color:#5ac8e6;';
            inp.addEventListener('input', () => onInput(parseFloat(inp.value)));
            return inp;
        }
        function renderSettingsBody(body) {
            const intro = document.createElement('div');
            intro.className = 'vx-inv-empty';
            intro.style.cssText = 'text-align:left;opacity:0.8;margin-bottom:8px;';
            intro.textContent = 'Settings save on this device.';
            body.appendChild(intro);

            _settingsRow(body, 'Mouse sensitivity', 'How fast looking + flying turns',
                _sliderControl(0.25, 2.5, 0.05, vxSettings.sens, (v) => { vxSettings.sens = v; saveSettings(); }));
            _settingsRow(body, 'Default camera', 'Which view you start in',
                _segControl([{ label: 'First', val: 'first' }, { label: 'Third', val: 'third' }], vxSettings.view,
                    (v) => { vxSettings.view = v; saveSettings(); setFirstPerson(v === 'first'); renderDrawer(); }));
            // Sound: volume slider + a Mute toggle
            const soundWrap = document.createElement('div'); soundWrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
            soundWrap.appendChild(_sliderControl(0, 1, 0.05, vxSettings.sound, (v) => { vxSettings.sound = v; if (!vxSettings.muted) applySound(); saveSettings(); }));
            const muteBtn = document.createElement('button'); muteBtn.type = 'button';
            muteBtn.className = 'vx-btn' + (vxSettings.muted ? ' vx-btn-on' : '');
            muteBtn.textContent = vxSettings.muted ? '🔇 Muted' : '🔊 Mute';
            muteBtn.style.cssText = 'padding:5px 9px;font-size:12px;';
            muteBtn.addEventListener('click', () => { vxSettings.muted = !vxSettings.muted; applySound(); saveSettings(); renderDrawer(); });
            soundWrap.appendChild(muteBtn);
            _settingsRow(body, 'Sound', 'Music + effects volume', soundWrap);
            _settingsRow(body, 'Peaceful mode', 'No monsters or attacks — wildlife stays',
                _toggleControl(vxSettings.peaceful, (v) => { vxSettings.peaceful = v; saveSettings(); if (v) despawnHostiles(); renderDrawer(); }));
            _settingsRow(body, 'Always day', 'Parent toggle — keeps bright daylight (no night threats)',
                _toggleControl(!!vxSettings.alwaysDay, (v) => {
                    vxSettings.alwaysDay = !!v; saveSettings();
                    if (v) { _nightSpawnLeft = 0; if (typeof despawnHostiles === 'function') despawnHostiles(); }
                    updateDayNight(0); renderDrawer();
                }));
            _settingsRow(body, 'Training field', 'Range markers + dummies to test gear',
                _toggleControl(!!trainingField, (v) => { if (v) buildTrainingField(); else clearTrainingField(); renderDrawer(); }));
            _settingsRow(body, 'View distance', 'Lower = smoother · Max is very heavy',
                _segControl([{ label: 'Low', val: 'low' }, { label: 'Med', val: 'med' }, { label: 'High', val: 'high' }, { label: 'Ultra', val: 'ultra' }, { label: 'Max', val: 'max' }], vxSettings.dist,
                    (v) => { vxSettings.dist = v; saveSettings(); applyViewDistance(true); renderDrawer(); }));

            const resetBtn = document.createElement('button');
            resetBtn.type = 'button'; resetBtn.className = 'vx-btn'; resetBtn.textContent = 'Reset to defaults';
            resetBtn.style.cssText = 'margin-top:6px;';
            resetBtn.addEventListener('click', () => {
                Object.assign(vxSettings, { sens: 1.0, view: 'first', sound: 0.6, muted: false, peaceful: false, alwaysDay: false, dist: 'med' });
                saveSettings(); applySettings(); setFirstPerson(true); applyViewDistance(true); renderDrawer();
                if (g.showMessage) g.showMessage('Settings reset', 1400);
            });
            body.appendChild(resetBtn);
        }

        function renderRefineryBody(body) {
            const AP = getProfileApi();
            const recipes = AP && Array.isArray(AP.CRAFT_RECIPES) ? AP.CRAFT_RECIPES : [];
            if (!recipes.length) {
                const empty = document.createElement('div');
                empty.className = 'vx-inv-empty';
                empty.textContent = 'No recipes available.';
                body.appendChild(empty);
                return;
            }
            const intro = document.createElement('div');
            intro.className = 'vx-inv-empty';
            intro.style.cssText = 'text-align:left;opacity:0.8;margin-bottom:8px;';
            intro.textContent = 'Smelt and assemble materials into base upgrades.';
            body.appendChild(intro);
            const grid = document.createElement('div');
            grid.className = 'vx-craft-grid';
            recipes.forEach((r) => {
                const avail = AP.craftAvailability(r, backpack, AP.load());
                const outB = r.outputWeapon ? null : blockById(r.output);
                const wIdx = r.outputWeapon ? weaponList().findIndex((w) => w.id === r.outputWeapon) : -1;
                const card = document.createElement('div');
                card.className = 'vx-craft-card' + (avail.ok ? ' craftable' : '');
                if (outB) card.appendChild(createThumbWrap(blockTint(outB.cat), block3DThumb(outB), outB.name));
                else if (wIdx >= 0) {
                    const wdef = weaponList()[wIdx];
                    card.appendChild(createThumbWrap(weaponTint(wdef), gear3DThumb(wIdx), wdef.name));
                }
                const title = document.createElement('div');
                title.className = 'vx-craft-name';
                title.textContent = r.name + ((r.outputCount || 1) > 1 ? ' ×' + r.outputCount : '');
                card.appendChild(title);
                const cost = document.createElement('div');
                cost.className = 'vx-craft-cost';
                if (avail.owned) {
                    cost.innerHTML = '<span style="color:#9be89b">Already owned</span>';
                } else {
                    cost.innerHTML = r.inputs.map((inp) => {
                        const have = getBackpackCount(inp.id);
                        const col = have >= inp.count ? '#9be89b' : '#ff9b9b';
                        return '<span style="color:' + col + '">' + refineryMatName(inp.id) + ' ' + have + '/' + inp.count + '</span>';
                    }).join('<br>');
                }
                card.appendChild(cost);
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'vx-btn' + (avail.ok ? ' vx-btn-on' : '');
                btn.textContent = avail.owned ? 'Owned' : (r.outputWeapon ? 'Unlock' : 'Craft');
                btn.disabled = !avail.ok;
                if (!avail.ok) btn.style.cssText = 'opacity:0.45;cursor:not-allowed;';
                if (avail.ok) btn.addEventListener('click', () => craftRecipe(r));
                card.appendChild(btn);
                grid.appendChild(card);
            });
            body.appendChild(grid);
            renderUpgradesSection(body);
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
            return b ? block3DThumb(b) : '';   // lit 3D cube (falls back to a flat tile with no WebGL)
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
                saveHotbarLayout();
            }
        }
        function addToInventory(id, n = 1) {
            backpack[id] = (backpack[id] || 0) + n;
            autoFillHotbar(id, n);
            scheduleProfileFlush();
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
            scheduleProfileFlush();
            return true;
        }
        function selectSlot(i) {
            if (i < 0 || i >= HOTBAR_SLOTS) return;
            selected = i;
            renderHotbar();
            if (drawerOpen) renderDrawer();
        }

        function deselectQuickbar() {
            selected = -1;
            renderHotbar();
            if (drawerOpen) renderDrawer();
        }

        function clearHotbarSlot(i) {
            hotbar[i] = null;
            saveHotbarLayout();
            renderHotbar();
            if (drawerOpen) renderDrawer();
        }
        function assignHotbarSlot(i, id, amount) {
            const have = getBackpackCount(id);
            if (have <= 0) return;
            let slot = i;
            if (slot < 0 || slot >= HOTBAR_SLOTS) {
                if (selected >= 0) slot = selected;
                else {
                    const empty = hotbar.findIndex((s) => !s);
                    slot = empty >= 0 ? empty : 0;
                }
            }
            const cnt = amount == null ? have : Math.min(amount, have);
            hotbar[slot] = { id, count: cnt };
            saveHotbarLayout();
            selectSlot(slot);
        }
        function makeSlotEl(i, opts) {
            const { strip = false, onClick, onContext } = opts || {};
            const d = document.createElement('div');
            const cls = ['slot'];
            if (selected >= 0 && i === selected) cls.push('active');
            if (strip && drawerOpen && selected >= 0 && i === selected) cls.push('target');
            d.className = cls.join(' ');
            d.dataset.slot = String(i);
            const k = document.createElement('div');
            k.className = 'key';
            k.textContent = i + 1;
            d.appendChild(k);
            const s = hotbar[i];
            const tint = s ? blockTint(blockById(s.id)?.cat) : INV_TINT.empty;
            d.style.cssText = invTintStyle(tint);
            const inner = document.createElement('div');
            inner.className = 'vx-slot-inner';
            if (s) {
                const b = blockById(s.id);
                if (b) {
                    inner.appendChild(createThumbWrap(tint, block3DThumb(b), b.name));
                    d.title = b.name;
                    d.draggable = true;
                }
                d.appendChild(inner);
                const cn = document.createElement('div');
                cn.className = 'cnt';
                cn.textContent = s.count;
                d.appendChild(cn);
                d.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/voxel-slot', String(i));
                    e.dataTransfer.setData('text/voxel-block', String(s.id));
                    e.dataTransfer.effectAllowed = 'copyMove';
                    d.classList.add('dragging');
                });
                d.addEventListener('dragend', () => d.classList.remove('dragging'));
            } else {
                d.appendChild(inner);
            }
            d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('drop-hover'); });
            d.addEventListener('dragleave', () => d.classList.remove('drop-hover'));
            d.addEventListener('drop', (e) => {
                e.preventDefault();
                d.classList.remove('drop-hover');
                const fromSlot = e.dataTransfer.getData('text/voxel-slot');
                if (fromSlot !== '') {
                    swapHotbarSlots(+fromSlot, i);
                    return;
                }
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
        // ===================== World Map (press O) =====================
        // A top-down atlas of the whole (periodic) world, biome-coloured by surface
        // block, with every player-placed block marked so the kid can always find
        // their base. The terrain raster is cached per-planet; the build/markers
        // overlay is redrawn each time the map opens (cheap).
        const MAP_TERRAIN_RES = 96;    // chunky tile grid across one world period (stylized, not realistic)
        const MAP_VIEW_PX = 640;       // visible canvas pixel size
        // Representative flat colour for each block id on the map.
        const MAP_COLOR = {
            1:0x5ba843, 2:0x7d5a3a, 3:0x808a96, 4:0xd9c27e, 5:0x8a6038, 6:0x3f8a3c,
            7:0x9aa6b2, 8:0xa8d8ee, 9:0x3fa6b0, 10:0x8a4ec0, 11:0xd84a18, 12:0x37a08a,
            13:0xb04632, 14:0x7a4ec0, 15:0xd9a93c, 16:0x8a8a92, 17:0x3a3d44, 18:0xa85438,
            19:0x6a6660, 20:0xeef2f8, 21:0x201c2a, 22:0x6f9a6a, 23:0xa86a4a, 24:0xd9b441,
            25:0x6a7078, 26:0x2a3a6a, 27:0x2e2e34, 28:0x4a9a2a, 29:0x2a9a52, 30:0x18142a,
            31:0x8a929a, 32:0xbfe0e8, 33:0x2a6a52, 34:0xf0d97a, 35:0x4a525a, 36:0x7a5a78,
            37:0xc89a3a, 38:0xe85a1a, 39:0x7ad94a, 40:0x2f6fc0, 41:0x8a4ec0, 42:0xff6a1e,
            43:0x8a8278, 44:0xc24a1e
        };
        const _mapRgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
        const _cssHex = (hex) => '#' + ('000000' + (hex >>> 0).toString(16)).slice(-6);

        let mapEl = null, mapCanvas = null, mapOpen = false;
        let _mapTerrainCanvas = null, _mapTerrainKey = '';
        let _mapClusters = [], _mapRaf = 0;

        // Pan/zoom view over the periodic world. `cx,cz` is the world point at the canvas
        // centre; `scale` is pixels-per-block; `follow` keeps the view locked on the player.
        const _mapView = { cx: 0, cz: 0, scale: MAP_VIEW_PX / WORLD_PERIOD, follow: true };
        const _mapScaleMin = () => MAP_VIEW_PX / WORLD_PERIOD;        // whole world fits
        const _mapScaleMax = () => (MAP_VIEW_PX / WORLD_PERIOD) * 10; // zoom right in
        const _mapClampScale = (s) => Math.max(_mapScaleMin(), Math.min(_mapScaleMax(), s));
        const _mapS2W = (px, py) => ({
            wx: _mapView.cx + (px - MAP_VIEW_PX / 2) / _mapView.scale,
            wz: _mapView.cz + (py - MAP_VIEW_PX / 2) / _mapView.scale
        });
        function _mapRecenter() {
            _mapView.cx = pmod(player.pos.x);
            _mapView.cz = pmod(player.pos.z);
            _mapView.scale = _mapScaleMin();
            _mapView.follow = true;
        }

        // ---- player waypoint: a mark dropped on the map + an on-screen guide beacon ----
        const WAYPOINT_KEY = 'pjboy.voxelWaypoint.v1';
        let waypoint = null;                         // { x, z } canonical world coords, current planet
        let waypointEl = null;
        const _wpVec = new THREE.Vector3(), _wpDir = new THREE.Vector3(), _wpTo = new THREE.Vector3();
        const _wpPlanetKey = () => activePlanetId || 'default';
        function _wpStore() {
            try { return JSON.parse(localStorage.getItem(WAYPOINT_KEY) || '{}') || {}; }
            catch (_) { return {}; }
        }
        function loadWaypoint() {
            const w = _wpStore()[_wpPlanetKey()];
            waypoint = (w && isFinite(w.x) && isFinite(w.z)) ? { x: w.x, z: w.z } : null;
        }
        function saveWaypoint() {
            const all = _wpStore();
            if (waypoint) all[_wpPlanetKey()] = { x: Math.round(waypoint.x), z: Math.round(waypoint.z) };
            else delete all[_wpPlanetKey()];
            try { localStorage.setItem(WAYPOINT_KEY, JSON.stringify(all)); } catch (_) {}
        }
        function setWaypoint(wx, wz) { waypoint = { x: pmod(wx), z: pmod(wz) }; saveWaypoint(); }
        function clearWaypoint() { waypoint = null; saveWaypoint(); }

        // Auto-pin the Star Gate for missions that need travel wayfinding.
        function syncMissionWaypoint() {
            const AP = getProfileApi();
            if (!AP || !AP.activeMission) return;
            const m = AP.activeMission(AP.load());
            if (!m || m.pin !== 'gate' || !starGate) return;
            const gx = pmod(starGate.pos.x), gz = pmod(starGate.pos.z);
            if (waypoint) {
                const dx = _wrapDelta(waypoint.x, gx), dz = _wrapDelta(waypoint.z, gz);
                if (Math.hypot(dx, dz) < 6) return;
            }
            setWaypoint(gx, gz);
        }

        // Wrapped (toroidal) delta from a→b on one axis, into [-PERIOD/2, PERIOD/2).
        function _wrapDelta(a, b) {
            let d = (((b - a) % WORLD_PERIOD) + WORLD_PERIOD) % WORLD_PERIOD;
            return d > WORLD_PERIOD / 2 ? d - WORLD_PERIOD : d;
        }
        // Place a waypoint at a world point, or clear it if you tapped the existing one.
        function _toggleWaypointAt(wx, wz) {
            const cw = pmod(wx), cz = pmod(wz);
            if (waypoint) {
                const dx = _wrapDelta(waypoint.x, cw), dz = _wrapDelta(waypoint.z, cz);
                if (Math.hypot(dx, dz) < 18 / _mapView.scale) {
                    clearWaypoint();
                    if (g.showMessage) g.showMessage('Waypoint cleared', 1400);
                    return;
                }
            }
            setWaypoint(cw, cz);
            if (g.showMessage) g.showMessage('⚑ Waypoint set — follow the marker', 2000);
        }

        // Cyan target reticle for the waypoint on the map.
        function _mapWaypointPin(ctx, x, y, pulse) {
            ctx.save();
            ctx.strokeStyle = 'rgba(111,227,255,' + (0.6 + pulse * 0.4).toFixed(3) + ')';
            ctx.lineWidth = 2;
            ctx.shadowColor = 'rgba(111,227,255,0.9)'; ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.arc(x, y, 9 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x - 13, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 13, y);
            ctx.moveTo(x, y - 13); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 13);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fillStyle = '#dffaff'; ctx.fill();
            ctx.restore();
        }

        function ensureWaypointHud() {
            if (waypointEl) return waypointEl;
            const overlay = document.getElementById('voxel-overlay');
            if (!overlay) return null;
            const el = document.createElement('div');
            el.id = 'voxel-waypoint'; el.className = 'vx-waypoint'; el.hidden = true;
            el.innerHTML = '<span class="vx-wp-arrow">◈</span><span class="vx-wp-dist">0 m</span>';
            overlay.appendChild(el);
            waypointEl = el;
            return el;
        }

        // Each frame (map closed): project the waypoint to screen, clamp to the edge with
        // a pointing arrow when off-screen, and show the live distance. Auto-clears on arrival.
        function updateWaypointHud() {
            const el = ensureWaypointHud();
            if (!el) return;
            if (!waypoint || voxelPanelOpen() || !camera) { if (!el.hidden) el.hidden = true; return; }
            const dx = _wrapDelta(player.pos.x, waypoint.x), dz = _wrapDelta(player.pos.z, waypoint.z);
            const dist = Math.hypot(dx, dz);
            if (dist < 2.6 && !flying) {
                clearWaypoint();
                el.hidden = true;
                if (g.showMessage) g.showMessage('⚑ Waypoint reached!', 1800);
                try { playSfx('voxelPlace'); } catch (_) {}
                return;
            }
            const nearX = player.pos.x + dx, nearZ = player.pos.z + dz;
            // sit the beacon on the terrain at the mark (respects builds), not at eye level
            const fvx = Math.floor(nearX), fvz = Math.floor(nearZ);
            let topVy = surfaceTopVox(fvx, fvz);
            if (topVy == null) topVy = Math.max(SEA_LEVEL, columnHeight(fvx, fvz));   // water surface / fallback
            const beaconY = topVy + 1 + WORLD_OFFSET.y + 1.2;   // hover just above the ground
            _wpVec.set(nearX, beaconY, nearZ).project(camera);
            camera.getWorldDirection(_wpDir);
            _wpTo.set(nearX - camera.position.x, beaconY - camera.position.y, nearZ - camera.position.z);
            const ahead = _wpTo.dot(_wpDir) > 0;
            let nx = _wpVec.x, ny = _wpVec.y;
            if (!ahead) { nx = -nx; ny = -ny; }
            const W = window.innerWidth, H = window.innerHeight, pad = 56;
            const onScreen = ahead && nx >= -0.98 && nx <= 0.98 && ny >= -0.98 && ny <= 0.98;
            let sx, sy, edge, rot = 0;
            if (onScreen) {
                sx = (nx * 0.5 + 0.5) * W; sy = (-ny * 0.5 + 0.5) * H; edge = false;
            } else {
                const m = Math.max(Math.abs(nx), Math.abs(ny)) || 1;
                sx = (nx / m * 0.5 + 0.5) * W; sy = (-ny / m * 0.5 + 0.5) * H;
                sx = Math.max(pad, Math.min(W - pad, sx));
                sy = Math.max(pad, Math.min(H - pad, sy));
                rot = Math.atan2(sy - H / 2, sx - W / 2);   // point the arrow from screen centre toward target
                edge = true;
            }
            el.hidden = false;
            el.classList.toggle('vx-wp-edge', edge);
            el.style.left = sx + 'px';
            el.style.top = sy + 'px';
            const arrow = el.querySelector('.vx-wp-arrow');
            const distEl = el.querySelector('.vx-wp-dist');
            if (arrow) {
                arrow.textContent = edge ? '➤' : '◈';
                arrow.style.transform = edge ? 'rotate(' + rot + 'rad)' : 'none';
            }
            if (distEl) distEl.textContent = Math.round(dist) + ' m';
        }

        // Rasterise the world into a low-res, flat-coloured tile grid — a stylized,
        // poster-like map (no realistic hillshade). Each tile is one biome colour with a
        // couple of discrete elevation steps; the display scales it crisp (nearest-neighbour)
        // so it reads as chunky voxel tiles. Cached per planet.
        function buildMapTerrain() {
            const key = SEED + '|' + activeBiomeKey + '|' + MAP_TERRAIN_RES;
            if (_mapTerrainCanvas && _mapTerrainKey === key) return _mapTerrainCanvas;
            const R = MAP_TERRAIN_RES, stepW = WORLD_PERIOD / R;
            const oc = document.createElement('canvas');
            oc.width = R; oc.height = R;
            const octx = oc.getContext('2d');
            const img = octx.createImageData(R, R);
            const data = img.data;
            const isVolc = activeBiomeKey === 'volcanic';
            const seaShallow = _mapRgb(isVolc ? 0xe8631e : 0x3a93b0);
            const seaDeep = _mapRgb(isVolc ? 0xb33a12 : 0x245d7e);
            const clamp255 = (v) => v < 0 ? 0 : v > 255 ? 255 : v;
            for (let j = 0; j < R; j++) {
                for (let i = 0; i < R; i++) {
                    const p = columnProfile((i + 0.5) * stepW, (j + 0.5) * stepW);
                    const h = p.height;
                    let r, g, b;
                    if (h < SEA_LEVEL) {
                        const c = (SEA_LEVEL - h) > 6 ? seaDeep : seaShallow;   // 2-tone coast/deep
                        r = c[0]; g = c[1]; b = c[2];
                    } else {
                        const c = _mapRgb(MAP_COLOR[p.top] || 0x808a96);
                        // discrete elevation steps → a stylized topographic look, not realistic relief
                        const band = Math.max(0, Math.min(3, Math.floor((h - SEA_LEVEL) / 9)));
                        const f = 0.90 + band * 0.05;            // 0.90 · 0.95 · 1.00 · 1.05
                        r = c[0] * f; g = c[1] * f; b = c[2] * f;
                    }
                    const o = (j * R + i) * 4;
                    data[o] = clamp255(r); data[o + 1] = clamp255(g); data[o + 2] = clamp255(b); data[o + 3] = 255;
                }
            }
            octx.putImageData(img, 0, 0);
            _mapTerrainCanvas = oc; _mapTerrainKey = key;
            return oc;
        }

        // Group placed blocks (canonical, topmost per column) into build sites so a base
        // reads as ONE clear marker the kid can find — not a scatter of sub-pixel dots.
        function collectMapBuilds() {
            const cols = new Map();
            editStore.forEach((id, k) => {
                if (!id) return;                                  // 0 = mined air, not a build
                const a = k.split(',');
                const ex = +a[0], y = +a[1], ez = +a[2], ck = ex + ',' + ez;
                const cur = cols.get(ck);
                if (!cur || y > cur.y) cols.set(ck, { x: ex, z: ez, id });
            });
            const GB = 176;   // ~176-block grid buckets → one pin per build site
            const buckets = new Map();
            cols.forEach((c) => {
                const bk = Math.floor(c.x / GB) + ',' + Math.floor(c.z / GB);
                let bu = buckets.get(bk);
                if (!bu) { bu = { sx: 0, sz: 0, n: 0, ids: {} }; buckets.set(bk, bu); }
                bu.sx += c.x; bu.sz += c.z; bu.n++;
                bu.ids[c.id] = (bu.ids[c.id] || 0) + 1;
            });
            const clusters = [];
            buckets.forEach((bu) => {
                let best = 0, bid = 0;
                for (const k in bu.ids) if (bu.ids[k] > best) { best = bu.ids[k]; bid = +k; }
                clusters.push({ x: bu.sx / bu.n, z: bu.sz / bu.n, n: bu.n, id: bid });
            });
            return clusters;
        }

        function _mapPin(ctx, x, y, color, glyph) {
            ctx.font = 'bold 18px system-ui, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.strokeText(glyph, x, y);
            ctx.fillStyle = color; ctx.fillText(glyph, x, y);
        }

        // A warm amber survey beacon marking a build site — gently pulsing, dark-edged,
        // with a hot white core so it reads even on sandy ground (count badge if >1 block).
        function _mapBuildPin(ctx, x, y, n, pulse) {
            const baseR = Math.min(18, 7 + Math.sqrt(n) * 1.5);
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, baseR + 3 + pulse * 4, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,212,114,' + (0.45 + pulse * 0.4).toFixed(3) + ')';
            ctx.lineWidth = 2; ctx.stroke();
            ctx.shadowColor = 'rgba(245,183,62,0.95)'; ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.moveTo(x, y - baseR); ctx.lineTo(x + baseR, y); ctx.lineTo(x, y + baseR); ctx.lineTo(x - baseR, y); ctx.closePath();
            ctx.fillStyle = '#ffd45c'; ctx.fill();
            ctx.shadowBlur = 0;
            ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(42,26,8,0.95)'; ctx.stroke();
            if (n > 1) {
                ctx.fillStyle = '#2a1a08';
                ctx.font = 'bold 11px "Courier New", monospace';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(n > 999 ? '999+' : String(n), x, y + 0.5);
            } else {
                ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2);
                ctx.fillStyle = '#fff4d6'; ctx.fill();   // hot core pip
            }
            ctx.restore();
        }

        // The live "you are here" arrow — heading-aware, with a warm amber halo.
        function _mapPlayerArrow(ctx, x, y, yaw, pulse) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, 9 + pulse * 3, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,212,114,' + (0.35 + pulse * 0.45).toFixed(3) + ')';
            ctx.lineWidth = 2; ctx.stroke();
            ctx.translate(x, y);
            ctx.rotate(Math.atan2(Math.sin(yaw), -Math.cos(yaw)));
            ctx.shadowColor = 'rgba(245,183,62,0.7)'; ctx.shadowBlur = 6;
            ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath();
            ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(42,26,8,0.95)'; ctx.stroke();
            ctx.fillStyle = '#fff4d6'; ctx.fill();
            ctx.restore();
        }

        // Composite the cached terrain + grid + build sites + home/gate + live player.
        // `phase` (seconds) drives the gentle marker pulse.
        function drawMap(phase) {
            if (!mapCanvas) return 0;
            const ctx = mapCanvas.getContext('2d');
            const S = MAP_VIEW_PX, scale = _mapView.scale;
            ctx.clearRect(0, 0, S, S);
            ctx.imageSmoothingEnabled = false;          // crisp chunky tiles, not a smooth photo

            // ---- terrain: the period tiles seamlessly, so draw wrapped copies centred on the view ----
            const terr = buildMapTerrain();
            const periodPx = WORLD_PERIOD * scale;
            let baseX = S / 2 - _mapView.cx * scale;
            let baseY = S / 2 - _mapView.cz * scale;
            baseX = ((baseX % periodPx) + periodPx) % periodPx; if (baseX > 0) baseX -= periodPx;
            baseY = ((baseY % periodPx) + periodPx) % periodPx; if (baseY > 0) baseY -= periodPx;
            for (let tx = baseX; tx < S; tx += periodPx)
                for (let ty = baseY; ty < S; ty += periodPx)
                    ctx.drawImage(terr, tx, ty, periodPx, periodPx);

            // light warm wash so the flat tiles still sit inside the brass console
            ctx.save();
            ctx.globalCompositeOperation = 'soft-light';
            ctx.fillStyle = 'rgba(245,183,62,0.16)';
            ctx.fillRect(0, 0, S, S);
            ctx.restore();
            // soft warm vignette — darker toward the rim, like glass under the bezel
            const vig = ctx.createRadialGradient(S / 2, S / 2, S * 0.34, S / 2, S / 2, S * 0.74);
            vig.addColorStop(0, 'rgba(20,13,4,0)');
            vig.addColorStop(1, 'rgba(18,11,3,0.42)');
            ctx.fillStyle = vig; ctx.fillRect(0, 0, S, S);

            // world-locked reference grid (every 384 blocks) in warm amber — pans with the map
            ctx.strokeStyle = 'rgba(255,212,114,0.07)'; ctx.lineWidth = 1;
            const gpx = 384 * scale;
            for (let x = ((S / 2 - _mapView.cx * scale) % gpx + gpx) % gpx; x < S; x += gpx) {
                const p = Math.round(x) + 0.5; ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
            }
            for (let y = ((S / 2 - _mapView.cz * scale) % gpx + gpx) % gpx; y < S; y += gpx) {
                const p = Math.round(y) + 0.5; ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
            }

            // ---- markers: project world→screen, wrapping to the copy nearest the view centre ----
            const HALF = WORLD_PERIOD / 2;
            const w2s = (wx, wz) => {
                let dx = (((wx - _mapView.cx) % WORLD_PERIOD) + WORLD_PERIOD) % WORLD_PERIOD; if (dx > HALF) dx -= WORLD_PERIOD;
                let dz = (((wz - _mapView.cz) % WORLD_PERIOD) + WORLD_PERIOD) % WORLD_PERIOD; if (dz > HALF) dz -= WORLD_PERIOD;
                return [S / 2 + dx * scale, S / 2 + dz * scale];
            };
            const vis = (sx, sy, m) => sx >= -m && sx <= S + m && sy >= -m && sy <= S + m;
            const pulse = 0.5 + 0.5 * Math.sin(phase * 3);

            _mapClusters.forEach((c) => { const s = w2s(c.x, c.z); if (vis(s[0], s[1], 30)) _mapBuildPin(ctx, s[0], s[1], c.n, pulse); });
            if (_spawnPos.lengthSq() > 0) { const s = w2s(_spawnPos.x, _spawnPos.z); if (vis(s[0], s[1], 20)) _mapPin(ctx, s[0], s[1], '#a6cf63', '⌂'); }
            if (starGate) { const s = w2s(starGate.pos.x, starGate.pos.z); if (vis(s[0], s[1], 20)) _mapPin(ctx, s[0], s[1], '#C9A0FF', '◎'); }
            if (waypoint) { const s = w2s(waypoint.x, waypoint.z); if (vis(s[0], s[1], 20)) _mapWaypointPin(ctx, s[0], s[1], pulse); }
            const ps = w2s(player.pos.x, player.pos.z);
            _mapPlayerArrow(ctx, ps[0], ps[1], player.yaw, pulse);
            return _mapClusters.length;
        }

        // Redraw loop while the map is open — keeps the player arrow live and the
        // build/player markers gently pulsing. Terrain + clusters are cached, so each
        // frame is just a blit plus a handful of marker draws.
        function _mapTick() {
            if (!mapOpen) { _mapRaf = 0; return; }
            if (_mapView.follow) { _mapView.cx = pmod(player.pos.x); _mapView.cz = pmod(player.pos.z); }
            try { drawMap(elapsed); } catch (e) { if (window.console) console.warn('[map] draw failed', e); }
            _mapRaf = requestAnimationFrame(_mapTick);
        }

        function buildMapUI() {
            if (mapEl) return mapEl;
            const overlay = document.getElementById('voxel-overlay');
            if (!overlay) return null;
            const el = document.createElement('div');
            el.id = 'voxel-map'; el.className = 'vx-map'; el.hidden = true;
            el.innerHTML = `
                <div class="vx-map-panel">
                    <div class="vx-map-head">
                        <h3 class="vx-map-title"><span class="vx-map-glyph">◳</span> Survey Map<span id="voxel-map-sub" class="vx-map-sub"></span></h3>
                        <div class="vx-map-tools">
                            <button type="button" class="vx-map-close" data-vx-map-recenter title="Center on you">⊙</button>
                            <button type="button" class="vx-map-close" data-vx-map-close aria-label="Close map">✕</button>
                        </div>
                    </div>
                    <div class="vx-map-stage">
                        <canvas id="voxel-map-canvas" width="${MAP_VIEW_PX}" height="${MAP_VIEW_PX}"></canvas>
                        <div class="vx-map-scan" aria-hidden="true"></div>
                        <i class="vx-map-corner vx-map-corner-tl"></i>
                        <i class="vx-map-corner vx-map-corner-tr"></i>
                        <i class="vx-map-corner vx-map-corner-bl"></i>
                        <i class="vx-map-corner vx-map-corner-br"></i>
                        <span class="vx-map-compass vx-map-n">N</span>
                        <span class="vx-map-compass vx-map-s">S</span>
                        <span class="vx-map-compass vx-map-e">E</span>
                        <span class="vx-map-compass vx-map-w">W</span>
                    </div>
                    <div class="vx-map-legend">
                        <span><i class="vx-map-key vx-map-you"></i>You</span>
                        <span><i class="vx-map-key vx-map-build"></i>Your builds</span>
                        <span><b style="color:#a6cf63">⌂</b> Home</span>
                        <span><b style="color:#C9A0FF">◎</b> Star Gate</span>
                        <span><i class="vx-map-key vx-map-wp"></i>Waypoint</span>
                        <span id="voxel-map-count" class="vx-map-count"></span>
                    </div>
                    <p class="vx-map-foot">Click to set waypoint · drag to pan · scroll to zoom · <kbd>⊙</kbd> recenter · <kbd>O</kbd>/<kbd>Esc</kbd> close</p>
                </div>`;
            overlay.appendChild(el);
            mapCanvas = el.querySelector('#voxel-map-canvas');
            on(el, 'click', (e) => { if (e.target === el) toggleMap(false); });
            on(el.querySelector('[data-vx-map-close]'), 'click', () => toggleMap(false));
            on(el.querySelector('[data-vx-map-recenter]'), 'click', () => _mapRecenter());
            on(el, 'wheel', (e) => e.stopPropagation(), { passive: true });

            // ---- click = drop waypoint · drag = pan · scroll = zoom · right-click = clear ----
            mapCanvas.style.cursor = 'crosshair';
            let dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, moved = false;
            const evPos = (e) => {
                const r = mapCanvas.getBoundingClientRect(), k = MAP_VIEW_PX / r.width;
                return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
            };
            on(mapCanvas, 'mousedown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                dragging = true; moved = false;
                const p = evPos(e); lastX = downX = p[0]; lastY = downY = p[1];
                mapCanvas.style.cursor = 'grabbing';
            });
            on(window, 'mousemove', (e) => {
                if (!dragging) return;
                const p = evPos(e);
                if (Math.hypot(p[0] - downX, p[1] - downY) > 8) moved = true;   // a real pan, not a drifty click
                if (moved) {
                    _mapView.cx -= (p[0] - lastX) / _mapView.scale;
                    _mapView.cz -= (p[1] - lastY) / _mapView.scale;
                    _mapView.follow = false;
                }
                lastX = p[0]; lastY = p[1];
            });
            on(window, 'mouseup', () => {
                if (!dragging) return;
                dragging = false; mapCanvas.style.cursor = 'crosshair';
            });
            // Placement uses the native click event (its own click-vs-drag detection);
            // `moved` suppresses the click the browser fires at the end of a pan.
            on(mapCanvas, 'click', (e) => {
                if (moved) { moved = false; return; }
                const p = evPos(e), w = _mapS2W(p[0], p[1]);
                _toggleWaypointAt(w.wx, w.wz);
            });
            on(mapCanvas, 'contextmenu', (e) => {
                e.preventDefault();
                if (waypoint) { clearWaypoint(); if (g.showMessage) g.showMessage('Waypoint cleared', 1400); }
            });
            on(mapCanvas, 'wheel', (e) => {
                e.preventDefault(); e.stopPropagation();
                const p = evPos(e);
                const ns = _mapClampScale(_mapView.scale * Math.exp(-e.deltaY * 0.0015));
                if (_mapView.follow) {
                    _mapView.scale = ns;                         // keep centred on the player
                } else {
                    const b = _mapS2W(p[0], p[1]);
                    _mapView.scale = ns;
                    const a = _mapS2W(p[0], p[1]);               // keep the point under the cursor fixed
                    _mapView.cx += b.wx - a.wx; _mapView.cz += b.wz - a.wz;
                }
            }, { passive: false });

            mapEl = el;
            return el;
        }

        function toggleMap(force) {
            const next = force !== undefined ? !!force : !mapOpen;
            if (next === mapOpen) return;
            if (next) {
                if (!buildMapUI()) return;
                if (drawerOpen) toggleDrawer(false);
                if (controlsDrawerOpen) toggleControlsDrawer(false);
                if (scanExpanded) setScanExpanded(false);
                mapOpen = true;
                mapEl.hidden = false;
                releasePointerLock();
                syncViewCursor();
                const subEl = document.getElementById('voxel-map-sub');
                if (subEl) {
                    let nm = '';
                    try {
                        const AP = getProfileApi();
                        const d = (AP && AP.currentPlanetDef) ? AP.currentPlanetDef(AP.load()) : null;
                        if (d) nm = d.name + (d.nameDa ? ' · ' + d.nameDa : '');
                    } catch (_) {}
                    subEl.textContent = nm ? ' — ' + nm : '';
                }
                _mapClusters = collectMapBuilds();
                _mapRecenter();
                const sites = _mapClusters.length;
                const blocks = _mapClusters.reduce((s, c) => s + c.n, 0);
                const cnt = document.getElementById('voxel-map-count');
                if (cnt) cnt.textContent = sites
                    ? sites + ' build site' + (sites === 1 ? '' : 's') + ' · ' + blocks + ' block' + (blocks === 1 ? '' : 's')
                    : 'No builds yet — place blocks to map them';
                drawMap(elapsed);
                if (!_mapRaf) _mapRaf = requestAnimationFrame(_mapTick);
            } else {
                mapOpen = false;
                if (_mapRaf) { cancelAnimationFrame(_mapRaf); _mapRaf = 0; }
                if (mapEl) mapEl.hidden = true;
                if (firstPerson) requestFpPointerLock();
            }
        }

        function toggleControlsDrawer(force) {
            const next = force !== undefined ? !!force : !controlsDrawerOpen;
            if (next && drawerOpen) toggleDrawer(false);
            controlsDrawerOpen = next;
            if (controlsDrawerEl) {
                controlsDrawerEl.hidden = !controlsDrawerOpen;
                controlsDrawerEl.classList.toggle('vx-controls-open', controlsDrawerOpen);
            }
            if (controlsDrawerOpen) {
                releasePointerLock();
                syncViewCursor();
                updateViewHints();
            } else if (firstPerson) {
                requestFpPointerLock();
            }
        }

        function toggleDrawer(force) {
            drawerOpen = force !== undefined ? !!force : !drawerOpen;
            if (drawerOpen && controlsDrawerOpen) toggleControlsDrawer(false);
            if (drawerEl) {
                drawerEl.hidden = !drawerOpen;
                drawerEl.classList.toggle('vx-drawer-open', drawerOpen);
            }
            if (drawerOpen) {
                releasePointerLock();
                syncViewCursor();
                codexView = null;
                renderDrawer();
                if (g.showMessage) g.showMessage('Inventory — equip weapons, drag blocks to quickbar', 2200);
            } else {
                disposeGearViewer();
                renderHotbar();
                if (firstPerson) requestFpPointerLock();
            }
        }
        function renderDrawer() {
            if (!drawerPanelEl) return;
            // Preserve scroll position when re-rendering the SAME view — crafting/upgrading
            // rebuilds the whole drawer (via addToInventory), which would otherwise snap the
            // list back to the top on every click.
            const renderKey = drawerTab + '|' + (codexView ? JSON.stringify(codexView) : '');
            const prevBody = drawerPanelEl.querySelector('#voxel-drawer-body');
            const prevScroll = (prevBody && renderKey === _drawerRenderKey) ? prevBody.scrollTop : 0;
            disposeGearViewer();   // tear down any orbiting preview before the panel is rebuilt
            syncHotbarFromBackpack();
            const ownedOnly = drawerFilter === 'owned';
            const invTab = (drawerTab === 'Backpack' || drawerTab === 'Gear');
            drawerPanelEl.innerHTML = `
                <div class="vx-header">
                    <h3 class="vx-title"><span>📖</span> Field Journal</h3>
                    <div class="vx-actions">
                        ${invTab ? `<button type="button" class="vx-btn ${ownedOnly ? 'vx-btn-on' : ''}" data-vx-filter="owned">Owned</button>
                        <button type="button" class="vx-btn ${ownedOnly ? '' : 'vx-btn-on'}" data-vx-filter="all">All</button>
                        <button type="button" class="vx-btn" data-vx-clear-bar>Clear bar</button>` : ''}
                        <button type="button" class="vx-btn" data-vx-close>Close (Esc)</button>
                    </div>
                </div>
                ${invTab ? `<div class="vx-strip-wrap"><div class="vx-strip" id="voxel-drawer-strip"></div></div>` : ''}
                <div class="vx-inv-nav" id="voxel-drawer-nav"></div>
                <div class="vx-body" id="voxel-drawer-body"></div>
                <div class="vx-help">
                    <kbd>1</kbd>–<kbd>9</kbd> pick slot · <kbd>Q</kbd>/<kbd>E</kbd> cycle weapon · <kbd>Tab</kbd>/<kbd>M</kbd> journal · <kbd>H</kbd> controls · <kbd>Esc</kbd> close
                </div>`;

            const strip = drawerPanelEl.querySelector('#voxel-drawer-strip');
            if (strip) {
                for (let i = 0; i < HOTBAR_SLOTS; i++) {
                    strip.appendChild(makeSlotEl(i, {
                        strip: true,
                        onClick: () => selectSlot(i),
                        onContext: (e) => { e.preventDefault(); clearHotbarSlot(i); }
                    }));
                }
            }

            const nav = drawerPanelEl.querySelector('#voxel-drawer-nav');
            DRAWER_TABS.forEach((tab) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'vx-tab' + (drawerTab === tab.id ? ' vx-tab-on' : '');
                btn.innerHTML = `<span class="vx-tab-icon">${tab.icon}</span><span class="vx-tab-label">${tab.label}</span>`;
                btn.addEventListener('click', () => {
                    drawerTab = tab.id;
                    codexView = null;
                    saveDrawerTab();
                    renderDrawer();
                });
                nav.appendChild(btn);
            });

            const body = drawerPanelEl.querySelector('#voxel-drawer-body');
            renderDrawerTabBody(body, ownedOnly);
            body.scrollTop = prevScroll;          // restore scroll for same-view re-renders
            _drawerRenderKey = renderKey;

            drawerPanelEl.querySelector('[data-vx-close]').addEventListener('click', () => toggleDrawer(false));
            const clearBtn = drawerPanelEl.querySelector('[data-vx-clear-bar]');
            if (clearBtn) clearBtn.addEventListener('click', () => {
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
            if(_AC) _AC.setScene(scene);   // route creature breath/spore/ember fx into this scene
            camera = g.camera;
            camera.fov = firstPerson ? getFpCam().fov : getTpCam().fov;
            camera.near = 0.1;
            camera.far = 700;
            camera.updateProjectionMatrix();
            // Daytime planet sky + horizon haze (replaces the old nebula space bg).
            // Fog far hides the world edge so terrain reads as "to the horizon".
            g.scene.fog = new THREE.Fog(0xbfe0f5, FOG_NEAR, FOG_FAR);
            if (!g._voxelLights) {
                g._voxelLights = [];
                const hemi = new THREE.HemisphereLight(0x4a90e0, 0x6a7a4a, 0.9);
                const keyL = new THREE.DirectionalLight(0xfff4e0, 1.05);
                keyL.position.set(60, 120, 40);   // sun high overhead
                const rim = new THREE.DirectionalLight(0xbfe0f5, 0.22);
                rim.position.set(-40, 30, -30);
                g.scene.add(hemi, keyL, rim);
                g._voxelLights.push(hemi, keyL, rim);
            }
            buildSkyDome();            // must exist before applyPlanetAtmosphere so it gets the theme colours
            buildPlanetBody();         // curved globe seen from space
            applyPlanetAtmosphere();   // tints sky dome + fog/lights for the active planet
            buildClouds();
            _hideLegacyEnvironment();
            if (g._hideLegacyPlayUI) g._hideLegacyPlayUI();
            const hud = document.getElementById('voxel-overlay');
            if (hud) hud.hidden = false;
            if (g.showMessage) g.showMessage('Asteroid — mine, build, jetpack (hold Space)', 3200);
        }

        function _restoreScene() {
            if (!_saved) return;
            disposeClouds();
            disposeEmberFx();
            disposeSkyDome();
            disposePlanetBody();
            if(g.camera){ g.camera.far = 700; g.camera.updateProjectionMatrix(); }   // undo space far-plane
            if (g.camera && g.camera.up) g.camera.up.set(0, 1, 0);   // undo radial camera up
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
            toggleControlsDrawer(false);
            if (g._restoreLegacyPlayUI) g._restoreLegacyPlayUI();
        }

        function _resetInput() {
            const codes = [
                'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
                'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight',
                'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
            ];
            codes.forEach((code) => { keys[code] = false; });
            if (player.crouch) {            // release crouch, but only stand with headroom
                player.height = PLAYER_STAND_H;
                if (boxCollides(player.pos.x, player.pos.y, player.pos.z)) player.height = PLAYER_CROUCH_H;
                else { player.crouch = false; crouchBlend = 0; }
            }
            if (g.keys) codes.forEach((code) => { g.keys[code] = false; });
            dragging = false;
            moved = 0;
            downBtn = 0;
            fireHeld = false;
            laserCooldown = 0;
            jetpackSfxCd = 0;
            resetMining();
            _aimShownTarget = null;
            _aimCandidateTarget = null;
            _aimCandidateFrames = 0;
            releasePointerLock();
            syncViewCursor();
        }

        function _clearWorld() {
            scene3.chunks.forEach(c => {
                ['static','anim','glass','water','deco'].forEach(k => {
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
            disposeTpFireTrace();
            disposeAimEdgeHighlight();
            disposeMineBlockFx();
            disposePlaceGhost();
            if (fpPivot && fpPivot.parent) fpPivot.parent.remove(fpPivot);
            if (g._voxelLights) {
                g._voxelLights.forEach((l) => g.scene.remove(l));
                g._voxelLights = null;
            }
            disposeLampLights();
        }

        function _removeListeners() {
            _listeners.forEach(([el, ev, fn, opts]) => el.removeEventListener(ev, fn, opts));
            _listeners = [];
        }

        // Topmost solid, non-water surface height in a column (-1 if only water/air).
        // Topmost solid, non-water surface height in a column (via the generator).
        function landTop(cx, cz) {
            for (let y = H - 2; y > 0; y--) {
                const b = genBlockSingle(cx, y, cz);
                if (b && b !== WATER) return y;
            }
            return -1;
        }

        // Spawn standing on dry land: spiral outward from the origin for the first
        // column whose surface is land at/above the water line.
        function spawnPlayerAtCenter() {
            const place = (cx, cz, y) => {
                player.pos.set(cx + 0.5 + WORLD_OFFSET.x, y + 1 + WORLD_OFFSET.y + 0.01, cz + 0.5 + WORLD_OFFSET.z);
                player.vel.set(0, 0, 0);
                _spawnPos.copy(player.pos);
                player.health = player.maxHealth; player.invuln = 0; player.hurtFlash = 0;
            };
            for (let r = 0; r < 600; r += 2) {
                for (let a = 0; a < (r ? 8 : 1); a++) {
                    const ang = (a / 8) * Math.PI * 2;
                    const cx = Math.round(Math.cos(ang) * r);
                    const cz = Math.round(Math.sin(ang) * r);
                    const y = landTop(cx, cz);
                    if (y >= SEA_LEVEL) { place(cx, cz, y); return; }
                }
            }
            place(0, 0, Math.max(SEA_LEVEL, landTop(0, 0)));
        }

        // ---------- multiplanetary travel ----------
        // Switch the player to another *unlocked* planet: persist the choice, then
        // regenerate the world from that planet's seed/biome and respawn. Returns
        // false if the planet isn't unlocked (or there is no profile API).
        function travelToPlanet(id) {
            const AP = getProfileApi();
            if (!AP || !AP.setCurrentPlanet) return false;
            if (!AP.setCurrentPlanet(AP.load(), id)) return false;
            const def = AP.planetDef ? AP.planetDef(id) : null;
            showVoxelLoading(def ? ('Traveling to ' + def.name) : 'Traveling…', def ? def.nameDa : '');
            afterPaint(() => {
                if (!_active) { hideVoxelLoading(); return; }
                loadActivePlanet();
                loadProfileEdits();
                resetStreaming();
                clearCritters();
                spawnPlayerAtCenter();
                prewarmHorizon(() => {
                    spawnStarGate();
                    // if you flew here, arrive in the upper sky still piloting — descend to explore
                    if (flying && ship) {
                        ship.pos.set(player.pos.x, SPACE_ARRIVE_Y, player.pos.z);
                        ship.vel.set(0,0,0); ship.pitch=0; ship.roll=0; ship.pitchCmd=0;
                        player.pos.copy(ship.pos); player.yaw = ship.yaw;
                    }
                    flushProfileState();
                    hideVoxelLoading();
                    if (def && g.showMessage) g.showMessage((flying?'Descending toward ':'Arrived at ') + def.name + ' · ' + def.nameDa, 2600);
                    try {
                        const AP2 = getProfileApi();
                        if (AP2 && AP2.recordTravel) {
                            const { completed } = AP2.recordTravel(AP2.load(), id);
                            if (completed && g.showMessage) g.showMessage('Survey complete: ' + completed.title, 2800);
                        }
                    } catch (_) {}
                    if (typeof updateJournalHud === 'function') updateJournalHud();
                    if (typeof syncMissionWaypoint === 'function') syncMissionWaypoint();
                });
            });
            return true;
        }

        // Cycle to the next unlocked planet in catalog order (Shift+R / dev hook).
        function travelToNextPlanet() {
            const AP = getProfileApi();
            if (!AP || !AP.nextUnlockedPlanet) return;
            const next = AP.nextUnlockedPlanet(AP.load());
            if (!next) return;
            if (next.id === activePlanetId) {
                if (g.showMessage) g.showMessage('No other planets granted yet — complete a survey to chart one.', 2600);
                return;
            }
            travelToPlanet(next.id);
        }

        // Dev/manual hook: jump straight to a planet by id from the console.
        // Grants the planet first (bypasses the mission gate) so any world is
        // reachable for testing. e.g. window.PJBOY_ASTEROID.travel('frost_tinde')
        window.PJBOY_ASTEROID = {
            travel: (id) => {
                const AP = getProfileApi();
                if (AP && AP.grantPlanet) {
                    const p = AP.load();
                    if (AP.grantPlanet(p, id)) AP.save(p);
                }
                return travelToPlanet(id);
            },
            next: travelToNextPlanet,
            unlockAll: () => {
                const AP = getProfileApi();
                if (!AP || !AP.PLANETS) return;
                const p = AP.load();
                AP.PLANETS.forEach((pl) => AP.grantPlanet(p, pl.id));
                AP.save(p);
                if (typeof updateJournalHud === 'function') updateJournalHud();
                if (g.showMessage) g.showMessage('All planets charted (dev).', 2000);
            },
            planets: () => (window.AsteroidProfile ? window.AsteroidProfile.PLANETS : []),
            current: () => activePlanetId,
            // Dev helpers for night / doors (safe — does not rewrite whole profile)
            setDay: (t) => {
                dayTime = ((Number(t) % 1) + 1) % 1;
                const phase = dayPhaseOf(dayTime);
                if (phase !== _dayPhase) { const prev = _dayPhase; _dayPhase = phase; onDayPhaseChange(prev, phase); }
                else _dayPhase = phase;
                applyDaySky(); updateDayChip();
                return { dayTime, phase: _dayPhase, dayF: _dayF };
            },
            phase: () => ({ dayTime, phase: _dayPhase, dayF: _dayF }),
            give: (id, n) => { addToInventory(id | 0, Math.max(1, n | 0)); return backpack[id | 0] || 0; },
            ids: () => ({ LAMP: LAMP_ID, DOOR: DOOR_CLOSED, DOOR_OPEN, TNT: 45, CIRCUIT: 33, ALLOY: 31 }),
            setBlock: (x, y, z, id) => { setBlockEvent(x | 0, y | 0, z | 0, id | 0); return getBlock(x | 0, y | 0, z | 0); },
            getBlock: (x, y, z) => getBlock(x | 0, y | 0, z | 0),
            solid: (wx, wy, wz) => solidAt(wx, wy, wz),
            surfaceTop: (vx, vz) => surfaceTopVox(vx | 0, vz | 0)
        };

        /* ============================ CREATURES ============================
           Wandering wildlife: procedural box critters that spawn on valid
           surface around the player, wander (avoiding water & cliffs), and
           despawn as you stream away. A few species are shy and flee. Each is
           scannable for a bilingual name + a real science fact (educational).
           Creatures are dynamic/ephemeral — NOT part of the deterministic
           terrain. They are not minable; only the scanner interacts with them. */
        // Bestiary is a shared, data-driven content registry (asteroid-creatures.js).
        // Each def is the universal Actor: build() -> {group, st, anim(t,state,dt)}.
        // CREATURES here is the spawnable subset (peaceful Living wildlife);
        // hostiles / bosses / NPCs are registered but gated until later milestones.
        const _AC = window.AsteroidCreatures;
        const _AS = window.AsteroidShips;   // voxel fleet registry (Drone companion + ships)
        let droneCompanion = null;          // Hero-faction follower that scouts beside the player
        let flying = false, ship = null;    // arcade flight: pilot a Hero ship (G to board/land)
        let _flyCamPos = null, _flyCamUp = null;
        let _shipTrails = null;             // wingtip vapor streaks at high speed
        const _wingL = new THREE.Vector3(), _wingR = new THREE.Vector3();  // set per-ship from ship.wing*scale
        const _tmpTip = new THREE.Vector3();
        let starGate = null;                // Ancient Star Gate near spawn (E to travel)
        const GATE_KEY_ID = 41;             // crafted item that powers a dormant gate
        const CREATURES = (_AC ? _AC.DEFS.filter(d => d.spawn) : []);
        const _creatureById = {}; (_AC ? _AC.DEFS : CREATURES).forEach(c => _creatureById[c.id] = c);

        const CRITTERS_ENABLED = !!_AC; // wildlife on when the bestiary registry is present
        const CRIT_CAP = 8;              // max active critters (richer box-rigs than before — keep it cozy)
        const CRIT_MIN = 26;            // never spawn closer than this to the player
        const CRIT_VIEW = 46;            // spawn out to this many blocks
        const CRIT_DESPAWN = 60;         // despawn beyond this
        const CRIT_SPEED = 2.2;          // base walk speed
        const CRIT_FLEE = 7;             // shy critters flee inside this radius
        const critters = [];
        const creatureGroups = [];       // groups for the scan raycast
        let _critTimer = 0;

        // World height to stand on at a voxel column: top solid (skips open doors), or
        // null when the top non-air cell is water (no standing / spawning on sea).
        function surfaceTopVox(vx,vz){
          for(let y=H-1;y>0;y--){
            const b=getBlock(vx,y,vz);
            if(!b || b===DOOR_OPEN) continue;          // air / open hatch — look beneath
            if(b===WATER) return null;
            return y;
          }
          return null;
        }
        // Creatures may step up at most one block — never teleport onto roofs.
        const CREATURE_MAX_STEP = 1;
        function tryCreatureStep(cr, nx, nz, easeY, dt){
          const top = surfaceTopVox(Math.floor(nx), Math.floor(nz));
          if(top === null) return false;
          const standTop = Math.round(cr.pos.y - WORLD_OFFSET.y - 1);
          if(top - standTop > CREATURE_MAX_STEP) return false;
          cr.pos.x = nx; cr.pos.z = nz;
          const ty = top + 1 + WORLD_OFFSET.y;
          if(easeY) cr.pos.y += (ty - cr.pos.y) * Math.min(1, 12 * (dt || 0));
          else cr.pos.y = ty;
          return true;
        }
        // Block attacks through walls/ceilings (sample solids between creature and player).
        function hasCreatureLineOfSight(cr){
          const ax = cr.pos.x, ay = cr.pos.y + 0.9, az = cr.pos.z;
          const bx = player.pos.x, by = player.pos.y + 0.9, bz = player.pos.z;
          const dx = bx - ax, dy = by - ay, dz = bz - az;
          const dist = Math.hypot(dx, dy, dz);
          if(dist < 0.2) return true;
          const steps = Math.max(2, Math.ceil(dist * 2));
          for(let i = 1; i < steps; i++){
            const t = i / steps;
            if(solidAt(ax + dx * t, ay + dy * t, az + dz * t)) return false;
          }
          return true;
        }

        // Instantiate one critter from the bestiary registry via the Actor
        // contract: build() -> {group, st, anim}. Per-individual scale variation.
        function placeCritter(sp, vx, vz, top){
          const actor = _AC.build(sp.id);
          if(!actor) return null;
          const s = (sp.scale || 1) * (0.88 + Math.random()*0.24);
          actor.group.scale.setScalar(s);
          const baseY = top+1+WORLD_OFFSET.y;
          // flyers hover above the surface; low flyers (jellies, moths) stay near the player's eyeline
          const flyH = sp.fly ? (sp.flyLow ? 2.0 + Math.random()*1.6 : 4.0 + Math.random()*3) : 0;
          const cr = { sp, actor, group:actor.group,
            pos:new THREE.Vector3(vx+0.5, baseY+flyH, vz+0.5),
            target:null, state:'idle', timer:0.5+Math.random()*2, phase:Math.random()*6,
            face:Math.random()*Math.PI*2, flyH, alert:0,
            hostile:(sp.temp==='Hostile'), hp:(sp.hp||6), maxHp:(sp.hp||6),
            hurtT:0, atkCd:0 };
          actor.group.userData.critter = cr;
          actor.group.position.copy(cr.pos);
          actor.group.rotation.y = cr.face;
          scene.add(actor.group);
          critters.push(cr); creatureGroups.push(actor.group);
          return cr;
        }

        function spawnOneCritter(){
          const px=Math.floor(player.pos.x), pz=Math.floor(player.pos.z);
          for(let tryN=0; tryN<6; tryN++){
            const ang=Math.random()*Math.PI*2, r=CRIT_MIN+Math.random()*(CRIT_VIEW-CRIT_MIN);
            const vx=px+Math.round(Math.cos(ang)*r), vz=pz+Math.round(Math.sin(ang)*r);
            const top=surfaceTopVox(vx,vz);
            if(top===null) continue;
            const surf=getBlock(vx,top,vz);
            const choices=CREATURES.filter(c=>c.on.indexOf(surf)>=0);
            if(!choices.length) continue;
            const sp=choices[(Math.random()*choices.length)|0];
            placeCritter(sp, vx, vz, top);
            // herds: ground species sometimes spawn a small cluster of their kind
            if(!sp.fly && Math.random()<0.6){
              const extra=1+((Math.random()*3)|0);
              for(let e=0; e<extra && critters.length<CRIT_CAP; e++){
                const ox=vx+((Math.random()*15)|0)-7, oz=vz+((Math.random()*15)|0)-7;
                const t2=surfaceTopVox(ox,oz);
                if(t2!==null && sp.on.indexOf(getBlock(ox,t2,oz))>=0) placeCritter(sp, ox, oz, t2);
              }
            }
            return;
          }
        }

        function despawnCritter(i){
          const cr=critters[i];
          scene.remove(cr.group);
          // dispose per-instance geometry/materials, but NOT the shared outline
          // material (asteroid-creatures reuses one OUTLINE across every creature).
          cr.group.traverse(o=>{
            if(o.geometry) o.geometry.dispose();
            if(o.material && !o.userData.isOutline) o.material.dispose();
          });
          const gi=creatureGroups.indexOf(cr.group); if(gi>=0) creatureGroups.splice(gi,1);
          critters.splice(i,1);
        }

        function clearCritters(){
          for(let i=critters.length-1;i>=0;i--) despawnCritter(i);
          critters.length=0; creatureGroups.length=0; _critTimer=0;
          if(_AC) _AC.clearFx();
          clearDrone();
        }

        // ---- Drone companion: a small Hero ship that hovers and scouts beside you ----
        function ensureDrone(){
          if(droneCompanion || !_AS || !_AS.has('Drone')) return;
          droneCompanion = _AS.build('Drone', { scale:0.5 });
          if(!droneCompanion) return;
          droneCompanion._yaw = player.yaw;
          droneCompanion.group.position.copy(player.pos).add(new THREE.Vector3(0, 1.7, 0));
          scene.add(droneCompanion.group);
        }
        function clearDrone(){
          if(!droneCompanion) return;
          scene.remove(droneCompanion.group);
          droneCompanion.dispose();
          droneCompanion = null;
        }
        function updateDrone(dt){
          if(flying){ if(droneCompanion) droneCompanion.group.visible=false; return; }  // docked while you fly
          ensureDrone();
          const d = droneCompanion; if(!d) return;
          d.group.visible = true;
          // hover point: up and to the player's right-rear, with a slow vertical drift
          const yaw=player.yaw, fx=Math.sin(yaw), fz=Math.cos(yaw), rx=Math.cos(yaw), rz=-Math.sin(yaw);
          const tx = player.pos.x - fx*1.0 + rx*0.9;
          const ty = player.pos.y + 1.75 + Math.sin(elapsed*1.4)*0.14;
          const tz = player.pos.z - fz*1.0 + rz*0.9;
          // smooth chase (snaps in if it falls badly behind, e.g. after a teleport)
          const gp=d.group.position;
          if(Math.hypot(tx-gp.x, ty-gp.y, tz-gp.z) > 24){ gp.set(tx,ty,tz); }
          const k=1-Math.exp(-6*dt);
          gp.x+=(tx-gp.x)*k; gp.y+=(ty-gp.y)*k; gp.z+=(tz-gp.z)*k;
          // face the way it's drifting, else look ahead with the player
          const dx=tx-gp.x, dz=tz-gp.z;
          const tgtYaw=(Math.hypot(dx,dz)>0.04)?Math.atan2(dx,dz):yaw;
          let dy=tgtYaw-d._yaw; while(dy>Math.PI)dy-=Math.PI*2; while(dy<-Math.PI)dy+=Math.PI*2;
          d._yaw+=dy*(1-Math.exp(-8*dt)); d.group.rotation.y=d._yaw;
          if(d._zapFlash>0) d._zapFlash-=dt;
          d.anim(elapsed, (d._zapFlash>0)?'alert':'idle', dt);
          // ---- tiered assists (Mk I Scout · Mk II Medic · Mk III Guardian) ----
          const tier=_droneTierCache;
          // Mk I: auto-catalogs the nearest creature now and then (educational helper)
          d._scanT=(d._scanT||0)-dt;
          if(d._scanT<=0){ d._scanT=2.2;
            let best=null,bd=12*12;
            for(const cr of critters){ const dd=(cr.pos.x-gp.x)**2+(cr.pos.z-gp.z)**2; if(dd<bd){bd=dd;best=cr;} }
            if(best) recordCreatureScan(best.sp);
          }
          // Mk II: gently mends you while it's nearby
          if(tier>=2 && player.health<player.maxHealth) player.health=Math.min(player.maxHealth, player.health+dt*5);
          // Mk III: zaps the nearest hostile (assist only — keeps combat player-led)
          if(tier>=3){
            d._zapT=(d._zapT||0)-dt;
            if(d._zapT<=0){
              let tgt=null,td=14*14;
              for(const cr of critters){ if(!cr.hostile) continue;
                const dd=(cr.pos.x-gp.x)**2+(cr.pos.y-gp.y)**2+(cr.pos.z-gp.z)**2; if(dd<td){td=dd;tgt=cr;} }
              if(tgt){ d._zapT=1.4; d._zapFlash=0.22;
                const ddx=tgt.pos.x-player.pos.x, ddz=tgt.pos.z-player.pos.z, inv=1/(Math.hypot(ddx,ddz)||1);
                damageCreature(tgt, 2, ddx*inv, ddz*inv);
                if(_AC){ for(let i=0;i<=6;i++){ const u=i/6;
                  _AC.spark(new THREE.Vector3(gp.x+(tgt.pos.x-gp.x)*u, gp.y+(tgt.pos.y+0.5-gp.y)*u, gp.z+(tgt.pos.z-gp.z)*u),
                    0x6fe3ff, new THREE.Vector3(0,0,0), 0.16, 0.07); } }
              } else d._zapT=0.5;
            }
          }
        }

        /* ===================== FLIGHT ===================== *
         * Arcade Hero-ship flight (kid-forgiving): no stall, gentle
         * auto-hover, soft terrain lift instead of crashes. The ship is
         * the player's vehicle — while piloting, player.pos rides the
         * ship so chunk streaming / wildlife / camera all follow.
         *   Mouse points the nose (pull back = up, attitude holds, full 360° —
         *   loops allowed) · W/S thrust · A/D barrel roll · arrows yaw/thrust
         *   Space+W afterburner · Space/Shift hover up/down · G to land        */
        // Arcade flight tuning — momentum-based; the nose flies where you point.
        const SHIP_TURN = 2.0;                   // keyboard yaw rate (rad/s, arrow keys)
        const SHIP_ROLL = 3.2;                   // manual barrel-roll rate (rad/s, A/D)
        const SHIP_MAX  = 38;                    // top cruise speed
        const SHIP_BOOST = 1.7;                  // afterburner multiplier (Space + W)
        const SHIP_LIFT = 26;                    // vertical climb/dive speed
        const SHIP_RESP = 2.8;                   // velocity response — lower = more glide/inertia
        const SHIP_CEILING = SPACE_Y1 + 120;     // fly well past the space transition (~268)
        function shipGroundY(x,z){
          const t=surfaceTopVox(Math.floor(x),Math.floor(z));
          return (t!==null? t+1 : SEA_LEVEL+1) + WORLD_OFFSET.y;
        }
        const FLEET = (_AS && _AS.PILOTABLE) ? _AS.PILOTABLE : [{name:'Interceptor',scale:0.8,speed:1,turn:1}];
        let shipSel = 0;                          // which Hero ship you'll launch / are flying
        function boardShip(){
          if(flying){ landShip(); return; }
          const sel=FLEET[shipSel];
          if(!_AS || !_AS.has(sel.name)){ if(g.showMessage) g.showMessage('No ship available yet.',1600); return; }
          ship = _AS.build(sel.name, { scale:sel.scale, tilt:0 });
          if(!ship){ return; }
          ship.name=sel.name; ship.speedMul=sel.speed; ship.turnMul=sel.turn; ship.scale=sel.scale; ship.wing=sel.wing;
          ship.pos = player.pos.clone(); ship.pos.y += 1.4;
          ship.vel = new THREE.Vector3();
          ship.yaw = player.yaw; ship.pitch = 0; ship.roll = 0;
          ship.pitchCmd = 0; ship.spin = 0; ship._prevYaw = player.yaw; ship._speed = 0; ship._boost = 0;
          ship.group.position.copy(ship.pos);
          ship.group.rotation.set(0, ship.yaw, 0, 'YXZ');   // yaw→pitch→roll, or pitch reads as bank off-axis
          scene.add(ship.group);
          flying = true; _flyCamPos = null;
          makeShipTrails();
          requestViewPointerLock();           // capture the mouse so it steers the ship
          if(av && av.group) av.group.visible = false;
          if(fpPivot) fpPivot.visible = false;
          playSfx('jetpack');
          if(g.showMessage) g.showMessage('🚀 Liftoff! '+sel.name+' · W thrust · mouse points the nose · C swap ship · G land', 3600);
        }
        // Swap which Hero ship you fly (C). On the ground it just selects; in flight
        // it hot-swaps the hull, carrying your position/velocity onto the new ship.
        function cycleShip(){
          shipSel = (shipSel+1) % FLEET.length;
          const sel=FLEET[shipSel];
          if(!flying){ if(g.showMessage) g.showMessage('Ship: '+sel.name+' — G to launch',2000); return; }
          if(!_AS || !_AS.has(sel.name)) return;
          const old=ship;
          const next=_AS.build(sel.name, { scale:sel.scale, tilt:0 });
          if(!next) return;
          next.name=sel.name; next.speedMul=sel.speed; next.turnMul=sel.turn; next.scale=sel.scale; next.wing=sel.wing;
          next.pos=old.pos; next.vel=old.vel; next.yaw=old.yaw; next.pitch=old.pitch; next.roll=old.roll;
          next.pitchCmd=old.pitchCmd||0; next.spin=old.spin||0; next._prevYaw=old._prevYaw!=null?old._prevYaw:old.yaw;
          next._speed=old._speed||0; next._boost=0;
          next.group.position.copy(old.group.position); next.group.rotation.copy(old.group.rotation);
          scene.add(next.group);
          scene.remove(old.group); old.dispose();
          ship=next;
          if(g.showMessage) g.showMessage('Swapped to '+sel.name, 1500);
        }
        // F: half-roll on the spot — when inverted, swap to the equivalent upright
        // attitude (yaw+180°, pitch mirrored keeps the nose pointing the exact same
        // way; only "which way is up" changes). The chase cam's eased up-vector
        // renders it as the ship rolling over its own center.
        function flipShipUpright(){
          if(!flying || !ship) return;
          if(Math.cos(ship.pitchCmd||0) >= 0){ if(g.showMessage) g.showMessage('Already right-side up!',1200); return; }
          const p=ship.pitchCmd;
          ship.pitchCmd = (p>0? Math.PI : -Math.PI) - p;
          ship.pitch = ship.pitchCmd;                    // snap the hull — the camera ease sells the roll
          ship.yaw += Math.PI; ship._prevYaw = ship.yaw; // heading jump must not read as a hard turn
          ship.roll = 0; ship.spin = 0;
          // start the camera roll through the ship's side (also keeps the 180° up-lerp
          // from passing through zero length)
          if(_flyCamUp) _flyCamUp.set(Math.cos(ship.yaw), 0, -Math.sin(ship.yaw));
          if(_shipTrails) for(const tr of _shipTrails) tr.pts.length=0;  // wingtips swapped sides
          if(g.showMessage) g.showMessage('🔄 Rolled upright!', 1400);
        }
        function landShip(){
          if(!flying) return;
          // set the player down on the surface beneath the ship
          const gy = shipGroundY(ship.pos.x, ship.pos.z);
          player.pos.set(ship.pos.x, gy + 0.02, ship.pos.z);
          player.vel.set(0,0,0); player.knock.set(0,0,0);
          scene.remove(ship.group); ship.dispose(); ship = null;
          clearShipTrails(); clearSpace();
          flying = false; _flyCamPos = null; _flyCamUp = null;
          if(camera) camera.up.set(0,1,0);   // un-tilt for the normal on-foot camera
          if(av && av.group) av.group.visible = !firstPerson;
          if(fpPivot) fpPivot.visible = firstPerson;
          if(firstPerson) requestViewPointerLock();
          else { releasePointerLock(); syncViewCursor(); }
          if(g.showMessage) g.showMessage('Landed.', 1400);
        }
        // Wingtip vapor: a thin additive line per wingtip that fades to nothing
        // along its length (vertex colour → black under additive blending), so it
        // reads as a slim vortex streak. Only shows once you're moving fast.
        function makeShipTrails(){
          clearShipTrails();
          const N=20;
          const mk=()=>{
            const geom=new THREE.BufferGeometry();
            const pos=new Float32Array(N*3), col=new Float32Array(N*3);
            geom.setAttribute('position', new THREE.BufferAttribute(pos,3));
            geom.setAttribute('color', new THREE.BufferAttribute(col,3));
            const mat=new THREE.LineBasicMaterial({ vertexColors:true, transparent:true, opacity:0,
              blending:THREE.AdditiveBlending, depthWrite:false });
            const line=new THREE.Line(geom,mat); line.frustumCulled=false;
            scene.add(line);
            return { line, geom, pos, col, pts:[], N };
          };
          _shipTrails=[mk(), mk()];
        }
        function clearShipTrails(){
          if(!_shipTrails) return;
          for(const tr of _shipTrails){ scene.remove(tr.line); tr.geom.dispose(); tr.line.material.dispose(); }
          _shipTrails=null;
        }
        function updateShipTrails(){
          if(!_shipTrails || !ship) return;
          const q=ship.group.quaternion;
          const spd01=THREE.MathUtils.clamp(((ship._speed||0)-16)/(SHIP_MAX-16),0,1);
          const op=spd01*spd01*0.85;                       // ramps in only at speed
          // anchor the trails at THIS ship's wingtips (local wing * scale, mirrored)
          const w=ship.wing||[1.9,0.6,-1.2], sc=ship.scale||1;
          _wingR.set(w[0]*sc, w[1]*sc, w[2]*sc);
          _wingL.set(-w[0]*sc, w[1]*sc, w[2]*sc);
          const offs=[_wingL,_wingR];
          for(let i=0;i<2;i++){
            const tr=_shipTrails[i];
            _tmpTip.copy(offs[i]).applyQuaternion(q).add(ship.pos);
            tr.pts.unshift(_tmpTip.clone());
            if(tr.pts.length>tr.N) tr.pts.pop();
            const n=tr.pts.length;
            for(let j=0;j<n;j++){
              const p=tr.pts[j]; tr.pos[j*3]=p.x; tr.pos[j*3+1]=p.y; tr.pos[j*3+2]=p.z;
              const k=1-j/(tr.N-1);                          // bright at the tip, fades down the tail
              tr.col[j*3]=0.78*k; tr.col[j*3+1]=0.92*k; tr.col[j*3+2]=1.0*k;
            }
            tr.geom.attributes.position.needsUpdate=true;
            tr.geom.attributes.color.needsUpdate=true;
            tr.geom.setDrawRange(0, n);
            tr.line.material.opacity=op;
          }
        }

        const _shipFwd=new THREE.Vector3();
        function updateFlight(dt){
          if(!ship) { flying=false; return; }
          const k=keys;
          const yawIn=(k.ArrowLeft?1:0)-(k.ArrowRight?1:0);
          const rollIn=(k.KeyD?1:0)-(k.KeyA?1:0);          // A/D barrel roll (mouse steers)
          const thr=(k.KeyW||k.ArrowUp?1:0)-(k.KeyS||k.ArrowDown?1:0);
          // Space is the afterburner while thrusting — only lifts when hovering
          const upIn=((k.Space && !(thr>0))?1:0)-((k.ShiftLeft||k.ShiftRight)?1:0);
          // heading: keyboard yaw (mouse yaw is applied live in applyFlightMouse)
          ship.yaw += yawIn*SHIP_TURN*(ship.turnMul||1)*dt;
          const boosting = (thr>0 && k.Space);             // afterburner: Space + W
          const inSpace = ship.pos.y > SPACE_ENTER_Y;      // open space — worlds are far apart
          const spd = SHIP_MAX*(ship.speedMul||1)*(boosting?SHIP_BOOST:1)*(inSpace?1.7:1);
          // thrust along the NOSE (yaw + held mouse pitch) — the ship flies where you point
          const cp=Math.cos(ship.pitchCmd||0), sp=Math.sin(ship.pitchCmd||0);
          _shipFwd.set(Math.sin(ship.yaw)*cp, sp, Math.cos(ship.yaw)*cp);
          // momentum: ease velocity toward the commanded target (gives weight + glide)
          const tvx=_shipFwd.x*thr*spd, tvz=_shipFwd.z*thr*spd;
          const tvy=_shipFwd.y*thr*spd + upIn*SHIP_LIFT;
          const r=1-Math.exp(-SHIP_RESP*dt);
          ship.vel.x += (tvx-ship.vel.x)*r;
          ship.vel.z += (tvz-ship.vel.z)*r;
          ship.vel.y += (tvy-ship.vel.y)*r;
          // integrate
          ship.pos.x += ship.vel.x*dt; ship.pos.z += ship.vel.z*dt; ship.pos.y += ship.vel.y*dt;
          // soft terrain lift — rise over hills instead of crashing; a descending
          // attitude relaxes to level so the ship pulls up instead of grinding
          const minY=shipGroundY(ship.pos.x, ship.pos.z)+1.6;
          if(ship.pos.y < minY){ ship.pos.y = minY; if(ship.vel.y<0) ship.vel.y=0;
            if(Math.sin(ship.pitchCmd||0) < 0) ship.pitchCmd *= Math.exp(-6*dt); }
          if(ship.pos.y > SHIP_CEILING){ ship.pos.y = SHIP_CEILING; if(ship.vel.y>0) ship.vel.y=0; }
          // ---- orientation: nose tracks the COMMANDED attitude (mouse-held pitch) ----
          ship.pitch += ((ship.pitchCmd||0) - ship.pitch)*(1-Math.exp(-10*dt));
          // wrap a completed loop back into ±π (shift cmd+display together — no visual snap)
          if(ship.pitchCmd > Math.PI){ ship.pitchCmd -= 2*Math.PI; ship.pitch -= 2*Math.PI; }
          else if(ship.pitchCmd < -Math.PI){ ship.pitchCmd += 2*Math.PI; ship.pitch += 2*Math.PI; }
          // flying inverted for a while → teach the flip key (once per inversion)
          if(Math.cos(ship.pitchCmd) < 0){
            ship._invT=(ship._invT||0)+dt;
            if(ship._invT>2.5 && !ship._invHint){ ship._invHint=true;
              if(g.showMessage) g.showMessage('🙃 Upside down — press F to roll upright', 2600); }
          } else { ship._invT=0; ship._invHint=false; }
          // bank into the turn from the real yaw rate (keyboard + mouse)
          const yawRate=(ship.yaw-(ship._prevYaw!=null?ship._prevYaw:ship.yaw))/Math.max(dt,1e-4);
          ship._prevYaw=ship.yaw;
          const rollTarget=THREE.MathUtils.clamp(-yawRate*0.30, -0.9, 0.9);
          ship.roll += (rollTarget - ship.roll)*(1-Math.exp(-8*dt));
          // manual barrel roll (A/D) rides ON TOP of the auto-bank — the camera only
          // follows the bank, so the view stays steady while the hull spins; released,
          // it takes the shortest path back to wings-level
          if(rollIn){ ship.spin=(ship.spin||0)+rollIn*SHIP_ROLL*dt; }
          else if(ship.spin){
            ship.spin%=2*Math.PI;
            if(ship.spin>Math.PI) ship.spin-=2*Math.PI; else if(ship.spin<-Math.PI) ship.spin+=2*Math.PI;
            ship.spin*=Math.exp(-5*dt);
            if(Math.abs(ship.spin)<0.01) ship.spin=0;
          }
          ship.group.position.copy(ship.pos);
          // negative X: +X rotation dips the +z nose, but positive pitch = climb
          ship.group.rotation.set(-ship.pitch, ship.yaw, ship.roll+(ship.spin||0), 'YXZ');
          ship._speed=Math.hypot(ship.vel.x,ship.vel.y,ship.vel.z); ship._boost=boosting?1:0;
          ship.anim(elapsed, (thr>0||upIn>0||boosting||rollIn)?'alert':'idle', dt);  // throttle drives flames/glow
          updateShipTrails();
          // the player rides the ship (keeps streaming/creatures/camera centred)
          player.pos.copy(ship.pos); player.yaw = ship.yaw;
          if(av && av.group) av.group.visible = false;
          // space map: climb into orbit to see the other worlds; fly to one to travel.
          // updateSpace owns the fade-out + teardown so leaving orbit crossfades smoothly.
          if(ship.pos.y > SPACE_ENTER_Y && !spaceMode) enterSpaceMode();
          if(spaceMode) updateSpace(dt);
        }

        // ---- Star map: the worlds as game-sized planet bodies you fly between ----
        function makeOrbLabel(name, sub){
          const cv=document.createElement('canvas'); cv.width=256; cv.height=96;
          const c=cv.getContext('2d'); c.textAlign='center';
          c.shadowColor='rgba(0,0,0,0.85)'; c.shadowBlur=6;
          c.font='bold 34px ui-monospace,Menlo,monospace'; c.fillStyle='#eaf4ff'; c.fillText(name,128,40);
          c.font='600 22px ui-monospace,Menlo,monospace'; c.fillStyle='#9fd0ff'; c.fillText('🇩🇰 '+sub,128,72);
          const tex=new THREE.CanvasTexture(cv);
          const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,depthTest:false}));
          sp.scale.set(28,10.5,1); return sp;
        }
        function planetColor(def){ return def.id==='aquaria'?0x3fa9e6:(BIOME_ORB[def.biome]||0x8fd0ff); }
        function _lighten(hex,f){ const r=hex>>16&255,g2=hex>>8&255,b=hex&255;
          return (Math.round(r+(255-r)*f)<<16)|(Math.round(g2+(255-g2)*f)<<8)|Math.round(b+(255-b)*f); }
        function makePlanetBody(def, x,y,z, R, isHome){
          const col=planetColor(def), air=_lighten(col,0.55);
          const grp=new THREE.Group(); grp.position.set(x,y,z);
          // low emissive so the sun carves a clear day/night terminator → reads as a real planet
          const core=new THREE.Mesh(new THREE.SphereGeometry(R,40,28),
            new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:0.1,roughness:1.0,metalness:0.0,
              transparent:true,opacity:0}));
          grp.add(core);
          const atmo=new THREE.Mesh(new THREE.SphereGeometry(R*1.10,28,20),   // bright atmosphere rim
            new THREE.MeshBasicMaterial({color:air,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.BackSide}));
          grp.add(atmo);
          const glow=new THREE.Mesh(new THREE.SphereGeometry(R*1.42,24,16),    // soft outer halo
            new THREE.MeshBasicMaterial({color:air,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.BackSide}));
          grp.add(glow);
          const label=makeOrbLabel(def.name, def.nameDa); label.position.y=R+16; label.material.opacity=0; grp.add(label);
          scene.add(grp);
          planetOrbs.push({grp, core, def, pos:grp.position.clone(), R, isHome:!!isHome,
            mats:[{m:core.material,o:1},{m:atmo.material,o:0.30},{m:glow.material,o:0.12},{m:label.material,o:1}]});
        }
        function enterSpaceMode(){
          if(spaceMode) return; spaceMode=true;
          const AP=getProfileApi(); const list=(AP&&AP.PLANETS)||[];
          const cx=ship?ship.pos.x:player.pos.x, cz=ship?ship.pos.z:player.pos.z;
          // the world you're leaving — a real body fixed below the surface, so it shrinks as you climb away
          const homeDef=list.find(p=>p.id===activePlanetId)||list[0];
          if(homeDef) makePlanetBody(homeDef, cx, -62, cz, 86, true);
          // the other worlds, spread far apart across the star field
          const others=list.filter(p=>p.id!==activePlanetId);
          others.forEach((def,i)=>{
            const ang=(i/Math.max(1,others.length))*Math.PI*2 + 0.7, dist=520 + i*340;
            makePlanetBody(def, cx+Math.cos(ang)*dist, SPACE_ENTER_Y+70+(i%3)*55, cz+Math.sin(ang)*dist, 42, false);
          });
          if(g.showMessage) g.showMessage('Entering orbit — pick a distant world and fly to it', 3400);
        }
        function clearSpace(){
          for(const o of planetOrbs){ scene.remove(o.grp);
            o.grp.traverse(m=>{ if(m.geometry)m.geometry.dispose();
              if(m.material){ if(m.material.map)m.material.map.dispose(); m.material.dispose(); } }); }
          planetOrbs.length=0; spaceMode=false; _mapFade=0;
          const h=document.getElementById('voxel-gate-hint'); if(h) h.hidden=true;
        }
        function updateSpace(dt){
          // crossfade the whole map in/out by altitude → smooth entry AND exit
          const target = (ship && ship.pos.y > SPACE_EXIT_Y) ? 1 : 0;
          _mapFade += (target - _mapFade) * (1 - Math.exp(-2.5*dt));
          let nearest=null, nd=1e9;
          for(const o of planetOrbs){
            o.core.rotation.y += dt*0.06;
            for(const mm of o.mats) mm.m.opacity = mm.o * _mapFade;   // fade with the map
            if(o.isHome) continue;                                    // the world you left isn't a destination
            const d=ship?ship.pos.distanceTo(o.pos):1e9;
            if(d<nd){ nd=d; nearest=o; }
          }
          // fully faded out and back in the atmosphere → tear the map down
          if(_mapFade < 0.02 && target===0){ clearSpace(); return; }
          const hintEl=document.getElementById('voxel-gate-hint');
          if(hintEl){
            if(nearest && _mapFade > 0.5){
              const AP=getProfileApi(); const unlocked=AP&&AP.isUnlocked(AP.load(), nearest.def.id);
              hintEl.hidden=false;
              hintEl.innerHTML='🪐 '+nearest.def.name+' · '+nearest.def.nameDa+' — '+Math.round(nd)+'m'
                + (unlocked? '' : '<br><b>dormant</b> · needs a Gate Key');
            } else hintEl.hidden=true;
          }
          if(nearest && _mapFade > 0.6 && nd < nearest.R + 16) arriveAtOrb(nearest);
        }
        function arriveAtOrb(o){
          const AP=getProfileApi(); if(!AP) return;
          const prof=AP.load();
          if(!AP.isUnlocked(prof, o.def.id)){
            if(getBackpackCount(GATE_KEY_ID) < 1){
              if(g.showMessage) g.showMessage(o.def.name+' is dormant — craft a Gate Key to chart it.', 2600);
              if(ship){ const ax=ship.pos.x-o.pos.x, az=ship.pos.z-o.pos.z, m=Math.hypot(ax,az)||1, push=o.R+22;
                ship.pos.x=o.pos.x+ax/m*push; ship.pos.z=o.pos.z+az/m*push;   // shove clear so it won't re-trigger
                ship.vel.multiplyScalar(0.25); }
              return;
            }
            spendFromInventory(GATE_KEY_ID,1); AP.grantPlanet(prof,o.def.id); AP.save(prof);
            if(g.showMessage) g.showMessage('Gate Key spent — course locked!',1600);
          }
          const id=o.def.id;
          clearSpace();
          travelToPlanet(id);    // flying arrival drops you into the new world's upper sky
        }
        const _fcFwd=new THREE.Vector3(), _fcUp=new THREE.Vector3(), _fcDesired=new THREE.Vector3(), _fcLook=new THREE.Vector3();
        const _fcEuler=new THREE.Euler(), _fcQuat=new THREE.Quaternion();
        function updateFlightCamera(dt){
          if(!ship || !camera) return;
          // speed-reactive FOV + pullback sell the sense of speed
          const spd01=Math.min(1, (ship._speed||0)/(SHIP_MAX*1.3));
          const fov=72 + spd01*12 + (ship._boost?4:0);
          if(Math.abs(camera.fov-fov)>0.1){ camera.fov=fov; camera.updateProjectionMatrix(); }
          // chase behind the tail in the ship's frame — full pitch follow (loops /
          // inverted flight work), but only ~30% of the roll: the camera staying
          // flatter is what makes the ship VISIBLY bank into turns on screen
          _fcEuler.set(-ship.pitch, ship.yaw, ship.roll*0.3, 'YXZ');
          _fcQuat.setFromEuler(_fcEuler);
          _fcFwd.set(0,0,1).applyQuaternion(_fcQuat);      // nose is +z
          _fcUp.set(0,1,0).applyQuaternion(_fcQuat);
          const dist=8.5 + spd01*3.4;
          _fcDesired.copy(ship.pos).addScaledVector(_fcFwd,-dist).addScaledVector(_fcUp,3.0);
          if(!_flyCamPos) _flyCamPos=_fcDesired.clone();
          if(!_flyCamUp)  _flyCamUp=_fcUp.clone();
          _flyCamPos.lerp(_fcDesired, 1-Math.exp(-12*dt));
          _flyCamUp.lerp(_fcUp, 1-Math.exp(-10*dt));
          if(_flyCamUp.lengthSq() < 1e-4) _flyCamUp.copy(_fcUp);  // antiparallel lerp degenerated
          _flyCamUp.normalize();
          camera.position.copy(_flyCamPos);
          camera.up.copy(_flyCamUp);
          _fcLook.copy(ship.pos).addScaledVector(_fcFwd,6).addScaledVector(_fcUp,0.6);
          camera.lookAt(_fcLook);
        }

        /* ===================== STAR GATE ===================== *
         * The Ancient inter-world travel mechanic + progression spine.
         * A hovering ring spawns near your landing site; walk up and press
         * E to step through. A gate to an unvisited world is dormant until
         * you spend a crafted Gate Key (Crystals power it). Travel reuses
         * the existing planet-travel chain.                                 */
        const GATE_REACH = 5.5;
        // Space map: climb a ship above SPACE_ENTER_Y and the other worlds appear as
        // orbs you fly to. Drop below SPACE_EXIT_Y to return to the world below.
        const SPACE_ENTER_Y = SPACE_Y1;          // orbs appear above this altitude
        const SPACE_EXIT_Y  = SPACE_Y1 - 26;     // orbs clear when you descend past this
        const SPACE_ARRIVE_Y = SPACE_Y0 - 6;     // you arrive here, descending into a new world
        const BIOME_ORB = { verdant:0x6ee06a, frost:0xbcd4ec, fungal:0xc46ae8, desert:0xd9b878, volcanic:0xff5a2e };
        let spaceMode = false; const planetOrbs = [];
        function gateDestination(){
          const AP=getProfileApi(); if(!AP || !AP.PLANETS) return null;
          const list=AP.PLANETS;
          const i=list.findIndex(p=>p.id===activePlanetId);
          if(i<0) return list[0]||null;
          return list[(i+1)%list.length];           // next world in catalog order (wraps)
        }
        function clearStarGate(){
          if(!starGate) return;
          scene.remove(starGate.actor.group); starGate.actor.dispose();
          starGate=null;
        }
        function spawnStarGate(){
          clearStarGate();
          if(!_AS || !_AS.has('StarGate')) return;
          const dest=gateDestination(); if(!dest) return;
          const actor=_AS.build('StarGate', { scale:0.5, tilt:0 });
          if(!actor) return;
          const ox=Math.round(player.pos.x)+6, oz=Math.round(player.pos.z);
          const gy=shipGroundY(ox,oz)+3.4;          // hovers above the ground
          actor.group.position.set(ox, gy, oz);
          actor.group.rotation.y=Math.atan2(player.pos.x-ox, player.pos.z-oz);  // ring faces spawn
          scene.add(actor.group);
          starGate={ actor, pos:new THREE.Vector3(ox,gy,oz), dest };
          spawnCuratorNearGate();
          if (typeof syncMissionWaypoint === 'function') syncMissionWaypoint();
        }
        function spawnCuratorNearGate(){
          if(!_AC || !starGate) return;
          const sp=_AC.get('curator');
          if(!sp) return;
          for(let i=critters.length-1;i>=0;i--) if(critters[i].sp && critters[i].sp.id==='curator') despawnCritter(i);
          const gx=Math.round(starGate.pos.x)-3, gz=Math.round(starGate.pos.z)+2;
          const top=surfaceTopVox(gx,gz);
          if(top===null) return;
          placeCritter(sp, gx, gz, top);
        }
        function updateStarGate(dt){
          if(!starGate) return;
          starGate.actor.anim(elapsed, 'idle', dt);
          const hintEl=document.getElementById('voxel-gate-hint');
          const near = !flying && Math.hypot(player.pos.x-starGate.pos.x, player.pos.z-starGate.pos.z) < GATE_REACH;
          if(hintEl){
            if(near){
              const dest=starGate.dest, AP=getProfileApi();
              const unlocked = dest && AP && AP.isUnlocked(AP.load(), dest.id);
              hintEl.hidden=false;
              hintEl.innerHTML = '⌾ Star Gate → '+dest.name+' · '+dest.nameDa
                + '<br><b>E</b> · ' + (unlocked ? 'step through' : 'power with a Gate Key');
            } else if(!flying) hintEl.hidden=true;   // while flying, the space map owns the hint
          }
        }
        function activateGate(){
          if(!starGate) return;
          const AP=getProfileApi(); if(!AP) return;
          const dest=starGate.dest; if(!dest) return;
          const prof=AP.load();
          if(!AP.isUnlocked(prof, dest.id)){
            if(getBackpackCount(GATE_KEY_ID) < 1){
              if(g.showMessage) g.showMessage('This gate is dormant. Craft a Gate Key (3× Crystal + Metal) to power it.', 3200);
              return;
            }
            spendFromInventory(GATE_KEY_ID, 1);
            AP.grantPlanet(prof, dest.id); AP.save(prof);
            if(g.showMessage) g.showMessage('Gate Key spent — the Star Gate roars to life!', 1800);
            try {
              const { beat } = AP.recordGateStory ? AP.recordGateStory(AP.load()) : {};
              if (beat) vxLangMsg(beat.en, beat.da, 3600);
            } catch (_) {}
          }
          // activation burst at the ring, then ride the travel chain
          if(_AC){ const p=starGate.pos;
            for(let k=0;k<26;k++){ const a=Math.random()*Math.PI*2, r=1.5+Math.random()*1.5;
              _AC.spark(new THREE.Vector3(p.x+Math.cos(a)*r, p.y+Math.sin(a)*r, p.z),
                0xc0b3ff, new THREE.Vector3(Math.cos(a)*2, Math.sin(a)*2, (Math.random()-.5)*2), 0.8, 0.12); } }
          playSfx('jetpack');
          travelToPlanet(dest.id);
        }

        function _pickWanderTarget(cr){
          const px=Math.floor(cr.pos.x), pz=Math.floor(cr.pos.z);
          const curTop=surfaceTopVox(px,pz);
          for(let tryN=0; tryN<5; tryN++){
            const a=Math.random()*Math.PI*2, d=2+Math.random()*5;
            const nx=px+Math.round(Math.cos(a)*d), nz=pz+Math.round(Math.sin(a)*d);
            const t=surfaceTopVox(nx,nz);
            if(t===null) continue;                                  // water — skip
            if(curTop!==null && Math.abs(t-curTop)>2) continue;     // cliff — skip
            cr.target=new THREE.Vector3(nx+0.5, 0, nz+0.5); return;
          }
          cr.target=null;                                           // boxed in → idle
        }

        // Flyers glide: keep a heading that curves slowly toward a forward-biased
        // wander bearing (never a hard reversal), and bank back when they drift too
        // far from the player — so skates/jellies sweep in smooth arcs, not darts.
        const FLYER_SPEED = { driftjelly:2.0, glowmoth:2.6, skate:3.6 };
        function updateFlyerGlide(cr, dt, startled, dxp, dzp){
          const sp=cr.sp;
          if(cr.heading==null) cr.heading = cr.face!=null ? cr.face : Math.random()*Math.PI*2;
          cr._retarget = (cr._retarget||0) - dt;
          if(cr._retarget<=0 || cr.tBear==null){
            cr._retarget = 2.5 + Math.random()*3.5;
            cr.tBear = cr.heading + (Math.random()-0.5)*3.0;       // ±~85° from current — gentle curve
          }
          let desired = cr.tBear, spd = FLYER_SPEED[sp.id] || 3.0;
          const distP = Math.hypot(dxp, dzp);
          if(sp.shy && startled){ desired = Math.atan2(dxp, dzp); spd *= 1.6; }   // shy flyers bolt away
          else if(distP > CRIT_DESPAWN*0.8){ desired = Math.atan2(-dxp, -dzp); }  // drifting away → bank home
          let dh = desired - cr.heading; while(dh>Math.PI)dh-=Math.PI*2; while(dh<-Math.PI)dh+=Math.PI*2;
          const maxTurn = (startled?2.2:1.0) * dt;                  // rad/s cap → smooth banking
          cr.heading += THREE.MathUtils.clamp(dh, -maxTurn, maxTurn);
          cr.pos.x += Math.sin(cr.heading)*spd*dt;
          cr.pos.z += Math.cos(cr.heading)*spd*dt;
          const t = surfaceTopVox(Math.floor(cr.pos.x), Math.floor(cr.pos.z));
          const groundY = (t!==null ? t+1 : SEA_LEVEL+1) + WORLD_OFFSET.y;
          cr.pos.y += (groundY + cr.flyH + Math.sin(elapsed*1.2+cr.phase)*0.5 - cr.pos.y) * Math.min(1, 2.5*dt);
          cr.face = cr.heading;
        }

        /* ===================== TRAINING FIELD ===================== *
         * A toggleable test range (Settings → Training field): a distance
         * ruler ahead + pinned creature dummies for trying weapon range,
         * scan-lock and damage. Plus a live readout of the equipped tool's
         * REAL numbers, so we can verify the gear-card stats match.        */
        let trainingField = null;
        function makeTrainLabel(text){
          const cv=document.createElement('canvas'); cv.width=128; cv.height=64;
          const c=cv.getContext('2d'); c.textAlign='center'; c.shadowColor='rgba(0,0,0,0.8)'; c.shadowBlur=5;
          c.font='bold 30px ui-monospace,Menlo,monospace'; c.fillStyle='#ffd45c'; c.fillText(text,64,40);
          const tex=new THREE.CanvasTexture(cv);
          const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false}));
          sp.scale.set(2.4,1.2,1); return sp;
        }
        function buildTrainingField(){
          clearTrainingField();
          const grp=new THREE.Group(); scene.add(grp);
          const yaw=player.yaw, fx=Math.sin(yaw), fz=Math.cos(yaw), rx=Math.cos(yaw), rz=-Math.sin(yaw);
          const ox=player.pos.x, oz=player.pos.z;
          const postGeo=new THREE.BoxGeometry(0.14,2.4,0.14);
          const postMat=new THREE.MeshStandardMaterial({color:0xffd45c,emissive:0x6a4a08,emissiveIntensity:0.6});
          [2,4,6,8,10,12,16,20].forEach(d=>{
            const px=ox+fx*d, pz=oz+fz*d, gy=shipGroundY(px,pz);
            const post=new THREE.Mesh(postGeo, postMat); post.position.set(px, gy+1.2, pz); grp.add(post);
            const lbl=makeTrainLabel(d+' m'); lbl.position.set(px, gy+2.9, pz); grp.add(lbl);
          });
          trainingField={ grp };
          // pinned dummies (off to one side) for scan + combat range tests
          const ids=['mosshorn','frostmane','glowmoth'];
          [4,8,12].forEach((d,i)=>{
            const px=Math.round(ox+fx*d+rx*3), pz=Math.round(oz+fz*d+rz*3);
            const top=surfaceTopVox(px,pz); if(top===null) return;
            const def=_AC && _AC.get(ids[i%ids.length]); if(!def) return;
            const cr=placeCritter(def, px, pz, top);
            if(cr){ cr.training=true; cr.hp=99999; cr.maxHp=99999; }
          });
          if(g.showMessage) g.showMessage('Training field placed ahead — markers + dummies', 2400);
        }
        function clearTrainingField(){
          for(let i=critters.length-1;i>=0;i--) if(critters[i].training) despawnCritter(i);
          if(!trainingField) return;
          scene.remove(trainingField.grp);
          trainingField.grp.traverse(o=>{ if(o.geometry)o.geometry.dispose();
            if(o.material){ if(o.material.map)o.material.map.dispose(); o.material.dispose(); } });
          trainingField=null;
        }
        let _trainHudShown = null;
        function updateTrainHud(){
          const el=document.getElementById('voxel-train-hud'); if(!el) return;
          if(!trainingField || !weaponDef){ el.hidden=true; _trainHudShown=null; return; }
          const gp=weaponGameplayFor(weaponDef.id);
          const mineR=currentAimReach().toFixed(1);
          const combR=Math.max(currentAimReach(),3.2).toFixed(1);
          el.hidden=false;
          const html='<b>🎯 TRAINING</b> · '+weaponDef.name+' '+TIER_NAME[weaponTierOf(weaponDef.id)]
            +'<br>combat reach <b>'+combR+'m</b> · mine reach <b>'+mineR+'m</b>'
            +'<br>damage <b>'+weaponDamage()+'</b> · mining <b>'+(gp.mining||0).toFixed(1)+'</b>/s · range '+(gp.range).toFixed(2)
            +'<br>scan range <b>'+scannerRange()+'m</b>';
          if(html !== _trainHudShown){ _trainHudShown = html; el.innerHTML = html; }   // rebuild DOM only on change
        }

        /* ===================== COMBAT ===================== *
         * Forgiving by design (kid-first): generous HP, slow regen, a
         * gentle respawn instead of a harsh loss. Wonder over war —
         * hostiles are rare and telegraphed by colour + alert pose.   */

        // Damage the player's weapon does, derived from its power stat.
        function weaponDamage(){
          if(!weaponDef) return 3;
          const gp = weaponGameplayFor(weaponDef.id);
          return Math.max(0, Math.round(gp.dmg || 0));   // minecutter = 0 (mining tool)
        }

        // Raycast for a creature under the crosshair within `maxDist`.
        // Reach is measured from the PLAYER (not the camera) so it matches the
        // mining aim and works in third-person, where the camera sits well back.
        function pickCombatCreature(maxDist){
          if(!creatureGroups.length) return null;
          ray.setFromCamera({x:0,y:0}, camera);
          const hits=ray.intersectObjects(creatureGroups, true);
          for(const h of hits){
            if(h.point.distanceTo(player.pos) > maxDist) continue;
            let o=h.object; while(o){ if(o.userData && o.userData.critter) return o.userData.critter; o=o.parent; }
          }
          return null;
        }

        function killCreature(cr){
          const i=critters.indexOf(cr); if(i<0) return;
          if(_AC){ const p=cr.group.position;
            for(let k=0;k<14;k++) _AC.spark(
              new THREE.Vector3(p.x+(Math.random()-.5),p.y+0.4+(Math.random()-.3),p.z+(Math.random()-.5)),
              cr.hostile?0xff7a2c:0xbfe07a,
              new THREE.Vector3((Math.random()-.5)*2.5,Math.random()*2.5,(Math.random()-.5)*2.5),0.7,0.12); }
          playSfx('wallBreak');
          despawnCritter(i);
        }

        // Player hits a creature. Peaceful ones bolt; all flash + can die.
        function damageCreature(cr, amt, dirx, dirz){
          cr.hp -= amt; cr.hurtT = 0.18;
          if(_AC){ const p=cr.group.position;
            for(let k=0;k<5;k++) _AC.spark(
              new THREE.Vector3(p.x,p.y+0.5,p.z),
              0xffd0a0, new THREE.Vector3((Math.random()-.5)*2,Math.random()*2,(Math.random()-.5)*2),0.4,0.08); }
          playSfx('wallChip');
          // knock back a touch + react
          cr.pos.x += dirx*0.35; cr.pos.z += dirz*0.35;
          cr.alert = 1;
          if(!cr.hostile){                                     // prey flees the hit
            cr.target=new THREE.Vector3(cr.pos.x+dirx*9, 0, cr.pos.z+dirz*9);
            cr.state='walk'; cr.timer=1.2;
          }
          if(cr.hp<=0) killCreature(cr);
        }

        // Player takes a hit. Knockback + i-frames + red flash; gentle respawn at 0.
        function applyPlayerDamage(amt, dirx, dirz){
          if(player.invuln>0 || player.health<=0) return;
          player.health = Math.max(0, player.health - amt);
          player.invuln = 0.9; player.hurtFlash = 1; player._noHitT = 0;
          player.knock.set(dirx*8, 0, dirz*8); player.vel.y += 2.5;
          playSfx('wallBreak');
          if(player.health<=0) respawnPlayer();
        }

        function respawnPlayer(){
          player.pos.copy(_spawnPos); player.vel.set(0,0,0);
          player.health = player.maxHealth; player.invuln = 1.4; player.hurtFlash = 0;
          if(g.showMessage) g.showMessage('Phew! Back to safe ground.', 2000);
        }

        function updatePlayerCombat(dt){
          if(player.invuln>0) player.invuln=Math.max(0,player.invuln-dt);
          if(player.hurtFlash>0) player.hurtFlash=Math.max(0,player.hurtFlash-dt*2.2);
          // slow regen once you've been safe for a few seconds
          player._noHitT += dt;
          if(player._noHitT>4 && player.health<player.maxHealth)
            player.health = Math.min(player.maxHealth, player.health + dt*6);
          updateHealthHud();
        }

        let _heartsCache=-1, _heartsEl=null, _flashEl=null;
        function updateHealthHud(){
          if(!_heartsEl) _heartsEl=document.getElementById('voxel-hearts');
          if(!_flashEl) _flashEl=document.getElementById('voxel-hurt-flash');
          if(_heartsEl){
            const totalHalf=Math.round(player.health / (player.maxHealth/10));  // 5 hearts, half-steps
            if(totalHalf!==_heartsCache){
              _heartsCache=totalHalf;
              let html='';
              for(let i=0;i<5;i++){ const left=totalHalf-i*2;
                html+='<span class="vx-heart '+(left>=2?'full':(left===1?'half':'empty'))+'"></span>'; }
              _heartsEl.innerHTML=html;
            }
          }
          if(_flashEl) _flashEl.style.opacity=(player.hurtFlash*0.7).toFixed(3);
        }

        // Run the wander/approach/attack FSM for one hostile. Returns {moving,speed}.
        function updateHostile(cr, dt, dxp, dzp, distP){
          const sp=cr.sp, aggro=sp.aggro||16, atkR=sp.atkRange||2.2;
          cr.atkCd=Math.max(0,(cr.atkCd||0)-dt);
          let moving=false, speed=sp.speed||3.2;
          const dy = player.pos.y - cr.pos.y;                   // vertical gap (fly up to escape)
          if(distP < aggro){                                    // aggroed: hunt the player
            cr.face=Math.atan2(-dxp,-dzp);                      // look at player
            // Strike only with clear line of sight — roofs and closed doors protect.
            if(distP <= atkR && Math.abs(dy) < 2.6 && !vxSettings.peaceful && hasCreatureLineOfSight(cr)){
              if(cr.atkCd<=0){
                const inv=1/(distP||1);
                applyPlayerDamage(sp.dmg||10, -dxp*inv, -dzp*inv);
                cr.atkCd=sp.atkCd||1.3;
                playSfx('swordSwing');
              }
            } else {                                            // close the distance (ground)
              const inv=1/(distP||1), step=speed*dt;
              const nx=cr.pos.x - dxp*inv*step, nz=cr.pos.z - dzp*inv*step;
              if(tryCreatureStep(cr, nx, nz, false, dt)) moving=true;
            }
          } else {                                              // out of range: wander like prey
            if(cr.state==='idle'){ cr.timer-=dt;
              if(cr.timer<=0){ cr.state='walk'; cr.timer=1.5+Math.random()*3; _pickWanderTarget(cr); }
            } else { cr.timer-=dt; if(!cr.target||cr.timer<=0){ cr.state='idle'; cr.timer=1+Math.random()*2; cr.target=null; } }
            if(cr.target){
              const dx=cr.target.x-cr.pos.x, dz=cr.target.z-cr.pos.z, d=Math.hypot(dx,dz);
              if(d<0.25){ cr.target=null; }
              else { const inv=1/d, st=Math.min(d,speed*0.6*dt);
                const nx=cr.pos.x+dx*inv*st, nz=cr.pos.z+dz*inv*st;
                if(!tryCreatureStep(cr, nx, nz, false, dt)) cr.target=null;
                else { cr.face=Math.atan2(dx,dz); moving=true; } }
            }
          }
          return {moving, speed, aggroed:(distP<aggro)};
        }

        // Rare "prowling" hostile spawner — danger is special, not constant.
        // At night, updateNightSpawner takes over with a short staggered burst instead.
        let _hostileTimer = 18;
        function countHostiles(){ let n=0; for(const c of critters) if(c.hostile) n++; return n; }
        function despawnHostiles(){ for(let i=critters.length-1;i>=0;i--) if(critters[i].hostile) despawnCritter(i); }
        function spawnProwlerNearPlayer(quiet){
          if(!_AC) return false;
          const prowlers=_AC.DEFS.filter(d=>d.prowl);
          if(!prowlers.length) return false;
          const sp=prowlers[(Math.random()*prowlers.length)|0];
          const px=Math.floor(player.pos.x), pz=Math.floor(player.pos.z);
          for(let tryN=0; tryN<8; tryN++){
            const ang=Math.random()*Math.PI*2, r=CRIT_MIN+Math.random()*(CRIT_VIEW-CRIT_MIN);
            const vx=px+Math.round(Math.cos(ang)*r), vz=pz+Math.round(Math.sin(ang)*r);
            const top=surfaceTopVox(vx,vz);
            if(top===null) continue;
            placeCritter(sp, vx, vz, top);
            if(!quiet) vxLangMsg('Something is prowling nearby…', 'Noget sniger sig omkring…', 1800);
            return true;
          }
          return false;
        }
        function maybeSpawnHostile(dt){
          if(!_AC || vxSettings.peaceful) return;   // Peaceful mode: no prowlers
          if(_dayPhase === 'night' || _dayPhase === 'dusk') return; // night queue owns this
          _hostileTimer-=dt;
          if(_hostileTimer>0) return;
          _hostileTimer = 14 + Math.random()*16;
          if(countHostiles()>=1) return;          // at most one prowler at a time by day
          if(Math.random()>0.55) return;          // ...and only sometimes
          spawnProwlerNearPlayer(false);
        }
        function updateNightSpawner(dt){
          if(_dayPhase !== 'night' || vxSettings.peaceful || !_AC) return;
          if(_nightSpawnLeft <= 0) return;
          _nightSpawnTimer -= dt;
          if(_nightSpawnTimer > 0) return;
          _nightSpawnTimer = 1.5 + Math.random() * 1.4;
          if(countHostiles() >= 3){ _nightSpawnLeft = 0; return; }
          if(spawnProwlerNearPlayer(_nightSpawnLeft < 3)) _nightSpawnLeft--;
          else _nightSpawnTimer = 0.6;             // retry sooner if no land found
        }

        function updateCritters(dt){
          if(!CRITTERS_ENABLED){ if(critters.length) clearCritters(); return; }
          // maintain population — pause peaceful refill at night so prowlers use the budget
          _critTimer-=dt;
          if(_critTimer<=0){
            _critTimer=0.6;
            if(critters.length<CRIT_CAP && _dayPhase !== 'night') spawnOneCritter();
          }
          maybeSpawnHostile(dt);
          for(let i=critters.length-1;i>=0;i--){
            const cr=critters[i];
            if(cr.training){                          // pinned test dummy: stay put, face player, no AI/despawn
              cr.group.position.copy(cr.pos);
              const fyaw=Math.atan2(player.pos.x-cr.pos.x, player.pos.z-cr.pos.z)+(cr.sp.faceYaw||0);
              let dd=fyaw-cr.group.rotation.y; while(dd>Math.PI)dd-=Math.PI*2; while(dd<-Math.PI)dd+=Math.PI*2;
              cr.group.rotation.y+=dd*(1-Math.exp(-8*dt));
              if(cr.hurtT>0) cr.hurtT-=dt;
              cr.actor.anim(elapsed, cr.hurtT>0?'alert':'idle', dt);
              continue;
            }
            const fly=cr.sp.fly;
            const dxp=cr.pos.x-player.pos.x, dzp=cr.pos.z-player.pos.z;
            const distP=Math.hypot(dxp,dzp);
            if(distP>CRIT_DESPAWN){ despawnCritter(i); continue; }
            let moving=false, speed=fly?CRIT_SPEED*2.2:CRIT_SPEED;
            if(cr.hurtT>0) cr.hurtT-=dt;
            if(cr.hostile){
              const r=updateHostile(cr,dt,dxp,dzp,distP);
              moving=r.moving;
              cr.alert += ((r.aggroed ? 1 : 0) - cr.alert) * (1 - Math.exp(-9*dt));
            } else {
              // alert when the player is close; shy critters also flee
              const startled = distP < CRIT_FLEE;
              cr.alert += ((startled ? 1 : 0) - cr.alert) * (1 - Math.exp(-9*dt));
              if(fly){
                updateFlyerGlide(cr, dt, startled, dxp, dzp);   // smooth gliding arcs
                moving = true;
              } else {
                if(cr.sp.shy && startled){
                  const inv=1/(distP||1);
                  cr.target=new THREE.Vector3(cr.pos.x+dxp*inv*8, 0, cr.pos.z+dzp*inv*8);
                  cr.state='walk'; speed=CRIT_SPEED*1.8; cr.timer=0.6;
                }
                if(cr.state==='idle'){
                  cr.timer-=dt;
                  if(cr.timer<=0){ cr.state='walk'; cr.timer=1.5+Math.random()*3; _pickWanderTarget(cr); }
                } else {
                  cr.timer-=dt;
                  if(!cr.target || cr.timer<=0){ cr.state='idle'; cr.timer=1+Math.random()*2.5; cr.target=null; }
                }
                if(cr.target){
                  const dx=cr.target.x-cr.pos.x, dz=cr.target.z-cr.pos.z, d=Math.hypot(dx,dz);
                  if(d<0.25){ cr.target=null; cr.state='idle'; cr.timer=1+Math.random()*2; }
                  else {
                    const step=Math.min(d, speed*dt), inv=1/d;
                    const nx=cr.pos.x+dx*inv*step, nz=cr.pos.z+dz*inv*step;
                    if(!tryCreatureStep(cr, nx, nz, true, dt)) cr.target=null;  // water / wall / roof
                    else { cr.face=Math.atan2(dx,dz); moving=true; }
                  }
                }
              }
            }
            // drive the Actor: smooth face toward heading (+per-species mesh offset), set state, animate.
            // Flyers turn gentler so flat-bodied ones (skate, jelly) bank around rather than
            // whipping through an edge-on profile (which read as a flicker).
            cr.group.position.copy(cr.pos);
            let d=(cr.face+(cr.sp.faceYaw||0))-cr.group.rotation.y;
            while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2;
            cr.group.rotation.y += d*(1-Math.exp(-(fly?4.5:(cr.sp.longBody?5.5:10))*dt));
            const actorState = (cr.alert>0.5 || cr.hurtT>0) ? 'alert' : (moving ? 'move' : 'idle');
            cr.actor.anim(elapsed, actorState, dt);
          }
        }

        // Scan raycast against creatures; returns the aimed critter or null.
        // Soft-aim creature pick: instead of a pixel-perfect mesh ray, grab the
        // creature nearest the crosshair LINE within a forgiving cone (widens with
        // distance), so small / moving animals are easy to lock for scanning.
        const _pcO=new THREE.Vector3(), _pcD=new THREE.Vector3(), _pcV=new THREE.Vector3();
        function pickCreature(){
          if(!critters.length) return null;
          ray.setFromCamera({x:0,y:0}, camera);
          _pcO.copy(ray.ray.origin); _pcD.copy(ray.ray.direction);
          let best=null, bestScore=Infinity;
          const maxR=scannerRange();
          for(const cr of critters){
            _pcV.set(cr.pos.x - _pcO.x, (cr.pos.y+0.6) - _pcO.y, cr.pos.z - _pcO.z);
            const dist=_pcV.length();
            if(dist>maxR) continue;
            const t=_pcV.dot(_pcD);                 // projection along the aim ray
            if(t<=0) continue;                       // behind the camera
            const perp=Math.sqrt(Math.max(0, dist*dist - t*t));   // distance from ray to creature centre
            const tol=1.3 + dist*0.07;               // generous, a touch wider far away
            if(perp>tol) continue;
            const score=perp + dist*0.04;            // prefer on-axis, then nearer
            if(score<bestScore){ bestScore=score; best=cr; }
          }
          return best;
        }
        let _scanCreatureId=null;
        function fillCreatureScanContent(sp, expanded){
          const pseudo={ cat:sp.cat, name:sp.name, desc:sp.desc, tags:[sp.sci.kingdom||'Animal'],
            hardness:'—', sci:{ formula:sp.sci.formula, mineral:sp.sci.kingdom, fact:sp.sci.fact } };
          fillScanPanelContent(pseudo, sp.scanOn||1, 0, expanded);
        }
        function recordCreatureScan(sp){
          const AP=getProfileApi(); if(!AP || !AP.recordCreature) return;
          const { isNew, completed }=AP.recordCreature(AP.load(), sp.id);
          if(isNew){ updateJournalHud(); if(g.showMessage) g.showMessage('Creature discovered: '+sp.name, 1800); }
          else if(completed) updateJournalHud();
          if(completed && g.showMessage) g.showMessage('Survey complete: '+completed.title, 2800);
        }

        // ===================== TNT / explosives =====================
        // Placed TNT is just block id 45 in the grid (cells carry no per-instance state),
        // so we track live charges in a Set and keep fuse state in a side Map. The primed
        // "flash" is a separate overlay mesh, so the chunk mesher is never touched.
        const TNT_ID = 45;
        const FLUID_IDS = new Set([38, 39, 40, 42]);    // lava, acid, water, lava flow — spared by blasts
        const tntBlocks = new Set();                    // "x,y,z" (voxel coords) of placed TNT
        const primedTnt = new Map();                    // "x,y,z" -> {x,y,z,t,overlay}
        const blastFlashes = [];                        // {m,t,life,r} expanding additive fireballs
        const smokePuffs = [];                          // {m,t,life,vy,grow} rising grey smoke
        const blastDebris = [];                         // {m,v,t,life,spin} tumbling block chunks
        const _dbgGeo = new THREE.BoxGeometry(1,1,1);   // shared unit cube for debris (scaled per chunk)

        // Blast persistence is coalesced across a whole detonation. A chain (or a Remote
        // Detonator field) fires many explodeAt calls within a few frames; load+saving the
        // full profile and re-rendering the hotbar PER explosion is what makes mass
        // detonations lag. Instead each explosion buffers its cell edits + salvage, and a
        // short debounce commits everything with ONE profile load+save and one inventory
        // pass. Cells are already written to the live grid immediately, so gameplay and
        // visuals don't wait on this.
        let _blastEditBuf = [];
        const _blastLootBuf = new Map();
        let _blastCommitT = null;
        function scheduleBlastCommit(){
          if(_blastCommitT) return;                     // first explosion of a burst arms it
          _blastCommitT = setTimeout(commitBlast, 220);
        }
        function commitBlast(){
          _blastCommitT = null;
          const AP = getProfileApi();
          if(AP && !_suppressProfileBlockSave && _blastEditBuf.length){
            const p = AP.load();
            if(AP.upsertBlockEdits) AP.upsertBlockEdits(p, _blastEditBuf);
            else for(const e of _blastEditBuf) AP.upsertBlockEdit(p, e.x, e.y, e.z, e.id);
            AP.save(p);
          }
          _blastEditBuf = [];
          if(_blastLootBuf.size){                        // one addToInventory per block type total
            for(const [id,n] of _blastLootBuf) addToInventory(id, n);
            _blastLootBuf.clear();
          }
        }
        let camShake = 0;                               // screen-shake magnitude, decayed in updateCamera
        const _tntKey = (x,y,z) => x + ',' + y + ',' + z;

        // A blast never removes liquids or explicitly-unminable blocks (lava lakes and
        // bedrock-like props survive); every other solid is fair game.
        function blastProof(id){
          if(id===0 || FLUID_IDS.has(id)) return true;
          const b = blockById(id);
          return !!(b && b.tags && (b.tags.indexOf('unminable')>=0 || b.tags.indexOf('liquid')>=0));
        }

        // Track placed/removed TNT so the Remote Detonator and lava-ignition know where the
        // charges are. Called from setBlockEvent on every world edit.
        function registerTntBlock(x,y,z,id){
          const k=_tntKey(x,y,z);
          if(id===TNT_ID){ tntBlocks.add(k); return; }
          if(tntBlocks.has(k)){
            tntBlocks.delete(k);
            const pr=primedTnt.get(k);
            if(pr){ if(pr.overlay) scene.remove(pr.overlay); primedTnt.delete(k); }
          }
        }

        // Light a placed TNT's fuse: spawn a white flash overlay that pulses for `fuse`
        // seconds, then explodes (updateTnt drives the countdown). No-op if the cell isn't
        // TNT or is already primed (stops a chain reaction re-lighting the same block).
        function igniteTnt(x,y,z,fuse){
          if(getBlock(x,y,z)!==TNT_ID) return;
          const k=_tntKey(x,y,z);
          if(primedTnt.has(k)) return;
          tntBlocks.add(k);
          const m=new THREE.Mesh(
            new THREE.BoxGeometry(1.08,1.08,1.08),
            new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.0,
              blending:THREE.AdditiveBlending, depthWrite:false}));
          m.position.set(x+0.5+WORLD_OFFSET.x, y+0.5+WORLD_OFFSET.y, z+0.5+WORLD_OFFSET.z);
          scene.add(m);
          primedTnt.set(k, {x,y,z, t:(fuse||1.5), overlay:m});
          playSfx('fuse');
        }

        // The blast. Removes every non-liquid solid within `radius` of the voxel center,
        // banking 100% of it into the backpack, chain-lights any TNT it touches, launches
        // the player (no damage — kid-forgiving) and splash-damages creatures. Writes are
        // batched like floodWaterAfterMine: one profile save + one mesh rebuild per column,
        // and salvage is tallied then added once per block type (not per cell) so a big
        // blast doesn't rebuild the hotbar hundreds of times.
        function explodeAt(cx,cy,cz,radius){
          radius = radius || 4;
          const rc = Math.round(radius), r2 = radius*radius;
          const cols = new Set();
          const addCol=(x,z)=> cols.add(_fdiv(x,CH)+','+_fdiv(z,CH));
          const loot = new Map();                     // block id -> count mined this blast (for debris color + salvage)
          for(let dx=-rc; dx<=rc; dx++) for(let dy=-rc; dy<=rc; dy++) for(let dz=-rc; dz<=rc; dz++){
            if(dx*dx+dy*dy+dz*dz > r2) continue;
            const x=cx+dx, y=cy+dy, z=cz+dz;
            if(y<0 || y>=H) continue;
            const id=getBlock(x,y,z);
            if(id===0) continue;
            const isCenter = (dx===0 && dy===0 && dz===0);
            if(id===TNT_ID && !isCenter){ igniteTnt(x,y,z, 0.06+Math.random()*0.12); continue; }  // chain
            if(blastProof(id)) continue;
            if(id!==TNT_ID){                                         // salvage every block destroyed
              const lootId = (id === DOOR_OPEN) ? DOOR_CLOSED : id;
              loot.set(lootId, (loot.get(lootId)||0) + 1);
            }
            const ccx=_fdiv(x,CH), ccz=_fdiv(z,CH);
            const c=ensureCol(ccx,ccz);
            c[cIdx(x-ccx*CH, y, z-ccz*CH)] = 0;
            recordEdit(x,y,z,0);
            registerLampCell(x,y,z,0);
            _blastEditBuf.push({x:pmod(x), y, z:pmod(z), id:0});   // committed together after the burst
            addCol(x,z);
            const lx=_mod(x,CH), lz=_mod(z,CH);
            if(lx===0) addCol(x-1,z); if(lx===CH-1) addCol(x+1,z);
            if(lz===0) addCol(x,z-1); if(lz===CH-1) addCol(x,z+1);
          }
          // Remesh through the time-budgeted queue (like floodWaterAfterMine) instead of
          // synchronously — a blast can touch ~9 full columns, and rebuilding them all in
          // one frame is the explosion's main lag spike. Queuing spreads the cost across
          // frames and dedups columns hit by chained blasts.
          for(const ck of cols){ const a=ck.split(','); queueRebuildCol(+a[0], +a[1]); }
          // Buffer the haul; committed once for the whole burst (see commitBlast).
          for(const [id,n] of loot) _blastLootBuf.set(id, (_blastLootBuf.get(id)||0) + n);
          scheduleBlastCommit();

          // ---- FX (render space = voxel + WORLD_OFFSET) ----
          const wx=cx+0.5+WORLD_OFFSET.x, wy=cy+0.5+WORLD_OFFSET.y, wz=cz+0.5+WORLD_OFFSET.z;
          const flash=new THREE.Mesh(
            new THREE.SphereGeometry(1,10,10),
            new THREE.MeshBasicMaterial({color:0xffca6a, transparent:true, opacity:0.9,
              blending:THREE.AdditiveBlending, depthWrite:false}));
          flash.position.set(wx,wy,wz); flash.scale.setScalar(0.6); scene.add(flash);
          blastFlashes.push({m:flash, t:0, life:0.45, r:radius});
          for(let i=0;i<3;i++) burst(wx+(Math.random()-.5)*radius, wy+(Math.random()-.5)*radius, wz+(Math.random()-.5)*radius, i%2?0xff8a2c:0x2a2a2a);
          if(_AC) for(let k=0;k<12;k++) _AC.spark(
            new THREE.Vector3(wx,wy,wz), k%3?0xffb347:0xff5a1e,
            new THREE.Vector3((Math.random()-.5)*8, Math.random()*7, (Math.random()-.5)*8), 0.6+Math.random()*0.4, 0.14);

          // rising smoke: soft grey puffs that balloon and drift up as they fade.
          // Soft global cap so a chain reaction can't pile up hundreds of live meshes.
          const smokeN = Math.min(14, Math.max(0, 60 - smokePuffs.length), 6 + Math.round(radius*2));
          for(let i=0;i<smokeN;i++){
            const shade = 0x2a2a2e + ((Math.random()*0x18)|0)*0x010101;
            const m=new THREE.Mesh(_dbgGeo, new THREE.MeshBasicMaterial({color:shade, transparent:true, opacity:0.55, depthWrite:false}));
            const s0=0.7+Math.random()*0.9; m.scale.setScalar(s0);
            m.position.set(wx+(Math.random()-.5)*radius*1.1, wy+(Math.random()-.2)*radius*0.7, wz+(Math.random()-.5)*radius*1.1);
            m.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);
            scene.add(m);
            smokePuffs.push({m, t:0, life:0.9+Math.random()*0.8, vy:1.1+Math.random()*1.4, grow:1.6+Math.random()*1.8, s0});
          }
          // chunky debris: cubes flung outward, colored by whatever was blown up (tumbling,
          // gravity). Soft global cap so chained blasts stay smooth.
          const lootIds = [...loot.keys()];
          const debrisN = Math.min(20, Math.max(0, 120 - blastDebris.length), 10 + Math.round(radius*2));
          for(let i=0;i<debrisN;i++){
            const bid = lootIds.length ? lootIds[(Math.random()*lootIds.length)|0] : 0;
            const col = bid ? blockColor(bid) : 0x6a6660;
            const m=new THREE.Mesh(_dbgGeo, new THREE.MeshBasicMaterial({color:col}));
            const s=0.12+Math.random()*0.22; m.scale.setScalar(s);
            m.position.set(wx+(Math.random()-.5)*1.4, wy+(Math.random()-.3)*1.4, wz+(Math.random()-.5)*1.4);
            m.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);
            scene.add(m);
            const ang=Math.random()*Math.PI*2, sp=4+Math.random()*7;
            blastDebris.push({ m,
              v:new THREE.Vector3(Math.cos(ang)*sp, 5+Math.random()*6, Math.sin(ang)*sp),
              spin:new THREE.Vector3((Math.random()-.5)*12,(Math.random()-.5)*12,(Math.random()-.5)*12),
              t:0, life:1.1+Math.random()*0.7 });
          }
          playSfx('explosion');
          camShake = Math.min(0.6, camShake + 0.42);

          // player: harmless launch (deliberately no applyPlayerDamage)
          const pdx=player.pos.x-wx, pdy=player.pos.y-wy, pdz=player.pos.z-wz;
          const pd=Math.hypot(pdx,pdy,pdz);
          if(pd < radius+2){
            const inv=1/(pd||1), force=(1 - pd/(radius+2))*12;
            player.knock.x += pdx*inv*force; player.knock.z += pdz*inv*force;
            player.vel.y = Math.max(player.vel.y, 4 + force*0.5);
          }
          // creatures: splash damage + knockback, falling off with distance
          for(let i=critters.length-1; i>=0; i--){
            const cr=critters[i]; if(!cr || !cr.pos) continue;
            const ddx=cr.pos.x-wx, ddy=cr.pos.y-wy, ddz=cr.pos.z-wz;
            const cd=Math.hypot(ddx,ddy,ddz);
            if(cd < radius+1.5){
              const inv=1/(Math.hypot(ddx,ddz)||1);
              const dmg=Math.round((1 - cd/(radius+1.5))*60) + 10;
              damageCreature(cr, dmg, ddx*inv, ddz*inv);
            }
          }
        }

        // Remote Detonator: light every placed TNT, staggered so a field of charges
        // ripples instead of firing in one frame.
        function detonateAllArmed(){
          let n=0;
          for(const k of [...tntBlocks]){
            const a=k.split(','); const x=+a[0], y=+a[1], z=+a[2];
            if(getBlock(x,y,z)!==TNT_ID){ tntBlocks.delete(k); continue; }
            igniteTnt(x,y,z, 0.05 + (n++)*0.03);
          }
          if(n){ playSfx('shoot'); if(g.showMessage) g.showMessage('💥 Detonator armed — '+n+' charge'+(n>1?'s':'')+'!', 1100); }
          else if(g.showMessage) g.showMessage('No TNT placed to detonate.', 1200);
        }

        // Per-frame: pulse primed overlays, count fuses down → explode; step flash spheres.
        function updateTnt(dt){
          for(const [k,pr] of primedTnt){
            pr.t -= dt;
            if(pr.overlay){
              pr.overlay.material.opacity = 0.35 + 0.4*Math.abs(Math.sin(pr.t*18));   // flashes faster near 0
              pr.overlay.scale.setScalar(1 + (1-Math.max(0,Math.min(1,pr.t/1.5)))*0.25);
            }
            if(pr.t<=0){
              if(pr.overlay) scene.remove(pr.overlay);
              primedTnt.delete(k); tntBlocks.delete(k);
              explodeAt(pr.x, pr.y, pr.z, 4);
            }
          }
          for(let i=blastFlashes.length-1;i>=0;i--){
            const f=blastFlashes[i]; f.t+=dt;
            const kf=f.t/f.life;
            if(kf>=1){ scene.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); blastFlashes.splice(i,1); continue; }
            f.m.scale.setScalar(0.6 + kf*f.r*1.4);
            f.m.material.opacity = 0.9*(1-kf);
          }
          for(let i=smokePuffs.length-1;i>=0;i--){
            const s=smokePuffs[i]; s.t+=dt;
            const ks=s.t/s.life;
            if(ks>=1){ scene.remove(s.m); s.m.material.dispose(); smokePuffs.splice(i,1); continue; }
            s.vy *= (1 - 0.6*dt);                          // drag as it rises
            s.m.position.y += s.vy*dt;
            s.m.scale.setScalar(s.s0 + ks*s.grow);          // balloons outward
            s.m.rotation.y += dt*0.4;
            s.m.material.opacity = 0.55*(1-ks);
          }
          for(let i=blastDebris.length-1;i>=0;i--){
            const d=blastDebris[i]; d.t+=dt;
            if(d.t>=d.life){ scene.remove(d.m); d.m.material.dispose(); blastDebris.splice(i,1); continue; }
            d.v.y -= 16*dt;                                 // gravity
            d.m.position.addScaledVector(d.v, dt);
            d.m.rotation.x += d.spin.x*dt; d.m.rotation.y += d.spin.y*dt; d.m.rotation.z += d.spin.z*dt;
            const kd=d.t/d.life;
            if(kd>0.7){ d.m.material.transparent=true; d.m.material.opacity=1-(kd-0.7)/0.3; }  // fade out at the end
          }
        }

        // Auto-ignite: any placed TNT touching lava lights on its own. Cheap — tntBlocks
        // is small — so it runs once per rendered frame.
        function checkLavaIgnition(){
          if(!tntBlocks.size) return;
          const NB=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
          for(const k of tntBlocks){
            if(primedTnt.has(k)) continue;
            const a=k.split(','); const x=+a[0], y=+a[1], z=+a[2];
            for(const d of NB){ const b=getBlock(x+d[0],y+d[1],z+d[2]); if(b===38||b===42){ igniteTnt(x,y,z,1.0); break; } }
          }
        }

        function tick(dt) {
            // The fixed-step accumulator can call tick() several times inside ONE
            // rendered frame when frames run long. Heavy / idempotent per-frame work
            // (streaming, the meshing budget, DOM writes, aim visuals) must run once
            // per RENDERED frame, or its cost multiplies exactly when the game is
            // already struggling. `newFrame` is true only on the first tick of a frame.
            const newFrame = _rafId === null || _rafFrame !== _lastTickFrame;
            if (newFrame) _lastTickFrame = _rafFrame;
            const frameDt = Math.min(0.1, _rafFrameMs / 1000);   // real seconds since last rendered frame
            if (g.keys) Object.assign(keys, g.keys);
            if (newFrame) {
                _hideLegacyEnvironment();
                if (g._hideLegacyPlayUI) g._hideLegacyPlayUI();
                // stream chunks from where the player is heading; build harder the
                // closer they are (in seconds, at current speed) to unbuilt land
                trackPlayerVelocity(frameDt);
                const sc = streamCenterAhead();
                streamAround(sc.x, sc.z);
                const buildMs = processBuildQueue(streamBudgetMs());
                adaptQuality(frameDt, buildMs);   // auto-tune view distance to hold a smooth frame rate
                updateFogFrontier(frameDt);       // fog wall tracks the built frontier (hides all pop-in)
                updateSky(frameDt);
                updateClouds(frameDt);
                updateWater(frameDt);
            }
            updateDayNight(dt);                // integrates game time — keep per fixed step
            if (_doorToggleCd > 0) _doorToggleCd = Math.max(0, _doorToggleCd - dt);
            updateLampLights(dt);
            elapsed += dt;
            if(flying){ updateFlight(dt); }
            else {
            // --- movement intent in camera space ---
            let ix=0,iz=0;
            if(keys.KeyW||keys.ArrowUp) iz-=1;
            if(keys.KeyS||keys.ArrowDown) iz+=1;
            if(keys.KeyA||keys.ArrowLeft) ix-=1;
            if(keys.KeyD||keys.ArrowRight) ix+=1;
            const shiftHeld = !!(keys.ShiftLeft || keys.ShiftRight);
            focusAimBlend += ((shiftHeld ? 1 : 0) - focusAimBlend) * (1 - Math.exp(-12 * dt));
            // --- crouch (⌘ Cmd / Ctrl / X): shorter hitbox, slower walk, sneak edge-guard ---
            const ctrlHeld = !!(keys.MetaLeft || keys.MetaRight || keys.ControlLeft || keys.ControlRight || keys.KeyX);
            const wasCrouch = player.crouch;
            if (ctrlHeld) {
                player.crouch = true;
            } else if (player.crouch) {
                player.height = PLAYER_STAND_H;    // only stand back up with headroom
                if (boxCollides(player.pos.x, player.pos.y, player.pos.z)) player.height = PLAYER_CROUCH_H;
                else player.crouch = false;
            }
            if (player.crouch) player.height = PLAYER_CROUCH_H;
            if (player.crouch !== wasCrouch && g.showMessage) {
                g.showMessage(player.crouch ? '🦆 Sneak on' : 'Sneak off', 900);
            }
            crouchBlend += ((player.crouch ? 1 : 0) - crouchBlend) * (1 - Math.exp(-14 * dt));
            const speed = THREE.MathUtils.lerp(MOVE_RUN_SPEED, MOVE_ADS_SPEED, focusAimBlend)
                * THREE.MathUtils.lerp(1, MOVE_CROUCH_MULT, crouchBlend);
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
            const wasGrounded=player.grounded;
            player.grounded=false;
            let thrusting=false;
            const inWater = playerInWater();
            if(inWater){
                // swim: gentle buoyancy + viscous drag, hold Space to rise, never drowns
                if(keys.Space) player.vel.y += 26*dt; else player.vel.y -= 7*dt;
                player.vel.y -= player.vel.y * Math.min(1, 3.2*dt);
                player.vel.y = Math.max(-3.2, Math.min(4.2, player.vel.y));
                mvx *= 0.6; mvz *= 0.6;                     // slower through water
            } else {
                player.vel.y -= 22*_gravMul*dt;            // per-planet gravity
                if(keys.Space){
                    if(wasGrounded) player.vel.y = jetBoost ? 11 : 8.5;   // jump (floatier on low-g worlds)
                    else {                                  // B-boost: rocket up to space fast
                        const climbAcc = jetBoost ? 80 : 40, climbMax = jetBoost ? 17 : 5.5;
                        player.vel.y = Math.min(player.vel.y+climbAcc*dt, climbMax);
                        thrusting=true;
                    }
                }
                player.vel.y = Math.max(player.vel.y, -28*_gravMul);
                if(jetBoost && !player.grounded){ mvx*=1.7; mvz*=1.7; }   // faster horizontal flight too
            }
            const hv=new THREE.Vector3(mvx+player.knock.x,0,mvz+player.knock.z);
            player.knock.x -= player.knock.x*Math.min(1,6*dt);   // decay knockback shove
            player.knock.z -= player.knock.z*Math.min(1,6*dt);
            // sneak edge-guard: while crouched on the ground you can't walk off a ledge
            if (player.crouch && wasGrounded && !inWater) {
                const p = player.pos;
                if (hv.x && !hasGroundBelow(p.x + hv.x*dt, p.y, p.z)) hv.x = 0;
                if (hv.z && !hasGroundBelow(p.x + hv.x*dt, p.y, p.z + hv.z*dt)) hv.z = 0;
            }
            moveAxis('x', hv.x*dt);
            moveAxis('z', hv.z*dt);
            moveAxis('y', player.vel.y*dt);
            const sp=Math.hypot(mvx,mvz);
            player.state = !player.grounded ? (thrusting ? 'fly' : 'air')
                : sp < 0.3 ? 'idle' : 'run';
            if (player.grounded && sp > 0.35 && g.audio && g.audio.footstep) {
                g.audio.footstep(0.32);
            }
            jetpackSfxCd -= dt;
            if (thrusting && !player.grounded && jetpackSfxCd <= 0) {
                playSfx('jetpack');
                jetpackSfxCd = 0.14;
            }
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
            tickSwordSwingLock(dt);
            updateLaserHoldFire(dt);
            updateWeaponFx();
            if(matAnim){
                matAnim.map.offset.x=(((elapsed*5)|0)%4)*0.25;
                const p=0.9+0.1*Math.sin(elapsed*4); matAnim.color.setRGB(p,p,p);
            }
            if(decoMat&&decoMat.userData.shader) decoMat.userData.shader.uniforms.uTime.value=elapsed;
            if (newFrame) {                    // crosshair pick + aim/scan visuals: once per rendered frame
            const t = pickTarget();
            updateAimEdgeHighlight(t);
            updateMineBlockAnim();
            updatePlaceGhost(t);
            updateBlockScan(t);
            updateFormulaViewer(frameDt);
            const targetNameEl = document.getElementById('voxel-target-name');
            if (targetNameEl) {
                const scanOpen = scanExpanded || (canScanBlocks() && focusAimBlend > 0.35
                    && t && getBlock(t.x, t.y, t.z));
                if (scanOpen) {
                    targetNameEl.textContent = '';
                } else if (t && getBlock(t.x, t.y, t.z) && isMiningTool()) {
                    const b = blockById(getBlock(t.x, t.y, t.z));
                    const crack = mineTarget && mineTarget.x === t.x && mineTarget.y === t.y && mineTarget.z === t.z
                        ? ` · ${Math.round(mineProgress * 100)}%` : '';
                    targetNameEl.textContent = b ? b.name + crack : '';
                } else {
                    targetNameEl.textContent = '';
                }
            }
            }
            }  // end on-foot update (skipped while piloting a ship)
            stepParts(dt);
            stepShotVfx(dt);
            updateTnt(dt);            // primed-TNT fuses + explosions + fireball flashes
            updateCritters(dt);
            updateDrone(dt);          // Hero companion trails the player
            updateStarGate(dt);       // Ancient gate glow + proximity hint
            updatePlayerCombat(dt);   // health regen / i-frames / hurt flash + hearts HUD
            updateVolcanicHazard(dt);  // Ember: lava burns + radiant heat
            updateContactHazard(dt);   // any world: Energy/Acid contact sting
            if(_AC) _AC.stepFx(dt);   // creature breath / spore / ember particles
            stepEmberFx(dt);          // Ember: falling ash + rising embers
            if (newFrame) {           // DOM HUD writes: once per rendered frame
                updateTrainHud();     // training-field live weapon readout
                updateHUD();
                updateWaypointHud();  // off-screen beacon guiding to a map waypoint
                checkLavaIgnition();  // placed TNT touching lava lights itself
            }
            updateCamera(dt);
            setUnderwaterTint(eyeInWater());
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
            const hit = voxelRaycast(from, _tpRayDir, len);
            if (hit) {
                const d = hit.point.distanceTo(from);
                if (d < len) return from.clone().addScaledVector(_tpRayDir, Math.max(0.45, d - 0.32));
            }
            return to.clone();
        }

        function updateCamera(dt) {
            dt = dt || 1 / 60;
            if (!camera) return;
            if (flying) { updateFlightCamera(dt); return; }
            if (firstPerson) {
                const fc = getFpCam();
                orbit.phi = Math.max(fc.pitchMin, Math.min(fc.pitchMax, orbit.phi));
                const fpFov = THREE.MathUtils.lerp(fc.fov, fc.adsFov, focusAimBlend);
                if (Math.abs(camera.fov - fpFov) > 0.05) {
                    camera.fov = fpFov;
                    camera.updateProjectionMatrix();
                }
                camera.position.copy(getFpEyeWorld(_fpEyePos));
                camera.lookAt(
                    _fpEyePos.x - Math.sin(orbit.phi) * Math.sin(orbit.theta),
                    _fpEyePos.y - Math.cos(orbit.phi),
                    _fpEyePos.z - Math.sin(orbit.phi) * Math.cos(orbit.theta));
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
            // explosion screen-shake: jitter the final camera position, then decay
            if (camShake > 0.0008) {
                const s = camShake;
                camera.position.x += (Math.random() - .5) * s;
                camera.position.y += (Math.random() - .5) * s;
                camera.position.z += (Math.random() - .5) * s;
                camShake *= Math.exp(-9 * dt);
            } else camShake = 0;
        }

        function enter() {
            if (_active) return;
            _saveScene();
            _setupScene();
            _active = true;
            startFrameClock();                     // real-frame gate + ms for adaptQuality
            if (g.keys) Object.assign(keys, g.keys);
            loadOwnedWeapons();
            loadDrawerTab();
            loadHotbarLayout();
            loadInventoryFromProfile();
            loadSettings();
            applySettings();                       // sound + view distance (VIEW_R) before streaming
            // Cloud-save status pill: subscribe (fires immediately with current
            // state) + a slow ticker so the "last saved" relative time stays fresh.
            if (window.CloudSync && window.CloudSync.subscribe) {
                _cloudUnsub = window.CloudSync.subscribe(renderCloudStatus);
                _cloudTimer = setInterval(() => {
                    if (window.CloudSync.getState) renderCloudStatus(window.CloudSync.getState());
                }, 20000);
            } else {
                const _ce = document.getElementById('voxel-cloud'); if (_ce) _ce.hidden = true;
            }
            // Refresh journal HUD when surveys grant a world (toast comes from meta UI).
            on(window, 'pjboy:planetsGranted', () => {
                if (typeof updateJournalHud === 'function') updateJournalHud();
            });
            setFirstPerson(vxSettings.view === 'first');   // default camera
            weaponIndex = loadCharCfg().weapon;
            // Migrate a legacy pickaxe loadout to the Laser Handgun (sole mining tool).
            {
                const _defs = weaponList();
                if (weaponIndex >= 0 && _defs[weaponIndex] && _defs[weaponIndex].id === 'pickaxe') {
                    const mc = _defs.findIndex((w) => w.id === 'minecutter');
                    weaponIndex = mc >= 0 ? mc : -1;
                    saveCharCfg({ weapon: weaponIndex });
                }
            }
            if (weaponIndex >= 0) ownedWeapons.add(weaponIndex);
            updateWeaponLabel();
            on(window, 'keydown', e => {
                keys[e.code] = true;
                if (e.code === 'KeyE' && !e.shiftKey && !voxelPanelOpen() && starGate && !flying
                    && Math.hypot(player.pos.x - starGate.pos.x, player.pos.z - starGate.pos.z) < GATE_REACH) {
                    e.preventDefault(); activateGate(); return;   // step through the gate
                }
                if (e.code === 'KeyQ') { cycleWeapon(-1); return; }
                if (e.code === 'KeyE' && !e.shiftKey) { cycleWeapon(1); return; }
                if (e.code === 'Escape') {
                    if (mapOpen) {
                        toggleMap(false);
                        return;
                    }
                    if (scanExpanded) {
                        setScanExpanded(false);
                        return;
                    }
                    if (controlsDrawerOpen) {
                        toggleControlsDrawer(false);
                        return;
                    }
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
                if (e.code === 'KeyO') {
                    e.preventDefault();
                    if (mapOpen) { toggleMap(false); return; }
                    if (scanExpanded) { setScanExpanded(false); return; }
                    // Keep the scanner-expand shortcut while focus-aiming a block;
                    // otherwise O opens the world map.
                    const shell = document.getElementById('voxel-scan');
                    if (shell && !shell.hidden && isScanCompactActive(pickTarget())) {
                        setScanExpanded(true);
                        return;
                    }
                    if (!voxelPanelOpen()) toggleMap(true);
                    return;
                }
                if (e.code === 'KeyH') {
                    e.preventDefault();
                    toggleControlsDrawer();
                    return;
                }
                if (e.code === 'Tab' || e.code === 'KeyM') {
                    e.preventDefault();
                    toggleDrawer();
                    return;
                }
                if (e.code === 'Digit0' || e.code === 'Numpad0') {
                    deselectQuickbar();
                    return;
                }
                if (e.code.startsWith('Digit')) {
                    const n = +e.code.slice(5);
                    if (n >= 1 && n <= HOTBAR_SLOTS) selectSlot(n - 1);
                }
                if (e.code === 'KeyV') {
                    if (!flying) setFirstPerson(!firstPerson);
                }
                if (e.code === 'KeyF' && !voxelPanelOpen()) {
                    if (flying) { flipShipUpright(); return; }
                    tryToggleDoor();
                    return;
                }
                if (e.code === 'KeyG' && !voxelPanelOpen()) {
                    boardShip();
                    return;
                }
                if (e.code === 'KeyC' && !voxelPanelOpen()) {
                    cycleShip();
                    return;
                }
                if (e.code === 'KeyB') {
                    jetBoost = !jetBoost;
                    if (g.showMessage) g.showMessage('🚀 Jetpack boost ' + (jetBoost ? 'ON — hold Space to rocket up!' : 'off'), 1600);
                    return;
                }
                // Dev tuners — require Shift so a kid mashing F-keys can't open them.
                if (e.code === 'F8' && e.shiftKey) {
                    e.preventDefault();
                    hideAimTuner();
                    if (firstPerson) showFpTuner();
                    else showTpTuner();
                }
                if (e.code === 'F9' && e.shiftKey) {
                    e.preventDefault();
                    if (aimTunerEl && !aimTunerEl.hidden) hideAimTuner();
                    else showAimTuner();
                }
                if (e.code === 'KeyR' && (e.shiftKey || e.metaKey)) {
                    e.preventDefault();
                    travelToNextPlanet();
                }
            });
            on(window, 'keyup', e => { keys[e.code] = false; });
            if (drawerEl) {
                on(drawerEl, 'click', (e) => {
                    if (e.target === drawerEl) toggleDrawer(false);
                });
                on(drawerEl, 'wheel', (e) => {
                    // allow the scrollable panel body to scroll; block the game zoom elsewhere
                    if (e.target.closest && e.target.closest('.vx-body')) return;
                    e.preventDefault();
                }, { passive: false });
            }
            if (controlsDrawerEl) {
                on(controlsDrawerEl, 'click', (e) => {
                    if (e.target === controlsDrawerEl) toggleControlsDrawer(false);
                });
                const controlsClose = controlsDrawerEl.querySelector('[data-vx-controls-close]');
                if (controlsClose) {
                    on(controlsClose, 'click', () => toggleControlsDrawer(false));
                }
            }
            const voxelHud = document.getElementById('voxel-overlay');
            if (voxelHud) {
                on(voxelHud, 'wheel', (e) => {
                    if (scanExpanded && e.target.closest('#voxel-scan')) return;
                    if (e.target.closest('#voxel-controls-drawer')) return;
                    if (e.target.closest('#voxel-drawer .vx-body')) return;
                    e.preventDefault();
                }, { passive: false });
            }
            const scanBackdrop = document.getElementById('voxel-scan-backdrop');
            if (scanBackdrop) {
                on(scanBackdrop, 'click', () => setScanExpanded(false));
            }
            canvasEl = g.renderer && g.renderer.domElement;

            function onCanvasPointerDown(e) {
                if (voxelPanelOpen()) return;
                if (flying) {              // piloting: no mining / placing / firing,
                    // but a click re-captures the mouse if the lock was dropped (Esc etc.)
                    if (e.button === 0) requestViewPointerLock();
                    return;
                }
                dragging = true;
                moved = 0;
                px = e.clientX;
                py = e.clientY;
                downBtn = e.button;
                wasLockedOnDown = isViewPointerLocked();
                if (e.button === 2) e.preventDefault();
                // Only left-click should capture the mouse — right-click for place
                // must not toggle pointer lock or the browser drops it on release.
                if (e.button === 0) requestViewPointerLock();
                if (e.button === 0) {
                    fireHeld = true;
                    laserCooldown = 0;
                    if (isMineLaser()) tryLaserMine();
                }
            }

            function onCanvasPointerUp(e) {
                if (!dragging) return;
                const btn = downBtn;
                dragging = false;
                if (btn === 0) {
                    fireHeld = false;
                    resetMining();
                }
                if (voxelPanelOpen()) return;
                if (moved >= 8) return;
                if (btn === 0 && !firstPerson && !wasLockedOnDown && isViewPointerLocked()) return;
                if (btn === 2) {
                    placeBlock();
                    if (firstPerson || wasLockedOnDown) restoreViewPointerLock();
                } else if (btn === 0 && !isMineLaser()) fireCombat();
            }

            function onCanvasPointerMove(e) {
                if (flying) {
                    if (isViewPointerLocked()) applyFlightMouse(e.movementX || 0, e.movementY || 0);
                    px = e.clientX; py = e.clientY;
                    return;
                }
                if (isViewPointerLocked()) {
                    const mx = e.movementX || 0;
                    const my = e.movementY || 0;
                    if (firstPerson) applyFpMouseLook(mx, my);
                    else applyTpMouseOrbit(mx, my);
                } else if (!firstPerson && !voxelPanelOpen() && (e.buttons & 2)) {
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
                if (voxelPanelOpen() && document.pointerLockElement) releasePointerLock();
                syncViewCursor();
            });
            on(window, 'pointerup', onCanvasPointerUp);
            on(window, 'pointermove', onCanvasPointerMove);
            if (!texturesReady) {
                buildTextures();
                texturesReady = true;
            }
            rebuildMaterials();
            loadActivePlanet();
            loadProfileEdits();
            resetStreaming();
            clearCritters();
            spawnPlayerAtCenter();
            (function () {
                const AP = getProfileApi();
                const def = (AP && AP.currentPlanetDef) ? AP.currentPlanetDef(AP.load()) : null;
                showVoxelLoading(def ? ('Charting ' + def.name) : 'Loading…', def ? def.nameDa : '');
                afterPaint(() => {
                    if (!_active) { hideVoxelLoading(); return; }
                    prewarmHorizon(() => {
                        spawnStarGate();
                        hideVoxelLoading();
                    });
                });
            })();
            renderHotbar();
            updateJournalHud();
            reconcileCloudOnEnter();   // pull+merge cloud so devices converge (non-blocking)
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
            aimTune = loadAimTune();
            if (tpWeapon && weaponDef) applyTpWeaponGripRest(tpWeapon, weaponDef);
            applyFpCamToOrbit();
            applyTpTuneToOrbit();
            ensureFpViewmodel();
            setFirstPerson(firstPerson);
            buildFpTunerUI();
            buildTpTunerUI();
            buildAimTunerUI();
            if (firstPerson && !fpTune.dismissed) showFpTuner();
            else hideFpTuner();
            if (!firstPerson && !tpTune.dismissed) showTpTuner();
            else hideTpTuner();
            spawnPlayerAtCenter();
            orbit.phi = Math.PI / 2;   // start looking level at the horizon, not up/down
            elapsed = 0;
            updateViewHints();
            updateCamera();
            if (firstPerson) requestFpPointerLock();
        }

        function exit() {
            if (!_active) return;
            if (_blastCommitT) { clearTimeout(_blastCommitT); _blastCommitT = null; }
            commitBlast();                              // persist any pending blast edits + salvage
            if (_profileFlushTimer) {
                clearTimeout(_profileFlushTimer);
                _profileFlushTimer = null;
            }
            flushProfileState();
            _active = false;
            if (_cloudUnsub) { _cloudUnsub(); _cloudUnsub = null; }
            if (_cloudTimer) { clearInterval(_cloudTimer); _cloudTimer = null; }
            { const _ce = document.getElementById('voxel-cloud'); if (_ce) _ce.hidden = true; }
            stopFrameClock();
            hideVoxelLoading();
            setUnderwaterTint(false);
            disposeGearViewer();
            disposeThumbRenderer();
            clearCritters();
            if (ship) { scene.remove(ship.group); ship.dispose(); ship = null; }
            clearShipTrails(); clearSpace();
            clearStarGate(); clearTrainingField();
            flying = false; _flyCamPos = null; _flyCamUp = null;
            if (camera) camera.up.set(0,1,0);
            hideFpTuner();
            hideTpTuner();
            hideAimTuner();
            disposeFormulaViewer();
            _resetInput();
            _clearWorld();
            _restoreScene();
            _removeListeners();
        }

        return { enter, exit, tick, updateCamera, mineBlock, placeBlock };
    }

    window.VoxelWorld = VoxelWorld;
})();
