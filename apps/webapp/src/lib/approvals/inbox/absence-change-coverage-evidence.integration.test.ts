import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { coverageRule, locationSubarea, shift } from "@/db/schema";
import {
	decideAbsenceChange,
	listOwnAbsenceChanges,
	requestAbsenceChange,
} from "@/lib/absences/change-request-service";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { shiftStoredDate } from "@/lib/scheduling/shift-date";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import { loadAbsenceChangeCoverageTriageEvidence } from "./absence-change-coverage-evidence";
import { readAbsenceChangeCoverageSnapshot } from "./absence-change-coverage-source";
import type { ApprovalInboxTriageTarget } from "./triage-evidence";
import { resolveApprovalInboxTriage } from "./triage-evidence";

vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: vi.fn(async () => null),
}));
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/absences/deputy-notifier", () => ({
	notifyAbsenceDeputies: vi.fn(async () => undefined),
}));
let fixture: ClosedMonthDatabaseFixture;
beforeAll(async () => {
	fixture = await createClosedMonthDatabaseFixture();
});
afterAll(async () => {
	await fixture?.close();
});
const clock = { nowInstant: () => parseInstant("2026-10-18T08:00:00Z") };
async function submittedChange(
	options: { kind?: "change" | "cancel"; partial?: boolean } = {},
) {
	const org = await fixture.organization("Europe/Berlin");
	const employee = await fixture.employee(org);
	const manager = await fixture.employee(org);
	await fixture.pool.query("update employee set role='manager' where id=$1", [
		manager.employeeId,
	]);
	await fixture.pool.query(
		"insert into employee_managers(id,employee_id,manager_id,is_primary,assigned_by) values($1,$2,$3,true,$4)",
		[randomUUID(), employee.employeeId, manager.employeeId, org.ownerUserId],
	);
	const absenceId = await fixture.absence({
		...org,
		employeeId: employee.employeeId,
		startDate: "2026-10-19",
		endDate: "2026-10-19",
	});
	await fixture.pool.query(
		"update absence_category set type='sick', requires_approval=false, counts_against_vacation=false where id=(select category_id from absence_entry where id=$1)",
		[absenceId],
	);
	if (options.partial)
		await fixture.pool.query(
			"update absence_entry set start_period='am',end_period='am' where id=$1",
			[absenceId],
		);
	const submitted = await requestAbsenceChange(
		{
			organizationId: org.organizationId,
			userId: employee.userId,
			absenceId,
			kind: options.kind ?? "cancel",
			...(options.kind === "change"
				? {
						proposed: {
							startDate: "2026-10-19",
							endDate: "2026-10-20",
							startPeriod: "full_day" as const,
							endPeriod: "full_day" as const,
						},
					}
				: {}),
			reason: "No longer needed",
		},
		{ database: fixture.db, clock },
	);
	const assignments = await fixture.pool.query<{ id: string }>(
		"select id from approval_stage_assignment where workflow_id=$1 and status='pending'",
		[submitted.workflowId],
	);
	const assignmentId = assignments.rows[0]?.id;
	if (!assignmentId) throw new Error("Pending assignment missing");
	const site = await fixture.location({ ...org, createdBy: org.ownerUserId });
	const [area] = await fixture.db
		.insert(locationSubarea)
		.values({ locationId: site, name: "Desk", createdBy: org.ownerUserId })
		.returning();
	if (!area) throw new Error("Staffing area missing");
	await fixture.db.insert(coverageRule).values({
		organizationId: org.organizationId,
		subareaId: area.id,
		dayOfWeek: "monday",
		startTime: "09:00",
		endTime: "17:00",
		minimumStaffCount: 1,
		createdBy: org.ownerUserId,
	});
	await fixture.db.insert(shift).values({
		organizationId: org.organizationId,
		subareaId: area.id,
		employeeId: employee.employeeId,
		date: shiftStoredDate("2026-10-19", "Europe/Berlin"),
		startTime: "09:00",
		endTime: "17:00",
		status: "published",
		createdBy: org.ownerUserId,
	});
	const target: ApprovalInboxTriageTarget = {
		context: {
			organizationId: org.organizationId,
			requestId: assignmentId,
			entityId: submitted.id,
			revision: null,
			scope: "submitted_request",
		},
		authority: "canonical_assignment",
		requestKind: "absence_change",
		type: "absence_change_request",
		status: "pending",
		createdAt: "2026-10-18T08:00:00Z",
		priority: "normal",
	};
	return {
		org,
		employee,
		manager,
		absenceId,
		target,
		submitted,
		assignmentId,
		areaId: area.id,
	};
}
it("assesses an actual pending cancellation without changing its effective absence or independent-review lifecycle", async () => {
	const { org, employee, manager, target, assignmentId } =
		await submittedChange();
	const result = await loadAbsenceChangeCoverageTriageEvidence(target, {
		database: fixture.db,
	});
	expect(result.evidence).toMatchObject([
		{ state: "clear", validity: "current" },
	]);
	const current = await resolveApprovalInboxTriage({
		target,
		policy: { staleAfterHours: 72, smallCorrectionMinutes: 15 },
		now: new Date("2026-10-18T09:00:00Z"),
	});
	expect(current.evidence).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ check: "coverage", state: "clear" }),
		]),
	);
	expect(current.riskReasons).toEqual(["payroll_unverified"]);
	expect(current.fastLaneGroup).toBeNull();
	expect(
		(await readAbsenceChangeCoverageSnapshot(target, fixture.db))?.liveOriginal,
	).toMatchObject({ startDate: "2026-10-19", endDate: "2026-10-19" });
	await expect(
		decideAbsenceChange(
			{
				organizationId: org.organizationId,
				actorEmployeeId: employee.employeeId,
				assignmentId,
				action: "approve",
			},
			{ database: fixture.db, clock },
		),
	).rejects.toBeDefined();
	expect(
		(
			await loadAbsenceChangeCoverageTriageEvidence(target, {
				database: fixture.db,
			})
		).evidence,
	).toMatchObject([{ state: "clear" }]);
	await decideAbsenceChange(
		{
			organizationId: org.organizationId,
			actorEmployeeId: manager.employeeId,
			assignmentId,
			action: "approve",
		},
		{ database: fixture.db, clock },
	);
	expect(
		(
			await listOwnAbsenceChanges(
				{ organizationId: org.organizationId, userId: employee.userId },
				{ database: fixture.db, clock },
			)
		)[0]?.status,
	).toBe("approved");
	expect(
		(
			await loadAbsenceChangeCoverageTriageEvidence(target, {
				database: fixture.db,
			})
		).evidence,
	).toMatchObject([{ state: "unknown" }]);
});

