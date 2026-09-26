# NEXT (lane2, Asus) — L1: BOUNDARY-GUIDE (boundary = editor guide, hidden in 3D, construction geometry in Fusion)

**Ball: worker (lane2) · epoch 1 · L1.** NO FUSION. You are the SECOND Asus worker, in your OWN worktree
`C:\Users\danse\APPS\b-spline-generator-web-addin-lane2` on branch **lane2** — never edit the main checkout (worker 1
is live there). Spec = ROADMAP.md "BOUNDARY-GUIDE". Log = **WORK-LOG-lane2.md** (create it). Commit subjects
"L1 item N: …", push `origin lane2` after every item. The advisor merges lane2 → main.

## Env setup (first)
`npm ci` in this worktree. For any local server / browser check use a DIFFERENT port than worker 1 (e.g.
`python tools/serve_app.py --port 8781` or the script's own override; check its args) so the two lanes never share one.

## Hands off
- Worker 1 (R5, main): `properties-lattice.js`, `properties-shape-lattice.js`, `editor/lattice-piece-panel.js`,
  `core/formula*.js`, `main/formula-fields.js`, `tools/repro/formula_field_shots.mjs`. The "Draw boundary" TOGGLE
  REMOVAL touches properties-lattice.js → NOT this turn (L2, after R5 merges). This turn: boundary always drawn
  REGARDLESS of the toggle; leave the toggle's field in place.
- fb-app, `editor-shape-lattice-generator.js` (silhouette solver), frame files (core/frame-record.js,
  editor-frame-profile.js, frame-mesh.js, main/frame-panel.js, frame-builder/).
- Need one of these? STOP and say so in the pass-back.

## Checklist
- [ ] [L1-item-1] SURVEY (WORK-LOG, file:line): where the lattice boundary box is built, drawn in the editor, fed to the
      3D preview/stamp, exported to SVG, and emitted into the Fusion sketch manifest; how the Draw boundary toggle gates each.
- [ ] [L1-item-2] DECLARE the boundary as GUIDE geometry: ONE role/flag on the entity (e.g. `role: 'guide'` /
      `construction: true`) that every reader checks — editor renderer draws it dashed and always; the 3D preview/stamp
      path skips it by the role (no special case in 3D code beyond reading the declared role); SVG export unchanged
      (state what it does today and keep it).
- [ ] [L1-item-3] FUSION: the manifest entity carries `construction: true`; `sketch_manifest_builder.py` sets
      `isConstruction = True` on those curves, reading the declared field (generic, not boundary-specific). Never a
      profile, never extruded, still usable for constraints/dims. Pytest with the adsk stub.
- [ ] [L1-item-4] Tests: boundary in the editor DOM always (toggle on AND off), absent from the 3D input, export
      unchanged, manifest has construction:true, builder sets isConstruction. Real-browser desktop + mobile screenshots
      (editor shows the dashed box; 3D shows none) to `C:\Users\danse\.bspline-status\shots\lane2\`.

## Gate (fast tier)
Touched/new specs + full `npx vitest run` + `python -m pytest -q` in bspline-frame-builder/. No Fusion.

## Finish
Commit by path, push origin lane2. Then FROM THIS WORKTREE'S ROOT (it has its own HANDOFF.md):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "L1 — <shas>"`.
