"""
Solid Builder — Extrudes the frame profile sketch into solid bodies.

Finds the shape-outline sketch in the target frame component, collects
the closed profiles produced by the outer loop + inner offset + miter lines,
and extrudes each one to produce the 4 frame-bar bodies.
Optionally assigns a material appearance to every bar body.

Entry point:  build_solid_logic(style_id, comp_name, to_face,
                                offset_expr, appearance_name)
"""
import adsk.core, adsk.fusion, traceback, os, importlib

try:
    from utils import logger as _logger_mod
    importlib.reload(_logger_mod)
except Exception:
    _logger_mod = None


# ------------------------------------------------------------------
# Public entry point
# ------------------------------------------------------------------
def build_solid_logic(comp_name=None, to_face=None,
                      start_offset_expr="0 in",
                      appearance_name=None):
    """
    Called by the FrameSolidCommand execute handler.

    Parameters
    ----------
    comp_name         : str|None       — Frame_N component to target;
                                         None = auto-detect most recent
    to_face           : BRepFace|None  — Face to use as the "To Object"
                                         extrusion terminus.
    start_offset_expr : str            — Offset from the sketch plane for
                                         the start of the extrusion.
    appearance_name   : str|None       — appearance name to assign to all
                                         bar bodies; None = leave as default
    """
    builder = SolidBuilder(to_face, start_offset_expr, appearance_name)
    builder.run(comp_name)


# Preset appearances the UI dropdown will offer
# Wood names follow Fusion 360 Appearance Library conventions.
# The _find_appearance() method searches all loaded libraries by name;
# unmatched names log a warning and are skipped silently.
APPEARANCE_PRESETS = [
    "(none)",
    # ── Solid hardwoods (unstained) ──────────────────────────────────
    "Wood - Ash",
    "Wood - White Ash",
    "Wood - Birch",
    "Wood - Cherry",
    "Wood - Hickory",
    "Wood - Maple",
    "Wood - Oak",
    "Wood - Red Oak",
    "Wood - White Oak",
    "Wood - Poplar",
    "Wood - Teak",
    "Wood - Walnut",
    "Wood - Mahogany",
    "Wood - Ebony",
    # ── Painted finishes ────────────────────────────────────────────
    "Paint - Enamel Glossy (White)",
    "Paint - Enamel Glossy (Black)",
    # ── Metals ──────────────────────────────────────────────────────
    "Aluminum",
    "Brass",
]


