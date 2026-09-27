# NEXT (fb-app) — F11: LIVE on Ranchy — prove [Send frame] + seeds in position (option B)

**Ball: worker (seat C) · epoch 1 · F11.** F10 code ACCEPTED pending live (6f9d2ec, 334ebe8); NOT merged until this passes.
**FUSION WINDOW GRANTED (this PC, "Ranchy") for this task only**, through the fusion360 bridge. Rules, all hard:
- Work ONLY in scratch documents YOU create: tag each with `design.attributes.add('claude','scratch','F11')` right after
  creating it, and at the end close ONLY the docs carrying that tag (by handle). NEVER close/modify Fred's docs, never
  close by name or count. Fred's open doc is "Untitled" (untagged); leave it alone.
- Name anything you create `claude-*`; delete it after. If you import code from anywhere other than the deployed add-in,
  purge those sys.path/sys.modules entries after (stale-module incident, memory rule).
- Deploy your fb-app build: stop add-in `bspline-frame-builder` (app.scripts.itemsByName(...)[0].stop()),
  `python bspline-frame-builder/DEPLOY_bspline-frame-builder.py all` FROM YOUR WORKTREE, then .run() in a separate call.
  When DONE, redeploy MAIN's build the same way (from C:\Users\danse\APPS\b-spline-generator-web-addin) so Fred's add-in
  is back on main.
- Drive Sends WITHOUT the palette: tools/repro/capture_send_payload.mjs (on main) captures the real app payload headlessly;
  replay it with `sys.modules['bspline_ui'].PaletteHTMLEventHandler()._handle_generate(payload)` (B-spline), and your
  [Send frame] handler the same way. Keep each bridge call short (Fusion single-session: Fred's other machine can
  suspend this one; if the bridge dies, stop and report, don't click any dialog).
PROGRESS automatic ("F11 item N: …"). Screenshots (fusion_screenshot) -> shots\seatC\ as each item lands.

GATE DECIDED (advisor, per Fred's "simply seed it in position"): seeds -> Fusion = option (B): move the template's own
sketch points/curves to the seeded positions (plain geometry, NO new dims, NO params). Prove it live.

## Checklist
- [ ] [F11-item-1] Live [Send frame] per FB-APP-DESIGN 4.1 in a scratch doc: B-spline Send, then Send frame -> body ->
      Frame_1 block -> inlay order (measured from the timeline), bars extruded to core.underside, wood appearance;
      re-send -> exactly ONE Frame_1, all features healthy; no body -> the clear error; Trim offset 0.5 -> param 0.5 +
      the gap measured. Also Send frame BEFORE B-spline if the design allows it (both orders, §4).
- [ ] [F11-item-2] Seeds option (B): implement moving the template's seed points/curves; prove per handle (T1 + T2) at 2-3
      values that the built Fusion outline matches the app preview (the S4 parity method), and that a stroke/thickness
      change keeps it. If a handle can't be matched, report it (that handle becomes app-only, stated).
- [ ] [F11-item-3] Clean up (tagged docs closed, claude-* gone, modules purged, MAIN redeployed) + shots + WORK-LOG.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F11 — <shas>"`.
