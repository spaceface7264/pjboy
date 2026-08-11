# Asteroid mode — design review

Status: **review + feature specs** (partially shipped). Save-safety, shelter pathing,
lamps, doors, and night survival landed on `main`. Remaining polish (missions tier-2,
F8/F9 gate, tagline, claim copy, planet fanfare) tracks on `feat/asteroid-polish`.

Original snapshot was against `main` at `b407014`. Scope is **Asteroid mode only**.

Audience north-star (from `CLAUDE.md`):

> PJBoy — especially **Asteroid mode** — is primarily a game the owner is building
> **for their 7-year-old child**. The intended experience is **fun, gently challenging,
> and educational**.

That means: bilingual Danish→English, short text, achievable goals, forgiving fails,
science-first scanner cards, and **local same-device co-op** — not online PeerJS.

---

## Top five findings

These contradict the north-star hardest. Ranked by kid impact.

1. **Shelters do not protect.** Hostile pathing snaps to the top solid of a column
   (`surfaceTopVox`), and attacks ignore walls/ceilings — only distance + vertical gap
   matter. A roofed base is not a base. (`voxelworld.js` ~9066, ~9841–9852)
2. **Night survival is requested but the global cycle is off.**
   `DAYNIGHT_ENABLED = false`. Only Aquaria opts into day/night via planet spec.
   Lamp claims to emit light but `glowColor` is never consumed. (`voxelworld.js` ~1053,
   Lamp ~641; Aquaria `asteroid-profile.js` ~178–180)
3. **No doors.** Circuit's scanner text promises "doors, drones, and turrets" —
   none exist. Water's `solidAt` exception is the only soft-collision precedent for
   a door pass-through. (`voxelworld.js` ~639, ~3445–3448)
4. **The mission chain ends with a false promise.** After five surveys the claim
   screen says "more missions coming" with nothing behind it. Planets unlock by
   count, silently. (`game-modes-impl.js` ~926–928; `asteroid-profile.js` ~132–185)
5. **Save-overwrite risk is fixed on main** (`b407014`). Frozen JSON + cloud code
   remain the recovery path. New features that touch profile saves must keep the
   load-modify-save pattern `persistBlockEdit` already uses.

---

## 1. Gameplay loop

### Minute-to-minute

Spawn on Verdant → walk / jetpack → hold **Shift** to scan → mine with the
minecutter → stuff the backpack → place from the quickbar → open **Tab** Refinery
to craft → repeat while the field journal advances.

Reward moments that already work:

- Scanner card pop (English name + Danish underneath + science fact)
- First block placed
- First craft (Lamp, then TNT)
- Star Gate / Gate Key planet travel
- TNT blast

### Where the loop goes slack

- **Missions 4–5 are a crafting wall.** They require knowing Tab → Refinery, having
  Iron→Metal / Sand→Glass, and the arithmetic recipes. For a 7-year-old this is the
  first real friction after three discoverable goals.
- **Post-chain vacuum.** After TNT, the claim screen promises more missions and
  then offers only freeform cataloging. No build goals, no travel goals, no
  creature goals, no "survive the night."
- **Silent planet unlocks.** Completing surveys grants Frostpeak / Mycelia / etc.
  by `missionsDone` count with no fanfare and no map pin.

### Onboarding

Flow: title → profile (if no name) → character (if not setup) → mode select →
Your claim → Start expedition. (`game-modes-impl.js` ~633–656)

| Screen | Notable string | Source |
|---|---|---|
| Title | "128-bit maze action" | `index.html` ~287–289 |
| Profile | "Your explorer name — saved on this device for now" | `index.html` ~292–295 |
| Character | "Class and look for Asteroid expeditions" | `index.html` ~300–301 |
| Claim (done) | "All starter surveys complete. Keep cataloging — more missions coming." | `game-modes-impl.js` ~926–928 |

Gaps for a first session:

- No tutorial. Controls live in the **H** drawer.
- Mission 1's **Shift**-to-scan is easy to miss if the journal is collapsed.
- **F8 / F9** open FP/TP and aim tuners on first entry for anyone who taps them
  (`voxelworld.js` ~10661–10670). Dev-facing on a kid's keyboard.
- Title tagline still sells the maze game, not Asteroid.

### Wayfinding

`updateWaypointHud` (`voxelworld.js` ~8246–8295) drives player-set map pins only.
Missions never place a waypoint. Arrival clears the pin with "Waypoint reached!" —
nothing points at the next survey objective.

### Co-op

`CLAUDE.md` says co-op is **local same-device**. Code reality: PeerJS online path in
`game.js` / `multiplayer.js` for maze; Asteroid has no split-screen. The comment
"THE multiplayer primitive" on `persistBlockEdit` means profile save plumbing, not
local co-op.

