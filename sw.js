const CACHE_VERSION = "2026-05-20-rc-2";
const CACHE_NAME = `foodflow-offline-${CACHE_VERSION}`;
const APP_SHELL = [
  "./index.html",
  "./data-bundle.js",
  "./data-loader.js",
  "./app.js",
  "./manifest.webmanifest",
  "./foodflow-icon.svg",
  "./robots.txt",
  "./sitemap.xml",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./screenshots/desktop.png",
  "./screenshots/mobile.png",
  "./data/products.json",
  "./data/recipes.json",
  "./data/inventory-rules.json",
  "./data/plans.json",
  "./data/budget-tiers.json",
  "./data/family-profiles.json",
  "./data/store-prices.json",
  "./data/plans/manifest.json",
  "./data/plans/plan_a1_c0.json",
  "./data/plans/inv_a1_c0.json",
  "./data/plans/plan_a1_c1.json",
  "./data/plans/inv_a1_c1.json",
  "./data/plans/plan_a1_c2.json",
  "./data/plans/inv_a1_c2.json",
  "./data/plans/plan_a2_c0.json",
  "./data/plans/inv_a2_c0.json",
  "./data/plans/plan_a2_c1.json",
  "./data/plans/inv_a2_c1.json",
  "./data/plans/plan_a2_c2.json",
  "./data/plans/inv_a2_c2.json"
];

function cacheAppShell() {
  return caches.open(CACHE_NAME).then(cache => cache.addAll(
    APP_SHELL.map(url => new Request(url, { cache: "reload" }))
  ));
}

function updateCache(request) {
  return fetch(request).then(response => {
    if (response && response.ok && new URL(request.url).origin === self.location.origin) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  });
}

function networkFirst(request) {
  return updateCache(request).catch(() => caches.match(request));
}

function staleWhileRevalidate(request) {
  return caches.match(request).then(cached => {
    const fresh = updateCache(request).catch(() => cached);
    return cached || fresh;
  });
}

function cachedIndex() {
  return caches.match("./index.html").then(cached => cached || caches.match("./"));
}

self.addEventListener("install", event => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      caches.match(request)
        .then(cached => cached || cachedIndex())
        .then(cached => cached || updateCache(request))
        .catch(() => cachedIndex())
    );
    event.waitUntil(updateCache(request).catch(() => undefined));
    return;
  }

  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/data/") && url.pathname.endsWith(".json")) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(
    staleWhileRevalidate(request)
      .catch(() => caches.match(request))
  );

  if (url.origin === self.location.origin) {
    event.waitUntil(updateCache(request).catch(() => undefined));
  }
});
