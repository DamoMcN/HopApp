// Bus map: shows Irish bus routes and stops, and live bus positions.
// Uses Leaflet (loaded in map.html).

// =========================================
//  Settings you might want to change
// =========================================

// If the live bus file is hosted online (for example on Azure), put its address here, such as
// 'https://hop-live.azurewebsites.net/vehicles.php'. Leave it empty to use the copy on your own WAMP.
const HOSTED_LIVE_URL = 'https://hopapp.onrender.com/api/vehicles';

const CONFIG = {
    // Route data made by build-data.js (big, so it is not stored in git). See the README.
    // index.json is small and loads first; each region's route lines load when that region is needed.
    INDEX_URL: 'data/index.json',
    GEO_URL: 'data/geo-',

    // Wheelchair access for stops (from the NTA PTIMS survey, via import-ptims.js) and for stops and
    // routes checked by hand, on top of what the timetable data says. Optional: the map works without it. Format and how to fill it in: see "Accessible stops and routes" in the README.
    ACCESS_URL: 'data/accessibility.json',

    // Live buses come from backend/live/vehicles.php, which runs on WAMP with the rest of the PHP.
    // (The optional Node version, backend/live/server.js, works too: set this to 'http://localhost:3000/api/vehicles'.)
    // The map still works without live buses.
    LIVE_URL: HOSTED_LIVE_URL || '../../backend/live/vehicles.php',
    LIVE_REFRESH_MS: 30000,

    // Next arrivals at a stop. Only the hosted Node server has this (the PHP copy does not),
    // so without it the stop card just leaves the "Next buses" part out.
    STOP_TIMES_URL: HOSTED_LIVE_URL ? HOSTED_LIVE_URL.replace(/vehicles$/, 'stop-times') : '',

    // Light grey base map. map.css re-colours it purple.
    TILE_URL: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    TILE_ATTRIBUTION: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',

    // Place search (Photon, built on OpenStreetMap). What you type is sent to this service.
    // Set to '' to search only bus stops and routes.
    PLACES_URL: 'https://photon.komoot.io/api/',
    PLACES_BBOX: '-10.7,51.3,-5.3,55.5',   // west,south,east,north: the island of Ireland

    START_CENTER: [53.4, -8.0],
    START_ZOOM: 7
};

const ALL_IRELAND = 'all_ireland';

// =========================================
//  Small helpers
// =========================================

const $ = (id) => document.getElementById(id);

// Colours come from map.css so they are only defined in one place
function cssVar(name) {
    return getComputedStyle(document.querySelector('.map-page')).getPropertyValue(name).trim();
}

const COLORS = {
    route:    cssVar('--route-public')   || '#008559',
    citylink: cssVar('--route-citylink') || '#ffd700',
    from:     cssVar('--stop-from')      || '#176b3a',
    to:       cssVar('--stop-to')        || '#a93226',
    bus:      cssVar('--bus')            || '#f08a24',
    you:      cssVar('--you')            || '#2563eb',
    access:   cssVar('--stop-accessible') || '#9b5de5'
};

// Wheelchair access values, the same as GTFS: 0 not known, 1 accessible, 2 not accessible
const ACCESS = { UNKNOWN: 0, YES: 1, NO: 2 };

function isAccessible(item) {
    const value = item && (item.properties ? item.properties.wheelchair : item.wheelchair);
    return value === ACCESS.YES;
}

function stopColor(stop) {
    return isAccessible(stop) ? COLORS.access : COLORS.route;
}

// "Only show wheelchair accessible stops" (in the journey panel). When ticked, stop search,
// nearby stops and the stops a journey can use are limited to accessible ones. Routes are not
// filtered. map.html?accessible=1 also ticks it.
const accessBox = document.getElementById('filter-accessible');
if (new URLSearchParams(window.location.search).get('accessible') === '1') accessBox.checked = true;

function accessibleOnly() {
    return accessBox.checked;
}

let accessibleCache = null;   // stopList filtered, rebuilt when the stop list changes
function usableStops() {
    if (!accessibleOnly()) return stopList;
    if (!accessibleCache || accessibleCache.from !== stopList) {
        accessibleCache = { from: stopList, list: stopList.filter(isAccessible) };
    }
    return accessibleCache.list;
}

function updateAccessStatus() {
    const status = document.getElementById('access-status');
    if (!accessibleOnly() || !stopList.length) {
        status.textContent = '';
        status.hidden = true;
        return;
    }
    const count = usableStops().length;
    status.hidden = false;
    status.textContent = count === 0
        ? 'No stops are marked wheelchair accessible yet, so no stops or journeys can be shown.'
        : 'Only stops marked wheelchair accessible are shown (' + count.toLocaleString('en-IE') + ' of ' +
          stopList.length.toLocaleString('en-IE') + ').';
}

// One line for a popup or stop card, or '' when nothing is known
function accessText(value, what) {
    if (value === ACCESS.YES) return '♿ Wheelchair accessible ' + what;
    if (value === ACCESS.NO) return 'Not wheelchair accessible';
    return '';
}

// Builds popup content with textContent, so odd characters in the data can't break the page
function popupContent(title, lines) {
    const box = document.createElement('div');

    const heading = document.createElement('span');
    heading.className = 'popup-title';
    heading.textContent = title;
    box.appendChild(heading);

    lines.filter(Boolean).forEach((text) => {
        const line = document.createElement('span');
        line.className = 'popup-line';
        line.textContent = text;
        box.appendChild(line);
    });
    return box;
}

function isCitylink(feature) {
    return (feature.properties.agency_name || '').toLowerCase().includes('citylink');
}

// =========================================
//  Map
// =========================================

const map = L.map('map', {
    center: CONFIG.START_CENTER,
    zoom: CONFIG.START_ZOOM,
    minZoom: 6,
    maxBounds: [[50.5, -12.5], [56.2, -4.0]],
    maxBoundsViscosity: 0.8,
    zoomControl: false,
    preferCanvas: true   // thousands of route lines draw much faster on a canvas
});

L.control.zoom({ position: 'topright' }).addTo(map);

L.tileLayer(CONFIG.TILE_URL, {
    maxZoom: 16,
    attribution: CONFIG.TILE_ATTRIBUTION
}).addTo(map);

const linesLayer = L.layerGroup().addTo(map);
const stopsLayer = L.layerGroup().addTo(map);
const busesLayer = L.layerGroup().addTo(map);
const journeyLayer = L.layerGroup().addTo(map);   // the chosen route, walking legs and stops

// =========================================
//  State
// =========================================

let allRoutes = [];          // every route feature from the GeoJSON
let activeRoute = null;      // the route whose live buses are showing, if any

// =========================================
//  Loading message (on top of the map)
// =========================================

function showMapMessage(text, options) {
    const box = $('map-message');
    box.hidden = false;
    box.classList.toggle('is-error', Boolean(options && options.error));
    $('map-message-text').textContent = text;
    $('map-retry').hidden = !(options && options.retry);
}

function hideMapMessage() {
    $('map-message').hidden = true;
}

// =========================================
//  Route finder sheet (collapse / expand)
// =========================================

const sheet = $('plan-sheet');
const sheetToggle = $('sheet-toggle');

sheetToggle.addEventListener('click', () => {
    const collapsed = sheet.classList.toggle('is-collapsed');
    sheetToggle.setAttribute('aria-expanded', String(!collapsed));
});

// Dragging the map tucks the sheet away so there is room to move around.
// Tap the handle to bring it back.
map.on('dragstart', () => {
    if (sheet.classList.contains('is-collapsed')) return;
    sheet.classList.add('is-collapsed');
    sheetToggle.setAttribute('aria-expanded', 'false');
});

// Room to leave around routes so they aren't hidden under the top bar or the sheet
function fitPadding() {
    const topBar = document.querySelector('.map-topbar').getBoundingClientRect();
    const mapBox = $('map').getBoundingClientRect();
    const sheetBox = sheet.getBoundingClientRect();
    return {
        paddingTopLeft: [24, Math.round(topBar.bottom - mapBox.top) + 16],
        paddingBottomRight: [24, Math.round(mapBox.bottom - sheetBox.top) + 30]
    };
}

// Always leave this much map between the paddings. With the sheet pulled up there can be almost
// none, and Leaflet then zooms all the way in.
const MIN_FIT_HEIGHT = 160;

