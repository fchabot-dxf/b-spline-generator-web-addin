# WORK-LOG (worker's log — advisor READS, never edits)

Append one entry per task turn: what you did, why, what you verified, and any
surprises / gaps. Bug or principle smells you spot mid-task go here, parked for T2 —
do not fix them in a report turn.

---

## Turn 1 — T1: Architecture report (read-only) — DONE

**Deliverable:** `ARCHITECTURE.md` at repo root, covering items 1–5 with the two
invariant seams made explicit (fusion-bridge contract §1.3, hot-reload lifecycle §2).

**Method / why this shape.** Read the two seam-bearing files + the parent add-in
MYSELF (ground truth, since the advisor spot-checks those): `core/fusion-bridge.js`,
`b-spline-gen/b-spline-gen.py` (palette reg + `PaletteHTMLEventHandler` dispatch),
`bspline-frame-builder.py` (whole lifecycle), plus `main.js`/`bspline_gen_palette.html`
for the inbound-handshake JS side. Delegated the breadth-only surveys (6 sibling
palettes; `cloud/` + deploy scripts) to two read-only Explore subagents so I could
keep the seams in my own context. Then VERIFIED the load-bearing agent-sourced claims
against source before trusting them in a durable doc: duplicated shared-name modules
exist (`find`), frame-builder UI modules have no top-level `run/stop` (`grep`).

**Surprises / gaps (documented in the report):**
- `dist/` is a **filtered file-COPY** of `b-spline-gen/html/` + `styles/`
  (`deploy_cloudflare.py:148,175-185`), NOT a compiled bundle. This is the hard
  evidence for "one frontend, two hosts" — same unbuilt ES modules serve both.
- Two distinct consolidation categories the README doesn't mention:
  **parent-owned** (b-spline-gen + the 2 frame-builder palettes — parent registers
  their commands from the `COMMANDS` table, they have no own `run/stop`) vs
  **self-driven** (the other 5 — parent calls their own `run()/stop()`).
- READMEs are stale/aspirational (see report "Doc drift"): reference
  `fusion-hybrid.py`/`deploy_hybrid.py` that don't exist; say STEP chunks are 100KB
  but code uses 256KB (`fusion-bridge.js:57`). Documented from code, not prose.

**Bug / principle smells PARKED for T2 (not fixed — read-only turn):**
1. **P1 (host behaviour outside the bridge).** Two *new* bridge actions call
   `adsk.fusionSendData(...)` DIRECTLY instead of adding a sender to
   `core/fusion-bridge.js`: `main/main.js:136` (`get_design_params`) and
   `main/app-init.js:187` (`import_svg_sketches`). Both are reached only in
   Fusion-mode context so they don't crash the web host, but they leak host coupling
   out of the seam module. **T2 also verify:** I did NOT find a Python handler for
   `import_svg_sketches` in `b-spline-gen.py`'s dispatch (the ones present:
   log/preview*/generate*/check_import_status/ping/get_design_params/reset_ui/ok/
   cancel) — confirm the "Send to Fusion" editor button (BUG-23) actually has a
   backend, or it's a dead send.
2. **P4/DRY.** `core/coords.js:14` and `core/state.js:264` re-implement `fusLog`
   inline (`typeof adsk` guard + `fusionSendData('log', …)`) instead of importing
   `fusLog` from `fusion-bridge.js`. Duplicated seam logic.
3. **Cloud identity drift (correctness).** `preset-worker` carries three names —
   `wrangler.toml` `projects-dansemur`, `package.json` `bspline-preset-worker`,
   `deploy_worker.py` REST target `bspline-presets`. The `wrangler deploy` path and
   the REST path would publish DIFFERENTLY-named scripts. Live URL is
   `projects-dansemur.dansemur.workers.dev`. T2/T3: is `bspline-presets` a stale
   orphan script?
4. **Dead / incomplete infra.** `cloud/step-editor-worker` KV ids are still
   `REPLACE_AFTER_KV_CREATE` placeholders (unprovisioned); `cloud/step-editor-pages`
   is README-only and references a `deploy.cmd` + `step-editor/html/` source tree
   that don't exist. Candidate dead-code/standards items (more T3 than T2).

**NOT done (out of scope for T1):** did not touch `BUGS_OPEN.md` / reconcile B1–B3
— that's T2. No application-code edits. Only `ARCHITECTURE.md` (new) + this log.
