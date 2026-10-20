"""op_queue.py -- the Toolpaths list's generation queue: ONE operation at a time, never parallel (Fred, 2026-10-20).

Fusion rules this is built around (measured live, seat D, 2026-10-20):
  * cam.generateToolpath(op) is async and must be called from the main loop (a CustomEvent tick), never from the palette's
    HTML handler -- so ``request`` only RECORDS what was asked; the add-in's tick (``tick``) does every Fusion call, and is
    NON-BLOCKING (it looks at the future's flags and returns), so the palette stays live through a 20-minute adaptive op.
  * progress: op.generatingProgress reads '58.5%' while generating.
  * STOP is a real cancel: cam.clearToolpath(op) on the op being generated stops it within a second (isGenerating False,
    the future completes, hasToolpath False, no error).
  * the doc's first generation can leave an op without a toolpath and no message (H23 item 95; toolpath_gen.py): after the
    queue drains, ops that are still without a valid toolpath and show no error are queued ONCE more.
  * a future that never completes (a crash dialog, a hung calculator) must not block the queue forever: after
    ``timeout_s`` the op is cancelled, marked 'did not finish', and the queue STOPS there (the next op is not started).

Pure: no adsk import. The add-in (cam-builder.py) owns the Fusion-only parts (warm-up, the tick event) and sends the
snapshot to the palette after every tick.
"""

from __future__ import annotations

import re
import time

from . import op_states

# Declared: how long one op may generate before it is cancelled (toolpath_gen.PER_SETUP_TIMEOUT_S's number: an adaptive
# op measured ~20 min, so 30 min leaves room; Fred stops a long one by hand).
PER_OP_TIMEOUT_S = 1800.0
# Declared: how many extra passes over the ops a run left without a valid toolpath and without an error.
RETRY_PASSES = 1


def percent(op):
    """op.generatingProgress ('58.5%') as a number, or None. Never raises."""
    try:
        m = re.search(r'(\d+(?:\.\d+)?)', str(op.generatingProgress))
        return float(m.group(1)) if m else None
    except Exception:
        return None


