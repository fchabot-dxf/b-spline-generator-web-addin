import { COORD_SYSTEM } from './coords.js';
import { isDirty, markDirty } from './dirty.js';
import { dbg } from './debug.js';
import { fusLog } from './fusion-log.js';
import { brickSetById } from './bricks/library.js';

// Audit C4: the brick defaults' ONE source is Set 1's own declaration (library.js) -- the state
// default used to repeat it with a different grout (0.06 vs the set's 0.034, its 17% joint rule), so
// re-picking Red Brick changed the joints. Copied, never referenced (the set is frozen data).
const DEFAULT_BRICK_SET = brickSetById(1);
/**
 * state.js — Application state and persistence logic.
 */

export const DEFAULT = {
    stampSmoothingRadius: 15, // px
    stampFilletPower: 2.2, // Default "In-Between" setting
    stampEdgeFilletRadius: 0, // inches
    stampDepth: 0.25,
    stampProfile: 'vbit',
    stampVBitAngle: 90,
    stampBlur: 0,
    stampTextureSuppression: 0.15,
    widthIn: 7,
    heightIn: 9,
    carveZ: 1.5,
    seed: 42,
    scale: 3.7,
    macroScale: 0.65,
    // Map Zoom (H17): a drawing-style zoom of the whole generated terrain,
    // centred on the board -- bigger value = bigger features. Implemented
    // once at terrain.js's (u,v) sampler entry so coarse shapes, fine
    // texture and detail/cluster masks all scale together; does not affect
    // stamps/sculpt/frame/edge fade/the board. 1 = today's terrain exactly.
    mapZoom: 1,
    warpIntensity: 1.0,
    symmetry: 'x',
    // Symmetry mirror-line offsets. 0 = mirror through panel center (legacy
    // behavior). Range -0.45..0.45 in normalized panel units (so ±45% of
    // the panel's width/height). Applied to both terrain folding and
    // sculpt mirroring so visual + interactive symmetry stay in sync.
    symOffsetX: 0,
    symOffsetY: 0,
    spacing: 0.05,
    // F35 item 17: opt-in adaptive DISPLAY mesh (core/preview/adaptive-mesh.js) -- `spacing` stays the
    // finest detail kept, flat areas collapse into big triangles. Preview only; Send/STEP never read it.
    adaptiveDisplay: false,
    // F35 item 16 follow-up (Fred): the single 'resolution' setting splits into Display (`spacing`,
    // above -- the live 3D preview / interactive rebuilds, unchanged) and Export (the B-spline mesh
    // actually built for Send/STEP). `sameAsDisplayResolution` defaults true so EVERY existing saved
    // session keeps today's exact behavior (Send uses whatever Display is) until Fred deliberately
    // unchecks it; `exportSpacing` only takes effect once he does. Both pick from the same
    // RESOLUTIONS list (core/state.js, below) as `spacing` always has.
    sameAsDisplayResolution: true,
    exportSpacing: 0.05,
    smoothIntensity: 0,
    smoothRadius: 1.2,
    showMesh: false,
    noiseType: 'simplex',
    // Per-filter UI tweaks: filterTweaks[filterId][paramKey] = value.
    // Session-only — defaults live in each filter's `tweaks` schema and
    // are NOT seeded here. Empty object means "use schema defaults".
    filterTweaks: {},
    // F34 item 1: the 'photo' filter's own source. photoImageDataUrl is the
    // RAW (unedited) decoded source image, embedded as a PNG data: URL,
    // downscaled at upload time (core/photo/codec.js's own PHOTO_MAX_DIM) so
    // saved projects stay small. photoEdits is the declared, ORDERED list
    // of {op, params} edit steps (crop/rotate90/flip/levels/
    // brightnessContrast/blur/invert, core/photo/ops.js) applied to it in
    // one pure function — "undo" is popping the last entry. Both are plain
    // JSON, so they round-trip through saveLastSession/loadLastSession like
    // any other P field; written DIRECTLY (not through updateP/applyParam),
    // same convention as P.stampLayers/P.decalLayerIds/P.editorSvg — none of
    // these is a single scalar a generic <input> binds to.
    photoImageDataUrl: null,
    photoEdits: [],
    // F34 item 3: which built-in pattern (data/photo-patterns.json id) the
    // current photo came from, if any -- null for a user's own upload. Drives
    // "Save settings to this pattern" (main/photo-panel.js); declared on P
    // (not a module-local var) so it survives a reload via the existing
    // generic session save/load, same as photoImageDataUrl/photoEdits above.
    photoPatternId: null,
    // F35 item 1: the Brick tab's own common settings (core/bricks/library.js's
    // BRICK_SETS is the declared source for defaults per set -- these are the
    // user's CURRENT overrides, shared by all three tools (Brush/Wall/Frame)).
    // grout/reliefIn start at Set 1's own declared values (library.js) so the
    // panel shows real numbers on first use, not a second, independent guess.
    brickSettings: {
      setId: 1,
      // F35 item 16 (Fred: "I'd rather they all have the same size" -- replacing the old 0.5-2x
      // Scale multiplier AND the separate frameBrickLengthIn override that used to live here):
      // ONE global brick LENGTH in real inches (0.375-8), shared by Wall, every Frame band, and
      // Brush -- starts at Set 1's own declared brickLengthIn (library.js), same "real number on
      // first use" convention grout/reliefIn below already follow. A set switch keeps it (F35 item 16:
      // a real-world size the user picked; main/brick-panel.js selectSet).
      // A legacy saved session's own `scale` migrates via brickLengthIn = its set's own declared
      // length x that scale, once, on load (main/brick-panel.js).
      brickLengthIn: 0.75,
      // width/depth from Set 1 (audit C4). profile stays 'flush' (Set 1 declares 'recessed', which now
      // really recesses the joints -- making it the default would change every new board's relief).
      grout: { widthIn: DEFAULT_BRICK_SET.grout.widthIn, depthIn: DEFAULT_BRICK_SET.grout.depthIn, profile: 'flush' },
      reliefIn: 0.125,
      invert: false,
      // F35 item 18 (1): 'organic' = each brick's top drapes over the terrain under it (the original
      // behaviour); 'flat' = each brick is a rigid block on the least-squares plane of the terrain
      // under its footprint (core/engine/apply-stamp-layers.js). Grout stays draped in both. A saved
      // session without the key reads as organic (only === 'flat' is Flat), so nothing moves on load.
      brickTopMode: 'organic',
      // F35 item 18 (2): the brick SURFACE STYLE, an editor/brick-surface-styles.js key ('clean' |
      // 'weathered'). Clean = the set's own declared look; a saved session without the key is Clean.
      surfaceStyle: 'clean',
      // F35 item 18: the Wear slider (0..1) of a style that declares `wear` (Weathered); 0.5 = the
      // declared default (edge wear 0.02 in, pit gain 2.5). Read by the height mask only.
      surfaceWear: 0.5,
      // F35 item 21: the fieldstone wall's share of LARGE stones, 0..1 (d3's engine option, T86 item 17).
      // A layout setting (it is in the laid key). A saved session without it reads 0.5.
      largeStones: 0.5,
      // F35 item 16 (turn 201): the RAISED BRUSH -- its strokes' Level (laid proud, default 1/16 in) and its
      // mode ('bricks' | 'grout', main/brick-panel.js RAISED_BRUSH_MODES). Brush-only: frozen per stroke.
      raisedLevelIn: 0.0625,
      raisedMode: 'bricks',
      // F35 item 16 (advisor turn 189): the Frame tool's OFFSET FROM FRAME, like the Shape Lattice's --
      // ON = the bands follow the frame's outer edge offset by `distance` (+ inward, - outward), default ON
      // at 0; OFF = free placement, the bands follow the board's own outline instead of the frame.
      frameOffset: { on: true, distance: 0 },
      // F35 item 16: LEVEL, a per-element height offset in inches (+ proud, - recessed; item 15's accent
      // level applied to a whole element), keyed by element kind (editor-brick-tool.js BRICK_KINDS). Read
      // by the height mask only (3D, never re-lays). A saved session without it is level 0.
      elementLevelIn: { wall: 0, frame: 0 },
      suppression: 0,
      clumping: 0.3,
      seed: 1,
      // F35 item 4: which core/bricks/library.js FRAME_PRESETS entry the
      // Frame tool bands with -- a key, not the bands array itself, so it
      // always tracks library.js's own current declaration.
      frameBandPreset: 'single_soldier',
      // F35 item 7: the Wall pattern picker's own choice -- any core/bricks/library.js
      // BRICK_PATTERNS key. A key, not the pattern definition itself, same "track the current
      // declaration" convention as frameBandPreset above.
      pattern: 'stretcher',
      // F35 item 8: the per-band pattern picker's own choice, one entry per band INDEX (0 =
      // outermost, matching frameBandPreset's own declared band order) -- a missing/falsy index
      // means "use that band's own declared pattern" (frameBandPreset's own default). Keyed by
      // index rather than by preset id so an override survives switching presets where the index
      // still exists (e.g. picking band 0's pattern on three_band, then switching to
      // soldier_stretcher, keeps band 0's own override). Only course/course-alternating kinds are
      // meaningful here (main/brick-panel.js's own FRAME_BAND_PATTERN_LIST greys out the rest).
      frameBandPatterns: [],
      // F35 item 10 follow-up (Fred): the Brush tool's own settings, shown only when Brush is the
      // active tool (main/brick-panel.js). `orientation` already had real engine support
      // (core/bricks/along-path.js's own opts.orientation); `profile` ('bricks' = Stripped,
      // 'continuous') already existed as a Stripe-cycle override (editor-brick-tool.js's own
      // toBrickOpts already reads `settings.profile`) but had no direct UI control before now.
      orientation: 'stretcher',
      profile: 'bricks',
      // T86 item 7: which core/bricks/library.js BRUSH_PRESETS entry a drawn Brush stroke bands
      // with -- a key, not the bands array itself, same "track the current declaration" convention
      // as frameBandPreset above. 'stretcher_1' (a single stretcher row straddling the stroke's own
      // centreline) is the closest match to the OLD orientation-only brush's own default look, so an
      // existing saved session's brush strokes don't visibly change on load.
      brushBandPreset: 'stretcher_1',
      // Audit C6: the Stripe tool's A/B/C brick-style picks (editor-brick-tool.js BRICK_STRIPE_STYLES ids);
      // the default A/B is the old fixed cycle, so existing striped strokes look the same.
      stripeStyles: ['red_bricks', 'white_continuous', 'red_continuous'],
    },
    detailDensity: 1.0,
    // detailStrength = floor for the "empty" zones carved out by detailDensity.
    // At detailDensity = 1 it has no visible effect (no empty zones exist).
    // When detailDensity < 1 it controls how much detail residue remains inside
    // the smooth patches: 0 = fully smooth, 1 = full detail (cancels the mask).
    // Default 0.25 = subtle residue in empty zones.
    detailStrength: 0.25,
    detailDensityRespectSymmetry: true,
    smoothRespectSymmetry: true,
    // Skeleton seed-character — shape the coarse Perlin field that drives the
    // skeleton. peakShape replaces the old hard-coded applyContrast(2.2):
    // <1 = round/blobby, =2.2 = legacy look, >2.2 = sharper peaks.
    // density (0..1) is a soft threshold gate on the coarse field; 1 = today's
    // behavior (no gating), 0 = empty plate. clustering (0..1) multiplies the
    // coarse field by a low-freq mask so peaks group into clumps; 0 = even
    // distribution, 1 = strongly clustered.
    peakShape: 2.2,
    density: 1.0,
    clustering: 0,
    // SEED panel — selects the underlying coarse-field generator.
    // Lives BEFORE the skeleton in the mental model: seed = raw pattern,
    // skeleton = transforms applied to it, filter = fine detail layered on top.
    // seedOffsetX/Y pan the WHOLE generated map -- coarse shapes AND fine
    // texture together, like sliding a picture under the board window (H17
    // item 2; applied at terrain.js's zu/zv sampler entry, same spot as
    // mapZoom, in "screens" = board-widths at the current zoomed size).
    // seedRotation rotates the sampling coordinates before the seed sees them.
    seedType: 'perlin',
    seedOffsetX: 0,
    seedOffsetY: 0,
    seedRotation: 0,
    // Skeleton isolation mode — when true, terrain.js bypasses the filter
    // (substitutes a flat 0.5) so the user sees only the skeleton's
    // contribution: coarse field, detail-density gate, edge fade, smoothing.
    isolateSkeleton: false,
    // Thicken
    thickenEnabled: true,
    thickness: 0.125,
    thickenDir: 'down',
    thickenMode: 'adaptive',
    showLeaders: true,
    includeSurface: true,
    bottomSmoothRadius: 0.3, // Hardcoded for machining consistency
    includeUnstampedSolid: false,
    thickenWireframe: false, // false → shaded solid, true → wireframe view
    flatShading: false,
    // H23 item 67: side walls (and the frame/window walls) take the artwork
    // colour wherever it reaches the board's outer edge; OFF reverts them
    // to the plain wood/heat-map look (the top surface is unaffected).
    colourEdges: true,
    // H23 item 71: "Fusion colour decal" (VIEW panel) -- on Send, an optional transparent PNG
    // of the artwork's colour layers (core/stamp/decal-png.js, item 68's own spike promoted to a
    // real module) sent alongside the payload; the add-in applies it as ONE real Fusion decal on
    // the Stamped top face, replacing any decal from a previous Send. Off by default (Fred).
    decalEnabled: false,
    // A <select> of declared choices (40/100/150), same "numeric-looking string" convention
    // `spacing` already uses -- kept a string so updateP's stringParams path (not parseFloat)
    // owns it; Number(P.decalResolution) wherever an actual numeric dpi is needed.
    decalResolution: '150',
    decalOpacity: 100, // 0..100 %
    // { [editorLayerId]: boolean } -- a layer is INCLUDED unless explicitly false (missing/true
    // both mean included, same "visible !== false" convention editor/layers.js already uses).
    // Keyed by layer id (stable across reorder/delete), not position -- see editor/layers.js.
    // Written directly (not through updateP/applyParam, like P.filterTweaks) by the per-layer
    // checkbox list; never has its own single DOM element, so the generic auto-binder skips it.
    decalLayerIds: {},
    // Sculpt state
    activeSculptLayer: null, // can be 'top', 'bot', or null
    sculptTopRadius: 2.0,
    sculptTopStrength: 0.03,  // default for draw sculpt brush
    sculptTopRespectSymmetry: true,
    sculptTopMode: 'draw',
    sculptTopNoiseScale: 10.0,
    // Sculpt Bottom (post-thicken)
    sculptBotRadius: 1.0,
    sculptBotStrength: 0.008,
    sculptBotRespectSymmetry: true,
    sculptBotMode: 'draw',
    sculptBotNoiseScale: 10.0,

    // Extra Thickness (Thin Parts)
    extraThickenThin: 0.4,
    extraThickenThinFalloff: 0.05,
    // Export Configuration
    exportOrientation: 'z-up',
    // Flat border
    edgeMarginIn: 0,
    // FB-APP S2 (F6): the persisted frame record (core/frame-record.js).
    // null = no frame (Fred, Q2); every read goes through normalizeFrameRecord.
    frame: null,
    // Vector Stamping (Multi-Layer Support)
    // SE4c: .svg/.mask retired from this shape — content lives only on
    // P.editorSvg / editor._layers[i]._mask now (SE4-MIRROR-RETIREMENT-
    // DESIGN.md). These are tooling only.
    stampLayers: [
        { id: 'layer0', name: 'Layer 1', depth: 0.25, profile: 'vbit', angle: 90, blur: 0, enabled: true, smoothing: 15, suppression: 0.15, edgeFilletRadius: 0, filletPower: 2.2,
          tx: 0, ty: 0, rotation: 0, scale: 1, mirrorX: false, mirrorY: false },
        { id: 'layer1', name: 'Layer 2', depth: -0.5, profile: 'ballnose', angle: 90, blur: 0, enabled: false, smoothing: 10, suppression: 0.1, edgeFilletRadius: 0, filletPower: 2.2,
          tx: 0, ty: 0, rotation: 0, scale: 1, mirrorX: false, mirrorY: false },
        { id: 'layer2', name: 'Layer 3', depth: 0.75, profile: 'flat', angle: 90, blur: 0, enabled: false, smoothing: 5, suppression: 0.05, edgeFilletRadius: 0, filletPower: 2.2,
          tx: 0, ty: 0, rotation: 0, scale: 1, mirrorX: false, mirrorY: false }
    ],
    activeLayerIdx: 0,
    thickenYellowOffset: 0.01,
    // Step 3 of the stamp-layer → editor-layer unification: the SVG
    // editor's full document. Each editor layer carries its own CNC
    // tooling (see TOOLING_DEFAULTS in editor/layers.js). Replaces the
    // old per-stamp-layer content field, retired in SE4c. Saved to
    // localStorage on every editor change so reload restores the
    // in-flight drawing.
    editorSvg: null,
};

