// F35 item 41 paint-first: every gesture's work waits for its loading stage to paint (core/loading-signal.js,
// two animation frames). Panel tests read a gesture's result synchronously, so the suite's paint step is immediate;
// the tests OF the deferral (loading-signal, blind-spot B8) restore the real frames with setPaintScheduler(null).
import { beforeEach } from 'vitest';
import { setPaintScheduler, resetLoadingSignal } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';

beforeEach(() => {
  setPaintScheduler((cb) => cb());
  resetLoadingSignal();
});
