const firebaseConfig = {
    apiKey: "AIzaSyAg9MgUfOszU4lujZedZz0cP_H74KrbY1U",
    authDomain: "gratitude-30fbe.firebaseapp.com",
    projectId: "gratitude-30fbe",
    storageBucket: "gratitude-30fbe.appspot.com",
    messagingSenderId: "888516646215",
    appId: "1:888516646215:web:1f3544999e16a4faf2e862"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const USER_KEY_STORAGE = 'gj_user_key';
const LEGACY_KEY_STORAGE = 'gj_user_legacy_key';
const OFFLINE_CACHE_PREFIX = 'gj_offline_entries_';
const PENDING_OPS_PREFIX = 'gj_pending_ops_';
const OFFLINE_PINS_PREFIX = 'gj_offline_pins_';
const OFFLINE_EXCLUDES_PREFIX = 'gj_offline_excludes_';
const PENDING_SETTINGS_PREFIX = 'gj_pending_settings_';
let userKey = sessionStorage.getItem(USER_KEY_STORAGE) || '';
let legacyKey = sessionStorage.getItem(LEGACY_KEY_STORAGE) || '';
let pendingPassword = '';

const SETTINGS_STORAGE_KEY = 'gj_user_settings';
const DEFAULT_SETTINGS = { promptsEnabled: true };
let reminderTimerId = null;

function loadStoredSettings() {
    if (typeof localStorage === 'undefined') return {};
    try {
        const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
        return { ...DEFAULT_SETTINGS, ...stored };
    } catch (err) {
        console.warn('Failed to load settings:', err);
        return { ...DEFAULT_SETTINGS };
    }
}

function saveStoredSettings(nextSettings) {
    if (typeof localStorage === 'undefined') return {};
    const settings = nextSettings || {};
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
        console.warn('Failed to save settings:', err);
    }
    return settings;
}

// Settings that should be stored in Firebase (excludes notification-related settings)
function getFirebaseSettings(settings) {
    return {
        fontSize: settings.fontSize || 'normal',
        dateFormat: settings.dateFormat || 'relative',
        sortOrder: settings.sortOrder || 'newest',
        promptsEnabled: settings.promptsEnabled !== false,
        templatesEnabled: settings.templatesEnabled !== false,
        tagsEnabled: settings.tagsEnabled !== false,
        simpleView: settings.simpleView || false
    };
}

// Settings that should remain local only (notification-related)
function getLocalOnlySettings(settings) {
    return {
        remindersEnabled: settings.remindersEnabled || false,
        reminderTime: settings.reminderTime || '18:00'
    };
}

// Load settings from Firebase; merge with local notification settings
async function loadFirebaseSettings() {
    const user = auth.currentUser;
    if (!user) {
        console.warn('No user logged in; cannot load Firebase settings');
        return loadStoredSettings();
    }

    try {
        const docSnapshot = await db.collection('users').doc(user.uid).get();
        if (docSnapshot.exists && docSnapshot.data().settings) {
            const firebaseSettings = docSnapshot.data().settings;
            const localSettings = loadStoredSettings();
            // Merge: Firebase settings + local notification settings
            const merged = {
                ...DEFAULT_SETTINGS,
                ...firebaseSettings,
                ...getLocalOnlySettings(localSettings)
            };
            // Update local storage with merged settings
            saveStoredSettings(merged);
            return merged;
        } else {
            // No Firebase settings yet; return local settings
            return loadStoredSettings();
        }
    } catch (err) {
        console.warn('Failed to load Firebase settings:', err);
        // Fall back to local settings on error
        return loadStoredSettings();
    }
}

// Get the key for pending settings storage for this user
function pendingSettingsKeyForUser() {
    const user = auth.currentUser;
    return user ? PENDING_SETTINGS_PREFIX + user.uid : null;
}

// Queue settings to be saved when online
function queuePendingSettings(settings) {
    const key = pendingSettingsKeyForUser();
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify(settings));
    } catch (err) {
        console.error('Failed to queue settings:', err);
    }
}

// Get queued settings
function getPendingSettings() {
    const key = pendingSettingsKeyForUser();
    if (!key) return null;
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    } catch (err) {
        console.error('Failed to get pending settings:', err);
        return null;
    }
}

// Clear queued settings
function clearPendingSettings() {
    const key = pendingSettingsKeyForUser();
    if (key) {
        try {
            localStorage.removeItem(key);
        } catch (err) {
            console.error('Failed to clear pending settings:', err);
        }
    }
}

// Flush pending settings if online
async function flushPendingSettings() {
    if (!isOnline()) return;
    const pending = getPendingSettings();
    if (!pending) return;

    const user = auth.currentUser;
    if (!user) return;

    try {
        const firebaseSettings = getFirebaseSettings(pending);
        await db.collection('users').doc(user.uid).set({
            settings: firebaseSettings
        }, { merge: true });
        console.info('Pending settings flushed to Firebase');
        clearPendingSettings();
    } catch (err) {
        console.error('Failed to flush pending settings:', err);
    }
}

// Save settings to Firebase (excludes notification settings)
async function saveFirebaseSettings(settings) {
    const user = auth.currentUser;
    if (!user) {
        console.warn('No user logged in; cannot save Firebase settings');
        return;
    }

    // Queue the settings to be saved
    queuePendingSettings(settings);

    // If online, try to save immediately
    if (isOnline()) {
        try {
            const firebaseSettings = getFirebaseSettings(settings);
            await db.collection('users').doc(user.uid).set({
                settings: firebaseSettings
            }, { merge: true });
            console.info('Settings saved to Firebase');
            clearPendingSettings();
        } catch (err) {
            console.error('Failed to save settings to Firebase (will retry when online):', err);
        }
    } else {
        console.info('Offline: Settings queued and will sync when back online');
    }
}


function notificationsSupported() {
    return typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext !== false;
}

function msUntilNextReminder(timeString) {
    const [hourStr, minuteStr] = (timeString || '18:00').split(':');
    const hours = Math.min(23, Math.max(0, parseInt(hourStr, 10) || 18));
    const minutes = Math.min(59, Math.max(0, parseInt(minuteStr, 10) || 0));

    const now = new Date();
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (next <= now) {
        next.setDate(next.getDate() + 1);
    }
    return Math.max(1000, next.getTime() - now.getTime());
}

function clearReminderTimer() {
    if (reminderTimerId) {
        clearTimeout(reminderTimerId);
        reminderTimerId = null;
    }
}

function showDailyReminderNotification() {
    if (!notificationsSupported() || Notification.permission !== 'granted') return;
    try {
        const notification = new Notification('Time to journal', {
            body: 'Take a minute to add something you are grateful for today.',
            tag: 'gj-daily-reminder',
            renotify: false
        });
        notification.onclick = () => window.focus();
    } catch (err) {
        console.warn('Failed to show notification:', err);
    }
}

async function ensureNotificationPermission() {
    if (!notificationsSupported()) {
        return window.isSecureContext === false ? 'insecure' : 'unsupported';
    }
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    try {
        return await Notification.requestPermission();
    } catch (err) {
        console.warn('Notification permission request failed:', err);
        return 'default';
    }
}

function scheduleReminderFromSettings(settings) {
    clearReminderTimer();
    if (!settings || !settings.remindersEnabled) return;
    if (!notificationsSupported() || Notification.permission !== 'granted') return;

    const delay = msUntilNextReminder(settings.reminderTime || '18:00');
    reminderTimerId = window.setTimeout(() => {
        showDailyReminderNotification();
        const latest = loadStoredSettings();
        scheduleReminderFromSettings(latest);
    }, delay);
}

// Simple encryption (for MVP; use stronger encryption for production)
// Derive and store a hashed key (not the raw password) for the session using PBKDF2+salt
let userSalt = null; // hex string stored per user

function normalizeKey(keyMaybeDerived) {
    const isHexHash = /^[a-f0-9]{64}$/i.test(keyMaybeDerived || '');
    return isHexHash ? keyMaybeDerived : CryptoJS.SHA256(keyMaybeDerived || '').toString();
}

function deriveKeyFromPassword(password, saltHex) {
    if (!password) return '';
    if (saltHex) {
        const salt = CryptoJS.enc.Hex.parse(saltHex);
        return CryptoJS.PBKDF2(password, salt, { keySize: 256 / 32, iterations: 100000 }).toString();
    }
    return normalizeKey(password);
}

function encrypt(text, keyLike) {
    const key = normalizeKey(keyLike);
    return CryptoJS.AES.encrypt(text, key).toString();
}

function tryDecryptWithKey(data, keyLike) {
    const key = normalizeKey(keyLike);
    const bytes = CryptoJS.AES.decrypt(data, key);
    return bytes.toString(CryptoJS.enc.Utf8);
}

function decrypt(data, keyLike) {
    try {
        const primary = tryDecryptWithKey(data, keyLike);
        if (primary) return primary;
    } catch (e) { /* ignore and fall through */ }
    if (legacyKey) {
        try {
            const legacy = tryDecryptWithKey(data, legacyKey);
            if (legacy) return legacy;
        } catch { /* ignore */ }
    }
    return '[Decryption failed]';
}

// Offline cache helpers (store encrypted payloads in localStorage)
const offlineKeyForUser = () => {
    const user = auth.currentUser;
    return user ? `${OFFLINE_CACHE_PREFIX}${user.uid}` : null;
};

const offlinePinsKeyForUser = () => {
    const user = auth.currentUser;
    return user ? `${OFFLINE_PINS_PREFIX}${user.uid}` : null;
};

const offlineExcludesKeyForUser = () => {
    const user = auth.currentUser;
    return user ? `${OFFLINE_EXCLUDES_PREFIX}${user.uid}` : null;
};

const pendingOpsKeyForUser = () => {
    const user = auth.currentUser;
    return user ? `${PENDING_OPS_PREFIX}${user.uid}` : null;
};

const isOnline = () => {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine !== false;
};

function readPendingOps() {
    const key = pendingOpsKeyForUser();
    if (!key) return [];
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
    } catch (err) {
        console.error('Failed to parse pending ops:', err);
        return [];
    }
}

function persistPendingOps(ops) {
    const key = pendingOpsKeyForUser();
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify(ops || []));
    } catch (err) {
        console.error('Failed to persist pending ops:', err);
    }
}

const countersKeyForUser = () => {
    const user = auth.currentUser;
    return user ? `gj_counters_${user.uid}` : null;
};

function loadLocalCounters() {
    const key = countersKeyForUser();
    if (!key) return null;
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.warn('Failed to read local counters:', err);
        return null;
    }
}

function persistLocalCounters({ daysJournaled, totalEntries }) {
    const key = countersKeyForUser();
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify({ daysJournaled, totalEntries }));
    } catch (err) {
        console.warn('Failed to persist local counters:', err);
    }
}

// ========== TAG MANAGEMENT FUNCTIONS ==========

const TAGS_PREFIX = 'gj_tags_';
const ACTIVE_TAG_FILTER_PREFIX = 'gj_active_tag_filter_';

// Get the storage key for tags for the current user
const tagsKeyForUser = () => {
    const user = auth.currentUser;
    return user ? `${TAGS_PREFIX}${user.uid}` : null;
};

// Get the storage key for active tag filters
const activeTagFilterKeyForUser = () => {
    const user = auth.currentUser;
    return user ? `${ACTIVE_TAG_FILTER_PREFIX}${user.uid}` : null;
};

// Get all tags used across all entries (from memory cache)
function getAllTags() {
    if (window._allTags instanceof Set) return Array.from(window._allTags).sort();
    const tags = new Set();
    const entries = window._allEntries || [];
    entries.forEach(entry => {
        if (entry.tags && Array.isArray(entry.tags)) {
            entry.tags.forEach(tag => tags.add(tag.toLowerCase()));
        }
    });
    window._allTags = tags;
    return Array.from(tags).sort();
}

// Add a tag to an entry
function addTagToEntry(tag) {
    if (!tag || typeof tag !== 'string') return;
    const normalized = tag.trim().toLowerCase();
    if (!normalized) return;

    if (!window._currentEntryTags) {
        window._currentEntryTags = [];
    }
    if (!window._currentEntryTags.includes(normalized)) {
        window._currentEntryTags.push(normalized);
    }
    renderCurrentTags();
    updateTagSuggestionList(document.getElementById('tag-input'), 'tag-suggestion-list', window._currentEntryTags);
}

// Remove a tag from the current entry being composed
function removeTagFromEntry(tag) {
    if (!window._currentEntryTags) return;
    window._currentEntryTags = window._currentEntryTags.filter(t => t !== tag.toLowerCase());
    renderCurrentTags();
    updateTagSuggestionList(document.getElementById('tag-input'), 'tag-suggestion-list', window._currentEntryTags);
}

// Render current tags in the form
function renderCurrentTags() {
    const tagsDisplay = document.getElementById('tags-display');
    if (!tagsDisplay) return;

    const tags = window._currentEntryTags || [];
    tagsDisplay.innerHTML = '';

    tags.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center gap-1 px-3 py-1 bg-purple-200 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded-full text-sm font-medium';
        chip.innerHTML = `
            ${tag}
            <button type="button" class="ml-1 text-purple-600 dark:text-purple-300 hover:text-purple-900 dark:hover:text-purple-100" 
                onclick="removeTagFromEntry('${tag}')" aria-label="Remove tag">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
                </svg>
            </button>
        `;
        tagsDisplay.appendChild(chip);
    });
}

// Tag helpers for editing existing entries
const normalizeTag = (tag) => (tag || '').trim().toLowerCase();

function addEditingTag(tag) {
    const normalized = normalizeTag(tag);
    if (!normalized) return;
    if (!window._editingEntryTags) window._editingEntryTags = [];
    if (!window._editingEntryTags.includes(normalized)) {
        window._editingEntryTags.push(normalized);
    }
    renderEditingTags();
    updateTagSuggestionList(document.getElementById('edit-tag-input'), 'edit-tag-suggestion-list', window._editingEntryTags);
}

function removeEditingTag(tag) {
    if (!window._editingEntryTags) return;
    window._editingEntryTags = window._editingEntryTags.filter(t => t !== normalizeTag(tag));
    renderEditingTags();
    updateTagSuggestionList(document.getElementById('edit-tag-input'), 'edit-tag-suggestion-list', window._editingEntryTags);
}

function renderEditingTags() {
    const tagsDisplay = document.getElementById('edit-tags-display');
    if (!tagsDisplay) return;
    const tags = window._editingEntryTags || [];
    tagsDisplay.innerHTML = '';
    tags.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center gap-1 px-3 py-1 bg-purple-200 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded-full text-sm font-medium';
        chip.innerHTML = `
            ${tag}
            <button type="button" class="ml-1 text-purple-600 dark:text-purple-300 hover:text-purple-900 dark:hover:bg-transparent" aria-label="Remove tag"
                onclick="removeEditingTag('${tag}')">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
                </svg>
            </button>
        `;
        tagsDisplay.appendChild(chip);
    });
}

function renderModalViewTags(tags) {
    const container = document.getElementById('modal-entry-tags');
    if (!container) return;

    const settings = JSON.parse(localStorage.getItem('gj_user_settings') || '{}');

    // Hide tags container if tags are disabled
    if (settings.tagsEnabled === false) {
        container.style.display = 'none';
        return;
    }

    container.style.display = '';
    container.innerHTML = '';
    (tags || []).forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center px-3 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded-full text-xs font-semibold';
        chip.textContent = tag;
        container.appendChild(chip);
    });
}

function getTagSuggestions(query, exclude) {
    const needle = (query || '').trim().toLowerCase();
    const excludeSet = new Set((exclude || []).map(normalizeTag));
    return getAllTags()
        .map(normalizeTag)
        .filter(tag => (!needle || tag.includes(needle)) && !excludeSet.has(tag));
}

function updateTagSuggestionList(inputEl, datalistId, excludeTags) {
    if (!inputEl) return;
    const list = document.getElementById(datalistId);
    if (!list) return;
    const suggestions = getTagSuggestions(inputEl.value, excludeTags);
    list.innerHTML = '';
    suggestions.forEach(tag => {
        const option = document.createElement('option');
        option.value = tag;
        list.appendChild(option);
    });
}

// Get active tag filters
function getActiveTagFilters() {
    if (window._activeTagFilters instanceof Set) return window._activeTagFilters;
    const key = activeTagFilterKeyForUser();
    if (!key) {
        window._activeTagFilters = new Set();
        return window._activeTagFilters;
    }
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        window._activeTagFilters = new Set(parsed.map(t => t.toLowerCase()));
        return window._activeTagFilters;
    } catch (err) {
        console.error('Failed to read active tag filters:', err);
        window._activeTagFilters = new Set();
        return window._activeTagFilters;
    }
}

// Persist active tag filters
function persistActiveTagFilters(filters) {
    const key = activeTagFilterKeyForUser();
    if (!key) return;
    try {
        const array = Array.from(filters || []);
        localStorage.setItem(key, JSON.stringify(array));
    } catch (err) {
        console.error('Failed to persist active tag filters:', err);
    }
}

// Toggle a tag filter on/off
function toggleTagFilter(tag) {
    const filters = new Set(getActiveTagFilters());
    const normalized = tag.toLowerCase();
    if (filters.has(normalized)) {
        filters.delete(normalized);
    } else {
        filters.add(normalized);
    }
    window._activeTagFilters = filters;
    persistActiveTagFilters(filters);
    renderTagFilterOptions();
    renderEntries();
}

// Clear all tag filters
function clearTagFilters() {
    window._activeTagFilters = new Set();
    persistActiveTagFilters(new Set());
    renderTagFilterOptions();
    renderEntries();
}

// Render tag filter options in the modal
function renderTagFilterOptions() {
    const container = document.getElementById('tags-filter-options');
    if (!container) return;

    const allTags = getAllTags();
    const activeFilters = getActiveTagFilters();

    container.innerHTML = '';
    if (allTags.length === 0) {
        container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-sm col-span-full">No tags yet. Add tags to entries to filter.</p>';
        return;
    }

    allTags.forEach(tag => {
        const isActive = activeFilters.has(tag.toLowerCase());
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `px-3 py-2 rounded-lg font-medium text-sm transition ${isActive
            ? 'bg-purple-500 text-white dark:bg-purple-600'
            : 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`;
        btn.textContent = tag;
        btn.onclick = () => toggleTagFilter(tag);
        container.appendChild(btn);
    });
}

function queuePendingOp(op) {
    const ops = readPendingOps();
    ops.push(op);
    persistPendingOps(ops);
}

function updatePendingAdd(tempId, updater) {
    const ops = readPendingOps();
    const idx = ops.findIndex(o => o.type === 'add' && o.tempId === tempId);
    if (idx === -1) return;
    const updated = updater(ops[idx]) || {};
    ops[idx] = { ...ops[idx], ...updated };
    persistPendingOps(ops);
}

function removePendingAdd(tempId) {
    const ops = readPendingOps().filter(o => !(o.type === 'add' && o.tempId === tempId));
    persistPendingOps(ops);
}

function replaceTempIdEverywhere(oldId, newId) {
    window._allEntries = (window._allEntries || []).map(e => e.id === oldId ? { ...e, id: newId } : e);
    const ops = readPendingOps().map(op => {
        const next = { ...op };
        if (next.tempId === oldId) next.tempId = newId;
        if (next.id === oldId) next.id = newId;
        return next;
    });
    persistPendingOps(ops);
    syncOfflineCacheFromMemory();
}

async function flushPendingOps() {
    if (!isOnline()) return;
    const ops = readPendingOps();
    if (!ops.length) return;
    const user = auth.currentUser;
    if (!user) return;
    const collectionRef = db.collection('users').doc(user.uid).collection('gratitude');
    const remaining = [];

    // Restore counters from local cache before syncing
    const cachedCounters = loadLocalCounters();
    if (cachedCounters) {
        if (typeof cachedCounters.daysJournaled === 'number') {
            window._daysJournaled = cachedCounters.daysJournaled;
        }
        if (typeof cachedCounters.totalEntries === 'number') {
            window._totalEntries = cachedCounters.totalEntries;
        }
    }
    for (const op of ops) {
        try {
            if (op.type === 'add') {
                const docRef = await collectionRef.add({
                    entry: op.entry,
                    created: op.created ? new Date(op.created) : new Date(),
                    starred: !!op.starred,
                    tags: Array.isArray(op.tags) ? op.tags : [],
                    prompt: op.prompt || null
                });
                replaceTempIdEverywhere(op.tempId, docRef.id);
            } else if (op.type === 'edit') {
                await collectionRef.doc(op.id).update({ entry: op.entry, tags: Array.isArray(op.tags) ? op.tags : [] });
            } else if (op.type === 'delete') {
                await collectionRef.doc(op.id).delete();
            } else if (op.type === 'star') {
                await collectionRef.doc(op.id).update({ starred: !!op.starred });
            }
        } catch (err) {
            console.error('Failed to flush op:', op, err);
            remaining.push(op);
        }
    }
    persistPendingOps(remaining);
    try {
        await db.collection('users').doc(user.uid).set({
            daysJournaled: window._daysJournaled || 0,
            totalEntries: window._totalEntries || (window._allEntries ? window._allEntries.length : 0)
        }, { merge: true });
        persistLocalCounters({ daysJournaled: window._daysJournaled || 0, totalEntries: window._totalEntries || 0 });
    } catch (err) {
        console.error('Failed to sync counters after flush:', err);
    }
    if (!remaining.length) {
        setStatus('Offline changes synced.', 'success');
    }
    updateProgressInfo();
    renderEntries();
    syncOfflineCacheFromMemory();
}

