/**
 * Matrix Chrome hygiene (seat E, 2026-10-07: 167 Chromes on Fred's PC, 1.6 GB free of 32): every matrix run records
 * its Chrome and server (tools/brick-matrix/run-registry.mjs), stops them on every exit path, and a run that died
 * without its cleanup leaves a record orphans.mjs can find -- killed only by its owner (its worktree), PID-checked.
 */
import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { registerRun, unregisterRun, readRuns, matchesRecord, classifyOrphans, unregisteredMatrixChromes, killPlan, makeStop } from '../tools/brick-matrix/run-registry.mjs';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'reg-test-'));
const PROFILE = 'C:\\Users\\me\\AppData\\Local\\Temp\\brick-matrix-chrome-9801-abc123';
const RUN = { runPid: 100, chromePid: 200, serverPid: 300, profile: PROFILE, port: 9801, http: 9802, root: 'C:\\wt\\61-r37\\bspline-frame-builder', startedAt: 0 };
const CHROME_CMD = `"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --remote-debugging-port=9801 --user-data-dir=${PROFILE} --no-first-run`;
const SERVER_CMD = 'python C:\\wt\\61-r37\\tools\\brick-matrix\\serve.py 9802';

describe('the registry: a run on record', () => {
  it('a run writes its record, reads back, and removes it', () => {
    const dir = tmp();
    const file = registerRun(RUN, dir);
    expect(readRuns(dir)).toEqual([{ file, ...RUN }]);
    unregisterRun(file);
    expect(readRuns(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
  it('a live PID counts as the recorded process only while its command line still is it (a reused PID is not)', () => {
    expect(matchesRecord('chrome', CHROME_CMD, RUN)).toBe(true);
    expect(matchesRecord('chrome', 'C:\\Windows\\notepad.exe', RUN)).toBe(false);
    expect(matchesRecord('chrome', CHROME_CMD.replace('abc123', 'zzz999'), RUN)).toBe(false);
    expect(matchesRecord('server', SERVER_CMD, RUN)).toBe(true);
    expect(matchesRecord('server', SERVER_CMD.replace('9802', '98021'), RUN)).toBe(false);
  });
});

describe('orphans: a dead run whose Chrome / server still runs', () => {
  const procs = (entries) => new Map(entries);
  it('a run still alive is not an orphan (its own stop runs)', () => {
    expect(classifyOrphans([RUN], procs([[100, 'node run.mjs'], [200, CHROME_CMD], [300, SERVER_CMD]]))).toEqual([]);
  });
  it('a dead run: its still-running recorded Chrome and server are listed', () => {
    expect(classifyOrphans([RUN], procs([[200, CHROME_CMD], [300, SERVER_CMD]]))).toEqual([{ run: RUN, pids: [{ pid: 200, kind: 'chrome' }, { pid: 300, kind: 'server' }] }]);
  });
  it('a recorded PID now held by another program is never listed', () => {
    expect(classifyOrphans([RUN], procs([[200, 'C:\\Windows\\explorer.exe']]))).toEqual([{ run: RUN, pids: [] }]);
  });
  it('a matrix Chrome no record names is reported (never killed); renderers and other Chromes are not', () => {
    const stray = 'C:\\Temp\\brick-matrix-chrome-9711-qqq';
    const list = procs([
      [200, CHROME_CMD], // registered
      [210, `chrome.exe --type=renderer --user-data-dir=${stray}`], // a renderer
      [220, `chrome.exe --headless=new --user-data-dir=${stray}`], // an unregistered matrix browser
      [230, 'chrome.exe --user-data-dir=C:\\Users\\fred\\Chrome\\Default'], // Fred's own Chrome
    ]);
    expect(unregisteredMatrixChromes([RUN], list).map((u) => u.pid)).toEqual([220]);
  });
  it('--kill --root kills only the orphans of runs that served THAT root', () => {
    const other = { ...RUN, runPid: 101, chromePid: 201, serverPid: 301, root: 'C:\\wt\\other-seat\\bspline-frame-builder' };
    const orphans = [{ run: RUN, pids: [{ pid: 200, kind: 'chrome' }] }, { run: other, pids: [{ pid: 201, kind: 'chrome' }] }];
    expect(killPlan(orphans, 'C:\\wt\\61-r37\\bspline-frame-builder').map((p) => p.pid)).toEqual([200]);
    expect(killPlan(orphans, 'C:\\wt\\nobody')).toEqual([]);
  });
});

describe('a run stops its own processes on every exit path', () => {
  it('stop kills the Chrome tree and the server and removes the record -- once, however often it is called', () => {
    const dir = tmp(), file = registerRun(RUN, dir);
    const kill = vi.fn(() => true), server = { kill: vi.fn() }, chrome = { pid: 200, kill: vi.fn() };
    const stop = makeStop({ chrome, server, file, kill });
    stop(); stop();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(200);
    expect(server.kill).toHaveBeenCalledTimes(1);
    expect(chrome.kill).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
  it('a tree kill that fails falls back to killing the Chrome process itself', () => {
    const chrome = { pid: 200, kill: vi.fn() };
    makeStop({ chrome, server: null, file: null, kill: () => false })();
    expect(chrome.kill).toHaveBeenCalledTimes(1);
  });
  it('run.mjs registers its run and stops on SIGINT / SIGTERM / SIGHUP / SIGBREAK and on exit, not only in finally', () => {
    const src = readFileSync(path.join(__dirname, '../tools/brick-matrix/run.mjs'), 'utf8');
    expect(src).toMatch(/const runFile = registerRun\(\{ runPid: process\.pid, chromePid: chrome\.pid, serverPid: server\.pid/);
    expect(src).toMatch(/const stop = makeStop\(\{ chrome, server, file: runFile \}\)/);
    expect(src).toMatch(/for \(const sig of \['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'\]\) process\.on\(sig, \(\) => \{ stop\(\); dropProfile\(\); process\.exit\(130\); \}\)/);
    expect(src).toMatch(/process\.on\('exit', stop\)/);
  });
});
