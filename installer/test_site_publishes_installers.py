"""
The website serves the one-click installers at its root (https://bspline-generator.pages.dev/install-bspline-addin.cmd
and .command) -- the same files the add-in download button offers (main/addin-download.js). The Pages build is
`deploy_cloudflare.py --build-only` -> bspline-frame-builder/dist/; this runs that build (hidden) and reads dist/.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DIST = REPO / 'bspline-frame-builder' / 'dist'
NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0


def test_pages_build_publishes_the_installers_byte_for_byte():
    p = subprocess.run([sys.executable, str(REPO / 'bspline-frame-builder' / 'deploy_cloudflare.py'), '--build-only'],
                       cwd=str(REPO), capture_output=True, text=True, timeout=600, creationflags=NO_WINDOW,
                       stdin=subprocess.DEVNULL)
    assert p.returncode == 0, p.stdout + p.stderr
    for name in ('install-bspline-addin.cmd', 'install-bspline-addin.command', '_headers'):
        assert (DIST / name).read_bytes() == (HERE / name).read_bytes(), name     # CRLF / LF kept as committed
    assert not (DIST / 'test_install_scripts.py').exists()                         # only the installers, not the tests
    headers = (DIST / '_headers').read_text(encoding='utf-8')
    assert '/install-bspline-addin.cmd\n  Content-Type: text/plain' in headers
