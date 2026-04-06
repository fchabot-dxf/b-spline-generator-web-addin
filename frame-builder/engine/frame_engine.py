import adsk.core, adsk.fusion, adsk.cam, traceback
import os, json
import importlib
import time

# Modular logic import
try:
    from . import parametric_engine, template_factory
    from utils import logger
    from sketches.template_2 import template_data_2
    from sketches.template_3 import template_data_3
    importlib.reload(parametric_engine)
    importlib.reload(template_data_2)
    importlib.reload(template_data_3)
    importlib.reload(logger)
except Exception as e:
    # Attempt to log error if logger exists, otherwise use basic print
    try:
        from utils import logger
        addin_root = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
        _l = logger.DebugLogger(addin_root)
        _l.log(f"CRITICAL: frame_engine failed imports: {e}", "ERROR")
        _l.log(traceback.format_exc(), "ERROR")
    except:
        pass
    raise e




def build_sketch_logic(style_id="Signature (Template 2)", joint_prefix="joint", local_map=None):
    """Entry point for the 'Generate Sketch' command."""
    builder = FrameBuilder()
    builder.run_sketch_only(style_id, joint_prefix, local_map)

def build_frame_logic(style_id="Signature (Template 2)", joint_prefix="joint", local_map=None):
    """Entry point for the 'Create Frame' command."""
    builder = FrameBuilder()
    builder.run_full_synthesis(style_id, joint_prefix, local_map)

