# Site Settings
- Offline mode setting
    - Offline mode off by default, able to turn on.
        - Explains what mode does, cautions against turning it on when using public computers.

## UX & Personalization
- ✅ **Font Size Settings** — Implemented adjustable text size setting for accessibility (small, normal, large). Preference stored in localStorage and applies CSS custom properties (--base-font-size, --font-scale) to scale fonts throughout the app.
- ✅ **Date Format Options** — Implemented date display format selection (MM/DD/YYYY, DD/MM/YYYY, or relative dates like '2 days ago'). Preference stored and applied via formatDate() utility function. Modal shows full date format even in relative mode for clarity.
- ✅ **Entry Sort Options** — Implemented default sort order for entries: newest first, oldest first, or alphabetical. Preference stored and applied when rendering entries. Real-time preview updates as you change settings.

## Privacy & Account Management
- ✅ **Delete Account Feature** — Implemented secure account deletion with confirmation dialog and data summary. Deletes user from Firebase Auth and all associated Firestore documents. Supports both email/password and Google Sign-in users. Offline data is cleared after deletion.
- ✅ **Password Change Feature** — Implemented secure password change with current password verification. Automatically re-encrypts all existing entries with new password-derived key and updates Firebase Auth password. Only available for email/password users.

## Journaling Features
- **Daily Reminder Notifications** — Implement optional browser notifications reminding users to journal. Allow users to set preferred time of day. Requires user permission and Notification API.
- **Gratitude Prompts Feature** — Provide daily toggle-able prompts or custom prompts to inspire entries. Store library of prompts and rotate daily. Allow users to submit/create custom prompts.
- **Tags/Categories System** — Enable users to add tags to entries and filter/search by them. Store tags with entries in Firestore (encrypted). Add tag management UI and display in entries list.
- **Entry Templates Feature** — Create pre-made entry formats (e.g., '3 things grateful for', gratitude metrics, reflection prompts). Let users select a template when creating new entry. Store template preferences.