# ------------------------------------------------------------------
# Core builder class
# ------------------------------------------------------------------
class SolidBuilder:

    def __init__(self, to_face=None,
                 start_offset_expr="0 in", appearance_name=None):
        self.app     = adsk.core.Application.get()
        self.design  = adsk.fusion.Design.cast(self.app.activeProduct)
        self.root    = self.design.rootComponent if self.design else None
        addin_root   = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
        self.log     = (_logger_mod.DebugLogger(addin_root)
                        if _logger_mod else _NullLogger())
        self.to_face           = to_face    # BRepFace — terminus for extrusion
        self.offset_expr       = "0 in"     # Hardcoded flush-fit (Simplified UI)
        self.start_offset_expr = start_offset_expr
        self.appearance_name   = appearance_name

        # Log init state so we can diagnose bad inputs before run()
        face_desc = "None"
        if to_face:
            try:
                face_desc = (f"token={to_face.entityToken[:48]}  "
                             f"area={to_face.area:.4f} cm²")
            except Exception:
                face_desc = "(face object present, token unreadable)"
        self.log.log(
            f"SolidBuilder INIT | "
            f"start_offset='{start_offset_expr}'  "
            f"end_offset='{self.offset_expr}'  "
            f"appearance='{appearance_name}'  "
            f"face={face_desc}")

    # ------------------------------------------------------------------
    def run(self, comp_name):
        try:
            self.log.session_start("SOLID BUILD: Auto-Discovery Mode")
            self.log.log(
                f"RUN PARAMS | comp_name='{comp_name}'  "
                f"offset='{self.offset_expr}'  "
                f"appearance='{self.appearance_name}'  "
                f"face={'set' if self.to_face else 'MISSING'}")

            comp = self._resolve_component(comp_name)
            if not comp:
                self.log.log("SOLID ABORT: no target component found", "ERROR")
                return
            self.log.log(f"SOLID TARGET component: '{comp.name}'")

            sketch, prefix = self._find_sketch(comp)
            if not sketch:
                self.log.log(
                    f"SOLID ABORT: No frame-outline sketch found in '{comp.name}'", "ERROR")
                return
            self.log.log(f"SOLID SKETCH found: '{sketch.name}' (Prefix inferred: {prefix})")

            bodies = self._extrude_profiles(comp, sketch, prefix)
            self.log.log(
                f"EXTRUDE COMPLETE: {len(bodies) if bodies else 0} body/bodies returned")

            if self.appearance_name and self.appearance_name != "(none)":
                if bodies:
                    self._apply_appearance(bodies)
                else:
                    self.log.log(
                        "APPEARANCE SKIP: no bodies to assign appearance to", "WARNING")
            else:
                self.log.log("APPEARANCE SKIP: appearance is '(none)' or not set")

            self.log.log("SOLID BUILD FINISHED OK")

        except Exception:
            self.log.log(f"SOLID CRASH:\n{traceback.format_exc()}", "ERROR")

    # ------------------------------------------------------------------
    # Component resolution
    # ------------------------------------------------------------------
    def _resolve_component(self, comp_name):
        """
        Return the Fusion Component for the given name, or auto-detect
        the highest-numbered Frame_N component in the root.
        """
        self.log.log(f"_resolve_component: requested='{comp_name}'  "
                     f"root_occurrences={self.root.occurrences.count}")

        if comp_name:
            # Try finding by component name directly among occurrences
            for occ in self.root.occurrences:
                if occ.component.name == comp_name:
                    self.log.log(f"COMPONENT found by name match: '{comp_name}'")
                    return occ.component
            self.log.log(f"COMPONENT name '{comp_name}' not found — falling back to auto", "WARNING")

        # 1. Official Discovery: Search via Universal Attribute Tagging
        attrs = self.design.findAttributes('FrameBuilder', 'ComponentType')
        if len(attrs) > 0:
            best_comp = None
            max_idx = -1
            for attr in attrs:
                if attr.value == 'Frame':
                    comp = adsk.fusion.Component.cast(attr.parent)
                    if not comp: continue
                    try:
                        # Parse index from stable component name (e.g. "Frame_2")
                        idx = int(comp.name.split("_")[1])
                        if idx > max_idx:
                            max_idx = idx
                            best_comp = comp
                    except: pass
            if best_comp:
                self.log.log(f"COMPONENT found via Attribute: '{best_comp.name}'")
                return best_comp

        # 2. Legacy Fallback: Find the highest Frame_N index using stable names
        best_comp = None
        max_idx   = -1
        candidates = []
        for occ in self.root.occurrences:
            # IMPORTANT: We use occ.component.name to avoid Fusion's ":1" display suffixes
            c_name = occ.component.name
            if c_name.startswith("Frame_"):
                try:
                    idx = int(c_name.split("_")[1])
                    candidates.append((idx, c_name))
                    if idx > max_idx:
                        max_idx  = idx
                        best_comp = occ.component
                except ValueError:
                    candidates.append((-1, c_name + " (unparseable)"))

        self.log.log(
            f"COMPONENT auto-scan: Frame_ candidates found = {candidates}  "
            f"best_idx={max_idx}  best_name='{best_comp.name if best_comp else None}'")

        if best_comp:
            return best_comp

        self.log.log("COMPONENT auto-detect FAILED: no Frame_N components found", "ERROR")
        return None

    # ------------------------------------------------------------------
    # Sketch resolution
    # ------------------------------------------------------------------
    def _find_sketch(self, comp):
        """
        Scan the component's sketches for any sketch named '*_2_shape-outline'.
        Returns (sketch, prefix) or (None, 'T1').
        """
        target_suffix = "_2_shape-outline"
        self.log.log(f"_find_sketch: scanning {comp.sketches.count} sketches for '{target_suffix}'")

        for i in range(comp.sketches.count):
            sk = comp.sketches.item(i)
            if sk.name.endswith(target_suffix):
                prefix = sk.name.split("_")[0]
                self.log.log(f"SKETCH MATCH: '{sk.name}' → inferred prefix '{prefix}'")
                return sk, prefix

        return None, "T1"

    # ------------------------------------------------------------------
    # Extrusion
    # ------------------------------------------------------------------
    def _extrude_profiles(self, comp, sketch, prefix):
        """
        Extrude every closed frame-bar profile in the shape-outline sketch.

        Extent strategy
        ---------------
        Uses "To Object" (ToEntityExtentDefinition) with self.to_face as the
        termination face.  self.offset_expr adds a standoff from that face
        (default "0 in").

        The miter lines split the frame ring into 4 segments; each becomes
        one frame-bar body.  The surround rectangle region is filtered out.
        """
        total_profiles = sketch.profiles.count
        self.log.log(
            f"_extrude_profiles: prefix='{prefix}'  "
            f"total profiles in sketch={total_profiles}  "
            f"to_face={'set' if self.to_face else 'MISSING'}  "
            f"start_offset='{self.start_offset_expr}'  "
            f"end_offset='{self.offset_expr}'")

        if total_profiles == 0:
            self.log.log("EXTRUDE SKIP: sketch has no closed profiles", "WARNING")
            return []

        if not self.to_face:
            self.log.log(
                "EXTRUDE ABORT: to_face is None — "
                "user must select a terminus face in the dialog", "ERROR")
            return []

        feats    = comp.features
        extrudes = feats.extrudeFeatures

        new_bodies     = []
        bodies_created = 0
        skipped        = 0

        # ── End extent: "To Object" (ToEntityExtentDefinition) ──────────
        self.log.log(
            f"EXTENT SETUP: ToEntityExtentDefinition  "
            f"face_area={self.to_face.area:.4f} cm²  "
            f"isChained=True  end_offset='{self.offset_expr}'")
        try:
            to_def = adsk.fusion.ToEntityExtentDefinition.create(
                self.to_face, True, adsk.core.ValueInput.createByString(self.offset_expr))
            self.log.log("END EXTENT SETUP OK")
        except Exception as e:
            self.log.log(
                f"END EXTENT SETUP FAIL: {e}\n{traceback.format_exc()}", "ERROR")
            return []

        # ── Start extent: OffsetStartDefinition (offset from sketch plane) ─
        start_def = None
        _start_is_zero = self.start_offset_expr.strip() in ("0 in", "0in", "0", "0 cm", "0cm")
        if not _start_is_zero:
            try:
                start_def = adsk.fusion.OffsetStartDefinition.create(
                    adsk.core.ValueInput.createByString(self.start_offset_expr))
                self.log.log(
                    f"START EXTENT SETUP OK: OffsetStartDefinition  "
                    f"start_offset='{self.start_offset_expr}'")
            except Exception as e:
                self.log.log(
                    f"START EXTENT SETUP FAIL: {e}\n{traceback.format_exc()}  "
                    f"— proceeding with default sketch-plane start", "WARNING")
                start_def = None
        else:
            self.log.log("START EXTENT: zero offset — using default sketch-plane start")

        positive_dir = adsk.fusion.ExtentDirections.PositiveExtentDirection
        zero_taper   = adsk.core.ValueInput.createByString("0 deg")

        # 1. Collect and Classify all profiles first
        profiles_to_process = []
        for i in range(total_profiles):
            prof = sketch.profiles.item(i)
            ctype = self._classify_profile(prof)
            if ctype != "VOID":
                profiles_to_process.append((prof, ctype, i))
            else:
                skipped += 1
                self.log.log(f"PROFILE {i}: SKIP — center void")

        # 2. Sort so SURROUND (Trimming Cut) happens BEFORE the Bars are created.
        # This prevents the cut from interacting with or coloring the new frame bodies.
        profiles_to_process.sort(key=lambda x: 0 if x[1] == "SURROUND" else 1)

        for prof, ctype, i in profiles_to_process:
            # Bounding box info for logging
            bb_desc = "(centroid/span log omitted)"
            try:
                bb = prof.boundingBox
                bb_desc = (f"span=({abs(bb.maxPoint.x - bb.minPoint.x):.3f}, "
                           f"{abs(bb.maxPoint.y - bb.minPoint.y):.3f})")
            except: pass

            self.log.log(f"PROCESSING PROFILE {i}: type={ctype} {bb_desc}")

            try:
                # Op: NewBody for BARS, Cut for SURROUND
                op = adsk.fusion.FeatureOperations.NewBodyFeatureOperation
                if ctype == "SURROUND":
                    op = adsk.fusion.FeatureOperations.CutFeatureOperation
                    self.log.log(f"PROFILE {i}: OPERATION — Trimming Cut")
                else:
                    self.log.log(f"PROFILE {i}: OPERATION — Solid Bar")

                ext_in = extrudes.createInput(prof, op)

                # Safety: For Cuts, specifically target the Core Body (to_face.body).
                # This prevents the cut from accidentally hitting the new frame bars.
                if ctype == "SURROUND":
                    try:
                        if self.to_face and self.to_face.body:
                            coll = adsk.core.ObjectCollection.create()
                            coll.add(self.to_face.body)
                            ext_in.participantBodies = coll
                            self.log.log("  Cut Targeted: Core body set as participant")
                    except:
                        self.log.log("  Cut Warning: Failed to set participant body — using default", "WARNING")

                # Start offset from sketch plane (if non-zero)
                if start_def:
                    ext_in.startExtent = start_def

                # ── Extent definitions ───────────────────────────────────
                # One-side "to object" extent (for Bars) OR "Deep Distance" (for Trimming Cut)
                if ctype == "BAR":
                    ext_in.setOneSideExtent(to_def, positive_dir, zero_taper)
                else:
                    # Trimming Cut: Use a "Through-All" extent to ensure it completely clears the core.
                    # Correct API class: ThroughAllExtentDefinition
                    all_def = adsk.fusion.ThroughAllExtentDefinition.create()
                    ext_in.setOneSideExtent(all_def, positive_dir, zero_taper)
                    self.log.log("  Cut: Using 'Through-All' extent (Correction)")

                feat  = extrudes.add(ext_in)
                
                # Naming & Collection (only for new bodies)
                if ctype == "BAR":
                    label = self._profile_label(prof, i)
                    feat.name = f"{prefix}_bar_{label}"
                    self.log.log(f"  BAR CREATED: '{feat.name}' with {feat.bodies.count} body(s)")
                    for b in feat.bodies:
                        new_bodies.append(b)
                        self.log.log(f"    Added to coloring list: '{b.name}' (parent={b.parentComponent.name})")
                    bodies_created += 1
                else:
                    feat.name = f"{prefix}_TRIM_CUT"
                    self.log.log(f"  TRIM COMPLETE: '{feat.name}' — affected bodies={[b.name for b in feat.bodies]}")

            except Exception as e:
                self.log.log(
                    f"PROFILE {i}: EXTRUDE FAIL — {e}\n{traceback.format_exc()}",
                    "ERROR")

        self.log.log(
            f"EXTRUDE SUMMARY: total={total_profiles}  "
            f"skipped={skipped}  bars={bodies_created}  "
            f"component='{comp.name}'")
        return new_bodies

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _classify_profile(self, prof):
        """
        Categorizes profiles based on centroid and dimensions:
        - VOID: The center hole (centered, smaller than board).
        - SURROUND: The trimming area (centered, larger than board).
        - BAR: The mitered frame segments (off-center).
        """
        try:
            bb = prof.boundingBox
            span_x = abs(bb.maxPoint.x - bb.minPoint.x)
            span_y = abs(bb.maxPoint.y - bb.minPoint.y)
            cx = (bb.minPoint.x + bb.maxPoint.x) / 2
            cy = (bb.minPoint.y + bb.maxPoint.y) / 2

            # Center checking (Tolerance: 1mm)
            is_centered = (abs(cx) < 0.1 and abs(cy) < 0.1)

            if is_centered:
                # Use widthIn/heightIn to distinguish hole vs surround
                p_w = self.design.userParameters.itemByName("widthIn")
                p_h = self.design.userParameters.itemByName("heightIn")
                
                # Threshold: 90% of board width
                limit_w = (p_w.value * 0.9) if p_w else 15.0
                limit_h = (p_h.value * 0.9) if p_h else 20.0
                
                if span_x > limit_w or span_y > limit_h:
                    return "SURROUND"
                else:
                    return "VOID"
            else:
                return "BAR"
        except Exception as e:
            self.log.log(f"  _classify_profile EXCEPTION: {e} — defaulting VOID", "WARNING")
            return "VOID"

    # ------------------------------------------------------------------
    # Appearance assignment
    # ------------------------------------------------------------------
    def _apply_appearance(self, bodies):
        """
        Assign self.appearance_name to every body in the list.
        Searches the design's local appearances first, then iterates
        through all loaded material libraries and copies the match into
        the design before assigning.
        """
        self.log.log(
            f"_apply_appearance: name='{self.appearance_name}'  "
            f"target bodies={[b.name for b in bodies]}")

        appearance = self._find_appearance(self.appearance_name)
        if not appearance:
            self.log.log(
                f"APPEARANCE MISS: '{self.appearance_name}' not found in "
                f"design or any loaded library", "WARNING")
            return

        self.log.log(
            f"APPEARANCE RESOLVED: '{appearance.name}'  "
            f"id='{appearance.id}'")

        for body in bodies:
            try:
                # Extra check: Is this body actually a frame bar?
                self.log.log(f"  ASSIGNING: '{body.name}' in comp '{body.parentComponent.name}'")
                body.appearance = appearance
                self.log.log(f"    SUCCESS: '{appearance.name}' → '{body.name}'")
            except Exception as e:
                self.log.log(
                    f"    FAIL on '{body.name}': {e}", "WARNING")

    def _find_appearance(self, name):
        """
        Return an adsk.core.Appearance by name.
        Priority:
          1. Already in design.appearances (no copy needed)
          2. Any loaded material library — copied into the design on first use
        """
        self.log.log(
            f"_find_appearance: searching for '{name}'  "
            f"design_local_count={self.design.appearances.count}  "
            f"libraries={self.app.materialLibraries.count}")

        # 1. Design-local (already used / previously copied)
        local = self.design.appearances.itemByName(name)
        if local:
            self.log.log(f"APPEARANCE FOUND local: '{local.name}'")
            return local
        self.log.log(f"APPEARANCE not in design-local, searching libraries...")

        # 2. Walk every library Fusion has loaded
        for lib in self.app.materialLibraries:
            try:
                lib_app = lib.appearances.itemByName(name)
            except:
                lib_app = None
                
            self.log.log(
                f"  library '{lib.name}': "
                f"appearances={lib.appearances.count}  "
                f"match={'YES' if lib_app else 'no'}")
            if lib_app:
                try:
                    copied = self.design.appearances.addByCopy(lib_app, name)
                    self.log.log(
                        f"APPEARANCE COPIED: '{name}' from library '{lib.name}'")
                    return copied
                except Exception as e:
                    self.log.log(
                        f"APPEARANCE COPY FAIL from '{lib.name}': {e}\n"
                        f"{traceback.format_exc()}", "WARNING")

        self.log.log(
            f"APPEARANCE NOT FOUND anywhere: '{name}' — "
            f"check spelling against Fusion Appearance Library browser", "WARNING")
        return None

    @staticmethod
    def _profile_label(prof, fallback_idx):
        """
        Return a human-readable quadrant label (TL/TR/BL/BR) based on
        the centroid of the profile bounding box, or index if unclear.
        """
        try:
            bb = prof.boundingBox
            cx = (bb.minPoint.x + bb.maxPoint.x) / 2
            cy = (bb.minPoint.y + bb.maxPoint.y) / 2
            v  = "T" if cy >= 0 else "B"
            h  = "R" if cx >= 0 else "L"
            return f"{v}{h}"
        except Exception:
            return str(fallback_idx)


# ------------------------------------------------------------------
# Null logger fallback (if utils.logger unavailable)
# ------------------------------------------------------------------
class _NullLogger:
    def log(self, *a, **kw):       pass
    def log_error(self, *a, **kw): pass
    def session_start(self, *a):   pass
