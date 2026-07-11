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
