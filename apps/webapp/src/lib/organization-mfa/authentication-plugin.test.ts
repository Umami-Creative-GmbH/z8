import { createHmac } from "node:crypto";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt } from "better-auth/crypto";
import { twoFactor } from "better-auth/plugins/two-factor";
import { expect, it } from "vitest";
import {
	createMfaAuthenticationPlugin,
	type MfaAuthStore,
} from "./authentication-plugin";

it("does not manufacture MFA proof from ordinary password authentication", async () => {
	const data: Record<string, Record<string, unknown>[]> = {
		user: [],
		account: [],
		session: [],
		verification: [],
		twoFactor: [],
	};
	const proofs: unknown[] = [];
	let primary: { method: string; verifiedAt: string } | null = null;
	const store: MfaAuthStore = {
		revision: async () => 0,
		fingerprint: async () => "fingerprint",
		saveProof: async (proof) => {
			proofs.push(proof);
		},
		readProof: async () => null,
		readPrimary: async () => primary,
		savePrimary: async (_subject, method) => {
			primary = { method, verifiedAt: new Date().toISOString() };
		},
		recordRecovery: async () => {},
		affected: async () => false,
	};
	const auth = betterAuth({
		baseURL: "http://localhost:3000",
		secret: "organization-mfa-test-secret-at-least-32-characters",
		database: memoryAdapter(data),
		emailAndPassword: { enabled: true },
		plugins: [twoFactor(), createMfaAuthenticationPlugin(store)],
	});
	await auth.api.signUpEmail({
		body: {
			name: "Actor",
			email: "actor@example.test",
			password: "password123456",
		},
	});
	const signed = await auth.api.signInEmail({
		body: { email: "actor@example.test", password: "password123456" },
	});
	expect(signed).toHaveProperty("token");
	expect(proofs).toEqual([]);
	const ctx = await auth.$context;
	if (!signed.token) throw new Error("Expected a fixture sign-in token");
	const session = await ctx.internalAdapter.findSession(signed.token);
	if (!session) throw new Error("Expected a fixture session");
	const signature = createHmac("sha256", ctx.secret)
		.update(signed.token)
		.digest("base64");
	const headers = new Headers({
		cookie: `better-auth.session_token=${encodeURIComponent(`${signed.token}.${signature}`)}`,
	});
	const _enrollment = await auth.api.enableTwoFactor({
		headers,
		body: { password: "password123456" },
	});
	expect(proofs).toEqual([]);
	const secret = await symmetricDecrypt({
		key: ctx.secretConfig,
		data: String(data.twoFactor[0].secret),
	});
	const { code } = await auth.api.generateTOTP({ body: { secret } });
	await auth.api.verifyTOTP({ headers, body: { code } });
	expect(proofs).toHaveLength(1);
	expect(proofs[0]).toMatchObject({ userId: session.user.id, method: "totp" });
});
