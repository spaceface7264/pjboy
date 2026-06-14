# Asteroid — World Content Plan (ruins, volcanoes, regions, POIs)

Status: **proposal / not yet implemented.** This is the design plan for giving each
Asteroid planet its own explorable, world-relevant content. Nothing in here is built
yet except the foundations it leans on (the Actor contract, the planet `spec` template,
the biome remap system).

## Audience north-star (read first)

This is built for a **7-year-old** learning **Danish→English** through play. Every
structure/landmark added here must:

- Be **discoverable and rewarding**, not punishing — no instant-death lava, no
  unfair dungeon traps. Forgiving fail states (matches existing combat design).
- Carry a **scanner card** with an English-forward name, the **Danish word underneath**
  (`BLOCK_DA` in `voxelworld.js`), and a real-science `sci:` fact. A volcano teaches
  *why lava is hot*; a ruin teaches *who might have built it*. Education is the point.
- Have **short, simple on-screen text** and a clear "you found something" moment.
- Bias toward **science and space** (e.g. a fossil dig, a geyser field, a nesting site).

---

## 1. Where we are today

| Thing | State | Varies per world? |
|---|---|---|
| Height / caves / ores | ✅ `columnProfile`, `caveAt`, `oreAt` (`voxelworld.js`) | By seed only (same algorithm) |
| Biome surface remap | ✅ `BIOME_THEMES` (`voxelworld.js:904`) | Yes — block colors + sky palette |
| Trees | ✅ `isTreeRoot`/`genColumn` (`voxelworld.js:1393`) | Same algorithm everywhere |
| Creatures | ✅ `placeCritter`, `AsteroidCreatures` registry | Dynamic spawns (not terrain-baked) |
| Ships | ✅ `AsteroidShips` registry | Dynamic (not terrain-baked) |
| Star Gate | ✅ `spawnStarGate` (`voxelworld.js:8145`) | One per world, identical design |
| Per-planet `spec` | ✅ `normalizeSpec` (`asteroid-profile.js:148`) | Only **Aquaria** uses it; mostly unconsumed |
| **Ruins / volcanoes / regions / POIs** | ❌ none | — |

**Key gap:** `genColumn` (`voxelworld.js:1393`) only writes terrain + trees. There is
**no structure-placement hook**, no region concept, and no points-of-interest system.
The `spec.terrain` fields (`landBias`, `mountains`, `oreRichness`) *are* wired in
(`_landBias`/`_mtnMul`/`_oreRich`, `voxelworld.js:843`), but `spec.exploration`,
`spec.population`, and `spec.wildlife` are **lore notes that nothing reads yet**.

The good news: the **Actor contract** (`build() → {group, st, anim(t,state,dt)}`) and the
two existing registries (`asteroid-creatures.js`, `asteroid-ships.js`) give us a proven
pattern to copy for structures.

---

## 2. The plan in one picture

```
Planet spec (asteroid-profile.js)
   └─ regions[]  ─────────────► named areas w/ a structure table + weights
        └─ structure table ───► ids into asteroid-structures.js registry
                                     │
asteroid-structures.js (NEW)         │  Actor contract: build(id) → {group, st, anim}
   └─ DEFS: ruin / volcano / geyser / wreck / shrine / nest / dig …
        └─ each: footprint, voxel stamp + optional Actor group, sci card, da name
                                     │
voxelworld.js                        ▼
   └─ placeStructures(cx,cz) ── deterministic seed-based site picker (per chunk)
        └─ stamps voxels into genColumn buf  +  registers dynamic Actor groups
   └─ region tint / fog / music hooks read the active region
   └─ scanner: structure scan card (EN + DA + sci), feeds a new mission goal type
```

Three new pieces, each independently shippable:

1. **`asteroid-structures.js`** — a content registry (data, no engine changes).
2. **Placement layer in `voxelworld.js`** — deterministic site selection + stamping.
3. **Regions** — named sub-areas of a planet that bias which structures appear and
   tint the look, so a planet reads as a *place with neighborhoods*, not uniform noise.

