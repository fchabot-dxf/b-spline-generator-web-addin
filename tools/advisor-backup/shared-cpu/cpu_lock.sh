# Shared CPU lock for heavy runs on this PC (bspline + DDCS). Source it, then:
#   cpu_lock_take <project> "<what>" "<eta>"   # blocks until held; heavy run follows
#   cpu_lock_release <project>                  # also run from a trap EXIT
#   cpu_lock_status                             # prints holder / waiters
# CLI: bash cpu_lock.sh status
# Lock = mkdir ~/.shared-cpu/lock (atomic). Holder file lock/holder.txt:
#   project=.. what=.. start=<epoch> eta=.. pid=<windows pid> host=<hostname>
# Stale ONLY when the holder pid is dead on this host, or older than 4 h (backstop).
# Fairness: CPU_LOCK_TURNS slot pattern (ddcs 3 : bspline 1, temporary); a waiting slot owner goes first, a pass uses the slot.
# Heavy = full suites, gates, matrix/Chrome sweeps, timing probes. Light work never takes it.
# Existing per-project locks (gate_running, probes, ddcs-playwright-runner.lock) stay as they are.

CPU_LOCK_ROOT="${CPU_LOCK_ROOT:-$HOME/.shared-cpu}"
CPU_LOCK_DIR="$CPU_LOCK_ROOT/lock"
CPU_LOCK_BACKSTOP_S=14400
CPU_LOCK_POLL_S=30
# Turn pattern (Fred 2026-10-17: "let ddcs use the cpu 3 to 1"; "if you don't take the turn you can pass it, and it
# counts as 1"): slots repeat in this order; every take advances the slot pointer by one, whoever takes it. A project
# may take the current slot if it owns it, or if the owner is not waiting (a pass, which still uses up that slot).
# TEMPORARY (Fred: "it's temporary"): set back to "ddcs bspline" when Fred says.
CPU_LOCK_TURNS="ddcs ddcs ddcs bspline"
_cpu_slot_owner() { local -a t=($CPU_LOCK_TURNS); echo "${t[$(( $1 % ${#t[@]} ))]}"; }
_cpu_waiting() { local f="$CPU_LOCK_ROOT/waiting.$1"; [ -e "$f" ] && [ $(( $(date +%s) - $(date -r "$f" +%s) )) -lt 600 ]; }

