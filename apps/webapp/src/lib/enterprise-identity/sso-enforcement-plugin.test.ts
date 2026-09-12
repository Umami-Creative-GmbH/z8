import { createHmac } from "node:crypto";
import { sso } from "@better-auth/sso";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { organization } from "better-auth/plugins/organization";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createSsoEnforcementPlugin,
	recordVerifiedSsoLogin,
} from "./sso-enforcement-plugin";
import type { SessionSsoProvenance, SessionSsoStore } from "./session-sso";
import { startOrganizationSsoReauthentication } from "./sso-reauthentication";

async function fixture(realSso = false) {
	const data: Record<string, Record<string, unknown>[]> = {
		user: [],
		session: [],
		account: [],
		verification: [],
		organization: [],
		member: [],
		invitation: [],
		team: [],
		teamMember: [],
		ssoProvider: [],
	};
	const proofs = new Map<string, SessionSsoProvenance>();
	let required = true;
	const store: SessionSsoStore = {
		getPolicy: async (id) => ({
			required: required && id === "locked",
			providerId: "verified-idp",
		}),
		getProvenance: async (sessionId) => proofs.get(sessionId) ?? null,
		saveProvenance: async (proof) => {
			proofs.set(proof.sessionId, proof);
		},
	};
	// Only this test fixture simulates the provider's post-verification callback.
	// The production marker is never exposed as an HTTP endpoint.
	const callbacks = {
		id: "verified-provider-test-fixture",
		endpoints: {
			verified: createAuthEndpoint(
				"/sso/callback",
				{ method: "GET" },
				async (ctx) => {
					await recordVerifiedSsoLogin({
						user: { id: "actor" },
						provider: { providerId: "verified-idp", organizationId: "locked" },
					});
					const session =
						await ctx.context.internalAdapter.createSession("actor");
					const user = await ctx.context.internalAdapter.findUserById("actor");
					await setSessionCookie(ctx, { session, user: user! });
					throw ctx.redirect("http://localhost:3000/done");
				},
			),
			unverified: createAuthEndpoint(
				"/sso/callback/:providerId",
				{ method: "GET" },
				async (ctx) => {
					const session =
						await ctx.context.internalAdapter.createSession("actor");
					const user = await ctx.context.internalAdapter.findUserById("actor");
					await setSessionCookie(ctx, { session, user: user! });
					return ctx.json({ ok: true });
				},
			),
		},
	} satisfies BetterAuthPlugin;
	const auth = betterAuth({
		baseURL: "http://localhost:3000",
		secret: "test-sso-enforcement-secret-at-least-32-characters",
		trustedOrigins: ["https://idp.example.test"],
		database: memoryAdapter(data),
		session: { cookieCache: { enabled: true, maxAge: 300 } },
		plugins: [
			organization({ teams: { enabled: true } }),
			realSso
				? sso({
						redirectURI: "/sso/callback",
						domainVerification: { enabled: true },
						provisionUserOnEveryLogin: true,
						provisionUser: recordVerifiedSsoLogin,
					})
				: callbacks,
			createSsoEnforcementPlugin(store),
		],
	});
	const ctx = await auth.$context;
	await ctx.internalAdapter.createUser({
		id: "actor",
		name: "Actor",
		email: "actor@example.test",
		emailVerified: true,
	});
	for (const id of ["locked", "open"]) {
		await ctx.adapter.create({
			model: "organization",
			data: { id, name: id, slug: id, createdAt: new Date() },
			forceAllowId: true,
		});
		await ctx.adapter.create({
			model: "member",
			data: {
				organizationId: id,
				userId: "actor",
				role: "owner",
				createdAt: new Date(),
			},
		});
	}
	const session = await ctx.internalAdapter.createSession("actor", false, {
		activeOrganizationId: "open",
	});
	const signature = createHmac("sha256", ctx.secret)
		.update(session.token)
		.digest("base64");
	const cookie = `better-auth.session_token=${encodeURIComponent(`${session.token}.${signature}`)}`;
	const headers = new Headers({ cookie });
	if (realSso)
		await ctx.adapter.create({
			model: "ssoProvider",
			data: {
				providerId: "verified-idp",
				organizationId: "locked",
				userId: "actor",
				issuer: "https://idp.example.test",
				domain: "example.test",
				domainVerified: true,
				oidcConfig: JSON.stringify({
					issuer: "https://idp.example.test",
					clientId: "client",
					clientSecret: "client-secret",
					authorizationEndpoint: "https://idp.example.test/authorize",
					tokenEndpoint: "https://idp.example.test/token",
					userInfoEndpoint: "https://idp.example.test/userinfo",
					jwksEndpoint: "https://idp.example.test/jwks",
					pkce: true,
				}),
			},
		});
	return {
		auth,
		ctx,
		data,
		store,
		proofs,
		session,
		headers,
		setRequired: (value: boolean) => {
			required = value;
		},
	};
}

