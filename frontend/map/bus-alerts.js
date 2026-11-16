// Bus alerts: an add-on for the bus map. Tells you when a bus is close to your stop,
// and when it is running late.
//
// It is kept apart from map.js on purpose, so map.js does not need to change. It only needs:
//   - map.html to load this file after map.js:  <script src="bus-alerts.js"></script>
//   - two things map.js already has: the Leaflet `map` and `CONFIG.STOP_TIMES_URL`
//   - the stop card's "Stop <id>" line, to know which stop a card is for
//
// It reads the same /api/stop-times data as the stop card ("Next buses"). That only exists on the
// hosted Node live server, so with the PHP live server (or before the new server is deployed)
// the alerts say live times are not available. Nothing is sent anywhere: the alerts you set are
// kept in this browser only, and they only work while the map page is open.

(function () {
    'use strict';

    if (typeof map === 'undefined' || typeof CONFIG === 'undefined' || !CONFIG.STOP_TIMES_URL) return;

    const STORE_KEY = 'hop.busAlerts';
    const MAX_ALERTS = 3;
    const CHECK_MS = 30000;            // same pace as the stop card
    const DUE_CHOICES = [2, 5, 10];    // "tell me when it is N minutes away"
    const DEFAULT_DUE = 5;
    const LATE_SECONDS = 5 * 60;       // "running late" means 5 minutes or more
    const LATE_STEP_SECONDS = 5 * 60;  // tell again each time it gets another 5 minutes later
    const TOAST_MS = 9000;

    let alerts = readAlerts();         // [{ id, stopId, stopName, routeIds, routeLabel, dueMin, late }]
    const statusById = new Map();      // alert id -> latest status line
    const told = new Map();            // what has already been said, so nothing is repeated
    let checking = false;

    const $make = (tag, className, text) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    };

    // Our own styles, so map.html only needs the one script line
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'bus-alerts.css';
    document.head.appendChild(css);

    // =========================================
    //  Saved alerts (this browser only)
    // =========================================

    function readAlerts() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
            return Array.isArray(saved) ? saved.filter(isValidAlert).slice(0, MAX_ALERTS) : [];
        } catch (e) {
            return [];
        }
    }

    function isValidAlert(a) {
        return a && typeof a.id === 'string' && typeof a.stopId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(a.stopId) &&
            typeof a.stopName === 'string' && Array.isArray(a.routeIds) && typeof a.routeLabel === 'string' &&
            DUE_CHOICES.includes(a.dueMin) && typeof a.late === 'boolean';
    }

    function saveAlerts() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(alerts)); } catch (e) { /* private mode: still works this visit */ }
    }

    // =========================================
    //  Route names (from the same index.json the map uses)
    // =========================================

    let routeInfo = null;   // { shortById: Map(route_id -> "409"), atStop: Map(stop id -> [{ label, routeIds }]) }

    async function loadRouteInfo() {
        if (routeInfo) return routeInfo;
        try {
            const data = await (await fetch(CONFIG.INDEX_URL)).json();
            const shortById = new Map();
            const atStop = new Map();
            data.routes.forEach((r) => {
                const routeId = String(r[0]);
                const label = String(r[1] || '?');
                shortById.set(routeId, label);
                (r[7] || []).forEach((stopIndex) => {
                    const stop = data.stops[stopIndex];
                    if (!stop) return;
                    const id = String(stop[0]);
                    if (!atStop.has(id)) atStop.set(id, new Map());
                    const byLabel = atStop.get(id);
                    if (!byLabel.has(label)) byLabel.set(label, new Set());
                    byLabel.get(label).add(routeId);
                });
            });
            const sorted = new Map();
            atStop.forEach((byLabel, id) => {
                sorted.set(id, Array.from(byLabel, ([label, ids]) => ({ label, routeIds: Array.from(ids) }))
                    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })));
            });
            routeInfo = { shortById, atStop: sorted };
        } catch (error) {
            console.warn('Bus alerts: route names unavailable', error);
            routeInfo = { shortById: new Map(), atStop: new Map() };
        }
        return routeInfo;
    }

    function routeName(routeId) {
        return (routeInfo && routeInfo.shortById.get(routeId)) || 'A bus';
    }

    // =========================================
    //  Telling the person
    // =========================================

    const toasts = $make('div', 'bus-alert-toasts');
    toasts.setAttribute('role', 'status');
    toasts.setAttribute('aria-live', 'polite');
    document.body.appendChild(toasts);

    function notify(title, body, kind) {
        const toast = $make('div', 'bus-alert-toast' + (kind ? ' is-' + kind : ''));
        toast.append($make('strong', '', title), $make('span', '', body));
        const close = $make('button', 'bus-alert-toast-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', 'Dismiss');
        close.addEventListener('click', () => toast.remove());
        toast.appendChild(close);
        toasts.prepend(toast);
        while (toasts.children.length > 3) toasts.lastChild.remove();
        setTimeout(() => toast.remove(), TOAST_MS);

        // A phone or desktop notification too, when the person is on another tab or app
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            try { new Notification(title, { body: body, tag: 'hop-bus-' + title }); } catch (e) { /* not allowed here */ }
        }
    }

    function askForNotifications() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
    }

    function minutes(seconds) {
        const m = Math.max(1, Math.round(seconds / 60));
        return m + (m === 1 ? ' minute' : ' minutes');
    }

    function clock(epochSeconds) {
        return new Date(epochSeconds * 1000).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' });
    }

    function delayText(delay) {
        if (typeof delay !== 'number') return '';
        const m = Math.round(delay / 60);
        if (m === 0) return 'on time';
        return m > 0 ? m + ' min late' : Math.abs(m) + ' min early';
    }

    // =========================================
    //  Checking the live times
    // =========================================

    async function fetchStopTimes(stopId) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch(CONFIG.STOP_TIMES_URL + '?stop_id=' + encodeURIComponent(stopId), { signal: controller.signal });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const data = await response.json();
            if (!data || !Array.isArray(data.arrivals)) throw new Error('Unexpected reply');
            return data;
        } finally {
            clearTimeout(timeout);
        }
    }

    function checkAlert(alert, data) {
        const now = typeof data.now === 'number' ? data.now : Math.floor(Date.now() / 1000);
        const arrivals = data.arrivals
            .filter((a) => typeof a.time === 'number' && a.time >= now - 60)
            .filter((a) => alert.routeIds.length === 0 || alert.routeIds.includes(a.routeId))
            .sort((a, b) => a.time - b.time);

        arrivals.forEach((a) => {
            const trip = alert.id + '|' + (a.tripId || a.routeId + '@' + a.time);
            const name = routeName(a.routeId);
            const away = a.time - now;

            // 1. Close to the stop (said once per bus)
            if (away > 0 && away <= alert.dueMin * 60 && !told.has('due|' + trip)) {
                told.set('due|' + trip, now);
                const late = delayText(a.delay);
                notify(name + ' is ' + minutes(away) + ' away',
                    'Due at ' + alert.stopName + ' at ' + clock(a.time) + (late ? ' (' + late + ')' : '') + '.', 'due');
            }

            // 2. Running late (said again each time it gets another 5 minutes later)
            if (alert.late && typeof a.delay === 'number' && a.delay >= LATE_SECONDS) {
                const step = Math.floor(a.delay / LATE_STEP_SECONDS);
                if ((told.get('late|' + trip) || 0) < step) {
                    told.set('late|' + trip, step);
                    notify(name + ' is running ' + Math.round(a.delay / 60) + ' min late',
                        'Now due at ' + alert.stopName + ' at ' + clock(a.time) + '.', 'late');
                }
            }
        });

        const next = arrivals.find((a) => a.time >= now);
        if (!next) return 'No buses due soon.';
        const late = delayText(next.delay);
        return 'Next ' + routeName(next.routeId) + ': ' +
            (next.time - now <= 60 ? 'due now' : 'in ' + minutes(next.time - now)) + (late ? ', ' + late : '') + '.';
    }

    async function checkAll() {
        if (checking || alerts.length === 0) return;
        checking = true;
        try {
            await loadRouteInfo();
            const stopIds = Array.from(new Set(alerts.map((a) => a.stopId)));
            for (const stopId of stopIds) {
                let data = null;
                try {
                    data = await fetchStopTimes(stopId);
                } catch (error) {
                    console.warn('Bus alerts: stop times unavailable', error);
                }
                alerts.filter((a) => a.stopId === stopId).forEach((a) => {
                    statusById.set(a.id, data ? checkAlert(a, data) : 'Live times are not available right now.');
                });
            }
        } finally {
            checking = false;
            renderPanel();
        }
    }

    // Keeps checking while the page is open, even on another tab (browsers slow this to about once a minute)
    setInterval(checkAll, CHECK_MS);

    // =========================================
    //  Adding and removing alerts
    // =========================================

    function addAlert(alert) {
        alerts = alerts.filter((a) => !(a.stopId === alert.stopId && a.routeLabel === alert.routeLabel));
        alerts.unshift(alert);
        alerts = alerts.slice(0, MAX_ALERTS);
        saveAlerts();
        statusById.set(alert.id, 'Checking live times…');
        renderPanel();
        askForNotifications();
        checkAll();
    }

    function removeAlert(id) {
        alerts = alerts.filter((a) => a.id !== id);
        statusById.delete(id);
        saveAlerts();
        renderPanel();
    }

    // =========================================
    //  "Alerts" button and list, in the map's top bar
    // =========================================

    const topbar = document.querySelector('.map-topbar') || document.body;
    const toggle = $make('button', 'bus-alerts-btn');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'bus-alerts-panel');
    topbar.appendChild(toggle);

    const panel = $make('section', 'bus-alerts-panel');
    panel.id = 'bus-alerts-panel';
    panel.setAttribute('aria-label', 'Bus alerts');
    panel.hidden = true;
    document.body.appendChild(panel);

    toggle.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        toggle.setAttribute('aria-expanded', String(!panel.hidden));
        if (!panel.hidden) checkAll();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !panel.hidden) {
            panel.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            toggle.focus();
        }
    });

    function renderPanel() {
        toggle.textContent = 'Alerts' + (alerts.length ? ' (' + alerts.length + ')' : '');
        toggle.setAttribute('aria-label', alerts.length
            ? 'Bus alerts, ' + alerts.length + ' on' : 'Bus alerts, none set');

        panel.innerHTML = '';
        panel.appendChild($make('h2', 'bus-alerts-title', 'Bus alerts'));

        if (alerts.length === 0) {
            panel.appendChild($make('p', 'bus-alerts-note',
                'No alerts yet. Tap a bus stop on the map and choose Alert me.'));
            return;
        }

        const list = $make('ul', 'bus-alerts-list');
        alerts.forEach((a) => {
            const li = $make('li', 'bus-alerts-item');
            const text = $make('div', 'bus-alerts-text');
            text.append(
                $make('strong', '', a.routeLabel + ' at ' + a.stopName),
                $make('small', '', 'When ' + a.dueMin + ' min away' + (a.late ? ', and if 5+ min late' : '')),
                $make('span', 'bus-alerts-status', statusById.get(a.id) || 'Checking live times…')
            );
            const remove = $make('button', 'bus-alerts-remove', 'Remove');
            remove.type = 'button';
            remove.setAttribute('aria-label', 'Remove alert for ' + a.routeLabel + ' at ' + a.stopName);
            remove.addEventListener('click', () => removeAlert(a.id));
            li.append(text, remove);
            list.appendChild(li);
        });
        panel.appendChild(list);
        panel.appendChild($make('p', 'bus-alerts-note', 'Alerts work while this page is open.'));
    }

    // =========================================
    //  "Alert me" in the stop card
    // =========================================

    // The card's first grey line is "Stop <id>" (see stopCard in map.js)
    function stopFromCard(card) {
        const line = card.querySelector('.popup-line');
        const match = line && /^Stop (\S+)$/.exec(line.textContent.trim());
        if (!match) return null;
        const title = card.querySelector('.popup-title');
        const name = title ? title.textContent.replace(/^(From|To): /, '').trim() : match[1];
        return { id: match[1], name: name || match[1] };
    }

    async function addAlertForm(card, stop) {
        const box = $make('div', 'bus-alert-form');
        box.appendChild($make('h3', 'stop-card-title', 'Bus alerts'));

        const routeSelect = $make('select', 'bus-alert-select');
        routeSelect.setAttribute('aria-label', 'Which bus');
        routeSelect.appendChild(new Option('Any bus', ''));
        const dueSelect = $make('select', 'bus-alert-select');
        dueSelect.setAttribute('aria-label', 'How many minutes away');
        DUE_CHOICES.forEach((m) => dueSelect.appendChild(new Option(m + ' min away', String(m), m === DEFAULT_DUE, m === DEFAULT_DUE)));

        const row = $make('div', 'bus-alert-row');
        row.append($make('span', '', 'Tell me when'), routeSelect, $make('span', '', 'is'), dueSelect);

        const lateLabel = $make('label', 'bus-alert-late');
        const late = document.createElement('input');
        late.type = 'checkbox';
        late.checked = true;
        lateLabel.append(late, document.createTextNode(' and if it is 5+ min late'));

        const button = $make('button', 'bus-alert-add', 'Alert me');
        button.type = 'button';

        box.append(row, lateLabel, button);
        card.appendChild(box);

        const info = await loadRouteInfo();
        (info.atStop.get(stop.id) || []).forEach((r) => routeSelect.appendChild(new Option(r.label, r.label)));

        button.addEventListener('click', () => {
            const choice = (info.atStop.get(stop.id) || []).find((r) => r.label === routeSelect.value);
            addAlert({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                stopId: stop.id,
                stopName: stop.name,
                routeIds: choice ? choice.routeIds : [],
                routeLabel: choice ? choice.label : 'Any bus',
                dueMin: Number(dueSelect.value),
                late: late.checked
            });
            button.textContent = 'Alert set';
            button.disabled = true;
        });
    }

    map.on('popupopen', (event) => {
        const el = event.popup.getElement();
        const card = el && el.querySelector('.stop-card');
        if (!card || card.querySelector('.bus-alert-form')) return;
        const stop = stopFromCard(card);
        if (stop) addAlertForm(card, stop);
    });

    // For tests and debugging
    window.HopBusAlerts = { checkNow: checkAll, list: () => alerts.slice() };

    renderPanel();
    if (alerts.length) checkAll();
})();
