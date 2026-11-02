const card  = document.getElementById('active-hop-card');
const glare = document.getElementById('glare');

const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

// =========================================
//  Load the page data
// =========================================

document.addEventListener('DOMContentLoaded', async () => {
    const loggedIn = await loadCard();
    if (loggedIn) await loadTransactions();
});

// Returns true if the user is logged in
async function loadCard() {
    try {
        const response = await fetch('../../backend/auth/session.php', { cache: 'no-store' });
        const data = await response.json();

        if (!data.logged_in) {
            window.location.href = '../auth/index.html';
            return false;
        }

        document.getElementById('user-name').textContent = data.f_name;

        // DB values are 'Adult', 'Young Adult', 'Student', 'Child'
        document.getElementById('card-type-display').textContent = data.card_type || 'Adult';

        renderCardStatus(data.card_status || 'active');
        

        // 12345678 -> "1234 5678" (older 16-digit numbers also still format fine)
        if (data.card_number) {
            document.getElementById('card-number-display').textContent =
                data.card_number.replace(/(\d{4})(?=\d)/g, '$1 ');
        }

        // Balance straight from users.wallet_balance. Shows a dash if the
        // server didn't send one, rather than a misleading €0.00.
        document.getElementById('card-balance-display').textContent =
            data.wallet_balance === undefined || data.wallet_balance === null
                ? '\u2014'
                : money.format(Number(data.wallet_balance));

        return true;
    } catch (error) {
        console.error('Failed to load session data:', error);
        return false;
    }
}

// =========================================
//  Transactions
// =========================================

function transactionTitle(tx) {
    if (tx.type === 'ticket purchase') return tx.route ? 'Ticket: ' + tx.route : 'Ticket purchase';
    if (tx.type === 'auto top up') return 'Auto top up';
    return 'Top up';
}

function formatDate(value) {
    // MySQL gives "2026-10-29 13:48:00"; treat it as local time
    const d = new Date(String(value).replace(' ', 'T'));
    if (isNaN(d)) return '';
    return d.toLocaleString('en-IE', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function renderTransaction(tx) {
    const isIn = tx.direction === 'in';

    const li = document.createElement('li');
    li.className = 'transaction';

    const icon = document.createElement('div');
    icon.className = 'tx-icon ' + (isIn ? 'in' : 'out');
    icon.textContent = isIn ? '\u2193' : '\u2191';   // ↓ money in, ↑ money out
    icon.setAttribute('aria-hidden', 'true');

    const details = document.createElement('div');
    details.className = 'tx-details';

    const title = document.createElement('div');
    title.className = 'tx-title';
    title.textContent = transactionTitle(tx);

    const date = document.createElement('div');
    date.className = 'tx-date';
    date.textContent = formatDate(tx.created_at);

    details.append(title, date);

    const amount = document.createElement('div');
    amount.className = 'tx-amount ' + (isIn ? 'in' : 'out');
    amount.textContent = (isIn ? '+' : '\u2212') + money.format(tx.amount);

    li.append(icon, details, amount);
    return li;
}

async function loadTransactions() {
    const status = document.getElementById('transaction-status');
    const list = document.getElementById('transaction-list');

    try {
        const response = await fetch('../../backend/auth/transactions.php', { cache: 'no-store' });
        const data = await response.json();

        if (!data.logged_in) {
            window.location.href = '../auth/index.html';
            return;
        }
        if (data.error) throw new Error(data.error);

        list.innerHTML = '';

        if (data.transactions.length === 0) {
            status.textContent = 'No transactions yet.';
            status.hidden = false;
            return;
        }

        status.hidden = true;
        data.transactions.forEach(tx => list.appendChild(renderTransaction(tx)));
    } catch (error) {
        console.error('Failed to load transactions:', error);
        status.textContent = "Couldn't load transactions.";
        status.hidden = false;
    }
}

// =========================================
//  3D tilt
// =========================================

const MAX_ROTATE = 15;   // degrees
const TAP_SLOP   = 12;   // px of movement still counted as a tap

function tiltTo(clientX, clientY) {
    const rect = card.getBoundingClientRect();
    const percentX = (clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const percentY = (clientY - (rect.top + rect.height / 2)) / (rect.height / 2);

    // clamp so dragging outside the card doesn't over-rotate
    const px = Math.max(-1, Math.min(1, percentX));
    const py = Math.max(-1, Math.min(1, percentY));

    card.classList.remove('resetting');
    card.style.transform = `rotateX(${py * -MAX_ROTATE}deg) rotateY(${px * MAX_ROTATE}deg)`;

    glare.style.opacity = '1';
    glare.style.background =
        `radial-gradient(circle at ${((px + 1) / 2) * 100}% ${((py + 1) / 2) * 100}%, rgba(255,255,255,0.4), transparent 50%)`;
}

function straighten() {
    card.classList.add('resetting');
    card.style.transform = 'rotateX(0deg) rotateY(0deg)';
    glare.style.opacity = '0';
}

let startX = 0, startY = 0, dragged = false;
let mouseLocked = false;   // after a click, ignore hover until the mouse leaves and re-enters

card.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;       // mouse uses hover instead
    card.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    dragged = false;
});

card.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
        if (!mouseLocked) tiltTo(e.clientX, e.clientY);   // desktop: tilt on hover
        return;
    }
    if (!card.hasPointerCapture(e.pointerId)) return;

    // touch/pen: only tilt once the finger has actually moved
    if (!dragged && Math.hypot(e.clientX - startX, e.clientY - startY) > TAP_SLOP) {
        dragged = true;
    }
    if (dragged) tiltTo(e.clientX, e.clientY);
});

