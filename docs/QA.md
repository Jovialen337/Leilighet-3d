# QA – self-assessment

Scores 1–9 (1–3 failed, 4–6 partial, 7–9 solid). C = critical, N = non-critical.
Rule: all C items 7–9; at most two N items at 4–6, none below 4.
*(prov.)* = provisional, because it can only be fully confirmed on the real Quest.

**Update 2026-10-11 – first test on the real Quest 3:** **90 fps at 11.9 ms** per frame. Movement and reach feel acceptable compared with real life for a first version. The ceiling is too high and the layout is quite different from the real apartment. Both come from the placeholder data, not the rendering, and are what phase 2 (measuring) and a corrected layout fix. Items 1, 2 and 6 below are now confirmed on the headset.

**Update 2026-10-10:** phase 1 is live at https://jovialen337.github.io/Leilighet-3d/ (deployed from `main`, [run 5](https://github.com/Jovialen337/Leilighet-3d/actions/runs/38085575706)). The repository was made public, because GitHub Pages on the free plan requires it.

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
| 1 | App loads on the Pages URL and enters VR without errors | C | **8** | The production build under `/Leilighet-3d/` loads with zero console errors, and VR entry on the emulated Quest 3 has zero errors. The live Pages URL serves the page, data and bundle (HTTP 200); the same build passed all 15 browser tests in CI. Not yet tried on the real headset. |
| 2 | Steady frame rate in VR with the whole apartment | C | **9** | **Quest 3: 90 fps, 11.9 ms.** | The whole apartment is 13 merged meshes and about 4 000 triangles: 14 draw calls per eye, no shadows, Lambert materials, no per-frame allocations in the render path. That is far below Quest 3 limits. The real frame rate must be read on the headset (Y button). |
| 3 | Geometry comes 100 % from apartment.json | C | **8** | No room, wall, opening or furniture geometry is in code. A unit test and an e2e test change numbers in the JSON (wall thickness, floor level, sill height, room polygon) and the geometry, floor lookup and area all change. The code only holds presentation details (door frame/leaf thickness, default fixture sizes when `size` is omitted). |
| 4 | Schema covers every object type, with validation | C | **8** | Types and validation exist for every listed type: rooms, walls, ceilings, doors, windows, passages, all six fixture types with layer and status, furniture with parts and source, outdoor areas, layers and the measured flag on every value. Zones, wiring, scans and notes are added for later phases. There are 22 negative tests with Norwegian messages. It does not yet detect overlapping rooms or walls. |
| 5 | Step, sloped ceiling, door swing directions and window heights render correctly | C | **8** *(prov.)* | Checked numerically: the step is 180 mm with a riser; the ceiling follows the fitted plane (lowest at the entrance corner, rising toward the kitchen); hinge and swing of all three doors are correct; the window sill is at 900 mm above the living room floor. The top-down plan and VR screenshots match. Final visual check on the Quest is pending. |
| 6 | Teleport works on both floor levels, and snap turn works | C | **8** | Quest 3: movement and reach acceptable. | On the emulated Quest: teleport hallway → living room lands at y = 0.18 m, and back lands at y = 0. Walls give a red arc and no jump. Snap turn is exactly ±30° around the head, once per stick push. Physically walking over the step lifts the floor to 0.18 m. Real controller feel is pending. |
| 7 | Deploy pipeline works on every push | C | **8** | `.github/workflows/pages.yml` runs validate → build → unit tests → Playwright on every push, and deploys to Pages on push to `main`. The first run on this branch was **green in 2 min 25 s** ([run 1](https://github.com/Jovialen337/Leilighet-3d/actions/runs/36322169754)): all 55 unit tests and 15 browser tests passed on GitHub's runner. The first run on `main` after merging ([run 3](https://github.com/Jovialen337/Leilighet-3d/actions/runs/38084826376)) failed one browser test on timing: the slower runner had not drawn the next frame within a fixed 200 ms wait. The tests now wait for an actually rendered frame; the old version fails and the new one passes when frames are slowed to one per 600 ms. After the test fix, [run 5](https://github.com/Jovialen337/Leilighet-3d/actions/runs/38085575706) on `main` passed and deployed. The live page, `apartment.json` and the JS bundle all return 200. |
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


## Phase 2 – guided measuring – 2026-10-11

### How it was tested

- `npm run validate`, `npm run typecheck` and `vite build`: clean.
- `npm run test:unit`: **91 Vitest tests**, 36 of them new.
  - Solver (13): rigid fit and line fit; corners moving rooms and walls; rotation; floor level and the ceiling from 3 points; one ceiling point keeps the slope; jambs, top and sill giving offset, width, height and sill height; fixtures on walls; wall thickness from both faces; furniture moving with its room; a full survey with ±5 mm noise stays valid; the latest measurement wins.
  - Guided list and session (20): unique keys that match observations, room order, skipping what is measured or planned, Norwegian texts, record / skip / revisit / undo / re-measure / browse, ceiling spacing and collinearity rejection, the far warning, an invalid intermediate model keeping the last valid draft, local save surviving a reload, stale vs published detection, discard, broken storage, and the formatter reproducing the hand-written file byte for byte.
  - Alignment (2): two touches give the origin at the corner and +x along the wall, matching three.js exactly, and a too-short distance is rejected.
- `npm run test:e2e`: **23 Playwright tests**, 8 of them new. Seven run on an **emulated Quest 3 in passthrough mode (immersive-ar)**:
  - Start: the AR session starts, the solid model is hidden, and the panel asks for the door corner.
  - Alignment: a corner placed elsewhere and a wall turned 30° are both handled; touching the real corner then reads (0, 0, 0) within 2 mm.
  - A too-short alignment is rejected with a Norwegian message, and B goes back.
  - Measure, skip, undo and browse all work with the real controller buttons. The measured corner lands in the draft as `{value, measured: true}`.
  - Point mode without a room scan explains itself, and the stick switches back to touch.
  - Exiting shows the draft in the 3D model and in the panel. It survives a reload, downloads as a valid `apartment.json`, has the right upload link, and «Forkast» restores the file.
  - Serving the downloaded file as the new `apartment.json` marks the measurements as published and removes them from the list.
- One new test loads the *published* file and checks only that it is valid and renders. All other tests use a frozen copy of the placeholder.
- Screenshots from the emulated headset (overlay, beacon, label, hand panel) were checked by eye. The panel was changed to always face the head after the first screenshot showed it tilted away.
- Speed: one measurement (solve + validate + rebuild the list) takes a median of 11 ms (max 27 ms) on the build machine over 60 measurements. The overlay is 2 meshes with about 2 700 triangles.

### Scores

| # | Item | Type | Score | Evidence / what is missing |
|---|---|---|---|---|
| 1 | Measurements become a correct, valid `apartment.json` | C | **8** | The 13 solver tests above. Everything measured is written as `{value, measured: true}`; everything else keeps its form. Limitation: it cannot add or remove corners, rooms or openings. |
| 2 | Alignment lays the model on the real apartment | C | **8** *(prov.)* | Unit tests show exact maths; the e2e test with an offset and rotated wall reads the corner as (0, 0, 0) within 2 mm. Real controller precision (about 0.5–1 cm) must be felt on the Quest. |
| 3 | The guided list covers what matters and is in a sensible order | C | **8** | Rooms in file order: floor, corners, 3 ceiling points, openings, fixtures. Measured and planned items are skipped. 84 points for the placeholder. Order within a room follows the polygon, so you walk around the room. |
| 4 | Nothing is lost: undo, skip, browse, saving, resuming | C | **8** | The event log makes undo work after reloads. Stale data is put aside and can be adopted; a published file clears local data. Covered by unit and e2e tests. |
| 5 | Getting the result back into the repository | C | **7** *(prov.)* | Download, copy and the GitHub upload link work in the browser tests. The upload itself (GitHub in Quest Browser) is not tested. Option B (save to GitHub directly from the headset) would make this one button. |
| 6 | Publishing real measurements cannot break the deploy | C | **8** | The tests use a frozen placeholder; the published file is only checked for validity and that it loads. A broken upload stops at `npm run validate` in CI and is not deployed. |
| 7 | Controls and panel are intuitive and readable on the Quest | N | **7** *(prov.)* | One button per action, a glowing beacon with a label at the target, a panel facing the head with the next step in plain Norwegian, a badge showing touch or point, haptics, and an error with a suggested fix for every refusal. Needs your opinion on the headset. |
| 8 | Pointing at ceilings (hit-test) | N | **6** *(prov.)* | Implemented with WebXR hit-test from the right controller, with a reticle on the surface. The emulator has no room scan, so only the "not available" path is tested. Touch always works as a fallback. |
| 9 | Frame rate while measuring | N | **8** *(prov.)* | Overlay: 2 meshes and about 2 700 triangles; no solid model in passthrough. Each measurement is a one-off of about 11 ms on a laptop; on the Quest perhaps 30–40 ms (one or two dropped frames on the trigger press). |

**Rule check:** all C items are 7–8. One N item is at 6 (pointing), within the rule. Passes, provisionally.

### Test on the Quest (phase 2)

Do this after the phase 2 pull request is merged and the site has updated (about 3 minutes). Have the Quest's room setup done if you want to try pointing at the ceiling.

1. Open the site in Quest Browser. In the panel, under **Oppmåling**, press **«Mål opp leiligheten»**. You should see your room through the cameras (passthrough).
2. **Align:** walk to the entrance door. Put the **yellow ball** in front of the right controller into the inside corner by the door, down at the floor, and pull the trigger. Then touch the entrance wall at least 1 m further in and pull the trigger. White and blue lines (the model's rooms) appear.
3. The panel above your left hand says what to do, and a cyan beacon with a label shows where. Measure a few corners (touch the corner, trigger). Watch the room's lines snap onto your real walls.
4. Try **A** (skip), **B** (undo), **left stick** left/right (browse), and **right stick press** (touch ↔ point). Point at the ceiling with the ray and trigger.
5. Exit with the Meta button. The panel shows «Lokale målinger: …» and the 3D model shows the change.
6. Tell me: was it obvious what to do at each step? Was the panel readable? How did corners and ceiling heights compare with reality? What was the frame rate (Y)?

Because the layout differs a lot, measure a few points to try it out, but expect the full survey to work best after the layout is corrected (see PLAN.md, "Known limitation").

## Improvement round 1 (paused) – options and control – 2026-10-11

Built and tested, then merged at the user's request before the gatekeeper/judge pass; the graphics part of the round has not started.

- **Saved settings** (`leilighet:innstillinger:v1`, per device): ceiling, highlight, layers, view mode, section height, dollhouse, VR turning, VR frame rate. «Tilbakestill innstillinger». Broken storage is safe.
- **VR menu (X):** point with the right controller and pull the trigger. Tabs: Visning (tak, umålte, bildefrekvens), Lag (all layers), Gå til (rooms + start), Komfort (turn 15°/30°/45°/smooth, 72/90/120 Hz).
- **VR turning:** the angle comes from the settings, or smooth turning; right stick back turns 180°. The frame rate is requested from the settings (default 90 Hz).
- **«Gå til rom»:** room buttons in the panel (the camera flies there) and in the VR menu (you are moved there, facing into the room).
- **Dukkehus** (cut the 3D model) and a **section-height slider**.
- **Hurtigtaster** (1/2/T/U/K/R/F/H) with a help window. Fixed: F stopped working after a checkbox was clicked. Added «Tilbakestill visning» and «Fullskjerm».
- Less per-frame work while aiming the teleport arc.
- Tests: 94 unit tests and 30 Playwright tests, all green; 7 of the Playwright tests are new and cover these features.

## Improvement round 2b – graphics, el og vann, lag og filtre – 2026-10-11

Scored with the system in docs/SCORING.md: a gatekeeper checks before a judge scores.

### What was built
- **Graphics:**
  - Lighting with neutral tone mapping, skirting and casings, soft wall, corner and contact shading, sky and ground, and dark cut faces in 2D.
  - Quality presets «Rask», «Standard» and «Høy», and a counter for dropped frames.
- **Electrical and water planning:**
  - Pipes, circuits and new point types in the file.
  - Local plan changes with undo.
  - Drawing on the PC (mouse and keyboard, or large buttons) and in VR (ray, trigger, A and B).
  - A summary with a materials list and guidance hints.
- **Layers and filters:**
  - Groups with a three-state switch and «Bare».
  - Presets, existing/planned, circuit and x-ray, on PC and in VR.
  - Cables and points are never cut and are drawn on top in 2D.

### Gatekeeper (3 passes)
1. **FAIL.**
   - Stored drawings that were invalid could stop the model from loading.
   - VR drawing allocated memory every frame.
   - Missing tests and dead code.
2. **FAIL.**
   - The fix for pass 1 deleted older drawings for good when a measurement made them invalid.
   - VR drawing still allocated about 5 KB per frame.
3. **PASS** (e52d876).
   - All gates green: 130 unit tests and 45 browser tests.
   - 29 draw calls per eye by default and 33 at worst (limit 40). Textures about 4.7 MB.
   - Drawings that no longer fit are hidden, not deleted, and come back when they fit.
   - VR drawing allocates about 2 KB per frame, all of it three.js raycasting (the same kind as the accepted teleport aim), and `xr.update` takes about 0.5 ms.
   - All 8 non-blocking remarks were then fixed in 216dc4b: «Angre» skips hidden drawings, clearer messages, one validation per click, and more.

### Judge (scored at 216dc4b): **7.00 – not accepted**
| Dimension | Weight | Score |
|---|---|---|
| Visual quality | 25 % | 7 |
| Performance on Quest 3 | 20 % | 7 |
| Options and control | 20 % | 7 |
| Intuitive use | 15 % | 7 |
| Code quality and integrity | 10 % | 8 |
| Robustness | 10 % | 6 |

**The blocking finding: ❌ Ikke akseptabel (data loss).** «Forkast» on *old* measurements also deleted every drawing. **Fixed after scoring:**
- It now deletes only the old measurements. «Forkast målingene» and «Forkast tegningene» are separate buttons.
- Unit and browser tests cover it.

Other judge items fixed after scoring:
- VR can choose a circuit for new cables («Kurs for nye» in «Tegn», shown on the wrist panel).
- VR can choose a circuit for the filter («Lag»).
- The VR menu says that «Høy» applies from the next VR session.
- Cable is listed per kind in the materials list.
- The drain-fall hint now checks 1:60, as its text says, toward the lower end.

These fixes have **not** been re-scored by the judge. The round is merged at the user's request («Finish, test, then merge»), with every gate green.

### Next round (the judge's priorities)
1. **Edit what has been drawn:**
   - Change the properties of the selected item.
   - Drag points in 2D.
   - A proper circuit form instead of `prompt()`, with renaming and deleting.
2. **Make the plan easier to read and save:**
   - A distinct symbol or colour per planned point type, and a legend for circuit colours.
   - A save/download button inside «Tegn el og vann».
3. **VR performance:** an allocation-free ray test against the cached wall and floor faces instead of three.js `intersectObjects`.
4. **Measure on the real Quest 3:** read the FPS (Y) in Stue on «Standard», with «Røntgen» on, and while drawing a pipe. This is what can lift Performance to 8.

### Test on the Quest (round 2b)
1. Press X → «Visning» → try «Rask», «Standard» and «Høy». Read the FPS (Y) in the living room on each.
2. X → «Tegn» → «Kaldtvann» (or a cable).
   - Aim at a wall, pull the trigger for each point, then A to finish and B to undo.
   - Try «Kurs for nye» for cables.
3. X → «Lag» → «Elplan» / «Rørplan», then «Røntgen». Does the plan read well inside the walls?
4. On the laptop: draw a cable in 2D (E, click, Enter). Look at the summary and the materials list in «Tegn el og vann».
