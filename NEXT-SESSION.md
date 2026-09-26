# NEXT — MOB6: scrolling a panel full of sliders must not change values (mobile)

**Ball: worker (seat A) · epoch 2 · MOB6.** NO FUSION. Seat B is on lane-b (T72) — don't touch lattice/shape logic.
Fred (phone, live site): "On UI where there is a lot of sliders I can't scroll without changing params inadvertently"
(screenshot: Shape Lattice panel, neck width / body width / S-curve tightness sliders spanning the panel width; also the
main palette's Seed section: Region Scale, Offset X/Y, Rotation, Peak Shape...).
Fix app-wide, declared once (a shared CSS rule / one helper), not per slider:
1. Every `input[type=range]` in the palette + editor panels: `touch-action: pan-y` so a VERTICAL swipe scrolls the
   panel and only a horizontal drag moves the thumb. (styles/editor.css:595 already uses pan-y somewhere — reuse the
   pattern; base.css SA-MOBILE-13 explains why touch-action:none left html/body.)
2. A tap-to-jump guard: a touch that starts on the track and moves mostly vertically (> ~8px vertical before ~8px
   horizontal) must not change the value (Chrome Android can commit a value on touchstart; if pan-y alone doesn't stop
   it, intercept: record the start value on pointerdown and restore it if the gesture resolved as a scroll).
3. Keep desktop mouse behaviour unchanged.
Verify in headless Chrome with mobile emulation (touch enabled, 390x844): a synthetic vertical touch swipe starting ON a
slider scrolls the panel and leaves every slider value unchanged; a horizontal drag still changes it. Screenshot before/
after. Add a unit/DOM test for the guard if feasible. Commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "MOB6: slider scroll guard — <sha>"`.
