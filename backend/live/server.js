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

const express = require('express');
const cors = require('cors');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const API_KEY = process.env.NTA_API_KEY;
if (!API_KEY) {
    console.error('Missing NTA_API_KEY. Copy .env.example to .env and add your key.');
    process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
const CACHE_MS = 10 * 1000;   // many people refreshing = one request to the NTA, not hundreds
const NTA_URL = 'https://api.nationaltransport.ie/gtfsr/v2/vehicles';

// Pages allowed to call this server. Add your own address to ALLOWED_ORIGINS
// (comma separated) if the map is served from somewhere else.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost,http://127.0.0.1')
    .split(',')
    .map((o) => o.trim());

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));

let cache = { time: 0, vehicles: [] };

async function loadVehicles() {
    if (Date.now() - cache.time < CACHE_MS) return cache.vehicles;

    const response = await fetch(NTA_URL, {
        headers: {
            'Cache-Control': 'no-cache',
            'Ocp-Apim-Subscription-Key': API_KEY   // same header the original server used
        }
    });
    if (!response.ok) throw new Error('NTA responded with ' + response.status);

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

    const vehicles = feed.entity
        .filter((e) => e.vehicle && e.vehicle.position && e.vehicle.trip)
        .map((e) => ({
            id: e.id,
            routeId: e.vehicle.trip.routeId,
            lat: e.vehicle.position.latitude,
            lon: e.vehicle.position.longitude,
            speed: e.vehicle.position.speed || null,   // metres per second
            timestamp: e.vehicle.timestamp ? Number(e.vehicle.timestamp) : null
        }));

    cache = { time: Date.now(), vehicles: vehicles };
    return vehicles;
}

app.get('/api/vehicles', async (req, res) => {
    try {
        const routeId = req.query.route_id;
        const vehicles = await loadVehicles();
        const result = (routeId ? vehicles.filter((v) => v.routeId === routeId) : vehicles)
            .map(({ routeId: _ignored, ...rest }) => rest);
        res.json(result);
    } catch (error) {
        console.error('NTA fetch error:', error.message);   // detail stays in this console
        res.status(502).json({ error: 'Live bus data is not available right now' });
    }
});

app.listen(PORT, () => {
    console.log('Hop live bus proxy running at http://localhost:' + PORT + '/api/vehicles');
});
