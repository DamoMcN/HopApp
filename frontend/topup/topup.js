const API = '../../backend/auth/topup.php';

const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

// Dial range in euros. The server enforces its own limits (EUR 1 to EUR 500),
// so these only control what the dial offers.
const MIN_EUR  = 5;
const MAX_EUR  = 100;
const STEP_EUR = 5;

const state = {
    amountCents: 1000,   // the dial's starting value, EUR 10
    balance: 0,          // current wallet balance in euros, used for "Balance will be"
    cardId: null,
    cards: [],
    mode: 'mock',
    busy: false,
    // One key per top up attempt. If a request fails or the connection drops we
    // keep the same key for the retry, so the server can't credit the money twice.
    pendingKey: null
};

const $ = (id) => document.getElementById(id);

function newKey() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);   // works on plain http too, unlike crypto.randomUUID()
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function setMessage(text, kind) {
    const el = $('message');
    el.textContent = text;
    el.className = 'message' + (kind ? ' ' + kind : '');
}

function setBalance(value) {
    state.balance = Number(value);
    $('balance-display').textContent = money.format(state.balance);
    drawDial();   // keeps "Balance will be ..." in step
}

// =========================================
//  Circular amount slider
// =========================================

const dial = $('dial');
const DIAL_R = 85;                       // ring radius, matches the SVG in topup.html
const DIAL_C = 2 * Math.PI * DIAL_R;     // ring length, used to draw the filled part

let dialFrac = 0;      // handle position, 0 (12 o'clock, minimum) to 1 (a full turn, maximum)
let dragging = false;

function eurosToFrac(euros) {
    return (euros - MIN_EUR) / (MAX_EUR - MIN_EUR);
}

function fracToEuros(frac) {
    const steps = Math.round(frac * (MAX_EUR - MIN_EUR) / STEP_EUR);
    return MIN_EUR + steps * STEP_EUR;
}

function drawDial() {
    const euros = state.amountCents / 100;
    const angle = dialFrac * 2 * Math.PI;

    const handle = $('dial-handle');
    handle.setAttribute('cx', (100 + DIAL_R * Math.sin(angle)).toFixed(2));
    handle.setAttribute('cy', (100 - DIAL_R * Math.cos(angle)).toFixed(2));

    $('dial-arc').setAttribute('stroke-dasharray', (dialFrac * DIAL_C).toFixed(2) + ' ' + DIAL_C.toFixed(2));

    $('dial-amount').textContent = money.format(euros);
    $('dial-after').textContent = 'Balance will be ' + money.format(state.balance + euros);

    dial.setAttribute('aria-valuenow', String(euros));
    dial.setAttribute('aria-valuetext', money.format(euros));
}

// The one place the amount changes. Everything else (dial, number, button) follows from it.
function setAmount(euros) {
    euros = Math.max(MIN_EUR, Math.min(MAX_EUR, euros));
    const cents = euros * 100;

    if (cents !== state.amountCents) {
        state.amountCents = cents;
        state.pendingKey = null;   // a different top up, so a new key
    }
    dialFrac = eurosToFrac(euros);

    drawDial();
    updatePayButton();
}

// Where on the ring the pointer is, as 0 to 1 clockwise from 12 o'clock.
function pointerToFrac(e, stopAtEnds) {
    const rect = dial.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);

    let frac = Math.atan2(dx, -dy) / (2 * Math.PI);
    if (frac < 0) frac += 1;

    // While dragging, don't let the handle loop round the top from the maximum
    // back to the minimum (or the other way): it sticks at the end instead.
    if (stopAtEnds) {
        if (dialFrac < 0.25 && frac > 0.75) frac = 0;
        else if (dialFrac > 0.75 && frac < 0.25) frac = 1;
    }
    return frac;
}

dial.addEventListener('pointerdown', (e) => {
    if (state.busy) return;
    dragging = true;
    dial.setPointerCapture(e.pointerId);
    setAmount(fracToEuros(pointerToFrac(e, false)));   // a tap jumps straight to that spot
});

dial.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    setAmount(fracToEuros(pointerToFrac(e, true)));
});

dial.addEventListener('pointerup', () => { dragging = false; });
dial.addEventListener('pointercancel', () => { dragging = false; });

// Keyboard: arrows nudge by one step, Page Up/Down by four, Home/End jump to the ends
dial.addEventListener('keydown', (e) => {
    if (state.busy) return;
    const current = state.amountCents / 100;
    let next = null;

    if (e.key === 'ArrowRight' || e.key === 'ArrowUp')        next = current + STEP_EUR;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')  next = current - STEP_EUR;
    else if (e.key === 'PageUp')                              next = current + STEP_EUR * 4;
    else if (e.key === 'PageDown')                            next = current - STEP_EUR * 4;
    else if (e.key === 'Home')                                next = MIN_EUR;
    else if (e.key === 'End')                                 next = MAX_EUR;

    if (next === null) return;
    e.preventDefault();
    setAmount(next);
});

// =========================================
//  Saved cards
// =========================================

function renderCards() {
    const list = $('card-list');
    list.innerHTML = '';

    if (state.cards.length === 0) {
        const p = document.createElement('p');
        p.className = 'card-empty';
        p.textContent = 'No saved cards yet.';
        list.appendChild(p);
    }

    state.cards.forEach((c) => {
        const label = document.createElement('label');
        label.className = 'saved-card';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'saved-card';
        radio.value = String(c.id);
        radio.checked = c.id === state.cardId;
        radio.addEventListener('change', () => {
            state.cardId = c.id;
            state.pendingKey = null;
            updatePayButton();
        });

        const text = document.createElement('span');
        text.textContent = c.brand + ' •••• ' + c.last4;

        label.append(radio, text);
        list.appendChild(label);
    });

    updatePayButton();
}

