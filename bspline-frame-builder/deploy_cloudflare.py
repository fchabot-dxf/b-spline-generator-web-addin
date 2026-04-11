import os
workspace_dir = os.path.dirname(__file__) or "."
source_dir    = os.path.join(workspace_dir, "b-spline-gen", "html")
# ...existing code...
import subprocess
import sys
import os
import shutil
import time
import stat
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

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

from dotenv import load_dotenv
from pathlib import Path
# Always load .env from the workspace root
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)
if os.path.exists(env_path):
    with open(env_path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ[key.strip()] = val.strip()

# Validate required env vars
for var in ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"):
    if not os.environ.get(var):
        print(f"Error: {var} is not set. Add it to .env or set it as an environment variable.")
        exit(1)

# Always deploy to the known Pages project and avoid prompting for a stale project name.
PROJECT_NAME = "symmetric-b-spline-gen"

# prefer looking in PATH (wrangler or wrangler.cmd on Windows)
WRANGLER_CMD = shutil.which("wrangler") or shutil.which("wrangler.cmd")

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

# verify cli exists
try:
    if WRANGLER_CMD is None: raise Exception("Wrangler not found")
    subprocess.run([WRANGLER_CMD, "--version"], check=True, capture_output=True)
except Exception:
    print("wrangler CLI could not be found. Install it with: npm install -g wrangler")
    exit(1)


workspace_dir = os.path.dirname(__file__) or "."
source_dir    = os.path.join(workspace_dir, "b-spline-gen", "html")

# Create a unique, timestamped deployment folder to bypass file locks on Google Drive/Windows
timestamp     = datetime.now().strftime("%Y%m%d_%H%M%S")
deploy_dist   = os.path.normpath(os.path.join(workspace_dir, f"deploy_dist_{timestamp}"))

# 0. Clean up previous deployment folders (if they are not locked)
for d in os.listdir(workspace_dir):
    if d.startswith("deploy_dist_") and d != f"deploy_dist_{timestamp}":
        clean_dir(os.path.join(workspace_dir, d))
# Also try to clean up the legacy 'deploy_dist' if it exists
clean_dir(os.path.join(workspace_dir, "deploy_dist"))

# 1. Prepare clean deployment folder
print(f"Preparing unique deployment folder: {deploy_dist}")
os.makedirs(deploy_dist, exist_ok=True)


# Copy all web-related files (HTML, JS, CSS, images, etc.)
web_extensions = ('.html', '.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.ico', '.json')
for filename in os.listdir(source_dir):
    if filename.lower().endswith(web_extensions):
        shutil.copy2(os.path.join(source_dir, filename), deploy_dist)

# Ensure the entire themes/ folder is copied
themes_src = os.path.join(source_dir, 'themes')
themes_dst = os.path.join(deploy_dist, 'themes')
if os.path.exists(themes_src):
    shutil.copytree(themes_src, themes_dst, dirs_exist_ok=True)


# 2. Bundle the clean bspline-frame-builder add-in ZIP (Distribution Version)
print(f"Bundling clean distribution ZIP to {deploy_dist}...")
zip_target = os.path.join(deploy_dist, "bspline-frame-builder.zip")

def should_skip(name):
    skip_names = {".git", ".gitignore", "__pycache__", ".venv", "venv", "node_modules", ".wrangler", "desktop.ini"}
    skip_exts  = {".log", ".old", ".pyc", ".zip"} # Skip log files and PREVIOUS zips!
    if name in skip_names or os.path.splitext(name)[1].lower() in skip_exts:
        return True
    return False

import zipfile
with zipfile.ZipFile(zip_target, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(workspace_dir):
        # Prune directories
        dirs[:] = [d for d in dirs if not should_skip(d)]
        for f in files:
            if should_skip(f): continue
            abs_path = os.path.join(root, f)
            rel_path = os.path.relpath(abs_path, workspace_dir)
            zf.write(abs_path, rel_path)


print(f"  Clean ZIP created: {os.path.basename(zip_target)}")

print(f"Deploying clean folder to Cloudflare Pages ({PROJECT_NAME})...")

result = subprocess.run([
    WRANGLER_CMD, "pages", "deploy", deploy_dist, "--project-name", PROJECT_NAME
], cwd=workspace_dir)

# 2. Cleanup
clean_dir(deploy_dist)

if result.returncode == 0:
    print("Deployment complete.")
    sys.exit(0)

print(f"Deployment failed (exit code {result.returncode}).")
sys.exit(result.returncode)
