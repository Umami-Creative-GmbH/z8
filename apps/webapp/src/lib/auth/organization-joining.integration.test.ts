/**
 * #1666 (spec #1664): email invitation acceptance and organization creation
 * join inside the auth transaction that writes the membership.
 *
 * A real Better Auth instance with the production coordination and the
 * production joining hooks serves both endpoints through the coordinated
 * `/api/auth` handler, as `src/app/api/auth/[...all]/route.ts` does. Only the
 * seat signal is replaced: it records what it was sent and whether the
 * membership was already committed when it ran.
 */

import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { bearer } from "better-auth/plugins/bearer";
import { organization } from "better-auth/plugins/organization";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	seatSignals: [] as {
		organizationId: string;
		memberId: string;
		userId: string;
		memberCommitted: boolean;
	}[],
	notices: [] as unknown[],
	// biome-ignore lint/suspicious/noExplicitAny: the admin pool, assigned below.
	admin: null as any,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	reconcileBillingSeatsForOrganization: async () => undefined,
	syncBillingSeatsAfterMemberChange: async (signal: {
		organizationId: string;
		memberId: string;
		userId: string;
	}) => {
		// Seen from another connection: only a committed membership is visible.
		const { rows } = await harness.admin.query("select 1 from member where id = $1", [
			signal.memberId,
		]);
		harness.seatSignals.push({
			organizationId: signal.organizationId,
			memberId: signal.memberId,
			userId: signal.userId,
			memberCommitted: rows.length > 0,
		});
	},
}));

vi.mock("@/lib/notifications/notification-service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/notifications/notification-service")>()),
	createNotification: async (params: unknown) => {
		harness.notices.push(params);
		return null;
	},
}));

const { db } = await import("@/db");
const { captureAuthTransactions } = await import("@/lib/auth/auth-transaction");
const { createCoordinatedOrganizationHooks, handleCoordinatedAuthRequest } = await import(
	"@/lib/auth/auth-mutation-coordination"
);
const { AUTH_ORGANIZATION_SCHEMA } = await import("@/lib/auth/auth-schema-options");
const { joinOnAcceptedInvitation, joinOnAddedMember } = await import(
	"@/lib/auth/organization-joining-hooks"
);
const { authDatabaseSchema } = await import("@/lib/auth-database-schema");

const origin = "http://localhost:3000";
const organizationId = "t1666-org";
const ownerUser = "t1666-owner";
const inviteeUser = "t1666-invitee";
const inviteeEmail = "t1666-invitee@example.test";
const creatorUser = "t1666-creator";
const createdSlug = "t1666-created-org";
const token = (userId: string) => `${userId}-session-token`;

