"""Logger shim for the CAM-builder add-in.

Reuses the ``DebugLogger`` class from ``frame-builder/fb_utils`` so log
formatting + handshake discovery (project_path.json -> source folder)
stays consistent across the project. We subclass it to:

  1. Rename the log file (``cam-builder-<category>-debug.log`` instead of
     the frame-builder default).
  2. Add a CAM-specific candidate to the handshake search so the source
     folder for CAM-builder is found even when only frame-builder's
     project_path.json is on disk.

Subclassing is the only correct way to override ``_log_name`` because
``DebugLogger.__init__`` calls it during construction to populate
``self.log_paths``. Patching the instance method afterwards is too late.

If the frame-builder package isn't on the import path (e.g. CAM-builder
loaded standalone in some future config), we fall back to a tiny
inline logger so the palette never breaks over a logging dependency.
"""

import os
import sys
import json
import datetime


def make_logger(addin_root, category=None):
    """Return a logger object with ``.log(msg, level)`` /
    ``.log_error(msg)`` / ``.session_start(title)``.

    Tries the shared ``DebugLogger`` first; falls back to
    ``_StdoutLogger`` only if that import fails.
    """
    try:
        sibling = os.path.normpath(os.path.join(
            os.path.dirname(addin_root), 'frame-builder', 'fb_utils'
        ))
        if sibling not in sys.path:
            sys.path.insert(0, sibling)
        from fb_logger import DebugLogger

        class CamDebugLogger(DebugLogger):
            """DebugLogger with CAM-specific naming + extra handshake
            candidates. We override ``__init__`` so log_paths are built
            with our log name *and* with our extended candidate list,
            both during the same construction pass."""

            def _log_name(self):
                if self.category:
                    return f"cam-builder-{self.category}-debug.log"
                return "cam-builder-debug.log"

            def __init__(self, addin_root, category=None):
                # Mirror parent __init__ but with our log name baked in.
                self.addin_root = addin_root
                self.category = self._normalize_category(category)
                self.enabled = os.getenv('FB_DEBUG_LOG', '1').strip().lower() in (
                    '1', 'true', 'yes', 'on'
                )
                self.log_paths = []
                self.phase_id = None

                if not self.enabled:
                    return

                # Primary log lives in the deployed addin folder so a
                # crash that prevents handshake still leaves a trail.
                self.log_paths = [os.path.join(addin_root, self._log_name())]

                # Handshake candidates -- ordered by specificity. Whatever
                # we find first is used to derive the CAM-builder source.
                candidates = [
                    os.path.join(addin_root, 'project_path.json'),
                    os.path.join(os.path.dirname(addin_root), 'CAM-builder', 'project_path.json'),
                    os.path.join(os.path.dirname(addin_root), 'project_path.json'),
                    os.path.join(os.path.dirname(addin_root), 'frame-builder', 'project_path.json'),
                ]

                for handshake_path in candidates:
                    if not os.path.exists(handshake_path):
                        continue
                    try:
                        with open(handshake_path, 'r', encoding='utf-8') as f:
                            config = json.load(f)
                        source_dir = config.get('project_root')
                    except Exception:
                        continue
                    if not source_dir:
                        continue

                    full_source_dir = os.path.normpath(os.path.expanduser(source_dir))

                    # If the handshake we found points to a non-CAM-builder
                    # source (e.g. frame-builder's project_path.json was
                    # picked up because CAM-builder's wasn't deployed),
                    # try to derive the CAM-builder source by sibling
                    # lookup. Without this, CAM logs leak into the
                    # frame-builder source folder.
                    base = os.path.basename(full_source_dir).lower()
                    if base != 'cam-builder':
                        sibling = os.path.normpath(os.path.join(
                            os.path.dirname(full_source_dir), 'CAM-builder'
                        ))
                        if os.path.isdir(sibling):
                            full_source_dir = sibling

                    if not os.path.isdir(full_source_dir):
                        continue
                    src_log = os.path.join(full_source_dir, self._log_name())
                    if src_log not in self.log_paths:
                        self.log_paths.append(src_log)
                        break

                for path in self.log_paths:
                    self._cap_log_file(path)

                self.log(f"LOGGER INITIALIZED. ACTIVE PATHS: {len(self.log_paths)}")
                for p in self.log_paths:
                    self.log(f"  log path: {p}", "DEBUG")

        return CamDebugLogger(addin_root, category=category or 'cam')

    except Exception:
        return _StdoutLogger()


class _StdoutLogger:
    """Minimal fallback so the engine never crashes over logging."""

    def __init__(self):
        self.phase_id = None

    def log(self, message, level="INFO"):
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}][{level}] {message}")

    def log_error(self, message):
        self.log(f"ERROR: {message}", "ERROR")

    def session_start(self, title):
        self.log(f"==== {title} ====")
