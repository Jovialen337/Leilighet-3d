# QA – self-assessment

Scores 1–9 (1–3 failed, 4–6 partial, 7–9 solid). C = critical, N = non-critical.
Rule: all C items 7–9; at most two N items at 4–6, none below 4.
*(prov.)* = provisional, because it can only be fully confirmed on the real Quest.

**Update 2026-10-12 – layout from the user's sketch:**
- `public/apartment.json` now follows the real layout:
  - The hallway (lower floor) at the bottom. The entrance is on its left side, and the wall to the garden is glass.
  - The living room is the centre.
  - The kitchen is reached through a large opening, the bathroom has a raised part, and the grow room has a window to the garden.
- The 2D plan is turned so it looks like the sketch (`settings.planRotation: 90`).
- Sizes come from the measured grow room and the hallway, and will be made exact by measuring on the Quest.
- Assumptions to check are listed in PLAN.md under "The apartment".
- Local measurements or drawings made against the old file are set aside or hidden, not lost.

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

## Phase 2c – «Lag ny modell» – 2026-10-14

The goal: a complete and detailed way to make a new model, as perfect as possible. The design and controls are in PLAN.md (phase 2c).

### How it was tested
- **Unit tests (Vitest)** for everything that can be tested without a browser:
  - walls from rooms (property tests on 5 layouts plus the published apartment), compile, export frame and plan rotation, and import with wall ids kept;
  - the edit operations (corners, edges, rooms, openings follow their edge), the Norwegian length parser and the session (undo, autosave, published detection);
  - the passthrough maths: walls from touches with noise, slanted walls, an L-shaped room, the median filter, openings from frames, and alignment against an existing drawing (rigid, never mirrored);
  - the new checks: unreachable rooms, a short entrance wall, and the entrance-door fixes;
  - the VR menu layout.
- **Browser tests (Playwright, Chromium):**
  - drawing with the mouse (rectangle, «Rom inntil», door, window, then download a valid file with the origin at the entrance door);
  - typed lengths (digits go straight into the field, Tab and Enter, + to add), and an L-shaped room with typed lengths and arrow buttons;
  - dragging a corner and an edge (one undo step each), and arrow-key nudging;
  - starting from the current model (fixtures, furniture and wall ids kept), and «Lukk» showing the file again;
  - reload persistence, saving and opening a drawing file, and published detection;
  - errors with «Vis», and «Lag ny modell i stedet» when `apartment.json` is broken;
  - a background image: load it, set the scale with two clicks and a typed distance, drag it, and keep it after a reload;
  - robustness:
    - a broken drawing from a file or in storage;
    - cables taken into a new model not applied twice after publishing;
    - no VR drawing on a new model;
    - an image that cannot be saved;
    - re-alignment after a tracking reset;
  - the Quest Browser (Quest user agent): no keyboard, big handles.
- **Emulated Quest 3 (IWER) in passthrough:**
  - a 4 × 3 m room from five wall touches, floor and ceiling, with exact corners;
  - a door from three frame touches (width, height and hinge side), and naming from the menu;
  - undo, «same wall» refusal, a slanted wall with grip, and skipping floor and ceiling;
  - re-entering: alignment to the entrance corner in a turned reference space, then re-measuring a room with its door kept.
- Every existing test still passes. Screenshots of the plan, the overlay and the VR menu were checked by eye.

### Gatekeeper (pass 1 at f254688): **FAIL**
- **Gates:**
  - all green: 192 unit tests, 62 browser tests and no console errors;
  - draw calls per eye: 32 when walking the real file (the same as before), at most 34 on a builder preview, 10 in passthrough capture;
  - textures 4.7–8.0 MB.
- **Blocking (all fixed):**
  1. A drawing file where a room had no name passed the rough check. It was saved, and from then on the app could not start until site data was cleared.
     - **Fix:** full validation of drawings, from file and from storage.
     - A stored drawing that cannot be read is set aside under its own key, with a notice.
     - Compiling never throws, and the builder panel and overlay can no longer stop the app.
  2. Cables and pipes drawn on the old model that went into «Start fra nåværende modell» were laid on top of the published new file again, in the old frame. The same applied to measurements.
     - **Fix:** the builder remembers what it took with it. When its export is published, exactly those changes are removed. Anything made later is kept and reported.
  3. Drawing el/vann in VR while walking through a new model saved it in the drawing's own frame.
     - **Fix:** «Tegn» in VR is off while a new model is shown, and the menu says why.
- **Non-blocking (fixed):**
  - dead code removed;
  - hit-test is read only in point mode;
  - nothing is compiled while dragging;
  - background image: an image that cannot be saved also removes the older one (cap 1.5 MB, max 1600 px);
  - old measurements that do not fit stay set aside instead of being deleted. Set-aside measurements now also show after more reloads, an older gap found while testing this;
  - «Åpne tegning …» asks first, and «Hent forrige tegning» brings back the previous drawing;
  - builder keys only work while drawing in 2D;
  - new tests for re-alignment after a tracking reset, the image save failure, broken drawings, changes taken into a new model, and the VR drawing block.
### Gatekeeper (pass 2 at 55d84fa): **PASS**
- **Gates:**
  - all green: 198 unit tests and 67 browser tests;
  - the three blockers re-checked in the browser and fixed;
  - draw calls per eye: 32 when walking the file, at most 34 on a new-model preview, 10 in passthrough;
  - textures 4.7–8.0 MB;
  - while dragging, the compile result is reused (about 1 ms per move).
- **Remarks, fixed afterwards:**
  1. A new model published from *another* device could still leave drawn el/vann in the old frame. Drawn el/vann now remembers the rooms and walls it was drawn on and warns on any device when they change. There is a unit test and a browser test.
  2. The «Forkast tegningen» text now says the drawing can be fetched back.
  3. «Hent forrige tegning» also brings back what that drawing took from the old model.

- **Not changed:**
  - The browser test's draw-call threshold uses the placeholder file.
  - The budget rule is 40 per eye; the gatekeeper measured 32 per eye on the real file.

### Judge (round 1, scored at 6f8dc2b): **7.50 – not accepted**

| # | Item | Verdict | What was missing |
|---|---|---|---|
| 1 | Builder core: walls, compile, import/export | 🟡 | Import → export lost room notes, the planterom's measured `dimensions`, a wall note and `swingDirection` on 3 doors. Skewed facing edges gave no warning. A 45° bay left an ~80 mm notch at the outside corner. |
| 2 | 2D editor (PC and Quest Browser) | 🟡 | «-1100» in a coordinate field was taken as «subtract». Dimensions and labels cluttered the plan, and Quest handles could lie on top of each other. No partition thickness, typed move, copy or rotate. A 45° square snapped to 2998 × 2998. Selecting an edge did not name the edge. |
| 3 | App integration | ✅ | – |
| 4 | Passthrough capture | 🟡 | A room measured slightly skewed stayed skewed, with no warning. Still needs a test on a real Quest. |
| 5 | Robustness | ✅ | – |
| 6 | Tests and docs | 🟡 | Missing tests for these gaps. The Quest Browser test accepted two door offsets. PLAN did not say exactly what «Start fra nåværende modell» carries over. |

