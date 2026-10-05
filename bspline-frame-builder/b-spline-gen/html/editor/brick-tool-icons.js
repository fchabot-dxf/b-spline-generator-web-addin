/**
 * editor/brick-tool-icons.js -- F35 item 24 (Fred: "please make better icons"; "icons should still have a brush
 * on it if it's one"; they should "mimic the 2D part on the model"). One consistent monochrome icon per Brick
 * tool, in the editor's own line style (a 24-unit box, round 2-unit strokes, currentColor -- so the idle /
 * active colours come from the button). Each icon = the tool's hand-drawn GLYPH (its metaphor) + a MINIATURE of
 * what the tool leaves on the board, laid by the real engine (editor-brick-tool.js toolMiniBricks), so it
 * matches reality. Declared per tool id (main/brick-panel.js BRICK_TOOLS).
 *
 *   mini: { kind, box: [x, y, w, h] in the 24 box, cut?: a gap where the blades close, stripe?: alternate
 *           runs hollow, lifted?: a shadow line under the run (raised), depth?: how a RAISED run shows its
 *           height (Fred on sheet 1: "needs a bit more perspective") -- RAISED_DEPTHS below,
 *           raise?: 'last' | 'middle' -- that ONE brick of the run sits higher, its side face showing
 *           (sheet v3), lift?: how much higher, in 24-box units, yScale?: a ONE-row run is 8:1 and reads
 *           as a line at 20 px -- its height is drawn this many times thicker (the engine still lays it) }
 */
import { toolMiniBricks } from './editor-brick-tool.js';

const PAINTBRUSH = '<path d="M21.5 2.5 15 9"/><path d="M15 9 12.8 11.2" stroke-width="3.6"/>'
  + '<path d="M12.8 11.2c-2.2 0-3.5 1.3-3.8 3.8 2.5-.3 3.8-1.6 3.8-3.8z" fill="currentColor" stroke-width="1"/>';
const UP_TICK = '<path d="M20.5 22v-6.5M18 18l2.5-2.5L23 18"/>';
const SCISSORS = '<circle cx="4.6" cy="4.2" r="2.3"/><circle cx="4.6" cy="11.3" r="2.3"/><path d="M6.6 5.4 20 10.4M6.6 10.1 20 5.2"/>';

/** The raised run's depth treatments (sheet v2: Fred picks one). dx/dy = the oblique offset (24-box units). */
export const RAISED_DEPTHS = Object.freeze({
  extrude: { label: 'Extruded: each brick a block (an offset copy behind it)', dx: 1.6, dy: 2.4 },
  shadow: { label: 'Hovering: a shadow band under the run, stems at the ends', dx: 1.4, dy: 3.4 },
  sides: { label: 'Side faces: each brick on its own visible side', dx: 0, dy: 2.4 },
});

/** Sheet v3 (Fred: "a 2-brick long run with one brick higher"; "2 or 3; with 3, the middle one raised"): the
 *  Raised brush candidates -- the paintbrush, no arrow, a one-row run with ONE brick lifted. Fred picks one; it
 *  then becomes BRICK_TOOL_ICONS.raisedBrush. */
export const RAISED_V3 = Object.freeze({
  twoBricks: { label: '2 bricks, the second one raised', glyph: PAINTBRUSH, mini: { kind: 'row2', box: [1, 16.5, 21, 6], raise: 'last', lift: 2.6, yScale: 1.8, lifted: false } },
  threeBricks: { label: '3 bricks, the middle one raised', glyph: PAINTBRUSH, mini: { kind: 'row3', box: [0.5, 16.5, 23, 6], raise: 'middle', lift: 2.6, yScale: 1.8, lifted: false } },
});

export const BRICK_TOOL_ICONS = Object.freeze({
  brush: { glyph: PAINTBRUSH, mini: { kind: 'run', box: [1, 14.5, 13, 7.5] } },
  raisedBrush: { glyph: PAINTBRUSH + UP_TICK, mini: { kind: 'run', box: [0.5, 12.5, 15, 6.5], lifted: true } },
  wall: { glyph: '', mini: { kind: 'wall', box: [1.5, 4, 21, 16] } },
  frame: { glyph: '', mini: { kind: 'frame', box: [3, 3, 18, 18] } },
  scissors: { glyph: SCISSORS, mini: { kind: 'runLong', box: [1, 15.5, 22, 7], cut: [0.4, 0.6] } },
  stripe: { glyph: '', mini: { kind: 'band3', box: [1, 4, 22, 16], stripe: 3 } },
});

const _centroidX = (b) => b.polygon.reduce((s, p) => s + p.x, 0) / b.polygon.length;

