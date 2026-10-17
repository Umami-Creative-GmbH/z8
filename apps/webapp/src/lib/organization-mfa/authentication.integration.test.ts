import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { symmetricDecrypt } from "better-auth/crypto";
import { bearer } from "better-auth/plugins/bearer";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
const { db } = await import("@/db");
const { authDatabaseSchema } = await import("@/lib/auth-database-schema");
const { createMfaAuthenticationPlugin } = await import(
	"./authentication-plugin"
);
const { mfaAuthStore } = await import("./auth-store");
const { createSsoEnforcementPlugin } = await import(
	"@/lib/enterprise-identity/sso-enforcement-plugin"
);
const { sessionSsoStore } = await import(
	"@/lib/enterprise-identity/session-sso-store"
);
const { getOrganizationMfaRequirement, readLocalMfaProof } = await import(
	"./store"
);
const { updateOrganizationMfaPolicy } = await import("./policy-service");
const org = "t1310-auth-org",
	person = "t1310-auth-person",
	owner = "t1310-auth-owner";
const origin = "http://localhost:3000",
	password = "test-authenticator-password-1310";

describe("real local MFA authentication and organization authorization", () => {
	const pool = integrationAdminPool();
	const auth = betterAuth({
		baseURL: origin,
		secret: "organization-mfa-integration-secret-at-least-32-characters",
		database: drizzleAdapter(db, {
			provider: "pg",
			schema: authDatabaseSchema,
			transaction: true,
		}),
		emailAndPassword: { enabled: true },
		session: { cookieCache: { enabled: false } },
		plugins: [
			bearer(),
			organization(),
			twoFactor(),
			passkey({
				rpID: "localhost",
				authenticatorSelection: { userVerification: "required" },
			}),
			createMfaAuthenticationPlugin(mfaAuthStore),
			createSsoEnforcementPlugin(sessionSsoStore, (subject, orgId) =>
				getOrganizationMfaRequirement(subject, orgId, false),
			),
		],
	});
	let cookie = "";
	async function cleanup() {
		await pool.query("DELETE FROM organization WHERE id=$1", [org]);
		await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [
			[person, owner],
		]);
	}
	beforeEach(async () => {
		await cleanup();
		cookie = "";
		await pool.query(
			'INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$3,true,now(),now()),($2,$2,$4,true,now(),now())',
			[person, owner, `${person}@example.test`, `${owner}@example.test`],
		);
		await pool.query(
			"INSERT INTO organization(id,name,slug,created_at) VALUES ($1,$1,$1,now())",
			[org],
		);
		await pool.query(
			"INSERT INTO member(id,user_id,organization_id,role,status,created_at) VALUES ($1,$2,$3,'admin','approved',now()),($4,$5,$3,'owner','approved',now())",
			[`${person}-member`, person, org, `${owner}-member`, owner],
		);
		const ctx = await auth.$context;
		await pool.query(
			"INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES ($1,$2,'credential',$2,$3,now(),now())",
			[`${person}-credential`, person, await ctx.password.hash(password)],
		);
		const response = await request("/sign-in/email", {
			email: `${person}@example.test`,
			password,
		});
		expect(response.status).toBe(200);
	});
	afterAll(cleanup);
	async function request(path: string, body?: unknown) {
		const response = await auth.handler(
			new Request(`${origin}/api/auth${path}`, {
				method: body ? "POST" : "GET",
				headers: {
					origin,
					"content-type": "application/json",
					...(cookie ? { cookie } : {}),
				},
				...(body ? { body: JSON.stringify(body) } : {}),
			}),
		);
		const cookies = response.headers.getSetCookie();
		for (const value of cookies)
			if (
				value.startsWith("better-auth.session_token=") &&
				!value.startsWith("better-auth.session_token=;")
			)
				cookie = value.split(";")[0];
		return response;
	}
	async function subject() {
		const signed = await auth.api.getSession({
			headers: new Headers({ cookie }),
		});
		if (!signed) throw new Error("fixture sign-in missing");
		return signed.session;
	}
	async function enroll() {
		const enabled = await request("/two-factor/enable", { password });
		expect(enabled.status).toBe(200);
		const registration = await enabled.json();
		expect(await readLocalMfaProof(await subject())).toBeNull();
		const row = await pool.query(
			"SELECT secret FROM two_factor WHERE user_id=$1",
			[person],
		);
		const ctx = await auth.$context;
		const secret = await symmetricDecrypt({
			key: ctx.secretConfig,
			data: row.rows[0].secret,
		});
		const code = (await auth.api.generateTOTP({ body: { secret } })).code;
		const verified = await request("/two-factor/verify-totp", { code });
		expect(verified.status).toBe(200);
		return { secret, backupCodes: registration.backupCodes as string[] };
	}
	const policy = {
		organizationId: org,
		enabled: true,
		gracePeriodDays: 0,
		recoveryAcknowledged: true,
		soleAdminLockoutAcknowledged: true,
	};
	it("rejects password-only/stale/unauthorized policy changes and accepts recent actual TOTP", async () => {
		await expect(
			updateOrganizationMfaPolicy(await subject(), policy),
		).rejects.toThrow("MFA_RECENT_VERIFICATION_REQUIRED");
		await enroll();
		const actor = await subject();
		expect(await readLocalMfaProof(actor)).toMatchObject({ method: "totp" });
		await updateOrganizationMfaPolicy(actor, policy);
		expect(
			(await getOrganizationMfaRequirement(actor, org, false)).allowed,
		).toBe(true);
		await expect(
			updateOrganizationMfaPolicy(actor, {
				...policy,
				organizationId: "another-tenant",
			}),
		).rejects.toThrow();
		await pool.query(
			"UPDATE member SET role='member' WHERE user_id=$1 AND organization_id=$2",
			[person, org],
		);
		await expect(updateOrganizationMfaPolicy(actor, policy)).rejects.toThrow(
			"owner or admin",
		);
		await pool.query(
			"UPDATE member SET role='admin' WHERE user_id=$1 AND organization_id=$2",
			[person, org],
		);
		await pool.query(
			"UPDATE session_mfa_proof SET verified_at=now()-interval '6 minutes' WHERE user_id=$1",
			[person],
		);
		await expect(updateOrganizationMfaPolicy(actor, policy)).rejects.toThrow(
			"MFA_RECENT_VERIFICATION_REQUIRED",
		);
	});
	it("uses backup codes once for recovery only and allows an explicitly verified replacement", async () => {
		const enrollment = await enroll();
		await updateOrganizationMfaPolicy(await subject(), policy);
		expect(
			(
				await request(
					`/organization/get-full-organization?organizationId=${org}`,
				)
			).status,
		).toBe(200);
		expect(
			(await request("/organization-mfa/verify-password", { password })).status,
		).toBe(200);
		const backup = enrollment.backupCodes[0];
		const recovered = await request("/two-factor/verify-backup-code", {
			code: backup,
		});
		expect(recovered.status).toBe(200);
		expect(await readLocalMfaProof(await subject())).toBeNull();
		const blocked = await request(
			`/organization/get-full-organization?organizationId=${org}`,
		);
		expect(blocked.status).toBe(403);
		expect(await blocked.json()).toMatchObject({ code: "MFA_REQUIRED" });
		await request("/organization-mfa/verify-password", { password });
		expect(
			(await request("/two-factor/verify-backup-code", { code: backup }))
				.status,
		).toBeGreaterThanOrEqual(400);
		const code = (
			await auth.api.generateTOTP({ body: { secret: enrollment.secret } })
		).code;
		expect((await request("/two-factor/verify-totp", { code })).status).toBe(
			200,
		);
		expect(
			(
				await request(
					`/organization/get-full-organization?organizationId=${org}`,
				)
			).status,
		).toBe(200);
	});
	it("revokes evidence and remembered trust in the password mutation's transaction", async () => {
		await enroll();
		await updateOrganizationMfaPolicy(await subject(), policy);
		await pool.query(
			"INSERT INTO verification(id,identifier,value,expires_at,created_at,updated_at) VALUES ($1,$2,$3,'2099-01-01',now(),now())",
			["t1310-trust", "trust-device-t1310", person],
		);
		await pool.query(
			"UPDATE account SET password=$2 WHERE user_id=$1 AND provider_id='credential'",
			[
				person,
				await (await auth.$context).password.hash("replacement-password-1310"),
			],
		);
		expect(
			(await getOrganizationMfaRequirement(await subject(), org, false))
				.allowed,
		).toBe(false);
		expect(
			(
				await pool.query("SELECT id FROM verification WHERE identifier=$1", [
					"trust-device-t1310",
				])
			).rowCount,
		).toBe(0);
	});
	it("allows last-factor revocation and immediately denies protected access", async () => {
		await enroll();
		await updateOrganizationMfaPolicy(await subject(), policy);
		expect((await request("/two-factor/disable", { password })).status).toBe(
			200,
		);
		const response = await request(
			`/organization/get-full-organization?organizationId=${org}`,
		);
		expect(response.status).toBe(403);
	});
	it("cannot resurrect proof when TOTP verification races a password change", async () => {
		const enrollment = await enroll();
		await updateOrganizationMfaPolicy(await subject(), policy);
		await request("/organization-mfa/verify-password", { password });
		const code = (
			await auth.api.generateTOTP({ body: { secret: enrollment.secret } })
		).code;
		const [, changed] = await Promise.all([
			request("/two-factor/verify-totp", { code }),
			request("/change-password", {
				currentPassword: password,
				newPassword: "concurrent-replacement-1310",
			}),
		]);
		expect(changed.status).toBe(200);
		expect(await readLocalMfaProof(await subject())).toBeNull();
		expect(
			(await getOrganizationMfaRequirement(await subject(), org, false))
				.allowed,
		).toBe(false);
	});
	it("accepts only the current exact-organization SSO exemption even when SSO is optional", async () => {
		await pool.query(
			"INSERT INTO organization_mfa_policy(organization_id,enabled,grace_period_days,updated_by) VALUES ($1,true,0,$2)",
			[org, person],
		);
		const actor = await subject();
		await pool.query(
			"INSERT INTO sso_provider(id,issuer,user_id,provider_id,organization_id,domain,domain_verified) VALUES ($1,'https://idp.example.test',$2,$3,$4,'example.test',true)",
			[`${org}-sso`, person, `${org}-provider`, org],
		);
		await pool.query(
			"INSERT INTO enterprise_identity_setup(organization_id,provider_id,activated) VALUES ($1,$2,true)",
			[org, `${org}-provider`],
		);
		await pool.query(
			"INSERT INTO session_sso_provenance(session_id,user_id,organization_id,provider_id) VALUES ($1,$2,$3,$4)",
			[actor.id, person, org, `${org}-provider`],
		);
		const { getOrganizationAccessRequirement } = await import(
			"./organization-access"
		);
		expect(await getOrganizationAccessRequirement(actor, org)).toMatchObject({
			allowed: true,
			reason: "sso",
		});
		await pool.query(
			"UPDATE enterprise_identity_setup SET provider_id='wrong-provider' WHERE organization_id=$1",
			[org],
		);
		expect((await getOrganizationAccessRequirement(actor, org)).allowed).toBe(
			false,
		);
	});
	it("accepts fresh enrollment evidence from an aged session without refreshing the durable session", async () => {
		await pool.query(
			"INSERT INTO organization_mfa_policy(organization_id,enabled,grace_period_days,updated_by) VALUES ($1,true,0,$2)",
			[org, person],
		);
		const actor = await subject();
		await pool.query(
			"UPDATE session SET created_at=now()-interval '2 days' WHERE id=$1",
			[actor.id],
		);
		await pool.query(
			"UPDATE session_authentication SET verified_at=now()-interval '6 minutes' WHERE session_id=$1",
			[actor.id],
		);
		expect((await request("/passkey/generate-register-options")).status).toBe(
			403,
		);
		expect(
			(await request("/organization-mfa/verify-password", { password })).status,
		).toBe(200);
		const result = await request("/passkey/generate-register-options");
		expect(result.status).toBe(200);
		expect(await result.json()).toHaveProperty("challenge");
		expect(
			(
				await pool.query(
					"SELECT created_at < now()-interval '1 day' AS aged FROM session WHERE id=$1",
					[actor.id],
				)
			).rows[0].aged,
		).toBe(true);
	});
	it("keeps the actual get-session MFA hook inside the caller's database transaction", async () => {
		await pool.query(
			"INSERT INTO organization_mfa_policy(organization_id,enabled,grace_period_days,updated_by) VALUES ($1,true,0,$2)",
			[org, person],
		);
		const actor = await subject();
		await pool.query(
			"UPDATE session SET active_organization_id=$2 WHERE id=$1",
			[actor.id, org],
		);
		const { withMfaDatabase } = await import("./database-context");
		await expect(
			db.transaction((tx) =>
				withMfaDatabase(tx, async () => {
					const response = await request("/get-session");
					expect(await response.json()).toMatchObject({
						mfaRequired: { organizationId: org },
					});
					throw new Error("rollback session hook");
				}),
			),
		).rejects.toThrow("rollback session hook");
		expect(
			(
				await pool.query(
					"SELECT deadline FROM organization_mfa_window WHERE organization_id=$1 AND user_id=$2",
					[org, person],
				)
			).rows[0].deadline,
		).toBeNull();
		expect(
			(
				await pool.query(
					"SELECT id FROM audit_log WHERE organization_id=$1 AND action='mfa.access_denied'",
					[org],
				)
			).rowCount,
		).toBe(0);
	});
});
