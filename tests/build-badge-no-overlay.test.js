/**
 * H23 item 93: the deployed-build status must never cover the header buttons. A worktree deploy read
 * "could not resolve source HEAD" and the palette put it on the fixed status line (#fusion-status, position:fixed over
 * the header) as a 'warn' that never clears (seat A, live, 2026-10-06). Drives the real 'build_info' handshake in
 * main.js's own handler path through the module it now calls.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { paintBuildInfo } from '../bspline-frame-builder/b-spline-gen/html/main/build-badge.js';

const MAIN_JS = readFileSync('bspline-frame-builder/b-spline-gen/html/main/main.js', 'utf8');

function dom() {
    document.body.innerHTML = `
      <button id="settings-btn" title="Settings"></button>
      <div id="fusion-status" class="fusion-status" hidden></div>
      <span id="build-badge" class="cad-nav-version">v1.1.0</span>`;
}
const status = () => document.getElementById('fusion-status');
const settings = () => document.getElementById('settings-btn');

describe('build_info never overlays the header (H23 item 93)', () => {
    beforeEach(dom);

    it("main.js's build_info branch hands the push to paintBuildInfo and never to the status line", () => {
        const branch = MAIN_JS.slice(MAIN_JS.indexOf("action === 'build_info'"));
        const body = branch.slice(0, branch.indexOf('return;', branch.indexOf('paintBuildInfo')) + 7);
        expect(body).toContain('paintBuildInfo(');
        expect(body).not.toContain('setFusionStatus');
    });

    it("'unknown' (can't tell) leaves the status line hidden and only mutes the badge", () => {
        paintBuildInfo({ status: 'unknown', sha: 'c269381', message: 'could not resolve source HEAD' });
        expect(status().hidden).toBe(true);
        expect(document.getElementById('build-badge').className).toContain('build-unknown');
        expect(settings().classList.contains('build-warn')).toBe(false);
    });

    it('a stale deploy marks the Settings button (with the message) instead of the status line', () => {
        paintBuildInfo({ status: 'stale', sha: 'f6536fc', version: '2026.10.06-11', message: 'STALE -- deployed f6536fc' });
        expect(status().hidden).toBe(true);
        expect(settings().classList.contains('build-warn')).toBe(true);
        expect(settings().title).toContain('STALE -- deployed f6536fc');
        expect(document.getElementById('build-badge').textContent).toBe('⚠ 2026.10.06-11 · f6536fc');
    });

    it('an up-to-date deploy clears the mark', () => {
        paintBuildInfo({ status: 'stale', sha: 'f6536fc', message: 'x' });
        paintBuildInfo({ status: 'ok', sha: '45d93aa', version: '2026.10.06-12' });
        expect(settings().classList.contains('build-warn')).toBe(false);
        expect(document.getElementById('build-badge').textContent).toBe('✓ 2026.10.06-12 · 45d93aa');
    });
});
