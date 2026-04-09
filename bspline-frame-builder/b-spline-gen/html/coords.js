// Centralized coordinate and unit conversion utility for the SVG editor and Fusion export
// This is the single source of truth for all coordinate transforms and unit conversions

export const COORD_SYSTEM = {
    canvasHeight: 600, // Match your UI/editor SVG height
    units: 'mm',
    pixelsPerUnit: 10, // 10 pixels = 1 mm

    // Convert a 2D grid row into a raster Y coordinate, preserving the same
    // front/back orientation used by the editor and mask generation.
    gridRowToRasterY: (row, rows, rasterHeight) => {
        const maxRow = Math.max(1, rows - 1);
        const clamped = Math.max(0, Math.min(rows - 1, row));
        return ((rows - 1 - clamped) / maxRow) * (rasterHeight - 1);
    },

    // Convert a raster Y coordinate back to a 2D grid row index.
    rasterYToGridRow: (y, rows, rasterHeight) => {
        const clampedY = Math.max(0, Math.min(rasterHeight - 1, y));
        const ratio = 1 - (clampedY / Math.max(1, rasterHeight - 1));
        const row = ratio * Math.max(1, rows - 1);
        return Math.min(rows - 1, Math.max(0, Math.floor(row + 1e-9)));
    },

    // Produce ordered boundary indices for an nx × nz grid.
    gridBoundaryIndices: (nx, nz) => {
        const boundary = [];
        if (nx <= 1 || nz <= 1) return boundary;
        for (let i = 0; i < nx - 1; i++) boundary.push(i); // front
        for (let j = 0; j < nz - 1; j++) boundary.push(j * nx + (nx - 1)); // right
        for (let i = nx - 1; i > 0; i--) boundary.push((nz - 1) * nx + i); // back
        for (let j = nz - 1; j > 0; j--) boundary.push(j * nx); // left
        return boundary;
    },

    // Produce indices for all quad faces in an nx × nz grid.
    // If invert is true, reverse the triangle winding for opposite-facing faces.
    gridQuadFaceIndices: (nx, nz, offset = 0, invert = false) => {
        const indices = [];
        if (nx <= 1 || nz <= 1) return indices;
        for (let j = 0; j < nz - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                const a = offset + j * nx + i;
                const b = a + 1;
                const c = offset + (j + 1) * nx + i;
                const d = c + 1;
                if (!invert) {
                    indices.push(a, b, c, c, b, d);
                } else {
                    indices.push(a, c, b, b, c, d);
                }
            }
        }
        return indices;
    },

    // Convert UI (SVG) to Physical (CNC/Fusion)
    toPhysical: (x, y) => {
        const result = {
            x: x / 10,
            y: (600 - y) / 10 // The "Single Flip"
        };
        if (window && window.console) {
            console.log(`[COORD_STD] toPhysical: UI (${x},${y}) -> Physical (${result.x},${result.y})`);
        }
        return result;
    },

    // Convert Physical back to UI (for loading saved files)
    toUI: (x, y) => {
        const result = {
            x: x * 10,
            y: 600 - (y * 10)
        };
        if (window && window.console) {
            console.log(`[COORD_STD] toUI: Physical (${x},${y}) -> UI (${result.x},${result.y})`);
        }
        return result;
    }
};
