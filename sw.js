const CACHE_NAME = 'novabuzz-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
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
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(cacheName => cacheName !== CACHE_NAME)
                    .map(cacheName => caches.delete(cacheName))
            );
        })
    );
});

// Fetch event
self.addEventListener('fetch', event => {
    // Only cache GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Don't cache Firebase requests
    if (event.request.url.includes('firestore.googleapis.com') || 
        event.request.url.includes('googleapis.com') ||
        event.request.url.includes('firebase')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return cached response if found
                if (response) {
                    return response;
                }

                // Clone the request because it can only be used once
                const fetchRequest = event.request.clone();

                return fetch(fetchRequest)
                    .then(response => {
                        // Don't cache if not a valid response
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // Clone the response because it can only be used once
                        const responseToCache = response.clone();

                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    });
            })
            .catch(() => {
                // Optional: Return offline fallback
                if (event.request.mode === 'navigate') {
                    return caches.match('/offline.html');
                }
            })
    );
});
