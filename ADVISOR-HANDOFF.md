# Advisor handoff (ranchy), 2026-10-01

From the outgoing advisor (session `b-spline-generator-web-addin-54`) to the new advisor. Read this, then
`HANDOFF-ranchy.md` (Fred's standing rules and the frame-template design rules), then take over.

## 1. Take over in this order

1. Adopt the **advisor** skill (`~/.claude/skills/advisor`). It is current, and its fleet section covers seats,
   spares, the seat lock and decommissioning.
2. Confirm the old advisor has stopped its waiters (it will tell you). Then arm ONE advisor waiter per channel, each
   from its own worktree root, in the background:
   `cd <root> && until python ~/.claude/skills/multi-agent-handoff/handoff.py wait --role advisor --timeout 3000; do :; done`
   Roots: `C:\Users\danse\APPS\b-spline-generator-web-addin` (seat A), `...-lane-b` (seat B), `...-fb-app` (seat C).
3. Message every seat and spare once: "new advisor is session <you>".
4. Message Fred in one line that you've taken over.

## 2. Seats

| Seat | Session | Worktree / branch | Epoch | Seat lock | Doing now |
|---|---|---|---|---|---|
| A | `b-spline-generator-web-addin-39` | main checkout / `main` | 7 | 39 | H23 item 78: Template 18 Arched Head (diagram first) -- f3 DECOMMISSIONED 17fe1c6 |
| B | `b-spline-generator-web-addin-d3` | `-lane-b` / `lane-b` | 10 | d3 | T86 item 4b: brick engine on every template (b5 decommissioned f4375d1) |
| C | `b-spline-generator-web-addin-37` | `-fb-app` / `fb-app` | 6 | 37 | F35 item 18: Flat/Organic, Weathered, sidebar split, 2D-only editor (de DECOMMISSIONED cb79c86) |
| spare | `-88` | wt-88 (ad-hoc fixes) | none | none | on-call for small fixes; b5, f3, de DECOMMISSIONED |

Decommissioned, all signed with 🪦 except `af`, which is closed: af, 66, d6, 55, 4a (archived 2026-10-03, never had a task).

Fleet mechanics:
- **Seat lock.** `handoff.py seat --session <name>` per worktree; a worker `wait` must pass the matching
  `--session` or it's refused. Re-run `seat` on every swap.
- **Swapping a spare in.** Bump `.handoff/epoch`, run `seat --session <spare>`, then `pass` with a full note. Message
  the spare its seat. Ask the old holder for its `🪦 DECOMMISSIONED …` line. Update
  `tools/status_site/seats.json` (`session` field) and restart the status watcher (section 6).
- **Fresh sessions always start in the main checkout.** That's why the seat lock exists: twice today a fresh session
  took a waiting main turn before its seat message arrived.
- **Advisor commits.** Make them in a SCRATCH worktree at origin/main (`git worktree add --detach ../wt-adv
  origin/main`), never in the main checkout: seat A's uncommitted WIP lives there. Fast-forward the main checkout
  only when the incoming diff touches files seat A isn't editing.

## 3. Per-seat queue (checklist lines live in each seat's NEXT-SESSION file)

**State at 2026-10-01 ~22:30 (advisor 45, Fred: "do just T10 and T11 then idle").** The lists below this block
are the morning's; this block supersedes them where they disagree.
- **T10 (H23 items 15-23): DONE and live-verified at 6x9 AND 7x9** by the advisor (fresh headless captures replayed
  through `_handle_generate`; 4 bars each; shots `shots/seatA/h23_item23_t10_{6x9,7x9}_live_advisor*.png`).
  f3's cf3805f (Generate retries past a >=180 deg waist arc) plus b98c0f5 (`UNDERSIDE_MAX_NORMAL_Z` -0.9 -> -0.7:
  a doubly-curved panel's corners tilt; measured). Still owed: `FRAME_HIDDEN = False` + regen + the fb-app merge
  (T12/13) -- NOT done, T10 is still hidden in the picker.
- **T11 (T83 item 1) Fusion side: DONE on lane-b** (5cd8e76 + 97d523c, advisor, branch `t11` worktree
  `../bsg-t11`). All 6 arcs exact through the real engine at 9x12/7x9; shots `shots/seatB/t83_t11_live_*`.
  Root causes + recipe are in the fusion360-quirks skill (section 1, two new entries) -- READ THEM before any arc
  work. Still owed on lane-b: the APP side (silhouette preset `diamondTopHourglassPinch`, extractor
  `diamond_top_hourglass_pinch`, seed-geometry test, un-hide). **lane-b's gate is RED until then**: 3
  `test_frame_defs` tests + `gen_frame_defs --check` fail with `KeyError: 'diamond_top_hourglass_pinch'`
  (pre-existing from b5's scaffold, not from the fix). The app must send each arc's TRUE midpoint as its seed.
- **Seat B (b5) is on the inset window** (visible corner handles + Position/Size steppers). Its edits were found
  UNCOMMITTED IN THE MAIN CHECKOUT (seat A's tree) at 21:49-21:58; b5 was told to move them to lane-b and has
  not answered yet. Check `git status` in the main checkout before anything else.
- **New bugs found, queued, NOT fixed:**
  1. **Cross-document deletion on Send** (`b-spline-gen.py` `_remove_last_import`, `last_imported_occurrences`
     is in-memory and document-blind): a Send into a NEW document deleted the previous B-Spline Set in the
     PREVIOUSLY active document. Measured twice. Fred's open doc was spared only because its set predates the
     add-in process. Fix: resolve the previous import by tag within `app.activeProduct` only (the tag search
     already exists), never from memory.
  2. **Template 7's body-arc welds are crossed** the same way T11's were (`p02_03_welds.py`,
     `arc_body_R:E -> side_R:S` etc. -- the body arcs are clockwise, so their :S/:E are swapped). T7 has never
     been live-built. Apply T11's recipe (exact via, no seed Radius, no nudges, CCW-correct welds) and the
     weld test pattern from `fb_engine/test_t11_fusion_expressions.py`.
  3. `FrameBuilder()` without `external_logger` raises (`logger.DebugLogger` shadowing) -- b5's finding, one line.
- **Harnesses for Fred's "geometry injection tests":** `tools/repro/fusion_t11/` on lane-b (points generator,
  arc-chain solver probe, live build readback). Use them as the pattern for T7.
- **Deployed add-in:** b98c0f5 from `../wt-adv` (clean, origin/main). Its `project_path.json` handshake points at
  `wt-adv`, so KEEP that worktree until the next deploy from elsewhere (removing it orphans the debug log path).
- Open Fusion docs: Fred's two, plus ONE advisor scratch doc (`adv_t11_live_fp` = `adv-t11-live-7x9`, the T11
  7x9 sketch build) left open for Fred to inspect; close it by that fingerprint when done.
- Advisor is IDLE per Fred; waiters: main (none armed -- f3 stood down), lane-b turn 224 (b5 owes it), fb-app parked.

**Seat A** (`NEXT-SESSION.md`, H23):
- **item 15, Template 10's Fusion build.** Two independent wrong-branch ("reflex") arcs: the top arch (about 330°) and
  arc_shoulder_R/L (the "ears"). Fred's hand-rebuilt target is in
  `C:/Users/danse/.bspline-status/shots/fred/t10_fred_reconstructed_constraints_2026-10-01.json` (plus the
  `_sketch_dump.txt` next to it). Fred's key hint: **he disconnected the side from the horn and flipped the arc
  upward.**
  - Arch rule: centre on the Y axis, one vertical dimension `d = a / tan(archCornerAngle - 90°)` below the chord.
    archCornerAngle is 100–130°, default 127.
  - A build-time reflex-arc check already exists (d6, 4c268c2).
  - Seat C's matching APP side is parked on fb-app (`b31f5ed`, F29 item 2). **Merge both together** once A's build
    is clean. Then `FRAME_HIDDEN = False` in template_10/template_data.py and regenerate.
  - Four seats have now struggled with this; if f3 stalls too, ask Fred to sit with it in Fusion.
- **item 16, inset window in Fusion.** Blocked until seat B's T82 item 3 updates `INSET-WINDOW-DESIGN.md`.
- Live checks still owed: Template 7, Template 11 and the taper copies, as they merge.

**Seat B** (`NEXT-SESSION-lane-b.md`):
- **T82 item 1, finish Template 7 (Diamond top, approved v3 diagram).** The tested geometry foundation is on lane-b
  (`d061e42`: `fb_engine/t7_roof_eave.py`, `t7_geometry.py`, `clamp_t7_handles`). Remaining: phases,
  template_data (5 bars), app preset, gen_frame_defs, tests, A/B, LIVE_CHECK.md, and shots to the advisor.
- **T82 item 3, inset window subframe VISIBLE like the main frame.** Bars show from the top around the opening, the
  panel tucks UNDER them by `panel_lip`, the open window is the subframe's inner rect, and the hole edge is clean.
  Update the design note first. The app side (toggle, drag, hole, stamps/lattice skip it) is already on main
  (244c096).

**Seat C** (`NEXT-SESSION-fb-app.md`):
- **F30 item 3, taper copies, Fred-approved.** (a) Hourglass + taper and (b) Narrow Neck + taper.
  - taperAngle is −15…+15°, default 8. Negative = outward, with the top corners on the board edge; Hourglass is
    clamped at its feasible limit, about −13.75° at 7×9.
  - Originals stay byte-identical.
  - Fred: "don't worry too much about extremes".
  - (c) Arched + taper waits for the Template 10 fix.
- **F30 item 1, Template 11, approved.** T7's diamond roof with Template 1's 3-arc hourglass sides. Build after T7
  merges, reusing T7's roof code.

## 4. Fred's rules learned this round (also in memory)

- **Portrait only for now.** Landscape just needs a graceful fallback; never exclude sizes outright.
- **New templates go diagram first, to the advisor first,** then to Fred for approval, then the build. Seats must
  not send pictures straight to Fred (`SendUserFile` goes to Fred).
- **Frames are mitred bars glued up.**
  - Every corner is a true bisector miter.
  - Bars are an even width.
  - Every piece is at least frame_thickness.
  - The frame's outer edge is the board outline.
- **The status page is Fred's view** (https://bspline-status.pages.dev). Shots go to
  `C:/Users/danse/.bspline-status/shots/seat{A,B,C}/`.
- **Fusion.** Seats may launch/relaunch Fusion and dismiss its crash window. Never use on-screen automation for
  normal testing. Deploy only from a clean scratch worktree at origin/main.
- **Push to both `main` and `claude/lucid-ride-jycpox`** after tests pass, and log in `WORK-LOG-fb-app.md`.

## 5. Merge procedure (advisor)

1. Use a scratch worktree at origin/main (`git -C <main> worktree prune` first) and `git merge --no-ff origin/<branch>`.
2. Resolve conflicts:
   - work logs: keep both sides, then `grep -c '^<<<<<<<'` must be 0;
   - frame-defs.js/.json: `git checkout --theirs`, then `python tools/gen_frame_defs.py`.
3. Run the gate:
   - `npm ci`, then `npx vitest run`;
   - `python -m pytest -q` in `bspline-frame-builder/frame-builder`, in `bspline-frame-builder/b-spline-gen`, and at the
     root with `--ignore=.claude`;
   - `python tools/gen_frame_defs.py --check`.
4. Push `HEAD:main` and `HEAD:claude/lucid-ride-jycpox`. **Remove the worktree only after the push succeeds.**

## 6. Tools

- `python tools/amend_item.py <seatA|seatB|seatC> <TAG-item-N> "<text>"` adds the checklist line, commits it, and
  sends the amendment in one step.
- **Status watcher restart** (PowerShell):
  1. stop every `pythonw` whose command line matches `status_watch`;
  2. `Start-Process <main>\.venv-3\Scripts\pythonw.exe tools\status_site\status_watch.py`.

  It runs as a launcher plus a child process, so "2 processes" is normal.
- **Fusion bridge.** Port 7654. If it doesn't come up after a relaunch: Utilities > Add-Ins > FusionMCPBridge > Run.
  Fred has done this once.
- **Fred's open Fusion docs.** Check `app.documents`. There may still be a scratch doc tagged
  `claude/scratch = T10-broken-for-Fred`. Fred said he's done with it, so the seat holding Fusion may close it by
  that tagged handle only. Fred's own "Untitled" must stay untouched.
