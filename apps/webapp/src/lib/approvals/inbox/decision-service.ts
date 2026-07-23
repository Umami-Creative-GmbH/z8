import { and, eq, inArray } from "drizzle-orm";
import { Cause, Effect, Exit, Option } from "effect";
import { db } from "@/db";
import {
	approvalRequest,
	approvalStageAssignment,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import type {
	ApprovalActionOptions,
	ApprovalTypeHandler,
} from "@/lib/approvals/domain/types";
import { ApprovalAuditLoggerLive } from "@/lib/approvals/infrastructure/audit-logger";
import {
	classifyTimeApprovalRequest,
	type TimeApprovalKind,
} from "@/lib/approvals/time-request-kind";
import { NotFoundError } from "@/lib/effect/errors";
import { runtime } from "@/lib/effect/runtime";
import { createLogger } from "@/lib/logger";
import {
	getSupportedInboxHandler,
	isSupportedInboxType,
} from "./source-adapters";
import type {
	ApprovalInboxBulkDecisionResult,
	ApprovalInboxDecisionFailure,
	ApprovalInboxDecisionSuccess,
	ApprovalInboxStatus,
} from "./types";

type InboxDecisionAction = "approve" | "reject";
// Matches ApprovalTypeHandler approve/reject effects, which may require any app service layer.
type DecisionEffectRunner = (
	// biome-ignore lint/suspicious/noExplicitAny: handlers may require any application service layer
	effect: Effect.Effect<void, unknown, any>,
) => Promise<Exit.Exit<void, unknown>>;
type EligibleApprovalScope = {
	requesterEmployeeId: string;
	eligibleApproverIds: string[];
};
type DecisionVisibilityInput = {
	includeAllApprovers?: boolean;
	eligibleApprovalScopes?: EligibleApprovalScope[];
};
type BulkDecisionOutcome =
	| { status: "succeeded"; success: ApprovalInboxDecisionSuccess }
	| { status: "failed"; failure: ApprovalInboxDecisionFailure };

const defaultDecisionEffectRunner: DecisionEffectRunner = (effect) =>
	runtime.runPromiseExit(effect.pipe(Effect.provide(ApprovalAuditLoggerLive)));
const logger = createLogger("ApprovalInboxDecisionService");

export interface PersistedApprovalRequestForDecision {
	id: string;
	targetType: "compatibility_request" | "canonical_assignment";
	entityType: string;
	entityId: string;
	organizationId: string;
	approverId: string;
	requesterEmployeeId: string;
	status: ApprovalInboxStatus;
	workflowKind: TimeApprovalKind | null;
}

export function canAttemptApprovalInboxDecisionTarget(input: {
	status: ApprovalInboxStatus | string;
	workflowKind: TimeApprovalKind | null;
}): boolean {
	return (
		input.status === "pending" ||
		((input.status === "approved" || input.status === "rejected") &&
			(input.workflowKind === "manual_time_submission" ||
				input.workflowKind === "policy_clock_out"))
	);
}

export async function decideApprovalInboxItemFromRequest({
	request,
	actorEmployeeId,
	action,
	reason,
	handler,
	allowOrganizationWideApprover,
	runEffect = defaultDecisionEffectRunner,
}: {
	request: PersistedApprovalRequestForDecision;
	actorEmployeeId: string;
	action: InboxDecisionAction;
	reason?: string;
	handler: ApprovalTypeHandler;
	allowOrganizationWideApprover?: boolean;
	runEffect?: DecisionEffectRunner;
}): Promise<ApprovalInboxDecisionSuccess> {
	const requestType = request.entityType;
	if (!isSupportedInboxType(requestType)) {
		throw new Error(`Unsupported approval type: ${request.entityType}`);
	}

	if (handler.type !== requestType) {
		throw new Error(`Unsupported approval type: ${request.entityType}`);
	}

	if (!canAttemptApprovalInboxDecisionTarget(request)) {
		throw new Error(`Request is already ${request.status}`);
	}

	const trimmedReason = reason?.trim();
	if (action === "reject" && !trimmedReason) {
		throw new Error("Rejection reason is required");
	}
	const actionOptions: ApprovalActionOptions =
		actorEmployeeId === request.approverId
			? { approvalRequestId: request.id }
			: allowOrganizationWideApprover
				? { approvalRequestId: request.id, allowOrganizationWideApprover: true }
				: { approvalRequestId: request.id, allowAnyApprover: true };

	const effect =
		action === "approve"
			? handler.approve(request.entityId, actorEmployeeId, actionOptions)
			: handler.reject(
					request.entityId,
					actorEmployeeId,
					trimmedReason ?? "",
					actionOptions,
				);
	const exit = await runEffect(effect);

	return Exit.match(exit, {
		onFailure: (cause) => {
			throw extractEffectError(cause);
		},
		onSuccess: () => ({
			id: request.id,
			type: requestType,
			status: action === "approve" ? "approved" : "rejected",
		}),
	});
}

export async function bulkDecideApprovalInboxItemsFromRequests({
	requests,
	actorEmployeeId,
	action,
	reason,
	includeAllApprovers,
	eligibleApprovalScopes,
	resolveHandler = getSupportedInboxHandler,
	runEffect = defaultDecisionEffectRunner,
}: {
	requests: PersistedApprovalRequestForDecision[];
	actorEmployeeId: string;
	action: InboxDecisionAction;
	reason?: string;
	includeAllApprovers?: boolean;
	eligibleApprovalScopes?: EligibleApprovalScope[];
	resolveHandler?: (type: string) => ApprovalTypeHandler | null;
	runEffect?: DecisionEffectRunner;
}): Promise<ApprovalInboxBulkDecisionResult> {
	const result: ApprovalInboxBulkDecisionResult = { succeeded: [], failed: [] };

	const decisions = await Promise.all(
		requests.map(async (request): Promise<BulkDecisionOutcome> => {
			if (
				!canDecideRequest({
					request,
					actorEmployeeId,
					includeAllApprovers,
					eligibleApprovalScopes,
				})
			) {
				return {
					status: "failed" as const,
					failure: {
						id: request.id,
						code: "not_found",
						message: "Approval not found",
					},
				};
			}

			const handler = resolveHandler(request.entityType);

			if (
				!handler ||
				!isSupportedInboxType(request.entityType) ||
				handler.type !== request.entityType
			) {
				return {
					status: "failed" as const,
					failure: {
						id: request.id,
						code: "unsupported",
						message: `Unsupported approval type: ${request.entityType}`,
					},
				};
			}

			if (!canAttemptApprovalInboxDecisionTarget(request)) {
				return {
					status: "failed" as const,
					failure: {
						id: request.id,
						code: "stale",
						message: `Request is already ${request.status}`,
					},
				};
			}

			try {
				return {
					status: "succeeded" as const,
					success: await decideApprovalInboxItemFromRequest({
						request,
						actorEmployeeId,
						action,
						reason,
						handler,
						allowOrganizationWideApprover: includeAllApprovers === true,
						runEffect,
					}),
				};
			} catch (error) {
				return {
					status: "failed" as const,
					failure: mapDecisionFailure(request.id, error),
				};
			}
		}),
	);

	for (const decision of decisions) {
		if (decision.status === "succeeded") {
			result.succeeded.push(decision.success);
		} else {
			result.failed.push(decision.failure);
		}
	}

	return result;
}

export async function approveApprovalInboxItem({
	approvalId,
	actorEmployeeId,
	organizationId,
	includeAllApprovers,
	eligibleApprovalScopes,
}: {
	approvalId: string;
	actorEmployeeId: string;
	organizationId: string;
} & DecisionVisibilityInput): Promise<ApprovalInboxDecisionSuccess> {
	const request = await loadApprovalInboxDecisionTarget({
		approvalId,
		organizationId,
	});
	assertCanDecideRequest({
		request,
		actorEmployeeId,
		includeAllApprovers,
		eligibleApprovalScopes,
	});
	const handler = getSupportedInboxHandler(request.entityType);
	if (!handler) {
		throw new Error(`Unsupported approval type: ${request.entityType}`);
	}

	return decideApprovalInboxItemFromRequest({
		request,
		actorEmployeeId,
		action: "approve",
		handler,
		allowOrganizationWideApprover: includeAllApprovers === true,
	});
}

export async function rejectApprovalInboxItem({
	approvalId,
	actorEmployeeId,
	organizationId,
	reason,
	includeAllApprovers,
	eligibleApprovalScopes,
}: {
	approvalId: string;
	actorEmployeeId: string;
	organizationId: string;
	reason: string;
} & DecisionVisibilityInput): Promise<ApprovalInboxDecisionSuccess> {
	const request = await loadApprovalInboxDecisionTarget({
		approvalId,
		organizationId,
	});
	assertCanDecideRequest({
		request,
		actorEmployeeId,
		includeAllApprovers,
		eligibleApprovalScopes,
	});
	const handler = getSupportedInboxHandler(request.entityType);
	if (!handler) {
		throw new Error(`Unsupported approval type: ${request.entityType}`);
	}

	return decideApprovalInboxItemFromRequest({
		request,
		actorEmployeeId,
		action: "reject",
		reason,
		handler,
		allowOrganizationWideApprover: includeAllApprovers === true,
	});
}

export async function bulkApproveApprovalInboxItems({
	approvalIds,
	actorEmployeeId,
	organizationId,
	includeAllApprovers,
	eligibleApprovalScopes,
}: {
	approvalIds: string[];
	actorEmployeeId: string;
	organizationId: string;
} & DecisionVisibilityInput): Promise<ApprovalInboxBulkDecisionResult> {
	const requests = await loadApprovalInboxDecisionTargets({
		approvalIds,
		organizationId,
	});
	const result = await bulkDecideApprovalInboxItemsFromRequests({
		requests,
		actorEmployeeId,
		action: "approve",
		includeAllApprovers,
		eligibleApprovalScopes,
	});

	return withMissingApprovalFailures(approvalIds, requests, result);
}

export async function bulkRejectApprovalInboxItems({
	approvalIds,
	actorEmployeeId,
	organizationId,
	reason,
	includeAllApprovers,
	eligibleApprovalScopes,
}: {
	approvalIds: string[];
	actorEmployeeId: string;
	organizationId: string;
	reason: string;
} & DecisionVisibilityInput): Promise<ApprovalInboxBulkDecisionResult> {
	const requests = await loadApprovalInboxDecisionTargets({
		approvalIds,
		organizationId,
	});
	const result = await bulkDecideApprovalInboxItemsFromRequests({
		requests,
		actorEmployeeId,
		action: "reject",
		reason,
		includeAllApprovers,
		eligibleApprovalScopes,
	});

	return withMissingApprovalFailures(approvalIds, requests, result);
}

function withMissingApprovalFailures(
	approvalIds: string[],
	requests: PersistedApprovalRequestForDecision[],
	result: ApprovalInboxBulkDecisionResult,
): ApprovalInboxBulkDecisionResult {
	const foundIds = new Set(requests.map((request) => request.id));
	const requestedOrder = new Map(
		approvalIds.map((approvalId, index) => [approvalId, index]),
	);
	const failed = [...result.failed];

	for (const approvalId of approvalIds) {
		if (foundIds.has(approvalId)) {
			continue;
		}

		failed.push({
			id: approvalId,
			code: "not_found",
			message: "Approval not found",
		});
	}

	failed.sort((first, second) => {
		return (
			(requestedOrder.get(first.id) ?? Number.MAX_SAFE_INTEGER) -
			(requestedOrder.get(second.id) ?? Number.MAX_SAFE_INTEGER)
		);
	});

	return { succeeded: result.succeeded, failed };
}

export async function loadApprovalInboxDecisionTarget({
	approvalId,
	organizationId,
	database = db,
}: {
	approvalId: string;
	organizationId: string;
	database?: typeof db;
}): Promise<PersistedApprovalRequestForDecision> {
	const request = await database.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, approvalId),
			eq(approvalRequest.organizationId, organizationId),
		),
	});

	if (!request) {
		const assignment = await database.query.approvalStageAssignment.findFirst({
			where: and(
				eq(approvalStageAssignment.id, approvalId),
				eq(approvalStageAssignment.organizationId, organizationId),
			),
			with: { workflow: true, stage: true },
		});
		const canonical = toPersistedCanonicalDecisionRequest(
			assignment,
			approvalId,
			organizationId,
		);
		if (canonical) return canonical;
		throw approvalNotFound(approvalId);
	}

	return await toPersistedDecisionRequest(request, database);
}

