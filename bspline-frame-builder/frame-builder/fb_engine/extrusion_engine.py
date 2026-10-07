"""
Extrusion Engine -- Handles the geometric synthesis of the frame.

The pipeline runs in three phases (extent definitions -> classify+sort
profiles -> extrude one at a time). The original ``extrude_profiles``
inlined all three; the helpers below split them so each phase is
independently testable and the per-profile body stays readable.

F14 (S6): which extrude a profile gets comes from the template's DECLARED
frame features (fb_engine.declared_profiles: the profile's curve ids against
the declared regions; op, start, extent, taper and bar names from the
features). The bounding-box classifier (``_classify_profile``, unchanged)
stays ONLY for a frame that declares no template (``declared=None``). Both
paths produce the same per-profile plan; trim "SURROUND" cuts run last (the
declared feature order, bars before trim) so the bars exist before the core
gets vandalized.
"""
import adsk.core, adsk.fusion, traceback
from fb_engine.timeline_order import FRAME_MEMBER_ATTR
from fb_engine import declared_profiles


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
    def extrude_profiles(self, comp, sketch, prefix, to_face, start_offset_expr, end_offset_expr, declared=None):
        """Extrude every closed frame-bar profile in the shape-outline
        sketch and apply the SURROUND trim cut.

        ``declared``: the template's "Frame" block (regions + features), or
        None for a frame without a declared template (bounding-box path).
        Returns the list of new BAR bodies (SURROUND produces no bodies,
        only a cut feature).
        """
        # the bodies the SURROUND cuts actually modified (_finalize_feature) -- the coordinator restores each one's
        # own paint: the to_face body is not always the cut's target (measured live 2026-10-07)
        self.cut_bodies = []
        total_profiles = sketch.profiles.count
        self.log.log(
            f"EXTRUDER: component='{comp.name}' sketch='{sketch.name}' "
            f"processing {total_profiles} profiles"
        )

        if total_profiles == 0:
            return []

        if declared:
            self.log.log("EXTRUDER: profiles from the template's DECLARED features")
            to_process = self._collect_declared(sketch, declared, start_offset_expr)
        else:
            self.log.log("EXTRUDER: no declared template on this frame: bounding-box classifier")
            to_process = self._collect_profiles(sketch, start_offset_expr, end_offset_expr)
        extrudes = comp.features.extrudeFeatures

        new_bodies = []
        for prof, plan, i in to_process:
            new_bodies.extend(
                self._extrude_one_profile(extrudes, prof, plan, i, prefix, to_face, comp.name)
            )
        return new_bodies

    # ------------------------------------------------------------------
    # Phase 1 -- classify + sort into per-profile plans
    #   plan = {"kind": BAR|SURROUND, "name", "start", "extent", "taper"}
    #   (declared_profiles.extrude_plan's shape)
    # ------------------------------------------------------------------
    @staticmethod
    def _profile_curve_ids(prof):
        """The FrameBuilder.ID of every sketch curve bounding the profile."""
        ids = set()
        for loop in prof.profileLoops:
            for pc in loop.profileCurves:
                a = pc.sketchEntity.attributes.itemByName("FrameBuilder", "ID")
                if a:
                    ids.add(a.value)
        return ids

    def _collect_declared(self, sketch, frame, start_offset_expr):
        """Plans from the template's declared regions + features, in the
        declared feature order (bars, then trim)."""
        order = [f["id"] for f in frame["features"]]
        candidates = []
        for i in range(sketch.profiles.count):
            prof = sketch.profiles.item(i)
            ids = self._profile_curve_ids(prof)
            try:
                feat, name = declared_profiles.classify(ids, frame)
            except declared_profiles.DeclaredProfileError as e:
                self.log.log(f"  PROFILE {i}: NOT BUILT: {e}", "ERROR")
                continue
            if feat is None:
                self.log.log(f"  PROFILE {i}: the frame opening (inner curves only)")
                continue
            plan = declared_profiles.extrude_plan(feat, name, start_offset_expr)
            self.log.log(f"  PROFILE {i}: declared feature '{feat['id']}' {name or ''}")
            candidates.append((prof, plan, i))
        candidates.sort(key=lambda x: order.index(x[1]["order"]))
        return candidates

    def _collect_profiles(self, sketch, start_offset_expr, end_offset_expr):
        """Bounding-box path (no declared template). Return
        ``[(profile, plan, index), ...]`` filtered of VOIDs and sorted
        with SURROUND last so the trim cut always runs after every BAR
        has been built.
        """
        candidates = []
        for i in range(sketch.profiles.count):
            prof = sketch.profiles.item(i)
            ctype = self._classify_profile(prof)
            if ctype == "VOID":
                continue
            if ctype == "BAR":
                plan = {"kind": "BAR", "name": f"frame_{self._profile_label(prof, i).lower()}",
                        "start": start_offset_expr, "extent": ("toFace", end_offset_expr), "taper": "0 deg"}
            else:
                plan = {"kind": "SURROUND", "name": None, "start": "0 in",
                        "extent": ("throughAll",), "taper": "0 deg"}
            candidates.append((prof, plan, i))

        # SURROUND is the trim cut -- must run last so the bars exist
        # to receive (and survive) it.
        candidates.sort(key=lambda x: 1 if x[1]["kind"] == "SURROUND" else 0)
        return candidates

    # ------------------------------------------------------------------
    # Phase 3 -- single-profile extrusion
    # ------------------------------------------------------------------
    def _extrude_one_profile(self, extrudes, prof, plan, i, prefix, to_face, frame_comp_name=None):
        """Build one extrude feature (BAR or SURROUND) from its plan, name
        it, clean up its faces, and return any new bodies.

        SURROUND returns an empty list -- its job is to cut, not to add
        geometry. Per-profile failures log and return empty so a single
        bad profile doesn't abort the whole synthesis.
        """
        ctype = plan["kind"]
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

            # The start comes from the plan: the bars start at the frame
            # offset height; the trim cut ALWAYS starts at the profile plane
            # (declared "0 in") so it trims the full height — core panel +
            # bars — no matter the offset. A zero start keeps Fusion's
            # default profile-plane start.
            start = (plan["start"] or "0 in").strip()
            if start not in _ZERO_OFFSET_SPELLINGS:
                ext_in.startExtent = adsk.fusion.OffsetStartDefinition.create(
                    adsk.core.ValueInput.createByString(start))

            positive_dir = adsk.fusion.ExtentDirections.PositiveExtentDirection
            taper = adsk.core.ValueInput.createByString(plan["taper"])
            if plan["extent"][0] == "toFace":
                extent_def = adsk.fusion.ToEntityExtentDefinition.create(
                    to_face, True, adsk.core.ValueInput.createByString(plan["extent"][1]))
            else:
                extent_def = adsk.fusion.ThroughAllExtentDefinition.create()
            ext_in.setOneSideExtent(extent_def, positive_dir, taper)

            feat = extrudes.add(ext_in)
            self.log.log(
                f"    EXTRUDE RESULT: profile={i} type={ctype} "
                f"bodies={feat.bodies.count} faces={feat.faces.count}"
            )

            return self._finalize_feature(feat, plan, i, prefix, frame_comp_name)

        except Exception as e:
            self.log.log(f"    EXTRUDE FAIL {i}: {e}", "ERROR")
            return []

    def _finalize_feature(self, feat, plan, i, prefix, frame_comp_name=None):
        """Apply post-extrusion housekeeping: frame-membership stamp,
        feature name, body name, and (for SURROUND) face appearance
        cleanup. Returns the bodies the caller should accumulate."""
        # Declared frame membership (timeline_order.FRAME_MEMBER_ATTR) on
        # EVERY feature, BAR and SURROUND alike — FB-ORDER reads it. The
        # SURROUND cut lives in the component of the body it cuts
        # ('Clean', measured live), so ownership alone can't find it.
        if frame_comp_name:
            try:
                feat.attributes.add(FRAME_MEMBER_ATTR[0], FRAME_MEMBER_ATTR[1], frame_comp_name)
            except Exception as e:
                self.log.log(f"    FRAME TAG FAIL {i}: {e}", "WARNING")
        if plan["kind"] == "BAR":
            name_full = plan["name"]
            feat.name = f"{prefix}_{name_full}_Extrude"
            bodies = []
            for b in feat.bodies:
                b.name = name_full
                bodies.append(b)
            return bodies

        # SURROUND. The declared path's own feature id names the cut (T82 item 6: "window_cut" gets its own
        # name so it doesn't collide with the main trim in the timeline/CAM); the bounding-box path (no
        # declared "order" at all) and the "trim" feature itself both keep the original literal.
        cut_name = {"window_cut": "WINDOW_CUT"}.get(plan.get("order"), "TRIM_CUT")
        feat.name = f"{prefix}_{cut_name}"
        # Clear the grey-steel face overrides Fusion stamps onto newly
        # cut faces so they inherit the body appearance (wood grain,
        # etc.). AppearanceManager.restore_core_appearance does the deep
        # clean later; this is the first pass.
        try:
            for face in feat.faces:
                face.appearance = None
        except Exception:
            pass
        try:
            cut = list(feat.bodies)
            if not hasattr(self, 'cut_bodies'):
                self.cut_bodies = []
            self.cut_bodies.extend(cut)
            self.log.log(f"    {cut_name} cut: {[f'{b.name}@{b.parentComponent.name}' for b in cut]}")
        except Exception as e:
            self.log.log(f"    {cut_name}: cut bodies not read ({e})", "WARNING")
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
