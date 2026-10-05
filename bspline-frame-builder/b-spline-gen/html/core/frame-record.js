/**
 * frame-record.js — FB-APP S2 (F6): the persisted FRAME RECORD (design §3.2).
 *
 * One declared record, saved and loaded with the project as `P.frame`:
 *   { recordVersion, templateId (null = no frame), params, seeds, frameBottomZ, appearance }
 * `seeds` (F9): the values of the template's SEEDED shape handles (frame-defs
 * `handles`, editor/frame-handles.js), additive, so still version 1.
 * `genSeed` (F13): the seed the Frame tab's [Generate] drew the seeds with
 * (null = not generated), so a generated shape is reproducible; additive.
 * Only overrides live in `params`; every default comes from the generated
 * frame definition (data/frame-defs.js, built from the frame builder's own
 * Python by tools/gen_frame_defs.py), so a regenerated definition never needs
 * a migration of saved projects.
 *
 * `normalizeFrameRecord` is the ONE gate every write and every load goes
 * through: a project saved before frames existed (no `frame` key), an unknown
 * template, a wood that isn't declared, or a non-numeric value all resolve to
 * the declared defaults — never a half-valid record.
 *
 * `insetWindow` (T82 item 2/5, INSET-WINDOW-DESIGN.md): a second small mitred frame set into the panel, always
 * open, hidden behind the panel. `{enabled, cx, cy, w, h}` (T82 item 5, Fred: "use the centre of frame... and
 * make the window a centre point rect too"): `cx`/`cy` the window's own centre, inches, measured from the
 * BOARD CENTRE, +y UP (Fusion's own sketch convention — `RectangleCenter` maps 1:1 onto it); `w`/`h` the OUTER
 * size, bars included (core/inset-window.js `insetWindowOuterRect` is the ONE place this converts to a
 * board-local rect). Frame-level, not per-template (every template reads it, none declare it). Deliberately NOT
 * clamped against the frame's own opening or the board edge (Fred: "then it's my responsibility to not let it
 * intersect") — normalization here only type-checks the four numbers; geometric validity (window bars /
 * opening > 0) is a property every CONSUMER checks for itself (insetWindow.js `insetWindowGeometry`), not a
 * write-time clamp. A record saved under the OLD shape (`{x1, y1, x2, y2}`, board-local, origin top-left, y
 * down) migrates on read, using the board's CURRENT width/height (`P.widthIn`/`P.heightIn` — the same lazy,
 * read-time pattern this function's own `handleMigrations` block already uses, not a one-time rewrite).
 */
import FRAME_DEFS from '../data/frame-defs.js';
import { P, saveLastSession } from './state.js';
import { markDirty } from './dirty.js';
import { haptic } from './haptics.js';

export const FRAME_RECORD_VERSION = 1;
export { FRAME_DEFS };

const _extrusion = (defs, key) => (defs.extrusion || []).find((s) => s.key === key) || {};

export function findFrameTemplate(defs, templateId) {
  return (defs.templates || []).find((t) => t.id === templateId) || null;
}

/** The declared default record: no frame (Fred, Q2). */
export function defaultFrameRecord(defs = FRAME_DEFS) {
  return {
    recordVersion: FRAME_RECORD_VERSION,
    templateId: defs.defaultTemplate ?? null,
    params: {},
    seeds: {},
    genSeed: null,
    frameBottomZ: _extrusion(defs, 'frameBottomZ').default ?? -1,
    panelLip: _extrusion(defs, 'panelLip').default ?? 0, // F22
    appearance: defs.appearance?.default ?? null,
    insetWindow: { enabled: false, cx: 0, cy: 0, w: 0, h: 0 }, // T82 item 2/5, off by default
    joinedMiters: [], // F31 item 2c, every joint SPLIT (today's behaviour) by default
  };
}

