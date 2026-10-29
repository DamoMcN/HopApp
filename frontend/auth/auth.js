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
//  Password rules
// =========================================

const PASSWORD_RULES = {
    length: pw => pw.length >= 8,
    digit:  pw => /[0-9]/.test(pw),
    upper:  pw => /[A-Z]/.test(pw),
    lower:  pw => /[a-z]/.test(pw),
    symbol: pw => /[^A-Za-z0-9]/.test(pw)
};

function checkPassword(pw) {
    const failed = [];
    for (const [rule, test] of Object.entries(PASSWORD_RULES)) {
        if (!test(pw)) failed.push(rule);
    }
    return failed; // empty array = password is valid
}

// Live ticks under the password box (signup page only)
document.addEventListener('DOMContentLoaded', () => {
    const pwInput = document.getElementById('signup-password');
    if (!pwInput) return;

    pwInput.addEventListener('input', () => {
        const failed = checkPassword(pwInput.value);
        document.querySelectorAll('#password-rules li').forEach(li => {
            li.classList.toggle('met', !failed.includes(li.dataset.rule));
        });
    });
});

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
        alert('Passwords do not match.');
        return;
    }
    if (checkPassword(password).length > 0) {
        alert('Password must be at least 8 characters and include a digit, an uppercase letter, a lowercase letter and a symbol.');
        document.getElementById('signup-password').focus();
        return;
    }

    const age = calculateAge(dobInput);
    if (age < 0) {
        alert('Please enter a valid date of birth.');
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

    // Tidy up what gets sent to PHP
    formData.delete('confirm_password');
    const selected = document.querySelector('.card-option.selected');
    formData.append('card_type', selected ? selected.dataset.cardId : '');

    actionButton.disabled = true;
    actionButton.innerText = 'Creating...';

    try {
        const response = await fetch('../../backend/auth/signup.php', {
            method: 'POST',
            body: formData
        });

        const text = await response.text();
        console.log('Server said:', text); // remove once everything works

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('Server did not return JSON (check the console output above).');
        }

        if (data.success) {
            window.location.href = 'index.html';
        } else {
            alert('Registration failed: ' + data.message);
            actionButton.disabled = false;
            actionButton.innerText = 'Create Account';
        }
    } catch (error) {
        console.error('Signup error:', error);
        alert('Something went wrong: ' + error.message);
        actionButton.disabled = false;
        actionButton.innerText = 'Create Account';
    }
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

        const text = await response.text();
        console.log('Server said:', text); // remove once everything works

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('Server did not return JSON (check the console output above).');
        }

        if (data.success) {
            window.location.href = '../card/card.html';
            return; // page is navigating away, leave the button as is
        }
        alert(data.message);
    } catch (error) {
        console.error('Login error:', error);
        alert('Something went wrong: ' + error.message);
    }

    button.disabled = false;
    button.innerText = 'Log In';
}