---

## 3. `asteroid-structures.js` — the structures registry (NEW file)

Mirror the creatures/ships pattern exactly so it loads the same way and uses the same
optional `window.*` guard. Add to `index.html` **before** `voxelworld.js` (after
`asteroid-ships.js`), bump its `?v=`, and consume via a `_AST` guard like `_AC`/`_AS`.

```js
// window.AsteroidStructures
const DEFS = {
  volcano: {
    name: 'Volcano', nameDa: 'Vulkan',
    biome: ['volcanic'],              // which biomes it may appear in
    region: ['caldera'],              // optional: region keys it prefers
    rarity: 'landmark',               // landmark | common | rare  (drives spacing)
    footprint: 24,                    // blocks; reserves a flat-ish site this wide
    stamp(ctx) { /* write basalt cone + lava well into ctx.setBlock(x,y,z,id) */ },
    actor: null,                      // optional Actor for animated bits (smoke plume)
    sci: { en: 'A volcano vents heat from deep underground…', da: 'Lava er smeltet sten.' },
    scan: true,                       // shows a scanner card; can satisfy a mission
  },
  ruin: {
    name: 'Sunken Ruin', nameDa: 'Ruin',
    biome: ['verdant','frost','desert'], rarity: 'rare', footprint: 14,
    stamp(ctx) { /* broken pillars, half-buried, a small reward cache */ },
    sci: { en: 'Old stone shaped by hands long gone…', da: 'Nogen byggede dette for længe siden.' },
    scan: true,
  },
  geyserField: { /* … */ },  // educational: pressure/steam, animals gather
  shipWreck:   { /* … */ },  // faction palette reuse from AsteroidShips
  shrine:      { /* … */ },  // Star-Gate-adjacent lore; gate-key tie-in
  fossilDig:   { /* … */ },  // dino/animal bias — scan to "excavate"
  crystalSpire:{ /* … */ },  // ore landmark, visible from far
};
```

Design rules for `stamp(ctx)`:

- It receives a **context** with `setBlock(x,y,z,id)`, the site's ground height, the
  planet seed, and an `ihash`-style RNG so the *same* site is identical every load
  (terrain is deterministic; structures must be too).