it("leaves unsupported half-day cancellation unknown while retaining eligible manual approval", async () => {
	const { org, employee, manager, target, assignmentId } =
		await submittedChange({ partial: true });
	expect(
		(
			await loadAbsenceChangeCoverageTriageEvidence(target, {
				database: fixture.db,
			})
		).evidence,
	).toMatchObject([
		{ state: "unknown", facts: { limitation: "unsupported_change_coverage" } },
	]);
	expect(
		(await readAbsenceChangeCoverageSnapshot(target, fixture.db))?.liveOriginal,
	).toMatchObject({ startPeriod: "am", endPeriod: "am" });
	await decideAbsenceChange(
		{
			organizationId: org.organizationId,
			actorEmployeeId: manager.employeeId,
			assignmentId,
			action: "approve",
		},
		{ database: fixture.db, clock },
	);
	expect(
		(
			await listOwnAbsenceChanges(
				{ organizationId: org.organizationId, userId: employee.userId },
				{ database: fixture.db, clock },
			)
		)[0]?.status,
	).toBe("approved");
});
it("assesses an extension from captured original facts and retires an assessment when effective absence changes", async () => {
	const { org, employee, manager, target, assignmentId, absenceId, areaId } =
		await submittedChange({ kind: "change" });
	await fixture.db.insert(coverageRule).values({
		organizationId: org.organizationId,
		subareaId: areaId,
		dayOfWeek: "tuesday",
		startTime: "09:00",
		endTime: "17:00",
		minimumStaffCount: 1,
		createdBy: org.ownerUserId,
	});
	await fixture.db.insert(shift).values({
		organizationId: org.organizationId,
		subareaId: areaId,
		employeeId: employee.employeeId,
		date: shiftStoredDate("2026-10-20", "Europe/Berlin"),
		startTime: "09:00",
		endTime: "17:00",
		status: "published",
		createdBy: org.ownerUserId,
	});
	const before = await readAbsenceChangeCoverageSnapshot(target, fixture.db);
	expect(before?.liveOriginal).toMatchObject({
		startDate: "2026-10-19",
		endDate: "2026-10-19",
	});
	expect(before?.proposed).toMatchObject({
		startDate: "2026-10-19",
		endDate: "2026-10-20",
	});
	const assessed = await loadAbsenceChangeCoverageTriageEvidence(target, {
		database: fixture.db,
	});
	expect(assessed.evidence).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				state: "finding",
				reason: "staffing_shortfall",
				facts: expect.objectContaining({ date: "2026-10-20", staffCount: 0 }),
			}),
		]),
	);
	await fixture.pool.query(
		"update absence_entry set updated_at=updated_at+interval '1 second' where id=$1",
		[absenceId],
	);
	expect(
		(
			await loadAbsenceChangeCoverageTriageEvidence(
				{ ...target, context: assessed.context },
				{ database: fixture.db },
			)
		).evidence,
	).toMatchObject([{ state: "unknown", validity: "stale" }]);
	await expect(
		decideAbsenceChange(
			{
				organizationId: org.organizationId,
				actorEmployeeId: manager.employeeId,
				assignmentId,
				action: "approve",
			},
			{ database: fixture.db, clock },
		),
	).rejects.toMatchObject({ code: "obsolete" });
	expect(
		(
			await listOwnAbsenceChanges(
				{ organizationId: org.organizationId, userId: employee.userId },
				{ database: fixture.db, clock },
			)
		)[0]?.status,
	).toBe("obsolete");
});
it("never reuses captured facts for another organization, replaced proposal or retired assignment", async () => {
	const { org, target, submitted } = await submittedChange();
	const foreign = await fixture.organization();
	expect(
		(
			await loadAbsenceChangeCoverageTriageEvidence(
				{
					...target,
					context: {
						...target.context,
						organizationId: foreign.organizationId,
					},
				},
				{ database: fixture.db },
			)
		).evidence,
	).toMatchObject([{ state: "unknown" }]);
	const assessed = await loadAbsenceChangeCoverageTriageEvidence(target, {
		database: fixture.db,
	});
	await fixture.pool.query(
		"update absence_change_request set reason='Replacement reason' where id=$1 and organization_id=$2",
		[submitted.id, org.organizationId],
	);
	expect(
		(
			await loadAbsenceChangeCoverageTriageEvidence(
				{ ...target, context: assessed.context },
				{ database: fixture.db },
			)
		).evidence,
	).toMatchObject([{ state: "unknown", validity: "stale" }]);
	await fixture.pool.query(
		"update absence_change_request set status='withdrawn' where id=$1 and organization_id=$2",
		[submitted.id, org.organizationId],
	);
	expect(
		(
			await loadAbsenceChangeCoverageTriageEvidence(target, {
				database: fixture.db,
			})
		).evidence,
	).toMatchObject([{ state: "unknown" }]);
});
