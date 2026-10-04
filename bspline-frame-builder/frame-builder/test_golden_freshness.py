"""
H23 item 20: tests for tools/check_golden_freshness.py (golden-fixture staleness).

Mirrors test_frame_defs.py's own importlib idiom for a tools/*.py script with no package home.
Plain Python, no adsk.
"""
import importlib.util
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
_REPO = os.path.dirname(os.path.dirname(_HERE))
_SCRIPT_PATH = os.path.join(_REPO, "tools", "check_golden_freshness.py")


def _mod():
    spec = importlib.util.spec_from_file_location("check_golden_freshness", _SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# --------------------------------------------------------- pure comparison
@pytest.mark.parametrize("phases_ts,goldens_ts,expected", [
    (100, 200, "FRESH"),       # goldens recorded after the phases that produced them
    (200, 100, "STALE"),       # phases moved after the goldens were last recorded
    (150, 150, "FRESH"),       # recorded together (same commit) -- not stale
])
def test_freshness_status_pure_logic(phases_ts, goldens_ts, expected):
    assert _mod().freshness_status(phases_ts, goldens_ts) == expected


# ------------------------------------------------- the real H23 item 19 incident
def test_catches_the_actual_template_10_staleness_incident():
    """MEASURED (git log, H23 item 20): template_10's phases/*.py was last touched by H23 item 17
    (c008a43, committer-date 1790861907) while its goldens were still H23 item 13's (c351d6e,
    1790827938) -- stale through items 14/15/17 entirely, per item 19's own writeup. This is the
    exact incident the dispatch says the check "should have caught ... immediately". Item 19 then
    re-recorded the goldens (d7ec983, 1790874358), which clears it -- both checked here."""
    mod = _mod()
    assert mod.freshness_status(1790861907, 1790827938) == "STALE"
    assert mod.freshness_status(1790861907, 1790874358) == "FRESH"


# ------------------------------------------------------- uncommitted paths
def test_check_template_reports_uncommitted_for_paths_that_do_not_exist():
    mod = _mod()
    status, detail = mod.check_template(["/nonexistent/phases/p.py"], ["/nonexistent/golden.json"])
    assert status == "UNCOMMITTED"


# ------------------------------------------------------------ discovery
def test_discover_templates_finds_every_template_with_committed_goldens():
    mod = _mod()
    templates = mod.discover_templates()
    # H23 item 27: template_7 has no tests/fixtures/frame-parity goldens (verified by the
    # all-template shape-outline test + a live build instead) -- correctly out of this check's scope.
    assert "template_7" not in templates
    # H23 item 78b: template_10's own 3 goldens (7x9/6x9/12x6) were removed -- they recorded the OLD shape
    # (full-width dome), now replaced by Fred's narrow-head+arch reconstruction (WORK-LOG.md). Back in this
    # set once the new Fusion phases are built and fresh goldens recorded for the new shape.
    assert "template_10" not in templates
    assert {"template_1", "template_2", "template_3", "template_4", "template_5", "template_6",
            "template_8", "template_9", "template_12", "template_13"} <= set(templates)
    for tid, paths in templates.items():
        assert paths["phases"], tid
        assert paths["goldens"], tid


# --------------------------------------------------------------- live gate
def test_every_committed_golden_is_currently_fresh():
    """The CI-enforced gate H23 item 20 asks for: every template's committed golden fixtures must
    not be older (in git history) than its own phases/*.py. Mirrors test_frame_defs.py's own
    test_checked_in_file_is_fresh -- a current-state check, not a timestamp-independent one."""
    assert _mod().main(["--check"]) == 0
