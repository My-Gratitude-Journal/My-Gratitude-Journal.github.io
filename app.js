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
let userKey = sessionStorage.getItem(USER_KEY_STORAGE) || '';
let legacyKey = sessionStorage.getItem(LEGACY_KEY_STORAGE) || '';
let pendingPassword = '';

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
    // Fallback to legacy key if present (for pre-PBKDF2 entries)
    if (legacyKey) {
        try {
            const legacy = tryDecryptWithKey(data, legacyKey);
            if (legacy) return legacy;
        } catch { /* ignore */ }
    }
    return '[Decryption failed]';
}

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
const deleteAccountBtn = document.getElementById('delete-account-btn');

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
        info: '#0c4a6e'
    };
    const bgPalette = {
        success: '#d4edda',
        info: '#e0f2fe'
    };
    statusMsg.style.color = palette[type] || palette.info;
    statusMsg.style.backgroundColor = bgPalette[type] || bgPalette.info;
    statusMsg.style.border = `1px solid ${(palette[type] || palette.info)}30`;
    statusMsg.textContent = message;
    statusMsg.style.display = 'block';
    // Auto-clear after a short delay
    statusTimer = setTimeout(() => {
        statusMsg.style.display = 'none';
        statusTimer = null;
    }, 4000);
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

// Login logic
loginBtn.onclick = async () => {
    errorMsg.textContent = '';
    loadingMsg.style.display = 'block';
    loginBtn.disabled = true;
    const email = emailInput.value;
    const password = passwordInput.value;
    pendingPassword = password;
    legacyKey = normalizeKey(password);
    sessionStorage.setItem(LEGACY_KEY_STORAGE, legacyKey);
    // Clear any stale derived key; will derive once salt is loaded
    userKey = '';
    sessionStorage.removeItem(USER_KEY_STORAGE);
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
            console.error('Error initializing user doc:', err);
        }

        // Derive userKey if missing but password is available
        if (!userKey) {
            if (!pendingPassword) {
                const pwd = prompt('Enter your password to decrypt your entries:');
                if (pwd) {
                    pendingPassword = pwd;
                    legacyKey = normalizeKey(pwd);
                    sessionStorage.setItem(LEGACY_KEY_STORAGE, legacyKey);
                } else {
                    setStatus('Enter your password to view entries.', 'info');
                    hideLoading();
                    return;
                }
            }
            if (pendingPassword && userSalt) {
                userKey = deriveKeyFromPassword(pendingPassword, userSalt);
                sessionStorage.setItem(USER_KEY_STORAGE, userKey);
                pendingPassword = '';
            }
        }

        // Read most recent entries
        loadEntries(true);
        logoutBtn.style.display = 'inline-block';
        deleteAccountBtn.style.display = 'inline-block';
    } else {
        authSection.style.display = 'block';
        journalSection.style.display = 'none';
        entriesList.innerHTML = '';
        logoutBtn.style.display = 'none';
        deleteAccountBtn.style.display = 'none';
        // Clear cached entries
        window._allEntries = [];
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

    // Delete Account logic
    deleteAccountBtn.onclick = async () => {
        if (!confirm('Are you sure you want to delete your account and all your data? This cannot be undone.')) return;
        try {
            const user = auth.currentUser;
            // Delete all gratitude entries (subcollection)
            const entriesSnap = await db.collection('users').doc(user.uid).collection('gratitude').get();
            const batch = db.batch();
            entriesSnap.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            // Delete user document
            await db.collection('users').doc(user.uid).delete();
            // Delete Auth user
            await user.delete();
            alert('Account and all data deleted.');
            sessionStorage.removeItem(USER_KEY_STORAGE);
            sessionStorage.removeItem(LEGACY_KEY_STORAGE);
            pendingPassword = '';
            legacyKey = '';
            userSalt = null;
        } catch (e) {
            if (e.code === 'auth/requires-recent-login') {
                alert('Please log in again before deleting your account.');
            } else {
                alert('Error deleting account: ' + e.message);
            }
            console.error('Delete account error:', e);
        }
    };
});

