import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getSession: vi.fn(),
	headers: vi.fn(),
	createAppAuthCode: vi.fn(),
}));

vi.mock("next/headers", () => ({
	headers: mockState.headers,
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

const { GET } = await import("./route");

function createRequest(url: string): NextRequest {
	return {
		url,
		nextUrl: new URL(url),
	} as unknown as NextRequest;
}

describe("GET /api/auth/desktop-login", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.headers.mockResolvedValue(new Headers());
	});

	it("redirects authenticated desktop clients with a one-time code instead of a session token", async () => {
		mockState.getSession.mockResolvedValue({
			user: {
				id: "user-1",
				canUseDesktop: true,
			},
			session: {
				token: "session-token",
			},
		});
		mockState.createAppAuthCode.mockResolvedValue({ code: "DESKTOP-CODE" });

		const response = await GET(
			createRequest("https://app.example.com/api/auth/desktop-login?redirect=z8://auth/callback"),
		);

		expect(response.status).toBe(307);
		expect(mockState.createAppAuthCode).toHaveBeenCalledWith({
			app: "desktop",
			sessionToken: "session-token",
			userId: "user-1",
		});
		expect(response.headers.get("location")).toBe("z8://auth/callback?code=DESKTOP-CODE");
	});

	it("preserves access-denied redirects for authenticated users without desktop access", async () => {
		mockState.getSession.mockResolvedValue({
			user: {
				id: "user-2",
				canUseDesktop: false,
			},
			session: {
				token: "session-token",
			},
		});

		const response = await GET(
			createRequest("https://app.example.com/api/auth/desktop-login?redirect=z8://auth/callback"),
		);

		expect(response.status).toBe(307);
		expect(mockState.createAppAuthCode).not.toHaveBeenCalled();
		expect(response.headers.get("location")).toBe(
			"z8://auth/callback?error=access_denied&error_description=Your+account+does+not+have+access+to+the+desktop+application.+Please+contact+your+administrator.",
		);
	});

	it("rejects non-z8 redirect schemes", async () => {
		const response = await GET(
			createRequest("https://app.example.com/api/auth/desktop-login?redirect=https://example.com/callback"),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Invalid redirect URL. Must be z8:// protocol",
		});
	});

	it("redirects unauthenticated desktop requests through sign-in with a callbackUrl", async () => {
		mockState.getSession.mockResolvedValue(null);

		const requestUrl =
			"https://app.example.com/api/auth/desktop-login?redirect=z8://auth/callback%3Fsource%3Ddesktop";

		const response = await GET(createRequest(requestUrl));

		expect(response.status).toBe(307);

		const location = new URL(response.headers.get("location")!);
		expect(location.pathname).toBe("/sign-in");
		expect(location.searchParams.get("callbackUrl")).toBe(requestUrl);
		expect(location.searchParams.get("desktop_redirect")).toBeNull();
	});
});
