"""
Solid Coordinator — The orchestrator for frame synthesis.
Coordinates document discovery, geometry extrusion, and appearance finishing.
"""
import adsk.core, adsk.fusion, traceback, os, importlib, time
from fb_engine.appearance_manager import AppearanceManager, APPEARANCE_PRESETS
from fb_engine.appearance_strategy import AppearanceStrategy, DefaultAppearanceStrategy
from fb_engine.document_discovery import DocumentDiscovery
from fb_engine.extrusion_engine import ExtrusionEngine

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
            bodies = self.extrusion_engine.extrude_profiles(
                comp, sketch, prefix, self.to_face, self.start_offset_expr, self.offset_expr
            )
            self.log.log(f"Extrusion Phase: {time.time() - t_extrusion:.2f}s | created {len(bodies)} bar bodies")

            # 4. SURGICAL CLEANUP — strategy restores the captured paint and
            # clears Fusion's grey-steel face overrides on the cut faces.
            t_finish = time.time()
            self.appearance_strategy.restore(core_body, original_app)

            # 5. FINISHING — strategy applies the UI-selected preset to new
            # bar bodies, or falls back to the captured panel paint, or
            # leaves them alone (a custom strategy may also choose none).
            self.appearance_strategy.finish(bodies, self.appearance_name, original_app)

            self.log.log(f"Finishing Phase: {time.time() - t_finish:.2f}s")
            self.log.log(f"SOLID SYNTHESIS FINISHED OK (Total: {time.time() - start_time:.2f}s)")

        except Exception:
            self.log.log(f"COORDINATOR CRASH:\n{traceback.format_exc()}", "ERROR")

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
