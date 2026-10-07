/**
 * core/bricks/inset-surround.js — PORTABLE (see rng.js). T86 item 29: an inset window's brick SURROUND -- a band stack
 * laid around the window's outer rect, through the existing ribbon path (contour-bands.js bricksContourBands), so its
 * joints follow the frame rules (always a mitre unless the record's `corner` says otherwise).
 *
 * The ribbon path lays a stack INWARD from a closed contour (a sign flip to lay outward from the hole gives no pieces:
 * the ribbon construction assumes inward -- measured). So the stack is laid inward from the window rect GROWN by the
 * stack's depth; the depth is MEASURED from a first lay's own innerPath (planBands snaps each band to whole rows, and the
 * joints add to it), then the stack is laid at that depth. The path keeps one joint (the set's grout width) between its
 * innermost row and what lies inside (normally the wall); inside a surround lies the OPENING, so the stack is laid around
 * the window rect shrunk by that joint: its pieces sit on the window's edge (measured: 0.034 in short without it).
 */
import { bricksContourBands } from './contour-bands.js';
import { FRAME_PRESETS, scaledSet } from './library.js';

/** The corner treatments a surround record may declare (contour-bands' band cornerStyle); 'mitre' is the default. */
export const SURROUND_CORNERS = Object.freeze(['mitre', 'butt', 'lapped', 'block']);

const rectPolygon = (r) => [{ x: r.x1, y: r.y1 }, { x: r.x2, y: r.y1 }, { x: r.x2, y: r.y2 }, { x: r.x1, y: r.y2 }];
const linesOf = (poly) => poly.map((p, i) => ({ type: 'line', p0: p, p1: poly[(i + 1) % poly.length] }));
const grow = (r, d) => ({ x1: r.x1 - d, y1: r.y1 - d, x2: r.x2 + d, y2: r.y2 + d });

/**
 * @param {{rect:{x1:number,y1:number,x2:number,y2:number}, preset:string, corner?:string, set?:object}} spec — the
 *   window's OUTER rect (board inches, y down), a FRAME_PRESETS id, the corner treatment, an optional set override
 * @param {{set:object, seed:number, scale?:number}} opts — the frame's set (already resolved by the caller), seed, scale
 * @returns {{bricks:Array, outer:Array, depthIn:number}|null} null for an unknown / empty preset or an invalid rect
 */
export function laySurround(spec, opts) {
  const r = spec && spec.rect;
  const presetBands = spec && FRAME_PRESETS[spec.preset];
  if (!r || !(r.x2 > r.x1) || !(r.y2 > r.y1) || !presetBands || !presetBands.length) return null;
  const corner = SURROUND_CORNERS.includes(spec.corner) ? spec.corner : 'mitre';
  const bands = presetBands.map((b) => ({ ...b, cornerStyle: corner }));
  const layOpts = { set: spec.set || opts.set, seed: opts.seed, scale: opts.scale, bandFit: false };
  const base = grow(r, -scaledSet(layOpts.set, opts.scale).grout.widthIn); // the path's inner joint falls inside the opening
  const lay = (d) => bricksContourBands(linesOf(rectPolygon(grow(base, d))), bands, layOpts);
  // a first lay deep enough for any stack: its innerPath is the grown rect shrunk by the stack's real depth
  const d0 = 2 * bands.reduce((s, b) => s + b.widthIn, 0) * Math.max(1, opts.scale || 1) + 1;
  const first = lay(d0);
  const xs = first.innerPath.map((p) => p.x), ys = first.innerPath.map((p) => p.y);
  const depthIn = Math.min(Math.min(...xs) - (base.x1 - d0), Math.min(...ys) - (base.y1 - d0));
  if (!(depthIn > 0)) return null;
  const res = lay(depthIn);
  return { bricks: res.bricks, outer: rectPolygon(grow(base, depthIn)), depthIn };
}
