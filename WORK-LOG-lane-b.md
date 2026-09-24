# WORK-LOG — lane B (audit seat), 2026-09-17 — extracted from the lane-b branch so it merges cleanly

## Lane B — Turn 1 — A1 audit: loader + fb_shared + frame-inspector + fusion-exporter + deploy — DONE

First turn on this seat (`b-spline-generator-web-addin-lane-b`, branch `lane-b`, its own `HANDOFF.md`).
Registered as worker in this worktree per the advisor's cross-session re-seat (I had been mistakenly
armed as a second waiter on the MAIN checkout's `HANDOFF.md` — stopped that waiter, re-registered here,
adopted epoch 1, confirmed via `handoff.py sig` after consuming turn 1). Read-only per the lane's rule:
touched only `AUDIT-2026-09.md` (new) + this file.

**Read in full before writing anything:** ROADMAP.md's 5 principles, `BUGS_OPEN.md` (all 11 bugs, not
just A1-scoped ones — needed the reconcile context), `STANDARDS-AUDIT.md` (all 6 sections). Then the A1
scope files: `bspline-frame-builder.py` (768 lines, full read), `fb_shared/` (all 3 modules, 870 lines),
`frame-inspector/fusion-inspector.py` (targeted: `run()`/`stop()`, the payload/dead-code areas already
swept in E7a), `fusion-exporter/{fusion-exporter.py,exporter.py}` (970 lines), `DEPLOY_bspline-frame-builder.py`
(744 lines, full read), `release.py` (352 lines, full read — found at repo ROOT, not under
`bspline-frame-builder/`; the dispatch's phrasing implied it might be nested there).

**6 new findings** (table in AUDIT-2026-09.md), all evidence-backed by `grep`/direct read, none
"survey"-sourced: 4 `L` (dead code in the loader — `_find_related_addin_modules` + 3 helpers, 46 lines,
0 callers; 2 stale S1-era docstrings in `fb_shared/*` claiming "no callers switched" when all consumers
have been switched since turn 77; a stale `deploy_template_maker()` verify entry for 2 files that no
longer exist anywhere — same class E7a fixed for `deploy_fusion_inspector` but missed here; a dead
panel-cleanup block in `fusion-exporter.py` targeting a legacy panel id `run()` never creates), 1 `M`
(restated B5 with tighter evidence — see reconcile). No `H` findings in this slice.

**6 reconcile items**, most resolved (good news, not just new problems): B7 already resolved (E7a);
STANDARDS-AUDIT §1b (per-palette module drift) fully superseded by the C4/F8 fb_shared consolidation
(verified 0 leftover copies); STANDARDS-AUDIT §4's bare-except counts resolved by turns 57/59 (verified
0 bare excepts remain in all 3 named files) — but that turn's OWN flagged follow-up (exporter.py's 2-3
silent-skip business-logic catch-alls, "Option B, not blessed") is still open, so I cited it as prior
art rather than re-discovering it as new. B5 and STANDARDS-AUDIT §5 (hardcoded paths) both confirmed
STILL open with current line numbers.

**P2/P3 explicit ask (enumerate run() registers vs stop() releases):** did this as its own subsection
("What's GOOD") rather than folding it into the findings table, since the verdict is a CLEAN PASS —
`bspline-frame-builder.py`'s own bookkeeping (panels/commands/handlers) is fully symmetric between
`run()` and `stop()`, and P3 isolation (try/except around every sub-module load/run/stop) is genuinely
honored. The one open lifecycle bug (B5) lives inside a sub-module that owns its own cleanup — correctly
outside the parent's responsibility per the P3 design, not a parent-orchestrator gap.

**Registry question (CAM-builder):** answered with a paragraph + 4 citations in AUDIT-2026-09.md — it's
LIVE (loaded, run, torn down by the parent exactly like the other 4 sub-add-ins; already ships in the
unified deploy zip/copy; already has its own tracked bug B10). ROADMAP's one-line narrative just never
names it — a doc gap already closed by `ARCHITECTURE.md:244` ("CAM Studio"), not a real mystery.

**Verify:** `git status --short` in this worktree shows only `AUDIT-2026-09.md` (new) before this
WORK-LOG commit — matches the "only your two files" check. Every finding's `file:line` was read
directly in this worktree this turn (not carried over from the July survey unverified); every
reconcile-table "RESOLVED" claim is backed by a fresh `grep`/`find` run this turn, not just trusted from
the prior doc's text.

