"""Setup builder.

Creates the four Setups, each pointed at the right Manufacturing Model
via ``setupInput.models`` (the API has no explicit MM->Setup linkage,
the binding is implicit through the bodies/occurrences supplied).

  +------------------------+----------------+------------------------+
  | Setup                  | MM rule        | Stock + WCS notes      |
  +========================+================+========================+
  | Stock                  | ``stock``      | auto bbox / model orig |
  | B-spline Back          | ``bspline_set``| auto bbox / back face  |
  | B-spline Top           | ``bspline_set``| from prev / flipped Y  |
  | Frame                  | ``frame``      | auto bbox / reoriented |
  +------------------------+----------------+------------------------+

Empty stubs by design: no operations are added. The user adds toolpaths
themselves in the CAM workspace once the Setups exist.

Reference: see ``CAM_API_NOTES.md`` -- "Setup creation", "WCS
programmatically", "Stock", "Empty Setups".
"""

import adsk.core
import adsk.cam
import adsk.fusion

from . import parameter_introspect as pi


# ---------------------------------------------------------------------------
# Setup spec table -- declarative, easy to tweak without touching the
# imperative builder.
# ---------------------------------------------------------------------------

SETUP_SPECS = [
    {
        'name':         'Stock',
        'mm_rule':      'stock',
        'stock_intent': 'auto_bbox',
        'wcs_origin':   'model_origin',
        'wcs_orient':   'model',
        'box_point':    None,
        'flip_y':       False,
    },
    {
        'name':         'B-spline Back',
        'mm_rule':      'bspline_set',
        'stock_intent': 'auto_bbox',
        'wcs_origin':   'box_point',          # corner of stock bbox
        'wcs_orient':   'select_x_y',         # axesXY -- pick X & Y axes from model
        'box_point':    'top 1',              # verified from audit JSON
        'flip_y':       False,
    },
    {
        'name':         'B-spline Top',
        'mm_rule':      'bspline_set',
        'stock_intent': 'from_prev_setup',
        'wcs_origin':   'box_point',          # corner of stock bbox (flipY handles second side)
        'wcs_orient':   'select_x_y',         # axesXY -- same axes as Back, flipped Y
        'box_point':    'top 1',              # verified from audit JSON -- same corner
        'flip_y':       True,
    },
    {
        'name':         'Frame',
        'mm_rule':      'frame',
        'stock_intent': 'auto_bbox',
        'wcs_origin':   'model_origin',
        'wcs_orient':   'model',
        'box_point':    None,
        'flip_y':       False,
    },
]


def build_all_setups(cam, mms, logger=None):
    """Build all four Setups. Returns ``[Setup, Setup, Setup, Setup]``.

    Parameters
    ----------
    cam : adsk.cam.CAM
    mms : dict[str, ManufacturingModel]
        Output of :func:`cam_engine.mm_builder.build_all_mms`. If a
        required rule is missing we skip that Setup with a WARNING --
        the rest of the pipeline can still run.
    """
    setups = []
    for spec in SETUP_SPECS:
        setup = build_setup(cam, mms, spec, logger)
        if setup:
            setups.append(setup)
    return setups


