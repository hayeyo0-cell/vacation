// sw.js - 최소한의 서비스워커 (PWA 설치 조건 충족 + 기본 오프라인 지원)
const CACHE_NAME = "vacation-app-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 앱 껍데기(html/js/manifest/아이콘)만 캐시, Firestore 등 API 호출은 항상 네트워크로
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // 외부 요청(Firebase 등)은 그대로 통과

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
