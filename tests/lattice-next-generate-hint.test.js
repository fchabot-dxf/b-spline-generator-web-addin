/**
 * Item 74e (advisor; seat D's Artwork audit: the Lattice panels mix live settings -- orientation, size, colours, widths --
 * with ones only Generate reads -- rails anchor / spacing, ties, nodes -- and nothing said which): one hint line over the
 * next-Generate group in BOTH lattice panels, its words declared once (properties-lattice.js LATTICE_NEXT_GENERATE_HINT).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { initLatticeProperties, LATTICE_NEXT_GENERATE_HINT } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-lattice.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8')
  .replace(/<link\b[^>]*>/gi, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
const DOC = new DOMParser().parseFromString(HTML, 'text/html');
const before = (a, b) => !!(a.compareDocumentPosition(b) & 4); // b follows a

describe('item 74e: the next-Generate hint', () => {
  it('the words are declared', () => {
    expect(LATTICE_NEXT_GENERATE_HINT).toBe('Applies on the next Generate');
  });
  it.each([['editorLatticePanelBody', 'lattice'], ['editorShapeLatticePanelBody', 'shapeLattice']])(
    '%s: one hint, after the live Orientation row and before the first next-Generate control (Anchor)', (body, pre) => {
      const hints = DOC.getElementById(body).querySelectorAll('[data-lattice-hint="next-generate"]');
      expect(hints.length).toBe(1);
      expect(before(DOC.getElementById(`${pre}OrientVertical`), hints[0])).toBe(true);
      expect(before(hints[0], DOC.getElementById(`${pre}RailsAnchorStart`))).toBe(true);
      expect(before(hints[0], DOC.getElementById(`${pre}NodesEnds`))).toBe(true);
    });
  it('the panel init writes the declared words into every hint (both panels)', () => {
    document.body.innerHTML = '<div data-lattice-hint="next-generate"></div><div data-lattice-hint="next-generate"></div>';
    initLatticeProperties({}); // no Generate button in this fixture: the panel's own guard returns right after
    for (const n of document.querySelectorAll('[data-lattice-hint="next-generate"]')) expect(n.textContent).toBe(LATTICE_NEXT_GENERATE_HINT);
  });
});
