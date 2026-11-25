/**
 * core/flatten-band-outline.js -- the FLATTEN BAND's loop (core/flatten-band.js): the wood frame's OUTLINE, read from the one
 * outline source every frame consumer reads (editor/editor-frame-profile.js frameCutProfile: the template's outer cut
 * profile, the same primitives the 3D trim, the 2D profile and the Fusion build use), or the board rectangle when the board
 * has no frame (or its outline fails the frame guard: nothing is trimmed then either). Kept apart from core/flatten-band.js
 * so the heightmap's own module closure stays free of the frame code.
 *
 * The callers that build a heightmap (core/engine/rebuild.js buildHeights, core/render-topview.js) hand the result to
 * generateHeightmap as params.bandOutline; the heights cache's digest (rebuild.js heightsInputDigest) carries
 * bandOutlineDigest, so the frame -- otherwise not a heights input -- reaches the heights only while the band is on.
 */
import FRAME_DEFS from '../data/frame-defs.js';
import { normalizeFrameRecord } from './frame-record.js';
import { frameCutProfile } from '../editor/editor-frame-profile.js';
import { rectOutline } from './flatten-band.js';

let _memo = null; // { key, outline }
/** The band's outline primitives (board inches, editor frame) for board params `p`, or null while the band is off. */
export function bandOutlineOf(p) {
  if (!p || p.bandEnabled !== true) return null;
  const W = Number(p.widthIn), H = Number(p.heightIn);
  if (!(W > 0) || !(H > 0)) return null;
  const key = JSON.stringify([p.frame ?? null, W, H]);
  if (_memo && _memo.key === key) return _memo.outline;
  const rec = normalizeFrameRecord(p.frame);
  const prof = rec && rec.templateId ? frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H }) : null;
  const outline = prof && !prof.defects.length && prof.primitives.length ? prof.primitives : rectOutline(W, H);
  _memo = { key, outline };
  return outline;
}

/** The heights cache's term for the band's loop: '-' while the band is off (the frame is then no heights input at all). */
export function bandOutlineDigest(p) {
  const o = bandOutlineOf(p);
  return o ? JSON.stringify(o) : '-';
}
