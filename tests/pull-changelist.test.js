/**
 * core/pull-changelist.js -- Pull from Fusion, step (b) (seat D 2026-10-16; advisor 45, Fred): PULL_MAP read
 * against the app's own current values, the change-list rows the dialog shows (mockup approved,
 * shots/seatD/pull/01_desktop_changelist.png).
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeLayerParams, layerParamsFor, compareScope, diffScope, applyRows, buildChangeList, CHANGE_EPS_IN,
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
    expect(result).toEqual({ boardRows: [], layerGroups: [], frameRows: [], frameShapeRows: [], frameShapeBeyond: [], keptCount: 0, notMappedCount: 0, curveCount: 0 });
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

describe('curveCount: rails move freely in Fusion (no driving param) -- informational only, never applied', () => {
  it('counts non-construction curves only -- a construction line was never a rail to begin with', () => {
    const pullResult = {
      curves: [
        { type: 'line', d: 'M 0 0 L 1 0', isConstruction: false },
        { type: 'line', d: 'M 0 1 L 1 1', isConstruction: false },
        { type: 'line', d: 'M 0 2 L 1 2', isConstruction: true },
      ],
    };
    expect(buildChangeList(pullResult, { P: {}, layers: [], frame: null }).curveCount).toBe(2);
  });

  it('no curves at all: 0, not undefined', () => {
    expect(buildChangeList({}, { P: {}, layers: [], frame: null }).curveCount).toBe(0);
  });
});
