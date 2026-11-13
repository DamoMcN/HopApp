// FAQs are grouped into collapsible sections. To add a question, add an
// { question, answer } to a section's items. To add a section, add a new
// { id, title, items } (the id just has to be unique and have no spaces).
const faqSections = [
  {
    id: "account",
    title: "Login & Sign up",
    items: [
      {
        question: "How do I apply for a Hop Card?",
        answer: "Create an account on the Sign Up page, enter your personal details and choose an eligible Hop Card. Follow the steps to complete your application."
      },
      {
        question: "Which Hop Card is right for me?",
        answer: "Hop recommends a card based on your details. You can choose from Adult, Young Adult, Student or Child cards depending on your eligibility."
      },
      {
        question: "What password do I need?",
        answer: "Your password must be at least 8 characters and include a digit, an uppercase letter, a lowercase letter and a symbol."
      },
      {
        question: "How do I log in?",
        answer: "Go to the Log In page and enter the email and password you used to sign up."
      },
      {
        question: "How do I reset my password?",
        answer: "Select Forgot your password? on the login page and follow the instructions to reset your password."
      },
      {
        question: "How do I log out?",
        answer: "Open the menu (the three lines at the top left) and choose Log Out at the bottom."
      }
    ]
  },
  {
    id: "topup",
    title: "Top Up",
    items: [
      {
        question: "How can I top up my Hop Card?",
        answer: "Open the menu (the three lines at the top left) and choose Top Up. Drag the dot around the circle to pick an amount, choose a saved card, then press the Top up button."
      },
      {
        question: "How much can I top up?",
        answer: "You can top up between €5 and €100 at a time, in steps of €5."
      },
      {
        question: "How do I save a card?",
        answer: "On the Top Up page, press + Pay with a new card, enter your card and keep Save this card for future top ups ticked. Only the card type, the last 4 digits and the expiry are saved, never the full card number or CVC. To remove a saved card, press Remove next to it."
      },
      {
        question: "What is Pay with wallet (demo)?",
        answer: "It is a simulated wallet payment for this prototype. It adds the amount you chose to your card without contacting any real wallet or bank."
      },
      {
        question: "Why can't I top up my card?",
        answer: "A card that is frozen, or reported lost or stolen, can't be topped up. If your card is frozen, press it on the home page and choose Unfreeze card."
      },
      {
        question: "Where can I see my top ups?",
        answer: "Your balance updates straight away. Every top up is listed under Transactions on your card page."
      },
      {
        question: "How do I set up a recurring top up?",
        answer: "On the Top Up page, press Set up a recurring payment today (or choose Recurring Top Up in the menu). Pick an amount, how often, the day of the first top up and how to pay, then press Review and Confirm."
      },
      {
        question: "How do I change, turn off or cancel a recurring top up?",
        answer: "Open Recurring Top Up from the menu. Press Turn off or Turn on, press Change to pick a new amount, interval or date, or press Cancel recurring top up to remove it. Top ups already made stay on your card."
      },
      {
        question: "When is a recurring top up added?",
        answer: "On each payment day. Automatic top ups show as Auto top up under Transactions. While your card is frozen or the recurring top up is turned off, nothing is charged."
      }
    ]
  },
  {
    id: "card",
    title: "My Card",
    items: [
      {
        question: "How can I check my card balance?",
        answer: "Your balance is shown on the front of your card on the home page. Choose My Card in the menu to get back to it from any page."
      },
      {
        question: "Where can I see my transactions?",
        answer: "Under your card on the home page you will find a Transactions list with your recent top ups and ticket purchases."
      },
      {
        question: "How do I freeze my card?",
        answer: "Press your card on the home page and choose Freeze card. To use it again, press the card and choose Unfreeze card."
      }
    ]
  },
  {
    id: "lost",
    title: "Lost or stolen cards",
    items: [
      {
        question: "What should I do if my card is lost?",
        answer: "If you think you might find it, freeze it first. If it is gone for good, press your card on the home page and choose Report lost. This permanently blocks the card, so you will need a replacement."
      },
      {
        question: "What should I do if my card is stolen?",
        answer: "Press your card on the home page and choose Report stolen straight away. This permanently blocks the card. You may also want to report the theft to the police."
      },
      {
        question: "What is the difference between freezing and reporting a card?",
        answer: "Freezing is temporary: your card stays blocked until you unfreeze it. Reporting it lost or stolen is permanent, so you will need a replacement card."
      },
      {
        question: "How do I get a replacement card?",
        answer: "Use the Contact Support button at the bottom of this page. Replacement cards are not available in the app yet."
      }
    ]
  }
];

const faqPage = document.getElementById("faqPage");
const answerPage = document.getElementById("answerPage");

// ---------- Collapsible FAQ ----------

function makeChevron() {
  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "›";
  return chevron;
}

// A panel that slides open and closed. Put the content in the returned "inner".
function makePanel(id) {
  const panel = document.createElement("div");
  panel.className = "faq-panel";
  panel.id = id;
  const inner = document.createElement("div");
  inner.className = "faq-panel-inner";
  panel.appendChild(inner);
  return { panel, inner };
}

