"""fb_shared/fusion_memory.py: Fusion's own memory before each Send / BUILD, detection only (2026-10-07: ~2.6 GB stays
inside Fusion per Send+BUILD+APPLY doc; long sessions reached 65 GB). Page side: tests/fusion-memory-line.test.js."""
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from fb_shared import fusion_memory as fm  # noqa: E402


def test_the_declared_thresholds_and_their_edges():
    assert (fm.FUSION_RESTART_SOFT_GB, fm.FUSION_RESTART_HARD_GB) == (12, 24)
    assert fm.memory_signal(11.9)['level'] == 'ok' and fm.memory_signal(11.9)['text'] == ''
    assert fm.memory_signal(12.0)['level'] == 'soft'
    assert fm.memory_signal(23.9)['level'] == 'soft'
    assert fm.memory_signal(24.0)['level'] == 'hard'
    assert fm.memory_signal(13.4) == {'gb': 13.4, 'level': 'soft', 'text': 'Fusion is using 13 GB: save and restart Fusion soon'}


def test_an_unknown_reading_never_shows_a_line():
    assert fm.memory_signal(None) == {'gb': None, 'level': 'ok', 'text': ''}


def test_the_reading_is_logged_with_where_it_was_taken():
    lines = []
    sig = fm.read_signal(lines.append, 'Send')
    assert len(lines) == 1 and lines[0].startswith('[MEMORY] Send: Fusion private ') and lines[0].endswith(f"({sig['level']})")


def test_this_process_can_be_read_on_windows():
    gb = fm.private_gb()
    if sys.platform == 'win32':
        assert gb is not None and 0 < gb < 64
    else:
        assert gb is None


def test_send_and_build_both_read_it_before_they_start():
    bsg = open(os.path.join(_ROOT, 'b-spline-gen', 'b-spline-gen.py'), encoding='utf-8').read()
    cam = open(os.path.join(_ROOT, 'CAM-builder', 'cam-builder.py'), encoding='utf-8').read()
    assert "_post_to_palette('fusion_memory', fusion_memory.read_signal(_log, where))" in bsg
    assert "_post_fusion_memory('Send')" in bsg
    assert "_send_to_html('fusion_memory', _fb_shared('fusion_memory').read_signal(_log, where))" in cam
    # the BUILD reading comes before the engine loads (the start of _do_generate)
    gen = cam[cam.index('def _do_generate('):]
    assert gen.index("_post_fusion_memory('BUILD')") < gen.index('_load_engine()')


def test_the_stale_import_refs_hygiene_is_installed_by_the_parent():
    """MEASURED live 2026-10-07: the parent add-in never calls b-spline-gen's run(), so a registration there never
    happened; the parent installs b-spline-gen's session handlers right after loading it."""
    parent = open(os.path.join(_ROOT, 'bspline-frame-builder.py'), encoding='utf-8').read()
    bsg = open(os.path.join(_ROOT, 'b-spline-gen', 'b-spline-gen.py'), encoding='utf-8').read()
    load = parent.index("_bs        = _load_submodule('bspline_ui'")
    assert load < parent.index('_bs.install_session_handlers()')
    assert 'def install_session_handlers():' in bsg and 'app.documentClosed.add(_doc_closed_handler)' in bsg
    assert 'app.documentClosed.remove(_doc_closed_handler)' in bsg  # stop() removes it
