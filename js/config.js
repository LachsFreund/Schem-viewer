/* Einstellungen. Die Minecraft-Assets (Blockstates, Modelle, Texturen) werden einzeln und nur bei Bedarf geladen. */
const CONFIG = {
  // Standard-Version; per URL überschreibbar: index.html?mc=1.20.4
  VERSIONS: ['26.3', '26.2', '26.1', '1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7', '1.21.6', '1.21.5',
               '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21', '1.20.6', '1.20.5', '1.20.4', '1.20.3', '1.20.2', '1.20.1',
               '1.20', '1.19.4', '1.19.3', '1.19.2', '1.19', '1.18.2', '1.17.1', '1.16.5'],
  DEFAULT_VERSION: '1.21.8',

  // Quellen (erste = bevorzugt, zweite = Fallback). {v} = Version
  SOURCES: [
    'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/{v}/assets/minecraft/',
    'https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@{v}/assets/minecraft/'
  ],

  TILE: 16,          // Texturgröße im Atlas (Vanilla = 16px)
  ATLAS_SIZE: 2048,  // 2048x2048: Platz für viele Texturen, Banner-Designs und Schildertexte
  MAX_PARALLEL: 12   // gleichzeitige Downloads
};

(function () {
  const q = new URLSearchParams(location.search).get('mc');
  CONFIG.version = q || CONFIG.DEFAULT_VERSION;
  if (!CONFIG.VERSIONS.includes(CONFIG.version)) CONFIG.VERSIONS.unshift(CONFIG.version);
})();
