# NEXT (reg-addin, Asus) — R4: STALE-PARAMS, DELETE ON (Bspline group: board + lattice)

**Ball: worker (reg-addin) · epoch 1 · R4.** NO FUSION (Fred live-checks after). R3 design (8df6681) ACCEPTED with the
advisor's amendments below. Log = WORK-LOG-reg-addin.md. Work-commit subjects "R4 item N: …"; PUSH AFTER EVERY ITEM
(the status page only sees origin).

## Rulings (advisor + home-PC advisor, 2026-09-26) — these override the design doc where they differ
1. **AMENDED (Fred, 2026-09-26): NOT log-only — "just apply it".** Candidates that pass rules 3-4 ARE deleted
   (`deleteMe()`), and every decision is still logged in last_send.json (`deleted`, `kept_referenced`, `kept_unstamped`,
   `failed`). A `deleteMe()` that returns False or raises → `failed` + warning, never retried, never breaks Send.
2. **ONE registry, the existing one:** add `LATTICE_OWNED_PARAMS` (stroke_width, rail_width, tie_width, node_diameter,
   half_width, contour_width, contour_height) right beside `_BOARD_OWNED_PARAMS` in
   `frame-builder/fb_engine/parameter_schema.py` + an accessor, tag group `Bspline`. That additive edit is the ONLY
   change allowed in frame-builder/. The cleanup LOGIC lives in `b-spline-gen/` (e.g. `param_ownership.py`) and READS
   the registry — it never holds its own name list. No `fb_engine/param_ownership.py`.
3. **Candidate = registered name (board or lattice) + not in this Send's payload + no dependents** (see rule 5: registered
   = ours, stamp adopted). Unregistered → never touched and never stamped, whatever its name.
4. **Reference guard = `Parameter.dependentParameters` ONLY** (feature/sketch dims are model parameters, so it covers
   both param→param and dimension references). Drop the hand-rolled regex expression scan. Mark it "verify live" for Fred.
5. **AMENDED (Fred, 2026-09-26): TAKE OVER existing params.** A param whose name is in the registry is the add-in's,
   whether or not an older version stamped it: stamp it on EVERY Send touch (create AND update in
   `_sync_manifest_parameters`, like the board's `_ensure_bspline_param_tag`), and at cleanup time any existing
   registered-name param (stamped or not) that's out of the payload + has no dependents is deleted. Fred accepted that a
   hand-typed param with a registered name is treated as ours. UNREGISTERED names are still never stamped/deleted.
   `kept_unstamped` goes away (log `adopted: [...]` for params stamped for the first time instead).
6. **Scope: Bspline group only.** Frame params (FrameBuilder.owner) belong to seat C — don't touch parametric_engine.py /
   solid_coordinator.py.
7. **b-spline-gen.py footprint = ONE call** at the end of `_handle_generate` (non-preview path, after geometry) + the
   `stale_params` key in the last_send.json dump. Keep it that small (seat C's S5 will merge there later).
8. Drop the undo claim from the design doc (palette-driven Sends may not be one command transaction); it's moot while log-only.

## Hands off
fb-app; editor-shape-lattice-generator.js; core/frame-record.js, editor-frame-profile.js, frame-mesh.js, main/frame-panel.js;
frame-builder/ except rule 2; seat A's files (editor-lattice-pattern.js, editor-ui.js, editor.js, editor-piece-override.js,
properties-lattice.js, properties-shape-lattice.js, tools/repro/select_drag_shape.mjs). Need one? STOP and say so.

## Checklist
- [ ] [R4-item-1] Registry: LATTICE_OWNED_PARAMS + accessor in parameter_schema.py (rule 2); pytest for it.
- [ ] [R4-item-2] Stamp at create in sketch_manifest_builder.py (rule 5); pytest with the adsk stub: create stamps,
      update of an existing unstamped REGISTERED param stamps it (adopt); an unregistered param is never stamped.
- [ ] [R4-item-3] `b-spline-gen/param_ownership.py`: compute `{deleted, kept_referenced, adopted,
      failed}` from the registry + stamps + payload names + dependentParameters (rules 3-4); pure/testable against a
      fake params collection. Pytest: stale stamped registered → deleted (deleteMe called exactly on it); referenced → kept_referenced with reason;
      registered-name but unstamped + stale → adopted + deleted; UNREGISTERED param (any name, stamped or not) → never listed,
      never stamped; in-payload → never listed; deleteMe returning False / raising → failed; deleteMe NEVER called on anything
      unregistered, unstamped, in-payload or referenced.
- [ ] [R4-item-4] Wire: one call in _handle_generate + `stale_params` in last_send.json (always present, empty lists
      when nothing); a guarded try so a failure here logs and never breaks Send. Update STALE-PARAMS-DESIGN.md to
      match the rulings (short "R4 rulings" section at the top; fix §2a/§2b/§2c/§2d). Add a short live-check recipe
      for Fred to the WORK-LOG (what to Send, what to read in last_send.json).

## Gate (fast tier)
`python -m pytest -q` in `bspline-frame-builder/` (touched + full is quick) + vitest smoke only if JS touched. No Fusion.

## Finish
Commit by path, `git pull --rebase`, push main after each item. From the REPO ROOT:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "R4 — <shas>"`.
