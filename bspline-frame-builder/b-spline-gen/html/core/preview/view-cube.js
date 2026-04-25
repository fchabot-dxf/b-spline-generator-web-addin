class ViewCube {
  constructor(parent, onNavigate) {
    const THREE = window.THREE;
    this._THREE = THREE;
    this._onNavigate = onNavigate;

    // Renderer — expanded canvas to leave room for axis indicators around the cube
    this._size = 130;
    this._canvas = document.createElement('canvas');
    Object.assign(this._canvas.style, {
      position: 'absolute', top: '10px', right: '10px',
      width: this._size + 'px', height: this._size + 'px', pointerEvents: 'auto',
      zIndex: '10'
    });
    parent.appendChild(this._canvas);

    this._renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      antialias: true,
      alpha: true
    });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(this._size, this._size);

    // Scene — frustum widened so axis tips & labels stay inside view
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1.3, 1.3, 1.3, -1.3, 0.1, 100);
    this._camera.position.set(0, 0, 5);
    this._camera.lookAt(0, 0, 0);

    // Lights
    const amb = new THREE.AmbientLight(0xffffff, 0.4);
    this._scene.add(amb);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(5, -10, 15);
    this._scene.add(sun);

    // Group that rotates
    this._group = new THREE.Group();
    this._scene.add(this._group);

    this._faces = [];
    this._edges = [];
    this._corners = [];
    this._hovered = null;

    this._init();
    this._bindEvents();
  }

  resize() {
    this._renderer.setSize(this._size, this._size);
  }

  dispose() {
    this._renderer.dispose();
    this._canvas.remove();
    this._faces.forEach(f => {
      f.geometry.dispose();
      f.material.dispose();
      f.userData.normalMap.dispose();
      f.userData.hoverMap.dispose();
    });
    this._edges.forEach(e => {
      e.geometry.dispose();
      e.material.dispose();
    });
    this._corners.forEach(c => {
      c.geometry.dispose();
      c.material.dispose();
    });
    if (this._axisObjs) {
      this._axisObjs.forEach(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
        if (o.userData?.tex) o.userData.tex.dispose();
      });
    }
  }

  sync(mainCamera) {
    this._group.quaternion.copy(mainCamera.quaternion).invert();
  }

  render() {
    this._renderer.render(this._scene, this._camera);
  }

  _init() {
    const THREE = this._THREE;

    const bodyGeo = new THREE.BoxGeometry(0.82, 0.82, 0.82);
    const bodyMat = new THREE.MeshPhongMaterial({
      color: 0xf5f5f5,
      transparent: true,
      opacity: 0.95,
      shininess: 30
    });
    this._group.add(new THREE.Mesh(bodyGeo, bodyMat));

    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(bodyGeo),
      new THREE.LineBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.6 })
    );
    this._group.add(wire);

    const faceData = [
      { name: 'FRONT',  pos: [0, -0.42, 0], rot: [Math.PI/2, 0, 0],  view: { t: 0,           p: Math.PI/2 } },
      { name: 'BACK',   pos: [0, 0.42, 0], rot: [-Math.PI/2, 0, 0], view: { t: Math.PI,     p: Math.PI/2 } },
      { name: 'TOP',    pos: [0, 0, 0.42], rot: [0, 0, 0],          view: { t: 0,           p: 0.001 } },
      { name: 'BOTTOM', pos: [0, 0, -0.42], rot: [0, Math.PI, 0],   view: { t: 0,           p: Math.PI - 0.001 } },
      { name: 'RIGHT',  pos: [0.42, 0, 0], rot: [0, Math.PI/2, 0], view: { t: Math.PI/2,   p: Math.PI/2 } },
      { name: 'LEFT',   pos: [-0.42, 0, 0], rot: [0, -Math.PI/2, 0],view: { t: -Math.PI/2,  p: Math.PI/2 } },
    ];

    faceData.forEach(d => {
      const geo = new THREE.PlaneGeometry(0.68, 0.68);
      const mat = new THREE.MeshBasicMaterial({
        map: this._getTexture(d.name, false),
        transparent: true,
        side: THREE.FrontSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...d.pos);
      mesh.rotation.set(...d.rot);
      mesh.userData = { type: 'face', view: d.view, normalMap: mat.map, hoverMap: this._getTexture(d.name, true) };
      this._faces.push(mesh);
      this._group.add(mesh);
    });

    const edgeSize = 0.15;
    const edgeLen = 0.65;
    const edges = [
      { pos: [0, -0.41, 0.41], size: [edgeLen, edgeSize, edgeSize], view: { t: 0, p: Math.PI/4 } },
      { pos: [0, 0.41, 0.41],  size: [edgeLen, edgeSize, edgeSize], view: { t: Math.PI, p: Math.PI/4 } },
      { pos: [0.41, 0, 0.41],  size: [edgeSize, edgeLen, edgeSize], view: { t: Math.PI/2, p: Math.PI/4 } },
      { pos: [-0.41, 0, 0.41], size: [edgeSize, edgeLen, edgeSize], view: { t: -Math.PI/2, p: Math.PI/4 } },
      { pos: [0, -0.41, -0.41], size: [edgeLen, edgeSize, edgeSize], view: { t: 0, p: 3*Math.PI/4 } },
      { pos: [0, 0.41, -0.41],  size: [edgeLen, edgeSize, edgeSize], view: { t: Math.PI, p: 3*Math.PI/4 } },
      { pos: [0.41, 0, -0.41],  size: [edgeSize, edgeLen, edgeSize], view: { t: Math.PI/2, p: 3*Math.PI/4 } },
      { pos: [-0.41, 0, -0.41], size: [edgeSize, edgeLen, edgeSize], view: { t: -Math.PI/2, p: 3*Math.PI/4 } },
      { pos: [0.41, -0.41, 0], size: [edgeSize, edgeSize, edgeLen], view: { t: Math.PI/4, p: Math.PI/2 } },
      { pos: [-0.41, -0.41, 0], size: [edgeSize, edgeSize, edgeLen], view: { t: -Math.PI/4, p: Math.PI/2 } },
      { pos: [0.41, 0.41, 0],  size: [edgeSize, edgeSize, edgeLen], view: { t: 3*Math.PI/4, p: Math.PI/2 } },
      { pos: [-0.41, 0.41, 0], size: [edgeSize, edgeSize, edgeLen], view: { t: -3*Math.PI/4, p: Math.PI/2 } },
    ];

    edges.forEach(e => {
      const geo = new THREE.BoxGeometry(...e.size);
      const mat = new THREE.MeshBasicMaterial({ color: 0x4f8ef7, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...e.pos);
      mesh.userData = { type: 'edge', view: e.view };
      this._edges.push(mesh);
      this._group.add(mesh);
    });

    const cSize = 0.18;
    for (let i = 0; i < 8; i++) {
      const x = (i & 1) ? 0.41 : -0.41;
      const y = (i & 2) ? 0.41 : -0.41;
      const z = (i & 4) ? 0.41 : -0.41;
      const geo = new THREE.BoxGeometry(cSize, cSize, cSize);
      const mat = new THREE.MeshBasicMaterial({ color: 0x4f8ef7, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);

      const theta = Math.atan2(x, -y);
      const phi = (z > 0) ? Math.PI / 4 : 3 * Math.PI / 4;
      mesh.userData = { type: 'corner', view: { t: theta, p: phi } };
      this._corners.push(mesh);
      this._group.add(mesh);
    }

    // ── Colored axis indicators (Fusion-style: X=red, Y=green, Z=blue) ─────
    // All three axes share an origin at the FRONT-LEFT-BOTTOM corner of the
    // cube, then run along the cube's edges and extend past the opposite
    // corner. This matches Fusion's view-cube triad. Tracked in _axisObjs
    // for proper disposal.
    this._axisObjs = [];
    const C = 0.41; // half-cube extent (cube faces sit at ±0.41)
    const corner = [-C, -C, -C]; // front-left-bottom in local coords
    const axes = [
      { dir: [1, 0, 0],  color: 0xff3b30, label: 'X' },
      { dir: [0, 1, 0],  color: 0x34c759, label: 'Y' },
      { dir: [0, 0, 1],  color: 0x0a84ff, label: 'Z' },
    ];
    const tipExt    = 0.55; // how far past the far corner the axis sticks out
    const labelGap  = 0.13; // additional gap from tip to label center

    axes.forEach(a => {
      // Tip = corner + direction * (full-edge-length + tipExt)
      const edgeLen = 2 * C; // length along the cube edge
      const tipDist = edgeLen + tipExt;
      const tip = [
        corner[0] + a.dir[0] * tipDist,
        corner[1] + a.dir[1] * tipDist,
        corner[2] + a.dir[2] * tipDist,
      ];

      // Line: corner → tip (runs along a cube edge, then out past the corner)
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        corner[0], corner[1], corner[2],
        tip[0],    tip[1],    tip[2]
      ], 3));
      const lineMat = new THREE.LineBasicMaterial({ color: a.color, linewidth: 2 });
      const line = new THREE.Line(lineGeo, lineMat);
      this._axisObjs.push(line);
      this._group.add(line);

      // Label sprite at (slightly past) the tip
      const labelTex = this._getAxisLabelTexture(a.label, a.color);
      const labelMat = new THREE.SpriteMaterial({
        map: labelTex,
        transparent: true,
        depthTest: false   // always draw on top so the letter is readable
      });
      const sprite = new THREE.Sprite(labelMat);
      sprite.position.set(
        tip[0] + a.dir[0] * labelGap,
        tip[1] + a.dir[1] * labelGap,
        tip[2] + a.dir[2] * labelGap
      );
      sprite.scale.set(0.28, 0.28, 0.28);
      sprite.userData = { type: 'axis-label', tex: labelTex };
      this._axisObjs.push(sprite);
      this._group.add(sprite);
    });
  }

  /**
   * Render a single colored axis-letter ("X" / "Y" / "Z") onto a transparent
   * canvas texture for use as a sprite label.
   */
  _getAxisLabelTexture(letter, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);

    // Convert numeric color to css
    const r = (color >> 16) & 0xff;
    const g = (color >>  8) & 0xff;
    const b = (color)       & 0xff;
    const css = `rgb(${r}, ${g}, ${b})`;

    // Letter with subtle white halo for readability over the cube
    ctx.font = 'bold 44px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeText(letter, 32, 34);
    ctx.fillStyle = css;
    ctx.fillText(letter, 32, 34);

    const tex = new this._THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    return tex;
  }

  _getTexture(text, hover) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = hover ? '#0066cc' : '#ffffff';
    ctx.fillRect(0, 0, 128, 128);

    ctx.strokeStyle = hover ? '#0066cc' : '#dddddd';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, 128, 128);

    ctx.fillStyle = hover ? '#ffffff' : '#333333';
    ctx.font = 'bold 32px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 64);

    const tex = new this._THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    return tex;
  }

  _bindEvents() {
    this._canvas.addEventListener('mousemove', e => {
      this._onMouseMove(e);
    });
    this._canvas.addEventListener('click', e => this._onMouseClick(e));
    this._canvas.addEventListener('mouseleave', () => {
      this._onMouseLeave();
    });
  }

  _onMouseMove(e) {
    const rect = this._canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this._ndcPoint = { x, y };

    const raycaster = new this._THREE.Raycaster();
    raycaster.setFromCamera({ x, y }, this._camera);

    const hits = raycaster.intersectObjects(this._group.children, true);
    let best = null;
    if (hits.length > 0) {
      const find = (type) => hits.find(h => h.object.userData?.type === type);
      best = find('corner') || find('edge') || find('face');
    }

    if (this._hovered !== best?.object) {
      this._onMouseLeave();
      if (best) {
        this._hovered = best.object;
        this._canvas.style.cursor = 'pointer';
        const type = this._hovered.userData.type;
        if (type === 'face') {
          this._hovered.material.map = this._hovered.userData.hoverMap;
        } else {
          this._hovered.material.opacity = 0.5;
        }
      }
    }
  }

  _onMouseClick() {
    if (!this._hovered) return;
    const { t, p } = this._hovered.userData.view;
    this._onNavigate(t, p);
  }

  _onMouseLeave() {
    if (!this._hovered) return;
    const type = this._hovered.userData.type;
    if (type === 'face') {
      this._hovered.material.map = this._hovered.userData.normalMap;
    } else {
      this._hovered.material.opacity = 0;
    }
    this._hovered = null;
    this._canvas.style.cursor = 'default';
  }
}

export { ViewCube };