function selectOfflineEntries(entries) {
    const pins = getOfflinePinnedIds();
    const excludes = getOfflineExcludedIds();
    const sorted = [...(entries || [])].sort((a, b) => new Date(b.created) - new Date(a.created));
    const offline = [];
    const seen = new Set();

    // Always keep pinned entries
    for (const e of sorted) {
        if (pins.has(e.id) && !excludes.has(e.id) && !seen.has(e.id)) {
            offline.push(e);
            seen.add(e.id);
        }
    }

    // Always keep favorites
    for (const e of sorted) {
        if (e.starred && !excludes.has(e.id) && !seen.has(e.id)) {
            offline.push(e);
            seen.add(e.id);
        }
    }

    // Add 20 most recent remaining entries
    let recentAdded = 0;
    for (const e of sorted) {
        if (seen.has(e.id) || excludes.has(e.id)) continue;
        if (recentAdded >= 20) break;
        offline.push(e);
        seen.add(e.id);
        recentAdded++;
    }
    return offline;
}

function persistOfflineEntries(entries) {
    const key = offlineKeyForUser();
    if (!key || !entries) return;
    try {
        const activeKey = userKey || legacyKey;
        const payload = entries.map(e => {
            const createdVal = e.created instanceof Date ? e.created : new Date(e.created || Date.now());
            const cipher = e.cipher || encrypt(e.text || '', activeKey);
            return {
                id: e.id,
                entry: cipher,
                created: createdVal.toISOString(),
                starred: !!e.starred,
                tags: Array.isArray(e.tags) ? e.tags : []
            };
        });
        localStorage.setItem(key, JSON.stringify(payload));
        window._offlineCacheIds = new Set(payload.map(item => item.id));
    } catch (err) {
        console.error('Failed to persist offline entries:', err);
    }
}

function loadOfflineEntriesFromStorage() {
    const key = offlineKeyForUser();
    if (!key) return [];
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        const activeKey = userKey || legacyKey;
        const offlineEntries = parsed.map(item => ({
            id: item.id,
            text: decrypt(item.entry, activeKey),
            created: new Date(item.created),
            starred: !!item.starred,
            tags: Array.isArray(item.tags) ? item.tags : [],
            cipher: item.entry
        }));
        window._offlineCacheIds = new Set(parsed.map(item => item.id));
        return offlineEntries;
    } catch (err) {
        console.error('Failed to read offline entries:', err);
        return [];
    }
}

function syncOfflineCacheFromMemory() {
    try {
        const snapshot = selectOfflineEntries(window._allEntries || []);
        persistOfflineEntries(snapshot);
    } catch (err) {
        console.error('Failed to sync offline cache:', err);
    }
}

function getOfflinePinnedIds() {
    if (window._offlinePinnedIds instanceof Set) return window._offlinePinnedIds;
    const key = offlinePinsKeyForUser();
    if (!key) {
        window._offlinePinnedIds = new Set();
        return window._offlinePinnedIds;
    }
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        window._offlinePinnedIds = new Set(parsed);
        return window._offlinePinnedIds;
    } catch (err) {
        console.error('Failed to read offline pins:', err);
        window._offlinePinnedIds = new Set();
        return window._offlinePinnedIds;
    }
}

function persistOfflinePinnedIds(pinSet) {
    const key = offlinePinsKeyForUser();
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify(Array.from(pinSet || [])));
    } catch (err) {
        console.error('Failed to persist offline pins:', err);
    }
}

function getOfflineExcludedIds() {
    if (window._offlineExcludedIds instanceof Set) return window._offlineExcludedIds;
    const key = offlineExcludesKeyForUser();
    if (!key) {
        window._offlineExcludedIds = new Set();
        return window._offlineExcludedIds;
    }
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        window._offlineExcludedIds = new Set(parsed);
        return window._offlineExcludedIds;
    } catch (err) {
        console.error('Failed to read offline excludes:', err);
        window._offlineExcludedIds = new Set();
        return window._offlineExcludedIds;
    }
}

function persistOfflineExcludedIds(excludeSet) {
    const key = offlineExcludesKeyForUser();
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify(Array.from(excludeSet || [])));
    } catch (err) {
        console.error('Failed to persist offline excludes:', err);
    }
}

function toggleOfflineAvailability(entryId) {
    const pins = new Set(getOfflinePinnedIds());
    const excludes = new Set(getOfflineExcludedIds());
    const isCached = (window._offlineCacheIds instanceof Set && window._offlineCacheIds.has(entryId)) || pins.has(entryId);

    let message = '';
    if (isCached) {
        pins.delete(entryId);
        excludes.add(entryId);
        message = 'Offline copy removed for this entry.';
    } else {
        excludes.delete(entryId);
        pins.add(entryId);
        message = 'Entry will stay available offline.';
    }

    window._offlinePinnedIds = pins;
    window._offlineExcludedIds = excludes;
    persistOfflinePinnedIds(pins);
    persistOfflineExcludedIds(excludes);
    syncOfflineCacheFromMemory();
    renderEntries();
    setStatus(message, 'success');
}

function applyFavoriteOfflineLink(entryId, isFavorite) {
    const pins = new Set(getOfflinePinnedIds());
    const excludes = new Set(getOfflineExcludedIds());
    if (isFavorite) {
        pins.add(entryId);
        excludes.delete(entryId);
    } else {
        pins.delete(entryId);
        excludes.add(entryId);
    }
    window._offlinePinnedIds = pins;
    window._offlineExcludedIds = excludes;
    persistOfflinePinnedIds(pins);
    persistOfflineExcludedIds(excludes);
    syncOfflineCacheFromMemory();
}

// Expose for scripts defined before app.js
window.syncOfflineCacheFromMemory = syncOfflineCacheFromMemory;

// Loading overlay helpers (lookup when needed so late-rendered DOM works)
const getLoadingOverlay = () => document.getElementById('loading-overlay');
const showLoading = (msg = 'Loading your entries...') => {
    const overlay = getLoadingOverlay();
    if (!overlay) return;
    const span = overlay.querySelector('span');
    if (span) span.textContent = msg;
    overlay.classList.remove('hidden');
    const appRoot = document.getElementById('app');
    if (appRoot) appRoot.setAttribute('aria-busy', 'true');
};
const hideLoading = () => {
    const overlay = getLoadingOverlay();
    if (!overlay) return;
    overlay.classList.add('hidden');
    const appRoot = document.getElementById('app');
    if (appRoot) appRoot.removeAttribute('aria-busy');
};

// Offline banner helpers
function ensureOfflineBanner() {
    let banner = document.getElementById('offline-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'offline-banner';
        banner.className = 'hidden mb-3 p-3 rounded-lg border text-sm bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200 border-red-200 dark:border-red-700 flex items-center justify-between gap-3';
        const span = document.createElement('span');
        banner.appendChild(span);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'shrink-0 px-3 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-xs font-semibold';
        btn.textContent = 'Retry';
        btn.addEventListener('click', () => {
            if (typeof navigator !== 'undefined' && navigator && navigator.onLine) {
                showLoading('Syncing entries...');
                try { loadEntries(true); } catch { /* ignore */ }
            } else {
                setStatus('Still offline. Retry when back online.', 'info');
            }
        });
        banner.appendChild(btn);
        const appRoot = document.getElementById('app');
        if (appRoot) {
            appRoot.insertBefore(banner, appRoot.firstChild);
        }
    }
    return banner;
}

function showOfflineBanner(message) {
    const banner = ensureOfflineBanner();
    const span = banner.querySelector('span') || banner;
    span.textContent = message || "You're offline. Showing cached entries. Favorites are always available offline.";
    banner.classList.remove('hidden');
}

function hideOfflineBanner() {
    const banner = document.getElementById('offline-banner');
    if (banner) banner.classList.add('hidden');
}

// UI Visibility Helper Functions (must be defined globally for auth handler access)
function applyPromptsVisibility(enabled) {
    const promptSection = document.getElementById('prompts-section');
    if (!promptSection) return;
    promptSection.style.display = enabled ? '' : 'none';
}

function updateDailyPrompt() {
    const promptElement = document.getElementById('daily-prompt');
    if (!promptElement) return;
    promptElement.textContent = getDailyPrompt();
}

function applySimpleViewVisibility(enabled) {
    const filterBar = document.querySelector('.md\\:sticky');
    const tagsLabel = document.querySelector('label[for="tag-input"]');
    const tagInputSection = tagsLabel?.parentElement;
    const tagsFilterBtn = document.getElementById('tags-filter-btn');
    const searchInput = document.getElementById('search-input');
    const dateFilterBtn = document.getElementById('view-calendar-btn');
    const favoritesToggle = document.getElementById('favorites-toggle');

    // Hide/show filter UI
    if (filterBar) filterBar.style.display = enabled ? 'none' : '';
    if (tagsFilterBtn) tagsFilterBtn.style.display = enabled ? 'none' : '';
    if (searchInput) searchInput.style.display = enabled ? 'none' : '';
    if (dateFilterBtn) dateFilterBtn.style.display = enabled ? 'none' : '';
    if (favoritesToggle) favoritesToggle.style.display = enabled ? 'none' : '';

    // Hide tags input in form if enabled
    if (tagInputSection) tagInputSection.style.display = enabled ? 'none' : '';
}

function applyTagsVisibility(enabled) {
    const tagsLabel = document.querySelector('label[for="tag-input"]');
    const tagInputSection = tagsLabel?.parentElement;
    const tagsFilterBtn = document.getElementById('tags-filter-btn');
    const tagsManagementSection = document.getElementById('tags-management-section');
    const editTagInputSection = document.querySelector('label[for="edit-tag-input"]');
    const editTagInputParent = editTagInputSection?.parentElement;

    // Hide/show tags input in form
    if (tagInputSection) tagInputSection.style.display = enabled ? '' : 'none';

    // Hide/show tags filter button
    if (tagsFilterBtn) tagsFilterBtn.style.display = enabled ? '' : 'none';

    // Hide/show tags management section in settings (everything except the toggle)
    if (tagsManagementSection) tagsManagementSection.style.display = enabled ? '' : 'none';

    // Hide/show tags in edit modal
    if (editTagInputParent) editTagInputParent.style.display = enabled ? '' : 'none';

    // Re-render entries to hide/show tags on entry cards
    if (typeof renderEntries === 'function') {
        renderEntries();
    }
}

// Show banner on initial load if offline
document.addEventListener('DOMContentLoaded', () => {
    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
        showOfflineBanner("You're offline. Showing cached entries. Favorites are always available offline.");
    }
});

// React to network changes
window.addEventListener('offline', () => {
    showOfflineBanner("You're offline. Showing cached entries. Favorites are always available offline.");
});
window.addEventListener('online', () => {
    hideOfflineBanner();
    flushPendingOps().then(() => loadEntries(true)).catch(err => console.error('Pending sync failed:', err));
});

// Skeleton placeholders for entries list
function showEntriesSkeleton(count = 3) {
    if (!entriesList) return;
    entriesList.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const li = document.createElement('li');
        li.className = 'bg-gray-100 dark:bg-darkcard/80 rounded px-4 py-3 shadow-sm animate-pulse';
        li.innerHTML = `
            <div class="h-4 w-24 bg-gray-300 dark:bg-gray-700 rounded mb-3"></div>
            <div class="h-4 w-full bg-gray-300 dark:bg-gray-700 rounded mb-2"></div>
            <div class="h-4 w-2/3 bg-gray-300 dark:bg-gray-700 rounded"></div>
        `;
        entriesList.appendChild(li);
    }
}


// Login form
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const showRegisterBtn = document.getElementById('show-register-btn');
const showResetBtn = document.getElementById('show-reset-btn');

// Register form
const regEmailInput = document.getElementById('reg-email');
const regPasswordInput = document.getElementById('reg-password');
const regConfirmPasswordInput = document.getElementById('reg-confirm-password');
const registerBtn = document.getElementById('register-btn');
const showLoginBtn = document.getElementById('show-login-btn');

// Reset form
const resetEmailInput = document.getElementById('reset-email');
const resetBtn = document.getElementById('reset-btn');
const showLoginBtn2 = document.getElementById('show-login-btn2');

// Sections
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const resetForm = document.getElementById('reset-form');
const logoutBtn = document.getElementById('logout-btn');

const authSection = document.getElementById('auth-section');
const journalSection = document.getElementById('journal-section');
const gratitudeForm = document.getElementById('gratitude-form');
const gratitudeInput = document.getElementById('gratitude-input');
const entriesList = document.getElementById('entries-list');

// Function to handle delete account (called from menu or settings)
function openDeleteAccountModal() {
    const user = auth.currentUser;
    if (!user) {
        setStatus('No user logged in.', 'info');
        return;
    }
    const modal = document.getElementById('delete-account-modal');
    const pwGroup = document.getElementById('delete-account-password-group');
    const reauthGroup = document.getElementById('delete-account-reauth-group');
    const pwInput = document.getElementById('delete-account-password');
    const errBox = document.getElementById('delete-account-error');
    const cancelBtn = document.getElementById('delete-account-cancel');
    const confirmBtn = document.getElementById('delete-account-confirm');
    const reauthBtn = document.getElementById('delete-account-reauth-btn');
    const sumEntries = document.getElementById('delete-account-summary-entries');
    const sumFavs = document.getElementById('delete-account-summary-favorites');

    if (!modal || !pwGroup || !reauthGroup || !pwInput || !errBox || !cancelBtn || !confirmBtn || !reauthBtn) {
        console.error('Delete account modal not found');
        return;
    }

    // Reset UI
    errBox.classList.add('hidden');
    errBox.textContent = '';
    pwInput.value = '';

    // Populate summary
    try {
        const total = typeof window._totalEntries === 'number' ? window._totalEntries : ((window._allEntries || []).length || 0);
        const favCount = Array.isArray(window._allEntries) ? window._allEntries.filter(e => e.starred).length : 0;
        if (sumEntries) sumEntries.textContent = String(total);
        if (sumFavs) sumFavs.textContent = String(favCount);
    } catch { }

    // Determine provider
    const providers = (user.providerData || []).map(p => p.providerId);
    const isPasswordProvider = providers.includes('password');

    pwGroup.classList.toggle('hidden', !isPasswordProvider);
    reauthGroup.classList.toggle('hidden', isPasswordProvider);

    // Open modal
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    if (isPasswordProvider) {
        setTimeout(() => pwInput.focus(), 0);
    }

    const closeModal = () => {
        modal.classList.add('hidden');
        document.body.classList.remove('modal-open');
    };

    const showError = (msg) => {
        errBox.textContent = msg || 'Something went wrong.';
        errBox.classList.remove('hidden');
    };

    const clearError = () => {
        errBox.textContent = '';
        errBox.classList.add('hidden');
    };

    const deleteAllUserData = async () => {
        // Delete entries, then user doc, then auth user
        const uid = user.uid;
        // Delete subcollection entries in batches to avoid limits
        const deleteCollectionInBatches = async (collectionRef, batchSize = 300) => {
            while (true) {
                const snap = await collectionRef
                    .orderBy(firebase.firestore.FieldPath.documentId())
                    .limit(batchSize)
                    .get();
                if (snap.empty) break;
                const batch = db.batch();
                snap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
                await new Promise(res => setTimeout(res, 10));
            }
        };
        try {
            await deleteCollectionInBatches(db.collection('users').doc(uid).collection('gratitude'));
        } catch (e) {
            console.error('Failed deleting entries:', e);
            throw e;
        }
        try {
            await db.collection('users').doc(uid).delete();
        } catch (e) {
            console.error('Failed deleting user doc:', e);
            // Continue; user doc might not exist
        }

        // Clear local caches for this user
        try {
            const offlineKey = `${OFFLINE_CACHE_PREFIX}${uid}`;
            const pinsKey = `${OFFLINE_PINS_PREFIX}${uid}`;
            const excludesKey = `${OFFLINE_EXCLUDES_PREFIX}${uid}`;
            const countersKey = `gj_counters_${uid}`;
            const saltKey = `gj_salt_${uid}`;
            const opsKey = `${PENDING_OPS_PREFIX}${uid}`;
            [offlineKey, pinsKey, excludesKey, countersKey, saltKey, opsKey].forEach(k => localStorage.removeItem(k));
        } catch { }

        await user.delete();

        sessionStorage.removeItem(USER_KEY_STORAGE);
        sessionStorage.removeItem(LEGACY_KEY_STORAGE);
        pendingPassword = '';
        legacyKey = '';
        userSalt = null;
        closeModal();
        showAccountDeletedModal();
    };

    const handlePasswordFlow = async () => {
        clearError();
        const pwd = pwInput.value;
        if (!pwd) {
            showError('Please enter your password to continue.');
            return;
        }
        try {
            const credential = firebase.auth.EmailAuthProvider.credential(user.email, pwd);
            await user.reauthenticateWithCredential(credential);
            await deleteAllUserData();
        } catch (e) {
            console.error('Reauth/delete error:', e);
            if (e.code === 'auth/wrong-password') {
                showError('Incorrect password.');
            } else if (e.code === 'auth/user-mismatch' || e.code === 'auth/invalid-credential') {
                showError('Authentication failed. Please try again.');
            } else if (e.code === 'auth/requires-recent-login') {
                showError('Session is too old. Please log in again.');
            } else {
                showError(e.message || 'Error deleting account.');
            }
        }
    };

    const handleProviderFlow = async () => {
        clearError();
        try {
            // Attempt reauth with Google if present, otherwise default to popup with first provider
            let provider = null;
            if (providers.includes('google.com')) {
                provider = new firebase.auth.GoogleAuthProvider();
            }
            if (!provider) {
                // Fallback: try with the first provider by id if supported
                const pid = providers[0];
                if (pid === 'google.com') provider = new firebase.auth.GoogleAuthProvider();
            }
            if (!provider) {
                showError('Unsupported provider for reauthentication. Please log out and log in again, then retry.');
                return;
            }
            await user.reauthenticateWithPopup(provider);
            await deleteAllUserData();
        } catch (e) {
            console.error('Provider reauth/delete error:', e);
            if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
                showError('Reauthentication cancelled.');
            } else if (e.code === 'auth/requires-recent-login') {
                showError('Session is too old. Please log in again.');
            } else {
                showError(e.message || 'Error deleting account.');
            }
        }
    };

    // Wire buttons (one-off handlers per open)
    const onCancel = () => {
        closeModal();
        cancelBtn.removeEventListener('click', onCancel);
        confirmBtn.removeEventListener('click', onConfirm);
        reauthBtn.removeEventListener('click', onReauth);
        modal.removeEventListener('click', onBackdropClick);
    };
    const onConfirm = () => {
        if (isPasswordProvider) handlePasswordFlow(); else handleProviderFlow();
    };
    const onReauth = () => handleProviderFlow();
    const onBackdropClick = (e) => { if (e.target === modal) onCancel(); };

    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    reauthBtn.addEventListener('click', onReauth);
    modal.addEventListener('click', onBackdropClick);
}

// Add manual refresh button for entries
const refreshBtn = document.createElement('button');
refreshBtn.textContent = 'Refresh Entries';
refreshBtn.className = 'px-3 py-1 rounded bg-blue-400 text-white hover:bg-blue-500 text-xs font-semibold mb-2';
refreshBtn.onclick = () => loadEntries(true);
document.getElementById('journal-section').insertBefore(refreshBtn, entriesList);

// Add error and loading UI
let errorMsg = document.getElementById('error-msg');
if (!errorMsg) {
    errorMsg = document.createElement('div');
    errorMsg.id = 'error-msg';
    errorMsg.style.color = 'red';
    errorMsg.style.marginTop = '8px';
    authSection.appendChild(errorMsg);
}
let loadingMsg = document.getElementById('loading-msg');
if (!loadingMsg) {
    loadingMsg = document.createElement('div');
    loadingMsg.id = 'loading-msg';
    loadingMsg.style.color = '#888';
    loadingMsg.style.marginTop = '8px';
    loadingMsg.style.display = 'none';
    loadingMsg.textContent = 'Processing...';
    authSection.appendChild(loadingMsg);
}

