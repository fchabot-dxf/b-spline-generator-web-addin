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
| A | `b-spline-generator-web-addin-f3` | main checkout / `main` | 6 | f3 | H23 item 15: Template 10 Fusion fix |
| B | `b-spline-generator-web-addin-b5` | `-lane-b` / `lane-b` | 9 | b5 | T82 item 1: finish Template 7, then T82 item 3 |
| C | `b-spline-generator-web-addin-de` | `-fb-app` / `fb-app` | 5 | de | F30 item 3: taper copies |
| spare | `-39`, `-d3` | none | none | none | PARKED (no wait, no edits, no Fusion) |

Decommissioned, all signed with 🪦 except `af`, which is closed: af, 66, d6, 55.

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
