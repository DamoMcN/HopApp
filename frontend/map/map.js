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

    // Live buses come from backend/live/vehicles.php, which runs on WAMP with the rest of the PHP.
    // (The optional Node version, backend/live/server.js, works too: set this to 'http://localhost:3000/api/vehicles'.)
    // The map still works without live buses.
    LIVE_URL: HOSTED_LIVE_URL || '../../backend/live/vehicles.php',
    LIVE_REFRESH_MS: 30000,

    // Light grey base map. map.css re-colours it purple.
    TILE_URL: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    TILE_ATTRIBUTION: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',

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
    you:      cssVar('--you')            || '#2563eb'
};

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
const ticketLayer = L.layerGroup();   // only on the map in "Buy a ticket" mode

// =========================================
//  State
// =========================================

let allRoutes = [];          // every route feature from the GeoJSON
let activeRoute = null;      // the single route picked in the dropdown, if any
const stopLookup = new Map();   // dropdown label -> stop id

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
// Tap the handle (or a tab) to bring it back.
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

function fitTo(bounds, extra) {
    if (!bounds || !bounds.isValid()) return;
    map.fitBounds(bounds, Object.assign(fitPadding(), extra || {}));
}

// =========================================
//  Loading the route data
// =========================================

async function loadRoutes() {
    showMapMessage('Loading routes… the first load can take a moment.');
    $('region-select').disabled = true;

    try {
        const response = await fetch(CONFIG.INDEX_URL);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        allRoutes = buildRoutes(await response.json());
        if (allRoutes.length === 0) throw new Error('No routes in file');
    } catch (error) {
        console.error('Could not load route data:', error);
        showMapMessage(
            "We couldn't load the bus routes. Check that the route data file is in place and try again.",
            { error: true, retry: true }
        );
        return;
    }

    fillRegions();
    buildStopIndex();
    refreshLocationFeatures();
    hideMapMessage();
    startInRequestedMode();
    prefetchRegionLines();
}

// Turns the compact index.json into route objects (shaped like GeoJSON features).
// Their lines (geometry) are filled in later by loadGeo().
function buildRoutes(data) {
    if (!data || !Array.isArray(data.stops) || !Array.isArray(data.routes)) throw new Error('Bad route index');
    const stops = data.stops.map((s) => ({ id: String(s[0]), name: s[1], lat: s[2], lon: s[3] }));
    return data.routes.map((r) => ({
        type: 'Feature',
        geometry: null,
        geoKey: r[6],
        properties: {
            route_id: r[0], short_name: r[1], long_name: r[2], agency_name: r[3],
            region: r[4], display_name: r[5],
            stops: r[7].map((i) => stops[i])
        }
    }));
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

function fillRegions() {
    const select = $('region-select');
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a region';
    select.appendChild(placeholder);

    const all = document.createElement('option');
    all.value = ALL_IRELAND;
    all.textContent = 'All of Ireland';
    select.appendChild(all);

    [...new Set(allRoutes.map((f) => f.properties.region))].sort().forEach((region) => {
        const option = document.createElement('option');
        option.value = region;
        option.textContent = region;
        select.appendChild(option);
    });

    select.disabled = false;
}

$('map-retry').addEventListener('click', loadRoutes);

// =========================================
//  Which routes are showing
// =========================================

function operatorAllowed(feature) {
    return isCitylink(feature) ? $('filter-citylink').checked : $('filter-tfi').checked;
}

// Routes in the chosen region that pass the operator filters
function visibleRoutes() {
    const region = $('region-select').value;
    if (!region) return [];

    const inRegion = region === ALL_IRELAND
        ? allRoutes
        : allRoutes.filter((f) => f.properties.region === region);

    return inRegion.filter(operatorAllowed);
}

function resetRouteSelection() {
    activeRoute = null;
    stopsLayer.clearLayers();
    busesLayer.clearLayers();
    stopLookup.clear();
    $('stop-selectors').hidden = true;
    $('depart-input').value = '';
    $('arrive-input').value = '';
    $('depart-list').innerHTML = '';
    $('arrive-list').innerHTML = '';
    $('trip-hint').textContent = '';
    setLiveStatus('');
}

let regionToken = 0;

async function updateRegionView() {
    const token = ++regionToken;
    const region = $('region-select').value;

    linesLayer.clearLayers();
    resetRouteSelection();

    $('operator-filters').hidden = !region;
    $('route-container').hidden = !region || region === ALL_IRELAND;

    if (!region) return;

    const routes = visibleRoutes();

    if (region !== ALL_IRELAND) {
        fillRouteDropdown(routes);
    }

    if (routes.length === 0) {
        showToast('No routes for these operators in this region.');
        return;
    }

    const needed = region === ALL_IRELAND ? [...new Set(allRoutes.map((f) => f.properties.region))] : [region];
    if (!needed.every((r) => geoLoaded.has(r))) showMapMessage('Loading routes…');
    try {
        await ensureGeo(needed);
    } catch (error) {
        console.error('Could not load route lines:', error);
        if (token === regionToken) showToast("Couldn't load these routes. Please try again.");
        return;
    }
    if (token !== regionToken) return;   // a different region was picked meanwhile

    hideMapMessage();
    drawLines(routes);
}

function fillRouteDropdown(routes) {
    const select = $('route-select');
    select.innerHTML = '';

    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'Show all in region';
    select.appendChild(all);

    // One entry per route name
    const unique = [...new Map(routes.map((f) => [f.properties.display_name, f])).values()];

    unique
        .sort((a, b) => String(a.properties.short_name).localeCompare(String(b.properties.short_name), undefined, { numeric: true }))
        .forEach((feature) => {
            const option = document.createElement('option');
            option.value = feature.properties.route_id;
            option.textContent = feature.properties.display_name;
            select.appendChild(option);
        });
}

$('region-select').addEventListener('change', updateRegionView);
$('filter-tfi').addEventListener('change', updateRegionView);
$('filter-citylink').addEventListener('change', updateRegionView);

// A short message in the map message box that fades away
let toastTimer = null;
function showToast(text) {
    showMapMessage(text);
    $('map-message').classList.add('is-error');   // hides the spinner
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideMapMessage, 2500);
}

