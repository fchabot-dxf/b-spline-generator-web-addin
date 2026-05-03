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

    def __init__(self, comp, design, logger, prefix="T1", ui_data=None, resolver=None, max_phase=None):
        self.comp = comp
        self.design = design
        self.logger = logger
        self.prefix = prefix
        self.ui_data = ui_data or {}
        self.resolver = resolver
        self.max_phase = int(max_phase) if max_phase is not None else None

        # Shared state context with unit-safe resolver
        self.ctx = BuildContext(comp, design, logger, prefix=prefix, ui_data=ui_data, resolver=resolver)
        self.logger.log(f"ParametricSketchBuilder initialized for {prefix}, max_phase={self.max_phase}")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def build_template(self, template):
        """Constructs all sketches defined in the template."""
        ctx = self.ctx
        ctx.logger.log(f"Building Template: {template.get('Name', 'Unnamed')}")
        # Use ui_data shadow state if available to override template defaults
        ui_state = ctx.active_vars if hasattr(ctx, 'active_vars') else {}
        
        # Collect params from sketch-level; fall back to top-level for legacy templates
        all_params = []
        for sketch in template.get("Sketches", []):
            all_params.extend(sketch.get("Parameters", []))
        # Fallback: top-level Parameters for legacy templates
        if not all_params:
            all_params = template.get("Parameters", [])

        # 1. Parameter Sync (Centralized in frame_engine.py)
        # We no longer handle parameter creation here to avoid overwriting 
        # parametric expressions with raw numeric factors.

        # 2. Iterate through sketches with Global Phase Tracking
        remaining_phase = self.max_phase
        for sketch_spec in template.get("Sketches", []):
            try:
                ctx.logger.log(f"--- Creating Sketch: {sketch_spec['Name']} (Remaining global phases: {remaining_phase}) ---")
                
                # Build the sketch, passing the current global cap and UI state
                built_count = self.build_sketch(sketch_spec, limit=remaining_phase, ui_data=ctx.active_vars)
                
                # Decrement the global cap by the number of steps definitely 'consumed' by this sketch
                if remaining_phase is not None:
                    # If sketch has blocks, subtract the total block count to get the next sketch's start phase
                    # If it's legacy (monolithic), it counts as 1 phase.
                    sketch_steps = len(sketch_spec.get("Blocks", [])) if "Blocks" in sketch_spec else 1
                    remaining_phase -= sketch_steps
                    if remaining_phase < 0: remaining_phase = 0

            except Exception:
                ctx.logger.log_error(
                    f"CRASH in Sketch {sketch_spec['Name']}:\n{traceback.format_exc()}")

        ctx.logger.log("SYNTHESIS COMPLETE")

    def build_sketch(self, sketch_spec, limit=None, ui_data=None):
        """
        Execute the 8-phase build loop for a single sketch.
        Supports global 'limit' for phased synthesis.
        """
        ctx = self.ctx
        sketch_name = f"{self.prefix}_{sketch_spec['Name']}"
        sketch_prefix = sketch_spec.get("Prefix", self.prefix)
        
        # 0. Sync UI parameters to Fusion UserParameters before building
        self._sync_user_parameters(ctx, ui_data)

        # 1. CLEANUP: Delete any previous instance of this sketch name in the target component
        try:
            old_sketch = ctx.target.sketches.itemByName(sketch_name)
            if old_sketch:
                old_sketch.deleteMe()
        except:
            pass

        # Create the sketch on the XZ construction plane
        sketch = ctx.target.sketches.add(ctx.target.xZConstructionPlane)
        sketch.name = sketch_name
        ctx.sketches[sketch_name] = sketch
        # Use the raw name for the entity map key to support internal lookups
        ctx.entity_map[sketch_spec['Name']] = {"ORIGIN": sketch.originPoint}
        # Also store with prefixed name for projection logic compatibility
        ctx.entity_map[sketch_name] = ctx.entity_map[sketch_spec['Name']]

        # Project the vertical axis into the sketch
        self._project_y_axis(sketch, sketch_name)

        # Extract all phase categories from the spec
        built_count = 0
        if "Blocks" in sketch_spec:
            built_count = self._build_blocks(sketch, sketch_name, sketch_spec["Blocks"], limit=limit)
        else:
            # Legacy sketches (monolithic) always count as 1 phase
            self._build_legacy_phases(sketch, sketch_name, sketch_spec)
            built_count = 1

        ctx.logger.log(f"--- BUILD COMPLETE [{sketch_name}] (Final count: {built_count}) ---")
        return built_count

    def _sync_user_parameters(self, ctx, ui_data):
        """
        Ensures all variables in the UI state are registered as official 
        Fusion 360 UserParameters. This allows parametric solvers to 
        recognize names like 'frame_thickness' during construction.
        """
        if not ui_data:
            return
            
        try:
            design = ctx.design
            params = design.userParameters
            
            for name, val in ui_data.items():
                p = params.itemByName(name)
                
                # Create if missing
                if not p:
                    try:
                        unit = '' if name.startswith('en_') or name.startswith('is_') else 'cm'
                        p = params.add(name, adsk.core.ValueInput.createByReal(0.0), unit, "Hybrid UI Pre-Sync")
                        ctx.logger.log(f"PARAM SYNC: Created missing parameter '{name}'", "DEBUG")
                    except:
                        continue
                
                # Update expression to match UI value.
                # For scaled anatomy factors, preserve live width/height expressions.
                if p:
                    try:
                        expr = str(val)
                        if hasattr(self, 'resolver') and self.resolver:
                            expr = self.resolver.wrap_expression_if_factor(name, val)
                            if expr != str(val):
                                ctx.logger.log(f"PARAM SYNC: Wrapped UI factor '{name}' => '{expr}'", "DEBUG")
                        p.expression = str(expr)
                    except Exception:
                        pass
                        
        except Exception as e:
            ctx.logger.log(f"PARAM SYNC ERROR: {e}", "WARNING")

    def _build_blocks(self, sketch, sketch_name, blocks, limit=None):
        """Builds a sketch using the new sequential BuildingBlock pattern."""
        self.ctx.logger.log(f"Using Procedural BLOCK-BASED synthesis in {sketch_name} (Global limit: {limit})")
        built_count = 0

        for i, block in enumerate(blocks):
            if limit is not None and i >= limit:
                self.ctx.logger.log(f"  > PHASE CUTOFF at block {i} (global limit={limit})")
                break
            b_name = block.get("Name", "Unnamed Block")
            p_id = block.get("PhaseID", "p??")
            self.ctx.logger.phase_id = p_id
            self.ctx.logger.log(f"  > START BLOCK: {b_name}")

            
            # 1. Projections (Live)
            sketch.isComputeDeferred = False
            for proj in block.get("Projections", []):
                project_step(self.ctx, sketch, sketch_name, proj)
            
            # 2. Sequence (Deferred with Pulse)
            sketch.isComputeDeferred = True
            
            # Process Geometry/Constraints/Dimensions mix
            seq = block.get("BuildSequence", [])
            self._process_sequence(sketch, sketch_name, seq)
            
            # Fallback bucket support within the block
            for g in block.get("Geometry", []): geom_step(self.ctx, sketch, sketch_name, g)
            for c in block.get("Constraints", []): constraint_step(self.ctx, sketch, sketch_name, c)
            for d in block.get("Dimensions", []): dimension_step(self.ctx, sketch, sketch_name, d)

            # Volatile (snap-seed) dimensions — applied then deleted to nudge the solver
            for vd in block.get("VolatileDimensions", []):
                dimension_step(self.ctx, sketch, sketch_name, vd, is_snap_only=True)

            # Pulse the solver to settle geometry before offsets
            self.ctx.logger.log(f"  > PULSE SOLVE: {b_name}")
            sketch.isComputeDeferred = False
            self._log_arc_audit(self.ctx, sketch, sketch_name, f"BLOCK {b_name} COMPLETE")

            # Offset Steps (runs in deferred mode for constraint stability)
            sketch.isComputeDeferred = True
            for step in block.get("Steps", []):
                step_step(self.ctx, sketch, sketch_name, step)

            # Miters (depends on offset corners)
            miters_list = block.get("Miters", [])
            if miters_list:
                self.ctx.logger.log(f"  > MITERS: {len(miters_list)} cuts in block {b_name}")
                for m in miters_list:
                    miter_step(self.ctx, sketch, sketch_name, m)
            
            # Final solve flush for the block
            sketch.isComputeDeferred = False

    def _process_sequence(self, sketch, sketch_name, sequence):
        """Order-aware dispatcher for Procedural Sketching."""
        geom_types = ["Line", "Arc3Point", "ArcCenterPoint", "Circle", "Rectangle", "RectangleCenter", "Slot"]
        constr_types = ["Coincident", "Tangent", "Horizontal", "Vertical", "Parallel", "Perpendicular", "Equal", "Concentric", "Midpoint", "PointOnCurve"]
        dim_types = ["HorizontalDistance", "VerticalDistance", "Radius", "Diameter", "ParallelDistance", "AngularDistance"]

        for step in sequence:
            t = step.get("Type")
            if t in geom_types:
                geom_step(self.ctx, sketch, sketch_name, step)
            elif t in constr_types:
                constraint_step(self.ctx, sketch, sketch_name, step)
            elif t in dim_types:
                dimension_step(self.ctx, sketch, sketch_name, step)
            elif t == "DeleteDimension":
                dimensions.delete_dimension_by_name(self.ctx, sketch, step.get("Name"))
            elif t == "Offset":
                offset_step(self.ctx, sketch, sketch_name, step)
            elif t == "Pulse":
                self.ctx.logger.log("  > INTERMEDIATE PULSE SOLVE (Manual)")
                sketch.isComputeDeferred = False
                sketch.isComputeDeferred = True
            elif t == "Step":
                step_step(self.ctx, sketch, sketch_name, step)

    def _build_legacy_phases(self, sketch, sketch_name, sketch_spec):
        """The original 8-phase bucket-based loop."""
        ctx = self.ctx
        phases = _extract_phases(sketch_spec)

        # === PHASE 0: PROJECTIONS (live compute) ===
        sketch.isComputeDeferred = False
        for proj in (phases["bbox_projs"] + phases["skel_projs"] + phases["projs"]):
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
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 3 POST-SOLVE (PRE-CONSTRS)")
        sketch.isComputeDeferred = False

        # === PHASE 4: MAIN GEOMETRY / CONSTRAINTS ===
        sketch.isComputeDeferred = True
        for g in phases["geoms"]:
            geom_step(ctx, sketch, sketch_name, g)
        for rel in phases["constrs"]:
            constraint_step(ctx, sketch, sketch_name, rel)
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 4 PRE-SOLVE (MAIN GEOM)")
        sketch.isComputeDeferred = False
        self._log_arc_audit(ctx, sketch, sketch_name, "PHASE 4 POST-SOLVE (MAIN GEOM)")
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
        for step in phases["steps"]:
            from fb_engine import offsets
            offsets.step_step(ctx, sketch, sketch_name, step)
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
        
        ent_map = ctx.entity_map.get(sketch_name, {})

        def _p2s(pt):
            """Safe point to string."""
            if not pt: return "?,?"
            try:
                geom = pt.geometry
                return f"{geom.x:.3f}, {geom.y:.3f}"
            except:
                return "ERR"

        try:
            for arc in sketch.sketchCurves.sketchArcs:
                # Find the human-readable ID by searching the entity map
                arc_id = "unknown_arc"
                for eid, eobj in ent_map.items():
                    if eobj == arc:
                        arc_id = eid
                        break
                
                # 1. Basic points (Start, End, Center)
                s_str = _p2s(arc.startSketchPoint)
                e_str = _p2s(arc.endSketchPoint)
                c_str = _p2s(arc.centerSketchPoint)

                # 2. Midpoint (Isolate evaluator for safety)
                m_str = "?,?"
                try:
                    res = arc.geometry.evaluator.getPointAtParameter(0.5)
                    if res and res[1]:
                        m_str = f"{res[1].x:.3f}, {res[1].y:.3f}"
                except:
                    m_str = "eval_fail"
                
                log_msg = f"  [{arc_id}] S({s_str}) | M({m_str}) | E({e_str}) | C({c_str})"
                ctx.logger.log(log_msg)
                    
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
