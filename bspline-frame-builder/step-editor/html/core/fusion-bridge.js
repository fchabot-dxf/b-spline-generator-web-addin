/**
 * fusion-bridge.js — chunked STEP-text transfer from the palette JS to
 * the Python add-in, plus completion polling.
 *
 * SELF-CONTAINED: imports only from runtime.js (also in core/). The wire
 * contract mirrors b-spline-gen/html/core/fusion-bridge.js so both
 * add-ins behave identically from Python's POV, but no code is shared
 * across folders — this file is its own copy.
 *
 * Contract:
 *   1. JS  → Py: generate_start  { totalChunks }
 *   2. JS  → Py: generate_chunk  { index, data }    × totalChunks
 *   3. JS  → Py: generate_finish {}
 *   4. Py  → JS: import_progress { msg }            (any number, optional)
 *   5. Py  → JS: import_success  {}                 (on success)
 *      Py  → JS: import_error    { msg }            (on failure)
 *
 * Why chunked: Fusion's HTML→Python bridge has a per-message size cap
 * (empirically ~1 MB before things go sideways). 256 KB is comfortably
 * under that ceiling and gives us linear-time progress reporting.
 */

import { sendToPython, pyLog, registerPythonRoutes } from './runtime.js';

const CHUNK_SIZE = 256 * 1024;   // 256 KB per chunk — same as b-spline-gen

/**
 * Send the supplied STEP text to the Fusion add-in via chunked transfer.
 *
 * Wraps the STEP text in a small JSON envelope so future params (filename,
 * mode, isAppend) can ride along without changing the bridge protocol.
 *
 * Calls `onProgress` (if provided) on each chunk with a `{ chunk, total,
 * percent }` object. Resolves on `import_success`, rejects on
 * `import_error` or a timeout. Caller owns hiding/showing the palette
 * after the resolution.
 *
 * @param {string} stepText
 * @param {object} [params]    optional extras (filename, importMode, …)
 * @param {(p: {chunk:number,total:number,percent:number}) => void} [onProgress]
 * @param {number} [timeoutMs] reject after this many ms (default 5 min)
 * @returns {Promise<{ok:true} | never>}
 */
export function sendStepToFusion(stepText, params = {}, onProgress, timeoutMs = 5 * 60 * 1000) {
  const envelope = JSON.stringify({ stepText, params });
  const totalChunks = Math.ceil(envelope.length / CHUNK_SIZE);
  pyLog(`fusion-bridge: ${envelope.length} bytes in ${totalChunks} chunks`);

  // Promise resolves when Python sends back import_success, rejects on
  // import_error or timeout. We register the routes for the duration of
  // this send only, then detach.
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      detach();
      reject(new Error(`Send to Fusion timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    const detach = registerPythonRoutes({
      import_success: () => { clearTimeout(timer); detachAndResolve(); },
      import_error:   (data) => {
        clearTimeout(timer);
        detach();
        reject(new Error((data && data.msg) || 'Python reported import_error'));
      },
      import_progress: (data) => {
        if (onProgress && data && data.msg) onProgress({ chunk: -1, total: totalChunks, percent: -1, msg: String(data.msg) });
      },
    });

    function detachAndResolve() {
      detach();
      resolve({ ok: true });
    }

    // Ship it. Errors during a single chunk reject the whole send; the
    // Python side will clear its buffer when the next generate_start arrives.
    try {
      sendToPython('generate_start', { totalChunks });
      for (let i = 0; i < totalChunks; i++) {
        const data = envelope.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        sendToPython('generate_chunk', { index: i, data });
        if (onProgress) {
          onProgress({
            chunk:   i + 1,
            total:   totalChunks,
            percent: Math.round(((i + 1) / totalChunks) * 100),
          });
        }
      }
      sendToPython('generate_finish', {});
    } catch (e) {
      clearTimeout(timer);
      detach();
      reject(e);
    }
  });
}