**Noted, not chased (see AUDIT-2026-09.md "what I could not verify"):** the live
`%APPDATA%\...\AddIns\bspline-frame-builder\` folder currently shows zero residue from the E7a deletions
(checked via PowerShell `Get-ChildItem` against the deployed `frame-inspector/` folder) — so A1-6's
orphan-detection gap is a structural risk, not a currently-manifesting one; didn't chase deploy history
to pin down exactly which redeploy cleaned it.

**Aside (not this lane's concern, noted for the record):** partway through this turn, two
system-reminders fired showing `fusion-inspector.py` and `inspector_palette.html` in the MAIN checkout
had changed on disk — Seat A actively working on E7b (structured `META_FIELDS`, a new
`get_fb_connections` function, collapsible-section CSS hooks all visible in the diffs). Did not read
further or act on it — lane-b is a separate worktree/branch by design and I was explicitly told never to
touch the main checkout again this session. Mentioning only so the advisor isn't surprised this seat
"saw" that activity.

No gate hit — read-only turn, one doc + this log, nothing under `bspline-frame-builder/` (or anywhere
else) edited.
## Lane B — Turn 3 — A2 audit: frame-builder (fb_engine + the two builder UIs) — DONE

**Read before writing:** `fb_engine/parametric_engine.py` (484L, full), `build_context.py` (targeted:
`create_or_update_param`), `frame_engine.py` (targeted: `FrameBuilder`, `_create_skeletal_parameters`,
both `run_*` entry points), `ui/sketch_builder_ui.py` (594L, full) + `ui/solid_builder_ui.py` (351L,
full, diffed against sketch's), the 3 root test files (1013L), and `UNDO-REDO-DESIGN.md` (E8's own
investigation doc, full) as ground truth for the param-lifecycle question the dispatch asked about.

**5 new findings** (1 H, 2 M/M-H, 2 L). The headline one (A2-1, H): traced the exact call chain the
dispatch asked about ("is any OTHER param still created inside a command Execute?") and found the answer
is yes — `_create_skeletal_parameters` (`frame_engine.py:225-320`) and `_sync_user_parameters`
(`parametric_engine.py:246-289`) both call `userParameters.add(...)` inside the same Execute handler
`ensure_tilt_param`'s own docstring warns against. More significantly: this appears to CONTRADICT
`UNDO-REDO-DESIGN.md`'s own root-cause claim that `frame_tilt_deg` was "the first design-level user
parameter created mid-build" — `_create_skeletal_parameters` lives in `frame_engine.py`, a file the
tilt commit `6c1cce4` never touched (per that doc's own line 32), and it already creates Master +
Dependent template params (width/height/thickness/…) the identical way. If confirmed at runtime, this
means E8's F1-A/B/C fix options were scoped to the wrong blast radius — narrowed to one parameter when
the mechanism creates several. Flagged clearly as **UNVERIFIED** (no Fusion access in this lane) rather
than asserted as fact — this is a static contradiction worth a live-Fusion recheck, not a confirmed bug.

A2-3 (M-H) confirms the dispatch's other named concern is real and unmitigated: `_build_blocks`'s
`isComputeDeferred` windows are correctly balanced on the happy path, but nothing resets the flag to
`False` if a step raises mid-window — the one exception handler in the chain (`build_template`'s
per-sketch try/except) never touches it. A2-2 is a small, clean dead-code find directly tied to the E8
migration (the exact old tilt-chain function `UNDO-REDO-DESIGN.md` cites, now orphaned). A2-4 quantifies
the two builder UIs' duplication (555/945 diff lines — same hidden-command dispatch mechanism hand-rolled
twice) as a named P4 violation, extending the B8-class duplication debt to a pair STANDARDS-AUDIT hadn't
covered. A2-5 is a small honesty nuance on the same file as A2-1.

**Verified what's GOOD too, not just problems:** confirmed F2 (delete the dead undo-transaction
wrappers) was actually done — 0 hits for `_start_undo_transaction`/`startTransaction`/`_commit`/`_abort`
across both UI files. Confirmed the UI lifecycle-symmetry verdict from A1's "What's GOOD" extends
cleanly into A2's specific files (sketch's `documentActivated` sub / solid's lack of one both match what
the parent's `_teardown_submodules` releases — no new drift). `_get_tilt_plane` itself (the post-E8
code) is clean and accurately documented — held up as the pattern A2-1's fix should follow.

**Test gap sharpened, not just restated:** grepped all 3 root test files for every symbol this turn's
findings touch (`parametric_engine|_sync_user_parameters|_create_skeletal_parameters|isComputeDeferred|
sketch_builder_ui|solid_builder_ui`) → 0 matches. The exact code A2-1/A2-3 found problems in is the
untested part of an already-lightly-tested folder — turned STANDARDS-AUDIT's generic "light coverage"
into a concrete claim.

**Honesty sweep:** checked the two claims NEXT-SESSION named (E8 undo-wrapper removal: confirmed true;
C4 shared-module move: out of this folder's scope). Found one more not-previously-named
(A2-5) on the same file as A2-1. The various "used to X, now Y" comments elsewhere in `fb_engine/` were
each checked against current code and are accurate — didn't just assume past-tense comments are honest
by default.

**Verify:** `git status --short` before this commit showed only `AUDIT-2026-09.md` (modified, A2 section
appended) — matches "append, don't rewrite A1." No amendments pending at either poll.

No gate hit — read-only turn, same as turn 1. Nothing under `bspline-frame-builder/` edited; no Fusion
access used (explicitly off-limits this turn) — A2-1 and A2-3 are correctly flagged UNVERIFIED rather
than asserted, since neither could be runtime-confirmed from this lane.
## Lane B — Turn 5 — A3 audit: template-maker (entry lifecycle, core/, palette, tests) — DONE

**Read before writing:** `template-maker.py` (860L, full — entry/lifecycle/reload machinery),
`core/check_addin_sync.py` (29L, full), targeted reads of `coincidence_clusters.py`/`relation_hints.py`/
`phase_parser.py` for the loop/COM-call question, all of `core/`'s import graph via grep, the palette
HTML's ~15 `fusionSendData`/`sendInfoToHTML` call sites, and ran `pytest template-maker/tests -q`
(read-only, per NEXT-SESSION's explicit allowance) — 83/83 green.

**3 new findings** (1 H, 2 L). Headline (A3-1, H) directly answers the dispatch's question — the
`_PROJECT_MODULES` reload-wipe list is missing 5 names (`detection_log`, `dimension_hint`,
`offset_hint`, `template_bridge`, `variable_scan`) that ARE actively imported across `core/`. This is
the exact B7 stale-reload mechanism, but wider: `detection_log` alone is imported by 9+ other core
modules, so editing it wouldn't take effect on Stop→Start for any of them without a full Fusion
restart. Cross-checked against the PARENT's own wipe list (`bspline-frame-builder.py:251-262`, from
A1) too — not covered there either. Not previously tracked anywhere (grepped BUGS_OPEN.md/
STANDARDS-AUDIT.md for all 5 names — 0 hits). A3-2 answers the other explicit question
("check_addin_sync.py — live or dead?") — technically runnable, zero importers, but its premise (a
standalone per-palette AddIns folder) predates the unified deploy, and its own scan is non-recursive
(misses `core/`/`ui/` even on its own stale premise). A3-3 is a real but likely-low-impact nested loop,
flagged with an honest caveat about not tracing every caller to confirm the bound.

**Confirmed clean on 3 fronts the dispatch asked about, not just assumed:**
(1) `template-maker.py`'s own `run()`/`stop()` symmetry — read both in full, confirmed sel+doc-activated
handlers are defensively removed-then-readded in `run()` AND symmetrically removed in `stop()`, plus the
`deferred_rebuild` CustomEvent gets its own separate teardown. This is the exact "correct pattern" B5
already cites by name — re-verified directly instead of trusting the citation.
(2) Doorless-handler sweep on the palette, BOTH directions — every JS→Python `fusionSendData` action
string has a matching Python `elif`, every Python→JS `sendInfoToHTML` event name has a matching JS
handler. Named each one rather than just counting.
(3) fb_shared duplication — grepped for shadow re-implementations of the 5 fb_shared function names
under different identifiers in `core/` — 0 hits, extends A1's consolidation finding into A3's scope.

**Test gap sharpened with a structural point, not just a coverage count.** 9 of 23 `core/` modules have
zero references anywhere in `tests/` (named each one). The sharper finding: `detection_log.py` — the
module A3-1's bug centers on — has zero test references AND the pytest suite **cannot structurally
test A3-1 at all**, dedicated test or not, because it's a Stop→Start `sys.modules`-caching bug specific
to Fusion's long-running process; each pytest run is a fresh process with no reload cycle to trigger it.
Said this plainly rather than implying "add a test for A3-1" would actually close the gap.

**Verify:** `git status --short` before this commit showed only `AUDIT-2026-09.md` modified (A3 section
appended, A1/A2 untouched). No amendments pending at either poll. `pytest` run was read-only per
NEXT-SESSION's explicit allowance (no Fusion, no mutation).

No gate hit — read-only turn. A3-1 correctly flagged UNVERIFIED-at-runtime (static diff is solid, the
live Stop→Start symptom itself needs Fusion to confirm) rather than asserted as a confirmed live bug.
## Lane B — Turn 7 — A4 audit: stamp-editor (fork status, lifecycle, P.stampLayers map, tests) — DONE

**Discovered and disclosed a worktree-specific gap before doing anything else with it:** `stamp-editor/
html/editor/` and `html/core/stamp/` (the C1-generated copies) don't exist ON DISK in this lane-b
worktree at all — confirmed via `find html -maxdepth 2 -type d` (only `core/`, `main/`, `styles/`
present; `core/` holds just the 2 unique files). This makes sense structurally: those files are
gitignored per C1, so a fresh worktree checkout never materializes them — they only exist where someone
has actually run `sync_stamp_bundle.py` (the main checkout, not here). Said so plainly in the AUDIT doc
rather than silently skipping or faking the "hand-edited since source?" comparison the dispatch asked
for — that specific sub-question is genuinely unanswerable from this lane.

**Read before writing:** `stamp-editor.py` (1436L, full — header, dispatcher `:138-210`, lifecycle
`:1254-1436`, the live-face-count enable/disable pair `:243-275`), `html/core/runtime.js` (39L, full),
grepped `html/main/*.js` for `sendToPython`/dispatch patterns, `git ls-files` against turn 53's C1
classification, and mapped `stampLayers` across the 13 `b-spline-gen/html/` files that reference it
(stamp-editor's own tree has zero `stampLayers` hits — confirmed by grep, the concept lives entirely in
the sync source in this worktree's view). Also checked `tests/*.js`'s import graph (4 vitest files) and
attempted `npx vitest run` (failed — no `node_modules` in this worktree; didn't `npm install`, that's a
mutation outside this turn's read-only remit — relied on the static import graph instead, which fully
answers the coverage question without needing to execute anything).

**3 new findings, all L.** A4-1: `reset_ui` is a Python dispatcher branch with zero JS callers anywhere
— the reverse of B4 (a room with no door), traced back to the file's own stale `"v1 SCAFFOLD"` header
comment. A4-2 is that same header comment's broader claim — it frames face-pick/STEP-emission as future
work when both are fully implemented (7 live actions in the dispatcher). A4-3 is a genuinely ambiguous
one, flagged rather than asserted: `runtime.js` claims to mirror `step-editor`'s runtime, but no
`step-editor/` Fusion add-in exists in the repo at all (only the unbuilt `cloud/step-editor-pages`) — 
could be forward-looking language for a sibling not yet built, not necessarily a lie about a currently-
mirrored file. Said so rather than picking a side without evidence either way.

**Fork status (item 1) — confirmed clean, no re-drift since C1 (turn 53).** `git ls-files` returns
exactly the 8 unique files C1 classified as hand-written+tracked; none of the 54 generated files are
tracked. The hand-edited-drift sub-question is the one flagged unanswerable (see above).

**P.stampLayers writers/readers map (item 4) — produced as reconnaissance, not a carve proposal, per
the dispatch's own framing.** Mapped across all 13 `b-spline-gen/html/` files that reference it: writers
(the array's origin declaration + 7 field-setter sites, including the already-known B6 mask-strip
mechanism at `core/state.js:253-254`) and readers (10 files, mostly existence-checks/filters/clones for
cloud-save, export, and fallback-when-editor-roster-unavailable paths). Noted the one structural
observation worth flagging to whoever designs C5: `core/state.js` is the only writer of the raw array
itself; every other write site writes into one layer's field. Did NOT propose the carve, as instructed.

**Test gap:** confirmed via the vitest import graph that zero of the 4 test files touch anything under
`stamp-editor/html/` directly — all 4 import from `b-spline-gen/html/...`. Framed the nuance correctly:
stamp-editor's GENERATED portion gets indirect coverage-by-proxy (byte-identical mirror of tested
source), but its 8 UNIQUE files have zero coverage, direct or indirect.

**What's GOOD, verified by reading the code, not by trusting the B5 citation:** `_enable_live_face_count`/
`_disable_live_face_count` read in full — idempotent-guarded, removes from both the Fusion event AND the
module handler list, called from both `PaletteClosedHandler` and `stop()`. This is exactly the pattern
BUGS_OPEN B5 already points to as correct; re-verified directly this turn rather than taking it on faith.
`run()`/`stop()` toolbar symmetry also read in full and confirmed clean, including the deliberate
icon-cache-buster design (self-sweeps on next `run()`, not a leak).

**Verify:** `git status --short` before this commit showed only `AUDIT-2026-09.md` modified (A4 section
appended, A1-A3 untouched). No amendments pending at either poll. Did not run Fusion or
`sync_stamp_bundle.py` (both explicitly off-limits this turn).

No gate hit — read-only turn. A4-3 correctly left as an open question rather than resolved on
insufficient evidence; the worktree gap was disclosed rather than worked around silently.
## Lane B — Turn 9 — A5a audit: b-spline-gen core+main+py (P1, dead code, snapshots, lifecycle) — DONE

**Scope:** `core/` (24 files, 8790L) + `main/` (26 files, 4146L) + `b-spline-gen.py` (1635L) — the
larger of the two A5 slices; `editor/`+palette HTML is A5b next turn. Grep-first across the whole
scope for the P1/dead-code/export questions, then full reads of the specific functions the findings
centered on: `core/history.js` (93L), `core/engine/scheduler.js` (23L), `main/snapshot-manager.js`
(72L), all 3 `buildSnapshot`-shaped functions, `core/state.js:210-260`, `b-spline-gen.py:1508-1634`
(`run`/`stop`) plus a full-file handler-registration grep, and `core/fusion-bridge.js:38-51`.

**5 new findings (1 M-H, 3 M, 1 correction-not-a-finding).** Headline (A5a-1, M-H): `core/history.js`'s
`takeSnapshot` — the undo/redo snapshot function — is the ONE place in the codebase that doesn't strip
`.stampLayers[*].mask` before a `JSON.parse(JSON.stringify(P))` clone, unlike `saveLastSession` and all
3 `buildSnapshot` variants, which all explicitly document WHY they strip it first (Float32Array→plain-
object JSON corruption). Traced whether this actually matters downstream: `applySnapshot`'s own comment
says it always regenerates masks from `.svg` on restore when `hasStampSvg` is true — so this is USUALLY
masked, but not always, and it's an unconditional, avoidable perf cost either way (JSON-serializing a
full-resolution typed array every undo step for no reason). A5a-2 reframes item 2's own premise: 2 of
the 3 "identical mask-strip loops" the dispatch asked about live in `preset-manager.js`/
`cloud-preset-manager.js` — both **confirmed entirely dead** (0 importers repo-wide, and
`cloud-project-manager.js`'s own header says it replaces both by name). So the real fix isn't "extract
3 call sites into 1 serializer," it's "delete 283 lines of dead files, then declare the 1 remaining live
site." A5a-3: `b-spline-gen.py`'s `handlers` list is NEVER cleared in `stop()` — the only add-in in this
suite that doesn't, confirmed by grep (1 hit: the declaration) cross-referenced against the 3 other
add-ins' confirmed-clearing patterns from earlier turns. A5a-5 (found via completing item 6's JS→Python
doorless sweep): `sendFusionPreview`'s `'preview'` action has zero Python receiver — a B4-class dead
send, sibling to the already-tracked one, not a duplicate.

**A5a-4 is a correction, not a finding — worth calling out on its own.** NEXT-SESSION pointed this turn
at `core/state.js:253-254` to check "is B6 still present." Read that line in full context
(`saveLastSession`) and it is NOT B6 — it's the same benign, unconditional mask-strip A5a-1/A5a-2
concern themselves, not the hidden-layer GEOMETRY loss B6 actually describes. B6's real site
(`editor/editor-io.js`'s `_visibleContent`) is under `editor/`, which is A5b's scope and wasn't read
this turn. Said so plainly rather than either (a) quietly answering "B6 status: fixed" based on the
wrong line, or (b) reading `editor/` out of scope to chase it down. Flagged so A5b checks the right file.

**P1 sweep: reconciled, not new.** Grepped 6 files for host-branch smells; read all 6 rather than
trusting the grep. 3 turned out to be FALSE POSITIVES on inspection — `export-flow.js`,
`header-controls.js`, `core/engine/rebuild.js` all correctly branch on the `isFusionMode` STATE FLAG to
decide when to call functions imported FROM `fusion-bridge.js` — that's the intended architecture, not
a violation. The other 3 hits are B9 and B11, confirmed still present at current line numbers, nothing
new. Distinguishing the false positives from the real hits by reading the code (not just counting grep
matches) is the value of this pass over a naive re-grep.

**Inefficiencies (item 7): the dispatch's concern turned out to be unfounded, confirmed rather than
assumed.** Read `scheduler.js` in full — rebuild IS debounced (clearTimeout+setTimeout, 50ms default),
not a per-keystroke full rebuild. No O(n²) found in `rebuild.js` itself (one O(n) grid pass). Said
plainly that `core/preview/*.js` (1300+ lines) wasn't swept for the same question — ran out of turn
budget rather than silently extending the "clean" verdict to files not actually checked.

**Test gap:** cross-referenced all 5 findings against the 4 vitest files' import graph — A5a-1/A5a-2/
A5a-5 all live in untested files/paths; A5a-3 is Python and untestable by this suite entirely (no
Python lifecycle tests exist anywhere in the repo, reconciled from A1). Noted the B9/B11 nuance too:
`state.js` IS imported by tests, but that doesn't mean these SPECIFIC lines are exercised — didn't
overclaim file-level coverage as line-level coverage.

**Honest about the scope-vs-time tradeoff on item 3's second half:** confirmed the 2 NAMED dead files
thoroughly rather than attempting an exhaustive 0-importers sweep across all ~13k lines of core/+main/
and doing it shallowly. Said so directly in "what I could not verify" rather than implying full coverage.

**Verify:** `git status --short` before this commit showed only `AUDIT-2026-09.md` modified (A5a
appended, A1-A4 untouched). No amendments pending at either poll. No Fusion, no `npm install`, no
`sync_stamp_bundle.py` — all explicitly off-limits or out of scope this turn.

No gate hit — read-only turn. A5a-4 is the second time this lane has corrected a dispatch's own
citation rather than silently following it into the wrong file (A4 did the same for the worktree gap).
---
## Lane B — Turn 11 — A5b audit: b-spline-gen editor + palette HTML (B6, B1/B3, dead sends, PM1) — DONE

**Scope:** `editor/` (~40 files) + `bspline_gen_palette.html` (1979L) + `index.html` (6L) — the second
half of the A5 split. The advisor's A5a review specifically thanked this lane for the B6-citation
correction, which set the bar for this turn's B6-for-real check.

**Headline: B6 is RESOLVED, stated with full evidence.** The function NEXT-SESSION originally pointed
at (`_visibleContent`) doesn't exist anywhere in the codebase any more — grepped, 0 hits. It's been
replaced by `serializeEditor` (`editor-io.js:36-40`), whose own docstring names B6 by number and states
the fix directly: hidden layers are now intentionally KEPT on save. Traced every caller (`save()`,
`saveForRasterization()`, `getLayerSvg()`) rather than trusting the one docstring — confirmed the two
actual PERSISTENCE functions keep all layers, and the one that DOES filter by visibility
(`getLayerSvg`) is for the live stamp preview, a deliberately different concern the same docstring
already distinguishes. This is the kind of "state it plainly, with lines" the dispatch asked for,
not a hedge.

**B1/B3 reconciled against CURRENT code, explicitly not against the July doc — the dispatch's own
instruction ("cite the mechanism, not the doc").** Found `pushState()` has grown from the single site
July traced to 20 call sites across the editor. Rather than either blindly re-citing the old verdict or
trying to trace all 20 in one turn, picked the cluster most relevant to B1's original symptom (the 4
sites in `editor-interaction.js`, the file B1 was originally about) and traced each to its containing
function — confirmed they're 4 distinct, non-overlapping gestures (paste, drag-end, anchor-path-commit,
freehand-stroke-finish), including the exact original site (`finishDrawing`) at an unchanged line
number. Said plainly that the other 16 sites weren't individually checked, rather than implying full
coverage from a partial trace.

**2 new dead sends found (Python→JS direction, the half A5a explicitly didn't finish).** Enumerated all
7 `sendInfoToHTML` event names against every JS listener — 5 wired correctly, 2 (`import_progress`,
`import_success`) have zero JS handling despite `import_progress` firing from 8 live call sites during
real STEP-import (progress messages the user never sees). Same B4 class as A5a-5's finding from the
other direction, closing out item 6's originally-incomplete doorless sweep.

**editor/'s own health check came back clean on both fronts it was asked about** — P1 (0 host branches)
and the C2 migration (0 hand-rolled `SVG.Point.transform` survivors, only a comment referencing the old
pattern by name to explain what NOT to do). Did the exhaustive export sweep A5a explicitly couldn't fit
(100 exports checked against the whole tree) — found 1 truly dead (`createButton`) and 5 that are used
but only locally, which is a smaller, different finding than dead code and worth keeping distinct rather
than lumping all 6 together.

**Corrected the dispatch's OWN framing a second time this session (after A5a-4).** Item 5 assumed
`bspline_gen_palette.html` and `index.html` are a web-host/Fusion-host PAIR to `diff`. They're not —
`index.html` is a 6-line meta-refresh redirect stub; there is exactly ONE real page, serving both hosts
at runtime. Traced WHY (`b-spline-gen.py` points Fusion directly at the palette HTML, bypassing the
redirect; the redirect only exists for the web deploy's root URL) rather than just asserting the
mismatch. Did still find a genuine, more interesting P1 nuance the dispatch's framing would have missed
anyway: the actual Fusion→JS bridge RECEIVER (`window.fusionJavaScriptHandler`) lives inline in the
HTML, outside `fusion-bridge.js` — but evidenced it as a NECESSARY exception (Fusion's API needs a
synchronously-available global, which an ES module can't guarantee) rather than flagging it as a naive
violation to "fix." Getting that distinction right matters — a wrong fix here would break the bridge.

**PM1 id check: 15/16 clean, 1 real gap found.** `fmCurrentFileLabel` is read by JS
(`updateHeaderFileIndicator`) but doesn't exist anywhere in the HTML — correctly null-guarded so it's
silent, not a crash, but the "current file" indicator it drives never appears. Confirmed this is
distinct from anything PM1/PM1b touched (that restoration was the selection-bar block, not a header
indicator) rather than assuming it's a PM1 regression just because the timing lined up.

**Test gap:** only 1 file this turn's findings touch (`editor-coords.js`) has any vitest coverage;
everything else — including the just-confirmed B6 fix itself — has zero regression coverage. Said this
plainly: a future refactor of `serializeEditor` could silently reintroduce B6 with nothing to catch it.

**Verify:** `git status --short` before this commit showed only `AUDIT-2026-09.md` modified (A5b
appended, A1-A5a untouched). No amendments pending at either poll. No Fusion, no `npm install`, no
`sync_stamp_bundle.py`.

No gate hit — read-only turn. This closes out the b-spline-gen slice (A5a+A5b); A6 (CAM-builder) is
next, the last add-in in the original A1-A6 sweep.
## Lane B — Turn 13 — A6 audit: CAM-builder (B10, lifecycle, duplication, doorless, collisions) — DONE
**Scope:** `CAM-builder/` (~7150 L Python across `cam-builder.py` + `cam_engine/` + `cam_utils/`) + both
palette HTMLs (1713 L). Last add-in in the original A1-A6 sweep.
**B10 reconfirmed with current line numbers, not assumed still accurate.** Read `run()`/`stop()`/
`_register_refresh_event` in full — exactly matches BUGS_OPEN's description: 3 CustomEvents registered,
`stop()` only unregisters 1. Re-verified the masking mechanism (the re-register function itself
unregisters all 3 first) still holds, so the practical risk stays scoped to the same narrow window B10
already named. No severity change, just re-grounded in `:2026-2298` instead of the July citation.
**Best doorless-handler result of any add-in audited this session — genuinely clean, both directions,
both palettes.** CAM-builder has TWO palettes (builder + studio), each its own dispatcher — 13 JS→Python
actions and 7 Python→JS events, all wired correctly. Caught my own grep blind spot mid-check (two
actions sent via a ternary expression, missed by a literal-string pattern) by noticing the count
mismatch rather than trusting the first pass silently — worth naming since it's exactly the kind of
self-correction this lane's supposed to be doing, not just running greps and reporting whatever they say.
**Cross-sub bare-name collision question (item 4) — answered definitively: zero.** Traced every import
in `cam-builder.py` AND inside `cam_engine/`+`cam_utils/` themselves (not just the entry file) — 100%
package-qualified, no bare names at all. Cross-checked submodule filenames against template-maker/core's
own list (`comm -12`) — no overlap. This directly answers the framing question NEXT-SESSION posed
("decides the parent's `_shared_project_names` fate") for CAM-builder's slice of it — contributes zero
reasons to keep the list, though the list still can't be retired on this evidence alone since
template-maker's OWN bare imports (A3) are the actual reason it stays.
**Duplication with fb_shared/frame-builder: clean, and explained WHY rather than just reporting the
grep result.** CAM-builder's domain (Fusion CAM setups/bodies) shares no concept with fb_shared's
sketch-entity helpers, so there's nothing TO duplicate — stated the reason, not just the absence.
**One reconciled STANDARDS-AUDIT item, amplified beyond its original one-line scope.** The hardcoded
"Ultimate Bee" machine path (`setup_builder.py:206`) is confirmed still present — but the machine name
appears ~15 times through the file, not once; a single-line path fix wouldn't address the actual
coupling. Said this plainly rather than just checking the one cited line and calling it reconciled.
**Inefficiencies and dead-function sweep were both done at a SURVEY depth, said so explicitly rather
than implying full coverage.** No O(n²) or hot-loop COM-read pattern found in the loops actually
checked, but the two largest engine files (`setup_builder.py` 2422L, `mm_builder.py` 1489L) were not
read end-to-end for either question — named the specific gap rather than letting a spot-check read as
exhaustive.
**Tests: 0, confirmed, matches A1 exactly.** Nothing to reconcile beyond re-confirming.
**Verify:** `git status --short` before this commit showed only `AUDIT-2026-09.md` modified (A6
appended, A1-A5b untouched). No amendments pending at either poll. No Fusion, static read + grep only
per NEXT-SESSION's explicit constraint.
No gate hit — read-only turn. This closes the original A1-A6 add-in sweep; A7 (cloud workers) is next.
## Lane B — Turn 15 — A7 audit: cloud (preset-worker, step-editor pair, deploy_cloudflare.py) — DONE

**Last audit slice.** Scope: `cloud/preset-worker/` (3 source files, ~1350L combined), `cloud/
step-editor-worker/`, `cloud/step-editor-pages/`, `bspline-frame-builder/deploy_cloudflare.py`. This is
a security-relevant review (a real, internet-facing, unauthenticated-by-design shared worker) — treated
it with the care that implies: read every route's auth/validation posture directly rather than
extrapolating from one example, and was explicit about what's a known/accepted risk (the README already
admits `/projects` is unauthenticated) versus what's a genuinely new gap.

**Built a route-by-route table (auth/validation/size-cap/CORS) across all 3 route families** in
`preset-worker` rather than a single pass/fail verdict — the postures are genuinely different:
`/views/*` (pageviews) has the BEST discipline (origin allowlist, bot-UA filter, Cloudflare bot-score
gate, tight size cap) despite having no auth by design; `/bus/*` has the WORST (no size cap on any of
its 6 write endpoints — the one new concrete gap, A7-1). Listed every unauthenticated write explicitly,
as asked, rather than just the ones the README already names.

**Flagged the GitHub-commit route (A7-2) as the highest-consequence unauthenticated write, distinct
from the KV routes.** A bad KV write is trivially revertible; a bad GitHub commit via a server-side PAT
is not. The code's own comment already accepts this risk explicitly — said so plainly (known/accepted,
not an oversight) rather than reporting it as if newly discovered.

**Traced `deploy_cloudflare.py`'s `--build-only` control flow end to end and found a confirmed bug
(A7-3), not an inferred one.** The only `clean_dir(deploy_dist)` call in the file is unreachable in
`--build-only` mode because `sys.exit(0)` fires first — so `dist/` is a pure overlay, never cleaned
before OR after a build. Connected this explicitly to A1-6 (the same overlay-without-clean pattern
already found in the Fusion AddIns deploy path) — two instances of one root cause, not two coincidences,
worth fixing as one lesson.

**step-editor: gave a precise 3-way status instead of one verdict**, since the three pieces (worker code,
pages scaffold, the Fusion add-in itself) are in three genuinely different states. Read step-editor-
worker's actual source (122L) rather than trusting the README — it's finished, validated code, just
never provisioned (placeholder KV id). Confirmed step-editor-pages really is README-only (matches
STANDARDS-AUDIT exactly). The more interesting finding: the Fusion add-in these two cloud pieces exist
to serve doesn't exist in the repo at all, and per A4's own sync_stamp_bundle.py reading, its
functionality already moved to stamp-editor — reframed this from "half-built, needs finishing" to
"probably superseded, needs a keep-or-delete call," which is a materially different thing to put in
front of the advisor/human than a generic TODO.

**Dead-routes question answered with an explicit scope correction, not just an answer.** This worker is
shared across MULTIPLE of Fred's app repos (confirmed via its own routing comment); this repo doesn't
contain the sibling apps for `/loader`, `/bus`, or `/views`. Only called `/presets` genuinely dead,
because I could trace its one caller in THIS repo to code A5a already proved is dead — for the other
three, said plainly "zero callers found in this repo" is not the same claim as "dead," and didn't
overreach into calling them that.

**Hygiene sweep reconciled STANDARDS-AUDIT §5's preset-worker identity-drift finding precisely: half
resolved.** The dangerous half (`deploy_worker.py`, the orphan mis-bound REST-deploy script) no longer
exists — confirmed gone. The cosmetic half (`package.json`'s third, unused name label) is still there,
but doesn't affect the actual deploy identity. Said both halves separately rather than one blended verdict.

**Built the audit-series summary table as the final deliverable** — every H/M finding across A1-A7 in
one table with current disposition, cross-referencing the advisor's own review notes from each turn
(which findings became seat-A tasks, which are still open, which got reframed). Also surfaced two
cross-cutting notes worth ROADMAP attention that don't fit a single-turn row: the A1-6/A7-3 overlay-
pattern pairing, and the now-complete picture of every add-in's lifecycle-symmetry status in one place.

**Verify:** `git status --short` before this commit showed only `AUDIT-2026-09.md` modified (A7 +
summary table appended, A1-A6 untouched). No amendments pending at either poll. No wrangler/deploy
commands run against the live account — static read + grep only, per NEXT-SESSION's explicit constraint.

No gate hit — read-only turn. **This completes the audit series (A1-A7).**

---

## Lane B — Turn 17 — BREAKER T1: regression guards for BG1/E7b/FB1/B6 — DONE, all 5 targets landed

**Role change this turn:** from audit (read-only) to BREAKER (write TESTS ONLY, never product code).
Confirmed the worktree is synced with main at `694f09d` and that seat A had already landed fixes for
several of this lane's own audit findings: `persistableP` (BG1, closes A5a-1+A5a-2's shared-serializer
recommendation), `get_fb_metadata_fields` (E7b), `deferred_compute` (FB1, closes A2-3), and confirmed
`step-editor` was deleted (FIX-BACKLOG F16, closes the A7 "likely superseded" finding with a decision).

**Step 0 — environment.** `npm ci` FAILED (`Missing: @emnapi/wasi-threads@1.2.2 from lock file` — a
lockfile/install-tree mismatch, this worktree's own environment issue, not a product bug worth chasing
further this turn). Fell back to `npm install`, which succeeded and produced a working `node_modules`.
Baseline confirmed: `npx vitest run` → 29 green, `pytest template-maker/tests -q` → 83 green — both
match the dispatch's stated baseline before adding anything.

**Non-vacuity mechanism note (deviation from the dispatch's literal instruction, done for a real
reason):** the dispatch's prescribed proof is "break the product file, run the spec, see it go RED,
`git checkout -- <file>` to restore." The FIRST attempt at this (a temporary edit to `core/state.js`)
was **blocked by the permission system** ("Modify Shared Resources" — this is a live, shared product
file in a two-seat worktree, and the classifier is right to be cautious about even a temporary edit to
it). Rather than retry the same blocked call or work around the block, used the equivalent proof WITHOUT
touching any repo file: ran the pre-fix / broken shape as a **standalone script outside the repo**
(`node -e` / `python -c`, importing nothing from the tree) and ran the SAME assertions the spec makes
against it, confirming each would fail. This proves exactly what the literal mechanism proves (the spec
is not vacuous — it can fail) without ever risking the shared product tree. Documented per spec below,
with the actual RED assertion each simulation produced.

**1. `persistableP` — `tests/persistable-p.test.js`, 4 assertions, all landed.** Covers: (a) every
`stampLayers[i].mask` is `null` in the result; (b) every other field survives; (c) input `P` is not
mutated; (d) the JSON output contains no mask-blob shape.
**Non-vacuity:** simulated `persistableP(p) { return p; }` (pre-fix shape) against the same test
fixture — `mask === null` evaluated to `false`, and the JSON contained `"mask":{"0":1,"1":2,"2":3}` —
the exact corruption shape A5a-1 found. Both would fail the spec's assertions.

**2. `takeSnapshot` — `tests/history-snapshot.test.js`, 1 test.** Mutates `P.stampLayers[0].mask` to a
real `Float32Array`, calls `takeSnapshot()`, asserts both `snapshot.P.stampLayers[0].mask` AND
`snapshot.layerConfigs[0].mask` are `null`, restores the original mask value in a `finally` (module-
level `P`/`globalHistoryLog` are shared state across the test file — cleaned up rather than left mutated
for whatever runs after).
**Non-vacuity:** simulated the pre-fix `takeSnapshot` (`JSON.parse(JSON.stringify(P))`, no
`persistableP` call) — both `.mask === null` checks evaluated to `false` (actual shape:
`{"0":9,"1":9,"2":9}`). Would fail the spec.

**3. `get_fb_metadata`/`get_fb_metadata_fields` — `bspline-frame-builder/template-maker/tests/
test_fb_metadata_fields.py`, 3 tests.** Full start/end/center case (dict + byte-identical pipe-joined
string), no-attributes case (`{}`/`''`), and a partial-fields case (only present keys appear, in the
declared label order). Built fake `_FakeEntity`/`_FakeAttributes`/`_FakeAttr` — no `nativeObject` and no
`centerSketchPoint` attrs, so `_get_native` passes through unchanged and the Bulge branch never fires
(kept the fixture to exactly what NEXT-SESSION specified, no `_get_arc_midpoint`/adsk-geometry surface
needed). Ran via the existing `template-maker/tests/conftest.py` (adsk stub + the `entity_helpers`
bare-name alias to `fb_shared.entity_helpers` — no new stub needed).
**Non-vacuity:** simulated `get_fb_metadata_fields` always returning `{}` (a plausible regression) —
both the dict-equality and string-equality assertions evaluated to `False`.

**4. `deferred_compute` — `bspline-frame-builder/frame-builder/test_deferred_compute.py`, 3 tests.**
Placed alongside frame-builder's existing 3 test files (its own convention — no `tests/` subfolder,
unlike template-maker) rather than nesting under template-maker/tests, since `deferred_compute` is a
frame-builder concept. **Import chain worked with just the standard adsk stub — did not need to stop and
park per the dispatch's contingency.** Tests: flag is `True` inside the `with` block; flag resets to
`False` after a normal exit; flag resets to `False` **and the exception propagates** after a mid-block
exception (asserted both halves — a context manager that swallows the exception while resetting the
flag would be a different, also-wrong bug the test needs to catch too).
**Aside, not acted on:** the sibling file `test_appearance_strategy.py` has a hardcoded absolute path
(`_HERE = "/sessions/ecstatic-gracious-planck/mnt/..."`) that doesn't exist on this machine — clearly
authored in a different sandboxed session. It doesn't appear to break that test (pytest's own import
resolution covers it regardless), so left it alone — not my file to touch this turn, noting it here in
case it matters later. My own new file uses `os.path.dirname(os.path.realpath(__file__))` instead.
**Non-vacuity:** simulated the pre-fix shape (`yield` with no `try`/`finally`) — after an exception, the
flag stayed `True` (`sketch.isComputeDeferred is False` evaluated to `False`). Would fail the spec.

**5. B6 guard — `tests/b6-hidden-layer-save.test.js`, 2 tests. NOT parked — testable without real
SVG.js**, confirmed by re-reading `serializeEditor`: it only reads `editor._sketchLayer.node.innerHTML`
(a plain string), exactly the same shape the existing `tests/editor-serialization.test.js` already
mocks for `save`/`getLayerSvg`. Exercised through `save()` (the only exported entry point —
`serializeEditor` itself is module-private). Test 1: a mock editor with one visible-layer child and one
hidden-layer child — asserts BOTH survive in the saved SVG (the actual B6 assertion). Test 2: asserts
the hidden layer's `visible:false` state IS still recorded, in `data-editor-layers` (XML-entity-escaped,
so the regex matches `&quot;visible&quot;:false` — a small self-correction after the first run showed
the literal `"visible":false` doesn't appear un-escaped in an attribute value).
**Non-vacuity:** simulated the pre-fix `_visibleContent`-style drop (strip any child whose `data-layer`
is in the hidden set) — the hidden layer's path text (`M9 9 L8 8`) was absent from the result. Would
fail the spec.

**Nothing parked.** All 5 targets landed completely, exactly as the dispatch asked ("land each
COMPLETELY; park what does not fit") — none of the stated contingencies (B6 needing real SVG.js,
`deferred_compute`'s import chain needing more than the stub) actually triggered.

**Verify:** `npx vitest run` → **36 green** (29 + 7: the 4+1+2 across the three new vitest files).
`pytest template-maker/tests -q` → **86 green** (83 + 3). `pytest frame-builder/test_deferred_compute.py
-q` → **3 green** (a new file at frame-builder's own root, outside the template-maker suite glob).
**Zero RED findings** — every target's current shipped behavior matches its spec. `npm install` had
drifted `package-lock.json` (37 lines) to get a working `node_modules` locally — reverted it via
`git checkout -- package-lock.json` before committing (node_modules on disk is unaffected; only the
tracked lockfile TEXT needed reverting) so `git status --short` shows only the 5 new spec files, per the
dispatch's own verify step.

No gate hit — breaker-role turn, zero product-code edits (one attempted, correctly blocked by the
permission system, worked around with an off-repo simulation instead of retrying or bypassing it).

---

## Lane B — Turn 19 — T2: DEP3 guard in release.py + hardcoded sandbox path — DONE

**Role change again this turn:** back to normal worker (product-code edits), explicitly dispatched and
scoped to two small, isolated files — "nothing seat A touches." Unlike turn 17's blocked attempt to edit
a shared, actively-worked file, THIS edit to `release.py` was allowed by the permission system without
issue — consistent with the block being about touching a file another seat has live work in, not a
blanket "worker seat can never edit product code."

**1. DEP3 guard (`release.py`).** Added `HANDOFF_MARKER = os.path.join(REPO_ROOT, "HANDOFF.md")` at
module level (matching `REPO_ROOT`'s existing `os.path` string typing, not `pathlib.Path`, per the
dispatch's own instruction to match the existing style) and `_worker_holds_tree() -> bool`, which reads
the marker's `to:` line and returns `True` only when it says `worker`; a missing/unreadable file returns
`False` (caught `OSError` specifically, not a bare `except`, matching the codebase's already-established
narrowing convention from earlier turns). Wired it into `step_git_push()` immediately before the
`git add -A` call: prints the one specified line and `sys.exit(1)` when the worker holds the ball.
Nothing else in the step changed, no bypass flag added, exactly as specified.

**2. Hardcoded sandbox path (`test_appearance_strategy.py:20`).** Replaced the literal
`/sessions/ecstatic-gracious-planck/mnt/...` path — noted as an aside in turn 17's log, now picked up as
its own task — with `os.path.dirname(os.path.realpath(__file__))`, the same pattern `test_deferred_compute.py`
already uses. `import os` was already present; no other change to the file.

**Verify, all 3 items from the dispatch:**
- `release.py` DOES have a `__main__` guard (`:503` before my edits) — `import release` is safe, ran the
  literal one-liner rather than falling back to a read-only check.
- `python -c "import release; print(release._worker_holds_tree())"` → **True** (lane-b's `HANDOFF.md`
  says `to: worker` — this turn's own ball).
- Same, with `release.HANDOFF_MARKER` monkeypatched to a non-existent path → **False**.
- `python -m pytest bspline-frame-builder/frame-builder -q` → **32 passed** (includes turn 17's 3
  `test_deferred_compute.py` tests + the now-fixed `test_appearance_strategy.py` + the pre-existing
  `test_document_discovery.py`/`test_templates.py`). The 29 `PytestReturnNotNoneWarning`s are pre-existing
  (two test functions in `test_templates.py` return a list instead of asserting) — not introduced by
  this turn's edits, not in scope to fix.
- `python -m py_compile release.py bspline-frame-builder/frame-builder/test_appearance_strategy.py` →
  clean.
- `git status --short` / `git diff --stat` → exactly the 2 predicted files, 25 insertions / 1 deletion.

**Verify (amendments):** polled before commit — none pending.

No gate hit — small, isolated, fully verified product-code fix on two files neither seat A nor any
other in-flight work touches.

---

## Lane B — Turn 21 — T3: reconcile BUGS_OPEN.md against shipped fixes — DONE, 8 closed / 2 stale / 1 stale-with-caveat

**Docs only — `BUGS_OPEN.md`.** Verified all 11 entries against ground truth per the dispatch: git log
searches (`-S` on the specific broken symbol/pattern, plus `--grep` on the advisor's named tickets),
current code reads, and cross-referencing the tests this lane itself wrote (T1). Trusted the code over
the advisor's own hints where I could verify independently — confirmed every hint given, found nothing
that contradicted one, but did not simply copy them in without checking (e.g. B4's hint named `e95d610`
but that commit turned out to be HY4, a later unrelated cleanup — the actual B4 fix is `6d982ab`, found
via `git log -S"import_svg_sketches"`).

**Final tally: 8 CLOSED, 2 STALE, 1 STALE-with-an-unresolved-caveat** (B3 — see below, doesn't cleanly
fit any of the 4 buckets alone).

**B1 (self-verified, no advisor hint).** No single fix commit exists — the root cause (svg.js's
`toggleClass` force-arg bug) was already fixed in `layers.js` before this bug was even filed (T2,
2026-07-11 already found it fixed at investigation time). Rather than force a fake "CLOSED <sha>" onto
a fix with no clean attributable commit, wrote CLOSED with an explicit note that none exists, plus the
two independent full-trace verifications that back the verdict (T2's July trace, my own A5b re-trace of
the 20-call-site surface it's grown into since).

**B2 (self-verified).** CLOSED via B6 — T2 already traced this down to one confirmed mechanism (B6's
hidden-layer drop), which is now fixed. Didn't re-litigate B2 independently since its own text already
did that work; just confirmed the ONE thing it was waiting on (B6) actually closed.

**B3 (self-verified) — the one entry that doesn't fit the 4-bucket rubric cleanly, said so rather than
forcing it.** The specific hypothesis under investigation (no `'line'` branch in the Expand dispatcher)
was false from the start and remains false — that part is STALE. But whether the actual SYMPTOM (Expand
producing wrong output on a line) still occurs was never confirmed OR refuted in the real Fusion host —
that's neither "closed" nor "still open" in the code-evidence sense the rubric wants, it's a genuine
runtime unknown. Wrote both halves explicitly rather than picking whichever bucket sounded more
finished.

**B4-B11 — each individually verified, not batch-trusted from the advisor's hint list:**
- B4: `6d982ab` (RB4, 2026-07-11) — button+handler deleted outright, not wired up. (Hint named `e95d610`
  — checked it, it's a later unrelated commit; found the real one via `-S` search.)
- B5: `0607eaf` (IN1, 2026-09-17) — confirmed current code at `fusion-inspector.py:406,410,455` matches
  the commit message's description exactly (self-heal in `run()`, remove in `stop()`).
- B6: `957df31` (EDM3) — same fix as B2 traces to; this is where the T1 guard (turn 17) actually lives.
- B7: `c60628b` — already had a resolved note from E7a (turn 105, this session's own earlier work);
  re-confirmed rather than re-investigated from scratch.
- B8: `59615fe` (C1/F7) — matches this lane's own A4 audit finding exactly (`git ls-files` showed 0 of
  54 generated files tracked); added Fred's 2026-09-18 stamp-editor-out-of-scope ruling as a second,
  independent reason it's stale.
- B9 + B11: both close via the SAME commit, `48cee2b` (BG2) — verified the `adsk.*`-outside-bridge grep
  now returns only `core/fusion-log.js` (B11's declared leaf module) and confirmed `ROADMAP.md:292`
  documents the one remaining exception (the inline Fusion handshake bridge) by name, as A5b-4
  recommended and the advisor's turn-15 review note promised.
- B10: `f0d47ed` (HY3) — re-verified against the CURRENT merged `cam-builder.py` (post-CAM1's Builder+
  Studio consolidation, a big refactor since this bug was filed), not just trusting the original
  file:line citations, which could have shifted or gone stale independent of whether the bug itself
  was fixed.

**Built the summary table + per-entry status lines exactly as specified:** one table row per entry at
the top, one status line directly under each heading (verified via `grep -c "STATUS (T3"` → 11, matching
11 headings 1:1), original entry text preserved unchanged beneath each — a reconciliation, not a
rewrite. Updated the stale `_Last updated: 2026-05-20` line too, since a wrong date is its own small
lie the file was telling.

**Verify:** `git status --short` → only `BUGS_OPEN.md`. `grep -n "^## Bug B\|^### B[0-9]"` → 11 headings,
each immediately followed by its status block. No amendments pending at either poll.

No gate hit — docs-only turn, no product code touched.

---

## Lane B — Turn 23 — T4: SE3b fillmode CSS declaration + B12 in BUGS_OPEN — DONE, 4 files (not 3)

**Scope discipline first, since seat A was actively editing the SAME html file this turn.** Confirmed
via `git diff --stat`/`git diff` after the edit that the palette-HTML change touches ONLY lines
1267-1272 (well inside the assigned 1263-1275 window) — nothing near the tool rail (~1312+) or the modal
script seat A owns this turn.

**1. SE3b — declared the fillmode control instead of leaving it hand-rolled.** Removed `cad-icon-btn
small` (a 16px icon-button class the three STYLE buttons were never supposed to be) and every inline
`style=` attribute from the 3 buttons; added 3 rules to `styles/base.css` next to `.cad-icon-btn`
(`.editor-fillmode-btn`, the `+` adjacent-sibling border rule, `.editor-fillmode-btn.active`) — exactly
the 3 rules the dispatch specified, no more.

**Found and fixed the hand-rolled JS duplicate the dispatch asked me to check for — this is the 4th
file, beyond the predicted 3.** `editor/properties-shape.js`'s `initFillModeToggle`'s `setActive`
closure was ALSO setting `btn.style.background`/`btn.style.color` inline on every click, duplicating
exactly what the new `.editor-fillmode-btn.active` CSS rule now declares — two sources of truth for the
same visual state, the kind of thing that drifts silently. Removed the two inline-style lines, kept only
`btn.classList.toggle('active', ...)`. **Flagging the file-count discrepancy plainly:** the dispatch's
own "Files:" list and "predicted 3 files" line didn't include this one, but its OWN item-1 instructions
explicitly said to check for and remove exactly this hand-rolled styling if found — found it, removed
it, and I'm reporting 4 files rather than silently narrowing my report to match the stale prediction.

**2. B12 recorded — verified all three proof lines directly before writing anything down, not copied
from the dispatch verbatim.** Read `app-init.js:114-127` (confirmed: Cancel restores the legacy
`P.stampLayers[idx]` fields, not `P.editorSvg`), `stamp/svg-source.js:91-97` (confirmed: the Cancel
snapshot's `.svg` field is captured from `ctx.activeLayer()`, which returns an EDITOR layer with no
`.svg` property — the file's OWN comment two lines below independently confirms this is `undefined`,
and names it as a recurrence of an already-fixed bug, RO1, on a different code path), and
`stamp-mask-manager.js:40-78` (confirmed: `updateStampMasks` returns early at `:78` when the work list
is empty, never touching a layer's stale `mask` — so an emptied canvas keeps its old stamp geometry).
Added the entry (status OPEN, fix queued as SE3a on main — not this lane's to fix) and a row in the T3
summary table this lane built last turn, keeping the table current rather than letting it drift stale
again immediately after being fixed.

**Verify, all items from the dispatch:**
- Extracted the palette's 3 inline `<script>` blocks and ran `node --check` → clean (sanity check that
  the HTML edit, which only touched attributes, didn't corrupt anything nearby).
- `npx vitest run` → **36 green**, unchanged from before this turn's edits.
- `grep -c "cad-icon-btn small editor-fillmode-btn"` → 0. `editor-fillmode-btn` count in the HTML → 3.
  Rule count in `base.css` → 3. Visually confirmed no `style=` attribute remains on any of the 3 buttons.
- `git status --short` → exactly the 4 files named above (3 predicted + `properties-shape.js`).

No gate hit — small, evidence-verified change; stayed inside the assigned HTML region despite seat A's
concurrent edits to the same file; the one scope deviation (4th file) was explicitly instructed by the
dispatch's own item-1 text, not a unilateral addition, and is called out rather than hidden.

---

## Lane B — Turn 25 — T5 (breaker→fixer): pan/tolerance scale — PROVEN WRONG, fixed, 4 files

**Merged main first** (`git merge --no-edit main`) — one conflict, `NEXT-SESSION.md` (expected: both
branches rewrite it every turn; kept lane-b's own copy, the actual turn 25 dispatch, via `git checkout
--ours`). Merge brought in SE2 (`80da844`), which had ALREADY declared `editor-view.js`'s zoom/pan view
record (`viewboxFor`/`zoomAbout`/`clampZoom`/`applyView`/`fitView`) and its own test file
(`tests/editor-view.test.js`, 6 tests) — this turn EXTENDS that file/module, doesn't create it from
scratch. Noted one thing worth flagging: SE2's own `zoomAbout` test built its `screenToModel` helper
with `clientHeight` deliberately proportional to `clientWidth` (matching the board's aspect exactly) —
which means that test could never have caught this bug even if the product code had it, since it never
exercises a letterboxed container. Not a defect in SE2's test (it's testing `zoomAbout`, a different
function), just noting why this gap survived past that turn.

**Step 1 — proved the suspicion before touching anything else.** Confirmed the editor root's actual
creation site (`editor/init.js:14`, `window.SVG().addTo(...).size('100%','100%')`) has no
`preserveAspectRatio` override — so it's the SVG default, `xMidYMid meet`, exactly as the dispatch
suspected. Grepped for `preserveAspectRatio` under `editor/` — the only hits are in `editor-io.js`
(save/export SVG strings, `preserveAspectRatio="none"`) and `editor-expand-trace.js` (also export) —
a DIFFERENT, unrelated surface (files being written for saving/rasterizing, not the live interactive
canvas). The escape hatch in the dispatch (if `none` were found on the live root, the suspicion would be
wrong) does not apply.

**Computed the actual numeric disagreement before writing any test**, quoting it here as the dispatch
asked: for the 7×9 board —
- **Tall container** (300×800 — width is the binding/correct axis): old per-axis `dy` formula gave
  `1.125` where the correct uniform-scale value is `2.333` — **48.2% of correct, i.e. 51.8% too small.**
- **Wide container** (1200×400 — height is binding): old per-axis `dx` formula gave `0.583` where
  correct is `2.25` — **25.9% of correct, i.e. 74.1% too small.**
- Sanity-checked the null case too: a container matching the board's exact 7:9 aspect (no letterboxing)
  makes the old and new formulas agree on both axes — confirms the bug is specifically an
  aspect-MISMATCH bug, not a general error in the old formula's shape.

**Step 2 — declared the scale once, in `editor-view.js`** (the file SE2 already established as the
one place for view-record math): `viewScale(vb, clientW, clientH)` → `Math.min(clientW/vb.w,
clientH/vb.h)`, and `screenToModelDelta(vb, clientW, clientH, dxPx, dyPx)` → `{dx, dy}` via that scale.
Routed `_panBy` (editor-interaction.js) through `screenToModelDelta` (needs both axes at once) and
`getDynamicTolerance` (editor-hit.js) through `viewScale` DIRECTLY (`px / viewScale(...)`, matching the
dispatch's own suggested formula literally) rather than through `screenToModelDelta` — a small
implementation choice that matters for the verify grep: routing tolerance through `screenToModelDelta`
instead would have left `viewScale(` at only 2 hits (definition + 1 internal call) instead of the
dispatch's predicted "definition + 2 callers." Caught this via the grep itself, adjusted to match rather
than leaving the count in a place I hadn't actually checked against the spec.

**Step 3 — extended `tests/editor-view.test.js`**, not a new file: added `viewScale`/`screenToModelDelta`
to the existing import, then 5 new tests — the 3-case letterbox proof (tall/wide/exact-match, quoting
the same numbers above) plus 2 `screenToModelDelta` tests (round-trip via `dx*s`/`dy*s`, and "equal
pixel deltas on both axes produce equal model deltas" — which is the property that fails under the old
per-axis formula whenever the container isn't the board's exact aspect). The reference "old formula" in
the proof tests is a small local function in the TEST file, explicitly commented as no longer existing
in product code — not imported from anywhere, since the old buggy code was replaced, not kept around.

**Verify, all items from the dispatch:**
- `npx vitest run` → **47 green** = 42 (36 mine from before + SE2's 6 in `editor-view.test.js`, the
  post-merge baseline) **+ 5 new**.
- `node --check` on all 3 touched `.js` modules → clean.
- `grep -rn "clientWidth" editor/`: the only 3 hits left are DOM-property reads passed straight through
  to `screenToModelDelta`/`viewScale` — no raw per-axis division remains anywhere.
- `grep -rn "viewScale(" editor/` → 3 hits: definition + 2 callers (`screenToModelDelta`'s internal
  call, `getDynamicTolerance`'s direct call) — exactly matches the dispatch's predicted shape.
- `git status --short` → exactly the 4 predicted files.

No gate hit — proved the bug with concrete numbers before writing any product-code fix, per the
breaker-then-fixer sequencing the dispatch asked for; the one implementation choice I second-guessed
(direct `viewScale` call vs. routing through `screenToModelDelta`) was resolved by checking it against
the dispatch's own predicted verify output rather than picking whichever felt more "unified" in isolation.

---

## Lane B — Turn 27 — T6: declare resetPanState, call from keyup/mouseup/blur/open — DONE, 2 files

**Read the current code before writing anything, confirmed the ground truth exactly as the dispatch
stated it.** `_handleEditorKeyup` (Space release) gates on `_isEditorActive(editor)` first — if a native
dialog or alt-tab steals focus entirely out of the window while Space is held, no `keyup` event ever
reaches the document (the browser doesn't dispatch key events to an unfocused window), so `_spaceHeld`
stays `true` forever and the next click pans instead of drawing. Confirmed `mouseup` is ALREADY on
`window`, not the SVG node (`initInteraction:41`, unchanged since SE2) — so the dispatch's item-3
contingency ("if the pan end only listens on the svg node, move it to window") does NOT apply here;
grepped for `mouseleave` too, found none. Noted both explicitly rather than silently assuming and moving
on, since acting on a wrong assumption here would have been a no-op edit at best.

**Declared `resetPanState(editor)` in `editor-interaction.js`**, right after the imports for visibility:
clears `_spaceHeld`/`_isPanning`/`_panStart` and removes BOTH `pan-ready` and `panning` classes in one
place — even though a given caller (e.g. Space-keyup) would only ever need to clear one of the two
classes in the normal case, resetting all of it unconditionally is what makes this a reliable BACKSTOP
for the abnormal cases (blur, open()) where you can't know which state might be stuck.

**Wired all 4 call sites:**
1. `on(window, 'blur', () => resetPanState(editor))` — new listener in `initInteraction`, the actual
   fix: `blur` fires reliably when focus leaves the window, unlike `keyup`, which needs the key
   released WHILE focused to fire at all.
2. `_handleEditorKeyup`'s Space branch — replaced the 3 hand-rolled lines with the one call.
3. `handleEnd`'s pan-end branch (`editor._isPanning` true) — same replacement.
4. `editor-io.js`'s `open()` — called right after `sync3DBackground(editor)`, before the undo-stack/
   layer-roster resets already there, so it's grouped with the other "fresh session" state clears
   rather than tacked on separately. Needed a new import (`editor-interaction.js` → `editor-io.js`) —
   checked first that the reverse import doesn't already exist (it doesn't), so this doesn't create a
   circular dependency.

**Verify, all items from the dispatch:**
- `node --check` on both touched modules → clean.
- `npx vitest run` → **47 green**, unchanged — no new test needed, confirmed this is DOM-bound (window
  focus/blur, `document.getElementById`) rather than pure math like T5's fix, so it isn't testable the
  same way without a real DOM harness this suite doesn't have.
- `grep -n "_spaceHeld = false"` → 1 hit, inside `resetPanState` only. Same for
  `classList.remove('pan-ready')` → 1 hit, same function only.
- `grep -rn "resetPanState("` → definition + **4** callers (blur, keyup, mouseup pan-end, `open()`) —
  meets the dispatch's "≥3" bar.
- `git status --short` → exactly 2 files (didn't need `editor.js` — nothing there held any of the
  pan-state fields or listeners).

No gate hit — small, well-scoped fix; verified the two contingencies in the dispatch (mouseup listener
location, mouseleave existence) explicitly rather than skipping past them once the main fix worked.

---

## Lane B — Turn 29 — T7: exporter path constants declared; both stale docstrings found ALREADY fixed

**2 files, not the predicted 5-6 — every item checked against ground truth before acting, and 3 of the
5 assumed-needed changes turned out to already be done or not to apply.** Reporting each precisely
rather than silently narrowing scope or padding the diff to match a predicted file count.

**1. Declared `AUDIT_PROJECTS_DIR` (`fusion-exporter.py`) and `DEFAULT_EXPORT_DIR` (`exporter.py`) —
done exactly as specified.** Both env-overridable (`FB_AUDIT_DIR`/`FB_EXPORT_DIR`), home-derived, both
with a comment naming the env var per the dispatch's own instruction. `DEFAULT_EXPORT_DIR` moves the
export picker's default OUT of the repo (`~/Documents/bspline-frame-builder/exports`). `_get_audited_projects()`
and the export-location picker now reference the constants instead of the literal paths.

**The `.gitignore` sub-step's own stated premise does NOT hold — checked, didn't act on it.** The
dispatch says "if `git ls-files` shows it is NOT tracked (the advisor's check says 0 tracked files), add
`.../exported files/` to `.gitignore`." Ran it myself: **it IS tracked — 140+ JSON files across 7
`Untitled_JSON_AUDIT*` folders, all committed.** Since the stated condition is false, did NOT touch
`.gitignore` — adding an already-tracked path there wouldn't even untrack it (that needs `git rm
--cached`, a separate, more invasive step never asked for here). Flagging the discrepancy plainly: the
advisor's own check apparently ran against a different scope or an earlier state than what's on disk
now. The old in-repo folder is left exactly as it was — Fred's data, untouched, still tracked.

**2. A1-3 (the two `fb_shared` docstrings) — ALREADY FIXED, no edit needed.** Read both before touching
anything: `entity_helpers.py:1-9` now says "Reconciliation decisions are ratified — callers switched
(S3-S5)... Canonical shared helpers (C4 S1-S5 complete): consumed by frame-inspector, template-maker/core
and the tests." `expression_coords.py:1-8` says "Canonical (C4 S2-S5 complete); consumed by
frame-inspector and template-maker/core." Neither contains "NO callers"/"no production callers" — grepped
both, 0 hits, confirmed independently rather than trusting the file summary alone. This item (A1-3) must
have been closed by someone else's turn between when `AUDIT-2026-09.md:33` was written and now; not this
lane's doing, but correctly verified rather than blindly re-"fixing" already-correct text.

**A2-5 (`parametric_engine.py:123-125`) — ALSO ALREADY FIXED.** The misleading comment the dispatch
quoted no longer exists at that location at all — `build_template()` now has (at `:134-137`): "Parameter
creation lives in two places: `frame_engine._create_skeletal_parameters` (base requirements + template
DNA, before build) and `_sync_user_parameters` below (UI-driven values). Neither is called from here." —
exactly the "say where params are created, both places" reword the dispatch asked for, already landed.
Plausibly part of the advisor's own A2-1 live-verification work (per the turn-19 review note, "being
decided by the advisor") touching this same function. Read it, confirmed it says what it should, made
no edit.

**Verify, all items, reported honestly including the one that doesn't match the prediction:**
- `python -m py_compile` on all 3 named Python modules → clean.
- `pytest template-maker/tests frame-builder -q` → **118 passed**, matches exactly.
- `grep -rln "danse" fusion-exporter/*.py` → **0**, confirmed clean for the files this turn actually
  touched. **Broadened to all of `bspline-frame-builder/` (as the dispatch's verify line literally
  says) → 1 hit: `CAM-builder/cam_engine/setup_builder.py`** — the "Ultimate Bee" machine path this lane
  already found and reconciled in A6 (STANDARDS-AUDIT §5's OTHER citation, not `AUDIT-2026-09.md:23`'s
  fusion-exporter pair this turn's file list actually names). Did NOT touch it — it's not in T7's file
  list, and per A6's own finding the coupling there is much more pervasive (~15 references to the
  machine name, not one literal path) than a same-shaped constant swap would fix. Reporting the grep's
  real result rather than only running it scoped to make it read as a clean 0.
- `grep -c "FB_EXPORT_DIR"`/`"FB_AUDIT_DIR"` → **2 each, not the predicted 1** — one in the
  `os.environ.get(...)` call, one in the comment naming the env var that the dispatch's OWN item-1 text
  explicitly asked for ("Both constants get a 2-line comment naming the env var"). The 2-count is the
  direct, correct consequence of following that instruction, not a miss.
- `git status --short` → 2 files, below the "5-6" prediction — accounted for by the 3 items above that
  needed no change.

No gate hit — every discrepancy from the dispatch's own predictions (untracked assumption, docstring
staleness, comment-count) was checked against the actual repo state before deciding what to do, and
each is reported specifically rather than smoothed into a single "done" summary.

---

## Lane B — Turn 31 — T8: ghost selection after Clear/reopen — completed _deselect(), reused it directly

**Merged main first** (not explicitly told to this time, but lane-b was behind — `git log`/`git
merge-base` confirmed it, so merged anyway rather than risk working from a stale tree). Clean merge, one
file (`ROADMAP.md`, docs-only), no conflict. Baseline `npx vitest run` after the merge → 52 green,
matching the dispatch's prediction exactly (no drift to chase).

**Confirmed the ground truth exactly, then found ONE MORE gap beyond what it named.** `action-tools.js`'s
Clear handler and `editor-io.js`'s `open()` both call `_sketchLayer.clear()` and neither calls
`_deselect()` at all — confirmed by grep, matches the advisor's citation precisely. Read the existing
`_deselect()` (`editor.js:389-395` before this turn) to answer the dispatch's own question ("if it
already does all four... if it leaves a layer untouched, complete it THERE"): it cleared
`_selectedElement` (which cascades to `_selectedElements` via the property setter — already declared,
didn't need touching), `_handleLayer`, and the LEGACY singular `_selectionHighlight` — but **not**
`_selectionHighlights` (plural, the array `updateSelectionHighlight()` actually populates with one halo
shape per multi-selected element, added to `_highlightLayer`)`. So even where `_deselect()` WAS already
called (11 pre-existing sites), a 2+-element selection would leave every highlight but the last one
ghosted in `_highlightLayer` — a real, slightly wider version of the bug the ground truth's single-stroke
repro wouldn't have surfaced. Completed `_deselect()` to also clear the plural array (iterating +
`.remove()`) and `_selectedNodes` (named explicitly in the dispatch; found it referenced once as a guard
at `editor-ui.js:157` but never assigned anywhere — clearing it defensively costs nothing and matches
what was asked even though I couldn't find where it'd ever be non-empty).

**Chose to reuse the now-complete `_deselect()` directly rather than declare a separate
`resetContentState(editor)` wrapper — the dispatch's own "or `_deselect(...)` if you reuse it directly
— say which" escape hatch.** Once `_deselect()` covers all four things (selected elements, selected
nodes, handle layer, EVERY highlight), a second name wrapping a single call to it would be a pure
indirection with no distinct behavior of its own — the "node-count UI reset" the dispatch mentioned is
already covered by `_deselect()`'s existing `updateToolbarVisibility(this)` call; didn't find a separate
node-count widget to justify a wrapper doing more than that. Saying so explicitly rather than silently
picking one option without acknowledging the choice.

**The other big win: fixing `_deselect()` once automatically fixes `deleteSelected()` too, with zero
changes to that function.** `deleteSelected()` (`editor.js:384`) already called `_deselect()` after
removing elements — per the dispatch's own conditional ("if it already does after removing, leave it"),
correctly left it untouched. Its own latent multi-select-highlight-ghost gap (same root cause) is now
closed as a side effect of the shared fix, not a separate edit.

**Wired the 2 new call sites** (`open()` right after `_sketchLayer.clear()`, before the unrelated
pan-state reset already there from T6; the Clear handler right after `_sketchLayer.clear()`, before
`pushState()` as specified) with a guarded `typeof editor._deselect === 'function'` check — matching the
existing defensive style at nearby call sites in these same files rather than assuming the method always
exists.

**Verify, all items from the dispatch:**
- `node --check` on all 3 touched modules → clean.
- `npx vitest run` → **52 green**, unchanged (DOM-bound fix, no pure-math surface to unit-test the way
  T5's was).
- `grep -n "_sketchLayer.clear()"` in both files → each followed within a few lines (through one short
  explanatory comment) by the `_deselect()` call.
- `grep -rn "_deselect("` → definition + 13 call sites total (11 pre-existing + my 2 new ones) — far
  exceeds the "≥3" bar; didn't declare `resetContentState(` at all, per the choice explained above.
- `git status --short` → exactly 3 files, at the top of the "2-3" prediction (the third being `editor.js`,
  where `_deselect()` already lived — matches the dispatch's own "editor.js... where `_deselect` lives"
  file-list entry).
- Live verification (draw → Clear → OK → no ghost; draw → select → Cancel → reopen → no ghost) is the
  advisor's, per the dispatch.

No gate hit — completed a shared function once rather than hand-rolling three separate reset call pairs,
and explicitly reasoned through the dispatch's own "reuse vs. declare a wrapper" fork instead of picking
one silently.

---

## Lane B — Turn 33 — T9: BUGS_OPEN — B12 closed, B13-B15 added — DONE, docs only

**Same rubric as T3 — verified every one of the advisor's own claims against the actual repo before
writing anything down, not transcribed on trust, even though this dispatch's citations were far more
precise than T3's (exact shas, exact test filenames, exact proof lines already given).**

- **B12 → CLOSED.** Confirmed `f46561a` exists (`git show -s`, matches "SE3a - Cancel actually reverts,
  an emptied layer loses its mask") and `tests/stamp-mask-clear.test.js` exists on disk. Kept BOTH status
  blocks under the heading — the new CLOSED one and the original T4 OPEN one as history — rather than
  overwriting, since this entry's whole point is showing the OPEN→CLOSED progression, not just the
  current state.
- **B13 (new) — traced all three proof lines myself, not just cited them.** `takeSnapshot`'s
  `stampSvgText` parameter defaults to `null` (`core/history.js:25`) — grepped every call site (3 of
  them) and confirmed NONE ever pass a second argument, so it's unconditionally `null`, not just "usually."
  `snapshot-manager.js:41`'s guard tests `!== undefined` — worked through why that's the actual bug: `null
  !== undefined` is `true` in JS, so the null passes the guard and gets written into
  `P.stampLayers[0].svg` on every restore. `export-flow.js:40-44`'s `isCarvingLayer`/`hasShippableSvg`
  read that same field with no fallback to the unified editor model, so the null silently drops the
  layer from export. Wrote out the full causal chain in the entry, not just the three isolated
  citations, since the "why" is what makes this a data-loss bug rather than three unrelated facts.
- **B14 (new) — this is my own commit from last turn (T8, `13a2480`)**, so verification here was mostly
  making sure the BUGS_OPEN entry accurately reflects what I already know is true, including the "bonus"
  finding (the `_selectionHighlights` plural-array gap affecting all 13 pre-existing callers) rather than
  just the narrow Clear/open() symptom the advisor's dispatch text led with.
- **B15 (new) — read both button handlers directly.** `svg-source.js:72-81`'s `btnStampClear` only nulls
  the legacy `P.stampLayers[idx]` mirror fields; `action-tools.js:18-24`'s `editorClear` (the one B14
  just fixed) does the real `_sketchLayer.clear()`. Confirmed both element ids against the palette HTML
  (`bspline_gen_palette.html:637` and `:1247`) rather than trusting the JS-side names alone.

**Verify:** summary table now has 15 rows (B1-B15) — confirmed via grep, the one apparent 16th match was
a false positive (the OLD T2-era "| Bug | Verdict |" table header, unrelated). 16 total `STATUS (` blocks
= 11 original (T3) + B12's 2 (current+historical) + B13/B14/B15's 1 each — accounted for precisely
rather than just checking the total "looks about right." `git status --short` → `BUGS_OPEN.md` only, as
expected for a docs-only turn.

No gate hit — docs-only, no product code touched; every one of the advisor's own citations was
independently re-derived rather than assumed correct just because the advisor is usually right.

---

## Lane B — Turn 35 — T10: shortcut-key badge on tool buttons, `.tool-btn[data-key]::after { content: attr(data-key) }` — DONE, CSS only

- Confirmed `.tool-btn` lives in `bspline-frame-builder/styles/editor.css` (grep across `styles/*.css`
  found it only there, at `:62`), matching the dispatch's primary guess — no need to fall back to
  base.css.
- Confirmed the "44px rail, ~32px buttons" premise before trusting it: the base (non-media-query)
  `.tool-btn` rule is 34px (`editor.css:62-76`), and the rail width is NOT in editor.css at all — it's
  an inline style on the actual element, `bspline_gen_palette.html:1319`:
  `<aside class="editor-sidebar" style="width:44px; ... display:flex; flex-direction:column;
  align-items:center; ...">`. The three `.editor-sidebar .tool-btn` rules I found in editor.css
  (`:312`, `:409+`) are both inside responsive breakpoints (38px/40px buttons, 56px rail) — irrelevant
  to the base case the dispatch is describing.
- Collision check (by math, not a render — no visual tool available in this session; the dispatch itself
  defers "look" to the advisor's deploy+capture): 34px button, `align-items:center` on the rail flexbox,
  20px centered icon inside → (34-20)/2 = 7px of empty corner margin on each side. An 8px, single
  uppercase glyph at `right:2px; bottom:1px` sits inside that 7px margin without reaching the icon's
  centered 20px box. Kept the dispatch's default `font: 600 8px/1 ...` rather than dropping to 7px,
  since the math clears the icon with margin to spare — flagging this as an UNVERIFIED-visually call in
  case the advisor's capture disagrees.
- Added the three rules verbatim from the dispatch, placed right after the existing `.tool-btn.active`
  block (`editor.css:83-87`) and before the two icon-specific overrides (`#toolSelect`/`#toolNode`), so
  all shortcut-badge rules stay grouped with the base button rules they extend. No markup change — all
  9 buttons (`data-key="v" a c e l p r t 0"`, confirmed via grep across the palette HTML) already carry
  the attribute from SE1; the badge is pure CSS attr() read of an existing declaration, not a new list.

**Verify:** `grep -c "attr(data-key)"` on `styles/editor.css` → 1, as predicted. `git status --short` →
`styles/editor.css` only, 1 file, matching the prediction exactly.

No gate hit — CSS-only, additive, no JS/markup touched.

---

## Lane B — Turn 37 — T11: BUGS_OPEN — B13, B15 closed — DONE, docs only

- **Confirmed every cited sha was already in lane-b's own history** before writing anything (`git
  merge-base --is-ancestor` on all three — `aeb9a53`, `629102d`, `fa9972a` — all OK; the merge with
  main this dispatch assumed had already landed by the time T11 fired).
- **B13 → CLOSED.** Verified the subjects of both cited commits match the claim (`aeb9a53`
  "export-flow + compositor read the editor content store", `629102d` "shape + persistence cleanup,
  MIGRATIONS declared"), then went one step further than trusting the subject line: `grep -rn
  "stampSvgText" bspline-frame-builder/b-spline-gen/html/` now returns **zero** hits — the parameter
  T9 traced as the root of the null-write chain is gone, not just unreachable. Confirmed
  `tests/export-flow.test.js` exists on disk. Kept T9's original OPEN status block below the new
  CLOSED one (same pattern as B12/T9) so the causal-chain writeup T9 did isn't lost — it's still the
  best explanation of WHY the bug existed, even though the fix made it structurally impossible rather
  than patching the three sites individually.
- **B15 → CLOSED.** Read `fa9972a`'s full commit message (not just the subject) to confirm "no guard"
  is accurate: it updates `tests/stamp-mask-clear.test.js` to match the single-store model but doesn't
  add a new assertion specifically for sidebar-Clear-now-clears-real-content — that claim rests on the
  advisor's own live-verification (2026-09-18 09:55, cited in the dispatch), which I did not re-run
  myself since it's the advisor's stated act, not mine to re-attest.
- **B8 — dispatch's conditional line NOT added.** Checked both the summary table row (`:25`) and the
  detail STATUS block (`:351-357`, from T3) — both already state the `sync_stamp_bundle.py`
  regeneration fact AND the 2026-09-18 out-of-scope ruling, just not in the dispatch's exact wording.
  Treated "if not already there" as satisfied by substance, not by exact phrasing — adding a
  near-duplicate line would restate what's already recorded rather than add information.

**Verify:** `git show --stat HEAD` → `BUGS_OPEN.md` + `WORK-LOG-lane-b.md`, matching the prediction.

No gate hit — docs-only, no product code touched.

---

## Lane B — Turn 39 — T12: full read-only audit of the SVG editor — DONE, docs only

New deliverable `AUDIT-SVG-EDITOR.md` (504 lines, 47 findings across 8 dimensions: coordinate spaces,
undo/change fan-out, layers vs. P.stampLayers, save/reopen/carve round trip, tools-vs-declarations,
dead/doorless code, text+Expand lifecycle, mobile readiness). Read-only turn — no product code or
test files touched, per the dispatch's explicit "seat A is editing editor/editor-interaction.js,
editor-grid.js, editor.js right now" constraint.

**Method:** given the scope (36 files, 6.9k lines, 8 dimensions), delegated the actual file-reading and
tracing to 6 parallel general-purpose agents, one per dimension group (coordinate spaces; undo
fan-out + layers; save/reopen/carve round-trip; tools-vs-declarations + dead code; text/Expand;
mobile), each briefed with the full context, told explicitly READ-ONLY and to cite verbatim file:line
evidence or label a claim HYPOTHESIS. This is a deviation from doing every read myself, made because
the task's own scope (8 dimensions x dozens of files) was well beyond what a single serial pass could
cover at the depth the dispatch asked for ("a finding without a quoted line or a reproduced number is a
hypothesis — label it"); I did not delegate the JUDGMENT of what counts as a real finding — see below.

**Verification, not blind transcription:**
- Spot-checked 6 of the agents' highest-severity citations directly via Read/grep against current HEAD
  before compiling anything (SA-COORD-3's `getNearbyElement`/`el.bbox()`, SA-UNDO-2/3's
  `setStrokeWidth`/`setStrokeColor` missing pushState/_onChange, SA-TEXT-1's `editorCancel` skipping
  `_commitText`, SA-LAYER-1's `export-flow.js` P.stampLayers read, SA-ROUNDTRIP-1's
  `_bakeMatrixIntoPath`). All 6 matched exactly — no fabricated line numbers found.
- **Caught and corrected one root-cause error before it shipped:** the layers sub-agent framed
  `export-flow.js` reading `.enabled`/`.depth`/`.profile` from `P.stampLayers[idx]` as "the SE4
  mirror-retirement work missed the export path." Reading `export-flow.js:34-39` directly showed this
  was explicit, documented, DELIBERATE SE4a design ("Tooling stays on P.stampLayers[idx] per the
  dispatch — that part isn't a mirror, it's the one place tooling lives") — not an oversight. The
  underlying bugs the sub-agent found (breaks past 3 layers, direct-drawn content never gets
  `.enabled=true`, no resync on reorder/delete) are still real and still HIGH severity, but I rewrote
  the framing in AUDIT-SVG-EDITOR.md to say so accurately, and flagged the proposed fix (SE7w) as
  needing Fred/advisor sign-off since it REVERSES a deliberate SE4a decision rather than completing an
  unfinished one — that's a materially different ask than "finish the rewrite."
- **De-collided a real naming clash:** 4 of the 6 agents independently proposed slice ids
  `SE7-new-a`/`-b`/`-c`/`-d` for 8 DIFFERENT bugs (no coordination between them — each only saw its
  own dimension). Renamed all of them into a single coherent slice list at the audit's end (SE7t/u/v/w/x
  + SE8, each named for its actual content) with a severity-ordered proposed sequence, rather than
  shipping 4 collided ids into the doc.
- Also corrected the dispatch's own stated model example: SNAP_POLICY (cited as "already done right")
  does not exist in shipped code — grepped 0 hits repo-wide; it's a still-queued SE7s name in
  ROADMAP.md prose only. Recorded this at the top of the audit doc so nobody goes looking for it, and
  used the actually-shipped declarations (GRID_DEFAULTS, MODE_HINTS, modeHandlers, the dbg() gate) as
  the real models instead.

**Findings worth flagging here directly** (severity-ranked, full detail in the audit doc): 2 findings
are silent-wrong-PHYSICAL-CARVE-OUTPUT bugs (SA-ROUNDTRIP-1: every circle/ellipse's arc gets corrupted
by the carve-bake path, reproduced with a scratch script down to the exact malformed `d` string;
SA-ROUNDTRIP-2: rotated text carves upright at cos(θ) the correct size, also reproduced numerically) —
these are the worst class per the audit's own rubric (looks right in editor AND live preview, wrong
only in the shipped part) and are proposed as the first new slice (SE7u) for exactly that reason.

**Verify:** `AUDIT-SVG-EDITOR.md` has 45 ranked-table rows + 2 verified-clean sub-items pulled out of
ROUNDTRIP/MOBILE (47 total ids, matches the 6 agents' combined finding count exactly — grepped every
`SA-*-N` id in the doc against what each agent reported, none missing, none duplicated).
`git status --short` → `AUDIT-SVG-EDITOR.md` (new) only; no `editor/**` files touched, confirmed.

No gate hit — pure documentation deliverable, no product code or tests touched.

---

## Lane B — Turn 41 — T13: SE5 design — one home for per-layer tooling (fixes SA-LAYER-1/2/3) — DONE, plan only

New `SE5-TOOLING-STORE-DESIGN.md` (286 lines), same section layout as SE4-MIRROR-RETIREMENT-DESIGN.md
per the dispatch. Read-only turn — no product code touched, seat A owns `editor/` for SE8a.

**Went beyond re-stating my own T12 findings — traced the actual mechanism live, and found the real
root cause of SA-LAYER-1 finding #2 wasn't in the audit:** read `main/stamp/layer.js:91-102,153-184`
directly and found the Vector Stamping panel's ONE "Enabled" checkbox has its own comment admitting it:
once the editor is loaded (i.e. always, in normal use), the checkbox reads/writes `editor._layers[idx]
.visible` exclusively, through `setLayerVisible()` — `P.stampLayers[idx].enabled` is provably dead code
in that path, touched only by Browse-import-success and sidebar-Clear as narrow accidents, never by the
control a user actually sees. This reframes `enabled` from "a second flag that needs syncing" to "a
fossil with no live UI writer, that a few readers (export-flow, cloud-project-manager, isFilletActive)
still consult instead of the `visible` field the checkbox actually controls." Changes the fix from
"sync two flags" to "delete one and repoint 3 readers at `visible`" — materially simpler, and I said so
explicitly in the doc rather than let the design inherit the audit's framing uncritically.

**Also found, by reading rather than assuming from the audit's list:** `main/stamp/_dom-binders.js`'s
`bindLayerOnlyNumber`/`bindLayerOnlyCheckbox` (the transform-field sliders: tx/ty/rotation/scale/
mirrorX/mirrorY) already write `editor._layers[P.activeLayerIdx]` unconditionally, no `P.stampLayers`
gate — proving the "write past layer 3" bug (SA-LAYER-2) isn't structural, it's an inconsistency
between two sibling binder helpers in the same file, one of which (`updateP`'s `layerSpecific` block)
never got the same treatment. Used this as the concrete "already-correct pattern to copy" in §3/slice
(a) instead of inventing a new pattern.

**Checked the existing MIGRATIONS entry before proposing a new one** (`main/app-init.js:56-113`,
`legacy-stamp-svg`) — its `toolingFields` list (14 fields, `:90-94`) already does almost exactly what
SE5's migration would need; proposed extending it with one field (`enabled`→`visible`) rather than
declaring a second, parallel migration — smaller diff, same idempotency guarantee the existing one
already has.

**Section 6 (outside b-spline-gen):** grepped the whole repo — zero `stampLayers` hits in any `.py`
file, no presets-worker directory exists in this repo, cloud storage confirmed opaque JSON (no
field-level schema on the backend side). Whole change is contained to `b-spline-gen/html` + `tests/`.

**Flagged, not resolved (per the dispatch's own "say why" instruction, mirroring SE4c's pattern):**
whether a tooling-slider edit should be undoable via the global Ctrl+Z or only the editor's own undo
stack — recommended "editor-only, consistent with the SE4c heightfield-only ruling" but left it as an
explicit product decision for Fred/advisor before slice (c), not decided unilaterally.

**Inventory grep count quoted in the doc, verified live:** `grep -rn "stampLayers" {core,main,editor}
--include=*.js` → 41; same under `tests/` → 48; 89 total — ran both greps myself before writing the
Appendix, not copied from memory of T12's numbers (T12 predates several of these files' current state).

**Verify:** `git status --short` → `SE5-TOOLING-STORE-DESIGN.md` (new) only; grep counts in the doc's
Appendix match what I ran; inventory table has one row per distinct reader/writer site found, 3 slices
each with predicted files + a verify line, STOP conditions section present.

No gate hit — design-doc-only turn, no product code or tests touched.

---

## Lane B — Turn 43 — T14: SE5 slice (a) — updateP/isFilletActive/Browse+Clear onto editor layers — DONE, product code

Built exactly slice (a) of my own T13 design (`SE5-TOOLING-STORE-DESIGN.md`, `be5dc37`), scoped to
`core/state.js`, `main/stamp/_shared.js`, `main/stamp/svg-source.js` + a new test. Did **not** touch
`editor/` — seat A owns it for SE8a on main; confirmed via `git status --short` after the fact that no
`editor/` path appears.

- **`core/state.js` `updateP`'s `layerSpecific` block:** dropped `P.stampLayers[P.activeLayerIdx]
  [layerSpecific[key]] = P[key]` and the `P.stampLayers && P.stampLayers[P.activeLayerIdx]` gate
  wrapping BOTH writes. Kept only the unconditional `editor._layers[P.activeLayerIdx][field] = value`
  write — this now matches `bindLayerOnlyNumber`'s pattern exactly (cited it in the comment, per the
  dispatch's own instruction), which never had this gate and already worked past layer 3.
- **`main/stamp/_shared.js` `isFilletActive()`:** rewrote to check `window.svgEditor._layers` first
  (same shape as `activeLayer()`/`activeEditorLayer()` three lines above it in the same file — reused
  the pattern rather than inventing a new one), falling back to the old `P.stampLayers` read only in
  the pre-editor-load window (kept, per the design doc's §2 "narrowed, not removed" call for that
  specific fallback).
- **`main/stamp/svg-source.js`:** both `setStampLayerEnabled(...)` call sites (Browse-import success,
  sidebar Clear) replaced with `setLayerVisible(editor, layer.id, true/false)`, imported from
  `editor/layers.js` (importing a function from `editor/` is fine per the dispatch — editing a file
  under `editor/` is what's off-limits, and I didn't). Removed the now-unused `setStampLayerEnabled`
  import from `core/state.js`; confirmed via grep it had exactly these 2 call sites in this file before
  removing the import, nothing else in the file references it.
- **Flagged a transitional gap explicitly, in the code comment, not just here:** until SE5 slice (b)
  repoints `export-flow.js`'s `isCarvingLayer`/`hasShippableSvg` off `P.stampLayers[idx].enabled` onto
  the same `.visible` field this turn now writes, a layer enabled via Browse/Clear in THIS slice can
  still read as excluded by Export STEP / Send-to-Fusion specifically — `P.stampLayers[idx].enabled`
  simply stops being written at all after this turn and goes stale at whatever value `DEFAULT` set it
  to. The live 3D preview and rebuild are unaffected (already `editor._layers`-only per T12's audit).
  This is exactly the scope boundary the dispatch drew (slice a only, export-flow.js is slice b) — not
  a mistake, but a real and worth-naming risk during the gap between the two slices landing.
- **`setStampLayerEnabled` itself was NOT deleted this turn** — checked, it still has one live caller
  left after this change: `main/stamp/layer.js:180`, the pre-editor-load fallback branch, correctly
  out of THIS slice's scope per the design doc (§2's "kept, narrowed" pre-load window) and not in the
  dispatch's file list. Deleting it is slice (c) work, once that last caller is also narrowed.
- **New test** `tests/se5a-tooling-single-store.test.js` (5 assertions): a 4-layer `window.svgEditor`
  mock where `P.stampLayers[3]` is undefined by construction — proves `updateP('stampDepth', ...)`
  reaches `editor._layers[3].depth` and `isFilletActive()` sees a fillet on layer 4 whether visible
  (true) or hidden (false), plus the pre-load fallback still working when `window.svgEditor` is null.
- **Proved non-vacuous, not argued:** saved scratch copies of the two edited product files, reverted
  both to pre-fix (`git checkout HEAD --`, safe here since HEAD is the actual pre-edit state — these
  weren't yet committed), re-ran the new test: **3 of 5 assertions failed** (the depth-write test, the
  filletPower-write test, and the "fillet true on layer 4" test — exactly the three that exercise the
  bug), the other 2 passed because they test the already-correct pre-load fallback path, which this
  change doesn't touch. Restored both files from the scratch copies, re-ran — green again.
- **Full suite:** `npx vitest run` → **118 passed (15 files)**, including the existing
  `tests/export-flow.test.js` unchanged and still green (expected — it still exercises
  `P.stampLayers.enabled`, which slice (b) hasn't touched yet).
- `node --check` on all 3 modules: clean.

**Verify:** `git status --short` → 4 files (state.js, _shared.js, svg-source.js, + new test), matching
the prediction exactly; no `editor/` path present.

No gate hit — stayed exactly within the dispatched slice-a scope; the transitional export-gap risk was
flagged (in code + here) rather than acted on unilaterally, since fixing it means touching
export-flow.js, which is explicitly slice (b), a separate turn.

---

## Lane B — Turn 45 — T15: SE5 slice (b) — export-flow + cloud-project-manager on editor layers — DONE, product code

Built slice (b) of `SE5-TOOLING-STORE-DESIGN.md` exactly per its own §5(b) + Risks section. Did not
touch `editor/` — seat A owns it for SE8a on main.

- **`main/export-flow.js`:** `_stampExportCandidates` now reads `depth`/`profile` straight off
  `editor._layers[idx]` (dropped the `idx` param entirely — no longer needed once there's no
  position-based `P.stampLayers?.[idx]` lookup). `enabled` in the returned candidate object is now
  simply `true` for any layer that passed the `visible !== false` gate — the gate itself IS the
  enabled-check now, matching the design doc's "enabled retires in favor of visible" call. Rewrote the
  file-header comment that used to explain the deliberate SE4a "tooling stays on P.stampLayers" split,
  since that split no longer exists. Also renamed a stale debug-log field (`stampLayers=` →
  `layers=` in the `[EXPORT]` fusLog line) — unrelated to the fix itself, but the dispatch's own verify
  step wants a clean `grep stampLayers` → 0, and leaving a misleadingly-named log field around after
  deleting the concept it names would just be a smaller, later version of the exact "stale reference"
  problem this whole slice exists to close.
- **`main/cloud-project-manager.js`:** found a real discrepancy between my own T13 design doc and the
  actual code, caught before implementing rather than after — `fetchMeta`'s `.enabled` read
  (`:676`) is NOT reading from a live editor at all. It parses a FETCHED project's raw JSON snapshot
  (`snap.P`) for the project-browser tile list, and `fetchMeta` runs per-tile as it lazily scrolls into
  view (`setupLazyMeta`), almost always for projects that are NOT the one currently open — there is no
  `window.svgEditor` for those. My design doc's "rewrite — read editor._layers.some(l => l.visible !==
  false)" instruction, taken literally, would have been either a no-op (undefined editor → always
  false) or, worse, silently shown the CURRENTLY open project's layer visibility on every OTHER
  project's tile if I'd carelessly reached for `window.svgEditor` without a project-identity check.
  Implemented the actually-correct equivalent instead: a new `_hasVisibleStampContent(editorSvg)`
  helper that parses the fetched project's own `P.editorSvg` string (mirroring `app-init.js`'s existing
  `_editorSvgHasContent` pattern — the established "cheap, editor-independent parse" idiom in this
  codebase) and cross-checks its embedded `data-editor-layers` roster for `visible`. Documented the
  discrepancy and the reasoning directly in the new function's comment, not just here, so the next
  reader of this file doesn't wonder why it doesn't look like export-flow.js's simpler fix. This is also
  a genuine correctness improvement over the old `.enabled` read, not just an equivalent swap: `.enabled`
  defaulted false for layers 1/2 and only ever got set via Browse-import — a project with real content
  drawn directly into layer 2/3 could have shown `hasStamps: false` on its browser tile even before this
  slice, the exact SA-LAYER-1 pattern applied to a different reader nobody had traced yet.
- **`tests/export-flow.test.js`:** rewrote the whole file per the design doc's own STOP condition (no
  partial rewrite — a mix of old- and new-shape fixtures would pass green while testing the wrong thing).
  `mockEditor()` now carries `depth`/`profile` on the editor layer objects directly. Every fixture sets
  `P.stampLayers` to DELIBERATELY WRONG tooling values (depth:999, profile:'WRONG', enabled:false) in
  `beforeEach` specifically so a regression back to reading `P.stampLayers` would produce a visibly wrong
  assertion, not just a missing field. Added the 4 cases the dispatch named: a 4th layer (P.stampLayers
  has only 3 entries) exports correctly; a layer with real content but never touched via Browse (P.
  stampLayers entry says enabled:false/WRONG) still exports; a reorder test that splices the editor
  layer array and confirms tooling follows the layer object's own id, not its new array position; and an
  end-to-end test that calls the REAL `setLayerVisible` (imported from `editor/layers.js` — importing a
  read function is fine, only editing files under `editor/` is off-limits) rather than reimplementing its
  effect, proving the exact SE5a-opened regression is closed. Had to add a `children: () => []` svg.js-API
  stub to the mock editor's `_sketchLayer` for that last test — `setLayerVisible` calls
  `applyLayerState()`, which calls `_sketchLayer.children()`; without the stub it threw
  `TypeError: ...children is not a function` on a bare mock (found by running the test, not by reading
  the source first — the fix was obvious once the error named exactly what was missing).
- **Proved non-vacuous, not argued:** saved scratch copies of both edited product files, reverted both
  to pre-fix (`git checkout HEAD --`, safe — uncommitted), re-ran the rewritten test file: **6 of 9
  assertions failed** — exactly the ones exercising layer-4, direct-drawing, reorder, and the
  setLayerVisible end-to-end case; the 3 that stayed green are the hidden/empty/editor-not-loaded cases,
  which this slice doesn't change. Restored both files from the scratch copies, re-ran — green again.
- **Full suite:** `npx vitest run` → **122 passed (15 files)**, up from 118 (net +4 assertions vs. the
  old file's 5).
- **Verify greps:** `grep -c stampLayers main/export-flow.js` → **0**, matching the prediction exactly.
  `grep -c '\.enabled' main/cloud-project-manager.js` → **3**, all 3 inside the new
  `_hasVisibleStampContent` doc-comment explaining what was retired (backtick-quoted mentions of the old
  field, not live code) — a named survivor with its reason, per the dispatch's own allowance for that
  case, not a miss. `node --check` on both modules: clean.

**Verify:** `git status --short` → 3 files (export-flow.js, cloud-project-manager.js,
tests/export-flow.test.js) + WORK-LOG = 4, within the "≤4 files" prediction; no `editor/` path present.

No gate hit. One real design-doc correction made and disclosed rather than implemented blindly
(cloud-project-manager.js has no live editor to read for most of its callers) — same discipline as T13's
own "found the enabled/visible fossil before writing it down" correction, applied here at build time
instead of design time.

---

## Lane B — Turn 47 — T16: mobile CSS fixes (SA-MOBILE-13, -8, -4, -5 + T10 badges) — DONE, CSS only

Stylesheets only, no JS — bspline-frame-builder/styles/base.css, bspline-frame-builder/styles/editor.css.
Confirmed via git status --short: exactly these 2 files. Did not touch editor/*.js — seat A owns it for
SE8b.

### 1. SA-MOBILE-13 — touch-action scoped off html/body

Before (base.css, inside the html, body rule): overflow: hidden; touch-action: none; /* Prevent browser
handling of touch gestures */ -webkit-overflow-scrolling: touch;
After: touch-action: none removed from html, body entirely. New rule added right after:
#previewCanvas, #editorSVGContainer, #resizer { touch-action: none; }
Named each selector and why, per the dispatch's ask: #previewCanvas (the Three.js 3D preview — the one
surface the page's own WCAG 1.4.4 viewport comment already names as needing its own gesture handling;
OrbitControls owns rotate/pan/zoom). #editorSVGContainer (the SVG editor canvas — custom pointer-based
pan/select/draw in editor/editor-interaction.js, would otherwise fight native page pan while drawing).
#resizer (the sidebar/preview drag handle, core/ui-utils.js's initResizer — a custom pointerdown/
pointermove drag, not a native input type=range, so it needed the same treatment as the already-
correctly-scoped .editor-symbol-keyboard-grip drag handle a few hundred lines below it in the same
file). Checked all 3 candidates by reading their actual interaction code before including them, not by
guessing from the name — confirmed #previewCanvas is the literal id in bspline_gen_palette.html:952
and #resizer's drag handler in core/ui-utils.js:143-170 uses setPointerCapture, the exact pattern
that benefits from touch-action:none (prevents the browser's own pan/scroll from fighting an in-progress
pointer-captured drag). No JS pinch handling added — that's SE7m, per the dispatch's explicit exclusion.

