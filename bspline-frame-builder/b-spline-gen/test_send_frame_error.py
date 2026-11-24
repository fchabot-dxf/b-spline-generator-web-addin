"""2026-11-24 (live check of Back: Flat): a frame Fusion could not build used to reach the palette only as frame_result,
painted over at once by import_success's "Imported into Fusion". send_targets.send_frame_error is what b-spline-gen.py
puts on the import_success reply (`frameError`) so the failure stays on screen (main/frame-panel.js importSuccessStatus).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))

from send_targets import send_frame_error  # noqa: E402

_GEN = open(os.path.join(os.path.dirname(os.path.realpath(__file__)), 'b-spline-gen.py'), encoding='utf-8').read()


def test_a_failed_frame_result_gives_its_error():
    r = {'ok': False, 'error': 'The frame was not fully built in Fusion: t1_TRIM_CUT: 3 : EXTRUDE_CREATION_FAIL_ERROR',
         'frame': 'Frame_1', 'failed': [{'feature': 't1_TRIM_CUT', 'error': '3 : EXTRUDE_CREATION_FAIL_ERROR'}]}
    assert send_frame_error(r) == r['error']
    assert send_frame_error({'ok': False}) == 'The frame was not built.'


def test_an_ok_frame_or_no_frame_gives_none():
    assert send_frame_error({'ok': True, 'error': None}) is None
    assert send_frame_error(None) is None


def test_the_send_puts_the_frame_error_on_its_success_reply():
    send = _GEN[_GEN.index('def _handle_generate'):]
    send = send[:send.index('def _import_all_svg_layers')]
    assert 'frame_error = send_frame_error(frame_result)' in send
    assert "done['frameError'] = frame_error" in send
    assert send.index("done['frameError'] = frame_error") < send.index("_post_to_palette('import_success', done)")
