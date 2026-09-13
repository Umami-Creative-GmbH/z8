import { type BetterAuthOptions, betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError } from "better-auth/api";
import { createAuthClient } from "better-auth/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthAllowedHosts, getStaticTrustedOrigins } from "@/lib/auth-domain-config";
import { turnstileAuthGuard } from "./auth-plugin";

const mocks = vi.hoisted(() => ({
	env: {
		MAIN_DOMAIN: "app.example.com" as string | undefined,
		PLATFORM_DOMAIN: "app.example.com" as string | undefined,
		APP_URL: undefined as string | undefined,
		BETTER_AUTH_URL: undefined as string | undefined,
		NEXT_PUBLIC_APP_URL: undefined as string | undefined,
		TURNSTILE_SITE_KEY: "global-site" as string | undefined,
		TURNSTILE_SECRET_KEY: "synthetic-global-secret" as string | undefined,
		TURNSTILE_TIMEOUT_MS: "1000",
	},
	getDomainConfig: vi.fn(),
	resolvePlatformOrganization: vi.fn(),
	getOrgSecret: vi.fn(),
}));
vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/app-url", () => ({ getDefaultAppBaseUrl: vi.fn() }));
vi.mock("@/lib/social-oauth", () => ({ getConfiguredProviders: vi.fn() }));
vi.mock("@/lib/domain/domain-service", () => ({ getDomainConfig: mocks.getDomainConfig }));
vi.mock("@/lib/domain/platform-domain", async (importOriginal) => ({
	...(await importOriginal<object>()),
	resolvePlatformOrganization: mocks.resolvePlatformOrganization,
}));
vi.mock("@/lib/vault", () => ({ getOrgSecret: mocks.getOrgSecret }));

const email = "person@example.com";
const password = "Synthetic-password-123";
const paths = ["/sign-up/email", "/sign-in/email", "/request-password-reset"] as const;