function fitTo(bounds, extra) {
    if (!bounds || !bounds.isValid()) return;
    const options = Object.assign(fitPadding(), extra || {});
    const top = options.paddingTopLeft[1];
    const room = map.getSize().y - top - options.paddingBottomRight[1];
    if (room < MIN_FIT_HEIGHT) {
        options.paddingBottomRight = [options.paddingBottomRight[0], Math.max(0, map.getSize().y - top - MIN_FIT_HEIGHT)];
    }
    map.fitBounds(bounds, options);
}

// =========================================
//  Loading the route data
// =========================================

async function loadRoutes() {
    showMapMessage('Loading routes… the first load can take a moment.');

    const accessLoad = loadAccessibility();   // downloads alongside the route index
    try {
        const response = await fetch(CONFIG.INDEX_URL);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        allRoutes = buildRoutes(await response.json());
        if (allRoutes.length === 0) throw new Error('No routes in file');
        applyAccessibility(await accessLoad);
    } catch (error) {
        console.error('Could not load route data:', error);
        showMapMessage(
            "We couldn't load the bus routes. Check that the route data file is in place and try again.",
            { error: true, retry: true }
        );
        return;
    }

    buildStopIndex();
    refreshLocationFeatures();
    hideMapMessage();
    onRoutesLoaded();
    prefetchRegionLines();
}

// Turns the compact index.json into route objects (shaped like GeoJSON features).
// Their lines (geometry) are filled in later by loadGeo().
function buildRoutes(data) {
    if (!data || !Array.isArray(data.stops) || !Array.isArray(data.routes)) throw new Error('Bad route index');
    // Older index files have no wheelchair item, so those stops and routes count as not known
    const stops = data.stops.map((s) => ({ id: String(s[0]), name: s[1], lat: s[2], lon: s[3], wheelchair: s[4] || ACCESS.UNKNOWN }));
    return data.routes.map((r) => ({
        type: 'Feature',
        geometry: null,
        geoKey: r[6],
        properties: {
            route_id: r[0], short_name: r[1], long_name: r[2], agency_name: r[3],
            region: r[4], display_name: r[5],
            stops: r[7].map((i) => stops[i]),
            wheelchair: r[8] || ACCESS.UNKNOWN
        }
    }));
}

// ---------- Wheelchair access from data/accessibility.json ----------
// { "stops":  { "<stop id>":  true | false | 1 | 2, ... },        checked by hand
//   "routes": { "<route id>": true | false | 1 | 2, ... },        checked by hand
//   "ptims":  { "accessible": [ids], "not_accessible": [ids] } }  written by import-ptims.js
// true or 1 = accessible, false or 2 = not accessible. Hand-checked values win over PTIMS, and both
// replace what index.json says. A missing or broken file is ignored, so the map still loads.
async function loadAccessibility() {
    try {
        const response = await fetch(CONFIG.ACCESS_URL, { cache: 'no-cache' });
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.warn('Could not read ' + CONFIG.ACCESS_URL + ':', error);
        return null;
    }
}

function accessValue(value) {
    if (value === true || value === ACCESS.YES) return ACCESS.YES;
    if (value === false || value === ACCESS.NO) return ACCESS.NO;
    return null;   // anything else is ignored
}

function applyAccessibility(data) {
    if (!data || typeof data !== 'object') return;
    const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
    const routeValues = isObject(data.routes) ? data.routes : {};

    // Stop id -> value: PTIMS first, then hand-checked stops on top
    const stopValues = new Map();
    const ptims = isObject(data.ptims) ? data.ptims : {};
    [['accessible', ACCESS.YES], ['not_accessible', ACCESS.NO]].forEach(([list, value]) => {
        if (Array.isArray(ptims[list])) ptims[list].forEach((id) => stopValues.set(String(id), value));
    });
    if (isObject(data.stops)) {
        Object.keys(data.stops).forEach((id) => {
            const value = accessValue(data.stops[id]);
            if (value !== null) stopValues.set(id, value);
        });
    }

    allRoutes.forEach((feature) => {
        const p = feature.properties;
        const routeValue = Object.prototype.hasOwnProperty.call(routeValues, p.route_id) ? accessValue(routeValues[p.route_id]) : null;
        if (routeValue !== null) p.wheelchair = routeValue;
        // Stop objects are shared between routes, so setting one sets it everywhere
        p.stops.forEach((stop) => {
            if (stopValues.has(stop.id)) stop.wheelchair = stopValues.get(stop.id);
        });
    });

    // CC BY 4.0 asks for credit wherever the data is shown
    if (Array.isArray(ptims.accessible) && ptims.accessible.length) {
        map.attributionControl.addAttribution('Stop accessibility: NTA PTIMS (CC BY 4.0)');
    }
}

// ---------- Route lines, loaded one region at a time ----------
const geoLoads = new Map();      // region -> promise
const geoLoaded = new Set();     // regions whose lines are ready

