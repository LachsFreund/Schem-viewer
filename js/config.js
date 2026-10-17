/* Einstellungen. Die Minecraft-Assets (Blockstates, Modelle, Texturen) werden einzeln und nur bei Bedarf geladen. */
const CONFIG = {
  // Standard-Version; per URL überschreibbar: index.html?mc=1.20.4
  VERSIONS: ['1.21.11', '1.21.8', '1.21.4', '1.20.4'],
  DEFAULT_VERSION: '1.21.8',

  // Quellen (erste = bevorzugt, zweite = Fallback). {v} = Version
  SOURCES: [
    'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/{v}/assets/minecraft/',
    'https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@{v}/assets/minecraft/'
  ],

  TILE: 16,          // Texturgröße im Atlas (Vanilla = 16px)
  ATLAS_SIZE: 1024,  // 1024x1024 reicht für > 3000 verschiedene Texturen
  MAX_PARALLEL: 12   // gleichzeitige Downloads
};

(function () {
  const q = new URLSearchParams(location.search).get('mc');
  CONFIG.version = q || CONFIG.DEFAULT_VERSION;
  if (!CONFIG.VERSIONS.includes(CONFIG.version)) CONFIG.VERSIONS.unshift(CONFIG.version);
})();
