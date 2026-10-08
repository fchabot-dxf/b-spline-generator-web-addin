// @vitest-environment node
/**
 * Brick matrix ports (seat D, item 74 side task): Fusion's adexmtsv.exe held 127.0.0.1:9891 -- the DevTools port
 * --parallel gives the strokes group -- and dropped HTTP, so the old fetch-based busy check read it free and the group
 * died "no Chrome DevTools endpoint" (counted as a page error). tools/brick-matrix/ports.mjs: busy = cannot be bound, or
 * answers HTTP. Plus the cleanup of the matrix's own leftover Chrome profile dirs.
 */
import { describe, it, expect } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync, readdirSync, rmSync } from 'node:fs';
import { portBusy, staleProfiles, dropStaleProfiles, PROFILE_PREFIX, PROFILE_MIN_AGE_MS, PROFILE_DROP_MAX } from '../tools/brick-matrix/ports.mjs';

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const close = (server) => new Promise((r) => server.close(() => r()));
const oldAnswers = (port) => fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(400) }).then(() => true, () => false);

describe('portBusy', () => {
  it('a port held by a server that drops every connection (adexmtsv-like) is busy -- the old HTTP check read it free', async () => {
    const dropper = net.createServer((sock) => sock.destroy());
    const port = await listen(dropper);
    try {
      expect(await oldAnswers(port)).toBe(false);
      expect(await portBusy(port)).toBe(true);
    } finally { await close(dropper); }
    expect(await portBusy(port)).toBe(false); // released: free again
  });
  it('a port serving HTTP is busy', async () => {
    const server = http.createServer((_, res) => res.end('ok'));
    const port = await listen(server);
    try { expect(await portBusy(port)).toBe(true); } finally { await close(server); }
  });
});

describe('staleProfiles: only the matrix\'s own, unused, old dirs', () => {
  const tmp = os.tmpdir(), now = 1e12, old = now - PROFILE_MIN_AGE_MS - 1, fresh = now - 1000;
  const e = (name, mtimeMs) => ({ dir: path.join(tmp, name), mtimeMs });
  it('keeps one a running Chrome uses, a fresh one (a sibling group not started yet), and anything not ours', () => {
    const inUse = new Set([path.resolve(path.join(tmp, `${PROFILE_PREFIX}9891-live`)).toLowerCase()]);
    const entries = [e(`${PROFILE_PREFIX}9891-old`, old), e(`${PROFILE_PREFIX}9891-live`, old), e(`${PROFILE_PREFIX}9711-fresh`, fresh), e('seatd-11431-x', old)];
    expect(staleProfiles(entries, inUse, now).map((x) => path.basename(x.dir))).toEqual([`${PROFILE_PREFIX}9891-old`]);
  });
  it('the running-Chrome list could not be read: nothing is removed', () => {
    expect(staleProfiles([e(`${PROFILE_PREFIX}9891-old`, old)], null, now)).toEqual([]);
  });
});

describe('dropStaleProfiles: a capped, oldest-first cleanup of real dirs', () => {
  it('removes at most PROFILE_DROP_MAX old profile dirs per run, the oldest first, and leaves a fresh one', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'bm-ports-test-'));
    try {
      const n = PROFILE_DROP_MAX + 3, t = Date.now() / 1000 - PROFILE_MIN_AGE_MS / 1000 - 60;
      for (let i = 0; i < n; i++) { const d = path.join(tmp, `${PROFILE_PREFIX}99${i}-x`); mkdirSync(d); writeFileSync(path.join(d, 'f'), 'x'); utimesSync(d, t - i * 60, t - i * 60); }
      mkdirSync(path.join(tmp, `${PROFILE_PREFIX}9999-fresh`));
      // its own Chrome list (none running on this temp root): the live list is a PowerShell call that timed out under the
      // gate's load (20 s) -- an unknown list removes nothing, which read as a failure ("expected 10, got 0", 2026-10-08)
      expect(dropStaleProfiles(tmp, PROFILE_DROP_MAX, new Set())).toBe(PROFILE_DROP_MAX);
      const left = readdirSync(tmp).sort();
      expect(left).toContain(`${PROFILE_PREFIX}9999-fresh`);
      expect(left).toContain(`${PROFILE_PREFIX}990-x`); // the newest old ones are the ones left
      expect(left).not.toContain(`${PROFILE_PREFIX}99${n - 1}-x`); // the oldest went
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }, 60000);
});

describe('run.mjs takes its ports through portBusy', () => {
  it('no fetch-only busy check is left', () => {
    const src = readFileSync('tools/brick-matrix/run.mjs', 'utf8');
    expect(src).not.toMatch(/const (answers|portAnswers) = \(port\) => fetch/);
    expect(src).toMatch(/ports\.map\(portBusy\)/); // the --parallel base pick
    expect(src).toMatch(/\(await portBusy\(PORT\)\) \|\| \(await portBusy\(HTTP\)\)/); // the default-port skip
    expect(src).toMatch(/else if \(await portBusy\(PORT\)\)/); // an explicit --port that cannot be bound
  });
});
