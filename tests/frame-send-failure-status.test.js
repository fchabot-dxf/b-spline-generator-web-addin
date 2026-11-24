/**
 * 2026-11-24 (live check of Back: Flat): Fusion refused the frame's trim cut, the add-in's frame_result said so (now
 * ok: false), and the very next message -- import_success -- painted "Imported into Fusion ✓" over it. The failure now
 * rides on import_success as `frameError` (b-spline-gen.py, send_targets.send_frame_error); main.js shows the status
 * importSuccessStatus gives.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { importSuccessStatus } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

const FAILED = 'The frame was not fully built in Fusion: t1_TRIM_CUT: 3 : EXTRUDE_CREATION_FAIL_ERROR - Cannot complete extrusion.';

describe('a frame that failed stays on the status line after the Send', () => {
  it('import_success carrying a frameError reads as a warning naming the feature and Fusion\'s message', () => {
    const s = importSuccessStatus(JSON.stringify({ target: 'replace', boardId: null, frameError: FAILED }));
    expect(s.kind).toBe('warn');
    expect(s.text).toContain('t1_TRIM_CUT');
    expect(s.text).toContain('Cannot complete extrusion');
  });

  it('a Send with no frame failure reads as before', () => {
    expect(importSuccessStatus(JSON.stringify({ target: 'replace', boardId: null }))).toEqual({ text: 'Imported into Fusion ✓', kind: 'ok' });
    expect(importSuccessStatus('')).toEqual({ text: 'Imported into Fusion ✓', kind: 'ok' });
  });

  it('main.js paints the import_success status from importSuccessStatus', () => {
    const main = readFileSync('bspline-frame-builder/b-spline-gen/html/main/main.js', 'utf-8');
    const at = main.indexOf("action === 'import_success'");
    const block = main.slice(at, main.indexOf('return;', at));
    expect(block).toContain('importSuccessStatus(ev.detail.data)');
    expect(block).not.toContain("'Imported into Fusion ✓'");
  });
});