export let P = { ...DEFAULT };

// For params whose <input> element id differs from the param name itself.
// (`thickness` lives in `thickenOffset` after the Apr 2026 UI rename.)
// Both bindControls and syncUItoParam consult this map before falling back
// to `getElementById(paramName)`.
export const INPUT_PAIRS = {
    thickness: 'thickenOffset',
    // F15: the "Strength / Hardness" inputs were renamed by the CAD restyle (5842d90) and left unbound since.
    sculptTopStrength: 'sculptTopHardness',
    sculptBotStrength: 'sculptBotHardness',
};

export const SLIDER_PAIRS = {
    scale: 'scaleSlider',
    // H16 item 5: back after H15 removed it with the whole Seed panel --
    // the control returns (now in Filter's "Map" group), the P key never left.
    macroScale: 'macroSlider',
    // H17 item 1: new -- Filter's "Map" group.
    mapZoom: 'mapZoomSlider',
    carveZ: 'carveZSlider',
    smoothIntensity: 'smoothIntensitySlider',
    smoothRadius: 'smoothRadiusSlider',
    detailDensity: 'detailDensitySlider',
    detailStrength: 'detailStrengthSlider',
    peakShape: 'peakShapeSlider',
    density: 'densitySlider',
    clustering: 'clusteringSlider',
    // H19 item 1: seedOffsetX/Y are plain steppers now (no slider to pair
    // with) -- picked up automatically by the generic Object.keys(P)
    // binder above, same as widthIn/heightIn.
    symOffsetX: 'symOffsetXSlider',
    symOffsetY: 'symOffsetYSlider',
    thickness: 'thickenOffsetSlider',
    warpIntensity: 'warpIntensitySlider',
    sculptTopRadius: 'sculptTopRadiusSlider',
    sculptTopStrength: 'sculptTopHardnessSlider',
    sculptBotRadius: 'sculptBotRadiusSlider',
    sculptBotStrength: 'sculptBotHardnessSlider',
    sculptTopNoiseScale: 'sculptTopNoiseScaleSlider',
    sculptBotNoiseScale: 'sculptBotNoiseScaleSlider',
    edgeMarginIn: 'edgeMarginInSlider',
    extraThickenThin: 'extraThickenThinSlider',
    extraThickenThinFalloff: 'extraThickenThinFalloffSlider',
    thickenYellowOffset: 'thickenYellowOffsetSlider',
    stampDepth: 'stampDepthSlider',
    stampBlur: 'stampBlurSlider',
    stampSmoothingRadius: 'stampSmoothingRadiusSlider',
    stampTextureSuppression: 'stampTextureSuppressionSlider',
    stampEdgeFilletRadius: 'stampEdgeFilletRadiusSlider',
    stampFilletPower: 'stampFilletPowerSlider',
};

