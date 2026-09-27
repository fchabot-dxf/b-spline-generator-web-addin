# SE16 ✂ CUT TOOL — design (F16, seat C, 2026-09-26)

DESIGN ONLY: no product code yet. It builds on seat A's H1 SNAP-SPLIT, MERGED on main (`407e4cc`, merged into
fb-app for this design).
Spec: ROADMAP.md "SE16" and Fred's rulings there (lattice cut pieces move TOGETHER; direct edit on plain lines moves
them INDEPENDENTLY).
Mockup 1's caption ("a joint wins") predates Q5; the cut follows the toggles.
Mockups: PNG renders in `shots\seatC\*_F16_*`; their source is `tools/repro/cut_tool_mockups.py` (SVGs are git-ignored).

## 0. Questions for Fred — ALL ANSWERED (2026-09-26, relayed by the advisor in F17)

| # | Question | Fred's answer |
|---|---|---|
| Q1 | **Send as drawn.** Today Send rebuilds lattice rails/ties from the pattern's settings, not from what is on the canvas (§2 P1). So a hand-dragged rail, and any cut, reaches Fusion at its GENERATED position. Should Send send the pieces as drawn? | **Yes.** Done in F17 (P1). |
| Q2 | **Regenerate after cutting.** Regenerate rebuilds every rail/tie from the settings, which clears cuts (as it already clears per-piece colours/widths). Keep that? | **Regenerate CLEARS cuts** (Undo restores). |
| Q3 | **Dragging a joint** in a lattice: slide the cut ALONG the rail (the rail stays straight), or move it freely (bends the rail, so it stops being one rail)? | **Slides ALONG the rail** (mockup 4). |
| Q4 | **Join**: the two segments may have different colours/widths. Which one does the joined rail keep? | **Neither: a Join clears BOTH segments' overrides.** The joined rail returns to the lattice default colour/width. |
| Q5 | **Snapping while cutting**: always "joints, then grid", or the normal GRID/GEOMETRY toggles? | **The normal H1 toggles, like every other gesture; Alt = exact.** The spec's "shared coincident points" meant FUSION: the two segment ends at a cut get an explicit Coincident WHEREVER the cut is (mid-rail or at a tie crossing). There is no forced joints-then-grid rule. |
| Q6 | **Plain lines** (Direct edit, non-lattice): after a cut, grabbing the shared point moves ONE line's end (opens a gap), as you ruled ("normal mode is indiscriminate"). Confirm? | **Confirmed** (unchanged Direct-edit behaviour). |

## 1. The tool (gestures)

```
 main tool rail:  [Select] [Direct] [✂ Cut] [Line] …      (main rail only; no lattice-panel button, no "cut all")

 ✂ hover a line   → a marker shows WHERE the cut lands (mockup 1), snapped by the normal GRID / GEOMETRY toggles (Q5)
 ✂ tap            → the line splits there into two segments that share ONE point (the joint ◇)
 ✂ tap a joint ◇  → Join: the two segments become one line again
 Alt (held)       → no snapping: the cut lands exactly under the finger (projected onto the line)
```

- **Lines only:** a lattice rail, a lattice tie, or a plain `<line>`. Contour paths already have segments (SE14b) and
  are not cut by this tool. Circles/nodes and paths are ignored, and the marker does not show on them.
- **Mobile:** tap = cut. The joint diamond's grab target is the finger-sized `handlePx` tier (the same tolerance tier
  as today's end handles).

## 2. Prerequisites (each its own item, before the tool)

- **P1 Send as drawn (Q1).**
  - `manifestFromLattice` (editor/editor-sketch-manifest.js:257) re-runs `computePattern(pattern, …)` (:260) and reads
    only widths from the DOM, matched by DOM order (`_overridesForLayer`, main/export-flow.js:167).
  - A drag writes the DOM only (`_finishLatticeMove`, editor/editor-interaction.js:1478, pushes undo, nothing else).
  - After a cut the DOM has MORE pieces than `computePattern`, so the positional width mapping would also misalign.
  - **Change:** the lattice manifest reads its rails/ties/nodes FROM the owned DOM pieces (endpoints, width, colour
    override), keeping everything the manifest derives today: kind, contour hits, attachment coincidents. The
    `railGroup` key comes from the §3 chain derivation instead of from `computePattern`.
  - **Test:** a dragged rail's Slot sits where it was drawn. It is RED today; that is the proof of the gap.
