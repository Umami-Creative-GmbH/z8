/**
 * #1062 runtime evidence: a change to work or absences touching a submitted period sends it back
 * to the employee, inside the writer's transaction, on real rows.
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
import { sendBackChangedPeriodSubmissions } from "./submission-send-back";
import { decidePeriodSubmission, submitPeriodSubmission } from "./submission-service";

// A Monday-week cadence since January; the employees work in Europe/Berlin (UTC+1 in March).
const WEEK_START = "2026-03-02";
const LAST_DAY = parseInstant("2026-03-08T12:00:00Z");
const CHANGED_AT = parseInstant("2026-03-10T09:00:00Z");
const at = (instant: ReturnType<typeof parseInstant>) => ({ nowInstant: () => instant });
const insideWeek = {
	start: parseInstant("2026-03-04T08:00:00Z"),
	end: parseInstant("2026-03-04T16:00:00Z"),
};

describe("sending submitted periods back after a change on PostgreSQL", () => {
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
		await fixture.submissionCadence({
			organizationId,
			cadence: "weekly",
			changedAt: "2026-01-01T00:00:00Z",
			changedBy: ownerUserId,
		});
	});

	async function submit() {
		const result = await submitPeriodSubmission(
			{ organizationId, userId: employee.userId, periodStartDate: WEEK_START },
			{ database: db, clock: at(LAST_DAY) },
		);
		if (result.kind !== "submitted") throw new Error(`not submitted: ${result.reason}`);
		return result;
	}

	async function approve(workflowId: string) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`select id from approval_stage_assignment
			 where organization_id = $1 and workflow_id = $2 and status = 'pending'`,
			[organizationId, workflowId],
		);
		const assignmentId = rows[0]?.id;
		if (!assignmentId) throw new Error("no assignment");
		await decidePeriodSubmission(
			{ organizationId, actorEmployeeId: manager.employeeId, assignmentId, action: "approve" },
			{ database: db, clock: at(LAST_DAY) },
		);
	}

	const sendBack = (change: Parameters<typeof sendBackChangedPeriodSubmissions>[1]) =>
		db.transaction((tx) => sendBackChangedPeriodSubmissions(tx, change, { clock: at(CHANGED_AT) }));

	async function submissions() {
		const { rows } = await fixture.pool.query<{
			id: string;
			status: string;
			closed_cause: string | null;
			decided_at: Date | null;
			closed_at: Date | null;
		}>(
			`select id, status, closed_cause, decided_at, closed_at from period_submission
			 where organization_id = $1 order by submitted_at`,
			[organizationId],
		);
		return rows;
	}

	async function workflowStatus(workflowId: string) {
		const { rows } = await fixture.pool.query<{ status: string }>(
			"select status from approval_workflow where organization_id = $1 and id = $2",
			[organizationId, workflowId],
		);
		return rows[0]?.status;
	}

	async function audit(action: string) {
		const { rows } = await fixture.pool.query<{
			entity_id: string;
			performed_by: string;
			timestamp: Date;
			metadata: string;
		}>(
			`select entity_id, performed_by, timestamp, metadata from audit_log
			 where organization_id = $1 and entity_type = 'period_submission' and action = $2`,
			[organizationId, action],
		);
		return rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata) }));
	}

	async function viewStatus() {
		const view = await loadEmployeePeriodView(db, {
			organizationId,
			employeeId: employee.employeeId,
			now: CHANGED_AT,
		});
		return view?.periods.find((period) => period.startDate === WEEK_START);
	}

	it("withdraws a pending submission touched by a work change and cancels its approval", async () => {
		const submitted = await submit();

		await expect(
			sendBack({ organizationId, employeeId: employee.employeeId, work: [insideWeek] }),
		).resolves.toEqual({
			withdrawn: [{ submissionId: submitted.submissionId, workflowId: submitted.workflowId }],
			outdated: [],
		});

		expect(await submissions()).toMatchObject([
			{ id: submitted.submissionId, status: "withdrawn", closed_cause: "change" },
		]);
		expect(await workflowStatus(submitted.workflowId)).toBe("cancelled");
		expect(await viewStatus()).toMatchObject({ status: "sent_back_after_change", canSubmit: true });
		const withdrawn = await audit("period_submission.withdrawn");
		expect(withdrawn).toHaveLength(1);
		expect(withdrawn[0]).toMatchObject({
			entity_id: submitted.submissionId,
			performed_by: employee.userId,
			metadata: { closedCause: "change", automatic: true, at: "2026-03-10T09:00:00Z" },
		});
	});

	it("puts an approved period back to awaiting submission and keeps the approval as history", async () => {
		const submitted = await submit();
		await approve(submitted.workflowId);

		await expect(
			sendBack({
				organizationId,
				employeeId: employee.employeeId,
				days: [{ startDate: "2026-03-08", endDate: "2026-03-10" }],
			}),
		).resolves.toEqual({ withdrawn: [], outdated: [submitted.submissionId] });

		const [row] = await submissions();
		expect(row).toMatchObject({ status: "outdated", closed_cause: "change" });
		expect(row?.decided_at).not.toBeNull();
		expect(row?.closed_at?.toISOString()).toBe("2026-03-10T09:00:00.000Z");
		expect(await workflowStatus(submitted.workflowId)).toBe("approved");
		expect(await viewStatus()).toMatchObject({ status: "sent_back_after_change", canSubmit: true });
		expect(await audit("period_submission.approved")).toHaveLength(1);
		const outdated = await audit("period_submission.outdated");
		expect(outdated).toHaveLength(1);
		expect(outdated[0]).toMatchObject({
			entity_id: submitted.submissionId,
			performed_by: employee.userId,
			metadata: { closedCause: "change", automatic: true, startDate: WEEK_START },
		});
		expect(outdated[0]?.timestamp.toISOString()).toBe("2026-03-10T09:00:00.000Z");

		// The period can be submitted again with a new submission.
		const again = await submitPeriodSubmission(
			{ organizationId, userId: employee.userId, periodStartDate: WEEK_START },
			{ database: db, clock: at(CHANGED_AT) },
		);
		expect(again).toMatchObject({ kind: "submitted" });
	});

	it("leaves submissions alone when the change lies outside their period", async () => {
		const submitted = await submit();

		await expect(
			sendBack({
				organizationId,
				employeeId: employee.employeeId,
				work: [
					{
						start: parseInstant("2026-03-09T08:00:00Z"),
						end: parseInstant("2026-03-09T16:00:00Z"),
					},
				],
				days: [{ startDate: "2026-02-23", endDate: "2026-03-01" }],
			}),
		).resolves.toEqual({ withdrawn: [], outdated: [] });
		// Another employee's change never touches this employee's submission.
		await expect(
			sendBack({ organizationId, employeeId: manager.employeeId, work: [insideWeek] }),
		).resolves.toEqual({ withdrawn: [], outdated: [] });

		expect(await submissions()).toMatchObject([{ status: "pending" }]);
		expect(await workflowStatus(submitted.workflowId)).toBe("pending");
	});

	it("does nothing in an organization whose cadence was never on", async () => {
		const other = await fixture.organization("Europe/Berlin");
		const person = await fixture.employee({ organizationId: other.organizationId });
		await expect(
			sendBack({
				organizationId: other.organizationId,
				employeeId: person.employeeId,
				work: [insideWeek],
			}),
		).resolves.toEqual({ withdrawn: [], outdated: [] });
	});

	it("withdraws the pending submission of an employee who has left meanwhile", async () => {
		const submitted = await submit();
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			employee.employeeId,
		]);

		await expect(
			sendBack({ organizationId, employeeId: employee.employeeId, work: [insideWeek] }),
		).resolves.toMatchObject({ withdrawn: [{ submissionId: submitted.submissionId }] });
		expect(await workflowStatus(submitted.workflowId)).toBe("cancelled");
	});

	it("rolls back with the writer's transaction", async () => {
		const submitted = await submit();
		await expect(
			db.transaction(async (tx) => {
				await sendBackChangedPeriodSubmissions(
					tx,
					{ organizationId, employeeId: employee.employeeId, work: [insideWeek] },
					{ clock: at(CHANGED_AT) },
				);
				throw new Error("writer failed");
			}),
		).rejects.toThrow("writer failed");
		expect(await submissions()).toMatchObject([{ status: "pending" }]);
		expect(await workflowStatus(submitted.workflowId)).toBe("pending");
		expect(await audit("period_submission.withdrawn")).toEqual([]);
	});
});
