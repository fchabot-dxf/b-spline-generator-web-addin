/**
 * core/pull-changelist.js -- Pull from Fusion, step (b) (seat D 2026-10-16; advisor 45, Fred): turns a Pull
 * response (b-spline-gen.py _handle_pull_sketch's `boardParams`, `widthIn`/`heightIn`) into the change list the
 * dialog shows -- PULL_MAP (core/pull-map.js) read against the app's own current values. Pure (no DOM, no P
 * writes except through the caller's own `applyRows`) -- main/pull-changelist.js wires this to the real dialog
 * and the app's real P/pattern/frame objects.
 *
 * Nothing here APPLIES a value on its own read -- buildChangeList only ever builds the list; applyRows (called
 * from the dialog's own Apply button, one undo step around it -- main/pull-changelist.js) is the one write path.
 */
import { PULL_MAP } from './pull-map.js';

/** A change smaller than this is quantization/float noise (the same Fusion round-trip + the app's own float
 *  storage), not a real edit worth showing -- same floor core/job-timeline-baselines.js's own Δ badge gate uses. */
export const CHANGE_EPS_IN = 0.0005;

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = obj;
  for (const k of keys) { if (target[k] == null) target[k] = {}; target = target[k]; }
  target[last] = value;
}

/** stroke_width (rails+ties linked, Send's own default -- core/pull-map.js's own doc comment) folds into BOTH
 *  rail_width and tie_width before diffing, so PULL_MAP itself stays a flat 1:1 map. A new object; `params` is
 *  never mutated. */
export function normalizeLayerParams(params) {
  if (!Number.isFinite(params.stroke_width)) return { ...params };
  const { stroke_width, ...rest } = params;
  return { ...rest, rail_width: stroke_width, tie_width: stroke_width };
}

/** The layer-scoped slice of a flat boardParams dict for ONE real layer id ("L7_rail_width" -> "rail_width"),
 *  normalized (stroke_width folded). Another layer's own "L<otherId>_..." entries are never included. */
export function layerParamsFor(boardParams, layerId) {
  const prefix = `L${layerId}_`;
  const out = {};
  for (const [k, v] of Object.entries(boardParams)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  }
  return normalizeLayerParams(out);
}

/** Every PULL_MAP row for `scope` that Fusion actually holds a value for, each marked `changed` (vs the app's own
 *  current value, through the row's own appPath) or not -- `compareScope` keeps BOTH so the caller can count
 *  "kept" (present, matches) separately from the rows it actually shows. */
export function compareScope(scope, fusionParams, appObj) {
  const out = [];
  for (const entry of PULL_MAP) {
    if (entry.scope !== scope) continue;
    const to = fusionParams[entry.fusionParam];
    if (!Number.isFinite(to)) continue;
    const from = getPath(appObj, entry.appPath);
    const changed = !Number.isFinite(from) || Math.abs(from - to) >= CHANGE_EPS_IN;
    out.push({ ...entry, from, to, changed });
  }
  return out;
}

/** The CHANGED rows only (compareScope, filtered) -- what a change-list group actually shows. `extra` (layerId,
 *  layerName) rides along on each row for the dialog's own grouping -- this function doesn't know what a "layer"
 *  even is beyond its params object. */
export function diffScope(scope, fusionParams, appObj, extra = {}) {
  return compareScope(scope, fusionParams, appObj).filter((r) => r.changed).map((r) => ({ ...r, ...extra }));
}

/** Applies every row's own `to` value back onto its scope's app object (the SAME appPath each row named itself
 *  with) -- the actual write Apply performs. Pure mutation; re-layout / regenerate / undo are the dialog's own
 *  job (main/pull-changelist.js), not this function's. */
export function applyRows(rows, appObj) {
  for (const row of rows) setPath(appObj, row.appPath, row.to);
}

const LAYER_KEY = /^L[^_]+_(.+)$/;

/** The full change list for one Pull response: { boardRows, layerGroups: [{layerId, layerName, rows}], frameRows,
 *  keptCount, notMappedCount }. `layers` = the board's own lattice OWNER layers only (the caller already knows
 *  which editor layers belong to this board) -- [{ id, name, pattern }]; `frame` = P.frame, or null when this
 *  board has none. A Fusion param PULL_MAP doesn't declare, or one that already matches the app, is COUNTED
 *  (notMappedCount / keptCount), never silently dropped -- the advisor's own REPORT line. */
