/**
 * The CAM palette's setup cards (CAM-builder/ui/html/cam-setup-state.js). MEASURED 2026-10-07: after APPLY a card read
 * "ok" (= built) whatever its toolpaths, and a palette opened on an already-built doc read "pending" on every card.
 * Now one declared map reads every source: a BUILD report, the final TPGen report and the doc on open.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { setupCardState } from '../bspline-frame-builder/CAM-builder/ui/html/cam-setup-state.js';

describe('the declared card states', () => {
  it('no entry -> pending; a failed build -> failed', () => {
    expect(setupCardState(undefined)).toEqual({ state: 'pending', text: 'pending' });
    expect(setupCardState({ name: 'Frame', ok: false })).toEqual({ state: 'fail', text: 'failed' });
  });
  it('a BUILD report (no counts) -> built; a setup with no ops (Stock, or before APPLY) -> built, no operations', () => {
    expect(setupCardState({ name: 'Frame', ok: true })).toEqual({ state: 'ok', text: 'built' });
    expect(setupCardState({ name: 'Stock', ok: true, ops: 0, toolpaths: 0 })).toEqual({ state: 'ok', text: 'built · no operations' });
  });
  it('after the toolpaths: every op valid -> toolpaths n/n; one missing -> a red dot that says how many', () => {
    expect(setupCardState({ name: 'Frame', ok: true, ops: 2, toolpaths: 2 })).toEqual({ state: 'ok', text: 'toolpaths 2/2' });
    expect(setupCardState({ name: 'B-spline Top', ok: true, ops: 3, toolpaths: 2 })).toEqual({ state: 'fail', text: 'toolpaths 2/3 · 1 missing' });
  });
});

describe('the palette reads every source through it', () => {
  const html = readFileSync('bspline-frame-builder/CAM-builder/ui/html/cam_builder_palette.html', 'utf8');
  it('loads the map, asks for the doc\'s states when the B-spline tab boots, and shows reports + states the same way', () => {
    expect(html).toContain('<script type="module" src="./cam-setup-state.js"></script>');
    expect(html).toMatch(/send\('get_template_assignments'\);\s*\n\s*send\('get_setup_states'\);/);
    expect(html).toMatch(/if \(action === 'setup_states'\) \{ \(payload\.setups \|\| \[\]\)\.forEach\(showSetupEntry\); return; \}/);
    expect(html).toMatch(/\(payload\.setups \|\| \[\]\)\.forEach\(showSetupEntry\);\n/);
    expect(html).not.toMatch(/setSetupState\(key, s\.ok \? 'ok' : 'fail'\)/); // the old ok/fail-only path is gone
  });
});
