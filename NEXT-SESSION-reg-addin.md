# NEXT (reg-addin, Asus) — R4: STALE-PARAMS, LOG-ONLY (Bspline group: board + lattice)

**Ball: worker (reg-addin) · epoch 1 · R4.** NO FUSION (Fred live-checks after). R3 design (8df6681) ACCEPTED with the
advisor's amendments below. Log = WORK-LOG-reg-addin.md. Work-commit subjects "R4 item N: …"; PUSH AFTER EVERY ITEM
(the status page only sees origin).

## Rulings (advisor + home-PC advisor, 2026-09-26) — these override the design doc where they differ
1. **LOG-ONLY.** Compute + log the candidates; **NO `deleteMe()` anywhere** in this turn. Deletion is switched on later,
   after Fred has checked a few Sends.
2. **ONE registry, the existing one:** add `LATTICE_OWNED_PARAMS` (stroke_width, rail_width, tie_width, node_diameter,
   half_width, contour_width, contour_height) right beside `_BOARD_OWNED_PARAMS` in
   `frame-builder/fb_engine/parameter_schema.py` + an accessor, tag group `Bspline`. That additive edit is the ONLY
   change allowed in frame-builder/. The cleanup LOGIC lives in `b-spline-gen/` (e.g. `param_ownership.py`) and READS
   the registry — it never holds its own name list. No `fb_engine/param_ownership.py`.
3. **Candidate = registered (board or lattice) + stamped `Bspline.owner` + not in this Send's payload + no dependents.**
   Unregistered OR unstamped → never touched and never stamped, whatever its name.
4. **Reference guard = `Parameter.dependentParameters` ONLY** (feature/sketch dims are model parameters, so it covers
   both param→param and dimension references). Drop the hand-rolled regex expression scan. Mark it "verify live" for Fred.
5. **Stamp at CREATE only** for the lattice params (`sketch_manifest_builder.py` `_sync_manifest_parameters`, in the
   `user_params.add` branch). Do NOT change the board's existing stamp-on-touch (widthIn/heightIn are always in the
   payload, so they can never be candidates). Pre-existing unstamped lattice params stay unmanaged — name it in the log.
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
      update of an existing unstamped param does NOT stamp.
- [ ] [R4-item-3] `b-spline-gen/param_ownership.py`: compute `{would_delete, kept_referenced, kept_unstamped,
      failed}` from the registry + stamps + payload names + dependentParameters (rules 3-4); pure/testable against a
      fake params collection. Pytest: stale stamped registered → would_delete; referenced → kept_referenced with reason;
      registered-name but unstamped → kept_unstamped; UNREGISTERED param (any name, stamped or not) → never listed,
      never stamped; in-payload → never listed; no deleteMe call ever recorded.
- [ ] [R4-item-4] Wire: one call in _handle_generate + `stale_params` in last_send.json (always present, empty lists
      when nothing); a guarded try so a failure here logs and never breaks Send. Update STALE-PARAMS-DESIGN.md to
      match the rulings (short "R4 rulings" section at the top; fix §2a/§2b/§2c/§2d). Add a short live-check recipe
      for Fred to the WORK-LOG (what to Send, what to read in last_send.json).

## Gate (fast tier)
`python -m pytest -q` in `bspline-frame-builder/` (touched + full is quick) + vitest smoke only if JS touched. No Fusion.

## Finish
Commit by path, `git pull --rebase`, push main after each item. From the REPO ROOT:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "R4 — <shas>"`.
