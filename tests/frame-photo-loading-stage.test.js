/**
 * Seat D 2026-10-08 (phone audit, 390 px, CPU x4, a real tap; Fred's rule: a loading signal before every long
 * computation): a photo PATTERN pick blocked ~1.2 s on its decode before the rebuild's card came up. The declared
 * 'photo' stage (core/loading-signal.js) is on screen BEFORE the decode starts and stays up until it is done.
 * (The Frame tab's 'frame' stage: tests/frame-gen.test.js.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

let resolveDecode;
const decode = vi.fn(() => new Promise((r) => { resolveDecode = r; }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/patterns.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadPhotoPatterns: vi.fn(() => Promise.resolve([{ id: 'p1', name: 'Bark', image: 'data:image/png;base64,AA', thumb: '', settings: {} }])) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/state.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ensurePhotoDecoded: (...a) => decode(...a) };
});

import { initPhotoPanel } from '../bspline-frame-builder/b-spline-gen/html/main/photo-panel.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { LOADING_STAGES, currentLoadingStage, resetLoadingSignal, setPaintScheduler } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const doc = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html');
const PANEL = doc.getElementById('editorPhotoPanel').outerHTML;

describe('the declared stages', () => {
  it("'frame' and 'photo' are corner pills under Computing", () => {
    expect(LOADING_STAGES.frame).toEqual({ group: 'computing', label: 'building the frame', surface: 'pill' });
    expect(LOADING_STAGES.photo).toEqual({ group: 'computing', label: 'loading the photo', surface: 'pill' });
  });
});

describe('a photo pattern pick shows the photo stage first, until its decode is done', () => {
  let frames;
  beforeEach(async () => {
    document.body.innerHTML = PANEL + '<div id="editorToolbarPhoto"></div><div id="loading-stage" hidden><span class="loading-stage-text"></span></div>';
    initPhotoPanel({ onChange: () => {} });
    await vi.waitFor(() => expect(document.querySelector('#photoPatternRow button')).not.toBeNull());
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
    setPaintScheduler(null); // the real paint step (the suite's is immediate)
    resetLoadingSignal();
    decode.mockClear();
  });
  afterEach(() => { setPaintScheduler((cb) => cb()); vi.unstubAllGlobals(); resetLoadingSignal(); });

  it('stage on screen before the decode starts; still up while it runs; gone after', async () => {
    document.querySelector('#photoPatternRow button').click();
    expect(currentLoadingStage()?.id).toBe('photo');
    expect(decode).not.toHaveBeenCalled(); // not yet: the stage gets its paint first
    while (frames.length) frames.shift()();
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    expect(currentLoadingStage()?.id).toBe('photo'); // the decode is still running
    resolveDecode();
    await vi.waitFor(() => expect(currentLoadingStage()?.id).not.toBe('photo'), { timeout: 2000 });
  });

  // seat D 2026-10-09 (matrix BLIND_BUDGET, on main too): the pick's own sync work (the filter switch, the relief, the
  // controls) was ~50 ms in the tap with bricks laid -- 0 or 50-80 ms blind by run
  it('the tap itself only puts the stage up: the pick (the filter switch, the pattern id) runs in the paint step', async () => {
    const was = { id: P.photoPatternId, noise: P.noiseType };
    try {
      P.photoPatternId = null;
      document.querySelector('#photoPatternRow button').click();
      expect(currentLoadingStage()?.id).toBe('photo');
      expect(P.photoPatternId).toBe(null); // nothing of the pick ran in the tap
      while (frames.length) frames.shift()();
      expect(P.photoPatternId).toBe('p1');
      resolveDecode?.();
    } finally { P.photoPatternId = was.id; P.noiseType = was.noise; }
  });
});