class FrameBuilder:
    def __init__(self):
        self.app = adsk.core.Application.get()
        self.design = adsk.fusion.Design.cast(self.app.activeProduct)
        self.root = self.design.rootComponent if self.design else None
        self.user_params = self.design.userParameters if self.design else None
        self.params_dna = {}
        addin_root = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
        self.logger = logger.DebugLogger(addin_root)
        self.logger.log("FrameBuilder initialized")
        self.logger.log(f"Design loaded: {'yes' if self.design else 'no'}")
        self.logger.log(f"Root component exists: {'yes' if self.root else 'no'}")
        self.logger.log(f"User params: {'yes' if self.user_params else 'no'}")

    def _ensure_document(self):
        self.logger.log("Ensuring document is active")
        if not self.design:
            self.logger.log("No active design, creating new Fusion design document")
            self.app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
            self.design = adsk.fusion.Design.cast(self.app.activeProduct)
            self.root = self.design.rootComponent
            self.user_params = self.design.userParameters
            self.logger.log("New design created, re-pointed root and user_params")

    def run_sketch_only(self, style_id="Signature (Template 2)", joint_prefix="FrameJoint", local_map=None):
        start_time = time.time()
        try:
            self.logger.session_start(f"SKETCH ONLY: {style_id}")
            self.logger.log(f"run_sketch_only started (local_map keys: {list(local_map.keys()) if local_map else 'none'})")
            self._ensure_document()
            target_body = self._discover_aesthetic_core()
            self.logger.log(f"target_body found: {'yes' if target_body else 'no'}")
            self._create_skeletal_parameters(target_body, style_id)
            frame_comp = self._create_incremental_component()
            self.logger.log(f"created component: {frame_comp.name if frame_comp else 'none'}")
 
            # Selection Logic: Resolve Template Data and Prefix
            template, prefix = template_data_2.TEMPLATE_2, "T2"
            if "Template 3" in style_id: template, prefix = template_data_3.TEMPLATE_3, "T3"
 
            builder = parametric_engine.ParametricSketchBuilder(frame_comp, self.design, self.logger, prefix=prefix, local_values=local_map)
            builder.build_template(template)
        except:
            self.logger.log_error("CRASH in run_sketch_only")
            traceback.print_exc()
        finally:
            elapsed = time.time() - start_time
            self.logger.log(f"run_sketch_only completed in {elapsed:.2f} seconds")
            self._show_notifications()

    def run_full_synthesis(self, style_id="Signature (Template 2)", joint_prefix="FrameJoint", local_map=None):
        start_time = time.time()
        try:
            self.logger.session_start(f"FULL SYNTHESIS: {style_id}")
            self.logger.log("run_full_synthesis started")
            self._ensure_document()
            target_body = self._discover_aesthetic_core()
            self.logger.log(f"target_body found: {'yes' if target_body else 'no'}")
            self._create_skeletal_parameters(target_body, style_id)

            # Discovery of Existing Sketch logic (Two Separate Functions)
            prefix = "T2"
            if "Template 3" in style_id: prefix = "T3"
            sketch_name = f"{prefix}_4_frame"
            
            # Search for the sketch in the design
            sketch = None
            frame_comp = None
            
            self.logger.log(f"Searching for existing sketch: {sketch_name}")
            for occ in self.root.allOccurrences:
                comp = occ.component
                found = comp.sketches.itemByName(sketch_name)
                if found:
                    sketch = found
                    frame_comp = comp
                    self.logger.log(f"Found sketch in component: {comp.name}")
                    break
            
            if not sketch:
                # Fallback to root
                sketch = self.root.sketches.itemByName(sketch_name)
                frame_comp = self.root
                if sketch: self.logger.log("Found sketch in root component")
                
            if sketch and frame_comp:
                self.logger.log("Sketch discovery successful; initiating extrusion")
                self._extrude_jesmo_frame(sketch, target_body, frame_comp)
            else:
                self.logger.log_error(f"Could not find existing frame sketch '{sketch_name}'. Please run 'Generate Sketch' first.")
                self.logger.notify(f"FAILED: No sketch named '{sketch_name}' found. Run 'Generate Sketch' first.")
        except:
            self.logger.log_error("CRASH in run_full_synthesis")
            traceback.print_exc()
        finally:
            elapsed = time.time() - start_time
            self.logger.log(f"run_full_synthesis completed in {elapsed:.2f} seconds")
            self._show_notifications()

    def _show_notifications(self):
        """Displays collected warnings and errors to the user as a pop-up."""
        if not self.logger.notifications:
            return
        
        ui = self.app.userInterface
        msg = "Frame Builder Results:\n\n"
        msg += "\n".join(self.logger.notifications[:10]) # Limit to 10 lines
        if len(self.logger.notifications) > 10:
            msg += f"\n\n... and {len(self.logger.notifications) - 10} more in the debug log."
            
        is_error = any("ERROR" in n for n in self.logger.notifications)
        icon = adsk.core.MessageBoxButtonTypes.OKButtonType
        title = "Frame Builder - Warnings"
        if is_error:
            title = "Frame Builder - Failures"
            
        ui.messageBox(msg, title)

    def _create_incremental_component(self):
        index = 1
        while True:
            name = f"Frame_{index}"
            existing = self.root.occurrences.itemByName(name)
            if not existing: break
            index += 1
        occ = self.root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
        comp = occ.component
        comp.name = name
        return comp

    def _create_skeletal_parameters(self, target_body=None, style_id="Signature (Template 2)"):
        # 1. Base Requirements (Global User Parameters)
        requirements = {
            'Skel_Frame_Offset': -1.905,
            'boundingboxoffset': 0.635,
            'Skel_Start_Offset': -2.54,
            'widthIn': 17.78,  # 7in default in cm
            'heightIn': 22.86, # 9in default in cm
            # Controller Toggles (UI State - Semantic Names)
            'en_ShoulderSpan': 1.0,
            'en_WaistSpan': 1.0,
            'en_HipSpan': 1.0,
            'en_TopGap': 1.0,
            'en_BottomGap': 1.0,
            'en_VerticalOffset': 0.0,
            # Radiuses (Kept as User Params as requested)
            'shapeRadiusShoulder': 2.54,
            'shapeRadiusWaist': 2.54,
            'shapeRadiusHip': 2.54
        }
        
        for name, val in requirements.items():
            existing = self.user_params.itemByName(name)
            if not existing:
                unit = 'in' if any(x in name for x in ['In', 'offset', 'Offset', 'Span', 'Gap']) else 'cm'
                if name.startswith('en_'): unit = ''
                self.user_params.add(name, adsk.core.ValueInput.createByReal(val), unit, 'Frame Builder Parameter')

        # 2. Dynamic Model Measurement (Scale Stabilization)
        if target_body:
            bbox = target_body.boundingBox
            # Corrected: Use Z-axis for height since we build on XZ plane
            w = abs(bbox.maxPoint.x - bbox.minPoint.x)
            h = abs(bbox.maxPoint.z - bbox.minPoint.z)
            self.logger.log(f"MEASURED CORE (XZ): Width={w:.3f} cm, Height={h:.3f} cm")
            
            try:
                for name, val in [("widthIn", w), ("heightIn", h)]:
                    existing = self.user_params.itemByName(name)
                    if existing:
                        existing.value = val
                        self.logger.log(f"UPDATED PARAM: {name} = {val:.3f} cm")
            except Exception as e:
                self.logger.log_error(f"Error setting measured params: {e}")
                raise
    def _discover_aesthetic_core(self):
        self.logger.log("Discovering aesthetic core body")
        existing_occ = self.root.occurrences.itemByName("AESTHETIC_CORE")
        if existing_occ and existing_occ.component.bRepBodies.count > 0:
            self.logger.log("Found AESTHETIC_CORE occurrence")
            return existing_occ.component.bRepBodies.item(0)

        for occ in self.root.occurrences:
            if "b-spline set" in occ.name.lower() or "terrain" in occ.name.lower():
                self.logger.log(f"Candidate occurrence found: {occ.name}")
                target_occ = occ
                if occ.childOccurrences.count > 0:
                    for child in occ.childOccurrences:
                        if "clean solid" in child.name.lower():
                            self.logger.log(f"Using child occurrence for core: {child.name}")
                            target_occ = child
                            break
                if target_occ.component.bRepBodies.count > 0:
                    self.logger.log(f"Aesthetic core found in occurrence: {target_occ.name}")
                    return target_occ.component.bRepBodies.item(0)

        if self.root.bRepBodies.count > 0:
            self.logger.log("Using first body in root component as aesthetic core")
            return self.root.bRepBodies.item(0)

        self.logger.log("No aesthetic core found")
        return None

    def _extrude_jesmo_frame(self, sketch, target_body, target_comp):
        self.logger.log("Starting extrusion of frame sketch (To Object)")
        feats = target_comp.features
        extrudes = feats.extrudeFeatures
        
        # Start Offset (thickness control)
        start_off_param = self.design.userParameters.itemByName('Skel_Start_Offset')
        start_off_val = start_off_param.name if start_off_param else "-2.54 cm"
        
        self.logger.log(f"Extrusion parameters: start_offset={start_off_val}, target={'found' if target_body else 'none'}")

        for i in range(sketch.profiles.count):
            prof = sketch.profiles.item(i)
            try:
                ext_input = extrudes.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
                
                # Set Start to Offset from Profile Plane
                start_offset = adsk.core.ValueInput.createByString(start_off_val)
                ext_input.setOffsetStart(start_offset)
                
                # Set Extent To Object (Aesthetic Core)
                if target_body:
                    # setToEntityExtent(Entity target, bool matchAdjacentFaces, ValueInput offset)
                    ext_input.setOneSideToEntityExtent(target_body, True, adsk.core.ValueInput.createByReal(0.0))
                else:
                    # Fallback to a fixed 1" distance if body discovery failed
                    ext_input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(2.54))
                
                feat = extrudes.add(ext_input)
                
                bbox = prof.boundingBox
                cx = (bbox.minPoint.x + bbox.maxPoint.x) / 2
                cy = (bbox.minPoint.y + bbox.maxPoint.y) / 2
                side_info = ""
                if abs(cx) > abs(cy): side_info = "SIDE_LEFT" if cx < 0 else "SIDE_RIGHT"
                else: side_info = "SPAN_BOTTOM" if cy < 0 else "SPAN_TOP"
                feat.name = f"FRAME_{side_info}"
                self.logger.log(f"Extruded profile {i} to object: {feat.name}")
            except Exception as e:
                self.logger.log_error(f"Extrude profile {i} failed: {e}")

    # _create_assembly_joints removed per user request
