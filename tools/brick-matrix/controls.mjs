// The Brick matrix's declarations live one module per group: tools/brick-matrix/groups/<group>.mjs (rows, constants,
// runner), indexed by groups/index.mjs, which run.mjs reads. This file only re-exports that index for older importers
// (tests/*.test.js read MIGRATION from here).
export * from './groups/index.mjs';
