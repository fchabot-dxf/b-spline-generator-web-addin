# NEXT (fb-app) — F14: S6 (extruder reads declared features) + S8 (waist inversion in the FUSION solve)

**Ball: worker (seat C) · epoch 1 · F14.** F13 ACCEPTED (a830598), being merged to main. Spec: FB-APP-DESIGN.md stage rows
S6 + S8. **FUSION WINDOW GRANTED on Ranchy for this task**, same hard rules as F11 (scratch docs you create, tagged
claude/scratch and closed by handle; never touch Fred's docs; claude-* names deleted; purge non-deployed imports;
deploy your fb-app build to test, REDEPLOY MAIN when done; short bridge calls; if the bridge dies or a dialog appears,
stop and report, don't click). PROGRESS automatic ("F14 item N: …"); shots -> shots\seatC\ as items land.

Fred's rule applies to S8: NO runtime guard ("warn and don't send" from the old S8 row is DROPPED). Code it right in the
templates' solve and PROVE it by tests + goldens.

## Checklist
- [ ] [F14-item-1] S6: the extruder reads the template's DECLARED features (frame-defs features: bars, trim, offsets) instead of
      the bounding-box classifier; the classifier stays only where a template declares no features (stated). Live: T1 +
      T2 build the same 4 bars + trim as before (volumes vs the recorded goldens), in both Send orders.
- [ ] [F14-item-2] S8: reproduce a waist-INVERTED Fusion frame build live (search the template params/seeds space in a
      scratch doc; record the exact params + a screenshot) -> a FAILING golden; fix the templates' solve (Python side,
      phases) so it can't invert; the new golden goes green, and all existing goldens stay green. If no inversion can be
      reproduced across a declared sweep, report that with the sweep as evidence (then S8 closes as "not reproducible,
      guarded by the F5/F13 ranges").
- [ ] [F14-item-3] Clean up (tagged docs closed, MAIN redeployed) + WORK-LOG + shots.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F14 — <shas>"`.
