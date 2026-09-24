# LANE B — T16: mobile CSS fixes from your audit — stylesheets ONLY

**Seat B · epoch 1 · T16.** Worktree, branch `lane-b` (merged with main 898ee73 — your SE5a/b are in main now).
Files: `bspline-frame-builder/styles/base.css`, `bspline-frame-builder/styles/editor.css` (+ WORK-LOG-lane-b.md).
**No JS.** Seat A is on SE8b in `editor/*.js`. One commit by path. Findings: SA-MOBILE-13, -8, -4, -5.

## Do
1. **SA-MOBILE-13** — the site-wide `touch-action:none` (`base.css:36-45`) blocks native pinch-zoom everywhere, against
   its own WCAG 1.4.4 comment. Scope it to the surfaces that really handle their own gestures (the 3D preview canvas,
   the SVG editor canvas `#editorSVGContainer`, sliders if they need it) and leave the document zoomable. Name each
   selector you keep and why. Do NOT add JS pinch handling (that is SE7m).
2. **SA-MOBILE-8** — the per-layer delete button is `:hover`-only. Show it always under `@media (hover: none)`
   (and keep the hover reveal for mouse).
3. **SA-MOBILE-4** — resolve the two conflicting mobile breakpoints for the rail buttons to ONE rule; ≥ 44 px targets
   under `@media (pointer: coarse)`.
4. **SA-MOBILE-5** — delete the unreachable 700 px `.editor-sidebar` width rule (chain: confirm no other selector
   depends on it).
Also: hide the T10 shortcut badges under `@media (hover: none)` (no keyboard on a phone).

## Verify
Quote each changed rule before/after in WORK-LOG. `npx vitest run` still green. Grep: `touch-action` occurrences listed
with their selector. Live check on a phone is Fred's (advisor will ask).

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T16: mobile CSS — touch-action scoped, layer delete visible on touch, 44px rail, dead rule gone — <sha>"`
and stop.
