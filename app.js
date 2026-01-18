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

// Simple encryption (for MVP; use stronger encryption for production)
// AES encryption using CryptoJS
function encrypt(text, key) {
    // Use SHA256 to derive a key from password
    const hashedKey = CryptoJS.SHA256(key).toString();
    const ciphertext = CryptoJS.AES.encrypt(text, hashedKey).toString();
    return ciphertext;
}

function decrypt(data, key) {
    try {
        const hashedKey = CryptoJS.SHA256(key).toString();
        const bytes = CryptoJS.AES.decrypt(data, hashedKey);
        const plaintext = bytes.toString(CryptoJS.enc.Utf8);
        return plaintext;
    } catch (e) {
        return '[Decryption failed]';
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

let userKey = '';

// Favorite filter toggle
window._showFavoritesOnly = false;
const favoritesToggle = document.getElementById('favorites-toggle');
if (favoritesToggle) {
    favoritesToggle.onclick = () => {
        window._showFavoritesOnly = !window._showFavoritesOnly;
        favoritesToggle.textContent = window._showFavoritesOnly ? '★ Show All Entries' : '★ Show Favorites Only';
        renderEntries();
    };
}

// Show/hide forms
showRegisterBtn.onclick = () => {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
    resetForm.style.display = 'none';
    errorMsg.textContent = '';
};
showLoginBtn.onclick = () => {
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    resetForm.style.display = 'none';
    errorMsg.textContent = '';
};
showLoginBtn2.onclick = () => {
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    resetForm.style.display = 'none';
    errorMsg.textContent = '';
};
showResetBtn.onclick = () => {
    loginForm.style.display = 'none';
    registerForm.style.display = 'none';
    resetForm.style.display = 'block';
    errorMsg.textContent = '';
};

// Login logic
loginBtn.onclick = async () => {
    errorMsg.textContent = '';
    loadingMsg.style.display = 'block';
    loginBtn.disabled = true;
    const email = emailInput.value;
    const password = passwordInput.value;
    userKey = password;
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
            // Successful login, refresh page
            window.location.reload();
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
        errorMsg.style.color = 'green';
        errorMsg.textContent = 'Registration successful! Please check your email to verify your account.';
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
        errorMsg.style.color = 'green';
        errorMsg.textContent = 'Password reset email sent! Please check your inbox.';
    } catch (e) {
        errorMsg.style.color = 'red';
        errorMsg.textContent = e.message;
        console.error('Password reset error:', e);
    }
    loadingMsg.style.display = 'none';
    resetBtn.disabled = false;
};

logoutBtn.onclick = () => {
    auth.signOut();
};

auth.onAuthStateChanged(async user => {
    const exportBtn = document.getElementById('export-csv-btn');
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    if (user) {
        authSection.style.display = 'none';
        journalSection.style.display = 'block';
        // Show export buttons
        if (exportBtn) exportBtn.style.display = '';
        if (exportPdfBtn) exportPdfBtn.style.display = '';

        // Initialize user document if it doesn't exist
        try {
            await db.collection('users').doc(user.uid).set({
                daysJournaled: 0
            }, { merge: true });
        } catch (err) {
            console.error('Error initializing user doc:', err);
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
        try {
            // Use set with merge to ensure the document exists and field is written
            await db.collection('users').doc(auth.currentUser.uid).set({
                daysJournaled: window._daysJournaled
            }, { merge: true });
        } catch (err) {
            console.error('Error writing daysJournaled:', err);
        }
    }

    gratitudeInput.value = '';
    // Update cache and UI without re-reading from Firestore
    window._allEntries = [
        {
            id: Math.random().toString(36).substr(2, 9), // temp id
            text: entry,
            created: new Date(),
            starred: false
        },
        ...(window._allEntries || [])
    ].slice(0, 20);
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

    daysJournaledEl.textContent = window._daysJournaled || '0';

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

async function loadEntries() {
    // Use cache unless forced refresh
    if (window._allEntries && !arguments[0]) {
        updateProgressInfo();
        renderEntries();
        if (window._currentView === 'calendar') {
            renderCalendarView();
        }
        return;
    }
    // Load user data to get daysJournaled counter
    const userDoc = await db.collection('users').doc(auth.currentUser.uid).get();
    window._daysJournaled = userDoc.exists ? (userDoc.data().daysJournaled || 0) : 0;
    const snap = await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('gratitude')
        .orderBy('created', 'desc')
        .limit(20)
        .get();
    window._allEntries = [];
    snap.forEach(doc => {
        const data = doc.data();
        window._allEntries.push({
            id: doc.id,
            text: decrypt(data.entry, userKey),
            created: data.created && data.created.toDate ? data.created.toDate() : (data.created instanceof Date ? data.created : new Date(data.created)),
            starred: !!data.starred
        });
    });
    updateProgressInfo();
    renderEntries();
    if (window._currentView === 'calendar') {
        renderCalendarView();
    }
}

function renderEntries() {
    let entries = window._allEntries || [];
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
    if (window._showFavoritesOnly) {
        entries = entries.filter(e => e.starred);
    }
    if (keyword) {
        entries = entries.filter(e => e.text.toLowerCase().includes(keyword));
    }
    if (dateVal) {
        entries = entries.filter(e => {
            if (!e.created) return false;
            const entryDate = e.created instanceof Date ? e.created : new Date(e.created);
            // Compare only date part
            const yyyy = entryDate.getFullYear();
            const mm = String(entryDate.getMonth() + 1).padStart(2, '0');
            const dd = String(entryDate.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}` === dateVal;
        });
    }
    entriesList.innerHTML = '';
    entries.forEach(e => {
        const li = document.createElement('li');
        li.className = "bg-gray-100 dark:bg-darkcard text-gray-800 dark:text-gray-100 rounded px-4 py-3 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2";

        // Date stamp
        const dateSpan = document.createElement('span');
        if (e.created) {
            const d = e.created instanceof Date ? e.created : new Date(e.created);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            dateSpan.textContent = `${yyyy}-${mm}-${dd}`;
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
        };
        closeCalendarBtn.onclick = () => {
            calendarModal.classList.add('hidden');
            window._currentView = 'list';
        };
    }

    function renderCalendarView() {
        const calendarView = document.getElementById('calendar-view');
        const entries = window._allEntries || [];
        if (!calendarView) return;
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
                document.getElementById('date-filter').value = btn.getAttribute('data-date');
                calendarModal.classList.add('hidden');
                window._currentView = 'calendar'; // Stay in calendar filter mode
                renderEntries();
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
    }
}

// Attach search and date filter listeners
window.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const dateFilter = document.getElementById('date-filter');
    const exportBtn = document.getElementById('export-csv-btn');
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    if (searchInput) searchInput.addEventListener('input', renderEntries);
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
        };
        closeCalendarBtn.onclick = () => {
            calendarModal.classList.add('hidden');
            window._currentView = 'list';
        };
    }
});

function exportEntriesPDF() {
    const entries = window._allEntries || [];
    if (!entries.length) {
        alert('No entries to export.');
        return;
    }
    // Use jsPDF
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = 22;

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Gratitude Journal', pageWidth / 2, y, { align: 'center' });
    y += 10;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text('Exported Entries', pageWidth / 2, y, { align: 'center' });
    y += 8;
    doc.setDrawColor(180);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
    doc.setTextColor(30);

    // Write entries to PDF
    doc.setFontSize(11);
    entries.forEach(e => {
        let dateStr = '';
        if (e.created) {
            const d = e.created instanceof Date ? e.created : new Date(e.created);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            dateStr = `${yyyy}-${mm}-${dd}`;
        }
        let displayText = e.text;
        try {
            displayText = decodeURIComponent(displayText);
        } catch { }
        // Wrap long text
        const entryLines = doc.splitTextToSize(displayText, doc.internal.pageSize.getWidth() - margin * 2 - 30);
        doc.setFont('helvetica', 'bold');
        doc.text(dateStr, margin, y);
        doc.setFont('helvetica', 'normal');
        doc.text(entryLines, margin + 30, y);
        y += entryLines.length * 7 + 4;
        // Add page if needed
        if (y > doc.internal.pageSize.getHeight() - 20) {
            doc.addPage();
            y = 22;
        }
    });
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' });
    }

    doc.save('gratitude_entries.pdf');
}

function exportEntriesCSV() {
    const entries = window._allEntries || [];
    if (!entries.length) {
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
            await db.collection('users').doc(auth.currentUser.uid).update({
                daysJournaled: firebase.firestore.FieldValue.increment(-1)
            });
        }
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
