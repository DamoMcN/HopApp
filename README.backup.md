# Hop App
A Leap Card alternative developed for our Project Management module at ATU Galway. We aim to improve on the overall system and UI design while adding new and useful features.

## Tech Stack
- **Frontend:** HTML5, CSS3, Vanilla JavaScript, Leaflet.js (Map interface, planned)
- **Backend:** PHP (PDO), MySQL (WampServer local environment)
- **Testing:** Playwright

---

## Current Focus: Hop Card, Top Up and Account Safety
This branch (`feature/card`) builds on the authentication and support modules with the logged-in card experience: viewing the card and balance, topping up, freezing or reporting a card, plus friendlier errors and a collapsible help page.

### What you can do in the app
- **Log in / sign up** with clear, friendly pop-ups for any mistake (see `frontend/auth/`).
- **See your card** with its 8-digit number and live balance on the card face, plus recent transactions.
- **Press the card** to open a drop-down of actions: Freeze / Unfreeze, Report lost, Report stolen.
- **Top up** from the hamburger menu using a circular dial (EUR 5 to EUR 100 in steps of EUR 5), a saved card, or the demo wallet. After a successful top up you are taken back to your card, where the new balance is shown.
- **Get help** from collapsible FAQ sections (Login & Sign up, Top Up, My Card, Lost or stolen cards).

### Payments are in demo mode
`PAYMENTS_MODE` in `backend/auth/topup.php` is `'mock'`. **No real payment provider is contacted and no real money moves.** "Add demo card" only stores a card brand and last 4 digits (never a full card number), and "Pay with wallet (demo)" is a clearly labelled simulated wallet sheet (it deliberately does not copy Apple Pay or Google Pay branding). `charge_payment()` is the single place a real provider (for example Stripe in test mode) would be added later.

---

## Directory Structure & Relevant Files

#### 1. `frontend/shared/` (Core Design System)
- **`css/main.css`**: Global CSS variables (colours, content width), base resets, reusable form components, buttons, the page header and the slide-out menu styling.
- **`js/menu.js`**: Builds the hamburger slide-out menu used on logged-in pages: **My Card**, **Top Up**, **Help & Support** and **Log Out**.
- **`img/`**: Shared images. `HopBunnie.webp` (mascot) and `HopCardTrim.webp` (card texture) are small, optimised versions of the original PNGs, which are kept for reference.

#### 2. `frontend/auth/` (Authentication Module)
- **`index.html`**: Login page.
- **`signup.html`**: Account creation page with an eligibility modal that recommends a card type from the person's age and student status.
- **`auth.css`**: Styles for the auth forms, card picker, and the friendly pop-ups / field error styling.
- **`auth.js`**:
  - Age and card eligibility logic (Child, Young Adult, Student, Adult, Free Travel).
  - One reusable `showNotice()` pop-up replaces browser `alert()` boxes. It explains the problem in plain English, outlines and focuses the field to fix, and lists exactly which password rules are missing.
  - Live "passwords match" hint under Confirm Password.
  - Handles wrong login details, an already-registered email, bad dates of birth, network failures and server errors.

#### 3. `frontend/card/` (Card Page, the app home)
- **`card.html` / `card.css` / `card.js`**: Shows the card with balance and number, the transactions list, and the card actions drop-down. Frozen, lost and stolen cards show a status veil and the menu adapts to the card's state. The page refreshes the balance whenever it is shown (including when returning with the browser back button).

#### 4. `frontend/topup/` (Top Up)
- **`topup.html` / `topup.css` / `topup.js`**: A circular dial slider (drag, tap or use the arrow keys), saved-card list, "Add demo card", and the demo wallet confirmation sheet. Each top-up attempt carries an idempotency key, so a retry after a dropped connection can never credit the money twice.

#### 5. `frontend/support/` (Help & Support)
- **`support.html` / `support.css` / `support.js`**: Collapsible FAQ sections with an accordion for each question, a search box that searches section names, questions and answers (matches open automatically), and a Contact Support page that flips in. To add questions, edit the `faqSections` list at the top of `support.js`.

#### 6. `backend/auth/` (Server-Side PHP)
| File | Purpose |
| --- | --- |
| `signup.php` | Validates input (including that the confirm password matches), hashes the password, checks for an existing email, generates a unique 8-digit card number and creates the user. |
| `login.php` | Verifies credentials and starts the session. Uses one message for "no such email" and "wrong password". |
| `session.php` | Returns the logged-in user's details and wallet balance. |
| `transactions.php` | Returns the logged-in user's recent transactions. |
| `topup.php` | `GET` returns balance and saved cards. `POST` (JSON) supports `add_card` and `top_up` with strict validation (EUR 1 to EUR 500 server limit, idempotency key, active cards only). |
| `card_status.php` | `POST` (JSON) with `freeze`, `unfreeze`, `report_lost` or `report_stolen`. Reported cards are permanently blocked. |
| `logout.php` | Ends the session. |

Server-side rules worth knowing:
- The user is always taken from the **session**, never from the request.
- State-changing endpoints require a JSON `Content-Type` (a simple CSRF guard).
- Balance changes run in a database transaction with a row lock.
- Technical errors are written to the PHP error log, not shown to the user.

#### 7. `database/`
- **`hop_app_db.sql`**: Full schema (includes `saved_cards`, the unique payment reference on `transactions`, and the card status values). **Do not import this into an existing database: it drops and recreates tables.**
- **`topup_migration.sql`**: Adds the `saved_cards` table and a unique key on `transactions.stripe_payment_id`.
- **`card_reports_migration.sql`**: Adds the `reported_lost` and `reported_stolen` card statuses.

#### 8. `tests/`
- **`pages.spec.js`**: Playwright tests for page loading, required fields, validation and card eligibility rules (`npx playwright test`).

---

## Setting Up an Existing Database
If you already have a `hop_app_db` from an earlier branch, run these once in phpMyAdmin (SQL tab), in this order, instead of importing the full dump:
1. `database/topup_migration.sql`
2. `database/card_reports_migration.sql`

Skipping the second one means **Report stolen / Report lost will fail**.

---

## Known Limitations
- **Forgot your password?** shows a "coming soon" pop-up. Password reset is not built yet.
- **Replacement cards** are not available in the app. The FAQ directs people to Contact Support.
- Payments are demo only (see above).
- Future ticket purchases must check `card_status = 'active'` on the server.

## Next Steps
- Replacement card flow after a card is reported lost or stolen.
- Password reset by email.
- Real payment provider in test mode (for example Stripe SetupIntent) behind `charge_payment()`.
- Build the live bus tracking feature using Leaflet.js.
