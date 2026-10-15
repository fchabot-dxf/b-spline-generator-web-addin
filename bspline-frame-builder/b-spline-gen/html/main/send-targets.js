/**
 * Send targets (seat A 2026-10-14; advisor 45, Fred): ONE Send menu, one path. SEND_TARGETS is read by the header's
 * Send ▾ menu and by the payload; what each target does in Fusion is the add-in's SEND_TARGET_PLAN
 * (b-spline-gen/send_targets.py):
 *   replace       this project's board: its tagged board component in the open design, else the legacy root board
 *   newComponent  a NEW board component beside the others in the open design (the project adopts its new boardId)
 *   newDocument   a new Fusion document; the documents already open are never touched
 * `ready: false` = declared, not offered yet. (newComponent was, until S2's per-board params landed: two boards in one
 * design shared widthIn / heightIn and resized each other; each board's names are its own since, 2026-10-15.)
 * The board identity is P.boardId (saved with the project; a New project / a Save As copy starts without one).
 */
import { P } from '../core/state.js';

export const SEND_TARGETS = Object.freeze([
  Object.freeze({ id: 'replace', label: 'Send (replace)', title: "Replace this project's board in the open Fusion design", ready: true }),
  Object.freeze({ id: 'newComponent', label: 'Send as new component', title: 'A new board beside the others in the open Fusion design', ready: true }), // S2 merged: per-board params
  Object.freeze({ id: 'newDocument', label: 'Send as new document', title: 'A new Fusion document (the open ones are untouched)', ready: true }),
]);
export const DEFAULT_SEND_TARGET = 'replace';
export const BOARD_ID_LENGTH = 8;

/** A fresh board id: BOARD_ID_LENGTH lowercase letters / digits, starting with a letter (it becomes a Fusion
 *  parameter-name prefix in the next slice, and a name may not start with a digit). */
export function mintBoardId(random = Math.random) {
  const letters = 'abcdefghijklmnopqrstuvwxyz', chars = letters + '0123456789';
  let id = letters[Math.floor(random() * letters.length) % letters.length];
  while (id.length < BOARD_ID_LENGTH) id += chars[Math.floor(random() * chars.length) % chars.length];
  return id;
}

/** The targets the menu offers (declared order, ready only). */
export function offeredSendTargets() {
  return SEND_TARGETS.filter((t) => t.ready);
}

/** The payload's target / board / locked fields. A new component always gets a NEW board id (the project adopts
 *  it, so its next replace targets that board); any target mints one for a project that has none yet. */
export function sendTargetPayload(targetId, { name = null, locked = [] } = {}) {
  const target = SEND_TARGETS.some((t) => t.id === targetId) ? targetId : DEFAULT_SEND_TARGET;
  if (target === 'newComponent' || !P.boardId) P.boardId = mintBoardId();
  return { target, board: { id: P.boardId, name: (name && String(name).trim()) || 'Board' }, locked: [...locked] };
}
