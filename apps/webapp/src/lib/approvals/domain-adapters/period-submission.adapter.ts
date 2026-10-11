import { AuditAction } from "@/lib/audit-logger";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import {
	closePendingPeriodSubmission,
	insertPeriodSubmissionAudit,
	loadPeriodSubmissionForUpdate,
	type PeriodSubmissionDatabase,
	type PeriodSubmissionRow,
	recordPeriodSubmissionDecision,
} from "@/lib/time-tracking/period-submissions/submission-store";
import {
	preflightPeriodSubmissionDecisionEvidence,
	recordPeriodSubmissionDecisionEvidence,
} from "../evidence/period-submission-evidence";
import type {
	ApprovalDbService,
	ApprovalSourceIdentity,
	ApprovalWorkflowSnapshot,
	JsonObject,
} from "../workflow/ports";
import { normalizeStableData } from "../workflow/stable-data";
import {
	PERIOD_SUBMISSION_SOURCE_TYPE,
	PERIOD_SUBMISSION_WORKFLOW_TYPE,
	type PeriodSubmissionApprovalSource,
	periodSubmissionClosedCauseOf,
} from "./period-submission-contract";
import type {
	ApprovalDomainAdapter,
	ApprovalDomainAdapterContext,
	ApprovalTerminalAdapterInput,
	ApprovalTerminalFinalizationResult,
} from "./types";

export class PeriodSubmissionApprovalAdapterError extends Error {
	constructor(message = "Period submission approval adapter input is invalid") {
		super(message);
		this.name = "PeriodSubmissionApprovalAdapterError";
	}
}

function fail(message?: string): never {
	throw new PeriodSubmissionApprovalAdapterError(message);
}

/** The workflow's transaction client: always the drizzle transaction the engine opened. */
function database(dbService: ApprovalDbService): PeriodSubmissionDatabase {
	return dbService.db as unknown as PeriodSubmissionDatabase;
}

function validateIdentity(
	organizationId: string,
	workflow: ApprovalWorkflowSnapshot,
	sourceIdentity: ApprovalSourceIdentity,
): void {
	if (
		workflow.organizationId !== organizationId ||
		sourceIdentity.organizationId !== organizationId ||
		workflow.workflowType !== PERIOD_SUBMISSION_WORKFLOW_TYPE ||
		sourceIdentity.workflowType !== PERIOD_SUBMISSION_WORKFLOW_TYPE ||
		workflow.sourceType !== PERIOD_SUBMISSION_SOURCE_TYPE ||
		sourceIdentity.sourceType !== PERIOD_SUBMISSION_SOURCE_TYPE ||
		workflow.sourceId !== sourceIdentity.sourceId ||
		!workflow.requesterEmployeeId
	) {
		fail();
	}
}

function validateContext(input: ApprovalDomainAdapterContext<PeriodSubmissionApprovalSource>) {
	validateIdentity(input.organizationId, input.workflow, input.sourceIdentity);
	if (
		input.source.id !== input.sourceIdentity.sourceId ||
		input.source.organizationId !== input.organizationId ||
		input.source.employeeId !== input.workflow.requesterEmployeeId ||
		input.source.approvalWorkflowId !== input.workflow.id
	) {
		fail();
	}
}

function toSource(row: PeriodSubmissionRow): PeriodSubmissionApprovalSource {
	if (!row.approvalWorkflowId) return fail();
	return normalizeStableData({
		id: row.id,
		organizationId: row.organizationId,
		employeeId: row.employeeId,
		approvalWorkflowId: row.approvalWorkflowId,
		status: row.status,
		timezone: row.timezone,
		startDate: row.startDate,
		endDate: row.endDate,
		rangeStart: instantFromDate(row.rangeStart).toString(),
		rangeEnd: instantFromDate(row.rangeEnd).toString(),
	}) as PeriodSubmissionApprovalSource;
}

/** The routing context a period submission starts with; activation of later stages reuses it. */
export function periodSubmissionRoutingContext(input: {
	organizationId: string;
	submissionId: string;
	requesterEmployeeId: string;
	teamIds: string[];
}) {
	return {
		organizationId: input.organizationId,
		workflowType: PERIOD_SUBMISSION_WORKFLOW_TYPE,
		source: { type: PERIOD_SUBMISSION_SOURCE_TYPE, id: input.submissionId },
		requesterEmployeeId: input.requesterEmployeeId,
		teamIds: input.teamIds,
		locationId: null,
		absenceCategoryId: null,
		travelExpenseAmount: null,
		overtimeRisk: null,
		employeeGroupIds: [],
	};
}