// Lightweight status banner for success/info messages
let statusMsg = document.getElementById('status-msg');
let statusTimer = null;
if (!statusMsg) {
    statusMsg = document.createElement('div');
    statusMsg.id = 'status-msg';
    statusMsg.setAttribute('role', 'status');
    statusMsg.setAttribute('aria-live', 'polite');
    statusMsg.style.display = 'none';
    statusMsg.style.marginTop = '8px';
    statusMsg.style.padding = '10px 12px';
    statusMsg.style.borderRadius = '8px';
    statusMsg.style.fontWeight = '600';
    authSection.appendChild(statusMsg);
}

// Debounce helper to cut down on rerenders while typing
const debounce = (fn, delay = 200) => {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), delay);
    };
};

function setStatus(message, type = 'info') {
    if (!statusMsg) return;
    if (statusTimer) {
        clearTimeout(statusTimer);
        statusTimer = null;
    }
    if (!message) {
        statusMsg.style.display = 'none';
        return;
    }
    const palette = {
        success: '#155724',
        info: '#0c4a6e',
        error: '#991b1b'
    };
    const bgPalette = {
        success: '#d4edda',
        info: '#e0f2fe',
        error: '#fee2e2'
    };
    statusMsg.style.color = palette[type] || palette.info;
    statusMsg.style.backgroundColor = bgPalette[type] || bgPalette.info;
    statusMsg.style.border = `1px solid ${(palette[type] || palette.info)}30`;
    statusMsg.textContent = message;
    statusMsg.style.display = 'block';
    // Errors don't auto-dismiss; others auto-clear after a short delay
    if (type !== 'error') {
        statusTimer = setTimeout(() => {
            statusMsg.style.display = 'none';
            statusTimer = null;
        }, 4000);
    }
}

// Favorite filter toggle
window._showFavoritesOnly = false;
const favoritesToggle = document.getElementById('favorites-toggle');
if (favoritesToggle) {
    favoritesToggle.onclick = () => {
        window._showFavoritesOnly = !window._showFavoritesOnly;
        favoritesToggle.textContent = window._showFavoritesOnly ? '★ Show All Entries' : '★ Show Favorites Only';
        favoritesToggle.setAttribute('aria-pressed', String(window._showFavoritesOnly));
        renderEntries();
    };
    favoritesToggle.setAttribute('aria-pressed', 'false');
}

// Show/hide forms
showRegisterBtn.onclick = () => {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
    resetForm.style.display = 'none';
    errorMsg.textContent = '';
    setStatus('');
};
showLoginBtn.onclick = () => {
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    resetForm.style.display = 'none';
    errorMsg.textContent = '';
    setStatus('');
};
showLoginBtn2.onclick = () => {
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    resetForm.style.display = 'none';
    errorMsg.textContent = '';
    setStatus('');
};
showResetBtn.onclick = () => {
    loginForm.style.display = 'none';
    registerForm.style.display = 'none';
    resetForm.style.display = 'block';
    errorMsg.textContent = '';
    setStatus('');
};

// Google Sign-In logic
const googleLoginBtn = document.getElementById('google-login-btn');
googleLoginBtn.onclick = async () => {
    errorMsg.textContent = '';
    loadingMsg.style.display = 'block';
    googleLoginBtn.disabled = true;
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const cred = await auth.signInWithPopup(provider);
        // For Google users, use UID-based encryption (zero-knowledge, secure)
        // Note: Entries created with Google login are separate from email/password entries
        const uid = cred.user.uid;
        pendingPassword = uid; // Use UID as encryption key
        legacyKey = normalizeKey(uid);
        sessionStorage.setItem(LEGACY_KEY_STORAGE, legacyKey);
        // Clear any stale derived key; will derive once salt is loaded
        userKey = '';
        sessionStorage.removeItem(USER_KEY_STORAGE);
        setStatus('Logged in with Google! Loading your journal...', 'success');
        showLoading('Loading your entries...');
        showEntriesSkeleton();
    } catch (e) {
        if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
            errorMsg.textContent = e.message;
            console.error('Google login error:', e);
        }
    }
    loadingMsg.style.display = 'none';
    googleLoginBtn.disabled = false;
};

// Login logic
loginBtn.onclick = async () => {
    errorMsg.textContent = '';
    loadingMsg.style.display = 'block';
    loginBtn.disabled = true;
    const email = emailInput.value;
    const password = passwordInput.value;
    if (!email || !password) {
        errorMsg.textContent = 'Please enter both email and password.';
        loadingMsg.style.display = 'none';
        loginBtn.disabled = false;
        return;
    }
    try {
        const cred = await auth.signInWithEmailAndPassword(email, password);
        if (!cred.user.emailVerified) {
            errorMsg.textContent = 'Please verify your email before logging in.';
            await auth.signOut();
        } else {
            // Use UID as encryption key (same for all auth methods)
            const uid = cred.user.uid;
            pendingPassword = uid;
            legacyKey = normalizeKey(uid);
            sessionStorage.setItem(LEGACY_KEY_STORAGE, legacyKey);
            // Clear any stale derived key; will use UID directly
            userKey = '';
            sessionStorage.removeItem(USER_KEY_STORAGE);
            setStatus('Logged in! Loading your journal...', 'success');
            showLoading('Loading your entries...');
            showEntriesSkeleton();
        }
    } catch (e) {
        errorMsg.textContent = e.message;
        console.error('Login error:', e);
    }
    loadingMsg.style.display = 'none';
    loginBtn.disabled = false;
};

// Registration logic
registerBtn.onclick = async () => {
    errorMsg.textContent = '';
    loadingMsg.style.display = 'block';
    registerBtn.disabled = true;
    const email = regEmailInput.value;
    const password = regPasswordInput.value;
    const confirmPassword = regConfirmPasswordInput.value;
    if (!email || !password || !confirmPassword) {
        errorMsg.textContent = 'Please fill in all fields.';
        loadingMsg.style.display = 'none';
        registerBtn.disabled = false;
        return;
    }
    if (password !== confirmPassword) {
        errorMsg.textContent = 'Passwords do not match.';
        loadingMsg.style.display = 'none';
        registerBtn.disabled = false;
        return;
    }
    try {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        await cred.user.sendEmailVerification();
        errorMsg.style.color = 'red';
        setStatus('Registration successful! Check your email to verify, then log in.', 'success');
        // Optionally, sign out immediately after registration
        await auth.signOut();
    } catch (e) {
        errorMsg.style.color = 'red';
        errorMsg.textContent = e.message;
        console.error('Registration error:', e);
    }
    loadingMsg.style.display = 'none';
    registerBtn.disabled = false;
};

// Password reset logic
resetBtn.onclick = async () => {
    errorMsg.textContent = '';
    loadingMsg.style.display = 'block';
    resetBtn.disabled = true;
    const email = resetEmailInput.value;
    if (!email) {
        errorMsg.textContent = 'Please enter your email.';
        loadingMsg.style.display = 'none';
        resetBtn.disabled = false;
        return;
    }
    try {
        await auth.sendPasswordResetEmail(email);
        errorMsg.style.color = 'red';
        setStatus('Password reset email sent! Check your inbox for the link.', 'success');
    } catch (e) {
        errorMsg.style.color = 'red';
        errorMsg.textContent = e.message;
        console.error('Password reset error:', e);
    }
    loadingMsg.style.display = 'none';
    resetBtn.disabled = false;
};

logoutBtn.onclick = () => {
    sessionStorage.removeItem(USER_KEY_STORAGE);
    sessionStorage.removeItem(LEGACY_KEY_STORAGE);
    pendingPassword = '';
    legacyKey = '';
    userSalt = null;
    auth.signOut();
    hideLoading();
};

auth.onAuthStateChanged(async user => {
    const exportBtn = document.getElementById('export-csv-btn');
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    if (user) {
        authSection.style.display = 'none';
        journalSection.style.display = 'block';
        showLoading('Loading your entries...');
        showEntriesSkeleton();
        // Show export buttons
        if (exportBtn) exportBtn.style.display = '';
        if (exportPdfBtn) exportPdfBtn.style.display = '';

        // Initialize user document only if it doesn't exist (avoid resetting existing counter) and ensure salt
        try {
            const userRef = db.collection('users').doc(user.uid);
            const snap = await userRef.get();
            let salt = null;
            if (!snap.exists) {
                salt = CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
                await userRef.set({ daysJournaled: 0, keySalt: salt }, { merge: true });
                window._daysJournaled = 0;
            } else {
                const data = snap.data();
                window._daysJournaled = data.daysJournaled || 0;
                salt = data.keySalt;
                if (!salt) {
                    salt = CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
                    await userRef.set({ keySalt: salt }, { merge: true });
                }
            }
            userSalt = salt;
        } catch (err) {
            console.error('Error initializing user doc (possibly offline):', err);
            // If offline or Firestore unavailable, try to load salt from localStorage
            const cachedSalt = localStorage.getItem(`gj_salt_${user.uid}`);
            if (cachedSalt) {
                userSalt = cachedSalt;
            } else {
                // Generate a temporary salt; will sync when online
                userSalt = CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
            }
            window._daysJournaled = 0; // Will be synced when online
        }

        // Cache the salt for offline use
        if (userSalt) {
            localStorage.setItem(`gj_salt_${user.uid}`, userSalt);
        }

        // Prime offline pin cache for this user
        window._offlinePinnedIds = getOfflinePinnedIds();
        window._offlineExcludedIds = getOfflineExcludedIds();

        // Derive userKey from UID (all auth methods use UID as encryption key)
        if (!userKey) {
            const uid = user.uid;
            if (uid) {
                userKey = normalizeKey(uid);
                sessionStorage.setItem(USER_KEY_STORAGE, userKey);
                pendingPassword = '';
            } else {
                setStatus('Unable to determine user ID. Please log in again.', 'error');
                await auth.signOut();
                hideLoading();
                return;
            }
        }

        try {
            await flushPendingOps();
        } catch (err) {
            console.error('Failed flushing offline ops on login:', err);
        }

        try {
            await flushPendingSettings();
        } catch (err) {
            console.error('Failed flushing pending settings on login:', err);
        }

        // Load and apply user settings from Firebase (with local notification settings)
        const settings = await loadFirebaseSettings();
        if (settings.simpleView) {
            applySimpleViewVisibility(true);
        }
        if (settings.tagsEnabled === false) {
            applyTagsVisibility(false);
        }
        if (settings.promptsEnabled === false) {
            applyPromptsVisibility(false);
        } else {
            updateDailyPrompt();
        }
        if (settings.templatesEnabled === false) {
            applyTemplateVisibility(false);
        }
        initTemplateSelector();

        // Read most recent entries
        await loadEntries(true);
        logoutBtn.style.display = 'inline-block';
    } else {
        authSection.style.display = 'block';
        journalSection.style.display = 'none';
        entriesList.innerHTML = '';
        logoutBtn.style.display = 'none';
        // Clear cached entries
        window._allEntries = [];
        window._offlinePinnedIds = new Set();
        window._offlineExcludedIds = new Set();
        window._offlineCacheIds = new Set();
        sessionStorage.removeItem(USER_KEY_STORAGE);
        sessionStorage.removeItem(LEGACY_KEY_STORAGE);
        pendingPassword = '';
        legacyKey = '';
        userSalt = null;
        hideLoading();
        // Hide export buttons
        if (exportBtn) exportBtn.style.display = 'none';
        if (exportPdfBtn) exportPdfBtn.style.display = 'none';
    }

    // Bind backdrop-close for simple modals (no custom handler needed)
    bindModalBackdropClose(document.getElementById('edit-modal'));
    bindModalBackdropClose(document.getElementById('delete-account-modal'));
    bindModalBackdropClose(document.getElementById('privacy-modal'));
});

// Account Deleted Modal Handler
function showAccountDeletedModal() {
    const deletedModal = document.getElementById('account-deleted-modal');
    const closeBtn = document.getElementById('account-deleted-close');

    if (deletedModal) {
        deletedModal.classList.remove('hidden');

        const handleClose = () => {
            deletedModal.classList.add('hidden');
            // Redirect or refresh to show login screen
            window.location.reload();
        };

        closeBtn.addEventListener('click', handleClose);
        // Also allow clicking the modal to close (for accessibility)
        deletedModal.addEventListener('click', (e) => {
            if (e.target === deletedModal) handleClose();
        });
    }
}

