/* ============================================================
   Labs Tools service worker
   - App shell + vendored libraries are precached (offline ready).
   - ffmpeg-core (32MB) is cached lazily on first VOD conversion.
   ============================================================ */
'use strict';

var APP_CACHE = 'labs-tools-app-v1.3.4';
var MEDIA_CACHE = 'labs-tools-media-v1';
var KEEP = [APP_CACHE, MEDIA_CACHE];

var PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/lib/common.js',
  './js/app.js',
  './js/tools/exif.js',
  './js/tools/url.js',
  './js/tools/pdf.js',
  './js/tools/compress.js',
  './js/tools/qr.js',
  './js/tools/resize.js',
  './js/tools/watermark.js',
  './js/tools/vod.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/pdf-lib.min.js',
  './vendor/jszip.min.js',
  './vendor/qrcode.min.js',
  './vendor/mp4-muxer.mjs',
  './vendor/ffmpeg/ffmpeg.js',
  './vendor/ffmpeg/814.ffmpeg.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(APP_CACHE);
    await Promise.all(PRECACHE.map(function (url) {
      return cache.add(new Request(url, { cache: 'reload' })).catch(function () {
        /* a single missing asset must not block installation */
      });
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (key) {
      if (key.indexOf('labs-tools-') === 0 && KEEP.indexOf(key) === -1) return caches.delete(key);
      return null;
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // Navigations: network first so a new deploy is picked up, cache as fallback.
  if (req.mode === 'navigate') {
    event.respondWith((async function () {
      try {
        var res = await fetch(req);
        var cache = await caches.open(APP_CACHE);
        cache.put('./index.html', res.clone()).catch(function () {});
        return res;
      } catch (e) {
        var c = await caches.open(APP_CACHE);
        return (await c.match('./index.html')) || (await c.match('./')) || Response.error();
      }
    })());
    return;
  }

  // ffmpeg core: lazy runtime cache (never precached).
  if (/ffmpeg-core\.(js|wasm)$/.test(url.pathname)) {
    event.respondWith((async function () {
      var cache = await caches.open(MEDIA_CACHE);
      var hit = await cache.match(req);
      if (hit) return hit;
      var res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone()).catch(function () {});
      return res;
    })());
    return;
  }

  // Everything else: cache first, then fill the cache.
  event.respondWith((async function () {
    var cache = await caches.open(APP_CACHE);
    var hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      var res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(function () {});
      return res;
    } catch (e) {
      return Response.error();
    }
  })());
});
