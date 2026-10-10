/**
 * #1060 runtime evidence: an employee withdraws their own pending period submission, on real rows.
 *
 * Local contract: pnpm --filter webapp test:integration
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import { loadEmployeePeriodView } from "./employee-period-view-store";
import { decidePeriodSubmission, submitPeriodSubmission } from "./submission-service";
import {
	withdrawOwnPeriodSubmission,
	withdrawPeriodSubmissionInTransaction,
} from "./submission-withdrawal";

// A Monday-week cadence since January; the employees work in Europe/Berlin.
const WEEK_START = "2026-03-02";
const LAST_DAY = parseInstant("2026-03-08T12:00:00Z");
const WITHDRAWN_AT = parseInstant("2026-03-08T15:30:00Z");
const at = (instant: ReturnType<typeof parseInstant>) => ({ nowInstant: () => instant });

describe("period submission withdrawal on PostgreSQL", () => {
	let fixture: ClosedMonthDatabaseFixture;
	let organizationId: string;
	let ownerUserId: string;
	let employee: { employeeId: string; userId: string };
	let manager: { employeeId: string; userId: string };

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture.close();
	});

	beforeEach(async () => {
		({ organizationId, ownerUserId } = await fixture.organization("Europe/Berlin"));
		employee = await fixture.employee({ organizationId });
		manager = await fixture.employee({ organizationId });
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[randomUUID(), employee.employeeId, manager.employeeId, ownerUserId],
		);
		await fixture.pool.query(
			`insert into period_submission_cadence_change
			 (id, organization_id, cadence, week_start_day, changed_at)
			 values ($1, $2, 'weekly', 'monday', '2026-01-01T00:00:00Z')`,
			[randomUUID(), organizationId],
		);
	});

	async function submit() {
		const result = await submitPeriodSubmission(
			{ organizationId, userId: employee.userId, periodStartDate: WEEK_START },
			{ database: db, clock: at(LAST_DAY) },
		);
		if (result.kind !== "submitted") throw new Error(`not submitted: ${result.reason}`);
		return result;
	}

	const withdraw = (user = employee) =>
		withdrawOwnPeriodSubmission(
			{ organizationId, userId: user.userId, periodStartDate: WEEK_START },
			{ database: db, clock: at(WITHDRAWN_AT) },
		);

	async function workflowState(workflowId: string) {
		const { rows } = await fixture.pool.query<{ workflow: string; assignments: string[] }>(
			`select w.status as workflow,
			  array(select a.status::text from approval_stage_assignment a
			        where a.organization_id = w.organization_id and a.workflow_id = w.id) as assignments
			 from approval_workflow w where w.organization_id = $1 and w.id = $2`,
			[organizationId, workflowId],
		);
		return rows[0];
	}

	it("withdraws a pending submission: the approval is cancelled and the period awaits submission", async () => {
		const submitted = await submit();

		await expect(withdraw()).resolves.toEqual({
			kind: "withdrawn",
			submissionId: submitted.submissionId,
			workflowId: submitted.workflowId,
		});

		expect(await workflowState(submitted.workflowId)).toEqual({
			workflow: "cancelled",
			assignments: ["cancelled"],
		});
		const view = await loadEmployeePeriodView(db, {
			organizationId,
			employeeId: employee.employeeId,
			now: WITHDRAWN_AT,
		});
		expect(view?.periods.find((period) => period.startDate === WEEK_START)).toMatchObject({
			status: "awaiting_submission",
			canSubmit: true,
		});
		const { rows: audit } = await fixture.pool.query<{
			action: string;
			performed_by: string;
			timestamp: Date;
			metadata: string;
		}>(
			`select action, performed_by, timestamp, metadata from audit_log
			 where organization_id = $1 and entity_type = 'period_submission'
			   and action = 'period_submission.withdrawn'`,
			[organizationId],
		);
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({ performed_by: employee.userId });
		expect(audit[0]?.timestamp.toISOString()).toBe("2026-03-08T15:30:00.000Z");
		expect(JSON.parse(audit[0]?.metadata ?? "{}")).toMatchObject({
			closedCause: "employee",
			at: "2026-03-08T15:30:00Z",
		});

		// The period can be submitted again, with a new submission.
		const again = await submit();
		expect(again.submissionId).not.toBe(submitted.submissionId);
	});

	it("refuses to withdraw an approved or rejected submission", async () => {
		const approved = await submit();
		const assignment = await pendingAssignment(approved.workflowId);
		await decidePeriodSubmission(
			{ organizationId, actorEmployeeId: manager.employeeId, assignmentId: assignment, action: "approve" },
			{ database: db, clock: at(WITHDRAWN_AT) },
		);
		await expect(withdraw()).resolves.toEqual({ kind: "refused", reason: "not_pending" });

		// Rejected: the period has no live submission any more.
		await fixture.pool.query(
			"update period_submission set status = 'rejected', decision_reason = 'x' where organization_id = $1",
			[organizationId],
		);
		await expect(withdraw()).resolves.toEqual({ kind: "refused", reason: "not_pending" });
		const { rows } = await fixture.pool.query(
			`select count(*)::int as count from audit_log
			 where organization_id = $1 and action = 'period_submission.withdrawn'`,
			[organizationId],
		);
		expect(rows).toEqual([{ count: 0 }]);
	});

	it("only withdraws the employee's own submission", async () => {
		await submit();
		await expect(withdraw(manager)).resolves.toEqual({ kind: "refused", reason: "not_pending" });
		const other = await fixture.organization("Europe/Berlin");
		await expect(
			withdrawOwnPeriodSubmission(
				{ organizationId: other.organizationId, userId: employee.userId, periodStartDate: WEEK_START },
				{ database: db, clock: at(WITHDRAWN_AT) },
			),
		).resolves.toEqual({ kind: "refused", reason: "not_employee" });
	});

	it("withdraws after a change inside the writer's transaction, as whoever made the change (#1062)", async () => {
		const first = await submit();
		const byManager = await db.transaction((tx) =>
			withdrawPeriodSubmissionInTransaction(
				tx,
				{
					organizationId,
					submissionId: first.submissionId,
					cause: "change",
					actor: { kind: "user", userId: manager.userId },
				},
				{ clock: at(WITHDRAWN_AT) },
			),
		);
		expect(byManager).toMatchObject({ kind: "withdrawn" });
		expect(await workflowState(first.workflowId)).toMatchObject({ workflow: "cancelled" });

		const second = await submit();
		await db.transaction(async (tx) => {
			await expect(
				withdrawPeriodSubmissionInTransaction(
					tx,
					{
						organizationId,
						submissionId: second.submissionId,
						cause: "change",
						actor: { kind: "system" },
					},
					{ clock: at(WITHDRAWN_AT) },
				),
			).resolves.toMatchObject({ kind: "withdrawn" });
		});

		const view = await loadEmployeePeriodView(db, {
			organizationId,
			employeeId: employee.employeeId,
			now: WITHDRAWN_AT,
		});
		expect(view?.periods.find((period) => period.startDate === WEEK_START)).toMatchObject({
			status: "sent_back_after_change",
			canSubmit: true,
		});
		const { rows } = await fixture.pool.query<{ performed_by: string; metadata: string }>(
			`select performed_by, metadata from audit_log
			 where organization_id = $1 and action = 'period_submission.withdrawn'
			 order by entity_id = $2 desc`,
			[organizationId, first.submissionId],
		);
		expect(
			rows.map((row) => {
				const metadata = JSON.parse(row.metadata) as { closedCause: string; automatic?: boolean };
				return [row.performed_by, metadata.closedCause, metadata.automatic ?? false];
			}),
		).toEqual([
			[manager.userId, "change", false],
			[employee.userId, "change", true],
		]);
	});

	it("rolls the withdrawal back with the writer's transaction", async () => {
		const submitted = await submit();
		await expect(
			db.transaction(async (tx) => {
				await withdrawPeriodSubmissionInTransaction(
					tx,
					{
						organizationId,
						submissionId: submitted.submissionId,
						cause: "change",
						actor: { kind: "system" },
					},
					{ clock: at(WITHDRAWN_AT) },
				);
				throw new Error("writer failed");
			}),
		).rejects.toThrow("writer failed");
		expect(await workflowState(submitted.workflowId)).toMatchObject({ workflow: "pending" });
		const { rows } = await fixture.pool.query(
			"select status from period_submission where organization_id = $1",
			[organizationId],
		);
		expect(rows).toEqual([{ status: "pending" }]);
	});

	async function pendingAssignment(workflowId: string) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`select id from approval_stage_assignment
			 where organization_id = $1 and workflow_id = $2 and status = 'pending'`,
			[organizationId, workflowId],
		);
		const id = rows[0]?.id;
		if (!id) throw new Error("no assignment");
		return id;
	}
});
