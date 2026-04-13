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

  rebuildTimer = setTimeout(() => {
    if (typeof lastRebuildFn === 'function') {
      lastRebuildFn();
    }
  }, delay);
}