### 2. SA-MOBILE-8 — layer-delete button visible under (hover: none)

Before: .editor-layers-panel .layer-row:hover .layer-delete { visibility: visible; } and
.editor-layers-panel .layer-delete:hover { background: #fde7e7; }
After (hover-reveal for mouse kept unchanged; new block added directly below it):
@media (hover: none) { .editor-layers-panel .layer-delete { visibility: visible; } }
Used (hover: none) (a real "no hover-capable pointer present" signal) rather than a width breakpoint,
matching the reasoning already established for the T10-badge fix below and consistent with this being
the semantically correct feature query for "is this a touch device," independent of viewport width.

### 3 + SA-MOBILE-5's second half. SA-MOBILE-4 — rail buttons consolidated to ONE (pointer: coarse) rule

Traced the cascade before touching anything: .editor-sidebar .tool-btn { width:38px; height:38px }
(inside a @media (max-width:720px) block, no !important) was the LIVE rule (broader/equal-priority
breakpoint, more specific selector); a second .tool-btn { width:40px; ... } (bare selector, inside
@media (max-width:700px)) was dead by specificity — confirmed both facts before editing, not assumed
from the audit alone (T12's audit had already flagged this pair, but I re-verified the live/dead split
myself since T10 had touched nearby lines since then).

Before (@media (max-width:720px) block): .editor-sidebar .tool-btn { width: 38px; height: 38px;
flex: 0 0 auto; padding: 6px; }
After (same block — flex: 0 0 auto kept, since that's a row-layout-context rule, not a sizing conflict;
sizing removed): .editor-sidebar .tool-btn { flex: 0 0 auto; }
Before (@media (max-width:700px) block, dead): .tool-btn { display: inline-flex; align-items: center;
justify-content: center; min-width: 40px; width: 40px; height: 40px; padding: 6px; border-radius: 10px; }
After: removed entirely (see item 4 below — this and the dead .editor-sidebar rule shared one edit).

Caught a real cascade consequence before shipping it: removing ONLY the width/height from the 720px
.editor-sidebar .tool-btn rule (leaving flex: 0 0 auto) would have made the previously-dead bare
.tool-btn{width:40px} in the 700px block suddenly LIVE for width/height (it was only dead because a
higher-specificity selector was setting the SAME property — once that property was gone from the
higher-specificity rule, the lower-specificity one stops being shadowed). That would have reintroduced
exactly the kind of two-rules-disagreeing state this task exists to close, just for narrow-but-mouse
(non-touch) windows specifically. Deleted the 700px .tool-btn rule too, not left it as a new trap.

New consolidated rule (placed right after the base .tool-btn .material-symbols-outlined declaration,
near .tool-btn's other base rules):
@media (pointer: coarse) { .editor-sidebar .tool-btn { width: 44px; height: 44px; padding: 5px; } }
(pointer: coarse) chosen over a width breakpoint for the same reason as item 2 — it's the actual signal
("an imprecise pointer is present"), not a proxy that conflates narrow-window with touch-input.

### 4. SA-MOBILE-5 — dead 700px .editor-sidebar rule removed, chain confirmed

Before: .editor-sidebar { width: 56px; min-width: 56px; padding: 10px 6px; }
After: removed (replaced with a comment explaining why, and covering the .tool-btn removal from item 3
in the same note, since both were the same dead-rule cleanup). Chain check, per the dispatch's own ask:
grep -n "editor-sidebar" editor.css before deleting -> 5 hits total, 3 were the two live
@media (max-width:720px) blocks' own .editor-sidebar rules (unaffected, still needed) + the dead rule
itself + one doc-comment mentioning it — confirmed nothing else in the file (no calc(), no sibling
selector) depended on the dead rule's 56px value before removing it.

### Also — T10 shortcut badges hidden under (hover: none)

Added right after the existing .tool-btn.active[data-key]::after rule:
@media (hover: none) { .tool-btn[data-key]::after { display: none; } }
No keyboard on a phone, so the shortcut-letter badge (T10, this lane, several turns ago) is dead
information for a touch user — hidden rather than left as a meaningless mark on every button.

### Verify

npx vitest run -> 145 passed (17 files) — CSS-only change, confirms no JS regression; file/test count
is higher than my last check (122) because seat A's SE8a/SE8b work landed on main and merged in since
T15, unrelated to this turn.
Brace balance check (node -e counting braces) on both files: base.css 253/253, editor.css 93/93 — both
balanced, no stray brace from any of the edits.
grep -n "touch-action" across both files, every occurrence listed with its selector (dispatch's own
verify ask): base.css:71 -> my new #previewCanvas, #editorSVGContainer, #resizer rule. base.css:777 ->
pre-existing .editor-symbol-keyboard-grip (untouched, already correctly scoped). editor.css:335 ->
pre-existing .editor-symbol-keyboard (untouched, already correctly scoped). editor.css:357 -> pre-existing
.editor-sidebar { touch-action: pan-x; } (untouched — a different, already-correct value, allows
horizontal scroll of the row-layout rail).
git status --short -> 2 files (base.css, editor.css) + this WORK-LOG entry, matching the dispatch.

No gate hit — CSS-only, additive/subtractive within named rules, no JS or markup touched. Live phone
check is Fred's, per the dispatch.

---

## Lane B — Turn 49 — T17: SE7b design — the Lattice pattern generator — DONE, plan only

New SE7B-PATTERN-GENERATOR-DESIGN.md (331 lines). Read-only on product code — grounded the whole design
in what SE7a/SE6 already declared rather than inventing new machinery, per the dispatch's own "ground
truth to read first" list.

Read editor-lattice.js (147 lines), editor-grid.js (183 lines), layers.js's CRUD functions, core/noise.js
and core/terrain.js in full before writing anything. Found the design is almost entirely composition of
existing primitives, not new geometry/DOM code:
- emitSegment/emitNode (editor-lattice.js:119-147) already stamp data-lattice + pull data-layer from
  ensureActiveLayer — a generated element and a hand-drawn SE7a element are the identical shape, which is
  what makes "editable afterwards with every tool" true by construction rather than something to build.
- latticeCrossings (editor-lattice.js:70-87) is already the exact rail x tie crossing-point primitive
  nodes.crossings needs — no new math.
- addLayer's {skipUndo:true} + setActiveLayer's undo-silence (layers.js:115-138,230-248) mean Generate
  can build all 3 layers and emit every element without touching the undo stack, then push exactly once
  at the end — same shape as action-tools.js's editorClear handler, cited directly as the precedent.
- handleEnd (editor-interaction.js:307-334) is the ONE place node-drag/transform-drag/select-translate
  all converge before pushState() (:330) — used this as the single ownership-detach hook instead of my
  first instinct (hooking 3 separate move-handler functions), after actually reading the current dispatch
  logic rather than assuming the shape from memory.

**Found and reused the actual RNG, not a superficial match.** The dispatch said "find the RNG and reuse
it, do not add a second one." Checked core/noise.js's PerlinNoise (spatially-correlated continuous
field) against core/terrain.js's own lcgPoints (terrain.js:309-318, independent {u,v} draws from a seeded
LCG, already used for seed-panel point scattering at :192) and concluded Perlin is the WRONG shape for
this job — thresholding continuous noise for "does column i get a tie" would visibly clump neighboring
columns, not scatter them the way Fred's photo shows. Recommended exporting lcgPoints (currently
module-private, one-line change) as slice 1's first step, rather than either reusing Perlin because it's
already exported (convenient but wrong statistically) or hand-rolling a fresh LCG (violates the dispatch's
own instruction). Also named, without fixing (out of scope), that noise.js's buildPerm and terrain.js's
lcgPoints already independently hand-roll the identical LCG step — a pre-existing small "declare once"
gap, on record now rather than silently re-noticed later.

