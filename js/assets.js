/*
 * Assets: lädt Blockstates / Modelle / Texturen einzeln aus der Quelle (mit Fallback + Cache).
 * Atlas:  packt nur die tatsächlich benötigten Texturen in EIN Canvas (mit Randpixeln gegen Flackern/Bluten).
 */
const Assets = (() => {
  let version = CONFIG.version;
  let jsonMemo = new Map();
  let imgMemo = new Map();
  let active = 0;
  const waiting = [];
  const stats = { requests: 0, missing: 0, failed: 0 };

  function slot() {
    return new Promise(res => {
      if (active < CONFIG.MAX_PARALLEL) { active++; res(); }
      else waiting.push(res);
    });
  }
  function release() {
    const next = waiting.shift();
    if (next) next(); else active--;
  }

  let cachePromise = null;
  function getCache() {
    if (typeof caches === 'undefined') return Promise.resolve(null);
    if (!cachePromise) cachePromise = caches.open('mc-assets-' + version).catch(() => null);
    return cachePromise;
  }

  /** Liefert eine Response oder null (404). Wirft bei komplettem Netzwerkfehler. */
  async function fetchRes(path) {
    await slot();
    try {
      stats.requests++;
      let lastErr = null;
      const cache = await getCache();
      for (const tpl of CONFIG.SOURCES) {
        const url = tpl.replace('{v}', version) + path;
        try {
          if (cache) {
            const hit = await cache.match(url);
            if (hit) return hit;
          }
          const r = await fetch(url);
          if (r.ok) {
            if (cache) cache.put(url, r.clone()).catch(() => {});
            return r;
          }
          if (r.status === 404) return null;
          lastErr = new Error('HTTP ' + r.status);
        } catch (e) { lastErr = e; }
      }
      stats.failed++;
      throw lastErr || new Error('Download fehlgeschlagen');
    } finally { release(); }
  }

  function json(path) {
    if (!jsonMemo.has(path)) {
      jsonMemo.set(path, (async () => {
        try {
          const r = await fetchRes(path);
          if (!r) { stats.missing++; return null; }
          return JSON.parse(await r.text());
        } catch (e) { return null; }
      })());
    }
    return jsonMemo.get(path);
  }

  function image(path) {
    if (!imgMemo.has(path)) {
      imgMemo.set(path, (async () => {
        try {
          const r = await fetchRes(path);
          if (!r) { stats.missing++; return null; }
          const blob = await r.blob();
          if (typeof createImageBitmap === 'function') return await createImageBitmap(blob);
          return await new Promise((res, rej) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = rej;
            img.src = URL.createObjectURL(blob);
          });
        } catch (e) { return null; }
      })());
    }
    return imgMemo.get(path);
  }

  return {
    json, image, stats,
    get version() { return version; },
    setVersion(v) {
      version = v;
      jsonMemo = new Map(); imgMemo = new Map(); cachePromise = null;
      stats.requests = stats.missing = stats.failed = 0;
    }
  };
})();


// javascript-obfuscator:disable  (Atlas.uv() wird pro Vertex aufgerufen)
class Atlas {
  constructor() {
    this.size = CONFIG.ATLAS_SIZE;
    this.tile = CONFIG.TILE;
    this.cell = this.tile + 2;                      // 1px Rand rundherum
    this.cols = Math.floor(this.size / this.cell);
    this.occ = new Uint8Array(this.cols * this.cols); // belegte Zellen
    this.cursor = 0;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.ctx.imageSmoothingEnabled = false;
    this.entries = new Map();   // key -> {px, py, w, h, alpha, missing?}
    this.pending = new Map();

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
  }