- **P2 Hand edits survive the boundary refill.**
  - `refreshBoundaryPatterns` (editor/editor-lattice-pattern.js:2326) regenerates a boundary-linked pattern (every
    Shape Lattice) on EVERY commit. The only exception is the one-shot `_skipBoundaryRefillOnce` set by a Select-grab
    of a piece (:2339).
  - A cut or join commit would therefore be wiped at once.
  - **Change:** declare the commit kinds that refill (a boundary/contour change) instead of a one-shot skip flag. A
    cut/join/piece-move commit does not refill.
  - **Test:** cut in a Shape Lattice, then any unrelated commit: the cut is still there.
- **P3 H1:** done (merged, `407e4cc`). The cut tool snaps through H1's resolver (§5).

## 3. Data: NO new schema; membership by DERIVATION

- **What a segment is:** an ordinary owned piece, e.g. `<line data-lattice="rail" data-lattice-gen="<pattern id>"
  data-layer=…>`, exactly what `emitSegment` (editor/editor-lattice.js:408) draws today.
  - No parent id and no "cut" flag: a cut rail is simply several rail lines.
  - Per-piece colour/width are the existing UI5 attributes on each segment (`data-override-color` /
    `data-override-width`, editor/editor-piece-override.js:26-27).
- **The derivation, declared once** (new pure module `editor/editor-lattice-chains.js`):

```
 latticeChains(pieces, tol = JOINT_TOL) → [{ kind, axis, segments:[el…] (ordered along the axis),
                                            outerEnds:[p0, pN], joints:[p…] }]
   same kind (rail|tie)  AND  collinear (same row: |Δ⊥| ≤ tol)  AND  end-to-end touching (|end − start| ≤ tol)
   → one chain.  A gap (> tol) = separate chains.  Colour / width are NOT inputs (they can't split a rail).
```

- `JOINT_TOL` is ONE declared constant. It is the value SE7i's attachment already uses (`_sameWorldPoint` tol 1e-6,
  editor-interaction.js:1095; `sameRow`, editor-lattice.js:239), promoted to a named export and read by both (no
  second tolerance).
  - It holds because a cut writes both new ends from the SAME number (the snapped point), and lattice moves re-snap to
    lattice coordinates (`toLattice`/`fromLattice`), so joints never drift apart.
- **The chain vs `railGroup` (T73):** `railGroup` is a GENERATION-time key from `computePattern` (a boundary crossing
  splits a row into pieces with a GAP; editor-lattice-pattern.js:1702). A chain is a DRAG-time and SEND-time
  derivation from the pieces as drawn.
  - Pieces separated by a boundary gap are separate chains, which is correct.
  - After P1 the manifest's `railGroup` = the chain.
- **The same derivation runs** at every drag start and at every Send. There is nothing to keep in sync, which is
  Fred's "it's derived anyways".

## 4. Cut and Join (pure functions, `editor-lattice-chains.js`)

- **`cutLine(el, p)`**
  - `p` is the resolved point on the line (§5); it must be strictly inside the line, at least one lattice cell from
    either end for a lattice piece.
  - `el` becomes `[a, p]`, and a clone becomes `[p, b]`.
  - Both new ends are written from the same `p` (identical numbers).
  - The clone copies every attribute: kind, gen, layer, stroke, overrides. So both halves start with the same colour.
  - One undo step.
- **`joinAt(p)`**
  - Finds the two same-kind segments of one chain that meet at `p` (within `JOINT_TOL`), and replaces them with one
    line from the first's start to the second's end.
  - Clears BOTH segments' colour/width overrides (Q4): the joined line takes the lattice default.
  - One undo step.
  - A tap on a point that is not a joint (a line end, a tie contact) does nothing.
