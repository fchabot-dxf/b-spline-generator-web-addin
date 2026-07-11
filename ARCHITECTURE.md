# ARCHITECTURE — b-spline-generator-web-addin

> Ground-truth orientation for the hybrid app. Written from source (not the
> READMEs, which are stale — see *Doc drift* at the end). Cited as `file:line`.
> Scope: what the pieces are and where the **seams** are. Two seams carry the
> whole design and are where principle violations will surface: the
> **fusion-bridge contract** (§1.3) and the **hot-reload lifecycle** (§2).

## The app in one line

One `b-spline-gen` frontend runs in **two hosts** — a Fusion 360 palette and a
deployed website — consolidated with six sibling palettes under **one
hot-reloading Fusion add-in**, backed by Cloudflare workers.

```
                       ONE FRONTEND (b-spline-gen/html/, ES modules, no build step)
                       core/  editor/  main/  fonts/  + ../styles/
                                    │
                 ┌──────────────────┴───────────────────┐
                 │  runs in TWO hosts, SAME source       │
                 ▼                                        ▼
   ┌─────────────────────────────┐          ┌──────────────────────────────┐
   │ HOST A: FUSION 360 PALETTE  │          │ HOST B: WEBSITE (Cloudflare) │
   │ b-spline-gen.py adds palette│          │ dist/ = filtered COPY of     │
   │ JS ⇄ Python via adsk bridge │          │ html/ + styles/ → Pages      │
   │ core/fusion-bridge.js  ◄────┼──SEAM────┼─►  adsk undefined → web mode │
   │ export → "Send to Fusion"   │          │  export → browser STEP dl    │
   └─────────────────────────────┘          └──────────────────────────────┘
                 ▲
                 │ registered + hot-reloaded by
   ┌─────────────┴────────────────────────────────────────────────────────┐
   │ PARENT ADD-IN  bspline-frame-builder.py  (single Fusion entry)        │
   │ run()→_bootstrap() reloads every sub-.py from disk each Stop→Start    │
   │ shared toolbar panel 'bsplinePanel' on Solid / Sketch / Milling tabs  │
   │ folds 6 formerly-standalone add-ins into ONE Add-Ins entry            │
   │   parent-owned: b-spline-gen · Sketch Builder · Extrude Frame         │
   │   self-driven : frame-inspector · fusion-exporter · template-maker    │
   │                 · cam-builder (2 palettes) · stamp-editor             │
   └──────────────────────────────────────────────────────────────────────┘
                 │
                 ▼ cross-device persistence + file store
   Cloudflare: preset-worker (KV, LIVE) · step-editor-worker (KV, unprovisioned)
               · step-editor-pages (README-only)
```

---

## 1. The hybrid main app (`b-spline-gen`)

A procedural B-Spline surface/solid generator: noise heightmap → curvature-aware
thicken → SVG/text stamp displacement → STEP export. The 3D preview is Three.js
in a `<canvas>`. All application logic is **plain ES modules** with **no build
/ bundler step** — the same files are served to both hosts verbatim.

### 1.1 Frontend layout (`bspline-frame-builder/b-spline-gen/html/`)

| Dir | Role |
|-----|------|
| `main/` | composition root. `main.js` boots preview, wires modules, then does host detection (`main/main.js:100`). |
| `core/` | shared engine: `terrain.js`, `noise/`, `sculpt*.js`, `thicken.js`, `stamp/`, `stepWriter.js` (AP214 STEP in-browser), `preview.js` (Three.js), `state.js`, **`fusion-bridge.js`** (the seam). |
| `editor/` | fullscreen SVG stencil editor (Pen/Rect/Circle, opentype.js text). |
| `styles/` | **not here** — shared CSS lives at `bspline-frame-builder/styles/` (sibling of `b-spline-gen/`), referenced as `../../styles/` and flattened at deploy. |

Entry `html/index.html` is just a meta-refresh to `bspline_gen_palette.html`
(`b-spline-gen/html/index.html:4`); the palette HTML is the real page.

### 1.2 Host A — the Fusion palette

`b-spline-gen/b-spline-gen.py` registers the palette:

