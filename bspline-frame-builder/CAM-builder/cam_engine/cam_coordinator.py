"""Top-level CAM-builder orchestrator.

Single entry point the UI calls when the user clicks **Generate CAM
Setups**. Responsibilities:

  1. Acquire the CAM product (else fail with a UI-visible error).
  2. Build the 3 Manufacturing Models.
  3. Build the 4 Setups bound to those MMs.
  4. Return a structured report so the palette can show pass/fail per
     row.

Mirrors the role ``solid_coordinator`` plays in ``frame-builder``: a
thin shell that sequences the engine modules and centralises error
handling. Engine modules stay UI-agnostic; everything user-facing
flows back through the report dict.
"""

import adsk.core
import adsk.fusion

from . import cam_workspace, mm_builder, setup_builder


# Names of MMs and Setups this addin creates. Used by _cleanup_previous_build
# to identify and delete the prior run's artifacts before a fresh build.
_ADDIN_MM_NAMES = frozenset([
    'MM - Stock (raw blank)',
    'MM - B-spline set',
    'MM - Frame (lay-flat)',
])
_ADDIN_SETUP_NAMES = frozenset([
    'Stock',
    'B-spline Back',
    'B-spline Top',
    'Frame',
])


def _cleanup_previous_build(cam, logger):
    """Delete any prior build's Setups and MMs that match our known names.

    Setups must be deleted before MMs because Setups reference bodies
    inside MMs (an MM with a dangling Setup reference can leave Fusion's
    CAM tree in an inconsistent state on the next build attempt).

    Best-effort: failures log WARNING but don't abort the build. The
    subsequent ``build_all_mms`` / ``build_all_setups`` will produce
    NEW items even if some old ones survive (you'll just end up with
    duplicates, same as before this cleanup existed).
    """
    n_setups_deleted = 0
    n_mms_deleted = 0

    # Pass 1: delete Setups with matching names. Iterate backward because
    # cam.setups is a live collection and deleteMe() mutates it.
    try:
        n = cam.setups.count
        _log(logger, f"CLEANUP: scanning {n} existing setup(s)", "DEBUG")
        for i in range(n - 1, -1, -1):
            s = cam.setups.item(i)
            try:
                if s.name in _ADDIN_SETUP_NAMES:
                    _log(logger, f"CLEANUP: deleting Setup '{s.name}'", "DEBUG")
                    s.deleteMe()
                    n_setups_deleted += 1
            except Exception as e:
                _log(logger, f"CLEANUP: deleteMe Setup at [{i}] raised: {type(e).__name__}: {e}", "WARNING")
    except Exception as e:
        _log(logger, f"CLEANUP: setup scan raised: {type(e).__name__}: {e}", "WARNING")

    # Pass 2: delete MMs with matching names.
    try:
        n = cam.manufacturingModels.count
        _log(logger, f"CLEANUP: scanning {n} existing MM(s)", "DEBUG")
        for i in range(n - 1, -1, -1):
            mm = cam.manufacturingModels.item(i)
            try:
                if mm.name in _ADDIN_MM_NAMES:
                    _log(logger, f"CLEANUP: deleting MM '{mm.name}'", "DEBUG")
                    mm.deleteMe()
                    n_mms_deleted += 1
            except Exception as e:
                _log(logger, f"CLEANUP: deleteMe MM at [{i}] raised: {type(e).__name__}: {e}", "WARNING")
    except Exception as e:
        _log(logger, f"CLEANUP: MM scan raised: {type(e).__name__}: {e}", "WARNING")

    _log(logger, f"CLEANUP: deleted {n_setups_deleted} setup(s) and {n_mms_deleted} MM(s) from prior build", "INFO")


def _log(logger, msg, level="INFO"):
    if logger is None:
        return
    try:
        logger.log(msg, level)
    except Exception:
        pass


