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
			OfflineQueueDB: { enqueue },
			SyncService: {
				notifyQueueUpdate,
				processQueue,
				broadcastMessage: vi.fn().mockResolvedValue(undefined),
			},
		},
	};
	vm.runInNewContext(readFileSync(resolve("public/sw.js"), "utf8"), context);
	async function message(type: string, payload?: unknown) {
		const postMessage = vi.fn();
		let completion: Promise<unknown> = Promise.resolve();
		listeners.get("message")!({
			data: { type, payload },
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
