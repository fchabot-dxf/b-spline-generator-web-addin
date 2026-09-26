# NEXT (fb-app) — F2: verify FB-APP's UNVERIFIED items live in Fusion + S0 clean-up

**Ball: worker (seat C) · epoch 1 · F2.** F1 (bfc0b44) accepted. FUSION IS ALLOWED for this task (Fred: "Fusion is open,
they can verify") — you are the ONLY seat using Fusion. Seats A/B stay NO FUSION.
Fred's input: the face you pick for the frame extrude is actually the BOTTOM face of the core ("core.top" in the design
is a naming problem) — rename in the design to what it really is and verify which face it is live.
PROGRESS is automatic (commit subjects "F2 item N: …"). Save screenshots to C:\Users\danse\.bspline-status\shots\seatC\.

## Fusion hygiene (hard rules — incidents behind each)
- Work in a NEW scratch document you create; close ONLY that handle when done (never close docs by name/count). Fred's
  own open design must not be modified.
- If you import code from a non-installed path, afterwards remove those sys.path entries + purge those sys.modules
  (fb_engine.*, sketch_manifest_builder, anything under your worktree) — a stale scratch fb_engine once broke Fred's
  Frame Builder. Don't stop/deploy the installed add-in; call functions from your worktree in the scratch doc.
- Delete anything you create; Fred's doc also hit the Fusion document limit, so don't SAVE scratch docs.

## Checklist
- [ ] [F2-item-1] Which face the BAR extrude uses (to_face / pick): measure it on a real build — confirm it's the core's
      BOTTOM face; fix the naming in FB-APP-DESIGN.md (declared name = what it is).
- [ ] [F2-item-2] Risk 1 re-Send: body rebuilt → does the frame extrude's to_face error/rebind? Does each Send add
      Frame_2, Frame_3? Measure; record outcomes + what S7 must do.
- [ ] [F2-item-3] Bar height mapping (carveZ ↔ to_face / frame_height_offset −1 in): measure what −1 in does physically.
- [ ] [F2-item-4] FB-ORDER's Fusion glue (timeline_order._component_name_for_entity) on a real frame build: moved as a unit?
- [ ] [F2-item-5] S0 clean-up (code, tests): drop Skel_Frame_Taper / Skel_Slot_Tolerance / the Taper unit rule; one
      declaration of frame_thickness / boundingboxoffset — per the design's S0 row; pytest green; mutation check.
- [ ] [F2-item-6] Update FB-APP-DESIGN.md: every UNVERIFIED item you measured becomes MEASURED (numbers), open questions
      unchanged unless answered.
Commit by path, push origin fb-app, pass back from the fb-app root with handoff.py pass --to advisor.
