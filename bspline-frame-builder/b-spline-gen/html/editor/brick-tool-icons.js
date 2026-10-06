/**
 * editor/brick-tool-icons.js -- F35 item 24 (Fred: "please make better icons"; "icons should still have a brush
 * on it if it's one"; they should "mimic the 2D part on the model"). One consistent monochrome icon per Brick
 * tool, in the editor's own line style (a 24-unit box, round 2-unit strokes, currentColor -- so the idle /
 * active colours come from the button). Each icon = the tool's hand-drawn GLYPH (its metaphor) + a MINIATURE of
 * what the tool leaves on the board, laid by the real engine (editor-brick-tool.js toolMiniBricks), so it
 * matches reality. Declared per tool id (main/brick-panel.js BRICK_TOOLS).
 *
 *   mini: { kind, box: [x, y, w, h] in the 24 box, cut?: a gap where the blades close, stripe?: alternate
 *           runs hollow, raise?: 'last' | 'middle' -- that ONE brick of the run sits higher, its side face
 *           showing, lift?: how much higher, in 24-box units, yScale?: a ONE-row run is 8:1 and reads as a line
 *           at 20 px -- its height is drawn this many times thicker (the engine still lays it) }
 *
 * Step 2 (Fred's picks): wired -- main/brick-panel.js BRICK_TOOLS declares `iconSvg` from here, and the editor's
 * tool registry renders it. The Raised brush = sheet v3's 3-brick run with the MIDDLE brick raised; the sheets'
 * other candidates (the v2 depth treatments, the v3 2-brick run, the old up-arrow) are gone with the sheets.
 */
import { toolMiniBricks } from './editor-brick-tool.js';

const PAINTBRUSH = '<path d="M21.5 2.5 15 9"/><path d="M15 9 12.8 11.2" stroke-width="3.6"/>'
  + '<path d="M12.8 11.2c-2.2 0-3.5 1.3-3.8 3.8 2.5-.3 3.8-1.6 3.8-3.8z" fill="currentColor" stroke-width="1"/>';
const SCISSORS = '<circle cx="4.6" cy="4.2" r="2.3"/><circle cx="4.6" cy="11.3" r="2.3"/><path d="M6.6 5.4 20 10.4M6.6 10.1 20 5.2"/>';

export const BRICK_TOOL_ICONS = Object.freeze({
  brush: { glyph: PAINTBRUSH, mini: { kind: 'run', box: [1, 14.5, 13, 7.5] } },
  // Fred's pick (sheet v3): a 3-brick run, the MIDDLE brick raised, its side face showing; the paintbrush, no arrow
  raisedBrush: { glyph: PAINTBRUSH, mini: { kind: 'row3', box: [0.5, 16.5, 23, 6], raise: 'middle', lift: 2.6, yScale: 1.8 } },
  wall: { glyph: '', mini: { kind: 'wall', box: [1.5, 4, 21, 16] } },
  frame: { glyph: '', mini: { kind: 'frame', box: [3, 3, 18, 18] } },
  scissors: { glyph: SCISSORS, mini: { kind: 'runLong', box: [1, 15.5, 22, 7], cut: [0.4, 0.6] } },
  stripe: { glyph: '', mini: { kind: 'band3', box: [1, 4, 22, 16], stripe: 3 } },
  // F35 item 43: the General tab (the board-wide settings) -- three sliders, no miniature
  general: { glyph: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/>'
    + '<circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="7" cy="18" r="2" fill="currentColor"/>' },
});

const _centroidX = (b) => b.polygon.reduce((s, p) => s + p.x, 0) / b.polygon.length;

/** The miniature as SVG markup inside its box (aspect kept, centred). */
function miniMarkup(mini) {
  if (!mini) return ''; // a glyph-only icon (General)
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
  // ONE brick of the run lifted by `lift` (box units), with its side face filling the step below it
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
  return parts.join('');
}

/** The tool's icon as SVG markup at `sizePx`; null for a tool without one. */
export function brickToolIconSvg(toolId, sizePx = 20) {
  const icon = BRICK_TOOL_ICONS[toolId];
  if (!icon) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" aria-hidden="true"`
    + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + `${icon.glyph}${miniMarkup(icon.mini)}</svg>`;
}
