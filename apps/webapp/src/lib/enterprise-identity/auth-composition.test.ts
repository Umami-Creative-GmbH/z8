import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSsoProvenance } from "./session-sso";

const infrastructure = vi.hoisted(() => ({
	proofs: new Map<string, SessionSsoProvenance>(),
	organization: vi.fn(async () => ({
		id: "locked",
		ssoRequiresApproval: false,
	})),
	employee: vi.fn(async () => ({
		id: "employee",
		organizationId: "locked",
		userId: "actor",
		isActive: true,
	})),
}));
vi.mock("@/env", async (original) => {
	const module = await original<typeof import("@/env")>();
	return {
		env: {
			...module.env,
			MAIN_DOMAIN: "app.example.com",
			PLATFORM_DOMAIN: "app.example.com",
			TURNSTILE_SITE_KEY: "composition-site",
			TURNSTILE_SECRET_KEY: "composition-cloudflare-secret",
			TURNSTILE_TIMEOUT_MS: "1000",
		},
	};
});
vi.mock("@/db", () => ({
	db: {
		query: {
			organization: { findFirst: infrastructure.organization },
			employee: { findFirst: infrastructure.employee },
		},
	},
}));
vi.mock("@/lib/domain/domain-service", () => ({
	getDomainConfig: async () => null,
}));
vi.mock("@/lib/domain/platform-domain", async (original) => ({
	...(await original<object>()),
	resolvePlatformOrganization: async () => null,
}));
vi.mock("@/lib/vault", async (original) => ({
	...(await original<object>()),
	getOrgSecret: async () => null,
}));
vi.mock("@/lib/enterprise-identity/session-sso-store", () => ({
	sessionSsoStore: {
		getPolicy: async (organizationId: string) => ({
			required: organizationId === "locked",
			providerId: "verified-idp",
		}),
		getProvenance: async (sessionId: string) =>
			infrastructure.proofs.get(sessionId) ?? null,
		saveProvenance: async (proof: SessionSsoProvenance) => {
			infrastructure.proofs.set(proof.sessionId, proof);
		},
	},
}));

// Import the actual factory result. No plugin factory, middleware, or provisionUser is mocked.
import { auth as productionAuth } from "@/lib/auth";

const origin = "https://app.example.com";
const password = "Composition-password-123!";

function cookieHeaders(response: Response) {
	return new Headers({
		cookie: response.headers
			.getSetCookie()
			.map((cookie) => cookie.split(";")[0])
			.join("; "),
	});
}

