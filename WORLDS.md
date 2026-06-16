# PJBoy — The Six Worlds (Design Spec)

*The buildable companion to `LORE.md`. This specs **all six worlds on paper** — the player's moment-to-moment journey, the systems that make it work, and the per-world content — so we can agree the whole shape before writing any gameplay code. Story canon lives in `LORE.md`; this is the **how it plays** document.*

## Locked design decisions (this turn)

1. **Hybrid combat — fight wild beasts, wake the Hushed.** Two distinct verbs (below). **No one dies**: beasts are *subdued* (they calm and yield), the Hushed are *woken* (they sparkle awake and wander home).
2. **Spec all six first.** This doc is that spec. No gameplay code until it's agreed. (A suggested build order is in the appendix.)
3. **Ambient education.** Science stays where it is — surfaced on the scanner, never quizzed or gated. Learning is a reward for curiosity, not a wall. Counting/math stays ambient through crafting and collect counts.

---

## PART A — Core systems (shared by every world)

These resolve the open gaps once, so each world spec can stay short.

### A1. The two combat verbs

| | **FIGHT** (wild beasts) | **WAKE** (the Hushed) |
|---|---|---|
| Who | Cinderhound, Razorpede, Dustwurm, and the 6 **apex Wardens** | Hushling, Sleeper (Husk), Mute, Gnash, Riftling |
| Verb | Existing combat: aim + fire, `damageCreature` | **New:** hold your light/scanner beam on it ~2s → a wake meter fills |
| On success | Beast **calms** (kneels, stops, lets you pass / yields the Worldcore). Never a corpse. | Hushed **wakes**: sparkle burst, the dim lifts, it ambles off — or a **Sleeper walks home to the Village** |
| If it "beats" you | Forgiving knockback + respawn at last Beacon (existing `applyPlayerDamage` model) | The Hushed can't hurt you badly — they make you *drowsy* (brief slow), never damage |

**Why hybrid works for a 7-year-old:** real action when they want it (beasts), and a gentle, kind, never-scary verb for the story creatures. The wake-meter is the same "hold to interact" gesture as scanning, so it's one muscle memory.

**Apex Warden fights are forgiving by spec:** big, slow, *heavily telegraphed* wind-ups (the boss kit already exposes `wind/active/rec` per attack and a `dormant→walk→run→enraged→ultimate` ramp). Tuning rule: long tells, generous i-frames, no instant-kills, checkpoint at the arena entrance.

### A2. The Village (the Waystation) — the home loop

The hub that makes "go home" mean something. **This is net-new and the highest-value build after Verdant.**

- A small fixed voxel settlement you arrive in between worlds (own mini-scene; not procedural).
- **The Hearth + Lantern** at center = safe spawn, local co-op spawn, and the save point.
- **Six districts**, each dark until you plant that world's Totem; planting lights the district, moves its people in, and **walks a few Sleepers home**.
- **Shared buildings unlock as you progress:** Quill's **Workshop** (after Aquaria) = crafting/upgrades; the **Codex Hall** = everything scanned; the **Echo Well** = replay Echoes; the **Gate** = travel; the **Ringwall** = the co-op defend beat.
- **MVP version:** one room — Hearth + Gate + a single craft bench + one plantable Totem socket. Grow it later.

### A3. Totems & boons
- One per world; recovered/crafted during the world, **planted at home** as the final beat.
- Planting = unlock next world + light a district + grant a **passive boon** (longer breath, warmth aura, heat-resist, etc.). Boons are how progression *feels*: each world makes the next one survivable.

### A4. Hush-shards (the cleanse target)
- New block id: a dim, cold, lightly-animated block that spawns in clusters on un-restored worlds.
- **Mining one** ("clearing") brightens the local area and nudges the Hush back — the mirror image of placing a Beacon. Counts toward the LIGHT mission.

### A5. Echoes (ambient story)
- Small floating, scannable memory-motes (6–8 per world), placed in interesting spots.
- Scanning one plays one short Lumen line + a Codex entry. **Fully optional** — they reward exploration, never block progress. This is where the mystery lives for kids who look.

### A6. Survival meters (only where a world needs one) + forgiving fail
- **Aquaria = Breath. Frostpeak = Cold. Ember = Heat.** No meters anywhere else.
- All forgiving: the bar drains slowly, warns clearly (vignette + Pip line), and on empty you get **woozy → gently teleported to the last Beacon/light**. **No death, no item loss, ever.** The matching Totem boon softens that world's meter permanently.