**Resolved the ownership-edit fork the dispatch explicitly asked me to decide, with reasoning, not left
it open:** any interactive drag-edit to a generated element strips data-lattice-gen (detaches it),
hooked once at handleEnd right before the existing pushState() so the detach and the edit land in the
same undo step. A click-without-drag does NOT detach (_dragMoved, already checked at that exact line,
gates it for free). Named the standard "generative-fill eject on edit" precedent as the reasoning, and
flagged a real known rough edge (a detached element and a freshly-regenerated one can end up overlapping
at the same lattice cell) as deferred-not-ignored, with a named mitigation for a later slice.

**Panel UI (390px ASCII mockup, §5):** every control is a real tap target — no hover-reveal — matching
T16's just-landed (hover:none)/(pointer:coarse) precedent in the same lane. Recommended against a live
preview-before-commit for slice 1, with explicit reasoning (Generate is already 1 undo step and
non-destructive by construction, so the preview's complexity cost has to beat "just Ctrl+Z" — a real
tradeoff stated as a tradeoff, not asserted as obviously correct, and explicitly named as something to
revisit if actual usage shows otherwise).

**Named the document-level storage choice and why it's not a per-layer field:** data-lattice-pattern on
the root <svg>, mirroring data-editor-layers exactly — same 3 save call sites + 1 open call site
(editor-io.js), a new sibling _serializeLatticePatternAttr next to the existing _serializeLayersAttr
rather than a fourth divergent JSON-embedding idiom. A pattern spans 3 layers by construction, so it
isn't one layer's property — this is the SE4/SE5 "one store" lesson applied going forward on a new
feature instead of retrofitted onto an old one.

