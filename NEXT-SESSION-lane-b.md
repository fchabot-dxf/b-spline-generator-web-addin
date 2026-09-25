# NEXT (lane-b) — T49: SE13 Slice 3 — emission, ending rules, panel UI, live link, Border

**Ball: worker (seat B) · epoch 2 · T49.** NO FUSION for workers. T48 reviewed + merged. Fred answered the SE13 open
questions — "agree with your bracket propositions" (recorded in the doc): no runs yet; stretch/boundary-move = no new
rule; one Node size; curved boundaries supported; Border defaults to the boundary shape's own stroke.

## Fix first (your T48 finding, but it's a product issue): edge-collinear rows must NOT vanish
Snap is ON by default, so a rect/polygon boundary drawn by hand has its edges EXACTLY on grid rows/columns — every
such boundary would silently lose its outermost rails/ties. Decide the rule explicitly and declare it: a scan line
collinear with a boundary edge yields a span ALONG that edge (closed-interval on the edge), so the edge row is kept;
with the Border piece ON, an edge-collinear rail/tie is dropped instead (the Border already draws that line — no
double stroke). Test both, plus a snapped rect drawn by the real rect tool.

## Then build your §14 Slice 3 as designed
Ending rules table (on-boundary / inset default / joint / loose, loose→inset fallback), Border piece, shape-pick UI +
data-boundary-ref link, commit-only refill, panel markup (Boundary / Ending / Border; no Runs block yet), save/load.
Mobile rules from MOB2 apply to the new controls. Browser proof per your Slice 3 verify list, incl. an Outline export
of a boundary-filled layer with no new decline kinds.
Don't commit `reference/`.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T49: SE13 slice 3 — <sha>, vitest N, screenshots"`
and stop.
