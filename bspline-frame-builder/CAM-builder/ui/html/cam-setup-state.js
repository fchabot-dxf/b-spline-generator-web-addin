// The CAM palette's setup cards (B-spline tab): what each card's status reads, declared once. Sources, all one shape
// (cam_engine/toolpath_gen.py setup_states; a BUILD report's entries carry no counts):
//   - a BUILD report           {name, ok}                  -> built / failed
//   - the final TPGen report   {name, ok, ops, toolpaths}  -> toolpaths n/m (the post-audit's own walk)
//   - the palette opening      {name, ok, ops, toolpaths}  -> the doc as it is (get_setup_states; read-only)
// MEASURED 2026-10-07: after APPLY a card still read "ok" (= built) whatever its toolpaths, and a palette opened on an
// already-built doc read "pending" on every card.

/** -> { state: 'pending' | 'ok' | 'fail' (the dot), text (the label) } */
export function setupCardState(entry) {
  if (!entry) return { state: 'pending', text: 'pending' };
  if (entry.ok === false) return { state: 'fail', text: 'failed' };
  if (entry.ops == null) return { state: 'ok', text: 'built' };
  if (entry.ops === 0) return { state: 'ok', text: 'built · no operations' };
  const done = entry.toolpaths || 0;
  const missing = entry.ops - done;
  return missing > 0
    ? { state: 'fail', text: `toolpaths ${done}/${entry.ops} · ${missing} missing` }
    : { state: 'ok', text: `toolpaths ${entry.ops}/${entry.ops}` };
}

/** Fred-facing lines for a card's ops without a valid toolpath (2026-10-07: the card said "1 missing" but not which
 *  op or why; the add-in knows both -- toolpath_gen.setup_states 'missing', Fusion's own reason). */
export function missingLines(entry) {
  return ((entry && entry.missing) || []).map((m) => `${m.op}: ${m.why ? `Fusion says "${m.why}"` : 'no reason given by Fusion'}`);
}

/** The B-spline tab's header line from the same entries (it was static text: "3 MMs · 4 SETUPS · READY" on a doc
 *  with no CAM at all). [] -> NO CAM YET; counts -> the toolpaths over every op; no counts (a BUILD report) -> BUILT. */
export function headerSummary(entries) {
  const list = entries || [];
  if (!list.length) return 'NO CAM YET';
  const n = `${list.length} SETUP${list.length === 1 ? '' : 'S'}`;
  if (list.some((e) => e.ok === false)) return `${n} · BUILD FAILED`;
  if (list.some((e) => e.ops == null)) return `${n} · BUILT`;
  const ops = list.reduce((s, e) => s + e.ops, 0), done = list.reduce((s, e) => s + (e.toolpaths || 0), 0);
  return ops ? `${n} · TOOLPATHS ${done}/${ops}` : `${n} · BUILT`;
}

if (typeof window !== 'undefined') { // the palette's classic script
  window.camSetupCardState = setupCardState;
  window.camSetupHeader = headerSummary;
  window.camSetupMissing = missingLines;
}
