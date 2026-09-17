"""
Sketch Builder palette — focused on template selection, parameter authoring,
and skeleton sketch construction. Auto-closes after a successful build.

Runs on the shared palette scaffold (FB2 slice a) — see palette_scaffold.py
and FB2-PALETTE-SCAFFOLD-DESIGN.md. Everything left in this file is
genuinely sketch-specific: schema push, parameter hydration, the tilt-param
invariant, and template selection have no solid-side equivalent to share.
"""
import adsk.core, adsk.fusion, traceback
import os, json, sys, importlib

# Add parent directory to sys.path so we can import from core folders (engine, utils, etc.)
current_dir = os.path.dirname(os.path.realpath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)
# palette_scaffold.py lives alongside this file, in ui/ itself (not a
# package) — that directory is never otherwise on sys.path (only its
# PARENT is, for `from fb_engine import ...`), so add it here (FB2).
if current_dir not in sys.path:
    sys.path.append(current_dir)

from palette_scaffold import PaletteSpec, _PaletteBridgeMixin, make_palette

# Modular imports - initialized by the Entry Point (bspline-frame-builder.py)
frame_engine = None

# Standard Logger setup
try:
    from fb_utils import fb_logger as logger
    diag_logger = logger.DebugLogger(parent_dir)
except Exception:
    diag_logger = None

PALETTE_ID = 'frameSketchBuilderPalette'
PALETTE_NAME = 'Sketch Builder'
PALETTE_HTML = 'html/sketch_builder_palette.html'

BUILD_SKETCH_CMD_ID = 'frameSketchBuildCommand'
SCHEMA_PUSH_CMD_ID  = 'frameSketchSchemaPushCommand'
_pending_schema_style = None

_doc_activated_handler = None  # Holds DocumentActivated subscription to prevent GC


def _schedule_schema_push(style_id="Template 1"):
    """Defer a schema push to a fresh Fusion event (outside the HTML event handler)."""
    global _pending_schema_style
    _pending_schema_style = style_id
    if diag_logger: diag_logger.log(f"SCHEMA PUSH: scheduled for style '{style_id}'")
    try:
        app = adsk.core.Application.get()
        if not app:
            return
        cmd_def = app.userInterface.commandDefinitions.itemById(SCHEMA_PUSH_CMD_ID)
        if cmd_def:
            cmd_def.execute()
    except Exception:
        if diag_logger: diag_logger.log_error(f"_schedule_schema_push failed:\n{traceback.format_exc()}")


def _run_schema_push_execute():
    """extra_commands execute_fn for SCHEMA_PUSH_CMD_ID: reads the queued
    style, then pushes the schema."""
    global _pending_schema_style
    style = _pending_schema_style or "Template 1"
    _pending_schema_style = None
    _push_schema_direct(style)


