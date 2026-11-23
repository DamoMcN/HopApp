// Makes data/routes.geojson from a GTFS folder (the NTA "realtime operators" schedule download).
//
//   node convert.js "path/to/GTFS folder"
//   node build-data.js
//
// One route "variant" is made for every route and direction, using its most common stop pattern
// and shape. Only buses are kept (Luas and Irish Rail are skipped).
//
// Wheelchair access is read from the standard GTFS columns when the feed has them:
//   stops.txt  wheelchair_boarding    (a stop with 0 inside a station takes the station's value)
//   trips.txt  wheelchair_accessible
// Both use 0 = not known, 1 = accessible, 2 = not accessible. Hand-checked values can be added
// on top in data/accessibility.json (see the README), which the map reads when it loads.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'trips.txt'))) {
    console.error('Usage: node convert.js "path/to/GTFS folder"   (the folder needs trips.txt, routes.txt, ...)');
    process.exit(1);
}
const OUT = path.join(__dirname, 'data', 'routes.geojson');

function splitCsv(line) {
    if (line.indexOf('"') === -1) return line.split(',');
    return line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map((p) => p.replace(/^"|"$/g, ''));
}

// Calls onRow(object) for every row, or onRow(fields, columnIndex) when raw is true (faster)
async function eachRow(file, onRow, raw) {
    const lines = readline.createInterface({ input: fs.createReadStream(path.join(dir, file)), crlfDelay: Infinity });
    let cols = null;
    for await (const line of lines) {
        if (!line) continue;
        const parts = splitCsv(cols ? line : line.replace(/^﻿/, ''));
        if (!cols) {
            cols = {};
            parts.forEach((name, i) => { cols[name.trim()] = i; });
            continue;
        }
        onRow(parts, cols);
    }
}

// GTFS wheelchair columns: 1 = accessible, 2 = not accessible, anything else (or no column) = not known
const access = (value) => (value === '1' ? 1 : value === '2' ? 2 : 0);

const REGION_BY_AGENCY = { '1': 'Dublin', '3': 'Dublin', '03C': 'Dublin', 'WFRD': 'Waterford' };

async function main() {
    const t0 = Date.now();
    const log = (m) => console.log(((Date.now() - t0) / 1000).toFixed(0) + 's  ' + m);

    const agencies = new Map();
    await eachRow('agency.txt', (p, c) => agencies.set(p[c.agency_id], p[c.agency_name]));

    const routes = new Map();
    await eachRow('routes.txt', (p, c) => {
        if (p[c.route_type] !== '3') return;   // buses only
        routes.set(p[c.route_id], { agency: p[c.agency_id], short: p[c.route_short_name], long: p[c.route_long_name] });
    });
    log(routes.size + ' bus routes');

    // 1. Most common pattern for each route and direction
    const patterns = new Map();   // route|direction|shape -> { route, dir, shape, count, trip }
    await eachRow('trips.txt', (p, c) => {
        const route = p[c.route_id];
        if (!routes.has(route)) return;
        const key = route + '|' + p[c.direction_id] + '|' + p[c.shape_id];
        let hit = patterns.get(key);
        if (hit) hit.count++;
        else patterns.set(key, hit = { route: route, dir: p[c.direction_id], shape: p[c.shape_id], count: 1, trip: p[c.trip_id], access: [0, 0, 0] });
        hit.access[access(p[c.wheelchair_accessible])]++;   // trips counted as not known, yes, no
    });
    const best = new Map();       // route|direction -> pattern
    patterns.forEach((pt) => {
        const key = pt.route + '|' + pt.dir;
        if (!best.has(key) || pt.count > best.get(key).count) best.set(key, pt);
    });
    const chosen = Array.from(best.values());
    const wantTrips = new Set(chosen.map((pt) => pt.trip));
    const wantShapes = new Set(chosen.map((pt) => pt.shape).filter(Boolean));
    log(chosen.length + ' route variants, reading stop times (large)...');

    // 2. Stops visited by those trips
    const tripStops = new Map();  // trip -> [[sequence, stop_id], ...]
    await eachRow('stop_times.txt', (p, c) => {
        const trip = p[c.trip_id];
        if (!wantTrips.has(trip)) return;
        if (!tripStops.has(trip)) tripStops.set(trip, []);
        tripStops.get(trip).push([Number(p[c.stop_sequence]), p[c.stop_id]]);
    });
    log('stop times done, reading shapes (large)...');

    // 3. Route lines
    const shapePoints = new Map();
    await eachRow('shapes.txt', (p, c) => {
        const id = p[c.shape_id];
        if (!wantShapes.has(id)) return;
        if (!shapePoints.has(id)) shapePoints.set(id, []);
        shapePoints.get(id).push([Number(p[c.shape_pt_sequence]), Number(p[c.shape_pt_lon]), Number(p[c.shape_pt_lat])]);
    });
    log('shapes done');

    const stopInfo = new Map();
    await eachRow('stops.txt', (p, c) => stopInfo.set(p[c.stop_id], {
        name: p[c.stop_name], lat: Number(p[c.stop_lat]), lon: Number(p[c.stop_lon]),
        wheelchair: access(p[c.wheelchair_boarding]), parent: p[c.parent_station] || ''
    }));
    stopInfo.forEach((info) => {
        const station = info.parent && stopInfo.get(info.parent);
        if (info.wheelchair === 0 && station) info.wheelchair = station.wheelchair;
    });

    // 4. Build features
    const features = [];
    chosen.forEach((pt) => {
        const route = routes.get(pt.route);
        const agencyName = agencies.get(route.agency) || 'Unknown operator';

        const stops = (tripStops.get(pt.trip) || [])
            .sort((a, b) => a[0] - b[0])
            .map((s, i) => {
                const info = stopInfo.get(s[1]);
                return info ? { id: s[1], name: info.name, lat: info.lat, lon: info.lon, seq: i + 1, wheelchair: info.wheelchair } : null;
            })
            .filter(Boolean);
        if (stops.length < 2) return;

        let coordinates = (shapePoints.get(pt.shape) || []).sort((a, b) => a[0] - b[0]).map((q) => [q[1], q[2]]);
        if (coordinates.length < 2) coordinates = stops.map((s) => [s.lon, s.lat]);   // no shape: join the stops

        // Accessible (or not) only when every trip of this variant says so
        const wheelchair = pt.access[1] === pt.count ? 1 : pt.access[2] === pt.count ? 2 : 0;

        features.push({
            type: 'Feature',
            properties: {
                route_id: pt.route,
                short_name: route.short,
                long_name: route.long,
                agency_name: agencyName,
                region: REGION_BY_AGENCY[route.agency] || 'Other / National',
                display_name: '[' + agencyName + '] ' + route.short + ' - ' + route.long,
                wheelchair: wheelchair,
                stops: stops
            },
            geometry: { type: 'LineString', coordinates: coordinates }
        });
    });

    fs.writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features: features }));
    log('Wrote ' + OUT + ': ' + features.length + ' routes, ' + (fs.statSync(OUT).size / 1048576).toFixed(1) + ' MB');
}

main().catch((error) => { console.error(error); process.exit(1); });
