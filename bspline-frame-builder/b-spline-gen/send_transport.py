"""
send_transport.py -- how a Send payload travels from the palette to this add-in (2026-10-09, seat A).

Fred's showcase boards sent 5-44 MB of JSON (two full STEP texts) as 256 KB chunks over the palette bridge. The palette
may now gzip the payload and base64 it into the chunks; this add-in decodes it back to the EXACT JSON text before
json.loads, so what Fusion imports is byte-identical by construction.

The contract is declared on both sides (the palette's SEND_TRANSPORT, core/fusion-bridge.js):
  - the add-in announces SEND_ENCODINGS at the first handshake ('send_transport'); the palette only compresses when
    'gzip-b64' is listed -- an older add-in announces nothing and keeps receiving plain JSON;
  - the palette declares the encoding of each Send in its 'generate_start' message; a missing encoding is 'plain'
    (an older palette), so a newer add-in still reads it.

Pure / testable: no adsk import.
"""
import base64
import gzip

SEND_TRANSPORT_VERSION = 1
SEND_ENCODINGS = ('plain', 'gzip-b64')  # what this add-in can read


def transport_info():
    """The handshake message the add-in sends the palette."""
    return {'version': SEND_TRANSPORT_VERSION, 'encodings': list(SEND_ENCODINGS)}


def encoding_of(start_data):
    """The declared encoding of a Send, from its 'generate_start' data (dict or None). Absent = 'plain'."""
    enc = (start_data or {}).get('encoding') or 'plain'
    if enc not in SEND_ENCODINGS:
        raise ValueError(f'unknown Send encoding {enc!r} (this add-in reads {", ".join(SEND_ENCODINGS)})')
    return enc


def decode_payload(text, encoding='plain'):
    """The payload's JSON text, from the joined chunks as sent."""
    if encoding == 'plain':
        return text
    if encoding == 'gzip-b64':
        return gzip.decompress(base64.b64decode(text)).decode('utf-8')
    raise ValueError(f'unknown Send encoding {encoding!r}')
