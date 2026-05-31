import { and, eq, inArray } from "drizzle-orm";
import { Cause, Effect, Exit, Option } from "effect";
import { db } from "@/db";
import { approvalRequest } from "@/db/schema";
import type { ApprovalActionOptions, ApprovalTypeHandler } from "@/lib/approvals/domain/types";
import { ApprovalAuditLoggerLive } from "@/lib/approvals/infrastructure/audit-logger";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runtime } from "@/lib/effect/runtime";
import { createLogger } from "@/lib/logger";
import { getSupportedInboxHandler, isSupportedInboxType } from "./source-adapters";
import type {
	ApprovalInboxBulkDecisionResult,
	ApprovalInboxDecisionFailure,
	ApprovalInboxDecisionSuccess,
	ApprovalInboxStatus,
} from "./types";

type InboxDecisionAction = "approve" | "reject";
type DecisionEffectRunner = (
	effect: Effect.Effect<void, unknown, unknown>,
) => Promise<Exit.Exit<void, unknown>>;
type EligibleApprovalScope = {
	requesterEmployeeId: string;
	eligibleApproverIds: string[];
};
type DecisionVisibilityInput = {
	includeAllApprovers?: boolean;
	eligibleApprovalScopes?: EligibleApprovalScope[];
};

const defaultDecisionEffectRunner: DecisionEffectRunner = (effect) =>
	runtime.runPromiseExit(effect.pipe(Effect.provide(ApprovalAuditLoggerLive)));
const logger = createLogger("ApprovalInboxDecisionService");

export interface PersistedApprovalRequestForDecision {
	id: string;
	entityType: string;
	entityId: string;
	organizationId: string;
	approverId: string;
	requesterEmployeeId: string;
	status: ApprovalInboxStatus;
}

