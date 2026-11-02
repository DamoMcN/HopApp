// =========================================
//  Helpers
// =========================================

function calculateAge(dobString) {
    const dob = new Date(dobString);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    return age;
}

function selectCard(cardElement) {
    // Ineligible cards can't be picked
    if (cardElement.classList.contains('ineligible')) return;

    document.querySelectorAll('.card-option').forEach(c => c.classList.remove('selected'));
    cardElement.classList.add('selected');

    const actionButton = document.getElementById('modal-action-btn');
    if (actionButton) actionButton.disabled = false;
}

function closeModal() {
    const modal = document.getElementById('eligibility-modal');
    if (modal) modal.style.display = 'none';
}

// =========================================
//  Friendly pop-ups
// =========================================

// One reusable pop-up that replaces alert(). Options:
//   title, message, items (optional bullet list), focusId (field to highlight
//   and focus when the pop-up is closed), link { text, href } (optional)
let noticeDialog = null;

function getNoticeDialog() {
    if (noticeDialog) return noticeDialog;

    const d = document.createElement('dialog');
    d.className = 'notice';
    d.setAttribute('role', 'alertdialog');
    d.setAttribute('aria-labelledby', 'notice-title');
    d.setAttribute('aria-describedby', 'notice-text');
    d.innerHTML =
        '<div class="notice-icon" aria-hidden="true">!</div>' +
        '<h3 id="notice-title"></h3>' +
        '<p id="notice-text"></p>' +
        '<ul id="notice-list" class="notice-list" hidden></ul>' +
        '<div class="notice-actions">' +
        '<button type="button" id="notice-ok" class="modal-submit-btn">OK</button>' +
        '<a id="notice-link" class="notice-link" hidden></a>' +
        '</div>';
    document.body.appendChild(d);
    d.querySelector('#notice-ok').addEventListener('click', () => d.close());

    noticeDialog = d;
    return d;
}

function markFieldError(id) {
    const field = id ? document.getElementById(id) : null;
    if (!field) return;
    field.classList.add('has-error');
    field.setAttribute('aria-invalid', 'true');
    field.focus();

    // The red outline goes away as soon as the person starts fixing it
    const clear = () => {
        field.classList.remove('has-error');
        field.removeAttribute('aria-invalid');
    };
    field.addEventListener('input', clear, { once: true });
    field.addEventListener('change', clear, { once: true });
}

function showNotice(options) {
    const d = getNoticeDialog();
    d.querySelector('#notice-title').textContent = options.title || 'Something went wrong';
    d.querySelector('#notice-text').textContent = options.message || '';

    const list = d.querySelector('#notice-list');
    list.innerHTML = '';
    (options.items || []).forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        list.appendChild(li);
    });
    list.hidden = !(options.items && options.items.length);

    const link = d.querySelector('#notice-link');
    link.hidden = !options.link;
    if (options.link) {
        link.textContent = options.link.text;
        link.href = options.link.href;
    }

    d.onclose = () => markFieldError(options.focusId);
    if (!d.open) d.showModal();
}

// =========================================
//  Password rules
// =========================================

const PASSWORD_RULES = {
    length: pw => pw.length >= 8,
    digit:  pw => /[0-9]/.test(pw),
    upper:  pw => /[A-Z]/.test(pw),
    lower:  pw => /[a-z]/.test(pw),
    symbol: pw => /[^A-Za-z0-9]/.test(pw)
};

// What to tell the person when a rule isn't met
const PASSWORD_RULE_TEXT = {
    length: 'At least 8 characters',
    digit:  'A number (0-9)',
    upper:  'An uppercase letter (A-Z)',
    lower:  'A lowercase letter (a-z)',
    symbol: 'A symbol, like ! @ # $ %'
};

function checkPassword(pw) {
    const failed = [];
    for (const [rule, test] of Object.entries(PASSWORD_RULES)) {
        if (!test(pw)) failed.push(rule);
    }
    return failed; // empty array = password is valid
}

