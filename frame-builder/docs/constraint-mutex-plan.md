# Frame Builder — Parametric Constraint Mutual Exclusivity Plan

## Overview

Each arc in Sketch 3 has exactly **5 degrees of freedom** (center X, center Y, radius, start angle, end angle).
Every constraint consumes one or more DoF. Adding more constraints than available DoF causes a Fusion solver crash (`VCS_SKETCH_OVER_CONSTRAINTS`).

The system has two orthogonal control modes for each arc:
- **Skeleton-driven**: skeleton endpoint position constrains arc center (X or Y), radius is implicit
- **Radius-driven**: explicit radius dimension constrains curvature, arc center floats

These two modes are **mutually exclusive per DoF axis**. This document maps every conflict and the required gating rule.

---

## Arc-to-Skeleton Cross-Assignment (Template 1)

The arc centers are cross-assigned to skeleton endpoints by design (S-curve geometry):

| Arc | Center pinned to | Governing skeleton param |
|-----|-----------------|--------------------------|
| `arc_shoulder_R/L` | `skel_hip_pin_R/L:E` | `skelHipLen` (span), `skelVerticalGapHip` (Y) |
| `arc_hip_R/L` | `skel_shoulder_pin_R/L:E` | `skelShoulderLen` (span), `skelVerticalGapShoulder` (Y) |
| `arc_waist_R/L` | `skel_waist_pin_R/L:E` | `skelWaistLen` (span), waist Y = 0 always |

---

## DoF Budget Per Arc

### Outer arcs (arc_shoulder_R, arc_hip_R, arc_shoulder_L, arc_hip_L)

Baseline constraints always active:
1. Center coincident to skeleton endpoint → **pins center (cx, cy): 2 DoF**
2. Endpoint coincident to horn end → **pins arc endpoint (x, y) given center: 2 DoF**
3. Tangent to horn → **1 DoF**

**Total: 5/5 consumed → fully determined. Zero DoF remaining.**

Consequence: a radius dimension on these arcs **always over-constrains** if all three above are active.

### Waist arcs (arc_waist_R, arc_waist_L)

Baseline constraints always active:
1. Center coincident to waist skeleton endpoint (`cy = 0` always, `cx` = free if span OFF) → **1 or 2 DoF**
2. Start coincident to `arc_shoulder:S` (fixed when shoulder arc is constrained) → **2 DoF**
3. End coincident to `arc_hip:E` (fixed when hip arc is constrained) → **1 DoF** (r already consumed)
4. Tangent to arc_shoulder → **1 DoF**
5. Tangent to arc_hip → **1 DoF**

**Total: up to 7 constraints → always over-constrained by 2 when all active.**

---

## Conflict Matrix

For each radius parameter, the conditions that must be true for it to be safely applicable:

| Radius param | Requires skeleton span OFF | Requires vertical gap OFF | Notes |
|---|---|---|---|
| `shapeRadiusShoulderR/L` | `skelHipLen__enabled = 0` | `skelVerticalGapHip__enabled = 0` | Arc center driven by hip skeleton endpoint — both X and Y must be free |
| `shapeRadiusHipR/L` | `skelShoulderLen__enabled = 0` | `skelVerticalGapShoulder__enabled = 0` | Arc center driven by shoulder skeleton endpoint |
| `shapeRadiusWaistR/L` | `skelWaistLen__enabled = 0` | n/a (waist Y is always 0) | Waist arc center Y always locked to zero; only X can free via span OFF |

> **Note:** Even with the above, waist arcs remain over-constrained due to tangency + endpoint chain consuming all remaining DoF. The center coincident itself must also be removed for the radius dim to be valid (see waist arc special case below).

---

## Required Gating Rules Per Sketch

### Sketch 2 — Skeleton (no conflicts currently, stable)

| Dimension | Gate condition | Status |
|---|---|---|
| `dim_skel_shoulder_span` | `skelShoulderLen__enabled` | ✅ Correct |
| `dim_skel_waist_span` | `skelWaistLen__enabled` | ✅ Correct |
| `dim_skel_hip_span` | `skelHipLen__enabled` | ✅ Correct |
| `dim_skel_vertical_shoulder` | `skelVerticalGapShoulder__enabled` | ✅ Correct |
| `dim_skel_vertical_hip` | `skelVerticalGapHip__enabled` | ✅ Correct |

### Sketch 3 — Shape Outline

#### Outer arc center coincidents (always currently unconditional)

