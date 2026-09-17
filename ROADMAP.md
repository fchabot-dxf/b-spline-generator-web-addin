# ROADMAP — Explore & Report phase

## North star (this phase)
Produce a **ground-truth understanding** of the hybrid app — a durable architecture
reference and a reconciled defect/principle-violation list — **without editing
application code**. This is a read-and-document phase; the deliverables set up later
fix work. No feature builds (Post & Send / gateway / beacons are shelved for now).

## The app in one line
One `b-spline-gen` frontend runs in **TWO hosts** (a Fusion palette + a deployed
website), consolidated with sibling palettes under a **single hot-reloading Fusion
add-in**, backed by Cloudflare workers.

## Principles / invariants — hold these AND scout against them (T2)
_Candidate set, inferred from code — T1's architecture report should sharpen them,
and the human may add more. The bug scout (T2) flags code that BREAKS these, not
just runtime crashes._

1. **One frontend, two hosts.** Host-specific behaviour lives ONLY in
   `core/fusion-bridge.js`. Shared logic lives in `core/` and must not be forked or
   copy-pasted per host. _Smell:_ Fusion-only / web-only branches scattered outside
   the bridge; duplicated core logic.
2. **Clean hot-reload lifecycle.** Sub-modules load in `run()` and FULLY release in
   `stop()` (handlers, palettes, event subs, panels). _Smell:_ handlers/palettes
   leaked across Stop→Start; module state that wrongly survives reload.
3. **One add-in, isolated sub-modules.** Sibling palettes are peers folded into one
   entry; one bad sub-module must not take down the others. _Smell:_ cross-module
   global collisions; a shared-name module binding to the wrong copy.
4. **Declare over hand-roll** (global). A recurring concept should be DECLARED as
   data / config / a named reusable thing, not hand-rolled as one-offs. _Smell:_
   parallel if/elif ladders that encode a table; duplicated literals that should be
   one declaration.
5. **Simplicity + surgical** (global). No speculative machinery; every line traces to
   a need. _Smell:_ unused abstraction, dead code, over-configurable single-use code.

## Task list (FINITE — this is the off-switch)
_Phased: UNDERSTAND → CATALOG → PLAN. All read-only; application-code edits begin
only in a LATER, separately-blessed fix loop driven by T4's backlog._

- **T1 — Architecture report** → `ARCHITECTURE.md`. Explore + document the hybrid
  structure and the two invariant-bearing seams (fusion-bridge contract, hot-reload
  lifecycle), each sibling palette's role, the cloud workers. Read-only.
- **T2 — Bug & principle scout** → update `BUGS_OPEN.md`. Sweep for (a) runtime bugs
  and (b) violations of the principles above. Reconcile B1–B3 (still open? fixed?).
  Every finding: `file:line` + concrete symptom / which principle it breaks.
  Read-only.
- **T3 — Engineering-standards audit** → `STANDARDS-AUDIT.md`. Distinct from T2 (T2 =
  "is it broken / does it break our principles"; T3 = "is it built to standard").
  Assess: test coverage, code duplication (the per-palette shared-module copies +
  source-vs-`dist/` drift), dead code, error handling, deploy reproducibility,
  dependency/security hygiene. Each gap: what · where (`file:line`) · why below
  standard. Read-only.
- **T4 — Prioritized fix backlog** → `FIX-BACKLOG.md` (this BECOMES the fix-phase
  ROADMAP). Synthesize T2 + T3 into a ranked, effort×impact-ordered plan; each item a
  concrete, verifiable success criterion, sequenced so foundational fixes land first.
  Planning only — no edits.

When T4 lands and passes review → advisor runs `handoff.py done` (no `pass`). The
list is the off-switch. The fix loop is a SEPARATE cycle, blessed by the human.

## Ownership
ROADMAP.md / NEXT-SESSION.md = advisor. WORK-LOG.md = worker. HANDOFF.md = via
`handoff.py` only.

---

# FIX PHASE (blessed 2026-07-11) — code edits begin here

The audit phase (T1–T4) is done. Human blessed the FIRST fix: **deploy
consolidation** (refines FIX-BACKLOG F13). Chosen shape: **extend `release.py` as the
single deploy entry** (`--web / --addin / --local / --all`); it owns zip + gh + local
install *once*, and CALLS `deploy_cloudflare.py --build-only` for the web build so the
**Cloudflare Pages CI contract is preserved**. Sliced; safe-cleanup first, risky merge
gated by review.

