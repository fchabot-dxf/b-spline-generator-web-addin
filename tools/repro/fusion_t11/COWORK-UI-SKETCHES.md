# Task for Claude Cowork: draw reference sketches in Fusion with the normal UI tools

You are helping compare Fusion 360's **interactive sketch tools** with what its **Python API** produces. Another Claude
session will later build the same shapes with the API and read both sets back. Your only job is to draw each shape
**the way a person would, with the toolbar tools**, so that Fusion adds its usual automatic constraints. Then stop.

## Ground rules (important)
- Use **only Fusion 360**, which is already open on this PC. Fusion allows one signed-in session; if a "Session
  Suspended" dialog appears, stop and tell Fred — don't click through it.
- **Do not close, save over, or edit any document that is already open.** Work only in the new one you create below.
- Let Fusion snap and auto-constrain normally. **Don't delete or add constraints yourself**, except where a step
  says to apply one (the Midpoint steps).
- Units are inches (the document default). Sizes don't need to be exact; roughly right is fine.
- If a tool doesn't exist in this Fusion version, or a step fails, write it down and move on to the next one.

## Setup
1. File → New Design. This is your working document.
2. In the Browser panel (left), make sure you're in the root component.

## For EACH item below
- Create Sketch → pick the **XY plane** (the "Top" plane).
- Draw the shape with the named tool. Draw it away from other sketches is fine; each item is its own sketch.
- **Finish Sketch.**
- In the Browser, rename the sketch to exactly the name given (right-click → Rename), e.g. `UI_rect_center`.

## The list
| # | Sketch name | Tool (Sketch tab → Create, unless noted) | What to draw |
|---|---|---|---|
| 1 | `UI_rect_2point` | 2-Point Rectangle | about 3 × 2 in, one corner at the origin |
| 2 | `UI_rect_3point` | 3-Point Rectangle | a tilted rectangle, about 3 × 2 in |
| 3 | `UI_rect_center` | Center Rectangle | centre on the origin, about 3 × 2 in |
| 4 | `UI_arc_3point` | 3-Point Arc | start (0,0), end (2,0), bulging up about 1 in |
| 5 | `UI_arc_center` | Center Point Arc | centre at origin, radius about 1 in, a quarter turn |
| 6 | `UI_arc_tangent_emulated` | Line, then Tangent Arc | a 2 in horizontal line, then a tangent arc starting from its right end, curving up |
| 7 | `UI_constraint_midpoint` | Line, Point, then **Constraints → Midpoint** | a slanted line about 3 in; a separate point near its middle; apply Midpoint (click the point, then the line) |
| 8 | `UI_constraint_midpoint_line_end` | two Lines, then **Constraints → Midpoint** | a slanted line about 3 in; a second short line starting near its middle; apply Midpoint (click the second line's end point, then the first line) |
| 9 | `UI_circle_center` | Center Diameter Circle | centre at origin, diameter about 2 in |
| 10 | `UI_circle_2point` | 2-Point Circle | across about 2 in |
| 11 | `UI_circle_3point` | 3-Point Circle | through three spread points |
| 12 | `UI_fillet` | two Lines meeting at a corner, then **Modify → Fillet** (radius 0.3 in) | an L: 2 in along X and 2 in along Y from the origin, filleted |
| 13 | `UI_slot_center_to_center` | Slot → Center to Center Slot | about 3 in long, width about 0.5 in |
| 14 | `UI_slot_overall` | Slot → Overall Slot | about 3 in long, width about 0.5 in |
| 15 | `UI_slot_center_point` | Slot → Center Point Slot | centre at origin, about 3 in long |
| 16 | `UI_slot_3point_arc` | Slot → Three Point Arc Slot | an arched slot about 3 in across |
| 17 | `UI_slot_center_point_arc` | Slot → Center Point Arc Slot | an arched slot, centre at origin |
| 18 | `UI_polygon_circumscribed` | Polygon → Circumscribed Polygon | 6 sides, about 2 in across |
| 19 | `UI_polygon_inscribed` | Polygon → Inscribed Polygon | 6 sides, about 2 in across |
| 20 | `UI_polygon_edge` | Polygon → Edge Polygon | 6 sides, edge about 1 in |

## When you're done
- Leave the document **open and unsaved** (don't close it), and don't touch any other document.
- Tell Fred in a short list: which sketches you made, which tools were missing or failed, and anything surprising
  (for example a tool that asked for an extra click or added visible constraint icons you didn't expect).
- Fred will then tell the other Claude session to read the document.
