// Quietly gets the bus map ready in the background, a little at a time, so it opens fast.
//
//   <script src="../shared/js/prefetch.js" data-stage="login" defer></script>
//
// Stages (each page asks for its own share):
//   login  the login and sign-up pages: the map's route list and the smaller regions
//   home   the card page, after logging in: the bigger regions
// The map page itself fetches whatever is left.
//
// It only downloads files into the browser's normal cache. Nothing is read or shown, it waits until
// the page has finished loading and the browser is idle, and it does nothing on Data Saver or 2G.
// If the map data isn't installed (a 404) it stops quietly.

(function () {
    const DATA = '../map/data/';

    // Same Esri tiles as map.js (CONFIG.TILE_URL). Change both together.
    const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    const IRELAND = { south: 51.3, north: 55.5, west: -10.7, east: -5.3 };

    const STAGES = {
        login: { files: ['index.json', 'geo-waterford.json', 'geo-limerick.json'], tileZoom: 7 },
        home:  { files: ['geo-cork.json', 'geo-galway.json', 'geo-dublin.json'], tileZoom: 8 }
    };
    const SKIP_ON_SLOW = ['geo-dublin.json'];   // big files wait on slow connections

    function connection() {
        const net = navigator.connection;
        if (!net) return 'ok';
        if (net.saveData || /^(slow-2g|2g)$/.test(net.effectiveType)) return 'off';
        return net.effectiveType === '3g' ? 'slow' : 'ok';
    }

    function tileX(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
    function tileY(lat, z) {
        const r = lat * Math.PI / 180;
        return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
    }

    // Map tiles for the starting view of the map (they load as plain images into the cache)
    function prefetchTiles(z) {
        const x0 = tileX(IRELAND.west, z), x1 = tileX(IRELAND.east, z);
        const y0 = tileY(IRELAND.north, z), y1 = tileY(IRELAND.south, z);
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                new Image().src = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
            }
        }
    }

    async function run(stage) {
        const plan = STAGES[stage];
        const net = connection();
        if (!plan || net === 'off') return;

        for (const file of plan.files) {
            if (net === 'slow' && SKIP_ON_SLOW.indexOf(file) !== -1) continue;
            try {
                const response = await fetch(DATA + file);
                if (!response.ok) return;     // data not installed: stop quietly
                await response.blob();        // read it so it finishes and is cached
            } catch (error) {
                return;                       // offline or blocked
            }
        }
        prefetchTiles(plan.tileZoom);
    }

    const script = document.currentScript;
    const stage = script && script.dataset.stage;
    if (!stage) return;

    const idle = window.requestIdleCallback || function (fn) { setTimeout(fn, 2000); };
    function start() { idle(function () { run(stage); }, { timeout: 8000 }); }

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start);
})();
