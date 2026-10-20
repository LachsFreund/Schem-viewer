/*
 * Models: übersetzt einen Block-Zustand (z.B. "oak_stairs[facing=north,half=top]") in fertige Quads,
 * genau wie Minecraft es tut: blockstates/*.json -> models/**.json (inkl. Parent-Vererbung),
 * Element-Rotation, Blockstate-Rotation (x/y), UVs, Tint, Cullfaces.
 *
 * Ergebnis pro Zustand:
 *  { name, skip, translucent, cullSame, quads[], bounds, fullKeys, fullCube, ... }
 *  quad = { p: [12 Zahlen, 0..16], uv: [8 Zahlen, 0..16], tex, cull: 0..5 | -1, shade, tint: 0xRRGGBB | -1 }
 */
const Models = (() => {
  const DIRN = ['down', 'up', 'north', 'south', 'west', 'east'];
  const DIRV = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  const DIRI = Object.fromEntries(DIRN.map((n, i) => [n, i]));

  const SKIP = /^(air|cave_air|void_air|structure_void|light|barrier|jigsaw|structure_block)$/;
  const TRANSLUCENT = /stained_glass|^water$|^ice$|^frosted_ice$|^tinted_glass$|slime_block|honey_block/;
  const CULL_SAME = /glass|^ice$|^water$|slime_block|honey_block|leaves$/;

  // Standardwerte für Eigenschaften, die in manchen Schematics fehlen
  const DEFAULT_PROPS = { shape: 'straight', waterlogged: 'false', open: 'false', powered: 'false', lit: 'false', snowy: 'false', type: 'bottom' };

  // Blöcke ohne Kollision (man läuft durch)
  const NO_COLLIDE = new RegExp([
    '(^|_)(torch|button|sign|banner|rail|rails|vine|vines|lever|tripwire|tripwire_hook|string|cobweb|ladder|sapling|kelp|seagrass|tall_seagrass|roots|sprouts|fern|grass|tulip|dandelion|poppy|orchid|allium|bluet|cornflower|daisy|lilac|peony|bush|mushroom|fungus|lily_pad|wheat|carrots|potatoes|beetroots|sugar_cane|candle|lantern|head|skull|pressure_plate|water|lava|bubble_column|fire|frogspawn|dead_bush|petals|redstone_wire|comparator|repeater|coral_fan|wall_coral_fan|leaf_litter|bamboo_sapling)$',
    'torch', '_button$', 'pressure_plate$', '_sign$', '_banner$', '_head$', '_skull$', 'coral_fan$', 'candle$', 'flower$'
  ].join('|'));

  const modelMemo = new Map();
  let stateMemo = new Map();

  /* ---------- Modelle laden (mit Parents) ---------- */
  function loadModel(id) {
    id = id.replace(/^minecraft:/, '');
    if (modelMemo.has(id)) return modelMemo.get(id);
    const p = (async () => {
      if (id.startsWith('builtin/')) return { textures: {}, elements: null };
      const j = await Assets.json('models/' + id + '.json');
      if (!j) return null;
      const parent = j.parent ? await loadModel(j.parent) : null;
      return {
        textures: Object.assign({}, parent ? parent.textures : {}, j.textures || {}),
        elements: j.elements || (parent && parent.elements) || null
      };
    })();
    modelMemo.set(id, p);
    return p;
  }

  function resolveTex(ref, tex) {
    let n = 0;
    while (typeof ref === 'string' && ref[0] === '#' && n++ < 12) ref = tex[ref.slice(1)];
    if (typeof ref !== 'string' || ref[0] === '#') return null;
    return ref.replace(/^minecraft:/, '');
  }

  /* ---------- Tint (Biom-Farben, Plains-Standard) ---------- */
  function tintFor(name) {
    if (/leaves$/.test(name)) {
      if (name.startsWith('birch')) return 0x80a755;
      if (name.startsWith('spruce')) return 0x619961;
      return 0x77ab2f;
    }
    if (name === 'water') return 0x3f76e4;
    if (name === 'lily_pad') return 0x208030;
    if (name === 'redstone_wire') return 0xc80000;
    if (/stem$/.test(name)) return 0xe0c71c;
    if (/vine$/.test(name)) return 0x77ab2f;
    return 0x91bd59;
  }

  /* ---------- Geometrie-Helfer ---------- */
  function faceCorners(dir, f, t) { // TL, TR, BR, BL – von außen betrachtet
    const [x1, y1, z1] = f, [x2, y2, z2] = t;
    switch (dir) {
      case 'north': return [[x2, y2, z1], [x1, y2, z1], [x1, y1, z1], [x2, y1, z1]];
      case 'south': return [[x1, y2, z2], [x2, y2, z2], [x2, y1, z2], [x1, y1, z2]];
      case 'east':  return [[x2, y2, z2], [x2, y2, z1], [x2, y1, z1], [x2, y1, z2]];
      case 'west':  return [[x1, y2, z1], [x1, y2, z2], [x1, y1, z2], [x1, y1, z1]];
      case 'up':    return [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]];
      default:      return [[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]]; // down
    }
  }

  function defaultUV(dir, f, t) {
    const [x1, y1, z1] = f, [x2, y2, z2] = t;
    switch (dir) {
      case 'down':  return [x1, 16 - z2, x2, 16 - z1];
      case 'up':    return [x1, z1, x2, z2];
      case 'north': return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
      case 'south': return [x1, 16 - y2, x2, 16 - y1];
      case 'west':  return [z1, 16 - y2, z2, 16 - y1];
      default:      return [16 - z2, 16 - y2, 16 - z1, 16 - y1]; // east
    }
  }

  function rotElem(p, rot) {
    const o = rot.origin;
    let x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2];
    const a = rot.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    if (rot.axis === 'x') { [y, z] = [y * c - z * s, y * s + z * c]; }
    else if (rot.axis === 'y') { [x, z] = [x * c + z * s, -x * s + z * c]; }
    else { [x, y] = [x * c - y * s, x * s + y * c]; }
    if (rot.rescale) {
      const k = 1 / Math.max(0.1, Math.abs(Math.cos(a)));
      if (rot.axis !== 'x') x *= k;
      if (rot.axis !== 'y') y *= k;
      if (rot.axis !== 'z') z *= k;
    }
    return [x + o[0], y + o[1], z + o[2]];
  }

  function rotState(p, rx, ry) { // um (8,8,8): erst X, dann Y (wie Minecraft)
    let x = p[0] - 8, y = p[1] - 8, z = p[2] - 8;
    if (rx) {
      const a = rx * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      [y, z] = [y * c + z * s, -y * s + z * c];
    }
    if (ry) {
      const a = ry * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      [x, z] = [x * c - z * s, x * s + z * c];
    }
    return [x + 8, y + 8, z + 8];
  }

  const r4 = v => Math.round(v * 1e4) / 1e4;

  function dirAfterRot(i, rx, ry) {
    const v = rotState([8 + DIRV[i][0], 8 + DIRV[i][1], 8 + DIRV[i][2]], rx, ry);
    const d = [v[0] - 8, v[1] - 8, v[2] - 8];
    let best = 0, bd = -9;
    DIRV.forEach((dv, j) => {
      const dot = dv[0] * d[0] + dv[1] * d[1] + dv[2] * d[2];
      if (dot > bd) { bd = dot; best = j; }
    });
    return best;
  }

  function shadeOf(n) {
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    if (Math.max(ax, ay, az) < 0.9) return 0.9;
    if (ay >= ax && ay >= az) return n[1] > 0 ? 1.0 : 0.5;
    if (az >= ax) return 0.8;
    return 0.6;
  }

  /* ---------- Modell -> Quads ---------- */
  function bake(elements, textures, rx, ry, name, out, fallbackKey) {
    for (const el of elements) {
      const from = el.from, to = el.to;
      const isFull = !el.rotation && from[0] === 0 && from[1] === 0 && from[2] === 0 &&
                     to[0] === 16 && to[1] === 16 && to[2] === 16;
      const fullKeys = [];

      // Kollisionsbox dieses Elements (nach allen Rotationen)
      {
        const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        for (const x of [from[0], to[0]]) for (const y of [from[1], to[1]]) for (const z of [from[2], to[2]]) {
          let p = [x, y, z];
          if (el.rotation) p = rotElem(p, el.rotation);
          if (rx || ry) p = rotState(p, rx, ry);
          for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a]); }
        }
        if (mx[0] - mn[0] > 0.01 && mx[1] - mn[1] > 0.01 && mx[2] - mn[2] > 0.01) {
          out.boxes.push([mn[0] / 16, mn[1] / 16, mn[2] / 16, mx[0] / 16, mx[1] / 16, mx[2] / 16].map(r4));
        }
      }

      for (const dirName of DIRN) {
        const face = el.faces && el.faces[dirName];
        if (!face) continue;

        let tex = resolveTex(face.texture, textures);
        if (!tex) tex = fallbackKey;
        if (isFull) fullKeys.push(tex);

        let corners = faceCorners(dirName, from, to);
        if (el.rotation) corners = corners.map(c => rotElem(c, el.rotation));
        if (rx || ry) corners = corners.map(c => rotState(c, rx, ry));
        corners = corners.map(c => c.map(r4));

        // Normale -> Shading
        const a = corners[0], b = corners[1], d = corners[3];
        const e1 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        const e2 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const len = Math.hypot(n[0], n[1], n[2]) || 1;
        n = n.map(v => v / len);

        // UV
        const [u1, v1, u2, v2] = face.uv || defaultUV(dirName, from, to);
        const base = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
        const k = (((face.rotation || 0) / 90) % 4 + 4) % 4;
        const uv = [];
        for (let i = 0; i < 4; i++) { const s = base[(i - k + 4) % 4]; uv.push(s[0], s[1]); }

        out.quads.push({
          p: corners.flat(),
          n,
          uv,
          tex,
          cull: face.cullface ? dirAfterRot(DIRI[face.cullface] ?? 0, rx, ry) : -1,
          shade: el.shade === false ? 1 : shadeOf(n),
          tint: face.tintindex !== undefined && face.tintindex >= 0 ? tintFor(name) : -1
        });
      }
      if (isFull && fullKeys.length === 6) out.fullKeys = fullKeys;
    }
  }

  function boxElement(f, t, isFullCull) {
    const faces = {};
    for (const d of DIRN) faces[d] = { texture: '#all', ...(isFullCull ? { cullface: d } : {}) };
    return { from: f, to: t, faces };
  }

  /* ---------- Blockstate-Auswahl ---------- */
  function pickVariant(variants, props) {
    let best = null, bestScore = -1;
    for (const [key, val] of Object.entries(variants)) {
      let score = 0, ok = true;
      if (key !== '') {
        for (const kv of key.split(',')) {
          const [k, v] = kv.split('=');
          if (props[k] === v) score++;
          else if (props[k] !== undefined) { ok = false; break; }
          // fehlende Eigenschaft: Wildcard (kein Treffer, aber auch kein Ausschluss)
        }
      }
      if (ok && score > bestScore) { best = val; bestScore = score; }
    }
    if (!best) best = Object.values(variants)[0];
    return Array.isArray(best) ? best[0] : best;
  }

  function matchWhen(when, props) {
    if (when.OR) return when.OR.some(w => matchWhen(w, props));
    if (when.AND) return when.AND.every(w => matchWhen(w, props));
    return Object.entries(when).every(([k, v]) => String(v).split('|').includes(props[k]));
  }

  /* ---------- Hauptfunktion ---------- */
  async function build(st) {
    const name = st.name.replace(/^minecraft:/, '');
    const props = Object.assign({}, DEFAULT_PROPS, st.props || {});
    const out = {
      name, skip: false, translucent: TRANSLUCENT.test(name), cullSame: CULL_SAME.test(name),
      quads: [], boxes: [], collide: false, bounds: null, fullKeys: null, fullCube: false, opaqueFull: false
    };
    if (SKIP.test(name)) { out.skip = true; return out; }

    const colorKey = 'color:' + BlockColors.get(name).toString(16).padStart(6, '0');

    // Flüssigkeiten haben keine Modelle
    if (name === 'water' || name === 'lava') {
      const tex = name === 'water' ? 'block/water_still' : 'block/lava_still';
      const el = boxElement([0, 0, 0], [16, 16, 16], true);
      bake([el], { all: tex }, 0, 0, name, out, colorKey);
      if (name === 'water') out.quads.forEach(q => { q.tint = 0x3f76e4; q.shade = 1; });
      finish(out);
      return out;
    }

    const bs = await Assets.json('blockstates/' + name + '.json');
    const applies = [];
    if (bs && bs.variants) {
      const v = pickVariant(bs.variants, props);
      if (v) applies.push(v);
    } else if (bs && bs.multipart) {
      for (const part of bs.multipart) {
        if (!part.when || matchWhen(part.when, props)) {
          applies.push(Array.isArray(part.apply) ? part.apply[0] : part.apply);
        }
      }
    }

    if (!applies.length) {
      // keine Assets gefunden -> einfarbiger Würfel
      bake([boxElement([0, 0, 0], [16, 16, 16], true)], { all: colorKey }, 0, 0, name, out, colorKey);
      finish(out);
      return out;
    }

    for (const ap of applies) {
      const model = await loadModel(ap.model);
      if (!model) continue;
      const rx = ap.x || 0, ry = ap.y || 0;
      if (model.elements) {
        bake(model.elements, model.textures, rx, ry, name, out, colorKey);
      } else {
        // Block-Entities (Truhe, Bett, Schild, ...): einfache Box mit Partikel-Textur
        const tex = resolveTex(model.textures.particle, model.textures) || null;
        const key = tex || colorKey;
        let box = [[0, 0, 0], [16, 16, 16], true];
        if (/chest$/.test(name)) box = [[1, 0, 1], [15, 14, 15], false];
        else if (/_bed$/.test(name)) box = [[0, 0, 0], [16, 9, 16], false];
        bake([boxElement(box[0], box[1], box[2])], { all: key }, rx, ry, name, out, colorKey);
      }
    }
    if (!out.quads.length) {
      bake([boxElement([0, 0, 0], [16, 16, 16], true)], { all: colorKey }, 0, 0, name, out, colorKey);
    }
    finish(out);
    return out;
  }

  function finish(out) {
    out.fullCube = !!out.fullKeys;
    out.collide = !NO_COLLIDE.test(out.name) && out.boxes.length > 0;

    // deckungsgleiche Flächen (z.B. Gras-Overlay) minimal nach außen schieben -> kein Z-Fighting
    const seen = new Map();
    for (const q of out.quads) {
      const d = q.n[0] * q.p[0] + q.n[1] * q.p[1] + q.n[2] * q.p[2];
      const bb = [0, 1, 2].map(a => {
        const vs = [q.p[a], q.p[3 + a], q.p[6 + a], q.p[9 + a]];
        return Math.min(...vs).toFixed(2) + ':' + Math.max(...vs).toFixed(2);
      }).join(',');
      // nur wirklich deckungsgleiche Flächen (gleiche Ebene UND gleiche Ausdehnung) werden getrennt
      const key = q.n.map(v => v.toFixed(2)).join(',') + '|' + d.toFixed(2) + '|' + bb;
      const c = seen.get(key) || 0;
      seen.set(key, c + 1);
      if (c > 0) {
        for (let i = 0; i < 12; i += 3) {
          q.p[i] += q.n[0] * 0.012 * c; q.p[i + 1] += q.n[1] * 0.012 * c; q.p[i + 2] += q.n[2] * 0.012 * c;
        }
      }
    }

    if (out.quads.length) {
      const b = [99, 99, 99, -99, -99, -99];
      for (const q of out.quads) for (let i = 0; i < 12; i += 3) {
        for (let a = 0; a < 3; a++) {
          b[a] = Math.min(b[a], q.p[i + a] / 16);
          b[a + 3] = Math.max(b[a + 3], q.p[i + a] / 16);
        }
      }
      out.bounds = b;
    }
  }

  function resolveState(st) {
    const key = st.name + JSON.stringify(st.props || {});
    if (!stateMemo.has(key)) stateMemo.set(key, build(st));
    return stateMemo.get(key);
  }

  return {
    resolveState,
    DIRV,
    reset() { modelMemo.clear(); stateMemo = new Map(); }
  };
})();
