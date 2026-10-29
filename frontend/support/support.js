const faqs = [
  {
    question: "How do I apply for a Hop Card?",
    answer: "Create an account, enter your personal details and choose an eligible Hop Card. Follow the steps to complete your application."
  },
  {
    question: "Which Hop Card is right for me?",
    answer: "Hop recommends a card based on your details. You can choose from Adult, Young Adult, Student or Child cards depending on your eligibility."
  },
  {
    question: "How can I top up my Hop Card?",
    answer: "Go to the Top Up section, select an amount and follow the instructions to add credit to your card."
  },
  {
    question: "What should I do if my card is lost?",
    answer: "Report your lost card through the support section. Our team can guide you through the replacement process."
  },
  {
    question: "How can I check my card balance?",
    answer: "Open your Hop account and go to the Card Balance section to view your available balance."
  },
  {
    question: "How do I reset my password?",
    answer: "Select Forgot your password? on the login page and follow the instructions to reset your password."
  }
];

const faqPage = document.getElementById("faqPage");
const answerPage = document.getElementById("answerPage");

function renderQuestions(items) {
  const container = document.getElementById("questions");
  container.innerHTML = "";

  items.forEach(item => {
    const button = document.createElement("button");
    button.className = "question";

    const label = document.createElement("div");
    label.textContent = item.question;

    const arrow = document.createElement("span");
    arrow.textContent = "›";

    button.append(label, arrow);
    button.onclick = () => showAnswer(item);
    container.appendChild(button);
  });

  document.getElementById("empty").classList.toggle("hidden", items.length === 0);
}

function filterQuestions() {
  const search = document.getElementById("search").value.toLowerCase();
  const results = faqs.filter(item =>
    item.question.toLowerCase().includes(search) ||
    item.answer.toLowerCase().includes(search)
  );
  renderQuestions(results);
}

function showAnswer(item) {
  document.getElementById("answerTitle").textContent = item.question;
  document.getElementById("answerText").textContent = item.answer;
  document.getElementById("flipInner").classList.add("flipped");
  window.scrollTo(0, 0);
}

function showFAQ() {
  document.getElementById("flipInner").classList.remove("flipped");
  window.scrollTo(0, 0);
}

function showContact() {
  showAnswer({
    question: "Contact Support",
    answer: "Need more help? Please contact our support team. This feature is a demonstration in the Hop App prototype."
  });
}

function goBack() {
  const flipInner = document.getElementById("flipInner");
  
  if (flipInner.classList.contains("flipped")) {
    // If viewing a specific answer, flip back to the FAQ list
    showFAQ();
  }  else if (document.referrer && new URL(document.referrer).origin === window.location.origin) {
    history.back();   // came from another app page, e.g. the card page
  } else {
    window.location.href = "../auth/index.html";
  }
}
renderQuestions(faqs);