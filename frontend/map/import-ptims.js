// Fills the "ptims" part of data/accessibility.json with wheelchair access for bus stops, taken
// from the NTA's PTIMS stop survey (the "PTIMS Map" download on
// https://www.transportforireland.ie/transitData/PT_Data.html).
//
//   node import-ptims.js "path/to/ptims folder"      (the unzipped ptims.zip, or its stops.geojson)
//
// Only the "ptims" part is replaced. Stops and routes typed by hand in "stops" and "routes" are kept,
// and they win over PTIMS when the map loads. Run it again whenever a new PTIMS file comes out.
//
// Rules:
//  - PTIMS AtcoCode is the same as the stop id in index.json. Stops that aren't on the map are left out.
//  - Stops never surveyed (IsSurveyed 0) always say False, which means "not checked", so they are left out.
//  - A code listed twice with different answers is left out too.
//
// PTIMS data is licensed under CC BY 4.0 and is attributed to the National Transport Authority.

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const INDEX = path.join(DATA, 'index.json');
const OUT = path.join(DATA, 'accessibility.json');

let source = process.argv[2];
if (source && fs.existsSync(source) && fs.statSync(source).isDirectory()) source = path.join(source, 'stops.geojson');
if (!source || !fs.existsSync(source)) {
    console.error('Usage: node import-ptims.js "path/to/ptims folder"   (needs stops.geojson from ptims.zip)');
    process.exit(1);
}
if (!fs.existsSync(INDEX)) {
    console.error('Missing ' + INDEX + '. Make it with build-data.js first.');
    process.exit(1);
}

// The PTIMS files are JavaScript ("var stops = { ... }"), not plain JSON. Only the object is read,
// as data: the file is never run.
function readPtims(file) {
    const text = fs.readFileSync(file, 'utf8');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('No data found in ' + file);
    const data = JSON.parse(text.slice(start, end + 1));
    if (!data || !Array.isArray(data.features)) throw new Error('No stop list in ' + file);
    return data.features.map((f) => (f && f.properties) || {});
}

const isTrue = (value) => value === true || String(value).toLowerCase() === 'true';

const mapStops = new Set(JSON.parse(fs.readFileSync(INDEX, 'utf8')).stops.map((s) => String(s[0])));

// AtcoCode -> true / false, or null when PTIMS disagrees with itself
const answers = new Map();
let skippedUnsurveyed = 0;
readPtims(source).forEach((p) => {
    const id = String(p.AtcoCode || '').trim();
    if (!id || !mapStops.has(id)) return;
    if (String(p.IsSurveyed) !== '1') { skippedUnsurveyed++; return; }
    const value = isTrue(p.WheelchairAccessibility);
    if (!answers.has(id)) answers.set(id, value);
    else if (answers.get(id) !== value) answers.set(id, null);
});

const accessible = [];
const notAccessible = [];
let conflicts = 0;
answers.forEach((value, id) => {
    if (value === true) accessible.push(id);
    else if (value === false) notAccessible.push(id);
    else conflicts++;
});
accessible.sort();
notAccessible.sort();

// Keep everything else in the file (hand-checked stops and routes, notes)
let current = {};
if (fs.existsSync(OUT)) {
    try { current = JSON.parse(fs.readFileSync(OUT, 'utf8')); }
    catch (error) { console.error(OUT + ' is not valid JSON, fix it first: ' + error.message); process.exit(1); }
}

const HELP = 'stops and routes: checked by hand. Key = stop id or route id from index.json, ' +
    'true = accessible, false = not accessible, leave out if not known. These win over ptims. ' +
    'ptims: written by import-ptims.js, do not edit by hand. See "Accessible stops and routes" in the README.';
const updated = Object.assign({ _help: HELP, stops: {}, routes: {} }, current, {
    _help: HELP,
    ptims: {
        source: 'PTIMS stop survey, National Transport Authority (CC BY 4.0)',
        file_date: fs.statSync(source).mtime.toISOString().slice(0, 10),
        accessible: accessible,
        not_accessible: notAccessible
    }
});

// One id per line would be long, so each list is one line; the rest stays readable
const text = JSON.stringify(updated, (key, value) =>
    (key === 'accessible' || key === 'not_accessible') ? '@@' + JSON.stringify(value) + '@@' : value, 4)
    .replace(/"@@(.*?)@@"/g, (_, list) => list.replace(/\\"/g, '"'));
fs.writeFileSync(OUT, text + '\n');

console.log('Wrote ' + OUT);
console.log('  ' + accessible.length + ' accessible, ' + notAccessible.length + ' not accessible');
console.log('  ' + (mapStops.size - accessible.length - notAccessible.length) + ' of ' + mapStops.size +
    ' map stops left as not known (' + skippedUnsurveyed + ' PTIMS records never surveyed, ' +
    conflicts + ' stops with conflicting answers, the rest not in PTIMS)');