Dimensions: visual 7, performance 8, options 8, intuitive 7, code 7, robustness 8. Weighted 7.50, below the 8.0 needed, and four items were 🟡. Another round was worth it.

### Round 2 – the judge's list
- **Import keeps every field.**
  - Carried over: room notes, layers and control dimensions; wall notes, layers and fixed heights; opening notes, layers, opening angle, leaf and frame colours.
  - `swingDirection` is worked out on every save.
  - Control dimensions that no longer fit are shown on the room.
  - Rooms and openings have a note field.
- **Walls.**
  - Warnings for skewed facing edges (under 3°: thickness at each end; 3–10°: two exterior walls may overlap), with «Rett opp alt».
  - Outside corners are closed at every angle (bay, chamfer, slanted wall, acute corner).
  - The common axis keeps straight rooms in place.
- **Editor.**
  - Signed coordinate and floor fields (relative with «+=» / «-=»).
  - Partition thickness, «Flytt rommet», «Kopier rommet» and «Roter 90°».
  - The 45° snap rounds the sides, and the selection message names the edge.
  - Overlay: dimensions only where they fit, plus the selected and hovered rooms; handles drawn by priority and never overlapping; note and fixture labels hidden while building.
- **Capture.** A room measured under 3° off the drawing is turned onto its axis about the first touch, and the panel says by how much.

**How it was tested:**
- **Unit tests:**
  - no field lost in the published file (with extra fields added: wall height, door angle and colour, frame colour, room layer, plain-number control dimensions);
  - `swingDirection` recomputed when the hinge changes;
  - corner property tests (no hole, nothing outside the outer faces, nothing inside the room) for a 45° bay, a chamfer, a 30° wall and a 37° corner;
  - skew warnings at 0°, 1.5°, 6° and 45°, and «Rett opp alt» leaving the straight room alone;
  - the signed length parser;
  - partition thickness, copy, rotate, and the 45° snap;
  - `alignToAxis`, also on a drawing turned 30°.
- **Browser tests:**
  - copy, partition thickness, rotate, typed move, negative coordinates and floor level, «+=», a skewed corner with «Rett opp alt»;
  - labels hidden while building;
  - the exact door offset (200) in the Quest Browser test;
  - emulated Quest: a second room measured 2° off ends up straight, with one 100 mm partition and no warning.

### Gatekeeper (round 2, pass 1 at 89ea30f): **FAIL**
- **Gates:**
  - all green: 219 unit tests and 71 browser tests;
  - draw calls per eye: 32 when walking the real file, 32 on a builder preview in VR, 10 in passthrough;
  - textures about 4.7 MB;
  - the published file round-trips with every field kept and no skew warning;
  - drawings stored by the previous version still open.
- **Blocking (both fixed):**
  1. **A long spike where a thin and a thick exterior wall meet at a shallow bend.**
     - With a 300 mm wall next to a 200 mm wall at 3°, the thin wall was stretched 1.9 m: out of the building, or into an L-shaped room.
     - **Fix:** when the thick wall covers the corner by itself, the thin wall only fills the wedge between the wall ends, and very sharp tips are cut at 4 × the thickness.
     - New property tests cover 3°, 5°, 10° and 30° bends with the thick wall before or after the bend and after an inside corner. They fail on the old code and pass now.
  2. **The name fields lost their style.** The new CSS was inserted inside the `.name-input, .len-input` selector list.
     - **Fix:** the rules are restored, and a browser test checks the style of the name fields.
- **Remarks, fixed:**
  - Skew warnings caused by 1–2 mm rounding on short edges: the gap must now vary by at least 5 mm.
  - A room turned in during capture can be kept as measured with B then A.
  - «+150» adds in every field (minus is a value only in coordinate and floor-level fields).
  - In «Flytt rommet», Enter in an empty field counts as 0.
  - «Roter 90°» four times gives exactly the same room, also with odd sizes.
  - The end handles of a short opening are set outside its ends instead of being hidden. A drag counts from where you took hold, and there is a new browser test for dragging an end.
  - The move handle is drawn before the edge handles.
  - «Rett opp rommene» on a skew warning straightens only the two rooms named. Rooms that are not straightened stay still.
  - A copy no longer copies the names and notes of the openings.
  - Doc comment and exports tidied in `ops.ts`.
- **Not changed:**
  - Wall bodies overlap at closed corners with tops in the same plane. They are the same colour, so no flicker is visible.

### Gatekeeper (round 2, pass 2 at 51c050a): **PASS**
- **Gates:**
  - all green: 239 unit tests and 72 browser tests, with no console errors;
  - draw calls per eye: 32 when walking the real file, 32 on a builder preview, 10 in passthrough;
  - textures about 4.7 MB;
  - the published file compiles byte-identically to before.
- **Corners:** checked on a 15 mm grid in 27 layouts at three versions. There are no holes, no intrusions and no far points.
  - The gatekeeper's repros went from 1.1–2.6 m spikes to at most 349 mm from the room.
- **Remarks:**
  - In «Flytt rommet», «-3» moved 3 mm while «3» moved 3 m. **Fixed:** the sign is only the direction there.
  - Accepted as designed and documented:
    - «Rett opp rommene» can move one of the two rooms up to 30 mm onto a nearby room's line;
    - very sharp tips are cut at 4 × the wall thickness;
    - corner overlap.

### Judge (round 2, scored at 4c50135): **7.75 – not accepted**

| # | Item | Verdict |
|---|---|---|
| 1 | Builder core | ✅ every field survives; skew warnings with a fix; corners closed at every angle |
| 2 | 2D editor | 🟡 dimension labels still overlapped in the bathroom on the real plan; side labels under the selected room's handles; handles partly overlapping |
| 3 | App integration | ✅ |
| 4 | Passthrough capture | 🟡 turning the closed room fixed the angle but kept the dimension error. A second touch 1 cm off over 60 cm gave a 125 mm partition and a 2981 mm depth (target ±5 mm) |
| 5 | Robustness | ✅ |
| 6 | Tests and docs | ✅ |

Dimensions: visual 7, performance 8, options 8, intuitive 8, code 8, robustness 8, weighted 7.75. Another round was worth it.

### Round 3 – the judge's list
- **Capture: solved on the drawing's axis.**
  - When the first wall is within 3° of the axis, the axis is the room's direction, and each wall line goes through its own touches.
  - The rigid turn is removed. B then A still keeps a room as measured.
  - With no axis, a first-wall baseline under 1 m gets a warning.
