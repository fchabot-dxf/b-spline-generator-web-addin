/** tools/cpu-lock.mjs: node runners take the shared CPU lock (Fred 2026-11-23). Scratch lock root only, never ~/.shared-cpu. */
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
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

  // 27 takers outlived their node owner (2026-11-24). Kill the owner while its taker waits behind a live fake holder: the
  // taker bash must vanish on its own and leave no waiting file, and the fake holder's lock must stay untouched.
  it('a taker never outlives its killed owner (no orphan bash, no waiting file left)', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'cpulock-'));
    const fake = spawn(process.execPath, ['-e', 'setTimeout(()=>{},120000)'], { windowsHide: true, stdio: 'ignore' });
    mkdirSync(path.join(root, 'lock'));
    writeFileSync(holder(root), `project=ddcs
what=fake
start=${Math.floor(Date.now() / 1000)}
eta=30min
pid=${fake.pid}
host=${os.hostname()}
`);
    const owner = start(root, { CPU_LOCK_WATCH_S: '1' });
    const alive = (pid) => String(spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true }).stdout).includes(` ${pid} `);
    // every bash.exe below the owner (Git's launcher forks the real bash/subshells, which are separate windows pids)
    const PS = `$all=Get-CimInstance Win32_Process; $ids=@(${owner.pid}); do{$n=$all|?{$ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId}; $ids+=$n.ProcessId}while($n); $all|?{$ids -contains $_.ProcessId -and $_.Name -eq 'bash.exe'}|%{$_.ProcessId}`;
    const takerPids = () => String(spawnSync('powershell', ['-NoProfile', '-Command', PS], { encoding: 'utf8', windowsHide: true }).stdout).split(/\s+/).filter(Boolean);
    try {
      let pids = []; const t0 = Date.now();
      while (!pids.length && Date.now() - t0 < 30000) { pids = takerPids(); if (!pids.length) await new Promise((r) => setTimeout(r, 500)); }
      expect(pids.length).toBeGreaterThan(0);
      while (!existsSync(path.join(root, 'waiting.bspline')) && Date.now() - t0 < 40000) await new Promise((r) => setTimeout(r, 300));
      expect(existsSync(path.join(root, 'waiting.bspline'))).toBe(true);
      spawnSync('taskkill', ['/PID', String(owner.pid), '/F'], { windowsHide: true, stdio: 'ignore' });
      const t1 = Date.now();
      while (pids.some(alive) && Date.now() - t1 < 10000) await new Promise((r) => setTimeout(r, 500));
      expect(pids.filter(alive)).toEqual([]);
      expect(existsSync(path.join(root, 'waiting.bspline'))).toBe(false);
      expect(readFileSync(holder(root), 'utf8')).toMatch(/^what=fake$/m);
    } finally {
      for (const p of takerPids()) spawnSync('taskkill', ['/PID', p, '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      fake.kill(); try { owner.kill(); } catch { /* gone */ }
      rmSync(root, { recursive: true, force: true });
    }
  }, 120000);

  it('brick-matrix/run.mjs and heavy-run.sh/.ps1 take the lock', () => {
    const run = readFileSync(path.resolve(__dirname, '../tools/brick-matrix/run.mjs'), 'utf8');
    expect(run).toMatch(/import \{ takeCpuLock \} from '\.\.\/cpu-lock\.mjs'/);
    expect(run).toMatch(/await takeCpuLock\(/);
    expect(readFileSync(path.resolve(__dirname, '../tools/heavy-run.sh'), 'utf8')).toMatch(/cpu_lock_take bspline/);
    expect(readFileSync(path.resolve(__dirname, '../tools/heavy-run.ps1'), 'utf8')).toMatch(/heavy-run\.sh/);
  });
});
