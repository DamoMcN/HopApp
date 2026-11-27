// Customise app (Settings): which buttons are in the bottom bar and in what order, and the page the app
// opens on. The choice is saved on the person's account through HopNav (shared/js/navbar.js), which also
// redraws the real bar. Nothing is saved until Save changes is pressed.

(function () {
    const nav = window.HopNav;
    const $ = (id) => document.getElementById(id);

    const PAGES = ['card', 'topup', 'map', 'tickets', 'support'];   // every page that can be in the bar
    const ICON = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    const SVG = {
        up: '<svg ' + ICON + '><path d="M6 15l6-6 6 6"/></svg>',
        down: '<svg ' + ICON + '><path d="M6 9l6 6 6-6"/></svg>',
        lock: '<svg ' + ICON + '><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
        grip: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>'
    };

    const clone = (config) => ({ tabs: config.tabs.slice(), startPage: config.startPage });
    const same = (a, b) => a.startPage === b.startPage && a.tabs.join(',') === b.tabs.join(',');
    const label = (id) => nav.TABS[id].label;
    const required = (id) => nav.REQUIRED.includes(id);

    let saved = clone(nav.current());   // what is on the account
    let draft = clone(saved);           // what is on screen
    let saving = false;

    function el(tag, className, html) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (html !== undefined) node.innerHTML = html;   // our own fixed SVG strings, never user data
        return node;
    }

    function setMessage(text, kind) {
        const box = $('customise-message');
        box.textContent = text || '';
        box.className = 'customise-message' + (kind ? ' is-' + kind : '');
    }

    function updateState() {
        $('save').disabled = saving || same(draft, saved);
    }

    function edited() {
        setMessage('');
        updateState();
    }

    // ---------- Tabs ----------

    function setTab(name) {
        $('panel-bar').hidden = name !== 'bar';
        $('panel-start').hidden = name !== 'start';
        ['bar', 'start'].forEach((tabName) => {
            const tab = $('tab-' + tabName);
            tab.setAttribute('aria-selected', String(tabName === name));
            tab.tabIndex = tabName === name ? 0 : -1;
        });
    }

    ['bar', 'start'].forEach((name) => {
        const tab = $('tab-' + name);
        tab.addEventListener('click', () => setTab(name));
        tab.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const other = name === 'bar' ? 'start' : 'bar';
            setTab(other);
            $('tab-' + other).focus();
        });
    });

    // ---------- The bar ----------

    // The page that shows as the current one in the preview: the one that opens first, if it is in the bar
    function previewActive() {
        return draft.tabs.includes(draft.startPage) ? draft.startPage : draft.tabs[0];
    }

    function renderPreview() {
        $('preview').replaceChildren(nav.previewBar(draft.tabs, previewActive()));
    }

    function nameCell(id) {
        const icon = el('span', 'nav-row-icon', nav.TABS[id].icon);
        const name = el('span', 'nav-row-name');
        name.textContent = label(id);
        return [icon, name];
    }

    function makeSwitch(id, on) {
        const button = el('button', 'nav-switch');
        button.type = 'button';
        button.dataset.kind = 'switch';
        button.setAttribute('role', 'switch');
        button.setAttribute('aria-checked', String(on));
        button.setAttribute('aria-label', 'Show ' + label(id) + ' in the bar');
        if (on && required(id)) button.disabled = true;   // Card and Top Up always stay
        button.addEventListener('click', () => {
            if (on) draft.tabs = draft.tabs.filter((t) => t !== id);
            else draft.tabs.push(id);
            renderAll({ id: id, kind: 'switch' });
            edited();
        });
        return button;
    }

    function makeMove(id, direction, disabled) {
        const button = el('button', 'nav-move', SVG[direction]);
        button.type = 'button';
        button.dataset.kind = direction;
        button.disabled = disabled;
        button.setAttribute('aria-label', 'Move ' + label(id) + ' ' + direction);
        button.addEventListener('click', () => {
            const at = draft.tabs.indexOf(id);
            const to = direction === 'up' ? at - 1 : at + 1;
            if (to < 0 || to >= draft.tabs.length) return;
            draft.tabs.splice(to, 0, draft.tabs.splice(at, 1)[0]);
            renderAll({ id: id, kind: direction });
            edited();
        });
        return button;
    }

    function inRow(id, index) {
        const row = el('li', 'nav-row');
        row.dataset.tab = id;

        const grip = el('span', 'nav-grip', SVG.grip);   // drag to reorder; the arrows do the same with a keyboard
        grip.dataset.kind = 'grip';
        grip.addEventListener('pointerdown', (event) => beginDrag(event, row, index));
        row.appendChild(grip);
        nameCell(id).forEach((cell) => row.appendChild(cell));

        if (required(id)) {
            const lock = el('span', 'nav-lock', SVG.lock);
            lock.title = 'Always in the bar';
            lock.setAttribute('role', 'img');
            lock.setAttribute('aria-label', 'Always in the bar');
            row.appendChild(lock);
        }
        row.append(makeMove(id, 'up', index === 0), makeMove(id, 'down', index === draft.tabs.length - 1), makeSwitch(id, true));
        return row;
    }

    function outRow(id) {
        const row = el('li', 'nav-row');
        row.dataset.tab = id;
        nameCell(id).forEach((cell) => row.appendChild(cell));
        row.appendChild(makeSwitch(id, false));
        return row;
    }

    // Draws everything. focus: the control that was just used, so a keyboard user keeps their place.
    function renderAll(focus) {
        $('in-title').textContent = 'In your bar · ' + draft.tabs.length + ' of ' + PAGES.length;
        $('in-list').replaceChildren(...draft.tabs.map(inRow));
        const out = PAGES.filter((id) => !draft.tabs.includes(id));
        $('out-list').replaceChildren(...out.map(outRow));
        $('out-group').hidden = out.length === 0;
        renderPreview();
        renderStart();

        if (focus) {
            const row = document.querySelector('.nav-row[data-tab="' + focus.id + '"]');
            let target = row && row.querySelector('[data-kind="' + focus.kind + '"]:not(:disabled)');
            if (!target && row) target = row.querySelector('.nav-move:not(:disabled), .nav-switch:not(:disabled)');
            if (target) target.focus();
        }
    }

    // ---------- Drag to reorder ----------
    // The row follows the pointer and the others slide out of the way; the order changes when it is let go.

    function beginDrag(event, row, from) {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        const rows = Array.from($('in-list').children);
        const step = rows.length > 1 ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top : row.offsetHeight;
        const startY = event.clientY;
        let to = from;

        row.classList.add('is-dragging');

        const move = (e) => {
            const dy = e.clientY - startY;
            to = Math.max(0, Math.min(rows.length - 1, Math.round(from + dy / step)));
            rows.forEach((other, i) => {
                if (other === row) { other.style.transform = 'translateY(' + dy + 'px)'; return; }
                let shift = 0;
                if (from < to && i > from && i <= to) shift = -step;
                if (from > to && i < from && i >= to) shift = step;
                other.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
            });
        };

        const end = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', end);
            document.removeEventListener('pointercancel', end);
            if (to !== from) {
                draft.tabs.splice(to, 0, draft.tabs.splice(from, 1)[0]);
                edited();
            }
            renderAll();
        };

        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', end);
        document.addEventListener('pointercancel', end);
    }

    // ---------- Start page ----------

    function renderStart() {
        const list = $('start-list');
        list.replaceChildren(...PAGES.map((id) => {
            const on = draft.startPage === id;
            const option = el('button', 'start-option');
            option.type = 'button';
            option.dataset.page = id;
            option.setAttribute('role', 'radio');
            option.setAttribute('aria-checked', String(on));
            option.tabIndex = on ? 0 : -1;

            const icon = el('span', 'nav-row-icon', nav.TABS[id].icon);
            const text = el('span', 'start-text');
            const name = el('strong');
            name.textContent = label(id);
            text.appendChild(name);
            const note = id === 'card' ? 'Default' : (draft.tabs.includes(id) ? '' : 'Not in your bar');
            if (note) {
                const small = el('small');
                small.textContent = note;
                text.appendChild(small);
            }
            option.append(icon, text, el('span', 'start-ring'));

            option.addEventListener('click', () => chooseStart(id));
            return option;
        }));
    }

    function chooseStart(id, keepFocus) {
        draft.startPage = id;
        renderStart();
        renderPreview();
        edited();
        const picked = document.querySelector('.start-option[data-page="' + id + '"]');
        if (picked && keepFocus !== false) picked.focus();
    }

    $('start-list').addEventListener('keydown', (event) => {
        const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
        if (!(event.key in keys)) return;
        event.preventDefault();
        const at = PAGES.indexOf(draft.startPage);
        chooseStart(PAGES[(at + keys[event.key] + PAGES.length) % PAGES.length]);
    });

    // ---------- Save and reset ----------

    $('save').addEventListener('click', async () => {
        saving = true;
        updateState();
        $('save').textContent = 'Saving…';
        const result = await nav.save(draft);
        saving = false;
        $('save').textContent = 'Save changes';
        if (result.ok) {
            saved = clone(result.config);
            draft = clone(saved);
            renderAll();
            setMessage('Saved. Your bar and start page are updated.', 'ok');
        } else if (result.error) {
            setMessage(result.error, 'error');
        }
        updateState();
    });

    $('reset').addEventListener('click', () => {
        draft = clone(nav.DEFAULT_CONFIG);
        renderAll();
        updateState();
        setMessage(same(draft, saved) ? 'This is already the default.' : 'Back to the default. Press Save changes to keep it.');
    });

    renderAll();
    updateState();

    // The saved copy from the server, in case this device's copy was old
    nav.load().then((config) => {
        if (config && same(draft, saved)) {
            saved = clone(config);
            draft = clone(config);
            renderAll();
            updateState();
        }
    });
})();