function regionSlug(region) {
    return region.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function loadGeo(region) {
    if (!geoLoads.has(region)) {
        const job = fetch(CONFIG.GEO_URL + regionSlug(region) + '.json')
            .then((response) => {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then((lines) => {
                allRoutes.forEach((f) => {
                    if (f.properties.region === region && lines[f.geoKey]) {
                        f.geometry = { type: 'LineString', coordinates: lines[f.geoKey] };
                    }
                });
                geoLoaded.add(region);
            });
        job.catch(() => geoLoads.delete(region));   // allow a retry
        geoLoads.set(region, job);
    }
    return geoLoads.get(region);
}

// Quietly download the route lines in the background (smallest first) so picking a region is instant.
// Only downloads them: they are read when needed. Skipped on Data Saver or slow connections.
function prefetchRegionLines() {
    const net = navigator.connection;
    if (net && (net.saveData || /^(slow-2g|2g)$/.test(net.effectiveType))) return;
    const slow = Boolean(net && net.effectiveType === '3g');   // skip the two big files on slow connections

    const order = ['Waterford', 'Limerick', 'Cork', 'Galway', 'Dublin', 'Other / National'];
    const regions = [...new Set(allRoutes.map((f) => f.properties.region))]
        .sort((a, b) => order.indexOf(a) - order.indexOf(b))
        .filter((r) => !(slow && (r === 'Dublin' || r === 'Other / National')));

    const start = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    start(async () => {
        for (const region of regions) {
            if (geoLoads.has(region)) continue;   // already being loaded
            try {
                const response = await fetch(CONFIG.GEO_URL + regionSlug(region) + '.json');
                if (response.ok) await response.blob();
            } catch (error) {
                return;   // offline or blocked: stop quietly, the normal load will report it
            }
        }
    });
}

function ensureGeo(regions) {
    return Promise.all([...new Set(regions)].map(loadGeo));
}

// A short message in the map message box that fades away
let toastTimer = null;
function showToast(text) {
    showMapMessage(text);
    $('map-message').classList.add('is-error');   // hides the spinner
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideMapMessage, 2500);
}

// =========================================
//  Live buses
// =========================================

function setLiveStatus(text) {
    const el = $('live-status');
    el.textContent = text;
    el.hidden = !text;
}

function busIcon() {
    return L.divIcon({
        className: 'bus-marker',
        html: '<span class="bus-pulse"></span><span class="bus-dot"></span>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });
}

let liveController = null;

async function fetchLiveBuses() {
    if (!activeRoute) {
        busesLayer.clearLayers();
        setLiveStatus('');
        return;
    }

    const routeId = activeRoute.properties.route_id;

    // Cancel a slow request that is still running
    if (liveController) liveController.abort();
    const controller = new AbortController();
    liveController = controller;
    // A hosted free server can take a while to wake up, so wait longer before giving up
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
        const response = await fetch(CONFIG.LIVE_URL + '?route_id=' + encodeURIComponent(routeId), {
            signal: controller.signal,
            cache: 'no-store'   // never reuse an old answer (a cached empty list looked like "no buses")
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const buses = await response.json();
        if (!Array.isArray(buses)) throw new Error('Unexpected reply');

        // The person may have picked a different route (or a newer request started) while we waited
        if (liveController !== controller || !activeRoute || activeRoute.properties.route_id !== routeId) return;

        busesLayer.clearLayers();
        buses.forEach((bus) => {
            const marker = L.marker([bus.lat, bus.lon], { icon: busIcon(), keyboard: false }).addTo(busesLayer);
            const speed = typeof bus.speed === 'number' ? Math.round(bus.speed * 3.6) + ' km/h' : 'Speed unknown';
            marker.bindPopup(popupContent('Live bus', ['Route ' + activeRoute.properties.short_name, speed]));
        });

        setLiveStatus(buses.length === 0
            ? 'No live buses on this route right now.'
            : buses.length + (buses.length === 1 ? ' live bus' : ' live buses') + ' on this route.');
    } catch (error) {
        // A newer request replaced this one, or the route changed: say nothing
        if (liveController !== controller || !activeRoute || activeRoute.properties.route_id !== routeId) return;
        console.warn('Live buses unavailable:', error);
        busesLayer.clearLayers();
        setLiveStatus('Live bus positions are not available right now.');
    } finally {
        clearTimeout(timeout);
    }
}

// Refresh while the page is visible and a route is selected
setInterval(() => {
    if (!document.hidden && activeRoute) fetchLiveBuses();
}, CONFIG.LIVE_REFRESH_MS);

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeRoute) fetchLiveBuses();
});

// =========================================
//  Stop index (every stop in the data, for searching)
// =========================================

// id -> { id, name, lat, lon, search, hits: [routeIndex, stopPosition, routeIndex, stopPosition, ...] }
const stopIndex = new Map();
let stopList = [];

function normalise(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function buildStopIndex() {
    stopIndex.clear();
    allRoutes.forEach((feature, routeIdx) => {
        const stops = feature.properties.stops;
        if (!Array.isArray(stops)) return;
        stops.forEach((stop, position) => {
            if (!stop || stop.id == null) return;
            const id = String(stop.id);
            let entry = stopIndex.get(id);
            if (!entry) {
                entry = { id: id, name: String(stop.name || 'Unnamed stop'), lat: stop.lat, lon: stop.lon,
                          wheelchair: stop.wheelchair || ACCESS.UNKNOWN, search: normalise(stop.name) + ' ' + id, hits: [] };
                stopIndex.set(id, entry);
            }
            entry.hits.push(routeIdx, position);
        });
    });
    stopList = Array.from(stopIndex.values());
    buildPlaces();
}

// =========================================
//  Places: stops with the same name next to each other
//  "Eyre Square" is ten poles around the square, and most stops have one on each side of the road.
//  Searching shows the place once, and finding buses uses every pole in it.
// =========================================

const PLACE_RADIUS_M = 400;
let placeList = [];
const placeOfStop = new Map();   // stop id -> place

function buildPlaces() {
    placeList = [];
    placeOfStop.clear();
    const byName = new Map();
    stopList.forEach((stop) => {
        const key = normalise(stop.name).trim();
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(stop);
    });

    byName.forEach((stops) => {
        const groups = [];
        stops.forEach((stop) => {
            // Join the first group that has a pole close by (one "Main Street" per town)
            const group = groups.find((g) => g.some((o) => distanceM(o.lat, o.lon, stop.lat, stop.lon) <= PLACE_RADIUS_M));
            if (group) group.push(stop); else groups.push([stop]);
        });
        groups.forEach((members) => {
            const hits = [];
            const routeNames = new Set();
            let region = '';
            members.forEach((m) => {
                for (let i = 0; i < m.hits.length; i += 2) {
                    hits.push(m.hits[i], m.hits[i + 1]);
                    const feature = allRoutes[m.hits[i]];
                    routeNames.add(feature.properties.short_name);
                    if (!region) region = feature.properties.region || '';
                }
            });
            const place = {
                id: members.length === 1 ? members[0].id : 'place:' + members[0].id,
                name: members[0].name,
                lat: members.reduce((sum, m) => sum + m.lat, 0) / members.length,
                lon: members.reduce((sum, m) => sum + m.lon, 0) / members.length,
                stops: members,
                hits: hits,
                routeCount: routeNames.size,
                region: region === ALL_IRELAND ? '' : region,
                // Stop numbers are searchable too, in any case
                search: normalise(members[0].name) + ' ' + members.map((m) => m.id.toLowerCase()).join(' ')
            };
            placeList.push(place);
            members.forEach((m) => placeOfStop.set(m.id, place));
        });
    });
}

// The place a single stop belongs to (or the stop itself if places aren't built yet)
function placeFor(stop) {
    return (stop && placeOfStop.get(String(stop.id))) || stop || null;
}

// Best matches first: name starts with the text, then a word starts with it, then anywhere.
// With "Only show wheelchair accessible stops" ticked, other stops are left out.
function searchStops(query, limit) {
    const text = normalise(query).trim();
    if (text.length < 2) return [];
    const tokens = text.split(/\s+/);
    const scored = [];

    for (const stop of usableStops()) {
        if (!tokens.every((t) => stop.search.includes(t))) continue;
        let rank = 2;
        if (stop.search.startsWith(text)) rank = 0;
        else if (stop.search.includes(' ' + tokens[0])) rank = 1;
        scored.push({ stop: stop, rank: rank });
    }

    scored.sort((a, b) => a.rank - b.rank || b.stop.hits.length - a.stop.hits.length || a.stop.name.localeCompare(b.stop.name));
    return scored.slice(0, limit).map((x) => x.stop);
}


// The part of a route line between two stops (falls back to joining the stops)
function segmentLatLngs(feature, fromPos, toPos) {
    const stops = feature.properties.stops;
    const straight = stops.slice(fromPos, toPos + 1).map((s) => [s.lat, s.lon]);
    const geometry = feature.geometry;
    if (!geometry || geometry.type !== 'LineString' || geometry.coordinates.length < 2) return straight;

    const nearest = (stop) => {
        let best = 0;
        let bestDistance = Infinity;
        geometry.coordinates.forEach((c, i) => {
            const d = (c[1] - stop.lat) ** 2 + (c[0] - stop.lon) ** 2;
            if (d < bestDistance) { bestDistance = d; best = i; }
        });
        return best;
    };
    const a = nearest(stops[fromPos]);
    const b = nearest(stops[toPos]);
    if (a >= b) return straight;
    return geometry.coordinates.slice(a, b + 1).map((c) => [c[1], c[0]]);
}

// =========================================
//  Stop card: what you see when you tap a stop
//  Shows the buses that serve it and, when the live server has them, the next arrivals.
// =========================================

const STOP_TIMES_REFRESH_MS = 30000;
const STOP_TIMES_FRESH_MS = 10000;     // reuse a recent answer instead of asking again
const stopTimesCache = new Map();      // stop id -> { time, data }
let stopTimesTimer = null;
let routeByIdMap = null;

function routeById(routeId) {
    if (!routeByIdMap) {
        routeByIdMap = new Map();
        allRoutes.forEach((f) => routeByIdMap.set(f.properties.route_id, f));
    }
    return routeByIdMap.get(routeId) || null;
}

function routeBadge(feature, fallbackText) {
    const badge = document.createElement('span');
    badge.className = 'bus-badge' + (feature && isCitylink(feature) ? ' is-citylink' : '');
    badge.textContent = feature ? (feature.properties.short_name || '?') : (fallbackText || '?');
    return badge;
}

// The distinct routes that stop at this stop, in number order
function routesAtStop(stopId) {
    const entry = stopIndex.get(String(stopId));
    if (!entry) return [];
    const seen = new Map();
    for (let i = 0; i < entry.hits.length; i += 2) {
        const feature = allRoutes[entry.hits[i]];
        if (feature && !seen.has(feature.properties.display_name)) seen.set(feature.properties.display_name, feature);
    }
    return Array.from(seen.values()).sort((a, b) =>
        String(a.properties.short_name).localeCompare(String(b.properties.short_name), undefined, { numeric: true }));
}

function formatArrival(secondsFromNow, epochSeconds) {
    if (secondsFromNow <= 60) return 'Due';
    const minutes = Math.round(secondsFromNow / 60);
    if (minutes < 60) return minutes + ' min';
    return new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDelay(delaySeconds) {
    if (delaySeconds === null || delaySeconds === undefined) return '';
    const minutes = Math.round(delaySeconds / 60);
    if (minutes === 0) return 'On time';
    return minutes > 0 ? minutes + ' min late' : Math.abs(minutes) + ' min early';
}

function renderStopTimes(container, data) {
    container.innerHTML = '';
    const nowSeconds = data.now || Math.floor(Date.now() / 1000);
    const rows = data.arrivals.slice(0, 5);

    if (rows.length === 0) {
        const none = document.createElement('p');
        none.className = 'stop-times-note';
        none.textContent = 'No buses due soon.';
        container.appendChild(none);
        return;
    }

    rows.forEach((a) => {
        const feature = routeById(a.routeId);
        const row = document.createElement('div');
        row.className = 'stop-time-row';
        row.appendChild(routeBadge(feature, '?'));

        const text = document.createElement('div');
        text.className = 'stop-time-text';
        const where = document.createElement('span');
        where.textContent = feature ? (feature.properties.long_name || feature.properties.display_name) : 'Route unknown';
        text.appendChild(where);
        const delay = formatDelay(a.delay);
        if (delay) {
            const small = document.createElement('small');
            small.textContent = delay;
            small.className = a.delay > 60 ? 'is-late' : (a.delay < -60 ? 'is-early' : 'is-ontime');
            text.appendChild(small);
        }
        row.appendChild(text);

        const when = document.createElement('strong');
        when.className = 'stop-time-when';
        when.textContent = a.time !== null ? formatArrival(a.time - nowSeconds, a.time) : '';
        row.appendChild(when);

        container.appendChild(row);
    });
}

async function loadStopTimes(container, stopId) {
    const cached = stopTimesCache.get(stopId);
    if (cached && Date.now() - cached.time < STOP_TIMES_FRESH_MS) {
        renderStopTimes(container, cached.data);
        return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
        const response = await fetch(CONFIG.STOP_TIMES_URL + '?stop_id=' + encodeURIComponent(stopId), { signal: controller.signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (!data || !Array.isArray(data.arrivals)) throw new Error('Unexpected reply');
        stopTimesCache.set(stopId, { time: Date.now(), data: data });
        if (container.isConnected) renderStopTimes(container, data);
    } catch (error) {
        console.warn('Stop times unavailable:', error);
        if (container.isConnected) {
            container.innerHTML = '';
            const note = document.createElement('p');
            note.className = 'stop-times-note';
            note.textContent = 'Live times are not available right now.';
            container.appendChild(note);
        }
    } finally {
        clearTimeout(timeout);
    }
}

// extraLines: small grey lines under the name. titlePrefix: for example "From".
function stopCard(stop, extraLines, titlePrefix) {
    const box = document.createElement('div');
    box.className = 'stop-card';

    const heading = document.createElement('span');
    heading.className = 'popup-title';
    heading.textContent = (titlePrefix ? titlePrefix + ': ' : '') + stop.name;
    box.appendChild(heading);

    ['Stop ' + stop.id, accessText(stop.wheelchair, 'stop')].concat(extraLines || []).filter(Boolean).forEach((text) => {
        const line = document.createElement('span');
        line.className = 'popup-line';
        line.textContent = text;
        box.appendChild(line);
    });

    // Buses that stop here
    const routes = routesAtStop(stop.id);
    if (routes.length) {
        const title = document.createElement('h3');
        title.className = 'stop-card-title';
        title.textContent = routes.length === 1 ? 'Bus that stops here' : 'Buses that stop here';
        box.appendChild(title);

        const chips = document.createElement('div');
        chips.className = 'stop-chips';
        routes.slice(0, 10).forEach((feature) => {
            const chip = routeBadge(feature);
            chip.title = feature.properties.long_name || '';
            chips.appendChild(chip);
        });
        if (routes.length > 10) {
            const more = document.createElement('span');
            more.className = 'stop-chips-more';
            more.textContent = '+' + (routes.length - 10) + ' more';
            chips.appendChild(more);
        }
        box.appendChild(chips);
    }

    // Next buses (needs the live server)
    clearInterval(stopTimesTimer);
    if (CONFIG.STOP_TIMES_URL) {
        const title = document.createElement('h3');
        title.className = 'stop-card-title';
        title.textContent = 'Next buses';
        box.appendChild(title);

        const times = document.createElement('div');
        times.className = 'stop-times';
        times.setAttribute('aria-live', 'polite');
        const loading = document.createElement('p');
        loading.className = 'stop-times-note';
        loading.textContent = 'Checking live times…';
        times.appendChild(loading);
        box.appendChild(times);

        loadStopTimes(times, String(stop.id));
        stopTimesTimer = setInterval(() => {
            if (times.isConnected && !document.hidden) loadStopTimes(times, String(stop.id));
        }, STOP_TIMES_REFRESH_MS);
    }

    return box;
}

function bindStopCard(marker, stop, extraLines, titlePrefix) {
    marker.bindPopup(() => stopCard(stop, extraLines, titlePrefix), { minWidth: 230, maxWidth: 290 });
}

map.on('popupclose', () => clearInterval(stopTimesTimer));

function endpointMarker(stop, color, label) {
    const marker = L.circleMarker([stop.lat, stop.lon], {
        radius: 10, fillColor: color, fillOpacity: 1, color: '#ffffff', weight: 3, opacity: 1
    });
    bindStopCard(marker, stop, [], label);
    return marker;
}

// =========================================
//  My location
//  Off until the person says yes. If the browser blocks it, everything that
//  needs it hides or greys out. The position never leaves the device.
// =========================================

const LOC_KEY = 'hop.location';
const NEARBY_MAX_M = 3000;
const NEARBY_COUNT = 5;

const loc = {
    supported: window.isSecureContext && 'geolocation' in navigator,
    perm: 'unknown',     // 'granted' | 'denied' | 'prompt' | 'unknown' (from the browser)
    on: false,           // the person's own switch
    asked: false,        // has the first-time question been answered?
    fix: null,           // { lat, lon, acc }
    watchId: null,
    centerNext: false,
    error: ''
};

const youLayer = L.layerGroup().addTo(map);
let nearbyBuiltAt = null;

function readLocPrefs() {
    try {
        const saved = JSON.parse(localStorage.getItem(LOC_KEY) || '{}');
        loc.on = saved.on === true;
        loc.asked = saved.asked === true;
    } catch (e) { /* storage blocked: start with defaults */ }
}

function saveLocPrefs() {
    try { localStorage.setItem(LOC_KEY, JSON.stringify({ on: loc.on, asked: loc.asked })); } catch (e) { /* ignore */ }
}

const locUsable = () => loc.supported && loc.perm !== 'denied';
const locActive = () => locUsable() && loc.on;

function locDisabledReason() {
    if (!window.isSecureContext) return 'Needs a secure (https) connection';
    if (!('geolocation' in navigator)) return 'Not available on this device';
    if (loc.perm === 'denied') return 'Blocked in your browser settings. Allow location for this site to use it.';
    return '';
}

function locStatusText() {
    if (!locUsable()) return locDisabledReason();
    if (!loc.on) return 'Off';
    if (loc.fix) return 'On · accurate to about ' + formatDistance(Math.max(loc.fix.acc || 0, 10));
    if (loc.error === 'unavailable') return "Can't find your position right now";
    if (loc.error === 'timeout') return 'Taking a while to find you…';
    return 'Finding you…';
}

function updateLocationUI() {
    const usable = locUsable();
    const sw = $('location-switch');
    sw.checked = locActive();
    sw.disabled = !usable;
    $('location-row').classList.toggle('is-disabled', !usable);
    $('location-status').textContent = locStatusText();

    const btn = locateButton;
    if (btn) {
        btn.setAttribute('aria-disabled', String(!usable));
        btn.classList.toggle('is-on', locActive());
        btn.title = !usable ? locDisabledReason() : (locActive() ? 'Go to my location' : 'Turn on my location');
        btn.setAttribute('aria-label', btn.title);
    }

    if (locActive()) startWatch(); else stopWatch();
    refreshLocationFeatures();
}

function refreshLocationFeatures() {
    drawYou();
    updateNearby();
    onLocationChanged();
}

function startWatch() {
    if (loc.watchId !== null || !loc.supported || document.hidden) return;
    loc.watchId = navigator.geolocation.watchPosition(onFix, onLocError, {
        enableHighAccuracy: true, maximumAge: 10000, timeout: 20000
    });
}

function stopWatch() {
    if (loc.watchId === null) return;
    navigator.geolocation.clearWatch(loc.watchId);
    loc.watchId = null;
}

function onFix(position) {
    const c = position.coords;
    loc.fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy };
    loc.error = '';
    if (loc.perm !== 'granted') loc.perm = 'granted';
    $('location-status').textContent = locStatusText();
    if (loc.centerNext) {
        loc.centerNext = false;
        const ll = L.latLng(c.latitude, c.longitude);
        fitTo(L.latLngBounds([ll, ll]), { maxZoom: 15 });
    }
    refreshLocationFeatures();
    updateLocateButtonState();
}

function onLocError(error) {
    if (error && error.code === 1) {            // permission denied
        loc.perm = 'denied';
        loc.fix = null;
        stopWatch();
        updateLocationUI();
        return;
    }
    loc.error = error && error.code === 3 ? 'timeout' : 'unavailable';
    $('location-status').textContent = locStatusText();
}

function updateLocateButtonState() {
    if (locateButton) locateButton.classList.toggle('is-on', locActive());
}

// ----- The blue dot -----

function drawYou() {
    youLayer.clearLayers();
    if (!(locActive() && loc.fix)) return;
    const ll = [loc.fix.lat, loc.fix.lon];
    if (loc.fix.acc && loc.fix.acc <= 2000) {
        L.circle(ll, {
            radius: loc.fix.acc, color: COLORS.you, weight: 1, opacity: 0.4,
            fillColor: COLORS.you, fillOpacity: 0.1, interactive: false
        }).addTo(youLayer);
    }
    const icon = L.divIcon({
        className: 'you-marker',
        html: '<span class="you-pulse"></span><span class="you-dot"></span>',
        iconSize: [26, 26], iconAnchor: [13, 13]
    });
    L.marker(ll, { icon: icon, keyboard: false, zIndexOffset: 1000, interactive: false }).addTo(youLayer);
}

// ----- Nearest stops -----

function distanceM(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

function formatDistance(m) {
    if (m < 1000) return Math.round(m / 10) * 10 + ' m';
    return (m / 1000).toFixed(1) + ' km';
}

function nearestStops(lat, lon, count, maxM, list) {
    const pool = list || stopList;
    const found = [];
    for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        // cheap box test first so thousands of stops stay fast
        if (Math.abs(s.lat - lat) > 0.1 || Math.abs(s.lon - lon) > 0.15) continue;
        const d = distanceM(lat, lon, s.lat, s.lon);
        if (d <= maxM) found.push({ stop: s, d: d });
    }
    found.sort((a, b) => a.d - b.d);
    return found.slice(0, count);
}

const nearbyLayer = L.layerGroup();

function updateNearby() {
    const box = $('nearby');
    const list = $('nearby-list');
    const active = locActive() && loc.fix && stopList.length;

    if (!active) {
        box.hidden = true;
        nearbyLayer.clearLayers();
        map.removeLayer(nearbyLayer);
        nearbyBuiltAt = null;
        return;
    }

    // Don't rebuild for tiny GPS jitter
    if (nearbyBuiltAt && distanceM(nearbyBuiltAt.lat, nearbyBuiltAt.lon, loc.fix.lat, loc.fix.lon) < 25 && !box.hidden) return;
    nearbyBuiltAt = { lat: loc.fix.lat, lon: loc.fix.lon };

    const near = nearestStops(loc.fix.lat, loc.fix.lon, NEARBY_COUNT, NEARBY_MAX_M, usableStops());
    list.innerHTML = '';
    nearbyLayer.clearLayers();
    box.hidden = false;
    $('nearby-count').textContent = near.length ? ' (' + near.length + ')' : '';

    if (!near.length) {
        const li = document.createElement('li');
        li.className = 'nearby-empty';
        li.textContent = 'No bus stops within 3 km of you.';
        list.appendChild(li);
    }

    near.forEach((item) => {
        const marker = L.circleMarker([item.stop.lat, item.stop.lon], {
            radius: 7, color: '#ffffff', weight: 2, fillColor: stopColor(item.stop), fillOpacity: 1
        });
        bindStopCard(marker, item.stop, [formatDistance(item.d) + ' away']);
        nearbyLayer.addLayer(marker);

        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'nearby-item';
        const name = document.createElement('strong');
        name.textContent = item.stop.name;
        const dist = document.createElement('small');
        dist.textContent = formatDistance(item.d) + ' away';
        button.appendChild(name);
        button.appendChild(dist);
        button.addEventListener('click', () => {
            map.setView([item.stop.lat, item.stop.lon], Math.max(map.getZoom(), 16));
            marker.openPopup();
        });
        li.appendChild(button);
        list.appendChild(li);
    });

    nearbyLayer.addTo(map);
}


// ----- Round button under the zoom buttons -----

let locateButton = null;
const LocateControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
        const bar = L.DomUtil.create('div', 'leaflet-bar locate-ctl');
        const a = L.DomUtil.create('a', 'locate-btn', bar);
        a.href = '#';
        a.setAttribute('role', 'button');
        a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
            'stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/>' +
            '<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';
        locateButton = a;
        L.DomEvent.disableClickPropagation(bar);
        L.DomEvent.on(a, 'click', (e) => {
            L.DomEvent.preventDefault(e);
            if (!locUsable()) { showToast(locDisabledReason()); return; }
            if (!loc.on) { turnOn(); return; }
            if (loc.fix) {
                const ll = L.latLng(loc.fix.lat, loc.fix.lon);
                fitTo(L.latLngBounds([ll, ll]), { maxZoom: 15 });
            } else {
                showToast(locStatusText());
            }
        });
        return bar;
    }
});
map.addControl(new LocateControl());

function turnOn() {
    if (!locUsable()) return;
    loc.on = true;
    loc.asked = true;
    loc.centerNext = true;
    loc.error = '';
    saveLocPrefs();
    updateLocationUI();
}

function turnOff() {
    loc.on = false;
    loc.asked = true;
    loc.fix = null;
    loc.centerNext = false;
    saveLocPrefs();
    updateLocationUI();
}

$('location-switch').addEventListener('change', (event) => {
    if (event.target.checked) turnOn(); else turnOff();
});

// Stop using the GPS while the tab is hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopWatch(); else if (locActive()) startWatch();
});