// Masonry/Masonry max (F35 item 16 follow-up): from the measured resolution x brick-size grid
// (shots/seatC/resolution_scale_grid.png) -- 0.015in and 0.011in, fine enough to carve grout
// joints cleanly for bricks <= 1.5in (see main/brick-panel.js's updateSpacingHint), at a real,
// measured rebuild cost (3.8s / 8.2s on the app's own default 7x9 board) too slow for the live
// Display preview to default to, but fine for an Export-only build the user explicitly opts into.
export const RESOLUTIONS = [
    { name: 'Coarse', val: 1.0 },
    { name: 'Standard', val: 0.6 },
    { name: 'Fine', val: 0.4 },
    { name: 'Detail', val: 0.25 },
    { name: 'Ultra', val: 0.15 },
    { name: 'Super Ultra', val: 0.1 },
    { name: 'Mega Ultra', val: 0.05 },
    { name: 'Ultimate', val: 0.03 },
    { name: 'Extreme', val: 0.02 },
    { name: 'Masonry', val: 0.015 },
    { name: 'Masonry max', val: 0.011 },
];

/** The ONE place Display vs Export resolution is resolved -- `P.spacing`/`P.exportSpacing` are
 *  both stored as strings (updateP's own stringParams coercion), so this always returns a real
 *  Number, safe for both arithmetic and strict equality against RESOLUTIONS' own numeric `val`s. */
