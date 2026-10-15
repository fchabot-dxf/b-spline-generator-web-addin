/**
 * The brick matrix's rule for a MISSING control on a row that declares `introducedBy` (tools/brick-matrix/introduced.mjs,
 * advisor 2026-10-14): the commit is not in this build -> skipped (an older build); it IS (an ancestor of HEAD) -> the
 * control was removed since -> FAIL. Measured: 0b04ee2 removed brickAccent_courseBand and the row read "skipped".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { introducedInBuild, missingControlResult } from '../tools/brick-matrix/introduced.mjs';

const REPO = process.cwd();

describe('a missing control: skipped in an older build, FAIL once its commit is in the build', () => {
  it('a commit in this build (82f3755 added the raised accents) -> FAIL', () => {
    expect(introducedInBuild('82f3755', REPO)).toBe(true);
    const m = missingControlResult('82f3755', REPO);
    expect(m.fail).toBe(true);
    expect(m.result).toMatch(/^FAIL/);
  });
  it('a commit this build does not have -> skipped, as before', () => {
    const m = missingControlResult('0000000000000000000000000000000000000000', REPO);
    expect(m.fail).toBe(false);
    expect(m.result).toBe('skipped: not in this build (introduced by 0000000000000000000000000000000000000000)');
  });
  it('run.mjs reads the rule at both of its skip sites (no hand-written "not in this build" left there)', () => {
    const run = readFileSync('tools/brick-matrix/run.mjs', 'utf8');
    expect(run.match(/missingControlResult\(/g)?.length).toBe(2);
    expect(run).not.toMatch(/result: `skipped: not in this build/);
  });
});