// ----- First visit question -----

function showLocationDialog() {
    const dialog = $('location-dialog');
    if (typeof dialog.showModal !== 'function') return;
    let decided = false;
    const finish = (yes) => {
        if (decided) return;
        decided = true;
        if (dialog.open) dialog.close();
        if (yes) {
            turnOn();
        } else {
            loc.asked = true;
            saveLocPrefs();
        }
    };
    $('loc-allow').addEventListener('click', () => finish(true), { once: true });
    $('loc-skip').addEventListener('click', () => finish(false), { once: true });
    dialog.addEventListener('cancel', () => finish(false), { once: true });
    dialog.showModal();
}

function initLocation() {
    readLocPrefs();

    const start = () => {
        // Switch was on last time but the browser now asks again: stay off until they choose
        if (loc.on && loc.perm === 'prompt') { loc.on = false; saveLocPrefs(); }
        updateLocationUI();
        if (!loc.asked && loc.supported && loc.perm !== 'denied') showLocationDialog();
    };

    if (loc.supported && navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then((status) => {
            loc.perm = status.state;
            // They can change this in the browser's site settings at any time
            status.addEventListener('change', () => {
                loc.perm = status.state;
                if (loc.perm === 'denied') loc.fix = null;
                updateLocationUI();
            });
            start();
        }).catch(start);
    } else {
        start();
    }
}


