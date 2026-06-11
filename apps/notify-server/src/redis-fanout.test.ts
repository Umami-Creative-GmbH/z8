import { describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";

import { handleRedisMessage, startRedisFanout } from "./redis-fanout.js";

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
		expect(
			handleRedisMessage(
				"notifications:u1:extra",
				JSON.stringify({ event: "count_update", data: { count: 2, organizationId: "o1" } }),
				fanout,
			),
		).toBe(0);
		expect(handleRedisMessage("notifications:u1", JSON.stringify({ event: "heartbeat", data: {} }), fanout)).toBe(0);
		expect(fanout).not.toHaveBeenCalled();
	});

	it("ignores empty user channels", () => {
		const fanout = vi.fn(() => 1);

		expect(handleRedisMessage("notifications:", "{}", fanout)).toBe(0);
		expect(fanout).not.toHaveBeenCalled();
	});

	it("ignores malformed JSON", () => {
		const fanout = vi.fn(() => 1);

		expect(handleRedisMessage("notifications:u1", "{", fanout)).toBe(0);
		expect(fanout).not.toHaveBeenCalled();
	});

	it("delivers new notification events", () => {
		const fanout = vi.fn(() => 1);
		const data = { id: "n1", organizationId: "o1" };

		expect(handleRedisMessage("notifications:u1", JSON.stringify({ event: "new_notification", data }), fanout)).toBe(1);
		expect(fanout).toHaveBeenCalledWith("u1", "new_notification", data);
	});
});

describe("startRedisFanout", () => {
	it("subscribes to notification patterns and forwards pmessage events", async () => {
		let pmessageHandler: ((pattern: string, channel: string, message: string) => void) | undefined;
		const subscriber = {
			on: vi.fn((event: string, handler: (pattern: string, channel: string, message: string) => void) => {
				if (event === "pmessage") pmessageHandler = handler;
			}),
			off: vi.fn(),
			psubscribe: vi.fn(async () => undefined),
			punsubscribe: vi.fn(async () => undefined),
			disconnect: vi.fn(),
		};
		const fanout = vi.fn(() => 1);

		const cleanup = await startRedisFanout({ subscriber: subscriber as unknown as Redis, fanout });

		expect(subscriber.on).toHaveBeenCalledWith("pmessage", expect.any(Function));
		expect(subscriber.psubscribe).toHaveBeenCalledWith("notifications:*");

		pmessageHandler?.(
			"notifications:*",
			"notifications:u1",
			JSON.stringify({ event: "count_update", data: { count: 2, organizationId: "o1" } }),
		);
		expect(fanout).toHaveBeenCalledWith("u1", "count_update", { count: 2, organizationId: "o1" });

		await cleanup();

		expect(subscriber.off).toHaveBeenCalledWith("pmessage", pmessageHandler);
		expect(subscriber.punsubscribe).toHaveBeenCalledWith("notifications:*");
		expect(subscriber.disconnect).toHaveBeenCalled();
	});

	it("notifies every time Redis emits terminal availability events", async () => {
		const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
		const subscriber = {
			on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				const eventHandlers = handlers.get(event) ?? new Set<(...args: unknown[]) => void>();
				eventHandlers.add(handler);
				handlers.set(event, eventHandlers);
			}),
			off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				handlers.get(event)?.delete(handler);
			}),
			psubscribe: vi.fn(async () => undefined),
			punsubscribe: vi.fn(async () => undefined),
			disconnect: vi.fn(),
		};
		const onUnavailable = vi.fn();

		await startRedisFanout({ subscriber: subscriber as unknown as Redis, fanout: vi.fn(), onUnavailable });

		for (const handler of handlers.get("close") ?? []) handler();
		for (const handler of handlers.get("end") ?? []) handler();

		expect(onUnavailable).toHaveBeenCalledTimes(2);
	});

	it("removes terminal availability listeners during cleanup", async () => {
		const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
		const subscriber = {
			on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				const eventHandlers = handlers.get(event) ?? new Set<(...args: unknown[]) => void>();
				eventHandlers.add(handler);
				handlers.set(event, eventHandlers);
			}),
			off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				handlers.get(event)?.delete(handler);
			}),
			psubscribe: vi.fn(async () => undefined),
			punsubscribe: vi.fn(async () => undefined),
			disconnect: vi.fn(),
		};
		const onUnavailable = vi.fn();

		const cleanup = await startRedisFanout({ subscriber: subscriber as unknown as Redis, fanout: vi.fn(), onUnavailable });
		await cleanup();

		for (const handler of handlers.get("close") ?? []) handler();
		for (const handler of handlers.get("end") ?? []) handler();

		expect(onUnavailable).not.toHaveBeenCalled();
		expect(subscriber.off).toHaveBeenCalledWith("close", expect.any(Function));
		expect(subscriber.off).toHaveBeenCalledWith("end", expect.any(Function));
	});
});
