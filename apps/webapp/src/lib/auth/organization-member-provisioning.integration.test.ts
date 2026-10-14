/**
 * #1185: accepting an invitation consumes its employee invitation draft in
 * PostgreSQL. The cleanup's `exists` subqueries were raw `sql` chunks, which
 * Drizzle renders without parentheses (`exists select 1 …`). PostgreSQL
 * rejected the delete, the error was logged and swallowed, and every draft
 * survived its accepted invitation.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { db } = await import("@/db");
const { ensureEmployeeForOrganizationMember, ensureEmployeeProfilesForOrganizationMembers } =
	await import("@/lib/auth/organization-member-provisioning");

const acceptingOrg = "t1185-accepting-org";
const otherOrg = "t1185-other-org";
const inviterUser = "t1185-inviter";
const inviteeUser = "t1185-invitee";
const inviteeEmail = "t1185-invitee@example.test";
const acceptedInvitation = "t1185-accepted-invitation";
const otherOrgInvitation = "t1185-other-org-invitation";

describe("employee invitation draft cleanup in PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function draftsFor(organizationId: string) {
		const { rows } = await admin.query<{ invitation_id: string }>(
			"select invitation_id from employee_invitation_draft where organization_id = $1",
			[organizationId],
		);
		return rows.map((row) => row.invitation_id);
	}

	async function cleanup() {
		await admin.query("delete from employee where organization_id = any($1::text[])", [
			[acceptingOrg, otherOrg],
		]);
		await admin.query("delete from organization where id = any($1::text[])", [
			[acceptingOrg, otherOrg],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[inviterUser, inviteeUser],
		]);
	}

	async function seed() {
		await cleanup();
		await admin.query(
			`insert into "user" (id, name, email, email_verified, role, created_at, updated_at)
			 values ($1, 'T1185 inviter', 't1185-inviter@example.test', true, 'user', now(), now()),
			        ($2, 'T1185 invitee', $3, true, 'user', now(), now())`,
			[inviterUser, inviteeUser, inviteeEmail],
		);
		await admin.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, $1, $1, now()), ($2, $2, $2, now())`,
			[acceptingOrg, otherOrg],
		);
		await admin.query(
			`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
			 values ($1, $2, $4, 'member', 'accepted', now() + interval '7 days', $5),
			        ($3, $6, $4, 'member', 'accepted', now() + interval '7 days', $5)`,
			[acceptedInvitation, acceptingOrg, otherOrgInvitation, inviteeEmail, inviterUser, otherOrg],
		);
		await admin.query(
			`insert into employee_invitation_draft
			   (invitation_id, organization_id, normalized_email, first_name, last_name, position)
			 values ($1, $2, $3, 'Ada', 'Lovelace', 'Analyst'),
			        ($4, $5, $3, 'Ada', 'Lovelace', 'Analyst')`,
			[acceptedInvitation, acceptingOrg, inviteeEmail, otherOrgInvitation, otherOrg],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, created_at)
			 values ('t1185-invitee-member', $1, $2, 'member', now())`,
			[acceptingOrg, inviteeUser],
		);
		// The other organization's draft is consumable on its own terms (accepted
		// invitation, existing employee): only organization scoping keeps it.
		await admin.query(
			"insert into employee (user_id, organization_id, updated_at) values ($1, $2, now())",
			[inviteeUser, otherOrg],
		);
	}

	beforeEach(seed);
	afterAll(cleanup);

	it("deletes the draft once its invitation is accepted", async () => {
		const provisioned = await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: inviteeUser,
			organizationId: acceptingOrg,
			memberRole: "member",
			invitationId: acceptedInvitation,
		});

		expect(provisioned).toMatchObject({
			userId: inviteeUser,
			organizationId: acceptingOrg,
			position: "Analyst",
		});
		expect(await draftsFor(acceptingOrg)).toEqual([]);
		expect(await draftsFor(otherOrg)).toEqual([otherOrgInvitation]);
	});

	it("deletes a draft found by email when its linked invitation is stale", async () => {
		await admin.query(
			`update invitation set status = 'pending', expires_at = now() - interval '1 day'
			 where id = $1`,
			[acceptedInvitation],
		);

		// A direct member add carries no invitation id, so the draft is matched by email.
		await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: inviteeUser,
			organizationId: acceptingOrg,
			memberRole: "member",
		});

		expect(await draftsFor(acceptingOrg)).toEqual([]);
		expect(await draftsFor(otherOrg)).toEqual([otherOrgInvitation]);
	});

	it("keeps a draft whose linked invitation is still pending", async () => {
		await admin.query("update invitation set status = 'pending' where id = $1", [
			acceptedInvitation,
		]);

		await ensureEmployeeProfilesForOrganizationMembers(db, acceptingOrg);

		expect(await draftsFor(acceptingOrg)).toEqual([acceptedInvitation]);
	});

	it("reconciling one organization consumes only that organization's drafts", async () => {
		await ensureEmployeeProfilesForOrganizationMembers(db, acceptingOrg);

		expect(await draftsFor(acceptingOrg)).toEqual([]);
		expect(await draftsFor(otherOrg)).toEqual([otherOrgInvitation]);
	});
});
