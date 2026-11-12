const SESSION_API = '../../backend/auth/session.php';
const TOPUP_API = '../../backend/auth/topup.php';
const USER_SETTINGS_API = '../../backend/auth/user_settings.php';
const CARD_STATUS_API = '../../backend/auth/card_status.php';

let settingsUserId = null;
let currentCardStatus = 'active';
let userSettingsAvailable = false;

const settingEl = (id) => document.getElementById(id);

function preferenceKey(userId, key) {
    return 'hop.settings.' + key + '.' + userId;
}

function showMessage(text, kind = '') {
    const message = settingEl('settings-message');
    message.textContent = text;
    message.className = 'settings-message' + (kind ? ' ' + kind : '');
}

function showAutoTopUpMessage(text, kind = '') {
    const message = settingEl('auto-topup-message');
    message.textContent = text;
    message.className = 'settings-message' + (kind ? ' ' + kind : '');
}

function renderCardStatus(status) {
    currentCardStatus = status || 'active';
    settingEl('card-status').textContent = currentCardStatus.replaceAll('_', ' ');
    const button = settingEl('card-status-button');

    if (currentCardStatus === 'reported_lost' || currentCardStatus === 'reported_stolen') {
        button.disabled = true;
        button.textContent = 'Card reported';
    } else {
        button.disabled = false;
        button.textContent = currentCardStatus === 'frozen' ? 'Unfreeze card' : 'Freeze card';
    }
}

async function loadTopUpSettings() {
    const response = await fetch(TOPUP_API, { cache: 'no-store' });
    const data = await response.json();
    if (data.logged_in === false) {
        window.location.href = '../auth/index.html';
        return;
    }
    if (!response.ok || data.error) throw new Error(data.error || 'Could not load top-up settings.');

    const select = settingEl('auto-topup-card');
    const amountSelect = settingEl('auto-topup-amount');
    select.innerHTML = '';
    data.cards.forEach((card) => {
        const option = document.createElement('option');
        option.value = String(card.id);
        option.textContent = card.brand + ' ending in ' + card.last4;
        select.appendChild(option);
    });

    let preferences = {
        auto_top_up_enabled: false,
        auto_top_up_amount_eur: 10,
        auto_top_up_card_id: null,
    };
    let legacyEnabled = false;
    let legacyCard = null;
    let legacyAmount = null;
    let settingsLoadError = '';
    try {
        const preferenceResponse = await fetch(USER_SETTINGS_API, { cache: 'no-store' });
        const preferenceData = await preferenceResponse.json();
        if (preferenceResponse.ok && preferenceData.settings) {
            preferences = preferenceData.settings;
            userSettingsAvailable = true;
            if (!preferenceData.configured) {
                legacyEnabled = localStorage.getItem(preferenceKey(settingsUserId, 'autoTopUpEnabled')) === 'true';
                legacyCard = localStorage.getItem(preferenceKey(settingsUserId, 'autoTopUpCard'));
                legacyAmount = localStorage.getItem(preferenceKey(settingsUserId, 'autoTopUpAmount'));
            }
        } else {
            settingsLoadError = preferenceData.error || 'Could not load account settings.';
        }
    } catch (error) {
        settingsLoadError = 'Could not load account settings. Check the database migration.';
    }

    const validAmounts = [];
    amountSelect.innerHTML = '';
    for (let amount = 5; amount <= 100; amount += 5) {
        validAmounts.push(String(amount));
        const option = document.createElement('option');
        option.value = String(amount);
        option.textContent = '€' + amount;
        amountSelect.appendChild(option);
    }
    const preferredAmount = String(preferences.auto_top_up_amount_eur || legacyAmount || 10);
    amountSelect.value = validAmounts.includes(preferredAmount) ? preferredAmount : '10';

    if (data.cards.length) {
        select.disabled = !userSettingsAvailable;
        amountSelect.disabled = !userSettingsAvailable;
        const preferredCard = String(preferences.auto_top_up_card_id || legacyCard || '');
        select.value = data.cards.some((card) => String(card.id) === preferredCard)
            ? preferredCard
            : String(data.cards[0].id);
    } else {
        select.disabled = true;
        amountSelect.disabled = true;
        select.innerHTML = '<option value="">No saved cards</option>';
    }

    const checkbox = settingEl('auto-topup-enabled');
    checkbox.checked = Boolean(preferences.auto_top_up_enabled || legacyEnabled) && data.cards.length > 0;
    checkbox.disabled = data.cards.length === 0 || !userSettingsAvailable;

    if (userSettingsAvailable && !preferences.auto_top_up_enabled && (legacyEnabled || legacyCard || legacyAmount)) {
        const migrated = await saveUserPreferences(false);
        if (migrated && legacyEnabled) {
            window.dispatchEvent(new Event('hop-auto-topup-setting-changed'));
        }
    }

    if (settingsLoadError) {
        showAutoTopUpMessage(settingsLoadError, 'err');
    } else if (data.cards.length === 0) {
        showAutoTopUpMessage('Add a saved card on the Top Up page to enable this setting.');
    } else {
        showAutoTopUpMessage(data.mode === 'mock'
            ? 'Demo mode is active: the app balance changes, but no real payment is taken.'
            : 'Automatic top up is ready for the selected saved card.');
    }
}

