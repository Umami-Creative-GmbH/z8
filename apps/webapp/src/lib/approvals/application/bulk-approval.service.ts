/**
 * Bulk Approval Service
 *
 * Handles bulk approval operations with transaction support.
 */

import { Context, Effect, Layer } from "effect";
import { getApprovalHandler } from "../domain/registry";
import type {
	ApprovalDecisionAction,
	ApprovalType,
	BulkDecisionFailure,
	BulkDecisionResult,
} from "../domain/types";
import {
	type AnyAppError,
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { approvalRequest } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { ApprovalAuditLoggerLive } from "../infrastructure/audit-logger";

const BULK_DECISION_NOT_FOUND_MESSAGE = "Approval request not found";

export function mapBulkDecisionError(id: string, error: unknown): BulkDecisionFailure {
	if (error instanceof ConflictError) {
		return {
			id,
			code: "stale",
			message: error.message,
		};
	}

	if (error instanceof AuthorizationError) {
		return {
			id,
			code: "forbidden",
			message: error.message,
		};
	}

	if (error instanceof NotFoundError) {
		return {
			id,
			code: "not_found",
			message: error.message,
		};
	}

	if (error instanceof ValidationError) {
		return {
			id,
			code: "validation_failed",
			message: error.message,
		};
	}

	return {
		id,
		code: "validation_failed",
		message: error instanceof Error ? error.message : String(error),
	};
}

// ============================================
// SERVICE DEFINITION
// ============================================

export class BulkApprovalService extends Context.Tag("BulkApprovalService")<
	BulkApprovalService,
	{
		/**
		 * Execute a shared bulk decision across multiple approvals.
		 */
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		readonly bulkDecide: (
			approvalIds: string[],
			approverId: string,
			organizationId: string,
			action: ApprovalDecisionAction,
			reason?: string,
			actorUserId?: string,
		) => Effect.Effect<BulkDecisionResult, AnyAppError, any>;
	}
>() {}

// ============================================
// LIVE IMPLEMENTATION
// ============================================

export const BulkApprovalServiceLive = Layer.effect(
	BulkApprovalService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return BulkApprovalService.of({
			bulkDecide: (approvalIds, approverId, organizationId, action, reason, actorUserId) =>
				Effect.gen(function* (_) {
					const result: BulkDecisionResult = {
						succeeded: [],
						failed: [],
					};

					// Fetch all approval requests to get their types
					const requests = yield* _(
						dbService.query("getBulkApprovalRequests", async () => {
							return await dbService.db.query.approvalRequest.findMany({
								where: inArray(approvalRequest.id, approvalIds),
							});
						}),
					);

					const requestsById = new Map(requests.map((request) => [request.id, request]));

					// Validate all requests belong to this approver and organization
					for (const approvalId of approvalIds) {
						const request = requestsById.get(approvalId);

						if (!request) {
							result.failed.push({
								id: approvalId,
								code: "not_found",
								message: BULK_DECISION_NOT_FOUND_MESSAGE,
							});
							continue;
						}

						if (request.approverId !== approverId) {
							result.failed.push({
								id: request.id,
								code: "forbidden",
								message: "You are not authorized to decide this request",
							});
							continue;
						}

						if (request.organizationId !== organizationId) {
							result.failed.push({
								id: request.id,
								code: "forbidden",
								message: "Request belongs to a different organization",
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

						// Get handler for this type
						const handler = getApprovalHandler(request.entityType as ApprovalType);

						if (!handler) {
							result.failed.push({
								id: request.id,
								code: "unsupported",
								message: `Unknown approval type: ${request.entityType}`,
							});
							continue;
						}

						if (!handler.supportsBulkApprove) {
							result.failed.push({
								id: request.id,
								code: "unsupported",
								message: `Bulk ${action} not supported for ${handler.displayName}`,
							});
							continue;
						}

						const decisionEffect =
							action === "approve"
								? handler.approve(request.entityId, approverId)
								: handler.reject(request.entityId, approverId, reason ?? "Rejected in bulk");

						const decisionResult = yield* _(
							decisionEffect.pipe(
								Effect.map(() => ({ success: true as const })),
								Effect.catchAll((error) =>
									Effect.succeed({
										success: false as const,
										failure: mapBulkDecisionError(request.id, error),
									}),
								),
							),
						);

						if (decisionResult.success) {
							result.succeeded.push({
								id: request.id,
								approvalType: request.entityType as ApprovalType,
								status: action === "approve" ? "approved" : "rejected",
							});
						} else {
							result.failed.push(decisionResult.failure);
						}
					}

					return result;
				}),
		});
	}),
).pipe(Layer.provideMerge(ApprovalAuditLoggerLive), Layer.provide(DatabaseServiceLive));
