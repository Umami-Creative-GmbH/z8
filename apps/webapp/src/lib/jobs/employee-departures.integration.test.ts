/**
 * PostgreSQL contract (#1437 review fix 1): the maintenance scan delivers a
 * deactivation's follow-up work (approval handover, review notices) while the
 * offboarding release gate is closed, the only state deactivation runs in.
 * A departure's follow-up work stays behind the gate as before.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { createNotification } = vi.hoisted(() => ({ createNotification: vi.fn() }));
vi.mock("@/lib/notifications/notification-service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/notifications/notification-service")>()),
	createNotification,
	insertInAppNotification: vi.fn(async () => ({ id: randomUUID() })),
	deliverNotificationToChannel: vi.fn(async () => undefined),
}));
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return { ...original, createLogger: () => quiet };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { runEmployeeDepartureMaintenance } = await import("./employee-departures");
const { EMPLOYEE_OFFBOARDING_RELEASE_READY } = await import("@/lib/employee-lifecycle/release");
const { AuditTrail } = await import("@/lib/audit-trail");
const { dateFromInstant, systemClock } = await import("@/lib/datetime/temporal-core");
const { insertDeactivation } = await import("@/lib/employee-lifecycle/receipts");
const { applyApprovalDuties, planApprovalDuties } = await import(
	"@/lib/employee-lifecycle/deactivation/approval-duties"
);
const { enableCanonicalAbsences, seedPendingAbsenceWorkflow } = await import(
	"@/lib/employee-lifecycle/testing/approval-workflow.test.fixture"
);
const { createLifecycleDatabaseFixture } = await import(
	"@/lib/employee-lifecycle/testing/database.test.fixture"
);
type LifecycleDatabaseFixture =
	import("@/lib/employee-lifecycle/testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee =
	import("@/lib/employee-lifecycle/testing/database.test.fixture").SeededEmployee;

describe("employee departure maintenance with the release gate closed", () => {
	let fixture: LifecycleDatabaseFixture;
	const submittedAt = systemClock.nowInstant().subtract({ hours: 48 });

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			fixture.organizationId,
		]);
		await enableCanonicalAbsences(fixture, new Date(submittedAt.epochMilliseconds));
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function link(report: SeededEmployee, manager: SeededEmployee, isPrimary: boolean) {
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, $4)`,
			[report.employeeId, manager.employeeId, isPrimary, fixture.ownerUserId],
		);
	}

	/** Deactivates `leaving` the way the deactivation transaction captures their duties. */
	async function deactivateWithDuties(leaving: SeededEmployee): Promise<string> {
		const at = systemClock.nowInstant().subtract({ minutes: 1 });
		const context = {
			organizationId: fixture.organizationId,
			employeeId: leaving.employeeId,
			at,
			organizationTimeZone: "Europe/Berlin",
			employmentPeriodId: leaving.employmentPeriodId,
			replacementManagers: {},
			replaceManagers: true,
		};
		const plan = await planApprovalDuties(fixture.db, context);
		return fixture.db.transaction(async (tx) => {
			const { id } = await insertDeactivation(tx, {
				organizationId: fixture.organizationId,
				employeeId: leaving.employeeId,
				employmentPeriodId: leaving.employmentPeriodId,
				deactivatedAt: at,
				createdBy: fixture.ownerUserId,
				reason: "employee_deactivated",
				requestId: randomUUID(),
				requestFingerprint: "fingerprint",
				replacementManagers: {},
			});
			await tx.execute(sql`
				update employee set is_active = false, deactivated_at = ${dateFromInstant(at)}
				where organization_id = ${fixture.organizationId} and id = ${leaving.employeeId}::uuid
			`);
			await applyApprovalDuties(
				tx,
				{
					...context,
					actorUserId: fixture.ownerUserId,
					deactivationId: id,
					reason: "employee_deactivated",
					audit: new AuditTrail(),
				},
				plan,
			);
			return id;
		});
	}

	/** A pending follow-up task of a departure, due now. */
	async function seedDepartureTask(person: SeededEmployee): Promise<string> {
		const departure = await fixture.pool.query<{ id: string }>(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2030-01-31', 'UTC', '2030-01-31T23:00:00Z', $4,
			         gen_random_uuid(), 'test', 1, 'pending')
			 returning id`,
			[fixture.organizationId, person.employeeId, person.employmentPeriodId, fixture.ownerUserId],
		);
		const task = await fixture.pool.query<{ id: string }>(
			`insert into employee_departure_task
			 (organization_id, employee_id, employment_period_id, departure_id, kind, dedupe_key, available_at)
			 values ($1, $2, $3, $4, 'clock_repair', $5, now() - interval '1 minute')
			 returning id`,
			[
				fixture.organizationId,
				person.employeeId,
				person.employmentPeriodId,
				departure.rows[0]?.id,
				`test:${randomUUID()}`,
			],
		);
		return task.rows[0]?.id as string;
	}

	async function taskStatus(taskId: string) {
		const result = await fixture.pool.query<{ status: string; payload: Record<string, unknown> }>(
			`select status, payload from employee_departure_task where organization_id = $1 and id = $2`,
			[fixture.organizationId, taskId],
		);
		return result.rows[0];
	}

	it("hands a deactivation's approval duty over, and leaves a departure's work behind the gate", async () => {
		expect(EMPLOYEE_OFFBOARDING_RELEASE_READY).toBe(false);
		const leaving = await fixture.seedEmployee({ role: "admin" });
		const otherManager = await fixture.seedEmployee({ role: "admin" });
		const report = await fixture.seedEmployee();
		await link(report, leaving, true);
		await link(report, otherManager, false);
		const duty = await seedPendingAbsenceWorkflow(fixture, {
			requester: report,
			approverEmployeeIds: [leaving.employeeId],
			at: new Date(submittedAt.epochMilliseconds),
		});
		const deactivationId = await deactivateWithDuties(leaving);
		const departureTaskId = await seedDepartureTask(await fixture.seedEmployee());
		const handover = await fixture.pool.query<{ id: string }>(
			`select id from employee_departure_task
			 where organization_id = $1 and deactivation_id = $2 and kind = 'approval_handover'`,
			[fixture.organizationId, deactivationId],
		);
		expect(handover.rows).toHaveLength(1);

		const result = await runEmployeeDepartureMaintenance();

		expect(result.released).toBe(false);
		expect(result.departures.processed).toBe(0);
		expect(await taskStatus(handover.rows[0]?.id as string)).toMatchObject({
			status: "completed",
			payload: expect.objectContaining({ outcome: "transferred" }),
		});
		const approvers = await fixture.pool.query<{ approver_employee_id: string }>(
			`select approver_employee_id from approval_stage_assignment
			 where organization_id = $1 and workflow_id = $2 and status = 'pending'`,
			[fixture.organizationId, duty.workflow],
		);
		expect(approvers.rows.map((row) => row.approver_employee_id)).toEqual([
			otherManager.employeeId,
		]);
		expect(await taskStatus(departureTaskId)).toMatchObject({ status: "pending" });
	});
});
