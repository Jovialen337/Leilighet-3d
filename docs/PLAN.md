# Leilighet 3D – project plan

Status: **Phase 1 live** at https://jovialen337.github.io/Leilighet-3d/ and checked on the Quest 3 (90 fps, 11.9 ms; movement and reach OK). **Phase 2 (guided measuring) built**; it ships when its pull request is merged, then needs a test on the Quest. This file is updated in every phase.

## Goal

An accurate 3D model of my apartment that I can:

- walk through and (later) edit on **Meta Quest 3** (Quest Browser, WebXR, controllers only in v1);
- view in orbit or top-down on my **Windows laptop** in a normal browser.

All UI text is Norwegian (bokmål). All geometry comes from one data file, `public/apartment.json`. No geometry is hard-coded.

## Phases

| Phase | Content | Status |
|---|---|---|
| 1 | Data model + validation, rendering, VR walking (teleport, snap turn, room-scale), laptop orbit/top-down, layer toggles, FPS, GitHub Pages deploy | **live** – see [QA.md](QA.md) |
| 2 | **Guided measuring** in passthrough on the Quest: align the model to the real apartment, then touch or point at corners, floors, ceilings, openings and fixtures, step by step. The model updates as you go. | **built**, awaiting Quest test |
| 2b | **Graphics, options and planning** (improvement rounds scored per [SCORING.md](SCORING.md)): new lighting and quality presets; saved settings; VR menu (X); go to room; dollhouse; **electrical and water planning** with drawing on PC and in VR; layer groups, presets and filters with x-ray | **built**, being scored |
| 3 | **Editing** in VR: grab, move, turn, add and delete furniture and fixtures; edit walls, doors and windows with snapping and live dimensions; wrist menu; undo | planned |
| 4+ | *(proposal)* Planning: electrical and wiring routes, ventilation, workshop zone, GLB furniture import, notes in VR | – |

The order was chosen so the model becomes the real apartment first, and all later planning happens on real numbers.

## Phase 2 – guided measuring (design)

The user walks around the real apartment wearing the Quest 3 and sees it through the passthrough cameras. Outlines of the model are drawn on top. A panel on the left controller says, in Norwegian, exactly what to measure next. The spot to measure is highlighted in the model with a vertical beam.