gratitudeForm.onsubmit = async (e) => {
    e.preventDefault();
    const entry = gratitudeInput.value.trim();
    if (!entry) return;
    const encrypted = encrypt(entry, userKey);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    // Check if user already has an entry today
    const existingTodayEntry = (window._allEntries || []).some(e => {
        const eDate = e.created instanceof Date ? e.created : new Date(e.created);
        eDate.setHours(0, 0, 0, 0);
        return eDate.toISOString().slice(0, 10) === todayStr;
    });

    await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('gratitude')
        .add({
            entry: encrypted,
            created: new Date(),
            starred: false
        });

    // Increment days journaled counter if this is the first entry of the day
    if (!existingTodayEntry) {
        window._daysJournaled = (window._daysJournaled || 0) + 1;
    }

    // Always increment total entries counter
    window._totalEntries = (window._totalEntries || 0) + 1;

    try {
        // Use set with merge to ensure the document exists and fields are written
        await db.collection('users').doc(auth.currentUser.uid).set({
            daysJournaled: window._daysJournaled,
            totalEntries: window._totalEntries
        }, { merge: true });
    } catch (err) {
        console.error('Error writing counters:', err);
    }

    gratitudeInput.value = '';
    // Update cache and UI without re-reading from Firestore
    const newEntry = {
        id: Math.random().toString(36).substr(2, 9), // temp id
        text: entry,
        created: new Date(),
        starred: false
    };
    window._allEntries = [newEntry, ...(window._allEntries || [])];

    // Only keep the limit if we haven't loaded all entries yet
    if (!window._allEntriesLoaded) {
        window._allEntries = window._allEntries.slice(0, 20);
    }
    updateProgressInfo();
    renderEntries();
};

// Progress info (streaks, total)
function updateProgressInfo() {
    const entries = window._allEntries || [];
    const streakCountEl = document.getElementById('streak-count');
    const longestStreakEl = document.getElementById('longest-streak');
    const daysJournaledEl = document.getElementById('days-journaled');
    const totalEntriesEl = document.getElementById('total-entries');

    if (daysJournaledEl) {
        daysJournaledEl.textContent = window._daysJournaled || '0';
    }

    // Display the total entries from the Firebase counter
    if (totalEntriesEl) {
        totalEntriesEl.textContent = window._totalEntries || '0';
    }

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
    // Load user data to get counters
    try {
        const userDoc = await db.collection('users').doc(auth.currentUser.uid).get();
        window._daysJournaled = userDoc.exists ? (userDoc.data().daysJournaled || 0) : 0;
        window._totalEntries = userDoc.exists ? (userDoc.data().totalEntries || 0) : 0;
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
                starred: !!data.starred
            });
        });
        updateProgressInfo();
        renderEntries();
        if (window._currentView === 'calendar') {
            renderCalendarView();
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
                    starred: !!data.starred
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
                starred: !!data.starred
            });
        });
        return allEntries;
    } catch (e) {
        console.error('Error fetching all entries:', e);
        return [];
    }
}

