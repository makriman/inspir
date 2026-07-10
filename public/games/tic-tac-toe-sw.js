const CACHE_PREFIX = "inspir-game-tic-tac-toe-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const GAME_PATH = "/games/tic-tac-toe";
const SHELL = [GAME_PATH, `${GAME_PATH}/manifest.webmanifest`];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  const gameRequest = url.pathname.startsWith(GAME_PATH);
  const staticRequest = url.pathname.startsWith("/_next/static/");
  const immutableResult = url.pathname.startsWith("/api/games/results/");
  if (!gameRequest && !staticRequest && !immutableResult) return;

  event.respondWith(gameResponse(request, { cacheFirst: staticRequest || immutableResult }));
});

async function gameResponse(request, { cacheFirst }) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cacheFirst && cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      try {
        await cache.put(request, response.clone());
      } catch {
        // A cache write must never turn a valid online response into a failure.
      }
    }
    return response;
  } catch {
    if (cached) return cached;
    if (request.mode === "navigate") return (await cache.match(GAME_PATH)) || Response.error();
    return Response.error();
  }
}
