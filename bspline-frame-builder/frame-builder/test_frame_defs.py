"""FB-APP S1: frame-defs.json is GENERATED from the frame builder's own
declarations. These tests keep it fresh, well-formed and honest:

  * freshness   — the checked-in file == what tools/gen_frame_defs.py renders now
  * schema      — the shape the app reads
  * declaration — every region id a template declares exists in its own blocks
                  (and a renamed id goes red)
  * drift guards — the Extrude Frame palette's woods / default offset and the
                  app's silhouette presets match the declaration

Plain Python, with no adsk.
"""
import copy
import importlib.util
import json
import os
import re
import sys

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
_REPO = os.path.dirname(os.path.dirname(_HERE))
_GEN_PATH = os.path.join(_REPO, "tools", "gen_frame_defs.py")
_PALETTE_HTML = os.path.join(_HERE, "ui", "html", "solid_builder_palette.html")
_APP_PRESETS_JS = os.path.join(os.path.dirname(_HERE), "b-spline-gen", "html", "editor",
                               "editor-shape-lattice-generator.js")

from fb_engine.frame_definition import (  # noqa: E402
    APPEARANCE_OPTIONS, DEFAULT_APPEARANCE, DEFAULT_FRAME_BOTTOM_EXPR, FRAME_BOTTOM_PARAM,
)
from fb_engine.template_resolver import get_available_templates, resolve_template  # noqa: E402


