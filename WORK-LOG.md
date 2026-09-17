# WORK-LOG (worker's log — advisor READS, never edits)

Append one entry per task turn: what you did, why, what you verified, and any
surprises / gaps. Bug or principle smells you spot mid-task go here, parked for T2 —
do not fix them in a report turn.

---

## Turn 1 — T1: Architecture report (read-only) — DONE

**Deliverable:** `ARCHITECTURE.md` at repo root, covering items 1–5 with the two
invariant seams made explicit (fusion-bridge contract §1.3, hot-reload lifecycle §2).

**Method / why this shape.** Read the two seam-bearing files + the parent add-in
MYSELF (ground truth, since the advisor spot-checks those): `core/fusion-bridge.js`,
`b-spline-gen/b-spline-gen.py` (palette reg + `PaletteHTMLEventHandler` dispatch),
`bspline-frame-builder.py` (whole lifecycle), plus `main.js`/`bspline_gen_palette.html`
for the inbound-handshake JS side. Delegated the breadth-only surveys (6 sibling
palettes; `cloud/` + deploy scripts) to two read-only Explore subagents so I could
keep the seams in my own context. Then VERIFIED the load-bearing agent-sourced claims
against source before trusting them in a durable doc: duplicated shared-name modules
exist (`find`), frame-builder UI modules have no top-level `run/stop` (`grep`).

**Surprises / gaps (documented in the report):**
- `dist/` is a **filtered file-COPY** of `b-spline-gen/html/` + `styles/`
  (`deploy_cloudflare.py:148,175-185`), NOT a compiled bundle. This is the hard
  evidence for "one frontend, two hosts" — same unbuilt ES modules serve both.
- Two distinct consolidation categories the README doesn't mention:
  **parent-owned** (b-spline-gen + the 2 frame-builder palettes — parent registers
  their commands from the `COMMANDS` table, they have no own `run/stop`) vs
  **self-driven** (the other 5 — parent calls their own `run()/stop()`).
- READMEs are stale/aspirational (see report "Doc drift"): reference
  `fusion-hybrid.py`/`deploy_hybrid.py` that don't exist; say STEP chunks are 100KB
  but code uses 256KB (`fusion-bridge.js:57`). Documented from code, not prose.

**Bug / principle smells PARKED for T2 (not fixed — read-only turn):**
1. **P1 (host behaviour outside the bridge).** Two *new* bridge actions call
   `adsk.fusionSendData(...)` DIRECTLY instead of adding a sender to
   `core/fusion-bridge.js`: `main/main.js:136` (`get_design_params`) and
   `main/app-init.js:187` (`import_svg_sketches`). Both are reached only in
   Fusion-mode context so they don't crash the web host, but they leak host coupling
   out of the seam module. **T2 also verify:** I did NOT find a Python handler for
   `import_svg_sketches` in `b-spline-gen.py`'s dispatch (the ones present:
   log/preview*/generate*/check_import_status/ping/get_design_params/reset_ui/ok/
   cancel) — confirm the "Send to Fusion" editor button (BUG-23) actually has a
   backend, or it's a dead send.
2. **P4/DRY.** `core/coords.js:14` and `core/state.js:264` re-implement `fusLog`
   inline (`typeof adsk` guard + `fusionSendData('log', …)`) instead of importing
   `fusLog` from `fusion-bridge.js`. Duplicated seam logic.
3. **Cloud identity drift (correctness).** `preset-worker` carries three names —
   `wrangler.toml` `projects-dansemur`, `package.json` `bspline-preset-worker`,
   `deploy_worker.py` REST target `bspline-presets`. The `wrangler deploy` path and
   the REST path would publish DIFFERENTLY-named scripts. Live URL is
   `projects-dansemur.dansemur.workers.dev`. T2/T3: is `bspline-presets` a stale
   orphan script?
4. **Dead / incomplete infra.** `cloud/step-editor-worker` KV ids are still
   `REPLACE_AFTER_KV_CREATE` placeholders (unprovisioned); `cloud/step-editor-pages`
   is README-only and references a `deploy.cmd` + `step-editor/html/` source tree
   that don't exist. Candidate dead-code/standards items (more T3 than T2).

**NOT done (out of scope for T1):** did not touch `BUGS_OPEN.md` / reconcile B1–B3
— that's T2. No application-code edits. Only `ARCHITECTURE.md` (new) + this log.

---

## Turn 3 — T2: Bug & principle scout (read-only) — DONE

**Deliverable:** `BUGS_OPEN.md` updated — dated verdicts appended to B1–B3
(originals untouched), 8 new findings B4–B11 ranked most-severe first, plus a
minor list and a T3-parked list.

**Method / why.** Verified the one highest-stakes item myself first (the
`import_svg_sketches` dead send). Then fanned out TWO read-only Explore subagents
for the evidence-heavy sweeps — (1) B1–B3 reconciliation + editor findings,
(2) Python hot-reload lifecycle (P2/P3) — instructing both to return EVIDENCE +
`file:line`, not bare verdicts. Then I re-read every load-bearing claim against
source before trusting it in a durable doc (the advisor spot-checks the diff):
B1 fix comment at `layers.js:264-275`, B2 drop at `editor-io.js:44-47`, B3
`OPEN_SHAPES` at `editor-expand-shape.js:41`, B5 leak at `fusion-inspector.py:661`
vs `stop()`, B7 wipe-hole (grep + `find` confirmed `selection_items` is
inspector-unique and absent from `_shared_project_names`), B8 duplicated tree
(`diff -q` → byte-identical).

**Verdicts reached:**
- **B1 → likely-FIXED** (root cause = svg.js `toggleClass(force)` ignored, now
  explicit add/remove; one push/stroke, one pop/press). Runtime confirm advised.
- **B2 → original hypotheses RESOLVED; net CAN'T-TELL** — the real remaining
  disappearance path is the hidden-layer drop, promoted to its own finding **B6**.
- **B3 → likely-FIXED at dispatch** (`line` IS routed via `expandShape`); output
  correctness for `<line>` is runtime-only (`getTotalLength` support + trace fallback).

**New finds (headlines):** B4 dead-send (HIGH runtime bug — button logs false
success), B5 fusion-inspector `activeSelectionChanged` leak (HIGH P2, accumulates
per reload), B6 destructive hidden-layer save (data-loss), B7 `selection_items`
stale-reload (P2, low blast radius), B8 duplicated 33-file editor tree (P1),
B9 host calls bypassing the bridge seam (P1, guarded → erosion risk not live bug),
B10 CAM-builder partial CustomEvent teardown (P2, masked by next run), B11 `fusLog`
tripled (P4 — but forced by module layering; fix = extract a leaf module).

**Refuted / de-escalated (kept honest):** the "no `line` branch" B3 hypothesis is
FALSE. B9 host-leaks are `try/catch`-guarded + Fusion-gated, so NOT a live web
crash — framed as seam erosion, not a bug. No cross-sub force-wipe collision hole
exists (the two colliding names ARE wiped) — only the unique-name `selection_items`
stale-reload.

**Parked for T3:** systematic duplication audit (B8 is one instance), cloud
identity drift, unprovisioned/README-only cloud infra, README doc-drift, test
coverage, dead code. **No application-code edits.** Only `BUGS_OPEN.md` + this log.

---

## Turn 5 — T3: Engineering-standards audit (read-only) — DONE

**Deliverable:** `STANDARDS-AUDIT.md` (new, repo root) — 6 dimensions, quantified
with `diff`/`grep`/`git`, severity-ranked, each gap with `file:line` + fix direction.

**Method / why.** Did the mechanical quantification (dims 1/3/4 — duplication,
dead infra, error-handling counts) MYSELF via commands so the numbers are real,
not hand-waved (the task said "actually enumerated, not hand-waved"). Delegated the
read-and-judge dims (2 tests, 5 deploy internals, 6 deps/secrets) to one Explore
subagent. Then re-verified every high-severity / load-bearing claim against source
before committing it to a durable doc.

**What I quantified (headline numbers):**
- **Duplication:** forked editor tree = 33 files, **22 identical / 11 drifted**;
  the 5 files carrying T2's B1/B3/B6 are byte-identical → fixes land twice. Python
  shared-module dup = only 2 modules (`expression_coords`, `entity_helpers`) but
  **both heavily drifted** (399 / 276 diff-lines) — divergent impls, not copies.
  `dist/` is a healthy gitignored file-copy (0 tracked).
- **Error handling:** **253** `except…: pass` / 43 files, **156 bare `except:`**
  (worst `exporter.py`=36); **98** JS empty `catch{}`. Split noted: legit Fusion
  teardown vs masking business logic (sampled `cam-builder.py:915`, `exporter.py`).
- **Tests:** 16 files (template-maker deep, frame-builder light); JS frontend,
  lifecycle, 4/6 palettes, both workers = ZERO; no pytest config, **no CI**.
- **Deploy:** preset-worker 3-way name drift confirmed — `bspline-presets`
  (`deploy_worker.py`) is a stale orphan that also under-binds KV; step-editor-worker
  non-reproducible; 5 hardcoded machine paths.
- **Deps:** both npm deps (opentype.js, clipper-lib) orphaned/caret-ranged; runtime
  libs via un-pinned CDNs, no SRI.

**Surprising / worth flagging:**
- ⚠️ **A 36 MB build artifact (`bspline-frame-builder.zip`) is committed to git**
  — biggest hygiene issue; plus 6 tracked log/diff/tmp/.bak cruft files.
- 🔐 **`.env` holds LIVE `CLOUDFLARE_API_TOKEN` + `GITHUB_TOKEN`.** VERIFIED it is
  git-ignored, untracked, and has **0 commits in history** — so NOT a repo leak,
  on-disk material only. I did NOT write the token values into any file. Flagged in
  audit §6 by key-name only; human may wish to rotate if this tree was ever shared.

**Verification caught an error:** the subagent said `clipper-lib` is unused; my grep
found 108 `clipper` hits (looked contradictory). Ran it down — the hits are a local
var named `clipper` (= CDN polygon-clipping) + comments + `dist/` copies; zero
npm-`clipper-lib` imports. Subagent was right; avoided writing a false contradiction.

**Scoping:** referenced T2's B7/B8 as the bug-facets, quantified the standards-facets
here — didn't re-litigate. **No application-code edits.** Only `STANDARDS-AUDIT.md`
(new) + this log. Sets up T4 (prioritized fix backlog).

---

## Turn 7 — T4: Prioritized fix backlog (planning only) — DONE

**Deliverables:** `FIX-BACKLOG.md` (new) — 16 fixes F1–F16 ranked effort×impact,
sequenced P0→P3, each with a verifiable success criterion + source cross-ref.
Plus a correction to `STANDARDS-AUDIT.md` §3 (advisor-flagged).

**§3 correction (advisor was right — my T3 error).** T3 §3 said the 36 MB
`bspline-frame-builder.zip` was "committed to git." Re-verified: it is **NOT**
tracked in the current index and **IS** gitignored (`.gitignore:51`) — but history
carries **14 commits** of it (multiple 20–36 MB blobs, largest object in history).
So the accurate finding is **history bloat**, not a current commit. Root of my
error: in T3 I misread an `ls -lh` "36M" line as tracking status (my own tracked-
files loop had *not* listed the zip — I should have caught it then). Corrected both
the §3 bullet and the roll-up row, dated inline. Fix reclassified to F15 (LOW,
optional history rewrite).

**Backlog synthesis.** Mapped every B1–B11 + audit dim to a fix (see the doc's
cross-ref). Phasing: **P0** correctness/data-loss (F1 dead-send, F2 hidden-layer
loss, F3 inspector leak, F4 selection_items wipe, F5 B1/B3 runtime confirm) →
**P1** structural (F6 seam+fusLog, F7 editor de-fork, F8 Python de-dup) → **P2**
standards (F9 except-hygiene, F10 CAM teardown, F11 tests+CI, F12 repo hygiene,
F13 deploy, F14 deps) → **P3** optional (F15 zip history, F16 unbuilt cloud).

**Fork surfaced (as asked): editor dedup vs fix-twice.** B1/B3/B6 live in the
forked editor tree (B8); the bug files are byte-identical across both copies.
Presented A (dedup first) vs B (fix first) with the tradeoff and **recommended B**
— the fix-twice cost is trivial while the files are identical, whereas dedup (F7)
must reconcile 11 drifted files first and would delay the urgent B6 data-loss fix.
Flagged "advisor/human confirm A or B" — this is their sequencing call, not mine;
the backlog is written under B with the A-branch delta noted. NOT treating it as a
hard STOP gate since the task asked me to *surface it in the backlog*, which I did.

**No application-code edits.** Only `FIX-BACKLOG.md` (new) + `STANDARDS-AUDIT.md`
(§3 correction) + this log. This is the last audit task — advisor may `done` the batch.

---

## Turn 9 — DF1: Confirm Pages entry + remove dead deploy code (FIX phase, EDITS CODE) — DONE

First code-editing task. Safe removals only; verified the web build before passing.

**(A) Cloudflare Pages build entry — FINDING (load-bearing constraint).** The Pages
build command is **NOT in the repo** — configured only in the Cloudflare dashboard.
Evidence: no `.pages.yml`/build-command file; root `package.json` has only
`start`/`serve` (no build script); the only `wrangler.toml`s are for the *workers*,
not Pages. The repo's own comments (`deploy_cloudflare.py:11` and `:150-151` — "so
the Pages output-dir setting can point at a known path") imply the dashboard runs
**`python deploy_cloudflare.py --build-only`** with output dir `dist/`. → We must
treat `deploy_cloudflare.py --build-only` → `dist/` as an **unbreakable contract**.
Confirmed safe: `--build-only` exits at `deploy_cloudflare.py:216`, BEFORE steps 2
(zip), 3 (removed), and 4 (gh release), so none of my removals touch the Pages path.

**(B) Removals — each confirmed unused before deleting (grep evidence):**
1. `deploy_cloudflare.py` step-3 local Fusion refresh (was ~265-291) — REMOVED, left
   a breadcrumb comment. Dead: source path `../b-spline-gen` doesn't exist (real is
   `bspline-frame-builder/b-spline-gen`), fallback `../b-spline-generator-web-addin`
   = repo root (not the add-in), dest folder mis-named `b-spline-generator-web-addin`
   (real add-in installs as `bspline-frame-builder`). Only runs in full-deploy mode
   on win32/darwin, and only ever warns/mis-copies. Superseded by `DEPLOY_bspline-
   frame-builder.py` (canonical local install, correct dest). Also tidied the
   `--build-only` skip message which named the now-removed "Fusion refresh".
2. `run_deploy.py` — DELETED. `grep` repo: referenced only in docs
   (ARCHITECTURE/STANDARDS/FIX-BACKLOG/ROADMAP); **no code invokes it**; `release.py`
   does not call it. Thin PATH-wrapper with hardcoded `C:\nvm4w`/`C:\Users\danse`
   paths → dead.
3. `deploy_worker.py` — DELETED. `grep` repo: doc-only references; **no code path**;
   the live preset-worker deploys via `wrangler` (`preset-worker` `npm run deploy`),
   not this REST script; it targeted the orphan name `bspline-presets` and under-bound
   KV (STANDARDS §5 / B-context). Orphan → removed.
   *Nothing "dead" turned out to be referenced; no LEAVE-and-flag cases.*

**(C) Verify (ran on final committed state):**
- `python bspline-frame-builder/deploy_cloudflare.py --build-only` → **exit 0**;
  produced `dist/` with `bspline_gen_palette.html`, `core/` (19 JS), `editor/`,
  `main/`, `fonts/`, and `styles/` (href-rewritten); **0 `.py` leaked**. Web build intact.
- `ast.parse` OK for `deploy_cloudflare.py`, `DEPLOY_bspline-frame-builder.py`,
  `release.py`. Post-removal `grep` for `run_deploy|deploy_worker` in `*.py`: no code hits.

**(D) MERGE MAP for DF2** (unify deploy under `release.py --web/--addin/--local/--all`;
do NOT start this — DF2):

| Deploy action | Current owner(s) | Target owner (unified `release.py`) |
|---|---|---|
| build `dist/` (web) | `deploy_cloudflare.py --build-only` (steps 0-1) | `--web` shells `deploy_cloudflare.py --build-only`. **UNCHANGED — Pages dashboard contract.** |
| publish web (pages) | git push → Pages auto-build (`release.py` step 2); + `deploy_cloudflare.py` full-mode `wrangler pages deploy` (manual) | `--web`: push→auto-build primary; keep the manual `wrangler` path as fallback. |
| build add-in zip | **DUPLICATED**: `deploy_cloudflare.py` step 2 (219-262) + `release.py` step 1 (115-152, "mirrors" it) | `--addin` (`release.py` already owns it; `deploy_cloudflare.py`'s zip step is removable in a later slice). |
| gh release upload | **DUPLICATED**: `deploy_cloudflare.py` step 4 (309+) + `release.py` step 3 (202-229) | `--addin`. |
| local install (Fusion AddIns) | `release.py` step 4 (correct dest) + `DEPLOY_bspline-frame-builder.py` (canonical). Dead `deploy_cloudflare` step-3 = 3rd broken copy → **removed DF1**. | `--local` → delegate to `DEPLOY_bspline-frame-builder.py`. |
| stamp/editor bundle sync | `sync_stamp_bundle.py` (standalone) | pre-step of `--addin` (run before zip). |

**⚠️ DF2 insight — the editor fork (B8/F7) is SYNC-GENERATED.** `sync_stamp_bundle.py`
mirrors b-spline-gen's `html/editor/` + `html/core/stamp/` 1:1 into each sibling
add-in (that's what creates `stamp-editor/html/editor/`). The 11 drifted files (T3
§1a) mean the sync is **stale**, not that someone hand-forked. So F7/DF2 is "re-run
/ fix the sync (or make siblings import one tree)", NOT "manually reconcile 33
copies". Also: `DEPLOY_bspline-frame-builder.py`'s docstring says `deploy_cloudflare.py`
owns the public zip/release, but `release.py` also does — DF2 should make `release.py`
the single owner and update that docstring.

**Scope kept:** touched only `deploy_cloudflare.py` (step-3 block + 1 message line),
deleted `run_deploy.py` + `deploy_worker.py`. Did NOT touch `release.py`'s 4 steps,
`--build-only`, `DEPLOY_bspline-frame-builder.py`, or `sync_stamp_bundle.py`. Did NOT
start the merge or add `--web/--addin` flags (DF2).

---

## Turn 11 — DF2: release.py → one flagged entry (FIX, EDITS CODE) — DONE

**Deliverable:** refactored `release.py` into a single flag-gated entry
(`--web`/`--addin`/`--local`/`--all`), `release.py` ONLY. `--all`/bare reproduces
the exact original 4-step behaviour.

**Design (declare-over-hand-roll).** Wrapped each of the 4 existing step bodies in a
function **verbatim** (`step_build_zip`/`step_git_push`/`step_gh_release`/
`step_local_refresh` — same prints, logic, `sys.exit` paths, `[n/4]` labels), then
**DECLARED** the step→flag mapping as data instead of an if/elif tangle:
```
STEPS = [("addin", step_build_zip), ("web", step_git_push),
         ("addin", step_gh_release), ("local", step_local_refresh)]
```
The driver iterates `STEPS` in order and runs a step if its group is selected, so
`--all`/bare runs 1→2→3→4 exactly as before and any subset preserves relative order.
Flag map: `--addin` = zip + gh-release (kept together — gh upload needs the zip),
`--web` = commit/push (→ Pages auto-rebuild), `--local` = Fusion AddIns refresh.
Guarded execution under `main()` / `if __name__=="__main__"` so the flag logic is
unit-testable WITHOUT running/publishing (no importer of release.py exists → no
regression). Kept the pre-existing unused `import stat` (not my mess — surgical).

**Backward-compat preserved:** bare `python release.py` and `python release.py "msg"`
behave identically to before (bare → all groups; a lone non-flag token is still the
commit message). Only inputs starting with `--` change meaning (now flags) — which
is the whole point of DF2.

**Verify (WITHOUT PUBLISHING — no push/gh/wrangler run):**
- `ast.parse` OK; `import release` clean (main() guarded, no steps ran).
- `_parse_args` across 8 cases: bare→all, `--all`→all, `--web`/`--addin`/`--local`→
  single group, `--addin --local`→both, `"msg"`→all+msg, `--web "msg"`→web+msg,
  `--bogus`→usage + exit 2. All correct.
- `step_build_zip()` in isolation (local, no publish): packed 592 files → 20.9 MiB,
  zip still gitignored. Step-1 logic intact.
- `python release.py --local` (advisor-sanctioned): printed **only `[4/4]`** (web+
  addin steps correctly skipped), ran DEPLOY, summary showed Commit/Push/Zip/GH-release
  = skipped, Fusion = deployed, exit 0. Routing confirmed.
- Did NOT exercise `--web`/`--addin` gh-upload/`--all` (they publish).

**Scope:** `release.py` only (+209/−138, all wrapping+driver; no logic change — proven
functionally). Did NOT touch `deploy_cloudflare.py`, `DEPLOY_bspline-frame-builder.py`,
or `sync_stamp_bundle.py`.

---

## Turn 13 — DF3: deploy_cloudflare.py → web-only (FIX, EDITS CODE) — DONE

**Deliverable:** `deploy_cloudflare.py` is now web-only (build `dist/` → deploy Pages).
Removed the two actions that DF2 moved into `release.py --addin`.

**Removed (now duplicated by `release.py --addin`):**
- Step 2 — the add-in ZIP build (+ its `import zipfile`, `zip_target`, `_zip_should_skip`,
  skip-sets, the walk/zip loop).
- Step 4 — the entire `gh release upload latest` block (`GH_CMD`, view/create/upload).

**Kept (untouched behaviour):** dist build (steps 0-1), the `--build-only` exit, and
the `wrangler pages deploy` (the web publish).

**Docs updated:**
- deploy_cloudflare.py header rewritten to say WEB-ONLY + that the zip/GitHub release
  moved to `release.py --addin/--all` [DF3].
- `--build-only` message: "Skipping zip build, wrangler deploy, and gh release upload."
  → "Skipping wrangler deploy." (the other two no longer exist here).
- The DF1 step-3 breadcrumb folded into a clean "# 2. Deploy to Cloudflare Pages" note.
- `DEPLOY_bspline-frame-builder.py` docstring fixed: the public ZIP + GitHub release are
  built by **`release.py` (`--addin`/`--all`)**, not deploy_cloudflare.py (now web-only).
  (DF3 explicitly authorised this docstring-ref fix.)

**Orphan check (surgical):** my removal orphaned only `import zipfile` — removed with the
block. `shutil` (clean_dir/which) and `subprocess` (wrangler) stay used. Left pre-existing
unused `stat`/`time` imports alone (not my mess).

**Verify (no publish; did NOT run full-mode):**
- `ast.parse` OK for both edited files.
- `grep` deploy_cloudflare.py for `zipfile|zip_target|GH_CMD|_zip_should_skip|gh release*`
  → none (no dangling refs). File 321 → 240 lines.
- `python deploy_cloudflare.py --build-only` → **exit 0**; `dist/` produced (palette HTML +
  19 core JS, 0 `.py` leaked); message now correctly says "Skipping wrangler deploy."
- Did NOT run full-mode (would invoke `wrangler pages deploy` = publish).

**Deploy consolidation now complete (DF1→DF3):** `release.py` = single entry
(`--web`/`--addin`/`--local`/`--all`); `deploy_cloudflare.py` = web build/deploy only,
called by `release.py --web` and the Pages CI; `DEPLOY_bspline-frame-builder.py` = local
install; no orphan/duplicate deploy paths left. **Scope:** only `deploy_cloudflare.py`
+ `DEPLOY_*.py` docstring. Did NOT touch `release.py` or `sync_stamp_bundle.py`.

---

## Turn 15 — B6/F2: hidden-layer data loss — ⛔ GATE (plan vs. code mismatch; NO code edits)

**I stopped and did NOT edit code.** Tracing the data flow shows the dispatched
decomposition ("`save()` serializes ALL; stamp/rasterize path STILL drops hidden")
does not match the actual code — following it literally would NOT fix B6. Flagging
for a decision.

**Evidence (b-spline-gen frontend):**
1. **The reopen/persistence source is `saveForRasterization()`, NOT `save()`.**
   `onChange`/`onCommit` set `P.editorSvg = await saveForRasterization()`
   (`main/app-init.js:66,88`) and also `setStampLayerSvg(...)` with the same value
   (`:70,89`). Reopen restores from `P.editorSvg` (`:119-123`). The `editor.save()`
   result passed to `_onCommit` (`editor/tools/action-tools.js:52`) is used **only as
   a truthy flag** and then replaced by `saveForRasterization()` (`app-init.js:81-93`).
   → **Changing only `save()` (the literal directive) has ZERO effect on reopen — B6
   stays broken.**
2. **`_visibleContent`'s drop-hidden feeds NO stamp/rasterize path.** Its 3 callers are
   `save()` (144), `saveForRasterization()` (231), `saveWithTextCopies()` (272). None of
   their outputs is rasterized wholesale. The stamp masks are built per-layer by
   `getLayerSvg` (`main/stamp-mask-manager.js:48-55`), which **skips
   `layer.visible===false` at `:51`** and does NOT use `_visibleContent`. → The
   "stamp/rasterize path" already excludes hidden **independently**; there is nothing in
   `_visibleContent` to preserve for stamping, so "do not regress" is satisfied trivially
   by keeping content.
3. `editor.lastSvg` is set (3×) but **never read** (dead).

**So `_visibleContent`'s drop-hidden currently causes ONLY data loss** (reopen via
`P.editorSvg` and the `editorDownload` file both lose hidden-layer geometry), with no
compensating stamp benefit.

