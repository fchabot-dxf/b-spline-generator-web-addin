/**
 * core/job-timeline.js -- the JOB TIMELINE's data (Fred 2026-10-14, steps 1 + 2; no locking yet): the steps of the job in
 * the order Fred machines and pours them (one resin colour at a time), and a playhead. Pure: no DOM, no app state --
 * main/job-timeline-strip.js draws it, the project keeps it (P.jobTimeline = { order, head }).
 *
 * JOB_STEP_KINDS declares every kind of step once:
 *   label / icon / colour  -- how a step shows;
 *   fixed: 'first'         -- the step is always step 1 and never dragged (Stock);
 *   group                  -- the sub-items of one group: `by: 'layer'` (one group per lattice layer, its layer's name)
 *                             or `by: 'kind'` (one "Vector stamping" group of every vector layer); the ORDER is a flat
 *                             list of sub-item ids (Fred: free interleave) -- groups are only how runs are labelled;
 *   opens                  -- what a click opens (a sidebar section, an editor tab and its layer);
 *   readOnly               -- how a LOCKED step (left of the head) goes inert when opened: 'section' -- every
 *                             [data-job-step="<this step's own id>"] element in the sidebar (main/ui-utils.js
 *                             setSectionReadOnly; the markup hook lives on the panel body, or narrower -- Seed's own
 *                             Offset X/Y + its Generate button, nested inside Filter's wider section, since the two
 *                             steps share one sidebar panel); 'layer' -- the step's OWN editor layer only (a lock
 *                             pushed onto that layer record, main/job-timeline-lock.js -> editor/layers.js), every
 *                             other layer stays editable;
 *   dependsOn              -- the kinds whose result this step's computation READS (data only: the compute pipeline keeps
 *                             its own fixed order; the strip marks a step cut before one it depends on -- detection only).
 * A section that is display / export only (colours, grout colour, Output, the photo's 2D-only edits) is never a step.
 */
