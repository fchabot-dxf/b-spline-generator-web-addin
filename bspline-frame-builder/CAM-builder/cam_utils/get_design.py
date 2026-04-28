"""Source-Design lookup helper.

Fusion's ``app.activeProduct`` returns whichever Product is currently
on top: in the Design workspace it's a ``Design``, in the Manufacture
workspace it's a ``CAMProduct``. Code that wants to read or write the
source Design (origin axes, source userParameters, the design tree)
needs to handle both cases.

This helper centralises the "give me the source Design" pattern. Use
it whenever you'd previously written
``adsk.fusion.Design.cast(app.activeProduct)``.

Important scope note
--------------------
``get_design()`` returns the **source** Design. It does NOT return the
derived design owned by an active ManufacturingModel. The MM's own
scope (its parameters, bodies, etc.) is a different beast and currently
has no clean public API surface -- the documented path was
``mm.activate()`` followed by reading ``app.activeProduct``, but on
current Fusion builds that returns a ``CAMProduct`` instead of the MM's
derived ``Design``. Any code that wanted to write into MM scope via
``app.activeProduct`` is silently broken and should NOT use
``get_design()`` as a fallback -- it would write into the source
Design instead, polluting it.

For now, MM-scope writers should detect the broken activeProduct case
and skip with a clear warning (see ``mm_builder._propagate_user_parameters_to_mm``
and ``_populate_stock_placeholder``).
"""

import adsk.core
import adsk.fusion


def get_design(app=None, logger=None):
    """Return the source ``adsk.fusion.Design`` of the active document.

    Tries ``app.activeProduct`` first (works in the Design workspace).
    Falls back to looking up the document's ``DesignProductType``
    product (works in any workspace, including Manufacture).

    Returns ``None`` if no Design product is reachable -- the caller
    must handle that case.
    """
    if app is None:
        try:
            app = adsk.core.Application.get()
        except Exception as e:
            _log(logger, f"get_design: Application.get() raised: {e}", "WARNING")
            return None
    if app is None:
        _log(logger, "get_design: app is None", "WARNING")
        return None

    # Path 1: activeProduct cast -- works when user is in Design workspace.
    try:
        design = adsk.fusion.Design.cast(app.activeProduct)
        if design is not None:
            return design
    except Exception:
        pass

    # Path 2: explicit product lookup -- works in Manufacture workspace
    # (and any other workspace where activeProduct isn't the Design).
    try:
        doc = app.activeDocument
    except Exception as e:
        _log(logger, f"get_design: activeDocument read failed: {e}", "WARNING")
        return None
    if doc is None:
        _log(logger, "get_design: no activeDocument", "WARNING")
        return None
    try:
        ds = doc.products.itemByProductType('DesignProductType')
    except Exception as e:
        _log(logger, f"get_design: itemByProductType('DesignProductType') failed: {e}", "WARNING")
        return None
    if ds is None:
        _log(logger, "get_design: no DesignProductType product on this document", "WARNING")
        return None
    try:
        return adsk.fusion.Design.cast(ds)
    except Exception as e:
        _log(logger, f"get_design: cast on DesignProductType product failed: {e}", "WARNING")
        return None


def _log(logger, msg, level="INFO"):
    if logger is None:
        return
    try:
        logger.log(msg, level)
    except Exception:
        pass
