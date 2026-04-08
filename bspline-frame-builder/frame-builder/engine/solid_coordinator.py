"""
Solid Coordinator — The orchestrator for frame synthesis.
Coordinates document discovery, geometry extrusion, and appearance finishing.
"""
import adsk.core, adsk.fusion, traceback, os, importlib, re, time
from .appearance_manager import AppearanceManager, APPEARANCE_PRESETS
from .extrusion_engine import ExtrusionEngine

# --- VERSION STAMP (Diagnostic) ---
FB_VERSION = "4.07.B"

try:
    from utils import logger as _logger_mod
    importlib.reload(_logger_mod)
except Exception:
    _logger_mod = None

def build_solid_logic(comp_name=None, to_face=None,
                      start_offset_expr="0 in",
                      appearance_name=None):
    """
    Public entry point for the frame synthesis operation.
    """
    coordinator = SolidCoordinator(to_face, start_offset_expr, appearance_name)
    coordinator.run(comp_name)

class SolidCoordinator:
    def __init__(self, to_face=None, start_offset_expr="0 in", appearance_name=None):
        self.app = adsk.core.Application.get()
        self.design = adsk.fusion.Design.cast(self.app.activeProduct)
        self.root = self.design.rootComponent if self.design else None
        
        addin_root = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
        self.log = (_logger_mod.DebugLogger(addin_root) if _logger_mod else _NullLogger())
        
        self.to_face = to_face
        self.start_offset_expr = start_offset_expr
        self.appearance_name = appearance_name
        self.offset_expr = "0 in" # Flush fit

        # Initialize Specialized Engines (Sharing the unified logger)
        self.appearance_manager = AppearanceManager(self.app, self.design, self.log)
        self.extrusion_engine   = ExtrusionEngine(self.app, self.design, self.log)

    def run(self, comp_name):
        """
        The orchestrated sequence of frame synthesis.
        """
        start_time = time.time()
        try:
            self.log.session_start(f"SOLID COORDINATOR (v{FB_VERSION}): Synthesis Started")
            
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
            self.log.log(f"Discovery Phase: {time.time() - t_discovery:.2f}s")

            # 2. CAPTURE & SNAPSHOT
            # We must find the core panel's true 'Custom Paint' before the trim cut vandalizes it.
            core_body = self.to_face.body if self.to_face else None
            original_app = None
            
            if core_body:
                # 1. Start with the body appearance
                original_app = core_body.appearance
                
                # 2. ANTI-FALLBACK: If it looks like a generic default, look for the real paint.
                generic_names = ['Pine', 'Steel', 'Aluminum', 'Brass']
                needs_better = not original_app or any(g in (original_app.name or '') for g in generic_names)
                
                if needs_better:
                    try:
                        # Check sample faces first (source of most custom paints)
                        for f in core_body.faces:
                            if f.appearance and not any(g in f.appearance.name for g in generic_names):
                                self.log.log(f"  SNAPSHOT HIT (Face): Captured Custom Paint '{f.appearance.name}'")
                                original_app = f.appearance
                                break
                        
                        # Check context/occurrence if faces are still generic
                        if not original_app or any(g in original_app.name for g in generic_names):
                            occ = core_body.assemblyContext
                            if occ and occ.appearance: original_app = occ.appearance
                    except: pass

            self.log.log(f"SNAPSHOT: core='{core_body.name if core_body else 'None'}', app={original_app.name if original_app else 'None'}")

            # 3. GEOMETRY SYNTHESIS (Extrusion Engine)
            t_extrusion = time.time()
            bodies = self.extrusion_engine.extrude_profiles(
                comp, sketch, prefix, self.to_face, self.start_offset_expr, self.offset_expr
            )
            self.log.log(f"Extrusion Phase: {time.time() - t_extrusion:.2f}s")

            # 4. SURGICAL CLEANUP (Appearance Manager)
            t_finish = time.time()
            if core_body:
                self.appearance_manager.restore_core_appearance(core_body, original_app)

            # 5. FINISHING (Appearance Manager)
            if bodies:
                if self.appearance_name and self.appearance_name != "(none)":
                    self.appearance_manager.apply_appearance(bodies, self.appearance_name)
                elif original_app:
                    for b in bodies:
                        try: b.appearance = original_app
                        except: pass
            
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
        except: pass

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
                    except:
                        if not best_comp: best_comp = occ.component
            except: continue
            
        if best_comp:
            self.log.log(f"  SCAVENGE HIT: Using frame-like component '{best_comp.name}'")
            return best_comp

        # --- 3. Ultimate Fallback: Active Component ---
        # If we can't find anything named 'frame', just use wherever the user is working.
        active_comp = self.design.activeComponent
        if active_comp:
            self.log.log(f"  DISCOVERY FALLBACK: Using Active Component '{active_comp.name}'")
            return active_comp
            
        return self.root

    def _find_sketch(self, target_comp):
        """
        Deep-Search for the shape-outline sketch.
        1. Search in the target component first.
        2. Fallback: Recursive search through the entire design assembly.
        """
        target_suffix = "_2_shape-outline"
        
        # Helper to check a component
        def _check(comp):
            for i in range(comp.sketches.count):
                sk = comp.sketches.item(i)
                if target_suffix in sk.name:
                    prefix = sk.name.split("_")[0]
                    return sk, prefix
            return None, None

        # 1. Targeted check
        if target_comp:
            sk, pref = _check(target_comp)
            if sk: return sk, pref

        # 2. Deep Scavenge (Failsafe)
        self.log.log("  SKETCH: Targeted search failed. Deep-scanning assembly...")
        all_comps = self.design.allComponents
        for comp in all_comps:
            sk, pref = _check(comp)
            if sk:
                self.log.log(f"  SKETCH HIT: Found sketch '{sk.name}' in component '{comp.name}'")
                return sk, pref

        return None, "T1"

class _NullLogger:
    def log(self, *a, **kw): pass
    def log_error(self, *a, **kw): pass
    def session_start(self, *a): pass
