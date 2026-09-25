# NEXT (lane-b) — T43: SE12 Slice 4 — the Fusion export USES the layer's Fusion Geometry pick

**Ball: worker (seat B) · epoch 2 · T43.** NO FUSION for workers — browser proof only; the advisor does the one Fusion
import check after merge. T42 reviewed + merged (dce151f, 668 green; advisor confirmed a markup-only
`<text font-family="Courier New">` now computes "Courier New" while the UI stays Inter).

## Do (design Slice 4, keyed on the ONE field)
- `getLayerSvg` has TWO consumers: the carve mask (stamp-mask-manager.js — rasterized relief) and the Fusion export
  (export-flow.js). Only the EXPORT swaps geometry. Make it an explicit option (e.g. `getLayerSvg(editor, id, dpi,
  { geometry: 'fusion' })`), default = today's output byte-for-byte, so the carve mask is untouched.
- For each element on a layer: 'centerline' → today's element; 'outline' → the OUTLINE_KINDS path (same engine as the
  preview — ONE function produces both, never a second copy), stroke-only, no fill; 'both' → both. An element whose
  kind declines (`unsupported`) exports its centerline and is reported (console warning + a count the caller can show).
- Text → its glyph outline (already exact). Async (text) must be awaited in the export path — export-flow is already
  async or make it so; don't fire-and-forget.
- The exported SVG stays in the carve/export coordinate space: run outline paths through the SAME bake (Slice 0 keeps
  A arcs exact under the similarity carve matrix — assert the output still has A commands, no C).
## Verify
- vitest: centerline byte-identical to before; outline → path with only M/L/A/Z; both → element + path; declined kind
  falls back + counted; mask path unchanged.
- CDP: a layer with lattice + rect + ellipse + text set to Outline → the export SVG string (what export-flow sends)
  saved to scratchpad as `t43-export.svg`, so the advisor can import it into Fusion.
- `npx vitest run` green.

## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T43: Fusion export honors fusionGeometry — <sha>, vitest N, export svg: <path>"`
and stop.
