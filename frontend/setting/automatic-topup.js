// Account-scoped automatic top-up check used by logged-in pages through menu.js.
(function () {
    const SESSION_API = '../../backend/auth/session.php';
    const TOPUP_API = '../../backend/auth/topup.php';
    const USER_SETTINGS_API = '../../backend/auth/user_settings.php';
    const THRESHOLD_CENTS = 100;

    function newIdempotencyKey() {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    async function check() {
        try {
            const sessionResponse = await fetch(SESSION_API, { cache: 'no-store' });
            const session = await sessionResponse.json();
            if (!session.logged_in || !session.user_id) return;

            const userId = Number(session.user_id);
            const pendingKeyName = 'hop.autoTopUp.pending.' + userId;

            const settingsResponse = await fetch(USER_SETTINGS_API, { cache: 'no-store' });
            const preferencesData = await settingsResponse.json();
            if (!settingsResponse.ok || !preferencesData.settings || !preferencesData.settings.auto_top_up_enabled) return;
            const preferences = preferencesData.settings;

            if (Number(session.wallet_balance) * 100 >= THRESHOLD_CENTS) {
                localStorage.removeItem(pendingKeyName);
                return;
            }
            if (session.card_status !== 'active') return;

            const configuredAmount = Number(preferences.auto_top_up_amount_eur);
            const amountEuros = Number.isInteger(configuredAmount) &&
                configuredAmount >= 5 && configuredAmount <= 100 && configuredAmount % 5 === 0
                ? configuredAmount
                : 10;

            const cardId = Number(preferences.auto_top_up_card_id);
            if (!Number.isInteger(cardId) || cardId <= 0) return;

            let idempotencyKey = localStorage.getItem(pendingKeyName);
            if (!idempotencyKey) {
                idempotencyKey = newIdempotencyKey();
                localStorage.setItem(pendingKeyName, idempotencyKey);
            }

            const response = await fetch(TOPUP_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'top_up',
                    amount_cents: amountEuros * 100,
                    source: 'saved_card',
                    card_id: cardId,
                    idempotency_key: idempotencyKey,
                    automatic: true
                })
            });
            const result = await response.json();
            if (!response.ok || result.success === false) {
                console.warn('Automatic top up did not complete:', result.error || 'Request failed');
            }
            // Keep the key until the next balance refresh reports >= €1.00.
            // Retries before then replay the same transaction instead of crediting twice.
        } catch (error) {
            console.warn('Automatic top-up balance check failed:', error);
        }
    }

    window.HopAutoTopUp = { check };
    window.addEventListener('hop-auto-topup-setting-changed', check);
    check();
})();
