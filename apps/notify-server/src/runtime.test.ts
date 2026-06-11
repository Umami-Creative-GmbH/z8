import { describe, expect, it, vi } from "vitest";

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
});
