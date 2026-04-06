import adsk.core, adsk.fusion, traceback

class ConstraintHandler:
    """Handles geometric constraints in the sketch (Coincident, Tangent, Symmetry, etc.)."""
    def __init__(self, sketch, logger):
        self.sketch = sketch
        self.logger = logger
        self.constraints = sketch.geometricConstraints

    def _resolve_point(self, pid, entity_map, sketch_name):
        if not pid: return None
        
        # 1. Try full ID first (Handles 'surround_rect:C' etc.)
        sk_map = entity_map.get(sketch_name, {})
        if pid in sk_map:
            return sk_map[pid]
            
        # 2. Try Split ID
        base_id = pid.split(':')[0]
        ent = sk_map.get(base_id)
        if ent and ':' in pid:
            suff = pid.split(':')[1]
            if suff == "S" and hasattr(ent, 'startSketchPoint'): ent = ent.startSketchPoint
            elif suff == "E" and hasattr(ent, 'endSketchPoint'): ent = ent.endSketchPoint
            elif suff == "C" and hasattr(ent, 'centerSketchPoint'): ent = ent.centerSketchPoint
        return ent

    def constraint_step(self, sketch_name, spec, entity_map):
        c_type = spec.get('Type')
        targets = spec.get('Targets', [])
        
        self.logger.log_sketch(f"   [TRY] {c_type}: {targets}", "DEBUG")
        
        objs = []
        for tid in targets:
            ent = self._resolve_point(tid, entity_map, sketch_name)
            if ent: 
                objs.append(ent)
            else:
                self.logger.log_sketch(f"      (WARN) Could not resolve: {tid}", "DEBUG")
            
        if not objs or len(objs) < 1:
            return

        try:
            success = False
            if c_type == "Coincident" and len(objs) == 2:
                self.constraints.addCoincident(objs[0], objs[1])
                success = True
            elif c_type == "Tangent" and len(objs) == 2:
                self.constraints.addTangent(objs[0], objs[1])
                success = True
            elif c_type == "Horizontal" and len(objs) >= 1:
                self.constraints.addHorizontal(objs[0])
                success = True
            elif c_type == "Vertical" and len(objs) >= 1:
                self.constraints.addVertical(objs[0])
                success = True
            elif c_type == "Equal" and len(objs) == 2:
                self.constraints.addEqual(objs[0], objs[1])
                success = True
            elif c_type == "Symmetry" and len(objs) == 3:
                self.constraints.addSymmetry(objs[0], objs[1], objs[2])
                success = True
            elif c_type == "Collinear" and len(objs) == 2:
                self.constraints.addCollinear(objs[0], objs[1])
                success = True
            elif c_type == "Parallel" and len(objs) == 2:
                self.constraints.addParallel(objs[0], objs[1])
                success = True
            elif c_type == "Perpendicular" and len(objs) == 2:
                self.constraints.addPerpendicular(objs[0], objs[1])
                success = True
            
            if success:
                self.logger.log_sketch(f"CONSTRAINT OK: {c_type} on {targets}")
            else:
                self.logger.log_sketch(f"   (SKIP) {c_type} on {targets}: Insufficient objects resolved ({len(objs)})", "DEBUG")

        except Exception as e:
            msg = str(e)
            if "already been applied" in msg:
                self.logger.log_sketch(f"   (SKIP) Constraint already exists: {c_type} on {targets}", "DEBUG")
            else:
                self.logger.log_error(f"   (FAIL) CONSTRAINT: {c_type} on {targets}\nError: {msg}\n{traceback.format_exc()}")
                # We don't re-raise here to avoid crashing the whole synthesis
