# Symmetric B-Spline Generator Skill

## Purpose
Expert guidance for the Symmetric B-Spline Generator add-in. Use when modifying the web-palette (HTML/JS), the STEP export logic, or the Python bridge for procedural terrain and solid generation.

## Repository Overview
- Procedural terrain/solid generation add-in for Fusion 360.
- Web palette at `b-spline-gen/html` (JS/HTML) communicating with Python backend at `b-spline-gen/b-spline-gen.py`.
- Chunked STEP generation and bridge polling loop for reliable imports.
- Fusion command registered as `fusionHybridCommand` and integrated in Solid workspace toolbar panel.

- `b-spline-gen/html/index.html` and `main.js`: UI, palette event loop, control inputs, and reset/visibility logic.
- `b-spline-gen/html/editor.js`: SVG editor state, zoom/pan transform enforcement, and stamp clear sync.
- **Physical CAD Parity**: The Vector Editor uses a **1:1 physical inch coordinate system** (via `viewBox="0 0 W H"`) to ensure absolute parity with Fusion 360's `ImportManager`. The Python backend applies a direct `2.54` scale factor to convert these inch-native coordinates into machine-standard centimeters.
- **Orientation Control**: Camera orientation is handled exclusively by the 3D **ViewCube** widget in the top-right corner. All redundant minimap UI has been removed for a cleaner workspace.
- `stepWriter.js`: AP214 STEP exporter with chunked payload logic and isSolid/isPreview modes.
- **Terrain Stamping Refinements**: High-fidelity SVG stamping with **G1-continuous Fillet** and **Tapered Suppression Masking** for seamless mountain-to-feature transitions.
- **Actual Height Display**: Real-time "Actual Peak (Z)" calculation in the preview overlay ensure model/stock parity.
- `b-spline-gen/b-spline-gen.py`: Fusion 360 palette handler, chunked STEP reassembly, importToTarget/preview mesh, cleanup, and command lifecycle.
- `b-spline-gen/b-spline-gen.manifest`: Add-in metadata, version, OS support, and edit mode.

## Runtime Behavior
- Python side uses hardcoded `LOG_FILE` in `b-spline-gen.py`; recommended to replace with a dynamic workspace-aware path (via `workspace_link.json`) to avoid user path dependency.
- Palette messaging in `b-spline-gen.py`:
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
  1. `python tools/deploy_cloudflare.py`
  2. Ensure asset copy path and deployment output in `tools/deploy_dist`.
  3. For local Fusion dev, script attempts to refresh in `%APPDATA%/Autodesk Fusion 360/API/AddIns/b-spline-generator-web-addin`.

## Logging and Debug
- Primary log file: `b_spline_gen_log.txt` in repository root.
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
- [ ] Confirm multi-body import renaming in `b-spline-gen.py` (added for each new occurrence).

## Recommended Agent Guidance
- Map user issues to code areas:
  - `UI/JS` → `b-spline-gen/html/` and `stepWriter.js`
  - `Python bridge import` → `b-spline-gen/b-spline-gen.py`
  - `deployment` → `tools/deploy_cloudflare.py`
  - `logging` → `dev-log.md` + `LOG_FILE` path and `workspace_link.json`
- **Debugging Philosophy**: When troubleshooting complex issues (like coordinate sync or bridge stalls), always provide **fixes and new debugging logs simultaneously**.

## Key Techniques
* **1:1 CAD-Lite Syncing:** Standardize DPI (96) and units (Inches) to bypass common importer scaling bugs in Fusion 360.
* **Orientation-Aware Projection:** Dynamically determine model surfaces based on session orientation.
* **Positive Determinant Matrix Construction:** Reconcile Y-down (Web) and Y-up (CAD) using raw `setCell` assignments for a 180-degree rotation (det > 0).
* **Variable-Driven Parametric Sync**: Synchronize web state (`widthIn`, `heightIn`) directly to Fusion 360 **User Parameters**.
