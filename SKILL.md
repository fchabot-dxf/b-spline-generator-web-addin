# Symmetric B-Spline Generator Skill

## Purpose
Create a Copilot skill for this repository to guide future agent workflows, help with development tasks, and ensure consistent deployment and logging practices.

## Repository Overview
- Procedural terrain/solid generation add-in for Fusion 360.
- Web palette at `symmetric-b-spline-gen/html` (JS/HTML) communicating with Python backend at `symmetric-b-spline-gen/symmetric-b-spline-gen.py`.
- Chunked STEP generation and bridge polling loop for reliable imports.
- Fusion command registered as `fusionHybridCommand` and integrated in Solid workspace toolbar panel.

- `symmetric-b-spline-gen/html/index.html` and `main.js`: UI, palette event loop, control inputs, and reset/visibility logic.
- `symmetric-b-spline-gen/html/editor.js`: SVG editor state, zoom/pan transform enforcement, and stamp clear sync.
- **Physical CAD Parity**: The Vector Editor uses a **1:1 physical inch coordinate system** (via `viewBox="0 0 W H"`) to ensure absolute parity with Fusion 360's `ImportManager`. The Python backend applies a direct `2.54` scale factor to convert these inch-native coordinates into machine-standard centimeters.
- **Orientation Control**: Camera orientation is handled exclusively by the 3D **ViewCube** widget in the top-right corner. All redundant minimap UI has been removed for a cleaner workspace.
- `stepWriter.js`: AP214 STEP exporter with chunked payload logic and isSolid/isPreview modes.
- **Terrain Stamping Refinements**: High-fidelity SVG stamping with **G1-continuous Fillet** and **Tapered Suppression Masking** for seamless mountain-to-feature transitions.
- **Actual Height Display**: Real-time "Actual Peak (Z)" calculation in the preview overlay ensure model/stock parity.
- `symmetric-b-spline-gen/symmetric-b-spline-gen.py`: Fusion 360 palette handler, chunked STEP reassembly, importToTarget/preview mesh, cleanup, and command lifecycle.
- `symmetric-b-spline-gen/symmetric-b-spline-gen.manifest`: Add-in metadata, version, OS support, and edit mode.
- `tools/deploy_cloudflare.py`: builds deploy_dist, copies web assets, zip package, refreshes local Fusion Add-in, and deploys Cloudflare Pages via Wrangler.
- `dev-log.md`: development log, issue history, architecture notes, logging and workspace linking rules.
- `package.json`: local web server scripts (`start`/`serve`) and project metadata.

## Runtime Behavior
- Python side uses hardcoded `LOG_FILE` in `symmetric-b-spline-gen.py`; recommended to replace with a dynamic workspace-aware path (via `workspace_link.json`) to avoid user path dependency.
- Palette messaging in `symmetric-b-spline-gen.py`:
  - `check_import_status` polling to close palette after import.
  - `generate_start`/`generate_chunk`/`generate_finish` chunked receive.
  - `preview_mesh` draws CustomGraphics mesh in Fusion canvas; normals are computed from vertices/indices and passed in to enable reflection-based material shading.
  - Current preview material values: `ambient=0.00`, `diffuse=0.30`, `specular=1.00`, `roughness=2.0`, `mesh.color` alpha=43.
  - Logging path is now portable using `get_log_path()` (workspace_link.json fallback to temp dir, no hardcoded path).
  - `ok`/`cancel` actions manage occurrence cleanup and visibility.
  - `ping`/`log` for health and JS diagnostics.
  - **Orientation-Aware Projection**: Standardized on a **Orientation-Aware Face Selection** system. The add-in dynamically identifies the terrain's "top surface" by searching for the maximum coordinate on the active orientation axis (Y for `y-up`, Z for `z-up`), ensuring artwork projects correctly regardless of model setup.

