import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

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
	getAuthContext: async () => ({
		user: { id: session.userId },
		session: { activeOrganizationId: session.organizationId },
	}),
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual = await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(session.now) },
	};
});
const policies = await import("./policy-actions");
const grants = await import("./verifier-actions");
const checks = await import("./check-actions");
const operational = await import("./operational-actions");
const visibility = await import("./visibility");

const policy = {
	enabled: true,
	intervalMonths: 6,
	timezone: "Europe/Berlin",
	reminderLeadDays: [30, 7],
	retentionMonths: 36,
	retentionJustification: "Organization driving evidence retention",
};
let fixture: LifecycleDatabaseFixture;
let verifier: SeededEmployee;
let planner: SeededEmployee;
let bystander: SeededEmployee;

async function as<T>(userId: string, operation: () => Promise<T>) {
	const previous = session.userId;
	session.userId = userId;
	try {
		return await operation();
	} finally {
		session.userId = previous;
	}
}
function read(userId: string, organizationId = fixture.organizationId) {
	return visibility.readDrivingLicenceVisibility({ organizationId, userId });
}
async function switchOn() {
	expect(
		await as(fixture.ownerUserId, () => policies.saveDrivingLicencePolicyAction(policy)),
	).toMatchObject({ success: true });
}
async function switchOff() {
	expect(
		await as(fixture.ownerUserId, () =>
			policies.saveDrivingLicencePolicyAction({ ...policy, enabled: false }),
		),
	).toMatchObject({ success: true });
}
async function enroll(employeeId: string) {
	expect(
		await as(fixture.ownerUserId, () =>
			policies.enrollDrivingLicenceEmployeeAction({ employeeId }),
		),
	).toMatchObject({ success: true });
}
async function grantPlanningPermission(employeeId: string) {
	const roleId = crypto.randomUUID();
	await fixture.pool.query(
		`insert into custom_role (id, organization_id, name, created_by, updated_at) values ($1,$2,'Driving planner',$3,now())`,
		[roleId, fixture.organizationId, fixture.ownerUserId],
	);
	await fixture.pool.query(
		`insert into custom_role_permission (custom_role_id,action,subject) values ($1,'read','DrivingAuthorization')`,
		[roleId],
	);
	await fixture.pool.query(
		`insert into employee_custom_role (employee_id,custom_role_id,assigned_by) values ($1,$2,$3)`,
		[employeeId, roleId, fixture.ownerUserId],
	);
}
async function recordCheck(employeeId: string) {
	expect(
		await as(verifier.userId, () =>
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
		),
	).toMatchObject({ success: true });
}
/** #1423 replaces enrollment with assignments; until then the participant row is the only way out. */
async function stopIntendingDriver(employeeId: string) {
	await fixture.pool.query(
		`delete from driving_licence_participant where organization_id=$1 and employee_id=$2`,
		[fixture.organizationId, employeeId],
	);
}

beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	session.organizationId = fixture.organizationId;
	session.userId = fixture.ownerUserId;
	session.now = "2026-01-31T11:00:00Z";
	verifier = await fixture.seedEmployee();
	planner = await fixture.seedEmployee();
	bystander = await fixture.seedEmployee();
});
afterEach(async () => fixture?.close());