- **Labels:**
  - placed without covering other dimensions, room names (measured from the label) or handles;
  - horizontal, then along the edge, then (selected room only) outside the edge;
  - for other rooms, only inside the room;
  - text widths measured with the real font;
  - left out when there is no spot.
- **Handles:** left out by r1 + r2, and the most important is drawn on top.
- **Small fixes:**
  - «-3» is −3 m in coordinate fields;
  - «Angre» and «Gjør om» update the message.
- **Optional:** «Del rommet» (split a room with a partition).

**How it was tested:**
- **Unit tests:**
  - the judge's noise case (partition 100 ± 5 mm, depth 3000 ± 5 mm), a straight room, the first room, a deliberately slanted room, a grip-touched slanted wall and a turned drawing;
  - signed «-3»;
  - splitting (openings, measured corners, refusals).
- **Browser tests:**
  - zero overlaps with every room selected, on PC and in the Quest Browser;
  - undo and redo messages;
  - «Del rommet».
- **Emulated Quest:**
  - the noise case end to end (partition 100 ± 5 mm, depth 3000 ± 5 mm, no skew warning), with B + A;
  - the short-baseline warning.
- **The published file:** zero overlaps at 1280×800, at 1920×1080 and in the Quest Browser, with nothing, the bathroom or the living room selected.

### Gatekeeper (round 3, pass 1 at f34405e): **FAIL**
- **Gates:**
  - all green: 243 unit tests and 76 browser tests, with no console errors;
  - draw calls per eye: 32 when walking the file, 32 on a builder preview, 10 in passthrough;
  - textures about 4.7 MB;
  - capture on the axis, labels, handles and the small fixes checked out.
- **Blocking (both fixed):**
  1. «Del rommet» left doors pointing at the old room. Splitting «Bad» on the real file made «Baddør» invalid, and saving was blocked.
     - **Fix:** a door into the split room now goes into the part it stands against: its own doors get the new part, and doors in neighbours get «går inn i» worked out again.
     - New tests: a door from a neighbour, and every room of the published file in a unit test and through the UI in a browser test. Every allowed split gives a valid file.
  2. Splitting a U-shaped room across the U made one «room» out of two pieces, joined by walls on top of each other. Validation accepted it.
     - **Fix:** the split is refused when the line crosses the room more than once. There is a U test, and an L split through its inside corner still works.
- **Remarks, fixed:**
  - A split that would cut through an opening is now refused with the opening's name, instead of silently removing it. This also covers openings in a neighbour's wall facing the room.
  - Rooms with a sloped ceiling can be split; the new corners take their height from the ceiling's plane. On the real file, every allowed split of every room gives a valid file.
  - The overlay reads a room label's size from the page only when its name or area changes, not on every redraw.
  - The «Velg» hint says that selecting a room shows all its corners and dimensions.
  - A grip-touched wall uses the drawing's axis only when the first wall does. B + A is offered whenever the axis changed anything.

### Gatekeeper (round 3, pass 2 at ad0c276): **FAIL**
- **Gates:** all green (248 unit tests, 77 browser tests); 32 draw calls per eye; textures about 4.7 MB.
- **Pass 1's blockers:**
  - The door fix holds: 557 splits of the published file and the placeholder (every 50 mm) left no door pointing at the wrong room.
  - The U refusal holds.
- **Blocking (fixed):**
  - A partition flush with an existing wall (for example at x = 1950 in an L whose inside corner is at x = 2000) left a zero-width «needle» along the old wall. That gave a phantom exterior wall and a 4 m partition, and the file still exported as valid.
  - **Fix:** after clipping, corners where the outline doubles straight back are removed, and the checks run again.
  - New tests: flush partitions in L, U and T rooms, and a sweep of every 50 mm split in L, U, T and comb-shaped rooms. Every allowed split gives two simple rooms with no needle, and the areas add up.
- **Remarks, fixed:**
  - Slivers are refused: each part must be at least 50 cm wide from the partition.
  - A measured sloped ceiling is no longer marked measured after a split, because the new corners are interpolated.
  - The label-size cache key no longer changes on every corner drag.
  - When only a grip wall was snapped, the panel no longer says «Rettet inn 0,0°».
- **Sweep after the fix:** every 50 mm on both axes, in every room of both files, gives 317 allowed splits, all of which compile without errors. The other 891 positions are refused with a reason.
- **Test timeouts:** after a container restart the long emulated-Quest scenarios took 49–58 s, also at the previous commit. They now have 90 s, like the long tests in plan.spec.

### Gatekeeper (round 3, pass 3 at 8b88cdd): **PASS**
- **Gates:**
  - all green: 252 unit tests and 77 browser tests, with no console errors;
  - draw calls per eye: 32 when walking the file, 32 on a builder preview, 10 in passthrough;
  - textures about 4.7 MB.
- **Needle fix:** the flush L split gives a clean 2 × 2 m room and a 2 m partition, with no phantom wall.
- **Fuzz** (every room, both axes, 50 mm steps):

  | Input | Allowed | Bad | Area error |
  |---|---|---|---|
  | Published file | 103 | 0 | 0 |
  | Placeholder | 214 | 0 | 0 |
  | Synthetic U, T, comb and L | 370 | 0 | 0 |

  All other positions are refused with a reason.
- **Remarks:**
  - The partition strip is taken out across the whole room, so a flush split on the «wrong» side narrows the other leg of an L by 100 mm. This is now stated in the panel hint and in PLAN.
  - A harmless leftover corner can stay in the middle of a straight edge.
  - The overlay costs a little more per redraw, and more of the other rooms' corners are hidden when zoomed out. Both are by design.

### Judge (round 3, scored at c5aabf0): **8.00 – accepted**

| # | Item | Verdict |
|---|---|---|
| 1 | Builder core | ✅ every field survives; skew warnings with a fix; corners closed at every angle |
| 2 | 2D editor | ✅ no label collisions or handle overlaps on the PC at either size with any room selected; signed fields, undo messages, copy, rotate, move, partition thickness and «Del rommet» |
| 3 | App integration | ✅ the preview is the real model at 32 draw calls per eye |
| 4 | Passthrough capture | ✅ re-solved on the drawing's axis. Corner error is at most 5 mm in the noisy case (round 2: 39 mm), and the partition comes out at exactly 100 mm. A deliberately slanted room is kept, B + A works, and a short baseline is warned |
| 5 | Robustness | ✅ «Del rommet» refuses bad splits with a reason; the fuzz found 0 bad results in 687 allowed splits |
| 6 | Tests and docs | ✅ |

All six dimensions scored 8: visual quality, performance, options and control, intuitive use, code quality, and robustness. The weighted total is **8.00**, so the round is accepted. The judge advised against a round 4; the small gaps left are under «Later work» in PLAN.md (phase 2c).

