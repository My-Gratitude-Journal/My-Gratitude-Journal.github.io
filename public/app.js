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

const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authSection = document.getElementById('auth-section');
const journalSection = document.getElementById('journal-section');
const gratitudeForm = document.getElementById('gratitude-form');
const gratitudeInput = document.getElementById('gratitude-input');
const entriesList = document.getElementById('entries-list');

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
        await auth.signInWithEmailAndPassword(email, password);
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            try {
                await auth.createUserWithEmailAndPassword(email, password);
            } catch (signupErr) {
                errorMsg.textContent = signupErr.message;
                console.error('Signup error:', signupErr);
            }
        } else {
            errorMsg.textContent = e.message;
            console.error('Login error:', e);
        }
    }
    loadingMsg.style.display = 'none';
    loginBtn.disabled = false;
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
