/**
 * Device + layout diagnostics (Fred 2026-11-25), folded into Settings > Log for Claude (main/copy-log.js, one save/copy path
 * with its own clipboard-refused box): the log JSON's `diagnostics` field. Nothing is sent anywhere automatically.
 * DIAG_PROBES is the one declared table: a label + a getter each (a getter that throws prints "n/a", never breaks the
 * report). Extend the table to add a line.
 */
import { P } from '../core/state.js';
import { MOBILE_QUERY, LANDSCAPE_PHONE_QUERY } from '../editor/breakpoints.js';

// -- the error ring buffer (installed once from app start) --
export const ERROR_RING_SIZE = 20;
const _ring = [];
let _installed = false;
export function pushDiagError(msg) {
  _ring.push(String(msg).slice(0, 200));
  while (_ring.length > ERROR_RING_SIZE) _ring.shift();
}
export const diagErrors = () => _ring.slice();
export function installErrorRing(win = typeof window !== 'undefined' ? window : null) {
  if (_installed || !win) return;
  _installed = true;
  win.addEventListener('error', (e) => pushDiagError(`${e.message || 'error'} @${(e.filename || '').split('/').pop()}:${e.lineno || 0}`));
  win.addEventListener('unhandledrejection', (e) => pushDiagError(`unhandled: ${(e.reason && e.reason.message) || e.reason}`));
  const con = win.console;
  if (con && typeof con.error === 'function') {
    const orig = con.error.bind(con);
    con.error = (...a) => {
      try { pushDiagError(a.map((x) => (x && x.message) || String(x)).join(' ')); } catch (_) { /* never break logging */ }
      orig(...a);
    };
  }
}

const r1 = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n * 10) / 10 : n);
const rect = (el) => {
  if (!el) return 'missing';
  const b = el.getBoundingClientRect();
  return `x${r1(b.left)} y${r1(b.top)} w${r1(b.width)} h${r1(b.height)}`;
};
const mq = (w, q) => { try { return !!(w.matchMedia && w.matchMedia(q).matches); } catch (_) { return false; } };

/** Height in px of a hidden fixed element sized `unit` (100vh / 100dvh). */
export function measureViewportUnit(doc, unit) {
  const el = doc.createElement('div');
  el.style.cssText = `position:fixed;left:0;top:0;width:1px;height:${unit};visibility:hidden;pointer-events:none`;
  doc.body.appendChild(el);
  const h = el.getBoundingClientRect().height;
  el.remove();
  return h;
}

export const PANEL_HEADER_LIMIT = 12;

/** The declared probes: { label, get({ w, d, P }) -> string|number }. */
export const DIAG_PROBES = [
  { label: 'app', get: ({ d }) => (d.getElementById('build-badge')?.textContent || 'unknown').trim() },
  { label: 'time', get: () => new Date().toISOString() },
  { label: 'userAgent', get: ({ w }) => w.navigator.userAgent },
  { label: 'platform', get: ({ w }) => w.navigator.platform },
  { label: 'devicePixelRatio', get: ({ w }) => w.devicePixelRatio },
  { label: 'pointer', get: ({ w }) => (mq(w, '(pointer: coarse)') ? 'coarse' : mq(w, '(pointer: fine)') ? 'fine' : 'none/unknown') },
  { label: 'orientation', get: ({ w }) => (mq(w, '(orientation: portrait)') ? 'portrait' : 'landscape') },
  { label: 'inner w x h', get: ({ w }) => `${w.innerWidth} x ${w.innerHeight}` },
  { label: 'visualViewport', get: ({ w }) => { const v = w.visualViewport; return v ? `w${r1(v.width)} h${r1(v.height)} offsetTop${r1(v.offsetTop)} scale${r1(v.scale)}` : 'none'; } },
  { label: 'documentElement.clientHeight', get: ({ d }) => d.documentElement.clientHeight },
  { label: '100vh / 100dvh px', get: ({ d }) => `${r1(measureViewportUnit(d, '100vh'))} / ${r1(measureViewportUnit(d, '100dvh'))}` },
  { label: 'page scrollTop / scrollHeight', get: ({ d }) => { const s = d.scrollingElement || d.documentElement; return `${r1(s.scrollTop)} / ${r1(s.scrollHeight)}`; } },
  { label: 'header rect', get: ({ d }) => rect(d.querySelector('.cad-app-shell header') || d.querySelector('header.cad-navbar') || d.querySelector('header')) },
  { label: 'sidebar scroller', get: ({ d }) => { const s = d.querySelector('.cad-sidebar'); return s ? `${rect(s)} scrollTop${r1(s.scrollTop)}` : 'missing'; } },
  { label: 'editor open / drawer', get: ({ d }) => {
    const m = d.getElementById('svgEditorModal');
    const dr = d.getElementById('editorMobileDrawer');
    const open = !!m && m.style.display !== 'none';
    return `${open ? 'open' : 'closed'} / drawer ${dr ? `h${r1(dr.getBoundingClientRect().height)} style.height="${dr.style.height}"` : 'missing'}`;
  } },
  { label: 'Material Symbols font', get: ({ d }) => (d.fonts && d.fonts.check ? (d.fonts.check('16px "Material Symbols Outlined"') ? 'loaded' : 'NOT loaded') : 'n/a') },
  { label: 'layout mode', get: ({ w }) => (mq(w, MOBILE_QUERY) ? 'phone (drawer)' : mq(w, LANDSCAPE_PHONE_QUERY) ? 'landscape phone' : 'column (desktop)') },
  { label: 'board', get: ({ P: p }) => `${p.widthIn} x ${p.heightIn} in, carveZ ${p.carveZ}, frame template ${(p.frame && p.frame.templateId) || 'none'}` },
  { label: 'last errors', get: () => { const e = diagErrors(); return e.length ? '\n  ' + e.join('\n  ') : 'none'; } },
  { label: 'sidebar panel headers', get: ({ d }) => {
    const hs = [...d.querySelectorAll('.cad-sidebar .panel-header')].slice(0, PANEL_HEADER_LIMIT);
    return hs.length ? '\n  ' + hs.map((h) => { const b = h.getBoundingClientRect(); return `x${r1(b.left)} w${r1(b.width)} ${String(h.className).replace(/\s+/g, '.')}`; }).join('\n  ') : 'none';
  } },
];

export function diagnosticsReport(ctx = {}) {
  const c = { w: ctx.w || window, d: ctx.d || document, P: ctx.P || P };
  const lines = ['bspline diagnostics'];
  for (const pr of DIAG_PROBES) {
    let v;
    try { v = pr.get(c); } catch (e) { v = `n/a (${e && e.message})`; }
    lines.push(`${pr.label}: ${v}`);
  }
  return lines.join('\n');
}

/** The structured form for the Save log JSON: { fields: {label: value}, errors: [..], text }. */
export function diagnosticsData(ctx = {}) {
  const c = { w: ctx.w || window, d: ctx.d || document, P: ctx.P || P };
  const fields = {};
  for (const pr of DIAG_PROBES) {
    try { fields[pr.label] = pr.get(c); } catch (e) { fields[pr.label] = `n/a (${e && e.message})`; }
  }
  return { fields, errors: diagErrors(), text: diagnosticsReport(ctx) };
}
