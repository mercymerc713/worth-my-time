// Worth My Time? — Service Worker
// Caches the app shell for fast loads and basic offline support.

const CACHE_NAME = "wmt-v1";
const SHELL = [
  "/",
  "/index.html",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Always fetch API, Supabase, Stripe, and RAWG calls from network
  if (
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("rawg.io") ||
    url.hostname.includes("stripe.com") ||
    url.hostname.includes("opencritic.com") ||
    url.hostname.includes("cheapshark.com")
  ) {
    return;
  }

  // For navigation requests: try network first, fall back to cached index.html
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match("/index.html")
      )
    );
    return;
  }

  // For static assets: cache-first
  e.respondWith(
    caches.match(e.request).then(
      (cached) => cached || fetch(e.request).then((res) => {
        if (res.ok && e.request.method === "GET") {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return res;
      })
    )
  );
});
