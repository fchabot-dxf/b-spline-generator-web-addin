# NEXT (lane-b) — T46: DESIGN DOC — Boundary mode for the Lattice (Mondrian-style fill of any closed shape)

**Ball: worker (seat B) · epoch 2 · T46.** DOCS ONLY this turn (no code). NO FUSION. T45 + circle add-on merged
(3cea7f5, 741 green; advisor verified in Fusion: 8 nodes → 8 true SketchCircles r=0.075").

## Fred
Screenshot of his svgcreator.pages.dev "Mondrian" effect: a closed boundary filled with a grid of lines cut into
colored runs, with dots at junctions. "Make a new tool like lattice that can create this kind of shape system — make
a plan." Then: "not sure you should reuse the STYLE, the LOGIC is good." Then: **"Don't trim, add ending logic — if
it's simpler than trimming."**

## Source (the deployed site, downloaded by the advisor — the only copy; not in any repo)
`reference/svgcreator-deployed/` in your worktree (UNTRACKED — don't commit it; cite paths/lines). Key:
`effects/mondrian.js` (getIntersections half-open scanline rule :86-152, renderGrid :154-282, stored per-element rolls
data-omit/data-loose/data-cr/data-ci :211 + patch() :351-458), `utils.js` resolveGenerator :110 (boundary → L +
circular A primitives with joint-radius fillets), `pathloop.js` (keypoint/bulge STYLE table), `main.js` :174-233
(chin/neck proportion zones).

## Advisor's plan (design it, challenge it where wrong)
- NOT a new tool: a **Boundary: Board | Shape** mode of the Lattice panel. Everything already built carries over
  (Add Rail/Tie/Node, ends-stretch/bodies-move, Widths, Colors, per-layer pattern, Generate = new seed).
- Boundary = any CLOSED shape on the canvas the user picks (path/rect/circle/ellipse/polygon/text), LINKED by id, not
  copied; editing it refills with the same seed. Their boundary BUILDER (keypoints/bulge styles/zones) is out of v1.
- **Cutting engine** (pure): line × closed path → inside spans. Exact for L and circular A (closed form), numeric
  (≤1e-6) for C/Q/elliptical A; their half-open rule for shared vertices; holes via even-odd; tangency handled.
- Spans cut at grid crossings (their stops logic) → rails/ties; then **runs**: segment length, omit %, loose-end %,
  color variation % from a run palette — with **stored per-piece rolls** so sliders re-apply without reshuffling
  (their data-* trick, as declared attrs).
- Joints = our nodes: frequency %, circle/square, size = Widths › Node size.
- **ENDING RULES instead of trimming** (Fred): a declared table — `on-boundary` (centerline ends on the boundary, cap
  overhangs; pairs with the optional Border piece), `inset` (end pulled back half a width so the round cap touches
  the boundary from inside — default), `joint` (end on boundary + node), `loose` (their loose-end: stop one step
  early). No geometric trimming unless you find a case the rules can't handle — then say which and why.
- Optional **Border** piece = the boundary itself at its own width/color.
- Carve/export: everything stays plain lines + circles → exact in Outline export and in Fusion (measured).
## Deliver
`SE13-BOUNDARY-LATTICE-DESIGN.md` (repo root): data model (PATTERN.boundary = {shapeId, endRule, runs{...},
joints{...}, border}), the cutting math with edge cases, the ending-rule table, how the link refreshes (commit-only),
UI mock (ASCII) of the panel, interaction with move/stretch (a stretched end may leave the boundary — rule?), undo,
save/load, slices (each browser-provable), and open questions for Fred. Keep it tight.
## When done
Commit by path (the doc + WORK-LOG only), push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T46: SE13 boundary lattice design — <sha>"`
and stop.
