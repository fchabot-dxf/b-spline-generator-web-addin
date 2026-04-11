"""
Parametric Sketch Builder — Slim orchestrator.

This module owns the 8-phase build loop and delegates all heavy lifting
to the sub-modules: geometry, constraints, dimensions, projections, offsets, miters.

Shared state lives in BuildContext (build_context.py).
"""
import adsk.core, adsk.fusion, traceback
import importlib

# Sub-module imports (Absolute naming for manual loading stability)
from fb_engine import build_context, geometry, constraints, dimensions, projections, offsets, miters
importlib.reload(build_context)
importlib.reload(geometry)
importlib.reload(constraints)
importlib.reload(dimensions)
importlib.reload(projections)
importlib.reload(offsets)
importlib.reload(miters)

from fb_engine.build_context import BuildContext
from fb_engine.geometry import geom_step
from fb_engine.constraints import constraint_step
from fb_engine.dimensions import dimension_step
from fb_engine.projections import project_step
from fb_engine.offsets import offset_step, step_step
from fb_engine.miters import miter_step


class ParametricSketchBuilder:
    """
    Orchestrates parametric sketch construction from template data.

    Usage
    -----
    builder = ParametricSketchBuilder(component, design, logger, prefix="T2")
    builder.build_template(template_dict)
    """

    def __init__(self, target, design, logger, prefix="T1", ui_data=None):
        self.ctx = BuildContext(target, design, logger, prefix=prefix, ui_data=ui_data)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def build_template(self, template):
        """Build all sketches defined in a template dict."""
        ctx = self.ctx
        ctx.logger.log(f"Building Template: {template.get('Name', 'Unnamed')}")

        # 1. Sync template parameters (protect measured values)
        # Use ui_data shadow state if available to override template defaults
        ui_state = ctx.active_vars if hasattr(ctx, 'active_vars') else {}
        
        for p in template.get("Parameters", []):
            name = p["Name"]
            v = ui_state.get(name, p.get("Val", p.get("Value", 0)))
            unit = p["Unit"]
            existing = ctx.user_params.itemByName(name)
            if not existing:
                ctx.create_or_update_param(name, v, unit)
            else:
                ctx.logger.log(
                    f"PRESERVING MODEL PARAM: {name} (Template default {v} skipped)")

        # 2. Iterate through sketches
        for sketch_spec in template.get("Sketches", []):
            try:
                ctx.logger.log(f"--- Creating Sketch: {sketch_spec['Name']} ---")
                self.build_sketch(sketch_spec)
            except Exception:
                ctx.logger.log_error(
                    f"CRASH in Sketch {sketch_spec['Name']}:\n{traceback.format_exc()}")

        ctx.logger.log("SYNTHESIS COMPLETE")

    def build_sketch(self, sketch_spec):
        """
        Execute the 8-phase build loop for a single sketch.

        Phases
        ------
        0. Projections (live — compute not deferred)
        1. Pre-Geometry
        2. Snap-to-Seed (soft dimensions)
        3. Pre-Constraints / Pre-Dimensions
        4. Main Geometry / Constraints
        5. Post-Geometry / Post-Constraints (with anchor pulse)
        6. Final Dimensions
        7. Offsets / Steps
        8. Miters
        """
        ctx = self.ctx
        sketch_name = f"{ctx.prefix}_{sketch_spec['Name']}"
        ctx.logger.log(f"--- START BUILD [{sketch_name}] ---")

        # --- UNCONDITIONAL WAIST TRACE ---
        try:
            off_val = ctx.user_params.itemByName('WaistOffset').value if ctx.user_params.itemByName('WaistOffset') else 0.0
            ctx.logger.log(f"[WAIST TRACE] Resolved WaistOffset: {off_val:.3f} {'(ORIGIN SNAPPED)' if off_val == 0 else '(DIMENSION OFFSET)'}")
        except:
            pass

        # Create the sketch on the XZ construction plane
        sketch = ctx.target.sketches.add(ctx.target.xZConstructionPlane)
        sketch.name = sketch_name
        ctx.sketches[sketch_name] = sketch
        ctx.entity_map[sketch_name] = {"ORIGIN": sketch.originPoint}

        # Project the vertical axis into the sketch
        self._project_y_axis(sketch, sketch_name)

        # Extract all phase categories from the spec
        phases = _extract_phases(sketch_spec)

        # === PHASE 0: PROJECTIONS (live compute) ===
        sketch.isComputeDeferred = False
        for proj in phases["bbox_projs"]:
            project_step(ctx, sketch, sketch_name, proj)
        for proj in phases["skel_projs"]:
            project_step(ctx, sketch, sketch_name, proj)
        for proj in phases["projs"]:
            project_step(ctx, sketch, sketch_name, proj)

        # === PHASE 1: PRE-GEOMETRY ===
        sketch.isComputeDeferred = True
        for g in phases["pre_geoms"]:
            geom_step(ctx, sketch, sketch_name, g)
        sketch.isComputeDeferred = False  # force solve

        # === PHASE 2: SNAP-TO-SEED (soft dimensions) ===
        self._run_snap_seed_phase(ctx, sketch, sketch_name, phases, "INITIAL")

        # === PHASE 3: PRE-CONSTRAINTS / PRE-DIMENSIONS ===
        sketch.isComputeDeferred = True
        for rel in phases["pre_constrs"]:
            constraint_step(ctx, sketch, sketch_name, rel)
        for dim in phases["pre_dims"]:
            dimension_step(ctx, sketch, sketch_name, dim)
        sketch.isComputeDeferred = False

        # === PHASE 4: MAIN GEOMETRY / CONSTRAINTS ===
        sketch.isComputeDeferred = True
        for g in phases["geoms"]:
            geom_step(ctx, sketch, sketch_name, g)
        for rel in phases["constrs"]:
            constraint_step(ctx, sketch, sketch_name, rel)
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 4 PRE-SOLVE")
        sketch.isComputeDeferred = False
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 4 POST-SOLVE")
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 4 (GEOMETRY)")

        # === PHASE 4.5: SNAP-TO-SEED RECOVERY (Mid-Build Snap) ===
        # Re-run soft dimensions to settle Main Geometry before Post-Constraints
        self._run_snap_seed_phase(ctx, sketch, sketch_name, phases, "RECOVERY")

        # === PHASE 5: POST-GEOMETRY / POST-CONSTRAINTS ===
        sketch.isComputeDeferred = True
        for g in phases["post_geoms"]:
            geom_step(ctx, sketch, sketch_name, g)

        # Sub-phase 5.1: Coincident anchoring first
        for rel in phases["post_constrs"]:
            if rel.get("Type") == "Coincident":
                constraint_step(ctx, sketch, sketch_name, rel)

        # Pulse: settle anchors before tangency
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 5.1 PRE-PULSE")
        sketch.isComputeDeferred = False
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 5.1 POST-PULSE")
        sketch.isComputeDeferred = True
        ctx.logger.log(f"PHASE PULSE: Anchors settled before tangency")

        # Sub-phase 5.2: Shaping constraints (Tangent, etc.)
        for rel in phases["post_constrs"]:
            if rel.get("Type") != "Coincident":
                constraint_step(ctx, sketch, sketch_name, rel)
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 5.2 PRE-SOLVE")
        sketch.isComputeDeferred = False
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 5.2 POST-SOLVE")
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 5 (CONSTRAINTS/WELDS)")

        # === PHASE 6: FINAL DIMENSIONS ===
        sketch.isComputeDeferred = True
        for dim in phases["dims"]:
            dimension_step(ctx, sketch, sketch_name, dim, is_snap_only=False)
        for vdim in phases["vdims"]:
            dimension_step(ctx, sketch, sketch_name, vdim, is_snap_only=True)
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 6 PRE-SOLVE")
        sketch.isComputeDeferred = False
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 6 POST-SOLVE")
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 6 (FINAL DIMENSIONS)")

        # === PHASE 7: OFFSETS / STEPS ===
        sketch.isComputeDeferred = True
        for off in phases["offs"]:
            offset_step(ctx, sketch, sketch_name, off)
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 7 PRE-SOLVE")
        sketch.isComputeDeferred = False
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 7 POST-SOLVE")

        # === PHASE 8: MITERS ===
        miters_list = phases["miters"]
        ctx.logger.log(f"MITER PHASE: Found {len(miters_list)} definitions in {sketch_name}")
        if miters_list:
            sketch.isComputeDeferred = True
            self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 8 PRE-SOLVE")
            sketch.isComputeDeferred = False
            self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 8 POST-SOLVE")

        ctx.logger.log(f"--- BUILD COMPLETE [{sketch_name}] ---")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _run_snap_seed_phase(self, ctx, sketch, sketch_name, phases, note="SEED"):
        """Run the snap-to-seed (soft dimension) logic for a sketch."""
        dims = phases.get("dims", []) + phases.get("vdims", [])
        if not dims:
            return

        ctx.logger.log(f"--- SNAP-TO-SEED ({note}) in {sketch_name} ---")
        for dim in dims:
            # SOFT DRIVE: We ignore the EnabledParam during the Snap phase.
            # This allows unlocked sliders to still move the geometry 
            # before the permanent dimension state is determined.
            dimension_step(ctx, sketch, sketch_name, dim, is_snap_only=True)

    def _project_y_axis(self, sketch, sketch_name):
        """Project the vertical construction axis into the sketch."""
        try:
            z_axis = self.ctx.design.rootComponent.zConstructionAxis
            proj_axis = sketch.project(z_axis)
            if proj_axis.count > 0:
                self.ctx.entity_map[sketch_name]["Y_AXIS"] = proj_axis.item(0)
                self.ctx.logger.log(f"Y_AXIS projected into {sketch_name}")
        except Exception as e:
            self.ctx.logger.log(f"Y_AXIS projection skipped: {e}", "WARNING")


