# LANE B — T28: the COLOR control becomes a dropdown mosaic with more colors (Fred)

**Seat B · epoch 2 · T28.** lane-b merged with main (f78b32e + SE11c — drape verified live in Fusion). Fred: "add more
colors and make it a drop down mosaic". Seat A is on SE11d (`core/preview/drape-svg.js` + its tests) — not yours.
Files: `editor/properties-shape.js` (SE9's color binding), the palette's editor TOOLBAR row (the COLOR group only),
`styles/editor.css`, tests (+ WORK-LOG-lane-b.md). One commit by path.
## Build (mockup agreed in the advisor's chat)
- `VECTOR_COLORS` becomes the declared palette: 8 hues × 4 shades = 32 swatches (keep black #000000, red #c62828,
  yellow #f9c80e, navy #1a237e among them — Fred's piece); declare as rows so the mosaic lays out from the data.
- The toolbar shows ONE button with the current color + ▾. Click/tap opens a popover: the 8×4 mosaic, a "recent" row
  (last 4 picked this session, per-viewer localStorage wrapped in try/catch), and "custom…" opening the existing
  `<input type="color">`. Picking closes the popover and calls the existing `editor.setColor` (one undo step — SE9).
- Keyboard: arrow keys move in the grid, Enter picks, Esc closes; focus returns to the button. Touch: 44 px cells on
  coarse pointers; the popover stays inside the viewport at 390 px (flip above/left if needed). Clicking outside closes.
- Remove the old inline swatch row + its wiring (removal chain in WORK-LOG).
## Verify
Tests: mosaic renders 32 cells from the declared rows; picking a cell calls setColor with that hex; recent list order +
cap of 4. Smoke (repo-root serve): desktop + mobile screenshots with the popover open. `npx vitest run` green.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T28: color dropdown mosaic (32 + recent + custom) — <sha>, vitest N, screenshots: <paths>"`
and stop.
