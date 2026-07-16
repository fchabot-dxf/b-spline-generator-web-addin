# DEPLOY-CONSOLIDATE-DESIGN — one canonical local deploy + a stop-first pre-check (E3)

**Status:** DESIGN pass (E3). No code, no deploy edits. For advisor review.
**Author:** worker, turn 91.
**Goal:** (1) confirm/establish ONE canonical local-deploy path so the copy/verify/handshake/build-info
logic has a single home, and (2) add a *best-effort* "stop the add-in first" pre-check so a deploy
against a running add-in warns early instead of wasting a copy — **without** weakening E1's fail-loud,
which is the real correctness gate.

---

## 1. Map (ground truth — file:line)

### 1a. The deploy scripts — three, with clean role separation

| Script | Role | Entry |
|---|---|---|
| `bspline-frame-builder/DEPLOY_bspline-frame-builder.py` | **LOCAL Fusion install** — mirror the whole bundle into `AddIns/bspline-frame-builder`; E1 fail-loud + build-info writer live here | `deploy_local()` / `deploy_all()`; `__main__` targets `all`/`bbf` |
| `release.py` (repo root) | **RELEASE orchestrator** — 4 steps: build ZIP, git push, gh release, local refresh | `main()` → `_parse_args` → step registry |
| `bspline-frame-builder/deploy_cloudflare.py` | **WEB only** — builds `dist/` + Cloudflare Pages | (out of scope: not a local deploy) |

No other deploy scripts linger: `run_deploy.py` / `deploy_worker.py` (deleted in the DF phase) are
gone — a glob for `run_deploy|deploy_worker|install|setup_addin` finds only pip's own files under
`.venv`. Confirmed.

### 1b. The two local-deploy "entries" — NOT duplicated; `release.py --local` DELEGATES

`release.py`'s step 4 (`step_local_refresh`, `release.py:259`) **shells out** to the canonical
installer — it does not re-implement or duplicate the copy/verify:

```python
# release.py:271
result = subprocess.run([sys.executable, _deploy_script, "all"], cwd=ADDIN_ROOT)
if result.returncode == 0: ...            # :275 — propagates DEPLOY's exit code (so E1 fail-loud → release "failed")
```

The header comment there (`release.py:247-258`) says it explicitly: *"Reusing that script keeps a single
source of truth for the ignore rules, locked-file (overlay-copy) tolerance, and the dev-workspace
handshake files, instead of duplicating that logic here."*

```
  python DEPLOY_bspline-frame-builder.py all ─┐
                                              ├─► deploy_all() ─► deploy_local()   ← THE canonical logic
  python release.py --local ─► step_local_refresh() ─► subprocess ─┘   (copy_overlay + verify +
      (also: --web git push · --addin ZIP+gh · --all = 1·2·3·4)         handshakes + build-info + E1 fail-loud)
```

**So consolidation is already ~90 % done:** `DEPLOY_…py::deploy_local` is the single source; `release.py
--local` is a thin subprocess wrapper (live output streaming + process isolation, per its comment).
There is **no duplicated copy/verify block to remove.** The human runs whichever is convenient —
`DEPLOY_…py all` for a quick local refresh, `release.py`/`--local` inside the full-release flow.

### 1c. Running-add-in detection surface — weak today; no lock file exists

The signal people *assume* exists (a lock the add-in holds) mostly doesn't:

- **The loggers do NOT hold a file open.** `DebugLogger.log` (`fb_logger.py:63-68`) does
  `open(path,"a")` → write → flush → `fsync` → **close**, *per line*. So the log file is only open for
  microseconds per write — a lock-probe almost always **succeeds** even while the add-in is loaded
  (false negative). `cam_logger.py` / `template-maker/core/detection_log.py` mirror this pattern.
- **Logs are written into BOTH the deployed tree AND the source workspace.** `log_paths[0]` =
  `<addin_root>/frame-builder-debug.log` in the DEPLOYED folder (`fb_logger.py:18`); `log_paths[1]` =
  the source workspace via the `project_path.json` handshake (`:20-39`). All logs are **truncated on
  add-in load** (`open(path,'w').close()`, `:47-51`) + a `LOGGER INITIALIZED` line written.
- **No PID / lock / heartbeat file exists.** Nothing in the add-in writes one on `run()` / removes it
  on `stop()`.
- **The `.py` source isn't held either** — Python reads + closes on import. Which DEST files E1
  actually catches as "locked" is **non-deterministic** (CEF-held palette resources while a palette is
  open, a `.pyc`, a log caught mid-write) — which is exactly why E1 is a *post-copy* fail-loud, not a
  predictable single-file probe.

**Consequence:** there is **no reliable zero-add-in-change way to detect a loaded-but-idle add-in.**
The reliable signal has to be *created* (a heartbeat the add-in maintains). E1 already covers
correctness — so the pre-check's job is only to save a wasted copy + give a clear message.

---

## 2. Proposal

### 2a. Consolidation — keep DEPLOY canonical; host the pre-check there

