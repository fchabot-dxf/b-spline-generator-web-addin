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
