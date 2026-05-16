/**
 * svg-extrude.js — SVG motif → Three.js live 3D preview + browser-side STEP export.
 *
 * Pipeline:
 *   MotifEditor.save() SVG string
 *     → svgToProfiles()        — parse shapes to closed 2D polygons (mm)
 *     → showExtrudePreview()   — ExtrudeGeometry in the Three.js viewport
 *     → profilesToStep()       — downloadable FACETED_BREP STEP file
 *   (Fusion solid route sends SVG + depth to Python via sendToPython('svg_extrude'))
 *
 * Design choices:
 *   - occt-import-js v0.0.22 is import-only (no write API), so STEP generation
 *     is done here in JS for the download path, and via Fusion's ExtrudeFeature
 *     API for the in-Fusion path.
 *   - THREE.ExtrudeGeometry (core r128) is used; no SVGLoader needed because
 *     MotifEditor only produces polyline/line/rect/ellipse — no bezier paths.
 *   - Y-axis is flipped when converting SVG (top-left origin, Y↓) → Three.js
 *     (Y↑), and the extrusion goes in the THREE.js +Z direction by default,
 *     then the preview mesh is rotated to match the selected surface normal.
 *
 * Exports (window.*):
 *   svgToProfiles(svgString, mmW, mmH)         → [[{x,y}]]
 *   showExtrudePreview(opts)                   → void (updates scene)
 *   clearExtrudePreview()                      → void
 *   profilesToStep(profiles, depth)            → string (STEP)
 */

'use strict';

// ── Module-level preview state ────────────────────────────────────────────────
let _previewGroup = null;   // THREE.Group added to scene; null when cleared

// ── SVG parsing ───────────────────────────────────────────────────────────────

/**
 * Parse SVG shapes from a MotifEditor SVG string into closed 2D polygons.
 *
 * Shapes handled: <polyline>, <line>, <rect>, <ellipse>.
 * All outputs are in mm, scaled from the SVG's intrinsic viewBox to mmW × mmH.
 * Y is NOT flipped here — callers that need Three.js Y-up should negate Y.
 *
 * @param {string} svgString
 * @param {number} mmW   — physical width in mm (fillW or spacingX from the panel)
 * @param {number} mmH   — physical height in mm
 * @returns {Array<Array<{x:number,y:number}>>}  array of closed polygons (≥3 pts each)
 */
