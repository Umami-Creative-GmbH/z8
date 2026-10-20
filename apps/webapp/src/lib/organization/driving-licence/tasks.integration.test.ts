import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SendEmailParams } from "@/lib/email/email-service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-01-31T11:00:00Z",
	mail: vi.fn(async (_message: SendEmailParams) => ({ success: true })),
}));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () => ({
		user: { id: harness.userId },
		session: { activeOrganizationId: harness.organizationId },
	}),
}));
vi.mock("@/lib/email/email-service", () => ({ sendEmail: harness.mail }));
vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: async () => "https://z8.test",
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: Object.freeze({
			nowInstant: () => actual.parseInstant(harness.now),
		}),
	};
});
const checks = await import("@/lib/organization/driving-licence/check-actions");
const policy = await import(
	"@/lib/organization/driving-licence/policy-actions"
);
const grants = await import(
	"@/lib/organization/driving-licence/verifier-actions"
);
const { runDrivingLicenceRemindersJob } = await import(
	"@/lib/jobs/driving-licence-reminders"
);
const { getUserNotifications } = await import(
	"@/lib/notifications/notification-service"
);
let fixture: LifecycleDatabaseFixture;
let verifier: SeededEmployee;
let subjectUserId: string;
function original(
	documentExpiresOn = "2035-05-01",
	classes = [
		{
			code: "B",
			result: "successful",
			expiryDate: null as string | null,
			restrictions: "",
		},
	],
) {
	return {
		employeeId: fixture.employeeId,
		commandId: crypto.randomUUID(),
		originalInspected: true,
		identityConfirmed: true,
		employeeDeclaration: true,
		verifierConfirmed: true,
		documentIssuedOn: "2020-05-01",
		documentExpiresOn,
		classes,
	};
}
async function inbox(userId = subjectUserId) {
	return (await getUserNotifications(userId, fixture.organizationId))
		.notifications;
}
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	verifier = await fixture.seedEmployee();
	harness.organizationId = fixture.organizationId;
	harness.userId = fixture.ownerUserId;
	harness.now = "2026-01-31T11:00:00Z";
	harness.mail.mockReset().mockResolvedValue({ success: true });
	subjectUserId = (
		await fixture.pool.query("select user_id from employee where id=$1", [
			fixture.employeeId,
		])
	).rows[0].user_id;
	expect(
		(
			await policy.saveDrivingLicencePolicyAction({
				enabled: true,
				intervalMonths: 1,
				timezone: "Europe/Berlin",
				reminderLeadDays: [30, 7],
				retentionMonths: 36,
				retentionJustification:
					"Evidence retained for organization driving checks",
			})
		).success,
	).toBe(true);
	expect(
		(
			await policy.enrollDrivingLicenceEmployeeAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(true);
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: verifier.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
});
afterEach(async () => {
	await fixture?.close();
});

const tasks = await import("./task-actions");
it("routes terminal-only reminders to current verifiers and records personal completion without direct delivery", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	await fixture.pool.query('update "user" set email=$2 where id=$1', [
		subjectUserId,
		`terminal-${subjectUserId}@kiosk.invalid`,
	]);
	harness.now = "2026-02-21T10:00:00Z";
	await Promise.all([
		runDrivingLicenceRemindersJob(),
		runDrivingLicenceRemindersJob(),
	]);
	const first = await tasks.getDrivingLicenceTasksAction();
	expect(first.success && first.data).toMatchObject([
		{
			kind: "personal_reminder",
			state: "pending",
			employeeId: fixture.employeeId,
			directEmployeeNotification: "unavailable",
		},
	]);
	expect(first.success && first.data).toHaveLength(1);
	expect(first.success && first.data).toMatchObject([
		{
			occasion: {
				kind: "deadline",
				classCode: "B",
				validThrough: "2026-02-28",
			},
		},
	]);
	if (!first.success) throw new Error(first.error);
	const taskId = first.data[0].id;
	expect(
		(await tasks.completeDrivingLicencePersonalReminderAction({ taskId }))
			.success,
	).toBe(true);
	const done = await tasks.getDrivingLicenceTasksAction();
	expect(done.success && done.data).toMatchObject([
		{ state: "completed", directEmployeeNotification: "unavailable" },
	]);
	await runDrivingLicenceRemindersJob();
	expect((await tasks.getDrivingLicenceTasksAction()).success).toBe(true);
	expect(await inbox()).toHaveLength(0);
	harness.userId = fixture.ownerUserId;
	expect(
		(await tasks.completeDrivingLicencePersonalReminderAction({ taskId }))
			.success,
	).toBe(false);
});

