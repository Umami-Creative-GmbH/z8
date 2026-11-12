"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { organization } from "@/db/auth-schema";
import { NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import {
	type AuditLogFilters,
	type AuditLogResult,
	exportAuditLogs,
	getAuditLogStats,
	getAuditLogs,
} from "@/lib/query/audit.queries";
import { resolveAuditDateRange } from "@/lib/query/audit-date-range";

export interface AuditLogPage {
	logs: AuditLogResult[];
	total: number;
	hasMore: boolean;
}

export interface AuditStats {
	totalEvents: number;
	byAction: Array<{ action: string; count: number }>;
	byEntityType: Array<{ entityType: string; count: number }>;
	byUser: Array<{ userId: string; userName: string; count: number }>;
	topIpAddresses: Array<{ ipAddress: string; count: number }>;
}

const dateSchema = z.string().min(1, "Date is required");

const auditLogFiltersSchema = z.strictObject({
	entityType: z.string().optional(),
	action: z.string().optional(),
	performedBy: z.string().optional(),
	startDate: z.string().optional(),
	endDate: z.string().optional(),
	search: z.string().optional(),
	limit: z.number().int().positive().optional(),
	offset: z.number().int().nonnegative().optional(),
});

const dateRangeSchema = z.strictObject({ startDate: dateSchema, endDate: dateSchema });

/** The organization's timezone, which audit date filters are read in. */
function organizationTimezone(organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const row = yield* dbService.query("auditLog.organizationTimezone", () =>
			dbService.db.query.organization.findFirst({
				where: eq(organization.id, organizationId),
				columns: { timezone: true },
			}),
		);
		if (!row) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Organization not found",
					entityType: "organization",
					entityId: organizationId,
				}),
			);
		}
		return row.timezone ?? "UTC";
	});
}

/** Runs an audit query; a failure reaches the client as `safeMessage`. */
function auditQuery<T>(safeMessage: string, run: () => Promise<T>) {
	return Effect.tryPromise({
		try: run,
		catch: (error) => {
			console.error(`${safeMessage}:`, error);
			return new Error(safeMessage);
		},
	}).pipe(Effect.orDie);
}

function dateFilters(startDate: string | undefined, endDate: string | undefined, timezone: string) {
	if (!startDate && !endDate) return {};
	if (!startDate || !endDate) {
		throw new RangeError("Audit log date filters require both start and end dates");
	}
	const range = resolveAuditDateRange(startDate, endDate, timezone);
	return { startDate: range.start, endDateExclusive: range.endExclusive };
}

/** Paginated audit logs of the active organization. */
export const getAuditLogsAction = organizationAction(
	{ name: "auditLog.getLogs", requires: "orgAdmin", schema: auditLogFiltersSchema },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const timezone = yield* organizationTimezone(organizationId);
			return yield* auditQuery("Failed to fetch audit logs", (): Promise<AuditLogPage> => {
				const queryFilters: AuditLogFilters = {
					organizationId,
					entityType: input.entityType,
					action: input.action,
					performedBy: input.performedBy,
					...dateFilters(input.startDate, input.endDate, timezone),
					search: input.search,
					limit: input.limit || 50,
					offset: input.offset || 0,
				};
				return getAuditLogs(queryFilters);
			});
		}),
);

/** Audit log statistics of the active organization. */
export const getAuditStatsAction = organizationAction(
	{ name: "auditLog.getStats", requires: "orgAdmin", schema: dateRangeSchema },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const timezone = yield* organizationTimezone(organizationId);
			return yield* auditQuery("Failed to fetch audit statistics", (): Promise<AuditStats> => {
				const range = resolveAuditDateRange(input.startDate, input.endDate, timezone);
				return getAuditLogStats(organizationId, range.start, range.endExclusive, {
					endExclusive: true,
				});
			});
		}),
);

/** Audit logs of the active organization as JSON for download. */
export const exportAuditLogsAction = organizationAction(
	{ name: "auditLog.export", requires: "orgAdmin", schema: dateRangeSchema },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const timezone = yield* organizationTimezone(organizationId);
			return yield* auditQuery("Failed to export audit logs", () => {
				const range = resolveAuditDateRange(input.startDate, input.endDate, timezone);
				return exportAuditLogs(organizationId, range.start, range.endExclusive);
			});
		}),
);