- Constants: `PALETTE_ID='fusionHybridPalette'`, `PALETTE_NAME='Symmetric B-Spline Gen'`, `PALETTE_HTML='html/bspline_gen_palette.html'` (`b-spline-gen.py:135-137`).
- `CommandExecuteHandler.notify` creates the palette (`palettes.add(...)`, `b-spline-gen.py:1447`), docks it right, and wires `palette.incomingFromHTML.add(PaletteHTMLEventHandler())` (`:1453`) — that subscription **is** the inbound side of the bridge.
- Top-level `run()`/`stop()` exist (`b-spline-gen.py:1501/1585`) so it *can* load as its own add-in, but under the unified add-in the **parent** owns its command (see §2).

### 1.3 THE FUSION-BRIDGE SEAM CONTRACT ⚠️ (invariant)

**Invariant:** host-specific behaviour lives ONLY in `core/fusion-bridge.js`;
everything else in `core/`/`main/` is host-agnostic. The seam has three parts —
mode detection, an outbound channel, and an inbound channel.

**Mode detection** — `pollMode(onFusionReady, onWebMode)` (`fusion-bridge.js:114`)
probes `typeof adsk !== 'undefined' && adsk.fusionSendData` up to 3× at 100 ms
(`:118-131`). Present → `setIsFusionMode(true)` → Fusion path; absent → web path.
`main.js` supplies the two callbacks (`onFusionDetected`/`onWebDetected`,
`main/main.js:112/144`): Fusion mode adds `body.fusion-mode`, relabels export to
"Send to Fusion", asks Python for board size; web mode relabels export to "STEP"
(browser download). **This is the ONE place host behaviour legitimately forks.**

**Outbound — JS → Python** via `adsk.fusionSendData(action, data)`. Dispatched
Python-side by `PaletteHTMLEventHandler.notify` (`b-spline-gen.py:666`):

| action | payload | meaning |
|--------|---------|---------|
| `log` | `{msg}` | tunnel a JS log line into the Python log (`fusLog`, `fusion-bridge.js:14`) |
| `preview_mesh` | mesh JSON | live top-view mesh preview (`fusion-bridge.js:21`) |
| `preview` | mesh JSON | high-fidelity preview before export (`:41`) |
| `generate_start` | `{totalChunks}` | begin chunked STEP transfer (`:62`) |
| `generate_chunk` | `{index,data}` | one **256 KB** chunk (`CHUNK_SIZE`, `:57`) |
| `generate_finish` | `{}` | reassemble chunks → temp file → import (`:69`, `b-spline-gen.py:739`) |
| `check_import_status` | `{}` | poll heartbeat every 5 s until import done (`:98`, `b-spline-gen.py:689`) |
| `ping` | `{}` | connectivity check → `pong` (`b-spline-gen.py:703`) |
| `get_design_params` | `{}` | request active design's board size (`main.js:136`) |
| `reset_ui` | `{}` | clear chunk buffer / state (`b-spline-gen.py:719`) |
| `generate` / `ok` / `cancel` | — | wizard finalize / cancel paths (`b-spline-gen.py:753/848/856`) |

Chunking exists to bypass Fusion's ~2 MB HTML-bridge payload limit; large STEP
files stream in 256 KB pieces and Python reassembles.

**Inbound — Python → JS** via `pal.sendInfoToHTML(action, data)`. Fusion calls
`window.fusionJavaScriptHandler.handle(action,data)` (`bspline_gen_palette.html:1125`),
which re-broadcasts as a `CustomEvent('fusionHandshake')` (`:1121`) so ES modules
can `addEventListener`. Handled in `main.js:handleFusionHandshake` (`:152`):

| action | meaning |
|--------|---------|
| `import_ready` | import finished → stop polling, re-enable OK, palette hides (`b-spline-gen.py:696`) |
| `import_progress` | progress message during import (`b-spline-gen.py:181`) |
| `import_success` | import succeeded (`b-spline-gen.py:1312`) |
| `sync_board` | push design `{widthIn,heightIn}` into the UI via `applyParam` (`b-spline-gen.py:715`, `main.js:165`) |
| `pong` | reply to `ping` |
| `reset_ui` | reset palette state on re-open (`b-spline-gen.py:1468`) |

### 1.4 Host B — the website (standalone)

