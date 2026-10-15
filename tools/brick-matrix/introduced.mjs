// introduced.mjs -- what a MISSING control means for a row that declares `introducedBy` (advisor 2026-10-14, seat D):
// the commit that added the control is NOT in this build -> an older build: the row is skipped, as before; it IS in
// this build (an ancestor of HEAD) -> the control was REMOVED since: the row FAILS. (Measured: 0b04ee2 removed
// brickAccent_courseBand; wall's row read "skipped: not in this build" and the two rows after it failed with no accent.)
import { execFileSync } from 'node:child_process';

const _cache = new Map();
/** true when `sha` is an ancestor of HEAD in `cwd` (the control's commit is in this build); false when it is not, or
 *  git does not know the sha (a build that predates it) */
export function introducedInBuild(sha, cwd) {
  const key = `${cwd}\n${sha}`;
  if (!_cache.has(key)) {
    let inBuild = false;
    try { execFileSync('git', ['-C', cwd, 'merge-base', '--is-ancestor', sha, 'HEAD'], { stdio: 'ignore' }); inBuild = true; } catch { inBuild = false; }
    _cache.set(key, inBuild);
  }
  return _cache.get(key);
}

/** the result line for a row whose control is missing */
export const missingControlResult = (sha, cwd) => (introducedInBuild(sha, cwd)
  ? { fail: true, result: `FAIL: control missing, though ${sha} (which added it) is in this build -- removed since?` }
  : { fail: false, result: `skipped: not in this build (introduced by ${sha})` });