export async function loadApprovalInboxDecisionTargets({
	approvalIds,
	organizationId,
	database = db,
}: {
	approvalIds: string[];
	organizationId: string;
	database?: typeof db;
}): Promise<PersistedApprovalRequestForDecision[]> {
	if (approvalIds.length === 0) {
		return [];
	}

	const requests = await database.query.approvalRequest.findMany({
		where: and(
			inArray(approvalRequest.id, approvalIds),
			eq(approvalRequest.organizationId, organizationId),
		),
	});
	const requestsById = new Map(
		requests.map((request) => [request.id, request]),
	);
	const missingIds = approvalIds.filter(
		(approvalId) => !requestsById.has(approvalId),
	);
	const assignments =
		missingIds.length === 0
			? []
			: await database.query.approvalStageAssignment.findMany({
					where: and(
						inArray(approvalStageAssignment.id, missingIds),
						eq(approvalStageAssignment.organizationId, organizationId),
					),
					with: { workflow: true, stage: true },
				});
	const assignmentsById = new Map(
		assignments.flatMap((assignment) => {
			const decision = toPersistedCanonicalDecisionRequest(
				assignment,
				assignment.id,
				organizationId,
			);
			return decision ? [[decision.id, decision] as const] : [];
		}),
	);

	const ordered = approvalIds
		.map((approvalId) => {
			const request = requestsById.get(approvalId);
			return request ? request : assignmentsById.get(approvalId);
		})
		.filter((request): request is NonNullable<typeof request> =>
			Boolean(request),
		);
	return await Promise.all(
		ordered.map((request) =>
			"requestedBy" in request
				? toPersistedDecisionRequest(request, database)
				: Promise.resolve(request),
		),
	);
}

