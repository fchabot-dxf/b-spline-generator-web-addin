"""
check_golden_freshness.py — H23 item 20: flag any template whose phases/*.py changed more
recently (in git history) than its own recorded Fusion golden fixtures.

    python tools/check_golden_freshness.py            # report every template's status
    python tools/check_golden_freshness.py --check     # exit 1 if any template is STALE

gen_frame_defs.py --check only validates the GENERATED frame-defs.json against the COMMITTED
goldens (tests/fixtures/frame-parity/*.json) -- it says nothing about whether those goldens
themselves still describe what the CURRENT phases/*.py would build live in Fusion. A phase edit
after the last golden recording leaves a stale "pass" everywhere else in the pipeline: nothing
else in the suite can catch it, since the goldens ARE the ground truth every other check is fit
or compared against. MEASURED (H23 item 19): template_10's goldens sat stale through 3 real fix
iterations (items 14, 15, 17) before a live build finally caught the drift by hand -- this check
should have caught it immediately after the first of those commits landed.

For each template directory under bspline-frame-builder/frame-builder/sketches/ that has BOTH a
phases/ folder and at least one committed golden fixture (tests/fixtures/frame-parity/
template_N_*.json -- a template with no recorded goldens, e.g. one verified by a different
process, is out of this check's scope entirely), compares the COMMITTER DATE of the latest commit
touching any phases/*.py file against EACH of that template's own golden fixture files
INDIVIDUALLY (not the glob's own latest). Phases newer than a given golden file -> that file is
STALE, and the whole template reports STALE. Uncommitted changes under phases/ are also STALE
(an edit not yet re-verified against the goldens is exactly the risk this check exists for) --
git has no ordering for uncommitted work, so this is a committer-date-free, conservative check
of its own: any dirty file under phases/ marks that template stale regardless of history.

F33 item 1 (2026-10-03): the per-FILE comparison above replaced an earlier per-TEMPLATE one that
took the latest commit date across ALL of a template's own golden files as a single aggregate --
MEASURED to be a real gap, not a hypothetical one: re-recording only 2 of template_13's own 3
golden sizes (after b5's own corner fix, 0c480ee) made the aggregate's own "latest" jump to the
re-recording's date, so the WHOLE template reported FRESH even though its own third file
(5.51x1.97) still silently described pre-fix geometry nobody could currently reproduce live. A
template with several recorded sizes can go stale ONE FILE AT A TIME; the check now catches that.
_KNOWN_UNVERIFIABLE_GOLDENS below is this check's OWN version of
test_frame_parity_goldens.py's own `_DEGENERATE`/`_KNOWN_BROKEN_BUILD` declared-exception pattern:
a genuinely unbuildable size (Fred's app is portrait-only; this one's a live REFLEX ARC, unrelated
to any fixable-here phase edit -- see WORK-LOG-fb-app.md's own F33 item 1 addendum) would otherwise
block this gate forever on a gap nobody is actively fixing. Declared, not silently skipped.
"""
import glob
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
SKETCHES_DIR = os.path.join(REPO, "bspline-frame-builder", "frame-builder", "sketches")
GOLDENS_DIR = os.path.join(REPO, "tests", "fixtures", "frame-parity")
_TEMPLATE_DIR_RE = re.compile(r"^template_(\d+)$")

# F33 item 1 (2026-10-03, WORK-LOG-fb-app.md): a declared, accepted gap -- NOT silently skipped.
# template_13's own 5.51x1.97 golden describes geometry recorded before this file's own phases
# last changed, and the CURRENT phases hit a live REFLEX ARC at that one size (confirmed to
# reproduce on the commit BEFORE b5's own corner fix, 0c480ee, too -- a pre-existing gap, not a
# regression from it). Fred's app is portrait-only; this size is this project's own established
# tiny-board stress test (test_frame_parity_goldens.py's own _SIZES), not something the app ever
# sends. Remove an entry here only once that template genuinely builds live at that size again.
_KNOWN_UNVERIFIABLE_GOLDENS = {
    # template_13's own 5.51x1.97 hits a live REFLEX ARC in its own tangent-chain arcs --
    # confirmed to reproduce on the commit BEFORE b5's own corner fix (0c480ee) too, so a pre-
    # existing gap, not a regression. Fred's app is portrait-only; this is the project's own tiny-
    # board stress size (test_frame_parity_goldens.py's own _SIZES), not something the app ever
    # sends. See WORK-LOG-fb-app.md's own F33 item 1 addendum.
    "template_13_5.51x1.97.json",
    # H23 item 13 (pre-existing, Fred: "ship it"): template_10's own 12x6 has never built a correct
    # shape live (sketch 3/frame enclosure fails to form at all there, a Template 1 limitation T10
    # inherits) -- there is no correct shape to re-record, so its golden stays the item-13-era
    # recording forever; test_frame_parity_goldens.py's own _KNOWN_BROKEN_BUILD already names this
    # exact file.
    "template_10_12x6.json",
}


