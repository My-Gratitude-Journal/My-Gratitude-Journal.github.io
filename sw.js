const CACHE_NAME = 'gj-app-shell-v2';
const APP_SHELL_ASSETS = [
    '/index.html',
    '/app.js',
    '/style.css'
];
// External CDN assets used by the app; precache to ensure offline reliability on mobile
const EXTERNAL_ASSETS = [
    'https://cdn.tailwindcss.com?plugins=forms,typography',
    'https://cdn.jsdelivr.net/npm/crypto-js@4.1.1/crypto-js.min.js',
    'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
            await cache.addAll(APP_SHELL_ASSETS);
        } catch (err) {
            // Some environments may block caching certain paths; continue
            console.warn('App shell precache failed for some assets:', err);
        }
        // Precache external assets as opaque responses; ignore failures
        await Promise.all(EXTERNAL_ASSETS.map(async (url) => {
            try {
                const resp = await fetch(url, { mode: 'no-cors' });
                if (resp) await cache.put(url, resp);
            } catch (e) {
                // Skip if not available
            }
        }));
        self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => {
            if (key !== CACHE_NAME) return caches.delete(key);
        }));
        self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Only cache GET requests (Cache API doesn't support POST, PUT, etc.)
    if (req.method !== 'GET') {
        event.respondWith(fetch(req));
        return;
    }

    // Navigation requests: serve cached index.html (SPA offline)
    if (req.mode === 'navigate') {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match('/index.html') || await cache.match('/');
            return cached || fetch(req).catch(async () => (await cache.match('/index.html')) || Response.error());
        })());
        return;
    }

    // Same-origin assets: cache-first, then network
    if (url.origin === self.location.origin) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(req);
            if (cached) return cached;
            try {
                const resp = await fetch(req);
                if (resp && resp.ok) cache.put(req, resp.clone());
                return resp;
            } catch (e) {
                // Fallback to shell
                return (await cache.match('/index.html')) || cached || Response.error();
            }
        })());
        return;
    }

    // Third-party CDNs: cache-first with network fallback
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req) || await cache.match(url.href);
        if (cached) return cached;
        try {
            const resp = await fetch(req);
            if (resp) cache.put(req, resp.clone());
            return resp;
        } catch (e) {
            // Last resort: return cached shell so SPA can still load
            return (await cache.match('/index.html')) || Response.error();
        }
    })());
});
