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
        # Cloud toolpath templates dropped into this setup at build time so
        # the user doesn't have to wire up "Pocket back" and "Morphed Spiral"
        # by hand every project. Each entry is the leaf filename of a
        # CAMTemplate in the user's cloud library (cloud:// URL space).
        # See `_apply_cloud_templates` below.
        'cloud_templates': [
            'Pocket back.f3dhsm-template',
            'Morphed Spiral.f3dhsm-template',
        ],
    },
    {
        'name':         'B-spline Top',
        'mm_rule':      'bspline_set',
        # 'from_prev_setup' tells Fusion to inherit the stock state from
        # the previous setup's IPV (in-process view) — i.e. the material
        # left behind after B-spline Back has cut its pocket. Combined
        # with continue_machining=True below, this gives the user
        # automatic rest machining: Top only cuts what Back didn't reach.
        # Resolves to adsk.cam.SetupStockModes.FromPreviousSetup at build.
        'stock_intent': 'from_prev_setup',
        'wcs_origin':   'box_point',          # corner of stock bbox (flipY handles second side)
        'wcs_orient':   'select_x_y',         # axesXY -- same axes as Back, flipped Y
        'box_point':    'top 1',              # verified from audit JSON -- same corner
        'flip_y':       True,
        # Rest machining: Fusion subtracts the prior setup's removed
        # material so Top's toolpaths skip already-machined regions.
        'continue_machining': True,
        # B-spline Top default templates. "Front" in the cloud library's
        # naming maps to the panel's top-side (the face that becomes the
        # visible/top after the flipY between Back and Top setups), so
        # 'Pocket front FRED' is the top-side analogue of 'Pocket back'.
        # 'Pocket front deloge FRED' runs LAST as a finishing/cleanup
        # pass that dislodges remaining stock the earlier ops left
        # behind — must come after both the main pocket and the morphed
        # spiral so the IPV it sees is the fully-roughed-out state.
        'cloud_templates': [
            'Pocket front FRED.f3dhsm-template',
            'Morphed Spiral.f3dhsm-template',
            'Pocket front deloge FRED.f3dhsm-template',
        ],
    },
    {
        'name':         'Frame',
        'mm_rule':      'frame',
        'stock_intent': 'fixed_box',
        'wcs_origin':   'box_point',
        'wcs_orient':   'select_x_y',         # axesXY -- same axes swap as Stock/Back/Top
        'box_point':    'top 1',
        'flip_y':       True,                 # Z up to match Stock and B-spline Top
        # Frame templates: the user's two 'cadre' presets (French for frame).
        # They're cloud-stored and tuned for the frame's flat profile cut.
        'cloud_templates': [
            'cadre Pocket 4.f3dhsm-template',
            'cadre Morphed Spiral 3.f3dhsm-template',
        ],
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

    # Apply cloud toolpath templates declared in the spec (e.g. 'Pocket back',
    # 'Morphed Spiral' for B-spline Back), or the user's per-project override
    # if they edited the list via the template-browser UI. Best-effort:
    # a template that's missing from the cloud library logs WARNING but
    # doesn't fail the whole setup build.
    try:
        from . import template_assignments as _tpl_overrides
        design = adsk.fusion.Design.cast(cam.parentDocument.products.itemByProductType('DesignProductType'))
        cloud_templates = _tpl_overrides.resolve_templates(
            design, spec['name'], spec.get('cloud_templates') or [])
    except Exception as e:
        _log(logger,
             f"SETUP BUILD ({spec['name']}): override lookup failed ({e}); using spec defaults",
             "WARNING")
        cloud_templates = spec.get('cloud_templates') or []
    if cloud_templates:
        _apply_cloud_templates(setup, cloud_templates, spec['name'], logger)

    return setup


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _rename_created_operations(results, base_name, setup_name, logger):
    """Rename every Operation in ``results`` to ``base_name`` (or
    ``base_name (N)`` if Fusion balks at a duplicate). Folders and
    patterns are left alone — their rename behaviour is inconsistent
    across builds and the user usually wants those as containers anyway.

    Returns the count successfully renamed.

    Why per-op rather than per-template: a template can stamp out more
    than one operation in one shot. Each gets the same base name with
    an incrementing suffix so they stay grouped visually in the tree.
    """
    if not results:
        return 0
    # Lazy import to avoid a circular at module-load (adsk.cam touches
    # heavy types). adsk is already in scope at the module level via the
    # earlier `import adsk.cam`, but the isinstance check needs the type.
    OperationType = getattr(adsk.cam, 'Operation', None)
    renamed = 0
    used_suffix = 0
    for entry in results:
        if OperationType is None or not isinstance(entry, OperationType):
            continue
        # Fusion is picky: assigning a name that already exists in the
        # setup throws "Name conflict". Walk up suffixes until we land
        # one that doesn't collide.
        candidate = base_name if used_suffix == 0 else f'{base_name} ({used_suffix})'
        while True:
            try:
                entry.name = candidate
                renamed += 1
                used_suffix += 1
                break
            except Exception as e:
                # Most likely a name collision; bump suffix and retry. Cap at
                # 50 attempts so a Fusion-side bug can't loop forever.
                used_suffix += 1
                candidate = f'{base_name} ({used_suffix})'
                if used_suffix > 50:
                    _log(logger,
                         f"SETUP BUILD ({setup_name}): rename gave up after 50 attempts "
                         f"for {base_name!r}: {e}",
                         "WARNING")
                    break
    return renamed


def _apply_cloud_templates(setup, template_leaf_names, setup_name, logger):
    """Pull each named template from the user's cloud CAM library and stamp
    its operations into ``setup`` via Setup.createFromCAMTemplate.

    ``template_leaf_names`` is a list of leaf filenames as they appear in
    Fusion's CAM cloud library (the ``cloud://`` URL space — same names
    the user sees in the Templates dropdown of the CAM workspace). Each
    must end in ``.f3dhsm-template``; we don't add it automatically so
    typos surface as missing-template warnings rather than silent skips.
    Missing templates log WARNING and are skipped; the rest still apply.

    Returns the count of templates successfully applied."""
    if not template_leaf_names:
        return 0
    try:
        cam_mgr = adsk.cam.CAMManager.get()
        tpl_lib = cam_mgr.libraryManager.templateLibrary
        cloud_root = tpl_lib.urlByLocation(adsk.cam.LibraryLocations.CloudLibraryLocation)
    except Exception as e:
        _log(logger,
             f"SETUP BUILD ({setup_name}): cloud library unavailable ({e}); "
             f"skipping {len(template_leaf_names)} template(s)",
             "WARNING")
        return 0
    if not cloud_root:
        _log(logger,
             f"SETUP BUILD ({setup_name}): no cloud library configured; "
             f"skipping {len(template_leaf_names)} template(s)",
             "WARNING")
        return 0

    # Index the cloud library's child assets by leaf name once so we don't
    # walk the URL list per-template.
    try:
        cloud_assets = {url.leafName: url for url in tpl_lib.childAssetURLs(cloud_root)}
    except Exception as e:
        _log(logger, f"SETUP BUILD ({setup_name}): childAssetURLs failed: {e}", "WARNING")
        return 0

    applied = 0
    for leaf in template_leaf_names:
        url = cloud_assets.get(leaf)
        if not url:
            _log(logger,
                 f"SETUP BUILD ({setup_name}): cloud template {leaf!r} not found "
                 f"(available: {sorted(cloud_assets.keys())[:5]}...) — skipping",
                 "WARNING")
            continue
        try:
            tpl = tpl_lib.templateAtURL(url)
            results = setup.createFromCAMTemplate(tpl)
            # Fusion names each created Operation from whatever the template
            # author saved it with — usually lowercase boilerplate like
            # "pocket back" or auto-suffixed re-uses like "Morphed Spiral2 (2)".
            # Rename to the template's leaf filename (sans .f3dhsm-template)
            # so the user immediately sees which template created the op
            # and the names stay consistent across projects. If a folder
            # / pattern slips through it just keeps its Fusion-given name
            # (rename API isn't reliable on those types).
            base_name = leaf[:-len('.f3dhsm-template')] if leaf.endswith('.f3dhsm-template') else leaf
            renamed = _rename_created_operations(results, base_name, setup_name, logger)
            _log(logger,
                 f"SETUP BUILD ({setup_name}): applied {leaf!r} -> "
                 f"{len(results)} item(s); renamed {renamed} -> {base_name!r}")
            applied += 1
            _log(logger, f"APPLY TEMPLATES CKPT: post-apply, continuing loop ({setup_name})", "DEBUG")
        except Exception as e:
            _log(logger,
                 f"SETUP BUILD ({setup_name}): createFromCAMTemplate({leaf!r}) failed: {e}",
                 "WARNING")
    _log(logger, f"APPLY TEMPLATES CKPT: function returning applied={applied} ({setup_name})", "DEBUG")
    return applied




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
# Generic mode — N-sided indexed machining workflow
# ---------------------------------------------------------------------------
#
# An "indexed" job machines one component from multiple orientations by
# physically rotating the part on the table between Setups. Each side
# carries an axis (X/Y/Z) and an angle in degrees; the dispatcher fans
# out one Setup per (MM × side) and applies the rotation to the WCS.
#
# Side A at 0° is the default; missing/empty 'sides' falls back to a
# single-side run that's behaviourally identical to the pre-refactor
# one-Setup-per-MM flow.
#
# Rotation support, by axis:
#   • Z (vertical, around the table)  — fully supported, any angle.
#       Implemented by creating two perpendicular sketch lines at the
#       desired angle in a hidden rotation sketch, then binding them
#       as wcs_orientation_axisX / axisY. The most common case for
#       indexed work on a 3-axis machine (Ultimate Bee + fixturing).
#   • X / Y axis, 180°                — supported via flipX/flipY/flipZ
#       combos on the WCS orientation. Useful for "flip the part over".
#   • X / Y axis, arbitrary angle     — not yet expressible via the
#       parameter-driven WCS alone. The Setup is still created (with
#       no rotation) and a WARNING is logged; the user can then re-
#       orient that Setup interactively in the CAM dialog.
# ---------------------------------------------------------------------------

# Default sides list when the profile omits 'sides' entirely. One side at
# 0° = behaviourally identical to the pre-refactor one-Setup-per-MM flow.
_DEFAULT_SIDES = [{'name': 'A', 'axis': 'Z', 'angleDeg': 0.0}]


def build_setups_generic(cam, mms_dict, logger=None, profile=None):
    """Generic mode: for each MM, build one Setup per side.

    Indexed machining workflow — a single component can be machined from
    multiple orientations by physically rotating the part on the table.
    Each side in the profile produces one Setup bound to the (shared) MM
    of that component.

    Profile keys
    ------------
    stockMode        : str   — 'auto_bbox' / 'fixed_size' / etc. Applied
                                to the FIRST side only; subsequent sides
                                auto-cascade to 'from_prev_setup'.
    boxPoint         : int   — 1-9 stock-box corner (see _INT_TO_BOX_POINT)
    flipY            : bool  — applied to every side (independent of rotation)
    clearanceHeight  : float — mm, applied as clearanceHeight_offset
    retractHeight    : float — mm, applied as retractHeight_offset
    sides            : list  — [{name, axis, angleDeg, ...}, ...]; defaults
                                to a single Side A at 0° when absent/empty.
                                Each side may also carry optional overrides:
                                  'stockMode'         (str) — pin this side's
                                                              stock intent
                                  'continueMachining' (bool) — override the
                                                              rest-machining
                                                              auto-cascade
    operations       : list  — stored for reference; toolpaths still
                                added manually by the user.

    Stock auto-cascade
    ------------------
    Indexed jobs want each successive orientation to pick up where the
    previous one stopped — only cutting the material the prior setup
    left behind. The dispatcher auto-applies that pattern:

        Side index 0      → stockMode  = profile.stockMode
                            continueMachining = False
        Side index ≥ 1    → stockMode  = 'from_prev_setup'
                            continueMachining = True

    Either field can be overridden per-side via the side dict's
    'stockMode' / 'continueMachining' keys.

    Returns
    -------
    list[tuple[str, adsk.cam.Setup]]
        ``[(comp_name, Setup), ...]`` — one entry per built Setup. A
        component with N sides appears N times. ``comp_name`` is the
        bare component name (NOT the formatted Setup name with the
        side suffix) so the coordinator's per-component success check
        (``name in built_names``) keeps working unchanged. The Setup's
        actual display name lives on ``setup.name`` and is built by
        :func:`_format_setup_name`.
    """
    p = profile or {}

    stock_intent = p.get('stockMode') or 'auto_bbox'

    box_int = p.get('boxPoint')
    box_point = _INT_TO_BOX_POINT.get(int(box_int), 'top 1') if box_int else 'top 1'

    flip_y = bool(p.get('flipY', False))

    clearance_mm = p.get('clearanceHeight')  # float or None
    retract_mm   = p.get('retractHeight')    # float or None

    sides_raw = p.get('sides') or _DEFAULT_SIDES
    sides = [_normalise_side(s, i) for i, s in enumerate(sides_raw)]

    _log(logger,
         f"SETUP BUILD GENERIC: profile → stock={stock_intent!r}  "
         f"box={box_point!r}  flipY={flip_y}  "
         f"clearance={clearance_mm} mm  retract={retract_mm} mm  "
         f"sides={len(sides)} "
         f"({', '.join(_side_label(s) for s in sides)})",
         "INFO")

    results = []
    for comp_name, mm in mms_dict.items():
        for side_idx, side in enumerate(sides):
            setup_name = _format_setup_name(comp_name, side, len(sides))

            # Auto-cascade stock for indexed runs:
            #   Side 0 (first)    → profile.stockMode  (start from the raw
            #                       blank, fixed_size or auto_bbox etc.)
            #   Side ≥1 (others)  → from_prev_setup + continueMachining=True
            #                       (each side picks up where the previous
            #                       one left off and only cuts the rest of
            #                       the material).
            # A side dict can override either field with its own
            # 'stockMode' / 'continueMachining' for the rare case where
            # auto-cascade doesn't fit.
            side_stock_override = side.get('stockMode')
            if side_stock_override:
                side_stock_intent = side_stock_override
            elif side_idx == 0:
                side_stock_intent = stock_intent
            else:
                side_stock_intent = 'from_prev_setup'

            side_rest_override = side.get('continueMachining')
            if side_rest_override is None:
                # Default: every side after the first does rest machining.
                side_continue_machining = (side_idx > 0)
            else:
                side_continue_machining = bool(side_rest_override)

            spec = {
                'name':               setup_name,
                'comp_name':          comp_name,
                'side':               side,
                'side_idx':           side_idx,
                'stock_intent':       side_stock_intent,
                'continue_machining': side_continue_machining,
                'wcs_origin':         'box_point',
                'wcs_orient':         'select_x_y',
                'box_point':          box_point,
                'flip_y':             flip_y,
            }
            if clearance_mm is not None:
                spec['clearance_mm'] = float(clearance_mm)
            if retract_mm is not None:
                spec['retract_mm'] = float(retract_mm)

            setup = _build_setup_for_mm(cam, mm, spec, logger)
            if setup:
                # Return comp_name (NOT setup_name) so the coordinator's
                # per-component success check `name in built_names` still
                # works for multi-side runs. The displayed Setup name
                # lives on setup.name (set inside _build_setup_for_mm).
                results.append((comp_name, setup))
            else:
                _log(logger,
                     f"SETUP BUILD GENERIC ({setup_name}): build returned None",
                     "WARNING")
    return results


def _normalise_side(side, index):
    """Coerce a side dict from the palette/profile into canonical form
    ``{'name': str, 'axis': 'X'|'Y'|'Z', 'angleDeg': float}``.

    Fills in safe defaults so a malformed entry doesn't blow up the
    dispatch loop:
      * missing name → 'A' / 'B' / 'C' by index (A=0, B=1, …)
      * missing or unrecognised axis → 'Z'
      * non-numeric angle → 0.0
    """
    if not isinstance(side, dict):
        side = {}
    name = str(side.get('name') or chr(ord('A') + (index % 26)))
    axis_raw = str(side.get('axis') or 'Z').upper()
    axis = axis_raw if axis_raw in ('X', 'Y', 'Z') else 'Z'
    try:
        angle = float(side.get('angleDeg', 0.0))
    except (TypeError, ValueError):
        angle = 0.0
    return {'name': name, 'axis': axis, 'angleDeg': angle}


def _side_label(side):
    """Compact label for logging: ``'A'`` (no rotation) or ``'B@30°Z'``."""
    angle = side.get('angleDeg', 0.0)
    if angle == 0.0:
        return side['name']
    return f"{side['name']}@{angle:g}°{side['axis']}"


def _format_setup_name(comp_name, side, total_sides):
    """Format the Setup name shown in the CAM tree.

    Single-side runs preserve the bare component name (back-compat with
    the pre-refactor one-Setup-per-MM flow). Multi-side runs encode the
    side name and any non-zero rotation::

        BPanel               (1 side, 0°)
        BPanel · A           (multi-side, 0°)
        BPanel · B 30°Z      (multi-side, rotated)
    """
    if total_sides <= 1 and side.get('angleDeg', 0.0) == 0.0:
        return comp_name
    name = side['name']
    angle = side.get('angleDeg', 0.0)
    if angle == 0.0:
        return f"{comp_name} · {name}"
    axis = side.get('axis', 'Z')
    return f"{comp_name} · {name} {angle:g}°{axis}"


def _build_setup_for_mm(cam, mm, spec, logger=None):
    """Build one milling Setup bound to a specific MM, for one side.

    The MM is shared across all sides of the same component — every side
    binds to the same body list, the same parametric updates, the same
    stock. What varies is the WCS orientation: the side's rotation is
    applied via ``_resolve_side_axes`` (axis bindings) and
    ``_apply_side_axis_flips`` (180° flips for X/Y indexing).
    """
    setup_name = spec.get('name', '<unnamed>')
    side = spec.get('side') or dict(_DEFAULT_SIDES[0])

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

    # WCS write order (same as build_setup): mode → orientation → axes
    # → flipY → boxPoint. The per-side rotation slots in BETWEEN axes
    # and box-point — the axes bind to rotated sketch lines (Z-axis
    # rotation) and the flips happen via _apply_side_axis_flips
    # (180° about X or Y).
    try:
        pi.set_choice(setup.parameters, 'wcs_origin_mode',
                      pi.WCS_ORIGIN_MODE_CANDIDATES[spec['wcs_origin']], logger)
        pi.set_choice(setup.parameters, 'wcs_orientation_mode',
                      pi.WCS_ORIENTATION_CANDIDATES[spec['wcs_orient']], logger)
    except Exception as e:
        _log(logger, f"SETUP BUILD GENERIC ({setup_name}): WCS mode set raised: {e}", "WARNING")

    # Bind X/Y axes — rotated for Z-axis indexing, default origin axes
    # otherwise. The X/Y param swap (yAxis → axisX, xAxis → axisY)
    # matches the Fusion-quirk binding used by the hardcoded path.
    if spec.get('wcs_orient') == 'select_x_y':
        x_axis, y_axis = _resolve_side_axes(side, setup_name, logger)
        if y_axis is not None:
            _set_entity_param(setup.parameters, 'wcs_orientation_axisX',
                              y_axis, setup_name, logger)
        if x_axis is not None:
            _set_entity_param(setup.parameters, 'wcs_orientation_axisY',
                              x_axis, setup_name, logger)

    # Profile-level flipY — applied to every side equally (independent
    # of the per-side rotation). Lets the user say "I always want Z
    # pointing down for this job" without baking it into each side.
    if spec.get('flip_y'):
        _set_bool_param(setup.parameters, 'wcs_orientation_flipY', True,
                        setup_name, logger)

    # Side-specific 180° rotations that can't be encoded in axis
    # bindings alone (flipX/flipZ combos for X/Y indexing). Z-axis
    # rotation is fully handled by the rotated axis bindings above
    # and is a no-op here.
    _apply_side_axis_flips(setup, side, setup_name, logger)

    if spec.get('box_point'):
        pt = spec['box_point']
        pi.set_choice(setup.parameters, 'wcs_origin_boxPoint',
                      [pt, pt.replace(' ', ''), pt.replace(' ', '_')], logger)

    # Continue rest machining — when True, the setup only cuts material
    # left over by the previous setup instead of re-cutting solved volume.
    # In indexed mode this is auto-enabled for every side after the first
    # (see build_setups_generic auto-cascade) so each rotated orientation
    # picks up exactly where the previous one left off.
    if spec.get('continue_machining') is not None:
        _set_bool_param(setup.parameters, 'job_continueMachining',
                        bool(spec['continue_machining']),
                        setup_name, logger)

    # Clearance / retract heights from profile (mm → Fusion expression
    # string). Written last so WCS is fully resolved first. Parameter
    # names are operation-level in some Fusion builds; try setup-level
    # first and fall back silently.
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
    _log(logger,
         f"SETUP BUILD GENERIC ({setup_name}): created -> MM '{mm_name}' "
         f"side={_side_label(side)} "
         f"stock={spec['stock_intent']} "
         f"rest={bool(spec.get('continue_machining'))}")
    return setup


# ---------------------------------------------------------------------------
# Side rotation primitives
# ---------------------------------------------------------------------------

def _resolve_side_axes(side, setup_name, logger):
    """Return ``(xAxis, yAxis)`` reference entities for this side's WCS.

    For a side with angle 0° or with axis ∈ {X, Y} (those use 180°
    flips, see :func:`_apply_side_axis_flips`), returns the root
    component's default origin xAxis / yAxis (ConstructionAxis).

    For a Z-axis rotation of ``angleDeg``, finds-or-creates a hidden
    sketch ``__cam_idx_rot_{angle}Z`` in the root component holding two
    perpendicular sketch lines at the rotated angles. Returns those
    SketchLines for the WCS axesXY orientation to bind to, which
    physically rotates the WCS about Z by the desired angle.

    Sketch geometry is preferred over rotated ConstructionAxis here
    because ``ConstructionAxisInput.setByTwoPoints`` expects anchored
    point entities (Vertex / SketchPoint / ConstructionPoint), not
    bare ``Point3D`` instances — sketch lines side-step that whole
    plumbing.
    """
    angle = float(side.get('angleDeg', 0.0))
    axis_kind = str(side.get('axis', 'Z')).upper()

    # No rotation, or X/Y rotation (handled later via flips) → default axes
    if angle == 0.0 or axis_kind != 'Z':
        return _get_origin_axes(logger)

    try:
        design = get_design(logger=logger)
        if design is None:
            _log(logger,
                 f"SETUP BUILD GENERIC ({setup_name}): no Design for side "
                 f"rotation; falling back to origin axes",
                 "WARNING")
            return _get_origin_axes(logger)
        root = design.rootComponent

        x_line, y_line = _find_or_create_rotation_sketch(
            root, angle, setup_name, logger)
        if x_line is None or y_line is None:
            _log(logger,
                 f"SETUP BUILD GENERIC ({setup_name}): rotation sketch "
                 f"creation failed; falling back to origin axes",
                 "WARNING")
            return _get_origin_axes(logger)
        return (x_line, y_line)
    except Exception as e:
        _log(logger,
             f"SETUP BUILD GENERIC ({setup_name}): _resolve_side_axes "
             f"raised: {e}; falling back to origin axes",
             "WARNING")
        return _get_origin_axes(logger)


def _find_or_create_rotation_sketch(root, angle_deg, setup_name, logger):
    """Find (or create) a hidden sketch on the XY plane carrying two
    perpendicular reference lines for a Z-axis indexed rotation.

    The sketch is named ``__cam_idx_rot_{angle}Z`` (idempotent — repeat
    runs of the CAM Builder reuse it). It contains:

      * Line 1: from (0,0) at angle ``angle_deg`` from +X (length 10 cm)
      * Line 2: from (0,0) at angle ``angle_deg + 90°`` (length 10 cm)

    Both lines are returned as ``(xLine, yLine)``. They serve as the
    rotated-X and rotated-Y direction references for the WCS axesXY
    orientation. Sketch visibility is toggled off where supported so
    the rotation references don't clutter the design view.
    """
    import math
    sketch_name = f"__cam_idx_rot_{angle_deg:g}Z"

    # Look for an existing rotation sketch
    target = None
    try:
        for s in root.sketches:
            if s.name == sketch_name:
                target = s
                break
    except Exception:
        pass

    if target is not None:
        # Reuse: assume the first two sketchLines are our X' and Y'.
        # This is safe because the sketch is __cam_-prefixed and we own it.
        try:
            lines = list(target.sketchCurves.sketchLines)
            if len(lines) >= 2:
                return (lines[0], lines[1])
        except Exception as e:
            _log(logger,
                 f"SETUP BUILD GENERIC ({setup_name}): reuse rotation "
                 f"sketch '{sketch_name}' failed: {e}",
                 "WARNING")
        # If the existing sketch is malformed, fall through and try
        # creating a fresh one (with a slightly different name to
        # avoid Fusion's duplicate-name rejection).
        sketch_name = f"{sketch_name}_v2"

    try:
        sk = root.sketches.add(root.xYConstructionPlane)
        try:
            sk.name = sketch_name
        except Exception:
            pass

        theta = math.radians(angle_deg)
        origin = adsk.core.Point3D.create(0.0, 0.0, 0.0)
        # 10cm length — long enough that Fusion clearly resolves the
        # direction; short enough to stay out of the way visually
        # (sketch is hidden anyway, but defensive).
        x_end = adsk.core.Point3D.create(math.cos(theta) * 10.0,
                                          math.sin(theta) * 10.0, 0.0)
        y_end = adsk.core.Point3D.create(-math.sin(theta) * 10.0,
                                          math.cos(theta) * 10.0, 0.0)
        x_line = sk.sketchCurves.sketchLines.addByTwoPoints(origin, x_end)
        y_line = sk.sketchCurves.sketchLines.addByTwoPoints(origin, y_end)
        try:
            sk.isVisible = False
        except Exception:
            pass

        _log(logger,
             f"SETUP BUILD GENERIC ({setup_name}): created rotation sketch "
             f"'{sketch_name}' @ {angle_deg:g}°Z",
             "DEBUG")
        return (x_line, y_line)
    except Exception as e:
        _log(logger,
             f"SETUP BUILD GENERIC ({setup_name}): rotation sketch create "
             f"raised: {e}",
             "WARNING")
        return (None, None)


def _apply_side_axis_flips(setup, side, setup_name, logger):
    """Apply X / Y axis rotations via the WCS flip parameters.

    180° rotations about X or Y map cleanly to flipX/flipY/flipZ combos
    on the WCS orientation:

      * 180° about X  → flipY + flipZ  (Y → -Y, Z → -Z)
      * 180° about Y  → flipX + flipZ  (X → -X, Z → -Z)

    Other angles about X or Y aren't expressible via the parameter-
    driven WCS alone — they need a tilted construction plane and a
    custom orientation mode. For now we log a WARNING and create the
    Setup unrotated; the user can re-orient it interactively in the
    CAM dialog (or rotate about Z, which IS fully supported).

    Z-axis rotation is handled by :func:`_resolve_side_axes` (rotated
    sketch lines) and is a no-op here.
    """
    angle = float(side.get('angleDeg', 0.0))
    axis_kind = str(side.get('axis', 'Z')).upper()

    if axis_kind == 'Z' or angle == 0.0:
        return  # handled in _resolve_side_axes, or no-op

    if abs(angle - 180.0) < 1e-6:
        if axis_kind == 'X':
            _set_bool_param(setup.parameters, 'wcs_orientation_flipY', True,
                            setup_name, logger)
            _set_bool_param(setup.parameters, 'wcs_orientation_flipZ', True,
                            setup_name, logger)
        elif axis_kind == 'Y':
            _set_bool_param(setup.parameters, 'wcs_orientation_flipX', True,
                            setup_name, logger)
            _set_bool_param(setup.parameters, 'wcs_orientation_flipZ', True,
                            setup_name, logger)
        return

    _log(logger,
         f"SETUP BUILD GENERIC ({setup_name}): {angle:g}°{axis_kind} rotation "
         f"not expressible via WCS flips; Setup created unrotated. Either "
         f"re-orient in the CAM dialog, or rotate about Z (fully supported).",
         "WARNING")


def _log(logger, msg, level="INFO"):
    if logger is None:
        return
    try:
        logger.log(msg, level)
    except Exception:
        pass
