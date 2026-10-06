/**
 * H23 item 92: the Fusion palette opened as the website (no Send button) when Fusion injected `adsk` later than the
 * page's 3 x 100 ms check -- measured live by seat A (2026-10-06): 3 opens in a row on a palette restoring a brick
 * wall, adsk present ~3 s in. The add-in now DECLARES the host in the palette URL (html/data/fusion-host.js); a page
 * carrying it waits for adsk up to modeDetectTimeoutMs and decides as soon as it appears. The website (no flag)
 * decides after webGraceMs, as before.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import FUSION_HOST from '../bspline-frame-builder/b-spline-gen/html/data/fusion-host.js';
import { pollMode } from '../bspline-frame-builder/b-spline-gen/html/core/fusion-bridge.js';
import { isFusionMode } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const FUSION_URL = `file:///C:/AddIns/b-spline-gen/html/bspline_gen_palette.html?${FUSION_HOST.param}=${FUSION_HOST.value}`;
const WEB_URL = 'https://bspline-generator.pages.dev/';

function injectAdskAt(ms) {
    setTimeout(() => { globalThis.adsk = { fusionSendData: () => {} }; }, ms);
}

function run() {
    const out = { mode: null, at: null };
    const t0 = Date.now();
    pollMode(() => { out.mode = 'fusion'; out.at = Date.now() - t0; }, () => { out.mode = 'web'; out.at = Date.now() - t0; });
    return out;
}

describe('pollMode: the Fusion host is declared, adsk may arrive late (H23 item 92)', () => {
    beforeEach(() => { vi.useFakeTimers(); delete globalThis.adsk; });
    afterEach(() => { vi.useRealTimers(); delete globalThis.adsk; window.happyDOM.setURL('http://localhost/'); });

    it('a declared Fusion page whose adsk arrives 3 s late opens in Fusion mode', () => {
        window.happyDOM.setURL(FUSION_URL);
        injectAdskAt(3000);
        const out = run();
        vi.advanceTimersByTime(FUSION_HOST.modeDetectTimeoutMs + 1000);
        expect(out.mode).toBe('fusion');
        expect(isFusionMode).toBe(true);
    });

    it('decides the moment adsk appears (within one poll), not at the timeout', () => {
        window.happyDOM.setURL(FUSION_URL);
        injectAdskAt(3000);
        const out = run();
        vi.advanceTimersByTime(FUSION_HOST.modeDetectTimeoutMs + 1000);
        expect(out.at).toBeGreaterThanOrEqual(3000);
        expect(out.at).toBeLessThanOrEqual(3000 + FUSION_HOST.pollMs);
    });

    it('adsk already there: Fusion mode at once', () => {
        window.happyDOM.setURL(FUSION_URL);
        globalThis.adsk = { fusionSendData: () => {} };
        const out = run();
        expect(out.mode).toBe('fusion');
        expect(out.at).toBe(0);
    });

    it('a declared Fusion page that never gets adsk falls back to web mode at the declared timeout', () => {
        window.happyDOM.setURL(FUSION_URL);
        const out = run();
        vi.advanceTimersByTime(FUSION_HOST.modeDetectTimeoutMs - FUSION_HOST.pollMs);
        expect(out.mode).toBe(null);
        vi.advanceTimersByTime(2 * FUSION_HOST.pollMs);
        expect(out.mode).toBe('web');
        expect(isFusionMode).toBe(false);
    });

    it('the website (no host flag) still decides web after webGraceMs, not the Fusion timeout', () => {
        window.happyDOM.setURL(WEB_URL);
        const out = run();
        vi.advanceTimersByTime(FUSION_HOST.webGraceMs + FUSION_HOST.pollMs);
        expect(out.mode).toBe('web');
        expect(out.at).toBeLessThanOrEqual(FUSION_HOST.webGraceMs + FUSION_HOST.pollMs);
    });
});
