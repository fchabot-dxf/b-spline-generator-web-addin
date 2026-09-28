/** Save audit #2: the data-editor-layers codec escapes & < > " so a layer named "Rails & Ties" keeps the saved
 *  document valid XML; repairLayersAttr rescues a document saved before the fix. */
import { describe, it, expect } from 'vitest';
import { encodeLayersAttr, decodeLayersAttr, repairLayersAttr } from '../bspline-frame-builder/b-spline-gen/html/editor/layers-attr.js';

const roster = [{ id: '0', name: 'Rails & Ties <main> "x" \'y\'' }, { id: '1', name: '&amp; literal' }];

describe('layers attr codec', () => {
  it('round-trips any name', () => {
    expect(decodeLayersAttr(encodeLayersAttr(roster))).toEqual(roster);
  });
  it('the saved document parses and getAttribute gives the roster back', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-editor-layers="${encodeLayersAttr(roster)}"></svg>`;
    const el = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('svg');
    expect(el).not.toBe(null);
    expect(JSON.parse(el.getAttribute('data-editor-layers'))).toEqual(roster);
  });
  it('repairs an old save with a bare & and <', () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg" data-editor-layers="[{&quot;id&quot;:&quot;0&quot;,&quot;name&quot;:&quot;A & B <c>&quot;}]"><line/></svg>`;
    const el = new DOMParser().parseFromString(repairLayersAttr(bad), 'image/svg+xml').querySelector('svg');
    expect(JSON.parse(el.getAttribute('data-editor-layers'))[0].name).toBe('A & B <c>');
  });
});
