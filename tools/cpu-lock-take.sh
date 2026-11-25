#!/usr/bin/env bash
# The taker run by tools/cpu-lock.mjs: cpu_lock_take plus an OWNER WATCHDOG, so a taker can never outlive its owner.
# 27 orphaned takers (parent node gone, up to 2 days old) were found 2026-11-24: nothing ever noticed the owner died.
# Env: CPU_LOCK_PID (the owner's windows pid), CPU_LOCK_WHAT, CPU_LOCK_ETA, CPU_LOCK_LOG (file; the taker's lines go there,
# never to a pipe that a dead owner could leave blocking). Exit 0 = held, 1 = owner died (taker killed, hold released).
source ~/.shared-cpu/cpu_lock.sh
owner=$CPU_LOCK_PID
: "${CPU_LOCK_LOG:=/dev/null}"
( cpu_lock_take bspline "$CPU_LOCK_WHAT" "$CPU_LOCK_ETA" ) >>"$CPU_LOCK_LOG" 2>&1 &
tp=$!
while kill -0 "$tp" 2>/dev/null; do
  sleep "${CPU_LOCK_WATCH_S:-2}"
  if ! _cpu_pid_alive "$owner"; then
    kill "$tp" 2>/dev/null; pkill -P "$tp" 2>/dev/null; wait "$tp" 2>/dev/null   # reaped BEFORE the cleanup so it cannot re-touch waiting.*
    cpu_lock_release bspline >>"$CPU_LOCK_LOG" 2>&1   # took it just before dying: a dead owner never leaves a holder
    rm -f "$CPU_LOCK_ROOT/waiting.bspline"
    echo "cpu_lock: owner $owner is gone; taker stopped" >>"$CPU_LOCK_LOG"
    exit 1
  fi
done
wait "$tp"
