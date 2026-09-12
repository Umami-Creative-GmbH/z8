import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const cookieStore = {
		get: vi.fn(),
	};

	return {
		cookieStore,
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
		database: {
			user: [],
			session: [],
			account: [],
			verification: [],
		} as Record<string, Record<string, unknown>[]>,
		cache: new Map<string, string>(),
		sessionBefore: vi.fn(),
	};
});

vi.mock("@/lib/auth", async () => {
	const { betterAuth } = await import("better-auth/minimal");
	const { memoryAdapter } = await import("better-auth/adapters/memory");
	const { admin } = await import("better-auth/plugins/admin");
	const { accountBanPlugin } = await import("@/lib/auth/account-ban");
	const { socialOrgOAuthPlugin } = await import("@/lib/auth/social-org-oauth");
	return {
		auth: betterAuth({
			baseURL: "https://app.example.com",
			secret: "synthetic-oauth-test-secret-at-least-32-characters",
			database: memoryAdapter(mockState.database),
			plugins: [accountBanPlugin(), admin(), socialOrgOAuthPlugin()],
			session: { storeSessionInDatabase: true, expiresIn: 3600 },
			databaseHooks: {
				session: { create: { before: mockState.sessionBefore } },
			},
			secondaryStorage: {
				get: async (key) => mockState.cache.get(key) ?? null,
				set: async (key, value) => {
					mockState.cache.set(key, value);
				},
				delete: async (key) => {
					mockState.cache.delete(key);
				},
				getAndDelete: async (key) => {
					const value = mockState.cache.get(key) ?? null;
					mockState.cache.delete(key);
					return value;
				},
			},
		}),
	};
});

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
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
		strings,
		values,
	}),
}));

const { GET, POST } = await import("./route");
const { findOrCreateUserWithAccount } = await import(
	"@/lib/auth/social-org-oauth"
);
const { auth } = await import("@/lib/auth");

function createRequest(url: string): Request {
	return new Request(url, {
		headers: {
			host: "app.example.com",
			cookie: `z8_social_oauth_state=${encodeURIComponent(mockState.cookieStore.get()?.value ?? "")}`,
		},
	});
}

beforeEach(async () => {
	vi.clearAllMocks();
	for (const key of Object.keys(mockState.database))
		mockState.database[key] = [];
	mockState.cache.clear();
	const context = await auth.$context;
	await context.adapter.create({
		model: "user",
		forceAllowId: true,
		data: {
			id: "user-1",
			email: "person@example.com",
			name: "Person",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
			banned: false,
		},
	});
	mockState.userFindFirst.mockResolvedValue({ id: "user-1", banned: false });
	mockState.insertedAccounts.length = 0;
	mockState.insert.mockImplementation(() => ({
		values: vi.fn(async (values) => {
			if ("accountId" in values) mockState.insertedAccounts.push(values);
			else if ("email" in values)
				mockState.database.user.push({ ...values, banned: false });
		}),
	}));
	mockState.update.mockImplementation(() => ({
		set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
	}));
	mockState.cookieStore.get.mockReturnValue({
		value: JSON.stringify({ some: "state" }),
	});
});