These must become **conditional** — drop when the governing span OR vertical gap is enabled, because then the arc is
already driven through the tangent+endpoint chain:

| Constraint | Current | Required |
|---|---|---|
| `arc_shoulder_R:C` coincident to `proj_skel_hip_pin_R_E` | unconditional | Gate OFF when `shapeRadiusShoulderR__enabled = 1` |
| `arc_shoulder_L:C` coincident to `proj_skel_hip_pin_L_E` | unconditional | Gate OFF when `shapeRadiusShoulderL__enabled = 1` |
| `arc_hip_R:C` coincident to `proj_skel_shoulder_pin_R_E` | unconditional | Gate OFF when `shapeRadiusHipR__enabled = 1` |
| `arc_hip_L:C` coincident to `proj_skel_shoulder_pin_L_E` | unconditional | Gate OFF when `shapeRadiusHipL__enabled = 1` |
| `arc_waist_R:C` coincident to `proj_skel_waist_pin_R_E` | unconditional | Gate OFF when `shapeRadiusWaistR__enabled = 1` |
| `arc_waist_L:C` coincident to `proj_skel_waist_pin_L_E` | unconditional | Gate OFF when `shapeRadiusWaistL__enabled = 1` |

#### Radius dimensions

| Dimension | Current | Required |
|---|---|---|
| `dim_waist_arc_R_radius` | `EnabledParam: shapeRadiusWaistR__enabled` | ✅ Correct gate, but also requires center coincident to be OFF |
| `dim_waist_arc_L_radius` | `EnabledParam: shapeRadiusWaistL__enabled` | ✅ Correct gate |
| `dim_shoulder_arc_R_radius` | **Not in spec yet** | Add, gated on `shapeRadiusShoulderR__enabled` |
| `dim_shoulder_arc_L_radius` | **Not in spec yet** | Add, gated on `shapeRadiusShoulderL__enabled` |
| `dim_hip_arc_R_radius` | **Not in spec yet** | Add, gated on `shapeRadiusHipR__enabled` |
| `dim_hip_arc_L_radius` | **Not in spec yet** | Add, gated on `shapeRadiusHipL__enabled` |

---

## Implementation Strategy

### Engine support needed: `BlockedParam`

Add a `BlockedParam` key to constraint/dimension specs (opposite of `EnabledParam`):
- `EnabledParam: X` → only add constraint if X == 1
- `BlockedParam: X` → only add constraint if X == 0

This avoids needing to invent new intermediate parameters.

Example:
```python
# Center coincident blocked when radius mode is active
{'Type': 'Coincident', 'Targets': ['arc_waist_R:C', 'proj_skel_waist_pin_R_E'],
 'BlockedParam': 'shapeRadiusWaistR__enabled'}

# Radius dim only when center coincident is inactive
{'Name': 'dim_waist_arc_R_radius', 'DimType': 'Radius', 'Target': 'arc_waist_R',
 'Expression': 'shapeRadiusWaistR', 'EnabledParam': 'shapeRadiusWaistR__enabled'}
```

### UI model

The UI checkboxes already provide the right control surface:
- Radius toggle ON → radius drives arc, center floats (skeleton endpoint is a "soft guide" only)
- Radius toggle OFF → skeleton endpoint pins arc center, radius is implicit

No new UI elements needed. The existing `shapeRadius*` checkboxes are the mode switch.

---

## Execution Order

1. **Add `BlockedParam` support to `parametric_engine.py`** in `_is_spec_enabled()`
2. **Update `T1_sketch_3_shape_outline.py`**: add `BlockedParam` to all 6 center coincidents
3. **Add missing radius dims** for shoulder and hip arcs to `T1_sketch_3_shape_outline.py`
4. **Test each arc independently**: toggle radius on/off for each pair and verify no solver crash
5. **Test mixed modes**: e.g. shoulder radius ON + hip skeleton-driven → verify no cross-contamination

---

## Known Unsolved Cases

- **Waist arc with span OFF and radius ON**: even without center coincident, the waist arc is over-constrained by
  the tangent+endpoint chain from the outer arcs. The root cause is that `arc_waist_R:S ≡ arc_shoulder_R:S` and
  `arc_waist_R:E ≡ arc_hip_R:E`, and both outer arcs are fully constrained — so both endpoints of the waist arc
  are locked, plus tangency at both ends = 6 constraints for 5 DoF. One of the tangency constraints must be
  dropped to allow radius control on the waist arc. The user must choose: **drop waist tangency** to gain radius
  control, OR **keep tangency** and accept that the waist radius is implicit.
