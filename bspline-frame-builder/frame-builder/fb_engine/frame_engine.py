import adsk.core, adsk.fusion, adsk.cam, traceback
import os, json
import importlib
import inspect
import time

# Modular logic import
#
# Template discovery / resolution lives in ``template_resolver``. We
# re-export its public API here so existing UI callers
# (``frame_engine.get_available_templates``, ``get_template_spec``)
# keep working unchanged. ``_resolve_template`` is the internal alias
# used by FrameBuilder.run_sketch_only / run_full_synthesis.
try:
    from fb_engine import (
        parametric_engine,
        template_factory,
        fb_value_resolver,
        parameter_schema,
        template_resolver,
        document_discovery,
    )
    from fb_engine.parameter_schema import ParameterSchema
    from fb_engine.template_resolver import (
        resolve_template as _resolve_template,
        get_available_templates,
        get_template_spec,
    )
    from fb_engine.document_discovery import DocumentDiscovery
    from fb_utils import fb_logger
    logger = fb_logger.DebugLogger(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
    importlib.reload(parameter_schema)
    importlib.reload(template_resolver)
    importlib.reload(document_discovery)
    importlib.reload(parametric_engine)
    importlib.reload(fb_value_resolver)
except Exception as e:
    # Attempt to log error if logger exists, otherwise use basic print
    try:
        from fb_utils import fb_logger
        addin_root = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
        logger = fb_logger.DebugLogger(addin_root)
        logger.log(f"CRITICAL: frame_engine failed imports: {e}", "ERROR")
        logger.log(traceback.format_exc(), "ERROR")
    except:
        logger = None
    raise e




def build_sketch_logic_v3(style_id="Template 1", joint_prefix="joint", *args, **kwargs):
    """Entry point version 3 (Signature Immune)."""
    external_logger = kwargs.get('external_logger', None)
    if not external_logger and len(args) > 0:
        external_logger = args[0]
        
    if external_logger:
        external_logger.log(f"BUILD ENTRY: build_sketch_logic_v3(style_id='{style_id}')")
    builder = FrameBuilder(external_logger)
    data_dict = kwargs.get('data', {})
    # Unify session state (ui_state) and button snapshot (ui_data)
    ui_state = data_dict.get('ui_state', {}) if isinstance(data_dict, dict) else {}
    ui_snapshot = data_dict.get('ui_data', {}) if isinstance(data_dict, dict) else {}

    # Merge snapshot into state (freshness priority)
    ui_data = {**ui_state, **ui_snapshot}
    max_phase = data_dict.get('max_phase', None) if isinstance(data_dict, dict) else None

    if external_logger:
        external_logger.log(f"UI STATE UNIFIED: {len(ui_data)} vars, max_phase={max_phase}")
    builder.run_sketch_only(style_id, joint_prefix, ui_data=ui_data, max_phase=max_phase)

def build_frame_logic(style_id="Template 1", joint_prefix="joint", *args, **kwargs):
    """Entry point with signature safety net."""
    external_logger = kwargs.get('external_logger', None)
    if not external_logger and len(args) > 0:
        external_logger = args[0]

    builder = FrameBuilder(external_logger)
    data_dict = kwargs.get('data', {})
    ui_state = data_dict.get('ui_state', {}) if isinstance(data_dict, dict) else {}
    ui_snapshot = data_dict.get('ui_data', {}) if isinstance(data_dict, dict) else {}
    ui_data = {**ui_state, **ui_snapshot}

    builder.run_full_synthesis(style_id, joint_prefix, ui_data=ui_data)

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
            importlib.reload(fb_value_resolver)
            self.resolver = fb_value_resolver.FBValueResolver(self.design, self.logger)
            self.logger.log("FBValueResolver initialized and ready")
        except Exception as e:
            self.logger.log(f"CRITICAL: Failed to load FBValueResolver: {e}", "ERROR")
            self.resolver = None

        # Centralized document-state queries (find aesthetic core, frame
        # component, frame sketch). Single source of truth for the
        # FrameBuilder attribute namespace and the name-pattern fallback
        # ladders — see fb_engine.document_discovery.
        self.discovery = DocumentDiscovery(self.app, self.design, self.logger)
            
        self.logger.log("FrameBuilder initialized")
        self.logger.log(f"Design loaded: {'yes' if self.design else 'no'}")
        self.logger.log(f"Root component exists: {'yes' if self.root else 'no'}")
        self.logger.log(f"User params: {'yes' if self.user_params else 'no'}")

    def get_template_spec(self, style_id="Template 1"):
        """Fetches the raw template DNA for schema-driven UI rendering."""
        return get_template_spec(style_id)

    def _ensure_document(self):
        self.logger.log("Ensuring document is active")
        if not self.design:
            self.logger.log("No active design, creating new Fusion design document")
            self.app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
            self.design = adsk.fusion.Design.cast(self.app.activeProduct)
            self.root = self.design.rootComponent
            self.user_params = self.design.userParameters
            
            # Re-point Resolver and Discovery to the new design
            from fb_engine import fb_value_resolver
            self.resolver = fb_value_resolver.FBValueResolver(self.design, self.logger)
            self.discovery = DocumentDiscovery(self.app, self.design, self.logger)
            self.logger.log("New design created, re-pointed root and resolver")

    def _restore_root_active_component(self):
        try:
            if self.design and self.root and getattr(self.design, 'activeComponent', None) != self.root:
                self.design.activeComponent = self.root
                self.logger.log("Restored root active component")
        except Exception as e:
            self.logger.log(f"Warning: could not restore root active component: {e}", "WARNING")

    def run_sketch_only(self, style_id="Signature (Template 1)", joint_prefix="FrameJoint", ui_data=None, max_phase=None):
        start_time = time.time()
        try:
            self.logger.session_start(f"SKETCH ONLY: {style_id}")
            self.logger.log("run_sketch_only started")
            self._ensure_document()
            target_body = self._discover_aesthetic_core()
            self.logger.log(f"target_body found: {'yes' if target_body else 'no'}")
            self._create_skeletal_parameters(target_body, style_id, ui_data)
            frame_comp = self._create_incremental_component()
            self.logger.log(f"created component: {frame_comp.name if frame_comp else 'none'}")

            # Resolve template and prefix from registry
            template, prefix = _resolve_template(style_id, ui_data)

            builder = parametric_engine.ParametricSketchBuilder(frame_comp, self.design, self.logger, prefix=prefix, ui_data=ui_data, resolver=self.resolver, max_phase=max_phase)
            builder.build_template(template)
        except Exception as e:
            self.logger.log_error(f"CRASH in run_sketch_only: {e}")
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
            self._create_skeletal_parameters(target_body, style_id, ui_data)
            frame_comp = self._create_incremental_component()
            self.logger.log(f"created component: {frame_comp.name if frame_comp else 'none'}")

            # Resolve template and prefix from registry
            template, prefix = _resolve_template(style_id, ui_data)

            builder = parametric_engine.ParametricSketchBuilder(frame_comp, self.design, self.logger, prefix=prefix, ui_data=ui_data, resolver=self.resolver)
            builder.build_template(template)
            
            sketch = None
            for i in range(frame_comp.sketches.count):
                sk = frame_comp.sketches.item(i)
                sk_name = (sk.name or '').lower()
                if 'frame' in sk_name and ('3_' in sk_name or 'enclos' in sk_name or 'frame' in sk_name):
                    sketch = sk
                    self.logger.log(f"run_full_synthesis: selected sketch '{sk_name}' for extrusion")
                    break
            if not sketch:
                sketch = frame_comp.sketches.itemByName(f"{prefix}_3_frame_enclosure")
            if sketch:
                self._extrude_jesmo_frame(sketch, target_body, frame_comp)
                
            if target_body and frame_comp:
                self._create_assembly_joints(target_body, frame_comp, joint_prefix)
        except Exception as e:
            self.logger.log_error(f"CRASH in run_full_synthesis: {e}")
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
        except Exception as e:
            self.logger.log(f"Could not tag component '{name}' with FrameBuilder attribute: {e}", "WARNING")
        
        return comp

    def _create_skeletal_parameters(self, target_body=None, style_id="Template 1", ui_data=None):
        """Centralized parameter initialization via FBValueResolver."""
        if not self.resolver:
            self.logger.log("Skeletal parameter abort: No resolver", "ERROR")
            return

        # 1. Base Requirements (Frame Architecture)
        # Unit defaults flow through ParameterSchema so this site, the
        # parametric_engine UI sync, and the sketch_builder_ui param sync
        # all share one source of truth.
        requirements = self.resolver.get_base_frame_requirements()
        for name, val in requirements.items():
            existing = self.user_params.itemByName(name)
            if not existing:
                unit = ParameterSchema.default_unit(name)
                self.user_params.add(name, adsk.core.ValueInput.createByReal(val), unit, 'Frame Builder Requirement')
            else:
                existing.value = val

        # 2. Template-Specific Parameter Initialization (DNA Sync)
        # NOTE: ReadOnly parameters (e.g. widthIn, heightIn) are owned by the bspline add-in
        # and must never be written here — they are only referenced as Fusion expressions.
        template, _ = _resolve_template(style_id, ui_data)

        # Collect all params from sketch-level declarations
        all_params = []
        for sketch in template.get("Sketches", []):
            all_params.extend(sketch.get("Parameters", []))

        if all_params:
            self.logger.log(f"Resolving {len(all_params)} drivers for {style_id}")
            
            # --- PHASE 1: Create Master Parameters (ReadOnly) ---
            # These are dependencies for the factors below. Unit and the
            # unit-suffixed expression both come from ParameterSchema so
            # the createByString path stays in lockstep with the rest of
            # the parameter pipeline. (createByString honors the suffix —
            # createByReal would store 5.51 as cm regardless of the
            # declared unit, silently truncating inch-authored values to
            # ~40% of their intended size.)
            for p_info in all_params:
                if p_info.get("ReadOnly"):
                    name = p_info["Name"]
                    existing = self.user_params.itemByName(name)
                    if existing:
                        continue

                    unit = ParameterSchema.default_unit(name, p_info)
                    expr_str = ParameterSchema.master_expression(p_info)
                    try:
                        self.user_params.add(
                            name,
                            adsk.core.ValueInput.createByString(expr_str),
                            unit,
                            "Template Master Parameter"
                        )
                        self.logger.log(f"MASTER (Created): {name} = {expr_str}")
                    except Exception as e:
                        self.logger.log(f"FAILED to create Master {name}: {e}", "ERROR")

            # --- PHASE 2: Create/Update Dependent Factors ---
            for p_info in all_params:
                if p_info.get("ReadOnly"):
                    continue
                    
                name = p_info["Name"]
                val_expr, unit = self.resolver.resolve_dna_parameter(p_info, ui_data)
                
                # AUDIT: Log exactly how this parameter was resolved for the birth pass
                raw_dna = p_info.get("Val", "?")
                raw_ui = ui_data.get(name, "NONE") if ui_data else "NO_UI"
                self.logger.log(f"[BIRTH AUDIT] {name}: DNA='{raw_dna}' UI='{raw_ui}' -> RESULT='{val_expr}'")

                existing = self.user_params.itemByName(name)
                if not existing:
                    try:
                        # TWO-STEP BIRTH: Create with 0.0, then set expression.
                        # This avoids "missing dependency" errors during createByString.
                        p = self.user_params.add(name, adsk.core.ValueInput.createByReal(0.0), unit, "Template Parameter")
                        p.expression = str(val_expr)
                        self.logger.log(f"DEPENDENT (Born): {name} = {val_expr} ({unit})")
                    except Exception as e:
                        self.logger.log(f"DEPENDENT FAIL ({name}): {e}. Trying fallback...", "WARNING")
                        try:
                            # Try to evaluate the expression once and save the result
                            eval_val = self.design.unitsManager.evaluateExpression(val_expr, unit)
                            self.user_params.add(name, adsk.core.ValueInput.createByReal(eval_val), unit, "Template Parameter (Static Fallback)")
                        except Exception as fallback_err:
                            self.logger.log_error(f"CRITICAL: Fallback failed for {name}: {fallback_err}")
                else:
                    # UPDATE EXISTING: UI should win during a build cycle
                    try:
                        existing.expression = str(val_expr)
                        self.logger.log(f"DEPENDENT (Updated): {name} -> {val_expr}")
                    except Exception as e:
                        self.logger.log(f"DEPENDENT UPDATE FAIL ({name}): {e}", "WARNING")

    def _discover_aesthetic_core(self):
        """Thin pass-through to ``DocumentDiscovery.find_aesthetic_core_body``.

        The ladder (attribute → AESTHETIC_CORE occurrence → name-pattern
        scavenge with clean-solid drill-down → root body) lives in
        :py:mod:`fb_engine.document_discovery`. Kept as a method so any
        caller still using ``self._discover_aesthetic_core()`` keeps
        working without code churn.
        """
        return self.discovery.find_aesthetic_core_body()

    def _extrude_jesmo_frame(self, sketch, target_body, target_comp):
        self.logger.log("Starting extrusion of frame sketch")
        feats = target_comp.features
        extrudes = feats.extrudeFeatures
        thickness_val = self.design.userParameters.itemByName('frame_depth').name
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
            except Exception as e:
                self.logger.log_error(f"FRAME EXTRUSION ERROR: {e}")
                continue

        self.logger.log("Frame extrusion completed")
   