### Bilingual coverage (short audit)

Strong: scanner names (`BLOCK_DA`), mission title/desc pairs, planet names,
claim-screen mission DA lines, save-failure toast (post-fix).

Weak / English-only surfaces that a Danish-first kid hits:

- Title tagline and many meta chrome labels
- Refinery recipe UI chrome (card grids improved, but labels skew EN)
- Many HUD toasts ("Waypoint reached!", jetpack tip, gate messages)
- Creature / weapon drawer filter names
- F8/F9 tuner chrome

---

## 2. Story

There is no premise, arc, or ending for Asteroid. The title still reads like a
128-bit maze action game. The built-but-gated cast would support a frame if woken:

| Entity | Role | State |
|---|---|---|
| Curator | Friendly NPC | `spawn:false` (`asteroid-creatures.js` ~729–732) |
| Sentinel | Ancient hostile | gated |
| Warden | Boss | gated |
| Dustwurm | Boss | gated |
| Aquaria lore | Coastal traders, tide caves | Spec notes only — nothing reads `population` / `exploration` yet |

**Proposal (not in this PR):** a Curator-narrated frame — short bilingual lines at
first scan, first craft, first night, first Gate Key — that turn the five surveys
into chapter one of "chart the claim."

---

## 3. Missions

### Current chain (all sequential; no per-id unlock field)

| # | id | Goal | EN | DA |
|---|---|---|---|---|
| 1 | `first_scan` | `scan` ×1 | First reading — Hold Shift… | Første aflæsning — Hold Shift… |
| 2 | `catalog_three` | `scan_unique` ×3 | Mineralogist — Catalog three… | Mineralog — Katalogisér tre… |
| 3 | `place_block` | `place` ×1 | Foundations — Place a block… | Fundament — Placér en blok… |
| 4 | `craft_lamp` | `craft` Lamp (34) ×1 | Camp light — Craft a Lamp… | Lejrlys — Byg en lampe… |
| 5 | `craft_tnt` | `craft` TNT (45) ×1 | Pack a charge — Craft TNT… | Lav en sprængladning — Lav TNT… |

Source: `asteroid-profile.js` ~13–49.

Planet grants by **completed count** (`asteroid-profile.js` ~132–185):

| Planet | missionsDone |
|---|---|
| Verdant | 0 (home) |
| Frostpeak | 1 |
| Aquaria | 1 |
| Mycelia | 2 |
| Dustfall | 3 |
| Ember | 4 |

Done state: "All surveys complete" / "Alle opgaver fuldført", plus the claim-screen
"more missions coming" copy.

### Proposed tier-2 goals (for later)

New goal types the journal already almost wants: `travel` (reach a planet),
`depth` (mine below Y), `build` (place N of a type), `creature` (scan/photograph),
`survive_night` (see §6). Reward codex/bestiary completion with a craft unlock or
cosmetic, not another dead-end toast.

---

## 4. Blocks

**45** registry entries (ids 1–45), categories Terrain / Life / Resources / Crystals /
Crafted / Hazards. Educational coverage is a strength: essentially all described,
nearly all with real `sci:` formulae.

### Functional today

| Block | Works? |
|---|---|
| TNT (45) | Yes — fuse, blast, chain, lava ignite |
| Gate Key (41) | Yes — spends to wake dormant gates / grant travel |
| Water (40) | Yes — non-solid, flood, swim |

### Broken promises / missing function

| Block | Claims | Reality |
|---|---|---|
| Lamp (34) | Warm panel light | Placeable craft; `glowColor` unused — **no light** |
| Circuit (33) | Brain of doors, drones, turrets | Craft + upgrade ingredient only |
| Gold (24) | Trade currency flavor | Mineable ore, no economy |
| Uranium (28) | Keep distance / radioactive | Visual only, no hazard |
| Aether (9) | Powers warp cells | Flavor ore |
| Wrench weapon | Repair flavor in class kit | No repair loop in Asteroid |

Nothing functional beyond TNT and Gate Key for "base" fantasy: no storage, doors,
workbench block, or growing plants.

---

## 5. Items, inventory, crafting

### Model

Block-id inventory, unlimited stacks/capacity, no loss on death. For a 7-year-old
that forgiveness is correct — keep it.

### Refinery strengths

- Live have/need counts on cards
- Arithmetic recipe text (e.g. 2 Iron → 1 Metal)
- TNT packs **2** from 3 Carbon + 2 Sand — a nice multiplication beat

### Recipes (8)

