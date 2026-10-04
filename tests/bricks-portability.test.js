/**
 * H23 item 72 BRICK ENGINE -- portability contract (advisor: "a pure ES module with zero imports
 * from this app... add a test that it imports nothing outside core/bricks/"). Statically scans
 * every source file under core/bricks/ and asserts every import specifier is either a RELATIVE
 * import that resolves to a path still inside core/bricks/, or a bare package specifier (none
 * expected -- the module is meant to copy-paste whole into MathieuConnery, a sibling app with no
 * shared node_modules).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BRICKS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../bspline-frame-builder/b-spline-gen/html/core/bricks',
);

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function importSpecifiers(source) {
  const specs = [];
  const re = /\bfrom\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source))) specs.push(m[1]);
  return specs;
}

describe('core/bricks portability (zero imports outside core/bricks/)', () => {
  const files = listJsFiles(BRICKS_ROOT);

  it('finds the full module (sanity -- this test is not vacuous if the module ever shrinks to zero files)', () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  it('every import in every core/bricks file resolves inside core/bricks/', () => {
    const violations = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const spec of importSpecifiers(source)) {
        if (!spec.startsWith('.')) {
          violations.push(`${path.relative(BRICKS_ROOT, file)}: bare/non-relative import "${spec}"`);
          continue;
        }
        const resolved = path.resolve(path.dirname(file), spec);
        const insideRoot = resolved === BRICKS_ROOT || resolved.startsWith(BRICKS_ROOT + path.sep);
        if (!insideRoot) {
          violations.push(`${path.relative(BRICKS_ROOT, file)}: imports outside core/bricks/ -> "${spec}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('catches a deliberately-introduced violation (proves the scan is not vacuous)', () => {
    const bad = "import { foo } from '../../editor/editor-lattice-pattern.js';\n";
    const specs = importSpecifiers(bad);
    expect(specs).toEqual(['../../editor/editor-lattice-pattern.js']);
    const resolved = path.resolve(BRICKS_ROOT, specs[0]);
    const insideRoot = resolved === BRICKS_ROOT || resolved.startsWith(BRICKS_ROOT + path.sep);
    expect(insideRoot).toBe(false);
  });
});
