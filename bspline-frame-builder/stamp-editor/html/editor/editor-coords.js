/**
 * Element-coordinate helpers — the one place we bake an SVG.js element's
 * `transform` matrix into geometry. Every other module reads from here
 * instead of doing the math inline.
 *
 * Why this exists: SVG.js gives you THREE different coordinate flavors
 * for the same element and they mostly look interchangeable until they
 * silently aren't:
 *
 *   el.bbox()       local bbox, IGNORES transform attribute
 *   el.rbox()       bbox in document coords, includes transform AND
 *                   the SVG viewport→screen scaling
 *   el.x() / .y()   for <text>, returns the rendered bbox.x/y
 *                   (transform-included), NOT the raw `x` attribute
 *   el.matrix()     element's own transform attribute as a Matrix
 *   el.transform()  TransformBag description object (NOT a Matrix —
 *                   pass to Point.transform() at your peril)
 *   el.node.getCTM() cumulative matrix all the way to screen pixels
 *                   (NOT what you want in user-space code)
 *
 * Pre-extraction we tripped over this 4 times: node tool used getCTM
 * (got pixel coords ~600× off), expand-text used el.x() (double-counted
 * the drag), expand-shape used el.transform() (wrong shape), and the
 * selection highlight used bbox() without baking the matrix (stuck at
 * the pre-drag spot). All four were the same conceptual mistake. These
 * helpers make the right answer the easy answer.
 */

/**
 * Bake an explicit affine matrix into a single point — the manual
 * [a c e; b d f] multiply. Use this instead of `new SVG.Point(x,y)
 * .transform(m)`: SVG.js's Point.transform is historically unreliable for
 * baking (and SVG.Point is absent in some host builds), which silently
 * dropped the source scale in expand → micro-scale output (EX1). This has
 * no SVG.js dependency, so it can't be skipped or misbehave.
 *
 * `m` is any {a,b,c,d,e,f} (an SVG.Matrix or a plain object); `pt` is any
 * {x,y}. Returns a plain {x,y}.
 */
export function transformPoint(m, pt) {
    if (!m) return { x: pt.x, y: pt.y };
    return {
        x: m.a * pt.x + m.c * pt.y + m.e,
        y: m.b * pt.x + m.d * pt.y + m.f,
    };
}

/**
 * The single affine that maps editor SVG space (inches, Y-down, origin at
 * the board's top-left) to Fusion import space (pixels at `dpi`, Y-up,
 * origin at the board CENTER):
 *     cad_x = x*dpi - widthIn*dpi/2
 *     cad_y = heightIn*dpi/2 - y*dpi
 * ONE scale (×dpi), ONE flip (d = -dpi), ONE center — no per-axis fudge.
 *
 * Fusion's SVG importer reads raw pixel coords (1 unit = 1/dpi inch) and
 * ignores viewBox/scale/transforms, so this must be BAKED into the geometry
 * before import — see bakeSvgForCarving (editor-io.js). Returned as a plain
 * {a,b,c,d,e,f} so transformPoint / SVG.Matrix can consume it.
 */
export function carveMatrix(widthIn, heightIn, dpi = 96) {
    return { a: dpi, b: 0, c: 0, d: -dpi, e: -(widthIn * dpi) / 2, f: (heightIn * dpi) / 2 };
}

/**
 * Apply el.matrix() to a single local-space point. The "matrix" here is
 * just the element's own transform attribute — NOT the cumulative chain
 * to screen coords (use cases like hit-testing want user-space coords,
 * which is what the matrix attribute alone produces when the parent
 * group has no transform).
 */
export function worldPoint(el, pt) {
    if (!el || typeof el.matrix !== 'function') return { x: pt.x, y: pt.y };
    try {
        const m = el.matrix();
        if (!m) return { x: pt.x, y: pt.y };
        return transformPoint(m, pt);
    } catch {
        return { x: pt.x, y: pt.y };
    }
}

/**
 * AABB of `el.bbox()` after baking the element's transform into all four
 * corners. For pure translation this is exact; for rotation/scale it's
 * the axis-aligned bound of the rotated rect (the right answer for a
 * selection bounding box).
 *
 * Use whenever you draw a rectangle AROUND an element (highlight halos,
 * UI affordances) — anywhere the position needs to follow a drag.
 */
export function worldBbox(el) {
    const b = el.bbox();
    let m;
    try { m = (typeof el.matrix === 'function') ? el.matrix() : null; } catch { m = null; }
    if (!m) return { x: b.x, y: b.y, w: b.w, h: b.h, x2: b.x2, y2: b.y2 };

    const corners = [
        { x: b.x,  y: b.y  },
        { x: b.x2, y: b.y  },
        { x: b.x2, y: b.y2 },
        { x: b.x,  y: b.y2 },
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of corners) {
        const x = m.a * p.x + m.c * p.y + m.e;
        const y = m.b * p.x + m.d * p.y + m.f;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, x2: maxX, y2: maxY };
}

/**
 * For a <text>, return the LOCAL anchor as written in the x/y attributes
 * (NOT the rendered bbox position). Use when you need to translate a
 * generated path from font-local space to where the text element sits
 * in user space, then separately apply the element's transform on top.
 *
 * el.x() / el.y() would return the bbox.x / bbox.y which already includes
 * any transform — using those plus the matrix would double-count any
 * drag offset. (See the expand-text fix.)
 */
export function localAnchor(el) {
    return {
        x: parseFloat(el.attr('x')) || 0,
        y: parseFloat(el.attr('y')) || 0,
    };
}
