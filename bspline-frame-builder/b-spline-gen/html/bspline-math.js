/**
 * bspline-math.js — Core cubic B-spline mathematics.
 * 
 * Provides functions for knot vector generation and surface evaluation 
 * using the de Boor algorithm. This module is shared between the 3D Preview 
 * and the STEP export engine to ensure geometric parity.
 */

/**
 * Expands a sparse {knots, mults} representation into a full knot sequence.
 */
export function expandKnots(kobj) {
    const full = [];
    for (let i = 0; i < kobj.knots.length; i++) {
        for (let j = 0; j < kobj.mults[i]; j++) full.push(kobj.knots[i]);
    }
    return full;
}

/**
 * Generates a clamped uniform knot vector for a B-spline of degree d with N control points.
 * @returns {object} { knots, mults, full }
 */
export function clampedKnots(N, d = 3) {
    if (N < d + 1) throw new Error(`Need at least ${d + 1} control points for degree ${d}`);
    const knots = [0, 1];
    const mults = [d + 1, d + 1];
    const numInternal = N - (d + 1);
    for (let i = 1; i <= numInternal; i++) {
        knots.splice(i, 0, i / (numInternal + 1));
        mults.splice(i, 0, 1);
    }
    const kobj = { knots, mults };
    return { ...kobj, full: expandKnots(kobj) };
}

/**
 * Find the knot span index for parameter t in the full knot sequence.
 * Returns i such that full[i] <= t < full[i+1].
 */
function findSpan(n, d, t, full) {
    if (t >= full[n + 1]) return n;
    let lo = d, hi = n + 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (full[mid] > t) hi = mid; else lo = mid;
    }
    return lo;
}

/**
 * Evaluates a 1D B-spline using the de Boor algorithm.
 * @param {number} k - Degree (usually 3).
 * @param {number[]} knots - Full knot sequence.
 * @param {object[]} coeff - Control points [{x, y, z}, ...].
 * @param {number} t - Parameter [0, 1].
 * @returns {{x, y, z}}
 */
export function deBoor(k, knots, coeff, t) {
    const n = coeff.length - 1;
    const s = findSpan(n, k, t, knots);
    
    const d = [];
    for (let i = 0; i <= k; i++) {
        const cp = coeff[s - k + i];
        d.push({ x: cp.x, y: cp.y, z: cp.z });
    }

    for (let r = 1; r <= k; r++) {
        for (let i = k; i >= r; i--) {
            const alpha = (t - knots[s - k + i]) / (knots[s + 1 + i - r] - knots[s - k + i]);
            d[i].x = (1.0 - alpha) * d[i - 1].x + alpha * d[i].x;
            d[i].y = (1.0 - alpha) * d[i - 1].y + alpha * d[i].y;
            d[i].z = (1.0 - alpha) * d[i - 1].z + alpha * d[i].z;
        }
    }
    return d[k];
}

/**
 * Evaluates a 2D B-spline surface point (tensor product).
 * @param {object[][]} ctrl - 2D array of control points [[{x,y,z},...],...].
 * @param {number} nx - u-count.
 * @param {number} nz - v-count.
 * @param {number[]} U - Full u-knot sequence.
 * @param {number[]} V - Full v-knot sequence.
 * @param {number} u - U parameter [0, 1].
 * @param {number} v - V parameter [0, 1].
 * @returns {{x, y, z}}
 */
export function evalBSplineSurface(ctrl, nx, nz, U, V, u, v) {
    const temp = [];
    for (let j = 0; j < nz; j++) {
        const row = [];
        for (let i = 0; i < nx; i++) row.push(ctrl[i][j]);
        temp.push(deBoor(3, U, row, u));
    }
    return deBoor(3, V, temp, v);
}
