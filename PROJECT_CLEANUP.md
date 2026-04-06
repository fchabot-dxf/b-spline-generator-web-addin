# Project Structure & Cleanup Plan

This document outlines the proposed reorganization of the `b-spline-generator-web-addin` workspace to improve maintainability and declutter the root directory.

## 1. Web Frontend Modularization
To move away from the current monolithic `main.js`, we will reorganize the `symmetric-b-spline-gen/html/` directory:

- **Current State**: All JS, CSS, and HTML files are in the root of `/html/`.
- **Proposed State**:
    - `/html/index.html`: The main entry point.
    - `/html/styles/`: All CSS files.
    - `/html/js/`: Modularized JavaScript files.
        - `/html/js/core/`: State management, history, and the rebuild engine.
        - `/html/js/features/`: Sculpting, stamping, and thickness logic.
        - `/html/js/integration/`: Fusion 360 bridge and export services.
    - `/html/assets/`: Icons, textures, and static resources.

## 2. Root Directory Decluttering
The root directory currently contains several temporary or stray files. We propose moving them to a dedicated `backups/` or `assets/` folder:

| File | Type | Proposed Action |
| :--- | :--- | :--- |
| `Source.dxf` | CAD Data | Move to `backups/reference-dxf/` |
| `bounding-box.dxf` | CAD Data | Move to `backups/reference-dxf/` |
| `stamp_7x9 (2).svg` | Graphics | Move to `symmetric-b-spline-gen/html/assets/stamps/` |
| `symmetric_b_spline_gen_log.txt` | Log | Delete or move to `logs/` |
| `tmp_test_thicken.mjs` | Script | Move to `test/scripts/` |

## 3. Module Breakdown for main.js
`main.js` (~3,000 lines) will be split into:
1. **`state.js`**: Centralized parameters and session management.
2. **`history.js`**: Global undo/redo and state snapshots.
3. **`ui-utils.js`**: DOM binding and sync helpers.
4. **`sculpt-logic.js`**: High-level sculpture interaction.
5. **`stamp-logic.js`**: Async rasterization and layer processing.
6. **`engine.js`**: Rebuild coordination and heightmap updates.
7. **`fusion-bridge.js`**: Fusion 360 Python communication.
8. **`export-service.js`**: Multi-variant export and wizard logic.

## 4. Initialization Workflow
1. Create the new directory structure.
2. Extract logic from `main.js` into the new modules.
3. Update `index.html` to load the modules.
4. Verify functionality in a browser environment.
