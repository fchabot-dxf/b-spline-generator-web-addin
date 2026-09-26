# NEXT — FB-ORDER: frame before the inlay in the timeline; board params owned by Send to Fusion

**Ball: worker (seat A) · epoch 2 · FB-ORDER.** NO FUSION (advisor verifies live). Spec = ROADMAP.md "## Queued —
FB-ORDER" (read it fully — it has the advisor's scratch-doc measurements). Summary:
1. OWNERSHIP (declared list): widthIn/heightIn are created/updated ONLY by Send to Fusion (b-spline-gen). The frame
   builder's _sync_user_parameters (frame-builder/fb_engine/parametric_engine.py) must SKIP the owned board params; if
   they're missing at frame build, stop with a clear user-facing "Run Send to Fusion first" message (no partial frame).
2. ORDER: after the frame builds, move the frame block (its occurrence creation, sketches, planes, and any features
   already built from them — incl. solid-builder features) as ONE UNIT, original order, to just BEFORE the earliest
   inlay timeline item ("Plane for L…" / "Source - L…"), never before the initial B-Spline Set comp/body. Measured:
   TimelineObject.reorder of a later item to an earlier index works; canReorder False for the inlay/plane moving later.
   Check canReorder for every item first; if any refuses, move nothing and warn. No inlay present -> do nothing.
   Declare the inlay-item name patterns once.
3. Solid builder run afterwards lands at the end and still sees the frame sketches — keep it that way.
Tests: a fake timeline shim (items with canReorder/reorder/index) — block moved as a unit in order; refusal -> nothing
moved + warning; no inlay -> no-op; board params never created by the frame builder. Commit by path, push, then
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "FB-ORDER — <sha>"`.
