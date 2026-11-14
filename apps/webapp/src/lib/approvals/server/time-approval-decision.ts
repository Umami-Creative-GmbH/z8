import "server-only";

/**
 * The time approval decision (spec #1673): decides one time approval, whatever
 * its kind (time correction, manual time submission, policy clock-out), its
 * approval authority (legacy, shadow mirroring, canonical) or its entry point.
 *
 * The caller names the organization, one approval (a legacy request or a
 * canonical assignment), the actor, one decision right and the decision. The
 * kind is classified with plain reads before any guard, because the approval
 * write gate at rank 2 belongs to the decided kind (Time Tracking ADR 0001);
 * one work transaction then runs under that kind's gate, classifies again
 * under the guards and restarts on a mismatch. The claimed right is verified
 * from the database inside that transaction and never exchanged for another
 * (Approvals ADR 0003). After commit, the module runs the work the kind and
 * authority call for, awaits it, logs each failure and keeps the result.
 *
 * A refusal is a value. Infrastructure failures and broken invariants throw.
 */
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db as applicationDatabase } from "@/db";
import {
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	employee,
	workPeriod,
} from "@/db/schema";
import { type Clock, systemClock } from "@/lib/datetime/temporal-core";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import { monthClosedRefusalOf } from "@/lib/time-tracking/closed-months/refusal";
import { isUnresolvedWorkPeriodReview } from "@/lib/time-tracking/work-period-review";
import type { DecisionRight } from "../decision-right";
import { kickApprovalDelivery } from "../delivery/kick";
import { loadCover } from "../deputy/covering-store";
import {
	ApprovalAssignmentReassignedError,
	eligibleManagerFallbackAllowed,
} from "../escalation/decision-authority";
import { ApprovalEvidenceError } from "../evidence/errors";
import { ApprovalInvocationNotAdmittedError } from "../evidence/invocation";
import { isEligibleManagerForApprovalRequest } from "../policies/manager-eligibility-db";
import { isOwnRequestDecisionRefusal } from "../policies/self-decision";
import { isTimeApprovalWorkflowType, type TimeApprovalWorkflowType } from "../time-approval-kinds";
import type { ApprovalWorkflowDatabase } from "../workflow/repository";
import {
	createProductionApprovalWorkflowRuntime,
	isForbiddenCommandActorFailure,
} from "../workflow/runtime";
import { ApprovalTransitionEngineError } from "../workflow/transition-engine";
import { holdsApprovalManagement } from "./approval-management";
import { classifyPersistedTimeApprovalRequest } from "./time-approval-classification";
import { TimeApprovalKindChanged } from "./time-approval-kind-changed";
import {
	createLegacyTimeCorrectionDecisionProcessor,
	deleteCancelledTimeCorrectionsInTransaction,
	dispatchTimeCorrectionDecisionPostCommit,
	executeTimeCorrectionDecisionInTransaction,
	finalizeTimeCorrectionTerminalInTransaction,
} from "./time-correction-approvals";
import type { ApprovalDatabase, ApprovalDbService, CurrentApprover } from "./types";
import {
	executeOrdinaryWorkPeriodDecisionInTransaction,
	finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
	isOrdinaryWorkPeriodDecisionRefusal,
	notifyWorkPeriodApprovalAfterCommit,
	reconcileOrdinaryWorkPeriodMaintenanceAfterCommit,
} from "./work-period-approvals";

const logger = createLogger("TimeApprovalDecision");

/** A restart is a race with a reclassification; it settles at once. */
const MAX_ATTEMPTS = 3;

export type TimeApprovalDecisionRefusalReason =
	| "not_found"
	| "already_decided"
	| "right_not_held"
	| "reassigned"
	| "own_request"
	| "changed"
	| "evidence_required"
	| "month_closed"
	/** Legacy requests only. */
	| "unclassified"
	/** The fast-lane assessment changed. */
	| "guard_failed"
	/** Cards only. */
	| "binding_mismatch"
	| "not_admitted"
	| "invocation_conflict";

