# NEXT — MOB5: mobile two-finger PAN + zoom, and the oversized checkboxes

**Ball: worker (seat A) · epoch 2 · MOB5.** NO FUSION — browser proof with REAL touch events. MOB3b merged with seat
B's T59 (966 green). Advisor re-ran smoke-mob3-drawer: realTouchSwipeScrollsPanelBody true (scrollTop 0→223) — the
display:contents fix is right. Thanks for resuming after the nudge — if you ever stop mid-turn again, pass back with a
note instead of going idle.

## 1. Still broken (advisor, your own after-swipe shot): the Nodes checkboxes are OVERSIZED
C:\Users\danse\AppData\Local\Temp\claude\c--Users-danse-APPS-b-spline-generator-web-addin\3e3f0b14-6c58-4c85-afb5-23d3fcfd5c2e\scratchpad\mob3b-checkbox-still-big.png
— big blue boxes overlapping the "at tie ends / at crossings / at rail ends" labels. Normal-looking ~24px box with a
≥44px TAP TARGET (label padding), label text clear of the box. Check every checkbox in both lattice panels + Border.

## 2. Two-finger pan (ROADMAP "Queued — MOB5", authoritative)
Fred: "pan and zoom (pan should be integrated in 2-finger interaction) doesn't work well in mobile". Root cause
(advisor): editor-interaction.js two-pointer branch only zooms about the current midpoint; no translation term → a
two-finger slide does nothing. Each frame: pan by Δmidpoint (screen→model) + zoom about the new midpoint; clean
start/end. Also: one-finger drag on empty canvas in Select mode (declare pan vs marquee on touch), the main-screen 3D
preview's touch (rotate / pinch / two-finger pan), and the page never scrolls/zooms instead of the canvas.
## Verify
CDP real touch: two-finger slide pans by the swipe distance (±2px), pinch keeps the point under the fingers fixed,
combined gesture both; 3D preview touch; checkbox screenshot at 390x844 and landscape. `npx vitest run` green.
## When done
Append WORK-LOG.md, commit by path, push, then
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "MOB5: 2-finger pan + checkboxes — <sha>, screenshots"`
and stop.
