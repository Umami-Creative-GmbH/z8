/**
 * Base Handler Utilities
 *
 * Shared utilities for approval handlers to reduce code duplication
 * and optimize database queries.
 */

import { and, count, desc, eq, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { Effect } from "effect";
import { approvalRequest } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { ApprovalQueryParams, ApprovalType, UnifiedApprovalItem } from "../domain/types";
import { calculateSLAStatus } from "../domain/sla-calculator";
import type { AnyAppError } from "@/lib/effect/errors";

/**
 * Configuration for building approval request queries
 */
interface ApprovalQueryConfig<TEntity> {
	entityType: ApprovalType;
	params: ApprovalQueryParams;
	/**
	 * Batch fetch entities by their IDs
	 * This is the key optimization - fetching all entities in one query
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	fetchEntitiesByIds: (entityIds: string[]) => Effect.Effect<Map<string, TEntity>, AnyAppError, any>;
	/**
	 * Transform an entity to UnifiedApprovalItem
	 */
	transformToItem: (
		request: ApprovalRequestRow,
		entity: TEntity,
	) => UnifiedApprovalItem | null;
	/**
	 * Optional filter to apply after fetching entities
	 */
	filterEntity?: (entity: TEntity, params: ApprovalQueryParams) => boolean;
}

/**
 * Type for approval request row with requester relation
 */
export interface ApprovalRequestRow {
	id: string;
	entityType: ApprovalType;
	entityId: string;
	approverId: string;
	organizationId: string;
	status: "pending" | "approved" | "rejected";
	createdAt: Date;
	approvedAt: Date | null;
	rejectionReason: string | null;
	requester: {
		id: string;
		userId: string;
		teamId: string | null;
		user: {
			id: string;
			name: string;
			email: string;
			image: string | null;
		};
	};
}

/**
 * Build base conditions for approval request queries
 */
export function buildBaseConditions(
	entityType: ApprovalType,
	params: ApprovalQueryParams,
) {
	const conditions = [
		eq(approvalRequest.entityType, entityType),
		eq(approvalRequest.approverId, params.approverId),
		eq(approvalRequest.organizationId, params.organizationId),
		eq(approvalRequest.status, params.status || "pending"),
	];

	// Add cursor condition for pagination
	if (params.cursor) {
		conditions.push(lte(approvalRequest.createdAt, new Date(params.cursor)));
	}

	// Add age filter
	if (params.minAgeDays) {
		const cutoffDate = DateTime.now().minus({ days: params.minAgeDays }).toJSDate();
		conditions.push(lte(approvalRequest.createdAt, cutoffDate));
	}

	return conditions;
}

/**
 * Optimized approval fetching using batch entity loading
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fetchApprovals<TEntity>(
	config: ApprovalQueryConfig<TEntity>,
): Effect.Effect<UnifiedApprovalItem[], AnyAppError, any> {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const { entityType, params, fetchEntitiesByIds, transformToItem, filterEntity } = config;

		// Build filter conditions
		const conditions = buildBaseConditions(entityType, params);

		// Fetch approval requests
		const requests = yield* _(
			dbService.query(`get${entityType}Approvals`, async () => {
				return await dbService.db.query.approvalRequest.findMany({
					where: and(...conditions),
					with: {
						requester: {
							with: { user: true },
						},
					},
					orderBy: [desc(approvalRequest.createdAt)],
					// Fetch more than limit to account for filtering
					limit: params.limit * 3,
				});
			}),
		);

		if (requests.length === 0) {
			return [];
		}

		// Batch fetch all entities at once (fixes N+1 query problem)
		const entityIds = requests.map((r) => r.entityId);
		const entitiesMap = yield* _(fetchEntitiesByIds(entityIds));

		// Transform and filter
		const items: UnifiedApprovalItem[] = [];

		for (const request of requests) {
			if (items.length >= params.limit) break;

			const entity = entitiesMap.get(request.entityId);
			if (!entity) continue;

			// Apply custom filter if provided
			if (filterEntity && !filterEntity(entity, params)) {
				continue;
			}

			const item = transformToItem(request as ApprovalRequestRow, entity);
			if (item) {
				// Apply priority filter
				if (params.priority && item.priority !== params.priority) {
					continue;
				}
				items.push(item);
			}
		}

		return items;
	});
}

/**
 * Get approval count for a specific entity type
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getApprovalCount(
	entityType: ApprovalType,
	approverId: string,
	organizationId: string,
): Effect.Effect<number, AnyAppError, any> {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		const result = yield* _(
			dbService.query(`get${entityType}Count`, async () => {
				return await dbService.db
					.select({ count: count() })
					.from(approvalRequest)
					.where(
						and(
							eq(approvalRequest.entityType, entityType),
							eq(approvalRequest.approverId, approverId),
							eq(approvalRequest.organizationId, organizationId),
							eq(approvalRequest.status, "pending"),
						),
					);
			}),
		);

		return result[0]?.count ?? 0;
	});
}

/**
 * Build SLA info for an approval item
 */
export function buildSLAInfo(slaDeadline: Date | null) {
	const slaResult = calculateSLAStatus(slaDeadline);
	return {
		deadline: slaDeadline,
		status: slaResult.status,
		hoursRemaining: slaResult.hoursRemaining,
	};
}
