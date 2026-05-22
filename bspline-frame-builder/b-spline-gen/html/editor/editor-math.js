/**
 * 2D vector primitives used by the editor's curve fitting and stroke
 * expansion code. Operates on plain `{x, y}` objects so it composes with
 * SVG.js's Point shape and our own ad-hoc points without ceremony.
 */

export function add(a, b)        { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a, b)        { return { x: a.x - b.x, y: a.y - b.y }; }
export function mul(a, s)        { return { x: a.x * s,   y: a.y * s }; }
export function dot(a, b)        { return a.x * b.x + a.y * b.y; }
export function distSq(a, b)     { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }
export function distBetween(a, b) { return Math.sqrt(distSq(a, b)); }

export function normalize(v) {
  const l = Math.sqrt(v.x * v.x + v.y * v.y);
  return l > 0 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
}
