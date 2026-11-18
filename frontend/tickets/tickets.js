// Tickets page. Shows the journey picked on the map (Buy a ticket tab), lets the user choose
// the date and time, pay with the Hop Card balance, and see their tickets with a QR code.

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

let tickets = [];   // the user's tickets from the server

function updateEmpty() {
    const hasDraft = Boolean(readDraft());
    document.getElementById('tickets-empty').hidden = hasDraft || tickets.length > 0;
    // With tickets and no journey being bought: just a button to plan the next one
    document.getElementById('plan-btn').hidden = hasDraft || tickets.length === 0;
}

function show(draft) {
    document.getElementById('journey').hidden = !draft;
    updateEmpty();
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
        setTickets(data.tickets);
        setupWhen(data.times);
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
    if (!draft || !fare || !checkWhen()) return;
    $('pay-title').textContent = 'Confirm payment';
    $('pay-journey').textContent = journeyLabel(draft);
    $('pay-when').textContent = formatWhen(chosenWhen());
    $('pay-qr').hidden = true;
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
            body: JSON.stringify({
                action: 'buy', route: journeyLabel(draft),
                travel_date: $('travel-date').value, travel_time: $('travel-time').value,
                idempotency_key: pendingKey
            })
        });
        const data = await response.json();
        if (data.logged_in === false) { window.location.href = '../auth/index.html'; return; }
        if (typeof data.balance === 'number') fare.balance = data.balance;

        if (data.success) {
            pendingKey = null;
            // Bought: the journey form goes away and the page shows just the tickets
            try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing to clear */ }
            show(null);
            if (Array.isArray(data.tickets)) setTickets(data.tickets);
            else loadFare();
            showResult(true, money.format(data.price) + ' paid from your Hop Card.',
                'Your new balance is ' + money.format(data.balance) + '. Show this QR code when you board. ' +
                'It is also saved in My tickets.', false);
            const bought = tickets.find((t) => t.id === data.ticket_id);
            if (bought && bought.qr_token) {
                drawQr($('pay-qr'), bought.qr_token, 'QR code for your new ticket');
                $('pay-qr').hidden = false;
            }
        } else if (data.declined === 'time_unavailable') {
            pendingKey = null;   // nothing was charged
            showResult(false, data.error, 'You have not been charged. Choose another date or time and try again.', false);
            loadFare();          // refresh the times that are left today
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

// =========================================
//  Date and time of the ticket (SCRUM-120)
// =========================================

let times = null;   // from the server: first, last, step, days_ahead, today, now (Irish time)

const pad = (n) => String(n).padStart(2, '0');
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (minutes) => pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);

