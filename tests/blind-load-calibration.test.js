/**
 * tools/brick-matrix/groups/blind.mjs load calibration -- DETECTION ONLY (advisor 2026-10-09: "it must never pass a
 * row on its own"). A FAIL's detail says how loaded the machine was; the verdict is computed before it and never reads it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BLIND_BUDGET, loadNote } from '../tools/brick-matrix/groups/blind.mjs';

const cal = { ...BLIND_BUDGET.calibration, quietMs: 200 };

describe('loadNote: words for a FAIL, never a verdict', () => {
  it('declared: a fixed workload, a median of runs, loaded from x1.5', () => {
    expect(BLIND_BUDGET.calibration).toMatchObject({ iterations: 3e6, runs: 3, loadedAt: 1.5 });
  });
  it('loaded at or past loadedAt: says so, with the factor', () => {
    expect(loadNote(480, cal)).toBe('calibration 480 ms vs quiet 200 ms: machine loaded x2.4 -- this FAIL may be load; re-run quiet');
    expect(loadNote(300, cal)).toMatch(/machine loaded x1\.5/);
  });
  it('under loadedAt: a real FAIL', () => {
    expect(loadNote(220, cal)).toBe('calibration 220 ms vs quiet 200 ms: machine not loaded (x1.1) -- a real FAIL');
  });
  it('no baseline / no measure: says so, no factor', () => {
    expect(loadNote(220, { ...cal, quietMs: null })).toBe('calibration 220 ms (no quiet baseline declared)');
    expect(loadNote(undefined, cal)).toBe('calibration: not measured');
  });
  it('the verdict never reads the calibration: ok is set first, the calibration runs only on a FAIL, after it', () => {
    const src = readFileSync('tools/brick-matrix/groups/blind.mjs', 'utf8');
    const okAt = src.indexOf('const ok = !!m && m.blindMs <= budget;');
    const loadAt = src.indexOf("const load = ok || !m ? '' : ` -- ${loadNote(await calibrate())}`;");
    expect(okAt).toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(okAt);
    expect(src.slice(loadAt).match(/checkRow\('blind', name, ok,/)).toBeTruthy(); // the same `ok` goes to the row
    expect((src.match(/\bok\s*=/g) || []).length).toBe(1); // nothing reassigns it
  });
});
