/**
 * F35 item 70 (advisor): a Send from the FUSION palette shows the declared stages too -- the palette's own (STEP build,
 * transfer) then Fusion's, which the add-in reports by id ('import_stage' {id}) from the ONE declaration both sides
 * read (data/fusion-send-stages.js). Fusion's stages are HELD (they last until the next report or the end), and the
 * first one is painted BEFORE generate_finish: the add-in runs the whole import from that call.
 * The palette end to end (replayed add-in): tools/repro/f35item70_fusion_send_stages.mjs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import FUSION_SEND_STAGES from '../bspline-frame-builder/b-spline-gen/html/data/fusion-send-stages.js';
import {
  LOADING_STAGES, LOADING_SEQUENCES, MIN_VISIBLE_MS, holdLoadingStage, releaseHeldStage, beginLoadingSequence,
  currentLoadingStage, resetLoadingSignal, setPaintScheduler,
} from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';
import { sendFusionPayloadChunked } from '../bspline-frame-builder/b-spline-gen/html/core/fusion-bridge.js';

const ids = FUSION_SEND_STAGES.stages.map((s) => s.id);
let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = '<div id="loading-stage" hidden><span class="loading-stage-text"></span></div>';
  document.body.appendChild(root);
});
afterEach(() => { resetLoadingSignal(); root.remove(); vi.useRealTimers(); delete globalThis.adsk; });

describe('the declaration both sides read', () => {
  it('is pure JSON after the line-start `export default` (how b-spline-gen.py reads it), unique ids, a label each', () => {
    const src = readFileSync('bspline-frame-builder/b-spline-gen/html/data/fusion-send-stages.js', 'utf8');
    const m = /^export default/m.exec(src); // line-anchored: the header comment names the token too
    const parsed = JSON.parse(src.slice(m.index + m[0].length).trim().replace(/;$/, ''));
    expect(parsed).toEqual(FUSION_SEND_STAGES);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of parsed.stages) expect(s.label, s.id).toMatch(/\S/);
  });

  it('every Fusion stage is a declared WAITING card "Fusion: <label>"; the send sequence ends with them, in order', () => {
    for (const s of FUSION_SEND_STAGES.stages) {
      expect(LOADING_STAGES[s.id]).toMatchObject({ group: 'waiting', surface: 'card' });
      expect(LOADING_STAGES[s.id].label).toBe(`Fusion: ${s.label}`);
    }
    expect(LOADING_SEQUENCES.send.stages.slice(-ids.length)).toEqual(ids);
    expect(LOADING_SEQUENCES.send.stages.slice(0, -ids.length)).toEqual(['heightMask', 'rebuild', 'stepBuild', 'transfer']);
  });
});

describe('held stages', () => {
  it('a held stage shows with its step, the next one replaces it, release ends it (after the minimum time)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    beginLoadingSequence('send');
    const n = LOADING_SEQUENCES.send.stages.length;
    await holdLoadingStage('fusionFrame');
    const at = LOADING_SEQUENCES.send.stages.indexOf('fusionFrame') + 1;
    expect(currentLoadingStage()).toEqual({ id: 'fusionFrame', text: `Waiting - Fusion: building the frame, step ${at} of ${n}`, surface: 'card' });
    await holdLoadingStage('fusionFinalize');
    expect(currentLoadingStage().id).toBe('fusionFinalize');
    releaseHeldStage();
    await vi.advanceTimersByTimeAsync(MIN_VISIBLE_MS + 10);
    expect(currentLoadingStage()).toBe(null);
  });

  it('an unknown id (a newer add-in) never shows anything and never throws', async () => {
    await holdLoadingStage('fusionSomethingNew');
    expect(currentLoadingStage()).toBe(null);
  });
});

describe('the Send hand-off', () => {
  it("Fusion's first stage is painted BEFORE generate_finish (the add-in imports from that call)", async () => {
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
    setPaintScheduler(null); // the real paint step (the suite's is immediate)
    const calls = [];
    // the bridge's own log lines travel the same way (fusLog): only the Send's actions count here
    globalThis.adsk = { fusionSendData: (action) => { if (action !== 'log') calls.push([action, currentLoadingStage()?.id || null]); return 'OK'; } };
    const p = sendFusionPayloadChunked('x'.repeat(10), { beforeFinish: () => holdLoadingStage(ids[0]) });
    await Promise.resolve();
    expect(calls.map((c) => c[0])).toEqual(['generate_start', 'generate_chunk']); // waiting for the paint
    frames.shift()(); frames.shift()();
    await p;
    expect(calls.at(-1)).toEqual(['generate_finish', ids[0]]); // on screen when Fusion starts
    setPaintScheduler((cb) => cb());
    vi.unstubAllGlobals();
  });
});
