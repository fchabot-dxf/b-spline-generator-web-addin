import { clampedKnots } from './bspline-math.js';

class StepBuilder {
  constructor() {
    this._id = 0;
    this._lines = [];
  }
  nextId() { return ++this._id; }
  write(id, text) {
    this._lines.push(`#${id}=${text}`);
    return id;
  }
  lines() { return this._lines; }
}

function fmt(n) {
  if (n === 0) return '0.';
  const s = n.toPrecision(5).replace(/\.?0+$/, '');
  return s.includes('.') ? s : s + '.';
}
function ids(arr) { return `(${arr.map(i => `#${i}`).join(',')})`; }
function ids2(arr2) { return `(${arr2.map(row => ids(row)).join(',')})`; }
function nums(arr) { return `(${arr.map(fmt).join(',')})`; }
function ints(arr) { return `(${arr.join(',')})`; }

// B-spline knot logic now imported from bspline-math.js

/**
 * SINGLE-STEP EXPORT (surface only)
 * -----------------------------------
 * Generates one AP214 STEP file containing a single B-spline surface body.
 * Used by: live preview sync (sendFusionPreview) when thicken is disabled,
 *          and by executeExport() for the "Clean Surface" / "Stamped Surface" variants.
 * Python receiver: _handle_generate() → single-stepText path.
 *
 * For multi-body / solid exports see: generateThickenedStep()
 */
export function generateStep(heights, params) {
  const { widthIn, heightIn, nx, nz, orientation = 'z-up', name = 'Terrain Surface' } = params;
  function mapPt(x, y, z) {
    if (orientation === 'y-up') return [x, z, -y];
    return [x, y, z];
  }
  const b = new StepBuilder();
  const W = widthIn, H = heightIn;

  const idMilliMetre = b.nextId(); b.write(idMilliMetre, '(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))');
  const idLenDim = b.nextId(); b.write(idLenDim, 'DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)');
  const idLenMeasure = b.nextId(); b.write(idLenMeasure, `LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#${idMilliMetre})`);
  const idInch = b.nextId(); b.write(idInch, `(CONVERSION_BASED_UNIT('inch',#${idLenMeasure}) LENGTH_UNIT() NAMED_UNIT(#${idLenDim}))`);
  const idAngleUnit = b.nextId(); b.write(idAngleUnit, '(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))');
  const idSolidAngleUnit = b.nextId(); b.write(idSolidAngleUnit, '(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())');
  const idUncertainty = b.nextId(); b.write(idUncertainty, `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#${idInch},'DISTANCE_ACCURACY_VALUE','')`);
  const idGeomCtx = b.nextId(); b.write(idGeomCtx, `(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${idUncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${idInch},#${idAngleUnit},#${idSolidAngleUnit})) REPRESENTATION_CONTEXT('','3D'))`);
  const idAppCtx = b.nextId(); b.write(idAppCtx, `APPLICATION_CONTEXT('Core Data for Automotive Mechanical Design Process')`);
  const idAppProtocol = b.nextId(); b.write(idAppProtocol, `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2009,#${idAppCtx})`);
  const idProdCtx = b.nextId(); b.write(idProdCtx, `PRODUCT_CONTEXT('part definition',#${idAppCtx},'mechanical')`);
  const idProduct = b.nextId(); b.write(idProduct, `PRODUCT('${name}','${name}',$,(#${idProdCtx}))`);
  const idPDF = b.nextId(); b.write(idPDF, `PRODUCT_DEFINITION_FORMATION('',$,#${idProduct})`);
  const idPDCtx = b.nextId(); b.write(idPDCtx, `PRODUCT_DEFINITION_CONTEXT('part definition',#${idAppCtx},'design')`);
  const idPD = b.nextId(); b.write(idPD, `PRODUCT_DEFINITION('${name}','',#${idPDF},#${idPDCtx})`);
  const idPDS = b.nextId(); b.write(idPDS, `PRODUCT_DEFINITION_SHAPE('',$,#${idPD})`);

  const ptId = [];
  for (let i = 0; i < nx; i++) {
    ptId.push([]);
    for (let j = 0; j < nz; j++) {
      const [ex, ey, ez] = mapPt(-W/2 + i*W/(nx-1), -H/2 + j*H/(nz-1), heights[j*nx + i]);
      const id = b.nextId();
      b.write(id, `CARTESIAN_POINT('',(${fmt(ex)},${fmt(ey)},${fmt(ez)}))`);
      ptId[i].push(id);
    }
  }

  const ukn = clampedKnots(nx, 3), vkn = clampedKnots(nz, 3);
  const idSurf = b.nextId();
  b.write(idSurf, `B_SPLINE_SURFACE_WITH_KNOTS('',3,3,${ids2(ptId)},.UNSPECIFIED.,.F.,.F.,.F.,${ints(ukn.mults)},${ints(vkn.mults)},${nums(ukn.knots)},${nums(vkn.knots)},.CONTINUOUS.)`);

  function bspCurve(controlIds, label) {
    const kn = clampedKnots(controlIds.length, 3);
    const id = b.nextId();
    b.write(id, `B_SPLINE_CURVE_WITH_KNOTS('${label}',3,${ids(controlIds)},.UNSPECIFIED.,.F.,.F.,${ints(kn.mults)},${nums(kn.knots)},.UNSPECIFIED.)`);
    return id;
  }
  const idCF = bspCurve(Array.from({length: nx}, (_, i) => ptId[i][0]), 'back');
  const idCR = bspCurve(Array.from({length: nz}, (_, j) => ptId[nx-1][j]), 'right');
  const idCB = bspCurve(Array.from({length: nx}, (_, i) => ptId[i][nz-1]), 'front');
  const idCL = bspCurve(Array.from({length: nz}, (_, j) => ptId[0][j]), 'left');

  const idVFL = b.nextId(); b.write(idVFL, `VERTEX_POINT('FL',#${ptId[0][0]})`);
  const idVFR = b.nextId(); b.write(idVFR, `VERTEX_POINT('FR',#${ptId[nx-1][0]})`);
  const idVBL = b.nextId(); b.write(idVBL, `VERTEX_POINT('BL',#${ptId[0][nz-1]})`);
  const idVBR = b.nextId(); b.write(idVBR, `VERTEX_POINT('BR',#${ptId[nx-1][nz-1]})`);

  const idEF = b.nextId(); b.write(idEF, `EDGE_CURVE('front',#${idVFL},#${idVFR},#${idCF},.T.)`);
  const idER = b.nextId(); b.write(idER, `EDGE_CURVE('right',#${idVFR},#${idVBR},#${idCR},.T.)`);
  const idEB = b.nextId(); b.write(idEB, `EDGE_CURVE('back',#${idVBL},#${idVBR},#${idCB},.T.)`);
  const idEL = b.nextId(); b.write(idEL, `EDGE_CURVE('left',#${idVFL},#${idVBL},#${idCL},.T.)`);

  const idOF = b.nextId(); b.write(idOF, `ORIENTED_EDGE('',*,*,#${idEF},.T.)`);
  const idOR = b.nextId(); b.write(idOR, `ORIENTED_EDGE('',*,*,#${idER},.T.)`);
  const idOB = b.nextId(); b.write(idOB, `ORIENTED_EDGE('',*,*,#${idEB},.F.)`);
  const idOL = b.nextId(); b.write(idOL, `ORIENTED_EDGE('',*,*,#${idEL},.F.)`);

  const idLoop = b.nextId(); b.write(idLoop, `EDGE_LOOP('',(#${idOF},#${idOR},#${idOB},#${idOL}))`);
  const idBound = b.nextId(); b.write(idBound, `FACE_OUTER_BOUND('',#${idLoop},.T.)`);
  const idFace = b.nextId(); b.write(idFace, `ADVANCED_FACE('',(#${idBound}),#${idSurf},.T.)`);
  const idShell = b.nextId(); b.write(idShell, `OPEN_SHELL('',(#${idFace}))`);
  const idModel = b.nextId(); b.write(idModel, `SHELL_BASED_SURFACE_MODEL('${name}',(#${idShell}))`);
  const idSR = b.nextId(); b.write(idSR, `SHAPE_REPRESENTATION('',(#${idModel}),#${idGeomCtx})`);
  const idSDR = b.nextId(); b.write(idSDR, `SHAPE_DEFINITION_REPRESENTATION(#${idPDS},#${idSR})`);

  const idCol = b.nextId(); b.write(idCol, `COLOUR_RGB('Terrain',.95,.90,.75)`);
  const idFill = b.nextId(); b.write(idFill, `FILL_AREA_STYLE_COLOUR('Terrain',#${idCol})`);
  const idStyle = b.nextId(); b.write(idStyle, `FILL_AREA_STYLE('Terrain',(#${idFill}))`);
  const idSurfFill = b.nextId(); b.write(idSurfFill, `SURFACE_STYLE_FILL_AREA(#${idStyle})`);
  const idSurfSide = b.nextId(); b.write(idSurfSide, `SURFACE_SIDE_STYLE('',(#${idSurfFill}))`);
  const idSurfUsage = b.nextId(); b.write(idSurfUsage, `SURFACE_STYLE_USAGE(.BOTH.,#${idSurfSide})`);
  const idPres = b.nextId(); b.write(idPres, `PRESENTATION_STYLE_ASSIGNMENT((#${idSurfUsage}))`);
  b.write(b.nextId(), `STYLED_ITEM('',(#${idPres}),#${idFace})`);

  const idVisual = b.nextId(); b.write(idVisual, `MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(#${b._id}),#${idGeomCtx})`);

  return assembleFile(b, name);
}

/**
 * MULTI-EXPORT — THICKENED / MULTI-BODY STEP GENERATOR
 * ------------------------------------------------------
 * Generates one AP214 STEP file that can contain multiple bodies in a single file:
 *   - Stamped Solid  (green)  — top surface with stamp + thickened underside
 *   - Clean Solid    (red)    — un-stamped surface + thickened underside
 *   - Stamped Surface (blue)  — stamped top surface only (shell)
 *   - Clean Surface  (yellow) — un-stamped top surface only (shell)
 * Which bodies are included is controlled by params.options (stamped/clean/stampedSurf/cleanSurf).
 *
 * Called by:
 *   • executeExport()     → "Clean Solid" and "Stamped Solid" variants in the stepVariants array
 *   • sendFusionPreview() → live preview when thicken is enabled (single-body preview)
 *
 * Python receiver: _handle_generate() → multi-variant path (stepVariants) OR single-stepText path.
 * Each body is registered as its own PRODUCT in the STEP assembly so Fusion imports them separately.
 */
export function generateThickenedStep(heights, offsetPts, params, unstampedHeights) {
  const b = new StepBuilder();
  const { widthIn, heightIn, nx, nz, orientation = 'z-up', name = 'Terrain', options = {} } = params;
  const W = widthIn, Ht = heightIn;

  function mapPt(x, y, z) {
    if (orientation === 'y-up') return [x, z, -y];
    return [x, y, z];
  }
  const fmt = (v) => v.toFixed(6);

  // 1. Units, Header & Contexts
  const idMilliMetre = b.nextId(); b.write(idMilliMetre, '(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))');
  const idLenDim = b.nextId(); b.write(idLenDim, 'DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)');
  const idLenMeasure = b.nextId(); b.write(idLenMeasure, `LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#${idMilliMetre})`);
  const idInch = b.nextId(); b.write(idInch, `(CONVERSION_BASED_UNIT('inch',#${idLenMeasure}) LENGTH_UNIT() NAMED_UNIT(#${idLenDim}))`);
  const idAngleUnit = b.nextId(); b.write(idAngleUnit, '(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))');
  const idSolidAngleUnit = b.nextId(); b.write(idSolidAngleUnit, '(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())');
  const idUncertainty = b.nextId(); b.write(idUncertainty, `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#${idInch},'DISTANCE_ACCURACY_VALUE','')`);
  const idGeomCtx = b.nextId(); b.write(idGeomCtx, `(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${idUncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${idInch},#${idAngleUnit},#${idSolidAngleUnit})) REPRESENTATION_CONTEXT('','3D'))`);
  const idAppCtx = b.nextId(); b.write(idAppCtx, `APPLICATION_CONTEXT('Core Data for Automotive Mechanical Design Process')`);
  const idAppProtocol = b.nextId(); b.write(idAppProtocol, `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2009,#${idAppCtx})`);
  const idProdCtx = b.nextId(); b.write(idProdCtx, `PRODUCT_CONTEXT('part definition',#${idAppCtx},'mechanical')`);
  const idPDCtx = b.nextId(); b.write(idPDCtx, `PRODUCT_DEFINITION_CONTEXT('part definition',#${idAppCtx},'design')`);

  // Note: Root product is now handled per-body in the loop below to support multibody export.

  const COLORS = {
    GREEN:  [0.2, 0.8, 0.2], // Stamped
    RED:    [0.8, 0.2, 0.2], // Clean
    BLUE:   [0.2, 0.4, 0.8], // Stamped Surf
    YELLOW: [0.9, 0.8, 0.2]  // Clean Surf
  };  const bodies = [];
  // Use a local copy to avoid any side-effect issues
  const currentStamped = heights;
  const currentClean   = unstampedHeights || heights;

  if (options.stamped && currentStamped) {
    bodies.push({ data: currentStamped, label: 'Stamped Solid', rgb: COLORS.GREEN, isSolid: true, offsetPts: offsetPts });
  }
  if (options.clean && currentClean) {
    bodies.push({ data: currentClean, label: 'Clean Solid', rgb: COLORS.RED, isSolid: true, offsetPts: offsetPts });
  }
  if (options.cleanSurf && currentClean) {
    bodies.push({ data: currentClean, label: 'Clean Surface', rgb: COLORS.YELLOW, isSolid: false });
  }
  if (options.stampedSurf && currentStamped) {
    bodies.push({ data: currentStamped, label: 'Stamped Surface', rgb: COLORS.BLUE, isSolid: false });
  }
  // Analytical: Export thick (teal/blue) regions as a separate surface if present
  if (params.clampMap && params.thickness) {
    const thickMask = [];
    for (let k = 0; k < params.clampMap.length; k++) {
      if (params.clampMap[k] > params.thickness + 1e-4) thickMask.push(k);
    }
    if (thickMask.length > 0) {
      // Create a surface with only thick points (set others to NaN)
      const thickSurf = new Float32Array(params.clampMap.length);
      for (let k = 0; k < params.clampMap.length; k++) {
        thickSurf[k] = thickMask.includes(k) ? heights[k] : NaN;
      }
      bodies.push({ data: thickSurf, label: 'Thick Regions (Analytical)', rgb: [0.0, 0.8, 1.0], isSolid: false });
    }
  }

  // Fallback ONLY if absolutely nothing selected (typically preview mode)
  if (bodies.length === 0) {
    bodies.push({ data: currentStamped, label: 'Preview Solid', rgb: COLORS.GREEN, isSolid: true, offsetPts: offsetPts });
  }

  const resultIds = [];
  const styledItemIds = [];

  for (const body of bodies) {
    const bNx = nx, bNz = nz;
    const ukn = clampedKnots(bNx, 3), vkn = clampedKnots(bNz, 3);

    function getStyleId(rgb) {
      const idCol = b.nextId(); b.write(idCol, `COLOUR_RGB('',${fmt(rgb[0])},${fmt(rgb[1])},${fmt(rgb[2])})`);
      const idFill = b.nextId(); b.write(idFill, `FILL_AREA_STYLE_COLOUR('',#${idCol})`);
      const idStyle = b.nextId(); b.write(idStyle, `FILL_AREA_STYLE('',(#${idFill}))`);
      const idSurfFill = b.nextId(); b.write(idSurfFill, `SURFACE_STYLE_FILL_AREA(#${idStyle})`);
      const idSurfSide = b.nextId(); b.write(idSurfSide, `SURFACE_SIDE_STYLE('',(#${idSurfFill}))`);
      const idSurfUsage = b.nextId(); b.write(idSurfUsage, `SURFACE_STYLE_USAGE(.BOTH.,#${idSurfSide})`);
      const idPres = b.nextId(); b.write(idPres, `PRESENTATION_STYLE_ASSIGNMENT((#${idSurfUsage}))`);
      return idPres;
    }

    if (body.isSolid && body.offsetPts) {
      const ptBotId = [];
      for (let i = 0; i < bNx; i++) {
        ptBotId.push([]);
        for (let j = 0; j < bNz; j++) {
          const bIdx = (j * bNx + i) * 3;
          const [ex, ey, ez] = mapPt(body.offsetPts[bIdx], body.offsetPts[bIdx+1], body.offsetPts[bIdx+2]);
          ptBotId[i].push(b.write(b.nextId(), `CARTESIAN_POINT('',(${fmt(ex)},${fmt(ey)},${fmt(ez)}))`));
        }
      }
      const idBotSurf = b.write(b.nextId(), `B_SPLINE_SURFACE_WITH_KNOTS('${body.label} Bottom',3,3,${ids2(ptBotId)},.UNSPECIFIED.,.F.,.F.,.F.,${ints(ukn.mults)},${ints(vkn.mults)},${nums(ukn.knots)},${nums(vkn.knots)},.CONTINUOUS.)`);

      const ptTopId = [];
      for (let i = 0; i < bNx; i++) {
        ptTopId.push([]);
        for (let j = 0; j < bNz; j++) {
          const [ex, ey, ez] = mapPt(-W/2 + i*W/(bNx-1), -Ht/2 + j*Ht/(bNz-1), body.data[j*bNx + i]);
          ptTopId[i].push(b.write(b.nextId(), `CARTESIAN_POINT('',(${fmt(ex)},${fmt(ey)},${fmt(ez)}))`));
        }
      }
      const idTopSurf = b.write(b.nextId(), `B_SPLINE_SURFACE_WITH_KNOTS('${body.label} Top',3,3,${ids2(ptTopId)},.UNSPECIFIED.,.F.,.F.,.F.,${ints(ukn.mults)},${ints(vkn.mults)},${nums(ukn.knots)},${nums(vkn.knots)},.CONTINUOUS.)`);

      const vB = [b.nextId(), b.nextId(), b.nextId(), b.nextId()];
      b.write(vB[0], `VERTEX_POINT('',#${ptBotId[0][0]})`);
      b.write(vB[1], `VERTEX_POINT('',#${ptBotId[bNx-1][0]})`);
      b.write(vB[2], `VERTEX_POINT('',#${ptBotId[bNx-1][bNz-1]})`);
      b.write(vB[3], `VERTEX_POINT('',#${ptBotId[0][bNz-1]})`);

      const vT = [b.nextId(), b.nextId(), b.nextId(), b.nextId()];
      b.write(vT[0], `VERTEX_POINT('',#${ptTopId[0][0]})`);
      b.write(vT[1], `VERTEX_POINT('',#${ptTopId[bNx-1][0]})`);
      b.write(vT[2], `VERTEX_POINT('',#${ptTopId[bNx-1][bNz-1]})`);
      b.write(vT[3], `VERTEX_POINT('',#${ptTopId[0][bNz-1]})`);

      const cB = buildEdgeCurves(b, ptBotId, vB[0], vB[1], vB[2], vB[3], body.label+'_B');
      const cT = buildEdgeCurves(b, ptTopId, vT[0], vT[1], vT[2], vT[3], body.label+'_T');
      const cP = [
        pillar(b, 'Pil0', vT[0], vB[0], ptTopId[0][0], ptBotId[0][0]),
        pillar(b, 'Pil1', vT[1], vB[1], ptTopId[bNx-1][0], ptBotId[bNx-1][0]),
        pillar(b, 'Pil2', vT[2], vB[2], ptTopId[bNx-1][bNz-1], ptBotId[bNx-1][bNz-1]),
        pillar(b, 'Pil3', vT[3], vB[3], ptTopId[0][bNz-1], ptBotId[0][bNz-1])
      ];

      const wF = wallSurf(b, 'WF', Array.from({length: bNx}, (_, u) => ptTopId[bNx-1-u][0]), Array.from({length: bNx}, (_, u) => ptBotId[bNx-1-u][0]));
      const wR = wallSurf(b, 'WR', Array.from({length: bNz}, (_, u) => ptTopId[bNx-1][bNz-1-u]), Array.from({length: bNz}, (_, u) => ptBotId[bNx-1][bNz-1-u]));
      const wB = wallSurf(b, 'WB', Array.from({length: bNx}, (_, u) => ptTopId[u][bNz-1]), Array.from({length: bNx}, (_, u) => ptBotId[u][bNz-1]));
      const wL = wallSurf(b, 'WL', Array.from({length: bNz}, (_, u) => ptTopId[0][u]), Array.from({length: bNz}, (_, u) => ptBotId[0][u]));

      const faces = [
        face(b, idTopSurf, true, oe(b, cT[0], true), oe(b, cT[1], true), oe(b, cT[2], false), oe(b, cT[3], false)),
        face(b, idBotSurf, false, oe(b, cB[3], true), oe(b, cB[2], true), oe(b, cB[1], false), oe(b, cB[0], false)),
        face(b, wF, true, oe(b, cT[0], false), oe(b, cP[0], true), oe(b, cB[0], true), oe(b, cP[1], false)),
        face(b, wR, true, oe(b, cT[1], false), oe(b, cP[1], true), oe(b, cB[1], true), oe(b, cP[2], false)),
        face(b, wB, true, oe(b, cT[2], true),  oe(b, cP[2], true), oe(b, cB[2], false), oe(b, cP[3], false)),
        face(b, wL, true, oe(b, cT[3], true),  oe(b, cP[3], true), oe(b, cB[3], false), oe(b, cP[0], false))
      ];

      const idShell = b.write(b.nextId(), `CLOSED_SHELL('${body.label}',(#${faces.join(',#')}))`);
      const idSolid = b.write(b.nextId(), `MANIFOLD_SOLID_BREP('${body.label}',#${idShell})`);
      resultIds.push(idSolid);

      const styleId = getStyleId(body.rgb);
      for (const fid of faces) {
        styledItemIds.push(b.write(b.nextId(), `STYLED_ITEM('',(#${styleId}),#${fid})`));
      }
    } else {
      const ptId = [];
      for (let i = 0; i < bNx; i++) {
        ptId.push([]);
        for (let j = 0; j < bNz; j++) {
          const [ex, ey, ez] = mapPt(-W/2 + i*W/(bNx-1), -Ht/2 + j*Ht/(bNz-1), body.data[j*bNx + i]);
          ptId[i].push(b.write(b.nextId(), `CARTESIAN_POINT('',(${fmt(ex)},${fmt(ey)},${fmt(ez)}))`));
        }
      }
      const idSurf = b.write(b.nextId(), `B_SPLINE_SURFACE_WITH_KNOTS('${body.label}',3,3,${ids2(ptId)},.UNSPECIFIED.,.F.,.F.,.F.,${ints(ukn.mults)},${ints(vkn.mults)},${nums(ukn.knots)},${nums(vkn.knots)},.CONTINUOUS.)`);
      const vT = [b.nextId(), b.nextId(), b.nextId(), b.nextId()];
      b.write(vT[0], `VERTEX_POINT('',#${ptId[0][0]})`);
      b.write(vT[1], `VERTEX_POINT('',#${ptId[bNx-1][0]})`);
      b.write(vT[2], `VERTEX_POINT('',#${ptId[bNx-1][bNz-1]})`);
      b.write(vT[3], `VERTEX_POINT('',#${ptId[0][bNz-1]})`);
      const curves = buildEdgeCurves(b, ptId, vT[0], vT[1], vT[2], vT[3], body.label);
      const idFace = face(b, idSurf, true, oe(b, curves[0], true), oe(b, curves[1], true), oe(b, curves[2], false), oe(b, curves[3], false));
      const idShell = b.write(b.nextId(), `OPEN_SHELL('${body.label}',(#${idFace}))`);
      const idModel = b.write(b.nextId(), `SHELL_BASED_SURFACE_MODEL('${body.label}',(#${idShell}))`);
      resultIds.push(idModel);

      const styleId = getStyleId(body.rgb);
      styledItemIds.push(b.write(b.nextId(), `STYLED_ITEM('',(#${styleId}),#${idFace})`));
    }
  }

  // 3. Assemble each body as a separate Product in the STEP assembly
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const rid  = resultIds[i];
    const bName = `${name} - ${body.label}`;

    // Each body gets its own Product Identity
    const idProd = b.nextId(); b.write(idProd, `PRODUCT('${bName}','${bName}',$,(#${idProdCtx}))`);
    const idPDF  = b.nextId(); b.write(idPDF, `PRODUCT_DEFINITION_FORMATION('',$,#${idProd})`);
    const idPD   = b.nextId(); b.write(idPD, `PRODUCT_DEFINITION('part','',#${idPDF},#${idPDCtx})`);
    const idPDS  = b.nextId(); b.write(idPDS, `PRODUCT_DEFINITION_SHAPE('',$,#${idPD})`);

    // Link the unique geometry representation to this specific product
    const idSR = b.nextId();
    b.write(idSR, `SHAPE_REPRESENTATION('${bName}',(#${rid}),#${idGeomCtx})`);
    b.write(b.nextId(), `SHAPE_DEFINITION_REPRESENTATION(#${idPDS},#${idSR})`);
  }

  // Presentation Styles (applied globally to the faces/items already created)
  if (styledItemIds.length > 0) {
    const idVisual = b.nextId();
    b.write(idVisual, `MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(#${styledItemIds.join(',#')}),#${idGeomCtx})`);
  }

  return assembleFile(b, name);
}

