/**
 * cloud-sync.js — thin client for the step-editor Cloudflare Worker.
 *
 * SELF-CONTAINED: no imports from any other folder. The base URL is
 * read from `window.STEP_EDITOR_API_URL`, which the HTML sets to the
 * deployed Worker (e.g. https://step-editor-files.<sub>.workers.dev`).
 * When unset, every function below resolves to a benign no-op shape so
 * UI code can stay branch-free.
 *
 * Worker API (see cloud/step-editor-worker/src/index.js):
 *   GET    /files              -> { items: [{name, savedAt, size}, ...] }
 *   GET    /files/:name        -> raw .stp text   (404 when missing)
 *   PUT    /files/:name        -> body: .stp text → { ok, name, savedAt }
 *   DELETE /files/:name        -> { ok, name }
 */

/** Resolve the configured Worker base URL, or null if not set. */
export function getApiUrl() {
  if (typeof window === 'undefined') return null;
  const u = window.STEP_EDITOR_API_URL;
  if (!u || typeof u !== 'string') return null;
  return u.replace(/\/+$/, '');
}

/** Is cloud sync configured for this page load? */
export function isCloudEnabled() {
  return !!getApiUrl();
}

/**
 * List every saved file. Returns `{ items: [] }` when cloud disabled, so
 * callers can render an empty state without checking `isCloudEnabled` first.
 */
export async function listFiles() {
  const base = getApiUrl();
  if (!base) return { items: [], cloud: false };
  const res = await fetch(`${base}/files`);
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  const json = await res.json();
  return { items: json.items || [], cloud: true };
}

/**
 * Load a single .stp file by name. Returns null when the name doesn't
 * exist on the server (404). Throws on other errors.
 */
export async function loadFile(name) {
  const base = getApiUrl();
  if (!base) return null;
  const res = await fetch(`${base}/files/${encodeURIComponent(name)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`load failed: ${res.status}`);
  return await res.text();
}

/**
 * Save a .stp text payload under `name`. The Worker stamps savedAt + size
 * in KV metadata so the file list can render dates without extra requests.
 */
export async function saveFile(name, stpText) {
  const base = getApiUrl();
  if (!base) return { ok: false, reason: 'cloud-disabled' };
  const res = await fetch(`${base}/files/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: stpText,
  });
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
  return await res.json();
}

/** Delete a saved file. */
export async function deleteFile(name) {
  const base = getApiUrl();
  if (!base) return { ok: false, reason: 'cloud-disabled' };
  const res = await fetch(`${base}/files/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
  return await res.json();
}
