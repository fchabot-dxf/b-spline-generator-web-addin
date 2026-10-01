"""
FB-APP S5 (F10): [Send frame] (fb_engine/send_frame.py) on a fake Fusion
world: a timeline (the SAME FakeItem/FakeTimeline shapes test_timeline_order
drives the real FB-ORDER with), components, occurrences and attributes that
delete with their owners. The REAL ensure_frame_before_inlay runs; only the
two builds are stand-ins that add what the live builds were MEASURED to add
(F2/F3: the Frame_N occurrence + 3 sketches; 4 bar extrudes in Frame_N + the
TRIM_CUT in Clean, tagged FrameComponent).

Run with:
    cd bspline-frame-builder/frame-builder
    python -m pytest fb_engine/test_send_frame.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.realpath(__file__))))

from fb_engine.test_timeline_order import FakeItem, FakeTimeline  # noqa: E402  (shared fakes)
from fb_engine.timeline_order import ensure_frame_before_inlay, FRAME_MEMBER_ATTR  # noqa: E402
from fb_engine.template_resolver import resolve_template  # noqa: E402
from fb_engine import send_frame as sf  # noqa: E402


# ------------------------------------------------------------------ fake world
class Attrs:
    def __init__(self, world, owner):
        self._w, self._o = world, owner

    def add(self, group, name, value):
        self._w.attributes.append(Attr(group, name, value, self._o))

    def itemByName(self, group, name):
        for a in self._w.attributes:
            if a.parent is self._o and (a.groupName, a.name) == (group, name):
                return a
        return None


class Attr:
    def __init__(self, group, name, value, parent):
        self.groupName, self.name, self.value, self.parent = group, name, value, parent


class Comp:
    def __init__(self, world, name):
        self.name = name
        self.attributes = Attrs(world, self)


class Entity:
    """A timeline item's entity: `.component` (an occurrence creation) or
    `.parentComponent` (built inside a component), plus attributes."""

    def __init__(self, world, name, parent, creates=None):
        self._w, self.name = world, name
        self.parentComponent = parent
        if creates is not None:
            self.component = creates
        self.attributes = Attrs(world, self)

    def deleteMe(self):
        self._w.delete_entity(self)


class FakeUserParam:
    def __init__(self, world, name, expr):
        self._w, self.name, self.expression = world, name, expr
        self.attributes = Attrs(world, self)
        self.dependents = 0

    @property
    def dependentParameters(self):
        return type("Coll", (), {"count": self.dependents})()

    def deleteMe(self):
        del self._w.user_params[self.name]


class FakeUserParams:
    """design.userParameters (F22: only panel_lip goes through it; the template params stay in World.params)."""

    def __init__(self, world):
        self._w = world

    def itemByName(self, name):
        return self._w.user_params.get(name)

    def add(self, name, value_input, unit, comment):
        p = FakeUserParam(self._w, name, value_input)
        self._w.user_params[name] = p
        return p


class World:
    def __init__(self):
        self.user_params = {}
        self.userParameters = FakeUserParams(self)
        self.attributes = []
        self.timeline = FakeTimeline([])
        self.root = Comp(self, "(Root)")
        self.clean = Comp(self, "Clean")
        self.components = []
        self.rootComponent = self  # allOccurrencesByComponent lives on the root component
        self.params = {}

    # design API ---------------------------------------------------------
    def findAttributes(self, group, name):
        return [a for a in self.attributes if (a.groupName, a.name) == (group, name)]

    def allOccurrencesByComponent(self, comp):
        return [it.entity for it in self.timeline.items if getattr(it.entity, "component", None) is comp]

    # world building -----------------------------------------------------
    def add_item(self, name, parent, creates=None):
        e = Entity(self, name, parent, creates)
        it = FakeItem(name, self.timeline)
        it.entity = e
        self.timeline.items.append(it)
        return e

    def delete_entity(self, e):
        comp = getattr(e, "component", None)
        doomed = {e}
        if comp is not None:  # deleting an occurrence deletes everything built inside its component
            doomed |= {it.entity for it in self.timeline.items if it.entity.parentComponent is comp}
            self.components.remove(comp)
            self.attributes = [a for a in self.attributes if a.parent is not comp]
        self.timeline.items = [it for it in self.timeline.items if it.entity not in doomed]
        self.attributes = [a for a in self.attributes if a.parent not in doomed]

    def names(self):
        return self.timeline.names()

    def frame_names(self):
        return [c.name for c in self.components]


def send_bspline(w, layer="L1"):
    """What Send B-spline adds (MEASURED F2): the body block, then the inlay."""
    if not any(n.startswith(" B-Spline Set") for n in w.names()):
        w.add_item(" B-Spline Set:1", w.root)
        w.add_item(" Clean:1", w.root)
        w.add_item("Base Feature1", w.clean)
    w.add_item(f"Plane for {layer} - vbit", w.root)
    w.add_item(f"Source - {layer} - vbit", w.root)


class Vec:
    def __init__(self, z):
        self.z = z


class Vertex:
    def __init__(self, z):
        self.geometry = Vec(z)  # a stand-in "point", tagged with its own intended normal z


class Face:
    def __init__(self, nz, vertex_nz=None):
        """`vertex_nz` defaults to 4 copies of `nz` (a uniform/planar face, matching
        every pre-H23-item-22 test exactly: average of N identical values is that
        value). Pass a differing list to model a non-planar face whose pointOnFace
        sample disagrees with its own corners (H23 item 22's measured case)."""
        self.pointOnFace = Vec(nz)
        self.vertices = [Vertex(z) for z in (vertex_nz if vertex_nz is not None else [nz, nz, nz, nz])]

        def get_normal(_self, point):
            return True, Vec(point.z)
        self.evaluator = type("Ev", (), {"getNormalAtPoint": get_normal})()


class Body:
    def __init__(self, normals=(1.0, -0.3, -0.998, 0.2), faces=None):
        self.faces = faces if faces is not None else [Face(z) for z in normals]


class Log:
    def __init__(self):
        self.lines = []

    def log(self, msg, level="INFO"):
        self.lines.append((level, msg))

    def log_error(self, msg):
        self.lines.append(("ERROR", msg))


class Builds:
    """Stand-ins for the two live builds (what F2/F3 measured them to add)."""

    def __init__(self, w):
        self.w, self.sketch_calls, self.solid_calls = w, [], []

    def sketch(self, style_id, external_logger, data):
        self.sketch_calls.append({"style_id": style_id, "data": data})
        w = self.w
        n = 1
        while f"Frame_{n}" in w.frame_names():
            n += 1
        comp = Comp(w, f"Frame_{n}")
        w.components.append(comp)
        comp.attributes.add("FrameBuilder", "ComponentType", "Frame")
        w.add_item(f" Frame_{n}:1", w.root, creates=comp)
        for s in ("T1_1_bounding_box", "T1_2_shape_outline", "T1_3_frame_enclosure"):
            w.add_item(s, comp)
        for k, v in data["ui_data"].items():  # the build turns every ui_data key into a user param
            w.params[k] = v
        ensure_frame_before_inlay(w, comp.name, external_logger)
        return {"ok": True}

    def solid(self, to_face, start_offset_expr, appearance_name, external_logger):
        self.solid_calls.append({"to_face": to_face, "start": start_offset_expr, "wood": appearance_name})
        w = self.w
        comp = w.components[-1]
        for s in ("right", "bottom", "top", "left"):
            w.add_item(f"t1_frame_{s}_Extrude", comp).attributes.add(*FRAME_MEMBER_ATTR, comp.name)
        w.add_item("t1_TRIM_CUT", w.clean).attributes.add(*FRAME_MEMBER_ATTR, comp.name)
        w.params["frame_height_offset"] = start_offset_expr
        ensure_frame_before_inlay(w, comp.name, external_logger)


def payload(**kw):
    p = {"templateId": "template_1", "params": {"frame_thickness": 0.75, "boundingboxoffset": 0.5, "ck_arc_shoulder_weld": 1},
         "seeds": {}, "frameBottomZ": -1.5, "appearance": "3D Oak - Painted"}
    p.update(kw)
    return p


def run(w, pl, body="default"):
    b = Builds(w)
    b_obj = Body() if body == "default" else body
    r = sf.send_frame(w, pl, lambda: b_obj, Log(), resolve_template=resolve_template,
                      build_sketch=b.sketch, build_solid=b.solid, value_input=lambda e: e)
    return r, b


FRAME_BLOCK = [" Frame_1:1", "T1_1_bounding_box", "T1_2_shape_outline", "T1_3_frame_enclosure",
               "t1_frame_right_Extrude", "t1_frame_bottom_Extrude", "t1_frame_top_Extrude", "t1_frame_left_Extrude",
               "t1_TRIM_CUT"]
BODY = [" B-Spline Set:1", " Clean:1", "Base Feature1"]


# ------------------------------------------------------------------ tests
class TestSendFrame:
    def test_bspline_then_frame_gives_body_frame_block_inlay(self):
        w = World()
        send_bspline(w)
        r, b = run(w, payload())
        assert r["ok"] and r["error"] is None and r["frame"] == "Frame_1" and r["deleted"] == []
        assert w.names() == BODY + FRAME_BLOCK + ["Plane for L1 - vbit", "Source - L1 - vbit"]

    def test_a_resend_leaves_exactly_one_Frame_1_and_one_trim_cut(self):
        w = World()
        send_bspline(w)
        run(w, payload())
        r, _ = run(w, payload(params={"frame_thickness": 0.5}))
        assert r["ok"] and r["deleted"] == ["Frame_1"] and r["frame"] == "Frame_1"
        assert w.frame_names() == ["Frame_1"]
        assert w.names().count("t1_TRIM_CUT") == 1  # the old one (in Clean) went with its frame
        assert w.names() == BODY + FRAME_BLOCK + ["Plane for L1 - vbit", "Source - L1 - vbit"]

    def test_the_other_order_a_later_inlay_then_a_resend_still_lands_before_every_inlay(self):
        w = World()
        send_bspline(w)
        run(w, payload())
        send_bspline(w, layer="L2")  # Send B-spline again (append): a new inlay after the frame
        r, _ = run(w, payload())
        assert r["ok"] and w.frame_names() == ["Frame_1"]
        assert w.names() == BODY + FRAME_BLOCK + ["Plane for L1 - vbit", "Source - L1 - vbit",
                                                 "Plane for L2 - vbit", "Source - L2 - vbit"]

    def test_no_bspline_body_is_a_clear_error_and_nothing_is_touched(self):
        w = World()
        r, b = run(w, payload(), body=None)
        assert not r["ok"] and "Send B-spline first" in r["error"]
        assert (b.sketch_calls, b.solid_calls, w.names(), w.params) == ([], [], [], {})

    def test_no_frame_chosen_and_an_unknown_template_are_clear_errors(self):
        for pl, text in ((payload(templateId=None), "No frame chosen"), (payload(templateId="nope"), "Unknown frame template")):
            w = World()
            send_bspline(w)
            r, b = run(w, pl)
            assert not r["ok"] and text in r["error"] and b.sketch_calls == []

    def test_a_body_with_no_downward_face_is_a_clear_error(self):
        w = World()
        send_bspline(w)
        r, b = run(w, payload(), body=Body(normals=(1.0, -0.2)))
        assert not r["ok"] and "downward face" in r["error"] and b.sketch_calls == []

    def test_the_build_gets_the_frame_params_and_no_new_user_params(self):
        w = World()
        send_bspline(w)
        pl = payload(params={"frame_thickness": 0.625, "boundingboxoffset": 0.5, "waistReach": 0.3, "bogus": 1},
                     seeds={"waistReach": 0.4, "cornerRadiusTop": 0.2})
        r, b = run(w, pl)
        template, _ = resolve_template("template_1")
        declared = sf.declared_param_names(template)
        ui = b.sketch_calls[0]["data"]["ui_data"]
        assert ui == {"frame_thickness": "0.625", "boundingboxoffset": "0.5"}
        assert set(w.params) - {"frame_height_offset"} <= declared  # every param the build made is a declared one
        assert "waistReach" not in w.params and "cornerRadiusTop" not in w.params  # seeds never become params
        assert b.sketch_calls[0]["style_id"] == "template_1"

    def test_the_solid_goes_to_the_underside_at_the_frame_bottom_in_the_chosen_wood(self):
        w = World()
        send_bspline(w)
        body = Body()
        r, b = run(w, payload(), body=body)
        call = b.solid_calls[0]
        assert call["to_face"] is body.faces[2]  # n.z = -0.998, the downward face
        assert (call["start"], call["wood"]) == ("-1.5 in", "3D Oak - Painted")

    def test_a_sculpted_underside_with_one_tilted_sample_point_is_still_found(self):
        # H23 item 22, MEASURED live: the real 6x9 Template 10 send failed with
        # "no downward face" even though the panel's true underside was there --
        # its pointOnFace sample (-0.8963) narrowly missed UNDERSIDE_MAX_NORMAL_Z
        # (-0.9) while its own 4 corners (-0.9949..-0.9955) were solidly downward.
        # Values below are the exact ones measured on that body.
        w = World()
        send_bspline(w)
        top = Face(0.9189, vertex_nz=[0.9055, 0.9055, 0.9839, 0.9839])
        tilted_underside = Face(-0.8963, vertex_nz=[-0.9949, -0.9955, -0.9955, -0.9949])
        edge = Face(-0.6862, vertex_nz=[-0.6793, -0.4762, -0.3855, -0.6248])  # genuinely not the underside
        r, b = run(w, payload(), body=Body(faces=[top, tilted_underside, edge]))
        assert r["ok"] and r["error"] is None
        assert b.solid_calls[0]["to_face"] is tilted_underside

    def test_seeds_are_reported_not_applied_never_dropped_silently(self):
        w = World()
        send_bspline(w)
        r, _ = run(w, payload(seeds={"waistReach": 0.4}))
        assert r["ok"] and r["seeds"] == {"count": 1, "applied": False, "reason": sf.SEEDS_NOT_APPLIED}
        r, _ = run(w, payload(seeds={}))
        assert r["seeds"] == {"count": 0, "applied": False, "reason": None}


class TestTheTargetFaceIsResolvedWhenUsed:
    def test_the_solid_gets_a_face_resolved_after_the_sketch_build(self):
        # MEASURED live (F11): a face taken up front went invalid by the solid build.
        w = World()
        send_bspline(w)
        bodies = [Body(), Body()]  # the body object as found before, and as found after the sketch build
        calls = []

        def find():
            calls.append(len(calls))
            return bodies[min(len(calls) - 1, 1)]
        b = Builds(w)
        r = sf.send_frame(w, payload(), find, Log(), resolve_template=resolve_template,
                          build_sketch=b.sketch, build_solid=b.solid)
        assert r["ok"] and len(calls) == 2
        assert b.solid_calls[0]["to_face"] is bodies[1].faces[2]  # the fresh one, not the early one


# ------------------------------------------------------------------ F11 option B: seed geometry
from fb_engine.seed_geometry import apply_seed_geometry, SeedGeometryError  # noqa: E402


def _steps(template):
    out = {}
    for sk in template["Sketches"]:
        for b in sk.get("Blocks", []):
            for st in b.get("BuildSequence", []) or []:
                if st.get("Type") in ("Line", "Arc3Point"):
                    out[st["ID"]] = st
                elif st.get("Type") == "Radius":  # (p02_09's DeleteDimension reuses the same Name)
                    out[st["Name"]] = st
    return out


class TestSeedGeometry:
    def test_moves_only_the_named_seeds_as_plain_values(self):
        template, _ = resolve_template("template_1")
        before = _steps(template)
        out = apply_seed_geometry(template, {
            "arc_waist_R": {"points": [[2.8, -0.6], [2.4, 0.0], [2.8, 0.6]]},
            "seed_rad_waist_R": {"radius": 0.7},
        })
        after = _steps(out)
        assert after["arc_waist_R"]["Points"] == [["2.8 in", "-0.6 in"], ["2.4 in", "0.0 in"], ["2.8 in", "0.6 in"]]
        assert after["seed_rad_waist_R"]["Expression"] == "0.7 in"
        assert after["arc_hip_R"] == before["arc_hip_R"]          # untouched
        assert _steps(template)["arc_waist_R"] == before["arc_waist_R"]  # the resolved template is not mutated

    def test_an_unknown_seed_or_a_wrong_point_count_is_refused(self):
        template, _ = resolve_template("template_1")
        for bad in ({"nope": {"points": [[0, 0], [1, 1]]}}, {"arc_waist_R": {"points": [[0, 0], [1, 1]]}},
                    {"seed_rad_waist_R": {"points": [[0, 0]]}}):
            try:
                apply_seed_geometry(template, bad)
                assert False, bad
            except SeedGeometryError:
                pass

    def test_send_frame_passes_the_seed_geometry_to_the_build_never_as_params(self):
        w = World()
        send_bspline(w)
        geo = {"arc_waist_R": {"points": [[2.8, -0.6], [2.4, 0.0], [2.8, 0.6]]}}
        r, b = run(w, payload(seeds={"waistReach": 0.5}, seedGeometry=geo))
        assert r["ok"] and r["seeds"] == {"count": 1, "applied": True, "reason": None}
        assert b.sketch_calls[0]["data"]["seed_geometry"] == geo
        assert "waistReach" not in w.params and "arc_waist_R" not in w.params

    def test_a_bad_seed_geometry_is_refused_before_anything_is_deleted(self):
        w = World()
        send_bspline(w)
        run(w, payload())
        r, b = run(w, payload(seeds={"waistReach": 0.5}, seedGeometry={"nope": {"points": [[0, 0], [1, 1]]}}))
        assert not r["ok"] and "could not be seeded" in r["error"]
        assert b.sketch_calls == [] and w.frame_names() == ["Frame_1"]  # the previous frame is still there


    def test_an_unknown_wood_is_refused_not_silently_replaced(self):
        w = World()
        send_bspline(w)
        r, b = run(w, payload(appearance="3D Cherry - Unfinished"))
        assert not r["ok"] and "Unknown wood" in r["error"] and b.sketch_calls == []
        r, b = run(w, payload(appearance="Cherry"))  # F14: retired (the app migrates it before sending)
        assert not r["ok"] and "Unknown wood" in r["error"] and b.sketch_calls == []


class TestPanelLip:
    """F22: the panel lip. panel_lip is the ONE frame-owned user parameter (Fred: "if needed add a param in fusion")."""

    def test_lip_creates_the_tagged_param_and_the_build_gets_the_lip(self):
        w = World()
        send_bspline(w)
        r, b = run(w, payload(panelLip=0.0625))
        assert r["ok"] and r["panelLip"] == {"in": 0.0625, "param": "created"}
        p = w.user_params["panel_lip"]
        assert p.expression == "0.0625 in" and p.attributes.itemByName("FrameBuilder", "owner").value == "1"
        assert b.sketch_calls[0]["data"]["panel_lip"] == 0.0625
        assert "panel_lip" not in b.sketch_calls[0]["data"]["ui_data"]  # never through the template-param path
        r, b = run(w, payload(panelLip=0.125))                            # re-send: updated, still one param
        assert r["panelLip"]["param"] == "updated" and w.user_params["panel_lip"].expression == "0.125 in"

    def test_lip_0_is_today_and_removes_an_unreferenced_param(self):
        w = World()
        send_bspline(w)
        r, b = run(w, payload())
        assert r["panelLip"] == {"in": 0.0, "param": "none"} and "panel_lip" not in b.sketch_calls[0]["data"]
        run(w, payload(panelLip=0.0625))
        r, _ = run(w, payload(panelLip=0))
        assert r["panelLip"]["param"] == "removed" and "panel_lip" not in w.user_params

    def test_lip_0_keeps_a_param_something_still_references(self):
        w = World()
        send_bspline(w)
        run(w, payload(panelLip=0.0625))
        w.user_params["panel_lip"].dependents = 1  # e.g. Fred used it in his own expression
        r, _ = run(w, payload(panelLip=0))
        assert r["panelLip"]["param"] == "kept" and "panel_lip" in w.user_params

    def test_a_bad_lip_is_0(self):
        assert sf.panel_lip_of({"panelLip": "x"}) == 0.0 and sf.panel_lip_of({"panelLip": -1}) == 0.0
        assert sf.panel_lip_of({}) == 0.0 and sf.panel_lip_of({"panelLip": 0.25}) == 0.25
