import adsk.core, adsk.fusion, adsk.cam, traceback
import os, json
import importlib
import time

# Modular logic import
try:
    from . import parametric_engine, template_factory, solid_builder
    from utils import logger
    from sketches.template_2 import template_data_2
    from sketches.template_3 import template_data_3
    
    # Nuclear Reload
    importlib.reload(parametric_engine)
    importlib.reload(template_factory)
    importlib.reload(solid_builder)
    importlib.reload(template_data_2)
    importlib.reload(template_data_3)
    importlib.reload(logger)
except Exception as e:
    # Attempt to log error if logger exists
    try:
        from utils import logger
        addin_root = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
        _l = logger.DebugLogger(addin_root)
        _l.log(f"CRITICAL: frame_engine failed imports: {e}", "ERROR")
    except:
        pass
    raise e

def build_sketch_logic(style_id="Signature (Template 2)", joint_prefix="joint", local_map=None, target_name=None, target_entity=None):
    """Entry point for the 'Generate Sketch' command."""
    builder = FrameBuilder()
    builder.run_sketch_only(style_id, joint_prefix, local_map, target_name, target_entity)

def build_frame_logic(style_id="Signature (Template 2)", joint_prefix="joint", local_map=None, target_name=None, target_entity=None):
    """Entry point for the 'Create Frame' command."""
    builder = FrameBuilder()
    builder.run_full_synthesis(style_id, joint_prefix, local_map, target_name, target_entity)

class FrameBuilder:
    def __init__(self):
        self.app = adsk.core.Application.get()
        self.design = adsk.fusion.Design.cast(self.app.activeProduct)
        self.root = self.design.rootComponent if self.design else None
        self.user_params = self.design.userParameters if self.design else None
        self.params_dna = {}
        addin_root = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
        self.logger = logger.DebugLogger(addin_root)
        self.logger.log("FrameBuilder initialized (Modular v2)")

    def _ensure_document(self):
        if not self.design:
            self.app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
            self.design = adsk.fusion.Design.cast(self.app.activeProduct)
            self.root = self.design.rootComponent
            self.user_params = self.design.userParameters

    def run_sketch_only(self, style_id="Signature (Template 2)", joint_prefix="FrameJoint", local_map=None, target_name=None, target_entity=None):
        start_time = time.time()
        try:
            self.logger.session_start(f"SKETCH ONLY: {style_id}")
            self._ensure_document()
            
            sb = solid_builder.SolidBuilder(self.design, self.logger)
            target_body = sb.discover_aesthetic_core(target_name, target_entity)
            
            self._create_skeletal_parameters(target_body, style_id)
            frame_comp = self._create_incremental_component()

            # Selection Logic
            template, prefix = template_data_2.TEMPLATE_2, "T2"
            if "Template 3" in style_id: template, prefix = template_data_3.TEMPLATE_3, "T3"

            builder = parametric_engine.ParametricSketchBuilder(frame_comp, self.design, self.logger, prefix=prefix, local_values=local_map)
            builder.build_template_with_retry(template)
        except:
            self.logger.log_error("CRASH in run_sketch_only")
            traceback.print_exc()
        finally:
            elapsed = time.time() - start_time
            self.logger.log(f"run_sketch_only completed in {elapsed:.2f} seconds")
            self._show_notifications()

    def run_full_synthesis(self, style_id="Signature (Template 2)", joint_prefix="FrameJoint", local_map=None, target_name=None, target_entity=None):
        start_time = time.time()
        try:
            self.logger.session_start(f"FULL SYNTHESIS: {style_id}")
            self._ensure_document()
            
            sb = solid_builder.SolidBuilder(self.design, self.logger)
            target_body = sb.discover_aesthetic_core(target_name, target_entity)
            # FIX: Do NOT pass target_body here — discover_aesthetic_core returns a BRepFace
            # (the bottom face of the terrain). That face is flat so bbox.z-extent ≈ 0,
            # which would overwrite heightIn → 0, triggering a sketch parametric re-solve
            # that distorts all geometry ("new lines" bug). The sketch was already built with
            # correct params by 'Generate Sketch'; just ensure missing params exist (None body).
            self._create_skeletal_parameters(None, style_id)

            prefix = "T2" if "Template 2" in style_id else "T3"
            sketch_name = f"{prefix}_2_shape-outline"
            
            sketch = None
            frame_comp = None
            
            for occ in self.root.allOccurrences:
                comp = occ.component
                found = comp.sketches.itemByName(sketch_name)
                if found:
                    sketch = found
                    frame_comp = comp
                    break
            
            if not sketch:
                sketch = self.root.sketches.itemByName(sketch_name)
                frame_comp = self.root
                
            if sketch and frame_comp:
                self.logger.log("Sketch discovery successful; initiating extrusion")
                sb.extrude_4_segments(sketch, target_body, frame_comp)
            else:
                self.logger.log_error(f"Could not find existing frame sketch '{sketch_name}'. Run 'Generate Sketch' first.")
                self.logger.notify(f"FAILED: No sketch named '{sketch_name}' found.")
        except:
            self.logger.log_error("CRASH in run_full_synthesis")
            traceback.print_exc()
        finally:
            elapsed = time.time() - start_time
            self.logger.log(f"run_full_synthesis completed in {elapsed:.2f} seconds")
            self._show_notifications()

    def _show_notifications(self):
        if not self.logger.notifications: return
        ui = self.app.userInterface
        msg = "Frame Builder Results:\n\n" + "\n".join(self.logger.notifications[:10])
        ui.messageBox(msg, "Frame Builder")

    def _create_incremental_component(self):
        index = 1
        while True:
            name = f"Frame_{index}"
            if not self.root.occurrences.itemByName(name): break
            index += 1
        occ = self.root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
        occ.component.name = name
        return occ.component

    def _create_skeletal_parameters(self, target_body=None, style_id="Signature (Template 2)"):
        requirements = {
            'Skel_Frame_Offset': -1.905, 'boundingboxoffset': 0.635, 'Skel_Start_Offset': -2.54,
            'widthIn': 17.78, 'heightIn': 22.86,
            'en_ShoulderSpan': 1.0, 'en_WaistSpan': 1.0, 'en_HipSpan': 1.0, 'en_TopGap': 1.0, 'en_BottomGap': 1.0, 'en_VerticalOffset': 0.0,
            'shapeRadiusShoulder': 2.54, 'shapeRadiusWaist': 2.54, 'shapeRadiusHip': 2.54
        }
        for name, val in requirements.items():
            if not self.user_params.itemByName(name):
                unit = 'in' if any(x in name for x in ['In', 'offset', 'Offset', 'Span', 'Gap']) else 'cm'
                if name.startswith('en_'): unit = ''
                self.user_params.add(name, adsk.core.ValueInput.createByReal(val), unit, '')

        if target_body:
            bbox = target_body.boundingBox
            self.user_params.itemByName('widthIn').value = abs(bbox.maxPoint.x - bbox.minPoint.x)
            self.user_params.itemByName('heightIn').value = abs(bbox.maxPoint.z - bbox.minPoint.z)