| id | Out | In |
|---|---|---|
| `smelt_metal` | Metal ×1 | Iron Ore ×2 |
| `smelt_glass` | Glass ×1 | Sand ×2 |
| `wire_lamp` | Lamp ×1 | Metal + Glass |
| `print_circuit` | Circuit ×1 | Copper ×2 + Glass |
| `forge_alloy` | Alloy ×1 | Titanium ×2 + Metal |
| `press_hull` | Hull ×1 | Alloy ×2 + Metal |
| `craft_gatekey` | Gate Key ×1 | Crystal ×3 + Metal |
| `pack_tnt` | TNT ×2 | Carbon ×3 + Sand ×2 |

Gaps: no recipes for the toy blocks kids spam-place; no undo / fill / copy tools;
doors (when added) need a craft path — see §7.

---

## 6. Weapons & combat

### Registry (9)

`voxel-character.js` ~27–55: pickaxe (retired in Asteroid), wrench, sword, blaster,
laser, **minecutter** (sole mining tool), plasma, **railgun**, detonator (always
granted).

### Gating gap

`ownedWeapons` exists and starters grant minecutter + plasma, but Equip still
`ownedWeapons.add(idx)` from the All filter — weapons are effectively free-equip.
`CLAUDE.md` already flags this. Railgun trivializes the only real threat once found.

### Tiers vs code

Power / speed fields are documented on tiers but combat reach is largely
tier-independent (recent 5× reach change). Hit feedback is thin: no hitmarker,
damage numbers, or hit shake; a miss still plays full fire VFX.

### Threat content

Six mostly harmless critters + rare prowlers (Cinderhound / Razorpede). Bosses
(Warden, Dustwurm) and Curator/Sentinel are unspawnable. Damage model is
appropriately gentle; Peaceful mode skips hostiles. Drone upgrade is high value
for a young player.

### Shelter bug (load-bearing for night)

```text
updateHostile:
  attack if dist <= atkR AND |dy| < 2.6   // no LoS / solidAt
  else move toward player and snap Y to surfaceTopVox(nx,nz)
```

`surfaceTopVox` returns the highest non-water solid — so a creature "climbs" onto
a roof instantly and can strike through a thin ceiling. **Night survival is not
shippable until this is fixed.**

---

## 7. Speed & technical health

### Load

Off-mode JS still ships on the Asteroid path; boot-time GLTF preloads and dead root
assets inflate first paint. Pages deploy copies the whole tree.

### Frame rate

Draw-call bound: characters are `THREE.Group`s of boxes with no instancing;
outlines can double cost. `adaptQuality` (`voxelworld.js` ~2425–2444) mostly levers
`VIEW_R` (live ~20–48). Ships already use `InstancedMesh` — characters/creatures
do not.

### Memory / save cost

- `persistBlockEdit` does load-modify-save per edit (correct for safety; costly at
  spam-place rates). TNT path batches via `upsertBlockEdits`.
- Edit list is unbounded across a long claim life.
- Whole-column remeshes on edit; exit path has known dispose leaks; VFX often
  unpooled.

### Movement

`MOVE_RUN_SPEED = 6.4`, `MOVE_ADS_SPEED = 1.7` (~3.8× slowdown when focus-aiming),
crouch ×0.45. Ship speed can outrun the streamer at high thrust.

---

## 8. Save safety (current state)

Fixed on `main` (`fix/save-safety` → `b407014`):

- Meta `_savePlayerProfile` rebases onto storage and merges only menu-owned fields
- Character editor reloads before drafting
- Failed `localStorage` writes log + raise `pjboy:saveFailed` (throttled on-screen warn)

Rules for upcoming features:

1. Never write a long-lived in-memory profile snapshot back wholesale.
2. Block toggles (doors) must go through `persistBlockEdit` or a batched equivalent.
3. Debounce rapid toggles so open/close spam cannot thrash storage.
4. Keep frozen JSON export as the corruption rollback; cloud remains a live mirror.

---

# Feature spec A — Night survival

Kid ask: *when night comes, creatures appear, and he has to defend and survive.*

## A0. Prerequisite — shelter pathing (must ship first)

Without this, night is unfair.

1. **Step-height clamp** when hostiles move via `surfaceTopVox`: allow at most
   ~1.25 block upward step per move; if the top is higher, treat as blocked / path
   around (or idle), do **not** teleport onto roofs.
2. **No attack through solids:** before `applyPlayerDamage`, require a clear line
   (sample `solidAt` along the segment) **or** at minimum reject attacks when a
   solid block sits between creature eye and player torso.
3. Teach `surfaceTopVox` (or a sibling) about future non-solid ids (open doors),
   same spirit as `WATER`.

