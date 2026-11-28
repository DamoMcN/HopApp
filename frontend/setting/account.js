// Change your name, email, phone number or password from Settings (User profile).
// The pencil next to Name, Email and Phone opens a small form under that row.
// Talks to backend/auth/account.php. The server checks everything again, so the
// checks here are only there to give a quicker, clearer message.
//
// Kept in its own file so setting.js does not need to change.

(function () {
    'use strict';

    const ACCOUNT_API = '../../backend/auth/account.php';
    const SESSION_API = '../../backend/auth/session.php';
    const el = (id) => document.getElementById(id);

    // pencil button id -> form id
    const EDITORS = { 'edit-name': 'name-form', 'edit-email': 'email-form', 'edit-phone': 'phone-form' };

    let current = { f_name: '', l_name: '' };

    // Same rules as signing up (backend/auth/signup.php)
    function passwordProblem(password) {
        if (password.length < 8 || password.length > 72
            || !/[0-9]/.test(password) || !/[A-Z]/.test(password)
            || !/[a-z]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
            return 'Your new password needs 8 to 72 characters, with a digit, an uppercase letter, a lowercase letter and a symbol.';
        }
        return '';
    }

    const looksLikeEmail = (text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);

    // Same rule as account.php: 7 to 15 digits, an optional + in front, spaces/dashes/brackets allowed
    function looksLikePhone(text) {
        const clean = text.replace(/[\s\-.()]/g, '');
        const digits = clean.replace(/^\+/, '');
        return /^\+?\d+$/.test(clean) && digits.length >= 7 && digits.length <= 15;
    }

    // "••• 4567": the full number is never sent to the page
    function maskedPhone(last4) {
        return last4 ? '••• ' + last4 : 'Not added';
    }

    function setMessage(form, text, kind) {
        const message = form.querySelector('.settings-message');
        message.textContent = text;
        message.className = 'settings-message' + (kind ? ' ' + kind : '');
    }

    function clearErrors(form) {
        form.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
    }

    // Shows the message and puts the cursor in the box that needs fixing
    function showError(form, text, fieldName) {
        setMessage(form, text, 'err');
        const input = fieldName && form.elements[fieldName];
        if (input) {
            input.setAttribute('aria-invalid', 'true');
            input.focus();
        }
    }

    function showProfile(details) {
        if (details.f_name !== undefined) {
            current = { f_name: details.f_name || '', l_name: details.l_name || '' };
            el('profile-name').textContent = [current.f_name, current.l_name].filter(Boolean).join(' ');
        }
        if (details.email !== undefined) {
            const link = el('profile-email');
            link.textContent = details.email || 'Not available';
            if (details.email) link.href = 'mailto:' + details.email;
        }
        if (details.phone_last4 !== undefined) {
            el('profile-phone').textContent = maskedPhone(details.phone_last4);
        }
    }

    // ---------- Pencil buttons ----------

    function resetForm(form) {
        clearErrors(form);
        setMessage(form, '', '');
        form.querySelectorAll('input').forEach((input) => { input.value = ''; });
        if (form.id === 'name-form') {
            form.elements.first_name.value = current.f_name;
            form.elements.last_name.value = current.l_name;
        }
    }

    function closeEditor(buttonId, { focusButton = false } = {}) {
        const button = el(buttonId);
        const form = el(EDITORS[buttonId]);
        if (form.hidden) return;
        form.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        if (focusButton) button.focus();
    }

    // Opens one form (closing any other) and puts the cursor in its first box
    function openEditor(buttonId) {
        Object.keys(EDITORS).forEach((id) => { if (id !== buttonId) closeEditor(id); });
        const form = el(EDITORS[buttonId]);
        resetForm(form);
        form.hidden = false;
        el(buttonId).setAttribute('aria-expanded', 'true');
        form.querySelector('input').focus();
    }

    Object.keys(EDITORS).forEach((buttonId) => {
        const form = el(EDITORS[buttonId]);
        el(buttonId).addEventListener('click', () => {
            if (form.hidden) openEditor(buttonId);
            else closeEditor(buttonId);
        });
        form.querySelector('[data-cancel]').addEventListener('click', () => closeEditor(buttonId, { focusButton: true }));
        form.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeEditor(buttonId, { focusButton: true });
        });
    });

    // ---------- Saving ----------

    async function send(form, body, check) {
        clearErrors(form);
        const problem = check();
        if (problem) {
            showError(form, problem[0], problem[1]);
            return;
        }

        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        setMessage(form, 'Saving…', '');
        try {
            const response = await fetch(ACCOUNT_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (data.logged_in === false) {
                window.location.href = '../auth/index.html';
                return;
            }
            if (!data.success) {
                showError(form, data.message || 'Could not save your changes.', data.field);
                return;
            }
            showProfile(data);
            const buttonId = Object.keys(EDITORS).find((id) => EDITORS[id] === form.id);
            if (buttonId) {
                // Close the form and say so next to the profile, where the change now shows
                closeEditor(buttonId, { focusButton: true });
                announce(data.message || 'Saved.');
            } else {
                form.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ''; });
                setMessage(form, data.message || 'Saved.', 'ok');
            }
        } catch (error) {
            setMessage(form, 'Could not save your changes. Check your connection and try again.', 'err');
        } finally {
            button.disabled = false;
        }
    }

    // The "Your name has been updated." line under the profile
    function announce(text) {
        const message = el('profile-message');
        message.textContent = text;
        message.className = 'settings-message ok';
    }

    el('name-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const first = form.elements.first_name.value.trim();
        const last = form.elements.last_name.value.trim();
        send(form, { action: 'name', first_name: first, last_name: last }, () => {
            if (!first) return ['Enter your first name.', 'first_name'];
            if (!last) return ['Enter your last name.', 'last_name'];
            return null;
        });
    });

    el('email-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const email = form.elements.new_email.value.trim();
        const password = form.elements.current_password.value;
        send(form, { action: 'email', new_email: email, current_password: password }, () => {
            if (!looksLikeEmail(email)) return ['Enter a valid email address.', 'new_email'];
            if (!password) return ['Enter your current password.', 'current_password'];
            return null;
        });
    });

    el('phone-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const phone = form.elements.new_phone.value.trim();
        send(form, { action: 'phone', new_phone: phone }, () => {
            if (!looksLikePhone(phone)) return ['Enter a valid phone number, for example 087 123 4567 or +353 87 123 4567.', 'new_phone'];
            return null;
        });
    });

    el('password-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const currentPassword = form.elements.current_password.value;
        const next = form.elements.new_password.value;
        const confirm = form.elements.confirm_password.value;
        send(form, { action: 'password', current_password: currentPassword, new_password: next, confirm_password: confirm }, () => {
            if (!currentPassword) return ['Enter your current password.', 'current_password'];
            const problem = passwordProblem(next);
            if (problem) return [problem, 'new_password'];
            if (next !== confirm) return ["The two new passwords don't match.", 'confirm_password'];
            if (next === currentPassword) return ['Your new password must be different from your current one.', 'new_password'];
            return null;
        });
    });

    el('show-passwords').addEventListener('change', (event) => {
        const type = event.currentTarget.checked ? 'text' : 'password';
        ['current-password', 'new-password', 'confirm-password'].forEach((id) => { el(id).type = type; });
    });

    // Current name (for the name boxes) and the phone's last four digits
    fetch(SESSION_API, { cache: 'no-store' })
        .then((response) => response.json())
        .then((data) => {
            if (data.logged_in) showProfile({ f_name: data.f_name, l_name: data.l_name, phone_last4: data.phone_last4 || '' });
        })
        .catch(() => { /* setting.js already shows an error if the session can't load */ });
})();
