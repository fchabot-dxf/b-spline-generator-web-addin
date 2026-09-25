# NEXT — SE7j: node drag slides the WHOLE tie, upright (Fred)

**Ball: worker (seat A) · epoch 2 · SE7j.** NO FUSION — browser proof only. SE7i part 2 reviewed + merged (81e481e);
advisor re-ran smoke-lattice-connected.mjs: all true, 0 errors. Seat B is on T39 (path outlines) in lane-b.

## Fred's ruling
Your screenshot 2b showed a node drag making the tie LEAN (one end slid along the rail). Fred: **"Upright — I will
slant it in direct edit mode if I need."**

## Change (Lattice tool, node drag only)
- Grabbing a node that sits on a tie (its end, or a tie/rail crossing) moves THE WHOLE TIE along the rail axis
  (horizontal rails → the tie's i changes, j untouched; vertical mirrors via orient()). Both tie ends shift by the same
  along-axis delta, so the tie stays upright and keeps its length and width.
- Every node on that tie (both ends and any crossings along it) moves with it. Ends that were attached to a rail stay on
  that rail's row; if the shifted end would pass a rail's drawn extent (beyond its end), it stays attached only if still
  within range — otherwise it just keeps the row (Fred earlier: "if tie isn't on rail anymore don't worry, just keep
  the coincidence with rail axis only").
- Snap: the delta snaps to the lattice spacing (grid on) so ends stay on grid points.
- One undo step. Rail drags and tie drags are unchanged. The "node slides one end" path is removed (no dead branch) and
  its test replaced.
- Direct edit (Node tool / Select) stays the way to slant a tie — untouched.

## Verify
- Pure tests: node drag → tie translated by one along-axis delta, still perpendicular, nodes carried; vertical mirror.
- Extend smoke-lattice-connected.mjs: node drag → both tie ends' along-axis coord changed equally, other coord unchanged.
- `npx vitest run` green (rerun once on a whole-suite load flake).

## When done
Append WORK-LOG.md, commit by path, push, then
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE7j: node drag slides whole tie upright — <sha>, vitest N"`
and stop.
