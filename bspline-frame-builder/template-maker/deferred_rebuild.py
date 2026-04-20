"""Defer selection-change driven payload rebuilds onto Fusion's event pump.

The Problem
-----------
Fusion fires ``ActiveSelectionEventHandler.notify()`` *synchronously* the
moment the user adds a sketch entity to the selection — including the
moment a brand-new constraint or dimension is created. At that instant
Fusion is still in the middle of a sketch recompute: entity proxies are in
transient states, ``connectedEntities`` lists are partially rebuilt, and
dimension ``parameter`` proxies haven't finished initialising.

If our payload builder walks those entities *inside* the synchronous
callback, it can dereference a stale pointer in the Fusion C++ layer.
That's not a Python exception — it's a segfault. The debug log cuts off
mid-line and Fusion goes down with no traceback.

The Fix
-------
Instead of rebuilding the payload directly inside the selection-change
handler, fire a CustomEvent via ``adsk.core.Application.fireCustomEvent``.
Fusion pumps CustomEvents on the main UI thread, but only after the
current sketch operation has fully settled — so by the time our handler
runs, every proxy is in a consistent state and the walk is safe.

This is Fusion's documented escape hatch for exactly this kind of
reentrancy problem. ``template-maker.py`` already uses this pattern for
its hot-reload command (``_DeferredRefreshHandler``); this module
generalises the approach so selection and document-activation events can
use the same mechanism.

Usage
-----
On addin ``run()``:

    import deferred_rebuild
    deferred_rebuild.register(do_rebuild_callback)

From any event handler that used to call the rebuild directly:

    deferred_rebuild.schedule()

On addin ``stop()``:

    deferred_rebuild.unregister()

``schedule()`` is idempotent per event-pump tick — if you call it ten
times in a single user action, only one rebuild runs. That coalescing
also protects us from cascading rebuilds if the rebuild itself touches
sketch state (it shouldn't, but defence in depth).
"""

import traceback

import adsk.core


REBUILD_EVENT_ID = 'TemplateMaker_DeferredRebuild'


_event = None
_handler = None
_callback = None
_pending = False
_registered = False


class _DeferredRebuildHandler(adsk.core.CustomEventHandler):
    """Fusion CustomEvent handler that invokes the registered rebuild.

    Kept as an inner handler rather than a module-level lambda because
    Fusion requires a long-lived Python object for ``.add(handler)`` — if
    the handler gets garbage-collected, the event stops firing.
    """

    def notify(self, args):
        global _pending
        _pending = False
        try:
            if _callback is not None:
                _callback()
        except Exception:
            # Swallow rather than let the exception escape into Fusion's
            # event pump. Log via print so it shows up in Fusion's TextCommand
            # window if the user has it open; the addin's own logger lives
            # in template-maker.py and we don't want to create a circular
            # dependency just for this.
            try:
                print('[deferred_rebuild] rebuild failed:\n' + traceback.format_exc())
            except Exception:
                pass


def register(callback):
    """Register the rebuild callback and the underlying CustomEvent.

    Safe to call multiple times — the CustomEvent is unregistered and
    re-registered fresh each time so stale handlers from a previous
    ``run()`` don't accumulate. The callback is replaced on each call.
    """
    global _event, _handler, _callback, _registered
    _callback = callback

    app = adsk.core.Application.get()
    # Belt-and-braces unregister first. Fusion raises if the event doesn't
    # exist, so the ``try`` is expected to fail on the first run.
    try:
        app.unregisterCustomEvent(REBUILD_EVENT_ID)
    except Exception:
        pass
    _event = app.registerCustomEvent(REBUILD_EVENT_ID)
    _handler = _DeferredRebuildHandler()
    _event.add(_handler)
    _registered = True


def unregister():
    """Tear down the CustomEvent. Call from addin ``stop()``."""
    global _event, _handler, _callback, _registered, _pending
    app = adsk.core.Application.get()
    try:
        app.unregisterCustomEvent(REBUILD_EVENT_ID)
    except Exception:
        pass
    _event = None
    _handler = None
    _callback = None
    _registered = False
    _pending = False


def schedule():
    """Request a rebuild on the next event-pump tick.

    Coalesces repeat calls within the same tick: if a rebuild is already
    pending, this is a no-op. That means a burst of selection-change
    events during a single user action produces exactly one rebuild.
    """
    global _pending
    if not _registered or _pending:
        return
    _pending = True
    try:
        adsk.core.Application.get().fireCustomEvent(REBUILD_EVENT_ID, '{}')
    except Exception:
        # fireCustomEvent can fail if the event was torn down between the
        # registered check and the fire. Reset pending so the next call
        # can try again.
        _pending = False
