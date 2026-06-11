# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PJBoy is a **static client-side** 3D game site built with Three.js — maze modes, open world, voxel sandbox ("Asteroid"), spherical planet ("Tiny Planet"), arena, campaign, creator, and multiplayer. No build step, no bundler, no package.json, no npm dependencies, no automated tests. Everything runs directly in the browser from plain HTML/CSS/JS files served over HTTP.

## Commands

- **Run locally:** `./dev.sh` — serves the repo on `http://localhost:8000` (python3 http.server) and opens a browser. Override the port with `PORT=9000 ./dev.sh`. Any static server works (`python3 -m http.server`, `npx serve .`). Opening `index.html` via `file://` will fail because the GLTF/asset fetches are blocked by CORS.
- **"Lint" / syntax check:** `node -c game.js` (and likewise for the other JS files you changed). This is exactly what CI does for `game.js` — there is no ESLint or formatter configured.
- **No test suite exists.** Verification is manual in the browser.

## Loading model & script order (critical)

Three.js is loaded as a **classic (non-module) global** from CDN at r128 — `window.THREE`, plus `GLTFLoader`, `SkeletonUtils`, and `peerjs`. There are no ES module imports; all game files are plain `<script>` tags that communicate through globals on `window`.

`index.html` loads scripts in a **required order** (each later file depends on globals defined earlier):

1. `multiplayer.js` → `window.MultiplayerNet`
2. `openworld.js` → `window.OpenWorldSystem`
3. `worldstream.js` → `window.WorldStream` (infinite chunked open world)
4. `planetgen.js` → `window.PlanetGen` (deterministic planet catalog)
5. `planet.js` → `window.PlanetWorld` (spherical "Tiny Planet" mode)
6. `voxel-character.js` → `window.VoxelCharacter` (procedural voxel rig + weapons)
7. `voxelworld.js` → `window.VoxelWorld` (Asteroid voxel sandbox)
8. `modes.js` → `window.ModeRegistry` and `window.PJBOY_MODE_DEFS`
9. `game.js` → defines `AudioBus` and the `Game3D` class; instantiates `new Game3D()` on `DOMContentLoaded`
10. `game-modes-impl.js` → **patches `Game3D.prototype` after the class is defined** (see below)

**Cache-busting:** script and stylesheet tags carry `?v=N` query params (e.g. `game.js?v=151`). Bump the relevant `?v=` in `index.html` when you change a JS or CSS file, otherwise browsers (and GitHub Pages) serve a stale cached copy.

## Architecture

### Core maze host (`game.js` + `game-modes-impl.js`)

- **`game.js` (~12.5k lines)** is the bulk of the game: a single monolithic `Game3D` class holding nearly all state and logic — maze generation, player/camera, combat, enemies, inventory, themes, HUD, create mode, etc. — plus a small `AudioBus` class (procedural Web Audio synth, no audio asset files). Maze world is grid-based with AABB collision against `this.walls`.

- **`game-modes-impl.js`** extends `Game3D` at runtime via `Object.assign(Game3D.prototype, {...})` and adds meta-flow, campaign mode, arena results, and Creator mode. **It also re-wraps the core loop methods** `animate`, `render`, and `fixedUpdate` (capturing the originals and calling them through). The loop uses a fixed-timestep accumulator (`Game3D.FIXED_TIMESTEP`, `Game3D.MAX_FRAME_TIME`).
  - ⚠️ **Because of this, edits to `animate`/`render`/`fixedUpdate` in `game.js` are dead code unless mirrored in the wrapper in `game-modes-impl.js`.** Change loop behavior in the wrapper, not (only) in the base method.
  - **Asteroid mode:** `fixedUpdate` early-returns after `this.voxelWorld.update(dt)` — no maze combat, footsteps, or hero locomotion. `animate` skips sword viewmodel, placement ghost, and multiplayer tick. `game.js` also guards `updatePlayer` / `updateCamera` / input when `activeModeId === 'asteroid'`.
  - **Planet mode:** `planetWorld.update(dt)` runs in the normal `fixedUpdate` path after maze logic; movement/camera are delegated via guards in `game.js`.

- **`modes.js`** — `ModeRegistry` + `MODE_DEFS` map an `activeModeId` (e.g. `campaign`, `wide_halls`, `asteroid`, `planet`) to `enter`/`exit`/`update`/`checkWin`/`checkLose` hooks that drive the `Game3D` instance.

- **`openworld.js`** — `OpenWorldSystem`, a hub-and-spoke open world with portals to themed sub-worlds. Reuses the host `Game3D`'s player, camera, gravity, collision, and loop.

- **`worldstream.js`** — `WorldStream`, infinite chunk-streamed terrain with biome props. Reuses `Game3D` walls/collision and sky/fog.

