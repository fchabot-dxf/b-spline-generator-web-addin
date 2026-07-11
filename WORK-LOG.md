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
