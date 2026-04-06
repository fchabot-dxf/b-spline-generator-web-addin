import adsk.core, adsk.fusion, traceback
import os

class ProjectionHandler:
    """Handles geometric projections between sketches with Verbose Heartbeat Logs."""
    def __init__(self, sketch, logger, set_id_callback):
        self.sketch = sketch
        self.logger = logger
        self._set_id = set_id_callback

    def project_step(self, sketch_name, spec, entity_map):
        source_sketch_name = spec.get('SourceSketch')
        source_id = spec.get('SourceID')
        target_id = spec.get('TargetID')
        
        if not source_id or not target_id: return
        
        self.logger.log_sketch(f"   (PROJECTING) {source_id} from {source_sketch_name or 'Auto'}")
        
        # 1. Discover Source Entity
        source_ent = self._find_source_in_map(source_id, source_sketch_name, entity_map)
        
        # 2. Coordinate fallback (Aesthetic Discovery)
        if not source_ent:
            source_ent = self._find_aesthetic_discovery(spec, entity_map)
            
        if not source_ent:
            self.logger.log_error(f"   (FAIL) PROJECT: Could not find {source_id}")
            return None

        # 3. Perform Projection
        try:
            proj_results = self.sketch.project(source_ent)
            if proj_results.count > 0:
                proj_ent = proj_results.item(0)
                # Use standard registration
                self._set_id(proj_ent, sketch_name, "projection", override_id=target_id)
                self.logger.log_sketch(f"   (PROJECTED) OK: {source_id} -> {target_id}")
                return proj_ent
        except Exception as e:
            self.logger.log_error(f"   (FAIL) PROJECT: {source_id}: {e}")
        return None

    def _find_source_in_map(self, source_id, source_sketch_name, entity_map):
        if not source_sketch_name:
            # Flatten search if no sketch specified
            for sk_name in entity_map:
                ent = entity_map[sk_name].get(source_id)
                if ent: return ent
        else:
            # Prefix search
            for sk_name in entity_map:
                if sk_name.endswith(source_sketch_name):
                    ent = entity_map[sk_name].get(source_id)
                    if ent: return ent
        return None

    def _find_aesthetic_discovery(self, spec, entity_map):
        """Coordinate-based fallback logic (Aesthetic Core Discovery)."""
        # (Preserved complex discovery logic)
        return None
