/**
 * #1425 (spec #1418, Organization ADR 0005): an employee who stops being an intended driver
 * loses every current class authorization at once, through an assignment change, an exclusion
 * or a move to another primary team. A read-only preview lists exactly who loses which classes
 * before the save. Everything runs through the public actions and readers on PostgreSQL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const session = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-03-02T09:00:00Z",
}));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
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
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual = await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(session.now) },
	};
});
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const policies = await import("./policy-actions");
const intendedDrivers = await import("./intended-driver-actions");
const grants = await import("./verifier-actions");
const checks = await import("./check-actions");
const retention = await import("./retention-actions");
const { getUserNotifications } = await import("@/lib/notifications/notification-service");

const setup = {
	intervalMonths: 6,
	timezone: "Europe/Berlin",
	retentionMonths: 36,
	retentionJustification: "Organization driving evidence retention",
};
type Target =
	| { type: "organization" }
	| { type: "team"; teamId: string }
	| { type: "employee"; employeeId: string };

let fixture: LifecycleDatabaseFixture;
let verifier: SeededEmployee;
let alex: SeededEmployee;
let blair: SeededEmployee;
let drivers: string;
let office: string;

async function as<T>(userId: string, operation: () => Promise<T>) {
	const previous = session.userId;
	session.userId = userId;
	try {
		return await operation();
	} finally {
		session.userId = previous;
	}
}
async function seedTeam(name: string, organizationId = fixture.organizationId) {
	const id = crypto.randomUUID();
	await fixture.pool.query(
		`insert into team (id, organization_id, name, updated_at) values ($1,$2,$3,now())`,
		[id, organizationId, name],
	);
	return id;
}
async function joinTeam(employeeId: string, teamId: string, primary: boolean) {
	await fixture.pool.query(
		`insert into team_membership (organization_id, team_id, employee_id) values ($1,$2,$3)`,
		[fixture.organizationId, teamId, employeeId],
	);
	if (primary)
		await fixture.pool.query(`update employee set team_id=$1 where id=$2`, [teamId, employeeId]);
}
function unwrap<T>(result: { success: true; data: T } | { success: false; error: string }) {
	if (!result.success) throw new Error(result.error);
	return result.data;
}
function owner<T>(operation: () => Promise<T>) {
	return as(fixture.ownerUserId, operation);
}
async function previewAssign(target: Target, value: "required" | "not_required") {
	return unwrap(
		await owner(() =>
			intendedDrivers.previewDrivingLicenceIntendedDriverAssignmentAction({ target, value }),
		),
	);
}
async function assign(target: Target, value: "required" | "not_required", previewToken?: string) {
	return unwrap(
		await owner(() =>
			intendedDrivers.setDrivingLicenceIntendedDriverAssignmentAction({
				target,
				value,
				...(previewToken ? { previewToken } : {}),
			}),
		),
	).assignmentId;
}
async function previewRemove(assignmentId: string) {
	return unwrap(
		await owner(() =>
			intendedDrivers.previewDrivingLicenceIntendedDriverRemovalAction({ assignmentId }),
		),
	);
}
async function remove(assignmentId: string, previewToken?: string) {
	return unwrap(
		await owner(() =>
			intendedDrivers.removeDrivingLicenceIntendedDriverAssignmentAction({
				assignmentId,
				...(previewToken ? { previewToken } : {}),
			}),
		),
	);
}
async function check(employee: SeededEmployee, codes = ["B", "C"]) {
	return unwrap(
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
	).checkId;
}
async function record(employee: SeededEmployee) {
	return unwrap(
		await as(verifier.userId, () =>
			checks.getDrivingLicenceEmployeeRecordAction({ employeeId: employee.employeeId }),
		),
	);
}
async function status(employee: SeededEmployee) {
	return (await record(employee)).status;
}
/** No longer intended, with every class authorization ended for that reason. */
async function expectEnded(employee: SeededEmployee) {
	const after = await record(employee);
	expect(after.status).toBe("not_enrolled");
	expect(after.classes.length).toBeGreaterThan(0);
	for (const item of after.classes)
		expect([item.status, item.reason]).toEqual(["ended", "no_longer_intended"]);
}
async function endedNotices(userId: string) {
	const { notifications } = await getUserNotifications(userId, fixture.organizationId, {
		limit: 100,
	});
	return notifications
		.filter((n) => n.title === "Driving authorization ended")
		.map((n) => n.message);
}
function ending(employee: SeededEmployee, classCodes = ["B", "C"]) {
	return { employeeId: employee.employeeId, name: expect.any(String), classCodes };
}

beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	session.organizationId = fixture.organizationId;
	session.userId = fixture.ownerUserId;
	session.now = "2026-03-02T09:00:00Z";
	verifier = await fixture.seedEmployee();
	alex = await fixture.seedEmployee();
	blair = await fixture.seedEmployee();
	drivers = await seedTeam("Drivers");
	office = await seedTeam("Office");
	await joinTeam(alex.employeeId, drivers, true);
	await joinTeam(blair.employeeId, office, true);
	unwrap(await policies.switchDrivingLicenceControlAction({ enabled: true, setup }));
	unwrap(
		await grants.saveDrivingLicenceVerifierGrantAction({
			verifierEmployeeId: verifier.employeeId,
			scope: "all",
			teamIds: [],
			employeeIds: [],
		}),
	);
});
afterEach(async () => fixture?.close());

describe("assignment changes end the authorizations of employees who stop being intended drivers", () => {
	it("excludes an employee: the preview lists their classes, and the save ends exactly those", async () => {
		await assign({ type: "employee", employeeId: alex.employeeId }, "required");
		await check(alex);
		expect(await status(alex)).toBe("active");

		session.now = "2026-03-05T10:00:00Z";
		const preview = await previewAssign(
			{ type: "employee", employeeId: alex.employeeId },
			"not_required",
		);
		expect(preview.employees).toEqual([ending(alex)]);
		// The preview is read-only.
		expect(await status(alex)).toBe("active");

		await assign(
			{ type: "employee", employeeId: alex.employeeId },
			"not_required",
			preview.previewToken,
		);
		const after = await record(alex);
		expect(after.status).toBe("not_enrolled");
		expect(after.classes.map((c) => [c.code, c.status, c.reason])).toEqual([
			["B", "ended", "no_longer_intended"],
			["C", "ended", "no_longer_intended"],
		]);
		const ended = after.events
			.filter((event) => event.kind === "ended")
			.sort((a, b) => (a.classCode ?? "").localeCompare(b.classCode ?? ""));
		expect(ended).toEqual([
			expect.objectContaining({
				classCode: "B",
				reason: "no_longer_intended",
				effectiveAt: "2026-03-05T10:00:00.000Z",
				actorUserId: fixture.ownerUserId,
			}),
			expect.objectContaining({
				classCode: "C",
				reason: "no_longer_intended",
				effectiveAt: "2026-03-05T10:00:00.000Z",
				actorUserId: fixture.ownerUserId,
			}),
		]);
		// The employee and their verifier get the end notice.
		expect(await endedNotices(alex.userId)).toEqual([expect.stringContaining("B, C")]);
		expect(await endedNotices(verifier.userId)).toHaveLength(1);
	});

	it("updates a team assignment: only the team's intended drivers end", async () => {
		await assign({ type: "team", teamId: drivers }, "required");
		await assign({ type: "employee", employeeId: blair.employeeId }, "required");
		await check(alex);
		await check(blair, ["B"]);

		const preview = await previewAssign({ type: "team", teamId: drivers }, "not_required");
		expect(preview.employees).toEqual([ending(alex)]);
		await assign({ type: "team", teamId: drivers }, "not_required", preview.previewToken);
		await expectEnded(alex);
		expect(await status(blair)).toBe("active");
	});

	it("creates an exclusion under the organization default: the preview and the save agree", async () => {
		await assign({ type: "organization" }, "required");
		await check(alex);
		await check(blair, ["B"]);

		const preview = await previewAssign({ type: "team", teamId: office }, "not_required");
		expect(preview.employees).toEqual([ending(blair, ["B"])]);
		await assign({ type: "team", teamId: office }, "not_required", preview.previewToken);
		expect(await status(alex)).toBe("active");
		await expectEnded(blair);
	});

	it("deletes the organization default: everyone it covered ends", async () => {
		const organization = await assign({ type: "organization" }, "required");
		await check(alex);
		await check(blair, ["B"]);

		const preview = await previewRemove(organization);
		expect(preview.employees).toEqual(expect.arrayContaining([ending(alex), ending(blair, ["B"])]));
		expect(preview.employees).toHaveLength(2);
		await remove(organization, preview.previewToken);
		await expectEnded(alex);
		await expectEnded(blair);
	});

	it("needs no confirmation when nobody is affected", async () => {
		await assign({ type: "team", teamId: drivers }, "required");
		await check(alex);
		const preview = await previewAssign({ type: "organization" }, "required");
		expect(preview.employees).toEqual([]);
		// Removing an employee row that only restates the team keeps alex intended.
		const own = await assign({ type: "employee", employeeId: alex.employeeId }, "required");
		expect((await previewRemove(own)).employees).toEqual([]);
		await remove(own);
		expect(await status(alex)).toBe("active");
	});

	it("refuses a save whose ending changed since the confirmed preview", async () => {
		await assign({ type: "organization" }, "required");
		await check(alex);
		const preview = await previewAssign({ type: "organization" }, "not_required");
		expect(preview.employees).toEqual([ending(alex)]);
		await check(blair, ["B"]);
		expect(
			await owner(() =>
				intendedDrivers.setDrivingLicenceIntendedDriverAssignmentAction({
					target: { type: "organization" },
					value: "not_required",
					previewToken: preview.previewToken,
				}),
			),
		).toEqual({ success: false, error: "stale_preview" });
		expect(await status(alex)).toBe("active");
	});
});

