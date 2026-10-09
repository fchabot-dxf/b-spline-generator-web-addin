// Page-side interpreter for tools/repro/creations/recipes.mjs: evaluated in the palette page, it installs
// window.__creations = { run(recipe), readback(), prepShot(view), snapshot(), restore(snap) }. Every step kind drives
// the app through its own exported UI functions or its own controls (the same paths the panels' handlers take).
// Board coordinates are the editor's: inches, origin top-left, y down.
(() => {
  const W = (ms) => new Promise((r) => setTimeout(r, ms));
  const M = {};
  const mods = async () => {
    if (M.P) return M;
    Object.assign(M, {
      L: await import('./core/loading-signal.js'), RB: await import('./core/engine/rebuild.js'), SC: await import('./core/engine/scheduler.js'),
      PM: await import('./main/param-manager.js'), S: await import('./core/state.js'), F: await import('./main/frame-panel.js'),
      FR: await import('./core/frame-record.js'), Ly: await import('./editor/layers.js'), B: await import('./main/brick-panel.js'),
      T: await import('./editor/editor-brick-tool.js'), X: await import('./main/export-flow.js'), C: await import('./editor/editor-commit.js'),
      A: await import('./main/app-state.js'), CP: await import('./main/cloud-project-manager.js'), SM: await import('./main/snapshot-manager.js'),
      CO: await import('./core/coords.js'),
      CFF: await import('./editor/contour-from-frame.js'), SLG: await import('./editor/editor-shape-lattice-generator.js'),
    });
    M.P = M.S.P;
    return M;
  };
  const busy = () => !!(M.RB.rebuild.isRebuilding || M.RB.rebuild.pendingRebuild || M.SC.isRebuildScheduled() || M.L.currentLoadingStage());
  const idle = async (min = 600) => { const t = performance.now(); for (let i = 0; i < 9000; i++) { await W(20); if (!busy() && performance.now() - t > min) return; } };
  const $ = (id) => document.getElementById(id);
  const fire = (el, ...types) => { for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true })); };
  const setInput = (id, v) => { const e = $(id); if (!e) throw new Error('no control #' + id); e.value = String(v); fire(e, 'input', 'change'); };
  const setCheck = (id, on) => { const e = $(id); if (!e) throw new Error('no control #' + id); if (e.checked !== !!on) { e.checked = !!on; fire(e, 'change'); } };
  const click = (id) => { const e = $(id); if (!e) throw new Error('no control #' + id); e.click(); };
  const ed = () => window.svgEditor;
  const editorOpen = () => { const m = $('svgEditorModal'); return !!m && m.style.display !== 'none' && getComputedStyle(m).display !== 'none'; };
  const openEditor = async (tab) => { M.F.openEditorOn(tab); await idle(900); };
  const apply = async () => { if (editorOpen()) { click('editorApply'); await idle(2500); } };
  /** a polyline densified to ~`step` in spacing */
  const densify = (pts, step) => {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let k = 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
    }
    return out;
  };

  // ---- the declared step kinds -------------------------------------------------------------------------------
  const STEPS = {
    async board({ w, h }) { setInput('widthIn', w); setInput('heightIn', h); await idle(); },
    async frame({ template, generate, thickness, insetWindow }) {
      await M.F.editFrame({ templateId: template, params: {} }); await idle(800);
      if (thickness != null) { await M.F.editFrame({ params: { ...M.FR.getFrameRecord().params, frame_thickness: thickness } }); await idle(500); }
      if (generate != null) { await M.F.generateFrame(generate); await idle(800); }
      if (insetWindow) { await M.F.editFrame({ insetWindow: { enabled: true, ...insetWindow } }); await idle(800); }
    },
    async filter({ id, tweaks }) {
      const e = $('noiseType'); e.value = id; fire(e, 'change'); await idle();
      if (tweaks) { M.P.filterTweaks = { ...(M.P.filterTweaks || {}), [id]: { ...(M.P.filterTweaks?.[id] || {}), ...tweaks } }; M.PM.applyParam('noiseType', id); await idle(); }
    },
    async params(kv) { for (const [k, v] of Object.entries(kv)) M.PM.applyParam(k, v); await idle(); },
    async sculpt({ mode = 'draw', radius = 0.6, strength = 0.03, symmetry = false, strokes }) {
      const { PM, P, S } = M;
      PM.applyParam('sculptTopRespectSymmetry', !!symmetry);
      PM.applyParam('activeSculptLayer', 'top'); PM.applyParam('sculptTopMode', mode);
      PM.applyParam('sculptTopRadius', radius); PM.applyParam('sculptTopStrength', strength); await idle();
      const cfg = M.A.AppState.preview._sculpt.getConfig();
      for (const st of strokes) {
        const { nx, nz } = S.lastResult;
        cfg.onStart('top');
        for (const [x, y] of densify(st.pts, st.step || 0.12)) {
          const ci = Math.round((x / P.widthIn) * (nx - 1)), cj = Math.round(((P.heightIn - y) / P.heightIn) * (nz - 1)); // grid row 0 = board bottom
          cfg.onStroke('top', ci, cj, st.dy ?? -2);
        }
        cfg.onStrokeEnd('top'); await idle(400);
      }
      PM.applyParam('activeSculptLayer', null); await idle();
    },
    async photo({ pattern, rotate = 0, flipH = false, blur, levels, contrast, relief, height }) {
      await openEditor('photo');
      const idx = (await (await fetch('./data/photo-patterns.json')).json()).findIndex((p) => p.id === pattern);
      const btn = document.querySelectorAll('#photoPatternRow button')[idx];
      if (!btn) throw new Error('no photo pattern ' + pattern);
      btn.click(); await idle(1500);
      for (let i = 0; i < rotate; i++) { click('photoBtnRotate'); await idle(600); }
      if (flipH) { click('photoBtnFlipH'); await idle(600); }
      if (levels) for (const [k, id] of [['black', 'photoLevelsBlackSlider'], ['white', 'photoLevelsWhiteSlider'], ['mid', 'photoLevelsMidSlider']]) if (levels[k] != null) { setInput(id, levels[k]); await idle(400); }
      if (contrast != null) { setInput('photoContrastSlider', contrast); await idle(500); }
      if (blur != null) { setInput('photoBlurSlider', blur); await idle(800); }
      if (relief === 'carved') { click('photoBtnReliefCarved'); await idle(600); }
      if (height != null) { setInput('photoReliefHeightSlider', height); await idle(600); }
    },
    async openEditor({ tab }) { await openEditor(tab); },
    async apply() { await apply(); },
    async lattice({ kind = 'shape', orientation, spacing, fromFrame, distance, generateSeed, clicks = [], set = {}, colors = {}, layers = {} }) {
      await openEditor('artwork');
      const pre = kind === 'shape' ? 'shapeLattice' : 'lattice';
      click(kind === 'shape' ? 'toolShapeLattice' : 'toolLattice'); await W(900);
      if (orientation) { click(pre + (orientation === 'vertical' ? 'OrientVertical' : 'OrientHorizontal')); await W(300); }
      if (spacing != null) { setInput(pre + 'RailsSpacing', spacing); await W(300); }
      if (generateSeed != null && $(pre + 'Seed')) { setInput(pre + 'Seed', generateSeed); await W(300); }
      for (const id of clicks) { click(id); await W(250); } // the panel's own buttons (tie mode, span mode, ...)
      for (const [id, v] of Object.entries(set)) { setInput(id, v); await W(250); } // its own fields
      click(pre + 'Generate'); await idle(2500);
      if (kind === 'shape' && fromFrame) {
        setCheck('shapeLatticeContourFromFrame', true); await idle(2000);
        if (distance != null) { setInput('shapeLatticeContourFromFrameDistance', distance); await idle(2000); }
      }
      // per-kind colour (the piece-override recolour the panel's own per-piece colour uses): { rail: '#hex', tie, node, contour }
      if (Object.keys(colors).length) {
        const O = await import('./editor/editor-piece-override.js');
        const plural = { rail: 'rails', tie: 'ties', node: 'nodes', contour: 'contour' };
        for (const el of ed()._sketchLayer.children().toArray()) {
          const k = el.node.getAttribute('data-lattice');
          if (k && colors[k] && el.node.hasAttribute('data-lattice-gen')) O.applyColorOverride(el, plural[k] || k, colors[k]);
        }
      }
      // per-layer tooling: { Rails: { carve, depth, profile, angle }, ... }
      for (const [name, t] of Object.entries(layers)) {
        const l = ed()._layers.find((q) => q.name === name); if (!l) throw new Error('no lattice layer ' + name);
        for (const k of ['depth', 'profile', 'angle', 'smoothing']) if (t[k] != null) l[k] = t[k];
        M.Ly.setLayerCarve(ed(), l.id, t.carve !== false); await W(300);
      }
      M.C.commitEdit(ed()); await idle(800);
    },
    /** contour echoes: the app's own frame-offset contour (contour-from-frame.js frameContourSilhouette, what the Shape
     *  Lattice's "Offset from frame" draws), once per distance from the frame's outer edge, as strokes in a new art layer */
    async echo({ layer, offsets, width = 0.08, color = '#2e7d32', paths = [] }) {
      const frame = { defs: M.FR.FRAME_DEFS, record: M.FR.getFrameRecord(), board: { widthIn: M.P.widthIn, heightIn: M.P.heightIn } };
      const ds = offsets.map((dist) => {
        const sil = M.CFF.frameContourSilhouette(frame, dist, width);
        if (sil.error) throw new Error('echo ' + dist + ': ' + sil.error);
        return { d: M.SLG.primitivesToPathD(sil.primitives), width, color };
      });
      await STEPS.art({ layer, paths: [...ds, ...paths] });
    },
    async art({ layer, paths }) {
      await openEditor('artwork');
      const e = ed();
      const l = M.Ly.addLayer(e, { name: layer.name, ...(layer.depth != null ? { depth: layer.depth } : {}), ...(layer.profile ? { profile: layer.profile } : {}), ...(layer.angle ? { angle: layer.angle } : {}) });
      M.Ly.setActiveLayer(e, l.id);
      for (const p of paths) {
        e._sketchLayer.path(p.d).fill(p.fill || 'none').stroke({ color: p.color || '#000', width: p.width ?? 0.06, linecap: 'round', linejoin: 'round' }).attr('data-layer', l.id);
      }
      M.C.commitEdit(e); await idle(800);
      M.Ly.setLayerCarve(e, l.id, layer.carve !== false); await idle(800);
    },
    async bricks(o) {
      const { B, P } = M;
      await openEditor('brick');
      if (o.size != null) { B.setBrickSize(o.size, 'none'); }
      if (o.groutDepth != null) { P.brickSettings.grout = { ...P.brickSettings.grout, depthIn: o.groutDepth }; }
      if (o.topMode) B.setBrickTopMode(o.topMode, 'none');
      if (o.framePreset) B.setFrameBandPreset(o.framePreset, 'none');
      if (o.frameSet != null) B.selectSet(o.frameSet, 'none', ['frame']);
      if (o.frameCorner) B.setFrameCorner(o.frameCorner, 'none');
      if (o.wallSet != null) B.selectSet(o.wallSet, 'none', ['wall']);
      if (o.wallPattern) B.setWallPattern(o.wallPattern, 'none');
      if (o.wallRotation != null) B.setWallRotation(o.wallRotation, 'none');
      if (o.largeStones != null) P.brickSettings.largeStones = o.largeStones;
      if (o.frameLevel != null) B.setElementLevel('frame', o.frameLevel, 'none');
      if (o.wallLevel != null) B.setElementLevel('wall', o.wallLevel, 'none');
      if (o.relief != null) P.brickSettings.reliefIn = o.relief;
      if (o.seed != null) B.setSeed(o.seed, 'none');
      await idle(400);
      if (o.frame) { click('brickTool_frame'); await W(400); click('brickGenerate'); await idle(2500); }
      if (o.wall) { click('brickTool_wall'); await W(400); click('brickGenerate'); await idle(2500); }
      if (o.surface) { B.setSurfaceStyle(o.surface); if (o.wear != null) { P.brickSettings.surfaceWear = o.wear; B.commitBrickSetting('surface'); } await idle(800); }
      if (o.groutColor) { B.selectBrickElement(null); B.setGroutPaint({ color: o.groutColor, paintInsetIn: o.groutInset ?? 0 }, null); await idle(800); }
    },
    async builder({ base = 'custom', unit = 0.5, joins = [], raised = [], levelIn = 0.0625, relayWall = false }) {
      const { B } = M;
      await openEditor('brick');
      B.selectBrickElement(null);
      B.openPatternBuilder(); B.builderSetBase(base); B.builderSetUnit(unit);
      for (const [r, a, b] of joins) B.builderJoin(r, a, b);
      for (const [r, c] of raised) B.builderToggleCell(r, c);
      B.setAccentLevel(levelIn); await idle(2500);
      if (relayWall) { B.selectBrickElement(null); click('brickTool_wall'); await W(400); click('brickGenerate'); await idle(2500); }
    },
    async areas({ width = 1, list }) {
      const { B } = M;
      await openEditor('brick');
      B.setWallAreaWidth(width);
      for (const a of list) {
        B.selectBrickElement(null);
        if (a.pattern !== 'builder') { B.setWallPattern(a.pattern); await idle(800); }
        B.paintWallArea(a.points.map(([x, y]) => ({ x, y }))); await idle(2500);
      }
      B.closePatternBuilder && B.closePatternBuilder();
      B.selectBrickElement(null);
    },
    async raisedBrush({ level, points, mode = 'bricks', preset }) {
      const { B, T, P } = M;
      await openEditor('brick');
      B.selectBrickElement(null);
      if (level != null) P.brickSettings.raisedLevelIn = level;
      if (preset) P.brickSettings.brushBandPreset = preset;
      click('brickTool_raisedBrush'); await W(500);
      B.setRaisedMode(mode);
      const e = ed(); T.brickBrushHandler.start(e, { x: points[0][0], y: points[0][1] });
      for (const [x, y] of densify(points, 0.25).slice(1)) T.brickBrushHandler.update(e, { x, y });
      T.brickBrushHandler.finish(e); await idle(2500);
    },
  };

  async function run(recipe) {
    await mods();
    M.PM.applyParam('showLeaders', false);
    const log = [];
    for (const step of recipe.steps) {
      const [kind, args] = Object.entries(step)[0];
      if (!STEPS[kind]) throw new Error('unknown step kind ' + kind);
      const t0 = performance.now();
      await STEPS[kind](args || {});
      log.push({ kind, ms: Math.round(performance.now() - t0) });
    }
    await apply();
    await idle(1500);
    return log;
  }

  async function readback() {
    await mods();
    const { P, S } = M; const e = ed();
    const polys = [...e._sketchLayer.node.querySelectorAll('[data-brick-gen="1"]')];
    const byKind = {}; for (const p of polys) { const k = p.getAttribute('data-brick') || '?'; byKind[k] = (byKind[k] || 0) + 1; }
    const lat = {}; for (const n of e._sketchLayer.node.querySelectorAll('[data-lattice]')) { const k = n.getAttribute('data-lattice'); lat[k] = (lat[k] || 0) + 1; }
    let nz = 0, mn = 0, mx = 0; if (S.preDelta) for (const v of S.preDelta) { if (v !== 0) nz++; mn = Math.min(mn, v); mx = Math.max(mx, v); }
    const rec = M.FR.getFrameRecord();
    return {
      board: [P.widthIn, P.heightIn], template: rec?.templateId, frameGenSeed: rec?.genSeed, frameThickness: rec?.params?.frame_thickness ?? null,
      insetWindow: rec?.insetWindow, filter: P.noiseType, filterTweaks: P.filterTweaks?.[P.noiseType] || null, carveZ: P.carveZ, terrainSeed: P.seed,
      symmetry: P.symmetry, scale: P.scale, mapZoom: P.mapZoom,
      sculpt: { touchedPoints: nz, minIn: +mn.toFixed(4), maxIn: +mx.toFixed(4) },
      photo: P.noiseType === 'photo' ? { pattern: P.photoPatternId, edits: P.photoEdits } : null,
      lattice: lat,
      bricks: { pieces: polys.length, byKind, raisedAccent: polys.filter((p) => p.getAttribute('data-brick-accent-marked') === '1').length,
        areas: M.T.wallAreaRecords ? M.T.wallAreaRecords(e).length : null,
        frameSets: [...new Set(polys.filter((p) => p.getAttribute('data-brick') === 'frame').map((p) => p.getAttribute('data-brick-set')))],
        settings: { setIds: P.brickSettings.setIds, pattern: P.brickSettings.pattern, frameBandPreset: P.brickSettings.frameBandPreset, brickLengthIn: P.brickSettings.brickLengthIn,
          surfaceStyle: P.brickSettings.surfaceStyle, groutPaint: P.brickSettings.groutPaint, accent: P.brickSettings.accent } },
      layers: e._layers.map((l) => ({ name: l.name, carve: M.Ly.isCarved(l), depth: l.depth, profile: l.profile, brickKind: l.brickKind || null,
        elements: e._sketchLayer.node.querySelectorAll(`[data-layer="${l.id}"]`).length })),
      carvingLayers: M.X.activeStampLayers().length,
    };
  }

  /** the 3D preview, framed for a presentation shot; returns the canvas rect */
  async function prepShot(view = {}) {
    await mods();
    const p = M.A.AppState.preview;
    if (p._leaders?._svg) p._leaders._svg.style.display = 'none';
    p.setSculptMode(null); // the brush ring stays up after a scripted stroke (updatePreviewSculptMode keeps it)
    if (view.grid === false && p.setGroundGridVisible) p.setGroundGridVisible(false);
    p._orbit.animateTo(view.theta ?? 0.45, view.phi ?? 0.8);
    if (view.zoom) { await W(50); p._orbit._targetOrb.r *= view.zoom; }
    p._needsRender = true; await W(2000);
    const r = (p._canvas || $('previewCanvas')).getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  async function snapshot() { await mods(); return M.CP.buildSnapshot(); }
  async function restore(snap) {
    await mods();
    if (snap?.P && Array.isArray(snap.P.points)) snap.P.points = snap.P.points.map((pt) => { const ui = M.CO.COORD_SYSTEM.toUI(pt[0], pt[1]); return [ui.x, ui.y]; });
    await M.SM.applySnapshot(snap, M.A.AppState.preview, { source: 'load' });
    await idle(2500);
  }
  window.__creations = { run, readback, prepShot, snapshot, restore, idle: () => mods().then(() => idle()) };
})();