**After acceptance:** the judge's first later-work point is fixed. «Del rommet» used to cut a turned room (as measured in passthrough) along the plan's axes, making a slanted partition. It now splits in the room's own frame.
- A unit test covers a room turned 20°: two rectangles, one 100 mm partition and no skew warning.
- Axis-aligned rooms are unchanged: the sweep of both files again gives 317 allowed splits with 0 errors.
- All unit and browser tests pass.

### Test on the Quest (phase 2c)
1. **Laptop, background image:** in «Lag ny modell», open «Bakgrunnsbilde» and load the sketch or a floor plan. Set the scale with a known wall length, then trace the rooms on top of it.
2. **Quest Browser, 2D:**
   - Open the page and press «Lag ny modell …» → «Ny tom modell».
   - Draw a room with the laser pointer, type a width with the system keyboard, and drag a corner. Are the handles easy to hit?
3. **Passthrough:**
   - «Lag ny modell …» → «Mål opp i gjennomsyn».
   - In the hallway: touch the entrance wall twice, then each other wall once, then A, the floor and the ceiling.
   - X → «Dør», then touch the hinge side of the frame, the other side, and the top.
   - Do the corners land where the real corners are (within about 2 cm)?
4. X → «Nytt rom» and measure the living room. Did the panel say «Rettet inn …°», and by how much? Then look at the result on the laptop: «Fortsett på ny modell …».
   - Is there one partition between the hallway and the living room, with no skew warning in «Sjekk»?
   - Measure one wall with a tape and compare. **Please report the difference; the target is at most 2 cm.**
5. **«Gå gjennom i VR»:** does it feel like the real apartment?

## Phase 2d – «wow» graphics on the Quest 3 – 2026-10-16

Goal from the user: «Do a graphics update. I want a wow experience when I put on the Quest 3!!!» One improvement round per [SCORING.md](SCORING.md); what was built is in PLAN.md «Phase 2d».

### Research (round 1)

**Research A (graphics), taken:**
1. Baked daylight and ambient occlusion in the vertex colours. It replaces the room shade meshes, so there are 2 fewer draw calls per eye.
2. Sun patches through the windows. Also built: patches up the walls, the mullion's shadow, and «screen» blending.
3. An outdoor view and believable glass. The sky clouds, horizon hills and tree line are in a shader plus one small texture instead of a 2048×1024 panorama: about 2.8 MB instead of 11 MB, and the colours follow «Lys». Grass on the ground. Fresnel glass.
5. The entrance moment: fade from black, exposure rise, and a short black on «Gå til rom».
6. Sharpness per preset: foveation and resolution on «Høy». Foveation applies at once.

**Research A, also taken:** 4, procedural surface detail, for the floors only: wood boards, and tiles where there is a drain. Walls come later.

**Research A, not taken this round:** the controller mesh merge (7) and floor reflections (8). They are listed as later work in PLAN.md.

**Research B (options and control), taken:**
1. Fade, plus facing the longest view. This is computed from the walls and openings, so it stays data-driven.
2. «Lys» (Morgen/Dag/Kveld). «Dag» is exactly the old lighting, so the lighting test still passes. It is on the laptop (with the L key) and in the VR menu, and saved per device.
3. One graphics profile, as a pure function with a unit-tested matrix: passthrough never shows sky or effects; the 2D plan has no sun, sky or lamps.
6. Budget guards in the tests: `stats()` now reports `drawCallsPerEye` and `textureBytes`. A browser test visits every room in four directions on «Standard» (morning, day and evening) and on «Høy» (evening).
7. «Grafikk» and «Lys» moved to the top of «Visning» on the laptop; the help lists L.

**Research B, not taken this round:** the quieter wrist panel (4), comfort options (5) and per-effect toggles (part of 3). They are listed as later work in PLAN.md.

### How it was tested

- **Unit tests** (all green):
  - the lighting presets: «Dag» is the old lighting; the morning sun is lower; the evening is darker with the lamps on;
  - the grid keeps the surface area, and neighbouring triangles share the same corners along their edge (no cracks);
  - the form factor checked against known cases (a large plane ≈ 1, behind = 0, a small window ≈ A/(πd²));
  - the bake: bright 1 m in front of a window, darker at the back and in corners, within limits, unchanged outside;
  - the sun patches: inside the window's room, on the floor or between floor and ceiling, window coordinates within 0–1, none when the sun is low or behind; and convex clipping;
  - the rays fade to 0; the lamp glow sits on the ceiling and floor in the lamp's layer;
  - the graphics profile for every quality in the laptop, 2D, VR and passthrough;
  - the fade: black, then in, then hidden, with the exposure back at 1; a jump moves at once;
  - the start direction: on the placeholder it looks through the openings (sightline > 5 m) rather than at the hallway wall (< 2.5 m), and sightlines stop at walls and windows but not at openings.
- **Browser tests in the emulated Quest 3** (new file `graphics.spec.ts`):
  - entering VR fades in and hides the sphere afterwards, faces +x, and «Gå til rom» goes black then fades in;
  - every room in four directions: at most 40 draw calls per eye and at most 32 MB of textures on «Standard» (morning, day, evening) and «Høy» (evening);
  - «Lys» in the VR menu: the evening lights the lamps and is remembered after a reload;
  - on the PC: «Lys» and L, sun on «Standard», rays only on «Høy», flat colours on «Rask», no sun or sky in 2D;
  - passthrough has no sky, sun, lamps or fade.

  The existing tests were updated for the new start direction and the «Høy» message in VR.
