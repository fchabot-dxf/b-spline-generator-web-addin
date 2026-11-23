/**
 * The unified LAYER STACK (Fred 2026-11-23, main/layer-stack.js) holds the STL cards now (the STL panel keeps its global
 * settings and hosts its settings block in the open card): a test of the STL panel mounts the real stack beside it.
 */
import { initLayerStack, _resetLayerStackForTests } from '../../bspline-frame-builder/b-spline-gen/html/main/layer-stack.js';

export function mountLayerStack(hooks = {}) {
  if (!document.getElementById('layerStackList')) document.body.insertAdjacentHTML('beforeend', '<div id="layerStackList"></div>');
  _resetLayerStackForTests();
  initLayerStack(hooks);
}