gratitudeForm.onsubmit = async (e) => {
    e.preventDefault();
    const entry = gratitudeInput.value.trim();
    if (!entry) return;
    const tagInputEl = document.getElementById('tag-input');
    if (tagInputEl) {
        const pendingTag = tagInputEl.value.trim();
        if (pendingTag) {
            addTagToEntry(pendingTag);
            tagInputEl.value = '';
        }
    }
    const encrypted = encrypt(entry, userKey);
    const created = new Date();
    created.setMilliseconds(0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const entriesSnapshot = window._allEntries || [];

    // Check if user already has an entry today
    const existingTodayEntry = entriesSnapshot.some(e => {
        const eDate = e.created instanceof Date ? e.created : new Date(e.created);
        eDate.setHours(0, 0, 0, 0);
        return eDate.toISOString().slice(0, 10) === todayStr;
    });

    // Build local entry with temp id, including tags
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const tags = window._currentEntryTags || [];
    // Save the prompt with the entry if prompts are enabled
    const settings = loadStoredSettings();
    const promptText = settings.promptsEnabled ? getDailyPrompt() : null;
    const newEntry = {
        id: tempId,
        text: entry,
        created,
        starred: false,
        tags: tags,
        cipher: encrypted,
        prompt: promptText
    };

    if (!existingTodayEntry) {
        window._daysJournaled = (window._daysJournaled || 0) + 1;
    }
    window._totalEntries = (window._totalEntries || 0) + 1;
    persistLocalCounters({ daysJournaled: window._daysJournaled, totalEntries: window._totalEntries });

    gratitudeInput.value = '';
    window._currentEntryTags = [];
    renderCurrentTags();
    window._allEntries = [newEntry, ...entriesSnapshot];
    if (!window._allEntriesLoaded) {
        window._allEntries = window._allEntries.slice(0, 20);
    }
    window._allTags = null; // Clear cache so tags will be recalculated
    syncOfflineCacheFromMemory();
    updateProgressInfo();
    renderEntries();

    const persistRemote = async () => {
        const docRef = await db.collection('users')
            .doc(auth.currentUser.uid)
            .collection('gratitude')
            .add({
                entry: encrypted,
                created,
                starred: false,
                tags: tags,
                prompt: promptText || null
            });

        replaceTempIdEverywhere(tempId, docRef.id);
        await db.collection('users').doc(auth.currentUser.uid).set({
            daysJournaled: window._daysJournaled,
            totalEntries: window._totalEntries
        }, { merge: true });
    };

    if (isOnline()) {
        try {
            await persistRemote();
        } catch (err) {
            console.error('Failed to save entry online, queuing:', err);
            queuePendingOp({ type: 'add', tempId, entry: encrypted, created: created.toISOString(), starred: false, tags: tags, prompt: promptText || null });
            setStatus('Entry saved offline. It will sync when you are back online.', 'info');
        }
    } else {
        queuePendingOp({ type: 'add', tempId, entry: encrypted, created: created.toISOString(), starred: false, tags: tags, prompt: promptText || null });
        setStatus('Entry saved offline. It will sync when you are back online.', 'info');
    }
};

// Progress info (streaks, total)
function updateProgressInfo() {
    const entries = window._allEntries || [];
    const streakCountEl = document.getElementById('streak-count');
    const longestStreakEl = document.getElementById('longest-streak');
    const daysJournaledEl = document.getElementById('total-days-journaled');
    const totalEntriesEl = document.getElementById('total-entries');

    const computedCounters = computeCountersFromEntries(entries);
    if ((window._daysJournaled || 0) < computedCounters.daysJournaled) {
        window._daysJournaled = computedCounters.daysJournaled;
    }
    if ((window._totalEntries || 0) < computedCounters.totalEntries) {
        window._totalEntries = computedCounters.totalEntries;
    }

    if (daysJournaledEl) {
        daysJournaledEl.textContent = window._daysJournaled || '0';
    }

    if (totalEntriesEl) {
        totalEntriesEl.textContent = window._totalEntries || '0';
    }

    persistLocalCounters({ daysJournaled: window._daysJournaled || 0, totalEntries: window._totalEntries || 0 });

    if (!entries.length) {
        streakCountEl.textContent = '0';
        longestStreakEl.textContent = '0';
        return;
    }
    // Sort by date ascending
    const sorted = [...entries].sort((a, b) => a.created - b.created);
    let streak = 1, longest = 1;
    let currentStreak = 1;
    let prevDate = null;
    let today = new Date();
    today.setHours(0, 0, 0, 0);
    let streakActive = false;
    for (let i = 0; i < sorted.length; i++) {
        const d = new Date(sorted[i].created);
        d.setHours(0, 0, 0, 0);
        if (i === 0) {
            prevDate = d;
            if (+d === +today) streakActive = true;
            continue;
        }
        const diff = (d - prevDate) / (1000 * 60 * 60 * 24);
        if (diff === 1) {
            currentStreak++;
            longest = Math.max(longest, currentStreak);
        } else if (diff > 1) {
            currentStreak = 1;
        }
        prevDate = d;
        if (+d === +today) streakActive = true;
    }
    streakCountEl.textContent = streakActive ? currentStreak : 0;
    longestStreakEl.textContent = longest;
}

// Calendar view logic
window._currentView = 'list';

async function loadEntries() {
    if (!userKey && !legacyKey) {
        setStatus('Enter your password to view entries.', 'info');
        return;
    }
    showLoading('Loading your entries...');
    // Use cache unless forced refresh
    if (window._allEntries && !arguments[0]) {
        updateProgressInfo();
        renderEntries();
        if (window._currentView === 'calendar') {
            renderCalendarView();
        }
        hideLoading();
        return;
    }
    try {
        // Load user data to get counters
        const userDoc = await db.collection('users').doc(auth.currentUser.uid).get();
        window._daysJournaled = userDoc.exists ? (userDoc.data().daysJournaled || 0) : 0;
        window._totalEntries = userDoc.exists ? (userDoc.data().totalEntries || 0) : 0;
        persistLocalCounters({ daysJournaled: window._daysJournaled, totalEntries: window._totalEntries });
        const snap = await db.collection('users')
            .doc(auth.currentUser.uid)
            .collection('gratitude')
            .orderBy('created', 'desc')
            .limit(20)
            .get();
        window._allEntries = [];
        window._allEntriesLoaded = false;  // Set flag to false since we only loaded limited entries
        const activeKey = userKey || legacyKey;
        snap.forEach(doc => {
            const data = doc.data();
            window._allEntries.push({
                id: doc.id,
                text: decrypt(data.entry, activeKey),
                created: data.created && data.created.toDate ? data.created.toDate() : (data.created instanceof Date ? data.created : new Date(data.created)),
                starred: !!data.starred,
                tags: data.tags || [],
                cipher: data.entry,
                prompt: data.prompt || null
            });
        });
        // Fetch ALL favorites and merge so they are always available
        try {
            const favSnap = await db.collection('users')
                .doc(auth.currentUser.uid)
                .collection('gratitude')
                .where('starred', '==', true)
                .get();
            const byId = new Map(window._allEntries.map(e => [e.id, e]));
            favSnap.forEach(doc => {
                if (byId.has(doc.id)) return;
                const data = doc.data();
                byId.set(doc.id, {
                    id: doc.id,
                    text: decrypt(data.entry, activeKey),
                    created: data.created && data.created.toDate ? data.created.toDate() : (data.created instanceof Date ? data.created : new Date(data.created)),
                    starred: true,
                    cipher: data.entry,
                    prompt: data.prompt || null
                });
            });
            window._allEntries = Array.from(byId.values())
                .sort((a, b) => new Date(b.created) - new Date(a.created));
        } catch (favErr) {
            console.warn('Could not load favorites separately:', favErr);
        }

        const computedCounters = computeCountersFromEntries(window._allEntries);
        if ((window._daysJournaled || 0) < computedCounters.daysJournaled) {
            window._daysJournaled = computedCounters.daysJournaled;
        }
        if ((window._totalEntries || 0) < computedCounters.totalEntries) {
            window._totalEntries = computedCounters.totalEntries;
        }
        persistLocalCounters({ daysJournaled: window._daysJournaled, totalEntries: window._totalEntries });

        syncOfflineCacheFromMemory();
        updateProgressInfo();
        renderEntries();
        if (window._currentView === 'calendar') {
            renderCalendarView();
        }
        // We fetched successfully, ensure offline banner is hidden
        hideOfflineBanner();
    } catch (err) {
        console.error('Error loading entries, attempting offline cache:', err);
        const offline = loadOfflineEntriesFromStorage();
        if (offline.length) {
            window._allEntries = offline;
            window._allEntriesLoaded = true;
            window._offlineCacheIds = new Set(offline.map(e => e.id));
            const counters = computeCountersFromEntries(offline);
            window._daysJournaled = counters.daysJournaled;
            window._totalEntries = counters.totalEntries;
            persistLocalCounters({ daysJournaled: window._daysJournaled, totalEntries: window._totalEntries });
            setStatus('You are viewing offline entries.', 'info');
            showOfflineBanner("You're offline. Showing cached entries. Favorites are always available offline.");
            updateProgressInfo();
            renderEntries();
            if (window._currentView === 'calendar') {
                renderCalendarView();
            }
        } else {
            setStatus('Unable to load entries. Check your connection.', 'info');
        }
    } finally {
        hideLoading();
    }
}

// Fetch all entries (for export/counting, no limit)
// Fetch entries with cursor-based pagination
async function fetchEntriesBatch(startAt = 0, limit = 20) {
    try {
        let query = db.collection('users')
            .doc(auth.currentUser.uid)
            .collection('gratitude')
            .orderBy('created', 'desc');

        // If startAt > 0, we need to skip the first N entries
        // Since offset isn't available, we'll fetch startAt + limit and slice
        const allDocsNeeded = startAt + limit;
        const snap = await query.limit(allDocsNeeded).get();

        const entries = [];
        const activeKey = userKey || legacyKey;
        let index = 0;

        snap.forEach(doc => {
            // Only process documents after the startAt index
            if (index >= startAt) {
                const data = doc.data();
                entries.push({
                    id: doc.id,
                    text: decrypt(data.entry, activeKey),
                    created: data.created && data.created.toDate ? data.created.toDate() : (data.created instanceof Date ? data.created : new Date(data.created)),
                    starred: !!data.starred,
                    tags: data.tags || [],
                    prompt: data.prompt || null
                });
            }
            index++;
        });

        // Return only up to 'limit' entries
        return entries.slice(0, limit);
    } catch (e) {
        console.error('Error fetching entries batch:', e);
        return [];
    }
}

// Legacy function for backward compatibility (used by exports)
async function fetchAllEntries() {
    try {
        const snap = await db.collection('users')
            .doc(auth.currentUser.uid)
            .collection('gratitude')
            .orderBy('created', 'desc')
            .get();
        const allEntries = [];
        const activeKey = userKey || legacyKey;
        snap.forEach(doc => {
            const data = doc.data();
            allEntries.push({
                id: doc.id,
                text: decrypt(data.entry, activeKey),
                created: data.created && data.created.toDate ? data.created.toDate() : (data.created instanceof Date ? data.created : new Date(data.created)),
                starred: !!data.starred,
                tags: data.tags || [],
                prompt: data.prompt || null
            });
        });
        return allEntries;
    } catch (e) {
        console.error('Error fetching all entries:', e);
        return [];
    }
}

// Toggle favorite flag in Firestore (optimistic UI handled separately)
async function toggleStarEntry(entryId, star) {
    await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('gratitude')
        .doc(entryId)
        .update({ starred: star });
}

function renderEntries() {
    let entries = window._allEntries || [];
    const offlineCachedIds = window._offlineCacheIds instanceof Set ? window._offlineCacheIds : new Set();
    const offlinePinnedIds = getOfflinePinnedIds();
    updateShowAllEntriesBtn();

    // Apply sorting based on user preference
    const SETTINGS_STORAGE_KEY = 'gj_user_settings';
    let sortOrder = 'newest';
    try {
        const settings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
        sortOrder = settings.sortOrder || 'newest';
    } catch (e) {
        console.error('Error loading sort preference:', e);
    }

    // Sort entries based on preference
    if (sortOrder === 'oldest') {
        entries = [...entries].sort((a, b) => {
            const dateA = a.created instanceof Date ? a.created : new Date(a.created);
            const dateB = b.created instanceof Date ? b.created : new Date(b.created);
            return dateA - dateB;
        });
    } else if (sortOrder === 'alphabetical') {
        entries = [...entries].sort((a, b) => {
            return a.text.localeCompare(b.text);
        });
    } else {
        // Default: newest first
        entries = [...entries].sort((a, b) => {
            const dateA = a.created instanceof Date ? a.created : new Date(a.created);
            const dateB = b.created instanceof Date ? b.created : new Date(b.created);
            return dateB - dateA;
        });
    }

    // Disable 'Show All Entries' button if all entries are already shown
    function updateShowAllEntriesBtn() {
        const viewListBtn = document.getElementById('view-list-btn');
        const dateFilter = document.getElementById('date-filter');
        const searchInput = document.getElementById('search-input');
        const activeTagFilters = getActiveTagFilters();
        const isFiltered = (dateFilter && dateFilter.value) || (searchInput && searchInput.value.trim()) || window._showFavoritesOnly || (activeTagFilters && activeTagFilters.size > 0);
        if (viewListBtn) {
            viewListBtn.disabled = !isFiltered;
            viewListBtn.classList.toggle('opacity-50', !isFiltered);
            viewListBtn.classList.toggle('cursor-not-allowed', !isFiltered);
        }
    }
    const searchInput = document.getElementById('search-input');
    const dateFilter = document.getElementById('date-filter');
    const keyword = (searchInput && searchInput.value.trim().toLowerCase()) || '';
    const dateVal = dateFilter && dateFilter.value;
    if (window._showFavoritesOnly) {
        entries = entries.filter(e => e.starred);
    }
    if (keyword) {
        entries = entries.filter(e => e.text.toLowerCase().includes(keyword));
    }
    if (dateVal) {
        console.log('Filtering by date:', dateVal);
        entries = entries.filter(e => {
            if (!e.created) return false;
            const entryDate = e.created instanceof Date ? e.created : new Date(e.created);
            // Compare year, month, and day to avoid timezone issues
            const filterDate = new Date(dateVal + 'T00:00:00'); // Parse as local time
            const match = entryDate.getFullYear() === filterDate.getFullYear() &&
                entryDate.getMonth() === filterDate.getMonth() &&
                entryDate.getDate() === filterDate.getDate();
            if (match) {
                console.log('Found matching entry for date:', entryDate.toLocaleDateString());
            }
            return match;
        });
        console.log('After date filter, entries count:', entries.length);
    }
    // Apply tag filtering
    const activeTagFilters = getActiveTagFilters();
    if (activeTagFilters.size > 0) {
        entries = entries.filter(e => {
            const entryTags = (e.tags || []).map(t => t.toLowerCase());
            return Array.from(activeTagFilters).some(filter => entryTags.includes(filter));
        });
    }
    entriesList.innerHTML = '';
    entries.forEach(e => {
        const li = document.createElement('li');
        li.className = "bg-gray-100 dark:bg-darkcard text-gray-800 dark:text-gray-100 rounded px-4 py-3 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer hover:shadow-md transition-shadow";

        // Make card clickable (but not the buttons)
        li.onclick = (event) => {
            // Don't trigger if clicking on a button
            if (event.target.closest('button')) return;
            openEntryModal(e);
        };

        const isOfflineReady = offlineCachedIds.has(e.id);
        const isOfflinePinned = offlinePinnedIds.has(e.id);

        // Date stamp - use formatDate utility
        const dateSpan = document.createElement('span');
        if (e.created) {
            dateSpan.textContent = window._formatDate ? window._formatDate(e.created) : new Date(e.created).toLocaleDateString();
        } else {
            dateSpan.textContent = '';
        }
        dateSpan.className = "text-xs text-gray-500 dark:text-gray-400 mr-3 min-w-[90px] font-mono";

        const metaWrap = document.createElement('div');
        metaWrap.className = "flex items-center gap-2";
        metaWrap.appendChild(dateSpan);
        if (isOfflineReady) {
            const offlineChip = document.createElement('span');
            offlineChip.className = "px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200 border border-green-200 dark:border-green-700";
            offlineChip.textContent = 'Offline';
            offlineChip.title = 'This entry is stored for offline access';
            metaWrap.appendChild(offlineChip);
        }

        // Entry text (support multiline and decode URL-encoded newlines)
        const entryText = document.createElement('span');
        entryText.className = "flex-1 whitespace-pre-line";
        let displayText = e.text;
        try {
            displayText = decodeURIComponent(displayText);
        } catch { }
        entryText.innerText = displayText;

        // Create a wrapper for text and tags
        const textWrapper = document.createElement('div');
        textWrapper.className = "flex-1 flex flex-col gap-2";

        // Display saved prompt if it exists
        if (e.prompt) {
            const promptDisplay = document.createElement('div');
            promptDisplay.className = "text-sm italic text-green-700 dark:text-green-400 mb-1";
            promptDisplay.textContent = `Prompt: ${e.prompt}`;
            textWrapper.appendChild(promptDisplay);
        }

        textWrapper.appendChild(entryText);

        // Add tags display if entry has tags and tags are enabled
        const settings = JSON.parse(localStorage.getItem('gj_user_settings') || '{}');
        if (e.tags && e.tags.length > 0 && settings.tagsEnabled !== false) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = "flex flex-wrap gap-1";
            e.tags.forEach(tag => {
                const tagChip = document.createElement('span');
                tagChip.className = "inline-block px-2 py-1 bg-purple-200 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded text-xs font-medium cursor-pointer hover:bg-purple-300 dark:hover:bg-purple-800 transition";
                tagChip.textContent = tag;
                tagChip.title = `Filter by tag: ${tag}`;
                tagChip.onclick = (e) => {
                    e.stopPropagation();
                    toggleTagFilter(tag);
                };
                tagsContainer.appendChild(tagChip);
            });
            textWrapper.appendChild(tagsContainer);
        }

        // Star button
        const starBtn = document.createElement('button');
        starBtn.innerHTML = e.starred ? '★' : '☆';
        starBtn.title = e.starred ? 'Unstar' : 'Star';
        starBtn.className = `px-2 py-1 rounded text-lg font-bold ${e.starred ? 'text-yellow-400' : 'text-gray-400'} hover:text-yellow-500`;
        starBtn.setAttribute('aria-pressed', String(e.starred));
        starBtn.setAttribute('aria-label', e.starred ? 'Unfavorite entry' : 'Mark entry as favorite');
        starBtn.onclick = () => optimisticToggleStar(e.id, !e.starred);
        // Optimistic UI for starring an entry
        function optimisticToggleStar(entryId, newStarValue) {
            // Update local cache
            if (!window._allEntries) return;
            const entry = window._allEntries.find(e => e.id === entryId);
            if (!entry) return;
            const prevStar = entry.starred;
            entry.starred = newStarValue;
            applyFavoriteOfflineLink(entryId, newStarValue);
            renderEntries();

            const wasTemp = entryId.startsWith('temp_');
            if (wasTemp) {
                updatePendingAdd(entryId, () => ({ starred: newStarValue }));
                return;
            }

            if (!isOnline()) {
                queuePendingOp({ type: 'star', id: entryId, starred: newStarValue });
                setStatus('Favorite change saved offline. It will sync when you are back online.', 'info');
                return;
            }

            // Update Firestore in background
            toggleStarEntry(entryId, newStarValue).catch(() => {
                entry.starred = prevStar;
                renderEntries();
                syncOfflineCacheFromMemory();
                alert('Failed to update favorite. Please try again.');
            });
        }

        // Buttons container
        const btns = document.createElement('div');
        btns.className = "flex gap-2 mt-2 sm:mt-0";

        const offlineBtn = document.createElement('button');
        offlineBtn.innerHTML = (isOfflineReady || isOfflinePinned)
            ? '<i class="fa-solid fa-cloud-arrow-down"></i><span class="icon" aria-hidden="true"><svg class="w-3 h-3 inline" viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg></span>'
            : '<i class="fa-solid fa-cloud"></i><span class="icon" aria-hidden="true"><svg class="w-3 h-3 inline" viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg></span>';
        offlineBtn.className = (isOfflineReady || isOfflinePinned)
            ? "btn-icon-expand px-3 py-1 rounded bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-100 text-xs font-semibold border border-green-200 dark:border-green-700"
            : "btn-icon-expand px-3 py-1 rounded bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100 text-xs font-semibold";
        offlineBtn.title = (isOfflineReady || isOfflinePinned) ? 'Remove offline copy' : 'Save this entry for offline viewing';
        offlineBtn.onclick = () => toggleOfflineAvailability(e.id);
        btns.appendChild(starBtn);
        btns.appendChild(offlineBtn);
        // Edit button
        const editBtn = document.createElement('button');
        editBtn.innerHTML = '<i class="fa-solid fa-pen"></i><span class="icon" aria-hidden="true"><svg class="w-3 h-3 inline" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></span>';
        editBtn.className = "btn-icon-expand px-3 py-1 rounded bg-yellow-400 text-gray-900 hover:bg-yellow-500 text-xs font-semibold";
        editBtn.onclick = (event) => {
            event.stopPropagation();
            openEditModal(e.id, e.text);
        };
        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i><span class="icon" aria-hidden="true"><svg class="w-3 h-3 inline" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></span>';
        deleteBtn.className = "btn-icon-expand px-3 py-1 rounded bg-red-500 text-white hover:bg-red-700 text-xs font-semibold";
        deleteBtn.onclick = () => deleteEntry(e.id);
        btns.appendChild(editBtn);
        btns.appendChild(deleteBtn);

        // Layout: [meta/date] [entry text and tags] [buttons]
        li.appendChild(metaWrap);
        li.appendChild(textWrapper);
        li.appendChild(btns);
        entriesList.appendChild(li);
    });
    // Progress info (streaks, total)
    function updateProgressInfo() {
        const entries = window._allEntries || [];
        const streakCountEl = document.getElementById('streak-count');
        const longestStreakEl = document.getElementById('longest-streak');
        const totalEntriesEl = document.getElementById('total-entries');
        if (!entries.length) {
            streakCountEl.textContent = '0';
            longestStreakEl.textContent = '0';
            totalEntriesEl.textContent = '0';
            return;
        }
        // Sort by date ascending
        const sorted = [...entries].sort((a, b) => a.created - b.created);
        let streak = 1, longest = 1;
        let currentStreak = 1;
        let prevDate = null;
        let today = new Date();
        today.setHours(0, 0, 0, 0);
        let streakActive = false;
        for (let i = 0; i < sorted.length; i++) {
            const d = new Date(sorted[i].created);
            d.setHours(0, 0, 0, 0);
            if (i === 0) {
                prevDate = d;
                if (+d === +today) streakActive = true;
                continue;
            }
            const diff = (d - prevDate) / (1000 * 60 * 60 * 24);
            if (diff === 1) {
                currentStreak++;
                longest = Math.max(longest, currentStreak);
            } else if (diff > 1) {
                currentStreak = 1;
            }
            prevDate = d;
            if (+d === +today) streakActive = true;
        }
        streakCountEl.textContent = streakActive ? currentStreak : 0;
        longestStreakEl.textContent = longest;
        totalEntriesEl.textContent = entries.length;
    }
    // Calendar view logic
    window._currentView = 'list';
    const viewListBtn = document.getElementById('view-list-btn');
    const viewCalendarBtn = document.getElementById('view-calendar-btn');
    const calendarModal = document.getElementById('calendar-modal');
    if (calendarModal && calendarModal.parentElement !== document.body) {
        document.body.appendChild(calendarModal);
    }
    const closeCalendarBtn = document.getElementById('close-calendar-btn');

    if (viewListBtn && viewCalendarBtn && calendarModal && closeCalendarBtn) {
        viewListBtn.onclick = () => {
            window._currentView = 'list';
            calendarModal.classList.add('hidden');
            // Clear date filter and search to show all entries
            const dateFilter = document.getElementById('date-filter');
            const searchInput = document.getElementById('search-input');
            if (dateFilter) dateFilter.value = '';
            if (searchInput) searchInput.value = '';
            clearTagFilters();
            window._showFavoritesOnly = false;
            const favoritesToggle = document.getElementById('favorites-toggle');
            if (favoritesToggle) favoritesToggle.textContent = '★ Show Favorites Only';
            renderEntries();
            updateShowAllEntriesBtn();
        };
        viewCalendarBtn.onclick = () => {
            window._currentView = 'calendar';
            renderCalendarView();
            calendarModal.classList.remove('hidden');
            const closeBtn = document.getElementById('close-calendar-btn');
            if (closeBtn) closeBtn.focus();
        };
        closeCalendarBtn.onclick = () => {
            calendarModal.classList.add('hidden');
            window._currentView = 'list';
        };
        // Close calendar modal when clicking outside
        bindModalBackdropClose(calendarModal, () => {
            calendarModal.classList.add('hidden');
            window._currentView = 'list';
        });
    }

    // Show/hide Load More button
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
        // Show button only if:
        // 1. We have 20 entries (suggesting there might be more)
        // 2. We're not filtering (no search, date filter, or favorites only)
        // 3. We haven't loaded all entries yet
        const allEntriesCount = window._allEntries ? window._allEntries.length : 0;
        const activeTagFilters = getActiveTagFilters();
        const isFiltered = (dateVal) || (keyword) || (window._showFavoritesOnly) || (activeTagFilters && activeTagFilters.size > 0);
        const shouldShow = allEntriesCount >= 20 && !isFiltered && !window._allEntriesLoaded;

        if (shouldShow) {
            loadMoreBtn.classList.remove('hidden');
        } else {
            loadMoreBtn.classList.add('hidden');
        }
    }

    function renderCalendarView() {
        const calendarView = document.getElementById('calendar-view');
        if (!calendarView) return;

        // For calendar, we need to show ALL entries, not just the loaded 20
        // So we'll use window._allEntries if all are loaded, otherwise fetch them
        (async () => {
            const entries = window._allEntriesLoaded ? (window._allEntries || []) : (await fetchAllEntries() || []);

            // Build a map of dates with entries
            const dateMap = {};
            entries.forEach(e => {
                const d = new Date(e.created);
                d.setHours(0, 0, 0, 0);
                const key = d.toISOString().slice(0, 10);
                if (!dateMap[key]) dateMap[key] = [];
                dateMap[key].push(e);
            });
            // Find min/max entry months
            let minMonth = null, maxMonth = null;
            if (entries.length) {
                const dates = entries.map(e => new Date(e.created));
                dates.sort((a, b) => a - b);
                minMonth = new Date(dates[0].getFullYear(), dates[0].getMonth(), 1);
                maxMonth = new Date(dates[dates.length - 1].getFullYear(), dates[dates.length - 1].getMonth(), 1);
            }
            // Track current calendar month in window._calendarMonth
            if (!window._calendarMonth) {
                window._calendarMonth = new Date();
                window._calendarMonth.setDate(1);
            }
            // Clamp to min/max
            if (minMonth && window._calendarMonth < minMonth) window._calendarMonth = new Date(minMonth);
            if (maxMonth && window._calendarMonth > maxMonth) window._calendarMonth = new Date(maxMonth);
            const year = window._calendarMonth.getFullYear();
            const month = window._calendarMonth.getMonth();
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            const daysInMonth = lastDay.getDate();
            // Build calendar grid
            let html = `<div class="grid grid-cols-7 gap-1 sm:gap-2">`;
            // Weekday headers
            const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            weekdays.forEach(wd => {
                html += `<div class="text-xs sm:text-sm font-bold text-gray-500 dark:text-gray-400 text-center">${wd}</div>`;
            });
            // Pad first week (disabled days)
            for (let i = 0; i < firstDay.getDay(); i++) {
                html += `<button disabled class="rounded px-1 py-2 sm:px-2 sm:py-3 w-full h-14 sm:h-16 bg-gray-100 dark:bg-gray-800 opacity-40 cursor-not-allowed"></button>`;
            }
            // Days
            for (let d = 1; d <= daysInMonth; d++) {
                const dateObj = new Date(year, month, d);
                dateObj.setHours(0, 0, 0, 0);
                const key = dateObj.toISOString().slice(0, 10);
                const hasEntry = !!dateMap[key];
                let btnClass = hasEntry
                    ? 'bg-primary text-white hover:bg-blue-600 dark:hover:bg-blue-400'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-500 opacity-60 cursor-not-allowed';
                let disabled = hasEntry ? '' : 'disabled';
                html += `<button class="rounded px-1 py-2 sm:px-2 sm:py-3 text-base sm:text-lg font-semibold w-full h-14 sm:h-16 flex flex-col items-center justify-center gap-1 ${btnClass}" data-date="${key}" ${disabled}>${d}${hasEntry ? `<span class='block text-xs sm:text-sm leading-tight'>(${dateMap[key].length})</span>` : ''}</button>`;
            }
            html += `</div>`;
            calendarView.innerHTML = html;
            // Update month label and prev/next buttons
            const label = document.getElementById('calendar-month-label');
            if (label) label.textContent = window._calendarMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
            const prevBtn = document.getElementById('calendar-prev-month');
            const nextBtn = document.getElementById('calendar-next-month');
            if (prevBtn) prevBtn.disabled = minMonth && (window._calendarMonth.getFullYear() === minMonth.getFullYear() && window._calendarMonth.getMonth() === minMonth.getMonth());
            if (nextBtn) nextBtn.disabled = maxMonth && (window._calendarMonth.getFullYear() === maxMonth.getFullYear() && window._calendarMonth.getMonth() === maxMonth.getMonth());
            // Add click listeners to calendar days
            Array.from(calendarView.querySelectorAll('button[data-date]:not([disabled])')).forEach(btn => {
                btn.onclick = () => {
                    const selectedDate = btn.getAttribute('data-date');
                    console.log('Calendar date clicked:', selectedDate);
                    document.getElementById('date-filter').value = selectedDate;
                    console.log('Date filter set to:', document.getElementById('date-filter').value);
                    calendarModal.classList.add('hidden');
                    window._currentView = 'calendar'; // Stay in calendar filter mode

                    // When filtering by date, ensure we have all entries loaded
                    if (!window._allEntriesLoaded) {
                        console.log('Not all entries loaded, fetching...');
                        (async () => {
                            window._allEntries = await fetchAllEntries();
                            console.log('Fetched all entries:', window._allEntries.length);
                            window._allEntriesLoaded = true;
                            console.log('About to render entries with filter:', selectedDate);
                            renderEntries();
                        })();
                    } else {
                        console.log('All entries already loaded, rendering with filter:', selectedDate);
                        renderEntries();
                    }
                };
            });
            // Add prev/next handlers
            if (prevBtn) prevBtn.onclick = () => {
                if (minMonth && (window._calendarMonth > minMonth)) {
                    window._calendarMonth.setMonth(window._calendarMonth.getMonth() - 1);
                    renderCalendarView();
                }
            };
            if (nextBtn) nextBtn.onclick = () => {
                if (maxMonth && (window._calendarMonth < maxMonth)) {
                    window._calendarMonth.setMonth(window._calendarMonth.getMonth() + 1);
                    renderCalendarView();
                }
            };
        })();
    }
}

