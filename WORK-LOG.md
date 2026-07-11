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
