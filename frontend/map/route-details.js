// Route details: an add-on for the bus map (SCRUM-119 Choose a Bus Route).
// After a route is picked from the search bar (route view), it shows where the bus is going
// ("Towards ..."), a list of every stop it passes through, and a button to switch direction.
//
// Like bus-alerts.js it is kept apart from map.js on purpose. It only needs:
//   - map.html to load this file after map.js:  <script src="route-details.js"></script>
//   - things map.js already has: `map`, `allRoutes`, showRoute(feature) (shows one direction of a
//     route) and the #view-route box with its .route-head
// If any of those are missing (for example renamed later), this add-on switches itself off
// and the map works exactly as before.

(function () {
    'use strict';

    if (typeof map === 'undefined' || typeof allRoutes === 'undefined' ||
        typeof showRoute !== 'function') return;

    const view = document.getElementById('view-route');
    const anchor = view && view.querySelector('.route-head');
    if (!anchor) return;

    const make = (tag, className, text) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    };

    // Our own styles, so map.html only needs the one script line
    const style = make('style');
    style.textContent = `
        .rd-card { margin: 0.75rem 0 1rem; padding: 0.9rem 1rem; border-radius: 14px; background: #ffffff; color: var(--text-main); }
        .rd-card[hidden] { display: none; }
        .rd-towards { margin: 0 0 0.15rem; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
        .rd-dest { font-size: 1.15rem; font-weight: 800; color: var(--card-ink); }
        .rd-from { margin-top: 0.2rem; font-size: 0.85rem; color: var(--text-muted); }
        .rd-switch { margin-top: 0.7rem; padding: 0.45rem 0.8rem; border: 2px solid var(--card-ink); border-radius: 10px;
                     background: none; color: var(--card-ink); font: inherit; font-weight: 700; font-size: 0.85rem; cursor: pointer; }
        .rd-stops { margin-top: 0.7rem; }
        .rd-stops summary { cursor: pointer; font-weight: 700; color: var(--card-ink); }
        .rd-stops ol { list-style: none; margin: 0.5rem 0 0; padding: 0; }
        .rd-stops li button { display: flex; gap: 0.6rem; width: 100%; padding: 0.4rem 0.2rem; border: none; border-bottom: 1px solid #eee6f4;
                              background: none; font: inherit; font-size: 0.9rem; text-align: left; color: var(--text-main); cursor: pointer; }
        .rd-stops li span { min-width: 1.6rem; color: var(--text-muted); }
        .rd-stops li:first-child button, .rd-stops li:last-child button { font-weight: 700; }
    `;
    document.head.appendChild(style);

    const card = make('section', 'rd-card');
    card.id = 'route-details';
    card.setAttribute('aria-label', 'Selected route');
    card.hidden = true;
    anchor.after(card);

    // The same route the other way round: same route id, starts somewhere else
    function otherDirection(route) {
        const stops = route.properties.stops;
        const first = stops[0].id;
        const last = stops[stops.length - 1].id;
        const others = allRoutes.filter((f) => f !== route &&
            f.properties.route_id === route.properties.route_id &&
            (f.properties.stops || []).length > 1 &&
            f.properties.stops[0].id !== first);
        // Prefer the one that starts where this one ends, then the one with most stops
        others.sort((a, b) =>
            (b.properties.stops[0].id === last) - (a.properties.stops[0].id === last) ||
            b.properties.stops.length - a.properties.stops.length);
        return others[0] || null;
    }

    function render(route) {
        const stops = route && route.properties && route.properties.stops;
        card.innerHTML = '';
        if (!stops || stops.length < 2) { card.hidden = true; return; }

        const first = stops[0];
        const last = stops[stops.length - 1];

        const towards = make('p', 'rd-towards', 'Towards');
        const dest = make('p', 'rd-dest', last.name);
        dest.id = 'route-destination';
        const from = make('p', 'rd-from', 'From ' + first.name + ' · ' + stops.length + ' stops');
        card.append(towards, dest, from);

        const other = otherDirection(route);
        if (other) {
            const flip = make('button', 'rd-switch', '⇄ Switch direction');
            flip.type = 'button';
            flip.setAttribute('aria-label', 'Switch direction, towards ' + other.properties.stops[other.properties.stops.length - 1].name);
            flip.addEventListener('click', () => window.showRoute(other));
            card.append(flip);
        }

        const list = make('details', 'rd-stops');
        list.append(make('summary', '', 'Show all ' + stops.length + ' stops'));
        const ol = make('ol');
        stops.forEach((stop, i) => {
            const li = make('li');
            const btn = make('button');
            btn.type = 'button';
            btn.append(make('span', '', String(i + 1)), document.createTextNode(stop.name));
            // Tap a stop to see it on the map
            btn.addEventListener('click', () => map.setView([stop.lat, stop.lon], Math.max(map.getZoom(), 16)));
            li.append(btn);
            ol.append(li);
        });
        list.append(ol);
        card.append(list);
        card.hidden = false;
    }

    // Follow map.js: whenever it shows a route, update the card. The card sits inside #view-route,
    // so it goes away with that view when the search is cleared or a journey is shown.
    // (map.js calls showRoute by name, so wrapping it here is enough.)
    const originalShow = showRoute;
    window.showRoute = function (feature) {
        const result = originalShow.apply(this, arguments);
        render(feature);
        return result;
    };

    window.HopRouteDetails = { refresh: () => render(typeof activeRoute !== 'undefined' ? activeRoute : null) };
})();
