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
	ApprovalPriority,
	ApprovalQueryParams,
	ApprovalType,
	PaginatedApprovalResult,
	UnifiedApprovalItem,
} from "../domain/types";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import type { AnyAppError } from "@/lib/effect/errors";

interface ApprovalCursor {
	priority: ApprovalPriority;
	createdAt: string;
	id: string;
}

interface LegacyApprovalCursor {
	createdAt: string;
}

const ZERO_APPROVAL_COUNTS: Record<ApprovalType, number> = {
	absence_entry: 0,
	time_entry: 0,
	shift_request: 0,
	travel_expense_claim: 0,
};

function compareApprovalItems(a: UnifiedApprovalItem, b: UnifiedApprovalItem) {
	const priorityDiff = comparePriority(a.priority, b.priority);
	if (priorityDiff !== 0) {
		return priorityDiff;
	}

	const createdAtDiff = b.createdAt.getTime() - a.createdAt.getTime();
	if (createdAtDiff !== 0) {
		return createdAtDiff;
	}

	return a.id.localeCompare(b.id);
}

function parseApprovalCursor(cursor: string): ApprovalCursor | LegacyApprovalCursor | null {
	try {
		const parsed = JSON.parse(cursor) as Partial<ApprovalCursor>;
		if (
			typeof parsed.priority === "string" &&
			typeof parsed.createdAt === "string" &&
			typeof parsed.id === "string"
		) {
			return {
				priority: parsed.priority as ApprovalPriority,
				createdAt: parsed.createdAt,
				id: parsed.id,
			};
		}
	} catch {
		// Legacy cursors are plain ISO timestamps.
	}

	const createdAt = new Date(cursor);
	if (Number.isNaN(createdAt.getTime())) {
		return null;
	}

	return {
		createdAt: createdAt.toISOString(),
	};
}

function serializeApprovalCursor(item: UnifiedApprovalItem) {
	return JSON.stringify({
		priority: item.priority,
		createdAt: item.createdAt.toISOString(),
		id: item.id,
	} satisfies ApprovalCursor);
}

function isItemAfterCursor(item: UnifiedApprovalItem, cursor: ApprovalCursor | LegacyApprovalCursor) {
	if (!("id" in cursor)) {
		return item.createdAt.getTime() <= new Date(cursor.createdAt).getTime();
	}

	const cursorItem = {
		...item,
		priority: cursor.priority,
		createdAt: new Date(cursor.createdAt),
		id: cursor.id,
	};

	return compareApprovalItems(item, cursorItem) > 0;
}

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
					allItems.sort(compareApprovalItems);

					// Apply cursor pagination after sorting
					let paginatedItems = allItems;

					if (params.cursor) {
						const cursor = parseApprovalCursor(params.cursor);
						if (cursor) {
							paginatedItems = allItems.filter((item) => isItemAfterCursor(item, cursor));
						}
					}

					// Limit results
					const hasMore = paginatedItems.length > params.limit;
					const items = paginatedItems.slice(0, params.limit);
					const nextCursor = hasMore ? serializeApprovalCursor(items[items.length - 1]) : null;

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
					const counts = { ...ZERO_APPROVAL_COUNTS };

					for (const handler of handlers) {
						const count = yield* _(handler.getCount(approverId, organizationId));
						counts[handler.type] = count;
					}

					return counts;
				}),
		});
	}),
).pipe(Layer.provide(DatabaseServiceLive));
