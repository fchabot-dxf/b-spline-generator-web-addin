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

if (typeof window !== 'undefined') window.camSetupCardState = setupCardState; // the palette's classic script
