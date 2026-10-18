import { and, eq, isNull } from "drizzle-orm";
import {
	approvalChainStageInstance,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	employee,
	workPeriod,
} from "@/db/schema";
import { readApprovalAuthoritySnapshot } from "../authority";
import { normalizeTimeCorrectionWorkflowPayload } from "../domain-adapters/time-correction-contract";
import { canonicalJson } from "../evidence/absence-facts";
import {
	loadCanonicalTimeCorrectionSubmittedRevision,
	loadLegacyTimeCorrectionSubmittedRevision,
} from "../evidence/store";
import { compareTimeCorrectionWithSubmittedRevision } from "../evidence/time-correction-evidence";
import type { TimeCorrectionSubmittedFacts } from "../evidence/time-correction-facts";
import type { ApprovalDatabase } from "../server/types";
import { classifyTimeApprovalRequest } from "../time-request-kind";
import type { TimeCorrectionTriageSnapshot } from "./time-correction-evidence";
import type { ApprovalInboxTriageTarget } from "./triage-evidence";

function expectedProposal(facts: TimeCorrectionSubmittedFacts) {
	return {
		action: facts.intent === "delete" ? "delete" : "edit",
		...(facts.requested.clockIn
			? { clockInCorrectionId: facts.requested.clockIn.correctionEntryId }
			: {}),
		...(facts.requested.clockOut
			? { clockOutCorrectionId: facts.requested.clockOut.correctionEntryId }
			: {}),
		...(facts.requested.workLocationType.kind === "set"
			? { workLocationType: facts.requested.workLocationType.value }
			: {}),
		...(facts.requested.workCategoryId.kind === "set"
			? { workCategoryId: facts.requested.workCategoryId.value }
			: {}),
		...(facts.requested.vehicleUse
			? { vehicleUse: facts.requested.vehicleUse.value }
			: {}),
	};
}
function matchesProposal(
	stored: Record<string, unknown> | null,
	facts: TimeCorrectionSubmittedFacts,
): boolean {
	try {
		const clockIn = facts.requested.clockIn
			? [facts.requested.clockIn.correctionEntryId]
			: [];
		const clockOut = facts.requested.clockOut
			? [facts.requested.clockOut.correctionEntryId]
			: [];
		if (
			classifyTimeApprovalRequest({
				metadata: stored,
				verifiedRelationalCorrectionIds: [...clockIn, ...clockOut],
				verifiedRelationalCorrectionIdsByEndpoint: { clockIn, clockOut },
			}) !== "time_correction"
		)
			return false;
		const actual = normalizeTimeCorrectionWorkflowPayload({
			timeCorrection: stored?.timeCorrection,
		});
		const expected = normalizeTimeCorrectionWorkflowPayload({
			timeCorrection: expectedProposal(facts),
		});
		return canonicalJson(actual) === canonicalJson(expected);
	} catch {
		return false;
	}
}
/** Resolve the exact pending request under current authority before consulting its submitted revision. */
export async function readTimeCorrectionTriageSnapshot(
	target: ApprovalInboxTriageTarget,
	suppliedDatabase?: ApprovalDatabase,
): Promise<TimeCorrectionTriageSnapshot | null> {
	if (target.requestKind !== "time_correction" || !target.authority)
		return null;
	const database = suppliedDatabase ?? (await import("@/db")).db;
	const organizationId = target.context.organizationId;
	const workPeriodId = target.context.entityId;
	const rollout = await readApprovalAuthoritySnapshot(database, {
		organizationId,
		workflowType: "time_correction",
	});
	if (
		rollout.authority !==
		(target.authority === "canonical_assignment" ? "canonical" : "legacy")
	)
		return null;
	let workflowId: string | null = null;
	let requesterId: string | null = null;
	let chainInstanceId: string | null = null;
	let proposal: Record<string, unknown> | null = null;
	if (target.authority === "canonical_assignment") {
		const rows = await database
			.select({
				workflowId: approvalWorkflow.id,
				requesterId: approvalWorkflow.requesterEmployeeId,
				proposal: approvalWorkflow.contextSnapshot,
			})
			.from(approvalStageAssignment)
			.innerJoin(
				approvalWorkflowStage,
				and(
					eq(approvalWorkflowStage.id, approvalStageAssignment.stageId),
					eq(approvalWorkflowStage.organizationId, organizationId),
				),
			)
			.innerJoin(
				approvalWorkflow,
				and(
					eq(approvalWorkflow.id, approvalStageAssignment.workflowId),
					eq(approvalWorkflow.organizationId, organizationId),
					eq(approvalWorkflowStage.workflowId, approvalWorkflow.id),
					eq(
						approvalWorkflowStage.sequence,
						approvalWorkflow.currentStageOrder,
					),
				),
			)
			.where(
				and(
					eq(approvalStageAssignment.id, target.context.requestId),
					eq(approvalStageAssignment.organizationId, organizationId),
					eq(approvalStageAssignment.status, "pending"),
					eq(approvalWorkflowStage.status, "pending"),
					eq(approvalWorkflow.status, "pending"),
					eq(approvalWorkflow.workflowType, "time_correction"),
					eq(approvalWorkflow.sourceType, "time_entry"),
					eq(approvalWorkflow.sourceId, workPeriodId),
				),
			)
			.limit(2);
		const row = rows[0];
		if (rows.length !== 1 || !row) return null;
		workflowId = row.workflowId;
		requesterId = row.requesterId;
		proposal = row.proposal;
	} else {
		const request = await database.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.id, target.context.requestId),
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, workPeriodId),
				eq(approvalRequest.status, "pending"),
			),
		});
		if (!request) return null;
		requesterId = request.requestedBy;
		proposal = request.metadata;
		const stages = await database
			.select({
				chainInstanceId: approvalChainStageInstance.chainInstanceId,
				status: approvalChainStageInstance.status,
			})
			.from(approvalChainStageInstance)
			.where(
				and(
					eq(approvalChainStageInstance.organizationId, organizationId),
					eq(
						approvalChainStageInstance.approvalRequestId,
						target.context.requestId,
					),
				),
			)
			.limit(2);
		if (stages.length > 1 || (stages[0] && stages[0].status !== "pending"))
			return null;
		chainInstanceId = stages[0]?.chainInstanceId ?? null;
	}
	const period = await database.query.workPeriod.findFirst({
		where: and(
			eq(workPeriod.id, workPeriodId),
			eq(workPeriod.organizationId, organizationId),
			isNull(workPeriod.deletedAt),
		),
	});
	if (
		!period ||
		period.employeeId !== requesterId ||
		(workflowId && period.approvalWorkflowId !== workflowId)
	)
		return null;
	const subject = await database.query.employee.findFirst({
		where: and(
			eq(employee.id, period.employeeId),
			eq(employee.organizationId, organizationId),
		),
		columns: { id: true },
	});
	if (!subject) return null;
	const revision = workflowId
		? await loadCanonicalTimeCorrectionSubmittedRevision(database, {
				organizationId,
				workflowId,
			})
		: await loadLegacyTimeCorrectionSubmittedRevision(database, {
				organizationId,
				workPeriodId,
				approvalRequestId: target.context.requestId,
				chainInstanceId,
			});
	if (
		revision &&
		(revision.workPeriodId !== workPeriodId ||
			revision.subjectEmployeeId !== period.employeeId ||
			revision.requesterEmployeeId !== requesterId)
	)
		return null;
	const comparison =
		!revision || !matchesProposal(proposal, revision.facts)
			? {
					kind: "material_change" as const,
					changedFields: ["request_proposal"],
				}
			: await compareTimeCorrectionWithSubmittedRevision(database, revision);
	return {
		organizationId,
		requestId: target.context.requestId,
		workPeriodId,
		status: "pending",
		authority: target.authority,
		currentAuthority: rollout.authority,
		comparison,
		revision: revision
			? {
					id: revision.id,
					materialFingerprint: revision.materialFingerprint,
					facts: revision.facts,
				}
			: null,
	};
}