**Options (pick one — I implement next turn, BOTH editor-io.js copies identically):**
- **A (recommended).** Make the persistence/export serializers keep ALL content: add
  `_allContent(editor)` (stripped raw innerHTML, no drop) and use it in `save()`,
  `saveForRasterization()`, AND `saveWithTextCopies()`. Leave the real stamp exclusion
  (`getLayerSvg` per-visible-layer) untouched → B6 fixed for reopen + download, zero
  stamp regression. **This DEVIATES from the literal directive** (it also changes
  `saveForRasterization`, which the note said to keep dropping) — required, because
  `saveForRasterization` IS the persistence source and its output is never rasterized
  wholesale.
- **B (literal directive).** Change only `save()` to keep-all; leave
  `saveForRasterization()` dropping. → **Does NOT fix B6** (reopen uses
  `saveForRasterization`/`P.editorSvg`). Not recommended.
- **C.** Parameterize `_visibleContent(editor, dropHidden)`: persistence callers pass
  `false`; a genuine wholesale-rasterize caller would pass `true`. No current caller
  needs `true`, so this is future-proofing over A.

**Open question for the advisor:** the stamp-editor copy's `main/` does NOT have the
`P.editorSvg`/`saveForRasterization` flow (grep found none) — its editor-io.js is
byte-identical but its consumers differ. Patching both copies identically (as asked)
is fine for keeping them in sync, but the B6 symptom itself is a b-spline-gen concern.

**Ask:** confirm **A** (or a synthesis). Next turn I implement it in BOTH `editor-io.js`
copies + write the manual Fusion repro. **No app-code edits this turn** — only this log.

---

## Turn 17 — B6/F2 v2 (CORRECTED, EDITS CODE): fix hidden-layer data loss — DONE

Advisor confirmed the gate (Option A). Implemented.

**Change (both `editor-io.js` copies, byte-identical patch):** renamed
`_visibleContent` → `_serializedContent` and **gutted the hidden-drop** — it now returns
`stripSvgjsAttributes(editor._sketchLayer.node.innerHTML)` (ALL children, all layers).
All 3 serializers (`save`, `saveForRasterization`, `saveWithTextCopies`) now keep full
content. Updated the misleading docstring + `save()` comment. Stamp exclusion in
`getLayerSvg` untouched. Mirrored the patched file to the stamp-editor copy (`cp`);
`diff -q` → identical.

