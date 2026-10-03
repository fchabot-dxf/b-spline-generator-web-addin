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
touching any phases/*.py file against the latest commit touching any of that template's golden
fixtures. Phases newer than goldens -> STALE. Uncommitted changes under phases/ are also STALE
(an edit not yet re-verified against the goldens is exactly the risk this check exists for) --
git has no ordering for uncommitted work, so this is a committer-date-free, conservative check
of its own: any dirty file under phases/ marks that template stale regardless of history.
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
    """Returns (status, detail) -- status one of 'FRESH', 'STALE', 'UNCOMMITTED'."""
    if _has_uncommitted_changes(phase_files):
        return "UNCOMMITTED", "phases/*.py has uncommitted changes -- re-record goldens before trusting them"
    phases_latest = _latest_committer_date(phase_files)
    goldens_latest = _latest_committer_date(golden_files)
    if phases_latest is None or goldens_latest is None:
        return "UNCOMMITTED", "phases or goldens are not yet committed"
    p_ts, p_sha = phases_latest
    g_ts, g_sha = goldens_latest
    if freshness_status(p_ts, g_ts) == "STALE":
        return "STALE", f"phases last touched {p_sha} is newer than goldens last touched {g_sha}"
    return "FRESH", f"goldens {g_sha} cover phases through {p_sha}"


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