### A7. Gear & progression (ambient, craft-to-improve)
- Keep the current free starter kit (mining tool + plasma pistol).
- Each world's **signature material** crafts that world's **tool/boon** at the Workshop (e.g. Glass→better light, Obsidian→heat gear). Tiers (Mk I/II/III) already exist — worlds feed them.
- Nothing is *required* to be bought; the path is "the next world is easier if you craft the last world's gear." Carrot, not gate.

### A8. Local co-op (same-device)
- Player 2 joins as **a second Kindler / Pip**. Shared screen, shared Village, shared objective.
- Both can scan, mine, wake, and fight; apex bosses gain a little HP with 2 players. The **Ringwall defend** beat is the co-op showcase. (No online sync — per `CLAUDE.md`.)

### A9. Save & session length
- One world ≈ **one or two 20-minute sittings**. Save point = the Hearth + every Beacon you build (checkpoints). Mid-world state persists per profile (block edits already do).

### A10. The Universal World Loop (every world, same five beats)
`LAND → LOOK (scan 3) → GATHER (mine signature blocks) → LIGHT (build Beacon + clear Hush-shards) → WAKE/FIGHT (wake the Hushed; best the apex beast) → GO HOME (plant Totem → next world)`. The pinned HUD always shows the one active beat plus a one-line Lumen/Pip nudge.

---

## PART B — The six worlds

