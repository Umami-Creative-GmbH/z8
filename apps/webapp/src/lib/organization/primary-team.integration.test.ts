/**
 * #1575, Organization ADR 0010: every write keeps an employee's primary team among their team
 * memberships. Covers the shared write and an onboarding path (invitation provisioning).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { db } = await import("@/db");
const { teamMembership } = await import("@/db/schema");
const { placeInTeam, setPrimaryTeam, PrimaryTeamNotInOrganization } = await import(
	"./primary-team"
);
const { ensureEmployeeForOrganizationMember } = await import(
	"@/lib/auth/organization-member-provisioning"
);

const ORG = "t1575-org";
const OTHER_ORG = "t1575-other-org";
const USER = "t1575-user";
const JOINER = "t1575-joiner";
const id = (n: number) => `15750000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const EMPLOYEE = id(1);
// Alphabetical by id: A < B < C.
const A = id(11);
const B = id(12);
const C = id(13);
const FOREIGN = id(19);

describe("primary team is always a team membership (#1575)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from employee where organization_id = any($1::text[])", [
			[ORG, OTHER_ORG],
		]);
		await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER_ORG]]);
		await admin.query('delete from "user" where id = any($1::text[])', [[USER, JOINER]]);
	}

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			`insert into "user" (id, name, email, email_verified, role, created_at, updated_at)
			 values ($1, 'T1575 user', 't1575-user@example.test', true, 'user', now(), now()),
			        ($2, 'T1575 joiner', 't1575-joiner@example.test', true, 'user', now(), now())`,
			[USER, JOINER],
		);
		await admin.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, $1, $1, now()), ($2, $2, $2, now())`,
			[ORG, OTHER_ORG],
		);
		await admin.query(
			`insert into team (id, organization_id, name, updated_at)
			 values ($1, $5, 'A', now()), ($2, $5, 'B', now()), ($3, $5, 'C', now()),
			        ($4, $6, 'Foreign', now())`,
			[A, B, C, FOREIGN, ORG, OTHER_ORG],
		);
		await admin.query(
			"insert into employee (id, user_id, organization_id, team_id, updated_at) values ($1, $2, $3, $4, now())",
			[EMPLOYEE, USER, ORG, A],
		);
		await admin.query(
			`insert into team_membership (organization_id, team_id, employee_id)
			 values ($1, $2, $4), ($1, $3, $4)`,
			[ORG, A, C, EMPLOYEE],
		);
	});
	afterAll(cleanup);

	async function teamsOf(employeeId: string) {
		const [{ rows: memberships }, { rows: employees }] = await Promise.all([
			admin.query<{ team_id: string }>(
				"select team_id from team_membership where employee_id = $1 order by team_id",
				[employeeId],
			),
			admin.query<{ team_id: string | null }>("select team_id from employee where id = $1", [
				employeeId,
			]),
		]);
		return {
			primary: employees[0]?.team_id ?? null,
			memberships: memberships.map((row) => row.team_id),
		};
	}

	const set = (teamId: string | null) =>
		db.transaction((tx) =>
			setPrimaryTeam(tx, { organizationId: ORG, employeeId: EMPLOYEE, teamId, createdBy: USER }),
		);

	it("moves the employee from A to B and keeps their other memberships", async () => {
		await set(B);
		expect(await teamsOf(EMPLOYEE)).toEqual({ primary: B, memberships: [B, C] });
	});

	it("clearing ends the primary membership and makes the next remaining one primary", async () => {
		await set(null);
		expect(await teamsOf(EMPLOYEE)).toEqual({ primary: C, memberships: [C] });
		await set(null);
		expect(await teamsOf(EMPLOYEE)).toEqual({ primary: null, memberships: [] });
	});

	it("clearing a second-ranked primary team makes the first remaining membership primary", async () => {
		await set(C);
		expect(await teamsOf(EMPLOYEE)).toEqual({ primary: C, memberships: [C] });
		await db.transaction((tx) =>
			tx.insert(teamMembership).values({ organizationId: ORG, teamId: B, employeeId: EMPLOYEE }),
		);
		await set(null);
		expect(await teamsOf(EMPLOYEE)).toEqual({ primary: B, memberships: [B] });
	});

	it("setting the current team only adds its missing membership", async () => {
		await admin.query("delete from team_membership where team_id = $1", [A]);
		await set(A);
		expect(await teamsOf(EMPLOYEE)).toEqual({ primary: A, memberships: [A, C] });
	});

	it("placing in a team is a move; placing in no team changes nothing", async () => {
		const place = (teamId: string | null) =>
			db.transaction((tx) =>
				placeInTeam(tx, { organizationId: ORG, employeeId: EMPLOYEE, teamId }),
			);

		expect(await place(null)).toBeNull();
		expect(await teamsOf(EMPLOYEE)).toEqual({ primary: A, memberships: [A, C] });
		expect(await place(B)).toMatchObject({ primaryTeamId: B });
		expect(await teamsOf(EMPLOYEE)).toEqual({ primary: B, memberships: [B, C] });
	});

	it("refuses a team of another organization and changes nothing", async () => {
		await expect(set(FOREIGN)).rejects.toBeInstanceOf(PrimaryTeamNotInOrganization);
		expect(await teamsOf(EMPLOYEE)).toEqual({ primary: A, memberships: [A, C] });
	});

	it("an invited member joins their target team as a membership and primary team", async () => {
		await admin.query(
			"insert into member (id, organization_id, user_id, role, created_at) values ('t1575-joiner-member', $1, $2, 'member', now())",
			[ORG, JOINER],
		);
		const joined = await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: JOINER,
			organizationId: ORG,
			memberRole: "member",
			targetTeamId: B,
		});
		if (!joined) throw new Error("The invited member was not provisioned");
		expect(joined.teamId).toBe(B);
		expect(await teamsOf(joined.id)).toEqual({ primary: B, memberships: [B] });
	});

	it("a reactivated member moves to their invitation's team", async () => {
		await admin.query("update employee set is_active = false where id = $1", [EMPLOYEE]);
		await admin.query(
			"insert into member (id, organization_id, user_id, role, created_at) values ('t1575-user-member', $1, $2, 'member', now())",
			[ORG, USER],
		);
		await admin.query(
			`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
			 values ('t1575-invitation', $1, 't1575-user@example.test', 'member', 'accepted', now() + interval '7 days', $2)`,
			[ORG, JOINER],
		);
		await admin.query(
			`insert into employee_invitation_draft (invitation_id, organization_id, normalized_email, team_id)
			 values ('t1575-invitation', $1, 't1575-user@example.test', $2)`,
			[ORG, B],
		);
		await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: USER,
			organizationId: ORG,
			memberRole: "member",
			invitationId: "t1575-invitation",
		});
		expect(await teamsOf(EMPLOYEE)).toEqual({ primary: B, memberships: [B, C] });
	});
});