  /** Belegt einen Block aus cw x ch Zellen und liefert die linke obere Zelle. */
  _alloc(cw, ch) {
    const cols = this.cols;
    if (cw === 1 && ch === 1) {
      for (let i = this.cursor; i < this.occ.length; i++) {
        if (!this.occ[i]) { this.occ[i] = 1; this.cursor = i + 1; return { cx: i % cols, cy: Math.floor(i / cols) }; }
      }
      throw new Error('Textur-Atlas voll');
    }
    for (let cy = 0; cy + ch <= cols; cy++) for (let cx = 0; cx + cw <= cols; cx++) {
      let free = true;
      for (let y = 0; y < ch && free; y++) for (let x = 0; x < cw; x++) if (this.occ[(cy + y) * cols + cx + x]) { free = false; break; }
      if (!free) continue;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) this.occ[(cy + y) * cols + cx + x] = 1;
      return { cx, cy };
    }
    throw new Error('Textur-Atlas voll');
  }

  _fillColor(key, hex, missing = false) {
    const { cx, cy } = this._alloc(1, 1);
    const px = cx * this.cell + 1, py = cy * this.cell + 1, t = this.tile;
    this.ctx.fillStyle = '#' + hex.padStart(6, '0');
    this.ctx.fillRect(px - 1, py - 1, t + 2, t + 2);
    this.entries.set(key, { px, py, w: t, h: t, alpha: false, missing });
  }

  /** Zeichnet src (sw x sh) in eine tw x th große Fläche des Atlas (mit extrudiertem Rand). */
  _put(key, src, sw, sh, tw, th) {
    const { cx, cy } = this._alloc(Math.ceil((tw + 2) / this.cell), Math.ceil((th + 2) / this.cell));
    const px = cx * this.cell + 1, py = cy * this.cell + 1;
    const ctx = this.ctx;
    ctx.clearRect(px - 1, py - 1, tw + 2, th + 2);
    ctx.drawImage(src, 0, 0, sw, sh, px, py, tw, th);
    // Randpixel extrudieren (verhindert Bluten / Flackern an Kanten)
    ctx.drawImage(src, 0, 0, 1, sh, px - 1, py, 1, th);
    ctx.drawImage(src, sw - 1, 0, 1, sh, px + tw, py, 1, th);
    ctx.drawImage(src, 0, 0, sw, 1, px, py - 1, tw, 1);
    ctx.drawImage(src, 0, sh - 1, sw, 1, px, py + th, tw, 1);
    ctx.drawImage(src, 0, 0, 1, 1, px - 1, py - 1, 1, 1);
    ctx.drawImage(src, sw - 1, 0, 1, 1, px + tw, py - 1, 1, 1);
    ctx.drawImage(src, 0, sh - 1, 1, 1, px - 1, py + th, 1, 1);
    ctx.drawImage(src, sw - 1, sh - 1, 1, 1, px + tw, py + th, 1, 1);

    const d = ctx.getImageData(px, py, tw, th).data;
    let alpha = false;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { alpha = true; break; }
    this.entries.set(key, { px, py, w: tw, h: th, alpha });
    this.texture.needsUpdate = true;
  }

  /** Eigenes Bild / Canvas in Originalgröße (Banner, Skins ...) ablegen. */
  addImage(key, img, w = img.width, h = img.height) {
    if (!this.entries.has(key)) this._put(key, img, w, h, w, h);
  }

  /** Stellt sicher, dass alle Keys im Atlas sind. Key = "block/stone", "color:RRGGBB" oder "entity/..." (Originalgröße). */
  async ensure(keys) {
    const jobs = [];
    for (const key of new Set(keys)) {
      if (this.entries.has(key)) continue;
      if (this.pending.has(key)) { jobs.push(this.pending.get(key)); continue; }
      const p = (async () => {
        if (key.startsWith('color:')) { this._fillColor(key, key.slice(6)); return; }
        const img = await Assets.image('textures/' + key + '.png');
        if (!img) { this._fillColor(key, 'ff00ff', true); return; }
        if (key.startsWith('entity/')) this._put(key, img, img.width, img.height, img.width, img.height);
        else {
          const sw = img.width, sh = Math.min(img.width, img.height); // nur 1. Frame bei Animationen
          // größere Texturen (z. B. 32x32-Schilder ab 26.x) in Originalauflösung ablegen, sonst werden sie verwaschen
          if (sw > this.tile) this._put(key, img, sw, sh, sw, sh);
          else this._put(key, img, sw, sh, this.tile, this.tile);
        }
      })();
      this.pending.set(key, p);
      jobs.push(p);
    }
    await Promise.all(jobs);
    this.pending.clear();
    this.texture.needsUpdate = true;
  }

  hasAlpha(key) { const e = this.entries.get(key); return !e || e.alpha; }

  /** u,v in 0..16 (Modell-Raum, v von oben, bezogen auf die ganze Textur) -> Atlas-UV */
  uv(key, u, v, out) {
    const e = this.entries.get(key);
    out.push((e.px + (u / 16) * e.w) / this.size,
             1 - (e.py + (v / 16) * e.h) / this.size);
  }

  dispose() { this.texture.dispose(); }
}
// javascript-obfuscator:enable
