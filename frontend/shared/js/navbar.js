// Shared bottom navigation bar for logged-in pages.
//
// Usage on a page:
//   1. <link rel="stylesheet" href="../shared/css/navbar.css">
//   2. <body class="has-bottom-nav" data-nav="map">   (data-nav = this page's tab id)
//   3. <script src="../shared/js/navbar.js"></script>
//
// HOW CUSTOMISATION WILL WORK
// Every possible tab is listed once in TABS. What the person actually sees is a
// "config": an ordered list of tab ids plus the page to open at start-up/login.
//
//     { tabs: ['card', 'map', 'tickets'], startPage: 'card' }
//
// For now everyone gets DEFAULT_CONFIG. Later a settings page can save a config
// per user (the `settings` table already has `navbar_layout` (JSON) and
// `default_tab`) and pass it to HopNav.init(config). sanitise() makes sure a bad
// or out-of-date saved config can never break the bar.
//
// To add a new page to the app: add one entry to TABS. To change the default
// bar: edit DEFAULT_CONFIG.

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
        tabs: ['card', 'map', 'tickets'],
        startPage: 'card'
    };

    const MIN_TABS = 2;
    const MAX_TABS = 5;   // more than five is too cramped on a phone

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

        tabs = tabs.slice(0, MAX_TABS);

        // Too few valid tabs left: fall back to the defaults
        if (tabs.length < MIN_TABS) tabs = DEFAULT_CONFIG.tabs.slice();

        // The start page can be any known page, so it doesn't have to be in the bar
        const startPage = resolveId(input.startPage) || DEFAULT_CONFIG.startPage;

        return { tabs: tabs, startPage: startPage };
    }

    let current = sanitise(DEFAULT_CONFIG);

    // Where to go after login (or when the app opens)
    function startPageHref() {
        return TABS[current.startPage].href;
    }

    function render() {
        const old = document.querySelector('.bottom-nav');
        if (old) old.remove();

        const activeId = document.body.dataset.nav;

        const nav = document.createElement('nav');
        nav.className = 'bottom-nav';
        nav.setAttribute('aria-label', 'Main');

        const inner = document.createElement('div');
        inner.className = 'bottom-nav-inner';

        current.tabs.forEach((id) => {
            const tab = TABS[id];
            const link = document.createElement('a');
            link.className = 'bottom-nav-item';
            link.href = tab.href;
            if (id === activeId) link.setAttribute('aria-current', 'page');

            const iconWrap = document.createElement('span');
            iconWrap.className = 'bottom-nav-icon';
            iconWrap.innerHTML = tab.icon;   // our own fixed SVG strings above, never user data

            const label = document.createElement('span');
            label.className = 'bottom-nav-label';
            label.textContent = tab.label;

            link.append(iconWrap, label);
            inner.appendChild(link);
        });

        nav.appendChild(inner);
        document.body.appendChild(nav);
    }

    // Call with a saved config to customise, or with nothing for the defaults
    function init(config) {
        current = sanitise(config || DEFAULT_CONFIG);
        render();
    }

    window.HopNav = {
        TABS: TABS,
        DEFAULT_CONFIG: DEFAULT_CONFIG,
        MIN_TABS: MIN_TABS,
        MAX_TABS: MAX_TABS,
        sanitise: sanitise,
        startPageHref: startPageHref,
        init: init
    };

    init();
})();
