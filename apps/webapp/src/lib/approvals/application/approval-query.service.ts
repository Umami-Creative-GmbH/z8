/**
 * Unified Approval Query Service
 *
 * Provides unified querying across all approval types with filtering,
 * sorting, and cursor-based pagination.
 */

import { Cause, Context, Effect, Layer } from "effect";
import type { AnyAppError } from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import { getAllApprovalHandlers } from "../domain/registry";
import { comparePriority } from "../domain/sla-calculator";
import type {
	ApprovalHandlerServices,
	ApprovalPriority,
	ApprovalQueryParams,
	ApprovalType,
	PaginatedApprovalResult,
	UnifiedApprovalItem,
} from "../domain/types";

const logger = createLogger("ApprovalQueryService");

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
	travel_expense_report: 0,
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

function isItemAfterCursor(
	item: UnifiedApprovalItem,
	cursor: ApprovalCursor | LegacyApprovalCursor,
) {
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

/**
 * The handlers read through `DatabaseService` (`ApprovalHandlerServices`);
 * the layer does not provide it, so run these effects on the shared runtime.
 */
export class ApprovalQueryService extends Context.Service<
	ApprovalQueryService,
	{
		/**
		 * Get unified approvals with pagination and filtering.
		 */
		readonly getApprovals: (
			params: ApprovalQueryParams,
		) => Effect.Effect<PaginatedApprovalResult, AnyAppError, ApprovalHandlerServices>;

		/**
		 * Get total counts per approval type.
		 */
		readonly getCounts: (
			approverId: string,
			organizationId: string,
			visibility?: Pick<ApprovalQueryParams, "eligibleApprovalScopes" | "includeAllApprovers">,
		) => Effect.Effect<Record<ApprovalType, number>, AnyAppError, ApprovalHandlerServices>;
	}
>()("ApprovalQueryService") {}

// ============================================
// LIVE IMPLEMENTATION
// ============================================

export const ApprovalQueryServiceLive = Layer.succeed(
	ApprovalQueryService,
	ApprovalQueryService.of({
		getApprovals: (params) =>
			Effect.gen(function* () {
				const handlers = getAllApprovalHandlers();
				const requestedTypeSet = params.types ? new Set(params.types) : null;

				// Filter handlers by type if specified
				const activeHandlers = requestedTypeSet
					? handlers.filter((h) => requestedTypeSet.has(h.type))
					: handlers;

				// Fetch approvals from all active handlers in parallel
				const allItems: UnifiedApprovalItem[] = [];

				for (const handler of activeHandlers) {
					const items = yield* handler.getApprovals(params).pipe(
						// One failing type must not empty the whole list. Typed failures
						// degrade quietly; defects (e.g. a missing service) are logged.
						Effect.catchCause((cause) =>
							Effect.sync(() => {
								if (Cause.hasDies(cause)) {
									logger.error(
										{
											approvalType: handler.type,
											organizationId: params.organizationId,
											cause: Cause.pretty(cause),
										},
										"Approval handler died while loading approvals",
									);
								}
								return [];
							}),
						),
					);
					allItems.push(...items);
				}

				const requesterEmployeeIds = params.requesterEmployeeIds;
				const requesterEmployeeIdSet = requesterEmployeeIds ? new Set(requesterEmployeeIds) : null;
				const filteredItems = requesterEmployeeIdSet
					? allItems.filter((item) => requesterEmployeeIdSet.has(item.requester.id))
					: allItems;

				// Sort by priority (ascending: urgent first) then by createdAt (descending: newest first)
				filteredItems.sort(compareApprovalItems);

				// Apply cursor pagination after sorting
				let paginatedItems = filteredItems;

				if (params.cursor) {
					const cursor = parseApprovalCursor(params.cursor);
					if (cursor) {
						paginatedItems = filteredItems.filter((item) => isItemAfterCursor(item, cursor));
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
					total: filteredItems.length,
				};
			}),

		getCounts: (approverId, organizationId, visibility) =>
			Effect.gen(function* () {
				const handlers = getAllApprovalHandlers();
				const counts = { ...ZERO_APPROVAL_COUNTS };

				for (const handler of handlers) {
					const count = yield* handler.getCount(approverId, organizationId, visibility);
					counts[handler.type] = count;
				}

				return counts;
			}),
	}),
);
