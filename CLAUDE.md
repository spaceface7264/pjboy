# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PJBoy is a **static client-side** 3D game site built with Three.js — maze modes, open world, voxel sandbox ("Asteroid"), spherical planet ("Tiny Planet"), arena, campaign, creator, and multiplayer. No build step, no bundler, no package.json, no npm dependencies, no automated tests. Everything runs directly in the browser from plain HTML/CSS/JS files served over HTTP.

## Audience & design north-star (drives Asteroid-mode decisions)

PJBoy — especially **Asteroid mode** — is primarily a game the owner is building **for their 7-year-old child**. The intended experience is **fun, gently challenging, and educational**. Concretely:

- **Bilingual Danish→English learning.** The child reads well in Danish and is learning English. The block **scanner** is the main vehicle: it shows each block's name **English-forward with the Danish word underneath** (`BLOCK_DA` map in `voxelworld.js`), while the science `sci:` facts stay in English as reading practice.
- **Education as a first-class feature**, not flavor: real-science scanner facts, crafting as counting/math, planets teaching gravity/day-night/biomes; bias content toward **science and animals**.
- **Keep it age-appropriate:** short/simple on-screen text, achievable goals, forgiving fail states, cozy/comprehensible worlds over one overwhelming map.
- **Co-op is LOCAL same-device** (split/shared screen — "play with a parent"), **not** the online PeerJS path. Do not build network world-sync for this audience.

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
7. `meta-char-preview.js` → `window.MetaCharPreview` (live character-editor preview in the meta flow)
8. `asteroid-profile.js` → `window.AsteroidProfile` (unified per-player save: name, character, claim, journal, inventory, missions, crafting recipes)
9. `voxelworld.js` → `window.VoxelWorld` (Asteroid voxel sandbox)
10. `modes.js` → `window.ModeRegistry` and `window.PJBOY_MODE_DEFS`
11. `game.js` → defines `AudioBus` and the `Game3D` class; instantiates `new Game3D()` on `DOMContentLoaded`
12. `game-modes-impl.js` → **patches `Game3D.prototype` after the class is defined** (see below)

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

- **`voxelworld.js`** — `VoxelWorld` class wrapping a `createRuntime(game)` closure (~6k lines). Takes over `game.scene` / `game.camera` on `enter()`, restores on `exit()`. Own voxel grid, meshing, physics, HUD (`#voxel-overlay`), hotbar, block drawer, combat VFX, and camera (OTS third-person + first-person viewmodel).
  - **World grid:** fixed flat voxel volume **`W=96, H=32, D=96`** (chunked at `CH=16`). Deterministic from `SEED`; the asteroid silhouette comes from a radial falloff scaled by `ASTEROID_RXZ` (`= W/2-2`), and fixed-count scatter (ore veins, hives, trees) is scaled by footprint area via `oreScale` so density holds at any `W/D`. The mesher is **already chunked** (`scene3.chunks`, `buildChunkMesh`, `rebuildChunkAt`, `rebuildWorld`) — the only hard limit on world size is the fixed bounds, not the rendering. Block edits are a flat `{x,y,z,id}` list that funnels through `setBlockEvent` / `persistBlockEdit`.
  - **Scanner (educational):** `fillScanPanelContent` shows the block's English name with the Danish word beneath it (`BLOCK_DA` map) plus `sci:` formula/mineral/fact. See the audience section above.
  - **Refinery crafting:** a `Refinery` tab in the Tab drawer (`renderRefineryBody` / `craftRecipe`) crafts `AsteroidProfile.CRAFT_RECIPES` (smelt Metal/Glass, wire Lamp) from backpack materials; crafting calls `AsteroidProfile.recordCraft` so the matching mission advances. Missions live in `asteroid-profile.js` (`MISSIONS`, goal types `scan`/`scan_unique`/`place`/`craft`); the on-screen objective HUD (`updateJournalHud`) stays pinned and shows "Surveys complete" when the chain is done.
- **`asteroid-profile.js`** — `window.AsteroidProfile`: the unified per-player save under **`pjboy.profile.v1`** (name, character cfg, claim seed+edits, journal/missions, inventory). One JSON document, cloud-shaped. Pure helpers (`load`/`save`, `missionProgress`, `recordScan`/`recordPlace`/`recordCraft`, `craftAvailability`, `upsertBlockEdit`, `claimSummary`); also `syncLegacyKeys` bridges the older `pjboy.voxel*` keys.
- **`voxel-character.js`** — `window.VoxelCharacter`: procedural box-mesh character rig, weapon meshes, IK/animation. Used for the visible TP avatar and weapon posing; FP uses a separate viewmodel weapon on `fpPivot`. `meta-char-preview.js` (`window.MetaCharPreview`) renders the live preview in the meta character-editor flow.
- **UI:** `#voxel-overlay` in `index.html`; `body.mode-asteroid` in `style.css` hides the legacy maze HUD (`#ui`, compass, weapon HUD, etc.). `_hideLegacyPlayUI()` in `game-modes-impl.js` applies this when Asteroid is active.
- **Aim / combat (important):** one `resolveAim()` solve drives screen-center ray, muzzle origin, character IK, and shots. **Shift = focus aim** in both FP and TP (slows movement, tightens camera/FOV). Default move speed is run. In TP: crosshair only when idle; brief `shotVfx` beam/bolt traces on fire. Weapon mesh beams and `showWeaponBeam` are **FP-only** — disabling them in TP avoids double traces with shot VFX.
- **Persistence:** primary save is `pjboy.profile.v1` (above). Legacy/per-system keys still in use: `pjboy.voxelCharacter.v1`, `pjboy.voxelChar.v1`, `pjboy.voxelWeapons.owned.v1`, `pjboy.voxelFpTune.v1`, `pjboy.voxelTpTune.v1`, `pjboy.voxelInvTab.v1`, `pjboy.voxelHotbar.v1`.

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
