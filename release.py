#!/usr/bin/env python3
"""
release.py — local release orchestrator for bspline-frame-builder.

Usage:
    python release.py                       # Claude CLI auto-generates a commit message from the diff
    python release.py "commit message"      # explicit override

Steps:
  1. Build the Fusion add-in distribution ZIP (bspline-frame-builder.zip)
  2. git add -A; (auto-generate message if none given); commit; push
       (Cloudflare Pages auto-rebuilds the web app on push to main)
  3. gh release upload latest <zip> --clobber
       (updates the website's download button source)
  4. Refresh local Fusion 360 AddIns folder
       (developer convenience; best-effort)

Auto-generated commit messages shell out to the `claude` CLI (Claude Code)
in print mode. No API key needed — uses your existing Claude Code auth.
If the CLI is missing or the call fails, the script prompts interactively.
"""

import os
import stat
import shutil
import subprocess
import sys
import zipfile

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
ADDIN_ROOT = os.path.join(REPO_ROOT, "bspline-frame-builder")
ZIP_TARGET = os.path.join(ADDIN_ROOT, "bspline-frame-builder.zip")
PAGES_URL = "https://bspline-generator.pages.dev"

zip_summary = "(not built)"
commit_summary = "(skipped)"
commit_message_summary = "(none)"
push_summary = "(skipped)"
release_summary = "(skipped)"
fusion_summary = "(skipped)"

commit_message = sys.argv[1].strip() if len(sys.argv) >= 2 else ""


def _generate_commit_message_via_claude_cli():
    """Shell out to `claude -p` with the staged diff. Returns the message, or None on failure."""
    claude_cmd = shutil.which("claude") or shutil.which("claude.cmd")
    if not claude_cmd:
        print("      Note: `claude` CLI not on PATH; skipping AI message generation.")
        return None

    diff = subprocess.run(
        ["git", "diff", "--cached", "--no-color"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=True,
    ).stdout
    if not diff.strip():
        return None

    MAX_DIFF_CHARS = 50000
    if len(diff) > MAX_DIFF_CHARS:
        diff = diff[:MAX_DIFF_CHARS] + "\n[... diff truncated]"

    prompt = (
        "Write a single-line git commit message for the following diff. "
        "Use conventional commit style (e.g. 'fix:', 'feat:', 'docs:', 'refactor:', 'chore:'). "
        "Keep it under 72 characters. "
        "Output ONLY the message itself — no quotes, no explanation, no markdown.\n\n"
        f"```diff\n{diff}\n```"
    )

    print("      Asking `claude` for a commit message (may take 3-5s)...")
    try:
        result = subprocess.run(
            [claude_cmd, "-p", prompt],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=120,
        )
    except subprocess.TimeoutExpired:
        print("      Claude CLI timed out.")
        return None
    except Exception as e:
        print(f"      Claude CLI invocation failed: {e}")
        return None

    if result.returncode != 0:
        print(f"      Claude CLI exited {result.returncode}: {result.stderr.strip()[:200]}")
        return None

    msg = result.stdout.strip()
    # Strip wrapping quotes/backticks the model might add despite the prompt.
    for ch in ('"', "'", "`"):
        if msg.startswith(ch) and msg.endswith(ch):
            msg = msg[1:-1].strip()
    msg = msg.split("\n")[0].strip()
    return msg or None


def _generate_fallback_message_from_diff():
    """Compose a commit message from the list of staged file basenames."""
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=True,
    )
    files = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not files:
        return None
    basenames = [os.path.basename(f) for f in files]
    msg = "update: " + ", ".join(basenames)
    if len(msg) > 120:
        msg = msg[:117] + "..."
    return msg


# ----- step 1: build the distribution zip --------------------------------
# Mirrors the zip-build section of bspline-frame-builder/deploy_cloudflare.py.
ZIP_SKIP_NAMES = {".git", ".gitignore", "__pycache__", ".venv", "venv",
                  "node_modules", ".wrangler", "desktop.ini"}
ZIP_SKIP_EXTS = {".log", ".old", ".pyc", ".zip"}

def _zip_should_skip(name):
    if name in ZIP_SKIP_NAMES:
        return True
    if os.path.splitext(name)[1].lower() in ZIP_SKIP_EXTS:
        return True
    if name.startswith('.'):
        return True
    return False

print(f"[1/4] Building distribution ZIP at {ZIP_TARGET}...")
if os.path.exists(ZIP_TARGET):
    os.remove(ZIP_TARGET)
addin_root_name = os.path.basename(os.path.normpath(ADDIN_ROOT))
zip_file_count = 0
with zipfile.ZipFile(ZIP_TARGET, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(ADDIN_ROOT):
        dirs[:] = [d for d in dirs
                   if not _zip_should_skip(d)
                   and d != "dist"
                   and d != "deploy_dist"
                   and not d.startswith("deploy_dist_")]
        for f in files:
            if _zip_should_skip(f):
                continue
            abs_path = os.path.join(root, f)
            rel_inside = os.path.relpath(abs_path, ADDIN_ROOT)
            arc_path = os.path.join(addin_root_name, rel_inside)
            zf.write(abs_path, arc_path)
            zip_file_count += 1
zip_size_mb = os.path.getsize(ZIP_TARGET) / (1024 * 1024)
zip_summary = f"{zip_file_count} files, {zip_size_mb:.1f} MiB"
print(f"      Packed {zip_file_count} files -> {os.path.basename(ZIP_TARGET)} ({zip_size_mb:.1f} MiB)")


# ----- step 2: git add -A, commit, push ----------------------------------
print(f"\n[2/4] Committing and pushing...")
subprocess.run(["git", "add", "-A"], cwd=REPO_ROOT, check=True)

status = subprocess.run(["git", "status", "--porcelain"], cwd=REPO_ROOT,
                        capture_output=True, text=True, check=True)
if status.stdout.strip():
    if not commit_message:
        commit_message = _generate_commit_message_via_claude_cli()
        if commit_message:
            print(f"      Generated by Claude: {commit_message}")
        else:
            commit_message = _generate_fallback_message_from_diff()
            if commit_message:
                print(f"      Fallback (file list): {commit_message}")
            else:
                try:
                    commit_message = input("      Enter commit message: ").strip()
                except (EOFError, KeyboardInterrupt):
                    commit_message = ""
                if not commit_message:
                    print("      No message provided; aborting.")
                    sys.exit(1)

    commit = subprocess.run(["git", "commit", "-m", commit_message], cwd=REPO_ROOT)
    if commit.returncode != 0:
        print(f"      git commit failed (exit {commit.returncode}). Aborting.")
        sys.exit(commit.returncode)
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT,
                         capture_output=True, text=True).stdout.strip()
    commit_summary = sha
    commit_message_summary = commit_message
