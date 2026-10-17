/* Block name -> approximate colour (no textures needed). `BlockColors.get(name)` returns 0xRRGGBB. */
const BlockColors = (() => {
  const DYES = {
    white: 0xe9ecec, orange: 0xf07613, magenta: 0xbd44b3, light_blue: 0x3aafd9,
    yellow: 0xf8c527, lime: 0x70b919, pink: 0xed8dac, gray: 0x3e4447,
    light_gray: 0x8e8e86, cyan: 0x158991, purple: 0x792aac, blue: 0x35399d,
    brown: 0x724728, green: 0x546d1b, red: 0xa12722, black: 0x141519
  };
  const WOODS = {
    oak: 0xb8945f, spruce: 0x7a5a37, birch: 0xd7cb8d, jungle: 0xb88764,
    acacia: 0xba6337, dark_oak: 0x4a3018, mangrove: 0x764042, cherry: 0xe3b3ae,
    bamboo: 0xc1ad4f, crimson: 0x7e3a56, warped: 0x2b7f7a, pale_oak: 0xe3d8d0
  };
  const LEAVES = {
    spruce: 0x3d5d3d, birch: 0x80a755, cherry: 0xf0a8c8, azalea: 0x5b7a2e,
    mangrove: 0x5f7a2a, jungle: 0x2f7a1e, default: 0x4a8a2f
  };

  // order matters: first match wins
  const RULES = [
    [/coal_ore/, 0x4f4f4f], [/iron_ore/, 0xb8987c], [/gold_ore/, 0xd8c050],
    [/diamond_ore/, 0x5cd5d0], [/emerald_ore/, 0x3fbf65], [/lapis_ore/, 0x3a5ab0],
    [/redstone_ore/, 0xa02020], [/copper_ore/, 0xb87a5c],
    [/grass_block/, 0x679a3c], [/^(podzol)$/, 0x5b4125], [/mycelium/, 0x6f6265],
    [/coarse_dirt/, 0x6d4f34], [/dirt_path|farmland/, 0x8b6a3a], [/dirt|rooted/, 0x866043],
    [/mud/, 0x3c3836],
    [/mossy_cobblestone|mossy_stone_brick/, 0x6b7a5c],
    [/cobblestone/, 0x7a7a7a], [/stone_brick|smooth_stone|^stone/, 0x808080],
    [/deepslate/, 0x4d4d52], [/blackstone/, 0x2a252b], [/andesite/, 0x888884],
    [/diorite/, 0xbdbdbd], [/granite/, 0x95674f], [/tuff/, 0x6c6d66],
    [/calcite/, 0xe0e0dc], [/dripstone/, 0x8c6f5c],
    [/red_sandstone/, 0xb5601f], [/sandstone/, 0xdbcf9f],
    [/red_sand/, 0xbe6821], [/sand/, 0xdbd3a0], [/gravel/, 0x837f7e],
    [/clay/, 0xa0a6b3], [/terracotta/, 0x985e43],
    [/water|bubble_column/, 0x3f76e4], [/lava|magma/, 0xd96a14],
    [/packed_ice|blue_ice/, 0x8cb4f0], [/ice/, 0x91b8fd],
    [/snow/, 0xf8fdfd], [/powder_snow/, 0xf0f5f5],
    [/nether_brick/, 0x2c161a], [/netherrack/, 0x6f3636], [/nether_wart_block/, 0x7a0f10],
    [/soul_sand|soul_soil/, 0x51402f], [/glowstone/, 0xd8a860], [/shroomlight/, 0xf19a4d],
    [/obsidian/, 0x15111f], [/bedrock/, 0x555555],
    [/amethyst/, 0x8561bf], [/quartz/, 0xe8e2d9], [/prismarine/, 0x63a898],
    [/purpur/, 0xa77ca7], [/end_stone/, 0xdedca0], [/sea_lantern/, 0xcfe6df],
    [/copper/, 0xc26a4c], [/iron_block|iron_/, 0xd8d8d8], [/gold_block/, 0xf5d63d],
    [/diamond_block/, 0x4fd6d0], [/emerald_block/, 0x2fba5b], [/lapis_block/, 0x1f3d9e],
    [/redstone_block/, 0xaa1a0a], [/coal_block/, 0x1d1d1d], [/netherite/, 0x45403f],
    [/bricks?$|brick_/, 0x96564a], [/bookshelf/, 0x6e5330],
    [/tnt/, 0xcc3b2a], [/glass/, 0xcfe8ee], [/pumpkin|carved/, 0xc07716],
    [/melon/, 0x8fa828], [/hay_block/, 0xc7a21b], [/sponge/, 0xc4c24a],
    [/slime/, 0x7bc668], [/honey/, 0xe8a635], [/moss/, 0x59712e],
    [/crafting_table/, 0x8a6a3a], [/furnace|smoker|blast_furnace|dispenser|dropper/, 0x6e6e6e],
    [/chest|barrel/, 0x9c7022], [/torch|lantern|campfire|candle/, 0xffd24a],
    [/ladder/, 0x8a6a3a], [/bone_block/, 0xe3dfc9], [/cactus/, 0x2c7a2c],
    [/(^|_)(grass|fern)$|vine|seagrass|kelp|sugar_cane|lily_pad|bush|sapling|sprouts/, 0x5a9a3a],
    [/tulip|poppy|rose|dandelion|allium|orchid|cornflower|daisy|lilac|peony|bluet/, 0xd9568a],
    [/mushroom|fungus/, 0xb34a3a], [/cobweb/, 0xe8e8e8], [/wheat|carrots|potatoes|beetroots/, 0xc9b84a],
    [/rail/, 0x8a7a66], [/redstone|repeater|comparator|lever|button|plate/, 0x9a9a9a],
    [/bell/, 0xe4c03c], [/anvil/, 0x3a3a3a], [/cauldron/, 0x3b3b3b]
  ];

  const DYE_NAMES = Object.keys(DYES).sort((a, b) => b.length - a.length); // light_blue before blue
  const cache = new Map();

  function mix(a, b, t) {
    const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
    const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
    const bl = (a & 255) * (1 - t) + (b & 255) * t;
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
  }

  function hashColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const c = new THREE.Color().setHSL((h % 360) / 360, 0.45, 0.55);
    return c.getHex();
  }

  function compute(name) {
    // dyed variants
    for (const dye of DYE_NAMES) {
      if (name.startsWith(dye + '_') && /wool|concrete|terracotta|glass|carpet|banner|bed|shulker|candle/.test(name)) {
        const base = DYES[dye];
        if (/terracotta/.test(name)) return mix(base, 0x985e43, 0.55);
        if (/concrete_powder/.test(name)) return mix(base, 0xffffff, 0.2);
        return base;
      }
    }
    // leaves
    if (/leaves$/.test(name)) {
      const w = name.replace('_leaves', '');
      return LEAVES[w] ?? LEAVES.default;
    }
    // wood family
    for (const w of Object.keys(WOODS)) {
      if (name.startsWith(w + '_') || name.startsWith('stripped_' + w + '_')) {
        let c = WOODS[w];
        if (/_log$|_wood$|_stem$|_hyphae$/.test(name)) c = mix(c, 0x000000, 0.25);
        if (name.startsWith('stripped_')) c = mix(c, 0xffffff, 0.12);
        return c;
      }
    }
    for (const [re, col] of RULES) if (re.test(name)) return col;
    return hashColor(name);
  }

  return {
    get(fullName) {
      const name = fullName.replace(/^minecraft:/, '');
      let c = cache.get(name);
      if (c === undefined) { c = compute(name); cache.set(name, c); }
      return c;
    }
  };
})();
