/*
 * Messwerkzeug (wie bei Litematica):
 *   Alt + Linksklick  = Punkt A      Alt + Rechtsklick = Punkt B
 *   - gleicher Block        -> Einzelblock
 *   - Linie  (1 Achse > 1)  -> Länge
 *   - Fläche (2 Achsen > 1) -> Länge × Breite + Blockanzahl
 *   - Quader (3 Achsen > 1) -> Maße + Volumen + Blockanzahl
 */
class Measure {
  constructor(scene, panel, hoverLabel) {
    this.scene = scene;
    this.panel = panel;
    this.hoverLabel = hoverLabel;
    this.schem = null;
    this.infos = null;
    this.maxY = 1e9;
    this.A = null;
    this.B = null;

    const outline = (color, depthTest = false) => {
      const m = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
        new THREE.LineBasicMaterial({ color, depthTest, transparent: true })
      );
      m.renderOrder = 20; m.visible = false;
      scene.add(m);
      return m;
    };
    const fill = (color, opacity) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
      );
      m.renderOrder = 15; m.visible = false;
      scene.add(m);
      return m;
    };
    this.boxA = outline(0x3ddc84);
    this.boxB = outline(0xff6b4a);
    this.boxHover = outline(0xffffff, true);
    this.region = outline(0x4aa3ff);
    this.regionFill = fill(0x4aa3ff, 0.16);
    this.fillA = fill(0x3ddc84, 0.25);
    this.fillB = fill(0xff6b4a, 0.25);

    panel.addEventListener('click', e => {
      const a = e.target.dataset && e.target.dataset.action;
      if (a === 'clear') this.clear();
      if (a === 'copy') navigator.clipboard && navigator.clipboard.writeText(this.text());
    });
    this.render();
  }

  setModel(schem, infos) {
    this.schem = schem;
    this.infos = infos;
    this.clear();
  }

  setMaxY(v) { this.maxY = v; }

  /* ---------- Raycast durch das Voxelgitter (3D-DDA) ---------- */
  raycast(origin, dir) {
    const s = this.schem;
    if (!s) return null;
    const dim = [s.width, s.height, s.length];
    const o = [origin.x, origin.y, origin.z];
    const d = [dir.x, dir.y, dir.z];

    let tmin = 0, tmax = 1e9;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) { if (o[a] < 0 || o[a] > dim[a]) return null; continue; }
      let t1 = (0 - o[a]) / d[a], t2 = (dim[a] - o[a]) / d[a];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    const t0 = tmin + 1e-5;
    const cell = [0, 0, 0], step = [0, 0, 0], tDelta = [0, 0, 0], tMax = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      cell[a] = Math.min(dim[a] - 1, Math.max(0, Math.floor(o[a] + d[a] * t0)));
      if (d[a] === 0) { step[a] = 0; tDelta[a] = tMax[a] = Infinity; continue; }
      step[a] = d[a] > 0 ? 1 : -1;
      tDelta[a] = Math.abs(1 / d[a]);
      tMax[a] = ((d[a] > 0 ? cell[a] + 1 : cell[a]) - o[a]) / d[a];
    }

    const limit = dim[0] + dim[1] + dim[2] + 6;
    for (let i = 0; i < limit; i++) {
      const [x, y, z] = cell;
      if (y < this.maxY) {
        const info = this.infos[s.blocks[x + z * s.width + y * s.width * s.length]];
        if (info && !info.skip && info.bounds) {
          const b = info.bounds;
          let near = -1e9, far = 1e9, hit = true;
          for (let a = 0; a < 3; a++) {
            const lo = cell[a] + b[a], hi = cell[a] + b[a + 3];
            if (Math.abs(d[a]) < 1e-12) { if (o[a] < lo || o[a] > hi) { hit = false; break; } continue; }
            let t1 = (lo - o[a]) / d[a], t2 = (hi - o[a]) / d[a];
            if (t1 > t2) [t1, t2] = [t2, t1];
            near = Math.max(near, t1); far = Math.min(far, t2);
          }
          if (hit && near <= far && far >= 0) return { x, y, z, t: Math.max(near, 0), b };
        }
      }
      const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      cell[a] += step[a];
      tMax[a] += tDelta[a];
      if (cell[a] < 0 || cell[a] >= dim[a]) return null;
    }
    return null;
  }

  /* ---------- Auswahl ---------- */
  setA(c) { this.A = c; this.update(); }
  setB(c) { this.B = c; this.update(); }
  clear() { this.A = this.B = null; this.update(); }

  /** Hover-Outline. Mit c.b (Block-Bounds) wird die echte Form umrandet (Tür, Treppe, Fackel ...). */
  setHover(c, showLabel = true) {
    if (!c) { this.boxHover.visible = false; this.hoverLabel.style.display = 'none'; return; }
    if (c.b) {
      const b = c.b, pad = 0.004;
      this.boxHover.position.set(c.x + (b[0] + b[3]) / 2, c.y + (b[1] + b[4]) / 2, c.z + (b[2] + b[5]) / 2);
      this.boxHover.scale.set(b[3] - b[0] + pad * 2, b[4] - b[1] + pad * 2, b[5] - b[2] + pad * 2);
      this.boxHover.visible = true;
    } else {
      this._place(this.boxHover, [c.x, c.y, c.z], [c.x, c.y, c.z], 0.01);
    }
    this.hoverLabel.style.display = showLabel ? 'block' : 'none';
    if (showLabel) this.hoverLabel.textContent = `${this.blockName(c)}  (${c.x}, ${c.y}, ${c.z})`;
  }

  _place(obj, a, b, pad = 0) {
    const min = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
    const max = [Math.max(a[0], b[0]) + 1, Math.max(a[1], b[1]) + 1, Math.max(a[2], b[2]) + 1];
    obj.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    obj.scale.set(max[0] - min[0] + pad * 2, max[1] - min[1] + pad * 2, max[2] - min[2] + pad * 2);
    obj.visible = true;
  }

  update() {
    const { A, B } = this;
    this.boxA.visible = this.fillA.visible = !!A;
    this.boxB.visible = this.fillB.visible = !!B;
    this.region.visible = this.regionFill.visible = !!(A && B);
    if (A) { this._place(this.boxA, [A.x, A.y, A.z], [A.x, A.y, A.z], 0.012); this._place(this.fillA, [A.x, A.y, A.z], [A.x, A.y, A.z], 0.006); }
    if (B) { this._place(this.boxB, [B.x, B.y, B.z], [B.x, B.y, B.z], 0.012); this._place(this.fillB, [B.x, B.y, B.z], [B.x, B.y, B.z], 0.006); }
    if (A && B) {
      this._place(this.region, [A.x, A.y, A.z], [B.x, B.y, B.z], 0.02);
      this._place(this.regionFill, [A.x, A.y, A.z], [B.x, B.y, B.z], 0.015);
    }
    this.render();
  }

  blockName(c) {
    const s = this.schem;
    if (!s) return '';
    const st = s.palette[s.blocks[c.x + c.z * s.width + c.y * s.width * s.length]];
    return st ? st.name.replace(/^minecraft:/, '') : '?';
  }

  /* ---------- Auswertung ---------- */
  analyse() {
    const { A, B, schem: s } = this;
    if (!A || !B || !s) return null;
    const min = [Math.min(A.x, B.x), Math.min(A.y, B.y), Math.min(A.z, B.z)];
    const max = [Math.max(A.x, B.x), Math.max(A.y, B.y), Math.max(A.z, B.z)];
    const size = [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1];
    const axes = ['X', 'Y', 'Z'];
    const big = [0, 1, 2].filter(i => size[i] > 1);
    const positions = size[0] * size[1] * size[2];

    let solid = 0;
    const mats = new Map();
    for (let y = min[1]; y <= max[1]; y++) for (let z = min[2]; z <= max[2]; z++) for (let x = min[0]; x <= max[0]; x++) {
      const info = this.infos[s.blocks[x + z * s.width + y * s.width * s.length]];
      if (!info || info.skip) continue;
      solid++;
      mats.set(info.name, (mats.get(info.name) || 0) + 1);
    }
    const dist = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
    return { min, max, size, axes, big, positions, solid, mats, dist };
  }

  describe(r) {
    const n = v => v.toLocaleString('de-DE');
    if (r.big.length === 0) return { kind: 'Einzelblock', lines: [`Beide Punkte liegen auf demselben Block.`] };
    if (r.big.length === 1) {
      const i = r.big[0];
      return { kind: 'Linie', lines: [`Länge: <b>${n(r.size[i])}</b> Blöcke (Achse ${r.axes[i]})`, `Blöcke (ohne Luft): ${n(r.solid)}`] };
    }
    if (r.big.length === 2) {
      const [i, j] = r.big; // Reihenfolge X, Y, Z
      const long = r.size[i] >= r.size[j] ? i : j, short = long === i ? j : i;
      const plane = r.big.includes(1) ? 'senkrecht' : 'waagerecht';
      return {
        kind: `Fläche (${plane}, ${r.axes[i]}×${r.axes[j]})`,
        lines: [
          `Länge × Breite: <b>${n(r.size[long])} × ${n(r.size[short])}</b>  (${r.axes[long]} × ${r.axes[short]})`,
          `Positionen: <b>${n(r.positions)}</b>`,
          `Blöcke (ohne Luft): <b>${n(r.solid)}</b>`
        ]
      };
    }
    return {
      kind: 'Quader',
      lines: [
        `Maße: <b>${n(r.size[0])} × ${n(r.size[1])} × ${n(r.size[2])}</b>  (X × Y × Z)`,
        `Volumen: <b>${n(r.positions)}</b>`,
        `Blöcke (ohne Luft): <b>${n(r.solid)}</b>`
      ]
    };
  }

  text() {
    const r = this.analyse();
    const p = c => c ? `(${c.x}, ${c.y}, ${c.z}) ${this.blockName(c)}` : '–';
    let t = `A: ${p(this.A)}\nB: ${p(this.B)}\n`;
    if (r) {
      const d = this.describe(r);
      t += d.kind + '\n' + d.lines.map(l => l.replace(/<[^>]+>/g, '')).join('\n');
      t += '\nLuftlinie: ' + r.dist.toFixed(2);
      if (r.big.length > 1) t += '\n' + [...r.mats.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}× ${k}`).join('\n');
    }
    return t;
  }

  render() {
    const { A, B } = this;
    const fmt = (c, cls) => c
      ? `<span class="pt ${cls}">${cls === 'a' ? 'A' : 'B'}</span> ${c.x}, ${c.y}, ${c.z} <span class="muted">${this.blockName(c).replace(/_/g, ' ')}</span>`
      : `<span class="pt ${cls} off">${cls === 'a' ? 'A' : 'B'}</span> <span class="muted">${cls === 'a' ? 'Alt + Linksklick' : 'Alt + Rechtsklick'}</span>`;

    let html = `<h3>Messen</h3><div class="row">${fmt(A, 'a')}</div><div class="row">${fmt(B, 'b')}</div>`;
    const r = this.analyse();
    if (r) {
      const d = this.describe(r);
      html += `<div class="result"><div class="kind">${d.kind}</div>${d.lines.map(l => `<div>${l}</div>`).join('')}` +
              `<div class="muted">Δ ${r.size[0] - 1}, ${r.size[1] - 1}, ${r.size[2] - 1} · Luftlinie ${r.dist.toFixed(2)}</div></div>`;
      if (r.big.length > 1 && r.mats.size) {
        const rows = [...r.mats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
          .map(([k, v]) => `<div class="mat"><span class="mn">${k.replace(/_/g, ' ')}</span><span class="muted">${v.toLocaleString('de-DE')}</span></div>`).join('');
        html += `<div class="mats">${rows}</div>`;
      }
    }
    if (A || B) html += `<div class="btns"><button data-action="clear" title="Taste Z">Zurücksetzen (Z)</button><button data-action="copy">Kopieren</button></div>`;
    this.panel.innerHTML = html;
  }
}
