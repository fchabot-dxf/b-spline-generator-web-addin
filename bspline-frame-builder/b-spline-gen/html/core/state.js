import { COORD_SYSTEM } from './coords.js';
/**
 * state.js — Application state and persistence logic.
 */

export const DEFAULT = {
    stampSmoothingRadius: 15, // px
    stampFilletPower: 2.2, // Default "In-Between" setting
    stampEdgeFilletRadius: 0, // inches
    stampDepth: -1.0,
    stampProfile: 'vbit',
    stampVBitAngle: 90,
    stampBlur: 3,
    stampTextureSuppression: 0.15,
    widthIn: 7,
    heightIn: 9,
    carveZ: 1.5,
    seed: 42,
    scale: 3.7,
    macroScale: 0.65,
    warpIntensity: 1.0,
    symmetry: 'x',
    spacing: 0.05,
    smoothIntensity: 0,
    smoothRadius: 1.2,
    showMesh: false,
    noiseType: 'simplex',
    detailDensity: 1.0,
    detailStrength: 0.25,
    detailDensityRespectSymmetry: true,
    smoothRespectSymmetry: true,
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
    // Sculpt Bottom (post-thicken)
    sculptBotRadius: 1.0,
    sculptBotStrength: 0.008,
    sculptBotRespectSymmetry: true,
    sculptBotMode: 'draw',

    // Extra Thickness (Thin Parts)
    extraThickenThin: 0.4,
    extraThickenThinFalloff: 0.05,
    // Export Configuration
    exportOrientation: 'y-up',
    // Flat border
    edgeMarginIn: 0,
    // Vector Stamping (Multi-Layer Support)
    stampLayers: [
        { id: 'layer0', name: 'Layer 1', svg: null, mask: null, depth: -1.0, profile: 'vbit', angle: 90, blur: 3, enabled: true, smoothing: 15, suppression: 0.15, edgeFilletRadius: 0, filletPower: 2.2 },
        { id: 'layer1', name: 'Layer 2', svg: null, mask: null, depth: -0.5, profile: 'ballnose', angle: 90, blur: 1, enabled: false, smoothing: 10, suppression: 0.1, edgeFilletRadius: 0, filletPower: 2.2 },
        { id: 'layer2', name: 'Layer 3', svg: null, mask: null, depth: 0.75, profile: 'flat', angle: 90, blur: 0, enabled: false, smoothing: 5, suppression: 0.05, edgeFilletRadius: 0, filletPower: 2.2 }
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
    thickness: 'thicknessSlider',
    warpIntensity: 'warpIntensitySlider',
    sculptTopRadius: 'sculptTopRadiusSlider',
    sculptTopStrength: 'sculptTopStrengthSlider',
    sculptBotRadius: 'sculptBotRadiusSlider',
    sculptBotStrength: 'sculptBotStrengthSlider',
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

export function setPreDelta(val) { preDelta = val; }
export function setPostDelta(val) { postDelta = val; }
export function setLastResult(val) { lastResult = val; }
export function setIsFusionMode(val) { isFusionMode = val; }
export function setLastGridSize(nx, nz) { lastNx = nx; lastNz = nz; }

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
                if (window && window.console) {
                    console.log(`[COORD_STD] saveLastSession: UI (${pt[0]},${pt[1]}) -> Physical (${phys.x},${phys.y})`);
                }
                return [phys.x, phys.y];
            });
        }
        const session = {
            P: P_physical,
            preDelta: preDelta ? Array.from(preDelta) : null,
            postDelta: postDelta ? Array.from(postDelta) : null,
            extraThickenThinMask: extraThickenThinMask ? Array.from(extraThickenThinMask) : null,
        };
        // Log session JSON for audit
        console.log('[COORD_STD] saveLastSession: Saving session JSON:', JSON.stringify(session, null, 2));
        localStorage.setItem('splineGenLastSession', JSON.stringify(session));
        // Automatically send session JSON to Fusion log file if running inside Fusion
        if (window.adsk && typeof adsk.fusionSendData === 'function') {
            try {
                adsk.fusionSendData('log', JSON.stringify({ msg: JSON.stringify(session) }));
            } catch (err) {
                if (window.console) console.warn('Fusion log send failed:', err);
            }
        }
        if (window && window.console) {
            console.log('[COORD_STD] Saved session JSON:', session);
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
                        if (window && window.console) {
                            console.log(`[COORD_STD] loadLastSession: Physical (${pt[0]},${pt[1]}) -> UI (${ui.x},${ui.y})`);
                        }
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

    const stringParams = ['symmetry', 'thickenDir', 'thickenMode', 'spacing', 'exportOrientation', 'noiseType', 'stampProfile', 'sculptTopMode', 'sculptBotMode', 'activeSculptLayer'];
    const boolParams = [
        'showMesh', 'thickenEnabled', 'showLeaders', 'includeSurface',
        'sculptTopRespectSymmetry', 'sculptBotRespectSymmetry',
        'detailDensityRespectSymmetry', 'smoothRespectSymmetry',
        'includeUnstampedSolid', 'thickenWireframe', 'flatShading'
    ];

    if (key === 'widthIn' || key === 'heightIn') {
        value = Math.max(0.1, parseFloat(value));
    }
    
    // Safety Floor: Prevent critical parameters from becoming 0
    if (key === 'carveZ' || key === 'macroScale' || key === 'scale') {
        value = Math.max(0.001, parseFloat(value));
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
