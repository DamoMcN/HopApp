// Route details: an add-on for the bus map (SCRUM-119 Choose a Bus Route).
// After a route is picked in Route view it shows where the bus is going ("Towards ..."),
// a list of every stop it passes through, and a button to switch direction.
//
// Like bus-alerts.js it is kept apart from map.js on purpose, so map.js does not need to change.
// It only needs:
//   - map.html to load this file after map.js:  <script src="route-details.js"></script>
//   - things map.js already has: `map`, `allRoutes`, `activeRoute`, the #route-container box, and
//     pickRoute(), resetRouteSelection(), fillStopLists(), drawLines(), renderStops()
// If any of those are missing (for example renamed later), this add-on switches itself off
// and the map works exactly as before.

(function () {
    'use strict';

    if (typeof map === 'undefined' || typeof allRoutes === 'undefined' ||
        typeof pickRoute !== 'function' || typeof resetRouteSelection !== 'function' ||
        typeof fillStopLists !== 'function' || typeof drawLines !== 'function' ||
        typeof renderStops !== 'function') return;

    const anchor = document.getElementById('route-container');
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
        .rd-card { margin: 0 0 1rem; padding: 0.9rem 1rem; border-radius: 14px; background: #ffffff; color: var(--text-main); }
        .rd-card[hidden] { display: none; }
        .rd-head { display: flex; align-items: center; gap: 0.6rem; }
        .rd-head strong { display: block; font-size: 0.95rem; }
        .rd-head small { color: var(--text-muted); font-size: 0.8rem; }
        .rd-towards { margin: 0.75rem 0 0.15rem; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
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

    // Shows one direction of the route, the same way map.js shows a picked route
    function showDirection(route) {
        resetRouteSelection();
        activeRoute = route;
        fillStopLists();
        document.getElementById('stop-selectors').hidden = false;
        drawLines([route]);
        renderStops();
        if (typeof fetchLiveBuses === 'function') fetchLiveBuses();
        render();
    }

    function render() {
        const route = typeof activeRoute !== 'undefined' ? activeRoute : null;
        const stops = route && route.properties.stops;
        card.innerHTML = '';
        if (!stops || stops.length < 2) { card.hidden = true; return; }

        const p = route.properties;
        const first = stops[0];
        const last = stops[stops.length - 1];

        const head = make('div', 'rd-head');
        const badge = make('span', 'bus-badge', p.short_name || '?');
        if (/citylink/i.test(p.agency_name || '')) badge.classList.add('is-citylink');
        const names = make('div');
        names.append(make('strong', '', p.long_name || p.display_name || ''), make('small', '', p.agency_name || ''));
        head.append(badge, names);

        const towards = make('p', 'rd-towards', 'Towards');
        const dest = make('p', 'rd-dest', last.name);
        dest.id = 'route-destination';
        const from = make('p', 'rd-from', 'From ' + first.name + ' · ' + stops.length + ' stops');
        card.append(head, towards, dest, from);

        const other = otherDirection(route);
        if (other) {
            const flip = make('button', 'rd-switch', '⇄ Switch direction');
            flip.type = 'button';
            flip.setAttribute('aria-label', 'Switch direction, towards ' + other.properties.stops[other.properties.stops.length - 1].name);
            flip.addEventListener('click', () => showDirection(other));
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

    // Follow map.js: whenever it picks or clears a route, update the card.
    // (map.js calls these by name, so wrapping them here is enough.)
    const originalPick = pickRoute;
    window.pickRoute = function () {
        const result = originalPick.apply(this, arguments);
        render();
        return result;
    };
    const originalReset = resetRouteSelection;
    window.resetRouteSelection = function () {
        const result = originalReset.apply(this, arguments);
        card.hidden = true;
        return result;
    };

    window.HopRouteDetails = { refresh: render };
})();