function addDays(isoDate, days) {
    const d = new Date(isoDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// Departure times for a date. Today only offers the ones that haven't gone yet.
function slotsFor(date) {
    const slots = [];
    const earliest = date === times.today ? toMinutes(times.now) - times.step : -1;
    for (let m = toMinutes(times.first); m <= toMinutes(times.last); m += times.step) {
        if (m >= earliest) slots.push(toHhmm(m));
    }
    return slots;
}

function fillTimes() {
    const select = $('travel-time');
    const previous = select.value;
    const date = $('travel-date').value;
    select.innerHTML = '';
    const valid = date >= times.today && date <= addDays(times.today, times.days_ahead);
    (valid ? slotsFor(date) : []).forEach((slot) => select.add(new Option(slot, slot)));
    if (Array.from(select.options).some((o) => o.value === previous)) select.value = previous;
    select.disabled = select.options.length === 0;
}

function setupWhen(serverTimes) {
    if (!serverTimes || !readDraft()) return;
    times = serverTimes;
    const date = $('travel-date');
    date.min = times.today;
    date.max = addDays(times.today, times.days_ahead);
    if (!date.value || date.value < date.min) {
        // No buses left today: start on tomorrow
        date.value = slotsFor(times.today).length ? times.today : addDays(times.today, 1);
    }
    $('when').disabled = false;
    fillTimes();
    checkWhen();
}

// Says what is wrong with the choice, and only lets the user pay when it is fine
function checkWhen() {
    if (!times) return false;
    const date = $('travel-date').value;
    let error = '';
    if (!date) {
        error = 'Choose a date for your journey.';
    } else if (date < times.today) {
        error = 'That date has already passed. Choose today or a later date.';
    } else if (date > addDays(times.today, times.days_ahead)) {
        error = 'Tickets can only be bought up to ' + times.days_ahead + ' days ahead.';
    } else if (!$('travel-time').value) {
        error = date === times.today
            ? 'There are no more buses today. Choose another date.'
            : 'Choose a departure time.';
    }
    $('when-error').textContent = error;
    $('when-error').hidden = !error;
    $('buy-btn').disabled = Boolean(error) || !fare;
    return !error;
}

function chosenWhen() {
    return $('travel-date').value + ' ' + $('travel-time').value;
}

// "2026-11-18 14:30(:00)" -> "Wed 18 Nov 2026, 14:30" (the time is already Irish time)
function formatWhen(value) {
    if (!value) return 'Any time';
    const d = new Date(value.slice(0, 10) + 'T00:00:00Z');
    const day = d.toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return day + ', ' + value.slice(11, 16);
}

$('travel-date').addEventListener('change', () => { if (times) { fillTimes(); checkWhen(); } });
$('travel-time').addEventListener('change', checkWhen);

// =========================================
//  My tickets with their QR code (SCRUM-122)
// =========================================

const STATUS_TEXT = { active: 'Valid', used: 'Used', expired: 'Expired' };

function drawQr(box, token, label) {
    box.innerHTML = '';
    if (typeof qrcode !== 'function') {
        box.textContent = "The QR code couldn't be drawn. Please refresh the page.";
        return;
    }
    const qr = qrcode(0, 'M');
    qr.addData('HOP-TICKET:' + token);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
    const svg = box.querySelector('svg');
    if (svg) {
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', label);
    }
}

// Valid tickets first (soonest journey first), then used and expired ones
function sortTickets(list) {
    const valid = list.filter((t) => t.status === 'active')
        .sort((a, b) => String(a.travel_at).localeCompare(String(b.travel_at)));
    const old = list.filter((t) => t.status !== 'active');
    return valid.concat(old);
}

function setTickets(list) {
    tickets = Array.isArray(list) ? sortTickets(list) : [];
    const ul = $('ticket-list');
    ul.innerHTML = '';

    tickets.forEach((t) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ticket-item is-' + t.status;

        const info = document.createElement('div');
        info.className = 'ticket-info';
        const route = document.createElement('strong');
        route.textContent = t.route;
        const when = document.createElement('span');
        when.textContent = formatWhen(t.travel_at);
        const status = document.createElement('span');
        status.className = 'ticket-status is-' + t.status;
        status.textContent = STATUS_TEXT[t.status] || t.status;
        info.append(route, when, status);
        button.appendChild(info);

        if (t.qr_token) {
            const thumb = document.createElement('div');
            thumb.className = 'qr-box qr-thumb';
            drawQr(thumb, t.qr_token, 'QR code');
            thumb.setAttribute('aria-hidden', 'true');
            button.appendChild(thumb);
            button.setAttribute('aria-label', 'Show QR code: ' + t.route + ', ' + formatWhen(t.travel_at));
        }
        button.addEventListener('click', () => openTicket(t));
        li.appendChild(button);
        ul.appendChild(li);
    });

    $('my-tickets').hidden = tickets.length === 0;
    updateEmpty();
}

const qrDialog = $('qr-dialog');

function openTicket(t) {
    $('qr-route').textContent = t.route;
    $('qr-when').textContent = formatWhen(t.travel_at) + ' · ' + (STATUS_TEXT[t.status] || t.status);
    const box = $('qr-code');
    if (t.qr_token) {
        drawQr(box, t.qr_token, 'QR code for your ticket');
        $('qr-hint').textContent = 'Show this code to the driver when you board. Valid for ' +
            ((times && times.valid_minutes) || 90) + ' minutes from ' + (t.travel_at ? t.travel_at.slice(11, 16) : 'boarding') + '.';
    } else {
        box.innerHTML = '';
        $('qr-hint').textContent = t.status === 'used'
            ? 'This ticket has already been used, so it has no QR code.'
            : 'This ticket has expired, so it can no longer be used. Buy a new ticket for your next journey.';
    }
    box.hidden = !t.qr_token;
    qrDialog.showModal();
}

$('qr-close').addEventListener('click', () => qrDialog.close());

loadFare();