function approvalNotFound(approvalId: string): NotFoundError {
	return new NotFoundError({
		message: "Approval not found",
		entityType: "approval_request",
		entityId: approvalId,
	});
}

function toPersistedCanonicalDecisionRequest(
	assignment:
		| {
				id: string;
				organizationId: string;
				workflowId: string;
				stageId: string;
				approverEmployeeId: string;
				status: string;
				workflow: {
					id: string;
					organizationId: string;
					workflowType: string;
					sourceType: string;
					sourceId: string;
					requesterEmployeeId: string | null;
					status: string;
					currentStageOrder: number | null;
				} | null;
				stage: {
					id: string;
					organizationId: string;
					workflowId: string;
					sequence: number;
					status: string;
				} | null;
		  }
		| null
		| undefined,
	approvalId: string,
	organizationId: string,
): PersistedApprovalRequestForDecision | null {
	const workflow = assignment?.workflow;
	const stage = assignment?.stage;
	const supportedWorkflow =
		workflow?.workflowType === "manual_time_submission" ||
		workflow?.workflowType === "policy_clock_out" ||
		workflow?.workflowType === "time_correction";
	const ordinaryWorkflow =
		workflow?.workflowType === "manual_time_submission" ||
		workflow?.workflowType === "policy_clock_out";
	const pendingTarget =
		assignment?.status === "pending" &&
		stage?.status === "pending" &&
		workflow?.status === "pending" &&
		stage.sequence === workflow.currentStageOrder;
	const terminalTarget =
		(assignment?.status === "approved" || assignment?.status === "rejected") &&
		stage?.status === assignment.status &&
		((workflow?.status === assignment.status &&
			workflow.currentStageOrder === null) ||
			(ordinaryWorkflow &&
				workflow?.status === "pending" &&
				assignment.status === "approved" &&
				typeof workflow.currentStageOrder === "number" &&
				stage.sequence < workflow.currentStageOrder));
	if (
		!assignment ||
		!workflow ||
		!stage ||
		assignment.id !== approvalId ||
		assignment.organizationId !== organizationId ||
		assignment.workflowId !== workflow.id ||
		assignment.stageId !== stage.id ||
		workflow.organizationId !== organizationId ||
		stage.organizationId !== organizationId ||
		stage.workflowId !== workflow.id ||
		workflow.sourceType !== "time_entry" ||
		!workflow.sourceId ||
		!workflow.requesterEmployeeId ||
		!supportedWorkflow ||
		(!pendingTarget && !terminalTarget)
	) {
		return null;
	}
	return {
		id: assignment.id,
		targetType: "canonical_assignment",
		entityType: "time_entry",
		entityId: workflow.sourceId,
		organizationId,
		approverId: assignment.approverEmployeeId,
		requesterEmployeeId: workflow.requesterEmployeeId,
		status: assignment.status as ApprovalInboxStatus,
		workflowKind: workflow.workflowType as TimeApprovalKind,
	};
}

