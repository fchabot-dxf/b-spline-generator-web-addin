/**
 * H23 item 71 — the "Fusion colour decal" settings (decalEnabled/decalResolution/decalOpacity/
 * decalLayerIds) round-trip with the project, the same generic way every other scalar `P` field
 * already does (core/state.js) — no special-casing needed anywhere in updateP/saveLastSession/
 * loadLastSession, confirmed here rather than assumed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { P, DEFAULT, updateP, persistableP, loadLastSession } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

describe('decal settings — defaults', () => {
  it('off by default, 150dpi, 100% opacity, no per-layer overrides', () => {
    expect(DEFAULT.decalEnabled).toBe(false);
    expect(DEFAULT.decalResolution).toBe('150');
    expect(DEFAULT.decalOpacity).toBe(100);
    expect(DEFAULT.decalLayerIds).toEqual({});
  });
});

describe('decal settings — updateP coercion', () => {
  it('decalEnabled coerces to a real boolean (boolParams)', () => {
    updateP('decalEnabled', 'true'); // a DOM checkbox handler can hand a truthy non-boolean through
    expect(P.decalEnabled).toBe(true);
    updateP('decalEnabled', false);
    expect(P.decalEnabled).toBe(false);
  });

  it('decalResolution stays a STRING (stringParams, same convention as `spacing`) — not coerced to a number', () => {
    updateP('decalResolution', '100');
    expect(P.decalResolution).toBe('100');
    expect(typeof P.decalResolution).toBe('string');
  });

  it('decalOpacity is a plain number (neither list) — a string input value parses through', () => {
    updateP('decalOpacity', '75');
    expect(P.decalOpacity).toBe(75);
    expect(typeof P.decalOpacity).toBe('number');
  });
});

describe('decal settings — persistableP carries decalLayerIds through unchanged', () => {
  it('a per-layer dictionary survives the persistable copy', () => {
    const out = persistableP({ ...DEFAULT, decalLayerIds: { layer0: false, layer1: true } });
    expect(out.decalLayerIds).toEqual({ layer0: false, layer1: true });
  });
});

describe('decal settings — loadLastSession restore (project load)', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(P, DEFAULT);
  });

  it('restores all four fields from a saved session, generically — no special-case code needed', () => {
    const saved = {
      P: {
        decalEnabled: true,
        decalResolution: '40',
        decalOpacity: 55,
        decalLayerIds: { layer3: false },
      },
    };
    localStorage.setItem('splineGenLastSession', JSON.stringify(saved));
    const ok = loadLastSession();
    expect(ok).toBe(true);
    expect(P.decalEnabled).toBe(true);
    expect(P.decalResolution).toBe('40');
    expect(P.decalOpacity).toBe(55);
    expect(P.decalLayerIds).toEqual({ layer3: false });
  });

  it('a project saved BEFORE item 71 existed (no decal keys at all) leaves the defaults untouched, not undefined', () => {
    localStorage.setItem('splineGenLastSession', JSON.stringify({ P: { widthIn: 11 } }));
    loadLastSession();
    expect(P.widthIn).toBe(11);
    expect(P.decalEnabled).toBe(false);
    expect(P.decalResolution).toBe('150');
    expect(P.decalOpacity).toBe(100);
    expect(P.decalLayerIds).toEqual({});
  });
});
