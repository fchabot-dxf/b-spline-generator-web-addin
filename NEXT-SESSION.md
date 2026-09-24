# NEXT — SE11f: 3D off + color on = paint the relief without carving it (Fred)

**Ball: worker (seat A) · epoch 2 · SE11f.** Small turn. Advisor's live Fusion test: red L, layer 3D off, palette on → no
carve (correct) but NO paint on the model (wrong for Fred: "I want to see color even if flat"). Seat B is on the sidebar
layer layout (`editor/layers.js` compact row, palette VECTOR STAMPING region, `styles/editor.css`) — not yours.
Files: `core/preview/drape-svg.js`, `tests/drape-svg.test.js` (+ WORK-LOG). One commit by path.
## New rule (Fred, final)
| 3D (carve) | palette (showColor) | on the model |
|---|---|---|
| on | on | carved + painted |
| on | off | carved, plain |
| off | on | painted on the surface, NOT carved |
| off | off | nothing |
(all only when 👁 visible). So the drape condition is `showsColor(l)` (visible && showColor — already declared in
`editor/layers.js`), no longer `isCarved(l) && showColor`. Carving stays `isCarved(l)`. Change `buildDrapeSvg` to use
`showsColor`, update the truth-table test to the table above.
## Verify
`npx vitest run` green. Live in Fusion (bridge up): the advisor's test — red L, 3D off, palette on, Apply → red painted on
the uncarved relief, no groove. Screenshot path in the pass note.
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE11f: drape = showsColor (paint without carve) — <sha>, vitest N, screenshot: <path>"`
and stop.
