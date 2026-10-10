"""
2026-10-09 (seat A): the Send transport (send_transport.py). The palette may gzip + base64 the Send payload; this
add-in decodes it back to the EXACT JSON text before json.loads. Pinned here:
  - the palette-encoded fixture (tests/fixtures/send-gzip-b64.json, written by tests/send-transport.test.js with the
    real encodeSendPayload) decodes to the exact text -- the two languages agree on the format;
  - the real notify() path: generate_start declaring gzip-b64, the chunks, generate_finish -> _handle_generate gets
    the same payload as a plain Send of the same text; a start with no encoding (an older palette) stays plain;
  - Fred's showcase payloads, when present on this PC, round-trip exactly (skipped elsewhere).

Run with:
    cd bspline-frame-builder/b-spline-gen
    python -m pytest test_send_transport.py
"""
import base64
import glob
import gzip
import hashlib
import json
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import send_transport as st  # noqa: E402

FIXTURE = os.path.join(_HERE, '..', '..', 'tests', 'fixtures', 'send-gzip-b64.json')
SHOWCASE = [r'C:/Users/danse/.bspline-status/shots/advisor/creations', r'C:/Users/danse/APPS/b-spline-generator-web-addin-wt/adv-show-c/drafts/finals']


def test_declared_contract():
    assert st.SEND_ENCODINGS == ('plain', 'gzip-b64')
    assert st.transport_info() == {'version': 1, 'encodings': ['plain', 'gzip-b64']}
    assert st.encoding_of(None) == 'plain'            # an older palette's generate_start: no data
    assert st.encoding_of({'totalChunks': 3}) == 'plain'  # ... or no encoding key
    assert st.encoding_of({'encoding': 'gzip-b64'}) == 'gzip-b64'
    with pytest.raises(ValueError):
        st.encoding_of({'encoding': 'zstd'})
    assert st.decode_payload('{"a": 1}', 'plain') == '{"a": 1}'


def test_palette_encoded_fixture_decodes_exactly():
    with open(FIXTURE, encoding='utf-8') as f:
        fx = json.load(f)
    text = st.decode_payload(fx['data'], fx['encoding'])
    assert len(text) == fx['chars']
    assert hashlib.sha1(text.encode('utf-8')).hexdigest() == fx['sha1']
    assert json.loads(text)['stepVariants'][1]['name'] == 'Stamped'


# ---- the real notify() path (same harness as test_send_visibility.py) ----
from test_send_visibility import bsg, _Args  # noqa: E402


def _send(monkeypatch, start_data, chunks):
    monkeypatch.setattr(bsg, '_log', lambda msg, *a, **k: None)
    handler = bsg.PaletteHTMLEventHandler()
    got = []
    monkeypatch.setattr(handler, '_handle_generate', lambda payload: got.append(payload), raising=False)
    handler.notify(_Args('generate_start', start_data))
    for i, c in enumerate(chunks):
        handler.notify(_Args('generate_chunk', json.dumps({'index': i, 'data': c})))
    handler.notify(_Args('generate_finish'))
    return got


def test_notify_gzip_b64_equals_plain(monkeypatch):
    with open(FIXTURE, encoding='utf-8') as f:
        fx = json.load(f)
    data = fx['data']
    cut = [data[i:i + 4096] for i in range(0, len(data), 4096)]
    gz = _send(monkeypatch, json.dumps({'totalChunks': len(cut), 'encoding': 'gzip-b64', 'version': 1}), cut)
    text = st.decode_payload(data, 'gzip-b64')
    plain = _send(monkeypatch, '', [text[:1000], text[1000:]])  # an older palette: no start data at all
    assert len(gz) == 1 and gz == plain == [json.loads(text)]


def _showcase_files():
    return sorted(f for d in SHOWCASE for f in glob.glob(os.path.join(d, 'claude_*.json')) if f.split(os.sep)[-1].count('.') == 1)


@pytest.mark.skipif(not _showcase_files(), reason="Fred's showcase payloads are not on this PC")
def test_showcase_payloads_round_trip_exactly():
    for path in _showcase_files():
        with open(path, encoding='utf-8') as f:
            text = f.read()
        sent = base64.b64encode(gzip.compress(text.encode('utf-8'), compresslevel=1)).decode('ascii')
        assert st.decode_payload(sent, 'gzip-b64') == text, path
