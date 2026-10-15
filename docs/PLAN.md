# Leilighet 3D – project plan

Status: **Phase 1 live** at https://jovialen337.github.io/Leilighet-3d/ and checked on the Quest 3 (90 fps, 11.9 ms; movement and reach OK). Phases 2 and 2b are live and need a test on the Quest. **Phase 2c («Lag ny modell») is built** and ships when its pull request is merged. This file is updated in every phase.

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
| 2c | **«Lag ny modell»** – make a new model from scratch or from the current one: draw rooms on the PC or in the Quest Browser (walls are made automatically), or measure the rooms by touching the walls in passthrough on the Quest 3. Doors, windows and openings, checks with one-click fixes, undo, autosave, walk through it in VR, and export as `apartment.json`. | **built**, being scored |
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

Guided measuring *moves and resizes* what is in the model: rooms, corners, walls, openings and fixtures. It cannot yet add or remove rooms, corners, doors or windows. The first Quest test showed the placeholder layout was quite different from the real apartment.

**Done 2026-10-12:** the layout was corrected from the user's sketch (see "The apartment" below). Measuring now makes it exact.

**Done 2026-10-14:** «Lag ny modell» (phase 2c) can add and remove rooms, corners, doors and windows, on the PC and in passthrough. Start it from the current model to keep fixtures, furniture, cables and pipes.

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

## Phase 2c – «Lag ny modell» (build a new model)

The guided measuring in phase 2 can only move what is already in the file. «Lag ny modell» makes a model from nothing, or rebuilds the current one, and ends with a normal `apartment.json`.

### The idea: rooms first, walls by themselves

- You draw **rooms** as floor polygons, using inside measurements (the numbers you get with a tape).
- **Walls are made automatically** from how the rooms lie against each other:
  - A gap of 20–400 mm between two room edges becomes an **interior wall** filling the gap. It is face-justified, so both rooms keep their exact inside measurements.
  - Edges that touch (gap under 20 mm) are an **open boundary** with no wall, for example between a living room and an open kitchen. If the ceilings differ, a soffit (wall from the lower ceiling up) is made.
  - Everything else is an **exterior wall**, 200 mm by default and adjustable per edge.
  - Collinear exterior walls are merged, and corners are closed.
- **Doors, windows and openings** sit on a room edge with a distance from the corner. They follow the edge when corners move.
  - The first door in an exterior wall becomes the **entrance door**.
  - A door's «går inn i» defaults to the room on the other side of the wall.
- **Export moves the origin** to the inside corner at the entrance door, with x along the entrance wall and the hallway floor = 0. This is what guided measuring expects.
  - `settings.planRotation` is chosen so the 2D plan still looks the way it was drawn.
  - The transform is a proper rotation, never a mirror.

### Three ways to start

1. **Ny tom modell.** Draw from scratch.
2. **Start fra nåværende modell.** Imports the file shown now, including measurements in progress and drawn cables and pipes.
   - Fixtures, furniture, outdoor areas, zones, cables, pipes, circuits, scans and notes come along.
   - Wall fixtures are re-attached to the nearest new wall.
   - New walls in the same place keep the old **wall ids, names, colours and materials**, so references still work.
   - The plan is turned by `planRotation`, so it looks like the plan you know.
3. **Mål opp i gjennomsyn (Quest 3).** Measure the rooms by touching the walls (see below).

You can also **open a drawing from a file** (`*.tegning.json`) to move work between the laptop and the Quest.

