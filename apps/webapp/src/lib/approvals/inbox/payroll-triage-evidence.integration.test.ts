import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowRollout,
	approvalWorkflowStage,
	payrollAccessEmployee,
	payrollAccessGrant,
	payrollBlockerDismissal,
	payrollWorkCollectionControl,
	timeEntry,
	timeRecord,
	timeRecordAbsence,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import { dateFromInstant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	captureAbsenceSubmittedRevision,
	captureLegacyAbsenceSubmittedRevision,
	captureTimeCorrectionSubmittedRevision,
	loadLegacyAbsenceSubmittedRevision,
} from "../evidence/store";
import { buildTimeCorrectionSubmittedFacts } from "../evidence/time-correction-facts";
import {
	loadPayrollTriageEvidence,
	type PayrollTriageAssessmentContext,
} from "./payroll-triage-evidence";
import { readPayrollTriageRequest } from "./payroll-triage-source";
import type { ApprovalInboxTriageTarget } from "./triage-evidence";

const requestSession = vi.hoisted(() => ({
	current: null as null | {
		user: { id: string; name: string; email: string };
		session: { id: string; userId: string; activeOrganizationId: string };
	},
}));
vi.mock("@/lib/auth/request-session", () => ({
	getRequestSession: async () => requestSession.current,
}));
let fixture: LifecycleDatabaseFixture;
let target: ApprovalInboxTriageTarget;
let assessmentContext: PayrollTriageAssessmentContext;
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	const organizationId = fixture.organizationId;
	await fixture.pool.query(
		"update organization set timezone = 'UTC' where id=$1",
		[organizationId],
	);
	requestSession.current = {
		user: {
			id: fixture.ownerUserId,
			name: "Officer",
			email: "officer@example.test",
		},
		session: {
			id: "payroll-triage-session",
			userId: fixture.ownerUserId,
			activeOrganizationId: organizationId,
		},
	};
	assessmentContext = {
		organizationId,
		actor: { userId: fixture.ownerUserId, employeeId: fixture.ownerEmployeeId },
		period: {
			startDate: "2026-10-01",
			endDate: "2026-10-31",
			label: "October",
		},
	};
	const categoryId = randomUUID(),
		recordId = randomUUID(),
		absenceId = randomUUID(),
		approvalRequestId = randomUUID(),
		grantId = randomUUID();
	await fixture.db.insert(absenceCategory).values({
		id: categoryId,
		organizationId,
		type: "vacation",
		name: "Leave",
	});
	await fixture.db.insert(timeRecord).values({
		id: recordId,
		organizationId,
		employeeId: fixture.employeeId,
		recordKind: "absence",
		startAt: dateFromInstant(parseInstant("2026-10-19T00:00:00Z")),
		endAt: dateFromInstant(parseInstant("2026-10-19T23:59:59.999Z")),
		durationMinutes: 1440,
		approvalState: "pending",
		origin: "manual",
		createdBy: fixture.ownerUserId,
	});
	await fixture.db
		.insert(timeRecordAbsence)
		.values({ recordId, organizationId, absenceCategoryId: categoryId });
	await fixture.db.insert(absenceEntry).values({
		id: absenceId,
		organizationId,
		employeeId: fixture.employeeId,
		categoryId,
		startDate: "2026-10-19",
		endDate: "2026-10-19",
		canonicalRecordId: recordId,
	});
	await fixture.db.insert(approvalRequest).values({
		id: approvalRequestId,
		organizationId,
		entityType: "absence_entry",
		entityId: absenceId,
		requestedBy: fixture.ownerEmployeeId,
		approverId: fixture.ownerEmployeeId,
		canonicalRecordId: recordId,
	});
	await fixture.db.insert(payrollAccessGrant).values({
		id: grantId,
		organizationId,
		payrollEmployeeId: fixture.ownerEmployeeId,
		scope: "specific",
		createdBy: fixture.ownerUserId,
	});
	await fixture.db.insert(payrollAccessEmployee).values({
		organizationId,
		grantId,
		employeeId: fixture.employeeId,
		createdBy: fixture.ownerUserId,
	});
	await captureLegacyAbsenceSubmittedRevision(fixture.db, {
		organizationId,
		requestCycleKey: randomUUID(),
		submittedAt: parseInstant("2026-10-18T08:00:00Z"),
		facts: {
			schemaVersion: 1,
			kind: "absence",
			organizationId,
			absenceId,
			subjectEmployeeId: fixture.employeeId,
			requesterEmployeeId: fixture.ownerEmployeeId,
			categoryId,
			inputEncoding: "duration_kind_full_day",
			coverage: {
				kind: "full_day",
				startDate: "2026-10-19",
				endDate: "2026-10-19",
			},
			compatibility: {
				entry: {
					startDate: "2026-10-19",
					endDate: "2026-10-19",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				canonicalRecord: {
					id: recordId,
					startAt: "2026-10-19T00:00:00Z",
					endAt: "2026-10-19T23:59:59.999Z",
					encoding: "utc_synthetic_bounds",
				},
			},
		},
		labels: {
			subjectName: "Subject",
			requesterName: "Officer",
			submitterName: "Officer",
			categoryName: "Leave",
		},
		submitter: {
			kind: "employee",
			employeeId: fixture.ownerEmployeeId,
			userId: fixture.ownerUserId,
		},
		legacy: {
			approvalRequestId,
			chainInstanceId: null,
			observedWorkflowId: null,
		},
	});
	target = {
		context: {
			organizationId,
			requestId: approvalRequestId,
			entityId: absenceId,
			revision: null,
			scope: "inbox",
		},
		requestKind: "absence",
		type: "absence_entry",
		status: "pending",
		createdAt: "2026-10-18T08:00:00Z",
		priority: "normal",
		authority: "compatibility_request",
		requesterEmployeeId: fixture.ownerEmployeeId,
	};
});
afterEach(async () => fixture?.close());
it("reads the effective payroll blocker for an on-behalf absence in the officer's subject scope", async () => {
	const result = await loadPayrollTriageEvidence(target, { assessmentContext });
	expect(result.evidence).toMatchObject([
		{
			check: "payroll",
			state: "finding",
			validity: "current",
			reason: "payroll_blocker",
			payrollPeriod: { startDate: "2026-10-01", endDate: "2026-10-31" },
			facts: { blockerType: "pending_absence" },
		},
	]);
});