describe("driving licence visibility while the feature is on", () => {
	beforeEach(async () => {
		await switchOn();
		await enroll(fixture.employeeId);
		expect(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: verifier.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			}),
		).toMatchObject({ success: true });
		await grantPlanningPermission(planner.employeeId);
	});

	it("shows the personal item and the clock advisory to an intended driver", async () => {
		const driver = await read(
			(
				await fixture.pool.query<{ user_id: string }>("select user_id from employee where id=$1", [
					fixture.employeeId,
				])
			).rows[0].user_id,
		);
		expect(driver).toMatchObject({
			featureEnabled: true,
			intendedDriver: true,
			verifier: false,
			planner: false,
			settings: "hidden",
		});
		expect(visibility.showsDrivingLicenceNavigation(driver)).toBe(true);
		expect(visibility.showsDrivingAuthorizationAdvisory(driver)).toBe(true);
	});

	it("shows the personal item to verifiers and planners, but never the advisory", async () => {
		const asVerifier = await read(verifier.userId);
		const asPlanner = await read(planner.userId);
		expect(asVerifier).toMatchObject({
			intendedDriver: false,
			verifier: true,
			planner: false,
		});
		expect(asPlanner).toMatchObject({
			intendedDriver: false,
			verifier: false,
			planner: true,
		});
		for (const view of [asVerifier, asPlanner]) {
			expect(visibility.showsDrivingLicenceNavigation(view)).toBe(true);
			expect(visibility.showsDrivingAuthorizationAdvisory(view)).toBe(false);
		}
	});

	it("shows nothing to a member with no driving licence role", async () => {
		const none = await read(bystander.userId);
		expect(none).toMatchObject({
			featureEnabled: true,
			intendedDriver: false,
			ownRetainedRecords: false,
			verifier: false,
			planner: false,
			settings: "hidden",
		});
		expect(visibility.showsDrivingLicenceNavigation(none)).toBe(false);
		expect(visibility.showsDrivingAuthorizationAdvisory(none)).toBe(false);
	});

	it("keeps My licence for a former intended driver whose check records are retained", async () => {
		await enroll(bystander.employeeId);
		await recordCheck(bystander.employeeId);
		await stopIntendingDriver(bystander.employeeId);
		const former = await read(bystander.userId);
		expect(former).toMatchObject({
			intendedDriver: false,
			ownRetainedRecords: true,
		});
		expect(visibility.showsDrivingLicenceNavigation(former)).toBe(true);
		expect(visibility.showsDrivingAuthorizationAdvisory(former)).toBe(false);
		expect(visibility.drivingLicenceRoles(former)).toEqual({
			myLicence: true,
			checks: false,
			planning: false,
		});
	});

	it("offers administrators the full settings while it is on", async () => {
		expect((await read(fixture.ownerUserId)).settings).toBe("full");
		expect((await read(verifier.userId)).settings).toBe("hidden");
	});

	it("answers the clock advisory only for intended drivers", async () => {
		const driverUserId = (
			await fixture.pool.query<{ user_id: string }>("select user_id from employee where id=$1", [
				fixture.employeeId,
			])
		).rows[0].user_id;
		expect(
			await as(driverUserId, () => operational.getDrivingAuthorizationStatusAction()),
		).toMatchObject({
			success: true,
			data: { employeeId: fixture.employeeId, status: "not_yet_checked" },
		});
		expect(
			await as(bystander.userId, () => operational.getDrivingAuthorizationStatusAction()),
		).toEqual({ success: true, data: null });
	});
});

