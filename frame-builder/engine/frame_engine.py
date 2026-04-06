import adsk.core, adsk.fusion, traceback
import time
import os
import sys
import importlib

# Ensure the root 'frame-builder' is in path for sketches import
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if root_dir not in sys.path:
    sys.path.append(root_dir)

def nuclear_reload(prefix="engine"):
    """Forcibly evicts sub-modules from cache. Does NOT evict the engine package
    itself — doing so breaks relative imports in the currently executing module."""
    to_delete = [
        name for name in sys.modules
        if (name.startswith(prefix + ".") or name.startswith("sketches"))
        and name != __name__  # never evict ourselves
    ]
    for name in to_delete:
        del sys.modules[name]

def run_sketch_only(comp, design, logger, prefix="T2"):
    """Synthesizes the complete frame silhouette using modular design templates."""

    # Hot-reload sub-modules only (NOT the engine package root)
    nuclear_reload("engine")
    nuclear_reload("sketches")

    try:
        from engine.sketch_builder import builder
        from sketches.template_2 import T2_sketch_1_bounding_box, T2_sketch_2_shape_outline
    except Exception as e:
        logger.log(f"   (FAIL) IMPORT: {e}\n{traceback.format_exc()}", "ERROR")
        return False

    try:
        template = {
            "Name": "Signature (High-Fidelity)",
            "Parameters": [],
            "Sketches": [
                T2_sketch_1_bounding_box.get_sketch(),
                T2_sketch_2_shape_outline.get_sketch()
            ]
        }
    except Exception as e:
        logger.log(f"   (FAIL) TEMPLATE LOAD: {e}", "ERROR")
        return False

    ss_p = design.userParameters.itemByName("ShoulderSpan")
    ws_p = design.userParameters.itemByName("WaistSpan")
    hs_p = design.userParameters.itemByName("HipSpan")
    tg_p = design.userParameters.itemByName("TopGap")
    bg_p = design.userParameters.itemByName("BottomGap")
    vo_p = design.userParameters.itemByName("VerticalOffset")

    local_map = {
        "ShoulderSpan":   ss_p.value if ss_p else 14.224,
        "WaistSpan":      ws_p.value if ws_p else 16.891,
        "HipSpan":        hs_p.value if hs_p else 14.224,
        "TopGap":         tg_p.value if tg_p else 6.401,
        "BottomGap":      bg_p.value if bg_p else 8.001,
        "VerticalOffset": vo_p.value if vo_p else 0.0
    }

    builder_obj = builder.ParametricSketchBuilder(comp, design, logger, prefix=prefix, local_values=local_map)
    try:
        builder_obj.build_template(template)
        logger.log(f"   (OK) HIGH-FIDELITY SYNTHESIS COMPLETE", "BUILD")
        return True
    except Exception as e:
        logger.log(f"   (CRASH) BUILD: {e}\n{traceback.format_exc()}", "ERROR")
        return False

def run_full_synthesis(comp, design, logger):
    """Execution bridge for Solid Builder (Extrude sequence)."""
    if not run_sketch_only(comp, design, logger):
        return False

    from engine import solid_builder
    sb = solid_builder.SolidBuilder(design, logger)
    try:
        sketch = None
        for i in range(comp.sketches.count):
            sk = comp.sketches.item(i)
            if "2_shape" in sk.name.lower() or "outline" in sk.name.lower():
                sketch = sk
                break
        if not sketch and comp.sketches.count > 0:
            sketch = comp.sketches.item(comp.sketches.count - 1)
        target_face = sb.discover_aesthetic_core()
        if target_face and sketch:
            sb.extrude_4_segments(sketch, target_face, comp)
            return True
        return False
    except Exception as e:
        logger.log(f"   (CRASH) SOLID: {e}", "ERROR")
        return False

# ---------------------------------------------------------------------------
# Bridge functions — called by frame-builder.py
# ---------------------------------------------------------------------------

def _ensure_base_params(design, logger):
    """Guarantees foundational parameters exist before any sketch runs."""
    import adsk.core
    base_params = [
        ("boundingboxoffset", 0.25 * 2.54, "in"),
        ("Skel_Frame_Offset", -0.75 * 2.54, "in"),
    ]
    up = design.userParameters
    for name, val_cm, unit in base_params:
        if not up.itemByName(name):
            try:
                up.add(name, adsk.core.ValueInput.createByReal(val_cm), unit, "")
                logger.log(f"   (PARAM) CREATED: {name} = {val_cm:.4f} cm", "BUILD")
            except Exception as e:
                logger.log(f"   (WARN) Could not create {name}: {e}", "WARNING")

def _get_or_create_frame_comp(design):
    """Returns the 'Frame' sub-component, creating it if it doesn't exist."""
    root = design.rootComponent
    for i in range(root.occurrences.count):
        occ = root.occurrences.item(i)
        if occ.component.name == "Frame":
            return occ.component
    matrix = adsk.core.Matrix3D.create()
    occ = root.occurrences.addNewComponent(matrix)
    occ.component.name = "Frame"
    return occ.component

def _show_drop_popup(app, logger):
    """Shows a Fusion messageBox if any constraints were dropped during the build."""
    drop_notes = [
        n for n in logger.notifications
        if any(kw in n for kw in ['(FAIL)', '(RETRY)', '(CRASH)'])
    ]
    if not drop_notes:
        return
    ui = app.userInterface
    lines = drop_notes[:12]
    msg = "One or more constraints were dropped by the solver:\n\n"
    msg += "\n".join(lines)
    if len(drop_notes) > 12:
        msg += f"\n\n...and {len(drop_notes) - 12} more — check the build log."
    msg += "\n\nTry reducing a slider value or turning off a lock to give the solver more room."
    ui.messageBox(msg, "Frame Builder — Constraint Drop")


def build_sketch_logic(style, mode, local_map):
    """Entry point for Generate Sketch button."""
    import adsk.core, adsk.fusion, os
    from utils.logger import DebugLogger
    app    = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    comp   = _get_or_create_frame_comp(design)
    logger = DebugLogger(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    logger.session_start("SKETCH-ONLY")
    _ensure_base_params(design, logger)
    for key, val in (local_map or {}).items():
        existing = design.userParameters.itemByName(key)
        try:
            if existing:
                existing.value = val
            else:
                design.userParameters.add(key, adsk.core.ValueInput.createByReal(val), "cm", "")
        except Exception as e:
            logger.log(f"   (WARN) Could not set {key}: {e}", "WARNING")
    run_sketch_only(comp, design, logger)
    _show_drop_popup(app, logger)

def build_frame_logic(style, mode, local_map):
    """Entry point for Create Frame button."""
    import adsk.core, adsk.fusion, os
    from utils.logger import DebugLogger
    app    = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    comp   = design.rootComponent
    logger = DebugLogger(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    logger.session_start("FULL-FRAME")
    _ensure_base_params(design, logger)
    for key, val in (local_map or {}).items():
        existing = design.userParameters.itemByName(key)
        try:
            if existing:
                existing.value = val
            else:
                design.userParameters.add(key, adsk.core.ValueInput.createByReal(val), "cm", "")
        except Exception as e:
            logger.log(f"   (WARN) Could not set {key}: {e}", "WARNING")
    run_full_synthesis(comp, design, logger)
