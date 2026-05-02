# bspline-preset-worker

Cloudflare Worker that backs cross-device project sync for the B-Spline
generator palette. Storage is Cloudflare Workers KV. The Worker is **public
and unauthenticated** — anyone who knows the URL can read, write, or delete
projects. Acceptable for a single-user prototype; replace with real auth
before exposing publicly.

The folder is still named `preset-worker/` for git history continuity, but
the active terminology in the palette UI is "project". The Worker accepts
both `/projects/*` (primary) and `/presets/*` (legacy alias) on the same
KV namespace, so old and new clients hit the same data.

## API

Primary routes (use these from new code):

| Method | Path              | Body          | Response                    |
| ------ | ----------------- | ------------- | --------------------------- |
| GET    | `/projects`       | —             | `{ names: ["a", "b", ...] }` |
| GET    | `/projects/:name` | —             | snapshot JSON or 404        |
| PUT    | `/projects/:name` | snapshot JSON | `{ ok: true, name }`        |
| DELETE | `/projects/:name` | —             | `{ ok: true, name }`        |

Legacy aliases — same KV, same keys, kept for backward compat:

| Method | Path             | Body          | Response                    |
| ------ | ---------------- | ------------- | --------------------------- |
| GET    | `/presets`       | —             | `{ names: ["a", "b", ...] }` |
| GET    | `/presets/:name` | —             | snapshot JSON or 404        |
| PUT    | `/presets/:name` | snapshot JSON | `{ ok: true, name }`        |
| DELETE | `/presets/:name` | —             | `{ ok: true, name }`        |

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
curl <API>/projects

# save a project
curl -X PUT <API>/projects/test \
  -H 'Content-Type: application/json' \
  --data '{"P":{"widthIn":7},"preDelta":null,"postDelta":null}'

# load it back
curl <API>/projects/test

# delete
curl -X DELETE <API>/projects/test
```

The legacy `/presets/*` paths still work and hit the same KV — useful if
you have any old clients pointed at them.

## Wiring the client

After deploy, set the API URL on `window` before the palette JS modules run.
Easiest spot: an inline `<script>` near the top of the palette HTML.

```html
<script>
  window.BSPLINE_PRESETS_API_URL = 'https://bspline-presets.YOUR-SUBDOMAIN.workers.dev';
</script>
```

The active client module is
`bspline-frame-builder/b-spline-gen/html/main/cloud-project-manager.js`,
which renders a fullscreen Project Manager modal and calls `/projects/*`.
It reads `window.BSPLINE_PRESETS_API_URL` (env var name unchanged for git
history). If unset, the modal still opens but every fetch shows
"⚠ No API configured" and operations are no-ops.

The Project Manager modal expects these element IDs in the palette HTML
(already present in `bspline_gen_palette.html`):

- `#projectManagerModal` — the modal container
- `#fmCloseBtn` — close button
- `#fmProjectList` — the listbox of saved projects
- `#fmProjectSearch` — filter input
- `#fmProjectName` — the name field
- `#fmBtnSave`, `#fmBtnLoad`, `#fmBtnRename`, `#fmBtnDelete`
- `#fmProjectStatus`, `#fmProjectMsg`

Open triggers (any of these): `#btnOpenProjectManager` (navbar) or any
element with `data-open-projects` (sidebar button).

In `main.js`:

```js
import { bindProjectManager } from './cloud-project-manager.js';
// ...inside the bootstrap, after bindControls(preview):
bindProjectManager(preview);
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
- 1,000 KV writes/day free, $5/M