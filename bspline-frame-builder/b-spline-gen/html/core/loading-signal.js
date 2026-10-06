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
 *  - LOADING_SEQUENCES: a multi-step action declares its stage list up front, so the overlay reads
 *    "Computing - laying bricks, step 2 of 4". A sequence may declare its own surface (Generate = card even though
 *    one lay alone is a pill).
 *
 * withLoadingStage(id, fn, ctx) ENTERS the stage, lets the browser PAINT it (two animation frames), THEN runs `fn`,
 * then leaves. A shown card/pill stays up at least MIN_VISIBLE_MS so it reads instead of flickering. Neither surface
 * blocks input (pointer-events: none). Stages nest: the overlay shows the innermost one.
 * withLoadingStageShownFirst(id, fn) is the same for a SYNCHRONOUS `fn` whose result the caller does not await.
 */

export const STAGE_GROUPS = { computing: 'Computing', waiting: 'Waiting', refreshing: 'Refreshing' };

/** `label` is a plain string, or a function of the optional `ctx` passed to withLoadingStage. */
export const LOADING_STAGES = {
  bricks: { group: 'computing', label: 'laying bricks', surface: 'pill' },
  patternEdit: { group: 'computing', label: 'updating the pattern', surface: 'pill' },
  openEditor: { group: 'refreshing', label: 'opening the editor', surface: 'pill' },
  heightMask: { group: 'computing', label: 'carving relief', surface: 'card' },
  rebuild: { group: 'refreshing', label: (ctx) => `building surface${ctx?.spacing != null ? ` ${ctx.spacing}″` : ''}`, surface: 'card' },
  restore: { group: 'refreshing', label: 'restoring the board', surface: 'card' },
  cloudLoad: { group: 'waiting', label: 'loading from the cloud', surface: 'card' },
  cloudSave: { group: 'waiting', label: 'saving to the cloud', surface: 'card' },
  stepExport: { group: 'computing', label: 'writing the files', surface: 'card' },
};

/** Multi-step actions: the stages they run, in order. A stage the action skips (no bricks = no carving) just
 *  leaves its step number unused. */
export const LOADING_SEQUENCES = {
  generate: { stages: ['bricks', 'heightMask', 'rebuild'], surface: 'card' },
  apply: { stages: ['heightMask', 'rebuild'] },
  newSeed: { stages: ['heightMask', 'rebuild'] },
  projectLoad: { stages: ['cloudLoad', 'restore', 'heightMask', 'rebuild'] },
  export: { stages: ['heightMask', 'rebuild', 'stepExport'] },
};

export const MIN_VISIBLE_MS = 300;
/** A sequence whose stages all finished (or never came) closes after this quiet gap. */
export const SEQUENCE_IDLE_MS = 1000;

const _stack = []; // active stages, innermost last: { id, ctx }
let _sequence = null; // { id, stages, surface, timer }
let _shownAt = 0;
let _hideTimer = null;

const _raf = () => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16));
const paintFrames = () => new Promise((resolve) => { const raf = _raf(); raf(() => raf(resolve)); });

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
  const surface = (_sequence && _sequence.stages.includes(top.id) && _sequence.surface) || stage.surface;
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

/** Drop every stage and sequence and hide the overlay at once (tests: the state is module-wide). */
export function resetLoadingSignal() {
  _stack.length = 0;
  if (_sequence) clearTimeout(_sequence.timer);
  _sequence = null;
  clearTimeout(_hideTimer); _hideTimer = null;
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

/** For a SYNCHRONOUS slow job whose caller does not await it (a re-lay): show the stage, let it paint, run. */
export function withLoadingStageShownFirst(stageId, fn, ctx) {
  return withLoadingStage(stageId, () => fn(), ctx);
}