/** Any stored/loaded value -> a valid record (see module header). */
export function normalizeFrameRecord(raw, defs = FRAME_DEFS) {
  const out = defaultFrameRecord(defs);
  if (!raw || typeof raw !== 'object') return out;
  const tpl = findFrameTemplate(defs, raw.templateId);
  out.templateId = tpl ? tpl.id : null;
  const z = Number(raw.frameBottomZ);
  if (Number.isFinite(z)) out.frameBottomZ = z;
  // F12: a wood saved under its old (non-existent) name keeps its choice
  const wood = (defs.appearance?.renamed || {})[raw.appearance] || raw.appearance;
  if ((defs.appearance?.options || []).includes(wood)) out.appearance = wood;
  if (tpl && raw.params && typeof raw.params === 'object') {
    const declared = new Set(tpl.params.filter((p) => p.owner === 'frame').map((p) => p.name));
    for (const [k, v] of Object.entries(raw.params)) {
      const n = Number(v);
      if (declared.has(k) && Number.isFinite(n)) out.params[k] = n;
    }
  }
  if (tpl && Number.isInteger(raw.genSeed)) out.genSeed = raw.genSeed;
  // F22: the panel lip, inside its declared range (0 .. the record's own Trim offset); old records = the default 0
  const lip = Number(raw.panelLip);
  if (tpl && Number.isFinite(lip)) {
    const r = panelLipRange(defs, out);
    out.panelLip = Math.min(r.max, Math.max(r.min, lip));
    // H13: fires only when this SPECIFIC value was actually out of range
    // (a stored/reloaded record is already normalized, so a plain load
    // never re-trips this -- only a fresh out-of-range write does).
    if (out.panelLip !== lip) haptic('limit');
  }
  if (tpl && raw.seeds && typeof raw.seeds === 'object') {
    const seeded = new Set((tpl.handles || []).filter((h) => h.binding === 'seeded').map((h) => h.key));
    // F20: a seed key the template split (frame-defs `handleMigrations`, e.g. the one corner radius -> Shoulder +
    // Hip) becomes each of its new keys, unless the record already has that key
    const seeds = { ...raw.seeds };
    for (const [old, keys] of Object.entries(tpl.handleMigrations || {})) {
      if (old in seeds) for (const k of keys) if (!(k in seeds)) seeds[k] = seeds[old];
    }
    for (const [k, v] of Object.entries(seeds)) {
      const n = Number(v);
      if (seeded.has(k) && Number.isFinite(n)) out.seeds[k] = n;
    }
  }
  // T82 item 2/5: no clamping against the frame or the board (see module header) -- only type-checked.
  if (raw.insetWindow && typeof raw.insetWindow === 'object') {
    const w = raw.insetWindow;
    if ('cx' in w || 'cy' in w || 'w' in w || 'h' in w) {
      // The current shape already: {enabled, cx, cy, w, h}.
      const cx = Number(w.cx), cy = Number(w.cy), ww = Number(w.w), hh = Number(w.h);
      if ([cx, cy, ww, hh].every(Number.isFinite)) out.insetWindow = { enabled: !!w.enabled, cx, cy, w: ww, h: hh };
    } else {
      // T82 item 5 MIGRATION: the OLD shape ({x1, y1, x2, y2}, board-local, origin top-left, y down) -> the
      // current one, using the board's CURRENT width/height (P, already imported above).
      const x1 = Number(w.x1), y1 = Number(w.y1), x2 = Number(w.x2), y2 = Number(w.y2);
      if ([x1, y1, x2, y2].every(Number.isFinite)) {
        const widthIn = Number(P.widthIn) || 0, heightIn = Number(P.heightIn) || 0;
        const loX = Math.min(x1, x2), hiX = Math.max(x1, x2), loY = Math.min(y1, y2), hiY = Math.max(y1, y2);
        out.insetWindow = {
          enabled: !!w.enabled,
          cx: (loX + hiX) / 2 - widthIn / 2, cy: heightIn / 2 - (loY + hiY) / 2,
          w: hiX - loX, h: hiY - loY,
        };
      }
    }
  }
  // F31 item 2c (Fred: "the side can sometimes be one piece"): a list of joint ids from this
  // template's own declared `regions.joinable` -- never geometry-clamped here (same convention as
  // insetWindow above), just filtered to ids the CURRENT template actually declares, so a stale id
  // left over from an old template swap (or a hand-edited save file) is silently dropped rather
  // than crashing the build.
  if (tpl && Array.isArray(raw.joinedMiters)) {
    const joinable = new Set((tpl.regions?.joinable || []).map((j) => j.id));
    out.joinedMiters = raw.joinedMiters.filter((id) => typeof id === 'string' && joinable.has(id));
  }
  return out;
}