export function effectiveExportSpacing() {
    return Number(P.sameAsDisplayResolution ? P.spacing : P.exportSpacing);
}

export let preDelta = null;
export let postDelta = null;
export let lastResult = null;
export let isFusionMode = false;
export let lastNx = 0, lastNz = 0;
export let suppressionMask = null;
export let extraThickenThinMask = null;

/**
 * Pre-stroke cache used to fast-path rebuild() during sculpt drags.
 * null when no stroke is in progress.  When non-null:
 *   {
 *     layer: 'top' | 'bot',
 *     baseStamped: Float32Array,   // heights with all stamps applied but WITHOUT preDelta
 *     baseHeights: Float32Array,   // pure B-spline heights (no preDelta, no stamps)
 *     thickenData:  object | null, // frozen thicken result reused for the duration of the stroke
 *     nx, nz:       number,
 *   }
 */
export let strokeCache = null;

export function setPreDelta(val) { preDelta = val; }
export function setPostDelta(val) { postDelta = val; }
export function setLastResult(val) { lastResult = val; }
export function setIsFusionMode(val) { isFusionMode = val; }
export function setLastGridSize(nx, nz) { lastNx = nx; lastNz = nz; }
export function setStrokeCache(val) { strokeCache = val; }

export function setStampLayerEnabled(idx, enabled) {
    if (P.stampLayers[idx]) {
        P.stampLayers[idx].enabled = !!enabled;
    }
}

