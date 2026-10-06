/**
 * H23 item 93: every session save echoed the whole session JSON (~290 KB with a brick wall) into the add-in log
 * (state.js saveLastSession -> fusLog), so one palette load rotated the 512 KB log twice and lost its own lines
 * (seat A, measured 2026-10-06). The echo is now debug-level: html/data/addin-log.js declares the level (off).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import ADDIN_LOG from '../bspline-frame-builder/b-spline-gen/html/data/addin-log.js';
import { saveLastSession } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { fusLog, fusDebug } from '../bspline-frame-builder/b-spline-gen/html/core/fusion-log.js';

let sent;
beforeEach(() => {
    sent = [];
    globalThis.adsk = { fusionSendData: (action, data) => sent.push({ action, msg: JSON.parse(data).msg }) };
});
afterEach(() => { delete globalThis.adsk; ADDIN_LOG.debug = false; });

describe('the add-in log keeps the session echo at debug level (H23 item 93)', () => {
    it('ships with debug off', () => {
        expect(ADDIN_LOG.debug).toBe(false);
    });

    it('a session save sends no session JSON to the add-in log while debug is off', () => {
        saveLastSession();
        expect(sent.filter((s) => s.action === 'log' && s.msg.startsWith('{'))).toEqual([]);
    });

    it('with debug on, the session echo comes back', () => {
        ADDIN_LOG.debug = true;
        saveLastSession();
        expect(sent.some((s) => s.action === 'log' && s.msg.startsWith('{"P":'))).toBe(true);
    });

    it('fusDebug follows the declared level; fusLog always sends', () => {
        fusDebug('noise'); fusLog('[MODE] kept');
        expect(sent.map((s) => s.msg)).toEqual(['[MODE] kept']);
        ADDIN_LOG.debug = true;
        fusDebug('noise');
        expect(sent.map((s) => s.msg)).toEqual(['[MODE] kept', 'noise']);
    });
});
