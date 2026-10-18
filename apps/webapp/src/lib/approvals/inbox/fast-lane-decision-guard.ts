import { and, eq } from "drizzle-orm";
import {
	absenceEntry,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
} from "@/db/schema";
import { ConflictError } from "@/lib/effect/errors";
import type { ApprovalActionOptions } from "../domain/types";
import {
	buildAbsenceReviewSections,
	prepareAbsenceReviewEvidence,
} from "../presentation/absence-review";
import {
	buildTimeReviewSections,
	prepareTimeReviewEvidence,
} from "../presentation/time-review";
import { loadApprovalTriageSettings } from "../triage-settings";
import type { PersistedApprovalRequestForDecision } from "./decision-service";
import {
	type ApprovalFastLaneReview,
	matchesFastLaneReview,
} from "./fast-lane-review";
import {
	loadCurrentApprovalTriageEvidence,
	resolveApprovalInboxTriage,
} from "./triage-evidence";
import type { ApprovalInboxType } from "./types";

/** Internal server requirement, evaluated on the owner's committing transaction. */
export function createFastLaneDecisionGuard(input: {
	request: PersistedApprovalRequestForDecision;
	actorEmployeeId: string;
	action: "approve" | "reject";
	review: ApprovalFastLaneReview;
	now?: Date;
}): NonNullable<ApprovalActionOptions["shortcutGuard"]> {
	return async (database) => {
		const { request } = input;
		const stale = () =>
			new ConflictError({
				message:
					"This fast-lane assessment changed. Refresh or open the request for manual review.",
				conflictType: "approval_triage",
			});
		if (request.requesterEmployeeId === input.actorEmployeeId) throw stale();
		const kind = request.workflowKind;
		if (
			kind !== "absence" &&
			kind !== "absence_change" &&
			kind !== "time_correction"
		)
			throw stale();
		let createdAt: Date;
		if (request.targetType === "canonical_assignment") {
			const assignment = await database.query.approvalStageAssignment.findFirst(
				{
					where: and(
						eq(approvalStageAssignment.id, request.id),
						eq(approvalStageAssignment.organizationId, request.organizationId),
					),
				},
			);
			const workflow = assignment
				? await database.query.approvalWorkflow.findFirst({
						where: and(
							eq(approvalWorkflow.id, assignment.workflowId),
							eq(approvalWorkflow.organizationId, request.organizationId),
						),
					})
				: null;
			if (
				assignment?.status !== "pending" ||
				!workflow ||
				workflow.status !== "pending" ||
				workflow.workflowType !== kind ||
				workflow.sourceId !== request.entityId ||
				workflow.requesterEmployeeId !== request.requesterEmployeeId
			)
				throw stale();
			createdAt = workflow.submittedAt;
		} else {
			const current = await database.query.approvalRequest.findFirst({
				where: and(
					eq(approvalRequest.id, request.id),
					eq(approvalRequest.organizationId, request.organizationId),
				),
			});
			if (
				current?.status !== "pending" ||
				current.entityType !== request.entityType ||
				current.entityId !== request.entityId ||
				current.requestedBy !== request.requesterEmployeeId
			)
				throw stale();
			createdAt = current.createdAt;
		}
		let held = false;
		if (kind === "absence") {
			const entity = await database.query.absenceEntry.findFirst({
				where: and(
					eq(absenceEntry.id, request.entityId),
					eq(absenceEntry.organizationId, request.organizationId),
				),
				with: { category: true },
			});
			const evidence = await prepareAbsenceReviewEvidence(
				{ organizationId: request.organizationId, entity },
				database,
			);
			held = !evidence || buildAbsenceReviewSections(evidence).decisionsBlocked;
		} else if (kind === "time_correction") {
			held = buildTimeReviewSections(
				await prepareTimeReviewEvidence(
					{
						organizationId: request.organizationId,
						approvalRequestId: request.id,
						...(request.targetType === "canonical_assignment"
							? { canonicalAssignmentId: request.id }
							: {}),
						workPeriodId: request.entityId,
						requestPending: true,
						kind,
					},
					database,
				),
			).decisionsBlocked;
		}
		if (held) throw stale();
		const reviewed = input.review.reviewedContexts[request.id];
		if (!reviewed) throw stale();
		const policy = await loadApprovalTriageSettings(
			database,
			request.organizationId,
		);
		const target = {
			context: {
				organizationId: request.organizationId,
				requestId: request.id,
				entityId: request.entityId,
				scope: "submitted_request",
				revision: null,
			},
			requestKind: kind,
			type: request.entityType as ApprovalInboxType,
			status: "pending" as const,
			createdAt,
			priority: "normal" as const,
			requesterEmployeeId: request.requesterEmployeeId,
			authority: request.targetType,
		};
		const evidence = await loadCurrentApprovalTriageEvidence(target, database);
		const requestEvidence = evidence.evidence.filter(
			(entry) =>
				entry.check ===
				(kind === "time_correction" ? "correction" : "coverage"),
		);
		if (
			!requestEvidence.length ||
			requestEvidence.some((entry) => entry.validity === "stale")
		)
			throw stale();
		const triage = await resolveApprovalInboxTriage({
			target,
			policy,
			now: input.now,
			loadEvidence: async () => evidence,
		});
		if (
			!matchesFastLaneReview(
				{
					id: request.id,
					entityId: request.entityId,
					type: request.entityType as ApprovalInboxType,
					status: "pending",
					triage,
					capabilities: {
						canApprove: true,
						canReject: true,
						canBulkApprove: true,
						requiresRejectReason: true,
					},
				},
				input.review,
			)
		)
			throw stale();
	};
}