function renderEntries() {
    let entries = window._allEntries || [];
    console.log('renderEntries called, total entries available:', entries.length);
    updateShowAllEntriesBtn();
    // Disable 'Show All Entries' button if all entries are already shown
    function updateShowAllEntriesBtn() {
        const viewListBtn = document.getElementById('view-list-btn');
        const dateFilter = document.getElementById('date-filter');
        const searchInput = document.getElementById('search-input');
        const isFiltered = (dateFilter && dateFilter.value) || (searchInput && searchInput.value.trim()) || window._showFavoritesOnly;
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
    console.log('Filter values - dateVal:', dateVal, 'keyword:', keyword, 'favorites:', window._showFavoritesOnly);
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
    entriesList.innerHTML = '';
    entries.forEach(e => {
        const li = document.createElement('li');
        li.className = "bg-gray-100 dark:bg-darkcard text-gray-800 dark:text-gray-100 rounded px-4 py-3 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2";

        // Date stamp
        const dateSpan = document.createElement('span');
        if (e.created) {
            const d = e.created instanceof Date ? e.created : new Date(e.created);
            dateSpan.textContent = d.toLocaleDateString();
        } else {
            dateSpan.textContent = '';
        }
        dateSpan.className = "text-xs text-gray-500 dark:text-gray-400 mr-3 min-w-[90px] font-mono";

        // Entry text (support multiline and decode URL-encoded newlines)
        const entryText = document.createElement('span');
        entryText.className = "flex-1 whitespace-pre-line";
        let displayText = e.text;
        try {
            displayText = decodeURIComponent(displayText);
        } catch { }
        entryText.innerText = displayText;

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
            renderEntries();
            // Update Firestore in background
            toggleStarEntry(entryId, newStarValue).catch(() => {
                // Revert on error
                entry.starred = prevStar;
                renderEntries();
                alert('Failed to update favorite. Please try again.');
            });
        }

        // Buttons container
        const btns = document.createElement('div');
        btns.className = "flex gap-2 mt-2 sm:mt-0";
        btns.appendChild(starBtn);
        // Edit button
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.className = "px-3 py-1 rounded bg-yellow-400 text-gray-900 hover:bg-yellow-500 text-xs font-semibold";
        editBtn.onclick = () => openEditModal(e.id, e.text);
        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.className = "px-3 py-1 rounded bg-red-500 text-white hover:bg-red-700 text-xs font-semibold";
        deleteBtn.onclick = () => deleteEntry(e.id);
        btns.appendChild(editBtn);
        btns.appendChild(deleteBtn);

        // Layout: [date] [entry text] [buttons]
        li.appendChild(dateSpan);
        li.appendChild(entryText);
        li.appendChild(btns);
        entriesList.appendChild(li);
    });
    // Star/unstar entry
    async function toggleStarEntry(entryId, star) {
        await db.collection('users')
            .doc(auth.currentUser.uid)
            .collection('gratitude')
            .doc(entryId)
            .update({ starred: star });
        // No need to reload entries here; optimistic UI handles it
    }
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
    }

    // Show/hide Load More button
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
        // Show button only if:
        // 1. We have 20 entries (suggesting there might be more)
        // 2. We're not filtering (no search, date filter, or favorites only)
        // 3. We haven't loaded all entries yet
        const allEntriesCount = window._allEntries ? window._allEntries.length : 0;
        const isFiltered = (dateVal) || (keyword) || (window._showFavoritesOnly);
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
    }

    // Wire PDF Settings modal controls
    const settingsModal = document.getElementById('pdf-settings-modal');
    const saveBtn = document.getElementById('pdf-settings-save');
    const cancelBtn = document.getElementById('pdf-settings-cancel');
    const defaultsBtn = document.getElementById('pdf-settings-defaults');
    if (settingsModal && saveBtn && cancelBtn && defaultsBtn) {
        cancelBtn.onclick = () => settingsModal.classList.add('hidden');
        defaultsBtn.onclick = () => {
            const s = DEFAULT_PDF_SETTINGS;
            setPdfSettings(s);
            populatePdfSettingsForm(s);
        };
        saveBtn.onclick = () => {
            const s = readPdfSettingsForm();
            setPdfSettings(s);
            settingsModal.classList.add('hidden');
        };
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
    favoritesOnly: false
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
    if (pageSize) pageSize.value = s.format;
    if (orientation) orientation.value = s.orientation;
    if (margin) margin.value = String(s.margin);
    if (layout) layout.value = s.layout;
    if (showHeader) showHeader.checked = !!s.showHeader;
    if (customTitle) customTitle.value = s.customTitle || '';
    if (colorStyle) colorStyle.checked = !!s.colorStyle;
    if (favoritesOnly) favoritesOnly.checked = !!s.favoritesOnly;
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
    return {
        format: pageSize ? pageSize.value : DEFAULT_PDF_SETTINGS.format,
        orientation: orientation ? orientation.value : DEFAULT_PDF_SETTINGS.orientation,
        margin: margin ? Number(margin.value) : DEFAULT_PDF_SETTINGS.margin,
        layout: layout ? layout.value : DEFAULT_PDF_SETTINGS.layout,
        showHeader: showHeader ? !!showHeader.checked : DEFAULT_PDF_SETTINGS.showHeader,
        customTitle: customTitle ? (customTitle.value || '').trim() : DEFAULT_PDF_SETTINGS.customTitle,
        colorStyle: colorStyle ? !!colorStyle.checked : DEFAULT_PDF_SETTINGS.colorStyle,
        favoritesOnly: favoritesOnly ? !!favoritesOnly.checked : DEFAULT_PDF_SETTINGS.favoritesOnly
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
            alert('No entries to export.');
            return;
        }

        const settings = getPdfSettings();

        // Filter by favorites if enabled
        let entries = allEntries;
        if (settings.favoritesOnly) {
            entries = allEntries.filter(e => e.starred);
            if (!entries.length) {
                alert('No starred entries to export.');
                return;
            }
        }

        // Prefer styled HTML → PDF via html2pdf if available
        const canUseHtml2pdf = !!(window.html2pdf);
        if (canUseHtml2pdf) {
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

                const card = document.createElement('div');
                if (settings.layout === 'compact') {
                    card.className = 'border-b border-gray-200 pb-2';
                } else {
                    card.className = 'rounded-xl shadow-sm p-4';
                    if (settings.colorStyle) {
                        card.style.cssText = 'border: 2px solid #6495DC; background-color: #E6F0FF;';
                    } else {
                        card.style.cssText = 'border: 1px solid #E5E7EB; background-color: #F8F8F8;';
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

                card.appendChild(dateEl);
                card.appendChild(textEl);
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
        fallbackJsPdfExport(entries);
    } catch (e) {
        console.error('Error exporting PDF:', e);
        alert('Failed to export PDF. Please try again.');
    }
}

function fallbackJsPdfExport(entries) {
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
        const cardPadding = 5;
        const cardHeight = (lineHeight * lines.length) + cardPadding * 2 + 6; // 6 for date

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
    });
}

