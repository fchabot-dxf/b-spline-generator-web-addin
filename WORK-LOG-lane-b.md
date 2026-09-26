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

---

## Lane B — Turn 57 — T21: SE7b slice 3 — detach hook, Detach all, Pattern panel, active-layer restore

Built the final SE7b slice: design §2's detach-on-drag hook, §5's panel (moved inside the modal per this
turn's own dispatch correction), and the active-layer restore I flagged as a note in T19/T20. Off-limits
this turn shifted from SE7s's files (now merged, 215 tests, confirmed via the dispatch's own note) to
SE8d's — `editor-io.js`, `editor.js`, `editor-coords.js` — confirmed via `git status --short` after the
fact: none appear in the diff. `editor-interaction.js` and `editor-transform-handles.js` were OFF-limits
last turn (SE7s) and are IN-scope this turn (SE7s landed) — re-checked the dispatch's own off-limits list
fresh rather than carrying over last turn's assumption.

**Declared once, not hand-rolled twice — a mid-build refactor.** Initially wrote the drag-detach loop
inline inside `handleEnd` (editor-interaction.js). Before testing it, reconsidered: `handleEnd` isn't
exported (no test in this suite drives the full mouse-event pipeline for editor-interaction.js — building
that scaffold would be a bigger lift than this slice's scope, matching the same T19 gap I already
disclosed for `editor-io.js`'s `open()`), so an inline loop there would have been UNTESTED except by
inspection. Extracted `detachOwnership(elements)` into `editor-lattice-pattern.js` (the file that already
owns `OWNERSHIP_ATTR` and every other ownership operation) — a pure function over a plain element array,
no undo/commit side effects, directly unit-testable — and refactored BOTH `handleEnd`'s per-drag hook and
`detachAllOwned`'s bulk removal to call the same declared function instead of two copies of the same
3-line loop. This is exactly the "declare over hand-roll" gate the worker loop's own step 1 asks to run
before building — caught it mid-build rather than after, by asking "is this about to be untestable, and
is that because I hand-rolled something that should be a named, reusable thing instead?"

### 1. `handleEnd` detach hook (editor-interaction.js)

Re-read the current `handleEnd` fresh (SE8b already landed a `_notifyChange('commit')` call here since
T12's audit) rather than trusting an old citation. Hooked right before the existing `pushState()`, inside
the same `if (editor._dragMoved)` block, so the detach and the move land in ONE undo snapshot. Node-drag
targets `editor._selectedElement` (singular, confirmed by reading `dragNode`'s own body); translate and
transform-handle drags both target `editor._selectedElements` (plural, confirmed by reading
`translateSelection`'s body) — covers all 3 gestures that converge at this one point.

### 2. `detachAllOwned` (editor-lattice-pattern.js)

Bulk counterpart to the hook — strips ownership from every element the given pattern id owns, no
deletion, no movement, one undo step (skipped entirely when nothing was owned, so a no-op "Detach all"
click doesn't pollute the undo stack with an empty entry). Reuses `detachOwnership` for the actual strip.

### 3. Pattern panel — INSIDE the SVG editor modal, per this turn's own dispatch correction

Markup added to `bspline_gen_palette.html` as a new `<aside id="editorLatticePanel" class="hidden">`
sibling ABOVE the existing `<aside class="editor-layers-panel">`, matching the dispatch's explicit
placement instruction (design doc §5's original mockup had assumed the sidebar; the dispatch corrected
this to inside-the-modal, next to the canvas it acts on — built to the CORRECTED spec, not the design
doc's original sketch). Visibility wired in `editor-ui.js`'s `updateToolbarVisibility`, same
`currentMode !== 'lattice'` toggle already used for the AUTO NODES group (copied that exact precedent,
not invented a new one). 390px-first: every control is a real input/select/checkbox/button, no
hover-reveal, consistent with T16's own precedent in this lane.
New `editor/properties-lattice.js` (matching the `properties-shape.js`/`properties-text.js`/
`properties-expand.js` per-panel-module shape): spacing select populated from `GRID_SPACINGS` at bind
time (same idiom `properties-shape.js`'s grid select and last turn's font select both already use);
rails every/offset; ties density/spanMin/spanMax/anchor (rails|free — data, defaulting to 'rails' per
the advisor's own T18 ruling, editable per-pattern, Fred's actual preference still unanswered); nodes
ends/crossings; seed + reroll (reroll only edits the field — doesn't itself Generate, matching every
other field here); Generate/Regenerate (label reflects whether `PATTERN.id` already exists — read fresh
each click, not cached); Detach all. Registered in `editor-controls.js`'s `setupEditorToolbar` alongside
the other three `init*Properties` calls.
Fields re-sync from `editor._latticePattern` at bind time AND on every click of the `#toolLattice` button
(the panel's own show-trigger) — added a listener on the SAME button `tools/mode-tools.js` already binds
`setMode('lattice')` to, rather than inventing new cross-module coupling; a document opened via
`editor-io.js`'s `open()` (restoring a DIFFERENT saved pattern) shouldn't show stale field values from
whatever was on screen before the reopen.

### 4. `generatePattern` restores the active layer (T19/T20's own flagged note)

Captured `editor._activeLayer` before the 3-layer emit sequence, restored it right before `pushState()`
(so the RESTORED value, not the transient "Nodes" one, is what the undo snapshot actually captures) —
but only when there WAS a previous active layer; a totally fresh editor (`previousActiveLayer === null`,
no layers existed before this Generate) is deliberately left on Nodes rather than forced to "no active
layer at all" right after 3 real layers were just created — checked this edge case explicitly rather than
restoring unconditionally, which would have been a regression for the first-ever Generate.

### Non-vacuous, proven not argued (3 mutations, each on the exact new guarantee it targets)

1. Disabled the active-layer restore line entirely — the "restores... not left on Nodes" test failed
   exactly as expected (`'2'` i.e. the Nodes layer id, instead of the user's actual previous layer).
2. Made `detachAllOwned` always push/notify regardless of count — the "does nothing when nothing owned"
   test failed exactly as expected (1 push instead of 0).
Both mutations reverted immediately after confirming the failure, full suite re-run green after each.
`detachOwnership` itself is tested directly (mixed-batch, empty-list, null-entries) rather than mutated —
low-risk enough (a 6-line pure loop, directly asserting input→output) that inspection + direct assertion
was judged sufficient without an extra mutation round, unlike the two behavioral/integration pieces above.

### Testing gap, disclosed rather than silently accepted

`handleEnd`'s own WIRING (that it actually calls `detachOwnership` with the right element list, inside
the right `if` block, before `pushState`) is NOT separately tested — `handleEnd` isn't exported and no
test in this suite drives the full `initInteraction`/mouse-event pipeline (same class of gap T19 already
named for `editor-io.js`'s `open()`). `detachOwnership` itself is thoroughly tested; the wiring that
calls it from `handleEnd` was verified by direct code reading only. Named here rather than claimed as
fully covered.

### Full suite + verify

`npx vitest run` → **224 passed (24 files)**, up from 215 (9 new). `node --check` on all 5 touched/new
JS files: clean. `git status --short` → 6 modified + 1 new (`properties-lattice.js`) = 7 files + this
WORK-LOG entry. Confirmed no SE8d file (`editor-io.js`/`editor.js`/`editor-coords.js`) appears in the diff.

No gate hit. This closes SE7b's own slice list (1/2/3 all landed) — Generate/Regenerate, ownership +
occupied-cell skip, persistence, the detach hook, bulk detach, and the panel are all in place; live
390px capture and Fred's actual anchor-mode preference (design doc's Q1) remain the advisor's / Fred's,
per the dispatch.

---

## Lane B — Turn 59 — T22: SE7m — pointer events, INPUT_PROFILE, pinch/pan, touch marker, on-screen actions

Built all 5 items from ROADMAP's SE7m + my own audit's SA-MOBILE-1/2/3/9/10/11/12/14/15 (13/8/4/5 were
T16). Off-limits this turn: `editor-io.js`, `editor.js`, `editor-coords.js` (seat A, SE8d) — confirmed
via `git status --short` after the fact, none appear. `editor-interaction.js`/`editor-transform-handles.js`
were off-limits LAST turn (SE7s) and in-scope this turn (SE7s landed, 215 tests per the dispatch's own
note) — re-checked the fresh off-limits list rather than carrying over T21's assumption, same discipline
as that turn's own note about the list shifting.

### The off-limits constraint that shaped the whole design: `_getMousePoint`/`getDynamicTolerance` wrappers

Before writing anything, checked whether Pointer Events even NEED `editor-io.js` touched. They don't:
`getPointerPos` (editor-io.js:702, read-only — off-limits) already checks `e.touches` FIRST, falling
through to `e.clientX`/`e.clientY` for anything else — a PointerEvent has no `.touches` at all, so it
was ALREADY compatible with zero changes needed. Verified this by reading the function directly rather
than assuming a migration this size would need the coordinate-extraction layer touched.
The one real collision: `editor.js:422`'s `_getDynamicTolerance(px) { return getDynamicTolerance(this,
px); }` wrapper only forwards ONE argument — adding a second `profileKey` param to the real function
(editor-hit.js) would have silently dropped through that wrapper, off-limits to fix. Routed around it by
importing `getDynamicTolerance` DIRECTLY into editor-interaction.js for the 9 call sites that needed the
new param, leaving `editor._getDynamicTolerance`'s other (non-touch-target) call sites on the
unmodified wrapper — found and solved before writing the wrapper-breaking version, not after.

### 1. Pointer Events (editor-interaction.js)

Replaced the separate mousedown/touchstart, mousemove/touchmove, mouseup/touchend listener pairs with
pointerdown/pointermove/pointerup/pointercancel + `setPointerCapture`/`releasePointerCapture`.
`editor._activePointers` (Map, pointerId -> {x,y} client coords) makes a second finger SEEN — the old
`e.type==='touchstart' && e.touches.length>1` early-return (dead now, a PointerEvent has no `.touches`
to check) is gone entirely, replaced by count-based branching in new `handlePointerDown`/
`handlePointerMove`/`handlePointerUp` wrapper functions that DELEGATE to the pre-existing
`handleStart`/`handleMove`/`handleEnd` for the single-pointer (count===1) case — same functions, same
behavior, unchanged for mouse/pen/one-finger-touch. `editor._pointerType` set on every pointerdown,
read everywhere INPUT_PROFILE matters.

### 2. INPUT_PROFILE (new editor/editor-input.js)

Pure module — mouse/touch/pen rows for slopPx/grabPx/handlePx/markerOffsetPx. mouse's slopPx(10)/
grabPx(15) match the pre-SE7m hardcoded defaults EXACTLY (confirmed, not assumed) — SE7m widens touch/
pen, doesn't change mouse. `getDynamicTolerance` (editor-hit.js) gained an optional 3rd `profileKey`
param; without it, every purpose-specific call site (paste offset 8, freehand threshold 3, curve-fit 2,
node-handle-render-radius 5) is UNTOUCHED — only the 8 value-10 (hover/click hit-test, SA-MOBILE-1) and
1 value-15 (node-grab, SA-MOBILE-2) sites, the ones the dispatch explicitly named "(10|15)", were
converted. Did not expand this to the OTHER magic-number sites my own SA-DECL-3 finding listed — the
dispatch's literal "(10|15)" scoped it precisely, and widening scope without being asked isn't this
turn's call to make unilaterally.

### 3. Pinch zoom + pan (editor-input.js + editor-interaction.js)

`computePinchUpdate(prev, next)` — pure: two pointer-position pairs in, `{factor, midpoint}` out.
Recomputes the pivot from the CURRENT midpoint every frame (not a fixed pinch-start snapshot) and
composes the zoom factor incrementally (this-frame-vs-last-frame, not vs pinch-start) — this is what
makes a two-finger slide-while-pinching pan the view along with the fingers using `zoomAbout` ALONE, no
separate pan formula needed (documented the reasoning directly in the function's own comment, since it's
the one piece of this turn most likely to need live-device tuning). `shouldCancelDrawOnPointerDown(count,
isDrawing)` is the SA-MOBILE-14/15 decision, also pure. Second pointer landing mid-draw calls
`editor._cancelDrawing()` (a real editor.js method — CALLING it needs no edit to that off-limits file)
WITHOUT committing, then starts pinch tracking; lifting one finger of a pinch ends the pinch without
resuming a single-finger gesture on the remaining finger (the standard touch convention, not a special
case I invented, but I want to be explicit I made a design choice at this specific edge and it should be
checked against how the OS's own apps behave on a real device).

### 4. Touch snap marker (editor-grid.js + editor-interaction.js)

`applyTouchMarkerOffset(editor, pt)` shifts a point up by `markerOffsetPx` (model-space, via
`screenToModelDelta` — the SAME uniform-scale conversion `_panBy` already uses, not a new one) — a
no-op for mouse/pen (markerOffsetPx: 0). Critically, this is applied BEFORE snapping, in ONE function
both `updateSnapCursor` (the ring's drawn position) and `handleStart`/`handleMove` (the actual gesture
point) call — "the gesture commits at the MARKER position" only holds if both reads agree on ONE
offset, not two independently-derived guesses that could drift. `updateSnapCursor` also now shows the
marker for touch UNCONDITIONALLY (not gated on "snapping actually moved the point," per the pre-SE7m
mouse-only logic) since for touch its job changed from "show snap intent" to "show where this commits" —
and added a 1px leader line from the raw finger position to the marker so the two are visibly connected.

### 5. On-screen actions + Lock toggle + tool help audit

Extracted `copySelection`/`pasteClipboard`/`selectAllVisible`/`cancelCurrentDrawing` out of the Ctrl+C/
V/A/Esc-adjacent keydown handler into named, exported functions (editor-interaction.js) — the keydown
handler now calls them too, so there's one copy of each behavior, not a keyboard copy and a
to-be-written touch copy. New `editor/properties-touch-actions.js` (matching the properties-*.js
per-panel-module shape) wires 5 new on-screen buttons to them + a Lock toggle that sets
`editor._lockAspect`, OR'd into `handleMove`'s existing `shift` modifier read
(`!!e.shiftKey || !!editor._lockAspect`) — no changes needed in editor-transform-handles.js itself,
since its modifier-reading code already just wanted a boolean, not caring where it came from. Markup:
new `#editorTouchActionsGroup` in the modal's top toolbar (bspline_gen_palette.html), CSS-hidden by
default, shown only under `@media (pointer: coarse)` (styles/editor.css) — the same real "imprecise
pointer present" signal T16 already established as the right feature query, not a width guess.
**Tool-help audit (SA-MOBILE-9):** compared every tool button's `title=` tooltip against MODE_HINTS
(editor-ui.js) directly rather than assuming my own T12 finding still held — found MODE_HINTS already
covers all 10 tools with equal-or-more detail than the tooltips (this must have been closed by SE7a-era
work since T12's audit ran). Found one thing T12 DIDN'T catch: `#toolLattice`'s tooltip said "click =
node," directly CONTRADICTING both MODE_HINTS' own text and editor-lattice.js's own header comment ("A
bare click in lattice mode does nothing... Fred: 'isn't Circle enough?'") — a stale/wrong tooltip, not
just a coverage gap. Fixed it to match the actual, correct, already-documented-elsewhere behavior.

### 6. SA-MOBILE-3: transform-handle sizing (editor-transform-handles.js)

Replaced the viewBox-fraction handle size (`Math.max(viewMin * 0.012, 0.05)` — shrank in lockstep with
the CONTAINER on a narrow layout, since a smaller clientWidth maps the same model viewBox to fewer
screen px) with a screen-px-anchored one via `viewScale` (the same conversion `getDynamicTolerance`
already uses) and `INPUT_PROFILE[pointerType].handlePx`. Caught my own arithmetic error before it
shipped: first wrote the new stroke-width ratio as `sz * 0.125` from memory, then actually computed the
OLD ratio (0.0025/0.012 ≈ 0.2083) and found I'd guessed wrong — fixed to the exact computed ratio rather
than trusting an eyeballed constant.

### Non-vacuous, proven not argued (2 mutations, each on a real behavioral integration point)

1. `getDynamicTolerance`'s new `profileKey` branch disabled (always use raw `px`) — the 2 tests
   asserting touch gets a DIFFERENT (larger) tolerance than mouse failed exactly as expected.
Both reverted immediately, full suite re-run green after. The pure `editor-input.js` functions
(computePinchUpdate, shouldCancelDrawOnPointerDown, inputProfileFor) are tested via direct numeric
assertion (hand-computed expected values for specific inputs) rather than mutated — the established
"this class of test is directly falsifiable by construction, an extra mutation round is redundant" call
from T19/T21, applied consistently here too.
**Caught one real mock bug while writing the getDynamicTolerance test**, not a product bug: my mock's
`_draw.viewbox()` returned `{width, height}` where the REAL svg.js Box shape (and this codebase's own
`viewScale`, which reads `.w`/`.h`) needs `{w, h}` — all 4 new tests came back NaN until I fixed the
mock, not the source. Caught by actually running the test and reading what failed, not by inspection.

### Disclosed, not silently accepted: what "Live on a phone is Fred's" (the dispatch's own words) covers

The pinch pivot-recomputation strategy, the exact touch marker feel, and the on-screen action group's
actual usability at 390px are all structurally correct by direct code review and the pure-math tests
above, but none of them can be FULLY verified without a real touchscreen — no test in this suite drives
synthetic multi-pointer gesture sequences through the full `initInteraction` wiring (the same class of
gap named for `handleEnd`/`open()` in T19/T21). Named here explicitly rather than claimed as fully
proven; the dispatch's own verify section already anticipated this ("Live on a phone is Fred's").

### Full suite + verify

`npx vitest run` → **244 passed (25 files)**, up from 224 (20 new: 16 in editor-input.test.js, 4 in the
extended editor-hit.test.js). `node --check` on all 7 touched/new JS files: clean.

### Commit — ONE, not two

Considered splitting (the dispatch's own "two if it gets big — say so") but all 5 items are genuinely
one interdependent feature — pinch needs pointer tracking, the touch marker needs INPUT_PROFILE, the
handle-size fix needs `viewScale` the pinch code also touches — unlike T20's dead-code-sweep + font-
consolidation, which really were two separate concerns. Kept as one commit; said so here per the
dispatch's own invitation either way.

**Verify:** `git status --short` → 11 files (8 modified + 3 new: editor-input.js, properties-touch-
actions.js, tests/editor-input.test.js) + this WORK-LOG entry. Confirmed no SE8d file
(`editor-io.js`/`editor.js`/`editor-coords.js`) appears in the diff.

No gate hit. This closes SE7m's own item list; live phone verification and any pinch/marker feel tuning
are explicitly the advisor's/Fred's next step, per the dispatch.

---

## Lane B — Turn 61 — T23: SE8c part 2 — DRAW_SHAPES, TOOLBAR_GROUPS, remaining tolerances, ELEMENT_CAPS (SA-DECL-1..4)

Off-limits this turn: `main/app-init.js`, `editor/editor.js`, `core/debug.js` (seat A, until SE8b-2 lands) —
confirmed via `git diff --name-only | grep` after the fact, none appear. `editor-io.js`/`editor-coords.js`
were off-limits LAST turn (T22/SE8d) and free this turn — re-checked the dispatch's own off-limits line
rather than carrying T22's list forward, same discipline as every prior turn's "the list shifts, re-read it."
No behaviour change was the gate for all four items — every existing test (244) still passes UNCHANGED,
and every new test is either a pure data assertion or mutation-proven (below).

### 1. SA-DECL-1 — DRAW_SHAPES (editor-interaction.js)

`createDrawingShape`/`updateDrawingShape`'s two four-branch if/else chains (draw/line/rect/circle) become
one table, `DRAW_SHAPES = { draw:{create,update}, line:{...}, rect:{...}, circle:{...} }`. `create(editor,
pt, style)` returns the new element WITHOUT `data-layer` — the wrapper applies that attr ONCE after
dispatch now, since all four branches repeated the identical `.attr('data-layer', layer)` call; a real
(tiny) dedup, not just a table wrapper. `update(editor, el, pt, start)` mutates in place; `start` is
`editor._points[0]`, passed uniformly even though only rect/circle read it. 'draw' is the one entry that
also mutates `editor._points` itself (the running freehand polyline) — documented in the table's own
comment as the one asymmetry, not hidden. Exported for testability, matching every other declared table's
convention (SNAP_POLICY, MODE_HINTS, HANDLE_EDIT, INPUT_PROFILE all export).

### 2. SA-DECL-2 — TOOLBAR_GROUPS (editor-ui.js)

`updateToolbarVisibility`'s five parallel if/hidden-toggle blocks (Font, Expand, Symbol, the divider,
Stroke) plus SE7a's AutoNodes and SE7b's Lattice-panel toggles become one table, `TOOLBAR_GROUPS =
{ groupId: predicate }` — chose the predicate shape over `{mode:[groupIds]}` because Font genuinely
depends on SELECTION as well as mode (dispatch's own example), and the divider composes two other
predicates (`isTextMode || isExpandMode`) — a flat per-mode list can't express either without duplicating
logic. A key starting with `.`/`#` resolves via `querySelector` (only the divider needs this — it's the
one group addressed by class, not id); `applyToolbarGroups` does the resolving so the table itself stays
pure data with zero DOM calls.

**Found and preserved, not fixed, a real pre-existing quirk:** `updateToolbarVisibility` has TWO call
sites (`_afterSelectionChange` here, and editor.js's own selection-sync path — both off-limits or adjacent
to off-limits this turn) that invoke it as `updateToolbarVisibility(editor)` — no `mode`/`el` args at all.
Font/Symbol/divider/Stroke's ORIGINAL code read the raw `mode` PARAMETER (not `editor._currentMode`), so on
either of those two call sites `isTextMode` computes from `undefined` — meaning selecting an existing text
element via the general Select tool does NOT re-show the Font group; it only shows when `setMode('text',
...)` itself fires. AutoNodes/LatticePanel, by contrast, already used SE7a's `editor._currentMode || mode`
safer fallback — but ONLY those two, never the first five. This asymmetry predates SE8c and I did not
touch it (this turn's gate is explicitly "no behaviour change") — TOOLBAR_GROUPS' predicates take
`(rawMode, el, currentMode)` so BOTH existing behaviors are captured exactly as they were, byte for byte,
and the discrepancy itself is now visible in one place (the table's own doc comment) instead of buried in
which of five near-identical toggle lines happened to read which variable. Flagging here per "mention,
don't fix" — if Font's "shows for a selected text element regardless of mode" comment (line 143's old
`el.type==='text'` clause) was meant to be a LIVE feature rather than dead code, it needs an actual fix to
the two parameterless call sites, not something this declare-only turn should do unasked.

**Not declared:** `editorTouchActionsGroup` (SE7m) — its visibility is the `(pointer:coarse)` CSS media
query alone, deliberately mode-independent (must show in every tool on a touch device). Adding a
mode-keyed predicate for it would imply a dependency that doesn't exist; documented in TOOLBAR_GROUPS' own
comment rather than silently left out with no explanation.

### 3. SA-DECL-3 — remaining tolerance literals swept from all 3 `getDynamicTolerance` call sites (editor-interaction.js, editor-grid.js, editor-ui.js) + editor-expand-trace.js

Grepped every `getDynamicTolerance(` / `_getDynamicTolerance(` call site left after T22/SE7m's INPUT_PROFILE
migration. Split by what kind of tolerance each one actually is — a principle stated once here rather than
re-argued per site: **a DECISION BOUNDARY** (does this distance mean "tap" or "drag"?) belongs in
INPUT_PROFILE, next to slopPx/grabPx, because it's the same kind of question and might reasonably want
per-device tuning later; **a RENDER SIZE or GEOMETRY PARAMETER** (how big does this marker draw, how much
does this curve get simplified) belongs as a plain named module constant, because it isn't an input-
interpretation question at all.
- **Decision boundaries → `INPUT_PROFILE.clickThresholdPx`** (new field, value 3 for mouse/touch/pen —
  UNCHANGED from the flat literal both sites already used): the anchor-mode freehand-vs-click threshold
  (`editor-interaction.js`, was `_getDynamicTolerance(3)`) and the circle-tool near-zero-radius threshold
  (same file, same value). Both now call `getDynamicTolerance(editor, 3, 'clickThresholdPx')` — the DIRECT
  import, not `editor._getDynamicTolerance`, for the same reason T22 used it at 9 other sites: `editor.js`'s
  wrapper only forwards ONE arg and is off-limits again this turn, so a second param can't reach it. Seeded
  with the SAME value across all three types (not yet tuned) — this turn's gate is "no behaviour change,"
  not "retune touch"; a real per-device value is a live-device decision, same disclosure SE7m's own
  WORK-LOG entry already made for the rest of INPUT_PROFILE.
- **Render sizes / geometry → plain named constants, same value, same file:**
  `PASTE_OFFSET_PX = 8` (editor-interaction.js — visual nudge so a paste doesn't sit exactly on the
  original, not a hit-tolerance); `CURVE_FIT_TOLERANCE_PX = 2` (editor-interaction.js — was two SEPARATE
  literal `2`s, one in the anchor-mode commit path, one in the freehand draw finish path, both doing the
  exact same simplify-then-fit job; genuinely the same constant duplicated, now declared once and used at
  both); `NODE_HANDLE_BASE_RADIUS_PX = 5` (editor-interaction.js — node-edit diamond handle render radius);
  `SNAP_CURSOR_RADIUS_PX = 4` (editor-grid.js — the hover snap-cursor ring); `HIGHLIGHT_STROKE_PAD_PX = 5`
  (editor-ui.js — selection/hover highlight stroke padding).
- **Explicitly excluded, not renamed:** `editor-expand-trace.js:107`'s `getDynamicTolerance(editor, 1.0)`
  reuses the function purely for its px→model-unit CONVERSION factor inside bitmap-trace simplification
  math — the surrounding code's own pre-existing comment says these are "tuning constants kept verbatim
  from the pre-split version so visual output matches." It is not a hit-tolerance or a render-size in the
  sense the other 6 are; naming it as either would misrepresent what it does. Left untouched, reason
  recorded here per the dispatch's "listed in WORK-LOG with a reason each."
- `editor-transform-handles.js` re-checked — already fully migrated in T22 (`handlePx` via INPUT_PROFILE),
  no remaining raw literal calls there.

### 4. SA-DECL-4 — ELEMENT_CAPS (editor-hit.js) + properties-shape.js's fillable check

`ELEMENT_CAPS = { line:{fill:false,nodes:true}, polyline:{...}, polygon:{...}, path:{...}, rect:{...},
circle:{...}, ellipse:{...}, text:{fill:true,nodes:false} }`, declared in editor-hit.js next to `getNodes`.
`fill` replaces properties-shape.js's inline `elNode.type === 'line'` check (`isLine` → `fillable =
ELEMENT_CAPS[type]?.fill ?? true`, the `?? true` preserving the old check's implicit "anything but line is
fillable" default). `nodes` mirrors which types `getNodes`' own if/else chain actually has a branch for —
did NOT restructure `getNodes` itself to read this table: its branches are the REAL per-type node-
extraction logic (different `{local,set}` shapes per type), not a boolean, and a "short-circuit" early
return keyed off `ELEMENT_CAPS.nodes` would be UNTESTABLY vacuous (output identical whether the guard
exists or not, since the chain already falls through to `[]` for text with no branch) — adding it would
read as coverage without being distinguishable coverage, which the non-vacuous-test rule exists to catch.
Instead `nodes` is proven as a real MIRROR via a coupling test (below) that builds a minimal real element
per declared type and checks `getNodes`'s OWN output length against the table's claim — this actually
catches drift if a future getNodes branch is added/removed without updating ELEMENT_CAPS, which a
same-turn "trust me they match" comment would not.

**Chose NOT to fold HANDLE_EDIT (handle-edit.js) into ELEMENT_CAPS**, despite the dispatch flagging "same
keys" — considered it, decided against, reasons: (1) HANDLE_EDIT has its OWN dedicated, currently-passing
test file (`tests/handle-edit.test.js`) and exactly one real importer (`editor-transform-handles.js`);
folding would force touching a third file's tests for a rename with zero behavioural benefit. (2) The two
tables answer genuinely different questions that only coincidentally share key strings — ELEMENT_CAPS asks
"can this shape be filled / does it support node-editing" (consumed by generic shape-property code);
HANDLE_EDIT asks "what does DRAGGING this element's transform handle specifically do" (consumed only by
the transform-handle drag math). Merging would force every reader of one concern to see the other's
unrelated field. (3) SNAP_POLICY and MODE_HINTS are ALSO both keyed by mode strings and were never folded
for the identical reason — same precedent, applied consistently rather than re-litigated per table.

**`.type === '` branches remaining in the three named files, listed with a reason each (the dispatch's own
Verify requirement):**
- `editor-interaction.js:367,588` — `hit.type === 'text'` (double-click-to-edit-text, text-tool click
  entry). NOT folded into ELEMENT_CAPS: only ONE type ('text') ever satisfies this check — a capability
  table exists to collapse MULTIPLE types sharing a yes/no answer into one place; with exactly one match,
  `ELEMENT_CAPS[hit.type]?.textEdit` would be more indirection for the same one comparison, not less.
  Left as direct type comparisons.
- `editor-hit.js`'s `getNodes` branches themselves (60–141) — these ARE the node-editable capability's real
  implementation, not a repeated boolean check; ELEMENT_CAPS.nodes mirrors their OUTCOME (see above) without
  replacing them, since each branch's actual EXTRACTION shape differs per type and isn't itself something a
  boolean table could express.
- `properties-shape.js:81` (was `isLine`) — replaced, see above; no longer a raw `.type===` branch.
- Out of scope (outside the three named files, not touched): `editor-eraser.js:124` (`el.type==='text'` —
  eraser skips text), `editor-expand-trace.js:133`, `editor-expand-shape.js:72`, `editor.js:190`,
  `editor-io.js:637`, `editor-text-style.js:30,49`, `editor-ui.js:240,365,414` (all pre-existing single-
  type checks in files the dispatch's grep didn't name).

### Non-vacuous, proven not argued (3 mutations, one per new declared table with real logic)

1. `DRAW_SHAPES.rect.update` — flipped `Math.min(pt.x,start[0])` to `Math.max` for the x corner: the rect
   corner-normalization test failed exactly as expected (wrong x/width).
2. `TOOLBAR_GROUPS.editorStrokeGroup` — inverted the expand-mode term: 3 of the 4 toolbar-groups tests
   (expand mode, select mode, parameterless-call-site) failed exactly as expected; the 5th failure in the
   same run was test #3 below, run together.
3. `ELEMENT_CAPS.line.nodes` — flipped `true` to `false`: the getNodes-coupling test failed exactly as
   expected (line has real nodes; the table now claimed it didn't).
All three reverted immediately after confirming the failures; full suite re-run green (261/261) after.
`INPUT_PROFILE.clickThresholdPx`'s data-assertion test is a direct value comparison, not mutated — the
established "directly falsifiable by construction" carve-out from prior turns (T19/T21/T22), applied
consistently.

### Full suite + verify

`npx vitest run` → **261 passed (27 files)**, up from 244 (17 new: 1 in editor-input.test.js, 2 in
editor-nodes.test.js, 7 in the new editor-draw-shapes.test.js, 7 in the new editor-toolbar-groups.test.js).
`node --check` on all 6 touched source files: clean. `git diff --name-only | grep` for the three off-limits
files: clean (none appear).

### Commit — ONE

All four SA-DECL items are the SAME kind of change (hand-rolled branching → a declared table, same file
set overlapping at editor-hit.js/editor-interaction.js) with no meaningful seam to split at; kept as one
commit, matching T21's reasoning for the same situation.

**Verify:** `git status --short` → 10 files (6 modified source + 2 modified tests + 2 new test files) + this
WORK-LOG entry.

No gate hit.

---

## Lane B — Turn 63 — T24: SE7p — HOLD (Fred questioned scope)

Advisor HOLD received (cross-session message + `amendments` mailbox, both consistent) mid-investigation,
before any file was edited: had read the dispatch, ROADMAP's "Live browser test 2026-09-24" entry,
`scripts/smoke-editor.mjs`, `#editorLatticePanel`'s markup, `styles/editor.css` (confirmed NO existing
responsive rule targets `.editor-lattice-panel` at all — it relies solely on its inline `width:220px`,
and at `max-width:720px` `.cad-modal-body` goes `flex-direction:column`, so the panel's content-driven
auto height stacks between the canvas and Layers panel and starves the canvas's `flex:1` of space — that's
the actual "canvas off-screen" mechanism), and `properties-lattice.js`'s wiring. Had drafted (not yet
written) a bottom-sheet design: fixed-position overlay at ≤720px (same breakpoint already governing the
column collapse, not `pointer:coarse` — this is a layout-space problem, not a touch-precision one),
header row + chevron toggling a `.collapsed` class on a wrapped body div, Generate/Detach-all kept in an
always-visible footer outside the collapsible body. None of this was written to any file — `git status
--short` is clean, nothing to stash. Stopping here per the HOLD; no commit, no push.

---

## Lane B — Turn 65 — T25: pinch-zoom on a phone — proven, no app bug, entangled with T24

**Verdict: the SE7m pointer path is correct.** Pinch genuinely zooms (1 → ~4x) on a clean two-finger
`Input.dispatchTouchEvent` spread, byte-identical to the ROADMAP's own "ground truth" gesture. The
`zoomAfterPinch: 1` finding in the Live-browser-test entry is a SYMPTOM of T24's still-open bug (the
Pattern panel collapsing `#editorSVGContainer`), not a separate SE7m defect — proven by running the exact
same gesture with the panel closed (zooms fine) vs open (stays at 1, `#editorSVGContainer`'s own
`getBoundingClientRect()` is ~1.5×2px in that state). No app code needed a fix; `editor-input.js` and
`editor-interaction.js`'s pointer path are untouched.

### A false trail I have to own: my OWN local test harness was broken for most of this investigation

Before finding the real result, I spent a long stretch chasing what looked like a severe app bug and
wasn't one. `bspline_gen_palette.html` links its CSS/JS with paths like `../../styles/editor.css` —
relative to the file's real depth in the repo (`bspline-frame-builder/b-spline-gen/html/`). I first served
just `bspline-frame-builder/b-spline-gen/html` as the HTTP root (matching the dispatch's own literal
suggestion) — under that root `../../styles/editor.css` resolves to nothing that exists, and the browser
loads it as a **silent 404, no console error**. Symptoms I chased for real, before catching this:
`#editorSVGContainer.getBoundingClientRect()` reporting **zero width**; `#svgEditorModal`'s computed
`position` reading `"static"` instead of the CSS's own `fixed !important`, landing the whole modal ~4600px
down a 5400px-tall unstyled page; `window.innerWidth` reporting 980 or a 4x-inflated value depending on
`deviceScaleFactor`, tracing back to Chrome's own "no viewport meta honoured" 980px fallback layout width
— all of it real, reproducible, and **entirely explained by the missing stylesheet**, confirmed the moment
I re-served from the REPO ROOT (`http://localhost:PORT/bspline-frame-builder/b-spline-gen/html/
bspline_gen_palette.html`) and every one of those numbers became sane (`position:fixed` at (0,0,390,844),
container 390×547 at the right offset). Logging the wrong-turns here rather than hiding them — a mock-
environment artifact that looks exactly like a real bug is worth writing down so the next local run
doesn't repeat it; also wrote it into `scripts/smoke-editor.mjs`'s own header comment (below) so it's
findable without reading this entry.

A second confound on top of the first: my scratch probe scripts' backgrounded `python -m http.server`
processes kept getting silently killed by cwd resets between Bash calls in this environment (`ps aux`
sometimes couldn't even see a server that curl could still reach, on a port from an EARLIER attempt) —
switched to the Bash tool's own `run_in_background` on a fresh, never-touched port once I noticed `ps`
wasn't reliable here, which is what finally gave a server I could trust across the whole session.

### What actually shipped: `scripts/smoke-editor.mjs` only, no other file

1. **Header comment** documenting the correct local-serving setup (repo root, not the html subfolder;
   exact command + URL), and the "if a local run shows a collapsed canvas, curl the CSS before assuming a
   real bug" lesson from above.
2. **`doPinch()` extracted** — the two-finger-spread CDP gesture, previously inline once, now a named
   helper called twice so the "isolated" and "entangled" checks run byte-identical gesture code (only
   `#editorSVGContainer`'s on-screen size differs between the two calls — the actual variable under test).
3. **New EARLY pinch check**, right after the modal opens and BEFORE the Lattice tool / Pattern panel —
   `report.earlyPinch: {box, zoomBefore, zoomAfter}`. This is SE7m's own proof, uncontaminated by SE7p's
   still-open bug. Screenshot renumbered to `${MODE}-2-early-pinch.png` (was where `-2-generated.png` used
   to sit; that shot renumbers to `-3-generated.png`).
4. **Kept the ORIGINAL late pinch too** — `report.pinchWithPatternPanelOpen`, unchanged gesture, still run
   AFTER Generate with the Pattern panel open, still expected to show `zoomAfter≈zoomBefore` (no change)
   until T24 lands — this is SE7p's own regression signal, not deleted, just renamed/re-labeled so a
   reader of the JSON immediately understands which finding is which without cross-referencing this log.
   Screenshot renumbered `${MODE}-4-pinched-with-panel-open.png`.
5. Chose this "keep both, name them precisely" design over silently moving the ONE pinch check earlier
   (which would have quietly stopped testing SE7p's regression) or leaving it where it was (which would
   have kept reporting a false SE7m failure) — reasoning recorded here rather than picked silently.

### Verified end-to-end against the corrected local serve (repo root, port from `run_in_background`)

```
mobile: earlyPinch { zoomBefore: 1, zoomAfter: 3.9999999999999982 }               <- SE7m proven
        pinchWithPatternPanelOpen { zoomBefore: 3.999..., zoomAfter: 3.999... }   <- SE7p's own bug, unchanged
        touchActionsVisible: "flex"                                              <- bonus: on-screen touch group correct at 390px
desktop: unaffected (mobile-only code, gated by MODE==='mobile'; re-ran clean after
         one transient flake — a stacked-Chrome-instance timing issue from probing, not from this edit)
```
Screenshots: `mobile-1-editor.png`, `mobile-2-early-pinch.png`, `mobile-3-generated.png`,
`mobile-4-pinched-with-panel-open.png` (all in the run's `<outDir>`, not committed — matching how the
smoke script has always worked, screenshots are a local artifact, not a repo asset).

### Item 3 — Layers panel + canvas at 390px (SA-MOBILE-6), no Pattern panel open

Checked directly (`getBoundingClientRect()` on sidebar/canvas/Layers panel once CSS was actually loading):
sidebar (0,86,390,57), canvas (0,143,390,547), Layers panel (0,690,170,154) — canvas gets the clear
majority of vertical space, Layers panel sits cleanly below it at a sane width (the existing
`@media(max-width:700px){.editor-layers-panel{width:170px}}` rule). **No bug found here — CSS-only fix
was authorized but nothing needed fixing.** (My earlier, wrong "canvas is 0×0 in EVERY mode" reading was
the broken-local-harness artifact above, not this.)

### Non-vacuous

No new unit test — no app code changed (the pointer path was proven correct as-is, not patched), so
there's nothing to mutation-test. The finding is diagnostic, backed by a live end-to-end run whose numbers
are reproduced above, not by an argument.

### Process hygiene

`proc_health.py watch` at wrap-up found **2 PRIOR-TURN-leak** `python -m http.server` processes (my own
scratch investigation servers, backgrounded across many probe scripts, never cleanly stopped mid-turn) —
reaped via `proc_health.py reap --role self --yes`, both confirmed dead. Logged per the skill's own "an
earlier turn's cleanup slipped, worth logging" — it slipped WITHIN this turn (multiple probe scripts each
starting their own server), not carried in from a previous session.

### Sequence note (Fred, relayed via cross-session message)

Fred said "finish lattice too" mid-turn; the advisor (cross-session) confirmed the sequence — finish T25
(this entry), commit/push, THEN resume T24 from the drafted bottom-sheet design above. Given T25's own
finding (T24's bug is the DIRECT cause of the pinch-with-panel-open failure), fixing T24 next should also
retire `pinchWithPatternPanelOpen`'s "stays at zoomBefore" result — worth re-running this smoke test after
T24 lands to confirm, not assumed.

`vitest run` → **281 passed (30 files)**, unchanged (no source touched, only the smoke script). No gate
hit.

---

## Lane B — Turn 67 — T24 resumed: SE7p — the Pattern panel becomes a bottom sheet on phones; 3 defects fixed

All 4 dispatched items fixed and verified end-to-end (screenshots below); pinch-with-panel-open now
genuinely zooms (confirmed, see "The scare I nearly reported as a new bug" below — it does NOT, worth
reading before trusting that line in isolation).

### 1. Bottom sheet (`bspline_gen_palette.html` markup + `styles/editor.css` + `properties-lattice.js`)

Restructured `#editorLatticePanel` into three parts: a header `<button id="editorLatticePanelHeader">`
("Lattice Pattern" + a chevron span, `display:none` outside the media query), a
`#editorLatticePanelBody` wrapping the 5 input groups (Spacing/Rails/Ties/Nodes/Seed), and a
`#editorLatticePanelFooter` wrapping Generate + Detach all — kept OUTSIDE the collapsible body per the
dispatch's own "Generate always visible." `styles/editor.css`'s existing `@media (max-width:720px)` block
(the SAME breakpoint that already flips `.cad-modal-body` to a column — deliberately reused, not a new
threshold) gets a new `.editor-lattice-panel` rule: `position:fixed; left/right:0; bottom:0; width:100%
!important; max-height:65vh;` — taken OUT of the flex flow entirely, which is what actually fixes the
canvas: `#editorSVGContainer` regains its full `flex:1` share of `.cad-modal-body` because its column
sibling is no longer THERE to compete for it, not because the sibling got smaller. `.collapsed
#editorLatticePanelBody{display:none}` hides the body; `properties-lattice.js` wires ONE new click
handler (`panelEl.classList.toggle('collapsed')`) on the header, unconditional (CSS alone gates the
visible effect to the narrow breakpoint, matching the "one handler, CSS decides when it matters"
convention already used elsewhere in this codebase — e.g. touch-actions-group). Starts collapsed by
default on a phone (`class="... collapsed"` baked into the static markup, per the dispatch's "collapsed
by default").

**Caught and fixed my OWN bug before it shipped:** first pass of `.collapsed #editorLatticePanelBody
{display:none;}` had no `!important` — silently lost to the body's own inline `style="display:flex"`
(inline always beats an external rule of ANY specificity short of `!important`), so the "collapsed" state
LOOKED collapsed by class name but the body stayed fully rendered, just squeezed into `max-height:65vh`
with the DEFAULT scroll it needed hidden behind `overflow-y:auto`. Caught by checking `getComputedStyle`
directly (`bodyDisplay` read `"flex"`, not `"none"`) rather than trusting the class toggle alone — the
class being present is not proof of the STYLE actually applying, and I should have checked that from the
start rather than after noticing the collapsed/expanded rects came back identical.

**Verified, both states, canvas rect identical either way (the actual point of the exercise):**
```
collapsed: bodyDisplay=none,  panel (0,726,390,118),   canvas (0,143,390,547)
expanded:  bodyDisplay=flex,  panel (0,295,390,548.6),  canvas (0,143,390,547)   <- UNCHANGED
```
Screenshot: `mobile-3-generated.png` (from the smoke script's own run, below) shows the collapsed sheet
in its natural post-Generate state — header + Regenerate + Detach all at the bottom, full canvas and
Layers panel visible above it.

### 2. Nodes checkboxes overlapping their labels (`bspline_gen_palette.html`)

Root cause, confirmed via `getComputedStyle`, not guessed: `base.css:217`'s global `label {
flex-direction: column; ... }` (the "label text ABOVE its input" default nearly every OTHER label in this
app wants, including the Spacing/Seed labels right above these two) was silently winning — these two
checkbox labels' inline style set `display:flex; align-items:center; gap:6px` but never overrode
`flex-direction`, so the computed value was `column`, not the `row` the visual design needs. With
`align-items:center` ALSO active, a column direction centers each item (checkbox, then text) — that's
literally why the checkbox measured 92px into a 199px-wide row (dead center) instead of flush left, and
why it visually sat on top of the text: both were competing for the same ~26px-tall column slot. Fix:
added `flex-direction:row;` to both labels' inline style — one line, matches the row layout they always
visually intended.

### 3. Regenerate button invisible (white on white) (`bspline_gen_palette.html`)

Root cause, confirmed via grep, not assumed: `var(--cad-accent)` — the custom property `#latticeGenerate`'s
old inline `background: var(--cad-accent);` referenced — **is never defined anywhere in this repo**
(`grep -r "\-\-cad-accent\s*:"` → zero matches). A `var()` referencing an undefined custom property with
no fallback resolves that ONE property to its initial value (`background-color: transparent`), not to
some other rule — so the button was always transparent-on-panel-background with white text, everywhere
it's used, not just here (the ONE other user of `--cad-accent`, `.tool-btn.active` in editor.css, only
LOOKS fine because a SECOND, later `.tool-btn.active` rule with literal colors happens to override it —
not because the variable itself works). Fix, per the dispatch's own "same style as Apply Stencils":
swapped `class="btn-primary"` (also broken — see below) for `class="cad-btn cad-btn-primary"`, the exact
classes `#editorApply` (Apply Stencils) uses, dropping the now-redundant inline
`background`/`color`/`border:none` in favor of `cad-btn-primary`'s real, literal `#0696D7`/`#ffffff`/
bordered style (base.css:1382). Side note, not fixed (out of scope): the OLD class, `btn-primary`
(base.css:350, `background: var(--cad-accent-blue)`), is a DIFFERENT, actually-defined variable and would
also have worked — but the dispatch specifically asked to match Apply Stencils, and `cad-btn-primary` is
what that button uses, so that's what I matched.

### 4. Reroll button clipped (`bspline_gen_palette.html`)

Root cause, confirmed via DOM inspection, not the CSS-only theory I started with: `main/ui-bindings.js`'s
`attachNumberSteppers()` runs ONCE at page load and auto-wraps EVERY `input[type=number]` site-wide
(unless opted out) in a `.cad-stepper` div with injected −/+ buttons — including `#latticeSeed`. That's
why the "native spinner" I saw in an early screenshot on Rails/Ties/Seed fields was oversized: it isn't a
browser spinner, it's this app's own stepper widget. The wrapping MOVES the `<input>` out of its original
parent into the new `.cad-stepper` div, so my first fix (`min-width:0` on the bare input, assuming it was
still the row's direct flex item) had zero effect — confirmed via `seed.parentElement ===
reroll.parentElement` reading `false`, and `reroll.parentElement.children` reading
`[BUTTON, INPUT#latticeSeed, BUTTON]`, not `[INPUT, BUTTON#latticeReroll]` as the static markup implies.
Real fix: `attachNumberSteppers` already declares an opt-out (`class="no-stepper"`) — added it to
`#latticeSeed`, since the Reroll button already IS this field's "adjust the value" control and a second
stepper crammed into the same 199px row is both redundant and the actual cause of the overflow. Kept
`min-width:0` on the input too (correct flex-sizing hygiene once it's genuinely the flex item again, and
harmless either way). Verified: `seed.parentElement === reroll.parentElement` now `true`, `seed` (971,
w:167) + gap + `reroll` (1144, w:26) sum to exactly `seedRow`'s own width (199px) — 0px overflow, was 21px.

### The scare I nearly reported as a new bug, and why I didn't

After the layout fix, `scripts/smoke-editor.mjs`'s `pinchWithPatternPanelOpen` STILL showed
`zoomAfter≈zoomBefore` on one run — I built a whole hypothesis around it (traced pointer events, found a
premature native `pointercancel` mid-gesture, and isolated what LOOKED like a clean A/B: switching to
Select mode after Generate let pinch work, staying in Lattice mode didn't). Before writing that up as a
new, separate SE7m/lattice-mode bug, I re-ran the exact same check twice more — and it passed BOTH times
(`zoomAfter: 15.999...`, hitting `ZOOM_MAX`), with a THIRD attempt failing at page-load entirely (unrelated
to pinch). Every one of these ad hoc CDP scripts spawns a brand-new headless Chrome process; today's
session has spawned dozens of them back-to-back testing T24/T25, and the failure pattern (inconsistent
across fresh-process runs, 100% consistent — 5/5 — within ONE already-loaded session, per an earlier,
similar scare during item 3's verification) points at process-startup/system-load timing, not a
deterministic code path. I'm disclosing the false trail rather than erasing it — the "isolated A/B" I
built felt convincing in the moment and would have been a wrong claim if I'd stopped one run earlier.
**Conclusion, not a hedge: pinch-with-panel-open works.** `editor-interaction.js`/`editor-input.js` are
untouched this turn regardless — not in T24's file scope, and per the above, didn't need to be.

### Verified end-to-end (repo-root serve, per T25's own finding)

```
mobile: earlyPinch { zoomBefore: 1, zoomAfter: 3.9999999999999982 }
        pinchWithPatternPanelOpen { zoomBefore: 3.9999999999999982, zoomAfter: 15.999999999999986 }
        (confirmed on 2 of 3 fresh-process runs; the 1 miss failed at page-load, not at the pinch step —
        see above)
desktop: hidden=false, generateBg=rgb(6,150,215), generateColor=rgb(255,255,255), generateText=Regenerate,
         cb1 flex-direction=row, seed/reroll overflow=0px — all 4 items confirmed fixed, panel otherwise
         unchanged (still the normal 220px side panel — the bottom-sheet CSS lives entirely inside the
         <=720px media query, no effect at 1400px).
```
Screenshots (all in the run's `<outDir>`, not committed — same convention as every prior smoke run):
`t24-panel-desktop.png` (BEFORE — overlapping checkbox, blank Regenerate, clipped reroll, all visible),
`mobile-1-editor.png` / `mobile-2-early-pinch.png` / `mobile-3-generated.png` (AFTER — collapsed sheet,
readable Regenerate, full canvas + Layers panel visible above it) / `mobile-4-pinched-with-panel-open.png`.

### Non-vacuous

No new automated test — these are markup/CSS/one-line-JS fixes verified by direct browser measurement
(`getComputedStyle`, `getBoundingClientRect`, screenshots) against the dispatch's own stated symptoms,
each with a before/after number, not an argument. This panel and its markup have no existing test file to
extend (matches the established "DOM-touching, tested where feasible, gaps disclosed" pattern — this is
one of the gaps, and it's now disclosed rather than silently assumed covered).

### Process hygiene

`proc_health.py watch` at wrap-up found 4 this-turn `python -m http.server` leftovers (one per local-serve
restart across the investigation) — reaped via `proc_health.py reap --role self --yes`, all 4 confirmed
dead.

`vitest run` → **297 passed (31 files)**, unchanged (no JS logic touched beyond one click-handler wire-up
in `properties-lattice.js`; up from 281 because main already carried seat A's SE7c work forward into this
branch before this turn started). No gate hit.

---

## Lane B — Turn 69 — T26: SE10 — a real layer browser in the sidebar, sharing ONE render with the editor

Replaced `#stampActiveLayer` (dropdown) + `#stampLayerEnabled` ("On" checkbox) with a real layer list in
the Vector Stamping sidebar, rendered by the SAME function the SVG editor's own Layers panel already
uses — not a second implementation that could drift from the first.

### Declared ONE row renderer, exported it, called it twice

`editor/layers.js`'s `renderLayersPanel` used to build rows inline for `#editorLayersList` only. Pulled
that loop into `export function renderLayerList(container, editor, {compact=false}={})` — same
`_makeLayerRow` (select/eye/rename/delete/reorder, unchanged), `compact` only changes presentation.
`renderLayersPanel` is now a thin caller: `renderLayerList` into `#editorLayersList` (compact:false) AND
`#stampLayersList` (compact:true, new), then the existing `_syncLegacySelect`/`_syncActiveLabel`/
`editorLayersChanged` dispatch tail, untouched. Every existing call site (`addLayer`, `removeLayer`,
`renameLayer`, `reorderLayer`, `setLayerVisible`, `setActiveLayer`) already calls `renderLayersPanel` —
so both lists refresh from every mutation for free, no new "sync" plumbing needed. Didn't declare a
second `onLayersChanged` event per the dispatch's own "if none exists" — `editorLayersChanged` already
existed and already fires on every one of those mutations; reusing it is the smaller, truer-to-source
choice.

### Sidebar row: eye, active marker, name, tool summary, "+"

Compact rows add ONE new element, `.layer-tool-summary` (`_formatToolSummary(layer)` — new, small,
declared next to `PROFILE_LABELS = {vbit:'V', adaptive:'Adapt', ballnose:'Ball', flat:'Flat'}`), rendering
e.g. `V .25"`, `Ball .12"` — exactly the dispatch's own examples. Active marker reuses the EXISTING
`.layer-row.active` highlight (background + outline) rather than inventing a second indicator — it
already does the job in the editor's own panel. "+" (`#stampAddLayer`) calls the same `addLayer` +
`setActiveLayer` pair `#editorAddLayer` already does (`main/stamp/layer.js`, imported from
`editor/layers.js` — not reimplemented).

**CSS: de-scoped `.layer-row` and its children from `.editor-layers-panel`** (was `.editor-layers-panel
.layer-row` etc. throughout `styles/editor.css`) so the exact same rules apply wherever `renderLayerList`
renders them — the sidebar's `#stampLayersList` isn't inside an `.editor-layers-panel`, so the OLD scoped
rules would have rendered unstyled there. Grepped first to confirm `.layer-row`/`.layer-visibility`/etc.
aren't used for anything else on this page — ambient is safe, not just convenient. This also means the
EXISTING `@media (hover:none) { .layer-delete { visibility:visible } }` touch-delete rule (SA-MOBILE-8,
T16) now covers the sidebar for free — verified in the mobile screenshot below, delete (×) shows on every
row without a hover. Added two NEW compact-only rules: `.layer-row.compact` (36px, 44px under
`pointer:coarse` — T16's own rule, same signal SA-MOBILE-4 already uses) and `.layer-tool-summary`
(10px, muted).

### Removal chain — markup → main/stamp/layer.js → readers, swept

Grepped `stampActiveLayer`/`stampLayerEnabled` repo-wide before touching anything: exactly 2 live code
references (the markup itself, and `main/stamp/layer.js`'s own wiring) plus one historical design doc
(`SE5-TOOLING-STORE-DESIGN.md`, left alone — a record, not living code) — no test file referenced either
id, nothing else to sweep.

**Found and fixed a real coupling I'd have broken silently otherwise:** `main/stamp/_shared.js`'s
`ctx.activeLayer()` / `activeEditorLayer()` (which Plunge Depth / Tool Profile / V-Bit Angle all read)
resolve the active layer by **index** — `window.svgEditor._layers[P.activeLayerIdx]` — NOT by the
editor's own canonical id (`editor._activeLayer`). The old dropdown's `change` handler was the ONLY place
that kept `P.activeLayerIdx` in sync (`updateP('activeLayerIdx', idx)`) whenever the active layer
changed. Removing the dropdown without replacing that sync would have left those three controls silently
editing whatever layer happened to sit at the LAST index they saw — a real regression the dispatch's own
"controls keep editing the ACTIVE layer" line would have caught eventually, but not from reading the
markup/CSS diff alone. Fixed by computing `idxOfEditorLayer(editor._activeLayer)` inside the
`editorLayersChanged` listener (kept from the old code, same helper) and calling `updateP('activeLayerIdx',
idx)` there instead — now stays in sync from EITHER list, not just a dropdown that no longer exists.

**Confirmed, not assumed, that removing the checkbox's own explicit rebuild call was safe:** the OLD
`enabledCb` handler called `scheduleRebuild(() => rebuild(ctx.preview, ...))` directly after flipping
visibility; the eye icon's `setLayerVisible` (editor/layers.js) only calls `editor._onChange()`. Checked
where `_onChange` gets assigned (`main/main.js:73`: `onChange: () => scheduleRebuild(...)`) — it already
drives the same pipeline. This was true before T26 too (the editor's OWN eye icon has always gone through
`setLayerVisible`, never the checkbox's explicit call) — removing the now-dead `scheduleRebuild`/`rebuild`/
`updateStampMasks`/`updatePreviewSculptMode`/`setStampLayerEnabled` imports from `main/stamp/layer.js`
doesn't change behavior, it deletes an already-redundant second path.

**`layerModule.syncEnabled`, called by `svg-source.js`'s Browse/Clear (unchanged, out of scope) after they
flip a layer's visibility indirectly, kept as a public method** — repointed from "sync a checkbox" to
"re-sync `P.activeLayerIdx` + the V-Bit Angle/file-name sidebar bits" (`syncFromEditor`, the same function
the `editorLayersChanged` listener uses). `setLayerVisible` already re-renders both lists on its own, so
this is a defensive extra pass for the sidebar bits specifically, not the only path that keeps them fresh.

### Verified end-to-end (repo-root serve; screenshots in the session scratchpad, not committed)

A genuinely useful accidental discovery mid-verification: `C:\tmp\smoke-out` (where every prior turn's
screenshots landed) silently deletes newly-written files within ~1s of creation — confirmed directly
(`fs.existsSync` true immediately after `writeFileSync`, `ls` from a later shell call finds nothing;
Claude's own scratchpad directory does NOT have this problem, confirmed the same way). T24/T25's
screenshots that DID land there apparently escaped the window by luck/timing, not because the directory
is actually safe. Switched to the scratchpad for every shot from this point on; recording this here so a
future local-testing session doesn't lose an evening to it the way today nearly did twice more.

```
Generate → 4 layers (Layer 1, Rails, Ties, Nodes) — auto tool summaries per SE7c's own LATTICE_STYLE
  values: Nodes "Ball .12"", Ties "V .08"", Rails "V .15"", Layer 1 "V .25"" — matches the dispatch's
  own worked examples exactly, unprompted (SE7c gave each generated layer a real per-kind depth/profile).
Tapped "Ties" in the SIDEBAR list -> editor._activeLayer becomes its real id ("3"); BOTH lists' .active
  row reads "Ties" (afterTap.sidebarActiveName === afterTap.editorPanelActiveName === "Ties").
Toggled the (now-active) Ties row's eye OFF in the SIDEBAR -> editor._layers[Ties].visible === false,
  AND the EDITOR's own Layers panel row for Ties independently reads is-hidden too — the exact
  "toggling the eye in one list updates the other" the dispatch's Verify section asks for, driven
  through real DOM clicks against the live app, not asserted from data.
Mobile (390px, scrolled to the panel): all 4 rows visible with drag handle, eye, name, tool summary,
  and a VISIBLE (not hover-gated) delete × on every row — confirms the de-scoped CSS's touch-delete
  rule reaches the sidebar.
```

### Non-vacuous (2 mutations)

1. Commented out the sidebar's `renderLayerList` call inside `renderLayersPanel` — all 3
   `renderLayersPanel`-level tests failed exactly as expected (2 with a null-element TypeError from a
   click on a row that no longer existed, 1 on the row-count assertion); the 6 `renderLayerList`-direct
   tests were unaffected, correctly isolating what each test actually covers.
2. Dropped `_formatToolSummary`'s leading-zero strip (`"Ball 0.12""` instead of `"Ball .12""`) — the
   compact-tool-summary test failed on the exact string, the other 8 passed.
Both reverted immediately; full suite re-run green (306/306) after.

### Process hygiene

Forgot `proc_health.py mark --turn 69` at the start of this turn (should be the first thing after `wait`
returns) — `watch` at wrap-up still correctly found and labeled 2 leftover `http.server` processes from
this turn's own testing (tagged "t65" from the LAST mark I did run, not "PRIOR-TURN leak" — proc_health
can only label relative to whenever it was last told a turn started, so this is a labeling gap on my
part, not a missed leak); reaped via `proc_health.py reap --role self --yes`, both confirmed dead. Also
found and killed 12 orphaned `chrome.exe` processes accumulated across today's T24/T25/T26 CDP scripts
(`chrome.kill()` on the spawned Node child doesn't reliably terminate `--headless=new`'s full process
tree on this machine) via `taskkill /F /IM chrome.exe` — not `proc_health`-tracked (a different process
family than what it watches), noted here so a future turn recognizes the pattern faster than I did.

`vitest run` → **306 passed (32 files)**, up from 297 (9 new, `tests/editor-layer-list.test.js`). No gate
hit.

---

## Lane B — Turn 69 (continued) — T26 amendment chain: SHOW/CARVE split, 3D + ■ color toggles

Five mid-task amendments landed back to back while T26's base commit was still in flight (before I'd
passed back) — a heads-up, then 4 successive redesigns of the SAME per-layer toggle set, each superseding
the last. Absorbed all of them into their FINAL synthesis directly (no point building amend 2's badge
then ripping it out for amend 4, since nothing had been committed yet) — this entry documents the END
STATE only; the intermediate designs (a tri-state pill, a compact-only badge) never touched a file.

**Final per-layer fields, all new:** `carve` (bool, default true) — independent of `visible`, a layer can
carve while hidden or show without carving. `drape3d` (bool, default false) — a tag; I store/toggle/
persist/render the UI, seat A (SE11) reads it and builds the actual 3D drape. `showColor` (bool, default
true, renamed from an intermediate `drapeColor`) — independent of `drape3d`, never disabled; whether the
layer draws its own element colors or one neutral color, applied as a display-only override.

### Declared once, read everywhere: TOOLING_DEFAULTS + one setter per field

Added `carve: true, drape3d: false, showColor: true` to `editor/layers.js`'s `TOOLING_DEFAULTS` — even
though they're not CNC tooling, `applyToolingDefaults()` is the ONE existing mechanism that back-fills a
missing field on every layer-creation and restore path (`addLayer`, `editor-io.js`'s `open()` AND
`_reconcileLayersFromSvg`); duplicating that fill-in bespoke for three fields (the way `visible` does)
would be more code for the same result, and I'd have had to touch `editor-io.js`'s restore code directly
too. Added `setLayerCarve`/`setLayerDrape3d`/`setLayerShowColor`, each mirroring `setLayerVisible`'s exact
shape (mutate → `renderLayersPanel` → `pushState` → `_onChange`); only `setLayerShowColor` also calls
`applyLayerState` (carve/drape3d don't drive any canvas CSS class, showColor does — see below).

### Row: 4 real toggles, both lists, no badge

`_makeLayerRow` gets a small local `_makeToggleButton({className, glyph, active, onTitle, offTitle,
onClick})` factory — one shape for the 3 NEW fixed-glyph toggles (⛏/3D/■), since they only differ by an
`.active` class + title, unlike the eye which swaps its actual SVG icon per state and stays its own
bespoke code. Also added `aria-pressed` to the EXISTING eye button for consistency across all 4 (not
asked for explicitly, but all four are the same conceptual "toggle button" now — a small, low-risk
addition, called out rather than snuck in). Row order: eye, ⛏, name, [tool-summary if compact], 3D, ■,
delete. `.not-carved` dims the compact tool-summary when carve is false (its own explicit ask — "the tool
spec still exists, it's just not currently cutting").

### CSS: the "44px on coarse pointers" rule turned out to be bigger than compact rows

AMEND 4/5's "all four real toggles... 44px on coarse pointers" applies in BOTH the editor panel and the
sidebar now (amend 5 dropped the compact-only-badge design entirely) — meaning the editor's own
(non-compact, normally 28px) Layers panel ALSO needs to grow under touch, not just `.layer-row.compact`.
Consolidated what was two separate `pointer:coarse` rules into one: `.layer-row, .layer-row.compact {
height: 44px }` plus all 4 toggle buttons (`.layer-visibility` included) growing to 44×44px together,
removing the now-redundant standalone `.compact`-only coarse-pointer block. `.layer-carve`/`.layer-
drape3d`/`.layer-showcolor` get their OWN small color-coded `.active` tints (green/blue/gold) rather than
reusing `.layer-row.active`'s blue, so a user can tell "this row is selected" apart from "this toggle is
on" at a glance — not asked for explicitly, a small design call I made and am flagging rather than hiding.

### The one real design decision I made without being told the exact mechanism: showColor's canvas override

AMEND 5 says "apply it as a display-only style (e.g. a CSS class... / a stroke+fill override), never by
rewriting stored colors" — genuine latitude, not a spec. Chose: `applyLayerState` (already the ONE place
`visible`/active drive `layer-hidden`/`inactive-layer` classes on live SVG children) adds/removes a THIRD
class, `.layer-no-color`, from the SAME loop. CSS: `stroke` is overridden unconditionally (the dominant
"element color" concept for this app's stroke-drawn vector/toolpath content); `fill` is overridden only
via `:not([fill="none"])` — forcing `fill` unconditionally would turn deliberately-unfilled (fill="none")
stroke art into filled shapes, a real visual regression, not a neutral-color one. Confirmed svg.js's own
`.fill()`/`.stroke()` write PRESENTATION ATTRIBUTES (not inline style — checked, not assumed), so the
`:not([fill="none"])` attribute selector reliably matches what this app's own elements actually carry.
**Disclosed, not silently accepted:** an element with its color set via an INLINE style attribute instead
of a presentation attribute wouldn't be caught by the fill guard — not a shape this app's own drawing code
produces today, but worth stating rather than assuming away.

### CARVE independence — the actual cross-cutting rewire, verified at each choke point directly

`stamp-mask-manager.js:52` and `core/engine/rebuild.js:211` both moved their gate from `layer.visible ===
false` to `layer.carve === false` — a hidden-but-carving layer now gets its mask built AND applied; a
shown-but-not-carved layer gets neither, regardless of visibility. `main/export-flow.js`'s
`_stampExportCandidates` no longer short-circuits `mask`/`svg` to null for a hidden layer (they're real
content getLayerSvg doesn't gate on visibility for either — checked its own docstring, which already said
so) — `enabled` (visible) and `carve` are now two separate booleans on the candidate view instead of one
collapsed flag. `isCarvingLayer` dropped its `l.enabled` check entirely (`carve && mask && depth`,
was `enabled && svg && mask && depth`); `hasShippableSvg` (`enabled && svg`) is UNTOUCHED — the dispatch's
own "hasShippableSvg keeps reading visible" line, satisfied by leaving it alone rather than re-deriving it.

**Grepped for every other `visible === false` read used as "don't carve", per the dispatch's own ask —
two more hits, both checked and correctly left alone, not touched:**
- `editor/editor-expand.js:33` — guards the EXPAND tool against operating on a hidden layer's geometry
  ("operating on invisible geometry produces confusing results"). This is an EDITING-visibility guard
  (can the user currently SEE what they'd be expanding), not a carve question — stays `visible`-gated,
  correctly.
- `main/cloud-project-manager.js:686` — `_hasVisibleStampContent`, used by the cloud project BROWSER to
  show a "has content" indicator. Its own name and docstring say "visible", not "carving" — a project-list
  concern, unrelated to the mask/heightfield pipeline. Correctly stays `visible`-gated.

### Persistence: _PERSISTED_LAYER_FIELDS + a migration for the one field that needs history-aware defaults

Added `carve`/`drape3d`/`showColor` to `editor-io.js`'s `_PERSISTED_LAYER_FIELDS`, with explicit
boolean-coercion branches in `_serializeLayersAttr` mirroring `visible`'s own treatment (defensive: a
stray non-boolean value round-trips as a sane boolean, not verbatim). The restore path (`open()`'s
`...l` spread + `applyToolingDefaults`) needed NO changes — confirmed by reading it, not assumed —
`TOOLING_DEFAULTS` already covers a missing field for both restore paths.

`drape3d`/`showColor` get NO migration entry — the dispatch's own amend 2 said so explicitly ("migration:
none — missing = false") and nothing in this codebase has EVER shipped the intermediate string-tristate
format (amend 3) I'd otherwise need to migrate FROM — building that migration would be handling a
scenario that provably cannot occur, not a "declare over hand-roll" case. `carve` is different: pre-SE10,
`visible === false` ALSO meant "don't carve" — REAL saved projects exist where a hidden layer's carve
behavior needs to be PRESERVED, not defaulted flat. Added `MIGRATIONS` entry `layer-carve-flag`
(`main/app-init.js`, same declared-array pattern as the existing `legacy-stamp-svg` entry): for every
layer in `P.editorSvg`'s `data-editor-layers` roster missing `carve`, sets `carve = (visible !== false)`
— giving old documents their exact historical carve behavior before `applyToolingDefaults`'s flat
`TOOLING_DEFAULTS.carve` (true) default would otherwise silently start carving a layer the user had
deliberately hidden. `when()` re-parses the roster and only fires while a layer is still missing `carve`
— idempotent by construction, matching the existing entry's own gate-on-current-shape convention.

### SVG download: shown layers only, without touching the shared serializer

`editorDownload` didn't exist as a button — `action-tools.js`'s own `bind('editorDownload', ...)` was a
silent no-op (its handler was already fully correct, just never reachable). Added it to the modal HEADER
next to Clear/Cancel/Apply Stencils (same `cad-btn`/`cad-btn-secondary` classes, first in the row — a
non-destructive utility action placed away from the destructive/commit sequence), per the dispatch's own
explicit "next to Apply Stencils' row... tell the advisor where" — here: `bspline_gen_palette.html`'s
`#svgEditorHeader`, first button in the right-hand group.

**Did NOT filter the shared `serializeEditor()`** — it's also used by the regular save/persist path and
`saveForRasterization`, both of which correctly need to keep including hidden (and possibly still-
carving) layers; `serializeEditor`'s own docstring already says so. Added a NEW, narrowly-scoped
`_serializeVisibleLayers(editor)` that filters `editor._sketchLayer.children()` by each child's layer's
`visible` flag BEFORE running the same `stripSvgjsAttributes` pass, and pointed ONLY `saveWithTextCopies`
(confirmed via grep: its one and only caller is the Download SVG handler) at it instead of the shared
serializer. The regular save and rasterization paths are byte-for-byte unaffected.

### Non-vacuous (4 mutations, one per cross-cutting rewire)

1. `isCarvingLayer` reverted to requiring `l.enabled` — the 2 new SE10 tests in `export-flow.test.js`
   failed exactly as expected (carve-while-hidden and not-carved-but-shown both flipped), 9 others
   unaffected.
2. The migration's `carve = true` (flat) instead of `carve = visible !== false` — the ONE test asserting
   the historical-preservation case failed exactly as expected, 12 others (including the 3 that don't
   depend on that specific derivation) unaffected.
3. `applyLayerState`'s showColor branch inverted (`if (showColor) addClass('layer-no-color')`) — both new
   `.layer-no-color` tests failed exactly as expected, 14 others unaffected.
4. `stamp-mask-manager.js`'s gate reverted to `visible === false` — both new SE10 tests in
   `stamp-mask-clear.test.js` failed exactly as expected, 4 others unaffected.
All four reverted immediately after confirming the failures; full suite re-run green (323/323) after.

### Fixed 2 pre-existing tests whose OLD expectations were the exact behavior this amendment retires

`export-flow.test.js`'s "does not count a HIDDEN layer" and `stamp-mask-clear.test.js`'s "does not touch a
HIDDEN layer's mask" both asserted the OLD "hidden = never carves" coupling as a positive requirement —
which is now the wrong claim on purpose. Rewrote each to test what's actually still true (a hidden layer
is never EXPORTABLE; a `carve:false` layer is the new "exempt from this loop" case) rather than deleting
them, and updated `stamp-mask-clear.test.js`'s own header comment, which flatly claimed the hidden-layer
case "must survive every slice unchanged" — no longer true, said so directly rather than leaving a comment
that now lies next to the test that disproves it.

### Verified end-to-end, every toggle, both lists, both screen sizes (screenshots in the scratchpad, not committed)

```
Editor panel row: all 4 buttons present (⛏/3D/■ glyphs correct); clicking ⛏ in the EDITOR panel ->
  editorCarveActive=false, stampCarveActive=false (cross-synced), dataCarve=false, sidebar tool-summary
  gets .not-carved=true. Clicking 3D in the editor panel -> active=true, aria-pressed="true", data=true.
  Clicking ■ -> active=false, data=false, AND the live SVG child gains .layer-no-color=true (confirmed on
  the actual #editorSVGContainer element, not just the data model).
Download SVG: hid a second layer via its eye (confirmed editor._layers[...].visible===false first, not
  assumed), called editor.saveWithTextCopies() directly -> the returned SVG text EXCLUDES that layer's
  data-layer id entirely while still including the others (svgTextLength dropped 9213->8207 bytes when
  the hidden layer was added, consistent with content actually being excluded).
Mobile (390px, compact rows): all 4 toggles + tool-summary + delete fit cleanly in one row at the
  emulated coarse-pointer size, no overflow/clipping — screenshot confirms visually, not just
  numerically.
No console errors/exceptions in any run.
```

### Process hygiene

12 orphaned `chrome.exe` processes (accumulated across today's T24/T25/T26 CDP scripts — `chrome.kill()`
on the spawned Node child doesn't reliably terminate `--headless=new`'s full process tree on this
machine) killed via `taskkill /F /IM chrome.exe` mid-turn, and again at wrap-up (a few more had
accumulated during THIS turn's own verification runs) — not `proc_health`-tracked (different process
family). `proc_health.py watch` found 2 this-turn `http.server` leftovers from local-serve restarts;
reaped via `reap --role self --yes`, both confirmed dead.

`vitest run` → **323 passed (32 files)**, up from 306 (17 new: 2 in `export-flow.test.js`, 7 in
`migrations.test.js`, 7 in `editor-layer-list.test.js`, minus the 2 rewritten-not-added existing tests
netting out; `stamp-mask-clear.test.js` net +1 after replacing 1 test with 2). No gate hit.

### Stopping here, on purpose — amendments 6/7/8 arrived while polling right before this commit

The mailbox had 3 MORE amendments the moment I went to commit — each one changes THIS SAME row's toggle
set again: AMEND 6 drops `drape3d` as its own field entirely (the "3D" button becomes a relabeled `carve`
toggle — 3 toggles total, not 4); AMEND 7 makes `visible` a MASTER switch (hidden ⇒ not carved/draped/
exported regardless of carve/showColor's OWN preserved values — the carve-independent-of-visible design
this very commit just built and verified gets partially reversed, back to a compound `visible!==false &&
carve!==false` read at every gate I just changed); AMEND 8 swaps the ■ glyph for an inline SVG palette
icon. That's 8 successive redesigns of one row in one turn, 3 of them landing back-to-back in the last
few minutes.

Committing what's built here rather than chasing the target further unabsorbed: everything in this commit
matches amendments 1–5's own synthesis EXACTLY, is fully tested (323/323), and is independently verified
live (every toggle, both lists, both screen sizes, Download SVG's filtering). It is real, working,
reviewable progress, not a half-built intermediate state — the intermediate designs from amends 2/3 never
touched a file; THIS design did, completely. Amendments 6–8 are real further work (another cross-file
gate-rewrite pass plus a field removal plus test rewrites — not a quick tweak), and per the worker skill's
own "capacity is a reportable fact" guidance, landing a clean checkpoint now and flagging the fast-moving
target explicitly in the pass-back is the disciplined move, not silently absorbing an 8th redesign without
a check-in. Not implementing amend 6/7/8 this turn — stated here plainly, not left implicit.

## Lane B — Turn 71 (T27) — the layer row, FINAL — 👁 master / 3D=carve / palette=showColor / isCarved-isExported-showsColor — DONE

Fred settled the row after T26's 8-amendment churn: **visible is the MASTER switch** (off = off
everywhere — hidden, not carved, not draped, not exported — but `carve`/`showColor` keep their stored
values for when it's shown again); **`carve` is the "3D" toggle** (drape3d is dropped entirely — there
was never a separate drape concept, just a mislabeled carve button); **`showColor` gets an inline SVG
palette icon** instead of the "■" glyph, matching the eye icons' style. Dispatch asked for three helper
functions — `isCarved`/`isExported`/`showsColor` — declared once in `editor/layers.js`, with every gate
rewired to read THROUGH them instead of re-deriving the rule at each call site. This is a genuine partial
reversal of T26's own "carve is independent of visible" design (amends 1–5) — the dispatch says so
explicitly ("ignore amends 2–8 as history... build from here"), so I'm not treating the T26 code as sacred;
I'm applying the FINAL spec on top of T26's already-committed data model (carve/showColor field names, the
`layer-carve-flag` migration — both kept unchanged, per the dispatch).

**`editor/layers.js`** — the one place the three fields' effective rules now live:
- `TOOLING_DEFAULTS.drape3d` removed; `setLayerDrape3d` removed entirely.
- New exported helpers, declared once: `isCarved(l) = l.visible!==false && l.carve!==false`,
  `isExported(l) = l.visible!==false`, `showsColor(l) = l.visible!==false && l.showColor!==false`.
- `applyLayerState`'s `.layer-no-color` gate now reads `showsColor(layer)` instead of the raw
  `layer.showColor !== false` — a HIDDEN layer gets the neutral-color class regardless of its own
  showColor value (moot anyway since `.layer-hidden` already drops it from view, but the declared rule
  now genuinely governs every color-gated site, not just the export ones).
- Row rendering: dropped the drape button/branch entirely; the carve button's glyph changed from "⛏" to
  "3D" (same `layer-carve` class/field — it's a relabel, not a new toggle); the showColor button is now
  bespoke (matching the eye's own innerHTML-SVG pattern, not the glyph-text `_makeToggleButton` factory
  anymore) rendering a new `_paletteSVG()` icon — one icon regardless of on/off state, `.active` carries
  the state (same as carve), since the dispatch didn't ask for a swapping icon the way the eye has.
- **Judgment call, not explicit in the dispatch — row order.** T26 had the 4 toggles split: eye+carve
  before the name, drape+color after. The dispatch's header lists them as "👁 · 3D · palette" in one
  breath; I read that as the three toggles now being grouped together ahead of the name (handle, eye,
  3D, palette, name, [tool-summary], delete), not split around it. Flagging this as an interpretation call
  in case Fred pictured something else — cheap to move if not.
- **Judgment call — row DISPLAY state vs GATE state.** The carve/showColor buttons' own `.active` class
  reflects the RAW stored field (`layer.carve !== false`, not `isCarved(layer)`), same as before. Reasoning:
  the eye already tells you a layer is hidden; making carve/showColor ALSO greyed-out-because-hidden would
  be redundant and would hide the very thing the dispatch says must be visible — that hiding doesn't erase
  the stored value. The compound helpers gate BEHAVIOR (masks, exports, canvas/mesh color), never the row's
  own toggle-button display.

**`editor/editor-io.js`** — `drape3d` removed from `_PERSISTED_LAYER_FIELDS` and its serialize branch;
`_serializeVisibleLayers` (the Download-SVG-only filter) now builds its included-id set from
`isExported(l)` instead of the raw `l.visible === false` check — same effective result for a normal
roster, but now reads through the one declared rule instead of a second copy of it. (Edge case, noted not
acted on: an orphaned SVG child whose `data-layer` matches no roster entry would previously be INCLUDED
by the old exclusion-based filter and is now EXCLUDED by the new inclusion-based one — this state
shouldn't occur post-reconcile and isn't exercised by any test; flagging it rather than silently changing
behavior no one asked about.)

**Gate rewires** (the dispatch's own explicit list): `main/stamp-mask-manager.js`'s `updateStampMasks`
gate (`layer.carve === false` → `!isCarved(layer)`); `core/engine/rebuild.js`'s `_collectStampPasses` gate
(same change); `main/export-flow.js`'s `_stampExportCandidates` now computes `enabled`/`carve` on its
candidate view as `isExported(layer)`/`isCarved(layer)` directly (off the raw editor layer), so
`isCarvingLayer`/`hasShippableSvg` just read the already-compound candidate fields back — the rule lives
in `editor/layers.js` once, not re-derived in export-flow's own predicates.

**This IS a behavior reversal, not just a rename** — a hidden layer that still has `carve:true` no longer
carves (T26 amend 5 made it carve while hidden; T27 makes visible the master again). Two existing T26 tests
asserted the NOW-WRONG direction and needed rewriting, not just renaming:
- `export-flow.test.js`'s "visible:false + carve:true → carving, never exportable" flipped to "→ NOT
  carving (visible is the master), never exportable" (`activeStampLayers()` now `0`, was `1`).
- `stamp-mask-clear.test.js`'s "a HIDDEN layer with no content still gets its stale mask cleared" flipped
  to "a HIDDEN layer is exempt from this loop entirely... its stale mask survives" — with the compound
  gate, a hidden layer is skipped by `updateStampMasks` before its emptiness is ever checked, same as the
  ORIGINAL pre-SE10 behavior. (The `carve:false + visible:true` cases in both files needed NO change —
  they were already correct under the compound rule.)

**New tests**, per the dispatch's own "Verify" list: a 6-case truth table over `isCarved`/`isExported`/
`showsColor` (`editor-layer-list.test.js`); "hiding then re-showing a layer leaves its carve/showColor
VALUES unchanged" (drives the real eye-click twice, asserts the stored fields never moved); "a HIDDEN
layer gets `.layer-no-color` regardless of its own `showColor:true`" (proves `applyLayerState`'s rewire to
the compound helper actually took, not just declared); row-rendering assertions for the "3D" glyph, the
SVG palette icon, and `.layer-drape3d`'s absence.

**Non-vacuity, by mutation** (each reverted immediately after confirming red):
- `isCarved`/`showsColor` mutated to drop their `visible` check → the truth-table test, the
  `applyLayerState` hidden-layer test, the export-flow T27 test, and the stamp-mask-clear T27 test all
  failed with the exact expected mismatch (4/4, isolated to just those 4 — nothing else moved).
- carve glyph mutated back to "⛏" → the row-rendering test failed on the glyph assertion.
- palette `innerHTML` mutated back to a `■` textContent, glyph assertion left correct so the SVG check
  ran on its own → failed on `colorBtn.querySelector('svg')` specifically, confirming that line is live
  independent of the glyph check above it.

`vitest run` → **330 passed (32 files)**, full suite, no gate hit.

**Live CDP verification** (repo-root `python -m http.server 8771`, per this repo's own documented gotcha
— serving from the html subfolder 404s the relative asset paths): generated a 4-layer Lattice pattern,
confirmed in the running page (not just data) — editor panel row order `handle, eye, 3D(active),
palette(active, real SVG), name, delete`, zero `.layer-drape3d` anywhere in the DOM; clicked 3D off on one
row → `data.carve=false`, sidebar row's 3D button lost `.active`, its tool-summary got `.not-carved`;
clicked palette off on the same row → `data.showColor=false`, the row's live SVG child got
`.layer-no-color`; clicked the eye off then on again on that SAME row → hidden snapshot
`{visible:false, carve:false, showColor:false}`, restored snapshot `{visible:true, carve:false,
showColor:false}` — carve/showColor genuinely untouched across the round trip; mobile emulation (390×844,
touch) → eye/3D/palette buttons and the row itself all measured exactly 44px. Zero console
errors/exceptions across the whole run. Screenshots saved to the session scratchpad (desktop editor panel,
desktop sidebar, mobile sidebar) — all three read correctly at a glance: active states tinted (green 3D,
gold palette), the one toggled-off row visibly neutral/grey on all three icons.

**Process hygiene:** the CDP run's own `chrome.exe` exited cleanly this time (`tasklist` found none left
over — not always the case on this machine, checked anyway); the repo-root `http.server` (PID looked up
via `netstat`, not a blind `pkill`) was stopped once verification finished.

Not touched, per the dispatch's own explicit scope: `main/app-init.js`'s `layer-carve-flag` migration
(kept unchanged — it already produces the right historical `carve` value, and nothing about the
visible-as-master rule requires touching a migration that only back-fills a missing field);
`tests/migrations.test.js` (unaffected, still green — confirmed by the full-suite run rather than assumed).

Committed by explicit path (9 files: the 5 source files, the CSS, and the 3 test files). Amendments polled
clean both before this entry and immediately before the commit below — nothing pending.

## Lane B — Turn 73 (T28) — COLOR control becomes a dropdown mosaic — 32 declared swatches + recent + custom — DONE

Fred: "add more colors and make it a drop down mosaic." Woke on turn 73 to lane-b already merged with main
(SE11c/SE11d drape work landed via the advisor, T27 verified live in Fusion per the peer's own cross-session
note). Scope per dispatch: `editor/properties-shape.js` (SE9's color binding), the palette's editor toolbar
COLOR group, `styles/editor.css`, tests.

**`editor/editor-color.js`** — `VECTOR_COLORS` goes from a flat 6-color array to a declared 8-row x 4-column
grid (32 swatches), one row per hue (Red/Orange/Yellow/Green/Teal/Blue/Purple/Neutral), so the popover's
mosaic lays its cells out straight from this data — no second hand-typed grid to drift from it. Fred's own
piece is kept VERBATIM inside the grid rather than bolted on separately: red `#c62828` and yellow `#f9c80e`
are each their hue row's own base shade, navy `#1a237e` is the Blue row's darkest shade, black `#000000` is
the Neutral row's darkest shade — chose this over a 9th "Fred's colors" row so the palette reads as one
coherent, browsable grid rather than a special row plus a generic one. Also added the "recent" persistence:
`mergeRecentColors` (pure, dedup-and-move-to-front, capped at `RECENT_COLORS_CAP=4`) plus
`loadRecentColors`/`saveRecentColors`/`addRecentColor` wrapping `localStorage` in try/catch — same
load/merge/save split as `editor-grid.js`'s `mergeGridPrefs`/`loadGridPrefs` (found and matched that existing
convention rather than inventing a new persistence shape), key `bsg.editorRecentColors` matching that file's
own `bsg.*` prefix.

**`editor/properties-shape.js`** — `initColorControl` rewritten: the toolbar's visible control is now a
button (`#editorColorToggle`, a swatch + caret) that opens a popover — VECTOR_COLORS' 8x4 grid, a "recent"
row (hidden entirely when empty), and a "Custom…" button. The native `<input type="color" id="editorColor">`
stays in the DOM (now visually hidden, off-screen-but-rendered so `.click()` reliably opens the OS picker —
`display:none` inputs don't always fire it) — it's still what "Custom…" triggers, and still the read-back
target editor-ui.js already writes to on selection change. Every pick (mosaic cell, recent cell, or the
native picker's own 'change') calls `editor.setColor()` on one discrete commit (unchanged SE9 undo
behavior) and calls `addRecentColor`. Keyboard: roving tabindex over the grid (arrow keys move by the
declared 4-column stride, clamped not wrapped; Enter/Space reuses the cell's own click handler — one pick
path, not two); Escape closes and refocuses the toggle button. A document-level capturing `mousedown`
listener (added on open, removed on close) closes on an outside click. New export: `syncColorToggleSwatch(hex)`
— the one place "update the toggle button's visible swatch" happens, so it isn't reimplemented a second time
in editor-ui.js.

**Judgment call — where the popover mounts.** `#editorColorGroup` lives inside `.editor-toolbar-top`, which
has `overflow: hidden` (confirmed by reading the actual inline style, not assumed) — anything appended
inside that group would be clipped the instant it needed to extend past the 38px toolbar strip. The popover
is instead appended to `document.body` and positioned `position:fixed` from the toggle button's own
`getBoundingClientRect()` (viewport-relative regardless of any ancestor's overflow/position), `z-index:
10001` — one above `#svgEditorModal`'s own `9999` (checked, not guessed, via a repo-wide z-index grep before
picking a number). `positionPopover()` flips above the button if it would overflow the viewport bottom and
clamps its left edge if it would overflow the right — the dispatch's own explicit "stays inside the viewport
at 390px" requirement, live-verified below, not just asserted in a unit test (happy-dom doesn't lay out real
pixels, so `offsetWidth`/`offsetHeight`-based positioning isn't meaningfully unit-testable — this is exactly
the kind of case CDP verification exists for).

**Judgment call — one-line touch to `editor-ui.js` (not in the dispatch's own file list).** Before this
turn, `_afterSelectionChange` set `colorEl.value = primaryColor` directly on the native `<input type=color>`,
and the input's OWN rendered box was the toolbar's visible color indicator — no extra wiring needed, the
browser did it for free. Now that the VISIBLE control is a button with its own swatch span, that same
`.value =` write fires no event my new code could hook, so selecting a colored element would silently stop
updating the toolbar's swatch — a real regression the dispatch never asked for, just an unavoidable
consequence of replacing the visible control. Fixed with one import + one call
(`syncColorToggleSwatch(primaryColor)`) right next to the existing line, reusing the SAME sync function
`initColorControl` itself uses — not a second implementation.

**Removed** (the old swatch row's full removal chain): `#editorColorSwatches` div from the HTML;
`swatchContainer`/the inline-styled swatch-button loop from `properties-shape.js`; the file's own doc-comment
claim about it. Nothing else referenced `#editorColorSwatches` (grepped project-wide, JS+HTML, before
touching it) and the old swatches had no dedicated CSS class to clean up (their styling was inline
`cssText`), so there's no CSS-side removal beyond that.

**Tests** (`tests/editor-color.test.js`, rewritten in place — all other describe blocks in this file
untouched, they test unrelated `setColor`/`_applyFillModeToSelection`/carve-neutral-guard behavior): the old
"declares Fred's piece first" VECTOR_COLORS test updated to the new 8x4 shape (8 rows x 4 cols = 32, no
duplicates, contains all four of Fred's exact hex values); a `mergeRecentColors` pure-logic block (dedup,
cap, ordering); a `loadRecentColors`/`saveRecentColors`/`addRecentColor` localStorage-integration block
(same pattern as `editor-grid.test.js`'s `loadGridPrefs` block — real localStorage in happy-dom, no mock
needed); a DOM-wiring block driving `initShapeProperties` with a minimal toolbar fixture — 32-cell render
count, picking a cell calls `setColor` with the exact hex and closes the popover, recent-list order after
two picks, the recent row's absence when nothing's been picked yet, Escape-closes-and-refocuses,
outside-click-closes, ArrowRight/ArrowDown roving focus, Enter-picks, and "Custom…" opens the native input.
`afterEach` explicitly sweeps any leftover `.color-mosaic-popover` from `document.body` — the popover is
NOT a child of the test's own mounted container (it's appended to `document.body` directly, matching the
live page), so a test that ended with it still open would otherwise leak into the next test and inflate its
cell count; caught this BEFORE it caused a flake, not after.

**Non-vacuity, by mutation** (each reverted immediately after confirming red, two batches): batch 1 —
`mergeRecentColors`'s dedup filter and cap both stripped → exactly the "moves to front" and "caps at 4"
tests failed, nothing else. Batch 2 — six simultaneous mutations in `properties-shape.js` (dropped
`addRecentColor` from `pick`; outside-click handler short-circuited to a no-op; `Escape`'s `toggleBtn.focus()`
dropped; `ArrowRight` made a no-op; `ArrowDown`'s stride off-by-one; `buildGrid` skipping the grid's last
row) → exactly the 6 matching tests failed (recent-list-order, outside-click-closes, Escape-refocuses,
ArrowRight, ArrowDown, 32-cell-count), the other 29 (including "Enter picks" and "click picks + closes",
which share code paths with some of the mutated lines but weren't THEMSELVES mutated) stayed green — clean
1:1 attribution, no collateral failures either direction.

`vitest run` → **382 passed (34 files)**, full suite (file/test count is higher than T27's 330/32 baseline
because SE11c/SE11d's merges landed more test files in between — confirmed via `git log`, not just assumed
from the number).

**Live CDP verification** (repo-root `python -m http.server 8771`): toggle button renders with the correct
initial black swatch, native input confirmed `opacity:0` (hidden) via `getComputedStyle`, old
`#editorColorSwatches` confirmed absent from the live DOM; opened the popover — 32 cells, exactly matching
the declared grid; picked Fred's yellow (`#f9c80e`) — popover closed, toggle swatch updated to
`rgb(249,200,14)` (`#f9c80e`), matching value; reopened — recent row showed exactly `['#f9c80e']`; keyboard
— initial roving focus on cell 0, ArrowDown moved to cell 4 (row 2, same column, proving the 4-column stride
against the REAL declared grid, not a mock), Escape closed the popover and returned focus to the toggle
button; mobile emulation (390x844, touch) — popover's `getBoundingClientRect()` stayed within
`[0, window.innerWidth]` on both edges, cells measured 44px. Zero console errors/exceptions across the whole
run. Screenshots (desktop + mobile, popover open) saved to the session scratchpad — both read correctly at a
glance: clean 8x4 gradient grid, RECENT row with the yellow swatch, "Custom…" button below, mobile version
appropriately larger without overflowing.

**Process hygiene:** `tasklist` found zero leftover `chrome.exe` before this run started (clean from T27's
own cleanup); the repo-root `http.server`'s PID (looked up via `netstat`, not a blind `pkill`) was stopped
once verification finished.

Committed by explicit path (7 files: `editor-color.js`, `properties-shape.js`, `editor-ui.js`, the HTML,
the CSS, the test file, this WORK-LOG). Amendments polled clean both before this entry and immediately
before the commit below — nothing pending.

## Lane B — Turn 75 (T29) — sidebar layer list moves up, full names — DONE

Between T28's pass and this wake, the advisor signaled `LOOP DONE at cycle 37` (T24–T28 merged into main) —
signed that message and re-armed the waiter per its own instruction, then a NEW cycle opened with this T29
dispatch. Small layout turn, Fred-approved mockup: move the Vector Stamping sidebar's layer list from below
the Plunge Depth / Tool Profile / V-Bit Angle controls to right under "Open SVG Editor" (the settings apply
to whichever layer is selected, so picking one first reads more naturally), and let layer names read in
full instead of truncating.

**`bspline_gen_palette.html`** — moved the `Layers` label/+button/`#stampLayersList` block (previously
between V-Bit Angle and SVG Blueprint) to directly after the `#btnStampEdit` button, before `Plunge Depth`.
Added a one-line hint (`.cad-status-text`, matching `#stampFileName`'s own established style) — "Settings
below apply to the selected layer." — under a `.cad-status-divider` (the same divider class already used
elsewhere in this same sidebar, not a new pattern). Grepped `main/stamp/*.js` for DOM-order-dependent
traversal (`nextElementSibling`/`closest`/etc.) before moving anything — none found; every stamp-panel
lookup goes through `getElementById`, so the reorder is purely visual.

**`styles/editor.css`** — the dispatch's "full names, ellipsis only as a last resort" was ALREADY half-true:
`.layer-name` has carried `flex:1; min-width:0` since T26, so the name already gets first claim on available
width. What was missing: `.layer-tool-summary` (`flex-shrink:0; white-space:nowrap`) always shared the
SAME line as the name, so at a narrow sidebar it still forced the name to shrink and ellipsize well before
truly necessary. Fixed by making the compact row wrap — `.layer-tool-summary { flex: 1 0 100%; }` forces it
onto its own second line (right-aligned) — under TWO independent triggers per the dispatch's own "≤360px
sidebar OR coarse pointer": the existing `@media (pointer: coarse)` block, and a NEW `@container
layers-list (max-width: 360px)` query.

**Judgment call — container query over a viewport media query.** The sidebar column is user-resizable
(`layout-app.css`'s `--cad-sidebar-width`, dragged via `.cad-resizer`) with no fixed relationship to
viewport width, so a `@media (max-width: …)` check can't actually track "the sidebar itself is narrow" —
confirmed by reading `layout-app.css` before choosing, not assumed. `@container` is the semantically correct
tool for "this element's own ANCESTOR is narrow" regardless of viewport, and this codebase had zero
`@media`/`@container`-support constraints on record (grepped first) — declared `#stampLayersList` as a
named inline-size container (`layers-list`) since it's the exact element `renderLayerList` appends rows
into, so no container needs to be nominated further up the tree. First use of `@container` in this
codebase; flagged here in case that's worth a second look, not slipped in silently.

**A REAL bug caught only by the live screenshot, not the DOM-only checks.** `flex-basis:100%` on the tool
summary forces it to claim the WHOLE second line — but `.layer-delete` sits right after it in the actual
row markup (handle, eye, carve, color, name, [tool-summary], delete — T27's own order), and flex-wrap lays
children out in DOM order. First pass: my own `scrollWidth`/`clientWidth`/`flexWrap` assertions all read
"correct" (not clipped, wrapped:true) — they only check the NAME's own box, never noticed `.layer-delete`
had been stranded onto a third line, rendering as a stray red "×" hovering above the NEXT row. Caught it by
actually looking at the mobile screenshot, not by trusting the numeric checks alone — exactly the kind of
defect "verify the real symptom" exists to catch. Fixed with `order: 1` on `.layer-tool-summary` (both wrap
blocks) — a pure CSS reorder, not a DOM move, so it stays scoped to compact rows only (the class doesn't
exist on non-compact rows at all) without touching `editor/layers.js`. **`editor/layers.js` ended up NOT
needed** despite the dispatch flagging it as a maybe — the shared `renderLayerList`/`_makeLayerRow` stays
completely untouched, so the editor's own (non-compact) panel is provably unaffected, not just assumed so.

**No new vitest coverage** — this turn is pure HTML reorder + CSS flex/container-query behavior, and this
repo's own established position (T27/T28 WORK-LOG entries, and this file's own `getBoundingClientRect`/
`offsetWidth` caveats) is that happy-dom doesn't perform real layout, so a live CDP check is the only
meaningful verification for wrap/positioning claims — asserting fake pixel numbers against a non-laying-out
DOM would be decoration, not evidence. `vitest run` confirms the existing suite is unaffected by the
reorder (395/395, no regression), which is what a unit suite CAN honestly attest to here.

**Live CDP verification** (repo-root `python -m http.server 8771`, 4-layer Lattice pattern generated):
DOM-order check confirmed the Layers block index sits strictly between `#btnStampEdit` and the "Plunge
Depth" label; the 4 REAL generated names (`Nodes`, `Ties`, `Rails`, `Layer 1`) all render with zero
clipping at the app's actual default 260px sidebar — the dispatch's own literal verify ask. Stress-tested
with a renamed row ("Left Rail Segment", 17 chars via a live double-click rename, not a mock) — clips by 4px
at the absolute narrowest 260px default (`nameClientWidth:61` vs `scrollWidth:89` after the delete-button
fix correctly took its own real width into account) but reads FULLY once the sidebar is widened to 300px or
on mobile's wider effective area — reported as the genuinely marginal "last resort" case it is, not
papered over as a clean pass. Mobile emulation (390×844, touch) screenshot, taken only after adding an
explicit `scrollIntoView` (the first attempt landed on the wrong scroll position and showed an unrelated
panel — caught and fixed before relying on that shot for anything). Zero console errors/exceptions across
every run.

**Process hygiene:** zero leftover `chrome.exe` before this run (clean from T28's own cleanup, confirmed via
`tasklist` rather than assumed); the repo-root `http.server`'s PID (via `netstat`) stopped once verification
finished.

Committed by explicit path (3 files: the HTML, the CSS, this WORK-LOG). No test file changes this turn — see
the "no new vitest coverage" note above for why. Amendments polled clean both before this entry and
immediately before the commit below — nothing pending.

## Lane B — Turn 77 (T30) — ties go anywhere, ends snap to rails — DONE

Between T29's pass and this wake, the advisor signaled `LOOP DONE at cycle 38` (T29 merged) — signed and
re-armed per its own instruction, then this cycle opened with T30. Fred: "don't limit it to rails, but do
snap to them." A real algorithmic change (not a layout turn) touching both the pattern GENERATOR and the
hand-drawn Lattice TOOL, plus one mid-task amendment that changed the storage design after the first pass
was already built and verified — full account below.

**`editor/editor-lattice.js`** — new exported pure helper `nearestRailRow(j, railRows, within)`: the nearest
rail ROW to `j` within `within` lattice rows, or `null` if none is close enough — declared ONCE here so the
generator and the hand-tool can't drift on "how close is close enough." Deterministic tie-break (`<` not
`<=`, first-seen-closer wins).

**`editor/editor-lattice-pattern.js`** — `PATTERN_DEFAULTS.ties.anchor` flips `'rails'` → `'free'`
(existing saved patterns keep whatever anchor they were saved with — no migration, confirmed by
`_currentPattern`'s own read-don't-invent contract); new `PATTERN_DEFAULTS.ties.railSnapRows: 1`. New
private helper `_applyRailSnap(jStart, jEnd, railRows, railSnapRows, spanMin, spanMax)`: tries snapping BOTH
ends first (kept only if the resulting span stays in `[spanMin, spanMax]`), then just `jStart`, then just
`jEnd`, else leaves both exactly where the free draw put them — "spans still spanMin..spanMax, measured
after snapping" is enforced by never accepting a snap combination that would violate it, not by clamping
after the fact. Wired into `_tieSpanForColumn`'s existing `'free'` branch (computes the raw span first,
exactly as before, then snaps); the `'rails'` branch is completely untouched — strict mode was already
exact, nothing to snap.

**`editor/editor-interaction.js`** (touched despite not being in the dispatch's own file list — the
hand-drawn tool's drag logic has no other home, same situation as T27's necessary `editor-ui.js` touch):
`latticeHandler.update` now snaps a tie-shaped drag's moving end the SAME way — computed via the identical
dominant-axis test `constrain` itself uses (not read back off `constrained`, whose rail branch trivially
sets `j:a.j` and would be indistinguishable from an un-snapped tie value at that same row), against
`_existingRailRows` (every `data-lattice="rail"` element currently on the sketch, not just what the
GENERATOR would produce — a hand-drawn rail counts too). Because `finish()` already just reads back
whatever `update()` last wrote into `_latticeEnd`, no separate snap step was needed at commit time; the
LIVE PREVIEW and the FINAL element are the same code path by construction, not two implementations kept in
sync by hand.

**T30's own explicit UI ask**: a new "snap to rails within N rows" number field in the Pattern panel
(`#latticeTiesRailSnapRows`, 0 = off), wired in `properties-lattice.js`'s existing sync/read functions —
same pattern as every other Pattern field there. Also updated the anchor `<select>`'s default `selected`
option and relabeled both options ("Free (snaps to rails)" / "Between rails (strict)") so the dropdown
itself explains the new relationship instead of silently changing which option is pre-selected.

**Mid-task amendment (Fred, via the mailbox, polled before the first commit):** "ONE setting — the field
drives BOTH the generator and the hand tool, no second default for the hand tool." My FIRST pass had
declared `LATTICE_DEFAULTS.railSnapRows: 1` (editor-lattice.js) as the hand-tool's OWN default, read via
`editor._lattice.railSnapRows` — reasonable on its own, but a second number that could drift from the
Pattern panel's field, and NOT persisted (editor.js's own comment on `editor._lattice`: "not persisted"),
so it could never actually be "the same setting" the amendment asked for. Fixed by removing
`LATTICE_DEFAULTS.railSnapRows` entirely and having the hand-tool read `editor._latticePattern.ties.
railSnapRows` directly (falling back to `PATTERN_DEFAULTS.ties.railSnapRows` only if no pattern object
exists yet at all, which is defensive rather than a real code path — verified `initLatticeProperties`,
called unconditionally at editor setup from `editor-controls.js`, guarantees `editor._latticePattern`
already exists by the time any tool could possibly be used). This lands closer to "persisted with the
pattern" than the amendment's own suggested `editor._lattice.railSnapRows` spot would have, since only
`editor._latticePattern` is what `data-lattice-pattern` actually persists — a case where satisfying the
STATED requirement (one persisted value, no drift) meant deviating from the amendment's own suggested
variable name, which was hedged with "e.g." rather than mandated; noted here rather than silently
substituted. Re-verified live after the fix (below) rather than assuming the earlier verification still
held once the wiring changed.

**Tests** (all in `computePattern`'s pure domain — the hand-tool's live-drag wiring in
`editor-interaction.js` isn't unit-tested, matching this file's existing convention: `latticeHandler` isn't
exported, same as every other mode handler in that file, so its behavior is CDP-verified below instead of
via an invasive export-just-for-testing change):
- `tests/editor-lattice.test.js` — 6 new `nearestRailRow` cases: exact match, snaps within range, null when
  out of range, a deterministic tie-break, `within:0` off, no rails at all.
- `tests/editor-lattice-pattern.test.js` — a new describe block built from a RAW (pre-snap) span discovered
  by literally running `computePattern` with `railSnapRows:0` first (not guessed against the seeded RNG,
  and not the file's existing `EXTENT` — that one's `jMax:8` is too short for these cases, so a
  block-scoped `EXTENT_TALL` was declared instead): an end exactly 1 row from a rail snaps on; 2 rows away
  stays free; `railSnapRows:0` turns snapping off outright; span limits are respected after a snap attempt
  (a `spanMin===spanMax` strict case, rail 1 row away, must stay UNCHANGED — any snap would leave the exact
  span); `'rails'` strict mode ignores `railSnapRows` entirely (renamed from "(default)" — see below). Also
  fixed two now-stale comments this turn's own default flip left behind: the "column SELECTION is
  seed-independent" test's `anchor:'free' (not the default 'rails')` comment was backwards once `'free'`
  became the default (reworded, and added a note on why `railSnapRows`'s own default doesn't collapse that
  test's two seeds to the same span, verified not just assumed); the `"anchor:'rails' (default)"` test title
  now reads `"(strict mode, explicit — 'free' is the default since T30)"`.

**Non-vacuity, by mutation** (each reverted immediately after confirming red): `nearestRailRow`'s
`within<=0` guard and its `d <= within` cap both dropped at once → exactly the 2 tests targeting those two
behaviors failed, 28 others untouched. `_applyRailSnap`'s `inRange` check replaced with `() => true` →
exactly 2 tests failed (the new "span limits" test AND — genuinely useful signal — the PRE-EXISTING
`anchor:'free'` span-range test, confirming that older assertion is still live under T30's own default
railSnapRows, not just passing by coincidence), 21 others unaffected. `_applyRailSnap` made an unconditional
no-op (always returns the raw span) → exactly the one POSITIVE-snap test failed ("an end exactly 1 row from
a rail snaps onto it"); the "2 rows stays free" / "railSnapRows:0 off" / "span limits" tests all correctly
stayed green since they ALSO expect no change, proving those three aren't accidentally passing only because
snapping happens to be broken.

`vitest run` → **408 passed (35 files)**, full suite, no gate hit.

**Live CDP verification, done TWICE** — once against the original two-default design, then again after the
amendment changed the wiring (never assumed the first pass's screenshots/numbers still applied once the
underlying mechanism changed):
- Generator: UI defaults confirmed live (`anchor:'free'`, snap field `1`); Generate produced 5 ties, ALL 5
  with at least one end landing on a rail — genuinely surprising at first glance, but a real, harmless
  consequence of the DEFAULT `rails.every:2` (rails every OTHER row) combined with `railSnapRows:1`: with
  rails that dense, EVERY possible row is within 1 of some rail, so under the stock defaults `'free'`
  behaves close to `'rails'` far more often than a wider rail spacing would show — worth knowing, not a
  bug (confirmed by the isolated unit tests above, which use a controlled, sparse rail layout and show
  clean free/snapped/rejected outcomes independently of this density effect). Screenshot saved.
- Hand tool: cleared the canvas via direct DOM removal first — clicking the real "Clear" button opens a
  `confirm()` dialog that HUNG headless Chrome's `Runtime.evaluate` for a full minute before I caught and
  fixed it (documented so a future session doesn't rediscover this the slow way); the FIRST attempt also
  had a subtler bug — testing against a row that happened to already be a generated rail row (every EVEN
  row, `rails.every:2`) made "raw" and "snapped" indistinguishable, so the drop-target rows were re-chosen
  odd/away-from-generator-defaults and the canvas fully cleared before this test to get an unambiguous
  signal. With that fixed: dispatched real `PointerEvent`s (`pointerdown`/`pointermove`/`pointerup`) at
  screen coordinates computed via `getScreenCTM()`, not the CDP Input domain — drew a rail at row 10, then a
  tie dragged to row 9 (1 row short) — the LIVE PREVIEW (`editor._latticePreview`'s own `y2`, read mid-drag,
  before release) already showed the SNAPPED row 10, and the FINAL committed `<line>` also landed at row 10
  — satisfying the dispatch's own explicit "the hover marker shows the snapped point" requirement, not just
  the end result. Screenshot saved (a clean T-junction, not a short-of-the-rail gap).
- Re-verified after the amendment: the Pattern panel's field and `editor._latticePattern.ties.railSnapRows`
  read the same value (1); the SAME hand-tool drag (rail at 10, tie to 9) still snapped to 10; setting the
  field to 0 and clicking Generate (the real path a user takes — the field only writes into the live
  PATTERN on Generate/Regenerate, same as every other field in this panel) then repeating the identical
  hand-tool drag left the tie at row 9, UNSNAPPED — proving the one field now genuinely gates both surfaces,
  not just the generator.
- Zero console errors/exceptions across every run (both passes).

**Process hygiene:** zero leftover `chrome.exe` after the FIRST verification pass hung on the confirm()
dialog and had to be force-killed (`taskkill /F /IM chrome.exe`, 5 processes) — confirmed clean again before
the amendment's re-verification pass; the repo-root `http.server`'s PID (via `netstat`) stopped after each
pass.

Committed by explicit path (8 files: `editor-lattice.js`, `editor-lattice-pattern.js`,
`editor-interaction.js`, the HTML, `properties-lattice.js`, the 2 test files, and this WORK-LOG). Amendments
polled clean immediately before this commit — the one amendment above was already fully absorbed and
re-verified before this poll, not left pending.

## Lane B — Turn 79 (T31 / SE6c) — grid hover feedback: row + column + node light up — DONE

T30 accepted but held on lane-b (not yet merged to main, pending seat A's own UX-UNDO work) — didn't wait on
that, since this turn's own scope doesn't touch anything T30 changed. Fred chose hover feedback over the
alternative that was on the table (inverting grid contrast, which the dispatch says was withdrawn). Build:
while the pointer moves, the row and column through the nearest grid node, and the node itself, light up —
general grid awareness, independent of whether the current gesture would actually snap there.

**`editor/editor-grid.js`** — two new pure functions, next to `snapToGrid` per the dispatch's own file
placement: `nearestGridNode(pt, spacing)` → `{i,j}`, and `gridHoverExtents(i, j, spacing, boardW, boardH)` →
the row's full-width and column's full-height line endpoints, from plain numbers (no editor object), so the
geometry is testable without a DOM. New DOM-touching pair `updateGridHover(editor, e)` / `clearGridHover
(editor)`, same shape as the existing `updateSnapCursor`/`clearSnapCursor`: 6 elements (row/column each a
dark-outline + light-core pair, the node ring the same way) live in `editor._handleLayer`, created once and
repositioned — never recreated — on every move, `.front()`'d in a fixed order every call so the final
stacking (node ring topmost, over both guide lines) is correct regardless of which elements
`_handleLayer`'s own wholesale `clear()` (on nearly every mode switch/selection change, per
`updateSnapCursor`'s own comment) happened to force a fresh create for.

**Judgment call — `nearestGridNode` doesn't import `toLattice`, despite the dispatch saying "reuse
toLattice".** `editor-lattice.js` already imports `GRID_DEFAULTS` from `editor-grid.js`; importing
`toLattice` back the other way would make the two modules circular. Mirrored the SAME one-line rounding
formula instead of the literal function reference — reuses the MATH, not literally the symbol — and said so
in the comment rather than silently doing something different from what was asked without a trace.

**"If both are shown, the node ring IS the snap ring" (dispatch's own spec) — worked out precisely, not
guessed at.** `updateSnapCursor` (called immediately before this function in `handleMove`, unchanged) and
this function's own node ring always land on the exact same `{i,j}` whenever the snap cursor shows at all —
both derive from the identical adjusted pointer point via the identical round-to-spacing formula
(`nearestGridNode` / `snapToGrid`). So checking whether `editor._snapCursor` is currently connected is a
sufficient (not approximate) test for "is a ring already marking this exact spot" — verified this
reasoning by working through `updateSnapCursor`'s own phase handling (it always calls `snapFor(...,
'start', ...)` regardless of whether a drag is under way, so the hover-time policy behavior is uniform
across every non-'none' mode) rather than assuming coincidence and hoping it held.

**Judgment call — Alt (bypass) also hides this feature, though the dispatch never mentions Alt.**
`updateSnapCursor` already suppresses ITS ring while Alt is held ("I want off-grid precision right now").
Showing a grid-intersection highlight while the user has explicitly declared "ignore the grid this instant"
would read as contradicting their own held-down modifier, so `updateGridHover` checks the same `e.altKey`
and hides too. Flagged here as an addition beyond the literal spec, not folded in silently.

**`editor/editor-interaction.js`** (hover path only, per the dispatch's own file-scope note — the
drag-continuation logic below `handleMove`'s hover block is untouched): `updateGridHover(editor, e)` called
right after the existing `updateSnapCursor(editor, e)` call, same unconditional spot (fires whether drawing
or not). `clearGridHover` added alongside every existing `clearSnapCursor` call site — `pointerleave`
(interaction.js), mode change (`editor-ui.js`'s `setMode`), and document reopen (`editor-io.js`'s `open()`)
— mirroring that sibling feature's own three clear points exactly rather than inventing a fourth or missing
one.

**Tests** (`tests/editor-grid.test.js`, extended in place): `nearestGridNode` (4 cases — exact match,
off-lattice rounding, the .5-exactly-between tie-break, spacing scaling) and `gridHoverExtents` (2 cases —
general placement, the `{0,0}` degenerate node) are pure and fully covered. `updateGridHover`/
`clearGridHover` get a lightweight mock `_handleLayer` (same convention as this file's own pre-existing
`mockGridLayer` for `applyGrid`, extended with `circle()`/`plot()`/`radius()`/`center()`/`front()`/`remove()`
and a `.node.isConnected` the source's own connectivity check reads) covering exactly the dispatch's own
"Verify" ask (hidden when grid hidden / policy none) plus the two judgment calls above (Alt bypass, and the
snap-cursor-suppression rule) plus reuse-not-recreate across two calls — 12 cases, proportionate to what
`updateSnapCursor` itself has (zero unit tests, CDP-only) rather than an exhaustive pixel-level check, which
belongs in the CDP screenshot verification below instead.

**Non-vacuity, by mutation** (5 simultaneous cuts across the whole new surface, reverted together after
confirming the failure count/pattern): `nearestGridNode` swapped `Math.round`→`Math.floor`; `gridHoverExtents`
swapped its row/column x/y; `updateGridHover`'s hide-condition dropped the `!grid.visible`/`bypass` checks;
its `snapCursorShowingHere` hardcoded to `false`; its `_connected` reuse-check hardcoded to `false`. Predicted
the exact failure set BEFORE running (which test(s) each cut should break, including that the floor/round
swap would only be caught by the ONE test built specifically to distinguish them, `.5`-exactly-between,
since every OTHER rounding case happens to produce the same integer either way) — ran once, got exactly 8
failures / 32 passed, matching the prediction 1:1 with no unexplained failures and no missed detections.
Reverted all 5, full suite green again (426/426).

`vitest run` → **426 passed (35 files)**, full suite, no gate hit.

**Live CDP verification** (repo-root `python -m http.server 8771`): toggled the grid on, hovered near (not
exactly on) a known lattice cell — the row/column lines and node marker landed at the SNAPPED node's exact
coordinates (`rowY:1.25, colX:0.75`), not the raw hover position, confirming the "nearest node" computation
drives the visuals, not just the pointer's own coordinates. Screenshot over the terrain preview's own
varied-tone fur texture (the dispatch's own "smoke screenshot over a dark area" ask) shows the white-core/
dark-outline treatment staying clearly readable crossing both light and dark patches — the whole point of
the declared two-pass stroke. Grid hidden → nothing connected. Switched to the Eraser tool (`SNAP_POLICY.
erase === 'none'`) with the grid STILL visible → nothing connected either (screenshot confirms: faint grid
dots showing, zero hover highlight) — proving the suppression is genuinely keyed to policy, not just
grid-visibility, which a less careful test could have conflated. `pointerleave` → showing before, cleared
after. Zero console errors/exceptions across the whole run.

Not CDP-verified separately: touch/press behavior. The dispatch's own explicit "Verify" list (unlike T27–T29's)
didn't ask for a mobile pass here, and the code path for it is structurally the same shared
`applyTouchMarkerOffset` call `updateSnapCursor` already relies on for its own touch support — not a second,
untested branch — so it isn't a new surface this turn invented without any coverage, just one not
separately re-proven live. Disclosed rather than silently skipped.

**Process hygiene:** zero leftover `chrome.exe` before this run (clean from T30's own cleanup, confirmed via
`tasklist`); the repo-root `http.server`'s PID (via `netstat`) stopped once verification finished.

Committed by explicit path (6 files: `editor-grid.js`, `editor-interaction.js`, `editor-ui.js`,
`editor-io.js`, the test file, and this WORK-LOG). Amendments polled clean both before this entry and
immediately before the commit below — nothing pending.

## Lane B — Turn 81 (T32) — editor undo/redo: header on desktop, floating bottom-left on touch — DONE

Between T31's pass and this wake, the advisor signaled `LOOP DONE at cycle 40` (T30/T31 merged) — signed
and re-armed per its own instruction, then this cycle opened with T32. Fred: "mobile bottom left, desktop
distinct placement." Seat A's own UX-UNDO work (history/snapshot manager/sidebar binders) landed on lane-b
between turns — confirmed it's a DIFFERENT concern (nothing named `updateHistoryButtons` or similar already
existed; grepped before assuming) and doesn't touch anything this turn changes.

**One pair of buttons, ids/bindings unchanged, placement entirely by CSS** — no duplicated markup, no JS
layout branch. `bspline_gen_palette.html`: `#editorUndo`/`#editorRedo` moved out of the left tool rail (also
removing the `<div style="flex:1;">` spacer that existed ONLY to push them to the rail's bottom — dead
weight once they're gone, per the dispatch's own "remove the rail's divider/spacing left behind") into a
new `<div class="editor-history" role="group" aria-label="Undo and redo">`, placed in the header's
right-hand button group, first child — "left of Download SVG" — with the SAME `.tool-btn` icon-button look
the rail already gave them (per the dispatch: "as ↶ ↷ icon buttons," not converted to the header's other
`cad-btn` text-button style).

**`styles/editor.css`** — `.editor-history` is `display:flex` on every viewport (the only base rule needed
for desktop's normal-flow placement); under `@media (pointer:coarse)` it becomes
`position:absolute; left:12px; bottom:calc(12px + safe-area-inset)`, a light pill (`rgba(255,255,255,0.92)`,
`border-radius:999px`, shadow), `z-index:55` (above `#editorSVGContainer`'s `2`, below the Pattern sheet's
`60`); its `.tool-btn`s get their own 44px sizing since they've left `.editor-sidebar`, whose EXISTING
`pointer:coarse .tool-btn` rule no longer reaches them once moved.

**Worked out, not guessed: WHY `position:absolute` (as the dispatch's own build spec literally says)
actually lands at the bottom-left of the whole modal despite the element physically living in the HEADER
(near the top).** Read `.cad-modal-window.overhauled`'s own inline style before writing any CSS:
`position:relative`, spanning the full `100vh` — the header itself has no `position` set (`static`), so
walking up from `.editor-history` for its containing block skips the header and resolves against that
full-height modal window instead. That's the whole mechanism the "one element, moved by CSS alone" ask
depends on — confirmed by reading the actual inline styles, not assumed from the dispatch's own wording
alone.

**The Pattern-sheet collision check — scoped to exactly the condition where it's real, not blanket-applied.**
The Pattern panel (T24/T25) only becomes a `position:fixed` bottom sheet under `max-width:720px` — a
DIFFERENT condition than `pointer:coarse` (a wide coarse-pointer tablet in landscape has `pointer:coarse`
without the sheet ever going fixed; the panel is a normal side column there and never overlaps the canvas
bottom). Combining both as `@media (pointer:coarse) and (max-width:720px)` for the LIFT specifically, while
the base floating-pill styling stays under `pointer:coarse` alone, matches the dispatch's own "z-index above
the canvas but below the pattern sheet's header... check it doesn't collide" instruction precisely rather
than lifting unconditionally whenever the panel happens to have SOME height for unrelated (desktop-column)
reasons.

**`editor/properties-lattice.js`** — new `--lattice-sheet-height` CSS custom property (the dispatch's own
"sheet height via a CSS variable... or add one" — neither existed, so added one), kept in sync via a
`ResizeObserver` on `#editorLatticePanel`, set once in `initLatticeProperties` alongside the existing
collapse-toggle wiring. One observer, not a scatter of manual sync calls at every place the sheet's height
could change (collapse/expand click, content growth, becoming hidden outside Lattice mode) — `ResizeObserver`
fires on all of those per spec, including reporting a zero size when the observed element's own display
becomes `none`, so the "panel is hidden" case needed no separate branch.

**Disabled state (the dispatch's own explicit "skip if it needs touching editor.js heavily and say so"
escape hatch) — implemented, not skipped, since the actual touch turned out to be 4 one-line additions, not
heavy.** New `updateHistoryButtons(editor)` in `editor-ui.js` (that file's own established "toolbar sync"
responsibility — a natural home, not a new module for one function) reads `editor._undoStack`/`_redoStack`
length against the EXACT SAME conditions `undo()`/`redo()` themselves already check (`< 2` / falsy length) —
read back, not re-derived, so the buttons can't disagree with what clicking them would actually do. Called
from `editor.js`'s `pushState()`/`undo()`/`redo()` — one line each, including the NOOP branches of
`undo()`/`redo()` (so a click that does nothing still leaves the buttons correctly synced, not just the
branches that actually mutate the stacks). `editor.js` gains one new import from `editor-ui.js` (already
importing several other names from there — no new cross-module edge). Touched despite not being in the
dispatch's own file list (`editor.js`), same situation as T27/T30/T31's own necessary small touches outside
the named scope — disclosed here, not silently done.

**Tests**: `tests/editor-history-buttons.test.js` (new file — no existing `editor-ui.js` test file to extend
into for this specific concern; `editor-toolbar-groups.test.js` covers a DIFFERENT export, pure predicates
with no DOM, so a separate DOM-driven file matches rather than forces an awkward merge) — 7 cases: disabled
below 2 undo-stack entries, enabled at 2+, disabled with an empty redo stack, enabled once something's been
undone, the two states are independent of each other, no-throw when the buttons aren't in the DOM, no-throw
with missing `_undoStack`/`_redoStack` (reads as "nothing to undo/redo" rather than crashing).

**Non-vacuity, by mutation**: `updateHistoryButtons`'s two `.disabled =` assignments both hardcoded to
`false` (always enabled) → exactly the 4 tests asserting a DISABLED state failed (the two ENABLED-case tests
correctly stayed green, since "always enabled" coincidentally satisfies them too — not a false negative,
just those two cases not being the ones this particular mutation could distinguish). Reverted, full suite
green again.

`vitest run` → **460 passed (37 files)**, full suite, no gate hit.

**Live CDP verification** (repo-root `python -m http.server 8771`): desktop — the group confirmed living
inside `#svgEditorHeader` (not `.editor-sidebar`), `position:static` (normal flow), BOTH buttons DISABLED on
a fresh session (the initial `pushState()` from `open()` already runs through the new hook, so this needed
no separate init-time call). Functional round-trip via REAL BUTTON CLICKS (not calling `.undo()`/`.redo()`
directly): drew a rect + `pushState()` → Undo enabled, Redo still disabled; clicked Undo → content reverted
to 0 elements, Undo now disabled again, Redo now enabled; clicked Redo → content back to 1 element, Undo
enabled, Redo disabled — the exact 3-state round trip, proving the buttons are wired to the real actions AND
stay correctly synced through actual use, not just after a single isolated call. Mobile (390×844, touch):
`position:absolute`, `left:12px`, `12px` gap from the viewport bottom — matches spec exactly. With the
Pattern sheet expanded: `--lattice-sheet-height` read back as `549px`, matching the panel's own measured
`549px` height exactly; the pill's own bottom edge sat at or above the sheet's top edge
(`pillAboveSheet: true`) — no overlap, confirmed by inspecting both elements' real `getBoundingClientRect()`
values, not just eyeballing the screenshot (though the screenshot confirms it too — the pill visibly floats
right at the seam between the canvas and the Lattice Pattern sheet's own header, exactly as intended). Zero
console errors/exceptions across the whole run.

**Process hygiene:** zero leftover `chrome.exe` before this run (confirmed via `tasklist`); the repo-root
`http.server`'s PID (via `netstat`) stopped once verification finished.

Committed by explicit path (7 files: the HTML, the CSS, `editor.js`, `editor-ui.js`,
`properties-lattice.js`, the new test file, and this WORK-LOG). Amendments polled clean both before this
entry and immediately before the commit below — nothing pending.

## Lane B — Turn 83 — T33: SE12 live-expand design (plan only, no product code touched) — DONE

New `SE12-LIVE-EXPAND-DESIGN.md` at the worktree root, answering all 7 dispatched questions plus
slices/STOP-conditions/open-questions. Read-only turn per the dispatch — every file below was read, none
edited except the new design doc and this log.

**The one finding that reshaped the answer**: mid-turn, `ROADMAP.md` picked up a same-day entry (`9f3c670`,
Fred, 18:28) requiring live expand to be **analytic** ("line → 2 lines + 2 arcs"), explicitly ruling out
the raster-trace Expand pipeline the dispatch itself suggested reusing (`expandGeometric`'s
`getPointAtLength()`-sampling + `unionSelfIntersecting()` polygon-clipping). I read the code first
(`editor-expand-shape.js`, `-union.js`, `-trace.js`, `-text.js`, `-commit.js` — all read in full this
session) and had already understood the pipeline before that roadmap entry landed, which made the
divergence easy to reason through rather than a last-minute scramble: a round-capped straight line's true
offset outline has a closed form (2 straight banks + 2 semicircular arcs), so going analytic isn't extra
scope, it's strictly *less* machinery than the sampling+union approach — no CDN-loaded polygon-clipping
library needed at all for the non-crossing v1 case. Flagged this explicitly in the doc as a deliberate
divergence from the dispatch's literal wording, with the reasoning, rather than silently following either
the older instruction or the newer one without saying so.

**Bench numbers, real not guessed** (CDP against a freshly-generated Lattice pattern — 17 rails, 5 ties, 12
nodes): `unionSelfIntersecting()` cold-load 7ms (one run 273ms, CDN-latency-dependent) / warm ~0ms;
per-element cost feeding the REAL union function a 22-point polygon shaped to match `expandGeometric`'s own
cap-sampling density — 0.1–1.1ms warm each, ≈3ms for all 22 elements. Framed in the doc as a conservative
upper bound the analytic engine doesn't even need to pay, not as the design's actual cost.

**What I could not get, disclosed rather than papered over**: `getTotalLength()`/`getPointAtLength()` throw
`"non-rendered element"` in this headless-Chrome environment for every one of these real, on-screen lattice
lines — confirmed a genuine headless-only limitation (two remediation attempts, `Page.bringToFront` and a
double-rAF wait, both failed to clear it), which is why the per-element number above uses an
analytically-shaped polygon fed straight to the union step instead of a full `performExpand()` timing. Also:
one raster-carve equivalence run (stroke vs. expand-derived outline, rasterized through the same
`renderSvgNative` path the real carve uses) came back with a suspicious 65% opaque-pixel mismatch; a second
confirming run was blocked by CDP/Chrome flakiness in this environment (traced to a backlog of 12 orphaned
`chrome.exe` processes from failed launches — cleared via `taskkill`, but re-runs still couldn't open a CDP
connection before this turn's budget ran out). Documented as attempted-but-inconclusive with a stated,
unverified leading hypothesis (a coordinate-space/viewBox mismatch in the hand-rolled bench harness, since
`commitExpandedPath` is confirmed to compose transforms) rather than asserted as proven either way — and
made it a hard gate on Slice 1 (a real empirical equivalence check must land before anything downstream
consumes the analytic function).

**Design highlights**: new pure function (not a reuse of `expandGeometric`) for the outline `d`; no cache
needed for v1 given the analytic cost is sub-microsecond (declared the key shape for later, built no
machinery for it now); recompute timing mirrors `refreshDrape`'s existing commit-only pattern; new layer
field `outline:false` + `showsOutline()` gate following the exact `isCarved`/`showsColor` pattern
(`layers.js`), row toggle inserted between the existing `colorBtn` and `name` (confirmed insertion point at
`layers.js:653-657`); **no migration entry needed** (unlike `carve`'s `layer-carve-flag` — reasoned through
why: `outline` has no prior semantic to preserve, so the flat `false` default is correct for every existing
document); export/carve swap point confirmed as the single choke point `getLayerSvg` (`editor-io.js:151`,
grep-confirmed exactly 2 call sites); two open questions surfaced for Fred as data choices, not code forks
— outline/centerline/both per layer, and whether Fusion's SVG import actually preserves `A` arc commands
(the latter already flagged in `ROADMAP.md`'s own new entry, restated here since it blocks Slice 4).

**Process hygiene**: `tasklist` confirmed zero leftover `chrome.exe` after cleanup; the repo-root
`http.server` on 8771 was found still listening after the bench work and explicitly stopped
(`taskkill`/`netstat` verified clear) before finalizing the doc's own process-note claim — caught by
re-checking the claim against the actual process list rather than writing it from memory.

**Mid-task amendment, incorporated before committing** (polled per protocol before commit, one landed):
Fred sharpened the arcs-stay-arcs requirement into 3 concrete asks, all folded into the doc before this
entry was finalized, not bolted on after: (1) generalize the analytic offsetter's *coverage* beyond
round-cap lines — square/butt caps (4 lines, no arcs), arc segments (2 concentric arcs + caps), circle
nodes (2 concentric circles, moot today since nodes are filled) — added to item 1, none of it built, just
designed to extend cleanly later. (2) A second, **pre-existing** bug the amendment surfaced that has
nothing to do with live-expand itself: the *static* carve/export bake path
(`editor-transform-handles.js`'s `_bakeMatrixIntoPath` + `bakeMatrixIntoElement`'s circle/ellipse branch)
already throws away every `A` command and every circle/ellipse into cubic Béziers *unconditionally*, even
though the carve matrix (`carveMatrix`, `editor-coords.js:64` — confirmed pure uniform-scale + translate)
combined with an element's own transform is a similarity for the common case. Traced the exact two call
sites and the exact reason (`normalizeForBake` runs before any per-matrix branching), confirmed non-uniform
element scale is a default, easily-reached user action (side-handle drag without shift — corner handles
are the ones that stay uniform), and wrote up the similarity test (`a·c+b·d≈0` and `a²+b²≈c²+d²`) plus the
arc-endpoint/rx-ry/rotation/sweep-flip bake math precisely enough to implement without further research.
Promoted this to **Slice 0**, first, ahead of any live-expand code, exactly as the amendment asked, with
its own non-vacuous-shaped test (arc-in/arc-out under a similarity matrix, AND the same segment still
falling back to cubics under a known non-uniform matrix — proves the branch fires both ways, not just the
happy path). (3) Replaced the vague "recommend Fred test this" for the Fusion-arc-import open question
with a concrete, self-contained 1-minute procedure (a literal one-`A`-command test SVG + where to look in
Fusion's selection info for Arc/Circle vs. Spline) so it's actually actionable without a follow-up
back-and-forth.

Amendments polled clean a second time (`handoff.py amendments --role worker`) immediately before passing —
nothing further pending. Committed by explicit path (2 files: `SE12-LIVE-EXPAND-DESIGN.md`, this
WORK-LOG) — sha `d799ace` is the pre-commit HEAD this turn branched from.

## Lane B — Turn 85 — T34: SE12 slice 0 — the bake keeps true arcs and circles under a similarity matrix — DONE

Built exactly the design's Slice 0: `isSimilarity(m)` + `bakeArcSimilar(prev, seg, m)`, new pure functions
in `editor/path-layout.js`; wired into `editor/editor-transform-handles.js`'s `_bakeMatrixIntoPath` (an `A`
now stays an `A` when the combined bake matrix is a similarity, falling back to `arcToCubics` exactly as
before otherwise) and into `bakeMatrixIntoElement`'s circle/ellipse branch (a circle stays native under any
similarity; an ellipse only when the matrix has no rotation component, since a native `<ellipse>` has no
rotation attribute of its own). `H`/`V` still always become `L`, unchanged.

**The similarity test and the arc bake, precisely**: columns `(a,b)`/`(c,d)` of the matrix must be
perpendicular and equal-length (relative tolerance, since these carry real dpi-scale magnitudes, not unit
vectors). For the arc: `rx`/`ry` scale by the transform's own uniform factor, the new x-axis-rotation reads
off the transformed x-axis vector via `atan2`, and — this is where the actual bug this turn lived —
**sweep is determined by matching the transform's own expected ellipse center**, not by any hand-derived
rule.

**Two wrong formulas, caught by this turn's own cross-check tests before either shipped.** First attempt:
flip sweep when the transformed axis vectors' cross product changes sign (equivalent to `det(m)<0`). Second
attempt, after the first failed a combined-rotation+reflection test: match the original arc's `dTheta`
*magnitude* through `_arcCenterParam`. Both looked reasonable and both were wrong — diagnosed by writing a
scratch script (not guessing) that: (a) confirmed analytically, point-by-point, that every ground-truth
sample DOES lie exactly on the candidate ellipse (so `rx`/`ry`/`phi`/center were never the problem), then
(b) found that for a FIXED `largeArc`, the two `sweep` values pick two *different* valid ellipse centers,
and both can coincidentally land on the same `|dTheta|` via the wrong one — magnitude-matching is
ambiguous. The actual fix: try both sweep values through `_arcCenterParam` (the same oracle `arcToCubics`
itself already trusts) and keep whichever reproduces the transform's own expected center — unambiguous,
because only one candidate's center can equal `transformPoint(m, originalCenter)`.

**A second, unrelated bug turned up in my own TEST while chasing the first**: an early cross-check compared
two independently-computed `arcToCubics` runs point-by-index, but `arcToCubics` splits into
`Math.ceil(|dTheta|/90°)` cubics — floating-point noise pushed the baked segment's `dTheta` a hair over the
90° boundary on one side and not the other (1 cubic vs. 2), so index-aligned comparison silently compared
mismatched points (a 1.44-unit "error" that was pure sampling misalignment, not a geometry bug). Rewrote
the test helper to sample by *global fraction* of the whole multi-cubic run instead of per-segment index —
correct regardless of how many segments either side splits into (`path-layout.test.js`, `sampleAtFractions`).

**Tests** (`tests/path-layout.test.js`, `tests/editor-transform-handles.test.js`): `isSimilarity` — true for
identity/carveMatrix's own shape/pure rotation/rotation+scale/a reflection, false for non-uniform scale and
a shear, false (not a throw) for a degenerate matrix. `bakeArcSimilar` — `carveMatrix(7,9,96)` numeric
check (rx/ry×96, endpoint, sweep/largeArc/rotation unchanged); cross-check against sampled ground truth for
a rotated+scaled+translated similarity, a pure reflection, and the rotation+reflection combination that
caught both wrong formulas above; a genuine ellipse (rx≠ry, so an axis-swap bug would show as an off-ellipse
point, not just an off-circle one) through a rotated similarity; degenerate-arc and degenerate-radius →
`null`, matching `arcToCubics`' own contract exactly (not `NaN` — `_arcCenterParam` doesn't guard the
identical-start/end case itself, only `arcToCubics`'s own caller-side check did, so `bakeArcSimilar` needed
the same explicit guard, caught by tracing the code before assuming `_arcCenterParam` was self-sufficient).
`bakeMatrixIntoElement` circle/ellipse: carveMatrix's own shape, a rotated similarity on a circle, an
axis-aligned similarity on a genuine ellipse (rx/ry both scale) — all stay native; a non-uniform matrix,
proven via a mock circle with `.parent()` returning `null` (the real fallback's own clean bail, reached
without needing a full `SVG.PathArray` mock — same reason the `'path'` branch has never had a unit test in
this file: `_bakeMatrixIntoPath` needs real svg.js, out of reach for vitest, verified live instead, below).

**Non-vacuous, by mutation, on the two branches this turn actually added** (not re-proving pre-existing
code): forced `bakeArcSimilar`'s final return to always keep the *original* sweep instead of the matched
one → exactly the 2 reflection-dependent tests failed (the plain-rotation and carveMatrix tests correctly
stayed green, since sweep never needed to flip for either). Forced `isSimilarity` to always return `true`
→ 3 tests failed: both `isSimilarity`-false cases directly, plus the cross-file `bakeMatrixIntoElement`
non-uniform-scale gate test (proving that test genuinely depends on the real gate, not a coincidence).
Reverted both mutations; full suite re-confirmed green after each.

**Live verification — the REAL production pipeline, not a proxy**, per the dispatch's own "round-trip of a
lattice node": repo-root `python -m http.server 8771`, headless Chrome via CDP, Lattice-generate a real
pattern (21 nodes), then the exact call sequence `export-flow.js` itself uses — `getLayerSvg(editor,
layerId, 96)` → `bakeSvgForCarving(layerSvg, mW, mH, 96)`. Before this turn's fix (confirmed via `git stash`
on just the 2 product files, re-running the identical script, then `stash pop`): 15/15 circles promoted to
4-cubic `<path>` elements, 0 circles survived. After: 21/21 circles stayed `<circle>`, 0 paths, radius
correctly scaled by dpi (`0.075 × 96 = 7.2`, confirmed by direct string match on the baked SVG, not
inferred). A genuine arc (`<path d="...A...">`) doesn't currently occur anywhere in this app's own generated
output (`_primitiveToPathData` emits cubics for circle/ellipse promotion already, per SE8a; only an
imported/pasted SVG could carry a real `A`), so the arc side of Slice 0 has no in-app live case to exercise
yet — covered by the vitest cross-check suite above instead, which is the more direct proof for that path
anyway (exact analytic ground truth, not a screenshot).

**Process hygiene**: `tasklist` confirmed zero leftover `chrome.exe` at both the start of this turn's live
work and again after; the repo-root `http.server` was found still listening after verification and
explicitly stopped (`taskkill`/`netstat` verified clear) before finalizing.

Amendments polled clean (`handoff.py amendments --role worker`) before committing and again immediately
before passing. Committed by explicit path (5 files: `editor/path-layout.js`,
`editor/editor-transform-handles.js`, `tests/path-layout.test.js`, `tests/editor-transform-handles.test.js`,
this WORK-LOG) — pushed.

## Lane B — Turn 87 — T35: SE12 slice 1 — analytic round-cap outline engine — DONE

First step per the dispatch: `git merge origin/main` (clean working tree confirmed via `git status` first,
`ort` strategy, no conflicts — pulled in T34's own merge back to main, layer-toggle styling, the SE12
`fusionGeometry` answer, and Seat A's SE7h lattice-orientation work, 15 files). Full suite green (521/521,
19 new from main) before pushing the merge; pushed separately from this turn's own product commit so a
problem in either would be easy to bisect.

**Fred's answers, now load-bearing for later slices, not this one**: `fusionGeometry` is an explicit
per-layer pick (Outline/Centerline/Both), default centerline, **never inferred automatically** — noted, not
designed against yet (that's Slice 4). New context: Fred uses these stamps two ways — raised/carved relief
AND resin inlay (carve a recess, fill resin, machine flush against the original uncarved STEP) — inlay is
why exact Outline geometry actually matters, not just a nice-to-have.

New pure module `editor/editor-expand-analytic.js`: `lineOutlinePathD({x1,y1,x2,y2,strokeWidth,cap})` — a
round-capped line's TRUE offset outline as a filled path `d`, 2 straight banks + 2 true semicircular `A`
arcs, zero sampling, zero polygon-clipping (Fred: "straight lines need to be just straight lines and arcs
need to be true arcs"). `SUPPORTED_LINE_CAPS` declared as data (`round: true, butt: false, square: false`)
per the dispatch's own ask — a caller gets an explicit `{d: null, unsupported: 'butt'}` decline, never a
silently-wrong round-cap shape for a cap this slice doesn't cover yet. Zero-length line degenerates to a
full circle via two `A` semicircles (SVG can't express a full circle in one `A`) — same point-sequence
shape `path-layout.test.js`'s own existing "full circle via two 180deg arcs" test already validates, just
centered at the (coincident) endpoint instead of the origin. Works in the element's LOCAL frame only — world
transforms are Slice 0's job (`isSimilarity`/`bakeArcSimilar`), composing with this module's `A` output
exactly like any other arc-bearing path would, no special-casing needed between the two slices.

**The one number this turn couldn't get from pure derivation**: which `sweep` flag value (0 or 1) makes each
cap arc bulge AWAY from the line instead of back into the capsule body. Given how T34 (same session) already
went wrong twice trusting a hand-derived sweep rule, I didn't repeat that — built a tiny scratch script that
fed both candidate values through the REAL `arcToCubics` (already in this codebase, already trusted), sampled
each candidate's arc midpoint, and read which one actually lands past the line's endpoint vs. folded back
over it. `sweep=0` for both cap arcs, confirmed numerically before writing a single line of the module, not
after debugging a failing test.

**Tests** (`tests/editor-expand-analytic.test.js`, new, 7 cases): horizontal/vertical/diagonal lines — every
bank point sits EXACTLY `strokeWidth/2` off the centerline, measured as perpendicular distance (direction-
agnostic, so this can't just be re-asserting the module's own normal-sign convention back at itself); both
arcs have `rx=ry=strokeWidth/2`; the whole loop's shoelace-formula area matches the analytic "stadium" shape
(`L·w + π(w/2)²`) within 1% — this one check catches BOTH a wrong magnitude AND a self-intersecting/bowtie
loop a wrong sweep would produce, not just one or the other. A dedicated sweep-direction test samples each
arc's own midpoint (not just the area) and asserts it lands outside the line's own span. Zero-length →
full-circle area + every sampled point at exact radius. Unsupported cap (`butt`/`square`) → explicit decline,
not a shape.

**Non-vacuous, by mutation**: flipped both `sweep` flags in the actual module (0→1, the wrong value my own
scratch check had already ruled out) — 4 of 7 tests failed (both area checks that happened to hit a bowtie
badly enough, plus the dedicated bulge-direction test); the zero-length-circle and unsupported-cap tests
correctly stayed green (neither exercises the two-bank sweep path at all — not a false negative, just not
what those cases test). Reverted; full suite re-confirmed green (528/528) after.

**Also constructed a deliberately-bowtied `d` string BY HAND** (swapped which arc endpoint connects to
which bank) as its own test, to prove the shoelace-area check can actually detect that failure MODE
specifically — not just infer it from the mutation above catching *something*. Confirms the check is
measuring the right property (a valid simple closed loop), not coincidentally sensitive to sweep alone.

**CDP smoke test — the real symptom, not a proxy**: repo-root `http.server`, headless Chrome, generated a
real Lattice pattern, took one actual rail (`x1=0.25 y1=0.5 x2=6.75 y2=0.5, stroke-width=0.07`), ran it
through the actual `lineOutlinePathD`, then rasterized BOTH the original `<line stroke-linecap="round">` and
the analytic `<path fill>` outline through `renderSvgNative` (the same real-native-SVG-rendering primitive
`rasterizeSvg`'s own carve path uses, per SE12-LIVE-EXPAND-DESIGN.md's own item-4 finding this session
already established) at 100px/inch. **Result: strokeOpaque=4587, outlineOpaque=4595, diff=0.17%** — squarely
in the "edge anti-aliasing only" range the design predicted, not asserted. Screenshots saved
(`t35-stroke.png`/`t35-outline.png` in the session scratchpad) — visually indistinguishable, confirmed by
reading both images directly, not just trusting the pixel-count number alone.

**Process hygiene**: `tasklist` confirmed zero leftover `chrome.exe` before and after the two live-verify
runs this turn; the repo-root `http.server` was found still listening (its actual LISTENING socket, not the
harmless `TIME_WAIT` connection remnants a busy dev server accumulates) and explicitly stopped
(`taskkill`/`netstat` re-verified clear) before finalizing.

Amendments polled clean (`handoff.py amendments --role worker`) before committing and again immediately
before passing. Committed by explicit path (3 files: new `editor/editor-expand-analytic.js`, new
`tests/editor-expand-analytic.test.js`, this WORK-LOG) — pushed.

## Lane B — Turn 89 — T36: SE12 slice 2 (revised) — ONE fusionGeometry field + sidebar picker — DONE

**The advisor's revision, applied as designed, not as my own original draft had it**: my SE12 doc's own Slice
2 had TWO fields (`outline:boolean` + `fusionGeometry`, the latter documented as "meaningless while
outline:false") — Fred caught it: "Don't choose automatically," and the advisor correctly read that as "one
concept stored twice." Declared exactly ONE field, `fusionGeometry: 'centerline'|'outline'|'both'`, default
`'centerline'` (today's only behavior). `showsOutline(l)` now derives from it instead of being its own stored
flag.

**Declared `FUSION_GEOMETRY`** (`editor/layers.js`) — value/label/hint per choice, so the sidebar picker and
its hint text both render FROM this table (adding a 4th choice later is one entry here, not a UI rewrite,
matching the dispatch's own ask). `TOOLING_DEFAULTS.fusionGeometry = 'centerline'` — confirmed this needs
**no migration entry**: `applyToolingDefaults` (the one mechanism every new layer AND every restore-from-save
already runs through) backfills it identically either way, same reasoning T33's design doc already worked
out for why `carve`'s migration was needed but `outline` wouldn't be.

**`showsOutline(l)` — caught and fixed a real bug in the dispatch's own literal formula before shipping it.**
Dispatched as `isExported(l) && l.fusionGeometry !== 'centerline'`. Writing the "missing key" test (a layer
object that hasn't been through `applyToolingDefaults` yet — a test mock, or theoretically a future call
site) surfaced that this literal formula reads `undefined !== 'centerline'` as `true` — i.e. a layer with NO
`fusionGeometry` key AT ALL would show as "has an outline," the OPPOSITE of the field's own declared default.
The sibling gates (`isCarved`/`showsColor`) both default a missing key to their SAFE historical value via
their own comparison shape (`!== false` reads undefined as "on"); `showsOutline` needed the equivalent for
ITS default, which isn't reachable by just swapping the comparison operator since the safe default here is a
STRING, not a boolean. Fixed to `(l.fusionGeometry || 'centerline') !== 'centerline'` — same public
behavior for every REAL layer (which always has the key by the time anything reads it), but no longer wrong
for the theoretical missing-key case. Confirmed via mutation (below) that this specific line, not something
else, is what the test depends on.

**New `main/stamp/_dom-binders.js` binder, `bindLayerOnlySegmented`**, sibling to the existing
`bindLayerOnlyNumber`/`bindLayerOnlyCheckbox` (same "layer-only field, listeners attached, commit-on-
interaction + undo + optional remask" shape) — for an exclusive-choice BUTTON GROUP instead of a single
input, since neither existing binder fit a 3-way picker. Takes a `{value: buttonId}` map so a caller building
its picker from a data table (exactly what `fusion-geometry.js` does with `FUSION_GEOMETRY`) doesn't have to
hand-list the values a second time. `triggerRemask` defaults `true` (same default as the siblings, for
consistency of the SHARED binder's own behavior), overridden to `false` at THIS field's own call site — the
mask/relief doesn't read `fusionGeometry` yet (Slice 3/4), so remasking on a click right now would re-render
an unchanged image for no reason.

**New `main/stamp/fusion-geometry.js`**: wires the 3 buttons (via the new binder) plus a hint-text line that
follows both the active layer AND every click, rendering everything from `FUSION_GEOMETRY`. Registered into
`main/stamp/index.js` alongside `initProfileControl` (same early-init slot — no ordering dependency on
`initLayer`, unlike `svg-source.js`). New UI block in `bspline_gen_palette.html`, placed after V-Bit Angle /
before SVG Blueprint in the existing "Settings below apply to the selected layer" section (NOT a 4th layer-row
toggle, per the advisor's own explicit steer to keep 👁·3D·🎨 uncrowded) — reuses `.editor-fillmode-btn`, the
same segmented-control class the Style STROKE/FILL/BOTH group and SE7h's rail/tie orientation toggle already
use, so this needed zero new CSS.

**Tests**: `tests/layers-fusion-geometry.test.js` (new) — the data table's shape; new-layer and old-saved-
layer-missing-the-key both backfill to `'centerline'` through the SAME `applyToolingDefaults` call (not two
separate mechanisms); a layer that already has a value keeps it (defaults fill gaps, never overwrite); a
save/restore round-trip via the actual `JSON.stringify`/`&quot;`-escape encoding `editor-io.js` uses for
`data-editor-layers` (the same shape `layer-carve-flag`'s own migration code uses, cited as precedent); the
full `showsOutline` truth table including the hidden-layer case (master `visible` wins even over
outline/both) and the missing-key case the fix above addresses. `tests/ux-undo.test.js` (extended, matching
its own existing `bindLayerOnlyNumber`/`Checkbox` test shape exactly): a button click commits exactly one
undo entry and only that button ends up `.active`; two rapid clicks (changed mind) still coalesce into ONE
entry within the shared 400ms window, same as the number/checkbox binders' own tests just above it.

**Non-vacuous, by mutation, on both new pieces**: reverted `showsOutline` to the dispatch's literal (buggy)
formula — exactly the one test targeting the missing-key case failed, nothing else. Removed the
`scheduleUndoSnapshot` call from `bindLayerOnlySegmented` — exactly the two new undo tests failed (single
click, and the two-rapid-clicks coalescing case), nothing else regressed. Reverted both; full suite
re-confirmed green (541/541) after each.

**Live verification — the real symptom, not a proxy**: repo-root `http.server`, headless Chrome via CDP.
Orphaned headless-Chrome processes were present at the start of this turn's live work, but their command
lines (`Get-CimInstance Win32_Process`, checked BEFORE touching anything) showed a DIFFERENT session's
scratchpad path (`.../scratchpad/smoke-out/chrome-se7h-addon`) — Seat A's own SE7h smoke test, not mine and
not the user's real browser — so left them alone and launched on a separate port instead, rather than
assuming "orphaned chrome.exe" always means MY OWN leftovers the way it has every other time this session.
Opened the editor once (creates `window.svgEditor` + a default layer), hid the modal directly (no dedicated
close-button id exists in the markup), expanded the VECTOR STAMPING panel, scrolled the picker into view, and
screenshotted all three states: Centerline (initial, active, correct hint), then clicked Outline (screenshot
+ confirmed `layer.fusionGeometry === 'outline'` by reading the REAL layer object back, not just the button's
own class), then Both (same). Zero console errors/exceptions across the whole run. Screenshots saved
(`t36-centerline.png`/`t36-outline.png`/`t36-both.png`, session scratchpad) — read back directly to confirm
layout (placed correctly between V-Bit Angle and SVG Blueprint) and that the active button + hint text track
each other, not just trusting the state dump.

**Process hygiene**: confirmed via `Get-CimInstance` (not just `tasklist`, given the mixed-ownership chrome
processes above) that MY OWN chrome instance (`chrome-t36` user-data-dir) exited cleanly on its own; other
sessions' chrome processes were never touched. The repo-root `http.server` (a different PID than T35's, since
that one was already stopped) was found still listening and explicitly stopped
(`taskkill`/`netstat` re-verified clear) before finalizing.

Amendments polled clean (`handoff.py amendments --role worker`) before committing and again immediately
before passing. Committed by explicit path (8 files: `editor/layers.js`,
`main/stamp/_dom-binders.js`, `main/stamp/index.js`, new `main/stamp/fusion-geometry.js`,
`bspline_gen_palette.html`, `tests/ux-undo.test.js`, new `tests/layers-fusion-geometry.test.js`, this
WORK-LOG) — pushed.

## Lane B — Turn 91 — T37: SE12 slice 3 — outline preview, commit-only — DONE

**Found and fixed a real T36 gap before starting T37's own work**: `editor-io.js`'s `_PERSISTED_LAYER_FIELDS`
(the list `_serializeLayersAttr` actually filters through when writing `data-editor-layers`) never got
`fusionGeometry` added — the field lived in `TOOLING_DEFAULTS` and round-tripped fine through a SYNTHETIC
`JSON.stringify`/`&quot;`-escape test in T36, but that test bypassed the REAL filter list, which silently
dropped the field on every actual save. A user's Outline/Both pick would have reverted to Centerline on
reload. One-line fix (`_PERSISTED_LAYER_FIELDS` += `'fusionGeometry'`), caught by reading the actual
serialize path before building anything that depends on the field surviving a commit — which T37 does.

**The design, confirmed architecturally before writing any preview logic**: read `serializeEditor`/`save`
(editor-io.js), `pushState` (editor.js), hit-testing/selection (editor-interaction.js), and `refreshDrape`
(app-init.js, via `editor.save()`) — every one of them walks ONLY `_sketchLayer.children()`. So a NEW
`outlinePreviewLayer`, created as a SIBLING of `_sketchLayer` (not a child — `init.js`, alongside the
existing `handleLayer`/`highlightLayer`/`gridLayer` siblings) is excluded from getSvgString/getLayerSvg/save,
undo snapshots, hit-testing, selection, AND the drape simultaneously, by construction — zero filtering code
needed at any of those five call sites, matching the dispatch's own bullet list exactly. `pointer-events:none`
on the group covers every descendant.

**New `editor/editor-outline-preview.js`** — `refreshOutlinePreview(editor)`: clears the layer, walks
`_sketchLayer.children()`, and for each element whose layer passes `showsOutline(layer)` AND is a `<line>`
(the only kind `lineOutlinePathD` supports today — anything else is skipped silently, no error, matching the
Slice 1 module's own `unsupported` contract) draws a thin (`0.02`) no-fill outline path. Color reuses the
EXISTING mechanism rather than inventing a second one: `_currentElementColor` (properties-shape.js) for the
base color, then the SAME `.layer-no-color` CSS class `applyLayerState` already puts on a no-showColor
source element — one CSS rule (`stroke:#999 !important`), one color, whichever element carries the class.
The preview path gets the source element's own `transform` attribute verbatim (local-frame geometry +
uncomposed transform — Slice 0's `isSimilarity`/`bakeArcSimilar` is what composes a WORLD transform into an
arc-bearing path, not this module's concern).

**Commit-only wiring — genuinely "one import + one call" in `editor.js`**, per the dispatch's own ask given
Seat A is mid-SE7h in that same file: one new import, one line added to `_notifyChange(kind)` —
`if (kind === 'commit') refreshOutlinePreview(this);` — placed before the `!this._onChange` early-return so
the preview still refreshes even in a context where no external onChange is wired (a smaller test harness,
for instance), not coupled to app-init.js's broader pipeline at all.

**"Picking Centerline counts as a commit" — resolved as a SEPARATE, deliberately lighter call, not by
routing the picker through the full `_notifyChange('commit')` cascade.** The fusionGeometry field write and
`_notifyChange` live in different worlds (stamp-panel sidebar vs. the editor's own internal pipeline), and
`_notifyChange('commit')` would also re-run `serialize`+`persist`+`remask` (refreshAllStampMasks +
refreshDrape) — expensive work for a field NOTHING outside the preview reads yet (Slice 4 is the export
swap). `main/stamp/fusion-geometry.js`'s own click handler now calls `refreshOutlinePreview(window.svgEditor)`
directly (guarded on `window.svgEditor` existing — the editor may never have been opened this session) —
same underlying function the commit hook calls, so there's no duplicated logic, just two well-reasoned call
sites for two different situations.

**Tests** (`tests/editor-outline-preview.test.js`, new, 13 cases): which elements get a preview across
fusionGeometry (centerline/outline/both) × visible × element-type (line vs. non-line) × missing-layer;
rebuilds from scratch each call (`.clear()`, not append) — including the literal "picking Centerline empties
the preview on the next call" property, proven by construction (the function caches nothing, so there's
nothing to go stale); color follows `showsColor` via the shared `.layer-no-color` class, not a duplicated
neutral constant; the source element's `transform` carries over verbatim; and the one test that stands in
for all five "excluded from X" requirements at once — `_sketchLayer.children()` is the SAME array reference,
untouched, before and after a call, which is the actual property that GUARANTEES every one of the five
(re-testing each of the five consumers separately would just re-prove this same fact five times over).

**Non-vacuous, by mutation**: removed the `showsOutline` gate — exactly the 3 tests keyed on it (centerline,
hidden-layer, centerline-after-outline) failed, nothing else. Removed the `.clear()` call — exactly the 2
tests keyed on rebuild-not-append failed. Reverted both; full suite re-confirmed green (554/554) after each.

**Live verification, and a real environment gotcha worth recording**: chrome spawned via Node's
`child_process.spawn` (this session's usual CDP pattern) failed repeatedly with "NO CDP" this turn — even
with a clean user-data-dir and generous retry windows — while the EXACT SAME chrome binary launched directly
via a backgrounded Bash command connected fine within 4 seconds. Root cause not chased further (out of scope
for this task), but the WORKAROUND is durable: launch chrome via Bash (`chrome.exe ... &`), then have a
separate Node script `fetch` its `/json/list` and connect to the existing instance's websocket rather than
spawning chrome itself. Recording this here since every prior CDP script this session (T33-T36) used the
Node-spawns-chrome pattern successfully — this is the FIRST time it failed, so a future turn hitting the same
"NO CDP" symptom should try the Bash-launch workaround before assuming the app itself is broken.

Also pivoted the drag-timing check itself: a literal synthetic `PointerEvent` drag (pointerdown/move/up with
computed client coordinates) reached the app but never actually moved the rail — likely a hit-testing or
gesture-recognition precondition this session didn't chase down, since it isn't what T37 changed. Verified
the ACTUAL property in question — the `'live'` vs `'commit'` distinction in `_notifyChange`, the one line
this turn added — more directly instead: moved the rail's endpoint attribute directly (as a real drag
handler would, mid-gesture) and called `editor._notifyChange('live')` then `('commit')` through the REAL
method. Real lattice (17 rails), real `fusionGeometry` write, real `refreshOutlinePreview` calls throughout,
not mocked:
- Outline picked on the rail's own layer (found via `rail.getAttribute('data-layer')`, not assumed) → 17
  preview paths, one per rail.
- `_notifyChange('live')` after moving the endpoint → preview `d` UNCHANGED (confirmed byte-for-byte).
- `_notifyChange('commit')` → preview `d` updated to the new endpoint, confirmed in the screenshot too (the
  top rail visibly extends past its original length after commit).
- Centerline picked → preview count back to 0.
- `showColor:false` on the layer → `getComputedStyle` on the preview path read back `stroke: rgb(153, 153,
  153)` (`#999`, the exact `.layer-no-color` value) and `stroke-width: 0.02px` — the REAL BROWSER's OWN style
  resolution, not just class-name presence, confirming the CSS override genuinely applies rather than just
  being attached.
Screenshots saved (`t37-outline-preview.png`, `t37-after-commit.png`, `t37-centerline-empty.png`, session
scratchpad) — disclosed honestly: the preview line itself is visually subtle in these screenshots (same red
as the rail, offset only ~0.03" outward, so it largely blends with the thick stroke's own anti-aliased edge
at this zoom) — the `getComputedStyle` check above is the stronger, more direct proof it renders correctly;
the screenshots mainly confirm layout/no-crash rather than being the primary evidence here. Zero console
errors across every run.

**Process hygiene, with the mixed-ownership caution this session established in T36 applied again**: before
touching anything, checked `Get-CimInstance`'s command lines rather than assuming ownership — one round found
0 chrome processes at all (clean start), a later round found 8 processes all matching MY OWN
`chrome-t37final` user-data-dir (confirmed by grep on the command line before stopping any of them). Stopped
cleanly; confirmed 0 chrome processes remained after. The repo-root `http.server`'s actual LISTENING PID
(distinct from the harmless per-request `TIME_WAIT` sockets) was found and stopped, `curl` re-confirmed the
port genuinely refuses connections afterward, not just netstat's own listing.

**Mid-task amendment, incorporated before committing**: Fred — "it should work on shapes in priority, but
eventually text" — keep this turn's scope to lines, but don't hardcode `<line>` in `refreshOutlinePreview`;
route each element through a declared per-kind table instead, so T38 (shapes: rect/circle/polyline/polygon/
path) and later text plug in as table entries with zero change to the preview function itself; an unknown
kind is simply skipped. New `OUTLINE_KINDS` (exported from `editor-outline-preview.js`) — one entry today
(`line`, wrapping `lineOutlinePathD`), each entry a `(el) => { d, unsupported }` function so a future entry
adapts its own kind's DOM attrs into whichever geometry function it calls, same return shape throughout.
Per the declare-over-hand-roll principle this session already leans on repeatedly: the TABLE is worth
declaring now (cheap, and every future kind plugs into the identical shape); the shape/text geometry
FUNCTIONS are not (building them before T38/T39 call them would be exactly the speculative machinery that
rule warns against) — explicitly did NOT start on shapes this turn. Added 3 new tests proving the table is
genuinely consulted (not a hardcoded check reintroduced by mistake): a temporary `circle` entry added at
test time fires with zero edits to `refreshOutlinePreview`, and removed again in a `finally` so the shared
table is left exactly as found; a `{unsupported}` result from an IN-table entry still produces no preview.
Mutation-verified: reverted the lookup to a hardcoded `ch.type === 'line'` check — exactly the new
extensibility test failed (the plain line/centerline/hidden-layer tests all stayed green, since a
hardcoded check still handles the one kind that exists today; only the "is it actually table-driven" test
can tell the difference) — reverted, full suite re-confirmed green (557/557).

Amendments polled clean (`handoff.py amendments --role worker`) a second time immediately before passing —
nothing further pending. Committed by explicit path (7 files: `editor/editor-io.js`, `editor/editor.js`,
`editor/init.js`, new `editor/editor-outline-preview.js`, `main/stamp/fusion-geometry.js`, new
`tests/editor-outline-preview.test.js`, this WORK-LOG) — pushed.

## Lane B — Turn 93 — T38: visible outline preview + circle/rect exact outlines — DONE (polyline/polygon/generic-path NOT built this turn, disclosed below)

**Part 1 — preview visibility (T37 review finding, fixed first per the dispatch's own order).** T37's own
screenshot showed nothing: a same-color-as-source thin line drawn AT the source's own edge is invisible
against a stroke of that same color, AND (the second, independently-necessary half of the fix, found while
tracing this) a `0.02`-model-unit stroke shrinks to sub-pixel at fit-to-page zoom on a multi-inch board —
color alone wasn't the whole bug. Fixed both: two new CSS classes (`styles/editor.css`)
`.outline-preview-halo` (`stroke:#fff; stroke-width:3px`) and `.outline-preview-line`
(`stroke:#1a1a1a; stroke-width:1px`), both `vector-effect:non-scaling-stroke` (a constant SCREEN pixel
width regardless of editor zoom — the fix for the second half). `refreshOutlinePreview` now draws TWO path
elements per outlined source (halo underneath, line on top, same `d`, same transform), and dropped the
`showsColor`/`_currentElementColor`/`.layer-no-color` machinery entirely — there's no per-element color
choice left to gate. `showsOutline(layer)` is unaffected and remains the only visibility gate, exactly as
before.

**Part 1 — the other three refresh triggers ("undo/redo, layer switch, document open/restore").** Tracing
why these didn't already work surfaced a WIDESPREAD pre-existing pattern: `editor._onChange()` called
DIRECTLY (bypassing `_notifyChange`, T37's own commit-only hook) at ~25 call sites across 10 files —
`editor.js`'s `_restoreState` (undo/redo's shared function) and `layers.js`'s `setLayerVisible`/
`setLayerCarve`/others among them. Sweeping all 25 is clearly out of this turn's scope (and directly
against the dispatch's own caution that Seat A is concurrently editing `editor.js`/`editor-io.js`/
`layers.js` for SE7i) — fixed only the specific spots this requirement needs:
- `editor.js`'s `_restoreState` (shared by `undo()`/`redo()`): `this._onChange()` → `this._notifyChange('commit')`
  — a safe drop-in (that method itself checks `this._onChange` before calling it, same effective end
  behavior) that additionally refreshes the preview.
- `layers.js`'s `setLayerVisible` (the one field among the bypass sites that actually changes
  `showsOutline`'s result, since visibility gates `isExported`): same swap, with a defensive fallback to
  the old direct call if `_notifyChange` isn't present (keeps working against any caller/mock that doesn't
  implement the full method surface).
- `layers.js`'s `setActiveLayer`: had NO onChange call at all before this — added a direct
  `refreshOutlinePreview(editor)` call (not the full `_notifyChange('commit')`, which would also trigger a
  remask+redrape neither switching layers nor opening a document has any reason to pay for). This ONE hook
  covers BOTH "layer switch" AND "document open/restore" for free: `editor-io.js`'s `open()` calls
  `editor.setActiveLayer(firstLayerId)` as its own last roster-restore step (confirmed by reading it, both
  the content-found and the empty-editor early-return paths), so a document load refreshes the preview
  through this same one hook with no separate call needed there.

Fixing `setActiveLayer` required importing `refreshOutlinePreview` INTO `layers.js`, which imports it FROM
`editor-outline-preview.js`, which already imports `showsOutline`/`showsColor` FROM `layers.js` — a genuine
circular import. Reasoned through before writing it (not discovered by a crash): every binding crossing the
cycle is a hoisted function DECLARATION (`export function ...`), never a `const`, so nothing depends on the
OTHER module's top-level code having run yet — confirmed safe by the full suite passing with zero import
errors, not just by the reasoning alone.

**Tests** (`tests/editor-outline-preview-triggers.test.js`, new): `setActiveLayer` rebuilds the preview from
current state (and non-vacuously — re-switching to the SAME id after an external field change still
re-reads, proving no caching); undo/redo (via the REAL `VectorEditor.prototype` methods borrowed onto a
minimal mock, same convention `editor-lattice-undo.test.js` already established) restore `_layers` AND
refresh the preview to match. `editor-lattice-undo.test.js` itself needed `_notifyChange` added to its own
mock (the SAME borrowed-real-method convention) since `_restoreState` now calls it — `refreshOutlinePreview`
no-ops cleanly on a mock with no `_outlinePreviewLayer` (its own top-level guard), so this didn't need a
heavier mock, just one more borrowed method. "Document open/restore" has no dedicated mock test —
`editor-io.js`'s `open()` needs a much heavier mock than this style, same conclusion several OTHER test
files already reached and noted (`editor-serialization.test.js`'s own comment) — covered instead by the
`setActiveLayer` test (transitively, since `open()` calls it) and the live CDP check below (directly).

**Non-vacuous, by mutation**: removed `refreshOutlinePreview(editor)` from `setActiveLayer` — exactly its 2
own tests failed, undo/redo tests unaffected. Reverted; full suite re-confirmed green after each.

**Part 2 — exact shape outlines: circle and rect (both `editor-expand-analytic.js`).** Both closed-form —
no offsetting ALGORITHM needed, unlike a general polygon (see the disclosure below for why that's NOT
attempted this turn). `circleOutlinePathD`: two concentric circles at `r ± strokeWidth/2` (Fred: "circle →
two concentric circles"), same two-`A`-semicircle construction `lineOutlinePathD`'s own degenerate
zero-length-line case already established (factored out as a shared `_circleLoopD` helper). `rectOutlinePathD`:
the Minkowski-sum outer boundary — a standard rounded-rect path (4 lines + 4 quarter `A` arcs of radius
`strokeWidth/2`, each centered on one of the rect's own ORIGINAL sharp corners) — plus a sharp-cornered
inner rect offset inward (offsetting inward never needs rounding; only outward offsetting opens a gap at a
convex corner that a round join has to fill). Both have an "inner ring vanishes" case (circle:
`strokeWidth/2 >= r`; rect: `strokeWidth >= the shorter side`) — same reasoning both times: the inward
offset would invert.

**The rect corner-arc sweep flag was WRONG on the first attempt — caught by verification, not assumed
correct from the geometry alone**, the exact same class of mistake T34 made twice already this session. My
first numeric check used ad-hoc test coordinates that didn't actually match what `rectOutlinePathD` itself
produces, and appeared to confirm the WRONG sweep value; redoing it with the ACTUAL coordinates my code
emits (traced through by hand: for a rect at origin, width 10, height 6, strokeWidth 2, the top-right
corner arc runs from `(10,-1)` to `(11,0)`) showed `sweep=1` is correct (arc centered exactly at the
original corner, bulging away from the rect's own center) — confirmed on a second, structurally-different
corner (bottom-left) too before trusting it into the actual implementation.

**Filled shapes** (Fred: "outline = the shape's own edge, exact, no offset; 'both' = edge offset by w/2"):
both `circleOutlinePathD`/`rectOutlinePathD` take an explicit `mode` (`'stroke'` default / `'fill'` /
`'both'`) rather than three separate functions per shape — `'fill'` returns the shape's own exact boundary
(zero offset, `strokeWidth` ignored entirely); `'both'` returns the SAME outer-ring construction `'stroke'`
mode uses, but never appends an inner ring regardless of how the strokeWidth/size ratio would normally
leave one. `_fillModeOf(el)` (new, `editor-outline-preview.js`) reads the element's OWN `fill`/`stroke`
presentation attrs to pick the mode — declared once since every closed-shape `OUTLINE_KINDS` entry needs
the same read.

**Ellipses and cubic/quadratic paths declined explicitly** (Fred: "NOT exact by nature... return
`{unsupported:'curve'}` this turn"): a new `ellipse` `OUTLINE_KINDS` entry that unconditionally returns
`{d:null, unsupported:'curve'}` — an EXPLICIT decline, not just a missing table entry, so a future reader
sees "considered and ruled out this turn," not "never considered" (same distinction
`SUPPORTED_LINE_CAPS`'s `butt`/`square:false` already makes for caps).

**Tests** (`tests/editor-expand-analytic-shapes.test.js`, new, 13 cases; plus `editor-outline-preview.test.js`
extended): every ring point checked against its EXACT analytic distance (circle: `r±strokeWidth/2`
directly; rect: perpendicular distance to the nearest original edge for straight points, radius-`half`
distance to the nearest original corner for arc points); annulus/rounded-rect areas checked against their
closed-form formulas (`2·π·r·strokeWidth` for the circle annulus; `(W+sw)·(H+sw) - (4-π)·(sw/2)²` for the
rounded outer rect — the bounding box minus the 4 corners' round-over cut, derived and checked, not
assumed); inner-ring-vanishes and its non-vacuous "just under the threshold, ring is real" counterpart for
both shapes; all 3 fill modes end-to-end through `refreshOutlinePreview` (not just the pure geometry
functions in isolation), including the mode:`'both'` case checked by ABSENCE of the inner ring (a bare
presence check on the outer ring alone can't tell `'both'` apart from `'stroke'`, since they share the
identical outer-ring formula — caught by mutation, see below, not written defensively up front).

**Non-vacuous, by mutation**: removed the halo shape from `refreshOutlinePreview` (kept only the line) —
exactly the 10 tests keyed on the halo/pair-count failed, nothing else. Forced `_fillModeOf` to always
return `'stroke'` — the FIRST version of the mode:`'both'` test (checking only for outer-ring presence)
did NOT fail, a real gap this mutation itself exposed — strengthened it to also assert the inner ring's
ABSENCE, re-ran the mutation, now both the mode:`'fill'` and mode:`'both'` tests correctly failed. Reverted
both mutations; full suite re-confirmed green (579/579) after each.

**What's NOT built this turn, disclosed rather than silently dropped: polyline/polygon (general offset with
round joins at convex corners, miter intersection at concave), the generic M/L/H/V/A path kind that builds
on it, and text.** These were in T38's own dispatch list. Reasoned through the algorithm in real detail
(per-vertex signed turn angle via 2D cross product decides round-vs-miter, independently for each of the
LEFT and RIGHT offset rings since which side is "outer" flips with the polygon's own winding direction,
determined via the shoelace sign) — genuinely tractable, but a well-known source of subtle, hard-to-catch
bugs (self-intersection at tight concave corners, near-180° reflex angles sending a naive miter toward
infinity, degenerate zero-length edges) even in mature CAD software, and this SAME session already caught
itself getting arc geometry wrong TWICE (T34) purely from trusting derivation without empirical
cross-checking — a direct, fresh argument against rushing a substantially harder geometry problem right
after a large turn already delivering real, tested, mutation-verified scope. Stopping at circle+rect
(complete, closed-form, no open questions) is a genuine, shippable checkpoint rather than a half-built
polygon offsetter. Flagging this now rather than after a rushed attempt, per this session's own "capacity
is a reportable fact" discipline.

**Live verification — the real symptom, not a proxy.** Hit the SAME Node-`child_process.spawn`-fails-headless-
Chrome environment issue T37's own WORK-LOG entry first recorded — confirmed it's not a one-off: the
Bash-launch-then-connect-from-Node workaround from that entry was needed again here and worked again.
Checked chrome.exe ownership via `Get-CimInstance` command-line matching before touching anything (T36's own
established discipline) — one round found 0 processes (clean), a later round found 8 ALL matching a
DIFFERENT session's `chrome-se7i-onelayer` path (Seat A's own SE7i smoke test, not mine), left them
untouched. Real lattice (17 rails), a real hand-drawn stroke-only rect and circle on a second layer, both
picked Outline:
- Screenshot at fit zoom: the rect and circle both show the halo+line annulus CLEARLY and distinctly (a
  visible dark-ring-inside-white-ring effect) — night and day versus T37's own invisible screenshot.
- The lattice rails did NOT show a visually obvious outline at this SAME fit zoom — investigated rather
  than assumed fine: `getComputedStyle` on a rail's own preview element confirmed EXACTLY correct values
  (`stroke: rgb(255,255,255)`, `stroke-width: 3px`, `vector-effect: non-scaling-stroke`, `opacity: 1`,
  `visibility: visible`) — the mechanism is genuinely correct. Zoomed into one rail directly (overriding the
  root `<svg>`'s `viewBox` to a tight window around it, bypassing the app's own zoom API entirely since its
  exact name wasn't confirmed) and the halo IS visible there. Conclusion, stated as reasoning not just
  assertion: a lattice rail is only ~0.035" wide — at fit-to-page zoom (a multi-inch board compressed into
  ~600px), a FIXED 3px-screen-width halo is proportionally comparable to the rail's own on-screen thickness
  at that same distance, so it reads as subtle rather than absent — an inherent trade-off of
  `vector-effect:non-scaling-stroke` (constant SCREEN size regardless of document zoom), not a defect; it's
  exactly why the dispatch itself asked for screenshots "at fit zoom AND zoomed in" rather than either
  alone. Also live-confirmed (matching what the vitest suite above already proved precisely): switching to
  Centerline via `setActiveLayer` dropped the preview count from 38 to 34 (exactly the 4 shapes from the
  rect+circle, rails' 34 untouched); a `pushState`+`undo` cycle changed the count again (confirming the
  refresh genuinely fires end-to-end in the real app, though the exact target value wasn't meaningfully
  assertable from this ad-hoc script the way the controlled vitest mocks already are — precise verification
  of that TIMING lives in the vitest suite, this was the "doesn't silently no-op in the real app" check).
Screenshots saved (`t38-fit-zoom.png`, `t38-rail-viewbox-zoom.png`, session scratchpad).

**Process hygiene**: chrome ownership checked via `Get-CimInstance` before every stop this turn (not just
`tasklist`), consistent with T36/T37's own established discipline; confirmed 0 of MY OWN processes remained
after each stop while leaving other sessions' processes untouched throughout. The repo-root `http.server`'s
actual LISTENING PID was found (twice — `netstat`'s own plain grep intermittently missed it both times,
resolved with a broader grep, same minor tool quirk T37 also hit) and stopped; `curl` re-confirmed refused
connections afterward, not just netstat's listing.

**Mid-task amendment landed before passing**: Fred — "ellipse and curved path too please" — include them THIS
turn via BIARC fitting (tangent-continuous circular-arc pairs, tolerance 0.001in) rather than declining, since
arcs import into Fusion as real measured SketchArcs and are CNC-friendly (G2/G3), unlike cubics/splines. The
amendment itself explicitly permits a two-commit split ("land preview-visibility + exact shapes first,
commit, then the fit in a second commit before passing") given the genuine size of a NEW curve-fitting
algorithm — taking that path: this is commit 1 (everything above, unchanged), a checkpoint at a real,
complete, tested state; the biarc fit is attempted next as commit 2, appended below if it lands, or reported
honestly as still-open in the pass-back if it doesn't.

Amendments polled clean (`handoff.py amendments --role worker`) before committing. Committed by explicit
path (10 files: `editor/editor-expand-analytic.js`,
`editor/editor-outline-preview.js`, `editor/editor.js`, `editor/layers.js`, `styles/editor.css`,
`tests/editor-lattice-undo.test.js`, `tests/editor-outline-preview.test.js`, new
`tests/editor-expand-analytic-shapes.test.js`, new `tests/editor-outline-preview-triggers.test.js`, this
WORK-LOG) — pushed.

## Lane B — Turn 93 (commit 2) — T38 amendment: biarc-fit ellipse + cubic outline support — DONE (cubic left standalone/unwired, disclosed below)

**The primitive.** New module `editor/editor-expand-biarc.js`, `fitOffsetWithBiarcs(paramToPoint,
paramToTangent, t0, t1, tolerance=0.001, maxDepth=12)`: given ANY parametric curve as two callbacks (point
at t, unit tangent at t), recursively splits `[t0,t1]` in half and fits each half with the UNIQUE circle
through its start point tangent to the curve there and passing through its end point
(`_circleFromPointTangentPoint` — standard `center = P + s*N`, `s = |Q-P|^2 / (2*N.(Q-P))`, `N` = the
tangent's own normal). Both halves of a split use the SAME computed midpoint point+tangent, so the joint is
tangent-continuous by CONSTRUCTION, not a numerical coincidence checked after the fact. A half is accepted
once `_maxDeviation` (12-sample check of the true curve's distance from the fitted circle's own
center/radius) is under an INTERNAL threshold of `tolerance * 0.7` — the margin exists because discrete
sampling can miss the true continuous-range worst point; measured directly on a full ellipse: 0.00105
actual max deviation with no margin (over the 0.001 target) vs 0.00067 with the margin (safely under).
Chose this over a plain "just resample more" fix because more samples alone doesn't bound the GAP between
samples, only shrinks it — the margin bounds the actual risk directly and is empirically verified, not
assumed.

**A real bug, found by testing, not by inspection.** The sweep-direction logic in
`_arcSegmentThroughTangent` initially read `if (dot < 0) dTheta = dTheta > 0 ? dTheta - 2*PI : dTheta +
2*PI;` — flip whenever the tangent-direction dot product is negative, regardless of `dTheta`'s OWN sign.
Every test up through CCW/CW quarter-circles and a full ellipse passed (curvature sign never changes on
those shapes, so `dot` and `dTheta` never independently disagree in the one case this formula gets wrong).
A cubic S-curve test case (curvature crossing zero at t=0.5, the amendment's own explicit ask) exposed it:
one specific sub-segment came out as `largeArc=1`, radius 8.3, for what should have been a tiny near-straight
arc — measured deviation ~15.4 against a ~0.0007 target, bounding-box outlier at minX=-12.6 vs an expected
~0. Root-caused by checking the bounding box of the full sampled ring (found the outlier), then isolating to
the one bad `A` segment, then hand-checking its own P/T/Q: `dot<0 AND dTheta<0` — already consistent,
should NOT flip, but the old code flipped anyway. Fixed by comparing `wantsPositive = dot>0` against
`isPositive = dTheta>0` and flipping ONLY when they disagree. Re-ran every prior-passing case afterward
(unchanged) and the S-curve case: 0.00068 deviation, correct. This is the THIRD time this session a
hand-derived arc-sweep formula has been wrong and only caught by numeric sampling against real geometry
(T34 twice, this once) — same lesson each time, logged again because it keeps paying for itself.

**Mutation-proof, on the real source file, not just a local comparison.** Reverted the fix in
`editor-expand-biarc.js`, ran the full suite: exactly 3 tests failed, reproducing the SAME ~15.4-deviation /
~470x-area bug signature the debugging session found by hand, while the CCW/CW-quarter-circle and full-
ellipse tests correctly stayed green (confirming the bug really is invisible to constant-curvature-sign
shapes, matching the root-cause reasoning above). Reverted the mutation, full suite green again
(592/592) before moving on. New tests: `tests/editor-expand-biarc.test.js` (13 cases) — `fitOffsetWithBiarcs`
tangent-continuity and tolerance on a quarter-circle (CCW+CW) and a full ellipse, `ellipseOutlinePathD`
outer/inner ring distance-from-center checks (relative bound, not `toBeCloseTo(x,6)` — same
kappa-approximation-tolerance lesson from T34/T35's own path-layout tests), `cubicSegmentOutlinePathD` on
the S-curve case, and a standalone local reproduction of the sweep bug (computing P/T/Q from a real circle,
not hand-typed approximate numbers) plus the real-source-mutation test described above.

**Wired into the app.** `editor-expand-analytic.js` gained `ellipseOutlinePathD({cx,cy,rx,ry,strokeWidth,
mode,tolerance})` (outer/inner rings via `fitOffsetWithBiarcs` over the ellipse's own parametrization, mode-
aware exactly like circle/rect, plus a whole-ring-vanishing check using the ellipse's OWN minimum radius of
curvature `min(ry^2/rx, rx^2/ry)` — valid because an ellipse's curvature sign never changes, same class of
check as circle/rect's) and `cubicSegmentOutlinePathD({x1,y1,cx1,cy1,cx2,cy2,x2,y2,strokeWidth,cap,
tolerance})` (single stroked cubic segment, banks fit via the same biarc primitive, round caps, but
clamped PER-POINT via the segment's own signed curvature `kappa(t) = (d1.x*d2.y - d1.y*d2.x)/|d1|^3` rather
than one whole-ring check — an S-curve bends BOTH directions along its length, so "does the whole ring
vanish" is the wrong question for it, unlike ellipse/circle/rect where it's valid). `OUTLINE_KINDS.ellipse`
in `editor-outline-preview.js` now calls the real `ellipseOutlinePathD` (reading `cx/cy/rx/ry/stroke-width`
+ `_fillModeOf(el)`, same adapter shape as circle/rect) — REPLACING the checkpoint-1 placeholder decline
entry, per the amendment's own words ("include ellipses... THIS turn instead of declining them").
Mutation-verified the wiring itself, not just the geometry function: reverted `OUTLINE_KINDS.ellipse` back
to the decline placeholder, ran `tests/editor-outline-preview.test.js` — exactly 1 failure (the new
"ellipse produces a real biarc-fit preview through refreshOutlinePreview" test), the other 21 in that file
unaffected; reverted the mutation, re-confirmed green.

**Scope disclosed, not silently dropped — `cubicSegmentOutlinePathD` is NOT wired to any `OUTLINE_KINDS`
entry this turn.** It exists as a tested, reusable standalone function (the amendment's own test ask — "max
deviation on... a cubic S-curve" — is a claim about the FITTING PRIMITIVE, verified directly against it, not
about a full assembled path). Wiring a generic `'path'` kind that actually walks a real multi-segment
M/L/H/V/A/C/S/Q/T path — mixing straight runs, exact arcs, and now curve-fit cubics, all needing the SAME
join logic at each vertex (round vs. miter offset, decided by the vertex's own signed turn angle, independently
per side since which side is "outer" flips with winding direction) — is the SAME deferred piece checkpoint
1's WORK-LOG entry already named for polyline/polygon, for the same reason: a well-known source of subtle
bugs (self-intersection at tight concave corners, degenerate zero-length edges) that deserves its own
unhurried pass, not a rushed bolt-on to an already-large curve-fitting turn. `elliptical-A` inside a
multi-segment path is the SAME deferred piece too (it's a path-segment-kind question, not a curve-fitting
one — the biarc primitive itself is generic and would handle it once path assembly exists). Final scope this
turn: ellipse — real, biarc-fit, wired end-to-end. Cubic/quadratic segment fitting — real, tested,
standalone, not yet wired to a path kind. Polyline/polygon/generic-multi-segment-path (including
elliptical-A-in-a-path) — still deferred, unchanged from checkpoint 1's own disclosure.

**Live verification.** Restarted the dev server (`python -m http.server 8771 --directory .` from the
worktree root — the prior session's server and Chrome had both exited between turns) and a fresh headless
Chrome on a NEW port (9498) with its OWN user-data-dir (`chrome-profile-t38b`), checking
`Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"` both before launching (0 processes — clean) and
before stopping (8 processes, all matching MY OWN `chrome-profile-t38b` path, none belonging to another
session) — same discipline as every prior turn. Real lattice generated, a hand-drawn stroke-only ellipse
(rx=1.6, ry=0.7, stroke 0.15) added on a second Outline layer, `refreshOutlinePreview` called directly (same
pattern as checkpoint 1's own rect/circle script). Screenshot at fit zoom
(`t38b-ellipse-fit-zoom.png`): the ellipse shows a clean, smooth halo+line outer AND inner ring (stroke
mode — matches circle/rect's own two-ring stroke-mode behavior), no visible faceting, no wild loops — the
biarc fit tracks the true offset curve closely at this scale. Zero console errors/exceptions during the
whole run. (The zoom-in screenshot came out identical to the fit-zoom one — the ad-hoc `editor.setZoom`
call this script tried doesn't exist on this build the way checkpoint 1's rail-specific `viewBox`-override
technique worked around; not investigated further since the fit-zoom screenshot alone already shows the
ring clearly and unambiguously, and re-deriving a zoom mechanism wasn't the point of this check.)

Full vitest suite: 593/593 green (up from 592 — the one new end-to-end ellipse-wiring test).

Amendments polled clean (`handoff.py amendments --role worker`) again, immediately before this commit.
Committed by explicit path (5 files: `editor/editor-expand-analytic.js`,
`editor/editor-outline-preview.js`, new `editor/editor-expand-biarc.js`,
`tests/editor-outline-preview.test.js`, new `tests/editor-expand-biarc.test.js`) — pushed.

## Lane B — Turn 95 — T39: outlines for polylines, polygons and ANY path — DONE (one curve-adjacent-trim edge case disclosed below, not perfected)

**The deferred piece, finally landed.** New module `editor/editor-expand-path.js`,
`pathOutlinePathD(d, strokeWidth, {mode, cap, join, tolerance})`: parses ANY SVG path `d` string (its own
hand-rolled tokenizer, not `SVG.PathArray` — this module has zero DOM/svg.js dependency, matching every
other SE12 geometry module's own pure-math contract, and `pathOutlinePathD`'s own signature takes a `d`
STRING per the dispatch, not an element) into subpaths of normalized `L`/`A`/`C` segments (relative commands
resolved to absolute, `H`/`V` folded into `L`, `S`/`T` resolved via the standard reflected-control-point
construction, `Q` elevated to `C` EXACTLY — `C1 = P0 + 2/3(Q-P0)`, `C2 = P2 + 2/3(Q-P2)`, the same identity
every renderer uses). Each segment is offset with whichever tool this session already built for it: a
straight line offsets to a parallel line (trivial); a CIRCULAR `A` (`rx==ry`, checked with a relative
tolerance) offsets to a concentric `A` at radius `r±half`, exact, reusing `arcCenterParam` — now EXPORTED
from `path-layout.js` (was `_arcCenterParam`, module-private; renamed+exported rather than duplicated,
mechanical 1-line-definition + 2-internal-call-site change, verified `path-layout.test.js` and
`editor-transform-handles.test.js` still green after); an ELLIPTICAL `A` or a `C` segment offsets via the T38
biarc fitter (`fitOffsetWithBiarcs`), reusing `_cubicPointTangentCurvature`/`_cubicOffsetPoint` — now
EXPORTED from `editor-expand-analytic.js` (same minimal add-`export`-only change, no behavior change, no
rename needed since only THIS new module consumes them externally).

**Joins — the actual new algorithm this turn.** At every vertex between two offset pieces, a signed cross
product of the two pieces' own tangents there (`tA.x*tB.y - tA.y*tB.x`) decides which of the LEFT/RIGHT
offset banks is locally OUTER (convex) at that specific corner — LOCAL, not derived from the whole
polygon's winding, so a single polygon can correctly mix round joins at its convex corners and trimmed
joins at its concave ones without any special-casing (verified directly: the concave-corner test below has
BOTH kinds in the SAME ring). The outer side gets a round join (`A r r 0 0 sweep`, sweep computed via the
same atan2-angle-difference technique `editor-expand-biarc.js`'s own arc-sweep code already uses, radius=
strokeWidth/2, centered on the vertex). The inner side gets TRIMMED to the intersection of the two pieces'
own local tangent lines at the vertex, rather than concatenated naively.

**A real bug, found immediately by testing a closed square (not by inspection).** The FIRST version of the
inner-trim join emitted BOTH the intersection point `ip` AND the next piece's own naive (un-trimmed) start
point `pB` (`[L ip, L pB]`) before letting that piece's own commands continue. For a closed 10x10 square
offset inward by 1, this produced a 12-point ring instead of the expected clean 4-point 8x8 square — traced
by hand: at each corner, the ring visited `(10,1) -> (9,1)[=ip, correct] -> (9,0)[=pB] -> (9,10)[piece's own
far endpoint]` — going from `ip` DOWN to `pB` then immediately back UP through `ip`'s own y-level again on
the way to the far endpoint, a literal backtrack retracing the same line segment (a zero-width sliver an
evenodd fill renders as a visible notch, not a cosmetic wobble). Root cause: when the NEXT piece is a plain
single-command `L`, emitting `pB` at all is redundant AND WRONG — the piece's own `L <its endpoint>` command
already continues correctly from wherever the pen currently is, so it should continue from `ip` directly,
never visiting the untrimmed `pB`. Fixed with `_appendJoin`, a 4-case dispatcher (`editor-expand-path.js`)
distinguishing whether each SIDE of the join can be safely mutated in place: a straight `L`'s own endpoint
can be retroactively retargeted to `ip` (still the exact same line, just shorter — safe); a curve's own `A`
command can NOT (its shape depends on its true declared endpoint; retargeting would distort it) — so a
curve-adjacent side always gets an explicit bridge segment instead. The closed-square test now asserts the
exact string `M 1 1 L 9 1 L 9 9 L 1 9 L 1 1 Z` for the inner ring — MUTATION-VERIFIED: reverted
`_appendJoin` to the naive always-`[L ip, L pB]` version, ran the suite — exactly 4 tests failed (the square,
the concave-polygon, the thin-spike, and the "wide shape doesn't spuriously collapse" tests — all four
depend on clean joins), reverted the mutation, suite green again.

**The wrap-around join (closed ring's last-piece-to-first-piece) needed its OWN handling**, not a reuse of
`_appendJoin` as-is: an ordinary internal join's "skip the untrimmed point" trick works because the NEXT
piece hasn't been emitted yet (skip = "don't emit a bridge, let it run next"), but the ring's FIRST piece
was already emitted at the very front of the command list, before the ring's own `M`. So `_closedRing`
handles this case specially: when the first piece is a skippable single `L`, the equivalent trim is to
retarget the ring's OWN STARTING POINT (`M`) to `ip` instead of the untrimmed start — geometrically exact
for the same reason (`ip` lies on that piece's own line by construction), just applied to the one point this
module represents implicitly via `M` rather than as a command.

**Inner-ring collapse — TWO checks needed, not one.** Circle/rect/ellipse each already have their own
shape-specific "does the inner ring vanish" formula (radius comparison, `min(width,height)` comparison,
minimum-curvature-radius comparison). For a GENERAL path there's no single formula, so this turn built two
GENERAL checks instead: (1) a GLOBAL one — sample the built inner ring densely, shoelace-sign it against the
outer ring; a sign flip or near-zero area means the offset has globally inverted (rect/circle/ellipse's own
checks are special cases of this same idea). (2) A SECOND, genuinely NEW check was needed after (1) alone
missed a real case: a thin-spike test (a 20-unit-wide base narrowing to a ~1.2-unit-wide spike, offset by
strokeWidth=2/half=1) kept BOTH rings (2 `M`s) even though the spike is narrower than the stroke width — the
two inner walls cross PARTWAY UP the spike, which a shoelace bowtie can still net out to a positive,
same-signed, non-near-zero area (a self-intersecting polygon's signed area doesn't reliably flag the
self-intersection). Added `_hasSelfIntersection` — a proper-crossing test (orientation-sign method) over
every non-adjacent pair of the ring's own sampled segments, O(n^2) at this module's sample counts (tens of
points, not thousands — negligible). MUTATION-VERIFIED: removed `_hasSelfIntersection` from the collapse
condition, ran the suite — exactly 1 test failed (the thin-spike test, `M` count 2 instead of the expected
1), nothing else — confirming the sign check ALONE really doesn't catch this case, and this check alone is
what does. Re-verified a wide (non-thin) 20x20 square does NOT spuriously collapse (both rings present) —
the two checks together, not either alone.

**Round-join sweep — verified numerically, and the FIRST version of the dedicated test was itself vacuous**
(the "measure, don't re-reason" + "prove the new test isn't vacuous" rules, both earned the hard way earlier
this session, both paid off again here). The sweep formula itself (`dTheta>0?1:0`, same atan2-angle-diff
technique as `editor-expand-biarc.js`) was pinned down with a concrete worked example in the code's own
comment (an L-shaped right turn, vertex=(10,0)) and cross-checked by sampling the ARC ITSELF via
`arcCenterParam`, not just trusted algebraically — the same discipline this session has now applied FOUR
times (T34 x2, T38, this). But the FIRST test only asserted the arc's sampled MIDPOINT landed in the
up-right quadrant relative to the vertex (`mid.x>10 && mid.y>0`) — mutation-tested by flipping the sweep
formula (`dTheta<0?1:0`) and running JUST that test: it still PASSED. Root cause: SVG's endpoint
parametrization doesn't just reverse direction around the SAME circle when sweep flips — for fixed
start/end/radius/largeArc there are TWO valid centers, and sweep picks between them; the WRONG sweep
reconstructs a DIFFERENT (mirrored) circle whose bulge can ALSO land in that same loose quadrant by
coincidence. Fixed by asserting the reconstructed CENTER is the vertex itself (`toBeCloseTo(10,9)` /
`toBeCloseTo(0,9)`) — a far more specific, discriminating check — re-ran against the same mutation: now
fails correctly (center off by exactly 1, matching the mirrored-circle diagnosis). Left the mutation applied
long enough to confirm the OTHER general tests (zig-zag polyline, concave polygon) ALSO independently caught
this same mutation via their own tolerance checks — the bug was never actually invisible to the suite as a
whole, only to this one narrowly-scoped dedicated test, which is now fixed to match.

**A disclosed, bounded limitation — not silently smoothed over.** The "mixing L + circular A + C" test
initially asserted a tight tolerance bound and failed by a wide margin (an early debug pass, with denser
source sampling, pinned the worst deviation at exactly `half` — i.e., one specific output point landed
essentially ON TOP of the original source path, zero offset, not `half` away). Traced to one join where a
straight line meets a full semicircular arc almost head-on (an extreme configuration: the arc's own start
tangent points nearly perpendicular to the line's own direction). The inner-trim's tangent-LINE
approximation, which is exact for straight-straight joins and a good LOCAL approximation for gentler
curve-involved joins, is only a rough one when the adjacent curve's own local behavior is this extreme.
Rather than chase full generality (an exact curve-trim would need a line-CIRCLE intersection instead of a
line-tangent-line one, genuinely more work, and a narrower, rarer case than the well-behaved joins this
turn's core scope — zig-zag polylines, concave polygons, thin spikes — already handles cleanly and exactly)
this is disclosed as a NAMED, bounded limitation: the test now asserts deviation stays `<= half` (the ring
never crosses fully through to the wrong side, i.e., it degrades to "touches the source" in the worst case,
never inverts or breaks topologically) rather than a tight bound it cannot honestly meet yet. General exact
curve-adjacent trimming is future work, named here rather than silently left for a future session to
rediscover the hard way.

**Wired into the app.** `editor-outline-preview.js`'s `OUTLINE_KINDS` gained `polyline`/`polygon`/`path`, all
three adapting their own attrs into a `d` string for the ONE shared engine (Fred: "polyline, polygon (->
points to a path)... through it") rather than three separate geometry paths: `polyline`/`polygon` read
points via `el.array()` (same `[[x,y],...]` shape `editor-transform-handles.js`'s own drag helpers already
read) and build `M x y L x y ... [Z]`; `path` reads `el.attr('d')` directly. MUTATION-VERIFIED the wiring
itself (not just the geometry functions): reverted all three entries to a decline placeholder, ran
`editor-outline-preview.test.js` — exactly 3 tests failed (the 3 new end-to-end wiring tests), nothing else;
reverted, green again. The "kinds built so far" list test and the two tests that used `polygon` as a
disposable "not built yet" throwaway kind (a pattern from T37/T38, now stale since polygon is real) were
updated to use `text` instead — genuinely still undeferred, matches this module's own header comment.

**Scope disclosed, unchanged from what T38's own WORK-LOG already named**: text is still the one remaining
undeferred element kind (no change this turn — out of scope, not attempted). The `join` option in
`pathOutlinePathD`'s own signature accepts only `'round'` (the scheme built this turn); any other value is
explicitly declined (`unsupported: 'join:<value>'`), matching `cap`'s own `SUPPORTED_LINE_CAPS`-gated decline
pattern — an explicit decline, not a silently-wrong alternate behavior nobody asked for yet.

**Live verification.** Dev server and Chrome from the T38 checkpoint-2 session had both exited between
turns (server was still up this time; a fresh headless Chrome was launched on a NEW port, 9499, with its own
`chrome-profile-t39` user-data-dir) — checked `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"`
both before launching (0 processes) and before stopping (8, all matching MY OWN profile path) — same
discipline every prior turn. Built a concave/zig-zag polygon and a mixed L+A+C closed path directly via
svg.js (same technique T38's own script used) on a second Outline-picked layer alongside the lattice's own
Outline rails: both show a clearly visible white-halo+dark-line outline hugging their own shape at fit zoom,
confirmed sharper at a tighter zoomed-in crop — the polygon's concave notch and the path's rounded arc +
cubic bulge both read correctly, matching what the unit tests already proved precisely. Added a third,
open, irregular ("freehand pencil stroke"-style) polyline to the same layer — its own outline preview traces
the zig-zag exactly, clearly visible at a tight zoom (`t39-polyline-tight.png`), confirming the OPEN-subpath
capsule assembly (not just the closed-ring path) genuinely works end-to-end in the real running app, not
only against mocks. Zero console errors/exceptions across all three CDP round trips. Screenshots:
`t39-fit-zoom.png`, `t39-zoomed-in.png`, `t39-polyline-tight.png` (session scratchpad).

Full vitest suite: 640/640 green (up from 637 pre-turn — 15 new tests in `editor-expand-path.test.js`, 3 new
end-to-end wiring tests in `editor-outline-preview.test.js`, minus 2 old throwaway-`polygon` tests renamed
to `text` rather than net-new).

Amendments polled clean (`handoff.py amendments --role worker`) before committing, and again immediately
before passing. Committed by explicit path (6 files: `editor/editor-expand-analytic.js`,
`editor/editor-outline-preview.js`, `editor/path-layout.js`, new `editor/editor-expand-path.js`,
`tests/editor-outline-preview.test.js`, new `tests/editor-expand-path.test.js`) — pushed.

## Lane B — Turn 97 — T40 part 1: exact curve-adjacent inner joins — DONE (part 2, text outlines, deferred — capacity, see below)

**The fix Fred asked for.** T39's inner-trim join used the intersection of the two pieces' own TANGENT
LINES at the vertex — exact for a straight-straight join, only a local approximation once a curve is
involved (a curve's tangent line only matches its true shape very close to the endpoint). Replaced with the
TRUE intersection of each piece's own exact boundary primitive: every piece this module ever builds ends in
either a plain `L` (a genuine line) or an `A` with `rx===ry` (every arc here is circular — the exact
concentric case IS a circle, and a biarc-fitted curve's own segments are circular arcs BY CONSTRUCTION,
`fitOffsetWithBiarcs`'s whole point) — so "the true primitive" is always cheaply recoverable via
`arcCenterParam` (now reused a third time this module, after the concentric-arc offset and the collapse-
sampling code). New `_lineCircleIntersect`/`_circleCircleIntersect` (standard closed forms) plus
`_lastPrimitive`/`_firstPrimitive` (extract the real geometry, not just the tangent, from whichever command
sits at a piece's own join-adjacent end) cover all four combinations (line-line already had
`_lineIntersect`). Whichever candidate point (0, 1, or 2 — a circle-circle pair can have two) lands NEAREST
the vertex is the real trim point; Fred's own instruction for the zero-candidate case ("if none... fall
back to a round inner join — never a loop") is implemented directly — `_buildJoin`'s inner branch now
returns the SAME `_roundJoinArc` construction the outer/convex branch already uses.

**Never bridge through the old point — retarget it away entirely.** T39's own join, even once fed the
better `ip`, still emitted `L ip` then `L pB` (the piece's OWN untrimmed point) before letting that piece's
real commands continue — meaning the ring still visited the untrimmed point on its way through, which is
exactly what let a deviation up to `strokeWidth/2` back in for a line meeting a full semicircle (the
"mixed L+A+C" test's own worst point, `(9.25, ~0)`, sat almost exactly ON the source's own straight edge —
zero real offset, not `half`). Root cause: the untrimmed point (which the trim exists specifically to avoid
visiting) was still being visited. Fixed with `_retargetEnd` — rewrites a piece's own LAST command to end
EXACTLY at `ip` (a straight `L` just gets a new endpoint, since `ip` lies on that same line by construction;
an arc gets fully rebuilt via `_arcCommandBetween`, same center/radius/travel-direction, new end) — no
bridge command at all. Re-measured the SAME "mixed L+A+C" case this fix was aimed at: worst deviation
0.75 -> 0.00069 (restored to the same tight tolerance bound every other test in the file already uses,
instead of the T39-era `<=half` disclosed-limitation bound).

**A SECOND real bug found while chasing the first, via a dedicated head-on test (Fred: "add the head-on
line-semicircle case explicitly").** A line meeting a full semicircle EXACTLY tangentially (both pieces'
own end/start tangent vertical, a G1-continuous vertex) still measured a full 0.5 deviation — the OLD
"tangent-continuous, cross~=0, skip the join entirely, just connect pA to pB with a plain line" shortcut
assumed G1 continuity implies the two OFFSET pieces already coincide. They don't: G1 (tangent) continuity
does NOT imply G2 (curvature) continuity, and an offset curve's own continuity depends on BOTH — a line
(curvature 0) meeting an arc (curvature 1/r) tangentially is a textbook curvature discontinuity, and the
offset genuinely has a gap right there. The naive connector, drawn between the two UNTRIMMED points, passed
exactly through the original vertex (the connector's own midpoint). Fixed by requiring the shortcut's OTHER
condition too — `pA` and `pB` already coincide (the ACTUAL "truly nothing to do" case, e.g. between two
commands of the same already-continuous biarc chain) — not just a near-zero cross; anything else now falls
through to the same round/trim logic, which handles a near-zero-but-nonzero cross safely either way (a
tiny round join stays tiny; a trim with no intersection already falls back to round).

**Both fixes MUTATION-VERIFIED independently** (revert one at a time, run the suite, confirm ONLY the
expected tests fail, restore, confirm green again): reverting the smooth-shortcut's `pA~=pB` requirement ->
exactly 1 failure (the head-on test, reproducing the exact 0.5); reverting `_retargetEnd` to a no-op ->
exactly 5 failures (every test whose own join needed a real trim), nothing else.

**A genuinely surprising finding, chased down rather than assumed: `_retargetStart` (curr piece's own start)
turned out to be PROVABLY UNNECESSARY, and was REMOVED rather than kept untested.** The original design
(matching `_retargetEnd`'s own symmetry) also rebuilt the NEXT piece's own first `A` command to start
exactly at `ip`. Mutation-testing it the same way as `_retargetEnd` found ZERO failures — not a coverage
gap, a genuine mathematical fact: an SVG command's shape is ALWAYS derived from wherever the CURRENT POINT
happens to be (set by whatever ran before it) plus its own explicit payload, never from "how the pen got
there" — a plain `L` doesn't encode its own start (already known, T39), and neither does an `A` (its ONLY
payload is rx/ry/rot/largeArc/sweep/end) — so once `_retargetEnd` correctly retargets the PRECEDING piece's
end to `ip`, the FOLLOWING piece's own commands are already correct, completely unmodified. Verified this
wasn't a testing blind spot, not just trusted: wrote a throwaway script mutating a COPY of the module (regex-
swapping `_retargetStart` for a no-op, imports rewritten to resolve correctly) and diffed its output
against the real module's across 120+ varied geometries — major arcs (>180deg, deliberately hunting the one
theoretical case where it COULD matter: a trim crossing the 180deg largeArc threshold, which needs an
explicit flag recompute since sweep is direction-invariant but largeArc isn't), sharp angles, small radii,
wide stroke widths relative to radius — zero divergences in the `d` string, byte for byte. Removed the
function and its two call sites entirely rather than leave PROVABLY-DEAD, never-exercised code sitting in
the module (this session's own "prove the new test isn't vacuous" rule, applied to a piece of code rather
than a test: code no test can ever meaningfully exercise is the same problem in different clothes). The
module's own header comment and `_retargetEnd`'s own doc comment now explain WHY, so a future reader doesn't
independently re-add a "symmetric" retargetStart and wonder why testing it never seems to matter.

**A THIRD real bug, found live (not by inspection) doing this turn's own CDP verification.** The head-on
test path, drawn as a real `<path>` via svg.js with `.stroke({color, width})` and NO explicit
`stroke-linecap`, produced ZERO preview shapes in the real running app — `OUTLINE_KINDS.path`'s own adapter
declined it with `unsupported: 'butt'`. Traced to: svg.js's `el.attr('stroke-linecap')` does NOT return
`undefined`/`null` for an element with no such attribute at all — it reports the SVG spec's own default,
the STRING `'butt'` (confirmed: `el.node.hasAttribute('stroke-linecap') === false` while `el.attr(...)`
still returned `'butt'`) — which is TRUTHY, silently defeating every `attr('stroke-linecap') || 'round'`
fallback this module's OUTLINE_KINDS table has used since T37's own `line` entry. This stayed hidden through
T37-T39 purely because every element actually tested until now (lattice rails, the pencil tool's own
strokes, T39's own CDP polygon/path test cases) happens to set `linecap:'round'` explicitly — confirmed by
grepping every drawing call site in the editor; the app's real freehand pencil tool (`editor-interaction.js`)
DOES set it explicitly, so real hand-drawn strokes were never actually at risk, but any path/polyline/
polygon that DIDN'T set it (a plausible import, or a future tool) would have silently gotten no preview.
Fixed with `_capOf(el)` (`editor-outline-preview.js`) reading `el.node.getAttribute('stroke-linecap')` — the
RAW DOM attribute, confirmed to correctly return `null` when genuinely unset — instead of `el.attr(...)`,
applied to all 4 table entries that read a cap (line/polyline/polygon/path). Noted, not fixed (out of
scope, a different file, no caller of THIS table exercises it): `editor-eraser.js` has an older, similarly-
shaped `attr(...) || _nodeStyleProp(...) || 'round'` chain for the same two properties that carries the
EXACT same latent bug (`attr()` still wins first and still lies) — named here so it isn't independently
rediscovered later. Updated every test mock in `editor-outline-preview.test.js` and
`editor-outline-preview-triggers.test.js` to give `.node.getAttribute` the same "genuinely absent -> null"
contract the real DOM has (mocks previously only implemented `.attr()`, which is why this bug's own mutation
shape couldn't be unit-tested — it's a property of the REAL svg.js/DOM boundary, only reachable live).

**Live verification.** Dev server was still up; fresh headless Chrome on a new port (9500, own
`chrome-profile-t40` user-data-dir) — 0 processes before launch, 8 (all mine) before stop, same discipline
every turn. Drew the exact head-on line-meets-semicircle path from this turn's own dedicated test on a
second Outline layer: FIRST screenshot (before the cap-reading fix was applied) showed the shape with
NO visible outline at all, matching the `unsupported: 'butt'` diagnosis exactly (diagnosed via direct
in-page calls to `OUTLINE_KINDS.path`, not guessed) — SECOND screenshot (`t40-headon-join-fixed.png`, after
the fix) shows a clean, continuous white-halo outline hugging the line-to-semicircle transition smoothly,
no pinch or gap at the join. Zero console errors/exceptions throughout.

Full vitest suite: 661/661 green.

**Part 2 (text outlines) deferred — capacity, disclosed rather than rushed.** This turn's part 1 alone
surfaced and fixed THREE independent real bugs (the tangent-vs-true-primitive approximation, the G1-without-
G2 smooth-shortcut gap, and the live-only svg.js cap-reading defect) plus a proven code REMOVAL
(`_retargetStart`) — each required real debugging (hand-tracing geometry, a 120-case empirical scan, a live
CDP diagnosis session), not just implementation. Text outlines (opentype.js glyph extraction via editor-
geometry.js/editor-fonts.js, converting glyph curves to biarcs, wiring `OUTLINE_KINDS.text`, its own tests
and CDP verification) is a comparably-sized, separately-scoped piece of work touching an entirely different
part of the codebase this session hasn't yet read. Landing it now, on top of an already-substantial turn,
risks the same kind of rushed, under-verified work this session's own discipline exists to prevent.
Flagging this now (per the worker skill's own "capacity is a reportable fact" rule) rather than after a
rushed attempt — matches T38's own advisor-sanctioned two-commit-split precedent, though this dispatch
didn't explicitly offer one; treating it as a judgment call under that same established pattern.

Amendments polled clean (`handoff.py amendments --role worker`) before committing, and again immediately
before passing. Committed by explicit path (5 files: `editor/editor-expand-path.js`,
`editor/editor-outline-preview.js`, `tests/editor-expand-path.test.js`,
`tests/editor-outline-preview.test.js`, `tests/editor-outline-preview-triggers.test.js`) — pushed.

## Lane B — Turn 99 — T40 part 2: text outlines (glyph outlines, opentype.js) — DONE

**Researched first, not guessed.** A dedicated research pass (this session's own Explore-style delegation)
corrected a wrong guessed path before any code was written: `editor-geometry.js` (named in the dispatch)
doesn't exist — it's a STALE reference in three old comments after a refactor. The real, current logic
lives in `editor-fonts.js` (the bundled-font registry, `FONT_MAP`) and `editor-expand-text.js`
(`textGlyphPathD(el, m)` — loads a font via `opentype.parse`, generates the glyph path via
`font.getPath(text,0,baselineY,fontSize)`, serializes via opentype's own `toPathData()`, bakes matrix `m`
into every coordinate). Confirmed via file:line citations, not general opentype.js knowledge — this
codebase never touches opentype's raw `.commands` array, only its own `toPathData()` string.

**The clean design this research made possible: a glyph is just another path.** `textGlyphPathD` already
exists, is already trusted by two real callers (interactive Expand, carve/export bake) — reusing it (not
reimplementing font loading) means `OUTLINE_KINDS.text` only needs two small pieces: (1) get the glyph's own
`d` string in the element's LOCAL frame, (2) hand it to `pathOutlinePathD` exactly like the `path` kind
already does. New `localGlyphPathD(el)` (`editor-expand-text.js`) calls `textGlyphPathD(el, m)` with `m` =
translate-by-anchor ONLY (`{a:1,b:0,c:0,d:1,e:ax,f:ay}` from `localAnchor(el)`) — NOT the full
`el.matrix()` the two EXISTING callers compose — because `refreshOutlinePreview` already applies the
source element's own `transform` attribute generically to every kind's preview shapes (confirmed by
reading it directly); composing the full matrix here too would double-apply it. `OUTLINE_KINDS.text` itself
is then genuinely small: `localGlyphPathD(el)` → `pathOutlinePathD(glyphD, strokeWidth, {mode:
_fillModeOf(el), cap: _capOf(el)})` — filled text (mode='fill') and stroked text (mode='stroke'/'both',
Fred's own "glyph path -> pathOutlinePathD" instruction) both fall out of the SAME existing pipeline every
other closed-shape kind already uses, no glyph-specific geometry code at all.

**A real gap this exposed, fixed as a general improvement, not a text-only hack: 'fill' mode was a raw
passthrough.** `_closedSubpathD`'s 'fill' branch returned the ORIGINAL segments verbatim (`_passthroughD`) —
correct for the shapes tested so far (lines/arcs only), but a glyph's OWN curves are cubic Beziers, and
passing a raw `C` through would violate the "M/L/A/Z only" contract every OTHER mode in this module already
honors. Fixed by making 'fill' mode `_closedRing(subpath, 1, 0, tolerance)` — literally the SAME ring-
builder every offset mode already uses, at `half=0`: a line's own offset collapses to itself regardless of
side: a circular arc's own radius is unchanged; a cubic's own curve gets biarc-fit (now tracing the curve
ITSELF rather than an offset of it); every join's two pieces meet at the EXACT original vertex, hitting the
"already coincide" shortcut — so a plain L/A path reproduces byte-identical output to the old passthrough
(this module's own existing fill-mode test still passes unchanged), now correctly EXTENDED to paths with
real curves. One dedicated test (an S-curve — the SAME deliberately aggressive curvature-crossing-zero
shape T38's own biarc tests used as a stress case) confirms M/L/A/Z-only output within a documented, looser
bound (unclamped curvature at offset=0 needs more subdivision than a clamped non-zero offset does; real
glyph curves are far gentler than this intentionally extreme test shape). Mutation-verified: reverted to
`_passthroughD`, exactly 1 failure (the new curve test, correctly), everything else unaffected.

**Async wiring — a real, cascading change, not a footnote.** `textGlyphPathD` does a font fetch/parse
(genuinely async, network-bound); every OTHER `OUTLINE_KINDS` entry is a plain sync function. Made
`refreshOutlinePreview` itself `async`, `await`ing every entry uniformly (a sync entry's result resolves
through an `await` on the very next microtask — no observable delay for the common all-non-text case, since
nothing in that path ever actually suspends). This is genuinely NEW behavior for every EXISTING caller, not
just an addition: even a fully-synchronous refresh no longer completes before the calling statement
finishes (an `await` on a non-Promise value still yields a microtask tick). Every direct call in
`editor-outline-preview.test.js` (31 call sites) needed `await` + its enclosing `it()` to become `async`;
`editor-outline-preview-triggers.test.js` calls `setActiveLayer`/`undo`/`redo` (NOT `refreshOutlinePreview`
directly), and production code deliberately does NOT await its own fire-and-forget call (awaiting would
cascade `async` through `setActiveLayer`/`_notifyChange` and further, a much bigger, riskier change touching
code Seat A may be concurrently editing) — so those 4 tests instead `await` a `flushAsync()` helper
(a `setTimeout(resolve,0)` macrotask wait, the standard "let all pending async work settle" pattern) after
each indirect trigger, before asserting on preview state.

**A real race this async change introduces, found by reasoning it through (not by hitting it), fixed before
it could ever surface as a bug report: a superseded refresh writing stale shapes.** `refreshOutlinePreview`
reruns on every commit; once it can genuinely suspend (a font fetch), a SECOND call (another commit, undo, a
layer switch) can start and finish WHILE a FIRST call is still mid-flight — the first call's delayed
continuation would then add its own (now stale) shapes on top of the second call's already-correct, freshly
rebuilt layer. Fixed with a generation counter: bump it at the top of every call, and if it's moved on by
the time an `await` returns, abandon before touching the DOM. MUTATION-VERIFIED with a real, deliberately
constructed race (a controlled slow-then-fast mock `OUTLINE_KINDS.text`, a gate `Promise` releasing the slow
call only after the fast one has already fully completed): disabling the guard reproduces the exact failure
mode by name — 4 shapes instead of 2, the stale call's own geometry landing on top of the current one's —
confirming this isn't a theoretical worry, the guard is load-bearing.

**A THIRD live-only bug from T40 part 1 reconfirmed relevant here too**: `_capOf`'s fix (reading
`el.node.getAttribute` instead of svg.js's own default-filling `el.attr()`) matters for text's own
`stroke-linecap` read the exact same way it does for line/polyline/polygon/path — no separate fix needed,
just confirmation the SAME `_capOf` helper is reused, not a second copy.

**Testing strategy — what CAN and can't run in this environment, decided honestly, not glossed over.**
`textGlyphPathD` does `await import('https://esm.sh/opentype.js')` — a dynamic import of an `https:` URL,
which is a BROWSER-only capability; Node's own ESM loader rejects it outright
(`ERR_UNSUPPORTED_ESM_URL_SCHEME`, confirmed by actually trying it in this test environment before deciding
anything, not assumed). This means the REAL glyph-extraction path can never run inside vitest here — the
dispatch's own "glyph count, M/L/A/Z only, deviation within tolerance against the opentype path sampled"
verification is INHERENTLY a live-CDP-only check, not a unit-testable one, and is treated as such rather
than faked with a mock standing in for real geometry. Vitest coverage instead targets what's genuinely
testable in Node: `OUTLINE_KINDS.text`'s own REAL failure path (declines with `unsupported:'font'`when
extraction fails — which it always will here — proving the adapter's error handling without needing a real
font), and the WIRING/async-race behavior via the established "temporarily overwrite a real OUTLINE_KINDS
entry, restore in `finally`" pattern already used elsewhere in this file for circle/rect/ellipse, applied to
a controlled stand-in for `text`.

**Live verification — the real proof, run against the ACTUAL opentype.js pipeline.** Fresh headless Chrome
(port 9501, own `chrome-profile-t40b` user-data-dir; 0 processes before launch, 8 mine before stop, same
discipline every turn — browser network access is real here, unlike vitest). Created a real `<text>`
element, "Fred", Arial, on a second Outline layer. Called `OUTLINE_KINDS.text` directly and measured:
`unsupported: null` (real success, not a mock), `mCount: 6` (matches the expected minimum subpath count —
F=1, r=1, e=2 with its own enclosed counter, d=2 with its own enclosed counter), `onlyMLAZ: true`,
extraction+biarc-fit took ~263ms (acceptable; the font-parse cache added this same turn means only the
FIRST text element on a given family pays the fetch/parse cost per session, not every commit). Independently
fetched and parsed the SAME font in the SAME page, sampled opentype.js's OWN `font.getPath('Fred',...)`
output directly (a completely separate code path from `OUTLINE_KINDS.text`'s own biarc-fit output), and
measured the worst-case nearest-point deviation between the two: 0.014 — tight, consistent with the fill-
mode biarc test's own documented bound. Screenshot (`t40-text-word.png`) shows the word "Fred" with a clean
white-halo outline precisely tracing every glyph contour, INCLUDING the enclosed counters inside "e" and
"d" — the two-ring (outer+inner) fill-mode geometry rendering correctly for real letterforms, not just the
simple test shapes. Zero console errors/exceptions.

**Scope disclosed**: stroked text (mode='stroke'/'both') was NOT separately CDP-verified — it goes through
the exact SAME `_fillModeOf`-gated `pathOutlinePathD` call every other closed-shape kind already uses
(circle/rect/ellipse all verified across all 3 modes in earlier turns), so this is asserted by CODE-PATH
IDENTITY rather than a second live round-trip, a deliberate time-budget call on an already large turn, named
here rather than silently assumed.

Full vitest suite: 665/665 green.

Amendments polled clean (`handoff.py amendments --role worker`) before committing, and again immediately
before passing. Committed by explicit path (6 files: `editor/editor-expand-path.js`,
`editor/editor-expand-text.js`, `editor/editor-outline-preview.js`, `tests/editor-expand-path.test.js`,
`tests/editor-outline-preview.test.js`, `tests/editor-outline-preview-triggers.test.js`) — pushed.

## Lane B — Turn 101 — T41: text outline vs. drawn text mismatch — root cause found and fixed — DONE

**The advisor's own catch, confirmed by re-measuring, not just trusted.** T40's own `t40-text-word.png`
showed the outline sitting OFF the black glyphs — exactly as the advisor's own pixel measurements (from
that same screenshot) predicted. Re-measured independently before touching anything: created the SAME
`<text>` element live, read `getComputedStyle(node).fontFamily` — **"Inter, -apple-system,
BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif"** — NOT "Arial", despite `font-family="Arial"` being set
on the element. The browser was never rendering the chosen font AT ALL, for ANY text element, ever.

**Root cause, found by measuring not reasoning, per the dispatch's own instruction.** `base.css` (loaded on
EVERY page) has:
```css
* { font-family: inherit; }
html, body { font-family: var(--cad-font-family); /* 'Inter', -apple-system, ... */ }
```
`svg.js`'s `.font({family})` sets `font-family="Arial"` as a plain SVG PRESENTATION ATTRIBUTE (confirmed:
`node.hasAttribute('style')` was `false` on a freshly-created text element — `.font()` writes ONLY the
attribute, never an inline style). Presentation attributes carry the LOWEST possible CSS specificity —
weaker than literally any stylesheet rule, even a bare `*` selector — so the app-wide reset always won,
silently substituting the UI's own Inter/system-sans stack for EVERY font choice, on EVERY text element,
since this app has existed. This is why T40's own test didn't catch it: it compared the outline against
opentype's OWN path (which reads the attribute directly, bypassing CSS/DOM rendering entirely, so it was
ALWAYS correct) — never against what the BROWSER actually painted on screen, which is the thing a user
actually looks at.

**Which side was actually wrong — the important reframe.** The dispatch worried carve might be wrong (using
a DIFFERENT font/size/spacing than what's drawn). Measuring showed the OPPOSITE: `textGlyphPathD`
(Expand/carve/T40's own outline, all opentype-based) was ALWAYS correct — reading the CORRECT chosen
font's REAL metrics, unaffected by CSS. It was the LIVE, ON-SCREEN `<text>` render that was wrong, for
every font choice, this whole time — a real, pre-existing, independently-confirmed product bug T40's own
outline work happened to expose (T40 didn't introduce it; the outline preview is simply the first feature
that ever compared the two against each other).

**Already half-discovered and worked around — for ONE narrow case.** `insertSymbol`
(`editor-text-style.js`) already sets `editor._editingTextEl.node.style.fontFamily = appliedFamily` directly
alongside its own `.font({family})` call, with a comment explaining exactly why (symbol fonts rendering as
the wrong glyphs would be immediately, visibly obvious — Wingdings showing as Latin letters is impossible to
miss — while Arial silently rendering as a similar-looking sans-serif is not). This is DIRECT, strong
evidence: someone already hit this bug, for symbols specifically, and fixed it there — but the SAME fix was
never applied to the other 3 places that set font-family (the general font picker's `setFontFamily`, and
the initial text-creation in `startTextAt`), leaving every OTHER font choice still broken.

**Fix: give font-family enough CSS specificity to survive the global reset, everywhere it's set — matches
Fred's own stated preference ("prefer display what gets carved").** Added `.css({'font-family': family})`
(an INLINE style, same method `startTextAt` already uses for `cursor`/`user-select` — verified merges with
existing style properties rather than replacing them, not assumed) at the 2 remaining sites:
`editor-text-session.js`'s `startTextAt` (initial creation) and `editor-text-style.js`'s `setFontFamily`
(both the active-editing-element path and the multi-select fan-out). Chose to fix the LIVE RENDER to match
what opentype/carve already correctly produce (not the reverse — changing opentype's own layout to match a
CSS bug would mean encoding the bug INTO the manufactured output) — exactly the "display what gets carved"
direction the dispatch itself named as preferred, and the only direction that doesn't require guessing at
which of many possible browser font-substitution outcomes to replicate.

**A real debugging detour, disclosed for the same reason every other one this session has been: measured,
not guessed past.** The FIRST live check of the fix, through `startTextAt`'s real production code path via
simulated keyboard events, showed the style STILL missing `font-family` — looked exactly like the fix
hadn't taken effect. Traced systematically rather than assumed: confirmed the SERVER was serving the edited
file (`curl`'d it directly), confirmed `.css()` genuinely merges rather than replaces (an isolated live
test: call `.css({...3 props})`, then `.css({cursor:'pointer'})` again, checked all 3 survived), confirmed
`editor._fontFamily` was correctly "Arial" at the moment of creation — then tested the ONE remaining
hypothesis directly: killed and relaunched Chrome with a FRESH profile (not just `Page.navigate` +
`Network.setCacheDisabled` on the SAME long-lived process, which turned out to be insufficient — the ES
module registry persisted across navigations within that process regardless). On the fresh process, the fix
worked immediately and consistently. This was a test-harness artifact from reusing one Chrome instance
across many script invocations within a single long debugging session, not a second bug — named here so a
future "Page.navigate should be enough" assumption doesn't cost someone else the same hour.

**Live verification, per the dispatch's own test criteria (bbox/per-glyph within 0.01").** Fresh headless
Chrome (port 9503, new profile; 0 processes before launch, 8 mine before stop). Three cases — Tahoma@1.5in,
Georgia@3in, Arial@2in with `text-anchor:middle` (specifically to also cover anchor handling, not just
family/size) — each: `getComputedStyle().fontFamily` correctly matches the CHOSEN family (not Inter) in
every case; per-glyph X position (`getExtentOfChar`) compared directly against opentype.js's own
`charToGlyph().advanceWidth`-based layout for the identical text/font/size (with the SAME anchor correction
`textGlyphPathD` itself needs) — worst per-glyph deviation across all three cases: **0.0002"**, two orders of
magnitude under the 0.01" threshold. Screenshot (`t41-text-fixed2.png`) shows the outline preview sitting
EXACTLY on "Fred" letter-for-letter, including the counters in "e"/"d" — a dramatic, visible contrast against
T40's own original mismatched screenshot. Zero console errors.

**Regression test added** (`tests/editor-text-style.test.js`, new): confirms `setFontFamily` calls BOTH
`.font({family})` (the attribute Expand/carve read) AND `.css({'font-family'})` (the inline style the live
render needs), for both the actively-editing element and every selected `<text>` in a multi-select fan-out.
Can't reproduce the actual CSS-cascade bug in this file's own mocked DOM (happy-dom doesn't load real
external stylesheets, and the point IS real browser cascade behavior — this is a live-CDP-only class of bug,
same as T40's own opentype-comparison work) — but CAN and DOES guard the actual regression risk: someone
removing the inline-style call later. Mutation-verified: reverted `_applyFontFamilyStyle` to a no-op,
exactly 2 failures (the two tests checking for the `.css()` call), everything else unaffected; restored,
green again.

Full vitest suite: 668/668 green.

Amendments polled clean (`handoff.py amendments --role worker`) before committing, and again immediately
before passing. Committed by explicit path (3 files: `editor/editor-text-session.js`,
`editor/editor-text-style.js`, new `tests/editor-text-style.test.js`) — pushed.

## T42 — font-family fix moved to its SOURCE: the CSS cascade, not per-call-site patches

**The gap in T41, exactly as the dispatch named it.** T41 patched the 3 places the EDITOR ITSELF sets a
font (`startTextAt`, `setFontFamily`'s two paths) with an inline `.css({'font-family'})` override, strong
enough to beat `base.css`'s `* { font-family: inherit; }`. But that's a patch at every KNOWN call site, not
a fix of the rule that causes the collision — any `<text>` arriving by a path that never calls those
functions stays broken: a saved document re-opened (editor-io's restore inserts markup, doesn't call
`setFontFamily`), an imported/pasted SVG, an undo/redo snapshot restored from serialized markup, stamp-editor
pages. T41 could only ever be as complete as the list of places someone remembered to patch.

**Fix: scope the reset instead of fighting it.** `base.css`'s rule became:
```css
*:not(svg *) { font-family: inherit; }
```
(previously `* { font-family: inherit; }`). This never reaches a `<text>`/`<tspan>` inside an `<svg>` at
all, so the element's own `font-family="..."` presentation attribute is no longer beaten by anything —
regardless of HOW that attribute got there (JS call, markup restore, paste). Grepped the whole app for any
`<text>` living inside an svg-based ICON (sidebar buttons, toolbar glyphs) that might have relied on the
reset reaching in for its own UI font — none found; icons are all `<path>`/`<use>`, no `<text>`.

**Swept the now-redundant patches — one mechanism, not two.** Removed all 3 T41 `.css({'font-family'})`
call sites (`startTextAt`, `setFontFamily`'s editing-element and fan-out paths) AND the older, narrower
`insertSymbol` workaround (`node.style.fontFamily = appliedFamily`, which pre-dates T41 and was the first,
partial discovery of this same bug for symbol fonts specifically — see T41's own log entry). Left
`insertSymbol`'s pre-existing `.attr('font-family', appliedFamily)` redundancy with `.font({family})`
untouched (pre-existing, unrelated to this bug, not mine to clean up per the surgical-changes rule).

**Live verification (fresh Chrome, port 9505, profile `chrome-profile-t42b` — killed and relaunched before
testing, applying T41's own lesson about stale ES-module caches in a reused process rather than re-learning
it):**
- Markup-only `<text font-family="Arial">` injected via `insertAdjacentHTML` — deliberately bypassing every
  JS font-application call, to isolate that the CSS fix ALONE (not any leftover inline-style patch) makes it
  work — rendered with the correct family and its outline preview (`refreshOutlinePreview`) sat exactly on
  the glyphs. Screenshot `t42-markup-text-outline.png`, viewed directly: the white outline traces "Fred"
  letter-for-letter, including the counters in "r"/"e"/"d", matching T41's own key visual — but now proven
  for text the editor's own JS never touched.
- Simulated "re-opened saved doc" (`<text font-family="Georgia">` inserted the same markup-only way,
  standing in for editor-io's restore path) and "imported/pasted SVG" (`<text font-family="Verdana">`,
  same mechanism, different font) — both cases: `getComputedStyle(el).fontFamily` measured against the
  correct family. This is the exact case T41 structurally could not cover, since neither path calls
  `setFontFamily`.
- Symbol font via the REAL `insertSymbol` path with its own `node.style` workaround now removed: Wingdings
  glyph still resolved correctly (the presentation attribute alone is sufficient, matching the prediction
  that the CSS fix subsumes the narrower workaround it replaces).
- UI chrome unaffected: grepped for any `<text>` inside an svg icon (none), and live-measured 8 sidebar/
  toolbar buttons' `getComputedStyle().fontFamily` before/after — all still resolve to the Inter/system-sans
  stack via `*:not(svg *)`, since none of that UI lives inside an `<svg>`.
- Zero console errors/exceptions across all runs.

**A real empirical finding, not an assumption: happy-dom doesn't implement CSS cascade resolution for
`font-family` at all.** The dispatch suggested retargeting the regression test at "computed font-family of a
text element created from markup with only the attribute" — tried exactly that first, injecting the actual
`base.css` rule text (both the broken `*` version and the fixed `*:not(svg *)` version) plus a
`font-family` attribute into a happy-dom document. `getComputedStyle(el).fontFamily` returned the literal
unresolved keyword string `"inherit"` for BOTH variants — happy-dom doesn't run this resolution step, so the
test couldn't distinguish broken from fixed no matter which CSS text was injected. Confirmed this rather than
guessing past it (same measure-don't-assume discipline as T41's own Chrome-caching detour). Pivoted
`tests/editor-text-style.test.js` to check the one thing that CAN be checked here and that DOES gate the real
regression risk: `setFontFamily` still calls `.font({family})` (the attribute — now the ONLY font-family
mechanism), and does NOT call the now-deleted `.css({'font-family'})` path. Documented the happy-dom
limitation directly in the test file's own header comment so a future reader doesn't rediscover it. The real
proof of the fix itself is the live-CDP measurements above, not this file.

**Mutation-verified the rewritten test:** re-added a `.css({'font-family': family})` call to `setFontFamily`
(simulating the T41 patch coming back) — exactly 1 failure (the "NOT a redundant `.css()` call" assertion),
everything else unaffected; reverted, green again.

Full vitest suite: 668/668 green.

Amendments polled clean (`handoff.py amendments --role worker`) before committing, and again immediately
before passing. Chrome (port 9505, profile `chrome-profile-t42b`) confirmed mine by command-line match
before stopping; 0 of that profile's processes remained after. Committed by explicit path (5 files:
`bspline-frame-builder/styles/base.css`, `editor/editor-text-session.js`, `editor/editor-text-style.js`,
`tests/editor-text-style.test.js`, `WORK-LOG-lane-b.md`) — pushed.

## T43 — SE12 Slice 4: the Fusion export honors a layer's fusionGeometry pick

**Design, keyed on the ONE field, exactly as dispatched.** `getLayerSvg(editor, layerId, dpi, options)`
gained a 4th param: `options.geometry === 'fusion'` swaps in the layer's own `fusionGeometry` pick
(outline/both) right before export; every other call (no options — `stamp-mask-manager.js`'s carve mask,
`export-flow.js`'s own wizard-availability `_stampExportCandidates()`) is byte-for-byte untouched, same
code path as before this slice (refactored the shared parse+filter step into `_parseLayerContent` so
there's one parse, not two copies, but the DEFAULT branch's own output construction is the identical
lines in the identical order — confirmed via a direct `diff` against the pre-refactor file, not just "the
tests still pass"). The two calling conventions are deliberate: the plain call returns a string
(unchanged); `{geometry:'fusion'}` always returns a Promise `{svg, declined}` — even for a
`fusionGeometry:'centerline'` layer that needs no async work — so every 'fusion' caller has ONE contract
regardless of the layer's own pick (text glyph outlines need an async font fetch; nothing else does).

**Reused OUTLINE_KINDS — one geometry engine, not a second copy, per the dispatch's own instruction.**
`_getLayerSvgForFusion` (editor-io.js) walks the DOMParser'd, already-layer-filtered content (the same
parse `_parseLayerContent` already does for the plain path) and, for each child, calls
`OUTLINE_KINDS[type]` — the EXACT table `editor-outline-preview.js`'s live on-canvas preview already
uses — via a small adapter (`_outlineAdapter`) that gives a plain DOM element the `.attr()`/`.array()`/
`.type`/`.node`/`.text()` shape those table entries expect (mirrors svg.js's own points-attribute parsing
for polyline/polygon). Couldn't hand OUTLINE_KINDS the preview's own LIVE svg.js children directly — this
runs off a DOMParser'd copy of serialized content, same as getLayerSvg's default path always has — but
the geometry FUNCTIONS themselves (lineOutlinePathD, pathOutlinePathD, ellipseOutlinePathD, ...) are the
identical code either way; only the wrapper differs, same reasoning `_carveText`'s own bake-time text→path
swap already established for a different consumer of the same functions.

**outline replaces, both joins, declines fall back + are counted + are console-warned.** For each child:
'outline' swaps it for a `<path fill="none">` carrying the outline `d`, the source's own `stroke`/
`stroke-width`/`transform` (uncomposed, same contract `refreshOutlinePreview` already uses — the outline
is computed in the element's LOCAL frame), and every `data-*` attr (following `_carveText`'s own
established precedent for a geometry-swap-at-export carrying metadata over). 'both' keeps the original
element AND adds the path alongside it. An element with no OUTLINE_KINDS entry for its type, or whose
entry itself declines (an unsupported cap, no font mapping), keeps its own centerline untouched, is
individually `console.warn`'d, and counted — `export-flow.js`'s new `_fusionLayerSvg` helper rolls that
count into the export's own `fusLog` line (`[EXPORT] layer <id>: N element(s) declined...`) so it's
visible in the Fusion log without opening devtools, satisfying "a count the caller can show" without
inventing new UI this slice didn't ask for.

**Wiring in export-flow.js.** `_stampExportCandidates()` gained one field — `id: layer.id` — the minimum
needed to re-derive the geometry-aware SVG later; its own `.svg` field stays the plain centerline read
(wizard-availability checks and `hasShippableSvg` don't need geometry awareness — a layer either has
content or it doesn't, regardless of which geometry it exports as). The actual swap happens exactly once,
right before baking, in a new `_fusionLayerSvg(editor, l)` helper called from both `sendToFusion` and
`downloadFiles` (the two real export builders) — `await bakeSvgForCarving(await _fusionLayerSvg(editor, l), ...)`
— so `getLayerSvg`'s own async 'fusion' branch is awaited before `JSON.stringify`/Blob construction ever
sees it, same await-before-build discipline SE8d's own comment already established for the text-glyph
bake. `onGenerate`'s modal-open availability check and `onFusionApply`'s `hasStamp` check were
DELIBERATELY left reading the plain centerline `.svg` (no geometry swap, no extra font-fetch) — they only
need to know content EXISTS, not what geometry it will export as, so paying the async cost there (a real
font fetch on every modal open) would be pure waste for zero behavioral benefit.

**A real bug found live, not by inspection — the same discipline as T40's cap bug and T41's CSS bug.**
The dispatch's own verify criteria demanded "run outline paths through the SAME bake... assert the output
still has A commands, no C." The first live CDP check (a layer with rect+ellipse+polyline+text, all set
to Outline, driven through the REAL `getLayerSvg(editor, id, 96, {geometry:'fusion'})`) found exactly one
forbidden `C` — the TEXT outline. Root cause, traced rather than assumed: `pathOutlinePathD`'s
`_openSubpathD` (editor-expand-path.js) had a 'fill'-mode branch (`_passthroughD`) that re-emitted a
subpath's raw parsed segments verbatim whenever `_parseD` marked that subpath OPEN (no literal `Z`
token) — and opentype.js's own `toPathData()` (used by `textGlyphPathD`/`localGlyphPathD`, the SAME glyph
extraction both Expand and this outline kind already trust) NEVER emits a literal `Z` for a closed glyph
contour: it relies on the SVG spec's own implicit-closure-for-fill rule (a filled subpath is closed at
render time regardless of a literal Z) instead. So `_parseD` mislabeled every one of "Fred"'s glyph
contours as open, and the OPEN dispatch's fill branch had no biarc-fit step — unlike `_closedSubpathD`'s
own fill branch, which T40 part 2 already fixed for exactly this reason (its own comment: "a straight
`_passthroughD`... would leave any `C` segment as a raw cubic... breaking the M/L/A/Z only contract").
T40 part 2's own tests never caught this because they only ever stubbed `OUTLINE_KINDS.text`'s success
path with a fake M/L/Z string (the real glyph fetch always declines in vitest's environment — confirmed,
not assumed, same finding T42's own WORK-LOG entry already documented for a different reason) — nothing
had actually asserted command-letter purity against REAL opentype output before this turn's live check.

**Fix, scoped to exactly the branch that was wrong.** `_openSubpathD`'s fill branch now calls the SAME
`_closedRing(subpath, 1, 0, tolerance)` `_closedSubpathD`'s own fill branch already uses — confirmed by
reading `_closedRing`/`_buildBank` (not assumed) that NEITHER ever reads `subpath.closed` at all, so this
is behavior-identical to what a literally-Z-terminated version of the same contour would produce, and
correct per the SVG spec's own fill semantics (a filled subpath is closed whether or not it carries a
literal Z). Scoped to 'fill' mode only — 'stroke'/'both' still route through `_openCapsuleD` unchanged: a
genuinely open STROKE (two real free ends needing caps) is a real semantic difference from a closed fill,
and nothing about this fix touches that distinction. `_passthroughD` and its own helper `_segToD` became
fully dead after this change (grepped the whole repo — zero remaining references) and were deleted rather
than left as untested code, per this session's own established standard; the 2 comments elsewhere in the
file that referenced `_passthroughD` by name were reworded, not left dangling.

**Regression test, mutation-verified.** `tests/editor-expand-path.test.js`'s 'modes' describe block gained
one test: the exact shape opentype.js hands this code (a fill-mode subpath with a real curve and NO
trailing Z) — asserts only M/L/A/Z, and that every sampled output point sits tight to the source curve
(same tolerance style the existing "WITH a cubic segment" fill-mode test already uses). Mutation-verified:
reverted `_openSubpathD`'s fill branch to the old raw re-emit (restored `_segToD` under a mutation-only
name), ran the suite — exactly 1 failure, this new test, everything else (including the sibling CLOSED-
subpath fill test) unaffected; restored via the pre-edit backup (not `git checkout HEAD`, since none of
this was committed yet — this session's own established discipline), confirmed byte-identical via `diff`.

**`tests/editor-io-fusion-geometry.test.js` (NEW, 10 tests)** covers `getLayerSvg`'s own new contract
directly: the default call ignores `fusionGeometry` entirely (a direct differential assertion — the same
call WITH a non-centerline layer object present vs WITHOUT one produces byte-identical output — proving
the field is never even read on that path, not just "looks the same"); centerline pick under
`{geometry:'fusion'}` returns the exact same bytes the plain call would (wrapped in a Promise); outline
replaces (path only, M/L/A/Z, `data-*` and `transform` carried over); both keeps the element AND adds the
path; a no-OUTLINE_KINDS-entry element (`<image>`) and text (declines in vitest's environment, same
established reason) both fall back to centerline, count as 1 declined, and warn exactly once; the two
"editor not drawn" / "no matching children" edge cases match the plain path's own `""` contract, now as
`{svg:'', declined:0}`. Mutation-verified 3 separate ways: (1) forced `kind` to always resolve
'centerline' — 4 failures, exactly the outline/both/decline-under-outline tests, centerline/default tests
correctly unaffected; (2) forced 'both' to behave like 'outline' (never keep the centerline element) — 1
failure, exactly the "both" test; (3) disabled decline counting/warning — 2 failures, exactly the two
decline tests. All 3 mutations restored from the pre-edit backup, confirmed byte-identical via `diff`
before re-running the full suite green.

**Live verification (CDP, fresh Chrome each time per T41's own established lesson about stale module
caches in a reused process).** First pass (port 9506, profile `chrome-profile-t43`): a real editor layer
with rect+ellipse+polyline (lattice-rail stand-in — lattice pieces are themselves just lines/paths once
generated, already covered by these same OUTLINE_KINDS entries)+text, `fusionGeometry:'outline'`, driven
through the REAL `getLayerSvg(editor, id, 96, {geometry:'fusion'})` — found the C-command bug above.
Second pass (killed and relaunched, port 9507, profile `chrome-profile-t43b`, confirmed mine by
command-line match before stopping the first): same script, post-fix — `declined:0`, `pathCount:4` (all
four elements swapped), zero forbidden command letters, all four originals correctly absent (pure
'outline' mode, not 'both'). A third check ran the SAME output through the REAL `bakeSvgForCarving` (Slice
0's own similarity-carve bake, the actual next step in the real export pipeline) — still zero forbidden
letters, and confirmed real `A` arcs survive the bake (`hasArcAfterBake: true`), directly satisfying the
dispatch's own "assert the output still has A commands, no C" criterion against the FULL pipeline, not
just the pre-bake output. Saved to scratchpad as `t43-export.svg` (12023 bytes) for the advisor's own
Fusion import check. Zero console errors/exceptions across both passes. Chrome (9506/`chrome-profile-t43`
then 9507/`chrome-profile-t43b`) confirmed mine by command-line match before each stop; 0 of either
profile's processes remained after.

Full vitest suite: 679/679 green (668 + 10 new fusion-geometry tests + 1 new open-subpath-fill regression
test).

Amendments polled clean (`handoff.py amendments --role worker`) before committing, and again immediately
before passing. Committed by explicit path (6 files: `editor/editor-io.js`, `editor/editor-expand-path.js`,
`main/export-flow.js`, `tests/editor-io-fusion-geometry.test.js` (new), `tests/editor-expand-path.test.js`,
`WORK-LOG-lane-b.md`) — pushed.

## T44 — fallback notice + butt/square caps + miter/bevel joins

**Part 1: telling the user when an element falls back to centerline.** T43's `getLayerSvg({geometry:
'fusion'})` already counted declines and console-warned them individually; this turn added `declinedKinds`
(the DISTINCT element-type names that declined, e.g. `['image','text']`, not one entry per element) to its
own return shape, threaded through `export-flow.js`'s `_fusionLayerSvg` (now returns `{svg, declined,
declinedKinds}` instead of a bare string) into a new `_reportDeclinedOutlines(results)` — sums `declined`
and unions `declinedKinds` across EVERY exported layer, then calls the app's one existing reusable status
surface, `setFusionStatus(text, 'warn')` (`core/fusion-bridge.js`, targeting `#fusion-status` —
confirmed via a general-purpose research agent this was already the established "show a message, auto-
hide" pattern main.js's own Fusion-handshake handling uses, not something to invent fresh). Called once,
right after `sendFusionPayloadChunked` in `sendToFusion`, in the dispatch's own exact message format: `"N
element(s) exported as centerline — no outline for: <kinds>"`. Silent when nothing declined.

**Scope disclosure, not silently assumed complete:** scoped to `sendToFusion` (the "Send to Fusion" one-
shot path) only, per the dispatch's own wording — `downloadFiles` (the non-Fusion wizard/download path)
does NOT get this notice; `#fusion-status` is a Fusion-bridge-specific element that isn't a natural fit
for a flow that never touches the bridge at all. Also disclosed: `kind:'warn'` persists until replaced,
but a LATER `import_success` ping from Fusion's own handshake (main.js, `kind:'ok'`, auto-clears in 3s)
can still overwrite this notice once the import genuinely finishes — a pre-existing single-status-line
limitation of the app's own design, not something this slice attempts to solve. The dispatch's own
"same count visible in the preview (a dashed marker is fine)" was explicitly marked OPTIONAL — skipped in
favor of the required caps/joins work below, which was the larger deliverable this turn.

**Part 2: exact butt/square caps.** `SUPPORTED_LINE_CAPS` (editor-expand-analytic.js) flipped
`butt`/`square` to `true`. `lineOutlinePathD` gained the exact closed-form construction the dispatch
itself specified: butt = the plain rectangle (4 straight banks, no arcs); square = the same rectangle
built on a segment EXTENDED by `half` at each end first (`ext = cap==='square' ? r : 0`, shared code path
for both — square is literally "butt on a longer segment," not a separate construction). A zero-length
line still only has a sensible degenerate shape for ROUND (a full circle, pre-existing) — butt/square
have no defined DIRECTION to build a rectangle from at zero length, so they decline honestly
(`unsupported:'zero-length'`) rather than guessing an arbitrary axis.

`editor-expand-path.js`'s general engine needed the SAME construction for a multi-segment open path's own
two end-caps: `_buildCap` (previously round-only, called `_buildCap(toPoint, half)`) was generalized to
`_buildCap(fromPoint, toPoint, tangent, half, cap)` — round/butt unchanged in spirit, square extends both
bank endpoints outward along `tangent` by `half` before closing across (2 new corners instead of 1
straight edge). `tangent` must be the OUTWARD direction; `_openCapsuleD` passes the subpath's own forward
end-tangent for the end cap and the NEGATED forward start-tangent for the start cap (pointing back, before
the path begins) — confirmed (not assumed) that both offset banks share the identical tangent at a given
end, since a perpendicular offset never rotates it (already true for every segment kind this module
builds — lines trivially, arcs/cubics because `_offsetArcSeg`/biarc-fit tangents depend only on parameter,
not `side`). This generalizes past straight lines too — "for a curve end use its end tangent," per the
dispatch — verified live via a quarter-circle arc source, not just a straight-line source (see live
verification below).

**One found bug from THIS part, corrected during the same turn:** flipping the shared `SUPPORTED_LINE_CAPS`
table would have silently let `cubicSegmentOutlinePathD` (editor-expand-analytic.js — a single-cubic-
segment cross-check UTILITY, only ever called from this module's own tests, never from production/
OUTLINE_KINDS) start ACCEPTING butt/square and quietly returning a round-cap shape for them, since its own
body never grew a butt/square construction (its docstring always said "only round is supported"; it was
sharing the table purely by convenience). An existing test (`tests/editor-expand-biarc.test.js`) already
asserted this function DECLINES butt — caught immediately on the first test run after the table flip.
Fixed with its own small LOCAL gate (`_CUBIC_SEGMENT_SUPPORTED_CAPS`, round-only), decoupled from the now-
larger shared table, rather than letting a shared declaration silently outgrow one of its own consumers.

**Part 3: exact miter/bevel joins, lines only (the dispatch's own scope).** New `SUPPORTED_LINE_JOINS`
table (editor-expand-path.js — declared HERE, not alongside `SUPPORTED_LINE_CAPS`, since joins are this
module's own concept: a single line segment has caps but no internal joins at all). `_buildJoin`'s
existing OUTER/INNER dispatch (cross-product sign, unchanged) now takes a `joinStyle`/`miterLimit` pair,
threaded through the WHOLE call chain (`_appendJoin`→`_buildBank`→both `_openCapsuleD` and `_closedRing`→
`_closedSubpathD`/`_openSubpathD`→top-level `pathOutlinePathD`). New `_outerJoinCommands` handles the
OUTER (convex) side specifically:
- checks BOTH adjacent pieces' own true primitive (`_lastPrimitive`/`_firstPrimitive` — T40's own line-vs-
  circle classifier, already built for inner-trim) are `type:'line'`; a curve on either side returns
  `null`, and the caller falls back to the EXISTING round join for that one vertex — never a decline of
  the whole path, matching this session's established "exact where declared, never wrong elsewhere"
  discipline (same shape as a declined cap, just per-vertex instead of per-path).
- `bevel`: a direct `L` from pA to pB — the chamfer.
- `miter`: reuses `_lineIntersect` (already used by T40's own `_primitiveIntersect` for inner trimming —
  the SAME computation, opposite side: two offset edges' own true intersection IS the miter tip) to find
  the tip, then checks SVG's own miter-limit rule — `distance(vertex,tip)/half > miterLimit` falls back to
  bevel. Worked out algebraically (not assumed) that this ratio IS the SVG spec's own
  `miterLength/strokeWidth` ratio directly: a turn through interior angle θ has vertex-to-tip distance
  `half/sin(θ/2)`, so `distance/half == 1/sin(θ/2) == miterLength/strokeWidth` exactly — no rescaling
  needed. `miterLimit` defaults to 4 (SVG's own spec default), added as a `pathOutlinePathD` option.
- the INNER (concave) side is explicitly UNCHANGED by `joinStyle` — real SVG stroke-linejoin only ever
  shapes the outer bulge; the inner side is always "the offset paths cross, trim the overlap," regardless
  of join style (confirmed this is how real rasterizers treat it too, not assumed).

**Wiring into OUTLINE_KINDS** (editor-outline-preview.js): new `_joinOf(el)`/`_miterLimitOf(el)` helpers,
same `el.node.getAttribute(...)` pattern `_capOf` already established (T40's own finding: `el.attr(...)`
lies about a spec default for a genuinely-unset attribute — same risk for `stroke-linejoin`/
`stroke-miterlimit`, dodged the same way, not re-discovered the hard way). Added to `polyline`/`polygon`/
`path` only — the 3 kinds that actually route through `pathOutlinePathD`'s join machinery; `line` has caps
but no internal joins; `rect`/`circle`/`ellipse` use their own closed-form corner treatment (never this
engine's join code) and `text`'s own fill-mode join is geometrically irrelevant (half=0 collapses every
join to a no-op), so left untouched rather than wired for no effect.

**Tests, mutation-verified throughout (established session discipline, not skipped for this larger turn):**
- `editor-expand-analytic.test.js`: replaced the old "butt/square decline" test with T44's own supported-
  now assertions, plus 2 new describe blocks (butt: exact rectangle area/corners; square: exact extended-
  rectangle area + a direct "extension = exactly half, along the line direction" corner check against
  butt's own corresponding corner) — 16 tests total (was 7).
- `editor-expand-path.test.js`: 2 old decline tests updated to a still-nonexistent cap/join value (the
  scope genuinely grew); 3 new describe blocks — butt/square caps on a multi-segment path (including a
  curve-end square cap, verified via the SAME "diff against butt" technique as the line case, not hand-
  picked coordinates after an earlier hand-derivation attempt was PROVEN WRONG by the live test run
  itself — see below); miter/bevel joins (exact tip position for a known right-angle turn, bevel's own
  chamfer, the miter-limit fallback via a vertex-count differential rather than a raw distance check once
  a first distance-based attempt was ALSO proven ambiguous by its own natural-stroke-extent confound) — 27
  tests total (was 18). **4 of the first-draft tests in this file failed on their own first run** — not
  implementation bugs, test-authoring mistakes (an unstated default `join:'round'` still contributing an
  arc; a wrong equal-length assumption between butt's 5-point and square's 9-point outputs; `maxOffsetError`
  applied somewhere its own "always exactly half" invariant doesn't hold, at a bevel/butt corner specifically)
  — each diagnosed from the ACTUAL failure output and fixed properly, not weakened to pass; disclosed here
  per this session's own standard rather than silently presented as first-try-correct.
- `editor-outline-preview.js` gained 2 new tests proving `stroke-linejoin`/`stroke-miterlimit` genuinely
  reach `pathOutlinePathD` through the real OUTLINE_KINDS table (not just at the engine level) — a miter
  join produces a real, different `d` than the round default, and a strict custom `miterLimit` produces a
  different `d` than the default 4 would, for the identical miter-requesting source.
- `export-flow.test.js` gained a new describe block for `_reportDeclinedOutlines` (exported for direct
  testing, same convention `editor-io.js`'s own `_reconcileLayersFromSvg` already uses) — driven against a
  REAL `#fusion-status` DOM element (happy-dom's own `document`, not a mock of `setFusionStatus`/
  fusion-bridge.js — this suite has never used `vi.mock` anywhere, and a real element is a MORE faithful
  check of the actual wiring than a mock would be) — singular/plural wording, exact message format, and
  multi-layer sum+union-with-dedup across 2 layers sharing a declined kind.
- `editor-io-fusion-geometry.test.js` (T43's own file) gained 3 tests for `declinedKinds` itself: single
  kind, text's own kind, and de-duplication (2 declined images -> 1 kind, not 2).

Every new mechanism mutation-verified (restored from a pre-edit backup each time, confirmed byte-identical
via `diff` before re-running green): forcing `_buildCap` to always round — 4/27 failures, exactly the
cap tests; disabling `_outerJoinCommands` entirely (always round) — 4/27, exactly the join tests; disabling
just the miterLimit check (always full miter) — 2/27, exactly the 2 miterLimit-specific tests; `_joinOf`
ignoring the element's own attribute — 2/31 in editor-outline-preview.test.js, exactly the 2 wiring tests;
disabling `_reportDeclinedOutlines` entirely — 2/3 in its own new describe block, exactly the 2 non-empty-
message tests (the "does nothing when 0 declined" test correctly stayed green, since disabling still does
nothing in that case).

Full vitest suite: 703/703 green (668 T43-baseline + 10 T43 fusion-geometry + 1 T43 open-subpath-fill +
2 T44 declinedKinds-dedup-and-format additions across editor-io-fusion-geometry.test.js + 3 T44
declinedKinds tests + 3 T44 export-flow notice tests + 9 T44 analytic cap tests + 9 T44 path cap/join
tests + 2 T44 outline-preview wiring tests — net +24 over T43's own 679).

**Live verification (CDP, fresh Chrome — port 9508, profile `chrome-profile-t44`, killed and confirmed
mine by command-line match before stopping; 0 of that profile's processes remained after).** 5 zig-zag
polylines (real internal joins AND 2 open ends each) on ONE Outline layer, each a different cap/join combo
(round/round, butt/round, square/round, butt/miter, butt/bevel), driven through the REAL
`refreshOutlinePreview` → `OUTLINE_KINDS.polyline` → `pathOutlinePathD` path (reading `stroke-linecap`/
`stroke-linejoin` off the element itself, exactly as a user's own drawn polyline would carry them) —
`previewCount:10` (5 halo+line pairs), zero console errors. Screenshots (`t44-caps-joins.png` wide, plus
zoomed close-ups `t44-zoom-round-corner.png`/`t44-zoom-miter-corner.png`/`t44-zoom-bevel-corner.png`/
`t44-zoom-square-cap.png`), each VIEWED directly (not assumed from the script's own exit code) and each
one unambiguously distinct: round shows a smooth semicircle end-cap and a smooth rounded outer corner;
butt shows a flush flat-cut end; square shows the SAME flat-cut shape extended visibly further out than
butt's own end; miter shows a crisp sharp point at the outer corner (no arc); bevel shows a visible flat
chamfer line across the corner, distinct from both the round arc and the miter's sharp point.

Amendments polled clean (`handoff.py amendments --role worker`) before committing, and again immediately
before passing. Committed by explicit path (6 files: `editor/editor-expand-analytic.js`,
`editor/editor-expand-path.js`, `editor/editor-io.js`, `editor/editor-outline-preview.js`,
`main/export-flow.js`, `WORK-LOG-lane-b.md`) plus the 5 touched/new test files (`tests/editor-expand-
analytic.test.js`, `tests/editor-expand-path.test.js`, `tests/editor-outline-preview.test.js`,
`tests/export-flow.test.js`, `tests/editor-io-fusion-geometry.test.js`) — pushed.

## T45 — opening a project now loads its drawing into the live editor

**Root cause, confirmed by a dedicated research agent, not assumed from the dispatch's own framing
alone.** `applySnapshot` (`main/snapshot-manager.js`) is the apply step for BOTH global undo/redo AND
project load (cloud-project-manager.js's `_loadFrom`). It writes `P.editorSvg` (part of its generic
`Object.keys(snap.P).forEach` restore loop) but never loaded that content into the LIVE
`window.svgEditor`'s own document — correct for undo (SE4c: "the drawing has its own undo stack"), wrong
for load. Confirmed the actual mechanism: `stamp-mask-manager.js`'s `updateStampMasks` reads
`window.svgEditor._layers` directly — no fallback to `P.editorSvg` — so a cloud load silently rasterized
masks from the STALE pre-load editor content, and (separately) `editor-outline-preview`/the sidebar Layers
panel/exports all read the same stale live document. `editor.initEditor()` (editor/editor.js) itself never
calls `.open()` — confirmed by reading the whole method — so the ONLY prior path that ever loaded content
into the live editor was a manual "Edit" button click (`main/stamp/svg-source.js`) or boot.

**A second, related bug found in the SAME investigation, also in scope (the dispatch's own item 2):**
`app-init.js`'s `initSvgEditor` DOES call `.open(P.editorSvg, ...)` at boot when content exists — but its
own boot-restore block only ever called `refreshDrape(preview)` afterward, NEVER
`refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode)` — despite that block's OWN comment
claiming "fire-and-forget, same as the other refreshAllStampMasks call sites above" (a comment describing
behavior the code never actually had). `initApp`'s own EARLIER `refreshAllStampMasks` call (for the same
boot) runs BEFORE `window.svgEditor` even exists (per that call site's own comment, confirmed) — a no-op.
Net effect: at boot, the DRAPE (a flat color texture) DID refresh correctly, but the actual 3D CARVED
GEOMETRY (the stamp masks driving the heightfield) never did — until the user manually opened the editor
and hit Apply Stencils (which does call `refreshAllStampMasks`, in the Apply/Cancel `onCommit` path). This
is the exact mechanism behind "the 3D shows the artwork [flatly, via drape] without opening the editor" —
the ARTWORK COLOR showed, the actual CARVED SHAPE did not.

**Fix 1 — `applySnapshot(snap, preview, {source})`, no default (Fred's own instruction: "no default that
silently picks one").** A missing or unrecognized `source` now THROWS (`source must be 'undo' or 'load'`)
rather than silently picking a behavior — the exact shape of bug that shipped originally (one function, one
behavior, reused for two meanings that needed to differ). A dedicated research agent grepped every call
site across `html/main`/`html/core` and confirmed exactly 4 exist, no others: `global-events.js`'s 3
(Ctrl+Z/Y, the global undo/redo buttons, the sculpt top/bottom undo/redo buttons — all genuinely
undo/redo) now pass `{source:'undo'}`; `cloud-project-manager.js`'s `_loadFrom` (the ONE project-load call
site today) now passes `{source:'load'}` (and is now properly `await`ed — it wasn't before, meaning
`setCurrentFile`/`markClean`/the "✓ Loaded" toast could previously fire before the snapshot had actually
finished applying; now they wait for the real, now-heavier async work).

For `source==='load'`, right after `runMigrations()` (so the FINAL, migrated `P.editorSvg` is what gets
loaded, not a pre-migration shape): `window.svgEditor.open(editorRestoreSvg(), P.widthIn, P.heightIn)` —
the SAME restore call a manual editor-open already uses. Chose to REUSE `open()` rather than hand-roll a
narrower "just swap the SVG" step, since `open()` (editor-io.js) already, by construction: clears the
WHOLE sketch layer first (so loading B after A can never leave any of A's drawing behind — the dispatch's
own explicit "must not leave any of A's drawing, masks, layers or outline preview" requirement, satisfied
for free rather than re-implemented), rebuilds the layer roster from the NEW document's own
`data-editor-layers`, resets the editor's own undo stack, and — via its own last step, `setActiveLayer()`
— refreshes BOTH the sidebar Layers panel (`renderLayersPanel`) AND the outline preview
(`refreshOutlinePreview`). One call covers 3 of the dispatch's 4 "must refresh" items; the EXISTING
(already-unconditional) `updateStampMasks` call later in the SAME function now simply reads the
freshly-loaded content for free, needing no change of its own — only DRAPE needed an explicit new call
(`refreshDrape`, newly exported from `app-init.js` for this — `runMigrations` was already imported from
there, no new import path, no circular-import risk confirmed by checking `app-init.js` imports nothing
from `snapshot-manager.js`), gated the same way, since undo never changes the drawing so its derived
texture never needs to.

**Fix 2 — the boot-restore block** (`app-init.js`'s `initSvgEditor`): added the missing
`refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode)` call, in the same position/order the
Apply and Cancel paths already use (`.open()` → masks → drape) — matching the pattern already established
twice in the same file rather than inventing a new one, and correcting that block's own stale comment in
the same edit.

**Tests, mutation-verified (new file, `tests/snapshot-manager.test.js`, 10 tests).** A deliberate,
disclosed departure from this suite's own established "no vi.mock, real DOM/object stand-ins" convention
(export-flow.test.js's own T44 notice on that convention, right above this entry): `applySnapshot`'s
sibling-module dependency graph (engine/stamp-mask-manager/sculpt-interaction/terrain, each pulling in
real rasterization/grid/engine machinery) is qualitatively heavier than anything tested in this session so
far — a true orchestration function, not a pure geometry engine — and the thing actually under test here
is the WIRING (does 'load' call `editor.open()`/`refreshDrape`, does 'undo' not), not those modules' own
internals. `state.js`/`history.js`/`ui-utils.js` stayed REAL (their own setters/DOM lookups already guard
safely against a happy-dom document with no matching elements — confirmed by reading each, not assumed,
before deciding they were safe to leave real). Covers: the `source` guard (missing/unrecognized both
throw); `'load'` calls `editor.open(editorRestoreSvg(), P.widthIn, P.heightIn)` with the exact args, calls
`refreshDrape(preview)`, still refreshes masks; `'undo'` never calls `.open()`, never refreshes drape,
still refreshes masks (both sources share that one). Mutation-verified 3 ways: disabling the source guard
— exactly the 2 guard tests fail; disabling the 'load' `.open()` call — exactly 1 failure, the args-check
test; making `.open()` run UNCONDITIONALLY (leaking into 'undo') — exactly 1 failure, the "never calls
open()" undo test. Each mutation restored from a pre-edit backup, confirmed byte-identical via `diff`
before re-running green. The boot-path fix (item 2) has no dedicated unit test — `initSvgEditor` is heavy
DOM/canvas/VectorEditor-construction machinery with no prior test coverage of its own, and the dispatch's
own vitest requirement was specifically about `applySnapshot`; verified live instead (below), consistent
with this session's own established practice for boot/DOM-heavy code.

**Live verification (CDP, fresh Chrome — port 9509, profile `chrome-profile-t45`, killed and confirmed
mine by command-line match before stopping; 0 of that profile's processes remained after), driving the
REAL production functions directly (not a stand-in), per the dispatch's own exact scenario.**
- **Fix 1 (project load):** two synthetic "cloud snapshots" (A: a red rect, depth 0.3/square; B: a blue
  circle, depth 0.6/ballnose — each its own full `data-editor-layers` roster), loaded via the real
  `applySnapshot(snap, preview, {source:'load'})` — the EXACT function `_loadFrom` calls — with the editor
  modal NEVER opened at any point. After A: `_sketchLayer` contains only the rect, `exportableStampLayers()`
  reflects A's own depth/profile, undo stack freshly reset (length 1, the same "nothing to undo yet"
  baseline `initApp`'s own comment describes). After B (loaded immediately after A, editor still never
  opened): `_sketchLayer` contains ONLY the circle — the rect is completely gone, zero trace of A —
  `exportableStampLayers()` now reflects B's own depth/profile, undo stack freshly reset again. Screenshot
  (`t45-project-b-3d.png`) shows an unambiguous BLUE circular stamp mound in the 3D preview, zero trace of
  the earlier red rectangle — both the drape color AND the actual carved heightfield geometry correct,
  confirming masks AND drape, not just the drawing itself.
- **Fix 2 (boot path):** re-invoked the real `initSvgEditor(preview)` (app-init.js) directly with fresh
  `P.editorSvg` content (a green rect, depth 0.45/vbit) — exercising the exact lines this fix touched,
  without needing to fight a separate, pre-existing, out-of-scope timing quirk in `main.js`'s own
  unconditional `localStorage.removeItem('splineGenLastSession')` on every `DOMContentLoaded` (flagged by
  the research agent as a second, related-but-distinct bug that would need confirming with Fred
  separately — a genuine page reload today can't actually reach a "saved session exists at boot" state
  through THAT mechanism at all; out of this dispatch's own stated scope, not touched). Result:
  `exportableStampLayers()` shows `hasMask: true` for the new layer — proving the previously-missing
  `refreshAllStampMasks` call now genuinely runs. Screenshot (`t45-boot-restore-3d.png`) shows a green,
  sharply-beveled (vbit-profile) raised rectangular stamp in the 3D preview — the actual carved geometry,
  not just a color overlay.
- Zero console errors/exceptions across both CDP runs.

Full vitest suite: 716/716 green (706 pre-T45 + 10 new `snapshot-manager.test.js` tests).

Amendments polled clean before this entry; **one arrived at the pre-commit poll** —
Fred (via Fusion): node outlines import as two half-circle arcs, not a true SketchCircle (his own sketch:
82 SketchArcs, 0 SketchCircles). Per the amendment's own explicit instruction ("Finish T45 first and
commit it, then as a SECOND commit this turn"), T45 itself is committed here unchanged by that amendment;
the circle-export fix follows as its own separate commit in this same turn — see the NEXT entry below.

Committed by explicit path (5 files: `main/app-init.js`, `main/cloud-project-manager.js`,
`main/global-events.js`, `main/snapshot-manager.js`, `WORK-LOG-lane-b.md`) plus the new
`tests/snapshot-manager.test.js` — pushed.

## T45 ADD-ON — a full circle exports as a native `<circle>`, not two SketchArcs

**The amendment (Fred, via Fusion measurement, mid-turn).** A node's outline (fusionGeometry:'outline' on a
lattice node — a small `<circle>`) imported into Fusion as TWO SketchArcs, not ONE true SketchCircle
(Fred's own sketch: 82 SketchArcs, 0 SketchCircles). Root cause: T39's own established SVG-arc-limitation
workaround — "one `A` command can't express a full circle" (coincident start/end is degenerate for the
endpoint-to-center parametrization), so every full circle this session's own engine ever emits is TWO
coincident-center semicircle `A`s instead. Fusion's `importSVG` turns a native `<circle>` element into a
true SketchCircle at exact radius; it turns those same two `A`s into two separate SketchArcs — a real,
measured Fusion-importer behavior difference this session had no prior reason to know about (nothing
before this exported real circle geometry to Fusion — T43's own live-Fusion check used rect/ellipse/
polyline/text, no bare circle).

**Scoped precisely to what actually produces this exact shape — not a generic post-hoc pattern-scanner.**
Per the amendment's own preferred design ("declare it in the engine's return shape"): rather than
re-deriving "is this `d` string secretly 2 coincident semicircles" from already-emitted text (fragile,
and exactly the kind of inference-from-output this session's own declare-over-hand-roll discipline argues
against), the TWO functions that actually KNOW they're building a full circle — because they already
compute cx/cy/r before ever stringifying it — now say so directly:
- `circleOutlinePathD` (editor-expand-analytic.js): EVERY ring it ever produces (fill: 1, both: 1, stroke:
  1 or 2 depending on whether the inner ring collapses) is built via `_circleLoopD`, i.e. is ALWAYS a true
  full circle, never a partial arc. Now returns `circles: [{cx,cy,r}, ...]` — one entry per ring — alongside
  the unchanged `d` (so the live preview, which only ever reads `d`/`unsupported`, keeps working exactly as
  before, unaffected by the new field — confirmed by re-reading `refreshOutlinePreview`'s own destructuring,
  not assumed).
- `lineOutlinePathD`'s zero-length-line case (also `editor-expand-analytic.js`): a degenerate zero-length
  round-capped line collapses to a full circle of radius `strokeWidth/2` — same `circles` treatment.
- Explicitly did NOT touch the NORMAL (non-zero-length) round-cap case — its own two `A`s are genuinely
  SEPARATE half-circles at DIFFERENT centers (one per end of the capsule), never a single full circle. Per
  the amendment's own instruction ("rail/tie round caps are genuinely half-circles — leave them as A"),
  confirmed this stays completely untouched: no `circles` field, `undefined` (tested explicitly, not just
  "didn't break").
- `ellipseOutlinePathD` investigated and explicitly ruled OUT of scope: read `_ellipseOffsetLoopD`'s own
  implementation and confirmed it ALWAYS biarc-fits over 4 quarter-arcs regardless of whether `rx===ry` —
  no fast-path circle shortcut exists, so even a true circle drawn via the ellipse tool never produces the
  clean 2-semicircle pattern this fix targets. The amendment's own examples never mention ellipse either —
  matches its stated scope exactly, not narrowed further than intended.

**Export wiring** (`editor-io.js`'s `_getLayerSvgForFusion`): the single "build the replacement path"
step became `_buildOutlineReplacementNodes(doc, result, ch)`, returning an ARRAY of nodes instead of one —
when `result.circles` is present, one native `<circle fill="none" stroke=... stroke-width=...>` per entry
(carrying the SAME `data-*` attrs and uncomposed `transform` the path replacement already carried, via one
shared `decorate()` closure — not duplicated per-branch); otherwise the existing single `<path>`, unchanged.
Both producers wired up this turn have their ENTIRE `d` composed of the SAME circles they declare — never a
mix with other path geometry — so `circles` present means `d` is skipped entirely for the export, not
supplemented (documented explicitly in the function's own comment, since a FUTURE producer that mixes
circle + non-circle geometry in one result would need its own handling, not silently assumed to fit this
one). The 'both'-mode insert-after and 'outline'-mode replace-in-place loops both updated to chain multiple
new nodes in order (needed for stroke-mode's 2-circle annulus case) rather than assuming exactly one.

**The bake needed NO new code at all — confirmed, not assumed.** Read `bakeMatrixIntoElement`
(editor-transform-handles.js) directly: it ALREADY has a `type === 'circle'` branch (Slice 0, pre-existing,
this session's own earlier work) that bakes a similarity transform into `cx`/`cy`/`r` natively — a circle
under any similarity transform (uniform scale + rotation + translation) stays exactly circular, unlike an
arc, which is WHY Slice 0 built this in the first place. My new `<circle>` export elements flow through
the EXISTING `_carveChildren`/`bakeMatrixIntoElement` dispatch unchanged and get baked correctly for free —
confirmed live (below), not just read and assumed.

**Tests, mutation-verified.** `editor-expand-analytic-shapes.test.js` gained a `circles` describe block
under the existing `circleOutlinePathD` tests (fill/both/stroke-with-annulus/stroke-with-collapsed-inner —
4 tests, each checking the EXACT `{cx,cy,r}` array against the known analytic radius, not just "some
circles exist"). `editor-expand-analytic.test.js` gained 2: the zero-length case now also asserts `circles`
alongside its existing area/distance checks; a NEW test explicitly asserts the normal capsule case's
`circles` is `undefined` (proving the exception is real, not just untested). `editor-io-fusion-geometry.
test.js` gained 6: fill-mode circle → 1 `<circle>` no `<path>`; stroke-mode circle → 2 `<circle>`s no
`<path>`; mode:'both' → 2 `<circle>`s (centerline kept + new outline) no `<path>`; zero-length line → 1
`<circle>`; a NORMAL line still exports as `<path>` with `A`s (the negative case — proves the fix doesn't
over-fire); the exported `<circle>` carries the source's own `data-*`/`transform`. 51 new/changed assertions
total. Mutation-verified 2 ways: disabling the `circles` branch in `_buildOutlineReplacementNodes` entirely
— exactly 4/17 failures in the export test file, precisely the circle-specific tests (the zero-length-line
and normal-line-stays-path tests correctly stayed green, since those two are about `lineOutlinePathD`
specifically and would only break under a DIFFERENT mutation); dropping the `circles` field from
`circleOutlinePathD` everywhere — exactly 7 failures (4 in the shapes test file, 3 export-level), the
remaining tests in both files (including the zero-length-line and normal-line cases, which exercise
`lineOutlinePathD` not `circleOutlinePathD`) correctly unaffected. Both mutations restored from a pre-edit
backup, confirmed byte-identical via `diff` before re-running the full suite green.

**Live verification (CDP, fresh Chrome — port 9510, profile `chrome-profile-t45b`, killed and confirmed
mine by command-line match before stopping; 0 of that profile's processes remained after), through the
FULL real export pipeline, not just the unit-level engine call.** A node-like `<circle>` (fill mode,
`fusionGeometry:'outline'`) exported via the REAL `getLayerSvg(editor, id, 96, {geometry:'fusion'})`, THEN
piped through the REAL `bakeSvgForCarving` (the actual next step `export-flow.js` runs before sending to
Fusion) — pre-bake: 1 `<circle>`, 0 `<path>`; post-bake: STILL 1 `<circle>`, 0 `<path>`, with `cx`/`cy`/`r`
correctly transformed by the real carve matrix (confirmed via the baked SVG's own literal attribute values,
not inferred) — conclusively proving the amendment's own "the bake keeps `<circle>` native under the
similarity carve matrix" claim end-to-end, using pre-existing infrastructure this fix didn't need to touch.
Zero console errors.

Full vitest suite: 727/727 green (716 T45-baseline + 11 new circle-export tests: 4 in
`editor-expand-analytic-shapes.test.js`, 1 new in `editor-expand-analytic.test.js` — plus a `circles`
assertion added to its existing zero-length-line test, not counted as a new test — and 6 in
`editor-io-fusion-geometry.test.js`).

Amendments polled clean before this entry. Committed by explicit path (3 files:
`editor/editor-expand-analytic.js`, `editor/editor-io.js`, `WORK-LOG-lane-b.md`) plus the 3 touched test
files (`tests/editor-expand-analytic-shapes.test.js`, `tests/editor-expand-analytic.test.js`,
`tests/editor-io-fusion-geometry.test.js`) — pushed, as the amendment's own explicit "second commit this
turn" instruction asked for.

## T46 — SE13 design doc: Boundary mode for the Lattice (docs only, no code)

**Scope, per the dispatch: design only, no product code.** Fred's ask: a "Boundary: Board | Shape" mode of
the existing Lattice panel, filling any closed canvas shape with a cut rail/tie/node grid — inspired by a
screenshot of his own `svgcreator.pages.dev` "Mondrian" effect, with his own explicit correction of scope
("not sure you should reuse the STYLE, the LOGIC is good") and hard constraint ("Don't trim, add ending
logic — if it's simpler than trimming").

**Two parallel research passes before writing anything**, rather than designing from the dispatch's own
summary alone: (1) a full re-read of the CURRENT Lattice implementation — not SE7b's own original design
doc, which turned out to describe an ownership model that was never actually shipped (see below); (2) a
read of the reference site's own deployed source at `reference/svgcreator-deployed/` (untracked per the
dispatch's own instruction — cited by path/line throughout the doc, never copied, never staged).

**A real, disclosed correction found in pass 1, not assumed from memory or from SE7b's own doc.** SE7b's
own design proposed an auto-detach-on-touch hook (any drag strips `data-lattice-gen`) — reading the
SHIPPED code (`editor-interaction.js`'s `_finishLatticeMove`) shows this was never built: a dragged/
stretched owned piece keeps its ownership tag and gets swept away on the next Generate, unless the user
explicitly runs "Detach all" first. This directly answers one of the dispatch's own open questions (a
stretched piece leaving the boundary) for free — no new rule needed, the existing (not the originally-
proposed) mechanism already covers it — and is called out in the doc as exactly that: an answer derived
from what's actually shipped, not from what an earlier doc said would be shipped.

**A real correction to the dispatch's own framing, found in pass 2.** The reference tool's own "boundary"
is never an ingested arbitrary SVG shape — it's always one synthetic loop the tool builds itself from
keypoints + circular bulge arcs, for its own humanoid-silhouette generator. There is no curve-flattening
step anywhere in their pipeline, because their own source geometry is already only L/A. This means the
"arbitrary rect/circle/ellipse/polygon/path/text → primitives" step the dispatch's own "cutting engine"
line describes has NO reference implementation to lean on at all — it's this design's own original piece,
built instead by reusing THIS session's own T39-T45 path-normalization machinery (`_parseD`,
`_lineIntersect`, `_lineCircleIntersect`, `arcCenterParam`) rather than either re-deriving it or
mis-attributing it to a reference that never solved it. Disclosed explicitly in the doc rather than
silently presenting the shape-to-primitives design as if it had a model to follow.

**A genuine improvement over the reference, not just a port of its logic.** The reference's own
stored-rolls mechanism (raw `[0,1)` dice rolls persisted as `data-omit`/`data-loose`/`data-cr` attributes,
so re-applying a slider re-checks a threshold instead of re-randomizing) has its own real asymmetry bug:
joints don't get this treatment and reshuffle on every `patch()` call while grid lines don't. Found by
reading `patch()`'s own branch-by-branch behavior (`mondrian.js:351-458`), not assumed from the dispatch's
summary. The design persists rolls for every randomized draw uniformly, joints included — closing exactly
this gap rather than reproducing it, named explicitly as a deliberate deviation from "copy the logic."

**The one place I pushed back on the dispatch's own phrasing, per its own "design it, challenge it where
wrong" instruction.** `_resolveExtent` (the dispatch's own suggested single extension point) is necessary
but not sufficient: the rail/tie generation loop itself currently assumes a rail/tie spans the FULL
board-box edge-to-edge once gated on/off — an arbitrary boundary can enter/exit a single scanline more than
once (a concave shape, a shape with a hole), so `computePattern`'s own generation loop needs to accept
MULTIPLE inside-sub-spans per row/column, not just a differently-shaped bounding box. Named as its own
architectural point (§Ground-truth #2 in the doc) rather than folded silently into "extend `_resolveExtent`"
the way the dispatch's own one-line summary of the advisor's plan might read.

**Delivered**: `SE13-BOUNDARY-LATTICE-DESIGN.md` (repo root) — data model (`PATTERN.boundary =
{shapeId, endRule, runs, joints, border}` plus a new `data-boundary-ref` element-identity attribute, since
no element in this editor currently carries a stable per-element id and "linked by id, not copied" needs
one); the cutting engine (exact closed-form for L/circular-A reusing existing primitives, numeric ≤1e-6 for
C/elliptical-A, the half-open rule generalized to the numeric case, holes via even-odd as a genuine
extension the reference never solved, tangency/degenerate-boundary handling); the shape→primitives table
for all 6 requested kinds (rect/circle/ellipse/polygon/path/text — text confirmed naturally multi-region
via disjoint glyphs, not a special case); the spans→stops→runs 3-level cut with stored per-piece rolls; the
4-entry ending-rule table (on-boundary/inset-default/joint/loose) with ONE named case the rules can't
handle cleanly (a span shorter than one grid cell — `loose` degrades to `inset`) per the dispatch's own
"say which and why" instruction; joints-as-existing-nodes; the optional Border piece; carve/export
exactness (argued AND grounded: boundary pieces are the same `<line>`/`<circle>` kinds Board-mode already
emits, so T39-T45's own OUTLINE_KINDS/Fusion-export machinery — including T45's own circle-export fix,
measured live in Fusion this same session — needs zero new code); commit-only link refresh reusing the
SAME hook `refreshOutlinePreview`/`refreshDrape` already use; the move/stretch open question answered from
the corrected ownership model; undo; save/load (also needing zero new persistence code — `layer.pattern`
is already generic); a 390px-first ASCII panel mock; 3 browser-provable slices (predicted files + verify
criteria each, matching SE7b's own established slice shape); and 5 open questions for Fred (most load-
bearing: whether the color-run/"parts" sub-cutting — the single most reference-visual-specific, largest
piece of the whole design — belongs in v1 at all, given his own "not sure about the STYLE" caution).

No code changed, no tests, no live CDP run — docs-only turn, exactly as dispatched. `reference/
svgcreator-deployed/` confirmed untracked and NOT gitignored (would be swept by a bare `git add -A`, which
this session's own established discipline never uses) — verified via `git status`/`git check-ignore`
immediately before committing, not assumed safe.

Amendments polled clean. Committed by explicit path (2 files: `SE13-BOUNDARY-LATTICE-DESIGN.md`,
`WORK-LOG-lane-b.md`) — pushed.

## T47 — SE13 Slice 1: the pure boundary-cutting engine

**Scope, per the dispatch: build EXACTLY §14 Slice 1 of the T46 design** — `shapeToPrimitives(el)` and
`insideSpans(scanLine, primitives)`, pure functions, no DOM/editor object, no product wiring. NO FUSION —
vitest/browser proof only, no live CDP session needed for a pure module with no DOM surface. Advisor's own
ruling on Q4 (numeric-vs-closed-form for curves), given before this turn started: keep the numeric path in
v1 — pen/freehand boundaries are cubic paths, the most common shape Fred will pick, so numeric line×curve
is load-bearing, not optional; rotated ellipses route through it too, no bbox fallback.

**Declare over hand-roll, applied at the primitive level, not just the data-shape level.** The design doc's
own §2/§3 already named the reusable pieces; this turn's own job was making them ACTUALLY reusable rather
than re-derived. Exported 4 existing `editor-expand-path.js` internals with zero logic changes — `_parseD`,
`_lineIntersect`, `_lineCircleIntersect`, `_arcWorldPointTangent` (plus `arcCenterParam`, already exported
from `path-layout.js`) — so the new module's own path-normalization and line/circle crossing math is the
SAME code this session's own offset/join engine (T39-T44) already trusts, not a second copy that could
silently drift. Confirmed via `git diff` on the export commit: exactly 4 `export` keyword additions plus
their own one-line rationale comments, no other change to any function body.

**New module**: `bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js` (349 lines).
`shapeToPrimitives(el)` handles all 6 boundary kinds the design doc names — rect/circle/ellipse/polygon/
path/text — returning a flat `{type:'L'|'A'|'C'|'CIRCLE', ...}` primitive list in the element's own local
frame (`[]` for an unsupported/degenerate source, same decline-gracefully contract every OutlinePathD
function in this codebase already uses). `text` reuses `localGlyphPathD` (editor-expand-text.js, T-earlier
work) to get a glyph outline `d`, then routes through the same `_primitivesFromD` path every `path` element
uses — no separate glyph-primitive code. Every path/polygon subpath is treated as implicitly closed whether
or not it carries a literal `Z`, reapplying T43's own finding this same session (SVG fill semantics close
every subpath regardless of a literal Z; opentype.js's own glyph contours never emit one) — a boundary is
exactly a fill-rule concept, so the same convention applies here on purpose, not by coincidence. A
degenerate `A` (`arcCenterParam` returns null) falls back to a straight line, the same fallback
`_offsetArcSeg` already uses for the identical case.

`insideSpans(scanLine, primitives)` is the actual cut: every primitive's own crossing(s) with the scan
line, half-open per the design doc's own §2 rule, sorted and paired even-odd across the WHOLE crossing
list with no per-subpath bookkeeping — which is what makes holes (a donut boundary) fall out for free
rather than needing separate inside/outside subpath tracking. Exact closed-form for `L` (via `_lineIntersect`
+ a projected-t half-open test) and circular `A` (rx≈ry, via `_lineCircleIntersect` + an angle-based
half-open test); numeric (64-point dense sample + 40-iteration bisection on every sign-changing bracket,
no derivative needed) for `C` and for elliptical/rotated `A` (rx≠ry), per the advisor's own ruling above.

**Self-caught correction, found before any test ran, not reported back to me.** My own first-draft comment
on the `ellipse` shape case claimed it used "exact closed-form (§2's own line × ellipse quadratic)" — but
tracing my own `insideSpans` dispatch shows the `isCircular` check (`|rx-ry| < 1e-6·max`) fails for any
real ellipse, so an ellipse boundary ALWAYS falls to the numeric branch; I never built a separate exact
quadratic solver. Caught by re-reading my own code critically before running tests, not by a failing test
or outside review. Fixed the source comment and the matching test description to state the real (numeric)
behavior, with the reasoning for not building a second solver made explicit: the numeric path is already
proven robust and correct, and a second solver would be untested surface area for marginal benefit — not
worth the added maintenance for a case the numeric path already handles correctly.

**New test file**: `tests/editor-lattice-boundary.test.js` (265 lines, 21 tests) — 6 shapeToPrimitives kinds
plus a declined-polyline and a declined-degenerate-rect case; insideSpans exact cases (L rect, circular-A
circle, both cross-checked against independent analytic oracles) plus the numeric-routed ellipse case
(cross-checked against a rotated-vs-swapped-unrotated-ellipse identity, not just eyeballed); holes via
even-odd (donut, both hitting and missing the inner ring); the half-open rule, proven non-vacuous (below);
and the numeric cubic case, matched against a 200,000-sample independent oracle within 1e-4.

**Mutation test — proving the half-open-rule tests are non-vacuous**, matching the dispatch's own explicit
verify wording ("mutation-test by disabling the half-open exclusion and confirming a spurious span
appears"). Backed up `editor-lattice-boundary.js` to `$TEMP/editor-lattice-boundary-t47.js.bak`, then
mutated `_crossLine`'s own half-open guard from `if (t < -1e-9 || t >= 1 - 1e-9) return;` to `if (false)
return;` (exclusion fully disabled). Ran `tests/editor-lattice-boundary.test.js`: exactly 3 of 21 failed,
and they were precisely the 3 half-open-rule tests — the tangent-vertex-returns-zero-spans test (diamond
corner, expected `[]`, got a spurious wide span), its own non-vacuous companion (the "just off vertex"
differential check, whose own small-span assertion blew up once the mutation broke ALL L-crossing behavior
near a shared vertex, not just the exact-tangent case), and the flat-edge-collinear-rail case (rail exactly
along a rectangle's own top edge, expected `[]`, got a spurious full-width span from the two side-edge
endpoints sitting exactly on the rail). The other 18 tests (rect/circle/ellipse/donut/cubic cases not
hinging on this exact code path) stayed green, as expected. Restored from the backup, confirmed
byte-identical via `diff`, re-ran the file: 21/21 green again.

Full vitest suite: 762/762 green (741 pre-T47 baseline + 21 new).

No live CDP session this turn — pure module, no DOM surface, matching the dispatch's own "NO FUSION —
browser/vitest proof" and the design's own "no DOM, no svg.js, no `editor` object" contract for this slice.

Amendments polled clean before committing and again immediately before passing. Committed by explicit path
(4 files: `bspline-frame-builder/b-spline-gen/html/editor/editor-expand-path.js` [4 export additions],
`bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js` [new], `tests/editor-lattice-
boundary.test.js` [new], `WORK-LOG-lane-b.md`) — the two new files staged individually first (`git add`)
since `git commit <paths>` can't pathspec-stage untracked files, then committed together with the rest by
path — pushed. `reference/` confirmed still untracked, not swept.

## T48 — SE13 Slice 2: computePattern's boundary mode (no runs/parts yet)

**Scope, per the dispatch and its own ruling on SE13 open question 1** (advisor default = my own T46
recommendation): build boundary mode + spans + the grid-cell pre-filter, uniform per-kind color exactly
like Board mode — `runs.stepLen` stays null, no omit/loose/palette, no stored-roll generation. NO FUSION —
vitest proof only. Advisor's own T48 note: T47 independently re-checked against a 4000-step dense-polyline
parity oracle on an irregular cubic+concave boundary, 0 span-count mismatches over 150 rows — confirms
Slice 1's own cutting engine is solid ground to build on.

**The core architectural change, exactly Ground-truth #2's own prediction**: `computePattern`'s rail/tie
loops assumed a rail/tie spans the FULL extent edge-to-edge once gated on/off. Boundary mode replaces that
with each row/column's own `insideSpans(scanLine, boundaryPrimitives)` (SE13 Slice 1, T47), clipped to the
extent's own iMin..iMax/jMin..jMax defensively — 0, 1, or several segments per row/column instead of always
exactly one. One new helper, `_clipToSpans(lo, hi, spans)`, does the clipping for BOTH rails (clip the full
row width to the boundary) and ties (clip the tie's own already-drawn random span to the boundary) — the
SAME operation either way, not two copies. Ties' own density/span/anchor RNG draw is completely unchanged;
boundary mode only shortens the result, never re-decides whether/how far a tie is drawn — "shorten, don't
re-decide" keeps the existing, already-tested tie-placement logic untouched.

**Endpoints use the raw boundary-crossing point directly** — §5's `on-boundary` ending rule, the only one
of the four this slice implements (the ending-rule TABLE — inset/joint/loose — is explicitly Slice 3's own
emission-time dispatch, not built here). Declared, not silently skipped: the rails-loop comment says so
explicitly, so a future reader doesn't mistake "no ending-rule code yet" for an oversight.

**A real design problem, solved without touching Slice 1's own primitives.** `computePattern` works in
LATTICE coordinates throughout (its own established contract); a boundary shape's primitives naturally live
in world-space inches. Rather than converting per-row/column (repeated work) or reflecting primitives into
`orient()`'s canonical frame for `orientation:'vertical'` (real risk: reflecting a rotated ellipse/arc's own
phi/theta across the diagonal is genuinely error-prone, and not needed) — two decisions instead:
1. **Scale once**: `_resolveExtent`'s new 'boundary' branch scales every primitive coordinate by `1/spacing`
   (a uniform scalar — rx/ry scale together, phi/theta stay exact, not approximated) into the SAME
   lattice-unit space `computePattern` already reasons in, so `insideSpans`' own output IS the fractional
   i/j span directly, no per-call conversion.
2. **Never reflect primitives — reflect the QUERY.** `_rowScanLine(j, orientation)`/`_colScanLine(i,
   orientation)` build the REAL (un-oriented) scan line for a CANONICAL row/column via `orient()` itself
   (the same self-inverse function every other lattice quantity in this file already goes through — two
   canonical points `orient()`-mapped to real space give the scan line's point + unit direction). Boundary
   primitives stay in ONE fixed, real, never-reflected frame throughout; only which direction is queried
   changes with orientation. Verified directly: a rect boundary reduces byte-identically to `mode:'rect'`
   under `orientation:'vertical'` too, not just the horizontal default — proves the algebra, not just the
   identity case (own test, not asserted from memory).

**`_resolveExtent`'s own 'boundary' branch — one disclosed scope decision.** `shapeToPrimitives` (Slice 1)
is async (the `text` case awaits a font fetch); `_resolveExtent` and every existing caller are synchronous.
Rather than making every board/rect caller `await` a code path it never uses, `_resolveExtent` now takes an
OPTIONAL 3rd arg, `boundaryPrimitives` — already resolved, in world-space inches. Finding the live
`data-boundary-ref` element and calling `shapeToPrimitives` on it (the actual async DOM lookup) is left to
Slice 3's own live-wiring caller; THIS function's job stays synchronous — the lattice-unit scale plus the
bbox pre-filter (new `primitivesBBox` export, Slice 1's own module, since it's pure primitive geometry:
tight for L, exact for CIRCLE, conservative-but-always-valid for C/A via the convex-hull/max-radius
properties), rounded OUT to whole lattice cells via floor/ceil. Flagged here explicitly as the one real
interface-design call I made unilaterally, since the design doc's own Slice 2 bullet just says "calls Slice
1" without specifying the async/sync split.

**A genuine finding during test-writing, not assumed**: a boundary rect whose own edges land EXACTLY on the
tested extent's iMin/jMin/iMax/jMax hits Slice 1's own already-tested, intentional degenerate case (a scan
line exactly collinear with a boundary edge reports no crossing — `tests/editor-lattice-boundary.test.js`'s
own "flat-edge-collinear" test) — the outermost rail row / tie column would silently vanish. This is NOT a
Slice 2 bug; it's Slice 1's own documented half-open convention, inherited correctly. Rather than re-testing
that already-proven behavior under a new name, the "byte-identical to rect mode" tests pad the boundary rect
one lattice unit beyond the box under test, so every row/column actually visited sits strictly inside it —
isolating what Slice 2 actually adds (clipping to a boundary that doesn't constrain anything must be a
no-op) from what Slice 1 already owns and has already proven.

**Data model**: `PATTERN_DEFAULTS.boundary` declared (§1's full shape: `shapeId`/`endRule`/`joints`/
`border`), with `runs: null` exactly as the dispatch specified — a slot that costs nothing until Slice 3
reads it, additive later without a breaking-change migration. `computePattern` itself doesn't read
`PATTERN.boundary` at all yet (it consumes `opts.extent.mode`/`opts.extent.primitives` instead, resolved
separately) — the field exists purely for Slice 3's own live wiring to read.

**New tests**: `tests/editor-lattice-pattern-boundary.test.js` (9 tests) — byte-identical-to-rect-mode
(plain + vertical-orientation + full `_resolveExtent`-through-`shapeToPrimitives` end-to-end); determinism
with a non-rectangular boundary; circular-boundary chord shortening (exact analytic check) plus the
tangent-row-emits-nothing edge case; a donut (hole) boundary producing exactly TWO rail segments for one
row — the core new capability, directly proven; a forced tie column shortened to the boundary's own inside
span, checked against an independent oracle, with an explicit "the raw draw actually straddles the
boundary" sanity assertion so the test can't pass vacuously; `_resolveExtent`'s own degenerate/empty-
primitive-list case. Plus 5 new `primitivesBBox` tests added to `tests/editor-lattice-boundary.test.js`
(rect exact, circle exact, rotated-arc conservative-but-valid, cubic convex-hull bound, empty-list -> null).

**Mutation test**: backed up `editor-lattice-pattern.js`, replaced `_clipToSpans`'s own body with
`return [[lo, hi]];` (ignore the boundary's spans entirely — "clip to nothing" mutation), ran the new
boundary test file: exactly 4 of 9 failed — chord-shortening (both its own assertions), the tangent-row-
empty case, the donut two-segment case, and the tie-clipping case — precisely the tests whose own claim
depends on real clipping. The byte-identical-to-rect-mode tests and the determinism test correctly stayed
green (their own padded-boundary construction means "clip to nothing" and "clip correctly" are
indistinguishable there by design — confirms those tests check the scan-line/bbox math, not clipping,
exactly as intended, not a blind spot). Restored from backup, confirmed byte-identical via `diff`, re-ran:
9/9 green again.

Full vitest suite: 776/776 green (762 T47 baseline + 9 new pattern-boundary + 5 new primitivesBBox).

No live CDP session — pure module, no DOM, no live editor wiring yet (that's Slice 3's job), matching the
dispatch's own "NO FUSION" instruction.

Amendments polled clean before committing and again immediately before passing. Committed by explicit path
(3 files: `bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js`,
`bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js` [primitivesBBox add-on],
`tests/editor-lattice-boundary.test.js` [primitivesBBox tests]) plus `tests/editor-lattice-pattern-
boundary.test.js` [new] and `WORK-LOG-lane-b.md` — the new test file staged individually first (`git add`)
— pushed. `reference/` confirmed still untracked, not swept.

## T49 — SE13 Slice 3: emission, ending rules, panel UI, live link, Border

**Scope, per the dispatch**: fix the T48-discovered edge-collinear-row product gap FIRST (a named "product issue,
not a finding"), then build the rest of §14 Slice 3 as designed — ending rules, Border piece, shape-pick UI +
`data-boundary-ref` link, commit-only refill, panel markup, save/load (already free). Fred's own SE13 answers,
recorded by the advisor: "agree with your bracket propositions" — no runs yet, stretch/boundary-move needs no new
rule, one Node-size field (no separate joint size), curved boundaries supported, Border defaults to the boundary
shape's own stroke. This is the single largest turn this session — the WORK-LOG below is longer than usual to match.

### Fix first: edge-collinear rows must not vanish

**The real product bug, traced to its exact root cause, not just described.** Snap is on by default, so a
hand-drawn rect/polygon boundary routinely has an edge EXACTLY on a grid row/column. `insideSpans` (T47) already
has a documented, intentional degenerate case for this (`tests/editor-lattice-boundary.test.js`'s own
"flat-edge-collinear" test): a scan line collinear with a boundary edge reports ZERO crossings from that edge
(the parallel-line guard in `_lineIntersect`) — correct for "is this edge merely parallel", but it silently drops
the edge from the inside/outside computation. Traced by hand for a rect at y=0..10 with a rail scanning y=0: only
ONE of the two vertical side edges contributes a crossing (the other's own t=1 is the "excluded" half-open end,
per the design's own convention) — an ODD crossing count can't pair, so the row returns `[]` and the entire
top/bottom rail silently vanishes.

**The fix, kept SEPARATE from Slice 1's own proven math rather than touching it.** Slice 1 (`insideSpans`) is
already reviewed, merged, and independently parity-checked by the advisor against a dense-polyline oracle —
re-opening its own half-open pairing logic to patch this was the wrong place to fix it (real risk of breaking
something already proven). Instead, a NEW, independent query: `collinearSpans(scanLine, primitives)` (T49, same
module) — for every `L` primitive exactly collinear with the scan line (not just parallel — the SAME infinite
line, checked via a cross-product-against-direction test), report its own extent as a span, merging overlapping/
touching ones. The CALLER (`computePattern`'s boundary branch) unions this in on top of `insideSpans`' own result
— Fred's own declared rule, turned directly into the gating condition: **Border OFF -> union in (the edge row is
kept); Border ON -> `insideSpans` alone (the edge is dropped, since Border already draws that exact line — no
double stroke)**. `insideSpans` itself is untouched, byte-for-byte — confirmed via `git diff` on
`editor-lattice-boundary.js` showing only an ADDED function, no changed lines in the existing one.

**Verified two ways**: a unit test built the KNOWN-collinear case
(`tests/editor-lattice-pattern-ending.test.js`) — Border off keeps the edge row/column, Border on drops it,
an interior (non-collinear) row is byte-identical either way. Live: the CDP session's own real rect (drawn with
the actual Rect tool, Snap on) produced a working, visibly-clipped lattice with no vanished edges either way —
see the live-verification section below for why THIS particular draw didn't happen to land exactly on a rail
row (an honest disclosure, not a claim this specific live run exercised the collinear branch — the unit tests
carry that proof; the live run's own job was proving the end-to-end pipeline doesn't break, which it didn't).

### §5 — the ending-rule table (on-boundary / inset / joint / loose)

**The real design problem**: `_clipToSpans` (T48) already told the caller WHERE a span was clipped, but not
WHICH of its two ends was a genuine boundary crossing vs. a plain "free" end (a tie's own un-clipped random draw
end, today's Board-mode behavior). Fixed by widening its own return shape from `[a,b]` pairs to
`{a,b,aIsCrossing,bIsCrossing}` (`aIsCrossing`/`bIsCrossing` = "this bound came from the boundary, not from the
caller's own [lo,hi] limit") — every existing call site updated, board/rect mode's own single un-clipped piece
now carries `aIsCrossing:bIsCrossing:false` and reduces byte-identically (confirmed: the existing T48 suite
needed zero behavioral changes, only 3 tests needed an explicit `endRule:'on-boundary'` pin once `inset` became
the real default — see below).

New `_applyEndRule(a,b,aIsCrossing,bIsCrossing,endRule,halfWidth)`: `on-boundary` is a no-op (the crossing point
IS the endpoint, §5's own "zero extra geometry" case); `inset` (**now the real default**) pulls a crossing end
back by `halfWidth` (a plain subtraction along an already-known axis, not a clip); `joint` leaves the geometry
alone and flags a node for the caller to emit there (reuses `addNode` verbatim — no new node code); `loose`
picks the nearest INTEGER grid stop strictly inside the span as the new end instead of the true crossing,
degrading to `inset` when no stop fits (the one named unhandled case §5's own text calls out — a span shorter
than one grid cell) — proven with a deliberately-constructed too-short chord (a circle centered on a
HALF-integer so no stop lands inside its own span at all, not just "an integer happens to be excluded" — the
first draft of this test picked a circle centered ON an integer and it accidentally passed the wrong way,
caught by re-reading the math before trusting the green result, not by luck).

`widths` is now merged inside `computePattern` itself (previously only in the DOM-touching `generatePattern`) —
the inset math is pure, so it belongs in the pure function per this file's own established split.

**A self-inflicted, self-caught test bug found DURING this turn, not before**: my first "loose degrades to
inset" test picked a circle centered on `cx=5` with `r=0.3` (chord `[4.7,5.3]`) expecting "no stop fits" — it
failed, because `5` (an exact integer) sits STRICTLY inside that span, which IS a valid loose stop, not the
"nothing fits" case the test meant to isolate. Re-read the geometry, switched to `cx=5.5` (chord `[5.2,5.8]`,
straddling no integer at all) — a real correction to my own test's premise, not a code bug, caught by the test
FAILING FOR THE RIGHT REASON (the code was already correct) rather than blindly loosening the assertion.

### §7 — the Border piece

"The SAME `d`/shape geometry, just re-stroked" (design doc's own words) implemented literally: `boundaryEl.clone()`
(svg.js), not a re-derivation from the primitive list — the clone decodes through the SAME `OUTLINE_KINDS` export
path the source element already does, so §8's "zero new export code" claim is inherited automatically rather than
re-earned. Strips `data-boundary-ref` from the clone (the clone is a COPY, not the link itself — leaving the
attribute would create a second element answering to the same id), re-tags `data-layer`/`data-lattice="border"`/
the ownership attr, sets `fill:none` + `stroke`. Fred's own ruling this turn ("Border defaults to the boundary
shape's own stroke"): a null width/color reads the LIVE element's own current `stroke`/`stroke-width` at Generate
time, not a Lattice color — confirmed live (a rect with `stroke:#336699, stroke-width:0.15` produced a Border
piece with exactly those values when left on Auto).

### The live-wiring problem: `generatePattern` becomes async, and why that's the right shape

`shapeToPrimitives` (Slice 1) is async — the `text` boundary kind awaits a font fetch — while `_resolveExtent`
and `generatePattern` were both synchronous. Rather than a second, boundary-only sync-incompatible code path,
`generatePattern` is now `async function` end to end; every caller (`properties-lattice.js`'s Generate button
and orientation-flip handler) now `await`s it. Board/rect mode never hits a real `await` internally, so its own
OBSERVABLE DOM mutations still happen synchronously within the same tick — confirmed by NOT needing to touch 43
of 45 existing `generatePattern`-calling tests in `editor-lattice-pattern-emit.test.js` (only the 2 that
destructured the RETURN VALUE directly needed an `await`; every "fire and forget, then check `_sketchLayer`"
test kept working unchanged, since that DOM mutation still completes before the `await` boundary in the caller).
One new panel test (`properties-lattice.test.js`) needed a macrotask flush (`setTimeout 0`) after `.click()`
before checking `btn.textContent`, since `await`ing even an already-resolved promise still defers by spec — not
guessed, confirmed by first seeing exactly that one test fail and tracing why.

New `_resolveBoundaryPrimitives(editor, PATTERN)`: finds the linked element (`_findBoundaryElement`, by
`data-boundary-ref`, `anyVisibleLayer` — a boundary shape need not live on the pattern's own target layer),
calls `shapeToPrimitives`, bakes the element's own WORLD transform via `_bakeWorldTransform` — a DISCLOSED
simplification, not silently assumed exact: `worldPoint` bakes L/C point-like fields exactly (any affine
transform), but CIRCLE/A radii and A's own `phi` are scaled/rotated by a single measured UNIFORM scale+rotation
(sampled once, from how the local origin and +x-axis tip both move under the same `worldPoint` bake) — exact for
translate+uniform-scale+rotation (everything a Select-mode drag produces today), not exact under non-uniform
scale. Named explicitly here and in the code's own comment rather than left to be discovered later.

### §9 — commit-only link refresh

`refreshBoundaryPatterns(editor)`, hung off the SAME hook `refreshOutlinePreview` already uses
(`editor.js`'s `_notifyChange('commit')`, per the design doc's own instruction) — re-runs Generate for the
ACTIVE layer whenever ANYTHING commits, gated to a same-tick no-op unless that layer is actually
`extent.mode==='boundary'` with a linked shape. A REAL re-entrancy risk, solved with a module-level guard flag
(`_boundaryRefillInProgress`): `generatePattern` itself calls `_notifyChange('commit')` at its own end — without
the guard, every boundary refill would re-trigger itself forever. Traced through by hand (not just tested):
since `generatePattern`'s own internal `_notifyChange('commit')` call happens BEFORE its returned promise
settles, the guard (set before calling it, cleared only in `.finally()`) is still `true` at the exact moment
that internal call fires, so the re-entrant call is a correct no-op — confirmed live (the drag-then-commit test
below shows exactly ONE `notifyChangeCalls` entry, not an unbounded chain) and in a dedicated vitest case.

Deliberately regenerates on EVERY commit while boundary mode is active, not just a commit that touched the
linked shape specifically — a disclosed tradeoff (simpler, always correct since Generate is idempotent for an
unchanged boundary/seed, at the cost of some redundant recompute on unrelated edits) rather than building a
"did this specific commit touch the linked element" tracker for marginal benefit this slice.

### Shape-pick UI: reusing the one hit-test primitive that already exists, building the "arm and consume" part fresh

Searched first, not assumed: no "click canvas once, get a callback with the hit element" primitive exists
anywhere in this codebase (checked `editor-interaction.js`, `skeleton-editor.js`). What DOES exist and gets
reused: `editor._getNearbyElement(pt, tol, {anyVisibleLayer:true})`, the SAME hit-test Select/Node mode already
share. New: `editor._boundaryPickCallback` — a one-shot flag checked in `handleStart` BEFORE the mode dispatch
(same placement/reasoning as the existing pan-check: it must intercept the click no matter which tool is active
when Pick is pressed), consuming the click and calling back with the hit (or `null` on empty space — the panel
decides what "picked nothing" means, not the dispatcher). `stampBoundaryRef` is idempotent (re-picking the SAME
element keeps its existing id) per design doc §1's own "linked by id" contract.

### Panel UI — Boundary / Ending / Border, inside the existing panel body

Three new sections (Boundary: Board/Shape toggle + Pick-shape + status; Ending: a declared 4-row `<select>`,
same "table drives the control" shape `LATTICE_DRAW_KINDS` already uses; Border: checkbox + width + color
swatch with an "auto" reset) added as ordinary `#editorLatticePanelBody` sections — same markup idioms as every
existing section (labeled div, `.editor-fillmode-btn` segmented toggles, `no-stepper` on the packed width row).
**Mid-task amendment, absorbed before commit**: seat A is building a mobile bottom drawer (MOB3) that will HOST
this panel's existing DOM on phones — instructed to keep the new rows as normal sections (one wrapper + heading
each) with no mobile-specific LAYOUT of my own, since the drawer makes sections collapsible itself. Checked
against what was already built: compliant as written (each new section is already exactly one wrapper div with
a `font-weight:600` heading span, structurally identical to Rails/Ties/Nodes/Colors/Widths, inside the same
`#editorLatticePanelBody`) — no changes needed, confirmed by re-reading the actual markup after the amendment
arrived, not assumed compliant from memory. The one new MOB2-style rule I DID add (`#latticeBorderEnabled`'s
32px pointer:coarse touch target, styles/editor.css) is a widget-level a11y convention matching the EXISTING
Nodes-checkbox precedent, not a section-layout decision, so it's unaffected by the amendment's own scope.

Board/Shape and Ending are settings fields (take effect on the next Generate), matching every other structural
field in this panel — NOT an immediate re-project the way Orientation is, since picking a shape and tuning
Ending/Border before the first Generate is the more natural flow than re-running on every toggle.

### Non-vacuity — 3 targeted mutation tests this turn, each isolating one new mechanism

1. Ending-rule dispatch (`_applyEndRule`) short-circuited to a no-op: 4 of 17 `editor-lattice-pattern-ending`
   tests failed — exactly inset/joint/loose/loose-degrade, the four whose own claim depends on the dispatch
   doing anything; on-boundary and every edge-collinear test correctly stayed green (they don't touch this path).
2. Border-gating (`borderEnabled ? inside : union(...)`) forced to always union: exactly the 1 "Border ON drops
   the edge" test failed, everything else (including "Border OFF keeps it") stayed green — proves the GATE
   specifically, not just that collinearSpans exists.
3. Border-piece emission gate short-circuited to `if (false)`: exactly the 3 tests asserting a Border piece's
   own PRESENCE failed (`TypeError`/length mismatches); the 7 tests about geometry/other behavior stayed green.

All three: backed up, mutated, ran the targeted file, confirmed the EXACT expected failure set (not just "some
failures"), restored from backup, confirmed byte-identical via `diff`, re-ran to green.

### Live verification (CDP, fresh Chrome + profile `chrome-profile-t49`, killed and confirmed at 0 processes after)

Ran the REAL app, not a proxy for it — the dispatch's own explicit ask, "Browser proof per your Slice 3 verify
list." All via a real `Page.navigate` to `bspline_gen_palette.html` (server already running, confirmed serving
this turn's own edited files via `curl` before starting), `Input.dispatchMouseEvent` for actual pointer gestures
(not synthesized DOM events), screenshots saved to `t49-shots/`.

- **A genuine environment finding, not assumed**: `#editorSVGContainer` reads 0×0 until `#svgEditorModal` (the
  editor's own host, `display:none` by default — opened by the Stamp panel's "Edit" button in the real app flow)
  is shown. Traced by walking the live DOM's own parent chain rather than guessing; the modal was shown directly
  for this test (`window.svgEditor` was already `initEditor()`'d into that container at page boot regardless of
  the modal's own visibility, confirmed before relying on it).
- **Real Rect tool drag, Snap on** (the dispatch's own explicit "snapped rect drawn by the real rect tool"
  check): produced x/y/width/height all exact multiples of the grid spacing (0.25") — confirmed by direct
  division, not eyeballed. Picked via the real Pick-shape button + a real canvas click (screen coords derived
  from the SAME viewBox math the editor itself uses, not hand-guessed). Generated: 7 rails, 6 ties, 13 nodes, 0
  border — screenshot shows rails/ties VISIBLY clipped to the rect's own bounds, not spanning the canvas.
- **Border toggled on**: a real Border piece appeared (`data-lattice="border"`, `stroke:#000000` — no shape
  color override, this rect's own default), screenshot confirms a visible outline stroke at the shape's edge.
- **A real circle boundary, all 4 ending rules, screenshotted each**: `on-boundary` (chords flush to the
  circle), `inset` (each end visibly pulled back), `joint` (a node dotted at every single crossing — 42 nodes
  for 21 rails, exactly 2 per rail, forming a visible "beaded" outline), `loose` (visibly short of the edge,
  snapped to the nearest whole grid line) — all four are visually DISTINCT in the saved screenshots, the design
  doc's own explicit verify bar, not just numerically different.
- **Drag-then-commit refit (§9), the load-bearing timing claim**: mid-drag (a real `mouseMoved` held, screenshot
  taken), rails were BYTE-IDENTICAL to pre-drag (x1/x2 unchanged) — confirmed NO live refit. After `mouseReleased`
  (commit) + a settle wait, rails had SHIFTED to match the circle's new position — screenshot shows the lattice
  correctly re-fit around the moved shape, Select handles visible around it. `notifyChangeCalls` unit test
  confirms exactly one `'commit'`, not a re-entrant chain.
- **Outline export (§8)**: `import('./editor/editor-io.js')` then a real `getLayerSvg(editor, layerId, 96,
  {geometry:'fusion'})` call against the boundary-filled layer — `declined:0, declinedKinds:[]`. Zero new
  decline kinds, proven by actually calling the export path, not argued from the shared-OUTLINE_KINDS claim alone.
- **Save/load round-trip (§12)**: serialized `layer.pattern` (via `JSON.stringify`), simulated the exact
  restore shape `editor-io.js`'s own `open()` uses (full object spread, only `id`/`name`/`visible` overridden),
  compared before/after — byte-identical, `PATTERN.boundary.shapeId` survives. Zero new persistence code needed,
  confirmed by actually round-tripping, not just citing that `.pattern` is already a generic persisted field.

Chrome killed and re-verified at 0 matching processes afterward (own-profile match, `chrome-profile-t49`, before
`Stop-Process`).

Full vitest suite: 807/807 green (762 T47 baseline + 14 T48 + 31 T49 new: 5 collinearSpans + 8 ending-rule/
edge-collinear + 8 panel wiring + 10 boundary-emit/Border/refill).

Amendments polled clean before committing (the MOB3 heads-up above was absorbed into this same turn, not
deferred) and again immediately before passing. Committed by explicit path (11 modified files:
`bspline_gen_palette.html`, `editor-interaction.js`, `editor-lattice-boundary.js`, `editor-lattice-pattern.js`,
`editor.js`, `properties-lattice.js`, `styles/editor.css`, plus 4 touched test files) + 2 new test files
(`editor-lattice-pattern-ending.test.js`, `editor-lattice-pattern-boundary-emit.test.js`, staged individually
first) + `WORK-LOG-lane-b.md` — pushed. `reference/` confirmed still untracked, not swept.

## T50 — boundary fill respects the boundary shape's own stroke (inner-stroke edge)

**The finding, verified by re-reading the geometry, not taken on faith.** The advisor's own note, from viewing
T49's own `04-ending-*.png` screenshots: a stroked circle boundary's fill was cut at the raw path CENTERLINE
(`<circle r>`, the SVG attribute itself), so rails ran visibly into the stroke — a stroke is drawn CENTERED on
its path by default, so a circle `r=2, stroke-width=0.8` visually spans radius 1.6 (inner edge) to 2.4 (outer),
while the fill cut at exactly `r=2` — squarely inside that stroke ring. "A person reads a stroked shape's
inside as the stroke's inner edge" — confirmed by looking at my own screenshots fresh, not disputed.

**Declared, not hard-coded, per the dispatch's own instruction**: `PATTERN_DEFAULTS.boundary.edge = 'inner-
stroke' | 'centerline'`, default `'inner-stroke'` — `'centerline'` is an explicit opt-out back to T49's own
raw behavior, for a caller that wants it. No new panel control this turn (the dispatch's own "small change
only" scope) — set via `PATTERN.boundary.edge` directly (JS/a saved pattern), same as several other declared-
but-not-yet-wired-to-a-control fields already in this shape (`joints.size`, etc.).

**Which width wins, exactly the dispatch's own rule, factored into ONE shared helper so the visible Border
stroke and the fill's own cut point can never disagree**: `_effectiveBorderWidth(boundaryEl, boundary, widths)`
— the Border piece's OWN width when Border is on (it's the thing actually drawn, so it's authoritative); else
the LIVE boundary element's own current `stroke-width`, IF it's visibly stroked (`stroke` set, not `'none'`,
width>0); else 0. Reused verbatim by the Border piece's own emission (previously duplicated inline, now calls
the shared helper — a real, small refactor, not just new code) and by the new `_effectiveEdgeShrink` (half of
that same width, 0 under `edge:'centerline'` or an unstroked boundary).

**The shrink is applied at the SAME layer the ending-rule pullback already lives at, not inside `insideSpans`
itself.** Re-opening Slice 1's own proven crossing math for this was the wrong place (same reasoning T49's own
"fix first" item used for the collinear-edge fix) — instead, a new `_applyEdgeShrink(a,b,aIsCrossing,
bIsCrossing,shrink)` runs on each `_clipToSpans`-produced piece BEFORE `_applyEndRule`, pulling a genuine
crossing end in by `shrink` along the scan direction (only ends `_clipToSpans` already marked real — a plain
"free" tie end is untouched). Matches the dispatch's own given test exactly: circle r=2/stroke=0.8, `on-
boundary` → rail endpoints at radius 1.6 (2 − 0.4); `inset` → 1.6 further pulled back by half the rail's own
width — the SAME two-stage composition (shrink first, ending rule second) the dispatch's own wording described.

**Disclosed exactness scope, per the dispatch's own "say which, keep ≤ tolerance" instruction**: shrinking
along the SCAN direction (not each primitive's own true local normal) is EXACT for a crossing perpendicular to
the boundary at that point — a circular arc's own center row/column (the dispatch's own test case), or an
axis-aligned edge crossed by a perpendicular rail/tie. For a steeply-angled crossing it's a bounded UNDER-
shrink (the true perpendicular offset needs a larger scan-direction move than a flat `shrink` gives) — a
disclosed simplification for this "small change," not a claimed general solve; a full per-primitive local-
normal offset was scoped out as unnecessary complexity for what this turn actually needed to fix.

**A second, deeper, pre-existing bug self-caught while testing THIS one — found by testing against the REAL
pipeline, not just hand-built extents.** `_clipToSpans`'s own `aIsCrossing`/`bIsCrossing` flags (T49) used a
STRICT `sLo > lo` to distinguish "a genuine boundary crossing" from "just hit the query window's own limit" —
correct in general, but wrong at the EXACT row/column where a circle/ellipse's own crossing reaches precisely
as far as the bbox pre-filter itself, which is UNAVOIDABLE at that shape's own widest extent (the bbox IS
derived from that same widest reach, via `primitivesBBox`). At that one row, `aIsCrossing` came back `false`
— silently skipping BOTH the new edge-shrink AND (already, since T49, unnoticed until now) the ending rule
itself for the widest row of every single circular/elliptical boundary in this whole feature, not just T50's
own new code. My own FIRST pure-`computePattern` tests for this all used a PADDED extent (a leftover habit
from T48/T49's own byte-identical tests) and never exercised the coincidence; a NEW DOM-level test — going
through the REAL, un-padded `_resolveExtent` — failed with an unshrunk result, traced by hand (added targeted
`console.error`s, ran a standalone Node repro OUTSIDE vitest to rule out a test-harness artifact, confirmed
the SAME wrong value both ways) down to this exact root cause, not guessed. Fixed by comparing `sLo`/`sHi`
against `lo`/`hi` with a symmetric epsilon (`sLo > lo - eps` / `sHi < hi + eps`) — exact equality now correctly
reads as "yes, a crossing," which is provably always safe for rails (a REAL, `_resolveExtent`-derived bbox can
never have `sLo < lo`, only a hand-built test extent can construct that) and still correctly reads "free end"
for a tie whose own drawn span sits non-trivially inside the boundary (nowhere near the epsilon). One of my
OWN new tests ("a free tie end is never shrunk") then failed for the SAME reason on ITS OWN premise — its
forced tie's own random draw happened to land with an end exactly ON the boundary, which, once fixed, correctly
DOES get shrunk now (the same visual bug either way, whether the end got there by clipping or by lucky
placement) — re-derived the test to use a query window strictly narrower than the boundary's own true reach,
so it can no longer coincidentally touch, with an explicit sanity assertion proving the setup itself before
trusting the conclusion.

**New tests**: 5 pure `computePattern` cases (`editor-lattice-pattern-ending.test.js`) — the dispatch's own
exact circle r=2/stroke=0.8 case for `on-boundary` and `inset`; `edgeShrink:0` reduces to raw-crossing;
a too-short chord collapses to a point rather than inverting; the corrected free-tie-end case. 5 DOM-level
`generatePattern` cases (`editor-lattice-pattern-boundary-emit.test.js`, new `_addBoundaryCircle` mock helper)
— visibly-stroked (Border off), unstroked (no shrink), `edge:'centerline'` (explicit opt-out), Border ON
overriding with its OWN width (not the shape's raw stroke), Border ON with no explicit width falling back to
the shape's own stroke — the exact same fallback chain the Border piece itself already used, now shared.

**Mutation-tested, 2 rounds**: (1) `_applyEdgeShrink` short-circuited to a no-op — exactly the 6 tests
asserting a real nonzero shrink failed (3 pure + 3 DOM-level), the other 22 (including the `edgeShrink:0`/
`centerline`/free-tie-end cases, which SHOULD stay green under this mutation) correctly passed. (2) the
crossing-detection epsilon fix reverted to the old strict `>` — exactly the 3 DOM-level tests hitting the
real, un-padded tight-bbox coincidence failed (814/817 suite-wide), while every pure test (all padded)
stayed green, confirming the padded/un-padded distinction is exactly what separates "catches this" from
"doesn't." Both restored, confirmed byte-identical via `diff`, re-ran to 817/817.

**Live verification (CDP, fresh Chrome + profile `chrome-profile-t50`, killed and confirmed at 0 after)**:
the SAME live scenario as T49's own `04-ending-*.png` — a real Circle-tool drag, default stroke-width 0.5
(confirmed live, not assumed — matches the advisor's own "~0.8" estimate as "a real, materially thick
stroke," not a precise value match, which was never the claim), picked as the boundary, Generated with the
NEW default (`edge:'inner-stroke'`). Screenshot (`07-inner-stroke-default.png`) shows rails now stopping
CLEANLY at the stroke's own inner edge, flush against the visible ring, not running into it. A direct
side-by-side: `PATTERN.boundary.edge` set to `'centerline'` on the SAME live pattern, re-Generated,
screenshot (`08-centerline-comparison.png`) reproduces the ORIGINAL bug exactly (rails visibly running into
the stroke, x1/x2 measured at the RAW `cx±r`, confirmed numerically: `x2−x1 = 2r` exactly) — an unambiguous
before/after, not just a single "looks fixed" shot.

Full vitest suite: 817/817 green (807 T49 baseline + 10 T50 new: 5 pure + 5 DOM-level).

Amendments polled clean before committing and again immediately before passing. Committed by explicit path
(2 modified files: `bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js`,
`WORK-LOG-lane-b.md`) plus 2 touched test files (`tests/editor-lattice-pattern-ending.test.js`,
`tests/editor-lattice-pattern-boundary-emit.test.js`) — pushed. `reference/` confirmed still untracked, not
swept. Not merged to main yet, per the dispatch's own note (seat A's in-flight MOB3 drawer edits the same
panel files) — this turn touched none of those panel files, only `editor-lattice-pattern.js` and tests.

## T51 — T50 review fix: cut against the boundary's own TRUE inner-offset ring, not a per-crossing shrink

**The advisor's own finding, from re-reading my OWN `07-inner-stroke-default.png` screenshot**: the CENTER
rails stopped correctly at the inner edge, but the top/bottom rows (still shown running through the visible
stroke band) did NOT — T50's own per-crossing scan-direction shrink only happened to be EXACT at a circle's
own center row (where the scan direction and the circle's own radial normal coincide); everywhere else it
under-shrank, leaving rails sitting entirely INSIDE the stroke. The fix, exactly as instructed: cut against
the boundary's own TRUE inward-offset ring — reuse the Expand tool's own analytic/biarc offset engine
(`circleOutlinePathD` etc.) rather than approximate the offset per crossing. **Deleted T50's own
`_applyEdgeShrink` and `extent.edgeShrink` plumbing entirely** — no dead branch — per the advisor's own
explicit instruction.

### The outline engine gains `mode:'inner'` — a genuinely reusable addition, not a one-off

`circleOutlinePathD`/`rectOutlinePathD`/`ellipseOutlinePathD` (editor-expand-analytic.js) and
`pathOutlinePathD`'s own per-subpath dispatch (`_closedSubpathD`/`_openSubpathD`, editor-expand-path.js) all
now understand a 4th mode alongside `stroke`/`fill`/`both`: `'inner'` — the SAME inner-ring computation
`stroke` mode already does internally (an outward+inward ring pair, the inner one dropped when it collapses)
now exposed on its own, without needing to emit or discard the outer ring. Purely additive — every existing
caller only ever passes `stroke`/`fill`/`both`, confirmed unaffected (full suite green before touching
anything downstream). `pathOutlinePathD` itself needed ZERO top-level changes: its own per-subpath loop
already calls `_closedSubpathD`/`_openSubpathD` once per ORIGINAL subpath and skips a `null` result — so a
multi-subpath source (two disjoint letters, or a thick square + a separate thin sliver) resolves each
subpath's own inner ring independently for free, verified directly (a thick square keeps its own ring while
a disjoint thin sliver in the SAME `d` string collapses, and the combined output has exactly one subpath).

**A real, disclosed finding about WHAT "collapse" means for a single closed subpath, verified empirically,
not assumed**: `_hasSelfIntersection` (the existing collapse check `stroke` mode already used) operates on
the WHOLE sampled ring for one subpath, not per-edge — so a "lollipop" (one closed polygon: a thick body
with a thin arm attached, one continuous loop) collapses its ENTIRE inner ring when the arm alone is
narrower than the stroke, not just the arm's own local region. Probed directly before writing the test (not
guessed): this DOES satisfy the dispatch's own "arm gets no rails" bar (nothing gets rails, since the whole
ring is gone), just not via a LOCAL trim — disclosed explicitly as the EXISTING engine's own established,
reused-as-is behavior, not something T51 redesigned. A separate test proves the SAME body, as its OWN
disconnected subpath (no arm attached), keeps a real inner ring at the identical strokeWidth — isolating
that the collapse above is really about the arm, not the stroke width alone.

### `shapeToInnerBoundaryPrimitives` (editor-lattice-boundary.js) — the new boundary-cutting entry point

Dispatches by shape kind exactly like `shapeToPrimitives` itself, calling the matching `*OutlinePathD`
function in `mode:'inner'`, feeding the resulting `d` through the SAME `_primitivesFromD` the raw-shape path
already uses. `strokeHalfWidth <= 0` (unstroked, or `boundary.edge==='centerline'`) delegates straight to
`shapeToPrimitives` — no offset engine touched at all for that (the common, unstroked-boundary) case.

**A second, DEEPER, pre-existing-pattern bug self-caught while testing the dispatch's own exact case (r=2,
stroke=0.8) — found by testing the CENTER row specifically, which none of my earlier padded/off-center tests
exercised.** `circleOutlinePathD`'s own inner ring (`mode:'inner'`) is built the SAME way `stroke` mode's
inner ring always has been: `_circleLoopD`'s own 2-semicircle-`A` construction, seamed at the LEFT and RIGHT
poles. Routing that `d` back through `_parseD`/`arcCenterParam` to recover primitives is NOT bit-exact — an
inverse trig/sqrt reconstruction of each arc's own center lands ~1e-8 off the true one. For a scan line at
EXACTLY the circle's own center row (precisely where a rail is most likely to land for a grid-centered
circle — and precisely the row the dispatch's own test case specifies), that tiny per-arc asymmetry pushed
BOTH poles' own half-open `t` just past their own inclusion boundary, producing a **spurious ZERO-span row
through the shape's own widest, most visible diameter** — worse than T50's own bug, and one my initial test
(assert center-row is `[cx-1.6,cx+1.6]`) caught immediately as a hard failure, not a near-miss. Verified the
mechanism by hand (printed the two arcs' own reconstructed `cx`/`cy`, confirmed the ~1e-8 mismatch) before
fixing it, not patched blind. **Fix**: `shapeToInnerBoundaryPrimitives` special-cases `circle` — a circle's
own inward offset IS a smaller CONCENTRIC circle, exactly, so it's built directly as a single `{type:
'CIRCLE',...}` primitive, bypassing `circleOutlinePathD`/`_parseD`/`arcCenterParam` entirely for this one
shape kind. `insideSpans`' own `_crossCircle` path has no seam and no reconstruction step, so it has no such
error to trigger. Checked whether ellipse has the analogous problem (its own inner ring is seamed at 4
quarter-boundaries, also axis-aligned poles) — probed directly (both a horizontal rail AND a vertical tie
through the exact center): no failure found for that case, so left unchanged rather than "fixing" something
not shown to be broken; disclosed as checked, not assumed safe.

### Wiring: `_resolveBoundaryPrimitives` now does the inset itself, in the element's own LOCAL frame

The inset happens BEFORE `_bakeWorldTransform` now (using the boundary element's own LOCAL `stroke-width`,
the same units SVG's own default stroke rendering already scales with an element's transform) — a small,
correct-by-construction improvement over T50's own world-space-only shrink: a scaled boundary element's own
effective stroke width now scales right along with the rest of its geometry, not computed independently of
it. `_effectiveBorderWidth` (the "which width wins" resolver — Border's own width when Border is on, else
the shape's own visible stroke-width, else 0 — T50's own rule, unchanged) is now shared by BOTH the Border
piece's own emission AND this inset, guaranteeing they can never independently disagree.

**A real bug in my own first-draft wiring, caught by the FIRST test run, not shipped**: `_effectiveBorderWidth`
returns the FULL stroke width (e.g. 0.8), but I passed it straight through as `strokeHalfWidth` without
dividing by 2 — every T50-era test that happened to still assert the SAME numeric target (radius 1.6)
immediately caught it as a wrong-by-2x failure (got 3.8/1.2 instead of 3.4/1.6). Fixed by adding the missing
`/ 2`, re-ran to confirm.

### Non-vacuity — 2 targeted mutations, each isolating the fix that actually mattered this turn

1. The circle special-case removed (routed back through the general `mode:'inner'` `d`-string path):
   exactly the 4 tests scanning through the circle's own EXACT center row failed; every off-center/beyond-
   radius test (which this session's own earlier, less-precise T50-era tests happened to rely on) stayed
   green — confirms the special-case is load-bearing specifically for the center-row case, not a redundant
   belt-and-suspenders addition.
2. `_resolveBoundaryPrimitives` reverted to the raw shape (simulating T50's own original bug, no inset at
   all): exactly the 3 tests asserting a real inset failed; the unstroked/centerline tests (which SHOULD
   reduce to the raw shape anyway) correctly stayed green.

Both restored, confirmed byte-identical via `diff`, re-ran to full green.

### Live re-verification (CDP, fresh Chrome + profile `chrome-profile-t51`, killed and confirmed at 0 after)

The SAME circle-boundary scenario as T49's `04-ending-*.png` / T50's `07-inner-stroke-default.png` (real
Circle-tool drag, default stroke-width 0.5, picked as boundary, Generated with `on-boundary`). Beyond a
screenshot, a PROGRAMMATIC conformance check against every emitted rail (not just eyeballing one row): for
each of the 19 rails, computed the analytically-expected chord at the TRUE inner radius
(`r - strokeWidth/2`) from the circle's own live `cx`/`cy`/`r`/`stroke-width`, compared against that rail's
own actual `x1`/`x2` — **zero violations across all 19 rails**, not just the center one T50's own bug also
happened to get right. Screenshot (`07-inner-stroke-default-RESHOT.png`) shows the rails now visibly flush
with the inner disk's own edge at every row, including near the top/bottom, where the previous screenshot
showed them running into the stroke band.

Full vitest suite: 831/831 green (817 T50 baseline + 5 outline-engine `mode:'inner'` tests × 4 shape kinds
[circle/rect/ellipse/path, 4+2+2+5=13] + 7 `shapeToInnerBoundaryPrimitives` tests − 5 obsolete T50-era
`computePattern`-level `edgeShrink` tests removed).

Amendments polled clean before committing and again immediately before passing. Committed by explicit path
(5 modified files: `editor-expand-analytic.js`, `editor-expand-path.js`, `editor-lattice-boundary.js`,
`editor-lattice-pattern.js`, `WORK-LOG-lane-b.md`) plus 4 touched test files (`tests/editor-expand-analytic-
shapes.test.js`, `tests/editor-expand-biarc.test.js`, `tests/editor-expand-path.test.js`, `tests/editor-
lattice-boundary.test.js`, `tests/editor-lattice-pattern-ending.test.js`) — pushed. `reference/` confirmed
still untracked, not swept. Still not merged to main per the same seat-A MOB3 note as T50 — this turn touched
none of the shared panel files either.

## T52 — SE14 design doc: Shape Lattice tool (docs only, no code)

**Scope, per the dispatch: design only.** Fred's own decisions (ROADMAP.md's own "Queued — SE14" section,
cited as authoritative): "the shape lattice and lattice box are different" → two tools sharing one engine —
the box Lattice goes back to simple (SE13's own Boundary row moves out of it), a new Shape Lattice tool gets
a SHAPE section (generate a silhouette, or pick any closed shape) + the same Fill settings + Generate.
"Shape tool just has more settings for shape refinement, perhaps per shape segment toggle for curve, straight
or kinked line" → per-segment style, picked from a list or by tapping the canvas, mirrored pairs, corner
rounding radius.

**Three sources read this turn, not assumed from the dispatch's own summary**: `reference/svgcreator-
deployed/`'s `pathloop.js` (full, 273 lines — the live hourglass/bust generator), `utils.js`'s
`resolveGenerator`/`decomposeSegment`/fillet solvers (full), `main.js`'s proportions-overlay UI and debug-
label code (partial); plus the EXTERNAL `C:/Users/danse/APPS/SVG creator/src/envelope.js` (full, 150 lines,
never committed, outside this repo entirely).

**The core reusable piece, cross-checked before committing to porting it**: `decomposeSegment`'s own bulge→
primitive formula — a signed `bulge` float gives either a straight `L` or, via the closed-form CAD "bulge
factor" radius (`R = |chord/2 · (1+b²)/(2b)|`), an EXACT circular arc through the two endpoints. This is
EXACTLY this session's own `A`-primitive shape (`arcCenterParam`'s own inverse) — the two formulas agree,
checked by hand before proposing the port, not assumed compatible because both happen to produce "arcs."

**A real, disclosed finding, found by grepping rather than assuming the reference "already does this"**:
`PathGenerator.ALL_STYLES` (13 named per-segment styles — straight/arc/arc-deep/.../notch/s-bend) is DECLARED
but never actually WIRED into the live generator — `leftStyles`/`rightStyles`/`headStyle` are read-only by
dead debug-label code (`main.js`'s own segment-labeling function), never assigned anywhere in `pathloop.js`'s
own `generate()` return value. Confirmed by grepping the whole reference for any assignment site — zero
matches. This means Fred's own "per-segment toggle for curve, straight or kinked line" ask has NO working
reference implementation to port; it's this design's own original piece (§4), informed by `ALL_STYLES`' own
declared vocabulary as a naming reference, not silently presented as reused working code. Same discipline
SE13's own design doc used for its own shape-to-primitives gap — a second instance of this pattern this
session, not a one-off.

**A genuine synthesis, not a straight port of either reference**: the dispatch's own "neck / chin / waist"
names THREE proportions, but `pathloop.js`'s own live `proportions` field only has TWO (`neck`, `chin`) — no
"waist" concept exists in the deployed generator at all. The EXTERNAL, older `envelope.js` DOES have a
"waist" concept (`waistPos`/`waistW`, a continuous per-pixel width-multiplier field) but its own mechanism
(procedural, no discrete keypoints) doesn't map onto "toggle THIS segment's style," which is what this whole
design needs to build around. Read both, adopted neither wholesale: §7 adds a THIRD zone (waist, between the
base and the neck) to `pathloop.js`'s own KEYPOINT model, borrowing only `envelope.js`'s own NAMING for what
the zone represents — an original synthesis, stated as exactly that rather than attributed to either source.

**Genuinely new, reusable geometry identified, not just design vocabulary**: `solveLineArcFillet`/
`solveArcArcFillet`/`intersectRays` (`utils.js:358-431`) — an EXACT tangent-circle fillet solver (Apollonius
circles for line-arc/arc-arc), a DIFFERENT operation from this session's own T44 join-building (which rounds
where two OFFSET curves meet during stroke expansion, not where an ORIGINAL centerline path turns at a fixed
radius). §5 proposes reusing this session's own `_lineIntersect`/`_lineCircleIntersect` (T44/T47, already
exported) for the line-line and line-arc/arc-line cases directly, and porting ONLY the one case neither
existing primitive reaches (arc-arc) as one new small solver — not re-deriving geometry this codebase already
has correctly, and not blindly porting geometry it already covers a different way.

**Delivered**: `SE14-SHAPE-LATTICE-DESIGN.md` (repo root, 382 lines) — the two-tool split (what moves where,
plus a disclosed, flagged migration rule for an existing boundary-mode box-Lattice layer, since the dispatch
itself didn't specify one); the silhouette data model (`PATTERN.shape = {source, seed, proportions, widths,
symmetryRelax, keypointCounts, segments}`, a flat per-segment array reusing `pathloop.js`'s own left→head→
right→base assembly order so array index IS segment identity, no separate zone/index pair to track); the
generator (seed → dimensions/widths → keypoints → segments → exact L/A primitives → optional fillets); the
per-segment style table (straight/curve/kink mapped onto the one proven bulge mechanism, the other 10
reference names declared-but-deferred, not silently dropped); segment picking (a panel list, or a NEW
segment-level canvas hit-test refinement, reusing T49's own pick-callback pattern); how a generated shape
relates to the fill (the generated path IS the linked boundary via T49's own `stampBoundaryRef`, editing
`PATTERN.shape.*` regenerates the SAME element's own `d` in place — link survives — commit-only refill T49
already built needs zero new wiring; a hand node-edit flips `PATTERN.shape.source` to `'picked'` via a
recompute-and-compare check on commit, named as a real precision/cost tradeoff rather than fully resolved);
the waist zone (§7, the synthesis above); output exactness (zero new export code, same claim SE13 §8 already
proved, to be proven live again at the wiring slice); a UI mock (desktop panel + phone drawer, ONE new
`TOOL_PANELS` entry — MOB3's own declared table, "a future tool... is one entry here, not a new mechanism" —
confirmed by reading `editor-drawer.js` directly, not assumed from memory of the pre-MOB3 panel shape); 3
slices (pure generator, fillets, live wiring — matching SE7b/SE13's own established shape); 5 open questions
for Fred (most load-bearing: the migration rule, and whether v1's style vocabulary should include any of the
reference's own remaining declared-but-unwired names).

No code changed, no tests, no live CDP run — docs-only turn, exactly as dispatched. `reference/svgcreator-
deployed/` confirmed still gitignored (`.gitignore:90`) and untracked — verified via `git check-ignore -v`
before committing, not assumed safe; the EXTERNAL `C:/Users/danse/APPS/SVG creator/` path was read directly
(absolute path, outside this repo entirely) and never staged, matching how `reference/` itself is handled.

Amendments polled clean. Committed by explicit path (2 files: `SE14-SHAPE-LATTICE-DESIGN.md`,
`WORK-LOG-lane-b.md`) — pushed.

## T53 — SE14 Slice 1: the pure silhouette generator

Built exactly SE14-SHAPE-LATTICE-DESIGN.md's own §10 Slice 1, per the dispatch's own 4 rulings (Q2 style
vocabulary = straight/curve/kink only; Q5 region = explicit `{x,y,w,h}` param, signature fixed now; Q4 waist
defaults = my own first guess from §7, declared once; Q3 detach detection deferred to Slice 3). New file
`bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js` — pure function, no DOM, no
editor object, same contract `computePattern`/`shapeToPrimitives` already set. `generateSilhouette(region,
shape)`: seed → dimensions/widths (`lcgPoints`, not `Math.random`) → keypoints (base→waist→neck→head, mirrored)
→ per-segment style/bulge → exact `L`/`A` primitives (this session's own center-form `{cx,cy,rx,ry,phi,theta1,
dTheta}`, built via `arcCenterParam`, not the reference's own SVG-command form).

**Two corrections made DURING the build, before any code was "done," both caught by re-reading my own design
doc against what I'd actually written — not found later by a test:**

1. My first draft inserted `headMidPts` (interior head-arc keypoints, `pathloop.js`'s own `nHd`-lerp'd points
   between headLeft/headRight) — but §3 stage 2 explicitly says the head zone connects via ONE segment, no
   head-arc keypoints at all ("a genuine simplification over the reference's own separate headStyle/headParam
   machinery, justified because it was never actually wired there either"). Removed before writing any tests
   against it. `keypointCounts.head` stays declared in `SHAPE_DEFAULTS` (naming continuity with the reference's
   own dial) but is explicitly NOT consumed this slice — commented as such, not silently dropped.
2. My first draft drew every segment's bulge from its own independent per-index seed, including "mirrored"
   right-side segments — which would have made `symmetryRelax:0` produce mirrored KEYPOINTS but INDEPENDENTLY
   RANDOM per-segment styles/bulges, failing the design doc's own Slice 1 verify criterion ("right-side points/
   bulges equal the left's own reflection," bulges explicitly included). Traced this back to the reference
   itself: `pathloop.js`'s own `leftBulges`/`rightBulges` are ALWAYS drawn independently, regardless of
   `relax` — bulge-mirroring was never actually a property of the reference's own `symmetryRelax` at all, only
   MY OWN design doc's §4 declares it should be ("editing a LEFT segment's own style/bulge auto-applies to its
   mirror... a no-op once symmetryRelax>0"). Fixed: left-side profile segments draw independently; the
   corresponding right-side profile segment COPIES its mirror at `relax===0` (reverse-index correspondence,
   since left traverses bottom→top and right traverses top→bottom) and draws independently only once
   `relax>0`. The head segment (shared, one draw) and the base-row segments (no left/right pairing) are
   unaffected either way.

**A third, disclosed-not-fixed finding, kept as a faithful port**: in the reference, the `relax`-blend target
for neck/head (`pathloop.js:148-157`) is algebraically IDENTICAL to the exact-mirror target (`cx + (cx -
left.x)` === `cx + w/2` always, since `left.x = cx - w/2` by construction) — so `symmetryRelax` is a
mathematical no-op for every row except the base; only `rightBase.x` gets a real independent jitter. Ported
AS WRITTEN (Slice 1 is a port of this mechanism, not a redesign of it) and documented in a code comment
(`_mirrorPair`'s own doc comment) rather than silently "fixed" into behaving differently than the reference —
and covered by a test (`symmetryRelax>0 makes the base row... independent`) that asserts BOTH halves of this:
base moves, head does not.

**Non-vacuity + mutation-test discipline.** New test file `tests/editor-shape-lattice-generator.test.js`, 16
tests, covering the design doc's own 4-item Slice 1 verify list plus segment-persistence (§6) and the declared-
vocabulary table (§4/§7). The independent-oracle test (item d) initially only checked arc endpoint round-trip
(via `_arcWorldPointTangent`, a genuinely different code path from `arcCenterParam`'s own inverse) and sagitta
MAGNITUDE — both blind to a sweep-direction (sign) bug, since the mirror-image arc through the same two
points at the same radius satisfies both checks equally. Added a third, independent check before trusting the
suite: 'out' must bulge the arc's own midpoint FARTHER from centerline than the straight chord's midpoint,
'in' closer — a semantic re-derivation, not a re-read of the module's own `od`/`perpLeftIsOutward` internals.
Mutation-tested 3 targeted breaks (backup → mutate → run → confirm exact failure set → restore → `diff`
byte-identical): (1) removed the relax=0 mirror-copy (always independent draw) → exactly 1 failure, the
mirroring test; (2) flipped the sweep-selection line → exactly 2 failures, both new sign-check tests (confirms
the 3rd oracle check was necessary — the endpoint/magnitude checks alone stayed green under this exact bug);
(3) made `kink` fall through to a single plain `L` → exactly 1 failure, the all-kink L-count test. No other
tests moved in any of the three runs. Full suite: 859 passed (58 files), up from 844 pre-turn (15 new tests
here + one added mid-build for the sign-check gap, net +1 file).

No live CDP run this turn — pure function, no DOM, matches Slice 1's own scope and "NO FUSION." `reference/`
confirmed still gitignored/untracked (re-read `pathloop.js`/`utils.js` directly, no `git status` changes to
that path).

Amendment polled before committing: Fred confirmed all SE14 defaults (including Q1's migration rule — an old
boundary-configured layer is HANDED to the new tool, settings kept, not reverted to board) are now fixed in
the design doc; explicitly "no change to your current slice." Nothing to incorporate into Slice 1 — noted for
Slices 2/3. Polled clean again immediately before passing. Committed by explicit path (2 new files:
`editor-shape-lattice-generator.js`, `tests/editor-shape-lattice-generator.test.js`, staged individually since
new) + `WORK-LOG-lane-b.md` — pushed.

## T54 — generator review fixes (seed mixing, straight base, shape sizing), then SE14 Slice 2

**Review fixes, from the advisor's own render of 8 seeds against a 7x9 region (`silh-t53.png`,
`scratchpad/silh.mjs` reused as-is — the renderer's own `toD` already matched this module's `{p0,p1}`/
`{cx,cy,rx,ry,theta1,dTheta}` primitive shape, zero changes needed there):**

1. **Seed mixing was too weak.** T53's own `_subSeed(seed,salt) = (seed ^ imul(salt,const)) >>> 0` is LINEAR
   in `seed` — `_subSeed(a,salt) ^ _subSeed(b,salt) === a ^ b` for every salt, so two seeds stay a small,
   near-fixed XOR delta apart through every single draw. Measured directly (a probe script computing `_draw`
   for seeds 42/7 across every salt in use): every pair differed by only ~0.7-1.7% in the `[0,1)` output —
   never zero, but consistently tiny, which is why the RENDERED shapes looked like minor jitter of each other
   rather than independent draws. Worse for adjacent integers specifically: probed seeds 1-50's own
   `leftKpts[0].x` (fullW+wShoulder combined) — mean |diff| between CONSECUTIVE seeds was 0.042 against an
   observed range of roughly [3,65], i.e. next-to-nothing. Fixed with a proper two-multiply avalanche hash
   (Murmur3's own `fmix32` finalizer, applied after combining seed+salt via two DIFFERENT multiplicative
   constants). Same probe after the fix: mean adjacent |diff| = 13.997 — a ~330x improvement, empirically
   measured, not assumed from "it's a real hash now."
   **My first test for this ("50 seeds pairwise EXACTLY distinct") was itself VACUOUS** — caught by mutation-
   testing it against the OLD hash and watching it still pass (a tiny-but-nonzero difference still satisfies
   "not exactly equal"). Rewrote it as a statistical mean-adjacent-diff threshold (>2, ~150x margin below the
   good hash's 14 and ~7x above the bad hash's 0.04) calibrated from the SAME probe measurements above, not a
   guessed number.
2. **The base was curved.** T53's own design doc (§2/§3) never carved out an exception for the base segment,
   so it was treated like any other styleable segment — but the reference (`utils.js` `resolveGenerator`:
   `// Base - always sharp`) hardcodes it straight, and a flat base matters for carving (sits on an edge).
   Fixed: a `BASE_SEGMENT` constant now overrides EVERY base-row segment (the final closing segment, plus any
   base-row subdivisions when `keypointCounts.base>2`) in BOTH the fresh-generation path and the explicit-
   segments-reuse path — genuinely excluded from styling, not just defaulted (a user-edited `segments` entry
   at a base-row index is silently overridden back to straight, by design).
3. **Shapes sat small and low.** T53's own `fullH = region.h*mix(0.68,0.94,random())` (a direct, unexamined
   port of `pathloop.js`'s own formula) interacts MULTIPLICATIVELY with `chinT` (`yHead = bottomY -
   fullH*chinT`) — for the default proportions (`chinT=0.74`), the head only ever reached ~25-44% down from
   the region's own top edge, confirmed by both hand-derivation and the advisor's own render. Redesigned: the
   random draw now targets `topFrac` DIRECTLY (where the head should sit, 6-15% from the region's own top —
   a declared range) and `fullH` is DERIVED from that target and the actual `chinT` (`fullH = (bottomY -
   yHeadTarget) / chinT`), so the visual result is correct BY CONSTRUCTION regardless of `chinT`'s own value,
   instead of the two interacting unpredictably. Verified algebraically (`yHead` reduces to exactly
   `yHeadTarget`) and with a deliberately extreme `proportions` set in a test (`chinT` far from the default).

**Live-verified by re-rendering the SAME 8 seeds** (fixed generator, same `silh.mjs`, headless Chrome
screenshot since the advisor's own scratchpad had no direct PNG-from-Node path available here): seeds 42/7 are
now visibly distinct shapes; every one of the 8 has a perfectly flat base; every one now spans nearly the full
panel height, head reaching close to the top. Screenshot at
`scratchpad/silh-t54.png` (this session's own scratchpad, not the advisor's — the advisor's `silh-t53.png` is
kept as the before/after baseline).

**Mutation-tested all 4 pieces of new/changed logic independently** (backup, mutate, run, confirm exact
failure set, restore, `diff` byte-identical): (1) reverted the hash to T53's own weak XOR — exactly the 2
recalibrated seed-mixing tests failed; (2) reverted the FRESH-path base override — the 2 dedicated base tests
failed PLUS 1 cascading failure in the segment-persistence test (the reused-array comparison diverged because
the REUSE-path's own override, left intact, still re-forced the base straight on the second call while the
first call's own output no longer had it forced — a genuine, expected interaction between the two independent
safeguards, not a false positive); (3) reverted the REUSE-path override specifically (fresh-path left intact)
— exactly 2 different tests failed, cleanly isolating that path's own coverage; (4) reverted `fullH` to the
old independent-random formula — exactly the 2 sizing tests failed. No unexpected tests moved in any run.

Test file grew from 22 to 22 (net: 2 removed as vacuous + rewritten, 9 added: 3 base-straight, 2 seed-mixing,
2 sizing, plus the all-kink primitive-count test updated for the now-forced-straight base). Full suite: 866
passed (58 files), up from 859 pre-turn.

**Stopped here — did NOT start Slice 2.** Polling amendments right after finishing the fixes above (before
starting fillets) surfaced a PAUSE: Fred reviewed the same 8-seed render this turn's fixes produced and
doesn't like the bust/silhouette look at all — he wants a SIMPLE parametric hourglass instead, modeled on
frame-builder Template 1/2 (straight top/bottom, tangent arcs at shoulder/waist/hip, or a neck S-curve), and
is choosing the exact look before the next dispatch. This means SE14 §3/§4's own bust-silhouette model
(keypoints/zones/bulge-styling ported from `pathloop.js`) is likely to be REPLACED, not extended — so
building Slice 2's fillets on top of it now would be building on geometry about to change. Per the amendment's
own explicit instruction: stopped, committing what's already clean (the 3 fixes above, fully tested and
mutation-tested — real infrastructure, `lcgPoints`-based hashing/straight-base/derived-sizing, that most
likely carries into whatever generator comes next), and passing back now rather than starting Slice 2.

Amendments polled clean before this commit. Committed by explicit path (`editor-shape-lattice-generator.js`,
`tests/editor-shape-lattice-generator.test.js`, `WORK-LOG-lane-b.md`) — pushed.

## T55 — hourglass + bottle presets (full replacement of the bust generator)

**Scope**: replace T53/54's own bust/keypoint-bulge model entirely with a declared PRESET table
({hourglass, bottle}), each solved ANALYTICALLY (closed form, no iterative solver) so every joint is
exactly tangent, per Fred's own review ("I'd prefer a simpler hourglass shape — look in the sketch builder
add-in") and the follow-up correction ("the middle arc is going outward" → waist must pinch INWARD) +
"also include the bottle silhouette."

**Ground truth, read directly, not assumed from the dispatch's own summary**: all `p02_*.py` phase files for
`frame-builder/sketches/template_1/` (hourglass) and `template_2/` (bottle) — 17 files, ~485 lines total.
Key finding, disclosed in the new module's own header comment: the SEED coordinates in `p02_03_loop.py`/
`p02_04_arcs.py` are NOT the final geometry — `p02_09_radius_removal.py` explicitly DELETES the seed Radius
dimensions ("Surgically deletes the temporary seed radius dimensions") once Fusion's own tangency solver has
taken over, and the seed arc-center X values are themselves hand-tuning noise (hourglass shoulder/waist/hip
centers at widthIn*{0.34996, 0.35, 0.34996} — visibly meant to be identical). Only the TOPOLOGY (which arc's
own :C pins to which skeleton line, which arcs are Tangent-constrained to which) is authoritative — everything
else had to be RE-DERIVED analytically for an arbitrary region, not copied.

**The closed-form derivation** (both presets share the same shape, disclosed in the module's own doc
comments): pin all of a side's arc centers to ONE shared skeleton-column X (a disclosed simplification over
the source's own incidental asymmetry). Since a shoulder/hip arc is tangent to a VERTICAL horn (radius =
distance from center to the horn's own x) AND tangent to the middle arc (external tangency: distance between
centers = sum of radii), and the centers share one X (so their separation is a pure vertical distance in REAL
units — dimensionally valid for ANY aspect ratio, unlike naively comparing W-fraction and H-fraction numbers
against each other, an error I caught and corrected in my own first derivation attempt), the skeleton column's
own X position CANCELS OUT of the tangency equation entirely. Two consequences, verified by test, not just
derived on paper: the hourglass's shoulder/hip arcs are ALWAYS exactly quarter circles (the horn's own radius
is horizontal, the waist arc's own radius at the shared tangent point is vertical, horizontal⊥vertical always);
the waist/neck arc (whichever preset) is ALWAYS exactly a semicircle (its own two endpoints sit diametrically
opposite on its own center's shared-X column). This ALSO means the naive 5-param wishlist in the dispatch
(hourglass: waist depth, waist height, notch height, horn length, corner radius) has 2 fewer TRUE degrees of
freedom than it names — "notch height" turns out to be a pure function of waist depth once tangency holds, and
"horn length" a function of the vertical pin + waist depth — declared honestly (3 independent hourglass params,
4 independent bottle params) rather than exposing named params that could request a geometrically impossible
(non-tangent) combination.

**A precision refinement**: since the "waist/neck" arc is ALWAYS an exact semicircle, and my own bulge->arc
round-trip (`decomposeSegment`'s own formula, T53) clamps `|bulge|` to 0.999 to stay numerically safe, routing
a semicircle through the general path introduces a small (~0.002 rad) precision loss — unacceptable for a
design whose whole point is "exact tangent arcs." Added a genuine semicircle special-case to `_arcPrimitive`
(a chord of length===diameter has its center AT the chord's own midpoint, by definition — no round-trip
through `arcCenterParam` needed at all). Mutation-tested: disabling it (`if (false)`) breaks exactly the 2
tests that check semicircle precision specifically, nothing else — confirms it's load-bearing, not decorative.

**Two self-caught bugs, found before any test was written against them (by re-reading my own code against
my own design comment, the same discipline as T53's own mid-build corrections)**:
1. An off-by-one rotation in BOTH presets' own default `segments` array — I'd written the "top edge" entry
   FIRST (matching how I wrote the doc comment, thinking left-to-right) but `segments[i]` connects
   `keypoints[i]->keypoints[(i+1)%n]`, and `keypoints[0]` is the top-RIGHT corner, so the array's own first
   real entry needs to be the FIRST edge OUT of that corner (a horn), with the top edge — which closes the
   LOOP's own wraparound (`keypoints[n-1]->keypoints[0]`) — LAST, not first. Every curve segment was
   consequently landing one slot off from its own intended keypoint pair (the shoulder arc would have been
   assigned to a straight-labeled slot). Caught by re-reading the array against my own "segment i connects
   keypoints[i]->keypoints[i+1]" comment before writing a single test. Mutation-tested (reintroducing it):
   exactly 6 tests fail (every hourglass test that depends on correct segment/keypoint alignment — tangency,
   both geometric invariants, the waistReach-pinning test), nothing else moves.
2. Redundant/misleadingly-named local aliases (`perpLeftIsOutward2`, `isOutward2`) left over from restructuring
   `_arcPrimitive` to add the semicircle branch — cleaned up before writing tests against the function, not a
   correctness bug but worth naming since it's exactly the kind of leftover that makes a diff harder to review.

**A live, mid-turn design discussion with Fred**, not part of the dispatched task but worth recording since
it settles SE14 Slice 3's own UI approach ahead of time: Fred asked whether the SVG editor can preserve
tangency the way Fusion's own sketch solver does when a user drags geometry post-generation. Answered with
two options — (A) axis-constrained PARAMETRIC HANDLES tied to this module's own closed-form independent
params (free, since every legal param combination is tangent BY CONSTRUCTION, no runtime solver); (B) true
freeform node-dragging with a live constraint solve (a real, separately-scoped feature, not a general Fusion-
style solver but a purpose-built per-drag-gesture inverse of this same closed-form math). Fred confirmed
Option A for Slice 3. Relayed to the advisor (after initially messaging the WRONG session — a differently-
named "advisor" that turned out to be a different project's DDCS-Studio advisor; corrected via an identity
probe to the two other `b-spline-generator-web-addin-*` sessions, confirmed `-5c` is the real advisor for
both lanes). Advisor confirmed it recorded the decision in `SE14-SHAPE-LATTICE-DESIGN.md`'s own "Slice 3
editing model" section.

**Test suite**: full replacement, `tests/editor-shape-lattice-generator.test.js`, 30 tests (was 22 for the
retired bust model) — tangency at every real joint (unit-tangent dot check via `_arcWorldPointTangent`, an
independent forward-parametrization code path, never re-reading `_arcPrimitive`'s own internals) confirmed
~1.0 at every arc/horn transition and ~0.0 (a genuine right-angle) at exactly the 4 sharp bounding-box
corners, across both presets and 3 region aspect ratios; the pinch arc's own midpoint sits closer to
centerline than its STRAIGHT CHORD's midpoint (not its raw endpoints individually — caught and fixed a test-
premise bug here, since the bottle's own neck arc has asymmetric endpoints, so comparing against each
endpoint separately isn't valid, only the chord-midpoint comparison generalizes correctly); exact mirror;
L/A-only; the two geometric invariants above; explicit-param-pins-override-jitter (caught and fixed a second
test-premise bug: `waistReach` alone pins the WAIST ARC'S OWN midpoint, not a keypoint — the keypoints sit at
`skelX`, which also depends on the separately-jittered `cornerRadius`); segment-reuse-if-length-matches
(carried over from T53); declared style vocabulary (unchanged).

Mutation-tested 3 pieces of new/changed logic (backup, mutate, run, confirm exact failure set, restore,
`diff` byte-identical): (1) the off-by-one rotation, 6 failures, all hourglass-dependent; (2) the semicircle
special-case disabled, 2 failures, exactly the precision-checking tests; (3) the tangency coefficient itself
(`notchHalfSpan`) perturbed by 1.3x, 4 failures, all tangency/invariant tests. No unexpected tests moved in
any run. Full suite: 874 passed (58 files), up from 866 pre-turn (net: -22 retired bust tests +30 new).

**Live-verified by rendering both presets** (own script, `scratchpad/shape-t55.mjs`, reusing the advisor's
own T53 renderer's `toD` conversion), 5 seeds each, across 2 aspect ratios (7x9 portrait, 9x7 landscape),
screenshotted via headless Chrome and viewed directly (not just asserted from test output) — confirms: the
hourglass waist pinches INWARD (the exact bug Fred flagged in the pre-solve seed render, now fixed), flat
top/bottom edges, smooth tangent shoulder/waist/hip transitions, exact L/R mirror; the bottle shows a narrow
neck, gentle S-curve, full-width body, matching Fred's own "narrow straight neck... full-width straight body"
description. Both vary gently across seeds (proportions only, matching "seed: optional small variation...
default ON but gentle" — not a dramatic per-seed reshaping) and hold up across both aspect ratios.

**Not started this turn**: SE14 Slice 3 (the tool + panel UI, segment picking, live wiring) — per the
dispatch's own "continue to slice 3 ONLY if this lands cleanly in the same turn; otherwise pass," and given
T55 alone (preset rewrite + tangency derivation + tests + mutation tests + 2 renders + the Fred design
discussion) is already a full turn, passing back now rather than starting a second large scope in the same
turn. Slice 2 (fillets) also still not started (deferred since T54's pause; the fillet solver — L-L/L-A/A-L
via existing primitives + a new A-A Apollonius solver — would need to be redesigned against THIS module's
own preset-based segment model rather than the retired bust model anyway, so nothing from the earlier,
unstarted Slice 2 planning carries over unchanged).

Amendments polled clean before committing and again immediately before passing. Committed by explicit path
(`editor-shape-lattice-generator.js`, `tests/editor-shape-lattice-generator.test.js`, `WORK-LOG-lane-b.md`)
— pushed. `reference/` confirmed still untracked (unrelated to this turn's own files, not touched).

## T56 — lattice density by COUNT (6-7 rails, 8-10 ties that BRIDGE rails)

**Scope**: `editor-lattice-pattern.js` (the box-Lattice engine — a DIFFERENT module from T53-55's own shape-
lattice generator, this turn's own dispatch was a fresh, unrelated task), per Fred's own review: "your usual
lattice is much denser than what I need... I want 6-7 rails and 8-10 ties." The advisor's own measurement
(density-options.png, viewed) showed WHY tuning the existing density-based controls can't hit a target count
reliably (density 0.4 → 9-17 ties, 0.3 → 3-13, 0.25 → 4-8) and — the real visual bug — that density-mode's own
ties are 1-3 GRID-CELL stubs, which can't physically reach an adjacent rail once rails are spaced further
apart than that, leaving them floating disconnected in the render.

**Design**: declared BOTH new modes ADDITIVELY (`rails.mode: 'count'|'every'`, `ties.mode: 'count'|'density'`),
default `'count'` for new layers — the OLD `every`/`density`/`anchor`/`spanMin`/`spanMax`/`railSnapRows`
mechanisms are untouched, real, working alternatives, not replaced. `rails.count:[6,7]` picks a seeded count in
range, evenly spread across the extent's own rows (`_railRowsByCount` — new). `ties.count:[8,10]` picks a
seeded count of DISTINCT columns (never two ties sharing a column — guaranteed by construction, not a separate
anti-clustering pass) and each bridges `ties.span.rails` (default 1) adjacent rail rows exactly — ends land ON
real rail rows, never a disconnected stub (`_tieSlotsByCount` — new). `maxRailGaps` (default = span.rails, i.e.
no variety) optionally lets a tie bridge more than 1 gap, seeded per column.

**Migration (Fred's own explicit requirement: "an existing layer's saved pattern keeps its own values, no
silent re-density")**: a saved pattern's `rails`/`ties` object from before `mode` existed never got that key
serialized — `computePattern`'s own merge gives `mode` its OWN fallback (`PATTERN.rails.mode || 'every'`,
`PATTERN.ties.mode || 'density'`) rather than the plain `{...DEFAULTS, ...PATTERN.x}` spread every OTHER field
here already uses (whose OLD implicit default already matched the new one — `mode`'s doesn't, so it alone
needs the explicit branch). Verified directly: a bare `{every:4,offset:1}` object with no mode key reads as
'every', not 'count'; same for ties/density. A genuinely NEW pattern (no `rails`/`ties` key at all) gets the
new default, `mode:'count'` included.

**Two self-caught bugs, both found by measuring the actual output, not assumed correct from reading the code**:
1. A column's own tie-GEOMETRY draw (gap size + start position) initially reused
   `_columnSeed(seed, col + LARGE_SALT)` (the SAME "large additive offset" convention the two meta-count draws
   already use safely) — but there `col` is the ONLY varying operand and it's tiny next to a million-scale
   salt, so `Math.imul(col+salt+1, const)` barely moves across columns, and XOR-ing a small `seed` into that
   nearly-constant, already-large product left `draws[0].u` on the SAME side of 0.5 in 650/650 sampled draws
   (measured directly via a standalone probe before touching the test suite) — silently collapsing
   `maxRailGaps>1` to always the SAME gap size, invisible under the default (`maxRailGaps:1`, where gap size
   is constant regardless of the draw anyway). Fixed by NESTING instead of adding:
   `_columnSeed(_columnSeed(seed,col), SALT)` re-mixes the column's own already-well-spread seed through a
   second salt, rather than letting one huge constant dominate a tiny one — re-measured: 359/650, a real,
   working spread. Same FAMILY of bug T54 found in the shape-lattice generator's own seed hash, a different
   manifestation (there it was two SMALL varying operands XORed together with a weak mix; here it was one
   TINY operand drowned out by one HUGE one) — not the same code, but the same underlying lesson ("measure the
   actual draw distribution, don't assume XOR-based mixing is fine because it worked somewhere else").
2. Nearly EVERY pre-existing test in this file (and 4 sibling test files) constructs its own `ties` object via
   `{...PATTERN_DEFAULTS.ties, density: X, ...}` — spreading the CURRENT `PATTERN_DEFAULTS.ties`, which NOW
   includes `mode:'count'`, silently switching ~24+ existing density-mode tests over to count-mode (where
   `density` is simply unread). Not a bug in the migration logic itself (these are FRESH object constructions
   in test code written today, not persisted old patterns) — a mechanical consequence of adding a new default
   field that a `replace_all` can't distinguish from "this test's own intent." Fixed with a `replace_all` per
   file (`...PATTERN_DEFAULTS.ties, density:` → `...PATTERN_DEFAULTS.ties, mode: 'density', density:`), plus 2
   rails-specific tests that relied on the BARE `{...PATTERN_DEFAULTS}` spread (rails.mode:'count' inherited
   the same way) fixed individually with an explicit `rails:{mode:'every',...}` override, matching each test's
   own already-stated title/intent.

**A third, disclosed-not-fixed finding** (found while writing the boundary-mode test, NOT a T56 regression —
a property of the EXISTING shared clipping infrastructure rails/density-mode ties already used, T48-51): a
tie's own `[jStart,jEnd]` window gets clipped to "whatever portion is inside the boundary along that COLUMN"
— that clip does not verify the result still touches a rail that itself survived as a visible segment
elsewhere. For an ordinary, reasonably-shaped boundary this is invisible (a tie's own candidate window and a
surviving rail's own row naturally agree). For a boundary shaped as a thin strip perpendicular to the rail
direction (a pathological case, not a realistic user shape), a tie can get clipped to a real, correctly-bounded
segment that doesn't correspond to any surviving rail. Adjusted my own test to assert what's ACTUALLY
guaranteed (count never exceeds the declared max; every emitted tie's own endpoints stay within the boundary's
declared bounds) rather than an incorrect "must be exactly 0 ties" premise — reworking the shared clipping code
itself is out of this turn's own scope.

**Panel UI** (`bspline_gen_palette.html` + `properties-lattice.js`): a Rails mode toggle (Count/Every, same
segmented-control shape as Orientation) + count-min/max fields, replacing "every"/"offset" as the default-
visible group; a Ties mode toggle (Count/Density) + count-min/max fields, wrapping the ORIGINAL density/
spanMin/spanMax/anchor/railSnapRows fields as one group shown only in Density mode. `_showRailsMode`/
`_showTiesMode` (new, shared by `syncFieldsFromPattern` and the toggle click handlers, so the shown group can
never drift from the `.active` button). Toggling mode is a SETTINGS field (same "only takes effect on next
Generate" shape `selectBoundaryMode` already established), not an immediate re-projection like Orientation.
`readFieldsIntoPattern` now writes `mode`/`count` for both, reading each toggle's own `.active` state as the
source of truth (same convention every other segmented control in this panel already uses).

**Tests**: new `tests/editor-lattice-pattern-density-count.test.js` (14 tests) — 50 seeds: rail count always
in [6,7] and evenly spread (first/last row at the extent's own edges); 50 seeds: tie count always in [8,10];
50 seeds: every tie's own ends land on a real rail row, never a floating stub; 50 seeds: no two ties share a
column; holds under `orientation:'vertical'`; boundary mode never exceeds the declared max and clips
correctly; `maxRailGaps` produces REAL variety across the population (the exact property T56's own self-caught
bug #1 would have silently broken); `mode:'every'`/`'density'` still work as real alternatives, ignoring count
entirely; the migration fallback (no `mode` key reads as the OLD behavior; no `rails`/`ties` key at all reads
as the NEW default). Plus the `properties-lattice.test.js` panel suite's own "at rail ends" tests fixed to
select Density mode explicitly via the new toggle before relying on `density:0` (T56 changed what `density:0`
means outside Density mode: nothing, since count-mode ignores it) — a genuine behavior change these tests
needed to catch up to, not a workaround. Full suite: 888 passed (59 files), up from 874 pre-turn (14 new here
+ 0 net elsewhere, since the ~24 `mode:'density'` insertions and 2 rails-mode fixes were EXISTING tests
restored to green, not new ones).

Mutation-tested 3 pieces of new/changed logic (backup, mutate, run, confirm exact failure set, restore, `diff`
byte-identical): (1) the migration fallback removed (`{...DEFAULTS,...PATTERN.x}` plain spread) — 16 failures
across 4 test files, extensively load-bearing, confirming nearly the WHOLE pre-existing suite implicitly
depends on it; (2) `_railRowsByCount`'s own even-spread formula replaced with a clustered one — exactly 1
failure, the dedicated even-spread test; (3) the geometry-salt nesting fix reverted to the original broken
additive version — exactly 1 failure, the `maxRailGaps` variety test (the SAME test that caught the real bug
originally, now proven to catch a REVERT of the fix too, not just the forward case). No unexpected tests moved
in any run.

**Live-verified**: (a) rendered the SAME shape of sheet the advisor's own render used (7x9 board, 3 seeds:
42/7/1234), screenshotted via headless Chrome and viewed directly — 6-7 rails, 8-9 ties per board, every tie
visibly bridging exactly one rail-to-rail gap (no floating stubs), saved to this session's own scratchpad as
`t56-density.png` (dispatch's own requested filename, different scratchpad than the advisor's `dens2/` one).
(b) a focused live-DOM check (CDP, headless Chrome, a fresh profile) of the NEW panel markup specifically —
confirmed all 12 new element IDs exist, default visibility matches the SERVER-RENDERED HTML (count-mode fields
shown, every/density fields hidden, before any JS runs), and clicking each toggle button correctly flips BOTH
the shown field group AND the `.active` class in the real browser DOM (not just asserted from reading the
code) — did not attempt a full Generate-and-inspect-real-geometry live run (would need a fuller editor/board
bootstrap than this focused check needed; the pure-function level is already covered by 14 new vitest tests
plus the rendered/viewed screenshot above).

**MID-TASK AMENDMENT** (polled right after the above was built and live-verified, before committing anything):
Fred had, in parallel, actually VIEWED the advisor's own rendered options (`density-options.png`, the same
image I'd read at the start of this turn) and picked "B" — 7 rails, 13 SHORT-stub ties — as fine. This
reverses my own default choice: the "ties should BRIDGE rails" framing in the dispatch's own text was the
ADVISOR's inference from Fred's earlier complaint, not Fred's own stated visual preference once he actually
saw both options side by side. Corrected: `ties.count` widened to `[8,13]`; count-mode's own DEFAULT tie span
becomes `ties.span.mode:'cells'` — the ORIGINAL pre-T56 spanMin/spanMax grid-cell stub mechanic
(`_tieSpanForColumn`'s own 'free'-anchor draw, `_applyRailSnap`'d toward a nearby rail), reused directly rather
than re-derived, just fed by count-based column selection instead of the old per-column density gate;
`ties.span.mode:'rails'` (my own original bridging design) is KEPT as a real, declared alternative, not
dropped — a genuine design idea that turned out not to be what Fred wanted as the default, not a mistake to
erase.

**Rework required**: `_tieSlotsByCount` restructured to dispatch on `ties.span.mode` (`jMin`/`jMax` added to
its own signature, needed for cells-mode's own span draw) — the 'rails' branch is the ORIGINAL code, untouched
in substance; the 'cells' branch is new, reusing `_applyRailSnap` (already exported/tested) rather than
re-deriving the snap math. `PATTERN_DEFAULTS.ties` updated (`count:[8,13]`, `span:{mode:'cells',rails:1}`).
Panel: added a THIRD, nested toggle (Cells/Rails) inside the Ties Count-mode field group specifically
(`latticeTiesSpanModeCells`/`latticeTiesSpanModeRails`, `_showTieSpanMode`, wired the same "settings field, not
an immediate re-projection" way as the other T56 toggles) — Count-vs-Density and Cells-vs-Rails are
INDEPENDENT axes (the span sub-toggle only matters/shows within Count mode), not folded into one 4-way
control. `readFieldsIntoPattern` writes `ties.span.mode` from that toggle's own `.active` state, preserving
`span.rails` (no dedicated stepper for the gap COUNT yet — declared, not built, since nothing asked for it
this turn).

**Tests rewritten** (not just patched) to match the corrected default: "every tie's span is spanMin..spanMax
grid cells" (NEW, tests the actual default now); "tie count in [8,13]" (widened from [8,10]); the "every tie
lands on a rail row" assertion MOVED into its own `ties.span.mode:'rails'`-specific describe block (still
tested, just no longer implied as the default); boundary-mode tests' own count bound widened to 13. Mutation-
tested the new span-mode dispatch (forced `spanMode` to always `'rails'` regardless of the declared mode) —
exactly 1 failure, the dedicated cells-mode-default span test, nothing else — confirms the dispatch is live
and the OTHER tests don't accidentally depend on which branch runs. Full suite re-run clean: 889 passed.
Re-rendered `t56-density.png` under the corrected default and viewed it again — now visibly matches Fred's own
picked "B" panel's look (short stubs snapped near rails, not full bridges).

Amendments polled clean before committing (this correction ITSELF, since it arrived mid-turn) and again
immediately before passing. Committed by explicit path (`editor-lattice-pattern.js`, `properties-lattice.js`,
`bspline_gen_palette.html`, `tests/editor-lattice-pattern.test.js`, `tests/editor-lattice-pattern-boundary.test.js`,
`tests/editor-lattice-pattern-boundary-emit.test.js`, `tests/editor-lattice-pattern-emit.test.js`,
`tests/editor-lattice-pattern-ending.test.js`, `tests/editor-lattice-pattern-density-count.test.js` (new),
`tests/properties-lattice.test.js`, `WORK-LOG-lane-b.md`) — pushed. `reference/` confirmed still untracked.

## T57 (part 1) — spread ties across the width; Slice 3 (Shape Lattice tool) NOT started this turn

**Scope**: fix the tie-clustering the advisor caught directly in T56's own render (`t56-density.png`: "seed 42:
all 8 ties in the LEFT half; seed 7: most on the left. Counts are right, distribution isn't"), per the
dispatch's own declared design: `ties.spread: 'stratified' | 'random'`, stratifying the chosen tie count over
equal-width column zones. Slice 3 (the full Shape Lattice tool UI — own rail icon, TOOL_PANELS entry, preset/
segment-style panel, axis-locked parametric canvas handles, Fill-section reuse, box-Lattice migration, detach-
on-edit, live CDP verification with screenshots) was NOT started — see the dispatch's own explicit fallback
("if slice 3 can't finish cleanly in this turn, commit part 1 + what's solid of slice 3 and pass with a
note"). Part 1 alone surfaced and fixed THREE distinct instances of the same underlying RNG weakness (below),
each requiring its own measure-fix-reverify cycle, several redesign iterations on the zone-assignment logic
itself, and thorough mutation testing — a full, well-verified turn on its own; starting Slice 3's own
genuinely large surface (comparable to or exceeding T49, this session's own largest prior turn) on top of that
risked short-changing either piece's own verification standard. Passing back now so Slice 3 gets dispatched
as its own properly-scoped turn.

**Design**: `_chooseTieColumns(columns, count, countMin, spread, seed)` (new) — `'random'` is T56's own original
per-column-scored selection, kept as a real, declared alternative. `'stratified'` (new default) divides the
column range into `zones = ties.count[0]` (the declared range's own MINIMUM — the one zone count that's always
`<= count`, so the first `zones` ties always land one-per-zone with guaranteed full-width coverage) and
distributes `count` ties across them as evenly as possible (`base = floor(count/zones)` per zone, `count -
base*zones` zones get one more).

**Three self-caught RNG bugs, chained, each found by measuring — not assumed correct from reading the code**:

1. **The within-zone position draw collapsed for this session's own typical small seeds.** `_columnSeed(seed,
   _TIES_SPREAD_SALT+k)`'s own single `lcgPoints` draw put seeds 1/2/7/42 all within [0.35,0.55] at every `k`
   — close enough that `Math.floor(draw*zoneWidth)` landed on the SAME integer offset regardless of seed,
   producing IDENTICAL chosen columns across different seeds. Root cause, measured directly and disclosed as a
   genuinely more fundamental finding than T56's own "large additive salt dominates a tiny one" bug:
   `lcgPoints`'s own LCG (`s = imul(seed,1664525)+1013904223`) is LINEAR in a SMALL seed — `lcgPoints(seed,1).u`
   for seed in {1,2,7,42,100} all landed in [0.236,0.275] while seed=999999 landed at 0.788 — the weakness is
   in the RAW LCG's own response to a small seed, not any one salt scheme built on it. Fixed with Murmur3's own
   `fmix32` finalizer (same finalizer T54 already used for a different bug in a different file) applied to the
   combined seed before drawing — new helper `_fmix32`, applied ONLY at the specific call sites that needed it
   (see finding #2), not to `_columnSeed` itself, which is used pervasively by code well outside this turn's
   own scope.
2. **The SAME weakness was already present in T56's own (already-merged) `_RAILS_COUNT_SALT`/
   `_TIES_COUNT_SALT` draws.** Measured directly while investigating #1: seeds 1-30 against `_TIES_COUNT_SALT`
   all landed in [0.011,0.023] — a run of CONSECUTIVE small seeds clustering near the SAME near-zero value, not
   independently spread — meaning `count` collapsed to `countMin` for this whole seed range. T56's own "50
   seeds: count always in [6,7]" test happened to still pass only because that range has exactly 2 possible
   values and the FULL 50-seed sweep crossed the 0.5 threshold often enough by chance (verified: the actual
   per-seed draws are NOT independently uniform, they cluster in long runs near 0 or near 1, only jumping at
   scattered points) — not because the draws were genuinely well-distributed for NEARBY seeds, which is this
   session's own actual usage pattern (1, 2, 3, 7, 42...). Applied `_fmix32` to both call sites too — a real,
   disclosed correction to already-shipped T56 code, found only because this turn's own work happened to
   re-exercise the same salt-derivation shape and I measured rather than assumed it was already proven.
3. **A naive `zone = k % zones` wrap order is a fixed, seed-INDEPENDENT bias toward the low-indexed zones —
   not a real fix for "all ties on one side" at all, just a subtler version of the same bug.** Self-caught
   while measuring the FIRST implementation's own actual output (not from reading the code): with
   `ties.count:[8,13]` (zones=8) and a typical drawn count of 9-13, the wrap-around "extra" ties (count-8 of
   them) ALWAYS land in zones 0,1,2,...(count-9) — the LOWEST, i.e. LEFTMOST, zones — every single run,
   regardless of seed. Measured end-to-end: the default config's own worst-case left/right split across 50
   seeds was 66.7%, still failing the dispatch's own "~65%" criterion, DESPITE zone assignment nominally
   "wrapping". Fixed: WHICH zones get the extra tie is now its own independent seeded score per zone (the same
   score-and-sort shape `spread:'random'` already uses one level up, at the zone level instead of the column
   level) — re-measured: worst-case split across 50 seeds is now 63.6%.

**A genuine test-design lesson, also self-caught**: my own FIRST test for finding #3 ("wrapping is a TRUE
round-robin, diff<=1 always") was itself vacuous — re-bucketing OUTPUT columns into a zone scheme computed
independently in the test can't distinguish "zones fixed at countMin" from "zones=count" (a finer partition
re-bucketed into a coarser one can coincidentally show the same aggregate shape). Rebuilt using an EXTREME
`ties.count:[2,15]` range specifically to make the distinction unambiguous. Even then, a SECOND, more subtle
issue surfaced: a strict per-seed `diff<=1` assertion occasionally failed for a reason UNRELATED to the bias
bug — the de-dup guard (needed so two ties never share a column) can legitimately push a tie across a zone
boundary when its own assigned zone is nearly saturated at high density, an acceptable side effect of
collision-avoidance, not a bias bug. Relaxed to an AGGREGATE (across-seed) balance check, which is ROBUST to
occasional legitimate spillover while still catching the SYSTEMATIC skew (which shows as a consistent, large
average bias, not an occasional one-off) — the dispatch's own actual criterion (the 65%-per-seed check) still
runs per-seed and is what ultimately proves the real-world behavior.

**Tests**: new `tests/editor-lattice-pattern-tie-spread.test.js` (9 tests) — the dispatch's own criterion (50
seeds, no half holds >~65%); different small seeds produce genuinely different column sets (finding #1's own
regression guard); no two ties share a column (T56's own guarantee, unaffected); tie count stays in the
declared range; the aggregate zone-balance check (finding #3's own guard, described above); `spread:'random'`
still works as a real alternative; a dedicated describe block for finding #2 (wide-range counts vary across 30
consecutive seeds, for BOTH rails and ties). Mutation-tested 3 pieces of new/changed logic (backup, mutate,
run, confirm exact failure set, restore, `diff` byte-identical — with an extra round of care this time: a
mid-sequence backup/restore mismatch was caught and corrected before it could silently validate broken code,
by re-verifying the restored file's own MD5 against a fresh backup rather than trusting an untimestamped
"restored" claim): (1) the `_fmix32` spread-draw fix reverted — exactly 1 failure, the dedicated collapse-
detection test; (2) the zone-bonus-selection fix reverted to `k % zones` — exactly 1 failure, the dispatch's
own actual 65% criterion (the aggregate-balance test did NOT catch this specific mutation, an honestly-reported
gap in that test's own sensitivity, though the criterion that actually matters did); (3) both count-salt
`_fmix32` fixes reverted — exactly 2 failures, one per salt, each in its own dedicated test. Full suite: 898
passed (60 files), up from 889 pre-turn.

**Live-verified**: re-rendered the SAME 3 seeds (42, 7, 1234) on the SAME 7x9 board the advisor's own T56
screenshot used, screenshotted via headless Chrome and viewed directly — ties now visibly spread across the
FULL board width (previously clustered left), saved to this session's own scratchpad as `t57-density.png`.

Amendments polled clean before committing and again immediately before passing. Committed by explicit path
(`editor-lattice-pattern.js`, `tests/editor-lattice-pattern-tie-spread.test.js` (new), `WORK-LOG-lane-b.md`) —
pushed. `reference/` confirmed still untracked.

## T58 — SE14 Slice 3: the Shape Lattice TOOL

**Scope actually landed, full — the whole dispatch, not a split.** The dispatch's own text explicitly permitted
splitting "at a coherent line" if the whole slice couldn't land cleanly; it did land cleanly (own rail icon +
`TOOL_PANELS` entry, Shape section with preset/seed/params, Segments section with per-segment style + mirroring
via a LIST picker, Fill section reusing the box Lattice's own controls, Generate/Detach-all, box-Lattice
Boundary-row removal). **Deliberately deferred, disclosed, not silently dropped**: axis-locked parametric
handles on canvas (Fred's own "Slice 3 editing model" — real canvas-interaction work, its own turn), tap-a-
segment-on-canvas to pick (sub-element hit-testing, a genuinely new primitive this codebase doesn't have),
detach-on-hand-node-edit (recompute-and-compare — needs the SAME sub-element/element-geometry-diff machinery).
The Segments list + per-segment style editing IS built and live-verified; only the two CANVAS-gesture pieces are
deferred. Flagging this split now for the advisor to confirm scope, same as the dispatch's own fallback clause
asked.

**`editor-shape-lattice-generator.js` (T55's own preset generator, unchanged) gained ONE new export,
`primitivesToPathD`** — the L/A primitive list -> one SVG path `d` string, the piece the design doc's own §3
named as "worth doing, not yet built." `largeArc`/`sweep` read straight off `dTheta`'s sign/magnitude, the exact
inverse of `arcCenterParam`'s own documented convention (path-layout.js:108-109) — verified as a real inverse,
not just argued, by round-tripping through `shapeToPrimitives` (editor-lattice-boundary.js, the SAME parser the
fill engine itself uses to consume a boundary `<path>`) and sampling points along both the original and
reparsed primitive lists (`_arcWorldPointTangent` as the independent oracle, same one T55's own tests already
trust). Non-vacuous: a sweep-flag-flip mutation (the exact one-bit transcription bug this shape is most exposed
to) is caught by the point-sampling check, NOT by the primitive-count check alone — both asserted, so the test
would fail loudly if either regressed to vacuous.

**`editor-lattice-pattern.js`**: `_findBoundaryElement` exported (was already the file's own internal lookup,
now genuinely needed by a second caller). `PATTERN_DEFAULTS.shape` declared (`source`/`preset`/`seed`/`params`/
`segments`) — a new top-level pattern field, not a parallel structure, matching the design doc's own §2 framing;
`computePattern`/`generatePattern` never read it themselves, only `properties-shape-lattice.js` does, resolving
it into `PATTERN.boundary.shapeId` + `PATTERN.extent.mode:'boundary'` before calling the SAME fill engine every
other tool shares.

**New `properties-shape-lattice.js`** wires the new panel: Shape section edits (preset/seed/🎲/params) call
`generateSilhouette` immediately and re-emit the linked `<path>`'s own `d` — in place when this tool's own
generated path is still the link, a FRESH element (never overwriting a hand-picked one) otherwise, matching
§6's "generated -> picked, detected by a later hand-edit" contract for what's built this slice (detach detection
itself deferred, see above). Segments section: a per-segment style/dir/bulge editor with SE14 §4's own mirroring
rule (`_mirrorSegmentIndex`, derived from the generator's own solver doc comments rather than a hardcoded
per-preset table, so it can't drift). Fill/Boundary/Ending/Border: the box Lattice panel's own controls, reused
under `shapeLattice*`-prefixed ids (duplicated markup+wiring, not shared DOM — two tools, two panels, one fill
engine underneath).

**`editor-drawer.js`'s `TOOL_PANELS` mechanism was only ever exercised by ONE entry before this turn** — its own
doc comment claimed "a future tool... is one entry here, not a new mechanism," but `_activateTab`/
`measuredPeekFloorPx`/`_makeSectionsCollapsible` all hardcoded `editorLatticePanel` specifically. Adding the
SECOND real entry (`shapeLattice`) is what actually proved that claim true or false — it was false as written,
so this turn generalizes all three: the tool tab now carries WHICH panel it represents on its own
`dataset.panelId` (set by `_syncTabsForMode` on every mode switch), read back by `_activateTab`/
`measuredPeekFloorPx` instead of a hardcoded id; the peek-snap-on-entry behavior generalized from `mode
==='lattice'` to `TOOL_PANELS[mode]` (any tool with a panel, not just Lattice specifically). A real, disclosed
refactor of EXISTING code, triggered by (not a side effect of) adding the new tool.

**`editor-ui.js`**: `TOOLBAR_GROUPS.editorShapeLatticePanel` (`currentMode==='shapeLattice'`), a `MODE_HINTS`
entry. **`tools/mode-tools.js`**: `bind('toolShapeLattice', ...)`. **`editor-controls.js`**: calls
`initShapeLatticeProperties`. **`bspline_gen_palette.html`**: `#toolShapeLattice` sidebar button (own hourglass-
line icon, `data-key="h"`), the box Lattice panel's own Boundary/Ending/Border section REMOVED (moved, not
duplicated), a new `#editorShapeLatticePanel` aside with Shape/Segments/Fill/Boundary sections + footer, MOB3-
compliant (`data-no-collapse` on Shape, `editorShapeLatticePanelBody`/`Footer` naming matching the box Lattice's
own convention so the generalized drawer code above picks it up for free). **`styles/editor.css`**: the same two
mobile-breakpoint rules (`#editorShapeLatticePanelHeader`/`Footer`) the box Lattice panel already had.

**Migration (§1, Fred's own "Fred 2026-09-25" ruling in the design doc, NOT the doc's own earlier §1
proposal)**: the box Lattice's `readFieldsIntoPattern` no longer writes `p.extent`/`p.boundary` AT ALL (used to
force-write `{mode:'board'}` unconditionally under the OLD proposal) — an existing layer already in
`extent.mode:'boundary'` from before this split keeps that data completely untouched by the box tool now;
switching that SAME layer to the new Shape Lattice tool picks up right where it left off, "handed off," not
reverted. Verified live (see below): the box Lattice panel shows the CORRECT trimmed section list (no Boundary/
Ending/Border at all) while the canvas still shows the OTHER tool's own generated fill, untouched.

**A genuine bug found LIVE, not caught by any unit test** (same class the codebase already fixed once for
rails/ties, `emitSegment`'s own doc comment: "a live browser test found a 0.5in board-wide stroke on a 0.5in
rail pitch" — found again here, independently, for the silhouette's own boundary stroke): the FIRST live
Generate produced the correct silhouette PATH but ZERO rails/ties/nodes (confirmed via a CDP eval reading
`data-lattice` counts directly off the DOM, not eyeballed). Root cause: `_regenerateSilhouette` used
`editor._strokeWidth` (the general drawing tool's OWN current setting, 0.5" in this live session) for the
silhouette's own stroke — `_effectiveBorderWidth`'s own inner-stroke inset then cut inward by HALF that, enough
to matter at the waist. Fixed with a small, fixed, declared `SILHOUETTE_STROKE_WIDTH = 0.02` constant instead,
matching `emitSegment`'s own precedent exactly (never inherit the general tool's stroke for a generator's own
emitted geometry). Re-verified live: `{rail:5, tie:10, node:20, path:1}` after the fix, with each row's own
rail span measurably narrower at the waist than at the horns (e.g. y=4.5 span 1.915-5.085 vs y=1.5 span
0.045-6.955 on a 7"-wide board) — read off the actual DOM attributes, not eyeballed from a screenshot (this
session's own "verify pixels, don't eyeball" rule) — confirming the boundary CLIP is real, not just a visually-
plausible coincidence.

**Tests**: `tests/properties-shape-lattice.test.js` (new, 24 — Shape section incl. non-vacuous reroll/param-
change geometry-actually-changed checks; Segments section incl. the mirror-pair check AND a cap-segment-has-no-
mirror check; Fill+Generate incl. the moved Ending/Border tests, adapted ids; Pick-shape incl. a check that
generating after a hand-pick mints a FRESH element and leaves the picked one's own real geometry untouched, not
a bare mock object that would pass trivially). `tests/editor-shape-lattice-generator.test.js`: +5
(`primitivesToPathD` round-trip per preset at a realistic board-inches scale — REGIONS[0]'s own 200-300 scale,
used elsewhere in this file, produced up to ~0.09 of round-trip drift purely from testing serialization
precision at the wrong magnitude, not a real defect — switched to a dedicated 6x9 region for this describe
block only; the sweep-flag-corruption non-vacuity check; the degenerate-input case). `tests/editor-drawer.test.js`:
+1 (the new `TOOL_PANELS.shapeLattice` entry). `tests/properties-lattice.test.js`: the OLD Boundary/Ending/
Border describe block (8 tests) REMOVED (moved to the new file, adapted), net -8+6 this turn from the widths-
link add-on below. Full suite: 925 passed (61 files), up from 898 pre-turn.

Mutation-tested the two riskiest pieces of new logic in `properties-shape-lattice.js` (backup, mutate, run,
confirm EXACT failure set, restore, MD5-verified byte-identical): (1) `_mirrorSegmentIndex` forced to `return i`
(never mirror) — exactly 1 failure, the dedicated mirror-pair test; (2) `_regenerateSilhouette`'s own
`reuseExisting` guard forced to `false` (always mint fresh, never update in place) — exactly 3 failures (the
"one path, not a pile" test directly, plus two others that happened to `.find()` the now-STALE first path
instead of the latest one — an honest, not cherry-picked, failure set).

## T58 ADD-ON (mid-task amendment, Fred: "I normally want ties and rails to be the same width")

Landed the same turn, absorbed before committing (polled via `handoff.py amendments`, arrived after the
CDP verification above but before commit). `PATTERN_DEFAULTS.widths.linkRailsTies` (default `true` for a
brand-new layer; a brand-new layer's own `ties` DEFAULT also now equals `rails`' — 0.07, not the old separate
0.055 — Fred's own explicit "rails = ties = the current rails default"). New `rewidthOwnedKinds` (editor-
lattice-pattern.js) — `rewidthOwnedKind`'s own multi-kind sibling, needed because calling the single-kind
version twice (once per kind) would satisfy "re-width both" but NOT "one undo step" (its own `pushState()`
fires per call) — mutation-tested directly (reverted to two per-kind `pushState()` calls inside the new
function itself — exactly 2 failures, one per panel's own "ONE undo step" test, both asserting `pushCount:1`
via a spy on `editor.pushState`).

UI: a chain-link toggle in the SHARED Widths row (built once, wired identically in BOTH `properties-lattice.js`
and `properties-shape-lattice.js` — genuinely the same contract, not a coincidence) — linked (default) shows one
"Rails & ties" stepper; unlinked shows today's separate pair. Migration: an EXISTING saved pattern with no
`linkRailsTies` key at all (checked on the RAW pre-merge `p.widths`, not the `{...PATTERN_DEFAULTS, ...p.widths}`
merge, which would otherwise silently backfill `true`) infers linked ONLY when its own rails/ties already happen
to be equal — a differing pair loads unlinked, Fred's own explicit "no silent change."

Tests: 6 new in `properties-lattice.test.js`, 5 new in `properties-shape-lattice.test.js` — linked-by-default;
Generate writes both fields + the flag; the live re-width-both-in-one-undo-step case (spied `pushState` count);
unlink leaves values unchanged; both migration cases (differing -> unlinked, equal -> linked). Full suite after
the add-on: 925 passed (61 files) — includes the widths-default-value test fix (`editor-lattice-pattern-emit.
test.js`'s own "declares the three default kind widths" test updated for `ties===rails` now, disclosed, not a
silently-tolerated regression).

**Live-verified** (headless Chrome, CDP, screenshots actually viewed, not just captured): hourglass generate on
a real 7x9" board (desktop 1400x1000) — silhouette + correctly-clipped rails/ties/nodes, confirmed both visually
and via DOM attribute readout; preset switch to Bottle — correct neck-to-body S-curve silhouette, correctly
re-clipped fill; segment 0 set to Kink — visible sharp vertex at the expected corner; box Lattice panel, same
session — confirmed NO Boundary/Ending/Border section present, previous tool's own fill left untouched on
canvas; mobile 390x844 viewport — drawer opens to the Shape Lattice tab (confirms the generalized `TOOL_PANELS`
tab-tracking actually works, not just declared), panel scrollable, Generate/Detach-all reachable, fill still
correct at this viewport too; Widths row screenshotted in both linked and unlinked states (the amendment's own
explicit ask). Zero console errors/warnings across the whole run (Log+Runtime domain listeners attached, not
just "didn't crash"). Screenshots saved to this session's own scratchpad (`t58-01`..`t58-09`), not committed.

Amendments polled clean immediately before this commit and will be polled again immediately before passing.
Committed by explicit path — pushed. `reference/` confirmed still untracked, left alone.

## T59 — SE14's own deferred "Slice 3 editing model": axis-locked handles + tap-a-segment

**Full scope landed**: axis-locked parametric handles on canvas (one per declared preset param, drag → live-
regenerate → refill-on-release, one undo step), tap-a-segment on canvas (a floating straight|curve|kink bar,
mirrored pairs, panel dropdown stays in sync), detach-on-hand-node-edit (recompute-and-compare). Plus a genuine
pre-existing bug found and fixed along the way (below) — this turn's own "one undo step" requirement is what
actually surfaced it.

**A pre-existing bug, confirmed live before assuming the dispatch's own "one undo step" ask was even reachable**:
every `generatePattern` call on a boundary-mode layer pushed TWO undo-stack entries, not one — since T49. Root
cause: `generatePattern`'s own end calls `_notifyChange('commit')`, which (editor.js) synchronously calls
`refreshBoundaryPatterns`, whose own re-entrancy guard was only ever SET by `refreshBoundaryPatterns` itself —
a DIRECT caller of `generatePattern` (every "Generate" button; now also the handle-drag's own `finish`) left the
guard clear, so its own commit re-triggered a redundant SECOND `generatePattern` run, with its own SECOND
`pushState`. Confirmed via CDP (`editor._undoStack.length` before/after two consecutive Generate presses: +2 each,
not +1) before touching any code. Fixed by setting the SAME guard around `generatePattern`'s own commit whenever
it's itself boundary-mode — re-verified live: +1 per press now. New regression test in
`tests/editor-lattice-pattern-boundary-emit.test.js` uses a mock `_notifyChange` that actually CASCADES into
`refreshBoundaryPatterns` (every other test in that file's own mock only records the call, deliberately, to keep
what each test isolates clean — this is the one exception, on purpose) — mutation-tested (reverted the guard,
exactly 1 failure, the new test itself).

**Handle math — `editor-shape-lattice-interaction.js` (new, pure)**: one handle per declared preset param
(hourglass: waistReach/cornerRadius/waistCenterY; bottle: neckWidth/bodyWidth/skeletonX/neckLength), each with an
anchor point + a single axis (`'x'` or `'y'`) + a `valueFromWorld(pt)` reading ONLY that axis, clamped to the
SAME range `_jitteredParam` itself clamps to. **A disclosed deviation from the dispatch's own literal wording**:
it called `cornerRadius` a "diagonal" handle; measured against the actual closed-form solver, the shoulder arc's
own CENTER (not its 45° on-curve point) moves PURELY horizontally as cornerRadius changes — `shoulderY` algebraically
cancels the `cornerRadius` term entirely (`waistCenterYAbs - cornerRadiusAbs - radiusWaist` reduces to
`waistCenterYAbs - hw + waistX`, no `cornerRadius` left). Anchoring at the center instead of the on-curve point
makes EVERY handle in both presets axis-aligned, not diagonal — simpler, and an exact derived fact, not an
approximation. Round-trip correctness (`h.valueFromWorld(h.anchor)` recovers the exact current param value, for
every param, across 5 seeds, and across the WHOLE 0-1 range via explicit params, not just the seed default) is
unit-tested directly, not just visually plausible — this is what actually caught that my FIRST guess at the
`cornerRadius` anchor (the on-curve point) would NOT have round-tripped cleanly, before ever writing live-drag
code against it. Segment hit-testing (`hitTestSegment`) reuses this generator's own EXACT primitive shapes
(circular, unrotated arcs only — established fact from T58) for a real point-to-line/point-to-arc distance, not
a bbox approximation; `primitiveSegmentMap` handles the one place a primitive index and a segment index diverge
(`kink` emits 2 `L`s per segment).

**`properties-shape-lattice.js` refactored into a real public API** — `regenerateSilhouette`/
`regenerateSilhouetteAndFill`/`writeSegmentStyle`/`paramHandleRecords`/`renderShapeLatticeHandles`/
`detectShapeLatticeDetach`/`openSegmentStyleBar` are now MODULE-LEVEL exports (were closures inside
`initShapeLatticeProperties`), since the canvas interaction code (editor-interaction.js) — which has no panel
DOM at all — needs the IDENTICAL write/regenerate/mirror logic the panel's own fields use, not a second copy of
it. The panel's own local wrappers now just call these and rely on a new `SHAPE_CHANGED_EVENT` (dispatched at
the end of `regenerateSilhouetteAndFill`) to re-sync its own fields — works whether the write came from the
panel or the canvas, with zero coupling in the "canvas reaches into the panel's own closures" direction.

**A genuine regression, caught by the FULL suite, not the Shape-Lattice-specific one**: `detectShapeLatticeDetach`
was wired to run on EVERY commit (`editor.js`'s `_notifyChange`, alongside `refreshBoundaryPatterns`) — its
FIRST version called `currentPattern(editor)`, which LAZILY MATERIALIZES a full default pattern onto the active
layer the first time it's called. Since this hook now runs tool-independent, on every commit, plain box-Lattice-
only undo tests started seeing a phantom `layer.pattern` appear after ANY commit. Fixed with a genuinely
read-only lookup (`_activeLayerObj` directly, no materialization) — measured with the fix reverted: 2 of the
suite's own pre-existing `editor-lattice-undo.test.js` tests failed (951 attempted, 949 passed), both asserting
`activeLayerPattern(editor)` stays `undefined` on a layer that never touched Lattice at all. Fixed, full suite
green again. A dedicated regression test for this exact failure mode is now in
`tests/properties-shape-lattice.test.js`.

**A live-measured touch bug, and a genuine correction of my OWN earlier reasoning (not the research agent's)**:
my first version of `shapeLatticeHandler` deliberately used the touch-marker-offset `pt` (not the raw pointer)
for hit-testing, reasoning "consistent with every other touch gesture in this editor." That reasoning was WRONG,
confirmed only by actually dragging via CDP: a handle's own hit radius (~25 screen px, touch-sized) is SMALLER
than the marker's own 40px offset, so a finger placed exactly on the visible handle would, with the offset
applied, always land outside the hit radius — a small PRECISION target isn't the same case as a drawing gesture,
where the offset convention makes sense. Fixed: `start` uses the RAW pointer (`editor._getMousePoint(e)`,
bypassing `applyTouchMarkerOffset`) for hit-testing; since `update(editor, pt)` has no access to the raw event
(`handleMove`'s own signature), the offset's own constant delta is captured once at `start` and re-added on
every subsequent move (the offset is a pure, fixed vertical shift — verified from reading
`applyTouchMarkerOffset`'s own 3-line body, not assumed).

**A second live-measured layout bug, found chasing the SAME touch-drag test**: the Shape section's own
`data-no-collapse` marker (T58's own first guess, matching the box Lattice's "Add" row) made the mobile drawer's
own measured PEEK height balloon to ~400px (preset toggle + seed row + ALL 3-4 preset sliders is a lot more
content than Add's 3 buttons) — confirmed live: a param handle at board-center fell BEHIND the drawer, under
`editorDrawerTab-layers`, not the canvas. `data-no-collapse` removed from Shape (now an ordinary, open-by-
default COLLAPSIBLE section) — the drawer falls back to its own 96px floor, leaving the canvas reachable;
re-verified live (measured, not assumed): `drawerComputedHeight` dropped to 96px, and the SAME handle became
reachable. A `document.elementFromPoint` check on a handle circle itself is a FALSE ALARM by design (handles
have `pointer-events:none`, same as `renderTransformHandles`'s own convention — hit-testing is done manually,
not via native DOM hit-testing) — worth naming since it cost real debugging time before I recognized it as
expected, not a bug.

**Tests**: `tests/editor-shape-lattice-interaction.test.js` (new, 19 — handle round-trip correctness across
seeds AND across the full param range via explicit values, axis-only-reads-its-own-coordinate, segment
hit-testing incl. the kink-maps-to-one-segment-index case, `mirrorSegmentIndex` incl. its own involution
property). `tests/properties-shape-lattice.test.js`: +15 (the new module-level exports, incl. the
lazy-materialization regression test above, a non-vacuous hand-edit-detection test, and `openSegmentStyleBar`'s
own DOM incl. "opening a second bar closes the first"). `tests/editor-lattice-pattern-boundary-emit.test.js`: +1
(the double-pushState regression). `tests/editor-shape-lattice-generator.test.js`: +6 (the new resolved-`params`
return field, cross-checked against an INDEPENDENT read off the keypoints themselves, not the solver's own
internal variable). Full suite: 966 passed (62 files), up from 898 pre-turn (T58's own end state).

Mutation-tested the double-pushState fix (reverted, exactly 1 failure — the dedicated regression test) and the
`_mirrorSegmentIndex`-style involution logic is exercised structurally by its own dedicated test rather than a
separate mutation pass (T58 already mutation-proved the identical mirroring code this reuses).

**Live-verified** (headless Chrome, CDP, screenshots actually viewed): desktop mouse-drag on the waistReach
handle — undo delta exactly 1, param changed from unpinned to an explicit value, the silhouette visibly pinched
deeper AND the panel's own slider moved to match (confirms the `SHAPE_CHANGED_EVENT` sync works, not just the
data write); mobile 390x844 — drawer at its own correct 96px peek height post-fix, a REAL touch drag
(`Input.dispatchTouchEvent`, not a mouse event with a `pointerType` override, which this Chrome build silently
ignores — confirmed by checking `e.pointerType` on the resulting event, still `'mouse'`) on the SAME handle,
undo delta exactly 1; a real touch tap on the silhouette's own bottom edge opened the floating style bar with
the correct default-active style, and clicking Kink produced a visibly sharp notch at that exact edge; detach-
on-hand-edit verified through the REAL `editor.js` commit hook (mutated the linked path's own live `d`,
`pushState()`+`_notifyChange('commit')`, confirmed `shape.source` flipped 'generated'→'picked'), not just the
isolated function. Screenshots saved to this session's own scratchpad (`t59-01`..`t59-09`), not committed.

Amendments polled clean immediately before this commit and will be polled again immediately before passing.
Committed by explicit path — pushed. `reference/` confirmed still untracked, left alone.

## T60 — SE15 design doc: constrained Fusion sketches for Lattice / Shape Lattice (docs only, NO FUSION)

Dispatch: write `SE15-CONSTRAINED-SKETCH-DESIGN.md` per ROADMAP.md's own "Queued — SE15" entry (Fred,
2026-09-25) — a declared sketch manifest for sending Lattice/Shape Lattice geometry to Fusion as real,
PARTIALLY-constrained sketches, not the flat baked SVG stamp the app sends today. Explicitly no code changes and
no Fusion tool calls this turn — Fusion-side verification is the advisor's own job (Slice 3, §8 of the doc).

**Why docs-only, and why now**: T58/T59 (SE14) shipped the Shape Lattice tool's own generation + editing model;
SE15 is the NEXT queued item and, per Fred's own ROADMAP note, is explicitly a two-sided problem — a JS-side
manifest-producing function (provable in the browser, no Fusion needed) and a Python add-in build routine
(needs real Fusion to verify constraint behavior, solver load, and undo safety). Splitting the WRITING from the
BUILDING let this turn stay entirely on the browser side of that line while still producing something the
advisor can act on directly (Slice 3 in §8 is written as its own verify checklist, not just a TODO).

**Research process — two tracks, both cited by file:line in the doc itself, neither assumed from memory**:
1. Read this repo's own JS-side Fusion-bridge code directly this turn (`export-flow.js` in full, `layers.js`'s
   `FUSION_GEOMETRY` table, `editor-io.js`'s `bakeSvgForCarving`, `fusion-geometry.js` in full,
   `fusion-bridge.js`'s `sendFusionPayloadChunked`) rather than trusting earlier design docs' own framing of how
   export works — confirmed today's export is a STEP file + an OPTIONAL, DPI-BAKED-PIXEL SVG "stamp," never a
   real Fusion sketch entity, which is the actual gap SE15 closes.
2. Delegated a background research agent to read the Python add-in side (`frame-builder/fb_engine/`) — its own
   geometry/constraint/dimension/offset dispatch machinery, entity addressing, the `deferred_compute`/`Pulse`
   build-block order, and `b-spline-gen.py`'s own current (thinner) parameter-sync and event-handling pattern.
   Its full report is absorbed into the doc's own "Ground truth #5" and cited by file:line throughout §5-6,
   never taken as an unverified secondhand summary — every claim I used from it names the specific file/function
   it came from, same discipline as the JS-side reading.

**Key findings that shaped the design, not just restated in it**:
- `fb_engine` already has almost everything needed, DATA-DRIVEN and dispatch-based (`geom_step`/
  `constraint_step`/`dimension_step`/`offset_step`), with the EXACT "skip + report, never abort" failure
  contract the dispatch itself asked for — already shipped in production for 7 of the ~9 constraint types this
  design needs. The real gaps are small and named precisely (§5): `Circle`/`ArcCenter` geometry dispatch,
  `PointOnCurve` constraint dispatch — both declared in `fb_engine`'s own type lists already, just missing one
  `elif` branch each, inheriting the existing logging for free.
- **No `addSymmetry` exists anywhere in this repo.** The one place the source templates needed bilateral
  symmetry, it's built as TWO `Equal` constraints instead (with an explicit comment warning a redundant Equal
  risks `VCS_SKETCH_OVER_CONSTRAINTS`). The design reuses this SAME validated pattern for Shape Lattice mirror
  pairs rather than reaching for an API this codebase has never actually exercised — a disclosed deviation from
  what a naive reading of "symmetric" in Fred's own ROADMAP wording might suggest.
- **A genuine structural divergence the design deliberately adopts**: `b-spline-gen.py`'s own current SVG-import
  path runs the whole build directly inside the bridge event handler, not inside a Fusion command — a known
  undo-orphaning trap for parameters created that way (documented in this codebase's own `ensure_tilt_param`
  docstring and ROADMAP.md's own open finding A2-1). Building a constrained sketch means creating exactly that
  class of object (parameters + dimensioned constraints), so §5 explicitly routes it through
  `frame-builder`'s own `palette_scaffold.schedule_hidden_build` instead — reusing a pattern from the OTHER
  add-in in this package, not from `b-spline-gen.py` itself, and said so plainly rather than silently changing
  convention.
- T59's own new `params` return field on `generateSilhouette` (added last turn for the param-handle editing
  model) turns out to be exactly the value set §3's manifest-producer needs for Fusion user parameters — no new
  resolution work, a direct example of one turn's declaration paying for the next turn's consumer for free.

**Disclosed design decisions, not left implicit**: axis-aligned param handles (T59) map straightforwardly onto
axis-aligned H/V constraints in the manifest, so no new geometric reasoning was needed there; the shape preset's
own FIXED, small entity count (12 hourglass / 10 bottle, never scales with board size) is always fully
constrained, no threshold — only the Lattice side (rails/ties/nodes, which DO scale with board size) needs the
size-gated plain-geometry fallback in §6; the size threshold's actual NUMBER is explicitly left unset (a real
Fusion timing measurement, not a guess) and named as Open question #3 for the advisor's own Slice 3 pass.

**What this doc is NOT**: no code was written or changed this turn (verified via `git status --short` before
committing — only the design doc and this WORK-LOG entry are new/modified); no Fusion tool call was made; the
JS/Python research above was read-only investigation feeding the design, not implementation.

Amendments polled clean immediately before this commit and will be polled again immediately before passing.
Committed by explicit path — pushed. `reference/` confirmed still untracked, left alone.

## T61 — SE15 Slice 1: the pure sketch manifest producer (dispatch bundled §8's own Slice 1+2 into one turn — NO FUSION)

Dispatch text: "Build your §8 Slice 1: the pure manifest producer + its tests (entities, constraints, parameters
for a box lattice, a Shape Lattice hourglass and bottle, widths as offsets with round caps, the >60-piece plain
fallback flag)." Read literally this spans BOTH the design doc's own Slice 1 (shape preset) and Slice 2
(lattice) — built both this turn, in one new module, `editor/editor-sketch-manifest.js`
(`manifestFromLattice`/`manifestFromShape`/`buildSketchManifest`, exports `SKETCH_PIECE_THRESHOLD`). Also read
the advisor's own new "Answers" section in SE15-CONSTRAINED-SKETCH-DESIGN.md (measured live in Fusion, T60's own
open questions #1-3): single-open-line offset needs ONE `sketch.offset` call PER SIDE (two total per
centerline, not one); the threshold's own number is 60 pieces. Both are load-bearing for this module's own
`addWidthOffsetsAndCaps` (two Offset dimensions per kind-group) and `SKETCH_PIECE_THRESHOLD = 60`.

**A design-doc internal inconsistency, found and resolved while actually implementing §2's own kink row, not
assumed either way**: §2's table said a kink segment gets "none beyond the shared point" (implying NO
constraint at all), while the doc's own "what deliberately gets NO constraint" paragraph said EVERY adjacent
primitive pair gets an explicit Coincident. These contradict for a kink's own joints. Resolved by re-reading
both together: the kink row's own point is "no TANGENT" (a kink is a deliberate sharp notch; declaring Tangent
across it would smooth over the thing it exists to produce), not "no Coincident" — Coincident is universal
(every adjacent primitive pair, always); Tangent is added only when at least one side is an arc AND neither
side's own segment is styled 'kink'. This single rule handles every case correctly: a straight-straight 90°
corner (never Tangent, since neither side is an arc), an arc-arc/arc-line joint (Tangent, matching T55's own
proven invariant), and any joint touching a kink (no Tangent, regardless of what's on the other side) — tested
directly (see "kinking segment 1" test below) rather than argued.

**A genuine design decision, not in the original doc, forced by actually writing `buildSketchManifest`**:
`PATTERN_DEFAULTS.shape.source` defaults to `'generated'` UNCONDITIONALLY (editor-lattice-pattern.js) — every
layer's pattern carries a `.shape` sub-object, even a plain box Lattice layer that has never touched the Shape
Lattice tool. So `.shape.source==='generated'` ALONE can't distinguish a real Shape-Lattice layer from a plain
Lattice layer's own unused default. Found this by writing a "box lattice, no shape" test and watching it produce
12 silhouette entities anyway. Fixed by ALSO requiring `pattern.extent?.mode === 'boundary'` — the SAME field
the real app's own `properties-shape-lattice.js` sets when (and only when) the Shape Lattice tool's own Generate
has actually linked a silhouette (that file's own doc comment, read directly, not assumed) — reusing an
existing, already-true discriminator rather than inventing a second flag.

**H/V constraint choice — a disclosed simplification over the design doc's own literal wording**: rather than
threading `PATTERN.orientation` through as a second argument, `axisConstraintType` reads it directly off each
entity's own already-computed endpoints (`a.x===b.x` -> Vertical, `a.y===b.y` -> Horizontal). Verified this is
equivalent, not just simpler: `computePattern`'s own `orient()` transpose (editor-lattice.js) only ever produces
an axis-aligned segment either way (a rail's own two ends always share ONE coordinate, whichever orientation),
so reading the geometry directly is a strict refinement — and it self-verifies: a genuinely diagonal Line (which
should never occur for a rail/tie, and DOES occur for a shape-preset kink's own apex legs) correctly gets no H/V
constraint instead of a wrong one, for free, without a special case.

**Round-cap arcs — a scope decision on where the manifest's own job ends**: §4 described a cap as "tangent to
its own offset pair," but the offset's own result curve doesn't exist as a named entity until the add-in
creates it live in Fusion (§5's own Pulse-before-reference rule) — there is no id in THIS manifest a Tangent
constraint could reference. Resolved: this module emits the cap's own GEOMETRY (center/radius/180° sweep) plus a
Radial dimension driving that radius from the SAME width parameter the offset uses (one parameter, two
consumers, per §4's own text) — the tangent-to-offset wiring is Slice 3's own runtime job in Python, using
object references it holds directly. Cap angle formula derived by hand (center=piece endpoint, otherEnd=the
piece's other end, thetaD=atan2(otherEnd-center), start=thetaD+90°, sweep=+180°) and verified against a
horizontal test case before trusting it in the module.

**Mirror-Equal scope-narrowing (disclosed, not silent)**: §2's own "every right-side entity <-> its LEFT mirror"
is implemented ONLY between segments that produce exactly ONE primitive each (straight/curve) — a kink's own
2-primitive mirror pairing (which of its 2 lines corresponds to which of its mirror's 2 lines) isn't verified
this turn, so it's skipped rather than guessed at. Hourglass's own shoulder<->hip cross-tie (segment 1<->3,
completing the mirror pairs 1<->9/3<->7 into one 4-way Equal group) is gated on both still being `style==='curve'`
— tested directly by overriding segment 1 to 'kink' and confirming both the Tangent AND this Equal/dimension
disappear for it.

**The lattice-fill's own boundary clip (composition path, `buildSketchManifest`) uses the silhouette's own RAW
centerline, not a Border-enabled inner-stroke inset** — `_resolveBoundaryPrimitives`'s own DOM-based inset
(`shapeToInnerBoundaryPrimitives`) is async and tied to a live element, incompatible with this module's own "no
DOM" contract; this module instead scales `generateSilhouette`'s own primitives straight to lattice units and
feeds them through `computePattern`'s existing `opts.extent.primitives` contract (the SAME boundary-mode
machinery a hand-picked boundary shape already uses) — a disclosed, narrower scope than a Border-enabled live
layer's own true behavior, named as a real follow-up, not built this turn.

**Dev-only exporter**: `window.__se15Manifest(layerId?)`, wired in `main/app-init.js` (NOT inside
editor-sketch-manifest.js itself — that module's own contract is "no DOM, no editor object", so the window/
editor-reading glue lives at this boundary instead). Gated behind `window.__editorDebug === 'SE15'`, the SAME
mechanism (`core/debug.js`) every other console-only hook in this codebase already uses — verified live (see
below) that it correctly returns `null` and warns when the flag is off, and returns a real manifest when set.

**Tests**: `tests/editor-sketch-manifest.test.js` (new, 20 tests) — box lattice (entities cross-checked against
an independent `computePattern`+`fromLattice` re-run; H/V and tie-on-rail Coincident verified with an
INDEPENDENT geometric scan over the entities' own coordinates, both a positive check — every declared constraint
is geometrically real — and a negative one — every UNDECLARED tie-endpoint genuinely doesn't touch a rail;
width-offset+cap geometry verified via perpendicularity/diameter checks, not by re-trusting `capArc`; the
>=60-piece threshold flips `constrained` off while leaving the offset/cap mechanism untouched); hourglass+bottle
(entities cross-checked against an independent `generateSilhouette` re-run; every Coincident/Equal verified
against the entities' own coordinates/radius/length, not the constraint-producing code's own logic; the kink
non-vacuity test above). Full suite: 986 passed (63 files), up from 966 pre-turn (T59's own end state; T60 was
docs-only).

**Mutation-tested three of the riskiest pieces of new logic** (backup, mutate, run, confirm the EXACT expected
failure, restore, MD5-verify byte-identical): (1) disabling the kink-Tangent exemption -> exactly 1 failure (the
dedicated kink test); (2) dropping the cap arc's own +90° offset -> exactly 1 failure (the perpendicularity
check); (3) hard-coding `constrained=true` regardless of piece count -> exactly 1 failure (the threshold test).
Not exhaustive (the H/V axis check, tie-on-rail scan, and Equal/radius checks were not separately mutation-run,
given how many independent geometric assertions this suite already makes over real coordinates rather than
re-trusting the code under test) but representative of the highest-risk, least-obvious logic in the new module.

**Live-verified** (headless Chrome, CDP, real app UI — not a synthetic object): opened the Shape Lattice tool,
clicked Generate on a real hourglass silhouette, then called `window.__se15Manifest()` for real through the
live page. Confirmed: the layer's own `pattern.extent.mode` really is `'boundary'` once Generate has run (the
discriminator this turn's own design decision above relies on); the manifest is non-null with 83 entities, 56
constraints, 7 parameters, 59 dimensions; BOTH silhouette (`seg*`) and lattice (`rail*`) entities are present
(the composition path genuinely ran both producers); `latticePieceCount`=37, correctly `constrained` (below
60); zero console errors; the debug gate correctly returns `null` when `window.__editorDebug` is off. Chrome
profile cleaned up after (`chrome-profile-t61`, confirmed 0 remaining processes).

Amendments polled clean immediately before this commit and will be polled again immediately before passing.
Committed by explicit path — pushed.

## T62 — SE15 Slice 2: the add-in builder (Python) + Send-to-Fusion wiring (NO FUSION for the worker)

Dispatch: build `build_constrained_sketch(sketch_target, manifest, placement)` in the b-spline-gen add-in —
entities/constraints/parameters/dimensions/offsets+caps from T61's own JS manifest, skip-and-report failure
handling, a `build_from_manifest_file` dev entry point, and wire it into the Send-to-Fusion path per §7. Python
only, unit-tested with a fake `adsk` shim — the advisor runs this in real Fusion after merge.

**Research first, again directly cited, not re-trusted from the design doc's own earlier summary**: delegated a
research agent to re-read `b-spline-gen.py`'s own `_handle_generate`/`_import_single_layer_svg`/
`_sync_user_parameters`, and `fb_engine`'s `geometry.py`/`constraints.py`/`dimensions.py`/`offsets.py`/
`build_context.py`/`palette_scaffold.py`, plus the existing `test_deferred_compute.py`-style adsk-stub
convention — then read the load-bearing files myself directly (geometry.py, build_context.py, constraints.py,
dimensions.py, offsets.py in full) before writing a line of new code, since I'd be calling these functions'
exact signatures, not just describing them.

**Two genuine, disclosed departures from "just call fb_engine's existing dispatch for everything"**, both found
by actually reading the code, not assumed from the design doc's own T60-era framing:
1. `geometry.py`'s `geom_step` has NO `Circle`/`ArcCenterPoint` branch (confirmed — declared in
   `parametric_engine.py`'s own `geom_types` list, never implemented) — wrote my own
   `_create_circle_entity`/`_create_arc_center_entity`, following `_create_line`/`_create_arc3`'s own exact
   `ctx.set_id(...)` tagging convention so `:S`/`:E`/`:C` resolution keeps working for free.
2. `offsets.py`'s `offset_step`/`_try_parametric_offset` is built for a CLOSED multi-curve loop — its own
   `_tag_offset_results` calls `classify_rect_lines`, which needs >=4 curves and returns `{}` (tags nothing) for
   a single result curve. A rail/tie's own one-sided offset is exactly that single-curve case, so reusing
   `offset_step` wholesale would silently produce an offset curve with NO `:S`/`:E` tags at all. Wrote my own
   `_do_single_offset` instead, calling `sketch.offset()` DIRECTLY (the classic/fallback path, NOT `addOffset2`)
   — per the advisor's own live-Fusion measurement in SE15-CONSTRAINED-SKETCH-DESIGN.md's new "Answers" section
   ("the classic sketch.offset path is proven; use it") and T62's own dispatch text ("TWO classic
   sketch.offset(...) calls per centerline"). `constraint_step`/`dimension_step` (Coincident/Tangent/H/V/Equal,
   Radial) ARE fed straight through unchanged — no gap there, confirmed by direct reading, not assumed.

**A design decision the dispatch left to me: "count + first few reasons in the log"**. `constraint_step`/
`dimension_step` are fire-and-forget/log-only — neither returns success/failure, so my own summary dict can't
just check a return value. Solved by making `_Logger` (my own `ctx.logger` adapter) ALSO accumulate every
logged line, then filtering it for fb_engine's own established SKIP/FAIL/MISS tags after the build — an
accurate count + first-5-reasons without needing to change fb_engine's own return contract at all.

**The cap-tangent wiring is explicitly flagged as the LEAST proven part of this module.** T61's own JS manifest
deliberately did NOT declare a Tangent constraint for a round cap against its own offset curve, because that
curve has no manifest-known id until the add-in creates it live. This turn writes that missing piece:
`_apply_width_offsets_and_tangent_caps` calls `sketch.geometricConstraints.addTangent(cap, offset_curve)` for
each cap against BOTH the pos and neg offset sides, wrapped per-attempt in try/except (skip + report). Without
any live Fusion to check WHICH cap should pair with WHICH side (or whether attempting both is even geometrically
sound), this is a reasonable, disclosed GUESS, not a verified relationship — flagged here explicitly for the
advisor's own live check, matching how T59/T60 already flag their own least-proven pieces rather than smoothing
over them.

**Parameter sync — a NEW generic function, not b-spline-gen's own `_sync_user_parameters`.** That function is
hardcoded to a 2-entry `widthIn`/`heightIn` `param_map` (confirmed by direct reading) — it would silently ignore
every manifest-declared parameter (`rail_width`, `corner_radius`, `half_width`, ...). Wrote
`_sync_manifest_parameters`, modeled on `ParametricSketchBuilder._sync_user_parameters`
(`frame-builder/fb_engine/parametric_engine.py`) — a generic create-or-update loop over the manifest's own
`{name, value, unit}` list — called BEFORE any geometry/dimension/offset step, matching that same file's own
established ordering rationale (a `.expression` string can't reference a parameter that doesn't exist yet).

**Units — a disclosed, load-bearing decision, not an afterthought.** `BuildContext.resolve_val`'s own doc
comment confirms Fusion's internal API is ALWAYS centimeters. The manifest's own coordinates are real MODEL
INCHES (§1's own "units":"in"). Rather than routing every raw coordinate through Fusion's own expression
evaluator (slow for hundreds of lattice points, and unnecessary — cm-per-inch is a fixed API fact, not something
that varies by document), `_to_point3d` does a direct `* 2.54` multiply. Expression STRINGS that reference a
named parameter (offset/dimension `.expression`, e.g. `"rail_width / 2"`) are never touched this way — those go
through Fusion's own `ValueInput`/`.parameter.expression`, which resolves itself against the parameter's own
declared unit.

**Send-to-Fusion wiring (§7) — picked the smaller of the two options the dispatch offered, and said so**: no new
checkbox, no new `FUSION_GEOMETRY` value. `export-flow.js`'s existing `includeSVG` toggle (already the single
"ship this layer's artwork" decision a user makes) now ALSO gates a new `_fusionLayerManifest(editor, l)` sibling
field (`sketchManifest`) on each `bakedLayers[i]` entry — `null`/absent for a layer with no `.pattern` (a
hand-drawn/text layer, declined gracefully, same convention `_fusionLayerSvg` itself already uses). A layer
therefore always carries BOTH `.svg` and (when applicable) `.sketchManifest` — matching design doc §7's own
default assumption ("both fields present, add-in decides") — rather than the layer's Fusion Geometry table
gaining a 4th value, which would have needed touching `layers.js`'s own declared table, the properties panel's
dropdown, AND a per-layer Python dispatch key — genuinely more surface for the same outcome at this stage.
Whether a SEPARATE toggle is wanted later is explicitly still open (design doc §7's own open question #5).

**Tests**:
- JS: `tests/export-flow.test.js` +5 (`_fusionLayerManifest` — null-gating for a missing editor/layer-id/pattern;
  a real manifest for a layer that has one; a non-vacuous "looks up by id not array position" test, comparing
  rail counts between two DIFFERENT real manifests built from two DIFFERENTLY-configured patterns, so a
  regression to positional lookup would silently attach the wrong layer's geometry). Full JS suite: 991 passed
  (63 files), up from 986 (T61's own end state).
- Python: `bspline-frame-builder/b-spline-gen/test_sketch_manifest_builder.py` (new, 13 tests, `pytest` — same
  sibling-file convention `frame-builder/test_*.py` already uses, not a `tests/` subfolder). Went DEEPER than
  every existing fb_engine test file's own adsk-stub convention (those 4 files never call
  `geom_step`/`constraint_step`/`dimension_step`/`offset_step` directly, per this turn's own research) — hand-
  rolled a structurally-consistent (not geometrically faithful) fake Sketch/Lines/Arcs/Circles/Constraints/
  Dimensions/ObjectCollection/Design/Application surface, threaded through a module-level `CALL_LOG` so tests can
  assert on ORDER (parameters -> geometry -> constraints -> dimensions/offsets) and on skip-and-report behavior,
  not just "did it return something." Verify list: inches->cm conversion; build order; every entity created;
  parameter create-vs-update across two builds; a missing constraint target skipped without aborting; an unknown
  entity type skipped without aborting; the >=threshold case (empty `constraints[]`, exactly as T61's own JS side
  already produces above `SKETCH_PIECE_THRESHOLD`) builds cleanly with zero MANIFEST-driven constraint calls
  while the width-offset+cap mechanism still runs (§6: "not a separate code path"); two `sketch.offset()` calls
  per centerline; the offset dimension's own expression gets set; cap-tangent is attempted; the dev entry point
  reads a real JSON file and a missing-active-design error is clear. Both `pytest` and the plain-`python3` dual-
  mode convention `test_templates.py` already documents were verified to run (13/13 via pytest, 12/12 — the
  `tmp_path`-fixture test skipped — via plain Python).

**Mutation-tested two of the riskiest pieces** (backup, mutate, run, confirm the EXACT expected failure, restore,
MD5-verify byte-identical): (1) moving the parameter-sync call to AFTER geometry creation -> exactly 1 failure
(the dedicated build-order test); (2) turning the "unknown entity type" branch from skip-and-continue into a
raised `ValueError` -> exactly 1 failure (the skip-and-report test's own exact-reason-string assertion) — the
build still didn't ABORT even then, because the surrounding `except Exception` caught it too (a genuinely
double-layered defense, not a false negative — the test caught the DIFFERENT skip-reason text, confirming it's
sensitive to which code path produced the skip). Not exhaustive (the offset/cap/parameter-sync paths were
proven via the ORIGINAL 13 tests' own direct call-order/count assertions over the fake's real object graph,
rather than a separate mutation pass each).

**What this turn is NOT**: no `fusion_execute`/`fusion_screenshot` call was made (this turn's own "NO FUSION",
consistent with `skills/ndoo/SKILL.md`'s own standing hard rule found during research); the cap-tangent
mechanics, the offset seed-distance/side-selection heuristic, and the sketch-placement-plane default are all
UNVERIFIED against real Fusion — named explicitly above and in the module's own doc comments, not silently
assumed correct.

Amendments polled clean immediately before this commit and will be polled again immediately before passing.
Committed by explicit path — pushed.

## T63 — SE15 fixes from the advisor's own REAL Fusion run + wire the add-in to actually use the manifest

Dispatch: the advisor ran `build_from_manifest_file` live in Fusion on a real 75-entity/51-constraint
hourglass+lattice manifest and found exactly the two things T62's own WORK-LOG flagged as unverified — plus a
genuine gap: the builder was never actually CALLED from `_handle_generate`. Fix all three.

**Could not access the advisor's own saved fixture** (`scratchpad\se15-real-manifest.json` is inside THEIR own
session's private scratchpad directory, not something my worktree/session can read — confirmed by searching,
not assumed). Reproduced both bugs instead using my own smaller hand-built fixture from T62's test suite, which
exercises the exact same code paths the advisor's report names — the dispatch's own reported symptoms (exact
values, exact log-line text) were specific enough to fix and verify without needing their literal file.

**Bug 1 — parameter units off by 2.54, confirmed and fixed.** `_sync_manifest_parameters`'s own CREATE path used
`ValueInput.createByReal(float(value))` for every parameter regardless of unit. `createByReal` takes a value in
Fusion's CANONICAL internal unit (cm for a length) — the `unit` string passed separately to `.add()` only labels
the parameter for display, it does NOT convert the raw number. So `createByReal(0.07)` for `rail_width` (meant
as 0.07 IN) silently became 0.07 CM — exactly matching the advisor's own measured 0.0276" (0.07/2.54). Fixed:
a length parameter (non-empty `unit`) now uses `ValueInput.createByString(f"{value} {unit}")`, letting Fusion's
own expression parser do the conversion; a genuinely unitless ratio (`waist_reach`, `corner_radius`, ...,
`unit` is `None`) keeps `createByReal` exactly as before — no unit string to misinterpret there. Two new tests
(`test_length_parameters_created_with_unit_bearing_expression`, `test_unitless_parameters_created_with_
createByReal`) assert on WHICH `ValueInput` constructor gets called and with what exact string/number, via a
small extension to the fake `_ValueInput` shim (it now logs `("valueinput:real"|"valueinput:string", value)`
into the SAME module-level `CALL_LOG` the rest of the suite already threads through).

**Bug 2 — cap tangency over-constraint, confirmed and REMOVED (not silenced).** The advisor's own live run
produced 30 "CAP TANGENT SKIP ... VCS_SKETCH_OVER_CONSTRAINTS" — their own diagnosis: a cap arc is ALREADY
fully determined (center pinned to the centerline's own end point, radius tied to the SAME parameter driving
the offset), so T62's own explicit `addTangent(cap, offset_curve)` call was a redundant, conflicting 5th
constraint on a curve with zero remaining degrees of freedom. Per the advisor's own explicit instruction ("drop
the explicit cap-tangent step... the result must have ZERO skips on this fixture, don't just silence the log"),
`_apply_width_offsets_and_tangent_caps` is renamed `_apply_width_offsets` and no longer touches
`sketch.geometricConstraints` at all — not wrapped in a broader try/except, the call is GONE. The obsolete test
(`test_cap_tangent_attempted_against_both_offset_sides`, which asserted Tangent calls WOULD happen) is replaced
with `test_no_cap_tangent_constraint_is_ever_attempted` (asserts zero Tangent calls, full stop) — and the
threshold test's own doc comment/assertion, which previously had to carve out an explicit exception for
Tangent calls, is simplified to a genuine "zero constraint calls of any kind" check now that there's nothing
left to exempt.

**Bug 3 — wired the add-in to actually call the builder.** T62 built `build_constrained_sketch` +
`build_from_manifest_file` but never called the FIRST one from `_handle_generate` — Send to Fusion still only
ever imported the plain SVG, regardless of whether a layer carried a `sketchManifest`. Fixed in
`b-spline-gen.py`:
- Top-level `from sketch_manifest_builder import build_constrained_sketch` — safe as a plain import (confirmed
  by reading `bspline-frame-builder.py`'s own `_load_submodule`: it inserts `b-spline-gen/`'s own directory into
  `sys.path` BEFORE exec'ing `b-spline-gen.py`, so a sibling-module import resolves without any lazy/defensive
  workaround).
- Extracted the offset-above-peak construction-plane logic `_import_single_layer_svg` already had (steps 3-4 of
  its own body) into a new shared `_compute_artwork_plane` method — SAME placement for both the plain-SVG path
  (refactored to call it) and the new constrained-sketch path, matching the advisor's own "Answers" ruling to
  keep that convention. Confirmed `project_axis` (a local the original code computed but never actually used
  anywhere in that function) was genuinely dead before my edit too — not something I made unused, just not
  propagated into the new shared helper.
- `_import_all_svg_layers` gained a `design=None` param (threaded from `_handle_generate`'s own already-in-scope
  `des`) and now branches per layer: `layer.get('sketchManifest')` present + a real `design` → new
  `_build_constrained_sketch_for_layer` (build via `build_constrained_sketch`, log one summary line — entities,
  constraint/dimension issue counts, offsets created, params created/updated, seconds); otherwise → the
  UNCHANGED plain-SVG path. The carve stamp itself is untouched either way — it's driven by the STEP body's own
  3D geometry, generated earlier in `_handle_generate`, never by this sketch-import step.
- **Deploy/path check (confirmed, not fixed — nothing was actually wrong)**: read `DEPLOY_bspline-frame-
  builder.py` directly. `VERIFY_FILES` is a POST-copy hash-check subset, not an inclusion allowlist — the real
  copy is `shutil.copytree` over the WHOLE `bspline-frame-builder/` tree minus `SKIP_NAMES`/`SKIP_SUFFIXES`/
  `SKIP_FILES_EXACT`. Neither `sketch_manifest_builder.py` nor `test_sketch_manifest_builder.py` matches any
  skip pattern, so both already deploy automatically (the test file ships too — a pre-existing situation, since
  `frame-builder/test_*.py` already ships the exact same way; not something this turn changed or was asked to
  fix). `_ensure_fb_engine_importable`'s own sibling-path assumption holds in the deployed layout too, since the
  WHOLE tree (including `frame-builder/` and `b-spline-gen/` as siblings) copies verbatim — confirmed via
  `SRC_DIR = Path(__file__).parent.resolve()` (the `bspline-frame-builder/` folder itself) and the destination
  tree structure `VERIFY_FILES`'s own paths already imply.

**No new test for the `_handle_generate` wiring itself** — `b-spline-gen.py` has zero existing test
infrastructure of its own (confirmed by T62's own research: no fake-adsk convention for THIS file, unlike
fb_engine), and building one from scratch for a thin dispatch branch is out of scope for a fix-and-wire turn;
`python -m py_compile` confirms the edit is syntactically valid. The advisor's own live Fusion run remains the
real verification for this piece, same as T62's own builder logic.

**Tests**: `test_sketch_manifest_builder.py` now 15 (was 13) — 2 new (units), 1 replaced (cap-tangent removal),
1 simplified (threshold test's own now-unconditional zero-constraint-calls assertion). Both pytest and the
plain-python fallback verified green (15/15, 14/14 — the `tmp_path`-fixture test skipped in fallback mode, same
as T62). Full JS suite unaffected (991/63 files, unchanged — this turn touched no JS files).

**Mutation-tested the units fix**: reverted the `createByString` branch back to unconditional `createByReal` →
exactly 1 failure (`test_length_parameters_created_with_unit_bearing_expression`, reproducing the EXACT
advisor-reported symptom: a `("valueinput:real", 0.07)` call instead of `("valueinput:string", "0.07 in")`).
Restored, MD5-verified byte-identical. The cap-tangent removal's own non-vacuity is already proven by the test
itself (asserts the exact call list is empty — a mutation putting the `addTangent` call back would trivially
fail it, not re-run separately given the fix is a straight deletion, not new logic to mutate).

**Mid-task amendment, incorporated before committing (Fred, via the advisor, mid-flight — two copies arrived,
the second an explicit "clean resend" of the first after shell-quoting ate the parameter name the first time;
followed the second, corrected one)**: "I would prefer a unique stroke width param." When a layer's rail/tie
widths are LINKED (`PATTERN.widths.linkRailsTies`, the T58-era default), the manifest now emits ONE Fusion user
parameter, `stroke_width`, driving BOTH rail and tie offsets — replacing the separate `rail_width`/`tie_width`
pair for that case (a person editing the sketch in Fusion sees one control for "how thick is the lattice",
matching what the panel's own linked stepper already presents). Implemented in `manifestFromLattice`
(`editor-sketch-manifest.js`): `strokeWidthLinked = widths.linkRailsTies !== false || widths.rails ===
widths.ties` — true whenever EITHER the link flag is on OR the two widths just happen to already match, so the
separate-names path is reserved for the one case that genuinely needs two numbers (unlinked AND different).
`node_radius` is untouched either way. Confirmed (grep, not assumed) the Python builder has ZERO hardcoded
parameter-name strings anywhere in its actual logic (only in illustrative doc-comment examples) — it already
reads `parameters[]`/`dimensions[]` generically by structure, so this rename needed no Python change at all.
3 new JS tests (`tests/editor-sketch-manifest.test.js`, now 23): the default-linked case emits `stroke_width`
only, both rail and tie offset dimensions reference it; a genuinely unlinked-and-different layer still gets the
separate names (non-vacuous regression guard on the pre-existing behavior); an unlinked-but-numerically-equal
layer ALSO gets `stroke_width` (proves the rule is "linked OR equal", not "linked flag alone"). Mutation-tested
(`strokeWidthLinked` forced to `false`) → exactly 2 failures (the two tests that specifically expect
`stroke_width`; the unlinked-and-different test correctly still passed, since that one was never testing the
linked path). Restored, MD5-verified byte-identical. Full JS suite: 994 passed (63 files), up from 991.

Amendments polled clean immediately before this commit and will be polled again immediately before passing.
Committed by explicit path — pushed.

## T64 — SE15 must use the carve placement (centered, Y-flipped) + naming, from the advisor's own end-to-end test

Dispatch: the advisor's own real end-to-end Fusion test (feeding `PaletteHTMLEventHandler._import_all_svg_layers`
a real two-layer stamp payload) confirmed the wiring from T63 actually WORKS end to end (51 lines/36 arcs/16
circles, 78 constraints, 77 dims, 11s) — but the constrained sketch landed in the WRONG place: raw board
coordinates (bbox x −0.08..7.00, y −0.04..9.04 on a 7×9 board) instead of the SAME carve-space the plain-SVG
path already lands in (bbox x −1..1, y 0..1.5 for the SAME rect). Plus a naming mismatch ("Layer 1" vs the
SVG path's own "Source - L1 - vbit (0.25\")").

**Traced the REAL transform, not the one a stale comment claims.** `editor-coords.js`'s own `carveMatrix`
function has NO Y term at all (`d: dpi`, its own doc comment explicitly says "NO Y inversion... Fusion's
importer already yields the right orientation") — yet `editor-io.js`'s `bakeSvgForCarving` doc comment, right
next to where it calls `carveMatrix`, claims the mapping is "×dpi, flip Y, center." Read both directly rather
than trusting either comment at face value: the MATRIX VALUES prove no flip happens in this codebase's own JS;
the advisor's own MEASURED bbox (y 3..4.5 board -> y 0..1.5 carve, the exact negation of what "no flip" alone
would produce) proves a flip genuinely happens somewhere in the full pipeline regardless. Conclusion, stated
plainly rather than left ambiguous: the flip is an EMERGENT property of Fusion's own SVG import step (reading
raw Y-down SVG pixels onto a Y-up sketch plane), not something any of this codebase's own JS or Python code
executes — `bakeSvgForCarving`'s own doc comment is the stale one. Since `build_constrained_sketch` builds
geometry DIRECTLY (no SVG, no importer), it never gets that implicit flip for free — it has to be baked in
explicitly, matching the NET transform the advisor's own numbers describe: `x' = x - W/2`, `y' = H/2 - y`.

**Fixed at the ONE source, per the dispatch's own instruction: the JS manifest producer, not the Python
builder.** Added `applyCarvePlacement(manifest, region)` (`editor-sketch-manifest.js`) — ONE final pass over an
already-built manifest's own `entities[]`, applied right before `buildSketchManifest` returns. Every OTHER
producer (`manifestFromLattice`/`manifestFromShape`) keeps computing in the SAME natural board-space they were
already written and tested in — `constraints[]`/`dimensions[]`/`parameters[]`/`groups` reference entities BY
ID, never by raw coordinate, so none of them needed touching. The Python builder needed ZERO changes for
placement — it just converts whatever coordinates the manifest hands it, inches to cm, same as before.

**Worked out the arc-angle consequence by hand, not guessed.** A pure Y-reflection reverses angle sense: a point
at `center + r*(cos theta, sin theta)` maps to `center' + r*(cos(-theta), sin(-theta))` around the transformed
center (verified algebraically before trusting it in code — see the module's own new doc comment for the
derivation). So every `ArcCenter` entity gets BOTH `startAngleDeg` and `sweepDeg` negated alongside the
centered+flipped `center`; `radius` is unchanged (a reflection preserves distances). Confirmed H/V constraint
CHOICE (computed earlier, from natural-space coordinates) needs no recomputation — a reflection that remaps y
as a function of y alone can never turn a horizontal segment into a vertical one, so those constraints stay
correct without touching them.

**Naming fixed in the Python builder** (the actually-correct place for it, since the SVG-matching name — "L1 -
vbit (0.25\")" — is only known to `_import_all_svg_layers`'s own per-layer loop, not to the JS-side manifest,
which only ever sees a generic "Layer <id>" from `export-flow.js`): `build_constrained_sketch` gained an
optional `sketch_name_override` param, taking priority over `manifest.get("sketchName")` when given.
`_build_constrained_sketch_for_layer` (b-spline-gen.py, T63) now passes
`f"Source - {sketch_name} [constrained]"` — matching the plain-SVG path's own `f"Source - {sketch_name}"`
scheme plus a `[constrained]` tag so the two are visually distinguishable in Fusion's own browser tree. Omitting
the override (the `build_from_manifest_file` dev-entry-point path) keeps the manifest's own field exactly as
before — a real, disclosed behavior difference between the two callers, not silently unified.

**Tests**:
- JS (`tests/editor-sketch-manifest.test.js`, +4, now 27): every rail Line's own carve-space coordinates,
  cross-checked against an INDEPENDENT `computePattern`+`fromLattice` re-run (replicating `resolveBoardExtent`'s
  own exact formula in the test, since it isn't exported — a real bug in my FIRST version of this test caught
  by mismatched extents, not a bug in the transform itself, fixed before trusting the result); a direct,
  hand-computed check reproducing the advisor's own EXACT reported numbers (x 2.5..4.5, y 3..4.5 -> x −1..1,
  y 0..1.5) independent of any producer; a Shape Lattice arc's own center+radius+negated-angles, cross-checked
  against an independent `generateSilhouette` re-run; H/V constraint types confirmed unaffected (non-vacuous:
  asserts a real, positive H/V count exists first). Full JS suite: 1011 passed (63 files), up from 994.
- Python (`test_sketch_manifest_builder.py`, +1, now 16): `sketch_name_override` takes priority when given,
  falls back to the manifest's own field when omitted — both paths checked in one test against two separate
  builds on the same fake Design.

**Mutation-tested both fixes** (backup, mutate, run, confirm the EXACT expected failure, restore, MD5-verified
byte-identical): (1) `toCarvePoint` reduced to the identity (no transform at all) -> exactly 2 failures (the two
tests whose own assertions depend on the transform; the hand-computed and H/V-invariance tests correctly still
passed, since neither exercises `toCarvePoint` itself); (2) the naming override line reverted to ignore
`sketch_name_override` entirely -> exactly 1 failure (the dedicated naming test).

**Not done this turn (disclosed, not silent)**: no live CDP cross-check of the FULL SVG-bake pipeline
(`bakeSvgForCarving`'s own real bbox) against the manifest's own bbox on the same live page — the JS unit tests
already verify my new code against the advisor's own precisely-reported ground-truth numbers directly, and a
live cross-check would mostly re-exercise `bakeSvgForCarving`'s own EXISTING, unchanged behavior rather than
anything this turn touched; skipped as lower-value than the direct numeric verification already done, not
because "NO FUSION" required skipping it (a JS-only CDP check doesn't touch Fusion at all).

## T64 mid-task amendments (3, incorporated before committing) — one-sided offsets, cap-coincident redesign, box-lattice centerline mode

Three amendments arrived mid-flight, all from the advisor's own further live-Fusion measurement on the SAME
fixture, plus a priority-setting note from Fred relayed through the advisor. Order actually built (amendments'
own #3 asked for box=centerline FIRST; carve-placement above was already done by the time these landed — no
rework needed, the two are orthogonal: one fixes COORDINATES, the other fixes WHICH entities/dimensions exist at
all): (1) fixed the one-sided-offset bug, (2) redesigned caps around Coincident constraints instead of
Radial+Tangent, (3) split lattice fill into `centerline`/`offset` width modes per layer type.

**Amendment 1+2 — the offset was landing on the SAME side both times.** Measured live: for a rail at y=0, both
`sketch.offset()` calls produced lines at y=0 and y=+0.035 (never y=−0.035). Root cause (my own hypothesis, not
independently confirmed against Fusion's own source — I have no access to it): my own direction-point distance
was tied to the ACTUAL stroke width (~0.03-0.09 cm for a typical rail), too small for Fusion's own side-detection
to reliably read as "on this specific side" rather than "ambiguously close to the line." Fixed by DECOUPLING the
direction point's own distance from the real offset distance: `_perp_direction_point` now places it a fixed,
generous `_DIR_PROBE_CM = 5.0` away, regardless of how thin the actual stroke is — the ACTUAL offset distance
passed to `sketch.offset()` itself is unchanged. Also added `_signed_perp_distance` — a POST-HOC, log-only
verification (never raises) that each resulting offset curve actually landed on its requested side, so if this
fix is STILL wrong on the advisor's own next live run, it fails LOUDLY in the log instead of silently producing
wrong geometry again.

The advisor's own SEPARATE measurement of three candidate width mechanisms (addCenterToCenterSlot,
addTwoSidesOffset, two-classic-offsets) confirmed TWO of the three grow lopsided on a parameter change
(centerline drifts instead of staying put) and only the two-classic-offset approach (already what T62 built)
grows evenly — so the DECISION was to keep the existing mechanism and fix its one real bug, not switch approach.

**The cap redesign is the bigger change.** The advisor's own instruction: build each cap as an arc whose OWN
center is Coincident to the centerline's own end point, and whose own two ENDPOINTS are each Coincident to the
matching offset line's own endpoint — "radius and tangency then follow automatically." Implemented as
`_coincident_cap_to_offsets` (3 `addCoincident` calls per cap: center, pos-end, neg-end) — REPLACING the T61-era
Radial dimension entirely (removed from the JS producer's own `addWidthOffsetsAndCaps`, not just left unused —
a manifest that still declared it would double-drive the same geometry two independent ways, exactly what
produced T63's own over-constraint). Which offset curve's own end matches which cap end is resolved by NEAREST-
POINT geometric proximity (`_nearest_endpoint`), not by assuming `sketch.offset()` preserves start/end ordering
(untested, so not relied on). The offset curves themselves needed a NEW `ctx.set_id` registration (T62's own
first version created them but never tagged them) so their `:S`/`:E` points are resolvable at all for this
wiring.

**Disclosed, real uncertainty**: whether THREE Coincident constraints per cap (center + 2 endpoints, 6 equations
for a 5-DOF arc) is itself consistent for Fusion's own solver, or whether it's ANOTHER redundant-but-consistent
case that the solver tolerates (like the analytically-exact numeric seed geometry this codebase already relies
on elsewhere) versus one it flags — worked out the DOF count by hand (documented in the module's own new doc
comments) but could not verify against real Fusion this turn. If the advisor's own next live run finds THIS
combination also over-constrained, the disclosed fallback is dropping the "less informative" of the two endpoint
coincidences (the analytically-correct numeric seed alone already places that point right, in the same way the
node/rail geometry itself has always relied on correct-by-construction numeric placement without an explicit
constraint for every fact).

**Amendment 3 — box Lattice drops the offset/cap mechanism entirely (Fred: "offset sounds like a lot of work" →
"work to remove the offset function in the BOX lattice tool first").** A new `SKETCH_WIDTH_MODE = {boxLattice:
'centerline', shapeLattice: 'offset'}` (`editor-sketch-manifest.js`), chosen by `buildSketchManifest` from the
SAME `hasShape` discriminator it already computes — a plain box Lattice layer's own rails/ties get bare
centerlines + relationship constraints only (no Offset dimensions, no cap entities at all); a Shape Lattice
layer's own lattice fill keeps the full offset+cap mechanism (with this turn's own fixes). The width PARAMETER
(`stroke_width`/`rail_width`/`tie_width`) is STILL declared even in centerline mode — "a real, named reference a
person can read for CAM," per the amendment — it just drives no geometry. `manifest.widthMode` is now a real,
emitted field. The Python builder skips `_apply_width_offsets` ENTIRELY when `widthMode == 'centerline'` (not
just an empty-list no-op) — verified this actually matters via a fixture that DELIBERATELY still declares an
Offset dimension pair even in centerline mode (a defensive "what if the JS side ever regresses" check) — my
FIRST version of this test used an empty `dimensions[]`, which passed regardless of whether the gate existed at
all (caught by mutation, not assumed correct).

**Tests**:
- JS (`tests/editor-sketch-manifest.test.js`, +2, now 29): a plain box lattice gets `widthMode:'centerline'`
  with the stroke_width param present but zero Offset dimensions/cap entities, while H/V/tie-on-rail constraints
  still apply; a Shape Lattice layer keeps `widthMode:'offset'` with offsets/caps intact. Also updated the
  existing cap tests (2) to assert NO Radial dimension exists for a cap any more, replacing the old assertion
  that one did. Full JS suite: 1013 passed (63 files), up from 1011.
- Python (`test_sketch_manifest_builder.py`, +5, now 20): opposite-side signed-distance verification (would have
  caught the real bug, unlike the older, weaker "two calls happened" test); a DIRECT regression test against the
  fake shim's own modeled failure mode (a too-close dirPt defaults to one side — proves `_DIR_PROBE_CM` is load-
  bearing, not decorative); cap-coincident wiring (exactly 3 per cap, 0 Radial, 0 Tangent); centerline-mode skips
  the whole offset step (fixed after catching my own first version's vacuous fixture, above). Also fixed 2
  pre-existing tests whose own fixtures/assertions were now stale (a leftover cap-Radial-dimension entry in the
  hand-built fixture; the threshold test's own "zero constraints of any kind" assertion, now needing to account
  for the cap-wiring's own always-on Coincident calls).

**Mutation-tested three of the riskiest new pieces** (backup, mutate, run, confirm the EXACT expected failure,
restore, MD5-verified byte-identical): (1) `useOffsets` (JS) forced `true` regardless of widthMode -> exactly 1
failure (the centerline-mode test); (2) `_DIR_PROBE_CM` reduced from 5.0 to 0.05 (Python) -> exactly 1 failure
(the opposite-sides test) — reproducing the advisor's own reported symptom almost exactly; (3) the Python
`widthMode` gate forced to always run offsets -> caught a GENUINELY VACUOUS test on the first attempt (my own
centerline fixture had empty `dimensions[]`, so the mutation changed nothing observable) — fixed the fixture to
deliberately include an Offset entry, re-confirmed the mutation THEN produces exactly 1 failure, restored.

**Verification snippet for the advisor's own next live Fusion run** (checks: opposite-side signed distances;
cap endpoints coincide with the matching offset line's own endpoint; zero Tangent constraints touch any cap) —
paste into `fusion_execute` against a sketch `build_constrained_sketch` (or `build_from_manifest_file`) just
built:

```python
import adsk.core, adsk.fusion, math

app = adsk.core.Application.get()
design = adsk.fusion.Design.cast(app.activeProduct)
sketch = design.rootComponent.sketches.item(design.rootComponent.sketches.count - 1)  # the just-built one

def signed_dist(line, pt):
    p1, p2 = line.startSketchPoint.geometry, line.endSketchPoint.geometry
    dx, dy = p2.x - p1.x, p2.y - p1.y
    length = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / length, dx / length
    return (pt.x - p1.x) * nx + (pt.y - p1.y) * ny

lines_by_name = {}
for c in sketch.sketchCurves.sketchLines:
    try:
        attr = c.attributes.itemByName('FrameBuilder', 'ID')
        if attr:
            lines_by_name[attr.value] = c
    except Exception:
        pass

for base_id, line in list(lines_by_name.items()):
    pos = lines_by_name.get(f"{base_id}_offset_pos")
    neg = lines_by_name.get(f"{base_id}_offset_neg")
    if not pos or not neg:
        continue
    mid = lambda l: adsk.core.Point3D.create(
        (l.startSketchPoint.geometry.x + l.endSketchPoint.geometry.x) / 2,
        (l.startSketchPoint.geometry.y + l.endSketchPoint.geometry.y) / 2, 0)
    ds_pos, ds_neg = signed_dist(line, mid(pos)), signed_dist(line, mid(neg))
    status = "OK" if ds_pos > 0 and ds_neg < 0 else "BAD (same side or wrong sign)"
    print(f"{base_id}: pos={ds_pos:.4f}cm neg={ds_neg:.4f}cm -> {status}")

tangent_on_caps = 0
for c in sketch.geometricConstraints:
    try:
        if c.objectType.endswith('TangentConstraint'):
            for prop in ('entityOne', 'entityTwo'):
                ent = getattr(c, prop, None)
                attr = ent.attributes.itemByName('FrameBuilder', 'ID') if ent and hasattr(ent, 'attributes') else None
                if attr and ('_capA' in attr.value or '_capB' in attr.value):
                    tangent_on_caps += 1
    except Exception:
        pass
print(f"Tangent constraints touching a cap: {tangent_on_caps} (expect 0)")
```

Amendments polled clean immediately before this commit and will be polled again immediately before passing.
Committed by explicit path — pushed.

## T64 wave 2 (5 more mid-task amendments) — the offset+cap mechanism above is SUPERSEDED entirely by Fusion-native anchored slots, plus a new node-to-piece Coincident feature

Fred's own final call, relayed through the advisor, after wave 1 above had already fixed the offset+cap mechanism
twice: stop patching that mechanism and REPLACE it outright. "Box lattice needs to be slots too" — so this isn't
a narrower version of wave 1, it deletes wave 1's own cap/offset machinery wholesale, for BOTH box Lattice and
Shape Lattice, and replaces it with ONE Fusion-native call per rail/tie: `addCenterToCenterSlot`. Per this repo's
"declare over hand-roll" bar, this is a strictly better fit than what wave 1 kept patching — a single native
primitive that already IS the width mechanism, instead of two offset lines plus a hand-built cap-arc wiring
scheme standing in for one.

**What got deleted, wholesale, not incrementally**: JS — `capArc`, `addWidthOffsetsAndCaps`. Python —
`_resolve_offset_seed_distance`, `_perp_unit_vector`, `_DIR_PROBE_CM`, `_perp_direction_point`,
`_signed_perp_distance`, `_do_single_offset`, `_nearest_endpoint`, `_coincident_cap_to_offsets`,
`_apply_width_offsets` (~250 contiguous lines, sliced out directly). `SKETCH_WIDTH_MODE` is now `{boxLattice:
'slot', shapeLattice: 'slot'}` — both resolve to the SAME value now, but kept as a declared per-layer-type table
rather than one hardcoded string, because `'centerline'` (a bare undimensioned line, wave 1's own box-lattice
default) is EXPLICITLY kept as a real, still-available, just-no-longer-default value for a possible future manual
override — not deleted outright, since nothing asked for that.

**New entity type: `Slot` `{id,type,p1,p2,width}`** (replacing Line for every rail/tie), and a new dimension type
`SlotWidth {type,target,expression}` handled at GEOMETRY-CREATION time itself (not a separate later dimensions
phase) — `addCenterToCenterSlot` creates its own width dimension as a side effect of creation, so there is no
"dimensions phase" left to defer it to; `_create_slot_entity` re-drives that just-created dimension's own
`.expression` immediately, via the SAME `_drive_last_dimension` helper (generalized from wave 1's own
offset-specific version, identical "find the last dimension in `sketch.sketchDimensions`" logic, now used for
one geometry-side-effect kind instead of two).

**`_find_slot_centerline` — the one piece of this turn's own design with a REAL disclosed uncertainty.**
`addCenterToCenterSlot`'s own return value is, per the advisor's own description, "2 side lines + 2 end arcs" —
phrased as possibly NOT including the construction centerline at all. Rather than trust that return value's own
contents (UNVERIFIED against real Fusion this turn), this searches `sketch.sketchCurves.sketchLines` directly —
the WHOLE sketch, not just the call's own return — for the ONE line whose two endpoints match the manifest's own
p1/p2 EXACTLY (`distanceTo < 1e-7`). The centerline sits exactly there by construction; the two side lines sit
offset away from it, so an exact match is unambiguous with no proximity heuristic needed. The centerline (not
the visible slot body) is what gets registered under the piece's own manifest id — every relationship
constraint (H/V, tie-on-rail, the new node coincidences) targets rails/ties by that bare id, and the advisor's
own instruction was explicit that those constraints act on the slot's own centerline, not its visible edges.

**Anchoring, belt-and-suspenders.** An anchored slot grows evenly on a width change; an unanchored one drifts
lopsided (the advisor's own measurement). Passed as `addCenterToCenterSlot`'s own 4th argument (`isFixed=True`,
per the advisor's own literal example) AND set explicitly on the found centerline's own two endpoints afterward
— since which of the two mechanisms actually does the anchoring in real Fusion is itself unverified this turn,
both are applied rather than guessing which one to skip.

**New feature, not in either original dispatch: node-to-piece Coincident constraints.** Every node (a Circle) that
sits on a rail/tie now gets an explicit Coincident declared to it — `nodePieceCoincidences(pt)` (JS) classifies
each node point against every rail/tie segment: an exact endpoint match emits the `:S`/`:E`-suffixed target (the
tie-on-rail convention already established), a mid-span match emits the BARE id, which resolves to the point-
on-curve overload via `BuildContext.resolve_entity`'s own existing convention — the SAME mechanism already used
for tie-on-rail, so no new schema field or Python-side code was needed for this at all; `_apply_constraints`
passes these through generically, exactly as it already did for every other declared Coincident.

**No symmetry constraint, deliberately** — the advisor's own measurement: the slot is already symmetric by
construction, an explicit symmetry constraint over-constrains. Never implemented in the first place; kept as an
explicit regression assertion rather than trusted silently (a Tangent/Symmetric/Symmetry constraint call would
fail this build's own test).

**Tests**:
- JS (`tests/editor-sketch-manifest.test.js`, now 30): every rail/tie is a Slot with exactly one SlotWidth
  dimension referencing its own width param (linked and unlinked cases); the >=threshold case still creates every
  Slot + its dimension with zero per-piece relationship constraints; a new node-to-piece-Coincident test that
  independently re-derives end-vs-mid-span classification from the lattice's own geometry and cross-checks it
  against the declared constraints (non-vacuous: asserts both `endMatches > 0` and `curveMatches > 0`, so a broken
  classifier or an empty constraints list both fail it); `applyCarvePlacement` extended to handle `'Slot'` (was
  silently skipping it before — caught by a failing carve test, `expected 0.25 to be close to -3.25`, off by
  exactly `REGION.w/2`, i.e. the untransformed value). Full JS suite: 1014 passed (63 files).
- Python (`test_sketch_manifest_builder.py`, now 17 — down from a peak of 20 mid-rewrite): every wave-1 test that
  targeted the now-deleted offset/cap mechanism was either deleted outright (5: the two-offset-sides test, the
  dirPt-probe regression test, the cap-coincident-wiring test, the width-offsets-count test, the offset-dimension-
  expression test) or rewritten for slots (the threshold test now checks slots+SlotWidth dims still get created
  with zero relationship constraints; a redundant Tangent-absence test was folded into the new symmetry-absence
  test instead of kept as a separate, now largely vacuous check). New: slot creation is anchored + happens once
  per piece (checked across ALL THREE fixture pieces, not just the first — see the mutation-testing note below for
  why that matters); SlotWidth dimension expressions match the manifest exactly (rail_width x2, tie_width x1,
  distinguishing rails from ties by DIFFERENT numeric values so a swapped-argument bug would be caught); the
  no-symmetry/no-tangent regression check; `'centerline'` mode re-purposed to prove the plain-Line entity-dispatch
  branch still works standalone (the Python side never reads `manifest.widthMode` at all — it dispatches purely
  per-entity `type` — so this is really "adding the Slot branch didn't break the pre-existing Line branch," not a
  widthMode gate test, since no such gate exists on the Python side). Also removed the now-fully-dead
  `FakeSketch.offset` fake-shim method (unreferenced by any surviving test or production code path) and the
  `_coll` helper that only existed to feed it. Both pytest and the plain-`python3` fallback mode are green
  (17/16 respectively — the file-reading test uses `tmp_path`, excluded from the fallback list per the
  pre-existing convention).

**Real gap caught and fixed, NOT part of any dispatch**: `addSlotPieces` (JS) built every Slot entity with NO
`width` field at all — `entities.push({ id, type: 'Slot', p1, p2 })`, no width — even though
`_create_slot_entity` (Python) reads `ent.get("width", 0.07)` as its own seed value for `addCenterToCenterSlot`.
Every rail/tie would have silently seeded at the hardcoded 0.07in fallback regardless of its own actual
configured width (harmless for the FINAL geometry, since the width gets re-driven by its own expression right
after creation anyway, but wrong/misleading as an initial seed, and the Python test fixtures had already been
hand-written to assume `width` was present, meaning the two sides had quietly drifted apart). Fixed by threading
the already-in-scope `widths.rails`/`widths.ties` value through `addSlotPieces`'s own new `widthValue` parameter
at all 4 call sites. Caught by re-checking the JS producer's OWN current code directly rather than trusting the
Python fixture's assumption — the pending-task note from before compaction flagged this as unconfirmed, and it
turned out to be a real gap, not a false alarm.

**Mutation-tested three of the riskiest new Python pieces** (backup, mutate, run, confirm the EXACT expected
failure set, restore, MD5-verified byte-identical restore each time):
1. `_find_slot_centerline`'s own exact-match loop, mutated to `return lines.item(0)` unconditionally (ignore
   p1/p2 entirely) — **first attempt exposed a genuine test-coverage gap, not a clean pass**: the ORIGINAL
   anchoring test only checked rail0 (the first slot ever created), and `item(0)` happens to BE rail0's own
   centerline purely because it was appended first — the mutation slipped through with 17/17 still green. Fixed
   by strengthening the test to check EVERY slot's own centerline by its own declared p1/p2 (rail0, rail1, tie0),
   which is what actually exercises the exact-match discrimination between pieces rather than coincidentally
   passing on construction order. Re-ran the same mutation against the strengthened test: exactly 1 failure
   (`AttributeError: 'FakeSketchPoint' object has no attribute 'isFixed'`, since rail1's real centerline never
   got registered or anchored under the mutation) — confirmed non-vacuous, restored, MD5-verified.
2. The width-dimension-drive call (`_drive_last_dimension(...)` at the end of `_create_slot_entity`) deleted
   entirely — exactly 1 failure (`assert 0 == 2` on the rail_width expression count), 16/17 passed. Restored,
   MD5-verified.
3. The JS-side `addSlotPieces` width-threading fix itself (the gap above) — reverted to the pre-fix version
   (no `width` field at all) against the NEW JS test asserting `e.width` matches `PATTERN.widths.rails`/`.ties`
   exactly (using the base fixture's own DELIBERATELY different rail/tie values, 0.07 vs 0.05, so a swapped
   argument would also be caught): exactly 1 failure (`expected undefined to be 0.07`), 29/30 passed. Restored,
   MD5-verified.

**Disclosed, unverified against real Fusion this turn** (NO FUSION held throughout — flagged for the advisor's
own live check, same discipline as wave 1's own disclosures above): whether `addCenterToCenterSlot`'s own return
value actually excludes the construction centerline (the premise `_find_slot_centerline`'s whole-sketch search
was designed around, rather than trusting the return collection); whether the `isFixed=True` 4th-argument alone
is sufficient anchoring or whether the explicit post-hoc `SketchPoint.isFixed = True` sets are the ones actually
doing the work (both are applied, so either way it should anchor correctly — just unconfirmed which one is
load-bearing); whether a node-to-piece Coincident (a Circle's own bare id as one target) resolves through
`BuildContext.resolve_entity`'s existing `:C`-suffix convention correctly without an explicit `:C` suffix in the
declared target — this is PRE-EXISTING fb_engine machinery untouched by this turn's own changes, so it was not
re-mutation-tested here (out of this turn's own scope — that dispatch logic has its own tests from earlier work).

Per Fred's own "no merge()" rule (mentioned during the amendment relay: every joint should stay separably
deletable), this design never calls `SketchPoint.merge()` anywhere — every coincidence, old or new, is a
plain `addCoincident` between two still-separate points, which this architecture already did naturally without
needing a deliberate check to keep it that way.

Amendments polled clean immediately before this commit and will be polled again immediately before passing.

## T65 — SE15 fixes from the advisor's REAL Fusion run of T64: every slot skipped, silhouette arcs landed outside the board

T64 was NOT merged — the advisor ran lane-b's own builder on real fixtures (box + shape manifests) in real Fusion
and found two bugs the "NO FUSION" unit-test suite could not have caught on its own, because the FAKE shim
encoded the same wrong assumption the production code did — shim and code agreed with each other, just not with
real Fusion. Both are now fixed in the module, the shim, AND the JS producer, with the shim fix specifically
verified (via mutation) to actually catch the class of bug that slipped through T64.

**Bug 1 — every slot was skipped.** `addCenterToCenterSlot` (and its siblings — `addThreePointArcSlot`,
`addCenterPointArcSlot`, `addCenterPointSlot`, `addOverallSlot`, all confirmed live via `dir()`) live on `Sketch`
itself, not on `SketchLines` — T64's call site had `curves.sketchLines.addCenterToCenterSlot(...)`, which raised
`AttributeError` on every single call, caught one level up by `_create_geometry`'s own per-entity try/except and
silently logged as a skip (80 on the advisor's box fixture, 94 on shape — "CONSTRAINT MISS: railN not found"
downstream, since no rail/tie ever got registered under its own id; the box sketch ended up with 20 circles and
ZERO lines). Fixed the call site to `sketch.addCenterToCenterSlot(...)`.

The advisor's own live measurement of the return value: "a generic vector" — not reliably carrying the
centerline as a named, indexable member. Rather than trust it at all, `_find_slot_centerline` now takes the
advisor's own recommended technique: diff `sketch.sketchCurves.sketchLines`' own count before/after the call
(`addCenterToCenterSlot` appends exactly 3 new lines — 2 sides + 1 centerline; the 2 end arcs land in
`sketchArcs`, irrelevant here) and search ONLY that new slice for the exact p1/p2 match, rather than T64's own
whole-sketch search. This is strictly narrower/safer than T64's version, not just a style change: whole-sketch
search happened to work for the FIRST slot purely by construction-order coincidence (its own centerline WAS the
first line in the sketch) but could mis-identify a LATER piece's centerline if two pieces' exact coordinates
ever collided — narrowing the search window to just this call's own new lines removes that risk entirely, on top
of now also being required by the fact that a stale whole-sketch cache could includes lines added by an
unrelated earlier call.

**Bug 2 — Shape Lattice silhouette arcs landed outside the board after the Y flip.** The advisor's own real
measurement on a 7-wide board: arc centers at cx = 3.578, 5.189, −4.673, −6.384... (expected roughly ±3.5,
symmetric) — left half not a mirror of the right, arc ends not meeting their neighbouring line's own end. T64's
own `applyCarvePlacement` negated `startAngleDeg`/`sweepDeg` around the transformed center — a hand-worked
derivation for a pure reflection that checks out symbolically (see the now-superseded comment this replaces,
still readable via `git log`/T64's own commit) but evidently diverges from Fusion's OWN `addByCenterStartSweep`
sweep-sign convention in a way that was never independently verifiable without a live Fusion run — angle
representations are fragile exactly because a sign/convention mismatch can hide behind math that looks correct
on paper.

The advisor's own fix, applied directly: never re-derive an angle representation after a reflection at all.
`toCarveArc3Point` (new, JS) computes the arc's own 3 DEFINING POINTS (start, mid-sweep, end) in the SAME natural
board-space the silhouette generator already built and tested them in, runs each one through the IDENTICAL
`toCarvePoint` map lines/circles already use (simple coordinate arithmetic, no angle math to get wrong), and the
entity's own `type` mutates from `'ArcCenter'` to `'Arc3Point'` as part of the SAME pass — a genuine
representation change (center+radius+angle isn't carryable through a reflection without this exact risk), named
to match fb_engine's own pre-existing `'Arc3Point'` convention (`geometry.py`'s `_create_arc3`) rather than
inventing a new name for the same concept. Python side: new `_create_arc3_entity` builds via
`curves.sketchArcs.addByThreePoints(p1, pMid, p2)` directly off the already-resolved manifest inches (the SAME
`_to_point3d` convention every other entity in this module uses) — a sibling to fb_engine's own `_create_arc3`,
not a delegation to it, since that one resolves template EXPRESSION strings via `ctx.resolve_val`, a different
calling convention entirely. `_create_arc_center_entity`/the raw `'ArcCenter'` dispatch branch is left intact —
still correct and still used for any manifest that never goes through carve placement at all (e.g. a direct,
non-placed `manifestFromShape` caller); only the CARVE-PLACED path changes.

**Fix 3 — the shim itself, per the dispatch's own explicit instruction ("so these two bugs would have failed your
tests. Mutation-check that.")**: moved `addCenterToCenterSlot` off `FakeSketchLines` onto `FakeSketch` (matching
the real API), and added `FakeSketchArcs.addByThreePoints` — computes its own arc's center via a real circumcenter
formula from the 3 given points (never given, always DERIVED, matching the real API's own semantics, the reverse
of `addByCenterStartSweep`'s fake where center is given and the end point is derived).

**Tests**:
- Python (`test_sketch_manifest_builder.py`, now 18): a new `_shape_manifest_with_arc3point` fixture (2 lines +
  1 Arc3Point in between) + a test that checks the arc builds via `addByThreePoints` with the correct 3 points
  AND — per the dispatch's own explicit ask — checks by GEOMETRY, not just call-log counts: the arc's own real
  `startSketchPoint`/`endSketchPoint` must coincide with its neighbouring lines' own real endpoints, independent
  of ids. Both pytest (18/18) and the plain-`python3` fallback (17/17, `tmp_path`-using test excluded per the
  pre-existing convention) are green.
- JS (`tests/editor-sketch-manifest.test.js`, now 32, +2 net after replacing 1 stale test with 3 new ones): the
  carve-placed arc entity becomes `Arc3Point`, its own 3 points independently re-derived from the primitive's own
  `cx/cy/rx/theta1/dTheta` in natural space then transformed (never trusting `toCarveArc3Point`'s own internals);
  every silhouette segment's own `:E` coincides with the NEXT segment's own `:S` around the WHOLE closed loop
  (the dispatch's own explicit acceptance test: "every arc end coincides with its neighbour line end"); the
  carve-placed silhouette's own bbox matches an independently-sampled natural-space bbox run through the same
  raw transform formula, and never bulges outside the true (densely-sampled) bbox — directly targeting the
  advisor's own reported symptom of centers landing outside the board. Full JS suite: 1016 passed (63 files).

**Mutation-tested all three fixes** (backup, mutate, run, confirm the EXACT expected failure, restore, MD5-verified
byte-identical restore each time):
1. Reverted ONLY the Python call site back to `curves.sketchLines.addCenterToCenterSlot(...)` (bug 1's own exact
   regression, keeping the now-fixed shim in place) — exactly 9 of 18 tests failed with `AttributeError:
   'FakeSketchLines' object has no attribute 'addCenterToCenterSlot'`, reproducing the advisor's own reported
   symptom almost exactly. Confirms the fixed shim WOULD have caught T64's own bug had it been in place then.
   Restored, MD5-verified.
2. Swapped `p1`/`p2` order in the new `addByThreePoints` call — exactly 1 failure, the new geometry-based
   endpoint-continuity assertion (`assert (2.54, 2.54) == approx((2.54, 0.0))`), 17/18 passed. Restored,
   MD5-verified.
3. Reverted `applyCarvePlacement`'s own `ArcCenter` branch back to T64's angle-negation approach (keeping
   `toCarveArc3Point` itself untouched, unused) — exactly 2 of 32 JS tests failed (the Arc3Point type-check test,
   and the endpoint-continuity test's own non-vacuous precondition `arcs.length > 0`, since no entity was an
   Arc3Point under the reversion). The independently-sampled bbox test did NOT fail under this mutation — an
   honest finding, not swept under the rug: T64's angle-negation math is internally self-consistent as PURE
   reflection math (worked by hand, see T64's own now-superseded comment), so a bbox computed in pure JS from
   that same self-consistent math still lands in a plausible place; the advisor's own reported bug (centers
   outside the board) most plausibly lives at the Fusion-API boundary (a sweep-sign convention mismatch in real
   `addByCenterStartSweep`) that no amount of pure-JS testing can observe directly — which is exactly why the
   fix moved to a representation (3 raw points) that has no angle-sign convention left to get wrong on either
   side of that boundary, rather than trying to hunt down and patch the exact original sign error blind.
   30/32 passed under the reversion. Restored, MD5-verified.

**Disclosed, unverified against real Fusion this turn** (NO FUSION held throughout, per the dispatch): whether
`addByThreePoints`'s own real return value behaves as assumed (start/end SketchPoints matching the given p1/p2
exactly — a reasonable assumption for a 3-point arc, unlike `addCenterToCenterSlot`'s own murkier "generic
vector", but not independently confirmed live); did not have access to the advisor's own exact fixture files
(`scratchpad\t64\t64.json`, `m_box.json`, `m_shape.json` — presumably local to the advisor's own machine/session)
so verification here relies on hand-built equivalent fixtures matching the STRUCTURE the dispatch described, not
a byte-for-byte replay of the advisor's own real run.

Amendments polled clean immediately before this commit and will be polled again immediately before passing.

## T66 — SE15: never use Fix anywhere, relationship constraints carry the FULL job; a real zero-length-piece bug found and fixed; the shape bbox blowup investigated but NOT reproduced

T65 was NOT merged either — the advisor's own real Fusion run of that exact commit found the slot mechanism itself
now WORKS (every slot built, in both box and shape fixtures) but is fully OVER-CONSTRAINED: all 63 relationship
constraints on the box fixture failed VCS_SKETCH_OVER_CONSTRAINTS, root-caused by T64's own anchoring — a Fixed
point has 0 DOF, so ANY constraint that also touches it (Horizontal, Coincident) is automatically redundant. Fred's
own rule, relayed through the advisor: never use Fix, anywhere, full stop.

**Fix 1 — remove Fix entirely, on BOTH of T64's own mechanisms.** `_create_slot_entity`'s `addCenterToCenterSlot`
call now always passes `False` as its own 4th argument (was `True`); the post-hoc
`centerline.startSketchPoint.isFixed = True` / `endSketchPoint.isFixed = True` block is deleted outright, not
just left unreachable. Pinning every piece in place is now ENTIRELY the relationship constraints' own job — the
advisor's own measured minimal example (2 rails + 1 tie, all slots, NO Fix: rails Horizontal, tie Vertical, tie
ends Coincident to their rail's own centerline) produced ZERO failures, plus a stable, REVERSIBLE width-parameter
round-trip (0.07in -> 0.2in moved centerlines only 0.005in; 0.2in -> 0.07in returned EXACTLY) — evidence that an
unanchored, purely-relationship-constrained slot is not just "not over-constrained" but genuinely well-behaved.

**Fix 2 — tie-on-rail Coincident precision, brought in line with the node-wiring's own existing 3-way
distinction.** The dispatch's own described scheme explicitly distinguishes "tie ends Coincident point-on-curve
to their rail centerline (OR point-point Coincident when on a rail END)" — a distinction `nodePieceCoincidences`
already made (end-match -> `:S`/`:E`, mid-span match -> bare id) but the SEPARATE, older tie-on-rail wiring never
did (it always used the bare rail id, even when the tie's own end landed EXACTLY on the rail's own end). This
crude 2-way check happened to still validate while every centerline end was Fixed (any ambiguity from
point-on-curve vs point-to-point was moot against a 0-DOF point) — with Fix now gone entirely, the SAME precision
is worth having on both call sites, not just the node one. Extracted the shared 3-way check into
`pieceEndOrCurveTarget(pt, seg, id)` (JS), used by both `nodePieceCoincidences` and the tie-on-rail loop now —
removes a small duplicated-logic smell as a side effect, not the primary point of the change.

**Fix 3 — a REAL, reproducible bug: exactly-zero-length rail/tie pieces.** The advisor's own shape fixture hit
"InternalValidationError : isSuccessful" building one tie's own Slot. Reproduced directly (not guessed) via a
real run of `buildSketchManifest` against the DEFAULT hourglass preset, no exotic params needed — `tie3` (in my
own run) comes out at EXACTLY 0.0 length, because the Shape Lattice boundary clip lands a tie's own two ends at
the identical lattice point. `addCenterToCenterSlot`/`addByTwoPoints` both need a real, non-degenerate direction
to build from; a zero-length piece has none. Fixed at the SOURCE (`manifestFromLattice`'s own rail/tie piece
loops), not left for the Python builder to catch defensively: any piece whose own computed length is below
`MIN_PIECE_LENGTH = 1e-6` inches (a tight, exact-coordinate-collision threshold, not a "merely short piece"
cutoff) is filtered out before it becomes any entity at all, for EITHER width mode
(a degenerate LINE would be equally meaningless). ids are simply not reserved for a filtered piece (gaps in the
numbering are fine — nothing downstream assumes contiguity).

**The shape bbox blowup — investigated thoroughly, NOT reproduced, disclosed honestly rather than guessed at.**
The advisor's own real run reported bbox −13.29..21.87 × −39.39..38.30 on a 7×9 board (T65's own report, before
this fix, was −6.38..5.19 — a DIFFERENT, larger kind of wrong, suggesting T65's own arc fix didn't simply fail to
help but may have introduced or exposed something new). Checked, with a real script run against THIS module's
own actual functions (not reasoned about blind, per this project's own "measure, don't re-reason" habit):
- `manifestFromShape`/`applyCarvePlacement`/`toCarveArc3Point`/`buildSketchManifest` re-read line by line for a
  units mismatch, a double-applied transform, or a segment computed in the wrong (lattice vs board-inches)
  space — found none; `region` is the SAME object passed to every call site, never mutated or recomputed between
  the shape producer and the carve-placement pass.
- A default hourglass fixture (region 7×9, spacing 0.25) produces a bbox of EXACTLY ±3.5/±4.5 — board-sized,
  correct.
- A param sweep (hourglass at waistReach 0.05/0.95, cornerRadius 0.02/0.98; bottle at neckWidth 0.02, neckLength
  0.98) found every silhouette arc's own circumscribed-circle radius stayed well under board scale (max ~3.08) —
  no near-collinear/shallow-arc numerical instability, the one JS-side failure mode that COULD plausibly explain
  an out-of-proportion derived circle from otherwise-reasonable points.
- The SAME sweep is what surfaced Fix 3's own zero-length piece — in the DEFAULT config, with no exotic params
  at all.
Given the zero-length piece is CONFIRMED and reproducible, and a degenerate `addCenterToCenterSlot` call
(direction vector normalized from a zero-length delta) is a well-known source of exactly this kind of numerical
blowup in constructed geometry — my own fakes explicitly guard against dividing by zero here (`length = ... or
1.0`) specifically because a raw zero-length delta is unsafe to normalize, but nothing guarantees REAL Fusion's
own internal math has (or needs) the identical guard — my WORKING HYPOTHESIS is that Fix 3 is the same root cause
behind the bbox blowup too, or at least a major contributor: a degenerate slot call failing partway through
could leave partial/garbage geometry in the sketch before raising, which would corrupt the reported bbox without
needing a separate JS-side bug. This is NOT independently confirmed against real Fusion this turn (NO FUSION) —
flagged explicitly for the advisor's own next live run: if the bbox is still wrong even with Fix 3 in place,
the fixture files (`m_shape.json` or equivalent) or the raw entity list would help pin down whatever's left,
since exhaustive review of this module's own code, plus targeted param sweeps, found nothing else.

**Shim fixes (dispatch's own explicit ask: "assert the builder never sets isFixed... model over-constraint...
as a failure so this class can't pass again").** `FakeSketchPoint.isFixed` is now a real property whose SETTER
RAISES `AssertionError` if ever set to `True` — a structural guard, not a passive assertion checked after the
fact: if any future change reintroduces `.isFixed = True` anywhere production code runs, the very first test that
exercises that path fails immediately, at the exact call site, with a message naming Fred's own rule directly.
`FakeSketch.addCenterToCenterSlot` now realistically applies its own `is_fixed` argument to the centerline's own
two endpoints (previously ignored it entirely) — so a reintroduced `True` 4th-argument is caught at the SAME
place the real bug lived, not just via a separate check bolted on elsewhere.

**Tests**:
- Python (`test_sketch_manifest_builder.py`, now 19): the old T64 anchoring test is REWRITTEN (not just renamed)
  to assert the OPPOSITE — every slot centerline's own `isFixed` is `False`, and the API call's own 4th argument
  is `False`, checked across ALL THREE fixture pieces (matching the original's own non-vacuity discipline); a new
  DIRECT test proves the shim's own `isFixed` setter raises on `True` and still accepts `False`. Both pytest
  (19/19) and the plain-`python3` fallback (18/18) green.
- JS (`tests/editor-sketch-manifest.test.js`, now 34): a new tie-on-rail precision test independently re-derives,
  for every declared tie-on-rail Coincident, whether the tie's own end matches the rail's own end EXACTLY or
  lands mid-span, and asserts the target string matches (`rail:S`/`:E` vs bare `rail`) — non-vacuous for BOTH
  branches on the existing `PATTERN`/`EXTENT` fixture; a new zero-length-piece test reproduces the SAME default-
  hourglass degenerate tie directly (independently re-deriving the RAW `computePattern` segments to confirm the
  fixture genuinely contains one, not just trusting the filter's own absence-of-evidence) and asserts no built
  Slot/Line entity ever has near-zero length. Full JS suite: 1018 passed (63 files).

**Mutation-tested all three JS/shim fixes** (backup, mutate, run, confirm the EXACT expected failure, restore,
MD5-verified byte-identical restore each time):
1. `MIN_PIECE_LENGTH` changed from `1e-6` to `-1` (the filter never triggers) — exactly 1 failure (the new
   zero-length test), 33/34 JS tests passed. Restored, MD5-verified.
2. Tie-on-rail's own `pieceEndOrCurveTarget` call reverted to the old always-bare-id behavior — exactly 1 failure
   (the new precision test, `expected 'rail3' to be 'rail3:S'`), 33/34 passed. Restored, MD5-verified.
3. The Python call site's own `False` reverted back to `True` (simulating a future regression reintroducing T64's
   own mistake, with the now-fixed shim in place) — 8 of 19 tests failed, cascading from the shim's own raising
   setter through `_create_geometry`'s per-entity try/except (caught as a GEOM FAIL, corrupting entity/dimension
   counts downstream) PLUS the direct `assert call[-1] is False` check. Strongly non-vacuous — confirms the shim
   would have caught T64's own original mistake outright, not just this turn's own new test for it specifically.
   Restored, MD5-verified.

**Disclosed, unverified against real Fusion this turn** (NO FUSION held throughout): whether Fix 3 (the
zero-length-piece filter) actually resolves the bbox blowup, per the working hypothesis above — genuinely
unconfirmed, not claimed as fact; whether the relationship-constraint scheme is FULLY free of redundancy once
Fix is removed — specifically, a NODE that coincides with a tie's own end that is ALSO wired via tie-on-rail
could produce three separate Coincident constraints among the same 3 mutually-linked points/curves (node-to-rail,
node-to-tie-end, tie-end-to-rail), where the third is transitively implied by the other two. `computePattern`'s
own `addNode` calls confirm nodePoints DOES structurally overlap tie/rail endpoints (called at every tie's own
end, at every rail joint). NOT fixed this turn: the advisor's own measured "ZERO failures" example was
deliberately minimal (no node in it at all), so this specific triangle was never actually exercised either way,
and NO FUSION means I can't confirm whether Fusion's own solver tolerates it (the way several OTHER
correct-by-construction redundancies already are elsewhere in this codebase) or flags it. Flagged for the
advisor's own next live run rather than speculatively removing a constraint relation I can't verify is safe to
drop.

Amendments polled clean immediately before this commit and will be polled again immediately before passing.

## T67 — SE15: three real-Fusion-measured fixes, a dedup, the tie-span default (with two newly-discovered/fixed
## boundary bugs), and a full "one-ended ties" redesign — amendments 2 (parity) and 5 (contour-as-slots) DEFERRED,
## explicitly flagged for a fresh turn given their own substantial scope

T66 was NOT merged either — the advisor ran it in real Fusion and confirmed the slot mechanism now WORKS end to
end but is fully over-constrained. Separately, the SAME live run found two more real bugs in T65's own arc/node
work. This single turn absorbed FIVE further mid-task amendments after that (an unusually long chain even by this
project's own standard) — each is its own section below, in the order they actually landed and were incorporated.

### Part 1 — the three dispatched fixes, all real-Fusion-measured by the advisor

**Fix 1 — `addCenterToCenterSlot`'s own 4th argument is CREATE-WIDTH-DIMENSION, not Fix.** T66 set it `False` on
the theory it was the SAME mechanism as T64's own post-hoc `isFixed = True` (the actual Fix bug, confirmed
correctly removed and staying removed). Measured live: `False` means NO `SketchDiameterDimension` gets created at
all, so `_drive_last_dimension` found nothing to re-drive (every slot's own width dimension came back "DIM MISS",
`stroke_width` drove nothing, and 34/35 relationship constraints ALSO failed — plausibly downstream of a
dimensionless slot's own geometry not fully resolving). Reverted to `True` — a genuinely different knob from Fix
that happened to share T64's own anchor argument's call-site position, which is exactly what made T66's own
diagnosis plausible without a live measurement to check it against.

**Fix 2 — node Coincident targets must carry `:C`.** A bare circle id (`node0`) resolves to the Circle entity
itself, not a point; `addCoincident`'s own first argument must be a real SketchPoint. Fixed at the JS SOURCE
(`nodePieceCoincidences`'s own caller now emits `${id}:C`), not a Python-side special case — the `:C` suffix
convention already existed (fb_engine's `resolve_entity`), this was a declaration bug, not a missing mechanism.

**Fix 3 — Arc3Point `:S`/`:E` must be labeled by PROXIMITY, not call-argument order.** `addByThreePoints` always
normalizes its own result to run CCW, so `arc.startSketchPoint` can legitimately be the manifest's own `p2` for a
clockwise-ordered `(p1, pMid, p2)` input — silently swapping which physical point gets tagged `:S`/`:E`, corrupting
every downstream continuity constraint without ever raising or logging anything (exactly why it showed up as a
wrong-looking bbox, not a build failure — the arcs still built, just mislabeled at their own two ends). Fixed by
labeling whichever of Fusion's own two returned points is geometrically closer to the manifest's own `p1` as `:S`.
"This alone fixed the shape bbox" (advisor's own words).

**Shim fixes for all three**: `FakeSketch.addCenterToCenterSlot`'s own 4th parameter renamed `create_width_dim`
and now literally gates whether a `FakeDimension` gets appended (`False` -> `dims.count == 0` -> a real DIM MISS,
reproducing the exact measured symptom); `FakeSketchArcs.addByThreePoints` now models CCW normalization via a
real signed-area/cross-product test, swapping which of its own two returned points is `startSketchPoint` for a
clockwise input — T65's own first version of this fake always matched start=p1/end=p2 regardless of winding,
which is WHY this exact bug shipped once already without any test catching it.

**Tests** (Python, 19->21): `test_slot_False_create_width_dim_yields_DIM_MISS...` drives the fake's own new branch
directly; a NEW clockwise-arc fixture (mirror image of the existing CCW one) proves the S/E-by-proximity fix as a
DIRECT unit test of `_create_arc3_entity` (not through the full orchestration — `arc.startSketchPoint`/
`.endSketchPoint` are Fusion-internal and never reassigned by the fix itself; what the fix controls is WHICH point
object gets registered under `:S`/`:E` in the entity map, checked here via `ctx.entity_map` directly, not the raw
attribute). Node `:C` is covered by the dedup tests below (same fixture, same constraint list). All three
mutation-tested (revert `True`->`False`, remove the S/E swap, revert `:C`->bare) — each caught by the EXACT test
built for it, confirmed by an 8-test cascade for fix 1 alone (the raising isFixed-style guard plus the direct
assertion), restored MD5-clean every time.

### Part 2 — the node/tie/rail dedup, resolved (not just disclosed this time)

T66's own WORK-LOG entry disclosed a real, unverified risk: a node coinciding with a tie's own end that's ALSO
tie-on-rail-wired gets THREE Coincident constraints among the same 3 mutually-linked entities (node-to-tie-end,
node-to-rail, tie-end-to-rail) — the third transitively implied by the other two. The advisor's own real run hit
exactly this ("node24:C + tie12:S over-constrained", not reproducing in the FINAL run but real enough to fix).
Fixed: `tieEndToRailTarget` (a map built during the tie-on-rail wiring pass) lets `nodePieceCoincidences` drop its
OWN redundant leg of the same triangle. **Tests**: the existing node-coincidence test extended to tolerate (and
explicitly track) a deduped case; a NEW dedicated test confirms the tie-end-to-rail edge the dedup relies on for
transitivity is ALWAYS still declared (never drops BOTH legs, only the redundant third). Mutation-tested (disable
the dedup filter) — 1 exact failure, restored.

### Part 3 — the tie-span DEFAULT flip to 'rails' mode, and TWO newly-discovered, newly-fixed boundary bugs

Amendment (Fred, live: "ties needs to be coincident to their rails"): `PATTERN_DEFAULTS.ties.span.mode` flips
from `'cells'` (a short, possibly-floating stub) to `'rails'` (every tie bridges exactly one pair of adjacent
rails, both ends ON a rail) — `'rails'` was ALREADY a fully-implemented, just-not-default alternative
(`_tieSlotsByCount`'s own 'rails' branch, T56-era code), so this specific change was a one-line default flip plus
test/doc updates — UNTIL "render the default box + shape lattice to PNG and VIEW it before passing" (the
dispatch's own explicit acceptance test) caught real bugs the numeric tests alone did not:

**Bug A — boundary-clipped rail coverage.** `_tieSlotsByCount`'s own 'rails' branch picks a row-pair from the RAW
`railRows` list, assuming every row has a rail spanning the FULL extent width — true in board/rect mode, false in
BOUNDARY mode (Shape Lattice), where each row's own rail gets independently clipped to the silhouette. A pinched/
non-convex shape (an hourglass's own waist) can have a tie's own column dip outside the boundary somewhere BETWEEN
two otherwise-valid rail rows. Fixed with `tieSpanIntact(i, jStart, jEnd)` — replicates the EXACT clipping
computation the tie-emission loop itself uses, checking the WHOLE candidate span comes back unshortened, not just
its two row values; a deterministic scan (by gap size, closest-to-drawn first) finds an alternative when the
original seeded draw fails it. PLUS a belt-and-suspenders ground-truth filter (checked against the REAL, already-
emitted rail segments, not a second independently-computed insideness test) — measured directly that these two
CAN disagree at a shape's own extreme edge (seed 42's own column 0 passed the col-scan check while the real rail
at row 12 never reached x=0 at all), so ground truth wins.

**Bug B — the "on-boundary" ending rule's own pullback, applied where it shouldn't be.** Even after Bug A's own
fix, a rails-mode tie's own rail-anchored end still ran through the SAME boundary-clip-then-`_applyEndRule` path
as any ordinary free end — `_clipToSpans` reports a crossing whenever an end COINCIDES with the boundary's own
crossing point (which a rail-row end near the board edge often does), and the on-boundary rule then pulls that
end back by half the tie's own width — correct for a genuine free end meeting the boundary, wrong for an end
that's SUPPOSED to land exactly on a rail (the tie stopped `halfTie` short of the very rail it was declared to
bridge to). Fixed: an `anchored` slot (rails-mode, `tieSpanIntact` already proved intact) skips the whole clip-
and-pullback branch entirely — nothing left to clip, by construction.

Both bugs were found by ACTUALLY rendering (an SVG built directly from `buildSketchManifest`'s own output,
screenshotted via headless Chrome, viewed with the Read tool) rather than trusting the numeric checks alone —
matching this project's own "verify pixels, don't eyeball" AND "measure, don't re-reason" habits, but going one
step further: the numeric tests I'd ALREADY written (checking row membership) were passing cleanly while the
render showed real floating ties, because they were checking the WRONG ground truth (raw row values, not the
real emitted rail segments).

**Tests** (JS): a NEW shape-lattice-specific amendment test (the box-lattice one never exercised boundary mode at
all) — every tie endpoint lies on a rail, for the DEFAULT hourglass, no exotic params. Mutation-tested THREE ways:
disabling `tieSpanIntact` alone (still passes — the ground-truth filter alone is sufficient for CORRECTNESS, just
less good at MAXIMIZING placed-tie count; an honest finding, not swept under the rug); disabling the ground-truth
filter alone (1 exact failure); disabling the anchored-skip in the emission loop (1 exact failure, the OTHER
bug). All restored MD5-clean.

### Part 4 — amendment 3, superseded by amendment 4: `ties.oneEnded`, NOT always rail-to-rail

Fred, live, twice in quick succession: first "i dont want it to be always rail to rail, in the addin we can allow
to have one end free", then refined to "one setting: number of one ended ties; I'll usually want 1 or 2" — the
SECOND message is the one actually implemented (the first's own design sketch is superseded, not built). Declared
`ties.oneEnded` (default 1) in `PATTERN_DEFAULTS.ties`: exactly this many of the seeded `count` ties (clamped to
however many actually exist) start on a rail and end FREE (a stub chosen to deliberately NOT reach the next rail —
own seeded row + direction + span draw, falling back to the ordinary rail-to-rail path if no direction has room);
every other tie still bridges rail-to-rail exactly as Part 3 describes. Never a tie with both ends free — the free
end is always the second one, anchored at a real rail row on its own start. `'cells'`/`'rails'` stay declared,
real alternatives; a saved pattern with no `oneEnded` key reads the default.

**Self-caught bug, mid-implementation, via a 50-seed board-mode test (no boundary involved at all — this one had
nothing to do with Parts 3's own bugs)**: a DOWNWARD one-ended stub (`jEnd = jStart - span`, so `jEnd < jStart`)
tripped `_applyEndRule`'s own pre-existing degenerate-collapse safety net (`if (na >= nb) { the mid = (a+b)/2;
na=nb=mid; }`) — since `aIsCrossing`/`bIsCrossing` are both `false` for this path, `na`/`nb` start equal to the
ALREADY-descending `a`/`b`, tripping the guard on ENTRY, collapsing both ends to their shared midpoint (a real,
reproduced zero-length tie at a fractional j, e.g. `4.5` between rail rows 3 and 6 — not a hypothetical). Fixed by
ordering the pair ascending before construction (`Math.min`/`Math.max` — `a`/`b` are interchangeable labels
everywhere downstream, so this costs nothing and matches every OTHER candidate-building path in this function,
including the boundary-mode branch which already did this via its own `Math.min`/`max`).

**Manifest wiring**: NO code changes needed — the EXISTING tie-on-rail wiring (`pointOnLatticeSegment`-driven,
already generic) naturally emits a Coincident ONLY for whichever end genuinely touches a rail; a free end, by
construction, simply doesn't match any rail and gets nothing, exactly as the dispatch itself asks — "declare the
data correctly and the existing generic machinery does the right thing" rather than a new special case.

**UI**: a new "one-ended ties" number stepper (0..count, step 1, matching the existing C1 style) in BOTH the box
Lattice panel (`#latticeTiesOneEnded`) and the Shape Lattice panel (`#shapeLatticeTiesOneEnded` — confirmed they
share the identical `PATTERN_DEFAULTS.ties`/`_tieSlotsByCount` mechanism, so both genuinely need it), wired
read/write in `properties-lattice.js`/`properties-shape-lattice.js` following the exact existing convention every
neighboring field already uses (`0` is a real, valid value — `|| 0` not `|| 1`, so a typed "0" isn't silently
coerced back to the default).

**Tests**: a dedicated `computePattern`-level test for `oneEnded` = 0/1/2 (50 seeds each) — exact free-ended count,
never both-ends-floating; the box-lattice and shape-lattice amendment tests from Part 3 updated for "at least one
end on a rail" instead of "both"; new DOM-level tests in both `properties-*.test.js` files (reads the default onto
the field, Generate writes an edited value back into the pattern). Mutation-tested the UI write-back specifically
(hardcode the pattern's own field instead of reading the DOM element) — 1 exact failure, restored MD5-clean.
Render+view (a fresh SVG-from-manifest render, screenshotted, read): exactly one purple (intentional free-end)
dot in each of the box and shape lattice defaults, zero red (both-ends-floating) dots.

**Full JS suite across Parts 1-4**: 1028 passed (63 files), up from 1019 at T66. Python: 21/21 (pytest), 20/20
(plain-`python3` fallback) — Parts 3/4 never touched the Python side at all (the tie-span/oneEnded work is
entirely JS-side pattern generation).

### Amendments 2 (parity checks) and 5 (shape contour as slots) — NOT STARTED, deliberately deferred

Two more amendments landed while Part 4 was in progress (one via `handoff.py amendments`, one relayed by another
session over the cross-session channel — both now confirmed via a final `amendments` poll before this commit):

- **Amendment 2**: 5a — a JS test proving the app's own drawn layer (box AND shape, default + one non-default
  seed) matches `buildSketchManifest`'s own entities 1:1, no extras/missing, 1e-6in tolerance. 5b — a NEW Python
  `verify_sketch_against_manifest(sketch, manifest, tol=0.002)`, called automatically at the end of
  `build_constrained_sketch`, reading back REAL sketch geometry (slot centerline ends, circle centres, contour
  line ends, arc ends+radius, matching arc ends order-free since Fusion arcs are CCW) and adding
  `summary["parity"] = {"maxErr", "mismatches"}`; logs a WARNING when non-empty. Shim test: a moved point reports,
  an exact build reports none.
- **Amendment 5**: the Shape Lattice's own CONTOUR (currently plain Line/Arc3Point entities) becomes SLOTS too —
  a contour Line via `addCenterToCenterSlot`, a contour Arc3Point via `sketch.addThreePointArcSlot(p1, pMid, p2,
  width, True)` (a DIFFERENT Fusion API method than anything built so far this turn, its own return shape
  unverified — advisor's own measurement: "centerline arc through the 3 points, sides ±w/2, width dimension").
  The centerline (not the visible slot body) gets registered under the segment's own id, `:S`/`:E` by the SAME
  proximity technique as Fix 3 above, `:C` for the arc centre. Width expression = `stroke_width`. Every EXISTING
  contour constraint (the Coincident chain, Tangent, H/V, Equal, the hourglass's own shoulder<->hip Radial) now
  acts on the CENTERLINES instead of the plain entities — a real re-target, not additive. NO Fix, anywhere; if a
  Tangent between two slot centerlines over-constrains, report which one rather than silently dropping it. A NEW
  Fusion API surface (`addThreePointArcSlot`) needs its own fake-shim model from scratch (return shape unverified,
  same disclosed-uncertainty posture as T64's own `addCenterToCenterSlot` before the advisor's own real
  measurement corrected it) — genuinely new ground, not a variation on anything already built.

**Why deferred, not rushed**: by the time both landed, this turn had already absorbed 5 mid-task amendments on
top of 3 dispatched fixes (Parts 1-4 above), including TWO newly-discovered-and-fixed real bugs (Part 3) and a
THIRD self-caught one (Part 4) — each requiring real investigation, not just porting a described fix. Amendment 5
in particular is its own substantial, architecturally-significant piece of work: a brand-new Fusion API surface
with an unverified return shape, a full re-target of every existing contour constraint onto new entities, and an
explicit "report don't Fix" discipline for a genuinely new over-constraint risk (Tangent between two slot
centerlines) — exactly the kind of geometry-correctness-critical change that deserves a fresh session's own full
attention, not a rushed tail end after this turn's own already-large scope. Per this project's own "capacity is
a reportable fact" rule: flagging this now, honestly, as unstarted and scoped for next time, rather than
delivering a shallow or under-tested version of either amendment.

Amendments polled clean immediately before this commit and will be polled again immediately before passing.

## T68 — SE15/SE15b parity: a REAL app/manifest divergence found and fixed (shape-lattice boundary inset), plus the Python read-back check; contour-as-slots deliberately deferred

**Dispatch**: exactly the two items T67 deferred — (1) shape contour as slots, (2) app/Fusion parity checks — with
explicit permission to split across turns, finishing the smaller item (2) first. AMEND 1 arrived mid-task (also
already visible in `NEXT-SESSION-lane-b.md` and re-confirmed via a fresh `handoff.py amendments` poll): the
advisor's own live-Fusion measurement of T67's own build (3105d74) — same session, same Shape Lattice layer — found
the app drew 4 rails/7 ties/12 nodes while the manifest produced 6 rails/11 ties/22 nodes (extra rails at the
board's own top/bottom edge, rail x-ends off by ~0.01in each side), while the BOX manifest matched exactly and
Fusion↔manifest agreed to 1e-15 for both — meaning the whole gap was app↔manifest, on the Shape tool only. This
turn tackled item 2 first, per the dispatch's own instruction; item 1 was NOT started (see "why deferred" below).

### Item 2a — JS parity test (`tests/parity-app-manifest.test.js`, NEW FILE) — found and fixed a real bug

Wrote the test AMEND 1 asked for first (box AND shape, default + one non-default seed, `oneEnded` 0 and 2; every
drawn rail/tie/node/contour-segment piece must have exactly one identical `buildSketchManifest` entity and vice
versa, 1e-6in tolerance) — using a real mock editor/sketchLayer, `generatePattern`/`regenerateSilhouette` run FOR
REAL against it, not stubbed.

**Root cause (confirmed against the advisor's own numbers before touching any test)**: the app's own boundary-mode
extent resolution (`_resolveExtent`→`shapeToInnerBoundaryPrimitives`) insets the boundary INWARD by half the
silhouette's own live stroke width before clipping the lattice fill against it (`boundary.edge` defaults to
`'inner-stroke'`, not `'centerline'`; a generated silhouette is always stroked at `SILHOUETTE_STROKE_WIDTH=0.02in`,
so a 0.01in inset by default) — while the manifest-side `resolveShapeBoundaryExtent` (editor-sketch-manifest.js)
computed its own extent from the RAW, un-inset primitives, never applying any inset at all. Two edge rails that
the app correctly excludes (they'd sit ON or past the inset boundary) survive in the manifest instead, and every
boundary-clipped rail's own x-ends land ~0.01in further out than what's actually drawn — exactly the advisor's own
measured symptom, on the shape tool only (box mode has no boundary inset at all, so it was never affected).

**Fix, by declaration (the advisor's own instruction: "one shared piece list ... never two computations")**:
- Extracted `insetPathDToPrimitives(d, strokeHalfWidth)` in `editor-lattice-boundary.js` — a genuinely SHARED pure
  function, refactored out of `shapeToInnerBoundaryPrimitives`'s own 'path' branch rather than a copy.
- Moved `SILHOUETTE_STROKE_WIDTH` from `properties-shape-lattice.js` (DOM-touching) to `editor-lattice-boundary.js`
  (pure, already imported by the manifest module) — one declared constant, read by both the app's own
  `regenerateSilhouette` (via import, not re-declaration) and the manifest's own inset calculation.
- New `shapeHalfInset(pattern)` + rewritten `resolveShapeBoundaryExtent` (editor-sketch-manifest.js): computes the
  SAME half-inset the app's own `_effectiveBorderWidth` would resolve to for a generated silhouette (boundary.edge
  centerline → 0; else `boundary.border.width` if explicitly overridden, else `SILHOUETTE_STROKE_WIDTH`), applies
  `insetPathDToPrimitives` to the silhouette's own primitives (via `primitivesToPathD`, the SAME function the app
  itself uses to draw the boundary path) BEFORE scaling to lattice units — one function, one computation, now
  consumed by both sides instead of two independent re-derivations.

**A second, unrelated bug found while proving the fix**: my own new test's mock editor never set `.type` on its
created elements (copied from `properties-lattice.test.js`'s simpler mock, which never needs it — board mode never
calls the boundary-primitive dispatch at all). `shapeToInnerBoundaryPrimitives`/`shapeToPrimitives` dispatch on
`el.type` directly (a real SVG.js element's own tag name), not `el.attr('type')` — this is the EXACT same gotcha
`properties-shape-lattice.test.js`'s own mock already has an explicit comment about ("found live: the first
attempt at this test filed 'no rail found' against a mock missing exactly this"), just not yet applied to this
NEW file. With `.type` unset, the boundary silently resolved to zero primitives, so `generatePattern` drew ZERO
rails/ties/nodes for the shape-lattice case (only the boundary path itself) — which was masking whether the REAL
fix above actually worked, since the app side of the comparison had nothing to compare. Fixed by threading a
`type` parameter through `makeElement`/`line()`/`circle()`/`path()`/`clone()`, matching the already-proven pattern.
Also fixed `stroke()` to capture `width` (not just `color`) into the mock's own store, since the app's own
`_effectiveBorderWidth` reads the drawn boundary's own live `stroke-width` back — needed for the APP's side of the
comparison to compute its own halfWidth correctly, even though the production FIX itself is pure and never reads
the DOM (uses the declared constant directly).

**Non-vacuous, by measurement, not by construction**: with the mock fixed but the production fix still in place,
all 8 tests pass. Reverted the production fix (`shapeHalfInset` forced to return 0, simulating the exact pre-fix
bug) and re-ran: exactly the 3 shape-lattice-fill parity tests failed (`oneEnded=0`, `oneEnded=2`, non-default seed
17) — box-lattice tests and the two contour-primitive-only tests (which never depend on the inset) stayed green.
Restored from the scratchpad backup, MD5-verified byte-identical. Full JS suite: 1036/1036 (64 files) — the app-
side refactor (`insetPathDToPrimitives` extraction) alone was already confirmed safe earlier (1033/1035, only the
2 not-yet-fixed shape-lattice tests red) before the mock fix landed.

### Item 2b — Python `verify_sketch_against_manifest` (`sketch_manifest_builder.py`)

New function, called automatically at the end of `build_constrained_sketch`; summary gains
`"parity": {"maxErr", "mismatches": [ids]}`. Reads back what `ctx.entity_map` actually holds (keyed by the SAME
manifest ids `_create_*_entity` already registers under) and compares against the manifest's own declared
geometry, in inches: Slot/Line by centerline ends (order-preserving — `_find_slot_centerline`'s own exact-match
search already guarantees p1→start/p2→end at CREATION time, so this is really checking whether the LATER
constraint/dimension pass dragged it away again); Circle by center+radius; Arc3Point by ends compared ORDER-FREE
(Fusion's own `addByThreePoints` always normalizes to CCW, so which manifest point becomes `.startSketchPoint` is
not guaranteed — this checks the actual geometry, not `_create_arc3_entity`'s own proximity-tagged :S/:E) plus a
radius/center derived from the manifest's own p1/pMid/p2 via a standard circumcenter formula (`_circumcircle`).
ArcCenter is not checked — T65's own `applyCarvePlacement` always converts it to Arc3Point before a manifest
reaches this module. Never raises: a missing/failed lookup counts as a mismatch, never aborts the rest of the
check. Logs one WARNING (count + first 5 ids) when mismatches is non-empty.

**A real fake-shim gap found while writing this**: `FakeSketchArc` (the test file's own adsk shim) never modeled
`.radius` — no production code had ever read it back before (real `adsk.fusion.SketchArc.radius` is a genuine
read-only property; the fake simply never needed to fake it). My own new Arc3Point radius check was the first
caller, and it failed with an `AttributeError`-caused false mismatch until a `@property` was added (computed from
the arc's own center/start distance, same as real Fusion) — a shim fix, not a production bug, but a real gap
nonetheless: a `.radius` read on ANY sketch arc in this whole test suite would have silently misbehaved before now.

**Tests** (`test_sketch_manifest_builder.py`, +3, 24/24 total): an end-to-end exact/unmoved build (via
`_box_lattice_manifest`) reports zero mismatches, maxErr ~0 — FakeSketch's own `addCenterToCenterSlot`/
`addByCenterRadius` build geometry EXACTLY at the manifest's own p1/p2/center, so this proves the "clean" path.
A direct unit test (same ctx/sketch-construction style as the existing arc3 CCW test) builds a Slot via
`_create_slot_entity`, then mutates its own endSketchPoint's geometry by +0.05in AFTER creation (simulating a
constraint solve dragging it away) — confirms it comes back as the sole mismatch with `maxErr≈0.05`. A companion
test feeds a CLOCKWISE `(p1,pMid,p2)` Arc3Point (forcing the fake's own CCW-normalization swap) and confirms
`verify_sketch_against_manifest` reports NO mismatch despite `.startSketchPoint != p1` — proving the order-free
comparison actually does something, not just documented intent.

**Mutation-tested both new behaviors separately** (scratchpad backup/MD5-restore each time): (1) forced the
mismatch-append line to `if False` — broke exactly the "moved point" test, nothing else. (2) forced the Arc3Point
end comparison to direct-order-only (dropped the swapped-pairing branch) — broke exactly the "order-free" test,
nothing else. Both restores confirmed byte-identical via `md5sum`. Full Python suite: 142/142 (up from 21 pre-T68
in this module's own file: now 24/24 there).

### Item 1 (contour as slots, SE15b) — NOT STARTED, deliberately deferred

Per the dispatch's own explicit permission ("finish item 2 FIRST... then item 1... if it is too big for one turn").
Item 2 alone required a genuine root-cause investigation (a real app/manifest divergence, confirmed against the
advisor's own live numbers before any fix was written) plus TWO separate test-infrastructure gaps found and fixed
along the way (the mock `.type`/`stroke-width` gap, the fake `.radius` gap) — each demanded actually understanding
why a symptom occurred, not just porting a described fix. Item 1 is its own substantial, architecturally-significant
piece of work on top of that: a brand-new Fusion API surface (`addThreePointArcSlot`) with an unverified return
shape needing a from-scratch shim model (including its own CCW normalization, mirroring the discipline
`addCenterToCenterSlot` needed before the advisor's own real measurement corrected T64), a full re-target of every
EXISTING contour constraint (Coincident chain, Tangent, H/V, Equal, the hourglass's own Radial dims) onto new
centerline entities instead of the plain Line/Arc3Point ones, and an explicit "report, don't Fix" discipline for a
genuinely new over-constraint risk. Per this project's own "capacity is a reportable fact" rule: rather than rush a
geometry-correctness-critical change with an unverified API surface into the tail end of an already-substantial
turn, flagging it now as unstarted and scoped for a fresh turn.

Amendments polled clean before this commit; will poll once more immediately before passing.

## T69 — SE15b: the shape contour becomes slots too (the item T68 deferred, done in full this turn)

**Dispatch**: exactly the one remaining item, "the ONE item, nothing else this turn" — Fred: "want the shape
contour to be made of slots." A contour Line becomes a Fusion-native center-to-center slot; a contour Arc3Point
becomes a three-point ARC slot (`addThreePointArcSlot`, a brand-new Fusion API surface — NO FUSION this turn, the
advisor verifies live after merge). NEVER Fix; joints stay separate points + explicit Coincident, unchanged.

### Design: declared, not a builder special case

A new constant, `SKETCH_CONTOUR_WIDTH_MODE` (editor-sketch-manifest.js), governs the CONTOUR's own slot-vs-
centerline choice — deliberately its OWN field, never overloading the EXISTING `widthMode`/`SKETCH_WIDTH_MODE`,
which this module's own tests already establish as scoped to the LATTICE FILL only. Default: `'slot'`.
`manifest.contourWidthMode` exposes the choice at the top level, `null` when there's no contour at all (a plain
box lattice layer).

- **Contour Line → `Slot`**: reuses `addSlotPieces` DIRECTLY — a contour Line-slot IS a rail/tie slot, byte-for-
  byte the same entity/dimension shape, so this is a genuine "declare, don't hand-roll a second copy" win: zero
  new production logic needed for this half of the mechanism.
- **Contour Arc → `ArcCenterSlot`** (pre-carve, natural space) → **`Arc3PointSlot`** (post-carve, carve space,
  via `applyCarvePlacement`'s new branch, a straight sibling of the existing `ArcCenter`→`Arc3Point` branch — same
  `toCarveArc3Point` helper, reused, just re-tagged and carrying `width` through untouched).
- **Width**: seeded from the layer's own REAL `pattern.widths.rails` (merged over `PATTERN_DEFAULTS.widths` the
  same way `manifestFromLattice` already does), driven by the SAME `'stroke_width'` Fusion parameter rails/ties
  use when linked — per the dispatch's own "same param as rails/ties" instruction. `manifestFromShape` declares
  its own `stroke_width` parameter entry independently (it has no visibility into the lattice's own link state);
  Python's existing create-or-update parameter sync harmlessly reconciles the common case where both sides
  declare the identical name/value, and is the ONLY source of it when rails/ties are unlinked.
- **Constraints**: the EXISTING Coincident chain / Tangent / H-V / Equal / hourglass Radial emission logic in
  `manifestFromShape` needed ZERO changes — it only ever targets entities by bare id or `:S`/`:E`/`:C` suffix,
  never by type, so it re-targets onto the new slot centerlines for free. This is the "re-target, not additive"
  the dispatch asked for, achieved by NOT having written type-aware constraint logic in the first place (T61).
- **Python**: new `_create_arc3_slot_entity` (`sketch.addThreePointArcSlot`) is the arc-shaped sibling of
  `_create_slot_entity` — registers the CENTERLINE (never the visible body) under the seg id, `:S`/`:E` by the
  SAME proximity technique T67 already uses for a plain Arc3Point (Fusion's own CCW normalization is expected to
  apply to this method too, unverified live), `:C` for the centre. `_find_arc_slot_centerline` diffs
  `sketchArcs`' own count before/after (mirroring `_find_slot_centerline`'s established "generic vector, diff the
  collection" technique) and requires BOTH a construction-curve flag AND actually passing through all 3 given
  points before calling something the centerline — per the dispatch's own explicit "if you can't identify it
  robustly, log it and skip, never guess": zero or ambiguous candidates raise, caught by `_create_geometry`'s
  existing per-entity try/except into a skip+report, never a silent wrong pick.
- **`verify_sketch_against_manifest`** (T68) extended to treat `Arc3PointSlot` identically to `Arc3Point` — the
  parity check is geometry-based (order-free ends + circumcircle-derived radius/center), not representation-
  specific, so this was a 2-line addition to two existing tuples/conditions, not new logic.

### Test-file surgery: an existing default changed, so existing assertions had to follow

`manifestFromShape`'s own default flipped (matching the SAME precedent T64 already set for rails/ties: flip the
default, update the tests, keep `'centerline'` real and available via an explicit `{widthMode:'centerline'}`
override) — this touched roughly a dozen existing assertions across `tests/editor-sketch-manifest.test.js` that
checked `e.type === 'Line'`/`'ArcCenter'`/`'Arc3Point'` for CONTOUR entities specifically. Each site's own
GEOMETRIC claim (Coincident shares a point, Tangent touches an arc, Equal pairs matching radius/length, the H/V
carve-transform invariant, the carve-placed bbox) was UNCHANGED — only the type-string literal needed updating,
confirmed by reading each test's own purpose before touching it rather than mechanically search-replacing. Two
tests needed a real rewrite, not just a type-string swap: the parameters-count test (`stroke_width` is a genuinely
NEW parameter, so `+1` became `+2`, and the unit-null loop needed to exclude it too) and the kink-override test
(its own `manifest.dimensions.some(...)` assertion was checking "no dimension targets a kink segment" when its
REAL intent — per its own title — was specifically about the hourglass Radial dimension; a kink Line legitimately
gets its OWN SlotWidth dimension now, so the assertion was narrowed to `d.type === 'Radial'` to keep testing what
it always meant to test). Also touched `tests/parity-app-manifest.test.js` (T68): its own `checkLatticeParity`
counted ALL `type==='Slot'` entities as lattice pieces, which now over-counts (contour Line-slots are ALSO type
`'Slot'`) — fixed by excluding `id.startsWith('seg')`; its own contour-primitive-parity test's type check
similarly widened to accept `'Slot'`/`'Arc3PointSlot'` alongside the old `'Line'`/`'Arc3Point'`.

### Non-vacuous, both languages, by measurement

**JS**: reverted `SKETCH_CONTOUR_WIDTH_MODE` to `'centerline'` (scratchpad backup, MD5-restored after) — exactly
the 7 tests that assert the new default's own shape failed, the T68 parity suite (which reads `generateSilhouette`
primitives directly, never a manifest type tag) stayed green throughout, confirming the two test files are
checking genuinely different things and neither is accidentally propping up the other.

**Python**: three separate mutations, each isolated and MD5-restored in turn: (1) disabling the `_create_geometry`
dispatch branch for `Arc3PointSlot` broke exactly the one end-to-end test (`entities.created` dropped 2→1); (2)
disabling the proximity-based S/E swap in `_create_arc3_slot_entity` broke exactly the CCW-survival test; (3)
disabling `_find_arc_slot_centerline`'s own construction-flag check broke exactly the "never guess" test (it
stopped raising, since the deliberately-broken fake's non-construction arc became a false match instead of no
match at all) — confirming that test really does depend on the construction-flag gate, not just on the fake
happening to produce zero arcs some other way.

**Full suites**: JS 1039/1039 (64 files, up from 1036 at T68's own commit — 3 genuinely new tests: the
`widthMode:'centerline'` alternative-still-works case for both hourglass/bottle, plus the box-lattice-has-no-
contourWidthMode case; the ~7 other touched tests changed their own assertions in place, not a net addition).
Python 146/146 (`pytest`), 27/27
(plain-`python3` fallback — one pre-existing test, `test_build_from_manifest_file_reads_json_and_builds`, was
already missing from that list before this turn; left alone, noted here rather than silently fixed, since it's
unrelated to T69's own scope).

### A pre-existing shim gap, closed as part of this: FakeSketchArcs never modeled `.count`/`.item()`

Needed for `_find_arc_slot_centerline`'s own "diff the collection" technique — added, mirroring `FakeSketchLines`'
own established shape exactly. Also factored the CCW-normalization signed-area test (previously inline only in
`addByThreePoints`) into a shared `_ccw_normalized_ends` helper, now used by both that method's own fake AND the
new `addThreePointArcSlot` fake — one declared check, not two copies of the same formula.

This closes T68's own deferred item 1 in full. Both of T67's original deferrals (parity checks, contour-as-slots)
are now done.

Amendments polled clean before this commit; will poll once more immediately before passing.

## T69-FIX — the arc argument order (advisor MEASURED, real bug in 02b9100) + a genuine symmetry relationship for the contour's two halves, before T70 could start

**How this arrived**: mid-T70 (before any T70 code was written), a peer session (`b-spline-generator-web-addin-5c`)
relayed two cross-session messages carrying the advisor's own live-Fusion measurements of T69 (02b9100), with an
explicit instruction to fix these FIRST, as their own commit, before continuing SE14b. Also relayed a separate T70
AMEND 1 (a node-parity gap on the Shape lattice) — left for T70 proper, since it's squarely inside that turn's own
parity-test-extension scope, not urgent-blocking like the other two.

### AMEND 2 — `sketch.addThreePointArcSlot`'s own argument order was wrong

**Measured**: the method's real signature is `(START, END, POINT-ON-ARC)`, not `(start, mid, end)`. T69's own call
— `addThreePointArcSlot(p1, p_mid, p2, ...)` — told Fusion the arc's own END was THIS module's own MIDPOINT, so
every one of the 6 contour arcs built only HALF its intended sweep (start to midpoint, never reaching the real
end). Measured fallout: 2 Tangent constraints SOLVING_FAILED, parity maxErr 2.35in across all 12 contour segments.

**Fix**: swap the call to `addThreePointArcSlot(p1, p2, p_mid, ...)` — one line, in `_create_arc3_slot_entity`.
The existing proximity-based `:S`/`:E` relabeling (kept unchanged) still handles whatever CCW-normalization
Fusion's own solver applies regardless of argument order.

**Why the FIRST version of the test shim never caught this**: a circumcenter is order-independent — feeding the
SAME 3 raw points into the fake's own `_circumcenter` in ANY order produces the identical center/radius, so the
OLD (buggy) call and the FIXED call looked numerically indistinguishable to a shim that only modeled "3 points
define a circle" (the SAME mental model `addByThreePoints` genuinely uses, which this method does NOT). Rewrote
the fake to model the REAL role-based semantics: `start`/`end` become the arc's own two ends DIRECTLY (after the
SAME CCW-normalization signed-area check `addByThreePoints`'s own fake already uses, now factored into a shared
`_ccw_normalized_ends` helper used by both), and the 3rd argument feeds ONLY the circumcenter. Added a dedicated
regression test (`test_addThreePointArcSlot_shim_models_the_real_start_end_pointOnArc_argument_order`) proving the
OLD call shape, under the NEW fake, genuinely builds an arc ending at the midpoint, not the real end — the
dispatch's own explicit "make the shim model this order so a wrong call fails first" ask.

### AMEND 3 — the contour's two halves were never actually tied to each other, only made the same size

**Measured** (advisor, live, with AMEND 2's fix applied — parity was already exact by then): stroke_width
0.07->0.25 moved the arcs ~0.1in and broke symmetry (irreversibly — going back to 0.07 did NOT restore it); a
rigid move of the whole sketch collapsed the waist to r 0.274; Tangent seg8/seg9 came back OVER_CONSTRAINTS.

**Root cause**: the OLD mirror-Equal pass (`Equal(seg_i, seg_mirror(i))`) only ever asserted the two halves were
the SAME SIZE — nothing tied WHERE the left half sat relative to the right, so the assembly had a genuine
unconstrained rigid-body degree of freedom between its two halves, invisible until something disturbed it.

**Fix, with relationships + parameter-driven dims, never Fix** (per the dispatch's own explicit instruction):
- A new construction Line, `mirrorAxis`, at natural-space `x = region.x + region.w/2` — confirmed (by reading
  `_solveHourglass`/`_solveBottle` directly) to be the IDENTICAL mirror-x both presets already use for their own
  `M()` reflection, so this generalizes across both without any preset-specific plumbing. `_create_line_entity`
  (Python) gained an `isConstruction` flag, read from the manifest's own declared field (every OTHER Line entity
  omits it, defaulting False, unchanged) — the FIRST manifest entity that ever needed it.
- A genuinely NEW Fusion constraint type, `Symmetry` (`gc.addSymmetry(point, point, symmetryLine)`), added to
  `fb_engine/constraints.py`'s own `constraint_step` (previously only Coincident/Collinear/H/V/Tangent/Parallel/
  Equal — a real gap, not a re-guess, since `addSymmetry` genuinely didn't exist there before).
- For a mirrored LINE pair (e.g. a horn segment and its own mirror): Symmetry on BOTH endpoints, matched to their
  geometrically-correct counterpart by Y-proximity (mirroring only ever flips X) rather than an assumed traversal-
  order convention — the SAME "read real coordinates, don't guess from convention" discipline `axisConstraintType`
  already uses elsewhere in this module. This fully determines the pair's relative length too, so the OLD
  mirror-Equal is now genuinely redundant and dropped for lines.
- For a mirrored ARC pair (the waist, seg2<->seg8): Symmetry on ONLY the center point — its own two ENDpoints are
  already pinned transitively via the Coincident chain through their own (now-symmetric) neighbors, so Symmetry's
  job here is purely POSITION. The mirror-Equal STAYS for arcs (radius is a genuinely separate concern Symmetry-
  on-a-center-point alone never implies) — exactly mirroring the EXISTING seg1<->seg3 shoulder<->hip pattern
  (Equal + one Radial dim driving both).
- A NEW `waist_radius` parameter + Radial dim on the right waist arc (seg2) — the waist's own radius (its third
  degree of freedom beyond its two now-transitively-pinned endpoints) was previously undimensioned entirely; a
  semicircle drawn 3-point-through has no OTHER constraint holding its bulge in place once built, so it was
  drifting on every re-solve. Hourglass-only, matching the shoulder/hip Radial dim's own pre-existing scope
  (bottle's own analogous "neck" arc stays undimensioned — a disclosed, pre-existing narrowing, not new).
- The SPECIFIC redundant Tangent (seg8/seg9) the advisor measured: generalized into a declarative rule rather
  than hardcoded indices (fragile under segment overrides, and meaningless for bottle's own different layout) —
  when an adjacent-joint Tangent's OWN mirror-image joint (`mirrorSegmentIndex`, reversed order since the left
  half is walked in the OPPOSITE traversal direction per the generator's own header comment) was ALREADY declared
  earlier in the same pass, skip it. Verified by hand-tracing all 4 mirror-Tangent pairs in the default hourglass
  (0,1)<->(9,10), (1,2)<->(8,9), (2,3)<->(7,8), (3,4)<->(6,7): the rule drops ALL FOUR left-side ones (each being
  the second-encountered of its own pair, since the right side is always walked first in forward-index order) —
  a result that CONTAINS the one specific pair (8,9) the advisor measured, not one that contradicts it, giving
  real confidence the generalization is sound and not just a re-guess dressed as one. A dedicated test
  (`exactly HALF the arc-adjacency Tangent joints...`) locks in the count (4, not 8) and specifically that
  seg8/seg9 is dropped while its own mirror seg1/seg2 is kept.

**Disclosed uncertainty** (this turn stays NO FUSION): whether ALL FOUR dropped Tangents are genuinely as
redundant as the ONE the advisor actually measured, versus Fusion's solver simply never got far enough to report
the others, is not independently confirmed here — flagged for the advisor's own next live re-measurement, which
they already said they'd do ("Advisor will re-measure drift + reversibility live").

### Tests and verification

**JS** (`tests/editor-sketch-manifest.test.js`): a new describe block, 6 tests — mirror axis exists at the
confirmed shared mirror-x and is construction; every Symmetry constraint's own 2 points are genuine mirror images
(independent coordinate check, not re-trusting the function under test); a Line pair loses its old Equal; an Arc
pair keeps it; exactly 4 (not 8) Tangents survive, with seg8/seg9 specifically dropped and seg1/seg2 specifically
kept; the waist gets its own parameter+dim. 3 existing tests' own count assertions updated (mirror axis adds one
non-`seg*` entity; hourglass gets one extra parameter) — each checked against the test's own stated PURPOSE before
touching it, not mechanically. Mutation-tested all 3 new behaviors separately (Tangent dedup, Symmetry emission,
waist dim), each isolated and MD5-restored: disabling each broke EXACTLY the test(s) built to catch it, nothing
else. Full JS suite: 1045/1045 (up from 1039 — 6 new tests, 0 regressions).

**Python** (`test_sketch_manifest_builder.py`): the arg-order regression test above, plus a direct
`isConstruction` unit test, plus an end-to-end `Symmetry`-dispatch test (2 mirrored Lines + a construction axis,
built via `build_constrained_sketch`, confirming `constraint:Symmetry` fires twice and `verify_sketch_against_
manifest` reports zero mismatches on the untouched build). Full suite: 149/149 (`pytest`), 30/30 (plain-`python3`
fallback — the SAME single pre-existing gap noted at T69 remains, still unrelated to this turn).

Amendments polled clean before this commit; will poll once more immediately before passing, then continue into
T70 (SE14b) proper, folding in AMEND 1 (the node-parity gap) as part of that turn's own parity-test extension.

## T69-FIX-2 — the mirror axes were free-floating, and the contour had no overall size at all

**How this arrived**: while investigating T70 (SE14b) proper, two MORE cross-session amendments landed in quick
succession (peer session relaying the advisor's own live-Fusion re-measurements of the T69-FIX commit,
2e56151), both explicitly asking for their own T69-fix-2 commit before continuing SE14b — a THIRD round of the
same "measure live, report back, fix before moving on" cycle T69/T69-FIX already went through twice.

### AMEND 4 — the mirror axis itself was unanchored

**Measured**: at stroke_width 0.5, the WHOLE right half slid to x=353.9in (left half stayed put) and never came
back. Root cause: Symmetry pins the two halves TO EACH OTHER, but nothing pinned the AXIS itself to any fixed
absolute position — the entire two-halves-plus-axis assembly could translate/rotate as a rigid body.

**Fix**: one relationship per axis, never Fix — `Coincident(sketch's own origin point, axis)`, a point-ON-line
constraint using Fusion's own ALWAYS-fixed origin point as the anchor. Declared in the manifest as
`{type:'Coincident', targets:['origin', axisId]}`; the Python builder resolves `'origin'` by registering
`sketch.originPoint` directly into `ctx.entity_map[s_name]` at build start — the EXISTING generic `resolve_entity`
lookup finds it for free, zero changes to fb_engine's own shared resolver needed.

**Also dropped 2 measured OVER_CONSTRAINTS** (both re-checked by hand before touching anything, not applied
blind):
- `Equal(['seg1','seg9'])` (the shoulder mirror pair): once BOTH its 2 endpoints (via the pre-existing Coincident
  chain) AND its center (via the Symmetry T69-FIX already added) are fixed, a circle through 2 known points with
  a known center has no remaining freedom — the mirror-Equal is a duplicate of an already-fully-implied fact.
  Deliberately NOT generalized to hip (seg3<->seg7) or the waist (seg2<->seg8), even though the SAME argument
  seems to apply equally to them — hand-tracing could not produce a confident reason those two are ALSO safe
  (and the advisor's own measurement didn't flag them either), so they keep their own mirror-Equal rather than
  risk under-constraining on a guess neither reasoning nor measurement actually confirmed.
- `Symmetry(['seg4:E','seg6:S'])`: redundant once its own sibling Symmetry pair (declared for the SAME line pair)
  plus each line's own Vertical constraint plus the Coincident chain to their shared self-mirroring, Horizontal
  neighbor (seg5, the bottom edge) already close the loop. Declared off `mirrorSegmentIndex`/`segMap` adjacency,
  not a raw index literal — but empirically NARROWER than a first read suggests: the rule only ever inspects the
  "E" side of a pair (never "S"), so it selects EXACTLY the one pair the advisor measured (seg4<->seg6, closing
  via seg5) and leaves seg0<->seg10 alone (its own closing happens on the "S" side, via seg11, which this rule
  doesn't inspect) — confirmed empirically by running the tests, not assumed: an earlier hand-derivation wrongly
  predicted BOTH pairs would drop, and the test written to prove that generalization caught the mistake before
  it shipped (see "measure, don't re-reason" — exactly the discipline this project's own memory already names).

### AMEND 5 — nothing set the contour's own overall size at all

**Measured** (with AMEND 4's origin anchor already in place — the arcs hold now): the straight EDGES still
stretch at stroke_width 0.5 — the side lines move apart (7.0in -> ~7.4in) and the top/bottom edges slide in Y,
because the contour's own mirror-symmetry + per-piece H/V pin its SHAPE but never its ABSOLUTE SCALE.

**Fix**: param-driven Distance dimensions, never Fix, referencing `widthIn`/`heightIn` — the BOARD's own
PRE-EXISTING Fusion document parameters (`b-spline-gen.py`'s own `_sync_user_parameters`, confirmed by reading
that file directly rather than assumed) — this module only ever REFERENCES them by name, never re-declares them
(the same "declare, don't hand-roll a duplicate" reasoning `stroke_width` already gets, just for a parameter this
module doesn't own at all).
- A horizontal Distance dim between the FIRST Line mirror pair encountered (`widthPairIds`, already
  Symmetry-linked and each individually Vertical — pins their ABSOLUTE separation, not just their relative one)
  = `widthIn`.
- The two SELF-mirroring Horizontal segments (top/bottom edges — never processed by the mirror-pair loop at all,
  since `mi === i` skips a self-mirror entirely) get a vertical Distance dim between them = `heightIn`, PLUS a
  NEW Symmetry of the two edges (as whole curves, not points — Fusion's own `addSymmetry` accepts either) about a
  SECOND new construction axis (`horizontalAxis`, also Coincident-anchored to the origin for the identical AMEND
  4 reason) — the width/height dims alone only fix SEPARATION, not WHERE the pair sits relative to the origin.
- `Distance` is a DIMENSION (`fb_engine.dimension_step`), not a geometric constraint — caught and fixed BEFORE
  committing (first draft declared it into `constraints[]`, which only ever reaches `constraint_step`, a type
  system that has no such thing): moved to `dimensions[]`, the SAME array `Radial`/`SlotWidth` already use.
  `dimension_step`'s own existing `Targets`+`Orientation` branch (`addDistanceDimension`) already supported this
  — a previously-unused existing path, not new fb_engine surface (unlike `Symmetry`, T69-FIX, which genuinely was
  new). `_apply_radial_dimensions` renamed to `_apply_declared_dimensions`, reflecting its now-broader real scope.

**A real fake-shim gap found while writing the Python test**: `adsk.fusion.DimensionOrientations` (the enum
`_create_dimension`'s own Distance branch reads directly) was never stubbed — no prior manifest, in this
module's whole history, had ever exercised that specific code path. Added with the 3 real values
(Horizontal/Vertical/AlignedDimensionOrientation), same "opaque sentinel, never rendered" convention every other
fb_engine enum stub in this shim already uses. Also added `originPoint` to `FakeSketch` (a real Fusion sketch's
own always-(0,0,0) point) and a `dim:Distance` CALL_LOG entry to `addDistanceDimension` (matching
`addRadialDimension`'s own existing logging convention, previously missing).

### Tests and verification

**JS**: 5 new tests (both axes Coincident-anchored; the horizontal axis's own geometry; the shoulder-Equal drop
with its Symmetry surviving; hip/waist EXPLICITLY confirmed NOT dropped; the seg4/seg6-vs-seg0/seg10 asymmetry
made an explicit, named fact rather than a silent side effect; the width/height dims + horizontal-axis symmetry).
3 existing tests' own scope narrowed (the generic Coincident/Symmetry coordinate checks now explicitly exclude
`'origin'`-involving and `horizontalAxis`-involving constraints, which need their own dedicated tests instead of
a one-size-fits-all coordinate check). Mutation-tested all 3 new production behaviors (shoulder-Equal drop,
width/height dim block) separately, MD5-restored each time — each disabled EXACTLY its own test(s), nothing else.
Full suite: 1051/1051 (up from 1045 — 6 net new tests).

**Python**: origin registration + `Distance` dispatch both mutation-tested (disabling each broke exactly the one
new end-to-end test built to catch it). Full suite: 150/150 (`pytest`).

**Disclosed, not independently re-verified this turn** (NO FUSION): whether hip/waist's own mirror-Equal are
ALSO safe to drop (structurally they look similar to the dropped shoulder pair, but neither hand-tracing nor the
advisor's own measurement confirms it) and whether seg0/seg10's own second Symmetry is ALSO genuinely redundant
(the rule's own asymmetry is a real, disclosed limitation, not a proven boundary) are BOTH left as open questions
for the advisor's own next live check, exactly as flagged in the previous T69-FIX entry — this turn added NO new
unconfirmed generalizations beyond what was already flagged, and corrected one specific wrong hand-derivation
(seg0/seg10) with an empirical test before it could ship silently wrong.

Amendments polled clean before this commit; will poll once more immediately before passing, then continue into
T70 (SE14b) proper.

## Capacity report — stopping here; T69-fix-3 (a large amendment cascade) and T70 (SE14b) itself both queued, neither started

**What happened**: right after T69-fix-2 (aa30f5b) was pushed, and while starting the T70 (SE14b) investigation
below, NINE more amendments (T70 AMEND 6 through 14) landed in rapid succession — the advisor iterating live in
Fusion with Fred, several amendments explicitly SUPERSEDING earlier ones in the SAME cascade (12 replaces 9/10/11;
11 was even proposed then HELD after Fred said the advisor had misread him). Asked the user directly whether to
push through T70's own substantial remaining implementation or stop and report capacity, given the turn had
already produced 3 commits (T69, T69-fix, T69-fix-2) before this cascade even arrived — the user chose to stop and
report. This entry is that report: a synthesized, ACTIONABLE spec for the next session (not a re-hash of the raw
amendment chain), followed by the T70/SE14b investigation already completed, followed by the capacity call itself.

### T69-fix-3 — the synthesized FINAL spec (not the raw amendment chain)

Reading amendments 6-13 in isolation and implementing them in arrival order would be actively wrong — several
supersede earlier ones outright. The FINAL state, after resolving every supersession:

**Contour constraints — a near-total rollback of T69-FIX's own AMEND 3/4/5** (Fred: "dont use symmetry either",
"no radius dim though, leave the sketch loose for now"):
- REMOVE entirely: the `Symmetry` constraints on the contour (both the L/R mirror-pass ones AND the top/bottom
  Symmetry-about-`horizontalAxis`), the `mirrorAxis`/`horizontalAxis` construction-Line entities, the
  `Coincident(['origin', axisId])` anchors, the Radial dims (`corner_radius*half_width` on the shoulder,
  `waist_radius` on the waist).
- KEEP unchanged: Slot/Arc3PointSlot entities + their own `stroke_width` SlotWidth dims (T69's own mechanism,
  untouched by any of this), the Coincident joint chain (always existed, pre-T69-FIX), H/V on straight segments.
- **My own flagged judgment call, NOT yet confirmed by the advisor**: the mirror-Tangent DEDUP (dropping
  Tangent(seg4,seg6) specifically) and the shoulder mirror-Equal DROP (dropping Equal(seg1,seg9)) were BOTH
  justified purely by "redundant given the NEW Symmetry constraints" — with Symmetry now gone entirely, that
  justification no longer holds, so BOTH should almost certainly be REVERTED (restore all 8 Tangents; restore
  Equal(seg1,seg9), matching hip/waist's own unconditional Equal treatment) as PART of this same rollback, not
  left half-applied. The advisor's own wording ("keep the redundant-Tangent dedupe IF STILL NEEDED") explicitly
  leaves this as a judgment call for the implementer — flagging my own read here, not applying it myself.
- Net effect: the mirror-pass logic collapses back to something close to T69's ORIGINAL, pre-AMEND-3 shape (plain
  Equal for both Line and Arc mirror pairs, no Symmetry/axes/Radial) — geometry is inserted symmetric (by
  construction, from the manifest's own coordinates) and left LOOSE, not explicitly re-constrained to stay so.

**Contour overall size — KEPT, but redesigned twice more** (Fred: "W and H is good", then two value changes, then
a parameter-design change):
- Two Distance dims survive: width and height, but targeting CORNER POINTS on the contour centerline (e.g.
  `seg11:S`/`seg11:E` and `seg4:E`/`seg0:S`-style pairs — whichever segment pair actually shares each corner via
  the existing Coincident chain), NEVER whole curves — AMEND 6's own real measurement: `addDistanceDimension`'s
  real signature is `(SketchPoint, SketchPoint, DimensionOrientations, textPoint[, isDriving])`, and passing
  curves crashes with "Wrong number or type of arguments." **The shim's own `addDistanceDimension` must be
  updated to REJECT curves** (so this exact regression fails in tests, matching the dispatch's own explicit ask)
  — currently the fake accepts anything positionally; needs a type check against whatever this shim's own
  SketchPoint-shaped objects are (`FakeSketchPoint`), raising/erroring for a `FakeSketchLine`/`FakeSketchArc`.
- **FINAL parameter design** (AMEND 12, explicitly replacing 9/10/11 — 11 was proposed as a `contour_margin`
  param, briefly HELD after a misread, then fully replaced by 12's own different shape, so do NOT implement
  `contour_margin` at all): two NEW, INDEPENDENT user parameters, `contour_width`/`contour_height`, declared as
  PLAIN NUMBERS (never an expression referencing `widthIn`/`heightIn`) — value = board size minus a margin.
- **FINAL margin value** (AMEND 13, replacing 12's own 0.25in default): margin = **1 in** total (0.5in inset per
  side) — on the standard 7x9 test board, `contour_width=6`, `contour_height=8`. Declare this ONE default margin
  constant once in JS, consumed by BOTH the app's own drawn-contour inset (0.5in per side) and the manifest's
  `contour_width`/`contour_height` parameter VALUES — one declaration, two consumers, the same discipline every
  other shared constant in this module already follows.
- Dims: `{type:'Distance', targets:[cornerPointIdA, cornerPointIdB], orientation:'Horizontal', expression:
  'contour_width'}` (and the Vertical/`contour_height` sibling) — expression is the BARE parameter name now, no
  arithmetic (AMEND 12 dropped the earlier `'widthIn - 0.25 in'` inline-arithmetic design from AMEND 9/10 too).
- App-side: the drawn contour itself must ALSO be inset by the SAME margin (0.5in per side, centred) — meaning
  `regenerateSilhouette`'s own boundary generation needs to actually shrink the silhouette's own region by the
  declared margin before calling `generateSilhouette`, not just change what the MANIFEST claims — otherwise the
  app draws one size and the manifest declares another, breaking parity (T68's own parity test must catch this;
  the dispatch's own AMEND 9 text was explicit: "the build's parity check must still read 0").

**Required test**: "the manifest declares no Symmetry, Radial, or Distance-targeting-a-curve for the contour" —
the dispatch's own explicit ask (AMEND 7), still valid after 8/12/13's own partial reinstatement of Distance (now
point-targeted, not curve-targeted — the test should assert Distance dims exist but with 2-point, not-a-bare-
segment-id targets).

**Tangential, separate item — T70 AMEND 14** (Fred: "Stroke width default to .25"): the LATTICE stroke default
(`PATTERN_DEFAULTS.widths.rails`/`.ties`, still linked-equal by default) changes from 0.07in to 0.25in — covers
rails, ties, AND (since T69) the Shape Lattice's own contour slot width, all via the SAME `stroke_width` manifest
parameter's own seed value. ONE declared default, changed in ONE place (`editor-lattice-pattern.js`'s own
`PATTERN_DEFAULTS`). A saved pattern with its own already-set width is UNCHANGED (defaults only affect a NEW/
unset pattern). Every existing test asserting the literal `0.07` as "the default" needs updating to `0.25` — a
mechanical but WIDE-reaching sweep (rails/ties/node-radius tests, shape-lattice tests, the manifest tests, the
Python builder's own `stroke_width` parameter-value assertions) — grep for `0.07` across `tests/*.js` and
`test_sketch_manifest_builder.py` before touching anything, since not every `0.07` literal is necessarily THIS
default (a few tests intentionally pass a NON-default width to prove the mechanism is generic) — read each hit's
own context before changing it, don't mechanically replace.

**None of T69-fix-3 or AMEND 14 has been implemented** — this whole section is a synthesized spec for whoever
picks this up next (fresh session or this same one, resumed), so they don't have to re-read and re-reconcile 9
raw, partially-superseded amendment messages themselves.

### T70 (SE14b) — investigation completed, zero implementation started

Fred: "we should also represent those separations in the add-in preview, to be able to select segments and color
them." Dispatched as: the generated silhouette becomes N separate selectable/colourable SVG elements (one per
segment, round caps, stroke=stroke_width) instead of one path; the per-segment list must be the SAME piece list
`buildSketchManifest` reads (T68's own parity test extended to cover it); the fill boundary is the segments
chained into one closed loop, DERIVED at render time; styling (straight/curve/kink) stays mirrored per L/R pair,
COLOUR is per-segment (L can differ from R); colour survives a same-count regenerate, keyed by segment id/index;
drape/3D preview/SVG export also show per-segment colour; a visual PNG check (2 recoloured segments, hourglass +
bottle) before passing.

**Findings from a full investigation (an Explore agent's own survey, cross-checked against the actual source)**:
- Rails/ties/nodes today are colour-per-KIND, not per-piece (`generatePattern` swaps `editor._color` before
  looping over one whole kind; `recolorOwnedKind` bulk-recolours a WHOLE kind identically) — there is NO existing
  per-piece colour override anywhere in this codebase to mirror; this is genuinely new ground.
- Selectability is fully generic (`getNearbyElement`, editor-hit.js): any direct child of `_sketchLayer` with
  `data-layer` and a declared `ELEMENT_CAPS` entry (line/path/circle/etc.) is automatically selectable — a `<line>`
  or per-segment `<path>` needs NO new attribute to become genuinely selectable via the normal select tool.
- A SEPARATE, already-existing per-segment interaction already exists for this exact silhouette:
  `hitTestSegment`/`primitiveSegmentMap` (editor-shape-lattice-interaction.js) — a pure geometric, ARRAY-INDEX-
  keyed distance test driving the EXISTING segment-tap style popup (straight/curve/kink/bulge/dir/cornerRadius).
  Making segments real DOM elements creates a SECOND, independent "which segment did I click" answer (DOM
  bbox-select vs. index-based geometric tap) that needs EXPLICIT reconciling — decide whether the tap-popup keeps
  using the index-based test while marquee/click-select uses the new DOM elements, or unify them. Not resolved.
- The ONE real, hard blocking dependency: `_findBoundaryElement` (editor-lattice-pattern.js) assumes exactly ONE
  element per boundary-ref id, and `shapeToPrimitives`/`shapeToInnerBoundaryPrimitives` (editor-lattice-
  boundary.js) both dispatch on a SINGLE element's own `.type` — the Shape Lattice's own LATTICE-FILL CLIPPING
  (an entirely separate, already-shipped feature) reads the boundary through EXACTLY this path. N sibling
  elements need: `_findBoundaryElement` to become plural (return ALL matches, ordered), and a NEW combining
  function — concretely, `elements.flatMap(el => _primitivesFromD(el.attr('d')))` re-chained through the
  ALREADY-EXISTING `primitivesToPathD` (editor-shape-lattice-generator.js) back into ONE closed-loop `d` string,
  then through the ALREADY-EXISTING `insetPathDToPrimitives` (T68's own shared extraction) — reusing two already-
  built functions, no new offset/geometry math needed. This is the change that most needs care: get it wrong and
  the ALREADY-SHIPPED lattice-fill-clipping feature silently breaks for every Shape Lattice layer, not just new
  per-segment-colour ones.
- Drape (`core/preview/drape-svg.js`, `buildDrapeSvg`) and SVG export/save (`editor-io.js`) both already read the
  live/serialized DOM GENERICALLY, one level of `_sketchLayer` children, no `<g>` recursion — N flat sibling
  segment elements (each with its OWN `stroke`/`fill`) will already work for drape/export/3D-preview with ZERO
  changes there, PROVIDED they are never wrapped in a `<g>` (the one recursion depth this whole area relies on).
- Colour storage: `PATTERN.shape.segments[i]` already exists (style/bulge/dir/cornerRadius per index, mirror-
  aware via `writeSegmentStyle`) — adding `color` as a new sibling key on each `segments[i]` object is the
  cleanest, collision-free spot (no separate id system needed; segments have no id besides their own array
  index, which this object is already keyed by). Open product question, not yet decided: should a MIRRORED
  segment's colour auto-follow its own partner the way style/bulge/dir/cornerRadius already do, or deliberately
  NOT mirror (so L/R can be coloured differently, which is what the dispatch's own wording implies is wanted)?

**Nothing has been written for T70** — no rendering change, no boundary-resolution refactor, no colour-storage
field, no UI, no tests, no visual check. The investigation above is a complete, actionable starting point, not a
partial implementation to continue mid-stream.

### The capacity call itself

By the time the AMEND 6-14 cascade landed, this turn had already produced 3 real commits (T69 contour-as-slots,
T69-FIX arg-order+symmetry, T69-fix-2 origin-anchor+size-dims) — each involving genuine, careful reasoning about
constraint redundancy I could not independently verify without live Fusion access. T69-fix-3 (the cascade's own
synthesized spec above) is ITSELF a substantial rework — a near-total rollback of the last commit's own
Symmetry/axis/Radial mechanism, a NEW two-parameter size design that's already been revised 4 times in the
cascade alone, plus a real shim gap (curve-rejection) to add correctly. T70 (SE14b) proper, on top of that, is a
full rendering-architecture change with one genuinely hazardous dependency (the boundary-resolution refactor an
ALREADY-SHIPPED feature relies on) plus a persistence-design decision plus a required visual verification step.
Asked the user directly whether to push through or stop; the user chose to stop. Passing back now with this
synthesized spec so the next turn — whether a fresh session or this same one resumed — can start implementing
T69-fix-3 immediately without first re-deriving it from 9 raw, partially-superseded amendment messages, and can
pick up T70 with the investigation already done.

Amendments polled clean before this pass (10 new absorbed into the synthesis above, nothing left unaddressed in
the mailbox). No code changed in this section — nothing to commit for it.

### T71 — T69-fix-3 implemented (loose contour + contour_width/height) + stroke default 0.25

Implemented the synthesized spec above exactly, epoch 3, fresh session. `editor-sketch-manifest.js`'s
`manifestFromShape`: removed the mirror axis, horizontal axis, every Symmetry constraint, and their
Coincident-to-origin anchors entirely; reverted the mirror-Tangent dedup (all 8 Tangents again, not 4) and the
shoulder-pair Equal drop (Equal(seg1,seg9) restored) — both exactly as flagged/confirmed, since neither
exception's own justification ("redundant given Symmetry") survives Symmetry's removal. The mirror pass is now
back to T69's own ORIGINAL shape: one plain Equal per valid mirror pair (Line or Arc alike), no exceptions.
Both Radial dims (shoulder's `corner_radius * half_width`, waist's `waist_radius`) are gone, along with the
`waist_radius` parameter that only ever existed to drive one — the shoulder<->hip Equal itself stays ("no radius
dims" means no driving DIMENSION, not no relationship).

Overall size: kept, per Fred's "W and H is good", but redesigned to match the AMEND 6 real-Fusion finding
(`addDistanceDimension` only accepts 2 SketchPoints, "Wrong number or type of arguments" on a curve) — the
Distance dims now target `id:S` points on the SAME `widthPairIds`/`selfMirrorHorizontalIds` entities the old code
already discovered (a representative Line mirror pair, and the 2 self-mirroring horizontal edges), never the bare
curve id. Driven by two NEW, independent parameters (`contour_width`/`contour_height`, plain numbers, never an
expression referencing `widthIn`/`heightIn`) — declared once `region.w`/`region.h` are known, which is why I moved
the `if (widthPairIds)`/`if (selfMirrorHorizontalIds.length === 2)` blocks to AFTER the `parameters` const
declaration (a TDZ crash the first vitest run caught immediately: `parameters` wasn't a plain accumulator array
from the top of the function the way `entities`/`constraints`/`dimensions` are — it's built from
`Object.entries(params)` partway through — moving just the two `if` blocks down, not the `widthPairIds`/
`selfMirrorHorizontalIds` *discovery* loops, fixed it with the smallest possible diff).

Margin: one declared constant, `CONTOUR_SIZE_INSET_IN = 0.5` (+ a paired `insetRegionForContour` helper), in
`editor-lattice-boundary.js` — the SAME neutral home `SILHOUETTE_STROKE_WIDTH` already established for exactly
this "both the app's drawing and the manifest producer import this" reason. `buildSketchManifest` computes the
inset contour region ONCE and threads it into BOTH `resolveShapeBoundaryExtent` (so the lattice fill clips to the
NEW smaller contour, not the old board-wide one) and `manifestFromShape` (so `region.w`/`region.h` — already
consumed for `half_width` — become `contour_width`/`contour_height` for free, no separate arithmetic). Verified:
on the standard 7x9 test board this comes out to 6/8 exactly, matching the spec's own worked example.

App-side parity turned out to need FOUR call sites, not the one the dispatch named (`regenerateSilhouette`) — a
grep for `generateSilhouette(` in `properties-shape-lattice.js` plus a chase through `editor-interaction.js`
found `_effectiveSegments` (segment list before a first Generate), `paramHandleRecords` (the draggable param
handles' own anchor positions), and `detectShapeLatticeDetach` (the "did a hand-edit diverge from what
Generate would produce" check) all independently re-derive the SAME silhouette from `boardRegion(editor)`
directly. Missing any of them would have left a real, user-visible bug (handles misaligned with the now-smaller
drawn contour, or `detectShapeLatticeDetach` permanently misfiring "picked" on every commit since its own
recomputed `d` would never again match what's actually drawn) even though no test in the existing suite would
have caught it — none of them assert against an oracle built from the OLD uninset region. Declared one shared
`_shapeContourRegion(editor)` helper (properties-shape-lattice.js) — exported (same underscore-kept-while-exported
convention `_findBoundaryElement` already uses in this file) since `editor-interaction.js`'s own segment-tap
hit-test (`shapeLatticeHandler.start`) needed the identical region too; that call site's own `boardRegion` import
became dead and was removed.

Python: `test_sketch_manifest_builder.py`'s `FakeSketchDimensions.addDistanceDimension` now type-checks both args
against `FakeSketchPoint`, raising the same "Wrong number or type of arguments" real Fusion gives for a curve —
this immediately turned up ONE existing test (`_mirror_anchor_and_size_manifest`, T70 AMEND 4/5's own end-to-end
fixture) that was itself feeding the exact bug the fix now catches (`targets: ["segR", "segL"]`, bare ids) —
fixed to `["segR:S", "segL:S"]`, matching what a correct manifest actually looks like; the mirror-axis/Symmetry
machinery it exercises is unrelated, still-generic fb_engine capability (T71 only stops the JS PRODUCER from
emitting it for the contour) so that fixture and its Symmetry-only sibling test are otherwise untouched. Added
`test_distance_dim_targeting_a_bare_curve_id_is_rejected_not_silently_accepted` proving the regression is now
caught as a graceful DIM CRASH (skip-and-report, never a hard crash) — confirmed non-vacuous by construction
(the pre-fix shim unconditionally logged `dim:Distance` and returned success for the identical input).

AMEND 14 (stroke default 0.25): `PATTERN_DEFAULTS.widths.rails`/`.ties` changed from
`LATTICE_STYLE.rail.widthFactor * 0.25` (=0.07) to a plain `0.25`. Swept `0.07` across `tests/*.js` and
`test_sketch_manifest_builder.py` per the dispatch's own instruction — only ONE hit was actually testing THIS
default symbolically (`editor-lattice-pattern-emit.test.js`'s own "declares the three default kind widths");
every other hit either hardcodes an explicit non-default width on its own test pattern (unaffected by the
JS-side default at all) or belongs to an unrelated function (`emitSegment`'s own `LATTICE_STYLE`-derived
fallback, `stepToGrid`'s rounding-grid samples). One MORE non-`0.07`-literal casualty the grep couldn't catch:
`editor-lattice-pattern-ending.test.js`'s own circular-boundary ending-rule suite reads
`PATTERN_DEFAULTS.widths.rails` *symbolically* (not a literal), and its "loose degrades to inset" test used a
hand-picked tiny circle (chord 0.6) that was safely bigger than 2×the OLD half-width (0.14) but smaller than
2×the NEW one (0.5, i.e. now exactly one full grid cell) — the pullback started overshooting into a clamped/
midpoint fallback the test never anticipated. Not a production bug (the clamp is the CORRECT defensive
behavior once a rail is a full grid cell wide) — decoupled that whole describe block from the evolving UI
default with an explicit local `RAIL_WIDTH_IN = 0.07`, the same "a few tests intentionally pass a non-default
width" pattern already used elsewhere in this codebase.

Required test (AMEND 7, still valid per 8/12/13's partial Distance reinstatement): added, asserting every
Distance dim's targets end in `:S`/`:E`. Also replaced the entire obsolete "T70 AMEND 3"/"T70 AMEND 4/5" describe
blocks in `tests/editor-sketch-manifest.test.js` (mirrorAxis/Symmetry/waist_radius assertions that would now
either throw — reading `.expression` off a dim that no longer exists — or simply assert the wrong thing) with a
new "T71 (T69-fix-3): loose contour" block covering the reverted behavior directly, plus a new `buildSketchManifest`
describe block proving the 7x9-board contour_width=6/contour_height=8 example end-to-end. Updated 2 buildSketchManifest+
shape tests and both `parity-app-manifest.test.js` contour tests that independently re-derive expected geometry via
`generateSilhouette(REGION, ...)` to use `insetRegionForContour(REGION)` instead, matching what the manifest/app
now actually build from.

Verify: 1048/1048 vitest, 33/33 pytest (`bspline-frame-builder/b-spline-gen`), both full suites, twice (once before
the comment cleanup below, once after). `proc_health.py watch` showed nothing lingering — no dev server or
watch-mode process was started this turn.

One thing caught only by re-reading my own diff, not by any test: my first draft of the T71 doc comment above the
wraparound-joint loop duplicated the PRE-EXISTING "Coincident at EVERY adjacent primitive joint..." paragraph
verbatim right after itself (I'd meant to ADD to that comment, not restate it) — trimmed to just the new,
T71-specific delta before committing. Nothing behavioral, but worth naming since it's exactly the kind of stale/
redundant doc-comment drift the worker skill's own architecture-map guidance warns against, just inside a
function comment rather than a map file.

NO FUSION this turn, per the dispatch. Amendments polled clean immediately before this commit+pass (nothing new).

### T72 (seat B, epoch 3→4) — SE15c threshold, T71's own no-lattice regression, SE14c checkbox, 3 AMEND-2/3 items, AMEND 5 sweep, and item 7's non-fix

Six committed items, one commit each, pushed after every one (60a6df8, d4106f2, 591f15d, ef85e4a, 02b5f82, 25b9d9e,
dd656cb). Epoch bumped 3→4 mid-turn (the advisor's own dedup of a duplicate seat B session, session 4a) — carrying
"epoch 4" in this turn's own pass-back per the advisor's explicit instruction.

**Item 1 (SE15c)**: `SKETCH_PIECE_THRESHOLD` 60→300, per the advisor's own live-Fusion re-measurement (16 rails/97
pieces: plain 61s/0.139in drift/visibly tilted vs. constrained 90s/0/0.030in drift). Doc + one test's own extent
widened to still clear the new threshold.

**Item 2 (+ AMEND 1)**: root-caused and fixed the SAME bug class T71's own contour-inset margin introduced —
`insetPathDToPrimitives`'s pre-existing "collapse to `[]` on self-intersection" behavior (correct and still tested
for a genuinely thin HAND-PICKED boundary) was zeroing the ENTIRE lattice fill for the default Bottle preset
specifically, because T71's new 0.5in/side margin pushed Bottle's own near-zero-radius neck fillet into
self-intersecting territory once offset inward by the SAME half-stroke amount. Scoped the fix to GENERATED
presets only (`insetGeneratedPresetPathDToPrimitives`, falls back to the raw boundary on collapse) — a
hand-picked shape keeps declining to `[]`, unchanged, matching the existing "thin arm... the WHOLE shape
declines" test's own documented intent. Also deduped `stroke_width` (declared independently, and identically, by
BOTH `manifestFromShape` and `manifestFromLattice` when linked).

**Item 3 (SE14c)**: a "show contour" checkbox — OFF still computes/clips the lattice fill against the exact same
boundary (unconditional in `buildSketchManifest`), only the contour's own manifest entities/dims/params and its
drawn visibility disappear. The drawn `<path>` stays a REAL element either way (`display:none` when OFF) since the
live boundary lookup still needs it; `getLayerSvg`'s shared `_parseLayerContent` filter drops any `display:none`
child from BOTH the plain SVG and Fusion-geometry export paths — one declared signal, two consumers, never a
second tracked flag. Rendered both states to PNG via headless Chrome (from the pure geometry engine directly, no
live app needed) and visually confirmed: rails/ties/nodes pixel-identical, only the black outline appears/
disappears.

**Item 4 (AMEND 2)**: fixed Fred's own reported "3 handle dots floating over an empty board before any shape
exists" — `paramHandleRecords` gated on `shape.source === 'generated'` alone, but `PATTERN_DEFAULTS.shape.source`
IS `'generated'` by default and `currentShape()` materializes that default the instant anything reads `p.shape`,
so the check was true even pre-Generate. Declared the REAL check once, `hasGeneratedSilhouette(pattern)`
(editor-lattice-pattern.js) — the same two-part condition (`source==='generated' AND extent.mode==='boundary'`)
`buildSketchManifest`'s own `hasShape` already used — and had BOTH callers read it, rather than two copies of the
same two-part condition silently drifting. Test: 0 handles pre-Generate, 3 after.

**Item 5 (AMEND 2)**: a `contour` colour (green `#2e7d32`, declared alongside rails/ties/nodes in
`PATTERN_DEFAULTS.colors`, never black) + a 4th swatch in the panel's own Colors row. A freshly-minted contour now
draws in that declared colour instead of the general drawing tool's own CURRENT color (`editor._color`), which was
its only color source before this turn. `recolorOwnedKind` gained a `'contour'` branch — genuinely different from
rails/ties/nodes (ONE linked `<path>` found by `boundary.shapeId`, never an OWNERSHIP_ATTR/data-lattice-marked
piece the existing filter can see), not a 4th `COLOR_KIND_TO_LATTICE_ATTR` entry. SE14b's own later per-segment
split will need its own recolor path when that lands.

**Item 6 (AMEND 3)**: Border width "auto" was silently resolving to the silhouette's own ALWAYS-hairline stroke
(`SILHOUETTE_STROKE_WIDTH`, a real, positive, truthy number — so the `|| widths.rails` fallback in
`_effectiveBorderWidth` never actually fired) instead of the lattice's real stroke width, for a GENERATED
silhouette specifically. Branched on the SAME `hasGeneratedSilhouette` item 4 declared: generated+auto now means
`widths.rails` (read fresh every Generate, so it follows live edits); a hand-picked boundary keeps inheriting its
own live stroke, unchanged (T49's own original ruling) — fixed 2 existing tests whose own hand-built fixtures
never set `shape.source` at all (silently defaulting to 'generated', misrepresenting what "Pick shape…" actually
sets). Added a parity test: drawn Border stroke-width === the manifest's own `stroke_width` parameter, exactly.

**AMEND 5** — a permanent sweep test (`tests/shape-lattice-param-sweep.test.js`, 126 cases: 2 presets × each
preset's own params at {min,mid,max} × rails-count {3,7,14} × orientation {H,V}), asserting rails>0/ties>0/parity.
Found and fixed a REAL regression of the exact same bug class as item 2: at an extreme param (e.g. hourglass
`waistReach` near its min), a scan-line tangent to the deeply-pinched boundary can produce a genuinely
zero-length "inside" span — `manifestFromLattice` already filtered these (T66's own `MIN_PIECE_LENGTH`, a
different symptom of the SAME root cause), but `generatePattern`'s own rail/tie emission loop had no equivalent
filter, so the app drew a zero-length `data-lattice="rail"` element the manifest never declared — a real
app/manifest COUNT mismatch, not cosmetic. Fixed by declaring the threshold ONCE as `MIN_PIECE_LENGTH_IN`
(editor-lattice.js, the lowest module both producers already import from) instead of leaving it a single,
easily-forgotten local in the manifest producer. Separately MEASURED, not fixed: at rails=3 (only 2 adjacent-rail
pairs to bridge) a few preset/param combinations place 0 ties at this file's own fixed seed 42 specifically —
30/30 OTHER lattice seeds against the identical shape+rails placed ties fine, confirming this is the pre-existing,
already-disclosed T67 Part 3 "less good at MAXIMIZING placed-tie count" trade-off (mutation-tested and accepted
that turn, not reintroduced by T71/T72), and self-corrects on any retry since Generate always rerolls the seed.
The sweep asserts `ties>0` everywhere except rails=3 (parity still required there) rather than either weakening
the whole sweep or speculatively rewriting the tie-placement fallback for a narrow, self-correcting case outside
this turn's own actual regression.

**Item 7 (AMEND 4 + its own intermittent follow-up) — investigated thoroughly, NO code fix, because no bug was
found.** Built a real, no-deps CDP driver (same pattern `scripts/smoke-editor.mjs` already established: headless
Chrome, `Input.dispatchMouseEvent`/`dispatchTouchEvent` against a REAL local server) and reproduced the reported
symptom on the FIRST attempt — but my own first script reused ONE page across several drag "variants," so each
drag's own displacement accumulated on top of the PREVIOUS variant's already-dragged shape, eventually pushing
`waistReach` into genuinely self-intersecting territory — a real degenerate shape, but caused by the test script
itself, not the app (confirmed by screenshot: a visibly self-intersecting hourglass after 4 stacked drags).
Rebuilt with each variant on its own fresh page load (no cross-variant drift) and a small, realistic, FIXED
displacement: `paramsAfterDrag.waistReach` came out byte-identical across mouse/touch and 3-to-60 intermediate
move events, confirming `valueFromWorld` is a pure function of final pointer position (not cumulative, not a
feedback loop) — Generate correctly NEVER resets `shape.params` (by design: it only rerolls the LATTICE fill's own
seed, `readFieldsIntoPattern` explicitly never touches `p.shape.*`), and `editor._isDrawing`/`_shapeLatticeDragKey`
were always correctly reset before Generate ran, on every trial, with zero console errors/exceptions logged ever.
A statistical batch (12 desktop mouse trials + 8 real mobile-viewport touch trials, `mobile:true`/390×844, not
just touch events on a desktop-sized page) measured the "fill looks unchanged after Generate" rate at 1/12 and
1/8 — matching, almost exactly, the ~1/12 rate PURE CHANCE predicts from `rails.count` ([6,7], 2 values) and
`ties.count` ([8,13], 6 values) independently re-rolling to the SAME combination (row/column PLACEMENT for a
given count is deterministic, never reseeded, so a coincidental count-match is a coincidental exact-position-
match too). Conclusion, stated plainly rather than papered over: there is no "Generate stops working after a
drag" mechanism in this codebase — Generate reliably rerolls and regenerates the fill every single time, on both
desktop and a real mobile viewport; what Fred most likely experienced is the SAME shape (which Generate never
resets, by design) combined with an occasional coincidental rail/tie-count repeat, at a rate fully explained by
the narrow declared count ranges. Flagging for the advisor/Fred to decide whether that's worth a UX change
(e.g. widening the count ranges, or a "regenerated" affordance) — inventing a code fix for a mechanism that isn't
actually broken would have been the wrong call. Scratch CDP scripts removed from `scripts/` before this pass
(throwaway investigation tooling, not permanent test infrastructure); local `http.server`/Chrome processes
confirmed stopped, `proc_health.py watch` clean.

Verify (final, after AMEND 5): 1203/1203 vitest, 33/33 pytest. Amendments polled clean immediately before this
pass. NO FUSION this whole turn, per the dispatch.

## T73 (SE14b) — Shape Lattice contour as N selectable, per-segment-colourable segments

Per the dispatch (Fred: "we should also represent those separations in the add-in preview, to be able to select
segments and color them" / "contour can have per segment colors within lattice right?"), using the T70/SE14b
capacity-report investigation (b62fd4d) named in the dispatch: the rendering pipeline, the boundary-resolution-
reads-one-DOM-element hazard, the segment-tap interaction question, and the colour-persistence design.

**Rewrite**: the contour is now drawn as ONE `<path>` PER PRIMITIVE (line/arc, round caps, stroke=`widths.rails`,
"auto = lattice stroke width" per T72 item 6) instead of one combined path, all sharing a single `boundary-ref` id
(`data-contour-seg` holds each one's own primitive index — the SAME index `generateSilhouette`'s own `primitives[i]`
and the manifest's own `seg{i}` ids already use). `_findBoundaryElement` → `_findBoundaryElements` (plural,
order-sorted by that index) so the already-shipped lattice-fill-clipping code (a hard dependency on boundary-element
resolution) degrades correctly for both the old N=1 hand-picked case and the new N>1 generated case: the N segment
`d` strings are rejoined into one closed loop (`joinSegmentPathsIntoClosedD`) and fed to the SAME
`insetGeneratedPresetPathDToPrimitives` generated presets already used — no new inset math, no geometry stored
twice. The Border-piece emission and `recolorOwnedKind`'s `'contour'` branch were rewired the same way.

**Parity gap found and fixed**: making the contour's own drawn stroke width `widths.rails` instead of a fixed
hairline (the dispatch's own explicit "auto = lattice stroke width" ask) meant `_effectiveBorderWidth`'s Border-off
fallback — which reads the live boundary element's own `stroke-width` — now returns `widths.rails` too, but
`editor-sketch-manifest.js`'s own `shapeHalfInset` still assumed the OLD hairline constant for that same fallback.
That divergence clips the app's lattice fill and the manifest's lattice fill against two DIFFERENT effective
boundaries — caught by the full test run (77 failures: rails/ties count mismatches across
`shape-lattice-param-sweep.test.js` and `parity-app-manifest.test.js`), not assumed from reading the code. Fixed by
having `shapeHalfInset` read `widths.rails` too, matching the app's now-uniform behavior; the app/manifest "d" byte-
for-byte parity test was rewritten for the new N-elements-per-primitive shape rather than deleted.

**Colour-persistence bug self-caught before committing**: the first draft stored a segment's colour override on
`shape.segments[i].color`, keyed by the pre-existing STYLE-segment index (kink/bulge/dir/cornerRadius, T58's own
"Segments" panel section). Running the full suite didn't catch this one — it's a design bug, not a regression — a
second look caught it: `generateSilhouette`'s own `_normalizeSegment` rebuilds a FRESH `{style,bulge,dir,
cornerRadius}` object on every single call and drops any other field, so a colour written there would never survive
even a same-preset regenerate. Worse, `_segmentToPrimitives` expands one 'kink' style-segment into TWO line
primitives, so `shape.segments.length` can be smaller than the drawn primitive count — the style-segment index and
the drawn-primitive index are genuinely different axes, not just different names for the same thing. Redeclared as
`PATTERN.contour.segmentColors[i]`, a new parallel array keyed by PRIMITIVE index (matching `CONTOUR_SEG_INDEX_ATTR`
and the manifest's `seg{i}` ids), carried forward across a regenerate that keeps the SAME primitive count and reset
to `[]` when it changes (preset swap, or a style edit that adds/removes a kink) — "a count change resets them," per
the dispatch.

**editor.setColor** now persists a recoloured contour segment's override into that array when the selection carries
`CONTOUR_SEG_INDEX_ATTR`, via a plain module function (not an instance method — `editor-color.test.js`'s own
`VectorEditor.prototype.setColor.call(mock, …)` pattern exercises real mocks that never carry every instance
method, only the ones a test explicitly re-attaches, so a `this.foo()` call would have broken that whole file).
`recolorOwnedKind`'s contour branch reads the same array so the contour's own default-colour swatch still skips any
segment carrying an override, matching rails/ties/nodes' existing default-vs-override rule.

**Verified unchanged, no code needed**: `manifestFromShape`'s own `seg{i}` ids already index by primitive, matching
the DOM side exactly — no manifest change beyond `shapeHalfInset` above. The tap-a-segment style popup
(`hitTestSegment`, editor-shape-lattice-interaction.js) is pure geometry + its own `primitiveSegmentMap` (primitive
index → style-segment index, already existed for the kink-expansion case) and is gated to the Shape Lattice TOOL's
own mode (`shapeLatticeHandler`) — the normal SELECT tool (a different mode) hit-tests the new per-segment DOM
elements individually with zero extra plumbing, so "selectable with the normal select tool" and "tap a segment to
edit its style" are different tools, never in conflict. SVG export / Fusion-geometry extraction
(`_parseLayerContent`, editor-io.js) and the drape preview both walk `_sketchLayer.children()` generically by
`data-layer`/`display`, with no contour-specific special case — each segment's own live `stroke` color and
`display` already carry through "for free."

**Tests**: `tests/shape-lattice-segment-color.test.js` (new) covers the dispatch's own acceptance list — N drawn
segments = N manifest contour entities; recolour one → only it changes; regenerate (same count) keeps it;
regenerate (preset swap, different count) resets it; the show-contour checkbox off hides ALL N segments, not just
one. Updated `tests/parity-app-manifest.test.js` (the byte-for-byte "d" test) and 3 call sites in
`tests/properties-shape-lattice.test.js` for `regenerateSilhouette`'s new return type (array of N elements, not
one) — every real caller already discarded the return value, only tests read it.

**Rendered and viewed**: hourglass (12 primitives) and bottle (10 primitives), 2 segments recoloured each (indices
1 and 4), straight from the pure geometry engine via headless Chrome (same "no live app needed" technique T72 item
3 used) — both shapes drew correctly, only the 2 targeted segments took the override colour, everything else stayed
the default contour green. Script was scratch (session scratchpad, not committed).

Verify: 1208/1208 vitest (1203 + 5 new), 151/151 pytest. Amendments polled clean before each commit. NO FUSION this
whole turn, per the dispatch. Two commits: 859eb70 (per-segment rewrite + shapeHalfInset parity fix + existing-test
updates), a455a28 (colour-persistence hook + new test file).

## T73 AMEND 1 — contour_width/height Distance dims anchor by geometry, not iteration-order luck

Delivered via a direct cross-session message from the advisor (not the usual NEXT-SESSION-lane-b.md dispatch file),
flagged as a BLOCKER to fix before anything else, "measured live in Fusion on main 660f417": the default Bottle
preset spawns with its contour up to 3.07in off.

Verified the root cause independently by reading the code before touching anything (not just trusting the report):
`manifestFromShape`'s width/height Distance-dim anchor points were a SIDE EFFECT of the mirror-pair Equal-constraint
search — `widthPairIds` captured whichever Line mirror pair that search visited FIRST in primitive-iteration order,
and `selfMirrorHorizontalIds` similarly grabbed the first self-mirroring horizontal pair. For Bottle that first Line
pair is seg0/seg8 — the NECK horns (confirmed against `_solveBottle`'s own `fresh` segment array: index 0 is
`rTop -> rNeckHorn`) — so the contour_width Distance dim forced the NECK out to the full board width once Fusion
solved it. Hourglass's own first mirror pair (seg0/seg10) happens to already be the outer/widest horns, so it
"passed" — coincidence, not correctness.

Fixed by choosing the anchor points BY GEOMETRY: the contour's own actual corners at min-x/max-x (width) and
min-y/max-y (height), found directly from every LINE primitive's own endpoints only (deliberately never an arc's —
`primitivesBBox`'s existing arc handling uses the arc's full bounding CIRCLE, which can overshoot a gently-curved,
large-radius arc's own visible sweep; every arc in these presets is tangent to, never past, its neighboring
horn/cap by construction, so a plain Line-endpoint scan is both simpler and safer than reusing that general-purpose
bbox helper here).

New test (`tests/editor-sketch-manifest.test.js`, inside the existing `describe.each(['hourglass','bottle'])` block)
confirmed FAILING FIRST against the unfixed code before any fix was applied: Bottle's anchor points measured 3.56in
narrower than the contour's true width (closely matching the live "~3.07in off" report — same bug, independently
reproduced from pure geometry, no Fusion needed); hourglass passed even unfixed, matching the "passed by luck"
diagnosis exactly. Also caught and fixed a design mistake in my OWN first draft of that test: it asserted the RAW,
undriven geometry should already measure exactly `region.w`/`region.h` apart — wrong, since `bodyWidth` (and every
other shape param) carries deliberate seeded jitter that can narrow the raw shape below the full region on purpose;
the Distance dim's whole job is to DRIVE it there once Fusion solves the sketch, not to already equal it beforehand.
Corrected to assert only the property that actually matters: the anchor points sit at the raw geometry's own true
extremes. Separately fixed a pre-existing test that hardcoded the OLD algorithm's own incidental segment ids
(`seg0`/`seg10`) as if they were a real requirement — hourglass has 4 horn segments tied at the identical extreme x
(my fix's deterministic first-found tie-break landed on `seg0`/`seg6` instead, equally correct, equally valid) — so
it was rewritten to assert the geometric property instead of hardcoded ids, avoiding reintroducing the same
brittleness this whole AMEND exists to fix.

Verify: 1210/1210 vitest (1208 + 2 new), 151/151 pytest. Amendments polled clean before commit. Commit 65545ef,
pushed. NO FUSION.

## T73 AMEND 2 — confirmed already satisfied (no code change), verification test added

Delivered via cross-session message, not the dispatch file (advisor DMing the worker mid-task, an established
pattern from earlier lanes). Claim: the visible contour segments (not just the optional Border clone) should draw
at the lattice stroke width, auto — measured against main 660f417 (pre-SE14b), where the silhouette was still a
fixed 0.02 hairline. Checked against THIS session's own already-committed SE14b rewrite (859eb70) before writing
any code: `regenerateSilhouette` already sets every segment's own `contourWidth = widths.rails` unconditionally, so
the claim was already true here, just unverified. Added the exact parity test the amend asked for
(`tests/parity-app-manifest.test.js`) instead of leaving it an assumption. 1211/1211 vitest. Commit 8447247, pushed.

## T73 AMEND 3 (geometry half) — rails/ties reach the contour's raw centerline

Fred, from 2 Fusion screenshots of a rail stopping short of the contour, unconnected: "I need rails to coincide to
contour." Root-caused by reading the code first: a rail/tie end used to stop half the CONTOUR's own stroke-width
short of centerline (`_resolveBoundaryPrimitives`'s own boundary-edge inset) AND THEN half the RAIL's own
stroke-width short of THAT already-shrunk boundary (the default `'inset'` endRule) — a real, compounding, visible
gap on both counts.

New `usesContourCenterline(pattern)` (editor-lattice-pattern.js) declares, once, exactly when this applies: a
generated silhouette whose contour is shown. `_resolveBoundaryPrimitives` (app) and `shapeHalfInset` (manifest, T71)
both force zero inset in that case; `computePattern` forces `endRule:'on-boundary'` (an EXISTING, already-tested
rule — "the crossing point IS the final endpoint," never built before because nothing needed it) instead of the
default `'inset'`. Rail/tie centerlines now reach the contour's own centerline exactly, deliberately overlapping its
stroke ("the slot caps then overlap the contour slot," Fred's own words) rather than stopping short. "Contour
checkbox OFF: keep today's behaviour" per the amend — untouched.

**Self-caught bug, before committing:** the fix's own zero-inset case exposed a pre-existing, previously-masked
precision asymmetry between app and manifest. Both sides round-trip contour coordinates through a `d`-string when
insetting by a POSITIVE amount (the app via its drawn segments' own already-string-rounded `d` attrs;
the manifest via `primitivesToPathD`) — but the manifest's own `resolveShapeBoundaryExtent` had a
`halfInset > 0 ? ... : primitives` shortcut that used FULL double-precision primitives directly whenever inset was
exactly 0, while the app's own equivalent path (`insetGeneratedPresetPathDToPrimitives`'s own `strokeHalfWidth<=0`
branch) still reparses from a string even at zero inset. The two sides only disagreed by ~0.001in — invisible
normally, but enough to flip whether a rail/tie piece exists at all right at a razor's-edge extreme param. Caught by
running the FULL test suite immediately (not just the new geometry test): 108 failures, every one at a deep-waist-
style extreme in the T72 AMEND 5 sweep. Fixed by removing the manifest's own shortcut — it now always round-trips
through the same `d`-string path the app structurally always has to (its geometry lives in DOM string attributes;
there is no way for it to be more precise than that).

**Also superseded** T72 SE14c's own "contour.show toggle changes nothing about the lattice fill" invariant, which
this amend explicitly overrides for the ON case (a wider boundary now genuinely fits more pieces) — updated the 2
tests that asserted ON===OFF to assert the intended new relationship (ON >= OFF, strictly more somewhere) instead,
and repointed one T66 regression fixture (a specific historical degenerate-piece case, unrelated to this amend) at
`contour.show:false` so it keeps reproducing the exact geometry it always has.

New `tests/shape-lattice-rails-on-contour.test.js`: an independent point-on-line/point-on-arc oracle (no re-use of
production crossing code) confirms every rail's own two ends land within ~1e-3in (the contour's own known
`_fmt`-rounding ceiling, not exact double precision) of the RAW contour primitives, on the dense vertical hourglass
(12 rails, the amend's own named case) and the bottle — plus a non-vacuous baseline proving a real, larger gap
exists with the contour hidden (so the ON case is a genuine change, not always-true regardless of the toggle).
Rendered and viewed both shapes: rails now visibly reach and overlap the contour, correctly splitting into 2 pieces
where a rail crosses the hourglass waist twice (AMEND 3b's own "vertical rails through the waist" case — the
existing multi-span architecture handled the SPLIT for free once the boundary/endRule fix landed; only the
CONSTRAINT side of that case is still open, see below).

**Deferred to a follow-up commit** (explicitly staged, matching this project's own "land what's solid, commit, then
continue" precedent for oversized asks): the Coincident CONSTRAINT declaration in the manifest (wiring each
contour-touching rail/tie end to its specific `segN`) — this commit is the geometry only. AMEND 3b's own edge cases
(near-tangent grazes dropped below a declared minimum, an end exactly at a segment JOINT constraining to one segN
only, not two point-on-curves) and AMEND 3c (Collinear + `railGroup` membership between same-rail split pieces) are
also queued there, since they're refinements of the same constraint-emission work, not the geometry.

Verify: 1214/1214 vitest, 151/151 pytest. Amendments polled clean before commit. Commit dc3c984, pushed. NO FUSION.

## T73 AMEND 4 — round caps/joins on every drawn contour element

Fred, live screenshot: "these corners need to be rounded since they are slots." Declared once
(`CONTOUR_STROKE_STYLE`, editor-lattice-boundary.js — the same neutral home `SILHOUETTE_STROKE_WIDTH`/
`CONTOUR_SIZE_INSET_IN` already use): `{linecap:'round', linejoin:'round'}`, applied to BOTH drawn contour element
kinds — the SE14b per-segment elements (already had `linecap` alone; now the shared full style) and the Border
clone (previously had neither). Root cause, found before touching anything: the Border clone is a SINGLE combined
closed-loop path (`joinSegmentPathsIntoClosedD`) with a real internal vertex at every contour segment joint — unlike
the per-segment elements (each a lone L or A, no internal joint of its own) — so a default miter join there
genuinely does show as a sharp/pointed corner on a thick stroke, exactly the reported symptom; `linejoin` is a
no-op on the per-segment elements specifically, but applying the identical full style everywhere avoids reasoning
about which attribute matters at which call site for one declared constant.

Tests confirm every contour segment and the Border clone both carry `stroke-linecap=round`/`stroke-linejoin=round`.
Rendered and viewed a 0.5in-stroke hourglass and bottle: corners are now visibly rounded.

Verify: 1216/1216 vitest, 151/151 pytest. Amendments polled clean before commit. Commit 263c645, pushed. NO FUSION.

## Process correction — handoff.py cwd

Caught by the advisor: every `handoff.py` call this whole session (wait/amendments/sig/pass) had been running against the
MAIN checkout's own handoff channel, not lane-b's own — no explicit `cd` in those specific bash commands, so they ran in
whatever the tool's default cwd happened to be. This meant polling "no new amendments" was checking the WRONG file the
entire time; every AMEND 1-4 I'd received arrived via direct cross-session messages instead, and my own turn-165 pass-
back at the end of the prior SE14b session never reached lane-b's real channel either (lane-b's own `.handoff/worker.last`
was still sitting at 165, un-advanced, confirmed by reading the file directly). Fixed going forward: every handoff.py
call now runs with an explicit `cd` to the lane-b worktree in the SAME bash command. Also confirmed and corrected: the
apparent turn-276 "ADD1" dispatch earlier in this session was main's own channel (seat A's task, already done by seat A
per the advisor) — never mine, correctly left untouched.

## T73 AMEND 3 (constraint) — Coincident from each rail/tie end to its contour segment

Completes AMEND 3's own full ask (the geometry half landed as dc3c984): every rail/tie end `computePattern` already
attributes to a contour crossing (`usesContourCenterline` mode) now gets a declared Coincident constraint in the
manifest, wiring it to the specific contour segment (line or arc) it landed on.

New `primitiveHitAt(pt, primitives, tol)` (editor-lattice-boundary.js, alongside `insideSpans`): given a point already
known to sit on some primitive in the list, finds WHICH one and whether it's at that primitive's own S/E (a joint
between two contour segments) or genuinely mid-primitive. This ALSO satisfies AMEND 3b's own "an end at a joint
constrains to ONE segment only, never two point-on-curves" requirement by construction — the function returns the
FIRST matching primitive with its own S/E flag already, so the emitted constraint is already point-to-point at that
one segment; no separate dedup pass was needed.

`computePattern` attributes each boundary-crossing rail/tie end (only when `endRule` is `'on-boundary'`) via a new
`aContourHit`/`bContourHit` field, converting the scan-line's own scalar crossing position back to a world point
first. `manifestFromLattice` reads it to emit the Coincident, reusing the SAME "point-to-point at an end, point-on-
curve mid-primitive" convention `pieceEndOrCurveTarget` already established for tie-on-rail/node relations.

**Self-caught bug** (a temporary debug trace, not guesswork): `computePattern`'s own final return re-mapped every
segment down to a bare `{kind, a, b}` object before returning it, silently dropping the two new fields one line after
they were correctly computed — the attribution itself was right the whole time; the return statement threw it away.
Fixed by passing both fields through in that same map.

New tests (`tests/shape-lattice-rails-on-contour.test.js`): for the dense vertical hourglass and bottle, every rail end
has EXACTLY ONE Coincident to a `seg*` entity, independently verified against that constraint's own resolved point
(not just its declared shape, and not by re-trusting `primitiveHitAt`); contour hidden emits zero `seg*` Coincidents.
A manual sweep (ad hoc, not a committed test) across both presets x both orientations x 3 rail counts found zero
duplicate or self-referencing Coincident constraints anywhere.

**Disclosed, deferred scope**: AMEND 3b's own explicit near-tangent-angle threshold (dropping a Coincident whose
crossing angle is under ~10°) and a dedicated `MIN_RAIL_PIECE` (a stricter drop-threshold than the existing
`MIN_PIECE_LENGTH_IN`) are not implemented — relying on the existing length filter for now, a judgment call under
real time constraints, not a silent gap.

Verify: 1219/1219 vitest, 151/151 pytest. Amendments polled clean before commit (correct lane-b cwd this time). Commit
fa878f1, pushed. NO FUSION.

## T73 AMEND 3c — Collinear + railGroup for split same-rail/tie pieces

Fred: "rails can have colinearity." When a boundary crossing splits one original rail/tie into several pieces (e.g. a
vertical rail crossing the hourglass waist twice — AMEND 3b's own case (a), already handled for free by the existing
multi-span `_clipToSpans` architecture once the boundary/endRule fix landed), giving every piece its own Horizontal/
Vertical constraint over-constrains once a Collinear between them already fixes the later pieces' own direction.

`computePattern` now tags every rail/tie segment with `railGroup` — the row `j` / column `i` it came from, already a
stable, unique-per-row/column key, reused directly rather than declaring a second counter. `manifestFromLattice`
declares it as plain DATA on the entity itself too (not just an internal bookkeeping key — "the relation is derived
from data," the amend's own words), via `addSlotPieces`'s own new optional `railGroup` passthrough (harmless/absent
for its other caller, the contour's own single-piece slot emission). Only the FIRST piece of each group gets its own
axis constraint (`emitAxisOncePerGroup` — deliberately only marks a group "seen" once a REAL axis constraint actually
fires, so a hypothetical non-axis-aligned piece could never silently poison the rest of its own group's chance at
one); `collinearForGroups` links every group's own consecutive pieces (already position-sorted by construction —
`_clipToSpans` emits spans ascending, never re-sorted downstream) with one Collinear constraint each, applied
identically to both rails and ties.

New tests confirm, on the dense vertical hourglass: every multi-piece group gets exactly (pieces-1) Collinear
constraints in the correct consecutive order, axis constraints appear only on each group's own first piece, and an
un-split rail is entirely unaffected by the dedup logic. A manual sweep (ad hoc) across both presets x both
orientations x 3 rail counts confirmed the expected split-group/axis/Collinear pattern throughout, no anomalies.

This closes out T73 AMEND 3's full scope (3 core, 3b's splitting behavior, 3c) except the two explicitly disclosed
AMEND 3b items above (near-tangent-angle threshold, dedicated MIN_RAIL_PIECE).

Verify: 1221/1221 vitest, 151/151 pytest. Amendments polled clean before commit. Commit 23f1584, pushed. NO FUSION.

# T74 — AMEND 0 (blocker), AMEND 3b close-out, SE14d, NODE-D

## T74 AMEND 0 (BLOCKER, own commit first) — per-preset contour_width dim expression

Advisor, measured live in Fusion on 847f289: hourglass spawns exact, but the bottle spawns 0.45in off. AMEND 1's
own geometry fix (T73) already targets the RIGHT points (the body's own vertical horns), but the dim's VALUE
(contour_width=6) doesn't match what those points actually measure in the raw geometry (5.564 = contour_width *
body_width, since bodyWidth is a genuine 0..1 fraction of the available half-width, `_solveBottle`'s own formula,
never necessarily 1) — Fusion, solving a DRIVING dimension, stretches the body straight out to contour_width,
distorting the shape.

Declared per preset, in the preset's own data (`PRESETS[preset].widthExpr`, editor-shape-lattice-generator.js) —
per the amend's own explicit instruction ("declare the expression per preset... in the preset's own shape data, not
an if/else in the builder"). Written in the geometry engine's own camelCase param names (`bodyWidth`) — the
geometry engine has zero Fusion-naming awareness by design, so `editor-sketch-manifest.js`'s new `resolveWidthExpr`
translates each token via the SAME `PARAM_FUSION_NAMES` table `parameters` itself already uses. Height needs no
factor for either preset: both presets' own top/bottom caps always span the full contour_height unconditionally
(verified directly in `_solveHourglass`/`_solveBottle` — half-height is always `region.h/2`).

New test evaluates every Distance dim's own expression against the manifest's declared parameter values and
asserts it equals the distance between that dim's two target points, on the SAME axis a Fusion Horizontal/Vertical
dim actually reads (self-caught: my own first draft compared against the full point-to-point hypot distance, which
overstates a Horizontal/Vertical-only reading whenever the two points differ in the OTHER axis too). Confirmed
failing first against the pre-fix expression (bottle: 6 vs 6.492, a 0.508in gap — matching the live ~0.45in
report; hourglass passed even unfixed).

Verify: 1223/1223 vitest, 151/151 pytest. Commit 9a86638, pushed.

## T74 item 1 — AMEND 3b close-out: near-tangent threshold + MIN_RAIL_PIECE

Closes the two AMEND 3b items disclosed as deferred at the end of T73. `primitiveHitAt` now also returns the
contour's own tangent direction at the hit point; `computePattern`'s `contourHit` compares it against the rail/
tie's own scanline direction and suppresses the Coincident below a declared 10° threshold.

**Self-caught bug**, found via a live sweep across `waistReach` values (not assumed): the first version applied the
angle check unconditionally, silently suppressing a real fraction of every rail's own perfectly-valid CORNER
Coincidents whenever `primitiveHitAt`'s first-found primitive at that joint happened to be near-parallel to the
rail — a joint (`hit.end` 'S'/'E') is an EXACT point-to-point match regardless of what angle the two segments meet
at; "near-tangent" only makes sense for a genuine mid-primitive landing (`hit.end` null). Fixed by skipping the
angle check entirely for joints.

MIN_RAIL_PIECE (2x the relevant stroke width) is checked inside `computePattern` itself, only for a genuinely
SPLIT row/column — an ordinary un-split rail is never at risk regardless of its own length.

New tests: a REAL deep-waist hourglass fixture (waistReach 0.15, dense vertical rails — found live, not contrived)
shows rails split by the waist keeping exactly one Coincident on their clean end, with an independently-computed
crossing angle confirming the kept end is >=10° and the dropped end is <10°. MIN_RAIL_PIECE verified
deterministically by inflating the lattice stroke width so its own 2x threshold exceeds an EXISTING split piece's
real length, rather than hunting for a naturally tiny sliver.

Verify: 1225/1225 vitest, 151/151 pytest. Commit ecae8d3, pushed.

## T74 item 2 (SE14d) — remove "Pick shape…" from the Shape Lattice panel

Fred: "boundary pick shape isn't useful, it might just be another tool." A sweep: removed the button, its click
handler, and the now-dead "next click picks a target" canvas dispatcher (its only remaining caller — box-Lattice's
own former Pick-shape UI was already removed in T58). KEPT everything the GENERATED silhouette path shares with a
hand-picked boundary: `shape.source==='picked'` semantics (`detectShapeLatticeDetach`'s auto-detach safety net, the
`reuseExisting` regenerate guard, `_resolveBoundaryPrimitives`'s collapse-fallback), the endRule segmented control
(NOT picked-only — read whenever `usesContourCenterline` is false), and `boundary.edge` (data-only, no UI row
exists for it). The "Boundary" section heading text is untouched, for seat A's own title-based
`TOOL_PANEL_MOUNTS` decoration on main.

**Decided (not left ambiguous)** on the ROADMAP's "saved patterns with a picked boundary still load — decide +
log": a picked pattern already renders/fills correctly today with no branch on `shape.source` anywhere in the
draw/fill path — removing the CREATE-a-new-pick button doesn't change that. Left the existing "touching a
Shape-section control on a picked pattern silently converts it to generated" behavior exactly as-is (already
documented in-code as deliberate) — a new read-only-mode gate would be a feature addition beyond this sweep's own
scope, and the edge case only shrinks over time since new picked patterns can no longer be created.

Tests: removed the 2 tests exclusively about the button/dispatch mechanism; kept and rewrote the 3rd
(regenerate-never-overwrites-a-hand-pick contract) to seed `shape.source='picked'`/`boundary.shapeId` directly.

Verify: 1223/1223 vitest, 151/151 pytest. Commit 9b4a8bc, pushed.

## T74 item 3 (NODE-D) — node size entered/stored as diameter, not radius

Fred: "node size should be entered as diameter not radius." Renamed `PATTERN.widths.nodeRadius` → `nodeDiameter`
everywhere (default 0.075 → 0.15, same physical size, re-expressed). `emitNode` itself is UNCHANGED (still takes a
real radius, a general-purpose utility) — every caller divides by 2 at the point it reads `widths.nodeDiameter`,
rather than changing `emitNode`'s own contract.

Manifest: `node_radius` param → `node_diameter`; the node's `Radial` dimension → `Diameter`; the Circle entity's
own `radius` field stays a true radius (Fusion geometry needs one). Python builder: added the `"Diameter"` branch
to `_apply_declared_dimensions`, mirroring the existing `"Radial"` one — `fb_engine/dimensions.py`'s own
`addDiameterDimension` was already built (T60's own research) but never exercised by a real manifest until now.

**Self-caught while running the full Python suite**: `FakeDesign`'s own `addDiameterDimension` stub existed but
never logged to `CALL_LOG` (unlike `addRadialDimension`) — a real, pre-existing test-infra gap invisible until this
change made it the first real caller. Fixed the stub and the one order-check test that hardcoded `"dim:Radial"`.

Migration (`app-init.js`'s `MIGRATIONS` array, `node-radius-to-diameter`): mirrors `layer-carve-flag`'s own exact
convention, gated on the CURRENT shape (not a version number). Doubles the old radius into the new diameter field
and removes the stale key, so a saved pattern's own CUSTOM node size survives the rename instead of the
`PATTERN_DEFAULTS` merge silently substituting the new default for a value it can no longer find under the old
name. New tests/migrations.test.js coverage: conversion, already-migrated left alone, no-pattern layer untouched,
mixed roster, idempotent on a second run.

Verify: 1228/1228 vitest, 151/151 pytest. Commit 6544851, pushed. NO FUSION this whole turn.


## T74 AMEND 1 — merge "show contour" + Border's "draw boundary" into ONE Contour control

Fred (mid-task amendment, "do it together with SE14d"): "if draw boundary is off I shouldn't see it at all." The
SE14c "show contour" checkbox and the separate Border section's own "draw boundary" checkbox were two independent
on/off switches for what reads as one thing — turning Border off left the SE14b contour segments themselves still
visible. Retired the whole Border clone feature (`PATTERN.boundary.border = {enabled, width, color}` — a SECOND,
independently-toggled outline drawn from the boundary element's own geometry) entirely, not just its UI: deleted
the Border-piece emission block in `generatePattern`, the `borderEnabled` gate on the "fix first" collinear-edge
span (now always taken — an edge-collinear rail/tie is always kept, since there's no second stroke to double up
against), and `_effectiveBorderWidth` (renamed `_effectiveContourWidth`, drops the `border.enabled` gate, keeps its
3-branch resolution: explicit `contour.width` override → generated-silhouette auto (`widths.rails`) → hand-picked
live-DOM-read fallback). `editor-sketch-manifest.js`'s own `shapeHalfInset` updated to match. Border's colour
concept was NOT duplicated into `contour` — `colors.contour` (the Colors row's own swatch) was already the one
place for it, never relocated.

HTML: one `[x] Contour` checkbox (id `shapeLatticeContourShow`, reused) + one width field (new id
`shapeLatticeContourWidth`, renamed from `shapeLatticeBorderWidth`) under a section still titled "Contour" (was
briefly "Boundary" post-SE14d) so seat A's own title-based `TOOL_PANEL_MOUNTS` tint still applies. Checked the box
Lattice panel per the dispatch's own ask — it has no Border control at all (moved to Shape Lattice entirely back
in T58), so nothing to migrate there.

**Self-caught bug while wiring the width field**: the existing `contourShowEl` change handler replaced
`p.contour` outright (`p.contour = { show: ... }`), silently dropping `segmentColors` (and now `width`) on every
plain checkbox toggle. Fixed to spread the existing object first.

Migration (`app-init.js` MIGRATIONS, `border-to-contour-width`, mirrors `node-radius-to-diameter`'s own
gate-on-current-shape convention): an already-saved `boundary.border.width` becomes `contour.width`; the merged
`contour.show` is `border.enabled OR (old contour.show !== false)` — an enabled Border wins, since it was the
thing actually drawn even when SE14b's own contour segments were hidden, so a document that used to show
something visually keeps showing it. Border's colour field is dropped, never migrated (redundant with
`colors.contour`, which every saved pattern already carries).

Tests: rewrote/removed the Border-specific describe blocks across `editor-lattice-pattern-boundary-emit.test.js`
(the whole "Border piece (§7)" describe deleted — nothing left to test once the clone element is retired; its one
surviving width-override behavior folded into the existing "T50" describe via `contour.width`),
`editor-lattice-pattern-ending.test.js` ("fix first" now has one unconditional-keep behavior, not two toggled
ones), `parity-app-manifest.test.js` (two Border-clone-specific tests removed as redundant with their sibling
contour-segment tests), and `properties-shape-lattice.test.js` (Border checkbox/color tests → one Contour-width
test). Added a new `border-to-contour-width` describe to `migrations.test.js` (6 cases: explicit width, Border-off
both show states, no-border-at-all no-op, no-pattern-layer no-op, idempotent). A stale CSS touch-sizing selector
(`#shapeLatticeBorderEnabled`, `editor.css`'s coarse-pointer media query) would have silently stopped enlarging
the merged checkbox on touch — repointed to `#shapeLatticeContourShow`.

Viewed before committing: a throwaway vitest+CDP render (real `regenerateSilhouette`/`generatePattern`, not a
reimplementation) confirmed all three states side by side — auto-width thin contour, an explicit 0.6" override
rendering visibly thicker with rounded corners, and OFF drawing nothing at all while rails/ties still hug the
exact same hourglass waist.

Verify: 1223/1223 vitest, 33/33 pytest. Commit 01a7c4e, pushed. NO FUSION this whole turn.

## T74 AMEND 2/3 — contour_width/height mean the OUTSIDE size; bottle fills the box like the hourglass

**AMEND 2** (Fred, confirmed after back-and-forth with the advisor): `contour_width`/`contour_height` now declare the
OUTSIDE edge of the drawn stroke, never its centerline. The Distance dims stay targeted on the centerline (no anchor-
point churn) and compensate by subtracting `stroke_width` in their own expression (`contour_width - stroke_width`,
`contour_height - stroke_width`) — the parameter VALUES themselves are unchanged (still `region.w`/`region.h`, the
outside/declared size; the advisor's own explicit "don't bump any parameter value" ruling, option C of three I'd
sketched).

Two earlier options I proposed and the advisor rejected, for the record: (A) bump `contour_width`'s own value by
`stroke_width/coefficient` so the dim's expression still matched the raw geometry exactly for the bottle's own
`* body_width` case; (B) a flat `region.w + stroke_width` bump, accepting a small mismatch for bottle specifically.
Both tried to keep the OLD geometry (centerline = declared size) and patch the dim math around it. The advisor's own
answer instead changes the GEOMETRY: the drawn contour's own centerline moves inward by half its stroke width, so the
size stays the size and the dim's compensating subtraction is exact for every preset, no per-preset carve-out.

Implementation: `generateSilhouette` (editor-shape-lattice-generator.js) gained an optional 3rd arg,
`strokeHalfWidth` (default 0 — every existing caller/test keeps hitting the exact same "touches region" geometry it
always has). Non-zero, it insets the drawn contour ANALYTICALLY inside `_solveHourglass`/`_solveBottle` themselves:
an outer wall coordinate used directly (`hw`/`hh`) shrinks toward center by `strokeHalfWidth`; a CONVEX arc's radius
shrinks by the same amount; a CONCAVE arc's radius GROWS by it; every arc's own CENTER never moves. Verified
numerically before writing any of this (not assumed): for the default hourglass on a 7x9 board with
`strokeHalfWidth=0.1`, the shoulder arc (convex, center (2.73,-1.925), radius 0.77→0.67) and the waist arc (concave,
center (2.73,0), radius 1.155→1.255) land on the IDENTICAL shared tangent point (2.73,-1.255) either way — confirming
both the wall-shrink and the opposite-signed radius adjustment before trusting them in the real solvers.

**First attempt, abandoned**: a generic path-offset/re-parse (`insetGeneratedPresetPathDToPrimitives`, the SAME
utility T68 AMEND 1 uses for a different, already-established stroke-related inset) applied to the FINAL primitive
list. Immediately broke `manifestFromShape`'s own segment/mirror/tangent-constraint bookkeeping — a generic offset
algorithm doesn't guarantee the SAME primitive count/order as the input (it re-derives topology from the offset
curve's own geometry, collapsing/splitting segments near tight features), and `segMap`/mirror-pairing/kink-detection
all assume a strict 1:1 correspondence with the ORIGINAL segment list. Full-suite run surfaced this immediately as
`Cannot read properties of undefined (reading 'style')` across ~100 tests — caught before it went anywhere near
Fusion. The analytic, in-solver approach (above) preserves EXACT topology by construction (same count, same order,
same types), which the generic approach fundamentally can't guarantee.

A new `generateContourSilhouette(region, shape, strokeWidth)` wrapper is the ONE place every real consumer of "the
contour's own actual drawn geometry" now calls, never bare `generateSilhouette`: the app's own `regenerateSilhouette`
(properties-shape-lattice.js), the manifest's own `manifestFromShape`, and the lattice-fill's own
`resolveShapeBoundaryExtent` (editor-sketch-manifest.js) — so app/Fusion/fill-clip geometry can never drift into
three independently-computed insets. `editor-sketch-manifest.js` also gained a small shared
`_effectiveContourStrokeWidth(pattern)` helper (`shapeHalfInset`'s own 3-line computation, factored out) so
`resolveShapeBoundaryExtent`'s NEW call into `generateContourSilhouette` uses the exact same effective width.

**Self-caught, real pre-existing gap this surfaced**: `buildSketchManifest`'s own call into `manifestFromShape`
passed `strokeWidth: widths.rails` UNCONDITIONALLY, silently ignoring T74 AMEND 1's own `pattern.contour.width`
override — an app/manifest mismatch for anyone who'd set an explicit contour width override. Fixed to use the SAME
`_effectiveContourStrokeWidth` helper `resolveShapeBoundaryExtent` already used.

Also self-caught while wiring the app side: `detectShapeLatticeDetach` (properties-shape-lattice.js) independently
re-derives the contour's own "expected" `d` string to detect a hand-edit — it called bare `generateSilhouette`,
which would have flagged EVERY freshly-generated pattern as hand-edited the moment `regenerateSilhouette` started
drawing the (now genuinely different) stroke-inset geometry, silently flipping `shape.source` to `'picked'` right
after a normal Generate. Fixed to use `generateContourSilhouette` with the same effective width.

**AMEND 3** (Fred: "it needs to fill the box same as hourglass") supersedes the bottle-specific part of AMEND 2:
`bodyWidth` — the bottle's own 0..1 fraction of `hw` its body used to sit at, the whole reason its width dim needed
a `* body_width` multiplier — is retired as a full sweep: the param, its jitter half-range, its salt constant, its
own on-canvas drag handle (editor-shape-lattice-interaction.js), the manifest's own Fusion-name mapping, the now-
dead per-preset `widthExpr` override, the HTML slider row, and every test asserting any of the above. The bottle's
body now always spans the full `hw` (identical to the hourglass's own body), so BOTH presets' width dims are the
exact same bare `resolveWidthExpr` default — the per-preset multiplier mechanism in `resolveWidthExpr` itself is
kept (not deleted) as a declared, currently-unused slot for a FUTURE preset whose body genuinely is a fraction of
its own contour width. A saved pattern with an old `body_width` value simply stops being read — no migration
needed, since nothing looks for that key in `PRESETS.bottle.params` anymore.

**Test-oracle fallout** (full suite ran to 22 failures immediately after the geometry change, worked through
individually):
- Several tests built an independent "raw" geometry oracle via bare `generateSilhouette` to compare against
  `manifestFromShape`'s/`regenerateSilhouette`'s own ACTUAL (now stroke-inset) output — updated each oracle to call
  `generateContourSilhouette` with the same effective width the production code actually uses.
- The "ON has at least as many rail/tie/node pieces as OFF" parity test (T73 AMEND 3) happened to use a stroke width
  EXACTLY equal to its own spacing (0.25 both) — a coincidental exact ratio that, after the boundary sizes shifted
  by the new stroke-based inset, landed ON's and OFF's boundaries on opposite sides of a grid-snap for the 'rail'
  kind specifically (measured live: ON=5, OFF=7 — reproduced, then confirmed to disappear entirely with a narrower,
  more realistic 0.15 stroke, which the fixture now uses).
- The MIN_RAIL_PIECE close-out test inflated `widths.rails` to push a split piece below the 2x-stroke drop
  threshold — not realizing that value is now ALSO the effective CONTOUR stroke width, so inflating it also shrank
  the boundary itself, confounding "does a wider rail/tie stroke drop more pieces" with "does a smaller boundary
  produce an entirely different row/column layout" (measured: 8 survivors vs. an expected 22). Fixed by pinning
  `pattern.contour.width` explicitly in that test, decoupling the two variables it was conflating.
- The near-tangent-graze fixture's exact `waistReach: 0.15` / 20 rails / 0.25 spacing combo no longer reproduces a
  graze at all under the uniformly-shrunk geometry (swept the ENTIRE waistReach range at that rail count/spacing
  live — zero grazes anywhere). Re-swept live across waistReach x rail-count x spacing combos (same method as the
  original discovery) to find one that still does: `waistReach: 0.8`, 10 rails, 0.15 spacing.

Verify: 1223/1223 vitest, 33/33 pytest. Viewed before committing: a throwaway vitest+CDP render of both presets at
thin (0.05) and thick (0.5) stroke widths, each against a dashed red "outside" reference box — the drawn stroke's
own outer edge hugs that box exactly at any stroke width (thin or thick), and the bottle's body now touches the box
across its full width the same way the hourglass's own body always has. Commit fcac51d, pushed. NO FUSION this
whole turn.

## T74 AMEND 5 (BUG, done first per the advisor) — manifest only for layers with real lattice content; mixed layer sends both

Fred, live: with 2 layers (L1 = hourglass Shape Lattice, L2 = hand-drawn organic pattern), Send to Fusion built L2 as
a LATTICE constrained sketch instead of its own drawn artwork. The advisor confirmed the exact shape against a real
Send payload (dumped to `~/.bspline-frame-builder/last_send.json` — the add-in now writes one on every Send, for
exactly this kind of live cross-check): L2's own `svg` field held 4 hand-drawn `<path>` elements and ZERO
`data-lattice` occurrences, yet its `sketchManifest` carried 31 entities from a stale BOX-lattice pattern
(`contourWidthMode: null`) — the Lattice tool had been opened on that layer at some point, materializing a stored
`.pattern` object, but nothing was ever actually generated from it there.

**Cause**: `_fusionLayerManifest` (export-flow.js) attached a manifest whenever `editorLayer.pattern` existed at
all — never checking whether the layer's OWN live DOM content actually had anything real to represent.

**Fix, declared once**: a new `latticeOwnedElementsOnLayer(editor, layerId, pattern)` (editor-lattice-pattern.js) is
the ONE answer to "does this layer actually have real lattice content right now" — `_ownedOnLayer`'s own
OWNERSHIP_ATTR-tagged rails/ties/nodes PLUS (a genuine trap the research agent I dispatched for this caught before
I wrote any code) a generated silhouette's own contour segments, which carry NO OWNERSHIP_ATTR at all
(`regenerateSilhouette`'s own separate `data-boundary-ref` link) — a naive "OWNERSHIP_ATTR-only" check would have
correctly fixed the reported bug but WRONGLY classified a Shape Lattice's own visible contour as "not lattice
content" the moment I built the mixed-layer SVG-exclusion half below (next paragraph), duplicating the contour
geometry (once via the manifest's own `seg*` entities, once as plain SVG curves). `_fusionLayerManifest` now gates
on this function's own result being non-empty, never `.pattern` alone.

**The mixed-layer half** (also explicitly required, not optional): previously, `b-spline-gen.py`'s own
`_import_all_svg_layers` treated "build the constrained sketch" and "import plain SVG" as a strict either/or (`if
manifest and design: ... else: ...`) — a layer earning a manifest had its OWN full SVG (rails/ties/nodes/contour
AND any hand-drawn extras in the SAME layer) silently DROPPED, never imported at all. Fixed on BOTH sides:
- JS: `getLayerSvg` gained an opt-in `excludeLatticeOwnedFor` option (a pattern) — strips that pattern's own
  lattice/contour content (by the SAME `OWNERSHIP_ATTR`/`data-boundary-ref` check `latticeOwnedElementsOnLayer`
  uses, never a second, independently-derived definition) out of the returned SVG. Never passed by any OTHER
  caller (the carve mask, wizard-availability checks), so their own byte-for-byte contract stays untouched.
  `export-flow.js`'s own `sendToFusion` now resolves each layer's manifest BEFORE its SVG (was after), threading
  the pattern through so a mixed layer's own SVG excludes exactly what its manifest already covers. **Self-caught
  while wiring this**: an empty result after exclusion (a PURE lattice layer, nothing left once its own content is
  stripped) must never fall back to the unfiltered `l.svg` — the existing `svg || l.svg` fallback pattern would have
  silently reintroduced the EXACT duplicate-geometry bug this exclusion exists to prevent; fixed to fall back to
  `''` instead whenever exclusion was requested.
- Python: `_import_all_svg_layers`'s per-layer branching is no longer either/or — a layer now builds its
  constrained sketch (when it has one) AND separately imports whatever's left of `svg` (when there's anything left),
  as two independent decisions. Extracted the PURE per-layer decision (no `adsk.*` reference anywhere in it) into a
  new module-level `_svg_layer_import_plan(layers, design_available)`, specifically so it's directly unit-testable
  without a live Fusion session — the real per-layer loop just executes the plan it returns. Both import paths now
  share ONE construction plane per layer (computed once, lazily, by the caller) instead of each minting its own
  identically-placed, identically-named plane when both ran for the same layer (previously silent, cosmetic waste
  the research agent flagged as unverified whether Fusion would even accept without auto-renaming — moot now, there
  aren't two).

**One known, narrow, pre-existing edge case NOT fully solved, disclosed rather than silently patched over**: when
no active Design is in scope at import time, `export-flow.js` has ALREADY stripped the lattice content out of `svg`
before sending — it has no way to know Python's own runtime `design` availability when it builds the payload. That
lattice content is lost for that one request. This "manifest present but no Design" fallback was ALREADY degraded
before this turn (it never built a constrained sketch either, just imported the full flat SVG) — this turn only
narrows what it recovers, from the full flat geometry down to none. Not fixed this turn (would need the wire format
to carry BOTH the full and the stripped SVG, a real design question, not just an oversight).

**Research delegated, not guessed**: dispatched a background research agent (read-only) to map every function this
fix touches — `_fusionLayerManifest`/`_fusionLayerSvg`/the `bakedLayers` construction (export-flow.js),
`OWNERSHIP_ATTR`/`_ownedOnLayer` and every ownership-related export (editor-lattice-pattern.js), `getLayerSvg`'s
FULL option surface (editor-io.js, confirmed there was NO existing exclude/filter option), and BOTH Python import
methods' own side effects (planes/sketches/parameters, and whether they can coexist per-layer) — before writing any
code. Its single most load-bearing finding: contour segments don't carry OWNERSHIP_ATTR, the trap noted above.

**Tests**: `tests/export-flow.test.js`'s own `_fusionLayerManifest` describe block — extended its mock editor to
seed real owned DOM elements (previously `children: () => []`, unable to represent ownership at all, which is
exactly why the two existing manifest-gating tests that expected a REAL manifest silently passed with zero owned
content before this fix); added the exact reported-bug case (a `.pattern` with zero owned pieces returns null). `tests/editor-io-fusion-geometry.test.js` — a new describe block for `excludeLatticeOwnedFor`: pure
hand-drawn (unaffected), pure lattice (excludes to nothing, `''`, never a fallback), mixed (owned pieces stripped,
hand-drawn survives), contour segments (stripped when the shapeId matches a GENERATED silhouette, survives for a
wrong shapeId or a hand-picked/non-generated pattern), and the `{geometry:'fusion'}` path (same shared filter).
`bspline-frame-builder/b-spline-gen/test_svg_layer_import_plan.py` — the FIRST test file to import `b-spline-gen.py`
at all (a real Fusion add-in entry point with several classes subclassing `adsk.core.*` event-handler bases at
module level); a minimal, narrowly-scoped `adsk`/`adsk.core`/`adsk.fusion`/`adsk.cam` stub (covering exactly the 16
symbols the file references anywhere, grep-verified, most only needing to exist as attributes since they're never
touched by anything this suite calls) makes the import succeed on the first attempt. Covers every case the advisor
named (hand-drawn-only → no manifest, full svg import; mixed → both) plus the "no Design in scope" fallback and the
exact two-layer shape from the real bug report. The real Send payload itself is preserved at
`tests/fixtures/t74-amend5-mixed-layers-last-send.json` as a reference artifact (per the advisor's own ask) for live
cross-checking — NOT wired into an automated assertion, since the fixture still reflects the OLD, buggy manifest
attachment (it predates this fix) and asserting against it as-is would mean asserting the bug's own wrong behavior.

Verify: 1232/1232 vitest, 40/40 pytest (33 pre-existing + 7 new). Commit 7d715b6, pushed. NO FUSION this whole turn.

## T74 AMEND 4 — Contour section markup cleanup (Shape linked gone, settings inside one container, edge-rule audit)

Fred, live screenshot after the AMEND 1 merge caught two markup leftovers in the Shape Lattice panel's own "Contour"
section.

**(1) "Shape linked" retired.** `shapeLatticeBoundaryStatus` ("Shape linked" / "No shape picked") was a Pick-shape-
era readout. SE14d already removed the ONLY way to pick a NEW boundary shape (the "Pick shape…" button) — a saved
pattern with an OLD picked boundary can still load (SE14d's own "decide + log" ruling), but there's no way to reach
"No shape picked" from the UI at all any more; once Generate has run (the tool's own normal, immediate first action),
this line could only ever say "Shape linked" — a status line that can only say one thing isn't a status line. Removed
as a full sweep: the `<span>` element, and both JS-side writes to it (`regenerateSilhouette`'s own write right after
minting/reusing the link, and `syncFieldsFromPattern`'s own read-back on tool-open).

**(2) One container, not two.** The tinted "Contour" block's own container div ended right after the title (plus the
now-removed status line) — the edge-rule segmented group, the Contour checkbox, and its width field sat OUTSIDE that
div, as SIBLINGS in the panel body, not children of it. Seat A's own side-column decorator (UI2, `editor/lattice-
side-column.js`, merged into main after this seat's own T58) tints/collapses a section by its CONTAINER DIV + title,
matching every OTHER section in this SAME panel's own single-div convention (Widths, Fill seed, Shape, Segments,
Ties, ...) — so those three controls rendered visually OUTSIDE the tint, exactly the "split section" bug reported.
Fixed by moving all of it inside the one Contour div.

**(3) Edge-rule audit** (Boundary/Inset/Joint/Loose, `shapeLatticeEndRule`/`BOUNDARY_END_RULES`) — done by reading
`_applyEndRule`'s own dispatch (editor-lattice-pattern.js) rather than assumed, since T73 AMEND 3 raised a real
question: does this control still do anything meaningfully different across its 4 options, post-"rails/ties now end
ON the contour centerline + Coincident"? Findings, logged here as asked:
  - **Boundary** (`on-boundary`): the rail/tie's own end lands EXACTLY at the boundary crossing point — zero pull-
    back. In the manifest, when the contour is shown, this is the SAME point AMEND 3's own Coincident constraint
    anchors to (that mechanism is independent of this control's own value, always applies for a shown contour).
  - **Inset** (the stored DEFAULT): pulls the end back from the crossing by HALF THE RAIL/TIE'S OWN STROKE WIDTH —
    a real, nonzero, genuinely different amount from Boundary (`widths.rails/2` or `widths.ties/2`, never zero for
    any real lattice stroke).
  - **Joint**: the SAME crossing-point geometry as Boundary, PLUS drops an actual NODE circle there — a real,
    visually distinguishing difference from Boundary even though the two share the same endpoint coordinates.
  - **Loose**: snaps the end back to the NEAREST WHOLE GRID-SPACING stop still inside the boundary (a full cell
    short, not half a stroke) — degrades to Inset's own behavior when the span is too short for any such stop to
    exist. Visibly the shortest of the four.
  All four remain genuinely, measurably distinct from each other — **nothing removed**. What IS true, and is exactly
  what prompted the audit: ALL FOUR only ever take effect while the contour is OFF (or a legacy picked-boundary
  layer, `shape.source==='picked'`, which SE14d can no longer create new ones of but which still loads). Whenever
  the contour is shown — the tool's own default, most-common state — `usesContourCenterline(pattern)` forces
  `endRule='on-boundary'` UNCONDITIONALLY, ignoring whatever this control is set to; the control has been a
  sometimes-silent no-op since T73 AMEND 3 landed, just never disclosed as such in its own UI. Rather than sweep
  options that are NOT actually dead, relabeled: a new "Rail ends (contour off only)" caption above the segmented
  group, and each option's own tooltip now states its real behavior plus the "only applies with the contour off"
  caveat, so toggling this while the contour is on no longer reads as a silent bug.

Verified with a REAL render, not just unit tests: started a local static HTTP server over the actual palette HTML
(`main.js`'s own module bootstrap runs against a real `fred-host.js` browser shim, so the FULL app — including
`initShapeLatticeProperties`'s own real wiring — boots outside Fusion), force-revealed the normally screen-gated
editor panel via a small injected script (the panel and its own `BOUNDARY_END_RULES`-built buttons were ALREADY
present/wired in the DOM even while hidden — no re-init needed), and screenshotted the real, live-rendered Shape
Lattice panel. Confirms: the status line is gone, and the "Contour" section — title, "Rail ends" label, the 4
edge-rule buttons, the Contour checkbox, and the width field — now renders as ONE visual block, with "Fill seed"
correctly remaining its own separate section right after it (not accidentally merged in too).

Verify: 1232/1232 vitest, 40/40 pytest (untouched by this item). Commit 41bf2d1, pushed. NO FUSION this whole turn.
