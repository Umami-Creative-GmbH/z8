/**
 * #1059 runtime evidence: submitting a period and deciding the period submission, on real rows.
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
import {
	decidePeriodSubmission,
	PeriodSubmissionDecisionError,
	submitPeriodSubmission,
} from "./submission-service";

// A Monday-week cadence since January; the employees work in Europe/Berlin.
const WEEK_START = "2026-03-02";
const LAST_DAY = parseInstant("2026-03-08T12:00:00Z");
const DAY_BEFORE = parseInstant("2026-03-07T12:00:00Z");
const at = (instant: ReturnType<typeof parseInstant>) => ({ nowInstant: () => instant });

describe("period submissions on PostgreSQL", () => {
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

	const submit = (instant = LAST_DAY, user = employee) =>
		submitPeriodSubmission(
			{ organizationId, userId: user.userId, periodStartDate: WEEK_START },
			{ database: db, clock: at(instant) },
		);

	const decide = (
		assignmentId: string,
		action: "approve" | "reject",
		options: { actor?: string; reason?: string | null } = {},
	) =>
		decidePeriodSubmission(
			{
				organizationId,
				actorEmployeeId: options.actor ?? manager.employeeId,
				assignmentId,
				action,
				reason: options.reason ?? null,
			},
			{ database: db, clock: at(parseInstant("2026-03-09T09:00:00Z")) },
		);

	async function pendingAssignment(workflowId: string) {
		const { rows } = await fixture.pool.query<{ id: string; approver_employee_id: string }>(
			`select id, approver_employee_id from approval_stage_assignment
			 where organization_id = $1 and workflow_id = $2 and status = 'pending'`,
			[organizationId, workflowId],
		);
		return rows;
	}

	async function submissionRows() {
		const { rows } = await fixture.pool.query<{
			status: string;
			decision_reason: string | null;
			start_date: string;
			end_date: string;
			range_start: Date;
			range_end: Date;
			timezone: string;
		}>(
			`select status, decision_reason, start_date::text, end_date::text, range_start, range_end, timezone
			 from period_submission where organization_id = $1 order by submitted_at, created_at`,
			[organizationId],
		);
		return rows;
	}

	async function auditActions() {
		const { rows } = await fixture.pool.query<{ action: string; performed_by: string }>(
			`select action, performed_by from audit_log
			 where organization_id = $1 and entity_type = 'period_submission' order by timestamp, action`,
			[organizationId],
		);
		return rows;
	}

	async function legacyRequests() {
		const { rows } = await fixture.pool.query<{ count: number }>(
			"select count(*)::int as count from approval_request where organization_id = $1",
			[organizationId],
		);
		return rows[0]?.count;
	}

	it("refuses a period before its last day", async () => {
		await expect(submit(DAY_BEFORE)).resolves.toEqual({
			kind: "refused",
			reason: "period_not_ended",
		});
		expect(await submissionRows()).toEqual([]);
	});

	it("refuses a period the employee is not expected to submit", async () => {
		await expect(
			submitPeriodSubmission(
				{ organizationId, userId: employee.userId, periodStartDate: "2026-03-03" },
				{ database: db, clock: at(LAST_DAY) },
			),
		).resolves.toEqual({ kind: "refused", reason: "not_expected" });
	});

	it("submits on the last day to the primary manager, fixing the range, with no legacy request", async () => {
		await fixture.work({
			organizationId,
			employeeId: employee.employeeId,
			userId: employee.userId,
			start: "2026-03-02T07:00:00Z",
			end: "2026-03-02T15:30:00Z",
		});
		const result = await submit();
		expect(result).toMatchObject({ kind: "submitted", approverEmployeeIds: [manager.employeeId] });
		if (result.kind !== "submitted") return;

		expect(await submissionRows()).toEqual([
			{
				status: "pending",
				decision_reason: null,
				start_date: "2026-03-02",
				end_date: "2026-03-08",
				range_start: new Date("2026-03-01T23:00:00Z"),
				range_end: new Date("2026-03-08T23:00:00Z"),
				timezone: "Europe/Berlin",
			},
		]);
		const { rows: revisions } = await fixture.pool.query<{
			facts: { work: { totalMinutes: number } };
		}>(
			"select facts from approval_submitted_revision where organization_id = $1 and workflow_id = $2",
			[organizationId, result.workflowId],
		);
		expect(revisions.map((revision) => revision.facts.work.totalMinutes)).toEqual([510]);
		const { rows: rollout } = await fixture.pool.query(
			`select lifecycle_mode::text as mode from approval_workflow_rollout
			 where organization_id = $1 and workflow_type = 'period_submission'`,
			[organizationId],
		);
		expect(rollout).toEqual([{ mode: "complete" }]);
		expect(await legacyRequests()).toBe(0);
		expect(await auditActions()).toEqual([
			{ action: "period_submission.submitted", performed_by: employee.userId },
		]);
		await expect(submit()).resolves.toEqual({ kind: "refused", reason: "already_submitted" });
	});

	it("captures the period's absences, holidays, target and recorded violations, read for its range only", async () => {
		// The employee's account predates the week, so the work policy's target covers all of it.
		await fixture.pool.query(
			`update "user" set created_at = '2026-01-01T00:00:00Z'
			 where id = (select user_id from employee where id = $1)`,
			[employee.employeeId],
		);
		const policyId = randomUUID();
		const scheduleId = randomUUID();
		await fixture.pool.query(
			`insert into work_policy (id, organization_id, name, schedule_enabled, regulation_enabled, created_by, updated_at)
			 values ($1, $2, 'Weekdays', true, false, $3, now())`,
			[policyId, organizationId, ownerUserId],
		);
		await fixture.pool.query(
			`insert into work_policy_schedule (id, policy_id, schedule_cycle, schedule_type, working_days_preset, updated_at)
			 values ($1, $2, 'weekly', 'detailed', 'custom', now())`,
			[scheduleId, policyId],
		);
		for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday"]) {
			await fixture.pool.query(
				`insert into work_policy_schedule_day (schedule_id, day_of_week, hours_per_day, is_work_day)
				 values ($1, $2, '8.00', true)`,
				[scheduleId, day],
			);
		}
		await fixture.pool.query(
			`insert into work_policy_assignment (policy_id, organization_id, assignment_type, employee_id, priority, created_by, updated_at)
			 values ($1, $2, 'employee', $3, 2, $4, now())`,
			[policyId, organizationId, employee.employeeId, ownerUserId],
		);
		const holidayCategoryId = randomUUID();
		await fixture.pool.query(
			`insert into holiday_category (id, organization_id, type, name, updated_at)
			 values ($1, $2, 'public_holiday', 'Public', now())`,
			[holidayCategoryId, organizationId],
		);
		for (const [name, date] of [
			["Founders' Day", "2026-03-06"],
			["Next week", "2026-03-09"],
		]) {
			await fixture.pool.query(
				`insert into holiday (organization_id, category_id, name, start_date, end_date, created_by, updated_at)
				 values ($1, $2, $3, $4, $4, $5, now())`,
				[organizationId, holidayCategoryId, name, new Date(`${date}T00:00:00Z`), ownerUserId],
			);
		}
		await fixture.pool.query(
			`insert into holiday_category_assignment (category_id, organization_id, assignment_type, created_by, updated_at)
			 values ($1, $2, 'organization', $3, now())`,
			[holidayCategoryId, organizationId, ownerUserId],
		);
		await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-02-27",
			endDate: "2026-03-04",
		});
		await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-03-10",
			endDate: "2026-03-10",
		});
		await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-03-05",
			endDate: "2026-03-05",
			// Not approved, so not captured. (A pending one would refuse the submission, #1060.)
			status: "rejected",
		});
		for (const [at, type] of [
			["2026-03-01 23:30:00", "max_daily"], // 00:30 on Monday in Berlin
			["2026-03-05 16:00:00", "break_required"],
			["2026-03-01 22:30:00", "rest_period"], // Sunday before the week in Berlin
			["2026-03-08 23:30:00", "max_weekly"], // Monday after the week in Berlin
		]) {
			await fixture.pool.query(
				`insert into work_policy_violation (employee_id, organization_id, violation_date, violation_type)
				 values ($1, $2, $3, $4)`,
				[employee.employeeId, organizationId, at, type],
			);
		}
		await fixture.work({
			organizationId,
			employeeId: employee.employeeId,
			userId: employee.userId,
			start: "2026-03-05T07:00:00Z",
			end: "2026-03-05T16:00:00Z",
		});

		const result = await submit();
		if (result.kind !== "submitted") throw new Error(`not submitted: ${result.reason}`);
		const { rows } = await fixture.pool.query<{ facts: Record<string, unknown> }>(
			"select facts from approval_submitted_revision where organization_id = $1 and workflow_id = $2",
			[organizationId, result.workflowId],
		);
		expect(rows[0]?.facts).toMatchObject({
			work: { totalMinutes: 540, dayTotals: { "2026-03-05": 540 } },
			absences: [
				{
					categoryName: "Vacation",
					startDate: "2026-03-02",
					startPeriod: "full_day",
					endDate: "2026-03-04",
					endPeriod: "full_day",
				},
			],
			holidays: [{ name: "Founders' Day", startDate: "2026-03-06", endDate: "2026-03-06" }],
			// Monday to Wednesday are absent and Friday is a holiday: only Thursday has a target.
			target: { totalMinutes: 480, dayTargets: { "2026-03-05": 480 } },
			violations: [
				{ date: "2026-03-02", type: "max_daily" },
				{ date: "2026-03-05", type: "break_required" },
			],
		});
	});

	it("captures no target when no work policy gives one", async () => {
		const result = await submit();
		if (result.kind !== "submitted") throw new Error(`not submitted: ${result.reason}`);
		const { rows } = await fixture.pool.query<{ facts: Record<string, unknown> }>(
			"select facts from approval_submitted_revision where organization_id = $1 and workflow_id = $2",
			[organizationId, result.workflowId],
		);
		expect(rows[0]?.facts).toMatchObject({
			work: { totalMinutes: 0, dayTotals: {} },
			absences: [],
			holidays: [],
			target: null,
			violations: [],
		});
	});

	it("routes by a matching period submission policy before the primary manager", async () => {
		const approver = await fixture.employee({ organizationId });
		const policyId = randomUUID();
		await fixture.pool.query(
			`insert into approval_policy (id, organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, $2, 'Periods', true, 1, $3, now())`,
			[policyId, organizationId, ownerUserId],
		);
		await fixture.pool.query(
			`insert into approval_policy_condition
			 (id, organization_id, policy_id, condition_type, operator, value_json, updated_at)
			 values ($1, $2, $3, 'approval_type', 'in', '{"values":["period_submission"]}', now())`,
			[randomUUID(), organizationId, policyId],
		);
		await fixture.pool.query(
			`insert into approval_policy_stage
			 (id, organization_id, policy_id, step_order, label, approver_type, approver_employee_id, fallback_behavior, updated_at)
			 values ($1, $2, $3, 1, 'Payroll', 'specific_employee', $4, 'fail', now())`,
			[randomUUID(), organizationId, policyId, approver.employeeId],
		);
		await expect(submit()).resolves.toMatchObject({
			kind: "submitted",
			approverEmployeeIds: [approver.employeeId],
		});
	});

	it("approves, with an audit entry, and refuses the employee deciding their own submission", async () => {
		const result = await submit();
		if (result.kind !== "submitted") throw new Error("not submitted");
		const [assignment] = await pendingAssignment(result.workflowId);
		if (!assignment) throw new Error("no assignment");

		await expect(
			decide(assignment.id, "approve", { actor: employee.employeeId }),
		).rejects.toThrow();
		await expect(decide(assignment.id, "approve")).resolves.toMatchObject({ status: "approved" });

		expect((await submissionRows()).map((row) => row.status)).toEqual(["approved"]);
		expect(await auditActions()).toEqual([
			{ action: "period_submission.submitted", performed_by: employee.userId },
			{ action: "period_submission.approved", performed_by: manager.userId },
		]);
		await expect(submit()).resolves.toEqual({ kind: "refused", reason: "already_submitted" });
		expect(await legacyRequests()).toBe(0);
	});

	it("needs a reason to reject, and a rejected period can be submitted again", async () => {
		const first = await submit();
		if (first.kind !== "submitted") throw new Error("not submitted");
		const [assignment] = await pendingAssignment(first.workflowId);
		if (!assignment) throw new Error("no assignment");

		await expect(decide(assignment.id, "reject", { reason: "  " })).rejects.toBeInstanceOf(
			PeriodSubmissionDecisionError,
		);
		await expect(
			decide(assignment.id, "reject", { reason: "Friday is missing" }),
		).resolves.toMatchObject({ status: "rejected" });

		const view = await loadEmployeePeriodView(db, {
			organizationId,
			employeeId: employee.employeeId,
			now: parseInstant("2026-03-10T09:00:00Z"),
		});
		expect(view?.periods.find((period) => period.startDate === WEEK_START)).toMatchObject({
			status: "rejected",
			rejectionReason: "Friday is missing",
			canSubmit: true,
		});

		const second = await submit();
		expect(second).toMatchObject({ kind: "submitted", approverEmployeeIds: [manager.employeeId] });
		if (second.kind !== "submitted") return;
		expect(second.workflowId).not.toBe(first.workflowId);
		expect((await submissionRows()).map((row) => [row.status, row.decision_reason])).toEqual([
			["rejected", "Friday is missing"],
			["pending", null],
		]);
		expect((await auditActions()).map((row) => row.action).sort()).toEqual([
			"period_submission.rejected",
			"period_submission.submitted",
			"period_submission.submitted",
		]);
		expect(await legacyRequests()).toBe(0);
	});

	it("goes to an admin, never to the employee, when the employee is their own approver", async () => {
		const policyId = randomUUID();
		await fixture.pool.query(
			`insert into approval_policy (id, organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, $2, 'Self', true, 1, $3, now())`,
			[policyId, organizationId, ownerUserId],
		);
		await fixture.pool.query(
			`insert into approval_policy_stage
			 (id, organization_id, policy_id, step_order, label, approver_type, approver_employee_id, fallback_behavior, updated_at)
			 values ($1, $2, $3, 1, 'Self', 'specific_employee', $4, 'fail', now())`,
			[randomUUID(), organizationId, policyId, employee.employeeId],
		);
		const result = await submit();
		expect(result).toMatchObject({ kind: "submitted" });
		if (result.kind !== "submitted") return;
		expect(result.approverEmployeeIds).not.toContain(employee.employeeId);
		expect(result.approverEmployeeIds.length).toBeGreaterThan(0);
	});

	it("is scoped to the organization", async () => {
		const other = await fixture.organization("Europe/Berlin");
		await expect(
			submitPeriodSubmission(
				{
					organizationId: other.organizationId,
					userId: employee.userId,
					periodStartDate: WEEK_START,
				},
				{ database: db, clock: at(LAST_DAY) },
			),
		).resolves.toEqual({ kind: "refused", reason: "not_employee" });
		const result = await submit();
		if (result.kind !== "submitted") throw new Error("not submitted");
		const [assignment] = await pendingAssignment(result.workflowId);
		if (!assignment) throw new Error("no assignment");
		await expect(
			decidePeriodSubmission(
				{
					organizationId: other.organizationId,
					actorEmployeeId: manager.employeeId,
					assignmentId: assignment.id,
					action: "approve",
				},
				{ database: db },
			),
		).rejects.toBeInstanceOf(PeriodSubmissionDecisionError);
	});
});
