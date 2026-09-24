/**
 * SE11 — buildDrapeSvg (core/preview/drape-svg.js), the pure filter
 * deciding which vector elements drape onto the 3D relief.
 *
 * Rule (SE11f, Fred's final table): a layer drapes when visible &&
 * showColor (missing field = true, since seat B's T26/SE10 hasn't landed
 * real fields on editor._layers yet) — INDEPENDENT of carve. Carving and
 * painting are two separate gates Fred can toggle independently: 3D off
 * + palette on paints the drape flat on the un-carved relief instead of
 * showing nothing (SE11c/SE11e had draping gated on `isCarved(l) &&
 * showColor`, which this turn replaces).
 * SE11d (Fred, overruling SE11's own advisor-guessed default): black
 * elements drape too — there is no colour skip. An element with NO
 * detectable colour at all (neither stroke nor fill set to anything but
 * 'none') still doesn't drape, since there's nothing to paint.
 *
 * sketchSvg is exactly editor.save()'s own output shape: a full
 * `<svg viewBox="0 0 mW mH">` document with `data-layer` on each child —
 * built by hand here (not via a live editor) so this file has no DOM/
 * svg.js dependency beyond DOMParser/XMLSerializer, which happy-dom
 * already supports (same as editor-io.js's getLayerSvg, exercised by
 * tests/editor-serialization.test.js).
 */
import { describe, it, expect } from 'vitest';
import {
  buildDrapeSvg, DRAPE_TEXTURE_FLIPY, sampleRowForV, nextPow2,
} from '../bspline-frame-builder/b-spline-gen/html/core/preview/drape-svg.js';

const SKETCH = `<svg xmlns="http://www.w3.org/2000/svg" width="672" height="864" viewBox="0 0 7 9" preserveAspectRatio="none">` +
  `<line data-layer="rails" x1="0" y1="1" x2="6" y2="1" stroke="#c62828" fill="none"/>` +
  `<line data-layer="ties" x1="1" y1="0" x2="1" y2="2" stroke="#f9c80e" fill="none"/>` +
  `<circle data-layer="nodes" cx="1" cy="1" r="0.1" fill="#1a237e" stroke="none"/>` +
  `<line data-layer="black-layer" x1="2" y1="2" x2="3" y2="3" stroke="#000000" fill="none"/>` +
  `</svg>`;

const ALL_QUALIFY = [
  { id: 'rails', visible: true, carve: true, showColor: true },
  { id: 'ties', visible: true, carve: true, showColor: true },
  { id: 'nodes', visible: true, carve: true, showColor: true },
  { id: 'black-layer', visible: true, carve: true, showColor: true },
];

function layerIdsIn(svg) {
  if (!svg) return [];
  const matches = [...svg.matchAll(/data-layer="([^"]+)"/g)];
  return matches.map(m => m[1]);
}

