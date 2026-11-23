// Contabilitate privată – lucrează și fără internet.
// Aplicația se ia întâi de pe internet (actualizări imediate); fără semnal, din copia salvată.
const CACHE = "cp-v10";
const BIG = ["./models/det.onnx", "./models/rec.onnx", "./models/keys.txt", "./ort/ort-wasm-simd-threaded.wasm", "./ort/ort-wasm-simd-threaded.mjs", "./cp-scan.js"];
const SHELL = ["./", "./index.html", "./cp-core.js", "./cp-extra.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-192.png", "./icon-maskable-512.png", "./apple-touch-icon.png", "./favicon-32.png", "./vendor/jspdf.umd.min.js", "./vendor/exceljs.min.js", "./vendor/msal-browser.min.js"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).then(() => c.addAll(BIG).catch(() => {}))).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== location.origin) return;
  if (/\/(models|ort)\/|cp-scan\.js$/.test(u.pathname)) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).then(resp => { if (resp.ok) { const cp = resp.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return resp; })));
  } else {
    e.respondWith(fetch(req, { cache: "no-cache" }).then(resp => { if (resp.ok) { const cp = resp.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return resp; }).catch(() => caches.match(req, { ignoreSearch: true })));
  }
});