export type TimeApprovalDecisionResult =
	| {
			status: "decided";
			kind: TimeApprovalWorkflowType;
			workPeriodId: string;
			/** `advanced`: the next stage is now pending. */
			outcome: "approved" | "rejected" | "advanced";
			replayed: boolean;
	  }
	| { status: "refused"; reason: TimeApprovalDecisionRefusalReason };

export interface TimeApprovalDecisionInput {
	organizationId: string;
	/** A legacy request id or a canonical assignment id; never a workflow id. */
	approvalId: string;
	actor: { employeeId: string; userId: string };
	right: DecisionRight;
	decision: { kind: "approve" } | { kind: "reject"; reason: string };
	/** The fast lane's guard; refusing it gives `guard_failed`. */
	fastLaneGuard?: (database: ApprovalDatabase) => Promise<void>;
	/**
	 * Confirms a decision that already committed and never makes a fresh one.
	 * Only the unbound bot card uses it; it goes with that card at cutover.
	 */
	replayOnly?: boolean;
	/** The database that opens the work transaction; defaults to the application database. */
	database?: ApprovalDatabase;
	clock?: Clock;
}

/** One time approval decision; a refusal is a value. */
export async function decideTimeApproval(
	input: TimeApprovalDecisionInput,
): Promise<TimeApprovalDecisionResult> {
	return (await decideTimeApprovalWithCause(input)).result;
}

interface DecisionOutcome {
	result: TimeApprovalDecisionResult;
	/** A refusal's original error, for the inbox adapters that throw what their routes expect. */
	cause?: unknown;
}

type RoutedTarget =
	| {
			found: true;
			kind: TimeApprovalWorkflowType | "unclassified";
			workPeriodId: string;
			currentApproverEmployeeId: string | null;
			/** The legacy request that names this decision, if any (eligibility reads it). */
			legacyApprovalRequestId: string | null;
			pending: boolean;
	  }
	| { found: false };

/**
 * The target and its kind, from plain reads before any guard: a legacy
 * request is classified as its decision owner classifies it, a canonical
 * assignment's kind is its workflow's type. Every read is organization-scoped.
 */
async function routeTimeApproval(
	database: ApprovalDatabase,
	input: { organizationId: string; approvalId: string },
): Promise<RoutedTarget> {
	const request = await database.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, input.approvalId),
			eq(approvalRequest.organizationId, input.organizationId),
			eq(approvalRequest.entityType, "time_entry"),
		),
	});
	if (request) {
		const period = await database.query.workPeriod.findFirst({
			where: and(
				eq(workPeriod.id, request.entityId),
				eq(workPeriod.organizationId, input.organizationId),
			),
			columns: { id: true, clockInId: true, clockOutId: true, pendingChanges: true },
		});
		if (!period) return { found: false };
		const kind = await classifyPersistedTimeApprovalRequest(database, {
			organizationId: input.organizationId,
			request,
			period,
		});
		return {
			found: true,
			kind,
			workPeriodId: period.id,
			currentApproverEmployeeId: request.approverId,
			legacyApprovalRequestId: request.id,
			pending: request.status === "pending",
		};
	}
	const assignment = await database.query.approvalStageAssignment.findFirst({
		where: and(
			eq(approvalStageAssignment.id, input.approvalId),
			eq(approvalStageAssignment.organizationId, input.organizationId),
		),
		columns: { workflowId: true, stageId: true, approverEmployeeId: true, status: true },
	});
	if (!assignment) return { found: false };
	const [workflow, stage] = await Promise.all([
		database.query.approvalWorkflow.findFirst({
			where: and(
				eq(approvalWorkflow.id, assignment.workflowId),
				eq(approvalWorkflow.organizationId, input.organizationId),
				eq(approvalWorkflow.sourceType, "time_entry"),
			),
			columns: { workflowType: true, sourceId: true },
		}),
		database.query.approvalWorkflowStage.findFirst({
			where: and(
				eq(approvalWorkflowStage.id, assignment.stageId),
				eq(approvalWorkflowStage.organizationId, input.organizationId),
			),
			columns: { legacyApprovalRequestId: true },
		}),
	]);
	if (!workflow || !isTimeApprovalWorkflowType(workflow.workflowType)) return { found: false };
	return {
		found: true,
		kind: workflow.workflowType,
		workPeriodId: workflow.sourceId,
		currentApproverEmployeeId: assignment.approverEmployeeId,
		legacyApprovalRequestId: stage?.legacyApprovalRequestId ?? null,
		pending: assignment.status === "pending",
	};
}