function showPdfPreview(blobUrl, filename, onClose) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pdf-preview-title');

    const modal = document.createElement('div');
    modal.className = 'bg-white dark:bg-darkcard rounded-2xl shadow-2xl w-full max-w-4xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700';
    const h = document.createElement('h2');
    h.id = 'pdf-preview-title';
    h.className = 'text-lg font-bold text-gray-800 dark:text-gray-100';
    h.textContent = 'PDF Preview';
    const actions = document.createElement('div');
    actions.className = 'flex gap-2';
    const downloadBtn = document.createElement('a');
    downloadBtn.className = 'px-4 py-2 bg-primary text-white rounded hover:bg-blue-600 font-semibold';
    downloadBtn.href = blobUrl;
    downloadBtn.download = filename || 'export.pdf';
    downloadBtn.textContent = 'Download';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded hover:bg-gray-300 dark:hover:bg-gray-600 font-medium';
    closeBtn.textContent = 'Close';
    actions.appendChild(downloadBtn);
    actions.appendChild(closeBtn);
    header.appendChild(h);
    header.appendChild(actions);

    const frame = document.createElement('iframe');
    frame.className = 'w-full h-[70vh]';
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
                alert('No starred entries to export.');
                return;
            }
        } else if (!entries.length) {
            alert('No entries to export.');
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

    // Find the entry to get its date
    const entryToDelete = (window._allEntries || []).find(e => e.id === entryId);
    const entryDate = entryToDelete ? new Date(entryToDelete.created) : null;
    if (entryDate) {
        entryDate.setHours(0, 0, 0, 0);
    }
    const entryDateStr = entryDate ? entryDate.toISOString().slice(0, 10) : null;

    await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('gratitude')
        .doc(entryId)
        .delete();

    // Decrement total entries counter
    window._totalEntries = Math.max(0, (window._totalEntries || 0) - 1);

    let decrementDaysJournaled = false;

    // Check if there are other entries on the same day
    if (entryDateStr) {
        const otherEntriesSameDay = (window._allEntries || []).filter(e => {
            if (e.id === entryId) return false;
            const eDate = e.created instanceof Date ? e.created : new Date(e.created);
            eDate.setHours(0, 0, 0, 0);
            return eDate.toISOString().slice(0, 10) === entryDateStr;
        }).length > 0;

        // Decrement days journaled if no other entries on this day
        if (!otherEntriesSameDay) {
            window._daysJournaled = Math.max(0, (window._daysJournaled || 0) - 1);
            decrementDaysJournaled = true;
        }
    }

    // Update both counters in Firestore
    try {
        await db.collection('users').doc(auth.currentUser.uid).update({
            daysJournaled: firebase.firestore.FieldValue.increment(decrementDaysJournaled ? -1 : 0),
            totalEntries: firebase.firestore.FieldValue.increment(-1)
        });
    } catch (err) {
        console.error('Error updating counters:', err);
    }

    // Remove from cache and update UI
    window._allEntries = (window._allEntries || []).filter(e => e.id !== entryId);
    updateProgressInfo();
    renderEntries();
}

// Edit entry modal logic
let editingEntryId = null;
const editModal = document.getElementById('edit-modal');
const editEntryInput = document.getElementById('edit-entry-input');
const saveEditBtn = document.getElementById('save-edit-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');

function openEditModal(entryId, entryText) {
    editingEntryId = entryId;
    editEntryInput.value = decodeURIComponent(entryText);
    editModal.classList.remove('hidden');
    setTimeout(() => editEntryInput.focus(), 0);
}

cancelEditBtn.onclick = () => {
    editModal.classList.add('hidden');
    editingEntryId = null;
};

saveEditBtn.onclick = async () => {
    const newText = editEntryInput.value.trim();
    if (!newText || !editingEntryId) return;
    const encrypted = encrypt(newText, userKey);
    await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('gratitude')
        .doc(editingEntryId)
        .update({ entry: encrypted });
    // Update cache and UI
    window._allEntries = (window._allEntries || []).map(e =>
        e.id === editingEntryId ? { ...e, text: newText } : e
    );
    editModal.classList.add('hidden');
    editingEntryId = null;
    updateProgressInfo();
    renderEntries();
};

// Privacy Notice modal logic
document.addEventListener('DOMContentLoaded', function () {
    const showPrivacyBtn = document.getElementById('show-privacy-btn');
    const privacyModal = document.getElementById('privacy-modal');
    const closePrivacyBtn = document.getElementById('close-privacy-btn');
    if (showPrivacyBtn && privacyModal && closePrivacyBtn) {
        showPrivacyBtn.onclick = () => {
            privacyModal.classList.remove('hidden');
        };
        closePrivacyBtn.onclick = () => {
            privacyModal.classList.add('hidden');
        };
        // Optional: close modal when clicking outside
        privacyModal.onclick = (e) => {
            if (e.target === privacyModal) privacyModal.classList.add('hidden');
        };
    }
});
