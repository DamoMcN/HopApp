'use strict';

// Makes trip-routes.json: which route each trip belongs to.
// The NTA live feeds often give only a trip id, so the server uses this to find the route.
//
//   node build-trip-routes.js path/to/trips.txt
//
// Run it again whenever the GTFS data changes, then commit trip-routes.json.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const source = process.argv[2];
if (!source) {
    console.error('Usage: node build-trip-routes.js path/to/trips.txt');
    process.exit(1);
}

function splitCsv(line) {
    return line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map((p) => p.replace(/^"|"$/g, '').trim());
}

async function main() {
    const routes = [];
    const routeIndex = new Map();
    const trips = {};
    let headers = null;
    let routeCol = -1;
    let tripCol = -1;

    const lines = readline.createInterface({ input: fs.createReadStream(source) });
    for await (const line of lines) {
        if (!line) continue;
        const parts = splitCsv(line.replace(/^\uFEFF/, ''));
        if (!headers) {
            headers = parts;
            routeCol = headers.indexOf('route_id');
            tripCol = headers.indexOf('trip_id');
            if (routeCol < 0 || tripCol < 0) throw new Error('trips.txt needs route_id and trip_id columns');
            continue;
        }
        const routeId = parts[routeCol];
        const tripId = parts[tripCol];
        if (!routeId || !tripId) continue;
        if (!routeIndex.has(routeId)) {
            routeIndex.set(routeId, routes.length);
            routes.push(routeId);
        }
        trips[tripId] = routeIndex.get(routeId);
    }

    const out = path.join(__dirname, 'trip-routes.json');
    fs.writeFileSync(out, JSON.stringify({ routes: routes, trips: trips }));
    console.log('Wrote ' + out + ': ' + Object.keys(trips).length + ' trips, ' + routes.length + ' routes, ' +
        (fs.statSync(out).size / 1048576).toFixed(1) + ' MB');
}

main().catch((error) => { console.error(error.message); process.exit(1); });
