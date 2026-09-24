# NEXT (lane-b) — T36: SE12 Slice 2 (revised) — ONE per-layer field `fusionGeometry`, picked in the sidebar

**Ball: worker (seat B) · epoch 2 · T36.** NO FUSION (hard rule) — browser proof only. Seat A is on SE7h in the main
checkout (lattice files + Pattern panel markup); don't touch those.

## Advisor revision to your design's Slice 2 (read before building)
Fred: "Don't choose automatically" → the user picks Outline / Centerline / Both per layer. Your design had TWO fields
(`outline:boolean` + `fusionGeometry`, the latter "meaningless while outline:false"). That's one concept stored twice —
`outline:false` IS `'centerline'`. **Declare ONE field**: `fusionGeometry: 'centerline' | 'outline' | 'both'`, default
`'centerline'` (= today, so no migration: applyToolingDefaults fills it). Derive the old gate from it:
`showsOutline(l) = isExported(l) && l.fusionGeometry !== 'centerline'` (next to isCarved/showsColor in layers.js).
Declare the choices as data (a FUSION_GEOMETRY table: value, label, one-line hint) so the picker renders from it.

## UI placement — NOT a 4th row toggle
The layer row already has 👁 · 3D · 🎨 and Fred just asked for them to be clearer; don't crowd it. Put the picker in the
sidebar's per-layer settings block ("Settings below apply to the selected layer." — Plunge Depth / Tool Profile,
bspline_gen_palette.html ~line 616) as a 3-way segmented control "Fusion geometry: Centerline · Outline · Both",
wired like the other per-layer tooling fields (same load/save/undo path as plunge depth — one undo step per change).
Hints (from the table): Centerline = "the line's path — V-bit / engraving"; Outline = "the stroke's true edge — pockets
& resin inlay"; Both.
Nothing else reads the field yet (preview = Slice 3, export swap = Slice 4) — say so in its doc comment.

## Verify
- vitest: new layer → 'centerline'; old saved layer without the field → 'centerline'; showsOutline truth table incl.
  hidden layer; picker change persists through save/restore and is one undo step.
- CDP screenshot of the sidebar block with the control, one per value selected.
- `npx vitest run` green.

## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T36: fusionGeometry per-layer field + sidebar picker — <sha>, vitest N, screenshots: <paths>"`
and stop.
