# step-editor-worker

Cloudflare Worker that stores STEP (.stp) files in KV. Same role for the
`step-editor` add-in that `preset-worker` plays for `b-spline-gen`, but
deployed as a separate service so the two can evolve independently.

## Setup

```bash
cd cloud/step-editor-worker
npm install
npx wrangler login                         # if first time
npx wrangler kv:namespace create STEP_FILES
npx wrangler kv:namespace create STEP_FILES --preview
# Paste the two ids into wrangler.toml under [[kv_namespaces]]
npx wrangler deploy
```

`wrangler deploy` prints the public URL (something like
`https://step-editor-files.<your-subdomain>.workers.dev`). Set
`window.STEP_EDITOR_API_URL` in `step-editor/html/step_editor_palette.html`
to that URL so the palette + the Pages deployment both pick it up.

## API

| Method | Path           | Body         | Returns                                     |
|--------|----------------|--------------|---------------------------------------------|
| GET    | `/files`       |              | `{ items: [{name, savedAt, size}, ...] }`   |
| GET    | `/files/:name` |              | raw .stp text (404 when missing)            |
| PUT    | `/files/:name` | .stp text    | `{ ok, name, savedAt }`                     |
| DELETE | `/files/:name` |              | `{ ok, name }`                              |

Server-side validation rejects any PUT whose body doesn't start with
`ISO-10303-21;` — STEP's mandatory leading marker. Catches accidental
empty/JSON saves before they pollute the namespace.

## Body cap

25 MB per file. Adjust `MAX_BODY_BYTES` in `src/index.js` if you need more
headroom (Cloudflare KV caps individual values at 25 MB).
