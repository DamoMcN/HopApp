function handleSignup(event) {
    event.preventDefault(); 
    
    const dobInput = document.getElementById('dob').value;
    if (!dobInput) return;

    // Package the form data for PHP
    const form = event.target;
    const formData = new FormData(form);

    // Send data to the backend silently
    fetch('../../backend/auth/signup.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json()) 
    .then(data => {
        if (data.success) {
            // BACKEND SUCCESS: Run your existing card logic
            const age = calculateAge(dobInput);
            
            // Check if the student checkbox exists and is checked
            const studentCheckbox = document.getElementById('is-student');
            const isStudent = studentCheckbox ? studentCheckbox.checked : false;
            
            const allCards = [
                { id: 'adult', name: 'Adult Card', state: 'ineligible', note: '' },
                { id: 'young-adult', name: 'Young Adult', state: 'ineligible', note: '' },
                { id: 'student', name: 'Student Card', state: 'ineligible', note: 'Requires ID' },
                { id: 'child', name: 'Child Card', state: 'ineligible', note: '' }
            ];

            let specialMessage = null;
            let specialTitle = "Welcome to Hop!";
            let buttonText = "Create Account";
            let buttonAction = "window.location.href='index.html'";

            if (age < 5) {
                specialTitle = "Free Travel!";
                specialMessage = "This person can ride the bus for free. Come back when you're 5!";
                buttonText = "Go Back";
                buttonAction = "closeModal()";
            } else if (age >= 66) {
                specialTitle = "Free Travel!";
                specialMessage = "You can use your PPS Card for free bus rides.";
                buttonText = "Go Back";
                buttonAction = "closeModal()";
            } else if (age >= 5 && age <= 18) {
                allCards.find(c => c.id === 'child').state = 'recommended';
            } else if (age >= 19 && age <= 25) {
                allCards.find(c => c.id === 'young-adult').state = 'recommended';
                allCards.find(c => c.id === 'adult').state = 'eligible';
            } else {
                if (isStudent) {
                    allCards.find(c => c.id === 'student').state = 'recommended';
                    allCards.find(c => c.id === 'adult').state = 'eligible';
                } else {
                    allCards.find(c => c.id === 'adult').state = 'recommended';
                }
            }

            const modalTitle = document.getElementById('modal-title');
            const modalDesc = document.getElementById('modal-desc');
            const resultContainer = document.getElementById('card-result');
            const actionButton = document.getElementById('modal-action-btn');
            const backButton = document.getElementById('modal-back-btn');

            if (resultContainer) resultContainer.innerHTML = ''; 
            if (actionButton) actionButton.disabled = true;

            if (specialMessage) {
                if (modalTitle) modalTitle.innerText = specialTitle;
                if (modalDesc) modalDesc.innerText = specialMessage;
                if (resultContainer) resultContainer.style.display = 'none';
                if (backButton) backButton.style.display = 'none';
                if (actionButton) actionButton.disabled = false; 
            } else {
                if (modalTitle) modalTitle.innerText = "Welcome to Hop!";
                if (modalDesc) modalDesc.innerText = "We've highlighted the best card for you, but you can select any eligible option:";
                if (resultContainer) resultContainer.style.display = 'grid'; 
                if (backButton) backButton.style.display = 'block';

                allCards.forEach(card => {
                    const cardElement = document.createElement('div');
                    cardElement.className = `card-option ${card.state}`;
                    cardElement.setAttribute('onclick', 'selectCard(this)');
                    
                    let cardHTML = `<div class="card-title">${card.name}</div>`;
                    if (card.note && card.state !== 'ineligible') {
                        cardHTML += `<div class="card-note">${card.note}</div>`;
                    }
                    if (card.state === 'recommended') {
                        cardHTML += `<div class="recommended-badge">Recommended</div>`;
                    }
                    
                    cardElement.innerHTML = cardHTML;
                    if (resultContainer) resultContainer.appendChild(cardElement);
                });

                const recommendedCard = resultContainer ? resultContainer.querySelector('.card-option.recommended') : null;
                if (recommendedCard) {
                    selectCard(recommendedCard); 
                }
            }

            if (actionButton) {
                actionButton.innerText = buttonText;
                actionButton.setAttribute('onclick', buttonAction);
            }
            
            const modal = document.getElementById('eligibility-modal');
            if (modal) modal.style.display = 'flex';

        } else {
            alert("Registration failed: " + data.message);
        }
    })
    .catch(error => {
        console.error('Database connection error:', error);
    });
}