describe('buildDrapeSvg — truth table', () => {
  it('all qualifying layers, INCLUDING black: rails/ties/nodes/black-layer all kept', () => {
    const svg = buildDrapeSvg(ALL_QUALIFY, SKETCH);
    expect(layerIdsIn(svg).sort()).toEqual(['black-layer', 'nodes', 'rails', 'ties']);
    expect(svg).toContain('#000000');
  });

  it('hidden layer (visible:false) is excluded even though carve/showColor are true', () => {
    const layers = ALL_QUALIFY.map(l => l.id === 'rails' ? { ...l, visible: false } : l);
    const svg = buildDrapeSvg(layers, SKETCH);
    expect(layerIdsIn(svg)).not.toContain('rails');
    expect(layerIdsIn(svg).sort()).toEqual(['black-layer', 'nodes', 'ties']);
  });

  it('SE11f: carve:false does NOT exclude a layer that is visible and showColor — draping is independent of carving now', () => {
    const layers = ALL_QUALIFY.map(l => l.id === 'ties' ? { ...l, carve: false } : l);
    const svg = buildDrapeSvg(layers, SKETCH);
    expect(layerIdsIn(svg)).toContain('ties');
    expect(layerIdsIn(svg).sort()).toEqual(['black-layer', 'nodes', 'rails', 'ties']);
  });

  it('showColor:false excludes a layer even though it is visible and carved', () => {
    const layers = ALL_QUALIFY.map(l => l.id === 'nodes' ? { ...l, showColor: false } : l);
    const svg = buildDrapeSvg(layers, SKETCH);
    expect(layerIdsIn(svg)).not.toContain('nodes');
    expect(layerIdsIn(svg).sort()).toEqual(['black-layer', 'rails', 'ties']);
  });

  it('missing visible/carve/showColor fields default to true (seat B has not landed T26/SE10 yet)', () => {
    const bareLayers = [{ id: 'rails' }, { id: 'ties' }, { id: 'nodes' }, { id: 'black-layer' }];
    const svg = buildDrapeSvg(bareLayers, SKETCH);
    expect(layerIdsIn(svg).sort()).toEqual(['black-layer', 'nodes', 'rails', 'ties']);
  });

  it('returns "" when no layer qualifies (all hidden)', () => {
    const layers = ALL_QUALIFY.map(l => ({ ...l, visible: false }));
    expect(buildDrapeSvg(layers, SKETCH)).toBe('');
  });

  it('SE11d: a layer whose only element is black now DOES drape (Fred overruled the earlier skip)', () => {
    const onlyBlackQualifies = [{ id: 'black-layer', visible: true, carve: true, showColor: true }];
    const svg = buildDrapeSvg(onlyBlackQualifies, SKETCH);
    expect(svg).not.toBe('');
    expect(layerIdsIn(svg)).toEqual(['black-layer']);
    expect(svg).toContain('#000000');
  });

  it('SE11f: the full 4-row table (carve x showColor, all visible) — drape tracks showColor only', () => {
    const rows = [
      { carve: true,  showColor: true,  drapes: true  }, // carved + painted
      { carve: true,  showColor: false, drapes: false }, // carved, plain
      { carve: false, showColor: true,  drapes: true  }, // painted, NOT carved
      { carve: false, showColor: false, drapes: false }, // nothing
    ];
    for (const row of rows) {
      const layers = [{ id: 'rails', visible: true, carve: row.carve, showColor: row.showColor }];
      const svg = buildDrapeSvg(layers, SKETCH);
      expect(layerIdsIn(svg).includes('rails')).toBe(row.drapes);
    }
  });

  it('returns "" for empty/missing sketchSvg', () => {
    expect(buildDrapeSvg(ALL_QUALIFY, '')).toBe('');
    expect(buildDrapeSvg(ALL_QUALIFY, null)).toBe('');
  });

  it('preserves the sketch\'s own board-sized viewBox/width/height', () => {
    const svg = buildDrapeSvg(ALL_QUALIFY, SKETCH);
    expect(svg).toContain('viewBox="0 0 7 9"');
    expect(svg).toContain('width="672"');
    expect(svg).toContain('height="864"');
  });

  it('keeps each element\'s own color (does not force one color for all)', () => {
    const svg = buildDrapeSvg(ALL_QUALIFY, SKETCH);
    expect(svg).toContain('#c62828');
    expect(svg).toContain('#f9c80e');
    expect(svg).toContain('#1a237e');
  });

  it('an element with no detectable color at all (neither stroke nor fill) still does not drape — a colour skip is not the same as a "nothing to skip" skip', () => {
    const sketchWithBlank = SKETCH.replace(
      '</svg>',
      '<line data-layer="rails" x1="4" y1="4" x2="5" y2="5" stroke="none" fill="none"/></svg>',
    );
    const svg = buildDrapeSvg(ALL_QUALIFY, sketchWithBlank);
    // The blank line has no coordinates in common with the real rails
    // line, so this only passes if the blank one specifically was
    // dropped, not the whole rails layer.
    expect(svg).toContain('x1="0"');
    expect(svg).not.toContain('x1="4"');
  });
});