def run(classifier, app=None, logger=None, mode='bspline', component_names=None, profile=None, skip_templates=False, skip_machine=False):
    """Run the full pipeline.

    Parameters
    ----------
    classifier : callable
        Body-classifier function ``(BRepBody) -> str``. Used only in
        B-spline mode; ignored in generic mode.
    mode : str
        ``'bspline'`` (default) — hardcoded 3-MM / 4-setup B-spline
        pipeline. ``'generic'`` — one MM + Setup per component name in
        ``component_names``.
    component_names : list[str] or None
        Required when ``mode='generic'``. Top-level component names to
        build MMs for (from the palette's SCAN result).

    Returns
    -------
    dict
        ::

            {
              'ok': bool,
              'mode': str,
              'cam_acquired': bool,
              'mms': {name: bool, ...},
              'setups': [{'name': str, 'ok': bool}, ...],
              # Indexed-mode extras (generic mode only):
              'setups_built': int,      # total Setups created (= comps × sides)
              'setups_expected': int,   # total Setups expected to be created
              'errors': [str, ...],
            }
    """
    report = {
        'ok': False,
        'mode': mode,
        'cam_acquired': False,
        'mms': {},
        'setups': [],
        'errors': [],
    }

    app = app or adsk.core.Application.get()

    # First try a cheap acquire — if Manufacture is already active (or the
    # document already has a CAM product cached) this is a no-op fast path.
    cam = cam_workspace.acquire_cam(app=app, logger=logger)

    # If not, switch to the Manufacture workspace and retry. Switching the
    # workspace causes Fusion to materialize the CAM product on demand, so
    # the second acquire usually succeeds. We only error if BOTH the switch
    # and the retry fail (e.g. no Manufacture license, no active document).
    if not cam:
        try:
            logger and logger.log("CAM: not active — auto-switching to Manufacture", "INFO")
        except Exception:
            pass
        if cam_workspace.activate_manufacture_workspace(app=app, logger=logger):
            cam = cam_workspace.acquire_cam(app=app, logger=logger)

    if not cam:
        report['errors'].append(
            "Could not acquire a CAM product. The Manufacture workspace may "
            "not be available (license/install) or no document is open."
        )
        return report
    report['cam_acquired'] = True

    # When the user is in the Manufacture workspace, ``app.activeProduct``
    # returns the CAMProduct -- NOT the Design. We need the Design product
    # explicitly, walked from the active document's products collection.
    design = None
    try:
        doc = app.activeDocument
        if doc:
            ds = doc.products.itemByProductType('DesignProductType')
            if ds:
                design = adsk.fusion.Design.cast(ds)
    except Exception as e:
        try:
            logger and logger.log(f"CAM coordinator: Design lookup failed: {e}", "ERROR")
        except Exception:
            pass
        design = None

    if not design:
        report['errors'].append(
            "Could not find a Design product in the active document. "
            "Open a design document and try again."
        )
        return report

    if mode == 'generic':
        # ── Generic: one MM + Setup per selected component ──────────────────
        if not component_names:
            report['errors'].append(
                "Generic mode requires component_names. "
                "Use SCAN in the palette to discover components first."
            )
            return report

        mms = mm_builder.build_mms_from_components(cam, design, component_names, logger)
        for name in component_names:
            report['mms'][name] = (name in mms)
            if name not in mms:
                report['errors'].append(f"MM for '{name}' was not built.")

        setup_results = setup_builder.build_setups_generic(cam, mms, logger, profile=profile)
        # build_setups_generic returns one (comp_name, Setup) tuple per side
        # per component, so a multi-side run will have N×M entries. We
        # collapse to a per-component set for the row-status check and
        # count setups separately so the report stays meaningful.
        built_comps = {n for n, _ in setup_results}
        for name in component_names:
            report['setups'].append({
                'name': name,
                'ok':   name in built_comps,
            })
            if name not in built_comps:
                report['errors'].append(f"Setup for '{name}' was not built.")

        # Track per-side counts for transparency in the UI / logs. The
        # number of sides comes from the profile (defaults to 1 when
        # absent), so the expected total is comps × sides.
        sides = (profile or {}).get('sides') or [{'name': 'A', 'axis': 'Z', 'angleDeg': 0}]
        expected_setups = len(component_names) * max(1, len(sides))
        report['setups_built']    = len(setup_results)
        report['setups_expected'] = expected_setups

        report['ok'] = (
            len(mms) == len(component_names)
            and built_comps == set(component_names)
            and len(setup_results) == expected_setups
        )

    else:
        # ── B-spline: hardcoded 3-MM / 4-setup pipeline ──────────────────────

        # Auto-cleanup: delete any prior build's Setups and MMs with our
        # known names so a re-run REPLACES instead of DOUBLING.
        _log(logger, "COORDINATOR: entering bspline branch, about to run cleanup", "INFO")
        try:
            _cleanup_previous_build(cam, logger)
            _log(logger, "COORDINATOR: cleanup returned normally", "DEBUG")
        except Exception as e:
            import traceback as _tb
            _log(logger, f"COORDINATOR: cleanup raised {type(e).__name__}: {e}\n{_tb.format_exc()}", "WARNING")

        mms = mm_builder.build_all_mms(cam, design, classifier, logger)
        for rule in mm_builder.MM_RULES:
            report['mms'][rule] = (rule in mms)
            if rule not in mms:
                report['errors'].append(f"MM '{rule}' was not built.")

        setups = setup_builder.build_all_setups(cam, mms, logger,
                                                skip_templates=skip_templates,
                                                skip_machine=skip_machine)
        built_names = {s.name for s in setups}
        for spec in setup_builder.SETUP_SPECS:
            report['setups'].append({
                'name': spec['name'],
                'ok':   spec['name'] in built_names,
            })

        report['ok'] = (
            len(mms) == len(mm_builder.MM_RULES)
            and len(setups) == len(setup_builder.SETUP_SPECS)
        )

    return report