/**
 * Approvals and rejections are an employee's; a withdrawal is the employee's, a manager's after a
 * change, or the writer seam's system capability after a change (#1062), never a system cancel
 * for any other reason.
 */
function isTerminalActorAllowed(
	actor: ApprovalTerminalAdapterInput<PeriodSubmissionApprovalSource>["actor"],
	transition: ApprovalTerminalAdapterInput<PeriodSubmissionApprovalSource>["transition"],
): boolean {
	if (actor.kind === "employee") return Boolean(actor.userId);
	return (
		actor.kind === "system" &&
		transition.kind === "cancel_pending" &&
		periodSubmissionClosedCauseOf(transition.reason) === "change"
	);
}

/**
 * The period submission adapter (#1059): canonical-only, self-contained (it needs no caller
 * dependencies), and the only writer of a submission's decision. Approve and reject record the
 * decision on the row and its audit entry in the engine's transaction. Cancelling a pending
 * submission (withdrawal, #1060) closes the row, and only with one of the withdrawal entry
 * point's reasons (`PERIOD_SUBMISSION_CANCEL_REASONS`).
 */
export function createPeriodSubmissionApprovalAdapter(): ApprovalDomainAdapter<PeriodSubmissionApprovalSource> {
	return {
		workflowType: PERIOD_SUBMISSION_WORKFLOW_TYPE,
		sourceType: PERIOD_SUBMISSION_SOURCE_TYPE,
		async loadSource(input) {
			validateIdentity(input.organizationId, input.workflow, input.sourceIdentity);
			const row = await loadPeriodSubmissionForUpdate(database(input.dbService), {
				organizationId: input.organizationId,
				submissionId: input.sourceIdentity.sourceId,
			});
			if (
				!row ||
				row.organizationId !== input.organizationId ||
				row.employeeId !== input.workflow.requesterEmployeeId ||
				row.approvalWorkflowId !== input.workflow.id
			) {
				return fail();
			}
			return toSource(row);
		},
		async getTrustedCapabilities(input) {
			validateContext(input);
			return { canCancelAfterApproval: false };
		},
		async produceRoutingContext(input) {
			validateContext(input);
			const context = input.workflow.contextSnapshot;
			const teamIds = Array.isArray(context.teamIds)
				? context.teamIds.filter((id): id is string => typeof id === "string")
				: [];
			return normalizeStableData(
				periodSubmissionRoutingContext({
					organizationId: input.organizationId,
					submissionId: input.source.id,
					requesterEmployeeId: input.source.employeeId,
					teamIds,
				}),
			) as JsonObject;
		},
		async preflightCommand(input) {
			validateContext(input);
			const expected = {
				submit: "pending",
				approve: "approved",
				reject: "rejected",
				cancel: "cancelled",
			}[input.command.kind];
			if (
				input.command.kind === "submit" ||
				(input.command.kind === "cancel" &&
					periodSubmissionClosedCauseOf(input.command.reason) === null) ||
				input.workflow.status !== "pending" ||
				input.source.status !== "pending" ||
				input.proposedStatus !== expected
			) {
				fail("Period submission command is incompatible with its state");
			}
		},
		async preflightTerminal(input) {
			validateContext(input);
			const transition = input.transition;
			if (
				(transition.kind !== "approve" &&
					transition.kind !== "reject" &&
					transition.kind !== "cancel_pending") ||
				transition.from !== "pending" ||
				input.workflow.status !== transition.to ||
				input.source.status !== "pending"
			) {
				fail("Period submission terminal transition is incompatible with its state");
			}
			if (
				transition.kind === "cancel_pending" &&
				periodSubmissionClosedCauseOf(transition.reason) === null
			) {
				fail("Period submission cancel reason is unknown");
			}
			if (!isTerminalActorAllowed(input.actor, transition)) {
				fail("Period submission terminal actor is invalid");
			}
		},
		async finalizeTerminal(input) {
			await this.preflightTerminal(input);
			const transition = input.transition;
			if (transition.kind === "cancel_pending") {
				// Withdrawal (#1060): the row closes here; the withdrawal entry point writes its audit
				// entry with the actor who caused it, in the same transaction.
				const closedCause = periodSubmissionClosedCauseOf(transition.reason);
				if (!closedCause) return fail();
				await closePendingPeriodSubmission(database(input.dbService), {
					organizationId: input.organizationId,
					submissionId: input.source.id,
					workflowId: input.workflow.id,
					closedAt: input.finalizedAt,
					closedCause,
				});
				return normalizeStableData({
					organizationId: input.organizationId,
					workflowId: input.workflow.id,
					sourceIdentity: {
						organizationId: input.organizationId,
						workflowType: PERIOD_SUBMISSION_WORKFLOW_TYPE,
						sourceType: PERIOD_SUBMISSION_SOURCE_TYPE,
						sourceId: input.source.id,
					},
					transitionKind: transition.kind,
					terminalStatus: "cancelled",
					sourceSnapshot: {
						kind: PERIOD_SUBMISSION_WORKFLOW_TYPE,
						startDate: input.source.startDate,
						endDate: input.source.endDate,
						status: "withdrawn",
						closedCause,
					},
					eventPayload: { kind: PERIOD_SUBMISSION_WORKFLOW_TYPE, status: "withdrawn", closedCause },
					compatibilityPayload: { entityType: PERIOD_SUBMISSION_SOURCE_TYPE, status: "withdrawn" },
					finalizedAt: input.finalizedAt,
				}) as ApprovalTerminalFinalizationResult;
			}
			if (transition.kind !== "approve" && transition.kind !== "reject") return fail();
			if (input.actor.kind !== "employee" || !input.actor.userId) return fail();
			const status = transition.kind === "approve" ? "approved" : "rejected";
			const reason = transition.kind === "reject" ? transition.reason : null;
			const client = database(input.dbService);
			const row = await recordPeriodSubmissionDecision(client, {
				organizationId: input.organizationId,
				submissionId: input.source.id,
				workflowId: input.workflow.id,
				status,
				decidedAt: input.finalizedAt,
				decidedByEmployeeId: input.actor.employeeId,
				reason,
			});
			await insertPeriodSubmissionAudit(client, {
				organizationId: input.organizationId,
				submission: row,
				action:
					status === "approved"
						? AuditAction.PERIOD_SUBMISSION_APPROVED
						: AuditAction.PERIOD_SUBMISSION_REJECTED,
				actorUserId: input.actor.userId,
				at: input.finalizedAt,
				reason,
				metadata: { approverEmployeeId: input.actor.employeeId },
			});
			return normalizeStableData({
				organizationId: input.organizationId,
				workflowId: input.workflow.id,
				sourceIdentity: {
					organizationId: input.organizationId,
					workflowType: PERIOD_SUBMISSION_WORKFLOW_TYPE,
					sourceType: PERIOD_SUBMISSION_SOURCE_TYPE,
					sourceId: input.source.id,
				},
				transitionKind: transition.kind,
				terminalStatus: status,
				sourceSnapshot: {
					kind: PERIOD_SUBMISSION_WORKFLOW_TYPE,
					startDate: input.source.startDate,
					endDate: input.source.endDate,
					status,
				},
				eventPayload: { kind: PERIOD_SUBMISSION_WORKFLOW_TYPE, status },
				compatibilityPayload: { entityType: PERIOD_SUBMISSION_SOURCE_TYPE, status },
				finalizedAt: input.finalizedAt,
			}) as ApprovalTerminalFinalizationResult;
		},
		async projectDisplay(input) {
			validateContext(input);
			return normalizeStableData({
				displayPayload: {
					kind: PERIOD_SUBMISSION_WORKFLOW_TYPE,
					startDate: input.source.startDate,
					endDate: input.source.endDate,
					timezone: input.source.timezone,
				},
				searchText: "period submission",
			}) as { displayPayload: JsonObject; searchText: string };
		},
		async preflightDecisionEvidence(input) {
			validateContext(input);
			await preflightPeriodSubmissionDecisionEvidence(input.dbService.db as never, {
				organizationId: input.organizationId,
				workflow: input.workflow,
				reviewedBindingId: input.reviewedBindingId,
				target: {
					actorEmployeeId: input.actor.kind === "employee" ? input.actor.employeeId : null,
					stageId: input.command.stageId,
					assignmentId: input.command.assignmentId,
				},
			});
		},
		async recordDecisionEvidence(input) {
			await recordPeriodSubmissionDecisionEvidence(input.dbService.db as never, {
				organizationId: input.organizationId,
				workflow: input.workflow,
				command: input.command,
				receipt: input.receipt,
				result: input.result,
				finalization: input.finalization,
				reviewedBindingId: input.reviewedBindingId,
			});
		},
	};
}
