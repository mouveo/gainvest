// Minimal service worker — required for installable PWA on Chromium.
// Network-first passthrough; no caching strategy yet, see README for the roadmap.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No-op — let the browser handle the request normally.
});
