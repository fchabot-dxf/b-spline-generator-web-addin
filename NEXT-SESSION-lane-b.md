# LANE B — T24: SE7p — the Pattern panel on a phone, three panel defects, and whether pinch really zooms

**Seat B · epoch 2 · T24.** First task for this seat after the reboot. Worktree, branch `lane-b` (merged with main —
includes `scripts/smoke-editor.mjs`). Files: `bspline_gen_palette.html` (the `#editorLatticePanel` region only),
`styles/editor.css`, `editor/properties-lattice.js`, `editor/editor-input.js`, `editor/editor-interaction.js` (pointer
path only), tests (+ WORK-LOG-lane-b.md). **Seat A is on SE7c in `editor/editor-lattice.js` +
`editor/editor-lattice-pattern.js` — do not touch those.** One commit by path.

## Ground truth — ROADMAP "Live browser test 2026-09-24"; reproduce with:
`node scripts/smoke-editor.mjs <outDir> mobile` (headless Chrome, 390×844, touch emulation; prints a JSON report and
writes `mobile-1-editor.png`, `mobile-2-generated.png`, `mobile-3-pinched.png`). Against a local build: serve the html
folder (`npx http-server bspline-frame-builder/b-spline-gen/html -p 8765`) and pass `http://localhost:8765/bspline_gen_palette.html`
as the 3rd arg (check which entry file the site serves).
1. **At 390 px the Pattern panel takes the full width; the canvas is off-screen.** On narrow/coarse screens the panel
   must not displace the canvas: a collapsible bottom sheet (header "Lattice pattern ▾" + Generate always visible) or
   an overlay toggled from the Lattice tool — pick one, justify, no hover-only affordance.
2. **Nodes checkboxes overlap their labels** (desktop too) — proper label/checkbox rows (`<label>` wrapping both).
3. **Regenerate button text invisible** (white on white — its background var is unset in that context) — use a
   defined token / the same style as Apply Stencils.
4. **Reroll button clipped** next to the Seed field.
5. **Pinch:** the smoke run's two-finger spread (CDP `Input.dispatchTouchEvent`, touch emulation on) left
   `svgEditor._view.zoom` at 1. Find out whether real touches would zoom: are pointer events generated for CDP touch
   input (log `pointerType`), is the pointer map getting both ids, does `touch-action` on `#editorSVGContainer` let the
   events through? If it's a real bug, fix it; if it's only the emulation, change the smoke script to drive it the way
   that DOES produce pointer events and prove zoom > 1. Either way the script ends up proving pinch.
## Verify
Smoke script at 390 px: canvas visible with the panel collapsed and expanded, labels clean, Regenerate readable, zoom > 1
after pinch — attach the screenshot paths in WORK-LOG. `npx vitest run` green (rerun once if the whole suite reports
"no tests").
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T24: SE7p — panel sheet on phones, labels, Regenerate, reroll, pinch <real bug|emulation> — <sha>, screenshots: <paths>"`
and stop.
