"""
Solid Coordinator — The orchestrator for frame synthesis.
Coordinates document discovery, geometry extrusion, and appearance finishing.
"""
import adsk.core, adsk.fusion, traceback, os, importlib, json, time
from fb_engine.appearance_manager import AppearanceManager, APPEARANCE_PRESETS
from fb_engine.appearance_strategy import AppearanceStrategy, DefaultAppearanceStrategy
from fb_engine.document_discovery import DocumentDiscovery
from fb_engine.extrusion_engine import ExtrusionEngine
from fb_engine import timeline_order
from fb_engine.joined_miters import JOINED_MITERS_ATTR

# F14 (S6): the template a frame component was built from (stamped by
# frame_engine._create_incremental_component), so the solid build reads that
# template's declared frame features.
TEMPLATE_ID_ATTR = ("FrameBuilder", "TemplateId")

# --- VERSION STAMP (Diagnostic) ---
FB_VERSION = "4.07.B"

try:
    from fb_utils import fb_logger as _logger_mod
    importlib.reload(_logger_mod)
except Exception:
    _logger_mod = None

def build_solid_logic_v3(comp_name=None, to_face=None,
                      start_offset_expr="0 in",
                      appearance_name=None,
                      external_logger=None,
                      appearance_strategy=None):
    """
    Public entry point (v3) for the frame synthesis operation.
    """
    coordinator = SolidCoordinator(
        to_face,
        start_offset_expr,
        appearance_name,
        external_logger,
        appearance_strategy=appearance_strategy,
    )
    coordinator.log.log(f"--- SOLID V3 ENTRY POINT TRIGGERED (FB_VERSION: {FB_VERSION}) ---")
    coordinator.run(comp_name)

