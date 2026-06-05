# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PJBoy is a 3D second-person maze game built with Three.js. It is a **static client-side site** — no build step, no bundler, no package.json, no npm dependencies, no automated tests. Everything runs directly in the browser from plain HTML/CSS/JS files served over HTTP.

## Commands

- **Run locally:** `./dev.sh` — serves the repo on `http://localhost:8000` (python3 http.server) and opens a browser. Override the port with `PORT=9000 ./dev.sh`. Any static server works (`python3 -m http.server`, `npx serve .`). Opening `index.html` via `file://` will fail because the GLTF/asset fetches are blocked by CORS.
- **"Lint" / syntax check:** `node -c game.js` (and likewise for the other JS files). This is exactly what CI does — there is no ESLint or formatter configured.
- **No test suite exists.** Verification is manual in the browser.

## Loading model & script order (critical)

Three.js is loaded as a **classic (non-module) global** from CDN at r128 — `window.THREE`, plus `GLTFLoader`, `SkeletonUtils`, and `peerjs`. There are no ES module imports; all game files are plain `<script>` tags that communicate through globals on `window`.

`index.html` loads scripts in a **required order** (each later file depends on globals defined earlier):

1. `multiplayer.js` → exposes `window.MultiplayerNet`
2. `openworld.js` → exposes `window.OpenWorldSystem`
3. `modes.js` → exposes `window.ModeRegistry` and `window.PJBOY_MODE_DEFS`
4. `game.js` → defines `AudioBus` and the `Game3D` class; instantiates `new Game3D()` on `DOMContentLoaded`
5. `game-modes-impl.js` → **patches `Game3D.prototype` after the class is defined** (see below)

**Cache-busting:** script tags carry `?v=N` query params (e.g. `game.js?v=103`). Bump the relevant `?v=` in `index.html` when you change a JS file, otherwise browsers (and GitHub Pages) serve a stale cached copy.

## Architecture

- **`game.js` (~12.5k lines)** is the bulk of the game: a single monolithic `Game3D` class holding nearly all state and logic — maze generation, player/camera, combat, enemies, inventory, themes, HUD, create mode, etc. — plus a small `AudioBus` class (procedural Web Audio synth, no audio asset files). Maze world is grid-based with AABB collision against `this.walls`.

- **`game-modes-impl.js`** extends `Game3D` at runtime via `Object.assign(Game3D.prototype, {...})` and adds meta-flow, campaign mode, arena results, and Creator mode. **It also re-wraps the core loop methods** `animate`, `render`, and `fixedUpdate` (capturing the originals and calling them through). The loop uses a fixed-timestep accumulator (`Game3D.FIXED_TIMESTEP`, `Game3D.MAX_FRAME_TIME`).
  - ⚠️ **Because of this, edits to `animate`/`render`/`fixedUpdate` in `game.js` are dead code unless mirrored in the wrapper in `game-modes-impl.js`.** Change loop behavior in the wrapper, not (only) in the base method.

- **`modes.js`** — `ModeRegistry` + `MODE_DEFS` map an `activeModeId` (e.g. `campaign`, `wide_halls`) to `enter`/`exit`/`update`/`checkWin`/`checkLose` hooks that drive the `Game3D` instance.

- **`openworld.js`** — `OpenWorldSystem`, a hub-and-spoke open world with portals to themed sub-worlds. Reuses the host `Game3D`'s player, camera, gravity, collision, and loop.

- **`multiplayer.js`** — `MultiplayerNet`, PeerJS WebRTC P2P with a **star topology** (host relays). Signalling via PeerJS's public broker; includes public STUN + Open Relay TURN servers. See the API doc comment at the top of the file.

- **Persistence:** game state is saved to `localStorage` under `pjboy.*` keys (e.g. `pjboy.campaignSave.v1`, `pjboy.campaignScores.v1`, `pjboy.audio`, `pjboy.mp.name`, `pjboy.arenaBestWave`).

- **Styles:** `style.css` is the main game UI; `style-meta.css` covers the meta/menu flow.

## 3D assets

GLTF/GLB models live at the repo root and under `assets/Blocks/` (Characters, enemies, environment, Animals, pixel blocks). The character has multiple variants (`Character_PJBoy_v1_minecraft`, `_v2_lowpoly`, `_v3_rigged`). `.blend` source files may be present but are not loaded at runtime.

## Deployment (GitHub Pages)

`.github/workflows/pages.yml` deploys to GitHub Pages on push to **`main`**. The build step copies a **fixed allowlist** of files into `_site` (top-level `*.js`, `*.glb`, `*.gltf`, `*.bin`, `index.html`, the two CSS files, plus `inmaze/` and `assets/` directories).

⚠️ **New top-level files that aren't covered by the existing copy globs must be added to `pages.yml`, or they will 404 on the live site.** (The directory copies of `assets/` and `inmaze/` are recursive, so new files inside those are fine.)

Note: the default branch for PRs in this repo is **`gameplay`**, but the live-deploy branch is **`main`**. `.github/workflows/ci.yml` runs the `node -c` syntax check on push/PR to `main`/`develop`.