describe("primary-team changes end the authorizations of employees who stop being intended drivers", () => {
	const teams = () => import("@/app/[locale]/(app)/settings/teams/actions");
	const employees = () =>
		import("@/app/[locale]/(app)/settings/employees/employee-mutations.actions");

	it("removing the primary team moves the employee to their next team: warned, then ended", async () => {
		const { previewTeamMemberChangeDrivingImpact, removeTeamMember } = await teams();
		await joinTeam(alex.employeeId, office, false);
		await assign({ type: "team", teamId: drivers }, "required");
		await check(alex);

		// Leaving a team that is not the primary team changes nothing.
		expect(
			await owner(() => previewTeamMemberChangeDrivingImpact(office, alex.employeeId, "remove")),
		).toEqual({ success: true, data: [] });
		expect(
			await owner(() => previewTeamMemberChangeDrivingImpact(drivers, alex.employeeId, "remove")),
		).toEqual({ success: true, data: [ending(alex)] });
		expect(await status(alex)).toBe("active");

		expect(await owner(() => removeTeamMember(drivers, alex.employeeId))).toMatchObject({
			success: true,
		});
		const after = await record(alex);
		expect(after.status).toBe("not_enrolled");
		expect(after.classes.map((c) => c.reason)).toEqual([
			"no_longer_intended",
			"no_longer_intended",
		]);
		expect(await endedNotices(alex.userId)).toHaveLength(1);
	});

	it("adding a first team makes it the primary team: warned, then ended", async () => {
		const { previewTeamMemberChangeDrivingImpact, addTeamMember } = await teams();
		const carol = await fixture.seedEmployee();
		await assign({ type: "organization" }, "required");
		await assign({ type: "team", teamId: office }, "not_required");
		await check(carol, ["B"]);

		expect(
			await owner(() => previewTeamMemberChangeDrivingImpact(office, carol.employeeId, "add")),
		).toEqual({ success: true, data: [ending(carol, ["B"])] });
		expect(await owner(() => addTeamMember(office, carol.employeeId))).toMatchObject({
			success: true,
		});
		await expectEnded(carol);
		// An employee who already has a primary team keeps it when joining another team.
		await check(alex, ["B"]);
		expect(
			await owner(() => previewTeamMemberChangeDrivingImpact(office, alex.employeeId, "add")),
		).toEqual({ success: true, data: [] });
	});

	it("deleting a team clears it as primary team and drops its assignment: warned, then ended", async () => {
		const { previewTeamDeletionDrivingImpact, deleteTeam } = await teams();
		const dana = await fixture.seedEmployee();
		const vans = await seedTeam("Vans");
		await fixture.pool.query(`update employee set team_id=$1 where id=$2`, [vans, dana.employeeId]);
		await assign({ type: "team", teamId: vans }, "required");
		await check(dana);

		expect(await owner(() => previewTeamDeletionDrivingImpact(vans))).toEqual({
			success: true,
			data: [ending(dana)],
		});
		expect(await owner(() => deleteTeam(vans))).toMatchObject({ success: true });
		await expectEnded(dana);
	});

	it("changing the primary team on the employee ends the authorizations too", async () => {
		const { updateEmployeeAction } = await employees();
		await assign({ type: "team", teamId: drivers }, "required");
		await check(alex);
		expect(
			await owner(() => updateEmployeeAction(alex.employeeId, { teamId: office })),
		).toMatchObject({ success: true });
		await expectEnded(alex);
	});

	it("ends silently while the feature is off: no notices", async () => {
		const { removeTeamMember } = await teams();
		await assign({ type: "team", teamId: drivers }, "required");
		await check(alex);
		unwrap(await policies.switchDrivingLicenceControlAction({ enabled: false }));
		expect(await owner(() => removeTeamMember(drivers, alex.employeeId))).toMatchObject({
			success: true,
		});
		unwrap(await policies.switchDrivingLicenceControlAction({ enabled: true }));
		await expectEnded(alex);
		expect((await record(alex)).classes.map((c) => c.status)).toEqual(["ended", "ended"]);
		expect(await endedNotices(alex.userId)).toEqual([]);
	});
});