else:
    print("      No staged changes; skipping commit.")
    commit_summary = "(no-op, nothing to commit)"
    commit_message_summary = "(none)"

push = subprocess.run(["git", "push"], cwd=REPO_ROOT)
if push.returncode != 0:
    print(f"      git push failed (exit {push.returncode}). Aborting.")
    sys.exit(push.returncode)
branch = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=REPO_ROOT,
                        capture_output=True, text=True).stdout.strip()
push_summary = f"{branch} -> origin/{branch}"
print("      Pushed. Cloudflare Pages will auto-rebuild the web app.")


# ----- step 3: upload zip to GitHub release ------------------------------
print(f"\n[3/4] Uploading distribution ZIP to GitHub release 'latest'...")
GH_CMD = shutil.which("gh") or shutil.which("gh.cmd")
if GH_CMD is None:
    print("      Warning: 'gh' CLI not found. Skipping.")
    print(f"      Run manually: gh release upload latest \"{ZIP_TARGET}\" --clobber")
    release_summary = "skipped (gh not installed)"
else:
    view_check = subprocess.run([GH_CMD, "release", "view", "latest"],
                                cwd=REPO_ROOT, capture_output=True)
    if view_check.returncode != 0:
        print("      No 'latest' release found — creating it as a prerelease.")
        create = subprocess.run([
            GH_CMD, "release", "create", "latest", "--prerelease",
            "--title", "Latest dev build",
            "--notes", "Rolling release: the most recent bspline-frame-builder build.",
        ], cwd=REPO_ROOT)
        if create.returncode != 0:
            print(f"      Warning: could not create 'latest' release (exit {create.returncode}).")
    upload = subprocess.run([
        GH_CMD, "release", "upload", "latest", ZIP_TARGET, "--clobber"
    ], cwd=REPO_ROOT)
    if upload.returncode == 0:
        print("      GitHub release 'latest' updated.")
        release_summary = "uploaded to 'latest'"
    else:
        print(f"      Warning: gh release upload exited {upload.returncode}.")
        print(f"      Run manually: gh release upload latest \"{ZIP_TARGET}\" --clobber")
        release_summary = f"failed (exit {upload.returncode})"


# ----- step 4: refresh local Fusion 360 AddIns folder --------------------
# Deploy EVERY add-in in the suite by delegating to the canonical local
# installer, DEPLOY_bspline-frame-builder.py. Its `all` target runs
# deploy_local(), which mirrors the whole bspline-frame-builder tree into
# AddIns\bspline-frame-builder. That single bundle contains the main
# add-in PLUS every sub-add-in (CAM-builder, frame-inspector,
# fusion-exporter, stamp-editor, template-maker, b-spline-gen), so this one
# call updates them all — not just bspline + CAM Builder.
#
# Reusing that script keeps a single source of truth for the ignore rules,
# locked-file (overlay-copy) tolerance, and the dev-workspace handshake
# files, instead of duplicating that logic here.
print(f"\n[4/4] Refreshing local Fusion 360 add-ins...")

_deploy_script = os.path.join(ADDIN_ROOT, "DEPLOY_bspline-frame-builder.py")
if not os.path.exists(_deploy_script):
    print(f"      Deploy script not found at {_deploy_script}; skipping.")
    fusion_summary = "skipped (DEPLOY_bspline-frame-builder.py not found)"
else:
    try:
        # Stream the installer's own output live so a locked file or a
        # missing sub-add-in is visible right here in the release run.
        result = subprocess.run(
            [sys.executable, _deploy_script, "all"],
            cwd=ADDIN_ROOT,
        )
        if result.returncode == 0:
            fusion_summary = "deployed all add-ins (DEPLOY_bspline-frame-builder.py all)"
        else:
            print(f"      Deploy script exited with code {result.returncode}.")
            fusion_summary = f"failed (deploy script exit {result.returncode})"
    except Exception as e:
        print(f"      Warning: could not run deploy script: {e}")
        fusion_summary = f"failed ({e})"


# ----- summary ----------------------------------------------------------
print()
print("=" * 64)
print("  Release Summary")
print("=" * 64)
print(f"  Commit:     {commit_summary}")
print(f"  Message:    {commit_message_summary}")
print(f"  Push:       {push_summary}")
print(f"  Zip:        {zip_summary}")
print(f"  Web app:    {PAGES_URL}  (Cloudflare rebuilds on push)")
print(f"  GH release: {release_summary}")
print(f"  Fusion:     {fusion_summary}")
print("=" * 64)