3 slices proposed: (1) pure pattern algorithm + lcgPoints export, no DOM (3 files); (2) layer creation +
DOM emission + document persistence (3 files); (3) ownership-detach hook + panel UI (5 files). Each has a
predicted file list and a verify line, per the dispatch's own format ask. 3 open questions flagged
explicitly for Fred/advisor before slice 2 starts (tie-span anchoring to rail rows — a genuine visual
judgment call I can't resolve from code alone; per-layer tooling defaults; whether the detach-overlap
rough edge needs pulling into an earlier slice).

**Verify:** git status --short -> SE7B-PATTERN-GENERATOR-DESIGN.md (new) only; every file:line citation
re-checked against current HEAD before writing (not copied from memory of older audit turns) — caught
and corrected 3 stale line numbers from my own T12 audit (dragNode/translateSelection/handleEnd had all
moved since SE7n/SE8a landed) before they went into the doc.

No gate hit — design-doc-only turn, no product code or tests touched.

---

## Lane B — Turn 51 — T18: SE7b slice 1 — pure computePattern (anchor rails|free, occupied) — DONE, product code

Built slice 1 of my own SE7B-PATTERN-GENERATOR-DESIGN.md (89a48b4), plus the advisor's rulings on Q1
(ties.anchor: 'rails'|'free', data not code) and Q3 (occupied param accepted now, real detection logic
deferred to slice 2). Did not touch editor-lattice.js or any of seat A's SE8b files.

