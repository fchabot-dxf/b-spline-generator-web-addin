# Inset Window — design note (T82 item 2)

STEP 1 of T82 item 2 (Fred, from his painting "Entry": "a second small frame set into the piece";
"always open"). No code in this commit — this note is for advisor/Fred review before anything is built.
Spec assembled from the dispatch + three amendments (no clamping; the subframe hides behind the panel;
the subframe's inner contour is the one declared trim profile; same `panel_lip` offset as the outer frame).

## 1. What it is

A second, small, RECTANGULAR mitred frame (4 bars, bar width = `frame_thickness`, the SAME value the main
frame uses) sitting inside the main frame's own opening. It cuts a literal hole through the carved panel —
not a stamp, not a recess: the panel stops at the window's own outer edge and there is nothing there. The
subframe itself is never seen from the front: it sits BEHIND the panel (mounted from the back, like a shadow
box backing), and the panel's own material overlaps its inner edge by `panel_lip` — the exact relationship
the panel already has with the MAIN frame, just facing the opposite way (inward instead of outward). From the
front you see a clean rectangular hole with no visible frame member.

It is a per-record, per-template-agnostic FRAME-LEVEL option (declared once, every template gets it for free),
the same architectural slot `appearance` / `frameBottomZ` / `panelLip` already occupy
(`frame_definition.py:76-95`, `EXTRUSION_SETTINGS`) — not a new per-template feature, and not template-specific
code anywhere.

## 2. Data shape

**UPDATED, T82 item 5** (Fred: "use the centre of frame... and make the window a centre point rect too"):
centre + size, not two opposite corners. One field on the frame record,
`b-spline-gen/html/core/frame-record.js`:

```js
record.insetWindow = {
  enabled: false,     // the sidebar/editor-panel toggle; OFF by default
  cx: 0.0, cy: 0.0,   // the window's own CENTRE, inches, measured from the BOARD CENTRE, +y UP
                      // (Fusion's own sketch convention -- RectangleCenter maps 1:1 onto it)
  w: 3.0, h: 2.5,     // the OUTER size (bars included)
};
```

`core/inset-window.js`'s own `insetWindowOuterRect(rec, widthIn, heightIn)` is the ONE place this converts
to a board-local rect (origin top-left, y down — the convention `frameCutProfile`'s own board, and every
rectangle below, still uses); `insetWindowGeometry` calls it first, then proceeds exactly as before. A
record saved under the ORIGINAL shape (`{x1, y1, x2, y2}`) migrates on read (`normalizeFrameRecord`, using
the board's current width/height), so an old project still loads correctly.

Why centre+size over two opposite corners (the original §2, superseded): Fred's own ruling was that a
corner-drag should resize SYMMETRICALLY about the centre (§6) rather than leaving the opposite corner fixed
— centre+size makes that the NATURAL representation (the centre field simply doesn't change during a
resize), where two-corner storage would need an explicit "recompute the other corner to keep the centre
put" step on every resize instead. `normalizeFrameRecord()` still only type-checks the four numbers; no
clamping (see §3).

Derived, never stored (so there is exactly one place each is computed, matching how `frameCutProfile` already
derives `region` from `boundingboxoffset` rather than storing it twice):
- **Outer rectangle**: `(x1,y1)-(x2,y2)` directly — this is what the panel/terrain stop at, and what Fusion's
  bars are built from.
- **Inner rectangle** (the subframe's own inner edge, the mitred opening): the outer rectangle offset inward
  by `frame_thickness` on all four sides — same "inward offset by the frame's own thickness" relationship
  `frameInnerProfile` already uses for the main frame (`outline-offset.js`'s own `offsetOutlineInward`,
  reused verbatim, not reimplemented, since a plain rectangle is a degenerate case of the same general
  outline-offset code every template's own inner edge already runs through).
- **Hole/trim profile** (what actually gets cut through the board): the inner rectangle offset inward ONE
  MORE TIME, by `panel_lip` (the ONE existing `panelLip` record field — no second lip setting). This is the
  profile every consumer below reads. Deliberately the SAME two-step relationship
  (`outer -> thickness -> lip`) the main frame already has, just both offsets pointed inward instead of one
  in and one out, because the window is a hole (material recedes toward its own centre) where the main frame
  is a perimeter (material recedes toward the board's own edge).

`framePayload()` (`frame-record.js:99-106`) carries `insetWindow` to Fusion exactly like every other record
field already does — no new transport mechanism.

## 3. Deliberately NOT validated (Fred: "then it's my responsibility to not let it intersect")

No clamping against the frame's own opening, the board edge, or anything else — Fred places it, the app does
not stop him overlapping the main frame or running it off the board. The ONLY two guards, both pure geometry
validity (not placement policy), mirroring the main frame's own `frameFit()` rule
(`editor-frame-profile.js:58-62`, `2*frame_thickness < min(W,H) - 2*bbo`) at the window's own smaller scale:

- **Window bars > 0**: `(x2-x1) > 2*frame_thickness` AND `(y2-y1) > 2*frame_thickness` (each bar needs a
  positive-length run along its own side).
- **Opening > 0**: the inner rectangle (outer minus thickness) has positive width and height — implied by the
  bars check above, stated separately because it is the one Fred named explicitly.

Below that floor: no window feature is built (Fusion) and no hole is cut/drawn (app) — the toggle stays on in
the record, but produces nothing, the same "declared but inert below its own floor" behaviour
`shoulderLedgeWidth`'s own range floor already established for Template 7 this session. Nothing is clamped
INTO validity; it simply does not render until the numbers are valid, and the UI should say so (a short
inline warning in the Frame panel, not a blocked drag).

## 4. Every consumer

| Consumer | Today | With `insetWindow.enabled` |
|---|---|---|
| Terrain carving (`core/engine.js`/`core/terrain.js`) | builds the full rectangular grid; doesn't know about the frame at all (confirmed: no "frame"/"trim"/"clip" hit in either file) | unchanged at build time — still builds the full grid |
| 3D preview clip (`core/preview/frame-mesh.js`) | `clipPanelToOutline()` (268-328) keeps triangles INSIDE the frame's own panel/lip loop | **T82 item 3 (superseded below):** a SECOND pass removes the hole/trim profile (§2) from the kept triangles — EXACTLY (`_polyMinusRect`, a straddling triangle is cut to its true outside-the-rect pieces), not by whole-triangle centroid, which left a jagged terrain-grid-shaped edge (Fred, phone shot) |
| Stamps (`main/stamp-mask-manager.js`) | not frame-aware at all today | the rasterized mask is zeroed inside the hole/trim profile before being applied — a stamp cannot carve material that is not there |
| Shape Lattice / pattern (`editor/contour-from-frame.js`) | opt-in per pattern (`pattern.contour.fromFrame`); `frameContourSilhouette()` returns ONE offset silhouette | when the owning pattern already reads `fromFrame`, the window's own hole/trim profile is carried alongside as a second, EXCLUDED region — a pattern generator that already walks "inside this silhouette" treats the hole as an island to skip, the same way an inner (reflex) boundary would be skipped; patterns that don't opt into `fromFrame` are unaffected, same as today |
| 3D preview bars | `applyFrameToPanel()` builds a bar ring from the main frame's own inner profile (`ringArrays()`, line 519) | **SUPERSEDED (T82 item 3, Fred, phone shot from the bottom: "inset window doesn't show a frame" — "hide the subframe" meant hidden FROM THE FRONT by the panel overhang, not absent):** the window's own bars ARE added, via the SAME `ringArrays` primitive, between the window's outer/inner rectangles, in the frame's own material — top follows the panel's own underside, bottom is that underside offset down by `frame_height_offset` (a fixed depth, not a flat world z), so they are mounted to the panel's own back and never visible from the front |
| Editor 2D (Frame tab) | draws the frame's own band/miters, clips the grid/snapping to the outline | draws the window's own outer+inner rectangle (same band-drawing primitive the main frame's own `_drawFrameProfile` already uses, rectangular case), with its own drag handles (§6) |
| Fusion sketch/solid build | 4 (or N) bar bodies + 1 trim cut, see `extrusion_engine.py`/`panel_lip.py` | 4 MORE bar bodies + 1 MORE cut feature (the hole), both via the SAME declared-profile machinery, see §5. **CORRECTED, T82 item 6**: in the SAME frame-enclosure sketch and the SAME `Frame_N` component as the main bars, not a new component — a second component would break `find_frame_component`'s "first tag hit" lookup, `send_frame`'s `find_frames(design)[-1]`, delete-on-resend, and CAM's "one `parentComponent`" assumption for its own body moves |
| CAM (`mm_builder.py`) | classifies `frame*`-named bodies into the 'frame' manufacturing model, lays out `frame_*` bodies in a row | the window's own 4 bars are named to match the SAME convention (§5). **CORRECTED, T82 item 6**: NOT automatic -- `_classify_occurrence` is by COMPONENT name (so the window's bodies land in MM-Frame fine), but `_populate_frame_geometry`'s own body walk only reaches its generic N-bar layout path when the 4 CLASSIC bar names (`frame_top/right/bottom/left`) are ABSENT; on every template that still has them (1-5, 8, 10, 12, 13), `frame_window_*` would be collected into `other_bars` and then never laid out at all. A small CAM change is needed: lay out `other_bars` too, after the classic 4-bar layout, not only when it's the ONLY bar set present |

## 5. Fusion build steps

All four pieces below reuse EXISTING, already-proven machinery (`extrusion_engine.py`, `declared_profiles.py`,
`panel_lip.py`'s own offset-and-append pattern) — nothing here is a new kind of Fusion operation, only a new
INPUT to each one.

1. **Sketch geometry**: **CORRECTED, T82 item 6** — the EXISTING frame-enclosure sketch (the same one
   `panel_lip.py`'s own `_frame_sketch()` locates, via the `Offset` step whose `SourceID == outline`), not a
   new sketch or a new component. A second tagged component would break `find_frame_component`'s "first tag
   hit" lookup, `send_frame.py`'s own `find_frames(design)[-1]`, delete-on-resend, and CAM's single-
   `parentComponent`-per-move assumption — the window's bars belong in the SAME `Frame_N` component as the
   main bars, as new Blocks appended to that one sketch (`panel_lip.py`'s own append pattern, §1 above). The
   new region draws the window's own outer rectangle, inner rectangle (thickness offset), and hole/trim
   rectangle (lip offset) — three nested
   rectangles, all AXIS-ALIGNED (no arcs, no corner-radius concept at all: a rectangle's own 4 corners are
   always 90 deg miters, bisected 45/45, the SAME generic miter rule every other corner in this engine already
   uses — no special case). **UPDATED, T82 item 5**: the record's own `{cx, cy, w, h}` IS the natural input to
   Fusion's own centre-point rectangle construction (`SketchLines.addCenterPointRectangle`, the API's own
   two-point-from-centre form, fusion360-quirks: "the API adds NO constraints" for any rectangle tool --
   add the usual H/V + parallel/perpendicular yourself if the sketch needs them locked) -- the OUTER rectangle
   is `addCenterPointRectangle((cx, cy), (cx + w/2, cy + h/2))`, no corner-coordinate conversion at all; the
   inner and hole rectangles are the SAME centre, offset inward by `frame_thickness` then `panel_lip` (still
   centred at `(cx, cy)`, only the half-extents shrink) -- `core/inset-window.js`'s own `insetWindowOuterRect`
   is the ONE place a board-local x1/y1/x2/y2 form is ever derived from this, for the 2D app side only;
   Fusion-side code should read `cx`/`cy`/`w`/`h` directly and never needs that conversion.
2. **Miters**: 4, one per corner of the OUTER-to-inner pair (outer vertex -> inner vertex, same
   `ResolveInnerCorners`/miter-line mechanism `ResolveInnerCorners`+`p03_04`-style phases already use for
   every template) — direction `(±1,±1)` per corner, the plain axis-aligned case, no T7-style derivation
   needed.
3. **Bars**: 4 new bodies via `ExtrusionEngine._extrude_one_profile()` (`extrusion_engine.py:137-198`), one
   per side of the outer/inner rectangle pair, `NewBodyFeatureOperation` (never merges with the panel or the
   main frame's own bars). Named `frame_window_top` / `frame_window_bottom` / `frame_window_left` /
   `frame_window_right` — starting with `frame` (so `_classify_occurrence()`, `mm_builder.py:1058-1059`,
   still classifies them into the 'frame' manufacturing model) but NOT matching the 4 classic names, so
   `_populate_frame_geometry()` (`mm_builder.py:693-931`) — **CORRECTED, T82 item 6**: this auto-routing into
   `_populate_n_bar_frame_geometry` only actually fires when the classic 4 bar names (`frame_top/right/
   bottom/left`) are ABSENT from the build. Every template that still has them (1-5, 8, 10, 12, 13) collects
   `frame_window_*` into `other_bars` and currently never lays them out at all — a real CAM fix is needed in
   `_populate_frame_geometry()`: lay out `other_bars` too, after the classic 4-bar layout succeeds, not only
   when it is the sole bar set present. (T6/T11, which already use non-classic bar names, happen to hit the
   N-bar path today — that's the one case where the naming choice alone is enough.)
   **Z placement** (Fred: "the way the frame sits relative to the panel lip," behind/under the panel):
   **CORRECTED, T82 item 6** — the main frame's own bars do NOT start at the underside; they start at
   `frame_height_offset` (an `OffsetStartDefinition` measured FROM THE SKETCH PLANE, the same parameter named
   in `frame_definition.py`'s `FRAME_BOTTOM_PARAM`) and their `extent` is a `ToEntityExtentDefinition` TO the
   underside face (`to_face`, from `send_frame.py`'s own `underside_face()`) — i.e. START at the offset, END
   at the underside, the opposite of what an earlier draft of this note assumed. The window bars use the
   IDENTICAL rule (same `start`/`extent` construction, same `frame_height_offset`, no new Z parameter) — the
   offset-and-underside convention already puts them behind the panel by construction; there is no separate
   "start at the underside" mechanism to invoke. (`_sync_offset_param`'s real home is
   `solid_coordinator.py:77-104`, not `extrusion_engine.py`.)
4. **The hole cut**: one new feature, modeled on the `"trim"` entry in `COMMON_FRAME_FEATURES`
   (`frame_definition.py:106-107`) but inverted — a POCKET through the panel/core body instead of a trim
   around the stock's own edge:
   `{"id": "window_cut", "op": "cut", "region": "<the hole/trim rectangle, §2>", "start": "<the frame sketch
   plane, same as the main TRIM_CUT>", "extent": "throughAll", "participants": "<panel/core body only>"}`.
   Same `CutFeatureOperation` / `ThroughAllExtentDefinition` the main TRIM_CUT already uses
   (`extrusion_engine.py:157-185`); the only real difference is the REGION (a fixed small rectangle instead
   of "surround minus outline") and that it must NOT also cut the window's own 4 new bars (set participants
   explicitly, the same way the main TRIM_CUT's own `isParticipantsAutomated` already has to reason about
   which bodies are "the stock" vs "the frame").
5. **`declared_profiles.classify()`** (`declared_profiles.py:78-108`) — **CORRECTED, T82 item 6**: more than
   one new branch, all inserted before the final opening/stray-id check, same dispatch-by-curve-id-set
   pattern already used for `lip`/`outline`/opening:
   - window outer+inner+miter ids (one side) -> a `window_bars`-style feature + that bar's own name
     (`frame_window_top` etc, §5 step 3) — mirrors the existing `outline` branch's `bar_index()` lookup.
   - window inner+hole ids (only relevant once `panel_lip > 0`, mirrors the main `lip` branch) -> `(None,
     None)`, no feature.
   - the hole itself (bounded by the hole/trim rectangle's own ids) -> the `window_cut` feature (§5 step 4).
   - the main opening branch's own stray-id tolerance must ALSO accept the window's own OUTER curve ids once
     a window exists — the main opening profile gains an inner loop made of those ids (the window is a hole
     punched in the middle of the frame's own opening), which today's opening check doesn't expect.
   No new mechanism — one more declared mapping per case, same dispatcher.

## 6. Editor interaction (Frame tab)

A new drag mode, sibling to the existing frame-handle drag (`main/frame-panel.js`'s own handle-drag path) and
the rectangle body/corner drag already used elsewhere in the editor for boundary/extent editing — reuse
whichever of those the implementer finds closest at build time; this note fixes the BEHAVIOUR, not the exact
file to copy from:
- **Body drag**: translates `(cx, cy)` by the same delta (board-local y flips sign onto `cy`, which is +y UP)
  — moves the window without resizing it, `w`/`h` unchanged.
- **Corner drag** (**UPDATED, T82 item 5**, Fred: "use the centre of frame... and make the window a centre
  point rect too"): resizes SYMMETRICALLY about the centre — `(cx, cy)` stay exactly where they were at drag
  start; only `w`/`h` change, each to twice the dragged corner's own new distance from that (unchanged)
  centre. (Superseded: the original note had the corner drag move only the dragged corner, leaving the
  OPPOSITE corner fixed — that was the natural behaviour for the old two-corner storage; Fred's later ruling
  replaced it with the centre-anchored resize above, which is why §2 also moved to centre+size storage.)
- Toggle: a checkbox/switch in the FRAME sidebar panel AND in the Frame tab's own `#editorFramePanel` (T82
  item 5, mirroring T82 item 4's "a second view, not a second setting" pattern for Thickness) — both write
  the same record, both stay in sync; OFF by default, labeled "Inset window" per the dispatch's own wording.
- Position X/Y fields = `cx`/`cy` directly; Size W/H fields = `w`/`h` directly — both pairs, in both panels.
- No board-based initial default beyond "centred, roughly a third of the board" (`cx: 0, cy: 0, w: widthIn/3,
  h: heightIn/3`) — exact seed values are an implementation choice, not a design constraint.

## 7. What stays byte-identical when off

`insetWindow.enabled: false` is the default, and every consumer in §4 is additive and gated on it, mirroring
the established precedent in this codebase (`panelLip: 0` already makes `panelTrimPrimitives()` return `null`
with zero effect, `topDipDepth: 0` already makes T5's own dip a no-op, `hipFlare: 0` already makes T7's own
flare a no-op today) — same shape, new field:
- App: terrain build, stamp rasterization, lattice generation, the 3D preview clip, and the 2D Frame-tab
  drawing all take an early, no-op path when `!record.insetWindow?.enabled` — IDENTICAL output to today,
  not just "visually similar."
- Fusion: no new sketch region, no new bar bodies, no new cut feature, no new `declared_profiles.classify()`
  branch fires.
- CAM: sees no `frame_window_*` bodies, behaves exactly as today.
- The A/B byte-identical scripts (`tools/repro/ab/`) gain `insetWindow` left absent/false in every existing
  case they already run — if any of those hashes change once this is built, that is a real regression, not
  an accepted diff (same discipline the T7 `shoulderLedgeWidth`/`hipFlare` keys were held to this session).

## 8. Test plan (once built — this note is design only, nothing to run yet)

- **A/B**: every existing `tools/repro/ab/` script, `insetWindow` absent — byte-identical to pre-feature HEAD,
  for every template.
- **Geometry, enabled, valid placement**: the app's own clipped mesh has a real hole (triangles missing in the
  expected region, sampled the same way the T7 board-bounds regression sampled `prof.polygon`); a stamp drawn
  straddling the window shows zero depth inside it; a `fromFrame` lattice pattern has no rails/ties inside it;
  Fusion build produces exactly 4 new `frame_window_*` bodies + 1 new cut feature; CAM lists those 4 bodies
  alongside the main frame's own.
- **Hole size**: MEASURED, not assumed — the actual cut boundary equals the inner rectangle offset inward by
  `panelLip` exactly (a direct coordinate check, the same style used to confirm T7's hip-flare cap numerically
  rather than by eye).
- **Z placement**: **CORRECTED, T82 item 6** — the window's own bars' BOTTOM face (the extent end, not the
  start) coincides with the panel's own underside at that location; the TOP face sits at `frame_height_offset`
  from the sketch plane, same as the main frame's own bars. Confirmed in Fusion by inspecting both faces
  directly, not assumed from the parameter wiring alone.
- **Below the validity floor** (window bars/opening <= 0): no crash, no feature built, UI shows the inline
  warning from §3 — mutation-test this guard the same way every other floor in this codebase gets mutation
  tested (temporarily remove the guard, confirm the degenerate case now DOES build/crash, restore).
- **Drag gestures** (**UPDATED, T82 item 5**; superseded: the original note described a corner drag that
  changed one corner and left the opposite one fixed, the natural behaviour for the old two-corner storage):
  body drag translates `(cx, cy)` by an equal delta and leaves `w`/`h` unchanged; corner drag resizes
  SYMMETRICALLY about the centre -- `(cx, cy)` never move, only `w`/`h` change, each to twice the dragged
  corner's own new distance from that fixed centre. Covered by `tests/inset-window-handles.test.js` (DONE,
  T82 item 5) and `tests/inset-window.test.js`'s own migration describe block (old-shape records still load
  correctly).
- **Overlap with the main frame** (Fred: not validated, not prevented): one explicit test that an overlapping
  window still builds SOMETHING well-defined (even if visually poor) rather than throwing — "ugly but not
  broken" is the bar, matching §3's own ruling.
