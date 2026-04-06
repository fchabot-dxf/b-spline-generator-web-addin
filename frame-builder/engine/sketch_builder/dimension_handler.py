import adsk.core, adsk.fusion, traceback

class DimensionHandler:
    """Handles dimensions and parametric locking in the sketch."""
    def __init__(self, sketch, resolver, logger):
        self.sketch = sketch
        self.resolver = resolver
        self.logger = logger
        self.dimensions = sketch.sketchDimensions

    def _resolve_point(self, pid, entity_map, sketch_name):
        if not pid: return None
        # Basic look-up in the entity map for the specific sketch
        ent = entity_map.get(sketch_name, {}).get(pid.split(':')[0])
        if pid.count(':') > 0:
            suff = pid.split(':')[1]
            if suff == "S" and hasattr(ent, 'startSketchPoint'): ent = ent.startSketchPoint
            elif suff == "E" and hasattr(ent, 'endSketchPoint'): ent = ent.endSketchPoint
            elif suff == "C" and hasattr(ent, 'centerSketchPoint'): ent = ent.centerSketchPoint
        return ent

    def _get_text_point(self, spec, ent1, ent2, orient):
        """Resolves the 3D point for dimension label placement."""
        raw = spec.get('TextPoint')
        if raw and len(raw) >= 2:
            # Use spec coordinates (assume CM)
            return adsk.core.Point3D.create(float(raw[0]), float(raw[1]), 0)
            
        # Default 'Outward' Logic if spec is missing coordinates
        # Try to find a centroid of the targets
        cx, cy = 0, 0
        targets = [e for e in [ent1, ent2] if e]
        for t in targets:
            if hasattr(t, 'geometry'):
                if hasattr(t, 'center'): # SketchPoint
                    cx += t.geometry.x; cy += t.geometry.y
                elif hasattr(t, 'startPoint'): # Line/Curve
                    cx += (t.geometry.startPoint.x + t.geometry.endPoint.x)/2
                    cy += (t.geometry.startPoint.y + t.geometry.endPoint.y)/2
        
        if targets:
            cx /= len(targets); cy /= len(targets)
        
        # Add 'Outward' offset based on orientation
        offset = 5.0 # 5cm offset
        if orient == adsk.fusion.DimensionOrientations.HorizontalDimensionOrientation:
            # For horizontal dims, label moves vertically (up or down)
            cy += offset if cy >= 0 else -offset
        elif orient == adsk.fusion.DimensionOrientations.VerticalDimensionOrientation:
            # For vertical dims, label moves horizontally (left or right)
            cx += offset if cx >= 0 else -offset
        else:
            # Aligned: pull away from origin
            cx *= 1.2; cy *= 1.2

        return adsk.core.Point3D.create(cx, cy, 0)

    def dimension_step(self, sketch_name, spec, entity_map, is_soft_seed=False):
        dim_type = spec.get('Type')
        dim_name = spec.get('Name')
        expr = spec.get('Expression', '0')
        
        # 1. Flexible Keyword Resolution (Source/Target vs ID1/ID2)
        id1 = spec.get('ID1') or spec.get('Source')
        id2 = spec.get('ID2') or spec.get('Target')
        
        ent1 = self._resolve_point(id1, entity_map, sketch_name)
        ent2 = self._resolve_point(id2, entity_map, sketch_name)
        
        # 2. Map Orientation types
        orient = adsk.fusion.DimensionOrientations.AlignedDimensionOrientation
        if dim_type in ["Horizontal", "HorizontalDistance"]:
            orient = adsk.fusion.DimensionOrientations.HorizontalDimensionOrientation
        elif dim_type in ["Vertical", "VerticalDistance"]:
            orient = adsk.fusion.DimensionOrientations.VerticalDimensionOrientation

        try:
            d = None
            p_text = self._get_text_point(spec, ent1, ent2, orient)
            
            # 2. Add Dimension Object (Switching to stable Point-to-Point for all cases)
            d = None
            
            # --- CASE A: Point-to-Point or Line-Endpoints ---
            target1, target2 = ent1, ent2
            
            # If we only have ONE entity and it's a line, use its endpoints to force a stable Point-to-Point dimension
            if not target2 and target1 and hasattr(target1, 'objectType') and 'SketchLine' in target1.objectType:
                target2 = target1.endSketchPoint
                target1 = target1.startSketchPoint
            elif not target1 and target2 and hasattr(target2, 'objectType') and 'SketchLine' in target2.objectType:
                target1 = target2.startSketchPoint
                target2 = target2.endSketchPoint

            if target1 and target2:
                # Stable 4-argument Signature: (SketchPoint/Line, SketchPoint/Line, orientation, textPoint)
                d = self.dimensions.addDistanceDimension(target1, target2, orient, p_text)
            
            if d:
                if is_soft_seed:
                    # Soft Seed: Move and Delete (Prevents solver bloat while pushing geometry)
                    val_cm = self.resolver.resolve(expr)
                    d.parameter.value = val_cm
                    self.logger.log_sketch(f"   (DEBUG) DIM SOFT SEED: {dim_name or 'unnamed'}", "DEBUG")
                    d.deleteMe()
                else:
                    # 3. Parametric Binding (Slider sync)
                    if dim_name:
                        try:
                            # Avoid naming collision with User Parameters (e.g. TopGap -> TopGap_dim)
                            final_name = dim_name
                            design = self.sketch.parentComponent.parentDesign
                            if design.userParameters.itemByName(final_name):
                                final_name = f"{dim_name}_dim"
                            
                            d.parameter.name = final_name 
                            d.parameter.expression = expr
                        except:
                            # Fallback: Just set the expression or value if renaming fails
                            try:
                                d.parameter.expression = expr
                            except:
                                val_cm = self.resolver.resolve(expr)
                                d.parameter.value = val_cm
                    
                    self.logger.log_sketch(f"DIMENSION OK: {dim_name or '?'}")
            else:
                # Silently skip only if NO targets were found at all (likely disabled feature)
                if id1 or id2:
                    self.logger.log_sketch(f"   (SKIP) DIM Targets not resolved: {id1 or ''} -> {id2 or ''}", "DEBUG")

        except Exception as e:
            # Retry-Drop Catch
            if not is_soft_seed:
                raise e # Delegate to builder
            else:
                self.logger.log_sketch(f"   (DROPPED) SOFT SEED FAIL: {dim_name or '?'}: {e}", "DEBUG")
