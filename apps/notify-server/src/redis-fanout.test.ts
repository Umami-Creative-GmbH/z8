import { describe, expect, it, vi } from "vitest";

import { handleRedisMessage } from "./redis-fanout.js";

describe("handleRedisMessage", () => {
	it("delivers supported notification events to channel user", () => {
		const fanout = vi.fn(() => 1);
		const delivered = handleRedisMessage(
			"notifications:u1",
			JSON.stringify({ event: "count_update", data: { count: 2, organizationId: "o1" } }),
			fanout,
		);

		expect(delivered).toBe(1);
		expect(fanout).toHaveBeenCalledWith("u1", "count_update", { count: 2, organizationId: "o1" });
	});

	it("ignores malformed channels and unsupported events", () => {
		const fanout = vi.fn(() => 1);

		expect(handleRedisMessage("jobs:u1", "{}", fanout)).toBe(0);
		expect(handleRedisMessage("notifications:u1", JSON.stringify({ event: "heartbeat", data: {} }), fanout)).toBe(0);
		expect(fanout).not.toHaveBeenCalled();
	});
});
