// H23 item 93: what the add-in's log (b_spline_gen_log.txt) keeps, DECLARED ONCE. The add-in (b-spline-gen.py, _log)
// and the palette (core/fusion-log.js, fusDebug) both read it; the object below must stay pure JSON (the add-in
// json-loads everything after the line that starts with the export).
// Measured (seat A, 2026-10-06): one palette load wrote ~290 KB per session save (the whole session JSON echoed to
// the log, state.js saveLastSession) and a Send's own lines were 2/3 '[DEBUG] ATTR TAG' + 1/6 'CONSTRAINT OK', so a
// load rotated the 512 KB log twice and its own lines were gone. With debug off those lines are not written (the
// sketch builder still counts them); [STAGE] / [MODE] / [XFER] / [PROGRESS] / warnings / errors always are.
// rotateBytes: the live file rotates to .old past this size; sized so one palette load + Send (its frame build
// included) fits twice EVEN WITH debug on. Measured live 2026-10-06, 7x9 frame + brick wall: debug off, load 2 KB +
// Send 19.5 KB; debug on, a load ~600 KB (two session echoes) + a Send ~75 KB -> 2 x ~0.7 MB < 2 MB.
export default {
  "debug": false,
  "debugPrefixes": ["[DEBUG]", "CONSTRAINT OK:"],
  "rotateBytes": 2097152
}
