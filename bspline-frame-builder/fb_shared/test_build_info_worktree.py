"""
H23 item 93: a deploy from a linked git WORKTREE showed "could not resolve source HEAD" (seat A, 2026-10-06). The
worktree's .git is a FILE pointing at <repo>/.git/worktrees/<name>; that gitdir holds HEAD ("ref: refs/heads/x") but
the branch refs and packed-refs live in the COMMON dir its `commondir` file names. compare_to_source must read them
there. Synthetic layouts, the same files git writes.

Run with:
    cd bspline-frame-builder
    python -m pytest fb_shared/test_build_info_worktree.py
"""
import os
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

from fb_shared.build_info import compare_to_source  # noqa: E402

SHA = 'c269381' + 'a' * 33


def _write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def _repo(tmp, branch='mode-detect-92', packed=False):
    """<tmp>/main: the main checkout's .git; returns its .git dir."""
    git = os.path.join(tmp, 'main', '.git')
    _write(os.path.join(git, 'HEAD'), 'ref: refs/heads/main\n')
    if packed:
        _write(os.path.join(git, 'packed-refs'), f'# pack-refs with: peeled fully-peeled sorted\n{SHA} refs/heads/{branch}\n')
    else:
        _write(os.path.join(git, 'refs', 'heads', branch), SHA + '\n')
    return git


def _worktree(tmp, git, head):
    """<tmp>/wt: a linked worktree (.git FILE -> <git>/worktrees/wt, which has HEAD + commondir)."""
    wt_git = os.path.join(git, 'worktrees', 'wt')
    _write(os.path.join(wt_git, 'HEAD'), head + '\n')
    _write(os.path.join(wt_git, 'commondir'), '../..\n')
    wt = os.path.join(tmp, 'wt')
    _write(os.path.join(wt, '.git'), f'gitdir: {wt_git}\n')
    return wt


def _info(root):
    return {'sha': SHA[:7], 'branch': 'mode-detect-92', 'dirty': False, 'source_root': root}


def test_worktree_on_a_branch_resolves_head_from_the_common_dir(tmp_path):
    git = _repo(str(tmp_path))
    wt = _worktree(str(tmp_path), git, 'ref: refs/heads/mode-detect-92')
    assert compare_to_source(_info(wt))[0] == 'ok'


def test_worktree_branch_only_in_the_common_packed_refs(tmp_path):
    git = _repo(str(tmp_path), packed=True)
    wt = _worktree(str(tmp_path), git, 'ref: refs/heads/mode-detect-92')
    assert compare_to_source(_info(wt))[0] == 'ok'


def test_worktree_on_a_moved_branch_reads_stale_not_unknown(tmp_path):
    git = _repo(str(tmp_path))
    wt = _worktree(str(tmp_path), git, 'ref: refs/heads/mode-detect-92')
    info = dict(_info(wt), sha='f6536fc')
    status, msg = compare_to_source(info)
    assert status == 'stale' and SHA[:7] in msg


def test_detached_worktree_still_resolves(tmp_path):
    git = _repo(str(tmp_path))
    wt = _worktree(str(tmp_path), git, SHA)
    assert compare_to_source(_info(wt))[0] == 'ok'


def test_main_checkout_still_resolves(tmp_path):
    git = _repo(str(tmp_path), branch='main')
    assert compare_to_source(dict(_info(os.path.join(str(tmp_path), 'main')), branch='main'))[0] == 'ok'
