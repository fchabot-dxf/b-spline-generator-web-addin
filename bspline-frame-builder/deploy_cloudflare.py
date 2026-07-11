import subprocess
import sys
import os
import shutil
import time
import stat
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# deploy_cloudflare.py — WEB ONLY. Builds the static site (dist/) from
# b-spline-gen/html + styles/, then deploys it to Cloudflare Pages via wrangler.
# The Fusion add-in ZIP and its GitHub 'latest' release are NO LONGER built here —
# they moved to release.py (`--addin` / `--all`) as of 2026-07-11 [DF3].
#
# `--build-only` produces dist/ and exits (no wrangler needed). Used by the
# GitHub-connected Cloudflare Pages build, where CLOUDFLARE_* env vars and
# wrangler aren't applicable.
BUILD_ONLY = "--build-only" in sys.argv

def clean_dir(path):
    """Robustly deletes a directory, handling read-only files and temporary OS locks."""
    if not os.path.exists(path):
        return

    def onerror(func, p, exc_info):
        # If the failure is due to a read-only file, try to clear the attribute and retry
        import stat
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
                print(f"Directory {path} is locked. Retrying in 1s... ({i+1}/3)")
                time.sleep(1)
            else:
                print(f"Warning: Could not fully clean {path} due to a persistent lock. Proceeding anyway.")
        except Exception as e:
            print(f"Warning: Error during cleanup of {path}: {e}")
            break

from pathlib import Path
# Always load .env from the workspace root. dotenv is only used for local
# manual deploys; the Cloudflare Pages build container doesn't have it (and
# doesn't need it — there's no .env to load there).
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / '.env'
    load_dotenv(dotenv_path=env_path)
except ImportError:
    env_path = Path(__file__).parent.parent / '.env'
if os.path.exists(env_path):
    with open(env_path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ[key.strip()] = val.strip()

# Validate required env vars (not needed in --build-only mode)
if not BUILD_ONLY:
    for var in ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"):
        if not os.environ.get(var):
            print(f"Error: {var} is not set. Add it to .env or set it as an environment variable.")
            exit(1)

# Always deploy to the known Pages project and avoid prompting for a stale project name.
PROJECT_NAME = os.getenv("CLOUDFLARE_PROJECT", "symmetric-b-spline-gen")

# Ensure node/npm global bin dirs are in PATH so wrangler.cmd can invoke node
if sys.platform == "win32":
    _extra_paths = [
        os.path.expandvars(r"%APPDATA%\npm"),
        os.path.expandvars(r"%LOCALAPPDATA%\nvm"),
        r"C:\nvm4w\nodejs",
        os.path.expandvars(r"%ProgramFiles%\nodejs"),
    ]
    os.environ["PATH"] = os.pathsep.join(_extra_paths) + os.pathsep + os.environ.get("PATH", "")

# prefer looking in PATH (wrangler or wrangler.cmd on Windows)
WRANGLER_CMD = shutil.which("wrangler") or shutil.which("wrangler.cmd")

# shutil.which is broken for .cmd files on Python 3.12+ / Windows — fall back
# to direct file-existence checks when it returns nothing.
if WRANGLER_CMD is None and sys.platform == "win32":
    _wrangler_candidates = [
        # workspace wrapper (wrangler.cmd placed next to this file's parent)
        os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "wrangler.cmd")),
        os.path.expandvars(r"%APPDATA%\npm\wrangler.cmd"),
        os.path.expandvars(r"%USERPROFILE%\AppData\Roaming\npm\wrangler.cmd"),
    ]
    for _c in _wrangler_candidates:
        if os.path.isfile(_c):
            WRANGLER_CMD = _c
            break

if WRANGLER_CMD is None:
    # fall back to known npm global paths if not in PATH
    if sys.platform == "win32":
        WRANGLER_CMD = os.path.expandvars(r"%USERPROFILE%\AppData\Roaming\npm\wrangler.cmd")
    else:
        # Common macOS/Linux npm global paths
        possible_paths = [
            "/usr/local/bin/wrangler",
            os.path.expanduser("~/.npm-global/bin/wrangler"),
            "/usr/bin/wrangler"
        ]
        for p in possible_paths:
            if os.path.exists(p):
                WRANGLER_CMD = p
                break

