/**
 * core/stamp/order.js -- the LAYER STACK's stamp order (Fred 2026-11-23, the unified layer stack, step 1). ONE rule, read by
 * the engine (core/engine/rebuild.js _collectStampPasses) and the main panel's stack (main/layer-stack.js):
 *
 *   - every stack item has a KEY: an editor layer `layer:<id>` (Draw / Lattice), ALL the bricks ONE item 'bricks' (their
 *     Thicken placement is the one P.brickSettings.placement, core/stamp/placement.js; Wall / Frame / Brush become its
 *     sub-layers in step 2), an STL record `stl:<id>`, a height patch `height:<id>` (the same strings as their pass ids);
 *   - the DEFAULT order is today's stamp order: the editor roster (each layer's art, then the bricks after the first layer
 *     that holds them), then the STL records, then the height patches -- defaultStackKeys;
 *   - P.layerOrder: absent / null = that default, the passes untouched (a saved board stamps byte-identically: no sort
 *     runs). Written only once the user reorders the stack: an array of keys; every pass of an item takes that item's
 *     rank, a key it does not list (a layer added since) goes after the listed ones in its default order.
 * Top of the stack = stamped first. The Thicken line is not stored: each item's own placement says its side.
 */
export const STACK_BRICKS_KEY = 'bricks';
/** A layer that holds the bricks by declaration (F35 item 22 `holdsBricks`, item 64 `brickKind`). */
export const isBrickLayerRecord = (l) => !!l && (l.holdsBricks === true || !!l.brickKind);
export const editorLayerKey = (l) => (isBrickLayerRecord(l) ? STACK_BRICKS_KEY : `layer:${l.id}`);
export const stlKey = (rec) => `stl:${rec.id}`;
export const heightKey = (rec) => `height:${rec.id}`;

/** Pure: today's stamp order as stack keys. `hasBricks(layer)` = the layer holds laid bricks (its brick pass follows its
 *  art pass); a declared brick layer is the bricks item itself. */
export function defaultStackKeys(editorLayers, stlLayers, heightLayers, hasBricks = () => false) {
  const keys = [];
  const add = (k) => { if (!keys.includes(k)) keys.push(k); };
  for (const l of Array.isArray(editorLayers) ? editorLayers : []) {
    if (!l) continue;
    add(editorLayerKey(l));
    if (!isBrickLayerRecord(l) && hasBricks(l)) add(STACK_BRICKS_KEY);
  }
  for (const r of Array.isArray(stlLayers) ? stlLayers : []) if (r) add(stlKey(r));
  for (const r of Array.isArray(heightLayers) ? heightLayers : []) if (r) add(heightKey(r));
  return keys;
}

/** Pure: the keys in stack order -- the explicit order's keys that still exist, then the rest in default order. */
export function effectiveOrder(defaultKeys, explicit) {
  if (!Array.isArray(explicit)) return [...defaultKeys];
  const listed = explicit.filter((k) => defaultKeys.includes(k));
  return [...listed, ...defaultKeys.filter((k) => !listed.includes(k))];
}

/** Pure: the passes in stack order (a stable sort by their item's rank). `order` not an array: the SAME array back. */
export function orderPasses(passes, order, keyOf) {
  if (!Array.isArray(order)) return passes;
  const rank = new Map(order.map((k, i) => [k, i]));
  const r = (p) => { const k = keyOf(p); return rank.has(k) ? rank.get(k) : order.length; };
  return passes.map((p, i) => [p, i]).sort((a, b) => r(a[0]) - r(b[0]) || a[1] - b[1]).map(([p]) => p);
}