// =========================================
//  Search bar and journeys
//  One search bar finds places, bus stops and routes. A stop or place becomes your destination, and
//  the panel lists the buses that get you there from where you are (or where you say you are).
//  A route number just shows that route and its live buses.
// =========================================

let currentView = 'idle';      // 'idle' | 'journey' | 'route'
const trip = { dest: null, origin: null };   // each is { kind: 'stop'|'place'|'location'|'pin', name, lat, lon, stop? }
let options = [];              // the buses for this journey, best first
let chosenKey = null;          // which one is shown on the map
let autoChosen = true;         // true until the person taps one themselves
let promptOpen = false;        // the "where are you starting from?" box
let planToken = 0;             // lets an old plan notice it has been replaced
let routeToken = 0;
let pinMode = false;           // waiting for a tap on the map
let lastNowSeconds = Math.floor(Date.now() / 1000);

const endpointLayer = L.layerGroup().addTo(map);   // your start and destination

function expandSheet() {
    sheet.classList.remove('is-collapsed');
    sheetToggle.setAttribute('aria-expanded', 'true');
}

function setView(view) {
    currentView = view;
    sheet.dataset.view = view;
    ['idle', 'journey', 'route'].forEach((v) => { $('view-' + v).hidden = v !== view; });
    if (view !== 'idle') expandSheet();
    updateSearchClear();
}

function setHint(text) {
    $('journey-hint').textContent = text || '';
}

// ---------- Places (Photon, built on OpenStreetMap) ----------

const placeCache = new Map();

