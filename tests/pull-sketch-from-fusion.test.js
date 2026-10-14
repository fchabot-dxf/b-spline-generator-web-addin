import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pullSketchFromFusion } from '../bspline-frame-builder/b-spline-gen/html/core/fusion-bridge.js';
import { handleFusionHandshake } from '../bspline-frame-builder/b-spline-gen/html/main/main.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

describe('pullSketchFromFusion & sketch_pulled pipeline', () => {
    let originalAdsk;

    beforeEach(() => {
        originalAdsk = globalThis.adsk;
    });

    afterEach(() => {
        if (originalAdsk !== undefined) globalThis.adsk = originalAdsk;
        else delete globalThis.adsk;
    });

    it('pullSketchFromFusion sends pull_sketch_from_fusion when adsk is present', () => {
        const sendFn = vi.fn();
        globalThis.adsk = { fusionSendData: sendFn };

        pullSketchFromFusion();
        // the palette's board goes along (a design without its own size places the curves on it: main/pull-sketch.js)
        expect(sendFn).toHaveBeenCalledWith('pull_sketch_from_fusion', JSON.stringify({ widthIn: P.widthIn, heightIn: P.heightIn }));
    });

    it('dispatching sketch_pulled creates Fusion Sketch layer and populates curves', async () => {
        // Import main to attach listener
        await import('../bspline-frame-builder/b-spline-gen/html/main/main.js');

        // Setup mock svgEditor
        const children = [];
        const mockChildrenList = () => ({
            toArray: () => [...children],
            forEach: (fn) => children.forEach(fn),
        });
        const mockSketchLayer = {
            children: mockChildrenList,
            path: (d) => {
                const node = {
                    d,
                    attrs: {},
                    node: {
                        classList: {
                            add: () => {},
                            remove: () => {},
                            toggle: () => {},
                            contains: () => false,
                        },
                        style: {},
                    },
                    attr(k, v) {
                        if (v !== undefined) { this.attrs[k] = v; return this; }
                        return this.attrs[k];
                    },
                    addClass() { return this; },
                    removeClass() { return this; },
                    remove() {
                        const idx = children.indexOf(node);
                        if (idx >= 0) children.splice(idx, 1);
                    },
                    fill() { return this; },
                    stroke() { return this; }
                };
                children.push(node);
                return node;
            }
        };

        const mockEditor = {
            _layers: [],
            _sketchLayer: mockSketchLayer,
            pushState: vi.fn(),
            _notifyChange: vi.fn()
        };
        window.svgEditor = mockEditor;

        const payload = {
            ok: true,
            sketchName: 'SE15 Constrained Sketch',
            widthIn: 7.0,
            heightIn: 9.0,
            curves: [
                { type: 'line', d: 'M 1 2 L 3 4', isConstruction: false },
                { type: 'circle', d: 'M 2 2 A 1 1 0 1 0 4 2 A 1 1 0 1 0 2 2 Z', isConstruction: false },
                { type: 'line', d: 'M 0 0 L 1 1', isConstruction: true } // should be skipped since non-construction exist
            ]
        };

        handleFusionHandshake({
            detail: { action: 'sketch_pulled', data: JSON.stringify(payload) }
        });

        expect(mockEditor._layers.length).toBe(1);
        expect(mockEditor._layers[0].name).toBe('Fusion Sketch');
        expect(children.length).toBe(2); // 2 non-construction curves
        expect(children[0].d).toBe('M 1 2 L 3 4');
        expect(children[0].attrs['data-layer']).toBe(mockEditor._layers[0].id);
        expect(mockEditor.pushState).toHaveBeenCalled();
        expect(mockEditor._notifyChange).toHaveBeenCalledWith('commit');

        // Now test second pull replaces previous curves rather than duplicating
        const payload2 = {
            ok: true,
            sketchName: 'SE15 Constrained Sketch',
            widthIn: 7.0,
            heightIn: 9.0,
            curves: [
                { type: 'line', d: 'M 5 5 L 6 6', isConstruction: false }
            ]
        };

        handleFusionHandshake({
            detail: { action: 'sketch_pulled', data: JSON.stringify(payload2) }
        });

        expect(mockEditor._layers.length).toBe(1); // keeps same layer
        expect(children.length).toBe(1); // previous 2 removed, 1 new added
        expect(children[0].d).toBe('M 5 5 L 6 6');
    });

    it('dispatching sketch_pulled with ok=false reports warning without touching layers', async () => {
        const mockEditor = {
            _layers: [],
            pushState: vi.fn(),
            _notifyChange: vi.fn()
        };
        window.svgEditor = mockEditor;

        handleFusionHandshake({
            detail: { action: 'sketch_pulled', data: JSON.stringify({ ok: false, error: 'No active sketch' }) }
        });

        expect(mockEditor._layers.length).toBe(0);
        expect(mockEditor.pushState).not.toHaveBeenCalled();
    });
});
