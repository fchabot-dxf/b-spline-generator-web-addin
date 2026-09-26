# NEXT — UI5: per-piece colour + width overrides in the lattice Select tool

**Ball: worker (seat A) · epoch 2 · UI5.** NO FUSION. UI4 accepted (items 0,0c,1,2,6,7 landed; 0b could not be reproduced —
kept open until Fred gives exact steps). Spec = UI3 AMEND 3 (Fred: overrides do NOT survive Regenerate, no warning;
override width gets NO Fusion param — seat B's T75 item 3 reads your attributes). PROGRESS is automatic: start each
work-commit subject with the item's tag words (e.g. "UI5 item 2: …").

## Checklist
- [ ] [UI5-item-1] Selecting a rail/tie/node/contour piece (lattice Select icon) shows its COLOUR + WIDTH in the properties,
      with an override control for each; clearing the override returns it to the kind's colour / lattice width.
- [ ] [UI5-item-2] Declared data schema on the piece: data-override-color / data-override-width (ONE schema module), rendered
      live (stroke colour/width); exported in SVG / Send to Fusion payload as-is. Tell seat B the exact names if you
      deviate from these.
- [ ] [UI5-item-3] Regenerate clears all overrides on that layer; Undo restores them.
- [ ] [UI5-item-4] Tests (override one piece -> only it changes; regenerate clears; undo restores; export carries attrs);
      desktop + mobile screenshots of the property panel.
Commit by path, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "UI5 — <shas>"`.