- **Screenshots** from the emulated Quest 3 compared before and after (at the start point, in the living room, and in the morning, day and evening).
- **Numbers** (on the placeholder; the gatekeeper's numbers on the real file are below):
  - draw calls per eye at the start on «Standard»: 25 (was 32);
  - living room: 16 on «Standard», 18 on «Høy», 14 in the evening;
  - textures: about 10–11 MB (clouds 2.8 MB, floor pattern 2.8 MB, grass 0.35 MB, plus the menu and wrist canvases);
  - about 20 000 triangles;
  - building the scene with the bake takes about 110 ms in the browser here.

### Gatekeeper (pass 1 at 0cdd44e, docs-only commits after it): **PASS**

- **Checks:**
  - typecheck, validate, 271 unit tests, the build and 82/82 browser tests all pass;
  - 0 console errors or warnings in every combination of quality and light, on the laptop, in 2D and in VR, on the real file;
  - CI is green.
- **Budget on the real `apartment.json`** («Standard»):

  | Measure | Result |
  |---|---|
  | Draw calls per eye, at the start | 32 |
  | Draw calls per eye, worst | 33 (Dag, the hallway) |
  | Draw calls per eye, Morgen and Kveld | 29 |
  | Draw calls per eye, «Høy» | 30 |
  | Draw calls per eye, «Rask» | 21 |
  | Textures | 10.3 MB |
  | Per-frame allocations | none |

  Heavier effects are only on «Høy». The bake gives no NaN values and its factors stay within 0.40–1.45. Bad storage falls back to the defaults.
- **Merged as PR #8** (d1d4529), at the user's request.
- **Non-blocking remarks, all fixed in the follow-up:**
  1. **Rebuilding the model was about 3× slower**, so every el/vann drawing re-baked everything. The bake is now cached per part and only redone when the part, or the rooms, walls or openings that light it, change. A rebuild after drawing a cable takes about 35 ms instead of about 90 ms, about the same as before the round. A unit test checks that it reuses unchanged parts and re-bakes when a window moves.
  2. The docs disagreed with the code (floor pattern, texture MB). Fixed.
  3. A stale comment. Fixed.
  4. `isInnerCorner` was dead code. Removed.
  5. The window frame width was in two places. Now one constant, `WINDOW_FRAME` in buildParts.
  6. **Lamp light went past the walls and ignored the filters.** The glow now stops at the room's walls, and it follows the existing, planned and circuit filters. Both are tested.
  7. **Sun patches only fell in the window's own room.** They now also land in rooms with no wall in between. The evening sun through the bathroom window now lights the rest of the bathroom (tested on the real file).
  8. **In x-ray, sun patches lit up the see-through walls.** Sun, rays and lamps are now off in x-ray (the graphics profile, tested).
  9. **In the VR menu, the «Høy» note was under «Lys».** It is now directly under «Grafikk».
  10. **The wall grid does not line up with the floor grid on walls that are not axis-aligned.** No change needed: they are not in the same plane, so there are no cracks.

### Test on the Quest (phase 2d)
1. **The first seconds:** «Gå inn i VR».
   - Does it fade in from black, with no jump?
   - Do you face through the openings toward the living room and the kitchen?
   - Is it a «wow»?
2. **Daylight:** look around the hallway (glass wall) and the living room.
   - Is it brighter near the windows, with darker corners?
   - Are the sun patches on the floor sharp and still, with no flicker when you move your head?
   - Do the wood boards in the floor shimmer at a distance?
3. **X → Visning → Lys:** try «Morgen», then «Kveld» (the lamp in the living room should glow), then back to «Dag».
4. **Frame rate (Y):** on «Standard», does it hold 90 fps with few dropped frames in every room? **Please report the ms number**: if it is well under 11 ms, «Standard» can get sharper edges as well (less foveation).
5. **«Høy»:**
   - Is it sharper at once?
   - Are the faint light rays from the windows nice, or too much?
   - Does it still hold 90 fps after you leave VR and enter again?

### Judge (round 1, scored at d1d4529): **7.25 – not accepted**

| # | Item | Score | Verdict |
|---|---|---|---|
| 1 | Baked daylight and ambient occlusion | 6 | 🟡 Rebuilds are 3× slower; flicker in the bathroom corner; flat white walls by the glass wall |
| 2 | Sun patches, rays, lamp glow | 7 | 🟡 A ray line seen edge-on; the lamp glow spills past the walls and sits on the el layer; patches show through x-ray |
| 3 | Sky, ground, glass, floor pattern | 7 | 🟡 The glass turns milky at an angle; wood boards on the green grow-room floor; docs out of date |
| 4 | «Lys» | 7 | 🟡 «Kveld» doesn't read as evening (no lamp light, same daylight); the «Høy» note sits in the wrong place |
| 5 | VR entry | 8 | ✅ |
| 6 | Profile, budget guards, tests, docs | 7 | 🟡 No test for rebuild time; docs disagree with the code; leftover code |

Dimensions:
- visual quality 7;
- performance 7;
- options and control 7;
- intuitive use 8;
- code quality 7;
- robustness 8.

Weighted total **7.25**. Another round is worth it (round 2 of 4).

### Round 2 – the judge's list

1. **Bake only what changed, and only when needed.**
   - The bake and the grid are cached per part, and merged meshes made of the same parts are reused.
   - Rebuilding after a drawing takes about **20 ms** in the browser here (target ≤ 50 ms) and about **72 ms** at 4× CPU slowdown (target ≤ 150 ms). Round 1 took 117–133 ms and 320–390 ms.
   - Tests require a cached rebuild to take under 60 % of a full bake, and the building's meshes to be reused when you draw.
   - Nothing is baked on «Rask».
   - Measured on the real file in emulated VR, worst draw calls per eye in any room and direction:

     | Setting | Draw calls per eye |
     |---|---|
     | Standard, Dag | 26 |
     | Standard, Morgen | 25 |
     | Standard, Kveld | 27 |
     | Høy, Kveld | 29 |
     | Rask | 17 |

     Textures are 11.7 MB, with 0 console errors.
2. **The bathroom flicker is gone.**
   - Cause: a wall end in the same plane as another wall's face (at flush corners), and the casing and skirting sharing a front.
   - Covered wall ends are no longer drawn, the casings are thicker than the skirting, and the skirting stops behind them.
   - A test finds no visible wall faces on top of each other, in either file.
3. **The bright end flattens softly** (at most 1.3, with a lower room fill). The day start view has 0 % of pixels above 245.
4. **«Kveld» reads as evening.**
   - The bake stores base light, daylight and lamp light separately, and «Lys» mixes them again.
   - Kveld uses daylight ×0.3, hemisphere light 1.1, baked lamp light and a lit lamp face.
   - The start view is **48 %** of the day brightness (target ≤ 65 %).
   - The lamp area is the brightest part of the living room in the evening (tested).
5. **Lamp light:**
   - The glow stops at the walls, follows the sloped ceiling, sits on the room's layer and follows the filters.
   - Sun, rays and lamps are off in x-ray.
   - Sun patches continue into rooms with no wall in between.
6. **Glass:** clearer at an angle; the outside is visible through the living room's side windows.
7. **Rays:** they fade out when a face is seen from the side, so there is no bright line.
8. **Floors:**
   - wood only where the floor colour looks like wood;
   - tiles where there is a floor drain;
   - a calm vinyl elsewhere (a third texture layer).
9. **Laptop and VR menu:**
   - on the laptop, the long hint is split into one under «Grafikk» and one under «Lys»;
   - in the VR menu, the «Høy» note is directly under «Grafikk».
10. **Docs and code:**
    - the docs match the code, and the numbers are measured on the real file;
    - one `WINDOW_FRAME` constant; `isInnerCorner` removed; a stale comment fixed;
    - new tests: rebuild speed, morning in the VR budget run, lamp light inside the room, and the evening mix.
11. **Long VR scenarios:** the pipe-drawing test and the step-walking test now have 90 s limits, like the other long VR tests. Alone they take 40–47 s, so they timed out when the machine was busy with other work.
12. **CI:** the job limit went from 20 to 35 minutes. The suite has about 85 tests: the PR #8 run took 19 minutes, and the first PR #9 run was cut off at test 71, with every test up to then passing.

### Gatekeeper (round 2 at 13bd63e): **FAIL**

- **Blocking:**
  - **The baked lamp light does not follow the lamps.** `bakeLightKey` hashes only rooms, walls and openings, so moving, adding or deleting a lamp leaves its old light until a reload. The merged-mesh reuse keeps the stale light too.
  - **The baked lamp light ignores the el filters.** The glow follows them, but the floor colours do not change.
- **Passing:**
  - typecheck, validate, 280/280 unit tests and the build;
  - CI green on 13bd63e;
  - 0 console errors;
  - wall ends: no holes, in any of the cases tried;
  - mesh reuse: no leaks, and the state is right after a plan change.
- **Budget, real file, 6 rooms × 8 directions:**

  | Setting | Worst draw calls per eye |
  |---|---|
  | Standard, Dag / Morgen | 32 |
  | Standard, Kveld | 34 |
  | Høy, Kveld | 36 |
  | Rask | 24 |

  Textures are 11.7 MB. A rebuild after drawing a pipe has a median of 37 ms (115 ms at 4× CPU slowdown).
- **Non-blocking remarks** (handled in round 3 unless noted):
  1. `capCover` ignores openings in the covering wall. This is only with a test window, so it is noted for later.
  2. The draw-call numbers in the docs were too low. Fixed.
  3. The lit lamp underside sits on the room's layer. It is now on the lamp's own layer.
  4. In the VR menu, the «Høy» note moved the «Lys» row down. The space is now always kept.
  5. Pre-existing: the back wall floats 150–180 mm above the ground. Noted.

### Judge (round 2, scored at 13bd63e): **7.9 – not accepted**

| # | Item | Score | Verdict |
|---|---|---|---|
| 1 | Baked daylight and ambient occlusion | 8 | ✅ |
| 2 | Sun patches, rays, lamp light | 7 | 🟡 The baked lamp light ignores plan edits and filters |
| 3 | Sky, ground, glass, floors | 8 | ✅ |
| 4 | «Lys» | 8 | ✅ |
| 5 | VR entry | 8 | ✅ |
| 6 | Profile, budget, tests, docs | 8 | ✅ |

**Dimensions:**
- visual quality 8;
- performance 8;
- options 8;
- intuitive use 8;
- code quality 7 (the cache key misses the lamps, and two places decide whether a lamp is on);
- robustness 8.

**Its round-1 criteria, now met:**
- rebuild 34–39 ms, and 77–103 ms at 4× CPU slowdown;
- no flicker at the bathroom corner;
- the brightest wall pixel is 238;
- «Kveld» is 48 % of «Dag»;
- the lamp area is the brightest;
- the glass is clear at 60–70°;
- no ray line;
- no wood boards in the grow room or kitchen.

**Round 3 should be small:**
1. Fix the lamp light (required).
2. Polish «Kveld»:
   - a weaker key light;
   - warm lamp light per colour channel.
3. Fix the dotted seam in the bathroom corner.
4. Correct the docs.

### Research (round 3)

**Research A (graphics):**
- **Proposals:**
  - window reflections in the floors (with true depth in VR, no draw calls);
  - coloured light per «Lys», plus the lamp key fix (the same bug the judge and gatekeeper found);
  - paint and wet-room tiles on the walls;
  - more depth outside;
  - a polish bundle (soft lamp falloff, dithering, rounded edges).
- **Taken:** coloured light, the lamp fix and the soft lamp falloff.
- **The rest:** later work in PLAN.md, as the judge asked for a small round.
- **Advice not taken:** to hold back «Natt» with one lamp in the file. «Natt» now has dim, cool moonlight in rooms without a lamp, so they are not black.

**Research B (options and control):**
- **Taken:**
  - **«Egendefinert»** as a fourth graphics choice, with «Skarpere bilde» as its own choice. The set is saved, and a preset does not erase it.
  - **Wrist panel fixes:** the same area format as the laptop, short names, a teleport hint, the current room marked in «Gå til», and «VR: vis alltid hjelp på håndleddet» on the laptop.
  - **Pointer lines** only while they are in use (2 fewer draw calls per eye).
  - **Robustness fixes:**
    - The fade from black finishes even without a model.
    - «Tilbakestill innstillinger» also resets the 2D view, with a test that compares every setting with a fresh state.
    - Passthrough keeps the default foveation; «Høy»'s 0.25 no longer applies there.
- **Not taken:** seated mode, the vignette and blink, «Gå rundt» on the laptop, and view modes. They are later work.

### Round 3 – what changed

1. **Lamp light (the blocker):**
   - The lamp share of the bake is computed apart from the daylight, from the lamps that exist and pass the el filter. One function, `lampLit`, decides «is this lamp on» for both the glow and the bake.
   - It is recomputed only when the lamps change, and the merged-mesh signature includes it.
   - Tests:
     - a drawn lamp gives the same colours as a fresh bake, and deleting it restores them;
     - hiding «existing», or choosing another circuit, gives the colours of a model without the lamp;
     - «Lampelys» off removes the baked light too.
2. **«Kveld»:**
   - the key light is 0.3 instead of 0.8;
   - blue window light and warm lamp light, tinted per channel with the brightness kept (tested);
   - the glow fades softly, with no peak and no ring.
3. **Seam in the bathroom corner:**
   - **Cause:** the kitchen's outer wall runs into the bathroom's outer wall, and its hidden side face ended exactly in the bathroom wall's visible face, so it showed through as a dotted line.
   - **Fix:** covered ends that overlap the other wall are pulled 2 cm into it. Tessellated corners are fixed to 1 µm.
   - **Test:** no hidden side face has an edge in a visible wall face. Three known junctions in the real file are listed for later.
4. **Already in this round:**
   - one mesh per controller;
   - the wrist panel with the room;
   - «Egendefinert»;
   - «Natt».
5. **Docs:** the gatekeeper's draw-call numbers are used, and the rebuild time is compared like for like.

### Gatekeeper (round 3 at ae211d5): **FAIL**

**Blocker:** the 2 cm wall-end inset opened see-through slits at corners where both walls run through the corner.
- At such a corner each end lies in the other wall's outer face, so both were pulled in, and a 20 × 20 mm column belonged to neither wall.
- Rays cast at every wall end in the real file found 7 corners. One is visible from the grow room (5600, 4000) and one from the kitchen (8000, 1600); the rest are outside corners or below the floor.
- The placeholder has only butt joints, so its tests could not see this.

**Passed:**
- the round-2 lamp blocker (0 colour components differ from a fresh bake, for drawing, moving, deleting and filters);
- «Natt», «Egendefinert» (all 32 context combinations) and the saved settings;
- VR budget: worst 34 draw calls per eye (Høy and Egendefinert, Kveld), textures 11.67 MB;
- nothing new allocated per frame.

### Judge (round 3, scored at ae211d5): **8.0 – not accepted**

| # | Item | Score | Verdict |
|---|---|---|---|
| 1 | Baked daylight and ambient occlusion | 8 | ✅ |
| 2 | Sun patches, rays, lamp light | 8 | ✅ Lamp light verified for drawing, moving, deleting and filters |
| 3 | Sky, ground, glass, floors | 8 | ✅ |
| 4 | «Lys» | 7 | 🟡 The 2D plan follows «Lys», so it is nearly black in «Natt» |
| 5 | VR entry, wrist panel, controllers | 8 | ✅ |
| 6 | Profile, «Egendefinert», budget, tests, docs | 8 | ✅ |

**Dimensions:** visual quality 8, performance 8, options 8, intuitive use 8, code quality 8, robustness 8.

**Its measurements:**
- «Kveld» is 44 % of «Dag»;
- rebuild after a pipe: 39 ms, or 103 ms at 4× slowdown;
- worst draw calls per eye: 32;
- the bathroom seam is down to sparse single-pixel dots.

**Round 4 (the last) should be small:**
1. Neutral light in the 2D plan (required).
2. VR text fixes, and «Egendefinert» starting from the current preset.
3. Optionally, re-mix the colours instead of re-merging when a lamp moves.

### Round 4 – what changed

1. **Corner slits (the gatekeeper's blocker):**
   - **Rule:** where both walls run through a corner, one wall owns it: the taller one, or the lower id if they are the same height.
     - The owner draws its end face.
     - The other wall is clipped back to the owner's inner face (outline and holes), which makes a plain butt joint.
     - Covered ends that only overlap still get the 2 cm inset.
   - **Clipping:** the outline is clipped properly, so a ceiling break point near the end can no longer fold it.
   - **New test:** rays from outside the walls toward every corner of every wall end, in both files. Whenever a ray enters a wall, it must hit a front face there; door and window openings count as holes. The test fails on round 3 at exactly the gatekeeper's corners and passes now.
   - **Known seams:** the known hidden-edge junctions in the real file drop from three to one. That one is the stue/planterom partition, which starts inside the grow-room wall.
2. **Neutral 2D light (the judge's item 4):**
   - The laptop's 2D plan always uses «Dag»'s light and bake mix, with no tint, whatever «Lys» says.
   - «Lys» affects 3D and VR, and comes back when you leave 2D. The hint under «Lys» says so.
   - **Browser test:** the floor colour in the hallway, living room and grow room is the same in 2D for all four choices (difference < 3), and 3D at night is darker again.
3. **«Egendefinert» starts from the current preset:**
   - Choosing it from «Høy» with no saved set keeps «Høy»'s effects, so rays and the sharper image are not switched off.
   - A saved set is kept.
4. **Moving a lamp re-mixes instead of re-merging:**
   - The lamps are no longer part of the merged-mesh signature.
   - A reused mesh gets the new lamp light copied in, and its colours are mixed again. In «Morgen» and «Dag», where the lamps are off, only the light is copied.
   - **Test:** walls, floors and ceilings keep the same meshes when a lamp is drawn, with the same colours as a fresh bake. In «Dag» a new lamp changes nothing until «Kveld».
5. **VR texts:**
   - «Skarpere nå – full oppløsning neste gang i VR.» now fits;
   - «Dagslys og skygger»;
   - «Lampelys (kveld og natt)».

### Gatekeeper (round 4 at 40d2985): **FAIL**

**Fixed:** the corner slits are gone.
- 607,346 rays on the real file and 626,209 on the placeholder show no hole.
- The probe flags all 7 corners on round 3.
- Clipping holds up under 9 mutations (windows and passages across a cut line, short walls, a taller room).

**Blocker:** the butt joints brought back dotted seams. That includes the bathroom corner that round 2 had to fix.
- Measured as the share of image rows with a thin line along the seam:

  | Seam | r2 | r3 | r4 |
  |---|---|---|---|
  | Bathroom | 75 % | 0 % | 75 % |
  | Grow room | 76 % | 0 % | 76 % |
  | Hallway | 29 % | 0 % | 45 % |

- The unit test named for the bathroom seam stayed green, because it does not look at edges on a face border.

**Passed:**
- lamp re-mix: 0 difference from a fresh bake in every case, and 15 of 16 meshes reused;
- 2D light;
- «Egendefinert» from «Høy»;
- budget: worst 34 draw calls per eye, textures 11.67 MB;
- no new per-frame allocations.

### Judge (round 4, scored at 40d2985): **8.0 – not accepted**

| # | Item | Score | Verdict |
|---|---|---|---|
| 1 | Baked daylight and ambient occlusion | 8 | ✅ Slits closed; a faint hairline at the new butt joints |
| 2 | Sun patches, rays, lamp light | 8 | ✅ Moving a lamp: 35–39 ms, or 97–110 ms at 4× (round 3: 64 / 148–178) |
| 3 | Sky, ground, glass, floors | 8 | ✅ |
| 4 | «Lys» (neutral 2D) | 7 | 🟡 Right, but the new 2D test took 31–48 s against a 45 s timeout |
| 5 | VR entry, wrist panel, controllers | 8 | ✅ |
| 6 | Profile, «Egendefinert», budget, tests, docs | 7 | 🟡 «Lampelys (kveld og natt)» is cut off in VR; PLAN.md had the old labels |

**Its other measurements:**
- the 2D floor colour is pixel-identical across all four «Lys» choices;
- switching between 2D and 3D in «Kveld» takes 4 ms;
- worst draw calls per eye: 32;
- «Kveld» is 44 % and «Natt» 14 % of «Dag».

**Its advice:** make the two fixes and have the gatekeeper confirm them; this was the last round.

### After round 4 – the fixes the gatekeeper and judge asked for

1. **Seams at the butt joints:**
   - **Cause:** two hidden faces had an edge exactly on the visible seam: the cut wall's end face, and the part of the owner's inner face that runs behind the cut wall. That edge flickered through as dashes, the same way the round-2 seam did.
   - **Fix:**
     - A cut end face is no longer drawn.
     - Below the cut wall's top, the owner's inner face now starts where the cut wall begins. Above it, the face goes all the way out, because there it faces open air.
     - The joint is enclosed by solid walls, so nothing can be seen into.
   - **T-junctions:** where two walls meet in the same plane, the vertical edges of both now share the same points. The points are linked across each wall's thickness, and kept 1 µm inside the face so the triangulation keeps them.
   - **Measured with the gatekeeper's method on the same views:**

     | Seam | r3 | r4 | Now |
     |---|---|---|---|
     | Bathroom | 0 % | 74 % | 0 % |
     | Grow room | 0 % | 75 % | 0 % |
     | Hallway | 1 % | 31 % | 1 % |

   - **New unit test:** no T-junctions where two walls meet in the same plane.
     - The placeholder had 9 such junctions since round 1; it now has 0.
     - The real file now lists only 4 known pairs, and none of them is a joint. Each is a pair of walls whose faces lie on top of each other (old facades, and the stue/planterom partition).
     - The corner-ray test still finds no holes.
2. **The 2D test:** one screenshot per «Lys» and a 90 s timeout. It now takes 25 s.
3. **VR labels:**
   - «Lampelys kveld/natt».
   - The four buttons in the «Lag» tab (Eksisterende / Planlagt / Røntgen / kurs) now use two rows.
   - A browser test checks that no text is shortened on any page of the VR menu, including the longest circuit names and «Egendefinert». It fails with the old labels.
4. **Docs and code comments:** PLAN.md has the new labels and the 2D rule, and the comments are back above their functions.

### Confirmation at eed8604: gatekeeper **PASS**, judge **8.0 – accepted**

Both checks were kept short, at the user's request.

**Gatekeeper:**
- **Corner rays:** 0 bad rays in the real file (607,346) and in the placeholder (626,209).
- **Seams** (same views as round 4):

  | Seam | Round 4 | eed8604 |
  |---|---|---|
  | Bathroom | 75–84 % | 0 % |
  | Grow room | 76 % | 0 % |
  | Hallway | 45 % | 0 % |

- At all five butt joints, both walls now have the same edge heights.
- **Remark:** an opening placed right at a cut corner can give overlapping or walled-over faces. The real file has no such opening (later work in PLAN.md).

**Judge:** every item is ✅ and each dimension is 8, so the total is 8.0.
- The bathroom seam is cleaner than in round 3.
- No VR text is cut off on any page.
- The 2D test passed 3 out of 3 runs.

**PR #10 merged** (82717fa).

## Phase 2e – start menu, design and tutorial – 2026-10-21

### How it was tested

- **Unit tests (315):**
  - design: contrast, CSS variables, circuit colours apart from water, the water-like warning, dashed runs and outlined points;
  - the legend and «Neste steg» (`guide.test.ts`);
  - the tutorial steps, progress and saving;
  - the VR «Hjelp» and «Farger» pages, the menu hints, and six tabs that fit (`tutorial.test.ts`).
- **Browser tests (`tests/e2e/start.spec.ts`, 8):**
  - the start menu first, then «Se leiligheten», the welcome only once, and Esc;
  - settings that apply at once and are saved;
  - turning the menu off, `?start`, and reset;
  - «Last inn» and «Ny modell»;
  - «Neste steg» in the panel;
  - the colour legend, with «Vis alle»;
  - the PC tutorial step by step;
  - «Hopp over» and «Avslutt»;
  - the VR «Hjelp» tab and the whole VR tutorial in the emulated Quest 3.
- The other browser tests open the app with `?direkte`. The fixture option `startMenu` turns the menu on.

### Test on the Quest (phase 2e)

1. Open the page: the start menu should be the first thing you see, readable at arm's length.
2. «Opplæring og farger» → «Kom i gang i VR»: follow the steps on the left wrist.
3. In VR: X → «Hjelp» → «Hva fargene betyr».

### Gatekeeper (phase 2e, short check at fcef2a7): **PASS**

- **Budget:** 28 draw calls per eye on «Standard», the same as main, and 30 with the VR menu open during the tutorial.
- **Code:**
  - planned el and water add no draw calls;
  - nothing new runs per frame;
  - the tutorial timers are cleaned up;
  - the VR tutorial can always be skipped or stopped;
  - the `?direkte` fixture in the tests is legitimate.
- **Remarks**, all fixed now:
  - Esc did nothing after a click on the background;
  - focus did not return when the menu closed;
  - a tutorial event during the ✓ pause was lost;
  - there was no e2e test for «Gå inn i VR» from the start menu;
  - the real file's kurs-2 looked like hot water.

### Judge (phase 2e, minimal check at fcef2a7): **7.85 – not accepted**

| # | Item | Score | Verdict |
|---|---|---|---|
| 1 | Start menu | 7 | 🟡 At 1000 × 625 «Innstillinger» and «Opplæring og farger» fall below the edge |
| 2 | Design consistency | 8 | ✅ |
| 3 | Colours explained | 7 | 🟡 Kurs 1 is orange like «umålt»; Kurs 2 is red like hot water and «ikke her»; «Kurs: Kurs 1» repeats itself |
| 4 | «Neste steg» and tutorial | 8 | ✅ |
| 5 | Tests and docs | 8 | ✅ |

### Phase 2e, round 2 – what changed

1. **Start menu at Quest size:**
   - The main choices come first: «Se leiligheten» / «Gå inn i VR», then the four cards. «Neste steg» follows below them.
   - The welcome is one line: «Ny her? Kom i gang (2 min)» starts the tutorial straight away.
   - On low screens (up to 720 px) the menu is tighter.
   - **Browser test:** the five main choices lie inside a 1000 × 625 screen, both with and without VR.
2. **One meaning per colour:**
   - New circuits are violet, purple and pink. They are ΔE > 20 from every colour that means something else and from each other (tested).
   - Both files use violet (kurs-1) and pink (kurs-2) now. In the real file, kurs-2 used to be almost the same red as hot water.
   - Planned el without a circuit has the same dark grey as existing el, dashed or outlined.
   - A warning names any circuit colour that looks like a status colour.
   - The legend shows the circuit name once.
3. **The gatekeeper's remarks:**
   - Esc works wherever the focus is;
   - focus goes back to «⌂ Start»;
   - an event during the ✓ pause counts for the next step;
   - there is a test of «Gå inn i VR» from the start menu.

### Phase 2e, round 2: gatekeeper **PASS**, judge **8.0, one item left**

- **Gatekeeper:** PASS at af834bb. It found no regressions, and the real file now validates with no warnings.
- **Judge:** start menu, design, «Neste steg» and tests are all ✅ at 8.
- **The item left:** in the VR legend, the dark grey planned-el swatches were nearly invisible on the dark background.

### Phase 2e, round 3 – what changed

- **Dark swatches:** a swatch with less than 3:1 contrast to the background is drawn on a light chip, on the page and in VR (`swatchBackdrop`). A unit test checks at least 3:1 for every legend swatch.
- **Circuit colours:** the 4th new circuit colour is a lighter purple (#a259ff), so it also meets 3:1.
- **«Farger»:** the legend opens at the top, also with «Vis alle fargene».
- **Gatekeeper's remark:** on the Quest, «Kom i gang» starts the tutorial in VR.