// Reusable helper to bind backdrop-click-to-close for modals
function bindModalBackdropClose(modalEl, onClose) {
    if (!modalEl || modalEl.dataset.backdropBound) return;
    modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) {
            if (typeof onClose === 'function') {
                onClose();
            } else {
                modalEl.classList.add('hidden');
                if (document.body.classList.contains('modal-open')) {
                    document.body.classList.remove('modal-open');
                }
            }
        }
    });
    modalEl.dataset.backdropBound = '1';
}

// Attach search and date filter listeners
window.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const dateFilter = document.getElementById('date-filter');
    const exportBtn = document.getElementById('export-csv-btn');
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    const debouncedRenderEntries = debounce(renderEntries, 200);
    if (searchInput) searchInput.addEventListener('input', debouncedRenderEntries);
    if (dateFilter) dateFilter.addEventListener('input', renderEntries);
    if (exportBtn) exportBtn.addEventListener('click', exportEntriesCSV);
    if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportEntriesPDF);

    // Attach view switcher and calendar modal listeners after DOM loaded
    const viewListBtn = document.getElementById('view-list-btn');
    const viewCalendarBtn = document.getElementById('view-calendar-btn');
    const calendarModal = document.getElementById('calendar-modal');
    const closeCalendarBtn = document.getElementById('close-calendar-btn');
    if (viewListBtn && viewCalendarBtn && calendarModal && closeCalendarBtn) {
        viewListBtn.onclick = () => {
            window._currentView = 'list';
            calendarModal.classList.add('hidden');
            renderEntries();
        };
        viewCalendarBtn.onclick = () => {
            window._currentView = 'calendar';
            renderCalendarView();
            calendarModal.classList.remove('hidden');
            const closeBtn = document.getElementById('close-calendar-btn');
            if (closeBtn) closeBtn.focus();
        };
        closeCalendarBtn.onclick = () => {
            calendarModal.classList.add('hidden');
            window._currentView = 'list';
        };
        bindModalBackdropClose(calendarModal, () => {
            calendarModal.classList.add('hidden');
            window._currentView = 'list';
        });
    }

    // Wire PDF Settings modal controls
    const settingsModal = document.getElementById('pdf-settings-modal');
    const saveBtn = document.getElementById('pdf-settings-save');
    const cancelBtn = document.getElementById('pdf-settings-cancel');
    const defaultsBtn = document.getElementById('pdf-settings-defaults');
    const errorMsg = document.getElementById('pdf-settings-error');

    const showPdfError = (msg) => {
        if (errorMsg) {
            errorMsg.textContent = msg;
            errorMsg.classList.remove('hidden');
        }
    };
    const clearPdfError = () => {
        if (errorMsg) {
            errorMsg.textContent = '';
            errorMsg.classList.add('hidden');
        }
    };

    if (settingsModal && saveBtn && cancelBtn && defaultsBtn) {
        cancelBtn.onclick = () => {
            clearPdfError();
            settingsModal.classList.add('hidden');

            // Restore PDF preview if it was open
            if (window.pdfPreviewData) {
                const { blobUrl, filename, onClose } = window.pdfPreviewData;
                window.pdfPreviewData = null;
                showPdfPreview(blobUrl, filename, onClose);
            }
        };
        defaultsBtn.onclick = () => {
            const s = DEFAULT_PDF_SETTINGS;
            setPdfSettings(s);
            populatePdfSettingsForm(s);
            clearPdfError();
        };
        saveBtn.onclick = () => {
            clearPdfError();
            const s = readPdfSettingsForm();

            // Validate date range format
            if (s.dateFrom && s.dateTo) {
                const fromDate = new Date(s.dateFrom);
                const toDate = new Date(s.dateTo);
                if (fromDate > toDate) {
                    showPdfError('Start date is before end date.');
                    // Scroll error to top of modal
                    if (errorMsg) {
                        errorMsg.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                    return;
                }
            }

            // Validate that there are entries in the selected date range
            if (s.dateFrom || s.dateTo) {
                const fromDate = s.dateFrom ? new Date(s.dateFrom) : null;
                const toDate = s.dateTo ? new Date(s.dateTo) : null;
                const entriesToCheck = window._allEntries || [];

                const entriesInRange = entriesToCheck.filter(e => {
                    const entryDate = e.created ? new Date(e.created) : null;
                    if (!entryDate) return true;
                    if (fromDate && entryDate < fromDate) return false;
                    if (toDate) {
                        const endOfDay = new Date(toDate);
                        endOfDay.setDate(endOfDay.getDate() + 1);
                        if (entryDate >= endOfDay) return false;
                    }
                    return true;
                });

                if (!entriesInRange.length) {
                    showPdfError('No entries found in the selected date range.');
                    // Scroll error to top of modal
                    if (errorMsg) {
                        errorMsg.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                    return;
                }
            }

            setPdfSettings(s);
            settingsModal.classList.add('hidden');

            // Refresh PDF preview with the new settings if it was open
            if (window.pdfPreviewData) {
                const { blobUrl, filename, onClose, refreshPreview } = window.pdfPreviewData;
                window.pdfPreviewData = null;
                if (typeof refreshPreview === 'function') {
                    if (typeof onClose === 'function') onClose();
                    refreshPreview();
                } else {
                    showPdfPreview(blobUrl, filename, onClose);
                }
            }
        };

        // Toggle two-column option when book mode changes
        const bookModeCheckbox = document.getElementById('pdf-book-mode');
        if (bookModeCheckbox) {
            bookModeCheckbox.addEventListener('change', (e) => {
                const twoColumnCheckbox = document.getElementById('pdf-two-column');
                if (twoColumnCheckbox) {
                    twoColumnCheckbox.disabled = !e.target.checked;
                    if (!e.target.checked) {
                        twoColumnCheckbox.checked = false;
                    }
                }
            });
        }

        // Close PDF settings when clicking outside
        bindModalBackdropClose(settingsModal, () => cancelBtn?.click());
    }
});

// PDF Settings state
const DEFAULT_PDF_SETTINGS = {
    format: 'letter',
    orientation: 'portrait',
    margin: 10,
    layout: 'comfortable',
    showHeader: true,
    customTitle: '',
    colorStyle: false,
    favoritesOnly: false,
    dateFrom: '',
    dateTo: '',
    bookMode: false,
    twoColumn: false
};

function getPdfSettings() {
    try {
        const raw = localStorage.getItem('pdfSettings');
        if (!raw) return { ...DEFAULT_PDF_SETTINGS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_PDF_SETTINGS, ...parsed };
    } catch {
        return { ...DEFAULT_PDF_SETTINGS };
    }
}

function setPdfSettings(s) {
    localStorage.setItem('pdfSettings', JSON.stringify(s));
}

function populatePdfSettingsForm(s) {
    const f = (id) => document.getElementById(id);
    const pageSize = f('pdf-page-size');
    const orientation = f('pdf-orientation');
    const margin = f('pdf-margin');
    const layout = f('pdf-layout');
    const showHeader = f('pdf-show-header');
    const customTitle = f('pdf-custom-title');
    const colorStyle = f('pdf-color-style');
    const favoritesOnly = f('pdf-favorites-only');
    const dateFrom = f('pdf-date-from');
    const dateTo = f('pdf-date-to');
    const bookMode = f('pdf-book-mode');
    const twoColumn = f('pdf-two-column');
    if (pageSize) pageSize.value = s.format;
    if (orientation) orientation.value = s.orientation;
    if (margin) margin.value = String(s.margin);
    if (layout) layout.value = s.layout;
    if (showHeader) showHeader.checked = !!s.showHeader;
    if (customTitle) customTitle.value = s.customTitle || '';
    if (colorStyle) colorStyle.checked = !!s.colorStyle;
    if (favoritesOnly) favoritesOnly.checked = !!s.favoritesOnly;
    if (dateFrom) dateFrom.value = s.dateFrom || '';
    if (dateTo) dateTo.value = s.dateTo || '';
    if (bookMode) bookMode.checked = !!s.bookMode;
    if (twoColumn) twoColumn.checked = !!s.twoColumn;
    // Disable two-column option if not in book mode
    if (twoColumn) twoColumn.disabled = !s.bookMode;
}

function readPdfSettingsForm() {
    const f = (id) => document.getElementById(id);
    const pageSize = f('pdf-page-size');
    const orientation = f('pdf-orientation');
    const margin = f('pdf-margin');
    const layout = f('pdf-layout');
    const showHeader = f('pdf-show-header');
    const customTitle = f('pdf-custom-title');
    const colorStyle = f('pdf-color-style');
    const favoritesOnly = f('pdf-favorites-only');
    const dateFrom = f('pdf-date-from');
    const dateTo = f('pdf-date-to');
    const bookMode = f('pdf-book-mode');
    const twoColumn = f('pdf-two-column');
    return {
        format: pageSize ? pageSize.value : DEFAULT_PDF_SETTINGS.format,
        orientation: orientation ? orientation.value : DEFAULT_PDF_SETTINGS.orientation,
        margin: margin ? Number(margin.value) : DEFAULT_PDF_SETTINGS.margin,
        layout: layout ? layout.value : DEFAULT_PDF_SETTINGS.layout,
        showHeader: showHeader ? !!showHeader.checked : DEFAULT_PDF_SETTINGS.showHeader,
        customTitle: customTitle ? (customTitle.value || '').trim() : DEFAULT_PDF_SETTINGS.customTitle,
        colorStyle: colorStyle ? !!colorStyle.checked : DEFAULT_PDF_SETTINGS.colorStyle,
        favoritesOnly: favoritesOnly ? !!favoritesOnly.checked : DEFAULT_PDF_SETTINGS.favoritesOnly,
        dateFrom: dateFrom ? (dateFrom.value || '').trim() : DEFAULT_PDF_SETTINGS.dateFrom,
        dateTo: dateTo ? (dateTo.value || '').trim() : DEFAULT_PDF_SETTINGS.dateTo,
        bookMode: bookMode ? !!bookMode.checked : DEFAULT_PDF_SETTINGS.bookMode,
        twoColumn: (twoColumn && bookMode) ? (!!twoColumn.checked && !!bookMode.checked) : DEFAULT_PDF_SETTINGS.twoColumn
    };
}

function openPdfSettings() {
    const s = getPdfSettings();
    populatePdfSettingsForm(s);
    const modal = document.getElementById('pdf-settings-modal');
    if (modal) modal.classList.remove('hidden');
}
// Expose for index.html menu script
window.openPdfSettings = openPdfSettings;

function exportEntriesPDF() {
    exportEntriesPDFAsync();
}

async function exportEntriesPDFAsync() {
    try {
        // Fetch all entries for export (not just the limited 20)
        const allEntries = await fetchAllEntries();
        if (!allEntries || !allEntries.length) {
            setStatus('No entries to export.', 'error');
            return;
        }

        const settings = getPdfSettings();
        const userSettings = JSON.parse(localStorage.getItem('gj_user_settings') || '{}');
        const tagsEnabled = userSettings.tagsEnabled !== false;

        // Filter by favorites if enabled
        let entries = allEntries;
        if (settings.favoritesOnly) {
            entries = allEntries.filter(e => e.starred);
            if (!entries.length) {
                setStatus('No starred entries to export.', 'error');
                return;
            }
        }

        // Filter by date range if specified
        if (settings.dateFrom || settings.dateTo) {
            const fromDate = settings.dateFrom ? new Date(settings.dateFrom) : null;
            const toDate = settings.dateTo ? new Date(settings.dateTo) : null;

            entries = entries.filter(e => {
                const entryDate = e.created ? new Date(e.created) : null;
                if (!entryDate) return true;
                if (fromDate && entryDate < fromDate) return false;
                if (toDate) {
                    // Include the entire day, so add 1 day to toDate for comparison
                    const endOfDay = new Date(toDate);
                    endOfDay.setDate(endOfDay.getDate() + 1);
                    if (entryDate >= endOfDay) return false;
                }
                return true;
            });
            if (!entries.length) {
                setStatus('No entries found in the selected date range.', 'error');
                return;
            }
        }

        // Prefer styled HTML → PDF via html2pdf if available
        const canUseHtml2pdf = !!(window.html2pdf);
        if (canUseHtml2pdf && !settings.bookMode) {
            // Build a temporary printable container with Tailwind styles
            const container = document.createElement('div');
            container.id = 'pdf-export-container';
            container.className = 'p-8 bg-white text-gray-800';

            // Header
            const header = document.createElement('div');
            header.className = 'mb-6 text-center';
            const title = document.createElement('h1');
            title.className = 'text-3xl font-extrabold';
            title.textContent = (settings.customTitle && settings.customTitle.trim()) ? settings.customTitle.trim() : 'My Gratitude Journal';
            const subtitle = document.createElement('p');
            subtitle.className = 'text-sm text-gray-500';
            // Determine date range
            const sorted = [...entries].sort((a, b) => new Date(a.created) - new Date(b.created));
            const start = sorted[0]?.created ? new Date(sorted[0].created) : null;
            const end = sorted[sorted.length - 1]?.created ? new Date(sorted[sorted.length - 1].created) : null;
            const fmt = (d) => d.toLocaleDateString();
            subtitle.textContent = (settings.showHeader && start && end) ? `Entries from ${fmt(start)} to ${fmt(end)}` : (settings.showHeader ? 'Exported Entries' : '');
            header.appendChild(title);
            if (settings.showHeader && subtitle.textContent) header.appendChild(subtitle);
            container.appendChild(header);

            // Entries grid (responsive single column)
            const list = document.createElement('div');
            list.className = 'flex flex-col gap-3';
            entries.forEach(e => {
                let displayText = e.text;
                try { displayText = decodeURIComponent(displayText); } catch { }
                const d = e.created ? (e.created instanceof Date ? e.created : new Date(e.created)) : null;
                const dateStr = d ? d.toLocaleDateString() : '';
                const tags = Array.isArray(e.tags) ? e.tags.map(t => normalizeTag(t)).filter(Boolean) : [];

                const card = document.createElement('div');
                if (settings.layout === 'compact') {
                    card.className = 'border-b border-gray-200 pb-2';
                    card.style.cssText = 'page-break-inside: avoid; break-inside: avoid;';
                } else {
                    card.className = 'rounded-xl shadow-sm p-4';
                    if (settings.colorStyle) {
                        card.style.cssText = 'border: 2px solid #6495DC; background-color: #E6F0FF; page-break-inside: avoid; break-inside: avoid;';
                    } else {
                        card.style.cssText = 'border: 1px solid #E5E7EB; background-color: #F8F8F8; page-break-inside: avoid; break-inside: avoid;';
                    }
                }

                const dateEl = document.createElement('div');
                dateEl.className = 'text-xs font-mono mb-2';
                if (settings.colorStyle) {
                    dateEl.style.cssText = 'color: #2860B4; font-weight: bold;';
                } else {
                    dateEl.style.cssText = 'color: #6B7280;';
                }
                dateEl.textContent = dateStr;

                const textEl = document.createElement('div');
                textEl.className = settings.layout === 'compact' ? 'prose prose-xs max-w-none whitespace-pre-line' : 'prose prose-sm max-w-none whitespace-pre-line';
                textEl.textContent = displayText;

                // Tags row (only if tags are enabled)
                let tagsEl = null;
                if (tagsEnabled && tags.length) {
                    tagsEl = document.createElement('div');
                    tagsEl.className = 'flex flex-wrap gap-2 mt-2';
                    tags.forEach(tag => {
                        const chip = document.createElement('span');
                        chip.className = 'inline-flex items-center px-2 py-1 bg-purple-100 text-purple-800 rounded-full text-[11px] font-semibold';
                        chip.textContent = tag;
                        tagsEl.appendChild(chip);
                    });
                }

                card.appendChild(dateEl);
                card.appendChild(textEl);
                if (tagsEl) card.appendChild(tagsEl);
                list.appendChild(card);
            });
            container.appendChild(list);

            // Append to body, render to PDF, then clean up
            document.body.appendChild(container);
            const opt = {
                margin: settings.margin,
                filename: 'gratitude_entries.pdf',
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
                jsPDF: { unit: 'mm', format: settings.format, orientation: settings.orientation }
            };
            const worker = window.html2pdf().from(container).set(opt).toPdf();
            worker.get('pdf').then(pdf => {
                // Always add page numbers in footer and small headers from page 2
                const pageCount = pdf.internal.getNumberOfPages();
                const pageWidth = pdf.internal.pageSize.getWidth();
                const pageHeight = pdf.internal.pageSize.getHeight();
                // Compute date range
                const sortedHdr = [...entries].sort((a, b) => new Date(a.created) - new Date(b.created));
                const startHdr = sortedHdr[0]?.created ? new Date(sortedHdr[0].created) : null;
                const endHdr = sortedHdr[sortedHdr.length - 1]?.created ? new Date(sortedHdr[sortedHdr.length - 1].created) : null;
                const dateRangeHdr = (startHdr && endHdr) ? `${startHdr.toLocaleDateString()} — ${endHdr.toLocaleDateString()}` : '';
                pdf.setFontSize(10);
                for (let i = 1; i <= pageCount; i++) {
                    pdf.setPage(i);
                    pdf.setTextColor(120);
                    pdf.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
                    if (i >= 2) {
                        const headerTitle = (settings.customTitle && settings.customTitle.trim()) ? settings.customTitle.trim() : 'My Gratitude Journal';
                        pdf.setFontSize(9);
                        pdf.setTextColor(120);
                        pdf.text(headerTitle, pageWidth / 2, 10, { align: 'center' });
                        if (dateRangeHdr) {
                            pdf.setFontSize(8);
                            pdf.setTextColor(140);
                            pdf.text(dateRangeHdr, pageWidth / 2, 14, { align: 'center' });
                        }
                    }
                }
                const blob = pdf.output('blob');
                const url = URL.createObjectURL(blob);
                showPdfPreview(url, opt.filename, () => {
                    URL.revokeObjectURL(url);
                }, () => {
                    exportEntriesPDFAsync();
                });
                container.remove();
            }).catch(() => {
                container.remove();
                // Fallback to jsPDF minimal export
                fallbackJsPdfExport(entries);
            });
            return;
        }

        // Fallback: original jsPDF export with improved spacing and dividers
        // Or use book mode if enabled
        if (settings.bookMode) {
            exportBookModePDF(entries, settings, tagsEnabled);
        } else {
            fallbackJsPdfExport(entries, tagsEnabled);
        }
    } catch (e) {
        console.error('Error exporting PDF:', e);
        alert('Failed to export PDF. Please try again.');
    }
}