async function saveUserPreferences(showSuccess = true) {
    if (settingsUserId === null) return false;
    if (!userSettingsAvailable) {
        showAutoTopUpMessage('Import database/user_preferences_migration.sql to save settings to your account.', 'err');
        return false;
    }

    try {
        const response = await fetch(USER_SETTINGS_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                auto_top_up_enabled: settingEl('auto-topup-enabled').checked,
                auto_top_up_amount_eur: Number(settingEl('auto-topup-amount').value),
                auto_top_up_card_id: settingEl('auto-topup-card').value
                    ? Number(settingEl('auto-topup-card').value)
                    : null,
            })
        });
        const data = await response.json();
        if (data.logged_in === false) {
            window.location.href = '../auth/index.html';
            return false;
        }
        if (!response.ok || data.error) throw new Error(data.error || 'Could not save account settings.');
        if (showSuccess) showAutoTopUpMessage('Settings saved to your account.', 'ok');
        return true;
    } catch (error) {
        showAutoTopUpMessage(error.message || 'Could not save account settings.', 'err');
        return false;
    }
}

async function loadSettings() {
    try {
        const response = await fetch(SESSION_API, { cache: 'no-store' });
        const data = await response.json();
        if (!data.logged_in) {
            window.location.href = '../auth/index.html';
            return;
        }

        settingsUserId = Number(data.user_id);
        settingEl('profile-name').textContent = [data.f_name, data.l_name].filter(Boolean).join(' ');
        const emailLink = settingEl('profile-email');
        emailLink.textContent = data.email || 'Not available';
        if (data.email) emailLink.href = 'mailto:' + data.email;
        else emailLink.removeAttribute('href');
        settingEl('profile-card-type').textContent = data.card_type || 'Not available';
        renderCardStatus(data.card_status);
        await loadTopUpSettings();
    } catch (error) {
        console.error('Could not load settings:', error);
        showMessage(error.message || 'Could not load settings. Please refresh the page.', 'err');
    }
}

settingEl('card-status-button').addEventListener('click', async () => {
    const action = currentCardStatus === 'frozen' ? 'unfreeze' : 'freeze';
    settingEl('card-status-button').disabled = true;
    try {
        const response = await fetch(CARD_STATUS_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        const data = await response.json();
        if (data.logged_in === false) {
            window.location.href = '../auth/index.html';
            return;
        }
        if (!response.ok || data.success === false) throw new Error(data.error || 'Could not update card status.');
        renderCardStatus(data.card_status);
        showMessage(action === 'freeze' ? 'Your card is frozen.' : 'Your card is active again.', 'ok');
    } catch (error) {
        showMessage(error.message || 'Could not update card status.', 'err');
        settingEl('card-status-button').disabled = false;
    }
});

settingEl('auto-topup-card').addEventListener('change', (event) => {
    if (settingsUserId === null) return;
    saveUserPreferences();
});

settingEl('auto-topup-amount').addEventListener('change', (event) => {
    if (settingsUserId === null) return;
    saveUserPreferences();
});

settingEl('auto-topup-enabled').addEventListener('change', async (event) => {
    if (settingsUserId === null) return;
    const checkbox = event.currentTarget;
    const enabled = checkbox.checked;
    const saved = await saveUserPreferences(false);
    if (!saved) {
        checkbox.checked = !enabled;
        return;
    }
    showAutoTopUpMessage(enabled
        ? 'Automatic top up is on for this account.'
        : 'Automatic top up is off for this account.', 'ok');
    window.dispatchEvent(new Event('hop-auto-topup-setting-changed'));
});

loadSettings();