async function loadActor(
	database: ApprovalDatabase,
	input: TimeApprovalDecisionInput,
): Promise<CurrentApprover | null> {
	const row = await database.query.employee.findFirst({
		where: and(
			eq(employee.id, input.actor.employeeId),
			eq(employee.organizationId, input.organizationId),
			eq(employee.userId, input.actor.userId),
			eq(employee.isActive, true),
		),
		with: { user: true },
	});
	return row?.user ? (row as unknown as CurrentApprover) : null;
}

/**
 * The one approval workflow runtime of a decision. Its management callback is
 * one switch on the claimed right; a covering deputy is granted only under
 * that right and only for the named approver.
 */
function decisionRuntime(
	right: DecisionRight,
	actor: CurrentApprover,
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
						const eligible = await isEligibleManagerForApprovalRequest({
							db: authorization.dbService.db as never,
							approvalRequestId: stage.legacyApprovalRequestId,
							managerEmployeeId: actor.id,
							organizationId: authorization.organizationId,
						});
						// Eligibility never bypasses an escalation replacement (#255 §4, #326).
						if (eligible && !eligibleManagerFallbackAllowed(stage, command.assignmentId)) {
							throw new ApprovalAssignmentReassignedError();
						}
						return eligible;
					}
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
		});
}

function decisionDbService(database: ApprovalDatabase): ApprovalDbService {
	return {
		db: database,
		query: <T>(_name: string, operation: () => Promise<T>) => Effect.promise(operation),
	};
}

function managementOf(right: DecisionRight, actor: CurrentApprover) {
	return right.as === "approval_manager"
		? (transaction: ApprovalDatabase) =>
				holdsApprovalManagement(transaction, {
					organizationId: actor.organizationId,
					userId: actor.userId,
				})
		: undefined;
}

async function afterCommit(
	name: string,
	context: Record<string, unknown>,
	work: () => Promise<void>,
) {
	try {
		await work();
	} catch (error) {
		logger.error({ error, ...context }, name);
	}
}

async function decideTimeCorrection(
	input: TimeApprovalDecisionInput,
	actor: CurrentApprover,
	database: ApprovalDatabase,
	clock: Clock,
	workPeriodId: string,
): Promise<TimeApprovalDecisionResult> {
	const action = input.decision.kind;
	const reason = input.decision.kind === "reject" ? input.decision.reason : undefined;
	const execution = await executeTimeCorrectionDecisionInTransaction({
		createRuntime: decisionRuntime(input.right, actor, clock),
		database: database as never,
		organizationId: input.organizationId,
		actorEmployeeId: actor.id,
		actorUserId: actor.userId,
		approvalRequestId: input.approvalId,
		action,
		reason,
		shortcutGuard: input.fastLaneGuard,
		nowInstant: () => clock.nowInstant(),
		canManageOrganizationApproval: managementOf(input.right, actor),
		processLegacy: createLegacyTimeCorrectionDecisionProcessor({
			approvalRequestId: input.approvalId,
			action,
			reason,
			options: { decisionRight: input.right },
		}),
	});
	const context = { organizationId: input.organizationId, approvalId: input.approvalId, action };
	if (execution.postCommit?.authority === "legacy" && execution.postCommit.terminal !== null) {
		const effects = execution.postCommit;
		await afterCommit("Time correction decision after-commit work failed", context, () =>
			dispatchTimeCorrectionDecisionPostCommit({
				dbService: decisionDbService(database),
				actor,
				approvalRequestId: input.approvalId,
				effects,
				reason,
			}),
		);
	}
	if ("deliveryIntent" in execution && execution.deliveryIntent) {
		// The legacy cycle's intent committed with the decision (#432); this
		// only runs the delivery owner sooner.
		await afterCommit("Time approval delivery kick failed", context, async () =>
			kickApprovalDelivery({ organizationId: input.organizationId }),
		);
	}
	const outcome =
		execution.postCommit?.authority === "legacy"
			? (execution.postCommit.terminal?.kind ?? "advanced")
			: execution.commandResult?.snapshot.status === "approved"
				? "approved"
				: execution.commandResult?.snapshot.status === "rejected"
					? "rejected"
					: "advanced";
	return {
		status: "decided",
		kind: "time_correction",
		workPeriodId,
		outcome,
		replayed: "replayed" in execution && execution.replayed === true,
	};
}