function setOpen(button, panel, open) {
  button.setAttribute("aria-expanded", String(open));
  panel.classList.toggle("is-open", open);
}

// Pressing the button opens its panel, pressing it again closes it
function makeToggle(button, panel, startOpen) {
  button.setAttribute("aria-controls", panel.id);
  setOpen(button, panel, Boolean(startOpen));
  button.addEventListener("click", () => {
    setOpen(button, panel, button.getAttribute("aria-expanded") !== "true");
  });
}

// openAll is used while searching, so the matches are visible straight away
function renderQuestions(sections, openAll) {
  const container = document.getElementById("questions");
  container.innerHTML = "";

  sections.forEach(section => {
    const sectionEl = document.createElement("div");
    sectionEl.className = "faq-section";

    const heading = document.createElement("h3");
    const sectionBtn = document.createElement("button");
    sectionBtn.type = "button";
    sectionBtn.className = "faq-section-btn";
    sectionBtn.id = "faq-btn-" + section.id;

    const title = document.createElement("span");
    title.className = "faq-section-title";
    title.textContent = section.title;

    const count = document.createElement("span");
    count.className = "faq-count";
    count.textContent = section.items.length + (section.items.length === 1 ? " question" : " questions");

    sectionBtn.append(title, count, makeChevron());
    heading.appendChild(sectionBtn);

    const body = makePanel("faq-section-" + section.id);
    body.panel.setAttribute("role", "region");
    body.panel.setAttribute("aria-labelledby", sectionBtn.id);
    body.inner.classList.add("faq-section-body");

    section.items.forEach((item, index) => {
      const itemEl = document.createElement("div");
      itemEl.className = "faq-item";

      const questionHeading = document.createElement("h4");
      const questionBtn = document.createElement("button");
      questionBtn.type = "button";
      questionBtn.className = "faq-q";

      const label = document.createElement("span");
      label.textContent = item.question;
      questionBtn.append(label, makeChevron());
      questionHeading.appendChild(questionBtn);

      const answer = makePanel("faq-answer-" + section.id + "-" + index);
      const answerText = document.createElement("p");
      answerText.className = "faq-a";
      answerText.textContent = item.answer;
      answer.inner.appendChild(answerText);

      makeToggle(questionBtn, answer.panel, false);
      itemEl.append(questionHeading, answer.panel);
      body.inner.appendChild(itemEl);
    });

    makeToggle(sectionBtn, body.panel, openAll);
    sectionEl.append(heading, body.panel);
    container.appendChild(sectionEl);
  });

  // Only show "No matching questions" when there really is nothing to show
  document.getElementById("empty").classList.toggle("hidden", sections.length > 0);
}

function filterQuestions() {
  const search = document.getElementById("search").value.trim().toLowerCase();

  if (!search) {
    renderQuestions(faqSections, false);
    return;
  }

  const results = [];
  faqSections.forEach(section => {
    // Searching for a section name (for example "top up") shows the whole section
    const titleMatches = section.title.toLowerCase().includes(search);
    const items = titleMatches
      ? section.items
      : section.items.filter(item =>
          item.question.toLowerCase().includes(search) ||
          item.answer.toLowerCase().includes(search));

    if (items.length > 0) {
      results.push({ id: section.id, title: section.title, items: items });
    }
  });

  renderQuestions(results, true);
}

// ---------- Contact Support (flips to its own page) ----------

// Support contact details. Leave a value empty ("") if it isn't available.
const SUPPORT_CONTACT = {
  phone: "+353 1 234 5678",
  email: "support@hopapp.ie"
};

function showAnswer(item) {
  document.getElementById("answerTitle").textContent = item.question;
  document.getElementById("answerText").textContent = item.answer;
  document.getElementById("contactOptions").hidden = true;
  document.getElementById("flipInner").classList.add("flipped");
  window.scrollTo(0, 0);
}

function showFAQ() {
  document.getElementById("flipInner").classList.remove("flipped");
  window.scrollTo(0, 0);
}

// One tappable row: "tel:" opens the phone dialler, "mailto:" opens the email app
function contactLink(href, label, value) {
  const link = document.createElement("a");
  link.className = "contact-link";
  link.href = href;

  const small = document.createElement("span");
  small.className = "contact-label";
  small.textContent = label;

  const big = document.createElement("span");
  big.className = "contact-value";
  big.textContent = value;

  link.append(small, big);
  return link;
}

function showContact() {
  const phone = (SUPPORT_CONTACT.phone || "").trim();
  const email = (SUPPORT_CONTACT.email || "").trim();
  const any = phone || email;

  showAnswer({
    question: "Contact Support",
    answer: any
      ? "Need more help? Call or email our support team."
      : "Support contact details aren't available right now. Please try again later."
  });

  const options = document.getElementById("contactOptions");
  options.innerHTML = "";
  if (phone) options.appendChild(contactLink("tel:" + phone.replace(/[^+\d]/g, ""), "Call us", phone));
  if (email) options.appendChild(contactLink("mailto:" + email, "Email us", email));
  options.hidden = !any;
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
renderQuestions(faqSections, false);