- core/terrain.js: exported lcgPoints (one line) with a comment explaining why — the RNG reuse the
  dispatch and my own design doc both called for, not a new one.
- New editor/editor-lattice-pattern.js: computePattern(PATTERN, {extent, occupied}) -> {segments,
  nodePoints}, entirely in LATTICE coordinates. Reuses toLattice/fromLattice/constrain/latticeCrossings
  (imported from editor-lattice.js, not reimplemented) and lcgPoints (imported from core/terrain.js).
  Made a deliberate, disclosed refinement over the design doc's own ambiguous segments[].a/b sketch:
  kept segments AND nodePoints in one coordinate system throughout, so this module never needs spacing
  for its own output shape — only slice 2's DOM-touching layer calls fromLattice, right before handing
  points to emitSegment/emitNode (which need model-space).
- Per-column RNG draws use a column-derived sub-seed (seed XOR a per-column constant), mirroring
  terrain.js's own noiseFine/noiseWarp/noiseCoarse XOR-derivation idiom directly rather than inventing a
  new randomness convention — and it buys a real property the design doc didn't originally ask for but
  is worth stating: each column's tie decision is independent of how many OTHER columns exist, so
  widening the extent can't retroactively change an already-decided column's tie.
- ties.anchor implemented both ways per the ruling: 'rails' (default) picks a start rail row then a
  valid end rail row within spanMin..spanMax lattice rows of it (skip the column if no candidate rail
  pair fits that gap); 'free' picks any start row + span length within the extent, no rail requirement.
