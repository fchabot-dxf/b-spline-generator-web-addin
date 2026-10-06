// The one Fusion log tunnel (P1: host calls live in the bridge layer; this leaf exists so core/ modules the
// bridge itself imports can log without an import cycle). Imports only the declared log level (a data module).
import ADDIN_LOG from '../data/addin-log.js';

export function fusLog(msg) {
    try { if (typeof adsk !== 'undefined' && adsk.fusionSendData) adsk.fusionSendData('log', JSON.stringify({ msg: String(msg) })); } catch (_) { }
}

/** H23 item 93: a debug-level line -- sent only while html/data/addin-log.js declares debug on, so bulky echoes
 *  (the session JSON, ~290 KB a save) never cross the bridge or fill the add-in log by default. */
export function fusDebug(msg) {
    if (ADDIN_LOG.debug) fusLog(msg);
}
