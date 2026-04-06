import adsk.core, adsk.fusion, traceback

class GeometryHandler:
    """Handles creation of lines, arcs, splines, and rectangles with Semantic Point Naming."""
    def __init__(self, sketch, resolver, logger, set_id_callback):
        self.sketch = sketch
        self.resolver = resolver
        self.logger = logger
        self._set_id = set_id_callback 

    def _resolve_point(self, pid, entity_map, sketch_name):
        if not pid: return None
        parts = pid.split(':')
        base_id = parts[0]
        
        ent = entity_map.get(sketch_name, {}).get(base_id)
        if not ent: return None
        
        target = ent
        if len(parts) > 1:
            suff = parts[1]
            if suff == "S" and hasattr(ent, 'startSketchPoint'): target = ent.startSketchPoint
            elif suff == "E" and hasattr(ent, 'endSketchPoint'): target = ent.endSketchPoint
            elif suff == "C":
                if hasattr(ent, 'centerSketchPoint'): target = ent.centerSketchPoint
                elif hasattr(ent, 'geometry') and hasattr(ent.geometry, 'center'): target = ent.centerSketchPoint
        
        if target:
            self.logger.log_sketch(f"   (RESOLVED) {pid} -> {type(target).__name__}")
        return target

    def line_step(self, sketch_name, spec, entity_map):
        line_id = spec.get('ID')
        pts_spec = spec.get('Points', [])
        p1_id, p2_id = spec.get('StartID'), spec.get('EndID')
        
        # 1. Resolve or Create Points
        p1 = self._resolve_point(p1_id, entity_map, sketch_name)
        p2 = self._resolve_point(p2_id, entity_map, sketch_name)

        if not p1 and len(pts_spec) >= 1:
            geo1 = adsk.core.Point3D.create(self.resolver.resolve(pts_spec[0][0]), self.resolver.resolve(pts_spec[0][1]), 0)
            p1 = self.sketch.sketchPoints.add(geo1)
            self.logger.log_sketch(f"   (BORN) {p1_id or (f'{line_id}:S' if line_id else '?')} from coords")
            
        if not p2 and len(pts_spec) >= 2:
            geo2 = adsk.core.Point3D.create(self.resolver.resolve(pts_spec[1][0]), self.resolver.resolve(pts_spec[1][1]), 0)
            p2 = self.sketch.sketchPoints.add(geo2)
            self.logger.log_sketch(f"   (BORN) {p2_id or (f'{line_id}:E' if line_id else '?')} from coords")

        # 2. Draw Line (Using SketchPoints directly to preserve connectivity)
        if p1 and p2:
            try:
                # IMPORTANT: Pass the SketchPoint object itself, NOT its .geometry Point3D
                # This ensures Fusion reuses the point and maintains connectivity for tangency/constraints
                line = self.sketch.sketchCurves.sketchLines.addByTwoPoints(p1, p2)
                
                # 3. Plug in IDs and Register (Always register even if IDs are missing)
                self._set_id(line, sketch_name, "line", override_id=line_id)
                self._set_id(p1,   sketch_name, "point", override_id=p1_id or (f"{line_id}:S" if line_id else None))
                self._set_id(p2,   sketch_name, "point", override_id=p2_id or (f"{line_id}:E" if line_id else None))
                
                if spec.get('IsConstruction'): line.isConstruction = True
                self.logger.log_sketch(f"   (DRAWN) LINE OK: {line_id or '?'}")
            except Exception as e:
                self.logger.log_error(f"   (FAIL) LINE: {line_id or '?'} {e}")

    def arc_step(self, sketch_name, spec, entity_map):
        """Generic Arc handler, defaults to 3-point logic for modular compatibility."""
        return self.arc_3pt_step(sketch_name, spec, entity_map)

    def arc_3pt_step(self, sketch_name, spec, entity_map):
        arc_id = spec.get('ID')
        pts_spec = spec.get('Points', [])
        p1_id, p2_id, pc_id = spec.get('StartID'), spec.get('EndID'), spec.get('CenterID')
        
        if len(pts_spec) < 3: return
        
        try:
            # 1. Prepare Point3D for the geometry
            p1_geo = adsk.core.Point3D.create(self.resolver.resolve(pts_spec[0][0]), self.resolver.resolve(pts_spec[0][1]), 0)
            pm_geo = adsk.core.Point3D.create(self.resolver.resolve(pts_spec[1][0]), self.resolver.resolve(pts_spec[1][1]), 0)
            p2_geo = adsk.core.Point3D.create(self.resolver.resolve(pts_spec[2][0]), self.resolver.resolve(pts_spec[2][1]), 0)
            
            # 2. Draw Arc
            arc = self.sketch.sketchCurves.sketchArcs.addByThreePoints(p1_geo, pm_geo, p2_geo)
            
            # 3. Plug in IDs and Register (Always register even if IDs are missing)
            self._set_id(arc, sketch_name, "arc", override_id=arc_id)
            self._set_id(arc.startSketchPoint,  sketch_name, "point", override_id=p1_id or (f"{arc_id}:S" if arc_id else None))
            self._set_id(arc.endSketchPoint,    sketch_name, "point", override_id=p2_id or (f"{arc_id}:E" if arc_id else None))
            self._set_id(arc.centerSketchPoint, sketch_name, "point", override_id=pc_id or (f"{arc_id}:C" if arc_id else None))
                
            self.logger.log_sketch(f"   (DRAWN) ARC 3PT OK: {arc_id or '?'}")
        except Exception as e:
            self.logger.log_error(f"   (FAIL) ARC 3PT: {arc_id or '?'} {e}")

    def rect_center_step(self, sketch_name, spec, entity_map):
        rect_id = spec.get('ID')
        center_spec = spec.get('Center', [0, 0])
        size_spec = spec.get('Size', [10, 10])
        line_ids = spec.get('LineIDs', ['rect_T', 'rect_R', 'rect_B', 'rect_L'])
        
        try:
            cx = self.resolver.resolve(center_spec[0])
            cy = self.resolver.resolve(center_spec[1])
            w = self.resolver.resolve(size_spec[0])
            h = self.resolver.resolve(size_spec[1])
            
            p1 = adsk.core.Point3D.create(cx - w/2, cy + h/2, 0)
            p2 = adsk.core.Point3D.create(cx + w/2, cy - h/2, 0)
            
            lines = self.sketch.sketchCurves.sketchLines.addTwoPointRectangle(p1, p2)
            
            for i, lid in enumerate(line_ids):
                line = lines.item(i)
                # Ensure every segment is registered/named
                self._set_id(line, sketch_name, "rect_line", override_id=lid)
                self._set_id(line.startSketchPoint, sketch_name, "point", override_id=f"{lid}:S" if lid else None)
                self._set_id(line.endSketchPoint,   sketch_name, "point", override_id=f"{lid}:E" if lid else None)
                self.logger.log_sketch(f"   (BORN) RECT LINE: {lid or i}")
            
            # Create Physical Diagonals
            diag1 = self.sketch.sketchCurves.sketchLines.addByTwoPoints(lines.item(0).startSketchPoint, lines.item(2).startSketchPoint)
            diag1.isConstruction = True
            diag2 = self.sketch.sketchCurves.sketchLines.addByTwoPoints(lines.item(1).startSketchPoint, lines.item(3).startSketchPoint)
            diag2.isConstruction = True
            
            # Unique Diagonals Naming
            if rect_id == "BB_RECT":
                # User's EXACT requested names for Sketch 1
                self._set_id(diag1, sketch_name, "diag", override_id="rect_diag_TL-BR")
                self._set_id(diag2, sketch_name, "diag", override_id="rect_diag_BL-TR")
                
                center_pt = self.sketch.sketchPoints.add(adsk.core.Point3D.create(cx, cy, 0))
                self.sketch.geometricConstraints.addCoincident(center_pt, diag1)
                self.sketch.geometricConstraints.addCoincident(center_pt, diag2)
                
                # Register BOTH standard and requested names for Sketch 1 anchoring
                self._set_id(center_pt, sketch_name, "rect_center", override_id="rect_diag_centerpoint")
                entity_map[sketch_name]["BB_RECT:C"] = center_pt
            else:
                # Standard Prefixing for Auxiliary Rectangles (like surround_rect)
                prefix = rect_id or "rect"
                self._set_id(diag1, sketch_name, "diag", override_id=f"{prefix}_diag_1")
                self._set_id(diag2, sketch_name, "diag", override_id=f"{prefix}_diag_2")
                
                center_pt = self.sketch.sketchPoints.add(adsk.core.Point3D.create(cx, cy, 0))
                self.sketch.geometricConstraints.addCoincident(center_pt, diag1)
                self.sketch.geometricConstraints.addCoincident(center_pt, diag2)
                
                self._set_id(center_pt, sketch_name, "rect_center", override_id=f"{prefix}:C")
            
            self.logger.log_sketch(f"   (DRAWN) RECT CENTER OK: {rect_id or '?'}")
        except Exception as e:
            self.logger.log_error(f"   (FAIL) RECT CENTER: {rect_id or '?'} {e}")
