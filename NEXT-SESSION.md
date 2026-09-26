# NEXT — UI3: collapsible sections in the lattice panels (like the main sidebar)

**Ball: worker (seat A) · epoch 2 · UI3.** NO FUSION. FB-ORDER verified live by the advisor (scratch doc) — accepted.
Fred: "like in main side bar, make lattice section collapsible".
- Every section of the Lattice and Shape Lattice panels (the ones UI2's decorator tags with data-lattice-section)
  gets a clickable header that collapses/expands its body, using the SAME look + behaviour as the main sidebar's
  collapsible sections (find that component/CSS and REUSE it — one declared collapsible pattern, not a second one).
- The pinned Generate stays pinned and never collapses; the Layers block in the side column is collapsible too.
- Collapsed state remembered per section (same mechanism the main sidebar uses, if it persists; else localStorage,
  wrapped in try/catch) and restored on reopen.
- Desktop side column AND the mobile drawer.
- Still NO edits to bspline_gen_palette.html (seat B edits that markup in lane-b: T74 merges the Contour/Border
  sections and removes Pick shape — your decorator must tag by title, so a new 'Contour' section just works).
Tests for the collapse state + persistence; screenshots desktop + mobile with a couple collapsed. Commit by path, push,
then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "UI3 — <sha>"`.