function required<T>(value: T | undefined | null): T {
	if (value == null) throw new Error("Missing fixture value");
	return value;
}
async function seedLegacyCorrection(
	interval = { start: "2026-10-19T08:00:00Z", end: "2026-10-19T16:00:00Z" },
) {
	const organizationId = fixture.organizationId;
	const recordId = randomUUID(),
		periodId = randomUUID(),
		requestId = randomUUID();
	const start = dateFromInstant(parseInstant(interval.start)),
		end = dateFromInstant(parseInstant(interval.end));
	const entries = await fixture.db
		.insert(timeEntry)
		.values([
			{
				organizationId,
				employeeId: fixture.employeeId,
				type: "clock_in" as const,
				timestamp: start,
				utcOffsetMinutes: 0,
				timezone: "UTC",
				timezoneSource: "backfill",
				hash: randomUUID(),
				createdBy: fixture.ownerUserId,
			},
			{
				organizationId,
				employeeId: fixture.employeeId,
				type: "clock_out" as const,
				timestamp: end,
				utcOffsetMinutes: 0,
				timezone: "UTC",
				timezoneSource: "backfill",
				hash: randomUUID(),
				createdBy: fixture.ownerUserId,
			},
		])
		.returning();
	const clockIn = required(entries.find((entry) => entry.type === "clock_in")),
		clockOut = required(entries.find((entry) => entry.type === "clock_out"));
	await fixture.db.insert(timeRecord).values({
		id: recordId,
		organizationId,
		employeeId: fixture.employeeId,
		recordKind: "work",
		startAt: start,
		endAt: end,
		durationMinutes: 480,
		approvalState: "approved",
		origin: "manual",
		createdBy: fixture.ownerUserId,
	});
	await fixture.db.insert(timeRecordWork).values({ recordId, organizationId });
	const [period] = await fixture.db
		.insert(workPeriod)
		.values({
			id: periodId,
			organizationId,
			employeeId: fixture.employeeId,
			clockInId: clockIn.id,
			clockOutId: clockOut.id,
			startTime: start,
			endTime: end,
			durationMinutes: 480,
			isActive: false,
			approvalStatus: "approved",
			canonicalRecordId: recordId,
		})
		.returning();
	await fixture.db.insert(approvalRequest).values({
		id: requestId,
		organizationId,
		entityType: "time_entry",
		entityId: periodId,
		canonicalRecordId: recordId,
		requestedBy: fixture.employeeId,
		approverId: fixture.ownerEmployeeId,
		metadata: {
			timeCorrection: {
				action: "edit",
				workLocationType: "remote",
				workCategoryId: null,
			},
		},
	});
	const facts = buildTimeCorrectionSubmittedFacts({
		requesterEmployeeId: fixture.employeeId,
		period: required(period),
		clockIn,
		clockOut,
		correction: {
			action: "edit",
			workLocationType: "remote",
			workCategoryId: null,
		},
		corrections: { clockIn: null, clockOut: null },
	});
	await captureTimeCorrectionSubmittedRevision(fixture.db, {
		organizationId,
		lifecycle: {
			authority: "legacy",
			legacy: {
				approvalRequestId: requestId,
				chainInstanceId: null,
				observedWorkflowId: null,
			},
		},
		requestCycleKey: randomUUID(),
		submittedAt: parseInstant("2026-10-18T08:00:00Z"),
		facts,
		labels: {
			subjectName: "Subject",
			requesterName: "Subject",
			submitterName: "Subject",
		},
		submitter: {
			kind: "employee",
			employeeId: fixture.employeeId,
			userId: fixture.ownerUserId,
		},
	});
	return {
		target: {
			...target,
			context: { ...target.context, requestId, entityId: periodId },
			requestKind: "time_correction" as const,
			type: "time_entry" as const,
			requesterEmployeeId: fixture.employeeId,
		},
		recordId,
		facts,
	};
}
it("resolves the legacy correction request ID independently from the work record and inbox presentation", async () => {
	const correction = await seedLegacyCorrection();
	const result = await loadPayrollTriageEvidence(correction.target, {
		assessmentContext,
	});
	expect(result.evidence).toMatchObject([
		{
			state: "finding",
			reason: "payroll_blocker",
			facts: {
				sourceId: correction.target.context.requestId,
				blockerType: "pending_time_correction",
			},
		},
	]);
});

