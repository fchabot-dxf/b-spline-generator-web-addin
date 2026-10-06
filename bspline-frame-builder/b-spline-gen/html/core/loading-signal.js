/**
 * core/loading-signal.js — the app's one loading signal.
 *
 * F35 item 16 follow-up (Fred: bricks, the height-mask pass and slow rebuilds must show the loading signal;
 * declare the stages as data). F35 item 41 (Fred, on his phone: "the screen looks frozen, the load screen doesn't
 * detect all computing states"; "can there be actual load stages, like computing, waiting, refreshing?"). Measured
 * at 900 px / CPU x4 before this change (tools/repro/f35item41_load_stages_measure.mjs): 9 of 12 long actions showed
 * nothing, and the 3 that did showed it 340-2263 ms late, on an 11 px status line.
 *
 * Everything is DECLARED here, never a free-text spinner at a call site:
 *  - LOADING_STAGES: {group, label, surface} per step. group = computing | waiting | refreshing (STAGE_GROUPS).
 *    surface = 'card' (a centred card, the declared-long steps) or 'pill' (a small corner chip, the short ones).
 *    A stage may declare `gestureSurface`: its surface while a CONTINUOUS gesture runs (a slider drag, a sculpt stroke),
 *    so a rebuild per drag tick shows the small pill instead of flashing the centred card (advisor, item 41 gate).
 *  - LOADING_SEQUENCES: a multi-step action declares its stage list up front, so the overlay reads
 *    "Computing - laying bricks, step 2 of 4". A sequence may declare its own surface (Generate = card even though
 *    one lay alone is a pill).
 *
 * withLoadingStage(id, fn, ctx) ENTERS the stage, lets the browser PAINT it (two animation frames), THEN runs `fn`,
 * then leaves. A shown card/pill stays up at least MIN_VISIBLE_MS so it reads instead of flickering. Neither surface
 * blocks input (pointer-events: none). Stages nest: the overlay shows the innermost one.
 * withLoadingStageShownFirst(id, fn) is the same for a SYNCHRONOUS `fn` whose result the caller does not await.
 */

import FUSION_SEND_STAGES from '../data/fusion-send-stages.js';

export const STAGE_GROUPS = { computing: 'Computing', waiting: 'Waiting', refreshing: 'Refreshing' };

/** `label` is a plain string, or a function of the optional `ctx` passed to withLoadingStage. */
export const LOADING_STAGES = {
  bricks: { group: 'computing', label: 'laying bricks', surface: 'pill' },
  patternEdit: { group: 'computing', label: 'updating the pattern', surface: 'pill' },
  openEditor: { group: 'refreshing', label: 'opening the editor', surface: 'pill' },
  openBuilder: { group: 'refreshing', label: 'opening the pattern builder', surface: 'pill' },
  heightMask: { group: 'computing', label: 'carving relief', surface: 'card', gestureSurface: 'pill' },
  rebuild: { group: 'refreshing', label: (ctx) => `building surface${ctx?.spacing != null ? ` ${ctx.spacing}″` : ''}`, surface: 'card', gestureSurface: 'pill' },
  restore: { group: 'refreshing', label: 'restoring the board', surface: 'card' },
  cloudLoad: { group: 'waiting', label: 'loading from the cloud', surface: 'card' },
  cloudSave: { group: 'waiting', label: 'saving to the cloud', surface: 'card' },
  stepExport: { group: 'computing', label: 'writing the files', surface: 'card' },
  // item 70: a Send from the Fusion palette -- the palette's own steps, then Fusion's (data/fusion-send-stages.js,
  // the add-in reports each as 'import_stage' {id}); all cards
  stepBuild: { group: 'computing', label: 'building the STEP files', surface: 'card' },
  transfer: { group: 'waiting', label: 'sending to Fusion', surface: 'card' },
  ...Object.fromEntries(FUSION_SEND_STAGES.stages.map((st) => [st.id, { group: 'waiting', label: `Fusion: ${st.label}`, surface: 'card' }])),
};

/** Multi-step actions: the stages they run, in order. A stage the action skips (no bricks = no carving) just
 *  leaves its step number unused. */
