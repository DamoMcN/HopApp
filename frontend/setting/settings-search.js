// Search in Settings (SCRUM-127).
// Type a word (e.g. "freeze", "email", "top up") to see matching settings.
// Choosing a result scrolls to that setting and highlights it, or opens the
// page where that setting lives.
//
// Kept in its own file so setting.js does not need to change.
// To add a setting to the search, add an entry to SETTINGS below:
//   target: the id of the element on this page to jump to, OR
//   href:   another page to open (for settings that live elsewhere)

(function () {
    'use strict';

    const SETTINGS = [
        { title: 'Name',                     section: 'User profile',  target: 'profile-name',       keywords: 'account details my name' },
        { title: 'Email',                    section: 'User profile',  target: 'profile-email',      keywords: 'account details e-mail address' },
        { title: 'Card type',                section: 'User profile',  target: 'profile-card-type',  keywords: 'adult student child young adult fare' },
        { title: 'Phone number',             section: 'User profile',  target: 'profile-phone',      keywords: 'account details mobile telephone number' },
        { title: 'Change name',              section: 'User profile',  target: 'edit-name', press: true, keywords: 'edit update rename first last surname account details pencil' },
        { title: 'Change email',             section: 'User profile',  target: 'edit-email', press: true, keywords: 'edit update new e-mail address login account details pencil' },
        { title: 'Change phone number',      section: 'User profile',  target: 'edit-phone', press: true, keywords: 'edit update new mobile telephone account details pencil' },
        { title: 'Change password',          section: 'User profile',  target: 'change-password-toggle', keywords: 'edit update new reset login security account' },
        { title: 'Freeze or unfreeze card',  section: 'Card settings', target: 'card-status-button', keywords: 'card status lock block pause' },
        { title: 'Report a lost or stolen card', section: 'My Card',   href: '../card/card.html',    keywords: 'lost stolen report block' },
        { title: 'Automatic top up',         section: 'Top-up',        target: 'auto-topup-enabled', keywords: 'auto topup turn on off balance low' },
        { title: 'Card for automatic top up', section: 'Top-up',       target: 'auto-topup-card',    keywords: 'saved card payment pay auto topup' },
        { title: 'Automatic top up amount',  section: 'Top-up',        target: 'auto-topup-amount',  keywords: 'how much money auto topup' },
        { title: 'Saved payment cards',      section: 'Top Up',        href: '../topup/topup.html',  keywords: 'add remove new card payment visa mastercard' },
        { title: 'Recurring top up',         section: 'Recurring Top Up', href: '../recurring/recurring.html', keywords: 'weekly monthly every week schedule repeat' }
    ];

    const input = document.getElementById('settings-search');
    const list = document.getElementById('settings-search-results');
    const empty = document.getElementById('settings-search-empty');
    if (!input || !list || !empty) return;

    const normalise = (text) => text.toLowerCase().replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();

    function matches(query) {
        const words = normalise(query).split(' ').filter(Boolean);
        return SETTINGS.filter((s) => {
            const text = normalise(s.title + ' ' + s.section + ' ' + s.keywords);
            // "topup" and "top up" should both work
            const joined = text.replace(/ /g, '');
            return words.every((w) => text.includes(w) || joined.includes(w));
        });
    }

    // Scroll to the setting, put the keyboard focus on it and flash its panel
    function open(setting) {
        if (setting.href) {
            window.location.href = setting.href;
            return;
        }
        const el = document.getElementById(setting.target);
        if (!el) return;
        // Change name / email / password sit in a fold-out section: open it
        const fold = el.closest('details');
        if (fold) fold.open = true;
        const panel = el.closest('.settings-panel') || el;
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        panel.classList.remove('search-highlight');
        void panel.offsetWidth;   // restart the flash if it is already running
        panel.classList.add('search-highlight');
        // A pencil button: press it, which opens its form and puts the cursor in it
        if (setting.press) {
            if (el.getAttribute('aria-expanded') !== 'true') el.click();
            return;
        }
        // A disabled control (e.g. no saved cards yet) can't take focus, so focus its panel instead
        if (el.disabled) {
            panel.setAttribute('tabindex', '-1');
            panel.focus({ preventScroll: true });
        } else {
            el.focus({ preventScroll: true });
        }
    }

    function render() {
        const query = input.value.trim();
        list.innerHTML = '';
        if (!query) {
            list.hidden = true;
            empty.hidden = true;
            return;
        }

        const found = matches(query);
        empty.textContent = 'No settings match "' + query + '".';
        empty.hidden = found.length > 0;
        list.hidden = found.length === 0;

        found.forEach((s) => {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'settings-result';
            const title = document.createElement('strong');
            title.textContent = s.title;
            const where = document.createElement('small');
            where.textContent = s.href ? s.section + ' page ›' : s.section;
            btn.append(title, where);
            btn.addEventListener('click', () => open(s));
            li.append(btn);
            list.append(li);
        });
    }

    input.addEventListener('input', render);
    // Enter opens the first result
    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const first = list.querySelector('.settings-result');
        if (first) { e.preventDefault(); first.click(); }
    });
})();
