/**
 * F35 item 10 follow-up (Fred): Brick-tab sliders regenerate on RELEASE, not every drag tick --
 * with a throttled (~10/sec), 2D-only live preview while dragging, falling back to a cheap
 * outline-only draw once a preview tick measures slow. brick-panel.js's own shared mechanism
 * (bindSlider + _scheduleLivePreview/_commitBrickSlider), declared once for every slider.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn() };
});

import { initBrickPanel } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks, runBricksPreview, runBricksOutlinePreview } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const FIXTURE = `
  <div id="editorToolbarBrick"></div>
  <div id="brickToolHint"></div>
  <div id="brickBrushSection" style="display:none;">
    <div id="brickBrushProfileToggle"><button id="brickBtnProfileStripped" class="active"></button><button id="brickBtnProfileContinuous"></button></div>
    <div id="brickBrushOrientationToggle"><button id="brickBtnOrientationStretcher" class="active"></button><button id="brickBtnOrientationSoldier"></button></div>
  </div>
  <div id="brickFramePresetList"></div>
  <div id="brickPatternList"></div>
  <div id="brickFrameBandPatternList"></div>
  <button id="brickSetRed"></button>
  <button id="brickSetWhite"></button>
  <div id="brickSizePresetList"></div>
  <input id="brickSizeSlider" type="range" min="0" max="1000" step="1" value="226"><input id="brickSize" type="number" value="0.75">
  <input id="brickGroutWidth"><input id="brickGroutDepth">
  <button id="brickBtnGroutRecessed"></button><button id="brickBtnGroutFlush"></button>
  <button id="brickBtnReliefRaised"></button><button id="brickBtnReliefCarved"></button>
  <input id="brickReliefHeightSlider" type="range"><input id="brickReliefHeight">
  <input id="brickSuppressionSlider" type="range"><input id="brickSuppression">
  <input id="brickClumpingSlider" type="range"><input id="brickClumping">
  <input id="brickSeed"><button id="brickBtnRandomSeed"></button>
`;

/** editor-session.test.js's own controllable rAF mock (same convention): requestAnimationFrame
 *  records the callback instead of scheduling a real frame -- nothing fires until runPending(). */
function mockRaf() {
  let nextId = 1;
  const scheduled = new Map();
  return {
    raf: (cb) => { const id = nextId++; scheduled.set(id, cb); return id; },
    caf: (id) => { scheduled.delete(id); },
    runPending: () => { const cbs = [...scheduled.values()]; scheduled.clear(); cbs.forEach((cb) => cb()); },
    pendingCount: () => scheduled.size,
  };
}

const $ = (id) => document.getElementById(id);
const setAndFire = (id, value, eventType) => { $(id).value = String(value); $(id).dispatchEvent(new Event(eventType)); };

// brick-panel.js's own drag state (_liveFrame/_lastLiveAt/_dragSlow) is module-private, persisting
// across every test in this file -- there's no reset hook, and there should not be one added just
// for tests (surgical change). So `t` gets a large, ever-increasing per-test BASE jump (always well
// past whatever _lastLiveAt the PREVIOUS test left behind, clearing the throttle gate on this
// test's very first check) while performance.now() itself does NOT auto-advance on repeated reads
// (t0 and the end-of-call read land on the SAME value unless a test, or a mocked runBricksPreview,
// explicitly advances `t` to simulate real work -- see the slow-fallback test below).
let root, raf, t;
let _timeBase = 0;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  // frameContext's own module-level provider is unregistered in this test file -> resolveFrameGeom(editor)
  // returns null for ANY editor here, regardless of its own shape. setMode is a no-op stub purely so
  // selecting the Brush tool (one test below) doesn't throw -- this file never arms Brush drawing itself.
  window.svgEditor = { setMode: () => {} };
  P.brickSettings.brickLengthIn = 1;
  // A bigger step than afterEach's own drain advance below, so this test's starting `t` never lands
  // exactly on (or before) the `_lastLiveAt` the PREVIOUS test's drain just set.
  _timeBase += 10_000_000;
  t = _timeBase;
  vi.spyOn(performance, 'now').mockImplementation(() => t);
  raf = mockRaf();
  vi.stubGlobal('requestAnimationFrame', raf.raf);
  vi.stubGlobal('cancelAnimationFrame', raf.caf);
  initBrickPanel();
  document.getElementById('brickTool_wall').click(); // Wall tool active for most of these tests
  vi.clearAllMocks(); // the setup click above itself calls the mocked runBricks once -- don't count it
});
afterEach(() => {
  // drain any frame this test left pending, so _liveFrame is back to null for the next test's fresh
  // raf mock; advance `t` first so THIS drain's own gate-check is guaranteed to pass (never re-arms).
  t += 1_000_000;
  raf.runPending();
  root.remove(); window.svgEditor = null; vi.unstubAllGlobals();
});

