# Implementation Plan: Dynamic Multi-Template Phase UI Refactor

This refactor makes the Hybrid Palette phase stepper fully template-driven so the same UI flow works for multiple frame templates. Each template will define its own parameters and phase structure, while the palette and engine remain generic.

## Proposed Changes

### 1. HTML Palette Logic
**File**: [index.html](file:///C:/Users/danse/APPS/b-spline-generator-web-addin/bspline-frame-builder/frame-builder/ui/html/index.html)
- **Action**: Keep `adjustPhase(delta)` generic.
  - Update the selected phase index.
  - Call `runBuild('sketch')` with the current `style_id`, `max_phase`, and current UI state.
- **Action**: Update `renderSchema` to render parameters and phase state from the incoming template payload.
  - Set `_phaseMax` from `phase_count`.
  - Do not hard-code template-specific parameter lists.
- **Action**: Support a template selector if not already present.
  - Changing templates should trigger a schema refresh.
  - On template change, reset `_phaseIndex` to the incoming template's `phase_count` (last phase) before rendering.
  - The new `phase_count` and schema must arrive together (or schema first) so the stepper always has a valid max when it lands.

### 2. UI Bridge
**File**: [hybrid_builder_ui.py](file:///C:/Users/danse/APPS/b-spline-generator-web-addin/bspline-frame-builder/frame-builder/ui/hybrid_builder_ui.py)
- **Action**: Persist the selected `style_id` in palette state.
- **Action**: On `change_template`
  - update `style_id`
  - schedule a deferred schema push for that template, including the new `phase_count` so the HTML can reset `_phaseIndex` to the last phase atomically.
  - provide a valid default `ui_data` for the incoming template so the first `run_build` after a switch is never sent with stale parameter values.
- **Action**: When handling `run_build`
  - include `type`, `style_id`, `max_phase`, and `ui_data`
  - preserve current phase state so the engine knows which phase to build to.
- **Action**: Keep schema pushes deferred to a fresh Fusion event to avoid HTML callback reentry.

### 3. Engine / Template Loader
**File**: [frame_engine.py](file:///C:/Users/danse/APPS/b-spline-generator-web-addin/bspline-frame-builder/frame-builder/fb_engine/frame_engine.py)
- **Action**: Refactor `get_template_spec(style_id)` to return the correct template spec for any supported template.
- **Action**: Replace hard-coded `Template 1/2/3/4` branches with a dict-based registry mapping `style_id` → template spec/class. Define a clear failure mode (raise + log) for unknown `style_id` values.
- **Action**: In `run_sketch_only`
  - resolve `template` from the selected `style_id`
  - derive `prefix` dynamically from the template spec or template identity
  - pass `max_phase` through to `ParametricSketchBuilder`
- **Action**: Keep `run_full_synthesis` template-aware as well, but separate from phase-limited sketch builds.

### 4. Template Spec Contract
- Each template should define:
  - `Name`
  - `Description`
  - `Parameters`
  - `Sketches` / `Blocks`
  - required `prefix` or identifier metadata (engine derives it from spec; no silent fallback)
- From that contract:
  - compute `phase_count` dynamically
  - render the UI schema dynamically
  - allow each template to change only parameter content and sketch block layout

### 5. Parameter Visibility — Rendering Rules

Not all parameters in the spec should be user-facing. Internal parameters (corner coincidences, projection anchors, constraint drivers, etc.) must be present in the spec for the engine but must never appear in the palette UI.

The renderer in `renderSchema` uses the following priority rules to decide how to render each parameter:

| Condition | Rendered as |
|---|---|
| Has a matching `en_` sibling in the param list | Slider with LOCK toggle (solver seed, user-lockable constraint) |
| `ReadOnly: True` | Read-only display value (owned by another add-in) |
| `Expose: True` | Plain slider, no lock (direct value, always consumed as-is) |
| None of the above | Hidden — engine-only, never shown in palette |

**Key points:**
- `en_` params are the signal that a param is a solver seed and user-lockable. They are never rendered directly — they are looked up by name from `currentParameters` to attach a lock toggle to their parent param.
- `Expose: True` is for user-facing params that are not solver seeds and don't need a lock — e.g. `frame_thickness`, `boundingboxoffset`, `WaistOffset`. More can be added freely.
- Internal params (future: corner coincidences, projection anchors, skeleton equal constraints, arc center–to–endpoint coincidences, etc.) have no `en_`, no `ReadOnly`, and no `Expose` — they are invisible to the user. Their `en_` counterpart, if present, is hardcoded in the spec and read only by the engine.
- **Actions**:
  - Update `renderSchema` in `index.html` to apply these four rules in order, replacing the current name-based `en_` prefix check.
  - Add `"Expose": True` to `frame_thickness`, `boundingboxoffset`, and `WaistOffset` in Template 1.
  - Add `"Expose": True` equivalents to the corresponding params in Templates 2/3/4.
  - Add missing `en_ShoulderRadius`, `en_WaistRadius`, `en_HipRadius` to Templates 2, 3, and 4.

## Verification Plan

### Manual Verification
1. Stop and restart the Add-in in Fusion 360.
2. Open the Hybrid Palette.
3. Select a template and verify the parameter panel updates to that template's spec.
4. Confirm `phase_count` updates correctly for the selected template.
5. Set the Phase Stepper to `1` and verify the first phase is built.
6. Step forward to mid and final phases and verify the cumulative sketch is built correctly.
7. Switch templates again and verify the palette updates without requiring code changes.

### Additional Checks
- Verify the phase stepper cannot exceed the current template's `phase_count`.
- Verify `runBuild('sketch')` carries the correct `style_id` and `max_phase`.
- Verify different templates can share the same UI flow but have different parameter names.
- Switch templates while a sketch is partially built and verify no orphaned geometry or stale UI state remains.
- Verify that internal parameters (no `Expose` flag) do not appear in the palette under any template.
- Verify that `en_` lock toggles still pair correctly with their parent exposed params after the filter change.

---
### 6. Constraint Toggle System — `ck_` Prefix

Geometric constraints (coincidences, horizontals, welds, merges) can be made user-controllable or template-configurable via a `ck_` param — distinct from `en_` which is reserved for dimensional seed/lock pairs.

**Two-step pattern** — both steps are required for a constraint to be UI-visible and engine-gated:

1. **Phase block** — add `'CK': 'ck_your_name'` to the constraint entry. This tells `constraints.py` which param to check before applying the constraint.
2. **Template spec** — declare `{"Name": "ck_your_name", "Label": "...", "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True}` in the Parameters list. `Val: 1.0` = on by default. `Expose: True` makes it appear in the palette UI.

If only step 1 is done (no matching param in spec), the engine falls back to `1.0` (always on) and nothing appears in the UI — the constraint is silently permanent. This is valid for purely internal constraints the template author wants hardcoded.

**Engine behaviour** (`constraints.py`): before resolving targets or applying any constraint, the `CK` gate is checked. If `ck_val < 0.5`, the constraint is skipped and logged.

**Implemented so far (Template 1):**

| `ck_` param | Phase | Constraint |
|---|---|---|
| `ck_arc_shoulder_weld` | p12_welds | Arc shoulder center → skeleton endpoint (L + R) |
| `ck_arc_hip_weld` | p12_welds | Arc hip center → skeleton endpoint (L + R) |
| `ck_skel_shoulder_merge` | p04_anatomy | Shoulder L/R shared start point coincidence |
| `ck_skel_waist_merge` | p04_anatomy | Waist L/R shared start point coincidence |
| `ck_skel_hip_merge` | p04_anatomy | Hip L/R shared start point coincidence |
| `ck_skel_shoulder_horiz` | p04_anatomy | Shoulder skeleton lines horizontal |
| `ck_skel_waist_horiz` | p04_anatomy | Waist skeleton lines horizontal |
| `ck_skel_hip_horiz` | p04_anatomy | Hip skeleton lines horizontal |

---
**Status**: Implementation complete for Template 1 core refactor. Templates 2/3/4 to be updated when copied from T1.