function svgToProfiles(svgString, mmW, mmH) {
  const parser  = new DOMParser();
  const doc     = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl   = doc.documentElement;
  const profiles = [];

  // Determine SVG intrinsic size from viewBox or width/height attributes.
  let svgW = 400, svgH = 400;
  const vb = svgEl.getAttribute('viewBox');
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    if (p.length >= 4 && p[2] > 0 && p[3] > 0) { svgW = p[2]; svgH = p[3]; }
  } else {
    const w = parseFloat(svgEl.getAttribute('width')  || '0');
    const h = parseFloat(svgEl.getAttribute('height') || '0');
    if (w > 0) svgW = w;
    if (h > 0) svgH = h;
  }

  const sx = mmW / svgW;
  const sy = mmH / svgH;

  // Collect all shape children (including inside <g> elements).
  const shapes = svgEl.querySelectorAll('polyline, line, rect, ellipse');

  for (const el of shapes) {
    let pts = null;

    // ── polyline ──────────────────────────────────────────────────────────────
    if (el.tagName === 'polyline') {
      const raw = el.getAttribute('points') || '';
      pts = parsePointList(raw).map(p => ({ x: p.x * sx, y: p.y * sy }));
    }

    // ── line (treated as degenerate rect with stroke width) ──────────────────
    else if (el.tagName === 'line') {
      const x1 = parseFloat(el.getAttribute('x1') || '0') * sx;
      const y1 = parseFloat(el.getAttribute('y1') || '0') * sy;
      const x2 = parseFloat(el.getAttribute('x2') || '0') * sx;
      const y2 = parseFloat(el.getAttribute('y2') || '0') * sy;
      const sw = Math.max(0.5, parseFloat(el.getAttribute('stroke-width') || '2')) * Math.min(sx, sy);
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.01) continue;
      const nx = -dy / len * sw * 0.5;
      const ny =  dx / len * sw * 0.5;
      pts = [
        { x: x1 + nx, y: y1 + ny },
        { x: x2 + nx, y: y2 + ny },
        { x: x2 - nx, y: y2 - ny },
        { x: x1 - nx, y: y1 - ny },
      ];
    }

    // ── rect ──────────────────────────────────────────────────────────────────
    else if (el.tagName === 'rect') {
      const x = parseFloat(el.getAttribute('x') || '0') * sx;
      const y = parseFloat(el.getAttribute('y') || '0') * sy;
      const w = parseFloat(el.getAttribute('width')  || '0') * sx;
      const h = parseFloat(el.getAttribute('height') || '0') * sy;
      if (w < 0.01 || h < 0.01) continue;
      // NOTE: object-literal shorthand `{ x + w, y }` is a SYNTAX ERROR —
      // shorthand keys must be bare identifiers, not expressions. Use
      // explicit `key: expression` form for the corners that use arithmetic.
      pts = [
        { x: x,       y: y       },
        { x: x + w,   y: y       },
        { x: x + w,   y: y + h   },
        { x: x,       y: y + h   },
      ];
    }

    // ── ellipse ───────────────────────────────────────────────────────────────
    else if (el.tagName === 'ellipse') {
      const cx = parseFloat(el.getAttribute('cx') || '0') * sx;
      const cy = parseFloat(el.getAttribute('cy') || '0') * sy;
      const rx = parseFloat(el.getAttribute('rx') || '0') * sx;
      const ry = parseFloat(el.getAttribute('ry') || '0') * sy;
      if (rx < 0.01 || ry < 0.01) continue;
      const N = Math.max(16, Math.round(Math.PI * (rx + ry) * 2));   // circumference-proportional steps
      pts = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
      }
    }

    if (!pts || pts.length < 3) continue;

    // Ensure CCW winding (positive signed area in SVG space).
    // Three.js shapes extruded in +Z need CCW polygons when viewed from -Z,
    // but we also flip Y later, which reverses winding — so ensure CCW here
    // and flip Y per caller.
    ensureCCW(pts);
    profiles.push(pts);
  }

  return profiles;
}

/** Parse an SVG points string "x1,y1 x2,y2 …" → [{x,y}]. */
function parsePointList(raw) {
  const nums = raw.trim().split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n));
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] });
  return out;
}

/** Compute signed area (positive = CCW in standard math coords, i.e. Y-up).
 *  In SVG coords (Y-down), positive signed area = CW visually.
 *  We normalise to "positive = the winding used by THREE.Shape", which is CCW
 *  in THREE.js (Y-up) = CW in SVG (Y-down). */
function signedArea(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a * 0.5;
}

/** Reverse pts in-place if needed so signed area is negative (CW in SVG = CCW in Three.js after Y-flip). */
function ensureCCW(pts) {
  // After we flip Y (y_three = -y_svg), a CW polygon in SVG becomes CCW in Three.js.
  // THREE.Shape needs CCW winding for the outer contour.
  // So we want CW in SVG coords, i.e. negative signed area.
  if (signedArea(pts) > 0) pts.reverse();
}

// ── Three.js preview ──────────────────────────────────────────────────────────

/**
 * Show an extruded 3D preview of the motif SVG in the Three.js viewport.
 * Safe to call repeatedly — clears the old preview first.
 *
 * @param {object} opts
 *   @param {string}  opts.svgString     — MotifEditor SVG output
 *   @param {number}  opts.depth         — extrusion depth in mm
 *   @param {number}  opts.mmW           — motif physical width in mm
 *   @param {number}  opts.mmH           — motif physical height in mm
 *   @param {object}  [opts.hitPoint]    — {x,y,z} world-space surface hit (mm)
 *   @param {object}  [opts.hitNormal]   — {x,y,z} world-space surface normal
 *   @param {object}  opts.scene         — THREE.Scene
 */
