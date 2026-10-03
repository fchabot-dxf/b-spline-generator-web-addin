"""Fred (2026-10-03): deploys carry a date-based version, YYYY.MM.DD-N (N = that day's deploy count)."""
import importlib.util
import os
from datetime import datetime

_spec = importlib.util.spec_from_file_location(
    "deploy_script", os.path.join(os.path.dirname(os.path.abspath(__file__)), "DEPLOY_bspline-frame-builder.py"))
_deploy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_deploy)
next_version = _deploy.next_version

NOW = datetime(2026, 10, 3, 9, 30)


def test_first_deploy_ever():
    assert next_version(None, NOW) == "2026.10.03-1"


def test_first_deploy_of_the_day():
    assert next_version({"version": "2026.10.02-7"}, NOW) == "2026.10.03-1"


def test_same_day_counts_up():
    assert next_version({"version": "2026.10.03-2"}, NOW) == "2026.10.03-3"


def test_old_build_info_without_version():
    assert next_version({"sha": "abc1234"}, NOW) == "2026.10.03-1"
