# NEXT — MOB3b: drawer polish at FULL height + make the new SE13 rows collapsible sections

**Ball: worker (seat A) · epoch 2 · MOB3b.** NO FUSION — browser proof only. MOB3 reviewed + merged with seat B's SE13
Boundary panel (T49) — both on main (820 green). Advisor re-ran your two smokes (all intended flags) and viewed the
shots: peek is right, the main-screen resizer is right.

## Findings (advisor, your own mob3-mobile-3-full.png — copy at
C:\Users\danse\AppData\Local\Temp\claude\c--Users-danse-APPS-b-spline-generator-web-addin\3e3f0b14-6c58-4c85-afb5-23d3fcfd5c2e\scratchpad\mob3-full-issues.png)
1. At FULL the undo/redo pill floats over the STROKE toolbar row (the canvas is gone, the pill kept its place). Rule:
   the pill always sits in the canvas area just above the drawer's top edge; when the canvas area is too short
   (< pill height + margin, e.g. at full) hide it or dock it into the drawer header — pick one, declare it.
2. At FULL a Nodes checkbox renders oversized and sits UNDER the sticky Generate/Detach footer (bottom-left blue
   check glyph). The scroll area must end above the sticky footer (padding-bottom = footer height) and the checkbox
   must keep its normal ≥32px touch size, not stretch.
3. Seat B's new rows (Boundary / Ending / Border — ids latticeBoundary*, latticeEnding*, latticeBorder*) are inside
   the drawer but not yet in your collapsible sections. Give them their own section(s) like the others, remembered
   open/closed.
## Verify
390x844 screenshots at full (Lattice) with the Nodes and Boundary sections open, scrolled to the bottom: nothing under
the footer, pill not over the toolbar; peek unchanged; desktop unchanged. `npx vitest run` green.
## When done
Append WORK-LOG.md, commit by path, push, then
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "MOB3b: drawer polish — <sha>, screenshots"`
and stop.
