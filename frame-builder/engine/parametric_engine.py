import adsk.core, adsk.fusion, traceback
import os
import math

class ParametricSketchBuilder:
    """
    Python-Native Parametric Engine (Instrumented).
    Hardened for unit-consistency and scale debugging.
    """
    def __init__(self, target, design, logger, prefix="T1"):
        self.app = adsk.core.Application.get()
        self.ui = self.app.userInterface
        self.target = target 
        self.design = design
        self.user_params = design.userParameters
        self.logger = logger
        self.prefix = prefix
        self.sketches = {} 
        self.entity_map = {} 
        self.feature_count = 1

    def _resolve_val(self, val):
        """Resolves a number or string expression (e.g. 'widthIn/2') to a float in CM."""
        if val is None: return 0.0
        if isinstance(val, (int, float)): return float(val)
        if isinstance(val, str):
            try: return float(val)
            except:
                try: 
                    # Use cm (database units) for resolution to ensure coordinate consistency
                    resolved = self.design.unitsManager.evaluateExpression(val, "cm")
                    self.logger.log(f"RESOLVED: {val} -> {resolved:.3f} cm")
                    return resolved
                except: 
                    self.logger.log_error(f"FAIL RESOLVE: {val}")
                    return 0.0
        return 0.0

    def build_template(self, template):
        self.logger.log(f"Building Template: {template.get('Name', 'Unnamed')}")
        
        # 1. Sync template parameters ONLY if they don't exist (protect measured values)
        for p in template.get("Parameters", []):
            name, v, unit = p["Name"], p.get("Val", p.get("Value", 0)), p["Unit"]
            existing = self.user_params.itemByName(name)
            if not existing:
                self._create_or_update_param(name, v, unit)
            else:
                self.logger.log(f"PRESERVING MODEL PARAM: {name} (Template default {v} skipped)")

        # 2. Iterate through sketches
        for sketch_spec in template.get("Sketches", []):
            try:
                self.logger.log(f"--- Creating Sketch: {sketch_spec['Name']} ---")
                self.build_sketch(sketch_spec)
            except:
                self.logger.log_error(f"CRASH in Sketch {sketch_spec['Name']}:\n{traceback.format_exc()}")
        
        self.logger.log("PARASYNTHESIS COMPLETE: Frame Logic Fully Built", "INFO")
        self.logger.log("SYNTHESIS COMPLETE")

    def build_sketch(self, sketch_spec):
        sketch_name = f"{self.prefix}_{sketch_spec['Name']}"
        sketch = self.target.sketches.add(self.target.xZConstructionPlane)
        sketch.name = sketch_name
        self.sketches[sketch_name] = sketch
        self.entity_map[sketch_name] = {"ORIGIN": sketch.originPoint}
        # Project the vertical origin axis (Z axis on XZ plane) into the sketch
        try:
            z_axis = self.design.rootComponent.zConstructionAxis
            proj_axis = sketch.project(z_axis)
            if proj_axis.count > 0:
                self.entity_map[sketch_name]["Y_AXIS"] = proj_axis.item(0)
                self.logger.log(f"Y_AXIS projected into {sketch_name}")
        except Exception as e:
            self.logger.log(f"Y_AXIS projection skipped: {e}", "WARNING")
        
        # Build sequence:
        # 0. Projections (reference geometry from other sketches)
        # 1. PreGeometry (skeleton pins — before arcs)
        # 2. PreConstraints (skeleton H/V, Equal — before arcs exist)
        # 3. Geometry (manifold lines, arcs)
        # 4. Constraints (coincident chain, tangent, pin-to-arc)
        # 5. Dimensions (parametric size — lock size before offset)
        # 6. VolatileDimensions (secondary dims)
        # 7. Offsets (legacy direct offsets)
        # 8. Steps (offset, etc. — runs on fully constrained geometry)
        bbox_projs = sketch_spec.get("BoundingBoxProjections", [])
        skel_projs = sketch_spec.get("SkeletonProjections", [])
        projs = sketch_spec.get("Projections", [])  # fallback for legacy
        pre_geoms = sketch_spec.get("PreGeometry", [])
        pre_constrs = sketch_spec.get("PreConstraints", [])
        pre_dims = sketch_spec.get("PreDimensions", [])
        geoms = sketch_spec.get("Geometry", [])
        constrs = sketch_spec.get("Constraints", [])
        post_geoms = sketch_spec.get("PostGeometry", [])
        post_constrs = sketch_spec.get("PostConstraints", [])
        dims = sketch_spec.get("Dimensions", [])
        vdims = sketch_spec.get("VolatileDimensions", [])
        offs = sketch_spec.get("Offsets", [])
        steps = sketch_spec.get("Steps", [])

        self.logger.log(f"SKETCH PLAN [{sketch_name}]: {len(bbox_projs)}bbox_proj {len(skel_projs)}skel_proj {len(projs)}proj {len(pre_geoms)}pre_geom {len(pre_constrs)}pre_constr {len(pre_dims)}pre_dim {len(geoms)}geom {len(constrs)}constr {len(post_geoms)}post_geom {len(post_constrs)}post_constr {len(dims)}dim {len(vdims)}vdim {len(offs)}off {len(steps)}step")

        # Deferred compute PER PHASE: batch within each phase, recompute between phases.
        # This lets the solver settle each phase before the next begins.

        # --- PHASE: Bounding Box Projections ---
        self.logger.log(f"START BoundingBoxProjections phase for {sketch_name} ({len(bbox_projs)} items)")
        sketch.isComputeDeferred = True
        bbox_proj_names = []
        for proj in bbox_projs:
            name = self._project_step(sketch, sketch_name, proj)
            if name:
                bbox_proj_names.append(name)
        sketch.isComputeDeferred = False
        self.logger.log(f"PHASE DONE: BoundingBoxProjections ({len(bbox_projs)}) - Projected: {bbox_proj_names}")

        # --- PHASE: Skeleton Projections ---
        self.logger.log(f"START SkeletonProjections phase for {sketch_name} ({len(skel_projs)} items)")
        sketch.isComputeDeferred = True
        skel_proj_names = []
        for proj in skel_projs:
            name = self._project_step(sketch, sketch_name, proj)
            if name:
                skel_proj_names.append(name)
        sketch.isComputeDeferred = False
        self.logger.log(f"PHASE DONE: SkeletonProjections ({len(skel_projs)}) - Projected: {skel_proj_names}")

        # --- PHASE: Legacy Projections (if any) ---
        if projs:
            self.logger.log(f"START Legacy Projections phase for {sketch_name} ({len(projs)} items)")
            sketch.isComputeDeferred = True
            legacy_proj_names = []
            for proj in projs:
                name = self._project_step(sketch, sketch_name, proj)
                if name:
                    legacy_proj_names.append(name)
            sketch.isComputeDeferred = False
            self.logger.log(f"PHASE DONE: Projections ({len(projs)}) - Projected: {legacy_proj_names}")

        # --- PHASE: PreGeometry + PreConstraints + PreDimensions ---
        sketch.isComputeDeferred = True
        for geom in pre_geoms: self._geom_step(sketch, sketch_name, geom)
        for rel in pre_constrs: self._constraint_step(sketch, sketch_name, rel)
        for dim in pre_dims: self._dimension_step(sketch, sketch_name, dim)
        sketch.isComputeDeferred = False
        self.logger.log(f"PHASE DONE: Pre ({len(pre_geoms)}geom {len(pre_constrs)}constr {len(pre_dims)}dim)")

        # --- PHASE: Geometry + Constraints ---
        sketch.isComputeDeferred = True
        for geom in geoms: self._geom_step(sketch, sketch_name, geom)
        for rel in constrs: self._constraint_step(sketch, sketch_name, rel)
        sketch.isComputeDeferred = False
        self.logger.log(f"PHASE DONE: Main ({len(geoms)}geom {len(constrs)}constr)")

        # --- PHASE: PostGeometry + PostConstraints ---
        sketch.isComputeDeferred = True
        for geom in post_geoms: self._geom_step(sketch, sketch_name, geom)
        for rel in post_constrs: self._constraint_step(sketch, sketch_name, rel)
        sketch.isComputeDeferred = False
        self.logger.log(f"PHASE DONE: Post ({len(post_geoms)}geom {len(post_constrs)}constr)")

        # --- PHASE: Dimensions ---
        sketch.isComputeDeferred = True
        for dim in dims: self._dimension_step(sketch, sketch_name, dim)
        for vdim in vdims: self._dimension_step(sketch, sketch_name, vdim)
        sketch.isComputeDeferred = False
        self.logger.log(f"PHASE DONE: Dimensions ({len(dims)}dim {len(vdims)}vdim)")

        # --- PHASE: Offsets + Steps ---
        sketch.isComputeDeferred = True
        for off in offs: self._offset_step(sketch, sketch_name, off)
        for step in steps: self._step_step(sketch, sketch_name, step)
        sketch.isComputeDeferred = False
        self.logger.log(f"PHASE DONE: Steps ({len(offs)}off {len(steps)}step)")

    def _create_or_update_param(self, name, val, unit):
        try:
            param = self.user_params.itemByName(name)
            val_input = adsk.core.ValueInput.createByString(str(val))
            if param: 
                param.expression = str(val)
                self.logger.log(f"PARAM SYNC: {name} = {val}")
            else: 
                self.user_params.add(name, val_input, unit, "Frame Builder Parameter")
                self.logger.log(f"PARAM NEW: {name} = {val} ({unit})")
        except:
            self.logger.log_error(f"Param Sync Failed: {name}")

    def _geom_step(self, sketch, s_name, geom):
        id, type, curves = geom["ID"], geom["Type"], sketch.sketchCurves
        entity = None

        if type == "Line":
            p1 = adsk.core.Point3D.create(self._resolve_val(geom["Points"][0][0]), self._resolve_val(geom["Points"][0][1]), 0)
            p2 = adsk.core.Point3D.create(self._resolve_val(geom["Points"][1][0]), self._resolve_val(geom["Points"][1][1]), 0)
            entity = curves.sketchLines.addByTwoPoints(p1, p2)
            self.logger.log(f"LINE {id}: ({p1.x:.2f},{p1.y:.2f}) -> ({p2.x:.2f},{p2.y:.2f})")
            # Assign semantic IDs to endpoints if provided
            start_id = geom.get("StartID")
            end_id = geom.get("EndID")
            if start_id:
                self._set_id(entity.startSketchPoint, s_name, "point", override_id=start_id)
            if end_id:
                self._set_id(entity.endSketchPoint, s_name, "point", override_id=end_id)
        
        elif type == "Arc3Point":
            pts = [adsk.core.Point3D.create(self._resolve_val(p[0]), self._resolve_val(p[1]), 0) for p in geom["Points"]]
            entity = curves.sketchArcs.addByThreePoints(pts[0], pts[1], pts[2])
            self._set_id(entity.centerSketchPoint, s_name, "point", override_id=f"{id}:C")
            self.logger.log(f"ARC {id}: P1({pts[0].x:.2f},{pts[0].y:.2f}) P2({pts[1].x:.2f},{pts[1].y:.2f})")

        elif type in ("Rectangle", "RectangleCenter"):
            cp = adsk.core.Point3D.create(self._resolve_val(geom["Center"][0]), self._resolve_val(geom["Center"][1]), 0)
            w = self._resolve_val(geom["Size"][0])
            h = self._resolve_val(geom["Size"][1])
            corner = adsk.core.Point3D.create(cp.x + w/2, cp.y + h/2, 0)
            rect = curves.sketchLines.addCenterPointRectangle(cp, corner)
            self.logger.log(f"RECT {id}: Center({cp.x:.2f},{cp.y:.2f}) Total Lines: {rect.count}")
            
            # 1. Name the 4 boundary lines
            ids = geom.get("LineIDs", [f"{id}_L{i}" for i in range(4)])
            for i in range(min(rect.count, 4)): 
                self._set_id(rect.item(i), s_name, "line", override_id=ids[i])
            
            # 2. Name and flag diagonals (Lines 4 & 5 in Fusion's SketchLineList for center-rect)
            if rect.count >= 6:
                for i in range(4, 6):
                    diag = rect.item(i)
                    diag.isConstruction = True
                    self._set_id(diag, s_name, "line", override_id=f"{id}_diag{i-3}")

                # Center Point from diagonal intersection
                self._set_id(rect.item(4).startSketchPoint, s_name, "point", override_id=f"{id}:C")
                self.logger.log(f"RECT {id}: Diagonals found in API result ({rect.count} items)")
            else:
                # Fusion didn't return diagonals — create manually using Fusion's own pattern:
                # 1. Draw diags with endpoints offset from corners (outside 0.01cm merge zone)
                # 2. Coincident-snap diag endpoints to rect corners
                # 3. Add a sketch point, coincident to diag1, then diag2 (forces intersection)
                # 4. Coincident that point to origin
                self.logger.log(f"RECT {id}: No diagonals from API ({rect.count} items), creating manually")
                corners = []
                for i in range(min(rect.count, 4)):
                    corners.append(rect.item(i).startSketchPoint)

                diag1 = None
                diag2 = None
                if len(corners) == 4:
                    nudge = 1.0  # cm — well outside Fusion's 0.01cm merge tolerance

                    # --- Diagonal 1: corners[0] to corners[2] ---
                    try:
                        p0 = corners[0].geometry
                        p2 = corners[2].geometry
                        mid_x = (p0.x + p2.x) / 2
                        mid_y = (p0.y + p2.y) / 2
                        diag1 = curves.sketchLines.addByTwoPoints(
                            adsk.core.Point3D.create(mid_x - nudge, mid_y - nudge, 0),
                            adsk.core.Point3D.create(mid_x + nudge, mid_y + nudge, 0)
                        )
                        diag1.isConstruction = True
                        self._set_id(diag1, s_name, "line", override_id=f"{id}_diag1")
                        sketch.geometricConstraints.addCoincident(diag1.startSketchPoint, corners[0])
                        sketch.geometricConstraints.addCoincident(diag1.endSketchPoint, corners[2])
                        self.logger.log(f"RECT {id}: Diag1 OK (corners 0-2)")
                    except Exception as e:
                        self.logger.log_error(f"RECT {id}: Diag1 FAIL: {e}")

                    # --- Diagonal 2: corners[1] to corners[3] ---
                    try:
                        p1 = corners[1].geometry
                        p3 = corners[3].geometry
                        mid_x = (p1.x + p3.x) / 2
                        mid_y = (p1.y + p3.y) / 2
                        diag2 = curves.sketchLines.addByTwoPoints(
                            adsk.core.Point3D.create(mid_x - nudge, mid_y - nudge, 0),
                            adsk.core.Point3D.create(mid_x + nudge, mid_y + nudge, 0)
                        )
                        diag2.isConstruction = True
                        self._set_id(diag2, s_name, "line", override_id=f"{id}_diag2")
                        sketch.geometricConstraints.addCoincident(diag2.startSketchPoint, corners[1])
                        sketch.geometricConstraints.addCoincident(diag2.endSketchPoint, corners[3])
                        self.logger.log(f"RECT {id}: Diag2 OK (corners 1-3)")
                    except Exception as e:
                        self.logger.log_error(f"RECT {id}: Diag2 FAIL: {e}")

                    # --- Center point: single point on diag1, coincident diag2, coincident origin ---
                    try:
                        center_pt = sketch.sketchPoints.add(adsk.core.Point3D.create(nudge, nudge, 0))
                        if diag1 and diag1.isValid:
                            sketch.geometricConstraints.addCoincident(center_pt, diag1)
                        if diag2 and diag2.isValid:
                            sketch.geometricConstraints.addCoincident(center_pt, diag2)
                        sketch.geometricConstraints.addCoincident(center_pt, sketch.originPoint)
                        self._set_id(center_pt, s_name, "point", override_id=f"{id}:C")
                        self.logger.log(f"RECT {id}: Center point on diag intersection + origin OK")
                    except Exception as e:
                        # Fallback: just map origin as center
                        self._set_id(sketch.originPoint, s_name, "point", override_id=f"{id}:C")
                        self.logger.log_error(f"RECT {id}: Center point FAIL ({e}), using origin")

            entity = rect.item(0)


        if entity:
            if geom.get("IsConstruction"): entity.isConstruction = True
            self._set_id(entity, s_name, "feature", override_id=id)

    def _project_step(self, sketch, s_name, proj):
        try:
            src_name = f"{self.prefix}_{proj['SourceSketch']}"
            base_id = proj["SourceID"].split(':')[0]
            src_ent = self.entity_map.get(src_name, {}).get(base_id)
            if not src_ent:
                self.logger.log(f"PROJECTION WARNING: Source entity {proj['SourceID']} not found in {src_name}", "WARNING")
                return None
            if ":" in proj["SourceID"] and src_ent:
                suff = proj["SourceID"].split(':')[1]
                if suff == "S": src_ent = src_ent.startSketchPoint
                elif suff == "E": src_ent = src_ent.endSketchPoint
                elif suff == "C": src_ent = src_ent.centerSketchPoint
            if not src_ent:
                self.logger.log(f"PROJECTION WARNING: Suffix entity {proj['SourceID']} not found in {src_name}", "WARNING")
                return None
            res = sketch.project(src_ent)
            # Assign unique semantic ID to every projected point or entity
            base_name = proj.get('SourceID', proj.get('TargetID', 'proj'))
            target_id = proj.get('TargetID')
            proj_names = []
            for i in range(res.count):
                # Prefer TargetID if present, else fallback to unique pattern
                proj_name = target_id if target_id and res.count == 1 else f"proj_{base_name}_{i}"
                self._set_id(res.item(i), s_name, "proj", override_id=proj_name)
                ent = res.item(i)
                coords = None
                ent_type = type(ent).__name__
                if hasattr(ent, 'geometry') and ent.geometry:
                    g = ent.geometry
                    coords = f"({getattr(g, 'x', '?'):.3f}, {getattr(g, 'y', '?'):.3f})"
                elif hasattr(ent, 'startSketchPoint') and ent.startSketchPoint and hasattr(ent.startSketchPoint, 'geometry'):
                    g = ent.startSketchPoint.geometry
                    coords = f"({getattr(g, 'x', '?'):.3f}, {getattr(g, 'y', '?'):.3f})"
                self.logger.log(f"PROJECTION: Source={proj['SourceSketch']}:{proj['SourceID']} Target={proj_name} Type={ent_type} Coords={coords if coords else '[no geometry]'} in {s_name}")
                proj_names.append(proj_name)
            return ", ".join(proj_names)
        except Exception as e:
            self.logger.log_error(f"PROJECT FAIL: {proj.get('TargetID', '?')} in {s_name}: {e}")
            return None

    def _offset_step(self, sketch, s_name, off):
        coll = adsk.core.ObjectCollection.create()
        for sid in off["SourceID"]:
            e = self.entity_map[s_name].get(sid)
            if e: coll.add(e)
            else: self.logger.log(f"OFFSET FAIL: Missing ID {sid} in {s_name}", "ERROR")

        try:
            d_val = self._resolve_val(off["DistanceExpr"])
            dir_raw = off.get("Direction") or [0.5, 0.5, 0]
            dir_pt = adsk.core.Point3D.create(dir_raw[0], dir_raw[1], 0)
            
            self.logger.log(f"OFFSET RUN: {s_name} Distance={d_val:.3f} cm at ({dir_pt.x},{dir_pt.y})")
            
            # Pass d_val (double/float) directly to the API
            try:
                offset_curves = sketch.offset(coll, dir_pt, d_val)
            except:
                self.logger.log(f"RETRYING OFFSET for {s_name} with negative distance", "WARNING")
                # Try the reverse direction if the primary one fails (solver instability)
                offset_curves = sketch.offset(coll, dir_pt, -d_val)
            
            if offset_curves and offset_curves.count > 0:
                self.logger.log(f"OFFSET SUCCESS: Generated {offset_curves.count} curves")
                t_ids = off.get("TargetIDs", [])
                for i in range(offset_curves.count):
                    if i < len(t_ids): self._set_id(offset_curves.item(i), s_name, "offset", override_id=t_ids[i])

                # --- Corner Identification (optional) ---
                # If CornerIDs provided, find the 4 unique sketch points from offset curves
                # and name them by geometric quadrant: TL, TR, BL, BR
                corner_ids = off.get("CornerIDs", {})
                if corner_ids:
                    self._identify_offset_corners(offset_curves, s_name, corner_ids)
            else:
                self.logger.log(f"OFFSET EMPTY: No curves returned for {s_name}", "WARNING")
        except:
            self.logger.log_error(f"OFFSET CRASH in {s_name}")

    def _step_step(self, sketch, s_name, step):
        step_type = step.get("Type")
        if step_type == "Offset":
            source = step.get("SourceID")
            if isinstance(source, str): source = [source]
            off = {
                "SourceID": source or [],
                "DistanceExpr": step.get("DistanceExpr", "0"),
                "Direction": step.get("Direction"),
                "TargetIDs": step.get("TargetIDs", []),
                "TargetID": step.get("TargetID"),
                "CornerIDs": step.get("CornerIDs", {})
            }
            self._offset_step(sketch, s_name, off)

            # If a single named target is requested, assign it to the result of the first curve
            if off.get("TargetID"):
                last_ids = off.get("TargetIDs", [])
                if not last_ids:
                    # map the first offset curve if any to the named output
                    for key in list(self.entity_map[s_name].keys()):
                        if key.startswith("offset-"):
                            self._set_id(self.entity_map[s_name][key], s_name, "offset", override_id=off["TargetID"])
                            break

    def _identify_offset_corners(self, offset_curves, s_name, corner_ids):
        """
        After a rectangular offset, collect the unique sketch points from the
        returned curves and name them by geometric quadrant position.
        corner_ids: {"TL": "id", "TR": "id", "BL": "id", "BR": "id"}
        """
        try:
            # Collect all unique sketch points from the offset curves
            seen_tokens = set()
            points = []
            for i in range(offset_curves.count):
                curve = offset_curves.item(i)
                if not curve.isValid:
                    continue
                for sp in [curve.startSketchPoint, curve.endSketchPoint]:
                    if not sp or not sp.isValid:
                        continue
                    token = sp.entityToken
                    if token not in seen_tokens:
                        seen_tokens.add(token)
                        points.append(sp)

            self.logger.log(f"CORNER ID: Found {len(points)} unique points from offset")

            if len(points) < 4:
                self.logger.log(f"CORNER ID: Expected 4 points, got {len(points)}", "WARNING")
                return

            # Sort by geometric position to assign quadrant names
            # TL = min X, max Y | TR = max X, max Y | BL = min X, min Y | BR = max X, min Y
            def geo(sp):
                g = sp.geometry
                return (g.x, g.y)

            pts_sorted = sorted(points, key=lambda sp: geo(sp))

            # Split into left pair (lowest X) and right pair (highest X)
            left_pair = sorted(pts_sorted[:2], key=lambda sp: sp.geometry.y, reverse=True)
            right_pair = sorted(pts_sorted[2:], key=lambda sp: sp.geometry.y, reverse=True)

            mapping = {
                "TL": left_pair[0],   # left, higher Y
                "BL": left_pair[1],   # left, lower Y
                "TR": right_pair[0],  # right, higher Y
                "BR": right_pair[1],  # right, lower Y
            }

            for key, sp in mapping.items():
                cid = corner_ids.get(key)
                if cid:
                    self._set_id(sp, s_name, "corner", override_id=cid)
                    g = sp.geometry
                    self.logger.log(f"CORNER {key} -> {cid}: ({g.x:.3f}, {g.y:.3f})")

        except Exception:
            self.logger.log_error(f"CORNER ID CRASH:\n{traceback.format_exc()}")

    def _set_id(self, entity, s_name, prefix, override_id=None):
        if not entity: return
        final_id = override_id if override_id else f"{prefix}-{self.feature_count}"
        self.feature_count += 1
        try:
            if hasattr(entity, 'attributes'):
                attr = entity.attributes.itemByName('FrameBuilder', 'name')
                if attr: attr.value = final_id
                else: entity.attributes.add('FrameBuilder', 'name', final_id)
            if hasattr(entity, 'name'): entity.name = final_id
            self.entity_map[s_name][final_id] = entity
        except: pass

    def _constraint_step(self, sketch, s_name, rel):
        g_map = self.entity_map[s_name]
        targets = []
        for t_id in rel["Targets"]:
            # First try the full ID (e.g. "main_bounding_rectangle:C") as a direct key
            ent = g_map.get(t_id)
            if not ent:
                # Fallback: split base:suffix and resolve from the base entity
                base = t_id.split(':')[0]
                ent = g_map.get(base)
                if not ent:
                    self.logger.log(f"CONSTRAINT MISS: {t_id} not found in {s_name}", "WARNING")
                    continue
                if ":" in t_id:
                    suff = t_id.split(':')[1]
                    if suff == "S": ent = ent.startSketchPoint
                    elif suff == "E": ent = ent.endSketchPoint
                    elif suff == "C" and hasattr(ent, 'centerSketchPoint'): ent = ent.centerSketchPoint
                    elif suff == "C":
                        self.logger.log(f"CONSTRAINT MISS: {t_id} — entity has no centerSketchPoint", "WARNING")
                        continue
            if ent: targets.append(ent)
        if len(targets) >= 1:
            c, t = sketch.geometricConstraints, rel["Type"]
            try:
                if t == "Coincident" and len(targets) == 2: c.addCoincident(targets[0], targets[1])
                elif t == "Collinear" and len(targets) == 2: c.addCollinear(targets[0], targets[1])
                elif t == "Horizontal": c.addHorizontal(targets[0])
                elif t == "Vertical": c.addVertical(targets[0])
                elif t == "Tangent" and len(targets) == 2: c.addTangent(targets[0], targets[1])
                elif t == "Parallel" and len(targets) == 2: c.addParallel(targets[0], targets[1])
                elif t == "Equal" and len(targets) == 2: c.addEqual(targets[0], targets[1])
                self.logger.log(f"CONSTRAINT OK: {t} on {rel['Targets']}")
            except Exception as e:
                self.logger.log(f"CONSTRAINT FAIL: {t} on {rel['Targets']}: {e}", "ERROR")
                # Enhanced: Log all constraints/dimensions involving these targets for diagnostics
                related = []
                for constr in self.sketches[s_name].geometricConstraints:
                    for tgt in targets:
                        if hasattr(constr, 'entityOne') and constr.entityOne == tgt:
                            related.append(str(constr))
                        if hasattr(constr, 'entityTwo') and constr.entityTwo == tgt:
                            related.append(str(constr))
                self.logger.log(f"RELATED CONSTRAINTS for {rel['Targets']}: {related}", "DEBUG")

    def _dimension_step(self, sketch, s_name, dim):
        g_map = self.entity_map[s_name]
        dim_name = dim.get("Name", "?")
        dim_target = dim.get("Target", "?")
        try:
            tgt = g_map.get(dim.get("Target"))
            if not tgt:
                self.logger.log(f"DIM MISS: Target '{dim_target}' not found in {s_name}", "WARNING")
                return
            text_pt = adsk.core.Point3D.create(0, 0, 0)

            # Determine expression (fallback to named parameter)
            expr = dim.get("Expression") or dim.get("Name") or dim.get("Value")

            d = None
            # Radial and diameter dimensions (arcs/circles)
            dim_type = dim.get("DimType") or dim.get("Type")
            if dim_type == "Radius":
                d = sketch.sketchDimensions.addRadialDimension(tgt, text_pt)
            elif dim_type == "Diameter":
                d = sketch.sketchDimensions.addDiameterDimension(tgt, text_pt)

            # Explicit source-to-target distance with orientation
            elif "Source" in dim:
                src = g_map.get(dim.get("Source"))
                if src:
                    orient = adsk.fusion.DimensionOrientations.VerticalDimensionOrientation if dim.get("Orientation") == "Vertical" else adsk.fusion.DimensionOrientations.HorizontalDimensionOrientation
                    d = sketch.sketchDimensions.addDistanceDimension(src, tgt, orient, text_pt)

            # Default distance on entity (line or between points)
            else:
                if hasattr(tgt, 'startSketchPoint') and hasattr(tgt, 'endSketchPoint'):
                    d = sketch.sketchDimensions.addDistanceDimension(tgt.startSketchPoint, tgt.endSketchPoint, adsk.fusion.DimensionOrientations.AlignedDimensionOrientation, text_pt)
                elif hasattr(tgt, 'geometry') and hasattr(tgt, 'model'):
                    d = sketch.sketchDimensions.addDistanceDimension(tgt, tgt, adsk.fusion.DimensionOrientations.AlignedDimensionOrientation, text_pt)

            if d and expr:
                try:
                    d.parameter.expression = str(expr)
                    self.logger.log(f"DIM OK: {dim_name} on '{dim_target}' = {expr}")
                except Exception as e:
                    self.logger.log(f"DIM EXPR FAIL: {dim_name} on '{dim_target}' expr='{expr}': {e}", "ERROR")
            elif not d:
                self.logger.log(f"DIM NODIM: {dim_name} on '{dim_target}' — no dimension created", "WARNING")

        except Exception as e:
            self.logger.log(f"DIM CRASH: {dim_name} on '{dim_target}': {e}", "ERROR")
            # Enhanced: Log all constraints/dimensions involving the target for diagnostics
            related = []
            for constr in self.sketches[s_name].geometricConstraints:
                if hasattr(constr, 'entityOne') and constr.entityOne == tgt:
                    related.append(str(constr))
                if hasattr(constr, 'entityTwo') and constr.entityTwo == tgt:
                    related.append(str(constr))
            self.logger.log(f"RELATED CONSTRAINTS for '{dim_target}': {related}", "DEBUG")
