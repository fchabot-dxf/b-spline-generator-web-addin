# STANDARDS-AUDIT — b-spline-generator-web-addin (T3)

> "Is it **built to standard?**" — distinct from T2's "is it broken." Read-only,
> evidence-based; every number below was produced by `diff`/`grep`/`git` and
> re-verified against source. Overlaps with T2 bugs are cross-referenced by
> B-number, not re-litigated. Paths relative to repo root (`bspline-frame-builder/`
> is the add-in dir). Excludes `.venv*`, `node_modules`, `__pycache__`.

## Severity roll-up (worst first)

| # | Dimension | Headline | Sev |
|---|-----------|----------|-----|
| 4 | Error handling | **253** `except…: pass` (156 bare `except:`) across 43 `.py`; **98** empty `catch{}` in JS | **H** |
| 1 | Duplication | Forked 33-file editor tree (11 already drifted); 2 Python modules drifted 300–400 diff-lines | **H** |
| 2 | Test coverage | Only template-maker + frame-builder engine tested; **entire JS frontend, lifecycle, 4/6 palettes, both workers untested; no CI** | **H** |
| 5 | Deploy repro | preset-worker 3-way name drift (`bspline-presets` = mis-bound orphan); step-editor-worker non-reproducible; hardcoded machine paths | **M-H** |
| 3 | Dead/incomplete infra | 6 cruft files committed + 36 MB zip in **history** (not current tree); 2 planned-but-unbuilt cloud pieces | **M** |
| 6 | Deps / secrets | Both npm deps orphaned; runtime libs from un-pinned CDNs (no SRI). **No secret in git**; `.env` holds live tokens on disk only | **M** (deps) / **H-material** (`.env`) |

---

## 1. CODE DUPLICATION  ·  severity H

### 1a. Forked editor tree (T2-B8) — `b-spline-gen/html/editor/` vs `stamp-editor/html/editor/`
`diff -rq`: **33 `.js` files each side · 22 byte-identical · 11 already drifted.**

| Drifted (11) | Byte-identical (22, incl. the bug-bearing ones) |
|--------------|--------------------------------------------------|
| `debug.js`, `editor-coords.js`, `editor-curves.js`, `editor-fonts.js` (286 diff-lines), `editor-hit.js`, `editor-math.js` (34), `editor-symbol-keyboard.js`, `properties-expand.js`, `properties-panels.js` (38), `properties-shape.js`, `properties-text.js` | incl. **`editor.js`, `editor-interaction.js`, `layers.js`, `editor-expand-shape.js`, `editor-io.js`** — the exact files T2's B1/B3/B6 live in |

