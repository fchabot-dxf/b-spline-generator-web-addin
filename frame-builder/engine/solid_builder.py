import adsk.core, adsk.fusion, traceback
import math

class SolidBuilder:
    def __init__(self, design, logger):
        self.design = design
        self.root = design.rootComponent
        self.logger = logger

    def discover_aesthetic_core(self, target_name=None, target_entity=None):
        """Hunts for the target surface (BOTTOM Face) to extrude against."""
        best_obj = None
        
        # 0. Selection Input Override (Direct Face or Body)
        if target_entity:
            if isinstance(target_entity, adsk.fusion.BRepFace):
                if self.logger: self.logger.log(f"   [DIRECT] Using canvas-selected Face: {target_entity.tempId}", "SOLID")
                return target_entity
            if self.logger: self.logger.log(f"   [DIRECT] Finding bottom face of canvas-selected Entity", "SOLID")
            best_obj = target_entity
        elif target_name and target_name != "AUTO-DETECT":
            if self.logger: self.logger.log(f"   [UI-NAME] Searching for Occurrence of: '{target_name}'", "SOLID")
            # Iterate Occurrences to get PROXY bodies
            for occ in self.root.allOccurrences:
                if occ.component.name == target_name:
                    if occ.bRepBodies.count > 0:
                        if self.logger: self.logger.log(f"   [MANUAL] Found Proxy Match: {occ.name}", "SOLID")
                        best_obj = occ.bRepBodies.item(0)
                        break
            # Fallback to Root
            if not best_obj and target_name == "Root Component":
                best_obj = self.root.bRepBodies.item(0) if self.root.bRepBodies.count > 0 else None
        
        # 1. Hierarchical Auto-Discovery (Proxy-Aware)
        if not best_obj:
            if self.logger: self.logger.log(f"   [AUTO-HUNT] Starting recursive proxy scan...", "SOLID")
            candidates = []
            # Scan All Occurrences (Proxies)
            for occ in self.root.allOccurrences:
                comp = occ.component
                if comp.bRepBodies.count == 0: continue
                
                name = comp.name
                body = occ.bRepBodies.item(0) # PROXY
                score = 0
                nlow = name.lower()
                if "stamped solid" in nlow: score = 100
                elif "clean solid" in nlow: score = 80
                elif "aesthetic_core" in nlow: score = 60
                elif any(k in nlow for k in ["b-spline set", "terrain", "aesthetic"]): score = 40
                
                if score > 0:
                    candidates.append({'body': body, 'score': score, 'name': name, 'occ': occ})
            
            # Scan Root (Native)
            if self.root.bRepBodies.count > 0:
                nlow = self.root.name.lower()
                if "stamped" in nlow or "aesthetic" in nlow:
                    candidates.append({'body': self.root.bRepBodies.item(0), 'score': 50, 'name': "Root Component", 'occ': None})

            if candidates:
                candidates.sort(key=lambda x: x['score'], reverse=True)
                best_obj = candidates[0]['body']
                if self.logger: self.logger.log(f"   [HUNT] Best candidate: {candidates[0]['name']}", "SOLID")

        if best_obj:
            bottom_face = None
            min_z = float('inf')
            
            if isinstance(best_obj, adsk.fusion.BRepFace):
                if self.logger: self.logger.log(f"   [DIRECT-FACE] Finding bottom face centroid Z...", "SOLID")
                # We still need the centroid for the distance calc
                return best_obj
            
            if self.logger: self.logger.log(f"   [BODY-CRAWLER] Scanning {best_obj.faces.count} faces for absolute World-Z bottom...", "SOLID")
            
            # Determine World Transform
            occ = best_obj.assemblyContext if hasattr(best_obj, 'assemblyContext') else None
            trans = occ.transform if occ else adsk.core.Matrix3D.create()
            
            for f in best_obj.faces:
                try:
                    w_centroid = f.centroid.copy()
                    w_centroid.transformBy(trans)
                    fz = w_centroid.z
                    if fz < min_z:
                        min_z = fz
                        bottom_face = f
                except: continue
            
            if self.logger and bottom_face:
                self.logger.log(f"   [CRAWLER-RESULT] World-Z Bottom locked at: {min_z:.3f}", "SOLID")
            return bottom_face
        return None

    def extrude_4_segments(self, sketch, target_body, target_comp):
        """Creates the 3D frame by extruding 4 quadrants with precision trimming."""
        try:
            if self.logger: self.logger.log(f"SOLIDIFY: Extruding segments from {sketch.name}", "SOLID")
            extrudes = target_comp.features.extrudeFeatures
            
            surround_p = self.design.allParameters.itemByName('T2_Surround_Scale')
            surround_scale = surround_p.value if surround_p else 1.25
            width_p = self.design.allParameters.itemByName('widthIn')
            height_p = self.design.allParameters.itemByName('heightIn')
            w_cm = width_p.value if width_p else 17.78
            h_cm = height_p.value if height_p else 22.86
            surround_w, surround_h = w_cm * surround_scale, h_cm * surround_scale
            
            off_p = self.design.allParameters.itemByName('Skel_Start_Offset')
            start_off_expr = off_p.expression if off_p else "-2.54 cm"
            start_off_val = off_p.value if off_p else -2.54
            
            ext_dist_cm = None
            is_face = hasattr(target_body, 'centroid') if target_body else False
            if target_body:
                try:
                    if is_face:
                        occ_ctx = getattr(target_body, 'assemblyContext', None)
                        trans = occ_ctx.transform if occ_ctx else adsk.core.Matrix3D.create()
                        w_cent = target_body.centroid.copy()
                        w_cent.transformBy(trans)
                        target_z = w_cent.z
                    else:
                        target_z = target_body.boundingBox.minPoint.z
                    ext_dist_cm = abs(start_off_val - target_z)
                    if self.logger: self.logger.log(f"   [DIST] start={start_off_val:.3f} target_z={target_z:.3f} dist={ext_dist_cm:.3f} cm", "SOLID")
                except: pass

            profs = sketch.profiles
            all_profs = []
            for i in range(profs.count):
                p = profs.item(i)
                bb = p.boundingBox
                bw = bb.maxPoint.x - bb.minPoint.x
                bh = bb.maxPoint.y - bb.minPoint.y
                cx = (bb.minPoint.x + bb.maxPoint.x) / 2.0
                cy = (bb.minPoint.y + bb.maxPoint.y) / 2.0
                area = bw * bh
                all_profs.append({'p': p, 'area': area, 'bb': bb, 'idx': i, 'bw': bw, 'bh': bh, 'cx': cx, 'cy': cy})

            trim_prof = None
            for data in all_profs:
                bw, bh = data['bb'].maxPoint.x - data['bb'].minPoint.x, data['bb'].maxPoint.y - data['bb'].minPoint.y
                if abs(bw - surround_w) < 1.0 and abs(bh - surround_h) < 1.0:
                    if not trim_prof or data['area'] < trim_prof['area']: trim_prof = data

            segments_data = [d for d in all_profs if d != trim_prof and 1.0 < d['area'] < (w_cm * h_cm / 2.0)]
            segments_data.sort(key=lambda x: x['area'], reverse=True)
            segments_data = segments_data[:4]

            created_bodies = adsk.core.ObjectCollection.create()
            for data in segments_data:
                prof, bb = data['p'], data['bb']
                cx, cy = (bb.minPoint.x + bb.maxPoint.x)/2.0, (bb.minPoint.y + bb.maxPoint.y)/2.0
                side_info = f"{'TOP' if cy > 0 else 'BOTTOM'}_{'LEFT' if cx < 0 else 'RIGHT'}"
                
                try:
                    ext_input = extrudes.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
                    ext_input.startExtent = adsk.fusion.OffsetStartDefinition.create(adsk.core.ValueInput.createByString(start_off_expr))
                    dist_val = ext_dist_cm if ext_dist_cm else 2.54
                    dist_def = adsk.fusion.DistanceExtentDefinition.create(adsk.core.ValueInput.createByReal(dist_val))
                    ext_input.setOneSideExtent(dist_def, adsk.fusion.ExtentDirections.NegativeExtentDirection)
                    feat = extrudes.add(ext_input)
                    for b in feat.bodies: created_bodies.add(b)
                    if self.logger: self.logger.log(f"   [OK] Extruded {side_info}", "SOLID")
                except: pass

            if trim_prof and created_bodies.count > 0:
                try:
                    trim_input = extrudes.createInput(trim_prof['p'], adsk.fusion.FeatureOperations.CutFeatureOperation)
                    trim_input.startExtent = adsk.fusion.OffsetStartDefinition.create(adsk.core.ValueInput.createByString(start_off_expr))
                    cut_dist = max(50.0, ext_dist_cm + 5.0 if ext_dist_cm else 50.0)
                    dist_def = adsk.fusion.DistanceExtentDefinition.create(adsk.core.ValueInput.createByReal(cut_dist))
                    trim_input.setOneSideExtent(dist_def, adsk.fusion.ExtentDirections.NegativeExtentDirection)
                    trim_input.participantBodies = [b for b in created_bodies]
                    extrudes.add(trim_input).name = "MASTER_TRIM"
                except: pass
                
            return True
        except:
            if self.logger: self.logger.log(f"   [ERROR] {traceback.format_exc()}", "SOLID")
            return False