- **Inverse:** `joinAt(cutLine(el, p))` restores `el`'s geometry and kind exactly; its overrides are cleared (Q4)
  (a test).

## 5. Snapping: through H1's ONE resolver (no second resolver)

- **H1 as merged** (read on fb-app after merging main):
  - `editor/editor-snap-resolver.js`: `geometrySnapTargets(editor, excludeEl)` (every visible element's `getNodes`,
    per-segment midpoints, line–line intersections), `nearestGeometrySnap(pt, editor, tol, excludeEl)`,
    `GEOMETRY_SNAP_TOL_PX = 10`.
  - `editor-grid.js` `snapFor(pt, editor, mode, phase, bypass, excludeEl)` (:128): `SNAP_POLICY[mode]`, then
    geometry wins within its tolerance, else the grid.
  - Lattice axis-locked drags use `_geometryAxisSnap(editor, move, pt, axis)` (editor-interaction.js:1417): the
    nearest geometry point as a canonical axis value, excluding `move.el`, else the caller's grid/row value.
- **The cut tool adds a POLICY and one query, not a resolver.**
  - `SNAP_POLICY.cut = 'onLine'`, and `snapFor` dispatches it to a new `snapOnLine(pt, editor, lineEl, bypass)` in
    `editor-snap-resolver.js`, next to `nearestGeometrySnap`. It projects the pointer onto `lineEl`.
  - It obeys the H1 toggles exactly like every other gesture (Q5), with the candidates restricted to the line:
    - **GEOMETRY on:** H1's geometry targets that lie ON `el` (within `JOINT_TOL` of the line: tie contacts,
      crossings, nodes, segment ends); the nearest within `GEOMETRY_SNAP_TOL_PX` wins;
    - **else GRID on:** the line's crossings with the grid lines (for an axis-aligned rail, x = k·spacing), the
      nearest within the same tolerance;
    - **else, or with Alt:** the projection itself (exact).
  - Wherever the cut lands, the Fusion side joins the two ends with an explicit Coincident (§7).
- **Joint slides and chain drags** reuse `_geometryAxisSnap` unchanged except for one additive widening:
  - `excludeEl` becomes "an element or a Set of elements", in `geometrySnapTargets` / `nearestGeometrySnap` /
    `_geometryAxisSnap`, and a chain drag passes the whole chain.
  - Without that, a cut rail's segment would snap onto its own sibling's joint (a self-snap that H1 guards against
    for single pieces).
  - Test: a chain move never snaps to one of its own joints.
- **Seat A:** these are additive changes to seat A's merged H1 files, so the implementing turn should tell the
  advisor, who routes it.

## 6. Drag rules

**Lattice (Select-drag and the lattice / Shape Lattice handlers, `_beginLatticeMove`, editor-interaction.js:1110).**
At drag start the grabbed piece expands to its CHAIN (§3), and the chain then behaves exactly like the uncut piece:

| Grab | Uncut rail today | Cut rail (SE16) |
|---|---|---|
| body of any segment | move: `moveRailAlongAxis` (editor-lattice.js:224) + attached ties stretch (`_writeRailMove`, editor-interaction.js:1289) | the SAME call on the chain's union extent (min..max along the axis), so attachment is derived against the whole rail; every segment is written |
| a TRUE outer end (within the `nearestEndWithin` zone, editor-lattice.js:286) | stretch (`stretchRailEnd`, :307; min 1 cell; contour clamp; H1 `_geometryAxisSnap` 'i') | stretch that chain end only; the same snap, excluding the chain |
| a JOINT ◇ | (does not exist) | **slide the joint along the axis (Q3):** both touching ends move together; target = `_geometryAxisSnap` 'i' (excluding the chain) else the grid; clamp so each neighbour keeps ≥ 1 cell; ties are not moved |
| a tie on a cut rail | `translateTie` / attach (SE7i) | unchanged: attachment is derived against the chain, so a tie on ANY segment follows |

