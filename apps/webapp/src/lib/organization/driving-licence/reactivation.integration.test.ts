import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import type { SendEmailParams } from "@/lib/email/email-service";
import { saveConfirmedIntendedDriverAssignment } from "./testing/control.test.fixture";

const harness = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-01-31T11:00:00Z",
	mail: vi.fn(async (_message: SendEmailParams) => ({ success: true })),
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
vi.mock("@/lib/email/email-service", () => ({ sendEmail: harness.mail }));
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
vi.setConfig({ testTimeout: 90_000 });

const policy = await import("./policy-actions");
const checks = await import("./check-actions");
const grants = await import("./verifier-actions");
const { runDrivingLicenceRemindersJob } = await import("@/lib/jobs/driving-licence-reminders");
const { runDrivingLicenceRetentionJob } = await import("@/lib/jobs/driving-licence-retention");
const { getUserNotifications } = await import("@/lib/notifications/notification-service");

type Person = { userId: string; employeeId: string; email: string };
type Organization = {
	id: string;
	adminUserId: string;
	verifier: Person;
	/** Valid through 28 February: overdue while switched off. */
	overdue: Person;
	/** Valid through 10 March: still in date when switched on again on 5 March. */
	inDate: Person;
};

let fixture: LifecycleDatabaseFixture;

async function person(seeded: { userId: string; employeeId: string }): Promise<Person> {
	const { rows } = await fixture.pool.query('select email from "user" where id=$1', [
		seeded.userId,
	]);
	return { userId: seeded.userId, employeeId: seeded.employeeId, email: rows[0].email };
}
function actAs(organizationId: string, userId: string) {
	harness.organizationId = organizationId;
	harness.userId = userId;
}
async function check(org: Organization, subject: Person, classes: string[]) {
	actAs(org.id, org.verifier.userId);
	const result = await checks.completeDrivingLicenceCheckAction({
		employeeId: subject.employeeId,
		commandId: crypto.randomUUID(),
		originalInspected: true,
		identityConfirmed: true,
		employeeDeclaration: true,
		verifierConfirmed: true,
		documentIssuedOn: "2020-05-01",
		documentExpiresOn: "2035-05-01",
		classes: classes.map((code) => ({
			code,
			result: "successful",
			expiryDate: null,
			restrictions: "",
		})),
	});
	if (!result.success) throw new Error(result.error);
}
async function expectSuccess(result: Promise<{ success: boolean; error?: string }>) {
	expect(await result).toMatchObject({ success: true });
}

/**
 * Switched on 31 January with reminders 30, 7 and 1 day ahead; checks on 31 January
 * and 10 February; switched off on 12 February.
 */
async function prepare(org: Organization) {
	harness.now = "2026-01-31T11:00:00Z";
	actAs(org.id, org.adminUserId);
	await expectSuccess(
		policy.switchDrivingLicenceControlAction({
			enabled: true,
			setup: {
				intervalMonths: 1,
				timezone: "Europe/Berlin",
				retentionMonths: 6,
				retentionJustification: "Necessary evidence for organization driving checks",
			},
		}),
	);
	await expectSuccess(
		policy.saveDrivingLicencePolicyAction({
			intervalMonths: 1,
			timezone: "Europe/Berlin",
			reminderLeadDays: [30, 7, 1],
			retentionMonths: 6,
			retentionJustification: "Necessary evidence for organization driving checks",
		}),
	);
	for (const subject of [org.overdue, org.inDate])
		await expectSuccess(
			saveConfirmedIntendedDriverAssignment({
				target: { type: "employee", employeeId: subject.employeeId },
				value: "required",
			}),
		);
	await expectSuccess(
		grants.saveDrivingLicenceVerifierGrantAction({
			verifierEmployeeId: org.verifier.employeeId,
			scope: "all",
			teamIds: [],
			employeeIds: [],
		}),
	);
	await check(org, org.overdue, ["B", "BE"]);
	await runDrivingLicenceRemindersJob();
	harness.now = "2026-02-10T09:00:00Z";
	await check(org, org.inDate, ["B"]);
	await runDrivingLicenceRemindersJob();
	harness.now = "2026-02-12T09:00:00Z";
	actAs(org.id, org.adminUserId);
	await expectSuccess(policy.switchDrivingLicenceControlAction({ enabled: false }));
}