it("uses the effective dismissal state on each assessment and restores blockers when dismissal is removed", async () => {
	const source = required(await readPayrollTriageRequest(target));
	await fixture.db.insert(payrollBlockerDismissal).values({
		organizationId: fixture.organizationId,
		blockerType: "pending_absence",
		sourceId: source.canonicalRecordId,
		employeeId: fixture.employeeId,
		dismissedByEmployeeId: fixture.ownerEmployeeId,
	});
	expect(
		(await loadPayrollTriageEvidence(target, { assessmentContext })).evidence,
	).toMatchObject([{ state: "clear", validity: "current" }]);
	await fixture.db
		.delete(payrollBlockerDismissal)
		.where(eq(payrollBlockerDismissal.organizationId, fixture.organizationId));
	expect(
		(await loadPayrollTriageEvidence(target, { assessmentContext })).evidence,
	).toMatchObject([{ state: "finding", reason: "payroll_blocker" }]);
});
it("does not expose payroll evidence without an active subject grant or through a foreign organization", async () => {
	const foreign = await fixture.createOrganization();
	expect(
		(
			await loadPayrollTriageEvidence(
				{ ...target, context: { ...target.context, organizationId: foreign } },
				{
					assessmentContext: { ...assessmentContext, organizationId: foreign },
				},
			)
		).evidence,
	).toMatchObject([{ state: "unknown" }]);
	expect(
		(
			await loadPayrollTriageEvidence(target, {
				assessmentContext: {
					...assessmentContext,
					actor: { ...assessmentContext.actor, userId: "another-user" },
				},
			})
		).evidence,
	).toMatchObject([{ state: "unknown" }]);
	await fixture.db
		.update(payrollAccessGrant)
		.set({ isActive: false })
		.where(eq(payrollAccessGrant.organizationId, fixture.organizationId));
	expect(
		(await loadPayrollTriageEvidence(target, { assessmentContext })).evidence,
	).toMatchObject([{ state: "unknown" }]);
});
it("marks changed submitted absence facts stale and refuses a different explicit period", async () => {
	expect(
		(
			await loadPayrollTriageEvidence(target, {
				assessmentContext: {
					...assessmentContext,
					period: {
						startDate: "2026-11-01",
						endDate: "2026-11-30",
						label: "November",
					},
				},
			})
		).evidence,
	).toMatchObject([{ state: "unknown" }]);
	await fixture.db
		.update(absenceEntry)
		.set({ endDate: "2026-10-20" })
		.where(eq(absenceEntry.id, target.context.entityId));
	expect(
		(await loadPayrollTriageEvidence(target, { assessmentContext })).evidence,
	).toMatchObject([{ state: "unknown", validity: "stale" }]);
});
async function canonicalAssignment(
	input: ApprovalInboxTriageTarget,
	withLegacyAlias = false,
) {
	const organizationId = fixture.organizationId,
		workflowId = randomUUID(),
		stageId = randomUUID(),
		assignmentId = randomUUID();
	if (
		input.requestKind !== "absence" &&
		input.requestKind !== "time_correction"
	)
		throw new Error("Unsupported fixture kind");
	await fixture.db.insert(approvalWorkflowRollout).values({
		organizationId,
		workflowType: input.requestKind,
		lifecycleMode: "canonical",
	});
	await fixture.db.insert(approvalWorkflow).values({
		id: workflowId,
		organizationId,
		workflowType: input.requestKind,
		sourceType:
			input.requestKind === "absence" ? "absence_entry" : "time_entry",
		sourceId: input.context.entityId,
		requesterEmployeeId: input.requesterEmployeeId,
		currentStageOrder: 1,
		policySnapshot: {},
		contextSnapshot: {},
		displaySnapshot: {},
	});
	await fixture.db.insert(approvalWorkflowStage).values({
		id: stageId,
		organizationId,
		workflowId,
		sequence: 1,
		label: "Review",
		resolverSnapshot: {},
		activationMode: "all",
		status: "pending",
		legacyApprovalRequestId: withLegacyAlias ? input.context.requestId : null,
	});
	await fixture.db.insert(approvalStageAssignment).values({
		id: assignmentId,
		organizationId,
		workflowId,
		stageId,
		sequence: 1,
		approverEmployeeId: fixture.ownerEmployeeId,
	});
	if (input.requestKind === "absence")
		await fixture.db
			.update(absenceEntry)
			.set({ approvalWorkflowId: workflowId })
			.where(eq(absenceEntry.id, input.context.entityId));
	else
		await fixture.db
			.update(workPeriod)
			.set({ approvalWorkflowId: workflowId })
			.where(eq(workPeriod.id, input.context.entityId));
	return {
		workflowId,
		target: {
			...input,
			authority: "canonical_assignment" as const,
			context: { ...input.context, requestId: assignmentId },
		},
	};
}
it("maps a canonical absence assignment through its submitted revision to the canonical absence record", async () => {
	const legacy = required(
		await loadLegacyAbsenceSubmittedRevision(fixture.db, {
			organizationId: fixture.organizationId,
			absenceId: target.context.entityId,
		}),
	);
	const canonical = await canonicalAssignment(target);
	await captureAbsenceSubmittedRevision(fixture.db, {
		organizationId: fixture.organizationId,
		workflowId: canonical.workflowId,
		requestCycleKey: randomUUID(),
		submittedAt: parseInstant("2026-10-18T08:00:00Z"),
		facts: legacy.facts,
		labels: legacy.labels,
		submitter: {
			kind: "employee",
			employeeId: fixture.ownerEmployeeId,
			userId: fixture.ownerUserId,
		},
	});
	expect(
		(await loadPayrollTriageEvidence(canonical.target, { assessmentContext }))
			.evidence,
	).toMatchObject([
		{
			state: "finding",
			reason: "payroll_blocker",
			facts: { sourceId: legacy.facts.compatibility.canonicalRecord.id },
		},
	]);
	expect(
		(await loadPayrollTriageEvidence(target, { assessmentContext })).evidence,
	).toMatchObject([{ state: "unknown" }]);
});
it("maps canonical correction assignment aliases and scoped hard blockers without treating the assignment as a payroll ID", async () => {
	const correction = await seedLegacyCorrection();
	const canonical = await canonicalAssignment(correction.target, true);
	await captureTimeCorrectionSubmittedRevision(fixture.db, {
		organizationId: fixture.organizationId,
		lifecycle: { authority: "canonical", workflowId: canonical.workflowId },
		requestCycleKey: randomUUID(),
		submittedAt: parseInstant("2026-10-18T08:00:00Z"),
		facts: correction.facts,
		labels: {
			subjectName: "Subject",
			requesterName: "Subject",
			submitterName: "Subject",
		},
		submitter: {
			kind: "employee",
			employeeId: fixture.employeeId,
			userId: fixture.ownerUserId,
		},
	});
	expect(
		(await loadPayrollTriageEvidence(canonical.target, { assessmentContext }))
			.evidence,
	).toMatchObject([
		{
			state: "finding",
			reason: "payroll_blocker",
			facts: {
				sourceId: correction.target.context.requestId,
				blockerType: "pending_time_correction",
			},
		},
	]);
	await fixture.db.insert(payrollBlockerDismissal).values({
		organizationId: fixture.organizationId,
		blockerType: "pending_time_correction",
		sourceId: correction.target.context.requestId,
		employeeId: fixture.employeeId,
		dismissedByEmployeeId: fixture.ownerEmployeeId,
	});
	expect(
		(await loadPayrollTriageEvidence(canonical.target, { assessmentContext }))
			.evidence,
	).toMatchObject([{ state: "clear" }]);
	await fixture.db
		.insert(payrollWorkCollectionControl)
		.values({ organizationId: fixture.organizationId, mode: "active" });
	expect(
		(await loadPayrollTriageEvidence(canonical.target, { assessmentContext }))
			.evidence,
	).toMatchObject([
		{
			state: "finding",
			reason: "payroll_blocker",
			facts: {
				sourceId: correction.recordId,
				blockerType: "pending_work_correction",
			},
		},
	]);
});

