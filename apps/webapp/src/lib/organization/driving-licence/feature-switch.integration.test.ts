import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
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
		harness.userId
			? {
					user: { id: harness.userId },
					session: { activeOrganizationId: harness.organizationId },
				}
			: null,
}));
vi.mock("@/lib/email/email-service", () => ({
	sendEmail: async () => ({ success: true }),
}));
vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: async () => "https://z8.test",
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual = await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: Object.freeze({
			nowInstant: () => actual.parseInstant(harness.now),
		}),
	};
});
vi.setConfig({ testTimeout: 60_000 });

const policy = await import("./policy-actions");
const intendedDrivers = await import("./intended-driver-actions");
const { readDrivingLicenceFeatureState } = await import("./policy");
const checks = await import("./check-actions");
const grants = await import("./verifier-actions");
const tasks = await import("./task-actions");
const history = await import("./history-actions");
const { runDrivingLicenceRemindersJob } = await import("@/lib/jobs/driving-licence-reminders");
const { runDrivingLicenceRetentionJob } = await import("@/lib/jobs/driving-licence-retention");
const { getUserNotifications } = await import("@/lib/notifications/notification-service");

const setup = {
	intervalMonths: 1,
	timezone: "Europe/Berlin",
	retentionMonths: 1,
	retentionJustification: "Necessary evidence for organization driving checks",
};

let fixture: LifecycleDatabaseFixture;
let admin: SeededEmployee;
let member: SeededEmployee;

beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	admin = await fixture.seedEmployee({ role: "admin" });
	member = await fixture.seedEmployee();
	harness.organizationId = fixture.organizationId;
	harness.userId = fixture.ownerUserId;
	harness.now = "2026-01-31T11:00:00Z";
});
afterEach(async () => {
	await fixture?.close();
});