function showExtrudePreview(opts) {
  const { svgString, depth, mmW, mmH, hitPoint, hitNormal, scene } = opts;
  const T = window.THREE;
  if (!T || !scene) { console.warn('[svg-extrude] THREE or scene not available'); return; }

  clearExtrudePreview(scene);

  const profiles = svgToProfiles(svgString, mmW, mmH);
  if (!profiles.length) { console.warn('[svg-extrude] no profiles parsed from SVG'); return; }

  const group = new T.Group();

  for (const poly of profiles) {
    const shape = new T.Shape();
    // Flip Y: SVG Y-down → Three.js Y-up; centre around origin.
    const cx = mmW / 2, cy = mmH / 2;
    shape.moveTo( poly[0].x - cx, -(poly[0].y - cy) );
    for (let i = 1; i < poly.length; i++) {
      shape.lineTo( poly[i].x - cx, -(poly[i].y - cy) );
    }
    shape.closePath();

    const geom = new T.ExtrudeGeometry(shape, {
      depth:         Math.max(0.01, depth),
      bevelEnabled:  false,
    });

    const mat = new T.MeshPhongMaterial({
      color:       0xf59e0b,
      opacity:     0.85,
      transparent: true,
      side:        T.DoubleSide,
      shininess:   40,
    });

    const mesh = new T.Mesh(geom, mat);
    // Shift so extrusion is centred on Z = ±depth/2 from the surface.
    mesh.position.z = -depth / 2;
    group.add(mesh);
  }

  // ── Orient preview to match selected surface ──────────────────────────────
  if (hitNormal) {
    const surfNorm = new T.Vector3(hitNormal.x, hitNormal.y, hitNormal.z).normalize();
    const extDir   = new T.Vector3(0, 0, 1);   // ExtrudeGeometry goes in +Z
    if (surfNorm.lengthSq() > 0.001 && Math.abs(surfNorm.dot(extDir)) < 0.9999) {
      const q = new T.Quaternion().setFromUnitVectors(extDir, surfNorm);
      group.quaternion.copy(q);
    } else if (surfNorm.dot(extDir) < 0) {
      // Anti-parallel: flip 180° around X.
      group.quaternion.setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI);
    }
  }

  // ── Position at hit point ─────────────────────────────────────────────────
  if (hitPoint) {
    group.position.set(hitPoint.x, hitPoint.y, hitPoint.z);
  }

  scene.add(group);
  _previewGroup = group;
}

/** Remove the extrude preview group from the scene and free GPU memory. */
function clearExtrudePreview(scene) {
  if (!_previewGroup || !scene) return;
  scene.remove(_previewGroup);
  _previewGroup.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
  });
  _previewGroup = null;
}

// ── STEP FACETED_BREP generator ───────────────────────────────────────────────

/**
 * Generate a downloadable STEP file from 2D profiles + extrude depth.
 *
 * Uses FACETED_BREP topology: one POLY_LOOP per face (no EDGE_CURVE needed).
 * Each face gets an explicit PLANE entity so the file is valid AP214.
 *
 * Works best for convex polygons. For concave shapes, the side-face normals
 * will still be correct but the shell may need fixing in CAD before machining.
 *
 * @param {Array<Array<{x:number,y:number}>>} profiles  — from svgToProfiles()
 * @param {number} depth                                — extrusion depth in mm
 * @returns {string} STEP file content
 */