def _push_schema_direct(style_id="Template 1"):
    """Build the schema, hydrate ReadOnly params with live Fusion values,
    and send render_schema to the palette."""
    try:
        if not frame_engine:
            return

        template_spec = frame_engine.get_template_spec(style_id)
        if not template_spec:
            return

        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct) if app else None
        user_params = design.userParameters if design else None

        def _hydrate_params(raw_params):
            out = []
            w_in = user_params.itemByName('widthIn').value if user_params and user_params.itemByName('widthIn') else 14.0
            h_in = user_params.itemByName('heightIn').value if user_params and user_params.itemByName('heightIn') else 5.0

            for p in raw_params:
                p_live = dict(p)
                p_name = p['Name']

                fp = user_params.itemByName(p_name) if user_params else None
                p_live['Exists'] = bool(fp)
                if fp:
                    raw_val = fp.value
                    if p_name in ['ShoulderSpan', 'WaistSpan', 'HipSpan']:
                        p_live['Val'] = round(raw_val / w_in, 4) if w_in != 0 else p.get('Val', 0)
                    elif p_name in ['TopGap', 'BottomGap',
                                    'ShoulderRadius', 'WaistRadius', 'HipRadius']:
                        p_live['Val'] = round(raw_val / h_in, 4) if h_in != 0 else p.get('Val', 0)
                    elif p_name == 'WaistOffset':
                        p_live['Val'] = round(raw_val / (h_in / 2.0), 4) if h_in != 0 else p.get('Val', 0)
                    else:
                        target_unit = p.get('Unit', 'cm')
                        p_live['Val'] = round(raw_val / 2.54, 4) if target_unit == 'in' else round(raw_val, 4)

                if isinstance(p_live.get('Val'), str) and design:
                    try:
                        eval_val = design.unitsManager.evaluateExpression(p_live['Val'], p.get('Unit', 'cm'))
                        if p_name in ['ShoulderSpan', 'WaistSpan', 'HipSpan']:
                            p_live['Val'] = round(eval_val / w_in, 4) if w_in != 0 else 0.8
                        elif p_name in ['TopGap', 'BottomGap',
                                        'ShoulderRadius', 'WaistRadius', 'HipRadius']:
                            p_live['Val'] = round(eval_val / h_in, 4) if h_in != 0 else 0.15
                        else:
                            p_live['Val'] = round(eval_val, 4)
                    except Exception:
                        pass

                for key in ['Min', 'Max']:
                    if key in p_live and isinstance(p_live[key], str):
                        try:
                            expr = p_live[key]
                            if design:
                                eval_val = design.unitsManager.evaluateExpression(expr, p_live.get('Unit', 'cm'))
                                # evaluateExpression returns the value in
                                # Fusion's database units (cm). Convert to
                                # the param's display unit so the slider's
                                # max attribute matches the slider's
                                # value space - mirrors the Val conversion
                                # on the line above. Without this, a
                                # frame_thickness Max of "heightIn / 16"
                                # for heightIn=6 in evaluates to 0.9525
                                # cm and the slider treats that as 0.95
                                # in, letting the user pick values way
                                # above the geometric threshold.
                                target_unit = p_live.get('Unit', 'cm')
                                if target_unit == 'in':
                                    eval_val = eval_val / 2.54
                                p_live[key] = round(eval_val, 4)
                        except Exception:
                            pass
                out.append(p_live)
            return out

        sketches_out = []
        phase_count = 0
        for sketch in template_spec.get("Sketches", []):
            blocks = sketch.get("Blocks", [])
            sketch_phase_count = len(blocks) if blocks else 1
            phase_count += sketch_phase_count
            phase_files = []
            for block in blocks:
                if isinstance(block, dict):
                    phase_files.append(block.get("PhaseFile") or block.get("PhaseID") or '')
            sketches_out.append({
                "name":        sketch.get("Name", ""),
                "label":       sketch.get("Label", sketch.get("Name", "")),
                "parameters":  _hydrate_params(sketch.get("Parameters", [])),
                "phase_count": sketch_phase_count,
                "phase_files": phase_files,
            })

        pal = app.userInterface.palettes.itemById(PALETTE_ID) if app else None
        if pal:
            pal.sendInfoToHTML('render_schema', json.dumps({
                'template':   style_id,
                'sketches':   sketches_out,
                'phase_count': phase_count
            }))
    except Exception:
        if diag_logger: diag_logger.log_error(f"_push_schema_direct FAILED:\n{traceback.format_exc()}")


if diag_logger:
    diag_logger.log("SKETCH BUILDER UI MODULE: Loaded")


