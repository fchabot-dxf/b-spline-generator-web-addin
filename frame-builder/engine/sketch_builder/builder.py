import adsk.core, adsk.fusion, traceback
import importlib
import time
from . import resolver, geometry_handler, constraint_handler, dimension_handler, projection_handler, step_handler

# Force internal reload to ensure every component sees the latest fixes
for mod in [resolver, geometry_handler, constraint_handler, dimension_handler, projection_handler, step_handler]:
    importlib.reload(mod)

class ParametricSketchBuilder:
    """Orchestrates phased geometric construction across multiple handlers with Soft Seed recovery."""
    def __init__(self, target_comp, design, logger, prefix="T2", local_values=None):
        self.target = target_comp
        self.design = design
        self.logger = logger
        self.prefix = prefix
        self.local_values = local_values or {}
        self.resolver = resolver.ValueResolver(design, logger, self.local_values)
        
        self.sketches = {}
        self.entity_map = {}
        self.feature_count = 1

    def _set_id(self, entity, sketch_name, base_type, override_id=None):
        """Standardizes naming and registration for geometric entities."""
        ent_id = override_id or f"{base_type}_{self.feature_count}"
        if sketch_name not in self.entity_map: self.entity_map[sketch_name] = {}
        self.entity_map[sketch_name][ent_id] = entity
        
        # 3. Native Fusion Naming (For searchability and inspection)
        if hasattr(entity, 'name'):
            try: entity.name = ent_id
            except: pass # some entities don't support naming (like points)
            
        # 4. Attribute Injection (Permanent Metadata for points and Curves)
        try:
            # We use a standard namespace for the engine to allow discovery by Fusion-ID v9 or other tools
            entity.attributes.add("ParametricEngine", "ID", ent_id)
        except: pass
        
        self.logger.log_sketch(f"   [REGISTER] {ent_id} ({base_type})", "DEBUG")
        
        if not override_id: self.feature_count += 1
        return ent_id

    def _is_spec_enabled(self, spec):
        """Checks 'EnabledParam' and 'BlockedParam' in the spec to determine active status."""
        en_param = spec.get('EnabledParam')
        if en_param:
            val = self.local_values.get(en_param, 1.0) # Default to ON
            if val < 0.5: return False
            
        block_param = spec.get('BlockedParam')
        if block_param:
            val = self.local_values.get(block_param, 0.0) # Default to OFF
            if val > 0.5: return False
            
        return True

    def build_template_with_retry(self, template, max_retries=3):
        """Robust entry point with parameter nudging for recovery."""
        for attempt in range(max_retries):
            try:
                self.build_template(template)
                return True
            except Exception as e:
                self.logger.log_sketch(f"   (RETRY) Attempt {attempt + 1} failed: {e}", "WARNING")
                if attempt < max_retries - 1:
                    self._nudge_local_values()
                    self._cleanup_failed_attempt()
                else: raise e
        return False

    def _nudge_local_values(self):
        for k in self.local_values:
            if isinstance(self.local_values[k], (int, float)) and not k.startswith('en_'):
                self.local_values[k] *= 1.002

    def _cleanup_failed_attempt(self):
        for sk in list(self.sketches.values()):
            if sk.isValid: sk.deleteMe()
        self.sketches = {}
        self.entity_map = {}
        self.feature_count = 1

    def build_template(self, template):
        t_name = template.get('Name', 'Unnamed')
        self.logger.log_sketch(f"STARTING SYNTHESIS (Modular-v2): {t_name}")
        for sketch_spec in template.get("Sketches", []):
            try: self.build_sketch(sketch_spec)
            except Exception as e: self.logger.log_error(f"Sketch Build Failed: {e}")
        self.logger.log_sketch("SYNTHESIS COMPLETE (Modular-v2 Architecture)")

    def build_sketch(self, sketch_spec):
        sketch_name = f"{self.prefix}_{sketch_spec['Name']}"
        self.logger.log_sketch(f"PHASE: Sketch {sketch_name}")
        
        sketch = self.target.sketches.add(self.target.xZConstructionPlane)
        sketch.name = sketch_name
        self.sketches[sketch_name] = sketch
        
        origin = sketch.originPoint
        
        # Project Native Origin Axes into the sketch (Official API approach)
        # Note: On XZ Plane, 'Vertical' is the Global Z-Axis.
        proj_x, proj_z = None, None
        try:
            proj_x = sketch.project(self.target.xOriginAxis).item(0)
            proj_z = sketch.project(self.target.zOriginAxis).item(0)
            self.logger.log_sketch(f"   (AXIS) Projected native axes (X, Z) in {sketch_name}", "DEBUG")
        except:
            # FALLBACK: Create physical construction axes if projection fails AND sketch is empty
            if sketch.sketchCurves.count == 0:
                lines = sketch.sketchCurves.sketchLines
                proj_x = lines.addByTwoPoints(origin, adsk.core.Point3D.create(1.0, 0, 0))
                proj_z = lines.addByTwoPoints(origin, adsk.core.Point3D.create(0, 1.0, 0))
                proj_x.isConstruction = True
                proj_z.isConstruction = True
                sketch.geometricConstraints.addHorizontal(proj_x)
                sketch.geometricConstraints.addVertical(proj_z)
                self.logger.log_sketch(f"   (AXIS) Fallback: Drew construction axes in {sketch_name}", "DEBUG")
            else:
                self.logger.log_sketch(f"   (AXIS) Skip fallback: Geometry already exists in {sketch_name}", "DEBUG")

        # Guaranteed Registration
        if proj_x: proj_x.isConstruction = True
        if proj_z: proj_z.isConstruction = True
        
        self.entity_map[sketch_name] = {
            "ORIGIN": origin,
            "X_AXIS": proj_x,
            "Y_AXIS": proj_z   # Z-axis acts as the 'Y' (Vertical) in an XZ sketch
        }
        
        gh = geometry_handler.GeometryHandler(sketch, self.resolver, self.logger, self._set_id)
        ch = constraint_handler.ConstraintHandler(sketch, self.logger)
        dh = dimension_handler.DimensionHandler(sketch, self.resolver, self.logger)
        ph = projection_handler.ProjectionHandler(sketch, self.logger, self._set_id)
        sh = step_handler.StepHandler(sketch, self.resolver, self.logger, self._set_id)

        # 1. Projections
        for proj in sketch_spec.get("SkeletonProjections", []) + sketch_spec.get("BoundingBoxProjections", []):
            ph.project_step(sketch_name, proj, self.entity_map)

        # 2. Phased Geometry/Constraints (Retry-Drop Ready)
        phases = [("PreGeometry", "PreConstraints"), ("Geometry", "Constraints"), ("PostGeometry", "PostConstraints")]
        for g_phase, c_phase in phases:
            sketch.isComputeDeferred = True
            for spec in sketch_spec.get(g_phase, []):
                if self._is_spec_enabled(spec):
                    try:
                        t = spec['Type']
                        if t == "Line": gh.line_step(sketch_name, spec, self.entity_map)
                        elif t == "Arc": gh.arc_step(sketch_name, spec, self.entity_map)
                        elif t == "Arc3Point": gh.arc_3pt_step(sketch_name, spec, self.entity_map)
                        elif t in ["Rectangle", "RectangleCenter"]: gh.rect_center_step(sketch_name, spec, self.entity_map)
                    except Exception as e: self.logger.log_sketch(f"   (DROPPED) {g_phase}: {e}")

            for spec in sketch_spec.get(c_phase, []):
                if self._is_spec_enabled(spec):
                    try: ch.constraint_step(sketch_name, spec, self.entity_map)
                    except Exception as e: self.logger.log_sketch(f"   (DROPPED) {c_phase}: {spec.get('Type','?')}")
            sketch.isComputeDeferred = False

        # 3. Dimensions (with DIM SOFT SEED support)
        for dim in sketch_spec.get("Dimensions", []):
            # If feature is disabled, run as Soft Seed (Apply + Move + Delete)
            is_enabled = self._is_spec_enabled(dim)
            try:
                dh.dimension_step(sketch_name, dim, self.entity_map, is_soft_seed=(not is_enabled))
            except Exception as e:
                self.logger.log_sketch(f"   (DROPPED) DIM: {dim.get('Name','?')} -> {e}")
                
        # 4. Steps (Offset, etc.)
        for step in sketch_spec.get("Steps", []):
            if self._is_spec_enabled(step):
                try:
                    t = step.get('Type')
                    if t == "Offset": sh.offset_step(sketch_name, step, self.entity_map)
                    elif t == "Line": gh.line_step(sketch_name, step, self.entity_map)
                    elif t in ["Coincident", "Horizontal", "Vertical", "Tangent"]:
                        ch.constraint_step(sketch_name, step, self.entity_map)
                except Exception as e: self.logger.log_sketch(f"   (DROPPED) STEP: {step.get('Type','?')} -> {e}")
            
        self.logger.log_sketch(f"DONE: {sketch_name}")