function profilesToStep(profiles, depth) {
  if (!profiles.length) return '';

  const lines = [];
  let id = 0;
  const e = () => ++id;   // allocate next entity id

  // We'll collect the DATA section as we go.
  const data = [];

  function ent(idN, text) { data.push(`#${idN}=${text};`); }

  // ── Header constants ──────────────────────────────────────────────────────
  const appCtx     = e();
  const appProt    = e();
  const prodCtx    = e();
  const prodDefCtx = e();
  const prod        = e();
  const prodFormSrc = e();
  const prodDef     = e();
  const prodDefShp  = e();

  // Geometric context entities.
  const unc    = e();
  const lenUnit = e();
  const angUnit = e();
  const siUnit  = e();
  const repCtx  = e();

  // ── Closed shells ─────────────────────────────────────────────────────────
  // One MANIFOLD_SOLID_BREP per profile.
  const solidIds = [];

  for (const poly of profiles) {
    const N = poly.length;

    // Bottom vertices (z=0), top vertices (z=depth).
    const Bids = [];
    const Tids = [];
    for (let i = 0; i < N; i++) {
      const bi = e();
      ent(bi, `CARTESIAN_POINT('',(${fmt(poly[i].x)},${fmt(poly[i].y)},0.))`);
      Bids.push(bi);
      const ti = e();
      ent(ti, `CARTESIAN_POINT('',(${fmt(poly[i].x)},${fmt(poly[i].y)},${fmt(depth)}))`);
      Tids.push(ti);
    }

    // Build POLY_LOOP faces.
    const faceIds = [];

    // ── Bottom face (reversed winding for outward -Z normal) ──────────────
    faceIds.push(buildFace(e, ent, [...Bids].reverse(),
      { x: 0, y: 0, z: -1 },
      { x: poly[0].x, y: poly[0].y, z: 0 }
    ));

    // ── Top face ──────────────────────────────────────────────────────────
    faceIds.push(buildFace(e, ent, Tids,
      { x: 0, y: 0, z: 1 },
      { x: poly[0].x, y: poly[0].y, z: depth }
    ));

    // ── Side faces ────────────────────────────────────────────────────────
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      // Outward normal = perpendicular to edge, pointing away from polygon.
      const dx = poly[j].x - poly[i].x;
      const dy = poly[j].y - poly[i].y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      // For CCW polygon (after ensureCCW), right-hand normal points outward.
      const nx =  dy / len;
      const ny = -dx / len;

      // Mid-point of the bottom edge as the plane location.
      const mx = (poly[i].x + poly[j].x) * 0.5;
      const my = (poly[i].y + poly[j].y) * 0.5;

      // Quad: B[i], B[j], T[j], T[i] — CCW when viewed from outside.
      faceIds.push(buildFace(e, ent,
        [Bids[i], Bids[j], Tids[j], Tids[i]],
        { x: nx, y: ny, z: 0 },
        { x: mx, y: my,  z: depth * 0.5 }
      ));
    }

    // CLOSED_SHELL → MANIFOLD_SOLID_BREP.
    const shellId = e();
    ent(shellId, `CLOSED_SHELL('',(${faceIds.join(',')}))`);
    const solidId = e();
    ent(solidId, `MANIFOLD_SOLID_BREP('extrusion',#${shellId})`);
    solidIds.push(solidId);
  }

  // ── Geometric representation context ─────────────────────────────────────
  ent(unc,     `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-7),#${lenUnit},'','')` );
  ent(lenUnit, `(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))`);
  ent(angUnit, `(ANGULAR_UNIT() NAMED_UNIT(*) SI_UNIT($,.RADIAN.))`);
  ent(siUnit,  `(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())`);
  ent(repCtx,  `( GEOMETRIC_REPRESENTATION_CONTEXT(3) ` +
               `GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc})) ` +
               `GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lenUnit},#${angUnit},#${siUnit})) ` +
               `REPRESENTATION_CONTEXT('','') )`);

  // ── Shape representation ──────────────────────────────────────────────────
  const shapeRep = e();
  ent(shapeRep, `ADVANCED_BREP_SHAPE_REPRESENTATION('',(${solidIds.map(i => `#${i}`).join(',')}),#${repCtx})`);

  // ── Product infrastructure ────────────────────────────────────────────────
  ent(appCtx,     `APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
  ent(appProt,    `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appCtx})`);
  ent(prodCtx,    `PRODUCT_CONTEXT('',#${appCtx},'mechanical')`);
  ent(prodDefCtx, `PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtx},'design')`);
  ent(prod,       `PRODUCT('SVG Extrude','SVG Extrude','',(#${prodCtx}))`);
  ent(prodFormSrc,`PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#${prod},.NOT_KNOWN.)`);
  ent(prodDef,    `PRODUCT_DEFINITION('','',#${prodFormSrc},#${prodDefCtx})`);
  ent(prodDefShp, `PRODUCT_DEFINITION_SHAPE('','',#${prodDef})`);

  const sdr = e();
  ent(sdr, `SHAPE_DEFINITION_REPRESENTATION(#${prodDefShp},#${shapeRep})`);

  const now = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('SVG Extrude — step-editor'),'2;1');`,
    `FILE_NAME('extruded.stp','${now}',(''),(''),'step-editor','','');`,
    `FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));`,
    'ENDSEC;',
    'DATA;',
    ...data,
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n');
}

/**
 * Build a single FACE_SURFACE with POLY_LOOP for a list of vertex IDs.
 *
 * @param {function} e        — ID allocator (increments and returns next id)
 * @param {function} ent      — entity emitter (id, text) → pushes to data[]
 * @param {number[]} vertIds  — CARTESIAN_POINT entity ids, CCW from outside
 * @param {{x,y,z}} normal    — outward face normal (unit vector)
 * @param {{x,y,z}} loc       — a point on the plane (for AXIS2_PLACEMENT_3D)
 * @returns {string}  "#faceId"
 */
function buildFace(e, ent, vertIds, normal, loc) {
  // CARTESIAN_POINT for plane origin.
  const locId = e();
  ent(locId, `CARTESIAN_POINT('',(${fmt(loc.x)},${fmt(loc.y)},${fmt(loc.z)}))`);

  // Axis direction (= face normal, outward).
  const axId = e();
  ent(axId, `DIRECTION('',(${fmt(normal.x)},${fmt(normal.y)},${fmt(normal.z)}))`);

  // Reference direction (any vector not collinear with normal).
  const ref = perpDir(normal);
  const refId = e();
  ent(refId, `DIRECTION('',(${fmt(ref.x)},${fmt(ref.y)},${fmt(ref.z)}))`);

  const a2pId = e();
  ent(a2pId, `AXIS2_PLACEMENT_3D('',#${locId},#${axId},#${refId})`);

  const planeId = e();
  ent(planeId, `PLANE('',#${a2pId})`);

  const loopId = e();
  ent(loopId, `POLY_LOOP('',(${vertIds.map(i => `#${i}`).join(',')}))`);

  const boundId = e();
  ent(boundId, `FACE_OUTER_BOUND('',#${loopId},.T.)`);

  const faceId = e();
  ent(faceId, `FACE_SURFACE('',(#${boundId}),#${planeId},.T.)`);

  return `#${faceId}`;
}

/** Return a unit vector perpendicular to `n`. */
function perpDir(n) {
  // Find the component with the smallest absolute value and use that axis.
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ax <= ay && ax <= az) {
    // Cross with (1,0,0).
    return norm3({ x: 0, y: -n.z, z: n.y });
  } else if (ay <= ax && ay <= az) {
    return norm3({ x: -n.z, y: 0, z: n.x });
  } else {
    return norm3({ x: -n.y, y: n.x, z: 0 });
  }
}

function norm3(v) {
  const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/** Format a number for STEP: at least one decimal, no scientific notation for normal ranges. */
function fmt(n) {
  if (!Number.isFinite(n)) return '0.';
  const s = n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '.0');
  return s || '0.';
}

// ── Exports ───────────────────────────────────────────────────────────────────
window.svgToProfiles      = svgToProfiles;
window.showExtrudePreview = showExtrudePreview;
window.clearExtrudePreview = clearExtrudePreview;
window.profilesToStep     = profilesToStep;