async function decideOrdinary(
	input: TimeApprovalDecisionInput,
	actor: CurrentApprover,
	database: ApprovalDatabase,
	clock: Clock,
	kind: "manual_time_submission" | "policy_clock_out",
	workPeriodId: string,
): Promise<TimeApprovalDecisionResult> {
	const dbService = decisionDbService(database);
	const execution = await executeOrdinaryWorkPeriodDecisionInTransaction({
		historicalOnly: input.replayOnly,
		dbService,
		createRuntime: decisionRuntime(input.right, actor, clock),
		organizationId: input.organizationId,
		approvalRequestId: input.approvalId,
		workPeriodId,
		actor,
		decisionRight: input.right,
		shortcutGuard: input.fastLaneGuard,
		canManageOrganizationApproval: managementOf(input.right, actor),
		decision:
			input.decision.kind === "approve"
				? { kind: "approve", reason: null }
				: { kind: "reject", reason: input.decision.reason },
	});
	const context = {
		organizationId: input.organizationId,
		approvalId: input.approvalId,
		workPeriodId,
	};
	const postCommit = execution.postCommit;
	const maintenance = postCommit?.maintenance;
	const notify = postCommit?.disposition === "dispatch" && postCommit.event !== "pending";
	await Promise.all([
		maintenance
			? afterCommit("Ordinary work-period maintenance after commit failed", context, () =>
					reconcileOrdinaryWorkPeriodMaintenanceAfterCommit(maintenance),
				)
			: undefined,
		notify
			? afterCommit("Ordinary work-period decision after-commit work failed", context, () =>
					Effect.runPromise(
						notifyWorkPeriodApprovalAfterCommit(
							execution.result,
							actor,
							dbService,
							input.approvalId,
						),
					),
				)
			: undefined,
	]);
	if (execution.deliveryIntent) {
		await afterCommit("Time approval delivery kick failed", context, async () =>
			kickApprovalDelivery({ organizationId: input.organizationId }),
		);
	}
	if (!postCommit) {
		// A replay: nothing ran after commit; the period says how far it got.
		const period = await database.query.workPeriod.findFirst({
			where: and(
				eq(workPeriod.id, workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
			),
			columns: { approvalStatus: true },
		});
		return {
			status: "decided",
			kind,
			workPeriodId,
			outcome:
				period?.approvalStatus === "approved" || period?.approvalStatus === "rejected"
					? period.approvalStatus
					: "advanced",
			replayed: true,
		};
	}
	return {
		status: "decided",
		kind,
		workPeriodId,
		outcome: postCommit.event === "pending" ? "advanced" : postCommit.event,
		replayed: false,
	};
}

const approvalNotFound = () =>
	new NotFoundError({ message: "Approval not found", entityType: "approval_request" });

function refused(reason: TimeApprovalDecisionRefusalReason, cause: unknown): DecisionOutcome {
	return { result: { status: "refused", reason }, cause };
}

function evidenceRefusal(code: unknown): TimeApprovalDecisionRefusalReason | null {
	switch (code) {
		case "evidence_required":
		case "evidence_incomplete":
			return "evidence_required";
		case "material_change":
			return "changed";
		case "binding_mismatch":
			return "binding_mismatch";
		case "invocation_mismatch":
			return "invocation_conflict";
		default:
			return null;
	}
}

/**
 * The refusal an owner's error stands for: each corresponds to an error the
 * owners raised before this module. Anything else is a failure and throws.
 */
function refusalOf(error: unknown): TimeApprovalDecisionRefusalReason | null {
	if (monthClosedRefusalOf(error)) return "month_closed";
	if (isUnresolvedWorkPeriodReview(error)) return "changed";
	if (error instanceof ApprovalAssignmentReassignedError) return "reassigned";
	if (error instanceof ApprovalInvocationNotAdmittedError) return "not_admitted";
	if (error instanceof ApprovalEvidenceError) return evidenceRefusal(error.code);
	if (error instanceof ApprovalTransitionEngineError) {
		switch (error.code) {
			case "forbidden":
				return "right_not_held";
			case "version_conflict":
			case "idempotency_mismatch":
				return "changed";
			default:
				return null;
		}
	}
	if (isForbiddenCommandActorFailure(error)) return "right_not_held";
	if (error instanceof NotFoundError) return "not_found";
	if (error instanceof AuthorizationError) {
		return isOwnRequestDecisionRefusal(error.message) ? "own_request" : "right_not_held";
	}
	if (error instanceof ValidationError) {
		return error.field === "approvalRequest.metadata.timeRequest.kind" ? "unclassified" : null;
	}
	if (error instanceof ConflictError) {
		switch (error.conflictType) {
			case "approval_status":
				return "already_decided";
			case "approval_reassigned":
				return "reassigned";
			case "approval_triage":
				return "guard_failed";
			case "approval_evidence":
				return evidenceRefusal((error.details as { code?: unknown } | undefined)?.code);
			case "approval_transition":
			case "completed_work_collision":
			case "work_interval_occupied":
			case "completed_work_review_required":
				return "changed";
			default:
				return null;
		}
	}
	return null;
}

/**
 * The decision with the original error of a refusal. Only the inbox adapter and
 * the time entry handler read the cause, to throw what their routes expect.
 */
export async function decideTimeApprovalWithCause(
	input: TimeApprovalDecisionInput,
): Promise<DecisionOutcome> {
	const database = input.database ?? (applicationDatabase as unknown as ApprovalDatabase);
	const clock = input.clock ?? systemClock;
	const actor = await loadActor(database, input);
	if (!actor) return refused("not_found", approvalNotFound());
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
		const target = await routeTimeApproval(database, input);
		if (!target.found) return refused("not_found", approvalNotFound());
		if (target.kind === "unclassified") {
			return refused(
				"unclassified",
				new ValidationError({
					message:
						"This legacy time approval could not be classified. Reconcile it before making a decision.",
					field: "approvalRequest.metadata.timeRequest.kind",
				}),
			);
		}
		try {
			if (target.kind === "time_correction") {
				// Only a committed manual or policy decision can be confirmed by replay.
				if (input.replayOnly) {
					return refused(
						"changed",
						new ConflictError({
							message: "Approval workflow decision conflicts with the current state",
							conflictType: "approval_transition",
						}),
					);
				}
				return {
					result: await decideTimeCorrection(input, actor, database, clock, target.workPeriodId),
				};
			}
			return {
				result: await decideOrdinary(
					input,
					actor,
					database,
					clock,
					target.kind,
					target.workPeriodId,
				),
			};
		} catch (error) {
			if (error instanceof TimeApprovalKindChanged) continue;
			const reason = refusalOf(error);
			if (reason) return refused(reason, error);
			const now = await routeTimeApproval(database, input);
			if (isOrdinaryWorkPeriodDecisionRefusal(error)) {
				// The ordinary owner's generic refusal: the current state names it.
				return refused(
					!now.found ? "not_found" : now.pending ? "changed" : "already_decided",
					error,
				);
			}
			// A decided approval is never decided again, however its owner refused it.
			if (now.found && !now.pending) return refused("already_decided", error);
			throw error;
		}
	}
	throw new Error("Time approval kind did not settle under the work transaction's guards");
}
