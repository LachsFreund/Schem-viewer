(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('view');

  /* ---------- three.js ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2b2d33);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 6000);
  const controls = new ViewControls(camera, canvas);

  let atlas = new Atlas();
  // Ebenen-Filter: Fragmente von Blöcken mit y >= uCut werden verworfen (kein Clip-Plane -> keine Unterseiten-Reste)
  const layerCut = { value: 1e6 };
  const layerShader = shader => {
    shader.uniforms.uCut = layerCut;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLayer;\nvarying float vLayer;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLayer = aLayer;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLayer;\nuniform float uCut;')
      .replace('void main() {', 'void main() {\n  if (vLayer > uCut - 0.5) discard;');
  };
  const matCut = new THREE.MeshBasicMaterial({
    map: atlas.texture, vertexColors: true, alphaTest: 0.5
  });
  matCut.onBeforeCompile = layerShader;
  const matTrans = new THREE.MeshBasicMaterial({
    map: atlas.texture, vertexColors: true, transparent: true, alphaTest: 0.02,
    depthWrite: false
  });
  matTrans.onBeforeCompile = layerShader;

  const modelGroup = new THREE.Group();
  const capGroup = new THREE.Group();
  scene.add(modelGroup, capGroup);

  let grid = null;
  const axes = new THREE.AxesHelper(4);
  scene.add(axes);

  const measure = new Measure(scene, $('measure'), $('hoverLabel'));

  let current = null;     // { schem, label, built }
  let buildToken = 0;

  /* ---------- UI-Helfer ---------- */
  let toastTimer;
  function toast(msg, isError = false, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = ''), ms || (isError ? 7000 : 2500));
  }
  const hexCss = h => '#' + h.toString(16).padStart(6, '0');
  const pretty = n => n.replace(/_/g, ' ');

  function clearGroup(g) {
    for (const child of [...g.children]) { child.geometry.dispose(); g.remove(child); }
  }

  function addMeshes(group, geoCut, geoTrans) {
    if (geoCut) group.add(new THREE.Mesh(geoCut, matCut));
    if (geoTrans) { const m = new THREE.Mesh(geoTrans, matTrans); m.renderOrder = 1; group.add(m); }
  }

  function rebuildGrid(w, l, margin = 32) {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    const size = Math.max(16, Math.ceil(Math.max(w, l) / 16) * 16 + margin);
    grid = new THREE.GridHelper(size, size, 0x6b7280, 0x3d414a);
    grid.position.set(w / 2, -0.002, l / 2);
    grid.visible = $('chkGrid').checked;
    scene.add(grid);
  }

  function resetView() {
    if (!current) return;
    const s = current.schem;
    controls.focus(new THREE.Vector3(s.width / 2, s.height / 2, s.length / 2), Math.max(s.width, s.height, s.length));
  }

  /* ---------- Layer-Slider (mit Oberseiten-Caps) ---------- */
  let capQueued = false;
  function updateSlice() {
    const slice = $('sliceY');
    const v = +slice.value;
    const all = slice.disabled || v >= +slice.max;
    layerCut.value = all ? 1e6 : v;
    measure.setMaxY(all ? 1e9 : v);
    $('sliceVal').textContent = slice.disabled ? '–' : (all ? 'alle' : `bis ${v}`);
    if (!capQueued) {
      capQueued = true;
      requestAnimationFrame(() => { capQueued = false; applyCap(); });
    }
  }

  function applyCap() {
    clearGroup(capGroup);
    if (!current || !current.built) return;
    const slice = $('sliceY');
    const v = +slice.value;
    if (slice.disabled || v >= +slice.max || v <= 0) return;
    const cap = current.built.cap(v - 1);
    if (cap) addMeshes(capGroup, cap.cutout, cap.translucent);
  }

  /* ---------- Laden & Anzeigen ---------- */
  async function show(schem, label) {
    const token = ++buildToken;
    const t0 = performance.now();
    $('infoBody').innerHTML = `<b>${label}</b><br>Lade …`;
    Assets.stats.requests = Assets.stats.missing = Assets.stats.failed = 0;

    let built;
    try {
      built = await Mesher.build(schem, atlas, msg => { if (token === buildToken) $('infoBody').innerHTML = `<b>${label}</b><br>${msg}`; });
    } catch (err) {
      console.error(err);
      toast(err.message || String(err), true);
      return;
    }
    if (token !== buildToken) return; // inzwischen wurde etwas anderes geladen

    clearGroup(modelGroup);
    clearGroup(capGroup);
    addMeshes(modelGroup, built.cutout, built.translucent);

    current = { schem, label, built };
    measure.setModel(schem, built.infos);
    rebuildGrid(schem.width, schem.length, built.stats.blocks ? 32 : 0); // leere Fläche: Raster exakt so groß wie die Fläche
    axes.scale.setScalar(Math.max(1, Math.min(schem.width, schem.length) / 8));

    const slice = $('sliceY');
    slice.disabled = false;
    slice.max = schem.height;
    slice.value = schem.height;
    updateSlice();
    resetView();

    const st = Assets.stats;
    $('infoBody').innerHTML =
      `<b>${label}</b><br>` +
      `Größe: ${schem.width} × ${schem.height} × ${schem.length}<br>` +
      `Blöcke: ${built.stats.blocks.toLocaleString('de-DE')}<br>` +
      `Flächen: ${built.stats.quads.toLocaleString('de-DE')}<br>` +
      `Texturen: ${atlas.entries.size} (MC ${Assets.version})<br>` +
      `Aufbau: ${Math.round(performance.now() - t0)} ms`;

    if (st.failed > 0) {
      toast('Texturen konnten nicht (vollständig) geladen werden – es werden Farben angezeigt. Internetverbindung prüfen.', true, 9000);
    }

    $('legend').innerHTML = built.stats.legend.slice(0, 14).map(e =>
      `<div class="legend-row"><span class="swatch" style="background:${hexCss(e.hex)}"></span>` +
      `<span class="legend-name" title="${e.name}">${pretty(e.name)}</span>` +
      `<span class="legend-count">${e.count.toLocaleString('de-DE')}</span></div>`
    ).join('');
  }

  async function openFile(file) {
    if (!file) return;
    try {
      toast('Lade ' + file.name + ' …', false, 60000);
      const schem = await Schematic.load(await file.arrayBuffer());
      await show(schem, file.name);
      toast(file.name + ' geladen');
    } catch (err) {
      console.error(err);
      toast(err.message || String(err), true);
    }
  }

  /* ---------- Picking / Messen ---------- */
  const ray = new THREE.Raycaster();
  function rayFrom(ev, fromCenter) {
    if (fromCenter) ray.setFromCamera({ x: 0, y: 0 }, camera);
    else {
      const r = canvas.getBoundingClientRect();
      ray.setFromCamera({ x: ((ev.clientX - r.left) / r.width) * 2 - 1, y: -((ev.clientY - r.top) / r.height) * 2 + 1 }, camera);
    }
    return ray.ray;
  }
  function pick(ev, fromCenter) {
    const r = rayFrom(ev, fromCenter);
    return measure.raycast(r.origin, r.direction);
  }

  controls.onPick = (button, ev, fromCenter) => {
    const hit = pick(ev, fromCenter);
    if (!hit) { toast('Kein Block getroffen', false, 1200); return; }
    if (button === 0) measure.setA(hit);
    else if (button === 2) measure.setB(hit);
  };

  let hoverQueued = null;
  controls.onHover = (ev, fromCenter) => {
    if (!ev && !fromCenter) { measure.setHover(null); return; }
    if (hoverQueued) { hoverQueued.ev = ev; hoverQueued.c = fromCenter; return; }
    hoverQueued = { ev, c: fromCenter };
    requestAnimationFrame(() => {
      const q = hoverQueued; hoverQueued = null;
      measure.setHover(q.ev || q.c ? pick(q.ev, q.c) : null);
    });
  };

  function setMeasureMode(on) {
    controls.measureMode = on;
    $('btnMeasure').classList.toggle('active', on);
    $('btnMeasure').textContent = 'Messmodus: ' + (on ? 'an' : 'aus');
    if (!on) measure.setHover(null);
  }

  /* ---------- Verdrahtung ---------- */
  $('btnOpen').onclick = () => $('fileInput').click();
  $('fileInput').onchange = e => { openFile(e.target.files[0]); e.target.value = ''; };
  $('btnDemo').onclick = () => show(Schematic.demo(), 'Demo-Haus');
  $('btnClear').onclick = () => show(Schematic.empty(32, 16, 32), 'Leere Fläche 32×32');
  $('btnReset').onclick = resetView;
  $('btnFly').onclick = () => controls.setFly(!controls.fly);
  $('btnMeasure').onclick = () => setMeasureMode(!controls.measureMode);
  $('sliceY').oninput = updateSlice;
  $('chkGrid').onchange = e => { if (grid) grid.visible = e.target.checked; };
  $('chkAxes').onchange = e => { axes.visible = e.target.checked; };
  $('chkWire').onchange = e => { matCut.wireframe = matTrans.wireframe = e.target.checked; };

  // Maus-Empfindlichkeit (wird gemerkt)
  const BASE_SENS = controls.sensitivity;
  const sensEl = $('sens');
  try { const saved = localStorage.getItem('sv-sens'); if (saved) sensEl.value = saved; } catch (e) {}
  const applySens = () => {
    controls.sensitivity = BASE_SENS * +sensEl.value;
    try { localStorage.setItem('sv-sens', sensEl.value); } catch (e) {}
  };
  sensEl.oninput = applySens;
  applySens();

  // Texturversion
  const sel = $('selVersion');
  CONFIG.VERSIONS.forEach(v => sel.add(new Option(v, v)));
  sel.value = CONFIG.version;
  sel.onchange = () => {
    CONFIG.version = sel.value;
    Assets.setVersion(sel.value);
    Models.reset();
    atlas.dispose();
    atlas = new Atlas();
    matCut.map = matTrans.map = atlas.texture;
    matCut.needsUpdate = matTrans.needsUpdate = true;
    if (current) show(current.schem, current.label);
  };

  controls.onFlyChange = on => {
    $('btnFly').textContent = 'Flugmodus: ' + (on ? 'an' : 'aus');
    $('btnFly').classList.toggle('active', on);
    document.body.classList.toggle('flying', on);
    document.body.classList.toggle('orbit', !on);
    if (on) measure.setHover(null);
  };
  document.body.classList.add('orbit');

  window.addEventListener('keydown', e => {
    if (/input|textarea|select/i.test(e.target.tagName)) return;
    if (e.code === 'KeyF') controls.setFly(!controls.fly);
    if (e.code === 'KeyR') resetView();
    if (e.code === 'KeyC' && !e.ctrlKey && !e.altKey) measure.clear();
    if (e.code === 'KeyM') setMeasureMode(!controls.measureMode);
  });
  window.addEventListener('keyup', e => {
    if ((e.code === 'AltLeft' || e.code === 'AltRight') && !controls.measureMode) measure.setHover(null);
  });

  // Drag & Drop
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('drop').classList.add('show'); });
  window.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('drop').classList.remove('show'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    $('drop').classList.remove('show');
    openFile(e.dataTransfer.files[0]);
  });

  /* ---------- Render-Schleife ---------- */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now(), flyHoverT = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    controls.update(dt);

    // im Flugmodus: Hover über Bildmitte, solange Alt gehalten wird
    if (controls.fly && current && (controls.keys.AltLeft || controls.keys.AltRight || controls.measureMode) && now - flyHoverT > 80) {
      flyHoverT = now;
      measure.setHover(pick(null, true));
    } else if (controls.fly && !(controls.keys.AltLeft || controls.keys.AltRight || controls.measureMode)) {
      if (measure.boxHover.visible) measure.setHover(null);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  show(Schematic.demo(), 'Demo-Haus');
})();
