/**
 * F35 item 70, the CAM palette: BUILD SETUPS / APPLY TOOLPATHS show the shared loading card (core/loading-signal.js,
 * styles/loading-stage.css) with the CAM steps declared once in CAM-builder/ui/html/cam-stages.js, registered by
 * cam-loading.js. The add-in side: CAM-builder/test_cam_stages.py.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import CAM_STAGES from '../bspline-frame-builder/CAM-builder/ui/html/cam-stages.js';
import { LOADING_STAGES, LOADING_SEQUENCES, currentLoadingStage, resetLoadingSignal } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';

const PALETTE = readFileSync('bspline-frame-builder/CAM-builder/ui/html/cam_builder_palette.html', 'utf8');
let root;
beforeAll(async () => {
  root = document.createElement('div');
  root.innerHTML = '<div id="loading-stage" hidden><span class="loading-stage-text"></span></div>';
  document.body.appendChild(root);
  await import('../bspline-frame-builder/CAM-builder/ui/html/cam-loading.js'); // registers the stages, window.camLoading
});
afterEach(() => resetLoadingSignal());

describe('the CAM steps, declared once', () => {
  it('is pure JSON after the line-start export (how cam-builder.py reads it); sequences name declared ids only', () => {
    const src = readFileSync('bspline-frame-builder/CAM-builder/ui/html/cam-stages.js', 'utf8');
    const m = /^export default/m.exec(src);
    expect(JSON.parse(src.slice(m.index + m[0].length).trim().replace(/;$/, ''))).toEqual(CAM_STAGES);
    const ids = CAM_STAGES.stages.map((s) => s.id);
    for (const seq of Object.values(CAM_STAGES.sequences)) for (const id of seq) expect(ids).toContain(id);
  });

  it('cam-loading.js registers them on the shared tables: waiting cards "Fusion: <label>", the two sequences', () => {
    for (const s of CAM_STAGES.stages) expect(LOADING_STAGES[s.id]).toEqual({ group: 'waiting', label: `Fusion: ${s.label}`, surface: 'card' });
    expect(LOADING_SEQUENCES.camBuild.stages).toEqual(CAM_STAGES.sequences.camBuild);
    expect(LOADING_SEQUENCES.camApply.stages).toEqual(CAM_STAGES.sequences.camApply);
  });
});

describe('window.camLoading (the palette calls it)', () => {
  it('begin paints the first step of the sequence; stage moves on; end closes it', async () => {
    await window.camLoading.begin('camBuild');
    expect(currentLoadingStage()).toEqual({ id: 'camWcs', text: 'Waiting - Fusion: preparing the stock sketches, step 1 of 4', surface: 'card' });
    await window.camLoading.stage('camSetups');
    expect(currentLoadingStage().text).toBe('Waiting - Fusion: building the Setups, step 4 of 4');
    window.camLoading.end();
    await new Promise((r) => setTimeout(r, 400)); // the shared minimum visible time
    expect(currentLoadingStage()).toBe(null);
  });
});

describe('the CAM palette wiring', () => {
  it('links the shared stylesheet, carries the overlay, loads cam-loading.js as a module', () => {
    expect(PALETTE).toContain('href="../../../styles/loading-stage.css"');
    expect(PALETTE).toMatch(/<div id="loading-stage" class="loading-stage" hidden/);
    expect(PALETTE).toContain('<script type="module" src="./cam-loading.js"></script>');
  });

  it('BUILD and APPLY begin their sequence BEFORE sending; build_confirm and report end it; cam_stage holds the step', () => {
    expect(PALETTE).toMatch(/withCamStages\('camBuild', \(\) => send\('build'/);
    expect(PALETTE).toMatch(/withCamStages\('camApply', \(\) => send\('apply_toolpaths'/);
    expect(PALETTE).toMatch(/action === 'build_confirm'\) \{ if \(window\.camLoading\) window\.camLoading\.end\(\)/);
    expect(PALETTE).toMatch(/action === 'cam_stage'\) \{ if \(window\.camLoading && payload\.id\) window\.camLoading\.stage\(payload\.id\)/);
    expect(PALETTE).toMatch(/action === 'report' && window\.camLoading\) window\.camLoading\.end\(\)/);
  });
});