// =========================================
//  Picking one route
// =========================================

$('route-select').addEventListener('change', (event) => {
    const routeId = event.target.value;
    resetRouteSelection();

    if (routeId === 'all') {
        drawLines(visibleRoutes());
        return;
    }

    activeRoute = allRoutes.find((f) => f.properties.route_id === routeId) || null;
    if (!activeRoute) return;

    // Show the stop pickers first: they make the sheet taller, and the map
    // needs to know the final sheet height to frame the route above it
    fillStopLists();
    $('stop-selectors').hidden = false;

    drawLines([activeRoute]);
    renderStops();
    fetchLiveBuses();
});

function fillStopLists() {
    const stops = (activeRoute && activeRoute.properties.stops) || [];

    stops.forEach((stop, index) => {
        const label = (index + 1) + '. ' + stop.name + ' (Stop ' + stop.id + ')';
        stopLookup.set(label, stop.id);

        ['depart-list', 'arrive-list'].forEach((listId) => {
            const option = document.createElement('option');
            option.value = label;
            $(listId).appendChild(option);
        });
    });
}

$('depart-input').addEventListener('input', () => renderStops());
$('arrive-input').addEventListener('input', () => renderStops());

// =========================================
//  Drawing routes and stops
// =========================================

function drawLines(features) {
    linesLayer.clearLayers();
    features = (features || []).filter((f) => f.geometry);
    if (features.length === 0) return;

    // Routes that run along the same line are drawn once
    const groups = new Map();
    features.forEach((f) => {
        const key = f.geoKey + '|' + isCitylink(f);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(f);
    });
    const drawn = Array.from(groups.values(), (members) => members[0]);
    const membersOf = new Map(Array.from(groups.values(), (members) => [members[0], members]));

    const layer = L.geoJSON({ type: 'FeatureCollection', features: drawn }, {
        style: (feature) => ({
            color: isCitylink(feature) ? COLORS.citylink : COLORS.route,
            weight: features.length === 1 ? 5 : 3,
            opacity: 0.85
        }),
        onEachFeature: (feature, line) => {
            const p = feature.properties;
            const others = membersOf.get(feature).length - 1;
            line.bindPopup(popupContent(
                'Route ' + p.short_name,
                [p.long_name, p.agency_name || 'Unknown operator',
                 others > 0 ? '+ ' + others + (others === 1 ? ' other route uses' : ' other routes use') + ' this line' : '']
            ));
        }
    }).addTo(linesLayer);

    routesBounds = layer.getBounds();
    fitTo(routesBounds);
}

