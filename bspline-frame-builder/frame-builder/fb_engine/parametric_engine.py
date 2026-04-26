"""
Parametric Sketch Builder — Slim orchestrator.

This module owns the per-sketch block build loop and delegates all heavy
lifting to the sub-modules: geometry, constraints, dimensions, projections,
offsets, miters.

Each sketch spec is required to declare a ``Blocks`` list — a sequence of
self-contained build steps with their own Projections / BuildSequence /
Constraints / Dimensions / Steps / Miters. Block-based synthesis lives in
:py:meth:`ParametricSketchBuilder._build_blocks`.

Shared state lives in BuildContext (build_context.py). The historical
top-level "PreGeometry / Geometry / PostGeometry" bucket pattern was
removed once every shipping template moved to the block layout — see
:py:func:`fb_engine.template_resolver._validate_template_spec` for the
runtime contract that now requires ``Blocks``.
"""
import adsk.core, adsk.fusion, traceback
import importlib

# Sub-module imports (Absolute naming for manual loading stability)
from fb_engine import build_context, geometry, constraints, dimensions, projections, offsets, miters, fb_value_resolver, parameter_schema, diagnostics
importlib.reload(parameter_schema)
importlib.reload(build_context)
importlib.reload(geometry)
importlib.reload(constraints)
importlib.reload(dimensions)
importlib.reload(projections)
importlib.reload(offsets)
importlib.reload(miters)
importlib.reload(fb_value_resolver)
importlib.reload(diagnostics)

