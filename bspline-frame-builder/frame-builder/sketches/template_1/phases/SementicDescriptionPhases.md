# Template 1 — 16-Step Modular Architecture

The Frame Builder Template 1 uses a **Multi-Sketch Sequence** to ensure maximum stability and modularity. The build progresses through 16 global phases across three distinct Fusion 360 sketches.

---

## Sketch 1 — Foundations: Bounding Box
Defines the safe working area and model limits.

### Step 1 — BB Layout (`p0a_bb_rect.py`)
Creates the primary centerpoint rectangle anchored to the origin. Driven by `widthIn` and `heightIn`.

### Step 2 — Safe Zone Offset (`p0b_bb_offset.py`)
Applies the `boundingboxoffset` to create the inner boundary and registers the four corner reference IDs used by Sketch 2.

---

## Sketch 2 — Silhouette: Shape Outline
Constructs the parametric frame silhouette loop.

### Step 3 — Projections (`p1_projs.py`)
Projects the reference corners from Sketch 1 into the current silhouette sketch.

### Step 4 — Anatomy (`p2_anatomy.py`)
Builds the invisible parametric skeleton scaffold (Hubs).

### Step 5 — Silhouette Loop (`p3_loop.py`)
Places the 12 geometric arc/line seeds and applies initial "Safety Radii."

### Step 6 — Chain (`p4_chain.py`)
Creates the arc-to-arc connectivity across the Shoulder, Waist, and Hip junctions.

### Step 7 — Horns (`p4b_horns.py`)
Welds the shoulder/hip arc endpoints to the parametric horn segments.

### Step 8 — Waist Pins (`p4c_waist_pins.py`)
Pins the waist hub center points to the skeleton to maintain structural symmetry.

### Step 9 — Tangency (`p5_tangency.py`)
Applies G1 Tangent constraints across all arc-to-arc junctions.

### Step 10 — Horn Tangency (`p5b_horn_tangency.py`)
Applies G1 Tangent constraints between the arcs and the straight horn segments.

### Step 11 — Radius Removal (`p5c_radius_removal.py`)
Surgically deletes the temporary seed dimensions from Step 5 to allow parametric driving.

### Step 12 — Skeleton Welds (`p6_welds.py`)
Finalizes the topology by welding arc centers to the skeleton endpoints.

### Step 13 — Parametric Drivers (`p7_drivers.py`)
Applies the actual UI slider values (Shoulder Radius, Waist Span, etc.) using Volatile Dimension logic.

---

## Sketch 3 — Enclosure: Frame Wall
Generates the mitered frame profile for solid synthesis.

### Step 14 — Enclosure Projections (`p8_encl_projs.py`)
Projects the finalized silhouette loop and anchor points from Sketch 2.

### Step 15 — Enclosure Offset (`p9_encl_offset.py`)
Applies the `frame_thickness` (e.g., -0.75in) to create the inner-wall loop.

### Step 16 — Enclosure Miters (`p10_encl_miters.py`)
Completes the corner miters connecting the silhouette horn tips to the offset corners.

---

### **Extrusion Notice**
After Step 16, the engine targets the profile in **Sketch 3** for the solid extrusion operation (`frame_depth`).
