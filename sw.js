/* 离线缓存：核心文件安装时缓存，识别引擎首次使用时缓存 */
var V = "ketang-v1.7.1";
var CORE = ["./", "./index.html", "./app.js", "./roster_data.js", "./img/school_red.png", "./manifest.json", "./icons/icon-180.png", "./icons/icon-192.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  var core = /\/(index\.html|app\.js|roster_data\.js)?$/.test(url.pathname);
  if (core) {
    // 网络优先：有网就拿最新版，没网用缓存
    e.respondWith(fetch(e.request).then(function (r) {
      var cp = r.clone(); caches.open(V).then(function (c) { c.put(e.request, cp); }); return r;
    }).catch(function () { return caches.match(e.request, { ignoreSearch: true }); }));
  } else {
    e.respondWith(caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (r) {
        if (r.ok) { var cp = r.clone(); caches.open(V).then(function (c) { c.put(e.request, cp); }); }
        return r;
      });
    }));
  }
});
