# NEXT (fb-app) — F15: FORMULA-FIELDS for the remaining numeric fields (stamp transforms, sculpt hardness, Frame bottom)

**Ball: worker (seat C) · epoch 1 · F15.** F14 ACCEPTED + merged (6cb16a8). FB-APP S0–S8 are ALL DONE. You now take items
from the regular add-in queue that don't collide with seat A (seat A = H1 SNAP-SPLIT: drag/snap paths + the toolbar;
then SEG-COLOR-PANEL in lattice-piece-panel.js). NO FUSION. **Deploy rule (incident today): to put main into Fusion,
ONLY deploy from a clean scratch worktree at origin/main, never from the main checkout (it holds seat A's WIP).**
PROGRESS automatic ("F15 item N: …"); shots -> shots\seatC\ as items land; push each item.

Context: the Asus R1/R2/R5 FORMULA-FIELDS (core/formula.js, core/formula-field.js, main/formula-fields.js; declared
scopes; min/max clamp; autocomplete dropdown) cover P-bound sidebar fields + both lattice panels + per-piece width. Its R2
note (WORK-LOG-reg-addin.md ~l.30) lists what's left:

## Checklist
- [ ] [F15-item-1] Stamp layer transform fields stampTx/Ty/Rotation/Scale: they're written to the active layer by
      bindLayerOnlyNumber (main/stamp/_dom-binders.js), not bind()/applyParam. Attach formula fields through THAT binder
      with a declared per-layer scope (e.g. width, height, the layer's own current values); one attach path, not a copy.
- [ ] [F15-item-2] sculptTopHardness / sculptBotHardness: find their real write path first (state the file:line), then attach.
- [ ] [F15-item-3] Frame section: frameBottomZ + Frame thickness get formula fields like Trim offset (scope: widthIn,
      heightIn, the frame params).
- [ ] [F15-item-4] Tests (each field: a formula evaluates, clamps, a bad formula keeps the old value, the autocomplete
      lists the declared names) + shots.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F15 — <shas>"`.