- **DF1** — Confirm the Pages build entry + remove the clearly-dead/orphan deploy code
  (`deploy_cloudflare.py` step-3 broken local-refresh · `run_deploy.py` wrapper ·
  `deploy_worker.py` orphan) — each only after confirming it's truly unused. **Verify**
  the web build + local install still work. Leave a merge-map for DF2. *Edits code.*
- **DF2** — The merge: `release.py` flags, single zip+gh owner, `--web` calls
  `--build-only`. Verify each path.
- **DF3** (optional) — `sync_stamp_bundle` to the front + gitignore stamp-editor's
  generated copy (F7).

After the deploy is clean, the next correctness item is **B6 (data-loss)** per
`FIX-BACKLOG.md`.

**Fix-phase rules:** every task EDITS code AND **must verify the real behaviour** (run
the affected deploy path, observe output) before pass-back — not just typecheck. Gate
the risky merge (DF2) behind a reviewed plan. Commit per task.

---

# CLEANUP PHASE (blessed 2026-07-11) — the 5 structural debts, autonomous

Sequenced so editor-tree work gets cheaper first and the riskiest (carve-path) is last.
Advisor drives via the loop, reviews each diff, verifies what's headless-verifiable
(tests / sync-regen / node --check). SURFACES to the human only for: the Fusion-only
verification of C4/C5, a real design fork, or when the list is done.

- **C1 — F7 de-fork the editor tree.** Untrack + gitignore the sync-GENERATED stamp-editor
  copies (editor/, core/stamp/, the 4 synced core deps) — NEVER the unique engine.js/
  runtime.js/main/. Regenerate via sync; fresh-clone bootstrap note. Headless-verifiable.
  *(Do first: makes C2/C5 single-copy edits.)*
- **C2 — SVG.Point → transformPoint.** Migrate the leftover hand-rolled `SVG.Point.transform`
  (transform-handles, eraser) to the declared `transformPoint` (EX1). Source tree only
  (post-C1), re-sync. Unit-test + node --check.
- **C3 — error-handling sweep (§4).** Narrow bare `except:` → `except Exception:` + log on
  NON-cleanup paths, worst offenders first (exporter.py 36, fusion-inspector 18, …). SLICED
  (one file / small batch per turn), behavior-preserving (leave idiomatic teardown excepts).
- **C4 — F8 per-palette module de-dup.** Reconcile the 2 drifted copies
  (expression_coords/entity_helpers) into one shared package both palettes import; retire the
  relevant `_force_wipe` need. **Fusion hot-reload (Stop→Start) verification needed → gate.**