- **Ties can be cut too:** the same rules on the tie's own axis.
- **Select free move of ONE segment** (a plain Select-drag with the segment alone selected) = an intentional break,
  unchanged (risk 3).
- **Deleting a middle segment** leaves two chains = two rails (risk 4, intended).

**Direct edit, plain lines:** after a cut, each piece is an unrelated line (Fred). No chain derivation runs outside
the lattice. Moving one piece, or the shared point, moves that piece only (Q6).

## 7. Fusion side (after P1)

- **Each segment is its own `Slot` entity** (the manifest already emits one Slot per rail/tie piece,
  editor-sketch-manifest.js:220-233).
- **A chain = a `railGroup`**, so the existing constraint emitters apply unchanged:
  - one H/V constraint per group (`emitAxisOncePerGroup`, :335);
  - `Collinear` between consecutive segments (`collinearForGroups`, :344-352).
- **Joint** = separate points plus an **explicit `Coincident(segK:E, segK+1:S)`**, deletable in Fusion (the spec).
  Emitted like today's explicit tie/rail coincidents (:318-322).
- **Ties** attach to the segment whose extent holds the contact (`pieceEndOrCurveTarget`, :186, chosen by segment).
- **Constraint budget:** constraints are emitted only while `pieceCount < SKETCH_PIECE_THRESHOLD` (:268). Cuts add
  pieces; the threshold counts segments, stated.
- **Python side** needs no change: `_create_slot_entity` / `_apply_constraints`, sketch_manifest_builder.py:385/:511.

## 8. Undo, colour

- **Undo:** a cut, a join, and a joint slide are each one `pushState()` (editor.js:464). The snapshot is the sketch
  SVG plus the patterns, so segments and their attributes come back exactly. No new mechanism.
