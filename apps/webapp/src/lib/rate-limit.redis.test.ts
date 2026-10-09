import { Ratelimit } from "@upstash/ratelimit";
import Redis from "ioredis";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRatelimitRedisAdapter } from "./rate-limit-redis";

const testUrl = process.env.RATE_LIMIT_REDIS_TEST_URL;
if (
	testUrl &&
	(process.env.RATE_LIMIT_REDIS_TEST_SENTINEL !== "rate-limit-test" ||
		new URL(testUrl).hostname !== "127.0.0.1")
)
	throw new Error(
		"Rate-limit Redis tests require the disposable loopback fixture",
	);
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: async () => null } },
}));
vi.mock("@/lib/auth/app-auth-code", () => ({ createAppAuthCode: vi.fn() }));
vi.mock("@/env", () => ({
	env: {
		NODE_ENV: "production",
		RATE_LIMIT_DISABLED: "false",
		RATE_LIMIT_AUTH: "2/60",
	},
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/redis", async () => {
	const client = new (await import("ioredis")).default(
		process.env.RATE_LIMIT_REDIS_TEST_URL ?? "",
		{ lazyConnect: true, maxRetriesPerRequest: 0 },
	);
	return {
		redis: client,
		ensureRedisReady: async () => {
			if (client.status === "wait") await client.connect();
			return client.status === "ready";
		},
	};
});

describe.skipIf(!testUrl)(
	"rate limiting on a disposable real Redis/Valkey server",
	() => {
		let client: Redis;
		beforeAll(async () => {
			client = new Redis(testUrl ?? "", {
				lazyConnect: true,
				maxRetriesPerRequest: 0,
			});
			await client.connect();
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-10-09T12:00:30Z"));
		});
		afterAll(async () => {
			vi.useRealTimers();
			const { redis } = await import("@/lib/redis");
			redis.disconnect();
			client.disconnect();
		});
		it("enforces the auth request limit through the public service and returns 429", async () => {
			const { checkRateLimit, createRateLimitResponse } = await import(
				"./rate-limit"
			);
			expect(
				await checkRateLimit("fixture-auth-employee", "auth"),
			).toMatchObject({ allowed: true, remaining: 1 });
			expect(
				await checkRateLimit("fixture-auth-employee", "auth"),
			).toMatchObject({ allowed: true, remaining: 0 });
			const denied = await checkRateLimit("fixture-auth-employee", "auth");
			expect(denied).toMatchObject({
				allowed: false,
				remaining: 0,
				retryAfter: 30,
			});
			expect(createRateLimitResponse(denied).status).toBe(429);
		});
		it("desktop login navigation redirects and then returns 429 when limited", async () => {
			const { GET } = await import("@/app/api/auth/app-login/route");
			const request = () =>
				new NextRequest(
					"https://app.example.test/api/auth/app-login?app=desktop&redirect=z8://auth/callback&challenge=fixture-challenge",
					{
						headers: { "x-forwarded-for": "192.0.2.178", accept: "text/html" },
					},
				);
			const first = await GET(request());
			expect(first.status).toBe(307);
			expect(new URL(first.headers.get("location") ?? "").pathname).toBe(
				"/sign-in",
			);
			expect((await GET(request())).status).toBe(307);
			const denied = await GET(request());
			expect(denied.status).toBe(429);
			expect(denied.headers.get("content-type")).toContain("text/html");
			expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
		});
		it("handles cold scripts, warm EVALSHA, SCRIPT FLUSH, TTL and weighted windows", async () => {
			const calls = vi.spyOn(client, "eval");
			const limiter = new Ratelimit({
				redis: createRatelimitRedisAdapter(client),
				limiter: Ratelimit.slidingWindow(2, "60 s"),
				prefix: "fixture:compat",
				analytics: false,
				ephemeralCache: false,
			});
			expect(await limiter.limit("employee")).toMatchObject({
				success: true,
				remaining: 1,
			});
			expect(await limiter.limit("employee")).toMatchObject({
				success: true,
				remaining: 0,
			});
			expect(calls).toHaveBeenCalledTimes(1);
			const bucket = Math.floor(Date.now() / 60000);
			expect(await client.get(`fixture:compat:employee:${bucket}`)).toBe("2");
			expect(
				await client.pttl(`fixture:compat:employee:${bucket}`),
			).toBeGreaterThan(0);
			await client.script("FLUSH");
			expect(await limiter.limit("employee")).toMatchObject({
				success: false,
				remaining: 0,
			});
			expect(calls).toHaveBeenCalledTimes(2);
			expect(await limiter.limit("different-employee")).toMatchObject({
				success: true,
				remaining: 1,
			});
			vi.setSystemTime(new Date("2026-10-09T12:01:00Z"));
			expect(await limiter.limit("employee")).toMatchObject({
				success: false,
				remaining: 0,
			});
			vi.setSystemTime(new Date("2026-10-09T12:01:30Z"));
			expect(await limiter.limit("employee")).toMatchObject({
				success: true,
				remaining: 0,
			});
			expect(await limiter.limit("employee")).toMatchObject({
				success: false,
				remaining: 0,
			});
			calls.mockRestore();
		});
	},
);
