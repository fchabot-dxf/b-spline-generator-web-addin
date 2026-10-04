/**
 * The advisor (audit-fixes C8 review): a Wall click then Generate on a hidden Bricks layer re-laid twice
 * and stacked two identical warning toasts. showToast drops a repeat of the same text within
 * TOAST_DEDUPE_MS; a different text, or the same text after the window, still shows.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast, TOAST_DEDUPE_MS } from '../bspline-frame-builder/b-spline-gen/html/core/toast.js';

const count = () => document.getElementById('cpmToastHost')?.children.length ?? 0;
let t = 1_000_000;
beforeEach(() => { document.body.innerHTML = ''; t += 100_000; vi.spyOn(Date, 'now').mockImplementation(() => t); });
afterEach(() => vi.restoreAllMocks());

describe('showToast de-dupes a repeat of the same text', () => {
  it('the same text twice within the window shows once', () => {
    showToast('Bricks layer is hidden', 'warn');
    t += TOAST_DEDUPE_MS - 1;
    showToast('Bricks layer is hidden', 'warn');
    expect(count()).toBe(1);
  });
  it('a different text still shows', () => {
    showToast('A'); showToast('B');
    expect(count()).toBe(2);
  });
  it('the same text after the window shows again', () => {
    showToast('C');
    t += TOAST_DEDUPE_MS;
    showToast('C');
    expect(count()).toBe(2);
  });
});