card.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    // A tap (no drag) straightens the card. A drag leaves it tilted.
    // To straighten on release instead, change this to: straighten();
    if (!dragged) straighten();
});

card.addEventListener('pointercancel', straighten);

card.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') {
        mouseLocked = false;
        straighten();                            // desktop: flatten when mouse leaves
    }
});

// =========================================
//  Card actions drop-down (press the card)
// =========================================

const cardMenu    = document.getElementById('card-menu');
const cardMessage = document.getElementById('card-message');

// users.card_status: 'active', 'frozen', 'reported_lost' or 'reported_stolen'
let cardStatus = 'active';

const REPORTED = {
    reported_lost:   { word: 'lost',   badge: 'Reported lost' },
    reported_stolen: { word: 'stolen', badge: 'Reported stolen' }
};

function setCardMessage(text, kind) {
    cardMessage.textContent = text;
    cardMessage.className = 'card-message' + (kind ? ' ' + kind : '');
}

// Called with the status from session.php on load, and after every action
function renderCardStatus(status) {
    cardStatus = status;
    const reported = REPORTED[status];
    const frozen   = status === 'frozen';

    card.classList.toggle('is-frozen', frozen || Boolean(reported));
    document.getElementById('frozen-badge').textContent = reported ? reported.badge : 'Frozen';
    card.setAttribute('aria-label',
        'Your Hop Card.' + (reported ? ' ' + reported.badge + '.' : frozen ? ' Frozen.' : '') +
        ' Press for card actions.');

    buildCardMenu();
}

function menuItem(label, onClick, danger) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-menu-item' + (danger ? ' danger' : '');
    btn.setAttribute('role', 'menuitem');
    btn.textContent = label;
    btn.addEventListener('click', () => {
        closeCardMenu(false);
        onClick();
    });
    return btn;
}

// To add another action later, add a menuItem(...) to the list below.
function buildCardMenu() {
    cardMenu.innerHTML = '';

    const reported = REPORTED[cardStatus];
    if (reported) {
        // A reported card can't be changed by the user any more
        cardMenu.setAttribute('role', 'group');
        const note = document.createElement('p');
        note.className = 'card-menu-note';
        note.textContent = 'This card was reported ' + reported.word +
            '. Contact Help & Support for a replacement.';
        cardMenu.appendChild(note);
        return;
    }

    cardMenu.setAttribute('role', 'menu');
    const frozen = cardStatus === 'frozen';
    cardMenu.append(
        menuItem(frozen ? 'Unfreeze card' : 'Freeze card',
                 () => freezeOrUnfreeze(frozen ? 'unfreeze' : 'freeze')),
        menuItem('Report lost',   () => openReport('lost'),   true),
        menuItem('Report stolen', () => openReport('stolen'), true)
    );
}

function openCardMenu(focusFirst) {
    cardMenu.classList.add('is-open');
    card.setAttribute('aria-expanded', 'true');
    if (focusFirst) {
        const first = cardMenu.querySelector('button');
        if (first) first.focus();
    }
}

function closeCardMenu(refocusCard) {
    cardMenu.classList.remove('is-open');
    card.setAttribute('aria-expanded', 'false');
    if (refocusCard) card.focus();
}

function toggleCardMenu(focusFirst) {
    if (cardMenu.classList.contains('is-open')) closeCardMenu(false);
    else openCardMenu(focusFirst);
}

// Mouse: a click. Touch: a tap. A touch drag (tilting the card) doesn't count.
card.addEventListener('click', (e) => {
    if (e.pointerType !== 'mouse' && dragged) return;
    toggleCardMenu(false);
});

