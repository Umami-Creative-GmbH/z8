/**
 * Bulk Approval Service
 *
 * Handles bulk approval operations with transaction support.
 */

import { Context, Effect, Layer } from "effect";
import { getApprovalHandler } from "../domain/registry";
import type { ApprovalType, BulkApproveResult } from "../domain/types";
import { NotFoundError, AuthorizationError } from "@/lib/effect/errors";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { approvalRequest } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

// ============================================
// SERVICE DEFINITION
// ============================================

export class BulkApprovalService extends Context.Tag("BulkApprovalService")<
	BulkApprovalService,
	{
		/**
		 * Bulk approve multiple approvals.
		 * Only processes types that support bulk approve.
		 */
		readonly bulkApprove: (
			approvalIds: string[],
			approverId: string,
			organizationId: string,
		) => Effect.Effect<BulkApproveResult>;
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
			bulkApprove: (approvalIds, approverId, organizationId) =>
				Effect.gen(function* (_) {
					const succeeded: string[] = [];
					const failed: Array<{ id: string; error: string }> = [];

					// Fetch all approval requests to get their types
					const requests = yield* _(
						dbService.query("getBulkApprovalRequests", async () => {
							return await dbService.db.query.approvalRequest.findMany({
								where: inArray(approvalRequest.id, approvalIds),
							});
						}),
					);

					// Validate all requests belong to this approver and organization
					for (const request of requests) {
						if (request.approverId !== approverId) {
							failed.push({
								id: request.id,
								error: "You are not authorized to approve this request",
							});
							continue;
						}

						if (request.organizationId !== organizationId) {
							failed.push({
								id: request.id,
								error: "Request belongs to a different organization",
							});
							continue;
						}

						if (request.status !== "pending") {
							failed.push({
								id: request.id,
								error: `Request is already ${request.status}`,
							});
							continue;
						}

						// Get handler for this type
						const handler = getApprovalHandler(request.entityType as ApprovalType);

						if (!handler) {
							failed.push({
								id: request.id,
								error: `Unknown approval type: ${request.entityType}`,
							});
							continue;
						}

						if (!handler.supportsBulkApprove) {
							failed.push({
								id: request.id,
								error: `Bulk approve not supported for ${handler.displayName}`,
							});
							continue;
						}

						// Try to approve
						const result = yield* _(
							handler.approve(request.entityId, approverId).pipe(
								Effect.map(() => ({ success: true as const })),
								Effect.catchAll((error) =>
									Effect.succeed({
										success: false as const,
										error: error instanceof Error ? error.message : String(error),
									}),
								),
							),
						);

						if (result.success) {
							succeeded.push(request.id);
						} else {
							failed.push({
								id: request.id,
								error: result.error || "Unknown error",
							});
						}
					}

					// Check for missing IDs
					const foundIds = requests.map((r) => r.id);
					const missingIds = approvalIds.filter((id) => !foundIds.includes(id));
					for (const id of missingIds) {
						failed.push({
							id,
							error: "Approval request not found",
						});
					}

					return { succeeded, failed };
				}),
		});
	}),
).pipe(Layer.provide(DatabaseServiceLive));
