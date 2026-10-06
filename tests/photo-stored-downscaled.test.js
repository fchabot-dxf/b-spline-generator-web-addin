/**
 * Item 74a (seat D, measured: a 5.5 MB phone JPEG went into P.photoImageDataUrl as-is, the session save hit the
 * browser's storage quota, saveLastSession then REMOVED the saved session, and a reload lost the whole board):
 *  - the photo is stored the way core/state.js declares it, downscaled to PHOTO_MAX_DIM (codec.js photoSize, the size
 *    the decode samples), on upload AND, for a session saved before this, on read;
 *  - a save that does not fit keeps the PREVIOUS session (advisor).
 * The real canvas half is verified live (happy-dom has no 2D canvas): here Image and the canvas are stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/patterns.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadPhotoPatterns: vi.fn(() => Promise.resolve([])) };
});
const BIG = 'data:image/jpeg;base64,BIG-FULL-SIZE';
const SMALL = 'data:image/png;base64,SMALL-512';
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/codec.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fileToDataUrl: vi.fn(() => Promise.resolve(BIG)),
    downscalePhotoDataUrl: vi.fn((url) => Promise.resolve(url === BIG ? SMALL : url)),
  };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/state.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ensurePhotoDecoded: vi.fn(() => Promise.resolve(null)) };
});

import { P, DEFAULT, saveLastSession } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initPhotoPanel, adoptStoredPhoto } from '../bspline-frame-builder/b-spline-gen/html/main/photo-panel.js';
import { ensurePhotoDecoded } from '../bspline-frame-builder/b-spline-gen/html/core/photo/state.js';

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const PANEL = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html').getElementById('editorPhotoPanel').outerHTML;

describe('codec: the stored size is the sampled size', () => {
  let codec;
  beforeEach(async () => { codec = await vi.importActual('../bspline-frame-builder/b-spline-gen/html/core/photo/codec.js'); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('photoSize: a 4032x3024 phone photo -> 512x384; one already within PHOTO_MAX_DIM keeps its size', () => {
    expect(codec.photoSize(4032, 3024)).toEqual({ w: 512, h: 384 });
    expect(codec.photoSize(3024, 4032)).toEqual({ w: 384, h: 512 });
    expect(codec.photoSize(300, 200)).toEqual({ w: 300, h: 200 });
  });

  // a stub <img>: setting src loads it at the declared natural size
  const stubImage = (w, h) => vi.stubGlobal('Image', class { set src(v) { this.naturalWidth = w; this.naturalHeight = h; setTimeout(() => this.onload(), 0); } });
  const stubCanvas = () => {
    const draws = [], canvas = { getContext: () => ({ drawImage: (...a) => draws.push(a.slice(1)) }), toDataURL: (type) => `data:${type};base64,DOWN` };
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : real(tag)));
    return { canvas, draws };
  };

  it('downscalePhotoDataUrl: a large data: URL is redrawn at photoSize as a PNG', async () => {
    stubImage(4032, 3024); const { canvas, draws } = stubCanvas();
    expect(await codec.downscalePhotoDataUrl(BIG)).toBe('data:image/png;base64,DOWN');
    expect([canvas.width, canvas.height]).toEqual([512, 384]);
    expect(draws).toEqual([[0, 0, 512, 384]]);
  });
  it('one within PHOTO_MAX_DIM comes back as the same string (no re-encode); a plain URL passes through', async () => {
    stubImage(400, 300); const { draws } = stubCanvas();
    expect(await codec.downscalePhotoDataUrl(BIG)).toBe(BIG);
    expect(draws).toEqual([]);
    expect(await codec.downscalePhotoDataUrl('data/photo-patterns/brick.jpg')).toBe('data/photo-patterns/brick.jpg');
  });
});

describe('the Photo panel stores the downscaled photo', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(P, DEFAULT, { photoImageDataUrl: null, photoEdits: [] });
    document.body.innerHTML = PANEL + '<div id="editorToolbarPhoto"></div>';
  });

  it('an upload goes into P (and the saved session) downscaled, not as the original file', async () => {
    initPhotoPanel({ onChange: () => {} });
    const input = document.getElementById('photoFileInput');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'phone.jpg', { type: 'image/jpeg' })] });
    input.dispatchEvent(new Event('change'));
    await flush();
    expect(P.photoImageDataUrl).toBe(SMALL);
    expect(JSON.parse(localStorage.getItem('splineGenLastSession')).P.photoImageDataUrl).toBe(SMALL);
  });

  it('a session saved before this (a full-size photo) is downscaled on read and saved small', async () => {
    P.photoImageDataUrl = BIG; // what loadLastSession restored
    initPhotoPanel({ onChange: () => {} });
    await flush();
    expect(P.photoImageDataUrl).toBe(SMALL);
    expect(JSON.parse(localStorage.getItem('splineGenLastSession')).P.photoImageDataUrl).toBe(SMALL);
  });

  it('a photo already stored small is left alone (no re-save on read)', async () => {
    P.photoImageDataUrl = SMALL;
    initPhotoPanel({ onChange: () => {} });
    await flush();
    expect(P.photoImageDataUrl).toBe(SMALL);
    expect(localStorage.getItem('splineGenLastSession')).toBeNull();
  });
});

describe('adoptStoredPhoto: a photo that came back from a save is decoded and the terrain rebuilt', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(P, DEFAULT, { photoImageDataUrl: null, photoEdits: [] });
    document.body.innerHTML = PANEL + '<div id="editorToolbarPhoto"></div>';
    vi.mocked(ensurePhotoDecoded).mockClear();
  });
  it('the session restore / a project load sets P (after the panel was built): adopting it decodes it + rebuilds', async () => {
    const onChange = vi.fn();
    initPhotoPanel({ onChange });
    P.photoImageDataUrl = SMALL; // what loadLastSession / a snapshot apply restored
    await adoptStoredPhoto();
    expect(vi.mocked(ensurePhotoDecoded)).toHaveBeenCalledWith(SMALL);
    expect(onChange).toHaveBeenCalled();
  });
  it('no photo: nothing to adopt', async () => {
    const onChange = vi.fn();
    initPhotoPanel({ onChange });
    await adoptStoredPhoto();
    expect(vi.mocked(ensurePhotoDecoded)).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('the boot restore and the snapshot apply both adopt the photo (the two places a saved board enters P)', () => {
    for (const f of ['main/app-init.js', 'main/snapshot-manager.js']) {
      const src = readFileSync(`bspline-frame-builder/b-spline-gen/html/${f}`, 'utf8');
      expect(src, f).toMatch(/syncFramePanel\(\);\s*adoptStoredPhoto\(\);/);
    }
  });
});

describe('saveLastSession: a save that does not fit keeps the previous session', () => {
  afterEach(() => vi.restoreAllMocks());
  it('quota exceeded -> the last session that fit is still there for the reload', () => {
    const previous = JSON.stringify({ P: { widthIn: 9, editorSvg: '<svg>the board</svg>' } });
    localStorage.setItem('splineGenLastSession', previous);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    saveLastSession();
    spy.mockRestore();
    expect(localStorage.getItem('splineGenLastSession')).toBe(previous);
    expect(warn).toHaveBeenCalled();
  });
});
