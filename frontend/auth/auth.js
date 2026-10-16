// Calculate age based on DOB string (YYYY-MM-DD)
function calculateAge(dobString) {
    const dob = new Date(dobString);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    return age;
}

// Function to handle card selection visually
function selectCard(cardElement) {
    // Prevent selecting ineligible cards
    if (cardElement.classList.contains('ineligible')) return;
    
    // Remove 'selected' class from all cards
    document.querySelectorAll('.card-option').forEach(el => {
        el.classList.remove('selected');
    });
    
    // Add 'selected' class to the clicked card
    cardElement.classList.add('selected');
    
    // Enable the Create Account button once an option is selected
    document.getElementById('modal-action-btn').disabled = false;
}

// Handle signup form submission
function handleSignup(event) {
    event.preventDefault(); 
    
    const dobInput = document.getElementById('dob').value;
    if (!dobInput) return;
    
    const age = calculateAge(dobInput);
    const isStudent = document.getElementById('is-student').checked;
    
    const allCards = [
        { id: 'adult', name: 'Adult Card', state: 'ineligible', note: '' },
        { id: 'young-adult', name: 'Young Adult', state: 'ineligible', note: '' },
        { id: 'student', name: 'Student Card', state: 'ineligible', note: 'Requires ID' },
        { id: 'child', name: 'Child Card', state: 'ineligible', note: '' }
    ];

    let specialMessage = null;
    let specialTitle = "Welcome to Hop!";
    let buttonText = "Create Account";
    let buttonAction = "window.location.href='LogIn.html'";

    // UPDATED LOGIC: Card states based on age and student status
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
        // Ages 19-25 get Young Adult, regardless of student status
        allCards.find(c => c.id === 'young-adult').state = 'recommended';
        allCards.find(c => c.id === 'adult').state = 'eligible';
    } else {
        // Ages 26-65
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

    resultContainer.innerHTML = ''; 

    // Reset button states for a new submission
    actionButton.disabled = true;

    if (specialMessage) {
        modalTitle.innerText = specialTitle;
        modalDesc.innerText = specialMessage;
        resultContainer.style.display = 'none';
        
        backButton.style.display = 'none';
        actionButton.disabled = false; 
    } else {
        modalTitle.innerText = "Welcome to Hop!";
        modalDesc.innerText = "We've highlighted the best card for you, but you can select any eligible option:";
        resultContainer.style.display = 'grid'; 
        backButton.style.display = 'block';

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
            resultContainer.appendChild(cardElement);
        });

        // Automatically select the recommended card
        const recommendedCard = resultContainer.querySelector('.card-option.recommended');
        if (recommendedCard) {
            selectCard(recommendedCard); 
        }
    }

    actionButton.innerText = buttonText;
    actionButton.setAttribute('onclick', buttonAction);
    document.getElementById('eligibility-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('eligibility-modal').style.display = 'none';
}