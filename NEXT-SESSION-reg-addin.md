# NEXT (reg-addin, Asus) — R2: lockfile + FORMULA-FIELDS stage 2 (range + non-lattice fields)

**Ball: worker (reg-addin) · epoch 1 · R2.** NO FUSION. R1 (3bff20e) ACCEPTED. Plan of record = HANDOFF-REG-ADDIN.md §3 +
ROADMAP "FORMULA-FIELDS". Log = WORK-LOG-reg-addin.md. Commit subjects start with the tag ("R2 item 1: …").

## Hands off (home-PC advisor, 2026-09-26; other machines push to main)
- Seat A (UI5, NOT finished, resolving a merge): `editor-lattice-pattern.js`, `editor-ui.js`, `editor.js`,
  `editor-piece-override.js`, `tools/repro/select_drag_shape.mjs`, AND `properties-lattice.js` /
  `properties-shape-lattice.js`. Lattice-panel formulas = R3, after the home advisor says "UI5 merged".
- Seat C (fb-app F8): `core/frame-record.js`, `editor/editor-frame-profile.js`, `core/preview/frame-mesh.js`,
  `editor-shape-lattice-generator.js` (silhouette solver), `frame-builder/` (Python), FB-APP-DESIGN.md, the editor
  [Frame | Artwork] tabs, the sidebar FRAME section. `bspline_gen_palette.html`: avoid; if unavoidable, tiny + push at once.
- If you need anything above → STOP and say so in the pass-back, don't edit.

## Checklist
- [ ] [R2-item-0] LOCKFILE (home advisor assigned it to us): `npm install` to regenerate package-lock.json (expect
      @emnapi/core + @emnapi/runtime 1.11.3 added), prove `npm ci` now passes, commit ONLY package-lock.json in its OWN
      commit, pull --rebase, push. Put the sha in the pass-back note (I relay it to the home PC).
- [ ] [R2-item-1] RANGE: a committed formula result respects the field's declared min/max (the steppers' attributes) —
      clamp or reject, pick one, state which + why; plain typed numbers behave as today. Tests.
- [ ] [R2-item-2] Extend the DECLARED list (`main/formula-fields.js`) to the other generic sidebar number fields that go
      through the bind()/applyParam path — STOCK DIMENSIONS complete, plus other non-lattice, non-FRAME sections you can
      reach without the frozen files. Declaration only (a scope per section), no per-field code. Name the added fields +
      the ones you skipped and why in the WORK-LOG.
- [ ] [R2-item-3] Tests for items 1-2 + extend tools/repro/formula_field_shots.mjs to one new field; desktop + mobile
      screenshots to shots/reg-addin/.

## Gate (fast tier)
Touched/new specs + full `npx vitest run` smoke (after `npm ci`). No Fusion.

## Finish
Commit by path. `git pull --rebase`, push main (never force). From the REPO ROOT:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "R2 — <shas> (lockfile <sha>)"`.