describe('Brick slider timing: live preview while dragging, full commit on release', () => {
  // Advisor follow-up (Fred, "is scale easy?"): brickSizeSlider's own raw DOM value is now a LOG
  // position (0-1000), not real inches -- these tests drive #brickSize (the number stepper) instead,
  // which main/brick-panel.js's own bindBrickSizeControls binds through the EXACT SAME apply/commit
  // functions as the slider (same throttle, same _commitBrickSlider), so the timing behaviour under
  // test is identical either way, with assertions staying in plain, readable inches.
  it('dragging (input) never calls the full commit; it schedules exactly one live-preview frame', () => {
    setAndFire('brickSize', 1.2, 'input');
    expect(runBricks).not.toHaveBeenCalled();
    expect(raf.pendingCount()).toBe(1);
    expect(runBricksPreview).not.toHaveBeenCalled(); // not until the frame actually runs
  });

  it('once the rAF frame elapses, the live preview runs with the CURRENT P.brickSettings', () => {
    setAndFire('brickSize', 1.4, 'input');
    raf.runPending();
    expect(runBricksPreview).toHaveBeenCalledTimes(1);
    expect(P.brickSettings.brickLengthIn).toBe(1.4);
    expect(runBricksOutlinePreview).not.toHaveBeenCalled();
  });

  it('several raw ticks before the frame fires collapse into ONE preview call, using the LATEST value (latest wins)', () => {
    setAndFire('brickSize', 1.1, 'input');
    setAndFire('brickSize', 1.2, 'input');
    setAndFire('brickSize', 1.3, 'input');
    expect(raf.pendingCount()).toBe(1); // the 2nd/3rd ticks saw a frame already queued, no new one scheduled
    raf.runPending();
    expect(runBricksPreview).toHaveBeenCalledTimes(1);
    expect(P.brickSettings.brickLengthIn).toBe(1.3);
  });

  it('release ("change") cancels any pending live frame and commits via the full runBricks exactly once', () => {
    setAndFire('brickSize', 1.5, 'input');
    expect(raf.pendingCount()).toBe(1);
    setAndFire('brickSize', 1.5, 'change');
    expect(raf.pendingCount()).toBe(0); // the pending live frame was cancelled, not left to also fire
    expect(runBricks).toHaveBeenCalledTimes(1);
    raf.runPending(); // even if something were still queued, nothing further should fire
    expect(runBricksPreview).not.toHaveBeenCalled();
  });

  it('a slider drag with no prior release still calls runBricks on its own first "change"', () => {
    setAndFire('brickReliefHeightSlider', 0.2, 'change');
    expect(runBricks).toHaveBeenCalledTimes(1);
  });

  it('while Brush is the active tool, dragging never calls the live preview at all (nothing to preview -- frozen per-element settings)', () => {
    document.getElementById('brickTool_brush').click();
    setAndFire('brickSize', 1.6, 'input');
    raf.runPending();
    expect(runBricksPreview).not.toHaveBeenCalled();
    expect(runBricksOutlinePreview).not.toHaveBeenCalled();
    setAndFire('brickSize', 1.6, 'change');
    expect(runBricks).not.toHaveBeenCalled();
  });

  it('Frame tool with no usable frame on this board: no live preview, and release does not call runBricks either (matches the Frame button\'s own existing guard)', () => {
    document.getElementById('brickTool_frame').click();
    setAndFire('brickSize', 1.6, 'input');
    raf.runPending();
    expect(runBricksPreview).not.toHaveBeenCalled();
    setAndFire('brickSize', 1.6, 'change');
    expect(runBricks).not.toHaveBeenCalled();
  });

  it('a measured-slow preview tick (>50ms) falls back to outline-only for the REST of that drag; the next commit resets it', () => {
    // runBricksPreview's mock advances the shared `t` itself to simulate real work -- the production
    // code measures (end - t0) around that exact call, so this is a direct simulation of "this tick
    // took 70ms", not a guess at how many performance.now() reads happen or in what order.
    runBricksPreview.mockImplementationOnce(() => { t += 70; });
    setAndFire('brickSize', 1.1, 'input');
    raf.runPending(); // tick 1: measures 70ms > 50 -> _dragSlow = true
    expect(runBricksPreview).toHaveBeenCalledTimes(1);
    expect(runBricksOutlinePreview).not.toHaveBeenCalled();

    t += 200; // clear the 100ms throttle gate for the next tick
    setAndFire('brickSize', 1.2, 'input'); // same drag, not yet released
    raf.runPending(); // tick 2: _dragSlow is set -> outline-only, the real preview is not touched
    expect(runBricksOutlinePreview).toHaveBeenCalledTimes(1);
    expect(runBricksPreview).toHaveBeenCalledTimes(1); // unchanged since tick 1

    setAndFire('brickSize', 1.2, 'change'); // commit: resets the slow flag for the NEXT drag
    runBricksPreview.mockClear();
    runBricksOutlinePreview.mockClear();

    t += 200;
    setAndFire('brickSize', 1.4, 'input'); // a new drag
    raf.runPending(); // tick 3: fresh drag, runBricksPreview is a plain no-op again (fast) -> stays not-slow
    expect(runBricksPreview).toHaveBeenCalledTimes(1); // back to the real preview, not outline-only
    expect(runBricksOutlinePreview).not.toHaveBeenCalled();
  });
});
