/**
 * #1059 runtime evidence: a period submission is listed, opened and decided in the approval
 * inbox through its canonical read, with no legacy request behind it.
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
import { submitPeriodSubmission } from "@/lib/time-tracking/period-submissions/submission-service";
import { CANONICAL_INBOX_READS } from "./canonical-inbox-reads";
import {
	approveApprovalInboxItem,
	loadApprovalInboxDecisionTarget,
	rejectApprovalInboxItem,
} from "./decision-service";
import { getApprovalInboxDetail, getApprovalInboxListFromSources } from "./read-service";

describe("period submissions in the approval inbox on PostgreSQL", () => {
	let fixture: ClosedMonthDatabaseFixture;
	let organizationId: string;
	let employee: { employeeId: string; userId: string };
	let manager: { employeeId: string; userId: string };
	let assignmentId: string;

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
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[randomUUID(), employee.employeeId, manager.employeeId, organization.ownerUserId],
		);
		await fixture.pool.query(
			`insert into period_submission_cadence_change
			 (id, organization_id, cadence, week_start_day, changed_at)
			 values ($1, $2, 'weekly', 'monday', '2026-01-01T00:00:00Z')`,
			[randomUUID(), organizationId],
		);
		await fixture.work({
			organizationId,
			employeeId: employee.employeeId,
			userId: employee.userId,
			start: "2026-03-03T07:00:00Z",
			end: "2026-03-03T15:15:00Z",
		});
		const submitted = await submitPeriodSubmission(
			{ organizationId, userId: employee.userId, periodStartDate: "2026-03-02" },
			{ database: db, clock: { nowInstant: () => parseInstant("2026-03-08T12:00:00Z") } },
		);
		if (submitted.kind !== "submitted") throw new Error(`not submitted: ${submitted.reason}`);
		const { rows } = await fixture.pool.query<{ id: string }>(
			"select id from approval_stage_assignment where organization_id = $1 and workflow_id = $2",
			[organizationId, submitted.workflowId],
		);
		assignmentId = rows[0]?.id ?? "";
	});

	it("lists and opens the submission for its approver with the employee, period and total", async () => {
		const list = await getApprovalInboxListFromSources({
			sources: [],
			params: { approverId: manager.employeeId, organizationId },
			canonicalReads: CANONICAL_INBOX_READS,
		});
		expect(list.counts.period_submission).toBe(1);
		expect(list.supportedTypes).toContain("period_submission");
		expect(list.items).toEqual([
			expect.objectContaining({
				id: assignmentId,
				type: "period_submission",
				requester: expect.objectContaining({ id: employee.employeeId }),
				summary: expect.objectContaining({ detail: "8:15 h worked" }),
				capabilities: expect.objectContaining({
					canBulkApprove: false,
					requiresRejectReason: true,
				}),
			}),
		]);

		const detail = await getApprovalInboxDetail({
			approvalId: assignmentId,
			organizationId,
			approverId: manager.employeeId,
		});
		expect(detail.sections[0]).toMatchObject({
			type: "key_value",
			rows: expect.arrayContaining([
				expect.objectContaining({
					value: { kind: "plain_date_range", start: "2026-03-02", end: "2026-03-08" },
				}),
				expect.objectContaining({
					href: `/calendar/${employee.employeeId}?date=2026-03-02`,
				}),
			]),
		});
		// The full card (#1061) is built from the submitted facts: the day totals of the range.
		expect(detail.sections[1]).toEqual({
			type: "key_value",
			title: { key: "approvals:approvals.periodSubmission.dayTotals", fallback: "Day totals" },
			rows: [
				{
					label: expect.objectContaining({
						params: { date: { kind: "plain_date", date: "2026-03-03" } },
					}),
					value: expect.objectContaining({ params: { total: "8:15" } }),
				},
			],
		});

		const other = await getApprovalInboxListFromSources({
			sources: [],
			params: { approverId: employee.employeeId, organizationId },
			canonicalReads: CANONICAL_INBOX_READS,
		});
		expect(other.counts.period_submission).toBe(0);
	});

	it("refuses a rejection without a reason, rejects with one, and then reports it decided", async () => {
		const decide = (reason: string) =>
			rejectApprovalInboxItem({
				approvalId: assignmentId,
				actorEmployeeId: manager.employeeId,
				organizationId,
				reason,
			});
		await expect(decide(" ")).rejects.toThrow("Rejection reason is required");
		await expect(decide("Thursday is missing")).resolves.toEqual({
			id: assignmentId,
			type: "period_submission",
			status: "rejected",
		});
		await expect(
			loadApprovalInboxDecisionTarget({ approvalId: assignmentId, organizationId }),
		).resolves.toMatchObject({ entityType: "period_submission", status: "rejected" });
		await expect(
			approveApprovalInboxItem({
				approvalId: assignmentId,
				actorEmployeeId: manager.employeeId,
				organizationId,
			}),
		).rejects.toThrow("Request is already rejected");
	});

	it("approves from the inbox and refuses the employee's own decision", async () => {
		await expect(
			approveApprovalInboxItem({
				approvalId: assignmentId,
				actorEmployeeId: employee.employeeId,
				organizationId,
				includeAllApprovers: true,
			}),
		).rejects.toThrow(/own/i);
		await expect(
			approveApprovalInboxItem({
				approvalId: assignmentId,
				actorEmployeeId: manager.employeeId,
				organizationId,
			}),
		).resolves.toMatchObject({ status: "approved" });
		const { rows } = await fixture.pool.query<{ status: string }>(
			"select status from period_submission where organization_id = $1",
			[organizationId],
		);
		expect(rows).toEqual([{ status: "approved" }]);
		const { rows: legacy } = await fixture.pool.query<{ count: number }>(
			"select count(*)::int as count from approval_request where organization_id = $1",
			[organizationId],
		);
		expect(legacy).toEqual([{ count: 0 }]);
	});
});