describe("joining inside the auth transaction (#1666)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	harness.admin = admin;

	const auth = betterAuth({
		baseURL: origin,
		secret: "t1666-organization-joining-integration-secret",
		database: drizzleAdapter(captureAuthTransactions(db), {
			provider: "pg",
			schema: authDatabaseSchema,
			transaction: true,
		}),
		session: { cookieCache: { enabled: false } },
		plugins: [
			bearer(),
			organization({
				allowUserToCreateOrganization: async () => true,
				creatorRole: "owner",
				schema: AUTH_ORGANIZATION_SCHEMA,
				organizationHooks: createCoordinatedOrganizationHooks({
					beforeUpdateOrganization: async () => undefined,
					beforeCreateInvitation: async () => undefined,
					joinOnAcceptedInvitation,
					joinOnAddedMember,
				}),
			}),
		],
	});

	const post = (path: string, userId: string, body: unknown) =>
		handleCoordinatedAuthRequest(
			auth.$context,
			new Request(`${origin}/api/auth${path}`, {
				method: "POST",
				headers: {
					origin,
					authorization: `Bearer ${token(userId)}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			}),
			(request) => auth.handler(request),
		);

	let teamId: string;
	let draftTeamId: string;

	async function cleanup() {
		await admin.query("drop trigger if exists t1666_fail_joining on employee");
		await admin.query("drop function if exists t1666_fail_joining()");
		await admin.query("delete from organization where id = $1 or slug = $2", [
			organizationId,
			createdSlug,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ownerUser, inviteeUser, creatorUser],
		]);
	}

	async function seed() {
		await cleanup();
		await admin.query(
			`insert into "user" (id, name, email, email_verified, role, can_create_organizations,
			   created_at, updated_at)
			 values ($1, 'T1666 owner', 't1666-owner@example.test', true, 'user', false, now(), now()),
			        ($2, 'T1666 invitee', $4, true, 'user', false, now(), now()),
			        ($3, 'T1666 creator', 't1666-creator@example.test', true, 'user', true, now(), now())`,
			[ownerUser, inviteeUser, creatorUser, inviteeEmail],
		);
		await admin.query(
			`insert into session (id, token, user_id, expires_at, created_at, updated_at)
			 select u || '-session', u || '-session-token', u, now() + interval '1 day', now(), now()
			 from unnest($1::text[]) as u`,
			[[ownerUser, inviteeUser, creatorUser]],
		);
		await admin.query(
			"insert into organization (id, name, slug, created_at) values ($1, $1, $1, now())",
			[organizationId],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t1666-owner-member', $1, $2, 'owner', 'approved', now())`,
			[organizationId, ownerUser],
		);
		const { rows } = await admin.query<{ id: string; name: string }>(
			`insert into team (organization_id, name, updated_at)
			 values ($1, 'Invitation team', now()), ($1, 'Draft team', now()) returning id, name`,
			[organizationId],
		);
		teamId = rows.find((row) => row.name === "Invitation team")?.id as string;
		draftTeamId = rows.find((row) => row.name === "Draft team")?.id as string;
		harness.seatSignals.length = 0;
		harness.notices.length = 0;
	}

	async function invite(
		role: "member" | "admin",
		options: { canCreateOrganizations?: boolean; draftRole?: string } = {},
	) {
		const invitationId = randomUUID();
		await admin.query(
			`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id,
			   can_create_organizations, target_team_id)
			 values ($1, $2, $3, $4, 'pending', now() + interval '7 days', $5, $6, $7)`,
			[
				invitationId,
				organizationId,
				inviteeEmail,
				role,
				ownerUser,
				options.canCreateOrganizations ?? false,
				teamId,
			],
		);
		if (!options.draftRole) return { invitationId, draftId: null };
		const { rows } = await admin.query<{ id: string }>(
			`insert into employee_invitation_draft
			   (invitation_id, organization_id, normalized_email, team_id, role, first_name)
			 values ($1, $2, $3, $4, $5, 'Ada') returning id`,
			[invitationId, organizationId, inviteeEmail, draftTeamId, options.draftRole],
		);
		return { invitationId, draftId: rows[0]?.id as string };
	}

	const accept = (invitationId: string) =>
		post("/organization/accept-invitation", inviteeUser, { invitationId });

	async function membersOf(orgId: string | null, userId: string) {
		const { rows } = await admin.query<{ id: string; role: string }>(
			"select id, role from member where organization_id = $1 and user_id = $2",
			[orgId, userId],
		);
		return rows;
	}

	async function employeesOf(orgId: string | null, userId: string) {
		const { rows } = await admin.query(
			`select e.role, e.is_active, e.team_id,
			   (select count(*)::int from team_permissions p
			      where p.employee_id = e.id and p.team_id is null) as org_wide_permissions,
			   (select coalesce(array_agg(m.team_id::text), '{}') from team_membership m
			      where m.employee_id = e.id) as team_memberships
			 from employee e where e.organization_id = $1 and e.user_id = $2`,
			[orgId, userId],
		);
		return rows;
	}

	async function userFields(userId: string) {
		const { rows } = await admin.query<{
			can_create_organizations: boolean;
			invited_via: string | null;
		}>('select can_create_organizations, invited_via from "user" where id = $1', [userId]);
		return rows[0];
	}

	async function invitationStatus(invitationId: string) {
		const { rows } = await admin.query<{ status: string }>(
			"select status from invitation where id = $1",
			[invitationId],
		);
		return rows[0]?.status;
	}

	/** The invitee worked here before; their departure took effect (migration 0073). */
	async function seedDepartedInvitee() {
		const employeeId = randomUUID();
		const employmentPeriodId = randomUUID();
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, start_date, updated_at)
			 values ($1, $2, $3, 'employee', false, '2025-01-01', now())`,
			[employeeId, inviteeUser, organizationId],
		);
		await admin.query(
			`insert into employee_employment_period
			 (id, organization_id, employee_id, status, started_at, ended_at, start_provenance)
			 values ($1, $2, $3, 'closed', '2025-01-01T08:00:00Z', '2026-01-07T08:00:00Z', 'recorded')`,
			[employmentPeriodId, organizationId, employeeId],
		);
		await admin.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status, effective_at)
			 values ($1, $2, $3, 'immediate', '2026-01-06', 'UTC', '2026-01-07T08:00:00Z', $4,
			         gen_random_uuid(), 'test', 1, 'effective', '2026-01-07T08:00:00Z')`,
			[organizationId, employeeId, employmentPeriodId, ownerUser],
		);
		return employeeId;
	}

	async function draftExists(draftId: string) {
		const { rows } = await admin.query("select 1 from employee_invitation_draft where id = $1", [
			draftId,
		]);
		return rows.length > 0;
	}

	/** Every employee insert for this suite's users fails, so joining fails. */
	async function failJoining() {
		await admin.query(`
			create or replace function t1666_fail_joining() returns trigger language plpgsql as $$
			begin raise exception 't1666 injected joining failure'; end $$`);
		await admin.query(`
			create trigger t1666_fail_joining before insert on employee
			for each row when (new.user_id like 't1666-%') execute function t1666_fail_joining()`);
	}

	beforeEach(seed);
	afterAll(cleanup);

	describe("email invitation acceptance", () => {
		it("commits the membership and its employee together, placed in the invitation's team", async () => {
			const { invitationId } = await invite("member", { canCreateOrganizations: true });

			const response = await accept(invitationId);

			expect(response.status).toBe(200);
			const [member] = await membersOf(organizationId, inviteeUser);
			expect(member).toMatchObject({ role: "member" });
			expect(await employeesOf(organizationId, inviteeUser)).toEqual([
				{
					role: "employee",
					is_active: true,
					team_id: teamId,
					org_wide_permissions: 0,
					team_memberships: [teamId],
				},
			]);
			expect(await userFields(inviteeUser)).toEqual({
				can_create_organizations: true,
				invited_via: invitationId,
			});
			expect(harness.seatSignals).toEqual([
				{ organizationId, memberId: member?.id, userId: inviteeUser, memberCommitted: true },
			]);
		});

		it("applies the invitation draft and discards it only after the commit", async () => {
			const { invitationId, draftId } = await invite("admin", { draftRole: "manager" });

			const response = await accept(invitationId);

			expect(response.status).toBe(200);
			expect(await employeesOf(organizationId, inviteeUser)).toEqual([
				{
					role: "manager",
					is_active: true,
					team_id: draftTeamId,
					org_wide_permissions: 1,
					team_memberships: [draftTeamId],
				},
			]);
			expect(await draftExists(draftId as string)).toBe(false);
			expect(harness.seatSignals).toEqual([
				expect.objectContaining({ userId: inviteeUser, memberCommitted: true }),
			]);
		});

		it("rolls the membership back when joining fails", async () => {
			const { invitationId, draftId } = await invite("member", {
				canCreateOrganizations: true,
				draftRole: "manager",
			});
			await failJoining();

			const response = await accept(invitationId);

			expect(response.status).toBeGreaterThanOrEqual(400);
			expect(await membersOf(organizationId, inviteeUser)).toEqual([]);
			expect(await employeesOf(organizationId, inviteeUser)).toEqual([]);
			expect(await invitationStatus(invitationId)).toBe("pending");
			expect(await userFields(inviteeUser)).toEqual({
				can_create_organizations: false,
				invited_via: null,
			});
			expect(await draftExists(draftId as string)).toBe(true);
			expect(harness.seatSignals).toEqual([]);
		});

		it("tells the inviter when the invitee is a former employee who needs a rehire (#1672)", async () => {
			const employeeId = await seedDepartedInvitee();
			const { invitationId } = await invite("member");

			const response = await accept(invitationId);

			expect(response.status).toBe(200);
			expect(await membersOf(organizationId, inviteeUser)).toHaveLength(1);
			expect(await employeesOf(organizationId, inviteeUser)).toEqual([
				expect.objectContaining({ is_active: false, team_id: null }),
			]);
			expect(harness.notices).toEqual([
				expect.objectContaining({
					userId: ownerUser,
					organizationId,
					type: "former_employee_needs_rehire",
					entityId: employeeId,
				}),
			]);
		});

		it("tells nobody when the invitee joins as a new employee (#1672)", async () => {
			const { invitationId } = await invite("member");

			await accept(invitationId);

			expect(harness.notices).toEqual([]);
		});
	});

	describe("organization creation", () => {
		const create = () =>
			post("/organization/create", creatorUser, { name: "T1666 created", slug: createdSlug });

		async function createdOrganizationId() {
			const { rows } = await admin.query<{ id: string }>(
				"select id from organization where slug = $1",
				[createdSlug],
			);
			return rows[0]?.id ?? null;
		}

		it("commits the owner membership and an admin employee together", async () => {
			const response = await create();

			expect(response.status).toBe(200);
			const createdId = await createdOrganizationId();
			const [member] = await membersOf(createdId, creatorUser);
			expect(member).toMatchObject({ role: "owner" });
			expect(await employeesOf(createdId, creatorUser)).toEqual([
				{
					role: "admin",
					is_active: true,
					team_id: null,
					org_wide_permissions: 1,
					team_memberships: [],
				},
			]);
			expect(harness.seatSignals).toEqual([
				{
					organizationId: createdId,
					memberId: member?.id,
					userId: creatorUser,
					memberCommitted: true,
				},
			]);
		});

		it("creates nothing when joining fails", async () => {
			await failJoining();

			const response = await create();

			expect(response.status).toBeGreaterThanOrEqual(400);
			expect(await createdOrganizationId()).toBeNull();
			const { rows } = await admin.query("select 1 from member where user_id = $1", [creatorUser]);
			expect(rows).toEqual([]);
			expect(harness.seatSignals).toEqual([]);
		});
	});
});
