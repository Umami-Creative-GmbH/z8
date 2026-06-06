import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	createRateLimitResponse: vi.fn(),
	getClientIp: vi.fn(),
	getSession: vi.fn(),
	headers: vi.fn(),
	logger: {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
}));

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("next/server", async () => {
	const actual = await vi.importActual<typeof import("next/server")>("next/server");
	return {
		...actual,
		connection: vi.fn().mockResolvedValue(undefined),
	};
});

vi.mock("@/db", () => ({
	db: {},
}));

vi.mock("@/db/auth-schema", () => ({
	member: { organizationId: "member.organizationId", userId: "member.userId" },
}));

vi.mock("@/db/schema", () => ({
	discordBotConfig: {
		id: "discordBotConfig.id",
		organizationId: "discordBotConfig.organizationId",
	},
}));

vi.mock("@/env", () => ({
	env: { APP_URL: "https://app.example.com" },
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

vi.mock("@/lib/rate-limit", () => ({
	checkRateLimit: mockState.checkRateLimit,
	createRateLimitResponse: mockState.createRateLimitResponse,
	getClientIp: mockState.getClientIp,
}));

vi.mock("@/lib/vault", () => ({
	deleteOrgSecret: vi.fn(),
	storeOrgSecret: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	and: (...args: unknown[]) => args,
	eq: (...args: unknown[]) => args,
}));

const { DELETE, POST } = await import("./route");

function createRequest(method: "DELETE" | "POST", body?: string): NextRequest {
	return new Request("https://app.example.com/api/discord/setup?organizationId=org_123", {
		body,
		headers: { "Content-Type": "application/json" },
		method,
	}) as NextRequest;
}

describe("/api/discord/setup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.checkRateLimit.mockResolvedValue({
			allowed: true,
			remaining: 99,
			resetAt: 1_700_000_000_000,
			retryAfter: 0,
		});
		mockState.createRateLimitResponse.mockReturnValue(
			new Response("rate limited", { status: 429 }),
		);
		mockState.getClientIp.mockReturnValue("127.0.0.1");
	});

	it("POST returns the rate-limit response before parsing integration credentials", async () => {
		const rateLimitResult = {
			allowed: false,
			remaining: 0,
			resetAt: 1_700_000_000_000,
			retryAfter: 30,
		};
		mockState.checkRateLimit.mockResolvedValue(rateLimitResult);

		const request = createRequest("POST", "{");
		const response = await POST(request);

		expect(response.status).toBe(429);
		expect(mockState.getClientIp).toHaveBeenCalledWith(request);
		expect(mockState.checkRateLimit).toHaveBeenCalledWith("127.0.0.1", "api");
		expect(mockState.createRateLimitResponse).toHaveBeenCalledWith(rateLimitResult, request);
		expect(mockState.headers).not.toHaveBeenCalled();
		expect(mockState.getSession).not.toHaveBeenCalled();
	});

	it("DELETE returns the rate-limit response before checking the session", async () => {
		const rateLimitResult = {
			allowed: false,
			remaining: 0,
			resetAt: 1_700_000_000_000,
			retryAfter: 30,
		};
		mockState.checkRateLimit.mockResolvedValue(rateLimitResult);

		const request = createRequest("DELETE");
		const response = await DELETE(request);

		expect(response.status).toBe(429);
		expect(mockState.getClientIp).toHaveBeenCalledWith(request);
		expect(mockState.checkRateLimit).toHaveBeenCalledWith("127.0.0.1", "api");
		expect(mockState.createRateLimitResponse).toHaveBeenCalledWith(rateLimitResult, request);
		expect(mockState.headers).not.toHaveBeenCalled();
		expect(mockState.getSession).not.toHaveBeenCalled();
	});
});