export function setSuppressionMask(val) { suppressionMask = val; }

export function setExtraThickenThinMask(val) { 
    extraThickenThinMask = val;
    window.extraThickenThinMask = val;
}

/** P as it must be persisted or snapshotted. SE4c: stampLayers no longer carries a mask
 *  (Float32Array content lives only on editor._layers[i]._mask now), so this is identity on
 *  layers — kept as the one declared serializer so saveLastSession, history.takeSnapshot and
 *  the Project Manager still all go through here, in case a future field needs stripping again. */
export function persistableP(p = P) {
    return { ...p, stampLayers: (p.stampLayers || []).map((L) => ({ ...L })) };
}

export function saveLastSession() {
    try {
        // Convert all geometry points in P to physical units if present
        const P_physical = { ...P };
        if (P_physical.points && Array.isArray(P_physical.points)) {
            P_physical.points = P_physical.points.map(pt => {
                const phys = COORD_SYSTEM.toPhysical(pt[0], pt[1]);
                return [phys.x, phys.y];
            });
        }
        // SE4c: stampLayers no longer carries a mask Float32Array to strip
        // (content lives on editor._layers[i]._mask, never serialized here).
        // persistableP() is kept as the one declared serializer regardless.
        const P_persistable = persistableP(P_physical);
        const session = {
            P: P_persistable,
            preDelta: preDelta ? Array.from(preDelta) : null,
            postDelta: postDelta ? Array.from(postDelta) : null,
            extraThickenThinMask: extraThickenThinMask ? Array.from(extraThickenThinMask) : null,
        };
        // Save audit #4: whether the session had unsaved changes survives a reload with it
        session.dirty = isDirty();
        try {
            localStorage.setItem('splineGenLastSession', JSON.stringify(session));
        } catch (quota) {
            // too big for the browser's storage: drop the OLD copy rather than restore a stale drawing on reload
            localStorage.removeItem('splineGenLastSession');
            throw quota;
        }
        // Automatically send session JSON to Fusion log file if running inside Fusion
        fusLog(JSON.stringify(session));
    } catch (e) {
        console.warn('saveLastSession failed:', e);
    }
}

