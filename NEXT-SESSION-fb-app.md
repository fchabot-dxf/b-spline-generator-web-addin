# NEXT (fb-app) — F5: SIL-RESOLVE — silhouette arcs never invert

**Ball: worker (seat C) · epoch 1 · F5.** F4 items 1-3 accepted; item 4 (live) is BLOCKED until Fusion on this PC is
free (Fred's other machine suspended it) — do NOT use Fusion. Spec: ROADMAP.md "SIL-RESOLVE" (Fred's live screenshot:
Hourglass with high corner radius -> shoulder/waist arcs loop over each other). PROGRESS automatic ("F5 item N: …").
Merge origin/main into fb-app first (advisor already merged it at dispatch time — check it's clean).

## Checklist
- [ ] [F5-item-1] Reproduce Fred's case as a FAILING test first (Hourglass, high corner radius; find the exact params
      that loop; also scan bottle) — assert simple closed outline, positive sweep per arc, tangency at joints.
- [ ] [F5-item-2] Fix the SOLVE in editor-shape-lattice-generator.js (generateSilhouette / PRESETS): derive the feasible
      range for each preset's params (corner radius vs waist reach vs available height / neck…) and resolve within it —
      declared (clamp / redistribute), never self-intersecting, never reversed arcs. Slider ranges in the panel follow
      the declared feasible range (no dead zone that silently clamps).
- [ ] [F5-item-3] Dense sweep test: every preset param x several values x both orientations x several board sizes
      (incl. a small board) — all simple + tangent. Keep it fast.
- [ ] [F5-item-4] Inversion detector (F3 AMEND 7b) as a guard used by the app preview (warn, never draw a looped
      outline) — shared with the future frame preview.
- [ ] [F5-item-5] Screenshots (styled server) before/after of Fred's case to shots\seatC\.
Commit by path, push origin fb-app, pass back from the fb-app root.
