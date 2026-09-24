# NEXT (lane-b) — T37: SE12 Slice 3 — outline preview in the editor, commit-only

**Ball: worker (seat B) · epoch 2 · T37.** NO FUSION (hard rule) — browser proof only. Seat A is mid-SE7h in the main
checkout and touches editor.js / editor-interaction.js / lattice files / the palette html — keep your editor.js change
small and self-contained (one import + one call at the commit hook) so the merge stays clean.

T36 reviewed — good (one field, table-driven, 541 green). It isn't on main yet only because seat A's working tree
blocks the fast-forward; I'll merge both after seat A passes. Keep building on lane-b.

## Do your design's Slice 3 (§ item 5 "display preview"), now keyed on the ONE field
- A non-interactive `<g id="outlinePreview">` (pointer-events:none, excluded from selection, hit-testing, save
  (getSvgString/getLayerSvg), undo snapshots and the drape — assert each).
- For every element on a layer where `showsOutline(layer)` is true and `lineOutlinePathD` supports it (round-cap
  `<line>` today; anything else = skipped, no preview, no error): draw the outline path, thin stroke, no fill, in the
  element's own color if `showsColor(layer)` else the neutral color — same rule as the element itself.
- Rebuilt on COMMIT only (the CHANGE_PIPELINE commit hook that refreshDrape uses), never on live drag frames.
- Picking Centerline (or hiding the layer) empties that layer's preview on the next commit — changing the picker counts
  as a commit.
- Outline geometry is computed in each element's local frame and the preview element gets the element's own
  transform (don't bake here).

## Verify
- vitest (pure where possible): which elements get a preview for each fusionGeometry × visible × showColor; excluded
  from getSvgString/getLayerSvg/snapshot.
- CDP: generate a lattice, pick Outline on its layer → screenshot shows thin outlines around rails/ties (nodes skipped);
  drag a rail with dispatched mouse moves and read the preview `d` mid-drag (unchanged) and after release (updated);
  pick Centerline → preview empty. Screenshots.
- `npx vitest run` green.

## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T37: SE12 slice 3 outline preview — <sha>, vitest N, screenshots: <paths>"`
and stop.
