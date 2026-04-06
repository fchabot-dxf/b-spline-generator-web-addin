import adsk.core, adsk.fusion, traceback
import time
from . import resolver, geometry_handler, constraint_handler, dimension_handler, projection_handler, step_handler

class ParametricSketchBuilder:
    """Modular Orchestrator that coordinates sketch construction handlers."""
    def __init__(self, target_comp, design, logger, prefix="T2", local_values=None):
        self.target = target_comp
        self.design = design
        self.logger = logger
        self.prefix = prefix
        self.resolver = resolver.Resolver(design, logger, local_values)
        self.entity_map = {} 
        self.feature_count = 1

    def _set_id(self, entity, s_name, kind, override_id=None):
        if not entity: return False
        final_id = override_id if override_id else f"{kind}_{self.feature_count}"
        self.feature_count += 1
        
        if s_name not in self.entity_map: self.entity_map[s_name] = {}
        self.entity_map[s_name][final_id] = entity
        
        try:
            if hasattr(entity, 'name'):
                try: entity.name = final_id
                except: pass
            if hasattr(entity, 'attributes'):
                entity.attributes.add('FrameBuilder', 'name', final_id)
            # Register endpoint/center points as first-class entity_map entries
            # so templates can reference them directly by ID (e.g. "skel_shoulder_pin_R:S")
            for suffix, attr in [('S', 'startSketchPoint'), ('E', 'endSketchPoint'), ('C', 'centerSketchPoint')]:
                if hasattr(entity, attr):
                    pt = getattr(entity, attr)
                    if pt:
                        pt_id = f"{final_id}:{suffix}"
                        self.entity_map[s_name][pt_id] = pt
                        if hasattr(pt, 'attributes'):
                            pt.attributes.add('FrameBuilder', 'name', pt_id)
            return True
        except: return True

    def build_template(self, template):
        start = time.time()
        self.logger.log(f"--- START MODULAR BUILD: {template.get('Name', 'Unnamed')} ---", "BUILD")
        
        for p in template.get("Parameters", []):
            if not self.resolver.is_spec_enabled(p, p.get("Name")): continue
            name, unit = p["Name"], p.get("Unit", "cm")
            val = self.resolver.resolve(p.get("Val", 0))
            
            existing = self.design.userParameters.itemByName(name)
            if not existing:
                self.design.userParameters.add(name, adsk.core.ValueInput.createByReal(val), unit, "")
                self.logger.log(f"   (PARAM) NEW: {name}={val} {unit}", "BUILD")
            else:
                self.logger.log(f"   (PARAM) PRESERVE: {name}={existing.value}", "BUILD")

        for sketch_spec in template.get("Sketches", []):
            self.build_sketch(sketch_spec)
            
        self.logger.log(f"--- FINISH BUILD in {time.time()-start:.2f}s ---", "BUILD")

    def build_sketch(self, spec):
        s_name = f"{self.prefix}_{spec['Name']}"
        self.logger.log(f"BUILDING {s_name}", "BUILD")
        
        sketch = self.target.sketches.add(self.target.xZConstructionPlane)
        sketch.name = s_name
        self.entity_map[s_name] = {"ORIGIN": sketch.originPoint}
        y_axis_proj = sketch.project(self.target.zConstructionAxis)
        if y_axis_proj and y_axis_proj.count > 0:
            self._set_id(y_axis_proj.item(0), s_name, "proj", override_id="Y_AXIS")
        
        geo = geometry_handler.GeometryHandler(sketch, self.resolver, self.logger, self._set_id)
        con = constraint_handler.ConstraintHandler(sketch, self.entity_map, self.logger)
        dim = dimension_handler.DimensionHandler(sketch, self.entity_map, self.logger)
        pro = projection_handler.ProjectionHandler(sketch, self.entity_map, self.logger, self._set_id)
        stp = step_handler.StepHandler(sketch, self.resolver, self.logger, self._set_id)

        # DEBUG: Log all available keys in the template
        self.logger.log(f"   [DEBUG] Available Phase Keys: {list(spec.keys())}", "BUILD")

        for p in spec.get('BoundingBoxProjections', []): pro.handle_proj(s_name, p, self.prefix)
        for p in spec.get('SkeletonProjections', []): pro.handle_proj(s_name, p, self.prefix)
        
        def _dispatch_geo(g, emap):
            t = g.get('Type')
            self.logger.log(f"   [GEO] Dispatching {g.get('ID', '?')} ({t})", "BUILD")
            if   t == 'Line': geo.line_step(s_name, g, emap)
            elif t in ('Arc', 'Arc3Point'): geo.arc_3pt_step(s_name, g, emap)
            elif t in ('Rectangle', 'RectangleCenter'): geo.rect_center_step(s_name, g, emap)

        sketch.isComputeDeferred = True
        
        # Phase 1: Pre-Geometry
        pg_list = spec.get('PreGeometry', [])
        if pg_list: self.logger.log(f"   [PHASE] Entering Pre-Geometry ({len(pg_list)} items)", "BUILD")
        for g in pg_list:
            if not self.resolver.is_spec_enabled(g, g.get('ID')): continue
            _dispatch_geo(g, self.entity_map)
        
        # Phase 2: Pre-Constraints
        pc1_list = spec.get('PreConstraints', [])
        if pc1_list: self.logger.log(f"   [PHASE] Entering Pre-Constraints ({len(pc1_list)} items)", "BUILD")
        for r in pc1_list:
            if not self.resolver.is_spec_enabled(r): continue
            con.handle_rel(s_name, r)

        # Phase 4: Geometry
        g_list = spec.get('Geometry', [])
        if g_list: self.logger.log(f"   [PHASE] Entering Main Geometry ({len(g_list)} items)", "BUILD")
        for g in g_list:
            if not self.resolver.is_spec_enabled(g, g.get('ID')): continue
            _dispatch_geo(g, self.entity_map)
            
        # Phase 5: Constraints
        c_list = spec.get('Constraints', [])
        if c_list: self.logger.log(f"   [PHASE] Entering Constraints ({len(c_list)} items)", "BUILD")
        for r in c_list:
            if not self.resolver.is_spec_enabled(r): continue
            con.handle_rel(s_name, r)
            
        # Phase 6: Post-Geometry
        pg2_list = spec.get('PostGeometry', spec.get('Post-Geometry', spec.get('Post_Geometry', [])))
        if pg2_list: self.logger.log(f"   [PHASE] Entering Post-Geometry ({len(pg2_list)} items)", "BUILD")
        else: self.logger.log(f"   [DEBUG] No Post-Geometry found (Checked: PostGeometry, Post-Geometry, Post_Geometry)", "BUILD")
        for g in pg2_list:
            if not self.resolver.is_spec_enabled(g, g.get('ID')): continue
            _dispatch_geo(g, self.entity_map)
            
        # Phase 7.5: Temp Dimensions — guidance seeds applied BEFORE tangency, then deleted.
        # These are unconditional (no EnabledParam gating); they simply nudge geometry
        # into a sensible position so the solver has a good starting state for tangency.
        td_list = spec.get('TempDimensions', [])
        if td_list: self.logger.log(f"   [PHASE] Entering TempDimensions ({len(td_list)} items)", "BUILD")
        sketch.isComputeDeferred = False
        temp_dim_names = []
        for d in td_list:
            result = dim.handle_dim(s_name, d, is_snap_only=False)
            if result:
                temp_dim_names.append(d.get('Name') or d.get('ID'))
        sketch.isComputeDeferred = True

        # Phase 7.55: Pre-Tangent Dimensions — permanent parametric dims (e.g. TopGap, BottomGap)
        # applied WITH isComputeDeferred=False so the solver settles before tangency fires.
        # EnabledParam / BlockedParam gating is respected here.
        ptd_list = spec.get('PreTangentDimensions', [])
        if ptd_list: self.logger.log(f"   [PHASE] Entering PreTangentDimensions ({len(ptd_list)} items)", "BUILD")
        sketch.isComputeDeferred = False
        for d in ptd_list:
            if self.resolver.is_spec_enabled(d, d.get('ID') or d.get('Name')):
                dim.handle_dim(s_name, d, is_snap_only=False)
        sketch.isComputeDeferred = True

        # Phase 8: Tangent Constraints — fired BEFORE PostConstraints so arc centers
        # still have at least one free DOF. Once PostConstraints pins each arc center
        # to a skeleton pin endpoint the DOF drops to zero and the VCS rejects any
        # new constraint, including a geometrically valid tangency.
        tc_list = spec.get('TangentConstraints', [])
        if tc_list: self.logger.log(f"   [PHASE] Entering TangentConstraints ({len(tc_list)} items)", "BUILD")
        for t_spec in tc_list:
            if not self.resolver.is_spec_enabled(t_spec): continue
            targets = f"{t_spec.get('Source')} ↔ {t_spec.get('Target')}"
            t1 = con._resolve_target(t_spec.get('Source'), s_name)
            t2 = con._resolve_target(t_spec.get('Target'), s_name)
            if not t1 or not t2:
                self.logger.log(f"   (SKIP) Tangent {targets}: entity not found", "WARNING")
                continue
            sketch.isComputeDeferred = False
            try:
                sketch.geometricConstraints.addTangent(t1, t2)
                self.logger.log(f"   (OK) Tangent {targets}", "SKETCH")
            except Exception as e:
                # Settle-flip nudge: force VCS to fully solve then retry once
                sketch.isComputeDeferred = True
                sketch.isComputeDeferred = False
                try:
                    sketch.geometricConstraints.addTangent(t1, t2)
                    self.logger.log(f"   (OK/NUDGE) Tangent {targets} after nudge", "SKETCH")
                except Exception as e2:
                    self.logger.log(f"   (FAIL) Tangent {targets}: {str(e2)[:80]}", "WARNING")
            sketch.isComputeDeferred = True

        # Phase 9: Post-Constraints — arc-center cross-pins to skeleton pin endpoints,
        # plus surround_rect:C→ORIGIN coincident. Runs AFTER tangency so arc centers
        # are still free (≥1 DOF) when tangency fires above.
        pc2_list = spec.get('PostConstraints', spec.get('Post-Constraints', spec.get('Post_Constraints', [])))
        if pc2_list: self.logger.log(f"   [PHASE] Entering Post-Constraints ({len(pc2_list)} items)", "BUILD")
        sketch.isComputeDeferred = False
        for r in pc2_list:
            if not self.resolver.is_spec_enabled(r): continue
            con.handle_rel(s_name, r)
        sketch.isComputeDeferred = True

        # Delete TempDimensions now that PostConstraints has fully settled geometry
        if temp_dim_names:
            self.logger.log(f"   [PHASE] Deleting {len(temp_dim_names)} TempDimensions", "BUILD")
            sketch.isComputeDeferred = False
            for tname in temp_dim_names:
                ent = self.entity_map.get(s_name, {}).get(tname)
                if ent:
                    try:
                        ent.deleteMe()
                        self.logger.log(f"   (DEL) TempDim '{tname}' removed", "BUILD")
                    except Exception as e:
                        self.logger.log(f"   (SKIP) TempDim '{tname}' del failed: {str(e)[:60]}", "WARNING")
            sketch.isComputeDeferred = True

        # Phase 10: Dimensions — remaining parametric dimensions
        d_list = spec.get('Dimensions', [])
        if d_list: self.logger.log(f"   [PHASE] Entering Dimensions ({len(d_list)} items)", "BUILD")
        sketch.isComputeDeferred = False
        for d in d_list:
            if not self.resolver.is_spec_enabled(d, d.get('ID') or d.get('Name')): continue
            dim.handle_dim(s_name, d, is_snap_only=False)
        sketch.isComputeDeferred = True

        # Phase 11: Steps — final advanced operations (Offset, special Lines)
        # These are processed last to ensure all base geometry and dimensions are stable.
        s_list = spec.get('Steps', [])
        if s_list:
            self.logger.log(f"   [PHASE] Entering Steps ({len(s_list)} items) in '{s_name}'", "BUILD")
            sketch.isComputeDeferred = False
            for s in s_list:
                if not self.resolver.is_spec_enabled(s, s.get('ID')): continue
                t = s.get('Type')
                if t == 'Offset': stp.offset_step(s_name, s, self.entity_map)
                elif t == 'Line': stp.line_step(s_name, s, self.entity_map)
            sketch.isComputeDeferred = True

        # Final settle
        sketch.isComputeDeferred = False
        sketch.isComputeDeferred = True
        self.logger.log(f"DONE {s_name}", "BUILD")