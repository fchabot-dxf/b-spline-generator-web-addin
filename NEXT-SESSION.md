# NEXT — UI5 (FINAL seat A turn): the per-piece override PANEL UI

**Ball: worker (seat A) · epoch 2 · UI5 panel.** Item 5 + its generalization ACCEPTED (45eaf12, d25da3e); the items 1-4
foundation is accepted (5ed5468). NO FUSION. THIS IS SEAT A'S LAST TASK: Fred now works on the regular add-in himself
from his other machine (HANDOFF-REG-ADDIN.md). The Asus loop is WAITING on you to finish properties-lattice.js /
properties-shape-lattice.js, so keep this turn tight and push as soon as it's green. PROGRESS automatic ("UI5 item N: …").

## Checklist
- [ ] [UI5-item-1] Selecting a rail/tie/node piece (lattice Select icon) shows its COLOUR + WIDTH in the properties, each
      with an override control; clearing an override returns the piece to its kind's colour / the lattice width.
      Use the 5ed5468 schema module; no second source.
- [ ] [UI5-item-3] Undo restores overrides that Regenerate cleared (Regenerate-clears already landed).
- [ ] [UI5-item-4] Tests (override one piece -> only it changes; regenerate clears; undo restores; export carries the
      attrs) + desktop + mobile screenshots of the property panel -> shots\seatA\.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "UI5 panel — <shas>"`.
After the advisor accepts, the advisor closes your loop: don't start anything else.