# ------------------------------------------------------------------
# Phase extraction helper (keeps build_sketch readable)
# ------------------------------------------------------------------
    def _log_arc_audit(self, ctx, sketch, sketch_name, phase_label):
        """Diagnostic helper to log coordinates of all arcs in the sketch."""
        ctx.logger.log(f"--- ARC AUDIT: {phase_label} in {sketch_name} ---")
        
    def _log_arc_audit(self, ctx, sketch, sketch_name, phase_label):
        """Diagnostic helper to log coordinates of all arcs in the sketch."""
        ctx.logger.log(f"--- ARC AUDIT: {phase_label} in {sketch_name} ---")
        
        ent_map = ctx.entity_map.get(sketch_name, {})

        try:
            for arc in sketch.sketchCurves.sketchArcs:
                # Find the human-readable ID by searching the entity map
                arc_id = "unknown_arc"
                for eid, eobj in ent_map.items():
                    if eobj == arc:
                        arc_id = eid
                        break
                
                try:
                    start = arc.startPoint.geometry
                    end = arc.endPoint.geometry
                    center = arc.centerPoint.geometry
                    # Sample at parameter 0.5 to get the bulge point (Mid)
                    mid_res = arc.geometry.sample(0.5)
                    mid = mid_res[0] if mid_res and mid_res[0] else None
                    
                    log_msg = (f"  [{arc_id}] S({start.x:.3f}, {start.y:.3f}) | "
                               f"M({mid.x:.3f}, {mid.y:.3f} if mid else '??') | "
                               f"E({end.x:.3f}, {end.y:.3f}) | "
                               f"C({center.x:.3f}, {center.y:.3f})")
                    ctx.logger.log(log_msg)
                except Exception as arc_e:
                    ctx.logger.log(f"  [{arc_id}] Coordinate extraction failed: {arc_e}", "DEBUG")
                    
        except Exception as e:
            ctx.logger.log(f"ARC AUDIT FATAL FAIL: {e}", "WARNING")

# ------------------------------------------------------------------
# Phase extraction helper (keeps build_sketch readable)
# ------------------------------------------------------------------
def _extract_phases(spec):
    """Pull all phase lists from a sketch spec dict, with safe defaults."""
    return {
        "bbox_projs":   spec.get("BoundingBoxProjections", []),
        "skel_projs":   spec.get("SkeletonProjections", []),
        "projs":        spec.get("Projections", []),
        "pre_geoms":    spec.get("PreGeometry", []),
        "pre_constrs":  spec.get("PreConstraints", []),
        "pre_dims":     spec.get("PreDimensions", []),
        "geoms":        spec.get("Geometry", []),
        "constrs":      spec.get("Constraints", []),
        "post_geoms":   spec.get("PostGeometry", []),
        "post_constrs": spec.get("PostConstraints", []),
        "dims":         spec.get("Dimensions", []),
        "vdims":        spec.get("VolatileDimensions", []),
        "offs":         spec.get("Offsets", []),
        "steps":        spec.get("Steps", []),
        "miters":       spec.get("Miters", []),
    }
