#!/usr/bin/env bash
# tools/heavy-run.sh <eta-min> <command...> -- run a heavy command (full vitest, timing probe, ...) under the machine-wide
# shared CPU lock: takes turns with the DDCS and Sketch-Studio projects. Exits with the command's status.
# The lock records THIS bash's windows pid (alive for the whole run). CPU_LOCK_HELD is exported so a node runner that
# also takes the lock itself (brick-matrix/run.mjs) skips.
[ $# -ge 2 ] || { echo "usage: tools/heavy-run.sh <eta-min> <command...>" >&2; exit 2; }
eta=$1; shift
if [ -n "$CPU_LOCK_HELD" ] || [ -n "$CPU_LOCK_SKIP" ]; then exec "$@"; fi
source ~/.shared-cpu/cpu_lock.sh
export CPU_LOCK_PID; CPU_LOCK_PID=$(cat "/proc/$$/winpid" 2>/dev/null || echo $$)
trap 'cpu_lock_release bspline' EXIT
trap 'exit 130' INT TERM HUP
cpu_lock_take bspline "$*" "${eta}min" || exit 1
export CPU_LOCK_HELD=bspline
"$@"
