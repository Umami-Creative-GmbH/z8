import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const listeners: Record<string, (...args: never[]) => void> = {};
	const env = {
		CI: "false",
		NEXT_PHASE: undefined as string | undefined,
		NODE_ENV: "production",
		npm_lifecycle_event: undefined as string | undefined,
		REDIS_HOST: "redis.internal" as string | undefined,
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
	};
	const redisEval = vi.fn();
	const redisSet = vi.fn();
	const Redis = vi.fn(function RedisMock(this: {
		eval: typeof redisEval;
		on: () => unknown;
		set: typeof redisSet;
		status: string;
	}) {
		this.on = vi.fn((event: string, listener: (...args: never[]) => void) => {
			listeners[event] = listener;
			return this;
		});
		this.eval = redisEval;
		this.set = redisSet;
		this.status = "wait";
		return this;
	});
	const logger = {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	};

	return { env, listeners, logger, redisEval, redisSet, Redis };
});

vi.mock("ioredis", () => ({
	default: mocks.Redis,
}));

vi.mock("@/env", () => ({
	env: mocks.env,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mocks.logger,
}));

describe("Redis client configuration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		mocks.env.CI = "false";
		mocks.env.NEXT_PHASE = undefined;
		mocks.env.npm_lifecycle_event = undefined;
		mocks.env.REDIS_HOST = "redis.internal";
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

	test("increments atomically and sets expiry only when the key is new", async () => {
		mocks.redisEval.mockResolvedValueOnce(1).mockResolvedValueOnce("2");
		const { secondaryStorage } = await import("./redis");

		await expect(
			secondaryStorage.increment("rate-limit:user-1", 60),
		).resolves.toBe(1);
		await expect(
			secondaryStorage.increment("rate-limit:user-1", 60),
		).resolves.toBe(2);

		expect(mocks.redisEval).toHaveBeenCalledTimes(2);
		const [script, keyCount, key, ttl] = mocks.redisEval.mock.calls[0] ?? [];
		expect(keyCount).toBe(1);
		expect(key).toBe("rate-limit:user-1");
		expect(ttl).toBe(60);
		expect(script).toMatch(
			/local existed = redis\.call\(["']EXISTS["'], KEYS\[1\]\)/,
		);
		expect(script).toMatch(
			/local value = redis\.call\(["']INCR["'], KEYS\[1\]\)/,
		);
		expect(script.indexOf("EXISTS")).toBeLessThan(script.indexOf("INCR"));
		expect(script).toMatch(
			/if existed == 0 then[\s\S]*redis\.call\(["']EXPIRE["'], KEYS\[1\], ARGV\[1\]\)/,
		);
		expect(script).not.toMatch(/if value == 1/);
		expect(mocks.redisEval.mock.calls[1]?.[0]).toBe(script);
	});

	test("gets and deletes a value atomically", async () => {
		mocks.redisEval
			.mockResolvedValueOnce("one-time-secret")
			.mockResolvedValueOnce(null);
		const { secondaryStorage } = await import("./redis");

		await expect(
			secondaryStorage.getAndDelete("verification:token"),
		).resolves.toBe("one-time-secret");
		await expect(
			secondaryStorage.getAndDelete("verification:token"),
		).resolves.toBeNull();

		expect(mocks.redisEval).toHaveBeenCalledTimes(2);
		const [script, keyCount, key] = mocks.redisEval.mock.calls[0] ?? [];
		expect(keyCount).toBe(1);
		expect(key).toBe("verification:token");
		expect(script).toMatch(/redis\.call\(["']GET["'], KEYS\[1\]\)/);
		expect(script).toMatch(
			/if value then[\s\S]*redis\.call\(["']DEL["'], KEYS\[1\]\)/,
		);
		expect(mocks.redisEval.mock.calls[1]?.[0]).toBe(script);
	});

	test("returns atomic-operation sentinels without Redis during builds", async () => {
		mocks.env.NEXT_PHASE = "phase-production-build";
		const { secondaryStorage } = await import("./redis");

		await expect(
			secondaryStorage.increment("rate-limit:user-1", 60),
		).resolves.toBe(0);
		await expect(
			secondaryStorage.getAndDelete("verification:token"),
		).resolves.toBeNull();
		expect(mocks.Redis).not.toHaveBeenCalled();
		expect(mocks.redisEval).not.toHaveBeenCalled();
	});

	test("fails open without logging cached values when atomic Redis operations fail", async () => {
		mocks.redisEval.mockRejectedValue(new Error("redis unavailable"));
		const { secondaryStorage } = await import("./redis");

		await expect(
			secondaryStorage.increment("rate-limit:user-1", 60),
		).resolves.toBe(0);
		await expect(
			secondaryStorage.getAndDelete("verification:token"),
		).resolves.toBeNull();

		expect(mocks.logger.error).toHaveBeenCalledTimes(2);
		expect(mocks.logger.error).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				error: expect.any(Error),
				key: "rate-limit:user-1",
			}),
			"Failed to increment in Redis",
		);
		expect(mocks.logger.error).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				error: expect.any(Error),
				key: "verification:token",
			}),
			"Failed to get and delete from Redis",
		);
		expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain(
			"one-time-secret",
		);
	});
});
