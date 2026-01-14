/**
 * Audit Log Query Functions
 *
 * Functions to retrieve and filter audit logs from the database.
 * Supports pagination, filtering by entity type, date range, and user.
 */

import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { auditLog } from "@/db/schema";

export interface AuditLogFilters {
	organizationId: string;
	entityType?: string;
	entityId?: string;
	performedBy?: string;
	action?: string;
	startDate?: Date;
	endDate?: Date;
	search?: string;
	limit?: number;
	offset?: number;
}

export interface AuditLogResult {
	id: string;
	entityType: string;
	entityId: string;
	action: string;
	performedBy: string;
	performedByName?: string;
	performedByEmail?: string;
	employeeId: string | null;
	changes: Record<string, unknown> | null;
	metadata: Record<string, unknown> | null;
	ipAddress: string | null;
	userAgent: string | null;
	timestamp: Date;
}

/**
 * Get paginated audit logs with filters
 */
export async function getAuditLogs(filters: AuditLogFilters): Promise<{
	logs: AuditLogResult[];
	total: number;
	hasMore: boolean;
}> {
	const limit = filters.limit || 50;
	const offset = filters.offset || 0;

	// Build where conditions
	const conditions = [];

	// Organization filter (from metadata)
	conditions.push(sql`${auditLog.metadata}::jsonb->>'organizationId' = ${filters.organizationId}`);

	if (filters.entityType) {
		conditions.push(eq(auditLog.entityType, filters.entityType));
	}

	if (filters.entityId) {
		conditions.push(eq(auditLog.entityId, filters.entityId));
	}

	if (filters.performedBy) {
		conditions.push(eq(auditLog.performedBy, filters.performedBy));
	}

	if (filters.action) {
		conditions.push(like(auditLog.action, `%${filters.action}%`));
	}

	if (filters.startDate) {
		conditions.push(gte(auditLog.timestamp, filters.startDate));
	}

	if (filters.endDate) {
		conditions.push(lte(auditLog.timestamp, filters.endDate));
	}

	if (filters.search) {
		conditions.push(
			or(
				like(auditLog.action, `%${filters.search}%`),
				sql`${auditLog.metadata}::text ILIKE ${`%${filters.search}%`}`,
				sql`${auditLog.changes}::text ILIKE ${`%${filters.search}%`}`,
			),
		);
	}

	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	// Get total count
	const countResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(auditLog)
		.where(whereClause);
	const total = countResult[0]?.count || 0;

	// Get paginated results with user info
	const logs = await db
		.select({
			id: auditLog.id,
			entityType: auditLog.entityType,
			entityId: auditLog.entityId,
			action: auditLog.action,
			performedBy: auditLog.performedBy,
			performedByName: user.name,
			performedByEmail: user.email,
			employeeId: auditLog.employeeId,
			changes: auditLog.changes,
			metadata: auditLog.metadata,
			ipAddress: auditLog.ipAddress,
			userAgent: auditLog.userAgent,
			timestamp: auditLog.timestamp,
		})
		.from(auditLog)
		.leftJoin(user, eq(auditLog.performedBy, user.id))
		.where(whereClause)
		.orderBy(desc(auditLog.timestamp))
		.limit(limit)
		.offset(offset);

	return {
		logs: logs.map((log) => ({
			...log,
			performedByName: log.performedByName ?? undefined,
			performedByEmail: log.performedByEmail ?? undefined,
			changes: log.changes ? JSON.parse(log.changes as string) : null,
			metadata: log.metadata ? JSON.parse(log.metadata as string) : null,
		})),
		total,
		hasMore: offset + logs.length < total,
	};
}

/**
 * Get audit trail for a specific user
 */
export async function getUserAuditTrail(
	userId: string,
	organizationId: string,
	options?: {
		limit?: number;
		offset?: number;
		startDate?: Date;
		endDate?: Date;
	},
): Promise<AuditLogResult[]> {
	const result = await getAuditLogs({
		organizationId,
		performedBy: userId,
		limit: options?.limit,
		offset: options?.offset,
		startDate: options?.startDate,
		endDate: options?.endDate,
	});
	return result.logs;
}

/**
 * Get audit history for a specific entity
 */
