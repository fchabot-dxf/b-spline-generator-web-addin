# step-editor-pages

Cloudflare Pages project that serves the **same** UI as the Fusion palette,
at `https://step-editor.pages.dev/`.

## Layout

The Pages build copies the editor's `html/` folder verbatim — runtime
detection in `main/main.js` keeps the Fusion-only buttons hidden when the
page is opened in a normal browser.

`deploy.cmd` is a one-liner that:

1. Mirrors `bspline-frame-builder/step-editor/html/` into `dist/`.
2. Calls `npx wrangler pages deploy dist/ --project-name=step-editor`.

We don't symlink across folders because the `html/` tree must remain
fully self-contained per the project convention: no path that escapes
the step-editor folder is followed at runtime. Copying is the cost of
that guarantee.

## First-time setup

```bash
npm install -g wrangler   # if not installed
wrangler login            # one-time auth
wrangler pages project create step-editor --production-branch=main
```

After the project is created in your Cloudflare dashboard, run
`deploy.cmd` whenever you want to publish a fresh build.

## Wiring the cloud worker

After `cloud/step-editor-worker/` is deployed, edit
`bspline-frame-builder/step-editor/html/step_editor_palette.html` and set:

```html
<script>
  window.STEP_EDITOR_API_URL = 'https://step-editor-files.<your-sub>.workers.dev';
</script>
```

This URL is read by both the palette and the Pages deployment — same HTML,
same code, two delivery surfaces.
