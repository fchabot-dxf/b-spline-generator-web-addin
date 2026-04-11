import adsk.core, adsk.fusion, adsk.cam, traceback
import os, json
import importlib
import time

# Modular logic import
try:
    from fb_engine import parametric_engine, template_factory
    from fb_utils import fb_logger as logger
    import template_data_1, template_data_2, template_data_3, template_data_4
    importlib.reload(parametric_engine)
    importlib.reload(template_data_1)
    importlib.reload(template_data_2)
    importlib.reload(template_data_3)
    importlib.reload(template_data_4)
    importlib.reload(logger)
except Exception as e:
    # Attempt to log error if logger exists, otherwise use basic print
    try:
        from fb_utils import fb_logger as logger
        addin_root = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
        _l = logger.DebugLogger(addin_root)
        _l.log(f"CRITICAL: frame_engine failed imports: {e}", "ERROR")
        _l.log(traceback.format_exc(), "ERROR")
    except:
        pass
    raise e




def build_sketch_logic_v3(style_id="Template 1", joint_prefix="joint", *args, **kwargs):
    """Entry point version 3 (Signature Immune)."""
    external_logger = kwargs.get('external_logger', None)
    if not external_logger and len(args) > 0:
        external_logger = args[0]
        
    builder = FrameBuilder(external_logger)
    data_dict = kwargs.get('data', {})
    ui_data = data_dict.get('ui_state', {}) if isinstance(data_dict, dict) else {}
    if external_logger:
        external_logger.log(f"UI STATE INJECTED: {ui_data}")
    builder.run_sketch_only(style_id, joint_prefix, ui_data=ui_data)

def build_frame_logic(style_id="Template 1", joint_prefix="joint", *args, **kwargs):
    """Entry point with signature safety net."""
    external_logger = kwargs.get('external_logger', None)
    if not external_logger and len(args) > 0:
        external_logger = args[0]
        
    builder = FrameBuilder(external_logger)
    builder.run_full_synthesis(style_id, joint_prefix)

