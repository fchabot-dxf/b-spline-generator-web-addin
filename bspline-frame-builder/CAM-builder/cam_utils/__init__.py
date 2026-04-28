"""cam_utils -- shared helpers for the CAM-builder add-in.

Currently:
  - cam_logger     Thin wrapper around the same DebugLogger used by
                   frame-builder, scoped to ``cam-builder-debug.log``.
  - get_design     Source-Design lookup with workspace fallback (handles
                   the ``CAMProduct``-as-activeProduct case in the
                   Manufacture workspace).
"""

from .get_design import get_design  # noqa: F401