export const LOADING_SEQUENCES = {
  generate: { stages: ['bricks', 'heightMask', 'rebuild'], surface: 'card' },
  apply: { stages: ['heightMask', 'rebuild'] },
  newSeed: { stages: ['heightMask', 'rebuild'] },
  projectLoad: { stages: ['cloudLoad', 'restore', 'heightMask', 'rebuild'] },
  export: { stages: ['heightMask', 'rebuild', 'stepExport'] },
  send: { stages: ['heightMask', 'rebuild', 'stepBuild', 'transfer', ...FUSION_SEND_STAGES.stages.map((st) => st.id)] },
};

export const MIN_VISIBLE_MS = 300;
/** A continuous gesture's own trailing work (the rebuild a slider release or a stroke end schedules) still counts as
 *  part of the gesture for this long after it ends. */
export const GESTURE_GRACE_MS = 600;
/** A sequence whose stages all finished (or never came) closes after this quiet gap. */
export const SEQUENCE_IDLE_MS = 1000;

const _stack = []; // active stages, innermost last: { id, ctx }
let _sequence = null; // { id, stages, surface, timer }
let _shownAt = 0;
let _hideTimer = null;
let _gestureOn = false;
let _gestureUntil = 0;
const _inGesture = () => _gestureOn || Date.now() < _gestureUntil;

/** A continuous gesture (a slider drag, a sculpt stroke) starts (true) or ends (false). */
export function continuousGesture(on) {
  _gestureOn = !!on;
  if (!on) _gestureUntil = Date.now() + GESTURE_GRACE_MS;
}

/** Slider drags anywhere in the app are continuous gestures: pointer down on a range input .. pointer up. */
export function installGestureWatch(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  doc.addEventListener('pointerdown', (e) => { if (e.target && e.target.matches && e.target.matches('input[type="range"]')) continuousGesture(true); }, true);
  const end = () => { if (_gestureOn) continuousGesture(false); };
  doc.addEventListener('pointerup', end, true);
  doc.addEventListener('pointercancel', end, true);
}

const _raf = () => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16));
/** THE paint step: run `cb` once the stage is on screen (two animation frames: the second is the painted one). */
const TWO_FRAMES = (cb) => { const raf = _raf(); raf(() => raf(cb)); };
let _afterPaint = TWO_FRAMES;
/** The one switch for the paint step. The app never calls it; the vitest setup (tests/setup-paint.js) sets an
 *  immediate one so a panel test reads a gesture's lay synchronously, and the tests OF the deferral put the real
 *  frames back with setPaintScheduler(null). */
export function setPaintScheduler(fn) { _afterPaint = fn || TWO_FRAMES; }
const paintFrames = () => new Promise((resolve) => _afterPaint(resolve));

/** The overlay text for stage `id`: "Computing - laying bricks", plus ", step 2 of 4" inside a sequence. */
export function stageText(id, ctx, sequence = _sequence) {
  const stage = LOADING_STAGES[id];
  if (!stage) return null;
  const label = typeof stage.label === 'function' ? stage.label(ctx) : stage.label;
  const at = sequence ? sequence.stages.indexOf(id) : -1;
  const step = at >= 0 && sequence.stages.length > 1 ? `, step ${at + 1} of ${sequence.stages.length}` : '';
  return `${STAGE_GROUPS[stage.group]} - ${label}${step}`;
}

function _el() { return typeof document !== 'undefined' ? document.getElementById('loading-stage') : null; }

function _render() {
  const el = _el();
  const top = _stack[_stack.length - 1];
  if (!el || !top) return;
  clearTimeout(_hideTimer); _hideTimer = null;
  const stage = LOADING_STAGES[top.id];
  const surface = (_inGesture() && stage.gestureSurface)
    || (_sequence && _sequence.stages.includes(top.id) && _sequence.surface) || stage.surface;
  (el.querySelector('.loading-stage-text') || el).textContent = stageText(top.id, top.ctx);
  el.dataset.surface = surface;
  el.dataset.group = stage.group;
  el.dataset.stage = top.id;
  if (el.hidden) { el.hidden = false; _shownAt = Date.now(); }
}

