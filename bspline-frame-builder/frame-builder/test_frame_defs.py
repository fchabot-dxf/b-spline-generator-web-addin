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
