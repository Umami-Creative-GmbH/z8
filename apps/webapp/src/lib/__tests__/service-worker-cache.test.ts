import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, test } from "vitest";

function loadServiceWorkerHelpers() {
	const swPath = path.resolve(__dirname, "../../../public/sw.js");
	const script = readFileSync(swPath, "utf8");
	const context = {
		console,
		URL,
		importScripts: () => {},
		self: {
			addEventListener: () => {},
			location: { origin: "https://z8.test" },
		},
	};

	vm.runInNewContext(script, context);
	return context as typeof context & {
		isStaticAsset: (pathname: string) => boolean;
		getSafeNotificationUrl: (url: string) => string;
		shouldNotifyUpdateOnActivation: () => boolean;
	};
}

function loadSyncService() {
	const syncServicePath = path.resolve(__dirname, "../../../public/lib/sync-service.js");
	const script = readFileSync(syncServicePath, "utf8");
	const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
	const context = {
		console,
		fetchCalls,
		setTimeout,
		clearTimeout,
		AbortController,
		URL,
		fetch: async (url: string, init: RequestInit) => {
			fetchCalls.push({ url, init });
			return new Response(JSON.stringify({ entry: { id: "entry-1" } }), { status: 201 });
		},
		self: {
			location: { origin: "https://z8.test" },
			clients: { matchAll: async () => [] },
			OfflineQueueDB: {
				getPending: async () => [],
				remove: async () => {},
				incrementRetry: async () => {},
			},
		},
	};

	vm.runInNewContext(script, context);
	return context as typeof context & {
		fetchCalls: Array<{ url: string; init: RequestInit }>;
		self: typeof context.self & {
			SyncService: {
				syncEvent: (event: Record<string, unknown>) => Promise<{ success: boolean }>;
			};
		};
	};
}

describe("service worker cache routing", () => {
	test("does not handle Next.js runtime assets as offline static assets", () => {
		const { isStaticAsset } = loadServiceWorkerHelpers();

		expect(isStaticAsset("/_next/static/chunks/app/layout.js")).toBe(false);
		expect(isStaticAsset("/favicon-32x32.png")).toBe(true);
	});

	test("only opens same-origin notification URLs", () => {
		const { getSafeNotificationUrl } = loadServiceWorkerHelpers();

		expect(getSafeNotificationUrl("/settings/notifications")).toBe(
			"https://z8.test/settings/notifications",
		);
		expect(getSafeNotificationUrl("https://z8.test/time-tracking")).toBe(
			"https://z8.test/time-tracking",
		);
		expect(getSafeNotificationUrl("https://evil.test/phish")).toBe("https://z8.test/");
	});

	test("does not announce an update before an existing controller is present", () => {
		const { shouldNotifyUpdateOnActivation } = loadServiceWorkerHelpers();

		expect(shouldNotifyUpdateOnActivation()).toBe(false);
	});

	test("includes captured organization when syncing queued clock events", async () => {
		const context = loadSyncService();

		await context.self.SyncService.syncEvent({
			type: "clock_in",
			timestamp: Date.UTC(2026, 0, 1),
			organizationId: "org-at-click",
			browserTimezone: "Europe/Berlin",
		});

		expect(JSON.parse(String(context.fetchCalls[0]?.init.body))).toMatchObject({
			organizationId: "org-at-click",
		});
	});

	test("offline clock hook registers the service worker independently of push setup", () => {
		const hookPath = path.resolve(__dirname, "../../hooks/use-offline-clock.ts");
		const source = readFileSync(hookPath, "utf8");

		expect(source).toContain('navigator.serviceWorker.register("/sw.js"');
	});

	test("update prompt only reloads after the user accepts an update", () => {
		const promptPath = path.resolve(__dirname, "../../components/offline/sw-update-prompt.tsx");
		const source = readFileSync(promptPath, "utf8");

		expect(source).toContain("shouldReloadOnControllerChangeRef.current");
	});
});
