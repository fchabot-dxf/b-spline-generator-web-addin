"""pytest setup for bspline-frame-builder/b-spline-gen.

b-spline-gen.py's _log() writes to the LIVE add-in log (the checkout's b_spline_gen_log.txt, which the
deployed add-in's workspace_link.json also points at). Tests that drive _handle_generate with a fake adsk
then left lines like `_handle_generate: isPreview=False ... no active Design product` in Fred's real log,
which read exactly like a Send firing on its own (traced 2026-10-04). Every test run in this folder logs
to a throwaway file instead, via the module's declared LOG_FILE_ENV seam. Set in pytest_configure, i.e.
BEFORE collection, because each test file imports b-spline-gen.py at module level and LOG_FILE is
computed at import time.
"""
import os
import tempfile

LOG_FILE_ENV = 'BSPLINE_GEN_LOG_FILE'  # = b-spline-gen.py LOG_FILE_ENV (test_log_isolation checks they agree)


def pytest_configure(config):
    log_dir = tempfile.mkdtemp(prefix='bspline-gen-test-log-')
    os.environ[LOG_FILE_ENV] = os.path.join(log_dir, 'b_spline_gen_log.txt')
