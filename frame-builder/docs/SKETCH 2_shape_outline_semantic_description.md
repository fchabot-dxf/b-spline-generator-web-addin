SKETCH 2 
# Shape Outline Semantic Description (12nd-Order Manifold)

This document defines the 100% coincident, corner-locked 12-segment manifold for the Frame Builder "Violin" Silhouette.

## 📐 Corner-Locking Logic

The silhouette is pinned to the **Bounding Box Offset (Sketch 1)** corners: volatile variable:  
- **Top-Left Corner**: (-width/2 + offset, height/2 - offset)
- **Top-Right Corner**: (width/2 - offset, height/2 - offset)
- **Bottom-Left Corner**: (-width/2 + offset, -height/2 + offset)
- **Bottom-Right Corner**: (width/2 - offset, -height/2 + offset) 
(not sure if this is actually helpfull or not)---

## 🎻 The 12-Segment Chain (Clockwise Trace)

### 1. Top line
- **Segment 1**: **Top horizontal line (`G_05`)**
  - Spans from Top-Left Corner to Top-Right Corner.
  - coincident on either side to the vertical lines of the upper horns, ensuring a seamless transition at the corners.

### 2. Right Side Profile (5 Segments)
- **Segment 2**: **Upper Horn (`horn_right_upper`)**
  - Strictly **Vertical Line** down from Top-Right Corner. tangent to segment 3 (arc) at the bottom, ensuring a smooth transition to the shoulder arc.
- **Segment 3**: **Shoulder Arc (`G_03`) — INWARD (Concave)**
  - Curves away from the bounding box toward the center. tangent to segment 2(vertical line) at the top and tangent to segment 4 at the bottom, ensuring smooth curvature transitions.
- **Segment 4**: **Waist Arc (`arc_mid_right`) — OUTWARD (Convex)**
  - Bulges toward the bounding box edge (The "Piano/Violin" curve). tangent to segment 3 at the top and tangent to segment 5 at the bottom, ensuring smooth curvature transitions.
- **Segment 5**: **Hip Arc (`arc_bot_right`) — INWARD (Concave)**
  - Curves back toward the center-line. tangent to segment 4 at the top and tangent to segment 6 (vertical line) at the bottom, ensuring smooth curvature transitions.
- **Segment 6**: **Lower Horn (`horn_right_lower`)**
  - Strictly **Vertical Line** down to Bottom-Right Corner.

### 3. Bottom Horizon
- **Segment 7**: **Bottom Center Arc (`G_10`)**
  - Spans from Bottom-Right Corner to Bottom-Left Corner.

### 4. Left Side Profile (5 Segments)
- **Segment 8**: **Lower Horn (`horn_left_lower`)** 
  - Vertical up from Bottom-Left Corner. coincident to Segment 7 (horizontal line) at the bottom, and tangent to Segment 9 (arc) at the top, ensuring a smooth transition from the bottom vertical line to the hip arc.
- **Segment 9**: **Hip Arc (`arc_bot_left`) — INWARD (Concave)** tangent to Segment 8 (vertical line) at the bottom, and tangent to Segment 10 (arc) at the top, ensuring smooth curvature transitions.
- **Segment 10**: **Waist Arc (`arc_mid_left`) — OUTWARD (Convex)** tangent to Segment 9 (arc) at the bottom, and tangent to Segment 11 (arc) at the top, ensuring smooth curvature transitions.
- **Segment 11**: **Shoulder Arc (`G_11`) — INWARD (Concave)**
- **Segment 12**: **Upper Horn (`horn_left_upper`)**
  - Vertical up to close the loop at the Top-Left Corner. tangent to Segment 11 (arc) at the bottom, coincident to horizontal line segment 1 at the top

---

## ✅ Coincidence Verification
Every segment end-point is bit-identical to the next segment start-point. There are no gaps at the junctions or corners, ensuring 100% manifold integrity for the Fusion 360 offset solver.

segment 1 and 7 have their endpoint coincide to the bounding box offset corner defined in boundingbox sketch 1.