/**
 * tools/heavy-run-guard.mjs (2026-10-07: Fred's PC crawled while seats ran full suites beside the advisor's gate): a
 * heavy run refuses while the gate's lock exists or free RAM is under the floor -- except the gate's OWN runs (the lock's
 * pid exported as BSPLINE_GATE_LOCK_OWNER), or the gate would block itself.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { heavyRunVerdict, MIN_FREE_GB, REFUSED_EXIT, OWNER_ENV, HEAVY_RUN_CHILD_ENV } from '../tools/heavy-run-guard.mjs';

const GB = 2 ** 30;
const LOCK = '41234 20:31 gate run'; // gate.sh writes "<pid> <HH:MM> <args>"

describe('the verdict', () => {
  it('no lock and enough free RAM: go', () => {
    expect(heavyRunVerdict({ lockText: null, freeBytes: (MIN_FREE_GB + 1) * GB }).ok).toBe(true);
  });
  it('the gate is running: refused, and the reason names the lock', () => {
    const v = heavyRunVerdict({ lockText: LOCK, freeBytes: 20 * GB });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/gate is running/);
  });
  it("the gate's own run passes its lock; another pid does not", () => {
    expect(heavyRunVerdict({ lockText: LOCK, ownerEnv: '41234', freeBytes: 1 * GB }).ok).toBe(true);
    expect(heavyRunVerdict({ lockText: LOCK, ownerEnv: '999', freeBytes: 20 * GB }).ok).toBe(false);
  });
  it('under the RAM floor: refused, with the figure', () => {
    const v = heavyRunVerdict({ lockText: null, freeBytes: (MIN_FREE_GB - 0.5) * GB });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/under the 4 GB floor/);
  });
  it("a guarded parent's own children are not re-judged (the matrix --parallel groups)", () => {
    expect(heavyRunVerdict({ lockText: LOCK, freeBytes: 0, child: true }).ok).toBe(true);
  });
});

describe('the command, end to end (a temporary home, never the real lock)', () => {
  const run = (env) => spawnSync(process.execPath, ['tools/heavy-run-guard.mjs', 'test run'], { env: { ...process.env, ...env }, encoding: 'utf8' });
  it('refuses with its exit code while a lock exists, and lets the lock owner through', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'hrg-'));
    try {
      mkdirSync(path.join(home, '.bspline-status'));
      writeFileSync(path.join(home, '.bspline-status', 'gate_running'), LOCK);
      const homeEnv = { USERPROFILE: home, HOME: home, [OWNER_ENV]: '', [HEAVY_RUN_CHILD_ENV]: '' };
      const refused = run(homeEnv);
      expect(refused.status).toBe(REFUSED_EXIT);
      expect(refused.stderr).toMatch(/test run refused -- the gate is running/);
      expect(run({ ...homeEnv, [OWNER_ENV]: '41234' }).status).toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('wired where the heavy runs start', () => {
  it('the brick matrix guards every top-level run (after the free --only-if-changed check) and marks its children', () => {
    const src = readFileSync('tools/brick-matrix/run.mjs', 'utf8');
    const guard = src.indexOf("guardHeavyRun('brick matrix');");
    expect(guard).toBeGreaterThan(src.indexOf("if (arg('only-if-changed'))"));
    expect(guard).toBeLessThan(src.indexOf("if (flag('parallel'))"));
    expect(src).toMatch(/env: \{ \.\.\.process\.env, \[HEAVY_RUN_CHILD_ENV\]: '1' \}/);
  });
  it('the full vitest suite has a guarded npm script; the plain one (single files) stays unguarded', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(scripts['test:full']).toMatch(/^node tools\/heavy-run-guard\.mjs .*&& vitest run$/);
    expect(scripts.test).toBe('vitest run');
  });
});
