# Sketch 2 — Shape Outline: Phase Structure

Twelve phases build the parametric silhouette loop in strict dependency order.
Each phase is independently steppable from the UI via the phase stepper (max_phase).

---

## Phase 1 — Projections (`p1_projs.py`)

Projects the four offset corners (TL, TR, BL, BR) from the `1_bounding-box` sketch.

---

## Phase 2 — Anatomy (`p2_anatomy.py`)

Builds the invisible parametric skeleton scaffold.

---

## Phase 3 — Silhouette (`p3_loop.py`)

Places all 12 silhouette segments as geometric seeds. 
Applies **Seed Radii** (`dim_seed_rad_...`) at `heightIn/11`.

---

## Phase 4 — Phase 4c: Topology Closure

Closes the loop, connects horns, and pins the waist hub.

---

## Phase 5 — Phase 5b: Smoothness

Applies Tangent constraints across all junctions.

---

## Phase 5c — Radius Removal (`p5c_radius_removal.py`)

Surgically deletes the six seed radius dimensions added in Phase 3.

---

## Phase 6 — Skeleton Welds (`p6_welds.py`)

Anchors arc centers (`:C`) to the parametric skeleton hub endpoints (`:E`).

---

## Phase 7 — Parametric Drivers (`p7_drivers.py`)

Finalizes the sizing of the anatomy and arcs.
Re-applies the actual UI sliders (ShoulderRadius, WaistSpan, etc.) ONLY if their corresponding UI "Lock" is checked.
Arcs use **Volatile Radius** logic to nudge and release.

---

## Phase 7b — Enclosure Expansion (`p7b_expansion.py`)

The final geometric growth and corner completion.

**Offset Synthesis**: Generates the internal frame line loop (`frame_thickness`) based on the settled Phase 7 geometry.

**Miter Completion**: Correctly identifies the four outer corners (`horn_...:S`) and connects them to the offset inner corners using the accurate Template 2 logic.

---

After Phase 7b, the sketch is a fully closed, manifold silhouette with a consistent wall thickness.




