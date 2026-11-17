// Tickets page. Shows the journey picked on the map (Buy a ticket tab).
// Buying is not built yet: this only displays the saved journey.

const DRAFT_KEY = 'hop.ticketDraft';

function text(value, maxLength) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null;
}

// Anything in storage could have been changed, so check it before showing it
function readDraft() {
    let raw = null;
    try { raw = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
    if (!raw || typeof raw !== 'object') return null;

    const draft = {
        routeId: text(raw.routeId, 64),
        shortName: text(raw.shortName, 20),
        longName: text(raw.longName, 200),
        agency: typeof raw.agency === 'string' && raw.agency.length <= 120 ? raw.agency : '',
        fromId: text(raw.fromId, 64),
        fromName: text(raw.fromName, 160),
        toId: text(raw.toId, 64),
        toName: text(raw.toName, 160),
        stopsBetween: raw.stopsBetween
    };

    const ok = draft.routeId && draft.shortName && draft.fromId && draft.fromName &&
        draft.toId && draft.toName &&
        Number.isInteger(draft.stopsBetween) && draft.stopsBetween >= 1 && draft.stopsBetween <= 500;
    return ok ? draft : null;
}

function show(draft) {
    document.getElementById('journey').hidden = !draft;
    document.getElementById('tickets-empty').hidden = Boolean(draft);
    if (!draft) return;

    const badge = document.getElementById('j-badge');
    badge.textContent = draft.shortName;
    badge.classList.toggle('is-citylink', draft.agency.toLowerCase().includes('citylink'));

    document.getElementById('j-name').textContent = draft.longName || 'Bus route';
    document.getElementById('j-agency').textContent = draft.agency || 'Unknown operator';
    document.getElementById('j-from').textContent = draft.fromName;
    document.getElementById('j-to').textContent = draft.toName;
    document.getElementById('j-between').textContent =
        draft.stopsBetween + (draft.stopsBetween === 1 ? ' stop' : ' stops') + ' on this journey.';
}

document.getElementById('clear-journey').addEventListener('click', () => {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing to clear */ }
    show(null);
});

show(readDraft());

// =========================================
//  HOP Up Priority Payment: pay with the Hop Card balance
// =========================================

const TICKET_API = '../../backend/auth/ticket.php';
const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const $ = (id) => document.getElementById(id);
const payDialog = $('pay-dialog');
let fare = null;          // { price, balance, card_type } from the server
let pendingKey = null;    // kept for a retry, so one ticket can't be paid for twice

function newKey() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function journeyLabel(d) {
    return (d.shortName + ' ' + d.fromName + ' → ' + d.toName).slice(0, 100);
}

// Price comes from the server, worked out from the person's card type
async function loadFare() {
    try {
        const response = await fetch(TICKET_API, { cache: 'no-store' });
        const data = await response.json();
        if (data.logged_in === false) {
            $('buy-btn').textContent = 'Log in to buy';
            $('buy-btn').disabled = false;
            $('buy-btn').onclick = () => { window.location.href = '../auth/index.html'; };
            return;
        }
        if (typeof data.price !== 'number') throw new Error(data.error || 'No price');
        fare = data;
        $('ticket-price').textContent = 'Ticket price: ' + money.format(fare.price) + ' (' + fare.card_type + ' fare)';
        $('ticket-price').hidden = false;
        $('buy-btn').disabled = false;
    } catch (error) {
        console.error('Could not load the ticket price:', error);
        $('ticket-price').textContent = "Couldn't load the ticket price. Please refresh the page.";
        $('ticket-price').hidden = false;
    }
}

function showResult(ok, title, text, offerTopUp) {
    $('pay-review').hidden = true;
    $('pay-result').hidden = false;
    $('pay-title').textContent = ok ? 'Payment successful' : 'Payment declined';
    $('pay-mark').className = 'pay-mark ' + (ok ? 'ok' : 'err');
    $('pay-mark').textContent = ok ? '✓' : '!';
    $('pay-result-title').textContent = title;
    $('pay-result-text').textContent = text;
    $('pay-topup').hidden = !offerTopUp;
}

function openPayment() {
    const draft = readDraft();
    if (!draft || !fare) return;
    $('pay-title').textContent = 'Confirm payment';
    $('pay-journey').textContent = journeyLabel(draft);
    $('pay-price').textContent = money.format(fare.price);
    $('pay-balance').textContent = money.format(fare.balance);
    $('pay-after').textContent = money.format(fare.balance - fare.price);
    $('pay-review').hidden = false;
    $('pay-result').hidden = true;
    $('pay-confirm').disabled = false;
    payDialog.showModal();
}

async function confirmPayment() {
    const draft = readDraft();
    if (!draft) return;
    $('pay-confirm').disabled = true;
    if (!pendingKey) pendingKey = newKey();

    try {
        const response = await fetch(TICKET_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'buy', route: journeyLabel(draft), idempotency_key: pendingKey })
        });
        const data = await response.json();
        if (data.logged_in === false) { window.location.href = '../auth/index.html'; return; }
        if (typeof data.balance === 'number') fare.balance = data.balance;

        if (data.success) {
            pendingKey = null;
            showResult(true, money.format(data.price) + ' paid from your Hop Card.',
                'Your new balance is ' + money.format(data.balance) + '. Have a good trip!', false);
        } else if (data.declined) {
            pendingKey = null;   // nothing was charged, a new attempt gets a new key
            showResult(false, data.error,
                data.declined === 'insufficient_balance'
                    ? 'The ticket costs ' + money.format(data.price) + ' and your balance is ' + money.format(data.balance) + '. Top up your card and try again.'
                    : 'Unfreeze your card from the card page, then try again.',
                data.declined === 'insufficient_balance');
        } else {
            throw new Error(data.error || 'Payment failed');
        }
    } catch (error) {
        // pendingKey is kept, so trying again can't charge twice
        showResult(false, 'Payment failed, you have not been charged.', 'Please check your connection and try again.', false);
    }
}

$('buy-btn').addEventListener('click', () => { if (fare) openPayment(); });
$('pay-confirm').addEventListener('click', confirmPayment);
$('pay-cancel').addEventListener('click', () => payDialog.close());
$('pay-close').addEventListener('click', () => payDialog.close());

if (readDraft()) loadFare();