class PaletteHTMLEventHandler(_PaletteBridgeMixin, adsk.core.HTMLEventHandler):
    def __init__(self, diag_logger=None):
        super().__init__()
        self.diag_logger = diag_logger
        self.style_id = None
        self.active_vars = {}

    def notify(self, args):
        try:
            event_args = adsk.core.HTMLEventArgs.cast(args)
            if not event_args: return

            action = event_args.action
            data_str = event_args.data

            if self.diag_logger:
                self.diag_logger.log(f">>> SKETCH UI EVENT: {action} | DATA: {data_str[:100]}...")

            try:
                data = json.loads(data_str)
            except Exception:
                data = {}

            app = adsk.core.Application.get()
            ui = app.userInterface
            design = adsk.fusion.Design.cast(app.activeProduct)

            if action == 'update_param':
                p_id = data.get('id') or data.get('name')
                val = data.get('value')
                self.active_vars[p_id] = val
                self._update_fusion_param(design, p_id, val)

            elif action == 'update_lock':
                p_id = data.get('id') or data.get('name')
                is_locked = data.get('locked', False)
                lock_name = f"en_{p_id}"
                lock_val = 1.0 if is_locked else 0.0
                self.active_vars[lock_name] = lock_val
                self._update_fusion_param(design, lock_name, lock_val)

            elif action == 'change_template':
                self.style_id = data.get('template', "Template 1")
                _schedule_schema_push(self.style_id)

            elif action in ('request_template_list', 'get_templates'):
                self._send_template_list(ui.palettes.itemById(PALETTE_ID))

            elif action == 'run_build':
                self._run_sketch_build(data)

            elif action == 'ping':
                self._send_palette_message(ui.palettes.itemById(PALETTE_ID), 'response', {'data': 'PONG'})

        except Exception:
            if self.diag_logger: self.diag_logger.log_error(f"SketchPaletteHTMLEvent ERROR:\n{traceback.format_exc()}")

    def _send_template_list(self, pal):
        try:
            if not pal or not frame_engine:
                return False
            templates = frame_engine.get_available_templates()
            payload = {
                'templates': templates,
                'selected': self.style_id
            }
            ok = self._send_palette_message(pal, 'template_list', payload)
            # Piggyback the deployed version stamp on the first template_list reply.
            self._send_build_info(pal)
            return ok
        except Exception as e:
            if self.diag_logger: self.diag_logger.log_error(f"Template list send failed: {e}")
            return False

    def _update_fusion_param(self, design, name, value):
        try:
            # Late import — fb_engine is initialized by the entry point and
            # may not be importable at module-load time. Pulling the
            # resolver module up here gives us the FBValueResolver for
            # factor wrapping; ParameterSchema owns the unit defaults.
            from fb_engine import fb_value_resolver, parameter_schema
            importlib.reload(parameter_schema)
            importlib.reload(fb_value_resolver)
            from fb_engine.parameter_schema import ParameterSchema

            params = design.userParameters
            p = params.itemByName(name)
            if not p:
                try:
                    # Schema-aware unit (was hardcoded 'cm' — silently
                    # demoted ReadOnly inches params on first add).
                    unit = ParameterSchema.default_unit(name)
                    p = params.add(name, adsk.core.ValueInput.createByReal(0.0), unit, "Sketch Builder Sync")
                except Exception as ex:
                    if self.diag_logger: self.diag_logger.log(f"PARAM SYNC: Failed to create '{name}': {ex}", "ERROR")
                    return

            if p:
                resolver = fb_value_resolver.FBValueResolver(design, self.diag_logger)
                expr = resolver.wrap_expression_if_factor(name, value)

                if name.startswith('en_'):
                    expr = str(float(value))

                p.expression = str(expr)
        except Exception as e:
            if self.diag_logger: self.diag_logger.log(f"PARAM SYNC ERROR: {e}")

    def _run_sketch_build(self, data):
        style_id = data.get('template') or self.style_id
        if self.diag_logger: self.diag_logger.log(f"RUN SKETCH BUILD triggered. Style: {style_id}")
        request_data = dict(data)
        request_data['ui_state'] = self.active_vars
        request_data['style_id'] = style_id
        _palette.schedule_hidden_build(request_data)


def _build_fn(data, ctx):
    """PaletteSpec.build_fn: runs the actual sketch build from the hidden command's queued request."""
    style_id = data.get('style_id', 'Template 1')
    try:
        if ctx.diag_logger: ctx.diag_logger.log(f"RUN SKETCH BUILD (hidden command). Style: {style_id}")

        max_phase = data.get('max_phase') if isinstance(data, dict) else None
        phase_label = f" · up to phase {max_phase}" if max_phase is not None else ""
        ctx.set_status(f"Building {style_id}{phase_label}…")

        if ctx.frame_engine:
            ctx.frame_engine.build_sketch_logic_v3(style_id=style_id, external_logger=ctx.diag_logger, data=data)
            ctx.set_status(f"{style_id} · sketch complete{phase_label}")
            ctx.notify_status("Sketch Build Complete")
            # Auto-close on success
            ctx.close_palette()
        else:
            if ctx.diag_logger: ctx.diag_logger.log_error("CRITICAL: frame_engine is NOT INJECTED")
            ctx.set_status("Build error: frame engine not loaded — restart add-in")
    except Exception as e:
        short = str(e).split('\n')[0][:120]
        ctx.set_status(f"Build failed: {short} — see log")
        if ctx.diag_logger: ctx.diag_logger.log_error(f"Sketch Build Logic Failed:\n{traceback.format_exc()}")


