import hashlib
import os
from pathlib import Path

WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ADDIN_DIR = os.getenv('TEMPLATE_MAKER_ADDIN_DIR')
if not ADDIN_DIR:
    appdata = os.getenv('APPDATA') or os.path.expanduser('~\\AppData\\Roaming')
    ADDIN_DIR = Path(appdata) / 'Autodesk' / 'Autodesk Fusion 360' / 'API' / 'AddIns' / 'template-maker'
ADDIN_DIR = os.path.abspath(str(ADDIN_DIR))

files = [f for f in os.listdir(WORKSPACE_DIR) if os.path.isfile(os.path.join(WORKSPACE_DIR, f))]
diffs = []
for name in sorted(files):
    ws_path = os.path.join(WORKSPACE_DIR, name)
    addin_path = os.path.join(ADDIN_DIR, name)
    if not os.path.exists(addin_path):
        diffs.append(f"{name} (missing in addin)")
        continue
    with open(ws_path, 'rb') as f1, open(addin_path, 'rb') as f2:
        if hashlib.sha256(f1.read()).hexdigest() != hashlib.sha256(f2.read()).hexdigest():
            diffs.append(name)

if not diffs:
    print('NO_DIFFS')
else:
    print('DIFFS:')
    for diff in diffs:
        print(diff)