function renderStops() {
    stopsLayer.clearLayers();
    if (!activeRoute || !activeRoute.properties.stops) return;

    const stops = activeRoute.properties.stops;
    const fromId = stopLookup.get($('depart-input').value);
    const toId = stopLookup.get($('arrive-input').value);
    const fromIndex = stops.findIndex((s) => s.id === fromId);
    const toIndex = stops.findIndex((s) => s.id === toId);
    const haveTrip = fromIndex !== -1 && toIndex !== -1 && fromIndex < toIndex;
    const picked = [];

    stops.forEach((stop, index) => {
        let color = COLORS.route;
        let radius = 5;
        let opacity = 0.9;

        if (stop.id === fromId) {
            color = COLORS.from;
            radius = 9;
        } else if (stop.id === toId) {
            color = COLORS.to;
            radius = 9;
        }

        // With a trip chosen, fade the stops that are not part of it
        if (haveTrip && (index < fromIndex || index > toIndex)) opacity = 0.25;

        const marker = L.circleMarker([stop.lat, stop.lon], {
            radius: radius,
            fillColor: color,
            fillOpacity: opacity,
            color: '#ffffff',
            weight: 2,
            opacity: 1
        }).addTo(stopsLayer);

        marker.bindPopup(popupContent(stop.name, [
            'Stop ' + stop.id,
            'Stop ' + (index + 1) + ' of ' + stops.length + ' on route ' + activeRoute.properties.short_name
        ]));

        if (stop.id === fromId || stop.id === toId) picked.push([stop.lat, stop.lon]);
    });

    updateTripHint(stops, fromIndex, toIndex);

    // With a From and/or To chosen, zoom to them (otherwise drawLines already framed the route)
    if (picked.length > 0) fitTo(L.latLngBounds(picked), { maxZoom: 15 });
}

function updateTripHint(stops, fromIndex, toIndex) {
    const hint = $('trip-hint');

    if (fromIndex === -1 || toIndex === -1) {
        hint.textContent = '';
    } else if (fromIndex === toIndex) {
        hint.textContent = 'Pick two different stops.';
    } else if (fromIndex > toIndex) {
        hint.textContent = 'This route runs the other way. Try swapping From and To.';
    } else {
        const between = toIndex - fromIndex;
        hint.textContent = between + (between === 1 ? ' stop' : ' stops') +
            ' from ' + stops[fromIndex].name + ' to ' + stops[toIndex].name + '.';
    }
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
    if (!activeRoute || mode !== 'routes') {
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
            signal: controller.signal
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
    if (!document.hidden && activeRoute && mode === 'routes') fetchLiveBuses();
}, CONFIG.LIVE_REFRESH_MS);

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeRoute && mode === 'routes') fetchLiveBuses();
});

// =========================================
//  Tabs: Route view / Buy a ticket
// =========================================

const MODES = ['routes', 'tickets'];
const TAB_IDS = { routes: 'tab-routes', tickets: 'tab-ticket' };
const PANEL_IDS = { routes: 'panel-routes', tickets: 'panel-ticket' };
let mode = 'routes';
let routesBounds = null;    // what Route view was showing, so switching back can reframe it
let ticketBounds = null;

function setMode(next, options) {
    if (MODES.indexOf(next) === -1) return;
    mode = next;

    MODES.forEach((m) => {
        const selected = m === mode;
        const tab = $(TAB_IDS[m]);
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        $(PANEL_IDS[m]).hidden = !selected;
    });
    sheet.dataset.mode = mode;

    // Each mode keeps its own layers; only the active mode's are on the map
    if (mode === 'tickets') {
        [linesLayer, stopsLayer, busesLayer, nearbyLayer].forEach((l) => map.removeLayer(l));
        ticketLayer.addTo(map);
    } else {
        map.removeLayer(ticketLayer);
        [linesLayer, stopsLayer, busesLayer].forEach((l) => l.addTo(map));
        if (nearbyLayer.getLayers().length) nearbyLayer.addTo(map);
        if (activeRoute) fetchLiveBuses();
    }

    if (options && options.expand) {
        sheet.classList.remove('is-collapsed');
        sheetToggle.setAttribute('aria-expanded', 'true');
    }

    // Let the sheet settle at its new height, then frame what this mode was showing
    setTimeout(() => fitTo(mode === 'tickets' ? ticketBounds : routesBounds), 60);
}

