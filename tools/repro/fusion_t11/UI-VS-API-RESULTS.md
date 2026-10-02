# UI vs API sketch tools -- results (2026-10-02)

Same shapes drawn with Fusion's toolbar (UI_*, by Claude Cowork following COWORK-UI-SKETCHES.md) and with the API
(API_*, `ui_vs_api_inventory.py MODE='build'`), in one design ("UI-cowork"), read back the same way (`MODE='read'`).
Raw readback: `ui_vs_api_readback_2026-10-02.json`. How Cowork drew the UI side: `UI-cowork-log.md`, with every step's screenshot in `cowork_screenshots/` (198, `<sketch no>_<name>_stepNN.jpg`).

## What it means (each confirmed on extra variants before recording -- fusion360-quirks aa48914)
- **Rectangles: the API adds NO constraints** (4 corner-welded lines; the centre rectangle has no construction
  diagonals). Confirmed on 6 more variants. The UI adds parallel/perpendicular/H-V (+ diagonals and centre for the
  centre rectangle). Add the constraints yourself when using the API (the CAM builder's stock placeholder does).
- **Fillet:** the UI adds a radius dimension, the API does not (both add 2 tangents).
- **Arc slots:** the API has 3 tangents, the UI 4 -- the missing one is implied: driving every slot dimension x1.6 kept
  all 4 joints exactly smooth (4 variants). No behaviour difference.
- **Midpoint, circles, polygons, straight slots, arcs: identical.** Every other UI-only constraint is snap inference
  (Horizontal/Vertical from drawing along an axis, Coincident from clicking the origin), which the API never adds.

## Side by side (constraint types; UI extras in Horizontal/Vertical/Coincident are inference unless noted above)
| tool | curves | API constraints | UI constraints | dims |
|---|---|---|---|---|
| arc_3point | Arc 1 | (none) | Coincident |  |
| arc_center | Arc 1 | (none) | Coincident |  |
| arc_center_start_end | Arc 1 | (none) | (no sketch) |  |
| arc_tangent_emulated | Arc 1, Line 1 | Coincident, Tangent | Horizontal, Tangent |  |
| circle_2point | Circle 1 | (none) | (none) |  |
| circle_3point | Circle 1 | (none) | (none) |  |
| circle_center | Circle 1 | (none) | Coincident |  |
| constraint_midpoint | Line 1 | MidPoint | MidPoint |  |
| constraint_midpoint_line_end | Line 2 | MidPoint | MidPoint, Vertical |  |
| fillet | Arc 1, Line 2 | Tangent, Tangent | Horizontal, Perpendicular, Tangent, Tangent | UI: Radial |
| polygon_circumscribed | Line 6 | Polygon | Coincident, Polygon |  |
| polygon_edge | Line 6 | Polygon | Polygon |  |
| polygon_inscribed | Line 6 | Polygon | Coincident, Polygon |  |
| rect_2point | Line 4 | (none) | Coincident, Horizontal, Horizontal, Vertical, Vertical |  |
| rect_3point | Line 4 | (none) | Parallel, Parallel, Perpendicular |  |
| rect_center | Line 4 | (none) | Coincident, Coincident, Coincident, Horizontal, Parallel, Parallel, Perpendicular |  |
| slot_3point_arc | Arc 4, Arc(c) 1 | Tangent, Tangent, Tangent | Tangent, Tangent, Tangent, Tangent |  |
| slot_center_point | Arc 2, Line 2, Line(c) 1 | MidPoint, Parallel, Tangent, Tangent, Tangent, Tangent | Coincident, Horizontal, MidPoint, Parallel, Tangent, Tangent, Tangent, Tangent |  |
| slot_center_point_arc | Arc 4, Arc(c) 1 | Tangent, Tangent, Tangent | Coincident, Tangent, Tangent, Tangent, Tangent |  |
| slot_center_to_center | Arc 2, Line 2, Line(c) 1 | Parallel, Tangent, Tangent, Tangent, Tangent | Horizontal, Parallel, Tangent, Tangent, Tangent, Tangent |  |
| slot_overall | Arc 2, Line 2, Line(c) 1 | Coincident, Coincident, Coincident, Coincident, Parallel, Tangent, Tangent, Tangent, Tangent | Coincident, Coincident, Coincident, Coincident, Horizontal, Parallel, Tangent, Tangent, Tangent, Tangent |  |
