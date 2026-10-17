/* Converts old numeric block IDs (.schematic / MCEdit format) to modern-style names. */
const Legacy = (() => {
  const DYE = ['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black'];
  const WOOD = ['oak','spruce','birch','jungle','acacia','dark_oak'];
  const SLAB = ['smooth_stone','sandstone','oak_planks','cobblestone','bricks','stone_bricks','nether_bricks','quartz_block'];
  const SLAB_NAMES = ['stone','sandstone','oak','cobblestone','brick','stone_brick','nether_brick','quartz'];
  const FACING = ['east','west','south','north'];

  const SIMPLE = {
    1:'stone',2:'grass_block',4:'cobblestone',7:'bedrock',8:'water',9:'water',10:'lava',11:'lava',
    12:'sand',13:'gravel',14:'gold_ore',15:'iron_ore',16:'coal_ore',19:'sponge',20:'glass',
    21:'lapis_ore',22:'lapis_block',24:'sandstone',41:'gold_block',42:'iron_block',45:'bricks',
    46:'tnt',47:'bookshelf',48:'mossy_cobblestone',49:'obsidian',50:'torch',54:'chest',
    56:'diamond_ore',57:'diamond_block',58:'crafting_table',61:'furnace',62:'furnace',65:'ladder',
    73:'redstone_ore',74:'redstone_ore',79:'ice',80:'snow_block',82:'clay',84:'jukebox',86:'pumpkin',87:'netherrack',
    88:'soul_sand',89:'glowstone',91:'jack_o_lantern',98:'stone_bricks',102:'glass_pane',103:'melon',
    112:'nether_bricks',121:'end_stone',133:'emerald_block',152:'redstone_block',153:'nether_quartz_ore',
    155:'quartz_block',165:'slime_block',170:'hay_block',172:'terracotta',173:'coal_block',174:'packed_ice',
    85:'oak_fence',113:'nether_brick_fence',139:'cobblestone_wall',20.5:'glass'
  };
  const STAIRS = {
    53:'oak',67:'cobblestone',108:'brick',109:'stone_brick',114:'nether_brick',128:'sandstone',
    134:'spruce',135:'birch',136:'jungle',156:'quartz',163:'acacia',164:'dark_oak'
  };
  const AIR = new Set([0, 31, 32, 37, 38, 39, 40, 51, 55, 59, 83, 106, 175]); // air + plants/fire etc. we skip cheaply

  const mk = (name, props = {}) => ({ name: 'minecraft:' + name, props });

  function convert(id, data) {
    if (id === 0) return mk('air');
    if (id === 3) return mk(['dirt','coarse_dirt','podzol'][data] || 'dirt');
    if (id === 5) return mk(WOOD[data & 7] ? WOOD[data & 7] + '_planks' : 'oak_planks');
    if (id === 17) return mk((WOOD[data & 3] || 'oak') + '_log');
    if (id === 162) return mk((WOOD[4 + (data & 1)] || 'acacia') + '_log');
    if (id === 18) return mk((WOOD[data & 3] || 'oak') + '_leaves');
    if (id === 161) return mk((WOOD[4 + (data & 1)] || 'acacia') + '_leaves');
    if (id === 6) return mk((WOOD[data & 7] || 'oak') + '_sapling');
    if (id === 35) return mk(DYE[data & 15] + '_wool');
    if (id === 95) return mk(DYE[data & 15] + '_stained_glass');
    if (id === 160) return mk(DYE[data & 15] + '_stained_glass_pane');
    if (id === 159) return mk(DYE[data & 15] + '_terracotta');
    if (id === 171) return mk(DYE[data & 15] + '_carpet');
    if (id === 251) return mk(DYE[data & 15] + '_concrete');
    if (id === 43) return mk(SLAB[data & 7] === 'smooth_stone' ? 'smooth_stone' : SLAB[data & 7]);
    if (id === 125) return mk((WOOD[data & 7] || 'oak') + '_planks');
    if (id === 44) return mk(SLAB_NAMES[data & 7] + '_slab', { type: data & 8 ? 'top' : 'bottom' });
    if (id === 126) return mk((WOOD[data & 7] || 'oak') + '_slab', { type: data & 8 ? 'top' : 'bottom' });
    if (STAIRS[id]) return mk(STAIRS[id] + '_stairs', { facing: FACING[data & 3], half: data & 4 ? 'top' : 'bottom' });
    if (AIR.has(id)) return mk('air');
    if (SIMPLE[id]) return mk(SIMPLE[id]);
    return mk('legacy_block_' + id);
  }

  return { convert };
})();
