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
    'auto_bbox':        ['relativeBox', 'relativesize box', 'relativeSize'],
    'fixed_box':        ['fixedBox', 'fixedsize box', 'fixedSize'],
    'from_solid':       ['fromSolid'],
    'from_prev_setup':  ['fromPrecedingSetup', 'fromPreviousSetup'],
}

WCS_ORIGIN_MODE_CANDIDATES = {
    'model_origin':     ['modelOrigin', 'modelPoint'],
    'box_point':        ['boxPoint'],
    'selected_point':   ['selectedPoint', 'point'],
}

WCS_ORIENTATION_CANDIDATES = {
    'model':            ['modelOrientation'],
    'select_z_x':       ['selectZ_selectX'],
    'select_x_y':       ['selectX_selectY', 'selectXY'],
}


def resolve_choice(param, candidates, logger=None):
    """Pick the first candidate string the parameter actually supports.

    Returns ``(matched_string, was_fallback)``. If nothing matches we
    return the parameter's current value and log a WARNING so the
    caller knows their intent was ignored.
    """
    if not param:
        return (None, True)

    try:
        choices = list(getattr(param.value, 'choices', []) or [])
    except Exception as e:
        _log(logger, f"CAM PARAM: failed to read choices for {param.name}: {e}", "WARNING")
        choices = []

    for c in candidates:
        if c in choices:
            return (c, False)

    try:
        current = param.value.value
    except Exception:
        current = None
    _log(logger,
         f"CAM PARAM: none of {candidates} matched choices={choices} for "
         f"{getattr(param, 'name', '?')}; falling back to {current!r}",
         "WARNING")
    return (current, True)


def set_choice(setup_or_input_params, param_name, candidates, logger=None):
    """Resolve and set a choice parameter in one call.

    Returns the string actually written, or ``None`` on failure. Works
    on both ``setup.parameters`` and ``setupInput.parameters``.
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

    chosen, _ = resolve_choice(param, candidates, logger)
    if chosen is None:
        return None

    try:
        param.value.value = chosen
        return chosen
    except Exception as e:
        _log(logger, f"CAM PARAM: setting {param_name}={chosen!r} failed: {e}", "WARNING")
        return None


def _log(logger, msg, level="INFO"):
    if logger is None:
        return
    try:
        logger.log(msg, level)
    except Exception:
        pass
