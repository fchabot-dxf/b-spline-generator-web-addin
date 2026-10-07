/**
 * The brick matrix's one boot retry (tools/brick-matrix/boot.mjs). MEASURED: the palette DOCUMENT cancelled under load
 * (net::ERR_ABORTED, seat D's parallel strokes run r8) leaves the page on about:blank -- a reload reloads about:blank and
 * never boots, a fresh navigate boots (seat A, Fetch.failRequest 'Aborted'). A lost MODULE keeps its reload.
 */
import { describe, it, expect } from 'vitest';
import { bootRetry, BOOT_RELOAD_ERRORS, BOOT_RENAVIGATE_ERRORS } from '../tools/brick-matrix/boot.mjs';

describe('brick matrix boot retry', () => {
  it('the palette document aborted -> a fresh navigate (D r8, verbatim)', () => {
    expect(bootRetry(['bspline_gen_palette.html: net::ERR_ABORTED'])).toBe('navigate');
    expect(bootRetry(['bspline_gen_palette.html?realCloud=1: net::ERR_ABORTED'])).toBe('navigate');
  });
  it('a module lost to the network stack -> one reload, as before', () => {
    for (const e of BOOT_RELOAD_ERRORS) expect(bootRetry([`core/state.js: ${e}`])).toBe('reload');
  });
  it('a MODULE aborted is not retried (only the document case was measured)', () => {
    expect(bootRetry(['core/state.js: net::ERR_ABORTED'])).toBe(null);
  });
  it('nothing failed, or an unrelated failure (the cloud stand-in port 9) -> no retry', () => {
    expect(bootRetry([])).toBe(null);
    expect(bootRetry(['http://127.0.0.1:9/cloud-off/projects?_=1: net::ERR_UNSAFE_PORT'])).toBe(null);
  });
  it('the two declared lists do not overlap', () => {
    expect(BOOT_RENAVIGATE_ERRORS.filter((e) => BOOT_RELOAD_ERRORS.includes(e))).toEqual([]);
  });
});
