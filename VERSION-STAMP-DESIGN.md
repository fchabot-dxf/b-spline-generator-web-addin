# VERSION-STAMP-DESIGN — deployed-build stamp in every palette header

**Status:** DESIGN pass (E2). No code, no deploy edits. For advisor review.
**Author:** worker, turn 81.
**Goal:** every palette header shows *what is actually deployed* (git SHA + build time), so
"am I running stale code?" is a one-glance answer — the question that cost hours the day this was
filed. Ideally a ✓/⚠ vs the source repo.

---

## 1. Ground-truth map (read, not guessed — file:line anchors)

### 1a. Palette inventory — the count is **8 palettes across 7 add-ins**, not 7

The dispatch said "7 palettes"; ground truth is **8**. Two corrections the map surfaced:
- **fusion-exporter has NO palette** — it never calls `palettes.add` and ships no palette HTML. Nothing
  to stamp there (it's a command/exporter, not a UI surface). Drop it from the list.
- **CAM-builder has TWO palettes** — a main "B-spline CAM" *and* a separate "CAM Studio", distinct IDs
  and **distinct channels** (`cam-builder.py:392` vs `:458`). So CAM = 2 surfaces, not 1.

| # | Palette (display name) | Add-in | Loaded HTML | PALETTE_ID | `palettes.add` |
|---|---|---|---|---|---|
| 1 | B-Spline Generator | b-spline-gen | `b-spline-gen/html/bspline_gen_palette.html` | `fusionHybridPalette` | `b-spline-gen.py:1426` |
| 2 | Sketch Builder | frame-builder | `frame-builder/ui/html/sketch_builder_palette.html` | `frameSketchBuilderPalette` | `sketch_builder_ui.py:538` |
| 3 | Extrude Frame (solid) | frame-builder | `frame-builder/ui/html/solid_builder_palette.html` | `frameSolidBuilderPalette` | `solid_builder_ui.py:344` |
| 4 | Fusion Inspector | frame-inspector | `frame-inspector/inspector_palette.html` | `FusionInspector_Palette` | `fusion-inspector.py:595` |
| 5 | Template Maker | template-maker | `template-maker/ui/template_maker_palette.html` | `TemplateMaker_Palette` | `template-maker.py:587` |
| 6 | B-spline CAM | CAM-builder | `CAM-builder/ui/html/cam_builder_palette.html` | `CamBuilder_Palette` | `cam-builder.py:392` |
| 7 | CAM Studio | CAM-builder | `CAM-builder/ui/html/cam_studio_palette.html` | `CamStudio_Palette` | `cam-builder.py:458` |
| 8 | Stamp Editor | stamp-editor | `stamp-editor/html/index.html` | `stampEditorPalette` | `stamp-editor.py:1194` |

> Note (#1): `b-spline-gen/html/index.html` is a 7-line meta-refresh **redirect stub**
> (`index.html:4`) → the real shell is `bspline_gen_palette.html`. Not a launcher.
> Note (#8): stamp-editor loads `index.html` with a cache-bust `?v=<ms>` applied **after**
> creation via the `htmlFileURL` setter (`stamp-editor.py:1206-1211`), because `palettes.add`
> rejects a query string on first creation.

### 1b. The Python→HTML info channel — **one uniform SEND, three RECEIVE dialects**

**The SEND side is identical across all 8:** Python pushes with
`palette.sendInfoToHTML(action, jsonString)`. That is the single channel a version stamp rides.

```
  Python                                   HTML (palette)
  ------                                   -------------
  palette.sendInfoToHTML(action, json) ─────►  window.fusionJavaScriptHandler(action, data)
                                                   │
                                                   └─ dispatch keyed on `action` (3 dialects ↓)
  JS→Python (existing, reverse dir):
  adsk.fusionSendData(action, json)   ◄──────  notifyFusion()/send()/sendToPython()
```

The RECEIVE side keys off `action` everywhere, but the dispatch shape differs — this is why a
literal one-file drop-in "badge component" is *not* uniform, while the **Python injection is**:

| Dialect | Palettes | Receiver anchor |
|---|---|---|
| (a) if/elif or `_dispatchFromPython` ladder | sketch, solid, inspector, template-maker, cam-main, cam-studio | `sketch…:103/138`, `solid…:135/146`, `inspector…:196`, `template…:1250`, `cam_builder…:432`, `cam_studio…:864` |
| (b) `CustomEvent('fusionHandshake')` re-dispatch | b-spline-gen | `bspline_gen_palette.html:1171` → `main/main.js:152` |
| (c) `routes[action]` map (ES-module bridge) | stamp-editor | `main/main.js:142/147` (+ `core/runtime.js:25`) |

**SEND anchors (per palette):** `b-spline-gen.py:694`; `sketch_builder_ui.py:341`;
`solid_builder_ui.py:141`; `fusion-inspector.py:560`; `template-maker.py:451`;
`cam-builder.py:1173` (main) / `:755` (studio); `stamp-editor.py:741`.

**Open-time behaviour (matters for *when* to inject):** only **template-maker pushes at open**
(`template-maker.py:616`). The other seven are **pull-first** — the HTML, on `DOMContentLoaded`,
sends a request (`request_template_list` / `ping` / `poll` / `init` / `get_design_params`) and Python
answers. So the least-friction inject point is *"answer the existing first handshake with build_info
piggy-backed"*, not a brand-new push.

### 1c. Header slots for the badge (per palette)

| Palette | Header element | Anchor | Note |
|---|---|---|---|
| B-Spline Generator | `.cad-navbar` → `.cad-nav-version` | `bspline_gen_palette.html:260` | **A badge already exists** (`v1.1.0`, hardcoded). Repurpose it. |
| Sketch Builder | `.cad-navbar` right group / flex spacer | `sketch_builder_palette.html:53-55` | phase-stepper on the left |
| Extrude Frame | `.cad-navbar` title span "EXTRUDE FRAME" | `solid_builder_palette.html:70` | natural title slot |
| Fusion Inspector | `.cad-navbar` near `#pulse-box` | `inspector_palette.html:49-52` | |
| Template Maker | `#status-bar` (or `#settings-pill`) | `template_maker_palette.html:21` | |
| B-spline CAM | `.cad-navbar` right group near `#status-summary` | `cam_builder_palette.html:235-236` | |
| CAM Studio | `.cad-navbar` right group near `#status-summary` | `cam_studio_palette.html:153-154` | |
| Stamp Editor | `.topbar` near `<h1>` / `#statusLine` | `stamp-editor/html/index.html:31-33` | |

Six of eight already have a `.cad-navbar` header — the badge markup is near-identical for those.

### 1d. Can a palette read a local JSON at load? — **No (reliably). Python must read + inject.**

- **None** of the 8 palettes fetch a local file at load. The only `fetch()` calls hit the **remote
  Cloudflare Worker** (`bspline_gen_palette.html:23`, `cam_studio_palette.html:346`) or on-demand
  font embedding (`editor-io.js:250`) — never a local `build-info.json`.
- **No CSP `<meta http-equiv="Content-Security-Policy">` exists anywhere** in the tree (the only
  `http-equiv` is the b-spline redirect stub). So CSP is *not* the blocker.
- The real blocker is the runtime: palettes are served from `file://` inside Fusion's embedded
  Chromium (CEF), where local `fetch()` is opaque-origin / unreliable. Meanwhile a **clean, proven
  Python→HTML push channel already exists** in every palette.
- **⇒ Decision: Python reads `build-info.json` and injects the stamp via `sendInfoToHTML`.** The
  palette JS never touches the filesystem. (This also keeps the read path in ONE language — see §2b.)

---

## 2. Proposal (declare-aligned)

### 2a. The declared artifact — `build-info.json` (inert DATA the deploy writes)

A single JSON file, written by the deploy, read by consumers. Nothing computes version info at
runtime; everyone just reads this.

```json
{
  "sha":         "a2ba0f0",
  "branch":      "main",
  "built_at":    "2026-07-15T23:41:07-04:00",
  "source_root": "~/APPS/b-spline-generator-web-addin"
}
```

- **`sha` / `branch`** = `git rev-parse --short HEAD` / `git rev-parse --abbrev-ref HEAD`, run by the
  deploy on the dev machine (git is available there; the deployed palette can't run git — that's fine,
  it just reads this file).
- **`built_at`** = deploy timestamp (ISO-8601).
- **`source_root`** = the repo-root path at deploy time (same portable `~/…` form the handshake
  writers already use, `DEPLOY…py:458`). This is what makes the ✓/⚠ check possible without walking
  directories — see §2e.

**WHERE it's written — ONE file at the deployed add-in root**, not per-palette. Every sub-module is
bundled inside the single `bspline-frame-builder` add-in and deployed to one `AddIns/bspline-frame-builder/`
root, so `AddIns/bspline-frame-builder/build-info.json` is reachable by every sub-module's Python.
One inert file, N readers = the declare-aligned minimum.

**HOW it's written — as a DEST-only deploy artifact**, following the *exact* pattern the four
`_write_*_handshake()` functions already use (`DEPLOY…py:446+`): after `copy_overlay`, write the JSON
straight into `DEST_DIR`. It never lands in the source tree, so it creates zero git churn and needs no
VERIFY_FILES entry. (Alternative — write into SRC so it's copied + hash-verified — rejected: it makes
the working tree dirty on every deploy. Flagged as fork **F1** below.)

### 2b. ONE shared read path — `fb_shared/build_info.py`

Because the read happens in Python (§1d), the one helper belongs in the package every sub-module can
already import — **`fb_shared`**, the C4-consolidated shared package (single source of truth). Add:

```python
# fb_shared/build_info.py   (NEW — the ONLY place version info is read)
def read_build_info(addin_root) -> dict:
    """Return {sha, branch, built_at, source_root} from <addin_root>/build-info.json,
    or a {'sha': 'unknown', ...} sentinel if the file is absent (dev-run before deploy)."""
```

Every palette's Python calls `fb_shared.build_info.read_build_info(_addin_root)` and pushes the result
through its existing `sendInfoToHTML('build_info', …)`. No palette hand-rolls file-reading or git.
`fb_shared` is already on `sys.path` via the bootstrap, so all eight sub-modules can import it.

### 2c. How the badge reaches each header — least-wiring path

Per palette, exactly **three tiny touches**, all riding rails that already exist:

```
  (1) HTML:  add  <span class="build-badge"></span>  in the header  (§1c slot)
  (2) Py:    on the existing first-handshake reply, also
             pal.sendInfoToHTML('build_info', json.dumps(read_build_info(root)))
  (3) JS:    add one case  action === 'build_info' → badge.textContent = `${sha} · ${built_at}`
```

- **b-spline-gen is nearly free** — it already has the `.cad-nav-version` span
  (`bspline_gen_palette.html:260`); swap its hardcoded `v1.1.0` for the injected `${sha} · ${date}`.
- The **Python side is identical** for all eight (one helper + one `sendInfoToHTML` line). Only the JS
  case differs by dialect (a/b/c in §1b) — a 3-4 line addition each.

### 2d. Scope recommendation

**Land the substrate now; wire palettes in waves.** The expensive-to-get-right part is the shared
substrate (build-info.json + the deploy writer + `fb_shared/build_info.py`); the per-palette badge is
cheap, repeatable wiring.

1. **Substrate** (one slice): deploy writes `build-info.json` + `fb_shared/build_info.py`. Inert, ships
   nothing visible yet.
2. **Key palettes first**: b-spline-gen (badge already there), + the two frame-builder palettes
   (sketch/solid — the surfaces whose stale deploy cost the hours behind this feature).
3. **Follow-up wave**: inspector, template-maker, CAM ×2, stamp-editor — mechanical repeats.

Rationale: proves the substrate end-to-end on 2-3 palettes before fanning out to eight, and each wave
is independently shippable.

### 2e. ✓/⚠-vs-repo indicator — **feasible, Python-side, with caveats**

The plain badge (§2a-c) shows *what was deployed*. The ✓/⚠ answers the sharper question: *is the
deployed code the current source HEAD?* Feasible **without a git binary**, using pure file reads the
deployed Python can do:

```
  read build-info.json.sha            (the SHA baked at deploy)
  read <source_root>/.git/HEAD        (source_root comes from build-info.json, §2a)
     ├─ "ref: refs/heads/main"  → read .git/refs/heads/main  (or .git/packed-refs)  → HEAD_SHA
     └─ (detached) 40-hex           → HEAD_SHA
  compare  deployed.sha  vs  HEAD_SHA[:7]
     equal    → ✓  "up to date (main a2ba0f0)"
     differ   → ⚠  "STALE — deployed a2ba0f0, source now b3c1d92"
  git absent / not on dev machine → hide the ✓/⚠, show plain badge only
```

This reuses infrastructure that **already exists**: the deploy already records the source path (the
`project_path.json` handshakes, `DEPLOY…py:463`); §2a just promotes it into `build-info.json` at the
repo-root level so the `.git` dir is directly reachable. The helper lives beside `read_build_info` in
`fb_shared/build_info.py` and is injected the same way.

**Caveats (must be stated on the badge / in scope):**
- It compares **deployed vs committed HEAD** — it does *not* detect uncommitted working-tree edits.
  "✓ up to date" means "matches the last commit," not "matches your unsaved editor buffer."
- It's **dev-machine-only** — it relies on the source `.git` being present at `source_root`. If this
  add-in is ever run on a machine without the repo, the check degrades gracefully to the plain badge.

---

## 3. GATED FORKS — decisions for the advisor

These are real forks; I've recommended one each but am **not** implementing until you synthesize.

**F1 — `build-info.json` location**
- **A (recommended):** DEST-only deploy artifact (mirrors the `_write_*_handshake` writers; zero
  source churn; no VERIFY_FILES entry).
- **B:** write into SRC so `copy_overlay` copies it and the verify loop hash-checks it — but every
  deploy dirties the working tree with a new SHA/timestamp.

**F2 — ✓/⚠-vs-repo scope** (the main design fork)
- **A:** plain badge only (`sha · built_at`). Simplest. Already answers a lot: after a redeploy +
  Stop→Start, a *changed* timestamp confirms the deploy landed (directly counters the E1 stale-deploy
  bug); an *unchanged* one exposes it. No source comparison.
- **B (recommended):** A + live ✓/⚠ vs committed source HEAD (§2e). Delivers the actual "am I stale?"
  glance with pure file reads; dev-only + committed-HEAD caveats accepted.
- **C:** B + working-tree-dirty detection (hash the VERIFY_FILES set in source vs deployed, or
  `git status --porcelain` at open). Most accurate ("running exactly what's in my editor") but heavier
  and needs git or a hash sweep on every palette open.

**F3 — rollout scope**
- **Recommended:** substrate now → key palettes (b-spline-gen + frame-builder ×2) → follow-up wave for
  the rest (§2d), each wave independently shippable.
- **Alt:** all 8 in one slice (more diff at once; the 3 JS dialects mean 8 receiver edits together).

**Non-forks (proposed as settled unless you object):** Python-read-+-inject over browser fetch (§1d);
one `build-info.json` at the add-in root, not per-palette (§2a); the single `fb_shared/build_info.py`
read path (§2b); `sendInfoToHTML('build_info', …)` piggy-backed on each palette's existing first
handshake (§2c).

---

*No application code, deploy code, or palette HTML was modified in this pass — design only.*
