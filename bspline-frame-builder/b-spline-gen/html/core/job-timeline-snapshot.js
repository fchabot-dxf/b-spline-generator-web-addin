/**
 * core/job-timeline-snapshot.js -- Back's snapshotOnLock (job-timeline step 3 slice 2, Fred via the advisor
 * 2026-10-16): when the head crosses Back locked, the underside is frozen in P.jobTimeline.snapshots.back (the
 * PROJECT file -- quantized 16-bit heights + grid dims, a test pins the byte size); core/engine/build-thicken-data.js
 * reads it back (via rebuild.js) while Back stays locked, so later front (top-surface) edits never move it.
 * Moving the head back left of Back drops the snapshot silently -- the head move itself already goes through the
 * global undo (main/job-timeline-strip.js _commit), and P.jobTimeline (snapshots included) isn't in
 * core/history.js's UNDO_KEEPS, so Undo restores the dropped snapshot for free, no extra machinery here.
 *
 * The Settings switch OFF (core/job-timeline-enabled.js): rebuild.js never reads the snapshot even if one exists
 * and the head is past Back -- the live underside, same as the switch being off for every other lock.
 */
import { P, lastResult } from './state.js';
import { resampleDelta } from './sculpt.js';

const QUANT_MAX = 65535;

/** A flat per-cell Z array -> { data (quantized 0..65535 ints), nx, nz, minZ, maxZ } -- minZ/maxZ dequantize it. */
export function quantizeHeights(zs, nx, nz) {
  let minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < zs.length; k++) { if (zs[k] < minZ) minZ = zs[k]; if (zs[k] > maxZ) maxZ = zs[k]; }
  const span = maxZ - minZ || 1; // a dead-flat underside: every cell quantizes to 0 either way, span is unused
  const data = new Array(zs.length);
  for (let k = 0; k < zs.length; k++) data[k] = Math.round(((zs[k] - minZ) / span) * QUANT_MAX);
  return { data, nx, nz, minZ, maxZ };
}

/** The reverse: a snapshot's own real Z values, resampled to (targetNx, targetNz) if the grid changed size since
 *  capture -- a resolution change or a board resize while Back is locked (the advisor: "a resize while cut is
 *  physically impossible -- resample it, don't block it; let the Δ readout show the change" (slice 3)). Reuses
 *  core/sculpt.js's own resampleDelta (BILINEAR) -- the same mechanism preDelta/postDelta already resample through
 *  on a resolution change (core/engine/rebuild.js's reconcileSculptDeltas), not a second one next to it. */
export function dequantizeHeights(snapshot, targetNx = snapshot.nx, targetNz = snapshot.nz) {
  const { data, nx, nz, minZ, maxZ } = snapshot;
  const span = maxZ - minZ || 1;
  const real = (q) => minZ + (q / QUANT_MAX) * span;
  const native = data.map(real);
  if (targetNx === nx && targetNz === nz) return native;
  return Array.from(resampleDelta(native, nx, nz, targetNx, targetNz));
}

/** Whether 'back' sits left of the playhead right now -- the step's own fixed id (core/job-timeline.js: SECTION_KINDS
 *  steps are always `{ id: kind, ... }`, so 'back' never varies per project). */
export function isBackLocked(jobTimeline) {
  return !!(jobTimeline && Array.isArray(jobTimeline.order) && jobTimeline.order.slice(0, jobTimeline.head).includes('back'));
}

/** Captures the CURRENT live underside (core/engine/rebuild.js's own last build, state.js lastResult) into
 *  P.jobTimeline.snapshots.back. A no-op (returns false) if thicken never actually built an underside (e.g.
 *  Thicken is off on this board) -- nothing to freeze. */
export function captureBackSnapshot() {
  const td = lastResult && lastResult.thickenData;
  if (!td || !td.offsetPts || !lastResult.nx || !lastResult.nz) return false;
  const { nx, nz } = lastResult;
  const zs = new Array(nx * nz);
  for (let k = 0; k < nx * nz; k++) zs[k] = td.offsetPts[k * 3 + 2];
  const snap = quantizeHeights(zs, nx, nz);
  P.jobTimeline = { ...P.jobTimeline, snapshots: { ...(P.jobTimeline?.snapshots || {}), back: { ...snap, capturedAt: Date.now() } } };
  return true;
}

/** Drops the frozen underside (the head moved back left of Back) -- a no-op (returns false) if there wasn't one. */
export function dropBackSnapshot() {
  if (!P.jobTimeline?.snapshots?.back) return false;
  const { back, ...rest } = P.jobTimeline.snapshots;
  P.jobTimeline = { ...P.jobTimeline, snapshots: rest };
  return true;
}
