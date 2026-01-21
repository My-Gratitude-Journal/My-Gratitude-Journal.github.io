# Site Settings
- Add site settings modal
- Offline mode setting
    - Offline mode off by default, able to turn on.
        - Explains what mode does, cautions against turning it on when using public computers.

## UX & Personalization
- **Font Size Settings** — Implement adjustable text size setting for accessibility (small, normal, large). Store preference in localStorage and apply CSS custom properties to scale font sizes throughout the app.
- **Date Format Options** — Allow users to choose date display format (MM/DD/YYYY, DD/MM/YYYY, or relative dates like '2 days ago'). Store preference and update all entry date displays accordingly.
- **Entry Sort Options** — Let users set default sort order for entries: newest first, oldest first, or alphabetical. Store preference and apply when loading entries.

## Privacy & Account Management
- **Delete Account Feature** — Add secure account deletion with confirmation dialog. Should delete user from Firebase Auth and all associated Firestore documents. Optionally allow backup/export before deletion.
- **Password Change Feature** — Allow users to securely update their password. Handle re-encryption of existing entries with new password-derived key and update Firebase Auth password.

## Journaling Features
- **Daily Reminder Notifications** — Implement optional browser notifications reminding users to journal. Allow users to set preferred time of day. Requires user permission and Notification API.
- **Gratitude Prompts Feature** — Provide daily toggle-able prompts or custom prompts to inspire entries. Store library of prompts and rotate daily. Allow users to submit/create custom prompts.
- **Tags/Categories System** — Enable users to add tags to entries and filter/search by them. Store tags with entries in Firestore (encrypted). Add tag management UI and display in entries list.
- **Entry Templates Feature** — Create pre-made entry formats (e.g., '3 things grateful for', gratitude metrics, reflection prompts). Let users select a template when creating new entry. Store template preferences.