"""
Solid Coordinator — The orchestrator for frame synthesis.
Coordinates document discovery, geometry extrusion, and appearance finishing.
"""
import adsk.core, adsk.fusion, traceback, os, importlib, re, time
from fb_engine.appearance_manager import AppearanceManager, APPEARANCE_PRESETS
from fb_engine.appearance_strategy import AppearanceStrategy, DefaultAppearanceStrategy
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
        """
        Ultra-Robust Discovery:
        1. Attribute Tagging (Elite)
        2. Exact Name (UI Selected)
        3. Greedy Scavenge (Case-insensitive 'frame' search)
        4. Active Component (Ultimate Failsafe)
        """
        if not self.root:
            self.log.log("  DISCOVERY ERROR: design root is missing.")
            return None

        # --- 1. Attribute Search ---
        try:
            attrs = self.design.findAttributes('FrameBuilder', 'ComponentType')
            for attr in attrs:
                if attr.value == 'Frame':
                    comp = adsk.fusion.Component.cast(attr.parent)
                    if comp:
                        self.log.log(f"  DISCOVERY HIT (Tag): '{comp.name}'")
                        return comp
        except Exception as attr_err:
            self.log.log(f"  DISCOVERY: attribute search failed: {attr_err}", "DEBUG")

        # --- 2. Greedy Scavenge (Case-Insensitive 'frame' search) ---
        self.log.log("  DISCOVERY: Attributes failed. Greedy scavenging...")
        best_comp = None
        max_idx = -1
        
        # We check all occurrences in the root for anything 'frame-like'
        for occ in self.root.occurrences:
            try:
                cname = occ.component.name.lower()
                if "frame" in cname:
                    # Potential hit! Let's try to find if it has a number
                    try:
                        # Extract number from names like 'Frame_45', 'frame 1', etc.
                        import re
                        match = re.search(r'\d+', cname)
                        if match:
                            idx = int(match.group())
                            if idx > max_idx:
                                max_idx = idx
                                best_comp = occ.component
                        elif not best_comp:
                            best_comp = occ.component
                    except Exception:
                        if not best_comp: best_comp = occ.component
            except Exception:
                continue
            
        if best_comp:
            self.log.log(f"  SCAVENGE HIT: Using frame-like component '{best_comp.name}'")
            return best_comp

        # --- 3. Ultimate Fallback: Root Component ---
        # If we can't find anything named 'frame', use the document root.
        if self.root:
            self.log.log(f"  DISCOVERY FALLBACK: Using Root Component '{self.root.name}'")
            return self.root
        return None

    def _find_sketch(self, target_comp):
        """
        Deep-Search for the solid synthesis sketch with Category Priority.
        1. FRAME ENCLOSURE (Phase 3)
        2. FRAME SKETCH (General)
        3. SHAPE OUTLINE (Phase 2 Fallback)
        """
        target_patterns = [
            ("FRAME ENCLOSURE", [
                "_3_frame-enclosure", "_3_frame_enclosure", "_3_frame enclosure",
                "3_frame-enclosure", "3_frame_enclosure", "3_frame enclosure",
                "_frame-enclosure", "_frame_enclosure", "frame-enclosure", "frame_enclosure", "frame enclosure"
            ]),
            ("FRAME SKETCH", [
                "_3_frame", "_frame", "frame"
            ]),
            ("SHAPE OUTLINE", [
                "_2_shape-outline", "_2_shape_outline", "_2_shape outline",
                "2_shape-outline", "2_shape_outline", "2_shape outline",
                "shape-outline", "shape_outline", "shape outline"
            ])
        ]
        
        # 1. Targeted check in target_comp (ordered by category priority)
        if target_comp:
            self.log.log(f"  DISCOVERY: Searching project sketches in '{target_comp.name}'...")
            
            # Diagnostic: Log ALL available candidates first
            for i in range(target_comp.sketches.count):
                sk = target_comp.sketches.item(i)
                self.log.log(f"    SKETCH CANDIDATE: component='{target_comp.name}' sketch='{sk.name}'")

            # Priority Search Loop: Category FIRST
            for category, patterns in target_patterns:
                for i in range(target_comp.sketches.count):
                    sk = target_comp.sketches.item(i)
                    sk_name = (sk.name or '').lower()
                    for pattern in patterns:
                        if pattern in sk_name:
                            self.log.log(f"  SKETCH HIT: component='{target_comp.name}' sketch='{sk_name}' category='{category}' pattern='{pattern}'")
                            prefix = sk_name.split("_")[0]
                            return sk, prefix

        # 2. Deep Scavenge (Failsafe for entire assembly, also by category priority)
        self.log.log("  SKETCH: Targeted search failed. Deep-scanning assembly by priority...")
        all_comps = self.design.allComponents
        
        for category, patterns in target_patterns:
            for comp in all_comps:
                for i in range(comp.sketches.count):
                    sk = comp.sketches.item(i)
                    sk_name = (sk.name or '').lower()
                    for pattern in patterns:
                        if pattern in sk_name:
                            self.log.log(f"  SKETCH HIT (Deep): Found '{sk_name}' in '{comp.name}' [{category}]")
                            prefix = sk_name.split("_")[0]
                            return sk, prefix

        return None, "T1"


class _NullLogger:
    def log(self, *a, **kw): pass
    def log_error(self, *a, **kw): pass
    def session_start(self, *a): pass
