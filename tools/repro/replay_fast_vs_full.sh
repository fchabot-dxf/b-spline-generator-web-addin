#!/bin/bash
# Seat D 2026-10-08: does a sweep's FAST set catch what its FULL sweep catches? Replays each past engine FIX's PRE-fix
# engine source (core/) under TODAY's sweep tests, FAST then FULL, behind the heavy-run guard; one summary line per run.
# A FIX whose FULL run fails while FAST passes = a FAST-set gap. Run it in a SCRATCH worktree (it swaps core/ in place).
#   FIXES="<sha> <sha> ..." bash tools/repro/replay_fast_vs_full.sh <scratch worktree> <out dir>
WT="$1"; OUT="$2"; mkdir -p "$OUT"
cd "$WT" || exit 1
SWEEPS="bricks-overlap-sweep:OVERLAP_SWEEP_FULL bricks-gap-sweep:GAP_SWEEP_FULL bricks-seam-sweep:SEAM_SWEEP_FULL bricks-tip-fill-fans:TIP_FAN_SWEEP_FULL"
for FIX in ${FIXES:?set FIXES to the fix commits to replay}; do
  git checkout -q origin/main -- bspline-frame-builder
  git checkout -q "$FIX^" -- bspline-frame-builder/b-spline-gen/html/core 2>/dev/null
  for SW in $SWEEPS; do
    T=${SW%%:*}; FLAG=${SW##*:}
    for MODE in fast full; do
      until node tools/heavy-run-guard.mjs "seatD replay $FIX $T $MODE" >/dev/null 2>&1; do sleep 30; done
      LOG="$OUT/${FIX}_${T}_${MODE}.log"
      if [ "$MODE" = full ]; then env $FLAG=1 timeout 1200 npx vitest run "tests/$T.test.js" > "$LOG" 2>&1; else timeout 600 npx vitest run "tests/$T.test.js" > "$LOG" 2>&1; fi
      SUM=$(sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -E "^ +Tests " | tail -1 | tr -s ' ')
      echo "$FIX $T $MODE :$SUM" | tee -a "$OUT/summary.txt"
    done
  done
done
git checkout -q origin/main -- bspline-frame-builder
echo DONE | tee -a "$OUT/summary.txt"
