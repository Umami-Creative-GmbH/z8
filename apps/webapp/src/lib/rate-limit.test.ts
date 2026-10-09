import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
	scripts: new Map<string, string>(),
	counts: new Map<string, number>(),
	error: vi.fn(),
	eval: vi.fn(),
	evalsha: vi.fn(),
}));
vi.mock("@/env", () => ({
	env: {
		NODE_ENV: "production",
		RATE_LIMIT_DISABLED: "false",
		RATE_LIMIT_AUTH: "2/60",
	},
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: fixture.error, warn: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/redis", () => ({
	ensureRedisReady: async () => true,
	redis: {
		on: vi.fn(),
		script: async (_operation: string, script: string) => {
			const sha = createHash("sha1").update(script).digest("hex");
			fixture.scripts.set(sha, script);
			return sha;
		},
		eval: (...args: unknown[]) => fixture.eval(...args),
		evalsha: (...args: unknown[]) => fixture.evalsha(...args),
		get: async () => null,
		set: async () => "OK",
	},
}));
afterEach(() => vi.useRealTimers());

describe("rate-limit compatibility with Redis/Valkey", () => {
	it("enforces auth limits with upstream scripts instead of falling back to allow on an unsupported flag", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-09T12:00:30Z"));
		fixture.eval.mockImplementation(
			async (script: string, numKeys: number, ...values: string[]) => {
				if (script.startsWith("#!lua flags=allow-key-locking"))
					throw new Error(
						"ERR Unexpected flag in script shebang: allow-key-locking",
					);
				const sha = createHash("sha1").update(script).digest("hex");
				fixture.scripts.set(sha, script);
				const currentKey = values[0];
				const limit = Number(values[numKeys]);
				const count = fixture.counts.get(currentKey) ?? 0;
				if (count >= limit) return [-1, limit];
				fixture.counts.set(currentKey, count + 1);
				return [limit - count - 1, limit];
			},
		);
		fixture.evalsha.mockImplementation(
			async (sha: string, numKeys: number, ...values: string[]) => {
				const script = fixture.scripts.get(sha);
				if (!script)
					throw new Error("NOSCRIPT No matching script. Please use EVAL.");
				return fixture.eval(script, numKeys, ...values);
			},
		);
		const { checkRateLimit, createRateLimitResponse } = await import(
			"./rate-limit"
		);
		expect(await checkRateLimit("fixture-employee", "auth")).toMatchObject({
			allowed: true,
			remaining: 1,
		});
		expect(await checkRateLimit("fixture-employee", "auth")).toMatchObject({
			allowed: true,
			remaining: 0,
		});
		const denied = await checkRateLimit("fixture-employee", "auth");
		expect(denied).toMatchObject({
			allowed: false,
			remaining: 0,
			retryAfter: 30,
		});
		expect(createRateLimitResponse(denied).status).toBe(429);
		expect(fixture.error).not.toHaveBeenCalled();
	});
});