class FrameBuilder:
    def __init__(self, external_logger=None):
        self.app = adsk.core.Application.get()
        self.design = adsk.fusion.Design.cast(self.app.activeProduct)
        self.root = self.design.rootComponent if self.design else None
        self.user_params = self.design.userParameters if self.design else None
        self.params_dna = {}
        
        if external_logger:
            self.logger = external_logger
        else:
            addin_root = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
            self.logger = logger.DebugLogger(addin_root)

        # Dedicated Value Resolver for Unit-Safe Geometry
        try:
            from fb_engine import fb_value_resolver
            self.resolver = fb_value_resolver.FBValueResolver(self.design, self.logger)
            self.logger.log("FBValueResolver initialized and ready")
        except Exception as e:
            self.logger.log(f"CRITICAL: Failed to load FBValueResolver: {e}", "ERROR")
            self.resolver = None
            
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
            
            # Re-point Resolver to the new design
            from fb_engine import fb_value_resolver
            self.resolver = fb_value_resolver.FBValueResolver(self.design, self.logger)
            self.logger.log("New design created, re-pointed root and resolver")

    def _restore_root_active_component(self):
        try:
            if self.design and self.root and getattr(self.design, 'activeComponent', None) != self.root:
                self.design.activeComponent = self.root
                self.logger.log("Restored root active component")
        except Exception as e:
            self.logger.log(f"Warning: could not restore root active component: {e}", "WARNING")

    def run_sketch_only(self, style_id="Signature (Template 1)", joint_prefix="FrameJoint", ui_data=None):
        start_time = time.time()
        try:
            self.logger.session_start(f"SKETCH ONLY: {style_id}")
            self.logger.log("run_sketch_only started")
            self._ensure_document()
            target_body = self._discover_aesthetic_core()
            self.logger.log(f"target_body found: {'yes' if target_body else 'no'}")
            self._create_skeletal_parameters(target_body, style_id)
            frame_comp = self._create_incremental_component()
            self.logger.log(f"created component: {frame_comp.name if frame_comp else 'none'}")

            # Selection Logic: Resolve Template Data and Prefix
            template, prefix = template_data_1.TEMPLATE_1, "T1"
            if "Template 2" in style_id: template, prefix = template_data_2.TEMPLATE_2, "T2"
            if "Template 3" in style_id: template, prefix = template_data_3.TEMPLATE_3, "T3"
            if "Template 4" in style_id: template, prefix = template_data_4.TEMPLATE_4, "T4"

            builder = parametric_engine.ParametricSketchBuilder(frame_comp, self.design, self.logger, prefix=prefix, ui_data=ui_data, resolver=self.resolver)
            builder.build_template(template)
        except:
            self.logger.log_error("CRASH in run_sketch_only")
            self.logger.log_error(traceback.format_exc())
        finally:
            self._restore_root_active_component()
            elapsed = time.time() - start_time
            self.logger.log(f"run_sketch_only completed in {elapsed:.2f} seconds")

    def run_full_synthesis(self, style_id="Signature (Template 1)", joint_prefix="FrameJoint", ui_data=None):
        start_time = time.time()
        try:
            self.logger.session_start(f"FULL SYNTHESIS: {style_id}")
            self.logger.log("run_full_synthesis started")
            self._ensure_document()
            target_body = self._discover_aesthetic_core()
            self.logger.log(f"target_body found: {'yes' if target_body else 'no'}")
            self._create_skeletal_parameters(target_body, style_id)
            frame_comp = self._create_incremental_component()
            self.logger.log(f"created component: {frame_comp.name if frame_comp else 'none'}")

            template, prefix = template_data_1.TEMPLATE_1, "T1"
            if "Template 2" in style_id: template, prefix = template_data_2.TEMPLATE_2, "T2"
            if "Template 3" in style_id: template, prefix = template_data_3.TEMPLATE_3, "T3"
            if "Template 4" in style_id: template, prefix = template_data_4.TEMPLATE_4, "T4"

            builder = parametric_engine.ParametricSketchBuilder(frame_comp, self.design, self.logger, prefix=prefix, ui_data=ui_data, resolver=self.resolver)
            builder.build_template(template)
            
            sketch = frame_comp.sketches.itemByName(f"{prefix}_3_frame")
            if sketch:
                self._extrude_jesmo_frame(sketch, target_body, frame_comp)
                
            if target_body and frame_comp:
                self._create_assembly_joints(target_body, frame_comp, joint_prefix)
        except:
            self.logger.log_error("CRASH in run_full_synthesis")
            self.logger.log_error(traceback.format_exc())
        finally:
            self._restore_root_active_component()
            elapsed = time.time() - start_time
            self.logger.log(f"run_full_synthesis completed in {elapsed:.2f} seconds")

    def _create_incremental_component(self):
        # Scan all existing components in the root for the highest Frame_N index
        # We check comp.name instead of occ.name to avoid issues with ":1" suffixes
        existing_names = [occ.component.name for occ in self.root.occurrences if occ.component.name.startswith("Frame_")]
        
        index = 1
        while True:
            name = f"Frame_{index}"
            if name not in existing_names: break
            index += 1
            
        occ = self.root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
        comp = occ.component
        comp.name = name
        
        # Keep the active component on root; do not activate the new frame component.
        try:
            comp.attributes.add('FrameBuilder', 'ComponentType', 'Frame')
        except:
            pass
        
        return comp

    def _create_skeletal_parameters(self, target_body=None, style_id="Template 1"):
        """Centralized parameter initialization via FBValueResolver."""
        if not self.resolver:
            self.logger.log("Skeletal parameter abort: No resolver", "ERROR")
            return

        # 1. Base Requirements (Frame Architecture)
        requirements = self.resolver.get_base_frame_requirements()
        for name, val in requirements.items():
            existing = self.user_params.itemByName(name)
            if not existing:
                unit = self.resolver.determine_unit(name)
                self.user_params.add(name, adsk.core.ValueInput.createByReal(val), unit, 'Frame Builder Requirement')
            else:
                existing.value = val

        # 2. Dynamic Model Measurement (Scale Stabilization)
        if target_body:
            bbox = target_body.boundingBox
            w = abs(bbox.maxPoint.x - bbox.minPoint.x)
            h = abs(bbox.maxPoint.z - bbox.minPoint.z)
            
            for name, raw_val in [("widthIn", w), ("heightIn", h)]:
                val, unit = self.resolver.normalize_measurement(name, raw_val)
                existing = self.user_params.itemByName(name)
                if not existing:
                    self.user_params.add(name, adsk.core.ValueInput.createByReal(val), unit, 'Auto-Measured Body Span')
                else:
                    existing.value = val

        # 3. Template-Specific Parameter Initialization (DNA Sync)
        template = template_data_1.TEMPLATE_1
        if "Template 2" in style_id: template = template_data_2.TEMPLATE_2
        if "Template 3" in style_id: template = template_data_3.TEMPLATE_3
        if "Template 4" in style_id: template = template_data_4.TEMPLATE_4
        
        if template and "Parameters" in template:
            self.logger.log(f"Resolving {len(template['Parameters'])} drivers for {style_id}")
            for p_info in template["Parameters"]:
                name = p_info["Name"]
                val_expr, unit = self.resolver.resolve_dna_parameter(p_info)
                
                existing = self.user_params.itemByName(name)
                if not existing:
                    try:
                        self.user_params.add(name, adsk.core.ValueInput.createByString(val_expr), unit, "Template Parameter")
                        self.logger.log(f"REGISTERED: {name} = {val_expr} ({unit})")
                    except Exception as e:
                        self.logger.log(f"FAILED TO REGISTER {name}: {e}", "ERROR")
                else:
                    self.logger.log(f"PRESERVED: {name} (UI active)")

    def _discover_aesthetic_core(self):
        self.logger.log("Discovering aesthetic core body")
        
        # 1. Official Discovery: Search via Universal Attribute Tagging
        attrs = self.design.findAttributes('FrameBuilder', 'ComponentType')
        for attr in attrs:
            if attr.value == 'AestheticCore':
                comp = adsk.fusion.Component.cast(attr.parent)
                if comp and comp.bRepBodies.count > 0:
                    self.logger.log(f"Aesthetic core found via Attribute on component: {comp.name}")
                    return comp.bRepBodies.item(0)

        # 2. Legacy/Named discovery:
        existing_occ = self.root.occurrences.itemByName("AESTHETIC_CORE")
        if existing_occ and existing_occ.component.bRepBodies.count > 0:
            self.logger.log("Found AESTHETIC_CORE occurrence")
            return existing_occ.component.bRepBodies.item(0)

        # Search by name patterns in occurrences (using comp.name for stability)
        for occ in self.root.occurrences:
            c_name = occ.component.name.lower()
            if "b-spline set" in c_name or "terrain" in c_name:
                self.logger.log(f"Candidate component found: {occ.component.name}")
                target_comp = occ.component
                
                # Check for "clean solid" sub-bodies
                if target_comp.bRepBodies.count == 0:
                    # Look deeper if it's a container
                    for sub_occ in occ.childOccurrences:
                        if "clean solid" in sub_occ.component.name.lower():
                            target_comp = sub_occ.component
                            break
                            
                if target_comp.bRepBodies.count > 0:
                    self.logger.log(f"Aesthetic core body found in: {target_comp.name}")
                    return target_comp.bRepBodies.item(0)

        if self.root.bRepBodies.count > 0:
            self.logger.log("Using first body in root component as aesthetic core")
            return self.root.bRepBodies.item(0)

        self.logger.log("No aesthetic core found")
        return None

    def _extrude_jesmo_frame(self, sketch, target_body, target_comp):
        self.logger.log("Starting extrusion of frame sketch")
        feats = target_comp.features
        extrudes = feats.extrudeFeatures
        thickness_val = self.design.userParameters.itemByName('Skel_Frame_Thickness').name
        taper_val = self.design.userParameters.itemByName('Skel_Frame_Taper').name

        self.logger.log(f"Extrusion parameters: thickness={thickness_val}, taper={taper_val}")

        for i in range(sketch.profiles.count):
            prof = sketch.profiles.item(i)
            try:
                ext_input = extrudes.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
                dist = adsk.core.ValueInput.createByString(f"-{thickness_val}")
                taper = adsk.core.ValueInput.createByString(taper_val)
                ext_input.setDistanceExtent(False, dist)
                ext_input.taperAngle = taper
                feat = extrudes.add(ext_input)
                
                bbox = prof.boundingBox
                cx = (bbox.minPoint.x + bbox.maxPoint.x) / 2
                cy = (bbox.minPoint.y + bbox.maxPoint.y) / 2
                side_info = ""
                if abs(cx) > abs(cy): side_info = "SIDE_LEFT" if cx < 0 else "SIDE_RIGHT"
                else: side_info = "SPAN_BOTTOM" if cy < 0 else "SPAN_TOP"
                feat.name = f"FRAME_{side_info}"
                self.logger.log(f"Extruded profile {i}: {feat.name}")
            except Exception as e:
                self.logger.log_error(f"Extrude profile {i} failed: {e}")

    def _create_assembly_joints(self, target_body, frame_comp, prefix="FrameJoint"):
        self.logger.log("Creating assembly joints")
        try:
            core_occ = target_body.assemblyContext
            if not core_occ:
                self.logger.log("No core assembly context found; skipping joints")
                return
            frame_occ = frame_comp.assemblyContext
            if frame_comp.bRepBodies.count == 0:
                self.logger.log("No bodies in frame component; skipping joints")
                return
            joints = self.root.joints
            geo1 = adsk.fusion.JointGeometry.createByPoint(frame_comp.originPoint)
            geo2 = adsk.fusion.JointGeometry.createByPoint(core_occ.component.originPoint)
            joint_input = joints.createInput(geo1, geo2)
            joint_input.setAsRigidJointMotion()
            joint = joints.add(joint_input)
            index = 1
            while True:
                name = f"{prefix}_{index}"
                if not joints.itemByName(name): break
                index += 1
            joint.name = name
            self.logger.log(f"Created joint: {name}")
        except Exception as e:
            self.logger.log_error(f"Create assembly joints failed: {e}")
