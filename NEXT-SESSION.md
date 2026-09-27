# NEXT — seat A — H15: REMOVE the seed controls + the Seed Editor (Fred doesn't use them)

**Ball: worker (seat A) · epoch 3 · H15.** H14 ACCEPTED (f14cab7). NO FUSION. Fred: "I feel like the whole seed section is redundant" /
"I know, but I don't use them". Verified by the advisor: the Seed Editor (#skel* ids, main/skeleton-editor.js, "Edit Seed fullscreen 2D")
MIRRORS the sidebar SEED section (same P keys: seedType, seed, macroScale, seedOffsetX/Y, seedRotation); only extra = its contour-lines
preview. PROGRESS: commit subjects "H15 item N: …".

THIS IS A REMOVAL: sweep the WHOLE chain; every link removed or KEPT WITH A NAMED REASON in the WORK-LOG.

## Checklist
- [ ] [H15-item-1] SURVEY FIRST (WORK-LOG, before deleting): everything the Seed Editor / main/skeleton-editor.js owns or shares: is any
      part of it used by a surviving feature (e.g. the Skeleton section's own editing, sculpt, the contour renderer)? Shared pieces stay
      (extract if tangled); the seed-editor-only UI/logic dies.
- [ ] [H15-item-2] REMOVE: the sidebar SEED section's seed controls (Seed Type, hidden Seed, Region Scale, Offset X/Y, Rotation, the Edit Seed
      button) and the Seed Editor (markup, its module's seed-only code, bindings, CSS, H14's pair entries for these, tests guarding them:
      rewrite to the new truth, never silently delete). KEEP "Generate New Seed" (top). The P keys STAY with their values (saved projects
      load identically; Generate still writes P.seed). MOVE Peak Shape + Density (not seed controls) into the Skeleton section.
- [ ] [H15-item-3] Tests: a saved project with non-default seedType/macroScale/offsets/rotation loads and renders identically; Generate New
      Seed works; no dead references (grep proves no reader of the removed ids); shots of the sidebar before/after at 390 + 834.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H15 — <shas>"`.
