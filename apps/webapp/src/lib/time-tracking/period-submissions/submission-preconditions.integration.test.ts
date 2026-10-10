/**
 * #1060 runtime evidence: submitting a period is refused while it is still open (live work started
 * in it is running, or a request touching it is undecided), and the refusal names what blocks it.
 * "Touching" follows closed months (Time Tracking ADR-0004): even in part counts.
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
import { submitPeriodSubmission } from "./submission-service";

// A Monday-week cadence since January; Europe/Berlin, so the week 2026-03-02..08 is
// [2026-03-01T23:00Z, 2026-03-08T23:00Z).
const WEEK_START = "2026-03-02";
const LAST_DAY = parseInstant("2026-03-08T12:00:00Z");
const TZ = "Europe/Berlin";

describe("period submission preconditions on PostgreSQL", () => {
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

	const submit = () =>
		submitPeriodSubmission(
			{ organizationId, userId: employee.userId, periodStartDate: WEEK_START },
			{ database: db, clock: { nowInstant: () => LAST_DAY } },
		);

	const work = (start: string, end: string | null, approvalStatus?: "approved" | "pending") =>
		fixture.work({
			organizationId,
			employeeId: employee.employeeId,
			userId: employee.userId,
			start,
			end,
			approvalStatus,
		});

	async function submissionCount() {
		const { rows } = await fixture.pool.query<{ count: number }>(
			"select count(*)::int as count from period_submission where organization_id = $1",
			[organizationId],
		);
		return rows[0]?.count;
	}

	async function pendingWorkflowOn(workPeriodId: string, workflowType: string) {
		await fixture.pool.query(
			`insert into approval_workflow (id, organization_id, workflow_type, source_type, source_id,
				requester_employee_id, status, current_stage_order, version, policy_snapshot,
				context_snapshot, display_snapshot, submitted_at, created_at, updated_at)
			 values ($1, $2, $3, 'time_entry', $4, $5, 'pending', 1, 1, '{}', '{}', '{}', now(), now(), now())`,
			[randomUUID(), organizationId, workflowType, workPeriodId, employee.employeeId],
		);
	}

	it("refuses while live work started in the period is still running", async () => {
		const live = await work("2026-03-08T08:00:00Z", null);

		await expect(submit()).resolves.toEqual({
			kind: "refused",
			reason: "period_open",
			blockers: [
				{
					kind: "live_work",
					workPeriodId: live.workPeriodId,
					startTime: "2026-03-08T08:00:00.000Z",
					endTime: null,
					timezone: TZ,
				},
			],
		});
		expect(await submissionCount()).toBe(0);
	});

	it("refuses while manual work touching the period, even in part, is undecided", async () => {
		// Starts on Sunday evening before the week (Berlin) and runs into Monday.
		const manual = await work("2026-03-01T22:30:00Z", "2026-03-02T01:00:00Z", "pending");
		const canonical = await work("2026-03-04T08:00:00Z", "2026-03-04T12:00:00Z");
		await pendingWorkflowOn(canonical.workPeriodId, "manual_time_submission");
		// Undecided, but outside the period.
		await work("2026-03-09T08:00:00Z", "2026-03-09T12:00:00Z", "pending");

		const result = await submit();
		expect(result).toMatchObject({ kind: "refused", reason: "period_open" });
		if (result.kind !== "refused" || result.reason !== "period_open") return;
		expect(result.blockers).toEqual([
			{
				kind: "manual_work",
				workPeriodId: manual.workPeriodId,
				startTime: "2026-03-01T22:30:00.000Z",
				endTime: "2026-03-02T01:00:00.000Z",
				timezone: TZ,
			},
			{
				kind: "manual_work",
				workPeriodId: canonical.workPeriodId,
				startTime: "2026-03-04T08:00:00.000Z",
				endTime: "2026-03-04T12:00:00.000Z",
				timezone: TZ,
			},
		]);
	});

	it("refuses while a time correction touching the period is undecided", async () => {
		const corrected = await work("2026-03-03T08:00:00Z", "2026-03-03T16:00:00Z");
		await pendingWorkflowOn(corrected.workPeriodId, "time_correction");
		// A legacy correction request on work ending in the period.
		const legacy = await work("2026-03-08T20:00:00Z", "2026-03-08T23:30:00Z");
		await fixture.pool.query(
			`insert into approval_request (organization_id, entity_type, entity_id, requested_by, approver_id, status, updated_at)
			 values ($1, 'time_entry', $2, $3, $4, 'pending', now())`,
			[organizationId, legacy.workPeriodId, employee.employeeId, manager.employeeId],
		);

		const result = await submit();
		expect(result).toMatchObject({ kind: "refused", reason: "period_open" });
		if (result.kind !== "refused" || result.reason !== "period_open") return;
		expect(
			result.blockers.map((blocker) => [
				blocker.kind,
				"workPeriodId" in blocker && blocker.workPeriodId,
			]),
		).toEqual([
			["time_correction", corrected.workPeriodId],
			["time_correction", legacy.workPeriodId],
		]);
	});

	it("refuses while an absence request touching the period, even in part, is undecided", async () => {
		const pending = await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-03-08",
			endDate: "2026-03-10",
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

		await expect(submit()).resolves.toEqual({
			kind: "refused",
			reason: "period_open",
			blockers: [
				{
					kind: "absence_request",
					absenceId: pending,
					startDate: "2026-03-08",
					endDate: "2026-03-10",
				},
			],
		});
	});

	it("submits once everything in the period is decided and no work started in it is running", async () => {
		await work("2026-03-03T08:00:00Z", "2026-03-03T16:00:00Z");
		await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-03-05",
			endDate: "2026-03-05",
			status: "rejected",
		});
		// Another employee's undecided work never blocks this one.
		await fixture.work({
			organizationId,
			employeeId: manager.employeeId,
			userId: manager.userId,
			start: "2026-03-08T08:00:00Z",
			end: null,
		});

		await expect(submit()).resolves.toMatchObject({ kind: "submitted" });
	});
});