export async function decideApprovalInboxItemFromRequest({
	request,
	actorEmployeeId,
	action,
	reason,
	handler,
	runEffect = defaultDecisionEffectRunner,
}: {
	request: PersistedApprovalRequestForDecision;
	actorEmployeeId: string;
	action: InboxDecisionAction;
	reason?: string;
	handler: ApprovalTypeHandler;
	runEffect?: DecisionEffectRunner;
}): Promise<ApprovalInboxDecisionSuccess> {
	if (!isSupportedInboxType(request.entityType)) {
		throw new Error(`Unsupported approval type: ${request.entityType}`);
	}

	if (handler.type !== request.entityType) {
		throw new Error(`Unsupported approval type: ${request.entityType}`);
	}

	if (request.status !== "pending") {
		throw new Error(`Request is already ${request.status}`);
	}

	const trimmedReason = reason?.trim();
	if (action === "reject" && !trimmedReason) {
		throw new Error("Rejection reason is required");
	}
	const actionOptions: ApprovalActionOptions | undefined =
		actorEmployeeId === request.approverId
			? undefined
			: { approvalRequestId: request.id, allowAnyApprover: true };

	const effect =
		action === "approve"
			? handler.approve(request.entityId, actorEmployeeId, actionOptions)
			: handler.reject(request.entityId, actorEmployeeId, trimmedReason ?? "", actionOptions);
	const exit = await runEffect(effect);

	return Exit.match(exit, {
		onFailure: (cause) => {
			throw extractEffectError(cause);
		},
		onSuccess: () => ({
			id: request.id,
			type: request.entityType,
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

	for (const request of requests) {
		const handler = resolveHandler(request.entityType);

		if (!handler || !isSupportedInboxType(request.entityType) || handler.type !== request.entityType) {
			result.failed.push({
				id: request.id,
				code: "unsupported",
				message: `Unsupported approval type: ${request.entityType}`,
			});
			continue;
		}

		if (request.status !== "pending") {
			result.failed.push({
				id: request.id,
				code: "stale",
				message: `Request is already ${request.status}`,
			});
			continue;
		}

		if (
			!canDecideRequest({
				request,
				actorEmployeeId,
				includeAllApprovers,
				eligibleApprovalScopes,
			})
		) {
			result.failed.push({
				id: request.id,
				code: "forbidden",
				message: "You are not authorized to decide this request",
			});
			continue;
		}

		try {
			result.succeeded.push(
				await decideApprovalInboxItemFromRequest({
					request,
					actorEmployeeId,
					action,
					reason,
					handler,
					runEffect,
				}),
			);
		} catch (error) {
			result.failed.push(mapDecisionFailure(request.id, error));
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
	const request = await loadDecisionRequest(approvalId, organizationId);
	assertCanDecideRequest({ request, actorEmployeeId, includeAllApprovers, eligibleApprovalScopes });
	const handler = getSupportedInboxHandler(request.entityType);
	if (!handler) {
		throw new Error(`Unsupported approval type: ${request.entityType}`);
	}

	return decideApprovalInboxItemFromRequest({
		request,
		actorEmployeeId,
		action: "approve",
		handler,
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
	const request = await loadDecisionRequest(approvalId, organizationId);
	assertCanDecideRequest({ request, actorEmployeeId, includeAllApprovers, eligibleApprovalScopes });
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
	const requests = await loadDecisionRequests(approvalIds, organizationId);
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
	const requests = await loadDecisionRequests(approvalIds, organizationId);
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
	const requestedOrder = new Map(approvalIds.map((approvalId, index) => [approvalId, index]));
	const failed = [...result.failed];

	for (const approvalId of approvalIds) {
		if (foundIds.has(approvalId)) {
			continue;
		}

		failed.push({ id: approvalId, code: "not_found", message: "Approval not found" });
	}

	failed.sort((first, second) => {
		return (requestedOrder.get(first.id) ?? Number.MAX_SAFE_INTEGER) - (requestedOrder.get(second.id) ?? Number.MAX_SAFE_INTEGER);
	});

	return { succeeded: result.succeeded, failed };
}

async function loadDecisionRequest(
	approvalId: string,
	organizationId: string,
): Promise<PersistedApprovalRequestForDecision> {
	const request = await db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, approvalId),
			eq(approvalRequest.organizationId, organizationId),
		),
	});

	if (!request) {
		throw new NotFoundError({
			message: "Approval not found",
			entityType: "approval_request",
			entityId: approvalId,
		});
	}

	return toPersistedDecisionRequest(request);
}

async function loadDecisionRequests(
	approvalIds: string[],
	organizationId: string,
): Promise<PersistedApprovalRequestForDecision[]> {
	if (approvalIds.length === 0) {
		return [];
	}

	const requests = await db.query.approvalRequest.findMany({
		where: and(
			inArray(approvalRequest.id, approvalIds),
			eq(approvalRequest.organizationId, organizationId),
		),
	});
	const requestsById = new Map(requests.map((request) => [request.id, request]));

	return approvalIds
		.map((approvalId) => requestsById.get(approvalId))
		.filter((request): request is NonNullable<typeof request> => Boolean(request))
		.map(toPersistedDecisionRequest);
}

function toPersistedDecisionRequest(request: {
	id: string;
	entityType: string;
	entityId: string;
	organizationId: string;
	approverId: string;
	requestedBy: string;
	status: string;
}): PersistedApprovalRequestForDecision {
	return {
		id: request.id,
		entityType: request.entityType,
		entityId: request.entityId,
		organizationId: request.organizationId,
		approverId: request.approverId,
		requesterEmployeeId: request.requestedBy,
		status: request.status as ApprovalInboxStatus,
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
	if (canDecideRequest({ request, actorEmployeeId, includeAllApprovers, eligibleApprovalScopes })) {
		return;
	}

	throw new AuthorizationError({
		message: "You are not authorized to decide this request",
		resource: "Approval",
		action: "decide",
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
	return Option.getOrNull(Cause.failureOption(cause)) ?? [...Cause.defects(cause)][0] ?? cause;
}

function mapDecisionFailure(id: string, error: unknown): ApprovalInboxDecisionFailure {
	const message = error instanceof Error ? error.message : getErrorMessage(error);
	const tag = error && typeof error === "object" && "_tag" in error ? String(error._tag) : null;
	const normalizedMessage = message.toLowerCase();
	const hasStaleMessage = isStaleDecisionMessage(normalizedMessage);
	const hasAuthorizationMessage = isAuthorizationFailureMessage(normalizedMessage);

	if (message.startsWith("Unsupported approval type")) {
		return { id, code: "unsupported", message };
	}

	if ((hasStaleMessage && !hasAuthorizationMessage) || tag === "ConflictError") {
		return { id, code: "stale", message };
	}

	if (tag === "NotFoundError") {
		return { id, code: "not_found", message: "Approval not found" };
	}

	if (
		hasAuthorizationMessage ||
		tag === "AuthorizationError" ||
		tag === "AuthenticationError" ||
		tag === "AppAccessDeniedError"
	) {
		return { id, code: "forbidden", message: getSafeAuthorizationMessage(message) };
	}

	logger.error({ error, approvalId: id }, "Approval inbox bulk decision failed");
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
	if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
		return error.message;
	}

	return "Approval decision failed";
}
