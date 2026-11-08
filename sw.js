// Service worker «Часиков»: хранит файлы приложения на телефоне, чтобы оно открывалось без интернета.
// ⚠️ ПРИ КАЖДОЙ ВЫКЛАДКЕ ПОВЫШАЙ НОМЕР ВЕРСИИ (v1 → v2 → v3 …), иначе телефон покажет старую версию.
const VERSION = "v5";
const CACHE = "chasiki-" + VERSION;
const FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png"
];

// установка: кладём все файлы в хранилище.
// cache: "reload" — берём свежие файлы с сайта, а не старые копии из памяти браузера (GitHub разрешает хранить их 10 минут)
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

// новая версия: стираем старые хранилища
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("chasiki-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // шрифты Google: берём из хранилища, а в фоне обновляем
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(req).then((hit) => {
          const net = fetch(req).then((res) => { c.put(req, res.clone()); return res; }).catch(() => hit);
          return hit || net;
        })
      )
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // погода (data.json): сначала свежая из сети, без интернета — последняя сохранённая
  if (url.pathname.endsWith("/data.json")) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("./data.json", copy)); }
        return res;
      }).catch(() => caches.match("./data.json").then((hit) => hit || Response.error()))
    );
    return;
  }

  // открытие страницы: без интернета — из хранилища
  if (req.mode === "navigate") {
    e.respondWith(caches.match("./index.html").then((hit) => hit || fetch(req)));
    return;
  }

  // остальные файлы: из хранилища, если нет — из сети
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