it("escalates missing current verifier responsibility to admins with minimal assigning details and resolves after an explicit grant", async () => {
	const grantId = (
		await fixture.pool.query(
			"select id from driving_licence_verifier_grant where verifier_employee_id=$1 and revoked_at is null",
			[verifier.employeeId],
		)
	).rows[0].id;
	harness.userId = fixture.ownerUserId;
	expect(
		(await grants.revokeDrivingLicenceVerifierGrantAction({ grantId })).success,
	).toBe(true);
	await runDrivingLicenceRemindersJob();
	const missing = await tasks.getDrivingLicenceTasksAction();
	expect(missing.success && missing.data).toMatchObject([
		{ kind: "reassignment", state: "pending", employeeId: fixture.employeeId },
	]);
	if (!missing.success) throw new Error(missing.error);
	expect(missing.data[0]).not.toHaveProperty("classCode");
	expect(missing.data[0]).not.toHaveProperty("validThrough");
	expect(missing.data[0]).not.toHaveProperty("directEmployeeNotification");
	const notices = await inbox(fixture.ownerUserId);
	expect(notices).toHaveLength(1);
	expect(notices[0].actionUrl).toBe("/settings/driving-licence");
	await runDrivingLicenceRemindersJob();
	expect(await inbox(fixture.ownerUserId)).toHaveLength(1);
	expect(
		(
			await checks.getDrivingLicenceEmployeeRecordAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: verifier.employeeId,
				scope: "all",
				employeeIds: [],
				teamIds: [],
			})
		).success,
	).toBe(true);
	const resolved = await tasks.getDrivingLicenceTasksAction();
	expect(resolved.success && resolved.data).toMatchObject([
		{ kind: "reassignment", state: "completed" },
	]);
	harness.userId = verifier.userId;
	expect((await tasks.getDrivingLicenceTasksAction()).success).toBe(true);
});

it("links a verifier's personal reminder task notice to the employee's check page (#1429)", async () => {
	await fixture.pool.query('update "user" set email=$2 where id=$1', [
		subjectUserId,
		`terminal-${subjectUserId}@kiosk.invalid`,
	]);
	await runDrivingLicenceRemindersJob();
	expect(
		(await inbox(verifier.userId)).map((notice) => ({
			entityType: notice.entityType,
			actionUrl: notice.actionUrl,
		})),
	).toEqual([
		{
			entityType: "driving_licence_task",
			actionUrl: `/driving-licence/checks/${fixture.employeeId}`,
		},
	]);
});

