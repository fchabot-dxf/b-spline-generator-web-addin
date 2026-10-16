/**
 * Job timeline step 3, slice 1 (seat D, advisor-approved 2026-10-15): a locked step ('section' readOnly kinds)
 * goes inert via core/ui-utils.js's setSectionReadOnly, resolving by the declared [data-job-lock="<stepId>"] DOM
 * hook -- ONE selector rule for every kind, no hand-picked nodes. Seed and Filter share one sidebar panel
 * (panel-filter) but are separate steps: Seed's own Offset X/Y div + its Generate button carry their OWN
 * data-job-lock="seed", nested inside Filter's wider panel-body (data-job-lock="filter") -- each locks
 * independently of the other, in either direction.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { setSectionReadOnly } from '../bspline-frame-builder/b-spline-gen/html/core/ui-utils.js';
import { JOB_STEP_KINDS } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
});

describe('setSectionReadOnly on the real sidebar markup', () => {
  it('locks every control inside the matched [data-job-lock] scope; restores them', () => {
    const checkbox = document.getElementById('thickenEnabled');
    expect(checkbox.disabled).toBe(false);
    setSectionReadOnly('back', true);
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.closest('[data-job-lock="back"]').getAttribute('aria-disabled')).toBe('true');
    setSectionReadOnly('back', false);
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.closest('[data-job-lock="back"]').getAttribute('aria-disabled')).toBe('false');
  });

  it('a root that is itself a control (the Generate New Seed button, not a container) is disabled directly', () => {
    const btn = document.getElementById('btnRandomSeed');
    expect(btn.disabled).toBe(false);
    setSectionReadOnly('seed', true);
    expect(btn.disabled).toBe(true);
  });

  it('Seed and Filter share one sidebar panel but lock independently: locking Seed never touches Filter\'s own controls', () => {
    const offsetX = document.getElementById('seedOffsetX');
    const noiseType = document.getElementById('noiseType');
    setSectionReadOnly('seed', true);
    expect(offsetX.disabled).toBe(true);
    expect(noiseType.disabled).toBe(false); // Filter's own control, untouched by Seed's lock
  });

  it('...and locking Filter never touches Seed\'s own controls (the reverse direction -- Seed nested inside Filter\'s DOM)', () => {
    const offsetX = document.getElementById('seedOffsetX');
    const offsetY = document.getElementById('seedOffsetY');
    const btn = document.getElementById('btnRandomSeed');
    const noiseType = document.getElementById('noiseType');
    const macroScale = document.getElementById('macroScale');
    setSectionReadOnly('filter', true);
    expect(noiseType.disabled).toBe(true);
    expect(macroScale.disabled).toBe(true);
    expect(offsetX.disabled).toBe(false); // Seed's own control, nested inside Filter's panel-body -- stays live
    expect(offsetY.disabled).toBe(false);
    expect(btn.disabled).toBe(false); // Seed's Generate button lives outside panel-filter entirely
  });

  it('both locked together (the realistic default-order case: Seed is cut before Filter) disables everything in the shared panel', () => {
    setSectionReadOnly('seed', true);
    setSectionReadOnly('filter', true);
    for (const id of ['seedOffsetX', 'seedOffsetY', 'noiseType', 'macroScale', 'btnRandomSeed']) {
      expect(document.getElementById(id).disabled, id).toBe(true);
    }
  });
});

describe('every declared \'section\' readOnly kind has a real markup hook', () => {
  it('JOB_STEP_KINDS declares readOnly (\'section\' or \'layer\') for every kind', () => {
    for (const [id, k] of Object.entries(JOB_STEP_KINDS)) {
      expect(['section', 'layer'], id).toContain(k.readOnly);
    }
  });
  it('every SECTION-readOnly kind\'s own id matches at least one [data-job-lock] element in the real sidebar', () => {
    for (const [id, k] of Object.entries(JOB_STEP_KINDS)) {
      if (k.readOnly !== 'section') continue;
      expect(document.querySelectorAll(`[data-job-lock="${id}"]`).length, id).toBeGreaterThan(0);
    }
  });
});