# verify cli exists AND actually runs (skipped in --build-only mode — the
# Cloudflare Pages build container does the deploy itself, no wrangler needed)
if not BUILD_ONLY:
    if WRANGLER_CMD is None:
        print("wrangler CLI could not be located on PATH or in known npm-global paths.")
        print("Install it with: npm install -g wrangler")
        exit(1)

    try:
        _probe = subprocess.run([WRANGLER_CMD, "--version"],
                                check=True, capture_output=True, text=True)
        print(f"Using wrangler at: {WRANGLER_CMD}")
        print(f"  version: {_probe.stdout.strip() or _probe.stderr.strip()}")
    except subprocess.CalledProcessError as e:
        print(f"wrangler shim was found at {WRANGLER_CMD} but failed to execute.")
        print(f"  exit code: {e.returncode}")
        if e.stdout: print(f"  stdout: {e.stdout.strip()}")
        if e.stderr: print(f"  stderr: {e.stderr.strip()}")
        print("  This usually means the wrangler.js path inside the shim is stale")
        print("  (npm global moved, NVM switched Node versions, or wrangler was uninstalled).")
        print("  Try: npm install -g wrangler")
        exit(1)
    except FileNotFoundError as e:
        print(f"wrangler shim at {WRANGLER_CMD} could not be launched: {e}")
        print("  The interpreter (node.exe) referenced by the shim is missing.")
        print("  Check that Node is installed and on PATH (or that NVM points at a valid version).")
        exit(1)
    except Exception as e:
        print(f"Unexpected error invoking wrangler at {WRANGLER_CMD}: {e!r}")
        exit(1)


workspace_dir = os.path.dirname(__file__) or "."
source_dir    = os.path.join(workspace_dir, "b-spline-gen", "html")

# In --build-only mode use a stable name (dist/) so the Pages output-dir
# setting can point at a known path. Otherwise use a timestamped folder to
# bypass file locks on Google Drive/Windows during local manual deploys.
timestamp     = datetime.now().strftime("%Y%m%d_%H%M%S")
deploy_dist   = os.path.normpath(os.path.join(workspace_dir, "dist" if BUILD_ONLY else f"deploy_dist_{timestamp}"))

# 0. Clean up previous deployment folders (if they are not locked)
for d in os.listdir(workspace_dir):
    if d.startswith("deploy_dist_") and d != f"deploy_dist_{timestamp}":
        clean_dir(os.path.join(workspace_dir, d))
# Also try to clean up the legacy 'deploy_dist' if it exists
clean_dir(os.path.join(workspace_dir, "deploy_dist"))

# 1. Prepare clean deployment folder
print(f"Preparing unique deployment folder: {deploy_dist}")
os.makedirs(deploy_dist, exist_ok=True)

# Only copy web-related files (HTML, JS, CSS, fonts, and common image formats)
# This excludes .py, .manifest, and the 'resources' folder.
# .ttf/.woff/.woff2/.otf are needed: the SVG editor loads them as stamp assets
# via opentype.js (see b-spline-gen/html/editor/editor-geometry.js).
web_extensions = (
    '.html', '.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.ico', '.json',
    '.ttf', '.woff', '.woff2', '.otf',
)
for root, dirs, files in os.walk(source_dir):
    rel_root = os.path.relpath(root, source_dir)
    dest_root = deploy_dist if rel_root == '.' else os.path.join(deploy_dist, rel_root)
    os.makedirs(dest_root, exist_ok=True)
    for filename in files:
        if filename.lower().endswith(web_extensions):
            shutil.copy2(os.path.join(root, filename), os.path.join(dest_root, filename))

# Copy the shared styles/ folder into deploy_dist/styles/.
# All HTMLs reference these stylesheets via "../../styles/<name>.css" (resolved
# correctly in the local repo); after deploy we flatten everything under root,
# so we land styles/ at the deploy root and rewrite the link hrefs below.
styles_src = os.path.join(workspace_dir, "styles")
styles_dest = os.path.join(deploy_dist, "styles")
if os.path.isdir(styles_src):
    os.makedirs(styles_dest, exist_ok=True)
    for filename in os.listdir(styles_src):
        if filename.lower().endswith(('.css',)):
            shutil.copy2(os.path.join(styles_src, filename), os.path.join(styles_dest, filename))
            print(f"  Copied stylesheet: styles/{filename}")
else:
    print(f"  Warning: styles/ folder not found at {styles_src}")

# Rewrite stylesheet hrefs in every deployed HTML so "../../styles/X.css"
# (which would escape the deploy root) becomes "styles/X.css".
for html_name in os.listdir(deploy_dist):
    if not html_name.lower().endswith('.html'):
        continue
    html_path = os.path.join(deploy_dist, html_name)
    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()
    rewritten = html.replace('href="../../styles/', 'href="styles/')
    if rewritten != html:
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(rewritten)
        print(f"  Rewrote stylesheet hrefs in {html_name}")


if BUILD_ONLY:
    print(f"--build-only: produced {deploy_dist}. Skipping wrangler deploy.")
    sys.exit(0)


# 2. Deploy the built site to Cloudflare Pages. (The add-in ZIP build + GitHub
#    'latest' release that used to live here moved to release.py --addin [DF3];
#    the local Fusion refresh was removed [DF1]. This script is web-only now.)
print(f"Deploying clean folder to Cloudflare Pages ({PROJECT_NAME})...")

result = subprocess.run([
    WRANGLER_CMD, "pages", "deploy", deploy_dist, "--project-name", PROJECT_NAME
], cwd=workspace_dir)

# Cleanup the deploy folder regardless of outcome
clean_dir(deploy_dist)

if result.returncode != 0:
    print(f"Deployment failed (exit code {result.returncode}).")
    sys.exit(result.returncode)

print("Cloudflare Pages deployment complete.")
sys.exit(0)
