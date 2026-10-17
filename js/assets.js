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


class Atlas {
  constructor() {
    this.size = CONFIG.ATLAS_SIZE;
    this.tile = CONFIG.TILE;
    this.cell = this.tile + 2;                      // 1px Rand rundherum
    this.cols = Math.floor(this.size / this.cell);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.ctx.imageSmoothingEnabled = false;
    this.entries = new Map();   // key -> {px, py, alpha}
    this.pending = new Map();
    this.next = 0;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
  }

  _slot() {
    const i = this.next++;
    if (i >= this.cols * this.cols) throw new Error('Textur-Atlas voll');
    return { px: (i % this.cols) * this.cell + 1, py: Math.floor(i / this.cols) * this.cell + 1 };
  }

  _fillColor(key, hex) {
    const { px, py } = this._slot();
    const ctx = this.ctx, t = this.tile;
    ctx.fillStyle = '#' + hex.padStart(6, '0');
    ctx.fillRect(px - 1, py - 1, t + 2, t + 2);
    this.entries.set(key, { px, py, alpha: false });
  }

  _draw(key, img) {
    const { px, py } = this._slot();
    const ctx = this.ctx, t = this.tile;
    const sw = img.width, sh = Math.min(img.width, img.height); // nur 1. Frame bei Animationen
    ctx.clearRect(px - 1, py - 1, t + 2, t + 2);
    ctx.drawImage(img, 0, 0, sw, sh, px, py, t, t);
    // Randpixel extrudieren
    ctx.drawImage(img, 0, 0, 1, sh, px - 1, py, 1, t);
    ctx.drawImage(img, sw - 1, 0, 1, sh, px + t, py, 1, t);
    ctx.drawImage(img, 0, 0, sw, 1, px, py - 1, t, 1);
    ctx.drawImage(img, 0, sh - 1, sw, 1, px, py + t, t, 1);
    ctx.drawImage(img, 0, 0, 1, 1, px - 1, py - 1, 1, 1);
    ctx.drawImage(img, sw - 1, 0, 1, 1, px + t, py - 1, 1, 1);
    ctx.drawImage(img, 0, sh - 1, 1, 1, px - 1, py + t, 1, 1);
    ctx.drawImage(img, sw - 1, sh - 1, 1, 1, px + t, py + t, 1, 1);

    const d = ctx.getImageData(px, py, t, t).data;
    let alpha = false;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { alpha = true; break; }
    this.entries.set(key, { px, py, alpha });
  }

  /** Stellt sicher, dass alle Keys im Atlas sind. Key = "block/stone" oder "color:RRGGBB". */
  async ensure(keys) {
    const jobs = [];
    for (const key of new Set(keys)) {
      if (this.entries.has(key)) continue;
      if (this.pending.has(key)) { jobs.push(this.pending.get(key)); continue; }
      const p = (async () => {
        if (key.startsWith('color:')) { this._fillColor(key, key.slice(6)); return; }
        const img = await Assets.image('textures/' + key + '.png');
        if (img) this._draw(key, img);
        else this._fillColor(key, 'ff00ff');
      })();
      this.pending.set(key, p);
      jobs.push(p);
    }
    await Promise.all(jobs);
    this.pending.clear();
    this.texture.needsUpdate = true;
  }

  hasAlpha(key) { const e = this.entries.get(key); return !e || e.alpha; }

  /** u,v in 0..16 (Modell-Raum, v von oben) -> Atlas-UV */
  uv(key, u, v, out) {
    const e = this.entries.get(key);
    out.push((e.px + (u / 16) * this.tile) / this.size,
             1 - (e.py + (v / 16) * this.tile) / this.size);
  }

  dispose() { this.texture.dispose(); }
}
