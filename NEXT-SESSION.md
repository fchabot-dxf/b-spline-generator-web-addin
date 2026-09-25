# NEXT — MOB3: one bottom DRAWER for tool options + layers on phones (Fred)

**Ball: worker (seat A) · epoch 2 · MOB3.** NO FUSION — browser proof only. Seat B is on T49 (SE13 Boundary panel UI
+ ending rules) in lane-b and ADDS controls to #editorLatticePanel — coordinate: build the drawer as a CONTAINER
that hosts the existing panels' DOM, so seat B's new rows land inside it without rework.

## Fred (on his phone, live site): "I can't see the panels — we need to revisit the UI in these tools, maybe a drawer?"
Advisor's live 390x844 screenshot (after Generate): the Lattice panel is collapsed to its title + Regenerate/Detach;
Add Rail/Tie/Node and every setting are hidden behind a tiny ▾; the Layers panel sits in between; no obvious way in.
Screenshot: C:\Users\danse\AppData\Local\Temp\claude\c--Users-danse-APPS-b-spline-generator-web-addin\3e3f0b14-6c58-4c85-afb5-23d3fcfd5c2e\scratchpad\mob-before-drawer.png

## Design (advisor, Fred to react on screenshots)
Under the existing narrow/coarse breakpoint ONLY (desktop untouched):
- ONE bottom drawer, three snap heights declared as data: peek (~96px: tabs + essentials row), half (~50vh), full
  (~88vh). Drag the handle to snap (touch + mouse), tap the handle to cycle. Canvas keeps the rest of the height;
  the undo pill and status line sit above the drawer, never under it.
- Tabs: [<active tool's options>] [Layers]. Declare a TOOL_PANELS table (tool mode → panel element + label +
  peek-row controls). Lattice's peek row = Add: Rail/Tie/Node + Generate/Regenerate. Tools with no options → the
  tab shows Layers only.
- Inside a tab at half/full: the panel's sections become collapsible (Boundary, Grid & rails, Ties, Nodes, Colors,
  Widths, Seed) — remember open/closed per section (localStorage, try/catch).
- Drawer height persisted per session; opening the Lattice tool opens the drawer at peek.
- Header: the Download/Clear buttons move into an overflow ⋯ so Cancel + Apply always fit (MOB2 kept Apply visible;
  keep that).
Remove the old mobile-only collapse ▾ and the separate stacked Layers block on phones (no dead CSS/JS).
## Verify
CDP 390x844 and 768x1024: screenshots at peek / half / full for Lattice and for a tool with no options; assert Add
buttons + Generate visible at peek, every Lattice control reachable at full, Layers tab rows tappable, canvas area
≥ 55% of viewport at peek, drag handle works with touch events; desktop 1400x900 unchanged (pixel diff of the editor
chrome). `npx vitest run` green.
## When done
Append WORK-LOG.md, commit by path, push, then
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "MOB3: bottom drawer — <sha>, screenshots"`
and stop.