it("keeps a canonical-only correction unknown when the payroll source cannot prove that pending work belongs to this revision", async () => {
	const correction = await seedLegacyCorrection();
	const canonical = await canonicalAssignment(correction.target, false);
	await fixture.db
		.delete(approvalRequest)
		.where(eq(approvalRequest.id, correction.target.context.requestId));
	await fixture.db
		.update(workPeriod)
		.set({
			pendingChanges: {
				originalStartTime: "2026-10-19T08:00:00Z",
				originalEndTime: "2026-10-19T16:00:00Z",
				originalDurationMinutes: 480,
				requestedStartTime: "2026-10-19T12:00:00Z",
				requestedAt: "2026-10-18T08:00:00Z",
				requestedBy: fixture.ownerUserId,
			},
		})
		.where(eq(workPeriod.id, correction.target.context.entityId));
	await captureTimeCorrectionSubmittedRevision(fixture.db, {
		organizationId: fixture.organizationId,
		lifecycle: { authority: "canonical", workflowId: canonical.workflowId },
		requestCycleKey: randomUUID(),
		submittedAt: parseInstant("2026-10-18T08:00:00Z"),
		facts: correction.facts,
		labels: {
			subjectName: "Subject",
			requesterName: "Subject",
			submitterName: "Subject",
		},
		submitter: {
			kind: "employee",
			employeeId: fixture.employeeId,
			userId: fixture.ownerUserId,
		},
	});
	await fixture.db
		.insert(payrollWorkCollectionControl)
		.values({ organizationId: fixture.organizationId, mode: "active" });
	expect(
		(await loadPayrollTriageEvidence(canonical.target, { assessmentContext }))
			.evidence,
	).toMatchObject([{ state: "unknown" }]);
});

