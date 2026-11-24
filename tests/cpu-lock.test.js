/** tools/cpu-lock.mjs: node runners take the shared CPU lock (Fred 2026-11-23). Scratch lock root only, never ~/.shared-cpu. */
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HELPER = path.resolve(__dirname, '../tools/cpu-lock.mjs').split(path.sep).join('/');
const holder = (root) => path.join(root, 'lock', 'holder.txt');
const base = (root, extra = {}) => { const e = { ...process.env, CPU_LOCK_ROOT: root, ...extra }; delete e.CPU_LOCK_HELD; delete e.CPU_LOCK_SKIP; return { ...e, ...extra }; };
// a node child: takes, reports, waits for a line on stdin, releases
const CHILD = `import { takeCpuLock, releaseCpuLock } from 'file:///${HELPER}';
await takeCpuLock('unit test', 30); console.log('HELD ' + process.pid + ' ' + (process.env.CPU_LOCK_HELD || ''));
process.stdin.once('data', () => { releaseCpuLock(); console.log('RELEASED'); process.exit(0); });`;
const start = (root, env = {}) => { const c = spawn(process.execPath, ['--input-type=module', '-e', CHILD], { env: base(root, env), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); c.stderr.resume(); return c; };
const waitFor = (child, re, ms) => new Promise((res) => { let buf = ''; const t = setTimeout(() => res(null), ms); child.stdout.on('data', (d) => { buf += d; const m = buf.match(re); if (m) { clearTimeout(t); res(m); } }); });

describe('tools/cpu-lock.mjs', () => {
  it('is a no-op when CPU_LOCK_HELD is set', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'cpulock-'));
    const c = start(root, { CPU_LOCK_HELD: 'bspline-gate' });
    const m = await waitFor(c, /HELD (\d+)/, 20000);
    expect(m).not.toBeNull();
    expect(existsSync(holder(root))).toBe(false);
    c.stdin.write('go\n'); rmSync(root, { recursive: true, force: true });
  }, 30000);

  it('take writes holder.txt (project=bspline, pid = the node process), release removes it, children inherit CPU_LOCK_HELD', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'cpulock-'));
    const c = start(root);
    const m = await waitFor(c, /HELD (\d+) (\S+)/, 60000);
    expect(m).not.toBeNull();
    const txt = readFileSync(holder(root), 'utf8');
    expect(txt).toMatch(/^project=bspline$/m);
    expect(txt).toMatch(new RegExp(`^pid=${m[1]}$`, 'm'));
    expect(m[2]).toBe('bspline');
    const done = waitFor(c, /RELEASED/, 30000);
    c.stdin.write('go\n');
    expect(await done).not.toBeNull();
    expect(existsSync(holder(root))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  }, 120000);

  it('a second taker waits while the first holds it', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'cpulock-'));
    const a = start(root);
    expect(await waitFor(a, /HELD/, 60000)).not.toBeNull();
    const b = start(root);
    expect(await waitFor(b, /HELD/, 8000)).toBeNull();
    const done = waitFor(a, /RELEASED/, 30000); a.stdin.write('go\n'); await done;
    b.kill(); rmSync(root, { recursive: true, force: true });
  }, 120000);

  it('brick-matrix/run.mjs and heavy-run.sh/.ps1 take the lock', () => {
    const run = readFileSync(path.resolve(__dirname, '../tools/brick-matrix/run.mjs'), 'utf8');
    expect(run).toMatch(/import \{ takeCpuLock \} from '\.\.\/cpu-lock\.mjs'/);
    expect(run).toMatch(/await takeCpuLock\(/);
    expect(readFileSync(path.resolve(__dirname, '../tools/heavy-run.sh'), 'utf8')).toMatch(/cpu_lock_take bspline/);
    expect(readFileSync(path.resolve(__dirname, '../tools/heavy-run.ps1'), 'utf8')).toMatch(/heavy-run\.sh/);
  });
});
