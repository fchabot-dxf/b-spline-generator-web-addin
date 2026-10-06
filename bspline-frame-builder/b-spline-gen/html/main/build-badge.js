// The add-in's 'build_info' push {sha, version, built_at, dirty, status, message} -> the Settings > Version badge.
// H23 item 93: a stale/dirty deploy used to go to the fixed status line (#fusion-status), which sits OVER the header
// buttons and, as a 'warn', never clears -- a worktree deploy covered them for the whole session ("could not resolve
// source HEAD"). The warning now marks the header's Settings button instead (where the badge lives); 'unknown' (can't
// tell, not a warning) only mutes the badge. Nothing here touches the status line.

export function paintBuildInfo(info) {
    const badge = document.getElementById('build-badge');
    const settings = document.getElementById('settings-btn');
    const status = info.status || 'unknown';
    const sha = info.sha || 'unknown';
    if (settings) {
        settings.classList.toggle('build-warn', status === 'stale');
        if (status === 'stale') settings.title = `Settings -- ${info.message || 'Deployed add-in is stale'}`;
        else settings.title = 'Settings';
    }
    if (!badge) return;
    badge.title = info.message || '';
    if (status === 'unknown' || sha === 'unknown') {
        badge.className = 'cad-nav-version build-unknown';
        return;
    }
    // Fred (2026-10-03): the date-based version (YYYY.MM.DD-N) leads; older
    // deploys without one fall back to the build date.
    const label = info.version || String(info.built_at || '').slice(0, 10);
    const glyph = status === 'ok' ? '✓' : '⚠';
    const edits = info.dirty ? ' +edits' : '';
    badge.textContent = `${glyph} ${label} · ${sha}${edits}`;
    badge.className = `cad-nav-version build-${status}`;
}
