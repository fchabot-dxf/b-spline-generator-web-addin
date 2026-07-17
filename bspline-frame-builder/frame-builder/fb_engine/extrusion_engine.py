"""
Extrusion Engine -- Handles the geometric synthesis of the frame.

The pipeline runs in three phases (extent definitions -> classify+sort
profiles -> extrude one at a time). The original ``extrude_profiles``
inlined all three; the helpers below split them so each phase is
independently testable and the per-profile body stays readable.

Profile classification (BAR / SURROUND / VOID) lives in
``_classify_profile`` and is unchanged from the pre-split code. Trim
"SURROUND" cuts run last to ensure new bar bodies exist before the
core gets vandalized -- sort order is enforced in ``_collect_profiles``.
"""
import adsk.core, adsk.fusion, traceback


# Treat any of these spellings as "no start offset". Fusion accepts
# either unit, and stripping whitespace is enough -- a non-zero start
# offset triggers the OffsetStartDefinition path.
_ZERO_OFFSET_SPELLINGS = ("0 in", "0in", "0", "0 cm", "0cm")


class ExtrusionEngine:
    def __init__(self, app, design, logger):
        self.app = app
        self.design = design
        self.log = logger

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------
    def extrude_profiles(self, comp, sketch, prefix, to_face, start_offset_expr, end_offset_expr):
        """Extrude every closed frame-bar profile in the shape-outline
        sketch and apply the SURROUND trim cut.

        Returns the list of new BAR bodies (SURROUND produces no bodies,
        only a cut feature).
        """
        total_profiles = sketch.profiles.count
        self.log.log(
            f"EXTRUDER: component='{comp.name}' sketch='{sketch.name}' "
            f"processing {total_profiles} profiles"
        )

        if total_profiles == 0:
            return []

        extent_defs = self._build_extent_defs(to_face, start_offset_expr, end_offset_expr)
        if extent_defs is None:
            return []
        to_def, start_def = extent_defs

        to_process = self._collect_profiles(sketch)
        extrudes = comp.features.extrudeFeatures

        new_bodies = []
        for prof, ctype, i in to_process:
            new_bodies.extend(
                self._extrude_one_profile(extrudes, prof, ctype, i, prefix, to_def, start_def)
            )
        return new_bodies

    # ------------------------------------------------------------------
    # Phase 1 -- extent definitions
    # ------------------------------------------------------------------
    def _build_extent_defs(self, to_face, start_offset_expr, end_offset_expr):
        """Build the (to_def, start_def) pair shared across every
        profile in this run.

        Returns ``None`` on Fusion API failure (caller aborts the
        synthesis). ``start_def`` is ``None`` when the start offset
        evaluates to zero -- the caller skips ``ext_in.startExtent`` in
        that case so Fusion uses its default profile-plane start.
        """
        try:
            to_def = adsk.fusion.ToEntityExtentDefinition.create(
                to_face, True,
                adsk.core.ValueInput.createByString(end_offset_expr),
            )

            start_def = None
            if start_offset_expr.strip() not in _ZERO_OFFSET_SPELLINGS:
                start_def = adsk.fusion.OffsetStartDefinition.create(
                    adsk.core.ValueInput.createByString(start_offset_expr)
                )
            return to_def, start_def
        except Exception as e:
            self.log.log(f"EXTENT SETUP FAIL: {e}", "ERROR")
            return None

    # ------------------------------------------------------------------
    # Phase 2 -- classify + sort
    # ------------------------------------------------------------------
    def _collect_profiles(self, sketch):
        """Return ``[(profile, classification, index), ...]`` filtered
        of VOIDs and sorted with SURROUND last so the trim cut always
        runs after every BAR has been built.
        """
        candidates = []
        for i in range(sketch.profiles.count):
            prof = sketch.profiles.item(i)
            ctype = self._classify_profile(prof)
            if ctype != "VOID":
                candidates.append((prof, ctype, i))

        # SURROUND is the trim cut -- must run last so the bars exist
        # to receive (and survive) it.
        candidates.sort(key=lambda x: 1 if x[1] == "SURROUND" else 0)
        return candidates

    # ------------------------------------------------------------------
    # Phase 3 -- single-profile extrusion
    # ------------------------------------------------------------------
    def _extrude_one_profile(self, extrudes, prof, ctype, i, prefix, to_def, start_def):
        """Build one extrude feature (BAR or SURROUND), name it,
        clean up its faces, and return any new bodies.

        SURROUND returns an empty list -- its job is to cut, not to add
        geometry. Per-profile failures log and return empty so a single
        bad profile doesn't abort the whole synthesis.
        """
        area_str = f"{prof.area}" if hasattr(prof, "area") else "n/a"
        self.log.log(f"  PROFILE {i}: type={ctype} area={area_str}")

        try:
            op = (
                adsk.fusion.FeatureOperations.CutFeatureOperation
                if ctype == "SURROUND"
                else adsk.fusion.FeatureOperations.NewBodyFeatureOperation
            )
            ext_in = extrudes.createInput(prof, op)

            if ctype == "SURROUND":
                # Let Fusion automate the cut participants and rely on
                # AppearanceManager.restore_core_appearance to clean up
                # the wood texture afterward -- fighting SWIG/proxies for
                # explicit participant control regressed reliability.
                ext_in.isParticipantsAutomated = True
            else:
                # BAR: empty participantBodies forces a New Body (the
                # core panel is excluded as a participant).
                ext_in.isParticipantsAutomated = False
                ext_in.participantBodies = []

            # Only the BAR extrusions start at the frame offset height. The
            # SURROUND trim cut must ALWAYS start at the profile plane (z=0)
            # so it trims the full height — core panel + bars — no matter the
            # offset. Applying the offset start to the cut would leave
            # everything below the offset untrimmed.
            if start_def and ctype == "BAR":
                ext_in.startExtent = start_def

            positive_dir = adsk.fusion.ExtentDirections.PositiveExtentDirection
            zero_taper = adsk.core.ValueInput.createByString("0 deg")
            if ctype == "BAR":
                ext_in.setOneSideExtent(to_def, positive_dir, zero_taper)
            else:
                all_def = adsk.fusion.ThroughAllExtentDefinition.create()
                ext_in.setOneSideExtent(all_def, positive_dir, zero_taper)

            feat = extrudes.add(ext_in)
            self.log.log(
                f"    EXTRUDE RESULT: profile={i} type={ctype} "
                f"bodies={feat.bodies.count} faces={feat.faces.count}"
            )

            return self._finalize_feature(feat, prof, ctype, i, prefix)

        except Exception as e:
            self.log.log(f"    EXTRUDE FAIL {i}: {e}", "ERROR")
            return []

    def _finalize_feature(self, feat, prof, ctype, i, prefix):
        """Apply post-extrusion housekeeping: feature name, body name,
        and (for SURROUND) face appearance cleanup. Returns the bodies
        the caller should accumulate."""
        if ctype == "BAR":
            label = self._profile_label(prof, i)
            name_full = f"frame_{label.lower()}"
            feat.name = f"{prefix}_{name_full}_Extrude"
            bodies = []
            for b in feat.bodies:
                b.name = name_full
                bodies.append(b)
            return bodies

        # SURROUND
        feat.name = f"{prefix}_TRIM_CUT"
        # Clear the grey-steel face overrides Fusion stamps onto newly
        # cut faces so they inherit the body appearance (wood grain,
        # etc.). AppearanceManager.restore_core_appearance does the deep
        # clean later; this is the first pass.
        try:
            for face in feat.faces:
                face.appearance = None
        except Exception:
            pass
        return []

    # ------------------------------------------------------------------
    # Profile classification helpers (unchanged behavior)
    # ------------------------------------------------------------------
    def _classify_profile(self, prof):
        """
        VOID vs SURROUND vs BAR
        """
        try:
            bb = prof.boundingBox
            span_x = abs(bb.maxPoint.x - bb.minPoint.x)
            span_y = abs(bb.maxPoint.y - bb.minPoint.y)
            cx = (bb.minPoint.x + bb.maxPoint.x) / 2
            cy = (bb.minPoint.y + bb.maxPoint.y) / 2

            is_centered = (abs(cx) < 0.1 and abs(cy) < 0.1)

            diag = (
                f"      [DEBUG] bbox: ({bb.minPoint.x:.2f},{bb.minPoint.y:.2f}) "
                f"to ({bb.maxPoint.x:.2f},{bb.maxPoint.y:.2f}) "
                f"cx={cx:.2f}, cy={cy:.2f} spanX={span_x:.2f} spanY={span_y:.2f}"
            )
            self.log.log(diag)

            if is_centered:
                p_w = self.design.userParameters.itemByName("widthIn")
                p_h = self.design.userParameters.itemByName("heightIn")
                limit_w = (p_w.value * 0.9) if p_w else 15.0
                limit_h = (p_h.value * 0.9) if p_h else 20.0

                if span_x > limit_w or span_y > limit_h:
                    return "SURROUND"
                return "VOID"
            return "BAR"
        except Exception:
            return "VOID"

    def _profile_label(self, prof, fallback_idx):
        """
        TOP/BOTTOM/LEFT/RIGHT
        """
        try:
            bb = prof.boundingBox
            dx = abs(bb.maxPoint.x - bb.minPoint.x)
            dy = abs(bb.maxPoint.y - bb.minPoint.y)
            cx = (bb.minPoint.x + bb.maxPoint.x) / 2
            cy = (bb.minPoint.y + bb.maxPoint.y) / 2

            if dx > dy:
                return "TOP" if cy > 0 else "BOTTOM"
            return "RIGHT" if cx > 0 else "LEFT"
        except Exception:
            return str(fallback_idx)
