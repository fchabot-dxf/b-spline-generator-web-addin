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
import json
import os
import sys
import tempfile


# Live-add-in path: ``template-maker-detection.log`` next to the module. This
# is the ONLY place detection lines land in a real Fusion session — the
# ``template-maker-debug.log`` sibling is owned by ``template-maker.py``'s
# ``_log()`` for rename / palette / handler errors, and mixing the two
# streams in the same file is what previously made it impossible to tell
# "Python exception on rename" apart from "detection rebuild ran".
_root_dir = os.path.dirname(os.path.dirname(__file__))
_DEBUG_LOG_PATH = os.path.join(_root_dir, 'logs', 'template-maker-detection.log')
# Windows temp mirror — belt-and-braces so a read-only module directory
# (rare, but we've seen it on locked-down deploy targets) doesn't suppress
# detection entirely.
_TEMP_LOG_PATH = os.path.join(tempfile.gettempdir(), 'template-maker-detection.log')


def _source_root_log_path():
    """Return the detection-log path inside the *source* template-maker
    folder, or ``None`` if we can't determine one.

    The running add-in lives in the Fusion AddIns directory (the deploy
    target copied from source by ``deploy-template-maker.py``). That
    script writes ``project_path.json`` next to the module with the
    original source-folder path, and ``copytree`` carries the file into
    the deploy folder — so at runtime we can read the JSON to find the
    source tree and mirror log writes there. Why mirror: debugging
    through a Claude session where only the source tree is mounted into
    the assistant's sandbox; without this mirror the assistant sees an
    empty log file even though the live add-in is logging furiously.
    Resolved once at import to avoid a JSON parse on every log line.
    """
    try:
        cfg_path = os.path.join(_root_dir, 'project_path.json')
        if not os.path.isfile(cfg_path):
            return None
        with open(cfg_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f) or {}
        root = cfg.get('template_maker_root')
        if not root:
            return None
        candidate = os.path.join(root, 'template-maker-detection.log')
        # If the source root IS the root dir (running straight out of
        # the source tree without a deploy step), skip the mirror —
        # otherwise we'd write the same line twice and the timestamps
        # would look doubled on investigation.
        if os.path.normcase(os.path.abspath(root)) == os.path.normcase(os.path.abspath(_root_dir)):
            return None
        return candidate
    except Exception:
        return None


_SOURCE_ROOT_LOG_PATH = _source_root_log_path()


def _is_running_under_pytest():
    """Cheap pytest detection so the test harness doesn't pollute the
    live Fusion log with hundreds of synthetic detection lines.

    ``PYTEST_CURRENT_TEST`` is exported by pytest for the duration of
    each test; ``'pytest' in sys.modules`` catches import-time calls
    (module-scope fixtures, session-level setup) before the env var is
    set. Either signal is enough — we'd rather misclassify one live
    log line as "test" than drown a real crash trail in noise.
    """
    if os.environ.get('PYTEST_CURRENT_TEST'):
        return True
    if 'pytest' in sys.modules:
        return True
    return False


def _active_log_paths():
    """Return the list of paths the current run should append to.

    Under pytest, writes are redirected to a sandbox file in ``tempdir``
    so the real ``template-maker-detection.log`` next to the module
    keeps its live-Fusion trail intact. In a real Fusion session we
    write the module-local path first (fastest for grep/tail), the
    temp mirror as the durability fallback, and — if we can resolve it
    from ``project_path.json`` — the *source* folder's copy of the log
    too. The source mirror exists so debugging sessions that only have
    the source tree mounted (e.g. through Claude) can still see the
    live add-in's trail without asking the user to copy-paste files.
    """
    if _is_running_under_pytest():
        return (os.path.join(tempfile.gettempdir(), 'template-maker-detection.pytest.log'),)
    paths = [_DEBUG_LOG_PATH, _TEMP_LOG_PATH]
    if _SOURCE_ROOT_LOG_PATH:
        paths.append(_SOURCE_ROOT_LOG_PATH)
    return tuple(paths)


def _write_debug_log(message):
    """Append a timestamped line to every active detection log path.

    Each path gets its own ``open``/``write``/``flush``/``fsync`` cycle;
    a failure on one path is swallowed so the other still records the
    line. ``fsync`` is wrapped in its own ``try`` because some filesystems
    (notably some Windows network mounts) can raise on ``fsync`` even
    though the write itself succeeded.
    """
    timestamp = datetime.datetime.now().isoformat(sep=' ', timespec='seconds')
    text = f"[{timestamp}] {message}\n"
    for path in _active_log_paths():
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
