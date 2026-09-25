# NEXT — MOB4: landscape side-by-side + double-tap the handle (Fred)

**Ball: worker (seat A) · epoch 2 · MOB4.** NO FUSION — browser proof with REAL touch events. MOB5 merged (advisor
re-checked: two-finger slide 100px → view moved 1.79", zoom unchanged; the compact 3-column Nodes/Colors/Widths rows
look right at 390x844).

## Do (ROADMAP "Queued — MOB4", authoritative)
1. Phone LANDSCAPE (coarse pointer, height ≤ ~500px): editor AND main screen go side-by-side — canvas/preview left,
   the tool panel/sidebar right (scrolls), a VERTICAL splitter between them (same makeSplitter, axis 'x', its own
   persisted width). Fred's real landscape screenshot for reference (the 3-column squeeze this replaces):
   C:\Users\danse\AppData\Local\Temp\claude\c--Users-danse-APPS-b-spline-generator-web-addin\3e3f0b14-6c58-4c85-afb5-23d3fcfd5c2e\scratchpad\fred-landscape-layerchip.png
   The Layers panel becomes the drawer's second tab here too (no separate third column).
2. DOUBLE-TAP the handle (either orientation): jump canvas-max ↔ settings-max; single tap keeps its cycle.
Rotation between portrait and landscape keeps each layout's own remembered split.
## Verify
CDP 844x390 and 915x412 (touch): screenshots of editor + main screen, splitter drag works, panel scrolls (real swipe
→ scrollTop changes), double-tap jumps; portrait unchanged; desktop unchanged. `npx vitest run` green.
## When done
Append WORK-LOG.md, commit by path, push, then
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "MOB4: landscape + double-tap — <sha>, screenshots"`
and stop.
