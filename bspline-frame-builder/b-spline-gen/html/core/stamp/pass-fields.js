/**
 * core/stamp/pass-fields.js -- the per-layer stamp fields the layer stack's card rows added where a type had none (Fred
 * 2026-11-27; main/layer-stack.js LAYER_CARD_ROWS). Each is STORED only once set (absent = the layer exactly as before,
 * AGENTS.md rule 3) and copied onto the layer's pass by its builder; core/engine/apply-stamp-layers.js reads the pass.
 *
 *   zOffset      art + bricks (an editor layer's `zOffset`; P.brickSettings.zOffset): inches, the SAME meaning the STL /
 *                height records' own Z offset has -- (carve ? -1 : 1) * zOffset over the layer's covered points (a Flat
 *                brick: on top of its plane). The STL's is its position.z, the height patch's its record zOffset.
 *   suppression  STL + height records (`suppression`, 0..1, "Ground under it"): the terrain under the layer pulled toward its
 *                smoothed copy, through the one suppression step every pass already has; smoothed over GROUND_SMOOTHING_CELLS
 *                (a Draw layer's default Smoothing radius). Art and bricks have theirs already (layer.suppression).
 *   softness     height records + bricks (`softness`, inches; P.brickSettings.softness): the footprint blurred by
 *                core/stamp/soften.js softenBody -- the STL's own edge softness (rec.softness), shared.
 * The strength (core/stamp/strength.js) scales a layer's height and its suppression; never its zOffset.
 */
import { strengthOf } from './strength.js';

/** The smoothing radius (grid cells) a record's "Ground under it" smooths over: a Draw layer's default Smoothing radius
 *  (editor/layers.js TOOLING_DEFAULTS.smoothing; tests/layer-card-rows.test.js keeps the two equal). */
export const GROUND_SMOOTHING_CELLS = 15;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
/** The pass fields for a stored own Z offset: `{}` when absent / 0 (the pass exactly as before), else { zOffset }. */
export const zOffsetOf = (stored) => (finite(stored) && stored !== 0 ? { zOffset: stored } : {});
/** A record pass's suppression fields: `{ suppression: 0, smoothing: 0 }` when absent (today's record pass), else the stored
 *  amount over GROUND_SMOOTHING_CELLS. */
export const recordGroundOf = (stored) => (finite(stored) && stored > 0 ? { suppression: stored, smoothing: GROUND_SMOOTHING_CELLS } : { suppression: 0, smoothing: 0 });

/** The brick passes' own fields, read off P.brickSettings by main/stamp-mask-manager.js with the brick depth (the heights
 *  stage never reads P.brickSettings: rebuild.js HEIGHTS_INERT_KEYS) and kept on the layer as `_brickPassFields`. Only the
 *  stored ones: an untouched board's bricks carry `{}`. */
export const brickPassFieldsOf = (bs) => (bs ? { ...strengthOf(bs.strength), ...zOffsetOf(bs.zOffset) } : {});
