/**
 * Approvals category of a personal data export (#811, #1168).
 *
 * **Own requests**, under both approval stores: legacy `approval_request`
 * rows and legacy approval chains, and canonical workflows with their stages,
 * approvers and events; deputy decisions on them; and period submissions.
 * People who decided on or were assigned to the employee's requests are named.
 *
 * **Decisions on other people's requests** (`decisions_on_others`): what the
 * employee approved or rejected for a colleague, as kind, action, time and an
 * opaque id for the colleague (`redaction.ts`); never the colleague's name,
 * dates, reasons or record ids. One decision is one row: a canonical
 * assignment the employee resolved (as approver or deputy) or handed on to
 * another approver (`reassigned`), a legacy request
 * they decided (the decision evidence's actor, else the assigned approver;
 * never a rejection by the system or the requester; unless a canonical
 * workflow mirrors it, or a deputy decided it instead), a legacy deputy
 * decision, a legacy chain stage without a request,
 * or, for records decided without any approval request, the record itself.
 *
 * Nothing here is withheld: both exports hold the same rows.
 */

import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import {
	absenceCategory,
	absenceEntry,
	approvalChainInstance,
	approvalChainStageInstance,
	approvalDecisionEvidence,
	approvalDeputyDecision,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowEvent,
	approvalWorkflowStage,
	complianceException,
	employee,
	periodSubmission,
	shift,
	shiftRequest,
} from "@/db/schema";
import { SICK_OVERRIDE_REJECTION_REASON } from "@/lib/absences/sick-vacation-override";
import { isUuid } from "@/lib/validations/uuid";
import {
	type CollectedCategory,
	type PersonalDataCollector,
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	type PersonalDataRow,
	tablePart,
} from "../collector";
import {
	ACTION_ON_OTHERS_COLUMNS,
	type ActionOnOther,
	actionOnOtherRows,
	otherPeopleOf,
} from "../redaction";
import { employeeNameLookup, instantText, loadSubjectEmployee, userNameLookup } from "../values";
import { approvalsFieldGuide } from "./approvals-fields";

export const approvalsCollector: PersonalDataCollector = {
	category: "approvals",
	collect: collectApprovals,
	fields: approvalsFieldGuide,
};

const DECIDED = ["approved", "rejected"] as const;

