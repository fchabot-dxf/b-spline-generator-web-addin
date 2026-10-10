/**
 * editor/editor-frame-profile.js EDITOR_TAB_FOCUS (Fred 2026-10-10: "in brick tab the artwork is still 100 opacity";
 * he picked the fade): the art -- the drawing's non-brick nodes -- at 35% in the Brick and Photo tabs, the bricks at
 * full, the frame profile as before; the Frame tab unchanged (the whole drawing at 0.4). Display only: the attribute /
 * style on #sketch-layer itself and a CSS rule (styles/editor.css); the drawing the save / export / carve read (the
 * layer's children) is byte-identical in every tab.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EDITOR_TAB_FOCUS, ART_FADE_OPACITY, INACTIVE_LAYER_OPACITY, setEditorFocus, FRAME_PROFILE_GROUP_ID } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';

const NS = 'http://www.w3.org/2000/svg';
const layerOf = (node) => ({ node, attr(k, v) { if (v == null) node.removeAttribute(k); else node.setAttribute(k, String(v)); return this; } });
function makeEditor() {
  const sketch = document.createElementNS(NS, 'g'); sketch.id = 'sketch-layer';
  const art = document.createElementNS(NS, 'path'); art.setAttribute('d', 'M0 0 L1 1'); art.setAttribute('data-layer', '4');
  const brick = document.createElementNS(NS, 'path'); brick.setAttribute('d', 'M2 2 L3 3'); brick.setAttribute('data-brick', 'frame'); brick.setAttribute('data-brick-gen', '1');
  sketch.append(art, brick);
  const profile = layerOf(document.createElementNS(NS, 'g')); profile.node.id = FRAME_PROFILE_GROUP_ID;
  return { _sketchLayer: layerOf(sketch), _bgLayer: { findOne: (sel) => (sel === '#' + FRAME_PROFILE_GROUP_ID ? profile : null) }, _deselect() {}, profile };
}

describe('EDITOR_TAB_FOCUS: what each editor tab fades (display only)', () => {
  it('declared: Frame as before; Artwork full; Brick and Photo fade the art to 35%, bricks full, the frame profile faded', () => {
    expect(ART_FADE_OPACITY).toBe(0.35);
    expect(EDITOR_TAB_FOCUS).toEqual({
      frame: { drawing: INACTIVE_LAYER_OPACITY, art: 1, frameProfile: 1 },
      artwork: { drawing: 1, art: 1, frameProfile: INACTIVE_LAYER_OPACITY },
      photo: { drawing: 1, art: 0.35, frameProfile: INACTIVE_LAYER_OPACITY },
      brick: { drawing: 1, art: 0.35, frameProfile: INACTIVE_LAYER_OPACITY },
    });
  });

  it('setEditorFocus writes each tab on the layer / group itself -- and switching back clears it', () => {
    const ed = makeEditor(), s = ed._sketchLayer.node;
    const read = () => ({ drawing: s.getAttribute('opacity'), fade: s.hasAttribute('data-focus-art-fade'), art: s.style.getPropertyValue('--focus-art-opacity'), profile: ed.profile.node.getAttribute('opacity') });
    setEditorFocus(ed, 'brick');
    expect(read()).toEqual({ drawing: null, fade: true, art: '0.35', profile: '0.4' });
    setEditorFocus(ed, 'photo');
    expect(read()).toEqual({ drawing: null, fade: true, art: '0.35', profile: '0.4' });
    setEditorFocus(ed, 'frame');
    expect(read()).toEqual({ drawing: '0.4', fade: false, art: '', profile: null });
    expect(ed._artworkLocked).toBe(true);
    setEditorFocus(ed, 'artwork');
    expect(read()).toEqual({ drawing: null, fade: false, art: '', profile: '0.4' });
    expect(ed._editorTab).toBe('artwork');
  });

  it("the drawing (the layer's children: what save / export / Send / the carve read) is byte-identical in every tab", () => {
    const ed = makeEditor(), s = ed._sketchLayer.node;
    const before = s.innerHTML;
    for (const tab of ['brick', 'photo', 'frame', 'artwork', 'brick']) {
      setEditorFocus(ed, tab);
      expect(s.innerHTML, tab).toBe(before);
    }
    // the readers: the save takes the layer's innerHTML (editor-io.js), never the layer node's own attributes
    expect(readFileSync('bspline-frame-builder/b-spline-gen/html/editor/editor-io.js', 'utf8')).toMatch(/let raw = editor\._sketchLayer\.node\.innerHTML;/);
  });

  it('the CSS rule fades only non-brick children, only while a tab fades', () => {
    const css = readFileSync('bspline-frame-builder/styles/editor.css', 'utf8');
    expect(css).toMatch(/#editorSVGContainer #sketch-layer\[data-focus-art-fade\] > :not\(\[data-brick\]\):not\(\[data-brick-record\]\) \{\s*opacity: var\(--focus-art-opacity, 1\);/);
  });
});