def _ensure_tilt_param_safe():
    """Ensure the frame_tilt_deg user parameter exists in the active design,
    OUTSIDE any build command's Execute (E8). Best-effort — never blocks the UI.
    Called at palette-open and on document-activated so undo can't orphan a
    mid-build parameter create. See UNDO-REDO-DESIGN.md."""
    try:
        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct) if app else None
        if design and frame_engine and hasattr(frame_engine, 'parametric_engine'):
            frame_engine.parametric_engine.ensure_tilt_param(design, diag_logger)
    except Exception:
        if diag_logger:
            diag_logger.log_error(f"_ensure_tilt_param_safe:\n{traceback.format_exc()}")


def _on_document_activated(ctx):
    """Re-pushes the palette schema whenever the user switches active
    documents. Reads the live style_id straight off ctx.active_handler —
    its value is always current, since change_template sets it directly
    on this same live handler instance (verified turn 147)."""
    try:
        # Tilt param invariant (E8): a newly-activated design may lack
        # frame_tilt_deg — ensure it now (outside any build Execute).
        _ensure_tilt_param_safe()
        pal = adsk.core.Application.get().userInterface.palettes.itemById(PALETTE_ID)
        if pal and pal.isVisible:
            style = ctx.active_handler.style_id if ctx.active_handler else "Template 1"
            _schedule_schema_push(style)
    except Exception:
        if ctx.diag_logger: ctx.diag_logger.log_error(f"_on_document_activated CRASH:\n{traceback.format_exc()}")


def _on_ready(ctx):
    """Runs once after the palette is shown: ensure the tilt param, pick the
    first available template, then push the initial schema."""
    _ensure_tilt_param_safe()   # E8 F1-C: the param must exist BEFORE any build
    try:
        if frame_engine:
            templates = frame_engine.get_available_templates()
            if templates and ctx.active_handler:
                ctx.active_handler.style_id = templates[0]['value']
    except Exception:
        pass
    _schedule_schema_push(ctx.active_handler.style_id if ctx.active_handler else "Template 1")


def _make_html_handler(diag_logger):
    return PaletteHTMLEventHandler(diag_logger=diag_logger)


_spec = PaletteSpec(
    palette_id=PALETTE_ID,
    name=PALETTE_NAME,
    html_path=PALETTE_HTML,
    size=(450, 700),
    min_size=(320, 500),
    build_cmd_id=BUILD_SKETCH_CMD_ID,
    build_fn=_build_fn,
    make_html_handler=_make_html_handler,
    extra_commands=((SCHEMA_PUSH_CMD_ID, 'Push Schema', _run_schema_push_execute),),
    on_document_activated=_on_document_activated,
    on_ready=_on_ready,
)

_palette = make_palette(_spec)
handlers = _palette.handlers


def run_palette(engine_instance, diag_logger=None):
    """Central runner to launch the Sketch Builder palette. Thin wrapper so
    the module-level _doc_activated_handler attribute (read by
    bspline-frame-builder.py's _teardown_submodules via getattr) stays in
    sync with the scaffold's own tracked handler after every call."""
    global frame_engine, _doc_activated_handler
    frame_engine = engine_instance
    _palette.run_palette(engine_instance, diag_logger=diag_logger)
    _doc_activated_handler = _palette.get_doc_activated_handler()


class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            run_palette(frame_engine, diag_logger=diag_logger)
        except Exception as e:
            if diag_logger:
                diag_logger.log_error(f"SketchBuilder CommandCreatedHandler CRASH:\n{traceback.format_exc()}")
            adsk.core.Application.get().userInterface.messageBox(f"Palette Launch Failed:\n{e}")
