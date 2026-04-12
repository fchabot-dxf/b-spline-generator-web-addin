# Implementation Plan: Phase-Based UI Refactor

This refactor wires the 17 modular sketch phases to the HTML "Phase Stepper" in the Hybrid Palette. This allows for step-by-step "Time Travel" through the frame's construction for debugging and design verification.

## Proposed Changes

### 1. HTML Palette Logic
**File**: [index.html](file:///C:/Users/danse/APPS/b-spline-generator-web-addin/bspline-frame-builder/frame-builder/ui/html/index.html)
- **Action**: Modify `adjustPhase(delta)` to call `runBuild('sketch')` automatically.
- **Action**: Update `renderSchema` to correctly set the `_phaseMax` limit based on the engine's `phase_count`.

### 2. UI Bridge
**File**: [hybrid_builder_ui.py](file:///C:/Users/danse/APPS/b-spline-generator-web-addin/bspline-frame-builder/frame-builder/ui/hybrid_builder_ui.py)
- **Action**: Update the `run_build` event handler to extract the `max_phase` index from the incoming JSON data.
- **Action**: Pass `max_phase` down to the coordination logic.

### 3. Engine Enforcement
**File**: [frame_engine.py](file:///C:/Users/danse/APPS/b-spline-generator-web-addin/bspline-frame-builder/frame-builder/fb_engine/frame_engine.py)
- **Action**: Ensure the internal build dispatcher accepts the `max_phase` argument.
- **Action**: Pass the limit to the `ParametricSketchBuilder`.

## Verification Plan

### Manual Verification
1.  **Stop/Run** the Add-in in Fusion 360.
2.  Open the Palette.
3.  Set the Phase Stepper to `1`. Verify only the Bounding Box is drawn.
4.  Step forward to `5`, `10`, and `17` to verify the cumulative construction.

---
**Status**: Awaiting Approval.
