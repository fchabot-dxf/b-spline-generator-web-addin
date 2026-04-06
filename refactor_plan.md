# main.js Modular Refactoring & Folder Cleanup Plan

The `main.js` file is currently a "god object" of nearly 3,000 lines. This plan outlines its decomposition into specialized ES modules and a reorganization of the project structure to reduce clutter.

## Proposed Module & Folder Structure

To "clean up" the workspace, we will move the new modules into a dedicated subdirectory.

### 1. Web Addin Reorganization
- **`symmetric-b-spline-gen/html/js/`**: All new ES modules will live here.
- **`symmetric-b-spline-gen/html/assets/`**: Icons and static assets.
- **`symmetric-b-spline-gen/html/index.html`**: Root entry remains clean.

### 2. Module Breakdown (moved to `html/js/`)
- **`state.js`**: Parameters, deltas, and session persistence.
- **`history.js`**: Global undo/redo and snapshot system.
- **`ui-utils.js`**: DOM binding and sync utilities.
- **`sculpt-logic.js`**: High-level sculpting interaction.
- **`stamp-logic.js`**: Rasterization and SVG layer processing.
- **`engine.js`**: Rebuild loop and update coordination.
- **`fusion-bridge.js`**: All Python-side communication.
- **`export-service.js`**: Export Wizard and STEP generation.

### 3. Root Directory Cleanup
I propose moving the following "stray" files to a new `workspace-assets/` or `backups/` folder to declutter the root:
- `Source.dxf`
- `bounding-box.dxf`
- `stamp_7x9 (2).svg`
- `symmetric_b_spline_gen_log.txt` (Log file)
- `tmp_test_thicken.mjs` (Test script)

### 4. Entry Point
- **`main.js`**: 
    - Slimmed-down initialization script.
    - Sets up global event listeners and coordinates module startup.

## Implementation Steps

1.  **Extract Foundation**: Move constants and state variables to `state.js`.
2.  **Modularize Features**: Move logic blocks into their respective files.
3.  **Update index.html**: Update script include to `<script type="module" src="./main.js"></script>`.
4.  **Connect Modules**: Use ES `import` and `export` to link the functionality.
5.  **Remove Globals**: Replace global assignments with explicit module exports.

## Verification
- Load in browser to check for JS console errors.
- Test basic interactions (sliders, sculpting, stamping).
- Verify Fusion 360 handshake still functions.
