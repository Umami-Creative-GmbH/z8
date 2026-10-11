/**
 * Spec #805 runtime evidence: an overdue period submission uses the existing escalation. The
 * scheduled processor moves the pending assignment to the employee's backup manager, who then
 * decides it like the original approver would have.
 *
 * Local contract: pnpm --filter webapp test:integration
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";

vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);

const { db } = await import("@/db");
const { createClosedMonthDatabaseFixture } = await import(
	"@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture"
);
const { decidePeriodSubmission, submitPeriodSubmission } = await import(
	"@/lib/time-tracking/period-submissions/submission-service"
);
const { processDueEscalations } = await import("./transfer");

type Fixture = Awaited<ReturnType<typeof createClosedMonthDatabaseFixture>>;
type Person = { employeeId: string; userId: string };

// Submitted on the last day of the Monday week 2026-03-02..08; the response window is one hour.
const SUBMITTED_AT = parseInstant("2026-03-08T12:00:00Z");

describe("an overdue period submission on PostgreSQL", () => {
	let fixture: Fixture;
	let organizationId: string;
	let employee: Person;
	let manager: Person;
	let backup: Person;

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture.close();
	});

	beforeEach(async () => {
		const organization = await fixture.organization("Europe/Berlin");
		organizationId = organization.organizationId;
		employee = await fixture.employee({ organizationId });
		manager = await fixture.employee({ organizationId });
		backup = await fixture.employee({ organizationId });
		await fixture.pool.query("update employee set role = 'manager' where id = any($1::uuid[])", [
			[manager.employeeId, backup.employeeId],
		]);
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $3, $4, true, $6), ($2, $3, $5, false, $6)`,
			[
				randomUUID(),
				randomUUID(),
				employee.employeeId,
				manager.employeeId,
				backup.employeeId,
				organization.ownerUserId,
			],
		);
		await fixture.submissionCadence({
			organizationId,
			cadence: "weekly",
			changedAt: "2026-01-01T00:00:00Z",
			changedBy: organization.ownerUserId,
		});
		await fixture.pool.query(
			`insert into approval_escalation_control
			 (organization_id, owner, automation_paused, escalation_owned_since)
			 values ($1, 'escalation', false, '2026-01-01T00:00:00Z')`,
			[organizationId],
		);
		await fixture.pool.query(
			`insert into approval_escalation_policy
			 (organization_id, enabled, response_window_hours, revision, migration_provenance)
			 values ($1, true, 1, 1, '{"source":"t805"}'::jsonb)`,
			[organizationId],
		);
	});

	async function pendingAssignments(workflowId: string) {
		const { rows } = await fixture.pool.query<{ id: string; approver_employee_id: string }>(
			`select id, approver_employee_id from approval_stage_assignment
			 where organization_id = $1 and workflow_id = $2 and status = 'pending'`,
			[organizationId, workflowId],
		);
		return rows;
	}

	it("moves to the backup manager, who decides it", async () => {
		const submitted = await submitPeriodSubmission(
			{ organizationId, userId: employee.userId, periodStartDate: "2026-03-02" },
			{ database: db, clock: { nowInstant: () => SUBMITTED_AT } },
		);
		if (submitted.kind !== "submitted") throw new Error(`not submitted: ${submitted.reason}`);
		expect(submitted.approverEmployeeIds).toEqual([manager.employeeId]);

		await expect(
			processDueEscalations({ organizationId, now: SUBMITTED_AT.add({ minutes: 30 }) }),
		).resolves.toMatchObject({ status: "processed", transferred: 0 });
		const summary = await processDueEscalations({
			organizationId,
			now: SUBMITTED_AT.add({ hours: 2 }),
		});
		expect(summary).toMatchObject({ status: "processed", transferred: 1, failed: 0 });

		const [replacement, ...others] = await pendingAssignments(submitted.workflowId);
		expect(others).toEqual([]);
		expect(replacement?.approver_employee_id).toBe(backup.employeeId);
		if (!replacement) return;
		await expect(
			decidePeriodSubmission(
				{
					organizationId,
					actorEmployeeId: backup.employeeId,
					assignmentId: replacement.id,
					action: "approve",
				},
				// The transfer commits on the real clock, so the decision follows it.
				{ database: db },
			),
		).resolves.toMatchObject({ status: "approved" });
	});
});
