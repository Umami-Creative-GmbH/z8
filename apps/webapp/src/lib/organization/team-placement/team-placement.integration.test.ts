/**
 * #1594: team placement is the only writer of team memberships and the Team field. Every change
 * keeps the primary team among the memberships (Organization ADR 0010, #1575), and a change of
 * the primary team ends the driving authorizations of an employee who stops being an intended
 * driver (Organization ADR 0005, #1425). Runs on PostgreSQL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const session = vi.hoisted(() => ({ userId: "", organizationId: "" }));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: session.userId, role: "user", email: "owner@example.test" },
				session: {
					id: "test-session",
					userId: session.userId,
					activeOrganizationId: session.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () =>
		session.userId
			? {
					user: { id: session.userId },
					session: { activeOrganizationId: session.organizationId },
				}
			: null,
}));
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original),
);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const { db } = await import("@/db");
const { withAuthorizationMutation } = await import(
	"@/lib/authorization/authorization-mutation"
);
const { DrivingLicenceStalePreviewError } = await import(
	"../driving-licence/stale-preview"
);
const { ensureEmployeeForOrganizationMember } = await import(
	"@/lib/auth/organization-member-provisioning"
);
const placement = await import("./team-placement");
const policies = await import("../driving-licence/policy-actions");
const intendedDrivers = await import(
	"../driving-licence/intended-driver-actions"
);
const grants = await import("../driving-licence/verifier-actions");
const checks = await import("../driving-licence/check-actions");

type TeamChange = Parameters<typeof placement.applyTeamChange>[1];

let fixture: LifecycleDatabaseFixture;
let alex: SeededEmployee;
// Alphabetical by id: a < b < c.
let a: string;
let b: string;
let c: string;
const extraUsers: string[] = [];

async function seedTeam(name: string, organizationId = fixture.organizationId) {
	const { rows } = await fixture.pool.query<{ id: string }>(
		`insert into team (id, organization_id, name, updated_at) values ($1,$2,$3,now()) returning id`,
		[crypto.randomUUID(), organizationId, name],
	);
	return rows[0].id;
}
async function joinTeam(employeeId: string, teamId: string, primary = false) {
	await fixture.pool.query(
		`insert into team_membership (organization_id, team_id, employee_id) values ($1,$2,$3)`,
		[fixture.organizationId, teamId, employeeId],
	);
	if (primary)
		await fixture.pool.query(`update employee set team_id=$1 where id=$2`, [
			teamId,
			employeeId,
		]);
}
async function teamsOf(employeeId: string) {
	const [{ rows: memberships }, { rows: employees }] = await Promise.all([
		fixture.pool.query<{ team_id: string }>(
			"select team_id from team_membership where employee_id = $1 order by team_id",
			[employeeId],
		),
		fixture.pool.query<{ team_id: string | null }>(
			"select team_id from employee where id = $1",
			[employeeId],
		),
	]);
	return {
		primary: employees[0]?.team_id ?? null,
		memberships: memberships.map((row) => row.team_id),
	};
}

const viewer = () => ({ userId: fixture.ownerUserId, organizationAdmin: true });
function change(
	employee: SeededEmployee,
	kind: TeamChange["kind"],
	teamId: string | null,
) {
	return {
		organizationId: fixture.organizationId,
		employeeId: employee.employeeId,
		kind,
		teamId,
	} as TeamChange;
}
function apply(teamChange: TeamChange, previewToken?: string) {
	return withAuthorizationMutation(
		placement.teamChangeScope(teamChange),
		(tx) =>
			placement.applyTeamChange(tx, teamChange, {
				actorUserId: fixture.ownerUserId,
				viewer: viewer(),
				previewToken,
			}),
		db,
	);
}
function preview(teamChange: TeamChange) {
	return placement.previewTeamChange(db, teamChange, viewer());
}

beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	session.organizationId = fixture.organizationId;
	session.userId = fixture.ownerUserId;
	alex = await fixture.seedEmployee();
	const ids = [
		crypto.randomUUID(),
		crypto.randomUUID(),
		crypto.randomUUID(),
	].sort();
	[a, b, c] = ids;
	for (const [id, name] of [
		[a, "A"],
		[b, "B"],
		[c, "C"],
	]) {
		await fixture.pool.query(
			`insert into team (id, organization_id, name, updated_at) values ($1,$2,$3,now())`,
			[id, fixture.organizationId, name],
		);
	}
	// alex: primary team A, also a member of C.
	await joinTeam(alex.employeeId, a, true);
	await joinTeam(alex.employeeId, c);
});
afterEach(async () => {
	if (extraUsers.length) {
		await fixture.pool.query(
			"delete from employee where user_id = any($1::text[])",
			[extraUsers],
		);
		await fixture.pool.query(
			"delete from member where user_id = any($1::text[])",
			[extraUsers],
		);
		await fixture.pool.query('delete from "user" where id = any($1::text[])', [
			extraUsers,
		]);
		extraUsers.length = 0;
	}
	await fixture?.close();
});

describe("team changes keep the primary team among the memberships (ADR 0010)", () => {
	it("a move goes from A to B and keeps the other memberships", async () => {
		await apply(change(alex, "move", b));
		expect(await teamsOf(alex.employeeId)).toEqual({
			primary: b,
			memberships: [b, c],
		});
	});

	it("a move to no team ends the primary membership and makes the next remaining one primary", async () => {
		await apply(change(alex, "move", null));
		expect(await teamsOf(alex.employeeId)).toEqual({
			primary: c,
			memberships: [c],
		});
		await apply(change(alex, "move", null));
		expect(await teamsOf(alex.employeeId)).toEqual({
			primary: null,
			memberships: [],
		});
	});

	it("a move to the current team only adds its missing membership", async () => {
		await fixture.pool.query("delete from team_membership where team_id = $1", [
			a,
		]);
		await apply(change(alex, "move", a));
		expect(await teamsOf(alex.employeeId)).toEqual({
			primary: a,
			memberships: [a, c],
		});
	});

	it("refuses a team of another organization and changes nothing", async () => {
		const foreign = await seedTeam(
			"Foreign",
			await fixture.createOrganization(),
		);
		await expect(apply(change(alex, "move", foreign))).rejects.toBeInstanceOf(
			placement.TeamNotInOrganization,
		);
		await expect(
			apply(change(alex, "addMembership", foreign)),
		).rejects.toBeInstanceOf(placement.TeamNotInOrganization);
		expect(await teamsOf(alex.employeeId)).toEqual({
			primary: a,
			memberships: [a, c],
		});
	});

	it("adding a membership makes it primary only for an employee without a primary team", async () => {
		await apply(change(alex, "addMembership", b));
		expect(await teamsOf(alex.employeeId)).toEqual({
			primary: a,
			memberships: [a, b, c],
		});

		const blair = await fixture.seedEmployee();
		await apply(change(blair, "addMembership", b));
		expect(await teamsOf(blair.employeeId)).toEqual({
			primary: b,
			memberships: [b],
		});
	});

	it("removing the primary membership makes the first remaining one primary; another keeps it", async () => {
		await joinTeam(alex.employeeId, b);
		await apply(change(alex, "removeMembership", c));
		expect(await teamsOf(alex.employeeId)).toEqual({
			primary: a,
			memberships: [a, b],
		});
		await apply(change(alex, "removeMembership", a));
		expect(await teamsOf(alex.employeeId)).toEqual({
			primary: b,
			memberships: [b],
		});
		await apply(change(alex, "removeMembership", b));
		expect(await teamsOf(alex.employeeId)).toEqual({
			primary: null,
			memberships: [],
		});
	});
});

describe("arriving and leaving employees", () => {
	const place = (employeeId: string, teamId: string | null) =>
		db.transaction((tx) =>
			placement.placeArrivingEmployee(tx, {
				organizationId: fixture.organizationId,
				employeeId,
				teamId,
				createdBy: fixture.ownerUserId,
			}),
		);

	it("an arriving employee is placed in a team as a move", async () => {
		expect(await place(alex.employeeId, b)).toMatchObject({ primaryTeamId: b });
		expect(await teamsOf(alex.employeeId)).toEqual({
			primary: b,
			memberships: [b, c],
		});
	});

	it("a returning employee placed in no team, as a rehire without a team, ends the old primary membership", async () => {
		await place(alex.employeeId, null);
		expect(await teamsOf(alex.employeeId)).toEqual({
			primary: c,
			memberships: [c],
		});
	});

	it("a leaving employee ends every membership and has no primary team", async () => {
		const ended = await db.transaction((tx) =>
			placement.releaseLeavingEmployee(tx, {
				organizationId: fixture.organizationId,
				employeeId: alex.employeeId,
			}),
		);
		expect(ended.endedTeamIds.toSorted()).toEqual([a, c]);
		expect(await teamsOf(alex.employeeId)).toEqual({
			primary: null,
			memberships: [],
		});
	});

	it("an invited member joins their target team as a membership and primary team", async () => {
		const joiner = `t1594-joiner-${crypto.randomUUID()}`;
		extraUsers.push(joiner);
		await fixture.pool.query(
			`insert into "user" (id, name, email, email_verified, role, created_at, updated_at)
			 values ($1, 'T1594 joiner', $2, true, 'user', now(), now())`,
			[joiner, `${joiner}@example.test`],
		);
		await fixture.pool.query(
			"insert into member (id, organization_id, user_id, role, created_at) values ($1, $2, $3, 'member', now())",
			[`${joiner}-member`, fixture.organizationId, joiner],
		);
		const joined = await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: joiner,
			organizationId: fixture.organizationId,
			memberRole: "member",
			targetTeamId: b,
		});
		if (!joined) throw new Error("The invited member was not provisioned");
		expect(joined.teamId).toBe(b);
		expect(await teamsOf(joined.id)).toEqual({ primary: b, memberships: [b] });
	});

	it("a reactivated member moves to their invitation's team", async () => {
		await fixture.pool.query(
			"update employee set is_active = false where id = $1",
			[alex.employeeId],
		);
		const {
			rows: [{ email }],
		} = await fixture.pool.query<{ email: string }>(
			'select email from "user" where id = $1',
			[alex.userId],
		);
		const invitationId = `t1594-invitation-${crypto.randomUUID()}`;
		await fixture.pool.query(
			`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
			 values ($1, $2, $3, 'member', 'accepted', now() + interval '7 days', $4)`,
			[invitationId, fixture.organizationId, email, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into employee_invitation_draft (invitation_id, organization_id, normalized_email, team_id)
			 values ($1, $2, lower($3), $4)`,
			[invitationId, fixture.organizationId, email, b],
		);
		await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: alex.userId,
			organizationId: fixture.organizationId,
			memberRole: "member",
			invitationId,
		});
		expect(await teamsOf(alex.employeeId)).toEqual({
			primary: b,
			memberships: [b, c],
		});
	});
});

describe("a new primary team ends intended-driver status (ADR 0005)", () => {
	let verifier: SeededEmployee;

	function unwrap<T>(
		result: { success: true; data: T } | { success: false; error: string },
	) {
		if (!result.success) throw new Error(result.error);
		return result.data;
	}
	async function as<T>(userId: string, operation: () => Promise<T>) {
		const previous = session.userId;
		session.userId = userId;
		try {
			return await operation();
		} finally {
			session.userId = previous;
		}
	}
	type Target = { type: "organization" } | { type: "team"; teamId: string };
	async function assign(target: Target, value: "required" | "not_required") {
		const { previewToken } = unwrap(
			await intendedDrivers.previewDrivingLicenceIntendedDriverAssignmentAction(
				{ target, value },
			),
		);
		unwrap(
			await intendedDrivers.setDrivingLicenceIntendedDriverAssignmentAction({
				target,
				value,
				previewToken,
			}),
		);
	}
	async function check(employee: SeededEmployee, codes = ["B"]) {
		unwrap(
			await as(verifier.userId, () =>
				checks.completeDrivingLicenceCheckAction({
					employeeId: employee.employeeId,
					commandId: crypto.randomUUID(),
					originalInspected: true,
					identityConfirmed: true,
					employeeDeclaration: true,
					verifierConfirmed: true,
					documentIssuedOn: "2020-05-01",
					documentExpiresOn: "2035-05-01",
					classes: codes.map((code) => ({
						code,
						result: "successful",
						expiryDate: null,
						restrictions: "",
					})),
				}),
			),
		);
	}
	async function status(employee: SeededEmployee) {
		return unwrap(
			await as(verifier.userId, () =>
				checks.getDrivingLicenceEmployeeRecordAction({
					employeeId: employee.employeeId,
				}),
			),
		).status;
	}
	const ending = (employee: SeededEmployee) => ({
		employeeId: employee.employeeId,
		name: expect.any(String),
		classCodes: ["B"],
	});

	beforeEach(async () => {
		verifier = await fixture.seedEmployee();
		unwrap(
			await policies.switchDrivingLicenceControlAction({
				enabled: true,
				setup: {
					intervalMonths: 6,
					timezone: "Europe/Berlin",
					retentionMonths: 36,
					retentionJustification: "Organization driving evidence retention",
				},
			}),
		);
		unwrap(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: verifier.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			}),
		);
		// alex drives because their primary team A requires it.
		await assign({ type: "team", teamId: a }, "required");
		await check(alex);
		expect(await status(alex)).toBe("active");
	});

	const changesOfThePrimaryTeam: Array<[string, () => TeamChange]> = [
		["a move", () => change(alex, "move", b)],
		[
			"removing the primary membership",
			() => change(alex, "removeMembership", a),
		],
	];
	it.each(changesOfThePrimaryTeam)(
		"%s is warned about, refused with a stale warning, and ends the authorization when confirmed",
		async (_name, teamChange) => {
			const warning = await preview(teamChange());
			expect(warning).toEqual({
				detail: "full",
				employees: [ending(alex)],
				previewToken: expect.any(String),
			});
			expect(await status(alex)).toBe("active");

			await expect(apply(teamChange())).rejects.toBeInstanceOf(
				DrivingLicenceStalePreviewError,
			);
			await expect(
				apply(teamChange(), "not-the-warning"),
			).rejects.toBeInstanceOf(DrivingLicenceStalePreviewError);
			expect(await teamsOf(alex.employeeId)).toEqual({
				primary: a,
				memberships: [a, c],
			});

			await apply(teamChange(), warning.previewToken);
			expect(await status(alex)).toBe("not_enrolled");
		},
	);

	it("adding a first membership is warned about, refused with a stale warning, and ends the authorization", async () => {
		// carol drives through the organization default; team B excludes its members.
		const carol = await fixture.seedEmployee();
		await assign({ type: "organization" }, "required");
		await assign({ type: "team", teamId: b }, "not_required");
		await check(carol);

		const joining = change(carol, "addMembership", b);
		const warning = await preview(joining);
		expect(warning).toMatchObject({
			detail: "full",
			employees: [ending(carol)],
		});
		await expect(apply(joining)).rejects.toBeInstanceOf(
			DrivingLicenceStalePreviewError,
		);
		expect(await teamsOf(carol.employeeId)).toEqual({
			primary: null,
			memberships: [],
		});

		await apply(joining, warning.previewToken);
		expect(await status(carol)).toBe("not_enrolled");
	});

	const changesKeepingThePrimaryTeam: Array<[string, () => TeamChange]> = [
		["adding another membership", () => change(alex, "addMembership", b)],
		["removing another membership", () => change(alex, "removeMembership", c)],
		["a move to the current team", () => change(alex, "move", a)],
	];
	it("a save that keeps the team placement previews nothing ending", async () => {
		expect(
			await placement.previewUnchangedTeamPlacement(
				db,
				{ organizationId: fixture.organizationId, employeeId: alex.employeeId },
				viewer(),
			),
		).toMatchObject({ detail: "full", employees: [] });
	});

	it.each(changesKeepingThePrimaryTeam)(
		"%s ends nothing and ignores the warning token",
		async (_name, teamChange) => {
			expect(await preview(teamChange())).toMatchObject({
				detail: "full",
				employees: [],
			});
			await apply(teamChange(), "not-the-warning");
			expect(await status(alex)).toBe("active");
		},
	);
});