function _hideSoon() {
  const el = _el();
  if (!el || el.hidden || _stack.length || _sequence) return;
  clearTimeout(_hideTimer);
  _hideTimer = setTimeout(() => {
    _hideTimer = null;
    if (_stack.length || _sequence) return;
    el.hidden = true;
    delete el.dataset.stage;
  }, Math.max(0, MIN_VISIBLE_MS - (Date.now() - _shownAt)));
}

const _endSequence = (seq) => { if (_sequence === seq && !_stack.length) { _sequence = null; _hideSoon(); } };

function _enter(id, ctx) {
  const entry = { id, ctx };
  _stack.push(entry);
  if (_sequence) { clearTimeout(_sequence.timer); _sequence.timer = null; }
  _render();
  return entry;
}

function _leave(entry) {
  const at = _stack.lastIndexOf(entry);
  if (at >= 0) _stack.splice(at, 1);
  if (_stack.length) { _render(); return; }
  const seq = _sequence;
  if (seq) {
    clearTimeout(seq.timer);
    if (entry.id === seq.stages[seq.stages.length - 1]) _sequence = null;
    else seq.timer = setTimeout(() => _endSequence(seq), SEQUENCE_IDLE_MS);
  }
  _hideSoon();
}

/** Declare that a multi-step action starts now: its stages show "step i of n" until its last stage leaves (or
 *  nothing more comes for SEQUENCE_IDLE_MS -- the stages may run from timers after the gesture returns). */
export function beginLoadingSequence(seqId) {
  const def = LOADING_SEQUENCES[seqId];
  if (!def) return;
  if (_sequence) clearTimeout(_sequence.timer);
  const seq = { id: seqId, stages: def.stages, surface: def.surface || null, timer: null };
  _sequence = seq;
  seq.timer = setTimeout(() => _endSequence(seq), SEQUENCE_IDLE_MS);
  if (_stack.length) _render();
}

/** item 70: a HELD stage -- one that is not a function's run but lasts until something else says it is over (Fusion
 *  working on a Send: the add-in reports each step, the palette closes it on import_success / import_failed / the
 *  poll timeout). One held slot: holding a new id replaces the previous one; null releases it. Returns a promise
 *  that resolves once the held stage has been painted (so a caller can show it BEFORE blocking work). */
let _held = null;
export function holdLoadingStage(stageId, ctx) {
  if (_held) { _leave(_held); _held = null; }
  if (!stageId || !LOADING_STAGES[stageId]) return Promise.resolve();
  _held = _enter(stageId, ctx);
  return paintFrames();
}
export const releaseHeldStage = () => holdLoadingStage(null);

/** Drop every stage and sequence and hide the overlay at once (tests: the state is module-wide). */
export function resetLoadingSignal() {
  _stack.length = 0;
  _held = null;
  if (_sequence) clearTimeout(_sequence.timer);
  _sequence = null;
  clearTimeout(_hideTimer); _hideTimer = null;
  _gestureOn = false; _gestureUntil = 0;
  const el = _el();
  if (el) { el.hidden = true; delete el.dataset.stage; }
}

/** The stage on screen now (tests, probes): { id, text, surface } or null. */
export function currentLoadingStage() {
  const el = _el();
  if (!el || el.hidden) return null;
  return { id: el.dataset.stage || null, text: (el.querySelector('.loading-stage-text') || el).textContent, surface: el.dataset.surface };
}

export async function withLoadingStage(stageId, fn, ctx) {
  if (!LOADING_STAGES[stageId]) return fn();
  const entry = _enter(stageId, ctx);
  try {
    await paintFrames(); // the stage is on screen BEFORE the work blocks the thread
    return await fn();
  } finally {
    _leave(entry);
  }
}

/** For a SYNCHRONOUS job whose caller does not await it (a re-lay): show the stage, let it paint, run `fn` in the
 *  paint step itself (no extra microtask: with the tests' immediate paint step it runs inside this call). */
export function withLoadingStageShownFirst(stageId, fn, ctx) {
  if (!LOADING_STAGES[stageId]) return Promise.resolve(fn());
  const entry = _enter(stageId, ctx);
  return new Promise((resolve, reject) => _afterPaint(() => {
    try { resolve(fn()); } catch (e) { reject(e); } finally { _leave(entry); }
  }));
}
