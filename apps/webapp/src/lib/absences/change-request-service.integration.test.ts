import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { CANONICAL_INBOX_READS } from "@/lib/approvals/inbox/canonical-inbox-reads";
import { approveApprovalInboxItem } from "@/lib/approvals/inbox/decision-service";
import {
	getApprovalInboxDetail,
	getApprovalInboxListFromSources,
} from "@/lib/approvals/inbox/read-service";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { closeMonth } from "@/lib/time-tracking/closed-months/store";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import {
	decideAbsenceChange,
	listOwnAbsenceChanges,
	requestAbsenceChange,
	withdrawAbsenceChange,
} from "./change-request-service";
import { loadVacationBalances } from "./vacation-balance-store";

vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: vi.fn(async () => null),
}));
vi.mock("@/lib/approvals/delivery/kick", () => ({
	kickApprovalDelivery: vi.fn(),
}));
vi.mock("@/lib/queue", () => ({
	addCalendarSyncJob: vi.fn(async () => undefined),
}));
vi.mock("./deputy-notifier", () => ({
	notifyAbsenceDeputies: vi.fn(async () => undefined),
}));

describe("employee absence change requests", () => {
	let fixture: ClosedMonthDatabaseFixture;
	let organizationId: string;
	let employee: { employeeId: string; userId: string };
	let manager: { employeeId: string; userId: string };
	let absenceId: string;
	const clock = { nowInstant: () => parseInstant("2026-10-14T00:00:00Z") };
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
			"insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by) values ($1, $2, $3, true, $4)",
			[randomUUID(), employee.employeeId, manager.employeeId, organization.ownerUserId],
		);
		absenceId = await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-10-05",
			endDate: "2026-10-09",
		});
		await fixture.pool.query(
			"update absence_category set type = 'sick', name = 'Sick Leave', requires_approval = false, counts_against_vacation = false where id = (select category_id from absence_entry where id = $1)",
			[absenceId],
		);
		await fixture.pool.query("update absence_entry set approved_by = $2 where id = $1", [
			absenceId,
			manager.employeeId,
		]);
	});

	it.each([
		{
			reason: "  ",
			proposed: {
				startDate: "2026-10-05",
				endDate: "2026-10-07",
				startPeriod: "full_day" as const,
				endPeriod: "full_day" as const,
			},
			code: "invalid_input",
		},
		{
			reason: "Recovered earlier",
			proposed: {
				startDate: "2026-10-08",
				endDate: "2026-10-07",
				startPeriod: "full_day" as const,
				endPeriod: "full_day" as const,
			},
			code: "invalid_input",
		},
		{
			reason: "Recovered earlier",
			proposed: {
				startDate: "2026-02-30",
				endDate: "2026-10-07",
				startPeriod: "full_day" as const,
				endPeriod: "full_day" as const,
			},
			code: "invalid_input",
		},
	])(
		"refuses invalid change requests before saving a proposal ($code)",
		async ({ reason, proposed, code }) => {
			await expect(
				requestAbsenceChange(
					{
						organizationId,
						userId: employee.userId,
						absenceId,
						kind: "change",
						proposed,
						reason,
					},
					{ database: db, clock },
				),
			).rejects.toMatchObject({ code });
			expect(
				(
					await fixture.pool.query("select id from absence_change_request where absence_id = $1", [
						absenceId,
					])
				).rows,
			).toEqual([]);
		},
	);

	it.each(["pending", "rejected"] as const)(
		"refuses changes to an initially %s absence",
		async (status) => {
			await fixture.pool.query("update absence_entry set status = $2 where id = $1", [
				absenceId,
				status,
			]);
			await expect(
				requestAbsenceChange(
					{
						organizationId,
						userId: employee.userId,
						absenceId,
						kind: "cancel",
						reason: "Correct dates",
					},
					{ database: db, clock },
				),
			).rejects.toMatchObject({ code: "not_approved" });
		},
	);

	it("isolates ownership and organization for submissions and history", async () => {
		await expect(
			requestAbsenceChange(
				{
					organizationId,
					userId: manager.userId,
					absenceId,
					kind: "cancel",
					reason: "Correct dates",
				},
				{ database: db, clock },
			),
		).rejects.toMatchObject({ code: "not_found" });
		const other = await fixture.organization();
		await expect(
			requestAbsenceChange(
				{
					organizationId: other.organizationId,
					userId: employee.userId,
					absenceId,
					kind: "cancel",
					reason: "Correct dates",
				},
				{ database: db, clock },
			),
		).rejects.toMatchObject({ code: "not_found" });
		await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "cancel",
				reason: "Entered in error",
			},
			{ database: db, clock },
		);
		expect(
			await listOwnAbsenceChanges(
				{ organizationId, userId: manager.userId },
				{ database: db, clock },
			),
		).toEqual([]);
	});

	it("blocks changes when the original span touches a closed month even if the changed portion is open", async () => {
		await fixture.pool.query("update absence_entry set start_date = '2026-09-30' where id = $1", [
			absenceId,
		]);
		const owner = await fixture.pool.query(
			"select user_id from member where organization_id = $1 and role = 'owner'",
			[organizationId],
		);
		await closeMonth(db, {
			organizationId,
			month: "2026-09",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: owner.rows[0].user_id },
			now: clock.nowInstant(),
		});
		await expect(
			requestAbsenceChange(
				{
					organizationId,
					userId: employee.userId,
					absenceId,
					kind: "change",
					proposed: {
						startDate: "2026-09-30",
						endDate: "2026-10-07",
						startPeriod: "full_day",
						endPeriod: "full_day",
					},
					reason: "Recovered earlier",
				},
				{ database: db, clock },
			),
		).rejects.toMatchObject({ _tag: "MonthClosedError" });
	});

	it("retires a request if its month closes during review", async () => {
		const submitted = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "cancel",
				reason: "Entered in error",
			},
			{ database: db, clock },
		);
		const owner = await fixture.pool.query(
			"select user_id from member where organization_id = $1 and role = 'owner'",
			[organizationId],
		);
		const closed = await closeMonth(db, {
			organizationId,
			month: "2026-10",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: owner.rows[0].user_id },
			now: parseInstant("2026-11-02T10:00:00Z"),
		});
		expect(closed.kind).toBe("closed");
		const assignment = await fixture.pool.query(
			"select id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
			[submitted.workflowId],
		);
		await expect(
			decideAbsenceChange(
				{
					organizationId,
					actorEmployeeId: manager.employeeId,
					assignmentId: assignment.rows[0].id,
					action: "approve",
				},
				{ database: db, clock },
			),
		).rejects.toMatchObject({ code: "obsolete" });
		expect(
			(await fixture.pool.query("select id from absence_entry where id = $1", [absenceId])).rows,
		).toHaveLength(1);
	});

	it("keeps vacation balances unchanged while pending and validates only the additional days", async () => {
		await fixture.pool.query(
			"update absence_category set type = 'vacation', counts_against_vacation = true where id = (select category_id from absence_entry where id = $1)",
			[absenceId],
		);
		await fixture.pool.query("update employee set start_date = '2020-01-01' where id = $1", [
			employee.employeeId,
		]);
		await fixture.pool.query(
			"insert into vacation_allowance (id, organization_id, name, start_date, is_company_default, default_annual_days, accrual_type, statutory_minimum_days, updated_at, created_by) values ($1, $2, 'Default', '2020-01-01', true, 10, 'annual', 10, now(), $3)",
			[randomUUID(), organizationId, employee.userId],
		);
		const balance = async () =>
			(
				await loadVacationBalances(db, {
					organizationId,
					employeeIds: [employee.employeeId],
					year: 2026,
					timezone: "Europe/Berlin",
				})
			).balances.get(employee.employeeId);
		const before = await balance();
		const submitted = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "change",
				proposed: {
					startDate: "2026-10-05",
					endDate: "2026-10-16",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				reason: "Need another week",
			},
			{ database: db, clock },
		);
		expect(await balance()).toEqual(before);
		await withdrawAbsenceChange(
			{ organizationId, userId: employee.userId, id: submitted.id },
			{ database: db, clock },
		);
		await expect(
			requestAbsenceChange(
				{
					organizationId,
					userId: employee.userId,
					absenceId,
					kind: "change",
					proposed: {
						startDate: "2026-10-05",
						endDate: "2026-10-19",
						startPeriod: "full_day",
						endPeriod: "full_day",
					},
					reason: "Need more leave",
				},
				{ database: db, clock },
			),
		).rejects.toMatchObject({ code: "insufficient_balance" });
	});

	it("retains sick notes on date changes and deletes them only on approved cancellation", async () => {
		const documentId = randomUUID();
		await fixture.pool.query(
			"insert into employee_document (id, organization_id, employee_id, category, title, document_date, visibility, absence_entry_id, storage_provider, storage_key, file_name, mime_type, size_bytes, checksum_sha256, uploaded_by) values ($1, $2, $3, 'sick_note', 'Sick note', '2026-10-05', 'shared', $4, 's3', $5, 'note.pdf', 'application/pdf', 12, $6, $7)",
			[
				documentId,
				organizationId,
				employee.employeeId,
				absenceId,
				`absence-change/${documentId}`,
				"a".repeat(64),
				employee.userId,
			],
		);
		const decide = async (workflowId: string) => {
			const assignment = await fixture.pool.query(
				"select id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
				[workflowId],
			);
			return decideAbsenceChange(
				{
					organizationId,
					actorEmployeeId: manager.employeeId,
					assignmentId: assignment.rows[0].id,
					action: "approve",
				},
				{ database: db, clock },
			);
		};
		const shorter = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "change",
				proposed: {
					startDate: "2026-10-05",
					endDate: "2026-10-07",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				reason: "Recovered earlier",
			},
			{ database: db, clock },
		);
		await decide(shorter.workflowId);
		expect(
			(
				await fixture.pool.query(
					"select title, document_date::text from employee_document where id = $1",
					[documentId],
				)
			).rows,
		).toEqual([{ title: "Sick note", document_date: "2026-10-05" }]);
		const cancelled = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "cancel",
				reason: "Entered in error",
			},
			{ database: db, clock },
		);
		expect(
			(await fixture.pool.query("select id from employee_document where id = $1", [documentId]))
				.rows,
		).toHaveLength(1);
		await decide(cancelled.workflowId);
		expect(
			(await fixture.pool.query("select id from employee_document where id = $1", [documentId]))
				.rows,
		).toEqual([]);
		expect(
			(
				await listOwnAbsenceChanges(
					{ organizationId, userId: employee.userId },
					{ database: db, clock },
				)
			).filter((request) => request.absenceId === absenceId),
		).toHaveLength(2);
	});

	it("displaces vacation only on approval of a sickness extension and does not restore it after shortening", async () => {
		const vacationCategory = randomUUID();
		await fixture.pool.query(
			"insert into absence_category (id, organization_id, name, type, counts_against_vacation, updated_at) values ($1, $2, 'Vacation', 'vacation', true, now())",
			[vacationCategory, organizationId],
		);
		const vacationId = await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-10-12",
			endDate: "2026-10-16",
		});
		await fixture.pool.query("update absence_entry set category_id = $2 where id = $1", [
			vacationId,
			vacationCategory,
		]);
		const submitted = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "change",
				proposed: {
					startDate: "2026-10-05",
					endDate: "2026-10-14",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				reason: "Still sick",
			},
			{ database: db, clock },
		);
		expect(
			(
				await fixture.pool.query("select start_date::text from absence_entry where id = $1", [
					vacationId,
				])
			).rows,
		).toEqual([{ start_date: "2026-10-12" }]);
		const assignment = await fixture.pool.query(
			"select id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
			[submitted.workflowId],
		);
		await decideAbsenceChange(
			{
				organizationId,
				actorEmployeeId: manager.employeeId,
				assignmentId: assignment.rows[0].id,
				action: "approve",
			},
			{ database: db, clock },
		);
		expect(
			(
				await fixture.pool.query("select start_date::text from absence_entry where id = $1", [
					vacationId,
				])
			).rows,
		).toEqual([{ start_date: "2026-10-15" }]);
		const shorter = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "change",
				proposed: {
					startDate: "2026-10-05",
					endDate: "2026-10-07",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				reason: "Recovered earlier",
			},
			{ database: db, clock },
		);
		const nextAssignment = await fixture.pool.query(
			"select id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
			[shorter.workflowId],
		);
		await decideAbsenceChange(
			{
				organizationId,
				actorEmployeeId: manager.employeeId,
				assignmentId: nextAssignment.rows[0].id,
				action: "approve",
			},
			{ database: db, clock },
		);
		expect(
			(
				await fixture.pool.query("select start_date::text from absence_entry where id = $1", [
					vacationId,
				])
			).rows,
		).toEqual([{ start_date: "2026-10-15" }]);
	});

	it.each([
		{
			start: "10:00",
			end: "12:00",
			endDay: "2026-10-05",
			movedEndDay: "2026-10-06",
			minutes: 120,
		},
		{
			start: "22:00",
			end: "04:00",
			endDay: "2026-10-06",
			movedEndDay: "2026-10-07",
			minutes: 360,
		},
	])(
		"preserves exact $start–$end coverage when moving a recorded partial absence",
		async ({ start, end, endDay, movedEndDay, minutes }) => {
			const recordId = randomUUID();
			await fixture.pool.query(
				"insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at, duration_minutes, approval_state, origin, updated_at, created_by, updated_by) values ($1, $2, $3, 'absence', $4, $5, $6, 'approved', 'manual', now(), $7, $7)",
				[
					recordId,
					organizationId,
					employee.employeeId,
					`2026-10-05T${start}:00Z`,
					`${endDay}T${end}:00Z`,
					minutes,
					employee.userId,
				],
			);
			await fixture.pool.query(
				"insert into time_record_absence (record_id, organization_id, record_kind, absence_category_id, start_period, end_period, counts_against_vacation) select $2, organization_id, 'absence', category_id, 'am', 'am', false from absence_entry where id = $1",
				[absenceId, recordId],
			);
			await fixture.pool.query(
				"update absence_entry set end_date = start_date, start_period = 'am', end_period = 'am', canonical_record_id = $2 where id = $1",
				[absenceId, recordId],
			);
			const submitted = await requestAbsenceChange(
				{
					organizationId,
					userId: employee.userId,
					absenceId,
					kind: "change",
					proposed: {
						startDate: "2026-10-06",
						endDate: "2026-10-06",
						startPeriod: "am",
						endPeriod: "am",
					},
					coverage: "keep",
					reason: "Correct the day",
				},
				{ database: db, clock },
			);
			const assignment = await fixture.pool.query(
				"select id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
				[submitted.workflowId],
			);
			await decideAbsenceChange(
				{
					organizationId,
					actorEmployeeId: manager.employeeId,
					assignmentId: assignment.rows[0].id,
					action: "approve",
				},
				{ database: db, clock },
			);
			expect(
				(
					await fixture.pool.query(
						"select to_char(start_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as start_at, to_char(end_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as end_at, duration_minutes from time_record where id = $1",
						[recordId],
					)
				).rows,
			).toEqual([
				{
					start_at: `2026-10-06 ${start}`,
					end_at: `${movedEndDay} ${end}`,
					duration_minutes: minutes,
				},
			]);
		},
	);

	it("refuses conflicting dates at submission and retires conflicts introduced during review", async () => {
		const proposed = {
			startDate: "2026-10-05",
			endDate: "2026-10-14",
			startPeriod: "full_day" as const,
			endPeriod: "full_day" as const,
		};
		const submitted = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "change",
				proposed,
				reason: "Still sick",
			},
			{ database: db, clock },
		);
		await fixture.absence({
			organizationId,
			employeeId: employee.employeeId,
			startDate: "2026-10-12",
			endDate: "2026-10-16",
		});
		const assignment = await fixture.pool.query(
			"select id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
			[submitted.workflowId],
		);
		await expect(
			decideAbsenceChange(
				{
					organizationId,
					actorEmployeeId: manager.employeeId,
					assignmentId: assignment.rows[0].id,
					action: "approve",
				},
				{ database: db, clock },
			),
		).rejects.toMatchObject({ code: "obsolete" });
		expect(
			(
				await fixture.pool.query("select status from absence_change_request where id = $1", [
					submitted.id,
				])
			).rows,
		).toEqual([{ status: "obsolete" }]);
		await expect(
			requestAbsenceChange(
				{
					organizationId,
					userId: employee.userId,
					absenceId,
					kind: "change",
					proposed,
					reason: "Still sick",
				},
				{ database: db, clock },
			),
		).rejects.toMatchObject({ code: "overlap" });
	});

	it("keeps recorded dates on rejection and denies another employee's withdrawal", async () => {
		const submitted = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "cancel",
				reason: "Entered in error",
			},
			{ database: db, clock },
		);
		await expect(
			withdrawAbsenceChange(
				{ organizationId, userId: manager.userId, id: submitted.id },
				{ database: db, clock },
			),
		).rejects.toMatchObject({ code: "not_found" });
		const assignment = await fixture.pool.query(
			"select id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
			[submitted.workflowId],
		);
		await expect(
			decideAbsenceChange(
				{
					organizationId,
					actorEmployeeId: employee.employeeId,
					assignmentId: assignment.rows[0].id,
					action: "approve",
				},
				{ database: db, clock },
			),
		).rejects.toBeDefined();
		await decideAbsenceChange(
			{
				organizationId,
				actorEmployeeId: manager.employeeId,
				assignmentId: assignment.rows[0].id,
				action: "reject",
				reason: "The recorded dates are correct",
			},
			{ database: db, clock },
		);
		expect(
			(
				await fixture.pool.query("select end_date::text from absence_entry where id = $1", [
					absenceId,
				])
			).rows,
		).toEqual([{ end_date: "2026-10-09" }]);
		expect(
			(
				await fixture.pool.query("select status from absence_change_request where id = $1", [
					submitted.id,
				])
			).rows,
		).toEqual([{ status: "rejected" }]);
	});

	it("shows a manager's newer dates as an obsolete request in own history and allows a fresh submission", async () => {
		await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "cancel",
				reason: "Entered in error",
			},
			{ database: db, clock },
		);
		await fixture.pool.query(
			"update absence_entry set end_date = '2026-10-08', updated_at = now() where id = $1",
			[absenceId],
		);
		const history = await listOwnAbsenceChanges(
			{ organizationId, userId: employee.userId },
			{ database: db, clock },
		);
		expect(history[0].status).toBe("obsolete");
		await expect(
			requestAbsenceChange(
				{
					organizationId,
					userId: employee.userId,
					absenceId,
					kind: "cancel",
					reason: "Corrected proposal",
				},
				{ database: db, clock },
			),
		).resolves.toHaveProperty("workflowId");
	});

	it("retires a stale proposal without overwriting a manager's newer dates", async () => {
		const submitted = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "change",
				proposed: {
					startDate: "2026-10-05",
					endDate: "2026-10-07",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				reason: "Recovered earlier",
			},
			{ database: db, clock },
		);
		await fixture.pool.query(
			"update absence_entry set end_date = '2026-10-08', updated_at = now() where id = $1",
			[absenceId],
		);
		const assignments = await fixture.pool.query(
			"select id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
			[submitted.workflowId],
		);
		await expect(
			decideAbsenceChange(
				{
					organizationId,
					actorEmployeeId: manager.employeeId,
					assignmentId: assignments.rows[0].id,
					action: "approve",
				},
				{ database: db, clock },
			),
		).rejects.toMatchObject({ code: "obsolete" });
		expect(
			(
				await fixture.pool.query("select status from absence_change_request where id = $1", [
					submitted.id,
				])
			).rows,
		).toEqual([{ status: "obsolete" }]);
		expect(
			(
				await fixture.pool.query("select end_date::text from absence_entry where id = $1", [
					absenceId,
				])
			).rows,
		).toEqual([{ end_date: "2026-10-08" }]);
		expect(
			(
				await fixture.pool.query("select status from approval_workflow where id = $1", [
					submitted.workflowId,
				])
			).rows,
		).toEqual([{ status: "cancelled" }]);
	});

	it("uses the current multi-stage absence policy and applies dates only after the last approval", async () => {
		const second = await fixture.employee({ organizationId });
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			second.employeeId,
		]);
		const policyId = randomUUID();
		await fixture.pool.query(
			"insert into approval_policy (id, organization_id, name, is_active, priority, created_by, updated_at) values ($1, $2, 'Absence review', true, 1, $3, now())",
			[policyId, organizationId, manager.userId],
		);
		await fixture.pool.query(
			"insert into approval_policy_condition (id, organization_id, policy_id, condition_type, operator, value_json, updated_at) values ($1, $2, $3, 'approval_type', 'in', '[\"absence_entry\"]'::jsonb, now())",
			[randomUUID(), organizationId, policyId],
		);
		await fixture.pool.query(
			"insert into approval_policy_stage (id, organization_id, policy_id, step_order, label, approver_type, approver_employee_id, fallback_behavior, updated_at) values ($1, $3, $4, 1, 'Manager', 'direct_manager', null, 'fail', now()), ($2, $3, $4, 2, 'Second review', 'specific_employee', $5, 'fail', now())",
			[randomUUID(), randomUUID(), organizationId, policyId, second.employeeId],
		);
		const submitted = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "change",
				proposed: {
					startDate: "2026-10-05",
					endDate: "2026-10-07",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				reason: "Recovered earlier",
			},
			{ database: db, clock },
		);
		const firstAssignment = await fixture.pool.query(
			"select id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
			[submitted.workflowId],
		);
		await decideAbsenceChange(
			{
				organizationId,
				actorEmployeeId: manager.employeeId,
				assignmentId: firstAssignment.rows[0].id,
				action: "approve",
			},
			{ database: db, clock },
		);
		expect(
			(
				await fixture.pool.query("select end_date::text from absence_entry where id = $1", [
					absenceId,
				])
			).rows,
		).toEqual([{ end_date: "2026-10-09" }]);
		const nextAssignment = await fixture.pool.query(
			"select id, approver_employee_id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
			[submitted.workflowId],
		);
		expect(nextAssignment.rows[0].approver_employee_id).toBe(second.employeeId);
		await decideAbsenceChange(
			{
				organizationId,
				actorEmployeeId: second.employeeId,
				assignmentId: nextAssignment.rows[0].id,
				action: "approve",
			},
			{ database: db, clock },
		);
		expect(
			(
				await fixture.pool.query("select end_date::text from absence_entry where id = $1", [
					absenceId,
				])
			).rows,
		).toEqual([{ end_date: "2026-10-07" }]);
	});

	it("allows a covering deputy to review and records whom the deputy acted for", async () => {
		const deputy = await fixture.employee({ organizationId });
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			deputy.employeeId,
		]);
		const managerAbsence = await fixture.absence({
			organizationId,
			employeeId: manager.employeeId,
			startDate: "2026-10-14",
			endDate: "2026-10-16",
		});
		await fixture.pool.query(
			"update absence_entry set deputy_employee_id = $2, deputy_assigned_at = '2026-10-13T00:00:00Z', approved_at = '2026-10-13T00:00:00Z', created_at = '2026-10-13T00:00:00Z' where id = $1",
			[managerAbsence, deputy.employeeId],
		);
		await fixture.pool.query(
			"insert into approval_setting (organization_id, deputy_decisions_enabled) values ($1, true)",
			[organizationId],
		);
		const submitted = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "cancel",
				reason: "Entered in error",
			},
			{ database: db, clock },
		);
		const assignment = await fixture.pool.query(
			"select id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
			[submitted.workflowId],
		);
		await decideAbsenceChange(
			{
				organizationId,
				actorEmployeeId: deputy.employeeId,
				assignmentId: assignment.rows[0].id,
				action: "approve",
			},
			{ database: db, clock },
		);
		expect(
			(
				await fixture.pool.query(
					"select deputy_employee_id, acting_for_employee_id from approval_deputy_decision where entity_id = $1",
					[submitted.id],
				)
			).rows,
		).toEqual([
			{
				deputy_employee_id: deputy.employeeId,
				acting_for_employee_id: manager.employeeId,
			},
		]);
	});

	it("refuses a policy that only names the requester instead of auto-approving", async () => {
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			employee.employeeId,
		]);
		const policyId = randomUUID();
		await fixture.pool.query(
			"insert into approval_policy (id, organization_id, name, is_active, priority, created_by, updated_at) values ($1, $2, 'Independent review required', true, 1, $3, now())",
			[policyId, organizationId, manager.userId],
		);
		await fixture.pool.query(
			"insert into approval_policy_stage (id, organization_id, policy_id, step_order, label, approver_type, approver_employee_id, fallback_behavior, updated_at) values ($1, $2, $3, 1, 'Self review', 'specific_employee', $4, 'fail', now())",
			[randomUUID(), organizationId, policyId, employee.employeeId],
		);
		await expect(
			requestAbsenceChange(
				{
					organizationId,
					userId: employee.userId,
					absenceId,
					kind: "cancel",
					reason: "Entered in error",
				},
				{ database: db, clock },
			),
		).rejects.toMatchObject({ code: "no_approver" });
	});

	it("refuses submission when no other eligible approver exists and saves nothing", async () => {
		await fixture.pool.query("delete from employee_managers where employee_id = $1", [
			employee.employeeId,
		]);
		await expect(
			requestAbsenceChange(
				{
					organizationId,
					userId: employee.userId,
					absenceId,
					kind: "cancel",
					reason: "Entered in error",
				},
				{ database: db, clock },
			),
		).rejects.toMatchObject({ code: "no_approver" });
		expect(
			(
				await fixture.pool.query("select id from absence_change_request where absence_id = $1", [
					absenceId,
				])
			).rows,
		).toEqual([]);
	});

	it("allows one pending proposal, withdrawal and replacement while retaining the original dates and history", async () => {
		const input = {
			organizationId,
			userId: employee.userId,
			absenceId,
			kind: "change" as const,
			proposed: {
				startDate: "2026-10-05",
				endDate: "2026-10-07",
				startPeriod: "full_day" as const,
				endPeriod: "full_day" as const,
			},
			reason: "Recovered earlier",
		};
		const submitted = await requestAbsenceChange(input, {
			database: db,
			clock,
		});
		await expect(requestAbsenceChange(input, { database: db, clock })).rejects.toMatchObject({
			code: "already_pending",
		});
		await withdrawAbsenceChange(
			{ organizationId, userId: employee.userId, id: submitted.id },
			{ database: db, clock },
		);
		await requestAbsenceChange(
			{ ...input, proposed: { ...input.proposed, endDate: "2026-10-08" } },
			{ database: db, clock },
		);
		expect(
			(
				await fixture.pool.query(
					"select status from absence_change_request where absence_id = $1 order by created_at, status desc",
					[absenceId],
				)
			).rows,
		).toEqual([{ status: "withdrawn" }, { status: "pending" }]);
		expect(
			(
				await fixture.pool.query("select end_date::text from absence_entry where id = $1", [
					absenceId,
				])
			).rows,
		).toEqual([{ end_date: "2026-10-09" }]);
	});

	it("lets the current approver review original and proposed dates in the normal inbox and approve there", async () => {
		const submitted = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "change",
				proposed: {
					startDate: "2026-10-05",
					endDate: "2026-10-07",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				reason: "Recovered earlier",
			},
			{ database: db, clock },
		);
		const list = await getApprovalInboxListFromSources({
			sources: [],
			params: { approverId: manager.employeeId, organizationId },
			canonicalReads: CANONICAL_INBOX_READS,
		});
		const change = list.items.find((item) => item.entityId === submitted.id);
		expect(change).toMatchObject({
			type: "absence_change_request",
			requester: { id: employee.employeeId },
		});
		if (!change) throw new Error("Missing inbox item");
		const detail = await getApprovalInboxDetail({
			approvalId: change.id,
			organizationId,
			approverId: manager.employeeId,
		});
		expect(JSON.stringify(detail.sections)).toContain("2026-10-09");
		expect(JSON.stringify(detail.sections)).toContain("2026-10-07");
		expect(JSON.stringify(detail.sections)).toContain("Recovered earlier");
		await approveApprovalInboxItem({
			approvalId: change.id,
			organizationId,
			actorEmployeeId: manager.employeeId,
		});
		expect(
			(
				await fixture.pool.query("select end_date::text from absence_entry where id = $1", [
					absenceId,
				])
			).rows,
		).toEqual([{ end_date: "2026-10-07" }]);
	});

	it("cancels an approved absence only after review and preserves the change request history", async () => {
		const submitted = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "cancel",
				reason: "Entered in error",
			},
			{ database: db, clock },
		);
		expect(
			(await fixture.pool.query("select id from absence_entry where id = $1", [absenceId])).rows,
		).toHaveLength(1);
		const assignments = await fixture.pool.query(
			"select id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
			[submitted.workflowId],
		);
		await decideAbsenceChange(
			{
				organizationId,
				actorEmployeeId: manager.employeeId,
				assignmentId: assignments.rows[0].id,
				action: "approve",
			},
			{ database: db, clock },
		);
		expect(
			(await fixture.pool.query("select id from absence_entry where id = $1", [absenceId])).rows,
		).toEqual([]);
		expect(
			(
				await fixture.pool.query(
					"select status, absence_id from absence_change_request where id = $1",
					[submitted.id],
				)
			).rows,
		).toEqual([{ status: "approved", absence_id: absenceId }]);
	});

	it("keeps manager-recorded sickness effective until another approver accepts the employee's shorter range", async () => {
		const submitted = await requestAbsenceChange(
			{
				organizationId,
				userId: employee.userId,
				absenceId,
				kind: "change",
				proposed: {
					startDate: "2026-10-05",
					endDate: "2026-10-07",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				reason: "Recovered earlier",
			},
			{ database: db, clock },
		);
		const original = await fixture.pool.query(
			"select end_date::text, status from absence_entry where id = $1",
			[absenceId],
		);
		expect(original.rows).toEqual([{ end_date: "2026-10-09", status: "approved" }]);
		const assignments = await fixture.pool.query(
			"select id, approver_employee_id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
			[submitted.workflowId],
		);
		expect(assignments.rows).toEqual([
			{ id: expect.any(String), approver_employee_id: manager.employeeId },
		]);
		await decideAbsenceChange(
			{
				organizationId,
				actorEmployeeId: manager.employeeId,
				assignmentId: assignments.rows[0].id,
				action: "approve",
			},
			{ database: db, clock },
		);
		expect(
			(
				await fixture.pool.query("select end_date::text, status from absence_entry where id = $1", [
					absenceId,
				])
			).rows,
		).toEqual([{ end_date: "2026-10-07", status: "approved" }]);
		expect(
			(
				await fixture.pool.query("select status from absence_change_request where id = $1", [
					submitted.id,
				])
			).rows,
		).toEqual([{ status: "approved" }]);
	});
});
