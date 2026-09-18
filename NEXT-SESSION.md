# NEXT — SE4-plan: retire the P.stampLayers content mirror (C5/EDM4) — PLAN ONLY, no code

**Ball: worker (seat A) · epoch 1 · SE4-plan.** Deliverable: `SE4-MIRROR-RETIREMENT-DESIGN.md` at the repo root
(+ WORK-LOG). No product code this turn. One commit by path. main now carries SE3a (f46561a) + lane-b's T4/T5/T6.

## Why now
SE3a fixed the two visible symptoms, but its own diff documents the tangle it had to work around: the compositor
reads `layer._mask || P.stampLayers[idx].mask` (rebuild.js `_collectStampPasses`), so every mask write and every
clear has to hit BOTH stores; `onChange` writes `P.editorSvg` AND mirrors it into `P.stampLayers[active].svg`; the
legacy fallback in `updateStampMasks` resurrects a mirror whenever no editor layer covers an index; hidden-layer
handling exists only to stop that resurrection. ROADMAP:114 (C5/EDM4) and AUDIT-2026-09.md A4 already mapped it:
`core/state.js` is the only writer that reshapes `P.stampLayers`. Two content stores is the root; SE3a's invariant
is the last patch we should have to write against it.

## Write the plan (ownership-vs-sharing gate, removal-chain gate — both from the advisor skill)
1. **Inventory every reader and writer** of `P.stampLayers[i].svg` and `.mask` (grep `stampLayers` under
   `b-spline-gen/html/` — core/, main/, editor/, tests/). Table: file:line · reads/writes · which field · what it
   needs it for · survives-or-dies.
2. **Classify what stays on `P.stampLayers`.** The per-layer TOOLING (depth, profile, v-bit angle, enabled, name) is
   legitimately P's — that is what the sidebar edits and what saved projects carry. Only the CONTENT mirror
   (`.svg`) and the derived `.mask` are the duplicate. Say so explicitly and list the fields that remain.
3. **Single-store proposal:** `P.editorSvg` is the document; the editor layers (`editor._layers[i]`, with
   `_mask`) are the runtime view; `_collectStampPasses` reads ONLY `layer._mask`; `updateStampMasks` drops the
   legacy branch; the "Browse…" upload path (svg-source.js) must then load the file INTO the editor document
   (one declared entry: `importSvgIntoLayer(idx, svgText)`) instead of writing `P.stampLayers[idx].svg`. Check
   the project save/load (`cloud-project-manager.js` / `persistableP`) and `loadLastSession`: old saves carrying
   `stampLayers[i].svg` need a one-time migration into `editorSvg` — declare it as data (a `MIGRATIONS` list or the
   existing `editorRestoreSvg` fallback made explicit), not an ad-hoc branch.
4. **Removal chain**, per the advisor rule: every link named — reader/writer removed, or kept with a named reason.
   Include the tests that guard the mirror today (`persistable-p.test.js`, `history-snapshot.test.js`,
   `stamp-mask-clear.test.js`, `b6-hidden-layer-save.test.js`) and say which assertions change.
5. **Slices** (each independently shippable, each with its verify): suggested (a) compositor reads one store +
   Browse imports into the editor, (b) drop the legacy branch + mirror writes, (c) migration + persistence cleanup +
   test updates. Predicted files per slice. Risks: hidden layers, reopen (RO1), multi-layer projects from the cloud.

## Verify
- The doc exists, has the 5 sections, the inventory table is complete (grep count of `stampLayers` matches the
  rows), and each slice has a verify line. `git show --stat HEAD` → 2 files.

## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE4-plan: mirror-retirement design — <sha>; N readers/writers, 3 slices"`
and stop.