- **`DEPLOY_…py::deploy_local` stays the ONE canonical local deploy** (it already owns copy_overlay,
  verify, the 4 handshake writers, the build-info writer, and E1 fail-loud). Do **not** invert the
  dependency into `release.py` — release.py is the release *orchestrator*; the installer is the focused
  single-purpose script, and E1/build-info already live in it.
- **`release.py --local` keeps delegating via `subprocess`** (unchanged) — it already propagates the
  exit code, so the pre-check + E1 fail-loud reach the release flow for free. `--web / --addin / --all`
  contract untouched.
- **Put the stop-first pre-check INSIDE `deploy_local`** (at the very top, before `clean_dir` +
  `copy_overlay`). Because `release.py --local` shells out to the same function, **both invocation
  paths inherit the pre-check from one place** — the declare-aligned single-source placement.

### 2b. Stop-first pre-check — best-effort, degrades to E1

Shape (wherever the detection fork lands):

```
  deploy_local():
    running, confidence, why = _detect_running_addin()      # best-effort
    if running and confidence == 'high' and not args.force:
        REFUSE: "The add-in looks live in Fusion (…). Stop it (Tools → Add-Ins → Stop),
                 then redeploy — or pass --force to deploy anyway."  → sys.exit(2)
    elif running:                                            # low confidence / --force
        WARN and PROCEED (E1 fail-loud is the backstop)
    …clean_dir / copy_overlay / verify…                     # unchanged; E1 still guards
```

Invariants (from the dispatch): **never hard-block a legit deploy on a false positive** — any
uncertainty degrades to *warn + proceed*, and E1's post-copy fail-loud remains the correctness gate. A
`--force` flag always skips the refusal (and `release.py --local` would forward it).

### 2c. Detection mechanism — recommend a tiny heartbeat lock (one touch)

The only *reliable* signal needs the add-in to write one. The parent add-in already has the two hooks
that run once for the whole bundle — `bspline-frame-builder.py::run(context)` (`:450`) and
`stop(context)` (`:660`) — so **ONE** lock write/remove covers all sub-add-ins:

```
  run(context):   write  <addin_root>/.addin-running.lock  = {"pid": os.getpid(), "started_at": <iso>}
  stop(context):  remove <addin_root>/.addin-running.lock
  deploy pre-check: lock exists?  → high confidence running
                    (optional: PID alive / mtime fresh to shrug off a crash-stale lock)
```

Cheap to check, reliable, crash-tolerant (stale-lock heuristics), and a single add-in-side edit. This
is a small E3 *code* slice — flagged as fork **F2** below against the zero-change heuristics.

---

## 3. GATED FORKS — decisions for the advisor

**F1 — which entry is canonical**
- **A (recommended):** `DEPLOY_…py::deploy_local` stays canonical; `release.py --local` keeps
  delegating via subprocess. Pre-check lives in `deploy_local` (both paths inherit). Minimal, matches
  today's structure, keeps E1/build-info in place.
- **B:** move the copy logic into `release.py` and have `DEPLOY_…py` call it — inverts a working
  dependency, drags the release orchestrator into installer duties. Rejected unless you want release.py
  to be the sole script.

**F2 — detection mechanism** (couples to F3)
- **A — heartbeat lock file** *(recommended)*: bootstrap `run()`/`stop()` write/remove
  `.addin-running.lock`. Reliable + cheap; **one** add-in-side edit (a small E3 code slice, not free).
- **B — log-mtime heuristic**: check the deployed `*-debug.log` mtime; "written in the last N s" ⇒
  probably active. Zero add-in change, but misses a loaded-but-idle add-in (false negative) and can
  false-positive right after a Stop. Warn-only.
- **C — locked-file dry-probe**: before the real copy, try to rename/open-exclusive one DEST file. Reuses
  E1's lock semantics as a pre-check, but *which* file is reliably held is non-deterministic (§1c) →
  unreliable. Warn-only.

**F3 — refuse-vs-warn default** (given E1 already guards correctness)
- **Refuse + `--force` on HIGH-confidence detection, warn-and-proceed otherwise** *(recommended)* —
  only the reliable lock (F2-A) earns a refusal; heuristics (F2-B/C) only ever warn. Never blocks on a
  guess.
- **Always warn, never refuse** — lowest friction; leans entirely on E1. Simpler, but doesn't save the
  wasted copy the human explicitly asked to avoid.
- **Always refuse + `--force`** — strongest nudge, but risks blocking a legit deploy when detection is
  a heuristic. Only sane if F2-A (reliable lock) is chosen.

**Recommended bundle:** F1-A + F2-A (heartbeat lock via the bootstrap) + F3 refuse-on-high-confidence.
If you want **zero add-in edits in E3**, fall back to F2-B (log-mtime) + F3 warn-only, and keep the
heartbeat lock as a later upgrade.

**Non-forks (proposed settled unless you object):** DEPLOY stays canonical & release.py keeps its
subprocess delegation (§2a); the pre-check lives in `deploy_local` so both paths inherit it; the
pre-check is best-effort and always degrades to E1's fail-loud; a `--force` flag overrides; E1 fail-loud
and the build-info writer are untouched wherever this lands.

---

*No application code, deploy code, or add-in code was modified in this pass — design only.*
