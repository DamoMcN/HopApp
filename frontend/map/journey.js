// Journey planning for the Hop map. Plain logic with no page code, so it can be tested in Node.
//
//   planJourneys(...)   which buses go from where you are to where you are going
//   applyLive(...)      adds waiting time and delays from the live arrivals
//   annotate(...)       flags late buses and says when another bus would be quicker
//
// Estimated times are "about" figures: walking is 80 m a minute, buses average 24 km/h plus a few
// seconds at each stop. The live wait and delay come from the live server when it has them.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.HopJourney = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const WALK_M_PER_MIN = 80;        // about 4.8 km/h
    const BUS_KMH = 24;               // average on the road, including traffic
    const STOP_DWELL_MIN = 0.2;       // time spent at each stop
    const ROAD_BEND_FACTOR = 1.2;     // roads are longer than the straight line between stops
    const LATE_MIN = 5;               // "running late" means 5 minutes or more
    const SAME_PLACE_M = 120;         // stops this close to a chosen stop count as the same place

    // ---------- Distances and nearby stops ----------

    function distanceM(lat1, lon1, lat2, lon2) {
        const rad = Math.PI / 180;
        const dLat = (lat2 - lat1) * rad;
        const dLon = (lon2 - lon1) * rad;
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
        return 6371000 * 2 * Math.asin(Math.sqrt(a));
    }

    function nearestStops(stopList, lat, lon, count, maxM) {
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

    // The stops someone could use to start or finish at a point: [{ stop, walkM }].
    // point is { lat, lon } or { lat, lon, stop } when a stop itself was chosen.
    // Looks close first, then further out, so a rural address still finds something.
    function stopsAround(stopList, point, options) {
        // In a busy street the nearest few stops can all be on one road, so look at plenty of them
        const o = Object.assign({ near: 600, far: 3000, count: 40 }, options || {});
        if (point.stop) {
            const picked = [{ stop: point.stop, walkM: 0 }];
            nearestStops(stopList, point.stop.lat, point.stop.lon, 6, SAME_PLACE_M).forEach((item) => {
                if (item.stop.id !== point.stop.id) picked.push({ stop: item.stop, walkM: item.d });
            });
            return picked;
        }
        let near = nearestStops(stopList, point.lat, point.lon, o.count, o.near);
        if (!near.length) near = nearestStops(stopList, point.lat, point.lon, Math.min(o.count, 6), o.far);
        return near.map((item) => ({ stop: item.stop, walkM: item.d }));
    }

    // ---------- Ride time ----------

    function rideMinutes(feature, fromPos, toPos) {
        const stops = feature.properties.stops;
        let meters = 0;
        for (let i = fromPos; i < toPos; i++) {
            meters += distanceM(stops[i].lat, stops[i].lon, stops[i + 1].lat, stops[i + 1].lon);
        }
        const driving = (meters * ROAD_BEND_FACTOR) / (BUS_KMH * 1000 / 60);
        return Math.max(2, Math.round(driving + (toPos - fromPos) * STOP_DWELL_MIN));
    }

    // ---------- Planning ----------

    // route features sharing one display name are the same service (for example both directions)
    const idsCache = new WeakMap();
    function routeIdsByName(routes) {
        if (!idsCache.has(routes)) {
            const byName = new Map();
            routes.forEach((f) => {
                const key = f.properties.display_name || f.properties.route_id;
                if (!byName.has(key)) byName.set(key, new Set());
                byName.get(key).add(String(f.properties.route_id));
            });
            idsCache.set(routes, byName);
        }
        return idsCache.get(routes);
    }

    // origins / dests: [{ stop, walkM }]. stopIndex: id -> { id, name, hits: [routeIdx, position, ...] }
    // Returns direct bus options, best first: one per bus service.
    function planJourneys(args) {
        const routes = args.routes;
        const limit = args.max || 8;
        const idsByName = routeIdsByName(routes);

        // for every destination stop: route index -> positions where it stops
        const destLookups = args.dests.map((d) => {
            const map = new Map();
            const hits = d.stop.hits || [];
            for (let i = 0; i < hits.length; i += 2) {
                if (!map.has(hits[i])) map.set(hits[i], []);
                map.get(hits[i]).push(hits[i + 1]);
            }
            return map;
        });

        const best = new Map();     // display name -> best candidate so far
        args.origins.forEach((o) => {
            const hits = o.stop.hits || [];
            for (let i = 0; i < hits.length; i += 2) {
                const routeIdx = hits[i];
                const fromPos = hits[i + 1];
                args.dests.forEach((d, di) => {
                    if (d.stop.id === o.stop.id) return;
                    const positions = destLookups[di].get(routeIdx);
                    if (!positions) return;
                    positions.forEach((toPos) => {
                        if (toPos <= fromPos) return;
                        const feature = routes[routeIdx];
                        const key = feature.properties.display_name || feature.properties.route_id;
                        // quick score to choose between candidates for the same bus: walking plus stops
                        const score = (o.walkM + d.walkM) / WALK_M_PER_MIN + (toPos - fromPos) * 1.2;
                        const have = best.get(key);
                        if (!have || score < have.score) {
                            best.set(key, { score: score, key: key, feature: feature, routeIdx: routeIdx,
                                            fromPos: fromPos, toPos: toPos, o: o, d: d });
                        }
                    });
                });
            }
        });

        const options = Array.from(best.values()).map((c) => {
            const walkToMin = Math.max(1, Math.round(c.o.walkM / WALK_M_PER_MIN));
            const walkFromMin = Math.max(1, Math.round(c.d.walkM / WALK_M_PER_MIN));
            const ride = rideMinutes(c.feature, c.fromPos, c.toPos);
            const stops = c.feature.properties.stops;
            return {
                key: c.key,
                feature: c.feature,
                routeIds: Array.from(idsByName.get(c.key) || [String(c.feature.properties.route_id)]),
                fromStop: stops[c.fromPos],
                toStop: stops[c.toPos],
                fromPos: c.fromPos,
                toPos: c.toPos,
                stopsBetween: c.toPos - c.fromPos,
                walkToM: Math.round(c.o.walkM),
                walkFromM: Math.round(c.d.walkM),
                walkToMin: walkToMin,
                walkFromMin: walkFromMin,
                rideMin: ride,
                baseMin: walkToMin + ride + walkFromMin,   // without waiting for the bus
                live: false, waitMin: null, delayMin: null, etaMin: null, late: false, advice: ''
            };
        });

        options.sort((a, b) => a.baseMin - b.baseMin ||
            String(a.feature.properties.short_name).localeCompare(String(b.feature.properties.short_name), undefined, { numeric: true }));
        return options.slice(0, limit);
    }

    // ---------- Live arrivals ----------

    // arrivalsByStop: stop id -> { now, arrivals: [{ routeId, time, delay }] }  (from /api/stop-times)
    function applyLive(options, arrivalsByStop, nowSeconds) {
        options.forEach((opt) => {
            opt.live = false; opt.waitMin = null; opt.delayMin = null; opt.etaMin = null; opt.late = false;
            const data = arrivalsByStop && arrivalsByStop[opt.fromStop.id];
            if (!data || !Array.isArray(data.arrivals)) return;

            // you can't catch a bus that leaves before you have walked to the stop
            const catchable = nowSeconds + opt.walkToMin * 60 - 30;
            const ids = new Set(opt.routeIds);
            const next = data.arrivals
                .filter((a) => a.time !== null && a.time !== undefined && ids.has(String(a.routeId)) && a.time >= catchable)
                .sort((a, b) => a.time - b.time)[0];
            if (!next) return;

            opt.live = true;
            opt.nextTime = next.time;
            opt.waitMin = Math.max(0, Math.round((next.time - nowSeconds) / 60 - opt.walkToMin));
            opt.delayMin = typeof next.delay === 'number' ? Math.round(next.delay / 60) : null;
            opt.late = opt.delayMin !== null && opt.delayMin >= LATE_MIN;
            opt.etaMin = opt.walkToMin + opt.waitMin + opt.rideMin + opt.walkFromMin;
        });
        return rank(options);
    }

    // Buses with live times first (quickest first), then the rest by estimated trip
    function rank(options) {
        return options.sort((a, b) => {
            if (a.live !== b.live) return a.live ? -1 : 1;
            if (a.live) return a.etaMin - b.etaMin || a.baseMin - b.baseMin;
            return a.baseMin - b.baseMin;
        });
    }

    // Says when a late bus has a quicker alternative, and when it does not
    function annotate(options) {
        const liveOnes = options.filter((o) => o.live);
        const fastest = liveOnes.length ? liveOnes.reduce((a, b) => (b.etaMin < a.etaMin ? b : a)) : null;
        options.forEach((opt) => {
            opt.advice = '';
            if (!opt.late) return;
            const label = 'Running ' + opt.delayMin + ' min late.';
            if (fastest && fastest !== opt && fastest.etaMin < opt.etaMin) {
                const saving = opt.etaMin - fastest.etaMin;
                opt.advice = label + ' The ' + fastest.feature.properties.short_name + ' would get you there about ' +
                    saving + (saving === 1 ? ' minute' : ' minutes') + ' sooner.';
            } else if (options.length > 1) {
                opt.advice = label + ' The other buses below are not quicker right now.';
            } else {
                opt.advice = label + ' There is no other direct bus on this journey.';
            }
        });
        return options;
    }

    // ---------- Text ----------

    function formatMinutes(min) {
        if (min < 60) return min + ' min';
        const h = Math.floor(min / 60);
        const m = min % 60;
        return h + ' h' + (m ? ' ' + m + ' min' : '');
    }

    function formatDistance(m) {
        if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + ' m';
        return (m / 1000).toFixed(1) + ' km';
    }

    function normalise(text) {
        return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    // ---------- Searching routes by number or name ----------

    function searchRoutes(routes, query, limit) {
        const text = normalise(query).trim();
        if (!text) return [];
        const seen = new Map();
        routes.forEach((f) => {
            const p = f.properties;
            const key = p.display_name || p.route_id;
            if (seen.has(key)) return;
            const short = normalise(p.short_name);
            const rest = normalise(p.long_name + ' ' + p.agency_name);
            let rank = -1;
            if (short === text) rank = 0;
            else if (short.startsWith(text)) rank = 1;
            else if (text.length >= 3 && rest.includes(text)) rank = 2;
            if (rank >= 0) seen.set(key, { feature: f, rank: rank });
        });
        return Array.from(seen.values())
            .sort((a, b) => a.rank - b.rank ||
                String(a.feature.properties.short_name).localeCompare(String(b.feature.properties.short_name), undefined, { numeric: true }))
            .slice(0, limit || 4)
            .map((x) => x.feature);
    }

    // ---------- Places (from the Photon / OpenStreetMap search) ----------

    // Turns a Photon reply into [{ name, detail, lat, lon }]
    function parsePlaces(json, limit) {
        const out = [];
        const seen = new Set();
        ((json && json.features) || []).forEach((f) => {
            const c = f && f.geometry && f.geometry.coordinates;
            const p = (f && f.properties) || {};
            if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return;
            const name = p.name || [p.housenumber, p.street].filter(Boolean).join(' ');
            if (!name) return;
            const detail = [p.name ? [p.housenumber, p.street].filter(Boolean).join(' ') : '', p.district, p.city || p.town || p.village, p.county]
                .filter(Boolean)
                .filter((part, i, all) => part !== name && all.indexOf(part) === i)
                .join(', ');
            const key = name + '|' + detail;
            if (seen.has(key)) return;
            seen.add(key);
            out.push({ name: name, detail: detail, lat: c[1], lon: c[0] });
        });
        return out.slice(0, limit || 4);
    }

    return {
        WALK_M_PER_MIN, LATE_MIN,
        distanceM, nearestStops, stopsAround, rideMinutes,
        planJourneys, applyLive, rank, annotate,
        formatMinutes, formatDistance, normalise,
        searchRoutes, parsePlaces
    };
});
