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
from cam_utils import get_design


# ---------------------------------------------------------------------------
# Setup spec table -- declarative, easy to tweak without touching the
# imperative builder.
# ---------------------------------------------------------------------------

SETUP_SPECS = [
    {
        'name':         'Stock',
        'mm_rule':      'stock',
        'stock_intent': 'auto_bbox',
        # Orientation mirrors the B-spline Top setup so the stock blank
        # sits in the same WCS frame the user will look at when they
        # author top-side toolpaths. Same corner ('top 1'), same axesXY
        # orient mode, same flipY=True.
        'wcs_origin':   'box_point',
        'wcs_orient':   'select_x_y',
        'box_point':    'top 1',
        'flip_y':       True,
        # 1in of stock above the model body's top → setup dialog shows
        # Stock Height (Z) = body 2in + top offset 1in = 3in. Verified
        # against 2026-04-28 audit (job_stockOffsetTop = '1in').
        'stock_offset_top':    '1 in',
        # Sides + bottom MUST be explicitly zeroed: Fusion's default for
        # job_stockOffsetSides is 1mm (= 0.0394 in), which silently bloats
        # Stock Width(X)/Depth(Y) by 2mm (1mm per side). Without these
        # writes the dialog reports 10.0787 / 8.0787 instead of 10.0 / 8.0.
        'stock_offset_sides':  '0 in',
        'stock_offset_bottom': '0 in',
    },
    {
        'name':         'B-spline Back',
        'mm_rule':      'bspline_set',
        # Fixed-box stock: dimensions come from the parametric stock body
        # in MM-Stock rather than auto-bboxing the panel itself. Lets the
        # back-side toolpaths see the FULL stock blank (including the 1in
        # top offset air), not just the panel surface bbox.
        'stock_intent': 'fixed_box',
        'wcs_origin':   'box_point',          # corner of stock bbox
        'wcs_orient':   'select_x_y',         # axesXY -- pick X & Y axes from model
        'box_point':    'top 1',              # verified from audit JSON
        'flip_y':       False,
    },
    {
        'name':         'B-spline Top',
        'mm_rule':      'bspline_set',
        'stock_intent': 'fixed_box',
        'wcs_origin':   'box_point',          # corner of stock bbox (flipY handles second side)
        'wcs_orient':   'select_x_y',         # axesXY -- same axes as Back, flipped Y
        'box_point':    'top 1',              # verified from audit JSON -- same corner
        'flip_y':       True,
        # Rest machining flag retained so the user can switch Top back
        # to from_prev_setup later without re-editing the spec. With
        # fixed_box it's a harmless no-op (no previous setup to chain).
        'continue_machining': True,
    },
    {
        'name':         'Frame',
        'mm_rule':      'frame',
        'stock_intent': 'fixed_box',
        'wcs_origin':   'box_point',
        'wcs_orient':   'select_x_y',         # axesXY -- same axes swap as Stock/Back/Top
        'box_point':    'top 1',
        'flip_y':       True,                 # Z up to match Stock and B-spline Top
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

    # WCS write order matters. Fusion evaluates wcs_origin_boxPoint
    # against the CURRENT orientation frame (axes + flips). If we set
    # the corner BEFORE the axes/flipY are established, "top 1" picks
    # a corner in the half-resolved frame; afterwards Fusion may
    # re-resolve and the geom.origin lands somewhere unexpected (this
    # is exactly the divergence between Back and Top we saw in audit_4).
    #
    # Final order: origin_mode → orientation_mode → axes → flipY → boxPoint
    # so the corner is picked LAST, in the fully-resolved post-flip frame.

    # 1. origin/orientation MODES (which kind of WCS, not which corner yet).
    try:
        pi.set_choice(setup.parameters, 'wcs_origin_mode',
                      pi.WCS_ORIGIN_MODE_CANDIDATES[spec['wcs_origin']], logger)
        pi.set_choice(setup.parameters, 'wcs_orientation_mode',
                      pi.WCS_ORIENTATION_CANDIDATES[spec['wcs_orient']], logger)
    except Exception as e:
        _log(logger, f"SETUP BUILD ({spec['name']}): WCS parameter set raised: {e}", "WARNING")

    # 2. Axes for axesXY orientation -- bind X/Y to the root component's
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

    # 3. Flip Y -- second-side machining of the b-spline panel uses the same
    # axesXY orientation as the first side, but with the Y axis flipped so
    # the cutter approaches from the opposite face. The audit shows this is
    # the ONLY parameter that differs between Setup 2 (Back) and Setup 3
    # (Top) -- everything else is identical.
    if spec.get('flip_y'):
        _set_bool_param(setup.parameters, 'wcs_orientation_flipY', True,
                        spec['name'], logger)

    # 4. Box-point corner LAST. Only meaningful when wcs_origin_mode ==
    # 'stockPoint' (i.e. spec['wcs_origin'] == 'box_point'). With the
    # axes + flipY already in place, "top 1" is interpreted in the final
    # post-flip frame instead of the unflipped frame, so the physical
    # corner that the WCS lands on matches what the spec asked for.
    # set_choice will try a couple of casings since older Fusion builds
    # use 'top1' (no space).
    if spec.get('box_point'):
        pt = spec['box_point']
        pi.set_choice(setup.parameters, 'wcs_origin_boxPoint',
                      [pt, pt.replace(' ', ''), pt.replace(' ', '_')], logger)

    # Continue rest machining — when True, the setup only cuts material
    # left over by the previous setup instead of re-cutting solved volume.
    # B-spline Top opts in (it's the second side of the panel; the Back
    # roughing pass already removed most of the stock).
    if spec.get('continue_machining') is not None:
        _set_bool_param(setup.parameters, 'job_continueMachining',
                        bool(spec['continue_machining']),
                        spec['name'], logger)

    # Stock offsets — real-valued parameters carrying expression strings
    # (e.g. '1 in'). Optional per-spec; only written if the spec opts in.
    # The Stock setup uses stock_offset_top='1 in' so the dialog reports
    # Stock Height (Z) = body 2in + 1in top offset = 3in (matches audit).
    if spec.get('stock_offset_top') is not None:
        _set_expr_param(setup.parameters, 'job_stockOffsetTop',
                        spec['stock_offset_top'], spec['name'], logger)
    if spec.get('stock_offset_sides') is not None:
        _set_expr_param(setup.parameters, 'job_stockOffsetSides',
                        spec['stock_offset_sides'], spec['name'], logger)
    if spec.get('stock_offset_bottom') is not None:
        _set_expr_param(setup.parameters, 'job_stockOffsetBottom',
                        spec['stock_offset_bottom'], spec['name'], logger)

    # Read-back log: dump what Fusion actually has on the live setup AFTER
    # all writes. Catches the silent-reject case where set_choice falls
    # back to a default without raising. If the WCS dialog later shows a
    # different corner than the spec asked for, this log is the smoking
    # gun — it tells us exactly which parameter Fusion didn't honour.
    _log_wcs_readback(setup, spec, logger)

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
    'fixed_size':      'FixedBoxStock',    # alias used by profile extractor
    'from_solid':      'FromSolidStock',
    'from_prev_setup': 'FromPreviousSetup',
}

# Integer box-point (1-9) that the profile stores → Fusion expression string.
# Layout: row(top/center/bottom) × col(left/centre/right).
_INT_TO_BOX_POINT = {
    1: 'top 1', 2: 'top 2', 3: 'top 3',
    4: 'center 1', 5: 'center 2', 6: 'center 3',
    7: 'bottom 1', 8: 'bottom 2', 9: 'bottom 3',
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
        design = get_design(logger=logger)
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


def _log_wcs_readback(setup, spec, logger):
    """Read the WCS-relevant params off the LIVE setup and log them, so
    the log shows what Fusion accepted vs. what the spec asked for.

    Why this matters: ``pi.set_choice`` and the entity/bool/expr setters
    all log on failure but go silent on success. When Fusion silently
    rejects a value (e.g. an unknown ``wcs_origin_boxPoint`` casing) and
    falls back to a default, the build looks fine in the log but the
    Setup dialog shows the wrong corner. This dump catches that.

    Format chosen for grep-ability: one line per param, ``WCS READBACK
    (<setup_name>) <param>=<value>  spec=<expected>``.
    """
    setup_name = spec.get('name', '<unnamed>')
    if setup is None:
        _log(logger, f"WCS READBACK ({setup_name}): setup is None; skipping", "WARNING")
        return
    try:
        params = setup.parameters
    except Exception as e:
        _log(logger, f"WCS READBACK ({setup_name}): setup.parameters raised: {e}", "WARNING")
        return

    # (param_name, spec_key) pairs. spec_key=None means "no expectation,
    # just dump the value". For axisX/axisY entity params, we report
    # whether ANY entity is bound rather than the entity itself (the
    # repr of a ConstructionAxis isn't useful in a log).
    fields = [
        ('wcs_origin_mode',         'wcs_origin'),
        ('wcs_orientation_mode',    'wcs_orient'),
        ('wcs_origin_boxPoint',     'box_point'),
        ('wcs_orientation_flipY',   'flip_y'),
        ('wcs_orientation_flipX',   None),
        ('wcs_orientation_flipZ',   None),
        ('job_stockMode',           'stock_intent'),
        ('job_stockOffsetTop',      'stock_offset_top'),
        ('job_stockOffsetSides',    'stock_offset_sides'),
        ('job_stockOffsetBottom',   'stock_offset_bottom'),
        ('job_continueMachining',   'continue_machining'),
    ]

    for pname, spec_key in fields:
        try:
            p = params.itemByName(pname)
        except Exception as e:
            _log(logger, f"WCS READBACK ({setup_name}): itemByName({pname}) raised: {e}", "DEBUG")
            continue
        if not p:
            # Param not present on this setup type — silent skip
            continue
        # Try expression first (most informative), fall back to value
        try:
            actual = p.expression
        except Exception:
            try:
                actual = str(p.value.value) if hasattr(p, 'value') else '<no value>'
            except Exception:
                actual = '<unreadable>'
        expected = repr(spec.get(spec_key)) if spec_key else '—'
        _log(logger,
             f"WCS READBACK ({setup_name}): {pname}={actual!r}  spec[{spec_key}]={expected}",
             "DEBUG")

    # Entity bindings: report "bound" / "not bound" rather than the repr,
    # which is a SWIG proxy string and useless for diagnostics.
    for ename in ('wcs_orientation_axisX', 'wcs_orientation_axisY'):
        try:
            p = params.itemByName(ename)
        except Exception:
            continue
        if not p:
            continue
        bound = '<unknown>'
        try:
            v = p.value.value
            if v is None:
                bound = 'not bound'
            elif hasattr(v, '__len__'):
                bound = f'bound ({len(v)} entity)' if len(v) else 'not bound'
            else:
                bound = 'bound (single)'
        except Exception as e:
            bound = f'<readback failed: {e}>'
        _log(logger,
             f"WCS READBACK ({setup_name}): {ename}={bound}",
             "DEBUG")

    # GEOMETRIC WCS — the ground truth that drives the on-screen triad.
    # Read straight from setup.workCoordinateSystem (a Matrix3D), which is
    # independent of the string-valued parameters above. If the JSON audit
    # exporter only walks `setup.parameters`, it can MISS this — and when
    # Fusion silently re-resolves a parameter the matrix is the only place
    # the truth shows up. Logging origin + axes in cm (Fusion's internal
    # units) so the values can be sanity-checked against the stock bbox
    # and matched up with the dialog's "Stock Width(X)/Depth(Y)/Height(Z)"
    # row directly.
    try:
        wcs = setup.workCoordinateSystem  # adsk.core.Matrix3D
    except Exception as e:
        _log(logger, f"WCS READBACK ({setup_name}): setup.workCoordinateSystem raised: {e}", "DEBUG")
        return
    if wcs is None:
        _log(logger, f"WCS READBACK ({setup_name}): workCoordinateSystem is None", "DEBUG")
        return
    try:
        origin, xAxis, yAxis, zAxis = wcs.getAsCoordinateSystem()
    except Exception as e:
        _log(logger, f"WCS READBACK ({setup_name}): getAsCoordinateSystem raised: {e}", "DEBUG")
        return

    def _vfmt(v):
        try:
            return f"({v.x:+.4f}, {v.y:+.4f}, {v.z:+.4f})"
        except Exception:
            return "<unreadable>"

    _log(logger, f"WCS READBACK ({setup_name}): geom.origin (cm)= {_vfmt(origin)}", "DEBUG")
    _log(logger, f"WCS READBACK ({setup_name}): geom.xAxis      = {_vfmt(xAxis)}", "DEBUG")
    _log(logger, f"WCS READBACK ({setup_name}): geom.yAxis      = {_vfmt(yAxis)}", "DEBUG")
    _log(logger, f"WCS READBACK ({setup_name}): geom.zAxis      = {_vfmt(zAxis)}", "DEBUG")


def _set_expr_param(params, name, expr, setup_name, logger):
    """Set a real-valued CAM parameter (e.g. ``job_stockOffsetTop``) to a
    Fusion expression string like ``'1 in'`` / ``'5 mm'`` / ``'0.25 in'``.

    These are unit-aware numeric parameters, distinct from choice/enum
    parameters (``set_choice``), entity-selection parameters
    (``_set_entity_param``), and booleans (``_set_bool_param``). The
    expression form is preferred over numeric ``.value`` so the user
    sees the typed expression in the dialog and units round-trip cleanly.
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
    try:
        param.expression = str(expr)
        _log(logger, f"SETUP BUILD ({setup_name}): {name} <- {expr!r}", "DEBUG")
        return True
    except Exception as e:
        _log(logger, f"SETUP BUILD ({setup_name}): set {name}={expr!r} failed: {e}", "WARNING")
        return False


# ---------------------------------------------------------------------------
# Generic mode -- one Setup per MM
# ---------------------------------------------------------------------------

def build_setups_generic(cam, mms_dict, logger=None, profile=None):
    """Generic mode: build one milling Setup per MM.

    When ``profile`` is supplied (a dict from the CAM Studio palette or
    the Cloudflare worker), its settings override the defaults below:

    * ``stockMode``       → stock intent (auto_bbox / fixed_size / …)
    * ``boxPoint``        → int 1-9 → Fusion box-point string
    * ``flipY``           → bool, WCS flip-Y toggle
    * ``clearanceHeight`` → mm, applied as ``clearanceHeight_offset``
    * ``retractHeight``   → mm, applied as ``retractHeight_offset``

    Operations in the profile are stored for reference; Fusion CAM
    operations require a resolved Tool object from the tool library and
    cannot be created purely from metadata here. Toolpaths are added by
    the user in the CAM workspace after generation.

    Parameters
    ----------
    cam : adsk.cam.CAM
    mms_dict : dict[str, ManufacturingModel]
        ``{component_name: ManufacturingModel}`` from
        :func:`cam_engine.mm_builder.build_mms_from_components`.
    profile : dict or None
        Optional profile dict from the palette. Keys that are absent or
        None fall back to sensible defaults.

    Returns
    -------
    list[tuple[str, adsk.cam.Setup]]
        ``[(component_name, Setup), ...]`` for each successfully built
        Setup. Missing entries indicate build failures (logged).
    """
    p = profile or {}

    # Resolve stock intent (profile uses 'auto_bbox' / 'fixed_size' etc.)
    stock_intent = p.get('stockMode') or 'auto_bbox'

    # Convert integer box-point to Fusion expression string.
    # Falls back to 'top 1' (top-left corner) if absent or unrecognised.
    box_int = p.get('boxPoint')
    box_point = _INT_TO_BOX_POINT.get(int(box_int), 'top 1') if box_int else 'top 1'

    flip_y = bool(p.get('flipY', False))

    # Heights in mm; None means "leave at Fusion default".
    clearance_mm = p.get('clearanceHeight')  # float or None
    retract_mm   = p.get('retractHeight')    # float or None

    _log(logger,
         f"SETUP BUILD GENERIC: profile → stock={stock_intent!r}  "
         f"box={box_point!r}  flipY={flip_y}  "
         f"clearance={clearance_mm} mm  retract={retract_mm} mm",
         "INFO")

    results = []
    for comp_name, mm in mms_dict.items():
        spec = {
            'name':         comp_name,
            'stock_intent': stock_intent,
            'wcs_origin':   'box_point',
            'wcs_orient':   'select_x_y',
            'box_point':    box_point,
            'flip_y':       flip_y,
        }
        # Pass heights so _build_setup_for_mm can apply them
        if clearance_mm is not None:
            spec['clearance_mm'] = float(clearance_mm)
        if retract_mm is not None:
            spec['retract_mm'] = float(retract_mm)

        setup = _build_setup_for_mm(cam, mm, spec, logger)
        if setup:
            results.append((comp_name, setup))
        else:
            _log(logger, f"SETUP BUILD GENERIC ({comp_name}): build returned None", "WARNING")
    return results


def _build_setup_for_mm(cam, mm, spec, logger=None):
    """Build one milling Setup bound to a specific MM.

    Mirrors the logic of :func:`build_setup` but takes an MM directly
    instead of looking it up from a rule dict. Used by generic mode.
    """
    setup_name = spec.get('name', '<unnamed>')

    try:
        setup_input = cam.setups.createInput(adsk.cam.OperationTypes.MillingOperation)
    except Exception as e:
        _log(logger, f"SETUP BUILD GENERIC ({setup_name}): createInput raised: {e}", "ERROR")
        return None

    if setup_input is None:
        _log(logger, f"SETUP BUILD GENERIC ({setup_name}): createInput returned None", "ERROR")
        return None

    try:
        bodies = _collect_bodies(mm)
        if bodies:
            setup_input.models = bodies
        _log(logger, f"SETUP BUILD GENERIC ({setup_name}): bound {len(bodies)} bodies", "DEBUG")
    except Exception as e:
        _log(logger, f"SETUP BUILD GENERIC ({setup_name}): models bind failed: {e}", "WARNING")

    try:
        setup = cam.setups.add(setup_input)
    except Exception as e:
        _log(logger, f"SETUP BUILD GENERIC ({setup_name}): setups.add raised: {e}", "ERROR")
        return None

    if setup is None:
        _log(logger, f"SETUP BUILD GENERIC ({setup_name}): setups.add returned None", "ERROR")
        return None

    try:
        setup.name = setup_name
    except Exception as e:
        _log(logger, f"SETUP BUILD GENERIC ({setup_name}): name set failed: {e}", "WARNING")

    try:
        _set_stock_mode(setup, spec['stock_intent'], setup_name, logger)
    except Exception as e:
        _log(logger, f"SETUP BUILD GENERIC ({setup_name}): stockMode raised: {e}", "WARNING")

    # WCS: same write order as build_setup (mode → orientation → axes → flipY → boxPoint)
    try:
        pi.set_choice(setup.parameters, 'wcs_origin_mode',
                      pi.WCS_ORIGIN_MODE_CANDIDATES[spec['wcs_origin']], logger)
        pi.set_choice(setup.parameters, 'wcs_orientation_mode',
                      pi.WCS_ORIENTATION_CANDIDATES[spec['wcs_orient']], logger)
    except Exception as e:
        _log(logger, f"SETUP BUILD GENERIC ({setup_name}): WCS mode set raised: {e}", "WARNING")

    if spec.get('wcs_orient') == 'select_x_y':
        x_axis, y_axis = _get_origin_axes(logger)
        if y_axis is not None:
            _set_entity_param(setup.parameters, 'wcs_orientation_axisX',
                              y_axis, setup_name, logger)
        if x_axis is not None:
            _set_entity_param(setup.parameters, 'wcs_orientation_axisY',
                              x_axis, setup_name, logger)

    if spec.get('flip_y'):
        _set_bool_param(setup.parameters, 'wcs_orientation_flipY', True,
                        setup_name, logger)

    if spec.get('box_point'):
        pt = spec['box_point']
        pi.set_choice(setup.parameters, 'wcs_origin_boxPoint',
                      [pt, pt.replace(' ', ''), pt.replace(' ', '_')], logger)

    # Clearance / retract heights from profile (mm → Fusion expression string).
    # Written last so WCS is fully resolved first. The parameter names are
    # operation-level in some Fusion builds; we try setup-level first and
    # fall back silently.  Expressed as '5 mm' to avoid unit-ambiguity.
    if spec.get('clearance_mm') is not None:
        cl_expr = f"{spec['clearance_mm']} mm"
        for pname in ('clearanceHeight_offset', 'job_clearanceHeight'):
            if _set_expr_param(setup.parameters, pname, cl_expr, setup_name, logger):
                break

    if spec.get('retract_mm') is not None:
        rt_expr = f"{spec['retract_mm']} mm"
        for pname in ('retractHeight_offset', 'job_retractHeight'):
            if _set_expr_param(setup.parameters, pname, rt_expr, setup_name, logger):
                break

    try:
        mm_name = mm.name
    except Exception:
        mm_name = '<unknown>'
    _log(logger, f"SETUP BUILD GENERIC ({setup_name}): created -> MM '{mm_name}'")
    return setup


def _log(logger, msg, level="INFO"):
    if logger is None:
        return
    try:
        logger.log(msg, level)
    except Exception:
        pass
