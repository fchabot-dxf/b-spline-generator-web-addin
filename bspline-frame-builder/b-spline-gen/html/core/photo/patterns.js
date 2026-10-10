/**
 * photo/patterns.js — F34 item 1: the built-in "pattern row" (Fred: a row of
 * thumbnails at the top of the Photo filter, plus "Load my own"). Each
 * pattern is declared as DATA (data/photo-patterns.json, read by
 * loadPhotoPatterns() at runtime) so "adding a pattern is data only, no
 * code change" -- Fred keeps adding photos, the advisor maintains the
 * collection via tools/add_photo_pattern.py, nothing here changes.
 *
 * A pattern's own `settings` is a FLAT, one-value-per-control object (the
 * shape Fred asked for directly: {crop, rotate, straighten, flip, levels,
 * brightness, contrast, blur, invert, depth, scale, offsetX, offsetY,
 * rotation, repeat, relief}) -- simple enough to hand-author or freeze from a
 * live-tuned session. `straighten` (degrees, free angle, +-45 range) is
 * separate from `rotate` (90deg steps) -- added when a 90deg-only rotate
 * turned out not to be enough to straighten a diagonal subject (a curved
 * brick edging shot at an angle) before cropping; declared edit order is
 * straighten, THEN crop, then everything else (advisor/Fred, same day).
 * `relief` (F34 item 3, inches, max 0.25) is the PHYSICAL carve depth
 * (P.carveZ) this pattern applies -- distinct from the `depth` tweak, which
 * is a unitless relief-strength multiplier, not a real-world dimension.
 * settingsToPhotoEdits()/settingsToTweaks()/settingsToRelief() expand it into
 * this app's own internal shapes (the ORDERED {op,params} list core/photo/
 * ops.js's applyPhotoEdits expects, the P.filterTweaks.photo object core/
 * noise/photo.js's own tweaks read, and P.carveZ) -- editsToSettings() is the
 * inverse, for "Save settings to this pattern". The two shapes serve
 * different audiences (a hand-authored/frozen preset vs. an undo-able live
 * edit history) and this is the one declared place that translates between
 * them in both directions.
 */

const PATTERNS_URL = 'data/photo-patterns.json';

/** A flat `settings` object (or undefined/partial) -> the ordered edit list
 * applyPhotoEdits() expects. A missing/null crop or levels means "no such
 * step at all" (not a no-op step at default values) -- a genuinely neutral
 * pattern round-trips to an EMPTY edit list, not a list of identity ops. */
