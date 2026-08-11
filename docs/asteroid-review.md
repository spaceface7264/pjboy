# Asteroid mode — design review

Status: **mostly shipped on `feat/asteroid-polish`** (playtest before merge).
Save-safety, shelter pathing, lamps, doors, and night survival are on `main`.
This branch adds the remaining plan: tier-2 missions, Curator beats, craft-gated
weapons, Always-day, uranium hazard, gate waypoints, and polish UX.

Original snapshot was against `main` at `b407014`. Scope is **Asteroid mode only**.

Audience north-star (from `CLAUDE.md`):

> PJBoy — especially **Asteroid mode** — is primarily a game the owner is building
> **for their 7-year-old child**. The intended experience is **fun, gently challenging,
> and educational**.

That means: bilingual Danish→English, short text, achievable goals, forgiving fails,
science-first scanner cards, and **local same-device co-op** — not online PeerJS.

---

## Shipped vs deferred

| Plan item | Status |
|---|---|
| A0 shelter pathing | Done (`main`) |
| A4 lamp light | Done (`main`) |
| Spec B doors | Done (`main`) |
| A1–A3 night survival | Done (`main`) |
| Save safety | Done (`main`) |
| F8/F9 Shift gate, tagline, honest claim copy | Done (polish) |
| `craft_door` + `survive_night` | Done (polish) |
| Planet unlock fanfare | Done (polish) |
| Tier-2 missions (`creature` / `depth` / `travel`) | Done (polish) |
| Mission gate waypoint pin | Done (polish) |
| Craft-gated weapons + Refinery unlock recipes | Done (polish) |
| Always-day parent toggle | Done (polish) |
| Soft uranium proximity hazard | Done (polish) |
| Curator toast beats + near-gate spawn | Done (polish) |
| Character/creature InstancedMesh | **Deferred** (multi-day) |
| Local same-device co-op | **Deferred** (multi-day) |
| Turrets / economy / wrench repair loop | **Deferred** |

---

## Mission chain (10 surveys)

| # | id | Goal |
|---|---|---|
| 1 | `first_scan` | scan ×1 |
| 2 | `catalog_three` | scan_unique ×3 |
| 3 | `place_block` | place ×1 |
| 4 | `craft_lamp` | craft Lamp |
| 5 | `craft_tnt` | craft TNT |
| 6 | `craft_door` | craft Door |
| 7 | `survive_night` | survive dawn |
| 8 | `scan_creature` | log 1 creature |
| 9 | `dig_deep` | mine below Y 40 |
| 10 | `chart_frost` | visit Frostpeak (gate pin) |

---

## Playtest checklist (`feat/asteroid-polish` — do not merge until approved)

Test on a **throwaway local profile** first (cloud link pushes world edits).

1. **Missions 6–10** — Door → Night → Creature → Dig deep → Chart Frostpeak. Tips + gate pin.
2. **Door** — Craft (2 Alloy + 1 Circuit), place, **F** opens/closes.
3. **Lamp** — Self-lit + ~56 block reach.
4. **Night** — Dusk → night countdown → dawn toast + Curator night line; survey completes.
5. **Always day** — Settings → Always day: stays bright, no night hostiles.
6. **Weapons** — All-filter cannot free-unlock Railgun; craft at Refinery to unlock; starters still work.
7. **Uranium** — Stand near ore: tip + soft tick damage.
8. **Curator** — Near Star Gate; first scan / craft / night / Gate Key lines fire once.
9. **Tuners** — Plain F8/F9 do nothing; **Shift+F8** / **Shift+F9** open tuners.
10. **Cloud / save** — Place blocks, edit claim name, reload — blocks still there.

---

## Citation index (primary)

| Topic | Where |
|---|---|
| North-star | `CLAUDE.md` |
| Missions / recipes / planets | `asteroid-profile.js` |
| Day/night + Always day | `voxelworld.js` `_dayNightOn` / Settings |
| Doors / lamps / shelter | `voxelworld.js` |
| Weapon gate | `voxelworld.js` `setWeaponIndex` / Equip UI |
| Curator | `asteroid-creatures.js` + `spawnCuratorNearGate` |
| Prior world-content proposal | `docs/asteroid-world-content-plan.md` |
