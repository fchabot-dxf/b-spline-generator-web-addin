# NEXT — CW1: one declared body-size cap for the shared worker, so no route can forget it (A7-1)

**Ball: worker (seat A) · epoch 1 · CW1.** Files: `cloud/preset-worker/src/body.js` (new), `cloud/preset-worker/src/index.js`,
`cloud/preset-worker/src/bus-route.js`. One commit by path, predicted **3 files**. No deploy (the advisor deploys the
worker; do not run wrangler against the account).

## Ground truth (advisor-verified)
- `index.js:38` declares `MAX_BODY_BYTES = 10 MB` and enforces it by hand THREE times after `await request.text()`
  (`:198`, `:239`, `:280`): same four lines each (empty → 400, too large → 413, then `JSON.parse`).
- `bus-route.js` reads bodies at `:84`, `:102`, `:137`, `:197`, `:212` (five PUT handlers) with **no size check at all**
  — unauthenticated, CORS `*`. `pageviews-route.js` has its own 4 KB cap (leave it; it is a different, tighter policy).

## Do
1. **Declare once** — new `cloud/preset-worker/src/body.js`:
   ```js
   // One body-size policy for every write route in this worker (CW1 / audit A7-1).
   export const MAX_BODY_BYTES = 10 * 1024 * 1024;

   /** Read a request body under the cap. Returns { body } or { error: Response }. */
   export async function readBoundedBody(request, max = MAX_BODY_BYTES) {
     const declared = Number(request.headers.get('content-length') || 0);
     if (declared > max) return { error: tooLarge(max) };
     const body = await request.text();
     if (body.length === 0)  return { error: json({ error: 'empty body' }, 400) };
     if (body.length > max)  return { error: tooLarge(max) };
     return { body };
   }
   function tooLarge(max) { return json({ error: 'body too large', maxBytes: max }, 413); }
   function json(obj, status) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }); }
   ```
2. `index.js`: delete the local `MAX_BODY_BYTES` (:38), import `{ readBoundedBody }` from `./body.js`, and replace each of
   the three `await request.text()` + empty/too-large checks (:196-198, :237-239, :278-280) with
   `const r = await readBoundedBody(request); if (r.error) return r.error; const body = r.body;` — the JSON parse and
   everything after stays as is.
3. `bus-route.js`: import `{ readBoundedBody }`; replace each of the five `const body = await request.text();` with the
   same three-line form. Keep each handler's own JSON/shape checks. The header comment at the top of the file should gain
   one line: "Body size: capped by body.js like every other route."
4. Grep afterwards: `request.text()` → 0 in index.js and bus-route.js (pageviews-route.js keeps its own); `MAX_BODY_BYTES`
   → defined once (body.js) and referenced nowhere else except via the default parameter.

## Verify
- `node --check` on the three files.
- A tiny headless check with a fake Request (Node 24 has `Request`/`Response`): `readBoundedBody(new Request('http://x',
  { method:'PUT', body:'{}' }))` → `{ body: '{}' }`; with `body: ''` → 400; with `headers: {'content-length': '99999999'}`
  → 413. Paste the output into the WORK-LOG.
- `git show --stat HEAD` → 3 files (1 new).

## Do NOT
Touch `pageviews-route.js`, auth, CORS, KV key shapes, or any GET handler. Don't run wrangler.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "CW1: body.js declares MAX_BODY_BYTES + readBoundedBody; index.js 3 sites + bus-route.js 5 sites use it; request.text() 0 in both; headless check OK — <sha>, 3 files. Next: TM2 or FB2 (advisor's call)."`
and stop.