export function loadLastSession() {
    try {
        const raw = localStorage.getItem('splineGenLastSession');
        if (!raw) return false;
        const sess = JSON.parse(raw);
        if (!sess || !sess.P) return false;

        Object.keys(sess.P).forEach(k => {
            if (k in P && k !== 'showMesh' && k !== 'activeSculptLayer') { // Fred: Sculpt never active on open
                let val = sess.P[k];
                // Convert points from physical to UI units if present
                if (k === 'points' && Array.isArray(val)) {
                    val = val.map(pt => {
                        const ui = COORD_SYSTEM.toUI(pt[0], pt[1]);
                        dbg('COORD_STD', `loadLastSession: Physical (${pt[0]},${pt[1]}) -> UI (${ui.x},${ui.y})`);
                        return [ui.x, ui.y];
                    });
                }
                if (typeof val === 'number' && isNaN(val)) return;
                if (val === null || val === undefined) return;
                P[k] = val;
            }
        });
        
        // Safeguard critical dimensions
        if (isNaN(P.widthIn) || P.widthIn <= 0) P.widthIn = DEFAULT.widthIn;
        if (isNaN(P.heightIn) || P.heightIn <= 0) P.heightIn = DEFAULT.heightIn;
        if (isNaN(P.spacing) || P.spacing <= 0) P.spacing = DEFAULT.spacing;
        if (isNaN(P.exportSpacing) || P.exportSpacing <= 0) P.exportSpacing = DEFAULT.exportSpacing;

        if (sess.preDelta) preDelta = new Float32Array(sess.preDelta);
        if (sess.postDelta) postDelta = new Float32Array(sess.postDelta);
        if (sess.extraThickenThinMask) {
            extraThickenThinMask = new Float32Array(sess.extraThickenThinMask);
            window.extraThickenThinMask = extraThickenThinMask;
        }
        if (sess.dirty) markDirty();
        return true;
    } catch (e) {
        console.warn('loadLastSession failed:', e);
        return false;
    }
}

