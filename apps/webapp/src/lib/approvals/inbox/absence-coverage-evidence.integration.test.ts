function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("Missing fixture value");
	return value;
}

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowRollout,
	approvalWorkflowStage,
	coverageRule,
	location,
	locationSubarea,
	shift,
} from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { shiftStoredDate } from "@/lib/scheduling/shift-date";
import {
	captureAbsenceSubmittedRevision,
	captureLegacyAbsenceSubmittedRevision,
} from "../evidence/store";
import { loadAbsenceCoverageTriageEvidence } from "./absence-coverage-evidence";
import { snapshot } from "./absence-coverage-evidence.test-fixture";
import type { ApprovalInboxTriageTarget } from "./triage-evidence";

let fixture: LifecycleDatabaseFixture;
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	await fixture.pool.query(
		"update organization set timezone='Europe/Berlin' where id=$1",
		[fixture.organizationId],
	);
});
afterEach(async () => {
	await fixture?.close();
});
it("assesses real legacy submitted coverage, subtracts other approved absence and isolates organizations", async () => {
	const org = fixture.organizationId;
	const peer = await fixture.seedEmployee();
	const [category] = await fixture.db
		.insert(absenceCategory)
		.values({ organizationId: org, type: "vacation", name: "Leave" })
		.returning();
	const [absence] = await fixture.db
		.insert(absenceEntry)
		.values({
			organizationId: org,
			employeeId: fixture.employeeId,
			categoryId: required(category).id,
			startDate: "2026-10-19",
			endDate: "2026-10-19",
		})
		.returning();
	const [request] = await fixture.db
		.insert(approvalRequest)
		.values({
			organizationId: org,
			entityType: "absence_entry",
			entityId: required(absence).id,
			requestedBy: fixture.employeeId,
			approverId: fixture.ownerEmployeeId,
		})
		.returning();
	const [site] = await fixture.db
		.insert(location)
		.values({
			organizationId: org,
			name: "Office",
			createdBy: fixture.ownerUserId,
		})
		.returning();
	const [area] = await fixture.db
		.insert(locationSubarea)
		.values({
			locationId: required(site).id,
			name: "Desk",
			createdBy: fixture.ownerUserId,
		})
		.returning();
	await fixture.db.insert(coverageRule).values({
		organizationId: org,
		subareaId: required(area).id,
		dayOfWeek: "monday",
		startTime: "09:00",
		endTime: "17:00",
		minimumStaffCount: 1,
		createdBy: fixture.ownerUserId,
	});
	await fixture.db.insert(shift).values(
		[fixture.employeeId, peer.employeeId].map((employeeId) => ({
			organizationId: org,
			employeeId,
			subareaId: required(area).id,
			date: shiftStoredDate("2026-10-19", "Europe/Berlin"),
			startTime: "09:00",
			endTime: "17:00",
			status: "published" as const,
			createdBy: fixture.ownerUserId,
		})),
	);
	const facts = {
		...required(snapshot.revision).facts,
		organizationId: org,
		absenceId: required(absence).id,
		subjectEmployeeId: fixture.employeeId,
		requesterEmployeeId: fixture.employeeId,
		categoryId: required(category).id,
		compatibility: {
			...required(snapshot.revision).facts.compatibility,
			canonicalRecord: {
				...required(snapshot.revision).facts.compatibility.canonicalRecord,
				id: randomUUID(),
			},
		},
	};
	await captureLegacyAbsenceSubmittedRevision(fixture.db, {
		organizationId: org,
		requestCycleKey: randomUUID(),
		submittedAt: parseInstant("2026-10-18T08:00:00Z"),
		facts,
		labels: {
			subjectName: "Subject",
			requesterName: "Subject",
			submitterName: "Subject",
			categoryName: "Leave",
		},
		submitter: {
			kind: "employee",
			employeeId: fixture.employeeId,
			userId: null,
		},
		legacy: {
			approvalRequestId: required(request).id,
			chainInstanceId: null,
			observedWorkflowId: null,
		},
	});
	const target: ApprovalInboxTriageTarget = {
		context: {
			organizationId: org,
			requestId: required(request).id,
			entityId: required(absence).id,
			revision: null,
			scope: "submitted_request",
		},
		requestKind: "absence",
		type: "absence_entry",
		status: "pending",
		createdAt: "2026-10-18T08:00:00Z",
		priority: "normal",
		authority: "compatibility_request",
	};
	expect(
		(await loadAbsenceCoverageTriageEvidence(target, { database: fixture.db }))
			.evidence,
	).toMatchObject([{ state: "clear", validity: "current" }]);
	const { resolveApprovalInboxTriage } = await import("./triage-evidence");
	const { createFastLaneDecisionGuard } = await import(
		"./fast-lane-decision-guard"
	);
	const { saveApprovalTriageSettings } = await import("../triage-settings");
	const at = new Date("2026-10-22T09:00:00Z");
	const reviewed = await resolveApprovalInboxTriage({
		target,
		now: at,
		policy: { staleAfterHours: 72, smallCorrectionMinutes: 15 },
		loadEvidence: (t) =>
			loadAbsenceCoverageTriageEvidence(t, { database: fixture.db }),
	});
	expect(reviewed.fastLaneGroup).toBe("stale_pending");
	const guard = createFastLaneDecisionGuard({
		request: {
			id: target.context.requestId,
			targetType: "compatibility_request",
			entityType: "absence_entry",
			entityId: target.context.entityId,
			organizationId: org,
			approverId: fixture.ownerEmployeeId,
			requesterEmployeeId: fixture.employeeId,
			status: "pending",
			workflowKind: "absence",
		},
		actorEmployeeId: fixture.ownerEmployeeId,
		action: "approve",
		now: at,
		review: {
			group: "stale_pending",
			reviewedContexts: {
				[target.context.requestId]: reviewed.context ?? null,
			},
		},
	});
	await saveApprovalTriageSettings(fixture.db, {
		organizationId: org,
		actorUserId: fixture.ownerUserId,
		staleAfterHours: 720,
		smallCorrectionMinutes: 15,
	});
	await expect(fixture.db.transaction((tx) => guard(tx))).rejects.toMatchObject(
		{ _tag: "ConflictError" },
	);
	await saveApprovalTriageSettings(fixture.db, {
		organizationId: org,
		actorUserId: fixture.ownerUserId,
		staleAfterHours: 72,
		smallCorrectionMinutes: 15,
	});
	await fixture.db.insert(absenceEntry).values({
		organizationId: org,
		employeeId: peer.employeeId,
		categoryId: required(category).id,
		startDate: "2026-10-19",
		endDate: "2026-10-19",
		status: "approved",
	});
	expect(
		(await loadAbsenceCoverageTriageEvidence(target, { database: fixture.db }))
			.evidence,
	).toMatchObject([
		{
			state: "finding",
			reason: "staffing_shortfall",
			facts: { staffCount: 0, minimumStaffCount: 1 },
		},
	]);
	const foreign = await fixture.createOrganization();
	const outsider = await fixture.seedEmployee({ organizationId: foreign });
	const [foreignSite] = await fixture.db
		.insert(location)
		.values({
			organizationId: foreign,
			name: "Private foreign workplace",
			createdBy: fixture.ownerUserId,
		})
		.returning();
	await fixture.db
		.update(locationSubarea)
		.set({ locationId: required(foreignSite).id, name: "Private foreign area" })
		.where(eq(locationSubarea.id, required(area).id));
	const foreignAreaResult = await loadAbsenceCoverageTriageEvidence(target, {
		database: fixture.db,
	});
	expect(foreignAreaResult.evidence).toMatchObject([{ state: "unknown" }]);
	expect(JSON.stringify(foreignAreaResult)).not.toContain(
		"Private foreign area",
	);
	await fixture.db
		.update(locationSubarea)
		.set({ locationId: required(site).id, name: "Desk" })
		.where(eq(locationSubarea.id, required(area).id));
	await fixture.db
		.update(shift)
		.set({ employeeId: outsider.employeeId })
		.where(eq(shift.employeeId, peer.employeeId));
	expect(
		(await loadAbsenceCoverageTriageEvidence(target, { database: fixture.db }))
			.evidence,
	).toMatchObject([{ state: "finding", facts: { staffCount: 0 } }]);
	expect(
		(
			await loadAbsenceCoverageTriageEvidence(
				{ ...target, context: { ...target.context, organizationId: foreign } },
				{ database: fixture.db },
			)
		).evidence,
	).toMatchObject([{ state: "unknown" }]);
	await fixture.db.insert(approvalWorkflowRollout).values({
		organizationId: org,
		workflowType: "absence",
		lifecycleMode: "canonical",
	});
	const [workflow] = await fixture.db
		.insert(approvalWorkflow)
		.values({
			organizationId: org,
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId: required(absence).id,
			requesterEmployeeId: fixture.employeeId,
			currentStageOrder: 1,
			policySnapshot: {},
			contextSnapshot: {},
			displaySnapshot: {},
		})
		.returning();
	const [stage] = await fixture.db
		.insert(approvalWorkflowStage)
		.values({
			organizationId: org,
			workflowId: required(workflow).id,
			sequence: 1,
			label: "Review",
			resolverSnapshot: {},
			activationMode: "all",
			status: "pending",
		})
		.returning();
	const [assignment] = await fixture.db
		.insert(approvalStageAssignment)
		.values({
			organizationId: org,
			workflowId: required(workflow).id,
			stageId: required(stage).id,
			sequence: 1,
			approverEmployeeId: fixture.ownerEmployeeId,
		})
		.returning();
	await fixture.db
		.update(absenceEntry)
		.set({ approvalWorkflowId: required(workflow).id })
		.where(eq(absenceEntry.id, required(absence).id));
	await captureAbsenceSubmittedRevision(fixture.db, {
		organizationId: org,
		workflowId: required(workflow).id,
		requestCycleKey: randomUUID(),
		submittedAt: parseInstant("2026-10-18T08:00:00Z"),
		facts,
		labels: {
			subjectName: "Subject",
			requesterName: "Subject",
			submitterName: "Subject",
			categoryName: "Leave",
		},
		submitter: {
			kind: "employee",
			employeeId: fixture.employeeId,
			userId: null,
		},
	});
	const canonical: ApprovalInboxTriageTarget = {
		...target,
		authority: "canonical_assignment",
		context: { ...target.context, requestId: required(assignment).id },
	};
	expect(
		(
			await loadAbsenceCoverageTriageEvidence(canonical, {
				database: fixture.db,
			})
		).evidence,
	).toMatchObject([{ state: "finding", reason: "staffing_shortfall" }]);
	expect(
		(await loadAbsenceCoverageTriageEvidence(target, { database: fixture.db }))
			.evidence,
	).toMatchObject([{ state: "unknown" }]);
	await fixture.db
		.update(absenceEntry)
		.set({ endDate: "2026-10-20" })
		.where(eq(absenceEntry.id, required(absence).id));
	expect(
		(
			await loadAbsenceCoverageTriageEvidence(canonical, {
				database: fixture.db,
			})
		).evidence,
	).toMatchObject([{ state: "unknown", validity: "stale" }]);
});
