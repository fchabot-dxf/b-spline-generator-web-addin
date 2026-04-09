// Centralized coordinate and unit conversion utility for the SVG editor and Fusion export
// This is the single source of truth for all coordinate transforms and unit conversions

export const COORD_SYSTEM = {
    canvasHeight: 600, // Match your UI/editor SVG height
    units: 'mm',
    pixelsPerUnit: 10, // 10 pixels = 1 mm

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