// A dependency: a kind, or { kind, sameLayer?, belowInStack?, when? } -- `sameLayer`: only the same layer's step;
// `belowInStack`: only layers under this one in the stack; `when`: only while the dependent step carries that flag
// (deriveJobSteps). Every edge is the code's own read (seat D survey, 2026-10-14), cited on the lines above it.
const dep = (kind, extra = {}) => Object.freeze({ kind, ...extra });
export const JOB_STEP_KINDS = Object.freeze({
  stock: Object.freeze({ label: 'Stock', icon: '▭', color: '#607d8b', fixed: 'first', opens: { sidebar: 'panel-stock' }, readOnly: 'section', dependsOn: [] }),
  // Seed Offset X / Y sit in Filter; the seed itself is the pinned Generate New Seed bar.
  // seed -> stock: the grid is the board's (core/engine/rebuild.js:139 resolveGrid, core/terrain.js:126 aspect)
  seed: Object.freeze({ label: 'Seed', icon: '✦', color: '#7e57c2', opens: { sidebar: 'panel-filter' }, readOnly: 'section', dependsOn: ['stock'] }),
  // filter <- seed: the fine noise is seeded (core/terrain.js:121, read at :206)
  filter: Object.freeze({ label: 'Filter', icon: '≈', color: '#00838f', opens: { sidebar: 'panel-filter' }, readOnly: 'section', dependsOn: ['seed', 'stock'] }),
  // skeleton <- seed (terrain.js:123, :264-270, :322) and <- filter: noiseType sets its frequency (terrain.js:246-248);
  // <- stock: the edge margin is a share of the board (rebuild.js:285)
  skeleton: Object.freeze({ label: 'Skeleton', icon: '⌇', color: '#455a64', opens: { sidebar: 'panel-skeleton' }, readOnly: 'section', dependsOn: ['seed', 'filter', 'stock'] }),
  // sculptTop <- the terrain (seed + skeleton + filter, combined at terrain.js:299): preDelta is added to it (rebuild.js:291)
  sculptTop: Object.freeze({ label: 'Sculpt top', icon: '▲', color: '#6d4c41', opens: { sidebar: 'panel-sculpt-top' }, readOnly: 'section', dependsOn: ['seed', 'skeleton', 'filter'] }),
  // Back = Thicken + Sculpt bottom: reads the STAMPED heights -- every stamp pass, bricks included (rebuild.js:169 on
  // :296's output; core/engine/build-thicken-data.js:56-57, :63) -- and the board (build-thicken-data.js:50)
  // snapshotOnLock (Fred 2026-10-14): the Back is cut FIRST in his real flow and its lock will be a carve-time snapshot of
  // the underside -- later stamps no longer feed it, so its reads are never marked (detection skips a snapshot kind)
  back: Object.freeze({ label: 'Back', icon: '▼', color: '#5b6b7a', opens: { sidebar: 'panel-thicken' }, readOnly: 'section', snapshotOnLock: true,
    dependsOn: ['stock', 'sculptTop', 'latticeRails', 'latticeNodes', 'vector', 'bricks'] }),
  // rails <- the frame, only for a lattice whose contour follows the frame (editor/editor-lattice-pattern.js:443)
  latticeRails: Object.freeze({ label: 'Rails', icon: '#', color: '#2e7d32', group: Object.freeze({ by: 'layer', label: 'Lattice' }),
    opens: { editorTab: 'lattice', layer: true }, readOnly: 'layer', dependsOn: [dep('frame', { when: 'followsFrame' })] }),
  // nodes <- that lattice's rails (and ties, cut with the rails): a node at each crossing (editor-lattice-pattern.js:2189-2204)
  latticeNodes: Object.freeze({ label: 'Nodes', icon: '•', color: '#2e7d32', group: Object.freeze({ by: 'layer', label: 'Lattice' }),
    opens: { editorTab: 'lattice', layer: true }, readOnly: 'layer', dependsOn: [dep('latticeRails', { sameLayer: true })] }),
  // a stamp is added onto terrain + sculpt top (rebuild.js:296); rasterized on the board (main/stamp-mask-manager.js:197-202);
  // the frame's inset window is punched out of it (stamp-mask-manager.js:113, :213)
  vector: Object.freeze({ label: 'Vector', icon: '✎', color: '#c0392b', group: Object.freeze({ by: 'kind', label: 'Vector stamping' }),
    opens: { editorTab: 'artwork', layer: true }, readOnly: 'layer', dependsOn: ['stock', 'sculptTop', dep('frame', { when: 'insetWindow' })] }),
  // flat bricks fit a plane to the surface stamped so far -- the layers UNDER theirs (core/engine/apply-stamp-layers.js:124-125,
  // rebuild.js:338-345); the frame's contour lays the frame bands (main/brick-panel.js:3149-3153) and its panel outline
  // sets the bricks' edge height (stamp-mask-manager.js:117, :214)
  bricks: Object.freeze({ label: 'Bricks', icon: '▤', color: '#b5651d', opens: { editorTab: 'brick' }, readOnly: 'layer',
    dependsOn: ['stock', 'sculptTop', dep('vector', { belowInStack: true }), dep('latticeRails', { belowInStack: true }), dep('latticeNodes', { belowInStack: true }), 'frame'] }),
  // the frame is laid on the board (editor/editor-frame-profile.js:476)
  frame: Object.freeze({ label: 'Wood frame', icon: '▢', color: '#8d6e63', opens: { sidebar: 'panel-frame' }, readOnly: 'section', dependsOn: ['stock'] }),
});

/** Fred's default order (2026-10-14): the kinds in this order; a project without a saved order starts on it, head at 0. */
export const JOB_DEFAULT_KIND_ORDER = Object.freeze(['stock', 'seed', 'skeleton', 'filter', 'sculptTop', 'back', 'latticeRails', 'latticeNodes',
  'vector', 'bricks', 'frame']);
/** The section steps every project has (a kind with no layer of its own). */
const SECTION_KINDS = Object.freeze(['stock', 'seed', 'skeleton', 'filter', 'sculptTop', 'back']);

/** What kind of step an editor layer (its saved roster entry) is, in this order; none matching = a vector layer. A
 *  lattice is its OWNER layer (the one holding `pattern`); the sibling kind-layers its `pattern.layers` names (ties,
 *  nodes, contour on layers of their own) belong to it, never vector steps (editor-lattice-pattern.js resolvePatternLayer). */
export const JOB_LAYER_KINDS = Object.freeze([
  Object.freeze({ kind: 'lattice', is: (l) => !!l.pattern }),
  Object.freeze({ kind: 'bricks', is: (l) => !!(l.brickKind || l.holdsBricks) }),
]);