// Live feedback on the signup page: rule ticks under the password box, and a
// "passwords match" line under the confirm box
document.addEventListener('DOMContentLoaded', () => {
    const pwInput = document.getElementById('signup-password');
    const confirmInput = document.getElementById('confirm-password');
    if (!pwInput) return;

    pwInput.addEventListener('input', () => {
        const failed = checkPassword(pwInput.value);
        document.querySelectorAll('#password-rules li').forEach(li => {
            li.classList.toggle('met', !failed.includes(li.dataset.rule));
        });
    });

    if (!confirmInput) return;

    const hint = document.createElement('p');
    hint.id = 'confirm-hint';
    hint.className = 'field-hint';
    hint.setAttribute('aria-live', 'polite');
    confirmInput.insertAdjacentElement('afterend', hint);

    // Says "match" as soon as they do, but only says "don't match" once the
    // confirm box is as long as the password (or they leave it), so it doesn't
    // nag while they are still typing
    function updateConfirmHint(leaving) {
        const confirm = confirmInput.value;
        const password = pwInput.value;

        if (confirm === '') {
            hint.textContent = '';
            hint.className = 'field-hint';
        } else if (confirm === password) {
            hint.textContent = '\u2713 Passwords match';
            hint.className = 'field-hint ok';
        } else if (leaving || confirm.length >= password.length) {
            hint.textContent = "\u2717 Passwords don't match yet";
            hint.className = 'field-hint bad';
        } else {
            hint.textContent = '';
            hint.className = 'field-hint';
        }
    }

    confirmInput.addEventListener('input', () => updateConfirmHint(false));
    confirmInput.addEventListener('blur', () => updateConfirmHint(true));
    pwInput.addEventListener('input', () => {
        if (confirmInput.value !== '') updateConfirmHint(false);
    });
});

// Reads the server's JSON reply. If it isn't JSON (for example a PHP error
// page), throws an error with a friendly message instead of a technical one.
async function readJson(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        console.error('Server did not return JSON:', text);
        const error = new Error('Server did not return JSON');
        error.friendlyTitle = 'Something went wrong on our side';
        error.friendlyMessage = 'Please try again in a moment.';
        throw error;
    }
}

// =========================================
//  Signup
// =========================================

function handleSignup(event) {
    event.preventDefault();

    const dobInput = document.getElementById('dob').value;
    if (!dobInput) return;

    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (password !== confirmPassword) {
        showNotice({
            title: "Passwords don't match",
            message: 'The two passwords you typed are different. Please type the same password in both boxes.',
            focusId: 'confirm-password'
        });
        return;
    }

    const failedRules = checkPassword(password);
    if (failedRules.length > 0) {
        showNotice({
            title: 'Your password needs a little more',
            message: 'To keep your card safe, your password still needs:',
            items: failedRules.map(rule => PASSWORD_RULE_TEXT[rule]),
            focusId: 'signup-password'
        });
        return;
    }

    const age = calculateAge(dobInput);
    if (age < 0) {
        showNotice({
            title: 'Check your date of birth',
            message: "That date is in the future. Please enter the date you were born.",
            focusId: 'dob'
        });
        return;
    }
    if (age > 120) {
        showNotice({
            title: 'Check your date of birth',
            message: "That date doesn't look right. Please check the year and try again.",
            focusId: 'dob'
        });
        return;
    }

    const studentCheckbox = document.getElementById('is-student');
    const isStudent = studentCheckbox ? studentCheckbox.checked : false;

    const allCards = [
        { id: 'adult',       name: 'Adult Card',   state: 'ineligible', note: '' },
        { id: 'young-adult', name: 'Young Adult',  state: 'ineligible', note: '' },
        { id: 'student',     name: 'Student Card', state: 'ineligible', note: 'Requires ID' },
        { id: 'child',       name: 'Child Card',   state: 'ineligible', note: '' }
    ];

    let specialMessage = null;
    let specialTitle = 'Welcome to Hop!';

    if (age < 5) {
        specialTitle = 'Free Travel!';
        specialMessage = "This person can ride the bus for free. Come back when you're 5!";
    } else if (age >= 66) {
        specialTitle = 'Free Travel!';
        specialMessage = 'You can use your PPS Card for free bus rides.';
    } else if (age <= 18) {
        allCards.find(c => c.id === 'child').state = 'recommended';
    } else if (age <= 25) {
        allCards.find(c => c.id === 'young-adult').state = 'recommended';
        allCards.find(c => c.id === 'adult').state = 'eligible';
    } else if (isStudent) {
        allCards.find(c => c.id === 'student').state = 'recommended';
        allCards.find(c => c.id === 'adult').state = 'eligible';
    } else {
        allCards.find(c => c.id === 'adult').state = 'recommended';
    }

    const modalTitle      = document.getElementById('modal-title');
    const modalDesc       = document.getElementById('modal-desc');
    const resultContainer = document.getElementById('card-result');
    const actionButton    = document.getElementById('modal-action-btn');
    const backButton      = document.getElementById('modal-back-btn');

    resultContainer.innerHTML = '';
    actionButton.disabled = true;

    if (specialMessage) {
        // Free travel: nothing to save, button just closes the modal
        modalTitle.innerText = specialTitle;
        modalDesc.innerText = specialMessage;
        resultContainer.style.display = 'none';
        backButton.style.display = 'none';
        actionButton.innerText = 'Go Back';
        actionButton.onclick = closeModal;
        actionButton.disabled = false;
    } else {
        modalTitle.innerText = 'Welcome to Hop!';
        modalDesc.innerText = "We've highlighted the best card for you, but you can select any eligible option:";
        resultContainer.style.display = 'grid';
        backButton.style.display = 'block';

        allCards.forEach(card => {
            const cardElement = document.createElement('div');
            cardElement.className = `card-option ${card.state}`;
            cardElement.dataset.cardId = card.id;
            cardElement.addEventListener('click', () => selectCard(cardElement));

            let cardHTML = `<div class="card-title">${card.name}</div>`;
            if (card.note && card.state !== 'ineligible') {
                cardHTML += `<div class="card-note">${card.note}</div>`;
            }
            if (card.state === 'recommended') {
                cardHTML += `<div class="recommended-badge">Recommended</div>`;
            }
            cardElement.innerHTML = cardHTML;
            resultContainer.appendChild(cardElement);
        });

        const recommendedCard = resultContainer.querySelector('.card-option.recommended');
        if (recommendedCard) selectCard(recommendedCard);

        actionButton.innerText = 'Create Account';
        actionButton.onclick = submitSignup;
    }

    document.getElementById('eligibility-modal').style.display = 'flex';
}

