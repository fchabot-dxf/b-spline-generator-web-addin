/**
 * core/job-timeline-baselines.js -- job-timeline step 3 slice 3 (Fred via the advisor 2026-10-16): the weighted Δ
 * readout. Generalizes core/job-timeline-snapshot.js's Back-only capture/drop to every `cuts` category a kind
 * declares ('top' | 'back' | 'frame', core/job-timeline.js) -- the SAME rule as Back: when the head passes the
 * LATEST step sharing a `cuts` value, that surface's current state is captured as its baseline; moving the head
 * back out drops it; a reorder that doesn't cross a `cuts` boundary leaves it untouched (main/job-timeline-strip.js
 * _commit carries P.jobTimeline.snapshots forward always). 'top'/'frame' baselines are DIFF-ONLY: unlike Back,
 * nothing ever reads them to override a rebuild -- front edits stay editable (Fred). Several kinds can share one
 * `cuts` value (every lattice/vector/brick stamp is 'top') -- crossing a LATER one re-anchors that surface's
 * baseline to the more recent moment, matching how Fred actually cuts colour layers one at a time.
 *
 * Δ[surface] = max|current − baseline| (inches for back/top; for frame, the largest difference across the frame
 * record's own numeric fields -- frameBottomZ, panelLip, its template's own `params` -- core/frame-record.js). A
 * surface with no baseline contributes 0. The weighted score (JOB_DELTA_WEIGHTS) is Σ weight[surface]·Δ[surface].
 */
import { P, lastResult } from './state.js';
import { JOB_STEP_KINDS, JOB_DELTA_WEIGHTS } from './job-timeline.js';
import { quantizeHeights, dequantizeHeights, captureBackSnapshot, dropBackSnapshot } from './job-timeline-snapshot.js';
import { getFrameRecord } from './frame-record.js';

const CUT_SURFACES = Object.freeze(['back', 'top', 'frame']);

/** The highest order-index < head whose step's kind declares this `cuts` value, or -1 -- the step whose crossing
 *  most recently (re-)anchored that surface's baseline. */
function latestCutIndexFor(order, steps, head, cuts) {
  const kindOf = new Map(steps.map((s) => [s.id, s.kind]));
  let idx = -1;
  for (let i = 0; i < head && i < order.length; i++) {
    const kind = kindOf.get(order[i]);
    if (kind && JOB_STEP_KINDS[kind].cuts === cuts) idx = i;
  }
  return idx;
}

/** Captures the CURRENT top heights (core/engine/rebuild.js's own last build) -- quantized the same way Back's own
 *  underside is (core/job-timeline-snapshot.js), just a different array. A no-op (false) with nothing built yet. */
export function captureTopBaseline() {
  if (!lastResult || !lastResult.heights || !lastResult.nx || !lastResult.nz) return false;
  const { nx, nz, heights } = lastResult;
  const snap = quantizeHeights(Array.from(heights), nx, nz);
  P.jobTimeline = { ...P.jobTimeline, snapshots: { ...(P.jobTimeline?.snapshots || {}), top: { ...snap, capturedAt: Date.now() } } };
  return true;
}

/** Drops the top baseline -- a no-op (false) if there wasn't one. */
export function dropTopBaseline() {
  if (!P.jobTimeline?.snapshots?.top) return false;
  const { top, ...rest } = P.jobTimeline.snapshots;
  P.jobTimeline = { ...P.jobTimeline, snapshots: rest };
  return true;
}

/** The frame record's own numeric fields, dotted for params -- only these are comparable "in inches"; templateId,
 *  appearance, seeds etc. are categorical, not a Δ. */
function frameFootprint(record) {
  const out = {};
  if (!record) return out;
  if (Number.isFinite(record.frameBottomZ)) out.frameBottomZ = record.frameBottomZ;
  if (Number.isFinite(record.panelLip)) out.panelLip = record.panelLip;
  if (record.params && typeof record.params === 'object') {
    for (const [k, v] of Object.entries(record.params)) if (Number.isFinite(v)) out[`params.${k}`] = v;
  }
  return out;
}

/** Captures the CURRENT frame record's numeric footprint (core/frame-record.js getFrameRecord) -- never the whole
 *  record (templateId etc. aren't a Δ), diff-only, same as top. A no-op (false) without a frame on the board. */
