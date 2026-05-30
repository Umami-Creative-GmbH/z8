import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type SyncService = {
	syncEvent: (event: Record<string, unknown>) => Promise<{ success: boolean }>;
};

type ServiceWorkerGlobal = {
	location: { origin: string };
	clients: { matchAll: ReturnType<typeof vi.fn> };
	SyncService?: SyncService;
};

function loadSyncService(fetchMock: ReturnType<typeof vi.fn>, intlApi: typeof Intl = Intl) {
	const serviceWorkerGlobal: ServiceWorkerGlobal = {
		location: { origin: "https://app.example.com" },
		clients: { matchAll: vi.fn() },
	};
	const context = vm.createContext({
		AbortController,
		Intl: intlApi,
		URL,
		console,
		fetch: fetchMock,
		self: serviceWorkerGlobal,
		setTimeout,
		clearTimeout,
	});
	const script = readFileSync(resolve(process.cwd(), "public/lib/sync-service.js"), "utf8");

	vm.runInContext(script, context);

	if (!serviceWorkerGlobal.SyncService) {
		throw new Error("SyncService was not registered on the service worker global");
	}

	return serviceWorkerGlobal.SyncService;
}

function getFetchRequestBody(fetchMock: ReturnType<typeof vi.fn>) {
	const call = fetchMock.mock.calls[0];
	if (!call) {
		throw new Error("Expected sync service to call fetch");
	}

	const init = call[1] as RequestInit | undefined;
	if (!init?.body || typeof init.body !== "string") {
		throw new Error("Expected sync service fetch call to include a JSON string body");
	}

	return JSON.parse(init.body) as Record<string, unknown>;
}

describe("public sync service", () => {
	it("normalizes obsolete field work location before syncing", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ entry: { id: "entry-1" } }),
		}));
		const syncService = loadSyncService(fetchMock);

		await syncService.syncEvent({
			type: "clock_in",
			timestamp: "2026-05-08T10:00:00.000Z",
			workLocationType: "field",
		});

		const body = getFetchRequestBody(fetchMock);
		expect(body.workLocationType).toBe("remote");
	});

	it("omits unknown work location values before syncing", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ entry: { id: "entry-1" } }),
		}));
		const syncService = loadSyncService(fetchMock);

		await syncService.syncEvent({
			type: "clock_in",
			timestamp: "2026-05-08T10:00:00.000Z",
			workLocationType: "warehouse",
		});

		const body = getFetchRequestBody(fetchMock);
		expect(body).not.toHaveProperty("workLocationType");
	});

	it("does not add current browser timezone when queued event has no browser timezone", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ entry: { id: "entry-1" } }),
		}));
		const intlApi = {
			DateTimeFormat: () => ({
				resolvedOptions: () => ({ timeZone: "America/New_York" }),
			}),
		} as unknown as typeof Intl;
		const syncService = loadSyncService(fetchMock, intlApi);

		await syncService.syncEvent({
			type: "clock_in",
			timestamp: "2026-05-08T10:00:00.000Z",
		});

		const body = getFetchRequestBody(fetchMock);
		expect(body).not.toHaveProperty("browserTimezone");
	});

	it("syncs browser timezone captured on the queued event", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ entry: { id: "entry-1" } }),
		}));
		const syncService = loadSyncService(fetchMock);

		await syncService.syncEvent({
			type: "clock_in",
			timestamp: "2026-05-08T10:00:00.000Z",
			browserTimezone: "Europe/Berlin",
		});

		const body = getFetchRequestBody(fetchMock);
		expect(body.browserTimezone).toBe("Europe/Berlin");
	});
});
