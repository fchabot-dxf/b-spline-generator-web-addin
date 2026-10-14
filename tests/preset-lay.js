/**
 * A frame preset laid the way the APP lays it (editor/editor-brick-tool.js _layInput): its bands, plus the arch the
 * preset carries (core/bricks/library.js withArch, a non-enumerable `arch` on the band list). Seat A 2026-10-11: the
 * sweeps that walk every preset laid arch_keystone from its (empty) band list alone -- no arch, so the 'none' lay -- and
 * counted only frameBricks while the engine returns the arch's pieces in archBricks (the editor merges them).
 */
import { FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

/** generateBricks' frame inputs for `preset` on `primitives`: { frame } and, when the preset carries one, { arch }. */
export function presetFrameInput(primitives, preset) {
  const bands = FRAME_PRESETS[preset];
  return { frame: { primitives, bands }, ...(bands.arch ? { arch: { spec: bands.arch } } : {}) };
}

/** Every frame piece of a lay: the bands' and the arch's. */
export const framePiecesOf = (r) => [...r.frameBricks, ...(r.archBricks || [])];
