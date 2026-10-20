# Leilighet 3D – project plan

Status: **Phase 1 live** at https://jovialen337.github.io/Leilighet-3d/ and checked on the Quest 3 (90 fps, 11.9 ms; movement and reach OK). Phases 2, 2b and 2c are live and need a test on the Quest. **Phase 2d (the «wow» graphics round) is built** and ships when its pull request is merged. This file is updated in every phase.

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
| 2d | **«Wow» graphics on the Quest 3:** baked daylight from the windows, sun patches through the windows, a real sky with clouds and a distant tree line, clear glass, «Lys» (morgen/dag/kveld, lamps lit in the evening), a fade in from black facing the longest view, and sharper VR on «Høy» | **built**, being scored |
| 3 | **Editing** in VR: grab, move, turn, add and delete furniture and fixtures; edit walls, doors and windows with snapping and live dimensions; wrist menu; undo | planned |
| 4+ | *(proposal)* Planning: electrical and wiring routes, ventilation, workshop zone, GLB furniture import, notes in VR | – |
| Ideas | **The user's idea list (2026-10-16)**, developed below under «Ideas backlog»: outside content, a garden category, a furniture collection and creator, wallpapers, floor types, a colouring tool, view modes (electric, water …), and a HUD and menu upgrade | backlog |

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
- **Soft shading without shadow maps:** contact shadows under furniture (one extra draw call per layer). Darker edges and corners are now baked into the colours (phase 2d).
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
  - Collinear exterior walls are merged.
  - Outside corners are closed at **every angle**:
    - right angles: one wall is extended;
    - obtuse corners (for example a 45° bay): both walls run to where the outer faces meet;
    - acute corners: the tip is cut at the other wall's outer face, so nothing sticks out (very sharp tips are cut at 4 × the wall thickness);
    - a shallow bend between a thin and a thick wall: the thick wall already covers the corner, so the thin one only fills the wedge between the wall ends, up to its own outer face. The outside gets a step, as at a straight joint, instead of a long spike.
  - **Skewed rooms are reported.** Facing edges in two rooms that are not parallel get a warning naming both rooms, with «Rett opp rommene»:
    - under 3°: one partition is still made, and the warning gives its thickness at each end;
    - 3–10°: no partition is made, and the warning says two exterior walls may overlap;
    - the gap must vary by at least 5 mm along the edge, so short edges that are only rounded 1–2 mm do not count.
- **Doors, windows and openings** sit on a room edge with a distance from the corner. They follow the edge when corners move.
  - The first door in an exterior wall becomes the **entrance door**.
  - A door's «går inn i» defaults to the room on the other side of the wall.
- **Export moves the origin** to the inside corner at the entrance door, with x along the entrance wall and the hallway floor = 0. This is what guided measuring expects.
  - `settings.planRotation` is chosen so the 2D plan still looks the way it was drawn.
  - The transform is a proper rotation, never a mirror.

### Three ways to start