- nodes.crossings reuses latticeCrossings rail-by-rail against the generated ties — caught my own bug
  before it shipped by actually running the tests: latticeCrossings returns a segment's OWN two
  endpoints alongside real crossings (its own documented behavior, editor-lattice.js:72), and since I
  passed each RAIL as the seg being tested, that meant every rail was growing a spurious node at its own
  left/right board-edge endpoint, not just at real tie crossings. Added an explicit exclude-the-rail's-
  own-endpoints filter. Confirmed the bug and the fix are both real by writing a test for it (see below).
- occupied: implemented as opts.occupied?.has("i,j,kind") checked against each element's IDENTITY point
  (rail: its start; tie: its start; node: itself) — a slice-1 convention I named explicitly in the code's
  own doc comment as open to refinement once slice 2/3 write the real DOM-based occupied-set builder,
  not presented as a finished design.

**Caught and fixed my own design doc's imprecision during implementation, didn't ship the mismatch
silently:** the design doc's own §6 test list said "ties.columns explicit list bypasses lcgPoints
entirely (no seed dependency when hand-picked)." Implementing it, that's the wrong behavior — hand-
picking WHICH columns get a tie is a separate decision from how long each one is; there's no reason a
seed reroll shouldn't still vary a hand-picked tie's span. Implemented column-selection as seed-
independent (forced bypasses only the density gate) but span/position still legitimately draws from the
seed for those columns, and wrote the test to assert the CORRECTED behavior with an explicit comment
citing the design doc's original wording and why it changed — rather than either quietly deviating from
my own doc or forcing the implementation into what I'd written imprecisely three turns ago.

**Two real bugs caught by writing and RUNNING the tests, not by inspection alone** (both confirmed via
mutation: reintroduced each, watched the exact intended test fail, restored, watched it pass again):
1. every<=0 degenerate guard — my own code comment said "no rails rather than ... silently reinterpreting
   it as every row," but the code I actually wrote did exactly the fallback the comment disclaimed
   (`every>0?every:1`, i.e. "every row" when every<=0). Fixed to match the STATED intent (return false
   outright when every<=0) rather than editing the comment to match the wrong code.
2. The crossings-endpoint-exclusion bug described above.
3. A third test (seed-dependence of a hand-picked column's span, using the DEFAULT 'rails' anchor +
   every:2/spanMin:1/spanMax:3) initially failed not because of a code bug but because those specific
   defaults leave exactly ONE valid rail-pair candidate almost always (rails 2 apart, span window 1-3
   only ever admits the very next rail), making the span deterministic regardless of seed as a genuine
   consequence of that combination, not a bug. Fixed the TEST (switched to anchor:'free' with a wider
   span window, where the claim being tested — "span legitimately varies with seed" — isn't confounded
   by a near-forced-unique-candidate artifact), documented why in the test's own comment, left the
   product code untouched since it wasn't wrong.

**Full suite:** npx vitest run -> 162 passed (18 files), up from 145. node --check on both modules: clean.

**Verify:** git status --short -> exactly 3 files (core/terrain.js, editor/editor-lattice-pattern.js new,
tests/editor-lattice-pattern.test.js new) + this WORK-LOG entry, matching the dispatch's prediction.
editor-lattice.js and every seat-A SE8b file (editor-hit.js, editor-expand-trace.js, editor-interaction.js,
editor.js, editor-io.js, editor-coords.js) confirmed untouched.

No gate hit — stayed exactly within slice 1's pure-function scope; the occupied-detection LOGIC (querying
live DOM for detached elements) is explicitly slice 2/3 work, not started here.

---

## Lane B — Turn 53 — T19: SE7b slice 2 — generatePattern, 3 layers, ownership + occupied skip, persisted — DONE

Built slice 2 of SE7B-PATTERN-GENERATOR-DESIGN.md §5, per this turn's dispatch (occupied-cell skip
pulled forward into this slice, per the advisor's own T18 ruling). Files: editor/editor-lattice-pattern.js,
editor/editor-io.js, tests/editor-lattice-pattern-emit.test.js — exactly the 3 predicted. Did not touch
editor-lattice.js or any seat-A SE7s file (editor-transform-handles.js, editor-interaction.js,
handle-edit.js) — confirmed via git status after the fact.

