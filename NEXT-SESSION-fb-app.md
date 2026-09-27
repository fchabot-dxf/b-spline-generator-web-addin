# NEXT (fb-app) — F9: Trim offset (option A) + frame shape HANDLES

**Ball: worker (seat C) · epoch 1 · F9.** F8 ACCEPTED (2a039a1 a9d6fc5 742ca5b 6f6f043), being merged to main. NO FUSION
(Fusion is on Fred's machine: any live step is a list for Fred). Fred's rules: code it right + prove it by tests (no guard
logic); frames never get NEW Fusion params. Merge origin/main first (regenerate frame-defs via tools/gen_frame_defs.py,
never hand-resolve). Asus lane2 edits core/preview/index.js small+additive (BOUNDARY-GUIDE); keep your 3D work in
frame-mesh.js. PROGRESS automatic ("F9 item N: …"). Shots -> shots\seatC\ AS EACH ITEM LANDS, push each item.

## Checklist
- [ ] [F9-item-1] TRIM OFFSET, gate decided = option (A): boundingboxoffset becomes a normal (non-ReadOnly) template param
      (template_data.py), so the resolver writes the payload value on every build; the standalone palette shows it as an
      editable field too (intended). Sidebar FRAME field "Trim offset (in)" (formula-field compatible), in the frame
      record, driving the editor cut profile + 3D trim + fit rule live, and carried in the payload. Python test: the
      resolver writes a changed value; JS tests for the field. Live check = a step list for Fred.
- [ ] [F9-item-2] Frame shape HANDLES in the Frame tab, per the ONE binding table (FB-APP-DESIGN.md + code): each handle is
      PARAM-BOUND to an existing template param once proven by per-value goldens (write Fred's recording steps), else
      SEEDED (value in the frame record, [Send frame] writes it as a plain dimension, no user param). Reuse
      computeParamHandles / feasibleParamRanges. Template change resets the seeds.
- [ ] [F9-item-3] Tests (binding table is the single source; seeded -> no param in payload; bound -> the param in payload;
      drag -> record -> reload) + shots of the handles on T1 + T2, desktop + mobile.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F9 — <shas>"`.
