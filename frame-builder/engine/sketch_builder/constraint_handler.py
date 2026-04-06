import adsk.core, adsk.fusion, traceback

class ConstraintHandler:
    """Handles geometric constraints (Coincident, Tangent, Equal, etc.) with semantic lookup."""
    def __init__(self, sketch, entity_map, logger):
        self.sketch = sketch
        self.entity_map = entity_map 
        self.logger = logger

    def _resolve_target(self, t_id, s_name):
        """Resolves a target ID to a sketch entity, searching globally if needed."""
        if not t_id: return None

        # 0. Try full ID as a direct key first (handles pre-registered points like "rect:C", "rect:S")
        ent = self.entity_map.get(s_name, {}).get(t_id)
        if not ent:
            for other_s_name, other_map in self.entity_map.items():
                if t_id in other_map:
                    ent = other_map[t_id]
                    break
        if ent: return ent

        # 1. Split and look up base
        parts = t_id.split(':')
        base_id = parts[0]
        ent = self.entity_map.get(s_name, {}).get(base_id)
        if not ent:
            for other_s_name, other_map in self.entity_map.items():
                if base_id in other_map:
                    ent = other_map[base_id]
                    break
                    
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

    def handle_rel(self, s_name, spec):
        typ = spec.get('Type')
        targets = spec.get('Targets', [])
        if len(targets) < 1: return

        t1 = self._resolve_target(targets[0], s_name)
        t2 = self._resolve_target(targets[1], s_name) if len(targets) > 1 else None

        if not t1:
            self.logger.log(f"   (FAIL) CONSTRAINT Target: {targets[0]} missing", "WARNING")
            return
        if not t2 and typ not in ('Horizontal', 'Vertical'):
            self.logger.log(f"   (FAIL) CONSTRAINT Target: {targets[1]} missing", "WARNING")
            return

        try:
            cons = self.sketch.geometricConstraints
            if typ == 'Coincident':
                cons.addCoincident(t1, t2)
            elif typ == 'Tangent':
                cons.addTangent(t1, t2)
            elif typ == 'Equal':
                cons.addEqual(t1, t2)
            elif typ == 'Horizontal':
                cons.addHorizontal(t1)
            elif typ == 'Vertical':
                cons.addVertical(t1)
            elif typ == 'Perpendicular':
                cons.addPerpendicular(t1, t2)
            elif typ == 'Parallel':
                cons.addParallel(t1, t2)
                
            self.logger.log(f"   (OK) {typ} on {targets}", "SKETCH")
        except Exception as e:
            # RetryDrop handling (Silent retry or logged error)
            m = str(e)
            if "RetryDrop" in spec: self.logger.log(f"   (RETRY) {typ} on {targets}", "WARNING")
            else: self.logger.log(f"   (FAIL) {typ} on {targets}: {m[:50]}...", "WARNING")
