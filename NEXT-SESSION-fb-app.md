# NEXT (fb-app) — F3: fix FB-ORDER's missed solid features + S1 (generated frame-defs.json)

**Ball: worker (seat C) · epoch 1 · F3.** F2 (1615d59) accepted. Fusion still ALLOWED for you only (same hygiene rules as
F2: scratch doc, never touch/save Fred's design, purge sys.path/modules you add). PROGRESS automatic ("F3 item N: …").
Screenshots → C:\Users\danse\.bspline-status\shots\seatC\.

## Checklist
- [ ] [F3-item-1] FB-ORDER bug you measured: the frame block move misses the SOLID features (extrudes/trim). Fix in
      frame-builder/fb_engine/timeline_order.py (+ its Fusion glue) so occurrence + sketches + planes + extrudes + trim move
      as ONE unit in order; any canReorder refusal -> move nothing + warn (existing rule). Unit test in the shim + verify
      live in a scratch doc (screenshot the timeline before/after). NOTE: this file is also on main (seat A doesn't touch
      it); your fix lands on main when fb-app merges — keep the change self-contained.
- [ ] [F3-item-2] S1: declare FRAME_REGIONS / FRAME_FEATURES in the templates' own data (template_data.py), a generator
      tools/gen_frame_defs.py -> frame-defs.json (templates, params with units/defaults, features, appearance options =
      the 5 woods with Ash default, frame_height_offset = frame-bottom Z position, 'none' = default frame).
- [ ] [F3-item-3] template_catalog.py (no consumers, your gate): if it's the natural template list, make it the
      generator's source; otherwise delete it as a sweep. State which + why in the WORK-LOG.
- [ ] [F3-item-4] Tests: freshness (frame-defs.json == generator output), schema, declaration (every template has its
      regions/features), red on a renamed id; mutation check.
Commit by path, push origin fb-app, pass back from the fb-app root with handoff.py pass --to advisor.
