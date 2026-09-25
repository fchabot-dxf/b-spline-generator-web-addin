# NEXT — UI1 (+2 fixes first): one segmented-control style app-wide

**Ball: worker (seat A) · epoch 2 · UI1.** NO FUSION. MOB4 merged (1006 green). Advisor checked live: landscape main
screen side-by-side ✓, landscape editor side-by-side ✓, C1 row look ✓ — two defects:

## Fix first
1. **Landscape editor panel stuck in PEEK**: at 844x390 the right-hand panel shows only Add + Regenerate with empty
   white below (scratchpad\ui-landscape-peek.png). Side-by-side has room: in landscape the panel shows its FULL
   content (all sections, scrolling) — the peek/half/full heights are a portrait-drawer concept; don't apply them to
   the side column.
2. **Layer names truncate to "Lay…"** in the narrow desktop editor Layers column (~190px) because the C1 group takes
   the width (scratchpad\ui-names-truncated.png). Keep the name readable: widen that column a little (e.g. 230–240px
   if the canvas can spare it) and/or tighten the group's cells on fine pointers (desktop can use ~24px cells since
   the 40px tap rule is for touch). Target: "Layer 12" fully visible at the default desktop width.
(both screenshots in C:\Users\danse\AppData\Local\Temp\claude\c--Users-danse-APPS-b-spline-generator-web-addin\3e3f0b14-6c58-4c85-afb5-23d3fcfd5c2e\scratchpad\)

## Then UI1 (ROADMAP "Queued — UI1", authoritative)
One declared segmented component in the C1 look for every CHOICE control app-wide (toolbar Stroke/Fill/Both +
Show/Snap, Lattice + Shape Lattice choices, Fusion Geometry, Boundary/Ending, the layer row group). Actions keep
their button look. Retire old per-control variant CSS. Before/after screenshots desktop + phone (portrait +
landscape).
## When done
Append WORK-LOG.md, commit by path, push, then
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "UI1: segmented style + landscape/name fixes — <sha>, screenshots"`
and stop.
