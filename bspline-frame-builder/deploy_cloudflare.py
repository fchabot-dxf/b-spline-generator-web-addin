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
import json
import urllib.request
import urllib.error
import urllib.parse
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

# GitHub release support is enabled automatically when credentials are available.
# Use --no-release to skip the GitHub release step if needed.
# If GITHUB_RELEASE_TAG is not set, the script will default to `latest`.
ENABLE_GITHUB_RELEASE = "--no-release" not in sys.argv
GITHUB_REPO = os.environ.get("GITHUB_REPO")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
GITHUB_RELEASE_TAG = os.environ.get("GITHUB_RELEASE_TAG")
GITHUB_RELEASE_NAME = os.environ.get("GITHUB_RELEASE_NAME")
GITHUB_RELEASE_BODY = os.environ.get("GITHUB_RELEASE_BODY", "")

workspace_dir = os.path.dirname(__file__) or "."
source_dir    = os.path.join(workspace_dir, "b-spline-gen", "html")

# Create a unique deployment folder to bypass file locks on Google Drive/Windows
timestamp     = datetime.now().strftime("%Y-%m-%d")
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


# Copy all web-related files recursively from source_dir.
# This ensures nested folders like core/ are deployed, not just top-level files.
web_extensions = (
    '.html', '.js', '.mjs', '.css', '.svg', '.png', '.jpg', '.jpeg', '.ico',
    '.json', '.webp', '.woff', '.woff2', '.ttf'
)
for root, dirs, files in os.walk(source_dir):
    # Skip hidden and irrelevant directories
    dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('.git', '__pycache__', 'node_modules')]
    rel_dir = os.path.relpath(root, source_dir)
    dest_dir = deploy_dist if rel_dir == '.' else os.path.join(deploy_dist, rel_dir)
    os.makedirs(dest_dir, exist_ok=True)
    for filename in files:
        if filename.lower().endswith(web_extensions):
            src_path = os.path.join(root, filename)
            dst_path = os.path.join(dest_dir, filename)
            shutil.copy2(src_path, dst_path)

# Ensure the entire themes/ folder is copied
themes_src = os.path.join(source_dir, 'themes')
themes_dst = os.path.join(deploy_dist, 'themes')
if os.path.exists(themes_src):
    shutil.copytree(themes_src, themes_dst, dirs_exist_ok=True)

# Ensure the local fonts/ folder is copied for hosted deployments
fonts_src = os.path.join(source_dir, 'fonts')
fonts_dst = os.path.join(deploy_dist, 'fonts')
if os.path.exists(fonts_src):
    shutil.copytree(fonts_src, fonts_dst, dirs_exist_ok=True)

# Ensure no ZIP artifact is accidentally included in the Pages publish folder
for root, _, files in os.walk(deploy_dist):
    for filename in files:
        if filename.lower().endswith('.zip'):
            zip_path = os.path.join(root, filename)
            print(f"Removing stray ZIP from deploy folder: {zip_path}")
            os.remove(zip_path)

# 2. Bundle the clean bspline-frame-builder add-in ZIP (Distribution Version)
print(f"Bundling clean distribution ZIP to {deploy_dist}...")
zip_target = os.path.join(workspace_dir, f"bspline-frame-builder-{timestamp}.zip")

def should_skip(name):
    skip_names = {".git", ".gitignore", "__pycache__", ".venv", "venv", "node_modules", ".wrangler", "desktop.ini"}
    skip_exts  = {".log", ".old", ".pyc", ".zip"} # Skip log files and PREVIOUS zips!
    if name in skip_names or os.path.splitext(name)[1].lower() in skip_exts:
        return True
    return False


def github_api_request(method, url, token, body=None, headers=None):
    req_headers = {
        'Authorization': f'token {token}',
        'Accept': 'application/vnd.github+json',
    }
    if headers:
        req_headers.update(headers)
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        req_headers['Content-Type'] = 'application/json'

    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status in (200, 201):
                payload = resp.read()
                return json.loads(payload.decode('utf-8')) if payload else {}
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f'GitHub API request failed: {exc.code} {exc.reason} {exc.read().decode("utf-8")}')


