import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
	const listeners = new Map<string, (event: unknown) => void>();
	const enqueue = vi.fn().mockResolvedValue("local-record");
	const register = vi
		.fn()
		.mockRejectedValue(new Error("Background sync unavailable"));
	const notifyQueueUpdate = vi
		.fn()
		.mockRejectedValue(new Error("Client closed"));
	const processQueue = vi
		.fn()
		.mockResolvedValue({
			successCount: 0,
			failureCount: 1,
			retryPending: false,
		});
	const context = {
		console,
		URL,
		Response,
		Request,
		AbortController,
		AbortSignal,
		setTimeout,
		clearTimeout,
		importScripts() {},
		fetch: vi.fn(),
		self: {
			location: { origin: "https://z8.test" },
			addEventListener: (type: string, listener: (event: unknown) => void) =>
				listeners.set(type, listener),
			registration: { sync: { register } },
			OfflineQueueDB: {
				enqueue,
				getRecords: vi.fn().mockResolvedValue([]),
				canInspect: vi.fn().mockReturnValue(true),
			},
			ClockCommandStore: {
				list: vi.fn().mockResolvedValue([]),
				canInspect: vi.fn().mockReturnValue(true),
				isUnacknowledgedRejection: vi.fn().mockReturnValue(false),
			},
			ClockCommandDispatch: {
				process: vi.fn().mockResolvedValue({ status: "idle", committed: [] }),
			},
			SyncService: {
				notifyQueueUpdate,
				processQueue,
				broadcastMessage: vi.fn().mockResolvedValue(undefined),
			},
		},
	};
	vm.runInNewContext(readFileSync(resolve("public/sw.js"), "utf8"), context);
	async function message(type: string, payload?: unknown, expectedContext?: unknown) {
		const postMessage = vi.fn();
		let completion: Promise<unknown> = Promise.resolve();
		listeners.get("message")!({
			data: { type, payload, context: expectedContext },
			ports: [{ postMessage }],
			waitUntil(promise: Promise<unknown>) {
				completion = promise;
			},
		});
		await completion;
		return postMessage;
	}
	return {
		...context,
		message,
		enqueue,
		register,
		notifyQueueUpdate,
		processQueue,
	};
}

