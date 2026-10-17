import {
	createHash,
	generateKeyPairSync,
	randomBytes,
	sign,
} from "node:crypto";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { expect, it } from "vitest";
import type { LocalMfaProof } from "./access";
import {
	createMfaAuthenticationPlugin,
	type MfaAuthStore,
	recordVerifiedMfaPasskey,
} from "./authentication-plugin";

it.each([true, false])(
	"requires the signature-verified UV bit for synced passkeys (UV=%s)",
	async (uv) => {
		const { privateKey, publicKey } = generateKeyPairSync("ec", {
			namedCurve: "prime256v1",
		});
		const jwk = publicKey.export({ format: "jwk" });
		if (!jwk.x || !jwk.y)
			throw new Error("Fixture EC key is missing coordinates");
		const cose = Buffer.concat([
			Buffer.from("a5010203262001215820", "hex"),
			Buffer.from(jwk.x, "base64url"),
			Buffer.from("225820", "hex"),
			Buffer.from(jwk.y, "base64url"),
		]);
		const credentialID = randomBytes(32).toString("base64url");
		const data: Record<string, Record<string, unknown>[]> = {
			user: [],
			session: [],
			account: [],
			verification: [],
			passkey: [],
		};
		const proofs: LocalMfaProof[] = [];
		const store: MfaAuthStore = {
			revision: async () => 0,
			fingerprint: async () => "factor-fingerprint",
			saveProof: async (proof) => {
				proofs.push(proof);
			},
			readProof: async () => null,
			readPrimary: async () => null,
			savePrimary: async () => {},
			recordRecovery: async () => {},
			affected: async () => true,
		};
		const auth = betterAuth({
			baseURL: "http://localhost:3000",
			secret: "mfa-passkey-test-secret-at-least-32-characters",
			database: memoryAdapter(data),
			plugins: [
				passkey({
					rpID: "localhost",
					authentication: { afterVerification: recordVerifiedMfaPasskey },
				}),
				createMfaAuthenticationPlugin(store),
			],
		});
		const ctx = await auth.$context;
		await ctx.internalAdapter.createUser({
			id: "actor",
			name: "Actor",
			email: "actor@example.test",
			emailVerified: true,
		});
		await ctx.adapter.create({
			model: "passkey",
			data: {
				id: "factor",
				userId: "actor",
				credentialID,
				publicKey: cose.toString("base64"),
				counter: 0,
				deviceType: "multiDevice",
				backedUp: true,
				createdAt: new Date(),
			},
			forceAllowId: true,
		});
		const options = await auth.handler(
			new Request(
				"http://localhost:3000/api/auth/passkey/generate-authenticate-options",
			),
		);
		expect(options.status).toBe(200);
		const { challenge } = await options.json();
		const cookie = options.headers
			.getSetCookie()
			.map((value) => value.split(";")[0])
			.join("; ");
		const clientData = Buffer.from(
			JSON.stringify({
				type: "webauthn.get",
				challenge,
				origin: "http://localhost:3000",
				crossOrigin: false,
			}),
		);
		const authData = Buffer.concat([
			createHash("sha256").update("localhost").digest(),
			Buffer.from([uv ? 0x1d : 0x19]),
			Buffer.from([0, 0, 0, 1]),
		]);
		const signature = sign(
			"sha256",
			Buffer.concat([
				authData,
				createHash("sha256").update(clientData).digest(),
			]),
			privateKey,
		);
		const response = {
			id: credentialID,
			rawId: credentialID,
			type: "public-key",
			clientExtensionResults: {},
			response: {
				authenticatorData: authData.toString("base64url"),
				clientDataJSON: clientData.toString("base64url"),
				signature: signature.toString("base64url"),
				userHandle: Buffer.from("actor").toString("base64url"),
			},
		};
		const result = await auth.handler(
			new Request(
				"http://localhost:3000/api/auth/passkey/verify-authentication",
				{
					method: "POST",
					headers: {
						cookie,
						origin: "http://localhost:3000",
						"content-type": "application/json",
					},
					body: JSON.stringify({ response, userVerified: true }),
				},
			),
		);
		expect(result.status).toBe(200);
		expect(proofs).toHaveLength(uv ? 1 : 0);
		if (uv)
			expect(proofs[0]).toMatchObject({
				method: "passkey",
				factorId: "factor",
				userId: "actor",
			});
	},
);
