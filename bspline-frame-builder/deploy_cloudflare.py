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


# 2. Build the Fusion add-in distribution ZIP NEXT TO this script (NOT inside
# deploy_dist — Cloudflare Pages caps individual files at 25 MiB and the zip
# exceeds that). The website's download button at
# b-spline-gen/html/main/main.js#ADDIN_RELEASE_URL points to the GitHub
# release tagged `latest`, so we attach this zip there at the end of the
# script via `gh release upload latest <zip> --clobber`.
import zipfile

zip_target = os.path.join(workspace_dir, "bspline-frame-builder.zip")
print(f"Building distribution ZIP at {zip_target}...")

# Files/dirs to exclude from the distribution archive
zip_skip_names = {".git", ".gitignore", "__pycache__", ".venv", "venv",
                  "node_modules", ".wrangler", "desktop.ini"}
zip_skip_exts = {".log", ".old", ".pyc", ".zip"}  # also skip prior zips

def _zip_should_skip(name):
    if name in zip_skip_names:
        return True
    if os.path.splitext(name)[1].lower() in zip_skip_exts:
        return True
    if name.startswith('.'):
        return True
    return False

# Archive paths look like "bspline-frame-builder/frame-builder/..." so the
# zip extracts into a containing folder ready to drop into Fusion's AddIns.
addin_root_name = os.path.basename(os.path.normpath(workspace_dir))
zip_file_count = 0
if os.path.exists(zip_target):
    os.remove(zip_target)
with zipfile.ZipFile(zip_target, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(workspace_dir):
        dirs[:] = [d for d in dirs if not _zip_should_skip(d) and d != "deploy_dist" and not d.startswith("deploy_dist_")]
        for f in files:
            if _zip_should_skip(f):
                continue
            abs_path = os.path.join(root, f)
            rel_inside = os.path.relpath(abs_path, workspace_dir)
            arc_path = os.path.join(addin_root_name, rel_inside)
            zf.write(abs_path, arc_path)
            zip_file_count += 1
zip_size_mb = os.path.getsize(zip_target) / (1024 * 1024)
print(f"  Packed {zip_file_count} files -> {os.path.basename(zip_target)} ({zip_size_mb:.1f} MiB)")


# 3. Refresh local Fusion 360 Add-In (Developer Convenience)
if sys.platform == "win32":
    fusion_addin_dest = os.path.join(os.environ.get('APPDATA', ''), 'Autodesk', 'Autodesk Fusion 360', 'API', 'AddIns', 'b-spline-generator-web-addin')
elif sys.platform == "darwin":
    fusion_addin_dest = os.path.expanduser('~/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns/b-spline-generator-web-addin')
else:
    fusion_addin_dest = None

if fusion_addin_dest and os.path.exists(os.path.dirname(fusion_addin_dest)):
    print(f"Refreshing local Fusion 360 add-in at {fusion_addin_dest}...")
    try:
        clean_dir(fusion_addin_dest)

        # Use a repo-relative path for the add-in source; this avoids the old invalid hardcoded path.
        # Adjust this to the actual add-in folder in your repo if needed.
        source_addin_dir = os.path.normpath(os.path.join(workspace_dir, "..", "b-spline-gen"))
        if not os.path.exists(source_addin_dir):
            source_addin_dir = os.path.normpath(os.path.join(workspace_dir, "..", "b-spline-generator-web-addin"))

        shutil.copytree(source_addin_dir, fusion_addin_dest)
        print("Local add-in refreshed.")
    except Exception as e:
        print(f"Warning: Could not refresh local add-in: {e}")
elif fusion_addin_dest:
    print(f"Fusion 360 Add-Ins directory not found at {os.path.dirname(fusion_addin_dest)}. Skipping local refresh.")
else:
    print(f"Unsupported OS ({sys.platform}) for local Fusion 360 refresh.")

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


# 4. Upload distribution ZIP to the GitHub `latest` release so the website's
# download button (ADDIN_RELEASE_URL in main/main.js) gets the freshest bits.
GH_CMD = shutil.which("gh") or shutil.which("gh.cmd")
if GH_CMD is None:
    print("Warning: 'gh' CLI not found on PATH. Skipping GitHub release upload.")
    print(f"         To publish the zip manually, run:")
    print(f"         gh release upload latest \"{zip_target}\" --clobber")
    sys.exit(0)

print("Uploading distribution ZIP to GitHub release 'latest'...")

# Make sure a 'latest' release exists; create it as a prerelease if not.
view_check = subprocess.run([GH_CMD, "release", "view", "latest"],
                            cwd=workspace_dir, capture_output=True)
if view_check.returncode != 0:
    print("  No 'latest' release found — creating it as a prerelease.")
    create = subprocess.run([
        GH_CMD, "release", "create", "latest",
        "--prerelease",
        "--title", "Latest dev build",
        "--notes", "Rolling release: the most recent bspline-frame-builder build. Overwritten on every Cloudflare deploy.",
    ], cwd=workspace_dir)
    if create.returncode != 0:
        print(f"  Warning: could not create 'latest' release (exit {create.returncode}). Skipping upload.")
        sys.exit(0)

upload = subprocess.run([
    GH_CMD, "release", "upload", "latest", zip_target, "--clobber"
], cwd=workspace_dir)
if upload.returncode == 0:
    print("  GitHub release 'latest' updated with new bspline-frame-builder.zip.")
else:
    print(f"  Warning: gh release upload exited {upload.returncode}.")
    print(f"           To publish the zip manually, run:")
    print(f"           gh release upload latest \"{zip_target}\" --clobber")

sys.exit(0)
