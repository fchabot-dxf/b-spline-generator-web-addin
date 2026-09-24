# LANE B — T24 (resumed): SE7p — the Pattern panel must not crush the canvas on a phone (Fred: "finish lattice too")

**Seat B · epoch 2 · T24.** You already started this after T25 (7252c7d, merged into main as 8a53565). Your own
root cause: no responsive rule targets `.editor-lattice-panel`, so at ≤720 px its content height starves the canvas's
`flex:1` — `#editorSVGContainer` collapses to ~1.5×2 px, which is ALSO why pinch fails with the panel open.
Files: `bspline_gen_palette.html` (`#editorLatticePanel` region only), `styles/editor.css`, `editor/properties-lattice.js`,
tests (+ WORK-LOG-lane-b.md). Seat A is idle — no overlap. One commit by path.
## Do
1. The panel on narrow/coarse screens: your drafted bottom sheet (header "Lattice pattern ▾" + Generate always visible,
   collapsed by default on a phone), canvas keeps its space either way. No hover-only affordance.
2. Nodes checkboxes overlap their labels (desktop too) → `<label>` rows.
3. Regenerate text invisible (white on white) → defined token / same style as Apply Stencils.
4. Reroll button clipped next to Seed.
## Verify (serve from the REPO ROOT — your own T25 finding)
`node scripts/smoke-editor.mjs <out> mobile <repo-root URL to the palette>` → canvas visible with the sheet collapsed AND
expanded; `pinchWithPatternPanelOpen` now zooms (> 1); labels clean; Regenerate readable. Also a desktop run: panel
unchanged apart from items 2–4. Screenshot paths in WORK-LOG. `npx vitest run` green.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T24: SE7p — pattern sheet on phones, labels, Regenerate, reroll; pinch with panel open = N — <sha>, screenshots: <paths>"`
and stop.