function exportBookModePDF(entries, settings, tagsEnabled) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: settings.format, orientation: settings.orientation });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = Math.max(10, Number(settings.margin) || 10);
    const binding = 5; // Extra space for binding (inner margin)

    let pageNum = 1;
    let isLeftPage = true;
    let y = margin + 15;

    // Title page
    doc.setFont('georgia', 'normal');
    doc.setFontSize(32);
    doc.setTextColor(40, 40, 40);
    const title = (settings.customTitle && settings.customTitle.trim()) ? settings.customTitle.trim() : 'My Gratitude Journal';
    doc.text(title, pageWidth / 2, pageHeight / 2 - 25, { align: 'center' });

    // Decorative line
    doc.setDrawColor(100, 100, 100);
    doc.line(pageWidth / 2 - 40, pageHeight / 2 - 10, pageWidth / 2 + 40, pageHeight / 2 - 10);

    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    const sorted = [...entries].sort((a, b) => new Date(a.created) - new Date(b.created));
    const start = sorted[0]?.created ? new Date(sorted[0].created) : null;
    const end = sorted[sorted.length - 1]?.created ? new Date(sorted[sorted.length - 1].created) : null;
    const fmt = (d) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    if (start && end) {
        doc.text(`${fmt(start)} — ${fmt(end)}`, pageWidth / 2, pageHeight / 2 + 5, { align: 'center' });
    }
    doc.text(`${entries.length} entries`, pageWidth / 2, pageHeight / 2 + 15, { align: 'center' });
    // Build month groups ahead of content
    const groups = groupEntriesByMonth(sorted);

    // Pre-allocate Table of Contents pages based on number of months
    const tocItems = [];
    const tocHeaderHeight = 18; // header + spacing
    const tocLineHeight = 6;
    const tocUsableHeight = pageHeight - margin - 10; // bottom margin buffer
    const tocItemsPerPage = Math.floor((tocUsableHeight - tocHeaderHeight) / tocLineHeight);
    const tocPagesNeeded = Math.max(1, Math.ceil(groups.length / Math.max(1, tocItemsPerPage)));

    const tocPageIndices = [];
    for (let i = 0; i < tocPagesNeeded; i++) {
        doc.addPage();
        pageNum++;
        // page 2 is left in book layout; toggle accordingly
        isLeftPage = (pageNum % 2 === 0);
        tocPageIndices.push(pageNum);
    }

    // Content will start with the first month group's page add
    y = margin + 15;

    // Content pages
    const columnWidth = settings.twoColumn ? (pageWidth - binding * 2 - margin * 3) / 2 : pageWidth - margin * 2 - binding;
    let yLeft = margin + 15;  // Track y position in left column
    let yRight = margin + 15; // Track y position in right column
    const contentHeight = pageHeight - margin - 5; // minus just bottom margin and a tiny buffer

    // Helper to render month header
    function renderMonthHeader(monthLabel) {
        // Reset positions to top for a clean section start
        y = margin + 15;
        yLeft = margin + 15;
        yRight = margin + 15;

        doc.setFont('georgia', 'bold');
        doc.setFontSize(16);
        if (settings.colorStyle) {
            doc.setTextColor(30, 80, 160);
        } else {
            doc.setTextColor(50, 50, 50);
        }
        // Draw header centered across page
        doc.text(monthLabel, pageWidth / 2, y, { align: 'center' });
        doc.setDrawColor(180);
        doc.line(margin + binding, y + 4, pageWidth - margin - binding, y + 4);
        y += 12; yLeft += 12; yRight += 12;
    }

    // Iterate months
    for (const group of groups) {
        // Close previous page footer if not first content page
        if (pageNum >= (tocPageIndices[tocPageIndices.length - 1] + 1)) {
            addBookPageNumbers(doc, pageNum, pageWidth, pageHeight, margin, isLeftPage);
        }
        // New page for month start
        doc.addPage();
        pageNum++;
        isLeftPage = (pageNum % 2 === 0);
        // Record TOC item for this month -> first page of the section
        tocItems.push({ label: group.label, page: pageNum });
        renderMonthHeader(group.label);

        for (let idx = 0; idx < group.entries.length; idx++) {
            const e = group.entries[idx];
            const d = e.created ? (e.created instanceof Date ? e.created : new Date(e.created)) : null;
            const dateStr = d ? fmt(d) : '';
            let displayText = e.text;
            try { displayText = decodeURIComponent(displayText); } catch { }
            const tags = Array.isArray(e.tags) ? e.tags.map(t => normalizeTag(t)).filter(Boolean) : [];

            // Calculate entry height
            const lineHeight = 5;
            const lines = doc.splitTextToSize(displayText, columnWidth - 6);
            const tagLineHeight = (tagsEnabled && tags.length) ? lineHeight : 0;
            const tagLines = (tagsEnabled && tags.length) ? doc.splitTextToSize(`Tags: ${tags.join(', ')}`, columnWidth - 6) : [];
            const entryHeight = lineHeight * lines.length + (tagLineHeight * (tagLines.length || 0)) + (tagsEnabled && tags.length ? 6 : 0) + 10; // date + padding + tags
            const spaceNeeded = entryHeight + 3; // minimal spacing between entries

            if (settings.twoColumn) {
                // Choose column with space; prefer left then right
                let currentY = yLeft;
                let isRightColumn = false;
                if (yLeft + spaceNeeded > margin + contentHeight) {
                    currentY = yRight;
                    isRightColumn = true;
                }
                // If both columns full, add page and repeat header
                if (currentY + spaceNeeded > margin + contentHeight) {
                    addBookPageNumbers(doc, pageNum, pageWidth, pageHeight, margin, isLeftPage);
                    doc.addPage();
                    pageNum++;
                    isLeftPage = (pageNum % 2 === 0);
                    renderMonthHeader(group.label);
                }
                // Recompute currentY after possible page add
                currentY = isRightColumn ? yRight : yLeft;

                // x position
                let x = margin + binding;
                if (isRightColumn) x = margin + binding + columnWidth + margin;

                // Date
                doc.setFont('georgia', 'bold');
                doc.setFontSize(9);
                if (settings.colorStyle) {
                    doc.setTextColor(40, 100, 180);
                } else {
                    doc.setTextColor(80, 80, 80);
                }
                doc.text(dateStr, x, currentY);

                // Entry text
                doc.setFont('georgia', 'normal');
                doc.setFontSize(10);
                doc.setTextColor(40, 40, 40);
                doc.text(lines, x, currentY + 6, { maxWidth: columnWidth });

                if (tagsEnabled && tags.length) {
                    doc.setFont('georgia', 'italic');
                    doc.setFontSize(9);
                    doc.setTextColor(90, 90, 90);
                    doc.text(tagLines, x, currentY + 6 + lineHeight * lines.length + 4, { maxWidth: columnWidth });
                }

                // Update appropriate column position
                if (isRightColumn) {
                    yRight = currentY + entryHeight + 3;
                } else {
                    yLeft = currentY + entryHeight + 3;
                }
            } else {
                // Single column
                if (y + spaceNeeded > pageHeight - margin - 10) {
                    addBookPageNumbers(doc, pageNum, pageWidth, pageHeight, margin, isLeftPage);
                    doc.addPage();
                    pageNum++;
                    isLeftPage = (pageNum % 2 === 0);
                    renderMonthHeader(group.label);
                }
                let x = margin + binding;

                doc.setFont('georgia', 'bold');
                doc.setFontSize(9);
                if (settings.colorStyle) {
                    doc.setTextColor(40, 100, 180);
                } else {
                    doc.setTextColor(80, 80, 80);
                }
                doc.text(dateStr, x, y);

                doc.setFont('georgia', 'normal');
                doc.setFontSize(10);
                doc.setTextColor(40, 40, 40);
                doc.text(lines, x, y + 6, { maxWidth: columnWidth });
                if (tags.length) {
                    doc.setFont('georgia', 'italic');
                    doc.setFontSize(9);
                    doc.setTextColor(90, 90, 90);
                    doc.text(tagLines, x, y + 6 + lineHeight * lines.length + 4, { maxWidth: columnWidth });
                }

                y += entryHeight + 3;
            }
        }
        // Footer for last page of this month section will be handled either here or when next page added
    }

    // Add page numbers to last content page
    addBookPageNumbers(doc, pageNum, pageWidth, pageHeight, margin, isLeftPage);

    // Render Table of Contents on pre-allocated pages
    renderTableOfContents(doc, tocPageIndices, tocItems, pageWidth, pageHeight, margin, binding, settings);

    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    showPdfPreview(url, 'gratitude_journal_book.pdf', () => {
        URL.revokeObjectURL(url);
    }, () => {
        exportEntriesPDFAsync();
    });
}

function addBookPageNumbers(doc, pageNum, pageWidth, pageHeight, margin, isLeftPage) {
    doc.setFont('georgia', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(140, 140, 140);

    const pageNumX = isLeftPage ? (margin + 3) : (pageWidth - margin - 3);
    doc.text(String(pageNum), pageNumX, pageHeight - 8, { align: isLeftPage ? 'left' : 'right' });
}

// Group entries by calendar month (ascending)
function groupEntriesByMonth(sortedEntries) {
    const groupsMap = new Map();
    (sortedEntries || []).forEach(e => {
        const d = e.created ? (e.created instanceof Date ? e.created : new Date(e.created)) : null;
        if (!d) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
        if (!groupsMap.has(key)) groupsMap.set(key, { label, entries: [] });
        groupsMap.get(key).entries.push(e);
    });
    const groups = Array.from(groupsMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
    return groups;
}

// Render Table of Contents using pre-allocated pages
function renderTableOfContents(doc, tocPageIndices, tocItems, pageWidth, pageHeight, margin, binding, settings) {
    const headerTitle = 'Table of Contents';
    const lineHeight = 6;
    const startY = margin + 15;
    const usableHeight = pageHeight - margin - 10;
    const itemsPerPage = Math.max(1, Math.floor((usableHeight - 18) / lineHeight));

    let itemIdx = 0;
    for (let p = 0; p < tocPageIndices.length; p++) {
        const pageIndex = tocPageIndices[p];
        doc.setPage(pageIndex);

        // Header
        doc.setFont('georgia', 'bold');
        doc.setFontSize(16);
        if (settings.colorStyle) {
            doc.setTextColor(30, 80, 160);
        } else {
            doc.setTextColor(50, 50, 50);
        }
        doc.text(headerTitle, pageWidth / 2, startY, { align: 'center' });
        doc.setDrawColor(180);
        doc.line(margin + binding, startY + 4, pageWidth - margin - binding, startY + 4);

        // Items
        let y = startY + 12;
        doc.setFont('georgia', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(40, 40, 40);
        for (let i = 0; i < itemsPerPage && itemIdx < tocItems.length; i++, itemIdx++) {
            const item = tocItems[itemIdx];
            // Month label left
            doc.text(item.label, margin + binding, y);
            // Page number right
            doc.text(String(item.page), pageWidth - margin - binding, y, { align: 'right' });
            y += lineHeight;
        }

        // Footer page number for TOC page
        const isLeftPage = (pageIndex % 2 === 0);
        addBookPageNumbers(doc, pageIndex, pageWidth, pageHeight, margin, isLeftPage);
    }
}

function fallbackJsPdfExport(entries, tagsEnabled) {
    const settings = getPdfSettings();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: settings.format, orientation: settings.orientation });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = Math.max(0, Number(settings.margin) || 10);
    let y = 22;

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    const headerTitle = (settings.customTitle && settings.customTitle.trim()) ? settings.customTitle.trim() : 'My Gratitude Journal';
    doc.text(headerTitle, pageWidth / 2, y, { align: 'center' });
    y += 10;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    // Date range subtitle
    const sorted = [...entries].sort((a, b) => new Date(a.created) - new Date(b.created));
    const start = sorted[0]?.created ? new Date(sorted[0].created) : null;
    const end = sorted[sorted.length - 1]?.created ? new Date(sorted[sorted.length - 1].created) : null;
    const fmt = (d) => d.toLocaleDateString();
    const sub = start && end ? `Entries from ${fmt(start)} to ${fmt(end)}` : 'Exported Entries';
    doc.text(sub, pageWidth / 2, y, { align: 'center' });
    y += 8;
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;
    doc.setTextColor(30);

    // Entry cards
    doc.setFontSize(11);
    const lineHeight = 6.2;
    entries.forEach(e => {
        // Prepare data
        const d = e.created ? (e.created instanceof Date ? e.created : new Date(e.created)) : null;
        const dateStr = d ? d.toLocaleDateString() : '';
        let displayText = e.text;
        try { displayText = decodeURIComponent(displayText); } catch { }
        const textWidth = pageWidth - margin * 2 - 10; // padding inside card
        const lines = doc.splitTextToSize(displayText, textWidth);
        const tags = Array.isArray(e.tags) ? e.tags.map(t => normalizeTag(t)).filter(Boolean) : [];
        const tagLines = (tagsEnabled && tags.length) ? doc.splitTextToSize(`Tags: ${tags.join(', ')}`, textWidth) : [];
        const cardPadding = 5;
        const tagsHeight = (tagsEnabled && tags.length) ? (lineHeight * (tagLines.length || 1) + 4) : 0;
        const cardHeight = (lineHeight * lines.length) + tagsHeight + cardPadding * 2 + 6; // 6 for date

        // Add page if needed
        if (y + cardHeight + 6 > pageHeight - margin) {
            doc.addPage();
            y = 22;
            // small header on pages 2+
            const headerTitle = (settings.customTitle && settings.customTitle.trim()) ? settings.customTitle.trim() : 'My Gratitude Journal';
            const dateRangeHdr = (start && end) ? `${start.toLocaleDateString()} — ${end.toLocaleDateString()}` : '';
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(120);
            doc.text(headerTitle, pageWidth / 2, 10, { align: 'center' });
            if (dateRangeHdr) {
                doc.setFontSize(8);
                doc.setTextColor(140);
                doc.text(dateRangeHdr, pageWidth / 2, 14, { align: 'center' });
            }
            // page header rule
            doc.setDrawColor(230);
            doc.line(margin, y - 8, pageWidth - margin, y - 8);
        }

        // Card background
        if (settings.layout === 'compact') {
            doc.setDrawColor(220);
            doc.line(margin, y, pageWidth - margin, y);
        } else {
            if (settings.colorStyle) {
                doc.setDrawColor(100, 150, 220); // blue border
                doc.setFillColor(230, 240, 255); // light blue background
            } else {
                doc.setDrawColor(220);
                doc.setFillColor(248, 248, 248);
            }
            doc.roundedRect(margin, y, pageWidth - margin * 2, cardHeight, 3, 3, 'FD');
        }

        // Date
        doc.setFont('helvetica', 'bold');
        if (settings.colorStyle) {
            doc.setTextColor(40, 100, 180); // darker blue for date
        } else {
            doc.setTextColor(90);
        }
        doc.text(dateStr, margin + cardPadding, y + cardPadding + 4);

        // Text
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30);
        doc.text(lines, margin + cardPadding, y + cardPadding + 10, { maxWidth: textWidth });

        if (tagsEnabled && tags.length) {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(10);
            doc.setTextColor(90);
            doc.text(tagLines, margin + cardPadding, y + cardPadding + 10 + lineHeight * lines.length + 4, { maxWidth: textWidth });
        }

        y += cardHeight + 6;
    });

    // Footer page numbers
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
    }

    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    showPdfPreview(url, 'gratitude_entries.pdf', () => {
        URL.revokeObjectURL(url);
    }, () => {
        exportEntriesPDFAsync();
    });
}

function showPdfPreview(blobUrl, filename, onClose, refreshPreview) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 p-4 pt-6';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pdf-preview-title');

    const modal = document.createElement('div');
    modal.className = 'bg-white dark:bg-darkcard rounded-2xl shadow-2xl w-full max-w-4xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col my-4 max-h-[90vh]';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700';
    const h = document.createElement('h2');
    h.id = 'pdf-preview-title';
    h.className = 'text-lg font-bold text-gray-800 dark:text-gray-100';
    h.textContent = 'PDF Preview';
    const actions = document.createElement('div');
    actions.className = 'flex gap-2';
    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded hover:bg-gray-200 dark:hover:bg-gray-600 font-medium';
    settingsBtn.textContent = 'Settings';
    settingsBtn.onclick = () => {
        overlay.remove();
        if (window.openPdfSettings) window.openPdfSettings();
        window.pdfPreviewData = { blobUrl, filename, onClose, refreshPreview };
    };
    const downloadBtn = document.createElement('a');
    downloadBtn.className = 'px-4 py-2 bg-primary text-white rounded hover:bg-blue-600 font-semibold';
    downloadBtn.href = blobUrl;
    downloadBtn.download = filename || 'export.pdf';
    downloadBtn.textContent = 'Download';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded hover:bg-gray-300 dark:hover:bg-gray-600 font-medium';
    closeBtn.textContent = 'Close';
    actions.appendChild(settingsBtn);
    actions.appendChild(downloadBtn);
    actions.appendChild(closeBtn);
    header.appendChild(h);
    header.appendChild(actions);

    const frame = document.createElement('iframe');
    frame.className = 'w-full h-[80vh]';
    frame.src = blobUrl;

    modal.appendChild(header);
    modal.appendChild(frame);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function cleanup() {
        overlay.remove();
        if (typeof onClose === 'function') onClose();
    }
    closeBtn.onclick = cleanup;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup();
    });
}

function exportEntriesCSV() {
    exportEntriesCSVAsync();
}

async function exportEntriesCSVAsync() {
    try {
        // Fetch all entries for export (not just the limited 20)
        const allEntries = await fetchAllEntries();
        const settings = getPdfSettings();

        // Filter by favorites if enabled
        let entries = allEntries || [];
        if (settings.favoritesOnly) {
            entries = entries.filter(e => e.starred);
            if (!entries.length) {
                setStatus('No starred entries to export.', 'error');
                return;
            }
        } else if (!entries.length) {
            setStatus('No entries to export.', 'error');
            return;
        }

        // CSV header
        let csv = 'Date,Entry\r\n';
        entries.forEach(e => {
            let dateStr = '';
            if (e.created) {
                const d = e.created instanceof Date ? e.created : new Date(e.created);
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                dateStr = `${yyyy}-${mm}-${dd}`;
            }
            // Decode and escape for CSV
            let entryText = e.text || '';
            try {
                entryText = decodeURIComponent(entryText);
            } catch { }
            entryText = entryText.replace(/"/g, '""').replace(/\r?\n/g, '\r\n');
            // Always quote the entry field
            entryText = `"${entryText}"`;
            csv += `${dateStr},${entryText}\r\n`;
        });
        // Download CSV
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'gratitude_entries.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    } catch (e) {
        console.error('Error exporting CSV:', e);
        alert('Failed to export CSV. Please try again.');
    }
}

// Also re-render after edit/delete
async function deleteEntry(entryId) {
    if (!confirm('Delete this entry?')) return;

    const entryToDelete = (window._allEntries || []).find(e => e.id === entryId);
    if (!entryToDelete) return;

    const wasTemp = entryId.startsWith('temp_');
    const entryDate = entryToDelete.created ? new Date(entryToDelete.created) : null;
    if (entryDate) entryDate.setHours(0, 0, 0, 0);
    const entryDateStr = entryDate ? entryDate.toISOString().slice(0, 10) : null;

    window._totalEntries = Math.max(0, (window._totalEntries || 0) - 1);
    let decrementDaysJournaled = false;

    if (entryDateStr) {
        const otherEntriesSameDay = (window._allEntries || []).some(e => {
            if (e.id === entryId) return false;
            const eDate = e.created instanceof Date ? e.created : new Date(e.created);
            eDate.setHours(0, 0, 0, 0);
            return eDate.toISOString().slice(0, 10) === entryDateStr;
        });
        if (!otherEntriesSameDay) {
            window._daysJournaled = Math.max(0, (window._daysJournaled || 0) - 1);
            decrementDaysJournaled = true;
        }
    }

    persistLocalCounters({ daysJournaled: window._daysJournaled, totalEntries: window._totalEntries });

    window._allEntries = (window._allEntries || []).filter(e => e.id !== entryId);
    updateProgressInfo();
    renderEntries();
    syncOfflineCacheFromMemory();

    const persistDelete = async () => {
        await db.collection('users')
            .doc(auth.currentUser.uid)
            .collection('gratitude')
            .doc(entryId)
            .delete();
        await db.collection('users').doc(auth.currentUser.uid).set({
            daysJournaled: window._daysJournaled,
            totalEntries: window._totalEntries
        }, { merge: true });
    };

    if (wasTemp) {
        removePendingAdd(entryId);
        setStatus('Deleted offline entry.', 'info');
        return;
    }

    if (isOnline()) {
        try {
            await persistDelete();
        } catch (err) {
            console.error('Delete failed online, queuing:', err);
            queuePendingOp({ type: 'delete', id: entryId });
            setStatus('Deletion saved offline. It will sync when you are back online.', 'info');
        }
    } else {
        queuePendingOp({ type: 'delete', id: entryId });
        setStatus('Deletion saved offline. It will sync when you are back online.', 'info');
    }
}

// Entry view/edit modal logic
let editingEntryId = null;
let currentModalEntry = null;
const editModal = document.getElementById('edit-modal');
const modalViewMode = document.getElementById('modal-view-mode');
const modalEditMode = document.getElementById('modal-edit-mode');
const modalEntryText = document.getElementById('modal-entry-text');
const modalEntryDate = document.getElementById('modal-entry-date');
const modalActionButtons = document.getElementById('modal-action-buttons');
const editEntryInput = document.getElementById('edit-entry-input');
const saveEditBtn = document.getElementById('save-edit-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const editTagInput = document.getElementById('edit-tag-input');
const editAddTagBtn = document.getElementById('edit-add-tag-btn');

if (editModal && editModal.parentElement !== document.body) {
    document.body.appendChild(editModal);
}

// Update a cached entry by id with provided fields
function updateEntryInCache(entryId, updates) {
    if (!window._allEntries) return;
    const idx = window._allEntries.findIndex((e) => e.id === entryId);
    if (idx >= 0) {
        window._allEntries[idx] = { ...window._allEntries[idx], ...updates };
    }
}

// Safely derive a Date from various entry fields
function getEntryDate(entry) {
    const candidate = entry?.created ?? entry?.timestamp ?? entry?.createdAt;
    if (!candidate) return null;
    if (candidate instanceof Date) return candidate;
    if (typeof candidate === 'object' && typeof candidate.seconds === 'number') {
        return new Date(candidate.seconds * 1000);
    }
    const parsed = new Date(candidate);
    return isNaN(parsed.getTime()) ? null : parsed;
}

function computeCountersFromEntries(entries) {
    const dates = new Set();
    (entries || []).forEach((e) => {
        const d = getEntryDate(e);
        if (!d) return;
        d.setHours(0, 0, 0, 0);
        dates.add(d.toISOString().slice(0, 10));
    });
    return { daysJournaled: dates.size, totalEntries: (entries || []).length };
}

if (editModal) {
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) {
            editModal.classList.add('hidden');
            document.body.classList.remove('modal-open');
            currentModalEntry = null;
            editingEntryId = null;
            // Ensure view mode is restored next open
            modalViewMode.classList.remove('hidden');
            modalEditMode.classList.add('hidden');
            saveEditBtn.classList.add('hidden');
            cancelEditBtn.textContent = 'Close';
        }
    });
}

