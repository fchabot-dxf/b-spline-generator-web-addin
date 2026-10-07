// Brick matrix: what one retry of a page that never booted should be.
//
// MEASURED (seat D, 8 parallel strokes runs, r8): "the app never booted (core/state.js failed to load ...; failed
// requests: bspline_gen_palette.html: net::ERR_ABORTED)" -- the palette DOCUMENT itself was cancelled, so the page never
// left about:blank. Reproduced exactly (seat A, Fetch.failRequest 'Aborted' on the palette request): Page.navigate's
// errorText net::ERR_ABORTED, location about:blank, the boot probe 'import-failed'; then Page.reload stays on
// about:blank and never boots, a fresh Page.navigate to the palette boots. So a lost DOCUMENT is re-navigated; a lost
// MODULE (the document committed) is reloaded, as before.

// the transient network errors a page load can lose a module to (measured under the gate's load; serve.py's backlog
// removed the refusals it could, ERR_NO_BUFFER_SPACE is the client's own socket exhaustion)
export const BOOT_RELOAD_ERRORS = ['net::ERR_NO_BUFFER_SPACE', 'net::ERR_CONNECTION_REFUSED', 'net::ERR_CONNECTION_RESET'];
// the palette document cancelled under load (above): a reload would reload about:blank
export const BOOT_RENAVIGATE_ERRORS = ['net::ERR_ABORTED'];
export const PALETTE_PAGE = 'bspline_gen_palette.html';

/** failedRequests: run.mjs's "<path after /html/>: <errorText>" lines. -> 'navigate' | 'reload' | null (no retry).
 *  Only the measured document case changes; every other match keeps the reload it always had. */
export function bootRetry(failedRequests) {
  const lost = (f, errs) => errs.some((e) => f.endsWith(e));
  const doc = (f) => f.startsWith(`${PALETTE_PAGE}:`) || f.startsWith(`${PALETTE_PAGE}?`); // ?realCloud=1
  if (failedRequests.some((f) => doc(f) && lost(f, BOOT_RENAVIGATE_ERRORS))) return 'navigate';
  if (failedRequests.some((f) => lost(f, BOOT_RELOAD_ERRORS))) return 'reload';
  return null;
}