describe("social oauth callback state validation", () => {
	it("rejects callback when state param cannot be decoded", async () => {
		const request = createRequest(
			"https://app.example.com/api/auth/callback/social-org/google?code=test-code&state=%25",
		);

		const response = await GET(request);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toContain(
			"/sign-in?error=invalid_state",
		);
		expect(mockState.verifyOAuthState).not.toHaveBeenCalled();
	});

	it("rejects callback when query state does not match cookie state", async () => {
		mockState.cookieStore.get.mockReturnValue({
			value: JSON.stringify({ expected: "state" }),
		});

		const mismatchedState = Buffer.from(
			JSON.stringify({ other: "state" }),
		).toString("base64url");
		const request = createRequest(
			`https://app.example.com/api/auth/callback/social-org/google?code=test-code&state=${mismatchedState}`,
		);

		const response = await GET(request);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toContain(
			"/sign-in?error=invalid_state",
		);
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
		mockState.accountFindFirst.mockResolvedValue({
			id: "account-row",
			userId: "user-1",
		});

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

		await expect(
			findOrCreateUserWithAccount({ ...params, emailVerified: false }),
		).rejects.toThrow("Verified email required to link an account");
		expect(mockState.insert).not.toHaveBeenCalled();
		expect(mockState.update).not.toHaveBeenCalled();
	});

	it("allows an already linked provider subject even if its email is now unverified", async () => {
		mockState.accountFindFirst.mockResolvedValue({
			id: "account-row",
			userId: "user-1",
		});
		await expect(
			findOrCreateUserWithAccount({ ...params, emailVerified: false }),
		).resolves.toEqual({ userId: "user-1", isNewUser: false });
		expect(mockState.userFindFirst).toHaveBeenCalledWith({
			where: { column: "id", value: "user-1" },
		});
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
			findOrCreateUserWithAccount({
				...params,
				provider: "tenant-oidc" as never,
			}),
		).rejects.toThrow("Unknown account provider: tenant-oidc");

		expect(mockState.accountFindFirst).not.toHaveBeenCalled();
		expect(mockState.userFindFirst).not.toHaveBeenCalled();
		expect(mockState.insert).not.toHaveBeenCalled();
	});
});

