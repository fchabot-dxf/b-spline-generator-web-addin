# NEXT (lane-b) — T55: SE14 shape presets = HOURGLASS (frame-builder Template 1) + BOTTLE (Template 2)

**Ball: worker (seat B) · epoch 2 · T55.** NO FUSION for workers. T54 paused work merged (seed hashing, straight
base, sizing kept).

## Fred
- Disliked every bust/silhouette output: "I'd prefer a simpler hourglass shape — look in the sketch builder add-in".
- Advisor rendered frame-builder Template 1's SEED layout (pre-solve) → Fred: "Yes I like it but the middle arc is
  going outward" → the waist must pinch INWARD (the true Template 1). Then: "Also include the bottle silhouette".
- Seed render (joints NOT yet tangent — that's the solver's job, yours now):
  C:\Users\danse\AppData\Local\Temp\claude\c--Users-danse-APPS-b-spline-generator-web-addin\3e3f0b14-6c58-4c85-afb5-23d3fcfd5c2e\scratchpad\fred-hourglass-seed-render.png
  (renderer: scratchpad\fbshape.mjs)

## Source recipes (read them; cite)
`bspline-frame-builder/frame-builder/sketches/template_1/phases/p02_*.py` — HOURGLASS: straight top/bottom at ±H/2,
vertical corner "horns" to y=±0.183H, per side: convex shoulder arc → CONCAVE waist arc (deepest x≈0.315W at y=0) →
convex hip arc, all G1-tangent (p02_07/p02_08), arc centres pinned on horizontal skeleton lines (shoulder y=+0.150H,
waist y=0, hip y=−0.151H, x=±0.35W), mirrored. `template_2/phases/p02_*.py` — BOTTLE: full-width straight body,
convex hip→concave neck S-curve at ~0.13–0.27H, narrow straight neck (±0.295W) to a narrow top.

## Do
REPLACE the bust generator's keypoint/bulge model with a declared PRESET table {hourglass, bottle}, each preset =
an ordered list of side segments with parameters, solved ANALYTICALLY so every joint is exactly tangent (no Fusion
solver: compute arc centres/radii from tangency to the neighbouring line/arc — closed form), mirrored L/R, straight
top and base. Output L + circular A only (existing contract: primitives / ordinary path).
- Hourglass params: waist depth, waist height (centre y), notch height (shoulder→hip span), horn length,
  corner-arc radius. Defaults = Template 1 proportions scaled to the region.
- Bottle params: body width, neck width, shoulder height, S-curve tightness, top width. Defaults = Template 2.
- Per-segment style (straight | curve | kink) stays as an override per side segment (Fred's ask); 'curve' = the
  preset's own arc, 'straight' = chord, 'kink' = sharp point at the arc's apex.
- Seed: optional small variation of the params (±declared range) so 🎲 still gives variety — default ON but gentle.
Tests: tangency at every joint (unit-tangent dot ≥ 1−1e-9), waist apex is the minimum half-width (inward!), exact
mirror, L/A only, both presets across 3 region aspect ratios. Render both presets (3 seeds each, 7x9 and 7x4) with
your own copy of fbshape.mjs-style renderer and VIEW them before passing.
Then continue to SE14 slice 3 (the tool + panel) ONLY if this lands cleanly in the same turn; otherwise pass.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T55: hourglass + bottle presets — <sha>, vitest N, renders: <pngs>"`
and stop.
