/**
 * core/render-debug.js -- where three.js checks every shader compile for errors (renderer.debug.checkShaderErrors).
 *
 * 2026-10-10 (seat A; the fresh phone map, loaded board: getProgramInfoLog + getShaderInfoLog ~4.7 s of self time over
 * 44 slow actions): with the check on, three.js reads each program's and shader's info log right after compiling,
 * which forces the compile to finish synchronously on every rebuild. The advisor's rule, declared here: ON while
 * developing (localhost, or ?debug in the URL) so shader errors still reach the console; OFF on the live site and in
 * the Fusion palette. Rendering is the same either way.
 */
export const SHADER_CHECK_HOSTS = Object.freeze(['localhost', '127.0.0.1']);

/** True when three.js should check shader compiles: a development host or ?debug. No location (tests) = on. */
export function shaderChecksOn(loc = (typeof location !== 'undefined' ? location : null)) {
  if (!loc) return true;
  try {
    if (SHADER_CHECK_HOSTS.includes(loc.hostname)) return true;
    return new URLSearchParams(loc.search || '').has('debug');
  } catch (_) {
    return true;
  }
}