from fb_engine.build_context import BuildContext
from fb_engine.geometry import geom_step
from fb_engine.constraints import constraint_step
from fb_engine.dimensions import dimension_step
from fb_engine.projections import project_step
from fb_engine.offsets import offset_step, step_step
from fb_engine.miters import miter_step
from fb_engine.parameter_schema import ParameterSchema
from fb_engine.diagnostics import log_arc_audit


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

        # 2. Iterate through sketches with Global Phase Tracking.
        #
        # Phase-counter decrement lives in a ``finally`` so a crash mid-
        # sketch can't leave the counter stale. Without this, a sketch-N
        # crash would skip the decrement, sketch-N+1 would start with
        # the wrong remaining_phase, and the user's max_phase cap would
        # be silently overrun (e.g. asking for 5 phases would build 7+
        # if sketch 2 crashed at phase 5).
        #
        # On crash we ALSO break out of the sketch loop. Continuing to
        # subsequent sketches after a crash produces only cascading
        # errors - the next sketch's projections reference geometry that
        # was never built, the welds reference missing endpoints, the
        # offset finds no source curves. One real error is more useful
        # than fifty downstream symptoms.
        remaining_phase = self.max_phase
        crashed = False
        for sketch_spec in template.get("Sketches", []):
            # Phase budget exhausted: don't even enter this sketch. Without
            # this check, the engine would still create the Fusion sketch
            # object, project axes, and log "Creating Sketch" for any sketch
            # past the cap - producing empty sketches that confuse the user
            # ("why is Frame Enclosure being created if I selected phase
            # loop?"). Treat budget=0 as a hard stop.
            if remaining_phase is not None and remaining_phase <= 0:
                ctx.logger.log(
                    f"PHASE BUDGET EXHAUSTED - skipping {sketch_spec['Name']} "
                    f"and any subsequent sketches.")
                break

            try:
                sketch_label = sketch_spec.get("Label", sketch_spec['Name'])
                ctx.logger.log(f"--- Creating Sketch: {sketch_label} (Remaining global phases: {remaining_phase}) ---")

                # Build the sketch, passing the current global cap and UI state
                built_count = self.build_sketch(sketch_spec, limit=remaining_phase, ui_data=ctx.active_vars)

            except Exception:
                ctx.logger.log_error(
                    f"CRASH in Sketch {sketch_spec['Name']}:\n{traceback.format_exc()}")
                crashed = True
            finally:
                if remaining_phase is not None:
                    remaining_phase -= len(sketch_spec.get("Blocks", []))
                    if remaining_phase < 0:
                        remaining_phase = 0

            if crashed:
                ctx.logger.log(
                    "BUILD HALTED after sketch crash - subsequent sketches "
                    "skipped to avoid cascading errors on missing geometry.",
                    "WARNING")
                break

        ctx.logger.log("SYNTHESIS COMPLETE")

    def build_sketch(self, sketch_spec, limit=None, ui_data=None):
        """
        Execute the block build loop for a single sketch.

        ``sketch_spec`` must declare a ``Blocks`` list (enforced by
        ``template_resolver._validate_template_spec``). The optional
        ``limit`` is a global phase cap so the UI can incrementally
        materialize a frame block-by-block during 'phased synthesis'.
        """
        ctx = self.ctx
        sketch_name = f"{self.prefix}_{sketch_spec['Name']}"
        sketch_label = sketch_spec.get("Label", sketch_spec['Name'])
        sketch_prefix = sketch_spec.get("Prefix", self.prefix)
        
        # 0. Sync UI parameters to Fusion UserParameters before building
        self._sync_user_parameters(ctx, ui_data)

        # 1. CLEANUP: Delete any previous instance of this sketch name in the target component
        try:
            old_sketch = ctx.target.sketches.itemByName(sketch_name)
            if old_sketch:
                old_sketch.deleteMe()
        except Exception as e:
            ctx.logger.log(f"Cleanup of '{sketch_name}' skipped: {e}", "DEBUG")

        # Create the sketch on the XY construction plane (Z-up Fusion: floor
        # plane). Was xZConstructionPlane back when the user ran Y-up Fusion;
        # XY-plane is the natural frame-layout plane in Z-up.
        sketch = ctx.target.sketches.add(ctx.target.xYConstructionPlane)
        sketch.name = sketch_name
        ctx.sketches[sketch_name] = sketch
        # Use the raw name for the entity map key to support internal lookups
        ctx.entity_map[sketch_spec['Name']] = {"ORIGIN": sketch.originPoint}
        # Also store with prefixed name for projection logic compatibility
        ctx.entity_map[sketch_name] = ctx.entity_map[sketch_spec['Name']]

        # Project the vertical + horizontal origin axes into the sketch.
        # ``Y_AXIS`` = world Y axis projected into an XY-plane sketch (the
        # sketch's vertical line in sketch-local coords). ``X_AXIS`` = world
        # X axis projected in (the sketch's horizontal line). Both are stored
        # in entity_map as bare-token keys so constraint-step Targets can
        # reference ``'Y_AXIS'`` / ``'X_AXIS'`` without a projection block or
        # any FrameBuilder ID stamping — the runtime's ``resolve_entity``
        # does a direct string lookup on these keys. ``ORIGIN`` was already
        # seeded above from ``sketch.originPoint``. ``Z_AXIS`` is
        # deliberately NOT seeded — on an XY-plane sketch (Z-up) it's
        # perpendicular to the sketch and would project as a point coinciding
        # with ORIGIN, so it's redundant.
        self._project_y_axis(sketch, sketch_name)
        self._project_x_axis(sketch, sketch_name)

        # Block-based synthesis. Validation upstream guarantees that
        # ``Blocks`` is present; no monolithic-sketch fallback exists.
        built_count = self._build_blocks(
            sketch, sketch_name, sketch_spec["Blocks"],
            limit=limit, display_name=sketch_label,
        )

        ctx.logger.log(f"--- BUILD COMPLETE [{sketch_label}] (Final count: {built_count}) ---")
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
                
                # Create if missing. Unit comes from ParameterSchema so the
                # stub respects the schema (ReadOnly inches params like
                # widthIn no longer get silently demoted to cm) and stays
                # in lockstep with the master / requirement creation paths.
                if not p:
                    try:
                        unit = ParameterSchema.default_unit(name)
                        p = params.add(name, adsk.core.ValueInput.createByReal(0.0), unit, "Hybrid UI Pre-Sync")
                        ctx.logger.log(f"PARAM SYNC: Created missing parameter '{name}'", "DEBUG")
                    except Exception as add_err:
                        ctx.logger.log(f"PARAM SYNC: Failed to create '{name}': {add_err}", "WARNING")
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

    def _build_blocks(self, sketch, sketch_name, blocks, limit=None, display_name=None):
        """Builds a sketch using the new sequential BuildingBlock pattern."""
        display_name = display_name or sketch_name
        self.ctx.logger.log(f"Using Procedural BLOCK-BASED synthesis in {display_name} (Global limit: {limit})")
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
            log_arc_audit(self.ctx, sketch, sketch_name, f"BLOCK {b_name} COMPLETE", display_name=display_name)

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

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _project_y_axis(self, sketch, sketch_name):
        """Project the vertical construction axis into the sketch.

        On the Frame Builder's XY-plane sketches (Z-up Fusion floor plane),
        the world Y axis is in-plane and projects directly as the sketch's
        local Y reference line. Pre-Z-up port this projected the world Z
        axis into an XZ-plane sketch — same conceptual role, different
        world axis.
        """
        try:
            y_axis = self.ctx.design.rootComponent.yConstructionAxis
            proj_axis = sketch.project(y_axis)
            if proj_axis.count > 0:
                self.ctx.entity_map[sketch_name]["Y_AXIS"] = proj_axis.item(0)
                self.ctx.logger.log(f"Y_AXIS projected into {sketch_name}")
        except Exception as e:
            self.ctx.logger.log(f"Y_AXIS projection skipped: {e}", "WARNING")

    def _project_x_axis(self, sketch, sketch_name):
        """Project the horizontal construction axis into the sketch.

        Mirror of ``_project_y_axis``. On the Frame Builder's XY-plane
        sketches (Z-up), the world X axis is in-plane and projects as the
        sketch's horizontal reference line. Stored under the bare key
        ``"X_AXIS"`` in the sketch's ``entity_map``, mirroring the
        ``Y_AXIS`` convention so constraint ``Targets`` can reference
        either by bare token.

        Skipped-not-raised on failure for the same reason as
        ``_project_y_axis``: sketches on planes where the world X axis
        is perpendicular (YZ-plane sketches) would fail this call with
        "axis is normal to sketch plane" — log and move on rather than
        take the whole parametric build down over a reference line the
        template may not need.
        """
        try:
            x_axis = self.ctx.design.rootComponent.xConstructionAxis
            proj_axis = sketch.project(x_axis)
            if proj_axis.count > 0:
                self.ctx.entity_map[sketch_name]["X_AXIS"] = proj_axis.item(0)
                self.ctx.logger.log(f"X_AXIS projected into {sketch_name}")
        except Exception as e:
            self.ctx.logger.log(f"X_AXIS projection skipped: {e}", "WARNING")

