# NEXT — UI4: pinned-action style fix + per-piece overrides in the lattice Select tool

**Ball: worker (seat A) · epoch 2 · UI4.** NO FUSION. UI3 (3fd41f9) accepted. Specs are UI3's AMEND 4/4b and AMEND 3
(read them in `handoff.py amendments` history / WORK-LOG). PROGRESS: tick each box (`- [x]`) in THIS file as you commit
that item, and push — the progress page (bspline-status.pages.dev) counts the ticks.

## Checklist
- [x] 1. Pinned-action style (AMEND 4b): ONE shared sticky style for the main sidebar "Generate New Seed" and both lattice
      Regenerates — top:0 with NO gap above (nothing visible above while scrolling), opaque background full column width,
      full-width button. Root-cause the gap, note it in WORK-LOG.
- [x] 2. Screenshots of all three scrolled mid-list, desktop + ~1024px (iPad) — viewed before ticking.
- [ ] 3. Per-piece overrides (AMEND 3): selected rail/tie/node/contour piece shows COLOUR + WIDTH with an override; stored as
      declared data (data-override-color / data-override-width, one schema), rendered live.
- [ ] 4. Regenerate clears overrides (no warning — Fred); Undo restores them.
- [ ] 5. Tests for 1, 3, 4; full suite green; WORK-LOG entry.
- [ ] 6. BUG (Fred, live): a layer added from the MAIN sidebar (Vector Stamping → Layers +, e.g. "Layer 2") does NOT exist
      in the editor when it opens — the editor shows only Layer 1. Reproduce headless, root-cause (the editor rebuilding
      layers from saved artwork and dropping an EMPTY layer? two layer lists not sharing one source?) and fix by ONE
      declared layer list both surfaces read. Test: add in main → open editor → both layers present, same order/active.
- [ ] 7. The side-column Layers row truncates the name ("Lay…") next to its eye/3D/palette buttons — let the name use the
      available width (buttons compact / name min-width), same fix in the mobile drawer.
Commit by path, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "UI4 — <shas>"`.
