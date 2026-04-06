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
        
        # Priority 1: Current Sketch
        ent = entity_map.get(sketch_name, {}).get(base_id)
        
        # Priority 2: Global Assembly (Fallback)
        if not ent:
            for other_s_name, other_map in entity_map.items():
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

    def line_step(self, sketch_name, spec, entity_map):
        line_id = spec.get('ID')
        p1_id, p2_id = spec.get('StartID'), spec.get('EndID')
        pts_spec = spec.get('Points', [])
        
        p1 = self._resolve_point(p1_id, entity_map, sketch_name)
        p2 = self._resolve_point(p2_id, entity_map, sketch_name)

        if not p1 and len(pts_spec) >= 1:
            g1 = adsk.core.Point3D.create(self.resolver.resolve(pts_spec[0][0]), self.resolver.resolve(pts_spec[0][1]), 0)
            p1 = self.sketch.sketchPoints.add(g1)
        if not p2 and len(pts_spec) >= 2:
            g2 = adsk.core.Point3D.create(self.resolver.resolve(pts_spec[1][0]), self.resolver.resolve(pts_spec[1][1]), 0)
            p2 = self.sketch.sketchPoints.add(g2)

        if p1 and p2:
            try:
                line = self.sketch.sketchCurves.sketchLines.addByTwoPoints(p1, p2)
                self._set_id(line, sketch_name, "line", override_id=line_id)
                if spec.get('IsConstruction'): line.isConstruction = True
                self.logger.log(f"   (OK) LINE: {line_id} at ({p1.geometry.x:.2f}, {p1.geometry.y:.2f}) -> ({p2.geometry.x:.2f}, {p2.geometry.y:.2f})", "SKETCH")
            except Exception as e:
                self.logger.log(f"   (FAIL) LINE: {line_id or '?'} {e}", "ERROR")

    def arc_3pt_step(self, sketch_name, spec, entity_map):
        arc_id = spec.get('ID')
        pts_spec = spec.get('Points', [])
        p1_id, p2_id, pm_id = spec.get('StartID'), spec.get('EndID'), spec.get('CenterID')
        
        if p1_id and p1_id.startswith(f"{arc_id}:"): p1_id = None
        if p2_id and p2_id.startswith(f"{arc_id}:"): p2_id = None
        if pm_id and pm_id.startswith(f"{arc_id}:"): pm_id = None

        p1 = self._resolve_point(p1_id, entity_map, sketch_name)
        p2 = self._resolve_point(p2_id, entity_map, sketch_name)
        pm = self._resolve_point(pm_id, entity_map, sketch_name)

        g1 = p1.geometry if p1 else adsk.core.Point3D.create(self.resolver.resolve(pts_spec[0][0]), self.resolver.resolve(pts_spec[0][1]), 0) if len(pts_spec) > 0 else None
        gm = pm.geometry if pm else adsk.core.Point3D.create(self.resolver.resolve(pts_spec[1][0]), self.resolver.resolve(pts_spec[1][1]), 0) if len(pts_spec) > 1 else None
        g2 = p2.geometry if p2 else adsk.core.Point3D.create(self.resolver.resolve(pts_spec[2][0]), self.resolver.resolve(pts_spec[2][1]), 0) if len(pts_spec) > 2 else None
        
        if not (g1 and gm and g2):
            self.logger.log(f"   (MISS) Arc-Anchors for {arc_id}: S={p1_id} M={pm_id} E={p2_id}", "WARNING")
            return

        try:
            arc = self.sketch.sketchCurves.sketchArcs.addByThreePoints(g1, gm, g2)
            # Pin start and end endpoints to their resolved sketch points
            if p1:
                try: self.sketch.geometricConstraints.addCoincident(arc.startSketchPoint, p1)
                except: pass
            if p2:
                try: self.sketch.geometricConstraints.addCoincident(arc.endSketchPoint, p2)
                except: pass
            # NOTE: do NOT constrain arc.centerSketchPoint to pm.
            # pm is the ON-ARC midpoint (the 3rd-point used to define curvature),
            # NOT the geometric center of the circle. Constraining the center to it
            # forces the solver to warp the arc into nonsense geometry.

            self._set_id(arc, sketch_name, "arc", override_id=arc_id)
            if spec.get('IsConstruction'): arc.isConstruction = True
            self.logger.log(f"   (OK) ARC: {arc_id} at ({g1.x:.2f}, {g1.y:.2f}) -> ({g2.x:.2f}, {g2.y:.2f})", "SKETCH")
        except Exception as e:
            self.logger.log(f"   (FAIL) ARC: {arc_id or '?'} {e}", "ERROR")

    def rect_center_step(self, sketch_name, spec, entity_map):
        id = spec.get('ID')
        cp_spec = spec.get('Center', [0, 0])
        size_spec = spec.get('Size', [10, 10])
        line_ids = spec.get('LineIDs', [f"{id}_L{i}" for i in range(4)])
        
        try:
            cx = self.resolver.resolve(cp_spec[0])
            cy = self.resolver.resolve(cp_spec[1])
            w, h = self.resolver.resolve(size_spec[0]), self.resolver.resolve(size_spec[1])
            # Seed slightly off the true center so Coincident-to-ORIGIN has a non-zero
            # distance to work with — coincident on a zero-distance point fails in Fusion.
            cp = adsk.core.Point3D.create(cx + 0.05, cy + 0.05, 0)
            corner = adsk.core.Point3D.create(cx + w/2, cy + h/2, 0)
            
            rect = self.sketch.sketchCurves.sketchLines.addCenterPointRectangle(cp, corner)
            self.logger.log(f"   [DEBUG] RECT API returned {rect.count} items", "BUILD")
            lines = []
            for i in range(min(rect.count, 4)):
                line = rect.item(i)
                self._set_id(line, sketch_name, "line", override_id=line_ids[i])
                lines.append(line)

            # NOTE: addCenterPointRectangle already applies H/V and Perpendicular/Parallel 
            # constraints internally to maintain the rectangular shape. Re-applying them 
            # here is redundant and can cause "Constraint has already been applied" errors.
            pass
            # cons = self.sketch.geometricConstraints
            # for i, line in enumerate(lines):
            #     try:
            #         if i % 2 == 0: cons.addHorizontal(line)  # items 0,2 = top, bottom
            #         else:          cons.addVertical(line)     # items 1,3 = right, left
            #     except: pass

            # Diagonals + center point
            if rect.count >= 6:
                for i in range(4, 6):
                    diag = rect.item(i)
                    diag.isConstruction = True
                    self._set_id(diag, sketch_name, "line", override_id=f"{id}_diag{i-3}")
                center_pt = rect.item(4).startSketchPoint
                self._set_id(center_pt, sketch_name, "point", override_id=f"{id}:C")
                self.logger.log(f"   (OK) RECT diagonals from API", "SKETCH")
            else:
                # API didn't return diagonals — build them from corners
                # Collect all 4 unique corner points
                seen, corners = set(), []
                for line in lines:
                    for pt in [line.startSketchPoint, line.endSketchPoint]:
                        key = (round(pt.geometry.x, 4), round(pt.geometry.y, 4))
                        if key not in seen:
                            seen.add(key)
                            corners.append(pt)
                if len(corners) == 4:
                    corners.sort(key=lambda p: p.geometry.x)
                    left  = sorted(corners[:2], key=lambda p: p.geometry.y)  # BL, TL
                    right = sorted(corners[2:], key=lambda p: p.geometry.y)  # BR, TR
                    bl, tl, br, tr = left[0], left[1], right[0], right[1]
                    try:
                        d1 = self.sketch.sketchCurves.sketchLines.addByTwoPoints(tl, br)
                        d1.isConstruction = True
                        self._set_id(d1, sketch_name, "line", override_id=f"{id}_diag1")
                        d2 = self.sketch.sketchCurves.sketchLines.addByTwoPoints(tr, bl)
                        d2.isConstruction = True
                        self._set_id(d2, sketch_name, "line", override_id=f"{id}_diag2")
                        # Center = midpoint of diag1
                        center_pt = self.sketch.sketchPoints.add(cp)
                        try: cons.addMidPoint(center_pt, d1)
                        except: pass
                        self._set_id(center_pt, sketch_name, "point", override_id=f"{id}:C")
                        self.logger.log(f"   (OK) RECT diagonals created manually", "SKETCH")
                    except Exception as e:
                        self.logger.log(f"   (WARN) RECT diagonals failed: {e}", "WARNING")

            self.logger.log(f"   (OK) RECT: {id} at center ({cp.x:.2f}, {cp.y:.2f}) size {w:.2f}x{h:.2f}", "SKETCH")
        except Exception as e:
            self.logger.log(f"   (FAIL) RECT: {id or '?'} {e}", "ERROR")
