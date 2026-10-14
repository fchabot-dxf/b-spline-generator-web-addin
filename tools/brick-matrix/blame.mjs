// blame.mjs -- names the app code a CPU profile spent its samples in, per time window (seat D 2026-10-11; first written
// for tools/repro/project_load_audit.mjs, shared here for the blind group's BLIND_PROFILE).
// The profile's clock is mapped to performance.now() by an anchor: the page's window.__profMark (PROF_MARK) busy-waits
// 20 ms and returns its own start time; the first sample inside it is that time.
// (MEASURED 2026-10-11: assuming the profile starts at t0 put every blind window outside the samples -- empty blames.)
export const PROF_MARK = `window.__profMark = window.__profMark || function __profMark() { const t = performance.now(), e = t + 20; while (performance.now() < e); return t; };`;

/** windows: [[label, fromMs, toMs]] in performance.now() time. Returns [{ w, top: [[ms, 'fn@file:line <- caller ...']] }]. */
export function blame(p, windows, markT, depth = 4) {
  const byId = new Map(p.nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const app = (n) => n.callFrame.url.includes('/html/') ? `${n.callFrame.functionName || '(anon)'}@${n.callFrame.url.split('/html/').pop()}:${n.callFrame.lineNumber + 1}` : null;
  const chain = (id) => { const out = []; for (let k = id; k != null && out.length < depth; k = parent.get(k)) { const a = app(byId.get(k)); if (a) out.push(a); } return out.join(' <- ') || '(no app frame: ' + (byId.get(id)?.callFrame.functionName || 'native') + ')'; };
  const res = windows.map(([w]) => ({ w, ms: {} }));
  let off = null, acc = 0;
  for (let i = 0; i < p.samples.length; i++) { acc += p.timeDeltas[i] / 1000; if (byId.get(p.samples[i])?.callFrame.functionName === '__profMark') { off = markT - acc; break; } }
  if (off == null) return windows.map(([w]) => ({ w, top: [[0, '(no __profMark sample: unanchored)']] }));
  let t = 0;
  for (let i = 0; i < p.samples.length; i++) {
    t += p.timeDeltas[i] / 1000; const at = off + t;
    const k = windows.findIndex(([, a, b]) => at >= a && at < b); if (k < 0) continue;
    const c = chain(p.samples[i]); res[k].ms[c] = (res[k].ms[c] || 0) + (p.timeDeltas[i + 1] || p.timeDeltas[i]) / 1000;
  }
  return res.map(({ w, ms }) => ({ w, top: Object.entries(ms).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, v]) => [Math.round(v), c]) }));
}
