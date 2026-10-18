Advisor-side tools that live OUTSIDE git (backup before Fred's OS migration, 2026-10-17).

Restore to these paths on the new OS:
- gate.sh, board.py, fusion_popups.ps1 -> ~/.bspline-status/advisor/
- shared-cpu/cpu_lock.sh -> ~/.shared-cpu/ (shared with the DDCS project)

Secrets are NOT here: board.py and cpu_lock.sh read ~/.ddcs-bridge/progress-push-key.txt at runtime.
That key file, ~/.bspline-status/ (holder, deploys.log, shots), and the Claude memory dir must be copied separately.
