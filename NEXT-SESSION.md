# NEXT — MOB2b: the editor's Layers rows are still hidden on a phone

**Ball: worker (seat A) · epoch 2 · MOB2b.** NO FUSION — browser proof only. MOB2 reviewed (d213048, 660 green):
Apply Stencils visible and the pill off the panels — confirmed by the advisor's own 390x844 run. Seat B is on T41 (text
glyph mismatch) in lane-b.

## Remaining finding (advisor's 390x844 screenshot after Generate)
Only the "LAYERS  +" header shows; the layer ROWS (eye / 3D / palette / name) are not visible — the Pattern bottom
sheet sits right under the header and the rows are clipped or behind it. A phone user can't switch layers or toggle 3D
in the editor. Your smoke asserted the pill doesn't intersect the panel and the toggles are ≥ touch size, but not that
the rows are actually VISIBLE — add that assertion (at least the active layer's row fully inside the viewport and not
covered: elementFromPoint at its center returns the row).
Fix: give the Layers panel real height on coarse/narrow (e.g. rows visible with the Pattern sheet collapsed by default
to its header, or Layers + Pattern as two tabs in the same sheet). Pick the simplest that keeps both reachable; say
which in WORK-LOG.

## Verify
390x844 and 768x1024 screenshots after Generate with 3 layers: every row visible and tappable, Pattern still reachable
with one tap; desktop unchanged. `npx vitest run` green.

## When done
Append WORK-LOG.md, commit by path, push, then
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "MOB2b: layer rows visible on phone — <sha>, screenshots"`
and stop.
