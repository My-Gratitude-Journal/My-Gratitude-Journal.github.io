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
function encrypt(text, key) {
    return btoa(encodeURIComponent(text + key));
}
function decrypt(data, key) {
    try {
        return decodeURIComponent(escape(atob(data))).replace(key, "");
    } catch {
        return "";
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

auth.onAuthStateChanged(user => {
    if (user) {
        authSection.style.display = 'none';
        journalSection.style.display = 'block';
        loadEntries();
        logoutBtn.style.display = 'inline-block';
        deleteAccountBtn.style.display = 'inline-block';
    } else {
        authSection.style.display = 'block';
        journalSection.style.display = 'none';
        entriesList.innerHTML = '';
        logoutBtn.style.display = 'none';
        deleteAccountBtn.style.display = 'none';
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
    await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('gratitude')
        .add({
            entry: encrypted,
            created: new Date()
        });
    gratitudeInput.value = '';
    loadEntries();
};

async function loadEntries() {
    const snap = await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('gratitude')
        .orderBy('created', 'desc')
        .get();
    // Store all entries in memory for filtering
    window._allEntries = [];
    snap.forEach(doc => {
        const data = doc.data();
        window._allEntries.push({
            id: doc.id,
            text: decrypt(data.entry, userKey),
            created: data.created && data.created.toDate ? data.created.toDate() : (data.created instanceof Date ? data.created : new Date(data.created)),
        });
    });
    renderEntries();
}

function renderEntries() {
    const entriesList = document.getElementById('entries-list');
    const searchInput = document.getElementById('search-input');
    const dateFilter = document.getElementById('date-filter');
    let entries = window._allEntries || [];
    const keyword = (searchInput && searchInput.value.trim().toLowerCase()) || '';
    const dateVal = dateFilter && dateFilter.value;
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
            // Decode %0A and other URL-encoded characters
            displayText = decodeURIComponent(displayText);
        } catch { }
        entryText.innerText = displayText;

        // Buttons container
        const btns = document.createElement('div');
        btns.className = "flex gap-2 mt-2 sm:mt-0";
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
});

function exportEntriesCSV() {
    const entries = window._allEntries || [];
    if (!entries.length) {
        alert('No entries to export.');
        return;
    }
    // CSV header
    let csv = 'Date,Entry\n';
    entries.forEach(e => {
        let dateStr = '';
        if (e.created) {
            const d = e.created instanceof Date ? e.created : new Date(e.created);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            dateStr = `${yyyy}-${mm}-${dd}`;
        }
        // Decode URL-encoded newlines, escape quotes/commas, preserve newlines
        let entryText = e.text || '';
        try {
            entryText = decodeURIComponent(entryText);
        } catch { }
        entryText = entryText.replace(/"/g, '""');
        if (entryText.includes(',') || entryText.includes('"') || entryText.includes('\n')) {
            entryText = `"${entryText.replace(/\r?\n/g, '\r\n')}"`;
        }
        csv += `${dateStr},${entryText}\n`;
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

function exportEntriesPDF() {
    const entries = window._allEntries || [];
    if (!entries.length) {
        alert('No entries to export.');
        return;
    }
    // Use jsPDF
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFont('helvetica');
    doc.setFontSize(12);
    doc.text('Gratitude Journal Entries', 10, 15);
    let y = 25;
    entries.forEach((e, i) => {
        let dateStr = '';
        if (e.created) {
            const d = e.created instanceof Date ? e.created : new Date(e.created);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            dateStr = `${yyyy}-${mm}-${dd}`;
        }
        // Decode URL-encoded newlines, split into lines, preserve user line breaks
        let entryText = e.text || '';
        try {
            entryText = decodeURIComponent(entryText);
        } catch { }
        const entryRawLines = entryText.split(/\r?\n/);
        let entryLines = [];
        entryRawLines.forEach(rawLine => {
            entryLines = entryLines.concat(doc.splitTextToSize(rawLine, 170));
        });
        doc.text(`${dateStr}:`, 10, y);
        y += 6;
        entryLines.forEach(line => {
            doc.text(line, 20, y);
            y += 6;
        });
        y += 4;
        // Add new page if needed
        if (y > 270 && i < entries.length - 1) {
            doc.addPage();
            y = 15;
        }
    });
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
    await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('gratitude')
        .doc(entryId)
        .delete();
    loadEntries();
}

// ...existing code...

// Delete entry
async function deleteEntry(entryId) {
    if (!confirm('Delete this entry?')) return;
    await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('gratitude')
        .doc(entryId)
        .delete();
    loadEntries();
}

// Edit entry modal logic
let editingEntryId = null;
const editModal = document.getElementById('edit-modal');
const editEntryInput = document.getElementById('edit-entry-input');
const saveEditBtn = document.getElementById('save-edit-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');

function openEditModal(entryId, entryText) {
    editingEntryId = entryId;
    editEntryInput.value = entryText;
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
    editModal.classList.add('hidden');
    editingEntryId = null;
    loadEntries();
};