describe("offline worker caller acknowledgments", () => {
	it("returns exact empty queue counts without contacting unavailable remote authority", async () => {
		const sw = worker();
		sw.fetch.mockRejectedValue(new Error("Remote unavailable"));
		const reply = await sw.message("GET_QUEUE_COUNT");
		expect(reply).toHaveBeenCalledExactlyOnceWith({
			count: 0,
			reviewCount: 0,
			waitingCount: 0,
			savedCount: 0,
		});
		expect(sw.self.OfflineQueueDB.getRecords).toHaveBeenCalledOnce();
		expect(sw.self.ClockCommandStore.list).toHaveBeenCalledOnce();
		expect(sw.fetch).not.toHaveBeenCalled();
	});

	it.each(["legacy", "commands"])("requires fresh authorization before filtering nonempty %s records from another organization", async (store) => {
		const sw = worker();
		const foreign = { id: "foreign-record", organizationId: "other-org" };
		const local = store === "legacy" ? sw.self.OfflineQueueDB : sw.self.ClockCommandStore;
		if (store === "legacy") sw.self.OfflineQueueDB.getRecords.mockResolvedValue([foreign]);
		else sw.self.ClockCommandStore.list.mockResolvedValue([foreign]);
		local.canInspect.mockReturnValue(false);
		for (const userId of ["first-user", "next-user"]) {
			sw.fetch.mockResolvedValueOnce(Response.json({ userId, organizationId: "current-org" }));
			const reply = await sw.message("GET_QUEUE_COUNT");
			expect(reply).toHaveBeenCalledExactlyOnceWith({ count: 0, reviewCount: 0, waitingCount: 0, savedCount: 0 });
			expect(local.canInspect).toHaveBeenLastCalledWith(foreign, { userId, organizationId: "current-org", serverOrigin: "https://z8.test" });
		}
		expect(sw.fetch).toHaveBeenCalledTimes(2);
		expect(sw.fetch).toHaveBeenLastCalledWith(new URL("https://z8.test/api/time-entries/offline-context"), {
			credentials: "include", cache: "no-store", signal: expect.any(AbortSignal),
		});
	});

	it("retains authorized legacy and command count semantics for nonempty stores", async () => {
		const sw = worker();
		sw.self.OfflineQueueDB.getRecords.mockResolvedValue([
			{ id: "legacy" }, { id: "archived", recovery: { state: "archived" } },
		]);
		sw.self.ClockCommandStore.list.mockResolvedValue([
			{ state: "pending" }, { state: "review_required" }, { state: "committed" }, { state: "rejected", resolvedAt: 1 },
		]);
		sw.fetch.mockResolvedValue(Response.json({ userId: "user", organizationId: "org" }));
		const reply = await sw.message("GET_QUEUE_COUNT");
		expect(reply).toHaveBeenCalledExactlyOnceWith({ count: 3, reviewCount: 2, waitingCount: 1, savedCount: 4 });
		expect(sw.fetch).toHaveBeenCalledOnce();
	});

	it.each(["legacy", "commands"])("does not bypass a remote refusal for nonempty %s records", async (store) => {
		const sw = worker();
		if (store === "legacy") sw.self.OfflineQueueDB.getRecords.mockResolvedValue([{ id: "saved" }]);
		else sw.self.ClockCommandStore.list.mockResolvedValue([{ state: "pending" }]);
		sw.fetch.mockResolvedValue(new Response(null, { status: 401 }));
		const reply = await sw.message("GET_QUEUE_COUNT");
		expect(reply).toHaveBeenCalledExactlyOnceWith({ count: 0, error: "Sign in with an authorized organization to review saved clock records." });
		expect(sw.fetch).toHaveBeenCalledOnce();
		expect(sw.self.OfflineQueueDB.canInspect).not.toHaveBeenCalled();
		expect(sw.self.ClockCommandStore.canInspect).not.toHaveBeenCalled();
	});

	it("rejects a changed account or organization before inspecting nonempty records", async () => {
		const sw = worker();
		sw.self.ClockCommandStore.list.mockResolvedValue([{ state: "pending" }]);
		sw.fetch.mockResolvedValue(Response.json({ userId: "new-user", organizationId: "new-org" }));
		const reply = await sw.message("GET_QUEUE_COUNT", undefined, { userId: "old-user", organizationId: "old-org" });
		expect(reply).toHaveBeenCalledExactlyOnceWith({ count: 0, error: "Account or organization changed. Restore the captured context to review records." });
		expect(sw.self.ClockCommandStore.canInspect).not.toHaveBeenCalled();
	});

	it.each(["legacy", "commands"])("does not report clean empty counts after a %s store read error", async (store) => {
		const sw = worker();
		if (store === "legacy") sw.self.OfflineQueueDB.getRecords.mockRejectedValue(new Error("Local read failed"));
		else sw.self.ClockCommandStore.list.mockRejectedValue(new Error("Local read failed"));
		sw.fetch.mockResolvedValue(Response.json({ userId: "user", organizationId: "org" }));
		const reply = await sw.message("GET_QUEUE_COUNT");
		expect(reply).toHaveBeenCalledExactlyOnceWith({ count: 0, error: "Local read failed" });
		expect(sw.fetch).toHaveBeenCalledOnce();
	});

	it("reports durable local acceptance even when later scheduling/status notification fails", async () => {
		const sw = worker();
		const reply = await sw.message("QUEUE_CLOCK_EVENT", {
			type: "clock_in",
			timestamp: 123,
			organizationId: "org-1",
		});
		expect(reply).toHaveBeenCalledOnce();
		expect(reply).toHaveBeenCalledWith(
			expect.objectContaining({
				success: true,
				eventId: "local-record",
				commitment: "unknown",
			}),
		);
	});

	it("acknowledges manual processing immediately and finishes even without Background Sync", async () => {
		const sw = worker();
		const reply = await sw.message("TRIGGER_SYNC");
		expect(reply).toHaveBeenCalledExactlyOnceWith({
			success: true,
			accepted: true,
		});
		expect(sw.processQueue).toHaveBeenCalledOnce();
		expect(sw.register).not.toHaveBeenCalled();
		expect(sw.self.SyncService.broadcastMessage).toHaveBeenLastCalledWith({
			type: "SYNC_COMPLETED",
		});
	});

	it("does not turn failed local persistence into accepted work", async () => {
		const sw = worker();
		sw.enqueue.mockRejectedValue(new Error("Quota exceeded"));
		const reply = await sw.message("QUEUE_CLOCK_EVENT", { type: "clock_in" });
		expect(reply).toHaveBeenCalledExactlyOnceWith({
			success: false,
			error: "Quota exceeded",
		});
		expect(sw.notifyQueueUpdate).not.toHaveBeenCalled();
	});

	it("reports storage update errors and registers retry within the worker lifetime", async () => {
		const sw = worker();
		sw.processQueue.mockRejectedValue(new Error("Transaction aborted"));
		sw.register.mockResolvedValue(undefined);
		await sw.message("TRIGGER_SYNC");
		expect(sw.register).toHaveBeenCalledWith("clock-sync");
		expect(sw.self.SyncService.broadcastMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "SYNC_ERROR" }),
		);
		expect(sw.self.SyncService.broadcastMessage).toHaveBeenLastCalledWith({
			type: "SYNC_COMPLETED",
		});
	});
});