function updatePayButton() {
    const btn = $('pay-btn');
    btn.disabled = state.busy || state.cardId === null;
    btn.textContent = 'Top up ' + money.format(state.amountCents / 100);
    $('wallet-btn').disabled = state.busy;
    dial.setAttribute('aria-disabled', String(state.busy));
}

// =========================================
//  Server calls
// =========================================

async function post(payload) {
    const response = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.logged_in === false) {
        window.location.href = '../auth/index.html';
        throw new Error('Not logged in');
    }
    if (!response.ok || data.success === false) {
        throw new Error(data.error || 'Something went wrong');
    }
    return data;
}

async function load() {
    try {
        const response = await fetch(API, { cache: 'no-store' });
        const data = await response.json();

        if (data.logged_in === false) {
            window.location.href = '../auth/index.html';
            return;
        }
        if (data.error) throw new Error(data.error);

        state.mode = data.mode;
        state.cards = data.cards;
        if (state.cardId === null && data.cards.length) state.cardId = data.cards[0].id;

        setBalance(data.balance);

        const note = $('mode-note');
        if (data.mode === 'mock') {
            note.textContent = 'Demo mode: no real payments are taken.';
            note.hidden = false;
            $('wallet-btn').hidden = false;
        }

        renderCards();
    } catch (error) {
        console.error('Failed to load top up page:', error);
        setMessage("Couldn't load your cards. Please refresh the page.", 'err');
    }
}

async function addCard() {
    if (state.busy) return;
    try {
        const data = await post({ action: 'add_card' });
        state.cards = data.cards;
        if (state.cardId === null && data.cards.length) state.cardId = data.cards[0].id;
        setMessage('', '');
        renderCards();
    } catch (error) {
        setMessage(error.message, 'err');
    }
}

// Returns true if the money was added, false if not
async function topUp(source) {
    if (state.busy) return false;
    if (source === 'saved_card' && state.cardId === null) {
        setMessage('Add or choose a card first.', 'err');
        return false;
    }

    state.busy = true;
    updatePayButton();
    setMessage('Processing…', '');

    if (!state.pendingKey) state.pendingKey = newKey();

    const payload = {
        action: 'top_up',
        amount_cents: state.amountCents,
        source: source,
        idempotency_key: state.pendingKey
    };
    if (source === 'saved_card') payload.card_id = state.cardId;

    try {
        const data = await post(payload);
        state.pendingKey = null;   // finished, next top up gets a fresh key
        setBalance(data.balance);
        setMessage(
            data.replayed
                ? 'That top up was already applied.'
                : 'Added ' + money.format(state.amountCents / 100) + ' to your card.',
            'ok'
        );
        if (source === 'saved_card') setTimeout(() => { window.location.href = '../card/card.html'; }, 1000);
        return true;
    } catch (error) {
        // pendingKey is kept on purpose, so pressing the button again is a safe retry
        setMessage(error.message, 'err');
        return false;
    } finally {
        state.busy = false;
        updatePayButton();
    }
}

// =========================================
//  Events
// =========================================

$('pay-btn').addEventListener('click', () => topUp('saved_card'));
$('add-card-btn').addEventListener('click', addCard);

// =========================================
//  Demo wallet sheet
// =========================================

const walletDialog = $('wallet-dialog');
const WALLET_VIEWS = ['review', 'processing', 'success', 'error'];
const MIN_PROCESSING_MS = 900;   // so the spinner is seen even when the server answers instantly

function showWalletView(name) {
    WALLET_VIEWS.forEach((v) => { $('wallet-' + v).hidden = v !== name; });
    $('wallet-title').textContent =
        name === 'success' ? 'Payment complete' :
        name === 'error'   ? 'Payment failed'   : 'Confirm payment';
}

function openWallet() {
    const euros = state.amountCents / 100;
    $('wallet-amount').textContent = money.format(euros);
    $('wallet-after').textContent = money.format(state.balance + euros);
    showWalletView('review');
    walletDialog.showModal();
}

async function confirmWallet() {
    showWalletView('processing');
    const started = Date.now();

    const ok = await topUp('wallet_demo');

    const wait = MIN_PROCESSING_MS - (Date.now() - started);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

    if (ok) {
        $('wallet-success-text').textContent = 'Added ' + money.format(state.amountCents / 100) + ' to your card';
        showWalletView('success');
        setTimeout(() => { window.location.href = '../card/card.html'; }, 1400);
    } else {
        // topUp already put the reason in the message under the buttons
        $('wallet-error-text').textContent = $('message').textContent || 'Something went wrong';
        showWalletView('error');
    }
}

$('wallet-btn').addEventListener('click', openWallet);
$('wallet-confirm').addEventListener('click', confirmWallet);
$('wallet-cancel').addEventListener('click', () => walletDialog.close());
$('wallet-close').addEventListener('click', () => walletDialog.close());

// Try again goes back to the review step. The idempotency key is kept, so a retry can't double charge.
$('wallet-retry').addEventListener('click', () => {
    setMessage('', '');
    openWallet();
});

// Esc must not close the sheet while a payment is in flight
walletDialog.addEventListener('cancel', (e) => {
    if (!$('wallet-processing').hidden) e.preventDefault();
});

setAmount(state.amountCents / 100);   // draws the dial and sets the button label
load();