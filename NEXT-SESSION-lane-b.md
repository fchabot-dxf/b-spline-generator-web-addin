# NEXT (lane-b) — T72: SE15c threshold + deep-waist no-lattice bug + SE14c contour checkbox

**Ball: worker (seat B) · epoch 3 · T72.** NO FUSION. T71 (8566623) is being verified live by the advisor; if it needs a
fix you get an `amend`. Three items, in this order, one commit each:
## 1. SE15c — raise SKETCH_PIECE_THRESHOLD 60 → 300 (editor-sketch-manifest.js)
Advisor MEASURED in Fusion, 16 rails / 97 pieces: plain (current) 61 s, drift 0.139" at stroke 0.5, rails visibly
tilted; constrained 90 s, 0 fails, exact parity, drift 0.030". A 14-rail hourglass (101 pieces, 170 constraints) built
with 0 constraint fails. Update the SE15 doc number + any test that pins 60.
## 2. Bug — Shape Lattice, Hourglass with waistReach 0.8 + cornerRadius 0.4 generates NO rails/ties at all
Advisor reproduced (headless, default 7x9 board, Hourglass preset, shapeParam-waistReach=0.8, shapeParam-cornerRadius=0.4,
Generate): the contour draws correctly (deep waist), the layer has 0 rail/tie/node elements, manifest has only the 12
contour segs. Find why (boundary resolution? inset polygon self-intersecting / empty? rails clipped to nothing?), fix
the root cause, and add a test with these params that asserts rails > 0.
## 3. SE14c — "Contour" checkbox in the Shape Lattice panel (Fred)
Fred: "I'd want a checkbox for the actual contour, I still want rails and ties to be contoured but sometimes don't
want the contour profile". Declared flag (e.g. contour.show, default true) + checkbox in the C1 style. OFF = the contour
is still computed and still clips/fits rails & ties exactly as now, but its segments are not drawn, not in SVG export /
Send to Fusion, and not in the manifest (no contour slots, no contour_width/height params/dims). Saved patterns without
the key read true. Parity test covers both states. Render ON and OFF to PNG and view before passing.
Pass back: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T72: SE15c + deep-waist fix + SE14c — <shas>, tests"`.
SE14b (contour segments selectable/colourable) is the task after this.