1. **Ny tom modell.** Draw from scratch.
2. **Start fra nåværende modell.** Imports the file shown now, including measurements in progress and drawn cables and pipes. Exactly this is carried over:
   - **Rooms:** id, name, polygon, floor level, ceiling (flat or per-corner height), floor colour, note, layer and the control dimensions (`dimensions`, with their measured flags). The measured flags of corners, floor and ceiling also come along.
     - Control dimensions that no longer fit the room are shown on that room in the checklist. The room panel shows them, with «Fjern kontrollmålene».
   - **Walls** are made again from the rooms. A new wall in the same place as an old one keeps its **id, name, colour, material, note, layer and fixed height** (and a beam's `base`), so fixtures, cables and measurements that point at it still work.
     - The exterior wall thickness and material are kept per edge, and the most common thickness becomes the default.
   - **Openings:** id, type, name, note, layer, width, height, sill, «går inn i», hinge, swing, entrance flag, opening angle, door leaf colour (when not the default) and window frame colour.
     - `swingDirection` is not copied. It is worked out again from hinge and swing on every save, so it always matches.
   - **Everything else is copied as it is**, moved with the plan:
     - fixtures (wall fixtures are re-attached to the nearest new wall, or placed freely where they were if the wall is gone);
     - furniture, outdoor areas, zones, cables, pipes, circuits, scans and notes;
     - layers, `meta.description`, and the settings `planCutHeight`, `defaultWallHeight` and `backgroundColor`.
   - The plan is turned by `planRotation`, so it looks like the plan you know.
   - A unit test checks that no field of any room, wall or opening in the published file is lost or changed. Only recomputed geometry differs: polygons, wall ends and justification, and offsets.
3. **Mål opp i gjennomsyn (Quest 3).** Measure the rooms by touching the walls (see below).

You can also **open a drawing from a file** (`*.tegning.json`) to move work between the laptop and the Quest.

**Background image («Bakgrunnsbilde»).** Put a sketch or a floor plan (for example from the estate agent's prospectus) under the plan and trace the rooms on top of it.

- Set the scale with two clicks on points whose real distance you know, then type that distance («3,4 m»).
- «Flytt bildet» lets you drag it into place, and you can change its opacity, hide it or remove it.
- The image is shrunk to at most 1600 px and saved only in the browser (up to 1.5 MB), never in `apartment.json`.

### Drawing (PC and Quest Browser)

- Tools: **Velg og flytt** (S), **Rektangel** (R), **Mangekant** (M), **Rom inntil** (I, a new room on the other side of an edge, with a partition), **Dør** (D), **Vindu** (V), **Åpning** (O).
- **Snapping**, in this order:
  1. corners of other rooms;
  2. the wall gap next to another room, or its edge;
  3. alignment with any corner (dashed guides);
  4. 45°/90° from the previous point (at 45° the sides are rounded to the grid, so a square is 3000 × 3000);
  5. the 10 mm grid.
  - Hold **Ctrl**, or press «Fri» on the Quest, for no snapping.
- **Typed dimensions** in Norwegian, all in mm:
  - «4,2» = 4,2 m; «420 cm» = 420 cm; «4200» = 4200 mm; a bare 1–9 = metres.
  - A sign («+150», «-150») adds to or subtracts from the current value.
  - In **coordinate and floor-level fields** (corner x/z, «Gulvnivå») a minus is part of the value: «-1100» is −1100, and «-3» is −3 m like «3» is 3 m. Subtract there with «-=150». «+150» (and «+=150») always adds, since a positive value never needs a plus.
  - In «Flytt rommet» the sign is only the direction; the number reads like any other length («-500» moves 500 mm left or up, «-3» moves 3 m like «3»). An empty field is 0, and Enter moves on to the next field and then moves the room.
  - While drawing, start typing and the number goes straight into the length field. Enter places it, and Tab moves to the next field.
  - In the polygon tool, the arrow buttons → ↓ ← ↑ give the direction without a mouse.
- **Handles.** Drag corners, edges (the neighbour room follows, so the wall keeps its thickness), whole rooms, and openings (along the wall, or their ends to resize).
  - Arrow keys nudge the selection 10 mm, or 100 mm with Shift.
  - Each drag is one undo step, and the 3D model is rebuilt when the drag ends.
- **Panel for the selection**:
  - room: name, floor level, ceiling height, sloped ceiling per corner, note, control dimensions, every edge length, and:
    - «Flytt rommet» by typed x/z distances;
    - «Kopier rommet»: the copy is placed beside the original with a partition, on the first free side (right, below, left, above), with its windows and doors but not the entrance door, and without their names and notes;
    - «Roter 90°»: clockwise about the middle; openings follow; four turns give exactly the same room back;
    - «Del rommet»: a partition of the standard thickness straight through the room, vertical (at an x) or horizontal (at a z), suggested in the middle across the longer side.
      - One side keeps the room's id and name; the other becomes «‹navn› 2» with the same floor, ceiling and colour.
      - A sloped ceiling is kept: the old corners keep their heights, and the new corners at the split get theirs from the ceiling's plane (so the ceiling is no longer marked measured).
      - A partition flush with an existing wall (for example at an L's inside corner) gives clean rooms, with no zero-width spike along the old wall.
      - In a room that stands turned in the plan (rooms measured in passthrough often do), the partition follows the room's own edges, and the position is measured along the room. The panel says so.
      - The partition strip (centred on the line) is taken out across the whole room, also where only one side continues. In an L split at x = 1950 with the inside corner at x = 2000, the long leg becomes 100 mm narrower; split at x = 2050 to keep it. The panel hint says so.
      - Windows and doors follow their side. A door into the room (from the room itself or from a neighbour) goes into the part it stands against.
      - Measured corners stay measured.
      - The split is refused, with a message naming the reason, if:
        - it would cut through an opening, in the room or in the wall facing it from a neighbour;
        - it does not cross the room, or leaves under 0.25 m² or under 50 cm (measured from the partition) on a side;
        - it crosses the room more than once (a U-shape), which would make one side two rooms;
  - edge: length; for an exterior wall, its thickness and material; for a partition, its **thickness** (the neighbouring room moves); add door, window or opening; «Fordel vinduer jevnt»;
  - corner: x and z (negative values allowed);
  - opening: type, from the left or right corner as seen from inside the room, width, height, sill, «går inn i», hinge side, swing, entrance door, note.
  - The message line always names what is selected, including which edge.
- **Rett opp** makes nearly-square rooms exactly square and lines up nearly collinear edges.
  - The common axis is the largest room that is already straight, near the length-weighted average. Rooms that follow the grid count 1.5 times their size, so straight rooms stay where they are.
  - «Rett opp rommene» on a skew warning straightens only the two rooms it names, with edges up to 11° off the axis. «Rett opp rommet» straightens the selected room. Rooms that are not straightened stay where they are; the straightened room's nearly-aligned edges are moved onto theirs.
  - «Rett opp alt» (in the tools) straightens every room.
- **The overlay stays readable:**
  - a dimension is drawn only where it covers no other dimension, room name or handle;
  - the selected room and the room under the pointer come first. A label is tried near the middle of its edge, first horizontal and then running along the edge (narrow rooms). For the selected room it may also go just outside the edge;
  - other rooms show dimensions when zoomed in, and only where the label lies completely inside the room;
  - a label with no free spot is left out; every edge length is in the panel;
  - handles are chosen by priority (selected opening, then the selected room's corners, move handle and edges, then other corners). A handle closer than the two radii to a more important one is left out, and the most important is drawn on top, so the Quest laser hits the handle you see;
  - when an opening is short on screen, its end handles are set a little outside its ends so all three fit. A drag counts from where you took hold, so the end does not jump;
  - note and fixture labels are hidden while the builder is open; room names stay.
- **Undo/redo** keeps 100 steps (Ctrl+Z, Ctrl+Y), and the message says «Angret.» or «Gjort om.». Everything is **saved in the browser** at once, so the drawing survives a reload.
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
  - very thin gaps between rooms;
  - skewed rooms (fix: «Rett opp rommene»);
  - control dimensions from the old file that no longer fit the room.

### Measuring a new model in passthrough (Quest 3)

Room by room, standing in the room:

1. **Walls.**
   - Touch the first wall twice, at least 30 cm apart. This gives its direction.
   - Then touch each next wall once, going around the room. Each is assumed to be at a right angle along the room's axes, so a slanted wall does not tilt the rest.
   - For a slanted wall, hold the **grip** while touching to add a point to the same wall.
   - A ghost corner shows where the next corner will land.
2. **A** closes the room. Corners are where the walls meet, and the room must not cross itself.
   - **The drawing's axis.** The room's direction comes from only two touches on the first wall: 1 cm off over 60 cm is about 1°, which would skew the whole room and every dimension. So, when the first wall is within 3° of the drawing's common axis, the axis is used as the direction, and every wall line goes through its own touches. That keeps the dimensions right, not only the angle.
     - In the emulated test, a second touch 1 cm off gives a partition of 100 ± 5 mm and a depth of 3000 ± 5 mm.
     - Walls touched several times (grip) use the axis too when they are within 3°, but only when the first wall does; deliberately slanted walls keep their own line.
     - The panel says how many degrees came from the axis and how far the corners moved.
   - A room more than 3° off is kept as measured, since it is taken to be skewed on purpose.
   - To keep a room as measured anyway, press **B** (back to the walls) and then **A**. B and A again uses the axis after all.
   - With no axis to borrow (the first room, or one skewed on purpose), touches on the first wall less than 1 m apart get a warning that the direction will be inaccurate.
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
  - Drawn el/vann also remembers which rooms and walls it was drawn on. If the file changes underneath it, for example when a new model was published from another device, the measuring box warns that it may be wrong. «De ligger riktig – behold dem» clears the warning; «Forkast dem» deletes them.
  - A drawing published from another device still shows «Fortsett på ny modell …» here. Discard it with «Forkast tegningen»; it is kept as «forrige tegning».
- While a new model is shown, drawing el/vann in VR is off; its coordinates would land wrongly in the file.
- If `apartment.json` has errors, the error screen offers «Lag ny modell i stedet».

### Later work (from the judge, round 3)

- **Quest Browser plan:** the app's own room-name labels can overlap each other in small rooms (for example «Bad» and «Bad (hevet del)»). In narrow rooms they can cover the selected room's handles, which can still be clicked.
- **Multi-select:** move or copy several rooms together.
- Room templates, an overlap warning in `validate.ts`, and a wall-top fallback.
- **Real-device checks:** see QA.md «Test on the Quest (phase 2c)». They cover corners within 2 cm, the tape comparison, how easy the handles are to hit, and 90 fps. If the tape comparison is off by more than 2 cm, passthrough capture is reopened.

## Phase 2d – «wow» graphics on the Quest 3

Goal: «I want a wow experience when I put on the Quest 3». Scored per [SCORING.md](SCORING.md); the round is recorded in [QA.md](QA.md). It stays within the Quest 3 budget on «Standard» with the real `apartment.json`, as measured by the gatekeeper:
- **draw calls per eye:** 32 at the start (unchanged, though the view now looks through the whole apartment), at most 33 in any room and direction (limit 40);
- **textures:** about 10 MB (limit 32 MB);
- **per frame:** nothing new.

### The first seconds in VR

- **Fade in from black** (0.15 s black, 0.9 s fade). The jump to the start point in the first frames is hidden, and the exposure rises a little over 1.6 s, as if your eyes adjust to the light. The black sphere is hidden afterwards, so it costs no draw calls.
- **Facing the longest view:** you still start just inside the entrance door, but you now face the direction with the longest free sightline within 90° of «straight in». On the real file that looks through the openings to the living room and the kitchen, about 8 m, instead of at the hallway wall 1.7 m away. The view is computed from the walls and openings in `apartment.json` (`ApartmentModel.bestView`).
- **«Gå til rom» and «Til start»:** black for a moment, then a fade in at the new place (no visible jump).

### Daylight (all from `apartment.json`, computed once when the model is built)

- **Baked daylight in the colours** (`bake.ts`). Floors, ceilings and walls are split into a 30 cm grid, and every corner of the grid gets a light factor:
  - **light from each window in the room**, from how much of the window the point «sees» (the window's form factor). Points facing a window are bright, and the light falls off into the room;
  - **reflected light:** rooms with more window area are brighter all over, and a share of the light from rooms you can see into (open transitions, doors and openings) is added;
  - **darker edges and corners:** floors and ceilings along the walls, walls near the floor, ceiling and inner corners, and the bottom of furniture.
  - **lamp light:** each lamp point («light» fixture) lights the room it hangs in, most of all straight below, falling off with distance.
  - The three parts (base light, daylight from the windows, lamp light) are stored separately for every corner. «Lys» mixes them again on the CPU when it changes: no new bake, no new shader and no new draw calls. The bright end flattens out softly (at most 1.3), so walls never go flat white.
  - The grid follows fixed world lines, so neighbouring surfaces share corners (no cracks).
  - **When it is baked:**
    - The bake runs only when it is needed (never on «Rask»).
    - It is cached per part: when the model changes, only parts whose own geometry changed, or whose rooms, walls or openings changed, are baked again.
    - Merged meshes made of exactly the same parts as last time are reused, so drawing a cable or a pipe merges only the el/vann mesh again.
    - A rebuild takes about 20 ms in the browser on this machine (about 70 ms at 4× CPU slowdown). Before phase 2d it took about 40 ms; in round 1, about 120 ms.
    - Unit tests check that a cached rebuild takes under 60 % of a full bake, and that the walls, floors and ceilings keep the same meshes when you draw.
  - **No surfaces on top of each other:**
    - A wall end that is covered by another wall's face in the same plane (at flush corners) is not drawn.
    - Door casings are thicker than the skirting, and the skirting stops behind them.
    - Otherwise two faces with slightly different baked light would flicker; a test checks that no visible wall faces overlap.
- **Sun patches through the windows** (`sunlight.ts`). The sun shines through each window that faces it. The glass and the hole in the wall on both sides are projected along the sun's rays onto the floor and walls of the room and clipped to what is lit through all three, so the patch has the window's shape, with the mullion's shadow and soft edges. The patches go up the far wall when the sun is low, and are cut at doors and openings (the light goes through). One draw call. «Screen» blending, so patches on white walls never burn out.
- **Light rays («Høy» only):** faint columns from the glass into the room that fade out before they reach the floor.

### Sky, outside and glass

- **Sky shader:** gradient from horizon to zenith, a glow and a sun disc where the sun is, soft clouds (one 1024×512 texture made in code), and distant hills and a tree line along the horizon, computed in the shader with no geometry (so the «geometry only from `apartment.json`» gate holds).
- **Ground:** grass with a little unevenness (a 256² tiling texture made in code).
- **Glass:** almost clear straight on, with a little reflection of the sky at a steep angle (Fresnel), instead of blue panes. The outside stays visible at 60–70°.
- The textures are made the first time the sky is shown (never on «Rask»).

### Floors

- **Wood boards** (150 mm wide, 1.2 m long, staggered joints, grain, a slightly different tone per board), **tiles** (200 mm, grout lines) and a calm **vinyl** (soft mottling, no lines), from one small texture made in code. It has three layers, 1024², grey only, with mipmaps: 4.2 MB.
- The pattern multiplies the colour from the file, so the room keeps its colour, and it lies in world coordinates.
- **Which floor gets which:**
  - **tiles** in rooms with a floor drain, and in rooms with no wall to them (the raised part of the bathroom);
  - **wood** where the floor colour looks like wood (hue 15–50°, not grey);
  - **vinyl** everywhere else. The grey-green grow room and the grey kitchen get no wood boards.
- A `room.floorFinish` field can replace this rule later (see «Ideas backlog», floor types).

### «Lys»: morning, day, evening

- **«Morgen»:** a low, warm sun from the east (the entrance side), long patches up the living room's back wall, a warm horizon.
- **«Dag»** (default): exactly the lighting from phase 2b, with the sun through the front windows.
- **«Kveld»:** a low sun from the west, an orange sky and a darker, warmer interior.
  - Daylight from the windows is cut to 30 %, and the hemisphere light from 1.7 to 1.1. The start view is about half as bright as the day.
  - The **lamps are lit:** the lamp's underside glows, and its light is baked into the room. A warm glow on the ceiling follows the ceiling, even when it slopes, and a pool of light lies on the floor below. Both stop at the room's walls.
  - The light belongs to the room's layer, so layer choices for el do not switch the evening light off, and it follows the existing, planned and circuit filters.
- The compass direction is an assumption (the entrance wall faces east, −z). A `settings.north` field can come later.
- **Where:** «Lys» on the laptop (under «Visning», next to «Grafikk»), the **L** key cycles it, and «Lys» in the VR menu (X → Visning). Saved per device like the other settings.

### Graphics profile and presets

One pure function, `graphicsProfile` (`src/scene/graphicsProfile.ts`), decides what is on for the laptop, the 2D plan, VR and passthrough. App and VR both use it.

| | Rask | Standard (default) | Høy |
|---|---|---|---|
| Baked daylight | – | ✓ | ✓ |
| Sun patches, sky, lamps (evening) | – | ✓ | ✓ |
| Contact shadows under furniture | – | ✓ | ✓ |
| Wood floors and tiles | – | ✓ | ✓ |
| Light rays | – | – | ✓ |
| VR resolution | 1.0 | 1.0 | 1.3 (next time you enter VR) |
| VR foveation (blur at the edges) | 1.0 | 1.0 | 0.25 (applies at once) |

- In **passthrough** (measuring and «Lag ny modell») there is never sky or effects.
- In the **2D plan** there is no sky, sun or lamps, but the baked light stays.
- **«Effekter»: each effect on or off by itself**, on top of the preset:
  - The effects are «Dagslys i rommene», «Solflekker», «Lampelys (kveld)», «Lysstråler», «Gulvmønster», «Skygger under møbler» and «Himmel og utsikt».
  - Only the differences from the preset are saved, per device. Choosing «Rask», «Standard» or «Høy» again clears them.
  - The rules above still apply: no sun or lamps in 2D or x-ray, and nothing in passthrough. Resolution and foveation follow the preset.
  - **On the laptop:** the «Effekter» box under «Grafikk». It reads «(egendefinert)» when you have your own choices, with a «Tilbake til «Standard»» link.
  - **In VR:** X → Visning → «Effekter …», a sub-page with one button per effect. With your own choices, the button reads «Egendefinert …» and is the one marked in the «Grafikk» row.
- «Standard» keeps the phase 1 resolution and foveation until a reading on the real Quest shows headroom (see QA.md).

### Later work (graphics)

- Wall finishes in the same texture array as the floors (paint, wallpaper, wet-room tiles); see «Ideas backlog».
- Floor reflections on «Høy» (one cube map per room).
- A `settings.north` field so «Lys» follows the real compass; «Natt».
- Comfort options (seated mode, vignette during smooth turning) – Research B, proposal 5.
- If the Quest shows headroom at 90 fps: foveation 0.5 on «Standard».

## Ideas backlog (from the user, 2026-10-16)

The user's ideas for later updates, kept here so they survive between sessions. Some extend features that already exist (noted). Each one follows the project rules:
- data in `apartment.json` (or a local plan saved in the browser, like el/vann);
- Norwegian UI;
- the same tools on the laptop and in VR;
- the Quest 3 budget on «Standard».

Suggested order: 8 → 6 → 5 → 7 → 3 → 4 → 1 → 2 → 9. The view modes and surfaces reuse what exists; the HUD upgrade goes with phase 3.

1. **Outside content («Ute»).**
   - **Today:** outdoor areas (path, garden, terrace) are flat slabs, and the horizon has shader hills.
   - **Next:** outdoor objects as data, such as trees, bushes, hedges, fences, the terrace floor, garden furniture, the neighbouring wall and the parking space. They get their own `outdoorItems` list (or furniture with `layer: "outdoor"`), drawn with the same cheap merged geometry.
   - Low-poly trees as merged cones and spheres, with leaves in one colour per tree. The ground disc follows the plot.
   - Budget: one extra draw call per outdoor layer.
2. **Garden category («Hage»).**
   - A layer group and a drawing tool, like el/vann: beds, lawn, paths, planting points and the watering line. Plants come from a small library (height, spread, colour), and seasons can come later.
   - It shows in the 2D plan, and you can walk the garden in VR.
   - Grows out of item 1.
3. **Furniture collection («Møbler»).**
   - A built-in library of furniture made from simple parts (box, rounded box, cylinder), which is the format `furniture.parts` already uses.
   - Contents: sofa, bed, table, chairs, shelves, wardrobe, kitchen units, fridge, washing machine, desk and lamp.
   - Insert it from the laptop (drag into the plan) or in VR (point and place, snapped to the floor and walls), then rotate and move it.
   - Saved as a local plan, and exported into `apartment.json`.
   - Overlaps with phase 3 (editing in VR).
4. **Furniture creator («Lag møbel»).**
   - Make a piece from parts with sizes in mm and a colour per part, using the same number fields as the builder. A live 3D preview can be turned with the mouse or the controller.
   - Save it to your own collection (local), and export or import it as JSON.
   - Later: GLB import, which today is only a grey placeholder.
5. **Wallpapers and wall finishes («Vegger»).**
   - A finish per wall face (room side): paint colour, wallpaper patterns (stripes, small pattern, panel), tiles on wet walls, or concrete.
   - Data: `wall.finish` per side, or `room.wallFinish`.
   - Drawn with the same texture-array method as the floors (`detail.ts`): more layers in the same texture, no new draw calls.
6. **Floor types («Gulv»).**
   - Today wood, or tiles where there is a drain (a heuristic).
   - Next: `room.floorFinish` = wood (with board direction), parquet (herringbone), tiles (size), vinyl, carpet or concrete, plus a colour. When set, it replaces the heuristic.
   - Extends `detail.ts` and the floor shader.
7. **Colouring tool («Farge»).**
   - Point at a surface (wall face, floor, ceiling, door, furniture) on the laptop or in VR, and pick from a palette (common Norwegian paint shades plus your own) or a floor or wallpaper type from items 5 and 6.
   - Saved as a local «decor plan» with undo, like el/vann. It can be compared before and after, and exported into `apartment.json`.
8. **View modes («Visningsmodus»).**
   - Partly exists today as layer presets and filters, x-ray and the circuit filter.
   - Next, one tap (on the laptop and in VR) for each mode:
     - **«Bolig»:** furnished, with the effects on;
     - **«Elektrisk»:** the building greyed and see-through, electrical bright, with a circuit legend;
     - **«Vann og avløp»;**
     - **«Ventilasjon»;**
     - **«Oppmåling»:** colours by measuring state;
     - **«Hage»** (item 2).
   - A mode sets layers, x-ray, filters and the legend together, and the mode is saved.
9. **HUD and menu upgrade.**
   - **Wrist HUD:** the room you are in («Du er i: Stue · 18,0 m²»), the mode and «Lys». It is compact after the first minute, as Research B proposed.
   - **Quick menu:** a radial menu on the left stick for the most used choices (view mode, «Lys», «Gå til rom»).
   - **Sharper text** with WebXR quad layers.
   - **The menu:** larger and grouped, with recently used items and the same structure as the laptop panel.
   - **Laptop:** a slimmer panel with tabs (Visning, Lag, Planlegg, Bygg).
   - Goes with phase 3.

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
              ApartmentScene.ts (merge per layer+material, pick proxies, id→range map), materials.ts,
              bake.ts (grid + baked daylight), sunlight.ts (sun patches, rays), lamps.ts, lighting.ts («Lys»),
              sky.ts (sky shader, clouds, grass), graphicsProfile.ts (what is on where), shade.ts (contact shadows)
  state/      ViewState/LayerState (observable; shared by laptop UI and the future VR wrist menu)
  views/      DesktopView.ts (orbit + orthographic top-down with section cut, grid, scale)
  measure/    tasks.ts (guided list), MeasureSession.ts (log, undo, local save, export), applyMeasurements.ts +
              fit.ts (solver), align.ts (two touches → rig pose), types.ts (observations)
  xr/         XRManager.ts (session, controllers, teleport, snap turn, floor follow, measure mode), teleport.ts (arc), fade.ts,
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
- **Performance:** static geometry is merged into one mesh per (layer, material): about 20 meshes and 20 000 triangles for the whole apartment (the 30 cm grid for the baked light). The renderer uses Lambert materials with baked vertex colours, has no shadow maps, and uses hemisphere + two directional lights. That is about 32 draw calls per eye in VR at the start on «Standard», and at most 40 anywhere, which a browser test checks in every room. When the model changes, only parts whose geometry or light (rooms, walls, openings) changed are baked again.
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
- **Quest:**
  - Left stick forward aims the teleport arc; release to jump. Right stick left/right snap-turns 30°. Y shows or hides FPS.
  - You start standing just inside the entrance door, facing the longest view (through the openings to the living room and the kitchen), after a short fade in from black.
  - **The wrist panel** shows the four control lines until you have teleported and turned once (or after 20 s).
  - After that it shows only the room you are in and its area, for example «Stue» / «24,5 m² · X: meny». In a doorway, the last room stays until you are through.
  - «Vis alltid hjelp på håndleddet» (X → Komfort) keeps the help lines.
  - Each controller is one mesh (one draw call).
- **Quest, measuring:** see the controls table in phase 2.
- **Quest, menu (X):** point with the right controller and pull the trigger. Tabs: Visning (with the «Effekter …» sub-page), Lag, Tegn, Gå til, Komfort. Right stick back turns 180°.
- **Laptop, keys:** 1/2 (3D/2D), T (ceilings), U (placeholders), K (dollhouse), R (reset view), F (FPS), L (light: morning → day → evening), H (help), S/E/V/P (draw tools), Enter/Backspace/Esc/Delete/Ctrl+Z while drawing.
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
