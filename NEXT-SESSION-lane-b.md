# NEXT (lane-b) — T35: SE12 Slice 1 — analytic live-expand engine (line → outline), round cap

**Ball: worker (seat B) · epoch 2 · T35.** NO FUSION (hard rule) — browser proof only. Seat A is on SE7h (lattice
orientation) in the main checkout; don't touch lattice files.

First: `git merge main` (main has your T34 merged + layer-toggle styling + the SE12 doc answer).

## Fred's answers now in SE12-LIVE-EXPAND-DESIGN.md
- `fusionGeometry` = an explicit per-layer pick (Outline / Centerline / Both), default centerline, **never set
  automatically** (Fred: "Don't choose automatically"). Not needed for this slice — it's Slice 4 — just don't design
  anything that infers it.
- Context worth knowing: Fred uses stamps two ways — raised/carved relief AND resin inlay (carve a recess, fill resin,
  machine flush against the original uncarved STEP). Inlay is why Outline must be exact.

## Do exactly your design's Slice 1
New pure module `editor/editor-expand-analytic.js`: `line → outline path d` for a round-cap stroke = 2 straight banks
+ 2 TRUE half-circle `A` arcs (Fred: "straight lines need to be just straight lines and arcs true arcs" — no
sampling, no cubics). Declare the cap kinds it supports as data (round now; butt/square listed as not-yet so a caller
gets a clear decline, not a wrong shape). Degenerate (zero-length line) → a full circle as two `A` arcs. Works in the
element's local frame; world transforms are the bake's job (Slice 0).

## Verify
- vitest: horizontal, vertical, diagonal lines → exact bank endpoints (offset = width/2 along the normal) and `A`
  arcs with r = width/2, correct sweep so the outline is a single closed CCW/CW loop (assert the signed area sign +
  magnitude = L·w + π(w/2)²); zero-length → circle; unsupported cap → explicit decline.
- CDP smoke per the design: rasterize a real generated rail's stroke vs. the function's filled outline through the
  real `rasterizeSvg` path; report the opaque-pixel diff (should be ~edge-AA only). Screenshot both.
- `npx vitest run` green.

## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T35: SE12 slice 1 — analytic round-cap outline — <sha>, vitest N, pixel diff X"`
and stop.
