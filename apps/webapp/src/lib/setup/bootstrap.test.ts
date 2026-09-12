import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createSetupBootstrap,
	SETUP_KEY,
	SETUP_SESSION_KEY,
} from "./bootstrap";

const redisUrl = process.env.SETUP_REDIS_TEST_URL;

function required<T>(value: T | null | undefined): T {
	expect(value).not.toBeNull();
	expect(value).not.toBeUndefined();
	if (value == null) throw new Error("Expected setup credentials");
	return value;
}

describe.skipIf(!redisUrl)("setup bootstrap (isolated Redis)", () => {
	const redis = new Redis(redisUrl ?? "redis://127.0.0.1:6379", {
		lazyConnect: true,
	});
	let configured = false;
	const bootstrap = createSetupBootstrap({
		redis,
		ready: async () => true,
		isConfigured: async () => configured,
	});

	beforeEach(async () => {
		configured = false;
		await redis.del(SETUP_KEY, SETUP_SESSION_KEY);
	});
	afterAll(async () => {
		await redis.del(SETUP_KEY, SETUP_SESSION_KEY);
		await redis.quit();
	});

	it("creates one random code for concurrent startups with a one-hour expiry", async () => {
		const results = await Promise.all(
			Array.from({ length: 12 }, () => bootstrap.initialize()),
		);
		expect(new Set(results.map((result) => result?.code)).size).toBe(1);
		expect(results[0]?.code).toMatch(/^[a-f0-9]{64}$/);
		expect(await redis.pttl(SETUP_KEY)).toBeGreaterThan(3_590_000);
		expect(await redis.pttl(SETUP_KEY)).toBeLessThanOrEqual(3_600_000);
	});

	it("reuses an unexpired code without extending its original expiry", async () => {
		const first = required(await bootstrap.initialize());
		await redis.pexpire(SETUP_KEY, 40_000);
		expect((await bootstrap.initialize())?.code).toBe(first?.code);
		expect(await redis.pttl(SETUP_KEY)).toBeLessThanOrEqual(40_000);
	});

	it("only startup can generate a replacement after expiry", async () => {
		const first = required(await bootstrap.initialize());
		await redis.pexpire(SETUP_KEY, 1);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(await bootstrap.exchange(first.code)).toBeNull();
		expect(await redis.exists(SETUP_KEY)).toBe(0);
		expect((await bootstrap.initialize())?.code).not.toBe(first?.code);
	});

	it("atomically exchanges a code once and caps authorization to the original hour", async () => {
		const initial = required(await bootstrap.initialize());
		await redis.pexpire(SETUP_KEY, 30_000);
		const results = await Promise.all(
			Array.from({ length: 12 }, () => bootstrap.exchange(initial.code)),
		);
		const successes = results.filter((result) => result !== null);
		expect(successes).toHaveLength(1);
		const session = required(successes[0]);
		expect(session.maxAge).toBeLessThanOrEqual(30);
		expect(session.maxAge).toBeGreaterThan(0);
		expect(await bootstrap.authorize(session.token)).toBe(true);
		expect(await bootstrap.exchange(initial.code)).toBeNull();
		expect((await bootstrap.initialize())?.code).toBe(initial.code);
		expect(await bootstrap.exchange(initial.code)).toBeNull();
	});

	it("limits the cookie to ten minutes and rejects missing, invalid and expired sessions", async () => {
		const initial = required(await bootstrap.initialize());
		expect(await bootstrap.exchange("0".repeat(64))).toBeNull();
		expect(await bootstrap.exchange("invalid")).toBeNull();
		const session = required(await bootstrap.exchange(initial.code));
		expect(session.maxAge).toBe(600);
		expect(await bootstrap.authorize(undefined)).toBe(false);
		expect(await bootstrap.authorize("0".repeat(64))).toBe(false);
		await redis.pexpire(SETUP_SESSION_KEY, 1);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(await bootstrap.authorize(session.token)).toBe(false);
		expect(await bootstrap.exchange(initial.code)).toBeNull();
	});

	it("requires the original bootstrap to remain live and invalidates all bootstrap state", async () => {
		const initial = required(await bootstrap.initialize());
		const session = required(await bootstrap.exchange(initial.code));
		await bootstrap.invalidate();
		expect(await bootstrap.authorize(session.token)).toBe(false);
		expect(await bootstrap.exchange(initial.code)).toBeNull();
		expect(await redis.exists(SETUP_KEY, SETUP_SESSION_KEY)).toBe(0);
	});
	it("validates session identity and expiry in the transaction-only Redis recheck", async () => {
		const initial = required(await bootstrap.initialize());
		const session = required(await bootstrap.exchange(initial.code));
		expect(await bootstrap.authorizeWithinSetupTransaction(session.token)).toBe(
			true,
		);
		expect(
			await bootstrap.authorizeWithinSetupTransaction("0".repeat(64)),
		).toBe(false);
		expect(await bootstrap.authorizeWithinSetupTransaction(undefined)).toBe(
			false,
		);
		await redis.pexpire(SETUP_SESSION_KEY, 1);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(await bootstrap.authorizeWithinSetupTransaction(session.token)).toBe(
			false,
		);
	});

	it("never authorizes or initializes after an admin exists, even with leftover Redis state", async () => {
		const initial = required(await bootstrap.initialize());
		const session = required(await bootstrap.exchange(initial.code));
		configured = true;
		expect(await bootstrap.initialize()).toBeNull();
		expect(await bootstrap.authorize(session.token)).toBe(false);
		expect(await bootstrap.exchange(initial.code)).toBeNull();
	});
});

describe("setup Redis failure handling", () => {
	it("fails closed if the readiness check reports a build noop or unavailable Redis", async () => {
		const evalCommand = vi.fn();
		const bootstrap = createSetupBootstrap({
			redis: { eval: evalCommand },
			ready: async () => false,
			isConfigured: async () => false,
		});
		await expect(bootstrap.initialize()).rejects.toThrow(
			"Setup authorization unavailable",
		);
		await expect(bootstrap.exchange("a".repeat(64))).rejects.toThrow(
			"Setup authorization unavailable",
		);
		await expect(bootstrap.authorize("a".repeat(64))).rejects.toThrow(
			"Setup authorization unavailable",
		);
		await expect(bootstrap.invalidate()).rejects.toThrow(
			"Setup authorization unavailable",
		);
		expect(evalCommand).not.toHaveBeenCalled();
	});

	it("sanitizes Redis errors so commands containing credentials cannot reach normal logs", async () => {
		const bootstrap = createSetupBootstrap({
			redis: {
				eval: vi.fn().mockRejectedValue(new Error("secret command contents")),
			},
			ready: async () => true,
			isConfigured: async () => false,
		});
		await expect(bootstrap.exchange("a".repeat(64))).rejects.toThrow(
			/^Setup authorization unavailable$/,
		);
	});
});