// Keyboard on the card: Enter or Space toggles, Down arrow opens, Esc closes
card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCardMenu(true);
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        openCardMenu(true);
    } else if (e.key === 'Escape') {
        closeCardMenu(false);
    } else if (e.key === 'Tab') {
        // Tab goes into the drop-down if it has buttons; otherwise (or Shift+Tab) it leaves, so close it
        if (e.shiftKey || !cardMenu.querySelector('button')) closeCardMenu(false);
    }
});

// Keyboard inside the drop-down: arrows move, Esc closes and returns to the card
cardMenu.addEventListener('keydown', (e) => {
    const items = Array.from(cardMenu.querySelectorAll('button'));
    const i = items.indexOf(document.activeElement);

    if (e.key === 'Escape') {
        e.preventDefault();
        closeCardMenu(true);
    } else if (e.key === 'ArrowDown' && items.length) {
        e.preventDefault();
        items[(i + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp' && items.length) {
        e.preventDefault();
        items[(i - 1 + items.length) % items.length].focus();
    } else if (e.key === 'Home' && items.length) {
        e.preventDefault();
        items[0].focus();
    } else if (e.key === 'End' && items.length) {
        e.preventDefault();
        items[items.length - 1].focus();
    } else if (e.key === 'Tab') {
        // Tabbing off either end of the list leaves the drop-down, so close it
        const last = items.length - 1;
        if ((!e.shiftKey && i === last) || (e.shiftKey && i === 0)) closeCardMenu(false);
    }
});

// Pressing anywhere else closes it, and so does tabbing out of it
document.addEventListener('click', (e) => {
    if (!cardMenu.classList.contains('is-open')) return;
    if (card.contains(e.target) || cardMenu.contains(e.target)) return;
    closeCardMenu(false);
});

cardMenu.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !cardMenu.contains(e.relatedTarget) && e.relatedTarget !== card) {
        closeCardMenu(false);
    }
});

// =========================================
//  Card actions: freeze, unfreeze, report
// =========================================

// Sends one action to the server. Resolves with the response, or throws with a readable message.
async function sendCardAction(action) {
    const response = await fetch('../../backend/auth/card_status.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
    });
    const data = await response.json();

    if (data.logged_in === false) {
        window.location.href = '../auth/index.html';
        throw new Error('Not logged in');
    }
    if (data.card_status) renderCardStatus(data.card_status);
    if (!response.ok || data.success === false) {
        throw new Error(data.error || 'Something went wrong');
    }
    return data;
}

async function freezeOrUnfreeze(action) {
    setCardMessage('', '');
    try {
        await sendCardAction(action);
        setCardMessage(action === 'freeze' ? 'Card frozen.' : 'Card unfrozen.', 'ok');
    } catch (error) {
        setCardMessage(error.message, 'err');
    }
}

// ---- Report lost / stolen (permanent, so it asks first) ----

const reportDialog  = document.getElementById('report-dialog');
const reportConfirm = document.getElementById('report-confirm');
const reportCancel  = document.getElementById('report-cancel');
const reportError   = document.getElementById('report-error');

const REPORT_TEXT = {
    lost:   "This permanently blocks this card, so it can't be used or topped up. " +
            "You'll need a replacement card. If you might still find it, freeze it instead.",
    stolen: "This permanently blocks this card, so it can't be used or topped up. " +
            "You'll need a replacement card. You may also want to report the theft to the police."
};

let reportKind = null;     // 'lost' or 'stolen'
let reportBusy = false;

function openReport(kind) {
    reportKind = kind;
    document.getElementById('report-title').textContent = 'Report card as ' + kind + '?';
    document.getElementById('report-text').textContent = REPORT_TEXT[kind];
    reportConfirm.textContent = 'Report ' + kind;
    reportError.hidden = true;
    reportConfirm.disabled = false;
    reportCancel.disabled = false;
    reportDialog.showModal();
}

reportConfirm.addEventListener('click', async () => {
    if (reportBusy) return;
    reportBusy = true;
    reportConfirm.disabled = true;
    reportCancel.disabled = true;
    reportError.hidden = true;

    try {
        await sendCardAction('report_' + reportKind);
        reportDialog.close();
        setCardMessage('Card reported ' + reportKind + '. Contact Help & Support for a replacement.', 'ok');
    } catch (error) {
        reportError.textContent = error.message;
        reportError.hidden = false;
        reportConfirm.disabled = false;
        reportCancel.disabled = false;
    } finally {
        reportBusy = false;
    }
});

reportCancel.addEventListener('click', () => reportDialog.close());

// Esc must not close the dialog while the request is in flight
reportDialog.addEventListener('cancel', (e) => {
    if (reportBusy) e.preventDefault();
});

// Coming back with the browser's Back button can show a saved copy of this page,
// so refresh the balance and transactions
window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
        loadCard();
        loadTransactions();
    }
});
