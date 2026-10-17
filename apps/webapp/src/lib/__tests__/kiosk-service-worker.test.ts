import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
	KIOSK_DEVELOPMENT_BUILD,
	KIOSK_SHELL_CACHE_PREFIX,
} from "@/lib/time-tracking/kiosk/kiosk-worker";

/**
 * #1291: the kiosk's own service worker (`public/kiosk-sw.js`), loaded into a
 * stub worker scope. It caches the kiosk page and its assets so an
 * offline-mode kiosk boots through an outage, and stays out of the app's root
 * worker's way: its caches never start with `z8-` and it never caches the API.
 */
const ORIGIN = "https://z8.test";

type Listener = (event: unknown) => void;

function fakeCaches(initial: Record<string, Record<string, string>> = {}) {
	const stores = new Map<string, Map<string, string>>(
		Object.entries(initial).map(([name, entries]) => [name, new Map(Object.entries(entries))]),
	);
	const keyOf = (request: string | Request) =>
		typeof request === "string" ? request : request.url;
	function cacheFor(name: string) {
		const store = stores.get(name) ?? new Map<string, string>();
		stores.set(name, store);
		return {
			async match(request: string | Request) {
				const body = store.get(new URL(keyOf(request), ORIGIN).href);
				return body === undefined ? undefined : new Response(body);
			},
			async put(request: string | Request, response: Response) {
				store.set(new URL(keyOf(request), ORIGIN).href, await response.text());
			},
		};
	}
	return {
		stores,
		api: {
			open: async (name: string) => cacheFor(name),
			keys: async () => [...stores.keys()],
			delete: async (name: string) => stores.delete(name),
		},
	};
}

function loadKioskWorker(input: {
	version?: string;
	caches?: ReturnType<typeof fakeCaches>;
	network?: (url: string) => Response | Promise<Response>;
}) {
	const listeners = new Map<string, Listener[]>();
	const caches = input.caches ?? fakeCaches();
	const fetched: string[] = [];
	let skippedWaiting = false;
	let claimed = false;
	const script = readFileSync(path.resolve(__dirname, "../../../public/kiosk-sw.js"), "utf8");
	const context = {
		console,
		URL,
		Request,
		Response,
		Promise,
		caches: caches.api,
		fetch: async (request: string | Request) => {
			const url = typeof request === "string" ? request : request.url;
			fetched.push(url);
			if (!input.network) throw new TypeError("Failed to fetch");
			return input.network(url);
		},
		self: {
			location: { href: `${ORIGIN}/kiosk-sw.js?v=${input.version ?? "build-2"}`, origin: ORIGIN },
			registration: { scope: `${ORIGIN}/de/kiosk` },
			clients: {
				claim: async () => {
					claimed = true;
				},
			},
			skipWaiting: async () => {
				skippedWaiting = true;
			},
			addEventListener: (type: string, listener: Listener) => {
				listeners.set(type, [...(listeners.get(type) ?? []), listener]);
			},
		},
	};
	vm.runInNewContext(script, context);

	async function dispatch(type: string, event: Record<string, unknown>) {
		const waits: Promise<unknown>[] = [];
		let responded: Promise<Response> | null = null;
		for (const listener of listeners.get(type) ?? []) {
			listener({
				...event,
				waitUntil: (promise: Promise<unknown>) => waits.push(promise),
				respondWith: (response: Promise<Response>) => {
					responded = response;
				},
			});
		}
		await Promise.all(waits);
		return responded as Promise<Response> | null;
	}

	return {
		caches,
		fetched,
		get skippedWaiting() {
			return skippedWaiting;
		},
		get claimed() {
			return claimed;
		},
		install: () => dispatch("install", {}),
		activate: () => dispatch("activate", {}),
		message: (data: unknown) => dispatch("message", { data }),
		fetch: (url: string, init: { mode?: string; method?: string } = {}) =>
			dispatch("fetch", {
				request: {
					url: new URL(url, ORIGIN).href,
					mode: init.mode ?? "cors",
					method: init.method ?? "GET",
				},
			}),
	};
}

const PAGE = `<html><head><script src="/_next/static/chunks/main.js?dpl=build-2" async=""></script>
<link rel="stylesheet" href="/_next/static/css/app.css?dpl=build-2&amp;x=1"/></head></html>`;

