/**
 * core/bricks/frame-blocks.js -- PORTABLE (see rng.js). Fred 2026-10-15 (MID-COURSE BLOCKS, mockup shots/seatE/midblocks):
 * a block placed along a frame's run, declared as data -- `frame.blocks = [{ id, x, y }]`, a board point and a stable id --
 * and laid as a QUOIN (the corners' own: contour-bands.js cuts every piece under it, the engine clears the wall from one
 * that reaches past a thin stack). His answers:
 *  1. SNAP TO JOINTS: it replaces whole pieces of the outer band's run -- the run of consecutive pieces around the point
 *     whose span is closest to the quoin unit -- so its faces are the run's own joints (no cut sliver);
 *  2. FULL SQUARE: always the quoin unit deep (primitive-ribbon.js QUOIN_BLOCK_IN), reaching past a thin stack -- or the
 *     row's own depth where that is deeper (no bare strip past it, as the curved block);
 *  3. on an arc, a RADIAL WEDGE: its arc face on the run, radial sides, its inner face the arc's offset (buildCurveBlockJoint's
 *     construction).
 * A point with no run piece of the outer band near it (a corner's fan or quoin, a wall stroke) places nothing: `skipped`.
 */
import { polygonIntersection, signedArea } from './geometry.js';

// minSpanShare: a run whose pieces around the point span less than this share of the quoin unit (a corner fillet's short arc:
// MEASURED T1 7x10 1.25 in, 0.24 sq in blocks) places nothing -- 'run too short'; a block that would meet a block placed
// before it (a waist's wedge spreads into the next arc's) places nothing either -- 'meets another block'
// maxTrimShare: a block may trim another run's piece (a neighbouring run's mitred end, a corner's fan or quoin) by at most
// this share of it; one that would cut deeper is too near a corner and places nothing -- 'too near a corner' (MEASURED T13
// 7x9 1.25 in mixed_bands: a block beside the neck's corner cut the top run's pieces under the floor, a 0.26 sq in hole)
// coverShare: a piece it replaces lies at least this much inside it (else it reaches past: too near a corner)
export const FRAME_BLOCK = Object.freeze({ arcStepIn: 0.1, maxPieces: 12, minSpanShare: 0.5, maxTrimShare: 0.1, coverShare: 0.98 });

const dirOf = (a) => Math.sign(a.theta2 - a.theta1) || 1;
/** a point's place along a primitive (a line: from p0; an arc: along its declared direction from theta1, at radius r) and
 *  its distance from it -- the projection clamped to the primitive */
function placeOn(prim, p) {
  if (prim.type === 'line') {
    const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y, len = Math.hypot(dx, dy) || 1;
    const t = Math.max(0, Math.min(len, ((p.x - prim.p0.x) * dx + (p.y - prim.p0.y) * dy) / len));
    return { along: t, dist: Math.hypot(prim.p0.x + (dx / len) * t - p.x, prim.p0.y + (dy / len) * t - p.y) };
  }
  const dir = dirOf(prim), sweep = Math.abs(prim.theta2 - prim.theta1);
  let a = (Math.atan2(p.y - prim.cy, p.x - prim.cx) - prim.theta1) * dir;
  while (a < 0) a += 2 * Math.PI;
  while (a > 2 * Math.PI) a -= 2 * Math.PI;
  if (a > sweep) a = a - sweep < 2 * Math.PI - a ? sweep : 0; // past either end: the nearer end
  const th = prim.theta1 + dir * a, q = { x: prim.cx + prim.r * Math.cos(th), y: prim.cy + prim.r * Math.sin(th) };
  return { along: a * prim.r, dist: Math.hypot(q.x - p.x, q.y - p.y) };
}
/** a piece's span along its primitive: the min / max place of its vertices (a run's pieces are cut square / radially) */
function spanOf(prim, polygon) {
  const a = polygon.map((p) => placeOn(prim, p).along);
  return [Math.min(...a), Math.max(...a)];
}
/** the block's outline over [a0, a1] along `prim`, `depth` in (a line: a rectangle; an arc: the radial wedge) */
function blockPolygon(prim, a0, a1, depth) {
  if (prim.type === 'line') {
    const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y, len = Math.hypot(dx, dy) || 1, u = { x: dx / len, y: dy / len }, n = { x: prim.nx, y: prim.ny };
    const at = (a, d) => ({ x: prim.p0.x + u.x * a + n.x * d, y: prim.p0.y + u.y * a + n.y * d });
    return [at(a0, 0), at(a1, 0), at(a1, depth), at(a0, depth)];
  }
  const dir = dirOf(prim), th = (a) => prim.theta1 + (dir * a) / prim.r, rIn = prim.r - prim.radialSign * depth;
  const ring = (r, from, to) => {
    const n = Math.max(1, Math.round((Math.abs(to - from) * r) / FRAME_BLOCK.arcStepIn));
    return Array.from({ length: n + 1 }, (_, k) => { const t = from + ((to - from) * k) / n; return { x: prim.cx + r * Math.cos(t), y: prim.cy + r * Math.sin(t) }; });
  };
  return [...ring(prim.r, th(a0), th(a1)), ...ring(rIn, th(a1), th(a0))];
}

