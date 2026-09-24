/**
 * F11a — persistent lock-in for the EDM editor-serialization fixes.
 *
 * Guards the base64 "poison" fix (EDM2), the one serializeEditor(forRaster)
 * path (EDM3), and the getLayerSvg svgjs-edge routing (EDM3b) so they can't
 * silently regress. Imports the SHIPPING modules from the b-spline-gen tree
 * and drives them through a mock editor (the serializers only read
 * _sketchLayer.node.innerHTML / _mW / _mH / _draw — no real svg.js needed).
 *
 * NOTE: the editor tree is forked (b-spline-gen + stamp-editor, kept in sync
 * by sync_stamp_bundle.py). This suite pins the b-spline-gen copy; the same
 * fixes live in the stamp-editor copy. Run: `npm test`.
 */
import { describe, it, expect } from 'vitest';
import {
  encodeSnapshot,
  decodeSnapshot,
  stripOriginalAttrs,
} from '../bspline-frame-builder/b-spline-gen/html/core/svg-utils.js';
import {
  save,
  getLayerSvg,
  saveForRasterization,
  stripRasterizationFontDefs,
  _reconcileLayersFromSvg,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';

// Strict image/svg+xml parse (exactly what open()/getLayerSvg do). Returns
// whether the parse errored and the first <path>, so tests can assert both
// well-formedness and element survival.
function parseSvg(str) {
  const doc = new DOMParser().parseFromString(str, 'image/svg+xml');
  return { err: !!doc.querySelector('parsererror'), path: doc.querySelector('path') };
}

// Minimal stand-in for a VectorEditor: the content serializers read only
// these fields. _layers/[]/_activeLayer null keep _serializeLayersAttr a no-op.
function mockEditor(innerHTML, { mW = 7, mH = 9 } = {}) {
  return {
    _draw: {},
    _sketchLayer: { node: { innerHTML } },
    _mW: mW,
    _mH: mH,
    _layers: [],
    _activeLayer: null,
  };
}

const SNAPSHOT = '<path fill="none" stroke="#000000" d="M1 1 L2 2 L3 1"/>';
// SVG carrying a data-original-svg attribute holding `attrVal`, plus a real
// filled path to check survives the strict parse.
const withOriginalAttr = (attrVal) =>
  `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000000" data-layer="0" data-original-svg="${attrVal}" d="M1 1 L2 2 Z"/></svg>`;

describe('svg-utils: encodeSnapshot / decodeSnapshot', () => {
  it('round-trips ASCII markup', () => {
    expect(decodeSnapshot(encodeSnapshot(SNAPSHOT))).toBe(SNAPSHOT);
  });

  it('round-trips Unicode (accents + emoji) without corruption', () => {
    const uni = '<text>café — naïve — 𝑓(x) — 😀</text>';
    expect(decodeSnapshot(encodeSnapshot(uni))).toBe(uni);
  });

  it('encoded output is XML-attribute-safe (no raw < or >)', () => {
    const enc = encodeSnapshot(SNAPSHOT);
    expect(enc).not.toMatch(/[<>]/);
  });

  it('decodeSnapshot passes LEGACY raw markup through unchanged', () => {
    // A pre-EDM2 value still holds raw markup (contains "<"); it must survive
    // so old saved drawings still re-edit.
    expect(decodeSnapshot(SNAPSHOT)).toBe(SNAPSHOT);
  });

  it('handles empty input on both ends', () => {
    expect(encodeSnapshot('')).toBe('');
    expect(decodeSnapshot('')).toBe('');
  });
});

describe('svg-utils: stripOriginalAttrs', () => {
  it('removes data-original-svg and data-original-text-svg', () => {
    const s = '<path fill="#000000" data-original-svg="AAA" data-original-text-svg="BBB" d="M0 0"/>';
    const out = stripOriginalAttrs(s);
    expect(out).not.toContain('data-original-svg');
    expect(out).not.toContain('data-original-text-svg');
  });

  it('keeps real attributes like fill', () => {
    const s = '<path fill="#000000" data-original-svg="AAA" d="M0 0"/>';
    expect(stripOriginalAttrs(s)).toContain('fill="#000000"');
    expect(stripOriginalAttrs(s)).toContain('d="M0 0"');
  });
});

describe('EDM2: base64 data-original poison regression (the whole point)', () => {
  it('base64 snapshot (encodeSnapshot) parses fine and preserves fill', () => {
    // Uses the REAL encodeSnapshot: reverting it to raw markup makes this fail.
    const { err, path } = parseSvg(withOriginalAttr(encodeSnapshot(SNAPSHOT)));
    expect(err).toBe(false);
    expect(path).not.toBeNull();
    expect(path.getAttribute('fill')).toBe('#000000');
  });

  it('raw-markup snapshot makes the strict parse fail (element dropped)', () => {
    // What the pre-EDM2 code stashed: real serialization &quot;-escapes the
    // quotes but leaves the raw < > that make the containing SVG invalid XML.
    const raw = SNAPSHOT.replace(/"/g, '&quot;');
    const { err, path } = parseSvg(withOriginalAttr(raw));
    expect(err).toBe(true);
    expect(path).toBeNull();
  });
});

describe('EDM3: serializeEditor forRaster path (via save / getLayerSvg)', () => {
  const B64 = encodeSnapshot(SNAPSHOT);
  const innerHTML = `<path fill="#000000" data-layer="0" data-original-svg="${B64}" d="M1 1 L2 2 Z"/>`;

  it('save() keeps base64 data-original-* (forRaster:false) and stays valid XML', () => {
    const out = save(mockEditor(innerHTML));
    expect(out).toContain('data-original-svg=');
    expect(out).toContain(B64);
    expect(parseSvg(out).err).toBe(false);
  });

  it('getLayerSvg() strips data-original-* (forRaster:true) and stays valid XML', () => {
    const out = getLayerSvg(mockEditor(innerHTML), '0');
    expect(out).not.toContain('data-original-svg');
    expect(parseSvg(out).err).toBe(false);
    expect(out).toContain('data-layer="0"'); // the real geometry survived
  });
});

describe('EDM3b: getLayerSvg layer filter + svgjs edge', () => {
  it('keeps only children matching the requested data-layer', () => {
    const html = '<path data-layer="0" d="M0 0"/><path data-layer="1" d="M1 1"/>';
    const out0 = getLayerSvg(mockEditor(html), '0');
    expect(out0).toContain('M0 0');
    expect(out0).not.toContain('M1 1');
  });

  it('returns content (not "") for a child carrying a svgjs: attr', () => {
    // The EDM3b fix strips svgjs BEFORE the strict parse. Undeclared svgjs:
    // prefix would otherwise parsererror -> "" (empty stamp).
    const html = '<path svgjs:data="{&quot;a&quot;:1}" fill="#000000" data-layer="0" d="M2 2 L3 3"/>';
    const out = getLayerSvg(mockEditor(html), '0');
    expect(out).not.toBe('');
    expect(out).toContain('M2 2');
    expect(out).not.toContain('svgjs:');
  });

  it('returns "" when the layer has no matching children', () => {
    expect(getLayerSvg(mockEditor('<path data-layer="0" d="M0 0"/>'), '99')).toBe('');
  });

  it('returns "" when the editor is not drawn yet', () => {
    expect(getLayerSvg({ _draw: null, _sketchLayer: {} }, '0')).toBe('');
  });
});

describe('SE8a / SA-TEXT-2: rasterization-fonts defs do not accumulate', () => {
  // open() used to inject the ENTIRE previously-saved document — defs
  // block included — straight into the live sketch layer, so the NEXT
  // save's serializeEditor(editor) read would already contain the STALE
  // block as part of its own content. This simulates exactly that state
  // (what saveForRasterization actually sees on the 2nd+ cycle) without
  // needing a full open()/font-lookup round trip: this test environment's
  // document.styleSheets is empty, so getEmbeddedFontCss always resolves
  // null here regardless — meaning saveForRasterization can never
  // actually EMBED a fresh block in this suite either, which is fine:
  // the bug was specifically that an OLD one lingered forever, not
  // whether a new one gets added (that half already worked).
  const staleBlock =
    '<defs class="rasterization-fonts"><style type="text/css">@font-face{font-family:"Old";src:url(x);}</style></defs>';

  it('strips a pre-existing rasterization-fonts block from the content before returning', async () => {
    const staleContent = staleBlock + '<path fill="#000000" data-layer="0" d="M1 1 L2 2 Z"/>';
    const out = await saveForRasterization(mockEditor(staleContent));

    expect(out).toContain('M1 1 L2 2 Z'); // real geometry survives
    const matches = out.match(/<defs class="rasterization-fonts">/g) || [];
    expect(matches.length).toBeLessThanOrEqual(1); // never MORE than the one this call itself might add
    expect(out).not.toContain('"Old"'); // the STALE font-face rule specifically is gone, not just deduped
  });

  it('strips ALL copies if more than one had already accumulated before this fix landed', () => {
    const doubled = staleBlock + staleBlock + '<path d="M0 0"/>';
    expect(stripRasterizationFontDefs(doubled)).toBe('<path d="M0 0"/>');
  });

  it('serialize -> open -> serialize, three times: exactly one block survives (never nests)', async () => {
    // Simulates the full accumulation cycle without needing open()'s
    // heavier DOM machinery: each "open" step is exactly what open()'s
    // OWN new strip does to the content before it becomes live sketch
    // children again (svgEl.querySelectorAll('.rasterization-fonts')
    // .forEach(remove) — the DOM form of the same stripRasterizationFontDefs
    // the save side uses on a string). A fresh embed never actually
    // happens in this environment (see the comment above), so this
    // proves the "never MORE than one, never nests" half — the half
    // that was actually broken.
    let content = '<path d="M0 0"/>';
    for (let cycle = 0; cycle < 3; cycle++) {
      const out = await saveForRasterization(mockEditor(content));
      const matches = out.match(/<defs class="rasterization-fonts">/g) || [];
      expect(matches.length).toBeLessThanOrEqual(1);
      content = stripRasterizationFontDefs(out); // the "open()" step
    }
  });
});

describe('SE8b / SA-TEXT-3: the orphan-adoption walk skips metadata node types', () => {
  // _reconcileLayersFromSvg exported specifically for this (despite the
  // underscore) — open() itself needs a much heavier mock than this one
  // function alone (clear/svg/children/_bgLayer/_gridLayer/_deselect/
  // resetPanState/sync3DBackground).
  function mockChild({ type = 'path', dataLayer = null }) {
    let layer = dataLayer;
    return {
      type,
      attr: (name, val) => {
        if (name !== 'data-layer') return null;
        if (val !== undefined) { layer = val; return; }
        return layer;
      },
      node: { tagName: type.toUpperCase(), getAttribute: (n) => (n === 'class' ? '' : null) },
    };
  }
  function mockReconcileEditor(children) {
    return { _sketchLayer: { children: () => ({ toArray: () => children }) } };
  }

  it('does not adopt a <defs> block (e.g. the rasterization-fonts one) as an orphan', () => {
    const defsChild = mockChild({ type: 'defs' });
    const pathChild = mockChild({ type: 'path', dataLayer: '0' });
    const editor = mockReconcileEditor([defsChild, pathChild]);

    _reconcileLayersFromSvg(editor);

    expect(defsChild.attr('data-layer')).toBeNull(); // never stamped
    expect(editor._layers).toHaveLength(1);           // just the real layer '0' — no phantom layer for the defs
    expect(editor._layers[0].id).toBe('0');
  });

  it('style/title/desc are skipped too, not just defs', () => {
    const skipped = ['style', 'title', 'desc'].map((type) => mockChild({ type }));
    const pathChild = mockChild({ type: 'path', dataLayer: '0' });
    const editor = mockReconcileEditor([...skipped, pathChild]);

    _reconcileLayersFromSvg(editor);

    for (const ch of skipped) expect(ch.attr('data-layer')).toBeNull();
    expect(editor._layers).toHaveLength(1);
  });

  it('a REAL orphan (no data-layer, not metadata) is still adopted — the skip is type-specific, not blanket', () => {
    const orphanPath = mockChild({ type: 'path' }); // no data-layer, but IS geometry
    const editor = mockReconcileEditor([orphanPath]);

    const anchorId = _reconcileLayersFromSvg(editor);

    expect(orphanPath.attr('data-layer')).toBe(anchorId); // still adopted, unaffected by the metadata skip
    expect(editor._layers).toHaveLength(1);
  });

  it('a document with ONLY a defs block still gets an anchor layer (not zero layers)', () => {
    const defsChild = mockChild({ type: 'defs' });
    const editor = mockReconcileEditor([defsChild]);

    const anchorId = _reconcileLayersFromSvg(editor);

    expect(editor._layers).toHaveLength(1);
    expect(anchorId).toBe(editor._layers[0].id);
    expect(defsChild.attr('data-layer')).toBeNull(); // still never stamped
  });
});
