# NEXT (lane-b) — T41: text outline does NOT match the drawn text — find why, make them agree

**Ball: worker (seat B) · epoch 2 · T41.** NO FUSION for workers — browser proof only. T40 part 2 NOT merged yet —
held on this finding (main auto-deploys to Cloudflare).

## Finding (advisor, from YOUR t40-text-word.png)
The outline of "Fred" doesn't sit on the black glyphs: "F" outline is wider (x 180→375 vs glyph 180→330), "e" outline
is shifted right (545→740 vs 505→660), "d" 770→950 vs 790→920. So `textGlyphPathD`'s opentype glyphs use a different
FONT and/or SIZE/letter-spacing than the browser renders for that `<text>`. Your test didn't catch it because it
compared the outline against the opentype path, not against what's on screen.

## Why it matters beyond the preview
The CARVE and export also use the opentype glyph path (stamp pipeline). If that differs from the drawn `<text>`, the
carved text ≠ what Fred sees in the editor — a real, pre-existing product bug, not just a preview one. Find out which.

## Do
1. Measure, don't reason: for the same `<text>` element compare its browser bbox (getBBox / per-glyph via
   getExtentOfChar / getStartPositionOfChar) against the opentype glyph path's bbox and per-glyph advance.
   Record font-family resolved by the browser (getComputedStyle) vs the font file opentype actually parsed.
2. Root-cause it (likely suspects: font fallback — the element's family isn't one of the bundled fonts so opentype
   falls back to a different face; font-size units (px vs in, the editor's inch viewBox); letter-spacing /
   text-anchor / dominant-baseline not applied in the opentype layout; kerning).
3. Fix at the source so ONE declared truth drives both: either the editor renders text FROM the same glyph path
   (what gets carved is what's shown), or the opentype layout honors the same family/size/spacing/anchor. Recommend
   in WORK-LOG which you chose and why; prefer "display what gets carved".
4. Test: for several words/fonts/sizes/anchors, glyph-path bbox == rendered bbox within 0.01" and per-glyph x within
   0.01". CDP screenshot: outline sits exactly on the letters.

## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T41: text glyph path matches rendered text — <sha>, root cause: <x>, vitest N, screenshot"`
and stop.