/**
 * Places each block on the laid stack: the outer band's run pieces it replaces are taken out, the block goes in as a quoin
 * (its own quoin ribbon, `key` 'blocks'). `bricks` / `origins` / `quoinRibbons` as contour-bands.js keeps them (origins[k].src
 * = the primitive a run piece was laid from); returns them anew + `skipped` ([{ id, why }]).
 */
export function placeFrameBlocks({ blocks, bricks, origins, quoinRibbons, primitives, sizeIn, quoinSrc, minPieceSqIn = 0 }) {
  const gone = new Set(), added = [], skipped = [], trimmed = new Map(); // trimmed: piece -> what the blocks placed cut off it
  for (const blk of blocks || []) {
    if (!blk || !Number.isFinite(blk.x) || !Number.isFinite(blk.y)) continue;
    const p = { x: blk.x, y: blk.y };
    let best = null;
    primitives.forEach((prim, i) => { const at = placeOn(prim, p); if (!best || at.dist < best.dist) best = { i, ...at }; });
    const prim = best && primitives[best.i];
    const run = bricks.map((b, k) => k).filter((k) => !gone.has(k) && bricks[k].bandIndex === 0 && (bricks[k].rowIndex || 0) === 0 && origins[k] && origins[k].src === best.i)
      .map((k) => ({ k, span: spanOf(prim, bricks[k].polygon) })).sort((a, b) => a.span[0] - b.span[0]);
    const hit = run.findIndex((r) => r.span[0] - 1e-9 <= best.along && best.along <= r.span[1] + 1e-9);
    const home = hit >= 0 ? hit : run.reduce((b, r, j) => (Math.abs((r.span[0] + r.span[1]) / 2 - best.along) < Math.abs((run[b].span[0] + run[b].span[1]) / 2 - best.along) ? j : b), 0);
    if (!run.length || (hit < 0 && Math.min(...run.map((r) => Math.abs((r.span[0] + r.span[1]) / 2 - best.along))) > sizeIn)) { skipped.push({ id: blk.id, why: 'no run here' }); continue; }
    // the consecutive pieces around the point, tried by how close their span is to the quoin unit (snap to the run's own joints),
    // then by how well centred on the point: the first that passes every rule below is the block's
    const wins = [];
    for (let s = Math.max(0, home - FRAME_BLOCK.maxPieces); s <= home; s++) for (let e = home; e < Math.min(run.length, s + FRAME_BLOCK.maxPieces); e++) {
      const span = run[e].span[1] - run[s].span[0];
      wins.push({ s, e, span, miss: Math.abs(span - sizeIn), centre: Math.abs((run[e].span[1] + run[s].span[0]) / 2 - best.along) });
    }
    wins.sort((a, b) => (Math.abs(a.miss - b.miss) > 1e-9 ? a.miss - b.miss : a.centre - b.centre));
    const area = (q) => Math.abs(signedArea(q) || 0);
    let placed = null, why = 'run too short';
    for (const win of wins) {
      if (win.span < FRAME_BLOCK.minSpanShare * sizeIn) continue; // why stays 'run too short' unless a longer window got further
      const taken = run.slice(win.s, win.e + 1);
      // at least the pieces' own depth: a row deeper than the quoin unit (a soldier band at 1.25 in) would leave the strip
      // past the block's inner face bare -- the curved block's rule (primitive-ribbon.js: depth = max(s, the row's depth))
      const rowDepth = Math.max(...taken.flatMap((t) => bricks[t.k].polygon.map((q) => placeOn(prim, q).dist)));
      const depth = Math.max(sizeIn, rowDepth);
      // an arc too tight for the block: its inner face at no radius (a convex corner fillet smaller than the unit) -- the
      // curved block's own rule (primitive-ribbon.js buildCurveBlockJoint: no inner arc, the mitre)
      if (prim.type === 'arc' && !(prim.r - prim.radialSign * depth > FRAME_BLOCK.arcStepIn)) { why = 'arc too tight'; continue; }
      const polygon = blockPolygon(prim, taken[0].span[0], taken[taken.length - 1].span[1], depth);
      // it replaces only pieces it covers: a run's mitred END piece reaches past it (MEASURED T6 7x9 1 in single_soldier: the
      // neck's last piece, a triangle at the inner corner, left bare) -- that window is too near a corner
      if (taken.some((t) => area(polygonIntersection(polygon, bricks[t.k].polygon)) < FRAME_BLOCK.coverShare * area(bricks[t.k].polygon))) { why = 'too near a corner'; continue; }
      if (added.some((o) => area(polygonIntersection(o.brick.polygon, polygon)) > 1e-6)) { why = 'meets another block'; continue; }
      // another run's piece, in ANY band (a corner's fan, an inner band's mitred end), trimmed by this block and every block
      // placed before it together (MEASURED T5 9x12 1 in mixed_bands: two blocks either side of a corner each trimmed the
      // inner band's fan within the share, together they cut it under the floor)
      const takenSet = new Set(taken.map((t) => t.k)), trims = new Map();
      let deepCut = false;
      // every piece a block touches ends a TRIM (at most maxTrimShare cut off), COVERED (at least coverShare under the blocks:
      // it goes with them), or a REAL PIECE (what is left at least the floor) -- anything between is a sliver near a corner
      // (MEASURED T6 7x9 1.25 / T7 7x9 1.5 in mixed_bands: an inner band's piece of the block's own run cut to a sliver)
      bricks.forEach((b, k) => {
        // (the block's own run: its inner bands' pieces at the faces are cut and their leftovers merged into a row neighbour by
        // cutUnderQuoins -- the corners' L rule; MEASURED: counting them skipped every block at 0.75 in)
        if (deepCut || takenSet.has(k) || gone.has(k) || !origins[k] || origins[k].src === best.i) return;
        const t = area(polygonIntersection(polygon, b.polygon));
        if (!(t > 0)) return;
        trims.set(k, t);
        const a = area(b.polygon), cut = (trimmed.get(k) || 0) + t;
        if (cut > FRAME_BLOCK.maxTrimShare * a && cut < FRAME_BLOCK.coverShare * a && a - cut < minPieceSqIn) deepCut = true;
      });
      if (deepCut) { why = 'too near a corner'; continue; }
      for (const [k, t] of trims) trimmed.set(k, (trimmed.get(k) || 0) + t);
      placed = { taken, polygon };
      break;
    }
    if (!placed) { skipped.push({ id: blk.id, why }); continue; }
    const { taken, polygon } = placed;
    for (const t of taken) gone.add(t.k);
    added.push({ brick: { ...bricks[taken[0].k], id: `block-${blk.id}`, polygon, frameBlock: blk.id }, curved: prim.type === 'arc' });
  }
  if (!added.length) return { bricks, origins, quoinRibbons, skipped };
  const map = new Map(), outBricks = [], outOrigins = [];
  bricks.forEach((b, k) => { if (gone.has(k)) return; map.set(k, outBricks.length); outBricks.push(b); outOrigins.push(origins[k]); });
  const ribbons = quoinRibbons.map((list) => list.filter((q) => map.has(q.at)).map((q) => ({ ...q, at: map.get(q.at) }))).filter((l) => l.length);
  const blockRibbon = added.map(({ brick, curved }) => {
    outBricks.push(brick); outOrigins.push({ src: quoinSrc });
    return { at: outBricks.length - 1, square: brick.polygon, corner: null, key: 'blocks', curved };
  });
  return { bricks: outBricks, origins: outOrigins, quoinRibbons: [...ribbons, blockRibbon], skipped };
}