// ─── Internal Implementation Helpers ──────────────────────────────────────────

function buildEdgeCurves(b, ptGrid, vFL, vFR, vBR, vBL, prefix) {
  const nx = ptGrid.length, nz = ptGrid[0].length;
  const cF = bspCurve(b, prefix+'-F', Array.from({length: nx}, (_, i) => ptGrid[i][0]));
  const cR = bspCurve(b, prefix+'-R', Array.from({length: nz}, (_, j) => ptGrid[nx-1][j]));
  const cB = bspCurve(b, prefix+'-B', Array.from({length: nx}, (_, i) => ptGrid[i][nz-1]));
  const cL = bspCurve(b, prefix+'-L', Array.from({length: nz}, (_, j) => ptGrid[0][j]));
  
  const eF = b.nextId(); b.write(eF, `EDGE_CURVE('',#${vFL},#${vFR},#${cF},.T.)`);
  const eR = b.nextId(); b.write(eR, `EDGE_CURVE('',#${vFR},#${vBR},#${cR},.T.)`);
  const eB = b.nextId(); b.write(eB, `EDGE_CURVE('',#${vBL},#${vBR},#${cB},.T.)`);
  const eL = b.nextId(); b.write(eL, `EDGE_CURVE('',#${vFL},#${vBL},#${cL},.T.)`);
  return [eF, eR, eB, eL];
}
function bspCurve(b, label, ptIds) {
  const kn = clampedKnots(ptIds.length, 3);
  const id = b.nextId();
  b.write(id, `B_SPLINE_CURVE_WITH_KNOTS('${label}',3,${ids(ptIds)},.UNSPECIFIED.,.F.,.F.,${ints(kn.mults)},${nums(kn.knots)},.UNSPECIFIED.)`);
  return id;
}
function pillar(b, label, vtop, vbot, ptop, pbot) {
  const kn = clampedKnots(2, 1);
  const id = b.nextId(); b.write(id, `B_SPLINE_CURVE_WITH_KNOTS('${label}',1,(#${ptop},#${pbot}),.UNSPECIFIED.,.F.,.F.,${ints(kn.mults)},${nums(kn.knots)},.UNSPECIFIED.)`);
  const eid = b.nextId(); b.write(eid, `EDGE_CURVE('${label}',#${vtop},#${vbot},#${id},.T.)`);
  return eid;
}
function wallSurf(b, label, rowTop, rowBot) {
  const nu = rowTop.length;
  const ukw = clampedKnots(nu, 3);
  const ptWall = Array.from({length: nu}, (_, u) => [rowTop[u], rowBot[u]]);
  const id = b.nextId();
  b.write(id, `B_SPLINE_SURFACE_WITH_KNOTS('${label}',3,1,${ids2(ptWall)},.UNSPECIFIED.,.F.,.F.,.F.,${ints(ukw.mults)},(2,2),${nums(ukw.knots)},(0.,1.),.CONTINUOUS.)`);
  return id;
}
function oe(b, edgeId, forward) {
  const id = b.nextId();
  b.write(id, `ORIENTED_EDGE('',*,*,#${edgeId},${forward ? '.T.' : '.F.'})`);
  return id;
}
function face(b, surfId, sameSense, ...orientedEdgeIds) {
  const loopId = b.nextId(); b.write(loopId, `EDGE_LOOP('',(${orientedEdgeIds.map(id => `#${id}`).join(',')}))`);
  const boundId = b.nextId(); b.write(boundId, `FACE_OUTER_BOUND('',#${loopId},.T.)`);
  const faceId = b.nextId(); b.write(faceId, `ADVANCED_FACE('',(#${boundId}),#${surfId},${sameSense ? '.T.' : '.F.'})`);
  return faceId;
}

function assembleFile(b, name) {
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, '');
  const header = [
    'ISO-10303-21;', 'HEADER;',
    `FILE_DESCRIPTION(('${name} — generated by Step Generator'), '2;1');`,
    `FILE_NAME('${name}.step', '${timestamp}', (''), (''), 'Step Generator', 'Step Generator', '');`,
    `FILE_SCHEMA (('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 }'));`,
    'ENDSEC;', '', 'DATA;'
  ].join('\n');
  const footer = ['ENDSEC;', 'END-ISO-10303-21;'].join('\n');
  return [header, b.lines().join('\n'), footer].join('\n') + '\n';
}