async function searchPlaces(query, signal) {
    if (!CONFIG.PLACES_URL) return [];
    const key = HopJourney.normalise(query).trim();
    if (placeCache.has(key)) return placeCache.get(key);
    const url = CONFIG.PLACES_URL + '?q=' + encodeURIComponent(query) + '&limit=6&lang=en&bbox=' + CONFIG.PLACES_BBOX;
    const response = await fetch(url, { signal: signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const places = HopJourney.parsePlaces(await response.json(), 4);
    placeCache.set(key, places);
    return places;
}

// ---------- A search box that suggests stops, routes and places ----------
// config: { places: true/false, routes: true/false, onChoose(item), keepText: true/false }

function createCombobox(input, list, config) {
    let items = [];
    let active = -1;
    let token = 0;
    let timer = null;
    let controller = null;
    let status = '';

    function close() {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
    }

    function highlight(index) {
        active = index;
        Array.from(list.children).forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
        if (active >= 0 && list.children[active]) {
            input.setAttribute('aria-activedescendant', list.children[active].id);
            list.children[active].scrollIntoView({ block: 'nearest' });
        } else {
            input.removeAttribute('aria-activedescendant');
        }
    }

    function render() {
        list.innerHTML = '';
        items.forEach((item, i) => {
            const li = document.createElement('li');
            li.id = list.id + '-' + i;
            li.className = 'result result-' + item.type;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', 'false');
            const title = document.createElement('span');
            title.className = 'result-title';
            title.textContent = item.title;
            const sub = document.createElement('small');
            sub.textContent = item.sub;
            li.appendChild(title);
            li.appendChild(sub);
            li.addEventListener('click', () => choose(item));
            list.appendChild(li);
        });
        if (status) {
            const note = document.createElement('li');
            note.className = 'picker-empty';
            note.textContent = status;
            list.appendChild(note);
        }
        list.hidden = list.children.length === 0;
        input.setAttribute('aria-expanded', String(!list.hidden));
        active = -1;
    }

    function localItems(query) {
        const out = [];
        const seen = new Set();
        searchStops(query, 14).forEach((stop) => {
            if (seen.has(stop.name) || out.length >= 4) return;   // same-named stops are the two sides of a road
            seen.add(stop.name);
            const n = stop.hits.length / 2;
            out.push({ type: 'stop', title: stop.name, sub: 'Bus stop · ' + n + (n === 1 ? ' route' : ' routes'), stop: stop });
        });
        return out;
    }

    function routeItems(query) {
        return HopJourney.searchRoutes(allRoutes, query, 3).map((feature) => ({
            type: 'route',
            title: 'Route ' + feature.properties.short_name,
            sub: [feature.properties.long_name, feature.properties.agency_name].filter(Boolean).join(' · '),
            feature: feature
        }));
    }

    function run() {
        clearTimeout(timer);
        if (controller) controller.abort();
        const query = input.value.trim();
        const mine = ++token;
        status = '';
        if (query.length < 2) { items = []; render(); return; }

        const local = localItems(query);
        const routes = config.routes ? routeItems(query) : [];
        items = local.concat(routes);
        render();

        if (!config.places || query.length < 3 || !CONFIG.PLACES_URL) return;
        status = 'Searching places…';
        render();
        timer = setTimeout(async () => {
            controller = new AbortController();
            try {
                const places = await searchPlaces(query, controller.signal);
                if (mine !== token) return;
                status = '';
                const placeItems = places.map((p) => ({
                    type: 'place', title: p.name, sub: p.detail || 'Place', lat: p.lat, lon: p.lon
                }));
                // places go after the stops, before the routes
                items = local.concat(placeItems, routes);
                if (!items.length) status = 'Nothing found. Try another spelling or a nearby place.';
                render();
            } catch (error) {
                if (mine !== token || (error && error.name === 'AbortError')) return;
                console.warn('Place search unavailable:', error);
                status = items.length ? '' : "Place search isn't available right now. You can still search a stop or route.";
                render();
            }
        }, 350);
    }

    function choose(item) {
        clearTimeout(timer);
        if (controller) controller.abort();
        token++;
        close();
        input.value = config.keepText === false ? '' : item.title;
        input.blur();
        config.onChoose(item);
    }

    // Keep focus in the input while tapping a result
    list.addEventListener('mousedown', (event) => event.preventDefault());

    input.addEventListener('input', run);
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run(); });
    input.addEventListener('blur', () => { setTimeout(close, 120); });
    input.addEventListener('keydown', (event) => {
        const count = items.length;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (list.hidden) run();
            else if (count) highlight((active + 1) % count);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (count) highlight((active - 1 + count) % count);
        } else if (event.key === 'Enter') {
            if (!list.hidden && count) {
                event.preventDefault();
                choose(items[active >= 0 ? active : 0]);
            }
        } else if (event.key === 'Escape') {
            close();
        }
    });

    return { close: close };
}

// ---------- Choosing a destination, a route, or a starting point ----------

function updateSearchClear() {
    $('search-clear').hidden = !($('search-input').value || currentView !== 'idle');
}

function onSearchChoose(item) {
    if (item.type === 'stop') {
        setDestination({ kind: 'stop', name: item.stop.name, lat: item.stop.lat, lon: item.stop.lon, stop: item.stop });
    } else if (item.type === 'place') {
        setDestination({ kind: 'place', name: item.title, lat: item.lat, lon: item.lon });
    } else if (item.type === 'route') {
        showRoute(item.feature);
    }
}

function onOriginChoose(item) {
    if (item.type === 'stop') {
        setOrigin({ kind: 'stop', name: item.stop.name, lat: item.stop.lat, lon: item.stop.lon, stop: item.stop });
    } else if (item.type === 'place') {
        setOrigin({ kind: 'place', name: item.title, lat: item.lat, lon: item.lon });
    }
}

createCombobox($('search-input'), $('search-results'), { places: true, routes: true, onChoose: onSearchChoose });
createCombobox($('origin-input'), $('origin-results'), { places: true, routes: false, keepText: false, onChoose: onOriginChoose });

$('search-input').addEventListener('input', updateSearchClear);

function clearAll() {
    routeToken++;
    planToken++;
    trip.dest = null;
    trip.origin = null;
    options = [];
    chosenKey = null;
    autoChosen = true;
    promptOpen = false;
    pinMode = false;
    document.body.classList.remove('is-pinning');
    $('search-input').value = '';
    $('origin-input').value = '';
    journeyLayer.clearLayers();
    endpointLayer.clearLayers();
    busesLayer.clearLayers();
    activeRoute = null;
    setLiveStatus('');
    setHint('');
    $('option-list').innerHTML = '';
    setView('idle');
}

$('search-clear').addEventListener('click', () => {
    clearAll();
    $('search-input').focus();
});
$('dest-clear').addEventListener('click', clearAll);
$('route-clear').addEventListener('click', clearAll);

function locationOrigin() {
    return { kind: 'location', name: 'Your location', lat: loc.fix.lat, lon: loc.fix.lon };
}

function setDestination(dest) {
    routeToken++;
    journeyLayer.clearLayers();
    busesLayer.clearLayers();
    activeRoute = null;
    setLiveStatus('');
    trip.dest = dest;
    $('search-input').value = dest.name;
    autoChosen = true;
    if (!trip.origin && locActive() && loc.fix) trip.origin = locationOrigin();
    setView('journey');
    runPlan();
}

function setOrigin(origin) {
    trip.origin = origin;
    promptOpen = false;
    pinMode = false;
    document.body.classList.remove('is-pinning');
    $('origin-input').value = '';
    autoChosen = true;
    if (currentView !== 'journey') setView('journey');
    expandSheet();
    runPlan();
}

// ---------- Where are you starting from? ----------

function updatePoints() {
    const origin = trip.origin;
    $('dest-name').textContent = trip.dest ? trip.dest.name : '';
    $('origin-name').textContent = origin ? origin.name : 'Choose a starting point';
    $('origin-change').hidden = !origin;

    const showPrompt = !origin || promptOpen;
    $('origin-prompt').hidden = !showPrompt;
    const finding = locActive() && !loc.fix;
    $('origin-prompt-title').textContent = finding
        ? 'Finding your location… or choose where you are:'
        : (origin ? 'Choose a different starting point:' : 'Where are you starting from?');
    $('origin-use-location').hidden = Boolean(origin && origin.kind === 'location');
}

$('origin-change').addEventListener('click', () => {
    promptOpen = true;
    updatePoints();
    $('origin-input').focus();
});