describe("driving licence visibility while the feature is off", () => {
	it("shows no surface to anyone before it was ever switched on", async () => {
		await grantPlanningPermission(planner.employeeId);
		for (const userId of [fixture.ownerUserId, planner.userId, bystander.userId]) {
			const view = await read(userId);
			expect(view.featureEnabled).toBe(false);
			expect(view.settings).toBe("hidden");
			expect(visibility.showsDrivingLicenceNavigation(view)).toBe(false);
			expect(visibility.showsDrivingAuthorizationAdvisory(view)).toBe(false);
		}
	});

	it("hides every personal surface after switching off and keeps only Retention & holds while records are retained", async () => {
		await switchOn();
		await enroll(fixture.employeeId);
		expect(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: verifier.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			}),
		).toMatchObject({ success: true });
		await grantPlanningPermission(planner.employeeId);
		await recordCheck(fixture.employeeId);
		await switchOff();

		const driverUserId = (
			await fixture.pool.query<{ user_id: string }>("select user_id from employee where id=$1", [
				fixture.employeeId,
			])
		).rows[0].user_id;
		for (const userId of [driverUserId, verifier.userId, planner.userId]) {
			const view = await read(userId);
			expect(view.featureEnabled).toBe(false);
			expect(visibility.showsDrivingLicenceNavigation(view)).toBe(false);
			expect(visibility.showsDrivingAuthorizationAdvisory(view)).toBe(false);
			expect(visibility.drivingLicenceRoles(view)).toEqual({
				myLicence: false,
				checks: false,
				planning: false,
			});
		}
		expect(await as(driverUserId, () => operational.getDrivingAuthorizationStatusAction())).toEqual(
			{ success: true, data: null },
		);
		expect((await read(fixture.ownerUserId)).settings).toBe("retention_only");
		expect((await read(verifier.userId)).settings).toBe("hidden");
	});

	it("keeps Retention & holds reachable while a legal-case hold exists", async () => {
		await switchOn();
		await enroll(fixture.employeeId);
		expect(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: verifier.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			}),
		).toMatchObject({ success: true });
		await recordCheck(fixture.employeeId);
		const retention = await import("./retention-actions");
		const records = await retention.getDrivingLicenceRetentionAction();
		if (!records.success) throw new Error(records.error);
		const [record] = records.data.records;
		expect(
			await retention.placeDrivingLicenceHoldAction({
				checkId: record.checkId,
				caseReference: "Case 2026-17",
				preservationReason: "Pending labour court proceedings",
			}),
		).toMatchObject({ success: true });
		await switchOff();
		expect((await read(fixture.ownerUserId)).settings).toBe("retention_only");
	});

	it("hides the settings entry while no records or holds are retained", async () => {
		await switchOn();
		await switchOff();
		expect((await read(fixture.ownerUserId)).settings).toBe("hidden");
	});
});

it("decides each organization separately for a member of two organizations", async () => {
	await switchOn();
	await enroll(fixture.employeeId);
	expect(
		await grants.saveDrivingLicenceVerifierGrantAction({
			verifierEmployeeId: verifier.employeeId,
			scope: "all",
			teamIds: [],
			employeeIds: [],
		}),
	).toMatchObject({ success: true });
	await recordCheck(fixture.employeeId);
	const driverUserId = (
		await fixture.pool.query<{ user_id: string }>("select user_id from employee where id=$1", [
			fixture.employeeId,
		])
	).rows[0].user_id;
	const otherOrganizationId = await fixture.createOrganization();
	await fixture.pool.query(
		`insert into member (id, organization_id, user_id, role, status, created_at) values ($1,$2,$3,'admin','approved',now())`,
		[crypto.randomUUID(), otherOrganizationId, driverUserId],
	);
	await fixture.pool.query(
		`insert into employee (id, user_id, organization_id, role, is_active, start_date, updated_at) values ($1,$2,$3,'admin',true,'2026-01-01',now())`,
		[crypto.randomUUID(), driverUserId, otherOrganizationId],
	);
	const home = await read(driverUserId);
	const other = await read(driverUserId, otherOrganizationId);
	expect(visibility.showsDrivingLicenceNavigation(home)).toBe(true);
	expect(visibility.showsDrivingAuthorizationAdvisory(home)).toBe(true);
	// The member administers the other organization, where the feature is off and
	// nothing is retained: the first organization's role and records never leak into it.
	expect(other).toMatchObject({
		featureEnabled: false,
		intendedDriver: false,
		ownRetainedRecords: false,
		settings: "hidden",
	});
	expect(visibility.showsDrivingLicenceNavigation(other)).toBe(false);
	expect(visibility.showsDrivingAuthorizationAdvisory(other)).toBe(false);
	session.organizationId = otherOrganizationId;
	expect(await as(driverUserId, () => operational.getDrivingAuthorizationStatusAction())).toEqual({
		success: true,
		data: null,
	});
});
