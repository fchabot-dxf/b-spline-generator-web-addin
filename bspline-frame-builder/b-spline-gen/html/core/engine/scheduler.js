let rebuildTimer = null;
let pendingRebuild = null;
let lastRebuildFn = null;

export function scheduleRebuild(rebuildFnOrDelay, delayMs = 50) {
  clearTimeout(rebuildTimer);

  let delay;
  if (typeof rebuildFnOrDelay === 'function') {
    lastRebuildFn = rebuildFnOrDelay;
    delay = delayMs;
  } else if (typeof rebuildFnOrDelay === 'number') {
    delay = rebuildFnOrDelay;
  } else {
    delay = 50;
  }

  if (_hold) { rebuildTimer = null; _hold.pending = true; return; } // held: the latest fn runs once, at the release

  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    if (typeof lastRebuildFn === 'function') {
      lastRebuildFn();
    }
  }, delay);
}

/** A rebuild is waiting on its timer, or on a hold's release and its deferred work (item 37: rebuild.js whenRebuildIdle
 *  reads it). */
export function isRebuildScheduled() {
  return rebuildTimer !== null || !!(_hold && (_hold.pending || _hold.deferred.size)) || _releasing > 0;
}

// 2026-10-10 (seat A, the phone profile of a board-size nudge, loaded board): one nudge built the 3D FOUR times -- the
// param's own rebuild (new size, old masks), the editor's resync commit, the brick re-lay's commit and its remask --
// and only the last was the board the user asked for. A REBUILD HOLD makes a known multi-stage change one build: the
// caller opens it with its DECLARED stages (main/app-init.js STOCK_CHANGE_STAGES); each stage that will run joins and
// closes when done; scheduleRebuild only records the latest fn meanwhile, and it runs once when the last stage closes.
// A stage that never closes cannot freeze the 3D: the backstop releases the hold after REBUILD_HOLD_BACKSTOP_MS with no
// PROGRESS (no stage joined or closed) -- MEASURED (phone rig, CPU 4, loaded board): the whole chain runs ~3.2 s, so a
// backstop counted from the open fired before the re-lay's remask closed and the nudge built twice.
export const REBUILD_HOLD_BACKSTOP_MS = 3000;
let _hold = null; // { stages, defers: Set (declared), open: number, pending: boolean, deferred: Map, timer, resolve, done }
let _releasing = 0; // released holds whose deferred work is still running

function _progress(hold) {
  clearTimeout(hold.timer);
  hold.timer = setTimeout(() => _releaseHold(hold), hold.backstopMs);
}

function _releaseHold(hold) {
  if (_hold !== hold) return;
  clearTimeout(hold.timer);
  _hold = null;
  const all = [...hold.deferred.values()];
  const tasks = all.filter((t) => !t.supersededByBuild).map((t) => t.fn);
  // work a build redoes anyway (supersededByBuild) runs only when no build follows the hold
  const thenBuild = () => {
    if (hold.pending) scheduleRebuild(0);
    if (!hold.pending && rebuildTimer === null) for (const t of all) if (t.supersededByBuild) t.fn();
    hold.resolve();
  };
  if (!tasks.length) { thenBuild(); return; }
  // the deferred work runs once, now (each schedules its own build, as it would have); a build the hold also owes
  // follows it -- scheduleRebuild collapses both into one
  _releasing++;
  Promise.all(tasks.map((fn) => Promise.resolve().then(fn))).catch((e) => console.error('rebuild hold: deferred work failed', e))
    .finally(() => { _releasing--; thenBuild(); });
}

/** Open a hold over `stages` (a declared list); `defers`: the declared work the hold postpones (deferToHold). A hold
 *  already open (a stepper burst) is kept: the new stages join its list and its backstop restarts (as it does on every
 *  join and close). Returns a promise that settles at the release, after the deferred work. */
export function openRebuildHold(stages, { defers = [], backstopMs = REBUILD_HOLD_BACKSTOP_MS } = {}) {
  if (!_hold) {
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    _hold = { stages: new Set(), defers: new Set(), open: 0, pending: rebuildTimer !== null, deferred: new Map(), timer: null, backstopMs, resolve, done };
    clearTimeout(rebuildTimer); rebuildTimer = null; // a build already on its timer waits for the release too
  }
  const hold = _hold;
  for (const s of stages) hold.stages.add(s);
  for (const d of defers) hold.defers.add(d);
  hold.backstopMs = backstopMs;
  _progress(hold);
  return hold.done;
}

/** A declared stage of the open hold starts: returns its close (idempotent). No hold open, or a stage the hold did not
 *  declare: a no-op close, so callers join unconditionally. The hold releases when its last joined stage closes. */
export function joinRebuildHold(stage) {
  const hold = _hold;
  if (!hold || !hold.stages.has(stage)) return () => {};
  hold.open++;
  _progress(hold);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    hold.open--;
    if (hold.open <= 0) _releaseHold(hold);
    else _progress(hold);
  };
}

/** Work a hold declared in its `defers` waits for the release: the LATEST fn per key runs once then (each call while
 *  held replaces the one before -- it would have been recomputed anyway). `supersededByBuild`: work the build itself
 *  redoes (the 3D frame: TerrainPreview.update applies it) -- dropped when a build follows the hold, run when none does.
 *  Returns true when deferred; false (no hold, or a key the hold did not declare) = the caller runs it now, as before. */
export function deferToHold(key, fn, { supersededByBuild = false } = {}) {
  if (!_hold || !_hold.defers.has(key)) return false;
  _hold.deferred.set(key, { fn, supersededByBuild });
  return true;
}

/** A hold is open (tests, probes). */
export function isRebuildHeld() { return _hold !== null; }