export async function getEntityAuditHistory(
	entityId: string,
	organizationId: string,
	options?: {
		limit?: number;
		offset?: number;
	},
): Promise<AuditLogResult[]> {
	const result = await getAuditLogs({
		organizationId,
		entityId,
		limit: options?.limit,
		offset: options?.offset,
	});
	return result.logs;
}

/**
 * Get recent audit logs (last N entries)
 */
export async function getRecentAuditLogs(
	organizationId: string,
	limit: number = 20,
): Promise<AuditLogResult[]> {
	const result = await getAuditLogs({
		organizationId,
		limit,
	});
	return result.logs;
}

/**
 * Get audit log statistics for a date range
 */
export async function getAuditLogStats(
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<{
	totalEvents: number;
	byAction: Array<{ action: string; count: number }>;
	byEntityType: Array<{ entityType: string; count: number }>;
	byUser: Array<{ userId: string; userName: string; count: number }>;
	topIpAddresses: Array<{ ipAddress: string; count: number }>;
}> {
	const orgFilter = sql`${auditLog.metadata}::jsonb->>'organizationId' = ${organizationId}`;
	const dateFilter = and(gte(auditLog.timestamp, startDate), lte(auditLog.timestamp, endDate));
	const whereClause = and(orgFilter, dateFilter);

	// Total events
	const totalResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(auditLog)
		.where(whereClause);
	const totalEvents = totalResult[0]?.count || 0;

	// By action
	const byActionResult = await db
		.select({
			action: auditLog.action,
			count: sql<number>`count(*)::int`,
		})
		.from(auditLog)
		.where(whereClause)
		.groupBy(auditLog.action)
		.orderBy(desc(sql`count(*)`))
		.limit(10);

	// By entity type
	const byEntityTypeResult = await db
		.select({
			entityType: auditLog.entityType,
			count: sql<number>`count(*)::int`,
		})
		.from(auditLog)
		.where(whereClause)
		.groupBy(auditLog.entityType)
		.orderBy(desc(sql`count(*)`));

	// By user
	const byUserResult = await db
		.select({
			userId: auditLog.performedBy,
			userName: user.name,
			count: sql<number>`count(*)::int`,
		})
		.from(auditLog)
		.leftJoin(user, eq(auditLog.performedBy, user.id))
		.where(whereClause)
		.groupBy(auditLog.performedBy, user.name)
		.orderBy(desc(sql`count(*)`))
		.limit(10);

	// Top IP addresses
	const topIpResult = await db
		.select({
			ipAddress: auditLog.ipAddress,
			count: sql<number>`count(*)::int`,
		})
		.from(auditLog)
		.where(and(whereClause, sql`${auditLog.ipAddress} IS NOT NULL`))
		.groupBy(auditLog.ipAddress)
		.orderBy(desc(sql`count(*)`))
		.limit(10);

	return {
		totalEvents,
		byAction: byActionResult,
		byEntityType: byEntityTypeResult,
		byUser: byUserResult.map((r) => ({
			userId: r.userId,
			userName: r.userName || "Unknown",
			count: r.count,
		})),
		topIpAddresses: topIpResult.map((r) => ({
			ipAddress: r.ipAddress || "Unknown",
			count: r.count,
		})),
	};
}

/**
 * Search audit logs by text
 */
export async function searchAuditLogs(
	organizationId: string,
	searchTerm: string,
	options?: {
		limit?: number;
		offset?: number;
	},
): Promise<AuditLogResult[]> {
	const result = await getAuditLogs({
		organizationId,
		search: searchTerm,
		limit: options?.limit,
		offset: options?.offset,
	});
	return result.logs;
}

/**
 * Get audit logs by action type
 */
export async function getAuditLogsByAction(
	organizationId: string,
	action: string,
	options?: {
		limit?: number;
		offset?: number;
		startDate?: Date;
		endDate?: Date;
	},
): Promise<AuditLogResult[]> {
	const result = await getAuditLogs({
		organizationId,
		action,
		limit: options?.limit,
		offset: options?.offset,
		startDate: options?.startDate,
		endDate: options?.endDate,
	});
	return result.logs;
}

/**
 * Export audit logs for compliance reports
 */
export async function exportAuditLogs(
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<AuditLogResult[]> {
	// Get all logs in date range (no pagination for export)
	const result = await getAuditLogs({
		organizationId,
		startDate,
		endDate,
		limit: 10000, // Reasonable max for export
	});
	return result.logs;
}
