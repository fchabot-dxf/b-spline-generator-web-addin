# NEXT — SE8d: rotated/scaled text carves as drawn; two dead leftovers in editor.js

**Ball: worker (seat A) · epoch 1 · SE8d.** SE7s accepted + merged with seat B's SE7b slices 1–2 and SE8c part 1
(main 215 tests). Seat B is on SE7b slice 3: `editor/editor-interaction.js` (handleEnd detach hook), the pattern panel
(palette HTML + NEW panel module), `editor/editor-lattice-pattern.js` — do NOT touch those. Files for you:
`editor/editor-io.js`, `editor/editor.js`, maybe `editor/editor-coords.js`, tests (+ WORK-LOG). One commit by path.

## 1. SA-ROUNDTRIP-2 (HIGH) — read the audit section
A rotated or non-uniformly scaled `<text>` carves upright at the wrong size (`editor-io.js:194-202` `_carveTextAnchor`
bakes only the anchor + font-size × |a|). Fix it where the carve actually happens:
- If the rasterizer path (stamp preview) renders the transformed SVG itself, the preview is already right — confirm
  and say so; the defect is only the Fusion bake.
- For the Fusion bake: keep the text's transform as a matrix on the `<text>` (rotation/skew preserved) with the carve
  matrix composed in, OR convert to paths via the existing Expand pipeline before baking — pick the one that keeps
  glyph orientation correct, justify in WORK-LOG, and note what Fusion's SVG importer does with a transform on text
  (the importer ignores transforms per `carveMatrix`'s own comment — if so, only path conversion is correct).
- Test: a text rotated 30° → baked output's glyph baseline direction is 30° (or: output is paths whose bbox matches
  the rotated original's world bbox within tolerance).
## 2. SA-DEAD-2 leftover — `updateNodeCountUI` wiring in `editor.js` (seat B removed everything else; see
`WORK-LOG-lane-b.md` T20) — remove the instance wiring + any stale state.
## 3. `setStrokeColor` has zero callers anywhere (your own SE8a flag) — remove it (chain: method → any binding → test),
or name the caller if one appears.
## Verify
`npx vitest run` → 215 + new, green. Greps: `updateNodeCountUI` → 0, `setStrokeColor` → 0 (or named survivor).
## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE8d: rotated text carves correctly (<approach>), dead leftovers removed — <sha>, N files, vitest N"`
and stop.
