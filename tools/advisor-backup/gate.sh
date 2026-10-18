#!/bin/bash
# Advisor merge gate (declared once, reused for every merge).
# Usage: bash gate.sh <ref>...   -- detaches adv-merge at origin/main, merges each ref, runs the full gate,
# pushes main + the lucid-ride mirror on green, then fast-forwards Fred's checkout.
# Gate = vitest (failed/timed-out files re-run alone) + pytest (bspline-frame-builder, root) + gen_frame_defs --check
#        + check_golden_freshness --check + brick-matrix --parallel (failing groups re-run alone before deciding).
WT=/c/Users/danse/APPS/b-spline-generator-web-addin-wt/adv-merge
FRED=/c/Users/danse/APPS/b-spline-generator-web-addin
BM=/c/Users/danse/AppData/Local/Temp/bm
# heavy-run lock (2026-10-07, PC ran out of RAM with gate + seat full runs): seats start no full vitest / matrix while this file exists
# shared heavy-run lock with Fred's DDCS project (2026-10-08): wait while theirs exists (stale = >3 h old)
# TIERS (2026-10-11, Fred; modelled on DDCS context/VERIFICATION.md): unit tier (vitest + pytest + defs/golden) ALWAYS;
# matrix = TARGETED (--groups a,b: only those groups, named by the seat, checked by the advisor) or FULL. FULL is forced
# when the merge touches CORE_PATHS, every FULL_EVERY-th merge, and with --full (use before a Fusion deploy).
MATRIX_GROUPS=""; FORCE_FULL=0
while [ "${1#--}" != "$1" ]; do case "$1" in --groups) MATRIX_GROUPS=$(echo "$2" | tr ',' ' '); shift 2;; --full) FORCE_FULL=1; shift;; *) echo "unknown option $1"; exit 2;; esac; done
CORE_PATHS='^bspline-frame-builder/b-spline-gen/html/(core/(bricks/|terrain|history|noise/|photo/)|main/(app-init|snapshot-manager|export-flow|loading-signal)|editor/editor-(io|history|brick-height-mask))|\.py$|^tools/brick-matrix/(run|boot|_shared)'
FULL_EVERY=5; TIER_COUNT=~/.bspline-status/advisor/tier_count
DDCS_LOCK=~/.ddcs-status/gate_running
while [ -f "$DDCS_LOCK" ] && [ -n "$(find "$DDCS_LOCK" -mmin -180 2>/dev/null)" ]; do echo "waiting for DDCS: $(head -1 "$DDCS_LOCK")"; sleep 60; done
# seat probe locks (2026-10-11, seat A's blind runs were spoiled by a gate starting mid-run): a seat running a timing-
# sensitive probe writes ~/.bspline-status/probes/<seat> and deletes it after; the gate waits (stale = >45 min old)
mkdir -p ~/.bspline-status/probes
while [ -n "$(find ~/.bspline-status/probes ~/.ddcs-status/probes -type f -mmin -45 2>/dev/null)" ]; do echo "waiting for probes: $(ls ~/.bspline-status/probes | tr '
' ' ')"; sleep 30; done
# shared CPU lock with DDCS (Fred 2026-10-15): DDCS's pre-migration runner lock, then the shared atomic lock
while [ -e "$TEMP/ddcs-playwright-runner.lock" ] || [ -e /c/Users/danse/AppData/Local/Temp/ddcs-playwright-runner.lock ]; do echo "waiting for DDCS runner lock"; sleep 60; done
source ~/.shared-cpu/cpu_lock.sh; cpu_lock_take bspline "gate $*" "~25min"
LOCK=~/.bspline-status/gate_running; echo "$(cat /proc/$$/winpid) $(date +%H:%M) $*" > "$LOCK"; trap 'rm -f "$LOCK"; cpu_lock_release bspline' EXIT
export BSPLINE_GATE_LOCK_OWNER=$(cat /proc/$$/winpid)   # heavy-run-guard (seat A 96fe408) lets the gate's own runs through
# low priority (Fred 2026-10-08, PC slow during gates): Windows children inherit the priority class of this bash
powershell -NoProfile -Command "(Get-Process -Id $(cat /proc/$$/winpid)).PriorityClass = 'BelowNormal'" >/dev/null 2>&1
cd "$WT" || exit 2
git fetch -q origin
git checkout -q --detach origin/main || { echo CHECKOUT_FAIL; exit 2; }
for ref in "$@"; do
  if ! git merge -q --no-edit "$ref" >/dev/null 2>&1; then
    # declared rule (ADVISOR-HANDOFF section 5): work logs keep both sides; any other conflict stops the gate
    other=$(git diff --name-only --diff-filter=U | grep -v -E '^WORK-LOG[^/]*\.md$')
    if [ -n "$other" ]; then echo "MERGE_FAIL $ref: $other"; git merge --abort; exit 2; fi
    for f in $(git diff --name-only --diff-filter=U); do
      python - "$f" <<'EOF'
