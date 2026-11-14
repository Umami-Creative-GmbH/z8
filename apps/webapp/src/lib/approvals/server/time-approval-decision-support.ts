import "server-only";

/**
 * What the time approval decision (spec #1673) shares with its two owners, the
 * time correction owner and the ordinary work-period owner: the one approval
 * workflow runtime a decision runs under, and the after-commit logging. Only
 * the time approval decision and those owners use it; neither the runtime nor
 * the claimed right can be supplied by any other caller.
 */
import { Effect } from "effect";
import type { Clock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import type { DecisionRight } from "../decision-right";
import { loadCover } from "../deputy/covering-store";
import {
	ApprovalAssignmentReassignedError,
	eligibleManagerFallbackAllowed,
} from "../escalation/decision-authority";
import { ApprovalEvidenceError } from "../evidence/errors";
import { eligibleManagerRight } from "../policies/eligible-manager-right";
import type { ApprovalWorkflowDatabase } from "../workflow/repository";
import { createProductionApprovalWorkflowRuntime } from "../workflow/runtime";
import { holdsApprovalManagement } from "./approval-management";
import type { BoundTimeInvocationOutcome } from "./bound-time-invocation";
import type {
	TimeApprovalDecisionInput,
	TimeApprovalDecisionReceipt,
} from "./time-approval-decision";
import {
	deleteCancelledTimeCorrectionsInTransaction,
	finalizeTimeCorrectionTerminalInTransaction,
} from "./time-correction-approvals";
import type { ApprovalDatabase, ApprovalDbService } from "./types";
import { finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction } from "./work-period-approvals";

const logger = createLogger("TimeApprovalDecision");

/** The deciding person, as the runtime's management and deputy callbacks see them. */
export interface TimeApprovalDecisionActor {
	id: string;
	userId: string;
	organizationId: string;
}

/**
 * The one approval workflow runtime of a decision. Its management callback is
 * one switch on the claimed right; a covering deputy is granted only under
 * that right and only for the named approver.
 */
export function timeApprovalDecisionRuntime(
	right: DecisionRight,
	actor: TimeApprovalDecisionActor,
	clock: Clock,
): (
	database: ApprovalWorkflowDatabase,
) => ReturnType<typeof createProductionApprovalWorkflowRuntime> {
	return (database) =>
		createProductionApprovalWorkflowRuntime({
			db: database,
			adapters: {
				absence: {
					clock,
					finalizeAbsenceTerminal: async () => {
						throw new Error("Absence finalization is outside this boundary");
					},
					deleteCancelledAbsence: async () => {
						throw new Error("Absence cancellation is outside this boundary");
					},
				},
				timeCorrection: {
					clock,
					finalizeTimeCorrectionTerminal: finalizeTimeCorrectionTerminalInTransaction,
					deleteCancelledCorrections: deleteCancelledTimeCorrectionsInTransaction,
				},
				ordinaryWorkPeriod: {
					finalizeTerminal: finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
				},
			},
			canManageApproval: async (authorization) => {
				if (
					authorization.organizationId !== actor.organizationId ||
					authorization.actorEmployeeId !== actor.id
				) {
					return false;
				}
				switch (right.as) {
					case "approval_manager":
						return holdsApprovalManagement(authorization.dbService.db as never, {
							organizationId: actor.organizationId,
							userId: actor.userId,
						});
					case "eligible_manager": {
						const command = authorization.command;
						if (command.type !== "approve" && command.type !== "reject") return false;
						const stage = authorization.workflow.stages.find(
							(candidate) =>
								candidate.id === command.stageId &&
								candidate.sequence === authorization.workflow.currentStageOrder &&
								candidate.status === "pending",
						);
						if (!stage?.legacyApprovalRequestId) return false;
						// Eligibility never bypasses an escalation replacement (#255 §4, #326).
						const held = await eligibleManagerRight({
							db: authorization.dbService.db as never,
							organizationId: authorization.organizationId,
							approvalRequestId: stage.legacyApprovalRequestId,
							managerEmployeeId: actor.id,
							replacedByEscalation: () =>
								!eligibleManagerFallbackAllowed(stage, command.assignmentId),
						});
						if (held === "reassigned") throw new ApprovalAssignmentReassignedError();
						return held === "held";
					}
					// The runtime grants these rights itself, only under their claim.
					case "approver":
					case "covering_deputy":
						return false;
				}
			},
			deputyAuthority: {
				coverFor: async (cover) => {
					if (right.as !== "covering_deputy") return null;
					// The deputy right follows the named approver; a transfer away ends it.
					if (cover.approverEmployeeId !== right.forEmployeeId) {
						throw new ApprovalAssignmentReassignedError();
					}
					return loadCover(cover.dbService.db as never, {
						organizationId: cover.organizationId,
						approverId: cover.approverEmployeeId,
						deputyId: cover.deputyEmployeeId,
						at: clock.nowInstant(),
					});
				},
			},
			clock,
			claimedRight: right,
		});
}

export function timeApprovalDecisionDbService(database: ApprovalDatabase): ApprovalDbService {
	return {
		db: database,
		query: <T>(_name: string, operation: () => Promise<T>) => Effect.promise(operation),
	};
}

/** After-commit work: awaited, a failure logged, the committed result kept. */
export async function afterTimeApprovalCommit(
	name: string,
	context: Record<string, unknown>,
	work: () => Promise<void>,
): Promise<void> {
	try {
		await work();
	} catch (error) {
		logger.error({ error, ...context }, name);
	}
}

/** A card press's receipt; a card decision without one broke an invariant. */
export function timeApprovalReceiptOf(
	input: TimeApprovalDecisionInput,
	invocation: BoundTimeInvocationOutcome | undefined,
): { receipt?: TimeApprovalDecisionReceipt; replayed?: true } {
	if (!input.card) return {};
	if (!invocation) throw new ApprovalEvidenceError("invariant", { field: "invocation_decision" });
	return {
		receipt: invocation.evidence,
		...(invocation.replayed ? { replayed: true as const } : {}),
	};
}