describe("SSO enforcement in installed Better Auth endpoint dispatch", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses the installed SSO plugin's verified state and records proof on every successful login", async () => {
		const { auth, proofs, store, headers } = await fixture(true);
		const fetch = vi.fn(async (url: string | URL | Request) => {
			const address = url instanceof Request ? url.url : String(url);
			if (address === "https://idp.example.test/token")
				return Response.json({
					access_token: "verified-token",
					token_type: "Bearer",
					expires_in: 3600,
				});
			if (address === "https://idp.example.test/userinfo")
				return Response.json({
					sub: "idp-actor",
					email: "actor@example.test",
					name: "Actor",
					email_verified: true,
				});
			throw new Error(`Unexpected IdP endpoint: ${address}`);
		});
		vi.stubGlobal("fetch", fetch);
		for (let login = 0; login < 2; login++) {
			const start = await startOrganizationSsoReauthentication(
				{
					getMembership: async () => true,
					getPolicy: store.getPolicy,
					start: (body) =>
						auth.api.signInSSO({ headers, body, asResponse: true }),
				},
				{
					userId: "actor",
					organizationId: "locked",
					origin: "http://localhost:3000",
					callbackUrl: "/reports",
				},
			);
			expect(start.status).toBe(200);
			const { url } = await start.json();
			const state = new URL(url).searchParams.get("state");
			const cookie = start.headers
				.getSetCookie()
				.map((value) => value.split(";")[0])
				.join("; ");
			const callback = await auth.handler(
				new Request(
					`http://localhost:3000/api/auth/sso/callback?code=verified-code&state=${state}&providerId=forged&organizationId=open`,
					{ headers: { cookie } },
				),
			);
			const destination = new URL(callback.headers.get("location")!);
			expect(destination.pathname).toBe("/init");
			expect(destination.searchParams.get("organizationId")).toBe("locked");
			expect(destination.searchParams.get("callbackUrl")).toBe("/reports");
			expect(callback.status).toBe(302);
			expect(proofs.size).toBe(login + 1);
			const freshHeaders = new Headers({
				cookie: callback.headers
					.getSetCookie()
					.map((value) => value.split(";")[0])
					.join("; "),
			});
			expect(
				await auth.api.setActiveOrganization({
					headers: freshHeaders,
					body: { organizationId: "locked" },
				}),
			).toMatchObject({ id: "locked" });
		}
		expect([...proofs.values()]).toEqual([
			expect.objectContaining({
				organizationId: "locked",
				providerId: "verified-idp",
				userId: "actor",
			}),
			expect.objectContaining({
				organizationId: "locked",
				providerId: "verified-idp",
				userId: "actor",
			}),
		]);
	});

	it("rejects forged state in the real SSO callback without recording proof", async () => {
		const { auth, proofs } = await fixture(true);
		await auth.handler(
			new Request(
				"http://localhost:3000/api/auth/sso/callback?state=forged&code=forged&providerId=verified-idp",
			),
		);
		expect(proofs.size).toBe(0);
	});

	it("denies provider management using membership alone", async () => {
		const { auth, headers } = await fixture(true);
		const response = await auth.handler(
			new Request(
				"http://localhost:3000/api/auth/sso/get-provider?providerId=verified-idp",
				{ headers },
			),
		);
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ code: "SSO_REQUIRED" });
		const listing = await auth.handler(
			new Request("http://localhost:3000/api/auth/sso/providers", { headers }),
		);
		expect(await listing.json()).toEqual({ providers: [] });
	});
	it("denies switching and nonactive organization APIs even with valid membership", async () => {
		const { auth, headers } = await fixture();
		await expect(
			auth.api.setActiveOrganization({
				headers,
				body: { organizationId: "locked" },
			}),
		).rejects.toMatchObject({ body: { code: "SSO_REQUIRED" } });
		await expect(
			auth.api.getFullOrganization({
				headers,
				query: { organizationId: "locked" },
			}),
		).rejects.toMatchObject({ body: { code: "SSO_REQUIRED" } });
		await expect(
			auth.api.getFullOrganization({
				headers,
				query: { organizationId: "open", organizationSlug: "locked" },
			}),
		).rejects.toMatchObject({ body: { code: "SSO_REQUIRED" } });
		expect(
			await auth.api.setActiveOrganization({
				headers,
				body: { organizationId: "open" },
			}),
		).toMatchObject({ id: "open" });
	});

	it("allows matching provenance but rejects a different provider and a different session", async () => {
		const { auth, headers, proofs, session } = await fixture();
		proofs.set(session.id, {
			sessionId: session.id,
			userId: "actor",
			organizationId: "locked",
			providerId: "wrong",
		});
		await expect(
			auth.api.setActiveOrganization({
				headers,
				body: { organizationId: "locked" },
			}),
		).rejects.toMatchObject({ body: { code: "SSO_REQUIRED" } });
		proofs.set(session.id, {
			sessionId: session.id,
			userId: "actor",
			organizationId: "locked",
			providerId: "verified-idp",
		});
		expect(
			await auth.api.setActiveOrganization({
				headers,
				body: { organizationId: "locked" },
			}),
		).toMatchObject({ id: "locked" });
	});

	it("records the verified provider from callback context, ignoring forged query provider/org", async () => {
		const { auth, proofs } = await fixture();
		const result = await auth.handler(
			new Request(
				"http://localhost:3000/api/auth/sso/callback?providerId=forged&organizationId=open",
			),
		);
		expect(result.status).toBe(302);
		expect([...proofs.values()]).toEqual([
			expect.objectContaining({
				userId: "actor",
				organizationId: "locked",
				providerId: "verified-idp",
			}),
		]);
	});

	it("never treats a callback path, requested provider, or newly created session alone as proof", async () => {
		const { auth, proofs } = await fixture();
		await auth.handler(
			new Request(
				"http://localhost:3000/api/auth/sso/callback/verified-idp?organizationId=locked",
			),
		);
		expect(proofs.size).toBe(0);
	});

	it("checks invitation and team resource ownership even if an open organization is supplied", async () => {
		const { auth, ctx, headers } = await fixture();
		await ctx.adapter.create({
			model: "invitation",
			forceAllowId: true,
			data: {
				id: "locked-invite",
				email: "actor@example.test",
				organizationId: "locked",
				inviterId: "actor",
				role: "member",
				status: "pending",
				expiresAt: new Date("2099-01-01"),
			},
		});
		await ctx.adapter.create({
			model: "team",
			forceAllowId: true,
			data: {
				id: "locked-team",
				name: "Locked team",
				organizationId: "locked",
				createdAt: new Date(),
			},
		});
		await expect(
			auth.api.getInvitation({ headers, query: { id: "locked-invite" } }),
		).rejects.toMatchObject({ body: { code: "SSO_REQUIRED" } });
		await expect(
			auth.api.acceptInvitation({
				headers,
				body: { invitationId: "locked-invite" },
			}),
		).rejects.toMatchObject({ body: { code: "SSO_REQUIRED" } });
		await expect(
			auth.api.listTeamMembers({ headers, query: { teamId: "locked-team" } }),
		).rejects.toMatchObject({ body: { code: "SSO_REQUIRED" } });
	});

	it("filters cross-organization team listings rather than trusting the active organization", async () => {
		const { auth, ctx, headers } = await fixture();
		for (const organizationId of ["locked", "open"]) {
			await ctx.adapter.create({
				model: "team",
				forceAllowId: true,
				data: {
					id: `${organizationId}-team`,
					name: organizationId,
					organizationId,
					createdAt: new Date(),
				},
			});
			await ctx.adapter.create({
				model: "teamMember",
				data: {
					teamId: `${organizationId}-team`,
					userId: "actor",
					createdAt: new Date(),
				},
			});
		}
		expect(await auth.api.listUserTeams({ headers })).toEqual([
			expect.objectContaining({ organizationId: "open" }),
		]);
	});

	it("rechecks policy despite the cookie cache and lets a locked-out user switch to an open org", async () => {
		const { auth, headers, setRequired } = await fixture();
		setRequired(false);
		const response = await auth.api.setActiveOrganization({
			headers,
			body: { organizationId: "locked" },
			returnHeaders: true,
		});
		const cachedHeaders = new Headers({
			cookie: response.headers
				.getSetCookie()
				.map((cookie) => cookie.split(";")[0])
				.join("; "),
		});
		expect(
			(await auth.api.getSession({ headers: cachedHeaders }))?.session
				.activeOrganizationId,
		).toBe("locked");
		setRequired(true);
		expect(await auth.api.getSession({ headers: cachedHeaders })).toMatchObject(
			{ ssoRequired: true },
		);
		expect(
			(await auth.api.getSession({ headers: cachedHeaders }))?.session
				.activeOrganizationId,
		).toBeNull();
		await expect(
			auth.api.getFullOrganization({ headers: cachedHeaders }),
		).rejects.toMatchObject({ body: { code: "SSO_REQUIRED" } });
		expect(
			await auth.api.setActiveOrganization({
				headers: cachedHeaders,
				body: { organizationId: "open" },
			}),
		).toMatchObject({ id: "open" });
	});
});