describe("social oauth callback redirects", () => {
	function prepareCallback(callbackURL: string) {
		const state = {
			callbackURL,
			organizationId: null,
			codeVerifier: "verifier",
		};
		const stateJson = JSON.stringify(state);
		mockState.cookieStore.get.mockReturnValue({ value: stateJson });
		mockState.verifyOAuthState.mockReturnValue(state);
		mockState.resolveCredentials.mockResolvedValue({
			credentials: {},
			isOrgSpecific: false,
		});
		mockState.exchangeCode.mockResolvedValue({ accessToken: "token" });
		mockState.getUserInfo.mockResolvedValue({
			providerUserId: "subject",
			email: "person@example.com",
			emailVerified: true,
		});
		mockState.accountFindFirst.mockResolvedValue({
			id: "account-row",
			userId: "user-1",
		});
		return createRequest(
			`https://app.example.com/api/auth/callback/social-org/google?code=code&state=${Buffer.from(stateJson).toString("base64url")}`,
		);
	}

	it("rejects a banned owner of an already linked account", async () => {
		const request = prepareCallback("/");
		mockState.userFindFirst.mockResolvedValue({
			id: "user-1",
			banned: true,
			banExpires: null,
		});
		const response = await GET(request);
		expect(response.headers.get("location")).toContain(
			"/sign-in?error=oauth_error",
		);
		expect(response.headers.get("set-cookie")).not.toContain("session_token");
		expect(mockState.database.session).toHaveLength(0);
	});

	it("issues a signed Better Auth cookie instead of a raw database token", async () => {
		const request = prepareCallback("/");
		const response = await GET(request);
		const cookie = response.headers
			.getSetCookie()
			.find((value) => value.includes("session_token"));
		expect(cookie).toContain("__Secure-better-auth.session_token=");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Secure");
		expect(cookie).toContain("SameSite=Lax");
		if (!cookie) throw new Error("Expected a signed session cookie");
		const cookiePair = cookie.split(";")[0];
		const signedValue = decodeURIComponent(cookiePair.split("=")[1]);
		expect(signedValue).toContain(".");
		const session = mockState.database.session[0];
		expect(signedValue).not.toBe(session.token);
		expect(mockState.cache.has(session.token as string)).toBe(true);
		expect(mockState.sessionBefore).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "user-1" }),
			expect.objectContaining({ path: "/callback/social-org/:provider" }),
		);
		const authenticated = await auth.api.getSession({
			headers: new Headers({ cookie: cookiePair }),
		});
		expect(authenticated?.user.id).toBe("user-1");
	});

	it.each([
		"/\\evil.example/",
		"/\n/evil.example/",
		"//evil.example/",
		"/safe/..//evil.example/",
		"https://evil.example/",
	])(
		"falls back to the app root for unsafe signed callback %j",
		async (callbackURL) => {
			const response = await GET(prepareCallback(callbackURL));
			expect(response.headers.get("location")).toBe("https://app.example.com/");
		},
	);

	it("preserves a local callback including query and fragment", async () => {
		const response = await GET(
			prepareCallback("/settings?tab=security#sessions"),
		);
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
		const response = await GET(request);
		expect(response.headers.get("location")).toBe(
			"https://app.example.com/sign-in?error=oauth_error",
		);
		expect(mockState.insert).not.toHaveBeenCalled();
		expect(response.headers.get("set-cookie")).not.toContain("session_token");
	});

	it("creates a session for a new user without an existing Z8 login", async () => {
		const request = prepareCallback("/settings");
		mockState.accountFindFirst.mockResolvedValue(undefined);
		mockState.userFindFirst.mockResolvedValue(undefined);
		const response = await GET(request);
		expect(response.headers.get("location")).toBe(
			"https://app.example.com/onboarding",
		);
		expect(mockState.database.session).toHaveLength(1);
		expect(response.headers.get("set-cookie")).toContain("session_token");
	});

	it("honors expired bans in the linked-account callback", async () => {
		const request = prepareCallback("/");
		const banExpires = new Date("2020-01-01T00:00:00Z");
		mockState.userFindFirst.mockResolvedValue({
			id: "user-1",
			banned: true,
			banExpires,
		});
		await (await auth.$context).adapter.update({
			model: "user",
			where: [{ field: "id", value: "user-1" }],
			update: { banned: true, banExpires },
		});
		const response = await GET(request);
		expect(response.headers.get("location")).toBe("https://app.example.com/");
		expect(mockState.database.session).toHaveLength(1);
	});

	it("does not issue a session after OAuth code exchange fails", async () => {
		const request = prepareCallback("/");
		mockState.exchangeCode.mockRejectedValueOnce(new Error("Invalid code"));
		const response = await GET(request);
		expect(response.headers.get("location")).toContain("error=oauth_error");
		expect(mockState.database.session).toHaveLength(0);
		expect(mockState.getUserInfo).not.toHaveBeenCalled();
	});

	it("does not accept a userId instead of verified OAuth state and code", async () => {
		const response = await POST(
			new Request(
				"https://app.example.com/api/auth/callback/social-org/google",
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: "https://app.example.com",
					},
					body: JSON.stringify({ userId: "user-1" }),
				},
			),
		);
		expect(response.headers.get("location")).toContain("error=invalid_request");
		expect(mockState.database.session).toHaveLength(0);
		expect(mockState.exchangeCode).not.toHaveBeenCalled();
	});

	it("handles Apple's form_post callback through the same session lifecycle", async () => {
		const prepared = prepareCallback("/settings");
		const state = new URL(prepared.url).searchParams.get("state") ?? "";
		mockState.parseAppleFormPost.mockImplementation((form: FormData) => ({
			code: form.get("code"),
			state: form.get("state"),
		}));
		const headers = new Headers(prepared.headers);
		headers.set("content-type", "application/x-www-form-urlencoded");
		headers.set("origin", "https://appleid.apple.com");
		const response = await POST(
			new Request(
				"https://app.example.com/api/auth/callback/social-org/apple",
				{
					method: "POST",
					headers,
					body: new URLSearchParams({ code: "apple-code", state }),
				},
			),
		);
		expect(response.headers.get("location")).toBe(
			"https://app.example.com/settings",
		);
		expect(mockState.exchangeCode).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "apple", code: "apple-code" }),
		);
		expect(mockState.database.session).toHaveLength(1);
	});
});
