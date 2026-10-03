"""F31 item 2c: fb_engine.joined_miters's own apply_joined_miters(), tested against the real
resolved templates (T14/T15/T16/T17), pure Python, no Fusion -- mirrors test_panel_lip.py's own
"resolve the real template, mutate it, check the mutation" pattern (if that file exists; otherwise
the same discipline every other apply_X() mutator in this package already uses)."""
import pytest

from fb_engine.declared_profiles import bar_index, classify
from fb_engine.joined_miters import apply_joined_miters, joinable_by_id
from fb_engine.template_resolver import resolve_template

TEMPLATES = ['template_14', 'template_15', 'template_16', 'template_17']


def _tpl(template_id):
    return resolve_template(template_id)[0]


@pytest.mark.parametrize("template_id", TEMPLATES)
class TestDeclaration:
    def test_declares_exactly_two_joinable_joints_each_other_s_mirror(self, template_id):
        j = joinable_by_id(_tpl(template_id))
        assert len(j) == 2
        ids = set(j)
        for jid, entry in j.items():
            assert entry["mirror"] in ids and entry["mirror"] != jid
            assert j[entry["mirror"]]["mirror"] == jid  # mirrors each other, not one-way
            assert len(entry["bars"]) == 2 and entry["bars"][0] != entry["bars"][1]

    def test_every_declared_bar_name_is_real(self, template_id):
        tpl = _tpl(template_id)
        real_names = {b["name"] for b in tpl["Frame"]["regions"]["bars"]}
        for entry in joinable_by_id(tpl).values():
            for name in entry["bars"]:
                assert name in real_names, f"{template_id} {entry['id']}: {name} not a real bar"

    def test_every_miterSource_is_a_real_declared_miter(self, template_id):
        tpl = _tpl(template_id)
        sources = {m["Source"] for sk in tpl["Sketches"] for block in sk.get("Blocks", [])
                   for m in (block.get("Miters") or [])}
        for entry in joinable_by_id(tpl).values():
            assert entry["miterSource"] in sources, f"{template_id} {entry['id']}: {entry['miterSource']} not found"


@pytest.mark.parametrize("template_id", TEMPLATES)
class TestApply:
    def test_empty_or_absent_joined_set_returns_the_template_unchanged(self, template_id):
        tpl = _tpl(template_id)
        assert apply_joined_miters(tpl, []) is tpl  # identity, not just equal -- no needless copy
        assert apply_joined_miters(tpl, None) is tpl
        assert apply_joined_miters(tpl, ["not-a-real-id"]) is tpl  # a stale/unknown id is inert

    def test_joining_one_side_merges_exactly_that_pair_and_leaves_the_other_untouched(self, template_id):
        tpl = _tpl(template_id)
        joinable = joinable_by_id(tpl)
        jid = next(iter(joinable))
        entry = joinable[jid]
        before_bars = [b["name"] for b in tpl["Frame"]["regions"]["bars"]]
        merged = apply_joined_miters(tpl, [jid])

        bars_after = [b["name"] for b in merged["Frame"]["regions"]["bars"]]
        assert len(bars_after) == len(before_bars) - 1
        assert entry["bars"][1] not in bars_after
        assert entry["bars"][0] in bars_after
        kept = next(b for b in merged["Frame"]["regions"]["bars"] if b["name"] == entry["bars"][0])
        orig_a = next(b for b in tpl["Frame"]["regions"]["bars"] if b["name"] == entry["bars"][0])
        orig_b = next(b for b in tpl["Frame"]["regions"]["bars"] if b["name"] == entry["bars"][1])
        assert kept["curves"] == orig_a["curves"] + orig_b["curves"]

        # the ONE declared miter named for this joint is now construction; every other miter is not.
        flipped = [m for sk in merged["Sketches"] for block in sk.get("Blocks", [])
                   for m in (block.get("Miters") or []) if m["Source"] == entry["miterSource"]]
        assert len(flipped) == 1 and flipped[0]["IsConstruction"] is True
        untouched = [m for sk in merged["Sketches"] for block in sk.get("Blocks", [])
                     for m in (block.get("Miters") or []) if m["Source"] != entry["miterSource"]]
        assert all(m["IsConstruction"] is False for m in untouched)

        # the mirror side's own two bars are still separate.
        mirror = joinable[entry["mirror"]]
        assert mirror["bars"][0] in bars_after and mirror["bars"][1] in bars_after

        # the "bars" feature's own bodyNames match the new, shorter bar list exactly.
        feat = next(f for f in merged["Frame"]["features"] if f.get("id") == "bars")
        assert feat["bodyNames"] == bars_after

    def test_joining_both_sides_merges_both_pairs(self, template_id):
        tpl = _tpl(template_id)
        ids = list(joinable_by_id(tpl))
        merged = apply_joined_miters(tpl, ids)
        bars_after = [b["name"] for b in merged["Frame"]["regions"]["bars"]]
        assert len(bars_after) == len(tpl["Frame"]["regions"]["bars"]) - 2
        feat = next(f for f in merged["Frame"]["features"] if f.get("id") == "bars")
        assert feat["bodyNames"] == bars_after

    def test_the_original_template_is_never_mutated(self, template_id):
        tpl = _tpl(template_id)
        before_bars = [dict(b) for b in tpl["Frame"]["regions"]["bars"]]
        before_miters = [dict(m) for sk in tpl["Sketches"] for block in sk.get("Blocks", [])
                         for m in (block.get("Miters") or [])]
        apply_joined_miters(tpl, list(joinable_by_id(tpl)))
        assert tpl["Frame"]["regions"]["bars"] == before_bars
        after_miters = [dict(m) for sk in tpl["Sketches"] for block in sk.get("Blocks", [])
                        for m in (block.get("Miters") or [])]
        assert after_miters == before_miters

    def test_declared_profiles_classify_resolves_the_merged_curves_to_one_bar(self, template_id):
        tpl = _tpl(template_id)
        jid, entry = next(iter(joinable_by_id(tpl).items()))
        merged = apply_joined_miters(tpl, [jid])
        regions = merged["Frame"]["regions"]
        curve_a, curve_b = (entry["bars"][0], entry["bars"][1])
        bar_a = next(b for b in tpl["Frame"]["regions"]["bars"] if b["name"] == curve_a)
        bar_b = next(b for b in tpl["Frame"]["regions"]["bars"] if b["name"] == curve_b)
        idx_a = bar_index(bar_a["curves"][0], regions)
        idx_b = bar_index(bar_b["curves"][0], regions)
        assert idx_a == idx_b, "the two joined bars' own curves must resolve to the SAME bar index"
        feat, body = classify(set(bar_a["curves"] + bar_b["curves"]), merged["Frame"])
        assert body == entry["bars"][0]

    def test_mirror_sides_are_independent__joining_one_never_touches_the_other(self, template_id):
        tpl = _tpl(template_id)
        joinable = joinable_by_id(tpl)
        jid = next(iter(joinable))
        mirror_id = joinable[jid]["mirror"]
        merged = apply_joined_miters(tpl, [jid])
        mirror_entry = joinable[mirror_id]
        mirror_miter = [m for sk in merged["Sketches"] for block in sk.get("Blocks", [])
                        for m in (block.get("Miters") or []) if m["Source"] == mirror_entry["miterSource"]]
        assert len(mirror_miter) == 1 and mirror_miter[0]["IsConstruction"] is False
