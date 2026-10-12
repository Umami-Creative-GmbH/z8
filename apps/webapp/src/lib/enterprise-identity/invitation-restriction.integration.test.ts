/**
 * #1024 runtime evidence: the enterprise identity "Restrict invites" rule holds
 * on Better Auth's own `/organization/invite-member` endpoint, not only in the
 * settings server actions.
 *
 * A real Better Auth instance with the production organization hooks and the
 * resend guard serves the request through the coordinated `/api/auth` handler,
 * as `src/app/api/auth/[...all]/route.ts` does. Invitation creation and resend
 * are separate branches of that endpoint: only creation runs
 * `beforeCreateInvitation`, so both are exercised.
 */

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { bearer } from "better-auth/plugins/bearer";
import { organization } from "better-auth/plugins/organization";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

const { db } = await import("@/db");
const { captureAuthTransactions } = await import("@/lib/auth/auth-transaction");
const { createCoordinatedOrganizationHooks, handleCoordinatedAuthRequest } = await import(
	"@/lib/auth/auth-mutation-coordination"
);
const { authDatabaseSchema } = await import("@/lib/auth-database-schema");
const { enterpriseIdentityInvitationResendPlugin, refuseInvitationOutsideEnterpriseIdentity } =
	await import("@/lib/enterprise-identity/invitation-restriction");

const origin = "http://localhost:3000";
const restrictedOrg = "t1024-restricted-org";
const openOrg = "t1024-open-org";
const adminUser = "t1024-admin";
const strangerUser = "t1024-stranger";
const adminToken = `${adminUser}-session-token`;
const strangerToken = `${strangerUser}-session-token`;
const legacyInvitation = "t1024-legacy-invitation";
const legacyEmail = "legacy@other.test";
const legacyExpiresAt = new Date("2099-01-01T00:00:00Z");

