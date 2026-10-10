/**
 * 2026-10-10 (seat A; the fresh phone map: getProgramInfoLog + getShaderInfoLog ~4.7 s of self time over 44 slow
 * actions): three.js's per-compile shader check (renderer.debug.checkShaderErrors) is ON on development hosts and with
 * ?debug, OFF on the live site and in the Fusion palette -- declared in core/render-debug.js, applied by both renderers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SHADER_CHECK_HOSTS, shaderChecksOn } from '../bspline-frame-builder/b-spline-gen/html/core/render-debug.js';

const loc = (href) => new URL(href);

describe('shader compile checks: development only', () => {
  it('declares its development hosts', () => {
    expect(SHADER_CHECK_HOSTS).toEqual(['localhost', '127.0.0.1']);
  });
  it('on for localhost / 127.0.0.1 and for ?debug anywhere', () => {
    expect(shaderChecksOn(loc('http://localhost:8080/bspline-frame-builder/b-spline-gen/html/index.html'))).toBe(true);
    expect(shaderChecksOn(loc('http://127.0.0.1:9602/b-spline-gen/html/index.html'))).toBe(true);
    expect(shaderChecksOn(loc('https://bspline-generator.pages.dev/?debug'))).toBe(true);
    expect(shaderChecksOn(loc('https://bspline-generator.pages.dev/?x=1&debug=1'))).toBe(true);
  });
  it('off on the live site and in the Fusion palette (a file: page)', () => {
    expect(shaderChecksOn(loc('https://bspline-generator.pages.dev/'))).toBe(false);
    expect(shaderChecksOn(loc('https://bspline-generator.pages.dev/b-spline-gen/html/index.html?board=1'))).toBe(false);
    expect(shaderChecksOn(loc('file:///C:/Users/x/AppData/Roaming/Autodesk/AddIns/bspline-frame-builder/b-spline-gen/html/index.html'))).toBe(false);
  });
  it('on when there is no location (tests, workers): the safe default', () => {
    expect(shaderChecksOn(null)).toBe(true);
  });
  it('both renderers take it from the declaration', () => {
    for (const f of ['core/preview/index.js', 'core/preview/view-cube.js']) {
      const src = readFileSync(`bspline-frame-builder/b-spline-gen/html/${f}`, 'utf8');
      expect(src, f).toMatch(/this\._renderer\.debug\.checkShaderErrors = shaderChecksOn\(\);/);
      expect(src, f).toContain("import { shaderChecksOn } from '../render-debug.js';");
    }
  });
});
