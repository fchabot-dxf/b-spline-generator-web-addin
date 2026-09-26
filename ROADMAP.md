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

## Backlog from the lane-B audit (A3 template-maker, 2026-09-17)
- **TM1 — A3-1 + A3-2 (seat A, next):** `template-maker.py:82-100` `_PROJECT_MODULES` is a hand-maintained list of 17
  names; `core/` has 23 modules; 5 are missing (`detection_log`, `dimension_hint`, `offset_hint`, `template_bridge`,
  `variable_scan`) so edits to them survive Stop→Start stale (B7's class, wider radius). Fix = DERIVE the list from the
  `core/` folder at import time (the list itself was the bug); delete the dead standalone `core/check_addin_sync.py`
  (0 importers, stale premise, non-recursive). Fusion Stop→Start verification by the advisor after deploy.
- **Same class, parent side (later):** `bspline-frame-builder.py:251-262` `_shared_project_names` is the same kind of
  hand list. Derive or retire once A6 (CAM-builder) says whether cross-sub bare-name collisions still exist.
- A3-3 (O(points×curves) coincidence pairing) — bounded by selection; leave.
- Pre-existing pyflakes noise in `parametric_engine.py` (4 unused locals: :126, :176, :209, :309) → HY2.

## Backlog from the lane-B audit (A4 stamp-editor, 2026-09-17)
- All L. → **HY2** gains: A4-1 delete the `reset_ui` dispatcher branch (Python door, no JS room) · A4-2 rewrite the
  stale "v1 SCAFFOLD" header · A4-3 fix or drop the runtime.js "mirrors step-editor" claim (no such add-in exists).
- **C5/EDM4 map delivered** (AUDIT-2026-09.md A4): `core/state.js` is the only writer that reshapes `P.stampLayers`
  (incl. the B6 mask-strip at :253-254); all other writers set one layer's field; 13 reader files. Input for the C5
  design pass — not dispatched.
- Noted, outside A4 scope: the three save paths (cloud-preset / cloud-project / preset managers) each hand-roll the same
  "strip `.mask` before persisting" loop → one declared serializer (P4). Candidate for the A5 turn.
- Test gap: stamp-editor's 8 unique files have zero coverage, direct or by proxy.
- **A4 drift question answered (advisor, main checkout):** regenerating the bundle (`sync_stamp_bundle.py`) reproduced all
  54 generated stamp-editor files byte-identical → no hand edits since C1. The file-level diff vs `b-spline-gen` is the
  generator's own import-path rewriting, not drift.

## Backlog from the lane-B audit (A5a b-spline-gen core+main, 2026-09-17)
- **BG1 (seat A, after HY2):** delete the two dead modules `main/preset-manager.js` + `main/cloud-preset-manager.js`
  (283 lines, 0 importers, superseded per cloud-project-manager's own header) · DECLARE one "P for persistence"
  serializer (strip `.mask`, the shape every live site hand-rolls) and use it in BOTH `core/history.js:takeSnapshot`
  (today it JSON-round-trips Float32Array masks into `{"0":…}` objects on every undo step — A5a-1) and
  `main/cloud-project-manager.js:buildSnapshot` · `b-spline-gen.py` `stop()` gains `handlers.clear()` (A5a-3, the one
  add-in that never clears).
- **A5a-5** `sendFusionPreview` sends action `'preview'`; Python has no receiver (only `preview_mesh`). Advisor decides
  wire-or-delete (see BG1 dispatch).
- **BG2 (later):** B9 (`main/main.js:136`) + B11 (`core/coords.js:14-15`, `core/state.js:264,266`) still call
  `adsk.fusionSendData` directly outside `core/fusion-bridge.js` — route through the bridge (P1).
- Correction recorded: `core/state.js:253-254` is the benign mask-strip, NOT B6; B6 lives in `editor/editor-io.js:27-49`
  (A5b verifies).
- Rebuild is debounced (50 ms scheduler) — the "every slider tick rebuilds" worry is unfounded.
- **HY3 (later, from HY2's pass-back):** `bspline-frame-builder.py` `_normalize_module_path` now orphaned (0 callers after
  the dead-cluster delete — verify, then delete) · `stamp-editor.py` header lines 4-7 still claim a step-editor sibling.

## Backlog from the lane-B audit (A5b b-spline-gen editor+palette, 2026-09-17)
- **B6 CLOSED** (`editor/editor-io.js:36-40` `serializeEditor` keeps hidden layers; every caller traced). B1/B3 remain
  "likely fixed" (4 of 20 `pushState` sites traced, no double-fire).
- **BG3 (seat A):** `b-spline-gen.py` sends `import_progress` (8 sites via `_send_progress`, :180-187) and
  `import_success` (:1319) — NO JS listener → zero feedback during a STEP import. Wire both into the palette's existing
  status affordance (see BG3 dispatch for the exact element).
- **A5b-5** `cloud-project-manager.js:887` reads `#fmCurrentFileLabel`, absent from the HTML → the "current file"
  indicator never renders. Advisor traced history (see BG3).
- **Named P1 exception (document, don't fix):** `bspline_gen_palette.html:1162-1193` defines
  `window.fusionJavaScriptHandler` inline because Fusion's palette API needs that global synchronously before any ES
  module loads. Host-bridge logic outside `core/fusion-bridge.js`, by necessity.
- L: `editor/dom.js:45` `createButton` dead · 5 over-exported editor functions · ~576 lines of inline `<style>` in the
  palette not yet checked against `styles/` · the inline "Native CAD UI Integration Patch" script vs `main/ui-bindings.js`
  possible duplication (unchecked).
- Facts: `index.html` is a 6-line redirect; there is ONE page for both hosts. `editor/` has zero host branches and zero
  C2 survivors.

## Backlog from the lane-B audit (A6 CAM-builder, 2026-09-17)
- Cleanest add-in: doorless sweep clean both directions (13 JS→Py actions, 7 Py→JS events, two palettes), no fb_shared
  duplication, zero bare-name imports, no app-level subscriptions. 0 tests (as A1 said).
- **B10 → HY3:** `cam-builder.py` `stop()` (:2211-2298) unregisters only `REFRESH_EVENT_ID` (:2284); `TPGEN_EVENT_ID` +
  `AXISPICK_EVENT_ID` are released only by the next `run()`'s re-register (:2037-2063). Add the two `unregisterCustomEvent`
  calls to `stop()`. L.
- **Parent wipe list (`_shared_project_names`):** CAM-builder contributes no reason to keep it; template-maker's own bare
  imports are the remaining one → after TM1, derive the parent list from template-maker's `core/` too, or retire it once
  template-maker imports package-qualified (TM2, design note).
- Machine coupling: "Ultimate Bee" appears ~15× in `cam_engine/setup_builder.py` (machine matching, sim-doc detection,
  default machine, WCS). Portability is a declaration job (one machine profile), not a one-line path fix. Parked.

## Backlog from the lane-B audit (A7 cloud, 2026-09-17) — AUDIT SERIES COMPLETE (AUDIT-2026-09.md on main)
- **CW1 — A7-1:** `cloud/preset-worker/src/bus-route.js` has no body-size cap on any of its 6 unauthenticated write
  routes while `index.js` and `pageviews-route.js` each declare one. DECLARE the cap once in `index.js` (it already owns
  `MAX_BODY_BYTES`) and apply it before dispatching to any route module, so no route can forget it.
- **DEP1 (widened) — A7-3 twin of A1-6:** `deploy_cloudflare.py --build-only` never cleans `dist/` (exit at :220 precedes
  the only `clean_dir` at :233) → a deleted source file stays live on the Pages site. Fix both deploys as ONE lesson:
  clean-then-copy (or orphan sweep) in `DEPLOY_bspline-frame-builder.py` and `deploy_cloudflare.py`.
- **A7-2** (accepted risk): the Appreciation Arts Plastiques routes commit to GitHub with no auth; its own comment invites
  an origin/API-key gate "if abuse ever shows up". Named, not dispatched.
- **`/presets`** is provably dead within this repo (its only caller was deleted in BG1) — retire the alias routes in the
  worker once the human confirms no other app uses them (they are the "legacy alias" the README keeps for old clients).
- **step-editor-worker + step-editor-pages:** worker code finished but never provisioned (`REPLACE_AFTER_KV_CREATE`),
  pages is README-only, the add-in it served does not exist (absorbed by stamp-editor). **Human keep-or-delete call.**
- Series summary: see AUDIT-2026-09.md "Audit series summary". Dispositions as of now — dispatched/landed: A2-3 (FB1),
  A3-1 (TM1), A5a-1/-2/-3 (BG1), A5a-5 (BG1), A5b-1 (BG3 in flight), A1-2 (IN1), B7 (E7a); closed: B6; open: A2-1 (human
  Fusion check), A2-4 (FB2 design), B10 (HY3), A7-1 (CW1), A7-3 (DEP1), A7-2 (accepted).

## E8 VERIFIED LIVE (advisor, through the Fusion bridge, 2026-09-17 09:55 — deployed sha a861273)
Scratch design; Frame Builder opened → `frame_tilt_deg` created before any build (F1-C). Build (Template 1) →
1 component `Frame_1` = tilt plane + 3 sketches, 5 timeline items, 10 more user params created by the build.
**Ctrl+Z once → timeline 0, component gone, AND all 10 build-created params gone; only `frame_tilt_deg` remains.**
Ctrl+Y → all 5 items + 11 params back. Rebuild → new component `Frame_2` (each build is its own frame; one plane per
frame). `frame_tilt_deg = 30` + rebuild → every frame plane reads 30° (all driven by the one param). **E8 CLOSED.**
**A2-1 REFUTED at runtime:** user parameters created inside the build's command Execute DO reverse with the geometry
(they are part of the command's undo unit). The tilt bug was specific to a param that DRIVES geometry created in the
same unit; UNDO-REDO-DESIGN.md's general claim ("user params don't undo like geometry") is wrong — note it there.
**Deploy ritual is now hands-free:** `stop()` via the bridge → `release.py --local` → `run()` via the bridge; the human
no longer needs the Add-Ins dialog (loader file itself only refreshes on a real Fusion restart — all changes today are
in sub-modules, which `run()` reloads).

## IN3 — Frame Inspector page is wider than its palette window (found live 2026-09-17 10:15, deployed d8a32ea)
Screen captures at palette widths 320 / 520 / 700 px all show the page laid out ~100-150 px wider than the window: the
header's build badge + bridge pulse, the "Copy Name" button and E7c's per-row ⧉ buttons sit off the right edge; the
list text wraps at a width larger than the window. Folding + labelled meta rows render correctly. Advisor's bounded
look (body width:100%, global box-sizing:border-box, .cad-dialog-content overflow-x:hidden) did not locate the cause →
UNLOCATED; dispatched as a hunt (IN3). Evidence PNGs: scratchpad `pal_0.png` (320), `inspector-screen.png` (520),
`inspector-700.png` (700). Palette restored to 320×600; scratch design closed unsaved.
- **IN3 resolved by measurement (10:35):** IN3's CSS change did not remove the overflow; docking the palette right did
  (same page, same size, everything fits — `in3-docked.png`). Cause = floating-palette rendering (page zoomed inside a
  narrower viewport), not CSS. IN3b declares the right dock on creation, as b-spline-gen does. Fusion quirk recorded here
  so nobody re-hunts it in CSS.

## FB2 status (2026-09-17 11:45)
Slices (a) scaffold+sketch (b7cd92e), (a-fix) tilt ensure restored after a live-caught regression (27bfd7c), (b) solid
(dbfed18) are live-proven through the bridge: both palettes build (sketch frame → extrude onto a picked face, 10 bodies),
Stop→Start clean. 594+351 → 415+211 lines, scaffold 319. Measured quirk: Fusion fires `documentActivated` twice per
activation (2 idempotent schema pushes; one live handler; same before the rewrite). Slice (c) = honesty sweep + prune
the replaced doc handler from `handlers` + mixin-order convention. Dispatched.

# DECISIONS 2026-09-17 15:57 (Fred, via the decision sheet https://claude.ai/artifact/5J6Tc36RbjFuf9T4FR6Do3) — the seat-A queue
Order = advisor's, cheapest-and-safest first, design-first items last.
- **DEC1** step-editor cloud pair → **delete both** (`cloud/step-editor-worker`, `cloud/step-editor-pages`). Removal sweep.
- **PM2** Project Manager doors → **top-bar icon only**, drop the sidebar Projects button; **note: give the top-bar icon
  buttons text labels on desktop / wide widths** (declared breakpoint).
- **IN4** Inspector → collapse batch rows past 5 with the count in the header (**Full Copy must still copy the whole
  list**); **drop Copy Name**.
- **UX1** Confirm before Load discards unsaved edits + a visible unsaved-changes indicator (one declared dirty state).
- **UX2** One status line for all Fusion traffic (import progress, build-stamp warning, bridge pulse).
- **FB3** Frame Builder: show the parameters a build will create, before building.
- **CAM1** CAM Builder vs CAM Studio → consolidate — design-first turn, then slices.
- Kept as-is by ruling: `/presets` alias stays; GitHub-commit route unchanged; no machine profile.
- Already done: FB2 (palette scaffold); over-exports (HY4, in flight).

## WEBSITE INCIDENT 2026-09-17 12:20 — the site had not built since JULY 12
Cloudflare Pages (`bspline-generator`, GitHub-connected, build = `python bspline-frame-builder/deploy_cloudflare.py
--build-only`, output `bspline-frame-builder/dist`) ran `npm clean-install` before every build because a root
`package.json` exists; the lock file drifted (`@emnapi/*`), so **every build since 6c1cce4 (2026-07-12) failed** while
`git push` reported success and nobody looked at Cloudflare. All of July's E-series and today's work were invisible
on the web until 16:24 today. Fix applied: Pages project env `SKIP_DEPENDENCY_INSTALL=1` (production + preview) — the
site build needs no npm packages (vitest is dev-only) — then retried; deploy success at 16:24, served bytes verified
against HEAD (fusion-log.js, state.js, cloud-project-manager.js byte-identical). Lock also regenerated (6a610b9) for
local `npm ci`; Cloudflare's older npm still disagrees with it — irrelevant now that installs are skipped.
- **DEP2 (queue, after UX2):** `release.py --web` must VERIFY the Pages deployment (poll the API for the push's
  commit → success/failure, print the reason on failure) — "push succeeded" is not "site updated". The advisor skill's
  release rule already says so; now the script must.
- **PM2b (next for seat A):** the new top-bar labels clip — `.cad-navbar .cad-nav-btn` keeps a fixed width on desktop.
  Widen in the same `min-width:601px + fine pointer` block.
- **UX3 (ruling 2026-09-17 12:45): Undo/Redo leave the sidebar control panel** → top bar, left of Save, as icon
  buttons (↶ ↷) with the PM2 label pattern (`cad-nav-label`, text on wide+mouse); ids unchanged so history.js keeps
  driving them; the sidebar's sticky header keeps only "Generate New Seed". Queue after UX1.
- **FB3 live-verified 13:00** (names + `new` chips + note; ReadOnly rows correctly chip-free). **FB3b (cosmetic, later):**
  the `new` chip stretches to the label column's width — make it `display:inline-block; width:auto`.

## CAM1 status (13:45): COMPLETE — slices (a) d714591, (b) de63098, (c) 2c7195e; live-proven through the bridge (one CAM
button, two mode tabs boot, Studio command/palette gone after Stop→Start, no false 'response' warnings). With it every
item of the 2026-09-17 decision sheet is live in both hosts.
- **DEP3 (note, not dispatched):** `release.py --web` does `git add -A` before committing — the two-seats index trap
  (advisor skill, measured 2026-09-11). Fine for a lone human; never run it while a worker seat holds the tree.
- Remaining queue: DEP2 (in flight), FB3b (cosmetic chip), then the list is DONE → advisor runs `handoff.py done`.
- **CAM1d (cosmetic batch with FB3b):** the merged CAM header is over-full at the docked 460 px — stamp on one line now,
  but "N SETUPS · READY" wraps and the PREVIEW button is clipped. Move stamp + status to their own row under the tabs
  (or hide the status text under 520 px); keep the action button whole.

# CYCLE SUMMARY — 2026-09-17 (advisor session, two worker seats)
Off-switch reached: the audit backlog and the decision-sheet queue are exhausted; COS1 (bcde691) is the last item,
live-proven. Landed today (all pushed; site deploys verified through the Pages API; add-in deployed via the bridge):
H1 · E7a · PM1/PM1b · E7b · IN2 · FB1 · TM1 · IN1 · HY2 · BG1/BG1b · BG3 · DEP1/DEP1b · E7c · HY3 · IN3/IN3b · CW1 ·
TM2 · FB2 (a, a-fix, b, c) · BG2 · HY4 · DEC1 · PM2/PM2b · IN4 · UX1 · UX3 · UX2 · FB3 · CAM1 (a, b, c) · DEP2 · COS1.
Audit: AUDIT-2026-09.md (A1-A7). Incidents: Pages builds silently failing since 2026-07-12 (fixed, verified);
advisor closed an unsaved user document by name (rule recorded in memory).
Open, not in this cycle: T1 tests on lane-b (seat B stuck on a permission prompt); CW2 worker auto-deploy needs the two
GitHub secrets set by Fred; the `/presets` alias and the GitHub-commit route stay by ruling; DEP3 note.

# SVG editor series (SE) — opened 2026-09-18 on Fred's ask "can you see a way to make it better?"
Assessment (advisor, from the code; live capture pending Fusion's Session-Suspended dialog): the advertised single-key
tool shortcuts (V/A/P/T/L/R/E) were never implemented; the Circle mode has no button; snapping is a hidden stub that
nothing reads; a duplicate `toolClear` handler; no zoom/pan, so node edits on the docked 460 px palette hit 3 px targets.
**B8 (BUGS_OPEN "editor tree duplicated into stamp-editor") is STALE:** the copy is generated by `sync_stamp_bundle.py`
and untracked since 59615fe (2026-07-11); the on-disk drift is a stale bundle, regenerated at deploy. Fred's ruling
2026-09-18: the standalone stamp-editor is out of scope for this series.
- **SE1 (dispatched):** declared `data-key` shortcuts on the tool buttons + generic keydown lookup (reuse
  `_isTypingTarget`), Circle button, snap-stub removal chain, `toolClear` removal.
- **SE2 (next):** wheel zoom + space-drag pan + Fit button on the editor canvas (svg.js viewbox is already the base).
- **SE3 (maybe):** shortcut letters shown on the buttons; 32 gated `dbg()` tracer calls (20 in text-session) — leave
  unless they get in the way.
- **SE1 live-verified 2026-09-18 08:20** (add-in 6a3911b, docked palette): Circle button in the rail; `c` → Circle mode,
  `v` → Select mode (hint + highlight follow). Two things seen while proving it:
  - **SE3a — CANCEL DOES NOT REVERT (bug, confirmed in code + live).** A stray pen stroke drawn in the editor stayed
    carved in the 3D preview after Cancel. Chain: `onChange` writes `P.editorSvg` + remasks after every edit
    (app-init.js:81-95); masks rasterize from the LIVE editor layers (`stamp-mask-manager.js:49-52`,
    `getLayerSvg(editor, …)`); the Cancel path restores `P.stampLayers[idx].svg/mask/enabled` from
    `SvgEditorSnapshot` (app-init.js:118-127) — the legacy store nobody reads any more, and `ctx.activeLayer()`
    is an EDITOR layer with no `.svg`, so the snapshot itself holds `undefined` (svg-source.js:91-97). Neither
    `P.editorSvg` nor the editor document is restored. This is C5/EDM4 (ROADMAP:114) as a user-visible bug.
    Fix = declare the snapshot as the one thing onChange writes (`{active, editorSvg}`), restore THAT + reload the
    editor document + remask; drop the legacy fields.
  - **SE3b — STYLE segmented control overlaps** ("ROKELBOTH"): the STROKE/FILL/BOTH buttons in the modal's top bar
    collapse onto each other at the palette's width. Cosmetic, CSS only.
  - **SE3a, second symptom (08:35):** Clear-all → Apply with an EMPTY canvas ALSO leaves the groove carved. Root:
    `updateStampMasks` (`stamp-mask-manager.js:40-76`) builds a work list of layers that HAVE content and returns
    early when it is empty — it never clears the `_mask` / `P.stampLayers[i].mask` of a layer that lost its content.
    So the fix is one declared invariant, not two patches: after every refresh, every layer NOT in the work list has
    its mask set to null (and the preview rebuilt). Cancel then becomes: restore `P.editorSvg`, reload the editor
    document, refresh — and the invariant clears whatever the reverted document no longer contains.
- **SE2 live-verified 08:45** (add-in 39baa37): wheel zooms about the cursor, middle-drag pans, `0` fits, Fit button in
  the rail; Cancel closes cleanly. Measured: a 200 px horizontal middle-drag moved the board ~130 px on screen
  (container wider than the 7×9 board → letterboxed on X) — the per-axis scale in `_panBy` is wrong under
  `preserveAspectRatio` meet, and `getDynamicTolerance` has the same flaw on the other axis. Dispatched to seat B as
  **T5** (declare `viewScale()` once in editor-view.js; both callers go through it).
- **Lane-b merges:** T3 (BUGS_OPEN reconciliation, daae06e) merged at 39baa37. T4 (SE3b CSS rule + B12, a287d98) is
  on lane-b, merges after SE3a lands (seat A holds main). Note: lane-b's NEXT-SESSION.md rides along in every merge
  (both seats use the same file name); harmless because the advisor rewrites it on the next dispatch.
- **SE3 live-verified 08:45** (add-in 4971b4e = SE3a + lane-b T4/T5/T6): draw → Cancel → no groove; draw → Apply → groove;
  Clear → Apply → groove gone (log: `pathCount=0`, `opaquePx=0`). STYLE reads STROKE / FILL / BOTH. B12 closes with
  SE3a (seat B updates BUGS_OPEN on its next docs turn).
- **Found while proving it (SE3c → lane-b T8):** after Clear or reopen the OLD stroke still shows as a translucent
  yellow band WITH handles, although `open()` logs `children=0`. It is a ghost: `_sketchLayer.clear()` in both Clear
  and `open()` never deselects, so `_highlightLayer`/`_handleLayer` keep drawing removed nodes. One declared content
  reset (deselect + overlay layers) called from open/Clear/deleteSelected. Not a carve bug — I first read it as one.
- **T7 (exporter paths) accepted** — with a correction of MY premise: `fusion-exporter/exported files/` IS tracked
  (147 JSON files of exported user data). Untracking it is Fred's call, not dispatched.
- **Seat A: SE4-plan** (mirror retirement design) in flight. lane-b T7/T8 merge after it lands.

## SE4 — mirror retirement (design d237761, approved 2026-09-18 09:05)
Seat A's plan inventories 84 readers/writers and found two undocumented live bugs: `takeSnapshot`'s `stampSvgText`
is always `null`, so EVERY undo/redo sets `P.stampLayers[0].svg = null` (snapshot-manager.js:41 tests `!== undefined`);
and `export-flow.js:40-44` is the one reader with no editor fallback, so after any undo Send-to-Fusion / Export-STEP
silently drops the drawing. Slices: (a) one-store reads for the compositor + export-flow, Browse imports into the
editor — DISPATCHED (turn 195); (b) drop the legacy branch + mirror writes, sidebar Clear clears real content;
(c) migration as data + persistence cleanup. **Open product question for Fred before (c):** should the palette's
global undo/redo restore the DRAWING at all, or only the heightfield (the editor has its own undo stack)? Today it
silently does neither correctly. **Noted, out of scope:** the per-layer tooling fields are persisted twice too
(`data-editor-layers` in the SVG and `P.stampLayers[i]` via `persistableP`) — a possible SE5.
- **SE4a (aeb9a53) + SE4b (fa9972a) merged and deployed 09:40** with lane-b T8 (ghost selection), T9 (BUGS_OPEN
  B12–B15), T10 (shortcut badges via `attr(data-key)`). vitest 57. Content-mirror setters gone; sidebar Clear = B15
  fixed; Browse reports "editor not ready" instead of writing to a dead store.
- **SE4c dispatched under a stated assumption** (advisor decision, reversible): the palette's global undo/redo is
  for the HEIGHTFIELD; the drawing has the editor's own undo stack. So `applySnapshot` stops touching stamp content.
  If Fred rules that global undo should restore drawings too, that is one follow-up (restore `P.editorSvg` from the
  snapshot + reload the editor) — SE4d.
- **Incident 09:20:** advisor's chained merge→dispatch conflicted on NEXT-SESSION.md and still passed the ball; seat A
  woke on a mid-merge tree. Resolved in a minute + amend sent. Rule: never chain `pass` after a merge without a
  conflict check; give lane-b its own task file name (`NEXT-SESSION-lane-b.md`) at its next dispatch.
- **Live-verified 09:55 (a006e09):** shortcut badges on all 9 rail buttons (T10); draw → Clear → OK leaves no ghost
  (T8); draw → Apply carves; the SIDEBAR Clear removes the carve AND the drawing (B15 / SE4b) — reopening the editor
  shows an empty canvas. Not exercised live: Browse (needs a file dialog) and Send-to-Fusion-after-undo (would write
  geometry into Fred's document); both are covered by tests/export-flow.test.js.
- **SE4c (629102d) deployed 10:10 as 873446d and live-checked:** palette boots through `runMigrations` on the saved
  session (no-op, `editorSvg` present), draw → Apply carves on the single-store build, Clear → Apply clears. vitest 64.
  **The content mirror is retired.** Remaining from the design: SE5 (tooling fields persisted twice) — needs a ruling.

# CYCLE SUMMARY — 2026-09-18 (SVG editor series, two worker seats)
Fred's ask: "the svg editor tool, can you see a way to make it better?" Landed and live-proven (add-in 873446d, all
pushed): SE1 declared shortcuts + Circle button + dead snap/Clear removed · SE2 zoom/pan/fit (declared view record) ·
SE3a Cancel reverts + mask-clear invariant · SE3b STYLE control rule · SE4 a/b/c content-mirror retirement (declared
MIGRATIONS, snapshot content-free, sidebar Clear = B15) · lane-b T1–T11: 21 new tests (29 → 64), DEP3 guard, exporter
paths declared, pan/tolerance scale proven wrong and fixed (T5), pan-state reset (T6), ghost selection (T8), shortcut
badges (T10), BUGS_OPEN reconciled (B1–B15). Advisor incidents: misread the stale stamp-editor bundle as a duplicate
(B8 stale); misread a ghost overlay as a carve bug (log settled it); chained merge→pass on a conflict (rule recorded);
claimed the export folder untracked without checking (it is tracked, 147 files).
**Open for Fred:** (1) global undo scope for drawings (SE4d if yes); (2) untrack `fusion-exporter/exported files/`;
(3) GitHub secrets for the worker auto-deploy; (4) SE5 tooling double-persistence — design or leave.
Seat A: DONE (cycle 100). Seat B: DONE after T11 (bb61a2e, B13/B15 closed) — both loops closed.

## SE6 — grid + snap (Fred's ask 2026-09-18 10:30) — DONE, live-verified 10:50 (add-in 1dfbfad)
`G` toggles the grid; SHOW / SNAP / spacing (1/16…1") in a GRID toolbar group derived from `GRID_SPACINGS`; minor lines
10 %, inch lines 22 %, 1 px at every zoom (`non-scaling-stroke`); pen anchors land on intersections with SNAP on;
Alt bypasses; prefs persist per browser profile; grid lives in its own layer under the sketch, never serialized.
vitest 79. **Follow-ups, not dispatched:** (a) the node tool and transform handles read the pointer through a
different path and do NOT snap yet — one slice if Fred wants node edits on-grid; (b) over the darkest bands of the
topo background the black-at-10 % minor lines vanish — a light/dark two-tone stroke or a `mix-blend-mode:
difference` on the grid layer would fix it; cosmetic, Fred's call.

# SE7 — Lattice (Fred's ask 2026-09-23, from the red/yellow/blue relief piece): B then C
Fred approved option B first: a Lattice drawing tool that emits ordinary lines/circles on lattice points (rail = drag
along a row, tie = drag along a column, click = node, click on a node = remove it, auto-nodes at tie ends and
crossings). Option C (declared pattern generator with seed, one-way into the document) follows as SE7b once B is
live-proven. Three layers carry rails / ties / nodes with their own tooling — that is the color mapping of the piece.
- **SE7a (dispatched):** lattice mode + auto-nodes + node-tool snap (SE6 follow-up a).
- **SE7m (queued after SE7a, Fred 2026-09-23: "make it work even on mobile").** Today one-finger touch draws; a second
  finger is ignored (`editor-interaction.js:233`); SE2 zoom/pan, the SE7a hover marker, Alt bypass and all shortcuts
  are mouse/keyboard only. Plan: (1) migrate to Pointer Events, one path for mouse/touch/pen; (2) declare
  `INPUT_PROFILE = {mouse:{slopPx:10,markerOffsetPx:0}, touch:{slopPx:22,markerOffsetPx:40}, pen:{slopPx:8,…}}`
  read by tolerance, handle hit radius and the snap marker; (3) two-finger = pinch zoom + pan via SE2's
  `zoomAbout`/view record; (4) touch snap marker shown during press, offset above the finger with a leader line;
  (5) 390 px layout of the editor top bar (horizontal scroll or a "⋯" overflow for contextual groups), decided from a
  capture; shortcut badges hidden under `@media (hover:none)`. Not amended into SE7a (input layer under it).
- **SE7s (queued FIRST after SE7a, before SE7m; Fred 2026-09-23: "the scale feature is not using the anchor for
  direction").** Confirmed in `editor-transform-handles.js:179-184`: a corner drag takes the ratio of whichever axis
  the POINTER moved more on (`useX = |nx-ox| >= |ny-oy|`), not the drag along anchor→handle. Measured: a 0.02×3 tie
  dragged 0.3" sideways from its corner scales ×15 (projection gives ×1.00); a box jitters ×1.49↔×1.52 as the
  dominant axis flips. Fix (declared): corner factor = projection `(n·o)/(o·o)` onto the anchor→handle vector; side
  handles unchanged. Second defect: handles live on the WORLD-aligned bbox and scale along world X/Y, so a side
  handle on a rotated element shears it into a parallelogram. Fix: single selection → handles in the element's own
  frame (decompose m0 into rotation + scale, anchor/handles from the local bbox, delta composed in local space);
  multi-selection keeps the world frame. Pure math in a leaf with vitest (box, thin tie, rotated 30° tie keeps right
  angles).
  **SE7s scope widened (Fred: "scaling on tie shouldn't actually scale").** A handle drag must never scale the
  STROKE — stroke width is the carve width. Declare the edit per element kind instead of one scale transform for all:
  `HANDLE_EDIT = { line:'endpoints', circle:'radius', rect:'geometry', path:'geometry', polyline:'geometry',
  text:'scale' }`. `line` (every rail/tie) → the dragged handle moves ONE endpoint along the line's own axis (length
  only, snapped per SNAP_POLICY, the other end is the anchor); `circle` (nodes) → radius only, centre fixed;
  `geometry` → scale baked into the coordinates at drag end (flattenTransform path) so stroke width is unchanged;
  `text` keeps today's transform scale. The projection/rotated-frame fixes above still apply to `geometry`.
  Multi-selection of mixed kinds: each element edited by its own rule from the shared anchor.
  **SE7s, stroke rule confirmed in code (Fred: "scaling shapes shouldn't scale stroke anywhere").** Today it does:
  the scale is carried as a `transform` with no stroke compensation, so the editor view AND the stamp raster (which
  renders the transformed SVG) scale the stroke — non-uniformly on a side handle; Flatten (`bakeMatrixIntoElement`,
  editor-transform-handles.js:281+) then bakes the geometry but keeps the OLD `stroke-width`, so the stroke silently
  jumps back — the same shape carves differently before vs after Flatten. Rule for SE7s: `geometry` edits are baked
  into the coordinates on EVERY drag move from the drag-start geometry snapshot (no scale transform survives a
  handle drag), so stroke width is invariant during and after. `vector-effect:non-scaling-stroke` is rejected: it
  fixes width in screen px, which would make carve width depend on zoom. Test: after a ×2 side-handle drag,
  `stroke-width` attr unchanged and no `scale` left in `transform`.
- **SE7n (queued FIRST after SE7a, before SE7s; Fred 2026-09-23: "the node tool can't drag nodes").** Three defects,
  all in the drag path (`editor-interaction.js` `dragNode`, `editor-hit.js` `getNodes`): (1) rect/circle/ellipse get
  node handles from `getNodes` but `dragNode` has no branch for them — grab turns red, nothing moves (every lattice
  node is a circle); (2) `getNodes` maps nodes to WORLD via `worldPoint`, `dragNode` writes the world pointer into
  LOCAL attrs without the inverse of `el.matrix()` — any element moved with Select (translate transform), scaled or
  rotated jumps by its transform offset; (3) `getNodes` indexes only M/L/C/Q segments while `dragNode` indexes the
  full `el.array()` — after the first Z/H/V/A/S/T the wrong segment is edited (filled pen shapes, Expand output).
  Fix (declared): one node model — `getNodes(el)` returns `{x, y, set(localPt)}` per node (the setter closes over
  the real segment index / attribute pair; circle = centre, rect = corner with the opposite corner pinned), and the
  drag maps the pointer through `el.matrix().inverse()` before calling `set`. Tests: moved line endpoint follows the
  cursor; circle centre moves; closed path — dragging node k edits segment k's endpoint, not k-th array entry.
  Order now: SE7a → SE7n → SE7s → SE7m → SE7b.

## SVG editor audit (AUDIT-SVG-EDITOR.md, seat B T12 cf16467) — 47 findings, merged 2ea481e
Advisor spot-checks on main: SA-ROUNDTRIP-1 CONFIRMED (`_bakeMatrixIntoPath` transforms EVERY numeric pair of a
segment as a point — for `A` that mangles rx/ry, x-rotation, both flags; shapeToPath emits two arcs per circle, so
every circle/lattice node reaches Fusion corrupted while editor + preview look right); SA-UNDO-2 CONFIRMED
(`setStrokeWidth` has no pushState/_onChange); SA-TEXT-1 CONFIRMED (Cancel calls only `_onCommit(null)`);
SA-LAYER-1 CONFIRMED (export tooling from the fixed 3-entry `P.stampLayers`, layers 2/3 default `enabled:false`,
layer 4+ → `{}` — a lattice split over three layers exports only layer 1). Audit's "SNAP_POLICY doesn't exist" is a
stale-HEAD artefact (audited before SE7a merged). SE7n (5cea9dd) accepted: node model with setters, inverse-matrix
drag, 113 tests.
Slices: **SE8a** (seat A, dispatched) carve correctness — declared PATH_LAYOUT shared by getNodes + bake, circles →
cubics, A→C before baking, stroke width/color undo + change, Cancel teardown, font-defs accumulation. **SE5-plan**
(seat B, dispatched) — tooling single store on the editor layer (SA-LAYER-1/2/3). Then SE8b (hit-test/expand
coordinate spaces SA-COORD-3/4, `_onChange` per-move throttle SA-UNDO-1), SE7s, SE7m (+ all SA-MOBILE), SE8c
declarations + dead-code sweep (SA-DECL-*, SA-DEAD-*), SE7b.
- **SE5 design approved (be5dc37, seat B T13):** editor layer = the only tooling home; `enabled` merges into the
  layer's `visible` (hidden layers are already never carved — audit SA-ROUNDTRIP-4); fixed 3-entry `P.stampLayers`
  narrowed to a pre-load display fallback. **Advisor ruling on its open question (reversible, like SE4c):** a
  tooling-slider change is undone through the EDITOR's undo stack; global Ctrl+Z stays heightfield-only. Slices:
  (a) updateP / isFilletActive / Browse+Clear writers — dispatched to seat B on lane-b (no file overlap with SE8a);
  (b) export-flow + cloud-project-manager (fixes "only layer 1 carves"); (c) enabled deletion + migration + undo.
- **SE5 undo ruling REVERSED (advisor, 2026-09-23, after Fred asked "so what makes sense").** Rule: *undo follows
  where the change was made.* Sidebar tooling sliders (depth/profile/angle/…) → the palette's GLOBAL undo, like every
  other sidebar slider; drawing content edited in the editor modal → the editor's own stack (SE4c unchanged). The
  earlier ruling (tooling on the editor stack) was wrong: that stack exists only while the modal is open and is
  wiped by `open()` (SA-TEXT-4), so a sidebar depth change would have been un-undoable. Slice (c) therefore extends
  `takeSnapshot`/`applySnapshot` to capture/restore `editor._layers` TOOLING fields (not content). Slice (a) is
  unaffected (no undo code).
- **CORRECTION to the reversed ruling above (North Star evidence check, same day).** Its premise "every other sidebar
  slider already goes through the global undo" is FALSE: `takeSnapshot` is called only by sculpt stroke
  (`core/sculpt-interaction.js:104`), sculpt clear (`:146`) and the initial snapshot (`main/app-init.js:164`) — NO
  sidebar slider creates an undo step today; slider values only ride along inside the next sculpt snapshot.
  Proposal (awaiting Fred's yes, it is new behaviour for EVERY slider): **UX-UNDO** — declare `UNDO_SCOPE` once
  (control group → `'global' | 'editor'`: sidebar sliders + seed + filters + per-layer tooling → global, drawing →
  editor, sculpt → global) and make sidebar sliders undoable at ONE step per committed value (`change`, not `input`).
  SE5 slices (a)/(b) are unaffected; SE5c only registers tooling in UNDO_SCOPE.
- **SE8a (60cb373) + SE5a (527ade1) + SE5b (2141ddf) merged → 898ee73, 145 tests.** Circles/arcs now carve correctly
  (declared PATH_LAYOUT, arcs→cubics before bake, circles as 4 cubics); style-edit undo; Cancel ends text sessions;
  font defs deduped. Per-layer tooling read/written on the editor layer everywhere export/cloud look (layers 2, 3, 4+
  now export; reorder-safe). Left over: `setStrokeColor` has no callers (→ SE8c dead-code); SA-TEXT-3 (→ SE8b).
  Next: SE8b (seat A) — SA-COORD-3, SA-COORD-4, SA-UNDO-1, SA-TEXT-3. Mobile CSS (seat B) — SA-MOBILE-13/8/4/5.
  SE5c waits on Fred's UX-UNDO answer.
- **SE8b (812b424) + T16 mobile CSS (04d5087) merged.** World-bbox hit-test + one `toLocal()` helper, Expand framed in
  world space, declared `_notifyChange('live'|'commit')`, fonts orphan skip; touch-action scoped, 44 px rail on coarse
  pointers, layer delete visible on touch. **Follow-up SE8b-2 (after a live measurement):** 'live' still runs the FULL
  `_onChange` pipeline (remask + rasterize + save), only capped at one per frame — make 'live' preview-only and
  leave remask/save to 'commit'. SE7b design (89a48b4) approved; rulings: `ties.anchor` as data (default 'rails'),
  occupied-cell skip in slice 2. SE7b slice 1 → seat B. SE7s → seat A.
- **SE7s (eea4acc) + SE7b slices 1–2 (8354a5c, 9ec4635) + SE8c part 1 (e2c7d6d, 4e60b9c) merged → 215 tests.** Handles:
  declared HANDLE_EDIT, projection corner, rotated frame, stroke never scales. Pattern: pure computePattern + Generate
  into Rails/Ties/Nodes with ownership + occupied skip, persisted in the document. Cleanup: dead chains, dbg gates, one
  font list. Next: SE7b slice 3 (seat B: detach hook + panel + restore active layer), SE8d (seat A: SA-ROUNDTRIP-2
  rotated text carve, SA-DEAD-2 editor.js leftover, unreachable `setStrokeColor`). Then SE7m (mobile JS), SE8b-2.
- **SE8d (e5f26e6) + SE7b slice 3 (3f22753) merged → 231 tests.** Rotated/scaled text bakes as glyph outlines for
  Fusion (only when needed); dead leftovers gone. **The Lattice pattern generator is complete** (panel in the modal,
  Generate/Regenerate, detach-on-drag, Detach all). In flight: SE7m (seat B). Next for seat A: SE8e — SA-TEXT-4
  "Un-expand" (decode `data-original-text-svg` back to editable text). Remaining after: SE8b-2 (needs live measure),
  SE8c part 2 (SA-DECL-1..4 in editor-interaction/editor-ui — after SE7m lands, those files are seat B's now).
- **SE8b-2 (f0f74ba) + SE7m (c42dfea) merged → 264 tests.** Declared CHANGE_PIPELINE (no localStorage write during a
  drag) + `PERF` debug category for per-step timings; the editor works with fingers (Pointer Events, INPUT_PROFILE,
  pinch/pan, offset touch marker, on-screen Copy/Paste/Select all/Cancel/Lock). In flight: SE8c part 2 (seat B).
- **Known flake (3 occurrences, 2026-09-23/24):** the FIRST `npx vitest run` after a large file change sometimes
  reports every file failed with "no tests" and no error text; an immediate rerun on the unchanged tree passes (4th time 2026-09-24: TWO consecutive failed runs right after a
  merge, then clean — 281 green). A vitest/Windows cold-start artefact (likely fresh-file scanning/locking), not a code signal — rerun (or `--reporter=verbose`) before treating a whole-suite
  failure as real; a real failure names a test, this one names none. (Worth a look if it starts happening on unchanged trees.)
- **SE8c part 2 (de00376) merged → 281 tests.** DRAW_SHAPES, TOOLBAR_GROUPS, ELEMENT_CAPS declared; remaining
  tolerances named. **The SVG editor audit is closed** except SE8b-2's live tuning (needs Fusion). Both seats idle;
  open rulings for Fred: tie anchor default, slider undo (UX-UNDO → then SE5c), Fusion bridge for deploy + PERF.

## Live browser test 2026-09-24 (headless Chrome via `scripts/smoke-editor.mjs`, site 3a99ef8)
Flow works (Lattice tool → Pattern panel → Generate: 19 rails / 6 ties / 12 nodes, all owned, Rails/Ties/Nodes layers,
no console errors, desktop + 390 px). But the RESULT is not usable, and the phone layout is broken:
- **SE7c (seat A):** generated rails take the editor's current stroke width (0.5") on a 0.5" rail pitch → rails merge
  into one mass; nodes r = 0.05" (thinner than the lines); first rail at y=0 and nodes at x=0 → cut in half by the
  board edge. The hand-drawn Lattice tool shares `emitSegment`, same issue.
- **SE7p (seat B):** at 390 px the Pattern panel takes the full width and the canvas is off-screen; Nodes checkboxes
  overlap their labels (desktop too); Regenerate label invisible (white on white); reroll button clipped; an emulated
  two-finger pinch left zoom at 1 (real bug or emulation gap — verify).
Add-in deployed 3a99ef8 (bridge back after reboot).
- **Scope check (Fred, 2026-09-24: "I just wanted grid snap").** The pattern generator (SE7b, option C) was built
  without an explicit yes — advisor overreach, recorded. SE7c (pattern proportions, stash@{0} on main) and T24 (pattern
  panel on phones) are HELD. Fred then said "continue with audit fixes": SE8b-3 (measure + cheapen the live drag
  pipeline, seat A) and T25 (prove pinch-zoom on a phone + layers at 390 px, seat B). Pattern generator's fate (remove /
  hide / finish) awaits Fred.
- **Fred's ruling 2026-09-24: "finish lattice too"** — the pattern generator STAYS and gets finished. Queue: SE7c
  (seat A, resume stash@{0}: LATTICE_STYLE + margin) after SE8b-3; SE7p (seat B, resume T24: panel as a sheet on
  phones — root cause already found: no responsive rule targets `.editor-lattice-panel`, its content height starves the
  canvas at ≤720 px) after T25. Tie anchor default stays 'rails' until Fred says otherwise.
- **SE8b-3 (848b910) accepted:** live drag frame measured at ~3.1 ms median / 6.4 ms p95 (remask 2.6 ms) on a lattice-
  size drawing in headless Chrome — well under 16 ms, nothing changed. Caveat: not yet measured on a dense drawing in
  Fusion's embedded browser (PERF is there when needed). **Found while measuring — CONFIRMED by advisor:** `editor.js`
  imports `selectAdd`/`selectMany` from editor-ui.js but never defines `editor._selectAdd` / `editor._selectMany`, so
  Ctrl+A (guarded) silently does nothing, Shift-click add THROWS (`editor-interaction.js:536`, unguarded), marquee
  (`editor-marquee.js:108-110`) and paste can't select their results. Likely lost in the old silent-truncation episode
  (0b40db9 restored the comments, not the methods). → SE8f, first in seat A's next task.
- **SE8f (3e2d900) + SE7c (8cd49ca) accepted → 297 tests.** Multi-select restored (Ctrl+A, Shift-add, marquee, paste) plus
  a second marquee-additive ordering bug seat A found; lattice proportions declared (LATTICE_STYLE rail .28 / tie .22 ×
  spacing, node r .30) with a 1-cell margin — smoke screenshot shows distinct rails, ties and nodes. Remaining: T25 +
  SE7p (seat B). Permissions: Fred runs auto mode — the allow/ask lists were removed from both trees' `.claude/settings.json`
  on his instruction; only the four `.env` deny rules remain.
- **SE9 — colors on vectors (Fred 2026-09-24):** per-ELEMENT color, "for simulation, in editor only" — a display
  aid, never a carve input. Spacing options: Fred said "don't worry" (none). Carve is color-blind already: the stamp
  rasterizer reads alpha only (`core/stamp/index.js:2,165`, `sdf.js:38`), Fusion's importer takes geometry.
- **SE10 — sidebar layer browser (Fred 2026-09-24, screenshot of the "Active Layer" dropdown + "On" box):** replace the
  dropdown + checkbox with a real layer list (eye = visible = carved, per SE5; tap row = active; name + tool + depth per
  row, "+" adds). ONE list component shared with the editor's Layers panel (`renderLayersPanel`, layers.js:303). Seat B.
- **Fred 2026-09-24 — vectors in the 3D preview + two layer switches (answers):** vectors shown FLAT ON THE GRID below
  the model; each layer gets independent SHOW (`visible`: editor, 3D overlay, Fusion-sketch + SVG export) and CARVE
  (new `carve`, default true, migrated from visible) — amends T26 (seat B). **SE11 (seat A, after SE9):** 3D preview
  overlay — the SHOWN layers' vectors drawn as lines on the ground plane under the model (core/preview), each element in
  its SE9 color, updated on layer/content change, a preview toggle.
- **SE11 REDEFINED (Fred: "can the colored vectors drape over the mesh… not all the time… a tag for 3D is good"):** no
  ground-plane overlay. SE11 = drape: render the colored vectors of layers tagged `drape3d` (and shown) into a canvas
  texture mapped onto the model's TOP surface (planar UV — the top is a heightfield seen from above), so lines follow the
  relief exactly; off when no layer is tagged. The tag lives in the SVG editor's Layers panel; the sidebar shows a badge
  only (T26 amend 2, seat B). Seat A after SE9.
- **SE11 drape modes (Fred):** per-layer `drape3d: 'off' | 'plain' | 'color'` — 'plain' drapes in one neutral line
  color, 'color' in each element's SE9 color (T26 amend 3 stores/cycles it; SE11 renders).
- **Drape controls final (Fred):** two toggles on every layer row, sidebar AND editor (shared list): 3D (`drape3d`)
  and color (`drapeColor`, disabled while 3D is off) — supersedes the editor-only pill / 3-state tag.
- **Color toggle independent (Fred):** per-layer `showColor` (default true) shows element colors wherever the layer is
  drawn — editor canvas and 3D drape; off = neutral color, display-only (stored colors untouched).
- **Layer toggles FINAL (Fred: carve and 3D are the same):** 👁 visible · 3D (= carve) · ■ showColor. Colored drape on
  the mesh when carve && showColor && visible. `drape3d` dropped. SE11 renders the drape from that rule.
- **👁 is the master (Fred):** carved = visible && carve; drape = visible && carve && showColor; export = visible.
- **Advisor pacing lesson (2026-09-24):** T26 received 8 amendments redesigning ONE layer row inside one turn (each of
  Fred's refinements relayed live). Seat B rightly checkpointed at amend 5 and refused to chase 6-8. Rule: while a
  design is still moving with Fred, settle it WITH him first (mockup + questions), then dispatch ONE spec; relay
  mid-turn only blockers. T27 = the consolidated final row.
- **Drape shading (Fred):** the drape must be SHADED — it replaces the surface base color (mix by alpha) before
  lighting, so color follows the relief; not emissive (washes out, black invisible), not unlit (flat sticker).
- **2026-09-24 — lattice + color series complete, deployed 41990f3 (395 tests):** SE11e drape = lit Phong overlay (shaded,
  black visible, no z-fight, ≥2× texture) verified live in Fusion; T28 color dropdown mosaic (32 + recent + custom);
  T27 layer row 👁 master · 3D · palette; drape orientation settled by data (SE11c). Both loops signed DONE.
- **Rule change (Fred 2026-09-24):** drape = showsColor(l) (visible && showColor) — 3D off + palette on paints the
  relief without carving. SE11f (seat A). Sidebar layer list moved up + full names = T29 (seat B).
- **Fred 2026-09-24:** slider undo YES → UX-UNDO + SE5c (seat A). Ties: NOT limited to rails but ends SNAP to a rail when
  within 1 row (declared railSnapRows) — generator + hand-drawn Lattice tool (seat B). Grid contrast: options offered.
- **Grid contrast (Fred, final — invert withdrawn): hover feedback instead.** Leave the grid faint; under the pointer,
  highlight the grid row + column lines through the nearest intersection and that intersection (node) itself, readable
  on any background (light core + dark outline). Pure part: nearest lattice lines/node for a point. Hidden on pointer
  leave / grid hidden; drawn in _handleLayer like the snap ring (never serialized). SE6c, first seat to free up.
- **2026-09-24 — UX-UNDO + SE5c (7165b23), T30 tie rail-snap (24bd177), T31 grid hover (ee32c8b) merged → a8c5ad1, 453
  tests, deployed.** Note: inside Fusion, Ctrl+Z is captured by the host — use the palette's Undo button (top bar).
- **Fred 2026-09-24:** Generate rolls a new seed each press (SE7g); the pattern uses per-kind colors chosen in the Pattern
  panel (rails red / ties yellow / nodes navy defaults, same mosaic picker), recolor without reseed — SE7g amend.
- **HARD RULE (Fred 2026-09-24): no Fusion.** Fred is using Fusion — advisor and workers must not call fusion_execute /
  fusion_screenshot / release.py --local / stop-run the add-in until Fred says otherwise. Live checks via the browser
  (scripts/smoke-editor.mjs, repo-root serve).
- **Fred 2026-09-24 hard requirement: straight lines stay straight lines, arcs stay TRUE arcs** (export + live expand).
  SE8a's arcs→cubics bake over-approximates: the carve matrix is a similarity, so keep A arcs (and circles) exact and
  fall back to cubics only for non-uniform transforms. Live expand must be ANALYTIC (line → 2 lines + 2 arcs), not the
  raster-trace Expand. Folded into T33 (SE12 design); open: does Fusion's SVG import keep A as arcs?
- **Fred blocked (2026-09-24): generated lattice pieces can't be moved** — other layers are unclickable (inactive-layer
  pointer-events) and Generate restores the previous active layer. Fix queued as an SE7h add-on: Select/Nodes click any
  shown element and activate its layer; drawing modes stay on the active layer.
- **Fred 2026-09-24: all lattice geometry on ONE layer** ('Lattice', created on first Generate, made active after
  Generate so pieces are immediately movable). Per-kind colors stay (element color). Old 3-layer patterns migrate on
  next Regenerate. Queued as SE7i after SE7h; width source (toolbar STROKE vs a Widths row) awaiting Fred.
- **SE7i spec settled with Fred (2026-09-24):** one 'Lattice' layer, active after Generate; connected editing in the
  Lattice tool (drag a rail → ties change LENGTH not width, nodes follow; ties slide along rails; attachments derived
  at drag start); widths default = Widths row pending Fred. Task text staged; dispatch after SE7h.

## Queued — MOB2: mobile pass on today's features (Fred 2026-09-24: "make sure it's mobile friendly and deploy to cloudflare")
Live pages.dev check at 390x844 touch (advisor, after c932646): lattice Generate/pinch/touch actions work. Found:
- undo/redo floating pill sits ON TOP of the editor's Layers panel header (covers "LAYERS" + its add button);
- editor header overflows: Cancel clipped, **Apply Stencils off-screen** (the one commit action);
- editor Layers panel squeezed into a thin strip between canvas and the Pattern sheet;
- unverified on phone yet: sidebar layer row toggles (3D/palette), Fusion geometry picker, Pattern panel Widths row
  (desktop shot shows Widths overflowing its column: "Nc" clipped at right), rail-end checkbox.
Next seat-A task after SE7j. Browser proof at 390x844 and 768x1024, before/after screenshots.

## DONE 2026-09-24 — SE12 live expand, end to end (0258941)
Per-layer Fusion Geometry pick (Centerline / Outline / Both, never automatic) → visible commit-only preview → Fusion
export swap. Outlines: lines, rect, circle, ellipse (biarc), any path (exact L/A, curves biarc-fit ≤ 0.001"), text
(glyphs). Advisor-verified in Fusion: the baked export imports as 144 SketchArcs + 40 lines, 0 splines, 11 profiles,
correct inch scale (rect corner arcs r = 0.05" = w/2). Side fix: SVG text rendered in the UI font for years
(base.css `*` reset beat presentation attributes) — fixed at source (T42); carve was always right.
Also done today: SE7h/i/j connected lattice (active layer, per-layer settings, Widths, grid-point attachment, upright
node drag), MOB2/MOB2b mobile pass, layer toggle styling. Add-in deployed at 0258941.

## Queued — SE14: SHAPE LATTICE tool (Fred 2026-09-25, supersedes the "Silhouette tool" note)
Fred: "the shape lattice and lattice box are different" → TWO tools sharing one engine:
- `#` Lattice (box): today's tool, fills the board rectangle; the SE13 Boundary row moves OUT of it.
- Shape Lattice (new tool, own rail icon + drawer tab/panel): SHAPE section + the same Fill settings (spacing, rails,
  ties, nodes, colors, widths, ending rule, border) + Generate. Shape source = generate a mirrored hourglass/bust
  silhouette (seed, neck/chin/waist proportions) OR pick any closed shape drawn on the canvas.
- Fred: "shape tool just has more settings for shape refinement, perhaps per shape segment toggle for curve, straight
  or kinked line" → per-SEGMENT style: straight | curve (true arc, bulge in↔out) | kink (sharp corner in/out); pick a
  segment from the list or by tapping it on canvas; mirrored pairs change together; corner rounding radius.
- Output stays exact (L + circular A) → exact carve/Outline export/Fusion; result is an ordinary node-editable path.
- Source: lane-b reference/svgcreator-deployed/ (pathloop.js style table, utils.js resolveGenerator, main.js chin/neck)
  + C:/Users/danse/APPS/SVG creator/src/envelope.js (waist controls). Next: seat B design doc after T50.

## Queued — SE15: send Lattice/Shape as real Fusion CONSTRAINED sketches (Fred 2026-09-25)
Fred: "when using lattice and shape we could send the sketches as actual Fusion constrained sketches" … "no need to
fully lock them though". Instead of SVG import (plain curves), the app writes a declared SKETCH MANIFEST
(entities: lines/arcs/circles; constraints: tangent, coincident, horizontal/vertical, symmetric, equal, tie-end-on-rail;
a few named parameters where natural, e.g. waist_depth, spacing) and the add-in builds it via the Fusion API —
reuse frame-builder's fb_engine sketch-building where it fits. PARTIALLY constrained by design: keep relationships so
it drags coherently in Fusion; don't dimension everything (no over-constraint, light solver load on big lattices).
Order: shape presets first (small, clear win), lattice second (+ plain-geometry fallback for huge lattices).
Outline/inlay geometry: offsets of the constrained centerlines where feasible. After SE14. Needs Fusion verification
(advisor) — workers stay browser/no-Fusion.
- Fred: "if possible add a dimension for stroke width and make it a param" → stroke = DIMENSIONED OFFSET of each
  centerline (distance = width/2), driven by Fusion USER PARAMETERS per kind: rail_width, tie_width, node_radius
  (+ border_width for the shape border); a piece with its own width gets its own dimension. Round caps = half-circle
  arcs tangent to the offsets, centred on the centerline ends. Verify in Fusion how the offset constraint scales to
  hundreds of pieces; fallback = per-piece width dimension driven by the same parameter.
- Fred: "no length needed though" → NO length/position dimensions on rails/ties/nodes; only WIDTH (offset) dimensions
  + the few shape params. Lengths/positions stay free (relationship constraints only).

## Queued — MOB5 (seat A, NEXT after MOB3b, before MOB4): mobile pan & zoom (Fred 2026-09-25: "pan and zoom
(pan should be integrated in 2-finger interaction) doesn't work well in mobile")
Root cause (advisor, editor-interaction.js ~:160-175): the two-pointer handler only ZOOMS — zoomAbout(view, pivot at
the current midpoint, factor) — with no TRANSLATION term, so sliding two fingers without spreading them (factor ≈ 1)
does nothing: there is no two-finger pan. Fix: each frame apply pan = Δmidpoint (screen → model units) AND zoom
about the new midpoint; clean start/end (no jump, no stray draw when a finger lifts). Also check: one-finger drag on
empty canvas in Select mode (pan or marquee — declare which on touch), the main-screen 3D preview's touch controls
(rotate / pinch / two-finger pan), and that the PAGE never scrolls/zooms instead of the canvas (touch-action,
viewport meta). CDP touch tests: two-finger slide pans by the right amount, pinch keeps the point under the fingers
fixed, combined gesture both.

## Queued — MOB4 (seat A, after MOB3b): landscape side-by-side + double-tap handle (Fred 2026-09-25: "yes ok")
1. Phone in LANDSCAPE (coarse pointer, height ≤ ~500px): editor and main screen go side-by-side — canvas/preview left,
   the tool panel/sidebar right (scrollable), a vertical splitter handle between them (same makeSplitter, axis 'x').
2. DOUBLE-TAP the handle (either orientation): jump to canvas-max ↔ settings-max (declared snap targets), single tap
   keeps its current cycle behaviour.
Later if still needed: floating mini-preview while adjusting a slider with the panel tall; Sparse/Medium/Dense presets.

## Queued — UI1 (seat A, after MOB4): ONE segmented-control style app-wide (Fred 2026-09-25)
Fred picked layer-row style "C1 — soft segmented" (outlined group, thin dividers, ON = light-blue tint + blue glyph,
OFF = grey; ~30px visible cell, ≥40px tap area) and: "I guess it can be the general look too, right". → Declare ONE
segmented component (CSS class + tiny helper if needed) and use it for EVERY choice control: toolbar Stroke/Fill/Both
and Show/Snap, Lattice (Add Rail/Tie/Node, Horizontal/Vertical, Count/Every, Count/Density, Cells/Rails), Shape
Lattice (Hourglass/Bottle, straight/curve/kink bar), Fusion Geometry, Boundary/Ending choices, the layer row
[👁|3D|🎨]. Actions (Generate, Apply Stencils, Regenerate, Detach) keep their button look. Retire the per-control
variants' CSS (no dead styles). Reference mock: scratchpad layerrowsC.html (.C1). Before/after screenshots desktop +
phone.

## Queued — SE15b: Shape Lattice CONTOUR (hourglass/bottle outline) as constrained Fusion geometry (Fred 2026-09-25)
Advisor MEASURED arc slots in Fusion: `sketch.addThreePointArcSlot(p1, mid, p2, width, True)` inserts correctly
(centerline r=1, sides ±w/2, end caps w/2); width dimension .parameter.expression = param works; on a width edit:
centerline free or center-only fixed → LOPSIDED; all 3 points fixed → BROKEN (cap grows, sides don't); **both
centerline END points fixed → grows EVENLY** (0.908/1.108 around 1.008). Same anchoring rule as straight slots.
Plan (default = slot chain, Fred: "some of it is already slot parts" / "slot has an arced slot tool"): straight contour
segments = center-to-center slots, shoulder/waist/hip = 3-point arc slots, centerline END points anchored, widths =
border_width (or stroke_width), joints = separate points + explicit Coincident + Tangent on the centerlines, a vertical
construction line + Symmetry for left/right, a few named params (waist_depth, waist_height, corner_radius).
DECIDED (Fred: "it can be separate slot parts"): slot chain, overlapping joints accepted; no closed-loop offset. After T64.

## Queued — SE14b: Shape Lattice CONTOUR as separate selectable SEGMENTS in the app (Fred 2026-09-25)
Fred: "then we should also represent those separations in the add-in preview, to be able to select segments and color
them". The generated silhouette is emitted as ONE ELEMENT PER SEGMENT (line / circular arc, round caps, stroke =
stroke_width or border_width, colour per segment) instead of one path — each selectable, recolourable, shown per
segment in the drape/3D preview and exported per segment (→ one Fusion slot each, SE15b). The fill boundary = the
segments chained into one closed loop (derived, not stored twice). Straight/curve/kink styling stays mirrored per pair;
COLOUR is per segment (left ≠ right allowed). Hand node-edit still detaches from the generator. Pair with SE15b.

## Queued — SE16: ✂ CUT tool (and Join) for rails/ties/lines — MAIN TOOL RAIL ONLY (Fred 2026-09-25)
Fred: "a tool to separate slot rails and ties lines into shared coincident points ... in both lattice and main tool
sidebar, so I can keep parametrability in lattice". → ✂ Split tool (main tool rail + Lattice/Shape Lattice panels):
tap a joint (node / tie-rail meeting) → the rail/tie through it splits there into separate segments (each its own
element in the app, its own SLOT in Fusion; joint = separate points + explicit Coincident, deletable in Fusion). Lattice
panels also get "Split all at joints". Segments KEEP LATTICE MEMBERSHIP (declared group id, e.g. data-rail-id): dragging
the rail moves all its segments, outer ends still stretch, stroke_width drives all; each segment selectable/colourable.
Join = tap the joint again (or "Join" action). Fred: "like a cut tool" → tap ANYWHERE on a line to cut there (snaps to joints then grid points; Alt / Snap-off =
free); Fred: "we don't need it in lattice if it's not needed for keeping structure" → main rail only, NO lattice-panel
button and NO "Cut all at joints"; the tool itself preserves lattice membership when cutting a rail/tie; tap a cut point again with the tool = Join. Default: cut
segments move together as one rail (Fred to confirm vs fully independent). Works on any plain line too (main tool). After SE14b/SE15b (same "one piece → segments" idea).
