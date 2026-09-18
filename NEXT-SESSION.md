# LANE B — T3: reconcile BUGS_OPEN.md against what actually shipped (docs only)

**Seat B · epoch 1 · T3.** Worktree `b-spline-generator-web-addin-lane-b`, branch `lane-b` (merged with main just now).
File: `BUGS_OPEN.md` only (+ WORK-LOG-lane-b.md). One commit by path. No product code.

## Why
The audit series (A1–A7) and yesterday's fix cycle closed most of B1–B11, but BUGS_OPEN.md still lists them as open.
A bugs file that is wrong is worse than none: the next session re-investigates closed items. You are the breaker seat
and you have the tests — you are the right one to say which entries are dead.

## Do — for EVERY `### B<n>` entry
Verify against ground truth (`git log --oneline -S'<symbol>' -- <path>`, the current code, and the tests under
`tests/` + `template-maker/tests` + `frame-builder/`), then rewrite the entry's status line to one of:
- **CLOSED <sha> (guarded by <test file>)** — fixed, and a regression test exists (your T1 specs cover B6 for sure).
- **CLOSED <sha> (no guard)** — fixed, no test; say in one line what a guard would assert.
- **STALE — <reason>** — the premise no longer holds. Known: **B8** (stamp-editor's editor tree is a sync-generated,
  untracked bundle since 59615fe — not a duplicate); Fred also ruled 2026-09-18 the standalone stamp-editor is out
  of scope.
- **OPEN** — still true today; quote the line of code that proves it.
Keep each entry's original text below the status line (history), do not delete entries. Add a 5-line summary table
at the top: id · status · sha/test. The advisor knows of: B4 (dead send, removed in HY4 e95d610?), B5 (inspector
selection leak, IN1), B6 (T1 guard), B7 (force-wipe lists, TM1/TM2), B9 (host calls bypass the bridge — check
against the fusion-bridge.js seam; the inline `window.fusionJavaScriptHandler` in the palette is a NAMED exception),
B10 (CAM stop() unregisters 1 of 3 — check the merged cam-builder.py after CAM1), B11 (fusLog re-inlined — check
`core/fusion-log.js`, HY3). B1–B3: verify yourself. Trust the code over these hints.

## Verify
- Every `### B` heading has exactly one status line directly under it; the summary table has one row per entry.
- `git show --stat HEAD` → BUGS_OPEN.md + WORK-LOG-lane-b.md only.

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T3: BUGS_OPEN reconciled — N closed, N stale, N open — <sha>"`
and stop.
