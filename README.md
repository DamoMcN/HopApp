# HopApp
A Leap card alternative we are developing for our project managment module in ATU Galway. We aim to improve on the overal system and UI design while adding new and useful features
## Tech Stack
* **Frontend:** HTML5, CSS3, Vanilla JavaScript, Leaflet.js (Map interface)
* **Backend:** PHP, MySQL (WampServer local environment)

---

## Current Focus: Frontend Architecture & Authentication
This branch (`feature/authentication`) introduces a modular, feature-based directory structure to separate client-side logic from server-side scripts, establishing the foundational user interfaces for authentication and user support.

### Directory Structure & Relevant Files

#### 1. `frontend/shared/` (Core Design System)
Contains the global assets and stylesheets that ensure brand consistency across the entire application.
* **`css/main.css`**: The core stylesheet. Handles global CSS variables (colors, typography), base layout resets, reusable form components, standardized button styling, and the styling for the global Floating Action Button (FAB) for help/support.
* **`img/`**: Stores shared graphical assets, including the Hop App Mascot (`HopBunnie.png`) and the virtual card textures (`HopCardTrim.png`).

#### 2. `frontend/auth/` (Authentication Module)
Handles the user onboarding process, securely gathering user details and determining transit eligibility.
* **`SignUp.html`**: The account creation interface. Collects user demographics (Name, DOB, Nationality) and presents a dynamic eligibility modal based on the user's input. Includes a global floating support button.
* **`LogIn.html`**: The user login interface with loading state indicators.
* **`auth.css`**: Scoped styles specifically for the authentication forms, card selection grid, and the eligibility popup modal. Includes keyframe animations for the submit button loading spinner.
* **`auth.js`**: Contains the frontend logic for calculating user age from their Date of Birth and determining Hop Card eligibility (Child, Young Adult, Student, Adult, or Free Travel). Handles the visual selection of cards and the loading spinner UI states.

#### 3. `frontend/support/` (Help & Support Module)
A fully integrated support system merged into the main application styling, replacing previously fragmented code.
* **`support.html`**: The main FAQ and Help interface. Features a dynamic search bar and a responsive layout that perfectly matches the `main.css` global variables.
* **`support.css`**: Scoped styling for the support page. Handles the custom layout of the FAQ list and the 1200px perspective 3D CSS `flip-container` used to transition between questions and answers.
* **`support.js`**: Manages the interactive elements of the support page. Includes a dynamic search filter for the FAQ array, the `showAnswer()` logic to trigger the 3D CSS flip animation, and a smart `goBack()` function that dynamically routes the user either back to the FAQ list or to the Login page depending on their current view state.

---

## Next Steps
* Integrate frontend HTML forms with backend PHP scripts to process user registration and session management.
* Connect the Hop Card eligibility logic to the MySQL database to permanently assign transit profiles to users upon account creation.
* Build out the `frontend/map/` feature directory to integrate Leaflet.js live bus tracking.