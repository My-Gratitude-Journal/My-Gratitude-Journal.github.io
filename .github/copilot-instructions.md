
# Copilot Instructions for AI Coding Agents

## Project Overview
This project is a web-based Gratitude Journal app using HTML, CSS, and JavaScript, with Firebase as the backend for authentication and storage. Data is encrypted client-side before being sent to Firestore. The app is designed for easy deployment on GitHub Pages (Firebase Hosting is also considered).

## Architecture & Key Patterns
- **Frontend:** All code is in the root directory (`index.html`, `app.js`, `style.css`).
- **Backend:** Firebase (Firestore for storage, Auth for user management). No custom backend code.
- **Data Flow:**
	- User logs in/registers with email/password (Firebase Auth).
	- Journal entries are encrypted in-browser (see `encrypt()` in `app.js`) using the user's password as a key, then stored in Firestore.
	- Entries are decrypted client-side for display.
- **Security:**
	- All journal data is encrypted before leaving the browser. The encryption is simple (MVP), but the intent is to keep user data private even from Firebase.
	- The encryption key is the user's password (see `userKey` in `app.js`).

## Developer Workflow
- **No build step:** All files are static and can be served directly.
- **To run locally:** Open `index.html` in a browser. For Firebase features to work, you must provide your own Firebase config in `app.js`.
- **Deployment:**
	- For GitHub Pages: Copy contents of the root directory to the root of the `gh-pages` branch.
	- For Firebase Hosting: Use the root directory as the hosting directory.
- **Adding features:**
	- Keep all logic in `app.js` unless refactoring for scale.
	- Use only client-side JS; do not add server-side code.

## Conventions & Integration
- **Firebase config:** Must be replaced with real project credentials in `app.js`.
- **Encryption:** The current method is for MVP only. If improving, use a strong, standard crypto library.
- **UI/UX:** Minimal, clean, and mobile-friendly (see `style.css`).
- **No tests or CI/CD** are present yet.

## References
- Main files: `index.html`, `app.js`, `style.css`
- Project instructions: `.github/instructions/Project_Instructions.instructions.md`

---
*Last updated: 2026-01-15. AI Please update as the project grows.*