MODES.forEach((m, index) => {
    const tab = $(TAB_IDS[m]);
    tab.addEventListener('click', () => setMode(m, { expand: true }));
    tab.addEventListener('keydown', (event) => {
        let target = null;
        if (event.key === 'ArrowRight') target = (index + 1) % MODES.length;
        else if (event.key === 'ArrowLeft') target = (index + MODES.length - 1) % MODES.length;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = MODES.length - 1;
        if (target === null) return;
        event.preventDefault();
        setMode(MODES[target], { expand: true });
        $(TAB_IDS[MODES[target]]).focus();
    });
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
                          search: normalise(stop.name) + ' ' + id, hits: [] };
                stopIndex.set(id, entry);
            }
            entry.hits.push(routeIdx, position);
        });
    });
    stopList = Array.from(stopIndex.values());
}

// Best matches first: name starts with the text, then a word starts with it, then anywhere
function searchStops(query, limit) {
    const text = normalise(query).trim();
    if (text.length < 2) return [];
    const tokens = text.split(/\s+/);
    const scored = [];

    for (const stop of stopList) {
        if (!tokens.every((t) => stop.search.includes(t))) continue;
        let rank = 2;
        if (stop.search.startsWith(text)) rank = 0;
        else if (stop.search.includes(' ' + tokens[0])) rank = 1;
        scored.push({ stop: stop, rank: rank });
    }

    scored.sort((a, b) => a.rank - b.rank || b.stop.hits.length - a.stop.hits.length || a.stop.name.localeCompare(b.stop.name));
    return scored.slice(0, limit).map((x) => x.stop);
}

// =========================================
//  Stop picker (accessible combobox)
// =========================================

function createStopPicker(inputId, listId, onChange) {
    const input = $(inputId);
    const list = $(listId);
    let selected = null;
    let results = [];
    let active = -1;

    function close() {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
    }

    function highlight(index) {
        active = index;
        Array.from(list.children).forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
        if (active >= 0) {
            input.setAttribute('aria-activedescendant', list.children[active].id);
            list.children[active].scrollIntoView({ block: 'nearest' });
        } else {
            input.removeAttribute('aria-activedescendant');
        }
    }

    function open() {
        list.innerHTML = '';
        if (input.value.trim().length < 2) { close(); return; }

        results = searchStops(input.value, 6);
        if (results.length === 0) {
            const li = document.createElement('li');
            li.className = 'picker-empty';
            li.textContent = 'No stops found';
            list.appendChild(li);
        }
        results.forEach((stop, i) => {
            const li = document.createElement('li');
            li.id = listId + '-' + i;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', 'false');
            li.textContent = stop.name;
            const small = document.createElement('small');
            const routeCount = stop.hits.length / 2;
            small.textContent = 'Stop ' + stop.id + ' · ' + routeCount + (routeCount === 1 ? ' route' : ' routes');
            li.appendChild(small);
            li.addEventListener('click', () => choose(stop));
            list.appendChild(li);
        });
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        active = -1;
    }

    function choose(stop) {
        selected = stop;
        input.value = stop ? stop.name : '';
        close();
        onChange(selected);
    }

    // Keep focus in the input while tapping a result
    list.addEventListener('mousedown', (event) => event.preventDefault());

    input.addEventListener('input', () => {
        if (selected) { selected = null; onChange(null); }
        open();
    });

    input.addEventListener('keydown', (event) => {
        const optionCount = results.length;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (list.hidden) open();
            else if (optionCount) highlight((active + 1) % optionCount);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (optionCount) highlight((active - 1 + optionCount) % optionCount);
        } else if (event.key === 'Enter') {
            if (!list.hidden && optionCount) {
                event.preventDefault();
                choose(results[active >= 0 ? active : 0]);
            }
        } else if (event.key === 'Escape') {
            close();
        }
    });

    input.addEventListener('blur', close);

    return {
        get: () => selected,
        set: (stop) => choose(stop),
        silent: (stop) => { selected = stop; input.value = stop ? stop.name : ''; close(); }
    };
}

// =========================================
//  Finding buses between two stops
// =========================================

const MAX_BUSES = 30;
let buses = [];            // [{ feature, fromPos, toPos, between }]
let chosenBus = null;

// Routes that visit From and then To (in that order), one per route name, shortest trip first
function findBuses(from, to) {
    const fromPos = new Map();   // route index -> where it visits From
    for (let i = 0; i < from.hits.length; i += 2) {
        if (!fromPos.has(from.hits[i])) fromPos.set(from.hits[i], from.hits[i + 1]);
    }

    const byName = new Map();
    for (let i = 0; i < to.hits.length; i += 2) {
        const routeIdx = to.hits[i];
        const toPosition = to.hits[i + 1];
        const fromPosition = fromPos.get(routeIdx);
        if (fromPosition === undefined || fromPosition >= toPosition) continue;

        const feature = allRoutes[routeIdx];
        const between = toPosition - fromPosition;
        const key = feature.properties.display_name || feature.properties.route_id;
        const existing = byName.get(key);
        if (!existing || between < existing.between) {
            byName.set(key, { feature: feature, fromPos: fromPosition, toPos: toPosition, between: between });
        }
    }

    return Array.from(byName.values()).sort((a, b) =>
        a.between - b.between ||
        String(a.feature.properties.short_name).localeCompare(String(b.feature.properties.short_name), undefined, { numeric: true }));
}

