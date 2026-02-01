/**
 * Unified Approval Query Service
 *
 * Provides unified querying across all approval types with filtering,
 * sorting, and cursor-based pagination.
 */

import { Context, Effect, Layer } from "effect";
import { getAllApprovalHandlers } from "../domain/registry";
import { comparePriority } from "../domain/sla-calculator";
import type {
	ApprovalQueryParams,
	ApprovalType,
	PaginatedApprovalResult,
	UnifiedApprovalItem,
} from "../domain/types";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import type { AnyAppError } from "@/lib/effect/errors";

// ============================================
// SERVICE DEFINITION
// ============================================

export class ApprovalQueryService extends Context.Tag("ApprovalQueryService")<
	ApprovalQueryService,
	{
		/**
		 * Get unified approvals with pagination and filtering.
		 */
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		readonly getApprovals: (
			params: ApprovalQueryParams,
		) => Effect.Effect<PaginatedApprovalResult, AnyAppError, any>;

		/**
		 * Get total counts per approval type.
		 */
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		readonly getCounts: (
			approverId: string,
			organizationId: string,
		) => Effect.Effect<Record<ApprovalType, number>, AnyAppError, any>;
	}
>() {}

// ============================================
// LIVE IMPLEMENTATION
// ============================================

export const ApprovalQueryServiceLive = Layer.effect(
	ApprovalQueryService,
	Effect.gen(function* (_) {
		return ApprovalQueryService.of({
			getApprovals: (params) =>
				Effect.gen(function* (_) {
					const handlers = getAllApprovalHandlers();

					// Filter handlers by type if specified
					const activeHandlers = params.types
						? handlers.filter((h) => params.types?.includes(h.type))
						: handlers;

					// Fetch approvals from all active handlers in parallel
					const allItems: UnifiedApprovalItem[] = [];

					for (const handler of activeHandlers) {
						const items = yield* _(handler.getApprovals(params));
						allItems.push(...items);
					}

					// Sort by priority (ascending: urgent first) then by createdAt (descending: newest first)
					allItems.sort((a, b) => {
						const priorityDiff = comparePriority(a.priority, b.priority);
						if (priorityDiff !== 0) return priorityDiff;
						return b.createdAt.getTime() - a.createdAt.getTime();
					});

					// Apply cursor pagination after sorting
					let paginatedItems = allItems;

					if (params.cursor) {
						const cursorDate = new Date(params.cursor);
						const cursorIndex = allItems.findIndex(
							(item) => item.createdAt.getTime() < cursorDate.getTime(),
						);
						if (cursorIndex >= 0) {
							paginatedItems = allItems.slice(cursorIndex);
						}
					}

					// Limit results
					const hasMore = paginatedItems.length > params.limit;
					const items = paginatedItems.slice(0, params.limit);
					const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

					return {
						items,
						nextCursor,
						hasMore,
						total: allItems.length,
					};
				}),

			getCounts: (approverId, organizationId) =>
				Effect.gen(function* (_) {
					const handlers = getAllApprovalHandlers();
					const counts: Partial<Record<ApprovalType, number>> = {};

					for (const handler of handlers) {
						const count = yield* _(handler.getCount(approverId, organizationId));
						counts[handler.type] = count;
					}

					return counts as Record<ApprovalType, number>;
				}),
		});
	}),
).pipe(Layer.provide(DatabaseServiceLive));