def _git(*args):
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, check=True).stdout


def _latest_committer_date(paths):
    """The newest commit touching any of `paths` -> (unix timestamp, short sha), or None if none
    of them have ever been committed."""
    existing = [p for p in paths if os.path.exists(p)]
    if not existing:
        return None
    out = _git("log", "-1", "--format=%ct %h", "--", *existing).strip()
    return None if not out else (int(out.split()[0]), out.split()[1])


def _has_uncommitted_changes(paths):
    existing = [p for p in paths if os.path.exists(p)]
    if not existing:
        return False
    return bool(_git("status", "--porcelain", "--", *existing).strip())


def discover_templates():
    """{template_id: {'phases': [...], 'goldens': [...]}} for every template with BOTH."""
    out = {}
    for name in sorted(os.listdir(SKETCHES_DIR)):
        if not _TEMPLATE_DIR_RE.match(name):
            continue
        phases_dir = os.path.join(SKETCHES_DIR, name, "phases")
        phase_files = sorted(glob.glob(os.path.join(phases_dir, "*.py")))
        golden_files = sorted(glob.glob(os.path.join(GOLDENS_DIR, f"{name}_*.json")))
        if phase_files and golden_files:
            out[name] = {"phases": phase_files, "goldens": golden_files}
    return out


def freshness_status(phases_ts, goldens_ts):
    """Pure: the one comparison this whole check exists to make. STALE when the phases' own
    latest commit timestamp is after the goldens' -- "the phase files moved more recently than
    the golden" (H23 item 20's own dispatch wording), a plain timestamp comparison, not git
    ancestry (unrelated/diverged history would make ancestry ambiguous; committer date isn't)."""
    return "STALE" if phases_ts > goldens_ts else "FRESH"


def check_template(phase_files, golden_files):
    """Returns (status, detail) -- status one of 'FRESH', 'STALE', 'UNCOMMITTED'. Compares the
    phases' own latest commit against EACH golden file INDIVIDUALLY (not the glob's own latest --
    see this module's own docstring for the gap a single aggregate comparison left open), skipping
    any file declared in `_KNOWN_UNVERIFIABLE_GOLDENS`."""
    if _has_uncommitted_changes(phase_files):
        return "UNCOMMITTED", "phases/*.py has uncommitted changes -- re-record goldens before trusting them"
    phases_latest = _latest_committer_date(phase_files)
    if phases_latest is None:
        return "UNCOMMITTED", "phases are not yet committed"
    p_ts, p_sha = phases_latest

    checked = [g for g in golden_files if os.path.basename(g) not in _KNOWN_UNVERIFIABLE_GOLDENS]
    excluded = [os.path.basename(g) for g in golden_files if os.path.basename(g) in _KNOWN_UNVERIFIABLE_GOLDENS]
    if not checked:
        return "UNCOMMITTED", "every golden for this template is declared unverifiable"

    stale, uncommitted = [], []
    for g in checked:
        g_date = _latest_committer_date([g])
        if g_date is None:
            uncommitted.append(os.path.basename(g))
            continue
        g_ts, g_sha = g_date
        if freshness_status(p_ts, g_ts) == "STALE":
            stale.append(f"{os.path.basename(g)} ({g_sha})")

    excl_note = f" [excluded: {', '.join(excluded)}]" if excluded else ""
    if uncommitted:
        return "UNCOMMITTED", f"not yet committed: {', '.join(uncommitted)}{excl_note}"
    if stale:
        return "STALE", f"phases last touched {p_sha} is newer than: {', '.join(stale)}{excl_note}"
    return "FRESH", f"phases {p_sha} covered by all {len(checked)} checked golden file(s){excl_note}"


def main(argv):
    templates = discover_templates()
    stale = []
    for tid, paths in templates.items():
        status, detail = check_template(paths["phases"], paths["goldens"])
        print(f"{tid}: {status} -- {detail}")
        if status != "FRESH":
            stale.append(tid)
    if "--check" in argv:
        if stale:
            print(f"\nSTALE/UNCOMMITTED goldens: {stale} -- re-record with "
                  f"tools/repro/record_frame_parity.py, then gen_frame_defs.py")
            return 1
        print("\nall golden fixtures are fresh")
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