// =========================================
//  Buy a ticket panel
// =========================================

const fromPicker = createStopPicker('from-input', 'from-results', refreshTicketSearch);
const toPicker = createStopPicker('to-input', 'to-results', refreshTicketSearch);

function refreshTicketSearch() {
    chosenBus = null;
    buses = [];
    const from = fromPicker.get();
    const to = toPicker.get();
    const hint = $('ticket-hint');

    if (from && to && from.id === to.id) {
        hint.textContent = 'Pick two different stops.';
    } else if (from && to) {
        buses = findBuses(from, to);
        if (buses.length === 0) {
            hint.textContent = 'No direct bus found from ' + from.name + ' to ' + to.name +
                '. Try swapping the stops, or choose a nearby stop.';
        } else {
            hint.textContent = buses.length + (buses.length === 1 ? ' bus goes' : ' buses go') +
                ' from ' + from.name + ' to ' + to.name + '. Pick one.' +
                (buses.length > MAX_BUSES ? ' Showing the ' + MAX_BUSES + ' shortest trips.' : '');
        }
    } else {
        hint.textContent = 'Search for where you are starting and where you are going.';
    }

    buses = buses.slice(0, MAX_BUSES);
    renderBusList();
    drawTicketMap();
}

function renderBusList() {
    const listEl = $('bus-list');
    listEl.innerHTML = '';

    buses.forEach((bus) => {
        const p = bus.feature.properties;
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'bus-row';
        button.setAttribute('aria-pressed', String(bus === chosenBus));

        const badge = document.createElement('span');
        badge.className = 'bus-badge' + (isCitylink(bus.feature) ? ' is-citylink' : '');
        badge.textContent = p.short_name || '?';

        const info = document.createElement('span');
        info.className = 'bus-info';
        const name = document.createElement('strong');
        name.textContent = p.long_name || p.display_name || 'Bus route';
        const detail = document.createElement('small');
        detail.textContent = (p.agency_name || 'Unknown operator') + ' · ' +
            bus.between + (bus.between === 1 ? ' stop' : ' stops');
        info.appendChild(name);
        info.appendChild(detail);

        button.appendChild(badge);
        button.appendChild(info);
        button.addEventListener('click', () => chooseBus(bus));
        li.appendChild(button);
        listEl.appendChild(li);
    });

    $('ticket-continue').disabled = !chosenBus;
}

function chooseBus(bus) {
    chosenBus = bus;
    Array.from($('bus-list').querySelectorAll('.bus-row')).forEach((row, i) => {
        row.setAttribute('aria-pressed', String(buses[i] === bus));
    });
    $('ticket-continue').disabled = false;
    drawTicketMap();
}

$('swap-btn').addEventListener('click', () => {
    const from = fromPicker.get();
    const to = toPicker.get();
    fromPicker.silent(to);
    toPicker.silent(from);
    refreshTicketSearch();
});

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

function endpointMarker(stop, color, label) {
    const marker = L.circleMarker([stop.lat, stop.lon], {
        radius: 10, fillColor: color, fillOpacity: 1, color: '#ffffff', weight: 3, opacity: 1
    });
    marker.bindPopup(popupContent(label + ': ' + stop.name, ['Stop ' + stop.id]));
    return marker;
}

let ticketDrawToken = 0;