it("creates initial terminal tasks and transfers visibility to current verifiers without granting administrators inspection access", async () => {
	await fixture.pool.query('update "user" set email=$2 where id=$1', [
		subjectUserId,
		`terminal-${subjectUserId}@kiosk.invalid`,
	]);
	await runDrivingLicenceRemindersJob();
	const initial = await tasks.getDrivingLicenceTasksAction();
	if (!initial.success) throw new Error(initial.error);
	expect(initial.data).toHaveLength(1);
	const taskId = initial.data[0].id;
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: verifier.employeeId,
				scope: "specific",
				employeeIds: [fixture.ownerEmployeeId],
				teamIds: [],
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
	expect((await tasks.getDrivingLicenceTasksAction()).success).toBe(true);
	const excluded = await tasks.getDrivingLicenceTasksAction();
	expect(excluded.success && excluded.data).toEqual([]);
	expect(
		(await tasks.completeDrivingLicencePersonalReminderAction({ taskId }))
			.success,
	).toBe(false);
	const replacement = await fixture.seedEmployee();
	harness.userId = fixture.ownerUserId;
	const pending = await tasks.getDrivingLicenceTasksAction();
	expect(pending.success && pending.data).toMatchObject([
		{ kind: "reassignment", state: "pending" },
	]);
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: replacement.employeeId,
				scope: "specific",
				employeeIds: [fixture.employeeId],
				teamIds: [],
			})
		).success,
	).toBe(true);
	harness.userId = replacement.userId;
	const transferred = await tasks.getDrivingLicenceTasksAction();
	expect(transferred.success && transferred.data).toMatchObject([
		{ id: taskId, kind: "personal_reminder", state: "pending" },
	]);
	expect(
		(await tasks.completeDrivingLicencePersonalReminderAction({ taskId }))
			.success,
	).toBe(true);
	const foreignOrg = await fixture.createOrganization();
	const foreign = await fixture.seedEmployee({
		organizationId: foreignOrg,
		role: "owner",
	});
	harness.organizationId = foreignOrg;
	harness.userId = foreign.userId;
	const hidden = await tasks.getDrivingLicenceTasksAction();
	expect(hidden.success && hidden.data).toEqual([]);
	expect(
		(await tasks.completeDrivingLicencePersonalReminderAction({ taskId }))
			.success,
	).toBe(false);
	harness.organizationId = fixture.organizationId;
	harness.userId = replacement.userId;
	await fixture.pool.query(
		"update employee_employment_period set status='closed',ended_at='2026-02-01T00:00:00Z' where id=$1",
		[fixture.employmentPeriodId],
	);
	await fixture.pool.query(
		"insert into employee_employment_period (organization_id,employee_id,status,started_at,start_provenance) values ($1,$2,'open','2026-02-02T00:00:00Z','recorded')",
		[fixture.organizationId, fixture.employeeId],
	);
	harness.now = "2026-02-02T10:00:00Z";
	const fresh = await tasks.getDrivingLicenceTasksAction();
	expect(fresh.success && fresh.data).toMatchObject([
		{ kind: "personal_reminder", state: "pending" },
	]);
	if (!fresh.success) throw new Error(fresh.error);
	expect(fresh.data[0].id).not.toBe(taskId);
	expect(
		(await tasks.completeDrivingLicencePersonalReminderAction({ taskId }))
			.success,
	).toBe(false);
});

it("restores a still-current terminal task after a personal route was temporarily available", async () => {
	await fixture.pool.query('update "user" set email=$2 where id=$1', [
		subjectUserId,
		`terminal-${subjectUserId}@kiosk.invalid`,
	]);
	await runDrivingLicenceRemindersJob();
	const before = await tasks.getDrivingLicenceTasksAction();
	if (!before.success) throw new Error(before.error);
	expect(before.data).toHaveLength(1);
	await fixture.pool.query('update "user" set email=$2 where id=$1', [
		subjectUserId,
		`${subjectUserId}@lifecycle.test`,
	]);
	const personal = await tasks.getDrivingLicenceTasksAction();
	expect(personal.success && personal.data).toEqual([]);
	await fixture.pool.query('update "user" set email=$2 where id=$1', [
		subjectUserId,
		`terminal-${subjectUserId}@kiosk.invalid`,
	]);
	const restored = await tasks.getDrivingLicenceTasksAction();
	expect(restored.success && restored.data).toMatchObject([
		{
			id: before.data[0].id,
			state: "pending",
			directEmployeeNotification: "unavailable",
		},
	]);
});

