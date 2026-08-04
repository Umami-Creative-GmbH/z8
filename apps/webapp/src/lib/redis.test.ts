import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const listeners: Record<string, (...args: never[]) => void> = {};
	const redisSet = vi.fn();
	const Redis = vi.fn(function RedisMock(this: {
		on: () => unknown;
		set: typeof redisSet;
		status: string;
	}) {
		this.on = vi.fn((event: string, listener: (...args: never[]) => void) => {
			listeners[event] = listener;
			return this;
		});
		this.set = redisSet;
		this.status = "wait";
		return this;
	});
	const logger = {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	};

	return { listeners, logger, redisSet, Redis };
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
		REDIS_USERNAME: undefined,
		REDIS_PASSWORD: undefined,
		REDIS_TLS: "false",
		REDIS_CA_CERT: undefined,
		REDIS_COMMAND_TIMEOUT_MS: "3500",
		REDIS_MAX_RECONNECT_ATTEMPTS: "6",
		REDIS_LOG_THROTTLE_MS: "2500",
		REDIS_MAX_RETRIES_PER_REQUEST: "4",
		REDIS_RECONNECT_BASE_DELAY_MS: "110",
		REDIS_RECONNECT_MAX_DELAY_MS: "1700",
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mocks.logger,
}));

describe("Redis client configuration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		Reflect.deleteProperty(globalThis, "redis");
		for (const event of Object.keys(mocks.listeners)) {
			delete mocks.listeners[event];
		}
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("keeps the offline queue enabled for lazy Redis clients", async () => {
		await import("./redis");

		expect(mocks.Redis).toHaveBeenCalled();
		expect(mocks.Redis.mock.calls[0]?.[0]).toMatchObject({
			commandTimeout: 3_500,
			connectTimeout: 3_500,
			enableOfflineQueue: true,
			lazyConnect: true,
			maxRetriesPerRequest: 4,
		});
	});

	test("uses configured reconnect attempts and capped exponential delays", async () => {
		await import("./redis");

		const options = mocks.Redis.mock.calls[0]?.[0] as {
			retryStrategy: (times: number) => number | null;
		};

		expect(options.retryStrategy(1)).toBe(110);
		expect(options.retryStrategy(2)).toBe(220);
		expect(options.retryStrategy(5)).toBe(1_700);
		expect(options.retryStrategy(6)).toBe(1_700);
		expect(options.retryStrategy(7)).toBeNull();
		expect(options.retryStrategy(10)).toBeNull();
	});

	test("throttles Redis error logs using the configured interval", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
		await import("./redis");

		const errorListener = mocks.listeners.error;
		errorListener?.(new Error("first") as never);
		vi.advanceTimersByTime(2_499);
		errorListener?.(new Error("throttled") as never);
		vi.advanceTimersByTime(1);
		errorListener?.(new Error("second") as never);

		expect(mocks.logger.error).toHaveBeenCalledTimes(2);
	});

	test("passes a secret-store status TTL to Redis as an EX expiration", async () => {
		mocks.redisSet.mockResolvedValue("OK");
		const { secondaryStorage } = await import("./redis");

		await secondaryStorage.set(
			"secret-store-status:scaleway:org-1",
			"status",
			123,
		);

		expect(mocks.redisSet).toHaveBeenCalledWith(
			"secret-store-status:scaleway:org-1",
			"status",
			"EX",
			123,
		);
	});
});
