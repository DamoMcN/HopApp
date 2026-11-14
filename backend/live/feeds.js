'use strict';

// Turns decoded GTFS-Realtime feeds into the small shapes the Hop map needs.
// Kept apart from server.js so it can be tested without a network or an API key.

const TRIP_CANCELED = 3;   // TripDescriptor.ScheduleRelationship.CANCELED
const STOP_SKIPPED = 1;    // StopTimeUpdate.ScheduleRelationship.SKIPPED

// The NTA feeds often give only a trip id. trip-routes.json (made by build-trip-routes.js from
// trips.txt) says which route each trip belongs to: { routes: [route_id, ...], trips: { trip_id: index } }
function routeFor(trip, lookup) {
    if (trip.routeId) return trip.routeId;
    if (!lookup || !trip.tripId) return null;
    const index = lookup.trips[trip.tripId];
    return index === undefined ? null : lookup.routes[index];
}

// Vehicle positions: [{ id, routeId, lat, lon, speed, timestamp }]
function parseVehicles(feed, lookup) {
    return feed.entity
        .filter((e) => e.vehicle && e.vehicle.position && e.vehicle.trip)
        .map((e) => ({
            id: e.id,
            routeId: routeFor(e.vehicle.trip, lookup),
            lat: e.vehicle.position.latitude,
            lon: e.vehicle.position.longitude,
            speed: e.vehicle.position.speed || null,   // metres per second
            timestamp: e.vehicle.timestamp ? Number(e.vehicle.timestamp) : null
        }));
}

// Trip updates, grouped by stop: Map(stopId -> [{ routeId, tripId, time, delay }])
//   time  = predicted arrival (seconds since 1970), or null if the feed only gave a delay
//   delay = seconds late (negative = early), or null if unknown
function parseTripUpdates(feed, lookup) {
    const byStop = new Map();

    feed.entity.forEach((e) => {
        const update = e.tripUpdate;
        if (!update || !update.trip) return;
        if (update.trip.scheduleRelationship === TRIP_CANCELED) return;

        (update.stopTimeUpdate || []).forEach((stu) => {
            if (!stu.stopId || stu.scheduleRelationship === STOP_SKIPPED) return;

            const event = stu.arrival || stu.departure;
            if (!event) return;

            const time = event.time ? Number(event.time) || null : null;
            const delay = typeof event.delay === 'number' ? event.delay : null;
            if (time === null && delay === null) return;

            if (!byStop.has(stu.stopId)) byStop.set(stu.stopId, []);
            byStop.get(stu.stopId).push({
                routeId: routeFor(update.trip, lookup),
                tripId: update.trip.tripId || null,
                time: time,
                delay: delay
            });
        });
    });

    return byStop;
}

// The next buses at one stop, soonest first. A bus that left a minute ago still shows as "Due".
function arrivalsFor(byStop, stopId, nowSeconds, limit) {
    const list = (byStop.get(stopId) || []).filter((a) => a.time === null || a.time >= nowSeconds - 60);
    list.sort((a, b) => (a.time === null) - (b.time === null) || a.time - b.time);
    return list.slice(0, limit);
}

module.exports = { routeFor, parseVehicles, parseTripUpdates, arrivalsFor };
