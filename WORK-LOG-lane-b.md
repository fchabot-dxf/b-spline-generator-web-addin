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
