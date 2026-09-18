# NEXT — SE4b: slice (b) — drop the legacy branch and the mirror writes; the sidebar Clear clears real content

**Ball: worker (seat A) · epoch 1 · SE4b.** Design: `SE4-MIRROR-RETIREMENT-DESIGN.md` §5 slice (b), approved.
Files: `main/stamp-mask-manager.js`, `core/engine/rebuild.js`, `main/app-init.js`, `main/stamp/svg-source.js`,
`core/state.js` (+ test edits, + WORK-LOG). One commit by path, predicted **5–7 files**. SE4a (aeb9a53) is merged;
main also carries lane-b's T8 (`_deselect` complete, called from open/Clear) and T9 (BUGS_OPEN B12–B15). Seat B is
in `styles/` (T10) — no overlap.

## Do exactly slice (b)
1. `updateStampMasks`: delete the legacy fallback branch; `clearEmptyLayerMasks` drops its mirror-clear half
   (becomes `layer._mask = null` alone). Update `tests/stamp-mask-clear.test.js` to single-store assertions — keep
   the HIDDEN-layer case exactly as it is (STOP condition in the design).
2. `rebuild.js`: delete the remaining legacy pass-building block (`:236-242` region).
3. `app-init.js`: remove the `setStampLayerSvg` mirror writes in onChange / Apply / Cancel (P.editorSvg stays the
   document; the remask calls stay).
4. **Sidebar Clear (`btnStampClear`, svg-source.js:73-82) = B15:** clear the ACTIVE layer's real content — remove the
   children whose `data-layer` equals the active editor layer id from `editor._sketchLayer`, then the same
   pushState + onChange the editor's own Clear does — and stop writing the mirror. Reuse `editor._deselect()`
   (T8 made it complete) before removing nodes. If the editor is not loaded, do nothing and say so in a status line
   (`setFusionStatus` or the panel's own status text — whichever that panel already uses).
5. `core/state.js`: delete `setStampLayerSvg` / `setStampLayerMask`; keep `setStampLayerEnabled`. Grep every
   caller first — the design's chain table lists them; any caller not in that table is a finding, not a silent fix.

## Verify
- `npx vitest run` → all green (count in WORK-LOG); `node --check` touched modules.
- Greps under `html/`: `setStampLayerSvg\|setStampLayerMask` → 0; `stampLayers\[.*\]\.mask` → 0 outside
  `core/state.js`'s default shape (that is slice c); `legacy` in stamp-mask-manager.js → 0.
- Live proof (sidebar Clear removes the carve AND the drawing; editor Clear still works; hidden layer keeps its
  mask) is the ADVISOR's.

## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE4b: legacy branch + mirror writes gone, sidebar Clear clears real content (B15) — <sha>, N files, vitest N"`
and stop.