/** The project view the steps derive from: `roster` = the editor's layer list (editor._layers live, or the saved
 *  `data-editor-layers` decoded), `frame` = P.frame. */
export function jobProjectOf(roster = [], frame = null) {
  const list = Array.isArray(roster) ? roster.filter(Boolean) : [];
  // _ensureKindLayers (editor-lattice-pattern.js) also records the RAILS layer's own id under pattern.layers.rails
  // (its own bookkeeping, unrelated to ownership) -- excluded here so the owner layer never excludes itself from
  // this project's own layers (only the true siblings -- ties, nodes, contour -- are "owned").
  const owned = new Set(list.flatMap((l) => (l.pattern && l.pattern.layers
    ? Object.values(l.pattern.layers).map(String).filter((id) => id !== String(l.id)) : [])));
  const layers = list.map((l, stackIndex) => ({ l, stackIndex })).filter(({ l }) => !owned.has(String(l.id))).map(({ l, stackIndex }) => ({
    id: String(l.id), name: l.name || String(l.id), kind: (JOB_LAYER_KINDS.find((k) => k.is(l)) || { kind: 'vector' }).kind, stackIndex,
    followsFrame: !!(l.pattern && l.pattern.contour && l.pattern.contour.fromFrame),
    // step ids key off THIS, never the raw layer id: a lattice's owner layer id shifts (the placeholder's 0 -> its
    // Rails layer's real id) on the first Generate (editor-lattice-pattern.js _ensureKindLayers moves .pattern onto
    // a NEW layer object) -- pattern.jobKey (minted once, freshPattern; NOT pattern.id, which is the Generate/
    // Regenerate button's own "has run once" signal) moves WITH it. Falls back to the layer id for every
    // non-pattern layer (vector, bricks) and for a legacy pattern saved before jobKey existed.
    jobId: l.pattern && l.pattern.jobKey ? String(l.pattern.jobKey) : String(l.id),
  }));
  const hasFrame = !!(frame && frame.templateId);
  return { layers, hasFrame, insetWindow: hasFrame && !!(frame.insetWindow && frame.insetWindow.enabled) };
}

/** The steps of a project, from what it holds: `layers` = the editor layers [{ id, name, kind: 'vector' | 'lattice' |
 *  'bricks', jobId? }] in stack order, `hasFrame` = a wood frame template is picked. A step = { id, kind, label,
 *  layerId?, group? } (group = { id, label } for a sub-item). Ids are stable: 'seed', 'vector:<layer>',
 *  'lattice:<layer>:rails' -- keyed off `jobId` (jobProjectOf's own stable key; falls back to `id` for a caller that
 *  never set it, e.g. a test's hand-built layer). */
export function deriveJobSteps({ layers = [], hasFrame = false, insetWindow = false } = {}) {
  const steps = SECTION_KINDS.map((kind) => ({ id: kind, kind, label: JOB_STEP_KINDS[kind].label, flags: [] }));
  for (const l of layers) {
    const at = { layerId: l.id, stackIndex: l.stackIndex ?? 0 };
    const jid = l.jobId != null ? l.jobId : l.id;
    if (l.kind === 'lattice') {
      const group = { id: `lattice:${jid}`, label: `${JOB_STEP_KINDS.latticeRails.group.label} ${l.name}`.trim() };
      const flags = l.followsFrame ? ['followsFrame'] : [];
      steps.push({ id: `lattice:${jid}:rails`, kind: 'latticeRails', label: JOB_STEP_KINDS.latticeRails.label, ...at, group, flags });
      steps.push({ id: `lattice:${jid}:nodes`, kind: 'latticeNodes', label: JOB_STEP_KINDS.latticeNodes.label, ...at, group, flags });
    } else if (l.kind === 'vector') {
      steps.push({ id: `vector:${jid}`, kind: 'vector', label: l.name, ...at, group: { id: 'vector', label: JOB_STEP_KINDS.vector.group.label },
        flags: insetWindow ? ['insetWindow'] : [] });
    }
  }
  // the bricks step stands for every brick layer: the highest one bounds what is "under" it
  const brickLayers = layers.filter((l) => l.kind === 'bricks');
  if (brickLayers.length) steps.push({ id: 'bricks', kind: 'bricks', label: JOB_STEP_KINDS.bricks.label, stackIndex: Math.max(...brickLayers.map((l) => l.stackIndex ?? 0)), flags: [] });
  if (hasFrame) steps.push({ id: 'frame', kind: 'frame', label: JOB_STEP_KINDS.frame.label, flags: [] });
  return steps;
}