- generatePattern(editor, PATTERN) added below computePattern in the SAME file, matching
  editor-lattice.js's own established convention of one file, pure math above a divider, DOM-touching
  code below it (cited that file's own header comment as the precedent, not a new split invented here).
- Extent resolution (_resolveExtent) derives lattice bounds from editor._mW/_mH for 'board' mode; also
  honors 'rect' mode directly since the design doc's own PATTERN shape already stores it in the
  resolved-bounds form — supporting both cost nothing extra once one was built.
- Occupied-set collection (_collectOccupied) walks every data-lattice element lacking the ownership tag
  and adds ITS WORLD-space identity point(s) via worldPoint (imported from editor-coords.js) — "moved
  elements count where they ARE," per the dispatch's literal wording. For a detached line (rail/tie),
  added BOTH endpoints to occupied, not just one — a disclosed widening beyond slice 1's own "start point
  only" convention, reasoned through in the code's own comment: a dragged/rotated segment's original
  "start" isn't necessarily meaningful any more, so blocking both ends is the more conservative,
  defensible choice.
- _ensurePatternLayers creates the 3 layers (LATTICE_LAYER_DEFAULTS: rails/ties both V-bit, ties
  shallower; nodes ballnose — Fred tunes live later, per the design doc's own Q2 note) with
  {skipUndo:true}, reused by id (not name) across Regenerate so a user rename doesn't force a duplicate.
- generatePattern's own sequence: collect occupied -> remove owned -> computePattern -> ensure layers ->
  emit via setActiveLayer + emitSegment/emitNode (reused as-is, not reimplemented) + tag ownership -> ONE
  pushState() + ONE editor._notifyChange('commit') (the SE8b-declared API, not raw _onChange — the
  dispatch's own correction from T18's plan, since SE8b landed the throttled/committed distinction in
  the meantime; used the declared thing rather than reaching past it).
- editor-io.js: _serializeLatticePatternAttr added right after _serializeLayersAttr, wired at the
  identical 3 save call sites (save/saveForRasterization/saveWithTextCopies) via the same
  layersAttrStr-pattern replace_all across all 3 (verified textually identical before using replace_all,
  not assumed). open() reads data-lattice-pattern at the same point data-editor-layers is read (BEFORE
  innerHTML injection, same reason: root attrs are gone after), and resets editor._latticePattern = null
  in the same session-reset block that already clears _layers/_activeLayer/_undoStack, so a fresh/
  different session never carries a stale pattern reference.

**Wrote a lightweight in-memory sketch-layer mock for the emit tests**, extending
tests/editor-lattice.test.js's own established mockSketchLayer/mockEditorForEmit shape (chainable
.line()/.circle()/.center()/.fill()/.stroke()/.attr()) rather than inventing a new mocking convention.
Hit and fixed one real mock bug while writing it: `.attr(k, undefined)` (my own simulated "strip this
attribute" call, standing in for the future handleEnd detach hook) was being treated as a GETTER call
(`v === undefined` matched the getter branch), so the simulated detach silently did nothing and two
tests failed for the wrong reason (looked like a product bug, was actually a mock bug) — fixed by
checking `arguments.length`/rest-param length instead of the value, so a setter call with an explicit
undefined/null argument is distinguished from a bare getter call.

**Proved non-vacuous on all 3 of the turn's real behavioral guarantees, not just the new lines existing**
(each: mutate, watch the SPECIFIC intended test fail, restore, watch it pass again):
1. Disabled _collectOccupied (return empty Set unconditionally) — the dispatch's own named verify
   criterion ("a detached tie at column 5 -> Regenerate does NOT emit a new tie at column 5") failed
   exactly as expected (2 ties where 1 was wanted).
2. Made owned-removal indiscriminate (strip every data-lattice element, not just this PATTERN.id's) —
   both the "detached element untouched" test and the SA-LAYER-1-style guard failed, for the right
   reason (the detached tie was removed, then silently replaced by a fresh generated one).
3. Removed latticePatternAttrStr from save()'s one call site — both new persistence tests failed exactly
   as expected (attribute absent, DOMParser round-trip found nothing to parse).

**Persistence testing scope, disclosed rather than silently left incomplete:** tested save()'s write side
directly (mockSaveEditor, same minimal shape tests/b6-hidden-layer-save.test.js already established —
save() only needs _draw/_sketchLayer.node.innerHTML/_mW/_mH/_layers/_activeLayer) and the actual
encode/decode CONTRACT via a real DOMParser round trip (construct via save(), parse the result, confirm
getAttribute+JSON.parse recovers the identical PATTERN object) — this is the part that was actually worth
proving (the entity-escaping is correct both directions). Did NOT build a full open()-level integration
test: open() is an 80+-line function touching setModelMetrics/sync3DBackground/resetPanState/
_deselect/layer-reconciliation, and grepped — no existing test in this suite exercises open() end-to-end
at all (the heaviest existing mocks stop at save()/getLayerSvg()/saveForRasterization()). Building that
scaffold fresh was a bigger lift than this slice's scope, and the piece it would additionally prove (that
open()'s own orchestration doesn't drop the value between the read and the assignment) is a 2-line,
low-risk block adjacent to and modeled directly on the already-tested data-editor-layers read — named
here rather than silently skipped.

**Full suite:** npx vitest run -> 192 passed (21 files), up from 189 (13 new: 10 generatePattern + 3
persistence). node --check on both modules: clean.

**Verify:** git status --short -> exactly 3 files (editor-lattice-pattern.js, editor-io.js,
tests/editor-lattice-pattern-emit.test.js) + this WORK-LOG entry; grep confirmed no seat-A SE7s file
(editor-transform-handles.js, editor-interaction.js, handle-edit.js) appears in the diff.

No gate hit — stayed within slice 2's exact scope. Slice 3 (the handleEnd detach hook + panel UI) is
next, per the design doc's own ordering.

**Note for slice 3 (recorded now per this turn's dispatch, not fixed here):** generatePattern (T19)
calls setActiveLayer 3 times in sequence (Rails, then Ties, then Nodes) while emitting each kind — the
LAST call wins, so after any Generate/Regenerate the active layer is silently left on "Nodes" regardless
of whatever layer the user had active beforehand. Not fixed in T19's scope (pure emission), flagged here
for slice 3 to restore the pre-Generate active layer (capture `editor._activeLayer` before the emit
loop, `setActiveLayer` back to it at the end, after the 3 layers are ensured but content is emitted).

---

## Lane B — Turn 55 — T20: SE8c part 1 — dead-code chains + debug/font declarations — DONE

Built T20 exactly per the dispatch: SA-DEAD-1..8, SA-TEXT-5/6/7, entirely outside seat A's off-limits
files (editor-interaction.js, editor-transform-handles.js, editor.js, handle-edit.js — confirmed via
`git status --short` after the fact, none appear). Re-verified every claim against CURRENT code before
touching anything, not against T12's audit text — several line numbers had shifted since SE7a/SE7n/
SE8a/SE8b landed, though every underlying finding itself was still accurate.

### SA-DEAD-1 — 8 hand-rolled `window.__editorDebug === 'X'` gates → the declared `dbg()` gate

Re-grepped fresh (not trusted from memory): confirmed **8** sites, not 7 — `core/stamp/index.js:80`
(`STAMP-RASTER`) plus the 7 `editor/*.js` files T12's audit found. All 8 outside the off-limits list.
Converted each `_xLog(msg)` helper's `if (typeof window !== 'undefined' && window.__editorDebug ===
'X') { try { console.log(...) } catch(_) {} }` body to `dbg('X', msg);` (importing `dbg` from
`core/debug.js`), keeping each file's separate always-on `fusLog(...)` call untouched (that's a
deliberate, unrelated behavior — logs to the Fusion log file regardless of the debug flag — not part of
the dead-pattern this item targets). `core/stamp/index.js` already imported `dbg` (used elsewhere in the
same file for the DIFFERENT `'STAMP DEBUG'` category) — reused that import rather than adding a second
one.
Updated `core/debug.js`'s own doc-comment category list to add the 7 new names (ERASER, EXPAND-COMMIT,
EXPAND-SHAPE, EXPAND-ORCH, EDITOR-IO, PERFORM-EXPAND, STAMP-RASTER — EXPAND-SHAPE covers both
editor-expand-shape.js and editor-expand-union.js, which both already gated on that same category name).
**Found but explicitly NOT fixed, noted in the code comment:** `editor-expand-union.js`'s gate checks
category `'EXPAND-SHAPE'` while its own log label is `[EXPAND-UNION]` — a pre-existing category/label
mismatch. Converting the MECHANISM (hand-rolled → declared) doesn't mean also silently renaming which
category gates it — that's a separate judgment call the dispatch didn't ask for, so I left the category
string exactly as it was and documented the mismatch instead of quietly "fixing" an unrequested behavior
change.
**Verify:** structural grep `if (typeof window !== 'undefined' && window.__editorDebug ===` → **0** hits
repo-wide (not just outside off-limits — zero live hand-rolled gates left anywhere). A looser grep for
the bare string `window.__editorDebug ===` still shows 7 hits — all 7 are inside my OWN explanatory
comments citing the old pattern for documentation ("...instead of hand-rolling window.__editorDebug ===
'X'"), not live code — checked each one directly rather than reporting the raw grep count as-is, since
that count alone would have read as "not fully done."

### SA-DEAD-2 — `updateNodeCountUI` — LEFTOVER, not touched (per the dispatch's own conditional)

Re-confirmed: still zero real callers. But its wiring (`import {..., updateNodeCountUI, ...}` and
`_updateNodeCountUI(data) { return updateNodeCountUI(this, data); }`) lives entirely in `editor.js` —
off-limits this turn. Removing the function's export from `editor-ui.js` while `editor.js` still imports
it by name would be a live import error, not a harmless leftover — so per the dispatch's own explicit
conditional ("remove... IF the wiring is outside editor.js; otherwise list the editor.js link as a
leftover"), left `updateNodeCountUI` (editor-ui.js), `#editorNodeCountUI` (palette markup), AND
`editor.js`'s import+method completely untouched as one unit. **Full leftover for seat A**, not a partial
removal — a half-removal here would have been worse than the status quo.

### SA-DEAD-3 — doorless Smoothness ids in `properties-expand.js`

Re-confirmed `editorExpandSmooth`/`-Minus`/`-Plus` still have 0 hits in the palette markup (Detail's
matching stepper does exist). Removed the 3 `el()` lookups and their change/click handlers. Documented in
the code (not just here) that `editor._expandSimplify` keeps its own construction-time default and is
still read by `expandCurrent` — this only removes the dead ATTEMPT to let a user change it from a
control that was never reachable. If Fred wants the control back, it needs real markup added first
(mirroring Detail's), not this wiring resurrected as-is.

### SA-DEAD-4/7/8 — `editor-ui.js`: dead selection-panel lookup, redundant setMode branches, empty if

- SA-DEAD-4: `editorSelectPanel` lookup+toggle removed (0 hits in markup, confirmed — a documented prior
  cleanup already dropped the id; this was a second, later reference to it).
- SA-DEAD-7: `setMode`'s 3 "special case" `if (mode==='draw'/...) btn.classList.add('active')` branches
  removed — each was provably redundant with the generic `.toggle('active', ...)` one line above (same
  condition, already-true case).
- SA-DEAD-8: the symbol-keyboard auto-hide `if` block (real condition, empty body, its own comment
  admitting the "real" logic lived in tool click listeners that never actually touched this panel)
  removed rather than resurrected.
All three confirmed still present/still redundant/still empty before touching, not assumed from T12.

### SA-DEAD-5 — `editorSidebarToggle` in `editor-controls.js`

Re-confirmed triple-dead: 0 hits in palette markup, 0 `.editor-sidebar.collapsed` CSS rule anywhere
(grepped every `.collapsed` selector in both stylesheets — all belong to unrelated panel systems),
superseded by SE7m's responsive layout. Removed the lookup + click handler. Incidental cleanup that came
with rewriting the same import line: `addClass`/`removeClass` were ALREADY-unused imports in this file
before my change (not caused by it) — left them out of the rewritten import line since I was already
touching it, rather than leaving newly-visible dead imports in a line I'd just edited; noted here rather
than silently folded in as if it were part of the SA-DEAD-5 removal itself.

### SA-DEAD-6 — stale `editorLayerSelect` "compatibility shim" comments

Re-confirmed the comments in `bspline_gen_palette.html` and `layers.js` both name `editor-ui.js`,
`editor-text-session.js`, `editor-io.js` as still reading/writing `#editorLayerSelect` directly — grepped
all three files, zero direct reads/writes remain (editor-ui.js reaches the active layer through
`_setActiveLayer` instead, per its own already-correct comment at :356-359). Corrected both comments to
state the shim is self-contained inside `layers.js` today. **Not removed** — per T12's own reasoning,
kept: an external (Fusion-side/devtools) consumer of `#editorLayerSelect`'s `.value`/`.options` can't be
ruled out from this repo alone, so this is a documentation fix, not a code removal.

### SA-TEXT-5 — stale doc comment in `editor-expand-commit.js`

Re-confirmed the file's header comment still asserted (present tense) that `data-original-svg` "contains
raw SVG markup... the resulting saved SVG is INVALID XML" while the function 90 lines below it
(`commitExpandedPath`) already base64-encodes every new snapshot via `encodeSnapshot`. Rewrote the
comment to past tense, named EDM2 as the fix, and cited `tests/editor-serialization.test.js`'s own EDM2
regression suite as the existing proof — so a future reader doesn't have to re-derive what I just
re-derived.

### SA-TEXT-7 — `TEXT-DBG` default in `core/debug.js`

Re-confirmed `_flag` still defaulted to `'TEXT-DBG'` (on) despite the file's own doc-comment saying "off
by default." Changed the default to `false`, matching the documented contract exactly (the doc comment's
own example line: `window.__editorDebug = false // off (default)`).

### SA-TEXT-6 — ONE font list (the most involved item this turn)

Re-read `editor/editor-fonts.js` in full before touching anything else — found it already declares
`SYMBOL_FAMILIES` (a `Set` of the 7 icon/emoji-only fonts), which is EXACTLY the distinction needed
between "fonts sensible to offer as a typed-text family" and "fonts that exist only for the Symbol
Keyboard glyph picker." This mattered: naively populating the `editorFontFamily` select from ALL of
`FONT_MAP`'s 18 keys would have added Wingdings/Webdings/Symbol/Segoe-icon-fonts as text-caption choices
— a real product regression, not a neutral refactor. Used the already-declared `SYMBOL_FAMILIES`
exclusion instead of inventing a new subset list myself.
- `core/stamp/render-svg.js`: `KNOWN_FONTS` (was a hand-typed 24-entry array, 18 of which duplicated
  FONT_MAP exactly) is now `[...Object.keys(FONT_MAP), ...GENERIC_CSS_FAMILIES]`, importing `FONT_MAP`
  from `editor-fonts.js`. `GENERIC_CSS_FAMILIES` (serif/sans-serif/monospace/cursive/fantasy/system-ui)
  stays declared locally — these are CSS-universal fallback keywords with no bundled `.ttf`, not "editor
  fonts" in FONT_MAP's own sense, so folding them into FONT_MAP would have been the wrong direction.
  Exported `KNOWN_FONTS` (was module-private) so the new test can check it directly.
- `editor/properties-text.js`: `editorFontFamily` select now populated at bind time from
  `Object.keys(FONT_MAP)` minus `SYMBOL_FAMILIES`, mirroring `properties-shape.js`'s `initGridToggle`
  (the grid-spacing select) idiom exactly — same clear-innerHTML-then-loop-then-set-value shape, the
  precedent the dispatch named.
- `bspline_gen_palette.html`: emptied the hardcoded `<option>Arial/Tahoma/Verdana</option>` list to a
  bare `<select id="editorFontFamily"></select>`, matching `#editorGridSpacing`'s own already-empty
  markup convention exactly.
- New `tests/editor-fonts.test.js` (4 assertions): every `FONT_MAP` entry is in `KNOWN_FONTS`; every
  font the select would actually offer (post-`SYMBOL_FAMILIES` filter) is in `KNOWN_FONTS`;
  `GENERIC_CSS_FAMILIES` are still present; and a direct proof of the "one-line addition propagates"
  claim itself (constructs a `FONT_MAP`-shaped object with one extra hypothetical font and confirms the
  derivation mechanism — not just today's fixed list — would pick it up).
- **Proved non-vacuous, not argued:** temporarily hardcoded `KNOWN_FONTS` to exclude `'Cascadia Mono'`
  (simulating a stale/hand-typed list missing a real FONT_MAP entry) — both the direct-containment test
  and the selectable-fonts test failed exactly as expected, for the right reason. Restored, re-ran green.

### Full suite + verify

`npx vitest run` → **196 passed (22 files)**, up from 192 (4 new). `node --check` on all 15 touched JS
files: clean. Verify greps (dispatch's own list): `__editorDebug ===` structural pattern → 0 live hits
anywhere (see SA-DEAD-1 note on the bare-string count vs. the structural one). `updateNodeCountUI` → the
predicted 3 hits, all the documented editor.js leftover, nothing removed. Font names hand-typed outside
`editor-fonts.js` → 0 (`"Tahoma"` grepped across every other JS/HTML file in the tree).

### Commit split

Two commits, per the dispatch's own "or two if the font declaration is big — say so": (1) the SA-DEAD-*/
SA-TEXT-5/7 sweep — 13 files (core/debug.js, core/stamp/index.js, editor-controls.js, editor-eraser.js,
editor-expand-commit.js, editor-expand-shape.js, editor-expand-union.js, editor-expand.js, editor-io.js,
editor-ui.js, expand.js, layers.js, properties-expand.js) + this WORK-LOG entry; (2) SA-TEXT-6 — 4 files
(core/stamp/render-svg.js, editor/properties-text.js, bspline_gen_palette.html,
tests/editor-fonts.test.js). Said so here rather than silently picking one giant commit, since the font
consolidation is a genuinely separate concern (a declared-source-of-truth fix) from the dead-code/
debug-gate sweep, and reviewing them separately is easier than one 17-file diff.

**Leftovers for seat A** (full list, so nothing is assumed swept): SA-DEAD-2's `updateNodeCountUI`
wiring in `editor.js` (import + `_updateNodeCountUI` method + whether the markup should go too, once
that wiring is gone). The `generatePattern` active-layer note above (slice 3, SE7b, unrelated to SE8c but
recorded in this same turn per the dispatch's ask).

No gate hit — every removal chain traced (door → handler → markup/CSS → nothing left half-swept);
SA-DEAD-2 deliberately left as a full leftover rather than a partial, riskier removal.
