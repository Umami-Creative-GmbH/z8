/**
 * Teams Compliance Service
 *
 * Provides compliance data formatted for Teams bot display.
 * Aggregates violations, alerts, and pending exception requests.
 */

import { and, eq, gte, lte, inArray, desc, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import {
	complianceException,
	workPolicyViolation,
	employee,
	employeeManagers,
	workPeriod,
} from "@/db/schema";
import { user } from "@/db/auth-schema";
import { DatabaseError } from "../errors";
import { DatabaseService, DatabaseServiceLive } from "./database.service";

// ============================================
// TYPES
// ============================================

export interface ComplianceAlert {
	id: string;
	type: "rest_period" | "overtime_daily" | "overtime_weekly" | "overtime_monthly" | "max_daily_hours";
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

export class TeamsComplianceService extends Context.Tag("TeamsComplianceService")<
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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
>() {}

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
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		/**
		 * Get managed employee IDs with their names
		 */
		const getManagedEmployeesWithNames = (
			managerId: string,
			organizationId: string,
		): Effect.Effect<Map<string, string>, DatabaseError> =>
			dbService.query("getManagedEmployeesWithNames", async () => {
				const managed = await dbService.db.query.employeeManagers.findMany({
					where: eq(employeeManagers.managerId, managerId),
					with: {
						employee: {
							columns: { id: true, organizationId: true },
							with: {
								user: { columns: { name: true } },
							},
						},
					},
				});

				const map = new Map<string, string>();
				for (const m of managed) {
					if (m.employee.organizationId === organizationId) {
						map.set(m.employeeId, m.employee.user?.name || "Unknown");
					}
				}
				return map;
			});

		return TeamsComplianceService.of({
			getComplianceAlertsForManager: (params) =>
				Effect.gen(function* (_) {
					const { managerId, organizationId, daysBack = 7, timezone } = params;

					// Get managed employees
					const managedEmployees = yield* _(getManagedEmployeesWithNames(managerId, organizationId));
					if (managedEmployees.size === 0) {
						return [];
					}

					const managedEmployeeIds = [...managedEmployees.keys()];
					const now = DateTime.now().setZone(timezone);
					const startDate = now.minus({ days: daysBack }).startOf("day").toJSDate();

					// Get violations for managed employees
					const violations = yield* _(
						dbService.query("getViolations", async () => {
							return await dbService.db.query.workPolicyViolation.findMany({
								where: and(
									eq(workPolicyViolation.organizationId, organizationId),
									inArray(workPolicyViolation.employeeId, managedEmployeeIds),
									gte(workPolicyViolation.violationDate, startDate),
								),
								orderBy: [desc(workPolicyViolation.violationDate)],
								limit: 50,
							});
						}),
					);

					// Get used exceptions to check for covered violations
					const usedExceptions = yield* _(
						dbService.query("getUsedExceptions", async () => {
							return await dbService.db.query.complianceException.findMany({
								where: and(
									eq(complianceException.organizationId, organizationId),
									inArray(complianceException.employeeId, managedEmployeeIds),
									eq(complianceException.wasUsed, true),
									gte(complianceException.usedAt, startDate),
								),
							});
						}),
					);

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
								DateTime.fromJSDate(ex.usedAt).hasSame(DateTime.fromJSDate(v.violationDate), "day"),
						);

						return {
							id: v.id,
							type: v.violationType as ComplianceAlert["type"],
							severity: calculateSeverity(v.violationType, v.details as Record<string, unknown> | null),
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
				Effect.gen(function* (_) {
					const { managerId, organizationId } = params;

					// Get managed employees
					const managedEmployees = yield* _(getManagedEmployeesWithNames(managerId, organizationId));
					if (managedEmployees.size === 0) {
						return [];
					}

					const managedEmployeeIds = [...managedEmployees.keys()];

					// Get pending exceptions
					const exceptions = yield* _(
						dbService.query("getPendingExceptions", async () => {
							return await dbService.db.query.complianceException.findMany({
								where: and(
									eq(complianceException.organizationId, organizationId),
									inArray(complianceException.employeeId, managedEmployeeIds),
									eq(complianceException.status, "pending"),
								),
								orderBy: [desc(complianceException.createdAt)],
								limit: 20,
							});
						}),
					);

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
				Effect.gen(function* (_) {
					const { managerId, organizationId, daysBack = 7, timezone } = params;

					// Get alerts and exceptions in parallel
					const [alerts, pendingExceptions] = yield* _(
						Effect.all([
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
						]),
					);

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
				Effect.gen(function* (_) {
					const { managerId, organizationId } = params;

					// Get managed employees
					const managedEmployees = yield* _(getManagedEmployeesWithNames(managerId, organizationId));
					if (managedEmployees.size === 0) {
						return 0;
					}

					const managedEmployeeIds = [...managedEmployees.keys()];

					const result = yield* _(
						dbService.query("countPendingExceptions", async () => {
							const [countResult] = await dbService.db
								.select({ count: sql<number>`count(*)` })
								.from(complianceException)
								.where(
									and(
										eq(complianceException.organizationId, organizationId),
										inArray(complianceException.employeeId, managedEmployeeIds),
										eq(complianceException.status, "pending"),
									),
								);
							return Number(countResult?.count) || 0;
						}),
					);

					return result;
				}),
		});
	}),
);

// ============================================
// LAYER DEPENDENCIES
// ============================================

export const TeamsComplianceServiceFullLive = TeamsComplianceServiceLive.pipe(
	Layer.provide(DatabaseServiceLive),
);
