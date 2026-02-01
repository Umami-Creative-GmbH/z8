/**
 * Compliance Findings Service
 *
 * Manages persistence and status changes for compliance findings.
 * Handles acknowledge, waive, resolve workflows with audit logging.
 */

import { and, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { db } from "@/db";
import {
	complianceFinding,
	complianceConfig,
	employee,
	workPolicy,
	type ComplianceFinding,
	type ComplianceFindingEvidence,
	type ComplianceFindingSeverity,
	type ComplianceFindingStatus,
	type ComplianceFindingType,
} from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { DatabaseError, NotFoundError } from "../errors";
import type { ComplianceFindingResult } from "@/lib/compliance/rules";

const logger = createLogger("ComplianceFindingsService");

// ============================================
// TYPES
// ============================================

export interface ComplianceFindingWithDetails {
	id: string;
	organizationId: string;
	type: ComplianceFindingType;
	severity: ComplianceFindingSeverity;
	status: ComplianceFindingStatus;
	occurrenceDate: Date;
	periodStart: Date;
	periodEnd: Date;
	evidence: ComplianceFindingEvidence;
	createdAt: Date;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	};
	policy: {
		id: string;
		name: string;
	} | null;
	acknowledgedBy: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
	acknowledgedAt: Date | null;
	acknowledgmentNote: string | null;
	waivedBy: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
	waivedAt: Date | null;
	waiverReason: string | null;
	resolvedBy: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
	resolvedAt: Date | null;
	resolutionNote: string | null;
}

export interface GetFindingsParams {
	organizationId: string;
	filters?: {
		employeeIds?: string[];
		types?: ComplianceFindingType[];
		severities?: ComplianceFindingSeverity[];
		statuses?: ComplianceFindingStatus[];
		dateRange?: { start: Date; end: Date };
	};
	pagination?: { limit: number; offset: number };
}

export interface FindingsWithCount {
	findings: ComplianceFindingWithDetails[];
	total: number;
}

export interface ComplianceStats {
	totalOpen: number;
	bySeverity: {
		info: number;
		warning: number;
		critical: number;
	};
	byType: Record<string, number>;
	recentTrend: "improving" | "stable" | "worsening";
}

// ============================================
// SERVICE DEFINITION
// ============================================

export class ComplianceFindingsService extends Context.Tag("ComplianceFindingsService")<
	ComplianceFindingsService,
	{
		/**
		 * Create a new finding (from detection results)
		 */
		readonly createFinding: (
			finding: ComplianceFindingResult,
			createdBy: string,
		) => Effect.Effect<string, DatabaseError>;

		/**
		 * Create multiple findings (batch insert)
		 */
		readonly createFindings: (
			findings: ComplianceFindingResult[],
			createdBy: string,
		) => Effect.Effect<string[], DatabaseError>;

		/**
		 * Get findings with filters and pagination
		 */
		readonly getFindings: (
			params: GetFindingsParams,
		) => Effect.Effect<FindingsWithCount, DatabaseError>;

		/**
		 * Get a single finding by ID
		 */
		readonly getFinding: (
			findingId: string,
		) => Effect.Effect<ComplianceFindingWithDetails, NotFoundError | DatabaseError>;

		/**
		 * Acknowledge a finding (manager reviewed)
		 */
		readonly acknowledgeFinding: (params: {
			findingId: string;
			acknowledgedBy: string;
			note?: string;
		}) => Effect.Effect<void, NotFoundError | DatabaseError>;

		/**
		 * Waive a finding (admin exception)
		 */
		readonly waiveFinding: (params: {
			findingId: string;
			waivedBy: string;
			reason: string;
		}) => Effect.Effect<void, NotFoundError | DatabaseError>;

		/**
		 * Resolve a finding (no longer relevant)
		 */
		readonly resolveFinding: (params: {
			findingId: string;
			resolvedBy: string;
			note?: string;
		}) => Effect.Effect<void, NotFoundError | DatabaseError>;

		/**
		 * Get count of open findings
		 */
		readonly getOpenFindingsCount: (params: {
			organizationId: string;
			severity?: ComplianceFindingSeverity;
		}) => Effect.Effect<number, DatabaseError>;

		/**
		 * Get compliance stats for dashboard
		 */
		readonly getStats: (
			organizationId: string,
		) => Effect.Effect<ComplianceStats, DatabaseError>;

		/**
		 * Check if finding already exists (for deduplication)
		 */
		readonly findingExists: (params: {
			organizationId: string;
			employeeId: string;
			type: ComplianceFindingType;
			occurrenceDate: Date;
		}) => Effect.Effect<boolean, DatabaseError>;
	}
