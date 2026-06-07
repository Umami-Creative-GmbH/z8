import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	consumeAppAuthCode: vi.fn(),
	checkRateLimit: vi.fn(),
	createRateLimitResponse: vi.fn(),
	getClientIp: vi.fn(),
}));

vi.mock("@/lib/auth/app-auth-code", () => ({
	consumeAppAuthCode: mockState.consumeAppAuthCode,
}));

vi.mock("@/lib/rate-limit", () => ({
	checkRateLimit: mockState.checkRateLimit,
	createRateLimitResponse: mockState.createRateLimitResponse,
	getClientIp: mockState.getClientIp,
}));

const { POST } = await import("./route");

describe("POST /api/auth/app-exchange", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.checkRateLimit.mockResolvedValue({
			allowed: true,
			remaining: 9,
			resetAt: 1_700_000_000_000,
			retryAfter: 0,
		});
		mockState.createRateLimitResponse.mockReturnValue(
			new Response("rate limited", { status: 429 }),
		);
		mockState.getClientIp.mockReturnValue("127.0.0.1");
	});

	it("returns the rate-limit response before parsing the exchange body", async () => {
		const rateLimitResult = {
			allowed: false,
			remaining: 0,
			resetAt: 1_700_000_000_000,
			retryAfter: 30,
		};
		mockState.checkRateLimit.mockResolvedValue(rateLimitResult);

		const request = new Request("https://app.example.com/api/auth/app-exchange", {
			body: "{",
			headers: {
				"Content-Type": "application/json",
				"X-Z8-App-Type": "mobile",
			},
			method: "POST",
		});

		const response = await POST(request);

		expect(response.status).toBe(429);
		expect(mockState.getClientIp).toHaveBeenCalledWith(request);
		expect(mockState.checkRateLimit).toHaveBeenCalledWith("127.0.0.1", "auth");
		expect(mockState.createRateLimitResponse).toHaveBeenCalledWith(rateLimitResult, request);
		expect(mockState.consumeAppAuthCode).not.toHaveBeenCalled();
	});

	it("returns a 400 when the request body is malformed JSON", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/auth/app-exchange", {
				body: "{",
				headers: {
					"Content-Type": "application/json",
					"X-Z8-App-Type": "mobile",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.consumeAppAuthCode).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({ error: "Code and verifier are required" });
	});

	it("returns the session token when a valid mobile code is exchanged", async () => {
		mockState.consumeAppAuthCode.mockResolvedValue({
			status: "success",
			sessionToken: "session-token",
		});

		const response = await POST(
			new Request("https://app.example.com/api/auth/app-exchange", {
				body: JSON.stringify({ code: "ONE-TIME-CODE", verifier: "VERIFIER" }),
				headers: {
					"Content-Type": "application/json",
					"X-Z8-App-Type": "mobile",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(mockState.consumeAppAuthCode).toHaveBeenCalledWith({
			app: "mobile",
			code: "ONE-TIME-CODE",
			verifier: "VERIFIER",
		});
		expect(await response.json()).toEqual({ token: "session-token" });
	});

	it("requires a verifier to exchange app auth codes", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/auth/app-exchange", {
				body: JSON.stringify({ code: "ONE-TIME-CODE" }),
				headers: {
					"Content-Type": "application/json",
					"X-Z8-App-Type": "mobile",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.consumeAppAuthCode).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({ error: "Code and verifier are required" });
	});
});
