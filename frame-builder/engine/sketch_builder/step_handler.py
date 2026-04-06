import adsk.core, adsk.fusion, traceback
import math

class StepHandler:
    """Handles advanced sketch operations like Offsets and Corner Identification."""
    def __init__(self, sketch, resolver, logger, set_id_callback):
        self.sketch = sketch
        self.resolver = resolver
        self.logger = logger
        self._set_id = set_id_callback

    def _dist(self, p1, p2):
        return ((p1.x - p2.x)**2 + (p1.y - p2.y)**2)**0.5

    def _get_midpoint(self, curve):
        try:
            sp, ep = curve.startSketchPoint.geometry, curve.endSketchPoint.geometry
            return adsk.core.Point3D.create((sp.x + ep.x)/2, (sp.y + ep.y)/2, 0)
        except: return adsk.core.Point3D.create(0, 0, 0)

    def _resolve_point(self, pid, entity_map, sketch_name):
        if not pid: return None
        parts = pid.split(':')
        base_id = parts[0]
        ent = entity_map.get(sketch_name, {}).get(base_id)
        if not ent: return None
        target = ent
        if len(parts) > 1:
            suff = parts[1]
            if   suff == "S" and hasattr(ent, 'startSketchPoint'): target = ent.startSketchPoint
            elif suff == "E" and hasattr(ent, 'endSketchPoint'):   target = ent.endSketchPoint
            elif suff == "C":
                if   hasattr(ent, 'centerSketchPoint'): target = ent.centerSketchPoint
                elif hasattr(ent, 'geometry') and hasattr(ent.geometry, 'center'): target = ent.centerSketchPoint
        return target

    def line_step(self, sketch_name, spec, entity_map):
        line_id = spec.get('ID')
        p1_id, p2_id = spec.get('StartID'), spec.get('EndID')
        p1 = self._resolve_point(p1_id, entity_map, sketch_name)
        p2 = self._resolve_point(p2_id, entity_map, sketch_name)

        if p1 and p2:
            try:
                line = self.sketch.sketchCurves.sketchLines.addByTwoPoints(p1.geometry, p2.geometry)
                try: self.sketch.geometricConstraints.addCoincident(line.startSketchPoint, p1)
                except: pass
                try: self.sketch.geometricConstraints.addCoincident(line.endSketchPoint, p2)
                except: pass
                if line_id: self._set_id(line, sketch_name, "step_line", override_id=line_id)
                self.logger.log(f"   (OK) LINE STEP: {line_id or '?'} ({p1_id}->{p2_id})", "STEP")
            except Exception as e:
                self.logger.log(f"   (FAIL) LINE STEP: {line_id or '?'} {e}", "ERROR")

    def offset_step(self, sketch_name, spec, entity_map):
        source_ids = spec.get('SourceID', [])
        dist_expr = spec.get('DistanceExpr', '0')
        tgt_ids_list = spec.get('TargetIDs', [])
        single_tgt = spec.get('TargetID')
        corner_ids = spec.get('CornerIDs', {})
        
        curves = adsk.core.ObjectCollection.create()
        for sid in source_ids:
            ent = entity_map.get(sketch_name, {}).get(sid)
            if ent: curves.add(ent)
            
        if curves.count == 0: return

        try:
            # --- Hardening: Support construction line offset ---
            src_states = {}
            for i in range(curves.count):
                c = curves.item(i)
                if hasattr(c, 'isConstruction'):
                    src_states[c.entityToken] = c.isConstruction
                    c.isConstruction = False

            dist_val = self.resolver.resolve(dist_expr)
            dir_raw = spec.get("Direction") or [0.5, 0.5, 0]
            dir_pt = adsk.core.Point3D.create(dir_raw[0], dir_raw[1], 0)
            
            offset_curves = None
            try:
                offset_curves = self.sketch.offset(curves, dir_pt, dist_val)
            except:
                offset_curves = self.sketch.offset(curves, dir_pt, -dist_val)
            
            # Restore states
            for i in range(curves.count):
                c = curves.item(i)
                if c.entityToken in src_states:
                    c.isConstruction = src_states[c.entityToken]

            if offset_curves and offset_curves.count > 0:
                # Restoration: Map curves by explicit TargetIDs or Proximity
                abs_d = abs(dist_val)
                for i in range(offset_curves.count):
                    off_c = offset_curves.item(i)
                    
                    # 1. Precise TargetID (Legacy/Main)
                    if single_tgt and i == 0:
                        self._set_id(off_c, sketch_name, "offset", override_id=single_tgt)
                        continue

                    # 2. Targeted Mapping (Proximity-based for multiple curves)
                    mp_off = self._get_midpoint(off_c)
                    best_sid, min_err = None, 1.0e6
                    for idx, sid in enumerate(source_ids):
                        src_c = entity_map.get(sketch_name, {}).get(sid)
                        if not src_c: continue
                        mp_src = self._get_midpoint(src_c)
                        d = self._dist(mp_off, mp_src)
                        err = abs(d - abs_d)
                        if err < min_err:
                            min_err = err
                            best_sid, best_idx = sid, idx
                    
                    if best_sid and min_err < 0.1:
                        target_id = tgt_ids_list[best_idx] if best_idx < len(tgt_ids_list) else f"frame_inner_{best_sid}"
                        self._set_id(off_c, sketch_name, "offset", override_id=target_id)
                
                if corner_ids:
                    # CRITICAL: Force a solve if the sketch is deferred, otherwise new points will have (0,0) coordinates
                    orig_defer = self.sketch.isComputeDeferred
                    if orig_defer: self.sketch.isComputeDeferred = False
                    
                    self._identify_corners(offset_curves, sketch_name, corner_ids)
                    
                    if orig_defer: self.sketch.isComputeDeferred = True
        except Exception as e:
            self.logger.log(f"   (CRASH) OFFSET: {e}", "ERROR")

    def _identify_corners(self, curves, sketch_name, corner_ids):
        seen = set()
        pts = []
        for i in range(curves.count):
            c = curves.item(i)
            for sp in [c.startSketchPoint, c.endSketchPoint]:
                if sp and sp.isValid and sp.entityToken not in seen:
                    seen.add(sp.entityToken)
                    pts.append(sp)
        
        if len(pts) < 4:
            self.logger.log(f"   (WARN) CORNER: Found only {len(pts)} points in '{sketch_name}', need 4 for TL/TR/BL/BR", "WARNING")
            for i, p in enumerate(pts):
                self.logger.log(f"      [PT {i}] ({p.geometry.x:.4f}, {p.geometry.y:.4f})", "DEBUG")
            return
        
        # Sort points by coordinates to find extremes
        min_x = min(p.geometry.x for p in pts)
        max_x = max(p.geometry.x for p in pts)
        min_y = min(p.geometry.y for p in pts)
        max_y = max(p.geometry.y for p in pts)
        width  = max_x - min_x
        height = max_y - min_y
        
        # Log the bounding box of found points
        self.logger.log(f"   [STEP] Found corner bbox: ({min_x:.2f},{min_y:.2f}) -> ({max_x:.2f},{max_y:.2f}) size {width:.2f}x{height:.2f}", "DEBUG")

        tol = width * 0.05 # 5% of width as grouping tolerance
        l_pts = sorted([p for p in pts if abs(p.geometry.x - min_x) < tol], key=lambda p: p.geometry.y, reverse=True)
        r_pts = sorted([p for p in pts if abs(p.geometry.x - max_x) < tol], key=lambda p: p.geometry.y, reverse=True)
        
        if len(l_pts) < 2 or len(r_pts) < 2:
            self.logger.log(f"   (WARN) CORNER: ID failed on '{sketch_name}'. Found {len(l_pts)} Left / {len(r_pts)} Right points.", "WARNING")
            return

        m = {"TL": l_pts[0], "BL": l_pts[-1], "TR": r_pts[0], "BR": r_pts[-1]}
        for key, pt in m.items():
            cid = corner_ids.get(key)
            if cid and pt:
                self._set_id(pt, sketch_name, "corner", override_id=cid)
                self.logger.log(f"   (OK) CORNER: {cid} at ({pt.geometry.x:.2f}, {pt.geometry.y:.2f})", "STEP")