describe("enterprise identity invite restriction on the Better Auth endpoint", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	const auth = betterAuth({
		baseURL: origin,
		secret: "t1024-invitation-restriction-integration-secret",
		database: drizzleAdapter(captureAuthTransactions(db), {
			provider: "pg",
			schema: authDatabaseSchema,
			transaction: true,
		}),
		session: { cookieCache: { enabled: false } },
		plugins: [
			bearer(),
			organization({
				creatorRole: "owner",
				organizationHooks: createCoordinatedOrganizationHooks({
					beforeUpdateOrganization: async () => undefined,
					beforeCreateInvitation: refuseInvitationOutsideEnterpriseIdentity,
					afterAcceptInvitation: async () => undefined,
					afterAddMember: async () => undefined,
				}),
			}),
			enterpriseIdentityInvitationResendPlugin(),
		],
	});

	const inviteOverHttp = (body: Record<string, unknown>, token = adminToken) =>
		handleCoordinatedAuthRequest(
			auth.$context,
			new Request(`${origin}/api/auth/organization/invite-member`, {
				method: "POST",
				headers: {
					origin,
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ role: "member", ...body }),
			}),
			(request) => auth.handler(request),
		);

	async function invitationsFor(organizationId: string, email: string) {
		const { rows } = await admin.query<{ id: string; expires_at: Date }>(
			"select id, expires_at from invitation where organization_id = $1 and email = $2",
			[organizationId, email],
		);
		return rows;
	}

	async function expectLegacyInvitationUntouched() {
		expect(await invitationsFor(restrictedOrg, legacyEmail)).toEqual([
			{ id: legacyInvitation, expires_at: legacyExpiresAt },
		]);
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[restrictedOrg, openOrg],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [[adminUser, strangerUser]]);
	}

	async function seed() {
		await cleanup();
		await admin.query(
			`insert into "user" (id, name, email, email_verified, role, created_at, updated_at)
			 values ($1, 'T1024 admin', 't1024-admin@corp.test', true, 'user', now(), now()),
			        ($2, 'T1024 stranger', 't1024-stranger@corp.test', true, 'user', now(), now())`,
			[adminUser, strangerUser],
		);
		await admin.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, $1, $1, now()), ($2, $2, $2, now())`,
			[restrictedOrg, openOrg],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, created_at)
			 values ('t1024-admin-restricted', $1, $3, 'admin', now()),
			        ('t1024-admin-open', $2, $3, 'admin', now())`,
			[restrictedOrg, openOrg, adminUser],
		);
		await admin.query(
			`insert into enterprise_identity_setup (organization_id, domain, enforcement, activated)
			 values ($1, 'corp.test',
			   '{"ssoRequired":false,"domainRestrictionEnabled":false,"inviteRestrictionEnabled":true}'::jsonb,
			   true)`,
			[restrictedOrg],
		);
		// Created before the restriction was switched on.
		await admin.query(
			`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
			 values ($1, $2, $3, 'member', 'pending', $4, $5)`,
			[legacyInvitation, restrictedOrg, legacyEmail, legacyExpiresAt, adminUser],
		);
		await admin.query(
			`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
			 values ('t1024-admin-session', $1, $2, $3, now() + interval '1 day', now(), now()),
			        ('t1024-stranger-session', $4, $5, null, now() + interval '1 day', now(), now())`,
			[adminToken, adminUser, restrictedOrg, strangerToken, strangerUser],
		);
	}

	beforeEach(seed);
	afterAll(cleanup);

	describe("new invitations", () => {
		it("refuses an address outside the enterprise identity domain", async () => {
			const response = await inviteOverHttp({
				organizationId: restrictedOrg,
				email: "Outsider@Other.test",
			});

			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				message: expect.stringContaining("corp.test"),
			});
			expect(await invitationsFor(restrictedOrg, "outsider@other.test")).toEqual([]);
		});

		it("refuses on the server-side call the settings actions use", async () => {
			await expect(
				auth.api.createInvitation({
					headers: new Headers({ authorization: `Bearer ${adminToken}` }),
					body: { organizationId: restrictedOrg, email: "outsider@other.test", role: "member" },
				}),
			).rejects.toMatchObject({ statusCode: 400 });
			expect(await invitationsFor(restrictedOrg, "outsider@other.test")).toEqual([]);
		});

		it("allows an address in the enterprise identity domain", async () => {
			const response = await inviteOverHttp({
				organizationId: restrictedOrg,
				email: "colleague@corp.test",
			});

			expect(response.status).toBe(200);
			expect(await invitationsFor(restrictedOrg, "colleague@corp.test")).toHaveLength(1);
		});

		it("leaves organizations without the restriction alone", async () => {
			const response = await inviteOverHttp({
				organizationId: openOrg,
				email: "outsider@other.test",
			});

			expect(response.status).toBe(200);
			expect(await invitationsFor(openOrg, "outsider@other.test")).toHaveLength(1);
		});
	});

	describe("resending a pending invitation", () => {
		it("refuses an address outside the enterprise identity domain", async () => {
			const response = await inviteOverHttp({
				organizationId: restrictedOrg,
				email: legacyEmail,
				resend: true,
			});

			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				message: expect.stringContaining("corp.test"),
			});
			await expectLegacyInvitationUntouched();
		});

		it("refuses for the session's active organization when the body names none", async () => {
			const response = await inviteOverHttp({ email: legacyEmail, resend: true });

			expect(response.status).toBe(400);
			await expectLegacyInvitationUntouched();
		});

		it("refuses on the server-side call the settings actions use", async () => {
			await expect(
				auth.api.createInvitation({
					headers: new Headers({ authorization: `Bearer ${adminToken}` }),
					body: {
						organizationId: restrictedOrg,
						email: legacyEmail,
						role: "member",
						resend: true,
					},
				}),
			).rejects.toMatchObject({ statusCode: 400 });
			await expectLegacyInvitationUntouched();
		});

		it("leaves a non-member's request to Better Auth without naming the domain", async () => {
			const response = await inviteOverHttp(
				{ organizationId: restrictedOrg, email: legacyEmail, resend: true },
				strangerToken,
			);

			expect(response.status).toBe(400);
			expect(JSON.stringify(await response.json())).not.toContain("corp.test");
			await expectLegacyInvitationUntouched();
		});
	});
});