`deploy_cloudflare.py` walks `source_dir = b-spline-gen/html/` and **copies**
web assets (`.html/.js/.css/.svg/.png/...`) plus the shared `styles/` into a
build folder (`deploy_cloudflare.py:148,175-185`) — a **filtered file-copy, not a
compiled bundle**. `--build-only` writes it to `dist/` (`:154,213`); otherwise it
`wrangler pages deploy`s a timestamped folder to Pages project
`symmetric-b-spline-gen` (`:296`). `dist/` on disk mirrors `html/` exactly
(`bspline_gen_palette.html` + `core/ editor/ fonts/ main/ styles/`).

**How the same code runs with no Fusion host:** `adsk` is undefined, so
`pollMode` falls to web mode; every bridge sender early-returns
(`if (!isFusionMode || !preview) return`, `fusion-bridge.js:22,42`) or is simply
never invoked. Export routes to an in-browser STEP download (`stepWriter.js` +
FileSaver) instead of Send-to-Fusion. No Python, no `adsk`, same UI.

---

## 2. The parent add-in — HOT-RELOAD LIFECYCLE CONTRACT ⚠️ (invariant)

`bspline-frame-builder/bspline-frame-builder.py` is the **single** Fusion
Add-Ins entry. Its whole reason to exist: **every Stop→Start reloads the latest
`.py` from disk**, so code edits take effect without restarting Fusion.

```
 Fusion "Start"                         Fusion "Stop"
      │                                      │
      ▼                                      ▼
   run()                                  stop()
    ├─ _register_refresh_event()  once/    ├─ _teardown_submodules()
    │    per session (idempotent)          │    ├─ remove documentActivated sub
    ├─ _bootstrap()   ◄── the hot-reload   │    ├─ clear each .handlers list
    │    ├─ _force_wipe([...])  del from    │    ├─ _bs.stop() (closes palette)
    │    │    sys.modules so import         │    └─ each sub .stop() in REVERSE
    │    │    re-execs file from disk       │        run order
    │    ├─ load engine + UI submodules     ├─ delete 'bsplinePanel_*' panels
    │    │    via _load_submodule()         ├─ delete our commandDefinitions
    │    └─ inject fresh engine into        └─ delete leftover palettes
    │         both frame-builder palettes        (incl. legacy IDs)
    ├─ register 3 parent commands + panel   finally: handlers.clear()
    └─ call each sub-module's own run()

 Deferred refresh: any palette → app.fireCustomEvent('BsFb_DeferredRefresh')
   → _DeferredRefreshHandler.notify() → stop(None); run(None)   (self-reload)
   Hidden cmd 'bsplineFbReloadCommand' fires the same event (keyboard shortcut).
```

**Key mechanisms (all in `bspline-frame-builder.py`):**

- `sys.dont_write_bytecode = True` (`:23`) — no `__pycache__`, so reloads always
  see fresh source.
- `_force_wipe(names)` (`:82`) — deletes a module **and its sub-packages**
  (`name + '.'`) from `sys.modules` so the next import re-executes from disk.
- `_load_submodule(safe_name, subdir, filename)` (`:99`) — loads a `.py` from a
  **hyphenated** directory (not import-legal) under a safe alias via
  `importlib.util.spec_from_file_location`, inserting the subdir on `sys.path`.
- `_bootstrap()` (`:172`) — recreates the logger and frame engine, wipes cached
  UI state, then loads all sub-modules fresh. Loaded module refs live in
  module-level globals (`_bs, _fb_sketch, _fb_solid, _engine, _tm, _fi, _fe,
  _cam, _st`, `:28-37`).
- `_teardown_submodules()` (`:298`) — the reverse: **explicitly** removes the
  Sketch Builder's `app.documentActivated` subscription (`:315`), clears each
  module's `handlers` list, and calls each sub's `stop()` in **reverse** run
  order so late-bound palettes/handlers release before earlier commands.
- The refresh `CustomEvent` is registered **once per session** and intentionally
  **NOT** unregistered in `stop()` (`:651`), so a hot-reload still works after a
  crash mid-`run()`.

**Two categories of consolidated module** (this distinction matters):

