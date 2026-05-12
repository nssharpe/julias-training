// Minimal service worker — install + fetch passthrough.
// Exists so the app is installable as a PWA; Firestore handles its own offline cache.
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", () => { /* network only */ });
