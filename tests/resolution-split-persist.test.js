/**
 * F35 item 16 follow-up (Fred, via the advisor): the single 'resolution' setting splits into
 * Display (P.spacing) and Export (P.exportSpacing), with `sameAsDisplayResolution` defaulting true.
 * Round-trips the same generic way every other scalar `P` field already does (core/state.js), same
 * precedent as tests/decal-settings-persist.test.js -- confirmed here rather than assumed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  P, DEFAULT, RESOLUTIONS, updateP, loadLastSession, effectiveExportSpacing,
} from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

describe('Display/Export resolution split — defaults', () => {
  it('sameAsDisplayResolution is ON by default -- every existing board behaves exactly as before', () => {
    expect(DEFAULT.sameAsDisplayResolution).toBe(true);
  });

  it('exportSpacing defaults to the SAME value as spacing', () => {
    expect(DEFAULT.exportSpacing).toBe(DEFAULT.spacing);
  });
});

describe('RESOLUTIONS — Masonry / Masonry max (the measured resolution x brick-size grid)', () => {
  it('adds Masonry (0.015) and Masonry max (0.011) after Extreme, without disturbing the existing entries', () => {
    const names = RESOLUTIONS.map((r) => r.name);
    expect(names).toContain('Masonry');
    expect(names).toContain('Masonry max');
    expect(RESOLUTIONS.find((r) => r.name === 'Masonry').val).toBe(0.015);
    expect(RESOLUTIONS.find((r) => r.name === 'Masonry max').val).toBe(0.011);
    expect(RESOLUTIONS.findIndex((r) => r.name === 'Masonry')).toBeGreaterThan(RESOLUTIONS.findIndex((r) => r.name === 'Extreme'));
  });
});

describe('updateP coercion', () => {
  it('exportSpacing stays a STRING (stringParams, same convention as spacing)', () => {
    updateP('exportSpacing', 0.03);
    expect(P.exportSpacing).toBe('0.03');
    expect(typeof P.exportSpacing).toBe('string');
  });

  it('sameAsDisplayResolution coerces to a real boolean (boolParams, !!value -- same convention as decalEnabled)', () => {
    updateP('sameAsDisplayResolution', false);
    expect(P.sameAsDisplayResolution).toBe(false);
    updateP('sameAsDisplayResolution', 'true'); // a DOM checkbox handler can hand a truthy non-boolean through
    expect(P.sameAsDisplayResolution).toBe(true);
  });
});

describe('effectiveExportSpacing', () => {
  beforeEach(() => { P.spacing = 0.05; P.exportSpacing = 0.015; });

  it('mirrors Display when sameAsDisplayResolution is true', () => {
    P.sameAsDisplayResolution = true;
    expect(effectiveExportSpacing()).toBe(0.05);
  });

  it('uses the independent Export value once decoupled', () => {
    P.sameAsDisplayResolution = false;
    expect(effectiveExportSpacing()).toBe(0.015);
  });

  it('always returns a real Number, even when P.spacing/exportSpacing are strings (the updateP convention)', () => {
    P.sameAsDisplayResolution = true;
    P.spacing = '0.05'; // exactly what updateP's own stringParams coercion stores
    expect(effectiveExportSpacing()).toBe(0.05);
    expect(typeof effectiveExportSpacing()).toBe('number');
  });
});

describe('loadLastSession restore (project load)', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(P, DEFAULT);
  });

  it('restores both fields from a saved session', () => {
    const saved = { P: { sameAsDisplayResolution: false, exportSpacing: '0.011' } };
    localStorage.setItem('splineGenLastSession', JSON.stringify(saved));
    const ok = loadLastSession();
    expect(ok).toBe(true);
    expect(P.sameAsDisplayResolution).toBe(false);
    expect(P.exportSpacing).toBe('0.011');
  });

  it('a project saved BEFORE this split existed (no new keys at all) leaves the defaults untouched -- Export silently mirrors Display, unchanged behaviour', () => {
    localStorage.setItem('splineGenLastSession', JSON.stringify({ P: { widthIn: 11 } }));
    loadLastSession();
    expect(P.widthIn).toBe(11);
    expect(P.sameAsDisplayResolution).toBe(true);
    expect(P.exportSpacing).toBe(DEFAULT.exportSpacing);
  });

  it('a corrupt/non-positive exportSpacing falls back to the default, same safeguard as spacing', () => {
    localStorage.setItem('splineGenLastSession', JSON.stringify({ P: { exportSpacing: -1 } }));
    loadLastSession();
    expect(P.exportSpacing).toBe(DEFAULT.exportSpacing);
  });
});
