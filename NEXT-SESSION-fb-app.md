# NEXT (fb-app) — F1: FB-APP design doc (NO code)

**Ball: worker (seat C) · epoch 1 · F1.** Worktree C:\Users\danse\APPS\b-spline-generator-web-addin-fb-app, branch
`fb-app`. NO FUSION. Seats A (main) and B (lane-b) are busy on lattice work — don't touch their files; this turn only
writes ONE new doc. Background: ROADMAP.md "FB-APP" idea entry (read it) + Fred's words there.
PROGRESS is automatic: start each commit subject with the item's tag words ("F1 item 2: …").

Goal: Fred wants to decide the FRAME first and draw the inlay on it, with the frame designed/previewed in the main app
and ONE Send to Fusion building body → frame → inlay, keeping the frame's features genuinely parametric in Fusion.

## Checklist
- [ ] [F1-item-1] Inventory (read-only): the Frame Builder add-in (bspline-frame-builder/frame-builder: fb_engine,
      sketches/template_1 + template_2, parameter_schema, template_data, extrusion_engine, frame_engine incl. FB-ORDER's
      timeline_order): what a frame IS as data — templates, params (names/units/defaults), sketches, features, their
      order and dependencies (e.g. the extrude needs the 'Clean' body). Note dead params (Skel_Frame_Taper: unused, drop).
- [ ] [F1-item-2] Data contract: propose ONE exported definition (JSON) of templates/params/features that BOTH the app
      (JS preview) and fb_engine (Python build) read — how it's produced from today's Python (generated, not
      hand-copied), versioned, and tested.
- [ ] [F1-item-3] App side: Frame section/tool UI, 2D guide layer in the editor (locked, not exported), 3D straight-
      extrusion preview in the existing three.js view — what's reused from the app (layers, three.js scene, Shape
      Lattice presets which already mirror templates 1/2).
- [ ] [F1-item-4] Send order: one Send = board params → body → frame (fb_engine called from the main add-in) → inlay;
      param ownership (Send owns widthIn/heightIn; frame params owned by the frame; declared owned-lists so a future
      stale-param cleanup never deletes frame params); FB-ORDER stays as a safety net for standalone frames.
- [ ] [F1-item-5] Stages + parity tests (app preview vs Fusion build per feature), risks, open questions for Fred —
      written as FB-APP-DESIGN.md at the repo root.
Commit by path, push to origin fb-app, then from THIS worktree root:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F1 FB-APP design doc — <sha>"`.