| Category | Modules | How wired |
|----------|---------|-----------|
| **Parent-owned** | b-spline-gen, Sketch Builder, Extrude Frame | Parent registers their commands from the `COMMANDS` table (`:482-504`) using `_bs.CommandCreatedHandler()` etc., and places their buttons. Teardown calls `_bs.stop()` and clears the two frame-builder `handlers` lists. The two frame-builder UI modules have **no** top-level `run/stop` — they expose `run_palette()` + `CommandCreatedHandler` and are host-driven. |
| **Self-driven** | frame-inspector, fusion-exporter, template-maker, cam-builder, stamp-editor | Parent calls each module's own `run(context)` (`:625-638`) / `stop(None)` (`:351-364`). Each registers its own command + button into the shared panel. Failures are isolated per-module (try/except around each). |

**Shared toolbar panel:** `PANEL_ID='bsplinePanel'` (`:43`), created per-tab as
`f"{PANEL_ID}_{tab.id}"` titled "B-Spline Builder" on `SolidTab`, `SketchTab`,
`MillingTab` (`:545-585`). Self-driven modules find it by
`panel.id.startswith('bsplinePanel')`.

**Isolation gotcha the code handles (Principle 3):** `frame-inspector` and
`template-maker` each ship their **own copies** of shared-name modules
(`expression_coords.py`, `entity_helpers.py`, …). Without intervention a second
sub-module would bind to the first's cached copy. `_bootstrap()` therefore
`_force_wipe`s `_shared_project_names` (`:243-252`) **before each** self-driven
load, so each sub's top-level imports resolve from its own folder. cam-builder
similarly gets `cam_engine/cam_utils` wiped (`:276`).

---

## 3. Sibling palettes (each folded into the one add-in)

All paths under `bspline-frame-builder/`.

- **frame-builder — Sketch Builder** (`frame-builder/ui/sketch_builder_ui.py`):
  template selection + parameter authoring that builds a parametric skeleton
  **sketch** from a template, auto-closing after a successful build. Palette
  `frameSketchBuilderPalette`, HTML `html/sketch_builder_palette.html`; host
  button `frameSketchBuilderCommand`.
- **frame-builder — Extrude Frame** (`frame-builder/ui/solid_builder_ui.py`):
  face selection + extrusion of the frame outline **onto a target face**,
  auto-closing after extrude. Palette `frameSolidBuilderPalette`, HTML
  `html/solid_builder_palette.html`; host button `frameSolidBuilderCommand`.
  Both share the engine `frame-builder/fb_engine/frame_engine.py` (template
  discovery/resolution), which the parent loads once and injects into each.
- **frame-inspector** (`frame-inspector/fusion-inspector.py`): a selection-driven
  inspector — watches the selection, reads `FrameBuilder` metadata attributes off
  entities, and pushes a payload to its palette. `FusionInspector_Palette` /
  `FusionInspector_Command`, HTML `inspector_palette.html`. Ships its own
  `expression_coords.py` / `entity_helpers.py` / `payload_builder.py`.
- **fusion-exporter** (`fusion-exporter/fusion-exporter.py`): **not** a webview —
  a single command (`FusionExportCommand`) that audits and exports design data to
  "DNA JSON" via `exporter.export_data_logic`. Uses a command dialog + resources
  icon, adds its button to the shared panel.
