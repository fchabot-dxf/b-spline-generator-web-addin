/**
 * Fred 2026-11-22 (iPad, Chrome on iPadOS = WebKit): the top-bar buttons showed NO icons -- blank, or a dark block --
 * while the panel-header emoji (plain text, no special CSS) render fine. Only the navbar icon spans carried a forced
 * emoji font stack + `font-variant-emoji: emoji`, so that rule is gone: the navbar emoji render exactly like the panel
 * emoji. A text-default emoji code point carries U+FE0F in the markup instead (as the terrain panel's mountain does).
 * Runs on the REAL palette markup.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const STYLES = [...HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
const NAV_IDS = ['btnGlobalUndo', 'btnGlobalRedo', 'btnQuickSave', 'btnNewProject', 'btnOpenProjectManager',
  'btnPullFromFusion', 'btnDownloadAddin', 'settings-btn'];
const navButtons = () => [...document.querySelectorAll('.cad-navbar .cad-nav-btn')];
const iconSpan = (btn) => btn.querySelector(':scope > span:not(.cad-nav-label)');

describe('the navbar emoji render like the panel emoji (no forced emoji font)', () => {
  beforeEach(() => { document.body.innerHTML = BODY; });

  it('the navbar holds the eight icon buttons, each with one icon span', () => {
    expect(navButtons().map((b) => b.id)).toEqual(NAV_IDS);
    for (const btn of navButtons()) expect(iconSpan(btn), btn.id).not.toBeNull();
  });

  it('no palette style rule that reaches a navbar span sets font-family or font-variant-emoji', () => {
    const rules = [...STYLES.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, sel]) => /cad-nav-btn[^,{]*span|cad-navbar[^,{]*span/.test(sel));
    for (const [, sel, body] of rules) {
      expect(body, sel.trim()).not.toMatch(/font-family|font-variant-emoji/);
    }
    expect(STYLES).not.toMatch(/font-variant-emoji/);
  });

  it('no icon span overrides its font inline', () => {
    for (const btn of navButtons()) {
      const style = iconSpan(btn).getAttribute('style') || '';
      expect(style, btn.id).not.toMatch(/font-family|font-variant/);
    }
  });

  it('each emoji glyph is emoji-default or carries U+FE0F (a text-default code point would draw monochrome)', () => {
    for (const btn of navButtons()) {
      const cps = [...iconSpan(btn).textContent.trim()];
      cps.forEach((ch, i) => {
        if (/\p{Extended_Pictographic}/u.test(ch) && !/\p{Emoji_Presentation}/u.test(ch)) {
          expect(cps[i + 1], `${btn.id}: ${ch} U+${ch.codePointAt(0).toString(16)}`).toBe('️');
        }
      });
    }
  });
});
