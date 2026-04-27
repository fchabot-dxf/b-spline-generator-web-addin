"""Setup builder.

Creates the four Setups, each pointed at the right Manufacturing Model
via ``setupInput.models`` (the API has no explicit MM->Setup linkage,
the binding is implicit through the bodies/occurrences supplied).

  +------------------------+----------------+------------------------+
  | Setup                  | MM rule        | Stock + WCS notes      |
  +========================+================+========================+
  | Stock                  | ``stock``      | auto bbox / model orig |
  | B-spline Top           | ``bspline_set``| auto bbox / top face Z+|
  | B-spline Bottom        | ``bspline_set``| from prev / flipped Z- |
  | Frame                  | ``frame``      | auto bbox / reoriented |
  +------------------------+----------------+------------------------+

Empty stubs by design: no operations are added. The user adds toolpaths
themselves in the CAM workspace once the Setups exist.

Reference: see ``CAM_API_NOTES.md`` -- "Setup creation", "WCS
programmatically", "Stock", "Empty Setups".
"""

import adsk.core
import adsk.cam

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
        'flip_z':       False,
    },
    {
        'name':         'B-spline Top',
        'mm_rule':      'bspline_set',
        'stock_intent': 'auto_bbox',
        'wcs_origin':   'box_point',          # top-center of stock bbox
        'wcs_orient':   'model',
        'flip_z':       False,
    },
    {
        'name':         'B-spline Bottom',
        'mm_rule':      'bspline_set',
        'stock_intent': 'from_prev_setup',
        'wcs_origin':   'box_point',          # top-center of flipped bbox
        'wcs_orient':   'model',
        'flip_z':       True,
    },
    {
        'name':         'Frame',
        'mm_rule':      'frame',
        'stock_intent': 'auto_bbox',
        'wcs_origin':   'model_origin',
        'wcs_orient':   'model',
        'flip_z':       False,
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
        setup_input.models = bodies
        _log(logger, f"SETUP BUILD ({spec['name']}): bound {len(bodies)} bodies", "DEBUG")
    except Exception as e:
        _log(logger, f"SETUP BUILD ({spec['name']}): models bind failed: {e}", "WARNING")

    # Stock + WCS via the runtime-introspected parameter dictionary.
    # Each pi.set_choice call is internally try/except'd, but wrap the
    # block too in case `setup_input.parameters` itself errors.
    try:
        pi.set_choice(setup_input.parameters, 'job_stockMode',
                      pi.STOCK_MODE_CANDIDATES[spec['stock_intent']], logger)
        pi.set_choice(setup_input.parameters, 'wcs_origin_mode',
                      pi.WCS_ORIGIN_MODE_CANDIDATES[spec['wcs_origin']], logger)
        pi.set_choice(setup_input.parameters, 'wcs_orientation_mode',
                      pi.WCS_ORIENTATION_CANDIDATES[spec['wcs_orient']], logger)
    except Exception as e:
        _log(logger, f"SETUP BUILD ({spec['name']}): parameter setup raised: {e}", "WARNING")

    if spec['flip_z']:
        _log(logger, f"SETUP BUILD ({spec['name']}): flip_z requested, deferred to spike", "DEBUG")

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

    try:
        mm_name = mm.name
    except Exception:
        mm_name = '<unknown>'
    _log(logger, f"SETUP BUILD ({spec['name']}): created -> MM '{mm_name}'")
    return setup


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

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


def _log(logger, msg, level="INFO"):
    if logger is None:
        return
    try:
        logger.log(msg, level)
    except Exception:
        pass
