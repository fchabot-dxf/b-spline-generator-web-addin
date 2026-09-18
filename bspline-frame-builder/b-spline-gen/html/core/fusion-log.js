// The one Fusion log tunnel (P1: host calls live in the bridge layer; this leaf exists so core/ modules the
// bridge itself imports can log without an import cycle). No imports.
export function fusLog(msg) {
    try { if (typeof adsk !== 'undefined' && adsk.fusionSendData) adsk.fusionSendData('log', JSON.stringify({ msg: String(msg) })); } catch (_) { }
}
