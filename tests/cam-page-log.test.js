/**
 * H23 item 101 (live, seat A readback 2): an APPLY clicked during a blocked BUILD step never reached the add-in. The CAM
 * palette now keeps its OWN timestamped trail of each BUILD / APPLY click (PAGE_LOG_ACTIONS) and sends each line as
 * 'page_log'; the whole ring goes again with the next build report, so a line lost mid-build still reaches the log.
 * The palette's own functions, extracted from cam_builder_palette.html and run on a stub fusionSendData.
 * The add-in side: CAM-builder/test_page_log.py.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const HTML = readFileSync('bspline-frame-builder/CAM-builder/ui/html/cam_builder_palette.html', 'utf-8');
const grab = (re) => { const m = HTML.match(re); if (!m) throw new Error(`not found: ${re}`); return m[0]; };
const SRC = [
  grab(/const PAGE_LOG_ACTIONS[\s\S]*?\n  function send\(action, payload\) \{[\s\S]*?\n  \}/),
  grab(/function withCamStages\(sequenceId, go\) \{[\s\S]*?\n  \}/),
  grab(/function runApplyToolpaths\(\) \{[\s\S]*?\n  \}/),
].join('\n');

function palette({ throwOnPageLog = false } = {}) {
  const sent = [];
  const window = {
    adsk: { fusionSendData: (action, data) => { if (throwOnPageLog && action === 'page_log') throw new Error('blocked'); sent.push([action, JSON.parse(data)]); return ''; } },
    camLoading: { begin: () => Promise.resolve() },
  };
  const api = new Function('window', 'setStatus', `${SRC}; return { runApplyToolpaths, flushPageLogRing, send, PAGE_LOG };`)(window, () => {});
  return { api, sent, window };
}
const trail = (sent) => sent.filter(([a]) => a === 'page_log').flatMap(([, d]) => d.lines.map((l) => l.slice(13)));

describe('the CAM palette trails each BUILD / APPLY click', () => {
  it('an APPLY click logs click -> begin -> painted -> send -> sent, each as its own page_log, then sends the action', async () => {
    const { api, sent } = palette();
    api.runApplyToolpaths();
    await new Promise((r) => setTimeout(r, 0));
    expect(trail(sent)).toEqual(['APPLY click', 'camApply begin', 'camApply painted -> send', 'send apply_toolpaths', 'sent apply_toolpaths -> ""']);
    expect(sent.filter(([a]) => a === 'apply_toolpaths')).toEqual([['apply_toolpaths', { action: 'apply_toolpaths', mode: 'bspline' }]]);
    expect(sent.find(([a]) => a === 'page_log')[1].lines[0]).toMatch(/^\d\d:\d\d:\d\d\.\d{3} APPLY click$/);
  });
  it('a line whose own send fails stays in the ring, and the report re-sends the whole ring', async () => {
    const { api, sent, window } = palette({ throwOnPageLog: true });
    api.runApplyToolpaths();
    await new Promise((r) => setTimeout(r, 0));
    expect(trail(sent)).toEqual([]);
    window.adsk.fusionSendData = (action, data) => { sent.push([action, JSON.parse(data)]); return ''; };
    api.flushPageLogRing();
    const ring = sent.find(([a, d]) => a === 'page_log' && d.ring);
    expect(ring[1].lines.map((l) => l.slice(13))).toContain('APPLY click');
    expect(ring[1].lines.some((l) => l.includes('page_log send threw'))).toBe(true);
  });
  it('an untraced action leaves no trail; the report handler flushes the ring', () => {
    const { api, sent } = palette();
    api.send('list_cam_templates');
    expect(trail(sent)).toEqual([]);
    expect(HTML).toMatch(/if \(action === 'report'\) flushPageLogRing\(\);/);
    expect(HTML).toMatch(/function runBuild\(confirmed\) \{\s*pageLog\('BUILD click'/);
  });
});