**Maintenance cost, concretely:** the five files that carry the open T2 bugs are
*currently* byte-identical across both trees, so a B1/B3/B6 fix must be applied
**twice** or the copies silently diverge — and 11 files show the divergence has
already begun. This violates Principle 1 ("shared logic must not be forked per
host"). **Fix direction:** collapse `stamp-editor` onto the `b-spline-gen/html/editor/`
tree via a shared path (symlink at build, or import from one canonical location);
the `dist/` copy step already proves a copy-at-deploy model works.

### 1b. Per-palette shared Python modules — the root of the `_force_wipe` machinery
Only **two** modules are physically duplicated, and **both have drifted into
divergent implementations** (not clean copies):

| Module | Copies | Drift |
|--------|--------|-------|
| `expression_coords.py` | `frame-inspector/` (308 L) vs `template-maker/core/` (325 L) | **399 diff-lines** |
| `entity_helpers.py` | `frame-inspector/` (231 L) vs `template-maker/core/` (203 L) | **276 diff-lines** |

Every other candidate (`entity_util`, `payload_builder`, `selection_items`,
`phase_parser`, `role_points`, the `template_*` set) is **unique to one palette**
— no cross-copy. So the duplication surface is small (2 modules) but severe: the
copies have diverged enough that they can't simply be de-duped to one file without
reconciling behaviour. This duplication is *why* the parent needs the
`_force_wipe(_shared_project_names)` dance (`bspline-frame-builder.py:243-268`) and
is the substrate for T2-B7 (`selection_items` missing from that list). **Fix
direction:** extract a single `fb_shared/` package both palettes import, reconcile
the two drifted versions first.

### 1c. `dist/` reproducibility — GOOD
`dist/` is a **filtered file-copy** of `b-spline-gen/html/` + `styles/`
(`deploy_cloudflare.py:175-210`), not a compiled bundle — and that copy is the
**only** build step. It is **git-ignored and 0 files tracked** (`git ls-files
dist` empty), regenerated deterministically by `deploy_cloudflare.py --build-only`.
No stale-`dist`-in-VCS problem. This is the healthy part of the duplication story.

---

## 2. TEST COVERAGE  ·  severity H

**16 test files total, all Python, no runner/CI.**

- **template-maker** — `template-maker/tests/`: 13 `test_*.py` (`test_template_generator`,
  `_bridge`, `_naming`, `_variable_block`, `test_coincidence_clusters`,
  `_construction_flag`, `_dimension_hint`, `_offset_hint`, `_origin_axis_target`,
  `_rename_selection`, `_mixed_entities_and_rename`, `_sketchpoint_expression_bug`,
  `_circle_ellipse_spline`) + a thin `conftest.py` (sys.path only, no fixtures).
  **Well covered.**
- **frame-builder** — 3 unit files (`test_templates.py`, `test_appearance_strategy.py`,
  `test_document_discovery.py`) over `fb_engine`. **Lightly covered.**

**No harness:** no `pytest.ini`/`pyproject.toml`/`setup.cfg`/`tox.ini`, **no
`.github/` (no CI)**, no `test` script in any `package.json`. Tests run ad-hoc
(stray `.pytest_cache/` + `pytest_run_output.txt` are the only evidence they're
ever executed).

**Coverage map — everything the user actually touches is untested:**

| Surface | Tests |
|---------|-------|
| template-maker generation logic | ✅ deep |
| frame-builder `fb_engine` | ◑ light |
| **JS frontend** — `core/` (incl. `stepWriter.js` STEP writer, `fusion-bridge.js` seam), `editor/` (~33 modules), `main/` | ❌ none (no JS test framework at all) |
| **Python add-in lifecycle** (run/stop, `_bootstrap`/`_teardown`) | ❌ none |
| frame-inspector · fusion-exporter · CAM-builder · stamp-editor | ❌ none (4/6 palettes) |
| cloud workers (`preset-worker`, `step-editor-worker`) | ❌ none |

**Fix direction:** add a JS test runner (vitest) for the pure `core/` logic
(`stepWriter`, `bspline-math`, `coords`, noise) where it pays off most; add a
`pytest.ini` + a minimal CI workflow so the existing 16 tests actually gate.

---

## 3. DEAD / INCOMPLETE INFRA  ·  severity M

**Planned-but-unbuilt (not dead — intentional stubs):**
- `cloud/step-editor-worker` — unprovisioned: KV ids still `REPLACE_AFTER_KV_CREATE`
  / `_PREVIEW` (`wrangler.toml:11-12`); no deploy script. (T2 parked.)
- `cloud/step-editor-pages` — README-only; the `deploy.cmd` + `step-editor/html/`
  source it references don't exist. (T2 parked.)

**Dead / committed cruft (should not be in VCS):**
- **`bspline-frame-builder/bspline-frame-builder.zip` — 36 MB, git HISTORY bloat
  (NOT a current commit).** [Corrected 2026-07-11 — T3 first stated "committed to
  git"; that's wrong for the current tree.] It is **correctly git-ignored now**
  (`.gitignore:51`) and **untracked** — but git history carries **14 commits** of
  it across multiple 20–36 MB blobs (≈300 MB+ of permanent pack bloat; it's the
  single largest object in history). Current-tree hygiene is fine; the debt is
  historical. **Fix:** optional — a history rewrite (`git filter-repo` / BFG) if
  clone size matters; it's already ignored going forward, so LOW urgency.
- 6 tracked junk files: `debug_log.txt.err`, `diff_check.txt`, `diff_current.txt`,
  `diff_state.txt`, `bspline-frame-builder/sync_stamp_bundle.py.tmp`,
  `b-spline-gen/b_spline_gen_log.txt.old`, plus `cloud/preset-worker/src/index.js.bak`
  — all committed logs/diffs/backups. **Fix:** delete + gitignore the patterns.
- Local-only cruft (untracked, minor): 4 root virtualenvs (`.venv`, `.venv-1/2/3`).

**Legacy references:** `hybrid_builder`/`fusion-hybrid`/`deploy_hybrid` appear in
`b-spline-gen/README.md` (stale doc drift — those files don't exist; the real
entry is `b-spline-gen.py`) and in `bspline-frame-builder.py` (but there they are
**intentional purge code** — `hybrid_builder_ui`/`hybridBuilderCommand` cleanup for
old installs, not dead code). Distinguish: README = fix; parent purge = keep.

---

## 4. ERROR HANDLING  ·  severity H

**Python — `except…: pass`: 253 occurrences across 43 files. Of those, 156 are
the riskier BARE `except:`** (no exception type — also swallows `KeyboardInterrupt`/
`SystemExit` and masks `AttributeError`/`TypeError` programming bugs).

| Worst offenders (bare `except:`) | count |
|----------------------------------|-------|
| `fusion-exporter/exporter.py` | 36 |
| `frame-inspector/fusion-inspector.py` | 18 |
| `frame-builder/ui/sketch_builder_ui.py` | 16 |
| `b-spline-gen/b-spline-gen.py` | 16 |
| `fusion-exporter/fusion-exporter.py` | 13 |
| `frame-builder/ui/solid_builder_ui.py` | 12 |

**Legit vs masking:** a meaningful share are idiomatic best-effort Fusion teardown
(`try: ctrl.deleteMe() except: pass` in stop() loops) — acceptable. But the
pattern also wraps **business logic**: e.g. `CAM-builder/cam-builder.py:915-917`
swallows all errors while parsing a parameter expression and silently returns a
fallback; `exporter.py`'s 36 bare excepts sit in the DNA-export path, not cleanup.
Those hide real failures with no log. **Fix direction:** narrow to
`except Exception:` (never bare), and in non-cleanup paths log via the existing
`_log_error`/`fusLog` instead of `pass`.

**JS — empty `catch {}` / `catch (_) {}`: 98 across 33 files** (≈half are the
forked `stamp-editor` copies from §1a). Many are deliberate best-effort
(`try { adsk.fusionSendData(...) } catch (_) {}`), but the same "swallow silently"
concern applies to the editor interaction/expand paths. **Fix:** at minimum log in
`catch` on the non-bridge paths.

---

## 5. DEPLOY REPRODUCIBILITY  ·  severity M-H

**`dist/` + Pages: reproducible.** `deploy_cloudflare.py --build-only` is
self-contained and deterministic; Cloudflare Pages runs it on push.

**preset-worker IDENTITY DRIFT (T2 parked) — confirmed, and the REST path is a
stale orphan:**
- Live/authoritative: **`projects-dansemur`** — `wrangler.toml:1` `name`, the URL
  the app calls (`bspline_gen_palette.html:23`), and the worker's own
  `service: 'projects-dansemur'` (`preset-worker/src/index.js:147`). Published by
  `wrangler deploy`.
- `package.json:2` `name` = `bspline-preset-worker` (a third, unused label).
- `deploy_worker.py:24` PUTs script **`bspline-presets`** via REST — a **different
  name nothing references** (orphan), and it binds **only `PRESETS`** (`:63-65`)
  while the source also needs `env.PENPLOTTER`/`env.LOADER_APPS` + secrets, so it
  would publish a **broken mis-bound duplicate**. **Fix:** delete `deploy_worker.py`
  (or align its name+bindings to `wrangler.toml`); make `wrangler deploy` the one path.

**step-editor-worker: NOT reproducible** — placeholder KV ids + no deploy script;
needs manual `wrangler kv:namespace create` + paste (README).

**Manual steps / machine coupling:**
- Human prerequisites: `wrangler login` (browser OAuth), `gh auth`, KV-namespace
  creation, and `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` in `.env`.
- No orchestrator deploys the workers — `run_deploy.py` → Pages only; `release.py`
  → git-push→Pages auto-build (`:199`), never the workers.
- **Hardcoded machine paths (reproducibility landmines):** `run_deploy.py:8-9`
  (`C:\nvm4w\nodejs`, `C:\Users\danse\AppData\Roaming\npm`), `deploy_cloudflare.py:77`
  (`C:\nvm4w\nodejs` — mitigated by fallbacks), and three that point at
  machine-specific / wrong-repo locations:
  `fusion-exporter/fusion-exporter.py:165` (`…\import-export-template\…`),
  `fusion-exporter/exporter.py:86`, `CAM-builder/cam_engine/setup_builder.py:206`
  (`C:\Users\danse\AppData\Roaming\Autodesk\CAM360\machines\Ultimate Bee 3 axis.mch`).
  These break on any other machine. **Fix:** derive from env/`__file__` or config.

---

## 6. DEPENDENCY / SECRET HYGIENE  ·  deps M / `.env` H-material

**npm deps (root `package.json`) — both declared deps are orphaned, caret-ranged:**
- `opentype.js ^1.3.4` — **0 local imports**; loaded from CDN at runtime
  (`editor/editor-expand-text.js:45` `import('https://esm.sh/opentype.js')`).
- `clipper-lib ^6.4.2` — **unused**; the editor's clipping uses CDN
  **`polygon-clipping@0.15.7`** (`editor/editor-expand-union.js:4`), not this
  package. (The 108 `clipper` string hits are a local variable name + comments +
  `dist/` copies — verified, not npm-`clipper-lib` usage.)
- No bundler, so `node_modules/` never ships to `dist/`; the two deps are dead
  weight. **Fix:** drop both from `package.json`.

**Runtime libs are CDN-delivered, un-pinned by lockfile, no SRI:** three.js r128,
svg.js 3.2.0, jszip 3.10.1, FileSaver 2.0.5 (cdnjs), canvg / opentype.js /
polygon-clipping (esm.sh). Supply-chain exposure: third-party CDN scripts load
without integrity hashes. (Minor: the palette HTML comment says "canvg v4" but the
code loads v3 — stale.) **Fix:** add SRI hashes (or vendor + bundle) for the pinned
cdnjs libs.

**Secrets — NO secret is committed to git (verified):**
- `.env` holds **live `CLOUDFLARE_API_TOKEN` + `GITHUB_TOKEN`** (+ `CLOUDFLARE_ACCOUNT_ID`),
  but `.env` is **git-ignored, not tracked, and has 0 commits in history** — so
  it's on-disk material only, **not a repo leak**. Severity is HIGH *as material*
  (a leaked working tree/backup = account compromise), LOW *as git exposure*.
  **Fix:** keep `.env` ignored; rotate the two tokens only if this tree was ever
  shared/backed up. (Values deliberately not reproduced in this audit.)
- Committed but LOW-risk **public identifiers** (not secrets): Cloudflare
  `account_id` and KV namespace ids in `cloud/preset-worker/wrangler.toml:4,9,14,19`
  and `deploy_worker.py:22,28`. Useless without an auth token.
- **Good hygiene:** every secret the workers consume is a runtime binding
  (`env.API_KEY`, `env.GITHUB_PAT`, `env.FREESOUND_API_KEY` in
  `preset-worker/src/index.js`), never hardcoded. No `ghp_`/`cfut_`/`Bearer <literal>`
  tokens under `cloud/`.

---

### Cross-references to T2 (not re-litigated here)
B8 (forked editor tree) → §1a · B7 (`selection_items` wipe hole) → §1b ·
preset-worker drift → §5. These are the *bug* facets; this audit quantifies the
*standards* facets of the same code.