_cpu_winpid() { cat "/proc/${1:-$$}/winpid" 2>/dev/null || echo "${1:-$$}"; }
# Progress board "Shared PC" row (DDCS advisor's proposal, Fred 2026-10-17). Silent on any failure. The key is read at
# runtime and handed to curl through its config on stdin (printf is a builtin), so it never appears in a command line.
_cpu_board_pc() {
  local k; k=$(cat "$HOME/.ddcs-bridge/progress-push-key.txt" 2>/dev/null) || return 0; [ -n "$k" ] || return 0
  printf 'url = "https://progress-board.dansemur.workers.dev/pc?k=%s"\n' "$k" \
    | curl -s -m 5 -K - -A "Mozilla/5.0" -H "Content-Type: application/json" -d "$1" >/dev/null 2>&1 || true
}
_cpu_field() { sed -n "s/^$1=//p" "$CPU_LOCK_DIR/holder.txt" 2>/dev/null | head -1; }
_cpu_pid_alive() { tasklist //FI "PID eq $1" //NH 2>/dev/null | grep -q " $1 "; }

_cpu_lock_stale() {
  [ -d "$CPU_LOCK_DIR" ] || return 1
  local pid start host now
  pid=$(_cpu_field pid); start=$(_cpu_field start); host=$(_cpu_field host); now=$(date +%s)
  [ -z "$pid" ] && [ -z "$start" ] && return 1          # being written right now
  [ -n "$start" ] && [ $((now - start)) -gt $CPU_LOCK_BACKSTOP_S ] && return 0
  [ -n "$host" ] && [ "$host" != "$(hostname)" ] && return 1
  [ -n "$pid" ] && ! _cpu_pid_alive "$pid" && return 0
  return 1
}


cpu_lock_take() {
  local project=$1 what=$2 eta=${3:-?} pid announced=
  pid=$(_cpu_winpid "${CPU_LOCK_PID:-$$}")
  mkdir -p "$CPU_LOCK_ROOT"
  while :; do
    touch "$CPU_LOCK_ROOT/waiting.$project"
    if _cpu_lock_stale; then
      # rename (atomic) so only one taker claims the stale lock; put it back if it was not the one judged
      local spid sstart moved="$CPU_LOCK_DIR.stale.$$"
      spid=$(_cpu_field pid); sstart=$(_cpu_field start)
      if mv "$CPU_LOCK_DIR" "$moved" 2>/dev/null; then
        if [ "$(sed -n 's/^pid=//p' "$moved/holder.txt" 2>/dev/null)" = "$spid" ] \
           && [ "$(sed -n 's/^start=//p' "$moved/holder.txt" 2>/dev/null)" = "$sstart" ]; then
          echo "cpu_lock: removed stale lock (pid $spid, start $sstart)"; rm -rf "$moved"
        else
          mv "$moved" "$CPU_LOCK_DIR" 2>/dev/null || echo "cpu_lock: WARNING could not restore a fresh lock ($moved)"
        fi
      fi
    fi
    local turn owner; turn=$(cat "$CPU_LOCK_ROOT/turn.txt" 2>/dev/null); turn=${turn:-0}
    owner=$(_cpu_slot_owner "$turn")
    if [ "$owner" != "$project" ] && _cpu_waiting "$owner" && [ ! -d "$CPU_LOCK_DIR" ]; then
      [ -z "$announced" ] && { echo "cpu_lock: slot $turn is $owner's turn (waiting) -- yielding"; announced=1; }
    elif mkdir "$CPU_LOCK_DIR" 2>/dev/null; then
      printf 'project=%s\nwhat=%s\nstart=%s\neta=%s\npid=%s\nhost=%s\n' \
        "$project" "$what" "$(date +%s)" "$eta" "$pid" "$(hostname)" > "$CPU_LOCK_DIR/holder.txt"
      echo $((turn + 1)) > "$CPU_LOCK_ROOT/turn.txt"      # the slot is used whoever took it (a pass counts as 1)
      echo "$project" > "$CPU_LOCK_ROOT/last-holder.txt"
      rm -f "$CPU_LOCK_ROOT/waiting.$project"
      echo "cpu_lock: held by $project ($what)"
      _cpu_board_pc "{\"holder\":\"$project\",\"what\":\"${what//\"/}\",\"eta\":\"${eta//\"/}\",\"since\":$(date +%s)000}"
      return 0
    else
      [ -z "$announced" ] && { echo "cpu_lock: waiting for $(_cpu_field project) ($(_cpu_field what), eta $(_cpu_field eta))"; announced=1; }
    fi
    sleep $CPU_LOCK_POLL_S
  done
}

cpu_lock_release() {
  local project=$1
  [ -d "$CPU_LOCK_DIR" ] || return 0
  if [ "$(_cpu_field project)" = "$project" ] && [ "$(_cpu_field host)" = "$(hostname)" ]; then
    rm -rf "$CPU_LOCK_DIR"; echo "cpu_lock: released by $project"
    _cpu_board_pc '{"holder":""}'
  fi
  rm -f "$CPU_LOCK_ROOT/waiting.$project"
}

cpu_lock_status() {
  if [ -d "$CPU_LOCK_DIR" ]; then
    echo "held: $(tr '\n' ' ' < "$CPU_LOCK_DIR/holder.txt" 2>/dev/null)"
    _cpu_lock_stale && echo "  (STALE: holder pid dead or > 4 h)"
  else echo "free"; fi
  ls "$CPU_LOCK_ROOT"/waiting.* 2>/dev/null | sed 's#.*/waiting\.#waiting: #'
  local t; t=$(cat "$CPU_LOCK_ROOT/turn.txt" 2>/dev/null); t=${t:-0}
  echo "last holder: $(cat "$CPU_LOCK_ROOT/last-holder.txt" 2>/dev/null) | next slot: $t = $(_cpu_slot_owner "$t") (pattern: $CPU_LOCK_TURNS)"
}

# CLI entry only when executed, never when sourced. An if-block (not an && chain) so `source cpu_lock.sh` returns 0;
# the && form returned 1 when sourced and silently skipped `source ... && cpu_lock_take` (found by seat E, 2026-10-17).
if [ "${BASH_SOURCE[0]}" = "$0" ] && [ "$1" = status ]; then cpu_lock_status; fi
true
