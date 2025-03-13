const CACHE_NAME = 'novabuzz-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/home.html',
    '/profile.html',
    '/search.html',
    '/settings.html',
    '/post.html',
    '/styles/main.css',
    '/styles/components.css',
    '/styles/animations.css',
    '/styles/mobile.css',
    '/styles/settings.css',
    '/js/app.js',
    '/js/auth.js',
    '/js/config.js',
    '/js/utils.js',
    '/js/search.js',
    '/js/settings.js',
    '/js/post.js',
    '/js/profile.js',
    '/js/themeManager.js',
    '/manifest.json'
];

// Install event
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

// Activate event
self.addEventListener('activate', event => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(cacheName => cacheName !== CACHE_NAME)
                        .map(cacheName => caches.delete(cacheName))
                );
            })
        ])
    );
});

// Enhanced fetch event handler
self.addEventListener('fetch', event => {
    // Network-first strategy for API calls
    if (event.request.url.includes('firestore.googleapis.com') || 
        event.request.url.includes('googleapis.com')) {
        event.respondWith(
            fetch(event.request)
                .catch(() => {
                    return caches.match('offline.html');
                })
        );
        return;
    }

    // Cache-first strategy for static assets
    if (event.request.destination === 'style' || 
        event.request.destination === 'script' ||
        event.request.destination === 'image') {
        event.respondWith(
            caches.match(event.request)
                .then(response => {
                    return response || fetch(event.request)
                        .then(response => {
                            const responseClone = response.clone();
                            caches.open(CACHE_NAME)
                                .then(cache => {
                                    cache.put(event.request, responseClone);
                                });
                            return response;
                        });
                })
        );
        return;
    }

    // Network-first strategy for HTML
    event.respondWith(
        fetch(event.request)
            .catch(() => {
                return caches.match(event.request)
                    .then(response => {
                        if (response) {
                            return response;
                        }
                        if (event.request.mode === 'navigate') {
                            return caches.match('offline.html');
                        }
                        return new Response('Network error');
                    });
            })
    );
});
