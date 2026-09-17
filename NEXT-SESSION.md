# LANE B (audit seat) — A7: audit the cloud side: `cloud/preset-worker/`, `cloud/step-editor-worker/`, `cloud/step-editor-pages/`, deploy_cloudflare.py. READ-ONLY. LAST audit slice.

**Seat B · epoch 1 · A7.** Same rules. Append an **"A7 — cloud"** section, then a short **"Audit series summary"** at the
end of the doc: one table of every H/M finding across A1-A7 with its current disposition (dispatched as <task> / open /
resolved) — the advisor will reconcile it against ROADMAP.

**A6 review (advisor):** accepted; cleanest add-in of the set. B10 → HY3. Parent wipe list: template-maker's bare
imports are the remaining reason; CAM-builder ruled out.

## A7 scope
1. **`cloud/preset-worker/`** (the SHARED worker `projects-dansemur`, serves several of Fred's apps): `src/index.js` +
   every route module (`pageviews-route.js`, `bus-route.js`, the projects/presets/penplotter/loader routes). For each
   route: auth (none? key?), input validation, body-size cap honoured, KV key shapes, CORS. Is anything writable by
   anyone on the internet that should not be (the README admits the projects store is unauthenticated — list every
   other unauthenticated WRITE). Dead routes (declared but nothing calls them — grep the apps' JS for the paths:
   `b-spline-gen/html/main/cloud-project-manager.js` uses `/projects`; who uses `/presets`, `/loader`, `/views`, `/bus`?).
   `wrangler.toml` bindings vs bindings the code reads (`env.X`) — both directions.
2. **`cloud/step-editor-worker/` + `cloud/step-editor-pages/`**: STANDARDS-AUDIT §3/§5 says pages is README-only and
   references a source that does not exist. Confirm current state: live, dead, or half-built; who deploys it.
3. **`bspline-frame-builder/deploy_cloudflare.py`**: the Pages build (`--build-only`) — what it copies into `dist/`,
   whether `dist/` can contain stale files (overlay vs clean), and whether the `.env` token is ever printed/logged.
4. Repo hygiene on the cloud side: `.wrangler/` state dirs, `package-lock.json` drift, leftover `.bak` files.

Do NOT deploy, do NOT run wrangler against the account. Static read + grep only.

## When done
Append lane-b WORK-LOG, commit by path, then FROM THIS FOLDER:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "A7 cloud: <n> findings (<H/M/L>), unauthenticated writes: <list>, dead routes: <list>, step-editor status: <x>; series summary appended. <sha>. Audit series COMPLETE."`
and stop.