describe("serialization and scope", () => {
	async function waitsFor(blocker: number) {
		for (let attempt = 0; attempt < 400; attempt++) {
			const result = await fixture.pool.query(
				"select pid from pg_stat_activity where $1::int=any(pg_blocking_pids(pid)) limit 1",
				[blocker],
			);
			if (result.rows[0]) return true;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		return false;
	}

	it("previews and saves under the organization lock used by checks, suspensions and reinstatements", async () => {
		await assign({ type: "employee", employeeId: alex.employeeId }, "required");
		await check(alex);
		const lease = await fixture.pool.connect();
		await lease.query("begin");
		const blocker = (await lease.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0].pid;
		await lease.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
			`driving-licence:${fixture.organizationId}`,
		]);
		const previewing = previewAssign(
			{ type: "employee", employeeId: alex.employeeId },
			"not_required",
		);
		try {
			expect(await waitsFor(blocker)).toBe(true);
		} finally {
			await lease.query("commit");
		}
		expect((await previewing).employees).toEqual([ending(alex)]);

		await lease.query("begin");
		await lease.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
			`driving-licence:${fixture.organizationId}`,
		]);
		const saving = assign({ type: "employee", employeeId: alex.employeeId }, "not_required");
		try {
			expect(await waitsFor(blocker)).toBe(true);
		} finally {
			await lease.query("commit");
			lease.release();
		}
		await saving;
		await expectEnded(alex);
	});

	it("never previews or ends another organization's authorizations", async () => {
		const otherOrganizationId = await fixture.createOrganization();
		const otherOwner = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			role: "owner",
		});
		const otherVerifier = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		const otherDriver = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		session.organizationId = otherOrganizationId;
		await as(otherOwner.userId, async () => {
			unwrap(await policies.switchDrivingLicenceControlAction({ enabled: true, setup }));
			unwrap(
				await intendedDrivers.setDrivingLicenceIntendedDriverAssignmentAction({
					target: { type: "organization" },
					value: "required",
				}),
			);
			unwrap(
				await grants.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: otherVerifier.employeeId,
					scope: "all",
					teamIds: [],
					employeeIds: [],
				}),
			);
		});
		const previousVerifier = verifier;
		verifier = otherVerifier;
		await check(otherDriver);
		verifier = previousVerifier;
		session.organizationId = fixture.organizationId;

		const organization = await assign({ type: "organization" }, "required");
		await check(alex);
		const preview = await previewRemove(organization);
		expect(preview.employees).toEqual([ending(alex)]);
		await remove(organization, preview.previewToken);

		session.organizationId = otherOrganizationId;
		const other = unwrap(
			await as(otherVerifier.userId, () =>
				checks.getDrivingLicenceEmployeeRecordAction({ employeeId: otherDriver.employeeId }),
			),
		);
		expect(other.status).toBe("active");
		session.organizationId = fixture.organizationId;
	});
});

