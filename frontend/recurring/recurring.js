// Recurring top up page.
//
// No recurring top up yet -> the form is shown.
// Already has one         -> a summary with Turn off / Turn on, Change and Cancel.
// Review opens a sheet with the settings; nothing is saved until Confirm.
// The server (backend/auth/recurring.php) checks everything again.

const API = '../../backend/auth/recurring.php';
const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const $ = (id) => document.getElementById(id);

const INTERVALS = { weekly: 'Every week', fortnightly: 'Every 2 weeks', monthly: 'Every month' };

let data = null;       // last reply from the server
let editing = false;   // true while changing an existing recurring top up
let pending = null;    // the settings shown in the review sheet

// 'YYYY-MM-DD' -> "Fri 13 Nov"
function formatDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short' });
}

// "then every Friday" for the chosen interval and first day
function scheduleText(interval, iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const weekday = new Date(y, m - 1, d).toLocaleDateString('en-IE', { weekday: 'long' });
    if (interval === 'weekly')      return 'every ' + weekday;
    if (interval === 'fortnightly') return 'every other ' + weekday;
    return 'on day ' + d + ' of every month';
}

function setMessage(text, kind) {
    $('message').textContent = text;
    $('message').className = 'message' + (kind ? ' ' + kind : '');
}

async function request(payload) {
    const options = payload
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
        : { cache: 'no-store' };
    const response = await fetch(API, options);
    const reply = await response.json();
    if (reply.logged_in === false) {
        window.location.href = '../auth/index.html';
        throw new Error('Not logged in');
    }
    if (!reply.success) throw new Error(reply.error || 'Something went wrong');
    return reply;
}

// =========================================
//  Showing the page
// =========================================

function render() {
    $('balance-display').textContent = money.format(data.balance);
    const r = data.recurring;
    const showForm = !r || editing;
    $('summary').hidden = showForm;
    $('setup-form').hidden = !showForm;

    if (showForm) {
        fillForm(editing ? r : null);
        return;
    }

    $('status').textContent = r.enabled ? 'On' : 'Off';
    $('status').classList.toggle('on', r.enabled);
    $('summary-amount').textContent = money.format(r.amount);
    $('summary-interval').textContent = r.interval_label.toLowerCase();
    $('summary-next').textContent = r.enabled ? formatDate(r.next_run_date) : 'Turned off';
    $('summary-pay').textContent = r.pay_with;
    $('toggle-btn').textContent = r.enabled ? 'Turn off' : 'Turn on';
}

// Fills the form with the current settings (when changing) or defaults
function fillForm(r) {
    document.querySelector('input[name="amount"][value="' + (r ? r.amount * 100 : 500) + '"]').checked = true;
    document.querySelector('input[name="interval"][value="' + (r ? r.interval : 'weekly') + '"]').checked = true;

    const start = $('start-date');
    start.min = data.today;
    start.value = r && r.next_run_date >= data.today ? r.next_run_date : data.today;

    // Saved cards plus the demo wallet ("" = demo wallet)
    const options = data.cards.map((c) => ({ value: String(c.id), label: c.label }));
    options.push({ value: '', label: 'Demo wallet' });
    const selected = r ? String(r.card_id ?? '') : options[0].value;

    $('pay-list').innerHTML = '';
    options.forEach((o) => {
        const label = document.createElement('label');
        label.className = 'saved-card';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'pay';
        radio.value = o.value;
        radio.checked = o.value === selected;
        label.append(radio, document.createTextNode(o.label));
        $('pay-list').appendChild(label);
    });

    updateHint();
}

// "First top up today, then every Friday." under the date
function updateHint() {
    const interval = document.querySelector('input[name="interval"]:checked').value;
    const start = $('start-date').value;
    if (!start) {
        $('schedule-hint').textContent = '';
        return;
    }
    const first = start === data.today ? 'today' : formatDate(start);
    $('schedule-hint').textContent = 'First top up ' + first + ', then ' + scheduleText(interval, start) + '.';
}