## A1. Enable and tune the cycle

- Flip global `DAYNIGHT_ENABLED` to `true` **or** enable via home-planet spec so
  Verdant gets a cycle without surprising Aquaria's existing 12‑min setting.
- Target feel for a 7-year-old session: full cycle ~6–8 minutes, **night ~90 seconds**
  of real threat time (dusk telegraph + night + dawn). Derive phase windows from
  `dayTime` (0 sunrise … 0.75 midnight).
- Reuse `updateDayNight` / `applyDaySky` already wired into the fixed step.

### Phase machine (bilingual beats)

| Phase | Feel | Toast (EN / DA) |
|---|---|---|
| Day | Normal wildlife | — |
| Dusk | Light cools; warning | "Night is coming — find shelter." / "Natten nærmer sig — find ly." |
| Night | Hostiles active | "Night falls. Survive until dawn." / "Natten falder på. Overlev til daggry." |
| Dawn | Hostiles leave; reward | "You made it through the night!" / "Du klarede natten!" |

## A2. Spawner

- Do **not** raise `CRIT_CAP` (8) — that hitch is real on low-end machines.
- At night start: pause / despawn peaceful wildlife pressure; stagger **2–3** prowler
  spawns over ~3–5 seconds (existing `prowl:true` defs: Cinderhound, Razorpede).
- Keep Peaceful mode as a hard skip (already honored in `updateHostile`).
- At dawn: despawn night hostiles (fade or walk-off), restore daytime critter rules.

## A3. Safety rails & reward

- HUD countdown or phase chip during dusk/night (short text).
- Forgiving respawn: keep current gentle damage; dying at night respawns at claim /
  bed-equivalent without wiping inventory (matches existing no-loss model).
- Optional mission `survive_night` (`goal.type = 'survive_night'`) as tier-2 after
  Lamp craft — teaches why Lamp + walls matter.
- Settings: respect Peaceful; consider a "Always day" parent toggle later.

## A4. Lamp must actually light

Promote the Lamp finding from cosmetic to **prerequisite**. Options (pick one):

1. Small `PointLight` (or pooled lights) attached to placed Lamp blocks within
   `VIEW_R`, capped (e.g. 8 nearest) for perf.
2. Cheaper: emissive material + localized ambient boost in a radius.

Without this, "camp light" mission 4 is a lie at night.

## A5. Save / content touchpoints

- No new profile schema required for the cycle itself (runtime).
- `survive_night` mission adds a progress counter via existing mission machinery.
- Do not bake night into cloud snapshots beyond mission progress.

## A6. Acceptance checks

- [ ] Roofed 3×3 shelter: prowler cannot stand on the roof via snap; cannot damage
      through the ceiling.
- [ ] Peaceful: no night hostiles, cycle cosmetics still run.
- [ ] Night ~90s; dusk warning fires once per cycle.
- [ ] Dawn despawns hostiles; reward toast once.
- [ ] Lamp visibly lights a dark area.
- [ ] Aquaria's existing dayNight spec still behaves.
- [ ] No silent profile wipe paths introduced.

---

# Feature spec B — Doors

Kid ask: *doors so he can add them to his buildings.*

## B1. Block model

Two block ids (or one id + metadata — prefer **two ids** to match the dumb voxel
grid and existing edit list):

| State | Behavior |
|---|---|
| Door Closed | Solid for collision / occlusion; shows closed tile |
| Door Open | **Non-solid** (extend `solidAt` like water); shows open tile |

Mining either state yields **one** inventory item (Closed id). Placing always
places Closed. Toggle swaps ids in-world and persists the edit.

## B2. Interaction

- Key: **F** (check conflicts with existing binds; document in H drawer).
- Range: mining/aim reach.
- Raycast target must be a door block; toggle closed ↔ open.
- Multiplayer-ready: go through `setBlockEvent` → `persistBlockEdit` (or batch).
- Debounce toggles (~150–200ms) so spam cannot thrash `localStorage`.

## B3. Collision & AI

```text
solidAt: return false for WATER and DOOR_OPEN (and air)
surfaceTopVox / hostile step: treat DOOR_OPEN as non-standable empty
```

Player walks through open doors. Closed doors block like Alloy. Night hostiles
must respect the same rules (ties to A0).

## B4. Content checklist

- [ ] Registry entries (Closed + Open) with category Crafted
- [ ] Atlas / tile painter frames for both states
- [ ] `BLOCK_DA` Danish name (e.g. Door / Dør)
- [ ] Scanner `sci:` card (hinges / simple machines — age-appropriate)
- [ ] Craft recipe (suggest: 2 Hull or 2 Alloy + 1 Circuit — gives Circuit a sink
      that matches its flavor text)
