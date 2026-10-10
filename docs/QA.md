# QA – self-assessment

Scores 1–9 (1–3 failed, 4–6 partial, 7–9 solid). C = critical, N = non-critical.
Rule: all C items 7–9; at most two N items at 4–6, none below 4.
*(prov.)* = provisional, because it can only be fully confirmed on the real Quest or after the first deploy from `main`.

## Phase 1 – 2026-09-27

### How it was tested

- `npm run validate`: `apartment.json` is valid with 0 errors and 0 warnings.
- `npm run build` (`tsc --noEmit` + Vite): no TypeScript errors.
- `npm run test:unit`: **55 Vitest tests**. They cover the schema (22 invalid cases, each with a Norwegian message), ceiling-plane fitting, floor levels, door hinge/swing, window heights, spawn, wall top vs ceiling (no gaps), holes in walls (raycast through door/window), "change a number → geometry changes", the teleport arc on both levels, rig maths and the draw-call budget.
- `npm run test:e2e`: **15 Playwright tests** against a production build served under `/Leilighet-3d/` (the same base path as Pages).
  - 8 laptop tests: loads with no console errors, Norwegian UI, draw calls, layer toggles, top-down scale, modified JSON, error display, FPS toggle, placeholder highlight.
  - 7 VR tests with an **emulated Quest 3** (IWER, the runtime behind Meta's Immersive Web Emulator): enter VR, spawn, teleport up and down the step, blocked teleport, snap turn, physically walking up the step, Y/FPS, exit.
- Screenshots of the orbit view, top-down plan and in-headset view from the emulator were checked by eye.

### Scores

| # | Item | Type | Score | Evidence / what is missing |
|---|---|---|---|---|
| 1 | App loads on the Pages URL and enters VR without errors | C | **7** *(prov.)* | The production build under `/Leilighet-3d/` loads with zero console errors, and VR entry on the emulated Quest 3 has zero errors. Not yet seen on the live Pages URL (it goes live after the PR is merged and Pages is enabled) or on the real headset. |
| 2 | Steady frame rate in VR with the whole apartment | C | **8** *(prov.)* | The whole apartment is 13 merged meshes and about 4 000 triangles: 14 draw calls per eye, no shadows, Lambert materials, no per-frame allocations in the render path. That is far below Quest 3 limits. The real frame rate must be read on the headset (Y button). |
| 3 | Geometry comes 100 % from apartment.json | C | **8** | No room, wall, opening or furniture geometry is in code. A unit test and an e2e test change numbers in the JSON (wall thickness, floor level, sill height, room polygon) and the geometry, floor lookup and area all change. The code only holds presentation details (door frame/leaf thickness, default fixture sizes when `size` is omitted). |
| 4 | Schema covers every object type, with validation | C | **8** | Types and validation exist for every listed type: rooms, walls, ceilings, doors, windows, passages, all six fixture types with layer and status, furniture with parts and source, outdoor areas, layers and the measured flag on every value. Zones, wiring, scans and notes are added for later phases. There are 22 negative tests with Norwegian messages. It does not yet detect overlapping rooms or walls. |
| 5 | Step, sloped ceiling, door swing directions and window heights render correctly | C | **8** *(prov.)* | Checked numerically: the step is 180 mm with a riser; the ceiling follows the fitted plane (lowest at the entrance corner, rising toward the kitchen); hinge and swing of all three doors are correct; the window sill is at 900 mm above the living room floor. The top-down plan and VR screenshots match. Final visual check on the Quest is pending. |
| 6 | Teleport works on both floor levels, and snap turn works | C | **8** *(prov.)* | On the emulated Quest: teleport hallway → living room lands at y = 0.18 m, and back lands at y = 0. Walls give a red arc and no jump. Snap turn is exactly ±30° around the head, once per stick push. Physically walking over the step lifts the floor to 0.18 m. Real controller feel is pending. |
| 7 | Deploy pipeline works on every push | C | **7** *(prov.)* | `.github/workflows/pages.yml` runs validate → build → unit tests → Playwright on every push, and deploys to Pages on push to `main`. The first run on this branch was **green in 2 min 25 s** ([run 1](https://github.com/Jovialen337/Leilighet-3d/actions/runs/36322169754)): all 55 unit tests and 15 browser tests passed on GitHub's runner. The deploy job has not run yet: it needs the PR merged and Pages source set to GitHub Actions. |
| 8 | Top-down view is correct and to scale | N | **8** | Orthographic view, not mirrored. The e2e test measures 9.1 m and 5.7 m on screen against the scale bar (within 0.5 %). Cursor coordinates are within ±15 mm. The hallway and living-room floors appear at the expected screen positions. There is a 1 m grid, a section cut at 1.5 m, and room labels with area. |
| 9 | Layer toggles work | N | **8** | All 11 layers toggle. The e2e test checks group visibility and fewer triangles drawn, and all layers off draws 0 triangles. Labels follow the layers, and hidden layers don't block teleport. |
| 10 | Code is structured so VR editing (phase 3) can be added without rewrites | N | **8** | `ApartmentStore.update()` validates and rejects bad edits. There are pick proxies with ids and an id → vertex-range map. `ViewState` is shared by the laptop UI and the future wrist menu, and `WristPanel` is already on the left controller. Geometry builders are pure. |

**Rule check:** all C items are 7–8, all N items are 8. Passes, provisionally, pending the Quest checks below.

**Overall check** (open the URL on the Quest, enter VR, walk from the hallway up the step into the living room, see the ceiling slope):
this passes in the Quest 3 emulator. You enter VR at the entrance, walk physically into the living room, the floor rises 180 mm, and the sloped ceiling is visible. It still needs to be confirmed on the real headset, so phase 1 is **not approved until you run the list below**.

### Test on the Quest (please report back)

1. In Quest Browser open **https://jovialen337.github.io/Leilighet-3d/**. The panel is in Norwegian and the button says **«Gå inn i VR»**, not «VR støttes ikke her».
2. Press **Gå inn i VR**. You should stand just inside the entrance door, looking into the hallway, with the open entrance door leaf *outside* behind you.
3. Press **Y** (left controller). The frame rate appears on the small panel above the left controller. Look around every room: it should stay at **72 fps** (or 90 with `?hz=90`) with "min" ≥ 70 and worst frame < 16 ms. Write down the numbers.
4. **Walk physically** about 2.5 m through the opening to your left into the living room. The floor should rise one step (18 cm) without you sinking into it or floating.
5. **Look up**: the ceiling should be lowest in the hallway corner by the entrance door and visibly higher toward the kitchen.
6. **Teleport**: push the left stick forward and a green arc appears. Aim into the living room and release: you land on the living room floor, on top of the step. Aim back into the hallway: you land on the lower floor. Aim at a wall: the arc turns red and releasing does nothing.
7. **Snap turn**: push the right stick left/right. You turn 30° once per push, with no drift.
8. **Doors**: the bathroom door opens *into* the bathroom with its hinge on your *right* as you go in. The grow room door opens *into* the grow room with its hinge on your *left*. The entrance door opens *outward* with its hinge on the left as you come in.
9. **Windows**: two windows in the living room wall on the entrance side, with the sill at about hip height.
10. Look for flicker (z-fighting) where walls meet ceilings or floors, and at the step.
11. Leave VR with the Meta button → «Avslutt». The 2D page comes back.
12. **Laptop** (Chrome/Edge on Windows): open the same URL. In 3D, drag to rotate. Click **«Ovenfra (2D)»** to get the plan with a 1 m grid and scale bar, then toggle a few layers.
