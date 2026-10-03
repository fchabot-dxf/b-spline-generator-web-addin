"""Tests for tools/add_photo_pattern.py (F34 item 1's own pattern-collection
script). Runs entirely against a tmp_path (monkeypatched DATA_DIR/IMAGES_DIR/
PATTERNS_JSON) -- never touches the real data/photo-patterns.json."""
import importlib.util
import json
import os
import sys

import pytest
from PIL import Image

_HERE = os.path.dirname(os.path.realpath(__file__))


def _mod():
    spec = importlib.util.spec_from_file_location("add_photo_pattern", os.path.join(_HERE, "add_photo_pattern.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def mod(tmp_path, monkeypatch):
    m = _mod()
    images_dir = tmp_path / "photo-patterns"
    patterns_json = tmp_path / "photo-patterns.json"
    monkeypatch.setattr(m, "IMAGES_DIR", str(images_dir))
    monkeypatch.setattr(m, "PATTERNS_JSON", str(patterns_json))
    return m


@pytest.fixture
def a_photo(tmp_path):
    """A tiny real JPEG on disk, large enough that MAX_DIM/THUMB_DIM resizing
    is actually exercised (not a 1x1 degenerate case)."""
    path = tmp_path / "source.jpg"
    img = Image.new("RGB", (800, 400), color=(120, 60, 30))
    img.save(path, "JPEG")
    return str(path)


def test_slugify():
    m = _mod()
    assert m.slugify("Brick 1") == "brick_1"
    assert m.slugify("  Rusty   Grate!! ") == "rusty_grate"
    assert m.slugify("") == "pattern"


def test_resized_downscales_only_when_over_the_cap():
    m = _mod()
    img = Image.new("RGB", (1000, 500))
    out = m.resized(img, 500)
    assert out.size == (500, 250)  # aspect ratio preserved
    small = Image.new("RGB", (100, 50))
    assert m.resized(small, 500).size == (100, 50)  # never upscales


def test_writes_full_image_thumb_and_json_entry(mod, a_photo):
    rc = mod.main([a_photo, "Brick 1"])
    assert rc == 0

    full_path = os.path.join(mod.IMAGES_DIR, "brick_1.jpg")
    thumb_path = os.path.join(mod.IMAGES_DIR, "brick_1_thumb.jpg")
    assert os.path.isfile(full_path)
    assert os.path.isfile(thumb_path)

    with Image.open(full_path) as img:
        assert max(img.size) <= mod.MAX_DIM
    with Image.open(thumb_path) as img:
        assert max(img.size) <= mod.THUMB_DIM

    with open(mod.PATTERNS_JSON, encoding="utf-8") as f:
        patterns = json.load(f)
    assert len(patterns) == 1
    entry = patterns[0]
    assert entry["id"] == "brick_1"
    assert entry["name"] == "Brick 1"
    assert entry["image"] == "data/photo-patterns/brick_1.jpg"
    assert entry["thumb"] == "data/photo-patterns/brick_1_thumb.jpg"
    assert entry["settings"] == mod.NEUTRAL_SETTINGS


def test_settings_are_neutral_not_guessed(mod, a_photo):
    mod.main([a_photo, "Brick 1"])
    with open(mod.PATTERNS_JSON, encoding="utf-8") as f:
        settings = json.load(f)[0]["settings"]
    assert settings["crop"] is None
    assert settings["levels"] is None
    assert settings["invert"] is False
    assert settings["depth"] == 1.0 and settings["scale"] == 1.0
    assert settings["offsetX"] == 0.0 and settings["offsetY"] == 0.0
    assert settings["rotation"] == 0 and settings["repeat"] == 0


def test_rerunning_with_the_same_name_replaces_not_duplicates(mod, a_photo):
    mod.main([a_photo, "Brick 1"])
    mod.main([a_photo, "Brick 1"])
    with open(mod.PATTERNS_JSON, encoding="utf-8") as f:
        patterns = json.load(f)
    assert len(patterns) == 1


def test_adding_a_second_pattern_appends_without_disturbing_the_first(mod, a_photo, tmp_path):
    mod.main([a_photo, "Brick 1"])
    second = tmp_path / "second.jpg"
    Image.new("RGB", (300, 300), color=(10, 200, 10)).save(second, "JPEG")
    mod.main([str(second), "Pebble"])
    with open(mod.PATTERNS_JSON, encoding="utf-8") as f:
        patterns = json.load(f)
    assert [p["id"] for p in patterns] == ["brick_1", "pebble"]


def test_missing_file_fails_cleanly(mod, tmp_path):
    rc = mod.main([str(tmp_path / "nope.jpg"), "Nope"])
    assert rc == 1
    assert not os.path.exists(mod.PATTERNS_JSON)


def test_wrong_arg_count_prints_usage_and_fails(mod):
    assert mod.main(["only_one_arg"]) == 1
