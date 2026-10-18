import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
	approvalInboxProjection,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowRollout,
	approvalWorkflowStage,
	timeEntry,
	timeRecord,
	workPeriod,
} from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { captureTimeCorrectionSubmittedRevision } from "../evidence/store";
import { buildTimeCorrectionSubmittedFacts } from "../evidence/time-correction-facts";
import { loadTimeCorrectionTriageEvidence } from "./time-correction-evidence";
import type { ApprovalInboxTriageTarget } from "./triage-evidence";

function required<T>(value: T | undefined | null): T {
	if (value == null) throw new Error("Missing fixture value");
	return value;
}
let fixture: LifecycleDatabaseFixture;
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
});
afterEach(async () => {
	await fixture?.close();
});
it("loads a real pending correction, rejects changed proposal and isolates organizations", async () => {
	const organizationId = fixture.organizationId;
	const employeeId = fixture.employeeId;
	const rows = await fixture.db
		.insert(timeEntry)
		.values([
			{
				organizationId,
				employeeId,
				type: "clock_in" as const,
				timestamp: new Date("2026-10-15T07:00:00Z"),
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
				timezoneSource: "browser",
				hash: randomUUID(),
				createdBy: fixture.ownerUserId,
			},
			{
				organizationId,
				employeeId,
				type: "clock_out" as const,
				timestamp: new Date("2026-10-15T15:00:00Z"),
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
				timezoneSource: "browser",
				hash: randomUUID(),
				createdBy: fixture.ownerUserId,
			},
		])
		.returning();
	const clockIn = required(rows[0]);
	const clockOut = required(rows[1]);
	const correction = required(
		(
			await fixture.db
				.insert(timeEntry)
				.values({
					organizationId,
					employeeId,
					type: "correction",
					timestamp: new Date("2026-10-15T07:15:00Z"),
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "browser",
					replacesEntryId: clockIn.id,
					hash: randomUUID(),
					createdBy: fixture.ownerUserId,
				})
				.returning()
		)[0],
	);
	const record = required(
		(
			await fixture.db
				.insert(timeRecord)
				.values({
					organizationId,
					employeeId,
					recordKind: "work",
					startAt: clockIn.timestamp,
					endAt: clockOut.timestamp,
					durationMinutes: 480,
					approvalState: "approved",
					createdBy: fixture.ownerUserId,
				})
				.returning()
		)[0],
	);
	const period = required(
		(
			await fixture.db
				.insert(workPeriod)
				.values({
					organizationId,
					employeeId,
					clockInId: clockIn.id,
					clockOutId: clockOut.id,
					canonicalRecordId: record.id,
					startTime: clockIn.timestamp,
					endTime: clockOut.timestamp,
					durationMinutes: 480,
					workLocationType: "office",
					isActive: false,
					approvalStatus: "approved",
				})
				.returning()
		)[0],
	);
	const proposal = {
		action: "edit" as const,
		workLocationType: "office" as const,
		workCategoryId: null,
		clockInCorrectionId: correction.id,
	};
	const request = required(
		(
			await fixture.db
				.insert(approvalRequest)
				.values({
					organizationId,
					entityType: "time_entry",
					entityId: period.id,
					requestedBy: employeeId,
					approverId: fixture.ownerEmployeeId,
					metadata: { timeCorrection: proposal },
				})
				.returning()
		)[0],
	);
	const facts = buildTimeCorrectionSubmittedFacts({
		requesterEmployeeId: employeeId,
		period,
		clockIn,
		clockOut,
		correction: proposal,
		corrections: { clockIn: correction, clockOut: null },
	});
	await captureTimeCorrectionSubmittedRevision(fixture.db, {
		organizationId,
		lifecycle: {
			authority: "legacy",
			legacy: {
				approvalRequestId: request.id,
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
		submitter: { kind: "employee", employeeId, userId: fixture.ownerUserId },
	});
	const target: ApprovalInboxTriageTarget = {
		context: {
			organizationId,
			requestId: request.id,
			entityId: period.id,
			revision: null,
			scope: "inbox",
		},
		requestKind: "time_correction",
		type: "time_entry",
		authority: "compatibility_request",
		status: "pending",
		createdAt: "2026-10-18T08:00:00Z",
		priority: "normal",
	};
	expect(
		(await loadTimeCorrectionTriageEvidence(target, { database: fixture.db }))
			.evidence,
	).toMatchObject([
		{
			state: "clear",
			correction: {
				originalStart: "2026-10-15T07:00:00Z",
				proposedStart: "2026-10-15T07:15:00Z",
			},
		},
	]);
	await fixture.db
		.update(approvalRequest)
		.set({
			metadata: {
				timeCorrection: proposal,
				timeRequest: { kind: "manual_time_submission" },
			},
		})
		.where(eq(approvalRequest.id, request.id));
	expect(
		(await loadTimeCorrectionTriageEvidence(target, { database: fixture.db }))
			.evidence,
	).toMatchObject([{ state: "unknown" }]);
	await fixture.db
		.update(approvalRequest)
		.set({ metadata: { timeCorrection: proposal } })
		.where(eq(approvalRequest.id, request.id));
	const foreign = await fixture.createOrganization();
	expect(
		(
			await loadTimeCorrectionTriageEvidence(
				{ ...target, context: { ...target.context, organizationId: foreign } },
				{ database: fixture.db },
			)
		).evidence,
	).toMatchObject([{ state: "unknown" }]);
	await fixture.db
		.update(approvalRequest)
		.set({
			metadata: { timeCorrection: { ...proposal, workLocationType: "remote" } },
		})
		.where(eq(approvalRequest.id, request.id));
	expect(
		(await loadTimeCorrectionTriageEvidence(target, { database: fixture.db }))
			.evidence,
	).toMatchObject([{ state: "unknown", validity: "stale" }]);
	await fixture.db.insert(approvalWorkflowRollout).values({
		organizationId,
		workflowType: "time_correction",
		lifecycleMode: "canonical",
	});
	const workflow = required(
		(
			await fixture.db
				.insert(approvalWorkflow)
				.values({
					organizationId,
					workflowType: "time_correction",
					sourceType: "time_entry",
					sourceId: period.id,
					requesterEmployeeId: employeeId,
					currentStageOrder: 1,
					policySnapshot: {},
					contextSnapshot: { timeCorrection: proposal },
					displaySnapshot: {},
				})
				.returning()
		)[0],
	);
	const stage = required(
		(
			await fixture.db
				.insert(approvalWorkflowStage)
				.values({
					organizationId,
					workflowId: workflow.id,
					sequence: 1,
					label: "Review",
					resolverSnapshot: {},
					activationMode: "all",
					status: "pending",
				})
				.returning()
		)[0],
	);
	const assignment = required(
		(
			await fixture.db
				.insert(approvalStageAssignment)
				.values({
					organizationId,
					workflowId: workflow.id,
					stageId: stage.id,
					sequence: 1,
					approverEmployeeId: fixture.ownerEmployeeId,
				})
				.returning()
		)[0],
	);
	await fixture.db
		.update(workPeriod)
		.set({ approvalWorkflowId: workflow.id })
		.where(eq(workPeriod.id, period.id));
	await captureTimeCorrectionSubmittedRevision(fixture.db, {
		organizationId,
		lifecycle: { authority: "canonical", workflowId: workflow.id },
		requestCycleKey: randomUUID(),
		submittedAt: parseInstant("2026-10-18T08:00:00Z"),
		facts,
		labels: {
			subjectName: "Subject",
			requesterName: "Subject",
			submitterName: "Subject",
		},
		submitter: { kind: "employee", employeeId, userId: fixture.ownerUserId },
	});
	const canonical: ApprovalInboxTriageTarget = {
		...target,
		authority: "canonical_assignment",
		context: { ...target.context, requestId: assignment.id },
	};
	expect(
		(
			await loadTimeCorrectionTriageEvidence(canonical, {
				database: fixture.db,
			})
		).evidence,
	).toMatchObject([{ state: "clear" }]);
	expect(
		(await loadTimeCorrectionTriageEvidence(target, { database: fixture.db }))
			.evidence,
	).toMatchObject([{ state: "unknown" }]);
	const { prepareTimeReviewEvidence, buildTimeReviewSections } = await import(
		"../presentation/time-review"
	);
	const review = await prepareTimeReviewEvidence(
		{
			organizationId,
			approvalRequestId: assignment.id,
			canonicalAssignmentId: assignment.id,
			workPeriodId: period.id,
			requestPending: true,
			kind: "time_correction",
		},
		fixture.db,
	);
	expect(review.status).toBe("evidenced");
	expect(buildTimeReviewSections(review).decisionsBlocked).toBe(false);
	await fixture.db
		.update(approvalWorkflowRollout)
		.set({ evidenceMode: "capture" })
		.where(eq(approvalWorkflowRollout.organizationId, organizationId));
	await fixture.db
		.insert(approvalInboxProjection)
		.values({
			organizationId,
			workflowId: workflow.id,
			activeStageId: stage.id,
			sourceType: "time_entry",
			sourceId: period.id,
			status: "pending",
			displayPayload: {},
			searchText: "correction",
		});
	const { timeCorrectionInboxRead } = await import("./v1-canonical-read");
	const [actionable] = await timeCorrectionInboxRead.load({
		organizationId,
		approverId: fixture.ownerEmployeeId,
		database: fixture.db,
	});
	expect(actionable?.item.capabilities.canApprove).toBe(true);
	expect(actionable?.detail.actions.canApprove).toBe(true);

	const { createFastLaneDecisionGuard } = await import(
		"./fast-lane-decision-guard"
	);
	const { resolveApprovalInboxTriage } = await import("./triage-evidence");
	const { saveApprovalTriageSettings } = await import("../triage-settings");
	const at = new Date("2026-10-22T09:00:00Z");
	const current = await resolveApprovalInboxTriage({
		target: {
			...canonical,
			context: { ...canonical.context, scope: "submitted_request" },
		},
		now: at,
		policy: { staleAfterHours: 72, smallCorrectionMinutes: 15 },
		loadEvidence: (t) =>
			loadTimeCorrectionTriageEvidence(t, { database: fixture.db }),
	});
	expect(current.fastLaneGroup).toBe("stale_pending");
	const guard = createFastLaneDecisionGuard({
		request: {
			id: assignment.id,
			targetType: "canonical_assignment",
			entityType: "time_entry",
			entityId: period.id,
			organizationId,
			approverId: fixture.ownerEmployeeId,
			requesterEmployeeId: employeeId,
			status: "pending",
			workflowKind: "time_correction",
		},
		actorEmployeeId: fixture.ownerEmployeeId,
		action: "approve",
		now: at,
		review: {
			group: "stale_pending",
			reviewedContexts: { [assignment.id]: current.context ?? null },
		},
	});
	await saveApprovalTriageSettings(fixture.db, {
		organizationId,
		actorUserId: fixture.ownerUserId,
		staleAfterHours: 720,
		smallCorrectionMinutes: 15,
	});
	await expect(fixture.db.transaction((tx) => guard(tx))).rejects.toMatchObject(
		{ _tag: "ConflictError" },
	);
	await saveApprovalTriageSettings(fixture.db, {
		organizationId,
		actorUserId: fixture.ownerUserId,
		staleAfterHours: 72,
		smallCorrectionMinutes: 15,
	});

	await fixture.db
		.update(workPeriod)
		.set({ durationMinutes: 479 })
		.where(eq(workPeriod.id, period.id));
	expect(
		(
			await loadTimeCorrectionTriageEvidence(canonical, {
				database: fixture.db,
			})
		).evidence,
	).toMatchObject([{ state: "unknown", validity: "stale" }]);
	const [held] = await timeCorrectionInboxRead.load({
		organizationId,
		approverId: fixture.ownerEmployeeId,
		database: fixture.db,
	});
	expect(held?.item.capabilities.canApprove).toBe(false);
	expect(held?.detail.actions.canApprove).toBe(false);
	expect(
		buildTimeReviewSections(
			await prepareTimeReviewEvidence(
				{
					organizationId,
					approvalRequestId: assignment.id,
					canonicalAssignmentId: assignment.id,
					workPeriodId: period.id,
					requestPending: true,
					kind: "time_correction",
				},
				fixture.db,
			),
		).decisionsBlocked,
	).toBe(true);
});