$('origin-use-location').addEventListener('click', () => {
    if (!locUsable()) { showToast(locDisabledReason()); return; }
    if (!loc.on) turnOn();
    if (locActive() && loc.fix) setOrigin(locationOrigin());
    else { promptOpen = false; updatePoints(); setHint('Finding your location…'); }
});

$('origin-drop-pin').addEventListener('click', () => {
    pinMode = true;
    document.body.classList.add('is-pinning');
    sheet.classList.add('is-collapsed');
    sheetToggle.setAttribute('aria-expanded', 'false');
    showToast('Tap the map where you are, or close to it.');
});

map.on('click', (event) => {
    if (!pinMode) return;
    const near = nearestStops(event.latlng.lat, event.latlng.lng, 1, 1000)[0];
    setOrigin({
        kind: 'pin',
        name: near ? 'Pin near ' + near.stop.name : 'Dropped pin',
        lat: event.latlng.lat,
        lon: event.latlng.lng
    });
});

sheetToggle.addEventListener('click', () => {
    if (pinMode) { pinMode = false; document.body.classList.remove('is-pinning'); }
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && pinMode) {
        pinMode = false;
        document.body.classList.remove('is-pinning');
        expandSheet();
    }
});

// Called whenever your position is found, lost or changes
function onLocationChanged() {
    if (!trip.dest || currentView !== 'journey') return;
    const have = locActive() && loc.fix;
    if (!trip.origin) {
        if (have) setOrigin(locationOrigin()); else updatePoints();
        return;
    }
    if (trip.origin.kind !== 'location') return;
    if (!have) { trip.origin = null; runPlan(); return; }
    if (HopJourney.distanceM(trip.origin.lat, trip.origin.lon, loc.fix.lat, loc.fix.lon) > 200) {
        trip.origin = locationOrigin();
        runPlan();
    }
}

// ---------- Working out the journey ----------

async function runPlan() {
    const token = ++planToken;
    const keepKey = autoChosen ? null : chosenKey;
    journeyLayer.clearLayers();
    busesLayer.clearLayers();
    activeRoute = null;
    setLiveStatus('');
    options = [];
    chosenKey = null;
    $('option-list').innerHTML = '';
    setHint('');
    updatePoints();
    drawEndpoints();
    if (!trip.dest) return;

    if (!trip.origin) {
        fitTo(L.latLngBounds([[trip.dest.lat, trip.dest.lon], [trip.dest.lat, trip.dest.lon]]), { maxZoom: 15 });
        return;
    }

    // With the accessible filter on, you can only get on and off at accessible stops
    const pool = usableStops();
    const access = accessibleOnly();
    const stopsWord = access ? 'wheelchair accessible bus stops' : 'bus stops';
    const origins = HopJourney.stopsAround(pool, trip.origin, { near: 600, far: 3000, count: 40 });
    const dests = HopJourney.stopsAround(pool, trip.dest, { near: 600, far: 2500, count: 40 });

    if (!origins.length) {
        setHint('There are no ' + stopsWord + ' within 3 km of ' + trip.origin.name + '. Try a different starting point.');
        promptOpen = true;
        updatePoints();
        return;
    }
    if (!dests.length) {
        setHint('There are no ' + stopsWord + ' within 2.5 km of ' + trip.dest.name + '. Try a place closer to a bus route.');
        return;
    }

    options = HopJourney.planJourneys({ routes: allRoutes, stopIndex: stopIndex, origins: origins, dests: dests, max: 6 });
    if (!options.length) {
        setHint('No direct bus found from ' + trip.origin.name + ' to ' + trip.dest.name +
            (access ? ' that stops at wheelchair accessible stops at both ends' : '') +
            '. Try a nearby stop, or a different starting point.');
        promptOpen = true;
        updatePoints();
        fitJourneyPoints();
        return;
    }

    // Show them straight away from the timetable data, then add live times
    renderOptions();
    const keep = keepKey && options.find((o) => o.key === keepKey);
    chooseOption(keep || options[0], false, true);
    ensureGeo(options.map((o) => o.feature.properties.region))
        .then(() => { if (token === planToken) redrawJourney(false); })
        .catch((error) => console.warn('Route lines unavailable:', error));
    refreshLive(token);
}

function fitJourneyPoints() {
    const points = [];
    if (trip.origin) points.push([trip.origin.lat, trip.origin.lon]);
    if (trip.dest) points.push([trip.dest.lat, trip.dest.lon]);
    if (points.length) fitTo(L.latLngBounds(points), { maxZoom: 15 });
}

// ---------- Live arrivals for the buses on offer ----------