describe("kiosk service worker (#1291)", () => {
	it("names its caches and development build as the page side does", () => {
		const script = readFileSync(path.resolve(__dirname, "../../../public/kiosk-sw.js"), "utf8");

		// The page deletes the worker's caches by this prefix and registers this build in development.
		expect(script).toContain(`const KIOSK_SHELL_PREFIX = "${KIOSK_SHELL_CACHE_PREFIX}";`);
		expect(script).toContain(`|| "${KIOSK_DEVELOPMENT_BUILD}")`);
		expect(KIOSK_SHELL_CACHE_PREFIX.startsWith("z8-")).toBe(false);
	});

	it("precaches its kiosk page and the page's assets in a cache of this version, then takes over", async () => {
		const worker = loadKioskWorker({
			network: (url) => new Response(url.endsWith("/de/kiosk") ? PAGE : "asset"),
		});

		await worker.install();
		await worker.activate();

		const cache = worker.caches.stores.get("kiosk-shell-build-2");
		expect([...(cache?.keys() ?? [])].sort()).toEqual([
			`${ORIGIN}/_next/static/chunks/main.js?dpl=build-2`,
			`${ORIGIN}/_next/static/css/app.css?dpl=build-2&x=1`,
			`${ORIGIN}/de/kiosk`,
		]);
		expect(worker.skippedWaiting).toBe(true);
		expect(worker.claimed).toBe(true);
	});

	it("deletes only its own older caches, never the app worker's z8- caches", async () => {
		const caches = fakeCaches({
			"kiosk-shell-build-1": {},
			"kiosk-shell-build-2": {},
			"z8-app-shell-v1": {},
			"z8-push-v1": {},
		});
		const worker = loadKioskWorker({ caches });

		await worker.activate();

		expect([...caches.stores.keys()].sort()).toEqual([
			"kiosk-shell-build-2",
			"z8-app-shell-v1",
			"z8-push-v1",
		]);
	});

	it("serves the kiosk page from the network while online and from its cache while offline", async () => {
		let online = true;
		const worker = loadKioskWorker({
			network: (url) => {
				if (!online) throw new TypeError("Failed to fetch");
				return new Response(`fresh ${new URL(url).pathname}`);
			},
		});

		const fresh = await worker.fetch("/de/kiosk?code=ABCD-EFGH", { mode: "navigate" });
		expect(await fresh?.text()).toBe("fresh /de/kiosk");

		online = false;
		const cached = await worker.fetch("/de/kiosk", { mode: "navigate" });
		expect(await cached?.text()).toBe("fresh /de/kiosk");
	});

	it("serves hashed assets from its cache first", async () => {
		const caches = fakeCaches({
			"kiosk-shell-build-2": { [`${ORIGIN}/_next/static/chunks/main.js`]: "cached chunk" },
		});
		const worker = loadKioskWorker({ caches, network: () => new Response("network chunk") });

		const response = await worker.fetch("/_next/static/chunks/main.js");

		expect(await response?.text()).toBe("cached chunk");
		expect(worker.fetched).toEqual([]);
	});

	it("leaves kiosk API calls, writes, other pages and other origins to the network", async () => {
		const worker = loadKioskWorker({ network: () => new Response("network") });

		expect(await worker.fetch("/api/kiosk/employees")).toBeNull();
		expect(await worker.fetch("/api/kiosk/session", { mode: "navigate" })).toBeNull();
		expect(await worker.fetch("/_next/static/chunks/main.js", { method: "POST" })).toBeNull();
		expect(await worker.fetch("/de/time-tracking", { mode: "navigate" })).toBeNull();
		expect(await worker.fetch("https://cdn.example/_next/static/x.js")).toBeNull();
		expect(worker.caches.stores.size).toBe(0);
	});

	it("caches the assets a page reports having loaded, on the same origin only", async () => {
		const worker = loadKioskWorker({ network: (url) => new Response(`body of ${url}`) });

		await worker.message({
			type: "KIOSK_WARM",
			urls: [
				`${ORIGIN}/_next/static/chunks/lazy.js`,
				`${ORIGIN}/api/kiosk/employees`,
				"https://evil.test/_next/static/x.js",
			],
		});

		expect([...(worker.caches.stores.get("kiosk-shell-build-2")?.keys() ?? [])]).toEqual([
			`${ORIGIN}/_next/static/chunks/lazy.js`,
		]);
	});
});