- **C5 — EDM4 editor-content tangle.** Retire the P.stampLayers mirror (one content store),
  fixing the Cancel-snapshot sibling + the deferred double-stamp. **CARVE-PATH + Fusion-only
  verification → design-first, gate, human confirms** (don't re-break the coordinate work).

Off-switch: C5 reviewed → advisor `done` (or human redirects). Order runs C1→C5; the human
can reprioritize any time.

---

## C4 status + a hard lesson (as of the live-Fusion session)

**✅ C4 COMPLETE (human-verified in Fusion 2026-07-15).** Slices: S1 canonical entity_helpers ·
S2 canonical expression_coords (69 pytest green) · S2b revived ownership-gate test (14/14) ·
S3 frame-inspector switched · S4 template-maker switched + both copies deleted · S4b corrective
(removed dead dynamic-import orphans — see lesson) · S5 retired the 2 dead `_shared_project_names`
wipe entries. End state: ONE canonical `fb_shared/`; Frame Inspector + Template Maker both consume
it package-qualified; no drifted copies; the 3×-per-bootstrap bare-name wipe retired. Both palettes
load + work in Fusion.

**LESSON — verify C4 against DEPLOYED code, not the repo.** The AddIns folder Fusion runs was
2–3 months stale for most of this session, so S3's "it works" + the co-load "fine" actually
exercised the PRE-C4 code. Only after a `release.py --local` deploy + a Fusion Stop→Start did the
real de-dup run — and it immediately exposed **S4b**: template-maker's `run()` calls
`_reload_all_project_modules()`, which does a DYNAMIC `importlib.import_module('expression_coords')`
(+ a `_PROJECT_MODULES` wipe entry). S4's "0 bare imports" grep only matched STATIC import syntax,
so it missed the dynamic string form; with the bare copy deleted, `run()` threw and the Template
Maker toolbar button vanished. Fix = remove the dead orphans; broaden the verify to sweep
`importlib.import_module`/`__import__` too. **Rule going forward: any Fusion-gated slice must be
deployed (`release.py --local`) + Stop→Start BEFORE its verification counts.**

**Open threads (not C4-closing, track separately):**
- **Undo/redo** reported broken in Fusion — now backlog item E8.
- **Tilt plane feature** (pulled commit 6c1cce4) — ✅ validated live (angle drives the frame).

---

# ENHANCEMENT BACKLOG (blessed 2026-07-15) — 10 ideas, the loop's task list

Human blessed E1–E8 → drive via the handoff loop, ONE per turn, sequenced foundation-first
(deploy/version reliability that caused the stale-code saga), Fusion-gated last.
**E9–E10 DEFERRED (human 2026-07-15: "not yet") — both carve-path, held out of the active loop.**
Off-switch: **E8 reviewed → advisor `done`**. `[F]` = needs human Fusion verify · `[D]` = design-first.

- **E1 — Deploy fail-loud + wider verify** *(bug).* `DEPLOY_bspline-frame-builder.py`: any skipped/
  locked `.py` → non-zero exit + loud error (today it printed "success" on a partial copy); widen
  `VERIFY_FILES` to cover `parametric_engine.py` + `fb_shared/*` + each sub-palette entry. Headless.
- **E2 — Build/version stamp** *(enh).* Deploy writes a DECLARED `build-info.json` (git SHA + time);
  every palette header reads + shows it (✓/⚠ vs repo). Kills "am I running stale code?". `[F]` light.
- **E3 — Deploy consolidate + stop-first guard** *(enh).* One canonical local-deploy entry (retire
  the `DEPLOY_*` vs `release.py --local` split); detect a running add-in → warn/refuse before copying.
- **E4 — In-palette diagnostics panel** *(new).* Per-palette load status + version + recent log tail
  (would've flagged TM's failed `run()` instantly). Builds on E2. `[F]`.
- **E5 — Test-suite isolation leak** *(bug).* `test_origin_axis_target` 14/14 alone but 9 fail in-suite
  (global state bleed). Fix isolation → full suite green, ownership-gate coverage trustworthy. Headless.
- **E6 — Finish the de-dup (fb_shared §5)** *(enh).* Fold the remaining `_shared_project_names` modules
  into `fb_shared/`, retire the `_force_wipe` dance + the collision/dynamic-import class. Builds on C4. `[F]`.
- **E7 — Frame Inspector readability** *(ux).* Collapsible sections, per-field copy, clearer grouping. `[F]`.
- **E8 — Undo/redo in Fusion** *(bug).* Wrap the whole build (geometry + tilt plane + `frame_tilt_deg`
  param) in ONE undo transaction group so undo reverses cleanly. `[F]` `[D]`.
- **E9 — Coordinate round-trip validator** *(new).* Automated SVG→carve→Fusion identity check (scale/
  orientation/position); catches the micro/flip/offset class as a test. Carve-path-adjacent. `[D]`.
- **E10 — Carve preview before send** *(ux/new).* Render the post-transform carve in-editor. Carve path
  = riskiest (don't re-break the coordinate work) → LAST, design-first. `[F]` `[D]`.

Separate from this backlog: **C5/EDM4** (P.stampLayers mirror) still pends from the cleanup phase —
carve-path, so slot it near E9/E10 or after, human's call.

---

# STATUS 2026-09-17 (advisor resumed after a 2-month pause)

- **E8 undo fix** committed 5f665ff on Jul 16 but the AddIns folder Fusion runs was dated **Jul 13** — it was
  NEVER deployed, so no valid Fusion check happened. Advisor deployed it (`release.py --local`, build-info
  sha 6777525). **Human gate still open:** Stop→Start the add-in, build → Ctrl+Z reverses whole frame,
  `frame_tilt_deg` persists, Ctrl+Y, rebuild, tilt=30.
- **Remaining loop list:** H1 hygiene (dispatched) → E7 Frame Inspector readability → E4 diagnostics panel.
  Off-switch: E4 reviewed + E8 human-verified → `done`.
- **Tooling note:** the `dispatch`/`gate` commands described in the advisor skill (fred-skills a7e1ef0) were
  never added to `handoff.py`; the loop runs on `pass` + self-looping `wait`.
- **Parked cleanup (not dispatched):** move the 6 `*-DESIGN.md` + audit docs into `docs/` (breaks paths quoted
  in WORK-LOG/ROADMAP — do only with a link sweep); 4 stale `.venv*` dirs at root (ignored, disk only).

## PM1 — Project Manager: restore the lost selection bar + consolidate to ONE entry (human ruling 2026-09-17)

**Bug found while answering "where are the 6 items":** commit `91b624d` (2026-05-23, labelled *fix(deploy):
self-healing wrangler shim*) also swallowed an unrelated palette-HTML change that DELETED the Project Manager's
bottom selection bar (`fmBtnLoad` / `fmBtnRename` / `fmBtnDelete` + `fmSelbarInfo`), its status bar
(`fmProjectStatus` / `fmProjectMsg`) and the hidden `fmProjectName` input. The CSS and the JS wiring stayed, all
null-guarded, so nothing errored: the manager has silently had NO Load / Rename / Delete for four months.
(Textbook index-swallow — the same defect class the advisor skill records from 2026-09-11.)

**Ruling:** consolidate — the sidebar `📂 Load` (Quick-Load) button goes away; `📁 Projects` is the single
entry and the modal regains Load / Rename / Delete. Quick Save in the navbar is untouched.
**Sequenced right after E7a** (bug + human-requested beats E7b polish). Headless-verifiable + a browser look.

## Backlog from the lane-B audit (A1, 2026-09-17) + advisor findings — seat A order after E7b
- **IN2 — inspector inline de-dup** (advisor, AST-verified): `fusion-inspector.py` still defines 10 fb_shared
  functions locally, 8 divergent; C4-S3 only switched one import. **Dispatched now.** Note: A1's reconcile marked
  STANDARDS-AUDIT §1b "resolved" — wrong for the inspector; it looked for duplicate *files*, not inline duplicates.
- **E7c — per-row copy** on the inspector's details list (through the `_pendingCopy` poll pump).
- **IN1 — B5 / A1-2** inspector `stop()` never removes `activeSelectionChanged` nor clears `_handlers` (M). Fusion
  Stop→Start verification.
- **HY2 — hygiene batch (all L):** A1-1 delete the 4 dead loader functions (`bspline-frame-builder.py:123-168`) ·
  A1-3 fix the two stale fb_shared docstrings ("no callers switched yet") · A1-4 drop 2 dead entries from
  `deploy_template_maker.verify_files` · A1-5 delete the dead `FusionIOPanel` cleanup in fusion-exporter.
- **DEP1 — A1-6** deploy has no orphan sweep (overlay copy leaves deleted sources in AddIns). Add a dest-only listing
  + warning after copy. Also: the E3 stop-first guard works (refused today while the add-in was live) — the deploy
  ritual is now "human Stops add-in → advisor deploys → human Runs".
- Still open from July, confirmed by A1: exporter.py silent-skip catch-alls (:656/:705/:440), hardcoded machine paths
  in fusion-exporter (:165, exporter.py:86).

## Backlog from the lane-B audit (A2 frame-builder, 2026-09-17)
- **A2-1 (H, live-unverified):** `frame_engine.py:240` (`_create_skeletal_parameters`) and `parametric_engine.py:246-289`
  (`_sync_user_parameters`) create the template's base parameters INSIDE the build Execute — the same pattern E8 moved
  the tilt param out of. Static fact confirmed by the advisor. Whether it BREAKS undo (tilt did: plane driven by the
  param desynced) or only leaves benign residue is a runtime question → added to the human's Fusion checklist: after
  Ctrl+Z on a fresh design's first build, are width/height/thickness still listed, and does a rebuild still work?
  If it breaks: extend F1-C (ensure the chosen template's base params at palette-open / style change).
- **FB1 — A2-3 + A2-2 + A2-5 (seat A, after IN2):** DECLARE a `deferred_compute(sketch)` context manager in
  `fb_engine` and use it for the three unprotected `isComputeDeferred` windows (`parametric_engine.py:313-330`,
  `:334-346`, `offsets.py:64-78`) so a crash mid-window always leaves the sketch live; delete the dead
  `build_context.create_or_update_param` (0 callers); reword the misleading `parametric_engine.py:123-125` comment to
  name both parameter-creation sites.
- **FB2 — A2-4 (design-first):** the two builder UIs hand-roll the same hidden-command dispatch (555 of 945 lines differ
  only in ids/names). Extract one declared helper. Gate: a plan, then Fusion Stop→Start verification of both palettes.
- **Test gap (A2):** zero coverage of `parametric_engine`, `frame_engine` param lifecycle, both UIs. Candidate for the
  breaker seat once the audit series ends.