export function updateP(key, value) {
    if (typeof value === 'number' && isNaN(value)) return;

    const stringParams = ['symmetry', 'thickenDir', 'thickenMode', 'spacing', 'exportSpacing', 'exportOrientation', 'noiseType', 'seedType', 'stampProfile', 'sculptTopMode', 'sculptBotMode', 'activeSculptLayer', 'decalResolution'];
    const boolParams = [
        'showMesh', 'thickenEnabled', 'showLeaders', 'includeSurface',
        'sculptTopRespectSymmetry', 'sculptBotRespectSymmetry',
        'detailDensityRespectSymmetry', 'smoothRespectSymmetry',
        'isolateSkeleton',
        'includeUnstampedSolid', 'thickenWireframe', 'flatShading', 'colourEdges', 'decalEnabled', 'adaptiveDisplay',
        'sameAsDisplayResolution',
    ];

    if (key === 'widthIn' || key === 'heightIn') {
        value = Math.max(0.1, parseFloat(value));
    }
    
    // Safety Floor: Prevent critical parameters from becoming 0
    if (key === 'carveZ' || key === 'macroScale' || key === 'scale' || key === 'mapZoom') {
        value = Math.max(0.001, parseFloat(value));
    }
    if (key === 'peakShape') {
        // applyContrast does pow(|x|, 1/strength); strength→0 = divide-by-zero.
        value = Math.max(0.1, parseFloat(value));
    }
    if (key === 'stampVBitAngle') {
        // vSlope = 1/tan(angle/2). Angle→0 → Infinity, angle→180 → 0.
        // Clamp to a sane working range so the rasterizer can't divide by
        // zero or produce a zero-slope (invisible) profile.
        value = Math.max(10, Math.min(170, parseFloat(value) || 90));
    }

    if (stringParams.includes(key)) {
        P[key] = String(value);
    } else if (boolParams.includes(key)) {
        P[key] = !!value;
    } else {
        P[key] = parseFloat(value);
    }

    // v38: Sync global 'active' param back into its layer-specific config
    const layerSpecific = {
        'stampDepth': 'depth',
        'stampProfile': 'profile',
        'stampVBitAngle': 'angle',
        'stampBlur': 'blur',
        'stampSmoothingRadius': 'smoothing',
        'stampTextureSuppression': 'suppression',
        'stampEdgeFilletRadius': 'edgeFilletRadius',
        'stampFilletPower': 'filletPower'
    };
    // SE5a: editor._layers is the single tooling store now — write it
    // unconditionally, no P.stampLayers gate. Matches bindLayerOnlyNumber's
    // already-correct pattern (main/stamp/_dom-binders.js), which never had
    // this gate and already writes past layer 3. Position-based mapping
    // until each stamp pass formally points at an editor layer id.
    if (layerSpecific[key]) {
        try {
            const editorLayer = (typeof window !== 'undefined' && window.svgEditor && Array.isArray(window.svgEditor._layers))
                ? window.svgEditor._layers[P.activeLayerIdx] : null;
            if (editorLayer) editorLayer[layerSpecific[key]] = P[key];
        } catch (_) { /* defensive: state.js must not crash on editor access */ }
    }

    saveLastSession();
}