async function toPersistedDecisionRequest(
	request: {
		id: string;
		entityType: string;
		entityId: string;
		organizationId: string;
		approverId: string;
		requestedBy: string;
		status: string;
		metadata?: unknown;
		reason?: string | null;
	},
	database: typeof db,
): Promise<PersistedApprovalRequestForDecision> {
	let workflowKind: TimeApprovalKind | null = null;
	if (request.entityType === "time_entry") {
		const period = await database.query.workPeriod.findFirst({
			where: and(
				eq(workPeriod.id, request.entityId),
				eq(workPeriod.organizationId, request.organizationId),
				eq(workPeriod.employeeId, request.requestedBy),
			),
			columns: {
				pendingChanges: true,
				clockInId: true,
				clockOutId: true,
			},
		});
		workflowKind = period
			? classifyTimeApprovalRequest({
					metadata: request.metadata,
					reason: request.reason,
					pendingChanges: period.pendingChanges,
				})
			: "unclassified";
		if (period && workflowKind === "unclassified") {
			const endpointIds = [period.clockInId, period.clockOutId].filter(
				(id): id is string => Boolean(id),
			);
			const correctionEvidence = endpointIds.length
				? await database.query.timeEntry.findFirst({
						where: and(
							eq(timeEntry.organizationId, request.organizationId),
							eq(timeEntry.employeeId, request.requestedBy),
							eq(timeEntry.type, "correction"),
							eq(timeEntry.isSuperseded, false),
							inArray(timeEntry.replacesEntryId, endpointIds),
						),
						columns: { id: true },
					})
				: null;
			workflowKind = classifyTimeApprovalRequest({
				metadata: request.metadata,
				reason: request.reason,
				pendingChanges: period.pendingChanges,
				hasRelationalCorrectionEvidence: Boolean(correctionEvidence),
			});
		}
	}
	return {
		id: request.id,
		targetType: "compatibility_request",
		entityType: request.entityType,
		entityId: request.entityId,
		organizationId: request.organizationId,
		approverId: request.approverId,
		requesterEmployeeId: request.requestedBy,
		status: request.status as ApprovalInboxStatus,
		workflowKind,
	};
}

