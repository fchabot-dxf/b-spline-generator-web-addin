// Heavy-run guard: the ONE place that decides whether a heavy run (the full vitest suite, the brick matrix) may start
// on this shared PC now.
//
// MEASURED 2026-10-07: Fred's PC crawled (1.6 GB free of 32, CPU 100%, 167 Chromes) while the advisor's gate ran and
// seats started full runs beside it -- a seat had printed its free-RAM figure and run anyway. A rule a person reads
// is not a guard; this runs at the top of the command:
//   - the full vitest suite:  npm run test:full        (package.json -- the plain `vitest run <file>` stays unguarded)
//   - the brick matrix:       node tools/brick-matrix/run.mjs ...   (every top-level run; --parallel's own group
//                             children skip it: HEAVY_RUN_CHILD_ENV)
//   - anything else heavy:    node tools/heavy-run-guard.mjs && <command>
//
// It refuses (exit 3, the reason printed) while any lock in GATE_LOCKS exists or free RAM is under the floor. The gate itself
// holds the lock while it runs the matrix and vitest, so the lock's OWNER passes: the gate exports its lock's pid
// (gate.sh writes "<pid> <HH:MM> <args>") as BSPLINE_GATE_LOCK_OWNER, and a process whose variable matches the lock's
// pid is the gate's own. Without that export the gate would block itself.
//
// 2026-10-08: Fred's other project on this PC (DDCS Studio) runs its own long gates; heavy suites from both at once
// slow both and make timing tests flaky. The two projects agreed a two-way lock: each one's heavy runs wait while the
// other's lock exists. The locks are a DECLARED list (GATE_LOCKS) -- a new one is a new row.
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Every lock that holds a heavy run back. `ownerPasses`: the run whose OWNER_ENV equals the lock's first field (the
 *  gate's own) goes through it -- only our own gate's lock; the other project's always refuses. */
export const GATE_LOCKS = Object.freeze([
  { file: path.join(os.homedir(), '.bspline-status', 'gate_running'), who: 'the gate', ownerPasses: true },
  { file: path.join(os.homedir(), '.ddcs-status', 'gate_running'), who: "DDCS Studio's gate (Fred's other project on this PC)", ownerPasses: false },
]);
export const GATE_LOCK = GATE_LOCKS[0].file;
export const MIN_FREE_GB = 4;
export const OWNER_ENV = 'BSPLINE_GATE_LOCK_OWNER';
export const HEAVY_RUN_CHILD_ENV = 'BSPLINE_HEAVY_RUN_CHILD'; // set by a guarded parent for the children it spawns
export const REFUSED_EXIT = 3;

/** Pure: { ok, why }. lockTexts[i] = GATE_LOCKS[i]'s file text, or null when there is none; freeBytes = free RAM. */
export function heavyRunVerdict({ lockTexts = [], ownerEnv, freeBytes, child = false }) {
  if (child) return { ok: true, why: 'a guarded parent run spawned this one' };
  let owned = null;
  for (let i = 0; i < GATE_LOCKS.length; i++) {
    const text = lockTexts[i];
    if (text == null) continue;
    const lock = GATE_LOCKS[i], line = String(text).trim();
    const lockPid = line.split(/\s+/)[0] || null;
    if (lock.ownerPasses && lockPid && ownerEnv && String(ownerEnv).trim() === lockPid) { owned = lockPid; continue; }
    return { ok: false, why: `${lock.who} is running (${lock.file}: "${line}") -- wait until it is gone` };
  }
  if (owned) return { ok: true, why: `the gate's own run (lock pid ${owned})` };
  const freeGb = freeBytes / 2 ** 30;
  if (freeGb < MIN_FREE_GB) return { ok: false, why: `free RAM ${freeGb.toFixed(1)} GB is under the ${MIN_FREE_GB} GB floor -- wait` };
  return { ok: true, why: `no gate lock, free RAM ${freeGb.toFixed(1)} GB` };
}

/** The verdict for THIS process, read from the machine. */
export function heavyRunVerdictNow(env = process.env) {
  const lockTexts = GATE_LOCKS.map(({ file }) => { try { return readFileSync(file, 'utf8'); } catch { return null; } });
  return heavyRunVerdict({ lockTexts, ownerEnv: env[OWNER_ENV], freeBytes: os.freemem(), child: env[HEAVY_RUN_CHILD_ENV] === '1' });
}

/** For a heavy run's entry point: refuse (print why, exit REFUSED_EXIT) or return. */
export function guardHeavyRun(label) {
  const v = heavyRunVerdictNow();
  if (!v.ok) { console.error(`heavy-run guard: ${label} refused -- ${v.why}`); process.exit(REFUSED_EXIT); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) guardHeavyRun(process.argv[2] || 'heavy run');
