/**
 * editor/brick-surface-styles.js — F35 item 18 (2): the brick SURFACE STYLE, Clean | Weathered,
 * declared as data. A style never changes the 2D layout, only how the height mask
 * (editor-brick-height-mask.js) reads each brick, so it is a 3D-only setting
 * (P.brickSettings.surfaceStyle, main/brick-panel.js SURFACE_ONLY_SETTING_KEYS).
 *
 * Clean declares nothing: it is exactly the set's own look (core/bricks/library.js heightProfile),
 * byte-identical to before this existed. Weathered (Fred: worn noisy edges, per-brick top jitter,
 * pitted contrast, deep dark joints) is overrides on top of the set's own declaration:
 *  - profileScale: multipliers on the set's own heightProfile fields (so a set with a bigger or
 *    smaller declared profile keeps its own proportions) -- wider worn shoulders, a flatter crown,
 *    many more and bigger chips, a bigger share of the photo surface;
 *  - profileSet: absolute heightProfile fields (edgeNoiseIn/edgeNoiseScaleIn: the shoulder's
 *    distance-to-edge perturbed by noise = ragged worn edges; read by core/bricks/height-profile.js,
 *    inert where the engine does not read them);
 *  - pitGain: the photo detail's NEGATIVE half (pits, cracks) amplified, the positive half kept;
 *  - topJitterIn: an extra seeded per-brick top offset (+/-), on top of the layout's own jitter;
 *  - jointDepthIn: joints recessed this far below the ground (deep joints read dark in the shading).
 * Values are inches like every other brick field, declared, not measured; tuned on 3D close-ups.
 */
import { mulberry32, seedFor } from '../core/bricks/index.js';

export const BRICK_SURFACE_STYLES = Object.freeze({
  clean: Object.freeze({ id: 'clean', label: 'Clean', title: 'The brick set as declared: crisp edges, light chips, flush joints' }),
  weathered: Object.freeze({
    id: 'weathered',
    label: 'Weathered',
    title: 'Worn ragged edges, uneven tops, pitted faces, deep joints',
    profileScale: Object.freeze({ edgeRadiusIn: 1.8, crown: 0.5, chipRate: 5, chipSizeIn: 1.8, surfaceShare: 2.5 }),
    profileSet: Object.freeze({ edgeNoiseIn: 0.015, edgeNoiseScaleIn: 0.06 }),
    pitGain: 1.8,
    topJitterIn: 0.012,
    jointDepthIn: 0.03,
  }),
});

export const DEFAULT_SURFACE_STYLE = 'clean';

/** The declared style for an id; anything unknown (or a saved session without the key) is Clean. */
export function surfaceStyleById(id) {
  return BRICK_SURFACE_STYLES[id] || BRICK_SURFACE_STYLES[DEFAULT_SURFACE_STYLE];
}

// fractions of the relief budget, never above 1 (height-profile.js clamps surfaceShare too)
const UNIT_FIELDS = ['chipRate', 'surfaceShare'];

/** `set` with the style's heightProfile overrides applied (a copy; the library set is frozen).
 *  A style with no overrides returns `set` itself. */
export function styledSet(set, style) {
  if (!style || (!style.profileScale && !style.profileSet)) return set;
  const hp = { ...(set.heightProfile || {}) };
  for (const [k, f] of Object.entries(style.profileScale || {})) {
    if (typeof hp[k] !== 'number') continue;
    hp[k] *= f;
    if (UNIT_FIELDS.includes(k)) hp[k] = Math.min(1, hp[k]);
  }
  Object.assign(hp, style.profileSet || {});
  return { ...set, heightProfile: hp };
}

/** The adapter's photo-detail callback with the style's pit contrast (negative half x pitGain). */
export function styledDetail(sampleDetailAt, style) {
  const gain = style && style.pitGain;
  if (!sampleDetailAt || !(gain > 0) || gain === 1) return sampleDetailAt;
  return (x, y, brick) => {
    const d = sampleDetailAt(x, y, brick);
    return d < 0 ? d * gain : d;
  };
}

function hashId(id) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/** The style's extra top offset for one brick (inches, +/- topJitterIn), seeded by (seed, brick id)
 *  so a re-mask gives every brick the same offset again. 0 for a style without it. */
export function styleTopJitter(style, seed, brickId) {
  const amp = style && style.topJitterIn;
  if (!(amp > 0)) return 0;
  return (mulberry32(seedFor(seed, 'weather-top', hashId(brickId)))() * 2 - 1) * amp;
}
