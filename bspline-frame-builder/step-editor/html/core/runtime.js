/**
 * runtime.js — Fusion ↔ browser environment detection and message bridge.
 *
 * All functions here are pure (no DOM side effects) and exportable so the
 * same code path works whether the HTML is loaded inside a Fusion palette
 * or served from step-editor.pages.dev.
 *
 * Mirror of the runtime-detection pattern used by b-spline-gen's UI, but
 * pulled into its own module so other source files (parser, exporter,
 * cloud sync) can import the bridge without depending on the boot script.
 */

/**
 * True when `window.adsk.fusionSendData` is available — i.e. the page is
 * loaded inside a Fusion 360 palette and can tunnel events to the Python
 * add-in via `fusionSendData(action, jsonString)`.
 *
 * Falsy when running as a standalone web page (e.g. step-editor.pages.dev).
 * Both code paths share the same UI; runtime-only buttons are hidden via
 * the `runtime-fusion` / `runtime-web` body classes.
 */
export function isFusion() {
  return !!(typeof window !== 'undefined' && window.adsk && window.adsk.fusionSendData);
}

/**
 * Send a typed message to the Python add-in. No-op when not in Fusion.
 *
 * @param {string} action   matches the `action` branch in PaletteHTMLEventHandler
 * @param {object} [data]   serialised to JSON for the bridge
 */
export function sendToPython(action, data) {
  if (!isFusion()) return;
  try {
    window.adsk.fusionSendData(action, JSON.stringify(data || {}));
  } catch (e) {
    // Swallow — the bridge can throw transient errors during palette
    // teardown that aren't actionable from JS.
    console.error('[runtime] fusionSendData failed:', e);
  }
}

/**
 * Tunnel a log line to the Python log file. Useful while building the UI
 * because Fusion's palette devtools is gated behind a feature flag.
 */
export function pyLog(msg) {
  sendToPython('log', { msg: String(msg) });
}

/**
 * Register Python → JS message routes. Stackable: each call layers new
 * routes ON TOP of whatever was registered before. Unhandled actions
 * fall through to the previous handler, so a transient registration
 * (e.g. fusion-bridge listening for import_success during a single
 * send) does NOT clobber the main app's permanent routes (pong,
 * reset_ui).
 *
 * Python calls `palette.sendInfoToHTML(action, jsonString)`, which Fusion
 * forwards to `window.fusionJavaScriptHandler.handle(action, data)`.
 *
 * @param {Record<string, (data: any) => void>} routes  action → handler map
 * @returns {() => void}  detach function — un-layers these routes, restoring
 *                        whatever handler was current when this call ran.
 */
export function registerPythonRoutes(routes) {
  if (typeof window === 'undefined') return () => {};
  const prev = window.fusionJavaScriptHandler;

  const layer = {
    handle(action, data) {
      try {
        const fn = routes && routes[action];
        if (fn) {
          fn(parsePayload(data));
          return '';
        }
        if (prev && typeof prev.handle === 'function') {
          return prev.handle(action, data);
        }
      } catch (e) {
        console.error(`[runtime] route "${action}" threw:`, e);
      }
      return '';
    },
  };

  window.fusionJavaScriptHandler = layer;

  return () => {
    // Only restore `prev` if we're still the top layer. If something else
    // layered on top after us and is still active, splicing us out cleanly
    // isn't possible — easier just to leave the chain alone, since our
    // routes object went out of scope and stops firing.
    if (window.fusionJavaScriptHandler === layer) {
      window.fusionJavaScriptHandler = prev;
    }
  };
}

/**
 * Helper: safely JSON-parse the string Fusion hands to the JS bridge.
 * Returns `{}` on empty / invalid input so callers can destructure freely.
 */
export function parsePayload(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