def build_setup(cam, mms, spec, logger=None):
    """Build one Setup from a spec. Returns the Setup or ``None``."""
    mm = mms.get(spec['mm_rule'])
    if mm is None:
        _log(logger,
             f"SETUP BUILD ({spec['name']}): MM rule {spec['mm_rule']!r} not built; skipping",
             "WARNING")
        return None

    try:
        setup_input = cam.setups.createInput(adsk.cam.OperationTypes.MillingOperation)
    except Exception as e:
        _log(logger, f"SETUP BUILD ({spec['name']}): createInput raised: {e}", "ERROR")
        return None

    if setup_input is None:
        _log(logger, f"SETUP BUILD ({spec['name']}): createInput returned None", "ERROR")
        return None

    # Bind to the MM via the bodies inside its occurrence. If the MM
    # was built from a stripped-empty component (Stock rule), the body
    # list is empty -- the API still accepts that and the Setup just
    # carries no model bodies, only stock.
    try:
        bodies = _collect_bodies(mm)
        if bodies:
            setup_input.models = bodies
        _log(logger, f"SETUP BUILD ({spec['name']}): bound {len(bodies)} bodies", "DEBUG")
    except Exception as e:
        _log(logger, f"SETUP BUILD ({spec['name']}): models bind failed: {e}", "WARNING")

    # Add the setup FIRST. Choice parameters on a SetupInput don't expose
    # their `choices` enum until the Setup is materialised in the CAM tree
    # -- so any `set_choice` against `setup_input.parameters` reads
    # choices=[] and falls back to the placeholder '<UNSPECIFIED>' value,
    # which fails on write with "Invalid enumeration value". We therefore
    # do all parameter writes against the LIVE `setup.parameters` below.
    try:
        setup = cam.setups.add(setup_input)
    except Exception as e:
        _log(logger, f"SETUP BUILD ({spec['name']}): setups.add raised: {e}", "ERROR")
        return None

    if setup is None:
        _log(logger, f"SETUP BUILD ({spec['name']}): setups.add returned None", "ERROR")
        return None

    try:
        setup.name = spec['name']
    except Exception as e:
        _log(logger, f"SETUP BUILD ({spec['name']}): name set failed: {e}", "WARNING")

    # Stock mode via the TYPED enum (Autodesk sample
    # `CreateSetupsFromHoleRecognition` uses this idiom:
    # `setup.stockMode = adsk.cam.SetupStockModes.RelativeBoxStock`).
    # The job_stockMode parameter-dictionary path is empirically gated --
    # certain enum strings ('relativebox' etc.) are rejected even on the
    # live setup. The typed enum sidesteps the whole string-resolution
    # problem. We fall back to the parameter dict path only if the typed
    # enum write raises (older builds, unexpected modes).
    try:
        _set_stock_mode(setup, spec['stock_intent'], spec['name'], logger)
    except Exception as e:
        _log(logger, f"SETUP BUILD ({spec['name']}): stockMode set raised: {e}", "WARNING")

    # WCS via the runtime-introspected parameter dictionary --
    # operating on the live setup, where the choice enums are populated.
    try:
        pi.set_choice(setup.parameters, 'wcs_origin_mode',
                      pi.WCS_ORIGIN_MODE_CANDIDATES[spec['wcs_origin']], logger)
        pi.set_choice(setup.parameters, 'wcs_orientation_mode',
                      pi.WCS_ORIENTATION_CANDIDATES[spec['wcs_orient']], logger)
    except Exception as e:
        _log(logger, f"SETUP BUILD ({spec['name']}): WCS parameter set raised: {e}", "WARNING")

    # Box-point corner -- only meaningful when wcs_origin_mode == 'stockPoint',
    # i.e. when wcs_origin is 'box_point' in the spec. The audit shows both
    # B-spline setups land on 'top 1' (a top-face corner of the stock bbox);
    # set_choice will try a couple of casings since older Fusion builds use
    # 'top1' (no space).
    if spec.get('box_point'):
        pt = spec['box_point']
        pi.set_choice(setup.parameters, 'wcs_origin_boxPoint',
                      [pt, pt.replace(' ', ''), pt.replace(' ', '_')], logger)

    # Axes for axesXY orientation -- bind X/Y to the root component's
    # construction axes so the WCS aligns with the model origin without
    # the user having to pick faces interactively. The flipY toggle (below)
    # handles the second-side flip for B-spline Top.
    #
    # NOTE: Fusion's WCS axis pickers expect the *direction reference* for
    # each WCS axis, and empirically the X/Y pickers get bound to the
    # opposite origin axis vs. naive expectation. We pass yAxis to axisX
    # and xAxis to axisY -- verified by inspecting the runtime result;
    # the previous straight mapping produced an X-points-along-origin-Y
    # setup, swapped from intent.
    if spec['wcs_orient'] == 'select_x_y':
        x_axis, y_axis = _get_origin_axes(logger)
        if y_axis is not None:
            _set_entity_param(setup.parameters, 'wcs_orientation_axisX',
                              y_axis, spec['name'], logger)
        if x_axis is not None:
            _set_entity_param(setup.parameters, 'wcs_orientation_axisY',
                              x_axis, spec['name'], logger)

    # Flip Y -- second-side machining of the b-spline panel uses the same
    # axesXY orientation as the first side, but with the Y axis flipped so
    # the cutter approaches from the opposite face. The audit shows this is
    # the ONLY parameter that differs between Setup 2 (Back) and Setup 3
    # (Top) -- everything else is identical.
    if spec.get('flip_y'):
        _set_bool_param(setup.parameters, 'wcs_orientation_flipY', True,
                        spec['name'], logger)

    try:
        mm_name = mm.name
    except Exception:
        mm_name = '<unknown>'
    _log(logger, f"SETUP BUILD ({spec['name']}): created -> MM '{mm_name}'")
    return setup


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

# Intent -> typed enum on `adsk.cam.SetupStockModes`. Prefer this over the
# `job_stockMode` parameter dictionary because the parameter strings are
# build-dependent and several modes ('relativebox' especially) are rejected
# at write time even though they appear in older docs. Verified by the
# `CreateSetupsFromHoleRecognition` Autodesk sample which uses this exact
# typed-enum form.
_STOCK_MODE_ENUM_NAMES = {
    'auto_bbox':       'RelativeBoxStock',
    'fixed_box':       'FixedBoxStock',
    'from_solid':      'FromSolidStock',
    'from_prev_setup': 'FromPreviousSetup',
}


