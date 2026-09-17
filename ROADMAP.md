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
