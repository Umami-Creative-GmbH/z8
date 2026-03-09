import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const cookieStore = {
		get: vi.fn(),
		set: vi.fn(),
		delete: vi.fn(),
	};

	return {
		cookieStore,
		cookies: vi.fn(async () => cookieStore),
		verifyOAuthState: vi.fn(),
		resolveCredentials: vi.fn(),
		exchangeCode: vi.fn(),
		getUserInfo: vi.fn(),
		parseAppleFormPost: vi.fn(),
	};
});

vi.mock("next/headers", () => ({
	cookies: mockState.cookies,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	}),
}));

vi.mock("@/lib/app-url", () => ({
	getBaseUrlFromHost: vi.fn(() => "https://app.example.com"),
}));

vi.mock("@/lib/social-oauth", () => ({
	STATE_COOKIE_NAME: "z8_social_oauth_state",
	verifyOAuthState: mockState.verifyOAuthState,
	resolveCredentials: mockState.resolveCredentials,
	exchangeCode: mockState.exchangeCode,
	getUserInfo: mockState.getUserInfo,
	parseAppleFormPost: mockState.parseAppleFormPost,
}));

vi.mock("@/db", () => ({
	db: {
		insert: vi.fn(),
		update: vi.fn(),
		query: {
			account: { findFirst: vi.fn() },
			user: { findFirst: vi.fn() },
		},
	},
}));

vi.mock("@/db/auth-schema", () => ({
	session: {},
	account: {
		providerId: "providerId",
		accountId: "accountId",
		id: "id",
		userId: "userId",
	},
	user: {
		email: "email",
		id: "id",
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

describe("social oauth callback state validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.cookieStore.get.mockReturnValue({ value: JSON.stringify({ some: "state" }) });
	});

	it("rejects callback when state param cannot be decoded", async () => {
		const request = createRequest(
			"https://app.example.com/api/auth/callback/social-org/google?code=test-code&state=%25",
		);

		const response = await GET(request, { params: Promise.resolve({ provider: "google" }) });

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toContain("/sign-in?error=invalid_state");
		expect(mockState.verifyOAuthState).not.toHaveBeenCalled();
	});

	it("rejects callback when query state does not match cookie state", async () => {
		mockState.cookieStore.get.mockReturnValue({ value: JSON.stringify({ expected: "state" }) });

		const mismatchedState = Buffer.from(JSON.stringify({ other: "state" })).toString("base64url");
		const request = createRequest(
			`https://app.example.com/api/auth/callback/social-org/google?code=test-code&state=${mismatchedState}`,
		);

		const response = await GET(request, { params: Promise.resolve({ provider: "google" }) });

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toContain("/sign-in?error=invalid_state");
		expect(mockState.verifyOAuthState).not.toHaveBeenCalled();
	});
});
