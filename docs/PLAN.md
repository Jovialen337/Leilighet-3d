# Leilighet 3D – project plan

Status: **Phase 1 built** (awaiting a real-headset check on the Quest). This file is updated in every phase.

## Goal

An accurate 3D model of my apartment that I can:

- walk through and (later) edit on **Meta Quest 3** (Quest Browser, WebXR, controllers only in v1);
- view in orbit or top-down on my **Windows laptop** in a normal browser.

All UI text is Norwegian (bokmål). All geometry comes from one data file, `public/apartment.json`. No geometry is hard-coded.

## Phases

| Phase | Content | Status |
|---|---|---|
| 1 | Data model + validation, rendering, VR walking (teleport, snap turn, room-scale), laptop orbit/top-down, layer toggles, FPS, GitHub Pages deploy | **built** – see [QA.md](QA.md) |
| 2 | *(proposal)* Replace placeholders with real measurements: measuring checklist from `measured:false` values, control dimensions per room, scan reference import | – |
| 3 | VR editing: wrist menu (layers, FPS, tools), select/move furniture and fixtures, save back to `apartment.json` | – |
| 4+ | *(proposal)* Planning: electrical and wiring routes, ventilation, workshop zone, GLB furniture import, notes in VR | – |

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
  schema/     types.ts (all object types), validate.ts (Norwegian), normalize.ts ({value,measured} → numbers + measure state)
  geometry/   math2d.ts, plane.ts (ceiling plane fit) – pure maths, no three.js
  model/      ApartmentModel.ts (queries in mm: floor at a point, wall frames, wall top following ceilings,
              door geometry, thresholds, placements, spawn), ApartmentStore.ts (load / update / toJSON)
  scene/      buildWall.ts (face polygon with holes/notches, extruded), buildParts.ts (everything else),
              ApartmentScene.ts (merge per layer+material, pick proxies, id→range map), materials.ts
  state/      ViewState/LayerState (observable; shared by laptop UI and the future VR wrist menu)
  views/      DesktopView.ts (orbit + orthographic top-down with section cut, grid, scale)
  xr/         XRManager.ts (session, controllers, teleport, snap turn, floor follow), teleport.ts (arc),
              rig.ts (pure rig maths), WristPanel.ts (seed of the phase 3 wrist menu), emulator.ts (IWER)
  ui/         DesktopUI.ts (Norwegian panel), Labels.ts, FpsMeter.ts, style.css
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

## Known limitations (phase 1)

- Imported GLB furniture is only a grey placeholder box. Scan references are validated but not drawn.
- Notes are small markers in VR; their text shows only in the laptop 2D plan.
- Only a real headset can confirm the frame rate and comfort. See the test list in [QA.md](QA.md).