async function inbox(org: Organization, who: Person) {
	const { notifications } = await getUserNotifications(who.userId, org.id, { limit: 100 });
	return {
		suspended: notifications.filter((n) => n.type === "driving_authorization_suspended").length,
		reminders: notifications.filter((n) => n.type === "driving_licence_reminder").length,
	};
}
function mailsTo(who: Person) {
	return harness.mail.mock.calls.filter(([message]) => message.to === who.email).length;
}

async function seedOrganization(
	organizationId: string,
	adminUserId: string,
	existing?: Pick<SeededEmployee, "userId" | "employeeId">,
) {
	const overdue = existing ?? (await fixture.seedEmployee({ organizationId }));
	return {
		id: organizationId,
		adminUserId,
		verifier: await person(await fixture.seedEmployee({ organizationId })),
		overdue: await person(overdue),
		inDate: await person(await fixture.seedEmployee({ organizationId })),
	} satisfies Organization;
}

let org: Organization;
let other: Organization;

beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	harness.mail.mockReset().mockResolvedValue({ success: true });
	const { rows } = await fixture.pool.query("select user_id from employee where id=$1", [
		fixture.employeeId,
	]);
	org = await seedOrganization(fixture.organizationId, fixture.ownerUserId, {
		userId: rows[0].user_id,
		employeeId: fixture.employeeId,
	});
	const otherId = await fixture.createOrganization();
	const otherAdmin = await fixture.seedEmployee({ organizationId: otherId, role: "admin" });
	other = await seedOrganization(otherId, otherAdmin.userId);
	await prepare(org);
	await prepare(other);
});
afterEach(async () => {
	await fixture?.close();
});