class GenerationQueue:
    def __init__(self, clock=time.time, timeout_s=PER_OP_TIMEOUT_S, retry_passes=RETRY_PASSES):
        self._clock = clock
        self.timeout_s = timeout_s
        self.retry_passes = retry_passes
        self.plan = None              # what was asked, expanded on the first tick: ('ops', [(setup, key)]) | ('missing', setup or None)
        self.queue = []               # [(setup name, key)] still to run
        self.ran = []                 # [(setup name, key)] this run started
        self.cur = None               # {'setup', 'key', 'name', 'op', 'future', 't0'}
        self.durations = {}           # key -> seconds of its last generation (this session)
        self.failed = {}              # key -> reason this run ('did not finish', ...)
        self.stop_requested = False
        self.retries_left = 0
        self.message = ''

    @property
    def active(self):
        return bool(self.plan or self.queue or self.cur)

    # ---- asked from the palette (no Fusion call) -----------------------------------------------------------------

    def request_ops(self, targets):
        """Queue these [(setup name, key)]; refused while a run is active (one at a time, never parallel)."""
        if self.active:
            return False
        self.plan = ('ops', [tuple(t) for t in targets])
        self._reset()
        return True

    def request_missing(self, setup_name=None):
        """Queue every op without a valid toolpath (all setups, or one); expanded on the first tick."""
        if self.active:
            return False
        self.plan = ('missing', setup_name)
        self._reset()
        return True

    def stop(self):
        """Stop: cancel the op being generated at the next tick and drop everything queued."""
        self.stop_requested = True

    def _reset(self):
        self.ran, self.failed, self.stop_requested = [], {}, False
        self.retries_left = self.retry_passes
        self.message = ''

    # ---- the add-in's tick (the only place Fusion is called) -------------------------------------------------------

    def tick(self, cam):
        """One non-blocking step. Returns the events of this step, e.g. [('started', key)], [('finished', key, secs,
        state)], [('stopped', key)], [('timeout', key)], [('idle',)] (the run is over)."""
        events = []
        if self.plan:
            kind, arg = self.plan
            self.plan = None
            self.queue = list(arg) if kind == 'ops' else op_states.missing_targets(cam, arg)
        if self.stop_requested:
            events += self._cancel_current(cam, 'stopped')
            self.queue = []
            self.stop_requested = False
            self.message = 'Stopped.'
            events.append(('idle',))
            return events
        if self.cur is not None:
            events += self._check_current(cam)
            if self.cur is not None:          # still generating: nothing else this tick
                return events
        events += self._start_next(cam)
        return events

    def _start_next(self, cam):
        events = []
        while self.queue:
            setup_name, key = self.queue.pop(0)
            op = op_states.find_op(cam, setup_name, key)
            if op is None or op_states.op_state(op)[0] == 'suppressed':
                continue
            try:
                future = cam.generateToolpath(op)
            except Exception as e:
                self.failed[key] = f"{type(e).__name__}: {e}"
                events.append(('failed', key, self.failed[key]))
                self.message = f"Could not start {op.name}: {e}"
                self.queue = []
                break
            self.cur = {'setup': setup_name, 'key': key, 'name': op.name, 'op': op, 'future': future, 't0': self._clock()}
            self.ran.append((setup_name, key))
            events.append(('started', key))
            return events
        if self.cur is None:
            events += self._drain_done(cam)
        return events

    def _drain_done(self, cam):
        """The queue is empty: queue the ops that came out with no valid toolpath and no error once more (H23 item 95),
        else the run is over."""
        if self.retries_left > 0 and not self.failed:
            again = []
            for setup_name, key in self.ran:
                op = op_states.find_op(cam, setup_name, key)
                if op is not None and op_states.op_state(op)[0] in ('none', 'stale') and not self._has_error(op):
                    again.append((setup_name, key))
            if again:
                self.retries_left -= 1
                self.queue = again
                return self._start_next(cam)
        self.message = self.message or ('Nothing to generate.' if not self.ran else 'Done.' if not self.failed else 'Finished with problems.')
        return [('idle',)]

    @staticmethod
    def _has_error(op):
        try:
            return bool(op.hasError)
        except Exception:
            return False

    def _check_current(self, cam):
        c = self.cur
        try:
            done = bool(c['future'].isGenerationCompleted)
        except Exception:
            done = True
        if done:
            try:
                done = not bool(c['op'].isGenerating)      # measured: the flag outlives the future by a moment -- never
            except Exception:                              # start the next op while Fusion still calls this one generating
                pass
        elapsed = self._clock() - c['t0']
        if done:
            secs = round(elapsed, 1)
            self.durations[c['key']] = secs
            state = op_states.op_state(c['op'])[0]
            self.cur = None
            return [('finished', c['key'], secs, state)]
        if elapsed > self.timeout_s:
            return self._cancel_current(cam, 'timeout', 'Fusion did not finish')
        return []

    def _cancel_current(self, cam, kind, reason=''):
        c, self.cur = self.cur, None
        if c is None:
            return []
        try:
            cam.clearToolpath(c['op'])         # the real cancel (measured)
        except Exception:
            pass
        if kind == 'timeout':
            self.failed[c['key']] = reason
            self.queue = []
            self.message = f"{c['name']}: {reason} after {int(self.timeout_s // 60)} min -- stopped."
        return [(kind, c['key'])]

    # ---- what the palette shows ----------------------------------------------------------------------------------

    def snapshot(self):
        c = self.cur
        return {
            'on': self.active,
            'setup': c['setup'] if c else None, 'key': c['key'] if c else None, 'name': c['name'] if c else None,
            'elapsed': round(self._clock() - c['t0'], 1) if c else None,
            'percent': percent(c['op']) if c else None,
            'queued': len(self.queue), 'next': self._next_name(),
            'durations': dict(self.durations), 'failed': dict(self.failed), 'message': self.message,
        }

    def _next_name(self):
        return self.queue[0][1] if self.queue else None
