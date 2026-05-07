import { COORD_SYSTEM } from './coords.js';
import { dbg } from './debug.js';
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
    warpIntensity: 1.0,
    symmetry: 'x',
    // Symmetry mirror-line offsets. 0 = mirror through panel center (legacy
    // behavior). Range -0.45..0.45 in normalized panel units (so ±45% of
    // the panel's width/height). Applied to both terrain folding and
    // sculpt mirroring so visual + interactive symmetry stay in sync.
    symOffsetX: 0,
    symOffsetY: 0,
    spacing: 0.05,
    smoothIntensity: 0,
    smoothRadius: 1.2,
    showMesh: false,
    noiseType: 'simplex',
    // Per-filter UI tweaks: filterTweaks[filterId][paramKey] = value.
    // Session-only — defaults live in each filter's `tweaks` schema and
    // are NOT seeded here. Empty object means "use schema defaults".
    filterTweaks: {},
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
    // seedOffsetX/Y let the user pan through the noise field continuously
    // (Perlin seed integers are a hash, so adjacent integers are uncorrelated;
    // offset gives smooth "browsing" within one chosen seed).
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
    // Vector Stamping (Multi-Layer Support)
    stampLayers: [
        { id: 'layer0', name: 'Layer 1', svg: null, mask: null, depth: 0.25, profile: 'vbit', angle: 90, blur: 0, enabled: true, smoothing: 15, suppression: 0.15, edgeFilletRadius: 0, filletPower: 2.2,
          tx: 0, ty: 0, rotation: 0, scale: 1, mirrorX: false, mirrorY: false },
        { id: 'layer1', name: 'Layer 2', svg: null, mask: null, depth: -0.5, profile: 'ballnose', angle: 90, blur: 0, enabled: false, smoothing: 10, suppression: 0.1, edgeFilletRadius: 0, filletPower: 2.2,
          tx: 0, ty: 0, rotation: 0, scale: 1, mirrorX: false, mirrorY: false },
        { id: 'layer2', name: 'Layer 3', svg: null, mask: null, depth: 0.75, profile: 'flat', angle: 90, blur: 0, enabled: false, smoothing: 5, suppression: 0.05, edgeFilletRadius: 0, filletPower: 2.2,
          tx: 0, ty: 0, rotation: 0, scale: 1, mirrorX: false, mirrorY: false }
    ],
    activeLayerIdx: 0,
    thickenYellowOffset: 0.01,
};

export let P = { ...DEFAULT };

export const SLIDER_PAIRS = {
    scale: 'scaleSlider',
    macroScale: 'macroSlider',
    carveZ: 'carveZSlider',
    smoothIntensity: 'smoothIntensitySlider',
    smoothRadius: 'smoothRadiusSlider',
    detailDensity: 'detailDensitySlider',
    detailStrength: 'detailStrengthSlider',
    peakShape: 'peakShapeSlider',
    density: 'densitySlider',
    clustering: 'clusteringSlider',
    seedOffsetX: 'seedOffsetXSlider',
    seedOffsetY: 'seedOffsetYSlider',
    seedRotation: 'seedRotationSlider',
    symOffsetX: 'symOffsetXSlider',
    symOffsetY: 'symOffsetYSlider',
    thickness: 'thicknessSlider',
    warpIntensity: 'warpIntensitySlider',
    sculptTopRadius: 'sculptTopRadiusSlider',
    sculptTopStrength: 'sculptTopStrengthSlider',
    sculptBotRadius: 'sculptBotRadiusSlider',
    sculptBotStrength: 'sculptBotStrengthSlider',
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
];

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

export function setStampLayerSvg(idx, svg) { 
    if (P.stampLayers[idx]) {
        P.stampLayers[idx].svg = svg;
        // Automatically enable the layer when an SVG is assigned (not null)
        if (svg) {
            P.stampLayers[idx].enabled = true;
        }
    }
}
export function setStampLayerMask(idx, mask) {
    if (P.stampLayers[idx]) {
        P.stampLayers[idx].mask = mask;
        // suppression is a UI scalar (0–1) stored on the layer — never overwrite it here
    }
}
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
        // Strip mask Float32Arrays from each stamp layer before serializing.
        // JSON.stringify turns a Float32Array into {"0":v,"1":v,...} (an
        // object, not an array), bloating localStorage by ~10× and producing
        // an unusable shape on reload. Masks are cheap to regenerate from
        // the stored SVG, so we drop them here.
        if (Array.isArray(P_physical.stampLayers)) {
            P_physical.stampLayers = P_physical.stampLayers.map(layer => ({ ...layer, mask: null }));
        }
        const session = {
            P: P_physical,
            preDelta: preDelta ? Array.from(preDelta) : null,
            postDelta: postDelta ? Array.from(postDelta) : null,
            extraThickenThinMask: extraThickenThinMask ? Array.from(extraThickenThinMask) : null,
        };
        localStorage.setItem('splineGenLastSession', JSON.stringify(session));
        // Automatically send session JSON to Fusion log file if running inside Fusion
        if (window.adsk && typeof adsk.fusionSendData === 'function') {
            try {
                adsk.fusionSendData('log', JSON.stringify({ msg: JSON.stringify(session) }));
            } catch (err) {
                if (window.console) console.warn('Fusion log send failed:', err);
            }
        }
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
            if (k in P && k !== 'showMesh') {
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

        if (sess.preDelta) preDelta = new Float32Array(sess.preDelta);
        if (sess.postDelta) postDelta = new Float32Array(sess.postDelta);
        if (sess.extraThickenThinMask) {
            extraThickenThinMask = new Float32Array(sess.extraThickenThinMask);
            window.extraThickenThinMask = extraThickenThinMask;
        }
        return true;
    } catch (e) {
        console.warn('loadLastSession failed:', e);
        return false;
    }
}

export function updateP(key, value) {
    if (typeof value === 'number' && isNaN(value)) return;

    const stringParams = ['symmetry', 'thickenDir', 'thickenMode', 'spacing', 'exportOrientation', 'noiseType', 'seedType', 'stampProfile', 'sculptTopMode', 'sculptBotMode', 'activeSculptLayer'];
    const boolParams = [
        'showMesh', 'thickenEnabled', 'showLeaders', 'includeSurface',
        'sculptTopRespectSymmetry', 'sculptBotRespectSymmetry',
        'detailDensityRespectSymmetry', 'smoothRespectSymmetry',
        'isolateSkeleton',
        'includeUnstampedSolid', 'thickenWireframe', 'flatShading'
    ];

    if (key === 'widthIn' || key === 'heightIn') {
        value = Math.max(0.1, parseFloat(value));
    }
    
    // Safety Floor: Prevent critical parameters from becoming 0
    if (key === 'carveZ' || key === 'macroScale' || key === 'scale') {
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
    if (layerSpecific[key] && P.stampLayers && P.stampLayers[P.activeLayerIdx]) {
        P.stampLayers[P.activeLayerIdx][layerSpecific[key]] = P[key];
    }

    saveLastSession();
}
