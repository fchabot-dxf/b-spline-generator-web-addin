import adsk.core, adsk.fusion, adsk.cam, traceback
import ast
import os, json
import importlib
import importlib.util
import inspect
import sys
import time

# Modular logic import
try:
    from fb_engine import parametric_engine, template_factory, fb_value_resolver
    from fb_utils import fb_logger
    logger = fb_logger.DebugLogger(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
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




_FRAME_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
_SKETCHES_ROOT = os.path.join(_FRAME_ROOT, 'sketches')
_TEMPLATE_REGISTRY = None


# ---------------------------------------------------------------------------
# Template discovery / loading
#
# The previous implementation eagerly executed every ``template_data.py``
# at startup just to read its ``TEMPLATE_NAME``, and surrounded each load
# with a sys.modules / sys.path purge dance because each template folder
# shipped its own ``template_loader.py`` whose bare imports collided in
# ``sys.modules``.
#
# The current design:
#   * The shared ``template_loader.TemplateLoader`` lives at the
#     frame-builder root. Per-template state lives on instances, so two
#     templates can never share a cached loader, and there is nothing to
#     purge from ``sys.modules`` between loads.
#   * Discovery is lazy — we AST-parse ``TEMPLATE_NAME`` so the UI can
#     populate without paying the cost of importing every template.
#   * Each registry entry holds a closure that imports + caches its
#     ``template_data.py`` on first use.
#   * Every spec returned by a template is run through
#     ``_validate_template_spec`` so malformed templates fail loudly
#     here instead of crashing deep inside the geometry pipeline.
# ---------------------------------------------------------------------------


def _read_template_name(data_path):
    """Pull ``TEMPLATE_NAME = "…"`` out of a template_data.py without exec.

    Cheap (single AST parse, no module load), and side-effect-free —
    importantly, it never instantiates a ``TemplateLoader`` so disk
    scans for sketch / phase files are deferred to first use.
    Returns ``None`` if the file can't be parsed or has no top-level
    ``TEMPLATE_NAME`` string assignment.
    """
    try:
        with open(data_path, 'r', encoding='utf-8') as f:
            tree = ast.parse(f.read(), filename=data_path)
    except Exception:
        return None
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == 'TEMPLATE_NAME':
                if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                    return node.value.value
    return None


def _load_template_module(data_path, module_name):
    """Execute ``data_path`` as a fresh module under ``module_name``.

    Stable, simple — no sys.modules purging, no sys.path swizzling. The
    loader (``template_loader.TemplateLoader``) is a stable absolute
    import name and each template_data.py owns its own loader instance,
    so cross-template collisions are no longer possible at this layer.
    """
    if module_name in sys.modules:
        del sys.modules[module_name]
    spec = importlib.util.spec_from_file_location(module_name, data_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot build spec for {data_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _validate_template_spec(spec, folder_name):
    """Sanity-check the dict returned by ``get_template_logic``.

    Catches malformed templates at the boundary instead of letting them
    crash deep inside ``ParametricSketchBuilder`` with a confusing
    trace. Raises ``ValueError`` / ``TypeError`` with a message naming
    the offending template + sketch.
    """
    if not isinstance(spec, dict):
        raise TypeError(
            f"Template '{folder_name}': get_template_logic must return dict, "
            f"got {type(spec).__name__}")
    if not spec.get('Name'):
        raise ValueError(f"Template '{folder_name}': spec missing 'Name'")
    sketches = spec.get('Sketches')
    if not isinstance(sketches, list) or not sketches:
        raise ValueError(
            f"Template '{folder_name}': spec missing non-empty 'Sketches' list")
    for i, sk in enumerate(sketches, start=1):
        if not isinstance(sk, dict):
            raise TypeError(
                f"Template '{folder_name}': sketch index {i} is not a dict "
                f"(got {type(sk).__name__})")
        if not sk.get('Name'):
            raise ValueError(
                f"Template '{folder_name}': sketch index {i} missing 'Name'")
        if 'Blocks' not in sk:
            raise ValueError(
                f"Template '{folder_name}': sketch '{sk.get('Name')}' "
                f"(index {i}) missing 'Blocks'")
        if not isinstance(sk['Blocks'], list):
            raise TypeError(
                f"Template '{folder_name}': sketch '{sk.get('Name')}' "
                f"'Blocks' must be list, got {type(sk['Blocks']).__name__}")


def _make_lazy_loader(folder_name, data_path):
    """Build a ``loader(ui_data)`` closure that imports on first call.

    The closure caches the imported template_data module so repeated
    builds within a single Fusion run skip the import. Each invocation
    re-runs ``get_template_logic`` (so ui_data is honored) and revalidates
    the returned spec.
    """
    module_name = f"fb_template_{folder_name}_template_data"
    cached = {'module': None}

    def loader(ui_data=None):
        if cached['module'] is None:
            cached['module'] = _load_template_module(data_path, module_name)
        mod = cached['module']
        try:
            spec = mod.get_template_logic(ui_data)
        except TypeError:
            spec = mod.get_template_logic()
        _validate_template_spec(spec, folder_name)
        return spec

    return loader


def _discover_template_entries():
    """Build the registry without importing any template_data.py.

    Reads ``TEMPLATE_NAME`` via AST, defers the actual import to the
    closure returned by ``_make_lazy_loader``. Folders missing
    ``template_data.py`` or ``TEMPLATE_NAME`` are skipped with a log
    warning (so a typo doesn't silently drop a template).
    """
    entries = []
    if not os.path.isdir(_SKETCHES_ROOT):
        return entries

    if logger:
        logger.log(f"TEMPLATE DISCOVERY: scanning {_SKETCHES_ROOT}")

    for folder in sorted(os.listdir(_SKETCHES_ROOT)):
        folder_path = os.path.join(_SKETCHES_ROOT, folder)
        if not os.path.isdir(folder_path) or not folder.startswith('template_'):
            continue

        data_path = os.path.join(folder_path, 'template_data.py')
        if not os.path.isfile(data_path):
            if logger:
                logger.log(
                    f"Template '{folder}' skipped — no template_data.py",
                    "WARNING")
            continue

        style_name = _read_template_name(data_path)
        if not style_name:
            if logger:
                logger.log(
                    f"Template '{folder}' skipped — TEMPLATE_NAME not found "
                    f"in {data_path}", "WARNING")
            continue

        template_index = folder.split('_', 1)[1] if '_' in folder else folder
        prefix = f"T{template_index}" if template_index.isdigit() else folder.upper()

        entries.append({
            'id': folder,
            'style_name': style_name,
            'loader': _make_lazy_loader(folder, data_path),
            'prefix': prefix,
            'folder': folder,
        })

        if logger:
            logger.log(
                f"TEMPLATE DISCOVERED: {folder} -> '{style_name}' "
                f"(prefix={prefix}, lazy)")

    return entries


def _ensure_template_registry():
    global _TEMPLATE_REGISTRY
    if _TEMPLATE_REGISTRY is None:
        _TEMPLATE_REGISTRY = _discover_template_entries()
    return _TEMPLATE_REGISTRY


def _resolve_template(style_id, ui_data=None):
    """Return ``(template_spec, prefix)`` for ``style_id``. Raises on unknown id.

    Match strategy (strict — no fuzzy substring):
      1. Exact folder id (``template_1``).
      2. Exact full name (``"Template 1 - Hourglass"``).
      3. Case-insensitive base label (``"template 1"``, the part before
         the first ``" - "``).

    Substring matching was removed because it caused false positives
    when one template's name happened to be a substring of another's,
    and because the UI always passes a precise identifier.
    """
    registry = _ensure_template_registry()
    normalized = str(style_id or '').strip()
    registry_names = [f"{e['id']} ({e['style_name']})" for e in registry]
    if logger:
        logger.log(
            f"TEMPLATE RESOLVE: trying style_id='{style_id}' "
            f"with registry={registry_names}")

    for entry in registry:
        candidate_id = entry['id']
        candidate_name = entry['style_name']
        candidate_label = (candidate_name.split(' - ')[0]
                           if ' - ' in candidate_name else candidate_name)

        if normalized == candidate_id:
            if logger:
                logger.log(
                    f"TEMPLATE RESOLVE: exact id match '{style_id}' -> "
                    f"'{candidate_name}' (folder={entry['folder']})")
            return entry['loader'](ui_data), entry['prefix']
        if normalized == candidate_name:
            if logger:
                logger.log(
                    f"TEMPLATE RESOLVE: exact name match '{style_id}' -> "
                    f"'{candidate_name}' (folder={entry['folder']})")
            return entry['loader'](ui_data), entry['prefix']
        if normalized.lower() == candidate_label.lower():
            if logger:
                logger.log(
                    f"TEMPLATE RESOLVE: base label match '{style_id}' -> "
                    f"'{candidate_name}' (folder={entry['folder']})")
            return entry['loader'](ui_data), entry['prefix']

    raise ValueError(
        f"Unknown style_id: '{style_id}'. Registered: {registry_names}")


def get_available_templates():
    """Return the list of available templates for UI population."""
    registry = _ensure_template_registry()
    templates = [{"label": entry["style_name"], "value": entry["id"]}
            for entry in registry]
    if logger:
        logger.log(f"TEMPLATE LIST GENERATED: {[t['value'] for t in templates]}")
    return templates


def get_template_spec(style_id="Template 1"):
    """Module-level wrapper so the UI can call frame_engine.get_template_spec() directly."""
    spec, _ = _resolve_template(style_id)
    return spec


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
                sketch = frame_comp.sketches.itemByName(f"{prefix}_3_frame-enclosure")
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

    def _create_skeletal_parameters(self, target_body=None, style_id="Template 1", ui_data=None):
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
            # These are dependencies for the factors below.
            for p_info in all_params:
                if p_info.get("ReadOnly"):
                    name = p_info["Name"]
                    existing = self.user_params.itemByName(name)
                    if existing:
                        continue

                    default_val = float(p_info.get("Val", 0))
                    unit = p_info.get("Unit", "cm")
                    # createByString honors the unit suffix so a schema like
                    # Val=5.51, Unit="in" creates 5.51 in (= 13.99 cm internally).
                    # createByReal would have stored 5.51 as cm regardless of
                    # the unit display field, silently truncating inch-authored
                    # values to ~40% of their intended size.
                    expr_str = f"{default_val} {unit}".strip() if unit else str(default_val)
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
                        except:
                            self.logger.log(f"CRITICAL: Fallback failed for {name}", "ERROR")
                else:
                    # UPDATE EXISTING: UI should win during a build cycle
                    try:
                        existing.expression = str(val_expr)
                        self.logger.log(f"DEPENDENT (Updated): {name} -> {val_expr}")
                    except Exception as e:
                        self.logger.log(f"DEPENDENT UPDATE FAIL ({name}): {e}", "WARNING")

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
   