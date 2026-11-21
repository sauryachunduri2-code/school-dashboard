/* School Dashboard service worker: push notifications + a small offline shell. */
importScripts("/due-line.js"); // defines dueLine(data, now)

const CACHE = "sd-shell-v2";
// Every app page is kept, not just Home: on a network that blocks the site (school Wi-Fi blocks *.vercel.app)
// tapping Calendar should open Calendar. Data still loads, since it comes straight from Supabase.
const PAGES = ["/", "/calendar", "/areas", "/focus", "/hours", "/settings"];

/** Saves a page and the build files its HTML points at, so it can start with no network at all. */
async function cachePage(cache, path) {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok || res.redirected) return; // signed out: don't keep the login redirect as this page
  const html = await res.clone().text();
  await cache.put(path, res);
  const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [])];
  await Promise.all(
    assets.map((a) =>
      cache
        .match(a)
        .then((hit) => hit || fetch(a).then((r) => (r.ok ? cache.put(a, r) : undefined)))
        .catch(() => {}),
    ),
  );
}
const cacheAllPages = () => caches.open(CACHE).then((c) => Promise.all(PAGES.map((p) => cachePage(c, p).catch(() => {}))));
// Pages are re-saved once each time the worker starts and the network works, so they follow new deploys.
let refreshed = false;

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAllPages().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never cache on localhost: dev chunks are unhashed and would go stale.
  if (self.location.hostname === "localhost" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // Hashed build assets never change: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: network first, fall back to the cached shell so the app still opens offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(url.pathname, copy));
            if (!refreshed) {
              refreshed = true;
              const all = cacheAllPages();
              try {
                event.waitUntil(all);
              } catch {
                // the browser may refuse to extend the event this late; the save still runs
              }
            }
          }
          return res;
        })
        // The saved copy of this page; Home only for a page that was never saved.
        .catch(() => caches.match(url.pathname, { ignoreSearch: true }).then((hit) => hit || caches.match("/"))),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Reminder" };
  }
  const body = [data.listName, dueLine(data)].filter(Boolean).join(" · ");
  event.waitUntil(
    self.registration.showNotification(data.title || "Reminder", {
      body,
      tag: data.tag,
      icon: "/pwa-icon/192",
      badge: "/pwa-icon/192",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(target).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