export function buildChangeList(pullResult, { P, layers = [], frame = null }) {
  const boardParams = pullResult.boardParams || {};
  const boardRows = Number.isFinite(pullResult.widthIn) && Number.isFinite(pullResult.heightIn)
    ? diffScope('board', { widthIn: pullResult.widthIn, heightIn: pullResult.heightIn }, P) : [];

  const layerGroups = [];
  const claimedRawKeys = new Set();
  let keptCount = 0;

  for (const layer of layers) {
    const prefix = `L${layer.id}_`;
    const raw = {};
    const rawKeyOf = {}; // base name -> the actual boardParams key it came from (prefixed, or bare -- see below)
    for (const [k, v] of Object.entries(boardParams)) {
      if (k.startsWith(prefix)) { const base = k.slice(prefix.length); raw[base] = v; rawKeyOf[base] = k; }
    }
    // live 2026-10-16 (seat D): a design with no tagged board is BoardNamer's own "legacy" identity scope
    // (fb_engine/board_scope.py's own doc comment -- "the legacy root board has none: its names stay as they
    // are") -- Send skips ALL scoping then, board AND layer, so a single-board document's lattice params come
    // back from Fusion completely bare (no "L<id>_" at all), not just un-board-prefixed. That's the common case
    // (most users have exactly one board), so a layer-prefixed match always wins, but when this board has
    // exactly one lattice-owner layer, an otherwise-unclaimed bare key is this layer's own too. Two-or-more
    // layers on an identity board would collide at the Fusion level already (Send's own limitation, not Pull's
    // to resolve) -- the gate below only ever fills in what the prefix match didn't already find.
    if (layers.length === 1) {
      for (const [k, v] of Object.entries(boardParams)) {
        if (LAYER_KEY.test(k) || k in rawKeyOf) continue;
        raw[k] = v; rawKeyOf[k] = k;
      }
    }
    const compared = compareScope('layer', normalizeLayerParams(raw), layer.pattern);
    const changed = compared.filter((r) => r.changed);
    if (changed.length) layerGroups.push({ layerId: layer.id, layerName: layer.name, rows: changed.map((r) => ({ ...r, layerId: layer.id, layerName: layer.name })) });
    keptCount += compared.length - changed.length;
    // claim the RAW key(s) this layer's own comparison actually consumed -- stroke_width claims itself once even
    // though it feeds two PULL_MAP rows (rail_width + tie_width)
    if (Number.isFinite(raw.stroke_width) && compared.some((r) => r.fusionParam === 'rail_width' || r.fusionParam === 'tie_width')) {
      claimedRawKeys.add(rawKeyOf.stroke_width);
    }
    for (const r of compared) if (r.fusionParam !== 'stroke_width' && Number.isFinite(raw[r.fusionParam])) claimedRawKeys.add(rawKeyOf[r.fusionParam]);
  }

  let frameRows = [];
  if (frame) {
    const compared = compareScope('frame', boardParams, frame);
    frameRows = compared.filter((r) => r.changed);
    keptCount += compared.length - frameRows.length;
    for (const r of compared) claimedRawKeys.add(r.fusionParam);
  }

  let notMappedCount = 0;
  for (const key of Object.keys(boardParams)) {
    if (claimedRawKeys.has(key)) continue;
    const m = key.match(LAYER_KEY);
    // a layer-prefixed key whose layer isn't even in `layers` (not this board's, or not a lattice owner) -- not
    // this board's problem to report; a plain key, or a layer key this board's own layer didn't recognize, IS
    if (m && !layers.some((l) => key.startsWith(`L${l.id}_`))) continue;
    notMappedCount++;
  }

  // advisor 2026-10-16: rails move freely in Fusion now (no driving param -- core/pull-map.js's own doc comment)
  // -- their new positions come back as GEOMETRY (pulled curves), not a param row. The rails-lock slice (Send-
  // tagged rail ids, matched and applied) isn't built yet; until it lands this is INFORMATIONAL ONLY -- Apply
  // never touches geometry. Non-construction curves only (the carved/drawn ones -- construction geometry was
  // never a rail to begin with, same filter pull-sketch.js's own onSketchPulled already applies).
  const curveCount = (pullResult.curves || []).filter((c) => !c.isConstruction).length;

  return { boardRows, layerGroups, frameRows, keptCount, notMappedCount, curveCount };
}
