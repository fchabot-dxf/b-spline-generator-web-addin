"""Runtime enumeration of CAM parameter choices.

CAM Setup parameters are exposed as a flat name->parameter dictionary
(``setup.parameters`` and ``setupInput.parameters``). Choice-style
parameters carry an enum of allowed strings, but **Autodesk has not
published a stable list** -- the strings differ slightly between
Fusion versions and between CAM environments (mill vs. mill-turn vs.
additive).

Hardcoding ``'relativeBox'`` etc. inside engine code is therefore
brittle. This module enumerates ``parameter.value.choices`` at runtime
and exposes a typed lookup so callers can express intent
("auto-bounding-box stock") and we resolve it to whatever string this
Fusion build accepts.

If a desired choice isn't found we fall back to the parameter's current
value and log a WARNING -- better to leave the user with a sane default
than crash the palette.

Reference: see ``CAM_API_NOTES.md`` -- "Stock parameters".
"""

import adsk.core
import adsk.cam


# ---------------------------------------------------------------------------
# Intent -> candidate-string dictionaries.
#
# Each list is searched in order; first match wins. Add aliases here when a
# new Fusion version ships with a new internal enum string -- do NOT scatter
# fallback logic across mm_builder / setup_builder.
# ---------------------------------------------------------------------------

STOCK_MODE_CANDIDATES = {
    # Verified strings come from Autodesk's CreateSetupsFromHoleRecognition
    # sample and runtime audits of real setups; older candidate aliases
    # are kept as fallbacks for older Fusion builds.
    'auto_bbox':        ['relativebox', 'relativeBox', 'relativesize box', 'relativeSize'],
    'fixed_box':        ['fixedbox', 'fixedBox', 'fixedsize box', 'fixedSize'],
    'from_solid':       ['fromsolid', 'fromSolid'],
    'from_prev_setup':  ['previoussetup', 'fromPrecedingSetup', 'fromPreviousSetup'],
}

WCS_ORIGIN_MODE_CANDIDATES = {
    # 'stockPoint' is what live audits show -- it means "pick a named
    # corner of the stock bbox" (works with wcs_origin_boxPoint='top 1' etc.)
    'model_origin':     ['modelOrigin', 'modelPoint'],
    'box_point':        ['stockPoint', 'boxPoint'],
    'selected_point':   ['point', 'selectedPoint'],
}

WCS_ORIENTATION_CANDIDATES = {
    'model':            ['modelOrientation'],
    'select_z_x':       ['selectZ_selectX', 'axesZX'],
    'select_x_y':       ['axesXY', 'selectX_selectY', 'selectXY'],
}


def set_choice(setup_or_input_params, param_name, candidates, logger=None):
    """Resolve and set a choice parameter by trying each candidate string
    until one is accepted by Fusion.

    Returns the string actually written, or ``None`` on failure. Works on
    both ``setup.parameters`` and ``setupInput.parameters`` (though the
    Autodesk samples set choices on the LIVE setup, not the input).

    The previous implementation introspected ``param.value.choices`` to
    pre-validate, but in current Fusion builds this list is empty -- the
    enum is opaque from the API side. The Autodesk samples
    (``SetViseOriginAsSetupWCSOrigin``, ``CreateSetupsFromHoleRecognition``)
    never query choices; they just write directly. We do the same here:
    try each candidate, catch the "Invalid enumeration value" error, move
    to the next.
    """
    if setup_or_input_params is None:
        return None

    try:
        param = setup_or_input_params.itemByName(param_name)
    except Exception as e:
        _log(logger, f"CAM PARAM: itemByName({param_name}) failed: {e}", "WARNING")
        return None

    if not param:
        _log(logger, f"CAM PARAM: '{param_name}' not present in this CAM env", "WARNING")
        return None

    last_err = None
    for cand in candidates:
        # Path 1: expression with quoted string -- the form Autodesk's
        # samples use (param.expression = "'axesXY'"). The outer quotes
        # are Python; the inner single quotes are Fusion expression syntax.
        try:
            param.expression = "'" + cand + "'"
            return cand
        except Exception as e:
            last_err = e
        # Path 2: direct value write -- the form the docs call "typically
        # better". Some builds prefer this over expressions.
        try:
            param.value.value = cand
            return cand
        except Exception as e:
            last_err = e

    try:
        current = param.value.value
    except Exception:
        current = '<unreadable>'
    _log(logger,
         f"CAM PARAM: none of {candidates} accepted by {param_name} "
         f"(current={current!r}, last_err={last_err}); leaving as-is",
         "WARNING")
    return None


def _log(logger, msg, level="INFO"):
    if logger is None:
        return
    try:
        logger.log(msg, level)
    except Exception:
        pass
