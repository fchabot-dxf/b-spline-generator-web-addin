// Brick matrix: which local ports a run may take, and which of its own leftover Chrome profiles may go.
//
// MEASURED (seat D, item 74 side task): Fusion's material-library server (adexmtsv.exe) listens on 127.0.0.1:9891 -- the
// DevTools port --parallel gives its 19th group (strokes). It accepts a connection and drops HTTP, so the old busy check
// (an HTTP fetch) read the port as free; Chrome could not bind it and the group died "no Chrome DevTools endpoint", which
// the gate counted as a page error. A port is busy when it cannot be BOUND, or when something answers HTTP on it.
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { readdirSync, statSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const answersHttp = (port) => fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(400) }).then(() => true, () => false);
const bindFails = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(true));
  s.listen({ port, host: '127.0.0.1', exclusive: true }, () => s.close(() => resolve(false)));
});
export async function portBusy(port) {
  return (await bindFails(port)) || (await answersHttp(port));
}

// Leftover profiles: the matrix makes a fresh `brick-matrix-chrome-<port>-XXXXXX` dir per run and drops it at the end; a
// killed run leaves it behind (713 in %TEMP% on 2026-10-06). Only those dirs go, only when no running Chrome uses one,
// and only once older than PROFILE_MIN_AGE_MS -- a sibling group of the same --parallel run may have made its dir and not
// started its Chrome yet.
export const PROFILE_PREFIX = 'brick-matrix-chrome-';
export const PROFILE_MIN_AGE_MS = 15 * 60 * 1000;
// at most this many per run: a Chrome profile is thousands of files -- MEASURED, the first cleanup of a 713-dir backlog
// had removed 312 after 400 s, which would have stalled a gate; a backlog now clears over runs
export const PROFILE_DROP_MAX = 10; // ~1.3 s each measured: a run spends at most ~15 s on it

/** The --user-data-dir of every running Chrome (lower-cased, normalised); an empty set when the list can't be read. */
export function chromeProfilesInUse() {
  let text = '';
  try {
    text = process.platform === 'win32'
      ? execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { $_.CommandLine }"], { encoding: 'utf8', timeout: 20000 })
      : execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' });
  } catch { return null; } // unknown: the caller removes nothing
  const dirs = new Set();
  for (const m of text.matchAll(/--user-data-dir=("([^"]+)"|(\S+))/g)) dirs.add(path.resolve(m[2] || m[3]).toLowerCase());
  return dirs;
}

/** Pure: which of `entries` ({ dir, mtimeMs }) are this matrix's own, unused and old enough to remove. */
export function staleProfiles(entries, inUse, now = Date.now()) {
  if (!inUse) return [];
  return entries.filter((e) => path.basename(e.dir).startsWith(PROFILE_PREFIX)
    && !inUse.has(path.resolve(e.dir).toLowerCase()) && now - e.mtimeMs >= PROFILE_MIN_AGE_MS);
}

/** Remove up to `max` stale ones under `tmp`, oldest first; returns how many went. */
export function dropStaleProfiles(tmp = os.tmpdir(), max = PROFILE_DROP_MAX) {
  let names = [];
  try { names = readdirSync(tmp).filter((n) => n.startsWith(PROFILE_PREFIX)); } catch { return 0; }
  if (!names.length) return 0;
  const entries = names.map((n) => { try { return { dir: path.join(tmp, n), mtimeMs: statSync(path.join(tmp, n)).mtimeMs }; } catch { return null; } }).filter(Boolean);
  let n = 0;
  const stale = staleProfiles(entries, chromeProfilesInUse()).sort((a, b) => a.mtimeMs - b.mtimeMs).slice(0, max);
  for (const e of stale) { try { rmSync(e.dir, { recursive: true, force: true }); n++; } catch {} }
  return n;
}