export function captureFrameBaseline() {
  const rec = getFrameRecord();
  if (!rec || !rec.templateId) return false;
  P.jobTimeline = { ...P.jobTimeline, snapshots: { ...(P.jobTimeline?.snapshots || {}), frame: { footprint: frameFootprint(rec), capturedAt: Date.now() } } };
  return true;
}

/** Drops the frame baseline -- a no-op (false) if there wasn't one. */
export function dropFrameBaseline() {
  if (!P.jobTimeline?.snapshots?.frame) return false;
  const { frame, ...rest } = P.jobTimeline.snapshots;
  P.jobTimeline = { ...P.jobTimeline, snapshots: rest };
  return true;
}

const BASELINE_HANDLERS = Object.freeze({
  back: Object.freeze({ capture: captureBackSnapshot, drop: dropBackSnapshot }),
  top: Object.freeze({ capture: captureTopBaseline, drop: dropTopBaseline }),
  frame: Object.freeze({ capture: captureFrameBaseline, drop: dropFrameBaseline }),
});

/** Called on every head move (main/job-timeline-strip.js _commit), before the undo snapshot -- the SAME timing
 *  Back's own capture/drop already used (slice 2), so this rides the same global-undo step for every surface. */
export function syncCutBaselines(prevOrder, prevHead, newOrder, newHead, steps) {
  for (const cuts of CUT_SURFACES) {
    const before = latestCutIndexFor(prevOrder, steps, prevHead, cuts);
    const after = latestCutIndexFor(newOrder, steps, newHead, cuts);
    if (after === before) continue;
    if (after >= 0) BASELINE_HANDLERS[cuts].capture();
    else BASELINE_HANDLERS[cuts].drop();
  }
}

/** Back's own Δ: max|current underside − baseline| in inches, resampled to the current grid if it changed size
 *  since capture (core/job-timeline-snapshot.js dequantizeHeights). 0 with no baseline. */
export function computeBackDelta() {
  const snap = P.jobTimeline?.snapshots?.back;
  if (!snap || !lastResult?.thickenData?.offsetPts || !lastResult.nx || !lastResult.nz) return 0;
  const { nx, nz, thickenData } = lastResult;
  const baseline = dequantizeHeights(snap, nx, nz);
  let maxDelta = 0;
  for (let k = 0; k < nx * nz; k++) {
    const d = Math.abs(thickenData.offsetPts[k * 3 + 2] - baseline[k]);
    if (d > maxDelta) maxDelta = d;
  }
  return maxDelta;
}

/** The top surface's own Δ: max|current heights − baseline| in inches. 0 with no baseline. */
export function computeTopDelta() {
  const snap = P.jobTimeline?.snapshots?.top;
  if (!snap || !lastResult?.heights || !lastResult.nx || !lastResult.nz) return 0;
  const { nx, nz, heights } = lastResult;
  const baseline = dequantizeHeights(snap, nx, nz);
  let maxDelta = 0;
  for (let k = 0; k < nx * nz; k++) {
    const d = Math.abs(heights[k] - baseline[k]);
    if (d > maxDelta) maxDelta = d;
  }
  return maxDelta;
}

/** The frame's own Δ: the largest |current − baseline| across the numeric fields both records share. 0 with no
 *  baseline, or if a template change left no field in common (a wholly different frame -- no shared number to read). */
export function computeFrameDelta(current = getFrameRecord()) {
  const snap = P.jobTimeline?.snapshots?.frame;
  if (!snap) return 0;
  const a = snap.footprint || {};
  const b = frameFootprint(current);
  let maxDelta = 0;
  for (const k of Object.keys(a)) {
    if (!(k in b)) continue;
    const d = Math.abs(a[k] - b[k]);
    if (d > maxDelta) maxDelta = d;
  }
  return maxDelta;
}

/** { deltas: {back, top, frame}, score }: score = Σ weight[surface]·Δ[surface] (JOB_DELTA_WEIGHTS). Detection
 *  only -- no blocking threshold (that's Fred's own number, ask before adding one). */
export function computeWeightedDelta() {
  const deltas = { back: computeBackDelta(), top: computeTopDelta(), frame: computeFrameDelta() };
  let score = 0;
  for (const [surface, weight] of Object.entries(JOB_DELTA_WEIGHTS)) score += weight * (deltas[surface] || 0);
  return { deltas, score };
}