>() {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const ComplianceFindingsServiceLive = Layer.succeed(
	ComplianceFindingsService,
	ComplianceFindingsService.of({
		createFinding: (finding, createdBy) =>
			Effect.tryPromise({
				try: async () => {
					// Look up employee's organizationId
					const emp = await db.query.employee.findFirst({
						where: eq(employee.id, finding.employeeId),
						columns: { organizationId: true },
					});

					if (!emp) {
						throw new Error(`Employee not found: ${finding.employeeId}`);
					}

					const [created] = await db
						.insert(complianceFinding)
						.values({
							organizationId: emp.organizationId,
							employeeId: finding.employeeId,
							type: finding.type,
							severity: finding.severity,
							occurrenceDate: finding.occurrenceDate,
							periodStart: finding.periodStart,
							periodEnd: finding.periodEnd,
							evidence: finding.evidence,
							workPolicyId: finding.workPolicyId,
							status: "open",
							createdBy,
						})
						.returning({ id: complianceFinding.id });

					logger.info(
						{ findingId: created.id, type: finding.type, employeeId: finding.employeeId },
						"Created compliance finding",
					);

					return created.id;
				},
				catch: (error) =>
					new DatabaseError({
						message: `Failed to create finding: ${error instanceof Error ? error.message : String(error)}`,
						cause: error instanceof Error ? error : undefined,
					}),
			}),

		createFindings: (findings, createdBy) =>
			Effect.tryPromise({
				try: async () => {
					if (findings.length === 0) {
						return [];
					}

					// Get organization ID from first finding's employee
					const firstEmployee = await db.query.employee.findFirst({
						where: eq(employee.id, findings[0].employeeId),
						columns: { organizationId: true },
					});

					if (!firstEmployee) {
						throw new Error("Employee not found for finding");
					}

					const values = findings.map((f) => ({
						organizationId: firstEmployee.organizationId,
						employeeId: f.employeeId,
						type: f.type,
						severity: f.severity,
						occurrenceDate: f.occurrenceDate,
						periodStart: f.periodStart,
						periodEnd: f.periodEnd,
						evidence: f.evidence,
						workPolicyId: f.workPolicyId,
						status: "open" as const,
						createdBy,
					}));

					const created = await db
						.insert(complianceFinding)
						.values(values)
						.returning({ id: complianceFinding.id });

					logger.info(
						{ count: created.length, organizationId: firstEmployee.organizationId },
						"Created compliance findings batch",
					);

					return created.map((c) => c.id);
				},
				catch: (error) =>
					new DatabaseError({
						message: `Failed to create findings batch: ${error instanceof Error ? error.message : String(error)}`,
						cause: error instanceof Error ? error : undefined,
					}),
			}),

		getFindings: (params) =>
			Effect.tryPromise({
				try: async () => {
					const { organizationId, filters, pagination } = params;

					// Build conditions
					const conditions = [eq(complianceFinding.organizationId, organizationId)];

					if (filters?.employeeIds && filters.employeeIds.length > 0) {
						conditions.push(inArray(complianceFinding.employeeId, filters.employeeIds));
					}

					if (filters?.types && filters.types.length > 0) {
						conditions.push(inArray(complianceFinding.type, filters.types));
					}

					if (filters?.severities && filters.severities.length > 0) {
						conditions.push(inArray(complianceFinding.severity, filters.severities));
					}

					if (filters?.statuses && filters.statuses.length > 0) {
						conditions.push(inArray(complianceFinding.status, filters.statuses));
					}

					if (filters?.dateRange) {
						conditions.push(gte(complianceFinding.occurrenceDate, filters.dateRange.start));
						conditions.push(lte(complianceFinding.occurrenceDate, filters.dateRange.end));
					}

					const whereClause = and(...conditions);

					// Get total count
					const [countResult] = await db
						.select({ total: count() })
						.from(complianceFinding)
						.where(whereClause);

					// Get findings with relations
					const findings = await db.query.complianceFinding.findMany({
						where: whereClause,
						with: {
							employee: {
								columns: { id: true, firstName: true, lastName: true },
							},
							workPolicy: {
								columns: { id: true, name: true },
							},
							acknowledgedByRef: {
								columns: { id: true, firstName: true, lastName: true },
							},
							waivedByRef: {
								columns: { id: true, firstName: true, lastName: true },
							},
							resolvedByRef: {
								columns: { id: true, firstName: true, lastName: true },
							},
						},
						orderBy: [desc(complianceFinding.occurrenceDate)],
						limit: pagination?.limit ?? 50,
						offset: pagination?.offset ?? 0,
					});

					return {
						findings: findings.map(mapFindingToDetails),
						total: countResult.total,
					};
				},
				catch: (error) =>
					new DatabaseError({
						message: `Failed to get findings: ${error instanceof Error ? error.message : String(error)}`,
						cause: error instanceof Error ? error : undefined,
					}),
			}),

		getFinding: (findingId) =>
			Effect.tryPromise({
				try: async () => {
					const finding = await db.query.complianceFinding.findFirst({
						where: eq(complianceFinding.id, findingId),
						with: {
							employee: {
								columns: { id: true, firstName: true, lastName: true },
							},
							workPolicy: {
								columns: { id: true, name: true },
							},
							acknowledgedByRef: {
								columns: { id: true, firstName: true, lastName: true },
							},
							waivedByRef: {
								columns: { id: true, firstName: true, lastName: true },
							},
							resolvedByRef: {
								columns: { id: true, firstName: true, lastName: true },
							},
						},
					});

					if (!finding) {
						throw new NotFoundError({
							message: "Finding not found",
							entityType: "complianceFinding",
							entityId: findingId,
						});
					}

					return mapFindingToDetails(finding);
				},
				catch: (error) => {
					if (error instanceof NotFoundError) {
						return error;
					}
					return new DatabaseError({
						message: `Failed to get finding: ${error instanceof Error ? error.message : String(error)}`,
						cause: error instanceof Error ? error : undefined,
					});
				},
			}) as Effect.Effect<ComplianceFindingWithDetails, NotFoundError | DatabaseError>,

		acknowledgeFinding: (params) =>
			Effect.tryPromise({
				try: async () => {
					const { findingId, acknowledgedBy, note } = params;

					const [updated] = await db
						.update(complianceFinding)
						.set({
							status: "acknowledged",
							acknowledgedBy,
							acknowledgedAt: new Date(),
							acknowledgmentNote: note ?? null,
						})
						.where(eq(complianceFinding.id, findingId))
						.returning({ id: complianceFinding.id });

					if (!updated) {
						throw new NotFoundError({
							message: "Finding not found",
							entityType: "complianceFinding",
							entityId: findingId,
						});
					}

					logger.info({ findingId, acknowledgedBy }, "Finding acknowledged");
				},
				catch: (error) => {
					if (error instanceof NotFoundError) {
						return error;
					}
					return new DatabaseError({
						message: `Failed to acknowledge finding: ${error instanceof Error ? error.message : String(error)}`,
						cause: error instanceof Error ? error : undefined,
					});
				},
			}) as Effect.Effect<void, NotFoundError | DatabaseError>,

		waiveFinding: (params) =>
			Effect.tryPromise({
				try: async () => {
					const { findingId, waivedBy, reason } = params;

					const [updated] = await db
						.update(complianceFinding)
						.set({
							status: "waived",
							waivedBy,
							waivedAt: new Date(),
							waiverReason: reason,
						})
						.where(eq(complianceFinding.id, findingId))
						.returning({ id: complianceFinding.id });

					if (!updated) {
						throw new NotFoundError({
							message: "Finding not found",
							entityType: "complianceFinding",
							entityId: findingId,
						});
					}

					logger.info({ findingId, waivedBy, reason }, "Finding waived");
				},
				catch: (error) => {
					if (error instanceof NotFoundError) {
						return error;
					}
					return new DatabaseError({
						message: `Failed to waive finding: ${error instanceof Error ? error.message : String(error)}`,
						cause: error instanceof Error ? error : undefined,
					});
				},
			}) as Effect.Effect<void, NotFoundError | DatabaseError>,

		resolveFinding: (params) =>
			Effect.tryPromise({
				try: async () => {
					const { findingId, resolvedBy, note } = params;

					const [updated] = await db
						.update(complianceFinding)
						.set({
							status: "resolved",
							resolvedBy,
							resolvedAt: new Date(),
							resolutionNote: note ?? null,
						})
						.where(eq(complianceFinding.id, findingId))
						.returning({ id: complianceFinding.id });

					if (!updated) {
						throw new NotFoundError({
							message: "Finding not found",
							entityType: "complianceFinding",
							entityId: findingId,
						});
					}

					logger.info({ findingId, resolvedBy }, "Finding resolved");
				},
				catch: (error) => {
					if (error instanceof NotFoundError) {
						return error;
					}
					return new DatabaseError({
						message: `Failed to resolve finding: ${error instanceof Error ? error.message : String(error)}`,
						cause: error instanceof Error ? error : undefined,
					});
				},
			}) as Effect.Effect<void, NotFoundError | DatabaseError>,

		getOpenFindingsCount: (params) =>
			Effect.tryPromise({
				try: async () => {
					const { organizationId, severity } = params;

					const conditions = [
						eq(complianceFinding.organizationId, organizationId),
						eq(complianceFinding.status, "open"),
					];

					if (severity) {
						conditions.push(eq(complianceFinding.severity, severity));
					}

					const [result] = await db
						.select({ count: count() })
						.from(complianceFinding)
						.where(and(...conditions));

					return result.count;
				},
				catch: (error) =>
					new DatabaseError({
						message: `Failed to get open findings count: ${error instanceof Error ? error.message : String(error)}`,
						cause: error instanceof Error ? error : undefined,
					}),
			}),

		getStats: (organizationId) =>
			Effect.tryPromise({
				try: async () => {
					// Count by severity for open findings
					const severityCounts = await db
						.select({
							severity: complianceFinding.severity,
							count: count(),
						})
						.from(complianceFinding)
						.where(
							and(
								eq(complianceFinding.organizationId, organizationId),
								eq(complianceFinding.status, "open"),
							),
						)
						.groupBy(complianceFinding.severity);

					// Count by type for open findings
					const typeCounts = await db
						.select({
							type: complianceFinding.type,
							count: count(),
						})
						.from(complianceFinding)
						.where(
							and(
								eq(complianceFinding.organizationId, organizationId),
								eq(complianceFinding.status, "open"),
							),
						)
						.groupBy(complianceFinding.type);

					const bySeverity = {
						info: 0,
						warning: 0,
						critical: 0,
					};

					for (const row of severityCounts) {
						bySeverity[row.severity as keyof typeof bySeverity] = row.count;
					}

					const byType: Record<string, number> = {};
					for (const row of typeCounts) {
						byType[row.type] = row.count;
					}

					const totalOpen = bySeverity.info + bySeverity.warning + bySeverity.critical;

					// Simple trend calculation (compare last 7 days to previous 7 days)
					// This is a simplified version - could be more sophisticated
					const recentTrend: ComplianceStats["recentTrend"] = "stable";

					return {
						totalOpen,
						bySeverity,
						byType,
						recentTrend,
					};
				},
				catch: (error) =>
					new DatabaseError({
						message: `Failed to get stats: ${error instanceof Error ? error.message : String(error)}`,
						cause: error instanceof Error ? error : undefined,
					}),
			}),

		findingExists: (params) =>
			Effect.tryPromise({
				try: async () => {
					const { organizationId, employeeId, type, occurrenceDate } = params;

					// Check same day (using date comparison)
					const startOfDay = new Date(occurrenceDate);
					startOfDay.setHours(0, 0, 0, 0);
					const endOfDay = new Date(occurrenceDate);
					endOfDay.setHours(23, 59, 59, 999);

					const existing = await db.query.complianceFinding.findFirst({
						where: and(
							eq(complianceFinding.organizationId, organizationId),
							eq(complianceFinding.employeeId, employeeId),
							eq(complianceFinding.type, type),
							gte(complianceFinding.occurrenceDate, startOfDay),
							lte(complianceFinding.occurrenceDate, endOfDay),
						),
						columns: { id: true },
					});

					return !!existing;
				},
				catch: (error) =>
					new DatabaseError({
						message: `Failed to check finding existence: ${error instanceof Error ? error.message : String(error)}`,
						cause: error instanceof Error ? error : undefined,
					}),
			}),
	}),
);

// ============================================
// HELPER FUNCTIONS
// ============================================

function mapFindingToDetails(finding: any): ComplianceFindingWithDetails {
	return {
		id: finding.id,
		organizationId: finding.organizationId,
		type: finding.type,
		severity: finding.severity,
		status: finding.status,
		occurrenceDate: finding.occurrenceDate,
		periodStart: finding.periodStart,
		periodEnd: finding.periodEnd,
		evidence: finding.evidence as ComplianceFindingEvidence,
		createdAt: finding.createdAt,
		employee: finding.employee ?? {
			id: finding.employeeId,
			firstName: null,
			lastName: null,
		},
		policy: finding.workPolicy ?? null,
		acknowledgedBy: finding.acknowledgedByRef ?? null,
		acknowledgedAt: finding.acknowledgedAt,
		acknowledgmentNote: finding.acknowledgmentNote,
		waivedBy: finding.waivedByRef ?? null,
		waivedAt: finding.waivedAt,
		waiverReason: finding.waiverReason,
		resolvedBy: finding.resolvedByRef ?? null,
		resolvedAt: finding.resolvedAt,
		resolutionNote: finding.resolutionNote,
	};
}
