import { createHmac } from "node:crypto";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { twoFactor } from "better-auth/plugins/two-factor";
import { describe, expect, it } from "vitest";
import { systemClock } from "@/lib/datetime/temporal-core";
import { createMfaAuthenticationPlugin, type MfaAuthStore } from "./authentication-plugin";

const TWO_DAYS_AGO = () => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

/**
 * An MFA-affected user whose browser session is older than Better Auth's
 * `freshAge` (one day). Since Better Auth 1.7.16 passkey registration reloads
 * the session from the store before its freshness check.
 */
async function agedSession(options: { affected: boolean; recentPassword: boolean }) {
	const data: Record<string, Record<string, unknown>[]> = {
		user: [],
		session: [],
		account: [],
		verification: [],
		passkey: [],
		twoFactor: [],
	};
	const store: MfaAuthStore = {
		revision: async () => 0,
		fingerprint: async () => null,
		saveProof: async () => {},
		readProof: async () => null,
		readPrimary: async () =>
			options.recentPassword
				? { method: "password", verifiedAt: systemClock.nowInstant().toString() }
				: null,
		savePrimary: async () => {},
		recordRecovery: async () => {},
		affected: async () => options.affected,
	};
	const passkeyPlugin = passkey({ rpID: "localhost" });
	const auth = betterAuth({
		baseURL: "http://localhost:3000",
		secret: "mfa-passkey-freshness-secret-at-least-32-characters",
		database: memoryAdapter(data),
		plugins: [twoFactor(), passkeyPlugin, createMfaAuthenticationPlugin(store)],
	});
	const ctx = await auth.$context;
	await ctx.internalAdapter.createUser({
		id: "actor",
		name: "Actor",
		email: "actor@example.test",
		emailVerified: true,
	});
	const session = await ctx.internalAdapter.createSession("actor");
	const createdAt = TWO_DAYS_AGO();
	data.session[0].createdAt = createdAt;
	const signature = createHmac("sha256", ctx.secret).update(session.token).digest("base64");
	const cookie = `better-auth.session_token=${encodeURIComponent(`${session.token}.${signature}`)}`;
	const registerOptions = () =>
		auth.handler(
			new Request("http://localhost:3000/api/auth/passkey/generate-register-options", {
				headers: { cookie },
			}),
		);
	return { auth, data, createdAt, registerOptions };
}

describe("passkey registration from an aged session", () => {
	it("accepts recent MFA evidence without refreshing the durable session", async () => {
		const { data, createdAt, registerOptions } = await agedSession({
			affected: true,
			recentPassword: true,
		});

		const response = await registerOptions();

		expect(response.status).toBe(200);
		expect(await response.json()).toHaveProperty("challenge");
		expect(data.session[0].createdAt).toEqual(createdAt);
	});

	it("rejects an affected user without recent MFA evidence", async () => {
		const { registerOptions } = await agedSession({ affected: true, recentPassword: false });

		const response = await registerOptions();

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ code: "MFA_RECENT_VERIFICATION_REQUIRED" });
	});

	it("keeps Better Auth's freshness rule for a user outside MFA enforcement", async () => {
		const { registerOptions } = await agedSession({ affected: false, recentPassword: true });

		const response = await registerOptions();

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
	});

	it("refuses to start when the passkey plugin no longer checks freshness the expected way", async () => {
		const passkeyPlugin = passkey({ rpID: "localhost" });
		for (const endpoint of Object.values(passkeyPlugin.endpoints)) endpoint.options.use = [];
		const auth = betterAuth({
			baseURL: "http://localhost:3000",
			secret: "mfa-passkey-freshness-secret-at-least-32-characters",
			database: memoryAdapter({
				user: [],
				session: [],
				account: [],
				verification: [],
				passkey: [],
			}),
			plugins: [passkeyPlugin, createMfaAuthenticationPlugin({} as MfaAuthStore)],
		});

		await expect(auth.$context).rejects.toThrow(/passkey registration/i);
	});
});
