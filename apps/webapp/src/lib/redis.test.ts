import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const Redis = vi.fn(function RedisMock(this: { on: () => unknown; status: string }) {
		this.on = vi.fn(() => this);
		this.status = "wait";
		return this;
	});

	return { Redis };
});

vi.mock("ioredis", () => ({
	default: mocks.Redis,
}));

vi.mock("@/env", () => ({
	env: {
		CI: "false",
		NEXT_PHASE: undefined,
		NODE_ENV: "production",
		npm_lifecycle_event: undefined,
		REDIS_HOST: "redis.internal",
		REDIS_PORT: "6379",
		REDIS_TLS: "false",
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	}),
}));

describe("Redis client configuration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		Reflect.deleteProperty(globalThis, "redis");
	});

	test("keeps the offline queue enabled for lazy Redis clients", async () => {
		await import("./redis");

		expect(mocks.Redis).toHaveBeenCalled();
		expect(mocks.Redis.mock.calls[0]?.[0]).toMatchObject({
			enableOfflineQueue: true,
			lazyConnect: true,
		});
	});
});
