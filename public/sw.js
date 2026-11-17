/* Tech Feed service worker (hand-written, no next-pwa).
 * Caches the app shell and static assets only. NEVER caches /api/*, auth
 * routes, or HTML pages (they are per-user and session-gated). */
const VERSION = "tf-v1";
const SHELL = ["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

const NEVER_CACHE = [/^\/api\//, /^\/auth\//, /^\/login/];
const STATIC = [/^\/_next\/static\//, /^\/icons\//, /^\/manifest\.webmanifest$/, /\.(?:woff2?|css|js|png|svg|ico)$/];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((re) => re.test(url.pathname))) return;

  // Pages: network only, with an offline fallback. Never cached.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }

  // Static assets: cache-first (Next's /_next/static files are content-hashed).
  if (STATIC.some((re) => re.test(url.pathname))) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.type === "basic") {
              const copy = res.clone();
              caches.open(VERSION).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