1. **Align once.** Hold the measuring tip down in the inside corner at the entrance door, against the floor, and pull the trigger. This point is the origin, and its height is the hallway floor. Then touch the entrance wall at least 1 m further toward the kitchen; that sets the direction of the x axis. After this, every touch is converted to model coordinates in mm.
2. **Work through the to-do list** that the app builds from the model, room by room:
   - **Floor:** one touch per room gives `floorLevel`, so the step height is measured.
   - **Corners:** touch each corner of the floor polygon, at any height. Unmeasured corners in a room follow the measured ones (best-fit rotation and translation).
   - **Ceiling:** three points per room, pointed at (hit-test against the Quest's room scan) or touched. A third point that is nearly in line with the first two is rejected, with an explanation.
   - **Openings:** both jambs give `offset` and `width`; the top gives `height`; windows also get the sill (`sillHeight`).
   - **Fixtures:** touch the centre of each outlet, switch, radiator and so on; that gives `along` and `height` on its wall.
3. **Walls follow automatically.** Each wall is re-fitted through the measured corners on its faces. Openings and fixtures keep their place along the wall. When corners on both faces of a wall are measured, the wall thickness is measured too.
4. **Furniture, notes, zones and wiring** move with the room they stand in.
5. **Everything measured** gets `"measured": true`, so the placeholder highlight turns green as you go.

**Controls (measuring mode):** a small sphere in front of the right controller is the *measuring tip*. When the ray hits a real surface (hit-test), a ring shows the point instead.

| Button | Action |
|---|---|
| Right trigger | Measure |
| B | Undo last measurement |
| A | Skip this point |
| Right thumbstick press | Switch between touching (tip) and pointing (ray) |
| Left thumbstick left/right | Browse the list (previous/next point) without skipping |
| Left thumbstick press | Re-align (start again at the door corner) |
| Y | Show/hide frame rate |

Every capture gives a short vibration. Moving around is by walking only: teleport and snap turn are off, so the alignment stays exact.

**Checks as you go:** the result is validated after every measurement. If a measurement gives an invalid model (for example, a room that crosses itself), the panel says so and suggests B (undo). Control dimensions such as the grow room's measured 3200 × 2300 mm are compared with the traced room and warned about.

**Saving (option A, chosen first):**
- Measurements are saved continuously on the Quest (browser storage) and can be resumed in a later session (re-align first).
- The page shows a banner whenever unpublished measurements exist, with buttons:
  - «Last ned apartment.json» (download)
  - «Kopier»
  - «Last opp til GitHub», which opens the repository's upload page in `public/`
  - «Forkast»
- Committing the file publishes it through the normal pipeline.
- *Option B (later):* save straight to GitHub from the headset with a repository-scoped access key.

**Accuracy:** controller tracking is roughly 0.5–1 cm. Dimensions that must be exact (for furniture that has to fit) can later be typed in from a laser or tape measure.

### As built

- `src/measure/`:
  - `tasks.ts`: the guided list. Room by room, it lists the floor, the corners, 3 ceiling points, openings (both jambs, the top, and the sill for windows) and existing fixtures. It leaves out anything already `measured: true` in the file and anything only *planned*. The hallway floor is the origin and is never measured. The placeholder gives 84 points.
  - `MeasureSession.ts`: an event log of measure, skip and "take the skipped ones". Undo removes the last event, and the state is derived from the log, so undo still works after a reload.
    - After each event the draft is re-solved from the original file and validated. If a measurement makes the model invalid, the last valid draft stays visible and the error is shown.
    - Ceiling points closer than 0.4 m to each other, or nearly in line, are rejected. A warning appears if a point is more than 1.5 m (or 0.4 m vertically) from where the model expected it.
    - The session is saved in `localStorage` together with a fingerprint of the file.
      - If the file has changed since, the old measurements are put aside and can still be used.
      - If the new file *is* the exported one, the local data is cleared, because the measurements are published.
  - `applyMeasurements.ts` + `fit.ts`: the solver (see above). `align.ts`: two touches → rig pose.
- `src/xr/MeasureMode.ts`: the AR session. Alignment moves the *rig*, so the world equals the model in metres.
  - Measuring tip: a yellow ball 6 cm in front of the right controller.
  - Pointing uses WebXR hit-test. If the browser has no room scan, it says so and suggests touching instead.
  - Haptics on every capture.
- `src/xr/MeasureOverlay.ts`: the passthrough overlay.
  - Room wireframes: white floor edges, blue ceiling edges, corner posts that are orange until measured and green after.
  - Yellow door and window outlines, pink fixtures, and green dots for measured points.
  - A pulsing cyan beacon with a floating label that grows with distance.
  - Everything is in 2 meshes, about 2 700 triangles.
- `src/xr/InfoPanel.ts`: the instruction panel follows the left hand and always turns to face you.
- `src/ui/MeasureBox.ts`: the «Oppmåling» section in the page panel.
  - «Mål opp leiligheten» / «Fortsett oppmålingen», with local progress.
  - «Last ned apartment.json», «Last opp til GitHub» (opens the upload page for `public/`), «Kopier».
  - «Forkast målingene» and «Forkast tegningene» are separate buttons, each with its own confirmation. Each one keeps the other kind of change.
  - Notices for stale or published measurements. «Forkast» on old measurements (made against an earlier file) deletes only those; today's measurements and all drawings are kept.
- **Tests no longer depend on the published file.** Unit and browser tests use a frozen copy of the placeholder (`tests/fixtures/placeholder.json`). The published `public/apartment.json` is only checked to be valid and to load without errors, so uploading real measurements cannot break the deploy.

### Known limitation: the layout must roughly match

Guided measuring *moves and resizes* what is in the model: rooms, corners, walls, openings and fixtures. It cannot yet add or remove rooms, corners, doors or windows. The first Quest test showed the placeholder layout is quite different from the real apartment.

The fastest fix is to correct the layout *before* measuring, using a floor plan or a sketch with the rooms, corners, doors and windows; rough dimensions are enough. Measuring then makes it exact. Adding and removing corners, rooms and openings in VR belongs to phase 3.

## Phase 2b – graphics, options, electrical and water planning

### Graphics (all presets keep the Quest 3 budget)

- **Lighting:** hemisphere + key light from east-south-east + fill light, with Neutral tone mapping (keeps the JSON colours). Walls facing different directions now differ by about 20 % in brightness; the ceiling is no longer dark.
- **Trim:** skirting boards along every room edge (broken at doors and passages), and door/window casings.
- **Soft shading without shadow maps:** gradients along floor and ceiling edges and in inner corners, plus contact shadows under furniture. One extra draw call per layer; hidden with ceilings/layers.
- **Sky dome and ground**, drawn last so only visible pixels cost anything; hidden in 2D, in passthrough and on «Rask».
- **Cut faces:** in the 2D plan and the dollhouse, the inside of cut walls is dark, like an architectural drawing.
- **«Grafikk» setting:**
  - «Rask»: model only.
  - «Standard» (default): + soft shading and sky.
  - «Høy»: + higher resolution (on the laptop now; in VR the next time you enter it).
- **Dropped-frame counter** in the FPS read-out («… · N tapt»).

### Electrical and water planning

- **Data:**
  - `pipes`: cold, hot, drain or other water pipes, with a diameter.
  - `circuits`: «kurs», with a fuse size and colour. Cables and points can belong to a circuit.
  - New point types: lampepunkt, koblingsboks, sikringsskap, kran, sluk, stoppekran, varmtvannsbereder.
  - New layers «Vann – eksisterende» and «Vann – planlagt».
  - Older files without these are still valid.
- **Local plan changes** (`src/plan/PlanEdits.ts`): additions and deletions on top of the file.
  - Undo works, and changes are saved per device.
  - They are exported in the same `apartment.json` as measurements.
  - They clear themselves once the published file contains them.
  - A new drawing is checked before it is saved. If it would make the model invalid, it is refused with the reason («Kan ikke legges inn: …»).
  - A drawing that stops fitting is hidden, not deleted (for example after a measurement shortens the wall an outlet hangs on, or after a new file renames a wall). The panel says how many are hidden.
  - Hidden drawings come back by themselves when they fit again (for example when the measurement is undone), and the panel says so. «Forkast dem» deletes them, after a confirmation. «Angre» skips hidden drawings, so it never deletes something you cannot see.
  - Download and copy include only the drawings that fit.
- **Drawing on the PC** (panel «Tegn el og vann»):
  - Tools «Velg» (S), «Kabel» (E), «Rør» (V) and «Punkt» (P).
  - Click to place points, in 2D on the plan or in 3D on walls and floors. A drag still pans or rotates the view.
  - Snapping, in order: existing points and room corners, wall faces, right angles, then a 50 mm grid. Hold Ctrl to place freely.
  - Changing height between points inserts a vertical riser, so runs stay horizontal or vertical.
  - Keys: Enter, double-click or right-click finishes; Backspace removes the last point; Esc cancels; Delete deletes; Ctrl+Z undoes.
  - Large panel buttons do the same, so it works with the laser pointer in Quest Browser.
- **Drawing in VR:**
  - X → «Tegn», then choose a cable, a pipe kind or a point type.
  - Aim with the right controller at a wall, floor or ceiling. Trigger places a point, A finishes (or deletes in «Velg og slett»), B undoes.
  - The height is taken from where the ray hits, held level within 6 cm of the previous point.
  - «Kurs for nye» in the «Tegn» tab picks the circuit for new cables and electrical points: each press selects the next circuit, then none. The wrist panel shows «Kurs: …».
- **Summary:**
  - Cable length per circuit, with counts of outlets, switches and lights.
  - Cable length per kind (strøm, lys, data) and pipe length per kind.
  - A materials list for planned work (plus 10 % margin), with «Kopier».
  - Guidance hints: sloping concealed cables, outlets per m², and drain fall. Drain fall is checked at 1:60 toward the lower end, whichever way the pipe was drawn. All hints are marked as guidance, not design.

### Layers and filters

- Layers are grouped as Bygg, Elektrisk, Vann og avløp, Ventilasjon, Interiør, and Ute og annet. Each group has a tri-state master switch, and each layer has «Bare» (show only this layer plus the building).
- Presets: «Alt», «Elplan», «Rørplan», «Bare bygg». «Vis alle» / «Skjul alle».
- Filters: existing / planned, a single circuit, and **røntgen** (see-through walls and ceilings, so cables and pipes in walls show). In VR, the circuit button in «Lag» shows the next circuit on each press, then all circuits again.
- In the 2D plan, cables, pipes and electrical/water points are never cut and are drawn on top, so the whole plan always shows.
- The same presets, filters and groups are in the VR menu («Lag»). Everything is saved per device.

## Phase 3 – editing in VR (design principles)

Intuitive first:

- **Works like hands:** squeeze grip to grab, let go to drop.
- **Point and trigger** selects everything: menus, objects and walls.
- **See the result before it happens:**
  - Highlight on hover
  - See-through preview of where something lands
  - Live dimensions in mm
  - Haptic tick when something snaps
- **Contextual Norwegian button labels** on the controllers, which fade once learned.
- **One undo button**, always available.
- **Smart constraints:**
  - Furniture stays on the floor and fixtures on walls.
  - Openings slide along their wall.
  - Snapping to straight lines and right angles.
- **A three-step first-time guide:** grab, move, undo.

Edits go through `ApartmentStore.update()`, so they are validated before they are applied.

## Stack

- Vite 8.3.1 + TypeScript 5.9.3 + three.js **0.186.1** (exact versions pinned in `package.json`).
- WebXR through three's built-in `WebXRManager` (`local-floor` reference space).
- Tests: Vitest 5.0.2 (Node) and Playwright 1.56.1 (Chromium) with **IWER 2.5.0** (Meta's Immersive Web Emulation Runtime, the engine behind the Immersive Web Emulator) as an emulated Quest 3.
- Hosting: GitHub Pages through GitHub Actions. HTTPS is required for WebXR. The Vite `base` is set from the repo name in CI (`VITE_BASE=/<repo>/`).

## Data model

One file, `public/apartment.json`. The types are in `src/schema/types.ts` and the runtime validation (Norwegian messages) is in `src/schema/validate.ts`.
The same validator runs in the app on load and from the command line (`npm run validate`).

### Conventions

- **Millimetres** everywhere. Plan points are `[x, z]`. Viewed from above, x points right (along the entrance wall toward the kitchen) and z points down (into the apartment).
- **Origin** is the inside corner at the entrance door, on the hallway floor. y points up.
- **Heights are measured from the floor where the point stands** (the room's floor), which is how you measure with a tape. The exceptions are `rooms[].floorLevel` and `outdoor[].level`, which are absolute (from the origin).
- **Rotation** is in degrees, clockwise seen from above.
- **Measured flag.** Any number can be written plain (`900`) or as `{ "value": 900, "measured": true }`. A plain number inherits the nearest object's `"measured"` (default `false`, meaning placeholder). The app has a toggle, *Marker umålte mål*, that colours placeholder objects orange, partially measured objects yellow and fully measured objects green.
- **IDs** are unique across the whole file.

### Object types

| Collection | Type | Key fields |
|---|---|---|
| `layers` | Layer | `id`, `name` (Norwegian), `visible`. Standard: structure, openings, furniture, electrical-existing, electrical-planned, ventilation, wiring, workshop-zone, outdoor, scan-reference, notes |
| `rooms` | Room | `polygon` (floor, inner faces), `floorLevel` (absolute), `ceiling.points` (≥ 3 measured `{x, z, height}` → least-squares sloped plane), optional `dimensions` (control dimensions, checked against the polygon) |
| `walls` | Wall | `start`, `end`, `thickness`, `justify` (`center`/`left`/`right`: which side of the line the thickness goes), `color`, `material`; optional `height`/`base` (e.g. soffits). The wall top follows the ceilings on both sides |
| `openings` | Door | `wall`, `offset` (from wall start to the near edge), `width`, `height`, `into` (room you enter), `hinge` (`left`/`right` as seen when entering), `swing` (`in`/`out`), optional `swingDirection` (clockwise/counterclockwise from above; validated against hinge + swing), `openAngle`, `entrance` |
| | Window | `wall`, `offset`, `width`, `height`, `sillHeight`, `room` (the floor heights are measured from) |
| | Passage | An opening without a door: `wall`, `offset`, `width`, `height`, `room` |
| `fixtures` | Fixture | `type` (outlet, switch, radiator, pipe, vent, hatch), `layer`, `status` (existing/planned), placement `mount: {wall, room or face, along, height}` **or** `position: [x, h, z]`, `size`, `label` |
| `furniture` | Furniture | `name`, `template`, `position`, `rotation`, `layer`, `source` (`{kind:"own"}` or `{kind:"glb", url}`), `parts[]` (`box`/`cylinder`/`roundedBox` with `size`, `offset`, `color`) |
| `outdoor` | OutdoorArea | `kind` (pathway/garden/terrace/other), `polygon`, `level` |
| `zones` | Zone | `layer` (e.g. workshop-zone), `polygon`, `height`, `color` |
| `wiring` | WireRun | `layer`, `status`, `kind`, `points[]` |
| `scans` | ScanReference | `url`, `format` (glb/ply/obj/image), `position`, `rotation`, `scale` (validated; rendered in a later phase) |
| `notes` | Note | `text`, `layer`, `position` |

### Validation

- **Structure:** types, required fields, allowed values, colours `#rrggbb`, and the `{value, measured}` form.
- **References:** unique IDs, and every wall, room and layer that is referenced must exist.
- **Geometry:**
  - Polygons need at least 3 points, no self-intersection and a non-zero area.
  - Ceilings need at least 3 non-collinear points; a warning is shown if more than 3 points fit the plane badly.
  - Openings must fit inside their wall and must not overlap.
  - Door `into` must be on one side of the wall, and `swingDirection` must be consistent with hinge + swing.
  - Mounted fixtures must fit inside their wall's length.
  - Room control dimensions must match the polygon (warning).

Errors stop loading and are listed in Norwegian with the path in the file. Warnings are shown in the panel.

### Placeholder apartment (phase 1)

About 50 m² gross (45.8 m² net floor), rooms: gang, stue, kjøkken, bad (two offset sections), planterom.
Everything is `measured:false` except the grow room's size (3200 × 2300 × 2100 mm, `measured:true`), so the grow room is "partially measured".

- **Hallway:** 2300 × 2400, floor 0. All other rooms are one 180 mm step up.
- **Ceiling:** one plane across hallway/living room/kitchen, `y = 2200 + 0.05·x + 0.02·z` (absolute). It is lowest at the hallway corner by the entrance door (the corner furthest from the kitchen) and rises to about 2.74 m in the far kitchen corner.
- **Entrance door:** hinge on the left when entering, opens **out**. **Bathroom door:** hinge right, opens in. **Grow room door:** hinge left, opens in, 900 wide.
- **Windows:** two windows in the entrance wall (faces east, morning sun), between the door and the kitchen. Sill 900 mm, height 1000 mm.
- **Passages:** doorless openings hallway→living room (at the step) and living room→kitchen.
- **Concrete wall:** runs from the kitchen through the living room and ends at the bathroom door. The hatch *«Feiluke/rør – ikke rør»* is on its kitchen side.
- **Bathroom:** two short offset sections; the far one has a higher ceiling (2400 vs 2150), with a soffit wall filling the step.
- **Outdoors:** a pathway to the entrance and a garden in front of the windows.

Assumption to confirm: "the far one higher" (bathroom) is read as a *higher ceiling*. If it means a raised floor, change `floorLevel` of `bad-indre`.

## Architecture

```
src/
  schema/     types.ts (all object types), validate.ts (Norwegian), normalize.ts ({value,measured} → numbers + measure state),
              format.ts (writes apartment.json in the hand-written compact style)
  geometry/   math2d.ts, plane.ts (ceiling plane fit) – pure maths, no three.js
  model/      ApartmentModel.ts (queries in mm: floor at a point, wall frames, wall top following ceilings,
              door geometry, thresholds, placements, spawn), ApartmentStore.ts (load / update / toJSON)
  scene/      buildWall.ts (face polygon with holes/notches, extruded), buildParts.ts (everything else),
              ApartmentScene.ts (merge per layer+material, pick proxies, id→range map), materials.ts
  state/      ViewState/LayerState (observable; shared by laptop UI and the future VR wrist menu)
  views/      DesktopView.ts (orbit + orthographic top-down with section cut, grid, scale)
  measure/    tasks.ts (guided list), MeasureSession.ts (log, undo, local save, export), applyMeasurements.ts +
              fit.ts (solver), align.ts (two touches → rig pose), types.ts (observations)
  xr/         XRManager.ts (session, controllers, teleport, snap turn, floor follow, measure mode), teleport.ts (arc),
              rig.ts (pure rig maths), WristPanel.ts (seed of the phase 3 wrist menu), emulator.ts (IWER),
              MeasureMode.ts, MeasureOverlay.ts, InfoPanel.ts (passthrough measuring)
  ui/         DesktopUI.ts (Norwegian panel), MeasureBox.ts, Labels.ts, FpsMeter.ts, github.ts, style.css
  app/App.ts  wiring
```

- **Single source of truth:** `ApartmentStore` holds the raw document (including `{value, measured}`). It validates, then builds an `ApartmentModel`. The scene is rebuilt from the model.
- **Performance:** static geometry is merged into one mesh per (layer, material): 13 meshes and about 4 000 triangles for the whole apartment. The renderer uses Lambert materials with flat vertex colours, has no shadows, and uses hemisphere + ambient + two directional lights. That is 14 draw calls per eye in VR.
- **Teleport:** a parabolic arc is raycast against per-object invisible proxies. Each segment is pre-filtered by bounding box. A landing is valid only on a floor (rooms, thresholds, outdoor areas), so both floor levels work. Walls, ceilings and furniture block the arc.
- **Room-scale walking:** each frame the floor level under the head is looked up in the model and the rig height follows it smoothly. Walking physically up the step lifts you 180 mm.

### Prepared for phase 3 (VR editing) without rewrites

- `ApartmentStore.update(mutate)` edits the raw doc, re-validates, rejects invalid edits and notifies listeners. `toJSON()` saves in the same format.
- Every object has a pick proxy with `{id, kind, layer}`, and `ApartmentScene.ranges` maps id → vertex ranges in the merged meshes (for highlighting or partial rebuilds).
- Layer visibility, FPS, ceilings and measure highlighting live in `ViewState` (observables), not in the DOM. The wrist menu will bind to the same state. `WristPanel` is already attached to the left controller.
- Geometry builders are pure functions of the model.

## Controls

- **Laptop, 3D:** drag to rotate, scroll to zoom, right-drag to pan.
- **Laptop, Ovenfra (2D):** drag to pan, scroll to zoom. The plan is cut at `settings.planCutHeight` like an architectural drawing, with a 1 m grid, scale bar and cursor coordinates in mm. F toggles FPS.
- **Quest:** left stick forward = aim the teleport arc, release = jump. Right stick left/right = snap turn 30°. Y = show/hide FPS. You start standing just inside the entrance door, facing in.
- **Quest, measuring:** see the controls table in phase 2.
- **Quest, menu (X):** point with the right controller and pull the trigger. Tabs: Visning, Lag, Tegn, Gå til, Komfort. Right stick back turns 180°.
- **Laptop, keys:** 1/2 (3D/2D), T (ceilings), U (placeholders), K (dollhouse), R (reset view), F (FPS), H (help), S/E/V/P (draw tools), Enter/Backspace/Esc/Delete/Ctrl+Z while drawing.

## Known limitations

- Imported GLB furniture is only a grey placeholder box. Scan references are validated but not drawn.
- Notes are small markers in VR; their text shows only in the laptop 2D plan.
- Guided measuring cannot add or remove rooms, corners or openings (see phase 2).
- Pointing (hit-test) needs the Quest's room setup (Space Setup); without it, use touch.
- Measurements are stored only in the browser they were taken in (the Quest), until they are downloaded and uploaded to GitHub.
