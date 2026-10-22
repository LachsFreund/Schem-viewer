/*
 * Special: Banner und Köpfe sind in Minecraft Block-Entities (kein JSON-Modell, Textur kommt aus Entity-Texturen
 * bzw. aus den NBT-Daten). Hier werden sie nachgebaut:
 *   - Banner: Stoff aus entity/banner/base.png in der Farbe des Blocks + alle Muster-Schichten aus den Block-Entity-Daten
 *   - Köpfe:  Skelett, Wither-Skelett, Zombie, Creeper, Piglin, Spieler (Steve bzw. Skin aus dem Profil, falls ladbar)
 * prepare() füllt schem.special: Map(Blockindex -> Quads), die der Mesher statt der Standard-Quads verwendet.
 */
const Special = (() => {
  const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
                  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  const RGB = {
    white: [0xf9, 0xff, 0xfe], orange: [0xf9, 0x80, 0x1d], magenta: [0xc7, 0x4e, 0xbd], light_blue: [0x3a, 0xb3, 0xda],
    yellow: [0xfe, 0xd8, 0x3d], lime: [0x80, 0xc7, 0x1f], pink: [0xf3, 0x8b, 0xaa], gray: [0x47, 0x4f, 0x52],
    light_gray: [0x9d, 0x9d, 0x97], cyan: [0x16, 0x9c, 0x9c], purple: [0x89, 0x32, 0xb8], blue: [0x3c, 0x44, 0xaa],
    brown: [0x83, 0x54, 0x32], green: [0x5e, 0x7c, 0x16], red: [0xb0, 0x2e, 0x26], black: [0x1d, 0x1d, 0x21]
  };

  // alte Kurzcodes (bis 1.20.4) -> Muster-Namen (= Dateinamen unter entity/banner/)
  const CODES = {
    b: 'base', bl: 'square_bottom_left', br: 'square_bottom_right', tl: 'square_top_left', tr: 'square_top_right',
    bs: 'stripe_bottom', ts: 'stripe_top', ls: 'stripe_left', rs: 'stripe_right', cs: 'stripe_center', ms: 'stripe_middle',
    drs: 'stripe_downright', dls: 'stripe_downleft', ss: 'small_stripes', cr: 'cross', sc: 'straight_cross',
    bt: 'triangle_bottom', tt: 'triangle_top', bts: 'triangles_bottom', tts: 'triangles_top',
    ld: 'diagonal_left', rd: 'diagonal_up_right', lud: 'diagonal_up_left', rud: 'diagonal_right',
    mc: 'circle', mr: 'rhombus', vh: 'half_vertical', hh: 'half_horizontal', vhr: 'half_vertical_right', hhb: 'half_horizontal_bottom',
    bo: 'border', cbo: 'curly_border', gra: 'gradient', gru: 'gradient_up', bri: 'bricks', glb: 'globe', cre: 'creeper',
    sku: 'skull', flo: 'flower', moj: 'mojang', pig: 'piglin'
  };

  // Blickrichtung (Wandbanner / Wandkopf) -> Drehstufe (0 = Vorderseite nach Süden, 4 = Westen, ...)
  const FACING_ROT = { south: 0, west: 4, north: 8, east: 12 };

  const HEADS = {
    skeleton_skull:        { tex: ['entity/skeleton/skeleton'], w: 8 },
    wither_skeleton_skull: { tex: ['entity/skeleton/wither_skeleton'], w: 8 },
    zombie_head:           { tex: ['entity/zombie/zombie'], w: 8 },
    creeper_head:          { tex: ['entity/creeper/creeper'], w: 8 },
    piglin_head:           { tex: ['entity/piglin/piglin'], w: 10 },
    player_head:           { tex: ['entity/player/wide/steve', 'entity/steve'], w: 8, overlay: true, player: true }
  };

  /* ---------- Hilfen ---------- */
  const colorName = c => (typeof c === 'number' ? (COLORS[c] || 'white') : String(c).replace(/^minecraft:/, ''));
  function patternId(p) {
    let id = p;
    if (id && typeof id === 'object') id = id.asset_id || id.id || '';
    id = String(id).replace(/^minecraft:/, '');
    return CODES[id] || id;
  }

  function bannerDesign(base, data) {
    const list = (data && (data.patterns || data.Patterns)) || [];
    const layers = [];
    for (const p of list) {
      const id = patternId(p.pattern !== undefined ? p.pattern : p.Pattern);
      const col = colorName(p.color !== undefined ? p.color : p.Color);
      if (id && id !== 'base') layers.push([id, col]);
    }
    return { base, layers, key: 'banner:' + base + ':' + layers.map(l => l.join('/')).join('|') };
  }

  async function composeBanner(atlas, d) {
    if (atlas.entries.has(d.key)) return true;
    const W = 44, H = 42;                                   // nur der Stoff-Bereich der 64x64-Textur
    const baseImg = (await Assets.image('textures/entity/banner/base.png')) || (await Assets.image('textures/entity/banner_base.png'));
    if (!baseImg) return false;

    const tint = (img, rgb) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, W, H, 0, 0, W, H);
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(img, 0, 0, W, H, 0, 0, W, H);
      return c;
    };

    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(tint(baseImg, RGB[d.base] || RGB.white), 0, 0);
    for (const [id, col] of d.layers) {
      const img = await Assets.image('textures/entity/banner/' + id + '.png');
      if (img) ctx.drawImage(tint(img, RGB[col] || RGB.white), 0, 0);
    }
    atlas.addImage(d.key, cvs);
    return true;
  }

  const rectUV = (e, r) => {
    const k = (v, s) => Math.max(0, Math.min(16, v * 16 / s));
    return [k(r[0], e.w), k(r[1], e.h), k(r[2], e.w), k(r[3], e.h)];
  };

  /* ---------- Geometrie ---------- */
  // Maße in 1/16-Block; entsprechen dem Banner-Entity-Modell (Skalierung 2/3)
  function bannerQuads(atlas, key, standing, ry) {
    const e = atlas.entries.get(key);
    const R = r => rectUV(e, r);
    const wood = (uv) => ({ uv, texture: '#w' });
    const sides = (uvNS, uvEW, uvUD) => ({
      north: wood(uvNS), south: wood(uvNS), east: wood(uvEW), west: wood(uvEW), up: wood(uvUD), down: wood(uvUD)
    });
    const els = [];
    const bar = standing ? { from: [1.333, 28, 7.333], to: [14.667, 29.333, 8.667] }
                         : { from: [1.333, 12.333, 0.333], to: [14.667, 13.667, 1.667] };
    const cloth = standing ? { from: [1.333, 2.667, 8.667], to: [14.667, 29.333, 9.333] }
                           : { from: [1.333, -13, 1.667], to: [14.667, 13.667, 2.333] };
    if (standing) els.push({ from: [7.333, 0, 7.333], to: [8.667, 28, 8.667], faces: sides([7, 0, 9, 16], [7, 0, 9, 16], [7, 7, 9, 9]) });
    els.push({ from: bar.from, to: bar.to, faces: sides([0, 7, 16, 9], [7, 7, 9, 9], [0, 7, 16, 9]) });
    els.push({
      from: cloth.from, to: cloth.to,
      faces: {
        south: { uv: R([1, 1, 21, 41]), texture: '#c' },
        north: { uv: R([22, 1, 42, 41]), texture: '#c' },
        west:  { uv: R([0, 1, 1, 41]), texture: '#c' },
        east:  { uv: R([21, 1, 22, 41]), texture: '#c' },
        up:    { uv: R([1, 0, 21, 1]), texture: '#c' },
        down:  { uv: R([21, 0, 41, 1]), texture: '#c' }
      }
    });
    return Models.bakeElements(els, { c: key, w: 'block/oak_planks' }, 0, ry, 'banner');
  }

  function headQuads(atlas, texKey, w, overlay, wall, ry) {
    const e = atlas.entries.get(texKey);
    const R = r => rectUV(e, r);
    const d = 8, h = 8;
    const rects = (u0, v0) => ({
      up: [u0 + d, v0, u0 + d + w, v0 + d],
      down: [u0 + d + w, v0, u0 + d + 2 * w, v0 + d],
      west: [u0, v0 + d, u0 + d, v0 + d + h],
      south: [u0 + d, v0 + d, u0 + d + w, v0 + d + h],
      east: [u0 + d + w, v0 + d, u0 + 2 * d + w, v0 + d + h],
      north: [u0 + 2 * d + w, v0 + d, u0 + 2 * d + 2 * w, v0 + d + h]
    });
    const cube = (grow, u0) => {
      const y0 = wall ? 4 : 0, z0 = wall ? 0 : 4;
      const faces = {};
      for (const [dir, r] of Object.entries(rects(u0, 0))) faces[dir] = { uv: R(r), texture: '#t' };
      return {
        from: [8 - w / 2 - grow, y0 - grow, z0 - grow],
        to: [8 + w / 2 + grow, y0 + h + grow, z0 + d + grow],
        faces
      };
    };
    const els = [cube(0, 0)];
    if (overlay) els.push(cube(0.25, 32));            // zweite Skin-Ebene (Hut)
    return Models.bakeElements(els, { t: texKey }, 0, ry, 'head');
  }

  /* ---------- Köpfe: Textur-Auswahl ---------- */
  function skinUrl(data) {
    try {
      const prof = data && (data.profile || data.SkullOwner || data.Owner);
      if (!prof) return null;
      const props = prof.properties || prof.Properties;
      let value = null;
      if (Array.isArray(props)) { const t = props.find(p => p.name === 'textures'); value = t && t.value; }
      else if (props && props.textures && props.textures[0]) value = props.textures[0].Value || props.textures[0].value;
      if (!value) return null;
      const json = JSON.parse(atob(value));
      const url = json.textures && json.textures.SKIN && json.textures.SKIN.url;
      return url ? url.replace(/^http:/, 'https:') : null;
    } catch (e) { return null; }
  }

  async function loadSkin(atlas, url) {
    const key = 'skin:' + url.split('/').pop();
    if (atlas.entries.has(key)) return key;
    try {
      // textures.minecraft.net sendet je nach Zeitpunkt keine CORS-Header -> bei Fehler Steve verwenden
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(url, { mode: 'cors', signal: ctl.signal });
      clearTimeout(timer);
      if (!r.ok) return null;
      const bmp = await createImageBitmap(await r.blob());
      atlas.addImage(key, bmp);
      return key;
    } catch (e) { return null; }
  }

  async function firstTexture(atlas, list) {
    for (const k of list) {
      await atlas.ensure([k]);
      const e = atlas.entries.get(k);
      if (e && !e.missing) return k;
    }
    return null;
  }

  /* ---------- Schilder (Körper + Text) ---------- */
  const SIGN_RE = /_sign$/;

  // Text-Komponente (JSON-String, Objekt oder Liste) -> reiner Text
  function textOf(c) {
    if (c === null || c === undefined) return '';
    if (typeof c === 'string') {
      const t = c.trim();
      if (t[0] === '{' || t[0] === '[' || t[0] === '"') { try { return textOf(JSON.parse(t)); } catch (e) { /* kein JSON */ } }
      return c;
    }
    if (typeof c === 'number' || typeof c === 'boolean') return String(c);
    if (Array.isArray(c)) return c.map(textOf).join('');
    if (typeof c === 'object') {
      let t = '';
      if (c.text !== undefined) t += textOf(c.text);
      else if (c.translate) t += c.translate;
      if (c.extra) t += textOf(c.extra);
      return t;
    }
    return '';
  }

  function signSide(data, side) {
    if (!data) return null;
    const t = data[side + '_text'];
    let msgs = null, color = 'black';
    if (t) { msgs = (t.messages || []).map(textOf); color = t.color || 'black'; }
    else if (side === 'front' && data.Text1 !== undefined) {
      msgs = [1, 2, 3, 4].map(i => textOf(data['Text' + i]));
      color = data.Color || 'black';
    }
    if (!msgs) return null;
    while (msgs.length < 4) msgs.push('');
    msgs = msgs.slice(0, 4);
    return msgs.some(x => x.trim()) ? { lines: msgs, color: colorName(color) } : null;
  }

  // Text auf eine durchsichtige Fläche zeichnen (Seitenverhältnis wie die Schildfläche)
  function drawSignText(atlas, side, W, H) {
    const key = `sign:${W}x${H}:${side.color}:${side.lines.join('\u0001')}`;
    if (atlas.entries.has(key)) return key;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    const ctx = cvs.getContext('2d');
    const rgb = side.color === 'black' ? [0, 0, 0] : (RGB[side.color] || [0, 0, 0]);
    ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lineH = H / 4.8, top = (H - 4 * lineH) / 2;
    side.lines.forEach((line, i) => {
      if (!line.trim()) return;
      let fs = lineH * 0.85;
      ctx.font = `bold ${fs}px "Courier New", Consolas, monospace`;
      while (ctx.measureText(line).width > W * 0.94 && fs > 5) { fs -= 0.5; ctx.font = `bold ${fs}px "Courier New", Consolas, monospace`; }
      ctx.fillText(line, W / 2, top + (i + 0.5) * lineH);
    });
    atlas.addImage(key, cvs);
    return key;
  }

  // Standard-Quaderfaltung (Entity-Modelle): u0,v0 = texOffs, w,h,d = Maße
  function cuboidFaces(R, u0, v0, w, h, d) {
    const f = r => ({ uv: R(r), texture: '#t' });
    return {
      up: f([u0 + d, v0, u0 + d + w, v0 + d]),
      down: f([u0 + d + w, v0, u0 + d + 2 * w, v0 + d]),
      west: f([u0, v0 + d, u0 + d, v0 + d + h]),
      south: f([u0 + d, v0 + d, u0 + d + w, v0 + d + h]),
      east: f([u0 + d + w, v0 + d, u0 + 2 * d + w, v0 + d + h]),
      north: f([u0 + 2 * d + w, v0 + d, u0 + 2 * d + 2 * w, v0 + d + h])
    };
  }

  // Geometrie der Schilder (1/16-Block, Vorderseite = Süden bei Drehung 0); Werte aus dem Entity-Modell (Skalierung 2/3)
  function signLayout(hanging, wall) {
    if (hanging) return { text: { x0: 1, x1: 15, y0: 0, y1: 10, zf: 9.02, zb: 6.98, w: 126, h: 90 } };
    if (wall) return { text: { x0: 0, x1: 16, y0: 4.333, y1: 12.333, zf: 1.687, zb: 0.313, w: 144, h: 72 } };
    return { text: { x0: 0, x1: 16, y0: 9.333, y1: 17.333, zf: 8.687, zb: 7.313, w: 144, h: 72 } };
  }

  function signBodyQuads(atlas, texKey, hanging, wall, ry) {
    const e = atlas.entries.get(texKey);
    const R = r => rectUV(e, r);
    const els = [];
    if (hanging) {
      els.push({ from: [0, 14, 6], to: [16, 16, 10], faces: cuboidFaces(R, 0, 0, 16, 2, 4) });          // Balken oben
      els.push({ from: [1, 0, 7], to: [15, 10, 9], faces: cuboidFaces(R, 0, 12, 14, 10, 2) });          // Schild
      els.push({ from: [2.5, 10, 7.25], to: [3.75, 14, 8.75], faces: cuboidFaces(R, 0, 12, 14, 10, 2) }); // Ketten (vereinfacht)
      els.push({ from: [12.25, 10, 7.25], to: [13.5, 14, 8.75], faces: cuboidFaces(R, 0, 12, 14, 10, 2) });
    } else if (wall) {
      els.push({ from: [0, 4.333, 0.333], to: [16, 12.333, 1.667], faces: cuboidFaces(R, 0, 0, 24, 12, 2) });
    } else {
      els.push({ from: [0, 9.333, 7.333], to: [16, 17.333, 8.667], faces: cuboidFaces(R, 0, 0, 24, 12, 2) });
      els.push({ from: [7.333, 0, 7.333], to: [8.667, 9.333, 8.667], faces: cuboidFaces(R, 0, 14, 2, 14, 2) });
    }
    return Models.bakeElements(els, { t: texKey }, 0, ry, 'sign');
  }

  function signTextQuads(frontKey, backKey, g, ry) {
    const els = [], tex = {};
    if (frontKey) { els.push({ from: [g.x0, g.y0, g.zf], to: [g.x1, g.y1, g.zf], faces: { south: { uv: [0, 0, 16, 16], texture: '#f' } } }); tex.f = frontKey; }
    if (backKey)  { els.push({ from: [g.x0, g.y0, g.zb], to: [g.x1, g.y1, g.zb], faces: { north: { uv: [0, 0, 16, 16], texture: '#b' } } }); tex.b = backKey; }
    return els.length ? Models.bakeElements(els, tex, 0, ry, 'signtext') : [];
  }

  /* ---------- Hauptfunktion ---------- */
  async function prepare(schem, infos, atlas) {
    const sp = new Map();
    schem.special = sp;

    const kinds = infos.map(i => (!i || i.skip || !i.special) ? null : (/_banner$/.test(i.name) ? 'banner' : SIGN_RE.test(i.name) ? 'sign' : 'head'));
    if (!kinds.some(Boolean)) return;

    const blocks = schem.blocks, palette = schem.palette;
    const found = [];
    for (let i = 0; i < blocks.length; i++) { const k = kinds[blocks[i]]; if (k) found.push([i, blocks[i], k]); }
    if (!found.length) return;

    await atlas.ensure(['block/oak_planks']);

    const jobs = new Map();     // Design-/Skin-Key -> Promise
    const plan = [];

    for (const [idx, pi, kind] of found) {
      const info = infos[pi];
      const props = palette[pi].props || {};
      const be = schem.blockEntities && schem.blockEntities.get(idx);
      const data = be ? be.data : null;
      const wall = /_wall_/.test(info.name);
      const rot = wall ? (FACING_ROT[props.facing] || 0) : (parseInt(props.rotation, 10) || 0);
      const ry = rot * 22.5;

      if (kind === 'sign') {
        const hanging = /hanging_sign$/.test(info.name);
        const wood = info.name.replace(/_(wall_)?(hanging_)?sign$/, '');
        const texPath = hanging ? 'entity/signs/hanging/' + wood : 'entity/signs/' + wood;
        if (!info.hasElements && !jobs.has('tex:' + texPath)) jobs.set('tex:' + texPath, firstTexture(atlas, [texPath]));
        plan.push({ idx, kind, wall, hanging, ry, info, texPath, data, wood });
      } else if (kind === 'banner') {
        const base = info.name.replace(/(_wall)?_banner$/, '');
        const d = bannerDesign(base, data);
        if (!jobs.has(d.key)) jobs.set(d.key, composeBanner(atlas, d));
        plan.push({ idx, kind, wall, ry, key: d.key });
      } else {
        const type = info.name.replace('_wall', '');
        const cfg = HEADS[type];
        if (!cfg) continue;                                   // z. B. Drachenkopf -> Standard-Darstellung
        let skinKey = null;
        if (cfg.player) {
          const url = skinUrl(data);
          if (url) {
            const k = 'skinjob:' + url;
            if (!jobs.has(k)) jobs.set(k, loadSkin(atlas, url));
            skinKey = k;
          }
        }
        if (!jobs.has('tex:' + type)) jobs.set('tex:' + type, firstTexture(atlas, cfg.tex));
        plan.push({ idx, kind, wall, ry, cfg, type, skinKey });
      }
    }

    const results = new Map();
    await Promise.all([...jobs.entries()].map(async ([k, p]) => results.set(k, await p)));

    const memo = new Map();
    for (const p of plan) {
      let quads;
      if (p.kind === 'sign') {
        const g = signLayout(p.hanging, p.wall).text;
        const fs = signSide(p.data, 'front'), bs = signSide(p.data, 'back');
        const fk = fs ? drawSignText(atlas, fs, g.w, g.h) : null;
        const bk = bs ? drawSignText(atlas, bs, g.w, g.h) : null;
        let body = p.info.quads;
        if (!p.info.hasElements) {
          let tex = results.get('tex:' + p.texPath);
          if (!tex) { tex = 'color:' + BlockColors.get(p.wood + '_planks').toString(16).padStart(6, '0'); await atlas.ensure([tex]); }
          const sig = `s|${p.hanging}|${p.wall}|${p.ry}|${tex}`;
          body = memo.get(sig) || (memo.set(sig, signBodyQuads(atlas, tex, p.hanging, p.wall, p.ry)), memo.get(sig));
        }
        quads = body.concat(signTextQuads(fk, bk, g, p.ry));
        sp.set(p.idx, quads);
        continue;
      }
      if (p.kind === 'banner') {
        if (!results.get(p.key)) continue;                    // Textur fehlt -> Standard-Darstellung
        const sig = `b|${p.wall}|${p.ry}|${p.key}`;
        quads = memo.get(sig) || (memo.set(sig, bannerQuads(atlas, p.key, !p.wall, p.ry)), memo.get(sig));
      } else {
        let tex = null;
        if (p.skinKey) tex = results.get(p.skinKey) || null;
        if (!tex) tex = results.get('tex:' + p.type);
        if (!tex) continue;
        const sig = `h|${p.wall}|${p.ry}|${tex}`;
        quads = memo.get(sig) || (memo.set(sig, headQuads(atlas, tex, p.cfg.w, p.cfg.overlay, p.wall, p.ry)), memo.get(sig));
      }
      sp.set(p.idx, quads);
    }
  }

  return { prepare, bannerDesign };
})();