describe("what ending leaves behind", () => {
	async function retentionOf(checkId: string) {
		const result = unwrap(await owner(() => retention.getDrivingLicenceRetentionAction()));
		return result.records.find((item) => item.checkId === checkId);
	}

	it("starts the retention period of freed records at the ending instant; other records stay protected", async () => {
		await assign({ type: "organization" }, "required");
		const alexCheck = await check(alex);
		const blairCheck = await check(blair, ["B"]);
		expect(await retentionOf(alexCheck)).toMatchObject({
			protected: true,
			retentionStartedAt: null,
		});

		session.now = "2026-04-01T07:30:00Z";
		await assign({ type: "employee", employeeId: alex.employeeId }, "not_required");
		expect(await retentionOf(alexCheck)).toMatchObject({
			protected: false,
			retentionStartedAt: "2026-04-01T07:30:00.000Z",
		});
		expect(await retentionOf(blairCheck)).toMatchObject({
			protected: true,
			retentionStartedAt: null,
		});
	});

	it("leaves an employee who becomes an intended driver again not yet checked, and a new check grants normally", async () => {
		await assign({ type: "employee", employeeId: alex.employeeId }, "required");
		const first = await check(alex);
		await assign({ type: "employee", employeeId: alex.employeeId }, "not_required");

		session.now = "2026-03-10T09:00:00Z";
		await assign({ type: "employee", employeeId: alex.employeeId }, "required");
		expect(await status(alex)).toBe("not_yet_checked");
		const own = unwrap(await as(alex.userId, () => policies.getOwnDrivingLicenceStatusAction()));
		expect(own).toMatchObject({ enrolled: true, status: "not_yet_checked", authorizedClasses: [] });
		const rows = unwrap(
			await as(verifier.userId, () => checks.getDrivingLicenceCheckWorklistAction()),
		);
		expect(rows.find((row) => row.employeeId === alex.employeeId)?.status).toBe("not_yet_checked");

		const second = await check(alex, ["B"]);
		const after = await record(alex);
		// The class that ended with the old status is history, not a current authorization.
		expect(after.status).toBe("active");
		expect(after.authorizedClasses).toEqual(["B"]);
		expect(after.classes.map((c) => [c.code, c.status, c.supportingCheckId])).toEqual([
			["B", "active", second],
			["C", "ended", first],
		]);
	});
});
