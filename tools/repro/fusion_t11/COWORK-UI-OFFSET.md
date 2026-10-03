# Task for Claude Cowork: test Fusion's UI **Offset** tool when the offset is bigger than a curve

You are helping answer one question: **when you offset a shape inward by more than one of its curves' radius, what does
Fusion's interactive Offset tool do?** Another Claude session already measured the Python API: its parametric offset
*refuses* in that case, and the older offset makes a sharp corner that is no longer linked to a parameter. We want the
same test done by hand in the UI. Draw, offset, observe, screenshot. Then stop.

Re-use what you learned last time (see `UI-cowork-log.md` next to this file: monitor, origin, px per inch, the
Sketch palette, renaming sketches, waiting ~2 s after each click and verifying with a screenshot).

## Ground rules (same as last time)
- Only Fusion 360. If "Session Suspended" appears, stop and tell Fred.
- Don't close or edit any open document except the new one you create. Leave "UI-cowork" and "API-claude code" alone.
- Never type unless a text field is confirmed focused.
- Screenshot every step into `tools/repro/fusion_t11/cowork_offset_screenshots/`, named `<test>_stepNN.jpg`.

## Setup
1. New Design (Ctrl+N with Fusion focused). Units: inches.

## The shape (draw it once per test, in its own sketch on the XY plane)
A **rounded rectangle**, 5 in wide × 4 in tall, centred on the origin, with all 4 corners rounded to **radius 0.75 in**:
- Sketch tab → Rectangle → Center Rectangle: centre at the origin, corner at (2.5, 2) → 5 × 4 in.
- Modify → Fillet: click each of the 4 corners, type **0.75** for the radius, Enter. (All 4 must be filleted.)
- Finish nothing yet; continue in the same sketch.

## The tests (one sketch each, named as given)
For each test: draw the shape above, then **Sketch tab → Modify → Offset**: select the whole loop (click one edge;
Fusion should chain the loop; if not, click all 8 pieces), drag inward and type the distance, press Enter / OK.

| # | Sketch name | Offset distance (inward) | What it tests |
|---|---|---|---|
| 1 | `UI_offset_0.50` | **0.50 in** | smaller than the 0.75 corner radius (should be easy) |
| 2 | `UI_offset_0.75` | **0.75 in** | exactly equal to the radius |
| 3 | `UI_offset_0.90` | **0.90 in** | BIGGER than the radius (the interesting case) |
| 4 | `UI_offset_drive` | start at **0.50 in**, then after it's made, **double-click the offset's dimension** and change it to **0.90 in**, Enter | does an existing offset follow the change past the radius? |

## For each test, write down
1. **Did Fusion accept it?** Any error message, warning icon, or the offset just not appearing? Copy any message text exactly.
2. **The inner corners:** are they **rounded** (a small arc) or **sharp** (two straight lines meeting in a point)?
   Zoom in on one corner (scroll) and screenshot it close-up.
3. **Is there an offset dimension** shown on the sketch (a number with the distance)? Is the offset linked (if you
   drag the outer rectangle's corner a little, does the inner copy follow)? Then Ctrl+Z to undo the drag.
4. For test 4: after changing 0.50 → 0.90, what happened? (Updated with sharp corners? Error? Unchanged? Something odd?)

Finish each sketch and rename it as given (right-click → Rename) before the next test.

## When you're done
- Save the document as **"OFFSET-cowork"** (Ctrl+S) and leave it **open**.
- Write your notes into a new file `tools/repro/fusion_t11/UI-offset-cowork-log.md`: for each of the 4 tests, the
  four answers above, plus any surprise.
- Tell Fred you're done; he'll tell the other Claude session to read the document and compare with the API results.
