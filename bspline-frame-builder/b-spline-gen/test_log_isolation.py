"""The test suite must never write the live add-in log (conftest.py + b-spline-gen.py LOG_FILE_ENV).

Before: test_import_failed_no_modal.py's fake-adsk _handle_generate calls appended
`_handle_generate: isPreview=False, payload keys=['stepVariants', 'frame', 'isPreview']` and
`no active Design product` to the checkout's real b_spline_gen_log.txt -- a "Send" nobody made.
"""
import os
import sys
import types
import importlib.util

_HERE = os.path.dirname(os.path.abspath(__file__))


def _install_fake_adsk():
    adsk = types.ModuleType("adsk")
    adsk.core = types.ModuleType("adsk.core")
    adsk.fusion = types.ModuleType("adsk.fusion")
    adsk.cam = types.ModuleType("adsk.cam")
    adsk.core.Application = type("Application", (object,), {"get": classmethod(lambda cls: None)})
    for name in ("UserInterfaceGeneralEventHandler", "HTMLEventHandler",
                 "CommandEventHandler", "CommandCreatedEventHandler", "ValueInput"):
        setattr(adsk.core, name, type(name, (object,), {}))
    for k, v in (("adsk", adsk), ("adsk.core", adsk.core), ("adsk.fusion", adsk.fusion), ("adsk.cam", adsk.cam)):
        sys.modules.setdefault(k, v)


def _load():
    _install_fake_adsk()
    spec = importlib.util.spec_from_file_location("b_spline_gen_log_isolation_under_test", os.path.join(_HERE, "b-spline-gen.py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules["b_spline_gen_log_isolation_under_test"] = module
    spec.loader.exec_module(module)
    return module


def _live_log(bsg, monkeypatch):
    """Where the log goes WITHOUT the test override: the checkout's own file, or wherever the tracked
    workspace_link.json points (the MAIN checkout's live log, which the deployed add-in also writes)."""
    with monkeypatch.context() as m:
        m.delenv(bsg.LOG_FILE_ENV, raising=False)
        return bsg.get_log_path()


def _stat(path):
    return (os.path.getsize(path), os.path.getmtime(path)) if os.path.exists(path) else None


def test_conftest_and_module_agree_on_the_seam():
    import conftest
    assert _load().LOG_FILE_ENV == conftest.LOG_FILE_ENV


def test_the_module_logs_to_the_test_file_not_the_live_log(monkeypatch):
    bsg = _load()
    assert os.environ.get(bsg.LOG_FILE_ENV), "conftest.py must set the log override before collection"
    assert os.path.normcase(bsg.LOG_FILE) == os.path.normcase(os.environ[bsg.LOG_FILE_ENV])
    assert os.path.normcase(bsg.LOG_FILE) != os.path.normcase(_live_log(bsg, monkeypatch))


def test_logging_leaves_the_live_log_untouched(monkeypatch):
    bsg = _load()
    live = _live_log(bsg, monkeypatch)
    before = _stat(live)
    bsg._log('_handle_generate: isPreview=False -- test_log_isolation probe')
    assert _stat(live) == before
    with open(bsg.LOG_FILE, encoding='utf-8') as f:
        assert 'test_log_isolation probe' in f.read()


def test_without_the_override_the_log_resolves_as_before(monkeypatch):
    bsg = _load()
    path = _live_log(bsg, monkeypatch)
    assert path.endswith('b_spline_gen_log.txt') and path != os.environ.get(bsg.LOG_FILE_ENV)
