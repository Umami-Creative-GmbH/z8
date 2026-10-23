/**
 * #1423 (spec #1418, Organization ADR 0005): intended drivers come from organization, team
 * and employee assignments. The employee's own assignment counts first, then their primary
 * team's, then the organization default; with none they are not an intended driver.
 * Everything runs through the public actions and readers on PostgreSQL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	removeConfirmedIntendedDriverAssignment,
	saveConfirmedIntendedDriverAssignment,
} from "./testing/control.test.fixture";

const session = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-01-31T11:00:00Z",
}));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () =>
		session.userId
			? {
					user: { id: session.userId },
					session: { activeOrganizationId: session.organizationId },
				}
			: null,
}));
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
const tasks = await import("./task-actions");
const visibility = await import("./visibility");

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
let grantId: string;

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
function assign(target: Target, value: "required" | "not_required") {
	return as(fixture.ownerUserId, () => saveConfirmedIntendedDriverAssignment({ target, value }));
}
async function assignOk(target: Target, value: "required" | "not_required") {
	const result = await assign(target, value);
	if (!result.success) throw new Error(result.error);
	return result.data.assignmentId;
}
async function intended(employee: SeededEmployee) {
	return (
		await visibility.readDrivingLicenceVisibility({
			organizationId: fixture.organizationId,
			userId: employee.userId,
		})
	).intendedDriver;
}
async function worklist() {
	const result = await as(verifier.userId, () => checks.getDrivingLicenceCheckWorklistAction());
	if (!result.success) throw new Error(result.error);
	return result.data.map((row) => row.employeeId).sort();
}

beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	session.organizationId = fixture.organizationId;
	session.userId = fixture.ownerUserId;
	session.now = "2026-01-31T11:00:00Z";
	verifier = await fixture.seedEmployee();
	alex = await fixture.seedEmployee();
	blair = await fixture.seedEmployee();
	drivers = await seedTeam("Drivers");
	office = await seedTeam("Office");
	await joinTeam(alex.employeeId, drivers, true);
	await joinTeam(blair.employeeId, office, true);
	expect(await policies.switchDrivingLicenceControlAction({ enabled: true, setup })).toMatchObject({
		success: true,
	});
	const grant = await grants.saveDrivingLicenceVerifierGrantAction({
		verifierEmployeeId: verifier.employeeId,
		scope: "all",
		teamIds: [],
		employeeIds: [],
	});
	if (!grant.success) throw new Error(grant.error);
	grantId = grant.data.grantId;
});
afterEach(async () => fixture?.close());

describe("intended-driver resolution", () => {
	it("makes nobody an intended driver without an assignment", async () => {
		expect(await intended(alex)).toBe(false);
		expect(await intended(blair)).toBe(false);
		expect(await worklist()).toEqual([]);
	});

	it("resolves the employee's own assignment over their primary team's over the organization default", async () => {
		const organization = await assignOk({ type: "organization" }, "required");
		expect([await intended(alex), await intended(blair)]).toEqual([true, true]);

		await assignOk({ type: "team", teamId: drivers }, "not_required");
		expect([await intended(alex), await intended(blair)]).toEqual([false, true]);

		await assignOk({ type: "employee", employeeId: alex.employeeId }, "required");
		expect([await intended(alex), await intended(blair)]).toEqual([true, true]);

		await assignOk({ type: "employee", employeeId: blair.employeeId }, "not_required");
		expect([await intended(alex), await intended(blair)]).toEqual([true, false]);

		expect(
			await as(fixture.ownerUserId, () =>
				removeConfirmedIntendedDriverAssignment({
					assignmentId: organization,
				}),
			),
		).toMatchObject({ success: true });
		expect([await intended(alex), await intended(blair)]).toEqual([true, false]);
	});

	it("ignores memberships of teams other than the primary team", async () => {
		await joinTeam(blair.employeeId, drivers, false);
		await assignOk({ type: "team", teamId: drivers }, "required");
		expect(await intended(alex)).toBe(true);
		expect(await intended(blair)).toBe(false);

		await assignOk({ type: "organization" }, "required");
		await assignOk({ type: "team", teamId: drivers }, "not_required");
		expect(await intended(alex)).toBe(false);
		expect(await intended(blair)).toBe(true);
	});

	it("changes an assignment in place, one per target", async () => {
		const first = await assignOk({ type: "team", teamId: drivers }, "required");
		const second = await assignOk({ type: "team", teamId: drivers }, "not_required");
		expect(second).toBe(first);
		const data = await policies.getDrivingLicenceAdminDataAction();
		if (!data.success) throw new Error(data.error);
		expect(data.data.intendedDrivers.assignments).toEqual([
			expect.objectContaining({
				id: first,
				assignmentType: "team",
				teamId: drivers,
				employeeId: null,
				value: "not_required",
			}),
		]);
		expect(data.data.intendedDrivers.teams.map((team) => team.id).sort()).toEqual(
			[drivers, office].sort(),
		);
		expect(data.data.intendedDrivers.employees.map((employee) => employee.id)).toEqual(
			expect.arrayContaining([alex.employeeId, blair.employeeId]),
		);
	});
});

describe("bulk readers select intended drivers", () => {
	it("lists exactly the intended drivers in the verifier worklist", async () => {
		await assignOk({ type: "team", teamId: drivers }, "required");
		expect(await worklist()).toEqual([alex.employeeId]);
		await assignOk({ type: "organization" }, "required");
		await assignOk({ type: "employee", employeeId: verifier.employeeId }, "not_required");
		// The verifier never appears in their own worklist; the owner and fixture employee do.
		expect(await worklist()).toEqual(
			[alex.employeeId, blair.employeeId, fixture.employeeId, fixture.ownerEmployeeId].sort(),
		);
	});

	it("creates verifier-responsibility tasks only for intended drivers", async () => {
		expect(await grants.revokeDrivingLicenceVerifierGrantAction({ grantId })).toMatchObject({
			success: true,
		});
		await assignOk({ type: "team", teamId: office }, "required");
		const result = await tasks.getDrivingLicenceTasksAction();
		if (!result.success) throw new Error(result.error);
		expect(
			result.data.filter((task) => task.kind === "reassignment").map((task) => task.employeeId),
		).toEqual([blair.employeeId]);
	});

	it("records checks only for intended drivers", async () => {
		const check = (employeeId: string) =>
			as(verifier.userId, () =>
				checks.completeDrivingLicenceCheckAction({
					employeeId,
					commandId: crypto.randomUUID(),
					originalInspected: true,
					identityConfirmed: true,
					employeeDeclaration: true,
					verifierConfirmed: true,
					documentIssuedOn: "2020-05-01",
					documentExpiresOn: "2035-05-01",
					classes: [{ code: "B", result: "successful", expiryDate: null, restrictions: "" }],
				}),
			);
		await assignOk({ type: "employee", employeeId: alex.employeeId }, "required");
		expect(await check(alex.employeeId)).toMatchObject({ success: true });
		expect(await check(blair.employeeId)).toMatchObject({ success: false });
	});
});

describe("intended-driver assignments are administered per organization", () => {
	it("lets only owners and admins change assignments", async () => {
		const id = await assignOk({ type: "organization" }, "required");
		for (const userId of [alex.userId, verifier.userId, ""]) {
			expect(
				await as(userId, () =>
					saveConfirmedIntendedDriverAssignment({
						target: { type: "organization" },
						value: "not_required",
					}),
				),
			).toEqual({ success: false, error: "forbidden" });
			expect(
				await as(userId, () =>
					removeConfirmedIntendedDriverAssignment({
						assignmentId: id,
					}),
				),
			).toEqual({ success: false, error: "forbidden" });
		}
		const admin = await fixture.seedEmployee({ role: "admin" });
		expect(
			await as(admin.userId, () =>
				saveConfirmedIntendedDriverAssignment({
					target: { type: "organization" },
					value: "not_required",
				}),
			),
		).toMatchObject({ success: true });
		expect(await intended(alex)).toBe(false);
	});

	it("refuses assigning a former employee as intended driver (#1438)", async () => {
		const former = await fixture.seedEmployee({ isActive: false });
		expect(
			await assign({ type: "employee", employeeId: former.employeeId }, "required"),
		).toEqual({ success: false, error: "employee_not_found" });
		const current = await fixture.seedEmployee();
		expect(
			await assign({ type: "employee", employeeId: current.employeeId }, "required"),
		).toMatchObject({ success: true });
	});

	it("never reaches into another organization", async () => {
		const otherOrganizationId = await fixture.createOrganization();
		const foreignTeam = await seedTeam("Foreign", otherOrganizationId);
		const foreigner = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		expect(await assign({ type: "team", teamId: foreignTeam }, "required")).toEqual({
			success: false,
			error: "team_not_found",
		});
		expect(
			await assign({ type: "employee", employeeId: foreigner.employeeId }, "required"),
		).toEqual({ success: false, error: "employee_not_found" });

		// The other organization's own default never makes this organization's employees intended.
		const otherOwner = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			role: "owner",
		});
		session.organizationId = otherOrganizationId;
		expect(
			await as(otherOwner.userId, () =>
				policies.switchDrivingLicenceControlAction({ enabled: true, setup }),
			),
		).toMatchObject({ success: true });
		const foreignDefault = await as(otherOwner.userId, () =>
			saveConfirmedIntendedDriverAssignment({
				target: { type: "organization" },
				value: "required",
			}),
		);
		if (!foreignDefault.success) throw new Error(foreignDefault.error);
		session.organizationId = fixture.organizationId;
		expect(await intended(alex)).toBe(false);
		expect(
			await as(fixture.ownerUserId, () =>
				removeConfirmedIntendedDriverAssignment({
					assignmentId: foreignDefault.data.assignmentId,
				}),
			),
		).toEqual({ success: false, error: "assignment_not_found" });
		const data = await policies.getDrivingLicenceAdminDataAction();
		expect(data.success && data.data.intendedDrivers.assignments).toEqual([]);
	});

	it("keeps assignments while the feature is off, but changes them only while it is on", async () => {
		await assignOk({ type: "employee", employeeId: alex.employeeId }, "required");
		expect(await policies.switchDrivingLicenceControlAction({ enabled: false })).toMatchObject({
			success: true,
		});
		expect(await assign({ type: "organization" }, "required")).toEqual({
			success: false,
			error: "not_enabled",
		});
		expect(await policies.switchDrivingLicenceControlAction({ enabled: true })).toMatchObject({
			success: true,
		});
		expect(await intended(alex)).toBe(true);
	});
});