- [ ] Hotbar placement + journal optional `craft_door` mission later
- [ ] H-drawer control line for F
- [ ] Open state **not** separately craftable / not a backpack id

## B5. Acceptance checks

- [ ] Place door in a wall gap; closed blocks movement; F opens; walk through; F closes.
- [ ] Edit survives leave/rejoin and cloud reconcile (single upsert per toggle).
- [ ] Hostile cannot attack through a closed door; can path through open if A0 done.
- [ ] Mining open or closed returns one Door item.
- [ ] Danish scanner line present.
- [ ] Rapid F spam does not drop frames or corrupt saves.

---

## Suggested build order (after this doc is approved)

1. **`fix/shelter-pathing`** — A0 alone. Small, testable, makes today's bases real.
2. **`feat/lamp-light`** — A4. Makes mission 4 honest before night ships.
3. **`feat/doors`** — Spec B. Uses water/`solidAt` precedent; teaches Circuit a real sink.
4. **`feat/night-survival`** — A1–A3, optionally `survive_night` mission.
5. Mission tier-2 / Curator frame / weapon gating / draw-call work — larger follow-ons.

`main` stays deploy-only for reviewed merges. Keep frozen JSON backups before each
feature lands on the live profile.

---

## Quick wins vs bigger efforts

### Quick wins

| Win | Why |
|---|---|
| Shelter pathing fix | Makes every built base meaningful today |
| Lamp emits light | Honors mission 4 + enables night |
| Doors (closed/open ids) | Direct kid ask; Circuit finally useful |
| Soften / gate F8–F9 | Stop accidental tuner opens |
| Replace title tagline on Asteroid path | Stop selling the wrong game |
| Mission wayfinding pin | Point survey 1–3 at something tangible |
| Honest claim copy when chain ends | Drop "more missions coming" until true |

### Bigger efforts

| Effort | Why |
|---|---|
| Night survival + `survive_night` | Kid ask; needs A0 + Lamp first |
| Mission tier-2 + planet fanfare | Fills post-chain vacuum |
| Curator narrative frame | Uses built assets; bilingual story beats |
| Craft-gated weapons | Stops railgun trivializing threat |
| Character/creature instancing | Real FPS headroom |
| Local same-device co-op | Matches CLAUDE north-star; large |

---

## Citation index (primary)

| Topic | Where |
|---|---|
| North-star | `CLAUDE.md` ~9–16 |
| Missions / recipes / planets | `asteroid-profile.js` ~13–185 |
| Day/night master switch | `voxelworld.js` ~1053–1057, ~1330–1332 |
| `solidAt` / water | `voxelworld.js` ~3445–3448 |
| Lamp / Circuit copy | `voxelworld.js` ~638–642 |
| `surfaceTopVox` / hostiles | `voxelworld.js` ~9066–9068, ~9841–9852 |
| Waypoints | `voxelworld.js` ~8246–8295 |
| Movement speeds | `voxelworld.js` ~3510–3512 |
| Claim "more missions" | `game-modes-impl.js` ~926–928 |
| Weapons list | `voxel-character.js` ~27–55 |
| Gated cast | `asteroid-creatures.js` ~725–752 |
| Save-safety fix | `game-modes-impl.js` `_savePlayerProfile`; `asteroid-profile.js` `writeJSON` |
| Prior world-content proposal | `docs/asteroid-world-content-plan.md` |

---

## Playtest checklist (`feat/asteroid-polish` — do not merge until approved)

Test on a **throwaway local profile** first (cloud link pushes world edits).

1. **Missions** — After TNT survey, next is **Fit a door**, then **First night**. Tips show in HUD + claim screen.
2. **Door** — Craft (2 Alloy + 1 Circuit), place, **F** opens/closes; hostiles respect closed doors.
3. **Lamp** — Place lamp: self-lit look + light reaches ~56 blocks.
4. **Night** — Wait for dusk → night → dawn toast; **First night** survey completes at dawn.
5. **Tuners** — Plain F8/F9 do nothing; **Shift+F8** / **Shift+F9** open tuners.
6. **Title** — Tagline reads “Mine, build, explore — learn as you go”.
7. **Chain end** — After all 7 surveys: honest “chart new planets…” copy (no “more missions coming”).
8. **Planet fanfare** — Completing surveys that unlock a world shows “New world charted…”.
9. **Cloud** — With Supabase resumed + linked code: Save / Load on a small build; large bases need the 12MB limit.
10. **Save safety** — Place blocks, edit claim name, reload — blocks still there.
