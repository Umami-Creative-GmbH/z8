import { describe, expect, it, vi } from "vitest";

import type { startRedisFanout as startRedisFanoutFn } from "./redis-fanout.js";
import { createNotifyRuntime } from "./runtime.js";

describe("createNotifyRuntime", () => {
	it("starts Redis fanout only once per runtime", async () => {
		const stop = vi.fn(async () => {});
		const startRedisFanout = vi.fn(async (params: Parameters<typeof startRedisFanoutFn>[0]) => {
			params.onAvailable?.();
			return stop;
		});
		const runtime = createNotifyRuntime({
			validate: vi.fn(),
			getUnreadCount: vi.fn(),
			createRedisSubscriber: vi.fn(),
			startRedisFanout,
		});

		const [firstStop, secondStop] = await Promise.all([runtime.startFanout(), runtime.startFanout()]);

		expect(startRedisFanout).toHaveBeenCalledTimes(1);
		expect(firstStop).toBe(stop);
		expect(secondStop).toBe(stop);
	});

	it("keeps the existing subscriber after transient close and rejects streams while unavailable", async () => {
		const stop = vi.fn(async () => {});
		let onUnavailable: Parameters<typeof startRedisFanoutFn>[0]["onUnavailable"];
		const validate = vi.fn(async () => ({ ok: true, userId: "user-1", organizationId: "org-1" }) as const);
		const startRedisFanout = vi.fn(async (params: Parameters<typeof startRedisFanoutFn>[0]) => {
			onUnavailable = params.onUnavailable;
			params.onAvailable?.();
			return stop;
		});
		const runtime = createNotifyRuntime({
			validate,
			getUnreadCount: vi.fn(),
			createRedisSubscriber: vi.fn(),
			startRedisFanout,
		});

		await runtime.startFanout();
		onUnavailable?.();
		await expect(runtime.startFanout()).rejects.toThrow("Notification stream unavailable");

		const response = await runtime.handler(new Request("http://local/api/notifications/stream"));

		expect(response.status).toBe(503);
		expect(startRedisFanout).toHaveBeenCalledTimes(1);
	});

	it("accepts streams after ready following a transient close without creating a second subscriber", async () => {
		const stop = vi.fn(async () => {});
		let onUnavailable: Parameters<typeof startRedisFanoutFn>[0]["onUnavailable"];
		let onAvailable: Parameters<typeof startRedisFanoutFn>[0]["onAvailable"];
		const startRedisFanout = vi.fn(async (params: Parameters<typeof startRedisFanoutFn>[0]) => {
			onUnavailable = params.onUnavailable;
			onAvailable = params.onAvailable;
			params.onAvailable?.();
			return stop;
		});
		const runtime = createNotifyRuntime({
			validate: vi.fn(async () => ({ ok: true, userId: "user-1", organizationId: "org-1" }) as const),
			getUnreadCount: vi.fn(async () => 3),
			createRedisSubscriber: vi.fn(),
			startRedisFanout,
		});

		await runtime.startFanout();
		onUnavailable?.();
		onAvailable?.();

		const response = await runtime.handler(new Request("http://local/api/notifications/stream"));

		expect(response.status).toBe(200);
		expect(startRedisFanout).toHaveBeenCalledTimes(1);
		await response.body?.cancel();
	});

	it("creates a fresh subscriber after terminal end", async () => {
		const stop = vi.fn(async () => {});
		let onTerminal: Parameters<typeof startRedisFanoutFn>[0]["onTerminal"];
		const startRedisFanout = vi.fn(async (params: Parameters<typeof startRedisFanoutFn>[0]) => {
			onTerminal = params.onTerminal;
			params.onAvailable?.();
			return stop;
		});
		const runtime = createNotifyRuntime({
			validate: vi.fn(),
			getUnreadCount: vi.fn(),
			createRedisSubscriber: vi.fn(),
			startRedisFanout,
		});

		await runtime.startFanout();
		onTerminal?.();
		await runtime.startFanout();

		expect(startRedisFanout).toHaveBeenCalledTimes(2);
	});

	it("clears fanout startup failures so later attempts can retry", async () => {
		const stop = vi.fn(async () => {});
		const startRedisFanout = vi
			.fn()
			.mockRejectedValueOnce(new Error("startup failed"))
			.mockImplementationOnce(async (params: Parameters<typeof startRedisFanoutFn>[0]) => {
				params.onAvailable?.();
				return stop;
			});
		const runtime = createNotifyRuntime({
			validate: vi.fn(),
			getUnreadCount: vi.fn(),
			createRedisSubscriber: vi.fn(),
			startRedisFanout,
		});

		await expect(runtime.startFanout()).rejects.toThrow("startup failed");
		await expect(runtime.startFanout()).resolves.toBe(stop);

		expect(startRedisFanout).toHaveBeenCalledTimes(2);
	});
});
