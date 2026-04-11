import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

const { GET } = await import("./route");

function createRequest(url: string): NextRequest {
	return {
		url,
		nextUrl: new URL(url),
		headers: new Headers(),
	} as unknown as NextRequest;
}

describe("GET /api/auth/app-login", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("accepts z8mobile redirects for authenticated mobile clients", async () => {
		mockState.getSession.mockResolvedValue({
			user: {
				id: "user-1",
				canUseMobile: true,
			},
			session: {
				token: "session-token",
			},
		});

		const response = await GET(
			createRequest("https://app.example.com/api/auth/app-login?redirect=z8mobile://auth/callback"),
		);

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("z8mobile://auth/callback?token=session-token");
	});

	it("redirects unauthenticated mobile requests through sign-in with a callbackUrl", async () => {
		mockState.getSession.mockResolvedValue(null);

		const requestUrl =
			"https://app.example.com/api/auth/app-login?redirect=z8mobile://auth/callback%3Fsource%3Dmobile";

		const response = await GET(createRequest(requestUrl));

		expect(response.status).toBe(307);

		const location = new URL(response.headers.get("location")!);
		expect(location.pathname).toBe("/sign-in");
		expect(location.searchParams.get("callbackUrl")).toBe(requestUrl);
	});
});
