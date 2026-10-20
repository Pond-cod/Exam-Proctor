/**
 * Exam Proctor Studio - PWA Service Worker
 * Fast caching of app shell, styles, and assets
 * Version: 6.0
 */

const CACHE_NAME = "exam-proctor-shell-v6.0";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/exam.html",
  "/admin/login.html",
  "/admin/rooms.html",
  "/admin/monitor.html",
  "/css/style.css",
  "/logo.png",
  "/js/shared/config.js",
  "/js/shared/common.js",
  "/js/shared/i18n.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        console.debug("Cache addAll partial skip:", err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Do not cache API calls or external streaming requests
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api") || event.request.method !== "GET") {
    return;
  }

  // Network first with cache fallback for HTML, cache first for static assets
  if (event.request.headers.get("accept") && event.request.headers.get("accept").includes("text/html")) {
    event.respondWith(
      fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        return res;
      }).catch(() => caches.match(event.request).then((matched) => matched || caches.match("/index.html")))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((res) => {
          if (res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
          }
          return res;
        });
      })
    );
  }
});