def _gen():
    spec = importlib.util.spec_from_file_location("gen_frame_defs", _GEN_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def defs():
    with open(_gen().OUT_PATH, encoding="utf-8") as f:
        return json.load(f)


# --------------------------------------------------------------- freshness
def test_checked_in_file_is_fresh():
    gen = _gen()
    with open(gen.OUT_PATH, encoding="utf-8") as f:
        on_disk = f.read().replace("\r\n", "\n")
    assert on_disk == gen.render(), "frame-defs.json is stale: run python tools/gen_frame_defs.py"


def test_checked_in_js_module_is_fresh():
    gen = _gen()
    with open(gen.OUT_JS_PATH, encoding="utf-8") as f:
        on_disk = f.read().replace("\r\n", "\n")
    assert on_disk == gen.render_js(), "frame-defs.js is stale: run python tools/gen_frame_defs.py"


# ------------------------------------------------------------------ schema
def test_top_level_schema(defs):
    assert defs["frameDefsVersion"] == 1
    assert defs["units"] == "in"
    assert defs["defaultTemplate"] is None  # Fred Q2: no frame by default
    assert defs["appearance"]["default"] == "3D Ash - Unfinished"
    assert defs["appearance"]["options"] == list(APPEARANCE_OPTIONS)
    # F7: every declared wood has a preview colour, and nothing else does
    assert sorted(defs["appearance"]["previewColors"]) == sorted(APPEARANCE_OPTIONS)
    assert len(defs["sourceHash"]) == 64


def test_frame_bottom_is_declared_as_a_z_position(defs):
    bottom = [s for s in defs["extrusion"] if s["key"] == "frameBottomZ"]
    assert len(bottom) == 1
    assert bottom[0]["param"] == "frame_height_offset"
    assert bottom[0]["default"] == -1.0 and bottom[0]["unit"] == "in"
    assert "position" in bottom[0]["meaning"]


def test_every_template_entry_is_complete(defs):
    ids = [t["value"] for t in get_available_templates()]
    assert [t["id"] for t in defs["templates"]] == ids and ids  # discovered, not hand-listed
    for t in defs["templates"]:
        for key in ("id", "name", "prefix", "silhouettePreset", "shapeModel", "params", "regions", "features", "sketches"):
            assert t.get(key), (t["id"], key)
        for p in t["params"]:
            assert {"name", "unit", "default", "owner"} <= set(p), (t["id"], p)
            assert p["owner"] in ("board", "frame")
        assert {f["id"] for f in t["features"]} == {"bars", "trim"}


# ------------------------------------------------------------- declaration
def _created_ids(spec):
    """Every id a template's blocks create or name as a target."""
    found = set()

    def walk(node):
        if isinstance(node, dict):
            for key, val in node.items():
                if key in ("ID", "TargetID") and isinstance(val, str):
                    found.add(val)
                elif key in ("TargetIDs", "LineIDs") and isinstance(val, list):
                    found.update(v for v in val if isinstance(v, str))
                walk(val)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(spec["Sketches"])
    return found


def missing_region_ids(spec):
    """Declared region ids that no block creates ('X:S' endpoint refs are
    checked by their curve id X)."""
    regions = spec["Frame"]["regions"]
    wanted = list(regions["outline"]) + list(regions["inner"]) + [regions["surround"]]
    wanted += [ref.split(":")[0] for pair in regions["miters"] for ref in pair]
    created = _created_ids(spec)
    return [w for w in wanted if w not in created]


@pytest.mark.parametrize("template_id", [t["value"] for t in get_available_templates()])
def test_every_declared_region_id_exists_in_the_blocks(template_id):
    spec, _ = resolve_template(template_id)
    assert spec.get("Frame"), f"{template_id} declares no Frame"
    assert missing_region_ids(spec) == []


def test_a_renamed_id_goes_red():
    spec, _ = resolve_template("template_1")
    broken = copy.deepcopy(spec)
    broken["Frame"]["regions"]["outline"][2] = "proj_arc_shoulder_RENAMED"
    assert missing_region_ids(broken) == ["proj_arc_shoulder_RENAMED"]


# ----------------------------------------------------------- drift guards
def test_extrude_palette_woods_match_the_declaration():
    html = open(_PALETTE_HTML, encoding="utf-8").read()
    select = re.search(r'<select id="solid-appearance".*?</select>', html, re.S).group(0)
    options = re.findall(r'<option value="([^"]+)"', select)
    assert options == list(APPEARANCE_OPTIONS)
    assert options[0] == DEFAULT_APPEARANCE  # first option = the palette's default


def test_extrude_palette_default_offset_matches_the_declaration():
    html = open(_PALETTE_HTML, encoding="utf-8").read()
    value = re.search(r'id="solid-offset" value="([^"]+)"', html).group(1)
    assert value == DEFAULT_FRAME_BOTTOM_EXPR
    assert FRAME_BOTTOM_PARAM == "frame_height_offset"


def test_every_silhouette_preset_exists_in_the_app(defs):
    js = open(_APP_PRESETS_JS, encoding="utf-8").read()
    block = js[js.index("export const PRESETS = {"):]
    block = block[:block.index("\n};")]
    app_presets = set(re.findall(r"^\s{2}(\w+):\s*\{", block, re.M))
    for t in defs["templates"]:
        assert t["silhouettePreset"] in app_presets, (t["id"], t["silhouettePreset"], app_presets)


# ------------------------------------------------------------- F9 handles
def test_every_handle_binding_is_declared_and_valid(defs):
    """The ONE binding table (template_data FRAME_HANDLES): a handle is either
    'seeded' or bound to an EXISTING frame-owned template param."""
    js = open(_APP_PRESETS_JS, encoding="utf-8").read()
    order = js[js.index("export const PARAM_ORDER = {"):]
    order = order[:order.index("\n};")]
    for t in defs["templates"]:
        keys = re.findall(r"'(\w+)'", re.search(t["silhouettePreset"] + r":\s*\[([^\]]*)\]", order).group(1))
        frame_params = {p["name"] for p in t["params"] if p["owner"] == "frame"}
        assert t["handles"], t["id"]
        assert len({h["key"] for h in t["handles"]}) == len(t["handles"])
        for h in t["handles"]:
            assert h["key"] in keys, (t["id"], h["key"], keys)
            assert h["label"] and h["basis"] in ("hw", "hh", "h"), (t["id"], h)
            b = h["binding"]
            assert b == "seeded" or (isinstance(b, dict) and b.get("param") in frame_params), (t["id"], h)




# ------------------------------------------------------ T3 tapered hourglass
def test_template_3_is_template_1_plus_a_top_width(defs):
    t = {x["id"]: x for x in defs["templates"]}
    t1, t3 = t["template_1"], t["template_3"]
    assert t3["name"] == "Template 3 - Tapered Hourglass" and t3["silhouettePreset"] == "hourglass"
    assert t3["regions"] == t1["regions"] and t3["seedMap"] == t1["seedMap"] and t3["features"] == t1["features"]
    assert t3["params"] == t1["params"]  # no new parameter
    assert t3["handles"] == t1["handles"] + [{"key": "topInset", "label": "Top width", "basis": "hw", "binding": "seeded"}]
    assert t3["handleMigrations"] == {}
    # the app never gets a null model (paramsFromShapeModel reads model.features); Template 1's has no topInset
    assert "topInset" in t3["shapeModel"]["features"] and "topInset" not in t1["shapeModel"]["features"]


# ------------------------------------------------------- T4 offset hourglass
def test_template_4_is_template_1_with_its_own_left_pinch(defs):
    t = {x["id"]: x for x in defs["templates"]}
    t1, t4 = t["template_1"], t["template_4"]
    assert t4["name"] == "Template 4 - Offset Hourglass" and t4["silhouettePreset"] == "hourglass"
    assert t4["regions"] == t1["regions"] and t4["seedMap"] == t1["seedMap"] and t4["features"] == t1["features"]
    assert t4["params"] == t1["params"]  # no new parameter
    relabel = {"waistReach": "Right waist reach", "waistCenterY": "Right waist position"}
    assert t4["handles"] == [dict(h, label=relabel.get(h["key"], h["label"])) for h in t1["handles"]] + [
        {"key": "waistCenterYLeft", "label": "Left waist position", "basis": "hh", "binding": "seeded"},
        {"key": "waistReachLeft", "label": "Left waist reach", "basis": "hw", "binding": "seeded"},
    ]
    assert t4["handleMigrations"] == {}
    f4, f1 = t4["shapeModel"]["features"], t1["shapeModel"]["features"]
    assert {"waistCyLeft", "notchLeft", "depthLeft"} <= set(f4) and not {"waistCyLeft", "notchLeft", "depthLeft"} & set(f1)
    # default: the left pinch HIGH (app y-down: a smaller waistCy), the right one low
    assert f4["waistCyLeft"]["hh"] < f1["waistCy"]["hh"] < f4["waistCy"]["hh"]


def test_template_4_pins_are_not_merged_left_to_right_and_only_the_radii_are_tied():
    """The Fusion side of 'independent pinches': no R:S = L:S pin merge (each inner end on the Y axis alone), no
    pin Equal, and the three arc radius Equals instead (sketches/template_4/phases/p02_02, p02_11)."""
    from fb_engine.template_resolver import resolve_template
    steps = [st for sk in resolve_template("template_4")[0]["Sketches"] for b in sk["Blocks"] for st in b.get("BuildSequence", [])]
    co = [tuple(st["Targets"]) for st in steps if st.get("Type") == "Coincident"]
    for lvl in ("shoulder", "waist", "hip"):
        assert (f"skel_{lvl}_pin_R:S", f"skel_{lvl}_pin_L:S") not in co
        for side in "RL":
            assert (f"skel_{lvl}_pin_{side}:S", "Y_AXIS") in co
    eq = [tuple(st["Targets"]) for st in steps if st.get("Type") == "Equal"]
    assert sorted(eq) == sorted([("arc_shoulder_R", "arc_shoulder_L"), ("arc_waist_R", "arc_waist_L"), ("arc_hip_R", "arc_hip_L")])
    # the literal seeds put the left waist pin above the right one
    pins = {st["ID"]: st for st in steps if st.get("ID", "").startswith("skel_waist_pin_")}
    y = {k: eval(v["Points"][1][1].replace(" in", ""), {"widthIn": 7, "heightIn": 9, "boundingboxoffset": 0.25})
         for k, v in pins.items()}
    assert y["skel_waist_pin_L"] > 0.5 > -0.5 > y["skel_waist_pin_R"]


# ------------------------------------------------------- T5 hourglass dipped top
_T5_TOP = ["top_edge_L", "arc_top_shoulder_L", "arc_top_dip", "arc_top_shoulder_R", "top_edge_R"]


def test_template_5_is_template_1_with_a_dipped_top(defs):
    t = {x["id"]: x for x in defs["templates"]}
    t1, t5 = t["template_1"], t["template_5"]
    assert t5["name"] == "Template 5 - Hourglass Dipped Top" and t5["silhouettePreset"] == "hourglass"
    assert t5["params"] == t1["params"] and t5["features"] == t1["features"]  # no new parameter, the same 4 bars
    assert t5["handles"] == t1["handles"] + [
        {"key": "topDipDepth", "label": "Top dip depth", "basis": "hh", "binding": "seeded"},
        {"key": "topDipWidth", "label": "Top dip width", "basis": "hw", "binding": "seeded"},
    ]
    assert t5["handleMigrations"] == {}
    # the outline: the dipped top's five pieces, then Template 1's sides and base; the TL miter on the left stub
    assert t5["regions"]["outline"] == ["proj_" + c for c in _T5_TOP] + t1["regions"]["outline"][1:]
    assert t5["regions"]["inner"] == ["inner_" + c for c in t5["regions"]["outline"]]
    assert t5["regions"]["miters"] == [["proj_top_edge_L:S", "inner_proj_top_edge_L:S"]] + t1["regions"]["miters"][1:]
    # the seed map: Template 1's without the one top edge, plus the top's five pieces (app primitives 11..15)
    # and their three seed radii
    m1 = [e for e in t1["seedMap"] if e["id"] != "top_edge"]
    assert [e for e in t5["seedMap"] if e["id"] in {x["id"] for x in m1}] == m1
    prims = {e["id"]: e["prim"] for e in t5["seedMap"] if e["kind"] in ("line", "arc")}
    assert [prims[c] for c in _T5_TOP] == [11, 12, 13, 14, 15]
    assert {e["id"]: e["prim"] for e in t5["seedMap"] if e["kind"] == "radius" and "top" in e["id"]} == {
        "seed_rad_top_shoulder_L": 12, "seed_rad_top_dip": 13, "seed_rad_top_shoulder_R": 14}
    f5, f1 = t5["shapeModel"]["features"], t1["shapeModel"]["features"]
    assert {"topDipDepth", "topDipHalfWidth"} <= set(f5) and not {"topDipDepth", "topDipHalfWidth"} & set(f1)
    assert {k: v for k, v in f5.items() if k in f1} == f1  # the sides: Template 1's model


def _t5_steps():
    from fb_engine.template_resolver import resolve_template
    spec = resolve_template("template_5")[0]
    return {sk["Name"]: [st for b in sk["Blocks"] for st in (b.get("BuildSequence", []) + b.get("Steps", []))]
            for sk in spec["Sketches"]}, spec


def test_template_5_sketch_builds_the_dipped_top_and_leaves_it_three_seeded_values():
    """The Fusion side of the dipped top (sketches/template_5/phases): the five pieces replace top_edge, chained,
    tangent, the stubs flat from their corners, the dip centred, the shoulders tied; and a DOF count of the top
    (the corners and the Y axis fixed): 23 - 20 = 3 free values (stub length, shoulder radius, dip radius), left
    to the seeds like Template 1's radii -- nothing repeats another constraint."""
    steps, _ = _t5_steps()
    sk2 = steps["2_shape_outline"]
    ids = [st["ID"] for st in sk2 if "ID" in st]
    assert "top_edge" not in ids and all(c in ids for c in _T5_TOP)
    geo = {st["ID"]: st["Type"] for st in sk2 if "ID" in st}
    top = set(_T5_TOP)
    fixed = {"proj_off_corner_TL", "proj_off_corner_TR", "Y_AXIS"}
    ent = lambda t: t.split(":")[0]
    dof = sum(4 if geo[c] == "Line" else 5 for c in _T5_TOP)
    eqs, cons = 0, []
    for st in sk2:
        if st.get("Type") not in ("Coincident", "Horizontal", "Tangent", "Equal"):
            continue
        tg = st["Targets"]
        if not all(ent(x) in top or x in fixed for x in tg):
            continue
        cons.append((st["Type"], tuple(tg)))
        if st["Type"] == "Coincident":
            eqs += 1 if any(x in ("Y_AXIS",) for x in tg) else 2
        else:
            eqs += len(tg) if st["Type"] == "Horizontal" else 1
    assert ("Coincident", ("top_edge_L:S", "proj_off_corner_TL")) in cons
    assert ("Coincident", ("top_edge_R:E", "proj_off_corner_TR")) in cons
    assert ("Horizontal", ("top_edge_L", "top_edge_R")) in cons
    assert ("Coincident", ("arc_top_dip:C", "Y_AXIS")) in cons
    assert ("Equal", ("arc_top_shoulder_L", "arc_top_shoulder_R")) in cons
    assert sum(1 for c in cons if c[0] == "Tangent") == 4
    assert dof - eqs == 3
    # the square corners: each horn starts on its stub's corner end
    co = [tuple(st["Targets"]) for st in sk2 if st.get("Type") == "Coincident"]
    assert ("horn_TL:S", "top_edge_L:S") in co and ("horn_TR:S", "top_edge_R:E") in co
    # every seed radius set on the top is deleted again (p02_09), as Template 1's
    made = {st["Name"] for st in sk2 if st.get("Type") == "Radius"}
    gone = {st["Name"] for st in sk2 if st.get("Type") == "DeleteDimension"}
    assert {"seed_rad_top_shoulder_L", "seed_rad_top_dip", "seed_rad_top_shoulder_R"} <= made and made == gone


def test_template_5_enclosure_uses_the_dipped_top():
    """p03_*: the projections, the offset loop, the inner corner resolve and the TL miter read the new top."""
    steps, spec = _t5_steps()
    sk3 = spec["Sketches"][2]
    projs = [p["TargetID"] for b in sk3["Blocks"] for p in b.get("Projections", [])]
    outline = spec["Frame"]["regions"]["outline"]
    assert projs == outline and "proj_top_edge" not in projs
    offs = [st for st in steps["3_frame_enclosure"] if st.get("Type") == "Offset"]
    assert offs[0]["SourceID"] == outline
    res = [st for st in steps["3_frame_enclosure"] if st.get("Type") == "ResolveInnerCorners"][0]
    assert res["Corners"]["TL"]["OuterID"] == "proj_top_edge_L:S" and res["Corners"]["TL"]["InnerID"] == "inner_proj_top_edge_L:S"
    miters = [(m["Source"], m["Target"]) for b in sk3["Blocks"] for m in b.get("Miters", [])]
    assert [list(m) for m in miters] == spec["Frame"]["regions"]["miters"]


# ------------------------------------------------------------- T6 tab top (N-BAR)
_T6_PIECES = ["tab_top", "tab_side_R", "shoulder_R", "side_R", "bottom_edge", "side_L", "shoulder_L", "tab_side_L"]


def test_template_6_is_an_8_bar_tab_top(defs):
    t = {x["id"]: x for x in defs["templates"]}
    t1, t6 = t["template_1"], t["template_6"]
    assert t6["name"] == "Template 6 - Tab Top" and t6["silhouettePreset"] == "tabTop"
    # no new parameter: the board, the trim offset and the frame thickness only (no ck_* gates)
    assert [p["name"] for p in t6["params"]] == ["widthIn", "heightIn", "boundingboxoffset", "frame_thickness"]
    assert [p for p in t6["params"] if p["name"] in ("frame_thickness", "boundingboxoffset")] == \
        [p for p in t1["params"] if p["name"] in ("frame_thickness", "boundingboxoffset")]
    assert t6["handles"] == [
        {"key": "tabWidth", "label": "Tab width", "basis": "hw", "binding": "seeded"},
        {"key": "tabHeight", "label": "Tab height", "basis": "hh", "binding": "seeded"},
    ]
    reg = t6["regions"]
    assert reg["outline"] == ["proj_" + c for c in _T6_PIECES]
    assert reg["inner"] == ["inner_" + c for c in reg["outline"]]
    # one corner per piece (where it starts), 2 of them inside (reflex); miters and bars follow from them
    assert [c["outer"] for c in reg["corners"]] == [c + ":S" for c in reg["outline"]]
    assert [c["id"] for c in reg["corners"] if c["reflex"]] == ["inside_R", "inside_L"]
    assert reg["miters"] == [[c["outer"], c["inner"]] for c in reg["corners"]]
    assert len(reg["miters"]) == len(reg["bars"]) == 8
    bars = [f for f in t6["features"] if f["id"] == "bars"][0]
    assert bars["bodyNames"] == [b["name"] for b in reg["bars"]] and all(n.startswith("frame_") for n in bars["bodyNames"])
    assert not set(bars["bodyNames"]) & {"frame_top", "frame_right", "frame_bottom", "frame_left"}  # the CAM N-bar path
    # the features are the common ones, only the bar names differ
    strip = lambda fs: [{k: v for k, v in f.items() if k != "bodyNames"} for f in fs]
    assert strip(t6["features"]) == strip(t1["features"])
    # the seed map: one line per piece, the app's tabTop primitive order (tab side R = 0 ... tab top = 7)
    assert {e["id"]: e["prim"] for e in t6["seedMap"]} == {c: (i - 1) % 8 for i, c in enumerate(_T6_PIECES)}
    assert all(e["kind"] == "line" and e["reverse"] is False for e in t6["seedMap"])
    assert t6["shapeModel"]["provisional"] and set(t6["shapeModel"]["features"]) == {"tabHalfWidth", "tabHeight"}
    # Templates 1-5 declare no corners / bars (the 4-bar default)
    for tid in ("template_1", "template_2", "template_3", "template_4", "template_5"):
        assert "corners" not in t[tid]["regions"] and "bars" not in t[tid]["regions"]


def _t6_steps():
    spec = resolve_template("template_6")[0]
    return {sk["Name"]: [st for b in sk["Blocks"] for st in (b.get("BuildSequence", []) + b.get("Steps", []))]
            for sk in spec["Sketches"]}, spec


def test_template_6_sketch_is_8_axis_aligned_lines_with_exactly_two_seeded_values():
    """The Fusion side (sketches/template_6/phases): 8 lines chained head to tail, the base on the two projected
    bottom corners, the tab top on the safe zone's top line, every piece H/V, two left/right Equals; a DOF count
    of the loop: 8 lines (32) - 8 welds (16) - 14 = 2 free values (the tab's half width and height), left to the
    seeds -- nothing repeats another constraint (no Horizontal on the pinned base, no Symmetry on the tab)."""
    steps, _ = _t6_steps()
    sk2 = steps["2_shape_outline"]
    lines = [st["ID"] for st in sk2 if st.get("Type") == "Line"]
    assert lines == _T6_PIECES and not any(st.get("Type") in ("Arc3Point", "Radius", "Symmetry") for st in sk2)
    co = [tuple(st["Targets"]) for st in sk2 if st.get("Type") == "Coincident"]
    for a, b in zip(_T6_PIECES, _T6_PIECES[1:] + _T6_PIECES[:1]):
        assert (f"{a}:E", f"{b}:S") in co
    assert ("bottom_edge:S", "proj_off_corner_BR") in co and ("bottom_edge:E", "proj_off_corner_BL") in co
    assert ("tab_top:S", "proj_off_BB_top") in co
    hv = {st["Type"]: st["Targets"] for st in sk2 if st.get("Type") in ("Horizontal", "Vertical")}
    assert sorted(hv["Vertical"]) == sorted(["side_R", "side_L", "tab_side_R", "tab_side_L"])
    assert sorted(hv["Horizontal"]) == sorted(["tab_top", "shoulder_R", "shoulder_L"])  # not the pinned base
    eq = [tuple(st["Targets"]) for st in sk2 if st.get("Type") == "Equal"]
    assert eq == [("side_L", "side_R"), ("shoulder_L", "shoulder_R")]
    dof = 4 * len(lines)
    eqs = 2 * len(co) - 1  # every Coincident fixes 2 values, but a point ON a line (the top line) only 1
    eqs += len(hv["Vertical"]) + len(hv["Horizontal"]) + len(eq)
    assert dof - eqs == 2


def test_template_6_enclosure_miters_every_corner_the_inside_ones_included():
    """p03_*: the 8 projections, the offset loop, the 8 inner corners (the declared corner list: same outer, inner
    and inward direction) and the 8 miters (the declared miters)."""
    steps, spec = _t6_steps()
    sk3 = spec["Sketches"][2]
    reg = spec["Frame"]["regions"]
    projs = [p["TargetID"] for b in sk3["Blocks"] for p in b.get("Projections", [])]
    assert projs == reg["outline"]
    offs = [st for st in steps["3_frame_enclosure"] if st.get("Type") == "Offset"]
    assert offs[0]["SourceID"] == reg["outline"] and offs[0]["TargetIDs"] == reg["inner"]
    res = [st for st in steps["3_frame_enclosure"] if st.get("Type") == "ResolveInnerCorners"][0]["Corners"]
    assert list(res) == [c["id"] for c in reg["corners"]]
    for c in reg["corners"]:
        assert res[c["id"]] == {"OuterID": c["outer"], "InnerID": c["inner"], "Direction": tuple(c["direction"])}
    miters = [[m["Source"], m["Target"]] for b in sk3["Blocks"] for m in b.get("Miters", [])]
    assert miters == reg["miters"]


def test_template_6_inner_corner_directions_point_into_the_band():
    """Each corner's (dx, dy) takes the outer corner t in from BOTH of its lines (Fusion y up), so the resolver
    finds the inner offset vertex -- at an inside (reflex) corner too."""
    _, spec = _t6_steps()
    hw, hh, a, h, t = 3.25, 4.25, 1.625, 2.125, 0.75
    ys = hh - h
    outer = {"tab_TL": (-a, hh), "tab_TR": (a, hh), "inside_R": (a, ys), "shoulder_R": (hw, ys),
             "BR": (hw, -hh), "BL": (-hw, -hh), "shoulder_L": (-hw, ys), "inside_L": (-a, ys)}
    inner = {"tab_TL": (-a + t, hh - t), "tab_TR": (a - t, hh - t), "inside_R": (a - t, ys - t),
             "shoulder_R": (hw - t, ys - t), "BR": (hw - t, -hh + t), "BL": (-hw + t, -hh + t),
             "shoulder_L": (-hw + t, ys - t), "inside_L": (-a + t, ys - t)}
    for c in spec["Frame"]["regions"]["corners"]:
        (ox, oy), (dx, dy) = outer[c["id"]], c["direction"]
        assert (ox + dx * t, oy + dy * t) == pytest.approx(inner[c["id"]]), c["id"]


# ------------------------------------------------------------- F12 woods
_LIBRARY_FIXTURE = os.path.join(_REPO, "tests", "fixtures", "fusion-appearance-library.json")


def test_every_declared_wood_is_a_real_fusion_appearance():
    """The declared woods are validated against Fusion's own library names
    (recorded live, F12). An unknown name is an error HERE, not a silent
    fallback to the body's material in Fusion (F11 measured that fallback)."""
    import json
    from fb_engine.frame_definition import APPEARANCE_OPTIONS, APPEARANCE_RENAMED
    lib = json.load(open(_LIBRARY_FIXTURE, encoding="utf-8"))["libraries"]["Fusion Appearance Library"]
    missing = [w for w in APPEARANCE_OPTIONS if w not in lib]
    assert missing == [], f"not in the Fusion Appearance Library: {missing}"
    # F14 (Fred: "keep only 3D grain ones")
    assert [w for w in APPEARANCE_OPTIONS if not w.startswith("3D ")] == []
    assert set(APPEARANCE_RENAMED.values()) <= set(APPEARANCE_OPTIONS)
    assert not set(APPEARANCE_RENAMED) & set(lib), "a renamed (old) name must be one Fusion does not have"


def test_the_declared_woods_are_freds_list():
    """F14 (Fred): Ash (default), Mahogany, Pine, Maple, Oak; Cherry removed."""
    from fb_engine.frame_definition import APPEARANCE_OPTIONS, DEFAULT_APPEARANCE
    assert APPEARANCE_OPTIONS == ("3D Ash - Unfinished", "3D Mahogany - Unfinished", "3D Pine - Unfinished",
                                  "3D Maple - Painted", "3D Oak - Painted")
    assert DEFAULT_APPEARANCE == "3D Ash - Unfinished"
