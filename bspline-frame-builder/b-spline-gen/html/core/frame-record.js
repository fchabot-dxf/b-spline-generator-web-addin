/**
 * frame-record.js — FB-APP S2 (F6): the persisted FRAME RECORD (design §3.2).
 *
 * One declared record, saved and loaded with the project as `P.frame`:
 *   { recordVersion, templateId (null = no frame), params, frameBottomZ, appearance }
 * Only overrides live in `params`; every default comes from the generated
 * frame definition (data/frame-defs.js, built from the frame builder's own
 * Python by tools/gen_frame_defs.py), so a regenerated definition never needs
 * a migration of saved projects.
 *
 * `normalizeFrameRecord` is the ONE gate every write and every load goes
 * through: a project saved before frames existed (no `frame` key), an unknown
 * template, a wood that isn't declared, or a non-numeric value all resolve to
 * the declared defaults — never a half-valid record.
 */
import FRAME_DEFS from '../data/frame-defs.js';
import { P, saveLastSession } from './state.js';
import { markDirty } from './dirty.js';

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
    frameBottomZ: _extrusion(defs, 'frameBottomZ').default ?? -1,
    appearance: defs.appearance?.default ?? null,
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
  if ((defs.appearance?.options || []).includes(raw.appearance)) out.appearance = raw.appearance;
  if (tpl && raw.params && typeof raw.params === 'object') {
    const declared = new Set(tpl.params.filter((p) => p.owner === 'frame').map((p) => p.name));
    for (const [k, v] of Object.entries(raw.params)) {
      const n = Number(v);
      if (declared.has(k) && Number.isFinite(n)) out.params[k] = n;
    }
  }
  return out;
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

/** The ONE write path: normalize, store on P, persist, mark the project dirty. */
export function setFrameRecord(patch) {
  P.frame = normalizeFrameRecord({ ...getFrameRecord(), ...patch });
  saveLastSession();
  markDirty();
  return P.frame;
}
