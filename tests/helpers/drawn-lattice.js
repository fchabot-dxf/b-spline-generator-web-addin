/**
 * F17 (P1) test helper: a pattern's pieces exactly as `generatePattern` draws them (computePattern over the
 * extent buildSketchManifest fills, fromLattice, zero-length pieces dropped), as the `{rails, ties, nodes}` input of
 * latticeFromDrawn, and as owned-element attribute stores for export-flow's mock editors.
 */
import { computePattern } from '../../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { latticeExtentFor } from '../../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { fromLattice, MIN_PIECE_LENGTH_IN } from '../../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';

export function drawnFromPattern(pattern, region) {
  const spacing = pattern.spacing || 0.25;
  const { segments, nodePoints } = computePattern(pattern, { extent: latticeExtentFor(pattern, region), occupied: null });
  const line = (s) => ({ p1: fromLattice(s.a, spacing), p2: fromLattice(s.b, spacing), overrideWidth: null });
  const real = (p) => Math.hypot(p.p2.x - p.p1.x, p.p2.y - p.p1.y) >= MIN_PIECE_LENGTH_IN;
  return {
    rails: segments.filter((s) => s.kind === 'rail').map(line).filter(real),
    ties: segments.filter((s) => s.kind === 'tie').map(line).filter(real),
    nodes: nodePoints.map((pt) => ({ c: fromLattice(pt, spacing), overrideWidth: null })),
  };
}

/** Owned-element attribute stores (export-flow.test.js's mockEditor `owned`) for `drawn`, one kind per layer. */
export function ownedStores(drawn, { gen = 'p', layers }) {
  const base = (layer, kind, p) => ({ 'data-layer': layer, 'data-lattice-gen': gen, 'data-lattice': kind,
    ...(p.overrideWidth != null ? { 'data-override-width': String(p.overrideWidth) } : {}) });
  const line = (layer, kind) => (p) => ({ ...base(layer, kind, p),
    x1: String(p.p1.x), y1: String(p.p1.y), x2: String(p.p2.x), y2: String(p.p2.y) });
  return {
    rails: drawn.rails.map(line(layers.rails, 'rail')),
    ties: drawn.ties.map(line(layers.ties, 'tie')),
    nodes: drawn.nodes.map((n) => ({ ...base(layers.nodes, 'node', n), cx: String(n.c.x), cy: String(n.c.y) })),
  };
}
