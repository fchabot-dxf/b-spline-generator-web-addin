/**
 * Flat mirror line for filters whose pattern isn't symmetric by itself.
 *
 * terrain.js folds the surface before calling a filter (Mirror X is the
 * default): su arrives as distance from the centre line. A pattern that
 * doesn't happen to be flat across su = 0 then meets its mirror image at an
 * angle -- a crease down the middle of the board.
 *
 * mirrorSeam(sample, su, band) blends the filter with its own reflection
 * inside a narrow band at the centre: at su = 0 the two are weighted 50/50,
 * so the slope across the line is exactly zero; from su = band outward it
 * is the filter's own value, untouched.
 *   sample(s): the filter evaluated at folded coordinate s (called with -su)
 */
function smoothstep01(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function mirrorSeam(sample, su, band) {
  const own = sample(su);
  if (su >= band) return own;
  const w = 0.5 * (1 - smoothstep01(0, band, su));
  return own * (1 - w) + sample(-su) * w;
}