- **Colour per segment (Fred's GOAL):** each segment is a rail/tie piece, so the UI5 "Selected piece" panel
  (lattice-piece-panel.js `mountSelectedPiecePanel`) colours and widens it unchanged.
  - Layer-wide recolours already skip overridden pieces (`recolorOwnedKind`, editor-lattice-pattern.js:2440).
  - SEG-COLOR-PANEL (seat A) is the CONTOUR's segments (`pattern.contour.segmentColors[i]`): a different store for a
    different kind, and untouched by SE16.
  - After P1, Send carries each segment's width override (already per piece). Per-piece colour does not reach Fusion
    today for any piece (UNVERIFIED on the Python side); it is out of scope here.

## 9. Break risks → guards (ROADMAP's list, each a test in §10)

1. **Joint ends drift apart:** both ends are written from one number, lattice moves re-snap, and touching uses the
   declared `JOINT_TOL` (A3, A9).
2. **Grabbing a joint as if it were an end would open a gap:** a joint is a separate grab class that slides; only
   chain outer ends stretch (A5).
3. **Select free-move of one segment:** an intentional break (A7).
4. **Deleting a middle segment:** two rails (A8).
5. **Colour/width splitting a rail:** they are not chain inputs (A2, and the coloured variant of every A-case).

## 10. Acceptance test plan (concrete cases, where each lives)

**The harness, two levels.** No test today drives the lattice drag handlers outside a real browser (checked: only
`tests/editor-lattice.test.js` tests the drag MATH, and `tools/repro/select_drag_shape.mjs` the real gesture). So:

- **(a) vitest.** The chain-aware drag core is written as a PURE function,
  `planLatticeDrag(pieces, grab, delta) → new endpoints`: the chain expansion, the grab class (body / outer end /
  joint), `moveRailAlongAxis` / `stretch*` / `translateTie` on the chain. The handlers call it, so the equality test
  runs on the same code the gesture runs.
- **(b) real Chrome.** The same cases end to end through real pointer events (`tools/repro/cut_tool_acceptance.mjs`).

The fixture is one pattern per orientation (horizontal, vertical): 3 rails × 4 ties, a brick layout, from
`computePattern`.

Three copies are built:
- **U**, uncut;
- **C**, the middle rail cut at 2 joints plus one tie cut at 1 joint;
- **K**, = C with EVERY segment a different colour and one a different width.

The same gesture list runs on each, (a) through `planLatticeDrag` and (b) through the handlers in Chrome. After
every gesture it compares `canon(pieces)`: pieces merged by chain into canonical rails/ties plus node centres,
sorted.

**Pass** = `canon(U) == canon(C) == canon(K)` to 1e-9 after every gesture, and in K every segment keeps its own
colour/width.

| id | gesture (both orientations) | expectation | file |
|---|---|---|---|
| A1 | drag each segment of the cut rail (grab its body) by +2 cells, then −1 | = dragging the uncut rail; every attached tie stretches identically | `tests/cut-tool-acceptance.test.js` |
| A2 | A1 on K | = U; colours and the width override stay on their segments | same |
| A3 | 20 alternating drags, then chains re-derived | still one chain; every joint's two ends are bit-identical | same |
| A4 | tie drags (slide along its rails, re-attach to another rail) with a tie on each segment | = U | same |
| A5 | stretch each TRUE outer end ±2 cells; then grab a joint ◇ and slide it ±1 cell | the stretch = U; the slide moves both touching ends, rail extent unchanged, no gap, neighbours ≥ 1 cell | same |
| A6 | the cut tie: drag its rail, drag the tie itself | = U | same |
| A7 | Select free-move of ONE segment | the chain splits (expected difference from U, asserted as such) | same |
| A8 | delete the middle segment | two chains; dragging either moves only it | same |
| A9 | undo/redo through A1–A5 on K | the state after each step = the recorded one; colours intact | same |
| U1 | `latticeChains`: collinear + touching = 1; a gap of 1e-3 = 2; 1e-7 offset = 1; colour/width differ = still 1; different kind = 2 | the unit cases | `tests/cut-tool.test.js` |
| U2 | `cutLine` / `joinAt`: identical joint numbers, attributes copied, join∘cut = the original geometry with overrides cleared (Q4), a non-joint tap is a no-op, a cut < 1 cell from an end is refused | the unit cases | same |
| U3 | cut snapping (`snapOnLine` via `snapFor` 'cut'): GEOMETRY on = a joint on the line beats the grid; GRID only = a grid crossing on an off-grid (RAIL-SPACING) rail; both off, or Alt = the projection | against H1's resolver | `tests/editor-grid.test.js` (where H1's resolver tests live; seat A's file, extended) |
| U4 | chain self-snap: a chain move / joint slide never snaps to one of its own segments' points (the Set `excludeEl`) | the self-snap guard | same |
| M1 | manifest of C: N Slots per chain, one H/V per chain, Collinear consecutive, one Coincident per joint, ties coincident to the right segment | after P1 | `tests/editor-sketch-manifest.test.js` |
| P1 | a hand-dragged rail's Slot sits where it was drawn | RED today | same |
| P2 | a cut in a Shape Lattice survives an unrelated commit | RED today | `tests/cut-tool-acceptance.test.js` |
| L1 | live Chrome, desktop + mobile: A1, A2, A5, A7 with real pointer events, plus hover the marker, tap-cut at a joint, tap-join | `canon` equality read back from the DOM + shots | `tools/repro/cut_tool_acceptance.mjs` (new, on the `select_drag_shape.mjs` pattern) |

**Non-vacuous:** every A-case must fail against a naive cut. For example, run A1 with the chain expansion disabled:
only the grabbed segment moves, so `canon(C) ≠ canon(U)`. The mutation list goes in the implementing turn's log.

## 11. Implementation order (after H1 merges and Fred's answers)

1. P1 Send as drawn (+ M1/P1 tests).
2. P2 refill commit kinds.
3. `editor-lattice-chains.js` (U1, U2).
4. The ✂ tool + the `'onLine'` snap (U3) + the marker.
5. `planLatticeDrag` extracted from the handlers (the uncut A-cases green FIRST: a pure refactor), then made
   chain-aware (A1–A9).
6. Live L1 + shots.

Each is its own commit, pushed as it lands.
