import { type NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	logError: vi.fn(),
	getSession: vi.fn(),
	createAppAuthCode: vi.fn(),
	checkRateLimit: vi.fn(),
	createRateLimitResponse: vi.fn(),
	getClientIp: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/lib/auth/app-auth-code", () => ({
	createAppAuthCode: mockState.createAppAuthCode,
}));

vi.mock("@/lib/rate-limit", () => ({
	checkRateLimit: mockState.checkRateLimit,
	createRateLimitResponse: mockState.createRateLimitResponse,
	getClientIp: mockState.getClientIp,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: mockState.logError }),
}));

vi.mock("@/env", () => ({ env: { APP_URL: "https://app.example.com" } }));
const { GET } = await import("./route");

function createRequest(url: string): NextRequest {
	return {
		url,
		nextUrl: new URL(url),
		headers: new Headers(),
	} as unknown as NextRequest;
}

describe("GET /api/auth/app-login", () => {
	afterEach(() => vi.restoreAllMocks());

	it("identifies a session lookup failure without logging its request or cause", async () => {
		const error = Object.assign(new Error("fixture-cookie-secret"), {
			cause: {
				params: ["fixture-session-secret"],
				detail: "fixture-row-secret",
			},
		});
		mockState.getSession.mockRejectedValue(error);
		const request = createRequest(
			"https://app.example.com/api/auth/app-login?app=desktop&redirect=z8://auth/callback&challenge=fixture-challenge-secret",
		);
		request.headers.set("cookie", "fixture-cookie-secret");

		await expect(GET(request)).rejects.toBe(error);
		expect(mockState.createAppAuthCode).not.toHaveBeenCalled();
		expect(mockState.logError).toHaveBeenCalledExactlyOnceWith(
			{
				app: "desktop",
				stage: "session_lookup",
				failure: "unknown",
				sqlState: undefined,
			},
			"App sign-in failed",
		);
	});

	it.each([
		[
			"App sign-in code storage failed (SQLSTATE 23503)",
			"auth_code_storage",
			"23503",
		],
		[
			"App sign-in code storage failed (SQLSTATE 23503) fixture-secret",
			"unknown",
			undefined,
		],
	])(
		"only logs allowlisted storage diagnostics for %s",
		async (message, failure, sqlState) => {
			mockState.getSession.mockResolvedValue({
				user: { id: "user-1" },
				session: { token: "fixture-session-secret" },
			});
			const error = new Error(message);
			mockState.createAppAuthCode.mockRejectedValue(error);

			await expect(
				GET(
					createRequest(
						"https://app.example.com/api/auth/app-login?app=desktop&redirect=z8://auth/callback&challenge=fixture-challenge-secret",
					),
				),
			).rejects.toBe(error);
			expect(mockState.logError).toHaveBeenCalledExactlyOnceWith(
				{ app: "desktop", stage: "auth_code_creation", failure, sqlState },
				"App sign-in failed",
			);
		},
	);

	it("identifies organization session invalidation without bypassing it", async () => {
		const error = new Error("Organization session invalidation failed");
		mockState.getSession.mockRejectedValue(error);

		await expect(
			GET(
				createRequest(
					"https://app.example.com/api/auth/app-login?app=desktop&redirect=z8://auth/callback&challenge=fixture-challenge",
				),
			),
		).rejects.toBe(error);
		expect(mockState.createAppAuthCode).not.toHaveBeenCalled();
		expect(mockState.logError).toHaveBeenCalledExactlyOnceWith(
			{
				app: "desktop",
				stage: "session_lookup",
				failure: "organization_session_invalidation",
				sqlState: undefined,
			},
			"App sign-in failed",
		);
	});

	it.each([true, false])(
		"identifies redirect failure with authenticated=%s without logging the URL",
		async (authenticated) => {
			mockState.getSession.mockResolvedValue(
				authenticated
					? {
							user: { id: "user-1" },
							session: { token: "fixture-session-secret" },
						}
					: null,
			);
			mockState.createAppAuthCode.mockResolvedValue({
				code: "fixture-auth-code-secret",
			});
			const error = new TypeError("fixture-redirect-url-secret");
			vi.spyOn(NextResponse, "redirect").mockImplementation(() => {
				throw error;
			});

			await expect(
				GET(
					createRequest(
						"https://app.example.com/api/auth/app-login?app=desktop&redirect=z8://auth/callback&challenge=fixture-challenge-secret",
					),
				),
			).rejects.toBe(error);
			expect(mockState.logError).toHaveBeenCalledExactlyOnceWith(
				{
					app: "desktop",
					stage: authenticated ? "callback_redirect" : "sign_in_redirect",
					failure: "unknown",
					sqlState: undefined,
				},
				"App sign-in failed",
			);
		},
	);
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

	it("returns the rate-limit response before creating an app auth code", async () => {
		const rateLimitResult = {
			allowed: false,
			remaining: 0,
			resetAt: 1_700_000_000_000,
			retryAfter: 30,
		};
		mockState.checkRateLimit.mockResolvedValue(rateLimitResult);

		const request = createRequest(
			"https://app.example.com/api/auth/app-login?redirect=z8mobile://auth/callback&challenge=CODE-CHALLENGE",
		);

		const response = await GET(request);

		expect(response.status).toBe(429);
		expect(mockState.getClientIp).toHaveBeenCalledWith(request);
		expect(mockState.checkRateLimit).toHaveBeenCalledWith("127.0.0.1", "auth");
		expect(mockState.createRateLimitResponse).toHaveBeenCalledWith(
			rateLimitResult,
			request,
		);
		expect(mockState.getSession).not.toHaveBeenCalled();
		expect(mockState.createAppAuthCode).not.toHaveBeenCalled();
	});

	it.each([undefined, false])(
		"redirects authenticated mobile clients with a one-time code when the legacy flag is %s",
		async (canUseMobile) => {
			mockState.getSession.mockResolvedValue({
				user: {
					id: "user-1",
					canUseMobile,
				},
				session: {
					token: "session-token",
				},
			});
			mockState.createAppAuthCode.mockResolvedValue({ code: "ONE-TIME-CODE" });

			const response = await GET(
				createRequest(
					"https://app.example.com/api/auth/app-login?redirect=z8mobile://auth/callback&challenge=CODE-CHALLENGE",
				),
			);

			expect(response.status).toBe(307);
			expect(mockState.createAppAuthCode).toHaveBeenCalledWith({
				app: "mobile",
				sessionToken: "session-token",
				userId: "user-1",
				codeChallenge: "CODE-CHALLENGE",
			});
			expect(response.headers.get("location")).toBe(
				"z8mobile://auth/callback?code=ONE-TIME-CODE",
			);
		},
	);

	it("requires a code challenge before minting a mobile auth code", async () => {
		const response = await GET(
			createRequest(
				"https://app.example.com/api/auth/app-login?redirect=z8mobile://auth/callback",
			),
		);

		expect(response.status).toBe(400);
		expect(mockState.createAppAuthCode).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({
			error: "Missing challenge parameter",
		});
	});

	it("rejects mobile deep links outside the expected auth callback", async () => {
		const response = await GET(
			createRequest(
				"https://app.example.com/api/auth/app-login?redirect=z8mobile://evil/callback",
			),
		);

		expect(response.status).toBe(400);
		expect(mockState.createAppAuthCode).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({
			error: "Invalid redirect URL. Must be z8mobile://auth/callback",
		});
	});

	it("rejects desktop deep links outside the expected auth callback", async () => {
		const response = await GET(
			createRequest(
				"https://app.example.com/api/auth/app-login?app=desktop&redirect=z8://evil/callback",
			),
		);

		expect(response.status).toBe(400);
		expect(mockState.createAppAuthCode).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({
			error: "Invalid redirect URL. Must be z8://auth/callback",
		});
	});

	it("redirects unauthenticated mobile requests through sign-in with a callbackUrl", async () => {
		mockState.getSession.mockResolvedValue(null);

		const requestUrl =
			"https://app.example.com/api/auth/app-login?redirect=z8mobile://auth/callback%3Fsource%3Dmobile&challenge=CODE-CHALLENGE";

		const response = await GET(createRequest(requestUrl));

		expect(response.status).toBe(307);

		const location = new URL(response.headers.get("location")!);
		expect(location.pathname).toBe("/sign-in");
		expect(location.searchParams.get("callbackUrl")).toBe(requestUrl);
	});

	it("opens the store app from a page so a blocked automatic launch keeps a button", async () => {
		mockState.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { token: "session-token" },
		});
		mockState.createAppAuthCode.mockResolvedValue({ code: "ONE-TIME-CODE" });
		const request = createRequest(
			"https://app.example.com/api/auth/app-login?app=mobile&redirect=z8mobile://auth/callback&challenge=CODE-CHALLENGE",
		);
		request.headers.set("accept", "text/html");

		const response = await GET(request);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		const html = await response.text();
		expect(html).toContain('href="z8mobile://auth/callback?code=ONE-TIME-CODE"');
		expect(html).toContain("We are opening the Z8 app");
		expect(html).not.toContain("session-token");
	});

	// The system browser can keep the cookie of a session the app has since signed
	// out. With it, the proxy would send sign-in to the dashboard and lose the way back.
	it("clears a stale session cookie when a store app sign-in has to sign in again", async () => {
		mockState.getSession.mockResolvedValue(null);
		const request = createRequest(
			"https://app.example.com/api/auth/app-login?app=mobile&redirect=z8mobile://auth/callback&challenge=CODE-CHALLENGE",
		);
		request.headers.set("cookie", "__Secure-better-auth.session_token=revoked.signature");

		const response = await GET(request);

		expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/sign-in");
		const cleared = response.headers
			.getSetCookie()
			.find((entry) => entry.startsWith("__Secure-better-auth.session_token="));
		expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
		expect(cleared).toMatch(/;\s*Secure/i);
	});

	it("keeps the desktop sign-in redirect unchanged when a stale cookie is present", async () => {
		mockState.getSession.mockResolvedValue(null);
		const request = createRequest(
			"https://app.example.com/api/auth/app-login?app=desktop&redirect=z8://auth/callback&challenge=CODE-CHALLENGE",
		);
		request.headers.set("cookie", "__Secure-better-auth.session_token=revoked.signature");

		const response = await GET(request);

		expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/sign-in");
		expect(response.headers.getSetCookie()).toEqual([]);
	});
});