Canonical order (this overrides the current `PLANETS` ordering/gating, which should be realigned to unlock on the **previous world's Totem**):

`Verdant → Aquaria → Mycelia → Frostpeak → Dustfall → Ember → ✪ Aetherheart`

---

### 1. 🌿 Verdant — *home & tutorial* — "Learn to listen"
- **Landing / first open:** you wake at the half-lit Village Hearth; you + Lumen light the Lantern (first BUILD ever). Pip joins. Sunny, barely-Hushed — nothing can really hurt you.
- **New thing taught:** the whole loop, slowly. The four existing missions ARE this tutorial.
- **Meter:** none. **Signature blocks:** Grass, Wood/Leaves.
- **Wildlife to FIGHT:** none required (Mosshorn is peaceful — used to teach scanning). **Hushed to WAKE:** a few gentle Hushlings.
- **Apex beast:** **Grovekeeper** *(built — "The Living")*. Tutorial boss: it tests you, never chases ("It does not chase. It does not need to."), and **yields the Worldcore freely** once you prove the Hum. A friendly first fight.
- **Echoes:** what the Hum is; the first hint the Ancients "went quiet."
- **Totem:** **Greenheart** → lights **The Grove**, unlocks **Aquaria**.
- **Mission chain:** First reading (`scan 1`) → Mineralogist (`scan_unique 3`) → Foundations (`place 1`) → Camp light (`craft Lamp`) → Meet the Grovekeeper (`fight grovekeeper`) → Plant the Greenheart (`plant greenheart`).

---

### 2. 🌊 Aquaria — "Hold your breath"
- **Landing:** green isles under a wide blue sky; the tide has stopped, the sea dozes.
- **New mechanic:** **swimming + Breath meter** (forgiving). First survival wrinkle.
- **Signature blocks:** Sand→Glass. **Meter:** Breath.
- **FIGHT:** none apex-level except the boss; calm grazers only ("no hunters" — per the world spec already in code). **WAKE:** **Mutes** drifting over the water (they hunt Pip's Spark — annoying, harmless).
- **Apex beast:** **Tidemother** *(built — leviathan jelly)*. She drifts close with her heart-light like a harbor lamp, then turns; **light up her bell** to break the lure and subdue her. She calms; every Driftjelly is her child.
- **Echoes:** the sea's old song; sunken Ancient ruins.
- **Totem:** **Tideshell** (boon: **longer breath**) → lights **The Drift**, opens **Quill's Workshop**, unlocks **Mycelia**.
- **Mission chain:** Tide reading (`scan_unique 3`) → Beachcomber (`collect Sand ×8`) → Light the shallows (`place Beacon` + `collect Hush-shard ×3`) → Wake the Tidemother (`fight tidemother`) → Plant the Tideshell (`plant tideshell`).

---

### 3. 🍄 Mycelia — "Bring your own light"
- **Landing:** a living fungal world gone dark; the glow went out.
- **New mechanic:** **darkness** — you must craft/place **Lamps** to see and advance. Light *literally* pushes the Hush back (mechanic = lore). Reuses the existing Lamp recipe.
- **Signature blocks:** Fungal, Glowcap. **Meter:** none (darkness is the pressure).
- **FIGHT:** **Razorpede** (cave centipede, fast — the world's wild-beast threat). **WAKE:** **Hushlings** and a **Gnash** deep in the dark (wake it with a bright enough light).
- **Apex beast:** **Sporewarden** *(built — "The Living" hivemind)*. "You breathe a little of it, and the rest comes looking." A spreading-fungus fight; earn its attention without getting bloomed.
- **Echoes:** how fungi differ from plants; the Hollow's shared light.
- **Totem:** **Gilllight** (boon: **light in dark + reveal spore-paths**) → lights **The Hollow**, unlocks **Frostpeak**. *(Meet ally **Myco** here — to build.)*
- **Mission chain:** Spore survey (`scan_unique 3`) → Glowcap harvest (`collect Fungal ×8`) → Light the Hollow (`craft Lamp ×3` + `place ×3`) → Wake the Sporewarden (`fight sporewarden`) → Plant the Gilllight (`plant gilllight`).

---

### 4. ❄️ Frostpeak — "Stay warm" *(first real test of skill)*
- **Landing:** frozen, whiteout snow; the warmth-song faded.
- **New mechanic:** **Cold meter** (stay near warmth/light or you slow) + **whiteouts** where you follow **Floe** to navigate.
- **Signature blocks:** Ice, Snow. **Meter:** Cold.
- **FIGHT:** **Cinderhound** does not belong here — Frostpeak's wild threat is the apex beast itself plus icy terrain. **WAKE:** **Mute** (smothers warmth, spreads the chill).
- **Apex beast:** **Rimewyrm** *(built — glacier serpent-dragon)*. "Two weathers: the storm, and the wyrm." Ice regrows faster than you chip it — **bait its Frost Breath into Hush-ice** to crack the crust, then subdue. The first genuine fight.
- **Echoes:** states of matter; why the warmth left.
- **Totem:** **Threetail** (boon: **warmth aura**) → lights **The Frosthold** (Floe moves in), unlocks **Dustfall**.
- **Mission chain:** Frost reading (`scan_unique 3`) → Icebreaker (`collect Ice ×8`) → Hold the warmth (`place Beacon` + `collect Hush-shard ×4`) → Wake the Rimewyrm (`fight rimewyrm`) → Plant the Threetail (`plant threetail`).

---

### 5. 🏜️ Dustfall — "Find what's buried"
- **Landing:** a dry, Moon-like regolith world; old roads and Ancient ruins lie buried; the first **Riftlings** appear (the gentle "this world needs you soon" clock).
- **New mechanic:** **navigation & digging** — the Wayfinder leans toward buried things; dig to **Ancient ruins**, solve a simple **door puzzle**; sandstorms cut sight.
- **Signature blocks:** Red Rock, Sand. **Meter:** none.
- **FIGHT:** **Dustwurm** *(already built in `asteroid-creatures.js`)* — the burrowing colossus that breaches the surface. **WAKE:** **Riftlings** (frazzled, not drowsy) + **Sleepers** wandering the dunes.
- **Apex beast:** **Dustwurm** doubles as the Warden here (sand leviathan; read the sand-tells, dodge the breach, strike on the surface). *(If you'd rather a bespoke boss, that's the only new boss model needed — "Gravemaw" — otherwise Dustwurm covers it with zero new art.)*
- **Echoes:** regolith & Mars rust; the buried road network; the first Kindlers thread.
- **Totem:** **Wayfinder** (boon: **reveal buried ruins**) → lights **The Wayrest**, unlocks **Ember**. *(Meet ally **Sift** here — to build.)*
- **Mission chain:** Dust survey (`scan_unique 3`) → Deep dig (`collect Red Rock ×8`) → Open the ruins (`place Beacon` + `collect Hush-shard ×4`) → Wake the Dustwurm (`fight dustwurm`) → Plant the Wayfinder (`plant wayfinder`).

---

### 6. 🌋 Ember — "Don't get burned" *(hardest, last)*
- **Landing:** hot, red, angry; the molten heart overheating; a litter of cinder-pups sleeps here.
- **New mechanic:** **Heat meter + lava hazard** — plug vents (puzzle) to cool the world; Emberkin gear protects; **wake the sleeping pups** (→ Tinder's family).
- **Signature blocks:** Obsidian, Basalt/Red Rock. **Meter:** Heat.
- **FIGHT:** **Cinderhound** (obsidian lava-hound — the wild-beast threat that dens near the boss). **WAKE:** the **cinder-pups** (Sleepers) + **Gnash**.
- **Apex beast:** **Pyroclast** *(built — magma colossus)*. "It is the fire, briefly shaped like something that can find you." **Cool its molten heart by plugging the vents**, then subdue. The angriest, the last.
- **Echoes:** heat & volcanism; the truth about where the Ancients went (the wistful turn).
- **Totem:** **Emberkin** (boon: **heat/lava resist**) → lights **The Forge & Kennel** (Tinder + pups), unlocks the **Aetherheart**.
- **Mission chain:** Ember reading (`scan_unique 3`) → Forge stock (`collect Obsidian ×8`) → Cool the vents (`place ×5` + `collect Hush-shard ×5`) → Wake the Pyroclast (`fight pyroclast`) → Plant the Emberkin (`plant emberkin`).

---

### ✪ Finale — the Aetherheart
- **Not a fight.** With all six Worldcores, you descend and **socket them** (one last build-puzzle), the Hum swells back, and the **Architect** rises — a calm, geometric construct and a warm **empty chair**.
- A short **trial of understanding** (re-use a few verbs you learned), then it names you the next builder. Worlds light across the horizon. **Open world unlocks. "Your turn."**
- **Build gap:** the Architect is the one finale model not in any kit yet, plus the socket-puzzle scene.

---

## PART C — Boss roster (build status)

| World | Apex beast | Source | Status |
|---|---|---|---|
| Verdant | Grovekeeper | `pjboy-bosses.js` | ✅ built |
| Aquaria | Tidemother | `pjboy-bosses.js` | ✅ built |
| Mycelia | Sporewarden | `pjboy-bosses.js` | ✅ built |
| Frostpeak | Rimewyrm | `pjboy-bosses.js` | ✅ built |
| Ember | Pyroclast | `pjboy-bosses.js` | ✅ built |
| Dustfall | Dustwurm *(or new "Gravemaw")* | `asteroid-creatures.js` | ✅ built (reuse) |
| Finale | Architect | — | 🆕 to build |

`pjboy-bosses.js` is banked in the repo as a content library (not wired in). Its contract: `createBossKit(THREE, scene)` → `spawn(id)` → `{group, anim(t,state,dt), attacks[], meta}`, states `dormant|walk|run|enraged|ultimate`, plus `kit.triggerAttack(id)` and `kit.step(dt)` returning camera `{shake, flash}`. Integration is the same adapter pattern noted for the cast: route into the existing creature/combat system, ground non-airborne bosses, and bump `index.html` `?v=`.

---

## PART D — What's built vs. net-new

**✅ Reuse as-is:** scanner, mining, placing, refinery crafting (incl. Lamp & Gate Key), gate/space travel, mission tracking + HUD, peaceful + hostile creatures, forgiving combat/respawn, weapon/drone tiers, **5 apex bosses + Dustwurm**, the **cast** (`pjboy-cast.js`).

**🆕 Net-new, small:** `collect` / `wake` / `plant` goal types (+ recorders), Hush-shard block + spawner, Echo motes, Beacon build-goal, the three survival meters + woozy-teleport fail, Totem props + plant action, unlock-by-Totem gating.

**🆕 Net-new, larger:** the **Village/Waystation** hub scene, allies **Myco** & **Sift**, the **Architect** + socket-puzzle, local **co-op** plumbing.

---

## PART E — Suggested build order (MVP-first)

Even though all six are specced, build the proof first:

1. **Verdant vertical slice** end-to-end: the 6-mission chain + a **one-room MVP Village** + Grovekeeper wired in + `plant` working. Proves the entire loop with mostly-existing parts.
2. **The wake verb** + Hush-shards + one Sleeper-walks-home moment (the emotional core).
3. **Aquaria** (adds the Breath meter + a second boss + Workshop) — proves a world template repeats.
4. Roll out **Mycelia → Frostpeak → Dustfall → Ember** on the proven template.
5. **Architect + Aetherheart finale.** Ship.

---

## PART F — Still open (your call)

- **Dustfall boss:** reuse **Dustwurm** (zero new art) or model a bespoke **Gravemaw**? *(Recommend: reuse for MVP.)*
- **Danish copy:** facts stay English (current rule) — confirm, and we'll write full EN+DA for all mission/HUD strings at build time.
- **Co-op depth:** ship solo-first and add the second Kindler later, or design co-op into the Verdant slice from day one?