function drawTicketMap() {
    const token = ++ticketDrawToken;

    // The chosen bus's line may not be loaded yet: draw what we have now, then again when it arrives
    if (chosenBus && !geoLoaded.has(chosenBus.feature.properties.region)) {
        ensureGeo([chosenBus.feature.properties.region])
            .then(() => { if (token === ticketDrawToken) drawTicketMap(); })
            .catch((error) => console.warn('Route line unavailable:', error));
    }

    ticketLayer.clearLayers();
    ticketBounds = null;
    const from = fromPicker.get();
    const to = toPicker.get();
    const points = [];

    // Faint lines for every matching bus
    buses.forEach((bus) => {
        if (bus === chosenBus || !bus.feature.geometry) return;
        L.geoJSON(bus.feature, {
            style: { color: isCitylink(bus.feature) ? COLORS.citylink : COLORS.route, weight: 3, opacity: 0.3 }
        }).addTo(ticketLayer);
    });

    // The chosen bus: whole line softly, the part you ride strongly
    if (chosenBus) {
        const color = isCitylink(chosenBus.feature) ? COLORS.citylink : COLORS.route;
        if (chosenBus.feature.geometry) {
            L.geoJSON(chosenBus.feature, { style: { color: color, weight: 5, opacity: 0.35 } }).addTo(ticketLayer);
        }
        const ride = L.polyline(segmentLatLngs(chosenBus.feature, chosenBus.fromPos, chosenBus.toPos),
            { color: color, weight: 7, opacity: 1 }).addTo(ticketLayer);
        ticketBounds = ride.getBounds();
    }

    if (from) { endpointMarker(from, COLORS.from, 'From').addTo(ticketLayer); points.push([from.lat, from.lon]); }
    if (to) { endpointMarker(to, COLORS.to, 'To').addTo(ticketLayer); points.push([to.lat, to.lon]); }

    if (!ticketBounds && points.length > 0) ticketBounds = L.latLngBounds(points);
    if (ticketBounds) fitTo(ticketBounds, { maxZoom: 15 });
}

// =========================================
//  Hand-off to the tickets page
// =========================================

const DRAFT_KEY = 'hop.ticketDraft';

$('ticket-continue').addEventListener('click', () => {
    const from = fromPicker.get();
    const to = toPicker.get();
    if (!chosenBus || !from || !to) return;

    const p = chosenBus.feature.properties;
    const draft = {
        routeId: String(p.route_id),
        shortName: String(p.short_name || ''),
        longName: String(p.long_name || ''),
        agency: String(p.agency_name || ''),
        fromId: from.id,
        fromName: from.name,
        toId: to.id,
        toName: to.name,
        stopsBetween: chosenBus.between
    };

    // The tickets page re-checks this; nothing here is trusted as a purchase
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) { /* private mode: still go on */ }
    window.location.href = '../tickets/tickets.html';
});

// Opening map.html?mode=tickets starts on the ticket tab (and restores the last journey)
function startInRequestedMode() {
    const requested = new URLSearchParams(window.location.search).get('mode');
    if (requested !== 'tickets') return;

    setMode('tickets', { expand: true });

    let draft = null;
    try { draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { draft = null; }
    if (!draft || typeof draft !== 'object') { refreshTicketSearch(); return; }

    const from = stopIndex.get(String(draft.fromId));
    const to = stopIndex.get(String(draft.toId));
    if (!from || !to) { refreshTicketSearch(); return; }

    fromPicker.silent(from);
    toPicker.silent(to);
    refreshTicketSearch();
    const match = buses.find((b) => String(b.feature.properties.route_id) === String(draft.routeId));
    if (match) chooseBus(match);
}

// Starting hint
$('ticket-hint').textContent = 'Search for where you are starting and where you are going.';

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
    const showing = locActive() && loc.fix;
    drawYou();
    updateNearby();
    $('use-location-btn').hidden = !(showing && stopList.length);
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

function nearestStops(lat, lon, count, maxM) {
    const found = [];
    for (let i = 0; i < stopList.length; i++) {
        const s = stopList[i];
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

    const near = nearestStops(loc.fix.lat, loc.fix.lon, NEARBY_COUNT, NEARBY_MAX_M);
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
            radius: 7, color: '#ffffff', weight: 2, fillColor: COLORS.route, fillOpacity: 1
        }).bindPopup(popupContent(item.stop.name, [formatDistance(item.d) + ' away']));
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

    if (mode === 'routes') nearbyLayer.addTo(map);
}

// "Use my nearest stop" in Buy a ticket
$('use-location-btn').addEventListener('click', () => {
    if (!(locActive() && loc.fix)) return;
    const nearest = nearestStops(loc.fix.lat, loc.fix.lon, 1, 50000)[0];
    if (!nearest) {
        $('ticket-hint').textContent = 'No bus stops found near you.';
        return;
    }
    fromPicker.set(nearest.stop);
    if (!toPicker.get()) {
        $('ticket-hint').textContent = 'Starting from ' + nearest.stop.name + ', about ' +
            formatDistance(nearest.d) + ' from you. Now choose where you are going.';
    }
});

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
//  Go
// =========================================

loadRoutes();
initLocation();
