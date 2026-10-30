// javascript-obfuscator:disable  (Mesher: Schleifen über Millionen Blöcke: String-Array-Verschleierung würde das ~50x langsamer machen)
/*
 * Mesher: Schematic + Atlas -> Three.js-Geometrien.
 *  - echte Minecraft-Modelle (siehe models.js), Faces mit cullface werden gegen Nachbarn entfernt
 *  - zwei Meshes: "cutout" (alphaTest) und "translucent" (Wasser, gefärbtes Glas, Eis ...)
 *  - cap(y): erzeugt nachträglich die Oberseiten einer Ebene, die sonst weggeculled wären (Layer-Slider)
 */
const Mesher = (() => {
  const DIRV = Models.DIRV;

  class Buf {
    constructor() { this.pos = []; this.uv = []; this.col = []; this.layer = []; this.idx = []; this.n = 0; }
    geometry() {
      if (!this.n) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      g.setAttribute('aLayer', new THREE.Float32BufferAttribute(this.layer, 1));
      g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
      g.computeBoundingSphere();
      return g;
    }
  }

  function emit(buf, q, x, y, z, atlas) {
    const base = buf.n;
    let r = q.shade, g = q.shade, b = q.shade;
    if (q.tint >= 0) {
      r *= ((q.tint >> 16) & 255) / 255;
      g *= ((q.tint >> 8) & 255) / 255;
      b *= (q.tint & 255) / 255;
    }
    for (let i = 0; i < 4; i++) {
      buf.pos.push(q.p[i * 3] / 16 + x, q.p[i * 3 + 1] / 16 + y, q.p[i * 3 + 2] / 16 + z);
      atlas.uv(q.tex, q.uv[i * 2], q.uv[i * 2 + 1], buf.uv);
      buf.col.push(r, g, b);
      buf.layer.push(y);
    }
    // Ecken: 0=TL 1=TR 2=BR 3=BL  -> gegen den Uhrzeigersinn von außen
    buf.idx.push(base, base + 3, base + 2, base, base + 2, base + 1);
    buf.n += 4;
  }

  async function build(schem, atlas, onStatus) {
    const { width: W, height: H, length: L, palette, blocks } = schem;
    const say = onStatus || (() => {});

    say('Lade Blockmodelle …');
    const infos = await Promise.all(palette.map(st => Models.resolveState(st)));

    say('Lade Texturen …');
    const keys = [];
    for (const info of infos) for (const q of info.quads) keys.push(q.tex);
    await atlas.ensure(keys);

    // Banner & Köpfe (Block-Entities) mit echten Texturen vorbereiten
    try { await Special.prepare(schem, infos, atlas); } catch (err) { console.warn('Special-Blöcke:', err); schem.special = new Map(); }
    const sp = schem.special || new Map();

    for (const info of infos) {
      info.opaqueFull = !info.skip && !info.special && info.fullCube && !info.translucent &&
                        info.fullKeys.every(k => !atlas.hasAlpha(k));
      info.group = /leaves$/.test(info.name) ? 'leaves' : info.name;
    }

    say('Erzeuge Geometrie …');

    const infoAt = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= L)
      ? null : infos[blocks[x + z * W + y * W * L]];

    function culled(info, q, x, y, z) {
      if (q.cull < 0) return false;
      const d = DIRV[q.cull];
      const ni = infoAt(x + d[0], y + d[1], z + d[2]);
      if (!ni || ni.skip) return false;
      if (ni.opaqueFull) return true;
      return info.cullSame && ni.cullSame && ni.fullCube && ni.group === info.group;
    }

    const cut = new Buf(), trans = new Buf();
    const counts = new Map();
    let total = 0;

    for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
      const pi = blocks[x + z * W + y * W * L];
      const info = infos[pi];
      if (!info || info.skip) continue;
      total++;
      counts.set(info.name, (counts.get(info.name) || 0) + 1);
      const buf = info.translucent ? trans : cut;
      const quads = (info.special && sp.get(x + z * W + y * W * L)) || info.quads;
      for (const q of quads) {
        if (culled(info, q, x, y, z)) continue;
        emit(buf, q, x, y, z, atlas);
      }
    }

    const legend = [...counts.entries()]
      .map(([name, count]) => ({ name, count, hex: BlockColors.get(name) }))
      .sort((a, b) => b.count - a.count);

    /** Oberseiten der Ebene y, die durch den Block darüber weggeculled waren. */
    function cap(y) {
      if (y < 0 || y >= H) return null;
      const c = new Buf(), t = new Buf();
      for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
        const info = infos[blocks[x + z * W + y * W * L]];
        if (!info || info.skip || info.special) continue;
        for (const q of info.quads) {
          if (q.cull !== 1) continue;                 // nur "up"
          if (!culled(info, q, x, y, z)) continue;     // war ohnehin sichtbar
          emit(info.translucent ? t : c, q, x, y, z, atlas);
        }
      }
      return { cutout: c.geometry(), translucent: t.geometry() };
    }

    return {
      cutout: cut.geometry(),
      translucent: trans.geometry(),
      infos, cap,
      stats: { blocks: total, quads: (cut.n + trans.n) / 4, legend }
    };
  }

  return { build };
})();

// javascript-obfuscator:enable