def get_github_repo_from_remote(path):
    try:
        url = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], cwd=path, text=True).strip()
    except Exception:
        return None
    if url.endswith('.git'):
        url = url[:-4]
    if url.startswith('git@github.com:'):
        url = url.replace('git@github.com:', 'https://github.com/')
    if url.startswith('https://github.com/'):
        return url.split('https://github.com/')[-1].strip('/')
    return None


def find_release_by_tag(repo, tag_name, token):
    try:
        return github_api_request('GET', f'https://api.github.com/repos/{repo}/releases/tags/{tag_name}', token)
    except RuntimeError as exc:
        if '404' in str(exc):
            return None
        raise


def create_github_release(repo, tag_name, name, body, draft, prerelease, token):
    payload = {
        'tag_name': tag_name,
        'name': name,
        'body': body,
        'draft': draft,
        'prerelease': prerelease,
    }
    return github_api_request('POST', f'https://api.github.com/repos/{repo}/releases', token, payload)


def delete_existing_asset(release, asset_name, token):
    for asset in release.get('assets', []):
        if asset.get('name') == asset_name:
            github_api_request('DELETE', asset['url'], token)
            return


def upload_github_asset(release, asset_path, token):
    upload_url = release['upload_url'].split('{')[0]
    asset_name = os.path.basename(asset_path)
    delete_existing_asset(release, asset_name, token)

    with open(asset_path, 'rb') as asset_file:
        data = asset_file.read()

    url = f"{upload_url}?name={urllib.parse.quote(asset_name)}"
    headers = {
        'Content-Type': 'application/zip',
        'Content-Length': str(len(data)),
    }
    req = urllib.request.Request(url, data=data, headers={**headers, 'Authorization': f'token {token}', 'Accept': 'application/vnd.github+json'}, method='POST')
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f'GitHub asset upload failed: {exc.code} {exc.reason} {exc.read().decode("utf-8")}')

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

if result.returncode == 0:
    print("Deployment complete.")
    if ENABLE_GITHUB_RELEASE:
        if not GITHUB_REPO:
            GITHUB_REPO = get_github_repo_from_remote(workspace_dir)
        if not GITHUB_TOKEN or not GITHUB_REPO:
            print("Skipping GitHub release because GITHUB_REPO or GITHUB_TOKEN/GH_TOKEN is missing.")
        else:
            if not GITHUB_RELEASE_TAG:
                GITHUB_RELEASE_TAG = 'latest'
            if not GITHUB_RELEASE_NAME:
                if GITHUB_RELEASE_TAG == 'latest':
                    GITHUB_RELEASE_NAME = 'Latest Release'
                else:
                    GITHUB_RELEASE_NAME = f"Release {GITHUB_RELEASE_TAG}"
            print(f"Creating or updating GitHub release {GITHUB_REPO}@{GITHUB_RELEASE_TAG}...")
            release = find_release_by_tag(GITHUB_REPO, GITHUB_RELEASE_TAG, GITHUB_TOKEN)
            if release is None:
                release = create_github_release(
                    GITHUB_REPO,
                    GITHUB_RELEASE_TAG,
                    GITHUB_RELEASE_NAME,
                    GITHUB_RELEASE_BODY,
                    draft=False,
                    prerelease=False,
                    token=GITHUB_TOKEN
                )
                print(f"Created release: {release.get('html_url')}")
            else:
                print(f"Using existing release: {release.get('html_url')}")
            upload_github_asset(release, zip_target, GITHUB_TOKEN)
            print(f"Uploaded asset to GitHub release: {os.path.basename(zip_target)}")
    clean_dir(deploy_dist)
    sys.exit(0)

print(f"Deployment failed (exit code {result.returncode}).")
clean_dir(deploy_dist)
sys.exit(result.returncode)