## Deployment
- `tools/deploy_cloudflare.py` expects `.env` with `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, optional `CLOUDFLARE_PROJECT`.
- Requires `wrangler` CLI (npm package). If missing, prompts `npm install -g wrangler`.
- Deploy steps:
  1. `python tools/deploy_cloudflare.py` or `python __delete__deploy_hybrid.py` if kept.
  2. Ensure asset copy path and deployment output in `tools/deploy_dist`.
  3. For local Fusion dev, script attempts to refresh in `%APPDATA%/Autodesk Fusion 360/API/AddIns/b-spline-generator-web-addin` (Win) or similar on mac.

## Logging and Debug
- Primary log file: `symmetric_b_spline_gen_log.txt` in repository root (per `dev-log.md` and `symmetric-b-spline-gen.py`).
- JS logs are tunneled to Python via palette `log` events.
- Error conditions explicitly handled:
  - empty `stepText` with user message and import_done signal safety
  - missing design target
  - importToTarget fallback to importToNewDocument
  - palette closed cleanup uses `PaletteClosedHandler` to remove ghost mesh.

## Troubleshooting Checklist
- [ ] Clear `__pycache__`, bump manifest version (especially after file path/name changes).
- [ ] Verify UI refresh: `visibilitychange` listener in `main.js` to avoid stale state.
- [ ] Verify 8 noise modes exist in `index.html` dropdown.
- [ ] Check `stepWriter.js` doesn’t prematurely abort surface-only offsets.
- [ ] Confirm no 2.54 unit mismatch (STEP output should use inches if header says inch).
- [ ] Confirm multi-body import renaming in `symmetric-b-spline-gen.py` (added for each new occurrence).

## Recommended Agent Guidance
- Map user issues to code areas:
  - `UI/JS` → `symmetric-b-spline-gen/html/` and `stepWriter.js`
  - `Python bridge import` → `symmetric-b-spline-gen/symmetric-b-spline-gen.py`
  - `deployment` → `tools/deploy_cloudflare.py` + `.env` + `wrangler`
  - `logging` → `dev-log.md` + `LOG_FILE` path and `workspace_link.json`
- When checking fix status, inspect:
  - `symmetric_b_spline_gen_log.txt` latest timestamp
  - Fusion palette logs (via built-in message boxes and log events)
  - Cloudflare deploy output (wrangler logs)
- **Debugging Philosophy**: When troubleshooting complex issues (like coordinate sync or bridge stalls), always provide **fixes and new debugging logs simultaneously**. This "breadcrumb" approach allows for faster iteration if the first fix reveals a secondary issue.

## Notes
- Avoid hardcoded absolute paths in production (move from `LOG_FILE` to workspace-based path in `symmetric-b-spline-gen.py`).
- Keep assets / front-end only files under `symmetric-b-spline-gen/html` and .py / .manifest in root addin folder.

## 2026-03-28 - Machinist's Logic & Responsive UI
* **1:1 CAD-Lite Syncing:** Ability to bridge web-based vector editors with physical machining constraints by standardizing DPI (96) and units (Inches) to bypass common importer scaling bugs in Fusion 360. Ensures exported SVGs are always fabrication-ready.
* **Dynamic Visual Context Injection:** Technique for serializing high-fidelity 3D WebGL renders into 2D SVG backgrounds, providing live-surface feedback for generative art placement and precise feature alignment.
* **Responsive CNC Interfaces:** Advanced use of the `visualViewport` API and MutationObserver to manage complex CAD modals on small screens, ensuring fabrication tools remain usable and accessible in real-world shop environments.

## 2026-03-29 - Orientation-Fluid Bridge Engineering
* **Orientation-Aware Projection:** Ability to dynamically determine model surfaces based on session orientation, ensuring 2D vector artwork lands on intended 3D faces regardless of world-up settings.
* **Deterministic Coordinate Calibration:** Using temporary 'calibration anchors' in exported files to mathematically synchronize disparate coordinate spaces. This technique allows for 100% accurate physical scaling in CAD (bypassing 96 DPI errors) by measuring observed results at runtime and applying corrective linear transforms.
* **XML Sanitization Pipeline:** Advanced regex-based attribute stripping logic to bridge web-native SVG objects (SVG.js) with strict XML/CAD importers (Fusion 360).
* **Positive Determinant Matrix Construction:** Technique for reconciling Y-down (Web) and Y-up (CAD) coordinate systems by using raw `setCell` assignments to construct a 180-degree rotation (det > 0) instead of a reflection (det < 0), ensuring absolute compatibility with restrictive CAD `move()` operations.
* **Variable-Driven Parametric Sync**: Ability to synchronize web-based generator state (`widthIn`, `heightIn`) directly to Fusion 360 **User Parameters**. This enables automated mapping of imported frames and enclosures to the exact dimensions of the generative art, ensuring 1:1 parametric alignment.
