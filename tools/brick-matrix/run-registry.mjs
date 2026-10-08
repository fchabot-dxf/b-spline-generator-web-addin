// Brick matrix: every run's own Chrome and server, on record -- so a run that dies without its cleanup (killed by a
// timeout, a task stop, a hard kill, a killed --parallel parent) leaves processes someone can FIND, and only its owner
// removes. MEASURED 2026-10-07: 167 Chromes on Fred's PC, 1.6 GB free of 32; run.mjs cleaned up only in its `finally`,
// which a killed process never reaches (a hard kill on Windows cannot be trapped at all).
//
// A run writes REGISTRY_DIR/<runPid>.json at start ({ runPid, chromePid, serverPid, profile, port, http, root, startedAt })
// and removes it when it stops. A record whose run is gone but whose Chrome / server still runs is an ORPHAN -- reported
// by orphans.mjs, and killed only by the seat that owns it (`--kill --root <its worktree>`), each PID checked against its
// recorded command line first (a reused PID is never killed).
import os from 'node:os';
import path from 'node:path';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PROFILE_PREFIX } from './ports.mjs'; // the matrix's own profile-dir prefix, declared once there

export const REGISTRY_DIR = path.join(os.tmpdir(), 'brick-matrix-runs');

/** Record this run; returns the record's file (removed by unregisterRun). */
export function registerRun(rec, dir = REGISTRY_DIR) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${rec.runPid}.json`);
  writeFileSync(file, JSON.stringify(rec));
  return file;
}
export function unregisterRun(file) { try { rmSync(file, { force: true }); } catch {} }
/** Every record under `dir` ({ file, ...rec }); an unreadable one is skipped. */
export function readRuns(dir = REGISTRY_DIR) {
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  return names.map((n) => { try { return { file: path.join(dir, n), ...JSON.parse(readFileSync(path.join(dir, n), 'utf8')) }; } catch { return null; } }).filter(Boolean);
}

const norm = (s) => String(s || '').replace(/\\/g, '/').toLowerCase();
/** The program a command line runs (its first token's file name): only a Chrome is a matrix Chrome -- MEASURED (seat E's
 *  live proof): a shell whose command line merely MENTIONED a matrix profile was listed as one. */
const exeOf = (cmd) => { const m = String(cmd || '').trim().match(/^"([^"]+)"|^(\S+)/); return m ? path.basename(norm(m[1] || m[2])) : ''; };
const isChrome = (cmd) => /^(chrome|chrome\.exe|google-chrome|chromium|chromium-browser)$/.test(exeOf(cmd));
/** Is `cmd` (a live process's command line) still the process the record started? (a PID can be reused) */
export function matchesRecord(kind, cmd, run) {
  const c = norm(cmd);
  if (kind === 'chrome') return isChrome(cmd) && c.includes(norm(run.profile));
  if (kind === 'server') return c.includes('serve.py') && new RegExp(`serve\\.py"?\\s+${run.http}(\\s|$)`).test(c);
  return false;
}

/**
 * Pure: the records whose run is gone while its Chrome / server still runs as recorded.
 * @param {Array} runs readRuns()
 * @param {Map<number,string>} procs live processes: pid -> command line
 * @returns {Array<{ run, pids: Array<{ pid, kind }> }>} each orphaned run and its still-live recorded processes
 */
export function classifyOrphans(runs, procs) {
  const out = [];
  for (const run of runs) {
    if (procs.has(run.runPid)) continue; // the run is alive: its own cleanup will run
    const pids = [['chrome', run.chromePid], ['server', run.serverPid]]
      .filter(([kind, pid]) => procs.has(pid) && matchesRecord(kind, procs.get(pid), run))
      .map(([kind, pid]) => ({ pid, kind }));
    out.push({ run, pids });
  }
  return out;
}
/** Pure: matrix Chromes (a browser process on a brick-matrix profile) no record names -- reported, never killed. */
export function unregisteredMatrixChromes(runs, procs) {
  const known = new Set(runs.map((r) => norm(r.profile)));
  const out = [];
  for (const [pid, cmd] of procs) {
    const c = norm(cmd);
    if (!isChrome(cmd) || c.includes('--type=') || !c.includes(PROFILE_PREFIX)) continue; // Chrome browser processes only
    const m = c.match(/--user-data-dir=("([^"]+)"|(\S+))/);
    const dir = m ? (m[2] || m[3]) : '';
    if (![...known].some((k) => dir && (dir.includes(k) || k.includes(dir)))) out.push({ pid, profile: dir });
  }
  return out;
}
/** Pure: what `--kill --root <root>` may kill -- only orphans of runs that served THAT root (a seat's own worktree). */
export function killPlan(orphans, root) {
  const r = norm(path.resolve(root));
  return orphans.filter((o) => norm(path.resolve(o.run.root)) === r).flatMap((o) => o.pids.map((p) => ({ ...p, runPid: o.run.runPid })));
}

/** Live processes (pid -> command line); null when the list can't be read (then nothing is classified or killed). */
export function processTable() {
  try {
    if (process.platform === 'win32') {
      const json = execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
      return new Map(JSON.parse(json).map((p) => [p.ProcessId, p.CommandLine || '']));
    }
    const text = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
    return new Map(text.split('\n').filter(Boolean).map((l) => { const m = l.trim().match(/^(\d+)\s+(.*)$/); return [Number(m[1]), m[2]]; }));
  } catch { return null; }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** Kill one process and its children (Chrome's renderers), owner-checked by the caller. Judged by the process being GONE,
 *  not by taskkill's exit code -- MEASURED (seat E's live proof): with /T, a renderer already ending makes taskkill report
 *  an error while the browser does go, so a successful kill read as a failure. */
export function killTree(pid, waitMs = 5000) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 20000 });
    else process.kill(pid, 'SIGKILL');
  } catch {}
  for (const t0 = Date.now(); Date.now() - t0 < waitMs;) { if (!alive(pid)) return true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); }
  return !alive(pid);
}

/** A run's stop: kill its Chrome (with its renderers) and its server, remove its record -- once, from any exit path. */
export function makeStop({ chrome, server, file, kill = killTree }) {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (chrome && chrome.pid) { if (!kill(chrome.pid)) { try { chrome.kill(); } catch {} } }
    if (server) { try { server.kill(); } catch {} }
    if (file) unregisterRun(file);
  };
}
