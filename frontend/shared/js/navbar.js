// Shared bottom navigation bar for logged-in pages.
//
// Usage on a page:
//   1. <link rel="stylesheet" href="../shared/css/navbar.css">
//   2. <body class="has-bottom-nav" data-nav="map">   (data-nav = this page's tab id)
//   3. <script src="../shared/js/navbar.js"></script>
//
// HOW CUSTOMISATION WORKS
// Every possible tab is listed once in TABS. What the person actually sees is a
// "config": an ordered list of tab ids plus the page to open at start-up/login.
//
//     { tabs: ['card', 'topup', 'map', 'tickets'], startPage: 'card' }
//
// The person's own config is chosen in Settings > Customise app and saved on their account
// (backend/auth/nav_settings.php, in the `settings` table). It is also kept in localStorage so
// the bar draws straight away on every page, then the saved copy from the server replaces it
// if it differs. Without one, everyone gets DEFAULT_CONFIG. Card and Top Up (REQUIRED) are
// always in the bar. sanitise() makes sure a bad or out-of-date config can never break the bar.
//
// To add a new page to the app: add one entry to TABS (and to NAV_PAGES in nav_settings.php).
// To change the default bar: edit DEFAULT_CONFIG.

(function () {
    const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
                       'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

    // Paths are relative to the pages in frontend/<folder>/, like every other link in the app
    const TABS = {
        card: {
            label: 'Card',
            href: '../card/card.html',
            icon: '<svg ' + ICON_ATTRS + '><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19"/><path d="M6 15h4"/></svg>'
        },
        map: {
            label: 'Map',
            href: '../map/map.html',
            icon: '<svg ' + ICON_ATTRS + '><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>'
        },
        tickets: {
            label: 'Tickets',
            href: '../tickets/tickets.html',
            icon: '<svg ' + ICON_ATTRS + '><path d="M3 9a2 2 0 0 0 0 6v2.5A1.5 1.5 0 0 0 4.5 19h15a1.5 1.5 0 0 0 1.5-1.5V15a2 2 0 0 1 0-6V6.5A1.5 1.5 0 0 0 19.5 5h-15A1.5 1.5 0 0 0 3 6.5z"/><path d="M14 5v2M14 11v2M14 17v2"/></svg>'
        },
        topup: {
            label: 'Top Up',
            href: '../topup/topup.html',
            icon: '<svg ' + ICON_ATTRS + '><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>'
        },
        support: {
            label: 'Help',
            href: '../support/support.html',
            icon: '<svg ' + ICON_ATTRS + '><circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.2.9-1.2 1.7"/><path d="M12 17h.01"/></svg>'
        }
    };

    const DEFAULT_CONFIG = {
        tabs: ['card', 'topup', 'map', 'tickets'],
        startPage: 'card'
    };

    const REQUIRED = ['card', 'topup'];   // always in the bar
    const MIN_TABS = 2;
    const MAX_TABS = 5;   // more than five is too cramped on a phone
    const NAV_API = '../../backend/auth/nav_settings.php';
    const STORE_KEY = 'hop.nav';

    // Names the database or older code might use for a page
    const ALIASES = { home: 'card' };

    function resolveId(id) {
        id = ALIASES[id] || id;
        return Object.prototype.hasOwnProperty.call(TABS, id) ? id : null;
    }

    // Turns anything (including garbage) into a safe config
    function sanitise(config) {
        const input = config && typeof config === 'object' ? config : {};
        const seen = new Set();
        let tabs = [];

        (Array.isArray(input.tabs) ? input.tabs : []).forEach((raw) => {
            const id = resolveId(raw);
            if (id && !seen.has(id)) {
                seen.add(id);
                tabs.push(id);
            }
        });

        // Nothing usable saved: use the default bar
        if (!tabs.length) tabs = DEFAULT_CONFIG.tabs.slice(), tabs.forEach((id) => seen.add(id));

        // Card and Top Up can't be taken away
        REQUIRED.slice().reverse().forEach((id) => {
            if (!seen.has(id)) { seen.add(id); tabs.unshift(id); }
        });

        tabs = tabs.slice(0, MAX_TABS);

        // Too few valid tabs left: fall back to the defaults
        if (tabs.length < MIN_TABS) tabs = DEFAULT_CONFIG.tabs.slice();

        // The start page can be any known page, so it doesn't have to be in the bar
        const startPage = resolveId(input.startPage) || DEFAULT_CONFIG.startPage;

        return { tabs: tabs, startPage: startPage };
    }

    function sameConfig(a, b) {
        return a.startPage === b.startPage && a.tabs.join(',') === b.tabs.join(',');
    }

    // ---- The copy kept on this device, so the bar draws at once ----
    function readStored() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
            return raw ? sanitise(raw) : null;
        } catch (error) {
            return null;
        }
    }

    function store(config) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(config)); } catch (error) { /* the bar still works */ }
    }

    let current = sanitise(DEFAULT_CONFIG);

    // Where to go after login (or when the app opens)
    function startPageHref() {
        return TABS[current.startPage].href;
    }

    // One button of the bar. A real link in the bar, a plain box in the preview in Settings.
    function makeItem(id, activeId, tagName) {
        const tab = TABS[id];
        const item = document.createElement(tagName);
        item.className = 'bottom-nav-item';
        item.dataset.tab = id;
        if (tagName === 'a') item.href = tab.href;
        if (id === activeId) item.setAttribute('aria-current', 'page');

        const iconWrap = document.createElement('span');
        iconWrap.className = 'bottom-nav-icon';
        iconWrap.innerHTML = tab.icon;   // our own fixed SVG strings above, never user data

        const label = document.createElement('span');
        label.className = 'bottom-nav-label';
        label.textContent = tab.label;

        item.append(iconWrap, label);
        return item;
    }

    // The same bar without links, for showing a choice before it is saved
    function previewBar(tabs, activeId) {
        const inner = document.createElement('div');
        inner.className = 'bottom-nav-inner';
        inner.setAttribute('aria-hidden', 'true');
        tabs.forEach((id) => { if (TABS[id]) inner.appendChild(makeItem(id, activeId, 'span')); });
        return inner;
    }

    function render() {
        const old = document.querySelector('.bottom-nav');
        if (old) old.remove();

        const nav = document.createElement('nav');
        nav.className = 'bottom-nav';
        nav.setAttribute('aria-label', 'Main');

        const inner = document.createElement('div');
        inner.className = 'bottom-nav-inner';

        const activeId = document.body.dataset.nav;
        current.tabs.forEach((id) => inner.appendChild(makeItem(id, activeId, 'a')));

        nav.appendChild(inner);
        document.body.appendChild(nav);
    }

    function apply(config) {
        const next = sanitise(config);
        if (sameConfig(next, current)) return;
        current = next;
        render();
    }

    // The person's saved bar from the server. Resolves to the config, or null when it can't be had
    // (not logged in, offline): the bar then stays as it is.
    function load() {
        return fetch(NAV_API, { cache: 'no-store' })
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
                if (!data || data.logged_in === false || !Array.isArray(data.tabs)) return null;
                const config = sanitise({ tabs: data.tabs, startPage: data.start_page });
                store(config);
                apply(config);
                return config;
            })
            .catch(() => null);
    }

    // Saves a choice on the account. Resolves to { ok: true, config } or { ok: false, error }.
    function save(config) {
        const clean = sanitise(config);
        return fetch(NAV_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tabs: clean.tabs, start_page: clean.startPage })
        })
            .then((response) => response.json().catch(() => ({})).then((data) => ({ response, data })))
            .then(({ response, data }) => {
                if (data.logged_in === false) { window.location.href = '../auth/index.html'; return { ok: false, error: '' }; }
                if (!response.ok || !data.success) {
                    return { ok: false, error: data.error || 'Could not save. Please try again.' };
                }
                store(clean);
                apply(clean);
                return { ok: true, config: clean };
            })
            .catch(() => ({ ok: false, error: 'Could not save. Check your connection and try again.' }));
    }

    // Forgets this device's copy (log out), so the next person to log in doesn't see this bar
    function forget() {
        try { localStorage.removeItem(STORE_KEY); } catch (error) { /* nothing to forget */ }
    }

    // Call with a config to show exactly that, or with nothing for the person's own bar
    function init(config) {
        if (config) {
            current = sanitise(config);
            render();
            return;
        }
        current = readStored() || sanitise(DEFAULT_CONFIG);
        render();
        load();
    }

    window.HopNav = {
        TABS: TABS,
        DEFAULT_CONFIG: DEFAULT_CONFIG,
        REQUIRED: REQUIRED,
        MIN_TABS: MIN_TABS,
        MAX_TABS: MAX_TABS,
        sanitise: sanitise,
        startPageHref: startPageHref,
        current: () => ({ tabs: current.tabs.slice(), startPage: current.startPage }),
        previewBar: previewBar,
        load: load,
        save: save,
        forget: forget,
        init: init
    };

    init();
})();