describe("switching driving licence control on again", () => {
	it("counts the authorizations it will suspend before the switch-on", async () => {
		// Retention cleanup suspends the overdue authorizations silently while off.
		harness.now = "2026-03-02T09:00:00Z";
		await runDrivingLicenceRetentionJob();
		harness.now = "2026-03-05T09:00:00Z";
		actAs(org.id, org.adminUserId);
		expect(await policy.getDrivingLicenceReactivationImpactAction()).toEqual({
			success: true,
			data: { suspendedAuthorizations: 2 },
		});
		actAs(org.id, org.verifier.userId);
		expect(await policy.getDrivingLicenceReactivationImpactAction()).toEqual({
			success: false,
			error: "forbidden",
		});

		// The count equals what the switch-on suspends: one notice each.
		const before = (await inbox(org, org.overdue)).suspended;
		actAs(org.id, org.adminUserId);
		await expectSuccess(policy.switchDrivingLicenceControlAction({ enabled: true }));
		expect((await inbox(org, org.overdue)).suspended - before).toBe(2);
		expect(await policy.getDrivingLicenceReactivationImpactAction()).toEqual({
			success: true,
			data: { suspendedAuthorizations: 0 },
		});
	});

	it("sends exactly one suspension notice per overdue authorization and no catch-up reminders", async () => {
		harness.now = "2026-03-05T09:00:00Z";
		const before = {
			overdue: await inbox(org, org.overdue),
			inDate: await inbox(org, org.inDate),
			verifier: await inbox(org, org.verifier),
		};
		harness.mail.mockClear();
		actAs(org.id, org.adminUserId);
		expect(await policy.switchDrivingLicenceControlAction({ enabled: true })).toEqual({
			success: true,
			data: { enabled: true, firstActivation: false },
		});
		// One notice per class (B and BE), to the employee and the responsible verifier.
		expect(await inbox(org, org.overdue)).toEqual({
			...before.overdue,
			suspended: before.overdue.suspended + 2,
		});
		expect(await inbox(org, org.verifier)).toEqual({
			...before.verifier,
			suspended: before.verifier.suspended + 2,
		});
		expect(await inbox(org, org.inDate)).toEqual(before.inDate);

		// The job runs again: the notices are not repeated, and the 7-day reminder
		// due on 3 March (while off) is skipped, not caught up.
		await runDrivingLicenceRemindersJob();
		await runDrivingLicenceRemindersJob();
		expect((await inbox(org, org.overdue)).suspended).toBe(before.overdue.suspended + 2);
		expect((await inbox(org, org.verifier)).suspended).toBe(before.verifier.suspended + 2);
		expect(await inbox(org, org.inDate)).toEqual(before.inDate);
		// The optional emails follow the usual delivery: one per notice.
		expect(mailsTo(org.overdue)).toBe(2);
		expect(mailsTo(org.verifier)).toBe(2);
		expect(mailsTo(org.inDate)).toBe(0);

		// Later reminders follow the usual schedule: the 1-day reminder on 9 March.
		harness.now = "2026-03-09T09:00:00Z";
		await runDrivingLicenceRemindersJob();
		expect(await inbox(org, org.inDate)).toEqual({
			...before.inDate,
			reminders: before.inDate.reminders + 1,
		});
		expect((await inbox(org, org.overdue)).suspended).toBe(before.overdue.suspended + 2);
	});

	it("brings back tasks that were open at switch-off without notifying again", async () => {
		const tasks = await import("./task-actions");
		harness.now = "2026-03-05T09:00:00Z";
		actAs(org.id, org.adminUserId);
		await expectSuccess(policy.switchDrivingLicenceControlAction({ enabled: true }));
		// A terminal-only intended driver (no personal route) gets a personal reminder task for
		// the verifier; the verifier as intended driver is uncovered (never their own verifier).
		const terminal = await person(await fixture.seedEmployee({ organizationId: org.id }));
		await fixture.pool.query('update "user" set email=$2 where id=$1', [
			terminal.userId,
			`terminal-${terminal.userId}@kiosk.invalid`,
		]);
		for (const subject of [terminal, org.verifier])
			await expectSuccess(
				saveConfirmedIntendedDriverAssignment({
					target: { type: "employee", employeeId: subject.employeeId },
					value: "required",
				}),
			);
		await runDrivingLicenceRemindersJob();
		async function open(userId: string) {
			actAs(org.id, userId);
			const result = await tasks.getDrivingLicenceTasksAction();
			if (!result.success) throw new Error(result.error);
			return result.data.map((task) => [task.kind, task.employeeId, task.state]);
		}
		async function taskNotices() {
			let count = 0;
			for (const userId of [org.adminUserId, org.verifier.userId]) {
				const { notifications } = await getUserNotifications(userId, org.id, { limit: 100 });
				count += notifications.filter((n) => n.entityType === "driving_licence_task").length;
			}
			return count;
		}
		const adminTasks = await open(org.adminUserId);
		const verifierTasks = await open(org.verifier.userId);
		expect(adminTasks).toContainEqual(["reassignment", org.verifier.employeeId, "pending"]);
		expect(verifierTasks).toContainEqual(["personal_reminder", terminal.employeeId, "pending"]);
		const before = await taskNotices();
		expect(before).toBeGreaterThanOrEqual(2);

		actAs(org.id, org.adminUserId);
		await expectSuccess(policy.switchDrivingLicenceControlAction({ enabled: false }));
		expect(await open(org.adminUserId)).toEqual([]);
		harness.now = "2026-03-06T09:00:00Z";
		actAs(org.id, org.adminUserId);
		await expectSuccess(policy.switchDrivingLicenceControlAction({ enabled: true }));
		await runDrivingLicenceRemindersJob();
		await runDrivingLicenceRemindersJob();
		expect(await open(org.adminUserId)).toEqual(adminTasks);
		expect(await open(org.verifier.userId)).toEqual(verifierTasks);
		expect(await taskNotices()).toBe(before);
	});

	it("leaves another organization alone", async () => {
		harness.now = "2026-03-05T09:00:00Z";
		const before = {
			overdue: await inbox(other, other.overdue),
			verifier: await inbox(other, other.verifier),
		};
		harness.mail.mockClear();
		actAs(org.id, org.adminUserId);
		await expectSuccess(policy.switchDrivingLicenceControlAction({ enabled: true }));
		await runDrivingLicenceRemindersJob();
		expect(await inbox(other, other.overdue)).toEqual(before.overdue);
		expect(await inbox(other, other.verifier)).toEqual(before.verifier);
		expect(mailsTo(other.overdue)).toBe(0);
		actAs(other.id, other.adminUserId);
		expect(await policy.getDrivingLicenceReactivationImpactAction()).toEqual({
			success: true,
			data: { suspendedAuthorizations: 2 },
		});
	});
});
