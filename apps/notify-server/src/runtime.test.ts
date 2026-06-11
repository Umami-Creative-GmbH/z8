import { describe, expect, it, vi } from "vitest";

import type { startRedisFanout as startRedisFanoutFn } from "./redis-fanout.js";
import { createNotifyRuntime } from "./runtime.js";

describe("createNotifyRuntime", () => {
	it("starts Redis fanout only once per runtime", async () => {
		const stop = vi.fn(async () => {});
		const startRedisFanout = vi.fn(async () => stop);
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

	it("can restart fanout after Redis becomes unavailable", async () => {
		const stop = vi.fn(async () => {});
		let onUnavailable: Parameters<typeof startRedisFanoutFn>[0]["onUnavailable"];
		const startRedisFanout = vi.fn(async (params: Parameters<typeof startRedisFanoutFn>[0]) => {
			onUnavailable = params.onUnavailable;
			return stop;
		});
		const runtime = createNotifyRuntime({
			validate: vi.fn(),
			getUnreadCount: vi.fn(),
			createRedisSubscriber: vi.fn(),
			startRedisFanout,
		});

		await runtime.startFanout();
		onUnavailable?.();
		await runtime.startFanout();

		expect(startRedisFanout).toHaveBeenCalledTimes(2);
	});

	it("clears fanout startup failures so later attempts can retry", async () => {
		const stop = vi.fn(async () => {});
		const startRedisFanout = vi.fn().mockRejectedValueOnce(new Error("startup failed")).mockResolvedValueOnce(stop);
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
