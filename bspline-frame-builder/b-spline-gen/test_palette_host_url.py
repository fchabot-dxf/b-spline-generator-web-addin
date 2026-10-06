"""
H23 item 92: the palette opened as the website (no Send button) when Fusion injected `adsk` later than the page's
300 ms check (seat A, live, 2026-10-06). The add-in now DECLARES the host in the palette URL -- the flag declared once
in html/data/fusion-host.js, which the page's pollMode reads too. This drives the REAL CommandExecuteHandler.notify
(the palette-creating path) with a recording palettes.add and checks the URL it opens.

Run with:
    cd bspline-frame-builder/b-spline-gen
    python3 -m pytest test_palette_host_url.py
"""
import json
import os
import re
import sys
import types
from urllib.parse import urlsplit, parse_qs

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import test_import_failed_no_modal as _shared  # installs the same minimal fake adsk BEFORE the module import

bsg = _shared.bsg


def _declared_host():
    src = open(os.path.join(_HERE, 'html', 'data', 'fusion-host.js'), encoding='utf-8').read()
    m = re.search(r'^export default', src, re.M)
    return json.loads(src[m.end():].strip().rstrip(';'))


class _Event:
    def __init__(self):
        self.added = []

    def add(self, h):
        self.added.append(h)


class _Palette:
    def __init__(self):
        self.incomingFromHTML = _Event()
        self.closed = _Event()
        self.dockingState = None


class _Palettes:
    def __init__(self):
        self.added = []

    def itemById(self, _id):
        return None  # no palette yet -> the creating path

    def add(self, pid, name, url, *rest):
        self.added.append((pid, url))
        return _Palette()


def _open_palette(monkeypatch):
    palettes = _Palettes()
    monkeypatch.setattr(bsg, 'ui', types.SimpleNamespace(palettes=palettes, messageBox=lambda *_: None))
    _shared._adsk.core.PaletteDockingStates = types.SimpleNamespace(PaletteDockStateRight='right')
    bsg.CommandExecuteHandler().notify(None)
    assert len(palettes.added) == 1, palettes.added
    return palettes.added[0][1]


class TestPaletteHostUrl:
    def test_the_palette_opens_with_the_declared_fusion_host_flag(self, monkeypatch):
        url = _open_palette(monkeypatch)
        host = _declared_host()
        parts = urlsplit(url)
        assert parse_qs(parts.query) == {host['param']: [host['value']]}

    def test_the_url_is_the_file_form_fusion_accepts_with_a_query(self, monkeypatch):
        # measured live 2026-10-06: a bare path plus a query -> "Invalid htmlFileURL"; file:///<path>?q loads
        url = _open_palette(monkeypatch)
        assert url.startswith('file:///')
        assert urlsplit(url).path.endswith('/html/bspline_gen_palette.html')
        assert '\\' not in url
