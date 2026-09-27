# NEXT (fb-app) — F10: S5 — the [Send frame] button (code + shim tests; live = Fred's step list)

**Ball: worker (seat C) · epoch 1 · F10.** F9 ACCEPTED (56abaf1, 7276b23), being merged to main. NO FUSION here: Fusion is
on Fred's machine, so the live proof is an exact step list for Fred (I pass it on). Fred's rules: code it right + prove
it by tests (no guard logic); frames never get NEW Fusion params; two buttons, [Send B-spline] UNCHANGED + [Send frame].
Spec: FB-APP-DESIGN.md §4 + stage row S5 (and S7's delete + rebuild, Q1). File fence: stay out of
properties-lattice.js / properties-shape-lattice.js (Asus R7). In b-spline-gen.py keep edits to a NEW handler + its
registration; the Asus R4 stale-param call there must stay untouched. PROGRESS automatic ("F10 item N: …").
Shots -> shots\seatC\ as each item lands; push each item.

## Checklist
- [ ] [F10-item-1] [Send frame] button in the sidebar FRAME section (disabled with a hint when there's no frame chosen; the
      "requires a B-spline body in the document" check happens add-in side and reports back). The payload key carries
      the frame record: template, params (incl. boundingboxoffset), frameBottomZ, wood, SEEDS.
- [ ] [F10-item-2] Add-in handler (b-spline-gen.py -> fb_engine): delete the previous frame found BY ATTRIBUTE
      (FrameBuilder.ComponentType=Frame), never by name/count; build via frame_engine with ui_data from the payload;
      seeds -> the sketch seed dimensions (map each declared seed to its phase dim, as plain values, no user params);
      solid via solid_coordinator to the declared core.underside; FB-ORDER ensure_frame_before_inlay; the appearance =
      the chosen wood. Stamp AestheticCore on the body in [Send B-spline] only if §4 says so (keep that button's
      behaviour otherwise unchanged).
- [ ] [F10-item-3] Shim tests (the existing fake-Fusion harness): both button orders give body -> Frame_N -> inlay; a
      re-send leaves exactly one Frame_1; seeds reach the right dims; no new user params; no body -> a clear error.
- [ ] [F10-item-4] Fred's live step list (in WORK-LOG + FB-APP-DESIGN.md): exact clicks, what to look at in the
      timeline/params, what "pass" looks like, what to send back if not (last_send.json + a screenshot).
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F10 — <shas>"`.
