/**
 * Exam Proctor Studio - PWA Service Worker
 * Fast caching of app shell, styles, and assets
 * Version: 6.0
 */

const CACHE_NAME = "exam-proctor-shell-v6.1";
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
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        console.debug("Cache addAll partial skip:", err);
      });
    })
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

  // Network first with cache fallback for HTML, JS and CSS to ensure latest updates are immediately loaded
  const isCodeAsset = url.pathname.endsWith(".js") || url.pathname.endsWith(".css");
  const isHtml = event.request.headers.get("accept") && event.request.headers.get("accept").includes("text/html");

  if (isHtml || isCodeAsset) {
    event.respondWith(
      fetch(event.request).then((res) => {
        if (res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return res;
      }).catch(() => caches.match(event.request).then((matched) => matched || (isHtml ? caches.match("/index.html") : null)))
    );
  } else {
    // Cache first with network fallback for images and static media
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
