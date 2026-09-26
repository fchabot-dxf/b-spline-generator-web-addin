/**
 * editor-frame-profile.js — FB-APP S2 (F6), design §3.0 headline: with a
 * frame chosen, the editor's board IS the frame's cut profile (what the
 * frame's SURROUND trim leaves); outside it is shaded as cut away. Artwork is
 * never touched: the profile is drawn in the editor's BACKGROUND layer, which
 * sits under the grid and the artwork and is never exported.
 *
 * One outline source: the generated frame definition (the same Python the
 * Fusion build runs, via data/frame-defs.js) supplies the template's app
 * preset + declared shape params + boundingboxoffset; the SAME silhouette
 * engine the Shape Lattice uses solves it (no second copy of the math), and
 * the F5 outline guard must pass before anything is drawn.
 */
import { generateSilhouette, outlineDefects, primitivesToPathD } from './editor-shape-lattice-generator.js';

export const FRAME_PROFILE_GROUP_ID = 'frame-profile';

/** The declared fit rule (frame-defs `fit`, frame_definition.FRAME_FIT in
 *  Python): 2*frame_thickness < min(W, H) - 2*boundingboxoffset. */
export function frameFit(widthIn, heightIn, frameThickness, bboxOffset) {
  const safe = Math.min(widthIn, heightIn) - 2 * bboxOffset;
  const need = 2 * frameThickness;
  return { ok: need < safe, safeZoneIn: safe, requiredIn: need };
}

const _param = (tpl, record, name) => {
  if (record?.params && name in record.params) return record.params[name];
  return tpl.params.find((p) => p.name === name)?.default;
};

/**
 * Pure: frame definition + record + board size (inches) -> the cut profile,
 * or null when there is no frame. Board coordinates are the editor's own
 * (origin top-left, y down, inches).
 */
export function frameCutProfile(defs, record, { widthIn, heightIn }) {
  if (!record || !record.templateId) return null;
  const tpl = (defs.templates || []).find((t) => t.id === record.templateId);
  if (!tpl) return null;
  const bbo = _param(tpl, record, 'boundingboxoffset') ?? 0;
  const ft = _param(tpl, record, 'frame_thickness') ?? 0;
  const region = { x: bbo, y: bbo, w: widthIn - 2 * bbo, h: heightIn - 2 * bbo };
  const sil = generateSilhouette(region, { preset: tpl.silhouettePreset, params: tpl.shapeParams || {} });
  const defects = outlineDefects(sil.primitives);
  return {
    templateId: tpl.id, name: tpl.name, region, primitives: sil.primitives,
    pathD: primitivesToPathD(sil.primitives), defects, fit: frameFit(widthIn, heightIn, ft, bbo),
  };
}

let _provider = null;
/** `fn() -> { defs, record }`, registered by the app (main/frame-panel.js),
 *  so this editor module never imports app state directly. */
export function setFrameProfileProvider(fn) { _provider = fn; }

/**
 * (Re)draw the cut profile into `editor._bgLayer`. Called at the end of
 * sync3DBackground (which clears that layer) and whenever the frame record
 * changes. A profile that fails the outline guard is NOT drawn.
 */
export function drawFrameProfile(editor) {
  if (!editor || !editor._bgLayer) return null;
  const old = editor._bgLayer.findOne ? editor._bgLayer.findOne('#' + FRAME_PROFILE_GROUP_ID) : null;
  if (old) old.remove();
  const spec = _provider ? _provider() : null;
  const prof = spec ? frameCutProfile(spec.defs, spec.record, { widthIn: editor._mW, heightIn: editor._mH }) : null;
  editor._frameProfile = prof;
  if (!prof || prof.defects.length) return prof;
  const W = editor._mW, H = editor._mH;
  const g = editor._bgLayer.group().id(FRAME_PROFILE_GROUP_ID).attr('pointer-events', 'none');
  // Everything outside the profile is cut away: board rect minus the outline (even-odd).
  g.path(`M0 0 H${W} V${H} H0 Z ${prof.pathD}`)
    .fill({ color: '#1f2933', opacity: 0.6 }).attr('fill-rule', 'evenodd').addClass('frame-cutaway');
  g.path(prof.pathD).fill('none').stroke({ color: '#2e7d32', width: 0.04 }).addClass('frame-cut-profile');
  return prof;
}
