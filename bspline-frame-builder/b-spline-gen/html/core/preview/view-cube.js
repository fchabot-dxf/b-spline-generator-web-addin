class ViewCube {
  constructor(parent, onNavigate) {
    const THREE = window.THREE;
    this._THREE = THREE;
    this._onNavigate = onNavigate;

    // Renderer
    this._canvas = document.createElement('canvas');
    Object.assign(this._canvas.style, {
      position: 'absolute', top: '10px', right: '10px',
      width: '100px', height: '100px', pointerEvents: 'auto',
      zIndex: '10'
    });
    parent.appendChild(this._canvas);

    this._renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      antialias: true,
      alpha: true
    });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(100, 100);

    // Scene
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
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
    this._renderer.setSize(100, 100);
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
