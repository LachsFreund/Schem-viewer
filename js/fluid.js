// javascript-obfuscator:disable  (rechnet pro Wasserblock – String-Array-Verschleierung würde das stark verlangsamen)
/*
 * Fluid: Wasser und Lava mit Füllständen, Eckhöhen, Gefälle und Strömungsrichtung – nachgebaut nach dem LiquidBlockRenderer des Spiels.
 *
 *  - Höhe eines Blocks: Quelle und fallendes Wasser 8/9, fließend (8 - level)/9; liegt gleiches Fluid darüber: 1,0
 *  - Eckhöhen der Oberfläche = gewichteter Mittelwert der Höhen der angrenzenden Blöcke (Quellen zählen 10-fach)
 *  - Oberseite: ohne Strömung "still"-Textur, mit Strömung "flow"-Textur, gedreht in Fließrichtung
 *  - Seiten: "flow"-Textur, nur sichtbar wenn der Nachbar weder gleiches Fluid noch ein voller Block ist
 *  - "Waterlogged"-Blöcke (Treppen, Zäune, Seegras, Kelp ...) enthalten eine Wasserquelle
 *
 * build() liefert Map(Blockindex -> { quads, trans, cap }); der Mesher benutzt sie statt des alten Wasser-Würfels.
 */