// =========================================
//  Review sheet
// =========================================

const reviewDialog = $('review-dialog');

function openReview() {
    const start = $('start-date').value;
    if (!start || start < data.today) {
        setMessage('Choose a first top up date from today onwards.', 'err');
        return;
    }
    const pay = document.querySelector('input[name="pay"]:checked');

    pending = {
        amount_cents: Number(document.querySelector('input[name="amount"]:checked').value),
        interval: document.querySelector('input[name="interval"]:checked').value,
        start_date: start,
        card_id: pay.value === '' ? null : Number(pay.value)
    };

    $('review-amount').textContent = money.format(pending.amount_cents / 100);
    $('review-interval').textContent = INTERVALS[pending.interval];
    $('review-start').textContent = start === data.today ? 'Today' : formatDate(start);
    $('review-pay').textContent = pay.parentElement.textContent;
    $('review-error').textContent = '';

    // Step 1 visible, step 2 hidden
    $('review-title').textContent = editing ? 'Check your changes' : 'Check your recurring top up';
    $('review-step').hidden = false;
    $('done-step').hidden = true;
    setMessage('', '');
    reviewDialog.showModal();
}

async function confirmReview() {
    $('confirm-btn').disabled = true;
    $('confirm-btn').textContent = 'Saving…';
    try {
        data = await request({ action: 'save', ...pending });
        const r = data.recurring;

        // Same sheet, now showing step 2 (the confirmation)
        $('review-title').textContent = editing ? 'Recurring top up updated' : 'Recurring top up set up';
        $('done-text').textContent =
            money.format(r.amount) + ' ' + r.interval_label.toLowerCase() + '. ' +
            (data.added_now ? money.format(r.amount) + ' was added today. ' : '') +
            'Next top up: ' + formatDate(r.next_run_date) + '.';
        $('review-step').hidden = true;
        $('done-step').hidden = false;
    } catch (error) {
        $('review-error').textContent = error.message;
    } finally {
        $('confirm-btn').disabled = false;
        $('confirm-btn').textContent = 'Confirm';
    }
}

// =========================================
//  Turn on / off, cancel
// =========================================

async function toggle() {
    const turnOn = !data.recurring.enabled;
    try {
        data = await request({ action: 'set_enabled', enabled: turnOn });
        render();
        setMessage(turnOn ? 'Recurring top up turned on.' : 'Recurring top up turned off. Nothing will be added until you turn it on.', 'ok');
    } catch (error) {
        setMessage(error.message, 'err');
    }
}

async function cancel() {
    try {
        data = await request({ action: 'cancel' });
        $('cancel-dialog').close();
        editing = false;
        render();
        setMessage('Recurring top up cancelled.', 'ok');
    } catch (error) {
        $('cancel-dialog').close();
        setMessage(error.message, 'err');
    }
}

// =========================================
//  Events
// =========================================

document.querySelectorAll('input[name="interval"]').forEach((i) => i.addEventListener('change', updateHint));
$('start-date').addEventListener('change', updateHint);

$('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    openReview();
});
$('confirm-btn').addEventListener('click', confirmReview);
$('edit-btn').addEventListener('click', () => reviewDialog.close());
$('done-btn').addEventListener('click', () => reviewDialog.close());

// Closing the sheet after saving shows the summary
reviewDialog.addEventListener('close', () => {
    if (!$('done-step').hidden) {
        editing = false;
        render();
    }
});

$('toggle-btn').addEventListener('click', toggle);
$('change-btn').addEventListener('click', () => {
    editing = true;
    setMessage('', '');
    render();
});
$('cancel-btn').addEventListener('click', () => $('cancel-dialog').showModal());
$('cancel-yes').addEventListener('click', cancel);
$('cancel-no').addEventListener('click', () => $('cancel-dialog').close());

// =========================================
//  Start
// =========================================

request()
    .then((reply) => {
        data = reply;
        render();
    })
    .catch(() => setMessage("Couldn't load your recurring top up. Please refresh the page.", 'err'));
