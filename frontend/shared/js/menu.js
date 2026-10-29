// Shared hamburger menu for all logged-in pages.
//
// Usage on a page:
//   1. Put a <button id="menu-btn"> in the page header (see card.html)
//   2. Include this script: <script src="../shared/js/menu.js"></script>
//
// To add a menu item for every page at once, add it to MENU_ITEMS below.
// Help & Support and Log Out are added automatically (Log Out sits at the bottom).

const MENU_ITEMS = [
    // { label: 'Top Up',   href: '../topup/topup.html' },
    // { label: 'Settings', href: '../settings/settings.html' },
];

const SUPPORT_ITEM = { label: 'Help & Support', href: '../support/support.html', icon: '?' };

async function logout() {
    try {
        await fetch('../../backend/auth/logout.php');
    } catch (error) {
        console.error('Logout request failed:', error);
    }
    window.location.href = '../auth/index.html';
}

(function setupMenu() {
    const menuBtn = document.getElementById('menu-btn');
    if (!menuBtn) return;   // page has no hamburger button

    // ---- Build the overlay and drawer ----
    const overlay = document.createElement('div');
    overlay.className = 'menu-overlay';

    const nav = document.createElement('nav');
    nav.className = 'side-menu';
    nav.id = 'side-menu';
    nav.setAttribute('aria-label', 'Main menu');

    const header = document.createElement('div');
    header.className = 'side-menu-header';

    const title = document.createElement('span');
    title.className = 'side-menu-title';
    title.textContent = 'Menu';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'menu-close';
    closeBtn.setAttribute('aria-label', 'Close menu');
    closeBtn.textContent = '\u00d7';

    header.append(title, closeBtn);

    // Main links
    const list = document.createElement('ul');
    list.className = 'side-menu-list';

    [...MENU_ITEMS, SUPPORT_ITEM].forEach(item => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'side-menu-item';
        a.href = item.href;

        if (item.icon) {
            const icon = document.createElement('span');
            icon.className = 'side-menu-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = item.icon;
            a.appendChild(icon);
        }

        const label = document.createElement('span');
        label.textContent = item.label;
        a.appendChild(label);

        li.appendChild(a);
        list.appendChild(li);
    });

    // Log Out, pinned to the bottom of the drawer
    const footer = document.createElement('div');
    footer.className = 'side-menu-footer';

    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'side-menu-item danger';
    logoutBtn.textContent = 'Log Out';
    logoutBtn.addEventListener('click', logout);
    footer.appendChild(logoutBtn);

    nav.append(header, list, footer);
    document.body.append(overlay, nav);

    // ---- Open / close ----
    menuBtn.setAttribute('aria-controls', 'side-menu');
    menuBtn.setAttribute('aria-expanded', 'false');

    function openMenu() {
        nav.classList.add('open');
        overlay.classList.add('open');
        menuBtn.setAttribute('aria-expanded', 'true');
        closeBtn.focus();
    }

    function closeMenu() {
        nav.classList.remove('open');
        overlay.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.focus();
    }

    menuBtn.addEventListener('click', openMenu);
    closeBtn.addEventListener('click', closeMenu);
    overlay.addEventListener('click', closeMenu);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && nav.classList.contains('open')) closeMenu();
    });
})();