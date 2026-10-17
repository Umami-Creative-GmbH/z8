/**
 * The page side of the kiosk's own service worker (`public/kiosk-sw.js`,
 * #1291). Only an offline-mode kiosk registers it, one registration per kiosk
 * route it may show (`/{locale}/kiosk`), never at `/`, where the app's root
 * worker lives. A kiosk whose offline mode is off, or that is revoked or
 * unpaired, unregisters it and deletes its caches. Every step is best effort:
 * without service workers the kiosk simply does not boot offline.
 */
export const KIOSK_WORKER_PATH = "/kiosk-sw.js";
/** The worker's cache names: never `z8-`, which the root worker deletes. `public/kiosk-sw.js` repeats it. */
export const KIOSK_SHELL_CACHE_PREFIX = "kiosk-shell-";
/** The build a development page registers the worker for; `public/kiosk-sw.js` falls back to it. */
export const KIOSK_DEVELOPMENT_BUILD = "development";

export function kioskWorkerScope(locale: string): string {
	return `/${locale}/kiosk`;
}

function serviceWorkers(): ServiceWorkerContainer | null {
	return typeof navigator !== "undefined" && "serviceWorker" in navigator
		? navigator.serviceWorker
		: null;
}

function isKioskRegistration(registration: ServiceWorkerRegistration): boolean {
	const worker = registration.active ?? registration.waiting ?? registration.installing;
	if (!worker || new URL(worker.scriptURL).pathname !== KIOSK_WORKER_PATH) return false;
	return /^\/[^/]+\/kiosk\/?$/.test(new URL(registration.scope).pathname);
}

/**
 * Registers the kiosk worker for each locale's kiosk route, versioned by the
 * build so each deployment caches its own page and assets, then tells the
 * worker which assets this page has loaded so far (lazy chunks included).
 */
export async function installKioskWorker(input: {
	locales: readonly string[];
	build: string;
}): Promise<void> {
	const container = serviceWorkers();
	if (!container) return;
	const script = `${KIOSK_WORKER_PATH}?v=${encodeURIComponent(input.build)}`;
	const registrations = await Promise.all(
		[...new Set(input.locales)].map((locale) =>
			container
				.register(script, { scope: kioskWorkerScope(locale), updateViaCache: "none" })
				.catch(() => null),
		),
	);
	const urls = loadedAssetUrls();
	for (const registration of registrations) {
		const worker = registration?.active ?? registration?.waiting ?? registration?.installing;
		worker?.postMessage({ type: "KIOSK_WARM", urls });
	}
}

/** Unregisters every kiosk worker registration and deletes the kiosk's page caches. */
export async function removeKioskWorker(): Promise<void> {
	const container = serviceWorkers();
	if (container) {
		const registrations = await container.getRegistrations().catch(() => []);
		await Promise.all(
			registrations
				.filter(isKioskRegistration)
				.map((registration) => registration.unregister().catch(() => false)),
		);
	}
	if (typeof caches === "undefined") return;
	const names = await caches.keys().catch(() => [] as string[]);
	await Promise.all(
		names
			.filter((name) => name.startsWith(KIOSK_SHELL_CACHE_PREFIX))
			.map((name) => caches.delete(name).catch(() => false)),
	);
}

function loadedAssetUrls(): string[] {
	if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
		return [];
	}
	return performance
		.getEntriesByType("resource")
		.map((entry) => entry.name)
		.filter((name) => {
			try {
				const url = new URL(name);
				return url.origin === window.location.origin && url.pathname.startsWith("/_next/static/");
			} catch {
				return false;
			}
		});
}