- **`multiplayer.js`** — `MultiplayerNet`, PeerJS WebRTC P2P with a **star topology** (host relays). Signalling via PeerJS's public broker; includes public STUN + Open Relay TURN servers. See the API doc comment at the top of the file.

### Asteroid mode (`voxelworld.js` + `voxel-character.js`)

Self-contained voxel sandbox on a procedural asteroid: mine, build, jetpack, weapons, FP/TP camera (`F8`). Ported from an earlier `game-slice.html` prototype.

- **`voxelworld.js`** — `VoxelWorld` class wrapping a `createRuntime(game)` closure (~3.5k lines). Takes over `game.scene` / `game.camera` on `enter()`, restores on `exit()`. Own voxel grid, meshing, physics, HUD (`#voxel-overlay`), hotbar, block drawer, combat VFX, and camera (OTS third-person + first-person viewmodel).
- **`voxel-character.js`** — `window.VoxelCharacter`: procedural box-mesh character rig, weapon meshes, IK/animation. Used for the visible TP avatar and weapon posing; FP uses a separate viewmodel weapon on `fpPivot`.
- **UI:** `#voxel-overlay` in `index.html`; `body.mode-asteroid` in `style.css` hides the legacy maze HUD (`#ui`, compass, weapon HUD, etc.). `_hideLegacyPlayUI()` in `game-modes-impl.js` applies this when Asteroid is active.
- **Aim / combat (important):** one `resolveAim()` solve drives screen-center ray, muzzle origin, character IK, and shots. **Shift = focus aim** in both FP and TP (slows movement, tightens camera/FOV). Default move speed is run. In TP: crosshair only when idle; brief `shotVfx` beam/bolt traces on fire. Weapon mesh beams and `showWeaponBeam` are **FP-only** — disabling them in TP avoids double traces with shot VFX.
- **Persistence:** `localStorage` under `pjboy.voxelCharacter.v1`, `pjboy.voxelChar.v1`, `pjboy.voxelWeapons.owned.v1`, `pjboy.voxelFpTune.v1`, `pjboy.voxelTpTune.v1`.

### Tiny Planet mode (`planet.js` + `planetgen.js`)

- **`planetgen.js`** — pure-data `PlanetGen.generate(seed, count)` catalog (home world + procedural neighbors).
- **`planet.js`** — `PlanetWorld`: finite spherical planet with radial gravity, fly-off camera, GLTF props, mine/build. Reuses host player rig; `game.js` delegates `updatePlayer` / `updateCamera` / click-to-mine when `activeModeId === 'planet'`.

### Persistence (maze / meta)

Game state is saved to `localStorage` under `pjboy.*` keys (e.g. `pjboy.campaignSave.v1`, `pjboy.campaignScores.v1`, `pjboy.audio`, `pjboy.mp.name`, `pjboy.arenaBestWave`).

### Styles

- **`style.css`** — main game UI plus Asteroid voxel HUD (`#voxel-cross`, `#voxel-hud`, `.vx-drawer`, etc.).
- **`style-meta.css`** — meta/menu flow.

## 3D assets

GLTF/GLB models live at the repo root and under `assets/Blocks/` (Characters, enemies, environment, Animals, pixel blocks). The maze character has multiple variants (`Character_PJBoy_v1_minecraft`, `_v2_lowpoly`, `_v3_rigged`). Asteroid uses procedural voxel meshes, not GLTF characters. `.blend` source files may be present but are not loaded at runtime.

## Deployment (GitHub Pages)

GitHub Pages is configured as **legacy / "deploy from a branch"**, serving the **root of `main` directly** (`gh api repos/<owner>/pjboy/pages` → `build_type: legacy`, `source: {branch: "main", path: "/"}`). So **whatever is in `main`'s root is the live site** — there is no `_site` build step or `gh-pages` branch in the live path. Pushing to `main` triggers GitHub's automatic "pages build and deployment".

⚠️ Because Pages serves `main`'s root as-is, **every committed top-level file is published** — no allowlist to maintain. (Note: `.github/workflows/pages.yml` contains an `actions/deploy-pages` workflow that builds a `_site` allowlist, but it is **ignored** while the Pages source is the legacy branch. A separate legacy "CI/CD Pipeline" job tries to `git push origin gh-pages` and fails with 403 — harmless dead noise, since no `gh-pages` branch is used.)

Note: **`main`** is the single primary branch — it is the GitHub default (PR base), the live-deploy branch, and where bump-and-ship work lands. `.github/workflows/ci.yml` runs the `node -c` syntax check on push/PR to `main`/`develop`. After changing a JS file, bump its `?v=N` in `index.html` (see "Cache-busting" above) so the live site doesn't serve a stale cached copy.
