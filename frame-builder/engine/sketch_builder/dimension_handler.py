import adsk.core, adsk.fusion, traceback

class DimensionHandler:
    """Handles sketch dimensions (Distance, Span, etc.) with semantic lookup."""
    def __init__(self, sketch, entity_map, logger):
        self.sketch = sketch
        self.entity_map = entity_map
        self.logger = logger

    def _resolve_target(self, t_id, s_name):
        """Resolves a target ID to a sketch entity, searching globally if needed."""
        if not t_id: return None

        # 0. Try full ID as direct key first
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

    def handle_dim(self, s_name, spec, is_snap_only=False):
        if is_snap_only:
            return  # Soft-snap handled by geometry placement

        d_id = spec.get('ID') or spec.get('Name')
        expr = spec.get('Expr') or spec.get('Expression', '0')
        dims = self.sketch.sketchDimensions

        # Shared text/label point (used by all paths)
        tp_raw = spec.get('TextPoint', [0, 0])
        text_pt = adsk.core.Point3D.create(
            float(tp_raw[0]) * 2.54 if len(tp_raw) > 0 else 0,
            float(tp_raw[1]) * 2.54 if len(tp_raw) > 1 else 0,
            0)

        # ------------------------------------------------------------------
        # FORMAT 1: Source + Target + Type  (sketch 2 / orientation-specific)
        #   e.g. {'Source': 'skel_shoulder_pin_L:E', 'Target': 'skel_shoulder_pin_R:E',
        #          'Type': 'HorizontalDistance', 'Expression': 'ShoulderSpan'}
        # ------------------------------------------------------------------
        src_id  = spec.get('Source')
        tgt_id  = spec.get('Target')
        dim_typ = spec.get('Type', '')

        if src_id and tgt_id and dim_typ in ('HorizontalDistance', 'VerticalDistance'):
            t1 = self._resolve_target(src_id, s_name)
            t2 = self._resolve_target(tgt_id, s_name)
            if not t1 or not t2:
                missing = src_id if not t1 else tgt_id
                self.logger.log(f"   (FAIL) DIM Source/Target missing: {missing} in {s_name}", "WARNING")
                return
            orient = (adsk.fusion.DimensionOrientations.HorizontalDimensionOrientation
                      if dim_typ == 'HorizontalDistance'
                      else adsk.fusion.DimensionOrientations.VerticalDimensionOrientation)
            try:
                dim = dims.addDistanceDimension(t1, t2, orient, text_pt)
                dim.parameter.expression = str(expr)
                if d_id:
                    try: dim.parameter.name = d_id
                    except: pass
                self.logger.log(f"   (OK) DIM ({dim_typ}): {d_id} = {expr}", "DIM")
                return dim
            except Exception as e:
                self.logger.log(f"   (RETRY/FAIL) DIM {dim_typ}: {d_id} -> {e}", "WARNING")
            return None

        # ------------------------------------------------------------------
        # FORMAT 2: Targets list (two endpoints, aligned distance)
        #   e.g. {'Targets': ['rect_T:S', 'rect_T:E'], 'Expr': 'widthIn'}
        # ------------------------------------------------------------------
        targets = spec.get('Targets', [])
        if len(targets) >= 2:
            t1 = self._resolve_target(targets[0], s_name)
            t2 = self._resolve_target(targets[1], s_name)
            if not t1 or not t2:
                self.logger.log(f"   (FAIL) DIM Targets missing: {targets} in {s_name}", "WARNING")
                return
            try:
                dim = dims.addDistanceDimension(
                    t1, t2,
                    adsk.fusion.DimensionOrientations.AlignedDimensionOrientation,
                    text_pt)
                dim.parameter.expression = str(expr)
                if d_id:
                    try: dim.parameter.name = d_id
                    except: pass
                self.logger.log(f"   (OK) DIM (2pt): {d_id} = {expr}", "DIM")
                return dim
            except Exception as e:
                self.logger.log(f"   (RETRY/FAIL) DIM: {d_id} on {targets}: {e}", "WARNING")
            return None

        # ------------------------------------------------------------------
        # FORMAT 3: Single Target (line-length — legacy bounding box format)
        #   e.g. {'Target': 'surround_T', 'Expression': 'widthIn * 1.25'}
        #   Note: 'Target' alone with no 'Source' and no orientation Type.
        # ------------------------------------------------------------------
        if tgt_id and not src_id and dim_typ not in ('HorizontalDistance', 'VerticalDistance'):
            ent = self._resolve_target(tgt_id, s_name)
            if not ent:
                self.logger.log(f"   (FAIL) DIM single Target missing: {tgt_id} in {s_name}", "WARNING")
                return
            sp = ent.startSketchPoint if hasattr(ent, 'startSketchPoint') else None
            ep = ent.endSketchPoint   if hasattr(ent, 'endSketchPoint')   else None
            if not sp or not ep:
                self.logger.log(f"   (FAIL) DIM single Target has no endpoints: {tgt_id}", "WARNING")
                return
            try:
                dim = dims.addDistanceDimension(
                    sp, ep,
                    adsk.fusion.DimensionOrientations.AlignedDimensionOrientation,
                    text_pt)
                dim.parameter.expression = str(expr)
                if d_id:
                    try: dim.parameter.name = d_id
                    except: pass
                self.logger.log(f"   (OK) DIM (single line): {d_id} = {expr}", "DIM")
                return dim
            except Exception as e:
                self.logger.log(f"   (RETRY/FAIL) DIM single: {d_id} on {tgt_id}: {e}", "WARNING")
            return None

        self.logger.log(f"   (SKIP) DIM {d_id}: no usable Source/Target/Targets in spec", "WARNING")