def _set_stock_mode(setup, intent, setup_name, logger):
    """Set ``setup.stockMode`` via the typed enum, with a parameter-dict
    fallback for older builds or unmapped intents.

    Returns True if either path succeeded.
    """
    enum_name = _STOCK_MODE_ENUM_NAMES.get(intent)
    if enum_name and hasattr(adsk.cam, 'SetupStockModes'):
        enum_val = getattr(adsk.cam.SetupStockModes, enum_name, None)
        if enum_val is not None:
            try:
                setup.stockMode = enum_val
                _log(logger,
                     f"SETUP BUILD ({setup_name}): stockMode <- {enum_name}",
                     "DEBUG")
                return True
            except Exception as e:
                _log(logger,
                     f"SETUP BUILD ({setup_name}): typed stockMode={enum_name} failed: {e}; "
                     f"falling back to job_stockMode parameter",
                     "WARNING")

    # Fallback: parameter-dict path
    try:
        result = pi.set_choice(setup.parameters, 'job_stockMode',
                               pi.STOCK_MODE_CANDIDATES.get(intent, []), logger)
        return result is not None
    except Exception as e:
        _log(logger,
             f"SETUP BUILD ({setup_name}): job_stockMode fallback raised: {e}",
             "WARNING")
        return False


def _collect_bodies(mm):
    """Pull every BRepBody under the MM's occurrence into a flat list,
    including bodies nested in sub-occurrences. The B-spline panel body
    lives two levels deep (B-Spline Set > Terrain - Clean Solid > Body1),
    so a top-level-only walk misses it.
    """
    bodies = []
    try:
        comp = mm.occurrence.component
    except Exception:
        return bodies

    try:
        for b in comp.bRepBodies:
            bodies.append(b)
    except Exception:
        pass

    try:
        for occ in comp.allOccurrences:
            try:
                for b in occ.component.bRepBodies:
                    bodies.append(b)
            except Exception:
                continue
    except Exception:
        pass

    return bodies


def _get_origin_axes(logger):
    """Return ``(xAxis, yAxis)`` from the root component's origin folder.

    These are ``ConstructionAxis`` entities that exist on every Fusion
    document at the world origin. Returning them lets us bind the WCS
    X/Y selection to the model origin without interactive picking.
    """
    try:
        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct)
        if design is None:
            # Manufacture workspace returns CAMProduct from activeProduct;
            # fall back to looking up the design product directly.
            doc = app.activeDocument
            if doc:
                ds = doc.products.itemByProductType('DesignProductType')
                if ds:
                    design = adsk.fusion.Design.cast(ds)
        if design is None:
            _log(logger, "SETUP BUILD: no Design to source origin axes from", "WARNING")
            return (None, None)
        root = design.rootComponent
        return (root.xConstructionAxis, root.yConstructionAxis)
    except Exception as e:
        _log(logger, f"SETUP BUILD: _get_origin_axes raised: {e}", "WARNING")
        return (None, None)


def _set_entity_param(params, name, entity, setup_name, logger):
    """Set a CAM 'selection' parameter (e.g. ``wcs_orientation_axisX``)
    to a single entity reference.

    These parameters carry an array of entity references (Fusion calls it
    a "CadObject" parameter). The exact API surface differs between Fusion
    builds, so we try a few shapes in order of preference and stop at the
    first one that doesn't raise.
    """
    if params is None or entity is None:
        return False
    try:
        param = params.itemByName(name)
    except Exception as e:
        _log(logger, f"SETUP BUILD ({setup_name}): itemByName({name}) failed: {e}", "WARNING")
        return False
    if not param:
        _log(logger, f"SETUP BUILD ({setup_name}): '{name}' not present", "WARNING")
        return False

    # Path 1: param.value.value = [entity]   (most modern builds)
    try:
        param.value.value = [entity]
        return True
    except Exception:
        pass
    # Path 2: param.value.value = entity     (single-entity shape)
    try:
        param.value.value = entity
        return True
    except Exception:
        pass
    # Path 3: param.value.addReference(entity) / addEntity(entity)
    for meth in ('addReference', 'addEntity', 'add'):
        try:
            getattr(param.value, meth)(entity)
            return True
        except Exception:
            continue

    _log(logger,
         f"SETUP BUILD ({setup_name}): could not assign entity to {name} -- "
         f"value type {type(getattr(param, 'value', None)).__name__}",
         "WARNING")
    return False


def _set_bool_param(params, name, value, setup_name, logger):
    """Set a boolean CAM parameter (e.g. ``wcs_orientation_flipY``).

    CAM bool parameters use string expressions ``'true'`` / ``'false'``,
    not Python booleans. We try the expression form first, then fall back
    to the value form for older builds.
    """
    if params is None:
        return False
    try:
        param = params.itemByName(name)
    except Exception as e:
        _log(logger, f"SETUP BUILD ({setup_name}): itemByName({name}) failed: {e}", "WARNING")
        return False
    if not param:
        _log(logger, f"SETUP BUILD ({setup_name}): '{name}' not present", "WARNING")
        return False
    expr = 'true' if value else 'false'
    try:
        param.expression = expr
        return True
    except Exception:
        pass
    try:
        param.value.value = bool(value)
        return True
    except Exception as e:
        _log(logger, f"SETUP BUILD ({setup_name}): set {name}={value!r} failed: {e}", "WARNING")
        return False


def _log(logger, msg, level="INFO"):
    if logger is None:
        return
    try:
        logger.log(msg, level)
    except Exception:
        pass
