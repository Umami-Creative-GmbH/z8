import { Effect, Exit } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pool = vi.hoisted(() => ({
	occupied: false,
	secondConnectionAttempts: 0,
	events: [] as string[],
	select: vi.fn(),
	transaction: vi.fn(),
	txLimit: vi.fn(),
	values: vi.fn(),
	eval: vi.fn(),
	configured: vi.fn(),
	transactionRedisResult: 1 as number | Error,
}));

vi.mock("@/db", () => ({
	db: { select: pool.select, transaction: pool.transaction },
}));
vi.mock("@/db/auth-schema", () => ({
	user: { id: "id", role: "role", email: "email" },
	account: {},
}));
vi.mock("@/db/schema", () => ({ platformAdminAuditLog: {} }));
vi.mock("@/lib/setup/config-cache", () => ({
	setConfiguredStatus: pool.configured,
}));
vi.mock("@/lib/redis", () => ({
	ensureRedisReady: async () => true,
	redis: { status: "ready", ping: async () => "PONG", eval: pool.eval },
}));
vi.mock("better-auth/crypto", () => ({ hashPassword: async () => "hashed" }));

// Exercise the real service, bootstrap adapter and authorization implementation.
import { SetupService, SetupServiceLive } from "./setup.service";

const createAdmin = () =>
	Effect.runPromiseExit(
		Effect.gen(function* () {
			const service = yield* SetupService;
			return yield* service.createPlatformAdmin(
				{
					name: "Operator",
					email: "admin@example.com",
					password: "StrongPassword123",
				},
				"a".repeat(64),
			);
		}).pipe(Effect.provide(SetupServiceLive)),
	);

describe("setup with a single-slot database pool", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		pool.occupied = false;
		pool.secondConnectionAttempts = 0;
		pool.events = [];
		pool.transactionRedisResult = 1;
		pool.select.mockImplementation(() => {
			if (pool.occupied) {
				pool.secondConnectionAttempts++;
				throw new Error("Single-slot pool exhausted by global DB query");
			}
			pool.events.push("global-admin-check");
			return { from: () => ({ where: () => ({ limit: async () => [] }) }) };
		});
		pool.txLimit.mockImplementation(async () => {
			pool.events.push("transaction-query");
			return [];
		});
		pool.transaction.mockImplementation(async (callback) => {
			pool.occupied = true;
			try {
				const result = await callback({
					execute: async () => {
						pool.events.push("advisory-lock");
					},
					select: () => ({
						from: () => ({ where: () => ({ limit: pool.txLimit }) }),
					}),
					insert: () => ({ values: pool.values }),
				});
				pool.events.push("commit");
				return result;
			} finally {
				pool.occupied = false;
			}
		});
		pool.eval.mockImplementation(async (script: string) => {
			if (script.startsWith("return redis.call('DEL'")) {
				pool.events.push("invalidate");
				return 2;
			}
			pool.events.push(pool.occupied ? "locked-redis-check" : "redis-check");
			if (pool.occupied) {
				if (pool.transactionRedisResult instanceof Error) {
					throw pool.transactionRedisResult;
				}
				return pool.transactionRedisResult;
			}
			return 1;
		});
	});

	it("creates the admin without requesting a second pooled connection", async () => {
		expect(Exit.isSuccess(await createAdmin())).toBe(true);
		expect(pool.secondConnectionAttempts).toBe(0);
		expect(pool.select).toHaveBeenCalledOnce();
		expect(pool.values).toHaveBeenCalledTimes(3);
		expect(pool.events).toEqual([
			"global-admin-check",
			"redis-check",
			"advisory-lock",
			"transaction-query",
			"locked-redis-check",
			"transaction-query",
			"commit",
			"invalidate",
		]);
	});

	it.each([0, new Error("Redis disconnected")])(
		"rechecks Redis after the lock and denies expiry or failure: %s",
		async (redisResult) => {
			pool.transactionRedisResult = redisResult;
			expect(Exit.isFailure(await createAdmin())).toBe(true);
			expect(pool.secondConnectionAttempts).toBe(0);
			expect(pool.events).toContain("locked-redis-check");
			expect(pool.values).not.toHaveBeenCalled();
			expect(pool.events).not.toContain("invalidate");
		},
	);

	it("denies an existing admin from the transaction's own query", async () => {
		pool.txLimit.mockResolvedValueOnce([{ id: "existing-admin" }]);
		expect(Exit.isFailure(await createAdmin())).toBe(true);
		expect(pool.secondConnectionAttempts).toBe(0);
		expect(pool.select).toHaveBeenCalledOnce();
		expect(pool.values).not.toHaveBeenCalled();
		expect(pool.events).not.toContain("locked-redis-check");
	});

	it("keeps a failed transaction retryable and cleans up only after commit", async () => {
		pool.values.mockRejectedValueOnce(new Error("insert failed"));
		expect(Exit.isFailure(await createAdmin())).toBe(true);
		expect(pool.events).not.toContain("invalidate");
		expect(Exit.isSuccess(await createAdmin())).toBe(true);
		expect(pool.secondConnectionAttempts).toBe(0);
		expect(pool.events.slice(-2)).toEqual(["commit", "invalidate"]);
	});
});
