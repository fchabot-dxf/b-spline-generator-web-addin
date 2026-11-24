/**
 * core/frame-bars.js -- Bars Off (Fred 2026-11-23: "a version of a board without the wood frame, but with the board's
 * outline cut to the frame's shape"). The frame record's `bars` key (core/frame-record.js) is stored ONLY as `false`;
 * absent = the wood bars are built, so every record saved before it reads exactly as before. This is its ONE reader,
 * kept in its own pure module so the editor's frame profile (editor/editor-frame-profile.js) reads it without
 * importing app state.
 */
export function frameBarsOn(record) {
  return !(record && record.bars === false);
}
