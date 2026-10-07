/**
 * F35 item 43 (Fred: "a tab system would work best instead of a left toolbar"; OK on mockup v2): the Brick tools are a
 * TAB STRIP at the top of the Brick panel -- General first, then one tab per BRICK_TOOLS `tab` in its order; Stripe
 * has no tab (Brush > Stripe). The left rail no longer shows for Brick. Each shared row block's scope is declared
 * (BRICK_ROW_SCOPES). Markup checks read the REAL palette.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { brickTabs, BRICK_GENERAL_TAB, BRICK_ROW_SCOPES, BRICK_SUB_TOOLS } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { BRICK_TAB_SECTIONS } from '../bspline-frame-builder/b-spline-gen/html/main/brick-tab-sections.js';
import { EDITOR_TABS } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
// the <body> only, without its scripts (markup checks; the head's web fonts would be fetched)
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const doc = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html');
const $ = (id) => doc.getElementById(id);

describe('item 43: the Brick tab strip', () => {
  it('declared tabs: General, Wall, Frame, Brush, Raised, Scissors -- no Stripe tab; each keeps its tool button id', () => {
    expect(brickTabs().map((t) => t.label)).toEqual(['General', 'Wall', 'Frame', 'Brush', 'Raised', 'Scissors']);
    expect(brickTabs()[0]).toMatchObject({ id: BRICK_GENERAL_TAB.id, buttonId: 'brickTab_general' });
    expect(brickTabs().find((t) => t.id === 'wall').buttonId).toBe('brickTool_wall');
    expect(brickTabs().some((t) => t.id === 'stripe')).toBe(false);
    expect(BRICK_SUB_TOOLS.stripe).toMatchObject({ tool: 'stripe' });
  });

  it('at most two rows at the default width: three icon tabs per row fit', () => {
    expect(brickTabs().length).toBeLessThanOrEqual(6);
    const css = readFileSync('bspline-frame-builder/styles/layout-app.css', 'utf8');
    expect(css).toMatch(/\.ui-tab-strip--icons\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(56px/);
  });

  it('the strip is the first thing in the Brick panel (its pinned block), Generate right under it', () => {
    const strip = $('editorToolbarBrick');
    expect(strip.closest('aside').id).toBe('editorBrickPanel');
    const block = strip.parentElement;
    expect(block.classList.contains('sticky-actions')).toBe(true);
    expect(block.parentElement.firstElementChild).toBe(block);
    expect(block.firstElementChild).toBe(strip);
    expect(strip.nextElementSibling.id).toBe('brickGenerate');
  });

  it('the left rail no longer holds a Brick toolbar (Photo keeps its own rail)', () => {
    const rail = doc.querySelector('aside.editor-sidebar');
    expect(rail.querySelector('#editorToolbarBrick')).toBeNull();
    expect(rail.querySelector('#editorToolbarPhoto')).not.toBeNull();
    expect(EDITOR_TABS.find((t) => t.id === 'brick').toolbarId).toBeNull();
    expect(EDITOR_TABS.find((t) => t.id === 'photo').toolbarId).toBe('editorToolbarPhoto');
  });

  it('every block of the shared rows has a declared scope, and every declared one exists', () => {
    for (const id of Object.keys(BRICK_ROW_SCOPES)) expect($(id), id).not.toBeNull();
    const blocks = [...$('brickSharedLayout').children];
    expect(blocks.length).toBeGreaterThan(0);
    // Brick-tab v2: a row is declared by its scope or by the Brick-tab section that holds it
    const sectionRows = new Set(Object.values(BRICK_TAB_SECTIONS).flatMap((t) => t.sections.flatMap((s) => s.rows)));
    for (const b of blocks) expect(BRICK_ROW_SCOPES[b.id] || sectionRows.has(b.id), b.id || b.outerHTML.slice(0, 60)).toBeTruthy();
    expect(new Set(Object.values(BRICK_ROW_SCOPES))).toEqual(new Set(['element', 'global']));
  });

  it('the Stripe section carries the Brush sub-tool row (Draw / Select / Stripe stay in view while striping)', () => {
    expect($('brickStripeSection').querySelector('#brickSubTools_stripe')).not.toBeNull();
  });
});