function openEntryModal(entry) {
    currentModalEntry = entry;
    editingEntryId = null;

    // Show view mode
    modalViewMode.classList.remove('hidden');
    modalEditMode.classList.add('hidden');
    saveEditBtn.classList.add('hidden');
    cancelEditBtn.textContent = 'Close';

    // Set content
    modalEntryText.textContent = decodeURIComponent(entry.text);

    // Display saved prompt if it exists
    const modalPromptDisplay = document.getElementById('modal-prompt-display');
    if (modalPromptDisplay) {
        if (entry.prompt) {
            modalPromptDisplay.textContent = `💭 ${entry.prompt}`;
            modalPromptDisplay.classList.remove('hidden');
        } else {
            modalPromptDisplay.classList.add('hidden');
        }
    }

    renderModalViewTags(entry.tags || []);
    const entryDate = getEntryDate(entry);
    if (entryDate && window._formatDate) {
        // Use formatDate if available, otherwise fall back to long format
        const settings = JSON.parse(localStorage.getItem('gj_user_settings') || '{}');
        const dateFormat = settings.dateFormat || 'relative';
        if (dateFormat === 'relative') {
            // For modal, show a more detailed format even in relative mode
            modalEntryDate.textContent = entryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        } else {
            modalEntryDate.textContent = window._formatDate(entryDate);
        }
    } else if (entryDate) {
        modalEntryDate.textContent = entryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } else {
        modalEntryDate.textContent = '';
    }

    // Render action buttons
    renderModalActionButtons(entry);

    editModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
}

function renderModalActionButtons(entry) {
    modalActionButtons.innerHTML = '';

    const offlineCachedIds = window._offlineCacheIds instanceof Set ? window._offlineCacheIds : new Set();
    const offlinePinnedIds = getOfflinePinnedIds();
    const isOfflineReady = offlineCachedIds.has(entry.id);
    const isOfflinePinned = offlinePinnedIds.has(entry.id);

    // Star button
    const starBtn = document.createElement('button');
    starBtn.innerHTML = entry.starred
        ? '<i class="fa-solid fa-star"></i><span class="icon" aria-hidden="true"><svg class="w-4 h-4 inline" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></span><span class="btn-text ml-2">Unfavorite</span>'
        : '<i class="fa-regular fa-star"></i><span class="icon" aria-hidden="true"><svg class="w-4 h-4 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></span><span class="btn-text ml-2">Favorite</span>';
    starBtn.className = entry.starred
        ? "btn-icon-expand px-3 py-2 rounded bg-yellow-400 text-gray-900 hover:bg-yellow-500 text-sm font-semibold"
        : "btn-icon-expand px-3 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 text-sm font-semibold";
    starBtn.onclick = async () => {
        const newStar = !entry.starred;
        const prevStar = entry.starred;
        // Optimistic update across modal and list
        currentModalEntry.starred = newStar;
        updateEntryInCache(entry.id, { starred: newStar });
        renderEntries();
        renderModalActionButtons(currentModalEntry);
        try {
            await toggleStarEntry(entry.id, newStar);
        } catch (err) {
            console.error('Failed to update favorite from modal:', err);
            currentModalEntry.starred = prevStar;
            updateEntryInCache(entry.id, { starred: prevStar });
            renderEntries();
            renderModalActionButtons(currentModalEntry);
            alert('Failed to update favorite. Please try again.');
        }
    };

    // Offline button
    const offlineBtn = document.createElement('button');
    offlineBtn.innerHTML = (isOfflineReady || isOfflinePinned)
        ? '<i class="fa-solid fa-cloud-arrow-down"></i><span class="icon" aria-hidden="true"><svg class="w-4 h-4 inline" viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg></span><span class="btn-text ml-2">Offline ✓</span>'
        : '<i class="fa-solid fa-cloud"></i><span class="icon" aria-hidden="true"><svg class="w-4 h-4 inline" viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg></span><span class="btn-text ml-2">Save offline</span>';
    offlineBtn.className = (isOfflineReady || isOfflinePinned)
        ? "btn-icon-expand px-3 py-2 rounded bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-100 text-sm font-semibold border border-green-200 dark:border-green-700"
        : "btn-icon-expand px-3 py-2 rounded bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100 text-sm font-semibold";
    offlineBtn.onclick = () => {
        toggleOfflineAvailability(entry.id);
        renderModalActionButtons(currentModalEntry);
    };

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i><span class="icon" aria-hidden="true"><svg class="w-4 h-4 inline" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></span><span class="btn-text ml-2">Edit</span>';
    editBtn.className = "btn-icon-expand px-3 py-2 rounded bg-yellow-400 text-gray-900 hover:bg-yellow-500 text-sm font-semibold";
    editBtn.onclick = () => switchToEditMode();

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i><span class="icon" aria-hidden="true"><svg class="w-4 h-4 inline" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></span><span class="btn-text ml-2">Delete</span>';
    deleteBtn.className = "btn-icon-expand px-3 py-2 rounded bg-red-500 text-white hover:bg-red-700 text-sm font-semibold";
    deleteBtn.onclick = async () => {
        await deleteEntry(entry.id);
        editModal.classList.add('hidden');
        document.body.classList.remove('modal-open');
    };

    modalActionButtons.appendChild(starBtn);
    modalActionButtons.appendChild(offlineBtn);
    modalActionButtons.appendChild(editBtn);
    modalActionButtons.appendChild(deleteBtn);
}

function switchToEditMode() {
    editingEntryId = currentModalEntry.id;
    editEntryInput.value = decodeURIComponent(currentModalEntry.text);
    if (editTagInput) editTagInput.value = '';
    window._editingEntryTags = Array.isArray(currentModalEntry.tags)
        ? currentModalEntry.tags.map(t => normalizeTag(t)).filter(Boolean)
        : [];
    renderEditingTags();
    updateTagSuggestionList(editTagInput, 'edit-tag-suggestion-list', window._editingEntryTags);

    modalViewMode.classList.add('hidden');
    modalEditMode.classList.remove('hidden');
    saveEditBtn.classList.remove('hidden');
    cancelEditBtn.textContent = 'Cancel';

    setTimeout(() => editEntryInput.focus(), 0);
}

function openEditModal(entryId, entryText) {
    const entry = (window._allEntries || []).find(e => e.id === entryId);
    if (entry) {
        openEntryModal(entry);
        setTimeout(() => switchToEditMode(), 0);
    }
}

cancelEditBtn.onclick = () => {
    if (editingEntryId) {
        // Cancel edit, return to view mode
        editingEntryId = null;
        modalViewMode.classList.remove('hidden');
        modalEditMode.classList.add('hidden');
        saveEditBtn.classList.add('hidden');
        cancelEditBtn.textContent = 'Close';
    } else {
        // Close modal
        editModal.classList.add('hidden');
        document.body.classList.remove('modal-open');
        currentModalEntry = null;
    }
};

if (editAddTagBtn) {
    editAddTagBtn.addEventListener('click', () => {
        if (!editTagInput) return;
        const value = editTagInput.value.trim();
        addEditingTag(value);
        editTagInput.value = '';
        editTagInput.focus();
    });
}

if (editTagInput) {
    editTagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const value = editTagInput.value.trim();
            addEditingTag(value);
            editTagInput.value = '';
        }
    });
}

saveEditBtn.onclick = async () => {
    const newText = editEntryInput.value.trim();
    if (!newText || !editingEntryId) return;
    if (editTagInput) {
        const pendingTag = editTagInput.value.trim();
        if (pendingTag) {
            addEditingTag(pendingTag);
            editTagInput.value = '';
        }
    }
    const targetId = editingEntryId;
    const encrypted = encrypt(newText, userKey);
    const wasTemp = targetId.startsWith('temp_');
    const tags = Array.isArray(window._editingEntryTags) ? [...window._editingEntryTags] : [];

    window._allEntries = (window._allEntries || []).map(e =>
        e.id === targetId ? { ...e, text: newText, cipher: encrypted, tags } : e
    );

    // Update current modal entry
    currentModalEntry = window._allEntries.find(e => e.id === targetId);

    // Return to view mode
    editingEntryId = null;
    modalEntryText.textContent = newText;
    renderModalViewTags(tags);
    modalViewMode.classList.remove('hidden');
    modalEditMode.classList.add('hidden');
    saveEditBtn.classList.add('hidden');
    cancelEditBtn.textContent = 'Close';

    window._allTags = null; // force tag list refresh
    updateProgressInfo();
    renderEntries();
    syncOfflineCacheFromMemory();

    editingEntryId = null;

    if (wasTemp) {
        updatePendingAdd(targetId, () => ({ entry: encrypted, tags }));
        setStatus('Edit saved offline. It will sync when you are back online.', 'info');
        return;
    }

    const persistEdit = async () => {
        await db.collection('users')
            .doc(auth.currentUser.uid)
            .collection('gratitude')
            .doc(targetId)
            .update({ entry: encrypted, tags });
    };

    if (isOnline()) {
        try {
            await persistEdit();
        } catch (err) {
            console.error('Edit failed online, queuing:', err);
            queuePendingOp({ type: 'edit', id: targetId, entry: encrypted, tags });
            setStatus('Edit saved offline. It will sync when you are back online.', 'info');
        }
    } else {
        queuePendingOp({ type: 'edit', id: targetId, entry: encrypted });
        setStatus('Edit saved offline. It will sync when you are back online.', 'info');
    }
};

