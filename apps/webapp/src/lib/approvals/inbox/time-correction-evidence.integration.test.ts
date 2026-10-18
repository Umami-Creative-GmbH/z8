import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
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
});
