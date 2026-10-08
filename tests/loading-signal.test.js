/**
 * F35 item 41 (Fred, on his phone: "the screen looks frozen, the load screen doesn't detect all computing states";
 * "can there be actual load stages, like computing, waiting, refreshing?"), on top of the item 16 follow-up's
 * declared stages. core/loading-signal.js: ONE declared STAGES table {group, label, surface}, sequences declare their
 * stage list ("Computing - laying bricks, step 2 of 4"), and a stage PAINTS before its work starts (two frames).
 * The measurement that found the uncovered actions: tools/repro/f35item41_load_stages_measure.mjs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  withLoadingStage, withLoadingStageShownFirst, beginLoadingSequence, currentLoadingStage, resetLoadingSignal, stageText, setPaintScheduler,
  continuousGesture, installGestureWatch,
  LOADING_STAGES, LOADING_SEQUENCES, STAGE_GROUPS, MIN_VISIBLE_MS, SEQUENCE_IDLE_MS, GESTURE_GRACE_MS, HIDE_GRACE_MS,
  PAINT_FALLBACK_MS,
} from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';

const FIXTURE = `<div id="loading-stage" class="loading-stage" hidden role="status" aria-live="polite"><span class="loading-stage-spinner"></span><span class="loading-stage-text"></span></div>`;

let root;
let frames;
const runFrames = (n = 2) => { for (let i = 0; i < n; i++) { const due = frames.splice(0); due.forEach((cb) => cb()); } };
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  resetLoadingSignal();
  setPaintScheduler(null); // these tests ARE the deferral: the real two frames (the stubbed rAF above)
});
afterEach(() => {
  resetLoadingSignal();
  root.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the declared tables', () => {
  it('every stage declares a group (computing | waiting | refreshing), a label and a surface (card | pill)', () => {
    expect(Object.keys(STAGE_GROUPS)).toEqual(['computing', 'waiting', 'refreshing']);
    for (const [id, s] of Object.entries(LOADING_STAGES)) {
      expect(STAGE_GROUPS[s.group], id).toBeTruthy();
      expect(['card', 'pill'], id).toContain(s.surface);
      expect(typeof s.label === 'string' || typeof s.label === 'function', id).toBe(true);
    }
  });

  it('the long steps are cards, a single lay / a pattern edit / opening the editor are pills', () => {
    const surfaces = Object.fromEntries(Object.entries(LOADING_STAGES).map(([id, s]) => [id, s.surface]));
    expect(surfaces).toMatchObject({ bricks: 'pill', patternEdit: 'pill', openEditor: 'pill',
      heightMask: 'card', rebuild: 'card', restore: 'card', cloudLoad: 'card', cloudSave: 'card', stepExport: 'card' });
    expect(LOADING_SEQUENCES.generate.surface).toBe('card'); // Generate is a long action even though one lay is a pill
  });

  it('every sequence lists only declared stages', () => {
    for (const [id, seq] of Object.entries(LOADING_SEQUENCES)) {
      for (const st of seq.stages) expect(LOADING_STAGES[st], `${id}: ${st}`).toBeTruthy();
    }
  });

  it('the text: "<Group> - <label>", plus ", step i of n" inside a sequence', () => {
    expect(stageText('bricks')).toBe('Computing - laying bricks');
    expect(stageText('cloudSave')).toBe('Waiting - saving to the cloud');
    expect(stageText('rebuild', { spacing: 0.015 })).toBe('Refreshing - building surface 0.015″');
    expect(stageText('rebuild', {})).toBe('Refreshing - building surface');
    expect(stageText('rebuild', { spacing: 0.05 }, LOADING_SEQUENCES.apply)).toBe('Refreshing - building surface 0.05″, step 2 of 2');
    expect(stageText('cloudLoad', null, { stages: ['cloudLoad', 'restore', 'heightMask', 'rebuild'] })).toBe('Waiting - loading from the cloud, step 1 of 4');
    expect(stageText('notARealStage')).toBe(null);
  });
});

describe('withLoadingStage: the stage paints BEFORE the work starts', () => {
  it('fn waits two animation frames; while it runs the overlay already shows its stage', async () => {
    let seen = 'not run';
    const p = withLoadingStage('heightMask', () => { seen = currentLoadingStage(); return 'masked'; });
    expect(currentLoadingStage()).toEqual({ id: 'heightMask', text: 'Computing - carving relief', surface: 'card' });
    await Promise.resolve();
    expect(seen).toBe('not run'); // still waiting for the paint
    runFrames(1);
    await Promise.resolve();
    expect(seen).toBe('not run'); // one frame is not enough: the second one is the painted one
    runFrames(1);
    expect(await p).toBe('masked');
    expect(seen).toEqual({ id: 'heightMask', text: 'Computing - carving relief', surface: 'card' });
  });

  it('every declared stage enters and leaves', async () => {
    for (const id of Object.keys(LOADING_STAGES)) {
      const p = withLoadingStage(id, async () => currentLoadingStage()?.id);
      runFrames();
      expect(await p, id).toBe(id);
      await vi.advanceTimersByTimeAsync(MIN_VISIBLE_MS);
      expect(currentLoadingStage(), id).toBe(null);
    }
  });

  it('a shown stage stays up at least MIN_VISIBLE_MS (no flicker), then hides', async () => {
    expect(MIN_VISIBLE_MS).toBe(300);
    const p = withLoadingStage('bricks', () => 'quick');
    runFrames();
    await p;
    expect(currentLoadingStage()?.id).toBe('bricks');
    await vi.advanceTimersByTimeAsync(MIN_VISIBLE_MS - 10);
    expect(currentLoadingStage()?.id).toBe('bricks');
    await vi.advanceTimersByTimeAsync(20);
    expect(currentLoadingStage()).toBe(null);
  });

  it('nested stages: the overlay shows the innermost, then the outer one again', async () => {
    let inner = null, afterInner = null;
    const p = withLoadingStage('restore', async () => {
      const q = withLoadingStage('heightMask', () => { inner = currentLoadingStage().id; });
      runFrames();
      await q;
      afterInner = currentLoadingStage().id;
    });
    runFrames();
    await p;
    expect([inner, afterInner]).toEqual(['heightMask', 'restore']);
  });

  it('still leaves when fn REJECTS, and re-throws', async () => {
    const p = withLoadingStage('rebuild', () => Promise.reject(new Error('build failed')), { spacing: 0.05 });
    const assertion = expect(p).rejects.toThrow('build failed');
    runFrames();
    await assertion;
    await vi.advanceTimersByTimeAsync(MIN_VISIBLE_MS);
    expect(currentLoadingStage()).toBe(null);
  });

  it('an unknown stage id is a plain pass-through: fn runs at once, nothing shown', async () => {
    expect(await withLoadingStage('notARealStage', () => 'value')).toBe('value');
    expect(currentLoadingStage()).toBe(null);
  });

  it('withLoadingStageShownFirst: a synchronous job runs after the paint', async () => {
    const job = vi.fn();
    const p = withLoadingStageShownFirst('bricks', job);
    expect(job).not.toHaveBeenCalled();
    expect(currentLoadingStage()?.id).toBe('bricks');
    runFrames();
    await p;
    expect(job).toHaveBeenCalledTimes(1);
  });
});

describe('sequences: declared up front, each stage reads its step', () => {
  it('Apply: "step 1 of 2" then "step 2 of 2"; the overlay stays up between the steps; closes after the last', async () => {
    beginLoadingSequence('apply');
    const texts = [];
    const a = withLoadingStage('heightMask', () => { texts.push(currentLoadingStage().text); });
    runFrames(); await a;
    await vi.advanceTimersByTimeAsync(MIN_VISIBLE_MS + 50); // a gap before the rebuild starts (it runs from a timer)
    expect(currentLoadingStage()).not.toBe(null); // the sequence is not over: no flicker between the steps
    const b = withLoadingStage('rebuild', () => { texts.push(currentLoadingStage().text); }, { spacing: 0.05 });
    runFrames(); await b;
    expect(texts).toEqual(['Computing - carving relief, step 1 of 2', 'Refreshing - building surface 0.05″, step 2 of 2']);
    await vi.advanceTimersByTimeAsync(MIN_VISIBLE_MS);
    expect(currentLoadingStage()).toBe(null); // the last step left: the sequence is done
  });

  it('a sequence surface wins over the stage surface (Generate: its lay shows as the card); one step reads plainly', async () => {
    beginLoadingSequence('generate');
    const p = withLoadingStage('bricks', () => currentLoadingStage());
    runFrames();
    expect(await p).toEqual({ id: 'bricks', text: 'Computing - laying bricks', surface: 'card' }); // no "step 1 of 1"
  });

  it("Brick Generate's card closes when its lay ends (its only step; the carve + build wait for the editor's Apply)", async () => {
    expect(LOADING_SEQUENCES.generate.stages).toEqual(['bricks']);
    beginLoadingSequence('generate');
    const p = withLoadingStage('bricks', () => {});
    runFrames(); await p;
    await vi.advanceTimersByTimeAsync(MIN_VISIBLE_MS + HIDE_GRACE_MS); // well short of SEQUENCE_IDLE_MS
    expect(currentLoadingStage()).toBe(null);
  });

  it('a sequence whose remaining steps never come closes after SEQUENCE_IDLE_MS', async () => {
    beginLoadingSequence('newSeed'); // heightMask, rebuild -- only its first step runs here
    const p = withLoadingStage('heightMask', () => {});
    runFrames(); await p;
    await vi.advanceTimersByTimeAsync(MIN_VISIBLE_MS + HIDE_GRACE_MS);
    expect(currentLoadingStage()).not.toBe(null); // still waiting for its next step
    await vi.advanceTimersByTimeAsync(SEQUENCE_IDLE_MS);
    expect(currentLoadingStage()).toBe(null);
    const q = withLoadingStage('heightMask', () => currentLoadingStage());
    runFrames();
    expect((await q).text).toBe('Computing - carving relief'); // a later carve is a plain one again
  });
});

describe('a continuous gesture (slider drag, sculpt stroke): its rebuilds show the pill, never flash the card', () => {
  const surfaceOf = async (id) => { const p = withLoadingStage(id, () => currentLoadingStage().surface); runFrames(); return p; };

  it('declared per stage: rebuild + heightMask switch to the pill during a gesture; a restore stays a card', async () => {
    expect(LOADING_STAGES.rebuild.gestureSurface).toBe('pill');
    expect(LOADING_STAGES.heightMask.gestureSurface).toBe('pill');
    continuousGesture(true);
    expect(await surfaceOf('rebuild')).toBe('pill');
    expect(await surfaceOf('heightMask')).toBe('pill');
    expect(await surfaceOf('restore')).toBe('card'); // no gestureSurface declared: unchanged
  });

  it('the trailing rebuild a release schedules is still the gesture (GESTURE_GRACE_MS), a later one is a card again', async () => {
    continuousGesture(true);
    continuousGesture(false);
    expect(await surfaceOf('rebuild')).toBe('pill');
    await vi.advanceTimersByTimeAsync(GESTURE_GRACE_MS + MIN_VISIBLE_MS);
    expect(await surfaceOf('rebuild')).toBe('card');
  });

  it('installGestureWatch: pointer down on a range input .. pointer up = the gesture', async () => {
    const doc = document.createElement('div');
    document.body.appendChild(doc);
    doc.innerHTML = '<input type="range" id="r"><button id="b"></button>';
    installGestureWatch(document);
    doc.querySelector('#b').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(await surfaceOf('rebuild')).toBe('card'); // a button press is not a drag
    doc.querySelector('#r').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(await surfaceOf('rebuild')).toBe('pill');
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(GESTURE_GRACE_MS + MIN_VISIBLE_MS);
    expect(await surfaceOf('rebuild')).toBe('card');
    doc.remove();
  });
});

describe('geometry refresh (Fred: "load screens were for during refresh of geometry"): one steady appearance', () => {
  const run = async (id) => { const p = withLoadingStage(id, () => {}); runFrames(); await p; };

  it('back-to-back rebuilds are ONE appearance: no blink between them (measured: 6 appearances in one drag)', async () => {
    expect(HIDE_GRACE_MS).toBe(150);
    const el = document.getElementById('loading-stage');
    let hides = 0;
    new MutationObserver(() => { if (el.hidden) hides++; }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
    // the first rebuild runs longer than the minimum (so on leaving it may hide at once)...
    const first = withLoadingStage('rebuild', () => vi.advanceTimersByTimeAsync(MIN_VISIBLE_MS + 20));
    runFrames(); await first;
    await vi.advanceTimersByTimeAsync(1); // ...and the queued next one enters a tick later (rebuild's yieldToMain)
    await run('rebuild');
    await vi.advanceTimersByTimeAsync(5);
    await run('rebuild');
    await Promise.resolve();
    expect(hides).toBe(0);
    await vi.advanceTimersByTimeAsync(HIDE_GRACE_MS + 10);
    expect(hides).toBe(1);
    expect(currentLoadingStage()).toBe(null);
  });

  it("a drag's appearance stays the pill to its end, even for a rebuild that starts after the gesture grace", async () => {
    continuousGesture(true);
    const p = withLoadingStage('rebuild', async () => {
      continuousGesture(false);
      await vi.advanceTimersByTimeAsync(GESTURE_GRACE_MS + 50); // the drag's last rebuild outlives the grace
    });
    runFrames(); await p;
    const q = withLoadingStage('rebuild', () => currentLoadingStage().surface); // queued behind it, no gap
    runFrames();
    expect(await q).toBe('pill');
    await vi.advanceTimersByTimeAsync(MIN_VISIBLE_MS + HIDE_GRACE_MS);
    expect(currentLoadingStage()).toBe(null);
    const r = withLoadingStage('rebuild', () => currentLoadingStage().surface); // a new appearance, no gesture: the card
    runFrames();
    expect(await r).toBe('card');
  });
});

describe('the paint step never holds the work forever', () => {
  it('frames that never come (a host that does not paint the page): the work goes ahead after PAINT_FALLBACK_MS', async () => {
    // seat A, live in the Fusion CAM palette: an APPLY clicked during a BUILD waited on its card's paint, never sent
    expect(PAINT_FALLBACK_MS).toBe(250);
    vi.stubGlobal('requestAnimationFrame', () => 1); // no frame, ever
    let ran = false;
    const p = withLoadingStage('stepExport', () => { ran = true; });
    await vi.advanceTimersByTimeAsync(PAINT_FALLBACK_MS - 10);
    expect(ran).toBe(false); // the paint still gets its chance
    await vi.advanceTimersByTimeAsync(20);
    await p;
    expect(ran).toBe(true);
  });

  it('frames that do come: the work runs once, at the second frame, and the fallback does not run it again', async () => {
    let runs = 0;
    const p = withLoadingStage('stepExport', () => { runs++; });
    runFrames();
    await p;
    await vi.advanceTimersByTimeAsync(PAINT_FALLBACK_MS + 10);
    expect(runs).toBe(1);
  });
});
