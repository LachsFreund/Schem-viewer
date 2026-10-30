// javascript-obfuscator:disable  (Kollisionsabfragen im Gehmodus: String-Array-Verschleierung würde das ~50x langsamer machen)
/* Kollisionsabfrage gegen die Blöcke des Schematics (für den Gehmodus). */
class Physics {
  constructor() { this.schem = null; this.infos = null; this.maxY = 1e9; }

  setModel(schem, infos) { this.schem = schem; this.infos = infos; }

  /** true, wenn die Box [mn, mx] einen kollidierenden Block berührt. */
  collides(mn, mx) {
    const s = this.schem;
    if (!s) return false;
    const e = 1e-4;
    const x0 = Math.max(0, Math.floor(mn[0] + e)), x1 = Math.min(s.width - 1, Math.floor(mx[0] - e));
    const y0 = Math.max(0, Math.floor(mn[1] + e)), y1 = Math.min(s.height - 1, Math.floor(mx[1] - e));
    const z0 = Math.max(0, Math.floor(mn[2] + e)), z1 = Math.min(s.length - 1, Math.floor(mx[2] - e));
    for (let y = y0; y <= y1; y++) {
      if (y >= this.maxY) break; // ausgeblendete Ebenen sind nicht solide
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const info = this.infos[s.blocks[x + z * s.width + y * s.width * s.length]];
        if (!info || info.skip || !info.collide) continue;
        for (const b of info.boxes) {
          if (mn[0] < x + b[3] - e && mx[0] > x + b[0] + e &&
              mn[1] < y + b[4] - e && mx[1] > y + b[1] + e &&
              mn[2] < z + b[5] - e && mx[2] > z + b[2] + e) return true;
        }
      }
    }
    return false;
  }
}

// javascript-obfuscator:enable
