"""Deploy bspline-presets Worker via Cloudflare REST API (no wrangler needed)."""
import os, sys, json
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# -- Paths ---------------------------------------------------------------------
# Script lives at <repo>/bspline-frame-builder/deploy_worker.py -- both
# .env and cloud/ live at the repo root one level up.
ROOT = Path(__file__).resolve().parent.parent

# -- Load .env -----------------------------------------------------------------
env_path = ROOT / '.env'
if env_path.exists():
    for line in env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

ACCOUNT_ID  = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '014e18b89793d634a95538e7910dce19')
API_TOKEN   = os.environ.get('CLOUDFLARE_API_TOKEN')
SCRIPT_NAME = 'bspline-presets'
WORKER_SRC  = ROOT / 'cloud' / 'preset-worker' / 'src' / 'index.js'
KV_BINDING  = 'PRESETS'
KV_NS_ID    = '7c5a9da610ff46d98209265d5c270818'
COMPAT_DATE = '2024-09-01'

if not API_TOKEN:
    sys.exit('Error: CLOUDFLARE_API_TOKEN not set')

script_text = WORKER_SRC.read_text(encoding='utf-8')
print(f'Worker source: {WORKER_SRC} ({len(script_text)} bytes)')

# -- Build multipart payload ---------------------------------------------------
import urllib.request, urllib.error, uuid

boundary = uuid.uuid4().hex
CRLF = b'\r\n'

def part_json(name, obj):
    data = json.dumps(obj).encode('utf-8')
    return (
        f'--{boundary}\r\n'.encode() +
        f'Content-Disposition: form-data; name="{name}"\r\n'.encode() +
        b'Content-Type: application/json\r\n\r\n' +
        data + CRLF
    )

def part_js(name, filename, code):
    data = code.encode('utf-8')
    return (
        f'--{boundary}\r\n'.encode() +
        f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode() +
        b'Content-Type: application/javascript+module\r\n\r\n' +
        data + CRLF
    )

metadata = {
    'main_module': 'index.js',
    'compatibility_date': COMPAT_DATE,
    'bindings': [
        {'type': 'kv_namespace', 'name': KV_BINDING, 'namespace_id': KV_NS_ID}
    ],
}

body = (
    part_json('metadata', metadata) +
    part_js('index.js', 'index.js', script_text) +
    f'--{boundary}--\r\n'.encode()
)

url = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}'
req = urllib.request.Request(
    url,
    data=body,
    method='PUT',
    headers={
        'Authorization': f'Bearer {API_TOKEN}',
        'Content-Type': f'multipart/form-data; boundary={boundary}',
    }
)

print(f'Deploying to: {url}')
try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read())
    if result.get('success'):
        print('Worker deployed successfully!')
        rid = result.get('result', {}).get('id', '?')
        print(f'   Script: {SCRIPT_NAME}  |  etag: {rid}')
    else:
        print(f'Deploy failed: {result}')
        sys.exit(1)
except urllib.error.HTTPError as e:
    body_err = e.read().decode('utf-8', errors='replace')
    print(f'HTTP {e.code} error: {body_err}')
    sys.exit(1)
except Exception as e:
    print(f'Error: {e}')
    sys.exit(1)