- **template-maker** (`template-maker/template-maker.py`): selection-driven code
  preview that generates template phase-file **code** from the current selection
  (for authoring new frame templates). Has its own hot-reload machinery
  (`TemplateMaker_DeferredRefresh` event + reload command). `TemplateMaker_Palette`
  / `TemplateMaker_Command`. Ships its own `core/expression_coords.py` /
  `core/entity_helpers.py` (distinct copies from frame-inspector's) + a large
  `core/` generator package.
- **cam-builder — "CAM Studio"** (`CAM-builder/cam-builder.py`): scaffolds
  Manufacturing Models + Setups in the Manufacture workspace, with a read-only
  Preview dry-run classifier and viewport WCS axis picking. **Two palettes:**
  *B-spline CAM* (`CamBuilder_Command`/`CamBuilder_Palette`,
  `ui/html/cam_builder_palette.html`) builds the fixed 3-MM/4-Setup B-spline
  frame; *CAM Studio* (`CamStudio_Command`/`CamStudio_Palette`,
  `ui/html/cam_studio_palette.html`) is generic profile-driven (one MM+Setup per
  component). Ships `cam_engine/` + `cam_utils/` packages.
- **stamp-editor** (`stamp-editor/stamp-editor.py`): surface-deformation stamping
  via SVG/text/freehand motifs through b-spline-gen's rasterize → SDF →
  modulate-control-points pipeline. HTML owns the UI; Python tunnels logging and
  drives face-picking + STEP import/export. `stampEditorPalette`, HTML
  `html/index.html`. Marked a v1 scaffold.

---

## 4. The `cloud/` side (Cloudflare)

- **`cloud/preset-worker/`** — **LIVE.** A Cloudflare Worker (ES module
  `src/index.js`) acting as a unified KV-backed project/preset store shared by
  several apps. Three KV namespaces: `PRESETS` (name-keyed, open), `PENPLOTTER`
  (UUID-keyed, `X-API-Key`), `LOADER_APPS` (`wrangler.toml:7-19`). The frontend
  reaches it at `https://projects-dansemur.dansemur.workers.dev` (set as
  `window.BSPLINE_PRESETS_API_URL`, `bspline_gen_palette.html:23`); CAM Studio
  uses the same URL. ⚠️ **Identity is inconsistent** across sources — config name
  `projects-dansemur`, npm package `bspline-preset-worker`, REST-deploy target
  `bspline-presets` — the two deploy paths would create differently-named scripts.
- **`cloud/step-editor-worker/`** — a self-contained Worker (`step-editor-files`)
  that stores/serves STEP `.stp` files (`GET/PUT/DELETE /files/:name`, validates
  the `ISO-10303-21;` header). ⚠️ **Unprovisioned** — its `STEP_FILES` KV ids are
  still `REPLACE_AFTER_KV_CREATE` placeholders (`wrangler.toml:9-12`), so not yet
  deployed.
- **`cloud/step-editor-pages/`** — **README-only.** Intended as a Pages site
  (`step-editor.pages.dev`) serving the step-editor UI, but the folder contains
  only `README.md`; the `deploy.cmd` and `step-editor/html/` source it references
  don't exist. Planned, not materialized.

**Deploy scripts:**

| Script | What it does |
|--------|--------------|
| `bspline-frame-builder/deploy_cloudflare.py` | Builds the web app (copy `html/`+`styles/` → `dist/`) and `wrangler pages deploy`s it to Pages project `symmetric-b-spline-gen`; also zips the add-in and uploads to the GitHub `latest` release. `--build-only` just emits `dist/` (used by the Pages build container). |
| `bspline-frame-builder/deploy_worker.py` | Deploys the preset Worker via the Cloudflare **REST API** (no wrangler), pushing `preset-worker/src/index.js` as script `bspline-presets` with the `PRESETS` binding. |
| `run_deploy.py` (root) | Thin PATH-fixing wrapper that shells to `deploy_cloudflare.py`, logging to `deploy_log.txt`. |
| `release.py` (root) | Local release orchestrator: build add-in ZIP → `git add/commit/push` (push to main triggers Pages auto-rebuild of the web app) → `gh release upload latest` → refresh the local Fusion AddIns folder. |

---

## 5. External transport (note only — do NOT chase)

The shelved "Post & Send" plan targets a **DDCS bridge gateway** at
`localhost:8765` that lives in a **separate repo (DDCS Studio)** and is currently
**offline**. It is external to this repo; nothing here depends on it at runtime.
See `SEND-TO-CONTROLLER.md` for that (shelved) plan.

---

## Doc drift (verify against source, not prose)

- `b-spline-gen/README.md` references `fusion-hybrid.py` and `deploy_hybrid.py`
  (neither exists; the real entry is `b-spline-gen.py`, deploy is
  `deploy_cloudflare.py`/`DEPLOY_bspline-frame-builder.py`) and says STEP chunks
  are "100KB" — the code uses **256 KB** (`fusion-bridge.js:57`).
- The top-level `README.md` and `SESSION_CONTEXT_*.md` predate the unified add-in
  consolidation. Treat this file (`ARCHITECTURE.md`) and the source as canonical.
