// Brick matrix orphans: the Chromes / servers of matrix runs that died without their cleanup (run-registry.mjs).
//
//   node tools/brick-matrix/orphans.mjs                      report only: orphaned runs + unregistered matrix Chromes
//   node tools/brick-matrix/orphans.mjs --kill --root <dir>  kill the orphans of runs that served <dir> -- your OWN
//                                                            worktree's -- each PID re-checked against its record
// A run that is still alive is never touched (its own stop runs); an unregistered matrix Chrome is reported, never
// killed (no record says whose it is); a finished orphan's record is removed.
import path from 'node:path';
import { readRuns, classifyOrphans, unregisteredMatrixChromes, killPlan, processTable, killTree, unregisterRun, matchesRecord } from './run-registry.mjs';

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const kill = process.argv.includes('--kill');
const root = arg('root');
if (kill && !root) { console.error('orphans: --kill needs --root <your worktree> (only your own runs are killed)'); process.exit(2); }

const procs = processTable();
if (!procs) { console.error('orphans: could not read the process list -- nothing classified, nothing killed'); process.exit(2); }
const runs = readRuns();
const orphans = classifyOrphans(runs, procs);
const unknown = unregisteredMatrixChromes(runs, procs);

for (const o of orphans) {
  const r = o.run;
  console.log(`orphan run ${r.runPid} (port ${r.port}/${r.http}, root ${r.root}, started ${new Date(r.startedAt).toISOString()}): `
    + (o.pids.length ? o.pids.map((p) => `${p.kind} ${p.pid}`).join(', ') : 'nothing left running'));
}
for (const u of unknown) console.log(`unregistered matrix Chrome ${u.pid} (profile ${u.profile}) -- not killed: no record says whose it is`);
if (!orphans.length && !unknown.length) console.log('orphans: none');

// records whose run AND processes are all gone: just stale files
for (const o of orphans) if (!o.pids.length) unregisterRun(o.run.file);

if (kill) {
  const plan = killPlan(orphans, root);
  let n = 0;
  for (const p of plan) {
    const run = orphans.find((o) => o.run.runPid === p.runPid).run;
    const now = processTable();
    if (!now || !now.has(p.pid) || !matchesRecord(p.kind, now.get(p.pid), run)) continue; // gone, or the PID was reused
    if (killTree(p.pid)) { n++; console.log(`killed ${p.kind} ${p.pid} (run ${p.runPid})`); }
  }
  for (const o of orphans) if (path.resolve(o.run.root).toLowerCase() === path.resolve(root).toLowerCase()) unregisterRun(o.run.file);
  console.log(`orphans: killed ${n} process(es) of runs that served ${root}`);
}