function createHarness(baseURL: BetterAuthOptions["baseURL"] = "https://app.example.com") {
	const data: Record<string, Record<string, unknown>[]> = {
		user: [], account: [], session: [], verification: [],
	};
	const sendResetPassword = vi.fn();
	const sendVerificationEmail = vi.fn();
	const hash = vi.fn(async (value: string) => `synthetic-hash:${value}`);
	const verify = vi.fn(async ({ hash, password }: { hash: string; password: string }) =>
		hash === `synthetic-hash:${password}`,
	);
	const auth = betterAuth({
		baseURL,
		secret: "synthetic-test-secret-with-at-least-32-characters",
		database: memoryAdapter(data),
		emailAndPassword: { enabled: true, sendResetPassword, password: { hash, verify } },
		emailVerification: { sendVerificationEmail, sendOnSignUp: true },
		trustedOrigins: [...getStaticTrustedOrigins(), "https://app.example.com", "https://tenant.example.org"],
		rateLimit: { enabled: false },
		plugins: [turnstileAuthGuard()],
	});
	const bodyFor = (path: string) => path === "/request-password-reset"
		? { email }
		: { name: "Test Person", email, password };
	const direct = async (path: string, headers?: Headers) => {
		try {
			if (path === "/sign-up/email") return await auth.api.signUpEmail({ body: { name: "Test Person", email, password }, headers, asResponse: true });
			if (path === "/sign-in/email") return await auth.api.signInEmail({ body: { email, password }, headers, asResponse: true });
			return await auth.api.requestPasswordReset({ body: { email }, headers, asResponse: true });
		} catch (error) {
			// Better Auth 1.7 before hooks throw on direct calls, even with asResponse.
			if (!(error instanceof APIError)) throw error;
			return Response.json(error.body, { status: error.statusCode });
		}
	};
	const http = (path: string, headers = new Headers(), host = "app.example.com") => auth.handler(
		new Request(`https://${host}/api/auth${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", host, ...Object.fromEntries(headers) },
			body: JSON.stringify(bodyFor(path)),
		}),
	);
	const seed = async () => {
		await auth.api.signUpEmail({ body: { name: "Test Person", email, password }, headers: new Headers({ host: "app.example.com", "x-captcha-response": "seed" }) });
		for (const table of [data.session, data.verification]) table.length = 0;
		sendResetPassword.mockClear();
		sendVerificationEmail.mockClear();
		hash.mockClear();
		verify.mockClear();
	};
	return { auth, data, direct, http, seed, hash, verify, sendResetPassword, sendVerificationEmail };
}

describe("Turnstile auth guard with installed Better Auth", () => {
	afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.MAIN_DOMAIN = "app.example.com";
		mocks.env.PLATFORM_DOMAIN = "app.example.com";
		mocks.env.APP_URL = undefined;
		mocks.env.BETTER_AUTH_URL = undefined;
		mocks.env.NEXT_PUBLIC_APP_URL = undefined;
		mocks.env.TURNSTILE_SITE_KEY = "global-site";
		mocks.env.TURNSTILE_SECRET_KEY = "synthetic-global-secret";
		mocks.getDomainConfig.mockResolvedValue(null);
		mocks.resolvePlatformOrganization.mockResolvedValue({ id: "org-a" });
		mocks.getOrgSecret.mockResolvedValue("synthetic-tenant-secret");
		const used = new Set<string>();
		vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
			const { response: token } = JSON.parse(init.body);
			const success = token !== "invalid" && !used.has(token);
			used.add(token);
			return Response.json({ success, hostname: "app.example.com", "error-codes": success ? [] : ["timeout-or-duplicate"] });
		}));
	});

	for (const transport of ["http", "direct"] as const) {
		it.each([undefined, "different.example.com"])(
			`${transport}: APP_URL-only bootstrap uses actual allowedHosts with MAIN_DOMAIN=%s`,
			async (mainDomain) => {
				mocks.env.MAIN_DOMAIN = mainDomain;
				mocks.env.PLATFORM_DOMAIN = undefined;
				mocks.env.APP_URL = "https://selfhost.example.net";
				mocks.env.TURNSTILE_SITE_KEY = undefined;
				const h = createHarness({
					allowedHosts: getAuthAllowedHosts(),
					fallback: mocks.env.APP_URL,
					protocol: "auto",
				});
				const headers = new Headers({ host: "selfhost.example.net" });
				for (const path of paths) {
					const response = transport === "http"
						? await h.http(path, headers, "selfhost.example.net")
						: await h.direct(path, headers);
					expect(response.status).toBe(200);
				}
				expect(h.data.user).toHaveLength(1);
				expect(h.data.account).toHaveLength(1);
				expect(h.data.session.length).toBeGreaterThan(0);
				expect(h.sendResetPassword).toHaveBeenCalledOnce();
				expect(mocks.getDomainConfig).not.toHaveBeenCalled();
				expect(fetch).not.toHaveBeenCalled();
			},
		);
	}

	it.each(["APP_URL", "BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL"] as const)(
		"%s main host enforces global CAPTCHA and retains Cloudflare hostname binding",
		async (setting) => {
			mocks.env[setting] = "https://selfhost.example.net:8443";
			mocks.env.MAIN_DOMAIN = undefined;
			mocks.env.PLATFORM_DOMAIN = undefined;
			const h = createHarness(mocks.env[setting]);
			const headers = new Headers({ host: "selfhost.example.net:8443" });
			const missing = await h.direct("/sign-up/email", headers);
			expect(await missing.json()).toMatchObject({ code: "TURNSTILE_REQUIRED" });
			headers.set("x-captcha-response", "token");
			const mismatch = await h.direct("/sign-up/email", headers);
			expect(await mismatch.json()).toMatchObject({ code: "TURNSTILE_FAILED" });
			expect(h.data.user).toHaveLength(0);
			vi.mocked(fetch).mockResolvedValue(Response.json({ success: true, hostname: "selfhost.example.net" }));
			expect((await h.direct("/sign-up/email", headers)).status).toBe(200);
			expect(h.data.user).toHaveLength(1);
			expect(mocks.getOrgSecret).not.toHaveBeenCalled();
			expect(mocks.getDomainConfig).not.toHaveBeenCalled();
		},
	);

	it.each(["APP_URL", "BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL"] as const)(
		"%s main host works without CAPTCHA or domain records",
		async (setting) => {
			mocks.env[setting] = "http://SELFHOST.example.net:8080/";
			mocks.env.TURNSTILE_SITE_KEY = undefined;
			const h = createHarness(mocks.env[setting]);
			expect((await h.direct("/sign-up/email")).status).toBe(200);
			expect(h.data.user).toHaveLength(1);
			expect(mocks.getDomainConfig).not.toHaveBeenCalled();
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	for (const origin of ["https://selfhost.example.net:8443", "http://selfhost.example.net:8080"]) {
		it.each(["APP_URL", "BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL"] as const)(
			`%s-only deployment accepts actual browser Origin and password-reset redirects at ${origin}`,
			async (setting) => {
				mocks.env[setting] = origin;
				mocks.env.MAIN_DOMAIN = undefined;
				mocks.env.PLATFORM_DOMAIN = undefined;
				mocks.env.TURNSTILE_SITE_KEY = undefined;
				const h = createHarness({
					allowedHosts: getAuthAllowedHosts(),
					// Match the existing auth.ts fallback, including when APP_URL is absent.
					fallback: mocks.env.APP_URL || "https://ui.z8-time.app",
					protocol: "auto",
				});
				for (const path of paths) {
					const response = await h.auth.handler(new Request(`${origin}/api/auth${path}`, {
						method: "POST",
						headers: { host: new URL(origin).host, origin, "content-type": "application/json" },
						body: JSON.stringify(path === "/request-password-reset"
							? { email, redirectTo: `${origin}/reset-password` }
							: { name: "Test Person", email, password }),
					}));
					expect(response.status).toBe(200);
				}
				expect(h.data.user).toHaveLength(1);
				expect(h.data.session.length).toBeGreaterThan(0);
				expect(h.sendResetPassword).toHaveBeenCalledOnce();
				expect(h.sendResetPassword.mock.calls[0][0].url).toContain(`${origin}/api/auth/reset-password/`);
				expect(mocks.getDomainConfig).not.toHaveBeenCalled();
			},
		);
	}

	it("configured main URLs preserve a different verified tenant's CAPTCHA policy", async () => {
		mocks.env.APP_URL = "https://selfhost.example.net";
		mocks.env.TURNSTILE_SITE_KEY = undefined;
		mocks.getDomainConfig.mockResolvedValue({ organizationId: "org-a", authConfig: { turnstileSiteKey: "tenant-site" } });
		const h = createHarness();
		const response = await h.http("/sign-up/email", new Headers(), "tenant.example.org");
		expect(await response.json()).toMatchObject({ code: "TURNSTILE_REQUIRED" });
		expect(h.data.user).toHaveLength(0);
	});

	it.each(["selfhost.example.net.attacker.org", "team.selfhost.example.net", "unknown.example.net"])(
		"configured main URLs do not allow unknown hosts or spoofed forwarding: %s",
		async (host) => {
			mocks.env.APP_URL = "https://selfhost.example.net";
			mocks.env.TURNSTILE_SITE_KEY = undefined;
			const h = createHarness();
			const response = await h.direct("/sign-up/email", new Headers({
				host, "x-forwarded-host": "selfhost.example.net", origin: mocks.env.APP_URL,
			}));
			expect(await response.json()).toMatchObject({ code: "TURNSTILE_POLICY_UNAVAILABLE" });
			expect(h.data.user).toHaveLength(0);
		},
	);

	it.each(["ftp://unknown.example.net", "https://user:password@unknown.example.net", "not-a-url"])(
		"invalid/non-web configured URLs never promote arbitrary hosts to main: %s",
		async (url) => {
			mocks.env.APP_URL = url;
			mocks.env.TURNSTILE_SITE_KEY = undefined;
			const h = createHarness();
			expect((await h.direct("/sign-up/email", new Headers({ host: "unknown.example.net" }))).status).toBe(400);
			expect(h.data.user).toHaveLength(0);
		},
	);

	for (const transport of ["http", "direct"] as const) {
		for (const path of paths) {
			it(`${transport} ${path}: accepts a valid token once and rejects replay before effects`, async () => {
				const h = createHarness();
				if (path !== "/sign-up/email") await h.seed();
				const headers = new Headers({ host: "app.example.com", "x-captcha-response": "single-use" });
				expect((await h[transport](path, headers)).status).toBe(200);
				const snapshot = JSON.stringify(h.data);
				h.sendResetPassword.mockClear();
				h.sendVerificationEmail.mockClear();
				const replay = await h[transport](path, headers);
				expect(replay.status).toBe(400);
				expect(await replay.json()).toMatchObject({ code: "TURNSTILE_FAILED" });
				expect(JSON.stringify(h.data)).toBe(snapshot);
				expect(h.sendResetPassword).not.toHaveBeenCalled();
				expect(h.sendVerificationEmail).not.toHaveBeenCalled();
			});

			it(`${transport} ${path}: disabled global CAPTCHA permits legitimate requests`, async () => {
				mocks.env.TURNSTILE_SITE_KEY = undefined;
				const h = createHarness();
				if (path !== "/sign-up/email") await h.seed();
				expect((await h[transport](path)).status).toBe(200);
				expect(fetch).not.toHaveBeenCalled();
			});

			it(`${transport} ${path}: missing CAPTCHA cannot reach auth effects`, async () => {
				const h = createHarness();
				if (path !== "/sign-up/email") await h.seed();
				const response = await h[transport](path);
				expect(response.status).toBe(400);
				expect(await response.json()).toMatchObject({ code: "TURNSTILE_REQUIRED" });
				expect(h.data.user).toHaveLength(path === "/sign-up/email" ? 0 : 1);
				expect(h.data.account).toHaveLength(path === "/sign-up/email" ? 0 : 1);
				expect(h.data.session).toHaveLength(0);
				expect(h.data.verification).toHaveLength(0);
				expect(h.hash).not.toHaveBeenCalled();
				expect(h.verify).not.toHaveBeenCalled();
				expect(h.sendResetPassword).not.toHaveBeenCalled();
				expect(h.sendVerificationEmail).not.toHaveBeenCalled();
			});
		}
	}

	it.each(["invalid", " ", "x".repeat(2049)])("rejects invalid or malformed tokens", async (token) => {
		const h = createHarness();
		expect((await h.direct("/sign-up/email", new Headers({ "x-captcha-response": token }))).status).toBe(400);
		expect(h.data.user).toHaveLength(0);
	});

	it("fails closed on Cloudflare network errors", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.mocked(fetch).mockRejectedValue(new Error("offline"));
		const h = createHarness();
		expect((await h.direct("/sign-up/email", new Headers({ "x-captcha-response": "token" }))).status).toBe(400);
		expect(h.data.user).toHaveLength(0);
	});

	it("fails closed when Cloudflare returns a different hostname", async () => {
		vi.mocked(fetch).mockResolvedValue(Response.json({ success: true, hostname: "other.example.com" }));
		const h = createHarness();
		expect((await h.http("/sign-up/email", new Headers({ "x-captcha-response": "token" }))).status).toBe(400);
		expect(h.data.user).toHaveLength(0);
	});

	it("uses the verified tenant policy and tenant Vault secret for direct API calls with headers", async () => {
		mocks.getDomainConfig.mockResolvedValue({ organizationId: "org-a", authConfig: { turnstileSiteKey: "tenant-site" } });
		vi.mocked(fetch).mockResolvedValue(Response.json({ success: true, hostname: "tenant.example.org" }));
		const h = createHarness();
		const headers = new Headers({ host: "tenant.example.org", "x-captcha-response": "token", "x-organization-id": "attacker-org" });
		expect((await h.direct("/sign-up/email", headers)).status).toBe(200);
		expect(mocks.getDomainConfig).toHaveBeenCalledWith("tenant.example.org");
		expect(mocks.getOrgSecret).toHaveBeenCalledWith("org-a", "turnstile/secret_key");
		expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string).secret).toBe("synthetic-tenant-secret");
	});

	it("does not fall back to global policy for a verified tenant with CAPTCHA disabled", async () => {
		mocks.getDomainConfig.mockResolvedValue({ organizationId: "org-a", authConfig: {} });
		const h = createHarness();
		expect((await h.http("/sign-up/email", new Headers(), "tenant.example.org")).status).toBe(200);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("fails closed for a tenant with missing Vault secret", async () => {
		mocks.getDomainConfig.mockResolvedValue({ organizationId: "org-a", authConfig: { turnstileSiteKey: "tenant-site" } });
		mocks.getOrgSecret.mockResolvedValue(null);
		const h = createHarness();
		expect((await h.http("/sign-up/email", new Headers({ "x-captcha-response": "token" }), "tenant.example.org")).status).toBe(400);
		expect(h.data.user).toHaveLength(0);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("organization subdomains use the global policy consistently with the auth layout", async () => {
		const h = createHarness();
		const response = await h.http("/sign-up/email", new Headers(), "team.app.example.com");
		expect(await response.json()).toMatchObject({ code: "TURNSTILE_REQUIRED" });
		expect(mocks.resolvePlatformOrganization).toHaveBeenCalledWith("team");
		expect(mocks.getOrgSecret).not.toHaveBeenCalled();
	});

	it.each(["unknown.example.org", "missing.app.example.com", "nested.team.app.example.com", "https://app.example.com", "app.example.com/path", "user@app.example.com", "app.example.com:65536"])("rejects unknown or malformed Host %s even when global CAPTCHA is disabled", async (host) => {
		mocks.env.TURNSTILE_SITE_KEY = undefined;
		mocks.resolvePlatformOrganization.mockResolvedValue(null);
		const h = createHarness();
		expect((await h.direct("/sign-up/email", new Headers({ host }))).status).toBe(400);
		expect(h.data.user).toHaveLength(0);
	});

	it("ignores spoofed forwarding, organization and native-client exemption headers", async () => {
		const h = createHarness();
		const response = await h.direct("/sign-up/email", new Headers({
			host: "app.example.com", "x-forwarded-host": "disabled.example.org",
			"x-organization-id": "disabled-org", "x-desktop-client": "true", "user-agent": "Z8-Mobile",
		}));
		expect(await response.json()).toMatchObject({ code: "TURNSTILE_REQUIRED" });
		expect(h.data.user).toHaveLength(0);
	});

	it("uses the verified Host when Next.js request.url contains an internal server hostname", async () => {
		mocks.getDomainConfig.mockResolvedValue({ organizationId: "org-a", authConfig: {} });
		const h = createHarness();
		expect((await h.http("/sign-up/email", new Headers({ host: "tenant.example.org" }), "localhost:3000")).status).toBe(200);
		expect(mocks.getDomainConfig).toHaveBeenCalledWith("tenant.example.org");
		expect(fetch).not.toHaveBeenCalled();
	});

	it("the installed browser client transports fetchOptions headers to the real guard", async () => {
		const h = createHarness();
		const client = createAuthClient({
			baseURL: "https://app.example.com",
			fetchOptions: {
				customFetchImpl: async (url, init) => h.auth.handler(new Request(url, init)),
			},
		});
		const signup = await client.signUp.email({
			name: "Test Person", email, password,
			fetchOptions: { headers: { "x-captcha-response": "signup" } },
		});
		expect(signup.error).toBeNull();
		const signIn = await client.signIn.email({ email, password }, {
			headers: { "x-captcha-response": "login" },
		});
		expect(signIn.error).toBeNull();
		const reset = await client.requestPasswordReset({
			email, fetchOptions: { headers: { "x-captcha-response": "reset" } },
		});
		expect(reset.error).toBeNull();
		expect(h.sendResetPassword).toHaveBeenCalledOnce();
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it("direct auth.api throws without a request or headers instead of bypassing verification", async () => {
		const h = createHarness();
		await expect(h.auth.api.signUpEmail({ body: { name: "Test Person", email, password } }))
			.rejects.toMatchObject({ body: { code: "TURNSTILE_REQUIRED" } });
		expect(h.data.user).toHaveLength(0);
	});

	it("fails closed when the global secret is missing", async () => {
		mocks.env.TURNSTILE_SECRET_KEY = undefined;
		const h = createHarness();
		expect((await h.http("/sign-up/email", new Headers({ "x-captcha-response": "token" }))).status).toBe(400);
		expect(h.data.user).toHaveLength(0);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("fails closed when tenant policy lookup is unavailable", async () => {
		mocks.getDomainConfig.mockRejectedValue(new Error("database unavailable"));
		const h = createHarness();
		const response = await h.http("/sign-up/email", new Headers(), "tenant.example.org");
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: "TURNSTILE_POLICY_UNAVAILABLE" });
		expect(h.data.user).toHaveLength(0);
	});

	it.each([
		{ success: true },
		{ success: "true", hostname: "app.example.com" },
		{ success: false, hostname: "app.example.com" },
	])("rejects unsuccessful or malformed Cloudflare responses: %j", async (payload) => {
		vi.mocked(fetch).mockResolvedValue(Response.json(payload));
		const h = createHarness();
		expect((await h.http("/sign-up/email", new Headers({ "x-captcha-response": "token" }))).status).toBe(400);
		expect(h.data.user).toHaveLength(0);
	});
});