describe("first activation from the Features switch", () => {
	it("starts off and asks for setup before the first switch-on", async () => {
		expect(await readDrivingLicenceFeatureState(fixture.organizationId)).toEqual({
			enabled: false,
			setupRequired: true,
			savedSetup: null,
		});
		expect(await policy.switchDrivingLicenceControlAction({ enabled: true })).toEqual({
			success: false,
			error: "setup_required",
		});
		expect((await readDrivingLicenceFeatureState(fixture.organizationId)).enabled).toBe(false);
	});

	it("refuses activation without retention months or a justification of at least 10 characters", async () => {
		for (const invalid of [
			{ retentionMonths: null },
			{ retentionMonths: 0 },
			{ retentionJustification: "" },
			{ retentionJustification: "  too short " },
			{ intervalMonths: 0 },
			{ timezone: "viewer" },
		]) {
			expect(
				await policy.switchDrivingLicenceControlAction({
					enabled: true,
					setup: { ...setup, ...invalid },
				}),
			).toEqual({ success: false, error: "invalid_setup" });
		}
		expect(await readDrivingLicenceFeatureState(fixture.organizationId)).toEqual({
			enabled: false,
			setupRequired: true,
			savedSetup: null,
		});
	});

	it("creates and activates the policy with the setup and reminder lead times of 30 and 7 days", async () => {
		harness.userId = admin.userId;
		expect(await policy.switchDrivingLicenceControlAction({ enabled: true, setup })).toEqual({
			success: true,
			data: { enabled: true, firstActivation: true },
		});
		const saved = await policy.getDrivingLicenceAdminDataAction();
		expect(saved).toMatchObject({
			success: true,
			data: {
				policy: {
					enabled: true,
					intervalMonths: 1,
					timezone: "Europe/Berlin",
					reminderLeadDays: [30, 7],
					retentionMonths: 1,
					retentionJustification: "Necessary evidence for organization driving checks",
				},
			},
		});
		expect(await readDrivingLicenceFeatureState(fixture.organizationId)).toEqual({
			enabled: true,
			setupRequired: false,
			savedSetup: { intervalMonths: 1, timezone: "Europe/Berlin" },
		});
	});

	it("lets only owners and admins of the active organization switch", async () => {
		const other = await fixture.createOrganization();
		const foreignAdmin = await fixture.seedEmployee({
			organizationId: other,
			role: "admin",
		});
		harness.userId = member.userId;
		expect(await policy.switchDrivingLicenceControlAction({ enabled: true, setup })).toEqual({
			success: false,
			error: "forbidden",
		});
		harness.userId = foreignAdmin.userId;
		expect(await policy.switchDrivingLicenceControlAction({ enabled: true, setup })).toEqual({
			success: false,
			error: "forbidden",
		});
		harness.userId = "";
		expect(await policy.switchDrivingLicenceControlAction({ enabled: true, setup })).toEqual({
			success: false,
			error: "forbidden",
		});
		expect((await readDrivingLicenceFeatureState(fixture.organizationId)).enabled).toBe(false);

		harness.userId = fixture.ownerUserId;
		expect((await policy.switchDrivingLicenceControlAction({ enabled: true, setup })).success).toBe(
			true,
		);
		harness.userId = member.userId;
		expect(await policy.switchDrivingLicenceControlAction({ enabled: false })).toEqual({
			success: false,
			error: "forbidden",
		});
		expect((await readDrivingLicenceFeatureState(fixture.organizationId)).enabled).toBe(true);
		expect((await readDrivingLicenceFeatureState(other)).enabled).toBe(false);
	});

	it("keeps the deadline timezone fixed and the switch as the policy form's only activation", async () => {
		expect((await policy.switchDrivingLicenceControlAction({ enabled: true, setup })).success).toBe(
			true,
		);
		const form = {
			intervalMonths: 1,
			timezone: "America/New_York",
			reminderLeadDays: [14],
			retentionMonths: 1,
			retentionJustification: setup.retentionJustification,
		};
		expect(await policy.saveDrivingLicencePolicyAction(form)).toEqual({
			success: false,
			error: "timezone_fixed",
		});
		expect(
			(
				await policy.saveDrivingLicencePolicyAction({
					...form,
					timezone: "Europe/Berlin",
				})
			).success,
		).toBe(true);
		expect(await readDrivingLicenceFeatureState(fixture.organizationId)).toEqual({
			enabled: true,
			setupRequired: false,
			savedSetup: { intervalMonths: 1, timezone: "Europe/Berlin" },
		});
	});
});

