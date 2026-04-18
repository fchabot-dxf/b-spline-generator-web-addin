"""Detection log for the Template Maker add-in.

Every payload rebuild emits a trail of "Detected N design parameters",
"Collected variable names: [...]", "Ownership gate: X owned, Y unowned"
lines that are vital for diagnosing Fusion-side crashes — a truncated
mid-line tail on disk is how we identify a native-AV inside
``build_template_payload``. That trail is also serialised into the
payload's ``logs`` field and displayed in the palette's log pane.

Extracted out of ``template_payload`` because logging is a
cross-cutting concern: ``template_generator``, ``template_payload``,
``template_payload_builder`` and the relation-hint module should all be
able to emit detection lines without reaching into the seed-hint module.

Write path
----------
``_write_debug_log`` explicitly flushes and ``fsync``s after every
write. The reason is diagnostic, not performance — if Fusion segfaults
mid-rebuild we want the last clean log line to be genuinely durable on
disk so we can bisect. Without the fsync, Python's buffering can make a
perfectly-survived rebuild look like it crashed (truncated tail) and
mask a real crash further down (no line on disk at all).

The log fans out to three paths so a stale deploy path or a per-user
``AppData`` redirect can't hide the trail:

    _DEBUG_LOG_PATH   — ``template-maker-detection.log`` next to the module
    _SOURCE_LOG_PATH  — ``template-maker-debug.log`` next to the module
    _TEMP_LOG_PATH    — ``template-maker-detection.log`` under ``tempfile.gettempdir()``

All three writes are individually guarded so one failing path (e.g.
read-only mount) doesn't suppress the other two.

Back-compat re-exports
----------------------
``template_payload`` re-imports ``_write_debug_log`` and ``_log_detection``
from here so any caller still doing ``from template_payload import
_log_detection`` keeps working. New callers should import from this
module directly.
"""

import datetime
import os
import tempfile


_DEBUG_LOG_PATH = os.path.join(os.path.dirname(__file__), 'template-maker-detection.log')
_SOURCE_LOG_PATH = os.path.join(os.path.dirname(__file__), 'template-maker-debug.log')
_TEMP_LOG_PATH = os.path.join(tempfile.gettempdir(), 'template-maker-detection.log')


def _write_debug_log(message):
    """Append a timestamped line to every detection log path.

    Each path gets its own ``open``/``write``/``flush``/``fsync`` cycle;
    a failure on one path is swallowed so the other two still record
    the line. ``fsync`` is wrapped in its own ``try`` because some
    filesystems (notably some Windows network mounts) can raise on
    ``fsync`` even though the write itself succeeded.
    """
    timestamp = datetime.datetime.now().isoformat(sep=' ', timespec='seconds')
    text = f"[{timestamp}] {message}\n"
    for path in (_DEBUG_LOG_PATH, _SOURCE_LOG_PATH, _TEMP_LOG_PATH):
        try:
            # Explicit flush + fsync so a Fusion segfault mid-rebuild doesn't
            # leave a truncated line on disk looking like a crash when it was
            # just buffered output. If the process dies after fsync, the
            # preceding line is durable; if it dies during it, we see the
            # partial write and know we really did segfault at that point.
            with open(path, 'a', encoding='utf-8') as f:
                f.write(text)
                f.flush()
                try:
                    os.fsync(f.fileno())
                except Exception:
                    pass
        except Exception:
            pass


def _log_detection(logs, message):
    """Emit a detection line to disk AND append it to the in-memory
    ``logs`` list the payload carries back to the palette.

    ``logs`` may be ``None`` when the caller only wants the disk side
    (e.g. inside guard code where no payload is being built); the
    file-side write always runs.
    """
    text = str(message)
    if logs is not None:
        logs.append(text)
    _write_debug_log(text)