export function settingsToPhotoEdits(settings) {
  const s = settings || {};
  const steps = [];
  if (s.straighten) steps.push({ op: 'straighten', params: { degrees: s.straighten } });
  if (s.crop) {
    const { x = 0, y = 0, w = 1, h = 1 } = s.crop;
    steps.push({ op: 'crop', params: { x, y, w, h } });
  }
  // Any number of 90deg turns, normalized to 0-3 individual rotate90 steps
  // (matching how the editor's own "rotate" button would have built the
  // same list one click at a time).
  const turns = ((Math.round((s.rotate || 0) / 90) % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) steps.push({ op: 'rotate90', params: { dir: 1 } });
  if (s.flip && s.flip.h) steps.push({ op: 'flip', params: { axis: 'h' } });
  if (s.flip && s.flip.v) steps.push({ op: 'flip', params: { axis: 'v' } });
  if (s.levels) {
    const { black = 0, white = 1, mid = 1 } = s.levels;
    steps.push({ op: 'levels', params: { black, white, mid } });
  }
  if (s.brightness || s.contrast) {
    steps.push({ op: 'brightnessContrast', params: { brightness: s.brightness || 0, contrast: s.contrast || 0 } });
  }
  if (s.blur) steps.push({ op: 'blur', params: { radius: s.blur } });
  if (s.invert) steps.push({ op: 'invert', params: {} });
  return steps;
}

// The filter's own effect-param tweak keys (core/noise/photo.js's own
// `tweaks` schema) -- declared once here so this converter can't drift from
// that schema silently; see the paired test (tests/photo-patterns.test.js)
// that cross-checks this list against the real schema.
export const TWEAK_KEYS = ['depth', 'scale', 'offsetX', 'offsetY', 'rotation', 'repeat'];

/** A flat `settings` object -> { [tweakKey]: value } for ONLY the keys it
 * actually sets (an empty object for a fully-neutral pattern, same "missing
 * means use the schema default" convention P.filterTweaks already uses). */
export function settingsToTweaks(settings) {
  const s = settings || {};
  const out = {};
  for (const key of TWEAK_KEYS) {
    if (s[key] !== undefined && s[key] !== null) out[key] = s[key];
  }
  return out;
}

// F34 item 3 (Fred: "height wouldn't ever be more than 1/4 for now"): the
// PHYSICAL carve depth (P.carveZ, inches) a photo relief uses -- separate
// from the 'depth' tweak above (a unitless relief-STRENGTH multiplier around
// mid-grey). Declared once here, in the one place that already owns a
// pattern's flat `settings` shape, so the UI (main/photo-panel.js) and the
// save-back action share the same bounds/default rather than each guessing.
export const DEFAULT_PHOTO_RELIEF_IN = 0.125;

/** A flat `settings` object -> the carveZ value (inches) to apply when this
 * pattern loads. Missing/invalid -> the declared default, same "absent means
 * default" convention as settingsToTweaks. 2026-10-10 (Fred): no 0.25 in photo
 * clamp -- carveZ is the board's own Z (Board > Carve Depth), its range the board's. */
export function settingsToRelief(settings) {
  const r = settings?.relief;
  return (typeof r === 'number' && r > 0) ? r : DEFAULT_PHOTO_RELIEF_IN;
}

/** The inverse of settingsToPhotoEdits()/settingsToTweaks(): collapses the
 * LIVE, ordered edit list + tweaks + relief back into the same flat
 * `settings` shape a pattern entry stores -- for "Save settings to this
 * pattern" (F34 item 3). A discrete op repeated by multiple clicks (rotate90,
 * flip) collapses to its NET effect (turns mod 4; flip parity), matching how
 * a user actually re-tunes a preset (undo + redo one step), not an arbitrary
 * click history; crop steps compose (a second crop is a fraction OF the
 * first crop's own output, exactly as applyPhotoEdits applies them in
 * sequence), so a user who nudges the crop twice still saves the ONE
 * equivalent region the flat schema expects. */
export function editsToSettings(photoEdits, tweaks, reliefIn) {
  const steps = photoEdits || [];
  const settings = {};

  const lastParams = (op) => {
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].op === op) return steps[i].params;
    return null;
  };

  const straighten = lastParams('straighten');
  if (straighten && straighten.degrees) settings.straighten = straighten.degrees;

  const crops = steps.filter((s) => s.op === 'crop').map((s) => s.params);
  if (crops.length) {
    let { x, y, w, h } = crops[0];
    for (let i = 1; i < crops.length; i++) {
      const c = crops[i];
      x = x + c.x * w;
      y = y + c.y * h;
      w = w * c.w;
      h = h * c.h;
    }
    settings.crop = { x, y, w, h };
  }

  const turns = ((steps.filter((s) => s.op === 'rotate90').reduce((n, s) => n + (s.params.dir || 1), 0) % 4) + 4) % 4;
  if (turns) settings.rotate = turns * 90;

  const flipH = steps.filter((s) => s.op === 'flip' && s.params.axis === 'h').length % 2 === 1;
  const flipV = steps.filter((s) => s.op === 'flip' && s.params.axis === 'v').length % 2 === 1;
  if (flipH || flipV) settings.flip = { h: flipH, v: flipV };

  const levels = lastParams('levels');
  if (levels) settings.levels = { black: levels.black ?? 0, white: levels.white ?? 1, mid: levels.mid ?? 1 };

  const bc = lastParams('brightnessContrast');
  if (bc && (bc.brightness || bc.contrast)) {
    settings.brightness = bc.brightness || 0;
    settings.contrast = bc.contrast || 0;
  }

  const blur = lastParams('blur');
  if (blur && blur.radius) settings.blur = blur.radius;

  if (steps.some((s) => s.op === 'invert')) settings.invert = true;

  for (const key of TWEAK_KEYS) {
    if (tweaks && tweaks[key] !== undefined) settings[key] = tweaks[key];
  }

  if (typeof reliefIn === 'number' && reliefIn > 0) settings.relief = reliefIn;

  return settings;
}

/** Fetch and parse data/photo-patterns.json. Returns [] (never throws) if
 * the file is missing or malformed -- a pattern row with nothing in it is a
 * legitimate, recoverable state ("Load my own" still works), not a crash. */
export async function loadPhotoPatterns(url = PATTERNS_URL) {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('loadPhotoPatterns failed:', e);
    return [];
  }
}