async function getStopTimes(stopId) {
    const cached = stopTimesCache.get(stopId);
    if (cached && Date.now() - cached.time < STOP_TIMES_FRESH_MS) return cached.data;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(CONFIG.STOP_TIMES_URL + '?stop_id=' + encodeURIComponent(stopId), { signal: controller.signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (!data || !Array.isArray(data.arrivals)) throw new Error('Unexpected reply');
        stopTimesCache.set(stopId, { time: Date.now(), data: data });
        return data;
    } catch (error) {
        console.warn('Stop times unavailable:', error);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

async function refreshLive(token) {
    if (!options.length) return;
    if (!CONFIG.STOP_TIMES_URL) {
        setHint('Live times are not available here, so these are timetable estimates and do not include waiting for the bus.');
        return;
    }

    const stopIds = Array.from(new Set(options.map((o) => o.fromStop.id)));
    const results = await Promise.all(stopIds.map(getStopTimes));
    if (token !== planToken) return;

    const byStop = {};
    let serverNow = 0;
    stopIds.forEach((id, i) => {
        if (results[i]) { byStop[id] = results[i]; serverNow = serverNow || results[i].now || 0; }
    });
    lastNowSeconds = serverNow || Math.floor(Date.now() / 1000);

    HopJourney.applyLive(options, byStop, lastNowSeconds);
    HopJourney.annotate(options);

    const anyLive = options.some((o) => o.live);
    setHint(anyLive
        ? ''
        : 'Live times are not available right now, so these are timetable estimates and do not include waiting for the bus.');

    renderOptions();
    // Keep what they picked; otherwise follow the quickest
    if (autoChosen && options[0] && options[0].key !== chosenKey) chooseOption(options[0], false, false);
    else updatePressed();
}

setInterval(() => {
    if (!document.hidden && currentView === 'journey' && options.length) refreshLive(planToken);
}, 30000);

// ---------- The list of buses ----------

function clockTime(minutesFromNow) {
    return new Date(Date.now() + minutesFromNow * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function delayText(minutes) {
    if (minutes === null || minutes === undefined) return '';
    if (minutes === 0) return 'on time';
    return minutes > 0 ? minutes + ' min late' : Math.abs(minutes) + ' min early';
}

function renderOptions() {
    const list = $('option-list');
    list.innerHTML = '';
    const anyLive = options.some((o) => o.live);

    options.forEach((opt, index) => {
        const p = opt.feature.properties;
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'option-card' + (opt.late ? ' is-late' : '');
        button.setAttribute('aria-pressed', String(opt.key === chosenKey));

        button.appendChild(routeBadge(opt.feature));

        const info = document.createElement('span');
        info.className = 'option-info';

        const title = document.createElement('strong');
        title.textContent = p.long_name || p.display_name || 'Bus route';
        info.appendChild(title);

        const when = document.createElement('small');
        when.className = 'option-when';
        if (opt.live) {
            const due = Math.max(0, Math.round(opt.waitMin + opt.walkToMin));
            when.textContent = 'Next bus ' + (due <= 1 ? 'due now' : 'in ' + HopJourney.formatMinutes(due));
            const d = delayText(opt.delayMin);
            if (d) {
                const chip = document.createElement('span');
                chip.className = 'delay-chip ' + (opt.late ? 'is-late' : (opt.delayMin < 0 ? 'is-early' : 'is-ontime'));
                chip.textContent = d;
                when.appendChild(chip);
            }
        } else {
            when.textContent = 'No live time for this bus';
        }
        info.appendChild(when);

        const board = document.createElement('small');
        board.textContent = 'Board at ' + opt.fromStop.name + ' · ' + opt.walkToMin + ' min walk';
        info.appendChild(board);

        const ride = document.createElement('small');
        ride.textContent = opt.stopsBetween + (opt.stopsBetween === 1 ? ' stop' : ' stops') +
            ' · about ' + opt.rideMin + ' min · off at ' + opt.toStop.name +
            (opt.walkFromMin ? ' · ' + opt.walkFromMin + ' min walk' : '');
        info.appendChild(ride);

        if (opt.advice) {
            const advice = document.createElement('small');
            advice.className = 'option-advice';
            advice.textContent = opt.advice;
            info.appendChild(advice);
        }
        button.appendChild(info);

        const total = document.createElement('span');
        total.className = 'option-total';
        const minutes = document.createElement('strong');
        minutes.textContent = HopJourney.formatMinutes(opt.live ? opt.etaMin : opt.baseMin);
        const note = document.createElement('small');
        note.textContent = opt.live ? 'arrive ' + clockTime(opt.etaMin) : 'without waiting';
        total.appendChild(minutes);
        total.appendChild(note);
        if (anyLive && index === 0 && options.length > 1) {
            const best = document.createElement('span');
            best.className = 'best-chip';
            best.textContent = 'Quickest';
            total.appendChild(best);
        }
        button.appendChild(total);

        button.addEventListener('click', () => chooseOption(opt, true));
        li.appendChild(button);
        list.appendChild(li);
    });
}

function updatePressed() {
    Array.from($('option-list').querySelectorAll('.option-card')).forEach((button, i) => {
        if (options[i]) button.setAttribute('aria-pressed', String(options[i].key === chosenKey));
    });
}

function chooseOption(opt, byUser, fit) {
    chosenKey = opt.key;
    if (byUser) autoChosen = false;
    updatePressed();
    redrawJourney(fit !== false);
    activeRoute = opt.feature;
    fetchLiveBuses();
}

// ---------- Drawing on the map ----------

function pinIcon(kind) {
    return L.divIcon({
        className: 'pin-marker is-' + kind,
        html: '<span></span>',
        iconSize: [26, 34],
        iconAnchor: [13, 34]
    });
}

function drawEndpoints() {
    endpointLayer.clearLayers();
    if (trip.dest) {
        L.marker([trip.dest.lat, trip.dest.lon], { icon: pinIcon('to'), keyboard: false, title: trip.dest.name }).addTo(endpointLayer);
    }
    const origin = trip.origin;
    if (origin && origin.kind !== 'location') {
        const marker = L.marker([origin.lat, origin.lon], {
            icon: pinIcon('from'), keyboard: false, title: origin.name, draggable: origin.kind === 'pin'
        }).addTo(endpointLayer);
        if (origin.kind === 'pin') {
            marker.on('dragend', () => {
                const at = marker.getLatLng();
                const near = nearestStops(at.lat, at.lng, 1, 1000)[0];
                setOrigin({ kind: 'pin', name: near ? 'Pin near ' + near.stop.name : 'Dropped pin', lat: at.lat, lon: at.lng });
            });
        }
    }
}

function walkLeg(from, to) {
    L.polyline([[from.lat, from.lon], [to.lat, to.lon]], {
        color: '#5a3d91', weight: 3, opacity: 0.9, dashArray: '2 7', interactive: false
    }).addTo(journeyLayer);
}

function redrawJourney(fit) {
    journeyLayer.clearLayers();

    // The other buses, faintly
    options.forEach((opt) => {
        if (opt.key === chosenKey) return;
        L.polyline(segmentLatLngs(opt.feature, opt.fromPos, opt.toPos), {
            color: isCitylink(opt.feature) ? COLORS.citylink : COLORS.route, weight: 4, opacity: 0.3
        }).addTo(journeyLayer);
    });

    const opt = options.find((o) => o.key === chosenKey);
    if (!opt) return;

    // The chosen bus: the whole line softly, the part you ride strongly
    const color = isCitylink(opt.feature) ? COLORS.citylink : COLORS.route;
    if (opt.feature.geometry) {
        L.geoJSON(opt.feature, { style: { color: color, weight: 5, opacity: 0.3 } }).addTo(journeyLayer);
    }
    const ride = L.polyline(segmentLatLngs(opt.feature, opt.fromPos, opt.toPos), { color: color, weight: 7, opacity: 1 }).addTo(journeyLayer);

    // Walking to the stop and from the stop
    if (trip.origin) walkLeg(trip.origin, opt.fromStop);
    if (trip.dest) walkLeg(opt.toStop, trip.dest);

    endpointMarker(opt.fromStop, COLORS.from, 'Board').addTo(journeyLayer);
    endpointMarker(opt.toStop, COLORS.to, 'Get off').addTo(journeyLayer);

    if (fit) {
        const bounds = ride.getBounds();
        if (trip.origin) bounds.extend([trip.origin.lat, trip.origin.lon]);
        if (trip.dest) bounds.extend([trip.dest.lat, trip.dest.lon]);
        fitTo(bounds, { maxZoom: 16 });
    }
}

// ---------- One route, picked from the search ----------

async function showRoute(feature) {
    const token = ++routeToken;
    planToken++;
    trip.dest = null;
    trip.origin = null;
    options = [];
    chosenKey = null;
    promptOpen = false;
    endpointLayer.clearLayers();
    journeyLayer.clearLayers();
    busesLayer.clearLayers();

    const p = feature.properties;
    $('search-input').value = 'Route ' + p.short_name;
    const slot = $('route-badge');
    slot.innerHTML = '';
    slot.appendChild(routeBadge(feature));
    $('route-title').textContent = p.long_name || p.display_name;
    $('route-sub').textContent = p.agency_name || '';
    setView('route');

    activeRoute = feature;
    fetchLiveBuses();

    // Both directions share a route id
    const same = allRoutes.filter((f) => f.properties.route_id === p.route_id);
    try {
        await ensureGeo(same.map((f) => f.properties.region));
    } catch (error) {
        console.warn('Route line unavailable:', error);
    }
    if (token !== routeToken) return;

    const color = isCitylink(feature) ? COLORS.citylink : COLORS.route;
    const layer = L.geoJSON({ type: 'FeatureCollection', features: same.filter((f) => f.geometry) }, {
        style: { color: color, weight: 5, opacity: 0.85 }
    }).addTo(journeyLayer);

    const stops = same.reduce((a, f) => (f.properties.stops.length > a.length ? f.properties.stops : a), []);
    const points = [];
    stops.forEach((stop, i) => {
        const marker = L.circleMarker([stop.lat, stop.lon], {
            radius: isAccessible(stop) ? 6 : 5, fillColor: stopColor(stop), fillOpacity: 0.9, color: '#ffffff', weight: 2, opacity: 1
        }).addTo(journeyLayer);
        bindStopCard(marker, stop, ['Stop ' + (i + 1) + ' of ' + stops.length + ' on route ' + p.short_name]);
        points.push([stop.lat, stop.lon]);
    });

    const bounds = layer.getBounds();
    if (bounds.isValid()) fitTo(bounds); else if (points.length) fitTo(L.latLngBounds(points));
}

// Opening map.html?mode=tickets (from the tickets page) lands on the search bar
function onRoutesLoaded() {
    const requested = new URLSearchParams(window.location.search).get('mode');
    if (requested === 'tickets') $('search-input').focus();
    updateAccessStatus();
    if (accessibleOnly()) expandSheet();   // so the ticked box is seen
}

// Ticking or unticking the accessible filter: a chosen stop that is not accessible is cleared,
// then the journey is worked out again with the stops that are left
accessBox.addEventListener('change', () => {
    updateAccessStatus();
    nearbyBuiltAt = null;
    updateNearby();
    if (!accessibleOnly()) {
        if (currentView === 'journey') runPlan();
        return;
    }

    const cleared = [];
    if (trip.dest && trip.dest.stop && !isAccessible(trip.dest.stop)) cleared.push(trip.dest.name);
    if (trip.origin && trip.origin.stop && !isAccessible(trip.origin.stop)) {
        cleared.push(trip.origin.name);
        trip.origin = null;
    }
    if (cleared.length) {
        showToast(cleared.join(' and ') + (cleared.length === 1 ? " isn't" : " aren't") +
            ' marked wheelchair accessible, so ' + (cleared.length === 1 ? 'it was' : 'they were') + ' cleared.');
    }
    if (trip.dest && trip.dest.stop && !isAccessible(trip.dest.stop)) {
        const origin = trip.origin;
        clearAll();
        if (origin) trip.origin = origin;   // keep a still-usable starting point for the next search
        return;
    }
    if (currentView === 'journey') runPlan();
});

// =========================================
//  Go
// =========================================

loadRoutes();
initLocation();
