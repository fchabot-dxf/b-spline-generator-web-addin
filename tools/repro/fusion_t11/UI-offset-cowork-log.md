# UI offset test — Cowork log (live, appended as I go)

Task: COWORK-UI-OFFSET.md. Screenshots: `cowork_offset_screenshots/<test>_stepNN.jpg` (chronological).

## Setup
- Fusion had 10/10 editable docs -> new design opened READ-ONLY ("Document limit has been reached").
  With Fred's OK: Data panel > My Editable Documents > "Untitled" (empty, 02-Oct 7:38 AM, my accidental save) > Read-Only > Make Read-Only. New doc became editable (9/10).
- New design via "+" tab (1441,23) > Hybrid Design, inch > Create Now. Create Sketch (93,60) > XY plane click (848,358) in iso view -> Top view.
- View 1: origin (784,358), ~78 px/in. (After finishing sketch 1 the view zoomed out: ~52 px/in, origin still (784,358).)

## Shape routine (per test)
1. Rectangle (198,60), palette Center mode (1518,242); click origin; move to corner until the live dims read 5.0000 x 4.0000; click.
2. Fillet (311,60). DON'T click the corner vertex: it picks the construction diagonal (got "Length 6.40" line). Instead click the two edges near each corner.
   Fillet behaviour: field shows default radius (1.00, later 0.80 = last value); selecting the next corner pair COMMITS the previous one at the field value. Typing 0.75 + Enter applies 0.75 to the pending pair and the earlier ones end equal (equal constraints) -> all R0.75.
   Warning toast after each fillet: "1 warning(s) — Constraints and/or dimensions were removed during operation." (diagonals' corner coincidences).
3. Offset (364,60): click one straight edge -> Chain Selection picks whole loop (Curves: 1 selected). Arrow points OUT; typed 0.5 + Tab -> outward preview; clicked Flip (1330,278) -> Distance shows -0.5, preview inside. OK (1340,299).

## Test 1 — UI_offset_0.50
1. Accepted: yes, no error/warning from Offset.
2. Inner corners: ROUNDED (small arcs, r≈0.25), see close-up.
3. Offset dimension: yes, "0.50" shown between outer top edge and inner top edge. Linked: dragging outer top edge up (mouse down/move/up) resized the whole rectangle symmetrically and the inner loop followed, keeping 0.50. Ctrl+Z undid it.
   Scroll-wheel zoom on the corner did not zoom (view only shifted); close-up is a high-res screen crop instead.
- Renamed: right-click Sketch1 row (95,214) > Rename (128,393) > "UI_offset_0.50"; hidden via eye (53,214).

## Test 2 — UI_offset_0.75
- New sketch auto-placed on XY (no plane pick needed). View ~52 px/in, origin (784,358).
- Slip: first rectangle came out 4.80 wide (I clicked (914,254) after verifying at (919,254)); undone (Select, Ctrl+Z) and redrawn: corner click (919,254) -> top line Length 5.00. Rect x 654-914, y 254-461 px.
- Fillets: top pair (875,254)+(914,295), (693,254)+(654,295) -> 0.75 Enter; bottom pair (693,461)+(654,420), (875,461)+(914,420) -> field showed 0.80 -> 0.75 Enter. Same "1 warning(s) Constraints and/or dimensions were removed" toast.
- Offset: click (740,254), typed 0.75 Tab (outward preview), Flip -> -0.75, OK.
1. Accepted: yes, no error, no warning.
2. Inner corners: SHARP. Inner loop is a plain 3.5 x 2.5 rectangle; clicking the inner corner selects "Sketch Point | X: 1.75 Y: -1.25" (no arc). Perpendicular-constraint icon appears at the inner corner.
3. Offset dimension "0.75" shown. Linked: dragging the outer top edge resized everything and the inner sharp rectangle followed at 0.75. Ctrl+Z restored.
- Renamed Sketch2 (row 95,229 > Rename 128,408) -> UI_offset_0.75, hidden.

## Test 3 — UI_offset_0.90
- Same shape routine (corner click (919,254), top line 5.00; fillets 0.75 x4; field defaulted 1.00 then 0.80 again).
- Offset: click (740,254), typed 0.9 Tab, Flip -> -0.9, preview already a sharp rectangle, OK.
1. Accepted: YES. No error, no warning, nothing refused — the offset simply appeared.
2. Inner corners: SHARP. Inner loop = plain 3.2 x 2.2 rectangle; corner click -> "Sketch Point | X: 1.60 Y: -1.10". (Unlike 0.75, no corner point dots were drawn on the loop until selected.)
3. Offset dimension "0.90" shown. Linked: dragging the outer top edge resized it and the inner sharp rectangle followed. Ctrl+Z restored.
- Renamed Sketch3 (row 95,244 > Rename 128,423) -> UI_offset_0.90, hidden.

## Test 4 — UI_offset_drive
- Same shape routine; Offset at 0.5 inward (typed 0.5 Tab, Flip -> -0.5, OK). Result identical to test 1: rounded inner corners, dimension "0.50".
- Double-clicked the "0.50" dimension (732,268): the edit field shows the SIGNED value "-0.5 in" (the dimension label shows 0.50). Typed -0.9 + Enter (kept the minus so it stays inward).
4. Result: REFUSED. Error toast, then (red error icon, bottom right) dialog "Error":
   "Failed to solve.
    Please delete or modify one of the following constraints/dimensions
    d12 : -0.9 ""
   The geometry did NOT change: inner loop stays at 0.50 with rounded corners, the label still reads 0.50. No sharp corners, nothing odd left behind. Closed the dialog.
   (Contrast: creating the offset fresh at 0.90 (test 3) is accepted and gives sharp corners; driving an existing rounded offset past the radius fails to solve.)
- Renamed Sketch4 (row 95,259 > Rename 128,438) -> UI_offset_drive. Left visible.

## Save
- Ctrl+S > Name "OFFSET-cowork" > Save (979,335). Fusion shows "OFFSET-cowork v0" (uploading). Document left open.

## Summary table
| Test | Accepted? | Inner corners | Offset dim | Linked (follows drag) |
|---|---|---|---|---|
| 0.50 | yes, no message | rounded (r 0.25) | 0.50 | yes |
| 0.75 | yes, no message | sharp (corner = sketch point 1.75,-1.25) | 0.75 | yes |
| 0.90 | yes, no message | sharp (corner = sketch point 1.60,-1.10) | 0.90 | yes |
| drive 0.50->0.90 | NO: "Failed to solve ... d12 : -0.9" | stays rounded at 0.50 | stays 0.50 | n/a |

## Surprises
- UI Offset at 0.75 and 0.90 is NOT refused (unlike the API's parametric offset): it silently produces a sharp-cornered inner rectangle that is still dimensioned and linked.
- But editing an existing 0.50 offset to 0.90 is refused by the solver; Fusion does not switch the rounded copy to sharp corners.
- The offset dimension's value is signed (-0.5) in the edit box, while the label shows 0.50.
- Fillet tool: each new corner pair commits the previous at the field's current value (1.00, later 0.80 = last value); typing 0.75 at the end sets them all equal. Every fillet gave "Constraints and/or dimensions were removed during operation".
- Document limit: had to set an old empty "Untitled" doc to read-only to create a new editable design.
- Screenshots: cowork_offset_screenshots/ (setup, test1..test4, save; step numbers chronological). Leftover _batch1.zip / _all.zip there can be deleted.
