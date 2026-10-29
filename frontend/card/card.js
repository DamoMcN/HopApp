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

// Mouse click: straighten and stay flat until the mouse leaves the card,
// otherwise the very next mouse movement would tilt it again.
card.addEventListener('click', (e) => {
    if (e.pointerType === 'mouse') {
        mouseLocked = true;
        straighten();
    }
});