const Fluid = (() => {
  const KEYS = ['block/water_still', 'block/water_flow', 'block/lava_still', 'block/lava_flow'];
  const ALWAYS_WATER = /^(kelp|kelp_plant|seagrass|tall_seagrass|bubble_column)$/;
  const WATER_TINT = 0x3f76e4;
  const TEX = { 1: { still: 'block/water_still', flow: 'block/water_flow', tint: WATER_TINT },
                2: { still: 'block/lava_still', flow: 'block/lava_flow', tint: -1 } };

  /** null = keine Flüssigkeit in diesem Zustand; sonst { type: 'water'|'lava', own: Block ist selbst Fluid, level } */
  function kind(info) {
    if (!info || info.skip) return null;
    const n = info.name, p = info.props || {};
    if (n === 'water' || n === 'lava') return { type: n, own: true, level: parseInt(p.level, 10) || 0 };
    if (p.waterlogged === 'true' || ALWAYS_WATER.test(n)) return { type: 'water', own: false, level: 0 };
    return null;
  }

  function build(ctx) {
    const { W, H, L, blocks, infos } = ctx;
    const np = infos.length, LW = W * L;
    const fk = new Uint8Array(np), fl = new Uint8Array(np), fsolid = new Uint8Array(np), fopaque = new Uint8Array(np);
    let any = false;
    for (let i = 0; i < np; i++) {
      const info = infos[i], k = kind(info);
      if (k) { fk[i] = k.type === 'water' ? 1 : 2; fl[i] = Math.min(15, k.level); any = true; }
      fsolid[i] = info && !info.skip && info.collide ? 1 : 0;       // Kollision = "fest" (für Höhenberechnung der Nachbarn)
      fopaque[i] = info && info.opaqueFull ? 1 : 0;                  // verdeckt Flächen vollständig
    }
    if (!any) return null;

    const inB = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < W && y < H && z < L;
    const pidx = (x, y, z) => blocks[x + z * W + y * LW];
    const ownH = pi => { const lv = fl[pi]; return (lv === 0 || lv >= 8 ? 8 : 8 - lv) / 9; };

    // Höhe eines Nachbarblocks für Fluid kk: -1 = fest, 0 = Luft, sonst Fluidhöhe (1 wenn gleiches Fluid darüber)
    const hOf = (kk, xx, yy, zz) => {
      if (!inB(xx, yy, zz)) return 0;
      const q = pidx(xx, yy, zz);
      if (fk[q] === kk) return (inB(xx, yy + 1, zz) && fk[pidx(xx, yy + 1, zz)] === kk) ? 1 : ownH(q);
      return fsolid[q] ? -1 : 0;
    };
    const acc = [0, 0];
    const add = h => { if (h >= 0.8) { acc[0] += h * 10; acc[1] += 10; } else if (h >= 0) { acc[0] += h; acc[1] += 1; } };
    const avg = (kk, y, h0, h1, h2, dx, dz) => {
      if (h2 >= 1 || h1 >= 1) return 1;
      acc[0] = 0; acc[1] = 0;
      if (h2 > 0 || h1 > 0) { const f = hOf(kk, dx, y, dz); if (f >= 1) return 1; add(f); }
      add(h0); add(h1); add(h2);
      return acc[0] / acc[1];
    };
    const DIRS = [[0, -1], [0, 1], [1, 0], [-1, 0]];

    // gemeinsame, unveränderliche Objekte (spart Speicher bei großen Wasserflächen)
    const CAP = {}, EMPTY = {};
    for (const kk of [1, 2]) {
      const T = TEX[kk];
      CAP[kk] = { p: [].concat([0, 16, 0], [16, 16, 0], [16, 16, 16], [0, 16, 16]), n: [0, 1, 0], uv: [0, 0, 16, 0, 16, 16, 0, 16], tex: T.still, cull: -1, shade: 1.0, tint: T.tint };
      EMPTY[kk] = { quads: [], trans: kk === 1, cap: CAP[kk] };
    }

    const map = new Map();

    for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
      const i = x + z * W + y * LW, pi = blocks[i], kk = fk[pi];
      if (!kk) continue;
      const T = TEX[kk];
      const aboveSame = inB(x, y + 1, z) && fk[pidx(x, y + 1, z)] === kk;

      // Höhen / Strömung werden nur für die sichtbare Oberfläche und für Seitenflächen gebraucht
      const h0 = aboveSame ? 1 : ownH(pi);
      let hNW = 1, hNE = 1, hSW = 1, hSE = 1;
      if (h0 < 1) {
        const hn = hOf(kk, x, y, z - 1), hs = hOf(kk, x, y, z + 1), he = hOf(kk, x + 1, y, z), hw = hOf(kk, x - 1, y, z);
        hNE = avg(kk, y, h0, hn, he, x + 1, z - 1);
        hNW = avg(kk, y, h0, hn, hw, x - 1, z - 1);
        hSE = avg(kk, y, h0, hs, he, x + 1, z + 1);
        hSW = avg(kk, y, h0, hs, hw, x - 1, z + 1);
      }

      const quads = [];
      const Q = (c, uv, tex, shade) => quads.push({ p: [].concat(c[0], c[1], c[2], c[3]), n: [0, 1, 0], uv, tex, cull: -1, shade, tint: T.tint });

      // Oberseite (nur wenn kein gleiches Fluid darüber liegt) – dafür wird die Strömungsrichtung bestimmt (wie FlowingFluid.getFlow)
      if (!aboveSame) {
        let fx = 0, fz = 0;
        const self = ownH(pi);
        for (const [dx, dz] of DIRS) {
          const nx = x + dx, nz = z + dz;
          const nk = inB(nx, y, nz) ? fk[pidx(nx, y, nz)] : 0;
          if (nk !== 0 && nk !== kk) continue;                         // anderes Fluid beeinflusst die Strömung nicht
          let f = nk === kk ? ownH(pidx(nx, y, nz)) : 0, f1 = 0;
          if (f === 0) {
            if (!(inB(nx, y, nz) && fsolid[pidx(nx, y, nz)]) && inB(nx, y - 1, nz) && fk[pidx(nx, y - 1, nz)] === kk) {
              f = ownH(pidx(nx, y - 1, nz));
              if (f > 0) f1 = self - (f - 0.8888889);
            }
          } else if (f > 0) f1 = self - f;
          if (f1 !== 0) { fx += dx * f1; fz += dz * f1; }
        }
        const flowing = Math.abs(fx) > 1e-6 || Math.abs(fz) > 1e-6;

        const top = [[0, hNW * 16, 0], [16, hNE * 16, 0], [16, hSE * 16, 16], [0, hSW * 16, 16]];   // NW, NE, SE, SW  (TL, TR, BR, BL)
        let uv, tex;
        if (!flowing) { uv = [0, 0, 16, 0, 16, 16, 0, 16]; tex = T.still; }
        else {
          const a = Math.atan2(fz, fx) - Math.PI / 2, s = Math.sin(a) * 0.25, c = Math.cos(a) * 0.25;
          uv = [16 * (0.5 - c - s), 16 * (0.5 - c + s),      // NW
                16 * (0.5 + c - s), 16 * (0.5 - c - s),      // NE
                16 * (0.5 + c + s), 16 * (0.5 + c - s),      // SE
                16 * (0.5 - c + s), 16 * (0.5 + c + s)];     // SW
          tex = T.flow;
        }
        Q(top, uv, tex, 1.0);
        // Rückseite der Oberfläche (sichtbar von unter Wasser)
        quads.push({ p: [].concat(top[0], top[3], top[2], top[1]), n: [0, -1, 0], uv: [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]], tex, cull: -1, shade: 1.0, tint: T.tint });
      }

      // Unterseite
      {
        let draw = true;
        if (inB(x, y - 1, z)) { const q = pidx(x, y - 1, z); if (fk[q] === kk || fopaque[q]) draw = false; }
        if (draw) Q([[0, 0, 16], [16, 0, 16], [16, 0, 0], [0, 0, 0]], [0, 0, 16, 0, 16, 16, 0, 16], T.still, 0.5);
      }

      // Seiten: Nachbar darf weder gleiches Fluid noch ein voller Block sein
      const side = (dx, dz, c, hA, hB, shade) => {
        const nx = x + dx, nz = z + dz;
        if (inB(nx, y, nz)) { const q = pidx(nx, y, nz); if (fk[q] === kk || fopaque[q]) return; }
        Q(c, [0, (1 - hA) * 8, 8, (1 - hB) * 8, 8, 8, 0, 8], T.flow, shade);
      };
      side(0, -1, [[16, hNE * 16, 0], [0, hNW * 16, 0], [0, 0, 0], [16, 0, 0]], hNE, hNW, 0.8);       // Norden
      side(0, 1,  [[0, hSW * 16, 16], [16, hSE * 16, 16], [16, 0, 16], [0, 0, 16]], hSW, hSE, 0.8);   // Süden
      side(1, 0,  [[16, hSE * 16, 16], [16, hNE * 16, 0], [16, 0, 0], [16, 0, 16]], hSE, hNE, 0.6);   // Osten
      side(-1, 0, [[0, hNW * 16, 0], [0, hSW * 16, 16], [0, 0, 16], [0, 0, 0]], hNW, hSW, 0.6);       // Westen

      // Deckel für den Ebenen-Regler: Oberseite, die sonst durch Wasser darüber fehlt
      map.set(i, quads.length ? { quads, trans: kk === 1, cap: aboveSame ? CAP[kk] : null } : EMPTY[kk]);
    }
    return map;
  }

  return { KEYS, kind, build };
})();
// javascript-obfuscator:enable
