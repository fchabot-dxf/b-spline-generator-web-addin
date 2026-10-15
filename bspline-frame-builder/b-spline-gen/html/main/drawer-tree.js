/**
 * main/drawer-tree.js -- the editor drawer's COLLAPSE TREE (redesign phase 4, Fred's mockups shots/seatD/redesign/;
 * advisor pick A): one per editor tab (Brick, Draw, Lattice), each declared as data -- its branches, where it keeps its
 * fold state -- and built by this one mechanism (the third tree made it a shared one).
 *
 * A branch = { id, title, summary, hosts, armsTool?, headerId? }: its body holds the declared `hosts` (existing elements,
 * MOVED in: ids and handlers kept) under a header -- a caret, the title, a short `summary` (text, or a function of the
 * document). `armsTool`: an ELEMENT / TOOL branch opens by arming its tool -- an accordion in step with the tool row
 * (the settings follow the armed tool); a branch without it folds on its own, remembered per device. `headerId`: the
 * header keeps a retired control's id (a tab the tree replaced), for the brick matrix.
 */
export function createDrawerTree({ id, branches, openKey, defaultOpen = [], branchDomId }) {
  const state = { doc: null, open: null, folded: new Set(), armed: null };
  const read = () => {
    try { const v = JSON.parse(localStorage.getItem(openKey)); if (Array.isArray(v)) return v; } catch (_) { /* blocked */ }
    return [...defaultOpen];
  };
  const write = (ids) => { try { localStorage.setItem(openKey, JSON.stringify(ids)); } catch (_) { /* not remembered */ } };
  const isOpen = (b) => (b.armsTool ? b.armsTool === state.armed && !state.folded.has(b.id) : state.open.includes(b.id));

  const tree = {
    id,
    branches,
    branchDomId,
    /** Builds the tree once per document inside `container` (the hosts move into their branches); `onArm(tool)` arms a
     *  tool. Returns the declared hosts missing from the page. */
    build(container, onArm, doc = container ? container.ownerDocument : null) {
      if (!container || !doc) return [];
      if (state.doc === doc && doc.getElementById(id)) return [];
      state.doc = doc;
      state.open = read();
      const missing = [];
      const root = doc.createElement('div');
      root.id = id;
      root.className = 'drawer-tree';
      container.appendChild(root);
      for (const b of branches) {
        const shell = doc.createElement('div');
        shell.id = branchDomId(b.id);
        shell.className = 'drawer-branch';
        shell.dataset.branch = b.id;
        const head = doc.createElement('button');
        head.type = 'button';
        head.id = b.headerId || `${branchDomId(b.id)}_head`;
        head.className = 'drawer-branch-head';
        const caret = doc.createElement('span');
        caret.className = 'drawer-branch-caret';
        const title = doc.createElement('span');
        title.className = 'drawer-branch-title';
        title.textContent = b.title;
        const summary = doc.createElement('span');
        summary.className = 'drawer-branch-summary';
        head.append(caret, title, summary);
        const body = doc.createElement('div');
        body.className = 'drawer-branch-body';
        body.id = `${branchDomId(b.id)}_body`;
        shell.append(head, body);
        root.appendChild(shell);
        for (const h of b.hosts) { const el = doc.getElementById(h); if (el) body.appendChild(el); else missing.push(h); }
        // the caret folds / unfolds; the rest of the header OPENS (a tool branch: by arming its tool)
        caret.addEventListener('click', (e) => { e.stopPropagation(); tree.toggle(b.id); });
        head.addEventListener('click', () => { if (b.armsTool && state.armed !== b.armsTool) onArm(b.armsTool); else tree.open(b.id); });
      }
      tree.sync(state.armed);
      return missing;
    },
    /** Opens branch `bid` (a tool branch only when its tool is armed) and scrolls it into view. */
    open(bid) {
      const b = branches.find((x) => x.id === bid);
      if (!b || !state.doc) return;
      if (b.armsTool) state.folded.delete(bid);
      else if (!state.open.includes(bid)) { state.open = [...state.open, bid]; write(state.open); }
      tree.sync(state.armed);
      state.doc.getElementById(branchDomId(bid))?.scrollIntoView?.({ block: 'nearest' });
    },
    /** The caret: folds / unfolds `bid` (an unarmed tool branch has nothing to unfold: its settings follow the armed tool). */
    toggle(bid) {
      const b = branches.find((x) => x.id === bid);
      if (!b || !state.doc) return;
      if (b.armsTool) { if (b.armsTool !== state.armed) return; if (state.folded.has(bid)) state.folded.delete(bid); else state.folded.add(bid); }
      else { state.open = state.open.includes(bid) ? state.open.filter((x) => x !== bid) : [...state.open, bid]; write(state.open); }
      tree.sync(state.armed);
    },
    /** Each branch's open state, caret and summary for the armed tool (a tool switch unfolds the new tool's branch). */
    sync(armed) {
      const doc = state.doc;
      if (!doc) return;
      if (armed !== state.armed) { state.folded.clear(); state.armed = armed; }
      for (const b of branches) {
        const shell = doc.getElementById(branchDomId(b.id));
        if (!shell) continue;
        const o = isOpen(b);
        shell.classList.toggle('open', o);
        shell.classList.toggle('armed', !!b.armsTool && b.armsTool === armed);
        shell.querySelector(':scope > .drawer-branch-body').hidden = !o;
        shell.querySelector('.drawer-branch-caret').textContent = o ? '▾' : '▸';
        const s = typeof b.summary === 'function' ? b.summary(doc) : b.summary;
        shell.querySelector('.drawer-branch-summary').textContent = s || '';
      }
    },
  };
  return tree;
}
