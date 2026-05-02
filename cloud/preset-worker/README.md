# bspline-preset-worker

Cloudflare Worker that backs cross-device preset sync for the B-Spline
generator palette. Storage is Cloudflare Workers KV. The Worker is **public
and unauthenticated** — anyone who knows the URL can read, write, or delete
presets. Acceptable for a single-user prototype; replace with real auth
before exposing publicly.

## API

| Method | Path             | Body              | Response                    |
| ------ | ---------------- | ----------------- | --------------------------- |
| GET    | `/presets`       | —                 | `{ names: ["a", "b", ...] }` |
| GET    | `/presets/:name` | —                 | snapshot JSON or 404        |
| PUT    | `/presets/:name` | snapshot JSON     | `{ ok: true, name }`        |
| DELETE | `/presets/:name` | —                 | `{ ok: true, name }`        |

CORS open to all origins. 10 MB max body size on PUT.

## One-time setup

From this directory:

1. Install wrangler.
   ```
   npm install
   ```
2. Log in to your Cloudflare account. Opens a browser to authorize.
   ```
   npx wrangler login
   ```
3. Create the KV namespace.
   ```
   npx wrangler kv namespace create PRESETS
   ```
   Wrangler prints something like:
   ```
   🌀 Creating namespace with title "bspline-presets-PRESETS"
   ✨ Success!
   Add the following to your configuration file in your kv_namespaces array:
   [[kv_namespaces]]
   binding = "PRESETS"
   id = "abc123def456..."
   ```
4. Open `wrangler.toml`, replace `REPLACE_WITH_KV_ID` with the printed `id`.
5. Deploy.
   ```
   npx wrangler deploy
   ```
   Wrangler prints a `https://bspline-presets.<your-subdomain>.workers.dev`
   URL. **That's your API endpoint.** Save it; the client needs it.

## Smoke test

Replace `<API>` with the URL from step 5:

```bash
# list (empty initially)
curl <API>/presets

# save a preset
curl -X PUT <API>/presets/test \
  -H 'Content-Type: application/json' \
  --data '{"P":{"widthIn":7},"preDelta":null,"postDelta":null}'

# load it back
curl <API>/presets/test

# delete
curl -X DELETE <API>/presets/test
```

## Wiring the client

After deploy, set the API URL on `window` before the palette JS modules run.
Easiest spot: an inline `<script>` near the top of the palette HTML.

```html
<script>
  window.BSPLINE_PRESETS_API_URL = 'https://bspline-presets.YOUR-SUBDOMAIN.workers.dev';
</script>
```

The client module
(`bspline-frame-builder/b-spline-gen/html/main/cloud-preset-manager.js`)
reads this global. If it isn't set, the cloud preset UI is left disabled
and the existing localStorage preset feature continues to work unchanged.

The cloud UI also expects these element IDs in the palette HTML — add them
alongside the existing local-preset controls when you're ready to wire it
up:

- `#cloudPresetName` — text input
- `#btnCloudPresetSave`
- `#btnCloudPresetLoad`
- `#btnCloudPresetDelete`
- `#cloudPresetSelect`

Then in `main.js`:

```js
import { bindCloudPresets } from './cloud-preset-manager.js';
// ...alongside bindPresets(preview):
bindCloudPresets(preview);
```

## Local development

```
npx wrangler dev
```

Runs the Worker at `http://localhost:8787` against a local KV simulator.
Useful for iterating without burning deploys. Same API shape as production.

## Costs

For a single-user workflow this fits the Cloudflare Workers free tier:

- 100,000 requests/day free
- 1 GB KV storage free
- 1,000 KV writes/day free, $5/M after
- 10 M KV reads/day free, $0.50/M after

A typical session does maybe 10–50 KV ops; you'd need to be saving presets
constantly to exceed the free tier.

## What's NOT implemented yet

Listed roughly in order of when you'd add them:

1. **A shared bearer token.** Trivial to add: set a `Worker secret`
   (`npx wrangler secret put PRESETS_TOKEN`), check it in the Worker via
   `request.headers.get('Authorization')`, send it from the client. Stops
   anyone who finds the URL from blowing away your data.
2. **Rate limiting.** Cloudflare's built-in
   [Rate Limiting Rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
   on the Worker route is the no-code option.
3. **Per-user namespacing.** If this ever becomes multi-user, prefix keys
   with `userId/` and read the userId from a JWT.
4. **Conflict resolution.** Right now, last write wins. KV is eventually
   consistent (~60s), so two devices saving the same name within a minute
   could clobber each other. For a single user this is fine.
5. **Audit log.** Mirror writes to an append-only log (R2 or another KV
   namespace) so you can recover from accidental deletes.
6. **Compression.** PUT bodies above ~10 KB benefit from gzip;
   `CompressionStream` is built into Workers.

Each of these is a small, isolated addition once the basics are confirmed
working — none require a redesign.
