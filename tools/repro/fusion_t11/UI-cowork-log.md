# Cowork UI operation log (Fusion sketch drawing, 2026-10-02)

How the UI sketches were drawn with computer use, kept for re-use. Updated as work proceeds.

## Environment
- Fusion is on monitor "LG HDR WFHD" (switch_display), main window process fusion360.exe (grant it as well as the launcher).
- New design: focus Fusion first (click it), then Ctrl+N. Clicking the "+" tab on an unsaved doc raised a Save dialog once (do not use it).
- Viewport after picking the XY plane: Top view, origin at screen (784,358), 1 in = ~80 px, Snap on (grid snaps).
- Fusion repaints late: move the mouse and wait ~2 s before a screenshot. Escape often does not register in the middle of a tool; switch tool instead (click Select at (983,60), or Finish Sketch at (1237,60)).
- Click drops: the 2nd click of a multi-click tool is sometimes ignored. Do mouse_move -> wait -> click -> wait 2 s per point, and verify with a screenshot before the next point.
- Never type unless a rename field is confirmed open (zoom on the browser row first); stray typing triggers shortcuts (a Loft dialog opened once).

## Routine per sketch
1. Create Sketch (93,60), click XY plane (852,358). (Sometimes it enters the sketch directly; the extra click is harmless.)
2. Pick the tool, pick the mode in the Sketch Palette (right panel), draw, verify.
3. Finish Sketch (1237,60).
4. Right-click the sketch row in the browser (rows start y=214 and step 15 px, x=95) -> Rename (menu item ~179 px below the click) -> confirm the field is highlighted -> type name -> Return.
5. Click its eye (x=53) to hide it so the next sketch snaps only to its own geometry.

## Palette mode icons (feature options, right panel)
- Rectangle: 2-point (1518,223), 3-point (1537,223), center (1518,242). Tool remembers the last mode, so always set it.
- Arc: center-point (1518,223), 3-point (1537,223), tangent (1518,242). Tangent arc needs a click on an existing endpoint.
- Constraints menu: dropdown at (565,77); Midpoint item at (437,175). Click the point/end first, then the line.
- Create menu: dropdown at (189,77); Point item at (102,212).

## Observations per sketch
- UI_rect_2point: 2 corner clicks -> 4 lines, auto H/V constraints on the sides; corner at origin coincident with origin.
- UI_rect_3point: tilted; shows perpendicular constraints, no H/V.
- UI_rect_center: shows construction diagonals + midpoint-style center constraint at origin plus H/V and equal marks.
- UI_arc_3point: start origin, end (2,0), bulge ~1 in.
- UI_arc_center: centre origin, radius 1 in, quarter turn (start top, end left).
- UI_arc_tangent_emulated: 2 in horizontal line then tangent arc from its right end; tangent constraint auto-added.
- UI_constraint_midpoint / _line_end: Midpoint applied; the point/end jumps onto the line middle.

## Exact click sequences (screen px on the LG HDR WFHD monitor, Top view, origin (784,358), 80 px/in)
Toolbar (Sketch tab): Line (93,60), Rectangle (198,60), Circle-family icon (225,60), Arc (252,60), Polygon (277,60), Select (983,60), Finish Sketch (1237,60).
Note: (277,60) is Polygon, not Circle.

1. UI_rect_2point: rect tool, palette 2-point (1518,223); click (784,358) then (1024,198) -> 3 x 2 in.
2. UI_rect_3point: palette 3-point (1537,223); clicks (700,450), (926,368), (871,217).
3. UI_rect_center: palette center (1518,242); clicks (784,358) then (904,278) -> 3 x 2 in.
4. UI_arc_3point: Arc tool, palette 3-point (1537,223); clicks start (784,358), end (944,358), bulge (864,278).
5. UI_arc_center: palette center-point (1518,223); centre (784,358), start (784,278) (top), end (704,358) (left) = quarter turn CCW; move the cursor in small steps along the circle before the last click or Fusion picks the 270 deg way round.
6. UI_arc_tangent_emulated: Line (93,60): (624,438) -> (784,438); click Select (983,60) to end the chain; Arc tool, palette tangent (1518,242); click line end (784,438), then end point (864,358).
7. UI_constraint_midpoint: Line (664,438) -> (864,318) (~3.1 in); Create menu (189,77) -> Point (102,212), click (740,336); Select; Constraints menu (565,77) -> Midpoint (437,175); click the point (742,338) then the line (700,411).
8. UI_constraint_midpoint_line_end: Line (664,438) -> (864,318); Select, Line again: (734,338) -> (734,288); Constraints -> Midpoint; click the short line's lower end (734,339) then the long line (700,411).
Browser: sketch rows x=95, y=214 + 15*(n-1); eye icon x=53; right-click -> Rename sits ~179 px below the row.

## Sketches 9-20 (click sequences, screen px; origin (784,358), 80 px = 1 in, Snap on)
9  circle_center: Create menu > Circle > Center Diameter, centre (784,358), edge -> diameter 2.0000.
10 circle_2point: Circle > 2-Point, ~2 in across.
11 circle_3point: Circle > 3-Point.
12 fillet: L (2 in X, 2 in Y from origin), Modify > Fillet, default radius field 0.50 -> typed 0.3 + Return -> R0.30, tangent constraints + radius dim auto-added.
13 slot_center_to_center: Create > Slot > Center to Center; came out ~2.8 x 0.4 in; auto tangent/equal constraints, construction centreline.
14 slot_overall: Slot > Overall: (704,420) -> (944,420), width point (824,400); ~3 in long.
15 slot_center_point: Slot > Center Point: centre (784,358) (auto midpoint on origin), end (904,358), width (904,338). Note: end point is the arc centre, so overall length = 2*1.5 + width (~3.5 in).
16 slot_3point_arc: Slot > Three Point Arc: (704,438), (944,438), arc point (824,398), width (824,378). Needed 2 s waits between clicks.
17 slot_center_point_arc: Slot > Center Point Arc: centre (784,358), start (784,438), end (864,358) (stepwise mouse moves), width (844,378).
18 polygon_circumscribed: Polygon tool (277,60), palette icon (1537,223) = Circumscribed, centre (784,358), move stepwise, click (864,358), 6 sides default, size 1.0 -> hexagon ~2 in flat-to-flat.
19 polygon_inscribed: palette icon (1518,242) = Inscribed, centre (784,358), vertex (864,358) radius 1.0.
20 polygon_edge: palette icon (1518,223) = Edge, edge (744,358)->(824,358) = 1.0 in, side point (800,300).
Polygon quirks: tool does NOT keep the chosen mode between uses (reverted to Inscribed); set mode every time. A dropped click once placed a huge polygon (6+ in) -> Ctrl+Z, redone. Sketch 18 was drawn twice at user's request.
Palette mapping (Polygon): (1518,223) Edge, (1537,223) Circumscribed, (1518,242) Inscribed.
Document: saved by Ctrl+S as "UI-cowork" (Fusion shows "UI-cowork v1"). Sketch rename: right-click row > Rename (offset ~ -135 px up).
Screenshots stayed in the cloud session; not copied to this folder.

## Screenshots
Moved out of the repo (20 MB) to `C:/Users/danse/.bspline-status/cowork_ui_sketches/screenshots/`: 198 jpgs named `<sketch no>_<sketch name>_stepNN.jpg` (00_setup = file dialogs/accidental save before sketch 1; 21_document_saved = final save). Steps are in chronological order within each sketch. Sketches 1-13 were assigned to sketches by matching the browser list in the shots, so a few boundary frames may sit one sketch off. `shots_bundle.zip` is a leftover copy of the same images and can be deleted.