describe("switching off and on again", () => {
	let subjectUserId: string;

	async function inbox(userId: string) {
		return (await getUserNotifications(userId, fixture.organizationId)).notifications;
	}
	async function verifierGrantId() {
		const grants = await fixture.pool.query(
			"select id from driving_licence_verifier_grant where verifier_employee_id=$1 and revoked_at is null",
			[member.employeeId],
		);
		return grants.rows[0].id as string;
	}

	beforeEach(async () => {
		subjectUserId = (
			await fixture.pool.query("select user_id from employee where id=$1", [fixture.employeeId])
		).rows[0].user_id;
		expect((await policy.switchDrivingLicenceControlAction({ enabled: true, setup })).success).toBe(
			true,
		);
		expect(
			(
				await intendedDrivers.setDrivingLicenceIntendedDriverAssignmentAction({
					target: { type: "employee", employeeId: fixture.employeeId },
					value: "required",
				})
			).success,
		).toBe(true);
		expect(
			(
				await grants.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: member.employeeId,
					scope: "all",
					teamIds: [],
					employeeIds: [],
				})
			).success,
		).toBe(true);
		harness.userId = member.userId;
		const check = await checks.completeDrivingLicenceCheckAction({
			employeeId: fixture.employeeId,
			commandId: crypto.randomUUID(),
			originalInspected: true,
			identityConfirmed: true,
			employeeDeclaration: true,
			verifierConfirmed: true,
			documentIssuedOn: "2020-05-01",
			documentExpiresOn: "2035-05-01",
			classes: [{ code: "B", result: "successful", expiryDate: null, restrictions: "" }],
		});
		if (!check.success) throw new Error(check.error);
		harness.userId = fixture.ownerUserId;
	});

	it("stops tasks and reminders but keeps records, authorizations and the retention period", async () => {
		expect(
			(
				await grants.revokeDrivingLicenceVerifierGrantAction({
					grantId: await verifierGrantId(),
				})
			).success,
		).toBe(true);
		await runDrivingLicenceRemindersJob();
		expect(await tasks.getDrivingLicenceTasksAction()).toMatchObject({
			success: true,
			data: [{ kind: "reassignment", state: "pending" }],
		});

		expect(await policy.switchDrivingLicenceControlAction({ enabled: false })).toEqual({
			success: true,
			data: { enabled: false, firstActivation: false },
		});
		expect(await readDrivingLicenceFeatureState(fixture.organizationId)).toEqual({
			enabled: false,
			setupRequired: false,
			savedSetup: { intervalMonths: 1, timezone: "Europe/Berlin" },
		});
		expect(await tasks.getDrivingLicenceTasksAction()).toEqual({
			success: true,
			data: [],
		});

		// The deadline is a week away: a reminder would be due if the feature were on.
		harness.now = "2026-02-21T10:00:00Z";
		const before = (await inbox(subjectUserId)).length;
		await runDrivingLicenceRemindersJob();
		expect(await inbox(subjectUserId)).toHaveLength(before);

		harness.userId = subjectUserId;
		expect(await policy.getOwnDrivingLicenceStatusAction()).toMatchObject({
			success: true,
			data: { status: "active", authorizedClasses: ["B"] },
		});
		const own = await history.getDrivingLicenceHistoryAction({
			employeeId: fixture.employeeId,
		});
		expect(own.success && own.data.checks).toHaveLength(1);

		harness.userId = fixture.ownerUserId;
		expect(
			await policy.saveDrivingLicencePolicyAction({
				intervalMonths: 1,
				timezone: "Europe/Berlin",
				reminderLeadDays: [30, 7],
				retentionMonths: null,
				retentionJustification: null,
			}),
		).toEqual({ success: false, error: "retention_required" });
		expect((await readDrivingLicenceFeatureState(fixture.organizationId)).enabled).toBe(false);
	});

	it("keeps deadlines running and evidence cleanup going while off", async () => {
		expect((await policy.switchDrivingLicenceControlAction({ enabled: false })).success).toBe(true);
		// Valid through 2026-02-28 in Berlin; one month of retention follows.
		harness.now = "2026-03-15T12:00:00Z";
		harness.userId = subjectUserId;
		expect(await policy.getOwnDrivingLicenceStatusAction()).toMatchObject({
			success: true,
			data: { status: "suspended", authorizedClasses: [] },
		});
		harness.now = "2026-04-01T12:00:00Z";
		expect((await runDrivingLicenceRetentionJob()).deletedCount).toBeGreaterThanOrEqual(1);
		const own = await history.getDrivingLicenceHistoryAction({
			employeeId: fixture.employeeId,
		});
		expect(own.success && own.data.checks).toEqual([]);
	});

	it("reuses the saved policy when switched on again", async () => {
		harness.userId = admin.userId;
		expect((await policy.switchDrivingLicenceControlAction({ enabled: false })).success).toBe(true);
		expect(
			await policy.switchDrivingLicenceControlAction({
				enabled: true,
				setup: { ...setup, intervalMonths: 12, retentionMonths: 60 },
			}),
		).toEqual({ success: true, data: { enabled: true, firstActivation: false } });
		expect(await policy.getDrivingLicenceAdminDataAction()).toMatchObject({
			success: true,
			data: {
				policy: {
					enabled: true,
					intervalMonths: 1,
					timezone: "Europe/Berlin",
					reminderLeadDays: [30, 7],
					retentionMonths: 1,
				},
			},
		});
	});
});
