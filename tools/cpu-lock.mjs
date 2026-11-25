// The machine-wide shared CPU lock (~/.shared-cpu/cpu_lock.sh) for node runners: heavy runs take turns with the DDCS
// and Sketch-Studio projects instead of colliding (Fred 2026-11-23). The library is bash, so this drives Git Bash.
//
//   await takeCpuLock('matrix all', 15);   // blocks until held (eta <= 5 min runs in the one-place side lane)
//   releaseCpuLock();                      // also runs on exit / SIGINT / SIGTERM / uncaught errors
//
// The holder is recorded as THIS node process (CPU_LOCK_PID), alive for the whole run, so the lock is never judged
// stale while we work and is judged stale as soon as we die. CPU_LOCK_HELD set (the merge gate, heavy-run.sh/.ps1, or a
// parent that already took it) -> no-op; children inherit it from us. CPU_LOCK_SKIP=1 -> no-op (tests of this helper).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT = 'bspline';
const GIT_BASH = 'C:/Program Files/Git/bin/bash.exe';
let held = false;
let hooked = false;

/** Git Bash's bash.exe (never WSL's System32 bash). */
export function findBash() {
  if (existsSync(GIT_BASH)) return GIT_BASH;
  const w = spawnSync('where', ['bash'], { encoding: 'utf8', windowsHide: true });
  const hits = String(w.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !/system32/i.test(s));
  if (hits[0]) return hits[0];
  throw new Error('cpu-lock: cannot find Git Bash (bash.exe)');
}

const skip = () => !!(process.env.CPU_LOCK_HELD || process.env.CPU_LOCK_SKIP);
const script = (body) => `source ~/.shared-cpu/cpu_lock.sh; ${body}`;
const lockEnv = (extra = {}) => ({ ...process.env, CPU_LOCK_PID: String(process.pid), ...extra });

/** Block until the lock is held by this process. No-op when skipped (see the header). The taker is
 *  tools/cpu-lock-take.sh: it writes its lines to a log FILE (never a pipe a dead owner could leave blocking), watches
 *  this process and stops itself when we are gone; and we kill it by pid on exit / signals while waiting. */
export async function takeCpuLock(what, etaMin) {
  if (skip() || held) return;
  const bash = findBash();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cpulock-take-'));
  const log = path.join(dir, 'take.log');
  writeFileSync(log, '');
  const sh = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cpu-lock-take.sh').split(path.sep).join('/');
  let child; let off = 0;
  const relay = () => {
    try {
      const buf = readFileSync(log); if (buf.length <= off) return;
      const txt = buf.subarray(off).toString('utf8'); off = buf.length;
      process.stderr.write(txt.split(/\r?\n/).filter((l) => l.startsWith('cpu_lock:')).map((l) => l + '\n').join(''));
    } catch { /* log gone */ }
  };
  const killTaker = () => {
    if (child && child.exitCode === null && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  };
  const onSig = () => { killTaker(); process.exit(130); };
  const sigs = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];
  process.on('exit', killTaker); for (const s of sigs) process.on(s, onSig);
  try {
    await new Promise((resolve, reject) => {
      child = spawn(bash, [sh], {
        windowsHide: true, stdio: 'ignore',
        env: lockEnv({ CPU_LOCK_WHAT: String(what), CPU_LOCK_ETA: `${etaMin}min`, CPU_LOCK_LOG: log.split(path.sep).join('/') }),
      });
      const t = setInterval(relay, 500);
      child.on('error', (e) => { clearInterval(t); reject(e); });
      child.on('exit', (code) => { clearInterval(t); relay(); code === 0 ? resolve() : reject(new Error(`cpu-lock: take failed (exit ${code})`)); });
    });
  } finally {
    process.off('exit', killTaker); for (const s of sigs) process.off(s, onSig);
    rmSync(dir, { recursive: true, force: true });
  }
  held = true;
  process.env.CPU_LOCK_HELD = PROJECT;
  if (!hooked) {
    hooked = true;
    process.on('exit', releaseCpuLock);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => { releaseCpuLock(); process.exit(130); });
    process.on('uncaughtException', (e) => { console.error(e); releaseCpuLock(); process.exit(1); });
  }
}

/** Release (sync, so it is safe inside process.on('exit')). Idempotent. */
export function releaseCpuLock() {
  if (!held) return;
  held = false;
  delete process.env.CPU_LOCK_HELD;
  try {
    const r = spawnSync(findBash(), ['-c', script(`cpu_lock_release ${PROJECT}`)], { windowsHide: true, encoding: 'utf8', env: lockEnv() });
    process.stderr.write(String(r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('cpu_lock:')).map((l) => l + '\n').join(''));
  } catch (e) { console.error(`cpu-lock: release failed: ${e.message}`); }
}