function assertCanDecideRequest({
	request,
	actorEmployeeId,
	includeAllApprovers,
	eligibleApprovalScopes,
}: {
	request: PersistedApprovalRequestForDecision;
	actorEmployeeId: string;
} & DecisionVisibilityInput): void {
	if (
		canDecideRequest({
			request,
			actorEmployeeId,
			includeAllApprovers,
			eligibleApprovalScopes,
		})
	) {
		return;
	}

	throw new NotFoundError({
		message: "Approval not found",
		entityType: "approval_request",
		entityId: request.id,
	});
}

function canDecideRequest({
	request,
	actorEmployeeId,
	includeAllApprovers,
	eligibleApprovalScopes,
}: {
	request: PersistedApprovalRequestForDecision;
	actorEmployeeId: string;
} & DecisionVisibilityInput): boolean {
	if (request.approverId === actorEmployeeId || includeAllApprovers === true) {
		return true;
	}

	return (
		eligibleApprovalScopes?.some(
			(scope) =>
				scope.requesterEmployeeId === request.requesterEmployeeId &&
				scope.eligibleApproverIds.includes(actorEmployeeId) &&
				scope.eligibleApproverIds.includes(request.approverId),
		) ?? false
	);
}

function extractEffectError(cause: Cause.Cause<unknown>): unknown {
	return (
		Option.getOrNull(Cause.failureOption(cause)) ??
		[...Cause.defects(cause)][0] ??
		cause
	);
}

function mapDecisionFailure(
	id: string,
	error: unknown,
): ApprovalInboxDecisionFailure {
	const message =
		error instanceof Error ? error.message : getErrorMessage(error);
	const tag =
		error && typeof error === "object" && "_tag" in error
			? String(error._tag)
			: null;
	const normalizedMessage = message.toLowerCase();
	const hasStaleMessage = isStaleDecisionMessage(normalizedMessage);
	const hasAuthorizationMessage =
		isAuthorizationFailureMessage(normalizedMessage);

	if (message.startsWith("Unsupported approval type")) {
		return { id, code: "unsupported", message };
	}

	if (
		(hasStaleMessage && !hasAuthorizationMessage) ||
		tag === "ConflictError"
	) {
		return { id, code: "stale", message };
	}

	if (tag === "NotFoundError") {
		return { id, code: "not_found", message: "Approval not found" };
	}

	if (tag === "ValidationError") {
		return { id, code: "validation_failed", message };
	}

	if (
		hasAuthorizationMessage ||
		tag === "AuthorizationError" ||
		tag === "AuthenticationError" ||
		tag === "AppAccessDeniedError"
	) {
		return {
			id,
			code: "forbidden",
			message: getSafeAuthorizationMessage(message),
		};
	}

	logger.error(
		{ error, approvalId: id },
		"Approval inbox bulk decision failed",
	);
	return { id, code: "validation_failed", message: "Approval decision failed" };
}

function getSafeAuthorizationMessage(message: string): string {
	return message === "You are not authorized to decide this request"
		? message
		: "You are not authorized to decide this request";
}

function isStaleDecisionMessage(message: string): boolean {
	return (
		message.includes("already") ||
		message.includes("already processed") ||
		message.includes("processed") ||
		message.includes("non-pending")
	);
}

function isAuthorizationFailureMessage(message: string): boolean {
	return (
		message.includes("not authorized") ||
		message.includes("forbidden") ||
		message.includes("access denied") ||
		message.includes("not the approver")
	);
}

function getErrorMessage(error: unknown): string {
	if (
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}

	return "Approval decision failed";
}