/**
 * F9: what [Send frame] (S5) sends: the template, every frame-owned param's
 * effective value (defaults + overrides: the ONLY user parameters), the seeded
 * handle values as plain values under `seeds` (never a parameter), the frame
 * bottom and the wood.
 */
export function framePayload(defs, record) {
  const tpl = findFrameTemplate(defs, record?.templateId);
  if (!tpl) return null;
  const params = {};
  for (const p of tpl.params) if (p.owner === 'frame') params[p.name] = frameParam(defs, record, p.name);
  return { recordVersion: record.recordVersion, templateId: tpl.id, params, seeds: { ...(record.seeds || {}) },
    frameBottomZ: record.frameBottomZ, panelLip: record.panelLip ?? 0, appearance: record.appearance,
    insetWindow: { ...(record.insetWindow || defaultFrameRecord(defs).insetWindow) },
    joinedMiters: [...(record.joinedMiters || [])] };
}

/** F22: the panel lip's declared range for `record`: frame-defs `extrusion` panelLip {min, max}, where `max` names a
 *  frame param (the Trim offset). */
export function panelLipRange(defs, record) {
  const s = _extrusion(defs, 'panelLip');
  const bound = (v) => (typeof v === 'string' ? Number(frameParam(defs, record, v)) : Number(v));
  const min = Number.isFinite(bound(s.min)) ? bound(s.min) : 0;
  const max = Number.isFinite(bound(s.max)) ? bound(s.max) : Infinity;
  return { min, max: Math.max(min, max) };
}

/** A frame param's effective value: the record's override, else the template default. */
export function frameParam(defs, record, name) {
  if (record?.params && name in record.params) return record.params[name];
  const tpl = findFrameTemplate(defs, record?.templateId);
  const p = tpl?.params.find((q) => q.name === name);
  return p ? p.default : undefined;
}

/** The current record (normalized on read, so a stale session can't leak in). */
export function getFrameRecord() {
  return normalizeFrameRecord(P.frame);
}

/** The ONE write path: normalize, store on P, persist, mark the project dirty.
 *  A template change resets the seeds (F9: they belong to that template's shape). */
/** `opts.restored` (blind-spot audit B9): this write puts back an EARLIER record (the Frame tab's undo) --
 *  carried on the event, so what follows it (the brick re-lay) corrects the current step instead of adding one. */
export function setFrameRecord(patch, opts = {}) {
  const cur = getFrameRecord();
  // F31 item 2c: joint ids are template-specific (a different template's own `regions.joinable`
  // may not even have the same ids), so a template change resets them too, same reason seeds does.
  const reset = 'templateId' in patch && patch.templateId !== cur.templateId ? { seeds: {}, genSeed: null, joinedMiters: [] } : {};
  P.frame = normalizeFrameRecord({ ...cur, ...reset, ...patch });
  saveLastSession();
  markDirty();
  // turn 207 (Fred / 88): the bricks laid on this frame (Frame bands, and the Wall filling its interior) follow
  // it -- main/brick-panel.js re-lays them (sidebar) or marks them pending (editor)
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('frameRecordChanged', { detail: { templateChanged: 'templateId' in reset || ('templateId' in patch && patch.templateId !== cur.templateId), restored: !!opts.restored } }));
  }
  return P.frame;
}
