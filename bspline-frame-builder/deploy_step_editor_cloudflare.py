"""
deploy_step_editor_cloudflare.py
================================
Publishes the step-editor palette HTML/JS/CSS to Cloudflare Pages so the
exact same UI is reachable in a standalone browser at:

    https://step-editor.pages.dev/

Mirrors `deploy_cloudflare.py` (which publishes b-spline-gen) but targets a
separate Pages project so the two sites stay independent.

Credentials come from .env at the workspace root (CLOUDFLARE_ACCOUNT_ID,
CLOUDFLARE_API_TOKEN). The Pages project name is hard-coded to
`step-editor` to match the deployed URL; override with the env var
STEP_EDITOR_PROJECT if you need to push to a sibling preview project.

Usage:
    python deploy_step_editor_cloudflare.py
"""
import os
import sys
import shutil
import subprocess
import time
import stat
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def clean_dir(path):
    """Same robust deletion as deploy_cloudflare.py — Windows + Drive locks."""
    if not os.path.exists(path):
        return

    def onerror(func, p, _exc_info):
        if not os.access(p, os.W_OK):
            os.chmod(p, stat.S_IWUSR)
            func(p)
        else:
            raise
    for i in range(3):
        try:
            shutil.rmtree(path, onerror=onerror)
            return
        except PermissionError:
            if i < 2:
                print(f"Locked: {path}. Retrying ({i+1}/3)…")
                time.sleep(1)
            else:
                print(f"Warning: {path} stuck — proceeding.")
        except Exception as e:
            print(f"Warning: cleanup of {path} failed: {e}")
            break


# ── Env loading ────────────────────────────────────────────────────────────
workspace_root = Path(__file__).parent.parent
env_path = workspace_root / '.env'
if env_path.is_file():
    with open(env_path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, val = line.split('=', 1)
                os.environ.setdefault(key.strip(), val.strip())

for var in ('CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'):
    if not os.environ.get(var):
        print(f"Error: {var} is not set (looked for {env_path}).")
        sys.exit(1)

PROJECT_NAME = os.getenv('STEP_EDITOR_PROJECT', 'step-editor')

# ── Path setup ─────────────────────────────────────────────────────────────
# This script lives in bspline-frame-builder/. The source is the sibling
# folder bspline-frame-builder/step-editor/html.
this_dir   = Path(__file__).parent
source_dir = this_dir / 'step-editor' / 'html'
if not source_dir.is_dir():
    print(f"Error: source folder not found: {source_dir}")
    sys.exit(1)

# Refresh step-editor's stamp bundle from b-spline-gen's canonical
# copy. Same call the local Fusion deploy uses — keeps the published
# site in lock-step with the in-Fusion build.
try:
    from sync_stamp_bundle import sync_stamp_bundle
    sync_stamp_bundle(this_dir)
except Exception as e:
    print(f"Warning: stamp bundle sync failed: {e}")

# Wrangler resolution — try PATH then known npm globals.
if sys.platform == 'win32':
    os.environ['PATH'] = os.pathsep.join([
        os.path.expandvars(r"%APPDATA%\npm"),
        os.path.expandvars(r"%LOCALAPPDATA%\nvm"),
        r"C:\nvm4w\nodejs",
        os.path.expandvars(r"%ProgramFiles%\nodejs"),
    ]) + os.pathsep + os.environ.get('PATH', '')

WRANGLER_CMD = shutil.which('wrangler') or shutil.which('wrangler.cmd')
if WRANGLER_CMD is None and sys.platform == 'win32':
    WRANGLER_CMD = os.path.expandvars(r"%USERPROFILE%\AppData\Roaming\npm\wrangler.cmd")
try:
    if WRANGLER_CMD is None:
        raise Exception('Wrangler not found')
    subprocess.run([WRANGLER_CMD, '--version'], check=True, capture_output=True)
except Exception:
    print("wrangler CLI not found. Install it: npm install -g wrangler")
    sys.exit(1)

# ── Build the deploy folder ───────────────────────────────────────────────
# Cloudflare Pages workers cap each deployment at ~25 MiB per file; the
# step-editor html tree is small (occt-import-js is loaded from a CDN, not
# bundled), so a flat copy works.
timestamp   = datetime.now().strftime('%Y%m%d_%H%M%S')
deploy_dist = this_dir / f"deploy_step_editor_{timestamp}"

# Cleanup any leftover step-editor deploy folders from prior runs (Windows
# Drive locks can wedge them — best-effort).
for child in this_dir.iterdir():
    if child.is_dir() and child.name.startswith('deploy_step_editor_'):
        if child != deploy_dist:
            clean_dir(child)

print(f"Preparing deploy folder: {deploy_dist}")
deploy_dist.mkdir(parents=True, exist_ok=True)

# Only carry web-deployable assets — same allow-list as deploy_cloudflare.py.
WEB_EXTS = (
    '.html', '.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.ico', '.json',
    '.ttf', '.woff', '.woff2', '.otf', '.step', '.stp',
)
copied = 0
for root, dirs, files in os.walk(source_dir):
    rel_root = Path(root).relative_to(source_dir)
    dest_root = deploy_dist if rel_root == Path('.') else deploy_dist / rel_root
    dest_root.mkdir(parents=True, exist_ok=True)
    for filename in files:
        if filename.lower().endswith(WEB_EXTS):
            shutil.copy2(os.path.join(root, filename), dest_root / filename)
            copied += 1

# Also drop sample STEP files so the standalone web build can open them
# without the user having local copies. Optional but matches the in-Fusion
# folder structure (step-editor/samples/*.step).
samples_src = this_dir / 'step-editor' / 'samples'
if samples_src.is_dir():
    samples_dst = deploy_dist / 'samples'
    samples_dst.mkdir(parents=True, exist_ok=True)
    for f in samples_src.iterdir():
        if f.suffix.lower() in ('.step', '.stp') and f.stat().st_size < 5 * 1024 * 1024:
            shutil.copy2(f, samples_dst / f.name)
            copied += 1

# Cloudflare Pages serves the root URL from `index.html`. Our in-Fusion
# build calls it `step_editor_palette.html` (matching what Fusion's
# palette code expects). Copy it to `index.html` in the dist so a
# visitor hitting https://step-editor.pages.dev/ lands on the editor
# immediately, rather than getting a 404.
src_palette = deploy_dist / 'step_editor_palette.html'
dst_index   = deploy_dist / 'index.html'
if src_palette.is_file():
    shutil.copy2(src_palette, dst_index)
    copied += 1
    print(f"Aliased step_editor_palette.html → index.html for Pages root.")
else:
    print("Warning: step_editor_palette.html not found in dist — "
          "Pages root URL will 404.")

print(f"Copied {copied} file(s).")

# ── Deploy ────────────────────────────────────────────────────────────────
print(f"Deploying to Cloudflare Pages project: {PROJECT_NAME}")
result = subprocess.run(
    [WRANGLER_CMD, 'pages', 'deploy', str(deploy_dist),
     '--project-name', PROJECT_NAME],
    cwd=str(this_dir),
)

clean_dir(deploy_dist)

if result.returncode != 0:
    print(f"Deployment failed (exit {result.returncode}).")
    sys.exit(result.returncode)

print("Cloudflare Pages deploy complete: https://step-editor.pages.dev/")
sys.exit(0)
