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

    it('pullSketchFromFusion sends the project\'s board id + size (board-aware, seat A 2026-10-14)', () => {
        const sendFn = vi.fn();
        globalThis.adsk = { fusionSendData: sendFn };
        P.boardId = 'kx1y2z3a';

        pullSketchFromFusion();
        const [action, payload] = sendFn.mock.calls[0];
        expect(action).toBe('pull_sketch_from_fusion');
        expect(JSON.parse(payload)).toEqual({ board: { id: 'kx1y2z3a' }, widthIn: P.widthIn, heightIn: P.heightIn, frameSeedIds: [] }); // no frame on this board: nothing to read back
    });

    it('pullSketchFromFusion sends an empty board id for a project with none yet (the legacy board)', () => {
        const sendFn = vi.fn();
        globalThis.adsk = { fusionSendData: sendFn };
        P.boardId = null;

        pullSketchFromFusion();
        expect(JSON.parse(sendFn.mock.calls[0][1]).board).toEqual({ id: '' });
    });

    it('dispatching sketch_pulled adds NO layer and draws no curve (Fred 2026-10-14: Pull never adds layers)', async () => {
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

        // untagged curves (no Send railId) are noted, not added: no layer, no drawn path, no editor undo step
        expect(mockEditor._layers.length).toBe(0);
        expect(children.length).toBe(0);
        expect(mockEditor.pushState).not.toHaveBeenCalled();
        expect(mockEditor._notifyChange).not.toHaveBeenCalled();

        // a second pull still adds nothing
        handleFusionHandshake({
            detail: { action: 'sketch_pulled', data: JSON.stringify({ ...payload, curves: [{ type: 'line', d: 'M 5 5 L 6 6', isConstruction: false }] }) }
        });
        expect(mockEditor._layers.length).toBe(0);
        expect(children.length).toBe(0);
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
