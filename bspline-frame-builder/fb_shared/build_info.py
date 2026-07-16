"""
fb_shared.build_info — the ONE shared read path for the deployed version stamp.

The deploy writes ``build-info.json`` into the add-in root (DEST-only artifact;
see DEPLOY_bspline-frame-builder.py::_write_build_info and VERSION-STAMP-DESIGN.md).
Every palette's Python reads it through here instead of hand-rolling git/file
reads in 8 places:

    from fb_shared.build_info import read_build_info, compare_to_source
    info = read_build_info(_addin_root)          # {sha,branch,built_at,source_root,dirty}
    status, msg = compare_to_source(info)         # ('ok'|'stale'|'unknown', text)

Pure stdlib (json/os/pathlib) — no adsk, no git binary — so it imports and unit-
tests headlessly. Neither function ever raises: a version stamp must not take a
palette down.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

# Shape every caller can rely on, and what an absent/unreadable file degrades to.
SENTINEL = {
    "sha": "unknown",
    "branch": "unknown",
    "built_at": "unknown",
    "source_root": "",
    "dirty": False,
}


def read_build_info(addin_root) -> dict:
    """Return ``{sha,branch,built_at,source_root,dirty}`` from
    ``<addin_root>/build-info.json``.

    Missing/unreadable/malformed file -> a copy of :data:`SENTINEL` (sha
    'unknown'). Missing keys are backfilled from the sentinel so callers always
    get the full shape. Never raises.
    """
    try:
        p = Path(addin_root) / "build-info.json"
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return dict(SENTINEL)
        return {**SENTINEL, **data}
    except Exception:
        return dict(SENTINEL)


def _resolve_git_dir(source_root: str):
    """Return the ``.git`` directory Path under ``source_root`` (expanding ``~``),
    following a ``gitdir:`` pointer file (worktree/submodule), or ``None`` if it
    can't be found/read."""
    if not source_root:
        return None
    src = Path(os.path.expanduser(source_root))
    git = src / ".git"
    if git.is_dir():
        return git
    # A linked worktree/submodule uses a ".git" FILE: "gitdir: <path>".
    if git.is_file():
        try:
            line = git.read_text(encoding="utf-8").strip()
        except Exception:
            return None
        if line.startswith("gitdir:"):
            target = Path(line.split(":", 1)[1].strip())
            if not target.is_absolute():
                target = (src / target).resolve()
            return target if target.exists() else None
    return None


def _read_head_sha(git_dir: Path):
    """Resolve ``<git_dir>/HEAD`` to a full SHA via pure file reads (no git
    binary). Handles symbolic HEAD (loose ref, then packed-refs) and a detached
    HEAD (a raw SHA in the HEAD file). Returns the SHA string or ``None``."""
    try:
        head = (git_dir / "HEAD").read_text(encoding="utf-8").strip()
    except Exception:
        return None
    if head.startswith("ref:"):
        ref = head[4:].strip()                    # e.g. "refs/heads/main"
        try:                                       # loose ref wins if present
            loose = (git_dir / ref).read_text(encoding="utf-8").strip()
            if loose:
                return loose
        except Exception:
            pass
        try:                                       # packed-refs fallback
            for line in (git_dir / "packed-refs").read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith(("#", "^")):
                    continue
                sha, _, name = line.partition(" ")
                if name == ref:
                    return sha
        except Exception:
            pass
        return None
    return head or None                            # detached: HEAD is the SHA


def compare_to_source(info: dict) -> tuple:
    """Compare a deployed ``build-info`` dict to the CURRENT source-tree HEAD and
    return ``(status, message)`` where ``status`` is one of:

      * ``'ok'``      — deployed SHA is the source HEAD **and** the tree was clean.
      * ``'stale'``   — deployed SHA differs from source HEAD, OR it was deployed
                        from a dirty tree (uncommitted tracked changes).
      * ``'unknown'`` — can't tell: no build info, no ``source_root``, no source
                        ``.git`` (e.g. not the dev machine), or HEAD unresolvable.

    Pure file reads of ``source_root/.git`` — NO git binary. Never raises.

    Caveats (by design): the SHA check compares deployed vs the last COMMIT, not
    against uncommitted edits made AFTER the deploy; the ``dirty`` flag covers
    uncommitted edits present AT deploy time only. Dev-machine-only — degrades to
    ``'unknown'`` when the source repo isn't reachable.
    """
    info = info or {}
    sha = str(info.get("sha", "unknown") or "unknown")
    if sha == "unknown":
        return ("unknown", "no build info (deployed before the version stamp, or git absent at deploy)")

    git_dir = _resolve_git_dir(str(info.get("source_root", "")))
    if git_dir is None:
        return ("unknown", "source repo not reachable (not the dev machine?)")

    head_sha = _read_head_sha(git_dir)
    if not head_sha:
        return ("unknown", "could not resolve source HEAD")

    branch  = info.get("branch", "?")
    dirty   = bool(info.get("dirty", False))
    matches = head_sha.lower().startswith(sha.lower())   # deployed short SHA is a prefix of full HEAD

    if matches and not dirty:
        return ("ok", f"up to date ({branch} {sha})")
    if matches and dirty:
        return ("stale", f"deployed from a DIRTY tree ({branch} {sha}) — uncommitted changes at deploy time")
    return ("stale", f"STALE — deployed {sha}, source {branch} HEAD is now {head_sha[:7]}")
