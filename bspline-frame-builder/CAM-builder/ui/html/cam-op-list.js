// The CAM palette's Toolpaths list (Fred, 2026-10-20): each operation of every setup, in order, with its tool, its state and
// its own Generate button, plus "Generate all missing" per setup and for everything. One generation runs at a time and can
// be stopped. NO input fields: only buttons, states and text.
//
// The add-in (cam_engine/op_states.py, op_queue.py) sends {setups: [{name, ops: [{key, name, tool, rest, strategy, state,
// why, src, dup}]}], run: {on, setup, key, name, elapsed, percent, queued, next, durations, failed, message}}. The states are
// read from Fusion (suppressed / error / none / stale / warn / valid); this module declares how each reads and which button
// it gets, builds the view model (pure, tested) and paints it (renderOpList).

/** One declared map: state -> the dot class, the label, and the button its row gets. */
export const OP_STATES = {
  valid:      { dot: 'valid',  label: 'generated',     button: 'Regenerate' },
  warn:       { dot: 'warn',   label: 'warning',       button: 'Regenerate' },
  stale:      { dot: 'stale',  label: 'out of date',   button: 'Regenerate', why: 'settings changed since it was generated' },
  error:      { dot: 'error',  label: 'error',         button: 'Retry' },
  none:       { dot: 'none',   label: 'not generated', button: 'Generate' },
  suppressed: { dot: 'supp',   label: 'suppressed',    button: 'Generate' },
};

/** 102 -> '1 min 42 s'; 4.1 -> '4.1 s'; null -> ''. */
export function elapsedText(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  if (sec >= 60) { const s = Math.round(sec); return `${Math.floor(s / 60)} min ${s % 60} s`; }
  return `${Math.round(sec * 10) / 10} s`;
}

const isGenerated = (o) => o.state === 'valid' || o.state === 'warn';
const isMissing = (o) => o.state === 'none' || o.state === 'stale' || o.state === 'error';

/** The ops "Generate missing" would run in a setup (suppressed ones are never run). */
export const missingCount = (ops) => (ops || []).filter(isMissing).length;

/** The card's summary line: "4 of 11 generated · 1 out of date · 2 need a look". */
export function summaryText(setups) {
  const ops = (setups || []).flatMap((s) => s.ops || []);
  if (!ops.length) return 'no operations yet';
  const parts = [`${ops.filter(isGenerated).length} of ${ops.length} generated`];
  const stale = ops.filter((o) => o.state === 'stale').length;
  const look = ops.filter((o) => o.state === 'error' || o.state === 'warn').length;
  if (stale) parts.push(`${stale} out of date`);
  if (look) parts.push(`${look} need${look === 1 ? 's' : ''} a look`);
  return parts.join(' · ');
}

/** One row as the list paints it. `run` is the add-in's queue snapshot. */
export function rowView(op, run) {
  const r = run || {};
  const running = !!(r.on && r.key && r.key === op.key);
  const def = OP_STATES[op.state] || OP_STATES.none;
  const sub = [];
  if (op.tool) sub.push({ text: op.tool + (op.rest ? ' · rest on' : '') });
  if (running) {
    const pct = r.percent != null ? ` · ${Math.round(r.percent)}%` : '';
    sub.push({ cls: 'run', bold: 'generating', text: ` · ${elapsedText(r.elapsed)}${pct}` });
  } else if (op.state === 'valid') {
    const secs = (r.durations || {})[op.key];
    sub.push({ cls: 'valid', bold: def.label, text: secs != null ? ` · ${elapsedText(secs)}` : '' });
  } else if (op.state === 'error') {
    sub.push({ cls: 'error', bold: def.label, text: op.why ? ` · Fusion says “${op.why}”` : '' });
  } else if (op.state === 'warn') {
    sub.push({ cls: 'warn', bold: def.label, text: op.why ? ` · ${op.why}` : '' });
  } else if (op.state === 'stale') {
    sub.push({ cls: 'stale', bold: def.label, text: ` · ${def.why}` });
  } else if (op.state === 'suppressed') {
    sub.push({ bold: def.label, text: '' });
  } else {
    sub.push({ bold: def.label, text: '' });
  }
  const failed = (r.failed || {})[op.key];
  if (failed) sub.push({ cls: 'error', bold: 'did not finish', text: ` · ${failed}` });
  if (op.dup) sub.push({ cls: 'warn', text: 'also cuts the holes' });
  const tags = [];
  if (op.src === 'hand') tags.push({ cls: 'hand', text: 'hand-added' });
  if (op.state === 'suppressed') tags.push({ cls: 'supp', text: 'suppressed' });
  let button;
  if (running) button = { label: 'Stop', kind: 'stop', disabled: false, action: 'stop' };
  else if (op.state === 'suppressed') button = null;                                  // never generated from the list
  else button = { label: def.button, kind: '', disabled: !!r.on, action: 'generate' };
  return { key: op.key, name: op.name, dot: running ? 'run' : def.dot, running, suppressed: op.state === 'suppressed', tags, sub, button };
}

/** A setup group: its title counts, and the "Generate missing (n)" button. */
export function groupView(setup, run) {
  const ops = setup.ops || [];
  const missing = missingCount(ops);
  return {
    name: setup.name,
    count: ops.length ? `${ops.filter(isGenerated).length}/${ops.length} generated` : 'no operations',
    button: ops.length ? { label: `Generate missing (${missing})`, disabled: !!(run && run.on) || missing === 0 } : null,
    rows: ops.map((o) => rowView(o, run)),
  };
}

