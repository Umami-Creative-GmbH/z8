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
		accountFindFirst: vi.fn(),
		userFindFirst: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(),
		insertedAccounts: [] as Record<string, unknown>[],
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
		insert: mockState.insert,
		update: mockState.update,
		query: {
			account: { findFirst: mockState.accountFindFirst },
			user: { findFirst: mockState.userFindFirst },
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

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => conditions,
	eq: (column: string, value: string) => ({ column, value }),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

const { GET, findOrCreateUserWithAccount } = await import("./route");

function createRequest(url: string): NextRequest {
	return {
		url,
		nextUrl: new URL(url),
		headers: new Headers(),
	} as unknown as NextRequest;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockState.insertedAccounts.length = 0;
	mockState.insert.mockImplementation(() => ({
		values: vi.fn(async (values) => {
			if ("accountId" in values) mockState.insertedAccounts.push(values);
		}),
	}));
	mockState.update.mockImplementation(() => ({
		set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
	}));
	mockState.cookieStore.get.mockReturnValue({ value: JSON.stringify({ some: "state" }) });
});

describe("social oauth callback state validation", () => {
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

describe("findOrCreateUserWithAccount", () => {
	const params = {
		provider: "github" as const,
		providerUserId: "github-subject-7",
		email: " Person@Example.com ",
		emailVerified: true,
		name: "Person",
		image: null,
		accessToken: "access-token",
	};

	it("uses the provider and subject to find an existing account", async () => {
		mockState.accountFindFirst.mockResolvedValue({ id: "account-row", userId: "user-1" });

		await expect(findOrCreateUserWithAccount(params)).resolves.toEqual({
			userId: "user-1",
			isNewUser: false,
		});

		expect(mockState.accountFindFirst).toHaveBeenCalledWith({
			where: [
				{ column: "providerId", value: "github" },
				{ column: "accountId", value: "github-subject-7" },
			],
		});
	});

	it("writes the provider key when linking an account to an existing user", async () => {
		mockState.accountFindFirst.mockResolvedValue(undefined);
		mockState.userFindFirst.mockResolvedValue({ id: "user-1" });

		await findOrCreateUserWithAccount(params);

		expect(mockState.insertedAccounts).toContainEqual(
			expect.objectContaining({
				providerId: "github",
				accountId: "github-subject-7",
			}),
		);
	});

	it("rejects linking an unverified provider email without mutating accounts", async () => {
		mockState.accountFindFirst.mockResolvedValue(undefined);
		mockState.userFindFirst.mockResolvedValue({ id: "victim-user" });

		await expect(findOrCreateUserWithAccount({ ...params, emailVerified: false })).rejects.toThrow(
			"Verified email required to link an account",
		);
		expect(mockState.insert).not.toHaveBeenCalled();
		expect(mockState.update).not.toHaveBeenCalled();
	});

	it("allows an already linked provider subject even if its email is now unverified", async () => {
		mockState.accountFindFirst.mockResolvedValue({ id: "account-row", userId: "user-1" });
		await expect(findOrCreateUserWithAccount({ ...params, emailVerified: false })).resolves.toEqual(
			{ userId: "user-1", isNewUser: false },
		);
		expect(mockState.userFindFirst).not.toHaveBeenCalled();
		expect(mockState.insert).not.toHaveBeenCalled();
	});

	it("writes the provider key when creating a user and account", async () => {
		mockState.accountFindFirst.mockResolvedValue(undefined);
		mockState.userFindFirst.mockResolvedValue(undefined);

		await findOrCreateUserWithAccount(params);

		expect(mockState.insertedAccounts).toContainEqual(
			expect.objectContaining({
				providerId: "github",
				accountId: "github-subject-7",
			}),
		);
	});

	it("rejects an unknown provider before database mutations", async () => {
		await expect(
			findOrCreateUserWithAccount({ ...params, provider: "tenant-oidc" as never }),
		).rejects.toThrow("Unknown account provider: tenant-oidc");

		expect(mockState.accountFindFirst).not.toHaveBeenCalled();
		expect(mockState.userFindFirst).not.toHaveBeenCalled();
		expect(mockState.insert).not.toHaveBeenCalled();
	});
});

describe("social oauth callback redirects", () => {
	function prepareCallback(callbackURL: string) {
		const state = { callbackURL, organizationId: null, codeVerifier: "verifier" };
		const stateJson = JSON.stringify(state);
		mockState.cookieStore.get.mockReturnValue({ value: stateJson });
		mockState.verifyOAuthState.mockReturnValue(state);
		mockState.resolveCredentials.mockResolvedValue({ credentials: {}, isOrgSpecific: false });
		mockState.exchangeCode.mockResolvedValue({ accessToken: "token" });
		mockState.getUserInfo.mockResolvedValue({
			providerUserId: "subject",
			email: "person@example.com",
			emailVerified: true,
		});
		mockState.accountFindFirst.mockResolvedValue({ id: "account-row", userId: "user-1" });
		return createRequest(
			`https://app.example.com/api/auth/callback/social-org/google?code=code&state=${Buffer.from(stateJson).toString("base64url")}`,
		);
	}

	it.each([
		"/\\evil.example/",
		"/\n/evil.example/",
		"//evil.example/",
		"/safe/..//evil.example/",
		"https://evil.example/",
	])("falls back to the app root for unsafe signed callback %j", async (callbackURL) => {
		const response = await GET(prepareCallback(callbackURL), {
			params: Promise.resolve({ provider: "google" }),
		});
		expect(response.headers.get("location")).toBe("https://app.example.com/");
	});

	it("preserves a local callback including query and fragment", async () => {
		const response = await GET(prepareCallback("/settings?tab=security#sessions"), {
			params: Promise.resolve({ provider: "google" }),
		});
		expect(response.headers.get("location")).toBe(
			"https://app.example.com/settings?tab=security#sessions",
		);
	});

	it("does not create a session when linking an unverified email fails", async () => {
		const request = prepareCallback("/");
		mockState.accountFindFirst.mockResolvedValue(undefined);
		mockState.userFindFirst.mockResolvedValue({ id: "victim-user" });
		mockState.getUserInfo.mockResolvedValue({
			providerUserId: "attacker-subject",
			email: "victim@example.com",
			emailVerified: false,
		});
		const response = await GET(request, { params: Promise.resolve({ provider: "google" }) });
		expect(response.headers.get("location")).toBe(
			"https://app.example.com/sign-in?error=oauth_error",
		);
		expect(mockState.insert).not.toHaveBeenCalled();
		expect(mockState.cookieStore.set).not.toHaveBeenCalled();
	});
});
