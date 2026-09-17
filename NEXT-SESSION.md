# LANE B (audit seat) — A1: audit the add-in LOADER + shared substrate. READ-ONLY on code; you write ONE doc.

**Seat B · epoch 1 · A1.** You are the second worker, in your OWN worktree (`b-spline-generator-web-addin-lane-b`,
branch `lane-b`) with your OWN handoff channel (this folder's `HANDOFF.md`). Never edit anything under the main
checkout. Your lane is the **audit** the human asked for: *"audit the whole add-ins, all of them, bugs and
inefficiencies."* It runs in slices, one add-in group per turn; findings feed the advisor's dispatches to seat A.

## Rules of the lane
- **You edit ONLY `AUDIT-2026-09.md`** (create it this turn) + `WORK-LOG.md` (lane-b copy). No product code, no
  other docs. Commit by path (`git commit AUDIT-2026-09.md WORK-LOG.md -F -`), on branch `lane-b`.
- **Evidence or it isn't a finding.** Every item carries `file:line`, the concrete symptom (what a user or the next
  developer would hit), and how you verified it (read / grep / py_compile / a test you RAN read-only). Mark anything
  you could not confirm **UNVERIFIED** — never smooth it.
- **Lens = the project's declared principles** (`ROADMAP.md` "Principles / invariants" 1-5) + the north-star gate
  (*declare over hand-roll; codebase must not lie about itself; removal leaves no doorless handlers / vacuous tests*).
  Classify each finding: `bug` · `principle` (say which #) · `dead` (code/flag/test/doc that survives with no
  consumer) · `inefficiency` (perf or repeated work) · `honesty` (name/comment/test that asserts something false).
- **Reconcile, don't duplicate.** `BUGS_OPEN.md` (B1-B11) and `STANDARDS-AUDIT.md` (July) exist. For every OLD item
  that falls in this turn's scope, record its CURRENT status (fixed in <sha> / still open / superseded) with evidence.

## Declared finding format (one row each — keep it greppable)
```
| ID | add-in | file:line | class | symptom | evidence | fix shape (declare? delete? one-liner) | severity |
```
Severity: `H` (data loss / wrong geometry / crash on a normal gesture) · `M` (wrong on an edge, leak, silent no-op) ·
`L` (hygiene). Put an **"Inefficiencies"** subsection per add-in for repeated work, N× loops, redundant I/O, re-reads.

## A1 scope (this turn only)
1. `bspline-frame-builder/bspline-frame-builder.py` (768 lines — the single add-in entry: sub-module loading,
   `_force_wipe` / `_shared_project_names`, run()/stop() lifecycle, heartbeat lock). Check principle #2 (full
   release in stop) and #3 (isolation) explicitly: enumerate what run() registers vs what stop() releases.
2. `bspline-frame-builder/fb_shared/` (870 lines — canonical shared package).
3. `bspline-frame-builder/frame-inspector/` (~1.1k) and `bspline-frame-builder/fusion-exporter/` (~1k).
4. `bspline-frame-builder/DEPLOY_bspline-frame-builder.py` + `release.py` (deploy path — note the overlay-copy
   behaviour: deleted sources linger in AddIns; is anything else in that class?).
5. **Registry question:** `bspline-frame-builder/CAM-builder/` (8.8k lines) is NOT in ROADMAP's add-in list — is it
   loaded by the entry file, dead, or a separate thing? One paragraph with evidence.

Queued for later turns (do NOT start): A2 frame-builder · A3 template-maker · A4 stamp-editor · A5 b-spline-gen
(split) · A6 CAM-builder (if live) · A7 cloud workers.

## Verify
`git status --short` shows only your two files. `AUDIT-2026-09.md` has: a header naming the lens + date, the A1
reconcile table, the A1 findings table, an inefficiencies subsection, and a "what I could not verify" list.

## When done
Append WORK-LOG (lane-b), commit, then FROM THIS FOLDER:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "A1 audit: <n> findings (<H/M/L counts>), <m> old items reconciled, CAM-builder status: <live|dead|separate>. <sha>. Next: A2."`
and stop.