- It must **respect the chunk margin trick** `genColumn` already uses for trees
  (write into a margin so multi-chunk structures don't get clipped at borders), OR be
  placed by the post-pass described in §4 that can write across chunks.
- Reuse existing block ids where possible (basalt 18, regolith 16, ice 8, etc. — see
  `BIOME_THEMES`). New structure-only blocks (carved stone, lava, ancient metal) get
  ids + `BLOCK_DA` entries + scanner `sci:` text.

---

## 4. Placement layer in `voxelworld.js`

Two viable integration points; recommend **B**.

**A. Inline in `genColumn`** (like trees). Simple, but structures bigger than a chunk
are awkward and you can't easily guarantee a flat site.

**B. A dedicated site pass (recommended).** Add a `placeStructures` step that runs as
columns generate, keyed off a coarse **site grid** so structures are spaced out:

```
function structureSiteFor(siteX, siteZ) {
  // hash the site cell → maybe a structure id, anchored to one world position.
  // spacing = footprint-aware: landmarks (volcano) every ~N cells, commons denser.
  // Reject sites whose ground is too steep / underwater (unless the def wants water).
}
```

- A "site" is a coarse cell (e.g. 48–96 blocks). For each cell, hash(seed, cellX, cellZ)
  decides *whether* a structure spawns, *which* one (filtered by biome/region + weighted
  by rarity), and its exact anchor block. **Fully deterministic** → consistent per world,
  unique across worlds (seed differs per planet, `asteroid-profile.js:85`).
- When a chunk generates and a site anchor falls within reach, call the def's `stamp`.
  Static voxels go straight into the column buffer (persist like terrain, not as edits).
  Animated parts (smoke, glow, rotating ring) are **Actor groups** registered the same
  way Star Gate / critters are, and stepped in the existing per-frame actor update.
- Honor player **edits**: `applyEditsToCol` (`voxelworld.js:873`) runs last in
  `genColumn`, so a kid who mines a ruin keeps their changes. Stamp *before* edits.

Performance: gate the structure search to the streaming radius (`streamAround`), and
only test site cells overlapping newly-loaded chunks — same budget as trees today.

---

## 5. Regions — making a planet feel like a place

A **region** is a named sub-area of a planet. Regions do three things:

1. **Bias structures** — a `caldera` region weights volcanoes/geysers up; a `ruinfields`
   region weights ruins/shrines up.
2. **Tint the look** — optional palette/fog nudge layered on top of `BIOME_THEMES`,
   so crossing into a region is *visible*.
3. **Name the place** — show a brief "Entering: The Ashlands / Askelandet" toast
   (EN + DA), reinforcing reading practice.

Regions are derived deterministically from low-frequency noise (reuse the `pfbm2`/
`chan` field machinery already in `columnProfile`) partitioned into 2–4 zones per planet.
No hand-authoring required for v1; the planet `spec` can later name/override them.

---

## 6. Driving it from the planet `spec` (extend what Aquaria started)

`normalizeSpec` (`asteroid-profile.js:148`) already defaults every field, so we can add
optional blocks without breaking the 5 planets that have no `spec`:

```js
spec: {
  // …existing basics/terrain/visual/lore…
  regions: [                          // NEW (optional)
    { key: 'caldera',    name: 'The Ashlands',  nameDa: 'Askelandet',
      structures: { volcano: 3, geyserField: 2, fossilDig: 1 } },
    { key: 'ruinfields', name: 'Old Quarter',   nameDa: 'Den Gamle Bydel',
      structures: { ruin: 3, shrine: 1 } },
  ],
  landmarks: ['volcano'],             // NEW: guarantee ≥1 of these per world
}
```

- Add `regions: [...]` and an optional `landmarks: [...]` to `normalizeSpec`'s output
  (defaulted to `[]`). Planets with no spec fall back to a **biome default table**
  (e.g. volcanic → volcanoes + geysers; frost → frozen ruins + crystal spires) so all
  6 existing worlds get content for free without editing each one.
- `spec.exploration.note` / `spec.wildlife.note` (already present, currently unread)
  become the **flavor text** shown when you discover the region's signature structure.

---

## 7. Education & missions hookup

- **Scanner:** structures get a scan card via the existing `fillScanPanelContent` path —
  English name, Danish under it, `sci:` fact. Add structure block ids to `BLOCK_DA`.
- **New mission goal type:** extend `MISSIONS` in `asteroid-profile.js` (current types
  `scan`/`scan_unique`/`place`/`craft`) with **`discover`** — "Find and scan 3 ruins",
  "Survey a volcano". Wire a `recordDiscover` helper next to `recordScan`/`recordPlace`/
  `recordCraft`, advancing the objective HUD (`updateJournalHud`).
- This turns exploration into the math/reading loop the rest of the mode already uses.

---

## 8. Suggested per-world content (v1 target)

| Planet | Biome | Region flavor | Signature content |
|---|---|---|---|
| Verdant (home) | verdant | meadows + grove | gentle ruins, fossil dig, nesting sites |
| Frostpeak | frost | glacier + frozen quarter | frozen ruins, crystal spires, ice caves |
| Mycelia | fungal | spore forest | giant fungus landmarks, glow shrines |
| Dustfall | desert | dunes + dry seabed | buried ruins, bone digs, oasis |
| Ember | volcanic | **caldera** (Ashlands) | **volcano**, geyser fields, obsidian wreck, **fire-cave boss lair** |
| Aquaria | verdant/ocean | isles + tide caves | sunken ruins (already in its lore note) |

Every world also gets a **world boss in a themed lair** — see §9.

---

## 9. Boss lairs — every world gets a boss

Each planet has a **world boss** that lies **dormant in a themed lair** until the player
finds and approaches it, then wakes and fights. The lair is the world's climactic
set-piece; the boss is its payoff. This reuses three systems, two of which already exist:

- **Boss creature** — `asteroid-creatures.js` already defines a `BOSS` threat tier.
  `Warden` and `Dustwurm` exist but are gated off; **Ember has only `Cinderhound`
  (High, not a boss)**, so it needs a NEW boss def (`biome:'Ember'`, `threat:'BOSS'`,
  with `sci` card). Build via the existing Actor contract like every other creature.
- **Lair structure** — a `boss` rarity entry in `asteroid-structures.js`, placed **once
  per world** (guaranteed, not probabilistic) at a deterministic site away from spawn.
  Its `stamp` carves the cave and anchors the boss spawn point.
- **Dormant FSM** — a small extension to `updateHostile`/`maybeSpawnHostile`
  (`voxelworld.js:8396`/`:8437`): instead of random roaming spawns, the boss is
  **lair-anchored** and starts in a `dormant` state → `wake` on player proximity →
  normal hostile combat. Forgiving by design (i-frames, respawn) for the 7-year-old.

**Ember's boss — the fire cave (owner's spec):** the boss lies dormant in a **fire
cave** with **lava falling from the roof and running down the walls** (lava-falls). The
lair `stamp` carves a basalt chamber, then draws vertical **lava columns** (`id 38`,
animated/glowing) from the ceiling and wall-hugging lava sheets; an Actor adds dripping
embers (reuse the creatures `fx` spark kit). The dormant boss sits in the glow at the
back of the chamber. Walking in is the "uh oh" moment; it wakes as you approach.