it("does not report all-clear when corrected work ends exactly at the scoped payroll window's opening boundary", async () => {
	const correction = await seedLegacyCorrection({
		start: "2026-10-19T16:00:00Z",
		end: "2026-10-20T00:00:00Z",
	});
	await fixture.db
		.insert(payrollWorkCollectionControl)
		.values({ organizationId: fixture.organizationId, mode: "active" });
	const result = await loadPayrollTriageEvidence(correction.target, {
		assessmentContext: {
			...assessmentContext,
			period: {
				startDate: "2026-10-20",
				endDate: "2026-10-20",
				label: "20 October",
			},
		},
	});
	expect(result.evidence).toMatchObject([{ state: "unknown" }]);
});

it("resolves a compatibility request under canonical authority only through its current canonical stage alias", async () => {
	const correction = await seedLegacyCorrection();
	const canonical = await canonicalAssignment(correction.target, true);
	await captureTimeCorrectionSubmittedRevision(fixture.db, {
		organizationId: fixture.organizationId,
		lifecycle: { authority: "canonical", workflowId: canonical.workflowId },
		requestCycleKey: randomUUID(),
		submittedAt: parseInstant("2026-10-18T08:00:00Z"),
		facts: correction.facts,
		labels: {
			subjectName: "Subject",
			requesterName: "Subject",
			submitterName: "Subject",
		},
		submitter: {
			kind: "employee",
			employeeId: fixture.employeeId,
			userId: fixture.ownerUserId,
		},
	});
	expect(
		(await loadPayrollTriageEvidence(correction.target, { assessmentContext }))
			.evidence,
	).toMatchObject([
		{
			state: "finding",
			reason: "payroll_blocker",
			facts: { sourceId: correction.target.context.requestId },
		},
	]);
});
