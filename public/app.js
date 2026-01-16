// TODO: Replace with your Firebase project config
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Simple encryption (for MVP; use stronger encryption for production)
function encrypt(text, key) {
    return btoa(unescape(encodeURIComponent(text + key)));
}
function decrypt(data, key) {
    try {
        return decodeURIComponent(escape(atob(data))).replace(key, "");
    } catch {
        return "";
    }
}

const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authSection = document.getElementById('auth-section');
const journalSection = document.getElementById('journal-section');
const gratitudeForm = document.getElementById('gratitude-form');
const gratitudeInput = document.getElementById('gratitude-input');
const entriesList = document.getElementById('entries-list');

let userKey = '';

loginBtn.onclick = async () => {
    const email = emailInput.value;
    const password = passwordInput.value;
    userKey = password;
    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            await auth.createUserWithEmailAndPassword(email, password);
        } else {
            alert(e.message);
        }
    }
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
    } else {
        authSection.style.display = 'block';
        journalSection.style.display = 'none';
        entriesList.innerHTML = '';
        logoutBtn.style.display = 'none';
    }
});

gratitudeForm.onsubmit = async (e) => {
    e.preventDefault();
    const entry = gratitudeInput.value.trim();
    if (!entry) return;
    const encrypted = encrypt(entry, userKey);
    await db.collection('gratitude').add({
        uid: auth.currentUser.uid,
        entry: encrypted,
        created: new Date()
    });
    gratitudeInput.value = '';
    loadEntries();
};

async function loadEntries() {
    const snap = await db.collection('gratitude')
        .where('uid', '==', auth.currentUser.uid)
        .orderBy('created', 'desc')
        .get();
    entriesList.innerHTML = '';
    snap.forEach(doc => {
        const data = doc.data();
        const li = document.createElement('li');
        li.textContent = decrypt(data.entry, userKey);
        entriesList.appendChild(li);
    });
}
