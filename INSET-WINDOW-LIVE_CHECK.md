# Inset Window (T82 item 2/6): the live Fusion check

No Fusion build existed as of T82 item 5 — this seat (B) built the APP half only (data shape, 2D/3D preview,
drag UI, the geometry every consumer shares) and verified it there. The Fusion/CAM half (§5 of
INSET-WINDOW-DESIGN.md) is T82 item 6, built directly by seat B once a Fusion bridge became available this
session (this file originally assumed it would be handed to a different seat; it wasn't).

## 0. What exists today, and what doesn't

**App side (done, tested, A/B-confirmed byte-identical when off):**
- `core/inset-window.js`: `insetWindowGeometry(record, frameThickness, panelLip, widthIn, heightIn)` — the
  ONE declared geometry function (outer/inner/hole rectangles, board-local), null when disabled or
  geometrically invalid. `insetWindowOuterRect(rec, widthIn, heightIn)` is the ONE place the record's own
  centre-based storage converts to that board-local form.
- `core/frame-record.js`: `record.insetWindow = {enabled, cx, cy, w, h}` (T82 item 5: `cx`/`cy` the window's
  own centre, inches, from the BOARD CENTRE, +y UP -- Fusion's own sketch convention, so the Fusion side
  below reads it directly, no corner conversion), normalized (type-checked) but NOT clamped against the
  frame or board (Fred's own ruling, design note §3). An OLD-shape record (`{x1,y1,x2,y2}`) migrates on read.
  Carried in `framePayload()`.
- 2D editor (Frame tab): the window's own outer/inner rectangles drawn, a dark cutaway for the hole, drag to
  move (body) or resize (any corner) — `main/frame-panel.js`'s own `_wireWindowDrag()`.
- 3D preview: the hole is a real absence of panel mesh — an EXACT clip against the hole rectangle
  (`core/preview/frame-mesh.js`'s own `applyFrameToPanel`, `_polyMinusRect`; T82 item 3 replaced the
  original whole-triangle centroid cull, which left a jagged terrain-grid-shaped edge), with a wall at the
  hole's own edge so it reads as a real cut, not a flat decal. **T82 item 3 (superseded the line below):**
  the window's own 4 bars ARE now drawn in the 3D preview too, in the frame's own material, between the
  window's outer/inner rectangles — their top follows the panel's own underside and their bottom is that
  underside offset down by `frame_height_offset` (so they sit behind/under the panel by construction and
  are hidden from the front by the panel's own overhang, never visible from the top/front view, but visible
  from the back/side/bottom — matching Fred's own phone shot and what a real Fusion build will look like).
- Sidebar toggle: "Inset window" checkbox, off by default, in the FRAME panel.

**NOT built (this seat has no Fusion bridge):**
- The Fusion sketch geometry (3 nested rectangles, 4 corner miters) — design note §5 step 1-2.
- The 4 new bar bodies (`frame_window_top/bottom/left/right`, positioned behind the panel: top face at
  `frame_height_offset` from the sketch plane, bottom face at the panel's own underside — same rule as the
  main frame's own bars) — design note §5 step 3.
- The hole cut feature (`window_cut`, a through-all pocket using the hole rectangle) — design note §5 step 4.
- `declared_profiles.classify()`'s own new mapping for the window's sketch region — design note §5 step 5.
- CAM: **CORRECTED, T82 item 6** — a real fix IS needed in `_populate_frame_geometry()` (design note §4's own
  table), not just naming: `other_bars` only get laid out automatically on templates without the classic 4
  bar names (T6, T11); everywhere else `frame_window_*` would be collected and never positioned.

## 1. Build it (once the Fusion side above exists)

1. Deploy the add-in as usual, open a design with a frame already built (any template).
2. In the app, enable "Inset window", drag it to a reasonable size/position well inside the frame's own
   opening, [Send frame].
3. Check:
   - [ ] 4 new bar bodies appear in the SAME `Frame_N` component as the main bars (not a new component), named
     `frame_window_top/bottom/left/right`, built from new regions in the existing frame-enclosure sketch.
   - [ ] Those 4 bodies sit BEHIND the panel (their own BOTTOM face at the panel's own underside, TOP face at
     `frame_height_offset` from the sketch plane — not the sketch plane itself) — confirmed by inspecting
     their own Z position directly, not assumed from the parameter wiring.
   - [ ] A new cut feature removes material from the panel/core body in exactly the hole rectangle (outer
     rect inset by `frame_thickness` then by `panel_lip`), through all.
   - [ ] From a top/front view, the hole is a clean rectangle with NO visible frame member inside it (the
     subframe bars are genuinely hidden behind the panel).
   - [ ] The 4 corner miters on the window's own sketch are real 45 deg bisectors (trivial here: every corner
     is 90 deg, axis-aligned, no T7-style derivation needed).
4. CAM (Manufacture): confirm the 4 `frame_window_*` bodies appear in the SAME MM-Frame layout as the main
   frame's own bars. **CORRECTED, T82 item 6**: this needs the `_populate_frame_geometry()` fix (§0 above) on
   any template with the classic 4 bar names — verify the fix is actually in place before this check, not
   just that the bodies "show up automatically."
5. Degenerate case: shrink the window until its own bars/opening would be <= 0 (per the app's own validity
   floor, `insetWindowGeometry`) — confirm Fusion does something equally well-defined (no feature built, or a
   clean failure) rather than a corrupt/self-intersecting sketch.
6. Overlap case: deliberately overlap the window with the main frame's own opening edge (NOT prevented by the
   app, Fred's own ruling) — confirm the result is "ugly but not broken" (some valid, if visually poor,
   geometry), not a crash or an invalid body.

## 2. What to send back

- Screenshots: the sketch (3 nested rectangles + miters), the 4 bar bodies in isolation, the panel with its
  own hole cut, a front view showing the subframe is hidden, the CAM layout.
- Whether `declared_profiles.classify()`'s new mapping needed anything beyond what design note §5 step 5
  describes.
- The degenerate- and overlap-case results from steps 5-6 above.
- Any place the "reuse the existing extrusion-engine/panel_lip/declared_profiles machinery, no new mechanism"
  assumption in the design note turned out NOT to hold once real Fusion geometry was involved.
