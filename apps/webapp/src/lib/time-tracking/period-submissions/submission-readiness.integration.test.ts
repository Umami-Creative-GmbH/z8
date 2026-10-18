/**
 * #1348 runtime evidence: period submission readiness reads the same preconditions as submitting,
 * on real rows, and writes nothing. Each case assesses a period, then submits it, and expects the
 * submission to agree with the assessment.
 *
 * Local contract: pnpm --filter webapp test:integration
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import {
	assessPeriodSubmissionReadiness,
	loadEmployeePeriodReadinessView,
	type PeriodSubmissionReadiness,
} from "./submission-readiness";
import { decidePeriodSubmission, submitPeriodSubmission } from "./submission-service";
import { withdrawOwnPeriodSubmission } from "./submission-withdrawal";

// A Monday-week cadence since January; Europe/Berlin, so the week 2026-03-02..08 is
// [2026-03-01T23:00Z, 2026-03-08T23:00Z).
const WEEK_START = "2026-03-02";
const LAST_DAY = parseInstant("2026-03-08T12:00:00Z");
const DAY_BEFORE = parseInstant("2026-03-07T12:00:00Z");
const TZ = "Europe/Berlin";
const at = (instant: Instant) => ({ nowInstant: () => instant });

describe("period submission readiness on PostgreSQL", () => {
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
		({ organizationId, ownerUserId } = await fixture.organization(TZ));
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

	const assess = (
		instant = LAST_DAY,
		input: { organizationId?: string; userId?: string; periodStartDate?: string } = {},
	) =>
		assessPeriodSubmissionReadiness(
			{
				organizationId: input.organizationId ?? organizationId,
				userId: input.userId ?? employee.userId,
				periodStartDate: input.periodStartDate ?? WEEK_START,
			},
			{ database: db, clock: at(instant) },
		);

	const submit = (instant = LAST_DAY, periodStartDate = WEEK_START) =>
		submitPeriodSubmission(
			{ organizationId, userId: employee.userId, periodStartDate },
			{ database: db, clock: at(instant) },
		);

	/** Assesses, then submits, and expects submitting to do what the assessment said. */
	async function expectAgreement(
		instant = LAST_DAY,
		periodStartDate = WEEK_START,
	): Promise<PeriodSubmissionReadiness> {
		const readiness = await assess(instant, { periodStartDate });
		const result = await submit(instant, periodStartDate);
		if (readiness.ready) {
			expect(result).toMatchObject({ kind: "submitted" });
		} else {
			expect(result).toMatchObject({ kind: "refused", reason: readiness.refusals[0] });
			if (result.kind === "refused" && result.reason === "period_open") {
				expect(readiness.blockers).toEqual(result.blockers);
			}
		}
		return readiness;
	}

	const work = (start: string, end: string | null, approvalStatus?: "approved" | "pending") =>
		fixture.work({
			organizationId,
			employeeId: employee.employeeId,
			userId: employee.userId,
			start,
			end,
			approvalStatus,
		});

	async function pendingWorkflowOn(workPeriodId: string, workflowType: string) {
		await fixture.pool.query(
			`insert into approval_workflow (id, organization_id, workflow_type, source_type, source_id,
				requester_employee_id, status, current_stage_order, version, policy_snapshot,
				context_snapshot, display_snapshot, submitted_at, created_at, updated_at)
			 values ($1, $2, $3, 'time_entry', $4, $5, 'pending', 1, 1, '{}', '{}', '{}', now(), now(), now())`,
			[randomUUID(), organizationId, workflowType, workPeriodId, employee.employeeId],
		);
	}

	async function pendingAssignment(workflowId: string) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`select id from approval_stage_assignment
			 where organization_id = $1 and workflow_id = $2 and status = 'pending'`,
			[organizationId, workflowId],
		);
		const [row] = rows;
		if (!row) throw new Error("no pending assignment");
		return row.id;
	}

	async function policy(stage: {
		approverType: "specific_employee" | "direct_manager" | "org_admin";
		approverEmployeeId?: string;
		fallback: "fail" | "organization_admin" | "default_manager";
	}) {
		const policyId = randomUUID();
		await fixture.pool.query(
			`insert into approval_policy (id, organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, $2, 'Periods', true, 1, $3, now())`,
			[policyId, organizationId, ownerUserId],
		);
		await fixture.pool.query(
			`insert into approval_policy_stage
			 (id, organization_id, policy_id, step_order, label, approver_type, approver_employee_id, fallback_behavior, updated_at)
			 values ($1, $2, $3, 1, 'Stage', $4, $5, $6, now())`,
			[
				randomUUID(),
				organizationId,
				policyId,
				stage.approverType,
				stage.approverEmployeeId ?? null,
				stage.fallback,
			],
		);
	}

	/** Every row a submission, a workflow start, an audit entry or a notification would write. */
	async function sideEffectCounts() {
		const counts: Record<string, number> = {};
		for (const table of [
			"period_submission",
			"approval_workflow",
			"approval_stage_assignment",
			"approval_workflow_event",
			"approval_outbox",
			"approval_workflow_rollout",
			"approval_submitted_revision",
			"audit_log",
			"notification",
		]) {
			const { rows } = await fixture.pool.query<{ count: number }>(
				`select count(*)::int as count from ${table} where organization_id = $1`,
				[organizationId],
			);
			counts[table] = rows[0]?.count ?? 0;
		}
		return counts;
	}

	it("is ready on the last day when nothing keeps the period open, and submitting succeeds", async () => {
		await work("2026-03-03T08:00:00Z", "2026-03-03T16:00:00Z");
		const readiness = await expectAgreement();
		expect(readiness).toEqual({
			ready: true,
			refusals: [],
			blockers: [],
			opensOn: "2026-03-08",
		});
	});

	it("writes no submission, workflow, audit entry or notification", async () => {
		await work("2026-03-08T08:00:00Z", null);
		await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-03-04",
			endDate: "2026-03-04",
			status: "pending",
		});
		const before = await sideEffectCounts();
		await assess();
		await assess(DAY_BEFORE);
		await loadEmployeePeriodReadinessView(
			{ organizationId, userId: employee.userId },
			{ database: db, clock: at(LAST_DAY) },
		);
		expect(await sideEffectCounts()).toEqual(before);
	});

	it("says when submitting opens before the last day and still lists what keeps the period open", async () => {
		const absence = await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-03-06",
			endDate: "2026-03-06",
			status: "pending",
		});
		const readiness = await expectAgreement(DAY_BEFORE);
		expect(readiness).toEqual({
			ready: false,
			refusals: ["period_not_ended", "period_open"],
			blockers: [
				{
					kind: "absence_request",
					absenceId: absence,
					startDate: "2026-03-06",
					endDate: "2026-03-06",
				},
			],
			opensOn: "2026-03-08",
		});
	});

	it("before the last day with nothing open, only the opening day keeps it from being ready", async () => {
		await expect(expectAgreement(DAY_BEFORE)).resolves.toEqual({
			ready: false,
			refusals: ["period_not_ended"],
			blockers: [],
			opensOn: "2026-03-08",
		});
	});

	it("lists live work that started in the period, but not live work that started before it", async () => {
		const live = await work("2026-03-08T08:00:00Z", null);
		const readiness = await expectAgreement();
		expect(readiness.refusals).toEqual(["period_open"]);
		expect(readiness.blockers).toEqual([
			{
				kind: "live_work",
				workPeriodId: live.workPeriodId,
				startTime: "2026-03-08T08:00:00.000Z",
				endTime: null,
				timezone: TZ,
			},
		]);
	});

	it("does not count live work started before the period", async () => {
		await work("2026-03-01T20:00:00Z", null);
		await expect(expectAgreement()).resolves.toMatchObject({ ready: true });
	});

	it("lists undecided manual work in both lifecycles, even in part, at the period boundary", async () => {
		// Starts on Sunday evening before the week (Berlin) and runs into Monday.
		const legacy = await work("2026-03-01T22:30:00Z", "2026-03-02T01:00:00Z", "pending");
		const canonical = await work("2026-03-04T08:00:00Z", "2026-03-04T12:00:00Z");
		await pendingWorkflowOn(canonical.workPeriodId, "manual_time_submission");
		// Ends exactly where the week starts: outside.
		await work("2026-03-01T20:00:00Z", "2026-03-01T23:00:00Z", "pending");
		// Starts exactly where the week ends: outside.
		await work("2026-03-08T23:00:00Z", "2026-03-09T01:00:00Z", "pending");

		const readiness = await expectAgreement();
		expect(
			readiness.blockers.map((blocker) => [
				blocker.kind,
				"workPeriodId" in blocker && blocker.workPeriodId,
			]),
		).toEqual([
			["manual_work", legacy.workPeriodId],
			["manual_work", canonical.workPeriodId],
		]);
	});

	it("lists undecided time corrections in both lifecycles", async () => {
		const corrected = await work("2026-03-03T08:00:00Z", "2026-03-03T16:00:00Z");
		await pendingWorkflowOn(corrected.workPeriodId, "time_correction");
		const legacy = await work("2026-03-08T20:00:00Z", "2026-03-08T23:30:00Z");
		await fixture.pool.query(
			`insert into approval_request (organization_id, entity_type, entity_id, requested_by, approver_id, status, updated_at)
			 values ($1, 'time_entry', $2, $3, $4, 'pending', now())`,
			[organizationId, legacy.workPeriodId, employee.employeeId, manager.employeeId],
		);
		const readiness = await expectAgreement();
		expect(
			readiness.blockers.map((blocker) => [
				blocker.kind,
				"workPeriodId" in blocker && blocker.workPeriodId,
			]),
		).toEqual([
			["time_correction", corrected.workPeriodId],
			["time_correction", legacy.workPeriodId],
		]);
	});

	it("lists undecided absence requests overlapping the period, even in part", async () => {
		const pending = await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-02-27",
			endDate: "2026-03-02",
			status: "pending",
		});
		await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-03-09",
			endDate: "2026-03-10",
			status: "pending",
		});
		await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-03-03",
			endDate: "2026-03-03",
			status: "approved",
		});
		const readiness = await expectAgreement();
		expect(readiness.blockers).toEqual([
			{
				kind: "absence_request",
				absenceId: pending,
				startDate: "2026-02-27",
				endDate: "2026-03-02",
			},
		]);
	});

	it("keeps a submitted or approved period's status and never calls it ready", async () => {
		const first = await submit();
		if (first.kind !== "submitted") throw new Error("not submitted");
		await expect(expectAgreement()).resolves.toEqual({
			ready: false,
			refusals: ["already_submitted"],
			blockers: [],
			opensOn: "2026-03-08",
		});
		await decidePeriodSubmission(
			{
				organizationId,
				actorEmployeeId: manager.employeeId,
				assignmentId: await pendingAssignment(first.workflowId),
				action: "approve",
			},
			{ database: db, clock: at(parseInstant("2026-03-09T09:00:00Z")) },
		);
		await expect(expectAgreement()).resolves.toMatchObject({
			ready: false,
			refusals: ["already_submitted"],
		});
	});

	it("is ready again after a rejection or a withdrawal", async () => {
		const first = await submit();
		if (first.kind !== "submitted") throw new Error("not submitted");
		await decidePeriodSubmission(
			{
				organizationId,
				actorEmployeeId: manager.employeeId,
				assignmentId: await pendingAssignment(first.workflowId),
				action: "reject",
				reason: "Friday is missing",
			},
			{ database: db, clock: at(parseInstant("2026-03-09T09:00:00Z")) },
		);
		await expect(assess()).resolves.toMatchObject({ ready: true });
		await expect(expectAgreement()).resolves.toMatchObject({ ready: true });
		await withdrawOwnPeriodSubmission(
			{ organizationId, userId: employee.userId, periodStartDate: WEEK_START },
			{ database: db, clock: at(LAST_DAY) },
		);
		await expect(expectAgreement()).resolves.toMatchObject({ ready: true });
	});

	it("follows a matching policy rather than the manager", async () => {
		const approver = await fixture.employee({ organizationId });
		await policy({
			approverType: "specific_employee",
			approverEmployeeId: approver.employeeId,
			fallback: "fail",
		});
		await expect(expectAgreement()).resolves.toMatchObject({ ready: true });
	});

	it("is not ready when a policy names only the employee with a fail fallback", async () => {
		await policy({
			approverType: "specific_employee",
			approverEmployeeId: employee.employeeId,
			fallback: "fail",
		});
		await expect(expectAgreement()).resolves.toEqual({
			ready: false,
			refusals: ["no_approver"],
			blockers: [],
			opensOn: "2026-03-08",
		});
	});

	it("is ready when a policy naming the employee falls back to the admins", async () => {
		await policy({
			approverType: "specific_employee",
			approverEmployeeId: employee.employeeId,
			fallback: "organization_admin",
		});
		await expect(expectAgreement()).resolves.toMatchObject({ ready: true });
	});

	it("is not ready without a manager or a matching policy", async () => {
		await fixture.pool.query("delete from employee_managers where employee_id = $1", [
			employee.employeeId,
		]);
		await expect(expectAgreement()).resolves.toMatchObject({
			ready: false,
			refusals: ["no_approver"],
		});
	});

	it("is not ready when the only manager is inactive", async () => {
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			manager.employeeId,
		]);
		await expect(expectAgreement()).resolves.toMatchObject({
			ready: false,
			refusals: ["no_approver"],
		});
	});

	it("reports every obstacle together: not ended, open and without an approver", async () => {
		await fixture.pool.query("delete from employee_managers where employee_id = $1", [
			employee.employeeId,
		]);
		await work("2026-03-07T08:00:00Z", null);
		await expect(expectAgreement(DAY_BEFORE)).resolves.toMatchObject({
			ready: false,
			refusals: ["period_not_ended", "period_open", "no_approver"],
		});
	});

	it("refuses a period the employee is not expected to submit", async () => {
		await expect(assess(LAST_DAY, { periodStartDate: "2026-03-03" })).resolves.toEqual({
			ready: false,
			refusals: ["not_expected"],
			blockers: [],
			opensOn: null,
		});
		await expect(assess(LAST_DAY, { periodStartDate: "not-a-date" })).resolves.toMatchObject({
			refusals: ["not_expected"],
		});
		await expect(expectAgreement(LAST_DAY, "2026-03-03")).resolves.toMatchObject({
			ready: false,
		});
	});

	it("is scoped to the organization and the signed-in user's own employee", async () => {
		const other = await fixture.organization(TZ);
		await expect(assess(LAST_DAY, { organizationId: other.organizationId })).resolves.toEqual({
			ready: false,
			refusals: ["not_employee"],
			blockers: [],
			opensOn: null,
		});
		// Another employee's open work never shows in, or blocks, this employee's period.
		await fixture.work({
			organizationId,
			employeeId: manager.employeeId,
			userId: manager.userId,
			start: "2026-03-08T08:00:00Z",
			end: null,
		});
		await expect(assess()).resolves.toMatchObject({ ready: true, blockers: [] });
		// An inactive employee has nothing to assess.
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			employee.employeeId,
		]);
		await expect(assess()).resolves.toMatchObject({ refusals: ["not_employee"] });
	});

	it("does not stop submitting from refusing an obstacle that appears after a ready result", async () => {
		await expect(assess()).resolves.toMatchObject({ ready: true });
		const absence = await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-03-05",
			endDate: "2026-03-05",
			status: "pending",
		});
		await expect(submit()).resolves.toMatchObject({ kind: "refused", reason: "period_open" });
		await expect(assess()).resolves.toMatchObject({
			ready: false,
			blockers: [{ kind: "absence_request", absenceId: absence }],
		});
	});

	it("assesses every displayed period of the employee's period view", async () => {
		const submitted = await submit(LAST_DAY, "2026-02-23");
		expect(submitted).toMatchObject({ kind: "submitted" });
		await work("2026-03-04T08:00:00Z", null);
		const view = await loadEmployeePeriodReadinessView(
			{ organizationId, userId: employee.userId },
			{ database: db, clock: at(parseInstant("2026-03-10T09:00:00Z")) },
		);
		expect(view?.timezone).toBe(TZ);
		const byStart = new Map(view?.periods.map((period) => [period.startDate, period]));
		expect(byStart.get("2026-03-09")).toMatchObject({
			status: "awaiting_submission",
			readiness: { ready: false, refusals: ["period_not_ended"], opensOn: "2026-03-15" },
		});
		expect(byStart.get(WEEK_START)).toMatchObject({
			status: "awaiting_submission",
			readiness: { ready: false, refusals: ["period_open"] },
		});
		expect(byStart.get(WEEK_START)?.readiness.blockers).toHaveLength(1);
		expect(byStart.get("2026-02-23")).toMatchObject({
			status: "submitted",
			readiness: { ready: false, refusals: ["already_submitted"] },
		});
		expect(byStart.get("2026-02-16")).toMatchObject({
			status: "awaiting_submission",
			readiness: { ready: true },
		});
	});

	it("has no view for a user without an employee in the organization", async () => {
		const other = await fixture.organization(TZ);
		await expect(
			loadEmployeePeriodReadinessView(
				{ organizationId: other.organizationId, userId: employee.userId },
				{ database: db, clock: at(LAST_DAY) },
			),
		).resolves.toBeNull();
	});
});