class SolidCoordinator:
    def __init__(self, to_face=None, start_offset_expr="0 in", appearance_name=None,
                 external_logger=None, appearance_strategy=None):
        self.app = adsk.core.Application.get()
        self.design = adsk.fusion.Design.cast(self.app.activeProduct)
        self.root = self.design.rootComponent if self.design else None

        if external_logger:
            self.log = external_logger
        else:
            addin_root = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
            self.log = (_logger_mod.DebugLogger(addin_root) if _logger_mod else _NullLogger())

        self.to_face = to_face
        self.start_offset_expr = start_offset_expr
        self.appearance_name = appearance_name
        self.offset_expr = "0 in" # Flush fit

        # Initialize Specialized Engines (Sharing the unified logger)
        self.appearance_manager = AppearanceManager(self.app, self.design, self.log)
        self.extrusion_engine   = ExtrusionEngine(self.app, self.design, self.log)
        # Centralized document-state queries — shared with FrameBuilder
        # via fb_engine.document_discovery.
        self.discovery          = DocumentDiscovery(self.app, self.design, self.log)

        # Appearance pipeline is pluggable. If the caller hasn't supplied a
        # strategy, build the default one (capture true panel paint, restore
        # after the cut, finish with preset-or-fallback). Tests and custom
        # production rules can pass in a different AppearanceStrategy.
        if appearance_strategy is None:
            appearance_strategy = DefaultAppearanceStrategy(self.appearance_manager, self.log)
        self.appearance_strategy = appearance_strategy

    def _sync_offset_param(self, expr):
        """Create or update the 'frame_height_offset' user parameter from the
        palette's Start Offset value, and return an expression the extrude can
        bind to.

        The box always wins: every build overwrites the parameter with the
        typed value. Returns the parameter name so the extrude's start offset
        references the variable, or '0 in' when the value is effectively zero
        (so ExtrusionEngine's zero-skip path still applies).
        """
        name = "frame_height_offset"
        expr = (expr or "0 in").strip()
        try:
            params = self.design.userParameters
            p = params.itemByName(name)
            if p is None:
                p = params.add(
                    name,
                    adsk.core.ValueInput.createByReal(0.0),
                    "in",
                    "Solid Builder start offset (frame height offset)",
                )
            p.expression = expr
            self.log.log(f"OFFSET PARAM: {name} = '{expr}' (value={p.value:.4f} cm)")
            return name if abs(p.value) > 1e-6 else "0 in"
        except Exception as e:
            self.log.log(f"OFFSET PARAM SYNC FAILED ({e}); using literal '{expr}'", "WARNING")
            return expr

    def run(self, comp_name):
        """
        The orchestrated sequence of frame synthesis.
        """
        start_time = time.time()
        try:
            self.log.session_start(f"SOLID COORDINATOR (v{FB_VERSION}): Synthesis Started")
            self.log.log(f"SOLID BUILD: comp_name='{comp_name}'")
            
            # 1. DISCOVERY
            t_discovery = time.time()
            comp = self._resolve_component(comp_name)
            if not comp:
                self.log.log("ABORT: No target component found", "ERROR")
                return

            sketch, prefix = self._find_sketch(comp)
            if not sketch:
                self.log.log(f"ABORT: No frame-outline sketch found in '{comp.name}'", "ERROR")
                return

            self.log.log(f"DISCOVERY: component='{comp.name}' sketch='{sketch.name}' prefix='{prefix}'")
            self.log.log(f"Discovery Phase: {time.time() - t_discovery:.2f}s")

            # 2. CAPTURE & SNAPSHOT
            # Strategy snapshots the core panel's true 'Custom Paint' before
            # the trim cut vandalizes it. Default strategy walks the body /
            # faces / assembly context looking for non-generic appearances.
            core_body = self.to_face.body if self.to_face else None
            original_app = self.appearance_strategy.capture(core_body)

            # 3. GEOMETRY SYNTHESIS (Extrusion Engine)
            t_extrusion = time.time()
            # Wire the palette's Start Offset to a persistent user parameter
            # 'frame_height_offset' so the extrude's start offset is driven by
            # a variable visible/editable in the Parameters table. The box
            # wins: every build overwrites the parameter with the typed value.
            start_expr = self._sync_offset_param(self.start_offset_expr)
            bodies = self.extrusion_engine.extrude_profiles(
                comp, sketch, prefix, self.to_face, start_expr, self.offset_expr,
                declared=self._declared_frame(comp),
            )
            self.log.log(f"Extrusion Phase: {time.time() - t_extrusion:.2f}s | created {len(bodies)} bar bodies")

            # 4. SURGICAL CLEANUP — strategy restores the captured paint and
            # clears Fusion's grey-steel face overrides on the cut faces.
            t_finish = time.time()
            self.appearance_strategy.restore(core_body, original_app)
            # ...and every body the trim actually CUT, each with its OWN component's paint. MEASURED live 2026-10-07
            # (Fred: "the B-spline edge in Fusion is wood colour ... depends on the component"): the face was Clean's
            # panel (red) while t1_TRIM_CUT cut Stamped's -- its 12 new walls showed the Pine material, only its two
            # B-spline faces kept the green, as face overrides. capture() after the cut reads that body's own paint
            # back from its surviving import faces; restore() re-stamps it on the whole body and clears the overrides.
            for cut_body in getattr(self.extrusion_engine, 'cut_bodies', None) or []:
                self.appearance_strategy.restore(cut_body, self.appearance_strategy.capture(cut_body))

            # 5. FINISHING — strategy applies the UI-selected preset to new
            # bar bodies, or falls back to the captured panel paint, or
            # leaves them alone (a custom strategy may also choose none).
            self.appearance_strategy.finish(bodies, self.appearance_name, original_app)

            self.log.log(f"Finishing Phase: {time.time() - t_finish:.2f}s")

            # 6. FB-ORDER: the extrudes + TRIM_CUT above were appended at the
            # END of the timeline, i.e. after the inlay. Re-run the same
            # reorder the sketch build ends with, so the whole frame block
            # sits before the inlay (measured live in F2: without this they
            # stayed after it).
            timeline_order.ensure_frame_before_inlay(self.design, comp.name, self.log)
            self.log.log(f"SOLID SYNTHESIS FINISHED OK (Total: {time.time() - start_time:.2f}s)")

        except Exception:
            self.log.log(f"COORDINATOR CRASH:\n{traceback.format_exc()}", "ERROR")

    def _joined_miters_of(self, comp):
        """F31 item 2c: the joined-joint ids stamped onto `comp` (frame_engine.run_sketch_only,
        alongside TemplateId) -- a template re-resolved from disk here has no other way to learn
        which joints a live frame record asked to be built as one piece (fb_engine/joined_miters.py's
        own module docstring). `[]` when absent/malformed."""
        try:
            a = comp.attributes.itemByName(*JOINED_MITERS_ATTR)
        except Exception:
            a = None
        if not a or not a.value:
            return []
        try:
            ids = json.loads(a.value)
        except (ValueError, TypeError):
            return []
        return ids if isinstance(ids, list) else []

    def _declared_frame(self, comp):
        """The "Frame" block (regions + features) of the template ``comp`` was
        built from, or None (no stamp: built before S6; or a template that
        declares no frame features) -> the extruder's bounding-box path."""
        try:
            a = comp.attributes.itemByName(*TEMPLATE_ID_ATTR)
        except Exception:
            a = None
        if not a:
            self.log.log(f"DECLARED FEATURES: '{comp.name}' carries no template id")
            return None
        from fb_engine.template_resolver import resolve_template
        spec, _ = resolve_template(a.value)
        # F31 item 2c: re-apply the SAME joined-miters mutation the sketch build applied (stamped
        # alongside TemplateId) -- the sketch-build's own in-memory mutated template is not
        # reachable here (this re-resolves fresh from disk), so the mutation must be redone from the
        # stamped attribute, not assumed to have carried over.
        joined = self._joined_miters_of(comp)
        if joined:
            from fb_engine.joined_miters import apply_joined_miters
            spec = apply_joined_miters(spec, joined)
            self.log.log(f"DECLARED FEATURES: '{comp.name}' re-applying joined miters {joined}")
        frame = spec.get("Frame") or {}
        if not (frame.get("regions") and frame.get("features")):
            self.log.log(f"DECLARED FEATURES: template '{a.value}' declares none")
            return None
        # T82 item 6: the inset window's own features, appended unconditionally (a no-op on a window-less
        # build -- classify() never produces their ids unless inset_window actually built window curves
        # into THIS build's sketch). A shallow copy: the resolved spec is template_resolver's own cache.
        from fb_engine.frame_definition import WINDOW_BARS_FEATURE, WINDOW_CUT_FEATURE
        frame = dict(frame)
        frame["features"] = list(frame["features"]) + [WINDOW_BARS_FEATURE, WINDOW_CUT_FEATURE]
        self.log.log(f"DECLARED FEATURES: template '{a.value}': {[f['id'] for f in frame['features']]}")
        return frame

    def _resolve_component(self, comp_name):
        """Locate the frame component to drop bars into.

        ``comp_name`` is currently advisory only — the actual ladder
        (attribute → greedy scavenge → root fallback) lives in
        :py:meth:`fb_engine.document_discovery.DocumentDiscovery.find_frame_component`
        and is name-agnostic. Kept as a thin pass-through so the rest of
        the coordinator's call sites stay unchanged.
        """
        return self.discovery.find_frame_component()

    def _find_sketch(self, target_comp):
        """Locate the frame outline sketch + its prefix token.

        Delegates to :py:meth:`fb_engine.document_discovery.DocumentDiscovery.find_frame_sketch`,
        which preserves the original category priority (FRAME ENCLOSURE
        > FRAME SKETCH > SHAPE OUTLINE) and the deep-scavenge fallback
        across ``design.allComponents``.
        """
        return self.discovery.find_frame_sketch(target_comp)


class _NullLogger:
    def log(self, *a, **kw): pass
    def log_error(self, *a, **kw): pass
    def session_start(self, *a): pass
