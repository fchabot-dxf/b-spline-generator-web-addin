"""
Extrusion Engine — Handles the geometric synthesis of the frame.
Manages profile classification, surgical trimming, and participant body control.
"""
import adsk.core, adsk.fusion, traceback

class ExtrusionEngine:
    def __init__(self, app, design, logger):
        self.app = app
        self.design = design
        self.log = logger

    def extrude_profiles(self, comp, sketch, prefix, to_face, start_offset_expr, end_offset_expr):
        """
        Extrude every closed frame-bar profile in the shape-outline sketch.
        """
        total_profiles = sketch.profiles.count
        self.log.log(f"EXTRUDER: processing {total_profiles} profiles in '{sketch.name}'")

        if total_profiles == 0:
            return []

        feats = comp.features
        extrudes = feats.extrudeFeatures
        new_bodies = []
        bodies_created = 0

        # --- EXTENT DEFS ---
        try:
            # End Extent: To Object
            to_def = adsk.fusion.ToEntityExtentDefinition.create(
                to_face, True, adsk.core.ValueInput.createByString(end_offset_expr))
            
            # Start Extent: Offset (if any)
            start_def = None
            if start_offset_expr.strip() not in ("0 in", "0in", "0", "0 cm", "0cm"):
                start_def = adsk.fusion.OffsetStartDefinition.create(
                    adsk.core.ValueInput.createByString(start_offset_expr))
        except Exception as e:
            self.log.log(f"EXTENT SETUP FAIL: {e}", "ERROR")
            return []

        positive_dir = adsk.fusion.ExtentDirections.PositiveExtentDirection
        zero_taper = adsk.core.ValueInput.createByString("0 deg")

        # 1. Classify
        to_process = []
        for i in range(total_profiles):
            prof = sketch.profiles.item(i)
            ctype = self._classify_profile(prof)
            if ctype != "VOID":
                to_process.append((prof, ctype, i))

        # 2. Sort (Trimming Cut LAST)
        to_process.sort(key=lambda x: 1 if x[1] == "SURROUND" else 0)

        for prof, ctype, i in to_process:
            self.log.log(f"  PROFILE {i}: type={ctype}")
            try:
                op = adsk.fusion.FeatureOperations.NewBodyFeatureOperation
                if ctype == "SURROUND":
                    op = adsk.fusion.FeatureOperations.CutFeatureOperation
                
                ext_in = extrudes.createInput(prof, op)

                if ctype == "SURROUND":
                    # --- THE ELEGANT FIX (REVERTED) ---
                    # We stop fighting SWIG and Proxies. We let Fusion automate the cut, 
                    # relying entirely on AppearanceManager to clean the wood texture afterward!
                    ext_in.isParticipantsAutomated = True
                else:
                    # For BARS, empty list locks out the core → forces New Bodies
                    # This remains safe and SWIG-compliant.
                    ext_in.isParticipantsAutomated = False
                    ext_in.participantBodies = []

                # --- EXTENTS ---
                if start_def:
                    ext_in.startExtent = start_def

                if ctype == "BAR":
                    ext_in.setOneSideExtent(to_def, positive_dir, zero_taper)
                else:
                    all_def = adsk.fusion.ThroughAllExtentDefinition.create()
                    ext_in.setOneSideExtent(all_def, positive_dir, zero_taper)

                feat = extrudes.add(ext_in)

                # --- POST-OP NAMING & CLEANUP ---
                if ctype == "BAR":
                    label = self._profile_label(prof, i)
                    name_full = f"frame_{label.lower()}"
                    feat.name = f"{prefix}_{name_full}_Extrude"
                    for b in feat.bodies:
                        b.name = name_full
                        new_bodies.append(b)
                    bodies_created += 1
                elif ctype == "SURROUND":
                    feat.name = f"{prefix}_TRIM_CUT"
                    # Initial face cleanup (AppearanceManager handles the deep clean)
                    try:
                        for face in feat.faces:
                            face.appearance = None
                    except: pass
                    # Reset cut faces to inherit body appearance (wood grain)
                    try:
                        for face in feat.faces:
                            face.appearance = None
                    except: pass

            except Exception as e:
                self.log.log(f"    EXTRUDE FAIL {i}: {e}", "ERROR")

        return new_bodies

    def _classify_profile(self, prof):
        """
        VOID vs SURROUND vs BAR
        """
        try:
            bb = prof.boundingBox
            span_x = abs(bb.maxPoint.x - bb.minPoint.x)
            span_y = abs(bb.maxPoint.y - bb.minPoint.y)
            cx = (bb.minPoint.x + bb.maxPoint.x) / 2
            cy = (bb.minPoint.y + bb.maxPoint.y) / 2

            is_centered = (abs(cx) < 0.1 and abs(cy) < 0.1)
            
            diag = f"      [DEBUG] bbox: ({bb.minPoint.x:.2f},{bb.minPoint.y:.2f}) to ({bb.maxPoint.x:.2f},{bb.maxPoint.y:.2f}) cx={cx:.2f}, cy={cy:.2f} spanX={span_x:.2f} spanY={span_y:.2f}"
            self.log.log(diag)

            if is_centered:
                p_w = self.design.userParameters.itemByName("widthIn")
                p_h = self.design.userParameters.itemByName("heightIn")
                limit_w = (p_w.value * 0.9) if p_w else 15.0
                limit_h = (p_h.value * 0.9) if p_h else 20.0
                
                if span_x > limit_w or span_y > limit_h:
                    return "SURROUND"
                return "VOID"
            return "BAR"
        except:
            return "VOID"

    def _profile_label(self, prof, fallback_idx):
        """
        TOP/BOTTOM/LEFT/RIGHT
        """
        try:
            bb = prof.boundingBox
            dx = abs(bb.maxPoint.x - bb.minPoint.x)
            dy = abs(bb.maxPoint.y - bb.minPoint.y)
            cx = (bb.minPoint.x + bb.maxPoint.x) / 2
            cy = (bb.minPoint.y + bb.maxPoint.y) / 2

            if dx > dy:
                return "TOP" if cy > 0 else "BOTTOM"
            return "RIGHT" if cx > 0 else "LEFT"
        except:
            return str(fallback_idx)
