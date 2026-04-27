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


def run(classifier, app=None, logger=None):
    """Run the full pipeline.

    Returns
    -------
    dict
        ::

            {
              'ok': bool,
              'cam_acquired': bool,
              'mms': {rule: bool, ...},   # True == built
              'setups': [{'name': str, 'ok': bool}, ...],
              'errors': [str, ...],
            }
    """
    report = {
        'ok': False,
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

    mms = mm_builder.build_all_mms(cam, design, classifier, logger)
    for rule in mm_builder.MM_RULES:
        report['mms'][rule] = (rule in mms)
        if rule not in mms:
            report['errors'].append(f"MM '{rule}' was not built.")

    setups = setup_builder.build_all_setups(cam, mms, logger)
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
