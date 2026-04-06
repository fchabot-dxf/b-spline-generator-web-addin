import adsk.core, adsk.fusion, traceback
import math

class ProjectionHandler:
    """Handles cross-sketch projections with robust 'Reconciliation' fallbacks."""
    def __init__(self, sketch, entity_map, logger, set_id_callback):
        self.sketch = sketch
        self.entity_map = entity_map
        self.logger = logger
        self._set_id = set_id_callback

    def _get_snapshot(self):
        tokens = set()
        for p in self.sketch.sketchPoints: tokens.add(p.entityToken)
        for c in self.sketch.sketchCurves: tokens.add(c.entityToken)
        return tokens

    def handle_proj(self, s_name, spec, prefix="T2"):
        src_sk_name = f"{prefix}_{spec.get('SourceSketch')}"
        src_id_full = spec.get('SourceID')
        tgt_id = spec.get('TargetID')

        try:
            parts = src_id_full.split(':')
            base_id = parts[0]
            src_ent = self.entity_map.get(src_sk_name, {}).get(base_id)
            if not src_ent:
                self.logger.log(f"   (FAIL) PROJECT: Source '{base_id}' not found in '{src_sk_name}'", "ERROR")
                return
            
            if len(parts) > 1:
                suff = parts[1]
                if   suff == "S": src_ent = src_ent.startSketchPoint
                elif suff == "E": src_ent = src_ent.endSketchPoint
                elif suff == "C": src_ent = src_ent.centerSketchPoint

            before = self._get_snapshot()
            res = self.sketch.project(src_ent)
            
            if res.count > 0:
                ent = res.item(0)
                self._set_id(ent, s_name, "proj", override_id=tgt_id)
                self.logger.log(f"   (OK) PROJECT: {tgt_id} direct from {src_id_full}", "PROJ")
            else:
                after = self._get_snapshot()
                delta = after - before
                
                best_ent, min_dist = None, 100.0
                src_geo = src_ent.geometry if hasattr(src_ent, 'geometry') else src_ent.startSketchPoint.geometry
                
                for token in delta:
                    cand = None
                    for p in self.sketch.sketchPoints:
                        if p.entityToken == token: cand = p; break
                    if not cand:
                        for c in self.sketch.sketchCurves:
                            if c.entityToken == token: cand = c; break
                    
                    if cand:
                        cand_geo = cand.geometry if hasattr(cand, 'geometry') else cand.startSketchPoint.geometry
                        dist = ((cand_geo.x - src_geo.x)**2 + (cand_geo.y - src_geo.y)**2)**0.5
                        if dist < min_dist:
                            min_dist = dist
                            best_ent = cand
                
                if best_ent:
                    self._set_id(best_ent, s_name, "proj", override_id=tgt_id)
                    self.logger.log(f"   (RECONCILED) PROJECT: {tgt_id} (dist={min_dist:.3f} cm)", "PROJ")
                else:
                    self.logger.log(f"   (FAIL) PROJECT: {tgt_id} - Zero results and no delta candidate", "ERROR")
        except Exception as e:
            self.logger.log(f"   (CRASH) PROJECT: {tgt_id} Error: {e}", "ERROR")
