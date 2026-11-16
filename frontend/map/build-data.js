// Splits the big routes.geojson into small files the map can load quickly.
//
//   node build-data.js
//
// Reads  data/routes.geojson   (made by convert.js)
// Writes data/index.json       every route's details + stop lists (loaded first, small)
//        data/geo-<region>.json  the route lines for one region (loaded when needed)
//
// Run it again whenever routes.geojson changes. The output folder is git-ignored.

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const SOURCE = path.join(DATA, 'routes.geojson');
const DECIMALS = 5;          // 5 decimal places is about 1 metre
const TOLERANCE = 0.00003;   // drop line points that change the shape by less than about 3 metres

if (!fs.existsSync(SOURCE)) {
    console.error('Missing ' + SOURCE + '. Make it with convert.js first.');
    process.exit(1);
}

const round = (n) => Number(n.toFixed(DECIMALS));

// The source data files city buses (Galway 401 to 412, Cork 2xx, Limerick 3xx, Waterford W1 to W5)
// under "Other / National". A route with nearly all of its stops inside one city belongs to that
// city, so the region picker finds it. Boxes are [south, north, west, east].
const CITY_BOXES = {
    'Galway':    [53.20, 53.36, -9.20, -8.90],
    'Cork':      [51.82, 51.98, -8.60, -8.35],
    'Limerick':  [52.60, 52.72, -8.75, -8.50],
    'Waterford': [52.22, 52.30, -7.20, -7.05]
};
const CITY_SHARE = 0.8;      // this share of a route's stops must be inside the city

function cityFor(stopRefs, table) {
    if (!stopRefs.length) return null;
    return Object.keys(CITY_BOXES).find((city) => {
        const box = CITY_BOXES[city];
        const inside = stopRefs.filter((i) => {
            const s = table[i];
            return s[2] >= box[0] && s[2] <= box[1] && s[3] >= box[2] && s[3] <= box[3];
        }).length;
        return inside / stopRefs.length >= CITY_SHARE;
    }) || null;
}

// Douglas-Peucker line simplification (iterative so long lines can't overflow the stack)
function simplify(points, tolerance) {
    if (points.length < 3) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    const t2 = tolerance * tolerance;

    while (stack.length) {
        const [first, last] = stack.pop();
        const [ax, ay] = points[first];
        const [bx, by] = points[last];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let worst = -1, worstD = 0;

        for (let i = first + 1; i < last; i++) {
            const px = points[i][0] - ax, py = points[i][1] - ay;
            let d2;
            if (len2 === 0) d2 = px * px + py * py;
            else {
                const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
                const ex = px - t * dx, ey = py - t * dy;
                d2 = ex * ex + ey * ey;
            }
            if (d2 > worstD) { worstD = d2; worst = i; }
        }
        if (worst !== -1 && worstD > t2) {
            keep[worst] = 1;
            stack.push([first, worst], [worst, last]);
        }
    }
    return points.filter((_, i) => keep[i]);
}

const slug = (region) => region.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

console.log('Reading ' + SOURCE + ' ...');
const features = JSON.parse(fs.readFileSync(SOURCE, 'utf8')).features;

const stopTable = [];            // [id, name, lat, lon]
const stopPosition = new Map();  // id -> index in stopTable
const routes = [];
const geoByRegion = {};          // region -> { key: coordinates }
const geoKeys = new Map();       // simplified coordinates (as text) -> key, so shared lines are stored once
let nextKey = 0;

features.forEach((f) => {
    const p = f.properties;
    let region = p.region || 'Other / National';

    const stopRefs = (p.stops || []).map((s) => {
        const id = String(s.id);
        if (!stopPosition.has(id)) {
            stopPosition.set(id, stopTable.length);
            stopTable.push([id, s.name, round(s.lat), round(s.lon)]);
        }
        return stopPosition.get(id);
    });

    if (region === 'Other / National') region = cityFor(stopRefs, stopTable) || region;

    let key = null;
    if (f.geometry && f.geometry.type === 'LineString') {
        const line = simplify(f.geometry.coordinates.map((c) => [round(c[0]), round(c[1])]), TOLERANCE);
        const text = JSON.stringify(line);
        const lookup = region + '|' + text;
        if (!geoKeys.has(lookup)) {
            geoKeys.set(lookup, 'g' + (nextKey++).toString(36));
            (geoByRegion[region] = geoByRegion[region] || {})[geoKeys.get(lookup)] = line;
        }
        key = geoKeys.get(lookup);
    }

    routes.push([p.route_id, p.short_name, p.long_name, p.agency_name, region, p.display_name, key, stopRefs]);
});

fs.writeFileSync(path.join(DATA, 'index.json'),
    JSON.stringify({ version: 1, regions: Object.keys(geoByRegion).sort(), stops: stopTable, routes: routes }));

Object.keys(geoByRegion).forEach((region) => {
    fs.writeFileSync(path.join(DATA, 'geo-' + slug(region) + '.json'), JSON.stringify(geoByRegion[region]));
});

const size = (file) => (fs.statSync(path.join(DATA, file)).size / 1048576).toFixed(2) + ' MB';
console.log('index.json  ' + size('index.json') + '  (' + routes.length + ' routes, ' + stopTable.length + ' stops)');
Object.keys(geoByRegion).forEach((r) => console.log('geo-' + slug(r) + '.json  ' + size('geo-' + slug(r) + '.json')));