Per-world boss/lair pairings (draft): Ember → fire-cave boss; Frostpeak → frozen-vault
boss; Mycelia → spore-hive boss; Dustfall → `Dustwurm` (already a BOSS def) in a
sand-sink; Verdant → a gentle starter boss in an overgrown ruin; Aquaria → tide-cave boss.

---

## 10. Build order (incremental, each step shippable)

1. **`asteroid-structures.js` skeleton** + registry guard + `index.html` wiring +
   `?v=` bump. One def (`volcano`) with a static `stamp`. Prove it renders on Ember.
2. **Deterministic placement pass** (`structureSiteFor` + stamp into `genColumn`).
   Verify same site every reload; verify per-seed uniqueness across worlds.
3. **Scanner card + `BLOCK_DA`** for new blocks; confirm EN/DA/sci display.
4. **Biome default structure tables** → all 6 worlds get content with no spec edits.
5. **Regions** (noise partition + name toast + structure biasing + light tint).
6. **`spec.regions`/`landmarks`** parsing in `normalizeSpec`; author Ember + Aquaria.
7. **`discover` mission type** + `recordDiscover` + objective HUD.
8. **Animated Actor bits** (volcano smoke plume, shrine glow) via the Actor contract.
9. **Boss lairs** (§9): lair structures (Ember fire-cave + lava-falls first) + per-world
   boss creature defs + the dormant→wake FSM extension. Ungate the existing BOSS defs.

Steps 1–4 alone already deliver "each world has explorable structures." 5–9 deepen it;
step 9 (bosses) is the climactic payoff and can ride on top whenever 1–4 are in.

---

## 11. Open questions for the owner

- **Reward model:** what's in a ruin cache — crafting materials, a Gate Key, a cosmetic,
  a lore page? Keep it forgiving and useful for the crafting/counting loop.
- **Danger level:** do volcanoes hurt (forgiving, like current combat) or are they
  purely scenic/educational? Recommend *scenic + scannable* for v1 (age-appropriate).
- **Authoring vs. procedural:** v1 is fully procedural per seed. Do you ever want
  hand-placed "this exact ruin at this exact spot" set-pieces? (Possible via `spec`,
  but adds scope.)