**Background image («Bakgrunnsbilde»).** Put a sketch or a floor plan (for example from the estate agent's prospectus) under the plan and trace the rooms on top of it.

- Set the scale with two clicks on points whose real distance you know, then type that distance («3,4 m»).
- «Flytt bildet» lets you drag it into place, and you can change its opacity, hide it or remove it.
- The image is shrunk to at most 2048 px and saved only in the browser, never in `apartment.json`.

### Drawing (PC and Quest Browser)

- Tools: **Velg og flytt** (S), **Rektangel** (R), **Mangekant** (M), **Rom inntil** (I, a new room on the other side of an edge, with a partition), **Dør** (D), **Vindu** (V), **Åpning** (O).
- **Snapping**, in this order:
  1. corners of other rooms;
  2. the wall gap next to another room, or its edge;
  3. alignment with any corner (dashed guides);
  4. 45°/90° from the previous point;
  5. the 10 mm grid.
  - Hold **Ctrl**, or press «Fri» on the Quest, for no snapping.
- **Typed dimensions** in Norwegian, all in mm:
  - «4,2» = 4,2 m; «420 cm» = 420 cm; «4200» = 4200 mm; a bare 1–9 = metres.
  - A sign («+150») adds to the current value.
  - While drawing, start typing and the number goes straight into the length field. Enter places it, and Tab moves to the next field.
  - In the polygon tool, the arrow buttons → ↓ ← ↑ give the direction without a mouse.
- **Handles.** Drag corners, edges (the neighbour room follows, so the wall keeps its thickness), whole rooms, and openings (along the wall, or their ends to resize).
  - Arrow keys nudge the selection 10 mm, or 100 mm with Shift.
  - Each drag is one undo step, and the 3D model is rebuilt when the drag ends.
- **Panel for the selection**:
  - room: name, floor level, ceiling height, sloped ceiling per corner, every edge length;
  - edge: length, exterior wall thickness and material, add door, window or opening, «Fordel vinduer jevnt»;
  - corner: x and z;
  - opening: type, from the left or right corner as seen from inside the room, width, height, sill, «går inn i», hinge side, swing, entrance door.
- **Rett opp** makes nearly-square rooms exactly square and lines up nearly collinear edges.
- **Undo/redo** keeps 100 steps (Ctrl+Z, Ctrl+Y). Everything is **saved in the browser** at once, so the drawing survives a reload.
- The **live preview** is the real model:
  - 2D plan cut at the section height, 3D («Se i 3D») and **VR** («Gå gjennom i VR»);
  - if the drawing has errors, the last valid version is shown until they are fixed.
- On the **Quest Browser** everything works without a keyboard: big buttons and 16 px handles for the laser pointer, typed values through the system keyboard, and arrow buttons.

### Checks («Sjekk»)

Errors (saving is blocked) and warnings, each with «Vis» (select and zoom) and, where possible, a one-click fix:

- **Errors:**
  - rooms that overlap;
  - polygons that cross themselves or are too small;
  - openings outside their wall, across a wall break or on an open boundary;
  - openings that overlap;
  - the full schema validation of the resulting file.
- **Warnings:**
  - no entrance door (fix: «Merk en inngangsdør»), or more than one (fix: keep the first);
  - the entrance wall is shorter than 1 m, which alignment needs;
  - a room you cannot get into from the entrance;
  - a low ceiling;
  - a door taller than the ceiling;
  - very thin gaps between rooms.

### Measuring a new model in passthrough (Quest 3)

Room by room, standing in the room:

1. **Walls.**
   - Touch the first wall twice, at least 30 cm apart. This gives its direction.
   - Then touch each next wall once, going around the room. Each is assumed to be at a right angle along the room's axes, so a slanted wall does not tilt the rest.
   - For a slanted wall, hold the **grip** while touching to add a point to the same wall.
   - A ghost corner shows where the next corner will land.
2. **A** closes the room. Corners are where the walls meet, and the room must not cross itself.
3. **Floor.** Touch the floor. A skips it.
4. **Ceiling.** Touch the ceiling, or press the right stick to point at it with the ray (hit-test). A skips it.
5. The room goes straight into the drawing, with its corners marked as measured.

Openings come from the **X menu**. Pick «Dør», «Vindu» or «Åpning» and touch:

- the hinge side of the frame (doors), then the other side;
- the top;
- for windows, also the sill.

The menu also has:

- room names (no keyboard needed);
- «Mål ‹rom› på nytt»: re-measure the room you stand in; doors and windows follow;
- «Nytt rom», «Avbryt», touch/point, «Juster på nytt» and «Avslutt».

Other details:

- **B** undoes the last touch, or the last change in the drawing.
- Each touch is the **median of the tip over the last 150 ms** before the trigger, so the jerk of pulling the trigger does not count.
- While the menu is open, the trigger never measures.
- **Alignment.** If the drawing already has rooms (drawn on the PC or measured earlier), the session starts by aligning:
  - touch the corner at the entrance door, then the entrance wall beyond the door;
  - the same thing happens automatically after the headset loses tracking (reference space reset).

### Saving

- «Last ned apartment.json» + «Last opp til GitHub», the same flow as measuring.
  - The export remembers its fingerprint. When that exact file is published, the drawing is removed by itself.
  - If you changed the drawing after exporting, it is kept.
- «Lagre tegningen som fil» / «Åpne tegning …» move unfinished work between devices.
- **Nothing is lost:**
  - When a new drawing is started, opened from a file or discarded, the old one is kept as «forrige tegning». «Hent forrige tegning» brings it back, also after a reload.
  - A stored drawing that cannot be read is set aside under its own key and reported; the app starts as normal.
  - Drawing files are fully checked before they are opened.
- **Local changes that went into the new model:**
  - «Start fra nåværende modell» remembers which drawn cables, pipes and points, and which measurements, it took with it.
  - When the exported file is published, exactly those are removed from the browser, because they are now in the file, in the new frame.
  - Anything made on the old model afterwards is kept and reported, since it may now be in the wrong place.
- While a new model is shown, drawing el/vann in VR is off; its coordinates would land wrongly in the file.
- If `apartment.json` has errors, the error screen offers «Lag ny modell i stedet».

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

- **Millimetres** everywhere. Plan points are `[x, z]`. x runs along the entrance wall toward the kitchen and z points into the apartment. By default the 2D plan shows x to the right and z down.
- **`settings.planRotation`** (0, 90, 180 or 270 degrees, counter-clockwise) turns only the 2D plan and the starting 3D view; coordinates never change. With 90, x points up and z right, matching the user's sketch.
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

### The apartment (from the user's sketch, 2026-10-12)

The layout follows the user's sketch. With `planRotation: 90` the 2D plan looks like the sketch: hallway at the bottom, kitchen at the top. The scale comes from the two known sizes: the grow room is measured at 3200 × 2300 × 2100 mm, and the hallway is 2300 × 2500. Both fit the sketch at about 6 mm per sketch pixel. Everything else is `measured:false` until it is measured. Net floor area is about 31 m².

- **Rooms:**
  - **Gang:** the hallway, one step lower (floor 0); the rest is at 180.
  - **Stue:** the living room, the centre. The hallway, kitchen, bathroom and grow room can be reached **only** from here.
  - **Kjøkken:** the kitchen, reached through a large doorless opening from the living room.
  - **Bad:** the bathroom, entered from the living room.
    - The lower entrance part goes straight in, with the shower and toilet on the left.
    - The raised part (`bad-hoy`, +150 mm, step not measured) is on the right, with the washing machine and drying rack.
  - **Planterom:** the grow room, beside the living room.
- **Entrance:** the only way in from outside, on the left side of the hallway (the entrance wall). The door opens out, with the path in front.
- **Windows:**
  - The entrance wall has two evenly spaced living room windows and one kitchen window further along.
  - The hallway wall facing the garden is glass from edge to edge.
  - The grow room has one window to the garden.
  - The bathroom has one small double window in its far wall.
- **Ceilings:** one sloping plane, lowest at the entrance corner, about 150 mm lower than the first placeholder (the phase 1 Quest test found it too high). The bathroom is flat (2150 mm above its lower floor); the grow room is measured at 2100.

Assumptions to confirm or measure:
- Rooms are simple rectangles; the kitchen is narrower beside the bathroom.
- The façade (kitchen, living room and hallway) is one straight wall.
- The grow room starts level with the living room, so the hallway sticks out toward the garden.
- The bathroom door is in the corner where the bathroom meets the living room; it is 700 wide.
- The heights of the bathroom step and the hallway step are not known.
- Measuring moves corners but cannot add them, so a wrong number of corners must be fixed in the file.

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
  builder/    «Lag ny modell»: types.ts (rooms + openings drawing), walls.ts (walls from rooms), compile.ts (drawing →
              apartment.json, checks), transform.ts (origin at the entrance), importDoc.ts (apartment.json → drawing),
              ops.ts (edits that keep openings in place), snap.ts, units.ts (Norwegian lengths), capture.ts (passthrough
              maths: walls from touches, openings from frames, alignment), BuilderSession.ts (undo, autosave, export),
              BuilderEditor.ts (tools, selection, drag)
  ui/         DesktopUI.ts (Norwegian panel), MeasureBox.ts, BuilderPanel.ts + BuilderOverlay.ts (SVG handles in the 2D plan)
              + BuilderBackdrop.ts (image to trace, with scale),
              Labels.ts, FpsMeter.ts, github.ts, style.css
  xr/         … BuildMode.ts, BuildOverlay.ts, buildMenu.ts (measuring a new model in passthrough)
  app/        App.ts (wiring), BuilderController.ts («Lag ny modell»: preview, input, keys, saving)
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
- **Laptop, «Lag ny modell»:**
  - tools S/R/M/I/D/V/O; type numbers for lengths;
  - Enter/double-click/right-click to finish a polygon, Backspace (last point or delete), Esc, Delete;
  - Ctrl+Z / Ctrl+Y; arrows to nudge (Shift: 100 mm); hold Ctrl for no snapping.
- **Quest, measuring a new model:**
  - trigger = touch; grip + trigger = same wall; A = close the room / skip / next room; B = undo;
  - X = menu (names, doors, windows, re-measure, exit); right stick click = touch/point.

## Known limitations

- Imported GLB furniture is only a grey placeholder box. Scan references are validated but not drawn.
- Notes are small markers in VR; their text shows only in the laptop 2D plan.
- Guided measuring cannot add or remove rooms, corners or openings; use «Lag ny modell» for that (phase 2c).
- «Lag ny modell» draws rooms with flat floors; a room with two floor levels is two rooms side by side (an open boundary or a step between them).
- Walls between rooms are only made where the gap is 20–400 mm; thicker walls (load-bearing, chimneys) must be drawn as a gap of that size or adjusted per edge.
- In passthrough, re-measuring a room keeps its doors and windows on the nearest matching edge; check them afterwards on the PC.
- Pointing (hit-test) needs the Quest's room setup (Space Setup); without it, use touch.
- Measurements are stored only in the browser they were taken in (the Quest), until they are downloaded and uploaded to GitHub.