/** The miniature as SVG markup inside its box (aspect kept, centred). */
function miniMarkup(mini) {
  const bricks = toolMiniBricks(mini.kind);
  if (!bricks.length) return '';
  const xs = bricks.flatMap((b) => b.polygon.map((p) => p.x)), ys = bricks.flatMap((b) => b.polygon.map((p) => p.y));
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
  const [bx, by, bw, bh] = mini.box;
  const sy = mini.yScale || 1;
  const k = Math.min(bw / w, bh / (h * sy));
  const ox = bx + (bw - w * k) / 2, oy = by + (bh - h * k * sy) / 2;
  const pt = (p) => `${+(ox + (p.x - x0) * k).toFixed(2)},${+(oy + (p.y - y0) * k * sy).toFixed(2)}`;
  const parts = [];
  const depth = mini.depth && RAISED_DEPTHS[mini.depth];
  if (depth) parts.push(depthMarkup(mini.depth, depth, bricks, pt, k, { ox, oy, x0, y0, w, h }));
  // sheet v3: ONE brick of the run lifted by `lift` (box units), with its side face filling the step below it
  let raised = null;
  if (mini.raise) {
    const byX = [...bricks].sort((a, b) => _centroidX(a) - _centroidX(b));
    raised = mini.raise === 'middle' ? byX[Math.floor(byX.length / 2)] : byX[byX.length - 1];
  }
  for (const b of bricks) {
    if (b === raised) {
      const xs = b.polygon.map((p) => p.x), ys = b.polygon.map((p) => p.y);
      const a = pt({ x: Math.min(...xs), y: Math.max(...ys) }).split(',').map(Number);
      const c = pt({ x: Math.max(...xs), y: Math.max(...ys) }).split(',').map(Number);
      const up = b.polygon.map((p) => pt(p).split(',').map(Number)).map(([x, y]) => `${x},${+(y - mini.lift).toFixed(2)}`).join(' ');
      parts.push(`<rect x="${a[0]}" y="${+(a[1] - mini.lift).toFixed(2)}" width="${+(c[0] - a[0]).toFixed(2)}" height="${mini.lift}" fill="currentColor" stroke="none" opacity="0.45"/>`);
      parts.push(`<polygon points="${up}" fill="currentColor" stroke="none"/>`);
      continue;
    }
    const u = (_centroidX(b) - x0) / w; // 0..1 along the miniature
    if (mini.cut && u > mini.cut[0] && u < mini.cut[1]) continue; // the scissors' gap
    const hollow = mini.stripe && Math.floor(u * mini.stripe) % 2 === 1;
    const points = b.polygon.map(pt).join(' ');
    parts.push(hollow
      ? `<polygon points="${points}" fill="none" stroke-width="1"/>`
      : `<polygon points="${points}" fill="currentColor" stroke="none"/>`);
  }
  if (mini.lifted) parts.push(`<path d="M${bx} ${+(by + bh + 1.8).toFixed(2)}h${bw}" stroke-width="1.2" stroke-dasharray="1.6 1.2"/>`);
  return parts.join('');
}

/** What sits UNDER a raised run, per RAISED_DEPTHS treatment (drawn before the bricks themselves). */
function depthMarkup(id, d, bricks, pt, k, f) {
  const shifted = (b, dx, dy) => b.polygon.map((p) => pt({ x: p.x + dx / k, y: p.y + dy / k })).join(' ');
  if (id === 'extrude') {
    return `<g fill="currentColor" stroke="none" opacity="0.4">${bricks.map((b) => `<polygon points="${shifted(b, d.dx, d.dy)}"/>`).join('')}</g>`;
  }
  if (id === 'shadow') {
    const left = f.ox, right = f.ox + f.w * k, bottom = f.oy + f.h * k;
    return `<rect x="${+(left + d.dx).toFixed(2)}" y="${+(bottom + d.dy - 1).toFixed(2)}" width="${+(right - left).toFixed(2)}" height="1.4" rx="0.7" fill="currentColor" stroke="none" opacity="0.4"/>`
      + `<path d="M${+left.toFixed(2)} ${+bottom.toFixed(2)}l${d.dx} ${+(d.dy - 1).toFixed(2)}M${+right.toFixed(2)} ${+bottom.toFixed(2)}l${d.dx} ${+(d.dy - 1).toFixed(2)}" stroke-width="0.8"/>`;
  }
  // 'sides': each brick's side face -- the strip from its bottom edge down by dy
  return `<g fill="currentColor" stroke="none" opacity="0.55">${bricks.map((b) => {
    const ys = b.polygon.map((p) => p.y), xs = b.polygon.map((p) => p.x);
    const yb = Math.max(...ys), xl = Math.min(...xs), xr = Math.max(...xs);
    const a = pt({ x: xl, y: yb }).split(',').map(Number), c = pt({ x: xr, y: yb }).split(',').map(Number);
    return `<rect x="${a[0]}" y="${a[1]}" width="${+(c[0] - a[0]).toFixed(2)}" height="${d.dy}"/>`;
  }).join('')}</g>`;
}

/** The tool's icon as SVG markup at `sizePx`; null for a tool without one. `override` (the sheets' variants
 *  only): { glyph?, mini? } -- `mini` merges into the tool's declared miniature, `glyph` replaces its glyph. */
export function brickToolIconSvg(toolId, sizePx = 20, override = null) {
  const base = BRICK_TOOL_ICONS[toolId];
  if (!base) return null;
  const icon = override ? { glyph: override.glyph ?? base.glyph, mini: { ...base.mini, ...(override.mini || {}) } } : base;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" aria-hidden="true"`
    + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + `${icon.glyph}${miniMarkup(icon.mini)}</svg>`;
}