// Runs when "Create Account" is pressed in the modal.
// The 16-digit card number is generated by signup.php when the account is created.
async function submitSignup() {
    const form = document.getElementById('signup-form');
    const actionButton = document.getElementById('modal-action-btn');
    const formData = new FormData(form);

    // confirm_password is sent too, so the server checks the passwords match as well
    const selected = document.querySelector('.card-option.selected');
    formData.append('card_type', selected ? selected.dataset.cardId : '');

    actionButton.disabled = true;
    actionButton.innerText = 'Creating...';

    try {
        const response = await fetch('../../backend/auth/signup.php', {
            method: 'POST',
            body: formData
        });

        const data = await readJson(response);

        if (data.success) {
            window.location.href = 'index.html';
            return;
        }

        // Close the card chooser so the person can see and fix the form
        closeModal();
        if (data.code === 'email_taken') {
            showNotice({
                title: 'That email is already registered',
                message: 'There is already a Hop account using this email address. Try logging in instead, or use a different email.',
                focusId: 'signup-email',
                link: { text: 'Go to Log In', href: 'index.html' }
            });
        } else {
            showNotice({
                title: "We couldn't create your account",
                message: data.message || 'Something went wrong. Please try again.',
                focusId: data.field
            });
        }
    } catch (error) {
        console.error('Signup error:', error);
        showNotice({
            title: error.friendlyTitle || "Couldn't reach Hop",
            message: error.friendlyMessage || 'Please check your internet connection and try again.'
        });
    }

    actionButton.disabled = false;
    actionButton.innerText = 'Create Account';
}

// =========================================
//  Login (top level, so index.html can see it)
// =========================================
// No card selection here: the card type was saved at signup
// and login.php loads it from the database.

async function handleLogin(event) {
    event.preventDefault();

    const form = document.getElementById('login-form');
    const button = form.querySelector('.submit-btn');
    const formData = new FormData(form);

    button.disabled = true;
    button.innerText = 'Logging in...';

    try {
        const response = await fetch('../../backend/auth/login.php', {
            method: 'POST',
            body: formData
        });

        const data = await readJson(response);

        if (data.success) {
            window.location.href = '../card/card.html';
            return; // page is navigating away, leave the button as is
        }

        const passwordField = document.getElementById('login-password');
        if (data.code === 'bad_credentials') {
            passwordField.value = '';
            showNotice({
                title: "Those details don't match",
                message: "We couldn't find an account with that email and password. Check them and try again. Passwords are case-sensitive.",
                focusId: 'login-password'
            });
        } else {
            showNotice({
                title: "Couldn't log you in",
                message: data.message || 'Something went wrong. Please try again.',
                focusId: 'login-email'
            });
        }
    } catch (error) {
        console.error('Login error:', error);
        showNotice({
            title: error.friendlyTitle || "Couldn't reach Hop",
            message: error.friendlyMessage || 'Please check your internet connection and try again.'
        });
    }

    button.disabled = false;
    button.innerText = 'Log In';
}

// "Forgot your password?" isn't built yet, so say so instead of showing a developer alert
function forgotPassword(event) {
    event.preventDefault();
    showNotice({
        title: 'Password reset is coming soon',
        message: "You can't reset your password in the app yet. Please contact Help & Support and we'll help you get back in.",
        link: { text: 'Go to Help & Support', href: '../support/support.html' }
    });
}
