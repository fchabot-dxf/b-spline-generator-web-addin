import adsk.core, adsk.fusion, traceback
import os, math

class StepHandler:
    """Handles advanced sketch operations like Offsets and Corner Identification."""
    def __init__(self, sketch, resolver, logger, set_id_callback):
        self.sketch = sketch
        self.resolver = resolver
        self.logger = logger
        self._set_id = set_id_callback

    def offset_step(self, sketch_name, spec, entity_map):
        source_ids = spec.get('SourceID', [])
        dist_expr = spec.get('DistanceExpr', '0')
        target_ids = spec.get('TargetIDs', [])
        corner_ids = spec.get('CornerIDs', {})
        
        # 1. Collect Source Curves
        curves = adsk.core.ObjectCollection.create()
        for sid in source_ids:
            ent = entity_map.get(sketch_name, {}).get(sid)
            if ent: curves.add(ent)
            
        if curves.count == 0:
            self.logger.log_sketch(f"OFFSET FAIL: No source curves found for {source_ids}", "WARNING")
            return

        try:
            # 2. Perform Offset
            dist_val = self.resolver.resolve(dist_expr)
            # Use small asymmetric seed vector to help Fusion's solver avoid diagonal collisions
            seed_point = adsk.core.Point3D.create(0.05, 0.07, 0)
            offset_results = self.sketch.offset(curves, seed_point, dist_val)
            
            # 3. Map Target Curves and Points
            for i in range(min(offset_results.count, len(target_ids))):
                curve = offset_results.item(i)
                cid = target_ids[i]
                
                # Register Curve
                self._set_id(curve, sketch_name, "offset_curve", override_id=cid)
                
                # Register Points (Ensures connectivity naming)
                if hasattr(curve, 'startSketchPoint') and curve.startSketchPoint:
                    self._set_id(curve.startSketchPoint, sketch_name, "point", override_id=f"{cid}:S")
                if hasattr(curve, 'endSketchPoint'):
                    self._set_id(curve.endSketchPoint, sketch_name, "point", override_id=f"{cid}:E")
                if hasattr(curve, 'centerSketchPoint'):
                    self._set_id(curve.centerSketchPoint, sketch_name, "point", override_id=f"{cid}:C")
            
            # 4. robust Corner ID (Manual Quadrant Search)
            if corner_ids:
                self._identify_corners(offset_results, sketch_name, corner_ids)
                
            self.logger.log_sketch(f"OFFSET OK: {len(source_ids)} curves offset by {dist_expr}")
        except Exception as e:
            self.logger.log_error(f"OFFSET FAIL: {e}")

    def _identify_corners(self, curves, sketch_name, corner_ids):
        """Finds unique sketch points and assigns them to TL, TR, BL, BR based on coordinates."""
        seen = set()
        pts = []
        for i in range(curves.count):
            c = curves.item(i)
            for sp in [c.startSketchPoint, c.endSketchPoint]:
                if sp and sp.entityToken not in seen:
                    seen.add(sp.entityToken)
                    pts.append(sp)
        
        if len(pts) < 4: return
        
        # Quadrant Logic (Extreme X/Y)
        min_x = min(p.geometry.x for p in pts)
        max_x = max(p.geometry.x for p in pts)
        tol = 0.01
        
        left_pts = sorted([p for p in pts if abs(p.geometry.x - min_x) < tol], key=lambda p: p.geometry.y, reverse=True)
        right_pts = sorted([p for p in pts if abs(p.geometry.x - max_x) < tol], key=lambda p: p.geometry.y, reverse=True)
        
        rect_map = {
            "TL": left_pts[0] if left_pts else None,
            "BL": left_pts[-1] if left_pts else None,
            "TR": right_pts[0] if right_pts else None,
            "BR": right_pts[-1] if right_pts else None
        }
        
        for key, pt in rect_map.items():
            cid = corner_ids.get(key)
            if cid and pt:
                self._set_id(pt, sketch_name, "corner", override_id=cid)