/** The default order of `steps`: by JOB_DEFAULT_KIND_ORDER, then the steps' own order (layers in stack order). */
export function defaultJobOrder(steps) {
  const rank = (s) => JOB_DEFAULT_KIND_ORDER.indexOf(s.kind);
  return steps.map((s, i) => [s, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([s]) => s.id);
}

/** A saved timeline made safe for `steps` (Fred: "consider if some reordering would error the model"): ids that no
 *  longer exist dropped (a deleted layer), duplicates dropped, missing ids APPENDED at the end (a new layer, a new kind),
 *  the fixed-first kind at index 0, the head clamped to 0..length. No saved timeline (an old project) = the default
 *  order with the head at the start. */
export function normalizeJobTimeline(saved, steps) {
  const ids = new Set(steps.map((s) => s.id));
  if (!saved || !Array.isArray(saved.order)) return { order: defaultJobOrder(steps), head: 0 };
  const seen = new Set();
  const order = [];
  for (const id of saved.order) if (ids.has(id) && !seen.has(id)) { seen.add(id); order.push(id); }
  for (const id of defaultJobOrder(steps)) if (!seen.has(id)) { seen.add(id); order.push(id); }
  const kindOf = new Map(steps.map((s) => [s.id, s.kind]));
  const first = order.filter((id) => JOB_STEP_KINDS[kindOf.get(id)].fixed === 'first');
  const rest = order.filter((id) => JOB_STEP_KINDS[kindOf.get(id)].fixed !== 'first');
  const head = Number.isFinite(saved.head) ? Math.max(0, Math.min(order.length, Math.round(saved.head))) : 0;
  return { order: [...first, ...rest], head };
}

/** The strip's runs: consecutive steps of one group form a run (its group's label shown on EACH run -- a split group
 *  reads "Lattice A · Rails" ... "Lattice A · Nodes"); a step outside any group is a run of its own. */
export function groupRuns(order, steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const runs = [];
  for (const id of order) {
    const s = byId.get(id);
    if (!s) continue;
    const last = runs[runs.length - 1];
    if (s.group && last && last.group && last.group.id === s.group.id) last.steps.push(s);
    else runs.push({ group: s.group || null, steps: [s] });
  }
  return runs;
}

/** DETECTION ONLY (no blocking, no reorder): each step that sits LEFT of a step it depends on (its kind's dependsOn) ->
 *  [{ stepId, before: [ids it is cut before] }]. A `sameLayer` dependency counts only the same layer's step; a kind
 *  declaring `snapshotOnLock` is never marked (its lock will be a snapshot of what it cut). */
export function dependencyMarks(order, steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const at = new Map(order.map((id, i) => [id, i]));
  const marks = [];
  for (const id of order) {
    const s = byId.get(id);
    if (!s) continue;
    const before = [];
    if (JOB_STEP_KINDS[s.kind].snapshotOnLock) continue; // its own snapshot answers, not the steps after it
    for (const dep of JOB_STEP_KINDS[s.kind].dependsOn) {
      const d = typeof dep === 'string' ? { kind: dep } : dep;
      if (d.when && !(s.flags || []).includes(d.when)) continue;
      for (const t of steps) {
        if (t.kind !== d.kind || (d.sameLayer && t.layerId !== s.layerId)) continue;
        if (d.belowInStack && !((t.stackIndex ?? 0) < (s.stackIndex ?? 0))) continue;
        if (at.get(t.id) > at.get(id)) before.push(t.id);
      }
    }
    if (before.length) marks.push({ stepId: id, before });
  }
  return marks;
}

/** The tooltip of a dependency mark: "Back is cut before Red petals, but Red petals changes the back". */
export function dependencyNote(mark, steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const name = (id) => { const s = byId.get(id); return s.group && s.group.id !== 'vector' ? `${s.group.label} · ${s.label}` : s.label; };
  const self = name(mark.stepId);
  return mark.before.map((b) => `${self} is cut before ${name(b)}, but ${name(b)} changes the ${self.toLowerCase()}`).join('\n');
}
