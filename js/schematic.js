/*
 * Loads WorldEdit schematics.
 *   - .schem      (Sponge schematic v2 / v3 – modern WorldEdit default)
 *   - .schematic  (legacy MCEdit/WorldEdit format with numeric IDs)
 * Result: { width, height, length, palette: [{name, props}], blocks: Int32Array }
 * Block index = x + z * width + y * width * length
 */
const Schematic = (() => {
  function parseState(str) {
    const m = /^([^\[]+)(?:\[(.*)\])?$/.exec(str);
    const props = {};
    if (m && m[2]) {
      for (const kv of m[2].split(',')) {
        const [k, v] = kv.split('=');
        props[k] = v;
      }
    }
    return { name: m ? m[1] : str, props };
  }

  function decodeVarints(bytes, count) {
    const out = new Int32Array(count);
    let i = 0;
    for (let n = 0; n < count && i < bytes.length; n++) {
      let value = 0, shift = 0, b;
      do {
        b = bytes[i++];
        value |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80 && i < bytes.length);
      out[n] = value;
    }
    return out;
  }

  function fromSponge(root) {
    const s = root.Schematic || root; // v3 wraps everything in "Schematic"
    const width = s.Width & 0xffff, height = s.Height & 0xffff, length = s.Length & 0xffff;

    let paletteObj, data;
    if (s.Blocks && s.Blocks.Palette) { paletteObj = s.Blocks.Palette; data = s.Blocks.Data; } // v3
    else { paletteObj = s.Palette; data = s.BlockData; }                                        // v2
    if (!paletteObj || !data) throw new Error('No block palette/data found in this .schem file.');

    const palette = [];
    for (const [state, id] of Object.entries(paletteObj)) palette[id] = parseState(state);
    for (let i = 0; i < palette.length; i++) if (!palette[i]) palette[i] = { name: 'minecraft:air', props: {} };

    const blocks = decodeVarints(data, width * height * length);
    return { width, height, length, palette, blocks };
  }

  function fromLegacy(root) {
    const width = root.Width & 0xffff, height = root.Height & 0xffff, length = root.Length & 0xffff;
    const ids = root.Blocks, meta = root.Data, add = root.AddBlocks;
    if (!ids || !meta) throw new Error('Legacy schematic is missing Blocks/Data arrays.');
    const total = width * height * length;
    const blocks = new Int32Array(total);
    const palette = [];
    const lookup = new Map();

    for (let i = 0; i < total; i++) {
      let id = ids[i];
      if (add) {
        const nib = add[i >> 1];
        id |= ((i & 1) ? (nib >> 4) : (nib & 0x0f)) << 8;
      }
      const key = id * 16 + (meta[i] & 15);
      let idx = lookup.get(key);
      if (idx === undefined) {
        idx = palette.length;
        palette.push(Legacy.convert(id, meta[i] & 15));
        lookup.set(key, idx);
      }
      blocks[i] = idx;
    }
    return { width, height, length, palette, blocks };
  }

  async function load(arrayBuffer) {
    const root = await NBT.read(arrayBuffer);
    if (root.Schematic || root.BlockData || (root.Blocks && root.Blocks.Palette) || root.Palette) return fromSponge(root);
    if (root.Blocks instanceof Uint8Array) return fromLegacy(root);
    throw new Error('Unrecognised file. Supported: Sponge .schem (v2/v3) and legacy .schematic.');
  }

  /* Small built-in house so you can test without a file. */
  function demo() {
    const W = 15, H = 12, L = 15;
    const palette = [
      { name: 'minecraft:air', props: {} },                                            // 0
      { name: 'minecraft:grass_block', props: {} },                                    // 1
      { name: 'minecraft:stone_bricks', props: {} },                                   // 2
      { name: 'minecraft:oak_planks', props: {} },                                     // 3
      { name: 'minecraft:glass', props: {} },                                          // 4
      { name: 'minecraft:spruce_stairs', props: { facing: 'south', half: 'bottom' } }, // 5 (north roof side)
      { name: 'minecraft:spruce_stairs', props: { facing: 'north', half: 'bottom' } }, // 6 (south roof side)
      { name: 'minecraft:spruce_planks', props: {} },                                  // 7
      { name: 'minecraft:torch', props: {} },                                          // 8
      { name: 'minecraft:oak_slab', props: { type: 'bottom' } },                       // 9
      { name: 'minecraft:red_wool', props: {} },                                       // 10
    ];
    const blocks = new Int32Array(W * H * L);
    const set = (x, y, z, v) => {
      if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < L) blocks[x + z * W + y * W * L] = v;
    };

    for (let x = 0; x < W; x++) for (let z = 0; z < L; z++) set(x, 0, z, 1);
    for (let x = 2; x <= 12; x++) for (let z = 2; z <= 12; z++) set(x, 0, z, 3);

    for (let y = 1; y <= 4; y++) {
      for (let x = 2; x <= 12; x++) for (let z = 2; z <= 12; z++) {
        const edge = x === 2 || x === 12 || z === 2 || z === 12;
        if (!edge) continue;
        const corner = (x === 2 || x === 12) && (z === 2 || z === 12);
        set(x, y, z, corner ? 3 : 2);
      }
    }
    // door + windows
    set(7, 1, 12, 0); set(7, 2, 12, 0);
    for (const x of [4, 10]) { set(x, 2, 12, 4); set(x, 3, 12, 4); set(x, 2, 2, 4); set(x, 3, 2, 4); }
    for (const z of [5, 9]) { set(2, 2, z, 4); set(2, 3, z, 4); set(12, 2, z, 4); set(12, 3, z, 4); }
    set(6, 2, 13, 8); set(8, 2, 13, 8);
    for (let x = 6; x <= 8; x++) set(x, 0, 13, 9);

    // roof
    for (let i = 0; i <= 5; i++) {
      const zn = 2 + i, zs = 12 - i, y = 5 + i;
      for (let x = 1; x <= 13; x++) {
        if (zn === zs) set(x, y, zn, 7);
        else { set(x, y, zn, 5); set(x, y, zs, 6); }
      }
      if (zn < zs) for (const x of [2, 12]) for (let z = zn + 1; z < zs; z++) set(x, y, z, 3);
    }
    // little carpet-ish accent inside
    for (let x = 5; x <= 9; x++) for (let z = 5; z <= 9; z++) set(x, 1, z, 10);

    return { width: W, height: H, length: L, palette, blocks };
  }

  /* Leere Fläche (nur Luft) */
  function empty(w = 32, h = 16, l = 32) {
    return { width: w, height: h, length: l, palette: [{ name: 'minecraft:air', props: {} }], blocks: new Int32Array(w * h * l) };
  }

  return { load, demo, empty, parseState };
})();
