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
  const physics = new Physics();
  controls.collides = (mn, mx) => physics.collides(mn, mx);

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

  // "N" für Norden: liegt flach auf der Grundplatte am nördlichen Rand (Norden = -Z), Oberkante des Buchstabens zeigt nach Norden
  function makeNorthMark(size) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.lineJoin = 'round';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 170px system-ui, Arial, sans-serif';
    g.lineWidth = 12;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.fillStyle = '#ff5a4d';
    g.strokeText('N', 128, 156);
    g.fillText('N', 128, 156);
    g.beginPath();                                  // kleiner Pfeil nach Norden über dem N
    g.moveTo(128, 6); g.lineTo(172, 66); g.lineTo(84, 66); g.closePath();
    g.stroke(); g.fill();
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, side: THREE.DoubleSide })
    );
    mark.rotation.x = -Math.PI / 2;                 // flach hinlegen: Oberkante -> Norden, rechts -> Osten
    mark.renderOrder = 2;
    return mark;
  }

  let northMark = null;

  function rebuildGrid(w, l, margin = 32) {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    if (northMark) { scene.remove(northMark); northMark.geometry.dispose(); northMark.material.map.dispose(); northMark.material.dispose(); northMark = null; }
    const size = Math.max(16, Math.ceil(Math.max(w, l) / 16) * 16 + margin);
    grid = new THREE.GridHelper(size, size, 0x6b7280, 0x3d414a);
    grid.position.set(w / 2, -0.002, l / 2);
    grid.visible = $('chkGrid').checked;
    scene.add(grid);

    const ms = Math.min(8, Math.max(3, size / 12));
    northMark = makeNorthMark(ms);
    northMark.position.set(w / 2, 0.02, l / 2 - size / 2 + ms * 0.6);   // mittig am Nordrand der Platte
    northMark.visible = grid.visible;                                  // folgt dem Haken "Raster"
    scene.add(northMark);
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
    physics.maxY = all ? 1e9 : v;
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

  /* ---------- Speichern (Einstellungen + zuletzt geöffnetes Schematic) ---------- */
  const SKEY = 'sv-settings';
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch (e) {}
  const saveSettings = () => { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) {} };
  const setSource = kind => { settings.source = kind; saveSettings(); };

  const DB = {
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('schem-viewer', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async set(k, v) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
      });
    },
    async get(k) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const rq = db.transaction('kv').objectStore('kv').get(k);
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
    }
  };

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
    physics.setModel(schem, built.infos);
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

    $('legendCount').textContent = `(${built.stats.legend.length})`;
    $('legend').innerHTML = built.stats.legend.slice(0, 60).map(e =>
      `<div class="legend-row"><span class="swatch" style="background:${hexCss(e.hex)}"></span>` +
      `<span class="legend-name" title="${e.name}">${pretty(e.name)}</span>` +
      `<span class="legend-count">${e.count.toLocaleString('de-DE')}</span></div>`
    ).join('');
  }

  async function openFile(file) {
    if (!file) return;
    try {
      toast('Lade ' + file.name + ' …', false, 60000);
      const buf = await file.arrayBuffer();
      const schem = await Schematic.load(buf);
      await show(schem, file.name);
      DB.set('file', { name: file.name, buf }).then(() => setSource('file')).catch(() => {});
      toast(file.name + ' geladen');
    } catch (err) {
      console.error(err);
      toast(err.message || String(err), true);
    }
  }

  /* ---------- Türen / Falltüren / Zauntore bedienen ---------- */
  const USABLE = /_door$|_trapdoor$|_fence_gate$/;
  let refreshing = false, refreshAgain = false;

  async function refreshMesh() {
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    try {
      do {
        refreshAgain = false;
        const built = await Mesher.build(current.schem, atlas);
        clearGroup(modelGroup);
        addMeshes(modelGroup, built.cutout, built.translucent);
        current.built = built;
        measure.infos = built.infos;
        physics.infos = built.infos;
        applyCap();
      } while (refreshAgain);
    } catch (err) { console.error(err); toast(err.message || String(err), true); }
    finally { refreshing = false; }
  }

  function setOpen(schem, x, y, z) {
    const idx = x + z * schem.width + y * schem.width * schem.length;
    const st = schem.palette[schem.blocks[idx]];
    const props = Object.assign({}, st.props, { open: st.props && st.props.open === 'true' ? 'false' : 'true' });
    let pi = schem.palette.findIndex(p => p.name === st.name && JSON.stringify(Object.entries(p.props || {}).sort()) === JSON.stringify(Object.entries(props).sort()));
    if (pi < 0) { schem.palette.push({ name: st.name, props }); pi = schem.palette.length - 1; }
    schem.blocks[idx] = pi;
    return props;
  }

  function useBlock(hit) {
    if (!hit || !current) return;
    const s = current.schem;
    const st = s.palette[s.blocks[hit.x + hit.z * s.width + hit.y * s.width * s.length]];
    const name = st.name.replace(/^minecraft:/, '');
    if (!USABLE.test(name)) return;

    const props = setOpen(s, hit.x, hit.y, hit.z);
    // Türen bestehen aus zwei Hälften – die andere muss mitschalten
    if (/_door$/.test(name)) {
      const oy = (st.props && st.props.half === 'upper') ? hit.y - 1 : hit.y + 1;
      if (oy >= 0 && oy < s.height) {
        const other = s.palette[s.blocks[hit.x + hit.z * s.width + oy * s.width * s.length]];
        if (other && other.name === st.name) setOpen(s, hit.x, oy, hit.z);
      }
    }
    toast(`${name.replace(/_/g, ' ')}: ${props.open === 'true' ? 'geöffnet' : 'geschlossen'}`, false, 900);
    refreshMesh();
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
  let REACH = 4; // Reichweite im Flugmodus in Blöcken (per Regler einstellbar)
  function pick(ev, fromCenter, maxDist = 0) {
    const r = rayFrom(ev, fromCenter);
    const hit = measure.raycast(r.origin, r.direction);
    if (hit && maxDist > 0 && hit.t > maxDist) return null;
    return hit;
  }

  controls.onInteract = (ev, fromCenter) => { if (controls.fly && fromCenter) useBlock(pick(ev, true, REACH)); }; // nur im Flugmodus

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
  // Abmelden: Konto-Sitzung beim Server beenden, gespeicherten Zugangsschlüssel vergessen, neu laden
  if ($('btnLogout')) {
    if (window.__SV_USER) $('btnLogout').textContent = 'Abmelden (' + window.__SV_USER + ')';
    $('btnLogout').onclick = async () => {
      try {
        if (window.__SV_USER && typeof fetch === 'function') {
          await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        }
      } catch (e) {}
      for (const st of [window.localStorage, window.sessionStorage]) { try { st.removeItem('sv-access'); } catch (e) {} }
      location.reload();
    };
  }

  $('btnOpen').onclick = () => $('fileInput').click();
  $('fileInput').onchange = e => { openFile(e.target.files[0]); e.target.value = ''; };
  $('btnDemo').onclick = () => { setSource('demo'); show(Schematic.demo(), 'Demo-Haus'); };
  $('btnClear').onclick = () => { setSource('empty'); show(Schematic.empty(32, 16, 32), 'Leere Fläche 32×32'); };
  $('btnReset').onclick = resetView;
  $('btnFly').onclick = () => controls.setFly(!controls.fly);
  $('btnMeasure').onclick = () => setMeasureMode(!controls.measureMode);
  $('sliceY').oninput = updateSlice;
  $('chkGrid').onchange = e => { if (grid) grid.visible = e.target.checked; if (northMark) northMark.visible = e.target.checked; settings.grid = e.target.checked; saveSettings(); };
  $('chkAxes').onchange = e => { axes.visible = e.target.checked; settings.axes = e.target.checked; saveSettings(); };
  $('chkWire').onchange = e => { matCut.wireframe = matTrans.wireframe = e.target.checked; settings.wire = e.target.checked; saveSettings(); };

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

  // Reichweite (nur Flugmodus)
  const reachEl = $('reach');
  try { const saved = localStorage.getItem('sv-reach'); if (saved) reachEl.value = saved; } catch (e) {}
  const applyReach = () => {
    REACH = +reachEl.value;
    $('reachVal').textContent = REACH;
    try { localStorage.setItem('sv-reach', reachEl.value); } catch (e) {}
  };
  reachEl.oninput = applyReach;
  applyReach();

  // Texturversion (gespeicherte Auswahl, außer die URL gibt ?mc= vor)
  if (!new URLSearchParams(location.search).get('mc') && settings.version && CONFIG.VERSIONS.includes(settings.version)) {
    CONFIG.version = settings.version;
    Assets.setVersion(settings.version);
  }
  const sel = $('selVersion');
  CONFIG.VERSIONS.forEach(v => sel.add(new Option(v, v)));
  sel.value = CONFIG.version;
  sel.onchange = () => {
    settings.version = sel.value; saveSettings();
    CONFIG.version = sel.value;
    Assets.setVersion(sel.value);
    Models.reset();
    atlas.dispose();
    atlas = new Atlas();
    matCut.map = matTrans.map = atlas.texture;
    matCut.needsUpdate = matTrans.needsUpdate = true;
    if (current) show(current.schem, current.label);
  };

  const flyLabel = () => {
    $('btnFly').textContent = controls.fly ? (controls.walk ? 'Gehmodus: an' : 'Flugmodus: an') : 'Flugmodus: aus';
  };
  controls.onWalkChange = walk => {
    flyLabel();
    toast(walk ? 'Schwerkraft an – Leertaste springt, Doppel-Leertaste = wieder fliegen' : 'Flugmodus – Doppel-Leertaste = Schwerkraft', false, 1800);
  };

  let speedToastT = 0;
  controls.onSpeedChange = v => {
    const now = performance.now();
    if (now - speedToastT > 120) { speedToastT = now; toast(`Lauftempo: ${v.toFixed(1)} Blöcke/s (×${(v / 4.317).toFixed(1)})`, false, 900); }
  };

  controls.onFlyChange = on => {
    flyLabel();
    $('btnFly').classList.toggle('active', on);
    document.body.classList.toggle('flying', on);
    document.body.classList.toggle('orbit', !on);
    measure.setHover(null);
  };
  document.body.classList.add('orbit');

  window.addEventListener('keydown', e => {
    if (/input|textarea|select/i.test(e.target.tagName)) return;
    // Pfeiltasten links/rechts: Ebenen-Regler runter/hoch (ohne vorher auf den Regler zu klicken)
    if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const sl = $('sliceY');
      if (!sl.disabled) {
        e.preventDefault();
        sl.value = +sl.value + (e.code === 'ArrowRight' ? 1 : -1);
        updateSlice();
      }
    }
    if (e.code === 'KeyF') controls.setFly(!controls.fly);
    if (e.code === 'KeyR') resetView();
    // Z (nach aufgedrucktem Zeichen, damit es auch auf QWERTZ-Tastaturen funktioniert) oder C: Auswahl zurücksetzen
    if (((e.key && e.key.toLowerCase() === 'z') || e.code === 'KeyC') && !e.ctrlKey && !e.altKey && !e.metaKey) measure.clear();
    if (e.code === 'KeyM') setMeasureMode(!controls.measureMode);
    if (e.code === 'KeyX' && controls.fly) useBlock(pick(null, true, REACH)); // benutzen ohne Rechtsklick (nur Flugmodus)
  });
  window.addEventListener('keyup', e => {
    if ((e.code === 'AltLeft' || e.code === 'AltRight') && !controls.measureMode) measure.setHover(null);
  });

  let lastMouse = null;
  canvas.addEventListener('pointermove', e => { lastMouse = { clientX: e.clientX, clientY: e.clientY }; });

  // Alt gehalten -> normaler Mauszeiger statt Hand
  const setAlt = on => document.body.classList.toggle('alt', on);
  window.addEventListener('keydown', e => { if (e.code === 'AltLeft' || e.code === 'AltRight') setAlt(true); });
  window.addEventListener('keyup', e => { if (e.code === 'AltLeft' || e.code === 'AltRight') setAlt(false); });
  window.addEventListener('blur', () => setAlt(false));

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

  // Leistenhöhe messen (die Leiste bricht auf schmalen Fenstern / dem iPad in mehrere Zeilen um)
  const toolbar = $('toolbar');
  const syncToolbar = () => document.documentElement.style.setProperty('--tb', toolbar.offsetHeight + 'px');
  if (window.ResizeObserver) new ResizeObserver(syncToolbar).observe(toolbar);
  window.addEventListener('resize', syncToolbar);
  syncToolbar();

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

    // Flugmodus: anvisierter Block bekommt eine Outline
    if (controls.fly && current && now - flyHoverT > 30) {
      flyHoverT = now;
      if (controls.keys.AltLeft || controls.keys.AltRight || controls.measureMode) {
        measure.setHover(pick(null, true), true);                 // Messen: unbegrenzte Reichweite + Name
      } else {
        measure.setHover(pick(null, true, REACH), false);         // normal: 4 Blöcke Reichweite, nur Outline
      }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // gespeicherte Einstellungen anwenden
  for (const [id, key] of [['chkGrid', 'grid'], ['chkAxes', 'axes'], ['chkWire', 'wire']]) {
    if (typeof settings[key] === 'boolean') { $(id).checked = settings[key]; $(id).onchange({ target: $(id) }); }
  }
  for (const [id, key] of [['legendBox', 'legendOpen'], ['helpBox', 'helpOpen']]) {
    const el = $(id);
    el.open = !!settings[key];
    el.addEventListener('toggle', () => { settings[key] = el.open; saveSettings(); });
  }

  // zuletzt geöffnetes Schematic wiederherstellen
  (async () => {
    if (settings.source === 'file') {
      try {
        const rec = await DB.get('file');
        if (rec && rec.buf) {
          const schem = await Schematic.load(rec.buf);
          await show(schem, rec.name);
          return;
        }
      } catch (e) { console.warn('Wiederherstellen fehlgeschlagen', e); }
    }
    if (settings.source === 'empty') show(Schematic.empty(32, 16, 32), 'Leere Fläche 32×32');
    else show(Schematic.demo(), 'Demo-Haus');
  })();
})();