it("opens exactly one reassignment task for the employee an ended until-dated grant leaves uncovered", async () => {
	harness.userId = fixture.ownerUserId;
	const covered = await fixture.seedEmployee();
	const cover = await fixture.seedEmployee();
	expect(
		(
			await policy.enrollDrivingLicenceEmployeeAction({
				employeeId: covered.employeeId,
			})
		).success,
	).toBe(true);
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: cover.employeeId,
				scope: "specific",
				teamIds: [],
				employeeIds: [covered.employeeId],
			})
		).success,
	).toBe(true);
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: verifier.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
				until: "2026-02-10",
			})
		).success,
	).toBe(true);
	// Last moment of 10 February in Europe/Berlin: the grant still covers everyone.
	harness.now = "2026-02-10T22:59:59Z";
	await runDrivingLicenceRemindersJob();
	expect(await tasks.getDrivingLicenceTasksAction()).toEqual({
		success: true,
		data: [],
	});
	harness.userId = verifier.userId;
	expect(
		(
			await checks.getDrivingLicenceEmployeeRecordAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(true);
	harness.now = "2026-02-10T23:00:00Z";
	expect(
		(
			await checks.getDrivingLicenceEmployeeRecordAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(false);
	harness.userId = fixture.ownerUserId;
	await Promise.all([
		runDrivingLicenceRemindersJob(),
		runDrivingLicenceRemindersJob(),
	]);
	await runDrivingLicenceRemindersJob();
	const open = await tasks.getDrivingLicenceTasksAction();
	expect(open).toEqual({
		success: true,
		data: [
			expect.objectContaining({
				kind: "reassignment",
				state: "pending",
				employeeId: fixture.employeeId,
			}),
		],
	});
	const notices = await inbox(fixture.ownerUserId);
	expect(notices).toHaveLength(1);
	expect(notices[0].actionUrl).toBe("/settings/driving-licence");
});

it.each(["expired", "inactive", "terminal", "revoked"] as const)(
	"escalates an %s verifier and reopens assignment only for a new unavailability episode",
	async (unavailable) => {
		expect(
			(await checks.completeDrivingLicenceCheckAction(original())).success,
		).toBe(true);
		await fixture.pool.query('update "user" set email=$2 where id=$1', [
			subjectUserId,
			`terminal-${subjectUserId}@kiosk.invalid`,
		]);
		harness.userId = fixture.ownerUserId;
		if (unavailable === "expired")
			expect(
				(
					await grants.saveDrivingLicenceVerifierGrantAction({
						verifierEmployeeId: verifier.employeeId,
						scope: "all",
						employeeIds: [],
						teamIds: [],
						expiresAt: "2026-02-01T00:00:00Z",
					})
				).success,
			).toBe(true);
		if (unavailable === "inactive")
			await fixture.pool.query(
				"update employee set is_active=false where id=$1",
				[verifier.employeeId],
			);
		if (unavailable === "terminal")
			await fixture.pool.query('update "user" set email=$2 where id=$1', [
				verifier.userId,
				`terminal-${verifier.userId}@kiosk.invalid`,
			]);
		if (unavailable === "revoked") {
			const grantId = (
				await fixture.pool.query(
					"select id from driving_licence_verifier_grant where verifier_employee_id=$1 and revoked_at is null",
					[verifier.employeeId],
				)
			).rows[0].id;
			expect(
				(await grants.revokeDrivingLicenceVerifierGrantAction({ grantId }))
					.success,
			).toBe(true);
		}
		harness.now = "2026-02-21T10:00:00Z";
		await Promise.all([
			runDrivingLicenceRemindersJob(),
			runDrivingLicenceRemindersJob(),
		]);
		const pending = await tasks.getDrivingLicenceTasksAction();
		expect(pending.success && pending.data).toMatchObject([
			{ kind: "reassignment", state: "pending" },
		]);
		expect(await inbox(fixture.ownerUserId)).toHaveLength(1);
		expect(await inbox(subjectUserId)).toHaveLength(0);
		harness.userId = verifier.userId;
		const invisible = await tasks.getDrivingLicenceTasksAction();
		expect(invisible.success ? invisible.data : []).toEqual([]);
		harness.userId = fixture.ownerUserId;
		const replacement = await fixture.seedEmployee();
		expect(
			(
				await grants.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: replacement.employeeId,
					scope: "all",
					teamIds: [],
					employeeIds: [],
				})
			).success,
		).toBe(true);
		const resolved = await tasks.getDrivingLicenceTasksAction();
		expect(resolved.success && resolved.data).toMatchObject([
			{ kind: "reassignment", state: "completed" },
		]);
		const replacementId = (
			await fixture.pool.query(
				"select id from driving_licence_verifier_grant where verifier_employee_id=$1 and revoked_at is null",
				[replacement.employeeId],
			)
		).rows[0].id;
		expect(
			(
				await grants.revokeDrivingLicenceVerifierGrantAction({
					grantId: replacementId,
				})
			).success,
		).toBe(true);
		await runDrivingLicenceRemindersJob();
		expect(await inbox(fixture.ownerUserId)).toHaveLength(2);
		await runDrivingLicenceRemindersJob();
		expect(await inbox(fixture.ownerUserId)).toHaveLength(2);
		harness.userId = subjectUserId;
		const unchanged = await checks.getDrivingLicenceEmployeeRecordAction({
			employeeId: fixture.employeeId,
		});
		expect(unchanged.success && unchanged.data.authorizedClasses).toEqual([
			"B",
		]);
	},
);
