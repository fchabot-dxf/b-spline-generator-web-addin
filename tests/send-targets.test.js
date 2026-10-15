/**
 * Send targets S1 (seat A 2026-10-14; advisor 45, Fred): ONE Send menu (main/send-targets.js SEND_TARGETS) -- replace
 * (the Send button), new component, new document -- and the project's board identity P.boardId: minted at a Send,
 * re-minted by a new component (the project adopts its new board), dropped by a New project and a Save As copy.
 * The add-in side is pinned in b-spline-gen/test_send_targets.py.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/main/snapshot-manager.js', () => ({
  applySnapshot: vi.fn(async (snap) => { Object.assign((await import('../bspline-frame-builder/b-spline-gen/html/core/state.js')).P, snap.P); }),
}));

import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { SEND_TARGETS, DEFAULT_SEND_TARGET, offeredSendTargets, mintBoardId, sendTargetPayload, BOARD_ID_LENGTH }
  from '../bspline-frame-builder/b-spline-gen/html/main/send-targets.js';
import { bindSendTargetMenu } from '../bspline-frame-builder/b-spline-gen/html/main/header-controls.js';
import { setFusionActionState } from '../bspline-frame-builder/b-spline-gen/html/core/fusion-bridge.js';
import { newProject } from '../bspline-frame-builder/b-spline-gen/html/main/cloud-project-manager.js';
import { markClean } from '../bspline-frame-builder/b-spline-gen/html/core/dirty.js';

const $ = (id) => document.getElementById(id);

describe('the declared targets', () => {
  it('replace / newComponent / newDocument, the button being replace', () => {
    expect(SEND_TARGETS.map((t) => t.id)).toEqual(['replace', 'newComponent', 'newDocument']);
    expect(DEFAULT_SEND_TARGET).toBe('replace');
    for (const t of SEND_TARGETS) expect(t.label && t.title, t.id).toBeTruthy();
  });
  it('the menu offers only the ready ones (a new component waits for the per-board params)', () => {
    expect(offeredSendTargets().map((t) => t.id)).toEqual(['replace', 'newDocument']);
  });
});

describe('the board identity', () => {
  beforeEach(() => { P.boardId = null; });
  it('a minted id: a letter, then letters / digits (it becomes a Fusion parameter prefix)', () => {
    for (let i = 0; i < 50; i++) expect(mintBoardId()).toMatch(new RegExp(`^[a-z][a-z0-9]{${BOARD_ID_LENGTH - 1}}$`));
    expect(mintBoardId(() => 0)).toBe('a'.repeat(BOARD_ID_LENGTH));
  });
  it('a Send mints one for a project without; a replace keeps it; a new component makes a new one the project adopts', () => {
    const first = sendTargetPayload('replace', { name: ' Rose 9x12 ', locked: ['Bricks'] });
    expect(first).toEqual({ target: 'replace', board: { id: P.boardId, name: 'Rose 9x12' }, locked: ['Bricks'] });
    expect(P.boardId).toMatch(/^[a-z]/);
    const id = P.boardId;
    expect(sendTargetPayload('replace').board.id).toBe(id);
    expect(sendTargetPayload('newDocument').board.id).toBe(id);
    const fresh = sendTargetPayload('newComponent');
    expect(fresh.board.id).not.toBe(id);
    expect(P.boardId).toBe(fresh.board.id);
  });
  it('an unknown target is a replace; no project name is "Board"', () => {
    expect(sendTargetPayload('elsewhere')).toMatchObject({ target: 'replace', board: { name: 'Board' } });
  });
  it('a New project starts without a board (its own in Fusion, never the old project\'s)', async () => {
    document.body.innerHTML = '';
    markClean();
    P.boardId = 'kold0001';
    expect(await newProject()).toBe(true);
    expect(P.boardId).toBeNull();
  });
});

describe('the Send ▾ menu', () => {
  beforeEach(() => {
    document.body.innerHTML = `<button id="btnDownload">Send to Fusion</button>
      <span class="send-menu-wrap"><button id="btnSendMenu" aria-expanded="false">▾</button>
      <div id="sendTargetMenu" hidden></div></span>`;
  });
  it('lists the offered targets; a pick sends to it and closes the menu', () => {
    const onFusionApply = vi.fn();
    bindSendTargetMenu('preview', onFusionApply);
    expect([...$('sendTargetMenu').querySelectorAll('button')].map((b) => b.id)).toEqual(['sendTarget_replace', 'sendTarget_newDocument']);
    $('btnSendMenu').click();
    expect($('sendTargetMenu').hidden).toBe(false);
    $('sendTarget_newDocument').click();
    expect(onFusionApply).toHaveBeenCalledWith('preview', { sendTarget: 'newDocument' });
    expect($('sendTargetMenu').hidden).toBe(true);
  });
  it('a click outside or Escape closes it', () => {
    bindSendTargetMenu('preview', vi.fn());
    $('btnSendMenu').click();
    document.body.click();
    expect($('sendTargetMenu').hidden).toBe(true);
    $('btnSendMenu').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect($('sendTargetMenu').hidden).toBe(true);
  });
  it('is busy with the Send button (no second Send mid-import)', () => {
    setFusionActionState('Sending...', true);
    expect($('btnSendMenu').disabled).toBe(true);
    setFusionActionState('Send to Fusion', false);
    expect($('btnSendMenu').disabled).toBe(false);
  });
});
