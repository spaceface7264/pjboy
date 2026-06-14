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
        const NO_BORDER = new Set(['tall_grass','flower_red','flower_yellow','water',
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
        // Streaming, wrapping world: voxel coords are GLOBAL and unbounded in x/z; the
        // terrain is periodic with period WORLD_PERIOD, so walking that far returns you
        // to identical land ("arrive where you started") with no seam. Only the columns
        // within VIEW_R chunks of the player stay loaded/meshed.
        const WORLD_PERIOD = 3072;              // blocks before terrain repeats (must be a multiple of CH)
        const VIEW_R = 14;                      // column-chunks meshed around the player (~fog distance). 14*CH=224 block radius; ~half the columns/draw-calls of 20, fog hides the nearer edge.
        const KEEP_R = VIEW_R + 2;              // column-chunks kept buffered (margin for border meshing)
        const UNLOAD_R = VIEW_R + 4;            // beyond this, columns are disposed
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
          if(id){ const k=colKey(cx,cz); if(y > (colMaxY.get(k)||0)) colMaxY.set(k, y); }
          rebuildChunkAt(x,y,z);
          // borders share faces with the neighbor chunk
          const lx=_mod(x,CH), lz=_mod(z,CH);
          if(lx===0) rebuildChunkAt(x-1,y,z); if(lx===CH-1) rebuildChunkAt(x+1,y,z);
          if(y%CH===0) rebuildChunkAt(x,y-1,z); if(y%CH===CH-1) rebuildChunkAt(x,y+1,z);
          if(lz===0) rebuildChunkAt(x,y,z-1); if(lz===CH-1) rebuildChunkAt(x,y,z+1);
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
          const chunks = new Set();
          const addChunk = (x,y,z)=> chunks.add(_fdiv(x,CH)+','+_fdiv(y,CH)+','+_fdiv(z,CH));
          for(const cell of region){
            const x=cell[0], y=cell[1], z=cell[2];
            const cx=_fdiv(x,CH), cz=_fdiv(z,CH);
            const c = ensureCol(cx,cz);
            c[cIdx(x-cx*CH, y, z-cz*CH)] = WATER;
            recordEdit(x,y,z,WATER);
            if(p) AP.upsertBlockEdit(p, pmod(x), y, pmod(z), WATER);
            const k=colKey(cx,cz); if(y>(colMaxY.get(k)||0)) colMaxY.set(k,y);
            addChunk(x,y,z);
            const lx=_mod(x,CH), ly=_mod(y,CH), lz=_mod(z,CH);
            if(lx===0) addChunk(x-1,y,z); if(lx===CH-1) addChunk(x+1,y,z);
            if(ly===0) addChunk(x,y-1,z); if(ly===CH-1) addChunk(x,y+1,z);
            if(lz===0) addChunk(x,y,z-1); if(lz===CH-1) addChunk(x,y,z+1);
          }
          if(p) AP.save(p);
          for(const ck of chunks){ const a=ck.split(','); buildChunkMesh(+a[0],+a[1],+a[2]); }
        }

        // Resolve the player's current planet → drives SEED, biome theme, atmosphere.
        function loadActivePlanet() {
            const AP = getProfileApi();
            const def = (AP && AP.currentPlanetDef) ? AP.currentPlanetDef(AP.load()) : null;
            if (def) {
                activePlanetId = def.id;
                SEED = def.seed | 0;
                activeBiome = BIOME_THEMES[def.biome] || BIOME_THEMES.verdant;
                activeSpec = (AP && AP.planetSpec) ? AP.planetSpec(def) : null;
            } else {
                // No profile API (e.g. standalone) — keep a stable random asteroid.
                activePlanetId = null;
                SEED = (Math.random() * 1e9) | 0;
                activeBiome = BIOME_THEMES.verdant;
                activeSpec = null;
            }
            applyActiveSpec();
            applyPlanetAtmosphere();
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
        
        // ---------- multiplanetary: active planet + biome themes ----------
        // The active planet comes from AsteroidProfile (its catalog supplies the
        // seed + a biome key). A theme only re-skins the *surface* block and the
        // atmosphere tint — the deep geology/ores stay shared so every world reads
        // as the same kind of asteroid. `remap(top, ctx)` returns the surface id;
        // ctx = { bn, icy, rad, h } (h = stable per-column hash). `verdant` has no
        // remap, so the home world generates byte-identically to before.
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
          volcanic: { sky:0x6a4858, horizon:0xdcae9c, sun:0xffd6bc, ground:0x5a3632,
            remap(top, ctx){
              if(top===8 || top===20) return 18;    // no ice
              if(top===1 || (top>=12 && top<=15) || top===36) return ctx.h < 0.3 ? 18 : 16; // red rock / regolith
              return top;
            }
          }
        };
        const FOG_NEAR = 48, FOG_FAR = 200;     // < VIEW_R*CH (=224) so the streamed edge stays hidden behind haze

        function _hex(n){ return '#' + (n & 0xffffff).toString(16).padStart(6, '0'); }
        function _mixHex(a, b, t){
          const ar=(a>>16)&255, ag=(a>>8)&255, ab=a&255, br=(b>>16)&255, bg=(b>>8)&255, bb=b&255;
          const r=Math.round(ar+(br-ar)*t), g2=Math.round(ag+(bg-ag)*t), b2=Math.round(ab+(bb-ab)*t);
          return (r<<16)|(g2<<8)|b2;
        }
        const _cl01 = (v)=> v<0?0 : v>1?1 : v;

        // ---------- day / night cycle ----------
        const DAYNIGHT_ENABLED = false;         // master switch — flip to true to run the cycle
        const DAY_LENGTH = 600;                 // seconds for a full day-night cycle
        const NIGHT_SKY=0x0a1430, NIGHT_HORIZON=0x16203c, MOON=0x8a96b8, SUNSET=0xff7a3c;
        let dayTime = 0.20;                     // 0=sunrise .25=noon .5=sunset .75=midnight
        let _skyMark = -1, _dayF = 1;

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
            g.scene.fog.near = FOG_NEAR + sf*60;
            g.scene.fog.far  = FOG_FAR  + sf*(1400 - FOG_FAR);
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
          // grow the far plane in space so the globe's limb (and stars) aren't clipped at far=700.
          const wantFar = 700 + sf*(3000-700);
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
        function _dayNightOn(){ return DAYNIGHT_ENABLED || (activeSpec && activeSpec.visual && activeSpec.visual.dayNight); }
        function _dayLenSec(){ return (activeSpec && activeSpec.basics && activeSpec.basics.dayLengthMin) ? activeSpec.basics.dayLengthMin*60 : DAY_LENGTH; }
        function updateDayNight(dt){ if(!_dayNightOn()) return; dayTime = (dayTime + dt/_dayLenSec()) % 1; applyDaySky(); }
        // Forced full refresh (planet change / enter).
        function applyPlanetAtmosphere(){ _skyMark = -1; applyDaySky(); }

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

        // Periodic terrain height for a column (continents + hills + ridged mountains).
        function columnHeight(x, z){
          const cont = pfbm2(x,z, 1000, 16, 3);                  // broad continents (~192-block)
          const hill = pfbm2(x,z, 3000, 64, 2);                  // rolling hills (~48-block)
          const ridge= 1-Math.abs(2*pfbm2(x,z, 5000, 32, 2)-1);  // mountain ridges (~96-block)
          // Centre terrain around sea level so basins dip BELOW it and fill with water
          // (coasts, lakes, oceans). landBias shifts a world wetter (−) or drier (+).
          const hh = SEA_LEVEL + 4 + _landBias + (cont-0.5)*44 + (hill-0.5)*9 + ridge*ridge*ridge*26*_mtnMul;
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

        // Deterministic, periodic surface profile (height + surface block) for a column.
        function columnProfile(x, z){
          const SEA=SEA_LEVEL;
          const height = columnHeight(x,z);
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

        // A grass column above water, sparsely chosen by a periodic hash.
        function isTreeRoot(x, z){
          if(ihash(pmod(x), 999, pmod(z)) > 0.012) return false;
          const p = columnProfile(x,z);
          return p.height > SEA_LEVEL && (p.top===1 || p.top===12 || p.top===13);
        }

        // Single-voxel generation (fallback for getBlock outside loaded columns).
        function genBlockSingle(x,y,z){
          const e = editStore.get(pmod(x)+','+y+','+pmod(z));
          if(e!==undefined) return e;
          const p = columnProfile(x,z);
          if(y > p.height) return (p.height < SEA_LEVEL && y <= SEA_LEVEL) ? WATER : 0;
          if(y === p.height) return p.top;
          if(y < p.height && y <= p.height-caveRoof(x,z,p.height) && caveAt(x,y,z)) return 0;  // caves / cliff mouths
          if(y >= p.height-4) return 2;
          return oreAt(x,y,z) || 3;
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
              else if(y<=p.height-roof && caveAt(x,y,z)) continue;   // caves / cliff mouths
              else if(y>=p.height-4) id=2;
              else id = oreAt(x,y,z) || 3;
              buf[cIdx(lx,y,lz)] = id;
            }
            if(p.height < SEA_LEVEL){ for(let y=p.height+1; y<=SEA_LEVEL; y++) buf[cIdx(lx,y,lz)] = WATER; }
            const colTop = Math.max(p.height, p.height<SEA_LEVEL?SEA_LEVEL:0);
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
          applyEditsToCol(buf, cx, cz);
          return { buf, maxY: Math.min(H-1, maxY) };
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
        // reader (defaults to getBlock); buildChunkMesh passes a local 3×3 reader.
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
        function buildChunkMesh(cx,cy,cz){
          const key=`${cx},${cy},${cz}`;
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

          for(let lx=0;lx<CH;lx++) for(let ly=0;ly<CH;ly++) for(let lz=0;lz<CH;lz++){
            const x=cx*CH+lx, y=cy*CH+ly, z=cz*CH+lz;
            if(y<0||y>=H) continue;                 // x/z unbounded (streaming world)
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

          if(GREEDY) greedyStatic(cx,cy,cz, buf, localBlock);

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
          buildChunkMesh(Math.floor(x/CH), Math.floor(y/CH), Math.floor(z/CH));
        }
        // Re-mesh every currently-resident column (e.g. after the biome theme changes).
        function rebuildWorld(){
          for(const k of [...meshedCols]){
            const c = k.split(','); meshColumn(+c[0], +c[1]);
          }
          updateHUD();
        }

        // ---------- chunk streaming: keep a disc of columns around the player ----------
        const VCH = H/CH;                       // vertical sub-chunks per column
        const meshedCols = new Set();           // "cx,cz" columns claimed (generated/meshing)
        let buildQueue = [];                    // pending columns to GENERATE, nearest first
        let meshQueue = [];                     // pending per-sub-chunk MESH jobs {cx,cy,cz}
        let _streamCx = null, _streamCz = null;

        function meshColumn(cx,cz){
          // ensure this column + its 8 neighbours are buffered so border faces/AO read
          // real data (not the tree-less single-voxel fallback)
          for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=1;dz++) ensureCol(cx+dx, cz+dz);
          // only mesh up to the filled height — skip the empty sky sub-chunks above
          const topCy = Math.min(VCH-1, Math.floor((colMaxY.get(colKey(cx,cz)) || (H-1))/CH));
          for(let cy=0; cy<=topCy; cy++) buildChunkMesh(cx,cy,cz);
          meshedCols.add(colKey(cx,cz));
        }
        function unloadColumn(cx,cz){
          for(let cy=0; cy<VCH; cy++){
            const key = `${cx},${cy},${cz}`;
            const o = scene3.chunks.get(key);
            if(o){ ['static','anim','glass','water','deco'].forEach(k=>{ if(o[k]){ scene.remove(o[k]); o[k].geometry.dispose(); } }); scene3.chunks.delete(key); }
          }
          meshedCols.delete(colKey(cx,cz));
        }
        // Recompute the desired disc of loaded chunks around the player's column.
        function streamAround(wx, wz){
          const ccx = Math.floor(wx/CH), ccz = Math.floor(wz/CH);
          if(ccx===_streamCx && ccz===_streamCz) return;
          _streamCx = ccx; _streamCz = ccz;
          // (buffers are generated lazily by meshColumn, which ensures its neighbours)
          // rebuild the mesh queue (nearest first) for un-meshed columns within VIEW_R
          buildQueue = [];
          const view2 = VIEW_R*VIEW_R;
          for(let dx=-VIEW_R;dx<=VIEW_R;dx++) for(let dz=-VIEW_R;dz<=VIEW_R;dz++){
            const d2 = dx*dx+dz*dz; if(d2>view2) continue;
            const cx=ccx+dx, cz=ccz+dz;
            if(!meshedCols.has(colKey(cx,cz))) buildQueue.push({cx,cz,d2});
          }
          buildQueue.sort((a,b)=>a.d2-b.d2);
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
        // claim it (so streamAround won't re-enqueue), then queue its non-empty
        // sub-chunks for meshing. Cheaper, bounded unit than meshing a whole column.
        function genColumnJob(cx,cz){
          for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=1;dz++) ensureCol(cx+dx, cz+dz);
          meshedCols.add(colKey(cx,cz));
          const topCy = Math.min(VCH-1, Math.floor((colMaxY.get(colKey(cx,cz)) || (H-1))/CH));
          for(let cy=0; cy<=topCy; cy++) meshQueue.push({cx,cy,cz});
        }
        // Drain the streaming queues under a per-frame TIME budget (ms) so work spreads
        // across frames instead of hitching. The budget is checked between each unit
        // (one sub-chunk mesh, or one column generation), never spanning a whole column.
        // Mesh jobs run first so claimed columns finish before new ones generate.
        function processBuildQueue(maxMs){
          if(!meshQueue.length && !buildQueue.length) return;
          const now = (typeof performance!=='undefined' && performance.now) ? ()=>performance.now() : ()=>Date.now();
          const t0 = now();
          do {
            if(meshQueue.length){
              const j = meshQueue.shift();
              // skip stale jobs whose column drifted out of range before meshing
              if(meshedCols.has(colKey(j.cx,j.cz))) buildChunkMesh(j.cx,j.cy,j.cz);
            } else {
              const job = buildQueue.shift();
              if(job && !meshedCols.has(colKey(job.cx,job.cz))) genColumnJob(job.cx,job.cz);
            }
          } while((meshQueue.length || buildQueue.length) && now()-t0 < maxMs);
        }
        // Dispose all chunks + buffers (used when entering / changing planet).
        function resetStreaming(){
          for(const k of [...meshedCols]){ const c=k.split(','); unloadColumn(+c[0], +c[1]); }
          meshedCols.clear();
          worldCols.clear();
          colMaxY.clear();
          buildQueue = [];
          meshQueue = [];
          _streamCx = _streamCz = null;
        }
        // Build the spawn area up front; the rest streams in over the next frames.
        function streamInit(){
          streamAround(player.pos.x, player.pos.z);
          const N = Math.min(buildQueue.length, 200);   // nearest disc synchronously
          for(let i=0;i<N;i++){ const j=buildQueue.shift(); if(j && !meshedCols.has(colKey(j.cx,j.cz))) meshColumn(j.cx,j.cz); }
          updateHUD();
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
        function updateHUD(){
          // The tri-count is a debug readout — walking every chunk's geometry each frame is
          // wasteful. Recompute it only every 30 calls; cache the value in between.
          if((_hudTriFrame++ % 30) === 0){
            let tris=0;
            scene3.chunks.forEach(c=>['static','anim','glass','water','deco'].forEach(k=>{
              if(c[k]) tris += c[k].geometry.index.count/3; }));
            _hudTriCached = tris|0;
          }
          document.getElementById('voxel-tri-count').textContent = _hudTriCached;
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
            const owned = defs.map((_, i) => i).filter((i) => ownedWeapons.has(i));
            return [-1, ...owned];
        }

        function setWeaponIndex(idx, quiet) {
            const cfg = saveCharCfg({ weapon: idx | 0 });
            weaponIndex = cfg.weapon;
            if (weaponIndex >= 0) ownedWeapons.add(weaponIndex);
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
            return !!(weaponDef && (weaponDef.id === 'laser' || weaponDef.id === 'minecutter'));
        }

        function isPickaxe() {
            return !!(weaponDef && weaponDef.id === 'pickaxe');
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
            return isPickaxe() || isMineLaser();
        }

        function canScanBlocks() {
            return isMiningTool() || weaponIndex < 0;
        }

        function mineLaserInterval() {
            return (weaponDef && weaponDef.id === 'minecutter') ? MINECUTTER_FIRE_INTERVAL : LASER_FIRE_INTERVAL;
        }

        let mineProgress = 0;
        let mineTarget = null;
        let mineRepeatCooldown = 0;
        const MINE_SWING_INTERVAL = 0.42;
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
            mineRepeatCooldown = 0;
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
            if (el) el.textContent = weaponDef ? weaponDef.name : 'Empty hands';
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
        const player = {
          pos:new THREE.Vector3(), vel:new THREE.Vector3(),
          half:{x:.32,z:.32}, height:1.85,
          grounded:false, yaw:0, state:'idle',
          // combat (forgiving by design — see the kid-first audience note)
          health:100, maxHealth:100, invuln:0, hurtFlash:0, _noHitT:0,
          knock:new THREE.Vector3(),   // decaying horizontal knockback impulse
        };
        const _spawnPos = new THREE.Vector3();   // remembered respawn point
        function solidAt(wx,wy,wz){       // world-space (render) coords -> voxel solid?
          const b = getBlock(Math.floor(wx-WORLD_OFFSET.x), Math.floor(wy-WORLD_OFFSET.y),
                             Math.floor(wz-WORLD_OFFSET.z));
          return b !== 0 && b !== WATER;   // water is swimmable, not solid
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
        let focusAimBlend = 0;
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
            return out.copy(player.pos).add(_fpEyeOff.set(c.eyeX || 0, c.eyeH, c.eyeZ || 0));
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
            const fc = getFpCam();
            orbit.theta -= dx * fc.aimSens;
            orbit.phi = Math.max(fc.pitchMin, Math.min(fc.pitchMax, orbit.phi - dy * fc.aimSens));
            player.yaw = orbit.theta + Math.PI;
        }

        function applyTpMouseOrbit(dx, dy) {
            if (firstPerson || voxelPanelOpen() || (!dx && !dy)) return;
            const tc = getTpCam();
            orbit.theta -= dx * tc.orbitSens;
            orbit.phi = Math.max(tc.pitchMin, Math.min(tc.pitchMax, orbit.phi - dy * tc.orbitSens));
        }

        // Mouse-fly: horizontal steers the ship, vertical sets nose attitude (up = climb).
        function applyFlightMouse(mx, my) {
            if (!ship) return;
            ship.yaw -= mx * 0.0024;
            ship.climbCmd = THREE.MathUtils.clamp((ship.climbCmd || 0) - my * 0.006, -1, 1);
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

        function weaponGameplayFor(id) {
            if (!fpTune) fpTune = loadFpTune();
            const defs = defaultWeaponGameplayStats();
            if (!fpTune.weaponStats) fpTune.weaponStats = mergeWeaponStats(null);
            if (!fpTune.weaponStats[id]) {
                fpTune.weaponStats[id] = Object.assign({}, defs[id] || { power: 0.5, range: 0.5 });
            }
            return fpTune.weaponStats[id];
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
        const AIM_REACH = 6.5;

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
            'Lamp': 'Lampe', 'Hull': 'Skrog', 'Energy': 'Energi', 'Gate Key': 'Portnøgle',
            'Lava': 'Lava', 'Acid': 'Syre', 'Water': 'Vand',
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
            formulaViewer.active = false;
            _scanBlockId = -1;
            resizeFormulaCanvas(false);
        }

        function buildScanElbowPath(x1, y1, x2, y2) {
            const dx = x2 - x1;
            const elbowX = x1 + dx * 0.58;
            return `M ${x1} ${y1} L ${elbowX} ${y1} L ${elbowX} ${y2} L ${x2} ${y2}`;
        }

        function updateScanConnector(t, alpha) {
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

            const screen = getScanBlockScreen(t);
            const { bx, by, inFrustum, w, h } = screen;
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

            marker.style.left = `${bx}px`;
            marker.style.top = `${by}px`;
            marker.style.opacity = String(alpha);
            marker.hidden = false;
        }

        const SCAN_PAD = 12;
        const SCAN_BLOCK_GAP = 26;
        const SCAN_BOTTOM_RESERVE = 108;

        function getScanBlockScreen(t) {
            const w = window.innerWidth;
            const h = window.innerHeight;
            _scanWorld.set(
                WORLD_OFFSET.x + t.x + 0.5,
                WORLD_OFFSET.y + t.y + 0.5,
                WORLD_OFFSET.z + t.z + 0.5
            );
            _scanWorld.project(camera);
            let bx = (_scanWorld.x * 0.5 + 0.5) * w;
            let by = (-_scanWorld.y * 0.5 + 0.5) * h;
            const inFrustum = _scanWorld.z <= 1;
            bx = Math.max(SCAN_PAD, Math.min(w - SCAN_PAD, bx));
            by = Math.max(SCAN_PAD, Math.min(h - SCAN_PAD, by));
            return { bx, by, inFrustum, w, h };
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

        function layoutScanPanel(t) {
            const panel = document.getElementById('voxel-scan');
            if (!panel || !camera) return null;
            const { bx, by, w, h } = getScanBlockScreen(t);

            panel.style.transform = 'none';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';

            const maxH = scanPanelMaxHeight(h);
            const ph = fitScanPanelContent(maxH);
            const pw = panel.offsetWidth || Math.min(380, w - 24);
            const spaceRight = w - bx - SCAN_PAD;
            const spaceLeft = bx - SCAN_PAD;

            let left = spaceRight >= pw + SCAN_BLOCK_GAP || spaceRight >= spaceLeft
                ? bx + SCAN_BLOCK_GAP
                : bx - SCAN_BLOCK_GAP - pw;
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
            let badge = '';
            if (AP.currentPlanetDef) {
                const def = AP.currentPlanetDef(p);
                const charted = (p.system && p.system.unlocked) ? p.system.unlocked.length : 1;
                const total = AP.PLANETS ? AP.PLANETS.length : 1;
                badge = '<div class="vx-quest-top"><span class="vx-quest-badge">🪐 ' + def.name + '</span>'
                    + '<span class="vx-quest-count">' + charted + ' / ' + total + ' charted</span></div>';
            }
            if (!prog.mission) {
                el.innerHTML = badge
                    + '<div class="vx-quest-title vx-quest-done">✓ Surveys complete</div>'
                    + '<div class="vx-quest-goal">Every objective done on this world — keep exploring.</div>'
                    + '<div class="vx-quest-bar vx-quest-bar-done"><span style="width:100%"></span></div>';
                return;
            }
            const cur = Math.max(0, prog.current | 0), tgt = Math.max(1, prog.target | 0);
            const pct = Math.max(0, Math.min(100, Math.round(cur / tgt * 100)));
            el.innerHTML = badge
                + '<div class="vx-quest-title">🔬 ' + prog.mission.title + '</div>'
                + '<div class="vx-quest-goal">' + prog.mission.desc + '</div>'
                + '<div class="vx-quest-bar"><span style="width:' + pct + '%"></span><em>' + cur + ' / ' + tgt + '</em></div>';
        }

        function recordJournalScan(blockId) {
            const AP = getProfileApi();
            if (!AP) return;
            const { isNew, completed } = AP.recordScan(AP.load(), blockId);
            updateJournalHud();
            const b = blockById(blockId);
            const hud = document.getElementById('voxel-journal-hud');
            if (isNew && hud) hud.classList.add('vx-journal-new');
            if (isNew && g.showMessage && b) {
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
                panel.style.opacity = String(scanExpanded ? 1 : (0.4 + focusAimBlend * 0.6));
                if (_scanCreatureId !== cre.sp.id) {
                    _scanCreatureId = cre.sp.id;
                    _scanBlockId = -1;
                    fillCreatureScanContent(cre.sp, scanExpanded);
                    recordCreatureScan(cre.sp);
                }
                if (scanExpanded) layoutScanExpanded();
                return;
            }
            _scanCreatureId = null;

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

        function completeMine(t, id) {
            mineBreakSfx(id);
            burst(
                t.x + 0.5 + WORLD_OFFSET.x,
                t.y + 0.5 + WORLD_OFFSET.y,
                t.z + 0.5 + WORLD_OFFSET.z,
                blockColor(id)
            );
            setBlockEvent(t.x, t.y, t.z, 0);
            floodWaterAfterMine(t.x, t.y, t.z);   // sea flows into the new gap if it reaches water
            addToInventory(id);
            updateHUD();
            resetMining();
            disposeAimEdgeHighlight();
        }

        function mineProgressGain(block) {
            const g = weaponDef ? weaponGameplayFor(weaponDef.id) : { power: 0.5 };
            const speed = (weaponDef && weaponDef.stats && weaponDef.stats.Speed) || 5;
            const hardness = (block && block.hardness) || 1;
            return g.power * speed / (hardness * 1.75);
        }

        function laserMineGain(block) {
            const g = weaponGameplayFor(weaponDef.id);
            const speed = (weaponDef.stats && weaponDef.stats.Speed) || 5;
            const hardness = (block && block.hardness) || 1;
            return g.power * speed / (hardness * 3.2);
        }

        function tryMineSwing() {
            if (!isPickaxe()) {
                showToolMsg('Equip pickaxe to mine (Q/E)');
                return false;
            }
            triggerMineAnim();
            const t = pickTarget();
            if (!t || !getBlock(t.x, t.y, t.z)) {
                resetMining();
                return false;
            }
            const id = getBlock(t.x, t.y, t.z);
            const block = blockById(id);
            if (!block) return false;
            if (mineTarget && (mineTarget.x !== t.x || mineTarget.y !== t.y || mineTarget.z !== t.z)) {
                mineProgress = 0;
            }
            mineTarget = { x: t.x, y: t.y, z: t.z };
            mineProgress += mineProgressGain(block);
            playSfx('wallChip');
            if (mineProgress >= 1) {
                completeMine(t, id);
                return true;
            }
            return false;
        }

        function updateMiningHold(dt) {
            if (!fireHeld || !isPickaxe() || voxelPanelOpen()) return;
            mineRepeatCooldown -= dt;
            if (mineRepeatCooldown > 0) return;
            tryMineSwing();
            mineRepeatCooldown = MINE_SWING_INTERVAL;
        }

        function fireCombat() {
            if (flying) return;
            if (!weaponDef) return;
            if (isSwordEquipped() && !canStartSwordSwing()) return;
            if (isLaserRifle() && !canStartLaserFire()) return;
            const t = pickTarget();
            const hasBlock = !!(t && getBlock(t.x, t.y, t.z));
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
            playSfx(weaponDef && weaponDef.id === 'laser' ? 'laserFire' : 'laserCut');
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
            <p class="vx-fp-hint">Camera, pose (Q/E), power &amp; range. <b>F8</b> reopens after save.</p>`;
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
                if (g.showMessage) g.showMessage('FP camera & weapon saved (F8 to tweak again)', 2800);
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
            <p class="vx-fp-hint">Camera, TP weapon grip (Q/E), power &amp; range. <b>F8</b> in 3rd person.</p>`;
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
                if (g.showMessage) g.showMessage('Camera & weapon stats saved (F8 to tweak again)', 2800);
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
            <p class="vx-fp-hint">Mining target edges. <b>F9</b> toggles · aim at a block to preview.</p>
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
                if (g.showMessage) g.showMessage('Aim highlight saved (F9 to tweak)', 2400);
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
            return tryMineSwing();
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
            { id: 'Worlds',   icon: '🪐', label: 'Worlds' }
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
            return drawerOpen || controlsDrawerOpen;
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
            if (owned || !ownedOnly) {
                item.addEventListener('click', () => {
                    ownedWeapons.add(index);
                    saveOwnedWeapons();
                    setWeaponIndex(index);
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
            if (drawerTab === 'Gear') { renderGearBody(body, ownedOnly); return; }
            renderBackpackBody(body, ownedOnly);
        }

        // Backpack: all block categories as sections in one page.
        function renderBackpackBody(body, ownedOnly) {
            let any = false;
            INV_CATEGORIES.forEach((cat) => {
                const blocks = BlockRegistry.filter((b) => b.cat === cat && !b.water);
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
            const visible = ownedOnly
                ? defs.map((d, i) => ({ def: d, i })).filter((x) => ownedWeapons.has(x.i))
                : defs.map((d, i) => ({ def: d, i }));
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
        let codexSection = 'Blocks';   // 'Blocks' | 'Gear'

        // Codex overview: a Blocks/Gear toggle, then the chosen section.
        function renderCatalogBody(body) {
            if (codexView) { renderCodexDetail(body); return; }
            const seg = document.createElement('div');
            seg.className = 'vx-codex-seg';
            ['Blocks', 'Gear'].forEach((s) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'vx-seg-btn' + (codexSection === s ? ' vx-seg-on' : '');
                btn.textContent = s === 'Blocks' ? '📖 Blocks' : '⚔️ Gear';
                btn.addEventListener('click', () => { codexSection = s; renderDrawer(); });
                seg.appendChild(btn);
            });
            body.appendChild(seg);
            if (codexSection === 'Gear') { renderCodexGearList(body); return; }
            const AP = getProfileApi();
            const scanned = (AP && AP.load().journal && AP.load().journal.scanned) || {};
            const all = BlockRegistry.filter((b) => !b.water);   // water isn't a collectible block
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
            else renderBlockDetail(body, blockById(codexView.id));
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
            let stats = '';
            if (def.stats) {
                stats += '<div class="vx-codex-block"><div class="vx-codex-h">Stats</div>';
                Object.entries(def.stats).forEach(([k, v]) => {
                    const w = Math.max(0, Math.min(100, (v / 10) * 100));
                    stats += '<div class="vx-statbar"><span class="vx-statbar-label">' + k + '</span>'
                        + '<span class="vx-statbar-track"><span class="vx-statbar-fill" style="width:' + w + '%"></span></span>'
                        + '<span class="vx-statbar-num">' + v + '</span></div>';
                });
                stats += '</div>';
            }
            const desc = def.desc ? '<div class="vx-codex-fact"><span class="vx-codex-fact-icon">📖</span><span>' + def.desc + '</span></div>' : '';
            page.innerHTML = '<div class="vx-gear-detail">'
                + '<div class="vx-gear-stage"><canvas class="vx-gear-canvas" aria-label="' + def.name + '"></canvas></div>'
                + '<div class="vx-gear-headrow"><div>'
                + '<div class="vx-codex-name">' + def.name + '</div>'
                + '<div class="vx-codex-cat">⚔️ ' + type + '</div></div>'
                + '<button type="button" class="vx-equip-btn' + (equipped ? ' vx-equip-on' : '') + '" data-equip' + (equipped ? ' disabled' : '') + '>'
                + (equipped ? '✓ Equipped' : 'Equip') + '</button>'
                + '</div>'
                + stats + desc
                + '</div>';
            body.appendChild(page);
            const eb = page.querySelector('[data-equip]');
            if (eb && !equipped) eb.addEventListener('click', () => {
                ownedWeapons.add(idx); saveOwnedWeapons(); setWeaponIndex(idx); renderDrawer();
            });
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
            const avail = AP.craftAvailability(recipe, backpack);
            if (!avail.ok) {
                if (g.showMessage) g.showMessage('Not enough materials for ' + recipe.name, 2000);
                return;
            }
            for (const inp of recipe.inputs) spendFromInventory(inp.id, inp.count);
            const outCount = recipe.outputCount || 1;
            addToInventory(recipe.output, outCount);   // also re-renders the open drawer
            const { completed } = AP.recordCraft(AP.load(), recipe.output, outCount);
            updateJournalHud();
            const outName = refineryMatName(recipe.output);
            if (g.showMessage) g.showMessage('Crafted ' + outCount + '× ' + outName, 2200);
            if (completed && g.showMessage) g.showMessage('Survey complete: ' + completed.title, 2800);
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
            recipes.forEach((r) => {
                const avail = AP.craftAvailability(r, backpack);
                const card = document.createElement('div');
                card.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 12px;margin-bottom:8px;border-radius:10px;background:rgba(36,100,118,0.30);border:1px solid rgba(90,200,230,0.35);';
                const img = document.createElement('img');
                img.src = thumbUrl(r.output);
                img.width = img.height = 40;
                img.style.cssText = 'image-rendering:pixelated;border-radius:6px;flex:0 0 auto;';
                card.appendChild(img);
                const info = document.createElement('div');
                info.style.cssText = 'flex:1 1 auto;min-width:0;';
                const title = document.createElement('div');
                title.style.cssText = 'font-weight:700;color:#dff6ff;';
                title.textContent = r.name + ((r.outputCount || 1) > 1 ? ' ×' + r.outputCount : '');
                info.appendChild(title);
                const cost = document.createElement('div');
                cost.style.cssText = 'font-size:12px;margin-top:3px;';
                cost.innerHTML = r.inputs.map((inp) => {
                    const have = getBackpackCount(inp.id);
                    const col = have >= inp.count ? '#9be89b' : '#ff9b9b';
                    return '<span style="color:' + col + '">' + refineryMatName(inp.id) + ' ' + have + '/' + inp.count + '</span>';
                }).join('<span style="opacity:0.5"> · </span>');
                info.appendChild(cost);
                card.appendChild(info);
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'vx-btn' + (avail.ok ? ' vx-btn-on' : '');
                btn.textContent = 'Craft';
                btn.disabled = !avail.ok;
                btn.style.cssText = 'flex:0 0 auto;' + (avail.ok ? '' : 'opacity:0.45;cursor:not-allowed;');
                if (avail.ok) btn.addEventListener('click', () => craftRecipe(r));
                card.appendChild(btn);
                body.appendChild(card);
            });
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
                    inner.appendChild(createThumbWrap(tint, thumb(b), b.name));
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
                streamInit();
                spawnStarGate();
                // if you flew here, arrive in the upper sky still piloting — descend to explore
                if (flying && ship) {
                    ship.pos.set(player.pos.x, SPACE_ARRIVE_Y, player.pos.z);
                    ship.vel.set(0,0,0); ship.pitch=0; ship.roll=0; ship.climbCmd=0;
                    player.pos.copy(ship.pos); player.yaw = ship.yaw;
                }
                flushProfileState();
                hideVoxelLoading();
                if (def && g.showMessage) g.showMessage((flying?'Descending toward ':'Arrived at ') + def.name + ' · ' + def.nameDa, 2600);
                if (typeof updateJournalHud === 'function') updateJournalHud();
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
            current: () => activePlanetId
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
        const _wingL = new THREE.Vector3(-1.9, 0.6, -1.2), _wingR = new THREE.Vector3(1.9, 0.6, -1.2);
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
        let _critTimer = 0, _chirpTimer = 3;

        // World height to stand on at a voxel column: top non-water solid, or null.
        function surfaceTopVox(vx,vz){
          for(let y=H-1;y>0;y--){ const b=getBlock(vx,y,vz); if(b){ return b===WATER ? null : y; } }
          return null;
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
          d.anim(elapsed, 'idle', dt);
        }

        /* ===================== FLIGHT ===================== *
         * Arcade Hero-ship flight (kid-forgiving): no stall, gentle
         * auto-hover, soft terrain lift instead of crashes. The ship is
         * the player's vehicle — while piloting, player.pos rides the
         * ship so chunk streaming / wildlife / camera all follow.
         *   WASD steer+thrust · Space up · Shift down · G to land        */
        // Arcade flight tuning — momentum-based; the nose flies where you point.
        const SHIP_TURN = 2.0;                   // keyboard yaw rate (rad/s)
        const SHIP_MAX  = 38;                    // top cruise speed
        const SHIP_BOOST = 1.7;                  // afterburner multiplier (Space + W)
        const SHIP_LIFT = 26;                    // vertical climb/dive speed
        const SHIP_RESP = 2.8;                   // velocity response — lower = more glide/inertia
        const SHIP_CEILING = SPACE_Y1 + 120;     // fly well past the space transition (~268)
        function shipGroundY(x,z){
          const t=surfaceTopVox(Math.floor(x),Math.floor(z));
          return (t!==null? t+1 : SEA_LEVEL+1) + WORLD_OFFSET.y;
        }
        function boardShip(){
          if(flying){ landShip(); return; }
          if(!_AS || !_AS.has('Interceptor')){ if(g.showMessage) g.showMessage('No ship available yet.',1600); return; }
          ship = _AS.build('Interceptor', { scale:0.8, tilt:0 });
          if(!ship){ return; }
          ship.pos = player.pos.clone(); ship.pos.y += 1.4;
          ship.vel = new THREE.Vector3();
          ship.yaw = player.yaw; ship.pitch = 0; ship.roll = 0;
          ship.climbCmd = 0; ship._prevYaw = player.yaw; ship._speed = 0; ship._boost = 0;
          ship.group.position.copy(ship.pos);
          ship.group.rotation.set(0, ship.yaw, 0);
          scene.add(ship.group);
          flying = true; _flyCamPos = null;
          makeShipTrails();
          requestViewPointerLock();           // capture the mouse so it steers the ship
          if(av && av.group) av.group.visible = false;
          if(fpPivot) fpPivot.visible = false;
          playSfx('jetpack');
          if(g.showMessage) g.showMessage('🚀 Liftoff! Mouse + WASD to fly · W thrust · Space up · G to land', 3600);
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
          const yawIn=(k.KeyA||k.ArrowLeft?1:0)-(k.KeyD||k.ArrowRight?1:0);
          const thr=(k.KeyW||k.ArrowUp?1:0)-(k.KeyS||k.ArrowDown?1:0);
          const upIn=(k.Space?1:0)-((k.ShiftLeft||k.ShiftRight)?1:0);
          // heading: keyboard yaw (mouse yaw is applied live in applyFlightMouse)
          ship.yaw += yawIn*SHIP_TURN*dt;
          const boosting = (thr>0 && k.Space);             // afterburner: Space + W
          const inSpace = ship.pos.y > SPACE_ENTER_Y;      // open space — worlds are far apart
          const spd = SHIP_MAX*(boosting?SHIP_BOOST:1)*(inSpace?1.7:1);
          _shipFwd.set(Math.sin(ship.yaw),0,Math.cos(ship.yaw));
          // vertical command: Space/Shift + a decaying mouse climb nudge
          const climb = THREE.MathUtils.clamp(upIn + (ship.climbCmd||0), -1, 1);
          ship.climbCmd = (ship.climbCmd||0)*Math.exp(-4*dt);
          // momentum: ease velocity toward the commanded target (gives weight + glide)
          const tvx=_shipFwd.x*thr*spd, tvz=_shipFwd.z*thr*spd, tvy=climb*SHIP_LIFT;
          const r=1-Math.exp(-SHIP_RESP*dt);
          ship.vel.x += (tvx-ship.vel.x)*r;
          ship.vel.z += (tvz-ship.vel.z)*r;
          ship.vel.y += (tvy-ship.vel.y)*r;
          // integrate
          ship.pos.x += ship.vel.x*dt; ship.pos.z += ship.vel.z*dt; ship.pos.y += ship.vel.y*dt;
          // soft terrain lift — rise over hills instead of crashing
          const minY=shipGroundY(ship.pos.x, ship.pos.z)+1.6;
          if(ship.pos.y < minY){ ship.pos.y = minY; if(ship.vel.y<0) ship.vel.y=0; }
          if(ship.pos.y > SHIP_CEILING){ ship.pos.y = SHIP_CEILING; if(ship.vel.y>0) ship.vel.y=0; }
          // ---- orientation derived from MOTION so it reads as real flight ----
          const hsp=Math.hypot(ship.vel.x,ship.vel.z);
          // nose pitches to match the actual climb/dive angle
          const pitchTarget=THREE.MathUtils.clamp(Math.atan2(ship.vel.y, Math.max(4,hsp)), -0.9, 0.9);
          ship.pitch += (pitchTarget - ship.pitch)*(1-Math.exp(-7*dt));
          // bank into the turn from the real yaw rate (keyboard + mouse)
          const yawRate=(ship.yaw-(ship._prevYaw!=null?ship._prevYaw:ship.yaw))/Math.max(dt,1e-4);
          ship._prevYaw=ship.yaw;
          const rollTarget=THREE.MathUtils.clamp(-yawRate*0.14, -0.75, 0.75);
          ship.roll += (rollTarget - ship.roll)*(1-Math.exp(-5*dt));
          ship.group.position.copy(ship.pos);
          ship.group.rotation.set(ship.pitch, ship.yaw, ship.roll);
          ship._speed=Math.hypot(ship.vel.x,ship.vel.y,ship.vel.z); ship._boost=boosting?1:0;
          ship.anim(elapsed, (thr>0||upIn>0||boosting)?'alert':'idle', dt);  // throttle drives flames/glow
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
        function updateFlightCamera(dt){
          if(!ship || !camera) return;
          // speed-reactive FOV + pullback sell the sense of speed
          const spd01=Math.min(1, (ship._speed||0)/(SHIP_MAX*1.3));
          const fov=72 + spd01*12 + (ship._boost?4:0);
          if(Math.abs(camera.fov-fov)>0.1){ camera.fov=fov; camera.updateProjectionMatrix(); }
          // rigid chase behind the tail in the SHIP's frame → view tilts with pitch/roll
          const q = ship.group.quaternion;
          _fcFwd.set(0,0,1).applyQuaternion(q);            // nose is +z
          _fcUp.set(0,1,0).applyQuaternion(q);
          const dist=8.5 + spd01*3.4;
          _fcDesired.copy(ship.pos).addScaledVector(_fcFwd,-dist).addScaledVector(_fcUp,3.0);
          if(!_flyCamPos) _flyCamPos=_fcDesired.clone();
          if(!_flyCamUp)  _flyCamUp=_fcUp.clone();
          _flyCamPos.lerp(_fcDesired, 1-Math.exp(-12*dt));
          _flyCamUp.lerp(_fcUp, 1-Math.exp(-10*dt)).normalize();
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

        /* ===================== COMBAT ===================== *
         * Forgiving by design (kid-first): generous HP, slow regen, a
         * gentle respawn instead of a harsh loss. Wonder over war —
         * hostiles are rare and telegraphed by colour + alert pose.   */

        // Damage the player's weapon does, derived from its power stat.
        function weaponDamage(){
          if(!weaponDef) return 3;
          const gp = weaponGameplayFor(weaponDef.id);
          return Math.max(2, Math.round((gp.power||0.4)*14));
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
            if(distP <= atkR && Math.abs(dy) < 2.6){            // in reach AND on the same level: strike
              if(cr.atkCd<=0){
                const inv=1/(distP||1);
                applyPlayerDamage(sp.dmg||10, -dxp*inv, -dzp*inv);
                cr.atkCd=sp.atkCd||1.3;
                playSfx('swordSwing');
              }
            } else {                                            // close the distance (ground)
              const inv=1/(distP||1), step=speed*dt;
              const nx=cr.pos.x - dxp*inv*step, nz=cr.pos.z - dzp*inv*step;
              const top=surfaceTopVox(Math.floor(nx),Math.floor(nz));
              if(top!==null){ cr.pos.x=nx; cr.pos.z=nz; cr.pos.y=top+1+WORLD_OFFSET.y; moving=true; }
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
                const top=surfaceTopVox(Math.floor(nx),Math.floor(nz));
                if(top===null) cr.target=null;
                else { cr.pos.x=nx; cr.pos.z=nz; cr.pos.y=top+1+WORLD_OFFSET.y; cr.face=Math.atan2(dx,dz); moving=true; } }
            }
          }
          return {moving, speed, aggroed:(distP<aggro)};
        }

        // Rare "prowling" hostile spawner — danger is special, not constant.
        let _hostileTimer = 18;
        function countHostiles(){ let n=0; for(const c of critters) if(c.hostile) n++; return n; }
        function maybeSpawnHostile(dt){
          if(!_AC) return;
          _hostileTimer-=dt;
          if(_hostileTimer>0) return;
          _hostileTimer = 14 + Math.random()*16;
          if(countHostiles()>=1) return;          // at most one prowler at a time
          if(Math.random()>0.55) return;          // ...and only sometimes
          const prowlers=_AC.DEFS.filter(d=>d.prowl);
          if(!prowlers.length) return;
          const sp=prowlers[(Math.random()*prowlers.length)|0];
          const px=Math.floor(player.pos.x), pz=Math.floor(player.pos.z);
          for(let tryN=0; tryN<8; tryN++){
            const ang=Math.random()*Math.PI*2, r=CRIT_MIN+Math.random()*(CRIT_VIEW-CRIT_MIN);
            const vx=px+Math.round(Math.cos(ang)*r), vz=pz+Math.round(Math.sin(ang)*r);
            const top=surfaceTopVox(vx,vz);
            if(top===null) continue;
            placeCritter(sp, vx, vz, top);
            if(g.showMessage) g.showMessage('Something is prowling nearby…', 1800);
            return;
          }
        }

        function updateCritters(dt){
          if(!CRITTERS_ENABLED){ if(critters.length) clearCritters(); return; }
          // maintain population
          _critTimer-=dt;
          if(_critTimer<=0){
            _critTimer=0.6;
            if(critters.length<CRIT_CAP) spawnOneCritter();
          }
          maybeSpawnHostile(dt);
          // occasional ambient call from a nearby calm critter
          _chirpTimer-=dt;
          if(_chirpTimer<=0){
            _chirpTimer=3+Math.random()*5;
            for(const cr of critters){
              if(cr.sp.shy) continue;
              if(Math.hypot(cr.pos.x-player.pos.x, cr.pos.z-player.pos.z)<22){ playSfx('critterChirp'); break; }
            }
          }
          for(let i=critters.length-1;i>=0;i--){
            const cr=critters[i];
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
              if(cr.sp.shy && startled){
                const inv=1/(distP||1);
                cr.target=new THREE.Vector3(cr.pos.x+dxp*inv*8, 0, cr.pos.z+dzp*inv*8);
                cr.state='walk'; speed=CRIT_SPEED*1.8; cr.timer=0.6;
              }
              if(cr.state==='idle'){
                cr.timer-=dt;
                if(cr.timer<=0){ cr.state='walk'; cr.timer=1.5+Math.random()*3;
                  if(fly){ const a=Math.random()*Math.PI*2, d=8+Math.random()*16; cr.target=new THREE.Vector3(cr.pos.x+Math.cos(a)*d,0,cr.pos.z+Math.sin(a)*d); }
                  else _pickWanderTarget(cr); }
              } else {
                cr.timer-=dt;
                if(!cr.target || cr.timer<=0){ cr.state='idle'; cr.timer=1+Math.random()*2.5; cr.target=null; }
              }
              if(cr.target){
                const dx=cr.target.x-cr.pos.x, dz=cr.target.z-cr.pos.z;
                const d=Math.hypot(dx,dz);
                if(d<0.25){ cr.target=null; cr.state='idle'; cr.timer=1+Math.random()*2; }
                else {
                  const step=Math.min(d, speed*dt), inv=1/d;
                  const nx=cr.pos.x+dx*inv*step, nz=cr.pos.z+dz*inv*step;
                  if(fly){                                            // flyers drift over anything
                    const t=surfaceTopVox(Math.floor(nx),Math.floor(nz));
                    const groundY=(t!==null? t+1 : SEA_LEVEL+1)+WORLD_OFFSET.y;
                    cr.pos.x=nx; cr.pos.z=nz;
                    cr.pos.y += (groundY+cr.flyH+Math.sin(elapsed*1.5+cr.phase)*0.6 - cr.pos.y)*Math.min(1,3*dt);
                    cr.face=Math.atan2(dx,dz); moving=true;
                  } else {
                    const top=surfaceTopVox(Math.floor(nx),Math.floor(nz));
                    if(top===null){ cr.target=null; }                 // hit water — stop
                    else { cr.pos.x=nx; cr.pos.z=nz; cr.pos.y=top+1+WORLD_OFFSET.y; cr.face=Math.atan2(dx,dz); moving=true; }
                  }
                }
              }
            }
            // drive the Actor: smooth face toward heading (+per-species mesh offset), set state, animate
            cr.group.position.copy(cr.pos);
            let d=(cr.face+(cr.sp.faceYaw||0))-cr.group.rotation.y;
            while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2;
            cr.group.rotation.y += d*(1-Math.exp(-10*dt));
            const actorState = (cr.alert>0.5 || cr.hurtT>0) ? 'alert' : (moving ? 'move' : 'idle');
            cr.actor.anim(elapsed, actorState, dt);
          }
        }

        // Scan raycast against creatures; returns the aimed critter or null.
        function pickCreature(){
          if(!creatureGroups.length) return null;
          ray.setFromCamera({x:0,y:0}, camera);
          const hits=ray.intersectObjects(creatureGroups, true);
          for(const h of hits){
            if(h.distance>14) break;
            let o=h.object; while(o){ if(o.userData && o.userData.critter) return o.userData.critter; o=o.parent; }
          }
          return null;
        }
        let _scanCreatureId=null;
        function fillCreatureScanContent(sp, expanded){
          const pseudo={ cat:sp.cat, name:sp.name, desc:sp.desc, tags:[sp.sci.kingdom||'Animal'],
            hardness:'—', sci:{ formula:sp.sci.formula, mineral:sp.sci.kingdom, fact:sp.sci.fact } };
          fillScanPanelContent(pseudo, sp.scanOn||1, 0, expanded);
        }
        function recordCreatureScan(sp){
          const AP=getProfileApi(); if(!AP || !AP.recordCreature) return;
          const { isNew }=AP.recordCreature(AP.load(), sp.id);
          if(isNew){ updateJournalHud(); if(g.showMessage) g.showMessage('Creature discovered: '+sp.name, 1800); }
        }

        function tick(dt) {
            if (g.keys) Object.assign(keys, g.keys);
            _hideLegacyEnvironment();
            if (g._hideLegacyPlayUI) g._hideLegacyPlayUI();
            // stream chunks around the player (load ahead, unload behind)
            streamAround(player.pos.x, player.pos.z);
            processBuildQueue(2.5);            // ms/frame — granular (per sub-chunk) so it spreads without spiking
            updateDayNight(dt);
            updateSky(dt);
            updateClouds(dt);
            updateWater(dt);
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
            updateMiningHold(dt);
            updateWeaponFx();
            if(matAnim){
                matAnim.map.offset.x=(((elapsed*5)|0)%4)*0.25;
                const p=0.9+0.1*Math.sin(elapsed*4); matAnim.color.setRGB(p,p,p);
            }
            if(decoMat&&decoMat.userData.shader) decoMat.userData.shader.uniforms.uTime.value=elapsed;
            const t = pickTarget();
            updateAimEdgeHighlight(t);
            updateMineBlockAnim();
            updatePlaceGhost(t);
            updateBlockScan(t);
            updateFormulaViewer(dt);
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
            }  // end on-foot update (skipped while piloting a ship)
            stepParts(dt);
            stepShotVfx(dt);
            updateCritters(dt);
            updateDrone(dt);          // Hero companion trails the player
            updateStarGate(dt);       // Ancient gate glow + proximity hint
            updatePlayerCombat(dt);   // health regen / i-frames / hurt flash + hearts HUD
            if(_AC) _AC.stepFx(dt);   // creature breath / spore / ember particles
            updateHUD();
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
        }

        function enter() {
            if (_active) return;
            _saveScene();
            _setupScene();
            _active = true;
            if (g.keys) Object.assign(keys, g.keys);
            loadOwnedWeapons();
            loadDrawerTab();
            loadHotbarLayout();
            loadInventoryFromProfile();
            weaponIndex = loadCharCfg().weapon;
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
                if (e.code === 'KeyO' && !voxelPanelOpen()) {
                    if (scanExpanded) {
                        setScanExpanded(false);
                    } else {
                        const shell = document.getElementById('voxel-scan');
                        if (shell && !shell.hidden && isScanCompactActive(pickTarget())) {
                            setScanExpanded(true);
                        }
                    }
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
                if (e.code === 'KeyG' && !voxelPanelOpen()) {
                    boardShip();
                    return;
                }
                if (e.code === 'KeyB') {
                    jetBoost = !jetBoost;
                    if (g.showMessage) g.showMessage('🚀 Jetpack boost ' + (jetBoost ? 'ON — hold Space to rocket up!' : 'off'), 1600);
                    return;
                }
                if (e.code === 'F8') {
                    e.preventDefault();
                    hideAimTuner();
                    if (firstPerson) showFpTuner();
                    else showTpTuner();
                }
                if (e.code === 'F9') {
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
                if (flying) return;        // piloting: no mining / placing / firing
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
                    mineRepeatCooldown = 0;
                    if (isMineLaser()) tryLaserMine();
                    else if (isPickaxe()) {
                        tryMineSwing();
                        mineRepeatCooldown = MINE_SWING_INTERVAL;
                    }
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
                } else if (btn === 0 && !isMineLaser() && !isPickaxe()) fireCombat();
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
                    streamInit();
                    spawnStarGate();
                    hideVoxelLoading();
                });
            })();
            renderHotbar();
            updateJournalHud();
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
            if (_profileFlushTimer) {
                clearTimeout(_profileFlushTimer);
                _profileFlushTimer = null;
            }
            flushProfileState();
            _active = false;
            hideVoxelLoading();
            setUnderwaterTint(false);
            disposeGearViewer();
            disposeThumbRenderer();
            clearCritters();
            if (ship) { scene.remove(ship.group); ship.dispose(); ship = null; }
            clearShipTrails(); clearSpace();
            clearStarGate();
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
