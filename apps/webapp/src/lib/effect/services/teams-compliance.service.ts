/**
 * Teams Compliance Service
 *
 * Provides compliance data formatted for Teams bot display.
 * Aggregates violations, alerts, and pending exception requests.
 */
/** oxlint-disable typescript/no-explicit-any -- it is what it is */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { complianceException, employee, workPolicyViolation } from "@/db/schema";
import { getEligibleApprovalScopesForManager } from "@/lib/approvals/policies/manager-eligibility-db";
import { awaitingComplianceExceptionDecision } from "@/lib/compliance/pending-compliance-exception";
import {
	dateFromInstant,
	instantFromDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { DatabaseError } from "@/lib/effect/errors";
import { parseTimeZone } from "@/lib/timezone/validation";
import { DatabaseService } from "./database.service";

// ============================================
// TYPES
// ============================================

export interface ComplianceAlert {
	id: string;
	type:
		| "rest_period"
		| "overtime_daily"
		| "overtime_weekly"
		| "overtime_monthly"
		| "max_daily_hours";
	severity: "warning" | "critical" | "violation";
	employeeId: string;
	employeeName: string;
	date: Date;
	details: string;
	hasException: boolean;
	exceptionId?: string;
}

export interface ComplianceExceptionSummary {
	id: string;
	employeeId: string;
	employeeName: string;
	exceptionType: "rest_period" | "overtime_daily" | "overtime_weekly" | "overtime_monthly";
	status: "pending" | "approved" | "rejected" | "expired" | "used";
	requestedAt: Date;
	validFrom: Date;
	validUntil: Date;
	reason: string;
}

export interface ComplianceSummary {
	alerts: ComplianceAlert[];
	pendingExceptions: ComplianceExceptionSummary[];
	recentViolationsCount: number;
	criticalAlertsCount: number;
}

// ============================================
// SERVICE INTERFACE
// ============================================

export class TeamsComplianceService extends Context.Service<
	TeamsComplianceService,
	{
		/**
		 * Get compliance alerts for employees managed by a manager
		 */
		readonly getComplianceAlertsForManager: (params: {
			managerId: string;
			organizationId: string;
			daysBack?: number;
			timezone: string;
		}) => Effect.Effect<ComplianceAlert[], DatabaseError>;

		/**
		 * Get pending exception requests for a manager to approve
		 */
		readonly getPendingExceptionsForManager: (params: {
			managerId: string;
			organizationId: string;
		}) => Effect.Effect<ComplianceExceptionSummary[], DatabaseError>;

		/**
		 * Get full compliance summary for Teams display
		 */
		readonly getComplianceSummary: (params: {
			managerId: string;
			organizationId: string;
			daysBack?: number;
			timezone: string;
		}) => Effect.Effect<ComplianceSummary, DatabaseError, any>;

		/**
		 * Get count of pending compliance exceptions for digest
		 */
		readonly getPendingExceptionsCount: (params: {
			managerId: string;
			organizationId: string;
		}) => Effect.Effect<number, DatabaseError>;
	}
>()("TeamsComplianceService") {}

// ============================================
// HELPER FUNCTIONS
// ============================================

function mapExceptionTypeToDisplay(type: string): string {
	switch (type) {
		case "rest_period":
			return "Rest Period Violation";
		case "overtime_daily":
			return "Daily Overtime";
		case "overtime_weekly":
			return "Weekly Overtime";
		case "overtime_monthly":
			return "Monthly Overtime";
		default:
			return type;
	}
}

function calculateSeverity(
	violationType: string,
	details: Record<string, unknown> | null,
): "warning" | "critical" | "violation" {
	// Rest period violations are always critical
	if (violationType === "rest_period") {
		return "violation";
	}

	// Check overtime severity based on percentage over threshold
	if (details && typeof details === "object") {
		const percentOver = (details as { percentOver?: number }).percentOver;
		if (percentOver && percentOver >= 25) {
			return "violation";
		}
		if (percentOver && percentOver >= 10) {
			return "critical";
		}
	}

	return "warning";
}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const TeamsComplianceServiceLive = Layer.effect(
	TeamsComplianceService,
	Effect.gen(function* () {
		const dbService = yield* DatabaseService;

		/**
		 * The employees this manager is responsible for, with their names: those they are an
		 * eligible manager of, as the Approval inbox the card links to scopes them (#1977), so a
		 * team's primary manager also sees a member who has no active direct manager.
		 */
		const getManagedEmployeesWithNames = (
			managerId: string,
			organizationId: string,
		): Effect.Effect<Map<string, string>, DatabaseError> =>
			dbService.query("getManagedEmployeesWithNames", async () => {
				const scopes = await getEligibleApprovalScopesForManager({
					db: dbService.db,
					managerEmployeeId: managerId,
					organizationId,
				});
				const employeeIds = scopes.map((scope) => scope.requesterEmployeeId);
				if (employeeIds.length === 0) return new Map<string, string>();
				const managed = await dbService.db.query.employee.findMany({
					where: and(
						eq(employee.organizationId, organizationId),
						inArray(employee.id, employeeIds),
					),
					columns: { id: true },
					with: { user: { columns: { name: true } } },
				});

				return new Map(managed.map((m) => [m.id, m.user?.name || "Unknown"]));
			});

		return TeamsComplianceService.of({
			getComplianceAlertsForManager: (params) =>
				Effect.gen(function* () {
					const { managerId, organizationId, daysBack = 7, timezone } = params;

					// Get managed employees
					const managedEmployees = yield* getManagedEmployeesWithNames(managerId, organizationId);
					if (managedEmployees.size === 0) {
						return [];
					}

					const managedEmployeeIds = [...managedEmployees.keys()];
					const resolvedTimezone = parseTimeZone(timezone);
					const today = plainDateAt(systemClock.nowInstant(), resolvedTimezone);
					const startDate = dateFromInstant(
						today.subtract({ days: daysBack }).toZonedDateTime(resolvedTimezone).toInstant(),
					);

					// Get violations for managed employees
					const violations = yield* dbService.query("getViolations", async () => {
						return await dbService.db.query.workPolicyViolation.findMany({
							where: and(
								eq(workPolicyViolation.organizationId, organizationId),
								inArray(workPolicyViolation.employeeId, managedEmployeeIds),
								gte(workPolicyViolation.violationDate, startDate),
							),
							orderBy: [desc(workPolicyViolation.violationDate)],
							limit: 50,
						});
					});

					// Get used exceptions to check for covered violations
					const usedExceptions = yield* dbService.query("getUsedExceptions", async () => {
						return await dbService.db.query.complianceException.findMany({
							where: and(
								eq(complianceException.organizationId, organizationId),
								inArray(complianceException.employeeId, managedEmployeeIds),
								eq(complianceException.wasUsed, true),
								gte(complianceException.usedAt, startDate),
							),
						});
					});

					const exceptionsByEmployee = new Map<string, typeof usedExceptions>();
					for (const ex of usedExceptions) {
						const existing = exceptionsByEmployee.get(ex.employeeId) || [];
						existing.push(ex);
						exceptionsByEmployee.set(ex.employeeId, existing);
					}

					// Map violations to alerts
					const alerts: ComplianceAlert[] = violations.map((v) => {
						const employeeExceptions = exceptionsByEmployee.get(v.employeeId) || [];
						const matchingException = employeeExceptions.find(
							(ex) =>
								ex.exceptionType === v.violationType &&
								ex.usedAt &&
								plainDateAt(instantFromDate(ex.usedAt), resolvedTimezone).equals(
									plainDateAt(instantFromDate(v.violationDate), resolvedTimezone),
								),
						);

						return {
							id: v.id,
							type: v.violationType as ComplianceAlert["type"],
							severity: calculateSeverity(
								v.violationType,
								v.details as Record<string, unknown> | null,
							),
							employeeId: v.employeeId,
							employeeName: managedEmployees.get(v.employeeId) || "Unknown",
							date: v.violationDate,
							details: mapExceptionTypeToDisplay(v.violationType),
							hasException: !!matchingException,
							exceptionId: matchingException?.id,
						};
					});

					// Sort by severity (violation > critical > warning) then by date
					const severityOrder = { violation: 0, critical: 1, warning: 2 };
					alerts.sort((a, b) => {
						const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
						if (severityDiff !== 0) return severityDiff;
						return b.date.getTime() - a.date.getTime();
					});

					return alerts;
				}),

			getPendingExceptionsForManager: (params) =>
				Effect.gen(function* () {
					const { managerId, organizationId } = params;

					// Get managed employees
					const managedEmployees = yield* getManagedEmployeesWithNames(managerId, organizationId);
					if (managedEmployees.size === 0) {
						return [];
					}

					const managedEmployeeIds = [...managedEmployees.keys()];

					// Get pending exceptions
					const exceptions = yield* dbService.query("getPendingExceptions", async () => {
						return await dbService.db.query.complianceException.findMany({
							where: and(
								eq(complianceException.organizationId, organizationId),
								inArray(complianceException.employeeId, managedEmployeeIds),
								// A lapsed exception is expired, as in the Approval inbox the card links to (#1977).
								awaitingComplianceExceptionDecision(systemClock.nowInstant()),
							),
							orderBy: [desc(complianceException.createdAt)],
							limit: 20,
						});
					});

					return exceptions.map((ex) => ({
						id: ex.id,
						employeeId: ex.employeeId,
						employeeName: managedEmployees.get(ex.employeeId) || "Unknown",
						exceptionType: ex.exceptionType,
						status: ex.status,
						requestedAt: ex.createdAt,
						validFrom: ex.validFrom,
						validUntil: ex.validUntil,
						reason: ex.reason,
					}));
				}),

			getComplianceSummary: (params) =>
				Effect.gen(function* () {
					const { managerId, organizationId, daysBack = 7, timezone } = params;

					// Get alerts and exceptions in parallel
					const [alerts, pendingExceptions] = yield* Effect.all([
						TeamsComplianceService.pipe(
							Effect.flatMap((service) =>
								service.getComplianceAlertsForManager({
									managerId,
									organizationId,
									daysBack,
									timezone,
								}),
							),
						),
						TeamsComplianceService.pipe(
							Effect.flatMap((service) =>
								service.getPendingExceptionsForManager({
									managerId,
									organizationId,
								}),
							),
						),
					]);

					const criticalAlertsCount = alerts.filter(
						(a) => a.severity === "critical" || a.severity === "violation",
					).length;

					return {
						alerts,
						pendingExceptions,
						recentViolationsCount: alerts.length,
						criticalAlertsCount,
					};
				}),

			getPendingExceptionsCount: (params) =>
				Effect.gen(function* () {
					const { managerId, organizationId } = params;

					// Get managed employees
					const managedEmployees = yield* getManagedEmployeesWithNames(managerId, organizationId);
					if (managedEmployees.size === 0) {
						return 0;
					}

					const managedEmployeeIds = [...managedEmployees.keys()];

					const result = yield* dbService.query("countPendingExceptions", async () => {
						const [countResult] = await dbService.db
							.select({ count: sql<number>`count(*)` })
							.from(complianceException)
							.where(
								and(
									eq(complianceException.organizationId, organizationId),
									inArray(complianceException.employeeId, managedEmployeeIds),
									awaitingComplianceExceptionDecision(systemClock.nowInstant()),
								),
							);
						return Number(countResult?.count) || 0;
					});

					return result;
				}),
		});
	}),
);
