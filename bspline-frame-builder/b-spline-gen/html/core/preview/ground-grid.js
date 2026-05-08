/**
 * Ground grid — Fusion-style XY-plane reference grid that sits under the
 * terrain. Tracks stock dimensions + 20% padding per side, with subtle
 * gray gridlines, slightly bolder major every 2", red +X tick, green +Y
 * tick, and numeric labels around the perimeter.
 *
 * Cheap to call update() every frame: rebuild is skipped when the grid
 * extent hasn't changed.
 */

export class GroundGrid {
  constructor(scene) {
    const THREE = window.THREE;
    this._THREE = THREE;
    this._scene = scene;
    this._group = new THREE.Group();
    this._group.renderOrder = -1; // draw under everything else
    scene.add(this._group);
    this._currentKey = null;
    this._show = true;
  }

  setVisible(v) {
    this._show = !!v;
    this._group.visible = this._show;
  }

  /**
   * (Re)build the grid sized to widthIn / heightIn + 20% padding per
   * side. Skipped when grid extent hasn't changed.
   */
  update(widthIn, heightIn) {
    const THREE = this._THREE;
    const halfW = Math.ceil(widthIn  * 0.5 + widthIn  * 0.2);
    const halfH = Math.ceil(heightIn * 0.5 + heightIn * 0.2);
    if (!isFinite(halfW) || !isFinite(halfH) || halfW <= 0 || halfH <= 0) return;

    const sizeKey = `${halfW}|${halfH}`;
    if (this._currentKey === sizeKey) return;
    this._currentKey = sizeKey;

    this._clear();

    const z0 = 0;
    const minorVerts = [];
    const majorVerts = [];
    const majorEvery = 2;

    for (let x = -halfW; x <= halfW; x += 1) {
      const arr = (x % majorEvery === 0) ? majorVerts : minorVerts;
      arr.push(x, -halfH, z0,  x, halfH, z0);
    }
    for (let y = -halfH; y <= halfH; y += 1) {
      const arr = (y % majorEvery === 0) ? majorVerts : minorVerts;
      arr.push(-halfW, y, z0,  halfW, y, z0);
    }

    this._addLineSegments(minorVerts, 0xcccccc, 0.45);
    this._addLineSegments(majorVerts, 0xa8a8a8, 0.65);

    // Outer border
    this._addLineSegments([
      -halfW, -halfH, z0,   halfW, -halfH, z0,
       halfW, -halfH, z0,   halfW,  halfH, z0,
       halfW,  halfH, z0,  -halfW,  halfH, z0,
      -halfW,  halfH, z0,  -halfW, -halfH, z0,
    ], 0x808080, 0.85);

    // Red tick on +X axis edge (Fusion-style)
    this._addLineSegments([halfW - 0.5, 0, z0,  halfW + 0.5, 0, z0], 0xff3b30, 1, false);
    // Green tick on +Y axis edge
    this._addLineSegments([0, halfH - 0.5, z0,  0, halfH + 0.5, z0], 0x34c759, 1, false);

    // Numeric labels along bottom (X) and left (Y) edges, every 2"
    const labelStep = 2;
    const labelOffset = 0.45;
    for (let x = -halfW; x <= halfW; x += labelStep) {
      const sprite = this._makeAxisNumberSprite(String(x));
      sprite.position.set(x, -halfH - labelOffset, z0);
      sprite.scale.set(0.9, 0.45, 1);
      this._group.add(sprite);
    }
    for (let y = -halfH; y <= halfH; y += labelStep) {
      const sprite = this._makeAxisNumberSprite(String(y));
      sprite.position.set(-halfW - labelOffset, y, z0);
      sprite.scale.set(0.9, 0.45, 1);
      this._group.add(sprite);
    }

    this._group.visible = this._show;
  }

  dispose() {
    this._clear();
    if (this._group.parent) this._group.parent.remove(this._group);
  }

  // ── Private ──────────────────────────────────────────────────────────

  _addLineSegments(verts, color, opacity, transparent = true) {
    const THREE = this._THREE;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent, opacity });
    this._group.add(new THREE.LineSegments(geo, mat));
  }

  _makeAxisNumberSprite(text) {
    const THREE = this._THREE;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 32);
    ctx.font = 'bold 18px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7a7a7a';
    ctx.fillText(text, 32, 17);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.userData = { _tex: tex };
    return sprite;
  }

  _clear() {
    while (this._group.children.length) {
      const child = this._group.children[0];
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
      if (child.userData?._tex) child.userData._tex.dispose();
      this._group.remove(child);
    }
  }
}