async function harness(useSecondaryStorage = false) {
	const data: Record<string, Record<string, unknown>[]> = {
		user: [],
		account: [],
		session: [],
		verification: [],
		organization: [],
		member: [],
		team: [],
		teamMember: [],
		invitation: [],
		ssoProvider: [],
	};
	const cache = new Map<string, string>();
	const sendVerificationEmail = vi.fn();
	const sendResetPassword = vi.fn();
	const auth = betterAuth({
		baseURL: origin,
		secret: "composition-auth-secret-at-least-32-characters",
		trustedOrigins: [origin, "https://idp.example.test"],
		database: memoryAdapter(data),
		session: { cookieCache: { enabled: false }, storeSessionInDatabase: true },
		...(useSecondaryStorage
			? {
					secondaryStorage: {
						get: async (key: string) => cache.get(key) ?? null,
						set: async (key: string, value: string) => {
							cache.set(key, value);
						},
						delete: async (key: string) => {
							cache.delete(key);
						},
					},
				}
			: {}),
		emailAndPassword: { enabled: true, sendResetPassword },
		emailVerification: { sendVerificationEmail },
		// This is exactly the production registration, including normal BA plugins,
		// social-org OAuth, SCIM, nextCookies, and the production SSO callback.
		plugins: productionAuth.options.plugins,
	});
	const ctx = await auth.$context;
	const request = (path: string, body?: unknown, extraHeaders?: HeadersInit) =>
		auth.handler(
			new Request(`${origin}/api/auth${path}`, {
				method: body === undefined ? "GET" : "POST",
				headers: {
					origin,
					host: "app.example.com",
					...(body === undefined ? {} : { "content-type": "application/json" }),
					...Object.fromEntries(new Headers(extraHeaders)),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
		);
	async function seed() {
		const signup = await request(
			"/sign-up/email",
			{ email: "actor@example.test", name: "Actor", password },
			{ "x-captcha-response": "valid-signup" },
		);
		expect(signup.status).toBe(200);
		const actor = (await signup.clone().json()).user;
		await ctx.adapter.update({
			model: "user",
			where: [{ field: "id", value: actor.id }],
			update: { emailVerified: true },
		});
		for (const id of ["locked", "open"]) {
			await ctx.adapter.create({
				model: "organization",
				forceAllowId: true,
				data: { id, name: id, slug: id, createdAt: new Date() },
			});
			await ctx.adapter.create({
				model: "member",
				data: {
					organizationId: id,
					userId: actor.id,
					role: "owner",
					status: "approved",
					createdAt: new Date(),
				},
			});
		}
		await ctx.adapter.create({
			model: "ssoProvider",
			data: {
				providerId: "verified-idp",
				organizationId: "locked",
				userId: actor.id,
				issuer: "https://idp.example.test",
				domain: "example.test",
				domainVerified: true,
				oidcConfig: JSON.stringify({
					issuer: "https://idp.example.test",
					clientId: "client",
					clientSecret: "composition-idp-secret",
					authorizationEndpoint: "https://idp.example.test/authorize",
					tokenEndpoint: "https://idp.example.test/token",
					userInfoEndpoint: "https://idp.example.test/userinfo",
					jwksEndpoint: "https://idp.example.test/jwks",
					pkce: true,
				}),
			},
		});
		return { actor, headers: cookieHeaders(signup) };
	}
	return {
		auth,
		ctx,
		data,
		cache,
		request,
		seed,
		sendVerificationEmail,
		sendResetPassword,
	};
}

describe("production auth plugin composition with installed Better Auth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		infrastructure.proofs.clear();
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request) => {
				const url = input instanceof Request ? input.url : String(input);
				if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify")
					return Response.json({ success: true, hostname: "app.example.com" });
				if (url === "https://idp.example.test/token")
					return Response.json({
						access_token: "verified-token",
						token_type: "Bearer",
						expires_in: 3600,
					});
				if (url === "https://idp.example.test/userinfo")
					return Response.json({
						sub: "actor-idp",
						email: "actor@example.test",
						name: "Actor",
						email_verified: true,
					});
				throw new Error(`Unexpected external request: ${url}`);
			}),
		);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("registers the real production security composition in the expected order", () => {
		expect(productionAuth.options.session?.cookieCache?.enabled).toBe(false);
		const ids = productionAuth.options.plugins?.map((plugin) => plugin.id);
		expect(ids).toEqual([
			"z8-turnstile-auth-guard",
			"z8-account-ban",
			"z8-social-org-oauth",
			"bearer",
			"scim",
			"admin",
			"organization",
			"two-factor",
			"passkey",
			"sso",
			"api-key",
			"z8-sso-enforcement",
			"next-cookies",
			"z8-scim-callback-models",
		]);
	});

	it.each([false, true])(
		"records production verified OIDC provenance through the ban adapter and permits org activation (secondary storage: %s)",
		async (secondary) => {
			const h = await harness(secondary);
			const { actor, headers } = await h.seed();
			await expect(
				h.auth.api.setActiveOrganization({
					headers,
					body: { organizationId: "locked" },
				}),
			).rejects.toMatchObject({ body: { code: "SSO_REQUIRED" } });
			const start = await h.auth.api.signInSSO({
				headers,
				body: {
					providerId: "verified-idp",
					callbackURL: `${origin}/init?organizationId=locked`,
				},
				asResponse: true,
			});
			const state = new URL((await start.json()).url).searchParams.get("state");
			const callback = await h.request(
				`/sso/callback?state=${state}&code=verified&providerId=forged&organizationId=open`,
				undefined,
				cookieHeaders(start),
			);
			expect(callback.status).toBe(302);
			expect(callback.headers.get("location")).toBe(
				`${origin}/init?organizationId=locked`,
			);
			expect([...infrastructure.proofs.values()]).toEqual([
				expect.objectContaining({
					userId: actor.id,
					organizationId: "locked",
					providerId: "verified-idp",
				}),
			]);
			expect(infrastructure.employee).toHaveBeenCalled(); // Real production provisionUser ran before the marker.
			const freshHeaders = cookieHeaders(callback);
			expect(
				await h.auth.api.setActiveOrganization({
					headers: freshHeaders,
					body: { organizationId: "locked" },
				}),
			).toMatchObject({ id: "locked" });
			const session = await h.auth.api.getSession({ headers: freshHeaders });
			if (!session)
				throw new Error("Verified OIDC did not create a usable session");
			const bearerHeaders = new Headers({
				authorization: `Bearer ${session.session.token}`,
			});
			expect(
				await h.auth.api.getFullOrganization({
					headers: bearerHeaders,
					query: { organizationId: "locked" },
				}),
			).toMatchObject({ id: "locked" });
			await h.ctx.adapter.update({
				model: "user",
				where: [{ field: "id", value: actor.id }],
				update: { banned: true, banExpires: null },
			});
			expect(infrastructure.proofs.size).toBe(1);
			await expect(
				h.auth.api.getFullOrganization({
					headers: bearerHeaders,
					query: { organizationId: "locked" },
				}),
			).rejects.toMatchObject({ statusCode: 401 });
			expect(
				(
					await h.request(
						"/organization/get-full-organization?organizationId=locked",
						undefined,
						bearerHeaders,
					)
				).status,
			).toBe(401);
		},
	);

	it.each([false, true])(
		"rejects a newly banned cookie/bearer session on HTTP and auth.api even after warming storage (%s)",
		async (secondary) => {
			const h = await harness(secondary);
			const { actor, headers } = await h.seed();
			const session = await h.auth.api.getSession({ headers });
			if (!session) throw new Error("Fixture did not create a usable session");
			const bearerHeaders = new Headers({
				authorization: `Bearer ${session.session.token}`,
			});
			expect(
				await h.auth.api.getFullOrganization({
					headers: bearerHeaders,
					query: { organizationId: "open" },
				}),
			).toMatchObject({ id: "open" });
			await h.ctx.adapter.update({
				model: "user",
				where: [{ field: "id", value: actor.id }],
				update: { banned: true, banExpires: null },
			});
			for (const credentials of [headers, bearerHeaders]) {
				expect(
					await h.auth.api.getSession({ headers: credentials }),
				).toBeNull();
				expect(
					await (
						await h.request("/get-session", undefined, credentials)
					).json(),
				).toBeNull();
				await expect(
					h.auth.api.getFullOrganization({
						headers: credentials,
						query: { organizationId: "open" },
					}),
				).rejects.toMatchObject({ statusCode: 401 });
				expect(
					(
						await h.request(
							"/organization/get-full-organization?organizationId=open",
							undefined,
							credentials,
						)
					).status,
				).toBe(401);
			}
			await expect(
				h.ctx.internalAdapter.createSession(actor.id),
			).rejects.toMatchObject({ body: { code: "BANNED_USER" } });
		},
	);

	it.each(["sign-up/email", "sign-in/email"])(
		"missing CAPTCHA blocks %s on HTTP and auth.api before persistence or email effects",
		async (path) => {
			const h = await harness();
			if (path === "sign-in/email") await h.seed();
			const hash = vi.spyOn(h.ctx.password, "hash");
			const verify = vi.spyOn(h.ctx.password, "verify");
			vi.mocked(fetch).mockClear();
			h.sendVerificationEmail.mockClear();
			h.sendResetPassword.mockClear();
			const snapshot = JSON.stringify(h.data);
			const body = { email: "actor@example.test", name: "Actor", password };
			const response = await h.request(`/${path}`, body);
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				code: "TURNSTILE_REQUIRED",
			});
			const direct =
				path === "sign-up/email"
					? h.auth.api.signUpEmail({ body })
					: h.auth.api.signInEmail({ body });
			await expect(direct).rejects.toMatchObject({
				body: { code: "TURNSTILE_REQUIRED" },
			});
			expect(JSON.stringify(h.data)).toBe(snapshot);
			expect(h.sendVerificationEmail).not.toHaveBeenCalled();
			expect(h.sendResetPassword).not.toHaveBeenCalled();
			expect(fetch).not.toHaveBeenCalled();
			expect(hash).not.toHaveBeenCalled();
			expect(verify).not.toHaveBeenCalled();
			expect(infrastructure.proofs.size).toBe(0);
		},
	);
});