async function collectApprovals(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<CollectedCategory> {
	const { organizationId, employeeId } = scope;
	await loadSubjectEmployee(database, scope);

	const ownWorkflow = and(
		eq(approvalWorkflow.organizationId, organizationId),
		eq(approvalWorkflow.requesterEmployeeId, employeeId),
	);
	const [requests, workflows, stages, approvers, events, chains, chainStages, submissions] =
		await Promise.all([
			database
				.select()
				.from(approvalRequest)
				.where(
					and(
						eq(approvalRequest.organizationId, organizationId),
						eq(approvalRequest.requestedBy, employeeId),
					),
				)
				.orderBy(asc(approvalRequest.createdAt)),
			database
				.select()
				.from(approvalWorkflow)
				.where(ownWorkflow)
				.orderBy(asc(approvalWorkflow.submittedAt)),
			database
				.select({ stage: approvalWorkflowStage })
				.from(approvalWorkflowStage)
				.innerJoin(
					approvalWorkflow,
					and(eq(approvalWorkflow.id, approvalWorkflowStage.workflowId), ownWorkflow),
				)
				.where(eq(approvalWorkflowStage.organizationId, organizationId))
				.orderBy(asc(approvalWorkflow.submittedAt), asc(approvalWorkflowStage.sequence)),
			database
				.select({ assignment: approvalStageAssignment, stage: approvalWorkflowStage.label })
				.from(approvalStageAssignment)
				.innerJoin(
					approvalWorkflow,
					and(eq(approvalWorkflow.id, approvalStageAssignment.workflowId), ownWorkflow),
				)
				.innerJoin(
					approvalWorkflowStage,
					and(
						eq(approvalWorkflowStage.id, approvalStageAssignment.stageId),
						eq(approvalWorkflowStage.organizationId, organizationId),
					),
				)
				.where(eq(approvalStageAssignment.organizationId, organizationId))
				.orderBy(
					asc(approvalWorkflow.submittedAt),
					asc(approvalWorkflowStage.sequence),
					asc(approvalStageAssignment.sequence),
				),
			database
				.select({
					workflowId: approvalWorkflowEvent.workflowId,
					eventType: approvalWorkflowEvent.eventType,
					actorKind: approvalWorkflowEvent.actorKind,
					actorEmployeeId: approvalWorkflowEvent.actorEmployeeId,
					actorUserId: approvalWorkflowEvent.actorUserId,
					reason: approvalWorkflowEvent.reason,
					occurredAt: approvalWorkflowEvent.occurredAt,
				})
				.from(approvalWorkflowEvent)
				.innerJoin(
					approvalWorkflow,
					and(eq(approvalWorkflow.id, approvalWorkflowEvent.workflowId), ownWorkflow),
				)
				.where(eq(approvalWorkflowEvent.organizationId, organizationId))
				.orderBy(
					asc(approvalWorkflowEvent.occurredAt),
					asc(approvalWorkflowEvent.version),
					asc(approvalWorkflowEvent.eventIndex),
				),
			database
				.select()
				.from(approvalChainInstance)
				.where(
					and(
						eq(approvalChainInstance.organizationId, organizationId),
						eq(approvalChainInstance.requesterEmployeeId, employeeId),
					),
				)
				.orderBy(asc(approvalChainInstance.createdAt)),
			database
				.select({ stage: approvalChainStageInstance })
				.from(approvalChainStageInstance)
				.innerJoin(
					approvalChainInstance,
					and(
						eq(approvalChainInstance.id, approvalChainStageInstance.chainInstanceId),
						eq(approvalChainInstance.organizationId, organizationId),
						eq(approvalChainInstance.requesterEmployeeId, employeeId),
					),
				)
				.where(eq(approvalChainStageInstance.organizationId, organizationId))
				.orderBy(asc(approvalChainInstance.createdAt), asc(approvalChainStageInstance.stepOrder)),
			database
				.select()
				.from(periodSubmission)
				.where(
					and(
						eq(periodSubmission.organizationId, organizationId),
						eq(periodSubmission.employeeId, employeeId),
					),
				)
				.orderBy(asc(periodSubmission.startDate), asc(periodSubmission.submittedAt)),
		]);

	const ownRequestIds = requests.map((row) => row.id);
	const ownWorkflowIds = workflows.map((row) => row.id);
	const deputyDecisions =
		ownRequestIds.length + ownWorkflowIds.length === 0
			? []
			: await database
					.select()
					.from(approvalDeputyDecision)
					.where(
						and(
							eq(approvalDeputyDecision.organizationId, organizationId),
							or(
								ownRequestIds.length > 0
									? inArray(approvalDeputyDecision.approvalRequestId, ownRequestIds)
									: undefined,
								ownWorkflowIds.length > 0
									? inArray(approvalDeputyDecision.workflowId, ownWorkflowIds)
									: undefined,
							),
						),
					)
					.orderBy(asc(approvalDeputyDecision.decidedAt));

	const decisions = await collectDecisionsOnOthers(database, scope);

	const [byEmployee, byUser] = await Promise.all([
		employeeNameLookup(database, organizationId, [
			...requests.map((row) => row.approverId),
			...approvers.flatMap(({ assignment }) => [
				assignment.approverEmployeeId,
				assignment.resolvedByActorKind === "employee" ? assignment.resolvedByActorId : null,
				assignment.reassignedByEmployeeId,
			]),
			...events.map((row) => row.actorEmployeeId),
			...chainStages.flatMap(({ stage }) => [stage.resolvedApproverEmployeeId, stage.decidedBy]),
			...deputyDecisions.flatMap((row) => [row.deputyEmployeeId, row.actingForEmployeeId]),
			...submissions.map((row) => row.decidedByEmployeeId),
		]),
		userNameLookup(database, [
			...events.map((row) => row.actorUserId),
			...submissions.map((row) => row.submittedBy),
		]),
	]);

	return {
		category: "approvals",
		parts: [
			tablePart(
				"requests",
				[
					"id",
					"record_kind",
					"record_id",
					"status",
					"reason",
					"notes",
					"approver",
					"approved_at",
					"rejection_reason",
					"created_at",
					"updated_at",
				],
				requests.map((row) => ({
					id: row.id,
					record_kind: row.entityType,
					record_id: row.entityId,
					status: row.status,
					reason: row.reason,
					notes: row.notes,
					approver: byEmployee(row.approverId),
					approved_at: instantText(row.approvedAt),
					rejection_reason: row.rejectionReason,
					created_at: instantText(row.createdAt),
					updated_at: instantText(row.updatedAt),
				})),
			),
			tablePart(
				"workflows",
				[
					"id",
					"workflow_type",
					"record_kind",
					"record_id",
					"status",
					"submitted_at",
					"completed_at",
					"cancelled_at",
					"decision_reason",
				],
				workflows.map((row) => ({
					id: row.id,
					workflow_type: row.workflowType,
					record_kind: row.sourceType,
					record_id: row.sourceId,
					status: row.status,
					submitted_at: instantText(row.submittedAt),
					completed_at: instantText(row.completedAt),
					cancelled_at: instantText(row.cancelledAt),
					decision_reason: row.decisionReason,
				})),
			),
			tablePart(
				"workflow_stages",
				[
					"workflow_id",
					"stage_order",
					"label",
					"status",
					"activated_at",
					"decided_at",
					"decision_reason",
				],
				stages.map(({ stage }) => ({
					workflow_id: stage.workflowId,
					stage_order: stage.sequence,
					label: stage.label,
					status: stage.status,
					activated_at: instantText(stage.activatedAt),
					decided_at: instantText(stage.decidedAt),
					decision_reason: stage.decisionReason,
				})),
			),
			tablePart(
				"workflow_approvers",
				[
					"workflow_id",
					"stage",
					"approver",
					"status",
					"assigned_at",
					"resolved_at",
					"decided_by",
					"reassigned_by",
				],
				approvers.map(({ assignment, stage }) => ({
					workflow_id: assignment.workflowId,
					stage,
					approver: byEmployee(assignment.approverEmployeeId),
					status: assignment.status,
					assigned_at: instantText(assignment.assignedAt),
					resolved_at: instantText(assignment.resolvedAt),
					decided_by:
						assignment.resolvedByActorKind === "employee"
							? byEmployee(assignment.resolvedByActorId)
							: assignment.resolvedByActorKind,
					reassigned_by: byEmployee(assignment.reassignedByEmployeeId),
				})),
			),
			tablePart(
				"workflow_events",
				["workflow_id", "event_type", "actor", "reason", "occurred_at"],
				events.map((row) => ({
					workflow_id: row.workflowId,
					event_type: row.eventType,
					actor:
						byEmployee(row.actorEmployeeId) ??
						byUser(row.actorUserId) ??
						(row.actorKind === "employee" ? null : row.actorKind),
					reason: row.reason,
					occurred_at: instantText(row.occurredAt),
				})),
			),
			tablePart(
				"approval_chains",
				["id", "policy", "record_kind", "record_id", "status", "created_at", "completed_at"],
				chains.map((row) => ({
					id: row.id,
					policy: row.policyNameSnapshot,
					record_kind: row.entityType,
					record_id: row.entityId,
					status: row.status,
					created_at: instantText(row.createdAt),
					completed_at: instantText(row.completedAt),
				})),
			),
			tablePart(
				"approval_chain_stages",
				["chain_id", "step", "label", "approver", "status", "decided_by", "decided_at"],
				chainStages.map(({ stage }) => ({
					chain_id: stage.chainInstanceId,
					step: stage.stepOrder,
					label: stage.labelSnapshot,
					approver: byEmployee(stage.resolvedApproverEmployeeId),
					status: stage.status,
					decided_by: byEmployee(stage.decidedBy),
					decided_at: instantText(stage.decidedAt),
				})),
			),
			tablePart(
				"deputy_decisions",
				[
					"authority",
					"record_kind",
					"request_id",
					"workflow_id",
					"decision",
					"decided_by",
					"acting_for",
					"decided_at",
				],
				deputyDecisions.map((row) => ({
					authority: row.authority,
					record_kind: row.entityType,
					request_id: row.approvalRequestId,
					workflow_id: row.workflowId,
					decision: row.decision,
					decided_by: byEmployee(row.deputyEmployeeId),
					acting_for: byEmployee(row.actingForEmployeeId),
					decided_at: instantText(row.decidedAt),
				})),
			),
			tablePart(
				"period_submissions",
				[
					"id",
					"cadence",
					"week_start_day",
					"timezone",
					"start_date",
					"end_date",
					"cadence_start_date",
					"cadence_end_date",
					"range_start",
					"range_end",
					"status",
					"submitted_at",
					"submitted_by",
					"decided_at",
					"decided_by",
					"decision_reason",
					"closed_at",
					"closed_cause",
				],
				submissions.map((row) => ({
					id: row.id,
					cadence: row.cadence,
					week_start_day: row.weekStartDay,
					timezone: row.timezone,
					start_date: row.startDate,
					end_date: row.endDate,
					cadence_start_date: row.cadenceStartDate,
					cadence_end_date: row.cadenceEndDate,
					range_start: instantText(row.rangeStart),
					range_end: instantText(row.rangeEnd),
					status: row.status,
					submitted_at: instantText(row.submittedAt),
					submitted_by: byUser(row.submittedBy),
					decided_at: instantText(row.decidedAt),
					decided_by: byEmployee(row.decidedByEmployeeId),
					decision_reason: row.decisionReason,
					closed_at: instantText(row.closedAt),
					closed_cause: row.closedCause,
				})),
			),
			tablePart("decisions_on_others", ACTION_ON_OTHERS_COLUMNS, decisions),
		],
	};
}

/** Every decision the employee made on another person's request, redacted. */
async function collectDecisionsOnOthers(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<PersonalDataRow[]> {
	const { organizationId, employeeId } = scope;
	const notByEmployee = (column: typeof approvalWorkflow.requesterEmployeeId) =>
		or(isNull(column), ne(column, employeeId));

	const [canonical, reassignments, legacyCandidates, legacyDeputy, chainStages] = await Promise.all(
		[
			// Canonical assignments the employee resolved, as approver or as a covering deputy.
			database
				.select({
					workflowType: approvalWorkflow.workflowType,
					requesterId: approvalWorkflow.requesterEmployeeId,
					status: approvalStageAssignment.status,
					resolvedAt: approvalStageAssignment.resolvedAt,
					deputyDecisionId: approvalDeputyDecision.id,
				})
				.from(approvalStageAssignment)
				.innerJoin(
					approvalWorkflow,
					and(
						eq(approvalWorkflow.id, approvalStageAssignment.workflowId),
						eq(approvalWorkflow.organizationId, organizationId),
					),
				)
				.leftJoin(
					approvalDeputyDecision,
					and(
						eq(approvalDeputyDecision.assignmentId, approvalStageAssignment.id),
						eq(approvalDeputyDecision.organizationId, organizationId),
						eq(approvalDeputyDecision.deputyEmployeeId, employeeId),
					),
				)
				.where(
					and(
						eq(approvalStageAssignment.organizationId, organizationId),
						eq(approvalStageAssignment.resolvedByActorKind, "employee"),
						eq(approvalStageAssignment.resolvedByActorId, employeeId),
						inArray(approvalStageAssignment.status, DECIDED),
						notByEmployee(approvalWorkflow.requesterEmployeeId),
					),
				),
			// Canonical assignments the employee handed on to another approver.
			database
				.select({
					workflowType: approvalWorkflow.workflowType,
					requesterId: approvalWorkflow.requesterEmployeeId,
					assignedAt: approvalStageAssignment.assignedAt,
				})
				.from(approvalStageAssignment)
				.innerJoin(
					approvalWorkflow,
					and(
						eq(approvalWorkflow.id, approvalStageAssignment.workflowId),
						eq(approvalWorkflow.organizationId, organizationId),
					),
				)
				.where(
					and(
						eq(approvalStageAssignment.organizationId, organizationId),
						eq(approvalStageAssignment.reassignedByEmployeeId, employeeId),
						notByEmployee(approvalWorkflow.requesterEmployeeId),
					),
				),
			// Legacy requests the employee decided: by the decision evidence's actor when
			// it was recorded (org-wide approvers decide without becoming the approver),
			// else by the assigned approver.
			database
				.select({
					id: approvalRequest.id,
					entityType: approvalRequest.entityType,
					requestedBy: approvalRequest.requestedBy,
					status: approvalRequest.status,
					approvedAt: approvalRequest.approvedAt,
					updatedAt: approvalRequest.updatedAt,
					metadata: approvalRequest.metadata,
					rejectionReason: approvalRequest.rejectionReason,
					evidenceDecidedAt: approvalDecisionEvidence.decidedAt,
				})
				.from(approvalRequest)
				.leftJoin(
					approvalDecisionEvidence,
					and(
						eq(approvalDecisionEvidence.organizationId, organizationId),
						eq(approvalDecisionEvidence.authority, "legacy"),
						eq(approvalDecisionEvidence.legacyApprovalRequestId, approvalRequest.id),
					),
				)
				.where(
					and(
						eq(approvalRequest.organizationId, organizationId),
						ne(approvalRequest.requestedBy, employeeId),
						inArray(approvalRequest.status, DECIDED),
						or(
							eq(approvalDecisionEvidence.actorEmployeeId, employeeId),
							and(isNull(approvalDecisionEvidence.id), eq(approvalRequest.approverId, employeeId)),
						),
					),
				),
			// Legacy decisions the employee made as a covering deputy.
			database
				.select({
					entityType: approvalDeputyDecision.entityType,
					decision: approvalDeputyDecision.decision,
					decidedAt: approvalDeputyDecision.decidedAt,
					requestedBy: approvalRequest.requestedBy,
				})
				.from(approvalDeputyDecision)
				.innerJoin(
					approvalRequest,
					and(
						eq(approvalRequest.id, approvalDeputyDecision.approvalRequestId),
						eq(approvalRequest.organizationId, organizationId),
					),
				)
				.where(
					and(
						eq(approvalDeputyDecision.organizationId, organizationId),
						eq(approvalDeputyDecision.deputyEmployeeId, employeeId),
						eq(approvalDeputyDecision.authority, "legacy"),
						ne(approvalRequest.requestedBy, employeeId),
					),
				),
			// Legacy chain stages without a request row of their own.
			database
				.select({
					entityType: approvalChainInstance.entityType,
					requesterId: approvalChainInstance.requesterEmployeeId,
					status: approvalChainStageInstance.status,
					decidedAt: approvalChainStageInstance.decidedAt,
				})
				.from(approvalChainStageInstance)
				.innerJoin(
					approvalChainInstance,
					and(
						eq(approvalChainInstance.id, approvalChainStageInstance.chainInstanceId),
						eq(approvalChainInstance.organizationId, organizationId),
					),
				)
				.where(
					and(
						eq(approvalChainStageInstance.organizationId, organizationId),
						eq(approvalChainStageInstance.decidedBy, employeeId),
						isNull(approvalChainStageInstance.approvalRequestId),
						inArray(approvalChainStageInstance.status, DECIDED),
						ne(approvalChainInstance.requesterEmployeeId, employeeId),
					),
				),
		],
	);

	// A legacy request is not the employee's decision when a canonical workflow
	// mirrors it (the assignment says who decided) or a deputy decided it.
	const candidateIds = legacyCandidates.map((row) => row.id);
	const mirroredWorkflowIds = legacyCandidates
		.map((row) => row.metadata?.workflowId)
		.filter((id): id is string => typeof id === "string");
	const [mirroringStages, decidedByDeputy, mirroringWorkflows] = await Promise.all([
		candidateIds.length === 0
			? []
			: database
					.select({ requestId: approvalWorkflowStage.legacyApprovalRequestId })
					.from(approvalWorkflowStage)
					.where(
						and(
							eq(approvalWorkflowStage.organizationId, organizationId),
							inArray(approvalWorkflowStage.legacyApprovalRequestId, candidateIds),
						),
					),
		candidateIds.length === 0
			? []
			: database
					.select({ requestId: approvalDeputyDecision.approvalRequestId })
					.from(approvalDeputyDecision)
					.where(
						and(
							eq(approvalDeputyDecision.organizationId, organizationId),
							inArray(approvalDeputyDecision.approvalRequestId, candidateIds),
						),
					),
		mirroredWorkflowIds.length === 0
			? []
			: database
					.select({ id: approvalWorkflow.id })
					.from(approvalWorkflow)
					.where(
						and(
							eq(approvalWorkflow.organizationId, organizationId),
							inArray(
								approvalWorkflow.id,
								mirroredWorkflowIds.filter((id) => isUuid(id)),
							),
						),
					),
	]);
	const notTheEmployees = new Set([
		...mirroringStages.map((row) => row.requestId),
		...decidedByDeputy.map((row) => row.requestId),
	]);
	const existingWorkflows = new Set(mirroringWorkflows.map((row) => row.id));
	const legacy = legacyCandidates.filter(
		(row) =>
			!notTheEmployees.has(row.id) &&
			!(row.evidenceDecidedAt === null && closedWithoutApprover(row)) &&
			!(
				typeof row.metadata?.workflowId === "string" &&
				existingWorkflows.has(row.metadata.workflowId)
			),
	);

	const actions: ActionOnOther[] = [
		...canonical.map((row) => ({
			recordKind: row.workflowType,
			authority: "canonical",
			action: row.status,
			actedAt: row.resolvedAt,
			asDeputy: row.deputyDecisionId !== null,
			otherEmployeeId: row.requesterId,
		})),
		...reassignments.map((row) => ({
			recordKind: row.workflowType,
			authority: "canonical",
			action: "reassigned",
			actedAt: row.assignedAt,
			asDeputy: false,
			otherEmployeeId: row.requesterId,
		})),
		...legacy.map((row) => ({
			recordKind: row.entityType,
			authority: "legacy",
			action: row.status,
			actedAt: row.evidenceDecidedAt ?? row.approvedAt ?? row.updatedAt,
			asDeputy: false,
			otherEmployeeId: row.requestedBy,
		})),
		...legacyDeputy.map((row) => ({
			recordKind: row.entityType,
			authority: "legacy",
			action: row.decision,
			actedAt: row.decidedAt,
			asDeputy: true,
			otherEmployeeId: row.requestedBy,
		})),
		...chainStages.map((row) => ({
			recordKind: row.entityType,
			authority: "legacy",
			action: row.status,
			actedAt: row.decidedAt,
			asDeputy: false,
			otherEmployeeId: row.requesterId,
		})),
		...(await collectRecordDecisions(database, scope)),
	];

	return actionOnOtherRows(otherPeopleOf(scope), actions);
}

/**
 * A legacy request rejected by the system or withdrawn by its requester: no
 * approver decided it. A sick absence overrode the vacation, the requester
 * withdrew the expense report, or cancelled the time correction.
 */
function closedWithoutApprover(row: {
	status: string;
	rejectionReason: string | null;
	metadata: Record<string, unknown> | null;
}): boolean {
	if (row.status !== "rejected") return false;
	return (
		row.rejectionReason === SICK_OVERRIDE_REJECTION_REASON ||
		row.metadata?.travelExpenseReportWithdrawal !== undefined ||
		row.metadata?.cancellation !== undefined
	);
}

/**
 * Decisions recorded only on the decided record: approvals made without any
 * legacy request or canonical workflow (older data and direct decisions).
 */
async function collectRecordDecisions(
	database: PersonalDataExportDatabase,
	{ organizationId, employeeId }: PersonalDataExportScope,
): Promise<ActionOnOther[]> {
	const [absences, shiftRequests, exceptions, submissions] = await Promise.all([
		database
			.select({
				id: absenceEntry.id,
				employeeId: absenceEntry.employeeId,
				status: absenceEntry.status,
				approvedAt: absenceEntry.approvedAt,
				updatedAt: absenceEntry.updatedAt,
			})
			.from(absenceEntry)
			.innerJoin(
				absenceCategory,
				and(
					eq(absenceCategory.id, absenceEntry.categoryId),
					eq(absenceCategory.organizationId, organizationId),
				),
			)
			.innerJoin(
				employee,
				and(eq(employee.id, absenceEntry.employeeId), eq(employee.organizationId, organizationId)),
			)
			.where(
				and(
					eq(absenceEntry.approvedBy, employeeId),
					ne(absenceEntry.employeeId, employeeId),
					inArray(absenceEntry.status, DECIDED),
					isNull(absenceEntry.approvalWorkflowId),
				),
			),
		database
			.select({
				requesterId: shiftRequest.requesterId,
				status: shiftRequest.status,
				approvedAt: shiftRequest.approvedAt,
				updatedAt: shiftRequest.updatedAt,
			})
			.from(shiftRequest)
			.innerJoin(
				shift,
				and(eq(shift.id, shiftRequest.shiftId), eq(shift.organizationId, organizationId)),
			)
			.where(
				and(
					eq(shiftRequest.approverId, employeeId),
					ne(shiftRequest.requesterId, employeeId),
					inArray(shiftRequest.status, DECIDED),
					isNull(shiftRequest.approvalWorkflowId),
				),
			),
		database
			.select({
				employeeId: complianceException.employeeId,
				approvedAt: complianceException.approvedAt,
				rejectedAt: complianceException.rejectedAt,
			})
			.from(complianceException)
			.where(
				and(
					eq(complianceException.organizationId, organizationId),
					eq(complianceException.approverId, employeeId),
					ne(complianceException.employeeId, employeeId),
					or(isNotNull(complianceException.approvedAt), isNotNull(complianceException.rejectedAt)),
					isNull(complianceException.approvalWorkflowId),
				),
			),
		database
			.select({
				employeeId: periodSubmission.employeeId,
				status: periodSubmission.status,
				decidedAt: periodSubmission.decidedAt,
			})
			.from(periodSubmission)
			.where(
				and(
					eq(periodSubmission.organizationId, organizationId),
					eq(periodSubmission.decidedByEmployeeId, employeeId),
					ne(periodSubmission.employeeId, employeeId),
					isNotNull(periodSubmission.decidedAt),
					isNull(periodSubmission.approvalWorkflowId),
				),
			),
	]);

	// Absences decided through a legacy request are that request's decision.
	const absenceIds = absences.map((row) => row.id);
	const requested =
		absenceIds.length === 0
			? []
			: await database
					.select({ entityId: approvalRequest.entityId })
					.from(approvalRequest)
					.where(
						and(
							eq(approvalRequest.organizationId, organizationId),
							eq(approvalRequest.entityType, "absence_entry"),
							inArray(approvalRequest.entityId, absenceIds),
						),
					);
	const viaRequest = new Set(requested.map((row) => row.entityId));

	return [
		...absences
			.filter((row) => !viaRequest.has(row.id))
			.map((row) => ({
				recordKind: "absence_entry",
				authority: "record",
				action: row.status,
				actedAt: row.approvedAt ?? row.updatedAt,
				asDeputy: false,
				otherEmployeeId: row.employeeId,
			})),
		...shiftRequests.map((row) => ({
			recordKind: "shift_request",
			authority: "record",
			action: row.status,
			actedAt: row.approvedAt ?? row.updatedAt,
			asDeputy: false,
			otherEmployeeId: row.requesterId,
		})),
		...exceptions.map((row) => ({
			recordKind: "compliance_exception",
			authority: "record",
			action: row.approvedAt ? "approved" : "rejected",
			actedAt: row.approvedAt ?? row.rejectedAt,
			asDeputy: false,
			otherEmployeeId: row.employeeId,
		})),
		...submissions.map((row) => ({
			recordKind: "period_submission",
			authority: "record",
			action: row.status === "rejected" ? "rejected" : "approved",
			actedAt: row.decidedAt,
			asDeputy: false,
			otherEmployeeId: row.employeeId,
		})),
	];
}
