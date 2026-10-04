// When the merge gate runs the Brick matrix (tools/brick-matrix/run.mjs --only-if-changed <base>): only if
// the merge touches one of these. Declared here so it is data, not anyone's memory (advisor, 2026-10-04:
// the full matrix is too slow for every merge).
// Each entry is a path PREFIX, repo-relative, forward slashes.
export const BRICK_MATRIX_GATE_PATHS = [
  'bspline-frame-builder/b-spline-gen/html/main/brick-panel.js',
  'bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js',
  'bspline-frame-builder/b-spline-gen/html/main/app-init.js',
  'bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js',
  'bspline-frame-builder/b-spline-gen/html/main/global-events.js',
  'bspline-frame-builder/b-spline-gen/html/editor/',           // the whole editor (brick tool, layers, stripe, io)
  'bspline-frame-builder/b-spline-gen/html/core/bricks/',
  'bspline-frame-builder/b-spline-gen/html/core/state.js',
  'bspline-frame-builder/b-spline-gen/html/core/engine/',
  'bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html',
  'bspline-frame-builder/styles/',
  'tools/brick-matrix/',
];

export const touchesBrickMatrix = (changedPaths) =>
  changedPaths.some((p) => BRICK_MATRIX_GATE_PATHS.some((prefix) => p.replace(/\\/g, '/').startsWith(prefix)));
