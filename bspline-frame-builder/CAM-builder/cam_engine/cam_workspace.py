"""Workspace activation + ``adsk.cam.CAM`` cast guard.

Every other ``cam_engine`` module asks this layer for a ``CAM`` product
handle. If we're in the wrong workspace or the document hasn't loaded
a CAM product yet, ``acquire_cam`` returns ``None`` and the caller
short-circuits with a UI-visible error.

Why a dedicated module:
- Centralises the null-check pattern. Every CAM API entry point fails
  silently or with cryptic errors when called outside the Manufacture
  workspace; one chokepoint here means the rest of the codebase
  doesn't have to rediscover that.
- Lets tests stub out the workspace gate without touching engine code.

Reference: see ``CAM_API_NOTES.md`` -- "Workspace gate".
"""

import adsk.core
import adsk.cam


_CAM_PRODUCT_TYPE = 'CAMProductType'
_CAM_WORKSPACE_ID = 'CAMEnvironment'


def acquire_cam(app=None, logger=None):
    """Return the active document's ``CAM`` product, or ``None``.

    Does **not** activate the Manufacture workspace itself -- that
    side effect lives in :func:`activate_manufacture_workspace`, so
    callers can decide whether a workspace switch is appropriate.
    The CAM-builder coordinator currently calls this twice: once to
    pick up an already-cached CAM product cheaply, and (if that fails)
    once more after :func:`activate_manufacture_workspace` to recover
    instead of bailing on the user.

    Parameters
    ----------
    app : adsk.core.Application, optional
        Defaults to ``adsk.core.Application.get()``.
    logger : optional
        Anything with ``.log(msg, level)``. ``None`` silences logging.
    """
    app = app or adsk.core.Application.get()
    doc = app.activeDocument if app else None
    if not doc:
        _log(logger, "CAM: no active document", "WARNING")
        return None

    try:
        product = doc.products.itemByProductType(_CAM_PRODUCT_TYPE)
    except Exception as e:
        _log(logger, f"CAM: products lookup failed: {e}", "WARNING")
        return None

    if not product:
        _log(logger, "CAM: document has no CAM product (open Manufacture workspace)", "WARNING")
        return None

    cam = adsk.cam.CAM.cast(product)
    if not cam:
        _log(logger, "CAM: cast to adsk.cam.CAM failed", "WARNING")
        return None

    return cam


def is_manufacture_active(app=None):
    """``True`` if the Manufacture workspace is the active workspace.

    Cheap pre-flight check so the palette can grey out the Generate
    button when we're not in CAM. The cast in :func:`acquire_cam`
    succeeds even from Design as long as a CAM product exists, so this
    is a stricter check.
    """
    app = app or adsk.core.Application.get()
    if not app:
        return False
    try:
        return app.userInterface.activeWorkspace.id == _CAM_WORKSPACE_ID
    except Exception:
        return False


def activate_manufacture_workspace(app=None, logger=None):
    """Switch the Fusion UI to the Manufacture workspace.

    Returns ``True`` if Manufacture is active after the call (either
    because we just switched, or because it was already active),
    ``False`` if activation failed (workspace not found, license issue,
    no document, etc).

    Switching the workspace also causes Fusion to lazily create the
    document's CAM product if it didn't have one yet, which is the main
    reason callers want this: ``acquire_cam`` returns ``None`` outside
    Manufacture for some documents, so a one-time activate-then-retry
    lets the coordinator proceed instead of bailing on the user.
    """
    app = app or adsk.core.Application.get()
    if not app:
        return False
    try:
        ui = app.userInterface
    except Exception as e:
        _log(logger, f"CAM: userInterface unavailable: {e}", "WARNING")
        return False

    try:
        if ui.activeWorkspace and ui.activeWorkspace.id == _CAM_WORKSPACE_ID:
            return True
    except Exception:
        pass

    try:
        ws = ui.workspaces.itemById(_CAM_WORKSPACE_ID)
    except Exception as e:
        _log(logger, f"CAM: workspace lookup failed: {e}", "WARNING")
        return False

    if not ws:
        _log(logger, "CAM: Manufacture workspace not registered (license/install issue?)", "WARNING")
        return False

    try:
        ws.activate()
        _log(logger, "CAM: switched to Manufacture workspace", "INFO")
    except Exception as e:
        _log(logger, f"CAM: workspace activate() failed: {e}", "WARNING")
        return False

    # Confirm.
    try:
        return ui.activeWorkspace.id == _CAM_WORKSPACE_ID
    except Exception:
        return False


def _log(logger, msg, level="INFO"):
    if logger is None:
        return
    try:
        logger.log(msg, level)
    except Exception:
        pass
