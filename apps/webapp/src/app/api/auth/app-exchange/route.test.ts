import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	consumeAppAuthCode: vi.fn(),
	checkRateLimit: vi.fn(),
	createRateLimitResponse: vi.fn(),
	getClientIp: vi.fn(),
	setStoreAppSessionCookie: vi.fn(),
	resolvePublicRequestOrigin: vi.fn(),
}));

vi.mock("@/lib/auth/app-auth-code", () => ({
	consumeAppAuthCode: mockState.consumeAppAuthCode,
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { setStoreAppSessionCookie: mockState.setStoreAppSessionCookie } },
}));

vi.mock("@/lib/domain/request-origin", () => ({
	resolvePublicRequestOrigin: mockState.resolvePublicRequestOrigin,
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
		mockState.resolvePublicRequestOrigin.mockResolvedValue("https://app.example.com");
		mockState.setStoreAppSessionCookie.mockResolvedValue({
			headers: new Headers([
				[
					"set-cookie",
					"__Secure-better-auth.session_token=signed; Path=/; HttpOnly; Secure; SameSite=Lax",
				],
			]),
			response: { ok: true },
		});
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
					Origin: "https://app.example.com",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.consumeAppAuthCode).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({ error: "Code and verifier are required" });
	});

	it("returns the session token when a valid desktop code is exchanged", async () => {
		mockState.consumeAppAuthCode.mockResolvedValue({
			status: "success",
			sessionToken: "session-token",
		});

		const response = await POST(
			new Request("https://app.example.com/api/auth/app-exchange", {
				body: JSON.stringify({ code: "ONE-TIME-CODE", verifier: "VERIFIER" }),
				headers: {
					"Content-Type": "application/json",
					"X-Z8-App-Type": "desktop",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(mockState.consumeAppAuthCode).toHaveBeenCalledWith({
			app: "desktop",
			code: "ONE-TIME-CODE",
			verifier: "VERIFIER",
		});
		expect(await response.json()).toEqual({ token: "session-token" });
		expect(mockState.setStoreAppSessionCookie).not.toHaveBeenCalled();
	});

	describe("store app (mobile)", () => {
		function mobileExchange(
			body: unknown = { code: "ONE-TIME-CODE", verifier: "VERIFIER" },
			origin: string | null = "https://app.example.com",
		) {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				"X-Z8-App-Type": "mobile",
			};
			if (origin) headers.Origin = origin;
			return new Request("https://app.example.com/api/auth/app-exchange", {
				body: JSON.stringify(body),
				headers,
				method: "POST",
			});
		}

		it("sets the web view's session cookie and never returns the session token", async () => {
			mockState.consumeAppAuthCode.mockResolvedValue({
				status: "success",
				sessionToken: "session-token",
			});
			const request = mobileExchange();

			const response = await POST(request);

			expect(response.status).toBe(200);
			expect(mockState.consumeAppAuthCode).toHaveBeenCalledWith({
				app: "mobile",
				code: "ONE-TIME-CODE",
				verifier: "VERIFIER",
			});
			expect(mockState.setStoreAppSessionCookie).toHaveBeenCalledWith({
				body: { sessionToken: "session-token" },
				headers: request.headers,
				returnHeaders: true,
			});
			expect(response.headers.getSetCookie()).toEqual([
				"__Secure-better-auth.session_token=signed; Path=/; HttpOnly; Secure; SameSite=Lax",
			]);
			expect(response.headers.get("cache-control")).toBe("no-store");
			const text = await response.text();
			expect(JSON.parse(text)).toEqual({ ok: true });
			expect(text).not.toContain("session-token");
		});

		it.each([
			["a replayed code", "ALREADY-USED-CODE", "VERIFIER"],
			["a wrong verifier", "ONE-TIME-CODE", "WRONG-VERIFIER"],
		])("refuses %s without setting a session", async (_case, code, verifier) => {
			mockState.consumeAppAuthCode.mockResolvedValue({ status: "invalid_code" });

			const response = await POST(mobileExchange({ code, verifier }));

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: "Invalid or expired code" });
			expect(mockState.setStoreAppSessionCookie).not.toHaveBeenCalled();
			expect(response.headers.getSetCookie()).toEqual([]);
		});

		it("refuses a code whose session was revoked before the handoff", async () => {
			mockState.consumeAppAuthCode.mockResolvedValue({
				status: "success",
				sessionToken: "revoked-session-token",
			});
			mockState.setStoreAppSessionCookie.mockRejectedValue(
				Object.assign(new Error("Session unavailable"), { statusCode: 401 }),
			);

			const response = await POST(mobileExchange());

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: "Invalid or expired code" });
			expect(response.headers.getSetCookie()).toEqual([]);
		});

		it.each([
			["no Origin", null],
			["another site's Origin", "https://evil.example"],
			["a custom domain's Origin", "https://login.acme.example"],
		])("refuses a request with %s before consuming the code", async (_case, origin) => {
			const response = await POST(mobileExchange(undefined, origin));

			expect(response.status).toBe(403);
			expect(mockState.consumeAppAuthCode).not.toHaveBeenCalled();
			expect(mockState.setStoreAppSessionCookie).not.toHaveBeenCalled();
		});
	});

	it.each([undefined, "extension"])("rejects an unsupported app type: %s", async (app) => {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (app) headers["X-Z8-App-Type"] = app;

		const response = await POST(
			new Request("https://app.example.com/api/auth/app-exchange", {
				body: JSON.stringify({ code: "ONE-TIME-CODE", verifier: "VERIFIER" }),
				headers,
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.consumeAppAuthCode).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({ error: "Supported app type required" });
	});

	it("requires a verifier to exchange app auth codes", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/auth/app-exchange", {
				body: JSON.stringify({ code: "ONE-TIME-CODE" }),
				headers: {
					"Content-Type": "application/json",
					"X-Z8-App-Type": "mobile",
					Origin: "https://app.example.com",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.consumeAppAuthCode).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({ error: "Code and verifier are required" });
	});
});