// Privacy Notice modal logic
document.addEventListener('DOMContentLoaded', function () {
    const showPrivacyBtn = document.getElementById('show-privacy-btn');
    const privacyModal = document.getElementById('privacy-modal');
    const closePrivacyBtn = document.getElementById('close-privacy-btn');
    if (showPrivacyBtn && privacyModal && closePrivacyBtn) {
        if (privacyModal.parentElement !== document.body) {
            document.body.appendChild(privacyModal);
        }
        showPrivacyBtn.onclick = () => {
            privacyModal.classList.remove('hidden');
            document.body.classList.add('modal-open');
        };
        closePrivacyBtn.onclick = () => {
            privacyModal.classList.add('hidden');
            document.body.classList.remove('modal-open');
        };
        // Optional: close modal when clicking outside
        privacyModal.onclick = (e) => {
            if (e.target === privacyModal) {
                privacyModal.classList.add('hidden');
                document.body.classList.remove('modal-open');
            }
        };
    }

    // Settings Modal logic
    const settingsModal = document.getElementById('settings-modal');
    const menuSettingsBtn = document.getElementById('menu-settings');
    const settingsCloseBtn = document.getElementById('settings-close');
    const settingsCancelBtn = document.getElementById('settings-cancel');
    const settingsSaveBtn = document.getElementById('settings-save');
    const settingsTabs = document.querySelectorAll('.settings-tab');
    const settingsTabContents = document.querySelectorAll('.settings-tab-content');

    // Only initialize settings modal if all elements exist
    if (settingsModal && menuSettingsBtn && settingsCloseBtn && settingsCancelBtn && settingsSaveBtn) {
        const loadSettings = () => loadStoredSettings();
        const saveSettings = (settings) => saveStoredSettings(settings);

        // Format date based on user preference
        function formatDate(date, format) {
            if (!date) return '';
            const d = date instanceof Date ? date : new Date(date);
            if (isNaN(d.getTime())) return '';

            const settings = loadSettings();
            const dateFormat = format || settings.dateFormat || 'relative';

            switch (dateFormat) {
                case 'MM/DD/YYYY':
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    const yyyy = d.getFullYear();
                    return `${mm}/${dd}/${yyyy}`;
                case 'DD/MM/YYYY':
                    const dd2 = String(d.getDate()).padStart(2, '0');
                    const mm2 = String(d.getMonth() + 1).padStart(2, '0');
                    const yyyy2 = d.getFullYear();
                    return `${dd2}/${mm2}/${yyyy2}`;
                case 'relative':
                default:
                    const now = new Date();
                    const diffTime = Math.abs(now - d);
                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays === 0) {
                        return 'Today';
                    } else if (diffDays === 1) {
                        return 'Yesterday';
                    } else if (diffDays < 7) {
                        return `${diffDays} days ago`;
                    } else if (diffDays < 30) {
                        const weeks = Math.floor(diffDays / 7);
                        return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
                    } else if (diffDays < 365) {
                        const months = Math.floor(diffDays / 30);
                        return months === 1 ? '1 month ago' : `${months} months ago`;
                    } else {
                        const years = Math.floor(diffDays / 365);
                        return years === 1 ? '1 year ago' : `${years} years ago`;
                    }
            }
        }

        // Make formatDate available globally for use in renderEntries
        window._formatDate = formatDate;

        function applyTemplateVisibility(enabled) {
            const controls = document.getElementById('template-controls');
            if (!controls) return;
            controls.style.display = enabled ? '' : 'none';
        }

        function updateReminderControls(enabled) {
            const reminderToggle = document.getElementById('reminder-toggle');
            const reminderTimeInput = document.getElementById('reminder-time-input');
            const testReminderBtn = document.getElementById('test-reminder-btn');
            if (!reminderToggle || !reminderTimeInput) return false;

            if (!notificationsSupported()) {
                reminderToggle.checked = false;
                reminderToggle.disabled = true;
                reminderTimeInput.disabled = true;
                reminderToggle.title = 'Notifications need a supported browser and a secure connection (https).';
                if (testReminderBtn) {
                    testReminderBtn.disabled = true;
                    testReminderBtn.title = 'Notifications are unavailable on this browser or connection.';
                }
                return false;
            }

            reminderToggle.disabled = false;
            reminderToggle.title = '';
            const hasPermission = Notification.permission === 'granted';
            reminderTimeInput.disabled = !enabled || !hasPermission;
            if (testReminderBtn) {
                const disabled = !enabled;
                const disabledReason = !enabled ? 'Turn on daily reminders to send a test.' : '';
                testReminderBtn.disabled = disabled;
                testReminderBtn.title = disabled ? disabledReason : (hasPermission ? '' : 'Click to allow notifications and send a test.');
            }
            return true;
        }

        function updateReminderToggleState() {
            const reminderToggle = document.getElementById('reminder-toggle');
            if (!reminderToggle) return;

            if (!notificationsSupported()) {
                reminderToggle.disabled = true;
                reminderToggle.title = 'Notifications need a supported browser and a secure connection (https).';
                reminderToggle.checked = false;
                return;
            }

            const permission = Notification.permission;
            if (permission === 'denied') {
                reminderToggle.disabled = true;
                reminderToggle.checked = false;
                reminderToggle.title = 'Notifications are blocked. Enable them in your browser settings to use reminders.';
            } else if (permission === 'granted') {
                reminderToggle.disabled = false;
                reminderToggle.title = '';
            } else {
                reminderToggle.disabled = false;
                reminderToggle.title = 'Click to request notification permission';
            }
        }

        // Apply settings to UI
        function applySettings(settings) {
            document.getElementById('font-size-select').value = settings.fontSize || 'normal';
            document.getElementById('date-format-select').value = settings.dateFormat || 'relative';
            document.getElementById('sort-order-select').value = settings.sortOrder || 'newest';

            const reminderToggle = document.getElementById('reminder-toggle');
            let remindersEnabled = settings.remindersEnabled || false;
            if (!notificationsSupported() || Notification.permission === 'denied') {
                remindersEnabled = false;
            }
            reminderToggle.checked = remindersEnabled;

            document.getElementById('prompts-toggle').checked = settings.promptsEnabled !== false;
            document.getElementById('templates-toggle').checked = settings.templatesEnabled !== false;
            document.getElementById('tags-toggle').checked = settings.tagsEnabled !== false;
            document.getElementById('reminder-time-input').value = settings.reminderTime || '18:00';
            document.getElementById('simple-view-toggle').checked = settings.simpleView || false;

            applyTemplateVisibility(settings.templatesEnabled !== false);
            applyTagsVisibility(settings.tagsEnabled !== false);
            applyPromptsVisibility(settings.promptsEnabled !== false);
            updateDailyPrompt();

            updateReminderControls(remindersEnabled);

            // Apply font size
            applyFontSize(settings.fontSize || 'normal');

            scheduleReminderFromSettings({ ...settings, remindersEnabled });
        }

        // Apply font size to document
        function applyFontSize(size) {
            const root = document.documentElement;
            const body = document.body;
            switch (size) {
                case 'small':
                    root.style.setProperty('--base-font-size', '14px');
                    root.style.setProperty('--font-scale', '0.875');
                    root.style.fontSize = '14px';
                    body.style.fontSize = '14px';
                    break;
                case 'large':
                    root.style.setProperty('--base-font-size', '18px');
                    root.style.setProperty('--font-scale', '1.125');
                    root.style.fontSize = '18px';
                    body.style.fontSize = '18px';
                    break;
                case 'normal':
                default:
                    root.style.setProperty('--base-font-size', '16px');
                    root.style.setProperty('--font-scale', '1');
                    root.style.fontSize = '16px';
                    body.style.fontSize = '16px';
                    break;
            }
        }

        // Gather current settings from form
        function getCurrentSettings() {
            return {
                fontSize: document.getElementById('font-size-select').value,
                dateFormat: document.getElementById('date-format-select').value,
                sortOrder: document.getElementById('sort-order-select').value,
                remindersEnabled: document.getElementById('reminder-toggle').checked,
                promptsEnabled: document.getElementById('prompts-toggle').checked,
                templatesEnabled: document.getElementById('templates-toggle').checked,
                tagsEnabled: document.getElementById('tags-toggle').checked,
                reminderTime: document.getElementById('reminder-time-input').value,
                simpleView: document.getElementById('simple-view-toggle').checked
            };
        }

        // Tab switching
        settingsTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.getAttribute('data-tab-name');

                // Update tab active state
                settingsTabs.forEach(t => {
                    t.setAttribute('aria-selected', t.getAttribute('data-tab-name') === tabName);
                    if (t.getAttribute('data-tab-name') === tabName) {
                        t.classList.add('border-primary', 'text-primary');
                        t.classList.remove('text-gray-700', 'dark:text-gray-300');
                    } else {
                        t.classList.remove('border-primary', 'text-primary');
                        t.classList.add('text-gray-700', 'dark:text-gray-300');
                    }
                });

                // Update content visibility
                settingsTabContents.forEach(content => {
                    if (content.getAttribute('data-tab-name') === tabName) {
                        content.classList.remove('hidden');
                    } else {
                        content.classList.add('hidden');
                    }
                });

                // Scroll the tab into view
                const activeTab = tab;
                activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            });
        });

        // Touch swipe handler for tab navigation
        let touchStartX = 0;
        let touchEndX = 0;
        const tabsContainer = document.querySelector('.settings-tabs-container');

        if (tabsContainer) {
            tabsContainer.addEventListener('touchstart', (e) => {
                touchStartX = e.changedTouches[0].screenX;
            }, false);

            tabsContainer.addEventListener('touchend', (e) => {
                touchEndX = e.changedTouches[0].screenX;
                handleTabSwipe();
            }, false);
        }

        function handleTabSwipe() {
            const swipeThreshold = 50;
            const diff = touchStartX - touchEndX;

            if (Math.abs(diff) < swipeThreshold) return;

            // Find currently visible tab
            let currentTabIndex = -1;
            settingsTabs.forEach((tab, index) => {
                if (tab.getAttribute('aria-selected') === 'true') {
                    currentTabIndex = index;
                }
            });

            let nextTabIndex = currentTabIndex;
            if (diff > swipeThreshold && currentTabIndex < settingsTabs.length - 1) {
                // Swipe left - move to next tab
                nextTabIndex = currentTabIndex + 1;
            } else if (diff < -swipeThreshold && currentTabIndex > 0) {
                // Swipe right - move to previous tab
                nextTabIndex = currentTabIndex - 1;
            }

            if (nextTabIndex !== currentTabIndex) {
                settingsTabs[nextTabIndex].click();
            }
        }

        // Open settings modal
        menuSettingsBtn.onclick = () => {
            applySettings(loadSettings());
            updateReminderToggleState();

            // Show/hide change password button based on auth provider
            const user = auth.currentUser;
            const changePasswordBtn = document.getElementById('change-password-btn');
            if (changePasswordBtn && user) {
                const providers = (user.providerData || []).map(p => p.providerId);
                const isPasswordProvider = providers.includes('password');
                changePasswordBtn.style.display = isPasswordProvider ? 'block' : 'none';
            }

            // Render tag management list when settings open - fetch all entries if tags enabled
            const settings = loadSettings();
            if (settings.tagsEnabled !== false) {
                fetchAllEntries().then(entries => {
                    window._allEntries = entries;
                    window._allTags = null; // Clear cache
                    renderTagManagementList();
                });
            } else {
                renderTagManagementList(); // Still render to show "No tags yet"
            }

            settingsModal.classList.remove('hidden');
            document.body.classList.add('modal-open');
        };

        // Close settings modal
        const closeSettings = () => {
            settingsModal.classList.add('hidden');
            document.body.classList.remove('modal-open');
        };

        settingsCloseBtn.onclick = closeSettings;
        settingsCancelBtn.onclick = closeSettings;

        // Handle reminder toggle
        document.getElementById('reminder-toggle').addEventListener('change', async (e) => {
            if (Notification.permission === 'denied') {
                e.target.checked = false;
                setStatus('Notifications are blocked. Enable them in your browser settings to use reminders.', 'error');
                return;
            }

            const enabled = e.target.checked;
            const controlsReady = updateReminderControls(enabled);
            if (!controlsReady) {
                e.target.checked = false;
                return;
            }

            if (enabled) {
                const permission = await ensureNotificationPermission();
                if (permission !== 'granted') {
                    e.target.checked = false;
                    updateReminderControls(false);

                    let message = 'Notifications are not available in this browser.';
                    if (permission === 'denied') {
                        message = 'Notifications are blocked. Enable them in your browser settings to use reminders.';
                    } else if (permission === 'insecure') {
                        message = 'Notifications need a secure connection (https).';
                    }
                    setStatus(message, 'error');
                }
            }
        });

        // Send test notification
        const testReminderBtn = document.getElementById('test-reminder-btn');
        if (testReminderBtn) {
            testReminderBtn.addEventListener('click', async () => {
                const permission = await ensureNotificationPermission();
                if (permission !== 'granted') {
                    updateReminderControls(document.getElementById('reminder-toggle')?.checked);
                    setStatus(permission === 'denied'
                        ? 'Notifications are blocked. Enable them in your browser settings to test reminders.'
                        : 'Please allow notifications to send a test reminder.', 'error');
                    return;
                }

                updateReminderControls(document.getElementById('reminder-toggle')?.checked);
                showDailyReminderNotification();
                setStatus('Test notification sent. Check your notification tray.', 'success');
            });
        }

        // Handle tags toggle - show/hide management section immediately
        // Handle prompts toggle - show/hide prompt section immediately
        document.getElementById('prompts-toggle').addEventListener('change', (e) => {
            const promptsSection = document.getElementById('prompts-section');
            if (promptsSection) {
                promptsSection.style.display = e.target.checked ? '' : 'none';
                if (e.target.checked) {
                    updateDailyPrompt();
                }
            }
        });

        document.getElementById('tags-toggle').addEventListener('change', async (e) => {
            const tagsManagementSection = document.getElementById('tags-management-section');
            if (tagsManagementSection) {
                tagsManagementSection.style.display = e.target.checked ? '' : 'none';
                // Populate tag management list when toggled on
                if (e.target.checked) {
                    // Fetch all entries first to ensure we have all tags
                    window._allEntries = await fetchAllEntries();
                    window._allTags = null; // Clear tag cache to force refresh
                    renderTagManagementList();
                }
            }
        });

        // Add real-time preview for font size changes
        document.getElementById('font-size-select').addEventListener('change', (e) => {
            applyFontSize(e.target.value);
        });

        // Add real-time preview for date format and sort order
        document.getElementById('date-format-select').addEventListener('change', () => {
            if (typeof renderEntries === 'function') {
                renderEntries();
            }
        });

        document.getElementById('sort-order-select').addEventListener('change', () => {
            if (typeof renderEntries === 'function') {
                renderEntries();
            }
        });

        // Save settings
        settingsSaveBtn.onclick = async () => {
            const settings = getCurrentSettings();

            if (settings.remindersEnabled) {
                const permission = await ensureNotificationPermission();
                if (permission !== 'granted') {
                    settings.remindersEnabled = false;
                    updateReminderControls(false);
                    setStatus('Daily reminders disabled because notification permission was not granted.', 'info');
                }
            }

            saveSettings(settings);
            // Save to Firebase (excludes notification settings)
            await saveFirebaseSettings(settings);
            applySettings(settings);
            applySimpleViewVisibility(settings.simpleView);

            // Re-render entries to apply new date format and sort order
            if (typeof renderEntries === 'function') {
                renderEntries();
            }

            // Wait a brief moment for DOM to update, then show success and close
            await new Promise(resolve => setTimeout(resolve, 100));

            setStatus('Settings saved successfully.', 'success');
            closeSettings();
        };

        // Close modal when clicking outside
        settingsModal.onclick = (e) => {
            if (e.target === settingsModal) {
                closeSettings();
            }
        };

        // Handle delete account from settings
        const deleteAccountFromSettings = document.getElementById('delete-account-from-settings');
        deleteAccountFromSettings.onclick = () => {
            closeSettings();
            openDeleteAccountModal();
        };

        // Handle change password
        const changePasswordBtn = document.getElementById('change-password-btn');
        const changePasswordModal = document.getElementById('change-password-modal');
        const changePasswordCancel = document.getElementById('change-password-cancel');
        const changePasswordSubmit = document.getElementById('change-password-submit');
        const changePasswordError = document.getElementById('change-password-error');
        const changePasswordProcessing = document.getElementById('change-password-processing');

        if (changePasswordBtn && changePasswordModal) {
            changePasswordBtn.onclick = () => {
                // Clear form
                document.getElementById('current-password-input').value = '';
                document.getElementById('new-password-input').value = '';
                document.getElementById('confirm-password-input').value = '';
                changePasswordError.classList.add('hidden');
                changePasswordError.textContent = '';
                changePasswordProcessing.classList.add('hidden');

                closeSettings();
                changePasswordModal.classList.remove('hidden');
                document.body.classList.add('modal-open');
                document.getElementById('current-password-input').focus();
            };

            changePasswordCancel.onclick = () => {
                changePasswordModal.classList.add('hidden');
                document.body.classList.remove('modal-open');
            };

            changePasswordSubmit.onclick = async () => {
                const user = auth.currentUser;
                if (!user) {
                    changePasswordError.textContent = 'No user logged in.';
                    changePasswordError.classList.remove('hidden');
                    return;
                }

                const currentPassword = document.getElementById('current-password-input').value;
                const newPassword = document.getElementById('new-password-input').value;
                const confirmPassword = document.getElementById('confirm-password-input').value;

                // Validation
                if (!currentPassword || !newPassword || !confirmPassword) {
                    changePasswordError.textContent = 'Please fill in all password fields.';
                    changePasswordError.classList.remove('hidden');
                    return;
                }

                if (newPassword !== confirmPassword) {
                    changePasswordError.textContent = 'New passwords do not match.';
                    changePasswordError.classList.remove('hidden');
                    return;
                }

                if (newPassword.length < 6) {
                    changePasswordError.textContent = 'New password must be at least 6 characters.';
                    changePasswordError.classList.remove('hidden');
                    return;
                }

                changePasswordProcessing.classList.remove('hidden');
                changePasswordError.classList.add('hidden');
                changePasswordSubmit.disabled = true;

                try {
                    // 1. Reauthenticate with current password
                    const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
                    await user.reauthenticateWithCredential(credential);

                    // 2. Get all entries before password change
                    const entries = window._allEntries || [];

                    // 3. Derive the new key from new password
                    const newKey = deriveKeyFromPassword(newPassword, userSalt);

                    // 4. Re-encrypt all entries with new password
                    for (const entry of entries) {
                        try {
                            // Decrypt with old key
                            const decrypted = decrypt(entry.text, userKey);
                            // Encrypt with new key
                            entry.text = encrypt(decrypted, newKey);
                        } catch (e) {
                            console.error('Failed to re-encrypt entry:', e);
                            throw new Error('Failed to re-encrypt entry: ' + entry.id);
                        }
                    }

                    // 5. Update entries in Firestore
                    const uid = user.uid;
                    const batch = db.batch();
                    for (const entry of entries) {
                        if (!entry.id.startsWith('temp_')) {
                            const ref = db.collection('users').doc(uid).collection('gratitude').doc(entry.id);
                            batch.update(ref, { text: entry.text });
                        }
                    }
                    await batch.commit();

                    // 6. Update Firebase Auth password
                    await user.updatePassword(newPassword);

                    // 7. Update session storage with new key
                    userKey = newKey;
                    legacyKey = normalizeKey(newPassword);
                    sessionStorage.setItem(USER_KEY_STORAGE, userKey);
                    sessionStorage.setItem(LEGACY_KEY_STORAGE, legacyKey);

                    // Close modal and show success message
                    changePasswordProcessing.classList.add('hidden');
                    changePasswordSubmit.disabled = false;
                    changePasswordModal.classList.add('hidden');
                    document.body.classList.remove('modal-open');

                    setStatus('Password changed successfully. All entries have been re-encrypted.', 'success');
                } catch (e) {
                    console.error('Password change error:', e);
                    changePasswordProcessing.classList.add('hidden');
                    changePasswordSubmit.disabled = false;

                    let errorMsg = 'Error changing password.';
                    if (e.code === 'auth/wrong-password') {
                        errorMsg = 'Current password is incorrect.';
                    } else if (e.code === 'auth/weak-password') {
                        errorMsg = 'New password is too weak.';
                    } else if (e.code === 'auth/requires-recent-login') {
                        errorMsg = 'Session expired. Please log in again.';
                    } else if (e.message) {
                        errorMsg = e.message;
                    }

                    changePasswordError.textContent = errorMsg;
                    changePasswordError.classList.remove('hidden');
                }
            };

            // Close modal when clicking outside
            changePasswordModal.onclick = (e) => {
                if (e.target === changePasswordModal) {
                    changePasswordCancel.click();
                }
            };
        }

        // Handle clear cache
        const clearCacheBtn = document.getElementById('clear-cache-btn');
        clearCacheBtn.onclick = () => {
            const user = auth.currentUser;
            if (!user) return;

            const offlineKey = offlineKeyForUser();
            const offlinePinsKey = offlinePinsKeyForUser();
            const offlineExcludesKey = offlineExcludesKeyForUser();
            const pendingOpsKey = pendingOpsKeyForUser();

            if (offlineKey) localStorage.removeItem(offlineKey);
            if (offlinePinsKey) localStorage.removeItem(offlinePinsKey);
            if (offlineExcludesKey) localStorage.removeItem(offlineExcludesKey);
            if (pendingOpsKey) localStorage.removeItem(pendingOpsKey);

            // Clear in-memory cache tracking and re-render
            window._offlineCacheIds = new Set();
            window._offlinePinnedIds = new Set();
            window._offlineExcludedIds = new Set();

            // Re-render entries to update UI button states
            if (typeof renderEntries === 'function') {
                renderEntries();
            }

            setStatus('Local cache cleared. Offline data has been removed.', 'success');
        };

        // Load and apply settings on page load
        applySettings(loadSettings());

        // Render tag management list for settings tab
        function renderTagManagementList() {
            const container = document.getElementById('tags-management-list');
            if (!container) return;

            const allTags = getAllTags();

            if (allTags.length === 0) {
                container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-sm">No tags yet. Add tags to entries to manage them here.</p>';
                return;
            }

            let html = '<div class="space-y-2">';
            allTags.forEach(tag => {
                const entriesWithTag = (window._allEntries || []).filter(e => {
                    return (e.tags || []).map(t => t.toLowerCase()).includes(tag.toLowerCase());
                });
                const count = entriesWithTag.length;

                html += `
                    <div class="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition">
                        <div class="flex-1">
                            <div class="font-medium text-gray-800 dark:text-white">${tag}</div>
                            <div class="text-xs text-gray-600 dark:text-gray-400">${count} ${count === 1 ? 'entry' : 'entries'}</div>
                        </div>
                        <div class="flex gap-2">
                            <button type="button" class="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600 transition" onclick="removeTagFromAllEntries('${tag.replace(/'/g, "\\'")}');">
                                Remove
                            </button>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
            container.innerHTML = html;
        }

        // Remove a tag from all entries
        window.removeTagFromAllEntries = async function (tag) {
            if (!confirm(`Remove the tag "${tag}" from all ${(window._allEntries || []).filter(e => (e.tags || []).map(t => t.toLowerCase()).includes(tag.toLowerCase())).length} entries?`)) {
                return;
            }

            const normalizedTag = tag.toLowerCase();
            const batch = db.batch();
            let updateCount = 0;

            // Update all entries that have this tag
            (window._allEntries || []).forEach(entry => {
                if ((entry.tags || []).map(t => t.toLowerCase()).includes(normalizedTag)) {
                    const updatedTags = (entry.tags || []).filter(t => t.toLowerCase() !== normalizedTag);
                    batch.update(
                        db.collection('users')
                            .doc(auth.currentUser.uid)
                            .collection('gratitude')
                            .doc(entry.id),
                        { tags: updatedTags }
                    );
                    // Update in-memory copy
                    entry.tags = updatedTags;
                    updateCount++;
                }
            });

            if (updateCount > 0) {
                try {
                    await batch.commit();
                    window._allTags = null; // Clear tag cache
                    renderTagManagementList(); // Refresh the list
                    setStatus(`Removed tag "${tag}" from ${updateCount} ${updateCount === 1 ? 'entry' : 'entries'}.`, 'success');
                } catch (err) {
                    console.error('Error removing tag:', err);
                    setStatus('Error removing tag. Please try again.', 'error');
                }
            }
        };

        // Initialize tag UI handlers
        const addTagBtn = document.getElementById('add-tag-btn');
        const tagInput = document.getElementById('tag-input');
        const tagSuggestionList = document.getElementById('tag-suggestion-list');
        const editTagSuggestionList = document.getElementById('edit-tag-suggestion-list');
        const tagsFilterBtn = document.getElementById('tags-filter-btn');
        const tagsFilterModal = document.getElementById('tags-filter-modal');
        const closeTagsFilterModalBtn = document.getElementById('close-tags-filter-modal');
        const clearTagsFilterBtn = document.getElementById('clear-tags-filter-btn');

        if (addTagBtn && tagInput) {
            const addTagHandler = () => {
                const tag = tagInput.value.trim();
                if (tag) {
                    addTagToEntry(tag);
                    tagInput.value = '';
                    tagInput.focus();
                    updateTagSuggestionList(tagInput, 'tag-suggestion-list', window._currentEntryTags || []);
                }
            };
            addTagBtn.onclick = addTagHandler;
            tagInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addTagHandler();
                }
            });
            tagInput.addEventListener('input', () => {
                updateTagSuggestionList(tagInput, 'tag-suggestion-list', window._currentEntryTags || []);
            });
            tagInput.addEventListener('focus', () => {
                updateTagSuggestionList(tagInput, 'tag-suggestion-list', window._currentEntryTags || []);
            });
            if (tagSuggestionList) {
                updateTagSuggestionList(tagInput, 'tag-suggestion-list', window._currentEntryTags || []);
            }
        }

        if (editTagInput) {
            editTagInput.addEventListener('input', () => {
                updateTagSuggestionList(editTagInput, 'edit-tag-suggestion-list', window._editingEntryTags || []);
            });
            editTagInput.addEventListener('focus', () => {
                updateTagSuggestionList(editTagInput, 'edit-tag-suggestion-list', window._editingEntryTags || []);
            });
            if (editTagSuggestionList) {
                updateTagSuggestionList(editTagInput, 'edit-tag-suggestion-list', window._editingEntryTags || []);
            }
        }

        if (tagsFilterBtn && tagsFilterModal) {
            tagsFilterBtn.onclick = async () => {
                // Check if tags are enabled before allowing filter
                const settings = JSON.parse(localStorage.getItem('gj_user_settings') || '{}');
                if (settings.tagsEnabled === false) {
                    return;
                }

                // Fetch all entries to ensure we get tags from all entries, not just loaded 20
                if (!window._allEntriesLoaded) {
                    await fetchAllEntries();
                }
                // Clear tag cache to ensure fresh calculation from current entries
                window._allTags = null;
                renderTagFilterOptions();
                tagsFilterModal.classList.remove('hidden');
                // Scroll modal into view on mobile
                setTimeout(() => {
                    tagsFilterModal.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 0);
            };

            // Ensure button visibility is set based on tags setting on page load
            const settings = JSON.parse(localStorage.getItem('gj_user_settings') || '{}');
            if (settings.tagsEnabled === false) {
                tagsFilterBtn.style.display = 'none';
            }
        }

        if (closeTagsFilterModalBtn && tagsFilterModal) {
            closeTagsFilterModalBtn.onclick = () => {
                tagsFilterModal.classList.add('hidden');
            };
        }

        if (tagsFilterModal) {
            tagsFilterModal.addEventListener('click', (e) => {
                if (e.target === tagsFilterModal) {
                    tagsFilterModal.classList.add('hidden');
                }
            });
        }

        if (clearTagsFilterBtn) {
            clearTagsFilterBtn.onclick = () => {
                clearTagFilters();
                if (tagsFilterModal) tagsFilterModal.classList.add('hidden');
            };
        } else {
            console.warn('Settings modal elements not fully found in DOM');
        }

        // Handle View All Prompts
        const viewAllPromptsBtn = document.getElementById('view-all-prompts-btn');
        const allPromptsModal = document.getElementById('all-prompts-modal');
        const closeAllPromptsBtn = document.getElementById('close-all-prompts-modal');
        const promptsList = document.getElementById('prompts-list');

        function renderAllPrompts() {
            if (!promptsList) return;
            const todayIndex = getTodayPromptIndex();
            promptsList.innerHTML = GRATITUDE_PROMPTS.map((prompt, index) => {
                const isToday = index === todayIndex;
                return `
                    <div class="p-4 rounded-lg ${isToday
                        ? 'bg-blue-100 dark:bg-blue-900 border-2 border-primary'
                        : 'bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600'
                    }">
                        <div class="flex items-start justify-between gap-3">
                            <div class="flex-1">
                                <p class="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">
                                    Prompt ${index + 1}
                                    ${isToday ? '<span class="ml-2 text-primary font-bold">• Today</span>' : ''}
                                </p>
                                <p class="text-gray-800 dark:text-gray-100">${prompt}</p>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        if (viewAllPromptsBtn && allPromptsModal) {
            viewAllPromptsBtn.onclick = () => {
                renderAllPrompts();
                allPromptsModal.classList.remove('hidden');
                // Scroll modal into view on mobile
                setTimeout(() => {
                    allPromptsModal.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 0);
            };

            closeAllPromptsBtn.onclick = () => {
                allPromptsModal.classList.add('hidden');
            };

            allPromptsModal.onclick = (e) => {
                if (e.target === allPromptsModal) {
                    allPromptsModal.classList.add('hidden');
                }
            };
        }
    }
});
