/**
 * tools/brick-matrix/groups/blind.mjs load detection -- DETECTION ONLY (advisor 2026-10-09: "it must never pass a row on
 * its own"). A FAIL's detail says how loaded the machine was: the whole machine's CPU busy % and the page's frame
 * interval. It replaced a throttled JS workload that read x0.87 of quiet at 100% system CPU (seat D, MEASURED).
 * The verdict is computed before it and never reads it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BLIND_BUDGET, loadNote, busyPct } from '../tools/brick-matrix/groups/blind.mjs';

const d = { ...BLIND_BUDGET.loadDetect, quiet: { busyPct: 12, frameMs: 17 } };
const cpu = (busy, idle) => ({ times: { user: busy, nice: 0, sys: 0, irq: 0, idle } });

describe('loadNote / busyPct: words for a FAIL, never a verdict', () => {
  it('declared: a 1 s sample; loaded from 60% machine CPU or 33 ms frames', () => {
    expect(BLIND_BUDGET.loadDetect).toMatchObject({ sampleMs: 1000, busyAtPct: 60, frameAtMs: 33 });
    expect(BLIND_BUDGET.calibration).toBeUndefined(); // the throttled workload is gone
  });
  it('busyPct: the busy share of all CPU time between two readings, across cores', () => {
    expect(busyPct([cpu(100, 900), cpu(100, 900)], [cpu(190, 910), cpu(150, 950)])).toBeCloseTo(100 * 140 / 200, 6);
    expect(busyPct([cpu(0, 0)], [cpu(0, 0)])).toBe(0);
  });
  it('a busy machine OR slow frames: loaded', () => {
    expect(loadNote({ busyPct: 96, frameMs: 17 }, d)).toBe('machine CPU 96% (quiet 12%), frames 17 ms (quiet 17 ms): machine loaded -- this FAIL may be load; re-run quiet');
    expect(loadNote({ busyPct: 20, frameMs: 48 }, d)).toMatch(/machine loaded/);
  });
  it('neither: a real FAIL', () => {
    expect(loadNote({ busyPct: 20, frameMs: 17 }, d)).toBe('machine CPU 20% (quiet 12%), frames 17 ms (quiet 17 ms): machine not loaded -- a real FAIL');
  });
  it('no quiet baseline yet: the values alone; no sample: says so', () => {
    expect(loadNote({ busyPct: 20, frameMs: 17 }, { ...d, quiet: { busyPct: null, frameMs: null } })).toBe('machine CPU 20%, frames 17 ms: machine not loaded -- a real FAIL');
    expect(loadNote(null, d)).toBe('load: not measured');
  });
  it('the verdict never reads the load: ok is set first, the sample runs only on a FAIL, after it', () => {
    const src = readFileSync('tools/brick-matrix/groups/blind.mjs', 'utf8');
    const okAt = src.indexOf('const ok = !!m && m.blindMs <= budget;');
    const loadAt = src.indexOf("const load = ok || !m ? '' : ` -- ${loadNote(await sampleLoad())}`;");
    expect(okAt).toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(okAt);
    expect(src.slice(loadAt).match(/checkRow\('blind', name, ok,/)).toBeTruthy(); // the same `ok` goes to the row
    expect((src.match(/\bok\s*=/g) || []).length).toBe(1); // nothing reassigns it
  });
});