/** The running banner (null when nothing runs, or the last run's message when it just ended). */
export function bannerView(payload) {
  const run = payload.run || {};
  if (!run.on) return run.message ? { idle: true, text: run.message } : null;
  const names = {};
  for (const s of payload.setups || []) for (const o of s.ops || []) names[o.key] = o.name;
  const bits = [elapsedText(run.elapsed)];
  if (run.queued) bits.push(`${run.queued} queued${run.next && names[run.next] ? ` · next: ${names[run.next]}` : ''}`);
  return { idle: false, title: `${run.setup || ''} / ${run.name || ''}`, line: bits.filter(Boolean).join(' · '), percent: run.percent };
}

/** The whole card as data. */
export function listView(payload) {
  const p = payload || {};
  const setups = p.setups || [];
  const run = p.run || {};
  const all = setups.reduce((n, s) => n + missingCount(s.ops), 0);
  return {
    summary: summaryText(setups),
    all: { label: `Generate all missing (${all})`, disabled: !!run.on || all === 0 },
    banner: bannerView(p),
    groups: setups.map((s) => groupView(s, run)),
    hasHand: setups.some((s) => (s.ops || []).some((o) => o.src === 'hand')),
  };
}

// ── painting (DOM; verified in the palette, not in the unit tests) ───────────────────────────────────────────────────
const el = (doc, tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (doc, b, cls, onClick) => {
  const e = el(doc, 'button', `tp-btn ${cls || ''} ${b.kind || ''}`.trim(), b.label);
  e.type = 'button'; e.disabled = !!b.disabled;
  e.addEventListener('click', onClick);
  return e;
};

/** Paint `payload` into `root`. `send(action, data)` posts to the add-in. Buttons, states and text only. */
export function renderOpList(root, payload, send) {
  const doc = root.ownerDocument;
  const v = listView(payload);
  root.textContent = '';
  const head = el(doc, 'div', 'tp-head');
  const titles = el(doc, 'div');
  titles.append(el(doc, 'div', 'tp-title', 'Toolpaths'), el(doc, 'div', 'tp-sum', v.summary));
  head.append(titles, btn(doc, v.all, 'primary', () => send('generate_ops', { scope: 'missing', setup: null })));
  root.append(head);
  if (v.banner) {
    const b = el(doc, 'div', v.banner.idle ? 'tp-note' : 'tp-run');
    if (v.banner.idle) b.textContent = v.banner.text;
    else {
      const body = el(doc, 'div'); body.style.flex = '1';
      const t = el(doc, 'div'); t.append(el(doc, 'b', '', 'Generating '), doc.createTextNode(v.banner.title));
      const l = el(doc, 'div', 'tp-runline', v.banner.line);
      const bar = el(doc, 'div', 'tp-bar'); const i = el(doc, 'i');
      if (v.banner.percent != null) { i.style.width = `${Math.max(2, Math.min(100, v.banner.percent))}%`; i.style.animation = 'none'; }
      bar.append(i); body.append(t, l, bar);
      b.append(body, btn(doc, { label: 'Stop', kind: 'stop' }, '', () => send('stop_generate', {})));
    }
    root.append(b);
  }
  for (const g of v.groups) {
    const grp = el(doc, 'div', 'tp-group');
    const gh = el(doc, 'div', 'tp-ghead');
    const nm = el(doc, 'div', 'tp-gname', g.name); nm.append(el(doc, 'span', 'tp-gcount', g.count));
    gh.append(nm);
    if (g.button) gh.append(btn(doc, g.button, '', () => send('generate_ops', { scope: 'missing', setup: g.name })));
    grp.append(gh);
    for (const r of g.rows) {
      const row = el(doc, 'div', `tp-row${r.running ? ' running' : ''}${r.suppressed ? ' supp' : ''}`);
      row.append(el(doc, 'span', `tp-ico ${r.dot}`, ({ valid: '✓', stale: '!', warn: '!', error: '×' })[r.dot] || ''));
      const main = el(doc, 'div', 'tp-main');
      const name = el(doc, 'div', 'tp-name'); name.append(el(doc, 'span', 'tp-nm', r.name));
      for (const t of r.tags) name.append(el(doc, 'span', `tp-tag ${t.cls}`, t.text));
      const sub = el(doc, 'div', 'tp-sub');
      r.sub.forEach((part, n) => {
        if (n) sub.append(doc.createTextNode(' · '));       // the parts read: tool · state · note
        const s = el(doc, 'span', part.cls || '');
        if (part.bold) s.append(el(doc, 'b', '', part.bold));
        if (part.text) s.append(doc.createTextNode(part.text));
        sub.append(s);
      });
      main.append(name, sub);
      if (r.running) { const bar = el(doc, 'div', 'tp-bar'); bar.append(el(doc, 'i')); main.append(bar); }
      row.append(main);
      if (r.button) row.append(btn(doc, r.button, '', () => (r.button.action === 'stop' ? send('stop_generate', {}) : send('generate_ops', { targets: [[g.name, r.key]] }))));
      grp.append(row);
    }
    root.append(grp);
  }
  if (v.hasHand) root.append(el(doc, 'div', 'tp-note', 'Hand-added operations are listed and can be generated, never changed or deleted. A suppressed operation is skipped by “Generate all missing”.'));
}

if (typeof window !== 'undefined') window.camOpList = { renderOpList, listView, summaryText, elapsedText };
