"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	canManageCurrentOrganizationSettings,
	requireUser,
} from "@/lib/auth-helpers";
import {
	type AuditLogFilters,
	type AuditLogResult,
	exportAuditLogs,
	getAuditLogStats,
	getAuditLogs,
} from "@/lib/query/audit.queries";
import { resolveAuditDateRange } from "@/lib/query/audit-date-range";

export interface AuditLogResponse {
	success: boolean;
	data?: {
		logs: AuditLogResult[];
		total: number;
		hasMore: boolean;
	};
	error?: string;
}

export interface AuditStatsResponse {
	success: boolean;
	data?: {
		totalEvents: number;
		byAction: Array<{ action: string; count: number }>;
		byEntityType: Array<{ entityType: string; count: number }>;
		byUser: Array<{ userId: string; userName: string; count: number }>;
		topIpAddresses: Array<{ ipAddress: string; count: number }>;
	};
	error?: string;
}

async function requireAuditLogOrgAdmin() {
	const authContext = await requireUser();
	const organizationId = authContext.session.activeOrganizationId;

	if (!organizationId) {
		return { error: "No active organization" } as const;
	}

	if (!(await canManageCurrentOrganizationSettings())) {
		return { error: "Access denied. Admin role required." } as const;
	}

	const ownedOrganization = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { timezone: true },
	});
	if (!ownedOrganization) {
		return { error: "Organization not found" } as const;
	}

	return {
		organizationId,
		timezone: ownedOrganization.timezone ?? "UTC",
	} as const;
}

function dateFilters(
	startDate: string | undefined,
	endDate: string | undefined,
	timezone: string,
) {
	if (!startDate && !endDate) return {};
	if (!startDate || !endDate) {
		throw new RangeError(
			"Audit log date filters require both start and end dates",
		);
	}
	const range = resolveAuditDateRange(startDate, endDate, timezone);
	return { startDate: range.start, endDateExclusive: range.endExclusive };
}

/**
 * Get paginated audit logs
 * Requires admin role
 */
export async function getAuditLogsAction(filters: {
	entityType?: string;
	action?: string;
	performedBy?: string;
	startDate?: string;
	endDate?: string;
	search?: string;
	limit?: number;
	offset?: number;
}): Promise<AuditLogResponse> {
	try {
		const access = await requireAuditLogOrgAdmin();
		if ("error" in access) {
			return {
				success: false,
				error: access.error,
			};
		}

		const queryFilters: AuditLogFilters = {
			organizationId: access.organizationId,
			entityType: filters.entityType,
			action: filters.action,
			performedBy: filters.performedBy,
			...dateFilters(filters.startDate, filters.endDate, access.timezone),
			search: filters.search,
			limit: filters.limit || 50,
			offset: filters.offset || 0,
		};

		const result = await getAuditLogs(queryFilters);

		return {
			success: true,
			data: result,
		};
	} catch (error) {
		console.error("Failed to fetch audit logs:", error);
		return {
			success: false,
			error: "Failed to fetch audit logs",
		};
	}
}

/**
 * Get audit log statistics
 * Requires admin role
 */
export async function getAuditStatsAction(
	startDate: string,
	endDate: string,
): Promise<AuditStatsResponse> {
	try {
		const access = await requireAuditLogOrgAdmin();
		if ("error" in access) {
			return {
				success: false,
				error: access.error,
			};
		}

		const range = resolveAuditDateRange(startDate, endDate, access.timezone);
		const stats = await getAuditLogStats(
			access.organizationId,
			range.start,
			range.endExclusive,
			{ endExclusive: true },
		);

		return {
			success: true,
			data: stats,
		};
	} catch (error) {
		console.error("Failed to fetch audit stats:", error);
		return {
			success: false,
			error: "Failed to fetch audit statistics",
		};
	}
}

/**
 * Export audit logs as JSON for download
 * Requires admin role
 */
export async function exportAuditLogsAction(
	startDate: string,
	endDate: string,
): Promise<{ success: boolean; data?: AuditLogResult[]; error?: string }> {
	try {
		const access = await requireAuditLogOrgAdmin();
		if ("error" in access) {
			return {
				success: false,
				error: access.error,
			};
		}

		const range = resolveAuditDateRange(startDate, endDate, access.timezone);
		const logs = await exportAuditLogs(
			access.organizationId,
			range.start,
			range.endExclusive,
		);

		return {
			success: true,
			data: logs,
		};
	} catch (error) {
		console.error("Failed to export audit logs:", error);
		return {
			success: false,
			error: "Failed to export audit logs",
		};
	}
}
