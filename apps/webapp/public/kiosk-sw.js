/**
 * The kiosk's own service worker (#1291, spec #885).
 *
 * Registered by an offline-mode kiosk page only, at the scope of its kiosk
 * route (`/{locale}/kiosk`), so it never replaces the app's root worker
 * (`/sw.js`, scope `/`) and never touches its offline clock queue. It caches
 * the kiosk page and its assets so the kiosk boots through an outage, a reload
 * or a restart. Its caches are named `kiosk-shell-<build>`: never `z8-`, which
 * the root worker deletes on activation, and one per deployment (the page
 * registers `/kiosk-sw.js?v=<build>`), so a new deployment never serves old
 * chunks. Kiosk API calls are never cached here; the kiosk's employee cache
 * lives in the page's IndexedDB (`z8-kiosk`).
 *
 * Plain JavaScript, served as-is like `sw.js`.
 */

const KIOSK_SHELL_PREFIX = "kiosk-shell-";
const KIOSK_SHELL_CACHE =
	KIOSK_SHELL_PREFIX + (new URL(self.location.href).searchParams.get("v") || "development");

/** The kiosk page this worker serves: its scope without a trailing slash or query. */
function kioskPageUrl() {
	const scope = new URL(self.registration.scope);
	return new URL(scope.pathname.replace(/\/$/, ""), self.location.origin).href;
}

/** Hashed build assets and the site's own icons; never the API. */
function isKioskAsset(pathname) {
	if (pathname.startsWith("/_next/static/")) return true;
	return /^\/[^/]+\.(png|ico|svg|webmanifest)$/.test(pathname);
}

/** "page", "asset", or null for requests the network handles alone. */
function classifyKioskRequest(request) {
	const url = new URL(request.url);
	if (request.method !== "GET" || url.origin !== self.location.origin) return null;
	if (url.pathname.startsWith("/api/")) return null;
	if (request.mode === "navigate") {
		return new URL(url.pathname.replace(/\/$/, ""), url.origin).href === kioskPageUrl()
			? "page"
			: null;
	}
	return isKioskAsset(url.pathname) ? "asset" : null;
}

/** The build assets a kiosk page references, as absolute same-origin URLs. */
function kioskPageAssets(html) {
	const urls = new Set();
	for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
		urls.add(new URL(match[1].replace(/&amp;/g, "&"), self.location.origin).href);
	}
	return [...urls];
}

async function cacheKioskAssets(cache, urls) {
	await Promise.all(
		urls.map(async (href) => {
			const url = new URL(href, self.location.origin);
			if (url.origin !== self.location.origin || !isKioskAsset(url.pathname)) return;
			if (await cache.match(url.href)) return;
			try {
				const response = await fetch(url.href);
				if (response.ok) await cache.put(url.href, response);
			} catch {
				// Offline or gone: it is fetched again at the next contact.
			}
		}),
	);
}

async function precacheKioskPage() {
	const cache = await caches.open(KIOSK_SHELL_CACHE);
	try {
		const response = await fetch(kioskPageUrl());
		if (!response.ok) return;
		const html = await response.clone().text();
		await cache.put(kioskPageUrl(), response);
		await cacheKioskAssets(cache, kioskPageAssets(html));
	} catch {
		// The page caches itself the next time it loads online.
	}
}

/** Network first, so an online kiosk always runs the current page; the cache while offline. */
async function kioskPage(request) {
	const cache = await caches.open(KIOSK_SHELL_CACHE);
	try {
		const response = await fetch(request);
		if (response.ok && response.type !== "opaqueredirect") {
			await cache.put(kioskPageUrl(), response.clone());
		}
		return response;
	} catch (error) {
		const cached = await cache.match(kioskPageUrl());
		if (cached) return cached;
		throw error;
	}
}

/** Cache first: build assets are hashed and never change under the same URL. */
async function kioskAsset(request) {
	const cache = await caches.open(KIOSK_SHELL_CACHE);
	const cached = await cache.match(request.url);
	if (cached) return cached;
	const response = await fetch(request);
	if (response.ok) await cache.put(request.url, response.clone());
	return response;
}

self.addEventListener("install", (event) => {
	event.waitUntil(precacheKioskPage().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const names = await caches.keys();
			await Promise.all(
				names
					.filter((name) => name.startsWith(KIOSK_SHELL_PREFIX) && name !== KIOSK_SHELL_CACHE)
					.map((name) => caches.delete(name)),
			);
			await self.clients.claim();
		})(),
	);
});

self.addEventListener("fetch", (event) => {
	const kind = classifyKioskRequest(event.request);
	if (kind === "page") event.respondWith(kioskPage(event.request));
	else if (kind === "asset") event.respondWith(kioskAsset(event.request));
});

self.addEventListener("message", (event) => {
	const data = event.data;
	if (data?.type === "SKIP_WAITING") {
		event.waitUntil(self.skipWaiting());
	} else if (data?.type === "KIOSK_WARM" && Array.isArray(data.urls)) {
		event.waitUntil(
			caches.open(KIOSK_SHELL_CACHE).then((cache) =>
				cacheKioskAssets(
					cache,
					data.urls.filter((url) => typeof url === "string"),
				),
			),
		);
	}
});
