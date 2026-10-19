/**
 * core/pull-changelist.js -- Pull from Fusion, step (b) (seat D 2026-10-16; advisor 45, Fred): PULL_MAP read
 * against the app's own current values, the change-list rows the dialog shows (mockup approved,
 * shots/seatD/pull/01_desktop_changelist.png).
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeLayerParams, layerParamsFor, compareScope, diffScope, applyRows, buildChangeList, summarizeRails, CHANGE_EPS_IN,
} from '../bspline-frame-builder/b-spline-gen/html/core/pull-changelist.js';

describe('normalizeLayerParams: stroke_width (rails+ties linked) folds into both PULL_MAP rows', () => {
  it('stroke_width present: both rail_width and tie_width take its value, stroke_width itself is gone', () => {
    expect(normalizeLayerParams({ stroke_width: 0.2, node_diameter: 0.3 }))
      .toEqual({ node_diameter: 0.3, rail_width: 0.2, tie_width: 0.2 });
  });

  it('rail_width/tie_width present instead (unlinked): passed through unchanged', () => {
    expect(normalizeLayerParams({ rail_width: 0.2, tie_width: 0.25 })).toEqual({ rail_width: 0.2, tie_width: 0.25 });
  });

  it('never mutates the input', () => {
    const input = { stroke_width: 0.2 };
    normalizeLayerParams(input);
    expect(input).toEqual({ stroke_width: 0.2 });
  });
});

describe('layerParamsFor: one layer\'s own slice of a flat boardParams dict', () => {
  it('strips the "L<id>_" prefix, leaves other layers\' entries out, normalizes stroke_width', () => {
    const boardParams = { L3_stroke_width: 0.2, L3_node_diameter: 0.3, L9_node_diameter: 0.15, frame_thickness: 0.8 };
    expect(layerParamsFor(boardParams, '3')).toEqual({ node_diameter: 0.3, rail_width: 0.2, tie_width: 0.2 });
    expect(layerParamsFor(boardParams, '9')).toEqual({ node_diameter: 0.15 });
  });
});

describe('compareScope / diffScope: changed vs kept, against a value this small is noise', () => {
  it('a real change: from/to set, changed true', () => {
    const rows = compareScope('layer', { node_diameter: 0.3 }, { widths: { nodeDiameter: 0.25 } });
    expect(rows).toEqual([{ fusionParam: 'node_diameter', scope: 'layer', appPath: 'widths.nodeDiameter', label: 'Node diameter', unit: 'in', kind: 'nodes', from: 0.25, to: 0.3, changed: true }]);
  });

  it('matches already: changed false, still returned by compareScope (kept-count material), filtered out by diffScope', () => {
    const appObj = { widths: { nodeDiameter: 0.25 } };
    const rows = compareScope('layer', { node_diameter: 0.25 }, appObj);
    expect(rows[0].changed).toBe(false);
    expect(diffScope('layer', { node_diameter: 0.25 }, appObj)).toEqual([]);
  });

  it(`a difference under CHANGE_EPS_IN (${CHANGE_EPS_IN}in) is noise, not a change`, () => {
    const appObj = { widths: { nodeDiameter: 0.25 } };
    expect(diffScope('layer', { node_diameter: 0.25 + CHANGE_EPS_IN / 2 }, appObj)).toEqual([]);
    expect(diffScope('layer', { node_diameter: 0.25 + CHANGE_EPS_IN * 2 }, appObj)).toHaveLength(1);
  });

  it('the app has no value yet (undefined): counts as changed (the row still shows, from is undefined)', () => {
    const rows = diffScope('frame', { panel_lip: 0.1 }, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fusionParam: 'panel_lip', from: undefined, to: 0.1 });
  });

  it('a Fusion param PULL_MAP has no row for this scope, or Fusion holds nothing for it: skipped entirely', () => {
    expect(diffScope('layer', { fred_custom: 9 }, { widths: {} })).toEqual([]);
    expect(diffScope('board', {}, { widthIn: 7 })).toEqual([]);
  });

  it('extra (layerId, layerName) rides along on every row diffScope returns', () => {
    const rows = diffScope('layer', { node_diameter: 0.3 }, { widths: { nodeDiameter: 0.25 } }, { layerId: '3', layerName: 'Layer 1' });
    expect(rows[0]).toMatchObject({ layerId: '3', layerName: 'Layer 1' });
  });
});

describe('applyRows: writes each row\'s own `to` onto its own appPath', () => {
  it('a nested path (widths.rails), a top-level one (widthIn), a path that doesn\'t exist yet', () => {
    const pattern = { widths: { rails: 0.25 } };
    applyRows([{ appPath: 'widths.rails', to: 0.3 }], pattern);
    expect(pattern.widths.rails).toBe(0.3);

    const P = { widthIn: 7 };
    applyRows([{ appPath: 'widthIn', to: 8 }], P);
    expect(P.widthIn).toBe(8);

    const frame = {};
    applyRows([{ appPath: 'params.frame_thickness', to: 0.8 }], frame);
    expect(frame.params.frame_thickness).toBe(0.8);
  });
});

describe('buildChangeList: the full change list -- board, per-layer groups, frame, kept/notMapped counts', () => {
  const P = { widthIn: 7, heightIn: 9 };
  const layer1 = { id: '3', name: 'Layer 1', pattern: { widths: { rails: 0.25, ties: 0.25, nodeDiameter: 0.25 } } };
  const layer2 = { id: '9', name: 'Layer 2', pattern: { widths: { rails: 0.2, ties: 0.2, nodeDiameter: 0.2 } } };
  const frame = { params: { frame_thickness: 0.75, boundingboxoffset: 0.25 }, panelLip: 0, frameBottomZ: -1 };

  it('a realistic pull: board resized, layer 1 changed, layer 2 unchanged, frame changed, one unmapped param', () => {
    const pullResult = {
      widthIn: 8, heightIn: 9, // width changed, height didn't
      boardParams: {
        L3_stroke_width: 0.3, L3_node_diameter: 0.3, // layer 1: both rail+tie widths change (linked), diameter too
        L9_stroke_width: 0.2, L9_node_diameter: 0.2, // layer 2: identical to the app -- kept, not a row
        frame_thickness: 0.8, boundingboxoffset: 0.25, // frame: thickness changed, offset kept
        L3_fred_custom: 5, // a param on layer 1's own board, PULL_MAP doesn't declare it -- not mapped
      },
    };
    const result = buildChangeList(pullResult, { P, layers: [layer1, layer2], frame });

    expect(result.boardRows).toEqual([{ fusionParam: 'widthIn', scope: 'board', appPath: 'widthIn', label: 'Width', unit: 'in', from: 7, to: 8, changed: true }]);

    expect(result.layerGroups).toHaveLength(1); // layer 2 produced no rows -- not in the list at all
    expect(result.layerGroups[0]).toMatchObject({ layerId: '3', layerName: 'Layer 1' });
    expect(result.layerGroups[0].rows.map((r) => r.fusionParam).sort()).toEqual(['node_diameter', 'rail_width', 'tie_width']);

    expect(result.frameRows).toEqual([{ fusionParam: 'frame_thickness', scope: 'frame', appPath: 'params.frame_thickness', label: 'Frame thickness', unit: 'in', from: 0.75, to: 0.8, changed: true }]);

    // kept: heightIn is NOT counted (board scope only ever shows what changed, no kept-tracking there) -- layer
    // 2's stroke_width normalizes into TWO rows (rail_width + tie_width, both kept) + node_diameter (1) + frame's
    // boundingboxoffset (1) = 4
    expect(result.keptCount).toBe(4);
    expect(result.notMappedCount).toBe(1); // L3_fred_custom
  });

  it('no frame on this board: frameRows empty, frame params (if any) count toward notMapped, not kept', () => {
    const pullResult = { widthIn: 7, heightIn: 9, boardParams: { frame_thickness: 0.9 } };
    const result = buildChangeList(pullResult, { P, layers: [], frame: null });
    expect(result.frameRows).toEqual([]);
    expect(result.boardRows).toEqual([]); // nothing changed
    expect(result.notMappedCount).toBe(1);
    expect(result.keptCount).toBe(0);
  });

  it('a layer-prefixed param for a layer NOT on this board (not in `layers`) is never counted at all', () => {
    const pullResult = { widthIn: 7, heightIn: 9, boardParams: { L99_node_diameter: 0.5 } };
    const result = buildChangeList(pullResult, { P, layers: [layer1], frame: null });
    expect(result.notMappedCount).toBe(0); // not this board's problem to report
  });

  it('no boardParams / no size at all: an empty, harmless change list', () => {
    const result = buildChangeList({}, { P, layers: [layer1], frame });
    expect(result).toEqual({ boardRows: [], layerGroups: [], frameRows: [], frameShapeRows: [], frameShapeBeyond: [], keptCount: 0, notMappedCount: 0, railsLocked: 0, railsMoved: 0 });
  });

  // live Fusion test (seat D 2026-10-16): a design with no tagged board is BoardNamer's own "legacy" identity
  // scope (fb_engine/board_scope.py) -- Send skips ALL scoping then, so a single-board document's lattice params
  // come back completely BARE ("node_diameter", not "L3_node_diameter"). That's the common case (most users have
  // exactly one board) -- caught live: a captured Send + replayed into Fusion came back with bare params, and the
  // change list showed zero layer rows for node diameter / rail width despite Fusion actually holding changed
  // values. A layer-prefixed match still wins; bare only fills what the prefix match didn't find, and only when
  // this board has exactly one lattice layer (two would collide at the Fusion level already -- not Pull's to fix).
  describe('a single-board (legacy/identity) document: lattice params come back with no L<id>_ prefix at all', () => {
    it('one layer, bare params: still produces the layer row, still counts an unmapped bare param', () => {
      const pullResult = {
        widthIn: 7, heightIn: 9,
        boardParams: { stroke_width: 0.3, node_diameter: 0.3, frame_thickness: 0.8, fred_custom_margin: 5 },
      };
      const result = buildChangeList(pullResult, { P, layers: [layer1], frame });

      expect(result.layerGroups).toHaveLength(1);
      expect(result.layerGroups[0]).toMatchObject({ layerId: '3', layerName: 'Layer 1' });
      expect(result.layerGroups[0].rows.map((r) => r.fusionParam).sort()).toEqual(['node_diameter', 'rail_width', 'tie_width']);
      expect(result.frameRows.map((r) => r.fusionParam)).toEqual(['frame_thickness']);
      expect(result.notMappedCount).toBe(1); // fred_custom_margin -- not silently swallowed by the bare fallback
    });

    it('two layers, bare params: neither claims them (Fusion itself cannot tell them apart) -- all unmapped, not misattributed', () => {
      const pullResult = { widthIn: 7, heightIn: 9, boardParams: { stroke_width: 0.9, node_diameter: 0.9 } };
      const result = buildChangeList(pullResult, { P, layers: [layer1, layer2], frame: null });

      expect(result.layerGroups).toEqual([]);
      expect(result.notMappedCount).toBe(2);
    });

    it('a layer-prefixed key wins over a same-named bare one when both are present', () => {
      const pullResult = { widthIn: 7, heightIn: 9, boardParams: { L3_node_diameter: 0.4, node_diameter: 0.9 } };
      const result = buildChangeList(pullResult, { P, layers: [layer1], frame: null });
      expect(result.layerGroups[0].rows).toEqual([
        { fusionParam: 'node_diameter', scope: 'layer', appPath: 'widths.nodeDiameter', label: 'Node diameter', unit: 'in', kind: 'nodes', layerId: '3', layerName: 'Layer 1', from: 0.25, to: 0.4, changed: true },
      ]);
      expect(result.notMappedCount).toBe(1); // the bare "node_diameter" is a DIFFERENT, unclaimed key -- still reported
    });
  });
});

describe('rails: how many Apply locks, how many Fusion moved (real shapes: 9 rails = 18 edge lines + 9 centre lines)', () => {
  // what Python's _handle_pull_sketch returns for a 7 x 9 lattice board: per rail two edge lines (no railId) and one
  // construction centre line carrying railId; rail3 +0.2 and rail6 -0.3 moved in Fusion (rails sit at 1..9)
  const RAIL_Y = { rail1: 1, rail2: 2, rail3: 2.8, rail4: 4, rail5: 5, rail6: 6.3, rail7: 7, rail8: 8, rail9: 9 };
  const curves = Object.entries(RAIL_Y).flatMap(([id, y]) => [
    { type: 'line', x1: 1, y1: y + 0.125, x2: 7, y2: y + 0.125, isConstruction: false, railId: null },
    { type: 'line', x1: 7, y1: y - 0.125, x2: 1, y2: y - 0.125, isConstruction: false, railId: null },
    { type: 'line', x1: 1, y1: y, x2: 7, y2: y, isConstruction: true, railId: id },
  ]);
  const live = (id) => ({ x: 4, y: Number(id.slice(4)) }); // the rails as Send drew them
  it('2 moved of 9 locked -- not the 18 edge lines', () => {
    expect(summarizeRails(curves, live)).toEqual({ locked: 9, moved: 2 });
  });
  it('buildChangeList carries the summary; without one both are 0', () => {
    const cl = buildChangeList({ curves }, { P: {}, layers: [], frame: null, rails: summarizeRails(curves, live) });
    expect([cl.railsLocked, cl.railsMoved]).toEqual([9, 2]);
    const none = buildChangeList({ curves }, { P: {}, layers: [], frame: null });
    expect([none.railsLocked, none.railsMoved]).toEqual([0, 0]);
  });
  it('a curve with no live rail is not counted (Apply leaves it alone); a rail repeated is counted once', () => {
    const only3 = (id) => (id === 'rail3' ? live(id) : null);
    expect(summarizeRails([...curves, ...curves], only3)).toEqual({ locked: 1, moved: 1 });
    expect(summarizeRails([{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 0, railId: null }], live)).toEqual({ locked: 0, moved: 0 });
  });
  it('vertical rails compare across x; a shift under the noise floor is not a move', () => {
    const v = [{ type: 'line', x1: 3.2, y1: 0, x2: 3.2, y2: 9, isConstruction: true, railId: 'rail3' }];
    expect(summarizeRails(v, () => ({ x: 3, y: 4.5 }))).toEqual({ locked: 1, moved: 1 });
    expect(summarizeRails(v, () => ({ x: 3.2 + CHANGE_EPS_IN / 2, y: 4.5 }))).toEqual({ locked: 1, moved: 0 });
  });
  it('no curves at all: 0 and 0', () => {
    expect(summarizeRails(undefined, live)).toEqual({ locked: 0, moved: 0 });
  });
});
