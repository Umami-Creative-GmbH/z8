/**
 * #1348 runtime evidence: period submission readiness reads the same preconditions as submitting,
 * on real rows, and writes nothing. Each case reads the employee's period view with readiness (the
 * read the period card makes), then submits the period, and expects the submission to agree with
 * what the view said.
 *
 * Local contract: pnpm --filter webapp test:integration
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Pass-through, except where a case makes the stage resolver throw as a lost connection would.
const resolverFailure = vi.hoisted(() => ({ throws: false }));
vi.mock("@/lib/approvals/routing/stage-activation-resolver", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/approvals/routing/stage-activation-resolver")>();
	return {
		...actual,
		createDatabaseStageActivationResolver: (
			...args: Parameters<typeof actual.createDatabaseStageActivationResolver>
		) => {
			const resolver = actual.createDatabaseStageActivationResolver(...args);
			return {
				resolve: async (input: Parameters<typeof resolver.resolve>[0]) => {
					if (resolverFailure.throws) throw new Error("connection terminated");
					return resolver.resolve(input);
				},
			};
		},
	};
});

import { db } from "@/db";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import {
	loadEmployeePeriodReadinessView,
	type PeriodSubmissionReadiness,
} from "./submission-readiness";
import { decidePeriodSubmission, submitPeriodSubmission } from "./submission-service";
import { withdrawOwnPeriodSubmission } from "./submission-withdrawal";

// A Monday-week cadence since January; Europe/Berlin, so the week 2026-03-02..08 is
// [2026-03-01T23:00Z, 2026-03-08T23:00Z).
const WEEK_START = "2026-03-02";
const PERIOD_START = "2026-03-01T23:00:00Z";
const PERIOD_END = "2026-03-08T23:00:00Z";
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
		resolverFailure.throws = false;
		({ organizationId, ownerUserId } = await fixture.organization(TZ));
		employee = await fixture.employee({ organizationId });
		manager = await fixture.employee({ organizationId });
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			manager.employeeId,
		]);
		await managedBy(manager.employeeId);
		await fixture.pool.query(
			`insert into period_submission_cadence_change
			 (id, organization_id, cadence, week_start_day, changed_at)
			 values ($1, $2, 'weekly', 'monday', '2026-01-01T00:00:00Z')`,
			[randomUUID(), organizationId],
		);
	});

	async function managedBy(managerEmployeeId: string) {
		await fixture.pool.query("delete from employee_managers where employee_id = $1", [
			employee.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[randomUUID(), employee.employeeId, managerEmployeeId, ownerUserId],
		);
	}

	/** The read the period card makes: the signed-in user's period view with readiness. */
	const readView = (instant = LAST_DAY, input: { organizationId?: string; userId?: string } = {}) =>
		loadEmployeePeriodReadinessView(
			{
				organizationId: input.organizationId ?? organizationId,
				userId: input.userId ?? employee.userId,
			},
			{ database: db, clock: at(instant) },
		);

	/** One period's readiness as the view shows it; null when the view does not show the period. */
	async function assess(
		instant = LAST_DAY,
		periodStartDate = WEEK_START,
	): Promise<PeriodSubmissionReadiness | null> {
		const view = await readView(instant);
		return view?.periods.find((period) => period.startDate === periodStartDate)?.readiness ?? null;
	}

	const submit = (instant = LAST_DAY, periodStartDate = WEEK_START) =>
		submitPeriodSubmission(
			{ organizationId, userId: employee.userId, periodStartDate },
			{ database: db, clock: at(instant) },
		);

	/**
	 * Reads the view, then submits, and expects submitting to do what the view said: submitted when
	 * it said ready, else refused with its first refusal (and the same blockers). A period the view
	 * does not show is one submitting does not expect.
	 */
	async function expectAgreement(
		instant = LAST_DAY,
		periodStartDate = WEEK_START,
	): Promise<PeriodSubmissionReadiness | null> {
		const readiness = await assess(instant, periodStartDate);
		const result = await submit(instant, periodStartDate);
		if (!readiness) {
			expect(result).toEqual({ kind: "refused", reason: "not_expected" });
		} else if (readiness.ready) {
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

	const blockerIds = (readiness: PeriodSubmissionReadiness | null) =>
		readiness?.blockers.map((blocker) => [
			blocker.kind,
			"workPeriodId" in blocker && blocker.workPeriodId,
		]);

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

	/** The approver left; their effective departure names `replacementEmployeeId`, if any. */
	async function departed(approverEmployeeId: string, replacementEmployeeId: string | null) {
		await fixture.pool.query(
			"update employee set is_active = false, end_date = '2026-02-27' where id = $1",
			[approverEmployeeId],
		);
		const { rows } = await fixture.pool.query<{ id: string }>(
			"select id from employee_employment_period where employee_id = $1 limit 1",
			[approverEmployeeId],
		);
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, replacement_employee_id, revision, status, created_by, request_id,
			  request_fingerprint, effective_at)
			 values ($1, $2, $3, 'scheduled', '2026-02-27', 'Europe/Berlin', '2026-02-27T23:00:00Z',
			  $4, 1, 'effective', $5, $6, 'fingerprint', '2026-02-27T23:00:00Z')`,
			[
				organizationId,
				approverEmployeeId,
				rows[0]?.id,
				replacementEmployeeId,
				ownerUserId,
				randomUUID(),
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
		await readView();
		await readView(DAY_BEFORE);
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
		expect(readiness?.refusals).toEqual(["period_open"]);
		expect(readiness?.blockers).toEqual([
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

	it("counts live work started exactly at the period's first instant", async () => {
		const live = await work(PERIOD_START, null);
		const readiness = await expectAgreement();
		expect(blockerIds(readiness)).toEqual([["live_work", live.workPeriodId]]);
	});

	it("does not count live work started exactly at the period's end instant", async () => {
		await work(PERIOD_END, null);
		await expect(expectAgreement()).resolves.toMatchObject({ ready: true, blockers: [] });
	});

	it("lists undecided manual work in both lifecycles, even in part, at the period boundary", async () => {
		// Starts on Sunday evening before the week (Berlin) and runs into Monday.
		const legacy = await work("2026-03-01T22:30:00Z", "2026-03-02T01:00:00Z", "pending");
		const canonical = await work("2026-03-04T08:00:00Z", "2026-03-04T12:00:00Z");
		await pendingWorkflowOn(canonical.workPeriodId, "manual_time_submission");
		// Ends exactly where the week starts: outside.
		await work("2026-03-01T20:00:00Z", PERIOD_START, "pending");
		// Starts exactly where the week ends: outside.
		await work(PERIOD_END, "2026-03-09T01:00:00Z", "pending");

		const readiness = await expectAgreement();
		expect(blockerIds(readiness)).toEqual([
			["manual_work", legacy.workPeriodId],
			["manual_work", canonical.workPeriodId],
		]);
	});

	it("bounds a period that crosses a daylight saving change by its own local midnights", async () => {
		// Berlin moves to summer time on 2026-03-29: the week 03-23..29 is
		// [2026-03-22T23:00Z, 2026-03-29T22:00Z).
		const crossesStart = await work("2026-03-22T22:30:00Z", "2026-03-22T23:30:00Z", "pending");
		const endsAtEnd = await work("2026-03-29T21:00:00Z", "2026-03-29T22:00:00Z", "pending");
		await work("2026-03-29T22:00:00Z", "2026-03-29T23:00:00Z", "pending");
		const readiness = await expectAgreement(parseInstant("2026-03-29T12:00:00Z"), "2026-03-23");
		expect(readiness).toMatchObject({ ready: false, opensOn: "2026-03-29" });
		expect(blockerIds(readiness)).toEqual([
			["manual_work", crossesStart.workPeriodId],
			["manual_work", endsAtEnd.workPeriodId],
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
		expect(blockerIds(readiness)).toEqual([
			["time_correction", corrected.workPeriodId],
			["time_correction", legacy.workPeriodId],
		]);
	});

	it("says whether My Requests lists a pending correction, which keeps the period open either way", async () => {
		const listed = await work("2026-03-03T08:00:00Z", "2026-03-03T16:00:00Z");
		const unlisted = await work("2026-03-04T08:00:00Z", "2026-03-04T16:00:00Z");
		const insertRequest = (workPeriodId: string, metadata: unknown) =>
			fixture.pool.query(
				`insert into approval_request (organization_id, entity_type, entity_id, requested_by, approver_id, status, metadata, updated_at)
				 values ($1, 'time_entry', $2, $3, $4, 'pending', $5, now())`,
				[organizationId, workPeriodId, employee.employeeId, manager.employeeId, metadata],
			);
		// A correction My Requests shows (and lets the employee cancel)...
		await insertRequest(listed.workPeriodId, {
			timeCorrection: { action: "edit", workLocationType: "home", workCategoryId: null },
		});
		// ...and a legacy request it cannot classify, so it never shows it.
		await insertRequest(unlisted.workPeriodId, null);
		const readiness = await expectAgreement();
		expect(readiness?.blockers).toMatchObject([
			{ kind: "time_correction", workPeriodId: listed.workPeriodId, listedInMyRequests: true },
			{ kind: "time_correction", workPeriodId: unlisted.workPeriodId, listedInMyRequests: false },
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
		expect(readiness?.blockers).toEqual([
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

	it("is not ready when a direct-manager policy finds only the employee as their own manager", async () => {
		await managedBy(employee.employeeId);
		await policy({ approverType: "direct_manager", fallback: "fail" });
		await expect(expectAgreement()).resolves.toMatchObject({
			ready: false,
			refusals: ["no_approver"],
		});
	});

	it("routes a policy naming a departed approver to their replacement", async () => {
		const approver = await fixture.employee({ organizationId });
		await departed(approver.employeeId, manager.employeeId);
		await policy({
			approverType: "specific_employee",
			approverEmployeeId: approver.employeeId,
			fallback: "fail",
		});
		await expect(expectAgreement()).resolves.toMatchObject({ ready: true });
	});

	it("is not ready when a policy names a departed approver without a replacement", async () => {
		const approver = await fixture.employee({ organizationId });
		await departed(approver.employeeId, null);
		await policy({
			approverType: "specific_employee",
			approverEmployeeId: approver.employeeId,
			fallback: "fail",
		});
		await expect(expectAgreement()).resolves.toMatchObject({
			ready: false,
			refusals: ["no_approver"],
		});
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

	it("fails the read when the approver could not be resolved, rather than claim there is none", async () => {
		resolverFailure.throws = true;
		await expect(readView()).rejects.toThrow();
		// Submitting keeps its own answer: a failed activation refuses as no approver.
		await expect(submit()).resolves.toEqual({ kind: "refused", reason: "no_approver" });
	});

	it("is not ready while the write gate refuses period submissions, and submitting refuses the same", async () => {
		await fixture.pool.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'period_submission', 'legacy', 'legacy', now(), now())
			 on conflict (organization_id, workflow_type)
			 do update set lifecycle_mode = 'legacy', side_effect_mode = 'legacy'`,
			[organizationId],
		);
		const before = await sideEffectCounts();
		await expect(expectAgreement()).resolves.toEqual({
			ready: false,
			refusals: ["write_gate_closed"],
			blockers: [],
			opensOn: "2026-03-08",
		});
		expect(await sideEffectCounts()).toEqual(before);
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

	it("shows no period the employee is not expected to submit, and submitting refuses it", async () => {
		await expect(expectAgreement(LAST_DAY, "2026-03-03")).resolves.toBeNull();
	});

	it("is scoped to the organization and the signed-in user's own employee", async () => {
		const other = await fixture.organization(TZ);
		await expect(readView(LAST_DAY, { organizationId: other.organizationId })).resolves.toBeNull();
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
		// Another employee's open work never shows in, or blocks, this employee's period.
		await fixture.work({
			organizationId,
			employeeId: manager.employeeId,
			userId: manager.userId,
			start: "2026-03-08T08:00:00Z",
			end: null,
		});
		await expect(assess()).resolves.toMatchObject({ ready: true, blockers: [] });
		// An inactive employee has nothing to assess, and cannot submit.
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			employee.employeeId,
		]);
		await expect(readView()).resolves.toBeNull();
		await expect(submit()).resolves.toEqual({ kind: "refused", reason: "not_employee" });
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
		const view = await readView(parseInstant("2026-03-10T09:00:00Z"));
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
});