**Why it fixes B6 (logic argument — can't drive Fusion UI):**
- Reopen source is `P.editorSvg` = `saveForRasterization()` output (`main/app-init.js:66,88`),
  restored via `open()` (`:119-123`). Before: `saveForRasterization` dropped hidden
  children → `P.editorSvg` held visible-only → reopen lost hidden geometry. After: it
  serializes all children → `P.editorSvg` holds everything; the `visible` flag is
  persisted separately in `data-editor-layers` (`_serializeLayersAttr`), so `open()`
  restores geometry AND roster, then `applyLayerState` re-applies `layer-hidden` (CSS) to
  hidden layers. Net: geometry preserved, hidden state preserved. Same reasoning fixes the
  `editorDownload` file (`saveWithTextCopies`).
- **No stamp regression (primary path):** stamp masks come from `getLayerSvg` per layer,
  skipping `layer.visible===false` (`main/stamp-mask-manager.js:48-55`); `getLayerSvg`
  never used `_visibleContent`. So hidden exclusion for stamping is unaffected.

**Re-confirm "no wholesale-rasterize consumer of saveForRasterization" (as asked):**
Primary path is clean (P.editorSvg → reopen only; stamp uses per-layer getLayerSvg). BUT
I found ONE narrow residual: the legacy fallback (`stamp-mask-manager.js:58-68`) rasterizes
`P.stampLayers[idx].svg` for entries not covered by an editor pass, and `saveForRasterization`
mirrors its full-doc output to `P.stampLayers[activeLayerIdx].svg` (`app-init.js:70,89`).
**Trigger:** only if the ACTIVE layer is hidden at save time (so no editor pass covers its
idx) — then the full-doc mirror (now incl. hidden) would rasterize. It is (a) narrow
(active-layer-hidden-at-save), (b) pre-existing (the mirror already produced a spurious
extra pass double-counting VISIBLE content; my change merely extends it to hidden), (c) in
`app-init.js`, outside this task's `editor-io.js` scope. **Did NOT expand scope.**
Recommend a follow-up (F-new): stop mirroring the full doc to `P.stampLayers`, or have the
legacy fallback skip editor-sourced entries — this also fixes the pre-existing visible
double-stamp.

**Verify (no Fusion UI available):** `node --check` (via .mjs copy) → syntax OK on the
patched file; `grep _visibleContent` → 0 refs left, 4 `_serializedContent` (def + 3
callers); both copies `diff -q` identical. Logic argued above.

### MANUAL REPRO for the human (needs Fusion + the palette)
_Primary (B6 fix):_
1. Open the B-Spline palette → open the SVG editor.
2. Draw content on **Layer 1** (e.g. a circle). Add **Layer 2**, draw a distinct shape
   (e.g. a square) on it.
3. **Hide Layer 2** (eye toggle) so only Layer 1 shows.
4. Click **Apply Stencils** (commit), close the editor.
5. **Reopen** the editor.
   - ✅ EXPECTED (fixed): Layer 2 still exists in the roster and still contains the square
     (hidden). Toggle Layer 2 visible → the square reappears.
   - ❌ OLD BUG: Layer 2 empty / square gone; toggling visible restores nothing.
_Also check no stamp regression:_
6. With Layer 2 hidden, look at the 3D preview stamp: the square must NOT carve the terrain
   (hidden layers don't stamp). Toggle Layer 2 visible → the square's stamp appears.
_Edge case to watch (residual, app-init mirror):_
7. Make **Layer 2 the ACTIVE layer, hide it, then Apply**. If the hidden square's stamp
   shows up in the preview, that's the documented `app-init.js` legacy-mirror edge case
   (follow-up F-new), NOT this editor-io.js change.

**Scope:** both `editor-io.js` copies only (identical). Did NOT touch `app-init.js`,
`stamp-mask-manager.js`, or run a full sync.

---

## Turn 19 — F-new: stop P.stampLayers full-doc mirror double-stamp — ⛔ GATE (Cancel-restore unclear; NO code edits)

Mapped mirror consumers first (as directed). Browse-legacy is safe for approach (b);
**Cancel-restore safety is genuinely unclear**, which the dispatch said to GATE on.

**Consumer map — writers of `P.stampLayers[idx].svg`:**
1. **Editor mirror** — `main/app-init.js:70,89` `setStampLayerSvg(P.activeLayerIdx, <full-doc>)`
   (auto-enables). Transitional mirror of the editor doc.
2. **Browse upload** — `main/stamp/svg-source.js:65` `setStampLayerSvg(P.activeLayerIdx, text)`
   — **but only in the `if (!imported)` branch, i.e. when the editor is NOT loaded**
   (`:62-68`). With the editor loaded, Browse imports INTO the editor via
   `_importSvgIntoEditor` (`:125-164`), so it becomes editor-layer content (stamped by the
   editor pass), NOT a legacy P.stampLayers entry.
3. **Cancel-restore** — `main/app-init.js:101` `P.stampLayers[idx].svg = SvgEditorSnapshot.svg`.
4. **Snapshot restore** — `main/snapshot-manager.js:42` (`[0].svg`).

**Legacy fallback** (`main/stamp-mask-manager.js:58-68`) rasterizes P.stampLayers[idx] with
svg+enabled not covered by an editor pass. Its stated purpose (docstring `:31-34`): editor
not loaded (early init) OR editor loaded-but-empty + legacy uploaded svgs.

**Approach (b) I'd implement** — skip a legacy entry when an editor layer occupies that idx:
```
const editorOwnsIdx = editorLayers && editorLayers.length > 0 && !!_editorLayerAt(idx);
if (alreadyCovered || editorOwnsIdx) return;   // editor is source of truth for that idx
```
- **Browse-legacy: SAFE.** When the editor is unloaded, `editorLayers` is null →
  `editorOwnsIdx` false → the fallback still fires for genuine legacy uploads. When the
  editor is loaded, the mirror at `activeLayerIdx` is skipped → fixes both the pre-existing
  VISIBLE double-stamp and the post-B6 hidden-active-stamp.
- **Cancel-restore: UNCLEAR.** On Cancel (`_onCommit(null)`), the code restores
  `P.stampLayers[idx].svg` to the pre-edit snapshot but does NOT revert the editor's live
  `_sketchLayer` content or `P.editorSvg` (`app-init.js:94-111`). So the restored snapshot
  is rasterized by the legacy fallback ONLY at an idx the editor pass doesn't cover
  (hidden/empty editor layer at that idx) — exactly the case (b) would newly skip. I can't
  statically prove (b) preserves intended Cancel behavior; it's entangled with a
  possibly-pre-existing Cancel inconsistency (live editor content isn't reverted on Cancel,
  so the editor-pass path already stamps in-flight edits post-Cancel).

**Options (pick one — I implement next turn, b-spline-gen only, preserving 4 invariants + B6):**
- **A (approach b, recommended).** Add the `editorOwnsIdx` skip above. Fixes double-stamp +
  hidden-active-stamp; Browse-safe. Cancel only diverges in the narrow "edit a hidden/empty
  editor layer, then Cancel" case — where (b)'s behaviour (restored content does NOT stamp)
  is arguably MORE correct (hidden layers shouldn't stamp). Pair with a manual Cancel repro
  for the human to confirm before merge.
- **B (narrower, approach C).** Skip the legacy entry ONLY when the editor layer at idx is
  HIDDEN (`_editorLayerAt(idx)?.visible === false`). Fixes exactly the post-B6
  hidden-active-stamp regression; leaves the pre-existing VISIBLE double-stamp for a
  separate ticket. Lowest Cancel/legacy risk.
- **C (touch the mirror, approach a).** Stop `app-init.js:70,89` writing the full-doc mirror
  (or not auto-enabling it). Advisor deprioritised (a) vs (b); also risks the reopen
  fallback that reads `P.stampLayers.find(l=>l.svg)` (`app-init.js:120`).

**Ask:** confirm **A** (or B). Then I implement + write manual Cancel/double-stamp repro.
**No app-code edits this turn** — only this log.

---

## Turn 21 — F-new v2 (decision: Option B, hidden-only skip) — DONE

Advisor chose **B** (zero Cancel risk; broader visible double-stamp deferred).

**Change (b-spline-gen only, `main/stamp-mask-manager.js` legacy fallback `:64-66`):** added
one guard so the fallback also skips a P.stampLayers entry whose editor layer at that idx
is HIDDEN:
```
const editorLayerHidden = _editorLayerAt(idx)?.visible === false;
if (alreadyCovered || editorLayerHidden) return;
```
(`_editorLayerAt` already defined in-file at `:18`; no import added.)

**Why it fixes the post-B6 residual (logic — no Fusion UI):** since the B6 fix,
`saveForRasterization` mirrors the FULL document (incl. hidden) into
`P.stampLayers[activeLayerIdx].svg` (`app-init.js:70,89`). When the active editor layer is
HIDDEN, the editor pass loop skips it (`:51`), so the legacy fallback previously rasterized
that full-doc mirror → hidden geometry stamped. The new `editorLayerHidden` guard skips it →
hidden layers no longer stamp via the mirror.

**Why zero Cancel risk (the reason B was chosen):** the guard fires ONLY when an editor
layer at idx is explicitly `visible === false`.
- Cancel-restore at an editor-covered VISIBLE idx → handled by `alreadyCovered` (unchanged).
- Cancel-restore at an idx with NO editor layer → `_editorLayerAt(idx)` is null →
  `null?.visible === false` is `false` → NOT skipped → fallback still fires → Cancel-restore
  preserved.
- Only a HIDDEN editor layer's fallback entry is skipped — and hidden layers must not stamp.

**Invariants preserved:** editor-io.js untouched → **B6 stays fixed**; editor passes
(`getLayerSvg` per visible layer) untouched → **primary stamp path intact**; b-spline-gen
only (no stamp-editor copy of this file exists); no new host coupling / no declaration
hand-rolled. Broader "editor owns idx" visible double-stamp skip intentionally **deferred**.

**Verify:** `node --check` (via .mjs) → syntax OK; diff is the single guard addition;
scope confirmed b-spline-gen only.

### MANUAL REPRO for the human (needs Fusion + palette)
1. Open the SVG editor. Draw on **Layer 1** (circle). Add **Layer 2**, draw a **square** on it.
2. Make **Layer 2 the ACTIVE layer**, then **hide it** (eye toggle).
3. **Apply Stencils**; look at the 3D preview stamp.
   - ✅ FIXED: the square does **NOT** carve the terrain (hidden layer doesn't stamp).
   - ❌ post-B6 regression (pre-this-fix): the square stamped despite being hidden.
4. Toggle **Layer 2 visible** → the square's stamp now appears (visible path still works).
5. Cancel sanity: Edit a layer, make a change, **Cancel** → the stamp reverts to pre-edit
   exactly as before (this fix does not alter the Cancel path).

**Scope:** `main/stamp-mask-manager.js` (b-spline-gen) only.

---

## Turn 23 — SM1: settings modal grey/no-content (FIX, EDITS code, browser-verified) — DONE

**Change (`main/header-controls.js`, b-spline-gen):** removed the duplicate settings-toggle
block (old `:51-63`) inside `bindHeaderAndSettings`; left a breadcrumb comment + dropped the
now-stale "Settings panel toggle" docstring line. Kept the rest of the function.

**Root cause (confirmed):** two handlers fired on the same `#settings-btn` click. The inline
handler in `bspline_gen_palette.html:1017-1031` (correct sole owner) opens
`#settings-panel-overlay` (`display:flex`) and clears `.hidden` from `#settings-panel` once at
load. The removed header-controls block toggled `.hidden` ONTO `#settings-panel` (the
`cad-modal-window` content) and referenced a non-existent id `settings-overlay`. Since
`.hidden { display:none !important }` (`styles/base.css:113`), the overlay opened but its
content was hidden → grey/empty modal.

**BROWSER VERIFICATION (headless Chromium via Playwright 1.61.1; served the raw source on
127.0.0.1:8199, rooted at `bspline-frame-builder/` so `../../styles` resolves):**
- **Fixed code, click `#settings-btn`:** overlay `display` none→**flex**, `#settings-panel`
  `.hidden`=**false**, panelVisible=**true** → modal opens WITH content. Close button →
  overlay back to `none`. **No page errors** (main.js + CDN modules loaded, so this is the
  integrated behaviour, not just the inline handler).
- **Causation control:** on a fresh load I re-injected exactly what the removed block did
  (`panel.classList.toggle('hidden')` on the settings click) → overlay flex but panel
  `display:none`, `.hidden`=true, visible=false → **reproduced the grey/empty bug**. So the
  removed toggle was the cause; removing it is the fix.
- Screenshots: `scratchpad/settings-open-FIXED.png` (content visible),
  `settings-open-BROKEN-sim.png` (grey/empty).

**Verify (other):** `node --check` syntax OK; no orphaned identifiers (only my breadcrumb
mentions the old id); `#settings-btn` now bound solely by the inline HTML handler.

**Process hygiene:** started a `python -m http.server 8199` for the test; **killed it**
after (port 8199 now refuses; `proc_health watch` clean, 0 flagged).

**Incidental (NOT my change, left unstaged):** `b-spline-gen/b_spline_gen_log.txt.old` shows
a 1505-line append — a **Fusion runtime log write** (timestamps 09:19-09:20, before this turn)
to a tracked `.old` log file (the T3/F12 log-cruft item). Committed only my two files.

**Scope:** `main/header-controls.js` (b-spline-gen) only. Did not touch the HTML inline
handler (kept as sole owner, as directed).

---

## Turn 25 — B4a: import_svg_sketches DESIGN (design only, no code) — DONE

Design for wiring the dead `import_svg_sketches` send (B4). Researched the Fusion API via
the Autodesk Help MCP (not a live spike). No repo code touched.

### 1. Send payload — `main/app-init.js:154-197`
`#editorSendToFusion` (Fusion-mode only) builds `sketches[]`, **one per VISIBLE editor
layer** (`:160` skips `visible===false`), each = `{id, name, depth, profile, tx, ty,
rotation, scale, mirrorX, mirrorY, svg}` where `svg = getLayerSvg(editor, layer.id)` (a
self-contained per-layer SVG: `width/height` in px@96dpi, `viewBox` in inches). Envelope:
`{sketches, widthIn, heightIn}` → `adsk.fusionSendData('import_svg_sketches', payload)`.

### 2. Receiver gap — `b-spline-gen.py`
`PaletteHTMLEventHandler.notify` dispatch (`:666-872`) has **no** `import_svg_sketches`
branch → dead send (B4). **Big reuse:** the add-in ALREADY imports SVG→sketch —
`_import_single_layer_svg` (`:1368`) does `sketch_target.sketches.add(plane)` +
`import_mgr.createSVGImportOptions(tmp)` + `importToTarget(opts, sketch)`, with
`_prescale_svg` (`:1378`) for DPI→physical sizing. It runs from the HTML-event/import path
(`_import_all_svg_layers` `:1319`), NOT a command event. B4 is a SIMPLER variant of this
(no body/offset-plane/carve — just a base-plane sketch in the active component).

### 3. SVG→sketch conversion (Autodesk Help, verified)
Two documented APIs:
- **(A) `sketch.importSVG(fullFilename, xPos, yPos, scale)`** (Aug 2014) — simplest:
  X/Y offset **in cm** + uniform `scale`. NO rotation/mirror. Returns bool.
- **(B) `ImportManager.createSVGImportOptions(path)` + `importToTarget(opts, sketch)`**
  (Oct 2022) — `opts.transform` = **Matrix3D** (position, ROTATION, SCALE, MIRROR relative
  to sketch coords), `opts.isViewFit=False` (avoid camera jump), `isHorizontal/VerticalFlip`.
  Full per-layer transform. This is what the stamp path uses. (Note: SVGImportOptions has NO
  documented `.scale` property — the stamp code's `svg_options.scale=1.0` is a no-op;
  scaling is via `.transform`. Flag for cleanup.)
- **Units:** Design internal = **cm**; SVG is px@96dpi → **must pre-scale** to physical size
  (reuse `_prescale_svg` with `widthIn/heightIn`) so the sketch lands at the right size.
- **⚠️ Limitation (docs):** `importToTarget` "cannot be used within any of the Command
  related events." The existing stamp import runs from the **HTMLEvent** dispatch and works,
  so B4 must import inside the `import_svg_sketches` HTMLEvent branch (NOT a command execute
  handler). If it ever fails there, defer via `app.fireCustomEvent(...)`.
- **Hidden sketch (`isLightBulbOn`) — verified:** `Sketch.isLightBulbOn` gets/sets the
  browser light-bulb; `sketch.isLightBulbOn = False` hides the sketch (`isVisible` is
  read-only, reflects parents too). So a hidden editor layer → a hidden sketch.

### 4. v1 scope
- Target: `design.activeComponent` (fallback rootComponent), one sketch per sent layer on the
  **XY construction plane** (z=0), named from `layer.name`, pre-scaled to board size.
- Import: recommend **(A) `sketch.importSVG`** for the first cut (position+scale only — the
  payload's `tx/ty/scale`), then **(B)** when rotation/mirror is needed (`mirrorX/Y`,
  `rotation`) via a Matrix3D.
- Hidden layers: v1 keeps the frontend's visible-only send (simplest, already true). v1.5 =
  send ALL layers + a `visible` flag (tiny `app-init.js` change: stop skipping hidden,
  include `visible`) → receiver sets `isLightBulbOn=False` for hidden.
- Feedback: replace the frontend's **false** `[SendToFusion] sent N` log (`app-init.js:188`)
  with a real receiver signal — `pal.sendInfoToHTML('import_success'/'import_error', …)`.

### 5. Slice plan (for B4b+)
- **B4b — minimal receiver:** add `elif action == 'import_svg_sketches':` → parse payload →
  per layer: `_prescale_svg` → temp `.svg` → `sk = comp.sketches.add(comp.xYConstructionPlane)`
  → `sk.importSVG(tmp, 0, 0, 1.0)` → `sk.name = layer['name']` → cleanup temp. Verify ONE
  visible layer lands as a correctly-sized sketch (human tests in Fusion).
- **B4c — transform:** apply `tx/ty/scale` (cm), then `rotation`/`mirrorX/Y` via (B)'s
  Matrix3D. Verify placement matches the editor.
- **B4d — hidden layers:** frontend sends all + `visible`; receiver `isLightBulbOn=False` for
  hidden. Verify hidden layers arrive as hidden sketches.
- **B4e — feedback/grouping:** real success/error signal to the palette; optionally group the
  sketches under a named component/occurrence.

### Open questions (advisor/human)
1. **(A) vs (B) for v1** — recommend (A) minimal first; (B) once rotation/mirror matters.
2. **Target** — active component's XY plane at z=0? (vs a dedicated component / offset plane).
3. **Hidden scope in v1** — visible-only (v1) vs all-layers+`isLightBulbOn` (v1.5)?
4. Want this design as a standalone `B4-SEND-TO-FUSION-DESIGN.md` for B4b, or is this
   WORK-LOG entry the reference?

**No repo code edits** — design/research only. Only this log.

---

## Turn 27 — LOG1: harden the Python log path (FIX, b-spline-gen) — DONE

**Change (`b-spline-gen.py:get_log_path`):** made the log path DERIVE from
`__file__` as an always-valid default, and validate the optional override with a
real write-probe:
- `derived = dirname(realpath(__file__))/b_spline_gen_log.txt` — exists+writable in
  BOTH the repo and the deployed AddIns folder.
- New `_dir_writable(d)` helper: `isdir` **plus** an actual create/delete probe (a
  path can exist but be read-only, or a moved workspace path won't exist — plain
  `isdir` misses both).
- Override = `workspace_link.json` `workspace_root`; used only if `_dir_writable`,
  else **fall back to derived**. So a stale/invalid override can never send the log
  to a dead folder.

**Clarification (verified the real mechanism, not just the stated culprit):** the
named `b_spline_log_path.json` is **NOT read by any code** — repo-wide grep found only
`DEPLOY_bspline-frame-builder.py:224` (a copy SKIP-list). The live driver was already
`workspace_link.json` + `__file__` fallback (using `isdir` only). So in the current
repo the log wasn't actually landing in a dead folder — but the hardened version
GUARANTEES it can't (invalid override → derived). Removed the dead
`b_spline_log_path.json` orphan (it was git-ignored/local-only + wrong path:
`...\b-spline-generator-web-addin\b-spline-gen\...`, missing the `bspline-frame-builder\`
segment); the removal is cosmetic (not in the commit — gitignored).

**Verify (a real test line lands — required):** replicated the new `get_log_path` +
`_dir_writable` in a sandbox with actual file writes:
- **A** valid override → logs to `workspace_root`, test line landed ✓
- **B** invalid override (nonexistent dir) → **falls back to derived**, test line landed ✓
- **C** no override → derived, test line landed ✓
- Real `addin_dir` resolves to the correct repo path, parent writable ✓
- `ast.parse` of the module OK.

**Incidental (not mine):** `b_spline_gen_log.txt.old` / `b_spline_gen_log.txt` show
Fusion runtime-log writes from the human's testing — left unstaged (T3/F12 log-cruft).

**Scope:** `b-spline-gen.py` only (+ deleted a gitignored local orphan). Next up
(advisor's note) = declare one editor source of truth — separate task.

---

## Turn 29 — EDM1: editor source-of-truth DESIGN (design only, no code) — DONE

Diagnosed both symptoms from the runtime log + a full pipeline trace. No repo code touched.

### Runtime-log evidence
- Every `rasterizeSvg` call: `pathCount=1  hasNonzero=false  hasEvenodd=false`,
  `path[0] fill=none stroke=#000000`, `opaquePx ≈ 6-8%` → the rasterizer only ever gets an
  UNFILLED open stroke, never a filled/closed region.
- `data-original` count in the log = **0** → in the logged session no Expand ran; the user
  drew raw strokes, so `fill=none` there is "strokes aren't filled."
- Reopen: `EDITOR-IO] open() called svgLen=0 … no svgString -> empty editor` → the reopen
  source was EMPTY at init (one of two reopen-blank paths, below).

### ROOT CAUSE (one bug, both symptoms)
Expand writes a correct filled path — `editor-expand-commit.js:93-97`
(`.fill('#000000').stroke('none').attr('fill-rule','evenodd')`) — but ALSO attaches
`data-original-svg` = a raw-markup snapshot of the pre-expand stroke (`_snapshotMarkup`
`:47-56`, set at `:117`). That value contains literal `<`/`>`. HTML `innerHTML`
serialization escapes `"`→`&quot;` but leaves `<`/`>` raw → the serialized string is
**invalid XML**. A strict `image/svg+xml` DOMParser then silently fails (returns a
`<parsererror>` doc, does NOT throw).

- **fill=none (TASK1) loss point = `editor-io.js:100`** — `getLayerSvg`'s strict DOMParser
  chokes on the poison attr → the expanded (filled) element is dropped/mangled → only the
  original stroke survives → `fill=none`. The ONLY sanitizer that strips the poison
  (`render-svg.js:53-54`) runs **two hops later** inside `rasterizeSvg` — too late.
- **reopen-blank (TASK2) break point = `editor-io.js:415`** — `open()` parses `P.editorSvg`
  with the same strict DOMParser; poison → `querySelector('svg')` = null → the whole restore
  block (`416-486`) is skipped → editor reopens blank. `open()` has NO sanitize before its
  parse. (Second path: `:403` empty-`svgString` early-return — the logged `svgLen=0` case.)
- B6 didn't help — it made the serializer KEEP all content, which faithfully preserves the
  poison into `P.editorSvg`.

### The ~5-copy editor-content tangle (why this keeps happening)
| # | Copy | Produced by | Consumed by | Sanitized? |
|---|------|-------------|-------------|-----------|
| 1 | **live DOM** `_sketchLayer.node` | user edits | everything derives from it | n/a (source) |
| 2 | `getLayerSvg()` per-layer | strict DOMParser (`editor-io.js:100`) | stamp masks | ❌ (poison breaks it) |
| 3 | `P.editorSvg` | `saveForRasterization`→`_serializedContent` | reopen `open()` | ❌ (keeps poison) |
| 4 | `P.stampLayers[idx].svg` | mirror of #3 + Browse + Cancel-snap | legacy stamp fallback | ❌ |
| 5 | `editor.lastSvg` | save/saveForRaster/saveWithTextCopies | **nobody (dead)** | — |
| 6 | `data-original-*` attrs | `_snapshotMarkup` per expanded el | re-edit | the poison itself |
| 7 | `SvgEditorSnapshot.svg` | Edit-button snapshot | Cancel-restore | ❌ |
| 8 | localStorage `splineGenLastSession` | `saveLastSession` | load; **cleared on every load** (`app-init.js:48`) | ❌ |
THREE divergent serializers (`save` / `saveForRasterization` / `saveWithTextCopies`) and
multiple strict parsers, each sanitizing (or not) differently → the same string is valid on
one path and fatal on another.

### DESIGN — ONE declared source of truth
**Declare the live editor DOM (`_sketchLayer`) as THE source; every other form is a DERIVED
VIEW produced by ONE canonical serializer, and there is exactly ONE persisted form.**
1. **One serializer** `serializeEditor(editor, {forRaster})` — reads the live DOM, strips
   `svgjs:*`, and **guarantees valid XML** (see EDM2 options). `forRaster:true` also strips
   `data-original-*` + normalizes fonts (today's `sanitizeSvgForRaster` logic) BEFORE any
   consumer parse; `forRaster:false` keeps `data-original-*` (valid-encoded) for re-edit.
2. **getLayerSvg** = `serializeEditor(forRaster:true)` filtered by `data-layer` → the stamp
   parse never sees poison (fixes fill=none).
3. **Persistence = one form:** `P.editorSvg = serializeEditor(forRaster:false)` (valid XML,
   round-trippable). Retire `save`/`saveWithTextCopies`/`editor.lastSvg` as separate forms;
   make `P.stampLayers[].svg` a derived view (or drop the mirror per F-new-broad).
4. **open()** parses that one valid-XML form → round-trips (fixes reopen-blank); add a
   defensive sanitize before the parse for legacy poisoned saves.
5. **Stamp** derives per-layer from #2 live — no mirror, no staleness.

### Slice plan (EDM2+)
- **EDM2 (unblock — highest impact, browser-verifiable).** Make `data-original-*`
  round-trip-safe. Options: **(A)** base64-encode the snapshot when writing the attr
  (`editor-expand-commit.js:117`) + decode on re-edit → the whole serialization is valid XML
  everywhere (recommended — preserves re-edit); **(B)** strip `data-original-*` before the
  DOMParser in BOTH `getLayerSvg` (`:100`) and `open()` (`:415`) (mirrors `render-svg.js:53`)
  — fixes both symptoms immediately but loses re-edit of already-expanded elements. Verify
  with headless Chromium (like SM1): expand a shape → stamp shows a FILLED region; close +
  reopen → content restored.
- **EDM3 (one serializer):** unify `save`/`saveForRasterization`/`saveWithTextCopies` into
  `serializeEditor({forRaster})`; route getLayerSvg + open + persist + rasterize through it;
  retire `editor.lastSvg`.
- **EDM4 (one persisted form):** `P.editorSvg` sole editor-content store; `P.stampLayers[].svg`
  becomes a derived view (or retire mirror). Decide the `app-init.js:48` clear-on-load (should
  content survive a reload?).
- **EDM5 (empty-source guard):** ensure onChange persisted before open; handle svgLen=0.

### Open questions (advisor)
1. EDM2 approach: **A (base64, keeps re-edit)** vs **B (strip before parse, drops re-edit)**?
2. Should drawn strokes stamp as filled automatically, or is Expand always required? (The log
   session was raw strokes — even a perfect pipeline won't "fill" an unexpanded open stroke.)
3. Keep this design in WORK-LOG, or extract to `EDITOR-SOT-DESIGN.md` as the EDM substrate?

**No repo code edits** — design/diagnosis only (+ ran a read-only pipeline-trace subagent).
Only this log.

---

## Turn 31 — EDM2: base64 the expand snapshot (FIX, browser-verified, both editor copies) — DONE

**Scope-first (as directed):** the poison attr `data-original-*` has **1 WRITE**
(fresh snapshot, `editor-expand-commit.js:117`; the two carry-forwards at `:112/114`
pass already-encoded values through) and only **2 markup READ sites** that must decode
(`editor-expand-trace.js:46` re-edit, `editor-io.js:259` saveWithTextCopies); the
`editor-expand-trace.js:120` read is a presence check. Small → stayed with **Approach A**
(base64), no gate to B.

**Changes (both trees — `data-original-*` is now valid-XML base64):**
- `core/svg-utils.js` (both copies): `encodeSnapshot` (Unicode-safe base64),
  `decodeSnapshot` (legacy raw-markup passthrough), `stripOriginalAttrs`.
- `editor-expand-commit.js:117`: `encodeSnapshot(_snapshotMarkup(...))` — the fresh
  snapshot is base64 → no raw `<>` in the attribute → the containing SVG stays valid XML.
- `editor-expand-trace.js:46`: `decodeSnapshot(...)` on the re-edit read.
- `editor-io.js`: (a) **getLayerSvg** strips `data-original-*` before its strict parse
  (raster doesn't need it) → fixes fill=none for legacy content too; (b) **open()**
  now retries `stripOriginalAttrs`+reparse when the first strict parse yields no
  `<svg>` → recovers legacy-poison saves instead of reopening blank; (c) saveWithTextCopies
  read (`:259`) decodes.
- Mirrored the 3 IDENTICAL editor/ files to stamp-editor (`cp`, `diff -q` clean); added
  the same 3 helpers to stamp-editor's DRIFTED `svg-utils.js` (couldn't cp).

**Legacy handling:** new saves = base64 (valid XML, parse first try, re-edit metadata
preserved). Old poisoned saves: `decodeSnapshot` passes their raw markup through for
re-edit, and getLayerSvg-strip / open-retry recover them (geometry restored; per-element
re-edit metadata for those legacy elements is lost — acceptable).

**Verify:**
- Helper unit tests (real module, node): encode→decode round-trip ✓, Unicode ✓, legacy raw
  passthrough ✓, empty ✓, `stripOriginalAttrs` removes the attr but keeps `fill="#000000"` ✓.
- **Headless Chromium** (real `svg-utils.js` module + real DOMParser), simulating
  commitExpandedPath output (a filled `fill="#000000" fill-rule="evenodd"` path carrying
  `data-original-svg`):
  - NEW base64 attr → strict parse OK, path **`fill=#000000` preserved** → stamp gets the
    fill AND `open()`'s `querySelector('svg')` is non-null → content restores.
  - OLD raw-poison attr → path **`fill=null`** (fill LOST — reproduces the bug).
  - poison + `stripOriginalAttrs` → **`fill=#000000` recovered** (the open() fallback).
  - `encHasAngle=false` (base64 = valid XML), decode round-trip ✓.
  (The synthetic poison parsed leniently to svg:true/fill:null rather than a hard null-svg,
  but the fill-loss vs fill-preserved contrast is decisive; the real end-to-end
  draw→expand→apply→reopen UI drive was not scripted — verified the fix MECHANISM with real
  module code in a real browser.)
- All 8 files `node --check` OK; the 3 editor files byte-identical across trees.
- Started/killed a local http.server for the test (port down; proc tree clean).

**Scope:** both editor copies. Did NOT unify the serializers or retire the mirror (EDM3/EDM4).

---

## Turn 33 — EDM3: unify serializers (REFACTOR, behavior-preserving) — DONE (getLayerSvg flagged)

**Changes (both editor copies, `editor-io.js`):**
- Promoted `_serializedContent(editor)` → `serializeEditor(editor, { forRaster })`. `forRaster:false`
  is byte-identical to the old `_serializedContent` (`stripSvgjsAttributes(innerHTML)`); `forRaster:true`
  also strips `data-original-*` (raster doesn't need it).
- Routed **save / saveForRasterization / saveWithTextCopies** through `serializeEditor(editor)`
  (forRaster:false) — their font-embed / text-copy / layers-attr extras kept as caller logic.
- Retired dead **`editor.lastSvg`** — 3 writes, **0 reads** (grep-confirmed) → removed the 3 assignments.

**⚠️ FLAGGED — getLayerSvg NOT routed (kept byte-identical, per "outputs MUST stay equivalent"):**
A headless-Chromium byte-compare of old-vs-new getLayerSvg found a **divergence**: routing it through
`serializeEditor({forRaster:true})` strips svg.js attrs BEFORE getLayerSvg's strict `image/svg+xml`
parse, whereas getLayerSvg strips them AFTER. An undeclared `svgjs:` attr makes the strict parse a
`parsererror`, so the two orders differ — **OLD getLayerSvg returns `""` (empty stamp) when a child
carries a `svgjs:` attr; the routed version returns the content.** For real sketch children (which carry
NO `svgjs:` attrs — the browser test's `noSvgjs_equal:true`, and the working stamp/runtime log confirm it)
they are equivalent. To honor the equivalence constraint I **left getLayerSvg's own strip order unchanged**
(only added an explanatory NB comment). Net: this surfaces a **latent bug** — OLD getLayerSvg silently
returns `""` (empty stamp) if svg.js ever writes a `svgjs:` attr onto a sketch child; a targeted follow-up
could route it through `serializeEditor` and accept that (strictly-improving) behavior change.

**Verify (browser + node):**
- `node --check` both trees OK; `editor-io.js` mirrored identical across trees.
- Browser equivalence (real `svg-utils` module + real DOMParser): `serializeEditor({forRaster:false})`
  === old `_serializedContent` ✓; getLayerSvg old===new for real (no-svgjs) content ✓ (diverges only on
  the svgjs-present case above).
- Palette loads headless with **`pageErrors: []`**, `window.svgEditor` ready with working
  `save`/`saveForRasterization` → the refactored module integrates cleanly.
- Server tidied (port down); proc tree clean.

**Scope:** `editor-io.js` (both trees). Did NOT route getLayerSvg (flagged) and did NOT retire the
P.stampLayers mirror (EDM4).

---

## Turn 35 — EDM3b: route getLayerSvg through the one serializer — DONE

Advisor accepted the EDM3-flagged improvement. Routed getLayerSvg's raster content through
`serializeEditor(editor, { forRaster: true })` (strips data-original-* + svg.js attrs before the
strict parse), keeping getLayerSvg's own data-layer filter + `<svg>` wrapper. Both editor copies
(mirrored identical).

**Verify (browser + node):**
- `noSvgjs_equal: true` → for real sketch content (no `svgjs:` attrs) getLayerSvg output is
  **byte-identical** to before.
- svgjs-edge: OLD returned `""` (empty stamp), routed now returns the content →
  **latent empty-stamp bug fixed** (the one EDM3 flagged).
- `node --check` both trees OK; `editor-io.js` identical across trees.
- Palette loads headless: `pageErrors: []`, `window.svgEditor` ready.
- Server tidied (port down); proc tree clean.

**getLayerSvg now fully derives from the one `serializeEditor`** — save/saveForRasterization/
saveWithTextCopies (EDM3) + getLayerSvg (EDM3b) all route through it. Did NOT touch the
P.stampLayers mirror or the empty-source path (EDM4), as directed.

---

## Turn 37 — F12: untrack committed cruft + gitignore the patterns — DONE

`git rm --cached` (kept on disk) the tracked log/diff/tmp/bak cruft, appended ignore patterns so
they can't return. Editor thread stays Fusion-test-gated; this was the safe hygiene win.

**What changed:**
- Untracked 8 files (kept on disk): `debug_log.txt.err`, `pages_deploy_log.txt.err`,
  `diff_check.txt`, `diff_current.txt`, `diff_state.txt`,
  `bspline-frame-builder/sync_stamp_bundle.py.tmp`,
  `bspline-frame-builder/b-spline-gen/b_spline_gen_log.txt.old`,
  `cloud/preset-worker/src/index.js.bak`.
- `.gitignore` += `*.err`, `diff_*.txt`, `*.py.tmp`, `*.old`, `*.bak` (advisor's exact patterns).

**Deviation from the dispatched list (flagged for review — reversible):** NEXT-SESSION named **7**
files; I untracked **8**. The extra is `pages_deploy_log.txt.err` — a deploy log in the *same
`*.err` class* as the named `debug_log.txt.err`. The advisor's own step-2 verify grep
(`\.(err|old|bak)$|diff_.*\.txt|\.py\.tmp$`) lists it too. Rationale: the durable declaration is the
PATTERN (`*.err`); untracking only 7 would leave `pages_deploy_log.txt.err` **tracked-but-ignored**
— a landmine that still churns `git status` and contradicts the pattern. So I made the tracked set
consistent with the advisor's own declared ignore. Fully reversible (`git add` re-tracks; file is on
disk). If the advisor wants it kept tracked, narrow `*.err` → the exact `debug_log.txt.err` and
`git add pages_deploy_log.txt.err`.

**`.gitignore` rider (noted):** the file already carried an uncommitted handoff-machinery ignore
block (`HANDOFF.md`, `.handoff/`, `.proc/`, `STOP`) — coordination hygiene that's *already active*
(it's why those don't show in `git status`). F12 authorizes committing `.gitignore`, so that block
lands in this commit alongside the F12 patterns. Harmless/desirable (keeps coordination state out of
the repo); called out so it isn't a surprise in the diff.

**Verify (no Fusion):**
- All 8 files still ON DISK (checked each).
- `git ls-files | grep -E '\.err$|diff_.*\.txt$|\.py\.tmp$|\.old$|\.bak$'` → **empty** (none tracked).
- `git check-ignore` returns all 8 → future modifications (incl. the live `*.old` log) suppressed →
  **git-status churn gone** (no need to write to a live log to prove it — check-ignore is conclusive).
- No real source newly ignored: only the 8 cruft files match across ALL tracked files; **zero**
  untracked source matches the patterns (`git ls-files --others --exclude-standard | grep …` empty).
- `git diff --cached --stat` = exactly the 9 intended changes (.gitignore + 8 removals); advisor's
  `NEXT-SESSION.md`/`ROADMAP.md` left untracked, NOT committed.
- No processes spawned this turn (pure git/fs).

---

## Turn 39 — F11a: persistent vitest suite locking in EDM2/3/3b — DONE

Stood up a real JS test runner (vitest + happy-dom) and 15 tests that pin the editor
SVG-serialization fixes so they can't silently regress. Editor→B4 stays Fusion-test-gated;
this is the safe verifiable slice.

**What landed (test infra only):**
- `package.json`: `+ "test": "vitest run"`, devDeps `vitest ^4.1.10` + `happy-dom ^20.10.6`
  (+ `package-lock.json`).
- `vitest.config.js`: minimal, `environment: 'happy-dom'`, `include: tests/**/*.test.js`.
- `tests/editor-serialization.test.js`: 15 tests importing the SHIPPING b-spline-gen modules.
- `README.md`: one-line Testing note (`npm test`).

**Key design decisions (the WHY):**
- **happy-dom DOES strict-parse `image/svg+xml`.** The whole EDM2 bug needs a strict parser
  (raw `<` in an attribute → parsererror → element dropped). I did NOT assume happy-dom would
  do this — wrote a throwaway probe first: POISON → `hasParsererror:true, pathPresent:false`;
  base64 → `parsererror:false, fill="#000000"`. Confirmed → kept happy-dom (advisor's pick),
  no jsdom needed. Probe deleted before commit.
- **`serializeEditor` is NOT exported** (module-internal). Rather than reach into a private, I
  lock its `forRaster` behavior through its two public callers: `save()` (forRaster:false →
  keeps base64 `data-original-*`) and `getLayerSvg()` (forRaster:true → strips it). Tests
  observable behavior, which is stronger.
- **Mock editor, no real svg.js.** `save`/`getLayerSvg` read only `_draw`,
  `_sketchLayer.node.innerHTML`, `_mW`, `_mH` (and `_layers` [] → layers-attr no-op). A 6-field
  stub drives them; importing `editor-io.js` (→ fusion-bridge/layers/text-baseline) loads clean
  under happy-dom (none have import-time side effects; `fusLog`'s `adsk` ref is inside try/catch).
- **Poison test uses the REAL `encodeSnapshot`** for the good path, a hand-built raw-markup attr
  for the poison path — so a revert of the encoder breaks it.

**Revert proof (task-required):** temporarily swapped `encodeSnapshot` → `return svgMarkup`
(raw). `npm test` went RED: **4 failed** — incl. the core EDM2 test `base64 snapshot … preserves
fill` and `encoded output is XML-attribute-safe`. Restored via `git checkout -- svg-utils.js`
(confirmed clean); suite back to **15/15 green**. The guard is proven, not assumed.

**FLAG — advisor app-code change found in the tree, left UNTOUCHED:**
`bspline-frame-builder/stamp-editor/html/core/stamp/svg-utils.js` is modified (` M`, mtime
11:23:51 = during advisor turn 38, before my turn 39 began) — it ADDS encodeSnapshot/
decodeSnapshot/stripOriginalAttrs to a THIRD (drifted) svg-utils copy under `core/stamp/`. Not my
work, it's app code, and my suite imports the b-spline-gen copy (unaffected). Per ownership +
"don't touch what you didn't create," I did NOT stage or revert it — leaving it for the advisor.
My commit `git add`s ONLY my files explicitly (package.json, package-lock.json, vitest.config.js,
tests/, README.md, WORK-LOG.md); NEXT-SESSION.md/ROADMAP.md also left untracked.

**Fork note:** the suite pins the b-spline-gen editor tree; the same EDM2/3/3b fixes live in the
stamp-editor tree (kept in sync by sync_stamp_bundle.py). A follow-up could parametrize the suite
over both copies — noted, not done (F11a scope = the JS core, one canonical copy).

**Verify:** `npm test` → 15/15 green (exit 0); revert → 4 red (exit 1) → restore → 15 green.
No app-code committed (staged set = test infra + docs only). Runner: vitest run (no watcher left).

---

## Turn 41 — RO1: reproduce + fix editor reopen-persistence (test-first) — DONE

THE priority (human-confirmed). Reproduced draw→apply→close→reopen going blank in headless
Chromium FIRST, diagnosed the exact loss point, fixed it, and locked it with a regression test.
b-spline-gen only; `main/` is single-copy (verified — no stamp-editor fork of main/stamp/).

**Reproduced first (headless Chromium, real modal lifecycle), BUG confirmed:**
Drove the REAL user cycle via `#btnStampEdit` (open) → draw a path on `_sketchLayer` + `_onChange`
→ `#editorApply` (commit+close) → `#btnStampEdit` (reopen). Read the real `P` singleton via
dynamic import. Result: `afterDraw` sketchChildren=1, `P.editorSvg`=707, stampLayer svg=707 (saved
fine); **`afterReopen` sketchChildren=0 (BLANK)**, layer roster jumped `["1"]`→`["2"]`. That
id-bump = `open()` took its empty-editor branch → it got a FALSY svg.

**Root cause (verified, not assumed) — `main/stamp/_shared.js:28-40` + `svg-source.js:100`:**
Intercepted `open()`'s argument at reopen → `{type:"undefined", len:0}`. Inspected what
`ctx.activeLayer()` returns: an EDITOR layer whose keys are `[id,name,visible,depth,profile,angle,
tx,ty,rotation,scale,mirrorX,mirrorY,blur,smoothing,suppression,edgeFilletRadius,filletPower,_mask]`
— **no `.svg`**. The Step-3 unification migrated `ctx.activeLayer()` to return editor layers (which
partition ONE document), but the reopen path still read `currentLayer.svg` as if it were the old
per-stamp-layer model. Editor layers carry no `.svg`; the whole-document SVG lives in `P.editorSvg`.
So reopen passed `undefined` → `open()` empty branch → blank + fresh layer id.

**Fix (declare-over-hand-roll, minimal, NOT gated — fully verifiable headlessly):**
The correct "what SVG restores the editor" rule already existed INLINE in `app-init.js:119`
(`P.editorSvg || legacy stamp-svg fallback`). Rather than hand-roll a 2nd copy in the reopen path
(the exact divergence that caused this bug), I extracted it once:
`app-init.js` → `export function editorRestoreSvg()` (faithful extraction — app-init's initial
restore now CALLS it; behavior identical, verified). `svg-source.js` reopen → imports it and calls
`open(editorRestoreSvg(), …)` instead of `open(currentLayer.svg, …)`. Now both restore paths share
one rule and can't drift. Guard against the legacy path preserved (P.editorSvg first, stamp-svg
fallback).

**Verified 3 ways:**
- Live headless Chromium (real lifecycle): `BUG_reproduced:false`, reopen sketchChildren=1, roster
  restored to `["1"]`, open() receives the 707-char doc.
- happy-dom integration test `tests/editor-reopen.test.js` (3 tests): drives the REAL
  `initSvgSource` reopen handler + REAL `ctx.activeLayer()` (createStampCtx) with a mocked
  window.svgEditor — asserts reopen opens `P.editorSvg`, not undefined; documents the root cause
  (activeLayer has no .svg); pins `editorRestoreSvg` precedence. Confirmed it's a real guard:
  reverting `svg-source.js` to `open(currentLayer.svg)` turns that test RED (1 failed), restored →
  green. **npm test 18/18 green** (15 existing + 3 new).
- `node --check` both touched files OK.

**Note on the revert-proof:** I proved the guard by temporarily reverting svg-source.js then
`git checkout`-ing it — but the fix wasn't committed yet, so checkout dropped the WHOLE fix, not
just the temp change. Caught it immediately (suite went red on the restore run), re-applied both
edits via Edit, re-verified 18/18 + live repro green. Lesson logged: for uncommitted revert-proofs,
restore via Edit, not git checkout.

**FLAGGED (related, NOT fixed — surgical scope + needs own repro):** the Cancel-snapshot in the
same handler (`svg-source.js:95`) also reads `SvgEditorSnapshot.svg = currentLayer.svg` → `undefined`
in the unified model, so a Cancel after reopen would set `P.stampLayers[idx].svg = undefined`
(stamp-mirror wipe). My fix makes reopen read `P.editorSvg` (untouched by that), so reopen-
persistence is robust regardless — but the Cancel/stamp-mirror path is a separate follow-up worth a
look. Also still in the tree, untouched by me: the advisor's uncommitted
`stamp-editor/html/core/stamp/svg-utils.js` (from turn 38) and an untracked `.claude/` dir (not
mine). I committed ONLY my 4 files.

---

## Turn 43 — EX1: expanded vectors emboss at MICRO scale — reproduce + fix (test-first) — DONE

Reproduced the micro-scale expand in headless Chromium, root-caused it, fixed it in BOTH forked
editor copies, locked the fix's math in `npm test`. b-spline-gen editor tree (forked → both copies).

**The diagnostic journey (measurement, not assumption):**
The advisor's hypothesis was "expand-commit.js:104 transform:null drops a source scale not baked
into d." I MEASURED it (parse bbox from the `d` string; source WORLD bbox = source d × el.matrix()):
- stroke no-transform (expandShape): ratio ~1.0 ✓
- stroke SCALED x3 (expandShape): srcWorld w=3.9, expanded w=4.0, **ratio 1.026 ✓** — expandShape
  DOES bake the transform (via getPointAtLength world-transform). Hypothesis REFUTED for shape/text
  in this environment.
- filled scaled (expandTrace): trace renders transformed content into a LOCAL-bbox viewBox →
  content falls outside → empty, leaves original untouched (a real but separate defect, not micro).
Key gotcha: the editor lives in a display:none modal, so el.bbox()/rbox() return 0 and canvg can't
rasterize — I had to open the modal (display:flex) + set a real viewport before measurements worked.

**Root cause (CONFIRMED by reproduction):** expand bakes the transform with
`new SVG.Point(x,y).transform(m)`. `expandShape`/`expandGeometric` (editor-expand-shape.js:168)
even GUARDS it behind `&& SVG.Point` and SILENTLY skips the transform when SVG.Point is missing;
`expandText` (:103) uses it unguarded. SVG.js's Point.transform is "historically unreliable" (the
code's OWN comments say so — expand-text.js:96, transform-handles.js:342 has a manual fallback for
exactly this). Reproduced deterministically by stubbing `SVG.Point = undefined` (simulating that
host build) and expanding a scaled-x3 stroke:
- **with SVG.Point: ratio 1.026** (world coords `M 1.350 1.400…`)
- **without SVG.Point: ratio 0.359 ≈ 1/3 = 1/scaleFactor — MICRO** (local coords `M 0.250 0.300…`)
The offset ring is built in LOCAL space, then commit drops the transform → ~1/scale.

**Fix (declare-over-hand-roll — the reusable concept already existed):** `editor-coords.js` header
literally says it's "the ONE place we bake an element's transform into geometry… expand-text used
el.x()… expand-shape used el.transform()… these helpers make the right answer the easy answer" —
yet expand hand-rolled the fragile SVG.Point instead. Added a matrix-taking sibling
`transformPoint(m, pt)` (pure manual affine `[a c e; b d f]`, no SVG.js dependency; worldPoint now
delegates to it) and routed expand-shape (:168) + expand-text (:103) through it. Baking can no
longer be skipped or misbehave. LOW risk: mathematically identical to Point.transform in the working
case, correct in the failing case; same affine transform-handles/worldPoint already use. NOT gated.

**Both forked copies:** the 3 files (editor-coords, expand-shape, expand-text) are byte-identical
between b-spline-gen and stamp-editor EXCEPT line-endings (b-spline-gen LF, stamp-editor CRLF — not
real drift). Mirrored by writing the edited content to stamp-editor with CRLF preserved (Python
convert), so the stamp-editor diff is just my ~40 changed lines, not a whole-file EOL flip. Verified
both trees byte-identical (content) + node --check both.

**Verify:**
- Headless repro: scaled stroke, SVG.Point stubbed → ratio 0.359 (micro) on old code, **1.026
  (fixed)** after. Also confirmed with SVG.Point present stays 1.026 (no regression).
- Guard PROVEN: reverted expand-shape to the SVG.Point version → measure5 micro (0.359) again;
  restored → 1.026. (Reverted via Edit, not git checkout — the fix isn't committed; RO1 lesson.)
- `tests/expand-transform.test.js` (5 tests) pins `transformPoint`: scale+translate, the EX1 3x
  scenario (1.4 not micro 0.3), rotation/shear, identity/null, and works with SVG undefined.
  **npm test 23/23 green** (18 + 5). node --check both trees OK.

**Test-coverage note (honest):** the full expand pipeline needs real SVG geometry
(getPointAtLength) which happy-dom lacks, so the committed CI guard is the transformPoint unit test
(the fix's core math); the end-to-end integration guard (revert expand-shape → micro) is the
Playwright measurement (scratchpad/ex1-measure5.cjs), documented here — same split RO1 used
(happy-dom test committed, Playwright repro documented). A follow-up could add a devDep Playwright
e2e if desired.

**Also noted (NOT fixed — out of EX1 scope):** (1) expandTrace renders transformed content into a
LOCAL-bbox viewBox → scaled filled shapes trace empty (silent no-op). Separate bug. (2) expand-text
still uses `SVG.PathArray` to PARSE the glyph path (a different svg.js dependency than the
point-transform I fixed); if that's also absent in the host build, text expand would throw→trace.
(3) transform-handles.js:339 / editor-eraser.js:344 still hand-roll `SVG.Point.transform` — could
also migrate to transformPoint for full robustness (declare-over-hand-roll), but left untouched
(surgical scope). (4) Still untouched by me: advisor's uncommitted stamp-editor/core/stamp/
svg-utils.js (turn 38). Committed ONLY my 7 files.

### Turn 43 — AMENDMENT (normal vectors offset DOWN when sent/stamped) — investigated, GATED

Advisor amended mid-task: NORMAL (non-expanded) vectors are offset DOWN when sent/stamped; measure
position too; diagnose if it's the SAME root as expand-micro; fix both or gate if risky.

**Measured (headless, modal visible):** drew a line at y=2, serialized via `getLayerSvg` (the stamp
path). Output: `d="M1 2 L6 2"`, `viewBox="0 0 7 9"`, Y = 2 — **getLayerSvg preserves Y EXACTLY, no
offset.** A dragged element (`transform="translate(0,1)"`) keeps its transform in the output too.

**Diagnosis — NOT the same root as expand-micro, and NOT in the editor serialization:**
- expand-micro = SVG.Point-dependent transform baking INSIDE the expand strategies (fixed above).
  Normal vectors never go through expand, so that fix doesn't touch them.
- getLayerSvg (the one editor→stamp seam I can test headless) is CORRECT (Y preserved). So the
  "offset down" is DOWNSTREAM of the editor:
    * STAMPED: getLayerSvg → `main/stamp-mask-manager.js:52` → `core/stamp/render-svg.js` rasterizes
      to the terrain grid with a `layerTransform` (tx/ty/rotation/scale). A Y-flip/origin mismatch in
      that viewBox→grid mapping would offset every stamp. (Broad subsystem — changing it affects ALL
      stamps + terrain mapping.)
    * SENT: `main/app-init.js:175` (send-to-Fusion, import_svg_sketches) and
      `main/export-flow.js:250,286` which wrap `l.svg` in `normalizeSvgForCarving` — the flip-Y
      `translate(0 height) scale(1 -1)`. If height is wrong / double-applied / applied to an already
      world-space doc, a shape at y=2 in a height-9 space flips to y≈7 = "offset down." This path is
      Fusion-only — NOT reproducible headless.

**GATE (per the amendment's "gate if the coordinate fix is risky"):** the normal-offset is a
separate, downstream coordinate bug in the rasterizer (render-svg terrain mapping) and/or the
Fusion-send flip-Y — different root from expand-micro. Fixing it blind is risky (all-stamps blast
radius) and the send path can't be verified without Fusion. Need from advisor:
  1. Is the offset seen in the STAMP/terrain preview (headless-testable via render-svg) or ONLY when
     SENT to Fusion? That decides where to dig.
  2. If STAMP: I'll measure render-svg's viewBox→grid Y mapping next turn and fix + test there.
  3. If SENT: likely `normalizeSvgForCarving` flip-Y height/space — needs a Fusion round-trip to
     verify; recommend a human/Fusion check of the exact offset (= mH? = a constant?).
Landing the verified expand-micro fix now; holding the normal-offset for this synthesis.

---

## Turn 45 — SC1: TRACE + PROPOSE the send-to-Fusion carve-path (micro+flip+offset) — GATE (no code)

Traced ONE point (editor svg coords x=1, y=2; 7x9 board; scale=96) through each carve-path stage by
RUNNING the real `_prescale_svg` (pure string fn — copied verbatim, no repo edit) + reading the JS
send wiring. NO code changed. Findings refine the advisor's "two flips" hypothesis: the DOMINANT
root is not the flips — it's a regex that misses the coordinate format editor SVGs actually use.

### The two carve paths
- **Path A — editor "Send to Fusion" button** (`app-init.js:175` initSendToFusionButton →
  `import_svg_sketches`): sends RAW `getLayerSvg` (inch units, Y-normal, viewBox "0 0 7 9", NO
  normalize) → Python `_import_single_layer_svg:1400` → `_prescale_svg` (flip+scale+center). ONE flip.
- **Path B — STEP export "OK" with stamp** (`export-flow.js:250`): `normalizeSvgForCarving(l.svg)`
  (JS flip via `<g translate(0 H) scale(1 -1)>` group wrapper) → payload → Python
  `_import_all_svg_layers:1388 → _import_single_layer_svg → _prescale_svg` (flip again). TWO flips.

### THREE pinned roots (evidence = the table below, from running _prescale_svg)
1. **MICRO (dominant) — `_prescale_svg` coord regex is COMMA-only, editor `d` is SPACE-separated.**
   `scale_d`/`scale_pts` use `re.sub(r'([-\d.]+),([-\d.]+)', ...)`. getLayerSvg/svg.js emit
   `d="M1 2 L6 2"` (spaces) — measured (turn 43/45). So `<path>` coords are NEVER scaled/flipped/
   centered:
     - space `d="M1 2 L6 2"`   -> `_prescale_svg` -> `d="M1 2 L6 2"` (UNCHANGED)
     - comma `d="M1,2 L6,2"`    -> `d="M-240.0,192.0 L240.0,192.0"` (correct)
   Untransformed inch-unit path coords (0..7) reach Fusion, which reads them as raw pixels
   (1 unit = 1/96 in). Result = **1/96 scale (micro) + not flipped + not centered (corner)** — i.e.
   micro+flip+offset ALL from one bug, hitting every `<path>` (all expanded shapes + drawn strokes).
   This is the "expand-specific micro" on the send path (expanded shapes are always `<path>`), and it
   is SEPARATE from the EX1 editor micro (SVG.Point) already fixed — that one made `d` micro in the
   editor; THIS one fails to scale a CORRECT `d` on the send.
2. **OFFSET DOWN — the `-(0.5*scale)` fudge (lines 42, 55).** For coords that DO transform
   (rects/text x/y, comma-paths): expected cad_y for svg_y=2 is +2.5in (+240px); `_prescale_svg`
   yields +2.0in (192px) = **0.5 inch LOW**. The "to fix drift" constant is itself the offset-down.
3. **DOUBLE / DEAD FLIP — two flip sites.** Path B applies `normalizeSvgForCarving`'s
   `<g scale(1 -1)>` group flip AND `_prescale_svg`'s coord flip. `_prescale_svg` never touches
   `transform=` attrs, so the `<g>` wrapper survives into the file. Net effect depends on whether
   Fusion's importer honors group transforms (its own comment says it ignores viewBox/width/height/
   scale, reading "raw pixels" — so it likely IGNORES the group flip too, making normalizeSvgForCarving
   DEAD CODE on Path B; if it DOES honor it, Path B double-flips = upside down). Either way: redundant/
   wrong. NEEDS a Fusion probe to confirm (see gate).

### PROPOSAL — the single correct transform (editor svg-space -> Fusion px-space)
One affine, applied ONCE, to ALL geometry, with element transforms baked first, NO fudge, ONE flip:
    cad_x = svg_x * 96 - half_w
    cad_y = half_h - svg_y * 96          (NO -0.5*scale)
(half_w=w_in*96/2, half_h=h_in*96/2). For (1,2): (-240, +240)px = (-2.5, +2.5)in — right-side-up,
centered. Two implementation options (advisor picks — this is the gate):
- **Option A (RECOMMENDED): bake in JS, make Python a no-op.** In the send path, flatten every
  element's transform (editor already has `flattenTransform`) then apply the single affine to the
  geometry using a REAL SVG engine (browser) — reuse `editor-coords.transformPoint` (the EX1 helper)
  — emitting an SVG whose coords are already Fusion px-space. Remove `normalizeSvgForCarving` from
  export-flow AND the transform work from `_prescale_svg` (it becomes pass-through). Kills all three
  roots at once: no regex (real path handling), one flip, one scale, no fudge, transforms baked.
- **Option B: keep it in Python, but robustly.** Replace the comma-only regexes with a real
  path/points parser that handles space AND comma AND relative commands; bake element `transform=`
  attrs; drop the 0.5 fudge; remove the JS `normalizeSvgForCarving` so there's a single flip.
  More fragile (hand-rolling an SVG path parser in regex/Python) — hence A preferred.

### TEST PLAN (proposed; implement after the approach is blessed)
- **Python unit test (pure, no Fusion):** `_prescale_svg`/replacement on a shape with SPACE-separated
  `d` -> assert coords ARE transformed (currently FAILS — the guard for root 1), scale ×96 exact,
  right-side-up (flip), centered, and y has NO 0.5" offset (root 2). Table-drive svg(1,2)->(-240,+240).
- **JS unit test (happy-dom):** the JS bake produces Fusion-space coords for a known shape; assert one
  flip, transforms baked (a scaled/dragged element lands at its VISIBLE position, not local), no
  leftover `<g scale(1 -1)>` / element `transform=` (root 3).
- **End-to-end coord assertion:** editor (1,2) -> final SVG coord == (-240,+240)px through the chosen
  pipeline; a scaled-x3 shape lands 3x (not micro).
- **Fusion round-trip (MCP/manual, gated):** import a known SVG, read the sketch's point coords in the
  design, assert right-side-up + correct scale + centered. Also settles the "does Fusion honor
  <g transform>" question for root 3.

### GATE — need from advisor before ANY carve-path edit
1. Approve Option A (JS bake, Python pass-through) vs Option B (robust Python).
2. Confirm which path the user's "send to Fusion" is (editor button = Path A single-flip, or STEP
   export = Path B double-flip) — both share the comma-regex micro, so root 1 is common, but the
   flip fix differs by path.
3. OK to run a one-shot Fusion MCP probe (import a tiny known SVG into a scratch sketch) to settle
   whether Fusion honors `<g transform>` — or does the advisor already know? That decides root-3 scope.
No code touched this turn (trace/propose only, per SC1). WORK-LOG only.

---

## Turn 47 — SC2: implement Option A (single JS carve transform) — DONE (human-Fusion-confirm)

Implemented the blessed Option A: bake the ONE board→Fusion carve transform into the SVG coordinates
in JS, remove the JS flip wrapper, and make the Python transform pass-through — killing all three
SC1 roots (micro / offset-down / double-flip). Editor tree = forked → both copies. No live Fusion
(human read-only session); the coordinate math is unit-tested + browser-verified, human confirms the
Fusion import.

**Path A confirmed DEAD (gate condition not met → proceeded):** grep — NO Python handler for the
`import_svg_sketches` channel the editor "Send to Fusion" button emits (app-init.js:201). So that
button already does nothing; my changes don't touch its code (it still calls getLayerSvg, unchanged).
The LIVE carve path is Path B: `export-flow.js:250` → STEP payload → Python
`_import_all_svg_layers → _import_single_layer_svg → _prescale_svg`. (If Path A is ever revived, it
must also route its getLayerSvg through bakeSvgForCarving — noted.)

**What changed:**
- `editor-coords.js` (both trees): `+ carveMatrix(widthIn, heightIn, dpi)` — the single affine
  `{a:dpi, b:0, c:0, d:-dpi, e:-widthIn*dpi/2, f:heightIn*dpi/2}` (×dpi scale, ONE flip via d<0,
  center; NO 0.5 fudge).
- `editor-transform-handles.js` (both trees): generalized `flattenTransform(el)` → thin wrapper over
  new `bakeMatrixIntoElement(el, m)` (bakes an EXPLICIT matrix). Behavior of flattenTransform
  unchanged (= bakeMatrixIntoElement(el, el.matrix())).
- `editor-io.js` (both trees): `+ bakeSvgForCarving(svgText, widthIn, heightIn, dpi)` — parses via
  svg.js (real engine), bakes `carveMatrix × el.matrix()` into every element (folding in each
  element's own drag/scale transform), descends through `<g>`, carves `<text>` anchor+font-size
  (glyph flip NOT handled — expand text first), returns a Fusion-ready SVG. Reuses
  bakeMatrixIntoElement + transformPoint (declare-over-hand-roll — no new path-baking code).
- `export-flow.js` (single copy): both `normalizeSvgForCarving(l.svg)` sites →
  `bakeSvgForCarving(l.svg, P.widthIn, P.heightIn, 96)` (send payload + downloadable .svg).
- `core/svg-utils.js` (both trees): removed `normalizeSvgForCarving` (the `<g scale(1 -1)>` flip) —
  left a breadcrumb comment. It was dead after the export-flow swap.
- `b-spline-gen.py`: `_prescale_svg` → PASS-THROUGH (`return svg_text`) — dropped the comma-only
  regex (the micro root), the -(0.5*scale) fudge (offset-down root), and its Y-flip (half the
  double-flip). Kept the def + call site valid.

**Verified:**
- Browser (real svg.js), the ACTUAL bakeSvgForCarving on known coords (7x9, dpi 96):
    - path (1,2)→(6,2)      → `M-240 240 L240 240`   (right-side-up +2.5in, ×96, centered, NO offset)
    - filled square (1..4)  → `M-240 336 L48 336 L48 48 L-240 48 Z`  (correct)
    - rect primitive        → promoted to path, correct coords, fill/stroke preserved
    - translate(0,1) path   → `M-240 144` (element transform folded → visible y=3)
    - **scaled x3 (matrix)** → `M-201.6 297.6 L172.8 297.6` = VISIBLE size, **not micro** (scale
      transform folded in — the send-path expand-micro is gone).
    - palette loads headless with `pageErrors: []` (export-flow→editor-io import chain OK).
- `tests/carve-transform.test.js` (6 tests) pins carveMatrix: corners/center, Y-flip (y=2→+240 NOT
  the fudged 192), ×96 scale (guards micro), board-size centering, dpi default. **npm test 29/29
  green.** node --check all touched JS; py_compile OK; both editor trees byte-identical (content).
- Editor + terrain PREVIEW untouched (stamp mask path uses getLayerSvg directly, no normalize) — so
  they stay correct, as expected.

**Left for the human (as directed): confirm in Fusion** the STEP-export stamp lands right-side-up,
correct scale, centered. My browser check proves the coords match the blessed formula; only the
actual Fusion importToTarget behavior is unverifiable headless.

**Edge cases FLAGGED (not blocking):** (1) `<text>` carve positions anchor+size but doesn't flip
glyph orientation — expand text to paths before carving (bakeSvgForCarving notes this). (2) svg.js
`SVG.PathArray` segment-walk assumes ABSOLUTE path commands (matches editor output; imported SVGs
with relative/arc commands could bake wrong — same assumption the editor's flatten already makes).
(3) The gitignored `dist/` build still references the old normalizeSvgForCarving/_prescale — it's a
build artifact, regenerated on deploy. (4) Still untouched: advisor's uncommitted
stamp-editor/core/stamp/svg-utils.js (turn 38). Committed ONLY my 12 files.

---

## Turn 49 — SC3: carve was upside-down top-to-bottom — invert carveMatrix Y — DONE

Human tested the SC2 carve in Fusion: correct scale/center but flipped TOP-BOTTOM. The SC2
carveMatrix inverted Y (d=-dpi, f=+half_h → cad_y = half_h - y*dpi); Fusion's importer already gives
the right orientation, so the flip made it upside-down. Fix = pass Y straight through.

**Change (ONLY carveMatrix, both editor copies):** `editor-coords.js`
    d: -dpi           → dpi
    f: +(heightIn*dpi)/2 → -(heightIn*dpi)/2
i.e. `cad_y = y*dpi - heightIn*dpi/2` (was `heightIn*dpi/2 - y*dpi`). x unchanged. Docstring updated
to record the SC3 correction. Nothing else touched — bakeSvgForCarving/export-flow/_prescale all
consume carveMatrix, so this one edit propagates.

**Test:** `carve-transform.test.js` Y-expectations re-signed — matrix `d:96,f:-432`; corners
(0,0)→(-336,-432), (7,9)→(336,432); y=2 → **-240** (not the flipped +240); 10x5 (1,1)→(-384,-144).
Center still (0,0). **npm test 29/29 green.** node --check both trees; both editor-coords identical.

**Human confirms upright in Fusion after redeploy** (no live Fusion this session). Left untouched:
advisor's uncommitted stamp-editor/core/stamp/svg-utils.js. Committed only carveMatrix (both) + test
+ WORK-LOG.

---

## Turn 51 — RB4: remove the dead editor "Send to Fusion" feature (audit B4) — DONE

The editor #editorSendToFusion button (Path A) was DEAD — it emitted an `import_svg_sketches` channel
with NO Python receiver (confirmed SC2/turn 47) and logged a FALSE `[SendToFusion] sent …` success.
Human doesn't use it. Removed by request (resolves audit B4 by removal). b-spline-gen only
(bspline_gen_palette.html + main/app-init.js are not forked).

**Removed:**
- `bspline_gen_palette.html`: the `#editorSendToFusion` button + its BUG-23 comment block (-9 lines).
- `main/app-init.js`: the `initSendToFusionButton()` call + its comment, and the entire
  `initSendToFusionButton` function (the visibility poller, the click handler that built the
  sketches payload, `adsk.fusionSendData('import_svg_sketches', …)`, and all `[SendToFusion]` logs)
  (-72 lines).

**Orphans my removal created — all cleaned (grep-confirmed):** the function was the ONLY user in
app-init.js of three imports, so I removed them from app-init's import list:
  - `getLayerSvg` (import line 10) — still exported by editor-io.js + used by stamp-mask-manager.js.
  - `fusLog` (line 11) — still exported by fusion-bridge.js + used by many modules.
  - `isFusionMode` (removed from the state.js destructuring on line 1) — still used by
    core/engine/rebuild.js, fusion-bridge.js, state.js.
None of the three is globally orphaned; only app-init's now-unused references were dropped. No
residual `editorSendToFusion|initSendToFusion|import_svg_sketches|SendToFusion` anywhere in
app-init.js. Python has no branch to remove (there was never an `import_svg_sketches` handler).

**Verify:** `node --check main/app-init.js` OK; palette loads headless — `editorReady:true`,
`sendBtnGone:true`, Apply/Cancel intact, real pageErrors `[]`; **npm test 29/29 green**.

**Process hygiene note:** I started the verify server via bash `&` + `kill $PID` this time — the
python child SURVIVED the kill (port stayed up, and proc_health didn't flag it since it wasn't in my
tracked tree). Caught it via `git status` (port 200), killed the port-8199 listener directly
(PID 26980) → port DOWN. Lesson: use the run_in_background tool + TaskStop for servers (as in prior
turns), not bash `&`. Tree clean now.

Left untouched: advisor's uncommitted stamp-editor/core/stamp/svg-utils.js. Committed only my 2 files.

---

## Turn 53 — C1/F7: de-fork stamp-editor (untrack the sync-generated copies) — DONE

The stamp-editor's editor+stamp modules are GENERATED from b-spline-gen by sync_stamp_bundle.py, but
were committed to git — so every b-spline-gen edit had to be hand-mirrored (this whole cycle) and the
copies drifted line-endings (sync's Python write_text emits CRLF on Windows vs b-spline-gen LF).
De-forked: untrack the generated copies, gitignore them precisely, regenerate via sync.

**MAP-VERIFY first (sync = source of truth):** read sync_stamp_bundle.py and classified all 62
tracked stamp-editor/html files against what sync writes:
  - GENERATED (54): `editor/**` (37, whole tree wiped+recopied), `core/stamp/**` (13, wiped+recopied
    incl. its coords/debug/svg-utils/gaussian + stamp files + profiles), and the 4 editor external
    deps `core/{coords,svg-utils,debug,gaussian}.js`.
  - UNIQUE / hand-written (8, KEEP tracked): `core/engine.js`, `core/runtime.js`, `index.html`,
    `main/{editor-bridge,layers,main,ui-bindings}.js`, `styles/stamp-editor.css` — sync never writes
    these (verified: _sync_one touches only core/stamp/, _sync_editor only editor/ + the 4 core deps).
  Exactly matches the dispatched list — no ambiguity, proceeded.

**Did:**
- `git rm --cached -r` the 54 generated files (kept on disk).
- `.gitignore` += the 6 PRECISE paths (editor/, core/stamp/, and the 4 named core deps — NOT
  `core/*` so engine.js/runtime.js stay tracked) with a regenerate note.
- Regenerated via `python bspline-frame-builder/sync_stamp_bundle.py` (wrote 54 files).
- README: fresh-clone bootstrap note (run sync after clone / after editing shared modules).

**Verify:**
- `git check-ignore` returns the generated files (editor-io/stamp svg-utils/coords) → ignored;
  `core/engine.js` NOT ignored → still tracked. Correct precision.
- Regenerated content REPRODUCES b-spline-gen (modulo EOL): editor-coords/io/transform-handles all
  MATCH; and `core/stamp/svg-utils.js` — which had been the advisor's uncommitted manual EDM2 edit
  (turn 38) — now MATCHES the import-rewritten b-spline-gen source, i.e. that dangling manual edit is
  RESOLVED into a clean generated artifact (the whole point of de-forking).
- `git status`: only the 54 `D` removals + `.gitignore` + README + WORK-LOG; NO generated file shows
  as untracked/modified (they're ignored) → EOL drift churn gone.
- **npm test 29/29 green** (the suite imports b-spline-gen, unaffected).
- Did NOT touch b-spline-gen source, and did NOT do the SVG.Point migration (C2), as directed.

**Effect:** b-spline-gen is now the sole tracked copy of the shared modules; future edits need no
hand-mirroring (the manual CRLF-copy dance from EX1/SC2/SC3 is retired) — just re-run sync. Left
untouched otherwise; committed .gitignore + README + WORK-LOG + the 54 untrackings.

---

## Turn 55 — C2: migrate remaining SVG.Point.transform hand-rolls to transformPoint — DONE

Declare-cleanup follow-up to EX1. After the C1 de-fork this is SINGLE-copy: edit b-spline-gen, run
sync, and the stamp-editor copy regenerates (ignored) — no manual mirroring.

**Migrated the two remaining `new SVG.Point(x,y).transform(m)` hand-rolls** (grep-found in
b-spline-gen/html) to the declared `transformPoint(m, {x,y})` (editor-coords.js), removing their
redundant manual affine fallbacks:
- `editor-transform-handles.js`: ELIMINATED the private `_xform(m,x,y)` helper entirely (it was a
  duplicate of transformPoint with an SVG.Point-first + manual fallback). Replaced its 4 call sites
  (line branch x1/y1/x2/y2, polyline/polygon plot, and `_bakeMatrixIntoPath`) with
  `transformPoint(m, {x,y})`. Imported transformPoint alongside worldBbox.
- `editor-eraser.js`: the stroke-sampling loop's `if(SVG.Point){…} else if(hasT){manual} else{…}`
  three-way collapsed to `pts.push(hasT ? transformPoint(m, pt) : {x:pt.x,y:pt.y})`. Imported
  transformPoint.

Now ALL editor transform-baking (expand-shape/text from EX1, transform-handles, eraser) goes through
the one `transformPoint` — no `SVG.Point.transform` fragility anywhere in the editor.

**Verify:**
- grep: ZERO `new SVG.Point`/`SVG.Point.transform` hand-rolls left in b-spline-gen/html (only the
  editor-coords doc + EX1 breadcrumb comments mention it). `_xform` fully removed.
- `node --check` both files OK.
- Behavioral: re-ran the carve browser check — `bakeSvgForCarving` (which drives the migrated
  `_bakeMatrixIntoPath` + line/poly baking) still produces correct coords (plain `M-240 -240`, scaled
  `M-201.6 -297.6` — SC3 Y-sign, values exact). Mathematically equivalent migration.
- `python bspline-frame-builder/sync_stamp_bundle.py` regenerated the stamp copy (ignored).
- **npm test 29/29 green.**
- git status: ONLY the 2 b-spline-gen editor files changed — the stamp-editor copies are
  ignored/regenerated (the de-fork win: no hand-mirror). Did NOT touch carveMatrix or edit
  stamp-editor directly, as directed.

---

## Turn 57 — C3a: narrow bare excepts in exporter.py — DONE (narrowing) + GATE (logs)

Behavior-preserving error-handling cleanup on `bspline-frame-builder/fusion-exporter/exporter.py`
(single file, not forked). Read all 706 lines + classified every except before touching anything.

**DONE — narrowed all bare excepts (behavior-preserving):**
- `except:` → `except Exception:` × **36** (BEFORE 36 bare → AFTER 0; `except Exception:` 14→50).
- Diff is EXACTLY 36 removals + 36 additions, **0 other changed lines** (no control-flow / return /
  try-body / except-body touched). py_compile OK.
- Safe: every one wraps Fusion API calls that raise regular Exceptions (RuntimeError etc.), not
  BaseException — no reliance on catching KeyboardInterrupt/SystemExit in a synchronous Fusion export.
  Even the outer wrapper (:211) only ever saw regular Exceptions in practice.

**GATE — did NOT add logs (the "add a log via the file's existing logger" half). Broken premise:**
1. **No logger exists.** exporter.py has only `ui.messageBox` (blocking USER modals — inappropriate
   for per-except logging, would spam dialogs) and a metadata-traceback pattern
   (`context[...]["Metadata"][key] = traceback.format_exc()`, :503). There is no `_log`/logging/print.
2. **~33 of 36 are defensive optional-Fusion-attribute PROBES** — the file's deliberate "aggressive
   safety" idiom (its own comments: "Aggressive safety for the .entity property", "Brute Force
   Edition") for the flaky Fusion API: `try: meta["Token"]=ent.entityToken except: pass`. These are
   expected-optional, NOT business-logic error paths; logging each = noise. Per "leave cleanup/probe
   excepts (just narrow)", they're correctly narrow-only.
3. **The genuine error paths ALREADY surface errors:** main wrapper :211 → messageBox+traceback;
   model loop :501 → metadata-traceback; several set fallback values (:70 design=None, :110
   output_dir=default, :246 ent_type="Ghost/Internal") — not silent.
4. **Only ~2-3 are business-logic loop-body catch-alls** that silently SKIP a whole item on failure:
   `:656` (per-setup), `:705` (per-NC-program), maybe `:440` (products deep-scan). These are the ONLY
   sites where a log would add value — and `context` is in scope at :656/:705, so the file's OWN
   metadata-traceback pattern (:503 precedent) could record the skip WITHOUT introducing a new logger.

**Recommendation / options for the advisor:**
- **(A, done + recommended):** narrow-only. Behavior-preserving, matches the file's defensive-probe
  idiom, no log noise. This is what I committed.
- **(B):** additionally, for the 2-3 loop catch-alls (:656/:705/:440), replace `pass` with the
  file's metadata-traceback pattern so a skipped setup/NC-program is recorded (no new logger). I'll
  do this in a follow-up if blessed — flagging rather than guessing which sites + mechanism.
- **(C):** introduce a real logger (module-level `_log` to a file / Python logging) and log the
  business-logic sites — but that's beyond "behavior-preserving / existing logger", so gated.
No new logger added, no messageBox spam. Committed the narrowing + this log.

---

## Turn 59 — C3b: narrow bare excepts across 4 Fusion files — DONE (narrow-all, no new logs needed)

Same behavior-preserving rule as C3a, on 4 single-copy (not forked) Fusion files. Read all 4 in full
+ classified every except before touching anything.

**DONE — narrowed all bare excepts (behavior-preserving):**
| file | bare except before -> after |
|---|---|
| frame-inspector/fusion-inspector.py        | 18 -> 0 |
| frame-builder/ui/sketch_builder_ui.py      | 16 -> 0 |
| frame-builder/ui/solid_builder_ui.py       | 12 -> 0 |
| fusion-exporter/fusion-exporter.py         | 13 -> 0 |
- Each diff is EXACTLY N `except:` removals + N `except Exception:` additions, **0 other changed
  lines** (no control-flow/return/try-body/except-body). py_compile OK on all 4.
- Safe: all wrap Fusion API calls (regular Exceptions); no BaseException reliance in synchronous
  Fusion handlers.

**No new logs added — and that's correct here (KEY difference from C3a):**
Unlike exporter.py (C3a, NO logger), THESE files HAVE loggers already wired on the business-logic
paths:
- `fusion-inspector.py`: `_log`; the selection handler (:474), run() (:665), HTML copy (:578),
  sendInfoToHTML (:562) ALREADY `_log(...)` on failure.
- `sketch_/solid_builder_ui.py`: `diag_logger.log_error`; every event handler + dispatch + build
  (`CommandCreatedHandler`, HTML event, `_schedule_hidden_build`, `_run_*_build_direct`,
  `run_palette`, doc-activated) ALREADY log.
- `fusion-exporter.py`: `ui.messageBox` on the outer run/created/execute wrappers (like C3a).
So "log business-logic paths" is ALREADY satisfied by the existing code. The bare-except sites I
narrowed are all: the logger's own write (`_log` :47), defensive attribute-PROBES (`get_fb_*` etc.),
graceful FALLBACKS (`return "Entity"/None/''/{}`), cosmetic status/palette messages, undo-transaction
teardown, and command-registration cleanup — i.e. exactly the "cleanup/probe" class the rule says to
"just narrow". Adding logs to those would be noise and would break each file's established idiom
(outer handlers log, inner helpers stay quiet).

**Borderline sites FLAGGED (narrow-only, not gated — could log if you want):** the inner
`_create_hidden_command` in solid_builder_ui.py (:45) and sketch_builder_ui.py (:47) swallow a
command-registration failure with `pass` BEFORE the `_ensure_hidden_commands` wrapper (which does
log) can see it — so a failed hidden-command add is currently invisible. `diag_logger` is in scope,
so a one-line `log_error` there would surface it. Left narrow-only to match the file idiom
(inner-helper = quiet); flagging so you can bless adding those 2 logs if desired. Everything else is
unambiguously defensive/cleanup.

**Verify:** 59 bare-except -> 0 across the 4 files; py_compile OK each; diffs are narrowing-only
(0 other changed lines). Single-copy files — no sync/mirror.

---

## Turn 61 — C3c: finish §4 — narrow ALL remaining bare excepts (repo-wide) — DONE

Grep-found every remaining bare `except:` in TRACKED .py (git ls-files, so gitignored stamp-editor is
excluded) minus the C3a/C3b files. 10 files, 61 bare excepts, none huge (max = b-spline-gen.py at 16).

**DONE — narrowed all (behavior-preserving), per file:**
| file | before -> after |
|---|---|
| b-spline-gen/b-spline-gen.py (central, extra care) | 16 -> 0 |
| frame-inspector/expression_coords.py | 12 -> 0 |
| frame-inspector/entity_helpers.py | 9 -> 0 |
| CAM-builder/cam-builder.py | 8 -> 0 |
| frame-builder/fb_utils/fb_logger.py | 5 -> 0 |
| frame-builder/fb_engine/offsets.py | 4 -> 0 |
| frame-inspector/selection_items.py | 3 -> 0 |
| frame-builder/fb_engine/geometry.py | 2 -> 0 |
| frame-builder/fb_engine/frame_engine.py | 1 -> 0 |
| DEPLOY_bspline-frame-builder.py | 1 -> 0 |
- Every diff is EXACTLY N `except:` -> N `except Exception:`, **0 other changed lines**. py_compile OK
  on all 10. **REPO-WIDE tracked-.py bare-except count is now 0** (across C3a+C3b+C3c).

**No new logs — narrow-only is correct (same finding as C3b):** classified every site.
- b-spline-gen.py (read all 16 with care): all defensive — per-occurrence visibility toggles
  (`occ.isLightBulbOn` :1097/1101/1106/1224/1227/1253), per-item renames (:978/1065), sibling/body
  enum (:1083/1154), cleanup deleteMe (:178/194), cosmetic progress (:162), the log-rotation's own
  fail-silent (:109), a logger-guard (:1260). The import/consolidate BUSINESS LOGIC already logs at
  the OUTER `except Exception as e: _log(...)` levels (`[CONSOLIDATE]`/`[VISIBILITY]` :1183/1228/1261).
- The other 9 (body-scanned): all `pass` / fallback `return X` / `continue` on defensive
  attribute-readers (expression_coords, entity_helpers — mirror fusion-inspector), the logger's own
  writes (fb_logger), math/engine guards (offsets, geometry — offsets already `ctx.logger.log_error`
  on the crash path), retry flow (DEPLOY), fallbacks (selection_items, frame_engine `logger=None`).
  cam-builder's business-logic handlers already `_log_error(...)`. So "log business-logic" is already
  satisfied by existing code everywhere.

**Process catch (fixed):** my bulk-narrow script (`open(...,newline="")`) FLIPPED CRLF->LF on the 2
files git stores as CRLF (b-spline-gen.py, frame_engine.py) — the other 8 are LF so stayed clean.
Caught it via a diff-line audit (b-spline-gen.py showed 3161 "other changed lines" = whole-file EOL
flip burying the 16 real narrowings). Detected each file's git EOL (`git show HEAD:f | file -`),
restored CRLF on the 2, re-verified all 10 diffs are narrowing-only. Lesson: match the file's
existing EOL when bulk-rewriting (read+write in binary, or detect+preserve) — Python text-mode write
normalizes newlines. No content lost; the narrowings are intact.

**Verify:** 61 -> 0 across 10 files; py_compile OK each; all diffs narrowing-only (0 other lines);
repo-wide tracked bare-except = 0. Not forked. C3a exporter.py log-gate still open for your synthesis.

---

## Turn 63 — C4-design/F8: module de-dup design doc — DONE (MAP+PROPOSE, no code)

Produced `MODULE-DEDUP-DESIGN.md` (my C4 deliverable). No code, no Fusion — implementation waits
for human Fusion Stop→Start (the collision + hot-reload behaviour only manifests in Fusion).

**Confirmed dup surface:** `expression_coords.py` + `entity_helpers.py` each ship as DRIFTED copies
under the same bare name in `frame-inspector/` AND `template-maker/core/` (426 + 291 diff lines).
(`payload_builder` vs `template_payload_builder` are differently named → no collision.)

**Key finding — the drift is STRUCTURAL, not cosmetic** (so "pick one canonical" won't work):
- `expression_coords`: template-maker's evolved a `params`-threaded API (+ spline-fit, scalar-expr,
  `get_entity_coord_expr(ent, params=None)` — backward-compat); frame-inspector's has
  `get_entity_name`/`format_design_params`/`_get_design*` template-maker lacks.
- `entity_helpers`: frame-inspector's has the RELIABLE evaluator arc-midpoint (+ legacy fallback +
  bridge/plan/fingerprint); template-maker's is a 6-fn subset. **Semantic conflict flagged:**
  arc-midpoint (evaluator vs angle-bisector) + the 3-4 truly-shared fn bodies (get_fb_name /
  get_entity_coord / get_fb_metadata / get_design_params) need a function-by-function review — the
  implementation must GATE there, not guess.

**Proposal (in the doc):** ONE `fb_shared/` package (canonical merged copies), both palettes import
package-QUALIFIED (`from fb_shared.entity_helpers import ...`) → the `sys.modules` key becomes
`fb_shared.entity_helpers`, killing the bare-name collision. `entity_helpers` canonical ⟵
frame-inspector base (evaluator); `expression_coords` canonical ⟵ template-maker base (params) +
frame-inspector extras. template-maker's committed `tests/` are the ready-made regression bar.

**`_force_wipe` delta it retires:** the 2 names leave `_shared_project_names`; a single
`_force_wipe(['fb_shared'])` (cascades) replaces the 3×-per-bootstrap wipe of 20 names
(bspline-frame-builder.py:243-266). `_addin_root` goes on sys.path once for `import fb_shared.*`.

**Sliced Fusion-gated build plan (S1–S5):** create fb_shared + merge entity_helpers (gate the
merge) → merge expression_coords (template-maker tests = acceptance) → switch+delete
frame-inspector copies (human Stop→Start) → switch+delete template-maker copies (human Stop→Start,
co-load ordering = the original collision) → cleanup the dead wipes. Each slice ends in a human
Fusion smoke test; the risky function-merge is gated behind a reviewed diff.

Design only — committed MODULE-DEDUP-DESIGN.md + this log. No app code touched.

---

## Turn 65 — C4-S1: create fb_shared/entity_helpers (canonical merge) — DONE (additive) + GATE

ADDITIVE, no Fusion. Created `bspline-frame-builder/fb_shared/` (`__init__.py` + `entity_helpers.py`)
= the canonical merged entity_helpers. Switched NO callers, deleted NO copies, did NOT touch
`_force_wipe` / `expression_coords`. git status confirms only the 2 new files. py_compile OK both.
Old copies untouched → template-maker tests unaffected.

**Per-function reconciliation (base = frame-inspector; read both copies in full):**
| function | source chosen | reason |
|---|---|---|
| `_get_native` | either (IDENTICAL) | no drift |
| `format_point` | either (IDENTICAL) | no drift |
| `_get_entity_key` | frame-inspector (only copy) | keep |
| `_get_arc_midpoint_via_evaluator` | frame-inspector (only) | the reliable method |
| `_get_arc_midpoint_legacy` | frame-inspector (only) | fallback for the dispatcher |
| `get_fb_bridge`, `get_fb_plan`, `entity_fingerprint` | frame-inspector (only) | keep |
| `_get_arc_midpoint` | **frame-inspector** (evaluator → legacy fallback) | template-maker had angle-bisector ONLY (wrong for semicircles) — **[GATE]** |
| `get_fb_name` | **template-maker** (reads `FrameBuilder.ID` then `name`) | TM bug-fix: an ID-stamped curve came back anonymous under FI's name-only read, breaking the ownership gate — **[FLAG]** |
| `get_fb_metadata` | **frame-inspector** (`Bulge=`real-midpoint) | TM emitted `BulgeCenter=`center (the misleading center-of-curvature) — **[FLAG]** |
| `get_entity_coord` | **template-maker** (superset: +Circle/Ellipse/Spline) | strict superset; arc/line/bbox identical |

**GATE — arc-midpoint (advisor-named), needs your review before S3/S4 switch callers:**
Choosing FI's evaluator dispatcher CHANGES template-maker's arc-midpoint from angle-bisector →
evaluator. For semicircles this FIXES a wrong-half bug; for normal arcs both agree. RISK:
template-maker's committed tests (test_circle_ellipse_spline etc.) may assert bisector-computed
midpoint values → S2 must run them against the canonical and reconcile any delta. This is the
acceptance check the design named.

**2 more FLAGS (behaviour changes when callers switch — S3/S4, not now):**
- `get_fb_name`: FI's inspector display will show the `ID` attribute instead of `name` when a curve
  carries BOTH. Confirm that's desired for the inspector (I judged TM's ID-first is the correct
  canonical — it's a documented ownership-gate fix — but it's a display change for FI).
- `get_fb_metadata`: template-maker consumers (template_payload*, offset_hint via get_fb_metadata)
  will see `Bulge=(midpoint)` instead of `BulgeCenter=(center)` — label AND value change. If any TM
  code PARSES `BulgeCenter=`, S4 must update it. (I picked FI's real-midpoint per the design's
  "canonical = FI base + evaluator", but the label/value change is a TM-facing break to verify.)

**Nothing depends on fb_shared yet** (additive), so these decisions are safe to review + revise
before any caller switch. Reconciliation decisions are recorded inline in fb_shared/entity_helpers.py
(per-function provenance comments) for your diff review.

---

## Turn 67 — C4-S2: fb_shared/expression_coords + pytest acceptance gate — DONE (GREEN)

ADDITIVE, headless. S1 flags were advisor-blessed. Created the canonical expression_coords + ran
the template-maker pytest suite against fb_shared as the acceptance gate. NO production callers
switched, NO copies deleted, `_force_wipe` untouched.

**Created `fb_shared/expression_coords.py`** = template-maker base (params-threaded API + circle/
ellipse/spline + `_format_scalar_expr`/`_spline_fit_points`) with `from entity_helpers import
_get_arc_midpoint` → `from fb_shared.entity_helpers import _get_arc_midpoint`, PLUS the 4 FI extras
(`get_entity_name`, `format_design_params`, `_get_design`, `_get_design_parameter`). Kept TM's
`get_design_params` (base). Built via script (TM verbatim + import fix + FI fns extracted by name) to
avoid transcription error. 19 defs. py_compile OK.

**Test rewrite (Open-Q3 resolved) — centralized in conftest.py:** the tests AND the core modules they
import (template_generator, template_payload, etc.) resolve `expression_coords`/`entity_helpers` by
BARE name, so a per-test import swap wouldn't cover the transitive path. Instead conftest.py adds the
addin root to sys.path, stubs adsk (fb_shared imports adsk at module level), and aliases
`sys.modules['expression_coords'|'entity_helpers'] = fb_shared.*` (sys.modules wins over sys.path).
This runs the ENTIRE tree against the canonical without touching any production caller.

**ACCEPTANCE GATE = GREEN: 69 passed.** Rigorously verified the alias took effect:
`expression_coords.__file__` + `entity_helpers.__file__` both point to fb_shared/; ec's arc-midpoint
comes from `fb_shared.entity_helpers`; eh has the evaluator dispatcher + ID-first get_fb_name. So the
merged canonical (incl. all S1 reconciliations) is behaviour-equivalent to the copies it replaces.

**Arc-midpoint FLAG1 — how green validates it:** in the fake-adsk test env the fake arcs have no
`.geometry.evaluator`, so fb_shared's `_get_arc_midpoint` falls back to `_get_arc_midpoint_legacy`
(the SAME angle-bisector as TM's old `_get_arc_midpoint`) → arc tests pass. So the pytest gate proves
the canonical is BACKWARD-COMPATIBLE (fallback == TM). The evaluator IMPROVEMENT only activates on
real Fusion arcs (with evaluators) — that's the S4 human Stop→Start check, as the design said.

**FLAGGED — pre-existing broken test (NOT mine, NOT a de-dup regression):**
`template-maker/tests/test_origin_axis_target.py` has a SyntaxError at line 298 (a stray
`axis_target passed')` line) that is present in HEAD (`git show` confirms) — I never touched it. It
can't be collected, so it never ran (before or after this change). I excluded it with
`--ignore` for the run and did NOT edit it (out of S2 scope; not an assertion delta). It means the
origin/axis + relation_hints/ownership_gate coverage isn't exercised against fb_shared — a
pre-existing gap, not worsened by the de-dup. Trivial 1-line fix if you want it as a follow-up.

**No assertion delta anywhere** — nothing was force-passed. Committed fb_shared/expression_coords.py +
conftest.py + this log.

---

## Turn 69 — C4-S2b: revive ownership-gate test → FLAG2 closed + isolation bug classified — DONE

Deleted ONLY the stray line 298 (`axis_target passed')`) in
`template-maker/tests/test_origin_axis_target.py` — line 297 already had the real print. 1-line diff,
py_compile OK. No production edits, no copies, no `_force_wipe`.

**FLAG2 CLOSED (get_fb_name / ownership-gate path validated against the canonical, headlessly):**
`pytest tests/test_origin_axis_target.py` (the file, run against the S2 fb_shared alias) → **14
passed**. The ownership gate resolves entities through `get_fb_name` — the S1 reconciliation that
switched to template-maker's ID-first read — and it works correctly with the canonical. Re-confirmed
after restoring the clean conftest: still 14/14.

**⚠ STOP + REPORT (per the ⛔ rule) — the test has 9 failures in the FULL suite; classified STALE
PRE-EXISTING, NOT a de-dup regression:**
- `pytest tests/` (whole suite) → 9 failed / 74 passed. The test PASSES alone (14) but 9 fail when
  run after the rest → a test-ORDERING / global-state isolation bug (the ownership-gate tests depend
  on state that earlier tests leave behind).
- DECISIVE classification: made the conftest alias toggleable and ran the full suite with the OLD
  core copies (`FB_DEDUP_ALIAS=0`) → the EXACT SAME 9 tests fail (`diff` of the FAILED lists =
  identical). So fb_shared / the de-dup does NOT cause it — it's a pre-existing isolation bug in this
  test file, independent of the shared module. (The diagnostic toggle was reverted; conftest is back
  to the clean S2 version — empty diff.)
- Per "don't fix other pre-existing issues (flag only)": I did NOT touch the test's isolation bug.
  FLAG for a follow-up — the 9 origin-token/gate tests need per-test state reset (likely a stale
  module global or the shared adsk stub) to run under the full suite. It does NOT block S3.

**Net:** S2b goal achieved — the revived test proves get_fb_name/ownership-gate against the canonical
(14/14 isolated). The full-suite isolation failures are pre-existing and de-dup-independent (proven
by the identical old-copy failure set). Committed the 1-line syntax fix + this log; conftest unchanged.

---

## Turn 71 — C4-S3: switch frame-inspector to fb_shared — DONE (headless; FUSION-GATED, human verifies)

Switched frame-inspector ONLY to the canonical fb_shared. I CANNOT verify in Fusion — the human does
a Stop→Start after this pass. Headless pre-checks all pass.

**(A) FI imports rewritten bare → fb_shared.* (4 sites):**
- fusion-inspector.py:22  `from fb_shared.expression_coords import get_design_params`
- payload_builder.py:8    `from fb_shared.entity_helpers import get_fb_name, get_entity_coord, get_fb_metadata`
- selection_items.py:9    `from fb_shared.expression_coords import get_entity_coord_expr`
- selection_items.py:10   `from fb_shared.entity_helpers import get_fb_name as get_entity_name`

**(B) Deleted the FI copies:** `git rm frame-inspector/expression_coords.py + entity_helpers.py`
(frame-inspector now has ZERO of the two modules — it consumes fb_shared).

**(C) bspline-frame-builder.py hot-reload wiring:**
- `_bootstrap()`: added `if _addin_root not in sys.path: sys.path.insert(0, _addin_root)` (after the
  fb_utils insert) so the subs' `import fb_shared.*` resolves.
- L192 `_force_wipe([...])`: added `'fb_shared'` as the first entry (cascades to
  fb_shared.entity_helpers / .expression_coords) so hot-reload re-reads the canonical each Start.

**(D) Left untouched (S4/S5):** `_shared_project_names` STILL lists 'expression_coords' +
'entity_helpers' (L252) — correct: template-maker still imports them bare until S4, so that wipe must
stay; S5 removes them. template-maker not touched.

**Headless pre-check — ALL PASS:**
- py_compile: fusion-inspector, payload_builder, selection_items, bspline-frame-builder, fb_shared/* — OK.
- 0 bare imports left in frame-inspector/ (grep: none).
- stubbed-adsk import-resolve (root on sys.path): fb_shared.expression_coords + entity_helpers resolve;
  payload_builder + selection_items import cleanly with get_fb_name/get_entity_coord_expr coming from
  fb_shared.*; fusion-inspector.py FULLY loads (richer adsk stub for its handler base classes) with
  get_design_params from fb_shared.expression_coords.

**STOP — Fusion verification is the human's:** after this pass, the human Stop→Starts the add-in and
smoke-tests the Inspector (palette loads, selection → payload renders, expressions/arc coords correct;
co-load with template-maker still fine since S5's wipe still covers TM's bare imports). Committed the
A+B+C change; template-maker/_shared_project_names untouched.

---

## Turn 73 — C4-S4: switch template-maker to fb_shared (last consumer) — DONE (headless; FUSION-GATED)

Switched template-maker — the LAST consumer — to the canonical fb_shared. Both palettes now consume
fb_shared; no drifted copies remain. Human verifies via Stop→Start.

**(A) 8 bare imports → fb_shared.* across 6 files** (byte-level replace, so CRLF + indentation
preserved — all 6 are CRLF; diffs are import-only, 0 other changed lines):
- dimension_hint.py:58 (INDENTED, inside a fn) · offset_hint.py:47 · relation_hints.py:31 ·
  template_generator.py:2 · template_payload.py:1+2 · template_payload_builder.py:12+13.

**(B) Deleted TM copies:** `git rm template-maker/core/{expression_coords,entity_helpers}.py`. No
drifted copy of either module exists anywhere now.

**NO parent change** (S3 already added _addin_root to sys.path + 'fb_shared' to _force_wipe).
**Untouched:** `_shared_project_names` still lists both names (S5 removes them); the test conftest
(its S2 alias covers the tests); frame-inspector (S3).

**Headless — ALL PASS:**
- py_compile all 6 OK; 0 bare `from expression_coords|entity_helpers import` left in TM core (the
  8 are now fb_shared.*).
- Re-ran the S2 pytest suite with the copies DELETED → **69 passed** (--ignore the pre-broken
  test_origin_axis_target.py, per S2 baseline). Proves the tests stay green via the conftest alias
  (bare test imports → fb_shared) + fb_shared.* (production).
- Confirmed resolution AFTER deletion: `expression_coords`/`entity_helpers` → fb_shared/*.py (alias);
  `template_generator.get_entity_coord_expr` from fb_shared.expression_coords (direct qualified).
- (The 9 origin-test full-suite failures remain — the pre-existing isolation bug classified in S2b,
  unrelated to S4.)

**STOP — human Fusion Stop→Start:** template-maker generates a template (expressions / arc coords via
the canonical evaluator arc-midpoint), AND frame-inspector still fine on co-load (the collision this
whole de-dup targeted). On green, only S5 remains (retire the 2 names from _shared_project_names +
the conftest alias). Committed A+B; parent/_shared_project_names/tests untouched.

---

## Turn 75 — C4-S4b: remove dead expression_coords self-reload orphans (S4 regression fix) — DONE

Corrective for an S4 regression the human caught in Fusion (Template Maker button gone). NOTE: the
CODE fix was committed as ee4725c in the prior session, which was torn down (process killed mid-loop)
BEFORE I appended this WORK-LOG + passed back. This entry + the pass-back complete that cut-off turn;
re-verified everything against the current tree on resume.

**Root cause (the bug class S4 missed):** S4 switched template-maker's STATIC `from expression_coords
import` sites to fb_shared.*, but `_reload_all_project_modules()` (the Stop→Start hot-reload) also had
a DYNAMIC `importlib.import_module('expression_coords')` + an `expression_coords` entry in the
`_PROJECT_MODULES` wipe list + a module global — none of which a `from X import` grep catches. With the
bare copy deleted (S4b→ actually S4), that import_module threw ModuleNotFoundError → run() aborted →
the toolbar button never registered.

**Fix (ee4725c):** the `expression_coords` global is WRITE-ONLY (assigned only by the crashing import,
never read — confirmed by fresh grep), so removed the 5 dead orphans rather than re-point:
line 62 (`expression_coords = None`), 84+86 (the two `_PROJECT_MODULES` entries), 204 (the `global`
decl), 228 (the `import_module`). template-maker consumes fb_shared only transitively via the core
modules' static imports; the parent (S3) owns fb_shared's sys.path + wipe — so template-maker must NOT
self-reload it. The other 6 dynamic re-imports (template_generator/template_payload/template_code/
rename_selection/deferred_rebuild/detect_projections) are intact.

**Verify (re-run on resume):**
- py_compile template-maker.py OK.
- STRONGER add-in-wide sweep (the S4-missed class): `grep import_module|__import__ ('expression_coords'
  |'entity_helpers')` across all of bspline-frame-builder/ (excl tests) → ZERO. `_PROJECT_MODULES` has
  0 moved-module entries.
- pytest tests/ (--ignore the pre-broken origin test) → 69 passed.
- Did NOT touch _shared_project_names (S5), frame-inspector, fb_shared, or the other 6 re-imports.

**Lesson logged:** dynamic imports (`importlib.import_module`, `__import__`) + module wipe-lists are a
grep blind spot for a `from X import` sweep — any future module move must also sweep those.

**STOP — human Fusion Stop→Start** (re-deploy first): the Template Maker button should return; both
palettes co-load. On green → S5 (retire the 2 names from _shared_project_names + the test conftest
alias) is the only remaining slice.

---

## Turn 77 — C4-S5: retire the 2 dead names from _shared_project_names — DONE (C4 final slice)

Behavior-neutral cleanup, the last C4/F8 slice. Both palettes now import the canonical fb_shared
package (qualified), so the parent's `_force_wipe(_shared_project_names)` of the BARE names
'expression_coords'/'entity_helpers' had become a dead no-op (nothing imports those bare names).

**Change (ONLY bspline-frame-builder.py):** removed `'expression_coords'` + `'entity_helpers'` from
the `_shared_project_names` list (L252). DATA entries 18 → 16; a hyphenated why-comment added in
their place. Nothing else touched.

**Kept (as instructed — NOT dead):**
- The `_force_wipe(_shared_project_names)` calls (16 live names remain: entity_util, payload_builder,
  phase_parser, role_points, cc_proxy, fb_attributes, ownership_gate, relation_hints,
  coincidence_clusters, template_generator, template_code, template_payload, detect_projections,
  rename_selection, deferred_rebuild, exporter).
- The `'fb_shared'` entry in the earlier (L192) `_force_wipe` (hot-reloads the canonical) — untouched.
- The test conftest alias (load-bearing test infra) — untouched.
- fb_shared/ — untouched.

**Verify:**
- py_compile OK.
- Parsed the list DATA (excl. the comment): expression_coords/entity_helpers NOT present; size 16;
  first entries entity_util/payload_builder/phase_parser; `'fb_shared'` still in a _force_wipe.
- Add-in-wide grep (excl tests) for bare `from/import expression_coords|entity_helpers` + import_module
  → ZERO (already true after S3/S4; this slice removes the last DEAD wipe-list mention).
- pytest 69 passed.

**STOP — light human Fusion Stop→Start:** both palettes load (NO functional change — the removed wipe
never did anything post-S4). On green → **C4/F8 module de-dup COMPLETE** (fb_shared is the single
source of truth; frame-inspector + template-maker both consume it; no drifted copies; the 3×-per-
bootstrap bare-name wipe of these 2 is retired).

---

## Turn 79 — E1: DEPLOY fail-loud on skipped files + widen VERIFY_FILES — DONE

The stale-deploy bug: `copy_overlay` tolerated locked files (Fusion holding them open) by COUNTING
skips, and both callers merely soft-TIPPED ("skipped N… likely locked by a running Fusion addin")
while still returning SUCCESS. So a deploy that silently dropped a changed file reported "successful" —
and if that file wasn't in VERIFY_FILES, nothing caught it. That's exactly how a source edit could
look deployed but run STALE in Fusion.

**Declare-gate:** the skipped set is DATA the deploy must report on. Rather than re-print/re-derive it
inline, `copy_overlay` now RETURNS the skipped paths (a list) and each CALLER owns the policy (fatal).
Cheap data hand-off; the fail-vs-tip decision lives in one place per caller.

**Changes (ONLY DEPLOY_bspline-frame-builder.py):**
1. `copy_overlay`: return type `tuple[int, int]` → `tuple[int, list]`. Accumulates dst-relative POSIX
   paths into `skipped_paths` — BOTH the per-file `copy2` failure branch AND the mkdir-fail branch
   (which now `.extend`s `(rel_root/f).as_posix()` for each file it couldn't land, replacing the old
   `skipped += len(files)`). Returns `(copied, skipped_paths)`.
2. `deploy_local` (the LIVE path: `deploy_all` → `deploy_local`): on a non-empty `skipped_paths`, print
   an ERROR listing EVERY skipped path + `sys.exit(1)` (mirrors the sibling copy_overlay-exception
   handler already at that spot). Was: soft-tip + fall through to a "successful" verify.
3. `_deploy_addin` (legacy per-add-in path — shares `copy_overlay`, so it HAD to move with the new
   signature): same treatment → `return False` (its bool contract; `__main__` maps False → exit 1).
4. `VERIFY_FILES` widened +6: `frame-builder/fb_engine/parametric_engine.py`,
   `fb_shared/{__init__,entity_helpers,expression_coords}.py`, `frame-inspector/fusion-inspector.py`,
   `template-maker/template-maker.py` — so a stale copy of the C4-consolidated shared modules or of
   either bundled sub-add-in entry point is now hash-caught in the verify loop.

**Verify (headless — NO live deploy vs a running add-in, per dispatch; scratchpad/verify_e1.py):**
- py_compile OK.
- (a) all 6 new VERIFY_FILES exist under SRC_DIR AND are in the list.
- (b) `copy_overlay` real read-only-file skip in a temp tree → `copied=1, skipped=['sub/locked.txt']`
  (proves it returns the PATH now, not just a count).
- (c1) `deploy_local` with `scrub_source`/`clean_dir`/`sync_stamp_bundle`/`copy_overlay` all
  monkeypatched to no-ops (ZERO real-install mutation) + `copy_overlay` returning a 1-item skip →
  raised `SystemExit(1)`. The live-path fail-loud proven without touching the real deploy.
- (c2) `_deploy_addin` (temp src/dest) → False on skip, True when clean. No stray test-addin dir left.

**NOT done (out of E1 scope — flagged for advisor / E3):** the legacy `deploy_template_maker` +
`deploy_fusion_inspector` verify-lists STILL name `entity_helpers.py` / `expression_coords.py` — the
copies DELETED in C4-S3/S4. Those functions aren't reached by `deploy_all` (which → `deploy_local`),
so they're dead-ish and only WARN if ever run standalone; the dispatch said "NOT E3's consolidation,"
so I left them untouched. Worth sweeping when E3 consolidates the deploy paths.

---

## Turn 81 — E2: version-stamp DESIGN pass (map + propose, no code) — DONE

Produced `VERSION-STAMP-DESIGN.md` for advisor review. Design-only — ZERO app / deploy / palette-HTML
code touched. Mapped via 4 parallel Explore agents (one per add-in group), then spot-verified the
load-bearing anchors myself (deploy handshake writer, palette registrations).

**What the map found (ground truth — anchors in the doc):**
- The count is **8 palettes across 7 add-ins**, NOT the dispatched "7". Corrections: **fusion-exporter
  has NO palette** (never calls `palettes.add`, ships no HTML — nothing to stamp); **CAM-builder has
  TWO** (B-spline CAM + CAM Studio, distinct IDs AND distinct channels, `cam-builder.py:392`/`:458`).
  b-spline-gen loads `bspline_gen_palette.html` (its `index.html` is a 7-line meta-refresh stub).
- **The Python→HTML SEND channel is UNIFORM across all 8**: `palette.sendInfoToHTML(action, jsonStr)`.
  The JS RECEIVE side has 3 dialects (if/elif ladder ×6; `CustomEvent('fusionHandshake')` for
  b-spline-gen; `routes[action]` ES-module map for stamp-editor) — all key off `action`, so a new
  `'build_info'` action is a 1-case add per receiver. That's WHY the Python inject is uniform but a
  single drop-in JS "component" is not.
- Open-time: only template-maker pushes at open (`:616`); the other 7 are pull-first (JS requests on
  `DOMContentLoaded`, Python answers) → least-friction inject = piggy-back `build_info` on the existing
  first-handshake reply, not a brand-new push.
- **No palette reads a local JSON at load, and there is NO CSP anywhere in the tree.** The blocker is
  NOT CSP — it's `file://` local fetch being unreliable in Fusion's embedded Chromium (CEF). So the
  decision is **Python-read-+-inject** over the proven channel, NOT a browser fetch.

**Declare-aligned proposal (core of the doc):**
- ONE declared artifact: `build-info.json` `{sha, branch, built_at, source_root}`, written by the
  deploy as a **DEST-only artifact** (mirrors the existing `_write_*_handshake` writers,
  `DEPLOY…py:446+`; zero source churn). ONE file at the add-in root, N readers — not per-palette.
- ONE shared read path: `fb_shared/build_info.py::read_build_info(addin_root)` — lives in the
  C4-consolidated shared package every sub-module already imports. No palette hand-rolls git/file-reads.
- Least-wiring badge: 3 tiny touches/palette (a header `<span>`, one `sendInfoToHTML('build_info')`
  line [identical for all 8], one JS case). b-spline-gen is nearly free — it already has a hardcoded
  `.cad-nav-version` span (`bspline_gen_palette.html:260`) to repurpose.
- ✓/⚠-vs-repo: **feasible** Python-side WITHOUT a git binary — compare `build-info.sha` vs
  `<source_root>/.git/HEAD`→ref→SHA (pure file reads); reuses the source-path pointer the handshake
  files already record. Caveats stated: compares deployed-vs-committed-HEAD (not uncommitted edits),
  and it's dev-machine-only (degrades to the plain badge if source `.git` absent).

**GATED for advisor — 3 forks (options laid out, my rec given, NOT implemented):**
- **F1** build-info.json location: DEST-only artifact (rec) vs SRC-copied+verified (dirties tree).
- **F2** ✓/⚠ scope: A plain badge / **B +live vs committed HEAD (rec)** / C +working-tree-dirty detect.
- **F3** rollout: substrate → key palettes → follow-up wave (rec) vs all-8-at-once.

**Declare-gate note:** this feature is a textbook *missing declaration* — the fix is to DECLARE
`build-info.json` (inert data) + one read path, NOT hand-roll version-reading in 8 palettes. The whole
doc is built on that. Passing to advisor for the fork decisions before any build slice — no code this
turn (design gate).

---

## Turn 83 — E2a: version-stamp SUBSTRATE (deploy writer + fb_shared read/compare) — DONE

Advisor synthesized the E2 forks: **F1=A** (DEST-only artifact) and folded **`dirty`** into the
declared JSON (declare it now; the badge consumes it in E2b). Built the substrate only — NO palette
HTML/JS this slice (that's E2b).

**(1) `DEPLOY_bspline-frame-builder.py` — new `_write_build_info()`** (mirrors the `_write_*_handshake`
writers; called right after them in `deploy_local`). Writes `DEST_DIR/build-info.json`
= `{sha, branch, built_at, source_root, dirty}`:
- sha/branch via `git -C SRC_DIR rev-parse --short HEAD` / `--abbrev-ref HEAD`.
- built_at = `datetime.now().astimezone().isoformat(timespec='seconds')` (local ISO + offset).
- source_root = git TOPLEVEL (SRC_DIR's parent = repo root where `.git` lives), stored portable
  `~/...` like the handshakes so `compare_to_source` can locate `<source_root>/.git`.
- Any git failure (absent / not-a-repo / timeout) → sha='unknown' and the file is STILL written — a
  version stamp must never crash the deploy. Added `import subprocess`.

**(2) `fb_shared/build_info.py` — NEW** (pure stdlib, no adsk / no git binary → imports + unit-tests
headlessly; neither function raises):
- `read_build_info(addin_root)` → the dict; absent/malformed/non-dict → `SENTINEL` (sha 'unknown');
  missing keys backfilled from SENTINEL so callers always get the full shape.
- `compare_to_source(info)` → `(ok|stale|unknown, msg)` via PURE FILE READS of `source_root/.git`:
  `_resolve_git_dir` (expands `~`, follows a `gitdir:` pointer for worktrees) → `_read_head_sha`
  (symbolic HEAD: loose ref then packed-refs; or detached SHA). ok = short-SHA prefix-matches HEAD &
  clean; stale = mismatch OR dirty; unknown = no sha / no source_root / no `.git` / HEAD unresolvable.

**DESIGN CALL flagged for advisor:** `dirty` uses `git status --porcelain --untracked-files=no` =
uncommitted **tracked** modifications only. Untracked files are IGNORED so this repo's ever-present
untracked coordination docs (NEXT-SESSION.md / ROADMAP.md / scratchpad) don't flag every deploy dirty.
Trade-off: a brand-new *untracked source* file that gets deployed wouldn't count as dirty. Reasonable
default; trivial to flip to strict (drop the flag) in E2b if you prefer.

**Verify (headless — `scratchpad/verify_e2a.py`; no live deploy, real install untouched):**
- py_compile both OK.
- Writer in a tempdir (`DEST_DIR` monkeypatched, `SRC_DIR` = real repo) →
  `{sha:'d2f0e76', branch:'main', built_at:'…-04:00', source_root:'~/APPS/…', dirty:True}` — all 5
  keys, real SHA, and `dirty:True` is CORRECT (DEPLOY…py is modified-uncommitted right now = the dirty
  path exercised live).
- Reader sentinel on absent + malformed → sha 'unknown'.
- `compare_to_source` vs THIS repo — all three statuses: **ok** ("up to date (main d2f0e76)"),
  **stale** (SHA mismatch + dirty-tree), **unknown** (no-sha + unreachable-source).

No palette wiring (E2b). Passing to advisor.

---

## Turn 85 — E2b: wire version badge into b-spline-gen ONLY (end-to-end) — DONE (headless); human Fusion pending

The key-palette-first slice (design §2d): prove the whole path on ONE palette. 3 touches per §2c,
b-spline-gen only; **deploy + fb_shared untouched**.

**(1) HTML `bspline_gen_palette.html`:** the existing `.cad-nav-version` span (:268) got
`id="build-badge"` + an empty `title=""` slot; KEPT its `v1.1.0` fallback literal. Added 3 status-color
classes `.build-ok` / `.build-stale` / `.build-unknown` (:206-208). Updated the now-stale comment (it
claimed "no build step injects this" — in Fusion, Python now does).

**(2) Python `b-spline-gen.py`:** new module helper `_send_build_info(pal)` (:43) — resolves
`addin_root = dirname(dirname(abspath(__file__)))` (build-info.json lives at the add-in ROOT),
`from fb_shared import build_info`, `read_build_info` + `compare_to_source`, then
`sendInfoToHTML('build_info', {sha,built_at,dirty,status,message})`. Fully try/except-wrapped — a
missing file / import hiccup never disturbs the board sync it rides on. Called (:722) right after the
existing `sync_board` reply in the `get_design_params` handler (the dialect-b first handshake).

**(3) JS `main.js`:** new `build_info` case in `handleFusionHandshake` (:165) — paints `#build-badge`:
`✓ <sha> · YYYY-MM-DD` (ok) / `⚠ …` (stale), ` +edits` if dirty, a `build-<status>` class, and the full
compare message in `title`. Unknown / no-sha keeps the fallback literal, just muted + explained via
`title`.

End-to-end chain: JS `get_design_params` → Py `sync_board`+`_send_build_info` →
`sendInfoToHTML('build_info')` → `fusionJavaScriptHandler.handle` → `CustomEvent('fusionHandshake')` →
`handleFusionHandshake` build_info case → `#build-badge`.

**Verify (headless — all green):** `py_compile` b-spline-gen.py; `node --check` main.js (Node v24);
grep confirmed the def+call (43/722), the JS case+badge lookup+status class (165/171/184), and the HTML
id+classes (268/206-208).

**Real-symptom GATE → human Fusion** (the badge is a CEF-webview DOM update; `adsk` + the palette can't
be driven headlessly, so this is the tool boundary, NOT a skipped check): redeploy (writes
build-info.json into DEST) → in Fusion, Stop→Start the add-in → open the **B-Spline Generator** palette
in a design → header shows `✓ <sha> · <date>` (green) when deployed == source HEAD, `⚠ …` (amber) when
stale/dirty; tooltip = the compare message. If build-info.json is absent (pre-redeploy), the badge
stays the muted `v1.1.0` fallback.

No other palette; deploy/fb_shared untouched.

---

## Turn 87 — E2c: version badge into the 6 dialect-a palettes — DONE (headless); human Fusion pending

Repeated E2b's failure-safe 3-touch pattern on **sketch, solid, inspector, template-maker, cam-main,
cam-studio** (18 touches = 6 × [HTML span + CSS, Python push, JS branch]). No stamp-editor (E2d), no
b-spline-gen / deploy / fb_shared.

**Per-palette placement** (the varying part; the Python + fb_shared read is identical everywhere):
- **sketch** — push in `_send_template_list` (fires on the request_template_list reply at open); JS
  branch in `_dispatchFromPython` (parsed `data`); badge in the header right-group.
- **solid** — push after ping/pong (`_send_palette_message(...,'response','PONG')`); JS in
  `_dispatchFromPython`; badge in the right-group.
- **inspector** — push after `palette.isVisible = True` in CommandCreated (once at open); JS in
  `fusionJavaScriptHandler = function(action,data)` (raw-string data); badge after `.cad-nav-title`.
- **template-maker** — push after `_push_selection_to_palette()` at open (:616); JS in
  `function(action,data)`; badge in `#status-bar`.
- **cam-main** — push after `_do_list_cam_templates()` (boot pull); JS in `{handle:function}`
  (pre-parsed `payload`); badge in the right-group.
- **cam-studio** — push after `_do_studio_init()`; JS in `{handle:function}`; badge in the right-group.

**Design choices (flagged for advisor):**
1. **`addin_root` via walk-up-to-`fb_shared`, not the dispatch's "count the dirnames."** These 5 files
   sit at 2 vs 3 levels deep, so a single identical walk-up helper is the *same code* in all six and
   robust to depth/moves — cleaner than per-file depth counts. Same result. (b-spline-gen's E2b still
   uses `dirname(dirname())`; a later pass could unify, but E2c wasn't allowed to touch b-spline-gen.)
2. **CAM uses `_build_info_payload()` + the existing `_send_to_html`/`_send_to_studio_html` primitives**
   (returns the dict; the primitives json-dump + send), vs the other 5 palettes' `_send_build_info(pal)`.
   CAM has module-level send primitives (no palette var at the handler), so this is the idiomatic fit.
   Same wire result (`sendInfoToHTML('build_info', …)`).
3. Badge rides each palette's existing at-open handshake; for a couple (solid ping, sketch
   template_list) that's an idempotent re-push on heartbeat/refresh — harmless (re-paints the same
   badge). Fully try/except-wrapped, so a per-palette miss is cosmetic.

**Verify (headless — all green):**
- `py_compile` all 5 edited `.py`: OK.
- `node --check` the inline JS: 4 palettes' full script block OK; inspector + template-maker's full
  block fails ONLY on PRE-EXISTING duplicate function declarations (`reportError` 2×, `switchTab` 2×;
  browser sloppy-mode tolerates them; node aborts there, BEFORE my branch). My inserted `build_info`
  branch `node --check`s OK in isolation for ALL 6.
- 6-row 3-touch checklist: every palette has the Python `'build_info'` push + the JS
  `action === 'build_info'` branch + the `id="build-badge"` span. (cam-builder.py holds both CAM
  pushes → count 2.)
- EOL preserved per file (7 LF, 4 CRLF — none flipped); diff +307/−2, surgical.

**Real-symptom GATE → human Fusion:** redeploy → Stop→Start → each of the 6 palette headers shows
`✓/⚠ <sha> · <date>` (CEF DOM, not headlessly drivable). With b-spline-gen (E2b) that is **7 of 8**
palettes; only **stamp-editor** (E2d, dialect c) remains for full E2 coverage.

---

## Turn 89 — E2d: version badge into stamp-editor (dialect c) — DONE (headless); E2 wiring complete

The final E2 slice — the 8th palette. Dialect c = ES-module bridge with a `routes[action]` map. Same
failure-safe pattern; no other palette / deploy / fb_shared; `?v=` cache-bust (stamp-editor.py
`htmlFileURL` setter) left untouched.

**3 touches:**
- **Python `stamp-editor.py`:** new module-level `_send_build_info(pal)` (:737, same walk-up-to-`fb_shared`
  helper as E2c) + call it after the `pong` reply in the `ping` handler (:154) — the first-handshake
  reply. Fully try/except-wrapped.
- **HTML `html/index.html`:** `<span id="build-badge" class="cad-nav-version">` in the `.topbar`
  after `#statusLine` (:34); added a small `<style>` in `<head>` (no inline `<style>` existed) with the
  `.build-ok/.build-stale/.build-unknown` color classes.
- **JS `html/main/main.js`:** a `build_info: (data) => {…}` entry in the `routes` map (:57), right after
  `pong`. `data` is pre-parsed by `handle` (:145), and `handle` already wraps each `route(data)` call
  in try/catch — so the render matches the routes-map style (no inner try). Same visual: ✓/⚠, `sha ·
  date`, `+edits`, `title`=message, unknown→muted.

**Verify (headless — all green):**
- `py_compile` stamp-editor.py: OK.
- `node --check` main.js **as an ES module** (copied to `.mjs`, since it `import`s from
  `core/runtime.js`): OK — the new `build_info` route parses cleanly. (Plain `node --check main.js`
  would misparse the top-level `import` as CommonJS; the `.mjs` copy forces module mode, syntax-only,
  imports not resolved.)
- grep: `_send_build_info` def (:737) + call (:154); `build_info:` route (main.js:57); `id="build-badge"`
  (index.html ×1).
- EOL preserved (all 3 files LF); diff +56, surgical.

**Real-symptom GATE → human Fusion:** redeploy → Stop→Start → the Stamp Editor `.topbar` shows
`✓/⚠ <sha> · <date>`.

**E2 STATUS — wiring complete across ALL 8 palettes** (E2a substrate + E2b b-spline-gen + E2c ×6 +
E2d stamp-editor). Pending the human Fusion confirmation of the 8 headers, **E2 is DONE** → E3 next.

---

## Turn 91 — E3: deploy-consolidate + stop-first DESIGN pass (map + propose, no code) — DONE

Produced `DEPLOY-CONSOLIDATE-DESIGN.md` for advisor review. Design-only — ZERO code.

**Map (ground truth, anchors in the doc):**
- **3 deploy scripts:** `DEPLOY_bspline-frame-builder.py` (LOCAL install — canonical
  copy/verify/handshake/build-info + E1 fail-loud), `release.py` (RELEASE orchestrator, 4 steps),
  `deploy_cloudflare.py` (WEB only, out of scope). No `run_deploy.py`/`deploy_worker.py` linger (glob
  confirms only pip's under `.venv`).
- **KEY: the "two local entries" are NOT duplicated.** `release.py --local` (`step_local_refresh`,
  `release.py:259`) **shells out** via `subprocess` to `DEPLOY_…py all` (`:271`) and propagates its
  exit code. So `DEPLOY_…py::deploy_local` is ALREADY the single source; `release.py --local` is a thin
  wrapper. Consolidation is ~90 % done already — no duplicated copy/verify block to remove.
- **Running-add-in detection is WEAK today.** The DebugLogger (`fb_logger.py:63-68`) does
  `open(path,"a")`→write→`fsync`→**close** *per line* (no persistent lock → a lock-probe
  false-negatives), writes to BOTH the deployed tree + the source workspace, truncates on load; no
  PID/lock file exists; which DEST files E1 catches as locked is non-deterministic. ⇒ **no reliable
  zero-add-in-change way to detect a loaded-but-idle add-in.** E1 already covers correctness.

**Proposal:**
- **Consolidation:** keep `deploy_local` canonical; `release.py --local` keeps its subprocess delegation
  (`--web/--addin/--all` untouched); put the stop-first pre-check INSIDE `deploy_local` so BOTH
  invocation paths inherit it (single source).
- **Stop-first pre-check:** best-effort at the top of `deploy_local`; refuse+`--force` on HIGH
  confidence, warn+proceed otherwise; ALWAYS degrades to E1 fail-loud (never blocks on a false
  positive).
- **Detection:** recommend a tiny **heartbeat lock** — the parent bootstrap `bspline-frame-builder.py`
  `run()` (`:450`) / `stop()` (`:660`) writes/removes ONE `.addin-running.lock` for the whole bundle
  (reliable, one touch). Zero-change fallbacks: log-mtime heuristic / locked-file dry-probe (warn-only,
  weak).

**GATED for advisor — 3 forks:** F1 canonical entry (DEPLOY, rec) · F2 detection (A heartbeat-lock rec /
B log-mtime / C dry-probe) · F3 refuse-vs-warn (refuse-on-high-confidence rec; couples to F2).
Recommended bundle **F1-A + F2-A + F3**; zero-add-in-edit fallback **F2-B + warn-only**.

No code — passing to advisor for the fork decisions before any E3 build slice.

---

## Turn 93 — E3 build: stop-first guard + heartbeat lock (F1-A / F2-A / F3-refuse-on-live-PID) — DONE (headless); human Fusion pending

Implemented the advisor's synthesized forks: a heartbeat lock (add-in run/stop) + `_detect_running_addin`
refuse-on-live-PID in `deploy_local` + `--force`. Consolidation confirmed already done (release `--local`
delegates via subprocess); did NOT touch E1 fail-loud / build-info / copy_overlay, did NOT invert
DEPLOY↔release.

**⚠ CRITICAL SAFETY DEVIATION from the dispatch's `os.kill(pid,0)`:** on **Windows** (this repo's
platform), `os.kill(pid, 0)` routes to `TerminateProcess` and would **KILL the target (Fusion!)** — and
would have killed the this-pid test itself. The intent (is-the-PID-alive) is unambiguous, so I
implemented a Windows-SAFE query-only `_pid_alive`: `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` +
`GetExitCodeProcess == STILL_ACTIVE` (never signals), with the POSIX `os.kill(pid,0)` kept ONLY for
non-win32. Proven safe: the headless test calls `_pid_alive(os.getpid())` and the test process SURVIVED.

**(1) Parent `bspline-frame-builder.py`:** `_write_run_lock()` (run() writes
`<addin_root>/.addin-running.lock` = `{pid, started_at:ISO}`) + `_remove_run_lock()` (stop() removes it),
BOTH fully try/except-wrapped (never break run/stop). `_write_run_lock()` right after `ui=None` in run();
`_remove_run_lock()` first thing in stop() (before the app-None early return, so a clean Stop always
clears it).

**(2) `DEPLOY_…py`:**
- `_pid_alive(pid)` (Windows-safe, above) + `_detect_running_addin()` → `(status, msg)`: `live` (lock +
  PID running + not older than 24h), `stale` (dead PID / unreadable / >24h — PID-reuse guard), `none` (no
  lock). Never blocks on uncertainty (any parse error → `stale`).
- `deploy_local(force=False)`: at the TOP (before clean_dir/copy) refuse+`sys.exit(2)` on `live` unless
  `force`; warn+proceed on live-with-force / stale; silent on none. E1's post-copy fail-loud untouched.
- `--force` threaded as a **parameter** (not a module global — avoids a linter false-unreachable +
  cleaner data flow): `deploy_all(force=)` → `deploy_local(force=)`; `__main__` parses `--force` from
  argv + a positional target.
- `.addin-running.lock` added to `SKIP_NAMES` (+ `.gitignore`) so it's never copied/committed.

**Verify (headless — all green; `scratchpad/verify_e3.py`):** py_compile both; `_pid_alive`
self=alive/bogus=dead (no kill); `_detect_running_addin` none / live / stale(dead-pid / unreadable /
48h-old); refuse gate live+noforce=exit2 · live+force=skip · none/stale=proceed. EOL preserved (DEPLOY
LF; bootstrap + .gitignore CRLF); diff +131/−6.

**Follow-up (noted, NOT done):** `release.py --local` does NOT forward `--force` (its `_parse_args`
rejects unknown flags; adding it would touch release's flag contract). Not needed for the guard:
`release.py --local` → subprocess → DEPLOY refuses (exit 2) → release reports failed; to force in the
release flow, run `DEPLOY_…py all --force` directly. Small release.py follow-up if the advisor wants it.

**Real-symptom GATE → human Fusion:** Start the add-in → `.addin-running.lock` appears in the deployed
root; Stop → it's gone; `DEPLOY_…py all` while running → REFUSES (exit 2) with the Stop message;
`--force` deploys anyway.

---

## Turn 95 — E5: fix test_origin_axis_target isolation leak (full suite green) — DONE

Root-caused + fixed the pre-existing test-ordering leak (14/14 alone, 9 fail in-suite). Test-side fix
only — no product code, no assertions.

**ROOT CAUSE — leaked state = `sys.modules['adsk']` (collection-order-dependent):**
Each test file installs its OWN fake `adsk` at IMPORT time (`sys.modules['adsk'] = adsk`). pytest
imports every test module ONCE at collection into a single shared `sys.modules`, so the LAST-collected
stub wins for the entire RUN. `relation_hints._get_origin_entity_map()` (`relation_hints.py:242`) does
`import adsk.core` on EVERY call (no cache) → reads whatever stub is live → returns `{}`/wrong axes when
that stub isn't test_origin's `FAKE_ROOT` → `_origin_axis_token` returns `None` → the 9 origin tests
fail. **Confirmed by bisection:** `pytest test_template_naming test_origin` (origin last) → 19 passed;
`pytest test_origin test_template_naming` (origin first, naming's stub clobbers) → 9 failed.
**Polluter (full alphabetical run):** the last-collected adsk stub = `test_template_naming.py:16`
(`sys.modules['adsk'] = adsk`); any later stubber (e.g. `test_rename_selection.py:16`, whose
`Application.get()` ≠ FAKE_ROOT) reproduces it. NOT a de-dup / fb_shared regression (S2b already proved
identical failures with the old copies).

**FIX — autouse reset fixture in `tests/conftest.py` (declared once, all inherit):**
`_reinstall_module_adsk_stub(request)` — before each test, re-installs THAT test module's own
module-level `adsk` stub (`request.module.adsk`, if it declared one) into
`sys.modules['adsk'/'adsk.core'/'adsk.fusion']`; restores the prior state after (`finally`). Makes every
file's tests order-independent. Added `import pytest`. Did NOT touch the S2 fb_shared alias, no
assertions, no product code, no other test files.

**Verify (headless):**
- Full suite `pytest tests/` NO `--ignore` → **83 passed / 0 failed** (was 74 passed + 9 failed; same
  83 total → no test lost or skipped, the 9 now pass).
- Isolation `pytest …/test_origin_axis_target.py` → 14/14.
- Previously-failing order `pytest test_origin test_template_naming` → 19 passed (was 9 failed);
  `test_origin + test_rename_selection` also green.
- EOL preserved (conftest LF); diff +45, ONLY conftest.py.

**Flag (not a bug):** `_get_origin_entity_map` re-reading `sys.modules['adsk']` per call is CORRECT
product behaviour (it must reflect the live design), so this is genuinely a test-isolation issue, not a
resettable product global. No product change warranted.

---

## Turn 97 — E6 investigation: classify the remaining `_shared_project_names` — DONE

Produced `DEDUP-FINISH-DESIGN.md`. Investigation/design only — no code.

**Headline: de-dup is ALREADY COMPLETE.** Classified all 16 post-S5 `_shared_project_names`:
- **(A) duplicated+drifted → consolidate: 0.** `find -name <name>.py` shows every one of the 16 has
  EXACTLY ONE copy (14 in `template-maker/core/`, `payload_builder` in `frame-inspector/`, `exporter`
  in `fusion-exporter/`). No drifted duplicates remain — C4 consolidated the only 2 (`expression_coords`,
  `entity_helpers`).
- **(B) dead-wipe → retire: 0.** Unlike S5's 2 (retired because consumers had moved to
  `from fb_shared.X import …` → the bare name was never in `sys.modules` → wiping it was a proven
  no-op), ALL 16 remaining have LIVE production bare-name importers (`from entity_util import …` ×6,
  `from payload_builder import …` at fusion-inspector.py:23, `import exporter` at fusion-exporter.py:15,
  …), + 6 also via `importlib.import_module` (template-maker.py:222-234).
- **(C) keep: 16.** The wipe forces re-import from disk on Stop→Start = HOT-RELOAD; retiring it would
  bind a re-bootstrapped sub to STALE cached code (the S4-class regression). Load-bearing, NOT dead.

**⇒ E6 does NOT collapse to "retire the wipe list" (the dispatch's fallback) — the opposite: the wipe is
genuinely needed.** No (A) slice, no (B) slice.

**Import surface documented (S4b lesson, 3 places any move must sweep):** bare-import (16),
`import_module` (6 in template-maker.py), wipe-list (all 16, wiped 3× at `:264/:271/:278`).

**Only open item (OPTIONAL, low-priority, Fusion-gated):** the 3 wiped subs use DISJOINT name-sets
(exporter={exporter}, inspector={payload_builder}, template-maker={the 14}) — zero overlap post-C4 — so
the 3× repeated `_force_wipe(_shared_project_names)` could reduce to 1× (behaviour-neutral, since no
cross-sub collision remains). Tiny payoff, real S4b-subtlety risk → recommend DEFERRING unless the
advisor wants the tidy-up.

**Recommendation:** close E6 as "de-dup complete." No code this turn.

---

## Turn 99 — E8 investigation: undo/redo root cause + fix proposal — DONE

Produced `UNDO-REDO-DESIGN.md`. Investigation/design only — no code. Evidence = code trace + a
**read-only** live-Fusion probe (`fusion_execute`, no design mutation).

**Op sequence (in order, inside the hidden-command Execute handler):** `frame_tilt_deg` USER PARAM
create/reuse (`build_context.py:269` via `parametric_engine._get_tilt_plane:379`) → tilt construction
plane `setByAngle` create/reuse (`parametric_engine.py:391-398`, angle DRIVEN BY the param) → 3 sketches
on the plane (`isComputeDeferred` windows) → [solid] extrudes following the plane normal → attribute
stamping. Tilt commit `6c1cce4` introduced steps 1-2 (touched ONLY parametric_engine, +65/−4).

**Grouping today = NONE explicit (confirmed by live probe):**
- `_start_undo_transaction` wrapper is DEAD: `app.startTransaction` behind `hasattr` → **probe:
  `hasattr(app,'startTransaction')` = False** (+ `transactionManager` False). Fusion has no public
  undo-transaction API on `app`; the wrapper always returns None.
- No `timelineGroups` anywhere → **probe: `timeline.timelineGroups.add` EXISTS, 0 groups today.**
- ONLY grouping = implicit: `cmd_def.execute()` makes the command's Execute-handler geometry mutations
  ONE undo unit. So geometry (plane+sketches+extrudes) already reverses together; the gap is the USER
  PARAM (not a timeline feature).

**Root cause (verdict):** primarily **(b)** — user-parameter create doesn't undo like geometry.
`frame_tilt_deg` is design-level (`userParameters.add`), NOT a timeline feature, so a single Ctrl+Z that
cleanly removes the geometry leaves it ORPHANED (and the plane's angle-driven-by-param link desyncs);
param + plane are both reused by name → stale state undo can't walk = "broken." (a) fits only the param,
not the grouped geometry. (c) hidden dispatch is NOT the culprit — it's what provides the working
geometry unit. **TILT-INTRODUCED** (first mid-build user param), not pre-existing.

**Proposal (mechanism reality):** Fusion has NO public undo-transaction (probed) — you can't "wrap the
build"; the undo unit IS the command execute. `timelineGroups.add` is ORGANIZATIONAL (collapse), not
undo, and excludes user params. So the fix is about the PARAM lifecycle. **Forks:** F1-A drop the
standalone param (drive plane by literal — loses post-build editability) / **F1-B (rec)** treat
`frame_tilt_deg` as a persistent 0-deg design setting + make `_get_tilt_plane` tolerate "param present,
plane undone" (geometry stays one clean command unit; residue = benign 0-deg param) / F1-C create the
param at add-in/palette-open (never inside a build's undo unit). **F2 (rec yes):** delete the dead
`_start_undo_transaction` wrappers (misleading dead code). Optional tidiness: `timelineGroups.add(start,
end)` for a collapsible node (does NOT fix undo).

**Human repro specified** (build → Ctrl+Z once → does ALL reverse? is `frame_tilt_deg` orphaned in Change
Parameters? → Ctrl+Y redo → rebuild reuse?). Forks gated. No code; the only live-Fusion action was a
read-only API probe.

---

## Turn 101 — E8 build: undo fix (F1-C + F2) — DONE (headless); human Fusion pending

Implemented the advisor's synthesis: create `frame_tilt_deg` OUTSIDE any build Execute (F1-C) + delete
the dead undo-transaction wrappers (F2). No `timelineGroups`, didn't move the build out of Execute,
didn't drop the param (F1-A rejected).

**(1) F1-C — the tilt-param invariant:**
- NEW module-level `ensure_tilt_param(design, logger=None)` in `parametric_engine.py:47` — idempotent
  (`if userParameters.itemByName(TILT_PARAM_NAME): return` before `.add(..., '0 deg', 'deg', …)`); never
  raises; uses `ParametricSketchBuilder.TILT_PARAM_NAME` (single source).
- Called via a defensive `_ensure_tilt_param_safe()` helper in `sketch_builder_ui.py` (resolves the
  active Design + calls `frame_engine.parametric_engine.ensure_tilt_param`) at BOTH `run_palette` /
  palette-open (`:538`) AND `DocumentActivatedHandler.notify` / doc-activated (`:501`) — both OUTSIDE any
  command Execute.
- REMOVED the `create_or_update_param('frame_tilt_deg')` from `_get_tilt_plane`
  (`parametric_engine.py:376-381`). It now only READS the param; if absent at build time → hosts sketches
  on the raw XY plane (existing fallback), never creating the param mid-Execute.

**(2) F2 — deleted the dead undo-transaction wrappers** (E8 live-probed dead: `app.startTransaction`
doesn't exist): removed `_start_/_commit_/_abort_undo_transaction` defs + ALL call sites in both
`_run_sketch_build_direct` (sketch) and `_run_solid_build_direct` (solid). Builds now rely solely on
Fusion's implicit "one `command.execute` = one undo unit" for geometry.

**Verify (headless — all green):**
- py_compile all 3.
- 0 transaction-wrapper remnants (grep `_start/_commit/_abort_undo_transaction|startTransaction` → none).
- 0 tilt-param CREATE in the build/Execute path (grep `create_or_update_param.*TILT` → none); the only
  `userParameters.add` for the tilt param is in `ensure_tilt_param`, called ONLY from palette-open +
  doc-activated (both non-Execute, confirmed by reading the call sites).
- idempotent by construction (itemByName guard + early return).
- EOL preserved (parametric CRLF; sketch/solid LF); diff +59/−82.

**Real-symptom GATE → human Fusion:** build a frame → Ctrl+Z ONCE → the whole frame (plane + sketches +
extrudes) reverses clean; `frame_tilt_deg` PERSISTS (created outside the build, so no orphan flip-flop);
Ctrl+Y redo works; rebuild reuses the param/plane; set `frame_tilt_deg=30` → next build tilts.

---

## Turn 103 — H1 repo hygiene (headless) — DONE

Executed the advisor's epoch-1 dispatch exactly: no application code touched, no design docs, no
file moves. `bspline-frame-builder/` left completely untouched (E8 deployed, human Fusion gate open).

**(1) Committed the stray Nest Hub bus-tracker work** (`f797c20`): `node --check` passed on both
`bus-route.js` and `index.js` before committing. New file (`bus-route.js`) needed `git add` first since
`git commit <pathspec>` cannot stage an untracked path — staged only that one file, then committed all
3 declared paths by path (`wrangler.toml`, `index.js`, `bus-route.js`). Shape matched prediction: 3 files,
519 insertions, 0 deletions.

**(2) Deleted session junk.** Before deleting, verified every listed path's existence and tracked/ignored
status individually (`git ls-files --error-unmatch`, `git check-ignore -v`) rather than trusting
`git status --short` alone — several of the listed junk files (`debug_log.txt`, `deploy_log.txt`,
`pages_deploy_log.txt`, `wrangler_deploy_log.txt`, the `*.err` pair, the three `diff_*.txt`, and the
6.4 MB `fusion-inspector-debug.log`) were already matched by pre-existing `.gitignore` rules (`*_log.txt`,
`*.err`, `diff_*.txt`, `*.log`), so they never showed as `??` in `git status` even though they existed on
disk. Confirmed each with `check-ignore -v` before `rm` so nothing was deleted on a false assumption.
Plain `rm` on the 9 root screenshots + `index.js.bak2` + the 10 already-ignored files; `git rm --cached`
+ `rm` on the 3 tracked-junk files (`pytest_run_output.txt`, `git_original_bspline_index_head.txt`,
`SESSION_CONTEXT_2026-05-23.md`).

**(3) Appended the declared ignore block** verbatim to `.gitignore` (one block, 8 lines) per the
advisor's exact spec. Some lines overlap pre-existing rules (`*_log.txt`, `*.bak` already present from
an earlier F12 pass; `diff_*.txt` already present unanchored vs the new anchored `/diff_*.txt`) — left
as declared rather than deduping, since the dispatch specified the block verbatim and duplicate globs in
`.gitignore` are inert, not a correctness risk. New coverage the old rules lacked: `*_log.txt.err`,
`*-debug.log` (catches `fusion-inspector-debug.log`'s class), `*.bak[0-9]` (catches `.bak2`),
`/pytest_run_output.txt`, `/_*.png`.

**(4) One hygiene commit** (`3c7bd01`): `.gitignore` + the 3 `git rm`'d files. Shape matched prediction:
4 files, 10 insertions, 481 deletions.

**Verify (fast tier, all green):** `node --check` ×2 passed pre-commit. `git status --short` clean (no
`??`, no residue) after both commits. Both `git show --stat` shapes matched the advisor's predictions
exactly (3 files / 4 files). `git check-ignore -v _shot.png debug_log.txt` both resolve into the new
block's lines. No amendments were pending at either poll (before commit, before pass).

No gate hit — both commits were declared, non-restructuring, and matched the dispatch exactly. Nothing
under `bspline-frame-builder/` was read or modified.

## Turn 105 — E7a Frame Inspector dead-code sweep (headless) — DONE

Executed the advisor's epoch-1 dispatch exactly: dropped the dead `payload_builder` import chain, its
dead JS renderer, the stale wipe/verify entries, and marked the two docs resolved. Nothing under
`frame-builder/` or `fb_shared/` was touched.

**(1)** `fusion-inspector.py:23` — deleted `from payload_builder import build_payload`. Confirmed first
via `grep -n build_payload` that the name had exactly one hit (the import itself) before deleting; the
live payload is built inline at :499-556 as documented.

**(2)** `git rm frame-inspector/payload_builder.py frame-inspector/selection_items.py` — confirmed
`selection_items` had no importer once `payload_builder.py` was gone (only chain was
`fusion-inspector.py` → `payload_builder.py` → `selection_items.py`).

**(3)** `inspector_palette.html` — deleted the dead `renderItemList` (:119-145, read `data.items`, a key
the live payload never sends — confirmed zero callers via grep) and the duplicate `reportError`
(:147-153), keeping the first definition at :111.

**(4)** `bspline-frame-builder.py:256` — removed `'payload_builder'` from `_shared_project_names`,
kept `'entity_util'`.

**(5)** `DEPLOY_bspline-frame-builder.py` — removed `selection_items.py`, `entity_helpers.py` (gone
since C4-S3, was warning on every deploy), and `payload_builder.py` from `deploy_fusion_inspector`'s
`verify_files`.

**(6)** Appended one `RESOLVED 2026-09-17 (E7a)` line each to `BUGS_OPEN.md` B7 and `FIX-BACKLOG.md`
F4, per the dispatch's exact wording. Left `ARCHITECTURE.md`/`STANDARDS-AUDIT.md` untouched as
instructed.

**Verify (fast tier, all green):** `python -m py_compile` passed on all 3 edited Python files. Sweep
grep with the dispatch's literal pattern (`payload_builder|selection_items|build_payload\b|renderItemList`,
no `\b` on the first two terms) surfaced 6 hits — all in `template-maker/` on the unrelated
`template_payload_builder` symbol (substring collision, same class as the `build_payload_items` caveat
the dispatch already flagged for `build_payload` — just not anticipated for `payload_builder` itself).
Re-ran with `\b` on every term: **0 hits**, confirming no real residue. `grep -c "function reportError"`
→ 1. No amendments pending at either poll (before commit, before pass).

**Commit shape:** predicted 5 modified + 2 deleted = 7 files; actual was **8 files** (`c60628b`) — 6
modified (`fusion-inspector.py`, `inspector_palette.html`, `bspline-frame-builder.py`, `DEPLOY_...py`,
`BUGS_OPEN.md`, `FIX-BACKLOG.md`) + 2 deleted. The dispatch's own step list names 6 files to modify (the
prediction line undercounted one of the two doc files); the diff otherwise matches the dispatch exactly
— no extra files, no missing ones. Flagging per the verify instruction to say so if it differs.

No gate hit — a declared, advisor-verified deletion with 0 real sweep hits post-change. Nothing under
`frame-builder/`, `fb_shared/`, `sketch_builder_ui.py`, or `parametric_engine.py` was touched. Full
pytest suite not run (no test imports these modules — confirmed via the sweep grep against `tests/`,
0 hits there either).

---

## Turn 107 — PM1: restore Project Manager selection bar, remove sidebar Quick Load — DONE

Executed the advisor's epoch-1 dispatch exactly. Two files only, one commit.

**(1) Restored the block deleted in `91b624d`** into `bspline_gen_palette.html`, copied verbatim from
`91b624d^` (`<!-- Bottom selection bar -->` through `<input type="hidden" id="fmProjectName">`, inclusive
— no content edits). Insertion point needed a judgment call: the dispatch said "before the `</div>` that
closes `.pm-dialog`", but that div's end tag doesn't exist explicitly in this file — `.pm-dialog`,
`#projectManagerModal`, `<body>`, and `<html>` are all left to HTML5's implicit end-tag closing, and the
file (1957 lines, matches `git show HEAD` exactly, no truncation) ends right after `#fmProjectList`'s
closing `</div>`. So "before the implicit close" resolves to "at end of file" — inserted the restored
block immediately after line 1957.

**(2) Removed the sidebar `btnQuickLoad` chain, every link:**
- html: the `<!-- Quick Load: … -->` comment + the whole `<button id="btnQuickLoad">…</button>`, leaving
  the `Projects` button alone in its flex row (no style edit — dispatch confirmed none needed).
- js `:166-169`: the "Sidebar Quick-Load button" comment + `const btnQuickLoad …` + its
  `addEventListener`.
- js: the whole `export async function quickLoad() { … }` plus its `/** Quick Load from outside the
  modal … */` doc comment.
- js `_loadFrom`'s doc comment: reworded "Shared by the modal Load button and the sidebar Quick-Load" →
  "Used by the modal Load button and row double-click." (a comment naming a deleted thing is a lie).

Left `📁 Projects`, `btnOpenProjectManager`, `quickSave`, `onLoad` untouched, per the dispatch's Do-NOT
list.

**Verify (fast tier, all green):** `node --check` on `cloud-project-manager.js` clean. Each of
`fmSelbarInfo fmBtnLoad fmBtnRename fmBtnDelete fmProjectStatus fmProjectMsg fmProjectName` occurs
exactly once in the html (`grep -c`, all 1). Inverse sweep
`grep -rnE "btnQuickLoad|quickLoad|Quick.?Load"` over `b-spline-gen/html` (html+js) → 0 hits — no door
without a room, no room without a door. `git diff --stat` shows exactly the 2 predicted files. No
amendments pending at either poll (before commit, before pass). Did not touch `dist/`, `index.html`, any
other palette, or run the full vitest suite (no spec imports this module — not independently re-verified
by grepping `tests/`, since the dispatch didn't ask for that confirmation this time; flagging the gap
rather than silently assuming).

No gate hit — a declared, advisor-verified restoration + a declared, fully-swept removal. The advisor
owns the visual confirmation (deploy + screenshot).

---

## Turn 109 — PM1b: restore palette's cut closing tags — DONE

Confirmed the advisor's follow-up finding from PM1's pass-back flag: `91b624d` also deleted the file's
last four structural lines (the two `</div>` closing `.pm-dialog`/`#projectManagerModal`, plus
`</body>`/`</html>`). Verified before editing: from `#projectManagerModal` to EOF the file had 14 `<div`
vs 12 `</div>`, and 0 `</body>`/`</html>`.

Appended, after `<input type="hidden" id="fmProjectName">`:
```
    </div>
  </div>

</body>

</html>
```
Checked the file's raw trailing bytes first (`xxd`) — CRLF throughout, no trailing blank line before EOF
— and appended with explicit `\r\n` terminators (`printf`) rather than a text-editor append, so the new
lines match the file's existing line endings exactly rather than relying on git's autocrlf to fix it up
after the fact.

**Verify (all green):** div balance 14/14 from `#projectManagerModal` to EOF. `grep -c "</body>"` → 1,
`grep -c "</html>"` → 1. `git diff --stat` → 1 file, 6 insertions, 0 deletions (within the predicted 4-6
range; the 2 blank lines account for the difference from the 4 non-blank lines). No amendments pending.

No gate hit — a declared, advisor-verified structural restoration, no other content touched.

---

## Turn 111 — E7b: fold sections + DECLARE metadata as structured fields — DONE

Executed the advisor's epoch-1 dispatch. 3 files, one commit. Per-row copy buttons left for E7c as
instructed.

**(1) `fb_shared/entity_helpers.py` — one truth, two renderings.** Added `get_fb_metadata_fields(ent) ->
dict` (keys `startId, endId, centerId, bulge`, only when present, same attribute reads + same
`round(mid, 2)` bulge formatting as before). Replaced `get_fb_metadata`'s body so it derives its string
from that dict via a fixed `(key, label)` order tuple — it no longer reads attributes directly, it calls
`get_fb_metadata_fields` and joins. Kept the pre-existing `RECONCILED`/`FLAG` comment attached to the new
dict function, since that's where the actual Bulge-vs-Center attribute logic now lives.

**(2) `fusion-inspector.py`** — found a discrepancy in the dispatch's ground truth worth flagging: this
file does **not** import `get_fb_metadata` from `fb_shared` — it has its **own local duplicate**
definition (`:331-354`, near-identical logic, its own `nativeObject` resolution). The dispatch described
"`get_fb_metadata(e)` — fb_shared/entity_helpers.py:210-235" as if fusion-inspector called the shared
one; it doesn't. Per the dispatch's own instruction to leave the BATCH `linked` entries untouched
(E7c/that local function stays exactly as-is, still used at the batch-loop's `fb_meta_item = get_fb_metadata(ent)`
call), I added `from fb_shared.entity_helpers import get_fb_metadata_fields` (a new import, the shared
dict function did not exist before this turn) and used ONLY that for the single-entity `meta` dict build,
leaving the local duplicate `get_fb_metadata` fully alone. Changed the placeholder `'meta'` from
`f"{count} Entities Selected"` to `{}` (so the type is one thing per the dispatch), and replaced the
`Bridge: {bridge or 'N/A'} | Plan: ...` string build at the single-selection block with
`{'type': ..., 'bridge': bridge or '', 'plan': plan or '', **get_fb_metadata_fields(e)}` exactly as
specified.

**(3) `inspector_palette.html`:**
- Declared `META_FIELDS` once (`[[key,label], …]`, 7 entries, `type/bridge/plan/startId/endId/centerId/bulge`
  in that order) near the top of the script block.
- Added `renderMeta(meta)`: builds one `.cad-field-row` (`.cad-label` + a value `<span>`) per present,
  non-empty key, in `META_FIELDS` order; falls back to `container.textContent = String(meta || '')` if
  `meta` isn't an object (older Python still running mid-deploy). Wired it into `applyData` in place of
  the old `meta-text.textContent = d.meta || ''` line.
- Folding: in `attachUIEvents` (called once from `init()`), queried
  `.cad-sidebar-panel > .cad-accordion-header` (the `>` direct-child combinator excludes the nested
  `.dark #list-label` sub-header) and added one click listener per header toggling `collapsed` on the
  header and on `header.nextElementSibling` (the section's `.cad-dialog-content`). No new CSS —
  `styles/base.css:1081-1090` already declares both rules. Both sections start expanded (no `collapsed`
  class added at load).
- Removed `.meta-container`'s CSS rule (monospace font + `white-space: pre-wrap`) and dropped the class
  from the `#meta-text` div — confirmed via grep it was the class's only definition and only consumer, so
  nothing else was relying on it, and it no longer fits a field-row layout.

**Verify (all green):** `py_compile` 2/2 clean. **Byte-identity gate:** `pytest
template-maker/tests -q` → **83 passed before, 83 passed after** — `get_fb_metadata`'s output is
unchanged for template-maker's consumers. `META_FIELDS` declared exactly once (`var META_FIELDS =` — the
other 3 grep hits are the declaring comment + 2 in-function reads). `#meta-text` written only through
`renderMeta`. `collapsed` toggled in exactly one function (the folding click handler in
`attachUIEvents`). `git diff --stat` → exactly the predicted 3 files. No amendments pending at either
poll.

No gate hit. Nothing under `frame-builder/` was touched. No copy buttons added (E7c). Didn't deploy — the
advisor owns the visual confirmation.

---

## Turn 113 — IN2: retire fusion-inspector's 10 inline fb_shared duplicates — DONE

Executed the advisor's AST-diff-verified dispatch. 1 file, one commit. Did not touch `fb_shared/`.

**(1) Deleted the 10 local duplicates** named in the ground-truth table (`get_fb_name`, `get_fb_bridge`,
`get_fb_plan`, `_get_entity_key`, `format_point`, `_get_arc_midpoint`, `get_fb_metadata`,
`entity_fingerprint`, `get_entity_coord`, `get_entity_coord_expr`), whole functions including docstrings
— via `sed` line-range deletion (verified exact boundaries with `grep -n "^def "` first, then re-read the
seams after) rather than the Edit tool's literal-string matching, since several of these functions had
inconsistent trailing whitespace that would have made exact-match edits fragile.

**(2) Retiree's own machinery — mutation-tested, not assumed:** grepped each of `get_design_dimensions`,
`format_expr_component`, `format_point_expr`, `get_fb_attribute` for surviving callers after step 1;
all four had zero (their only callers were inside the now-deleted local `get_entity_coord_expr`) — deleted
all four.

**(3) Import replacement — two names dropped beyond the dispatch's own example.** Replaced the two import
lines with the shared-function set. The dispatch's literal proposed import list included `_get_entity_key`
(explicitly flagged "0 today" in the dispatch itself — dropped, per instruction) but ALSO listed
`_get_arc_midpoint` and `get_design_params`. I checked call sites for every name in the proposed list
after the deletions and found both of those also at **zero** direct call sites in this file: `_get_arc_midpoint`
is only needed internally by `fb_shared`'s own functions (which import it themselves inside `fb_shared`),
and `get_design_params` was already a dead import before this turn (0 call sites pre-existing, not
introduced by IN2). Applying the dispatch's own stated rule ("drop any name that turns out to have 0 call
sites") consistently rather than only to the one named example, I dropped both. Flagging this as a
judgment call in case the advisor intended `get_design_params` to stay for a reason not visible in this
file alone.

**Call sites unchanged** — `get_fb_connections` (kept, no shared equivalent, per dispatch) still calls
`get_fb_name`/`format_point` by their now-imported names; `_push_selection_to_palette` still calls
`get_fb_name(e)`, `get_entity_coord(e)`, `get_entity_coord_expr(e)`, `get_fb_bridge(e)`, `get_fb_plan(e)`,
`get_fb_metadata_fields(e)`, `entity_fingerprint(ent)`, `get_fb_metadata(ent)` (batch loop) — all matching
the shared functions' signatures, no renames.

**No STOP condition hit** — every shared function's signature and behaviour covers what
`_push_selection_to_palette` needs; the one accepted visible change (point coord line drops the
`<name>: ` prefix, now `Point: (x, y)`) was pre-ruled by the advisor in the dispatch.

**Verify (all green):** `py_compile` clean. AST dup-sweep script → `clean` (0 overlap between
fusion-inspector.py's defs and fb_shared's). `grep -c "^def "` → **21 → 7** (14 deleted: the 10 named +
the 4 orphaned expr-helpers). `pytest template-maker/tests -q` → 83 passed (fb_shared untouched, so
unchanged — confirms this turn's import-only change didn't touch behavior). `git diff --stat` → exactly 1
file (301 lines touched: 5 insertions, 296 deletions). No amendments pending at either poll.

No gate hit. Didn't touch `fb_shared/`, the palette HTML, `frame-builder/`, or the exporter. Didn't add
wrappers or aliases. Didn't deploy — the advisor owns the visual confirmation.

---

## Turn 115 — FB1: crash-safe deferred-compute window + dead param helper + lying comment — DONE

Executed the advisor's dispatch on the E8 tree. The advisor explicitly cleared this: the human's Fusion
undo check runs against the DEPLOYED copy (sha 6777525), not this working tree, and this turn doesn't
deploy — so editing here doesn't disturb that check. 2 files, one commit.

**(1) Declared `deferred_compute(sketch)`** as a module-level `@contextmanager` in `parametric_engine.py`
(after the imports, before `ensure_tilt_param`) — sets `isComputeDeferred = True` on enter, ALWAYS resets
to `False` in a `finally` on exit, verbatim per the dispatch's given implementation.

**(2) Rewrote both `_build_blocks` windows** as `with deferred_compute(sketch):` blocks. Window 1 (was
`:313→:330`) now wraps the `BuildSequence`/Geometry/Constraints/Dimensions/VolatileDimensions steps;
window 2 (was `:334→:346`) wraps the Offset Steps + Miters loop. Deleted the explicit `= True`/`= False`
lines the `with` now handles. Kept the `PULSE SOLVE` log line and `log_arc_audit` call exactly where they
sat — outside the first `with`, between the two windows — and left the pre-Projections `= False` (was
`:308`) and `_process_sequence`'s manual Pulse (`= False` then `= True`, was `:368-369`) completely
untouched, as instructed. Also dropped the dangling `# Final solve flush for the block` comment that sat
above the old trailing `= False` — that line is what the comment described, and the `with`-block's
`finally` now does the same job silently; keeping the comment would have left it describing code that no
longer exists at that spot.

**(3) Deleted `create_or_update_param`** from `build_context.py` (whole method, was the last member of
the class and the last thing in the file) — confirmed 0 callers repo-wide (`grep -rn`, only the
now-deleted def itself and a stale `.pyc` in `__pycache__` matched).

**(4) Reworded the `:123-125` comment** to the dispatch's exact given sentence. Also trimmed the header
line above it from `# 1. Parameter Sync (Centralized in frame_engine.py)` to `# 1. Parameter Sync` — the
old parenthetical claimed a single site, which the new sentence directly contradicts (two sites); leaving
it would have re-introduced the same lying-comment problem one line up. Small edit beyond the dispatch's
literal quoted text, flagging it as a judgment call for consistency.

**Verify (all green):** `py_compile` 2/2. `create_or_update_param` grep → 0 `.py` hits. `pytest
template-maker/tests -q` → 83 passed (sanity only — this turn's code path isn't under test). `git diff
--stat` → exactly the predicted 2 files.

**Grep-count note:** raw `grep -c "isComputeDeferred = True"` on the file returns 3, and `= False` returns
4 — one extra hit each — because the `deferred_compute` docstring quotes those exact literal strings as
prose (the dispatch's own given docstring text does this). Counting only the executable assignments:
`True` appears twice (`deferred_compute`'s own entry line + `_process_sequence`'s untouched manual pulse)
and `False` appears three times (the pre-Projections reset, `deferred_compute`'s `finally`, and
`_process_sequence`'s pulse) — exactly the 2/3 the dispatch predicted.

No gate hit. Didn't touch `frame_engine.py`, `offsets.py`, `_process_sequence`'s body, any UI, or
`fb_shared`. Didn't move parameter creation. Didn't deploy.
