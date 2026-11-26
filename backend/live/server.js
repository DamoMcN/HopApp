// Live bus proxy for the Hop map.
//
// The map can't call the National Transport Authority (NTA) feed directly: the
// feed needs a secret API key and browsers block the request. This tiny server
// holds the key, asks the NTA for vehicle positions, and gives the map just
// what it needs.
//
// Run it (Node 20.6 or newer):
//     cd backend/live
//     npm install
//     cp .env.example .env      then put your NTA key in .env
//     npm start
//
// GET /api/vehicles?route_id=XYZ  ->  [{ id, lat, lon, speed, timestamp }, ...]
//   route_id is optional; leave it out to get every vehicle.
//
// GET /api/stop-times?stop_id=ABC[&limit=N] ->  { now, arrivals: [{ routeId, tripId, time, delay }, ...] }
//   The next buses at one stop, from the NTA trip-updates feed. time is seconds since 1970 and
//   delay is seconds late (negative = early). Either can be null when the feed doesn't say.

const express = require('express');
const cors = require('cors');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const { parseVehicles, parseTripUpdates, arrivalsFor } = require('./feeds');

// Which route each trip belongs to (see build-trip-routes.js). Without it, buses cannot be matched to routes.
let tripRoutes = null;
try {
    tripRoutes = require('./trip-routes.json');
} catch (error) {
    console.warn('trip-routes.json not found: buses will not be matched to routes. Run build-trip-routes.js.');
}

const API_KEY = process.env.NTA_API_KEY;
if (!API_KEY) {
    console.error('Missing NTA_API_KEY. Copy .env.example to .env and add your key.');
    process.exit(1);
}

// Safe check of the key's shape (never prints the key itself)
(function checkKey() {
    const problems = [];
    if (API_KEY !== API_KEY.trim()) problems.push('has spaces at the start or end');
    if (/["'\s]/.test(API_KEY)) problems.push('contains quotes or spaces');
    if (/[^\x21-\x7e]/.test(API_KEY)) problems.push('contains hidden or non-standard characters');
    if (API_KEY === 'put-your-key-here') problems.push('is still the placeholder text');
    // Only fixed wording is logged: nothing taken from the key, not even its length
    console.log(problems.length
        ? 'NTA key loaded, but it ' + problems.join(' and ')
        : 'NTA key loaded, format looks fine');
})();

const PORT = Number(process.env.PORT) || 3000;
const CACHE_MS = 10 * 1000;   // many people refreshing = one request to the NTA, not hundreds
const NTA_URL = 'https://api.nationaltransport.ie/gtfsr/v2/vehicles';
const NTA_TRIPS_URL = 'https://api.nationaltransport.ie/gtfsr/v2/TripUpdates';

// Pages allowed to call this server. Add your own address to ALLOWED_ORIGINS
// (comma separated) if the map is served from somewhere else.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost,http://127.0.0.1')
    .split(',')
    .map((o) => o.trim());

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));

// Both feeds go through here. The key goes both ways, exactly like the original working test
// server: as a header and as a query parameter. It only travels to the NTA over HTTPS and is
// never logged or sent to the browser.
async function fetchFeed(url) {
    const response = await fetch(url + '?subscription-key=' + encodeURIComponent(API_KEY), {
        headers: {
            'Cache-Control': 'no-cache',
            'Ocp-Apim-Subscription-Key': API_KEY
        }
    });
    if (!response.ok) {
        let hint = '';
        if (response.status === 401 || response.status === 403) {
            hint = ' (the NTA rejected the key: check NTA_API_KEY in .env has no quotes or spaces, was not regenerated, and is subscribed to the GTFS-Realtime API)';
        } else if (response.status === 429) {
            hint = ' (too many requests: wait a minute)';
        }
        throw new Error('NTA responded with ' + response.status + hint);
    }

    const buffer = await response.arrayBuffer();
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
}

// Both feeds share one pattern: serve from cache, refresh when old, and if the NTA says "too many
// requests" (429) or fails, keep serving the last good data and leave the NTA alone for a while.
function cachedFeed(url, parse, maxAgeMs, label) {
    let data = null;
    let time = 0;
    let pausedUntil = 0;
    let inFlight = null;

    return async function load() {
        const now = Date.now();
        if (data !== null && (now - time < maxAgeMs || now < pausedUntil)) return data;
        if (inFlight) return inFlight;   // many requests at once share one NTA call

        inFlight = (async () => {
            try {
                data = parse(await fetchFeed(url));
                time = Date.now();
                return data;
            } catch (error) {
                if (/ 429 /.test(error.message)) pausedUntil = Date.now() + 60 * 1000;
                if (data !== null) {
                    console.warn(label + ': using the last good data (' + error.message + ')');
                    return data;
                }
                throw error;
            } finally {
                inFlight = null;
            }
        })();
        return inFlight;
    };
}

const loadVehicles = cachedFeed(NTA_URL, (feed) => parseVehicles(feed, tripRoutes), 30 * 1000, 'vehicles');
const loadTripUpdates = cachedFeed(NTA_TRIPS_URL, (feed) => parseTripUpdates(feed, tripRoutes), 60 * 1000, 'trip updates');

app.get('/api/vehicles', async (req, res) => {
    try {
        const routeId = req.query.route_id;
        const vehicles = await loadVehicles();
        const list = routeId ? vehicles.filter((v) => v.routeId === routeId) : vehicles;
        if (req.query.debug) {
            // ?debug=1 shows how many live buses matched a route, to check trip-routes.json is current
            const matched = vehicles.filter((v) => v.routeId && tripRoutes && tripRoutes.routes.includes(v.routeId)).length;   // route ids our map knows
            console.log('debug: ' + vehicles.length + ' live buses, ' + matched + ' matched to a route');
            return res.json({ total: vehicles.length, matched: matched, routeId: routeId || null, buses: list.slice(0, 50) });
        }
        res.json(list.map(({ routeId: _r, tripId: _t, ...rest }) => rest));
    } catch (error) {
        console.error('NTA fetch error:', error.message);   // detail stays in this console
        res.status(502).json({ error: 'Live bus data is not available right now' });
    }
});

app.get('/api/stop-times', async (req, res) => {
    const stopId = String(req.query.stop_id || '');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(stopId)) {
        return res.status(400).json({ error: 'Missing or invalid stop_id' });
    }
    try {
        const byStop = await loadTripUpdates();
        const now = Math.floor(Date.now() / 1000);
        // limit is optional (default 10). The stop card asks for more so picking a bus that is not among the
        // next few still finds it.
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 40);
        res.json({ now: now, arrivals: arrivalsFor(byStop, stopId, now, limit) });
    } catch (error) {
        console.error('NTA trip updates error:', error.message);
        res.status(502).json({ error: 'Live times are not available right now' });
    }
});

app.listen(PORT, (error) => {
    // Express 5 passes start-up problems (such as the port already being in use) here
    if (error) {
        console.error('Could not start on port ' + PORT + ': ' + error.message +
            '. Is another copy of the server already running? Close it and try again.');
        process.exit(1);
    }
    console.log('Hop live bus proxy running at http://localhost:' + PORT + '/api/vehicles');
});