import re, io, sys
p = sys.argv[1]; s = io.open(p, encoding='utf-8').read()
s = re.sub(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', lambda m: m.group(1) + m.group(2), s, flags=re.S)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
EOF
      git add "$f"
    done
    git -c user.name=Frederic commit -q --no-edit && echo "$(git rev-parse --short "$ref") merged with work-log union"
  fi
done
core_hit=$(git diff --name-only origin/main...HEAD | grep -E "$CORE_PATHS" | head -3 | tr '
' ' ')
n=$(cat "$TIER_COUNT" 2>/dev/null || echo 0)
TIER=targeted; why=""
[ -z "$MATRIX_GROUPS" ] && { TIER=full; why="no --groups"; }
[ "$FORCE_FULL" = 1 ] && { TIER=full; why="--full"; }
[ -n "$core_hit" ] && { TIER=full; why="core: $core_hit"; }
[ "$n" -ge $((FULL_EVERY - 1)) ] && { TIER=full; why="every $FULL_EVERY merges"; }
echo "TIER $TIER${why:+ ($why)}${MATRIX_GROUPS:+ groups: $MATRIX_GROUPS}"
python ~/.bspline-status/advisor/board.py pc "{\"holder\":\"bspline\",\"what\":\"$TIER gate: $*\",\"since\":$(date +%s)000}" >/dev/null 2>&1 || true
trap 'rm -f "$LOCK"; cpu_lock_release bspline; python ~/.bspline-status/advisor/board.py pc-clear >/dev/null 2>&1' EXIT
for ref in "$@"; do
  sha=$(git rev-parse --short "$ref")
  if git merge-base --is-ancestor "$ref" HEAD; then echo "$sha in HEAD"; else echo "$sha NOT in HEAD"; NOT_MERGED=1; fi
done
# a ref that silently failed to merge must stop the gate (2026-10-14: ac1bd81 was skipped and the rest PUSHED)
[ -n "$NOT_MERGED" ] && { echo "MERGE_FAIL: a ref is NOT in HEAD"; exit 2; }

# board phase reporter (display only): GATE_PHASES = declared % at each phase start
GATE_T0=$(date +%s)000
gate_phase() { python ~/.bspline-status/advisor/board.py pc "{\"holder\":\"bspline\",\"what\":\"$TIER gate: $1\",\"pct\":$2,\"since\":$GATE_T0}" >/dev/null 2>&1 || true; }
gate_phase "unit tests (vitest)" 5
# 1. vitest; failed / timed-out files get one re-run alone
npx vitest run > "$BM.vitest.log" 2>&1; vrc=$?
[ "$vrc" != 0 ] && mkdir -p ~/.bspline-status/advisor/failed-logs && cp "$BM.vitest.log" ~/.bspline-status/advisor/failed-logs/vitest-$(date +%Y%m%d-%H%M%S).log
# + files whose fork worker never started under load (2026-10-09: 8 files never ran, the re-run skipped them, PUSHED)
failed=$( { grep -oE "FAIL +tests?/[^ >]+" "$BM.vitest.log" | awk '{print $2}'; grep -oE "Failed to start forks worker for test files [^ ]+" "$BM.vitest.log" | sed -E 's#.*/(tests?/[^ ]+)$#\1#; s#\.$##'; } | sort -u)
nf=$(printf '%s\n' "$failed" | grep -c .)
rr=0
if [ "$vrc" != 0 ] && [ "$nf" -gt 0 ]; then
  # shellcheck disable=SC2086
  npx vitest run $failed > "$BM.vitest_rerun.log" 2>&1; rr=$?
fi
vsum=$(grep -E "^\s*Tests\s+[0-9]" "$BM.vitest.log" | tail -1 | tr -s ' ')
# vitest that never started (broken node_modules link, missing module) is a SETUP failure, not a test failure
[ "$vrc" != 0 ] && [ "$nf" = 0 ] && echo "VITEST_SETUP: $(grep -m1 -E "Error" "$BM.vitest.log")"
vok=0; if [ "$vrc" = 0 ] || { [ "$nf" -gt 0 ] && [ "$rr" = 0 ]; }; then vok=1; fi

gate_phase "pytest" 40
# 2. pytest, both roots
(cd bspline-frame-builder && python -m pytest -q > "$BM.pytest1.log" 2>&1); p1rc=$?; p1=$(tail -1 "$BM.pytest1.log")
python -m pytest -q --ignore=.claude > "$BM.pytest2.log" 2>&1; p2rc=$?; p2=$(tail -1 "$BM.pytest2.log")

gate_phase "defs + golden" 45
# 3. declared-defs + golden freshness
python tools/gen_frame_defs.py --check >/dev/null 2>&1; g1=$?
python tools/check_golden_freshness.py --check >/dev/null 2>&1; g2=$?

gate_phase "browser matrix" 50
# 4. brick-matrix, parallel; failing groups re-run alone
if [ "$TIER" = targeted ]; then
  bm=0
  ng=$(echo $MATRIX_GROUPS | wc -w); ig=0
  for g in $MATRIX_GROUPS; do gate_phase "matrix group $g" $((50 + 45 * ig / ng)); ig=$((ig + 1)); node tools/brick-matrix/run.mjs --group "$g" --out "${BM}_$g" 2>&1 | tail -1; [ "${PIPESTATUS[0]}" = 0 ] || bm=1; done
else
node tools/brick-matrix/run.mjs --parallel --out "$BM" > "$BM.matrix.log" 2>&1; bmrc=$?
gate_phase "matrix re-runs + push" 90
grep -E "rows, .*FAIL" "$BM.matrix.log" | tail -1
bm=$bmrc
# the runner's declared per-group lines (88, 320bed5): "group <name>: rows N, FAIL K, page errors E" / "did not report"
groups=$(grep -E "^group [a-z0-9-]+: (did not report|rows [0-9]+, FAIL [1-9]|rows [0-9]+, FAIL [0-9]+, page errors [1-9])" "$BM.matrix.log" | sed -E 's/^group ([a-z0-9-]+):.*/\1/' | sort -u | tr '\n' ' ')
[ -n "$groups" ] && mkdir -p ~/.bspline-status/advisor/failed-logs && cp "$BM.matrix.log" ~/.bspline-status/advisor/failed-logs/matrix-$(date +%Y%m%d-%H%M%S).log
if [ -n "$groups" ]; then
  echo "failing/missing groups: $groups"
  bm=0
  # a group that "did not report" or only has page errors re-runs alone too; any group whose lone re-run fails
  # blocks the push (the alone result is the verdict)
  for g in $groups; do
    node tools/brick-matrix/run.mjs --group "$g" --out "${BM}_$g" 2>&1 | tail -1; [ "${PIPESTATUS[0]}" = 0 ] || bm=1
  done
elif [ "$bmrc" != 0 ] && [ -f "$BM/brick-matrix.json" ]; then
  groups=$(python - "$BM/brick-matrix.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
gs = set()
# a row fails only on a FAIL verdict (a MISSING/DISABLED result without one is an expected greyed control)
for r in d.get('rows', []):
    if 'FAIL' in (r.get('verdict') or {}).values(): gs.add(r.get('group') or r.get('tool') or r.get('kind') or '?')
for c in d.get('checks', []):
    if c.get('ok') is False: gs.add(c.get('group') or '?')
print(' '.join(sorted(gs)))
EOF
)
  echo "failing groups: $groups"
  bm=0
  for g in $groups; do
    node tools/brick-matrix/run.mjs --group "$g" --out "${BM}_$g" 2>&1 | tail -1; [ "${PIPESTATUS[0]}" = 0 ] || bm=1
  done
fi

fi
echo "vitest rc=$vrc files=$nf rerun=$rr [$failed] | $vsum | $p1 ($p1rc) | $p2 ($p2rc) | defs $g1 golden $g2 | matrix $bm"
if [ "$vok" = 1 ] && [ "$p1rc" = 0 ] && [ "$p2rc" = 0 ] && [ "$g1" = 0 ] && [ "$g2" = 0 ] && [ "$bm" = 0 ]; then
  if git push -q origin HEAD:main HEAD:claude/lucid-ride-jycpox; then
    echo PUSHED; git log --oneline -1
    PUSHED_OK=1
    if [ "$TIER" = full ]; then echo 0 > "$TIER_COUNT"; else echo $((n + 1)) > "$TIER_COUNT"; fi
    cd "$FRED" && git fetch -q origin
    if [ -z "$(git status --porcelain | grep -v '^??')" ] && git merge -q --ff-only origin/main; then echo FF_OK; else echo FF_SKIPPED; fi
  else
    echo PUSH_REJECTED
  fi
else
  echo NOT_PUSHED
fi
python ~/.bspline-status/advisor/board.py status "{\"gate\":{\"tier\":\"$TIER\",\"groups\":[$(for g in $MATRIX_GROUPS; do printf '\"%s\",' "$g"; done | sed 's/,$//')],\"refs\":[$(for r in "$@"; do printf '\"%s\",' "$r"; done | sed 's/,$//')],\"pushed\":$( [ -n "$PUSHED_OK" ] && echo true || echo false),\"mainSha\":\"$(git rev-parse --short origin/main)\"}}" >/dev/null 2>&1 || true