/**
 * SE11c — the drape/heightfield orientation guard. `sampleRowForV`'s
 * formula and `DRAPE_TEXTURE_FLIPY`'s value are BOTH settled empirically
 * (scripts/smoke-editor.mjs's `drape-align` mode: draw the advisor's
 * asymmetric L, diff the height field before/after to find the REAL
 * carved vertices, and check whether the drape texture reads red at the
 * pixel each vertex's uv predicts — for both flipY values, plus each
 * vertex's Y-mirrored counterpart as a control). Measured result,
 * isolating the confident carve core from the stamp's own edge falloff:
 * flipY=true → 100% of carved vertices read red, only 66% of their
 * mirrors do; flipY=false is the exact inverse. These tests pin THAT
 * measured fact, not a re-derivation of it — two independent reasoning
 * passes at this exact question were each wrong at least once before
 * the measurement settled it, so a comment restating "why" from first
 * principles would be the same trap with different words.
 */
describe('SE11c: drape/heightfield orientation guard (empirically settled — see drape-svg.js comments)', () => {
  it('DRAPE_TEXTURE_FLIPY is true — flip it back only after re-running drape-align, not by re-reasoning', () => {
    expect(DRAPE_TEXTURE_FLIPY).toBe(true);
  });

  it('the declared flipY reproduces the measured mapping: v=1 samples texture row 0', () => {
    const texH = 724;
    expect(sampleRowForV(1, texH, DRAPE_TEXTURE_FLIPY)).toBe(0);
  });

  it('non-vacuous: the OTHER flipY value gives a different (wrong, per the measurement) row', () => {
    const texH = 724;
    expect(sampleRowForV(1, texH, !DRAPE_TEXTURE_FLIPY)).toBe(texH - 1);
    expect(sampleRowForV(1, texH, !DRAPE_TEXTURE_FLIPY)).not.toBe(0);
  });

  it('a vertex and its Y-mirrored counterpart sample DIFFERENT texture rows (the property the drape-align mirror check relies on)', () => {
    const nz = 181, texH = 724;
    const j = 20;
    const v = j / (nz - 1);
    const jMirror = nz - 1 - j;
    const vMirror = jMirror / (nz - 1);
    const row = sampleRowForV(v, texH, DRAPE_TEXTURE_FLIPY);
    const rowMirror = sampleRowForV(vMirror, texH, DRAPE_TEXTURE_FLIPY);
    expect(row).not.toBe(rowMirror);
  });

  it('sampleRowForV is monotonic in v for a fixed flipY (a real per-vertex mapping, not a constant that happens to pass the point checks above)', () => {
    const texH = 200;
    const rows = [0, 0.25, 0.5, 0.75, 1].map(v => sampleRowForV(v, texH, DRAPE_TEXTURE_FLIPY));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]).not.toBe(rows[i - 1]);
    }
  });
});

/**
 * SE11e amend (Fred): pale/white banding on steep groove walls traced to
 * a non-power-of-two drape canvas silently disabling WebGL mipmap
 * generation — nextPow2 is the fix's one pure, testable piece (the
 * actual mipmap behaviour needs a real WebGL context, proven live in
 * Fusion instead — see WORK-LOG).
 */
describe('nextPow2 (SE11e amend: power-of-two texture sizing for mipmaps)', () => {
  it('an exact power of two is returned unchanged', () => {
    expect(nextPow2(512)).toBe(512);
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(1024)).toBe(1024);
  });

  it('rounds UP to the next power of two — never down (would crop the texture)', () => {
    expect(nextPow2(564)).toBe(1024);
    expect(nextPow2(724)).toBe(1024);
    expect(nextPow2(513)).toBe(1024);
    expect(nextPow2(1025)).toBe(2048);
  });

  it('non-vacuous: two different inputs in the SAME power-of-two band round to the SAME value (proves it snaps to a band, not a no-op passthrough)', () => {
    expect(nextPow2(600)).toBe(nextPow2(1000));
    expect(nextPow2(600)).toBe(1024);
  });
});
